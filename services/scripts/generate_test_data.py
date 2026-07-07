"""
Generate realistic test data covering ALL columns of ALL 22 lab tables.
Sends requests through Tyk :8080 → services :8000 → PG functions.

Usage:
  cd services && source venv/bin/activate
  python scripts/generate_test_data.py
"""
import asyncio, asyncpg, httpx, os, random, string, json
from datetime import datetime, timedelta
from collections import defaultdict

PG = os.getenv("PG_DSN", "postgresql://ichse:change_me@localhost:5433/ichse")
BASE = os.getenv("TYK_ORIGIN", "http://localhost:8080") + "/api/demo/mdrs/v1/lis-center"

# ── Data pools ──────────────────────────────────────────────

ORG_CODES  = ["ORG001", "ORG002", "ORG003"]
LABS       = ["DEMOLAB01", "DEMOLAB02"]
DEPT_CODES = ["JYK", "SHK", "WSWS", "MYSH"]
DEPT_NAMES = ["检验科", "生化室", "微生物室", "免疫室"]
DOCTORS    = ["张建国", "李明华", "王秀英", "赵志强", "陈伟", "刘芳"]
PATIENTS   = ["张三", "李四", "王五", "赵六", "陈静", "刘洋", "周明", "吴芳"]

SAMPLE_TYPES = [
    ("01","血液"),("02","尿液"),("03","血清"),("04","血浆"),
    ("05","脑脊液"),("06","胸水"),("07","腹水"),("08","精液"),
    ("09","粪便"),("10","分泌物"),("11","穿刺液"),("12","痰液"),
]
TEST_ITEMS = [
    ("GLU","血糖","mmol/L","3.9-6.1","3.6","6.3"),
    ("ALT","谷丙转氨酶","U/L","0-40","0","45"),
    ("AST","谷草转氨酶","U/L","0-40","0","42"),
    ("UREA","尿素","mmol/L","2.9-8.2","2.5","8.5"),
    ("CRE","肌酐","umol/L","44-133","40","140"),
    ("UA","尿酸","umol/L","150-440","140","450"),
    ("WBC","白细胞","10^9/L","3.5-9.5","3.0","10.0"),
    ("RBC","红细胞","10^12/L","4.3-5.8","4.0","6.0"),
    ("HGB","血红蛋白","g/L","130-175","120","180"),
    ("PLT","血小板","10^9/L","125-350","100","380"),
]
ANTI_DRUGS = [
    ("AMK","阿米卡星"),("GEN","庆大霉素"),("CIP","环丙沙星"),
    ("LVX","左氧氟沙星"),("CTX","头孢噻肟"),("CAZ","头孢他啶"),
    ("IPM","亚胺培南"),("MEM","美洛培南"),("PIP","哌拉西林"),
]
BIO_SPECIES = [
    ("ECO","大肠埃希菌"),("KPN","肺炎克雷伯菌"),("SAU","金黄色葡萄球菌"),
    ("PAE","铜绿假单胞菌"),("EFA","粪肠球菌"),("ABA","鲍曼不动杆菌"),
]
DIAGNOSES = [
    "2型糖尿病","高血压病2级","冠状动脉粥样硬化性心脏病",
    "慢性阻塞性肺疾病","脑梗死恢复期","慢性肾功能不全",
    "肺部感染","急性阑尾炎","上消化道出血",
]
WARD_CODES = ["BQ01","BQ02","BQ03"]
WARD_NAMES = ["内一科","内二科","外一科"]

rnd_int  = lambda lo,hi: random.randint(lo, hi)
rnd_num  = lambda lo,hi: round(random.uniform(lo, hi), 2)
rnd_str  = lambda p="",n=6: p + "".join(random.choices(string.ascii_uppercase + string.digits, k=n))
rnd_date = lambda days_back=60: (datetime.now() - timedelta(days=random.randint(0, days_back))).strftime("%Y-%m-%d")
rnd_dt   = lambda days_back=60: (datetime.now() - timedelta(days=random.randint(0, days_back), hours=random.randint(0,23), minutes=random.randint(0,59))).strftime("%Y-%m-%d %H:%M:%S")
pick     = random.choice
pick_n   = lambda lst, n=1: random.sample(lst, min(n, len(lst)))

# ── Counters for unique IDs ──────────────────────────────────
_md_counters = defaultdict(int)
_bc_counter  = 0
_rpt_counter = 0
_last_rpt_id = None
_pkt_counter = 0
_warn_counter = 0
_app_counter = 0

def next_barcode():
    global _bc_counter; _bc_counter += 1
    return f"BC{datetime.now().strftime('%m%d%H')}{_bc_counter:06d}"

def next_report_id():
    global _rpt_counter; _rpt_counter += 1
    return f"RPT{datetime.now().strftime('%m%d%H')}{_rpt_counter:06d}"

def next_packet_id():
    global _pkt_counter; _pkt_counter += 1
    return f"PKT{datetime.now().strftime('%m%d%H%M')}{_pkt_counter:04d}"

# ── Payload builders ─────────────────────────────────────────

def md_upload(item_code_field, item_name_field):
    """MD dictionary upload with all columns."""
    org = pick(ORG_CODES)
    _md_counters[item_code_field] += 1
    seq = _md_counters[item_code_field]
    st = pick(SAMPLE_TYPES)

    cc_key, cc_name = {
        "sample_type": ("sampleType","sampleDescribe"),
        "item_code": ("itemCode","itemName"),
        "test_id": ("testId","chineseName"),
        "bio_id": ("bioId","chineseName"),
        "anti_id": ("antiId","chineseName"),
    }.get(item_code_field, ("sampleType","sampleDescribe"))

    item = {cc_key: f"{st[0]}-{seq:03d}", cc_name: f"{st[1]}-{seq:03d}"}
    item["srm1"] = rnd_str("py", 4)
    item["srm2"] = rnd_str("wb", 4)

    if item_code_field == "sample_type":
        pass  # sample_types: sampleType, sampleDescribe, srm1, srm2
    elif item_code_field == "item_code":
        item["itemPrice"] = rnd_num(5, 500)
        item["usedNow"] = 1
        item["sampleType"] = st[0]
        item["sampleDescribe"] = st[1]
        item["composeType"] = str(random.choice([1, 2, 3]))
    elif item_code_field == "test_id":
        ti = pick(TEST_ITEMS)
        item["englishAb"] = ti[0]
        item["englishName"] = f"{ti[0]} Test"
        item["methodName"] = random.choice(["速率法","终点法","免疫比浊法","电极法"])
        item["sampleType"] = st[0]
        item["sampleDescribe"] = st[1]
        item["unit"] = ti[2]
    elif item_code_field == "bio_id":
        bs = pick(BIO_SPECIES)
        item["bioId"] = bs[0]
        item["fabioId"] = f"F{bs[0]}"
        item["fabioName"] = f"{bs[1]}属"
        item["englishName"] = bs[1]
        item["englishAb"] = bs[0]
        item["bioType"] = random.choice([1, 2, 3, 4])
    elif item_code_field == "anti_id":
        ad = pick(ANTI_DRUGS)
        item["antiId"] = ad[0]
        item["faantiId"] = f"F{ad[0]}"
        item["faantiName"] = f"{ad[1]}类"
        item["englishName"] = ad[1]
        item["englishAb"] = ad[0]

    return {"labOrg": org, "dataInfoList": [item]}

def md_download():
    return {"centerOrg": pick(ORG_CODES)}

def specimen_upload():
    """B02: Specimen upload — L1 lab_specimens + L2 lab_specimen_items + L3 barcode_items.

    All 55 columns of lab_specimen_items covered.
    """
    items = []
    for _ in range(random.randint(2, 4)):
        bc = next_barcode()
        st = pick(SAMPLE_TYPES)
        pt = pick(PATIENTS)
        dept = pick(DEPT_CODES)
        dept_name = pick(DEPT_NAMES)

        # L2: specimen item
        si = {
            "doctAdviseNo": bc, "oldBarcode": rnd_str("OLD", 6) if random.random() < 0.2 else "",
            "sampleNo": f"SN{rnd_str('', 6)}",
            "sampleType": st[0], "sampleDescribe": st[1],
            "toponymy": random.choice(["左肘静脉","右肘静脉","指尖","桡动脉","颈静脉","—"]),
            "examinaim": f"{pick(TEST_ITEMS)[1]}检测",
            "notes": random.choice(["","标本轻微溶血","采集量不足",""]),
            "fg_entrustcollect": random.choice([0, 0, 0, 1]),
            # pt_
            "patientName": pt, "sex": random.choice([1, 2]),
            "age": rnd_int(1, 90), "ageUnit": random.choice([1, 2, 3]),
            "birthday": rnd_date(365*80),
            "patientId": f"PT{rnd_int(1,99999):05d}",
            "idCard": f"{rnd_int(110000,659999)}19{rnd_int(0,99):02d}{rnd_int(1,28):02d}{rnd_int(1000,9999)}",
            "patientPhone": f"1{rnd_int(30,99)}{rnd_int(10000000,99999999)}",
            "patientType": random.choice([1, 2, 3]),
            "patientProperties": random.choice(["医保","自费","公费",""]),
            "diagnostic": pick(DIAGNOSES),
            "infantFlag": 1 if random.random() < 0.05 else 0,
            "sourcePatientId": f"ZY{rnd_int(100000,999999)}" if random.random() < 0.5 else "",
            "visitId": f"V{rnd_int(10000,99999)}",
            "bedNo": f"{rnd_int(1,50)}" if random.random() < 0.6 else "",
            "wardCode": pick(WARD_CODES) if random.random() < 0.5 else "",
            "wardName": pick(WARD_NAMES) if random.random() < 0.5 else "",
            # req_
            "requester": pick(DOCTORS), "requestName": pick(DOCTORS),
            "requestTime": rnd_dt(30),
            "section": dept, "sectionName": dept_name,
            "requestMode": random.choice([1, 2]),
            "wardCode": pick(WARD_CODES) if random.random() < 0.5 else "",
            "wardName": pick(WARD_NAMES) if random.random() < 0.5 else "",
            # col_
            "executor": pick(DOCTORS), "executorName": pick(DOCTORS),
            "executeTime": rnd_dt(10),
            "collectingOrgCode": pick(ORG_CODES) if random.random() < 0.3 else "",
            "collectingOrgName": f"采集点{rnd_int(1,5)}" if random.random() < 0.3 else "",
        }

        # L3: barcode billing items
        bill_items = []
        if random.random() < 0.5:
            for _ in range(random.randint(1, 3)):
                ti = pick(TEST_ITEMS)
                bill_items.append({
                    "doctAdviseNo": bc,
                    "sendingOrg": pick(ORG_CODES),
                    "itemCode": f"X{rnd_str('', 3)}",
                    "childItemCode": f"X{rnd_str('', 3)}",
                    "costPrice": rnd_num(10, 300),
                    "costNumber": rnd_int(1, 5),
                    "costName": f"{ti[1]}检测费",
                    "childItemName": f"{ti[1]}单项费",
                })
        if bill_items:
            si["barcodeDetailList"] = bill_items

        items.append(si)

    return {
        "packetId": next_packet_id(),
        "sendingOrg": pick(ORG_CODES), "centerOrg": pick(LABS),
        "sender": pick(DOCTORS), "senderName": pick(DOCTORS),
        "sendDate": rnd_dt(10), "sendFlag": "1",
        "collectingOrgCode": pick(ORG_CODES), "collectingOrgName": f"采集点{rnd_int(1,5)}",
        "dataInfoList": items,
    }


def report_upload():
    """E01: Report upload — 1 main + 4 detail tables."""
    global _last_rpt_id
    bc = next_barcode()
    rid = next_report_id()
    _last_rpt_id = rid
    st = pick(SAMPLE_TYPES)
    pt = pick(PATIENTS)
    dept = pick(DEPT_CODES)
    dept_name = pick(DEPT_NAMES)
    chk_doc = pick(DOCTORS)
    chk_doc2 = pick(DOCTORS) if random.random() < 0.3 else ""
    rec_doc = pick(DOCTORS)

    # resultInfoList (常规结果)
    result_items = []
    picked_tests = pick_n(TEST_ITEMS, random.randint(3, 8))
    for ti in picked_tests:
        val = rnd_num(float(ti[4])*0.9 if ti[4] else 0.5, float(ti[5])*1.1 if ti[5] else 10)
        abnormal = val < float(ti[4])*0.8 or val > float(ti[5])*1.2 if ti[4] and ti[5] else False
        result_items.append({
            "sampleNo": f"SN{rnd_str('', 6)}",
            "testId": ti[0],
            "hosTestId": f"H{ti[0]}",
            "chineseName": ti[1],
            "testResult": f"{val:.1f}",
            "refRange": ti[3],
            "refLo": ti[4], "refHi": ti[5],
            "measureTime": rnd_dt(10),
            "hint": "↑" if abnormal and val > float(ti[5]) else ("↓" if abnormal else ""),
            "unit": ti[2],
        })

    # plantInfoList (培养结果)
    plant_items = []
    if random.random() < 0.3:
        for _ in range(random.randint(1, 2)):
            plant_items.append({
                "sampleNo": f"SN{rnd_str('', 6)}",
                "testId": f"P{random.choice(['A','B','C'])}{rnd_int(1,99):03d}",
                "hosTestId": f"HP{rnd_str('', 4)}",
                "chineseName": random.choice(["一般细菌培养","厌氧菌培养","真菌培养"]),
                "testResult": random.choice(["阴性","阳性","正常菌群生长"]),
                "resultType": random.choice([1, 2]),
                "plantType": random.choice([1, 2, 3]),
                "plantRemark": random.choice(["","48h无菌生长","疑似污染"]),
            })

    # antiInfoList (药敏结果)
    anti_items = []
    if random.random() < 0.4:
        for _ in range(random.randint(2, 5)):
            ad = pick(ANTI_DRUGS)
            bs = pick(BIO_SPECIES)
            anti_items.append({
                "sampleNo": f"SN{rnd_str('', 6)}",
                "antiId": ad[0], "antiName": ad[1],
                "bioId": bs[0], "bioName": bs[1],
                "bioType": random.choice([1, 2, 3]),
                "kbResult": f"{rnd_int(6, 35)}mm",
                "micResult": random.choice(["<=1","2","4","8",">=16"]),
                "etestResult": random.choice(["0.5","1","2","4"]),
                "testResult": random.choice(["S","I","R"]),
                "method": random.choice([1, 2, 3]),
                "printOrd": rnd_int(1, 20),
            })

    # bioInfoList (细菌结果)
    bio_items = []
    if random.random() < 0.4:
        for _ in range(random.randint(1, 2)):
            bs = pick(BIO_SPECIES)
            bio_items.append({
                "sampleNo": f"SN{rnd_str('', 6)}",
                "bioId": bs[0], "bioName": bs[1],
                "bioType": random.choice([1, 2, 3, 4]),
                "bioQuantity": random.choice(["少量","中量","大量","++","+++"]),
                "spectrum": random.choice(["","敏感：碳青霉烯类","耐药：青霉素类"]),
                "measureTime": rnd_dt(10),
                "remark": random.choice(["","镜检见G-杆菌","建议复查"]),
            })

    return {
        "reportId": rid,
        "doctAdviseNo": bc, "sampleNo": f"SN{rnd_str('', 6)}",
        "sampleType": st[0], "sampleDescribe": st[1],
        "labOrg": pick(LABS), "sendingOrg": pick(ORG_CODES), "sendingOrgName": f"送检机构{rnd_int(1,5)}",
        # pt_
        "patientName": pt, "sex": random.choice([1, 2]),
        "age": rnd_int(1, 90), "ageUnit": random.choice([1, 2, 3]),
        "birthday": rnd_date(365*80), "patientId": f"PT{rnd_int(1,99999):05d}",
        "medicalcardId": f"MC{rnd_str('', 8)}",
        "patientProperties": random.choice(["医保","自费"]),
        "patientType": random.choice([1, 2, 3]),
        "diagnostic": pick(DIAGNOSES), "diagnosticCode": f"D{rnd_int(1,99):03d}",
        "toponymy": random.choice(["左肘静脉","指尖","—"]),
        # req_
        "section": dept, "sectionName": dept_name,
        "requestMode": random.choice([1, 2]),
        "examinaim": f"{pick(TEST_ITEMS)[1]}等{rnd_int(3,8)}项",
        "examinaimCode": f"EX{rnd_str('', 3)}",
        # chk_
        "checker": chk_doc, "checkerName": chk_doc,
        "checker2": chk_doc2, "checker2Name": chk_doc2,
        "checkTime": rnd_dt(5),
        "checkerOpinion": random.choice(["","结果已审核","建议复查肝功",""]),
        # rec_
        "receiver": rec_doc, "receiverName": rec_doc,
        "receiveTime": rnd_dt(10),
        # cnc_
        "concessionFlag": 1 if random.random() < 0.1 else 0,
        "concessionReason": "标本量不足" if random.random() < 0.1 else "",
        "resultInfoList": result_items,
        "plantInfoList": plant_items,
        "antiInfoList": anti_items,
        "bioInfoList": bio_items,
    }


def image_upload():
    """E02: Image upload — lab_report_images."""
    global _last_rpt_id
    rid = _last_rpt_id if _last_rpt_id else f"RPT{rnd_str('', 8)}"
    return {
        "reportId": rid,
        "labOrg": pick(LABS), "doctAdviseNo": f"BC{rnd_int(1, _bc_counter):08d}",
        "reportType": 1, "picNo": rnd_int(1, 5),
        "imageInfoList": [{
            "sampleNo": f"SN{rnd_str('', 6)}",
            "imageText": f"BASE64_IMG_DATA_{rnd_str('', 20)}",
            "format": random.choice(["jpg","png","pdf"]),
            "imageUrl": f"https://img.ichse.test/{rnd_str('', 12)}.jpg",
        } for _ in range(random.randint(1, 3))],
    }


def specimen_receive():
    """D02: Receive specimen."""
    bc = f"BC{rnd_int(1, max(1, _bc_counter)):08d}" if _bc_counter > 0 else next_barcode()
    return {
        "doctAdviseNo": bc, "sendingOrg": pick(ORG_CODES),
        "labOrg": pick(LABS),
        "receiver": pick(DOCTORS), "receiverName": pick(DOCTORS),
        "receiveTime": rnd_dt(5), "receiveFlag": str(random.choice([1,2])),
        "status": random.choice([1, 2, 3]),
        "reason": random.choice(["","标本量不足","条码污损",""]) if random.random() < 0.2 else "",
    }


def specimen_query():
    return {"doctAdviseNo": f"BC{rnd_int(1, max(1, _bc_counter)):08d}"}


def report_query():
    return {"doctAdviseNo": f"BC{rnd_int(1, max(1, _bc_counter)):08d}", "reportStatus": "submitted"}


def image_query():
    global _last_rpt_id
    return {"reportId": _last_rpt_id if _last_rpt_id else f"RPT{rnd_str('', 8)}"}


def warn_upload():
    """F01: Warning upload — lab_sample_warnings + lab_warn_log_items."""
    bc = f"BC{rnd_int(1, max(1, _bc_counter)):08d}" if _bc_counter > 0 else next_barcode()
    pt = pick(PATIENTS)
    chk_doc = pick(DOCTORS)
    return {
        "dataInfoList": [{
            "doctAdviseNo": bc, "labOrg": pick(LABS),
            "sampleNo": f"SN{rnd_str('', 6)}",
            "patientId": f"PT{rnd_int(1,99999):05d}", "patientName": pt,
            "sex": random.choice([1, 2]), "birthday": rnd_date(365*80),
            "executor": chk_doc, "executorName": chk_doc,
            "executeDate": rnd_dt(5),
            "section": pick(DEPT_CODES), "sectionName": pick(DEPT_NAMES),
            "warnLogList": [{
                "warnInfo": f"危急值: {pick(TEST_ITEMS)[1]} {rnd_num(0.01, 999):.1f}",
                "testId": pick(TEST_ITEMS)[0],
                "testName": pick(TEST_ITEMS)[1],
                "testResult": f"{rnd_num(0.01, 999):.1f}",
            } for _ in range(random.randint(1, 3))],
        } for _ in range(random.randint(1, 2))],
    }


def warn_query():
    return {"sendingOrg": pick(ORG_CODES), "startDate": rnd_date(30), "endDate": rnd_date(1)}


def warn_update():
    return {
        "doctAdviseNo": f"BC{rnd_int(1, max(1, _bc_counter)):08d}" if _bc_counter > 0 else next_barcode(),
        "sampleNo": f"SN{rnd_str('', 6)}",
        "testId": pick(TEST_ITEMS)[0],
        "reportId": f"RPT{rnd_int(1, max(1, _rpt_counter)):08d}" if _rpt_counter > 0 else f"RPT{rnd_str('', 8)}",
        "receiver": pick(DOCTORS), "receiveDate": rnd_dt(3),
        "receiveNote": random.choice(["","已通知临床医生","已处理",""]),
    }


def qc_upload():
    """H01/H02: QC upload — lab_qc_data."""
    return {
        "labOrg": pick(LABS), "qcType": random.choice(["indoor","outdoor"]),
        "qcDate": rnd_date(30), "instrumentCode": f"INS{rnd_str('', 4)}",
        "testItemCode": pick(TEST_ITEMS)[0],
        "qcValue": rnd_num(0.5, 200),
        "qcTarget": rnd_num(0.5, 200),
        "qcSd": rnd_num(0.1, 15),
    }


def qc_query():
    return {"labOrg": pick(LABS), "qcType": random.choice(["indoor","outdoor"])}


def device_upload():
    """I01/I02: Device upload — lab_device_info."""
    return {
        "labOrg": pick(LABS), "deviceCode": f"DEV{rnd_str('', 6)}",
        "deviceName": random.choice([
            "全自动生化分析仪","血球分析仪","尿液分析仪","化学发光仪",
            "PCR扩增仪","血气分析仪","凝血分析仪","电解质分析仪",
        ]),
        "model": f"型号{rnd_str('', 4)}",
        "sn": f"SN{rnd_str('', 10)}",
        "manufacturer": random.choice(["迈瑞","贝克曼","罗氏","西门子","雅培","希森美康"]),
    }


def device_query():
    return {"labOrg": pick(LABS)}


def app_submit():
    """P02: Application submit — lab_applications + lab_application_items."""
    global _app_counter; _app_counter += 1
    return {
        "applicationId": f"APP{datetime.now().strftime('%m%d%H')}{_app_counter:04d}",
        "sendingOrg": pick(ORG_CODES),
        "doctAdviseNo": f"BC{rnd_int(1, max(1, _bc_counter)):08d}" if _bc_counter > 0 else "",
        "patientName": pick(PATIENTS), "sex": str(random.choice([1, 2])),
        "age": str(rnd_int(1, 90)), "patientId": f"PT{rnd_int(1,99999):05d}",
        "patientPhone": f"1{rnd_int(30,99)}{rnd_int(10000000,99999999)}" if random.random() < 0.8 else "",
        "patientType": str(random.choice([1, 2, 3])),
        "diagnostic": pick(DIAGNOSES) if random.random() < 0.7 else "",
        "bedNo": f"{rnd_int(1,50)}" if random.random() < 0.5 else "",
        "wardName": pick(WARD_NAMES) if random.random() < 0.4 else "",
        "sectionName": pick(DEPT_NAMES),
        "requestMode": str(random.choice([1, 2])),
        "requester": pick(DOCTORS),
        "requestTime": rnd_dt(30),
        "sendFlag": 1,
        "itemInfoList": [{
            "itemCode": ti[0], "itemName": ti[1],
            "composeType": str(random.choice([1, 2, 3])),
            "sampleType": pick(SAMPLE_TYPES)[0],
            "requestMode": str(random.choice([1, 2])),
            "requester": pick(DOCTORS),
            "preparationNote": random.choice(["","空腹采血","晨尿",""]),
        } for ti in pick_n(TEST_ITEMS, random.randint(2, 5))],
    }


def app_query():
    return {"sendingOrg": pick(ORG_CODES), "status": "submitted"}


def cancel_report():
    bc = f"BC{rnd_int(1, max(1, _bc_counter)):08d}" if _bc_counter > 0 else next_barcode()
    pt = pick(PATIENTS)
    return {
        "doctAdviseNo": bc, "sampleNo": f"SN{rnd_str('', 6)}",
        "labOrg": pick(LABS),
        "executor": pick(DOCTORS), "executorName": pick(DOCTORS),
        "executeDate": rnd_dt(5),
        "section": pick(DEPT_CODES), "sectionName": pick(DEPT_NAMES),
        "cancelReason": random.choice(["报告信息有误","标本不合格","重复送检","患者信息不符"]),
    }


def report_flag():
    rid = _last_rpt_id if _last_rpt_id else f"RPT{rnd_str('', 8)}"
    return {"reportId": rid, "labReportUrl": f"https://rpt.ichse.test/{rid}.pdf"}


def cancel_report_query():
    return {"sendingOrg": pick(ORG_CODES), "startDate": rnd_date(30), "endDate": rnd_date(1)}


def specimen_status_query():
    return {"sendingOrg": pick(ORG_CODES), "startDate": rnd_date(30), "endDate": rnd_date(1)}


def unqual_specimen_query():
    return {"sendingOrg": pick(ORG_CODES), "startDate": rnd_date(30), "endDate": rnd_date(1)}


# ── Template mapping ────────────────────────────────────────
# Label format: (category, op) → determines test phase
# op: UPSERT/INSERT → Phase 1, SELECT → Phase 2, UPDATE → Phase 3

TEMPLATES = {
    # MD dictionary uploads
    "LAB-DEMO-MD-O001": ("MD upload sample_types",      lambda: md_upload("sample_type", "sample_describe")),
    "LAB-DEMO-MD-O002": ("MD upload request_items",     lambda: md_upload("item_code", "item_name")),
    "LAB-DEMO-MD-O003": ("MD upload test_items",        lambda: md_upload("test_id", "test_name")),
    "LAB-DEMO-MD-O004": ("MD upload bio_items",         lambda: md_upload("bio_id", "bio_name")),
    "LAB-DEMO-MD-O005": ("MD upload anti_items",        lambda: md_upload("anti_id", "anti_name")),
    # MD dictionary downloads
    "LAB-DEMO-MD-I001": ("MD download sample_types",    md_download),
    "LAB-DEMO-MD-I002": ("MD download request_items",   md_download),
    "LAB-DEMO-MD-I003": ("MD download test_items",      md_download),
    "LAB-DEMO-MD-I004": ("MD download bio_items",       md_download),
    "LAB-DEMO-MD-I005": ("MD download anti_items",      md_download),
    # Specimen
    "LAB-DEMO-SP-I001": ("SP specimen external",        specimen_upload),
    "LAB-DEMO-RC-O001": ("RC get by barcode",           specimen_query),
    "LAB-DEMO-RC-O002": ("RC receive specimen",         specimen_receive),
    "LAB-DEMO-RC-I001": ("RC receive status",           specimen_status_query),
    "LAB-DEMO-RC-I002": ("RC unqualified",              unqual_specimen_query),
    # Reports
    "LAB-DEMO-RP-O001": ("RP submit report",            report_upload),
    "LAB-DEMO-RP-O002": ("RP upload image",             image_upload),
    "LAB-DEMO-RP-O003": ("RP cancel check",             cancel_report),
    "LAB-DEMO-RP-I001": ("RP get report",               report_query),
    "LAB-DEMO-RP-I002": ("RP get image",                image_query),
    "LAB-DEMO-RP-I003": ("RP update flag",              report_flag),
    "LAB-DEMO-RP-I004": ("RP get canceled",             cancel_report_query),
    # Warnings
    "LAB-DEMO-CV-O001": ("CV upload warn",              warn_upload),
    "LAB-DEMO-CV-O002": ("CV get feedback",             warn_query),
    "LAB-DEMO-CV-I001": ("CV get warn",                 warn_query),
    "LAB-DEMO-CV-I002": ("CV update feedback",          warn_update),
    # QC
    "LAB-DEMO-QC-I001": ("QC upload (hospital)",        qc_upload),
    "LAB-DEMO-QC-O001": ("QC upload (center)",          qc_upload),
    "LAB-DEMO-QC-O002": ("QC query",                    qc_query),
    "LAB-DEMO-QC-O003": ("QC stats",                    qc_query),
    "LAB-DEMO-QC-O004": ("QC eqa",                      qc_query),
    # Equipment
    "LAB-DEMO-EQ-I001": ("EQ upload (hospital)",        device_upload),
    "LAB-DEMO-EQ-O001": ("EQ upload (center)",          device_upload),
    "LAB-DEMO-EQ-O002": ("EQ query",                    device_query),
    # Applications
    "LAB-DEMO-QR-I001": ("QR app list",                 app_query),
    "LAB-DEMO-QR-I002": ("QR submit app",               app_submit),
}


# ── Test runner ──────────────────────────────────────────────

async def main():
    pg = await asyncpg.connect(PG)

    # Load URL paths from interfaces table
    paths = {}
    rows = await pg.fetch(
        "SELECT interface_id, url, target_op FROM biz.interfaces WHERE is_valid = true"
    )
    for r in rows:
        parts = r["url"].rstrip("/").split("/")
        if len(parts) >= 2:
            paths[r["interface_id"]] = {
                "path": f"{parts[-2]}/{parts[-1]}",
                "op": r["target_op"],
            }

    results = {"ok": 0, "fail": 0, "skip": 0}

    async def do_phase(label, phase_ops):
        nonlocal results
        print(f"\n{'='*60}")
        print(f"{label}")
        print(f"{'='*60}")
        for iface_id, (desc, gen) in sorted(TEMPLATES.items()):
            p = paths.get(iface_id)
            if not p or p["op"] not in phase_ops:
                results["skip"] += 1; continue
            print(f"\n[{iface_id}] {desc}")
            ok_count = 0
            for i in range(10):
                payload = gen()
                url = f"{BASE}/{p['path']}"
                try:
                    async with httpx.AsyncClient() as c:
                        resp = await c.post(url, json=payload, timeout=30)
                    if resp.status_code in (200, 201, 204):
                        ok_count += 1; results["ok"] += 1
                        if i == 0:
                            detail = ""
                            try:
                                data = resp.json()
                                if isinstance(data, dict) and "dataInfoList" in data:
                                    detail = f" — {len(data['dataInfoList'])} rows"
                                elif isinstance(data, list):
                                    detail = f" — {len(data)} rows"
                            except: pass
                            print(f"  ✓ r{i+1}: {resp.status_code}{detail}", end="", flush=True)
                    else:
                        results["fail"] += 1
                        if i < 3:
                            body = resp.text[:120]
                            print(f"\n  ✗ r{i+1}: {resp.status_code} {body}")
                except Exception as e:
                    results["fail"] += 1
                    if i < 3: print(f"\n  ✗ r{i+1}: {e}")
            print(f" → {ok_count}/10")

    # Phase 1: UPSERT / INSERT
    await do_phase("PHASE 1: UPSERT / INSERT (10 each)", ("UPSERT", "INSERT"))
    # Phase 2: SELECT
    await do_phase("PHASE 2: SELECT (10 each)", ("SELECT",))
    # Phase 3: UPDATE
    await do_phase("PHASE 3: UPDATE (10 each)", ("UPDATE",))

    # Summary
    print(f"\n{'='*60}")
    total_op = results["ok"] + results["fail"]
    print(f"TOTAL: {results['ok']} ok / {results['fail']} fail / {results['skip']} skip")
    print(f"Interfaces with templates: {len(TEMPLATES)} / 36")
    print(f"{'='*60}")

    # Data counts for ALL 22 tables
    print("\n=== PG data summary ===")
    for tbl in [
        "lab_sample_types","lab_request_items","lab_request_item_tests","lab_request_item_children",
        "lab_test_items","lab_bio_items","lab_anti_items",
        "lab_specimens","lab_specimen_items","lab_specimen_barcode_items",
        "lab_test_reports","lab_report_result_items","lab_report_plant_items",
        "lab_report_anti_items","lab_report_bio_items","lab_report_images",
        "lab_sample_warnings","lab_warn_log_items",
        "lab_applications","lab_application_items",
        "lab_qc_data","lab_device_info",
    ]:
        cnt = await pg.fetchval(f"SELECT COUNT(*) FROM biz.{tbl} WHERE is_valid = true")
        print(f"  biz.{tbl}: {cnt} rows")

    await pg.close()


if __name__ == "__main__":
    asyncio.run(main())
