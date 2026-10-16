import os
import sys
import time
import json
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
from supabase import create_client, Client
from google import genai
from google.genai import types

print("🚀 [초고속 모드] 8배속 동시 변환 프로그램이 시작되었습니다!", flush=True)

load_dotenv(".env.local")
load_dotenv(".env")

# ---------------------------------------------------------
# 1. 키 설정 (.env.local 자동 로드 또는 직접 입력)
# ---------------------------------------------------------
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "https://kfwlmbwornivkrvoeqdh.supabase.co"
SUPABASE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SERVICE_ROLE_KEY")
    or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    or "여기에_service_role_키를_넣어주세요"
)
GEMINI_API_KEY = (
    os.getenv("GEMINI_API_KEY")
    or os.getenv("NEXT_PUBLIC_GEMINI_API_KEY")
    or os.getenv("GOOGLE_API_KEY")
    or "여기에_GEMINI_API_KEY를_넣어주세요"
)

# 사용 중인 최신 Flash 모델명 (gemini-3.8-flash 또는 gemini-2.5-flash)
MODEL_NAME = "gemini-3.8-flash"

BUCKET_NAME = "system_data"
URL_MASTER_CAT = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/Master_Category.json"
URL_MASTER_ITEM = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/Master_Item.json"

CHECKPOINT_CAT_FILE = "checkpoint_categories.json"
CHECKPOINT_ITEM_FILE = "checkpoint_items.json"

# 🔥 속도 핵심 설정: 한 묶음 80개 x 일꾼 8명 동시 작업 (= 한 번에 640개씩 처리!)
BATCH_SIZE = 80
MAX_WORKERS = 8


def format_eta(seconds: float) -> str:
    if seconds <= 0 or seconds > 86400 * 3:
        return "계산 중..."
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"약 {h}시간 {m}분" if h > 0 else f"약 {m}분 {s}초"


def init_clients():
    if not SUPABASE_KEY or "여기에_" in SUPABASE_KEY:
        print("❌ 오류: SUPABASE_KEY를 입력해 주세요.", flush=True)
        sys.exit(1)
    if not GEMINI_API_KEY or "여기에_" in GEMINI_API_KEY:
        print("❌ 오류: GEMINI_API_KEY를 입력해 주세요.", flush=True)
        sys.exit(1)
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    ai_client = genai.Client(api_key=GEMINI_API_KEY)
    return supabase, ai_client


def load_json_with_checkpoint():
    if not os.path.exists("Master_Category_orig_backup.json"):
        r_cat = requests.get(f"{URL_MASTER_CAT}?t={int(time.time())}")
        r_cat.raise_for_status()
        with open("Master_Category_orig_backup.json", "w", encoding="utf-8") as f:
            json.dump(r_cat.json(), f, ensure_ascii=False, indent=2)

    if not os.path.exists("Master_Item_orig_backup.json"):
        r_item = requests.get(f"{URL_MASTER_ITEM}?t={int(time.time())}")
        r_item.raise_for_status()
        with open("Master_Item_orig_backup.json", "w", encoding="utf-8") as f:
            json.dump(r_item.json(), f, ensure_ascii=False, indent=2)

    with open("Master_Category_orig_backup.json", "r", encoding="utf-8") as f:
        cat_data = json.load(f)
    with open("Master_Item_orig_backup.json", "r", encoding="utf-8") as f:
        item_data = json.load(f)

    done_cats = {}
    if os.path.exists(CHECKPOINT_CAT_FILE):
        with open(CHECKPOINT_CAT_FILE, "r", encoding="utf-8") as f:
            done_cats = json.load(f)
        print(f"🔄 카테고리 이전 저장 기록 로드 완료: {len(done_cats):,}개", flush=True)

    done_items = {}
    if os.path.exists(CHECKPOINT_ITEM_FILE):
        with open(CHECKPOINT_ITEM_FILE, "r", encoding="utf-8") as f:
            done_items = json.load(f)
        print(f"🔄 아이템 이전 저장 기록 로드 완료: {len(done_items):,}개 (여기서부터 이어서 진행!)", flush=True)

    return cat_data, item_data, done_cats, done_items


def call_gemini_batch(ai_client, payload_list: list) -> dict:
    if not payload_list:
        return {}
    prompt = f"""
대한민국 수학 교육과정 전문가로서 아래 수학 분류 명칭들의 수학적 개념과 조건은 100% 유지하되,
타사(매쓰플랫) 특유의 문구 스타일과 어순을 피해 독자적이고 자연스러운 한국어 수학 유형명으로 다시 작성하세요.

[규칙]
1. '(1);', '(2);', ';' 같은 기호/번호는 제거하고 자연스러운 조사로 연결하세요.
2. '~을 이용한 ~계산' 같은 어미를 '~의 성질을 활용한 ~구하기', '~조건에서의 ~결정' 등으로 자연스럽게 다듬으세요.
3. 별표(✨)나 불필요한 기호를 절대 붙이지 마세요.
4. 같은 단원(ctx) 내 항목끼리 이름이 겹치지 않게 세부 조건을 살리세요.

[입력 JSON]
{json.dumps(payload_list, ensure_ascii=False)}

출력은 키가 "id", 값이 변환된 문자열인 JSON 객체만 반환하세요.
"""
    for attempt in range(3):
        try:
            response = ai_client.models.generate_content(
                model=MODEL_NAME,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.3,
                ),
            )
            return json.loads(response.text)
        except Exception as e:
            time.sleep(2 * (attempt + 1))
    return {}


def step1_transform_categories(ai_client, cat_data: list, done_cats: dict):
    pending = []
    for c in cat_data:
        cid = c["category_id"]
        if cid in done_cats:
            continue
        entry = {"cid": cid, "ctx": f"{c.get('depth3', '')}>{c.get('depth4', '')}>{c.get('depth5', '')}"}
        has_target = False
        if c.get("depth5") and (";" in c["depth5"] or "(" in c["depth5"]):
            entry["d5"] = c["depth5"]
            has_target = True
        if c.get("depth6"):
            entry["d6"] = c["depth6"]
            has_target = True
        if c.get("depth7"):
            entry["d7"] = c["depth7"]
            has_target = True

        if has_target:
            pending.append(entry)
        else:
            done_cats[cid] = {}

    if not pending:
        print("✅ [1단계] 카테고리는 이미 100% 변환되어 있습니다.", flush=True)
        return

    total_cats = len(cat_data)
    already_done = total_cats - len(pending)
    print(f"\n📂 [1단계] 카테고리 {len(pending):,}개 초고속 동시 변환 시작...", flush=True)

    start_time = time.time()
    wave_size = BATCH_SIZE * MAX_WORKERS

    for w_start in range(0, len(pending), wave_size):
        wave_entries = pending[w_start : w_start + wave_size]
        sub_batches = [wave_entries[j : j + BATCH_SIZE] for j in range(0, len(wave_entries), BATCH_SIZE)]

        combined_res = {}
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = []
            for sb in sub_batches:
                ai_in = []
                for b in sb:
                    cid = b["cid"]
                    if "d5" in b: ai_in.append({"id": f"{cid}__d5", "ctx": b["ctx"], "text": b["d5"]})
                    if "d6" in b: ai_in.append({"id": f"{cid}__d6", "ctx": b["ctx"], "text": b["d6"]})
                    if "d7" in b: ai_in.append({"id": f"{cid}__d7", "ctx": b["ctx"], "text": b["d7"]})
                futures.append(executor.submit(call_gemini_batch, ai_client, ai_in))

            for fut in as_completed(futures):
                combined_res.update(fut.result())

        for b in wave_entries:
            cid = b["cid"]
            done_cats[cid] = {
                "depth5": combined_res.get(f"{cid}__d5"),
                "depth6": combined_res.get(f"{cid}__d6"),
                "depth7": combined_res.get(f"{cid}__d7"),
            }

        with open(CHECKPOINT_CAT_FILE, "w", encoding="utf-8") as f:
            json.dump(done_cats, f, ensure_ascii=False)

        processed = min(w_start + wave_size, len(pending))
        cur_done = already_done + processed
        pct = (cur_done / total_cats) * 100
        elapsed = time.time() - start_time
        remain_sec = (len(pending) - processed) / (processed / elapsed) if elapsed > 0 else 0
        print(f"📊 [카테고리] {pct:5.1f}% ({cur_done:,}/{total_cats:,}) | ⏱️ 남은 시간: {format_eta(remain_sec)}", flush=True)


def step2_transform_items(ai_client, item_data: list, short_cat_map: dict, done_items: dict):
    pending = [it for it in item_data if it["item_id"] not in done_items]
    if not pending:
        print("✅ [2단계] 세부유형(아이템)은 이미 100% 변환되어 있습니다.", flush=True)
        return

    total_items = len(item_data)
    already_done = total_items - len(pending)
    print(f"\n📄 [2단계] 세부유형 {len(pending):,}개 초고속 동시 변환 시작 (한 번에 {BATCH_SIZE * MAX_WORKERS}개씩 처리)...", flush=True)

    start_time = time.time()
    wave_size = BATCH_SIZE * MAX_WORKERS

    for w_start in range(0, len(pending), wave_size):
        wave_entries = pending[w_start : w_start + wave_size]
        sub_batches = [wave_entries[j : j + BATCH_SIZE] for j in range(0, len(wave_entries), BATCH_SIZE)]

        combined_res = {}
        sample_orig, sample_id = "", ""

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = []
            for sb in sub_batches:
                ai_in = []
                for it in sb:
                    iid = it["item_id"]
                    txt = it.get("depth8") or it.get("depth6")
                    if txt:
                        if not sample_orig:
                            sample_orig, sample_id = txt, iid
                        ai_in.append({"id": iid, "ctx": short_cat_map.get(it.get("category_id"), ""), "text": txt})
                futures.append(executor.submit(call_gemini_batch, ai_client, ai_in))

            for fut in as_completed(futures):
                combined_res.update(fut.result())

        for it in wave_entries:
            iid = it["item_id"]
            orig_txt = it.get("depth8") or it.get("depth6") or ""
            done_items[iid] = combined_res.get(iid, orig_txt)

        with open(CHECKPOINT_ITEM_FILE, "w", encoding="utf-8") as f:
            json.dump(done_items, f, ensure_ascii=False)

        processed = min(w_start + wave_size, len(pending))
        cur_done = already_done + processed
        pct = (cur_done / total_items) * 100
        elapsed = time.time() - start_time
        remain_sec = (len(pending) - processed) / (processed / elapsed) if elapsed > 0 else 0

        print(f"📊 [아이템 진행도] {pct:5.1f}% ({cur_done:,} / {total_items:,}) | ⏱️ 남은 시간: {format_eta(remain_sec)}", flush=True)
        if sample_orig and sample_id in combined_res:
            print(f"   💡 샘플: \"{sample_orig}\" ➔ \"{combined_res[sample_id]}\"", flush=True)


def step3_apply_to_db_and_storage(supabase: Client, cat_data: list, item_data: list, done_cats: dict, done_items: dict):
    print("\n💾 [3단계] DB 및 Storage 일괄 반영 중...", flush=True)

    # DB에 기존에 저장되어 있던 curriculum_version 값을 먼저 가져와서 유지합니다.
    existing_ver_map = {}
    try:
        offset = 0
        while True:
            res = supabase.table("master_category").select("category_id, curriculum_version").range(offset, offset + 999).execute()
            if not res.data:
                break
            for row in res.data:
                existing_ver_map[row["category_id"]] = row.get("curriculum_version") or "2022"
            if len(res.data) < 1000:
                break
            offset += 1000
    except Exception:
        pass

    for c in cat_data:
        cid = c.get("category_id")
        if not cid:
            continue
        ch = done_cats.get(cid, {})
        if ch.get("depth5"): c["depth5"] = ch["depth5"]
        if ch.get("depth6"): c["depth6"] = ch["depth6"]
        if ch.get("depth7"): c["depth7"] = ch["depth7"]
        parts = [c.get("depth1"), c.get("depth2"), c.get("depth3"), c.get("depth4"), c.get("depth5"), c.get("depth6"), c.get("depth7")]
        c["full_path"] = " > ".join([p for p in parts if p])

    seen_per_cat = {}
    for it in item_data:
        iid = it.get("item_id")
        if not iid:
            continue
        cid = it.get("category_id") or "ROOT"
        new_text = done_items.get(iid) or it.get("depth8") or it.get("depth6") or "기본 유형"

        if cid not in seen_per_cat:
            seen_per_cat[cid] = set()
        if new_text in seen_per_cat[cid]:
            new_text = f"{new_text} ({iid.split('-')[-1]})"
        seen_per_cat[cid].add(new_text)

        if it.get("depth8") is not None:
            it["depth8"] = new_text
        else:
            it["depth6"] = new_text

    print("  🔄 1/3: master_category 테이블 저장 중...", flush=True)
    valid_cats = [c for c in cat_data if c.get("category_id") and c.get("depth1") and c.get("depth2")]
    for i in range(0, len(valid_cats), 500):
        chunk = [
            {
                "category_id": c["category_id"],
                "curriculum_version": c.get("curriculum_version") or existing_ver_map.get(c["category_id"]) or "2022",
                "depth1": c.get("depth1") or "",
                "depth2": c.get("depth2") or "",
                "depth3": c.get("depth3"),
                "depth4": c.get("depth4"),
                "depth5": c.get("depth5"),
                "depth6": c.get("depth6"),
                "depth7": c.get("depth7"),
                "full_path": c.get("full_path") or "",
            }
            for c in valid_cats[i : i + 500]
        ]
        supabase.table("master_category").upsert(chunk).execute()

    print("  🔄 2/3: master_item 테이블 저장 중...", flush=True)
    valid_items = [it for it in item_data if it.get("item_id") and it.get("category_id")]
    for i in range(0, len(valid_items), 500):
        chunk = [
            {
                "item_id": it["item_id"],
                "category_id": it["category_id"],
                "depth8": it.get("depth8"),
                "depth6": it.get("depth6"),
                "type": it.get("type"),
            }
            for it in valid_items[i : i + 500]
        ]
        supabase.table("master_item").upsert(chunk).execute()

    print("  ☁️ 3/3: Supabase Storage JSON 파일 2개 업로드 중...", flush=True)
    for fname, data in [("Master_Category.json", cat_data), ("Master_Item.json", item_data)]:
        supabase.storage.from_(BUCKET_NAME).upload(
            path=fname,
            file=json.dumps(data, ensure_ascii=False).encode("utf-8"),
            file_options={"content-type": "application/json; charset=utf-8", "cache-control": "0", "upsert": "true"},
        )

    print("\n🎉 모든 변환과 DB/Storage 반영이 완료되었습니다!", flush=True)


if __name__ == "__main__":
    try:
        supabase_client, gemini_client = init_clients()
        cats, items, chk_cats, chk_items = load_json_with_checkpoint()
        step1_transform_categories(gemini_client, cats, chk_cats)
        short_map = {c["category_id"]: f"{c.get('depth5', '')}>{c.get('depth6', '')}" for c in cats}
        step2_transform_items(gemini_client, items, short_map, chk_items)
        step3_apply_to_db_and_storage(supabase_client, cats, items, chk_cats, chk_items)
    except KeyboardInterrupt:
        print("\n🛑 사용자 요청으로 안전하게 일시 정지되었습니다. (진행 내용은 자동 저장됨)", flush=True)
        sys.exit(0)