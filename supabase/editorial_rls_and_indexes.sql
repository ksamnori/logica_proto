-- ============================================================================
-- 집필 · 문항 분류 스튜디오 (본부 /hq/editorial 전용) 권한 보강 및 조회 인덱스 SQL
-- 대상 테이블:
--   question_db, taxonomy_competency, prerequisite_mapping,
--   master_category, thinking_category, master_item
--
-- [설계 원칙]
-- 1. 본부(HQ)에 회원가입한 임직원(public.is_hq_member() = true)이 위 6개 테이블을
--    조회하고 question_db에 신규 문항을 저장·수정할 수 있도록 권한과 정책을 보장합니다.
-- 2. 가맹 학원의 기존 시험지 출제(/exam/step1, /exam/step2) 및 학생 리포트 기능이
--    깨지지 않도록 기존 조회(SELECT) 호환성을 100% 유지합니다.
-- 3. 중복 실행해도 안전한 Idempotent 스크립트입니다. Supabase SQL Editor에서 실행하세요.
-- ============================================================================

-- 1. 본부(HQ) 소속 임직원 판별 함수 (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_hq_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    ELSE (
      EXISTS (
        SELECT 1
        FROM public.hq_member_profile p
        WHERE p.instructor_id = auth.uid()
          AND coalesce(p.work_status, '재직') <> '퇴직'
      )
      OR EXISTS (
        SELECT 1
        FROM public.instructor i
        LEFT JOIN public.academy_tenant t ON t.tenant_id = i.tenant_id
        WHERE i.instructor_id = auth.uid()
          AND coalesce(i.status, '재직') <> '퇴직'
          AND (
            upper(coalesce(i.role, '')) IN ('SUPER_ADMIN', 'HQ')
            OR upper(coalesce(t.tenant_type, '')) = 'HQ'
            OR coalesce(t.name, '') LIKE '%본사%'
          )
      )
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.is_hq_member() TO anon, authenticated, service_role;

-- 2. 분류 · 역량 · 선수학습 마스터 테이블 5종 권한 및 RLS 정책
--    (기존 가맹점 시험지 출제/리포트용 SELECT 유지 + 본부 회원 전체 접근 보장)
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'master_category',
    'master_item',
    'thinking_category',
    'taxonomy_competency',
    'prerequisite_mapping'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role', tbl);
      EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', tbl);

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select_compat', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
        tbl || '_select_compat',
        tbl
      );

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_hq_member_write', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_hq_member()) WITH CHECK (public.is_hq_member())',
        tbl || '_hq_member_write',
        tbl
      );
    END IF;
  END LOOP;
END;
$$;

-- 3. question_db 테이블 권한 및 본부 회원 접근 정책 보강
--    (주의: 기존 어드민/학원 기능 호환을 위해 RLS가 이미 켜져 있는 경우에도 SELECT 호환과 본부 쓰기 허용을 모두 보장)
DO $$
BEGIN
  IF to_regclass('public.question_db') IS NOT NULL THEN
    GRANT SELECT ON public.question_db TO anon, authenticated, service_role;
    GRANT INSERT, UPDATE ON public.question_db TO authenticated, service_role;

    DROP POLICY IF EXISTS question_db_select_compat ON public.question_db;
    CREATE POLICY question_db_select_compat
      ON public.question_db
      FOR SELECT
      TO anon, authenticated
      USING (true);

    DROP POLICY IF EXISTS question_db_hq_member_write ON public.question_db;
    CREATE POLICY question_db_hq_member_write
      ON public.question_db
      FOR ALL
      TO authenticated
      USING (public.is_hq_member())
      WITH CHECK (public.is_hq_member());
  END IF;
END;
$$;

-- 4. 문항 이미지 버킷(question_images) 본부 회원 업로드 허용 정책
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS question_images_hq_member_insert ON storage.objects;
    CREATE POLICY question_images_hq_member_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'question_images' AND public.is_hq_member());

    DROP POLICY IF EXISTS question_images_hq_member_update ON storage.objects;
    CREATE POLICY question_images_hq_member_update
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (bucket_id = 'question_images' AND public.is_hq_member())
      WITH CHECK (bucket_id = 'question_images' AND public.is_hq_member());
  END IF;
END;
$$;

-- 5. 대규모 분류 · 계통 탐색 속도 최적화 인덱스
CREATE INDEX IF NOT EXISTS idx_question_db_taxonomy_id ON public.question_db(taxonomy_id);
CREATE INDEX IF NOT EXISTS idx_question_db_sub_taxonomy_id ON public.question_db(sub_taxonomy_id) WHERE sub_taxonomy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_question_db_thk_taxonomy_id ON public.question_db(thk_taxonomy_id) WHERE thk_taxonomy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_question_db_book_name ON public.question_db(book_name);
CREATE INDEX IF NOT EXISTS idx_master_item_category_id ON public.master_item(category_id);
CREATE INDEX IF NOT EXISTS idx_prereq_target_cat ON public.prerequisite_mapping(target_category_id);
CREATE INDEX IF NOT EXISTS idx_prereq_source_cat ON public.prerequisite_mapping(prerequisite_id);

NOTIFY pgrst, 'reload schema';
