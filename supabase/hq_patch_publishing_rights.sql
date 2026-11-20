-- ============================================================================
-- 본부(HQ · 출판사) 출판권 · 저작권 · 인세 · ISBN 확장 패치 (2026-11)
--  · hq_contract    : 도서 연결(pub_id) / 출판권 약정 조건(rights_meta)
--                     / 전자서명 감사 추적(sign_meta) / 원격 서명 링크 토큰(sign_token)
--  · hq_publication : ISBN 상태 · 부가기호 · CIP · 납본 · 판권면 체크 · 쇄 이력(pub_meta)
-- 기존 데이터는 그대로 유지되며, 여러 번 실행해도 안전합니다.
-- ============================================================================

ALTER TABLE public.hq_contract ADD COLUMN IF NOT EXISTS pub_id uuid REFERENCES public.hq_publication(pub_id) ON DELETE SET NULL;
ALTER TABLE public.hq_contract ADD COLUMN IF NOT EXISTS rights_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.hq_contract ADD COLUMN IF NOT EXISTS sign_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.hq_contract ADD COLUMN IF NOT EXISTS sign_token text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hq_contract_sign_token ON public.hq_contract(sign_token) WHERE sign_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hq_contract_pub ON public.hq_contract(pub_id);

ALTER TABLE public.hq_publication ADD COLUMN IF NOT EXISTS pub_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_hq_publication_isbn ON public.hq_publication(isbn) WHERE isbn IS NOT NULL;

-- PostgREST 스키마 캐시 즉시 갱신
NOTIFY pgrst, 'reload schema';
