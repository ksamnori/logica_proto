// src/app/(dashboard)/print-center/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { formatPhone } from "@/lib/normalize";

interface TenantInfo {
  tenant_id?: string;
  name: string;
  ceo_name?: string;
  business_number?: string;
  address?: string;
  phone?: string;
}

interface StudentLedgerRow {
  studentId: string;
  name: string;
  schoolGrade: string;
  classNames: string;
  primaryClass: string;
  startDate: string;
  parentPhone: string;
  note: string;
}

interface InstructorRosterRow {
  instructorId: string;
  name: string;
  position: string;
  department: string;
  hireDate: string;
  phone: string;
  contractType: string;
  rank: number;
  rawCreatedAt: string;
}

const unwrap = (obj: any): any => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

const ENDED_ENROLLMENT_STATUSES = ["수강종료", "종료", "퇴원", "취소"];
const isEndedEnrollment = (e: any): boolean => {
  if (!e) return true;
  if (ENDED_ENROLLMENT_STATUSES.includes(String(e.status || "").trim())) return true;
  if (e.end_date) return true;
  return false;
};

const EXCLUDED_INSTRUCTOR_STATUS_KEYWORDS = ["퇴사", "퇴직", "휴직", "해임", "종료"];
const isActiveInstructor = (inst: any): boolean => {
  if (!inst || inst.deleted_at) return false;
  const role = String(inst.role || "").trim().toUpperCase();
  if (role === "GUEST") return false;
  const name = String(inst.name || "").trim();
  if (!name || name.includes("테스트")) return false;
  const st = String(inst.status || "재직").trim();
  if (EXCLUDED_INSTRUCTOR_STATUS_KEYWORDS.some((kw) => st.includes(kw))) return false;
  return st === "재직" || st === "";
};

const getInstructorRank = (posRaw?: string | null, roleRaw?: string | null): number => {
  const pos = String(posRaw || "").trim();
  const role = String(roleRaw || "").trim().toUpperCase();
  if (pos.includes("대표") || (pos.includes("원장") && !pos.includes("부원장")) || role === "PRINCIPAL") return 1;
  if (pos.includes("부원장") || role === "VICE_ADMIN") return 2;
  if (pos.includes("실장") || role === "MANAGER" || role === "ADMIN") return 3;
  if (pos.includes("팀장") || pos.includes("부장")) return 4;
  if (pos.includes("전임")) return 5;
  if (pos.includes("강사") || role === "TEACHER") return 6;
  if (pos.includes("조교") || role === "TA") return 7;
  return 8;
};

const resolvePositionText = (inst: any): string => {
  const pos = String(inst?.position || "").trim();
  if (pos) return pos;
  const r = String(inst?.role || "").trim().toUpperCase();
  if (r === "SUPER_ADMIN") return "최고관리자";
  if (r === "PRINCIPAL") return "원장";
  if (r === "VICE_ADMIN") return "부원장";
  if (r === "ADMIN" || r === "MANAGER") return "실장";
  if (r === "TA") return "조교";
  return "강사";
};

const formatDateDot = (raw?: string | null): string => {
  if (!raw) return "-";
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    const clean = String(raw).slice(0, 10).replace(/-/g, ".");
    return clean || "-";
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
};

function paginateRows<T>(items: T[], firstPageCap: number, nextPageCap: number): T[][] {
  if (items.length === 0) return [[]];
  if (items.length <= firstPageCap) return [items];
  const pages: T[][] = [items.slice(0, firstPageCap)];
  let cursor = firstPageCap;
  while (cursor < items.length) {
    pages.push(items.slice(cursor, cursor + nextPageCap));
    cursor += nextPageCap;
  }
  return pages;
}

const FIRST_PAGE_ROWS_WITH_APPROVAL = 22;
const FIRST_PAGE_ROWS_NO_APPROVAL = 24;
const CONTINUATION_PAGE_ROWS = 26;

export default function PrintCenterPage() {
  const [activeDoc, setActiveDoc] = useState<"student" | "instructor" | "ledger" | "receipt">("student");
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);

  const [rawStudents, setRawStudents] = useState<any[]>([]);
  const [rawInstructors, setRawInstructors] = useState<any[]>([]);
  const [rawPayments, setRawPayments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 출력 옵션 상태 (인쇄 시 숨김)
  const [showApprovalBox, setShowApprovalBox] = useState(true);
  const [fillBlankRows, setFillBlankRows] = useState(false);
  const [studentSort, setStudentSort] = useState<"name" | "class" | "date">("name");
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>("all");
  const [onlyClassAssigned, setOnlyClassAssigned] = useState<boolean>(false);
  const [selectedLedgerMonth, setSelectedLedgerMonth] = useState<string>("all");
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>("blank");
  const [receiptSearch, setReceiptSearch] = useState<string>("");

  const todayStr = useMemo<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}. ${String(now.getMonth() + 1).padStart(2, "0")}. ${String(now.getDate()).padStart(2, "0")}.`;
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const tId = localStorage.getItem("logica_tenant_id");
      const validTenantFilter = tId && tId !== "hq" ? tId : null;

      if (validTenantFilter) {
        const { data: tenant } = await supabase
          .from("academy_tenant")
          .select("*")
          .eq("tenant_id", validTenantFilter)
          .maybeSingle();
        if (tenant) setTenantInfo(tenant as TenantInfo);
      } else {
        const { data: firstTenant } = await supabase
          .from("academy_tenant")
          .select("*")
          .eq("status", "ACTIVE")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (firstTenant) setTenantInfo(firstTenant as TenantInfo);
      }

      // 1) 수강생 대장용 조회: 정식 등록('재원') 상태 + 미삭제 + '테스트' 이름 제외 + 학부모 연락처 조인
      let stuQuery = supabase
        .from("student")
        .select(
          "student_id, name, grade, school, phone, status, created_at, deleted_at, parent(name, relationship, phone, phone_2, phone_3), enrollment(enrollment_id, start_date, end_date, status, class(class_id, name, status, deleted_at, tuition_fee))"
        )
        .eq("status", "재원")
        .is("deleted_at", null)
        .not("name", "ilike", "%테스트%")
        .order("name", { ascending: true });

      if (validTenantFilter) stuQuery = stuQuery.eq("tenant_id", validTenantFilter);
      const { data: stuData } = await stuQuery;
      setRawStudents(stuData || []);

      // 2) 강사(직원) 명부용 조회: 미삭제 인원 조회 후 클라이언트에서도 퇴사·휴직·테스트 철저히 제외
      let instQuery = supabase
        .from("instructor")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (validTenantFilter) instQuery = instQuery.eq("tenant_id", validTenantFilter);
      const { data: instData } = await instQuery;
      setRawInstructors(instData || []);

      // 3) 수납 내역 조회 (현금 출납부 / 교육비 영수증)
      let payQuery = supabase
        .from("payment_history")
        .select(
          "*, academy_billing(billing_month, amount, student(student_id, name, status), class(class_id, name))"
        )
        .order("paid_at", { ascending: false })
        .limit(300);

      if (validTenantFilter) payQuery = payQuery.eq("tenant_id", validTenantFilter);
      const { data: payData } = await payQuery;
      const cleanedPayments = (payData || []).filter((p: any) => {
        const bill = unwrap(p.academy_billing);
        const sName = String(unwrap(bill?.student)?.name || "").trim();
        const cName = String(unwrap(bill?.class)?.name || "").trim();
        if (sName.includes("테스트") || cName.includes("테스트")) return false;
        return true;
      });
      setRawPayments(cleanedPayments);
      if (cleanedPayments.length > 0) {
        setSelectedReceiptId(String(cleanedPayments[0].payment_id));
      }
    } catch (error) {
      console.error("서류 출력 데이터 로드 실패:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // 수강생 대장 정제:
  // - 등록 상태('재원') & 미삭제 학생만 포함
  // - 이름에 '테스트'가 포함된 학생 제외
  // - 반 이름에 '테스트'가 포함된 수강 이력 제외 (만약 '테스트' 반에만 등록되어 있던 계정이면 학생 행 자체도 제외)
  // - 연락처는 학부모 연락처(parent.phone -> phone_2 -> phone_3) 표시
  const processedStudents = useMemo<StudentLedgerRow[]>(() => {
    const list: StudentLedgerRow[] = [];

    rawStudents.forEach((s: any) => {
      const name = String(s.name || "").trim();
      if (!name || name.includes("테스트")) return;
      if (String(s.status || "").trim() !== "재원" || s.deleted_at) return;

      const enrollArr: any[] = Array.isArray(s.enrollment)
        ? s.enrollment
        : s.enrollment
        ? [s.enrollment]
        : [];

      const activeEnrolls: any[] = enrollArr.filter((e: any) => {
        if (isEndedEnrollment(e)) return false;
        const cls = unwrap(e.class);
        if (!cls || cls.deleted_at) return false;
        const cStatus = String(cls.status || "").trim();
        if (cStatus === "종료" || cStatus === "폐강") return false;
        return true;
      });

      const nonTestEnrolls: any[] = activeEnrolls.filter((e: any) => {
        const cName = String(unwrap(e.class)?.name || "").trim();
        return cName.length > 0 && !cName.includes("테스트");
      });

      // 활성 수강 이력이 있었으나 전부 '테스트' 반뿐이었던 경우 노출 제외
      if (activeEnrolls.length > 0 && nonTestEnrolls.length === 0) return;
      if (onlyClassAssigned && nonTestEnrolls.length === 0) return;

      const classNameList: string[] = [];
      const seenClassNames = new Set<string>();
      nonTestEnrolls.forEach((e: any) => {
        const cn = String(unwrap(e.class)?.name || "").trim();
        if (cn && !seenClassNames.has(cn)) {
          seenClassNames.add(cn);
          classNameList.push(cn);
        }
      });

      if (selectedClassFilter !== "all" && !classNameList.includes(selectedClassFilter)) {
        return;
      }

      const startDates: string[] = [];
      nonTestEnrolls.forEach((e: any) => {
        const sd = String(e.start_date || "").trim();
        if (sd) startDates.push(sd);
      });
      startDates.sort();
      const earliestStart: string | undefined = startDates[0];

      const parentObj = unwrap(s.parent);
      const rawParentPhone =
        parentObj?.phone || parentObj?.phone_2 || parentObj?.phone_3 || "";
      const formattedParentPhone = rawParentPhone
        ? formatPhone(String(rawParentPhone))
        : "-";

      const schoolStr = String(s.school || "").trim();
      const gradeStr = String(s.grade || "").trim();
      const schoolGrade =
        schoolStr && gradeStr
          ? `${schoolStr} (${gradeStr})`
          : schoolStr || gradeStr || "-";

      const firstClassName: string = classNameList.length > 0 ? classNameList[0] : "ㅎ_미배정";

      list.push({
        studentId: String(s.student_id),
        name,
        schoolGrade,
        classNames: classNameList.length > 0 ? classNameList.join(", ") : "반 배정 대기",
        primaryClass: firstClassName,
        startDate: earliestStart ? formatDateDot(earliestStart) : formatDateDot(String(s.created_at || "")),
        parentPhone: formattedParentPhone || "-",
        note: "",
      });
    });

    list.sort((a: StudentLedgerRow, b: StudentLedgerRow) => {
      if (studentSort === "class") {
        const cmp = a.primaryClass.localeCompare(b.primaryClass, "ko");
        if (cmp !== 0) return cmp;
        return a.name.localeCompare(b.name, "ko");
      }
      if (studentSort === "date") {
        const cmp = a.startDate.localeCompare(b.startDate);
        if (cmp !== 0) return cmp;
        return a.name.localeCompare(b.name, "ko");
      }
      return a.name.localeCompare(b.name, "ko");
    });

    return list;
  }, [rawStudents, onlyClassAssigned, selectedClassFilter, studentSort]);

  const availableClassOptions = useMemo<string[]>(() => {
    const options: string[] = [];
    const seen = new Set<string>();
    rawStudents.forEach((s: any) => {
      const name = String(s.name || "").trim();
      if (!name || name.includes("테스트") || String(s.status || "").trim() !== "재원" || s.deleted_at) return;
      const enrollArr: any[] = Array.isArray(s.enrollment) ? s.enrollment : s.enrollment ? [s.enrollment] : [];
      enrollArr.forEach((e: any) => {
        if (isEndedEnrollment(e)) return;
        const cls = unwrap(e.class);
        if (!cls || cls.deleted_at || cls.status === "종료" || cls.status === "폐강") return;
        const cName = String(cls.name || "").trim();
        if (cName && !cName.includes("테스트") && !seen.has(cName)) {
          seen.add(cName);
          options.push(cName);
        }
      });
    });
    return options.sort((a: string, b: string) => a.localeCompare(b, "ko"));
  }, [rawStudents]);

  // 강사(직원) 명부 정제: 퇴사·휴직·해임·삭제·게스트·테스트 계정 모두 제외
  const processedInstructors = useMemo<InstructorRosterRow[]>(() => {
    return rawInstructors
      .filter(isActiveInstructor)
      .map((inst: any): InstructorRosterRow => {
        const pos = resolvePositionText(inst);
        const dept =
          String(inst.department || "").trim() ||
          (pos.includes("조교") ? "클리닉 지도" : pos.includes("실장") ? "행정·상담" : "수학과");
        const phoneStr = inst.phone ? formatPhone(String(inst.phone)) : "-";
        return {
          instructorId: String(inst.instructor_id),
          name: String(inst.name || "").trim(),
          position: pos,
          department: dept,
          hireDate: formatDateDot(inst.created_at),
          phone: phoneStr || "-",
          contractType: String(inst.contract_type || "").trim(),
          rank: getInstructorRank(inst.position, inst.role),
          rawCreatedAt: String(inst.created_at || ""),
        };
      })
      .sort((a: InstructorRosterRow, b: InstructorRosterRow) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (a.rawCreatedAt !== b.rawCreatedAt) return a.rawCreatedAt.localeCompare(b.rawCreatedAt);
        return a.name.localeCompare(b.name, "ko");
      });
  }, [rawInstructors]);

  // 수납 원장 월 목록 및 필터링
  const availableLedgerMonths = useMemo<string[]>(() => {
    const monthsList: string[] = [];
    const seenMonths = new Set<string>();
    rawPayments.forEach((p: any) => {
      const bm = String(unwrap(p.academy_billing)?.billing_month || "").trim();
      const target = bm || (p.paid_at ? String(p.paid_at).slice(0, 7) : "");
      if (target && !seenMonths.has(target)) {
        seenMonths.add(target);
        monthsList.push(target);
      }
    });
    return monthsList.sort().reverse();
  }, [rawPayments]);

  const filteredPayments = useMemo<any[]>(() => {
    if (selectedLedgerMonth === "all") return rawPayments;
    return rawPayments.filter((p: any) => {
      const bm = String(unwrap(p.academy_billing)?.billing_month || "").trim();
      const paidMonth = p.paid_at ? String(p.paid_at).slice(0, 7) : "";
      return bm === selectedLedgerMonth || paidMonth === selectedLedgerMonth;
    });
  }, [rawPayments, selectedLedgerMonth]);

  const totalLedgerIncome = useMemo<number>(
    () => filteredPayments.reduce((acc: number, p: any) => acc + (Number(p.paid_amount) || 0), 0),
    [filteredPayments]
  );

  // 영수증 대상 선택
  const filteredReceiptCandidates = useMemo<any[]>(() => {
    const q = receiptSearch.trim();
    if (!q) return rawPayments.slice(0, 80);
    return rawPayments
      .filter((p: any) => {
        const bill = unwrap(p.academy_billing);
        const sName = String(unwrap(bill?.student)?.name || "");
        const cName = String(unwrap(bill?.class)?.name || "");
        const bm = String(bill?.billing_month || "");
        return sName.includes(q) || cName.includes(q) || bm.includes(q);
      })
      .slice(0, 80);
  }, [rawPayments, receiptSearch]);

  const activeReceiptPayment = useMemo<any | null>(() => {
    if (selectedReceiptId === "blank") return null;
    return rawPayments.find((p: any) => String(p.payment_id) === selectedReceiptId) || null;
  }, [rawPayments, selectedReceiptId]);

  const firstPageCap = showApprovalBox
    ? FIRST_PAGE_ROWS_WITH_APPROVAL
    : FIRST_PAGE_ROWS_NO_APPROVAL;

  const studentPages = useMemo<StudentLedgerRow[][]>(
    () => paginateRows<StudentLedgerRow>(processedStudents, firstPageCap, CONTINUATION_PAGE_ROWS),
    [processedStudents, firstPageCap]
  );

  const instructorPages = useMemo<InstructorRosterRow[][]>(
    () => paginateRows<InstructorRosterRow>(processedInstructors, firstPageCap, CONTINUATION_PAGE_ROWS),
    [processedInstructors, firstPageCap]
  );

  const ledgerPages = useMemo<any[][]>(
    () => paginateRows<any>(filteredPayments, firstPageCap - 1, CONTINUATION_PAGE_ROWS - 1),
    [filteredPayments, firstPageCap]
  );

  const academyName = tenantInfo?.name || "LOGICA 학원";
  const ceoName = tenantInfo?.ceo_name || "원장";
  const businessNumber = tenantInfo?.business_number || "-";
  const academyAddress = tenantInfo?.address || "-";
  const academyPhone = tenantInfo?.phone ? formatPhone(tenantInfo.phone) : "-";

  const handlePrint = () => {
    window.print();
  };

  // 페이지 상단 공통 헤더 컴포넌트 (1페이지: 정식 타이틀 + 결재란 + 요약 바 / 2페이지~: 연속 헤더)
  const renderSheetHeader = (opts: {
    docTitle: string;
    docCode: string;
    summaryLeft: string;
    summaryRight?: string;
    pageIdx: number;
    totalPages: number;
  }) => {
    const { docTitle, docCode, summaryLeft, summaryRight, pageIdx } = opts;

    if (pageIdx > 0) {
      return (
        <div className="mb-3 pb-2 border-b-2 border-slate-900 flex items-end justify-between shrink-0">
          <div className="flex items-baseline gap-2.5">
            <span
              className="text-[17px] font-black tracking-[0.2em] text-slate-900 outline-none focus:bg-amber-50"
              contentEditable
              suppressContentEditableWarning
            >
              {docTitle}
            </span>
            <span className="text-[11px] font-semibold text-slate-500">
              (계속 · {academyName})
            </span>
          </div>
          <div className="text-[11px] font-semibold text-slate-600 tabular-nums">
            기준일: {todayStr}
          </div>
        </div>
      );
    }

    return (
      <div className="mb-3.5 shrink-0">
        <div className="flex items-start justify-between gap-4 mb-3">
          {/* 좌측 기관 식별 메타 */}
          <div className="text-[10.5px] text-slate-600 space-y-0.5 pt-1 min-w-[165px]">
            <div className="font-bold text-slate-800">{docCode}</div>
            <div>
              기관명:{" "}
              <span
                className="font-semibold text-slate-900 outline-none focus:bg-amber-50"
                contentEditable
                suppressContentEditableWarning
              >
                {academyName}
              </span>
            </div>
            <div>
              기준일:{" "}
              <span
                className="tabular-nums outline-none focus:bg-amber-50"
                contentEditable
                suppressContentEditableWarning
              >
                {todayStr}
              </span>
            </div>
          </div>

          {/* 중앙 정식 문서 타이틀 */}
          <div className="flex-1 text-center pt-1">
            <h1
              className="text-[25px] font-black tracking-[0.38em] pl-[0.38em] text-slate-900 inline-block border-b-[3px] border-double border-slate-900 pb-1.5 outline-none focus:bg-amber-50"
              contentEditable
              suppressContentEditableWarning
            >
              {docTitle}
            </h1>
          </div>

          {/* 우측 결재란 */}
          {showApprovalBox ? (
            <table className="border-collapse border border-slate-800 text-[10px] text-center shrink-0 w-[168px]">
              <tbody>
                <tr>
                  <th
                    rowSpan={2}
                    className="border border-slate-800 bg-slate-100 w-[24px] font-bold text-slate-800 leading-tight py-1"
                  >
                    결<br />재
                  </th>
                  <th className="border border-slate-800 bg-slate-100 py-0.5 font-bold text-slate-700 w-[48px]">
                    담 당
                  </th>
                  <th className="border border-slate-800 bg-slate-100 py-0.5 font-bold text-slate-700 w-[48px]">
                    실 장
                  </th>
                  <th className="border border-slate-800 bg-slate-100 py-0.5 font-bold text-slate-700 w-[48px]">
                    원 장
                  </th>
                </tr>
                <tr>
                  <td className="border border-slate-800 h-[36px]" contentEditable suppressContentEditableWarning></td>
                  <td className="border border-slate-800 h-[36px]" contentEditable suppressContentEditableWarning></td>
                  <td className="border border-slate-800 h-[36px]" contentEditable suppressContentEditableWarning></td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="min-w-[165px]" />
          )}
        </div>

        {/* 요약 메타 바 */}
        <div className="flex items-center justify-between bg-slate-50 border-y border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
          <span
            className="outline-none focus:bg-amber-50"
            contentEditable
            suppressContentEditableWarning
          >
            {summaryLeft}
          </span>
          {summaryRight && (
            <span
              className="tabular-nums font-bold text-slate-900 outline-none focus:bg-amber-50"
              contentEditable
              suppressContentEditableWarning
            >
              {summaryRight}
            </span>
          )}
        </div>
      </div>
    );
  };

  // 페이지 하단 공통 기관 푸터 + 페이지 번호
  const renderSheetFooter = (pageIdx: number, totalPages: number) => (
    <div className="mt-auto pt-2.5 border-t border-slate-300 flex items-center justify-between text-[11px] text-slate-600 shrink-0">
      <div
        className="font-bold text-slate-800 outline-none focus:bg-amber-50"
        contentEditable
        suppressContentEditableWarning
      >
        {academyName}
        {businessNumber !== "-" ? ` · 사업자등록번호 ${businessNumber}` : ""}
      </div>
      <div className="font-semibold text-slate-500 tabular-nums">
        Page {pageIdx + 1} / {totalPages}
      </div>
    </div>
  );

  return (
    <>
      {/* A4 규격 정밀 페이지 분할 스타일 (화면 미리보기 시트 === 실제 A4 인쇄 용지 1:1 매칭) */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .a4-sheet {
          width: 210mm;
          height: 296.5mm;
          padding: 13mm 14mm 11mm 14mm;
          box-sizing: border-box;
          background: #ffffff;
          margin: 0 auto 28px auto;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.09), 0 1px 3px rgba(15, 23, 42, 0.06);
          border: 1px solid #e2e8f0;
          border-radius: 4px;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
          color: #0f172a;
        }

        .ledger-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          border-top: 2px solid #0f172a;
          border-bottom: 2px solid #0f172a;
        }
        .ledger-table th {
          background-color: #f1f5f9;
          border: 1px solid #334155;
          height: 33px;
          padding: 0 6px;
          font-size: 11.5px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.01em;
        }
        .ledger-table td {
          border: 1px solid #475569;
          height: 31px;
          padding: 0 6px;
          font-size: 11.5px;
          color: #0f172a;
          vertical-align: middle;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ledger-table tr:nth-child(even) td {
          background-color: #fafafa;
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          html, body {
            width: 210mm !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* 대시보드 레이아웃 고정 컨테이너 해제 */
          body > div,
          .h-screen,
          .overflow-hidden,
          .overflow-y-auto,
          .custom-scroll,
          .flex-1,
          main {
            display: block !important;
            height: auto !important;
            max-height: none !important;
            min-height: 0 !important;
            overflow: visible !important;
            background: #ffffff !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          /* 사이드바·상단헤더·플로팅챗·컨트롤바 완벽 숨김 */
          aside,
          nav,
          .print-hidden,
          #floating-chat-container,
          div:has(> main) > :not(main),
          div:has(> aside) > :not(:has(main)) {
            display: none !important;
          }
          #print-area {
            display: block !important;
            position: static !important;
            width: 210mm !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .a4-sheet {
            width: 210mm !important;
            height: 296.5mm !important;
            margin: 0 !important;
            padding: 13mm 14mm 11mm 14mm !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .a4-sheet:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
        }
      `,
        }}
      />

      <div className="flex-1 flex flex-col h-full bg-slate-100 relative print:bg-white font-pretendard">
        {/* 상단 컨트롤 패널 (인쇄 시 자동 숨김) */}
        <div className="print-hidden bg-white border-b border-slate-200 px-6 py-4 shrink-0 shadow-sm z-10">
          <div className="max-w-[1060px] mx-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-black text-slate-900 tracking-tight">
                    행정 · 교육청 비치 서류 출력 센터
                  </h1>
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    A4 정밀 규격
                  </span>
                </div>
                <p className="text-xs font-medium text-slate-500 mt-1">
                  모든 문서는 A4 용지 규격으로 자동 페이지 분할되며, 인쇄 전 표 안의 텍스트를 클릭해 직접 수정하거나 메모를 기입할 수 있습니다.
                </p>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={fetchData}
                  className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 transition-colors"
                >
                  ↻ 데이터 새로고침
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-6 py-2.5 bg-brand hover:bg-blue-900 text-white font-extrabold text-sm rounded-xl shadow-sm transition-colors flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.2"
                      d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                    />
                  </svg>
                  A4 인쇄 / PDF 저장 (
                  {activeDoc === "student"
                    ? `${studentPages.length}쪽`
                    : activeDoc === "instructor"
                    ? `${instructorPages.length}쪽`
                    : activeDoc === "ledger"
                    ? `${ledgerPages.length}쪽`
                    : "1쪽"}
                  )
                </button>
              </div>
            </div>

            {/* 문서 탭 & 세부 필터 바 */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  {
                    id: "student",
                    label: "수강생 대장",
                    count: `${processedStudents.length}명`,
                  },
                  {
                    id: "instructor",
                    label: "강사(직원) 명부",
                    count: `${processedInstructors.length}명`,
                  },
                  {
                    id: "ledger",
                    label: "현금·수납 출납부",
                    count: `${filteredPayments.length}건`,
                  },
                  {
                    id: "receipt",
                    label: "교육비 납입영수증",
                    count: "2매 1조",
                  },
                ].map((tab) => {
                  const isActive = activeDoc === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() =>
                        setActiveDoc(tab.id as "student" | "instructor" | "ledger" | "receipt")
                      }
                      className={`px-3.5 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 border ${
                        isActive
                          ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                          : "bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md font-extrabold ${
                          isActive
                            ? "bg-white/20 text-white"
                            : "bg-slate-200/80 text-slate-600"
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 탭별 맞춤 필터 + 공통 레이아웃 옵션 */}
              <div className="flex items-center gap-2.5 flex-wrap text-xs">
                {activeDoc === "student" && (
                  <>
                    <select
                      value={selectedClassFilter}
                      onChange={(e) => setSelectedClassFilter(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-slate-700 outline-none focus:border-blue-500"
                    >
                      <option value="all">전체 수강반 ({availableClassOptions.length}개)</option>
                      {availableClassOptions.map((cn: string) => (
                        <option key={cn} value={cn}>
                          {cn}
                        </option>
                      ))}
                    </select>

                    <select
                      value={studentSort}
                      onChange={(e) => setStudentSort(e.target.value as "name" | "class" | "date")}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-slate-700 outline-none focus:border-blue-500"
                    >
                      <option value="name">가나다순 정렬</option>
                      <option value="class">수강반별 정렬</option>
                      <option value="date">수강개시일순 정렬</option>
                    </select>

                    <label className="flex items-center gap-1.5 font-semibold text-slate-600 cursor-pointer select-none bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg">
                      <input
                        type="checkbox"
                        checked={onlyClassAssigned}
                        onChange={(e) => setOnlyClassAssigned(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>반 배정 완료생만</span>
                    </label>
                  </>
                )}

                {activeDoc === "ledger" && (
                  <select
                    value={selectedLedgerMonth}
                    onChange={(e) => setSelectedLedgerMonth(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-slate-700 outline-none focus:border-blue-500"
                  >
                    <option value="all">전체 수납 월</option>
                    {availableLedgerMonths.map((m: string) => (
                      <option key={m} value={m}>
                        {m} 귀속/수납분
                      </option>
                    ))}
                  </select>
                )}

                {activeDoc === "receipt" && (
                  <>
                    <input
                      type="text"
                      value={receiptSearch}
                      onChange={(e) => setReceiptSearch(e.target.value)}
                      placeholder="학생명·과정명 검색"
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-semibold text-slate-700 outline-none focus:border-blue-500 w-36"
                    />
                    <select
                      value={selectedReceiptId}
                      onChange={(e) => setSelectedReceiptId(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-slate-700 outline-none focus:border-blue-500 max-w-[260px]"
                    >
                      <option value="blank">[빈 양식] 수기 입력용 영수증</option>
                      {filteredReceiptCandidates.map((p: any) => {
                        const bill = unwrap(p.academy_billing);
                        const sName = String(unwrap(bill?.student)?.name || "학생");
                        const cName = String(unwrap(bill?.class)?.name || "-");
                        return (
                          <option key={p.payment_id} value={String(p.payment_id)}>
                            {formatDateDot(p.paid_at)} · {sName} ({cName}) ·{" "}
                            {Number(p.paid_amount || 0).toLocaleString()}원
                          </option>
                        );
                      })}
                    </select>
                  </>
                )}

                {activeDoc !== "receipt" && (
                  <>
                    <label className="flex items-center gap-1.5 font-semibold text-slate-600 cursor-pointer select-none bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg">
                      <input
                        type="checkbox"
                        checked={showApprovalBox}
                        onChange={(e) => setShowApprovalBox(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>결재란</span>
                    </label>
                    <label className="flex items-center gap-1.5 font-semibold text-slate-600 cursor-pointer select-none bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg">
                      <input
                        type="checkbox"
                        checked={fillBlankRows}
                        onChange={(e) => setFillBlankRows(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>여백 빈칸 채우기</span>
                    </label>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* A4 시트 미리보기 & 실제 인쇄 영역 */}
        <div className="flex-1 overflow-y-auto py-8 px-4 print:p-0 print:overflow-visible custom-scroll">
          <div id="print-area">
            {isLoading ? (
              <div className="a4-sheet items-center justify-center">
                <div className="text-sm font-bold text-slate-400">
                  법정 서류 데이터를 불러오는 중입니다...
                </div>
              </div>
            ) : (
              <>
                {/* =========================================================
                    1. 수강생 대장 (정식 재원생 전용 · 테스트 반/학생 제외 · 학부모 연락처 · A4 페이지 분할)
                   ========================================================= */}
                {activeDoc === "student" &&
                  studentPages.map((pageRows: StudentLedgerRow[], pageIdx: number) => {
                    const baseIndex =
                      pageIdx === 0
                        ? 0
                        : firstPageCap + (pageIdx - 1) * CONTINUATION_PAGE_ROWS;
                    const pageCapacity =
                      pageIdx === 0 ? firstPageCap : CONTINUATION_PAGE_ROWS;
                    const blankCount = fillBlankRows
                      ? Math.max(0, pageCapacity - pageRows.length)
                      : pageRows.length === 0
                      ? 12
                      : 0;

                    return (
                      <section key={`stu-page-${pageIdx}`} className="a4-sheet">
                        {renderSheetHeader({
                          docTitle: "수강생대장",
                          docCode: "비치장부 제1호 (학원의 설립·운영 및 과외교습에 관한 법률 시행규칙)",
                          summaryLeft:
                            selectedClassFilter === "all"
                              ? "조회 구분: 정식 등록 재원생 전체"
                              : `조회 구분: ${selectedClassFilter}`,
                          summaryRight: `총 등록 인원: ${processedStudents.length}명`,
                          pageIdx,
                          totalPages: studentPages.length,
                        })}

                        <table className="ledger-table">
                          <colgroup>
                            <col style={{ width: "7%" }} />
                            <col style={{ width: "12%" }} />
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "24%" }} />
                            <col style={{ width: "13%" }} />
                            <col style={{ width: "17%" }} />
                            <col style={{ width: "9%" }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>연번</th>
                              <th>성 명</th>
                              <th>학교 / 학년</th>
                              <th>수강 과정 (반)</th>
                              <th>수강개시일</th>
                              <th>학부모 연락처</th>
                              <th>비 고</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pageRows.map((st: StudentLedgerRow, rIdx: number) => (
                              <tr key={st.studentId}>
                                <td
                                  className="text-center tabular-nums text-slate-600 outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {baseIndex + rIdx + 1}
                                </td>
                                <td
                                  className="text-center font-bold text-slate-900 outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {st.name}
                                </td>
                                <td
                                  className="text-center outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {st.schoolGrade}
                                </td>
                                <td
                                  className="text-left px-2.5 font-medium outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {st.classNames}
                                </td>
                                <td
                                  className="text-center tabular-nums outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {st.startDate}
                                </td>
                                <td
                                  className="text-center tabular-nums font-medium outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {st.parentPhone}
                                </td>
                                <td
                                  className="text-center outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {st.note}
                                </td>
                              </tr>
                            ))}

                            {Array.from({ length: blankCount }).map((_, bIdx: number) => (
                              <tr key={`stu-blank-${pageIdx}-${bIdx}`}>
                                <td className="text-center text-slate-300" contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {renderSheetFooter(pageIdx, studentPages.length)}
                      </section>
                    );
                  })}

                {/* =========================================================
                    2. 강사(직원) 명부 (퇴사·휴직·해임 제외 · 현직 인원 전용 · A4 페이지 분할)
                   ========================================================= */}
                {activeDoc === "instructor" &&
                  instructorPages.map((pageRows: InstructorRosterRow[], pageIdx: number) => {
                    const baseIndex =
                      pageIdx === 0
                        ? 0
                        : firstPageCap + (pageIdx - 1) * CONTINUATION_PAGE_ROWS;
                    const pageCapacity =
                      pageIdx === 0 ? firstPageCap : CONTINUATION_PAGE_ROWS;
                    const blankCount = fillBlankRows
                      ? Math.max(0, pageCapacity - pageRows.length)
                      : pageRows.length === 0
                      ? 12
                      : 0;

                    return (
                      <section key={`inst-page-${pageIdx}`} className="a4-sheet">
                        {renderSheetHeader({
                          docTitle: "강사·직원명부",
                          docCode: "비치장부 제2호 (현직 교직원 재직 현황)",
                          summaryLeft: "조회 구분: 현직 재직 강사 및 직원 전체 (퇴사·휴직 제외)",
                          summaryRight: `총 재직 인원: ${processedInstructors.length}명`,
                          pageIdx,
                          totalPages: instructorPages.length,
                        })}

                        <table className="ledger-table">
                          <colgroup>
                            <col style={{ width: "8%" }} />
                            <col style={{ width: "14%" }} />
                            <col style={{ width: "16%" }} />
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "15%" }} />
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "11%" }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>연번</th>
                              <th>성 명</th>
                              <th>직위 / 직책</th>
                              <th>담당 과목 · 부서</th>
                              <th>임용(입사)일</th>
                              <th>연락처</th>
                              <th>비 고</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pageRows.map((inst: InstructorRosterRow, rIdx: number) => (
                              <tr key={inst.instructorId}>
                                <td
                                  className="text-center tabular-nums text-slate-600 outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {baseIndex + rIdx + 1}
                                </td>
                                <td
                                  className="text-center font-bold text-slate-900 outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {inst.name}
                                </td>
                                <td
                                  className="text-center font-semibold outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {inst.position}
                                </td>
                                <td
                                  className="text-center outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {inst.department}
                                </td>
                                <td
                                  className="text-center tabular-nums outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {inst.hireDate}
                                </td>
                                <td
                                  className="text-center tabular-nums font-medium outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {inst.phone}
                                </td>
                                <td
                                  className="text-center text-slate-700 outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  재직
                                </td>
                              </tr>
                            ))}

                            {Array.from({ length: blankCount }).map((_, bIdx: number) => (
                              <tr key={`inst-blank-${pageIdx}-${bIdx}`}>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {renderSheetFooter(pageIdx, instructorPages.length)}
                      </section>
                    );
                  })}

                {/* =========================================================
                    3. 현금·수납 출납부 (A4 페이지 분할 + 합계 행)
                   ========================================================= */}
                {activeDoc === "ledger" &&
                  ledgerPages.map((pageRows: any[], pageIdx: number) => {
                    const firstLedgerCap = firstPageCap - 1;
                    const nextLedgerCap = CONTINUATION_PAGE_ROWS - 1;
                    const baseIndex =
                      pageIdx === 0
                        ? 0
                        : firstLedgerCap + (pageIdx - 1) * nextLedgerCap;
                    const pageCapacity = pageIdx === 0 ? firstLedgerCap : nextLedgerCap;
                    const blankCount = fillBlankRows
                      ? Math.max(0, pageCapacity - pageRows.length)
                      : pageRows.length === 0
                      ? 12
                      : 0;
                    const pageSubtotal = pageRows.reduce(
                      (acc: number, r: any) => acc + (Number(r.paid_amount) || 0),
                      0
                    );
                    const isLastPage = pageIdx === ledgerPages.length - 1;

                    return (
                      <section key={`ledger-page-${pageIdx}`} className="a4-sheet">
                        {renderSheetHeader({
                          docTitle: "현금·수납출납부",
                          docCode: "비치장부 제3호 (수강료 수납 및 출납 명세)",
                          summaryLeft:
                            selectedLedgerMonth === "all"
                              ? "조회 기간: 최근 수납 전체"
                              : `조회 기간: ${selectedLedgerMonth}`,
                          summaryRight: `총 ${filteredPayments.length}건 · 합계 ${totalLedgerIncome.toLocaleString()}원`,
                          pageIdx,
                          totalPages: ledgerPages.length,
                        })}

                        <table className="ledger-table">
                          <colgroup>
                            <col style={{ width: "8%" }} />
                            <col style={{ width: "14%" }} />
                            <col style={{ width: "38%" }} />
                            <col style={{ width: "16%" }} />
                            <col style={{ width: "12%" }} />
                            <col style={{ width: "12%" }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>연번</th>
                              <th>수납일자</th>
                              <th>적 요 (청구월 · 학생명 · 과정명)</th>
                              <th>수입 금액 (원)</th>
                              <th>지출 (원)</th>
                              <th>결제수단</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pageRows.map((p: any, rIdx: number) => {
                              const bill = unwrap(p.academy_billing);
                              const sName = String(unwrap(bill?.student)?.name || "-");
                              const cName = String(unwrap(bill?.class)?.name || "-");
                              const bm = bill?.billing_month ? `[${bill.billing_month}] ` : "";
                              return (
                                <tr key={p.payment_id}>
                                  <td
                                    className="text-center tabular-nums text-slate-600 outline-none focus:bg-amber-50"
                                    contentEditable
                                    suppressContentEditableWarning
                                  >
                                    {baseIndex + rIdx + 1}
                                  </td>
                                  <td
                                    className="text-center tabular-nums outline-none focus:bg-amber-50"
                                    contentEditable
                                    suppressContentEditableWarning
                                  >
                                    {formatDateDot(p.paid_at)}
                                  </td>
                                  <td
                                    className="text-left px-2.5 outline-none focus:bg-amber-50"
                                    contentEditable
                                    suppressContentEditableWarning
                                  >
                                    {bm}
                                    {sName} ({cName})
                                  </td>
                                  <td
                                    className="text-right px-2.5 font-bold tabular-nums text-slate-900 outline-none focus:bg-amber-50"
                                    contentEditable
                                    suppressContentEditableWarning
                                  >
                                    {Number(p.paid_amount || 0).toLocaleString()}
                                  </td>
                                  <td
                                    className="text-right px-2.5 tabular-nums text-slate-500 outline-none focus:bg-amber-50"
                                    contentEditable
                                    suppressContentEditableWarning
                                  >
                                    0
                                  </td>
                                  <td
                                    className="text-center outline-none focus:bg-amber-50"
                                    contentEditable
                                    suppressContentEditableWarning
                                  >
                                    {p.payment_method || "-"}
                                  </td>
                                </tr>
                              );
                            })}

                            {Array.from({ length: blankCount }).map((_, bIdx: number) => (
                              <tr key={`led-blank-${pageIdx}-${bIdx}`}>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                                <td contentEditable suppressContentEditableWarning></td>
                              </tr>
                            ))}

                            <tr className="bg-slate-100 font-extrabold">
                              <td colSpan={3} className="text-center font-extrabold !bg-slate-100">
                                {isLastPage
                                  ? "총 합 계 (누계)"
                                  : `본 페이지 소계 (${pageRows.length}건)`}
                              </td>
                              <td className="text-right px-2.5 tabular-nums font-extrabold !bg-slate-100">
                                {(isLastPage ? totalLedgerIncome : pageSubtotal).toLocaleString()}
                              </td>
                              <td className="text-right px-2.5 tabular-nums font-bold !bg-slate-100">
                                0
                              </td>
                              <td className="text-center !bg-slate-100">-</td>
                            </tr>
                          </tbody>
                        </table>

                        {renderSheetFooter(pageIdx, ledgerPages.length)}
                      </section>
                    );
                  })}

                {/* =========================================================
                    4. 교육비 납입영수증 (학원 보관용 + 학부모 교부용 2매 1조 단일 A4 시트)
                   ========================================================= */}
                {activeDoc === "receipt" && (
                  <section className="a4-sheet justify-between">
                    {[
                      { copyType: "학원 보관용", serialSuffix: "A" },
                      { copyType: "학부모 교부용", serialSuffix: "B" },
                    ].map((meta, idx: number) => {
                      const bill = activeReceiptPayment
                        ? unwrap(activeReceiptPayment.academy_billing)
                        : null;
                      const studentName = String(unwrap(bill?.student)?.name || "");
                      const courseName = String(unwrap(bill?.class)?.name || "");
                      const billingMonth = String(bill?.billing_month || "");
                      const payMethod = String(activeReceiptPayment?.payment_method || "");
                      const paidAmountStr = activeReceiptPayment
                        ? `₩ ${Number(activeReceiptPayment.paid_amount || 0).toLocaleString()} 원정`
                        : "₩ ";
                      const paidDateStr = activeReceiptPayment?.paid_at
                        ? formatDateDot(activeReceiptPayment.paid_at)
                        : todayStr;
                      const receiptNo = activeReceiptPayment
                        ? `제 ${new Date(activeReceiptPayment.paid_at || Date.now()).getFullYear()}-${String(
                            activeReceiptPayment.payment_id
                          ).padStart(4, "0")} 호`
                        : `제 ${new Date().getFullYear()}-____ 호`;

                      return (
                        <React.Fragment key={meta.copyType}>
                          {idx === 1 && (
                            <div className="my-2 flex items-center gap-3 text-[10px] font-bold text-slate-400 select-none shrink-0">
                              <div className="flex-1 border-t border-dashed border-slate-400" />
                              <span>✂ 절 취 선</span>
                              <div className="flex-1 border-t border-dashed border-slate-400" />
                            </div>
                          )}

                          <div className="border-2 border-slate-900 p-5 flex-1 flex flex-col justify-between relative">
                            {/* 상단 헤더 */}
                            <div>
                              <div className="flex items-center justify-between mb-3">
                                <span
                                  className="text-[11px] font-bold text-slate-700 outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  일련번호: {receiptNo}
                                </span>
                                <span className="text-[11px] font-extrabold px-2.5 py-0.5 border border-slate-800 bg-slate-100 text-slate-900">
                                  {meta.copyType}
                                </span>
                              </div>

                              <h2
                                className="text-[21px] font-black text-center tracking-[0.35em] pl-[0.35em] text-slate-900 mb-4 underline underline-offset-4 decoration-2 outline-none focus:bg-amber-50"
                                contentEditable
                                suppressContentEditableWarning
                              >
                                교육비납입영수증
                              </h2>

                              {/* 수강자 및 납입 명세 표 */}
                              <table className="w-full border-collapse border border-slate-800 text-[11.5px] mb-3">
                                <colgroup>
                                  <col style={{ width: "18%" }} />
                                  <col style={{ width: "32%" }} />
                                  <col style={{ width: "18%" }} />
                                  <col style={{ width: "32%" }} />
                                </colgroup>
                                <tbody>
                                  <tr>
                                    <th className="border border-slate-800 bg-slate-100 py-1.5 font-bold">
                                      수강생 성명
                                    </th>
                                    <td
                                      className="border border-slate-800 px-3 py-1.5 font-bold text-center outline-none focus:bg-amber-50"
                                      contentEditable
                                      suppressContentEditableWarning
                                    >
                                      {studentName}
                                    </td>
                                    <th className="border border-slate-800 bg-slate-100 py-1.5 font-bold">
                                      교습 과정(반)
                                    </th>
                                    <td
                                      className="border border-slate-800 px-3 py-1.5 text-center outline-none focus:bg-amber-50"
                                      contentEditable
                                      suppressContentEditableWarning
                                    >
                                      {courseName}
                                    </td>
                                  </tr>
                                  <tr>
                                    <th className="border border-slate-800 bg-slate-100 py-1.5 font-bold">
                                      교습(청구)월
                                    </th>
                                    <td
                                      className="border border-slate-800 px-3 py-1.5 text-center tabular-nums outline-none focus:bg-amber-50"
                                      contentEditable
                                      suppressContentEditableWarning
                                    >
                                      {billingMonth}
                                    </td>
                                    <th className="border border-slate-800 bg-slate-100 py-1.5 font-bold">
                                      결제 수단
                                    </th>
                                    <td
                                      className="border border-slate-800 px-3 py-1.5 text-center outline-none focus:bg-amber-50"
                                      contentEditable
                                      suppressContentEditableWarning
                                    >
                                      {payMethod}
                                    </td>
                                  </tr>
                                  <tr>
                                    <th className="border border-slate-800 bg-slate-100 py-2 font-extrabold text-[12.5px]">
                                      영 수 금 액
                                    </th>
                                    <td
                                      colSpan={3}
                                      className="border border-slate-800 px-4 py-2 text-right font-black text-[15px] tabular-nums text-slate-900 outline-none focus:bg-amber-50"
                                      contentEditable
                                      suppressContentEditableWarning
                                    >
                                      {paidAmountStr}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>

                              {/* 공급자(학원) 사업자 정보 표 */}
                              <table className="w-full border-collapse border border-slate-700 text-[11px]">
                                <colgroup>
                                  <col style={{ width: "18%" }} />
                                  <col style={{ width: "32%" }} />
                                  <col style={{ width: "18%" }} />
                                  <col style={{ width: "32%" }} />
                                </colgroup>
                                <tbody>
                                  <tr>
                                    <th className="border border-slate-700 bg-slate-50 py-1 font-bold">
                                      학 원 명
                                    </th>
                                    <td
                                      className="border border-slate-700 px-2.5 py-1 font-semibold outline-none focus:bg-amber-50"
                                      contentEditable
                                      suppressContentEditableWarning
                                    >
                                      {academyName}
                                    </td>
                                    <th className="border border-slate-700 bg-slate-50 py-1 font-bold">
                                      사업자등록번호
                                    </th>
                                    <td
                                      className="border border-slate-700 px-2.5 py-1 tabular-nums outline-none focus:bg-amber-50"
                                      contentEditable
                                      suppressContentEditableWarning
                                    >
                                      {businessNumber}
                                    </td>
                                  </tr>
                                  <tr>
                                    <th className="border border-slate-700 bg-slate-50 py-1 font-bold">
                                      대 표 자
                                    </th>
                                    <td
                                      className="border border-slate-700 px-2.5 py-1 outline-none focus:bg-amber-50"
                                      contentEditable
                                      suppressContentEditableWarning
                                    >
                                      {ceoName}
                                    </td>
                                    <th className="border border-slate-700 bg-slate-50 py-1 font-bold">
                                      대표 전화
                                    </th>
                                    <td
                                      className="border border-slate-700 px-2.5 py-1 tabular-nums outline-none focus:bg-amber-50"
                                      contentEditable
                                      suppressContentEditableWarning
                                    >
                                      {academyPhone}
                                    </td>
                                  </tr>
                                  <tr>
                                    <th className="border border-slate-700 bg-slate-50 py-1 font-bold">
                                      소 재 지
                                    </th>
                                    <td
                                      colSpan={3}
                                      className="border border-slate-700 px-2.5 py-1 outline-none focus:bg-amber-50"
                                      contentEditable
                                      suppressContentEditableWarning
                                    >
                                      {academyAddress}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>

                            {/* 하단 영수 확인 및 직인 */}
                            <div className="pt-2 flex items-end justify-between">
                              <div className="text-[11px] text-slate-600">
                                「학원의 설립·운영 및 과외교습에 관한 법률 시행규칙」 별지 제16호 서식에 의거 위 금액을 정히 영수함.
                              </div>
                              <div className="text-right shrink-0 ml-4 relative pr-11">
                                <div
                                  className="text-[12px] font-bold text-slate-800 tabular-nums mb-1 outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  영수일자 : {paidDateStr}
                                </div>
                                <div
                                  className="text-[14px] font-black text-slate-900 outline-none focus:bg-amber-50"
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {academyName}장
                                </div>
                                <div className="absolute right-0 bottom-0 w-9 h-9 border-2 border-rose-600 rounded-full text-rose-600 text-[8.5px] font-extrabold leading-tight flex items-center justify-center rotate-[-10deg] opacity-80 select-none">
                                  학원장
                                  <br />
                                  직 인
                                </div>
                              </div>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}