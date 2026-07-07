"""
POST /rest/{func_name}        — legacy RPC
POST /api/demo/mdrs/v1/lis-center/{direction}/{operation}  — table CRUD or RPC
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import httpx
import json
import asyncpg
from config import POSTGREST_URL, PG_DSN

router = APIRouter()

# {direction/operation: {func_name, target_table, target_op}}
_url_map: dict[str, dict] = {}

PG_POOL: asyncpg.Pool = None  # Set after lifespan creates pool


async def init_url_map():
    global _url_map, PG_POOL
    pg = await asyncpg.connect(PG_DSN)
    rows = await pg.fetch(
        "SELECT func_name, url, target_table, target_op "
        "FROM biz.interfaces WHERE is_valid = true"
    )
    for r in rows:
        parts = r["url"].rstrip("/").split("/")
        if len(parts) >= 2:
            key = f"{parts[-2]}/{parts[-1]}"
            _url_map[key] = {
                "func_name": r["func_name"],
                "target_table": r["target_table"],
                "target_op": r["target_op"],
            }
    await pg.close()


def _get_engine():
    from main import validation_engine
    return validation_engine


def _get_log_writer():
    from main import log_writer
    return log_writer


def _payload_to_query(payload: dict) -> str:
    """Convert {key: val, ...} → ?key=eq.val&key2=eq.val2"""
    parts = [f"{k}=eq.{v}" for k, v in payload.items()
             if v is not None and v != "" and not isinstance(v, (dict, list))]
    return "&".join(parts)


async def _forward_table(
    table: str, op: str, payload: dict, client: httpx.AsyncClient
) -> httpx.Response:
    """Forward request to PostgREST table endpoint."""
    base = f"{POSTGREST_URL}/{table}"
    headers = {"Content-Type": "application/json"}

    if op == "SELECT":
        qs = _payload_to_query(payload)
        url = f"{base}?{qs}" if qs else base
        resp = await client.get(url, headers=headers, timeout=30)

    elif op == "INSERT":
        resp = await client.post(base, json=payload, headers=headers, timeout=30)

    elif op == "UPDATE":
        # Use all payload keys as filter AND body
        qs = _payload_to_query(payload)
        url = f"{base}?{qs}" if qs else base
        resp = await client.patch(url, json=payload, headers=headers, timeout=30)

    elif op == "UPSERT":
        headers["Prefer"] = "resolution=merge-duplicates"
        resp = await client.post(base, json=payload, headers=headers, timeout=30)

    else:
        raise HTTPException(status_code=500, detail=f"Unknown op: {op}")

    return resp


async def _forward_rpc(
    func_name: str, payload: dict
) -> dict:
    """Call PG function directly via asyncpg, bypass PostgREST."""
    global PG_POOL
    if PG_POOL is None:
        raise HTTPException(status_code=500, detail="DB pool not initialized")
    async with PG_POOL.acquire() as conn:
        result = await conn.fetchval(
            f"SELECT ichse.{func_name}($1::json)",
            json.dumps(payload),
        )
    return json.loads(result) if isinstance(result, str) else result


async def _handle(meta: dict, payload: dict):
    """Validate → log → forward to PostgREST (table or RPC)."""
    func_name = meta["func_name"]
    target_table = meta.get("target_table")
    target_op = meta.get("target_op")

    engine = _get_engine()
    result = await engine.validate(func_name, payload)

    logger = _get_log_writer()
    if logger:
        logger.enqueue(func_name, payload, result)

    if not result.success:
        return JSONResponse(
            status_code=400,
            content={
                "code": 400,
                "message": "Validation failed",
                "errors": [
                    {"field": e.field, "rule_type": e.rule_type.value, "message": e.message}
                    for e in result.errors
                ],
                "duration_ms": result.duration_ms,
            },
        )

    if target_table and target_op:
        async with httpx.AsyncClient() as client:
            resp = await _forward_table(target_table, target_op, payload, client)
        pg_data = resp.json() if resp.content else {}
        status_code = resp.status_code
    else:
        pg_data = await _forward_rpc(func_name, payload)
        status_code = 200

    if isinstance(pg_data, dict):
        pg_data.setdefault("_validation", {
            "passed": True,
            "duration_ms": result.duration_ms,
        })

    return JSONResponse(content=pg_data, status_code=status_code)


@router.post("/rest/{func_name}")
async def call_legacy(func_name: str, request: Request):
    return await _handle({"func_name": func_name}, await request.json())


@router.post("/api/demo/mdrs/v1/lis-center/{direction}/{operation}")
async def call_external(direction: str, operation: str, request: Request):
    key = f"{direction}/{operation}"
    meta = _url_map.get(key)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Unknown interface: {key}")
    return await _handle(meta, await request.json())
