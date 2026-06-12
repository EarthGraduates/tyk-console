"""
Background task: poll Redis queue, batch-flush to PG validation_logs table.

Runs every 5 seconds or when 100+ entries accumulate.
"""
import json
import asyncio
from redis.asyncio import Redis
import asyncpg

LOG_QUEUE_KEY = "validation:log_queue"
BATCH_SIZE = 100
FLUSH_INTERVAL = 5  # seconds


async def start_batch_flusher(redis: Redis, pg_pool: asyncpg.Pool):
    """Run forever — poll Redis, flush to PG."""
    while True:
        try:
            await _flush_batch(redis, pg_pool)
        except Exception:
            pass  # Retry next cycle
        await asyncio.sleep(FLUSH_INTERVAL)


async def _flush_batch(redis: Redis, pg_pool: asyncpg.Pool):
    entries: list[dict] = []

    # Pop up to BATCH_SIZE entries from the queue
    for _ in range(BATCH_SIZE):
        raw = await redis.rpop(LOG_QUEUE_KEY)
        if raw is None:
            break
        entries.append(json.loads(raw))

    if not entries:
        return

    async with pg_pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO biz.validation_logs (request_id, func_name, payload, result, duration_ms)
            VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5)
            """,
            [
                (
                    e["request_id"],
                    e["func_name"],
                    e["payload"],
                    e["result"],
                    e["duration_ms"],
                )
                for e in entries
            ],
        )
