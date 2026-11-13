// src/components/hq/members/CertificatePrintModal.tsx
"use client";

import React, { useState } from "react";
import type { HqMember } from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  member: HqMember | null;
  onClose: () => void;
}

export default function CertificatePrintModal({ isOpen, member, onClose }: Props) {
  const [certType, setCertType] = useState<"재직증명서" | "경력증명서">("재직증명서");
  const [purpose, setPurpose] = useState("금융기관 제출용");

  if (!isOpen || !member) return null;

  const todayStr = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const issueNo = `CERT-${new Date().getFullYear()}-${member.employee_no.slice(-4)}`;
  const periodEnd =
    member.work_status === "퇴직" && member.resign_date
      ? member.resign_date
      : "현재 (재직중)";

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:static print:bg-white print:p-0">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden print:shadow-none print:border-none print:max-h-none print:max-w-none">
        {/* 상단 컨트롤 바 (인쇄 시 숨김) */}
        <div className="print:hidden px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            {(["재직증명서", "경력증명서"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setCertType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  certType === t
                    ? "bg-white text-slate-900"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {t}
              </button>
            ))}
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="ml-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-bold text-white"
            >
              <option value="금융기관 제출용">금융기관 제출용</option>
              <option value="관공서 제출용">관공서 제출용</option>
              <option value="비자 발급 제출용">비자 발급 제출용</option>
              <option value="기타 증빙용">기타 증빙용</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-sm"
            >
              🖨️ 인쇄 / PDF 저장
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
            >
              닫기
            </button>
          </div>
        </div>

        {/* 증명서 본문 (인쇄 영역) */}
        <div className="p-8 sm:p-12 overflow-y-auto flex-1 bg-white text-slate-900">
          <div className="border-2 border-slate-800 p-8 sm:p-10">
            <div className="flex justify-between text-xs text-slate-500 font-semibold mb-6">
              <span>문서번호: {issueNo}</span>
              <span>셀프서비스 즉시발급</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-center tracking-[0.35em] text-slate-900 mb-10">
              {certType}
            </h1>

            <table className="w-full border-collapse border border-slate-400 text-sm mb-8">
              <tbody>
                <tr>
                  <th className="w-28 bg-slate-100 border border-slate-400 px-4 py-3 text-left font-bold">
                    성 명
                  </th>
                  <td className="border border-slate-400 px-4 py-3 font-semibold">
                    {member.name}
                  </td>
                  <th className="w-28 bg-slate-100 border border-slate-400 px-4 py-3 text-left font-bold">
                    사 번
                  </th>
                  <td className="border border-slate-400 px-4 py-3">
                    {member.employee_no}
                  </td>
                </tr>
                <tr>
                  <th className="bg-slate-100 border border-slate-400 px-4 py-3 text-left font-bold">
                    소속 부서
                  </th>
                  <td className="border border-slate-400 px-4 py-3">
                    {member.department}
                  </td>
                  <th className="bg-slate-100 border border-slate-400 px-4 py-3 text-left font-bold">
                    직위 / 직책
                  </th>
                  <td className="border border-slate-400 px-4 py-3">
                    {member.job_title} ({member.employment_type})
                  </td>
                </tr>
                <tr>
                  <th className="bg-slate-100 border border-slate-400 px-4 py-3 text-left font-bold">
                    재직 기간
                  </th>
                  <td colSpan={3} className="border border-slate-400 px-4 py-3">
                    {member.hire_date || "-"} ~ {periodEnd}
                  </td>
                </tr>
                <tr>
                  <th className="bg-slate-100 border border-slate-400 px-4 py-3 text-left font-bold">
                    담당 업무
                  </th>
                  <td colSpan={3} className="border border-slate-400 px-4 py-3">
                    {member.job_description || `${member.department} 제반 업무`}
                  </td>
                </tr>
                <tr>
                  <th className="bg-slate-100 border border-slate-400 px-4 py-3 text-left font-bold">
                    연 락 처
                  </th>
                  <td className="border border-slate-400 px-4 py-3">
                    {member.phone || "-"}
                  </td>
                  <th className="bg-slate-100 border border-slate-400 px-4 py-3 text-left font-bold">
                    발급 용도
                  </th>
                  <td className="border border-slate-400 px-4 py-3 font-semibold">
                    {purpose}
                  </td>
                </tr>
                {member.address && (
                  <tr>
                    <th className="bg-slate-100 border border-slate-400 px-4 py-3 text-left font-bold">
                      주 소
                    </th>
                    <td colSpan={3} className="border border-slate-400 px-4 py-3">
                      {member.address}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <p className="text-center text-base font-bold text-slate-800 my-10 leading-relaxed">
              위와 같이 {certType === "재직증명서" ? "재직하고 있음을" : "근무하였음을"}{" "}
              증명합니다.
            </p>

            <div className="text-center text-sm font-semibold text-slate-600 mb-10">
              {todayStr}
            </div>

            <div className="flex items-center justify-center gap-4 pt-4">
              <div className="text-right">
                <div className="text-lg font-extrabold text-slate-900 tracking-wide">
                  천종현수학연구소
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  본부 인사총괄팀 직인 생략 (전자발급)
                </div>
              </div>
              <div className="w-14 h-14 rounded-full border-2 border-rose-600 text-rose-600 flex items-center justify-center text-[11px] font-extrabold leading-tight text-center rotate-[-8deg] select-none">
                천종현수학
                <br />
                연구소인
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
