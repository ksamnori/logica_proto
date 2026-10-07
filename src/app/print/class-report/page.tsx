// src/app/print/class-report/page.tsx
// 반 전체 월간 성취도 리포트 (A4 세로, 인쇄·PDF 저장용) — 학생 월간 리포트의 반 종합판
// 주소: /print/class-report?class_id=...&month=YYYY-MM
"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ymLabel, shiftYm } from "@/lib/monthlyReport";
import { buildClassReport, ClassReport, ClassStudentRow } from "@/lib/classReport";

const REPORT_TITLE_EN = "LOGICA Class Report";
const REPORT_TITLE_KO = "반 성취도 리포트";

const BRAND = "#002864";
const LOGO_URL = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png";
const PEER = "#9AA5B1";

const defaultMonth = () => {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const ym = now.toISOString().slice(0, 7);
  return now.getUTCDate() <= 7 ? shiftYm(ym, -1) : ym; // 월초에는 지난달 리포트
};

// ---------- 작은 차트 ----------
function TrendChart({ points, unit = "", decimals = 0, invert = false, color = BRAND }: {
  points: { label: string; me: number | null; peer: number | null }[]; unit?: string; decimals?: number; invert?: boolean; color?: string;
}) {
  const W = 260, H = 150, PX = 30, PT = 26, PB = 28;
  const vals = points.flatMap(p => [p.me, p.peer]).filter((v): v is number => v != null);
  if (vals.length === 0) return <div className="text-[12px] text-slate-400">비교할 기록이 없어요</div>;
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.2; min -= pad; max += pad;
  const x = (i: number) => points.length === 1 ? W / 2 : PX + (i * (W - PX * 2)) / (points.length - 1);
  const y = (v: number) => { const t = (v - min) / (max - min); return PT + (invert ? t : 1 - t) * (H - PT - PB); };
  const fmt = (v: number) => (decimals ? v.toFixed(decimals) : String(Math.round(v))) + unit;
  const line = (key: "me" | "peer") => points.map((p, i) => (p[key] == null ? null : `${x(i)},${y(p[key] as number)}`)).filter(Boolean).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="최근 3개월 추이">
      <polyline points={line("peer")} fill="none" stroke={PEER} strokeWidth="1.5" strokeDasharray="4 4" />
      <polyline points={line("me")} fill="none" stroke={color} strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          {p.peer != null && (<><circle cx={x(i)} cy={y(p.peer)} r="3" fill="#fff" stroke={PEER} strokeWidth="1.5" /><text x={x(i)} y={y(p.peer) + 16} fontSize="10" fill="#7B8794" textAnchor="middle">{fmt(p.peer)}</text></>)}
          {p.me != null && (<><circle cx={x(i)} cy={y(p.me)} r={i === points.length - 1 ? 5 : 3.5} fill={color} /><text x={x(i)} y={y(p.me) - 9} fontSize={i === points.length - 1 ? 13 : 11} fontWeight="700" fill={color} textAnchor="middle">{fmt(p.me)}</text></>)}
          <text x={x(i)} y={H - 6} fontSize="11" fill={i === points.length - 1 ? color : "#7B8794"} fontWeight={i === points.length - 1 ? 700 : 400} textAnchor="middle">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

function Radar({ items: raw }: { items: { name: string; me: number | null; peer: number | null; enough: boolean }[] }) {
  // 데이터가 부족한 역량은 실제 값 대신 "충분한 역량들의 평균"으로 그려서 한쪽만 뾰족해지지 않게 함
  const okMe = raw.filter(i => i.enough && i.me != null).map(i => i.me as number);
  const okPeer = raw.filter(i => i.peer != null).map(i => i.peer as number);
  const mean = (a: number[]) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
  const meFill = mean(okMe), peerFill = mean(okPeer);
  const items = raw.map(i => ({ ...i, me: i.enough && i.me != null ? i.me : meFill, peer: i.peer != null ? i.peer : peerFill }));
  const S = 300, C = S / 2, R = 105;
  const ang = (i: number) => (Math.PI * 2 * i) / items.length - Math.PI / 2;
  const pt = (i: number, v: number) => `${C + Math.cos(ang(i)) * R * (v / 100)},${C + Math.sin(ang(i)) * R * (v / 100)}`;
  const poly = (key: "me" | "peer") => items.map((it, i) => pt(i, it[key] ?? 0)).join(" ");
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="img" aria-label="역량별 정답률 방사형 그래프">
      {[25, 50, 75, 100].map(l => <polygon key={l} points={items.map((_, i) => pt(i, l)).join(" ")} fill="none" stroke="#E4E7EB" />)}
      {items.map((_, i) => <line key={i} x1={C} y1={C} x2={C + Math.cos(ang(i)) * R} y2={C + Math.sin(ang(i)) * R} stroke="#E4E7EB" />)}
      {okPeer.length > 0 && <polygon points={poly("peer")} fill="none" stroke={PEER} strokeWidth="1.5" strokeDasharray="4 4" />}
      <polygon points={poly("me")} fill="rgba(99,102,241,0.22)" stroke="#4F46E5" strokeWidth="2" />
      {items.map((it, i) => {
        const [px, py] = pt(i, it.me ?? 0).split(",").map(Number);
        return it.enough
          ? <circle key={`p${i}`} cx={px} cy={py} r="3.5" fill="#4F46E5" />
          : <circle key={`p${i}`} cx={px} cy={py} r="4" fill="#fff" stroke="#4F46E5" strokeWidth="1.5" strokeDasharray="2 2" />;
      })}
      {items.map((it, i) => {
        const lx = C + Math.cos(ang(i)) * (R + 26), ly = C + Math.sin(ang(i)) * (R + 22);
        return (
          <g key={it.name}>
            <text x={lx} y={ly} fontSize="12" fontWeight="600" fill={it.enough ? "#1F2933" : "#9AA5B1"} textAnchor="middle">{it.name}</text>
            {!it.enough && <text x={lx} y={ly + 14} fontSize="10" fill="#9AA5B1" textAnchor="middle">데이터 부족</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ---------- 페이지 틀 ----------
function Page({ title, name, period, children }: { title: string; name: string; period: string; children?: React.ReactNode }) {
  return (
    <section className="report-page">
      <div className="flex items-end justify-between border-b-2 border-[#1F2933] pb-2">
        <h2 className="text-[26px] font-bold tracking-tight text-[#1F2933]">{title}</h2>
        <div className="text-[18px] text-[#1F2933]">{name}</div>
      </div>
      <div className="text-right text-[12px] text-[#7B8794] mt-1.5 mb-6">학습내역 반영 기간 | {period}</div>
      {children}
    </section>
  );
}

const Chip = ({ text, color }: { text: string; color: string }) => (
  <span className="inline-block whitespace-nowrap shrink-0 rounded-lg px-3 py-1 text-[15px] font-bold text-white" style={{ background: color }}>{text}</span>
);
const rateText = (v: number | null | undefined) => (v == null ? "-" : `${v}%`);
const PeerLegend = ({ label }: { label: string }) => (
  <span className="flex items-center gap-1.5 text-[11px] text-[#7B8794] whitespace-nowrap shrink-0"><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={PEER} strokeWidth="1.5" strokeDasharray="3 3" /></svg>{label}</span>
);
// ---------- 쪽 나누기 ----------
// A4 한 쪽(위아래 여백·제목 제외)에 들어갈 높이(px)를 어림해 표를 여러 쪽으로 나눔. 넘치기 전에 다음 쪽으로 넘김
const PAGE_BODY = 860;   // 제목·기간 줄을 뺀 본문 높이 (여유 포함)
const TABLE_HEAD = 44;   // 표 머리줄
const FOOTNOTE = 44;     // 표 아래 설명
function paginate<T>(items: T[], h: (t: T) => number, firstCap: number, restCap: number): T[][] {
  const pages: T[][] = [[]]; let left = firstCap;
  items.forEach(it => {
    const need = h(it);
    if (need > left && pages[pages.length - 1].length > 0) { pages.push([]); left = restCap; }
    pages[pages.length - 1].push(it); left -= need;
  });
  return pages;
}
const lines = (text: string, perLine: number) => Math.max(1, Math.ceil((text || "").length / perLine));
const stuRowH = (s: ClassStudentRow) => 31 + (lines((s.star ? "우수 " : "") + s.flags.join(", "), 13) - 1) * 15;
const unitRowH = (u: ClassReport["units"][number]) => {
  const nameH = lines(u.name, 15) * 17 + (u.curriculum ? 14 : 0);
  const weakH = u.weakTypes.reduce((a, t) => a + lines(`· ${t.name} ${t.rate}%`, 14) * 15, 0);
  const lowH = u.low.length ? lines(u.low.join(", "), 10) * 15 : 0;
  return Math.max(nameH, weakH, lowH, 18) + 14;
};

const barTone = (v: number | null) => (v == null ? "bg-slate-200" : v >= 80 ? "bg-emerald-400" : v < 50 ? "bg-amber-400" : "bg-sky-400");

export default function ClassReportPage() {
  const [classId, setClassId] = useState("");
  const [month, setMonth] = useState("");
  const [report, setReport] = useState<ClassReport | null>(null);
  const [stepText, setStepText] = useState("리포트를 준비하는 중");
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [savedComment, setSavedComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("logica_instructor_id")) { alert("선생님 계정으로 로그인한 뒤 열어주세요."); window.location.href = "/"; return; }
    const sp = new URLSearchParams(window.location.search);
    const cid = sp.get("class_id") || "";
    if (!cid) { setError("주소에 반 정보(class_id)가 없습니다. 교재 관리 화면의 [반 전체 성취도 리포트 인쇄] 버튼으로 열어주세요."); return; }
    setClassId(cid);
    setMonth(/^\d{4}-\d{2}$/.test(sp.get("month") || "") ? sp.get("month")! : defaultMonth());
  }, []);

  useEffect(() => {
    if (!classId || !month) return;
    let alive = true;
    setReport(null); setError("");
    const url = new URL(window.location.href); url.searchParams.set("month", month); window.history.replaceState(null, "", url.toString());
    (async () => {
      try {
        const r = await buildClassReport(classId, month, t => alive && setStepText(t));
        if (!alive) return;
        setReport(r);
        document.title = `${r.cls.name}_${month}_반성취도리포트`;
        const { data, error: cErr } = await supabase.from("class_report_comment").select("comment").eq("class_id", classId).eq("year_month", month).maybeSingle();
        if (cErr) console.warn("선생님 의견 조회 실패:", cErr.message);
        setComment(data?.comment || ""); setSavedComment(data?.comment || "");
      } catch (e: any) {
        if (alive) setError(e.message || String(e));
      }
    })();
    return () => { alive = false; };
  }, [classId, month]);

  const saveComment = async () => {
    setSaving(true);
    const { error: e } = await supabase.from("class_report_comment").upsert(
      { class_id: classId, year_month: month, comment, updated_at: new Date().toISOString() },
      { onConflict: "class_id,year_month" }
    );
    setSaving(false);
    if (e) { alert("의견 저장 실패: " + e.message + "\n(class_report_comment.sql을 실행했는지 확인해주세요)"); return; }
    setSavedComment(comment);
  };
  const dirty = comment !== savedComment;

  return (
    <div className="min-h-screen bg-[#E4E7EB] font-pretendard text-[#1F2933]">
      <style>{`
        .report-page { width: 210mm; min-height: 297mm; margin: 24px auto; padding: 16mm 15mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.12); box-sizing: border-box; }
        .avoid-break { break-inside: avoid; page-break-inside: avoid; }
        @page { size: A4; margin: 0; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .report-page { margin: 0; box-shadow: none; page-break-after: always; break-after: page; }
          .report-page:last-child { page-break-after: auto; break-after: auto; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          textarea { border: none !important; resize: none; }
          thead { display: table-header-group; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-20 bg-white border-b border-[#CBD2D9]">
        <div className="max-w-[210mm] mx-auto px-4 h-14 flex items-center gap-3">
          <button type="button" onClick={() => window.history.length > 1 ? window.history.back() : window.close()} className="h-9 px-3 rounded-lg border border-[#CBD2D9] text-[14px] font-semibold text-[#3E4C59] hover:bg-[#F5F7FA]">닫기</button>
          <label className="flex items-center gap-2 text-[14px] text-[#3E4C59]">
            리포트 월
            <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className="h-9 px-2 rounded-lg border border-[#CBD2D9] text-[14px]" />
          </label>
          <span className="flex-1" />
          {report && dirty && <span className="text-[13px] text-[#9A5B00]">의견이 저장되지 않았어요</span>}
          {report && <button type="button" onClick={saveComment} disabled={saving || !dirty} className="h-9 px-3 rounded-lg border border-[#CBD2D9] text-[14px] font-semibold text-[#3E4C59] hover:bg-[#F5F7FA] disabled:opacity-50">{saving ? "저장 중..." : "의견 저장"}</button>}
          <button type="button" onClick={() => { if (dirty && !confirm("선생님 의견이 저장되지 않았습니다. 그대로 인쇄할까요?")) return; window.print(); }} disabled={!report} className="h-9 px-4 rounded-lg bg-brand text-white text-[14px] font-semibold hover:bg-brand-hover disabled:opacity-50">인쇄 / PDF 저장</button>
        </div>
      </div>

      {error && <div className="no-print max-w-[210mm] mx-auto mt-10 bg-white rounded-xl border border-[#F7D6D2] p-6 text-[15px] text-[#A32A22]">{error}</div>}
      {!error && !report && (
        <div className="no-print flex flex-col items-center gap-3 mt-24 text-[15px] text-[#616E7C]" role="status">
          <span className="w-8 h-8 border-[3px] border-brand border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          {stepText}...
        </div>
      )}

      {report && <ReportPages r={report} comment={comment} setComment={setComment} />}
    </div>
  );
}

function ReportPages({ r, comment, setComment }: { r: ClassReport; comment: string; setComment: (v: string) => void }) {
  const name = r.cls.name;
  const monthNum = Number(r.ym.slice(5, 7));
  const tp = (key: "rate" | "finalRate" | "count" | "diff") => r.trend.map(t => ({ label: ymLabel(t.ym), me: t.me ? t.me[key] : null, peer: t.peer ? t.peer[key] : null }));
  const hasPeer = r.compare.classes.length > 0;
  const peerLabel = hasPeer ? `비교 반(${r.compare.prefix}) 평균` : "";

  if (!r.hasData) {
    return (
      <>
        <Cover r={r} />
        <Page title="반 요약" name={name} period={r.period}>
          <div className="rounded-xl bg-[#F5F7FA] p-10 text-center text-[16px] text-[#616E7C]">{monthNum}월에 채점된 학습 기록이 없습니다.</div>
        </Page>
      </>
    );
  }

  // 표가 긴 쪽은 A4에 맞게 여러 쪽으로 나눔
  const stuPages = paginate(r.students, stuRowH, PAGE_BODY - 160 - TABLE_HEAD - FOOTNOTE, PAGE_BODY - TABLE_HEAD - FOOTNOTE);
  const wkPages: ClassStudentRow[][] = r.weekly.tests.length ? paginate(r.students, () => 31, PAGE_BODY - 350 - TABLE_HEAD - FOOTNOTE - 32, PAGE_BODY - TABLE_HEAD - FOOTNOTE - 32) : [[]];
  const unitPages: ClassReport["units"][number][][] = r.units.length ? paginate(r.units, unitRowH, PAGE_BODY - TABLE_HEAD - FOOTNOTE, PAGE_BODY - TABLE_HEAD - FOOTNOTE) : [[]];

  const big = [
    { chip: "반 평균 정답률", color: "#10B981", bg: "bg-emerald-50", value: r.me.rate, unit: "%", trend: <TrendChart points={tp("rate")} unit="%" color="#10B981" />, note: "학생마다 처음 풀어 맞힌 비율을 낸 뒤 평균했습니다." },
    { chip: "고친 뒤 정답률", color: "#0EA5E9", bg: "bg-sky-50", value: r.me.finalRate, unit: "%", trend: <TrendChart points={tp("finalRate")} unit="%" color="#0EA5E9" />, note: "스스로 고쳐 맞힘(RO)과 힌트 후 맞힘(TO)까지 포함한 평균입니다." },
    { chip: "1인당 채점 문항", color: "#8B5CF6", bg: "bg-violet-50", value: r.me.count, unit: "", trend: <TrendChart points={tp("count")} color="#8B5CF6" />, note: "채점된 시험·과제 문항 수의 학생 평균입니다. 입학테스트는 뺍니다." },
    { chip: "평균 난이도", color: "#D97706", bg: "bg-amber-50", value: r.me.diff == null ? null : r.me.diff.toFixed(1), unit: "", trend: <TrendChart points={tp("diff")} decimals={1} color="#D97706" />, note: "최하 1, 하 2, 중 3, 상 4, 최상 5의 평균입니다." },
  ];
  const minis = [
    { label: "출석률", v: rateText(r.totals.attendanceRate), sub: "지각·조퇴 포함 등원 비율", tone: "text-emerald-700 bg-emerald-50" },
    { label: "과제 완료율", v: rateText(r.totals.hwRate), sub: "이 반에서 낸 과제 기준", tone: "text-amber-700 bg-amber-50" },
    { label: "주간테스트 평균", v: r.totals.weeklyAvg == null ? "-" : `${r.totals.weeklyAvg}점`, sub: r.totals.weeklyFinalAvg == null ? "이번 달 시험 없음" : `정리 후 ${r.totals.weeklyFinalAvg}점`, tone: "text-sky-700 bg-sky-50" },
    { label: "주의가 필요한 학생", v: `${r.students.filter(s => s.flags.length).length}명`, sub: `전체 ${r.students.length}명 중`, tone: "text-rose-700 bg-rose-50" },
  ];

  return (
    <>
      <Cover r={r} />

      {/* 1. 반 요약 */}
      <Page title="반 요약" name={name} period={r.period}>
        <div className="grid grid-cols-2 gap-4">
          {big.map(b => (
            <div key={b.chip} className={`avoid-break flex flex-col rounded-2xl px-4 pt-3.5 pb-3 ${b.bg}`}>
              <div className="flex items-center justify-between">
                <Chip text={b.chip} color={b.color} />
                {hasPeer && <PeerLegend label={peerLabel} />}
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[56px] font-bold leading-none tabular-nums" style={{ color: b.color }}>{b.value ?? "-"}<span className="text-[28px]">{b.value != null ? b.unit : ""}</span></span>
                {b.trend}
              </div>
              <p className="text-[11px] text-[#7B8794] leading-snug mt-1">{b.note}</p>
            </div>
          ))}
        </div>
        <div className="avoid-break grid grid-cols-4 gap-3 mt-4">
          {minis.map(m => (
            <div key={m.label} className={`rounded-xl p-3 ${m.tone.split(" ")[1]}`}>
              <div className="text-[13px] text-[#3E4C59]">{m.label}</div>
              <div className={`text-[26px] font-bold tabular-nums mt-1 ${m.tone.split(" ")[0]}`}>{m.v}</div>
              <div className="text-[11px] text-[#7B8794] mt-0.5">{m.sub}</div>
            </div>
          ))}
        </div>
        <div className="avoid-break mt-4 rounded-2xl bg-amber-50 border border-amber-100 px-5 py-4">
          <div className="text-[18px] font-bold text-amber-800 mb-2">선생님 의견</div>
          <textarea value={comment} onChange={e => setComment(e.target.value)}
            placeholder="이번 달 반 전체 학습에 대한 의견을 적어 주세요. (인쇄할 때는 적은 글만 보입니다)"
            className="w-full h-[18mm] bg-transparent text-[14px] leading-relaxed text-[#1F2933] outline-none border border-dashed border-amber-200 rounded-lg p-2 placeholder:text-amber-400" />
        </div>
        <p className="text-[11px] text-[#7B8794] leading-relaxed mt-3">
          {hasPeer
            ? <>비교 기준: 반 이름 앞 두 글자(수준·학년)가 "{r.compare.prefix}"로 같은 진행 중인 반 {r.compare.classes.length}개({r.compare.classes.join(", ")})의 학생 {r.compare.students}명 평균입니다. </>
            : <>비교 기준: 반 이름 앞 두 글자(수준·학년)가 "{r.compare.prefix}"로 같은 다른 반이 없어 비교 없이 이 반의 기록만 보여 줍니다. </>}
          반 학생 {r.students.length}명 중 이번 달 채점 기록이 있는 학생은 {r.me.students}명입니다.
        </p>
      </Page>

      {/* 2. 학생별 성취표 */}
      {stuPages.map((rows, pi) => (
      <Page key={`stu${pi}`} title={pi ? "학생별 성취 (계속)" : "학생별 성취"} name={name} period={r.period}>
        {pi === 0 && <div className="avoid-break flex items-end gap-6 mb-5">
          <div>
            <div className="text-[13px] text-[#616E7C] mb-2">등급별 인원 (처음 정답률 기준)</div>
            <div className="flex items-end gap-2 h-[90px]">
              {r.levelDist.map((n, i) => {
                const max = Math.max(1, ...r.levelDist);
                const colors = ["#10B981", "#34D399", "#38BDF8", "#FBBF24", "#FB7185"];
                return (
                  <div key={i} className="flex flex-col items-center gap-1 w-12">
                    <span className="text-[12px] font-bold tabular-nums">{n}명</span>
                    <div className="w-8 rounded-t-md" style={{ height: `${(n / max) * 60 + 2}px`, background: colors[i] }} />
                    <span className="text-[11px] text-[#616E7C]">{i + 1}등급</span>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="flex-1 text-[12px] text-[#7B8794] leading-relaxed">1등급 90% 이상, 2등급 80% 이상, 3등급 70% 이상, 4등급 50% 이상, 5등급 50% 미만. <b className="text-emerald-700">우수</b>는 20문항 이상 풀고 정답률 85% 이상(과제 완료 90% 이상), <b className="text-rose-700">주의</b>는 정답률 50% 미만, 과제 완료 70% 미만, 결석 2회 이상, 주간테스트 미응시 중 하나라도 해당하는 학생입니다.</p>
        </div>}
        <div className="overflow-hidden rounded-xl border border-indigo-100">
          <table className="w-full text-[12px] tabular-nums">
            <thead className="bg-indigo-50 text-indigo-900">
              <tr>
                <th className="text-left font-semibold px-2 py-2">이름</th>
                <th className="font-semibold px-1 py-2 w-[44px]">문항</th>
                <th className="font-semibold px-2 py-2 w-[150px]">처음 → 고친 뒤</th>
                <th className="font-semibold px-1 py-2 w-[38px]">등급</th>
                <th className="font-semibold px-1 py-2 w-[56px]">주간T</th>
                <th className="font-semibold px-1 py-2 w-[54px]">과제</th>
                <th className="font-semibold px-1 py-2 w-[72px]">출석/지각/결석</th>
                <th className="text-left font-semibold px-2 py-2 w-[150px]">메모</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.student_id} className="border-t border-indigo-50 avoid-break">
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap">{s.name}</td>
                  <td className="px-1 py-1.5 text-center">{s.count || "-"}</td>
                  <td className="px-2 py-1.5">
                    {s.rate == null ? <span className="text-[#9AA5B1]">기록 없음</span> : (
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-2 rounded-full bg-[#EEF0F2] relative overflow-hidden">
                          <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-200" style={{ width: `${s.finalRate}%` }} />
                          <div className={`absolute inset-y-0 left-0 rounded-full ${barTone(s.rate)}`} style={{ width: `${s.rate}%` }} />
                        </div>
                        <span className="w-[62px] text-right"><b>{s.rate}</b><span className="text-[#9AA5B1]">→</span>{s.finalRate}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-1 py-1.5 text-center">{s.level ?? "-"}</td>
                  <td className="px-1 py-1.5 text-center">{s.weeklyAvg == null ? "-" : s.weeklyAvg}</td>
                  <td className="px-1 py-1.5 text-center">{s.hwRate == null ? "-" : `${s.hwRate}%`}</td>
                  <td className="px-1 py-1.5 text-center whitespace-nowrap">{s.att.present + s.att.early}/{s.att.late}/{s.att.absent}</td>
                  <td className="px-2 py-1.5 text-[11px] leading-snug">
                    {s.star && <span className="inline-block rounded bg-emerald-100 text-emerald-700 font-bold px-1.5 mr-1">우수</span>}
                    {s.flags.length > 0 && <span className="text-rose-700">{s.flags.join(", ")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pi === stuPages.length - 1 && <p className="text-[11px] text-[#7B8794] mt-2">처음 정답률 높은 순. 주간T는 이번 달 주간테스트 처음 점수 평균, 과제는 이 반에서 낸 과제의 완료율입니다. 막대의 연한 부분은 고친 뒤 정답률입니다.</p>}
      </Page>
      ))}

      {/* 3. 주간테스트 */}
      {wkPages.map((rows, pi) => (
      <Page key={`wk${pi}`} title={pi ? "주간테스트 (계속)" : "주간테스트"} name={name} period={r.period}>
        {r.weekly.tests.length === 0 ? (
          <div className="rounded-xl bg-[#F5F7FA] p-10 text-center text-[16px] text-[#616E7C]">{monthNum}월에 채점된 주간테스트가 없습니다.</div>
        ) : (
          <>
            {pi === 0 && <>
            <div className="avoid-break rounded-2xl border border-sky-100 p-4">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#3E4C59] mb-2">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: "#0EA5E9" }} />반 평균 (처음)</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: "#A7F3D0" }} />반 평균 (오답 정리 후)</span>
                <span className="flex items-center gap-1.5"><svg width="14" height="14"><line x1="7" y1="1" x2="7" y2="13" stroke="#475569" strokeWidth="1.5" /><line x1="3" y1="1" x2="11" y2="1" stroke="#475569" strokeWidth="1.5" /><line x1="3" y1="13" x2="11" y2="13" stroke="#475569" strokeWidth="1.5" /></svg>최고~최저 (처음)</span>
              </div>
              <ClassWeeklyChart tests={r.weekly.tests} />
            </div>
            <h3 className="text-[16px] font-bold mt-6 mb-2">학생별 점수 (처음 → 오답 정리 후)</h3>
            </>}
            <div className="overflow-hidden rounded-xl border border-sky-100">
              <table className="w-full text-[12px] tabular-nums">
                <thead className="bg-sky-50 text-sky-900">
                  <tr>
                    <th className="text-left font-semibold px-2 py-2">이름</th>
                    {r.weekly.tests.map(t => <th key={t.key} className="font-semibold px-1 py-2 leading-tight"><div>{t.date.slice(5).replace("-", "/")}</div><div className="font-normal text-[10px] text-sky-700 truncate max-w-[80px] mx-auto" title={t.title}>{t.title}</div></th>)}
                    <th className="font-semibold px-2 py-2">평균</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(s => {
                    const row = r.weekly.matrix[s.student_id] || {};
                    return (
                      <tr key={s.student_id} className="border-t border-sky-50 avoid-break">
                        <td className="px-2 py-1.5 font-semibold whitespace-nowrap">{s.name}</td>
                        {r.weekly.tests.map(t => {
                          const v = row[t.key];
                          return <td key={t.key} className={`px-1 py-1.5 text-center ${v && v.first < 50 ? "bg-amber-50" : ""}`}>{v ? <><b>{v.first}</b>{v.final > v.first && <span className="text-emerald-600">→{v.final}</span>}</> : <span className="text-[#CBD2D9]">미응시</span>}</td>;
                        })}
                        <td className="px-2 py-1.5 text-center font-bold text-sky-700">{s.weeklyAvg ?? "-"}</td>
                      </tr>
                    );
                  })}
                  {pi === wkPages.length - 1 && <tr className="border-t-2 border-sky-100 bg-sky-50/50 font-semibold">
                    <td className="px-2 py-1.5">반 평균</td>
                    {r.weekly.tests.map(t => <td key={t.key} className="px-1 py-1.5 text-center">{t.avgFirst}<span className="text-emerald-600">→{t.avgFinal}</span></td>)}
                    <td className="px-2 py-1.5 text-center text-sky-700">{r.totals.weeklyAvg ?? "-"}</td>
                  </tr>}
                </tbody>
              </table>
            </div>
            {pi === wkPages.length - 1 && <p className="text-[11px] text-[#7B8794] mt-2">점수는 시험지 전체 문항 중 맞힌 비율(100점 만점)입니다. 50점 미만 칸은 노란색으로 표시했습니다. 날짜는 시험지의 시험 날짜(없으면 배정일)입니다.</p>}
          </>
        )}
      </Page>
      ))}

      {/* 4. 학습평가 */}
      <Page title="학습평가" name={name} period={r.period}>
        <div className="avoid-break grid grid-cols-[320px_1fr] gap-6 items-center">
          <div className="flex flex-col items-center">
            <Radar items={r.competency.map(c => ({ name: c.name, me: c.rate, peer: c.peerRate, enough: c.enough }))} />
            <div className="flex gap-4 text-[12px] text-[#3E4C59]">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-indigo-500" />반 평균</span>
              {hasPeer && <PeerLegend label={peerLabel} />}
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            {r.competency.map(c => (
              <div key={c.name} className={`rounded-xl px-4 py-3 flex items-center justify-between ${c.enough ? "bg-indigo-50" : "bg-slate-50 opacity-70"}`}>
                <div>
                  <div className="text-[15px] font-semibold">{c.name}역량</div>
                  <div className="text-[12px] text-[#7B8794]">{c.enough ? `반 전체 관련 문항 ${c.n}개${hasPeer ? ` · 비교 반 ${rateText(c.peerRate)}` : ""}` : `관련 문항 ${c.n}개 · 데이터 부족`}</div>
                </div>
                <div className={`text-[26px] font-bold tabular-nums ${c.enough ? "text-indigo-700" : "text-slate-400"}`}>{c.enough ? rateText(c.rate) : "-"}</div>
              </div>
            ))}
          </div>
        </div>
        <h3 className="text-[18px] font-bold mt-8 mb-3">사고 수준별 정답률</h3>
        <div className="avoid-break grid grid-cols-3 gap-4">
          {r.cognitive.map((c, ci) => {
            const tone = [{ bg: "bg-sky-50", text: "text-sky-700", bar: "bg-sky-500" }, { bg: "bg-violet-50", text: "text-violet-700", bar: "bg-violet-500" }, { bg: "bg-rose-50", text: "text-rose-700", bar: "bg-rose-400" }][ci];
            return (
              <div key={c.level} className={`rounded-xl p-4 ${tone.bg}`}>
                <div className="text-[14px] font-semibold">{c.level}</div>
                <div className={`text-[34px] font-bold tabular-nums mt-1 ${tone.text}`}>{rateText(c.rate)}</div>
                <div className="mt-2 h-2 rounded-full bg-white relative">
                  {c.rate != null && <div className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`} style={{ width: `${c.rate}%` }} />}
                  {c.peerRate != null && <div className="absolute -top-1 -bottom-1 w-0.5 bg-[#7B8794]" style={{ left: `${c.peerRate}%` }} />}
                </div>
                <div className="text-[12px] text-[#616E7C] mt-2">반 전체 {c.n}문항{hasPeer && ` · 비교 반 ${rateText(c.peerRate)}`}</div>
              </div>
            );
          })}
        </div>
        <p className="text-[12px] text-[#7B8794] leading-relaxed mt-3">학생마다 정답률을 낸 뒤 평균했습니다. {hasPeer ? "막대 위 세로선은 비교 반 평균입니다. " : ""} 역량은 반 전체 관련 문항이 10개 미만이면 데이터 부족으로 표시하고, 그래프에는 다른 역량의 평균 위치에 빈 점으로 그립니다.</p>

        <h3 className="text-[18px] font-bold mt-8 mb-3">주차별 학습량</h3>
        <div className="avoid-break overflow-hidden rounded-xl border border-indigo-100">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="bg-indigo-50 text-indigo-900"><tr><th className="text-left font-semibold px-3 py-2">주차</th><th className="font-semibold px-3 py-2">반 전체 채점 문항</th><th className="font-semibold px-3 py-2">1인당</th><th className="font-semibold px-3 py-2">처음 정답률</th></tr></thead>
            <tbody>
              {r.weeks.map(w => (
                <tr key={w.label} className="border-t border-indigo-50"><td className="px-3 py-2 font-semibold">{w.label}</td><td className="px-3 py-2 text-center">{w.total}</td><td className="px-3 py-2 text-center">{w.perStudent}</td><td className="px-3 py-2 text-center">{rateText(w.rate)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Page>

      {/* 5. 단원별 성취 */}
      {unitPages.map((rows, pi) => (
      <Page key={`unit${pi}`} title={pi ? "단원별 성취 (계속)" : "단원별 성취"} name={name} period={r.period}>
        <div className="overflow-hidden rounded-xl border border-indigo-100">
          <table className="w-full text-[12px]">
            <thead className="bg-indigo-50 text-indigo-900">
              <tr>
                <th className="text-left font-semibold px-2 py-2">단원</th>
                <th className="font-semibold px-1 py-2 w-[70px]">문항 (학생)</th>
                <th className="font-semibold px-2 py-2 w-[120px]">반 정답률</th>
                <th className="text-left font-semibold px-2 py-2 w-[170px]">보완할 유형</th>
                <th className="text-left font-semibold px-2 py-2 w-[110px]">50% 미만 학생</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.key} className="border-t border-indigo-50 avoid-break align-top">
                  <td className="px-2 py-1.5"><div className="font-semibold">{u.name}</div>{u.curriculum && <div className="text-[10px] text-[#9AA5B1]">{u.curriculum}</div>}</td>
                  <td className="px-1 py-1.5 text-center tabular-nums">{u.n} ({u.students})</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-2 rounded-full bg-indigo-50"><div className={`h-2 rounded-full ${barTone(u.rate)}`} style={{ width: `${u.rate}%` }} /></div>
                      <span className="w-9 text-right tabular-nums font-semibold">{u.rate}%</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-[11px] leading-snug">{u.weakTypes.length ? u.weakTypes.map(t => <div key={t.name}>· {t.name} <span className="text-amber-700">{t.rate}%</span></div>) : <span className="text-[#9AA5B1]">-</span>}</td>
                  <td className="px-2 py-1.5 text-[11px] leading-snug text-rose-700">{u.low.length ? u.low.join(", ") : <span className="text-[#9AA5B1]">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pi === unitPages.length - 1 && <p className="text-[11px] text-[#7B8794] mt-2 leading-relaxed">문항 수가 많은 단원부터 보여 줍니다. 보완할 유형은 반 전체가 3문항 이상 풀고 정답률 60% 미만인 유형(최대 3개), 50% 미만 학생은 그 단원을 3문항 이상 풀고 처음 정답률이 50% 미만인 학생입니다.{r.unclassified > 0 && ` 단원 분류가 없는 문항 ${r.unclassified}개는 뺐습니다.`}</p>}
      </Page>
      ))}
    </>
  );
}

function ClassWeeklyChart({ tests }: { tests: ClassReport["weekly"]["tests"] }) {
  const W = 680, H = 230, PL = 34, PR = 12, PT = 28, PB = 40;
  const step = (W - PL - PR) / Math.max(tests.length, 1);
  const bw = Math.min(40, step * 0.45);
  const x = (i: number) => PL + step * i + step / 2;
  const y = (v: number) => PT + (1 - v / 100) * (H - PT - PB);
  const short = (s: string) => (s.length > 10 ? s.slice(0, 10) + "…" : s);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="주간테스트 반 평균 그래프">
      {[0, 25, 50, 75, 100].map(v => (<g key={v}><line x1={PL} y1={y(v)} x2={W - PR} y2={y(v)} stroke="#EEF0F2" /><text x={PL - 6} y={y(v) + 4} fontSize="10" fill="#9AA5B1" textAnchor="end">{v}</text></g>))}
      {tests.map((t, i) => (
        <g key={t.key}>
          {t.avgFinal > 0 && <rect x={x(i) - bw / 2} y={y(t.avgFinal)} width={bw} height={y(0) - y(t.avgFinal)} rx="5" fill="#A7F3D0" />}
          {t.avgFirst > 0 && <rect x={x(i) - bw / 2} y={y(t.avgFirst)} width={bw} height={y(0) - y(t.avgFirst)} rx="5" fill="#0EA5E9" />}
          <line x1={x(i) + bw / 2 + 8} y1={y(t.max)} x2={x(i) + bw / 2 + 8} y2={y(t.min)} stroke="#475569" strokeWidth="1.5" />
          <line x1={x(i) + bw / 2 + 4} y1={y(t.max)} x2={x(i) + bw / 2 + 12} y2={y(t.max)} stroke="#475569" strokeWidth="1.5" />
          <line x1={x(i) + bw / 2 + 4} y1={y(t.min)} x2={x(i) + bw / 2 + 12} y2={y(t.min)} stroke="#475569" strokeWidth="1.5" />
          <text x={x(i)} y={y(Math.max(t.avgFinal, t.avgFirst)) - 8} fontSize="12" fontWeight="700" fill="#0369A1" textAnchor="middle">{t.avgFirst}{t.avgFinal > t.avgFirst ? `→${t.avgFinal}` : ""}</text>
          <text x={x(i)} y={H - 22} fontSize="10" fill="#616E7C" textAnchor="middle">{t.date.slice(5).replace("-", "/")} · {t.taken}명</text>
          <text x={x(i)} y={H - 8} fontSize="10" fill="#7B8794" textAnchor="middle">{short(t.title)}</text>
        </g>
      ))}
    </svg>
  );
}

function Cover({ r }: { r: ClassReport }) {
  const [y, m] = r.ym.split("-");
  return (
    <section className="report-page !bg-slate-50 relative flex flex-col justify-between" style={{ padding: "20mm 18mm" }}>
      <div className="border-b-2 border-gray-300 pb-4">
        <p className="text-gray-500 text-sm font-medium tracking-wider tabular-nums">{r.period}</p>
      </div>
      <div className="flex flex-col items-start gap-3 mt-24">
        <h2 className="text-2xl text-emerald-800 font-semibold tracking-widest tabular-nums">{y}.{m}</h2>
        <h1 className="text-6xl text-slate-900 font-bold tracking-tight">{REPORT_TITLE_EN}</h1>
      </div>
      <div className="mt-10 mb-auto bg-emerald-50/70 p-8 border-l-4 border-emerald-700 rounded-r-lg">
        <p className="text-lg text-slate-600 mb-3 font-medium">{y}년 {Number(m)}월 {REPORT_TITLE_KO}</p>
        <div className="text-4xl text-slate-900 font-bold"><span className="text-emerald-800">{r.cls.name}</span></div>
        <div className="mt-3 text-lg text-slate-600">
          {r.cls.instructor && <>담당 {r.cls.instructor} 선생님 · </>}학생 {r.students.length}명
        </div>
      </div>
      <div className="flex justify-start mt-8">
        <img src={LOGO_URL} alt="로지카 수학" className="h-12 w-auto object-contain" />
      </div>
    </section>
  );
}
