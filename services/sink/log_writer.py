"""
Fire-and-forget log writer: pushes validation results to a Redis list.
Non-blocking — the caller does not wait for the Redis write.
"""
import json
import uuid
import asyncio
from redis.asyncio import Redis
from engine import ValidationResult

LOG_QUEUE_KEY = "validation:log_queue"


class LogWriter:
    def __init__(self, redis: Redis):
        self.redis = redis

    def enqueue(
        self,
        func_name: str,
        payload: dict,
        result: ValidationResult,
    ) -> None:
        """Fire-and-forget: schedule the write on the event loop, don't await it."""
        asyncio.create_task(self._write(func_name, payload, result))

    async def _write(
        self,
        func_name: str,
        payload: dict,
        result: ValidationResult,
    ) -> None:
        entry = json.dumps({
            "request_id": str(uuid.uuid4()),
            "func_name": func_name,
            "payload": json.dumps(payload, ensure_ascii=False),
            "result": json.dumps({
                "success": result.success,
                "errors": [
                    {"field": e.field, "rule_type": e.rule_type.value, "message": e.message}
                    for e in result.errors
                ],
            }, ensure_ascii=False),
            "duration_ms": result.duration_ms,
        }, ensure_ascii=False)
        await self.redis.lpush(LOG_QUEUE_KEY, entry)
