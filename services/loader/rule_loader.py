"""
I2: Load validation rules from Redis (with PG fallback).
Not yet wired into the gateway — Iteration 3 will use this.
"""
import json
from redis.asyncio import Redis
import asyncpg

REDIS_KEY_PREFIX = "validation:rules"


class RuleLoader:
    def __init__(self, redis: Redis, pg_pool: asyncpg.Pool):
        self.redis = redis
        self.pg = pg_pool

    async def load(self, func_name: str) -> list[dict]:
        cache_key = f"{REDIS_KEY_PREFIX}:{func_name}"
        cached = await self.redis.get(cache_key)
        if cached:
            return json.loads(cached)

        rules = await self._load_from_pg(func_name)
        if rules:
            await self.redis.set(cache_key, json.dumps(rules), ex=3600)
        return rules

    async def _load_from_pg(self, func_name: str) -> list[dict]:
        async with self.pg.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT vr.id, vr.rule_type, vr.rule_config::text, vr.error_message,
                       iff.field_name, iff.field_path, iff.field_type, iff.direction
                FROM biz.validation_rules vr
                JOIN biz.interface_fields iff ON vr.field_id = iff.id
                JOIN biz.interfaces i ON iff.interface_id = i.id
                WHERE i.func_name = $1
                  AND vr.is_valid = true
                  AND vr.is_active = true
                  AND iff.is_valid = true
                """,
                func_name,
            )
        return [
            {
                "id": r["id"],
                "rule_type": r["rule_type"],
                "rule_config": json.loads(r["rule_config"] if isinstance(r["rule_config"], str) else r["rule_config"]),
                "error_message": r["error_message"],
                "field_name": r["field_name"],
                "field_path": r["field_path"],
                "field_type": r["field_type"],
                "direction": r["direction"],
            }
            for r in rows
        ]

    async def refresh_all(self) -> int:
        """Reload all rules from PG → Redis. Returns count of interfaces cached."""
        async with self.pg.acquire() as conn:
            func_names = [
                r["func_name"]
                for r in await conn.fetch(
                    "SELECT DISTINCT func_name FROM biz.interfaces WHERE is_valid = true"
                )
            ]

        total = 0
        for fn in func_names:
            rules = await self._load_from_pg(fn)
            cache_key = f"{REDIS_KEY_PREFIX}:{fn}"
            await self.redis.set(cache_key, json.dumps(rules), ex=3600)
            total += len(rules)

        return total
