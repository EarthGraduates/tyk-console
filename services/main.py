import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from redis.asyncio import Redis
import asyncpg
from config import REDIS_URL, SERVICE_PORT

from routes.admin import router as admin_router
from routes.gateway import router as gateway_router
from loader.rule_loader import RuleLoader
from engine import ValidationEngine
from sink.log_writer import LogWriter
from sink.batch_flusher import start_batch_flusher

rule_loader: RuleLoader = None
validation_engine: ValidationEngine = None
log_writer: LogWriter = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global rule_loader, validation_engine, log_writer
    redis = Redis.from_url(REDIS_URL, decode_responses=True)
    pg_pool = await asyncpg.create_pool(
        "postgresql://ichse:ichse_dev@localhost:5433/ichse",
        min_size=2,
        max_size=10,
    )
    rule_loader = RuleLoader(redis, pg_pool)
    validation_engine = ValidationEngine(rule_loader)
    log_writer = LogWriter(redis)

    # Share PG pool with gateway for RPC calls
    import routes.gateway as gw
    gw.PG_POOL = pg_pool

    # Build URL → func_name lookup for external Tyk routes
    await gw.init_url_map()

    # Background task: batch flush logs from Redis → PG
    asyncio.create_task(start_batch_flusher(redis, pg_pool))

    yield
    await redis.close()
    await pg_pool.close()


app = FastAPI(title="ICHSE Validation Service", version="0.4.0", lifespan=lifespan)

app.include_router(gateway_router)
app.include_router(admin_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=SERVICE_PORT, reload=True)
