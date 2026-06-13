"""
SQLite → PG: 导入 36 个接口定义 + 参数字段
v2.0: interface_id 使用 LAB-NX-* 格式，biz_domain = 'LAB'
"""
import sqlite3
import re
import asyncio
import asyncpg
import os

SQLITE_PATH = os.path.expanduser(
    "/Users/phoenix/文库/D盘/2026-工作/20260604-南雄-检验中心-菜单及页面/检验中心接口.db"
)
PG_DSN = "postgresql://ichse:ichse_dev@localhost:5433/ichse"
PLATFORM = "NX"
BIZ_DOMAIN = "LAB"

CATEGORY_MAP = {
    "A": "MD",   # 主数据同步
    "B": "SP",   # 标本采集与送检
    "D": "RC",   # 标本接收与登记
    "E": "RP",   # 报告管理
    "F": "CV",   # 危急值管理
    "H": "QC",   # 质控管理
    "I": "EQ",   # 设备管理
    "P": "QR",   # 申请数据查询
}

DATA_FLOW_MAP = {
    "临检中心方": "O",
    "送检方": "I",
    "平台监管": "O",
}


def camel_to_snake(name: str) -> str:
    """getSampleType → get_sample_type"""
    s = re.sub(r"([A-Z])", r"_\1", name)
    return s.strip("_").lower()


def url_to_func_name(url: str) -> str:
    """Extract last path segment and convert to snake_case"""
    if not url:
        return ""
    parts = url.rstrip("/").split("/")
    return camel_to_snake(parts[-1])


def build_interface_id(cat_code: str, data_flow: str, seq: int) -> str:
    """Build interface_id: {BIZ_DOMAIN}-{PLATFORM}-{CATEGORY}-{DIR}{SEQ:03d}"""
    return f"{BIZ_DOMAIN}-{PLATFORM}-{cat_code}-{data_flow}{seq:03d}"


def build_func_name(cat_code: str, biz_id: str, op_name: str) -> str:
    """Build func_name: lab_nx_{cat_code}_{biz_id}_{op_name}"""
    biz_id_lower = biz_id.lower() if biz_id else ''
    return f"lab_nx_{cat_code.lower()}_{biz_id_lower}_{op_name}"


async def main():
    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_conn.row_factory = sqlite3.Row

    pg = await asyncpg.connect(PG_DSN)

    # ── 导入 interfaces ──
    interfaces = sqlite_conn.execute(
        "SELECT * FROM interface_index ORDER BY id"
    ).fetchall()

    seq_counters: dict[tuple[str, str], int] = {}  # key=(cat_code, data_flow) → counter

    for row in interfaces:
        cat_letter = row["biz_category"][0] if row["biz_category"] else "X"
        cat_code = CATEGORY_MAP.get(cat_letter, "XX")
        data_flow = DATA_FLOW_MAP.get(row["direction"], "X")

        key = (cat_code, data_flow)
        seq_counters[key] = seq_counters.get(key, 0) + 1
        interface_id = build_interface_id(cat_code, data_flow, seq_counters[key])

        op_name = url_to_func_name(row['url']) if row['url'] else ''
        biz_id_lower = row['biz_id'].lower() if row['biz_id'] else ''
        func_name = f"lab_nx_{cat_code.lower()}_{biz_id_lower}_{op_name}"

        await pg.execute(
            """
            INSERT INTO biz.interfaces
              (interface_id, platform, biz_domain, biz_category, category_code, biz_id,
               interface_name, func_name, direction, data_flow, http_method, url, description)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (interface_id) DO UPDATE SET
              interface_name = EXCLUDED.interface_name,
              func_name = EXCLUDED.func_name,
              url = EXCLUDED.url
            """,
            interface_id, PLATFORM, BIZ_DOMAIN, row["biz_category"], cat_code, row["biz_id"],
            row["interface_name"], func_name, row["direction"], data_flow,
            row["http_method"], row["url"], row["description"],
        )

    # ── 导入 interface_fields ──
    details = sqlite_conn.execute(
        "SELECT * FROM interface_detail ORDER BY id"
    ).fetchall()

    # Build map: interface_name → PG biz.interfaces.id
    pg_interfaces = await pg.fetch(
        "SELECT id, interface_name, interface_id FROM biz.interfaces"
    )
    name_to_pg_id = {r["interface_name"]: r["id"] for r in pg_interfaces}

    fields_inserted = 0
    for row in details:
        pg_interface_id = name_to_pg_id.get(row["interface_name"])
        if not pg_interface_id:
            continue

        # Build field_path from param_l1..l4
        path_parts = [
            p for p in [row["param_l1"], row["param_l2"], row["param_l3"], row["param_l4"]]
            if p and p.strip()
        ]
        field_path = ".".join(path_parts) if path_parts else None

        await pg.execute(
            """
            INSERT INTO biz.interface_fields
              (interface_id, field_name, field_path, field_type,
               direction, required, description, param_l1, param_l2, param_l3, param_l4)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            """,
            pg_interface_id,
            row["param_name"] or "",
            field_path,
            row["param_type"] or "String",
            "input" if row["param_category"] == "输入参数" else "output",
            row["required"] == "是",
            row["description"] or "",
            row["param_l1"] or "",
            row["param_l2"] or "",
            row["param_l3"] or "",
            row["param_l4"] or "",
        )
        fields_inserted += 1

    sqlite_conn.close()
    await pg.close()

    print(f"Interfaces: {len(interfaces)}")
    print(f"Fields: {fields_inserted}")


if __name__ == "__main__":
    asyncio.run(main())
