import os
import sys
import json
import requests
from dotenv import load_dotenv
from supabase import create_client, Client
from google import genai
from google.genai import types

# .env 또는 .env.local 파일에서 환경변수 불러오기
load_dotenv(".env.local")
load_dotenv(".env")

# ---------------------------------------------------------
# 1. 환경변수 설정 (비어있다면 따옴표 안에 직접 키를 넣어주세요)
# ---------------------------------------------------------
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "https://kfwlmbwornivkrvoeqdh.supabase.co"
# 주의: Storage 파일 덮어쓰기를 위해 가능하면 SERVICE_ROLE_KEY를 사용해 주세요.
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtmd2xtYndvcm5pdmtydm9lcWRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTc0NTM3NCwiZXhwIjoyMDk1MzIxMzc0fQ.Cusq-fpZsTOewe7xwtd2d2lOIWrH3gtw9xA6bJIyO80"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or ""

BUCKET_NAME = "system_data"
URL_MASTER_CAT = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/Master_Category.json"
URL_MASTER_ITEM = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/Master_Item.json"

BACKUP_CAT_FILE = "Master_Category_backup.json"
BACKUP_ITEM_FILE = "Master_Item_backup.json"

# 테스트할 타겟 카테고리 ID (중3-2 원주각 + 초2-1 첫 번째 카테고리는 자동 탐색)
TARGET_MID_CAT_ID = "M322-02-02-76-04"


def init_clients():
    if not SUPABASE_KEY:
        print("❌ 오류: SUPABASE_SERVICE_ROLE_KEY (또는 ANON_KEY)를 설정해 주세요.")
        sys.exit(1)
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return supabase


def download_and_backup_json():
    """현재 아코디언이 사용하는 JSON 파일 2개를 내려받고 로컬에 원본 백업을 저장합니다."""
    print("📥 1. Supabase Storage에서 현재 JSON 파일 내려받는 중...")
    res_cat = requests.get(f"{URL_MASTER_CAT}?t={os.urandom(4).hex()}")
    res_item = requests.get(f"{URL_MASTER_ITEM}?t={os.urandom(4).hex()}")
    res_cat.raise_for_status()
    res_item.raise_for_status()

    cat_data = res_cat.json()
    item_data = res_item.json()

    # 최초 1회만 원본 백업 파일 저장 (덮어쓰기 방지)
    if not os.path.exists(BACKUP_CAT_FILE):
        with open(BACKUP_CAT_FILE, "w", encoding="utf-8") as f:
            json.dump(cat_data, f, ensure_ascii=False, indent=2)
        print(f"  ✅ 원본 카테고리 백업 완료 -> {BACKUP_CAT_FILE} ({len(cat_data)}개)")

    if not os.path.exists(BACKUP_ITEM_FILE):
        with open(BACKUP_ITEM_FILE, "w", encoding="utf-8") as f:
            json.dump(item_data, f, ensure_ascii=False, indent=2)
        print(f"  ✅ 원본 아이템 백업 완료 -> {BACKUP_ITEM_FILE} ({len(item_data)}개)")

    return cat_data, item_data


def upload_json_to_storage(supabase: Client, filename: str, data: list):
    """수정된 JSON 데이터를 Supabase Storage(system_data)에 덮어씌웁니다."""
    json_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
    supabase.storage.from_(BUCKET_NAME).upload(
        path=filename,
        file=json_bytes,
        file_options={
            "content-type": "application/json; charset=utf-8",
            "cache-control": "0",
            "upsert": "true",
        },
    )
    print(f"  🚀 Storage 업로드 완료: {BUCKET_NAME}/{filename}")


def ai_rewrite_titles(items_to_rewrite: list) -> dict:
    """Gemini AI를 사용해 매쓰플랫 문구를 독자적인 자연스러운 수학 유형명으로 변환합니다."""
    if not GEMINI_API_KEY:
        print("⚠️ GEMINI_API_KEY가 없어 기본 규칙 변환으로 테스트를 진행합니다.")
        return {
            row["id"]: f"✨ {row['text'].replace(';', ' -').replace('(1)', '').replace('(2)', '').strip()} (변환테스트)"
            for row in items_to_rewrite
        }

    client = genai.Client(api_key=GEMINI_API_KEY)
    prompt = f"""
당신은 대한민국 초·중·고 수학 교육과정 전문가입니다.
아래 수학 문제 분류 명칭들의 수학적 의미와 핵심 개념은 100% 동일하게 유지하되,
타사(매쓰플랫) 특유의 문구 스타일을 피할 수 있도록 문장 구조와 어휘를 자연스럽고 독자적인 표현으로 바꿔주세요.

[변환 규칙]
1. '(1);', '(2);', ';' 같은 특수 번호/기호 패턴은 완전히 제거하고 자연스러운 조사(~에서, ~일 때, ~의)로 연결하세요.
2. '~을 이용한 ~계산' 같은 딱딱한 표현은 '~을 활용하여 ~구하기' 또는 '~의 성질과 ~의 관계' 등으로 자연스럽게 다듬으세요.
3. 같은 상위 단원 안에 있는 항목끼리 결과 문구가 절대 똑같아지지 않게 고유한 조건을 살려주세요.
4. 테스트 확인을 위해 변환된 모든 문구 맨 앞에 반드시 '✨ ' 기호를 붙여주세요. (예: "✨ 반원의 호에 대한 원주각의 크기")

[변환 대상 목록 (JSON)]
{json.dumps(items_to_rewrite, ensure_ascii=False, indent=2)}

응답은 반드시 아래와 같은 JSON 객체(키: id, 값: 변환된 새 문자열) 형태로만 출력하세요.
"""
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.3,
        ),
    )
    return json.loads(response.text)


def run_test():
    supabase = init_clients()
    cat_data, item_data = download_and_backup_json()

    # 1. 초등학교 > 2학년 1학기 첫 번째 단원의 카테고리 2개 + 중3-2 원주각 카테고리 선택
    elem_cats = [
        c for c in cat_data
        if c.get("depth1") == "초등학교" and c.get("depth2") == "2학년 1학기"
    ][:2]
    mid_cats = [c for c in cat_data if c.get("category_id") == TARGET_MID_CAT_ID]

    target_cats = elem_cats + mid_cats
    target_cat_ids = {c["category_id"] for c in target_cats}

    # 해당 카테고리에 속한 하위 아이템(depth8 / depth6) 찾기
    target_items = [i for i in item_data if i.get("category_id") in target_cat_ids]

    print(f"\n🎯 2. 테스트 변환 대상 선정 완료: 카테고리 {len(target_cats)}개, 세부유형(아이템) {len(target_items)}개")

    # AI에 보낼 텍스트 목록 구성
    to_rewrite = []
    for c in target_cats:
        if c.get("depth6"):
            to_rewrite.append({"id": f"CAT_D6_{c['category_id']}", "context": c.get("full_path"), "text": c["depth6"]})
        if c.get("depth7"):
            to_rewrite.append({"id": f"CAT_D7_{c['category_id']}", "context": c.get("full_path"), "text": c["depth7"]})
        elif not c.get("depth6") and c.get("depth5"):
            to_rewrite.append({"id": f"CAT_D5_{c['category_id']}", "context": c.get("full_path"), "text": c["depth5"]})

    for it in target_items:
        leaf_col = "depth8" if it.get("depth8") else "depth6"
        if it.get(leaf_col):
            to_rewrite.append({"id": f"ITEM_{it['item_id']}", "context": it["category_id"], "text": it[leaf_col]})

    print("🤖 3. AI로 문구 변환 중...")
    rewritten_map = ai_rewrite_titles(to_rewrite)

    # 변환 결과 출력 및 DB + JSON 동시 반영
    print("\n---------------- [변환 결과 미리보기] ----------------")
    for row in to_rewrite:
        new_text = rewritten_map.get(row["id"], row["text"])
        print(f"  • 변경 전: {row['text']}")
        print(f"    변경 후: {new_text}\n")

    print("💾 4. Supabase DB 테이블(master_category, master_item, question_db) 업데이트 중...")
    for c in cat_data:
        cid = c["category_id"]
        if cid in target_cat_ids:
            new_d5 = rewritten_map.get(f"CAT_D5_{cid}", c.get("depth5"))
            new_d6 = rewritten_map.get(f"CAT_D6_{cid}", c.get("depth6"))
            new_d7 = rewritten_map.get(f"CAT_D7_{cid}", c.get("depth7"))
            c["depth5"], c["depth6"], c["depth7"] = new_d5, new_d6, new_d7

            parts = [c.get("depth1"), c.get("depth2"), c.get("depth3"), c.get("depth4"), new_d5, new_d6, new_d7]
            c["full_path"] = " > ".join([p for p in parts if p])

            supabase.table("master_category").update({
                "depth5": new_d5,
                "depth6": new_d6,
                "depth7": new_d7,
                "full_path": c["full_path"]
            }).eq("category_id", cid).execute()

            # question_db에서 taxonomy_id가 category_id인 문항의 taxonomy_name 동기화
            leaf_cat_name = new_d7 or new_d6 or new_d5
            if leaf_cat_name:
                supabase.table("question_db").update({
                    "taxonomy_name": leaf_cat_name[:100]
                }).eq("taxonomy_id", cid).execute()

    for it in item_data:
        iid = it["item_id"]
        if f"ITEM_{iid}" in rewritten_map:
            new_leaf = rewritten_map[f"ITEM_{iid}"]
            if it.get("depth8"):
                it["depth8"] = new_leaf
                supabase.table("master_item").update({"depth8": new_leaf}).eq("item_id", iid).execute()
            else:
                it["depth6"] = new_leaf
                supabase.table("master_item").update({"depth6": new_leaf}).eq("item_id", iid).execute()

            # question_db의 taxonomy_name 동기화
            supabase.table("question_db").update({
                "taxonomy_name": new_leaf[:100]
            }).or_(f"item_id.eq.{iid},taxonomy_id.eq.{iid}").execute()

    print("☁️ 5. 아코디언용 JSON 파일 2개 Storage에 업데이트 중...")
    upload_json_to_storage(supabase, "Master_Category.json", cat_data)
    upload_json_to_storage(supabase, "Master_Item.json", item_data)

    print("\n🎉 테스트 반영 완료! 이제 웹사이트(/exam/step1)에서 Ctrl+Shift+R(강력 새로고침)을 눌러 확인해 보세요!")


def run_rollback():
    """백업해 둔 JSON 파일과 old_ 컬럼을 이용해 100% 원래 상태로 복구합니다."""
    supabase = init_clients()
    if not os.path.exists(BACKUP_CAT_FILE) or not os.path.exists(BACKUP_ITEM_FILE):
        print("❌ 백업 파일이 존재하지 않습니다.")
        return

    print("⏪ 1. 백업 JSON 파일 읽는 중...")
    with open(BACKUP_CAT_FILE, "r", encoding="utf-8") as f:
        orig_cat = json.load(f)
    with open(BACKUP_ITEM_FILE, "r", encoding="utf-8") as f:
        orig_item = json.load(f)

    upload_json_to_storage(supabase, "Master_Category.json", orig_cat)
    upload_json_to_storage(supabase, "Master_Item.json", orig_item)

    print("⏪ 2. DB 테이블 원상복구 중...")
    elem_cats = [c for c in orig_cat if c.get("depth1") == "초등학교" and c.get("depth2") == "2학년 1학기"][:2]
    mid_cats = [c for c in orig_cat if c.get("category_id") == TARGET_MID_CAT_ID]
    target_cats = elem_cats + mid_cats
    target_cat_ids = {c["category_id"] for c in target_cats}

    for c in target_cats:
        cid = c["category_id"]
        supabase.table("master_category").update({
            "depth5": c.get("depth5"),
            "depth6": c.get("depth6"),
            "depth7": c.get("depth7"),
            "full_path": c.get("full_path")
        }).eq("category_id", cid).execute()
        leaf_cat_name = c.get("depth7") or c.get("depth6") or c.get("depth5")
        if leaf_cat_name:
            supabase.table("question_db").update({"taxonomy_name": leaf_cat_name[:100]}).eq("taxonomy_id", cid).execute()

    for it in [i for i in orig_item if i.get("category_id") in target_cat_ids]:
        iid = it["item_id"]
        supabase.table("master_item").update({
            "depth6": it.get("depth6"),
            "depth8": it.get("depth8")
        }).eq("item_id", iid).execute()
        leaf_name = it.get("depth8") or it.get("depth6")
        if leaf_name:
            supabase.table("question_db").update({"taxonomy_name": leaf_name[:100]}).or_(f"item_id.eq.{iid},taxonomy_id.eq.{iid}").execute()

    print("✅ 완벽하게 원래 상태로 복구되었습니다!")


if __name__ == "__main__":
    if "--rollback" in sys.argv:
        run_rollback()
    else:
        run_test()