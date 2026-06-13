"""
Generate 10+ test payloads per interface and call via Tyk :8080.
UPSERT/INSERT first, then SELECT/UPDATE. Structured payloads per category.
"""
import asyncio, asyncpg, httpx, random, string, json
from datetime import datetime, timedelta
from collections import defaultdict

PG = "postgresql://ichse:ichse_dev@localhost:5433/ichse"
BASE = "http://localhost:8080/api/ygt/mdrs/v1/lis-center"

ORG_CODES = ["ORG001", "ORG002", "ORG003"]
LABS = ["NXLAB01", "NXLAB02"]
DEPT = ["检验科", "生化室", "微生物室", "免疫室"]
DOCTORS = ["张医生", "李医生", "王技师", "赵主任"]
PATIENTS = ["张三", "李四", "王五", "赵六", "陈七", "刘八"]
ITEMS = [("01","血液"),("02","尿液"),("03","血清"),("04","血浆"),("05","脑脊液"),
         ("06","胸水"),("07","腹水"),("08","精液"),("09","粪便"),("10","分泌物")]

rnd = lambda: random.randint(0, 99999)
def rand_str(p="", n=6): return p + "".join(random.choices("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", k=n))
def dt(fmt="%Y-%m-%d"): return (datetime.now() - timedelta(days=random.randint(0,60),
    hours=random.randint(0,23))).strftime(fmt)
def pick(a): return random.choice(a)

# ── Payload templates per category ──

_md_counters = defaultdict(int)

# camelCase key mapping for MD upload dataInfoList items
_MD_KEY_MAP = {
    "sample_type":  ("sampleType", "sampleDescribe"),
    "item_code":    ("itemCode", "itemName"),
    "test_id":      ("testId", "chineseName"),
    "bio_id":       ("bioId", "chineseName"),
    "anti_id":      ("antiId", "chineseName"),
}

def md_upload(item_code_field, item_name_field):
    """MD dictionary upload: one row per call with unique item_code"""
    org = pick(ORG_CODES)
    _md_counters[item_code_field] += 1
    seq = _md_counters[item_code_field]
    it = pick(ITEMS)
    cc_key, cc_name = _MD_KEY_MAP.get(item_code_field, ("sampleType", "sampleDescribe"))
    return {
        "labOrg": org,
        "dataInfoList": [{
            cc_key: f"{it[0]}-{seq:03d}",
            cc_name: f"{it[1]}-{seq:03d}",
            "srm1": rand_str("py", 3), "srm2": rand_str("wb", 3),
        }],
    }

def md_download():
    """MD dictionary download: center_org"""
    return {"centerOrg": pick(ORG_CODES)}

def specimen_upload():
    """Specimen external registration"""
    items = []
    for _ in range(random.randint(1, 3)):
        it = pick(ITEMS)
        items.append({
            "doctAdviseNo": rand_str("BC", 8), "sampleNo": f"SN{rand_str('', 6)}",
            "sampleType": it[0], "sampleDescribe": it[1],
            "patientId": f"PT{rnd()}", "patientName": pick(PATIENTS),
            "sex": random.choice([1, 2, 0]), "birthday": dt("%Y-%m-%d"),
            "section": pick(DEPT), "sectionName": pick(DEPT),
            "diagnostic": f"初步诊断_{rnd()}",
            "requester": pick(DOCTORS), "requestName": pick(DOCTORS), "requestTime": dt("%Y-%m-%d %H:%M:%S"),
            "requestMode": random.choice([1, 2]),
            "executor": pick(DOCTORS), "executorName": pick(DOCTORS), "executeTime": dt("%Y-%m-%d %H:%M:%S"),
        })
    return {
        "packetId": f"PKT{rand_str('', 8)}",
        "sendingOrg": pick(ORG_CODES), "centerOrg": pick(LABS),
        "sender": pick(DOCTORS), "senderName": pick(DOCTORS), "sendDate": dt("%Y-%m-%d %H:%M:%S"),
        "sendFlag": "1",
        "dataInfoList": items,
    }

def specimen_receive():
    """Specimen receive by barcode"""
    return {
        "doctAdviseNo": rand_str("BC", 8), "sendingOrg": pick(ORG_CODES),
        "receiver": pick(DOCTORS), "receiverName": pick(DOCTORS),
        "receiveTime": dt("%Y-%m-%d %H:%M:%S"), "receiveFlag": "1", "status": 1,
    }

def specimen_query():
    """Specimen query"""
    return {"doctAdviseNo": rand_str("BC", 8)}

def report_upload():
    """Upload test report"""
    global _last_report_id
    items = []
    for _ in range(random.randint(1, 4)):
        it = pick(ITEMS)
        items.append({"testId": f"TST{rand_str('', 4)}", "chineseName": it[1],
                       "testResult": f"结果_{rnd()}", "unit": random.choice(["g/L","mmol/L","%"]),
                       "refRange": f"0-{random.randint(10,100)}", "sampleNo": f"SN{rand_str('', 6)}"})
    _last_report_id = f"RPT{rand_str('', 8)}"
    return {
        "reportId": _last_report_id, "doctAdviseNo": rand_str("BC", 8),
        "sampleNo": f"SN{rand_str('', 6)}",
        "labOrg": pick(LABS), "patientId": f"PT{rnd()}", "patientName": pick(PATIENTS),
        "sex": random.choice([1, 2, 0]), "birthday": dt("%Y-%m-%d"),
        "section": pick(DEPT), "sectionName": pick(DEPT),
        "checker": pick(DOCTORS), "checkerName": pick(DOCTORS),
        "checkTime": dt("%Y-%m-%d %H:%M:%S"),
        "receiver": pick(DOCTORS), "receiverName": pick(DOCTORS), "receiveTime": dt("%Y-%m-%d %H:%M:%S"),
        "resultInfoList": items,
    }

def report_query():
    return {"doctAdviseNo": rand_str("BC", 8), "reportStatus": "submitted"}

# Track last report_id so image upload can reference it
_last_report_id = None

def image_upload():
    global _last_report_id
    rid = _last_report_id if _last_report_id else f"RPT{rand_str('', 4)}"
    return {"reportId": rid,
            "labOrg": pick(LABS), "doctAdviseNo": rand_str("BC", 8),
            "reportType": 1, "picNo": random.randint(1, 5),
            "imageInfoList": [{"sampleNo": f"SN{rand_str('', 6)}",
                               "imageText": f"BASE64_IMG_{rand_str('', 12)}",
                               "format": "jpg"}]}

def image_query():
    return {"reportId": _last_report_id if _last_report_id else f"RPT{rand_str('', 4)}"}

def warn_upload():
    return {
        "dataInfoList": [{
            "doctAdviseNo": rand_str("BC", 8), "labOrg": pick(LABS),
            "sampleNo": f"SN{rand_str('', 6)}",
            "patientId": f"PT{rnd()}", "patientName": pick(PATIENTS),
            "sex": random.choice([1, 2, 0]), "birthday": dt("%Y-%m-%d"),
            "executor": pick(DOCTORS), "executorName": pick(DOCTORS),
            "executeDate": dt("%Y-%m-%d %H:%M:%S"),
            "section": pick(DEPT), "sectionName": pick(DEPT),
            "warnLogList": [{
                "warnInfo": f"危急值内容_{rnd()}", "testId": f"TST{rand_str('', 4)}",
                "testName": pick(ITEMS)[1], "testResult": f"异常值_{rnd()}",
            }],
        }],
    }

def warn_query():
    return {"doctAdviseNo": rand_str("BC", 8), "warnType": random.choice(["high","low"])}

def warn_update():
    return {
        "doctAdviseNo": rand_str("DC", 4), "sampleNo": f"SN{rand_str('', 6)}",
        "testId": f"TST{rand_str('', 4)}",
        "receiver": pick(DOCTORS), "receiveDate": dt("%Y-%m-%d %H:%M:%S"),
        "receiveNote": f"反馈备注_{rnd()}",
    }

def qc_upload():
    return {
        "labOrg": pick(LABS), "qcType": random.choice(["indoor","outdoor"]),
        "qcDate": dt(), "instrumentCode": f"INS{rand_str('', 4)}",
        "testItemCode": random.choice(["GLU","ALT","AST","UREA","CRE"]),
        "qcValue": round(random.uniform(0, 200), 2),
        "qcTarget": round(random.uniform(0, 200), 2),
        "qcSd": round(random.uniform(0, 10), 2),
    }

def qc_query():
    return {"labOrg": pick(LABS), "qcType": random.choice(["indoor","outdoor"])}

def device_upload():
    return {"labOrg": pick(LABS), "deviceCode": rand_str("DEV", 8),
            "deviceName": random.choice(["全自动生化分析仪","血球分析仪","尿液分析仪",
                                        "化学发光仪","PCR仪"]),
            "model": f"型号{rand_str('', 4)}", "sn": f"SN{rand_str('', 8)}",
            "manufacturer": random.choice(["迈瑞","贝克曼","罗氏","西门子"])}

def device_query():
    return {"labOrg": pick(LABS)}

def app_submit():
    return {"applicationId": f"APP{rand_str('', 8)}",
            "sendingOrg": pick(ORG_CODES),
            "patientName": pick(PATIENTS), "sex": str(random.choice([1, 2, 0])),
            "age": str(random.randint(1, 90)), "patientId": f"PT{rnd()}",
            "sectionName": pick(DEPT),
            "requestMode": str(random.choice([1, 2])), "requester": pick(DOCTORS),
            "requestTime": dt("%Y-%m-%d %H:%M:%S"),
            "sendFlag": 1,
            "itemInfoList": [{"itemCode": random.choice(["GLU","ALT","AST"]),
                            "itemName": random.choice(["血糖","谷丙","谷草"])}]}

def app_query():
    return {"sendingOrg": pick(ORG_CODES), "status": "submitted"}

def cancel_report():
    return {"doctAdviseNo": rand_str("BC", 8), "reportId": f"RPT{rand_str('', 6)}", "barcode": rand_str("BC", 8)}

def report_flag():
    return {"reportId": f"RPT{rand_str('', 6)}", "labReportUrl": f"https://rpt.ichse.test/{rand_str('',6)}.pdf"}

# ── Interface → template mapping (callables, called fresh each round) ──
TEMPLATES = {
    "LAB-NX-MD-O001": ("MD upload lab_sample_types", lambda: md_upload("sample_type", "sample_describe")),
    "LAB-NX-MD-O002": ("MD upload lab_request_items", lambda: md_upload("item_code", "item_name")),
    "LAB-NX-MD-O003": ("MD upload lab_test_items", lambda: md_upload("test_id", "test_name")),
    "LAB-NX-MD-O004": ("MD upload lab_bio_items", lambda: md_upload("bio_id", "bio_name")),
    "LAB-NX-MD-O005": ("MD upload lab_anti_items", lambda: md_upload("anti_id", "anti_name")),
    "LAB-NX-MD-I001": ("MD download lab_sample_types", md_download),
    "LAB-NX-MD-I002": ("MD download lab_request_items", md_download),
    "LAB-NX-MD-I003": ("MD download lab_test_items", md_download),
    "LAB-NX-MD-I004": ("MD download lab_bio_items", md_download),
    "LAB-NX-MD-I005": ("MD download lab_anti_items", md_download),
    "LAB-NX-SP-I001": ("SP specimen external", specimen_upload),
    "LAB-NX-RC-O001": ("RC get by barcode", specimen_query),
    "LAB-NX-RC-O002": ("RC receive specimen", specimen_receive),
    "LAB-NX-RC-I001": ("RC receive status", specimen_query),
    "LAB-NX-RC-I002": ("RC unqualified", specimen_query),
    "LAB-NX-RP-O001": ("RP submit report", report_upload),
    "LAB-NX-RP-O002": ("RP upload image", image_upload),
    "LAB-NX-RP-O003": ("RP cancel check", cancel_report),
    "LAB-NX-RP-I001": ("RP get report", report_query),
    "LAB-NX-RP-I002": ("RP get image", image_query),
    "LAB-NX-RP-I003": ("RP update flag", report_flag),
    "LAB-NX-RP-I004": ("RP get canceled", report_query),
    "LAB-NX-CV-O001": ("CV upload warn", warn_upload),
    "LAB-NX-CV-O002": ("CV get feedback", warn_query),
    "LAB-NX-CV-I001": ("CV get warn", warn_query),
    "LAB-NX-CV-I002": ("CV update feedback", warn_update),
    "LAB-NX-QC-I001": ("QC upload (hospital)", qc_upload),
    "LAB-NX-QC-O001": ("QC upload (center)", qc_upload),
    "LAB-NX-QC-O002": ("QC query", qc_query),
    "LAB-NX-QC-O003": ("QC stats", qc_query),
    "LAB-NX-QC-O004": ("QC eqa", qc_query),
    "LAB-NX-EQ-I001": ("EQ upload (hospital)", device_upload),
    "LAB-NX-EQ-O001": ("EQ upload (center)", device_upload),
    "LAB-NX-EQ-O002": ("EQ query", device_query),
    "LAB-NX-QR-I001": ("QR app list", app_query),
    "LAB-NX-QR-I002": ("QR submit app", app_submit),
}


async def main():
    pg = await asyncpg.connect(PG)

    # Load URL paths
    paths = {}
    rows = await pg.fetch(
        "SELECT interface_id, url, target_op FROM biz.interfaces WHERE is_valid = true"
    )
    for r in rows:
        parts = r["url"].rstrip("/").split("/")
        if len(parts) >= 2:
            paths[r["interface_id"]] = {
                "path": f"{parts[-2]}/{parts[-1]}", "op": r["target_op"]
            }

    results = {"ok": 0, "fail": 0, "skip": 0}

    # ── Phase 1: UPSERT / INSERT ──
    print("=" * 60)
    print("PHASE 1: UPSERT / INSERT (10 each)")
    print("=" * 60)
    for iface_id, (label, _) in sorted(TEMPLATES.items()):
        p = paths.get(iface_id)
        if not p or p["op"] not in ("UPSERT", "INSERT"):
            results["skip"] += 1; continue
        gen = TEMPLATES[iface_id][1]
        print(f"\n[{iface_id}] {label}")
        ok_count = 0
        for i in range(10):
            payload = gen()
            url = f"{BASE}/{p['path']}"
            try:
                async with httpx.AsyncClient() as c:
                    resp = await c.post(url, json=payload, timeout=30)
                if resp.status_code in (200, 201):
                    ok_count += 1; results["ok"] += 1
                    if i == 0: print(f"  ✓ r{i+1}: {resp.status_code}", end="", flush=True)
                else:
                    results["fail"] += 1
                    if i < 3: print(f"\n  ✗ r{i+1}: {resp.status_code} {resp.text[:100]}")
            except Exception as e:
                results["fail"] += 1
                if i < 3: print(f"\n  ✗ r{i+1}: {e}")
        print(f" → {ok_count}/10")

    # ── Phase 2: SELECT ──
    print("\n" + "=" * 60)
    print("PHASE 2: SELECT (10 each)")
    print("=" * 60)
    for iface_id, (label, _) in sorted(TEMPLATES.items()):
        p = paths.get(iface_id)
        if not p or p["op"] != "SELECT":
            continue
        gen = TEMPLATES[iface_id][1]
        print(f"\n[{iface_id}] {label}")
        ok_count = 0
        for i in range(10):
            payload = gen()
            url = f"{BASE}/{p['path']}"
            try:
                async with httpx.AsyncClient() as c:
                    resp = await c.post(url, json=payload, timeout=30)
                if resp.status_code == 200:
                    ok_count += 1; results["ok"] += 1
                    if i == 0:
                        data = resp.json()
                        cnt = len(data) if isinstance(data, list) else (1 if data else 0)
                        print(f"  ✓ r{i+1}: {resp.status_code} — {cnt} rows", end="", flush=True)
                else:
                    results["fail"] += 1
                    if i < 3: print(f"\n  ✗ r{i+1}: {resp.status_code} {resp.text[:100]}")
            except Exception as e:
                results["fail"] += 1
                if i < 3: print(f"\n  ✗ r{i+1}: {e}")
        print(f" → {ok_count}/10")

    # ── Phase 3: UPDATE ──
    print("\n" + "=" * 60)
    print("PHASE 3: UPDATE (10 each)")
    print("=" * 60)
    for iface_id, (label, _) in sorted(TEMPLATES.items()):
        p = paths.get(iface_id)
        if not p or p["op"] != "UPDATE":
            continue
        gen = TEMPLATES[iface_id][1]
        print(f"\n[{iface_id}] {label}")
        ok_count = 0
        for i in range(10):
            payload = gen()
            url = f"{BASE}/{p['path']}"
            try:
                async with httpx.AsyncClient() as c:
                    resp = await c.post(url, json=payload, timeout=30)
                if resp.status_code in (200, 201, 204):
                    ok_count += 1; results["ok"] += 1
                    if i == 0: print(f"  ✓ r{i+1}: {resp.status_code}", end="", flush=True)
                else:
                    results["fail"] += 1
                    if i < 3: print(f"\n  ✗ r{i+1}: {resp.status_code} {resp.text[:100]}")
            except Exception as e:
                results["fail"] += 1
                if i < 3: print(f"\n  ✗ r{i+1}: {e}")
        print(f" → {ok_count}/10")

    # ── Summary ──
    print("\n" + "=" * 60)
    total = results["ok"] + results["fail"]
    print(f"TOTAL: {results['ok']} ok / {results['fail']} fail / {results['skip']} skip")
    print(f"Interfaces with templates: {len(TEMPLATES)} / 36")
    print("=" * 60)

    # Data counts
    print("\n=== PG data summary ===")
    for tbl in ["lab_sample_types","lab_request_items","lab_test_items","lab_bio_items","lab_anti_items",
                "lab_specimens","lab_test_reports","lab_report_images","lab_sample_warnings",
                "lab_qc_data","lab_device_info","lab_applications"]:
        cnt = await pg.fetchval(f"SELECT COUNT(*) FROM biz.{tbl} WHERE is_valid = true")
        print(f"  biz.{tbl}: {cnt} rows")

    await pg.close()

if __name__ == "__main__":
    asyncio.run(main())
