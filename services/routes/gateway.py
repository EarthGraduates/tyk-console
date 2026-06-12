"""
POST /rest/{func_name}        — legacy
POST /api/ygt/mdrs/v1/lis-center/{direction}/{operation}  — per Tyk API
"""
import asyncio
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import httpx
from config import POSTGREST_URL

router = APIRouter()

# direction_slug/operation → func_name — populated by init_url_map()
_url_map: dict[str, str] = {}


async def init_url_map():
    """Build lookup: {direction/operation: func_name} from PG."""
    global _url_map
    import asyncpg
    pg = await asyncpg.connect("postgresql://ichse:ichse_dev@localhost:5433/ichse")
    rows = await pg.fetch(
        "SELECT func_name, url FROM biz.interfaces WHERE is_valid = true"
    )
    for r in rows:
        parts = r["url"].rstrip("/").split("/")
        if len(parts) >= 2:
            direction_slug = parts[-2]
            operation = parts[-1]
            _url_map[f"{direction_slug}/{operation}"] = r["func_name"]
    await pg.close()


def _get_engine():
    from main import validation_engine
    return validation_engine


def _get_log_writer():
    from main import log_writer
    return log_writer


async def _handle(func_name: str, payload: dict, request: Request):
    """Validate → forward to PostgREST (shared by all routes)."""
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
                "message": "校验失败",
                "errors": [
                    {"field": e.field, "rule_type": e.rule_type.value, "message": e.message}
                    for e in result.errors
                ],
                "duration_ms": result.duration_ms,
            },
        )

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{POSTGREST_URL}/rpc/{func_name}",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
    pg_data = resp.json()

    if isinstance(pg_data, dict):
        pg_data.setdefault("_validation", {
            "passed": True,
            "duration_ms": result.duration_ms,
        })

    return JSONResponse(content=pg_data, status_code=resp.status_code)


@router.post("/rest/{func_name}")
async def call_legacy(func_name: str, request: Request):
    return await _handle(func_name, await request.json(), request)


@router.post("/api/ygt/mdrs/v1/lis-center/{direction}/{operation}")
async def call_external(direction: str, operation: str, request: Request):
    key = f"{direction}/{operation}"
    func_name = _url_map.get(key)
    if func_name is None:
        raise HTTPException(status_code=404, detail=f"Unknown interface: {key}")
    return await _handle(func_name, await request.json(), request)
