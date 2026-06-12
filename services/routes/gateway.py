"""
I4: POST /rest/{func_name} with validation + async logging
"""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
import httpx
from config import POSTGREST_URL

router = APIRouter()


def _get_engine():
    from main import validation_engine
    return validation_engine


def _get_log_writer():
    from main import log_writer
    return log_writer


@router.post("/rest/{func_name}")
async def call_interface(func_name: str, request: Request):
    payload = await request.json()

    engine = _get_engine()
    result = await engine.validate(func_name, payload)

    # Fire-and-forget: log the result to Redis → eventually PG
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

    # Validation passed — forward to PostgREST
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
