"""
Admin routes: rule refresh, API registration, Tyk sync.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import httpx
import json
import asyncpg
from config import TYK_URL, TYK_SECRET, PG_DSN, SERVICES_URL

router = APIRouter()


def get_rule_loader():
    from main import rule_loader
    return rule_loader


def _tyk_headers() -> dict:
    return {"x-tyk-authorization": TYK_SECRET, "Content-Type": "application/json"}


def _build_tyk_definition(
    interface_id: str,
    interface_name: str,
    func_name: str,
    url: str,
    listen_path: str | None = None,
    auth_mode: str = "keyless",
    target_url: str = "",
) -> dict:
    """Build a complete Tyk API definition JSON from interface metadata."""
    if not target_url:
        target_url = SERVICES_URL
    api_id = f"ichse-{interface_id.lower()}"
    parts = url.rstrip("/").split("/")
    direction_slug = parts[-2] if len(parts) > 1 else ""
    operation = parts[-1] if len(parts) > 0 else ""
    if listen_path is None:
        listen_path = f"/api/demo/mdrs/v1/lis-center/{direction_slug}/{operation}"

    return {
        "api_id": api_id,
        "name": f"ICHSE {interface_name} ({func_name})",
        "slug": api_id,
        "listen_path": listen_path,
        "target_url": target_url,
        "strip_listen_path": False,
        "use_keyless": auth_mode == "keyless",
        "active": True,
        "proxy": {
            "target_url": target_url,
            "listen_path": listen_path,
            "strip_listen_path": False,
        },
        "version_data": {
            "not_versioned": True,
            "versions": {
                "Default": {
                    "name": "Default",
                    "use_extended_paths": True,
                }
            },
        },
        "custom_middleware": {},
    }


async def _get_pg() -> asyncpg.Connection:
    return await asyncpg.connect(PG_DSN)


# ── Rule refresh (existing) ──────────────────────────────────

@router.post("/admin/refresh-rules")
async def refresh_rules():
    loader = get_rule_loader()
    total = await loader.refresh_all()
    return {"status": "ok", "rules_cached": total}


# ── API registration ─────────────────────────────────────────

@router.post("/admin/register-api")
async def register_api(data: dict):
    """
    One-click register: create api_definition from biz.interfaces + sync to Tyk.
    Body: {interface_id, listen_path?, auth_mode?, target_url?}
    """
    interface_id = data.get("interface_id")
    if not interface_id:
        raise HTTPException(status_code=400, detail="interface_id is required")

    pg = await _get_pg()
    try:
        # 1. Look up interface metadata
        iface = await pg.fetchrow(
            "SELECT interface_id, interface_name, func_name, url "
            "FROM biz.interfaces WHERE interface_id = $1 AND is_valid = true",
            interface_id,
        )
        if iface is None:
            raise HTTPException(status_code=404, detail=f"Interface not found: {interface_id}")

        # 2. Build Tyk definition
        listen_path = data.get("listen_path")
        auth_mode = data.get("auth_mode", "keyless")
        target_url = data.get("target_url") or SERVICES_URL
        tyk_def = _build_tyk_definition(
            iface["interface_id"], iface["interface_name"], iface["func_name"],
            iface["url"], listen_path=listen_path, auth_mode=auth_mode, target_url=target_url,
        )

        # 3. INSERT into api_definitions
        await pg.execute(
            """INSERT INTO ichse.api_definitions
               (api_id, owner_id, name, listen_path, target_url, auth_mode,
                status, sync_status, definition, interface_id, created_by)
               VALUES ($1, (SELECT id FROM ichse.users WHERE is_system = true AND display_name = 'system' LIMIT 1),
                       $2, $3, $4, $5, 'active', 'pending', $6::jsonb, $7, $8)
               ON CONFLICT (api_id) DO UPDATE SET
                 definition = EXCLUDED.definition,
                 interface_id = EXCLUDED.interface_id,
                 sync_status = 'pending',
                 updated_at = now()""",
            tyk_def["api_id"], tyk_def["name"], tyk_def["listen_path"],
            tyk_def["target_url"], auth_mode, json.dumps(tyk_def),
            interface_id, data.get("created_by", "admin"),
        )

        # 4. Sync to Tyk
        async with httpx.AsyncClient() as client:
            tyk_resp = await client.post(
                f"{TYK_URL}/tyk/apis/",
                json=tyk_def,
                headers=_tyk_headers(),
                timeout=10,
            )

        if tyk_resp.status_code in (200, 201):
            await pg.execute(
                "UPDATE ichse.api_definitions SET sync_status = 'synced', last_sync_at = now() WHERE api_id = $1",
                tyk_def["api_id"],
            )
            return {
                "status": "ok",
                "api_id": tyk_def["api_id"],
                "tyk_sync": "success",
            }
        else:
            await pg.execute(
                "UPDATE ichse.api_definitions SET sync_status = 'failed', sync_error = $2 WHERE api_id = $1",
                tyk_def["api_id"], tyk_resp.text[:500],
            )
            return JSONResponse(
                status_code=502,
                content={"status": "error", "api_id": tyk_def["api_id"],
                         "tyk_error": tyk_resp.text[:200]},
            )
    finally:
        await pg.close()


# ── Tyk sync ─────────────────────────────────────────────────

@router.post("/admin/sync-to-tyk/{api_id}")
async def sync_to_tyk(api_id: str):
    """POST one API definition to Tyk (idempotent)."""
    pg = await _get_pg()
    try:
        row = await pg.fetchrow(
            "SELECT definition FROM ichse.api_definitions WHERE api_id = $1",
            api_id,
        )
        if row is None:
            raise HTTPException(status_code=404, detail=f"API not found: {api_id}")

        tyk_def = json.loads(row["definition"]) if isinstance(row["definition"], str) else row["definition"]

        async with httpx.AsyncClient() as client:
            tyk_resp = await client.post(
                f"{TYK_URL}/tyk/apis/",
                json=tyk_def,
                headers=_tyk_headers(),
                timeout=10,
            )

        if tyk_resp.status_code in (200, 201):
            await pg.execute(
                "UPDATE ichse.api_definitions SET sync_status = 'synced', last_sync_at = now(), sync_error = NULL WHERE api_id = $1",
                api_id,
            )
            return {"status": "ok", "api_id": api_id, "tyk_response": tyk_resp.json()}
        else:
            await pg.execute(
                "UPDATE ichse.api_definitions SET sync_status = 'failed', sync_error = $2 WHERE api_id = $1",
                api_id, tyk_resp.text[:500],
            )
            return JSONResponse(
                status_code=502,
                content={"status": "error", "api_id": api_id, "tyk_error": tyk_resp.text[:200]},
            )
    finally:
        await pg.close()


@router.delete("/admin/sync-to-tyk/{api_id}")
async def delete_from_tyk(api_id: str):
    """DELETE an API from Tyk (for deactivate/delete)."""
    async with httpx.AsyncClient() as client:
        tyk_resp = await client.delete(
            f"{TYK_URL}/tyk/apis/{api_id}",
            headers=_tyk_headers(),
            timeout=10,
        )

    if tyk_resp.status_code in (200, 204, 404):
        return {"status": "ok", "api_id": api_id, "action": "deleted"}
    else:
        return JSONResponse(
            status_code=502,
            content={"status": "error", "api_id": api_id, "tyk_error": tyk_resp.text[:200]},
        )


# ── Startup: register all active APIs to Tyk ─────────────────

async def register_all_active_apis():
    """Called on service startup. POST all active API definitions to Tyk."""
    pg = await asyncpg.connect(PG_DSN)
    try:
        rows = await pg.fetch(
            "SELECT api_id, definition FROM ichse.api_definitions WHERE status = 'active'"
        )
        if not rows:
            return 0

        count = 0
        async with httpx.AsyncClient() as client:
            for r in rows:
                tyk_def = json.loads(r["definition"]) if isinstance(r["definition"], str) else r["definition"]
                resp = await client.post(
                    f"{TYK_URL}/tyk/apis/",
                    json=tyk_def,
                    headers=_tyk_headers(),
                    timeout=10,
                )
                if resp.status_code in (200, 201):
                    await pg.execute(
                        "UPDATE ichse.api_definitions SET sync_status = 'synced', last_sync_at = now(), sync_error = NULL WHERE api_id = $1",
                        r["api_id"],
                    )
                    count += 1
                else:
                    await pg.execute(
                        "UPDATE ichse.api_definitions SET sync_status = 'failed', sync_error = $2 WHERE api_id = $1",
                        r["api_id"], resp.text[:500],
                    )
        return count
    finally:
        await pg.close()
