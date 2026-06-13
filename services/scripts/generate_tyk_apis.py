"""
Generate one Tyk API JSON file per interface in biz.interfaces.

v2.0: Uses LAB-NX-* interface_id format from biz.interfaces.
listen_path: /api/ygt/mdrs/v1/lis-center/{direction_slug}/{operation}
target_url:  http://host.docker.internal:8000
"""
import asyncio
import asyncpg
import json
import os

PG_DSN = "postgresql://ichse:ichse_dev@localhost:5433/ichse"
APPS_DIR = os.path.expanduser(
    "/Users/phoenix/Hermes/git-tyk/tyk-gateway-docker/apps"
)

TARGET_URL = "http://host.docker.internal:8000"


def url_to_slug(url: str) -> tuple[str, str]:
    """Extract direction_slug and operation from original URL"""
    parts = url.rstrip("/").split("/")
    # /api/ygt/mdrs/v1/lis/centerljzx/uploadSampleType
    #  0   1   2    3   4   5       6
    operation = parts[-1] if len(parts) > 0 else ""
    direction_slug = parts[-2] if len(parts) > 1 else ""
    return direction_slug, operation


async def main():
    pg = await asyncpg.connect(PG_DSN)
    rows = await pg.fetch(
        "SELECT interface_id, func_name, interface_name, direction, url, category_code, data_flow "
        "FROM biz.interfaces WHERE is_valid = true ORDER BY id"
    )
    await pg.close()

    # Remove old ichse API files
    for f in os.listdir(APPS_DIR):
        if f.startswith("ichse-"):
            os.remove(os.path.join(APPS_DIR, f))

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

        filename = f"ichse-{r['interface_id'].lower()}.json"
        filepath = os.path.join(APPS_DIR, filename)
        with open(filepath, "w") as f:
            json.dump(api_def, f, indent=2, ensure_ascii=False)
        count += 1
        print(f"  {filename}  →  {listen_path}")

    print(f"\nGenerated {count} Tyk API configs in {APPS_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
