// src/components/hq/HqSchemaSetupBanner.tsx
"use client";

import React, { useState } from "react";
import { HQ_SCHEMA_SQL } from "@/lib/hq/schemaSql";
import { useHqShell } from "./HqShellContext";

export default function HqSchemaSetupBanner() {
  const {
    schemaMissing,
    refreshMembers,
    refreshApprovalBadge,
    refreshAttendanceState,
    refreshContractBadge,
  } = useHqShell();
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  if (!schemaMissing) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(HQ_SCHEMA_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRecheck = async () => {
    setChecking(true);
    await Promise.all([
      refreshMembers(),
      refreshApprovalBadge(),
      refreshAttendanceState(),
      refreshContractBadge(),
    ]);
    setChecking(false);
  };

  return (
    <div className="mx-6 mt-4 rounded-2xl bg-amber-50 border border-amber-200 p-4 shadow-sm print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-amber-900 flex items-center gap-2">
            <span>🛠️</span>
            <span>
              본부(HQ) 신규 모듈 데이터베이스 테이블 추가 생성이 필요합니다
            </span>
          </h3>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            근태(<code>hq_attendance</code>) · 전자계약(<code>hq_contract</code>) ·
            급여/원천세/인세(<code>hq_payroll</code>) · 출판공정(
            <code>hq_publication</code>) 테이블이 포함된 최신{" "}
            <code>supabase/hq_schema.sql</code>을 Supabase SQL Editor에서 1회
            실행해 주세요. (<strong>기존 데이터는 100% 그대로 유지</strong>됩니다.)
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm transition-colors"
          >
            {copied ? "✅ SQL 복사 완료!" : "📋 SQL 전체 복사"}
          </button>
          <button
            type="button"
            onClick={() => setShowSql((v) => !v)}
            className="px-3 py-2 rounded-xl bg-white hover:bg-amber-100/60 border border-amber-300 text-amber-900 text-xs font-bold transition-colors"
          >
            {showSql ? "SQL 접기" : "SQL 보기"}
          </button>
          <button
            type="button"
            onClick={handleRecheck}
            disabled={checking}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {checking ? "확인 중..." : "연결 다시 확인"}
          </button>
        </div>
      </div>

      {showSql && (
        <pre className="mt-3 p-3 rounded-xl bg-slate-900 text-slate-100 text-[11px] leading-relaxed overflow-x-auto max-h-60 custom-scroll">
          {HQ_SCHEMA_SQL}
        </pre>
      )}
    </div>
  );
}
