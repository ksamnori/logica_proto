-- ============================================================================
-- LOGICA 문항 정답률(solving_probability) 중심 분산 + 난이도(difficulty) 재분류 SQL (V3)
--
-- [핵심 보정 규칙]
-- 1) 새 난이도(difficulty) 재분류 기준 (examUtils.tsx 100% 동기화):
--    - 80% 이상 (80~95%) : '최하'
--    - 60% ~ 79% (60~80%): '하'
--    - 45% ~ 59% (45~60%): '중'
--    - 30% ~ 44% (30~45%): '상'
--    - 30% 미만  (15~29%): '최상'
-- 2) 50% 부근 밀집 해소 및 점진 범위 확장 (최저 15% ~ 최대 95% 엄격 제한):
--    - 50%를 기준으로 45% -> 40% 수준, 55% -> 60% 수준으로 점진적으로 범위를 넓히는
--      비선형 대칭 확장 곡선(qcal_spread_around_50)을 N=0 및 N>0 전 문항에 일괄 적용!
--    - 파서 기본값(50% 또는 NULL)에 갇혀 있던 문항들도 백업된 원본 난이도(ai_difficulty),
--      문항 번호(확인/예제 vs 후반부/도전/킬러), 교재 단계(기초/PRO/MAX), 인지수준 및
--      결정론적 문항 해시를 반영해 자연스럽게 분산시킵니다.
-- 3) 최초 오답 엄격 판정 ("한 번이라도 틀렸으면 무조건 오답 0점"):
--    - 고쳐서 맞았더라도(RO, TO), 부분점수(q)라도, 혹은 선생님이 'O'로 덮어썼더라도
--      student_incorrect_record(오답노트) 또는 wrong_attempts_log 에 이력이 있으면 무조건 0.0 처리!
--    - 입학테스트·진단평가 대외비 문항 및 테스트/선생님 더미 계정은 모수에서 제외합니다.
-- ============================================================================

-- 1. 원본 AI 예측치 백업 컬럼 및 통계 캐시 테이블 보장
ALTER TABLE public.question_db
  ADD COLUMN IF NOT EXISTS ai_solving_probability integer,
  ADD COLUMN IF NOT EXISTS ai_difficulty text,
  ADD COLUMN IF NOT EXISTS calibrated_sample_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calibrated_at timestamptz;

UPDATE public.question_db
SET
  ai_solving_probability = solving_probability,
  ai_difficulty = difficulty
WHERE ai_solving_probability IS NULL
  AND solving_probability IS NOT NULL
  AND solving_probability <> 50
  AND coalesce(calibrated_sample_count, 0) = 0;

UPDATE public.question_db
SET ai_difficulty = difficulty
WHERE ai_difficulty IS NULL
  AND difficulty IS NOT NULL
  AND coalesce(calibrated_sample_count, 0) = 0;

CREATE OR REPLACE FUNCTION public.preserve_question_ai_prior_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $qcal_prior$
BEGIN
  IF NEW.ai_solving_probability IS NULL AND NEW.solving_probability IS NOT NULL THEN
    NEW.ai_solving_probability := NEW.solving_probability;
  END IF;
  IF NEW.ai_difficulty IS NULL AND NEW.difficulty IS NOT NULL THEN
    NEW.ai_difficulty := NEW.difficulty;
  END IF;
  RETURN NEW;
END;
$qcal_prior$;

DROP TRIGGER IF EXISTS trg_question_db_preserve_ai_prior ON public.question_db;
CREATE TRIGGER trg_question_db_preserve_ai_prior
  BEFORE INSERT ON public.question_db
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_question_ai_prior_on_insert();

CREATE TABLE IF NOT EXISTS public.student_ability_stat (
  student_id text PRIMARY KEY,
  solved_count integer NOT NULL DEFAULT 0,
  correct_sum double precision NOT NULL DEFAULT 0,
  expected_sum double precision NOT NULL DEFAULT 0,
  theta_logit double precision NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.question_calibration_stat (
  question_id text PRIMARY KEY,
  prior_rate integer NOT NULL DEFAULT 50,
  prior_is_null boolean NOT NULL DEFAULT false,
  sample_count integer NOT NULL DEFAULT 0,
  correct_sum double precision NOT NULL DEFAULT 0,
  raw_rate numeric(5,1),
  avg_student_theta numeric(6,3) NOT NULL DEFAULT 0,
  irt_adjusted_rate numeric(5,1),
  calibrated_rate integer NOT NULL DEFAULT 50,
  calibrated_difficulty text NOT NULL DEFAULT '중',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.student_ability_stat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_calibration_stat ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.student_ability_stat TO authenticated, service_role;
GRANT ALL ON public.student_ability_stat TO service_role;
GRANT SELECT ON public.question_calibration_stat TO authenticated, service_role;
GRANT ALL ON public.question_calibration_stat TO service_role;

DROP POLICY IF EXISTS student_ability_stat_select_auth ON public.student_ability_stat;
CREATE POLICY student_ability_stat_select_auth
  ON public.student_ability_stat FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS question_calibration_stat_select_auth ON public.question_calibration_stat;
CREATE POLICY question_calibration_stat_select_auth
  ON public.question_calibration_stat FOR SELECT TO authenticated USING (true);

-- 2. 고속 조인 및 실시간 트리거용 표현식 인덱스
CREATE INDEX IF NOT EXISTS idx_qcal_question_db_qid_txt
  ON public.question_db ((question_id::text));
CREATE INDEX IF NOT EXISTS idx_qcal_tq_qid_txt
  ON public.textbook_question ((question_id::text))
  WHERE question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qcal_sa_qid_txt
  ON public.student_answer ((question_id::text));
CREATE INDEX IF NOT EXISTS idx_qcal_sa_student_txt
  ON public.student_answer ((student_id::text));
CREATE INDEX IF NOT EXISTS idx_qcal_sha_qid_txt
  ON public.student_homework_answer ((question_id::text))
  WHERE question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qcal_sha_tqid
  ON public.student_homework_answer (tq_id)
  WHERE tq_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qcal_sha_student_txt
  ON public.student_homework_answer ((student_id::text));
CREATE INDEX IF NOT EXISTS idx_qcal_sir_qid_txt
  ON public.student_incorrect_record ((question_id::text))
  WHERE question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qcal_sir_tqid_txt
  ON public.student_incorrect_record ((tq_id::text))
  WHERE tq_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qcal_sir_student_txt
  ON public.student_incorrect_record ((student_id::text));

-- 3. 수학 · 50% 중심 분산 · 난이도 구간 · 오답 판별 순수 헬퍼 함수
CREATE OR REPLACE FUNCTION public.qcal_is_confidential_text(p_val text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $qcal_h1$
  SELECT coalesce(p_val, '') ~* '(입학\s*테스트|진단\s*평가)';
$qcal_h1$;

CREATE OR REPLACE FUNCTION public.qcal_is_wrong_review_exam(p_exam_type text, p_title text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $qcal_h2$
  SELECT
    btrim(coalesce(p_exam_type, '')) IN ('오답프린트', '오답')
    OR (
      coalesce(p_title, '') ~ '([0-9xX]+\s*주차|주차)'
      AND coalesce(p_title, '') ~ '오답\s*(프린트)?'
    );
$qcal_h2$;

CREATE OR REPLACE FUNCTION public.qcal_has_grade(p_code text, p_is_correct boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $qcal_hg$
  SELECT (p_code IS NOT NULL AND btrim(p_code) <> '') OR p_is_correct IS NOT NULL;
$qcal_hg$;

CREATE OR REPLACE FUNCTION public.qcal_json_has_wrong_log(p_log jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $qcal_wl$
  SELECT CASE
    WHEN p_log IS NULL OR jsonb_typeof(p_log) = 'null' THEN false
    WHEN jsonb_typeof(p_log) = 'array' THEN jsonb_array_length(p_log) > 0
    WHEN jsonb_typeof(p_log) = 'string' THEN
      btrim(p_log #>> '{}') NOT IN ('', '[]', 'null', 'NULL', '{}')
    ELSE false
  END;
$qcal_wl$;

DROP FUNCTION IF EXISTS public.qcal_first_try_score(text);
DROP FUNCTION IF EXISTS public.qcal_first_try_score(text, boolean);

CREATE OR REPLACE FUNCTION public.qcal_first_try_score(
  p_code text,
  p_is_correct boolean DEFAULT NULL,
  p_wrong_log jsonb DEFAULT NULL
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $qcal_h3$
  SELECT CASE
    WHEN public.qcal_json_has_wrong_log(p_wrong_log) THEN 0.0::double precision
    WHEN p_code IS NOT NULL AND btrim(p_code) <> '' THEN
      CASE
        WHEN btrim(p_code) IN ('O', 'a', 'b', 'c') THEN 1.0::double precision
        ELSE 0.0::double precision
      END
    WHEN p_is_correct IS TRUE THEN 1.0::double precision
    ELSE 0.0::double precision
  END;
$qcal_h3$;

-- 새 난이도 구간 (examUtils.tsx 와 100% 동일: ~30% 최상, 30~45% 상, 45~60% 중, 60~80% 하, 80%~ 최하)
CREATE OR REPLACE FUNCTION public.qcal_diff_label_by_rate(p_rate numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $qcal_h4$
  SELECT CASE
    WHEN p_rate IS NULL THEN '중'
    WHEN p_rate >= 80 THEN '최하'
    WHEN p_rate >= 60 THEN '하'
    WHEN p_rate >= 45 THEN '중'
    WHEN p_rate >= 30 THEN '상'
    ELSE '최상'
  END;
$qcal_h4$;

-- 50% 기준 점진 확장 함수: 45% -> 40.0%, 55% -> 60.0%, 양끝 15% ~ 95% 엄격 수렴
CREATE OR REPLACE FUNCTION public.qcal_spread_around_50(p_val double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $qcal_sp50$
  SELECT CASE
    WHEN p_val IS NULL THEN 50.0::double precision
    WHEN p_val <= 15.0::double precision THEN 15.0::double precision
    WHEN p_val >= 95.0::double precision THEN 95.0::double precision
    WHEN p_val < 50.0::double precision THEN
      50.0::double precision - 35.0::double precision * power((50.0::double precision - p_val) / 35.0::double precision, 0.6438::double precision)
    WHEN p_val > 50.0::double precision THEN
      50.0::double precision + 45.0::double precision * power((p_val - 50.0::double precision) / 45.0::double precision, 0.6845::double precision)
    ELSE 50.0::double precision
  END;
$qcal_sp50$;

-- 결정론적 문항 고유 분산 계수 [-1.0, +1.0] (재실행 시에도 항상 동일한 값 보장, bigint 캐스팅으로 오버플로 원천 차단)
CREATE OR REPLACE FUNCTION public.qcal_question_hash_unit(p_qid text)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $qcal_qhash$
  SELECT ((abs(hashtext(coalesce(p_qid, ''))::bigint) % 2001) - 1000)::double precision / 1000.0::double precision;
$qcal_qhash$;

-- 원본 AI 예측치 + 원본 난이도(ai_difficulty) + 문항 위치/교재/인지수준 신호를 결합한 확장 전 기준값 산출
CREATE OR REPLACE FUNCTION public.qcal_resolve_pre_spread_prior(
  p_qid text,
  p_ai_prior integer,
  p_ai_diff text DEFAULT NULL,
  p_qnum text DEFAULT NULL,
  p_book text DEFAULT NULL,
  p_cog text DEFAULT NULL,
  p_ptype text DEFAULT NULL
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $qcal_pre$
DECLARE
  v_qnum text := btrim(coalesce(p_qnum, ''));
  v_book text := btrim(coalesce(p_book, ''));
  v_cog text := btrim(coalesce(p_cog, ''));
  v_ptype text := btrim(coalesce(p_ptype, ''));
  v_diff text := btrim(coalesce(p_ai_diff, ''));
  v_hash double precision := public.qcal_question_hash_unit(p_qid);
  v_num_str text;
  v_num integer;
  v_pos_adj double precision := 0.0;
  v_book_adj double precision := 0.0;
  v_cog_adj double precision := 0.0;
  v_cue double precision := 0.0;
  v_raw double precision;
  v_drop double precision;
  v_base double precision;
BEGIN
  IF v_qnum ~ '(도전|킬러|심화|창의|고난도|최상|올림피아드)' THEN
    v_pos_adj := -7.5;
  ELSIF v_qnum ~ '(확인|예제|유제|기초|연산|개념|워밍업|기본)' THEN
    v_pos_adj := 6.5;
  ELSE
    v_num_str := substring(v_qnum from '^[0-9]{1,3}');
    IF v_num_str IS NOT NULL AND v_num_str <> '' THEN
      v_num := v_num_str::integer;
      IF v_num BETWEEN 1 AND 3 THEN v_pos_adj := 5.0;
      ELSIF v_num BETWEEN 4 AND 7 THEN v_pos_adj := 2.5;
      ELSIF v_num BETWEEN 8 AND 12 THEN v_pos_adj := 0.0;
      ELSIF v_num BETWEEN 13 AND 16 THEN v_pos_adj := -3.0;
      ELSIF v_num >= 17 THEN v_pos_adj := -6.0;
      END IF;
    END IF;
  END IF;

  IF v_book ~* '(MAX|최상위|경시|올림피아드|킬러|심화)' THEN
    v_book_adj := -4.5;
  ELSIF v_book ~* '(입문|기초|연산|CORE|베이직|개념)' THEN
    v_book_adj := 4.5;
  END IF;

  IF v_cog = '이해 및 연산' THEN
    v_cog_adj := v_cog_adj + 4.0;
  ELSIF v_cog = '추론 및 문제 해결' THEN
    v_cog_adj := v_cog_adj - 3.5;
  END IF;

  IF upper(v_ptype) IN ('ESSAY', 'DESCRIPTIVE') OR v_ptype ~ '서술' THEN
    v_cog_adj := v_cog_adj - 2.5;
  END IF;

  v_cue := GREATEST(-12.0, LEAST(12.0, v_pos_adj + v_book_adj + v_cog_adj));

  IF p_ai_prior IS NOT NULL AND p_ai_prior <> 50 THEN
    v_raw := GREATEST(15.0, LEAST(100.0, p_ai_prior::double precision));
    v_drop := 4.0 + 8.0 * ((v_raw - 15.0) / 85.0);
    v_base := (v_raw - v_drop) + v_cue * 0.25 + v_hash * 2.2;
  ELSE
    -- NULL 또는 파서 기본값(50)에 묶여 있던 문항들을 원본 난이도·구조 신호·해시로 자연 분산
    IF v_diff = '최하' THEN
      v_base := 76.0 + v_cue * 0.35 + v_hash * 4.0;
    ELSIF v_diff = '하' THEN
      v_base := 58.5 + v_cue * 0.45 + v_hash * 4.5;
    ELSIF v_diff = '상' THEN
      v_base := 41.5 + v_cue * 0.45 + v_hash * 4.5;
    ELSIF v_diff = '최상' THEN
      v_base := 28.5 + v_cue * 0.35 + v_hash * 4.0;
    ELSE
      v_base := 50.0 + v_cue * 0.75 + v_hash * 4.8;
    END IF;
  END IF;

  RETURN GREATEST(15.0, LEAST(95.0, v_base));
END;
$qcal_pre$;

-- 하위 호환용 단일 인자 함수 유지
CREATE OR REPLACE FUNCTION public.qcal_lowered_prior(p_ai_prior integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $qcal_lp$
  SELECT GREATEST(
    15,
    LEAST(
      95,
      round(
        public.qcal_spread_around_50(
          GREATEST(15.0, LEAST(100.0, coalesce(p_ai_prior, 50)::double precision))
          - (4.0 + 8.0 * ((GREATEST(15.0, LEAST(100.0, coalesce(p_ai_prior, 50)::double precision)) - 15.0) / 85.0))
        )
      )::integer
    )
  );
$qcal_lp$;

CREATE OR REPLACE FUNCTION public.qcal_logit(p_prob double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $qcal_h5$
  SELECT ln(
    GREATEST(0.001::double precision, LEAST(0.999::double precision, p_prob))
    / (1.0::double precision - GREATEST(0.001::double precision, LEAST(0.999::double precision, p_prob)))
  );
$qcal_h5$;

CREATE OR REPLACE FUNCTION public.qcal_sigmoid(p_z double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $qcal_h6$
  SELECT 1.0::double precision / (1.0::double precision + exp(-GREATEST(-20.0::double precision, LEAST(20.0::double precision, p_z))));
$qcal_h6$;

-- 이전 시그니처 제거 후 V3 보정 계산 함수 생성
DROP FUNCTION IF EXISTS public.qcal_compute_calibrated_rate(integer, integer, double precision, double precision);
DROP FUNCTION IF EXISTS public.qcal_compute_calibrated_rate(double precision, integer, integer, double precision, double precision);

CREATE OR REPLACE FUNCTION public.qcal_compute_calibrated_rate(
  p_pre_prior double precision,
  p_ai_prior integer,
  p_sample_count integer,
  p_correct_sum double precision,
  p_avg_theta double precision
)
RETURNS TABLE (
  prior_rate integer,
  prior_is_null boolean,
  irt_rate numeric(5,1),
  final_rate integer,
  final_difficulty text
)
LANGUAGE plpgsql
IMMUTABLE
AS $qcal_calc$
DECLARE
  v_is_null boolean := (p_ai_prior IS NULL);
  v_pre double precision := GREATEST(15.0, LEAST(95.0, coalesce(p_pre_prior, 50.0)));
  v_prior_spread integer := GREATEST(15, LEAST(95, round(public.qcal_spread_around_50(v_pre))::integer));
  v_m double precision := CASE WHEN p_ai_prior IS NULL OR p_ai_prior = 50 THEN 6.5 ELSE 9.5 END;
  v_p0 double precision;
  v_eff_theta double precision := GREATEST(-1.2, LEAST(1.8, coalesce(p_avg_theta, 0.0) + 0.22));
  v_p_exp double precision;
  v_p_shrunk double precision;
  v_irt_pre double precision;
  v_pre_blended double precision;
  v_final integer;
BEGIN
  IF coalesce(p_sample_count, 0) <= 0 THEN
    prior_rate := v_prior_spread;
    prior_is_null := v_is_null;
    irt_rate := v_prior_spread::numeric(5,1);
    final_rate := v_prior_spread;
    final_difficulty := public.qcal_diff_label_by_rate(v_prior_spread);
    RETURN NEXT;
    RETURN;
  END IF;

  v_p0 := GREATEST(0.15, LEAST(0.95, v_pre / 100.0));
  v_p_exp := public.qcal_sigmoid(public.qcal_logit(v_p0) + v_eff_theta);
  v_p_shrunk := GREATEST(
    0.02::double precision,
    LEAST(
      0.98::double precision,
      (1.8 * v_p_exp + GREATEST(0.0, LEAST(p_sample_count::double precision, coalesce(p_correct_sum, 0.0))))
      / (1.8 + p_sample_count::double precision)
    )
  );
  v_irt_pre := public.qcal_sigmoid(public.qcal_logit(v_p_shrunk) - v_eff_theta) * 100.0;

  IF v_irt_pre > 76.0 THEN
    v_irt_pre := 76.0 + (v_irt_pre - 76.0) * 0.78;
  END IF;

  v_pre_blended := (v_m * v_pre + p_sample_count::double precision * v_irt_pre) / (v_m + p_sample_count::double precision);
  v_final := GREATEST(15, LEAST(95, round(public.qcal_spread_around_50(v_pre_blended))::integer));

  prior_rate := v_prior_spread;
  prior_is_null := v_is_null;
  irt_rate := round(GREATEST(15.0, LEAST(95.0, public.qcal_spread_around_50(v_irt_pre)))::numeric, 1);
  final_rate := v_final;
  final_difficulty := public.qcal_diff_label_by_rate(v_final);
  RETURN NEXT;
END;
$qcal_calc$;

-- 4. 학생별 난이도 대비 실력 지수(theta_logit) 산출·갱신 함수 (오답노트 포함 MIN 집계)
CREATE OR REPLACE FUNCTION public.refresh_student_ability_stats(p_student_ids text[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $qcal_stu$
DECLARE
  v_upserted integer := 0;
BEGIN
  WITH target_students AS (
    SELECT s.student_id::text AS student_id_txt
    FROM public.student s
    WHERE regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') !~ '(테스트|선생님)'
      AND (p_student_ids IS NULL OR s.student_id::text = ANY(p_student_ids))
  ),
  confidential_qids AS (
    SELECT q.question_id::text AS qid
    FROM public.question_db q
    WHERE public.qcal_is_confidential_text(q.source_book_name)
       OR public.qcal_is_confidential_text(q.book_name)
       OR public.qcal_is_confidential_text(q.pdf_source)
       OR public.qcal_is_confidential_text(q.raw_source_tags::text)
    UNION
    SELECT ei.question_id::text AS qid
    FROM public.exam_item ei
    JOIN public.exam_master em ON em.exam_id = ei.exam_id
    WHERE ei.question_id IS NOT NULL
      AND (public.qcal_is_confidential_text(em.exam_type) OR public.qcal_is_confidential_text(em.title))
  ),
  dedup_obs AS (
    SELECT
      u.sid,
      u.qid,
      MIN(u.score)::double precision AS score
    FROM (
      SELECT
        sa.student_id::text AS sid,
        btrim(sa.question_id::text) AS qid,
        public.qcal_first_try_score(sa.grading_code, sa.is_correct, to_jsonb(sa)->'wrong_attempts_log') AS score
      FROM public.student_answer sa
      JOIN target_students ts ON ts.student_id_txt = sa.student_id::text
      LEFT JOIN public.exam_assignment ea ON ea.assignment_id = sa.exam_assignment_id
      LEFT JOIN public.exam_master em ON em.exam_id = ea.exam_id
      WHERE sa.question_id IS NOT NULL
        AND public.qcal_has_grade(sa.grading_code, sa.is_correct)
        AND (ea.assignment_id IS NULL OR ea.admission_session_id IS NULL)
        AND NOT public.qcal_is_confidential_text(em.exam_type)
        AND NOT public.qcal_is_confidential_text(em.title)
        AND NOT public.qcal_is_wrong_review_exam(em.exam_type, em.title)
      UNION ALL
      SELECT
        sha.student_id::text AS sid,
        btrim(
          coalesce(
            NULLIF(btrim(sha.question_id::text), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), '')
          )
        ) AS qid,
        public.qcal_first_try_score(sha.grading_code, sha.is_correct, to_jsonb(sha)->'wrong_attempts_log') AS score
      FROM public.student_homework_answer sha
      JOIN target_students ts ON ts.student_id_txt = sha.student_id::text
      LEFT JOIN public.textbook_question tq
        ON (sha.question_id IS NULL OR btrim(sha.question_id::text) = '')
       AND sha.tq_id IS NOT NULL AND tq.tq_id = sha.tq_id
      WHERE public.qcal_has_grade(sha.grading_code, sha.is_correct)
        AND coalesce(
          NULLIF(btrim(sha.question_id::text), ''),
          NULLIF(btrim(tq.question_id::text), ''),
          NULLIF(btrim(tq.raw_metadata->>'question_id'), '')
        ) IS NOT NULL
      UNION ALL
      SELECT
        sir.student_id::text AS sid,
        btrim(
          coalesce(
            NULLIF(btrim(sir.question_id::text), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), ''),
            CASE WHEN sir.tq_id::text ~ '-' THEN btrim(sir.tq_id::text) ELSE NULL END
          )
        ) AS qid,
        0.0::double precision AS score
      FROM public.student_incorrect_record sir
      JOIN target_students ts ON ts.student_id_txt = sir.student_id::text
      LEFT JOIN public.textbook_question tq
        ON (sir.question_id IS NULL OR btrim(sir.question_id::text) = '')
       AND sir.tq_id IS NOT NULL
       AND sir.tq_id::text !~ '-'
       AND tq.tq_id::text = sir.tq_id::text
      WHERE NOT public.qcal_is_confidential_text(sir.source_type)
        AND coalesce(
          NULLIF(btrim(sir.question_id::text), ''),
          NULLIF(btrim(tq.question_id::text), ''),
          NULLIF(btrim(tq.raw_metadata->>'question_id'), ''),
          CASE WHEN sir.tq_id::text ~ '-' THEN btrim(sir.tq_id::text) ELSE NULL END
        ) IS NOT NULL
    ) u
    LEFT JOIN confidential_qids cq ON cq.qid = u.qid
    WHERE u.qid <> '' AND cq.qid IS NULL
    GROUP BY u.sid, u.qid
  ),
  agg AS (
    SELECT
      d.sid,
      count(*)::integer AS n_cnt,
      sum(d.score)::double precision AS c_sum,
      sum(
        public.qcal_spread_around_50(
          public.qcal_resolve_pre_spread_prior(
            q.question_id::text,
            q.ai_solving_probability,
            q.ai_difficulty,
            q.question_number,
            coalesce(q.book_name, q.source_book_name, q.pdf_source, ''),
            q.cognitive_level,
            q.problem_type
          )
        ) / 100.0
      )::double precision AS e_sum
    FROM dedup_obs d
    JOIN public.question_db q ON q.question_id::text = d.qid
    GROUP BY d.sid
  ),
  computed AS (
    SELECT
      ts.student_id_txt AS sid,
      coalesce(a.n_cnt, 0) AS n_cnt,
      coalesce(a.c_sum, 0.0) AS c_sum,
      coalesce(a.e_sum, 0.0) AS e_sum,
      CASE
        WHEN coalesce(a.n_cnt, 0) <= 0 THEN 0.0::double precision
        ELSE GREATEST(
          -1.5::double precision,
          LEAST(
            1.5::double precision,
            public.qcal_logit(
              (15.0 * GREATEST(0.15, LEAST(0.90, a.e_sum / a.n_cnt::double precision)) + a.c_sum)
              / (15.0 + a.n_cnt::double precision)
            )
            - public.qcal_logit(GREATEST(0.15, LEAST(0.90, a.e_sum / a.n_cnt::double precision)))
          )
        )
      END AS theta
    FROM target_students ts
    LEFT JOIN agg a ON a.sid = ts.student_id_txt
    WHERE p_student_ids IS NOT NULL OR coalesce(a.n_cnt, 0) > 0
  )
  INSERT INTO public.student_ability_stat (
    student_id, solved_count, correct_sum, expected_sum, theta_logit, updated_at
  )
  SELECT sid, n_cnt, c_sum, e_sum, theta, now()
  FROM computed
  ON CONFLICT (student_id) DO UPDATE SET
    solved_count = EXCLUDED.solved_count,
    correct_sum = EXCLUDED.correct_sum,
    expected_sum = EXCLUDED.expected_sum,
    theta_logit = EXCLUDED.theta_logit,
    updated_at = now();

  GET DIAGNOSTICS v_upserted = ROW_COUNT;
  RETURN v_upserted;
END;
$qcal_stu$;

-- 5. 특정 문항 ID 배열 즉시 보정 함수 (실시간 트리거 & 일괄 보정 공용)
CREATE OR REPLACE FUNCTION public.recalibrate_questions_by_ids(p_question_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $qcal_qids$
DECLARE
  v_clean_ids text[];
  v_updated_count integer := 0;
  v_reverted_count integer := 0;
BEGIN
  SELECT coalesce(array_agg(DISTINCT btrim(x)), ARRAY[]::text[])
  INTO v_clean_ids
  FROM unnest(coalesce(p_question_ids, ARRAY[]::text[])) AS x
  WHERE x IS NOT NULL AND btrim(x) <> '';

  IF coalesce(array_length(v_clean_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('updatedCount', 0, 'revertedCount', 0);
  END IF;

  UPDATE public.question_db q
  SET
    ai_solving_probability = CASE
      WHEN q.ai_solving_probability IS NULL
        AND q.solving_probability IS NOT NULL
        AND q.solving_probability <> 50
        AND coalesce(q.calibrated_sample_count, 0) = 0 THEN q.solving_probability
      ELSE q.ai_solving_probability
    END,
    ai_difficulty = CASE
      WHEN q.ai_difficulty IS NULL AND coalesce(q.calibrated_sample_count, 0) = 0 THEN q.difficulty
      ELSE q.ai_difficulty
    END
  WHERE q.question_id::text = ANY(v_clean_ids)
    AND coalesce(q.calibrated_sample_count, 0) = 0;

  WITH eligible_questions AS (
    SELECT
      q.question_id::text AS qid,
      q.ai_solving_probability,
      public.qcal_resolve_pre_spread_prior(
        q.question_id::text,
        q.ai_solving_probability,
        q.ai_difficulty,
        q.question_number,
        coalesce(q.book_name, q.source_book_name, q.pdf_source, ''),
        q.cognitive_level,
        q.problem_type
      ) AS pre_prior
    FROM public.question_db q
    WHERE q.question_id::text = ANY(v_clean_ids)
      AND NOT public.qcal_is_confidential_text(q.source_book_name)
      AND NOT public.qcal_is_confidential_text(q.book_name)
      AND NOT public.qcal_is_confidential_text(q.pdf_source)
      AND NOT public.qcal_is_confidential_text(q.raw_source_tags::text)
      AND NOT EXISTS (
        SELECT 1
        FROM public.exam_item ei
        JOIN public.exam_master em ON em.exam_id = ei.exam_id
        WHERE ei.question_id::text = q.question_id::text
          AND (public.qcal_is_confidential_text(em.exam_type) OR public.qcal_is_confidential_text(em.title))
      )
  ),
  matching_tqs AS (
    SELECT
      tq.tq_id,
      tq.tq_id::text AS tq_id_txt,
      coalesce(NULLIF(btrim(tq.question_id::text), ''), NULLIF(btrim(tq.raw_metadata->>'question_id'), '')) AS qid
    FROM public.textbook_question tq
    JOIN eligible_questions eq
      ON eq.qid = coalesce(NULLIF(btrim(tq.question_id::text), ''), NULLIF(btrim(tq.raw_metadata->>'question_id'), ''))
  ),
  dedup_obs AS (
    SELECT
      u.sid,
      u.qid,
      MIN(u.score)::double precision AS score
    FROM (
      SELECT
        sa.student_id::text AS sid,
        eq.qid,
        public.qcal_first_try_score(sa.grading_code, sa.is_correct, to_jsonb(sa)->'wrong_attempts_log') AS score
      FROM public.student_answer sa
      JOIN eligible_questions eq ON eq.qid = btrim(sa.question_id::text)
      LEFT JOIN public.student s ON s.student_id = sa.student_id
      LEFT JOIN public.exam_assignment ea ON ea.assignment_id = sa.exam_assignment_id
      LEFT JOIN public.exam_master em ON em.exam_id = ea.exam_id
      WHERE public.qcal_has_grade(sa.grading_code, sa.is_correct)
        AND regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') !~ '(테스트|선생님)'
        AND (ea.assignment_id IS NULL OR ea.admission_session_id IS NULL)
        AND NOT public.qcal_is_confidential_text(em.exam_type)
        AND NOT public.qcal_is_confidential_text(em.title)
        AND NOT public.qcal_is_wrong_review_exam(em.exam_type, em.title)
      UNION ALL
      SELECT
        sha.student_id::text AS sid,
        eq.qid,
        public.qcal_first_try_score(sha.grading_code, sha.is_correct, to_jsonb(sha)->'wrong_attempts_log') AS score
      FROM public.student_homework_answer sha
      JOIN eligible_questions eq ON eq.qid = btrim(sha.question_id::text)
      LEFT JOIN public.student s ON s.student_id = sha.student_id
      WHERE sha.question_id IS NOT NULL AND btrim(sha.question_id::text) <> ''
        AND public.qcal_has_grade(sha.grading_code, sha.is_correct)
        AND regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') !~ '(테스트|선생님)'
      UNION ALL
      SELECT
        sha.student_id::text AS sid,
        mt.qid,
        public.qcal_first_try_score(sha.grading_code, sha.is_correct, to_jsonb(sha)->'wrong_attempts_log') AS score
      FROM public.student_homework_answer sha
      JOIN matching_tqs mt ON mt.tq_id = sha.tq_id
      LEFT JOIN public.student s ON s.student_id = sha.student_id
      WHERE (sha.question_id IS NULL OR btrim(sha.question_id::text) = '')
        AND public.qcal_has_grade(sha.grading_code, sha.is_correct)
        AND regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') !~ '(테스트|선생님)'
      UNION ALL
      SELECT
        sir.student_id::text AS sid,
        eq.qid,
        0.0::double precision AS score
      FROM public.student_incorrect_record sir
      JOIN eligible_questions eq ON eq.qid = btrim(sir.question_id::text)
      LEFT JOIN public.student s ON s.student_id = sir.student_id
      WHERE sir.question_id IS NOT NULL AND btrim(sir.question_id::text) <> ''
        AND NOT public.qcal_is_confidential_text(sir.source_type)
        AND regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') !~ '(테스트|선생님)'
      UNION ALL
      SELECT
        sir.student_id::text AS sid,
        coalesce(mt.qid, eq2.qid) AS qid,
        0.0::double precision AS score
      FROM public.student_incorrect_record sir
      LEFT JOIN matching_tqs mt ON sir.tq_id IS NOT NULL AND mt.tq_id_txt = btrim(sir.tq_id::text)
      LEFT JOIN eligible_questions eq2 ON sir.tq_id IS NOT NULL AND eq2.qid = btrim(sir.tq_id::text)
      LEFT JOIN public.student s ON s.student_id = sir.student_id
      WHERE (sir.question_id IS NULL OR btrim(sir.question_id::text) = '')
        AND sir.tq_id IS NOT NULL
        AND coalesce(mt.qid, eq2.qid) IS NOT NULL
        AND NOT public.qcal_is_confidential_text(sir.source_type)
        AND regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') !~ '(테스트|선생님)'
    ) u
    GROUP BY u.sid, u.qid
  ),
  q_agg AS (
    SELECT
      d.qid,
      count(*)::integer AS n_cnt,
      sum(d.score)::double precision AS c_sum,
      avg(coalesce(st.theta_logit, 0.0))::double precision AS avg_theta
    FROM dedup_obs d
    LEFT JOIN public.student_ability_stat st ON st.student_id = d.sid
    GROUP BY d.qid
  ),
  calibrated_rows AS (
    SELECT
      eq.qid,
      qa.n_cnt,
      qa.c_sum,
      round((qa.c_sum / qa.n_cnt::double precision * 100.0)::numeric, 1) AS raw_pct,
      round(qa.avg_theta::numeric, 3) AS avg_theta_num,
      calc.prior_rate,
      calc.prior_is_null,
      calc.irt_rate,
      calc.final_rate,
      calc.final_difficulty
    FROM eligible_questions eq
    JOIN q_agg qa ON qa.qid = eq.qid
    CROSS JOIN LATERAL public.qcal_compute_calibrated_rate(
      eq.pre_prior, eq.ai_solving_probability, qa.n_cnt, qa.c_sum, qa.avg_theta
    ) calc
    WHERE qa.n_cnt > 0
  ),
  upsert_stat AS (
    INSERT INTO public.question_calibration_stat (
      question_id, prior_rate, prior_is_null, sample_count, correct_sum,
      raw_rate, avg_student_theta, irt_adjusted_rate, calibrated_rate,
      calibrated_difficulty, updated_at
    )
    SELECT
      qid, prior_rate, prior_is_null, n_cnt, c_sum,
      raw_pct, avg_theta_num, irt_rate, final_rate, final_difficulty, now()
    FROM calibrated_rows
    ON CONFLICT (question_id) DO UPDATE SET
      prior_rate = EXCLUDED.prior_rate,
      prior_is_null = EXCLUDED.prior_is_null,
      sample_count = EXCLUDED.sample_count,
      correct_sum = EXCLUDED.correct_sum,
      raw_rate = EXCLUDED.raw_rate,
      avg_student_theta = EXCLUDED.avg_student_theta,
      irt_adjusted_rate = EXCLUDED.irt_adjusted_rate,
      calibrated_rate = EXCLUDED.calibrated_rate,
      calibrated_difficulty = EXCLUDED.calibrated_difficulty,
      updated_at = now()
    RETURNING question_id
  ),
  upd_qdb AS (
    UPDATE public.question_db q
    SET
      solving_probability = cr.final_rate,
      difficulty = cr.final_difficulty,
      calibrated_sample_count = cr.n_cnt,
      calibrated_at = now(),
      updated_at = CASE
        WHEN q.solving_probability IS DISTINCT FROM cr.final_rate
          OR q.difficulty IS DISTINCT FROM cr.final_difficulty THEN now()
        ELSE q.updated_at
      END
    FROM calibrated_rows cr
    WHERE q.question_id::text = cr.qid
    RETURNING q.question_id::text AS qid, cr.final_difficulty AS new_diff
  ),
  upd_tq AS (
    UPDATE public.textbook_question tq
    SET difficulty = uq.new_diff
    FROM upd_qdb uq
    WHERE coalesce(NULLIF(btrim(tq.question_id::text), ''), NULLIF(btrim(tq.raw_metadata->>'question_id'), '')) = uq.qid
      AND tq.difficulty IS DISTINCT FROM uq.new_diff
    RETURNING tq.tq_id
  )
  SELECT count(*)::integer INTO v_updated_count FROM upd_qdb;

  WITH zero_now AS (
    SELECT
      q.question_id::text AS qid,
      GREATEST(
        15,
        LEAST(
          95,
          round(
            public.qcal_spread_around_50(
              public.qcal_resolve_pre_spread_prior(
                q.question_id::text,
                q.ai_solving_probability,
                q.ai_difficulty,
                q.question_number,
                coalesce(q.book_name, q.source_book_name, q.pdf_source, ''),
                q.cognitive_level,
                q.problem_type
              )
            )
          )::integer
        )
      ) AS rev_prob
    FROM public.question_db q
    WHERE q.question_id::text = ANY(v_clean_ids)
      AND coalesce(q.calibrated_sample_count, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.question_calibration_stat s
        WHERE s.question_id = q.question_id::text
          AND s.updated_at >= now() - interval '2 seconds'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.student_answer sa
        LEFT JOIN public.exam_assignment ea ON ea.assignment_id = sa.exam_assignment_id
        LEFT JOIN public.exam_master em ON em.exam_id = ea.exam_id
        WHERE btrim(sa.question_id::text) = q.question_id::text
          AND public.qcal_has_grade(sa.grading_code, sa.is_correct)
          AND (ea.assignment_id IS NULL OR ea.admission_session_id IS NULL)
          AND NOT public.qcal_is_confidential_text(em.exam_type)
          AND NOT public.qcal_is_confidential_text(em.title)
          AND NOT public.qcal_is_wrong_review_exam(em.exam_type, em.title)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.student_homework_answer sha
        LEFT JOIN public.textbook_question tq ON tq.tq_id = sha.tq_id
        WHERE coalesce(
            NULLIF(btrim(sha.question_id::text), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), '')
          ) = q.question_id::text
          AND public.qcal_has_grade(sha.grading_code, sha.is_correct)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.student_incorrect_record sir
        LEFT JOIN public.textbook_question tq
          ON sir.tq_id IS NOT NULL AND sir.tq_id::text !~ '-' AND tq.tq_id::text = sir.tq_id::text
        WHERE coalesce(
            NULLIF(btrim(sir.question_id::text), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), ''),
            CASE WHEN sir.tq_id::text ~ '-' THEN btrim(sir.tq_id::text) ELSE NULL END
          ) = q.question_id::text
          AND NOT public.qcal_is_confidential_text(sir.source_type)
      )
  ),
  del_stat AS (
    DELETE FROM public.question_calibration_stat s USING zero_now z WHERE s.question_id = z.qid
  ),
  rev_qdb AS (
    UPDATE public.question_db q
    SET
      solving_probability = z.rev_prob,
      difficulty = public.qcal_diff_label_by_rate(z.rev_prob),
      calibrated_sample_count = 0,
      calibrated_at = NULL,
      updated_at = now()
    FROM zero_now z
    WHERE q.question_id::text = z.qid
    RETURNING q.question_id::text AS qid, public.qcal_diff_label_by_rate(z.rev_prob) AS orig_diff
  ),
  rev_tq AS (
    UPDATE public.textbook_question tq
    SET difficulty = rq.orig_diff
    FROM rev_qdb rq
    WHERE coalesce(NULLIF(btrim(tq.question_id::text), ''), NULLIF(btrim(tq.raw_metadata->>'question_id'), '')) = rq.qid
      AND tq.difficulty IS DISTINCT FROM rq.orig_diff
  )
  SELECT count(*)::integer INTO v_reverted_count FROM rev_qdb;

  RETURN jsonb_build_object('updatedCount', v_updated_count, 'revertedCount', v_reverted_count);
END;
$qcal_qids$;

-- 6. 전체 DB 일괄 순회 보정 RPC (50% 중심 점진 분산 + 새 난이도 구간 전수 재분류)
CREATE OR REPLACE FUNCTION public.recalibrate_all_question_rates(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $qcal_all$
DECLARE
  v_students_updated integer := 0;
  v_total_calibrated integer := 0;
  v_changed_prob integer := 0;
  v_changed_diff integer := 0;
  v_null_prior_cnt integer := 0;
  v_baseline_shifted integer := 0;
  v_baseline_diff_shifted integer := 0;
  v_target_qids text[] := ARRAY[]::text[];
  v_samples jsonb := '[]'::jsonb;
  v_diff_dist jsonb := '{}'::jsonb;
BEGIN
  IF NOT p_dry_run THEN
    UPDATE public.question_db
    SET
      ai_solving_probability = CASE
        WHEN ai_solving_probability IS NULL
          AND solving_probability IS NOT NULL
          AND solving_probability <> 50
          AND coalesce(calibrated_sample_count, 0) = 0 THEN solving_probability
        ELSE ai_solving_probability
      END,
      ai_difficulty = CASE
        WHEN ai_difficulty IS NULL AND coalesce(calibrated_sample_count, 0) = 0 THEN difficulty
        ELSE ai_difficulty
      END
    WHERE coalesce(calibrated_sample_count, 0) = 0
      AND (
        (ai_solving_probability IS NULL AND solving_probability IS NOT NULL AND solving_probability <> 50)
        OR (ai_difficulty IS NULL AND difficulty IS NOT NULL)
      );
  END IF;

  v_students_updated := public.refresh_student_ability_stats(NULL);

  WITH confidential_qids AS (
    SELECT q.question_id::text AS qid
    FROM public.question_db q
    WHERE public.qcal_is_confidential_text(q.source_book_name)
       OR public.qcal_is_confidential_text(q.book_name)
       OR public.qcal_is_confidential_text(q.pdf_source)
       OR public.qcal_is_confidential_text(q.raw_source_tags::text)
    UNION
    SELECT ei.question_id::text AS qid
    FROM public.exam_item ei
    JOIN public.exam_master em ON em.exam_id = ei.exam_id
    WHERE ei.question_id IS NOT NULL
      AND (public.qcal_is_confidential_text(em.exam_type) OR public.qcal_is_confidential_text(em.title))
  ),
  dedup_obs AS (
    SELECT
      u.sid,
      u.qid,
      MIN(u.score)::double precision AS score
    FROM (
      SELECT
        sa.student_id::text AS sid,
        btrim(sa.question_id::text) AS qid,
        public.qcal_first_try_score(sa.grading_code, sa.is_correct, to_jsonb(sa)->'wrong_attempts_log') AS score
      FROM public.student_answer sa
      LEFT JOIN public.student s ON s.student_id = sa.student_id
      LEFT JOIN public.exam_assignment ea ON ea.assignment_id = sa.exam_assignment_id
      LEFT JOIN public.exam_master em ON em.exam_id = ea.exam_id
      WHERE sa.question_id IS NOT NULL
        AND public.qcal_has_grade(sa.grading_code, sa.is_correct)
        AND regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') !~ '(테스트|선생님)'
        AND (ea.assignment_id IS NULL OR ea.admission_session_id IS NULL)
        AND NOT public.qcal_is_confidential_text(em.exam_type)
        AND NOT public.qcal_is_confidential_text(em.title)
        AND NOT public.qcal_is_wrong_review_exam(em.exam_type, em.title)
      UNION ALL
      SELECT
        sha.student_id::text AS sid,
        btrim(
          coalesce(
            NULLIF(btrim(sha.question_id::text), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), '')
          )
        ) AS qid,
        public.qcal_first_try_score(sha.grading_code, sha.is_correct, to_jsonb(sha)->'wrong_attempts_log') AS score
      FROM public.student_homework_answer sha
      LEFT JOIN public.student s ON s.student_id = sha.student_id
      LEFT JOIN public.textbook_question tq
        ON (sha.question_id IS NULL OR btrim(sha.question_id::text) = '')
       AND sha.tq_id IS NOT NULL AND tq.tq_id = sha.tq_id
      WHERE public.qcal_has_grade(sha.grading_code, sha.is_correct)
        AND regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') !~ '(테스트|선생님)'
        AND coalesce(
          NULLIF(btrim(sha.question_id::text), ''),
          NULLIF(btrim(tq.question_id::text), ''),
          NULLIF(btrim(tq.raw_metadata->>'question_id'), '')
        ) IS NOT NULL
      UNION ALL
      SELECT
        sir.student_id::text AS sid,
        btrim(
          coalesce(
            NULLIF(btrim(sir.question_id::text), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), ''),
            CASE WHEN sir.tq_id::text ~ '-' THEN btrim(sir.tq_id::text) ELSE NULL END
          )
        ) AS qid,
        0.0::double precision AS score
      FROM public.student_incorrect_record sir
      LEFT JOIN public.student s ON s.student_id = sir.student_id
      LEFT JOIN public.textbook_question tq
        ON (sir.question_id IS NULL OR btrim(sir.question_id::text) = '')
       AND sir.tq_id IS NOT NULL
       AND sir.tq_id::text !~ '-'
       AND tq.tq_id::text = sir.tq_id::text
      WHERE NOT public.qcal_is_confidential_text(sir.source_type)
        AND regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') !~ '(테스트|선생님)'
        AND coalesce(
          NULLIF(btrim(sir.question_id::text), ''),
          NULLIF(btrim(tq.question_id::text), ''),
          NULLIF(btrim(tq.raw_metadata->>'question_id'), ''),
          CASE WHEN sir.tq_id::text ~ '-' THEN btrim(sir.tq_id::text) ELSE NULL END
        ) IS NOT NULL
    ) u
    LEFT JOIN confidential_qids cq ON cq.qid = u.qid
    WHERE u.qid <> '' AND cq.qid IS NULL
    GROUP BY u.sid, u.qid
  ),
  q_agg AS (
    SELECT
      d.qid,
      count(*)::integer AS n_cnt,
      sum(d.score)::double precision AS c_sum,
      avg(coalesce(st.theta_logit, 0.0))::double precision AS avg_theta
    FROM dedup_obs d
    LEFT JOIN public.student_ability_stat st ON st.student_id = d.sid
    GROUP BY d.qid
  ),
  computed AS (
    SELECT
      q.question_id::text AS qid,
      coalesce(q.book_name, q.source_book_name, q.pdf_source, '미지정 교재') AS book_label,
      coalesce(q.question_number, '-') AS q_num,
      q.solving_probability AS before_prob,
      q.difficulty AS before_diff,
      qa.n_cnt,
      round((qa.c_sum / qa.n_cnt::double precision * 100.0)::numeric, 1) AS raw_pct,
      round(qa.avg_theta::numeric, 3) AS avg_theta_num,
      calc.prior_rate,
      calc.prior_is_null,
      calc.irt_rate,
      calc.final_rate,
      calc.final_difficulty
    FROM q_agg qa
    JOIN public.question_db q ON q.question_id::text = qa.qid
    LEFT JOIN confidential_qids cq ON cq.qid = qa.qid
    CROSS JOIN LATERAL public.qcal_compute_calibrated_rate(
      public.qcal_resolve_pre_spread_prior(
        q.question_id::text,
        q.ai_solving_probability,
        q.ai_difficulty,
        q.question_number,
        coalesce(q.book_name, q.source_book_name, q.pdf_source, ''),
        q.cognitive_level,
        q.problem_type
      ),
      q.ai_solving_probability,
      qa.n_cnt,
      qa.c_sum,
      qa.avg_theta
    ) calc
    WHERE cq.qid IS NULL AND qa.n_cnt > 0
  )
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE before_prob IS DISTINCT FROM final_rate)::integer,
    count(*) FILTER (WHERE coalesce(before_diff, '') IS DISTINCT FROM final_difficulty)::integer,
    count(*) FILTER (WHERE prior_is_null)::integer,
    coalesce(array_agg(qid), ARRAY[]::text[]),
    coalesce(
      (
        SELECT jsonb_agg(row_to_json(t))
        FROM (
          SELECT
            qid AS "questionId",
            book_label AS "bookName",
            q_num AS "questionNumber",
            prior_rate AS "priorRate",
            prior_is_null AS "priorWasNull",
            before_prob AS "beforeRate",
            before_diff AS "beforeDifficulty",
            n_cnt AS "sampleCount",
            raw_pct AS "rawRate",
            avg_theta_num AS "avgStudentTheta",
            irt_rate AS "irtRate",
            final_rate AS "afterRate",
            final_difficulty AS "afterDifficulty"
          FROM computed
          ORDER BY abs(final_rate - coalesce(before_prob, 50)) DESC, n_cnt DESC
          LIMIT 50
        ) t
      ),
      '[]'::jsonb
    )
  INTO
    v_total_calibrated,
    v_changed_prob,
    v_changed_diff,
    v_null_prior_cnt,
    v_target_qids,
    v_samples
  FROM computed;

  IF NOT p_dry_run THEN
    -- 1) 정오답/오답노트 데이터가 있는 문항들(N > 0) 정밀 분산 보정 적용
    IF coalesce(array_length(v_target_qids, 1), 0) > 0 THEN
      PERFORM public.recalibrate_questions_by_ids(v_target_qids);
    END IF;

    -- 2) 아직 풀이 데이터가 없는 모든 일반 문항(N = 0, 입학테스트·진단평가 제외)도
    --    50% 중심 점진 분산(45%->40%, 55%->60%) + 새 난이도 구간(최상~최하)으로 일괄 재분류!
    WITH confidential_qids AS (
      SELECT q.question_id::text AS qid
      FROM public.question_db q
      WHERE public.qcal_is_confidential_text(q.source_book_name)
         OR public.qcal_is_confidential_text(q.book_name)
         OR public.qcal_is_confidential_text(q.pdf_source)
         OR public.qcal_is_confidential_text(q.raw_source_tags::text)
      UNION
      SELECT ei.question_id::text AS qid
      FROM public.exam_item ei
      JOIN public.exam_master em ON em.exam_id = ei.exam_id
      WHERE ei.question_id IS NOT NULL
        AND (public.qcal_is_confidential_text(em.exam_type) OR public.qcal_is_confidential_text(em.title))
    ),
    base_targets AS (
      SELECT
        q.question_id::text AS qid,
        q.solving_probability AS old_prob,
        q.difficulty AS old_diff,
        p.new_prob,
        public.qcal_diff_label_by_rate(p.new_prob) AS new_diff
      FROM public.question_db q
      LEFT JOIN confidential_qids cq ON cq.qid = q.question_id::text
      CROSS JOIN LATERAL (
        SELECT GREATEST(
          15,
          LEAST(
            95,
            round(
              public.qcal_spread_around_50(
                public.qcal_resolve_pre_spread_prior(
                  q.question_id::text,
                  q.ai_solving_probability,
                  q.ai_difficulty,
                  q.question_number,
                  coalesce(q.book_name, q.source_book_name, q.pdf_source, ''),
                  q.cognitive_level,
                  q.problem_type
                )
              )
            )::integer
          )
        ) AS new_prob
      ) p
      WHERE cq.qid IS NULL
        AND NOT (q.question_id::text = ANY(v_target_qids))
    ),
    upd_base AS (
      UPDATE public.question_db q
      SET
        solving_probability = bt.new_prob,
        difficulty = bt.new_diff,
        calibrated_sample_count = 0,
        updated_at = now()
      FROM base_targets bt
      WHERE q.question_id::text = bt.qid
        AND (
          q.solving_probability IS DISTINCT FROM bt.new_prob
          OR q.difficulty IS DISTINCT FROM bt.new_diff
        )
      RETURNING
        q.question_id::text AS qid,
        bt.old_prob,
        bt.new_prob,
        bt.old_diff,
        bt.new_diff
    ),
    sync_tq AS (
      UPDATE public.textbook_question tq
      SET difficulty = ub.new_diff
      FROM upd_base ub
      WHERE coalesce(NULLIF(btrim(tq.question_id::text), ''), NULLIF(btrim(tq.raw_metadata->>'question_id'), '')) = ub.qid
        AND tq.difficulty IS DISTINCT FROM ub.new_diff
    )
    SELECT
      count(*) FILTER (WHERE old_prob IS DISTINCT FROM new_prob)::integer,
      count(*) FILTER (WHERE coalesce(old_diff, '') IS DISTINCT FROM new_diff)::integer
    INTO v_baseline_shifted, v_baseline_diff_shifted
    FROM upd_base;
  ELSE
    WITH confidential_qids AS (
      SELECT q.question_id::text AS qid
      FROM public.question_db q
      WHERE public.qcal_is_confidential_text(q.source_book_name)
         OR public.qcal_is_confidential_text(q.book_name)
         OR public.qcal_is_confidential_text(q.pdf_source)
         OR public.qcal_is_confidential_text(q.raw_source_tags::text)
      UNION
      SELECT ei.question_id::text AS qid
      FROM public.exam_item ei
      JOIN public.exam_master em ON em.exam_id = ei.exam_id
      WHERE ei.question_id IS NOT NULL
        AND (public.qcal_is_confidential_text(em.exam_type) OR public.qcal_is_confidential_text(em.title))
    ),
    sim_base AS (
      SELECT
        q.solving_probability AS old_prob,
        q.difficulty AS old_diff,
        GREATEST(
          15,
          LEAST(
            95,
            round(
              public.qcal_spread_around_50(
                public.qcal_resolve_pre_spread_prior(
                  q.question_id::text,
                  q.ai_solving_probability,
                  q.ai_difficulty,
                  q.question_number,
                  coalesce(q.book_name, q.source_book_name, q.pdf_source, ''),
                  q.cognitive_level,
                  q.problem_type
                )
              )
            )::integer
          )
        ) AS new_prob
      FROM public.question_db q
      LEFT JOIN confidential_qids cq ON cq.qid = q.question_id::text
      WHERE cq.qid IS NULL
        AND NOT (q.question_id::text = ANY(v_target_qids))
    )
    SELECT
      count(*) FILTER (WHERE old_prob IS DISTINCT FROM new_prob)::integer,
      count(*) FILTER (WHERE coalesce(old_diff, '') IS DISTINCT FROM public.qcal_diff_label_by_rate(new_prob))::integer
    INTO v_baseline_shifted, v_baseline_diff_shifted
    FROM sim_base;
  END IF;

  -- 최종 일반 문항 전체 난이도 분포 집계 반환 (문항공장 대시보드 동일 모수)
  WITH confidential_qids AS (
    SELECT q.question_id::text AS qid
    FROM public.question_db q
    WHERE public.qcal_is_confidential_text(q.source_book_name)
       OR public.qcal_is_confidential_text(q.book_name)
       OR public.qcal_is_confidential_text(q.pdf_source)
       OR public.qcal_is_confidential_text(q.raw_source_tags::text)
    UNION
    SELECT ei.question_id::text AS qid
    FROM public.exam_item ei
    JOIN public.exam_master em ON em.exam_id = ei.exam_id
    WHERE ei.question_id IS NOT NULL
      AND (public.qcal_is_confidential_text(em.exam_type) OR public.qcal_is_confidential_text(em.title))
  )
  SELECT jsonb_build_object(
    '최상', count(*) FILTER (WHERE q.difficulty = '최상'),
    '상', count(*) FILTER (WHERE q.difficulty = '상'),
    '중', count(*) FILTER (WHERE q.difficulty = '중'),
    '하', count(*) FILTER (WHERE q.difficulty = '하'),
    '최하', count(*) FILTER (WHERE q.difficulty = '최하')
  )
  INTO v_diff_dist
  FROM public.question_db q
  LEFT JOIN confidential_qids cq ON cq.qid = q.question_id::text
  WHERE cq.qid IS NULL;

  RETURN jsonb_build_object(
    'dryRun', p_dry_run,
    'engine', 'postgres_rpc',
    'studentsEvaluated', v_students_updated,
    'calibratedQuestions', v_total_calibrated,
    'baselineShiftedQuestions', v_baseline_shifted,
    'changedProbabilityCount', v_changed_prob + v_baseline_shifted,
    'changedDifficultyCount', v_changed_diff + v_baseline_diff_shifted,
    'nullPriorCount', v_null_prior_cnt,
    'difficultyDistribution', v_diff_dist,
    'previewItems', v_samples
  );
END;
$qcal_all$;

GRANT EXECUTE ON FUNCTION public.refresh_student_ability_stats(text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recalibrate_questions_by_ids(text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recalibrate_all_question_rates(boolean) TO authenticated, service_role;

-- 7. 실시간 자동 보정 트리거 (student_answer / student_homework_answer / student_incorrect_record)
CREATE OR REPLACE FUNCTION public.trg_fn_sa_realtime_calibrate_ins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $qcal_t1$
DECLARE v_sids text[]; v_qids text[];
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  BEGIN
    SELECT
      array_agg(DISTINCT nr.student_id::text) FILTER (WHERE nr.student_id IS NOT NULL),
      array_agg(DISTINCT btrim(nr.question_id::text)) FILTER (WHERE nr.question_id IS NOT NULL AND btrim(nr.question_id::text) <> '')
    INTO v_sids, v_qids
    FROM new_rows nr
    WHERE public.qcal_has_grade(nr.grading_code, nr.is_correct);
    IF coalesce(array_length(v_sids, 1), 0) > 0 THEN PERFORM public.refresh_student_ability_stats(v_sids); END IF;
    IF coalesce(array_length(v_qids, 1), 0) > 0 THEN PERFORM public.recalibrate_questions_by_ids(v_qids); END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '[qcal sa_ins] %', SQLERRM; END;
  RETURN NULL;
END;
$qcal_t1$;

CREATE OR REPLACE FUNCTION public.trg_fn_sa_realtime_calibrate_upd()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $qcal_t2$
DECLARE v_sids text[]; v_qids text[];
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  BEGIN
    WITH changed AS (
      SELECT student_id::text AS sid, btrim(question_id::text) AS qid FROM new_rows
      UNION
      SELECT student_id::text AS sid, btrim(question_id::text) AS qid FROM old_rows
    )
    SELECT
      array_agg(DISTINCT sid) FILTER (WHERE sid IS NOT NULL AND sid <> ''),
      array_agg(DISTINCT qid) FILTER (WHERE qid IS NOT NULL AND qid <> '')
    INTO v_sids, v_qids FROM changed;
    IF coalesce(array_length(v_sids, 1), 0) > 0 THEN PERFORM public.refresh_student_ability_stats(v_sids); END IF;
    IF coalesce(array_length(v_qids, 1), 0) > 0 THEN PERFORM public.recalibrate_questions_by_ids(v_qids); END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '[qcal sa_upd] %', SQLERRM; END;
  RETURN NULL;
END;
$qcal_t2$;

CREATE OR REPLACE FUNCTION public.trg_fn_sa_realtime_calibrate_del()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $qcal_t3$
DECLARE v_sids text[]; v_qids text[];
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  BEGIN
    SELECT
      array_agg(DISTINCT orw.student_id::text) FILTER (WHERE orw.student_id IS NOT NULL),
      array_agg(DISTINCT btrim(orw.question_id::text)) FILTER (WHERE orw.question_id IS NOT NULL AND btrim(orw.question_id::text) <> '')
    INTO v_sids, v_qids
    FROM old_rows orw
    WHERE public.qcal_has_grade(orw.grading_code, orw.is_correct);
    IF coalesce(array_length(v_sids, 1), 0) > 0 THEN PERFORM public.refresh_student_ability_stats(v_sids); END IF;
    IF coalesce(array_length(v_qids, 1), 0) > 0 THEN PERFORM public.recalibrate_questions_by_ids(v_qids); END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '[qcal sa_del] %', SQLERRM; END;
  RETURN NULL;
END;
$qcal_t3$;

DROP TRIGGER IF EXISTS trg_sa_realtime_calibrate_ins ON public.student_answer;
CREATE TRIGGER trg_sa_realtime_calibrate_ins AFTER INSERT ON public.student_answer
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_fn_sa_realtime_calibrate_ins();

DROP TRIGGER IF EXISTS trg_sa_realtime_calibrate_upd ON public.student_answer;
CREATE TRIGGER trg_sa_realtime_calibrate_upd AFTER UPDATE ON public.student_answer
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_fn_sa_realtime_calibrate_upd();

DROP TRIGGER IF EXISTS trg_sa_realtime_calibrate_del ON public.student_answer;
CREATE TRIGGER trg_sa_realtime_calibrate_del AFTER DELETE ON public.student_answer
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_fn_sa_realtime_calibrate_del();

CREATE OR REPLACE FUNCTION public.trg_fn_sha_realtime_calibrate_ins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $qcal_t4$
DECLARE v_sids text[]; v_qids text[];
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  BEGIN
    SELECT
      array_agg(DISTINCT nr.student_id::text) FILTER (WHERE nr.student_id IS NOT NULL),
      array_agg(
        DISTINCT btrim(
          coalesce(
            NULLIF(btrim(nr.question_id::text), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), '')
          )
        )
      ) FILTER (
        WHERE coalesce(
          NULLIF(btrim(nr.question_id::text), ''),
          NULLIF(btrim(tq.question_id::text), ''),
          NULLIF(btrim(tq.raw_metadata->>'question_id'), '')
        ) IS NOT NULL
      )
    INTO v_sids, v_qids
    FROM new_rows nr
    LEFT JOIN public.textbook_question tq
      ON (nr.question_id IS NULL OR btrim(nr.question_id::text) = '') AND nr.tq_id IS NOT NULL AND tq.tq_id = nr.tq_id
    WHERE public.qcal_has_grade(nr.grading_code, nr.is_correct);
    IF coalesce(array_length(v_sids, 1), 0) > 0 THEN PERFORM public.refresh_student_ability_stats(v_sids); END IF;
    IF coalesce(array_length(v_qids, 1), 0) > 0 THEN PERFORM public.recalibrate_questions_by_ids(v_qids); END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '[qcal sha_ins] %', SQLERRM; END;
  RETURN NULL;
END;
$qcal_t4$;

CREATE OR REPLACE FUNCTION public.trg_fn_sha_realtime_calibrate_upd()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $qcal_t5$
DECLARE v_sids text[]; v_qids text[];
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  BEGIN
    WITH raw_changed AS (
      SELECT student_id::text AS sid, question_id::text AS raw_qid, tq_id FROM new_rows
      UNION
      SELECT student_id::text AS sid, question_id::text AS raw_qid, tq_id FROM old_rows
    )
    SELECT
      array_agg(DISTINCT rc.sid) FILTER (WHERE rc.sid IS NOT NULL AND rc.sid <> ''),
      array_agg(
        DISTINCT btrim(
          coalesce(
            NULLIF(btrim(rc.raw_qid), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), '')
          )
        )
      ) FILTER (
        WHERE coalesce(
          NULLIF(btrim(rc.raw_qid), ''),
          NULLIF(btrim(tq.question_id::text), ''),
          NULLIF(btrim(tq.raw_metadata->>'question_id'), '')
        ) IS NOT NULL
      )
    INTO v_sids, v_qids
    FROM raw_changed rc
    LEFT JOIN public.textbook_question tq
      ON (rc.raw_qid IS NULL OR btrim(rc.raw_qid) = '') AND rc.tq_id IS NOT NULL AND tq.tq_id = rc.tq_id;
    IF coalesce(array_length(v_sids, 1), 0) > 0 THEN PERFORM public.refresh_student_ability_stats(v_sids); END IF;
    IF coalesce(array_length(v_qids, 1), 0) > 0 THEN PERFORM public.recalibrate_questions_by_ids(v_qids); END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '[qcal sha_upd] %', SQLERRM; END;
  RETURN NULL;
END;
$qcal_t5$;

CREATE OR REPLACE FUNCTION public.trg_fn_sha_realtime_calibrate_del()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $qcal_t6$
DECLARE v_sids text[]; v_qids text[];
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  BEGIN
    SELECT
      array_agg(DISTINCT orw.student_id::text) FILTER (WHERE orw.student_id IS NOT NULL),
      array_agg(
        DISTINCT btrim(
          coalesce(
            NULLIF(btrim(orw.question_id::text), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), '')
          )
        )
      ) FILTER (
        WHERE coalesce(
          NULLIF(btrim(orw.question_id::text), ''),
          NULLIF(btrim(tq.question_id::text), ''),
          NULLIF(btrim(tq.raw_metadata->>'question_id'), '')
        ) IS NOT NULL
      )
    INTO v_sids, v_qids
    FROM old_rows orw
    LEFT JOIN public.textbook_question tq
      ON (orw.question_id IS NULL OR btrim(orw.question_id::text) = '') AND orw.tq_id IS NOT NULL AND tq.tq_id = orw.tq_id
    WHERE public.qcal_has_grade(orw.grading_code, orw.is_correct);
    IF coalesce(array_length(v_sids, 1), 0) > 0 THEN PERFORM public.refresh_student_ability_stats(v_sids); END IF;
    IF coalesce(array_length(v_qids, 1), 0) > 0 THEN PERFORM public.recalibrate_questions_by_ids(v_qids); END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '[qcal sha_del] %', SQLERRM; END;
  RETURN NULL;
END;
$qcal_t6$;

DROP TRIGGER IF EXISTS trg_sha_realtime_calibrate_ins ON public.student_homework_answer;
CREATE TRIGGER trg_sha_realtime_calibrate_ins AFTER INSERT ON public.student_homework_answer
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_fn_sha_realtime_calibrate_ins();

DROP TRIGGER IF EXISTS trg_sha_realtime_calibrate_upd ON public.student_homework_answer;
CREATE TRIGGER trg_sha_realtime_calibrate_upd AFTER UPDATE ON public.student_homework_answer
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_fn_sha_realtime_calibrate_upd();

DROP TRIGGER IF EXISTS trg_sha_realtime_calibrate_del ON public.student_homework_answer;
CREATE TRIGGER trg_sha_realtime_calibrate_del AFTER DELETE ON public.student_homework_answer
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_fn_sha_realtime_calibrate_del();

CREATE OR REPLACE FUNCTION public.trg_fn_sir_realtime_calibrate_ins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $qcal_t7$
DECLARE v_sids text[]; v_qids text[];
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  BEGIN
    SELECT
      array_agg(DISTINCT nr.student_id::text) FILTER (WHERE nr.student_id IS NOT NULL),
      array_agg(
        DISTINCT btrim(
          coalesce(
            NULLIF(btrim(nr.question_id::text), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), ''),
            CASE WHEN nr.tq_id::text ~ '-' THEN btrim(nr.tq_id::text) ELSE NULL END
          )
        )
      ) FILTER (
        WHERE coalesce(
          NULLIF(btrim(nr.question_id::text), ''),
          NULLIF(btrim(tq.question_id::text), ''),
          NULLIF(btrim(tq.raw_metadata->>'question_id'), ''),
          CASE WHEN nr.tq_id::text ~ '-' THEN btrim(nr.tq_id::text) ELSE NULL END
        ) IS NOT NULL
      )
    INTO v_sids, v_qids
    FROM new_rows nr
    LEFT JOIN public.textbook_question tq
      ON (nr.question_id IS NULL OR btrim(nr.question_id::text) = '')
     AND nr.tq_id IS NOT NULL AND nr.tq_id::text !~ '-' AND tq.tq_id::text = nr.tq_id::text
    WHERE NOT public.qcal_is_confidential_text(nr.source_type);
    IF coalesce(array_length(v_sids, 1), 0) > 0 THEN PERFORM public.refresh_student_ability_stats(v_sids); END IF;
    IF coalesce(array_length(v_qids, 1), 0) > 0 THEN PERFORM public.recalibrate_questions_by_ids(v_qids); END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '[qcal sir_ins] %', SQLERRM; END;
  RETURN NULL;
END;
$qcal_t7$;

CREATE OR REPLACE FUNCTION public.trg_fn_sir_realtime_calibrate_upd()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $qcal_t8$
DECLARE v_sids text[]; v_qids text[];
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  BEGIN
    WITH raw_changed AS (
      SELECT student_id::text AS sid, question_id::text AS raw_qid, tq_id::text AS raw_tqid FROM new_rows
      UNION
      SELECT student_id::text AS sid, question_id::text AS raw_qid, tq_id::text AS raw_tqid FROM old_rows
    )
    SELECT
      array_agg(DISTINCT rc.sid) FILTER (WHERE rc.sid IS NOT NULL AND rc.sid <> ''),
      array_agg(
        DISTINCT btrim(
          coalesce(
            NULLIF(btrim(rc.raw_qid), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), ''),
            CASE WHEN rc.raw_tqid ~ '-' THEN btrim(rc.raw_tqid) ELSE NULL END
          )
        )
      ) FILTER (
        WHERE coalesce(
          NULLIF(btrim(rc.raw_qid), ''),
          NULLIF(btrim(tq.question_id::text), ''),
          NULLIF(btrim(tq.raw_metadata->>'question_id'), ''),
          CASE WHEN rc.raw_tqid ~ '-' THEN btrim(rc.raw_tqid) ELSE NULL END
        ) IS NOT NULL
      )
    INTO v_sids, v_qids
    FROM raw_changed rc
    LEFT JOIN public.textbook_question tq
      ON (rc.raw_qid IS NULL OR btrim(rc.raw_qid) = '')
     AND rc.raw_tqid IS NOT NULL AND rc.raw_tqid !~ '-' AND tq.tq_id::text = rc.raw_tqid;
    IF coalesce(array_length(v_sids, 1), 0) > 0 THEN PERFORM public.refresh_student_ability_stats(v_sids); END IF;
    IF coalesce(array_length(v_qids, 1), 0) > 0 THEN PERFORM public.recalibrate_questions_by_ids(v_qids); END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '[qcal sir_upd] %', SQLERRM; END;
  RETURN NULL;
END;
$qcal_t8$;

CREATE OR REPLACE FUNCTION public.trg_fn_sir_realtime_calibrate_del()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $qcal_t9$
DECLARE v_sids text[]; v_qids text[];
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  BEGIN
    SELECT
      array_agg(DISTINCT orw.student_id::text) FILTER (WHERE orw.student_id IS NOT NULL),
      array_agg(
        DISTINCT btrim(
          coalesce(
            NULLIF(btrim(orw.question_id::text), ''),
            NULLIF(btrim(tq.question_id::text), ''),
            NULLIF(btrim(tq.raw_metadata->>'question_id'), ''),
            CASE WHEN orw.tq_id::text ~ '-' THEN btrim(orw.tq_id::text) ELSE NULL END
          )
        )
      ) FILTER (
        WHERE coalesce(
          NULLIF(btrim(orw.question_id::text), ''),
          NULLIF(btrim(tq.question_id::text), ''),
          NULLIF(btrim(tq.raw_metadata->>'question_id'), ''),
          CASE WHEN orw.tq_id::text ~ '-' THEN btrim(orw.tq_id::text) ELSE NULL END
        ) IS NOT NULL
      )
    INTO v_sids, v_qids
    FROM old_rows orw
    LEFT JOIN public.textbook_question tq
      ON (orw.question_id IS NULL OR btrim(orw.question_id::text) = '')
     AND orw.tq_id IS NOT NULL AND orw.tq_id::text !~ '-' AND tq.tq_id::text = orw.tq_id::text
    WHERE NOT public.qcal_is_confidential_text(orw.source_type);
    IF coalesce(array_length(v_sids, 1), 0) > 0 THEN PERFORM public.refresh_student_ability_stats(v_sids); END IF;
    IF coalesce(array_length(v_qids, 1), 0) > 0 THEN PERFORM public.recalibrate_questions_by_ids(v_qids); END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '[qcal sir_del] %', SQLERRM; END;
  RETURN NULL;
END;
$qcal_t9$;

DROP TRIGGER IF EXISTS trg_sir_realtime_calibrate_ins ON public.student_incorrect_record;
CREATE TRIGGER trg_sir_realtime_calibrate_ins AFTER INSERT ON public.student_incorrect_record
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_fn_sir_realtime_calibrate_ins();

DROP TRIGGER IF EXISTS trg_sir_realtime_calibrate_upd ON public.student_incorrect_record;
CREATE TRIGGER trg_sir_realtime_calibrate_upd AFTER UPDATE ON public.student_incorrect_record
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_fn_sir_realtime_calibrate_upd();

DROP TRIGGER IF EXISTS trg_sir_realtime_calibrate_del ON public.student_incorrect_record;
CREATE TRIGGER trg_sir_realtime_calibrate_del AFTER DELETE ON public.student_incorrect_record
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_fn_sir_realtime_calibrate_del();

NOTIFY pgrst, 'reload schema';

-- 8. 🌟 설치 즉시 50% 중심 분산 + 새 난이도 구간(최상~최하) 기준으로 DB 전체 일괄 재분류!
SELECT public.recalibrate_all_question_rates(false) AS initial_calibration_result;
