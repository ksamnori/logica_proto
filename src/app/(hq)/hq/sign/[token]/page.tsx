// src/app/(hq)/hq/sign/[token]/page.tsx
// 외부 저자 · 프리랜서 원격 전자서명 화면 (로그인 불필요, 1회용 링크)
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { resolveStoragePublicUrl } from "@/lib/hq/clientApi";

interface SignView {
  contract_no: string;
  category_label: string;
  title: string;
  book_title: string | null;
  counterparty_name: string;
  counterparty_role: string;
  start_date: string | null;
  end_date: string | null;
  contract_amount: number;
  royalty_rate: number | null;
  tax_label: string;
  body_text: string;
  special_terms: string | null;
  company_name: string;
  company_signer_name: string;
  company_signed_at: string | null;
  seal_image_path: string | null;
  link_expires_at: string | null;
}

export default function HqRemoteSignPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<SignView | null>(null);
  const [signerName, setSignerName] = useState("");
  const [agree, setAgree] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ signed_at: string; doc_hash: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hq/contract-sign?token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "계약 정보를 불러오지 못했습니다.");
      }
      setView(json.data as SignView);
    } catch (e: any) {
      setError(e?.message || "계약 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const point = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const src = "touches" in e ? e.touches[0] : e;
    return {
      x: ((src.clientX - rect.left) * c.width) / rect.width,
      y: ((src.clientY - rect.top) * c.height) / rect.height,
    };
  };

  const start = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawingRef.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasStroke(true);
  };
  const end = () => {
    drawingRef.current = false;
  };
  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasStroke(false);
  };

  const submit = async () => {
    if (!view || !canvasRef.current) return;
    if (!hasStroke) {
      alert("서명란에 자필 서명을 해주세요.");
      return;
    }
    if (!agree) {
      alert("계약 내용 확인 및 전자서명 동의에 체크해 주세요.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hq/contract-sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          signer_name: signerName,
          agree,
          signature_data: canvasRef.current.toDataURL("image/png"),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || "서명 처리에 실패했습니다.");
      setDone({ signed_at: json.data.signed_at, doc_hash: json.data.doc_hash });
    } catch (e: any) {
      alert(e?.message || "서명 처리에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const sealUrl = view?.seal_image_path ? resolveStoragePublicUrl(view.seal_image_path) : null;

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 text-slate-800 break-keep">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="text-center">
          <div className="text-xs font-bold text-slate-500 tracking-widest">전자계약 원격 서명</div>
          <h1 className="text-lg font-black text-slate-900 mt-1">
            {view?.company_name || "(주)천종현수학연구소"}
          </h1>
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
            계약서를 불러오는 중입니다...
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl border border-rose-200 p-10 text-center space-y-2">
            <div className="text-3xl">⚠️</div>
            <p className="text-sm font-bold text-rose-700">{error}</p>
          </div>
        ) : done ? (
          <div className="bg-white rounded-2xl border border-emerald-200 p-10 text-center space-y-3">
            <div className="text-4xl">✅</div>
            <h2 className="text-base font-extrabold text-emerald-800">서명이 완료되어 계약이 체결되었습니다</h2>
            <p className="text-xs text-slate-600">
              문서번호 {view?.contract_no} · 체결일시 {done.signed_at.replace("T", " ").slice(0, 16)}
            </p>
            <p className="text-[11px] text-slate-400 font-mono break-all">문서 지문(SHA-256) {done.doc_hash}</p>
            <p className="text-xs text-slate-500">체결된 계약서 사본은 담당자를 통해 받으실 수 있습니다. 이 창을 닫으셔도 됩니다.</p>
          </div>
        ) : view ? (
          <>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 sm:p-8 space-y-5">
              <div className="text-center border-b-2 border-slate-900 pb-4">
                <div className="text-[11px] font-bold text-slate-500">문서번호 {view.contract_no}</div>
                <h2 className="text-xl font-black mt-1">{view.category_label}</h2>
                {view.book_title && (
                  <p className="text-sm font-bold text-slate-700 mt-1">대상 저작물: 「{view.book_title}」</p>
                )}
              </div>

              <table className="w-full text-xs border border-slate-300 border-collapse">
                <tbody>
                  <tr className="border-b border-slate-300">
                    <th className="w-24 bg-slate-50 py-2 px-3 text-left border-r border-slate-300">갑</th>
                    <td className="py-2 px-3 border-r border-slate-300 font-bold">{view.company_name}</td>
                    <th className="w-24 bg-slate-50 py-2 px-3 text-left border-r border-slate-300">을</th>
                    <td className="py-2 px-3 font-bold">
                      {view.counterparty_name} ({view.counterparty_role})
                    </td>
                  </tr>
                  <tr>
                    <th className="bg-slate-50 py-2 px-3 text-left border-r border-slate-300">기간</th>
                    <td className="py-2 px-3 border-r border-slate-300">
                      {view.start_date || "-"} ~ {view.end_date || "계약서 조항에 따름"}
                    </td>
                    <th className="bg-slate-50 py-2 px-3 text-left border-r border-slate-300">금액</th>
                    <td className="py-2 px-3 font-bold">
                      {view.contract_amount > 0 ? `${view.contract_amount.toLocaleString("ko-KR")}원` : "-"}
                      {view.royalty_rate ? ` · 인세 ${view.royalty_rate}%` : ""} · {view.tax_label}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="whitespace-pre-wrap text-[13px] leading-7 border border-slate-200 rounded-xl p-4 bg-slate-50/50 max-h-[50vh] overflow-y-auto">
                {view.body_text}
                {view.special_terms && (
                  <div className="mt-4 pt-4 border-t border-slate-200 font-semibold">
                    [특약 사항]{"\n"}
                    {view.special_terms}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border border-slate-300 rounded-xl p-4">
                <div>
                  <div className="text-[11px] font-bold text-slate-500">갑 (회사) 서명 완료</div>
                  <div className="text-sm font-extrabold mt-1">{view.company_signer_name}</div>
                  <div className="text-[11px] text-slate-500">{view.company_signed_at?.slice(0, 10) || "-"}</div>
                </div>
                {sealUrl ? (
                  <img src={sealUrl} alt="회사 직인" className="w-16 h-16 object-contain" />
                ) : (
                  <div className="w-16 h-16 rounded-full border-2 border-rose-600 text-rose-600 flex items-center justify-center text-[10px] font-black">
                    직인
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-blue-200 shadow-xs p-6 space-y-3">
              <h3 className="text-sm font-extrabold text-slate-900">✍️ 을({view.counterparty_name}) 본인 서명</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">성명(상호) 재확인</label>
                  <input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder={`계약서상 성명: ${view.counterparty_name}`}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
                <div className="text-[11px] text-slate-500 flex items-end">
                  링크 유효기간: {view.link_expires_at ? view.link_expires_at.slice(0, 10) : "-"} 까지 · 서명 시 접속 IP와 일시가 감사 기록으로 보관됩니다.
                </div>
              </div>
              <canvas
                ref={canvasRef}
                width={560}
                height={160}
                onMouseDown={start}
                onMouseMove={move}
                onMouseUp={end}
                onMouseLeave={end}
                onTouchStart={start}
                onTouchMove={move}
                onTouchEnd={end}
                className="w-full h-40 bg-white rounded-xl border-2 border-dashed border-blue-300 cursor-crosshair touch-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-start gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={agree}
                    onChange={(e) => setAgree(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>위 계약 내용을 모두 확인하였으며, 전자서명으로 계약을 체결하는 것에 동의합니다.</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={clear}
                    className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-600"
                  >
                    다시 쓰기
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={submit}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold disabled:opacity-50"
                  >
                    {submitting ? "처리 중..." : "서명 완료 및 계약 체결"}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
