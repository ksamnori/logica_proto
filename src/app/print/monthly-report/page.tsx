// src/app/print/monthly-report/page.tsx
// 월간 학습 리포트 (A4 세로, 인쇄·PDF 저장용)
// 주소: /print/monthly-report?student_id=...&month=YYYY-MM
"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { buildMonthlyReport, Report, DIFF_LABELS, ymLabel, shiftYm } from "@/lib/monthlyReport";

// 표지 제목: 바꾸고 싶으면 이 두 줄만 고치면 됨 (예: "Learning Report" / "월간 학습 리포트")
const REPORT_TITLE_EN = "LOGICA Report";
const REPORT_TITLE_KO = "월간 성장 리포트";

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
      <polygon points={poly("peer")} fill="none" stroke={PEER} strokeWidth="1.5" strokeDasharray="4 4" />
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
        <div className="text-[18px] text-[#1F2933]">{name} 학생</div>
      </div>
      <div className="text-right text-[12px] text-[#7B8794] mt-1.5 mb-6">학습내역 반영 기간 | {period}</div>
      {children}
    </section>
  );
}

const Chip = ({ text, color }: { text: string; color: string }) => (
  <span className="inline-block rounded-lg px-3 py-1 text-[15px] font-bold text-white" style={{ background: color }}>{text}</span>
);

const rateText = (v: number | null) => (v == null ? "-" : `${v}%`);

export default function MonthlyReportPage() {
  const [studentId, setStudentId] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  const [report, setReport] = useState<Report | null>(null);
  const [stepText, setStepText] = useState("리포트를 준비하는 중");
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [savedComment, setSavedComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("logica_instructor_id")) { alert("선생님 계정으로 로그인한 뒤 열어주세요."); window.location.href = "/"; return; }
    const sp = new URLSearchParams(window.location.search);
    const sid = sp.get("student_id") || "";
    if (!sid) { setError("주소에 학생 정보(student_id)가 없습니다. 학생 상세 화면의 [월간 리포트] 버튼으로 열어주세요."); return; }
    setStudentId(sid);
    setMonth(/^\d{4}-\d{2}$/.test(sp.get("month") || "") ? sp.get("month")! : defaultMonth());
  }, []);

  useEffect(() => {
    if (!studentId || !month) return;
    let alive = true;
    setReport(null); setError("");
    const url = new URL(window.location.href); url.searchParams.set("month", month); window.history.replaceState(null, "", url.toString());
    (async () => {
      try {
        const r = await buildMonthlyReport(studentId, month, t => alive && setStepText(t));
        if (!alive) return;
        setReport(r);
        document.title = `${r.student.name}_${month}_월간리포트`;
        const { data, error: cErr } = await supabase.from("monthly_report_comment").select("comment").eq("student_id", studentId).eq("year_month", month).maybeSingle();
        if (cErr) console.warn("선생님 의견 조회 실패:", cErr.message);
        setComment(data?.comment || ""); setSavedComment(data?.comment || "");
      } catch (e: any) {
        if (alive) setError(e.message || String(e));
      }
    })();
    return () => { alive = false; };
  }, [studentId, month]);

  const saveComment = async () => {
    setSaving(true);
    const { error: e } = await supabase.from("monthly_report_comment").upsert(
      { student_id: studentId, year_month: month, comment, updated_at: new Date().toISOString() },
      { onConflict: "student_id,year_month" }
    );
    setSaving(false);
    if (e) { alert("의견 저장 실패: " + e.message + "\n(monthly_report_comment.sql을 실행했는지 확인해주세요)"); return; }
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
        }
      `}</style>

      {/* 도구줄 */}
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

function ReportPages({ r, comment, setComment }: { r: Report; comment: string; setComment: (v: string) => void }) {
  const name = r.student.name;
  const trendPts = (key: "grade" | "rate" | "count" | "diff") => r.trend.map(t => ({ label: ymLabel(t.ym), me: t.me ? (t.me as any)[key] : null, peer: t.peer ? (t.peer as any)[key] : null }));
  const monthNum = Number(r.ym.slice(5, 7));

  if (!r.hasData) {
    return (
      <>
        <Cover r={r} />
        <Page title="월간분석" name={name} period={r.period}>
          <div className="rounded-xl bg-[#F5F7FA] p-10 text-center text-[16px] text-[#616E7C]">{monthNum}월에 채점된 학습 기록이 없습니다.</div>
        </Page>
      </>
    );
  }

  const big = [
    { chip: `${r.me.grade}등급`, color: "#3B82F6", bg: "bg-blue-50", value: String(r.me.grade), unit: "", peerLabel: "학원 내 동일 학년 평균 등급", trend: <TrendChart points={trendPts("grade")} invert color="#3B82F6" />, note: "보고서 기간 안에 처음 푼 정답률로 정합니다. 1등급 90% 이상, 2등급 80% 이상, 3등급 70% 이상, 4등급 50% 이상, 5등급 50% 미만." },
    { chip: `정답률 ${r.me.rate}%`, color: "#10B981", bg: "bg-emerald-50", value: String(r.me.rate), unit: "%", peerLabel: "학원 내 동일 학년 평균 정답률", trend: <TrendChart points={trendPts("rate")} unit="%" color="#10B981" />, note: "채점이 끝난 문항 중 처음 풀었을 때 맞힌 문항의 비율입니다. 오답을 고친 뒤 정답률은 다음 쪽에 있습니다." },
    { chip: `${r.me.count}문항 채점`, color: "#8B5CF6", bg: "bg-violet-50", value: String(r.me.count), unit: "", peerLabel: "학원 내 동일 학년 평균 문항 수", trend: <TrendChart points={trendPts("count")} color="#8B5CF6" />, note: "보고서 기간에 채점된 시험·과제 문항 수입니다. 입학테스트는 빼고 셉니다." },
    { chip: `난이도 ${r.me.diff.toFixed(1)}`, color: "#D97706", bg: "bg-amber-50", value: r.me.diff.toFixed(1), unit: "", peerLabel: "학원 내 동일 학년 평균 난이도", trend: <TrendChart points={trendPts("diff")} decimals={1} color="#D97706" />, note: "채점된 문항의 난이도 평균입니다. 최하 1, 하 2, 중 3, 상 4, 최상 5." },
  ];

  return (
    <>
      <Cover r={r} />

      <Page title="월간분석" name={name} period={r.period}>
        <div className="grid grid-cols-2 gap-5">
          {big.map(b => (
            <div key={b.chip} className={`avoid-break flex flex-col rounded-2xl p-4 ${b.bg}`}>
              <div className="flex items-center justify-between">
                <Chip text={b.chip} color={b.color} />
                <span className="flex items-center gap-1.5 text-[11px] text-[#7B8794]"><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={PEER} strokeWidth="1.5" strokeDasharray="3 3" /></svg>{b.peerLabel}</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[84px] font-bold leading-none tabular-nums" style={{ color: b.color }}>{b.value}<span className="text-[32px]">{b.unit}</span></span>
                {b.trend}
              </div>
              <p className="text-[11px] text-[#7B8794] leading-relaxed mt-2">{b.note}</p>
            </div>
          ))}
        </div>

        <div className="avoid-break mt-6 rounded-2xl bg-amber-50 border border-amber-100 p-5">
          <div className="text-[18px] font-bold text-amber-800 mb-2">선생님 의견</div>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="이번 달 학습에 대한 의견을 적어 주세요. (인쇄할 때는 적은 글만 보입니다)"
            className="w-full h-[40mm] bg-transparent text-[14px] leading-relaxed text-[#1F2933] outline-none border border-dashed border-amber-200 rounded-lg p-2 placeholder:text-amber-400"
          />
        </div>
      </Page>

      <Page title="학습 태도" name={name} period={r.period}>
        <div className="avoid-break grid grid-cols-2 gap-6">
          <div className="rounded-2xl bg-sky-50 p-5">
            <div className="text-[14px] text-sky-800">처음 정답률 → 오답을 고친 뒤 정답률</div>
            <div className="flex items-baseline gap-3 mt-2">
              <span className="text-[48px] font-bold text-sky-700 tabular-nums leading-none">{r.attitude.firstRate}%</span>
              <span className="text-[24px] text-[#9AA5B1]">→</span>
              <span className="text-[48px] font-bold text-emerald-600 tabular-nums leading-none">{r.attitude.finalRate}%</span>
            </div>
            <div className="mt-4 h-3 rounded-full bg-white relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-emerald-300 rounded-full" style={{ width: `${r.attitude.finalRate}%` }} />
              <div className="absolute inset-y-0 left-0 bg-sky-500 rounded-full" style={{ width: `${r.attitude.firstRate}%` }} />
            </div>
            <p className="text-[13px] text-[#3E4C59] leading-relaxed mt-3">처음에 틀린 문제 중 클리닉과 오답 정리로 {r.attitude.finalRate - r.attitude.firstRate}%p를 더 해결했어요. 아직 해결하지 못한 문항은 {r.attitude.wrongLeft}개예요.</p>
          </div>
          <div className="rounded-2xl bg-violet-50 p-5 grid grid-cols-2 gap-4">
            {[
              { label: "스스로 고쳐 맞힘", v: `${r.attitude.selfFixed}문항`, sub: "선생님 도움 없이 다시 풀어 맞힌 문항" },
              { label: "힌트를 받은 문항", v: `${r.attitude.hinted}문항`, sub: `전체의 ${r.attitude.hintRate}%` },
              { label: "과제 완료", v: r.attitude.homework.total ? `${r.attitude.homework.rate}%` : "-", sub: r.attitude.homework.total ? `${r.attitude.homework.total}개 중 ${r.attitude.homework.done}개` : "마감된 과제 없음" },
              { label: "출결", v: `${r.attitude.attendance.present + r.attitude.attendance.late + r.attitude.attendance.early}회 출석`, sub: `지각 ${r.attitude.attendance.late} / 조퇴 ${r.attitude.attendance.early} / 결석 ${r.attitude.attendance.absent}` },
            ].map(x => (
              <div key={x.label}>
                <div className="text-[13px] text-[#616E7C]">{x.label}</div>
                <div className="text-[24px] font-bold tabular-nums mt-1">{x.v}</div>
                <div className="text-[12px] text-[#7B8794] mt-0.5">{x.sub}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[12px] text-[#7B8794] leading-relaxed mt-4">처음 정답률은 처음 풀었을 때 맞힌 문항(O)만 셉니다. 고친 뒤 정답률은 스스로 다시 풀어 맞힌 문항(RO)과 힌트를 받고 맞힌 문항(TO)까지 포함합니다.</p>

        <h3 className="text-[18px] font-bold mt-10 mb-3">주간분석: 난이도별 푼 문항 수와 정답률</h3>
        <div className="avoid-break overflow-hidden rounded-xl border border-indigo-100">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="bg-indigo-50 text-indigo-900">
              <tr>
                <th className="text-left font-semibold px-3 py-2">주차</th>
                {DIFF_LABELS.map(d => <th key={d} className="font-semibold px-2 py-2">{d}</th>)}
                <th className="font-semibold px-3 py-2">합계</th>
              </tr>
            </thead>
            <tbody>
              {r.weeks.map(w => (
                <tr key={w.label} className="border-t border-indigo-50">
                  <td className="px-3 py-2 font-semibold">{w.label}</td>
                  {w.byDiff.map((d, i) => (
                    <td key={i} className="px-2 py-2 text-center">{d.n ? <><b>{d.n}</b><span className="text-[#7B8794]"> ({d.rate}%)</span></> : <span className="text-[#CBD2D9]">-</span>}</td>
                  ))}
                  <td className="px-3 py-2 text-center"><b>{w.total}</b><span className="text-[#7B8794]"> ({w.rate}%)</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-[#7B8794] mt-2">칸 안의 숫자는 푼 문항 수, 괄호 안은 처음 정답률입니다.</p>
      </Page>

      <Page title="학습평가" name={name} period={r.period}>
        <div className="avoid-break grid grid-cols-[320px_1fr] gap-6 items-center">
          <div className="flex flex-col items-center">
            <Radar items={r.competency.map(c => ({ name: c.name, me: c.rate, peer: c.peerRate, enough: c.enough }))} />
            <div className="flex gap-4 text-[12px] text-[#3E4C59]">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-indigo-500" />내 정답률</span>
              <span className="flex items-center gap-1.5"><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={PEER} strokeWidth="1.5" strokeDasharray="3 3" /></svg>학원 내 동일 학년 평균</span>
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            {r.competency.map(c => (
              <div key={c.name} className={`rounded-xl px-4 py-3 flex items-center justify-between ${c.enough ? "bg-indigo-50" : "bg-slate-50 opacity-70"}`}>
                <div>
                  <div className="text-[15px] font-semibold">{c.name}역량</div>
                  <div className="text-[12px] text-[#7B8794]">{c.enough ? `관련 문항 ${c.n}개 · 평균 ${rateText(c.peerRate)}` : `관련 문항 ${c.n}개 · 이번 달 데이터 부족`}</div>
                </div>
                <div className={`text-[26px] font-bold tabular-nums ${c.enough ? "text-indigo-700" : "text-slate-400"}`}>{c.enough ? rateText(c.rate) : "-"}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[12px] text-[#7B8794] leading-relaxed mt-3">2022 개정 교육과정 수학과 교과 역량입니다. 문항 유형마다 주 역량과 보조 역량을 정해 두고, 주 역량 문항은 1, 보조 역량 문항은 0.5로 계산합니다. 관련 문항이 5개 미만인 역량은 데이터 부족으로 표시하고, 그래프에는 다른 역량의 평균 위치에 빈 점으로 그립니다.</p>

        <h3 className="text-[18px] font-bold mt-8 mb-3">사고 수준별 정답률</h3>
        <div className="avoid-break grid grid-cols-3 gap-4">
          {r.cognitive.map((c, ci) => {
            const tone = [{ bg: "bg-sky-50", text: "text-sky-700", bar: "bg-sky-500" }, { bg: "bg-violet-50", text: "text-violet-700", bar: "bg-violet-500" }, { bg: "bg-rose-50", text: "text-rose-700", bar: "bg-rose-400" }][ci] || { bg: "bg-slate-50", text: "text-slate-700", bar: "bg-slate-500" };
            return (
            <div key={c.level} className={`rounded-xl p-4 ${tone.bg}`}>
              <div className="text-[14px] font-semibold">{c.level}</div>
              <div className={`text-[34px] font-bold tabular-nums mt-1 ${tone.text}`}>{rateText(c.rate)}</div>
              <div className="mt-2 h-2 rounded-full bg-white relative">
                {c.rate != null && <div className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`} style={{ width: `${c.rate}%` }} />}
                {c.peerRate != null && <div className="absolute -top-1 -bottom-1 w-0.5 bg-[#7B8794]" style={{ left: `${c.peerRate}%` }} title="평균" />}
              </div>
              <div className="text-[12px] text-[#616E7C] mt-2">{c.n}문항 · 평균 {rateText(c.peerRate)}</div>
            </div>
            );
          })}
        </div>
        <p className="text-[12px] text-[#7B8794] leading-relaxed mt-3">문항이 요구하는 생각의 깊이에 따라 나눈 정답률입니다. 계산은 잘하는데 응용에서 막히는지, 추론이 필요한 문제에서 약한지 한눈에 볼 수 있어요. 막대 위 세로선은 학원 내 동일 학년 평균입니다.</p>

        <div className="avoid-break mt-8 rounded-2xl bg-indigo-50 p-5">
          <div className="text-[14px] font-bold mb-3">각 역량의 뜻</div>
          <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 text-[12px] leading-relaxed text-[#3E4C59]">
            {[
              ["문제해결", "조건과 정보를 분석해 해결 전략을 세우고 답을 구하는 힘"],
              ["추론", "성질과 규칙을 찾고, 이유를 설명하고 정당화하는 힘"],
              ["의사소통", "수학 용어·기호·식·그래프를 정확히 읽고 쓰고 바꾸는 힘"],
              ["연결", "다른 단원·학년의 개념이나 실생활 상황과 연결하는 힘"],
              ["정보처리", "표·그래프·통계 자료를 정리하고 해석하는 힘"],
            ].map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="font-bold text-indigo-800 whitespace-nowrap">{k}</dt>
                <dd className="m-0 whitespace-nowrap">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      </Page>

      <Page title="학습내역" name={name} period={r.period}>
        <div className="text-[22px] font-bold mb-4">총 <span className="text-indigo-600">{r.me.count}</span>문항을 풀었어요</div>
        <div className="overflow-hidden rounded-xl border border-indigo-100">
          <table className="w-full text-[13px]">
            <thead className="bg-indigo-50 text-indigo-900">
              <tr>
                <th className="text-left font-semibold px-3 py-2 w-[110px]">종류</th>
                <th className="text-left font-semibold px-3 py-2">학습지</th>
                <th className="font-semibold px-3 py-2 w-[90px]">채점일</th>
                <th className="font-semibold px-3 py-2 w-[70px]">문항 수</th>
                <th className="font-semibold px-3 py-2 w-[70px]">정답률</th>
              </tr>
            </thead>
            <tbody>
              {r.sheets.map((s, i) => (
                <tr key={i} className="border-t border-indigo-50 avoid-break">
                  <td className="px-3 py-2"><span className={`inline-block rounded px-2 py-0.5 text-[12px] font-semibold ${s.tag === "과제" ? "bg-amber-100 text-amber-800" : s.tag.includes("오답") ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-800"}`}>{s.tag}</span></td>
                  <td className="px-3 py-2">{s.title}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{s.date.slice(5).replace("-", "/")}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{s.n}</td>
                  <td className="px-3 py-2 text-center tabular-nums font-semibold">{s.rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Page>

      <Page title="학습성과" name={name} period={r.period}>
        <div className="overflow-hidden rounded-xl border border-indigo-100">
          <table className="w-full text-[13px]">
            <thead className="bg-indigo-50 text-indigo-900">
              <tr>
                <th className="text-left font-semibold px-3 py-2 w-[70px]">개정</th>
                <th className="text-left font-semibold px-3 py-2">단원</th>
                <th className="font-semibold px-3 py-2 w-[80px]">문항 수</th>
                <th className="font-semibold px-3 py-2 w-[170px]">정답률</th>
              </tr>
            </thead>
            <tbody>
              {r.units.map(u => (
                <tr key={u.key} className="border-t border-indigo-50 avoid-break">
                  <td className="px-3 py-2 text-[#616E7C]">{u.curriculum}</td>
                  <td className="px-3 py-2 font-semibold">{u.name}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{u.n}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-indigo-50"><div className={`h-2 rounded-full ${u.rate >= 80 ? "bg-emerald-400" : u.rate < 50 ? "bg-amber-400" : "bg-indigo-400"}`} style={{ width: `${u.rate}%` }} /></div>
                      <span className="w-10 text-right tabular-nums font-semibold">{u.rate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.unclassified > 0 && <p className="text-[12px] text-[#7B8794] mt-2">단원 분류가 아직 없는 문항 {r.unclassified}개는 단원별 통계에서 뺐습니다.</p>}
      </Page>

      {r.units.map(u => (
        <Page key={u.key} title="진단결과" name={name} period={r.period}>
          <div className="flex items-baseline gap-3">
            <span className="text-[24px] font-bold">{u.name}</span>
            {u.curriculum && <span className="text-[13px] text-[#616E7C] rounded bg-[#EEF0F2] px-2 py-0.5">{u.curriculum}</span>}
          </div>
          <div className="text-[15px] text-[#3E4C59] mt-2">전체 정답률 <b className="text-[22px] text-indigo-600 tabular-nums">{u.rate}%</b><span className="mx-3 text-[#CBD2D9]">|</span>풀어본 문항 수 <b className="text-[22px] tabular-nums">{u.n}</b></div>

          <div className="avoid-break grid grid-cols-2 gap-4 mt-5">
            <div className="rounded-xl bg-emerald-50 p-4">
              <div className="text-[14px] font-bold text-emerald-700 mb-2">잘하는 유형</div>
              {u.best.length ? u.best.map(b => <div key={b} className="text-[13px] leading-relaxed">· {b}</div>) : <div className="text-[13px] text-[#616E7C]">2문항 이상 풀고 80% 이상 맞힌 유형이 아직 없어요</div>}
            </div>
            <div className="rounded-xl bg-amber-50 p-4">
              <div className="text-[14px] font-bold text-amber-800 mb-2">보완할 유형</div>
              {u.weak.length ? u.weak.map(b => <div key={b} className="text-[13px] leading-relaxed">· {b}</div>) : <div className="text-[13px] text-[#616E7C]">보완이 필요한 유형이 없어요</div>}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-indigo-100 mt-5">
            <table className="w-full text-[13px]">
              <thead className="bg-indigo-50 text-indigo-900">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">유형</th>
                  <th className="font-semibold px-3 py-2 w-[70px]">문항 수</th>
                  <th className="font-semibold px-3 py-2 w-[150px]">정답률</th>
                </tr>
              </thead>
              <tbody>
                {u.types.map(t => (
                  <tr key={t.name} className="border-t border-indigo-50 avoid-break">
                    <td className="px-3 py-2">
                      {t.mark && <span className={`inline-block mr-2 rounded px-1.5 py-0.5 text-[11px] font-bold ${t.mark === "우수" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{t.mark === "우수" ? "잘함" : "보완"}</span>}
                      {t.name}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">{t.n}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-indigo-50"><div className={`h-2 rounded-full ${t.rate >= 80 ? "bg-emerald-400" : t.rate < 50 ? "bg-amber-400" : "bg-indigo-400"}`} style={{ width: `${t.rate}%` }} /></div>
                        <span className="w-10 text-right tabular-nums">{t.rate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-[#7B8794] mt-2">한 문항만 풀어 본 유형은 잘함·보완을 판정하지 않습니다.</p>
        </Page>
      ))}
    </>
  );
}

function Cover({ r }: { r: Report }) {
  const [y, m] = r.ym.split("-");
  const classText = (r.student.classNames || []).join(", ");
  return (
    // A4 한 장, 아주 옅은 바탕
    <section className="report-page !bg-slate-50 relative flex flex-col justify-between" style={{ padding: "20mm 18mm" }}>

      {/* 1. 상단 기간 */}
      <div className="border-b-2 border-gray-300 pb-4">
        <p className="text-gray-500 text-sm font-medium tracking-wider tabular-nums">{r.period}</p>
      </div>

      {/* 2. 메인 타이틀 + 학생 정보 (타이틀 바로 아래) */}
      <div className="flex flex-col items-start gap-3 mt-24">
        <h2 className="text-2xl text-emerald-800 font-semibold tracking-widest tabular-nums">{y}.{m}</h2>
        <h1 className="text-6xl text-slate-900 font-bold tracking-tight">{REPORT_TITLE_EN}</h1>
      </div>

      <div className="mt-10 mb-auto bg-emerald-50/70 p-8 border-l-4 border-emerald-700 rounded-r-lg">
        <p className="text-lg text-slate-600 mb-3 font-medium">{y}년 {Number(m)}월 {REPORT_TITLE_KO}</p>
        <div className="flex items-baseline gap-3 flex-wrap">
          {classText && <span className="text-2xl text-slate-500 font-medium">{classText}</span>}
          <span className="text-4xl text-slate-900 font-bold">
            <span className="text-emerald-800">{r.student.name}</span> 학생
          </span>
        </div>
      </div>

      {/* 3. 하단 학원 로고 */}
      <div className="flex justify-start mt-8">
        <img src={LOGO_URL} alt="로지카 수학" className="h-12 w-auto object-contain" />
      </div>
    </section>
  );
}
