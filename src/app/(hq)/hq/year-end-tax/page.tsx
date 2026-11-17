// src/app/(hq)/hq/year-end-tax/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import {
  hqFetch,
  resolveStoragePublicUrl,
  uploadHqReceiptFile,
} from "@/lib/hq/clientApi";
import { buildCsvContent, triggerCsvDownload } from "@/lib/hq/payrollUtils";
import type {
  HqMember,
  HqYearEndMemberSubmission,
  HqYearEndTaxStatus,
  HqYearEndUploadedFile,
} from "@/lib/hq/types";

const STATUS_META: Record<
  HqYearEndTaxStatus,
  { label: string; badgeClass: string }
> = {
  NOT_SUBMITTED: {
    label: "미제출",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
  },
  SUBMITTED: {
    label: "서류 제출완료",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  SUPPLEMENT_REQ: {
    label: "보완 요청",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
  },
  COMPLETED: {
    label: "정산·배부 완료",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
};

const EXTRA_DOC_CATEGORIES = [
  "전근무지 원천징수영수증",
  "월세 계약서·이체내역",
  "기부금·의료·교육비 영수증",
  "주민등록등본·가족관계증명서",
  "기타 공제 증빙",
] as const;

export default function HqYearEndTaxPage() {
  const { me, members, companySettings, isHrManager } = useHqShell();

  const defaultYear = useMemo(() => {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const y = kst.getUTCFullYear();
    const m = kst.getUTCMonth() + 1;
    return m <= 4 ? y - 1 : y;
  }, []);

  const yearOptions = useMemo(() => {
    const cur = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
    return [cur, cur - 1, cur - 2];
  }, []);

  const [year, setYear] = useState<number>(defaultYear);
  const [viewMode, setViewMode] = useState<"ADMIN" | "MINE">("ADMIN");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [deadlineDate, setDeadlineDate] = useState("");
  const [noticeMemo, setNoticeMemo] = useState("");
  const [editingConfig, setEditingConfig] = useState(false);

  const [submissions, setSubmissions] = useState<
    Record<string, HqYearEndMemberSubmission>
  >({});
  const [annualPayrollSummary, setAnnualPayrollSummary] = useState<
    Record<string, { grossSum: number; taxSum: number; monthsCount: number }>
  >({});

  // 내 제출 폼 상태
  const [myHometaxPdf, setMyHometaxPdf] =
    useState<HqYearEndUploadedFile | null>(null);
  const [myExtraFiles, setMyExtraFiles] = useState<HqYearEndUploadedFile[]>([]);
  const [extraCategory, setExtraCategory] = useState<string>(
    EXTRA_DOC_CATEGORIES[0]
  );
  const [myDepNote, setMyDepNote] = useState("");
  const [myTaxReduction, setMyTaxReduction] = useState(false);
  const [myPrevWork, setMyPrevWork] = useState(false);
  const [myMemo, setMyMemo] = useState("");
  const [uploadingMyFile, setUploadingMyFile] = useState(false);

  // 관리자 필터 & 결과 등록 모달
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "PENDING" | "SUBMITTED" | "COMPLETED"
  >("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<HqMember | null>(null);
  const [adminDiffKind, setAdminDiffKind] = useState<
    "REFUND" | "COLLECT" | "ZERO"
  >("REFUND");
  const [adminDiffAmount, setAdminDiffAmount] = useState("");
  const [adminSupplementNote, setAdminSupplementNote] = useState("");
  const [adminReceiptPdf, setAdminReceiptPdf] =
    useState<HqYearEndUploadedFile | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  const loadYearData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          year: number;
          deadline_date: string;
          notice_memo: string;
          mySubmission: HqYearEndMemberSubmission;
          submissions: Record<string, HqYearEndMemberSubmission>;
          annualPayrollSummary: Record<
            string,
            { grossSum: number; taxSum: number; monthsCount: number }
          >;
        };
      }>(`/api/hq/year-end-tax?year=${year}`);

      const d = res.data;
      setDeadlineDate(d.deadline_date || `${year + 1}-01-22`);
      setNoticeMemo(d.notice_memo || "");
      setSubmissions(d.submissions || {});
      setAnnualPayrollSummary(d.annualPayrollSummary || {});

      if (d.mySubmission) {
        setMyHometaxPdf(d.mySubmission.hometax_pdf || null);
        setMyExtraFiles(d.mySubmission.extra_files || []);
        setMyDepNote(d.mySubmission.dependent_change_note || "");
        setMyTaxReduction(Boolean(d.mySubmission.tax_reduction_check));
        setMyPrevWork(Boolean(d.mySubmission.prev_workplace_check));
        setMyMemo(d.mySubmission.employee_memo || "");
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    loadYearData();
  }, [loadYearData]);

  const mySub = me ? submissions[me.instructor_id] : undefined;
  const isMidYearHireMe = Boolean(me?.hire_date?.startsWith(String(year)));

  // 대상 인원: 재직자 + 해당 귀속연도 퇴사자
  const targetMembers = useMemo(
    () =>
      members.filter(
        (m) =>
          m.work_status === "재직" ||
          m.work_status === "휴직" ||
          (m.resign_date && m.resign_date.startsWith(String(year)))
      ),
    [members, year]
  );

  const kpi = useMemo(() => {
    let submitted = 0;
    let pending = 0;
    let completed = 0;
    targetMembers.forEach((m) => {
      const st = submissions[m.instructor_id]?.status || "NOT_SUBMITTED";
      if (st === "COMPLETED") completed++;
      else if (st === "SUBMITTED") submitted++;
      else pending++;
    });
    return {
      total: targetMembers.length,
      submitted: submitted + completed,
      pending,
      completed,
    };
  }, [targetMembers, submissions]);

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return targetMembers.filter((m) => {
      const st = submissions[m.instructor_id]?.status || "NOT_SUBMITTED";
      if (
        statusFilter === "PENDING" &&
        st !== "NOT_SUBMITTED" &&
        st !== "SUPPLEMENT_REQ"
      )
        return false;
      if (statusFilter === "SUBMITTED" && st !== "SUBMITTED") return false;
      if (statusFilter === "COMPLETED" && st !== "COMPLETED") return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        (m.department || "").toLowerCase().includes(q)
      );
    });
  }, [targetMembers, submissions, statusFilter, searchQuery]);

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      await hqFetch("/api/hq/year-end-tax", {
        method: "POST",
        body: {
          action: "UPDATE_CONFIG",
          year,
          deadline_date: deadlineDate,
          notice_memo: noticeMemo,
        },
      });
      setEditingConfig(false);
    } catch (err: any) {
      alert(err?.message || "안내 설정 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleUploadMyHometax = async (file: File | null) => {
    if (!file) return;
    setUploadingMyFile(true);
    try {
      const storagePath = await uploadHqReceiptFile(file, "hq_yearend_docs");
      setMyHometaxPdf({
        id: `ht_${Date.now()}`,
        file_name: file.name,
        url: storagePath,
        uploaded_at: new Date().toISOString().slice(0, 10),
      });
    } catch (err: any) {
      alert(err?.message || "파일 업로드에 실패했습니다.");
    } finally {
      setUploadingMyFile(false);
    }
  };

  const handleUploadMyExtra = async (file: File | null) => {
    if (!file) return;
    setUploadingMyFile(true);
    try {
      const storagePath = await uploadHqReceiptFile(file, "hq_yearend_docs");
      setMyExtraFiles((prev) => [
        ...prev,
        {
          id: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          category: extraCategory,
          file_name: file.name,
          url: storagePath,
          uploaded_at: new Date().toISOString().slice(0, 10),
        },
      ]);
    } catch (err: any) {
      alert(err?.message || "추가 증빙 업로드 실패");
    } finally {
      setUploadingMyFile(false);
    }
  };

  const handleSubmitMyDocs = async () => {
    if (!myHometaxPdf && myExtraFiles.length === 0) {
      if (
        !confirm(
          "첨부된 홈택스 간소화 PDF가 없습니다. 기본공제만으로 진행하시겠습니까?"
        )
      ) {
        return;
      }
    }
    setSaving(true);
    try {
      await hqFetch("/api/hq/year-end-tax", {
        method: "POST",
        body: {
          action: "SAVE_EMPLOYEE_SUBMISSION",
          year,
          mark_submitted: true,
          hometax_pdf: myHometaxPdf,
          extra_files: myExtraFiles,
          dependent_change_note: myDepNote,
          tax_reduction_check: myTaxReduction,
          prev_workplace_check: myPrevWork,
          employee_memo: myMemo,
        },
      });
      alert("✅ 연말정산 서류 제출이 완료되었습니다.");
      await loadYearData();
    } catch (err: any) {
      alert(err?.message || "제출 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const openAdminModal = (m: HqMember) => {
    const sub = submissions[m.instructor_id];
    setSelectedMember(m);
    setAdminSupplementNote(sub?.admin_supplement_note || "");
    setAdminReceiptPdf(sub?.receipt_pdf || null);
    const diff = sub?.settlement_tax_diff;
    if (diff === null || diff === undefined) {
      setAdminDiffKind("REFUND");
      setAdminDiffAmount("");
    } else if (diff < 0) {
      setAdminDiffKind("REFUND");
      setAdminDiffAmount(String(Math.abs(diff)));
    } else if (diff > 0) {
      setAdminDiffKind("COLLECT");
      setAdminDiffAmount(String(diff));
    } else {
      setAdminDiffKind("ZERO");
      setAdminDiffAmount("0");
    }
  };

  const handleUploadAdminReceipt = async (file: File | null) => {
    if (!file) return;
    setUploadingReceipt(true);
    try {
      const storagePath = await uploadHqReceiptFile(file, "hq_yearend_receipts");
      setAdminReceiptPdf({
        id: `rcp_${Date.now()}`,
        file_name: file.name,
        url: storagePath,
        uploaded_at: new Date().toISOString().slice(0, 10),
      });
    } catch (err: any) {
      alert(err?.message || "원천징수영수증 업로드 실패");
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleSaveAdminAction = async (nextStatus: HqYearEndTaxStatus) => {
    if (!selectedMember) return;
    setSaving(true);
    try {
      let signedDiff: number | null = null;
      if (nextStatus === "COMPLETED") {
        const amt = Math.abs(Math.round(Number(adminDiffAmount || 0)));
        if (adminDiffKind === "REFUND") signedDiff = amt > 0 ? -amt : 0;
        else if (adminDiffKind === "COLLECT") signedDiff = amt;
        else signedDiff = 0;
      }

      await hqFetch("/api/hq/year-end-tax", {
        method: "POST",
        body: {
          action: "ADMIN_UPDATE_RESULT",
          year,
          member_id: selectedMember.instructor_id,
          status: nextStatus,
          admin_supplement_note: adminSupplementNote,
          settlement_tax_diff:
            nextStatus === "COMPLETED"
              ? signedDiff
              : submissions[selectedMember.instructor_id]?.settlement_tax_diff ??
                null,
          receipt_pdf: adminReceiptPdf,
        },
      });
      setSelectedMember(null);
      await loadYearData();
    } catch (err: any) {
      alert(err?.message || "처리 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleExportTaxAccountantSummaryCsv = () => {
    const companyName = companySettings?.company_name || "(주)천종현수학연구소";
    const rows: (string | number)[][] = [
      [`[${companyName}] ${year}년 귀속 연말정산 서류 수합 요약표 (세무사 전달용)`],
      [],
      [
        "사번",
        "성명",
        "부서",
        "직책",
        "입사일",
        "퇴사일",
        "근속구분",
        "주민번호(앞-성별)",
        "서류제출상태",
        "종전근무지소득유무",
        "중기취업감면신청",
        "부양가족변동메모",
        "직원전달메모",
        "당해급여대장_누적세전총액",
        "당해급여대장_기납부세액합계",
        "간소화PDF_파일명",
        "간소화PDF_다운로드링크",
        "추가증빙_건수",
        "확정차감징수세액(음수=환급)",
      ],
    ];

    targetMembers.forEach((m) => {
      const sub = submissions[m.instructor_id];
      const pay = annualPayrollSummary[m.instructor_id];
      const rrn = m.profile_extra?.rrn_front
        ? `${m.profile_extra.rrn_front}-${
            m.profile_extra.rrn_gender_digit || "*"
          }******`
        : "미입력";
      const tenureType = m.resign_date?.startsWith(String(year))
        ? "당해퇴사(중도정산)"
        : m.hire_date?.startsWith(String(year))
        ? "당해중도입사"
        : "계속근로";
      const htUrl = sub?.hometax_pdf?.url
        ? resolveStoragePublicUrl(sub.hometax_pdf.url) || ""
        : "";

      rows.push([
        m.employee_no || "",
        m.name,
        m.department || "",
        m.job_title || "",
        m.hire_date || "",
        m.resign_date || "",
        tenureType,
        rrn,
        STATUS_META[sub?.status || "NOT_SUBMITTED"].label,
        sub?.prev_workplace_check ? "있음(전근무지합산)" : "없음",
        sub?.tax_reduction_check ? "신청/유지" : "-",
        sub?.dependent_change_note || "-",
        sub?.employee_memo || "-",
        pay?.grossSum ?? 0,
        pay?.taxSum ?? 0,
        sub?.hometax_pdf?.file_name || "미첨부",
        htUrl,
        sub?.extra_files?.length ?? 0,
        sub?.settlement_tax_diff ?? "",
      ]);
    });

    const csv = buildCsvContent(rows);
    triggerCsvDownload(
      `${companyName.replace(/[\\/:*?"<>|]/g, "")}_${year}귀속_연말정산수합표.csv`,
      csv
    );
  };

  const showEmployeePanel = !isHrManager || viewMode === "MINE";

  return (
    <div className="w-full px-6 py-6 space-y-5">
      {/* 상단 귀속연도 & 뷰 전환 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        {isHrManager ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setViewMode("ADMIN")}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all ${
                viewMode === "ADMIN"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              📋 전 직원 서류 수합 · 원천징수영수증 배부
            </button>
            <button
              type="button"
              onClick={() => setViewMode("MINE")}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all ${
                viewMode === "MINE"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              🙋 내 연말정산 서류 제출 ({me?.name})
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-brand text-xs font-extrabold">
              {year}년 귀속 연말정산
            </span>
            <span className="text-xs text-slate-500 font-semibold">
              간소화 PDF 제출 및 근로소득 원천징수영수증 셀프 발급
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {yearOptions.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-colors ${
                year === y
                  ? "bg-brand text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {y}년 귀속
            </button>
          ))}
        </div>
      </div>

      {/* 제출 마감일 · 안내 배너 */}
      <div className="rounded-2xl bg-slate-900 text-white p-5 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[11px] font-extrabold">
                서류 제출 마감: {deadlineDate || "-"}
              </span>
              <span className="text-xs text-slate-300 font-semibold">
                복잡한 세액 계산은 세무사 사무소에서 처리하며, 이곳에서는 서류 제출과 원천징수영수증 수령만 진행합니다.
              </span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">{noticeMemo}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href="https://www.hometax.go.kr"
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold"
            >
              국세청 홈택스 바로가기 ↗
            </a>
            {isHrManager && (
              <button
                type="button"
                onClick={() => setEditingConfig((v) => !v)}
                className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold"
              >
                {editingConfig ? "닫기" : "⚙️ 마감일 · 공지 수정"}
              </button>
            )}
          </div>
        </div>

        {isHrManager && editingConfig && (
          <div className="pt-3 border-t border-slate-700 grid grid-cols-1 md:grid-cols-12 gap-3 text-xs items-end">
            <div className="md:col-span-3">
              <label className="block text-slate-300 font-bold mb-1">
                서류 제출 마감일
              </label>
              <input
                type="date"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white font-bold"
              />
            </div>
            <div className="md:col-span-7">
              <label className="block text-slate-300 font-bold mb-1">
                구성원 안내 문구
              </label>
              <input
                value={noticeMemo}
                onChange={(e) => setNoticeMemo(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveConfig}
                className="w-full py-2 rounded-xl bg-brand hover:bg-brand-hover text-white font-extrabold"
              >
                저장
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* 임직원 본인 서류 제출 & 원천징수영수증 열람 뷰 */}
      {/* ================================================================= */}
      {showEmployeePanel ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
          {/* 좌측: 간소화 PDF & 추가 증빙 업로드 */}
          <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  1️⃣ {year}년 귀속 연말정산 간소화 PDF · 추가서류 제출
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  카톡이나 이메일 대신 아래에 파일을 올려주시면 세무사 사무소로 일괄 전달됩니다.
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full border text-[11px] font-extrabold ${
                  STATUS_META[mySub?.status || "NOT_SUBMITTED"].badgeClass
                }`}
              >
                {STATUS_META[mySub?.status || "NOT_SUBMITTED"].label}
              </span>
            </div>

            {mySub?.status === "SUPPLEMENT_REQ" &&
              mySub.admin_supplement_note && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                  🚨 <strong>관리팀 보완 요청:</strong>{" "}
                  {mySub.admin_supplement_note}
                </div>
              )}

            {isMidYearHireMe && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-semibold">
                💡 <strong>{year}년 중도 입사자 안내:</strong> {year}년 중 이전 직장 근로소득이 있었다면 반드시{" "}
                <strong>[전 근무지 근로소득 원천징수영수증]</strong>을 아래 추가 증빙에 함께 업로드해 주세요.
              </div>
            )}

            {/* 홈택스 간소화 PDF */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-extrabold text-slate-900 text-sm">
                    📄 국세청 홈택스 연말정산 간소화 PDF (필수)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    홈택스 내려받기 시 <strong>&apos;문서 암호 설정&apos;을 체크하지 않고</strong> 한 개의 PDF로 받아주세요.
                  </div>
                </div>
                <label className="px-3.5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white font-extrabold cursor-pointer shrink-0">
                  <span>
                    {uploadingMyFile
                      ? "업로드 중..."
                      : myHometaxPdf
                      ? "PDF 교체하기"
                      : "+ 간소화 PDF 업로드"}
                  </span>
                  <input
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      handleUploadMyHometax(e.target.files?.[0] || null);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              {myHometaxPdf && (
                <div className="px-3 py-2 rounded-lg bg-white border border-emerald-200 flex items-center justify-between">
                  <span className="font-bold text-emerald-800">
                    ✓ {myHometaxPdf.file_name} ({myHometaxPdf.uploaded_at})
                  </span>
                  <div className="flex items-center gap-2">
                    {resolveStoragePublicUrl(myHometaxPdf.url) && (
                      <a
                        href={resolveStoragePublicUrl(myHometaxPdf.url)!}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand font-bold hover:underline"
                      >
                        열람 ↗
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setMyHometaxPdf(null)}
                      className="text-slate-400 hover:text-rose-600 font-bold"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 추가 증빙 파일 */}
            <div className="space-y-2.5">
              <div className="font-extrabold text-slate-800">
                📎 홈택스에 조회되지 않는 추가 증빙 첨부 (해당자만)
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={extraCategory}
                  onChange={(e) => setExtraCategory(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                >
                  {EXTRA_DOC_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <label className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold cursor-pointer">
                  <span>+ 증빙 파일 추가</span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.zip"
                    className="hidden"
                    onChange={(e) => {
                      handleUploadMyExtra(e.target.files?.[0] || null);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              {myExtraFiles.length > 0 && (
                <div className="space-y-1.5">
                  {myExtraFiles.map((f) => {
                    const pubUrl = resolveStoragePublicUrl(f.url);
                    return (
                      <div
                        key={f.id}
                        className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between"
                      >
                        <div>
                          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold mr-2">
                            {f.category || "증빙"}
                          </span>
                          <span className="font-bold text-slate-800">
                            {f.file_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {pubUrl && (
                            <a
                              href={pubUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand font-bold hover:underline"
                            >
                              열람 ↗
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setMyExtraFiles((prev) =>
                                prev.filter((x) => x.id !== f.id)
                              )
                            }
                            className="text-slate-400 hover:text-rose-600 font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 간단 공제 확인 사항 */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  부양가족(인적공제) 변동 사항
                </label>
                <input
                  value={myDepNote}
                  onChange={(e) => setMyDepNote(e.target.value)}
                  placeholder="예: 전년과 동일 (변동 없음) / 배우자·자녀 1명 기본공제 추가"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <div className="flex flex-wrap gap-5">
                <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={myPrevWork}
                    onChange={(e) => setMyPrevWork(e.target.checked)}
                    className="w-4 h-4 accent-brand rounded"
                  />
                  <span>{year}년 중 이전 직장(종전근무지) 근로소득이 있습니다</span>
                </label>

                <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={myTaxReduction}
                    onChange={(e) => setMyTaxReduction(e.target.checked)}
                    className="w-4 h-4 accent-brand rounded"
                  />
                  <span>중소기업 취업자 소득세 감면(청년 90% 등) 대상입니다</span>
                </label>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  기타 세무사 전달 메모 (선택)
                </label>
                <input
                  value={myMemo}
                  onChange={(e) => setMyMemo(e.target.value)}
                  placeholder="예: 월세 세액공제 신청(총급여 요건 해당), 산후조리원 영수증 첨부 등"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                disabled={saving || uploadingMyFile}
                onClick={handleSubmitMyDocs}
                className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold shadow-sm disabled:opacity-50"
              >
                ✅ {year}년 귀속 연말정산 서류 제출 완료
              </button>
            </div>
          </div>

          {/* 우측: 확정 결과 & 근로소득 원천징수영수증 셀프 발급함 */}
          <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-6 shadow-xs flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div className="border-b border-slate-200 pb-3">
                <h3 className="text-base font-extrabold text-slate-900">
                  2️⃣ 확정 결과 · 근로소득 원천징수영수증 보관함
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  세무사 정산 완료 후 환급/추징 금액 확인 및 은행 제출용 원천징수영수증 PDF를 연중 상시 발급할 수 있습니다.
                </p>
              </div>

              {mySub?.status === "COMPLETED" ? (
                <div className="space-y-4">
                  <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-2">
                    <div className="text-xs text-slate-400 font-bold">
                      {year}년 귀속 연말정산 차감징수세액 (소득세 + 지방소득세 합산)
                    </div>
                    {mySub.settlement_tax_diff !== null &&
                    mySub.settlement_tax_diff < 0 ? (
                      <div className="text-2xl font-black text-emerald-300">
                        🎉 {Math.abs(mySub.settlement_tax_diff).toLocaleString("ko-KR")}원 환급
                      </div>
                    ) : mySub.settlement_tax_diff !== null &&
                      mySub.settlement_tax_diff > 0 ? (
                      <div className="text-2xl font-black text-amber-300">
                        {mySub.settlement_tax_diff.toLocaleString("ko-KR")}원 추가납부(추징)
                      </div>
                    ) : (
                      <div className="text-2xl font-black text-white">
                        차감징수세액 0원 (정산 완료)
                      </div>
                    )}
                    <div className="text-[11px] text-slate-400">
                      * 2월분 급여 지급 시 급여대장에 합산 환급 또는 공제 반영됩니다.
                    </div>
                  </div>

                  {mySub.receipt_pdf &&
                  resolveStoragePublicUrl(mySub.receipt_pdf.url) ? (
                    <a
                      href={resolveStoragePublicUrl(mySub.receipt_pdf.url)!}
                      target="_blank"
                      rel="noreferrer"
                      className="block w-full py-3.5 px-4 rounded-xl bg-brand hover:bg-brand-hover text-white text-center font-extrabold shadow-sm"
                    >
                      📥 {year}년 근로소득 원천징수영수증 PDF 다운로드 ↗
                    </a>
                  ) : (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-center">
                      원천징수영수증 PDF 파일이 아직 첨부되지 않았습니다.
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 px-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center space-y-2">
                  <div className="text-3xl">🧾</div>
                  <div className="font-extrabold text-slate-700 text-sm">
                    세무사 연말정산 확정 전입니다
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    2월 중 연말정산이 최종 확정되면 이곳에서 환급/추징 세액을 확인하고
                    <br />
                    대출·관공서 제출용 <strong>근로소득 원천징수영수증 PDF</strong>를 바로 내려받을 수 있습니다.
                  </p>
                </div>
              )}
            </div>

            <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-100 text-[11px] text-slate-600 leading-relaxed">
              💡 전세자금대출·신용대출 연장 등으로 <strong>이전 연도 근로소득 원천징수영수증</strong>이 필요한 경우 상단 우측에서 귀속연도(`{year - 1}년 귀속` 등)를 바꿔 내려받으실 수 있습니다.
            </div>
          </div>
        </div>
      ) : (
        /* ================================================================= */
        /* 관리자 뷰: 전 직원 수합 체크판 & 원천징수영수증 배부 */
        /* ================================================================= */
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
              <div className="text-xs font-bold text-slate-500">
                {year}년 귀속 대상 인원
              </div>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {kpi.total}명
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                재직 · 휴직 및 당해 퇴사자 포함
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
              <div className="text-xs font-bold text-slate-500">
                서류 수합 완료
              </div>
              <div className="text-2xl font-black text-brand mt-1">
                {kpi.submitted}명
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                수합률{" "}
                {kpi.total > 0
                  ? Math.round((kpi.submitted / kpi.total) * 100)
                  : 0}
                %
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
              <div className="text-xs font-bold text-slate-500">
                미제출 · 보완 대기
              </div>
              <div className="text-2xl font-black text-rose-600 mt-1">
                {kpi.pending}명
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                마감일({deadlineDate}) 전 제출 독려 대상
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
              <div className="text-xs font-bold text-slate-500">
                정산 확정 · 영수증 배부 완료
              </div>
              <div className="text-2xl font-black text-emerald-700 mt-1">
                {kpi.completed}명
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                근로소득 원천징수영수증 상시 열람 가능
              </div>
            </div>
          </div>

          <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    ["ALL", "전체 대상자"],
                    ["PENDING", "미제출 · 보완대기"],
                    ["SUBMITTED", "제출 완료"],
                    ["COMPLETED", "정산·영수증 배부됨"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setStatusFilter(k)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                      statusFilter === k
                        ? "bg-brand text-white"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="이름 · 부서 검색"
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs w-44 focus:outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={handleExportTaxAccountantSummaryCsv}
                  className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold"
                >
                  📥 세무사 전달용 수합 요약표(CSV) 다운로드
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500">
                    <th className="py-3 px-4">구성원 · 소속</th>
                    <th className="py-3 px-4">근속 구분 · 주민번호</th>
                    <th className="py-3 px-4 text-right">급여대장 누적 참고</th>
                    <th className="py-3 px-4">제출 상태</th>
                    <th className="py-3 px-4">제출 서류 열람</th>
                    <th className="py-3 px-4">공제·특이사항 메모</th>
                    <th className="py-3 px-4 text-right">확정 세액 · 영수증</th>
                    <th className="py-3 px-4 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        연말정산 현황을 불러오는 중입니다...
                      </td>
                    </tr>
                  ) : filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        조건에 해당하는 구성원이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map((m) => {
                      const sub = submissions[m.instructor_id];
                      const st = sub?.status || "NOT_SUBMITTED";
                      const stMeta = STATUS_META[st];
                      const pay = annualPayrollSummary[m.instructor_id];
                      const isMidHire = m.hire_date?.startsWith(String(year));
                      const isMidResign = m.resign_date?.startsWith(String(year));
                      const hasRrn = Boolean(m.profile_extra?.rrn_front);
                      const htUrl = sub?.hometax_pdf?.url
                        ? resolveStoragePublicUrl(sub.hometax_pdf.url)
                        : null;
                      const rcpUrl = sub?.receipt_pdf?.url
                        ? resolveStoragePublicUrl(sub.receipt_pdf.url)
                        : null;

                      return (
                        <tr key={m.instructor_id} className="hover:bg-slate-50">
                          <td className="py-3 px-4">
                            <div className="font-extrabold text-slate-900">
                              {m.name}{" "}
                              <span className="text-slate-400 font-semibold">
                                ({m.department} · {m.job_title})
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              입사 {m.hire_date || "-"}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              {isMidResign ? (
                                <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-extrabold">
                                  당해퇴사
                                </span>
                              ) : isMidHire ? (
                                <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-extrabold">
                                  중도입사 (전근무지 확인)
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                                  계속근로
                                </span>
                              )}
                              {!hasRrn && (
                                <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[10px] font-bold">
                                  주민번호 미입력
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4 text-right tabular-nums">
                            {pay ? (
                              <div>
                                <div className="font-bold text-slate-800">
                                  {pay.grossSum.toLocaleString()}원
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  기납부 {pay.taxSum.toLocaleString()}원 (
                                  {pay.monthsCount}개월)
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full border text-[10px] font-extrabold ${stMeta.badgeClass}`}
                            >
                              {stMeta.label}
                            </span>
                          </td>

                          <td className="py-3 px-4 space-x-1.5">
                            {htUrl ? (
                              <a
                                href={htUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-block px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px]"
                              >
                                📄 간소화 PDF ↗
                              </a>
                            ) : (
                              <span className="text-slate-300">미첨부</span>
                            )}
                            {(sub?.extra_files?.length ?? 0) > 0 && (
                              <span className="inline-block px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold text-[11px]">
                                +추가 {sub!.extra_files.length}건
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 max-w-[220px] truncate text-slate-600">
                            {[
                              sub?.prev_workplace_check ? "[종전근무지유]" : "",
                              sub?.tax_reduction_check ? "[중기감면]" : "",
                              sub?.dependent_change_note || "",
                              sub?.employee_memo || "",
                            ]
                              .filter(Boolean)
                              .join(" ") || "-"}
                          </td>

                          <td className="py-3 px-4 text-right">
                            {sub?.settlement_tax_diff !== null &&
                            sub?.settlement_tax_diff !== undefined ? (
                              <div
                                className={`font-extrabold tabular-nums ${
                                  sub.settlement_tax_diff < 0
                                    ? "text-emerald-700"
                                    : sub.settlement_tax_diff > 0
                                    ? "text-amber-700"
                                    : "text-slate-700"
                                }`}
                              >
                                {sub.settlement_tax_diff < 0
                                  ? `환급 ${Math.abs(
                                      sub.settlement_tax_diff
                                    ).toLocaleString()}원`
                                  : sub.settlement_tax_diff > 0
                                  ? `추징 ${sub.settlement_tax_diff.toLocaleString()}원`
                                  : "0원"}
                              </div>
                            ) : (
                              <div className="text-slate-300">-</div>
                            )}
                            {rcpUrl && (
                              <a
                                href={rcpUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] font-bold text-brand hover:underline"
                              >
                                원천징수영수증 ↗
                              </a>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => openAdminModal(m)}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold"
                            >
                              서류확인 · 결과등록
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* 관리자용: 구성원 서류 확인 · 보완요청 · 원천징수영수증 배부 모달 */}
      {selectedMember && (
        <div
          onClick={() => setSelectedMember(null)}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto custom-scroll p-6 shadow-2xl border border-slate-200 space-y-5 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  {selectedMember.name} ({selectedMember.department}) · {year}년 연말정산 관리
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  제출된 서류를 확인해 세무사에게 전달하고, 완료 후 원천징수영수증을 배부합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMember(null)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* 직원 제출 파일 & 메모 확인 */}
            {(() => {
              const sub = submissions[selectedMember.instructor_id];
              const htUrl = sub?.hometax_pdf?.url
                ? resolveStoragePublicUrl(sub.hometax_pdf.url)
                : null;
              return (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                  <div className="font-extrabold text-slate-800">
                    📂 구성원 제출 서류 및 메모
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {htUrl ? (
                      <a
                        href={htUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold"
                      >
                        📄 간소화 PDF 열기 ({sub?.hometax_pdf?.file_name}) ↗
                      </a>
                    ) : (
                      <span className="text-slate-400">간소화 PDF 미제출</span>
                    )}

                    {(sub?.extra_files || []).map((ef) => {
                      const u = resolveStoragePublicUrl(ef.url);
                      return u ? (
                        <a
                          key={ef.id}
                          href={u}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold"
                        >
                          📎 [{ef.category || "추가"}] {ef.file_name} ↗
                        </a>
                      ) : null;
                    })}
                  </div>
                  <div className="text-slate-600 space-y-1 pt-1">
                    <div>
                      • 부양가족 변동: <strong>{sub?.dependent_change_note || "미기재"}</strong>
                    </div>
                    <div>
                      • 종전근무지 소득:{" "}
                      <strong>{sub?.prev_workplace_check ? "있음" : "없음"}</strong> · 중기취업 감면:{" "}
                      <strong>{sub?.tax_reduction_check ? "신청" : "해당없음"}</strong>
                    </div>
                    {sub?.employee_memo && (
                      <div>• 직원 메모: {sub.employee_memo}</div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 서류 보완 요청 */}
            <div className="space-y-2">
              <label className="block font-extrabold text-slate-800">
                ⚠️ 서류 누락 시 보완 요청 보내기
              </label>
              <div className="flex gap-2">
                <input
                  value={adminSupplementNote}
                  onChange={(e) => setAdminSupplementNote(e.target.value)}
                  placeholder="예: 간소화 PDF에 비밀번호가 걸려 있습니다 / 전근무지 영수증 첨부 요망"
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-300"
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSaveAdminAction("SUPPLEMENT_REQ")}
                  className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold shrink-0"
                >
                  보완 요청
                </button>
              </div>
            </div>

            {/* 세무사 정산 확정 결과 및 원천징수영수증 업로드 */}
            <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200 space-y-3">
              <div className="font-extrabold text-emerald-950 text-sm">
                ✅ 세무사 확정 결과 · 근로소득 원천징수영수증 배부
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["REFUND", "🎉 환급 (−)"],
                    ["COLLECT", "추가납부 (+)"],
                    ["ZERO", "차액 0원"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setAdminDiffKind(k)}
                    className={`py-2 rounded-xl border font-bold ${
                      adminDiffKind === k
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {adminDiffKind !== "ZERO" && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {adminDiffKind === "REFUND"
                      ? "총 환급 세액 (소득세 + 지방소득세 합계, 원)"
                      : "총 추가납부 세액 (소득세 + 지방소득세 합계, 원)"}
                  </label>
                  <input
                    type="number"
                    value={adminDiffAmount}
                    onChange={(e) => setAdminDiffAmount(e.target.value)}
                    placeholder="예: 245000"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-extrabold"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div>
                  <div className="font-bold text-slate-800">
                    근로소득 원천징수영수증 PDF 첨부
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {adminReceiptPdf
                      ? `✓ ${adminReceiptPdf.file_name}`
                      : "세무사에게 전달받은 개인별 영수증 PDF 업로드"}
                  </div>
                </div>
                <label className="px-3 py-1.5 rounded-xl border border-emerald-400 bg-white hover:bg-emerald-50 text-emerald-800 font-bold cursor-pointer">
                  <span>
                    {uploadingReceipt
                      ? "업로드 중..."
                      : adminReceiptPdf
                      ? "영수증 교체"
                      : "+ PDF 업로드"}
                  </span>
                  <input
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      handleUploadAdminReceipt(e.target.files?.[0] || null);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedMember(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
              >
                닫기
              </button>
              <button
                type="button"
                disabled={saving || uploadingReceipt}
                onClick={() => handleSaveAdminAction("COMPLETED")}
                className="px-5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white font-extrabold shadow-sm"
              >
                정산 확정 및 영수증 배부
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
