// src/app/hq/contracts/page.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import {
  buildContractTemplateBody,
  CONTRACT_CATEGORIES,
  CONTRACT_TAX_LABELS,
} from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  HqContract,
  HqContractCategory,
  HqContractTargetType,
  HqContractTaxType,
} from "@/lib/hq/types";

type ContractTab = "ALL" | "SENT" | "SIGNED" | "INTERNAL" | "EXTERNAL" | "EXPIRING";

export default function HqContractsPage() {
  const { me, members, isHrManager, refreshContractBadge } = useHqShell();

  const [contracts, setContracts] = useState<HqContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ContractTab>("ALL");
  const [keyword, setKeyword] = useState("");

  // 계약 생성 모달
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState<HqContractCategory>("OUTSOURCING");
  const [targetType, setTargetType] =
    useState<HqContractTargetType>("EXTERNAL");
  const [targetMemberId, setTargetMemberId] = useState("");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [counterpartyRole, setCounterpartyRole] = useState("외주 디자이너");
  const [counterpartyPhone, setCounterpartyPhone] = useState("");
  const [counterpartyEmail, setCounterpartyEmail] = useState("");
  const [department, setDepartment] = useState("출판편집팀");
  const [title, setTitle] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [startDate, setStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState("");
  const [contractAmount, setContractAmount] = useState("1500000");
  const [royaltyRate, setRoyaltyRate] = useState("10");
  const [taxType, setTaxType] = useState<HqContractTaxType>("BIZ_33");
  const [bodyText, setBodyText] = useState("");
  const [specialTerms, setSpecialTerms] = useState("");

  // 상세 열람 · 전자서명 · 인쇄 모달
  const [selected, setSelected] = useState<HqContract | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const [hasSignatureStroke, setHasSignatureStroke] = useState(false);

  const canCreateContract = Boolean(
    isHrManager || (me && me.rank_level >= 3)
  );

  const loadContracts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { contracts: HqContract[] };
      }>("/api/hq/contracts");
      setContracts(res.data?.contracts || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status === "재직"),
    [members]
  );

  const regenerateTemplate = useCallback(
    (
      nextCat: HqContractCategory,
      nextName: string,
      nextRole: string,
      nextDept: string,
      nextBook: string,
      nextStart: string,
      nextEnd: string,
      nextAmt: number,
      nextRoyalty: number | null
    ) => {
      const catMeta = CONTRACT_CATEGORIES[nextCat];
      const autoTitle =
        nextCat === "OUTSOURCING" || nextCat === "ROYALTY"
          ? `[${catMeta.shortLabel}] ${nextBook || "신간 교재"} — ${
              nextName || "파트너"
            }`
          : `[${catMeta.shortLabel}] ${new Date().getFullYear()}년 ${
              nextName || "구성원"
            } ${catMeta.label}`;

      setTitle(autoTitle);
      setBodyText(
        buildContractTemplateBody({
          category: nextCat,
          counterpartyName: nextName,
          counterpartyRole: nextRole,
          department: nextDept,
          bookTitle: nextBook,
          startDate: nextStart,
          endDate: nextEnd,
          amount: nextAmt,
          royaltyRate: nextRoyalty,
        })
      );
    },
    []
  );

  const openNewModal = (presetCat?: HqContractCategory) => {
    const initCat: HqContractCategory =
      presetCat || (isHrManager ? "LABOR" : "OUTSOURCING");
    const meta = CONTRACT_CATEGORIES[initCat];
    const nextTarget = meta.targetDefault;
    const defaultMember =
      nextTarget === "INTERNAL" ? activeMembers[0] || null : null;

    const initName = defaultMember ? defaultMember.name : "";
    const initRole = defaultMember
      ? defaultMember.job_title
      : initCat === "ROYALTY"
      ? "집필 저자"
      : "외주 조판·디자인";
    const initDept = defaultMember ? defaultMember.department : "출판편집팀";
    const initAmt =
      initCat === "LABOR" || initCat === "SALARY"
        ? 42000000
        : initCat === "NDA"
        ? 0
        : 2000000;
    const initStart = new Date().toISOString().slice(0, 10);

    setCategory(initCat);
    setTargetType(nextTarget);
    setTargetMemberId(defaultMember?.instructor_id || "");
    setCounterpartyName(initName);
    setCounterpartyRole(initRole);
    setCounterpartyPhone(defaultMember?.phone || "");
    setCounterpartyEmail(defaultMember?.email || "");
    setDepartment(initDept);
    setBookTitle("");
    setStartDate(initStart);
    setEndDate("");
    setContractAmount(String(initAmt));
    setRoyaltyRate("10");
    setTaxType(meta.taxDefault);
    setSpecialTerms("");

    regenerateTemplate(
      initCat,
      initName,
      initRole,
      initDept,
      "",
      initStart,
      "",
      initAmt,
      initCat === "ROYALTY" ? 10 : null
    );
    setCreateOpen(true);
  };

  const handleSelectCategory = (nextCat: HqContractCategory) => {
    if ((nextCat === "LABOR" || nextCat === "SALARY") && !isHrManager) {
      alert("근로·연봉계약서는 인사관리자(대표·임원·경영지원)만 작성할 수 있습니다.");
      return;
    }
    const meta = CONTRACT_CATEGORIES[nextCat];
    setCategory(nextCat);
    setTargetType(meta.targetDefault);
    setTaxType(meta.taxDefault);

    let nextName = counterpartyName;
    let nextRole = counterpartyRole;
    let nextDept = department;

    if (meta.targetDefault === "INTERNAL" && activeMembers.length > 0) {
      const m =
        activeMembers.find((x) => x.instructor_id === targetMemberId) ||
        activeMembers[0];
      setTargetMemberId(m.instructor_id);
      nextName = m.name;
      nextRole = m.job_title;
      nextDept = m.department;
      setCounterpartyName(m.name);
      setCounterpartyRole(m.job_title);
      setCounterpartyPhone(m.phone || "");
      setCounterpartyEmail(m.email || "");
      setDepartment(m.department);
    } else if (meta.targetDefault === "EXTERNAL") {
      setTargetMemberId("");
      nextRole = nextCat === "ROYALTY" ? "집필 저자" : "외주 프리랜서";
      setCounterpartyRole(nextRole);
    }

    const nextAmt =
      nextCat === "LABOR" || nextCat === "SALARY"
        ? 42000000
        : nextCat === "NDA"
        ? 0
        : 2000000;
    setContractAmount(String(nextAmt));

    regenerateTemplate(
      nextCat,
      nextName,
      nextRole,
      nextDept,
      bookTitle,
      startDate,
      endDate,
      nextAmt,
      nextCat === "ROYALTY" ? Number(royaltyRate || 10) : null
    );
  };

  const handleSelectMember = (memberId: string) => {
    setTargetMemberId(memberId);
    const m = activeMembers.find((x) => x.instructor_id === memberId);
    if (!m) return;
    setCounterpartyName(m.name);
    setCounterpartyRole(m.job_title);
    setCounterpartyPhone(m.phone || "");
    setCounterpartyEmail(m.email || "");
    setDepartment(m.department);
    regenerateTemplate(
      category,
      m.name,
      m.job_title,
      m.department,
      bookTitle,
      startDate,
      endDate,
      Number(contractAmount || 0),
      category === "ROYALTY" ? Number(royaltyRate || 10) : null
    );
  };

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await hqFetch("/api/hq/contracts", {
        method: "POST",
        body: {
          category,
          target_type: targetType,
          target_member_id: targetType === "INTERNAL" ? targetMemberId : null,
          counterparty_name: counterpartyName,
          counterparty_role: counterpartyRole,
          counterparty_phone: counterpartyPhone,
          counterparty_email: counterpartyEmail,
          department,
          title,
          book_title: bookTitle,
          start_date: startDate || null,
          end_date: endDate || null,
          contract_amount: Number(contractAmount || 0),
          royalty_rate:
            category === "ROYALTY" ? Number(royaltyRate || 0) : null,
          tax_type: taxType,
          body_text: bodyText,
          special_terms: specialTerms,
          company_signer_name: "천종현수학연구소 대표이사",
        },
      });
      setCreateOpen(false);
      await Promise.all([loadContracts(), refreshContractBadge()]);
      window.dispatchEvent(new CustomEvent("hq:contract-updated"));
    } catch (err: any) {
      alert(err?.message || "계약 발송 실패");
    } finally {
      setSaving(false);
    }
  };

  // 전자서명 캔버스 드로잉 핸들러
  const getCanvasPoint = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const t = e.touches[0];
      return {
        x: ((t.clientX - rect.left) * canvas.width) / rect.width,
        y: ((t.clientY - rect.top) * canvas.height) / rect.height,
      };
    }
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const startDraw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    isDrawingRef.current = true;
    const { x, y } = getCanvasPoint(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const moveDraw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasPoint(e);
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignatureStroke(true);
  };

  const endDraw = () => {
    isDrawingRef.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignatureStroke(false);
  };

  const stampNameSeal = (nameText: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 28px serif";
    ctx.fillStyle = "#0f172a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${nameText} (서명)`, canvas.width / 2, canvas.height / 2);
    setHasSignatureStroke(true);
  };

  const handleSignSubmit = async () => {
    if (!selected) return;
    const canvas = canvasRef.current;
    if (!canvas || !hasSignatureStroke) {
      alert("서명 패드에 자필 서명을 그리거나 [성명 서명 자동생성]을 눌러주세요.");
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    setSaving(true);
    try {
      const res = await hqFetch<{ success: boolean; data: HqContract }>(
        "/api/hq/contracts",
        {
          method: "PATCH",
          body: {
            contract_id: selected.contract_id,
            action: "SIGN",
            party_signature_data: dataUrl,
          },
        }
      );
      setSelected(res.data);
      await Promise.all([loadContracts(), refreshContractBadge()]);
      window.dispatchEvent(new CustomEvent("hq:contract-updated"));
      alert("전자서명이 완료되어 계약이 공식 체결되었습니다.");
    } catch (err: any) {
      alert(err?.message || "전자서명 처리 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelContract = async (contractId: string) => {
    if (!confirm("이 계약서를 회수(파기) 상태로 변경하시겠습니까?")) return;
    try {
      await hqFetch("/api/hq/contracts", {
        method: "PATCH",
        body: { contract_id: contractId, action: "CANCEL" },
      });
      setSelected(null);
      await Promise.all([loadContracts(), refreshContractBadge()]);
    } catch (err: any) {
      alert(err?.message || "계약 회수 실패");
    }
  };

  const nowMs = Date.now();
  const filteredContracts = useMemo(() => {
    return contracts.filter((c) => {
      if (tab === "SENT" && c.status !== "SENT") return false;
      if (tab === "SIGNED" && c.status !== "SIGNED") return false;
      if (tab === "INTERNAL" && c.target_type !== "INTERNAL") return false;
      if (tab === "EXTERNAL" && c.target_type !== "EXTERNAL") return false;
      if (tab === "EXPIRING") {
        if (!c.end_date || c.status !== "SIGNED") return false;
        const diffDays =
          (new Date(c.end_date).getTime() - nowMs) / (1000 * 60 * 60 * 24);
        if (diffDays < -7 || diffDays > 30) return false;
      }
      if (keyword.trim()) {
        const q = keyword.trim().toLowerCase();
        const hay = `${c.title} ${c.counterparty_name} ${c.book_title || ""} ${
          c.contract_no
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [contracts, tab, keyword, nowMs]);

  const stats = useMemo(() => {
    const sent = contracts.filter((c) => c.status === "SENT").length;
    const signed = contracts.filter((c) => c.status === "SIGNED").length;
    const externalCount = contracts.filter(
      (c) => c.target_type === "EXTERNAL"
    ).length;
    const expiring = contracts.filter((c) => {
      if (!c.end_date || c.status !== "SIGNED") return false;
      const diff =
        (new Date(c.end_date).getTime() - nowMs) / (1000 * 60 * 60 * 24);
      return diff >= -7 && diff <= 30;
    }).length;
    return { sent, signed, externalCount, expiring };
  }, [contracts, nowMs]);

  return (
    <>
      <div
        className={`p-6 max-w-[1440px] mx-auto w-full space-y-6 ${
          selected ? "print:hidden" : ""
        }`}
      >
        {/* 상단 KPI 및 빠른 계약서 발송 바 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
            <div className="text-xs font-bold text-slate-500">서명 대기 계약</div>
            <div className="text-2xl font-black text-amber-600 mt-1">
              {stats.sent}건
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              전자서명 완료 즉시 인사·정산 기록 연동
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
            <div className="text-xs font-bold text-slate-500">체결 완료 보관</div>
            <div className="text-2xl font-black text-emerald-700 mt-1">
              {stats.signed}건
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              상시 A4 계약서 출력 및 PDF 보관 가능
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
            <div className="text-xs font-bold text-slate-500">
              저자 · 외주 파트너 계약
            </div>
            <div className="text-2xl font-black text-brand mt-1">
              {stats.externalCount}건
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              출판권(인세) · 조판 · 일러스트 · 교열 용역
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
            <div className="text-xs font-bold text-slate-500">
              30일 내 만료·갱신 도래
            </div>
            <div className="text-2xl font-black text-rose-600 mt-1">
              {stats.expiring}건
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              출판권 연장 및 외주 납기 마감 사전 점검
            </div>
          </div>
        </div>

        {/* 빠른 표준 계약서 템플릿 런처 */}
        {canCreateContract && (
          <section className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-blue-300">
                  출판사 · 연구소 필수 표준 전자계약 5종
                </div>
                <h3 className="text-base font-extrabold mt-0.5">
                  양식을 선택하면 표준 법무 조항이 자동으로 채워집니다
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(CONTRACT_CATEGORIES) as HqContractCategory[]).map(
                  (catKey) => {
                    const m = CONTRACT_CATEGORIES[catKey];
                    const disabled =
                      (catKey === "LABOR" || catKey === "SALARY") && !isHrManager;
                    if (disabled) return null;
                    return (
                      <button
                        key={catKey}
                        type="button"
                        onClick={() => openNewModal(catKey)}
                        className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-bold transition-colors flex items-center gap-1.5"
                      >
                        <span>{m.icon}</span>
                        <span>+ {m.shortLabel}</span>
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          </section>
        )}

        {/* 필터 탭 및 계약서 목록 */}
        <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["ALL", "전체 보관함"],
                  ["SENT", `서명 대기 (${stats.sent})`],
                  ["SIGNED", "체결 완료"],
                  ["INTERNAL", "임직원 근로·연봉·NDA"],
                  ["EXTERNAL", "저자 출판권·외주용역"],
                  ["EXPIRING", `만료 임박 (${stats.expiring})`],
                ] as [ContractTab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                    tab === key
                      ? "bg-brand text-white"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="계약명, 저자/구성원명, 도서명 검색..."
              className="px-3.5 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold w-64"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500 uppercase">
                  <th className="py-3 px-4">계약번호 / 구분</th>
                  <th className="py-3 px-4">계약서 제목 · 대상 도서</th>
                  <th className="py-3 px-4">계약 상대방 (을)</th>
                  <th className="py-3 px-4">계약 금액 · 인세율</th>
                  <th className="py-3 px-4">계약 기간</th>
                  <th className="py-3 px-4">서명 상태</th>
                  <th className="py-3 px-4 text-right">열람 · 서명</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      전자계약 문서를 불러오는 중입니다...
                    </td>
                  </tr>
                ) : filteredContracts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      표시할 전자계약 문서가 없습니다. 상단 버튼으로 새 계약서를 발송해 보세요.
                    </td>
                  </tr>
                ) : (
                  filteredContracts.map((c) => {
                    const catMeta = CONTRACT_CATEGORIES[c.category];
                    const isMySignTurn =
                      c.status === "SENT" &&
                      (c.target_member_id === me?.instructor_id ||
                        (c.target_type === "EXTERNAL" && canCreateContract));
                    return (
                      <tr
                        key={c.contract_id}
                        onClick={() => {
                          setSelected(c);
                          setHasSignatureStroke(false);
                        }}
                        className="hover:bg-slate-50 cursor-pointer"
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-mono text-[11px] text-slate-400">
                            {c.contract_no}
                          </div>
                          <span
                            className={`inline-block mt-1 px-2 py-0.5 rounded-md border text-[11px] font-bold ${catMeta?.badgeClass}`}
                          >
                            {catMeta?.icon} {catMeta?.shortLabel}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-extrabold text-slate-900">
                            {c.title}
                          </div>
                          {c.book_title && (
                            <div className="text-[11px] text-brand font-semibold mt-0.5">
                              📚 대상 도서: {c.book_title}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-bold text-slate-800">
                            {c.counterparty_name}{" "}
                            <span className="text-slate-400 font-semibold">
                              ({c.counterparty_role})
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {c.target_type === "INTERNAL"
                              ? `내부 임직원 · ${c.department}`
                              : `외부 파트너 · ${CONTRACT_TAX_LABELS[c.tax_type]}`}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap font-bold text-slate-800">
                          {c.contract_amount > 0
                            ? `${c.contract_amount.toLocaleString("ko-KR")}원`
                            : "-"}
                          {c.royalty_rate !== null && c.royalty_rate !== undefined && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px]">
                              인세 {c.royalty_rate}%
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-600">
                          {c.start_date || "-"} ~ {c.end_date || "상시"}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {c.status === "SIGNED" ? (
                            <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-extrabold">
                              ✅ 전자서명 완료
                            </span>
                          ) : c.status === "SENT" ? (
                            <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-extrabold">
                              ✍️ 서명 대기중
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold">
                              회수·만료
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                              isMySignTurn
                                ? "bg-brand text-white"
                                : "border border-slate-200 text-slate-700 hover:bg-slate-100"
                            }`}
                          >
                            {isMySignTurn ? "전자서명하기" : "계약서 보기"}
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
      </div>

      {/* 새 전자계약 작성·발송 모달 */}
      {createOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  새 전자계약서 작성 및 서명 요청 발송
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  발송 즉시 회사(갑) 서명이 날인되며, 상대방(을) 전자서명 완료 시 최종 체결됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handleCreateContract}
              className="p-6 overflow-y-auto custom-scroll space-y-4 text-xs"
            >
              {/* 계약 양식 선택 */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(Object.keys(CONTRACT_CATEGORIES) as HqContractCategory[]).map(
                  (catKey) => {
                    const m = CONTRACT_CATEGORIES[catKey];
                    const active = category === catKey;
                    return (
                      <button
                        key={catKey}
                        type="button"
                        onClick={() => handleSelectCategory(catKey)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          active
                            ? "border-brand bg-blue-50/70 ring-2 ring-brand/20"
                            : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className="text-base">{m.icon}</div>
                        <div className="font-extrabold text-slate-800 mt-1">
                          {m.shortLabel}
                        </div>
                      </button>
                    );
                  }
                )}
              </div>

              {/* 대상 구분 (내부 구성원 vs 외부 저자·프리랜서) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    계약 대상 구분
                  </label>
                  <select
                    value={targetType}
                    onChange={(e) =>
                      setTargetType(e.target.value as HqContractTargetType)
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                  >
                    <option value="INTERNAL">내부 임직원 (구성원 연동)</option>
                    <option value="EXTERNAL">외부 저자 · 프리랜서 파트너</option>
                  </select>
                </div>

                {targetType === "INTERNAL" ? (
                  <div className="sm:col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">
                      본부 구성원 선택 (자동 정보 연동)
                    </label>
                    <select
                      value={targetMemberId}
                      onChange={(e) => handleSelectMember(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                    >
                      <option value="">구성원을 선택하세요</option>
                      {activeMembers.map((m) => (
                        <option key={m.instructor_id} value={m.instructor_id}>
                          {m.name} ({m.department} · {m.job_title} · {m.employee_no})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        저자 / 파트너 성명 (상호)
                      </label>
                      <input
                        required
                        value={counterpartyName}
                        onChange={(e) => setCounterpartyName(e.target.value)}
                        placeholder="예: 홍길동 작가 / 스튜디오 봄"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        과업 역할 / 직책
                      </label>
                      <input
                        value={counterpartyRole}
                        onChange={(e) => setCounterpartyRole(e.target.value)}
                        placeholder="예: 대표저자 / 내지 조판 / 표지 일러스트"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* 연락처 / 대상 도서 / 세무 구분 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    연락처
                  </label>
                  <input
                    value={counterpartyPhone}
                    onChange={(e) => setCounterpartyPhone(e.target.value)}
                    placeholder="010-0000-0000"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    대상 도서명 / 시리즈 (출판 계약용)
                  </label>
                  <input
                    value={bookTitle}
                    onChange={(e) => setBookTitle(e.target.value)}
                    placeholder="예: 사고력 수학 노크 C단계 개정판"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    소득 · 세무 구분
                  </label>
                  <select
                    value={taxType}
                    onChange={(e) =>
                      setTaxType(e.target.value as HqContractTaxType)
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                  >
                    {Object.entries(CONTRACT_TAX_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 기간 · 금액 · 인세율 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    계약 시작일 (인도기한)
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    종료일 (미지정 시 상시)
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {category === "LABOR" || category === "SALARY"
                      ? "연봉 총액 (원)"
                      : category === "ROYALTY"
                      ? "선인세 / 계약금 (원)"
                      : "계약 대금 (원)"}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={contractAmount}
                    onChange={(e) => setContractAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-extrabold text-brand"
                  />
                </div>
                {category === "ROYALTY" && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      약정 인세율 (%)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="50"
                      value={royaltyRate}
                      onChange={(e) => setRoyaltyRate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-extrabold text-emerald-700"
                    />
                  </div>
                )}
              </div>

              {/* 계약서 제목 + 표준 본문 자동 갱신 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">계약서 제목</label>
                  <button
                    type="button"
                    onClick={() =>
                      regenerateTemplate(
                        category,
                        counterpartyName,
                        counterpartyRole,
                        department,
                        bookTitle,
                        startDate,
                        endDate,
                        Number(contractAmount || 0),
                        category === "ROYALTY" ? Number(royaltyRate || 10) : null
                      )
                    }
                    className="text-brand font-extrabold hover:underline"
                  >
                    🔄 입력한 금액·도서명으로 조항 다시 채우기
                  </button>
                </div>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-extrabold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  계약 본문 조항 (자유 편집 가능)
                </label>
                <textarea
                  rows={10}
                  required
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  className="w-full p-3.5 rounded-xl border border-slate-300 font-medium leading-relaxed text-slate-800"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  특약 사항 (선택)
                </label>
                <input
                  value={specialTerms}
                  onChange={(e) => setSpecialTerms(e.target.value)}
                  placeholder="예: 초판 2,000부 기준 선인세 지급 후 추가 쇄부터 판매부수 인세 정산"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white font-extrabold shadow-sm disabled:opacity-50"
                >
                  {saving ? "발송 중..." : "✍️ 회사 직인 날인 후 서명 요청 발송"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 계약서 열람 · 전자서명 · A4 인쇄 모달 */}
      {selected && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto print:static print:bg-white print:p-0">
          <div className="bg-white rounded-2xl max-w-3xl w-full my-auto shadow-2xl border border-slate-200 overflow-hidden print:shadow-none print:border-none print:rounded-none print:max-w-none">
            {/* 상단 컨트롤 바 (인쇄 시 숨김) */}
            <div className="px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2 print:hidden">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-400">
                  {selected.contract_no}
                </span>
                <span className="text-sm font-extrabold">{selected.title}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-bold"
                >
                  🖨️ A4 인쇄 / PDF 저장
                </button>
                {selected.status === "SENT" && isHrManager && (
                  <button
                    type="button"
                    onClick={() => handleCancelContract(selected.contract_id)}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-bold"
                  >
                    계약 회수
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="px-2.5 py-1 rounded-lg hover:bg-white/10 text-sm font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* A4 계약서 본문 시트 */}
            <div className="p-8 sm:p-10 space-y-6 text-slate-900 max-h-[82vh] overflow-y-auto custom-scroll print:max-h-none print:overflow-visible">
              <div className="text-center border-b-2 border-slate-900 pb-5">
                <div className="text-xs font-bold text-slate-500 tracking-widest">
                  전자계약 문서번호 {selected.contract_no}
                </div>
                <h1 className="text-2xl font-black mt-1.5">
                  {CONTRACT_CATEGORIES[selected.category]?.label || selected.title}
                </h1>
                {selected.book_title && (
                  <p className="text-sm font-bold text-slate-700 mt-1">
                    대상 저작물(프로젝트): 「{selected.book_title}」
                  </p>
                )}
              </div>

              {/* 계약 요약 표 */}
              <table className="w-full text-xs border border-slate-300 border-collapse">
                <tbody>
                  <tr className="border-b border-slate-300">
                    <th className="w-28 bg-slate-50 py-2.5 px-3 text-left font-bold border-r border-slate-300">
                      갑 (발행처·사용자)
                    </th>
                    <td className="py-2.5 px-3 font-bold border-r border-slate-300">
                      천종현수학연구소
                    </td>
                    <th className="w-28 bg-slate-50 py-2.5 px-3 text-left font-bold border-r border-slate-300">
                      을 (계약상대방)
                    </th>
                    <td className="py-2.5 px-3 font-bold">
                      {selected.counterparty_name} ({selected.counterparty_role})
                    </td>
                  </tr>
                  <tr className="border-b border-slate-300">
                    <th className="bg-slate-50 py-2.5 px-3 text-left font-bold border-r border-slate-300">
                      계약 기간
                    </th>
                    <td className="py-2.5 px-3 border-r border-slate-300">
                      {selected.start_date || "-"} ~{" "}
                      {selected.end_date || "기간의 정함이 없음"}
                    </td>
                    <th className="bg-slate-50 py-2.5 px-3 text-left font-bold border-r border-slate-300">
                      계약금액 / 세무
                    </th>
                    <td className="py-2.5 px-3 font-bold">
                      {selected.contract_amount > 0
                        ? `${selected.contract_amount.toLocaleString("ko-KR")}원`
                        : "해당없음"}
                      {selected.royalty_rate
                        ? ` (인세 ${selected.royalty_rate}%)`
                        : ""}{" "}
                      · {CONTRACT_TAX_LABELS[selected.tax_type]}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* 조항 전문 */}
              <div className="whitespace-pre-wrap text-[13px] leading-7 text-slate-800 border border-slate-200 rounded-xl p-5 bg-slate-50/40 print:bg-white">
                {selected.body_text}
                {selected.special_terms && (
                  <div className="mt-4 pt-4 border-t border-slate-200 font-semibold">
                    [특약 사항]{"\n"}
                    {selected.special_terms}
                  </div>
                )}
              </div>

              <p className="text-xs text-center text-slate-600 font-semibold">
                위 계약 내용에 상호 이의가 없음을 확인하고 전자서명하여 각 1부씩 전자 보관한다.
              </p>

              {/* 갑 / 을 전자서명 란 */}
              <div className="grid grid-cols-2 gap-5 pt-2">
                <div className="border border-slate-300 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-slate-500">
                      갑 (회사)
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 mt-1">
                      {selected.company_signer_name}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      서명일시:{" "}
                      {selected.company_signed_at?.slice(0, 10) || "-"}
                    </div>
                  </div>
                  <div className="w-16 h-16 rounded-full border-2 border-rose-600 text-rose-600 flex flex-col items-center justify-center font-black text-[11px] leading-tight rotate-[-6deg] shrink-0">
                    <span>천종현수학</span>
                    <span>연구소인</span>
                  </div>
                </div>

                <div className="border border-slate-300 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-slate-500">
                      을 (서명자)
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 mt-1">
                      {selected.counterparty_name}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {selected.status === "SIGNED"
                        ? `체결일시: ${selected.party_signed_at
                            ?.replace("T", " ")
                            .slice(0, 16)}`
                        : "전자서명 대기중"}
                    </div>
                  </div>
                  {selected.party_signature_data ? (
                    <img
                      src={selected.party_signature_data}
                      alt="전자서명"
                      className="h-16 max-w-[140px] object-contain border border-slate-200 rounded bg-white px-2"
                    />
                  ) : (
                    <div className="px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold">
                      미서명
                    </div>
                  )}
                </div>
              </div>

              {/* 서명 대기 상태일 때 전자서명 캔버스 노출 */}
              {selected.status === "SENT" &&
                (selected.target_member_id === me?.instructor_id ||
                  isHrManager ||
                  (selected.target_type === "EXTERNAL" && canCreateContract)) && (
                  <div className="mt-4 p-5 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-3 print:hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-extrabold text-slate-900">
                          ✍️ 을({selected.counterparty_name}) 자필 전자서명 패드
                        </h4>
                        <p className="text-xs text-slate-600">
                          마우스나 터치로 아래 흰색 영역에 서명한 뒤 [서명 완료 및 계약 체결]을 눌러주세요.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            stampNameSeal(selected.counterparty_name)
                          }
                          className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          성명 서명 자동생성
                        </button>
                        <button
                          type="button"
                          onClick={clearSignature}
                          className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-50"
                        >
                          지우기
                        </button>
                      </div>
                    </div>

                    <canvas
                      ref={canvasRef}
                      width={560}
                      height={150}
                      onMouseDown={startDraw}
                      onMouseMove={moveDraw}
                      onMouseUp={endDraw}
                      onMouseLeave={endDraw}
                      onTouchStart={startDraw}
                      onTouchMove={moveDraw}
                      onTouchEnd={endDraw}
                      className="w-full h-36 bg-white rounded-xl border-2 border-dashed border-blue-300 cursor-crosshair touch-none"
                    />

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={handleSignSubmit}
                        className="px-6 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold shadow-sm disabled:opacity-50"
                      >
                        {saving ? "체결 처리중..." : "✅ 서명 완료 및 계약 체결"}
                      </button>
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
