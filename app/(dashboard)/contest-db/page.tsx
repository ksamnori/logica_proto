// src/app/(dashboard)/contest-db/page.tsx
"use client";

import React, { memo, useEffect, useRef, useState } from "react";
import { useContestDb, fetchContestAccess } from "./useContestDb";
import {
  TOPIC_OPTIONS,
  KEYWORD_OPTIONS,
  DATASET_OPTIONS,
  NUMINA_SOURCES,
  QUESTION_TYPE_OPTIONS,
  EMPTY_FILTERS,
  SOLUTION_SPLIT,
  renderProblemText,
  renderAnswer,
  previewLine,
  typesetMath,
  ensureMathJax,
  type ContestFilters,
} from "./contestUtils";

const KO_STATUS_OPTIONS: { value: ContestFilters["koStatus"]; label: string }[] = [
  { value: "", label: "전체" },
  { value: "true", label: "한글 있음" },
  { value: "false", label: "미번역" },
];

export default function WordProblemDbPage() {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [canSeeAll, setCanSeeAll] = useState(false);
  const db = useContestDb();
  const { filters, setFilters, detail } = db;

  const [isEditing, setIsEditing] = useState(false);
  const [showEnglish, setShowEnglish] = useState(true);
  const [editProblemKo, setEditProblemKo] = useState("");
  const [editSolutionsKo, setEditSolutionsKo] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  // 수식 새로고침: 값을 바꾸면 문항 영역을 원문에서 다시 만들고 수식을 새로 그림
  const [mathRefreshKey, setMathRefreshKey] = useState(0);

  // ---------------------------------------------------------
  // 접근 권한: DB 허용 명단(contest_db_access) 기준. 학원 화면·출판사 포털 공통
  //  - 'word' = 사고력·문장제만, 'all' = 전체 문제 탭까지
  //  - 화면 표시용일 뿐이고, 실제 조회 제한은 DB 정책과 서버 API가 같은 명단으로 다시 막음
  // ---------------------------------------------------------
  useEffect(() => {
    fetchContestAccess().then((level) => {
      setCanSeeAll(level === "all");
      setIsAuthorized(level !== null);
    });
    ensureMathJax();
  }, []);

  useEffect(() => {
    if (isAuthorized) db.search(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized]);

  // 문항이 바뀌면 편집 내용 초기화
  useEffect(() => {
    setIsEditing(false);
    setEditProblemKo(detail?.problem_ko || "");
    setEditSolutionsKo((detail?.solutions_ko || []).join(`\n\n${SOLUTION_SPLIT}\n\n`));
  }, [detail?.id, detail?.problem_ko, detail?.solutions_ko]);

  // 좌우 화살표로 이전/다음 문항
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.key === "ArrowRight") db.selectProblem(db.selectedIndex + 1);
      if (e.key === "ArrowLeft") db.selectProblem(db.selectedIndex - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [db]);

  const updateFilter = <K extends keyof ContestFilters>(key: K, value: ContestFilters[K], runSearch = true) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    if (runSearch) db.search(0, next);
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    db.search(0, EMPTY_FILTERS);
  };

  const handleTranslate = async () => {
    if (!detail) return;
    try {
      await db.translateOne(detail.id);
    } catch (e: any) {
      alert("번역 실패: " + e.message);
    }
  };

  const handleSaveManual = async () => {
    if (!detail) return;
    setIsSaving(true);
    try {
      const sols = editSolutionsKo.trim()
        ? editSolutionsKo.split(new RegExp(`\\n*${SOLUTION_SPLIT}\\n*`)).map((s) => s.trim()).filter(Boolean)
        : [];
      await db.saveManual(detail.id, editProblemKo.trim(), sols);
      setIsEditing(false);
    } catch (e: any) {
      alert("저장 실패: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const copyText = (lang: "en" | "ko") => {
    if (!detail) return;
    navigator.clipboard.writeText((lang === "ko" ? detail.problem_ko : detail.problem_en) || "");
    alert("문제 텍스트를 복사했습니다.");
  };

  if (isAuthorized === null) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 font-bold">권한 확인 중...</div>;
  }
  if (!isAuthorized) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-500">
        <span className="text-3xl">🔒</span>
        <p className="font-bold">문제 DB 열람 권한이 없는 계정입니다.</p>
        <p className="text-sm">열람이 필요하면 최고관리자에게 권한 등록을 요청하세요.</p>
      </div>
    );
  }

  const isTranslating = !!detail && db.translatingId === detail.id;
  const solsEn = detail?.solutions_en || [];
  const solsKo = detail?.solutions_ko || [];
  const selectCls = "px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-[13px] text-slate-700";
  const btnCls = "px-3 py-1.5 rounded-lg text-[13px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard px-6 pb-6 overflow-hidden">
      {/* 탭 (오른쪽 위는 학원 공통 플로팅 버튼 자리라 비워 둠) */}
      <div className="flex items-end gap-4 mb-3 pr-48">
        <div>
          <div className="flex items-center gap-1">
            <TabButton active={db.mode === "word"} onClick={() => db.mode !== "word" && db.switchMode("word")}>
              사고력·문장제
            </TabButton>
            {canSeeAll && (
              <TabButton active={db.mode === "all"} onClick={() => db.mode !== "all" && db.switchMode("all")}>
                전체 문제 <span className="ml-1 text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">전체 열람</span>
              </TabButton>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            {db.mode === "word"
              ? "초·중등 수준 문장제 약 15만 문항 · 영문 원본과 한국어 번역을 나란히 확인하고 수정합니다."
              : "MathNet · NuminaMath-1.5 · Omni-MATH 전체 약 92만 문항 · 전체 열람 권한이 있는 계정만 조회할 수 있습니다."}
          </p>
        </div>
      </div>

      {/* 필터 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {KO_STATUS_OPTIONS.map((o) => (
            <button
              key={o.label}
              onClick={() => updateFilter("koStatus", o.value)}
              className={`px-3 py-1 rounded-md text-[13px] font-bold ${filters.koStatus === o.value ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <select className={selectCls} value={filters.topic} onChange={(e) => updateFilter("topic", e.target.value)}>
          <option value="">전체 단원</option>
          {TOPIC_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={selectCls} value={filters.keyword} onChange={(e) => updateFilter("keyword", e.target.value)}>
          <option value="">핵심 키워드</option>
          {KEYWORD_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        {db.mode === "all" && (
          <>
            <select className={selectCls} value={filters.dataset} onChange={(e) => updateFilter("dataset", e.target.value)}>
              <option value="">모든 데이터셋</option>
              {DATASET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className={selectCls} value={NUMINA_SOURCES.includes(filters.competition) ? filters.competition : ""}
              onChange={(e) => updateFilter("competition", e.target.value)}>
              <option value="">NuminaMath 출처 전체</option>
              {NUMINA_SOURCES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className={selectCls} value={filters.questionType} onChange={(e) => updateFilter("questionType", e.target.value)}>
              <option value="">모든 문항 형태</option>
              {QUESTION_TYPE_OPTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
            <input className={`${selectCls} w-[120px]`} placeholder="국가 (예: USA)" value={filters.country}
              onChange={(e) => updateFilter("country", e.target.value, false)} onKeyDown={(e) => e.key === "Enter" && db.search(0)} />
            <label className="flex items-center gap-1 text-[13px] font-bold text-slate-600 bg-slate-100 rounded-lg px-2 py-1.5 cursor-pointer">
              <input type="checkbox" checked={filters.onlyFigure} onChange={(e) => updateFilter("onlyFigure", e.target.checked)} /> 도형만
            </label>
          </>
        )}
        <input
          className={`${selectCls} w-[220px]`}
          placeholder="본문 검색 (한글/영문) 후 Enter"
          value={filters.text}
          onChange={(e) => updateFilter("text", e.target.value, false)}
          onKeyDown={(e) => e.key === "Enter" && db.search(0)}
        />
        <button onClick={() => db.search(0)} className={`${btnCls} bg-blue-600 text-white hover:bg-blue-700`}>조회</button>
        <button onClick={resetFilters} className={`${btnCls} bg-slate-100 text-slate-600 hover:bg-slate-200`}>초기화</button>
        {/* 우측 상단 플로팅 버튼에 가리지 않도록 일괄 번역은 필터 줄 오른쪽 끝에 둠 */}
        <div className="ml-auto">
          {db.batchProgress ? (
            <button onClick={db.cancelBatch} className={`${btnCls} bg-rose-600 text-white hover:bg-rose-700`}>
              일괄 번역 중단 ({db.batchProgress.done}/{db.batchProgress.total})
            </button>
          ) : (
            <button onClick={db.translateBatch} disabled={!db.items.length} className={`${btnCls} bg-violet-600 text-white hover:bg-violet-700`}>
              현재 목록 미번역 일괄 한글화
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 gap-3">
        {/* 좌측 목록 */}
        <div className="w-[360px] shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col min-h-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 text-xs font-bold text-slate-500">
            <span>{db.isListLoading ? "조회 중..." : db.listMessage}</span>
            <div className="flex items-center gap-1">
              <button disabled={db.page === 0 || db.isListLoading} onClick={() => db.search(db.page - 1)} className={`${btnCls} !px-2 !py-0.5 bg-slate-100`}>◀</button>
              <span className="min-w-[36px] text-center">{db.page + 1} P</span>
              <button disabled={!db.hasNext || db.isListLoading} onClick={() => db.search(db.page + 1)} className={`${btnCls} !px-2 !py-0.5 bg-slate-100`}>▶</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {db.items.map((it, idx) => (
              <button
                key={it.id}
                onClick={() => db.selectProblem(idx)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${idx === db.selectedIndex ? "bg-blue-50 border-blue-400" : "border-slate-100 hover:bg-slate-50 hover:border-slate-300"}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-bold text-slate-400 truncate">
                    {db.mode === "word" ? it.id.replace("numina_", "#") : `${it.competition || it.source_dataset}${it.exam_year ? ` ${it.exam_year}` : ""}`}
                  </span>
                  <span className="flex gap-1 shrink-0">
                    {db.mode === "all" && it.has_figure && <span className="text-[11px] px-1.5 rounded bg-amber-100 text-amber-700 font-bold">도형</span>}
                    {it.topics_ko?.[0] && <span className="text-[11px] px-1.5 rounded bg-sky-100 text-sky-700 font-bold">{it.topics_ko[0].split(" - ")[0]}</span>}
                    {it.has_ko
                      ? <span className="text-[11px] px-1.5 rounded bg-green-100 text-green-700 font-bold">한글</span>
                      : <span className="text-[11px] px-1.5 rounded bg-rose-100 text-rose-700 font-bold">미번역</span>}
                  </span>
                </div>
                <div className="text-[13px] text-slate-700 leading-snug line-clamp-2">
                  {previewLine(it.problem_ko || it.problem_en, 90)}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 우측 본문 */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {!detail ? (
            <div className="h-full flex items-center justify-center text-slate-400 font-bold">
              {db.isDetailLoading ? "문항 불러오는 중..." : "왼쪽에서 문항을 선택하세요."}
            </div>
          ) : (
            <div key={mathRefreshKey} className={`space-y-3 ${db.isDetailLoading ? "opacity-50" : ""}`}>
              {/* 도구 모음 */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button onClick={() => db.selectProblem(db.selectedIndex - 1)} disabled={db.selectedIndex <= 0} className={`${btnCls} bg-slate-100 text-slate-600`}>◀ 이전</button>
                  <button onClick={() => db.selectProblem(db.selectedIndex + 1)} disabled={db.selectedIndex >= db.items.length - 1} className={`${btnCls} bg-slate-100 text-slate-600`}>다음 ▶</button>
                  <span className="text-xs font-bold text-slate-400 ml-1">{detail.id}</span>
                  {(detail.keywords_ko || []).map((k) => <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold">#{k}</span>)}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs font-bold text-slate-500 cursor-pointer">
                    <input type="checkbox" checked={showEnglish} onChange={(e) => setShowEnglish(e.target.checked)} /> 영문 함께 보기
                  </label>
                  <button
                    onClick={() => setMathRefreshKey((k) => k + 1)}
                    className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-[13px] font-bold hover:bg-indigo-100 transition-colors"
                    title="화면의 깨진 수식을 원문에서 다시 그립니다."
                  >
                    🔄 수식 새로고침
                  </button>
                  <button onClick={() => setIsEditing((v) => !v)} className={`${btnCls} bg-slate-100 text-slate-600`}>{isEditing ? "편집 닫기" : "한글 직접 수정"}</button>
                  <button onClick={handleTranslate} disabled={isTranslating || !!db.batchProgress} className={`${btnCls} bg-emerald-600 text-white hover:bg-emerald-700`}>
                    {isTranslating ? "번역·저장 중..." : detail.has_ko ? "AI 재번역" : "AI 한글 번역"}
                  </button>
                </div>
              </div>

              {db.mode === "all" && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex flex-wrap gap-1.5 text-xs font-bold">
                  <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">{detail.source_dataset}</span>
                  <span className="px-2 py-1 rounded bg-rose-50 text-rose-800">{detail.country || "International"}</span>
                  <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">{detail.competition} {detail.exam_year || ""}</span>
                  {detail.question_type_ko && <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">유형: {detail.question_type_ko}</span>}
                  {detail.difficulty != null && <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">난이도: {detail.difficulty}</span>}
                  {(detail.topics_ko || []).map((t) => <span key={t} className="px-2 py-1 rounded bg-emerald-50 text-emerald-800">{t}</span>)}
                </div>
              )}

              {/* 첨부 도형 (본문에 들어 있지 않은 것만) */}
              {(detail.images || []).filter((u) => u && !(detail.problem_en || "").includes(u)).length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 border-t-4 border-t-amber-400 shadow-sm p-4">
                  <div className="text-xs font-bold text-slate-500 mb-2">첨부 도형</div>
                  <div className="flex flex-wrap gap-3">
                    {(detail.images || []).filter((u) => u && !(detail.problem_en || "").includes(u)).map((u) => (
                      <img key={u} src={u} alt="도형" loading="lazy" className="max-w-[320px] rounded-lg border border-slate-200 p-1.5" />
                    ))}
                  </div>
                </div>
              )}

              {/* 문제 */}
              <div className={`grid gap-3 ${showEnglish ? "grid-cols-2" : "grid-cols-1"}`}>
                <Panel
                  title="한국어 문제"
                  tone="ko"
                  action={
                    <div className="flex gap-1">
                      {isEditing && <SmallBtn primary disabled={isSaving} onClick={handleSaveManual}>{isSaving ? "저장 중..." : "수정 저장"}</SmallBtn>}
                      <SmallBtn onClick={() => copyText("ko")}>복사</SmallBtn>
                    </div>
                  }
                >
                  {isEditing ? (
                    <textarea value={editProblemKo} onChange={(e) => setEditProblemKo(e.target.value)}
                      className="w-full min-h-[180px] p-3 text-sm font-mono border border-blue-300 rounded-lg" />
                  ) : detail.problem_ko ? (
                    <MathText html={renderProblemText(detail.problem_ko)} />
                  ) : (
                    <p className="text-slate-400 text-sm">아직 한국어 번역이 없습니다. [AI 한글 번역]을 누르면 수식은 그대로 두고 번역해 저장합니다.</p>
                  )}
                </Panel>
                {showEnglish && (
                  <Panel title="영문 원본" tone="en" action={<SmallBtn onClick={() => copyText("en")}>복사</SmallBtn>}>
                    <MathText html={renderProblemText(detail.problem_en)} />
                  </Panel>
                )}
              </div>

              {/* 정답 */}
              <div className="bg-white rounded-xl border border-slate-200 border-l-4 border-l-indigo-500 shadow-sm px-4 py-3 text-[15px]">
                <strong className="text-slate-600 text-sm mr-2">정답</strong>
                {detail.final_answer ? <MathText inline html={renderAnswer(detail.final_answer)} /> : <span className="text-slate-400 text-sm">해설 참조</span>}
              </div>

              {/* 해설 */}
              <div className={`grid gap-3 ${showEnglish ? "grid-cols-2" : "grid-cols-1"}`}>
                <Panel title={`한국어 해설${solsKo.length > 1 ? ` (${solsKo.length})` : ""}`} tone="ko">
                  {isEditing ? (
                    <>
                      <p className="text-xs text-slate-400 mb-1">풀이가 여러 개면 {SOLUTION_SPLIT} 줄로 구분합니다.</p>
                      <textarea value={editSolutionsKo} onChange={(e) => setEditSolutionsKo(e.target.value)}
                        className="w-full min-h-[260px] p-3 text-sm font-mono border border-blue-300 rounded-lg" />
                    </>
                  ) : solsKo.length ? (
                    <Solutions list={solsKo} label="풀이" />
                  ) : (
                    <p className="text-slate-400 text-sm">아직 한국어 해설이 없습니다. AI 번역 시 해설도 함께 번역됩니다.</p>
                  )}
                </Panel>
                {showEnglish && (
                  <Panel title={`영문 해설${solsEn.length > 1 ? ` (${solsEn.length})` : ""}`} tone="en">
                    {solsEn.length ? <Solutions list={solsEn} label="Solution" /> : <p className="text-slate-400 text-sm">영문 해설이 없습니다.</p>}
                  </Panel>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-[15px] font-bold transition-colors ${active ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-white hover:text-slate-800"}`}
    >
      {children}
    </button>
  );
}

function Solutions({ list, label }: { list: string[]; label: string }) {
  return (
    <>
      {list.map((s, i) => (
        <div key={i} className={i ? "mt-4 pt-4 border-t border-slate-100" : ""}>
          {list.length > 1 && <div className="text-xs font-bold text-slate-500 mb-1">{label} {i + 1}</div>}
          <MathText html={renderProblemText(s)} />
        </div>
      ))}
    </>
  );
}

function Panel({ title, tone, action, children }: { title: string; tone: "en" | "ko"; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-t-4 ${tone === "ko" ? "border-t-emerald-500" : "border-t-slate-300"}`}>
      <div className="flex items-center justify-between mb-2 text-xs font-bold text-slate-500">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function SmallBtn({ children, onClick, primary, disabled }: { children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-2 py-0.5 rounded text-[11px] font-bold disabled:opacity-50 ${primary ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
      {children}
    </button>
  );
}

/**
 * 수식이 들어간 글 한 덩어리.
 *  - 내용(html)이 바뀔 때만 다시 그리고(memo), 그릴 때마다 자기 영역만 MathJax로 렌더링
 *  - 화면의 다른 부분이 바뀌어도 이미 렌더링된 수식을 건드리지 않아 원래 코드로 되돌아가지 않음
 */
const MathText = memo(function MathText({ html, inline }: { html: string; inline?: boolean }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    typesetMath(ref.current);
  }, [html]);
  const className = `${inline ? "" : "text-[15px] leading-7 whitespace-pre-wrap break-words"} text-slate-800`;
  return inline
    ? <span ref={(el) => { ref.current = el; }} className={className} dangerouslySetInnerHTML={{ __html: html }} />
    : <div ref={(el) => { ref.current = el; }} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});
