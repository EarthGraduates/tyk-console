"""
Generate Tyk API JSON files from biz.interfaces.

Outputs:
  1. api-definitions/{biz_domain}/{INTERFACE_ID}.json  — source of truth (project repo)
  2. Tyk apps dir: ichse-{interface_id.lower()}.json    — Tyk Gateway runtime

Usage:
  cd services && source venv/bin/activate
  python scripts/generate_tyk_apis.py
"""
import asyncio
import asyncpg
import json
import os

PG_DSN = "postgresql://ichse:ichse_dev@localhost:5433/ichse"

# Project root relative to this script
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
API_DEF_DIR = os.path.join(PROJECT_ROOT, "api-definitions")

# Tyk Gateway apps directory (runtime)
TYKE_APPS_DIR = os.path.expanduser(
    "/Users/phoenix/Hermes/git-tyk/tyk-gateway-docker/apps"
)

TARGET_URL = "http://host.docker.internal:8000"


def url_to_slug(url: str) -> tuple[str, str]:
    parts = url.rstrip("/").split("/")
    operation = parts[-1] if len(parts) > 0 else ""
    direction_slug = parts[-2] if len(parts) > 1 else ""
    return direction_slug, operation


async def main():
    pg = await asyncpg.connect(PG_DSN)
    rows = await pg.fetch(
        "SELECT interface_id, func_name, interface_name, biz_domain, "
        "direction, url, category_code, data_flow "
        "FROM biz.interfaces WHERE is_valid = true ORDER BY id"
    )
    await pg.close()

    # ── Clean old files ──
    # Tyk apps dir
    for f in os.listdir(TYKE_APPS_DIR):
        if f.startswith("ichse-"):
            os.remove(os.path.join(TYKE_APPS_DIR, f))

    # api-definitions (clean all biz domains)
    for domain in os.listdir(API_DEF_DIR):
        domain_dir = os.path.join(API_DEF_DIR, domain)
        if os.path.isdir(domain_dir):
            for f in os.listdir(domain_dir):
                if f.endswith(".json"):
                    os.remove(os.path.join(domain_dir, f))

    count = 0
    for r in rows:
        direction_slug, operation = url_to_slug(r["url"])
        listen_path = f"/api/ygt/mdrs/v1/lis-center/{direction_slug}/{operation}"

        api_def = {
            "api_id": f"ichse-{r['interface_id'].lower()}",
            "name": f"ICHSE {r['interface_name']} ({r['func_name']})",
            "slug": f"ichse-{r['interface_id'].lower()}",
            "listen_path": listen_path,
            "target_url": TARGET_URL,
            "strip_listen_path": False,
            "use_keyless": True,
            "active": True,
            "proxy": {
                "target_url": TARGET_URL,
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

        # ── 1. Tyk apps dir: runtime config ──
        tyk_filename = f"ichse-{r['interface_id'].lower()}.json"
        tyk_filepath = os.path.join(TYKE_APPS_DIR, tyk_filename)
        with open(tyk_filepath, "w") as f:
            json.dump(api_def, f, indent=2, ensure_ascii=False)

        # ── 2. api-definitions: source of truth ──
        domain = r["biz_domain"].lower()
        domain_dir = os.path.join(API_DEF_DIR, domain)
        os.makedirs(domain_dir, exist_ok=True)
        def_filename = f"{r['interface_id']}.json"
        def_filepath = os.path.join(domain_dir, def_filename)
        with open(def_filepath, "w") as f:
            json.dump(api_def, f, indent=2, ensure_ascii=False)

        count += 1
        print(f"  {tyk_filename}  →  {listen_path}")

    print(f"\nGenerated {count} Tyk API configs:")
    print(f"  Tyk runtime: {TYKE_APPS_DIR}/")
    print(f"  Source:      {API_DEF_DIR}/{{biz_domain}}/")


if __name__ == "__main__":
    asyncio.run(main())
