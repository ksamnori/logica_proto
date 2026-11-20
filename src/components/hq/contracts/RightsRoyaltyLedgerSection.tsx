// src/components/hq/contracts/RightsRoyaltyLedgerSection.tsx
// 저작권(출판권) 관리대장 + 저자 인세 정산 원장
//  · 계약(hq_contract) ↔ 도서(hq_publication) ↔ 지급(hq_payroll, pay_type=ROYALTY) 를 하나로 연결
//  · 발행부수 기준: 쇄 이력 중 미정산 쇄를 자동 표시 / 판매부수 기준: 기간 판매부수 입력
//  · 선인세는 발생 인세에서 누적 상계, 원천세(3.3% / 8.8%)는 계약 세무구분을 따름
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CONTRACT_TAX_LABELS } from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import {
  calcWithholding,
  computeRightsExpiry,
  computeRoyaltySettlement,
  contractMatchesBook,
  formatEditionLabel,
  getPrintHistory,
  isInHouseAuthor,
  RIGHTS_SCOPE_LABELS,
  ROYALTY_BASIS_LABELS,
  SETTLE_CYCLE_LABELS,
  stageIndex,
  withRightsDefaults,
  type RoyaltyLedgerMeta,
  type WithholdingMode,
} from "@/lib/hq/publishingRights";
import type {
  HqContract,
  HqPayrollRecord,
  HqPrintRunItem,
  HqPublication,
  HqRoyaltyBasis,
} from "@/lib/hq/types";

interface Props {
  contracts: HqContract[];
  publications: HqPublication[];
  isHrManager: boolean;
  canManage: boolean;
  companyName: string;
  extSchemaMissing: boolean;
  focusContractId?: string;
  onOpenContract: (c: HqContract) => void;
  onCreateRoyaltyContract: (pub?: HqPublication) => void;
  onReloadContracts: () => Promise<void> | void;
}

type SubTab = "RIGHTS" | "ROYALTY";

const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
const currentYm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function taxModeOf(c: HqContract): WithholdingMode {
  return c.tax_type === "OTHER_88" ? "OTHER_88" : "BIZ_33";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;"
  );
}

export default function RightsRoyaltyLedgerSection({
  contracts,
  publications,
  isHrManager,
  canManage,
  companyName,
  extSchemaMissing,
  focusContractId,
  onOpenContract,
  onCreateRoyaltyContract,
  onReloadContracts,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>(focusContractId ? "ROYALTY" : "RIGHTS");
  const [keyword, setKeyword] = useState("");
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [royaltyRows, setRoyaltyRows] = useState<HqPayrollRecord[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [expandedId, setExpandedId] = useState<string>(focusContractId || "");
  const [linkingId, setLinkingId] = useState<string>("");

  // 정산서 작성 모달
  const [settleTarget, setSettleTarget] = useState<HqContract | null>(null);
  const [settleKind, setSettleKind] = useState<"SETTLEMENT" | "ADVANCE">("SETTLEMENT");
  const [payMonth, setPayMonth] = useState(currentYm());
  const [periodLabel, setPeriodLabel] = useState("");
  const [basis, setBasis] = useState<HqRoyaltyBasis>("PRINT");
  const [printingId, setPrintingId] = useState("");
  const [copies, setCopies] = useState("0");
  const [freeCopies, setFreeCopies] = useState("0");
  const [listPrice, setListPrice] = useState("0");
  const [ratePct, setRatePct] = useState("10");
  const [taxMode, setTaxMode] = useState<WithholdingMode>("BIZ_33");
  const [bankInfo, setBankInfo] = useState("");
  const [residentOrBizNo, setResidentOrBizNo] = useState("");
  const [settleMemo, setSettleMemo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (focusContractId) {
      setSubTab("ROYALTY");
      setExpandedId(focusContractId);
    }
  }, [focusContractId]);

  const loadRoyaltyRows = useCallback(async () => {
    if (!isHrManager) return;
    setLoadingRows(true);
    try {
      const res = await hqFetch<{ success: boolean; data: { records: HqPayrollRecord[] } }>(
        "/api/hq/payroll?month=ALL"
      );
      setRoyaltyRows((res.data?.records || []).filter((r) => r.pay_type === "ROYALTY"));
    } catch {
      // ignore
    } finally {
      setLoadingRows(false);
    }
  }, [isHrManager]);

  useEffect(() => {
    loadRoyaltyRows();
  }, [loadRoyaltyRows]);

  const pubById = useMemo(() => {
    const m = new Map<string, HqPublication>();
    publications.forEach((p) => m.set(p.pub_id, p));
    return m;
  }, [publications]);

  const resolveBook = useCallback(
    (c: HqContract): HqPublication | null => {
      if (c.pub_id && pubById.has(c.pub_id)) return pubById.get(c.pub_id) || null;
      return publications.find((p) => contractMatchesBook({ pub_id: null, book_title: c.book_title }, p)) || null;
    },
    [pubById, publications]
  );

  const rightsContracts = useMemo(
    () =>
      contracts.filter(
        (c) =>
          (c.category === "ROYALTY" || c.category === "OUTSOURCING") &&
          (c.status === "SIGNED" || c.status === "SENT")
      ),
    [contracts]
  );

  const rightsRows = useMemo(() => {
    return rightsContracts.map((c) => {
      const book = resolveBook(c);
      const expiry = computeRightsExpiry(c, book);
      const alert =
        c.status === "SENT"
          ? "서명 대기"
          : expiry.daysLeft !== null && expiry.daysLeft <= 90
          ? expiry.daysLeft < 0
            ? `만료 ${Math.abs(expiry.daysLeft)}일 경과`
            : `만료 D-${expiry.daysLeft}`
          : "";
      return { c, book, expiry, alert };
    });
  }, [rightsContracts, resolveBook]);

  // 외부 저자 도서인데 체결된 출판권 계약이 없는 도서 (편집 단계 이후)
  const booksMissingContract = useMemo(
    () =>
      publications.filter((p) => {
        if (isInHouseAuthor(p.author_name)) return false;
        if (stageIndex(p.stage) < stageIndex("EDITING")) return false;
        return !contracts.some(
          (c) => c.category === "ROYALTY" && c.status === "SIGNED" && contractMatchesBook(c, p)
        );
      }),
    [publications, contracts]
  );

  const filteredRightsRows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return rightsRows.filter((r) => {
      if (onlyAlerts && !r.alert) return false;
      if (!q) return true;
      return `${r.c.counterparty_name} ${r.c.book_title || ""} ${r.book?.title || ""} ${r.c.contract_no}`
        .toLowerCase()
        .includes(q);
    });
  }, [rightsRows, keyword, onlyAlerts]);

  // 도서별 공동저자(복수 출판권 계약) 수 및 합산 인세율 집계
  const coAuthorStatsByBookKey = useMemo(() => {
    const map = new Map<string, { count: number; totalRate: number }>();
    rightsRows.forEach(({ c, book }) => {
      if (c.category !== "ROYALTY") return;
      const key = book?.pub_id || (c.book_title || "").replace(/\s+/g, "");
      if (!key) return;
      const cur = map.get(key) || { count: 0, totalRate: 0 };
      cur.count += 1;
      cur.totalRate += Number(c.royalty_rate || 0);
      map.set(key, cur);
    });
    return map;
  }, [rightsRows]);

  // ── 인세 원장 ──
  const royaltyLedger = useMemo(() => {
    const norm = (s?: string | null) => String(s || "").replace(/\s+/g, "").toLowerCase();
    return contracts
      .filter((c) => c.category === "ROYALTY" && c.status === "SIGNED")
      .map((c) => {
        const r = withRightsDefaults(c.rights_meta);
        const book = resolveBook(c);
        const targetBookNorm = norm(book?.title || c.book_title);
        const rows = royaltyRows
          .filter((p) => {
            const m = (p.calc_meta || {}) as RoyaltyLedgerMeta;
            if (m.contract_id) return m.contract_id === c.contract_id;
            // /hq/payroll 에서 계약 미지정으로 등록된 기존 인세 내역도 저자명+도서명이 일치하면 통합 표시
            if (norm(p.payee_name) !== norm(c.counterparty_name)) return false;
            const pBook = norm(p.book_or_project);
            return Boolean(targetBookNorm && pBook && (pBook.includes(targetBookNorm) || targetBookNorm.includes(pBook)));
          })
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const advanceRows = rows.filter((p) => (p.calc_meta as RoyaltyLedgerMeta)?.royalty_kind === "ADVANCE");
        const settleRows = rows.filter((p) => (p.calc_meta as RoyaltyLedgerMeta)?.royalty_kind !== "ADVANCE");
        const recouped = settleRows.reduce((acc, p) => {
          const m = (p.calc_meta || {}) as RoyaltyLedgerMeta;
          return acc + Number(m.advance_recouped ?? m.advanceDeduct ?? 0);
        }, 0);
        const grossRoyaltyTotal = settleRows.reduce((acc, p) => {
          const m = (p.calc_meta || {}) as RoyaltyLedgerMeta;
          const fallbackGross =
            Number(p.gross_amount || 0) + Number(m.advance_recouped ?? m.advanceDeduct ?? 0);
          return acc + Number(m.gross_royalty ?? fallbackGross);
        }, 0);
        const paidNet = rows.reduce((acc, p) => acc + Number(p.net_amount || 0), 0);
        const settledPrintIds = new Set(
          settleRows.map((p) => String((p.calc_meta as any).printing_id || "")).filter(Boolean)
        );
        const history = book ? getPrintHistory(book) : [];
        const unsettledPrints =
          r.deal_type === "FLAT_FEE" || r.royalty_basis !== "PRINT"
            ? []
            : history.filter((h) => !settledPrintIds.has(h.id));
        return {
          c,
          r,
          book,
          rows,
          advanceRows,
          settleRows,
          recouped,
          advanceRemaining: Math.max(0, Number(c.contract_amount || 0) - recouped),
          grossRoyaltyTotal,
          paidNet,
          unsettledPrints,
          advanceUnpaid: Number(c.contract_amount || 0) > 0 && advanceRows.length === 0,
        };
      });
  }, [contracts, royaltyRows, resolveBook]);

  const royaltyTodoCount = royaltyLedger.filter(
    (l) => l.unsettledPrints.length > 0 || l.advanceUnpaid
  ).length;

  // ── 정산 모달 ──
  const ledgerOfTarget = settleTarget
    ? royaltyLedger.find((l) => l.c.contract_id === settleTarget.contract_id) || null
    : null;

  const openSettle = (c: HqContract, kind: "SETTLEMENT" | "ADVANCE") => {
    const led = royaltyLedger.find((l) => l.c.contract_id === c.contract_id);
    const r = withRightsDefaults(c.rights_meta);
    const book = led?.book || null;
    setSettleTarget(c);
    setSettleKind(kind);
    setPayMonth(currentYm());
    setBasis(r.royalty_basis);
    setRatePct(String(c.royalty_rate ?? 10));
    setListPrice(String(book?.list_price || 0));
    setTaxMode(taxModeOf(c));
    const prevRow = [...royaltyRows]
      .reverse()
      .find((p) => p.payee_name.trim() === c.counterparty_name.trim());
    setBankInfo(prevRow?.bank_info || "");
    setResidentOrBizNo(prevRow?.calc_meta?.resident_or_biz_no || "");
    setSettleMemo("");
    const firstUnsettled = led?.unsettledPrints[0];
    const isFirstSettlement = (led?.settleRows.length || 0) === 0;
    if (kind === "ADVANCE") {
      setPeriodLabel("선인세(계약금)");
      setCopies("0");
      setFreeCopies("0");
      setPrintingId("");
    } else if (r.royalty_basis === "PRINT" && firstUnsettled) {
      setPrintingId(firstUnsettled.id);
      setCopies(String(firstUnsettled.copies));
      setPeriodLabel(`${formatEditionLabel(firstUnsettled.edition_no, firstUnsettled.printing_no)} 발행분`);
      setFreeCopies(String(isFirstSettlement ? r.royalty_free_copies : 0));
    } else {
      setPrintingId("");
      setCopies("0");
      const d = new Date();
      const q = Math.floor(d.getMonth() / 3) || 4;
      const y = q === 4 && d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
      setPeriodLabel(
        r.settle_cycle === "YEARLY"
          ? `${d.getFullYear() - 1}년 판매분`
          : r.settle_cycle === "HALF"
          ? `${d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear()}년 ${d.getMonth() < 6 ? "하반기" : "상반기"} 판매분`
          : `${y}년 ${q}분기 판매분`
      );
      setFreeCopies(String(isFirstSettlement ? r.royalty_free_copies : 0));
    }
  };

  const calc = useMemo(() => {
    if (!settleTarget) return null;
    if (settleKind === "ADVANCE") {
      const gross = Number(settleTarget.contract_amount || 0);
      const wh = calcWithholding(gross, taxMode);
      return { gross, payable: gross, recoupNow: 0, royaltyCopies: 0, remainingAfter: gross, wh };
    }
    const res = computeRoyaltySettlement({
      listPrice: Number(listPrice || 0),
      copies: Number(copies || 0),
      freeCopies: Number(freeCopies || 0),
      ratePct: Number(ratePct || 0),
      advanceTotal: Number(settleTarget.contract_amount || 0),
      advanceRecoupedSoFar: ledgerOfTarget?.recouped || 0,
    });
    const wh = calcWithholding(res.payable, taxMode);
    return {
      gross: res.grossRoyalty,
      payable: res.payable,
      recoupNow: res.recoupNow,
      royaltyCopies: res.royaltyCopies,
      remainingAfter: res.advanceRemainingAfter,
      wh,
    };
  }, [settleTarget, settleKind, listPrice, copies, freeCopies, ratePct, taxMode, ledgerOfTarget]);

  const submitSettle = async () => {
    if (!settleTarget || !calc) return;
    if (settleKind === "SETTLEMENT" && Number(copies || 0) <= 0) {
      alert("정산 대상 부수를 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const book = ledgerOfTarget?.book || null;
      const printing = book ? getPrintHistory(book).find((h) => h.id === printingId) : undefined;
      const meta: RoyaltyLedgerMeta & Record<string, unknown> = {
        royalty_kind: settleKind,
        contract_id: settleTarget.contract_id,
        pub_id: book?.pub_id || settleTarget.pub_id || null,
        period_label: periodLabel,
        royalty_tax_mode: taxMode,
      };
      if (settleKind === "SETTLEMENT") {
        Object.assign(meta, {
          basis,
          printing_id: printing?.id || undefined,
          printing_label: printing ? formatEditionLabel(printing.edition_no, printing.printing_no) : undefined,
          copies: Number(copies || 0),
          free_copies: Number(freeCopies || 0),
          royalty_copies: calc.royaltyCopies,
          bookPrice: Number(listPrice || 0),
          salesCopies: calc.royaltyCopies,
          royaltyPct: Number(ratePct || 0),
          gross_royalty: calc.gross,
          advance_recouped: calc.recoupNow,
          advanceDeduct: calc.recoupNow,
          advance_remaining_after: calc.remainingAfter,
          isbn: book?.isbn || undefined,
        });
      }
      await hqFetch("/api/hq/payroll", {
        method: "POST",
        body: {
          action: "CREATE_SINGLE",
          pay_month: payMonth,
          pay_type: "ROYALTY",
          payee_name: settleTarget.counterparty_name,
          department_or_role: `저자 인세 · ${settleTarget.counterparty_role || "저작권자"}`,
          resident_or_biz_no: residentOrBizNo,
          bank_info: bankInfo,
          book_or_project: book?.title || settleTarget.book_title || "",
          base_pay: calc.payable,
          meal_allowance: 0,
          overtime_pay: 0,
          bonus_pay: 0,
          calc_meta: meta,
          status: "CONFIRMED",
          pay_date: `${payMonth}-25`,
          memo:
            settleMemo ||
            `${periodLabel} · 계약 ${settleTarget.contract_no}${
              settleKind === "SETTLEMENT" && calc.recoupNow > 0
                ? ` · 선인세 상계 ${calc.recoupNow.toLocaleString("ko-KR")}원`
                : ""
            }`,
        },
      });
      setSettleTarget(null);
      await loadRoyaltyRows();
      alert(
        `${settleTarget.counterparty_name} 님 ${periodLabel} ${
          settleKind === "ADVANCE" ? "선인세" : "인세"
        } 정산이 ${payMonth} 귀속 지급대장에 등록되었습니다.\n(급여·인세·원천세 메뉴의 세무사 전달 자료와 원천세 신고 대상에 자동 포함)`
      );
    } catch (e: any) {
      alert(e?.message || "정산 등록 실패");
    } finally {
      setSaving(false);
    }
  };

  const printStatement = (row: HqPayrollRecord, c: HqContract) => {
    const m = (row.calc_meta || {}) as RoyaltyLedgerMeta & Record<string, any>;
    const isAdvance = m.royalty_kind === "ADVANCE";
    const line = (k: string, v: string) =>
      `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>인세 정산서 ${escapeHtml(
      row.statement_no
    )}</title><style>
      body{font-family:'Malgun Gothic',sans-serif;padding:40px;color:#0f172a}
      h1{text-align:center;font-size:22px;margin:0 0 4px}
      .sub{text-align:center;color:#64748b;font-size:12px;margin-bottom:24px}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px}
      th,td{border:1px solid #cbd5e1;padding:8px 10px;text-align:left}
      th{background:#f8fafc;width:34%}
      .total td{font-weight:800;font-size:15px}
      .foot{font-size:11px;color:#64748b;line-height:1.7}
    </style></head><body>
      <h1>${isAdvance ? "선인세 지급 명세서" : "저작권 사용료(인세) 정산서"}</h1>
      <div class="sub">${escapeHtml(companyName)} · 명세번호 ${escapeHtml(row.statement_no)} · 귀속 ${escapeHtml(
      row.pay_month
    )}</div>
      <table>
        ${line("저작권자", `${c.counterparty_name} (${c.counterparty_role || "저자"})`)}
        ${line("대상 도서", `${row.book_or_project || c.book_title || "-"}${m.isbn ? ` · ISBN ${m.isbn}` : ""}`)}
        ${line("계약번호", `${c.contract_no} · 인세율 ${c.royalty_rate ?? "-"}%`)}
        ${line("정산 구분", String(m.period_label || "-"))}
      </table>
      ${
        isAdvance
          ? ""
          : `<table>
        ${line("산정 기준", m.basis ? ROYALTY_BASIS_LABELS[m.basis as HqRoyaltyBasis] : "-")}
        ${line("대상 부수", `${Number(m.copies || 0).toLocaleString("ko-KR")}부${m.printing_label ? ` (${m.printing_label})` : ""}`)}
        ${line("인세 면제 부수(증정·홍보)", `${Number(m.free_copies || 0).toLocaleString("ko-KR")}부`)}
        ${line("인세 대상 부수", `${Number(m.royalty_copies || 0).toLocaleString("ko-KR")}부`)}
        ${line("정가 × 인세율", `${won(Number(m.bookPrice || 0))} × ${m.royaltyPct ?? "-"}%`)}
        ${line("발생 인세", won(Number(m.gross_royalty || 0)))}
        ${line("선인세 상계", `- ${won(Number(m.advance_recouped || 0))} (상계 후 선인세 잔액 ${won(Number(m.advance_remaining_after || 0))})`)}
      </table>`
      }
      <table>
        ${line("지급 대상액(세전)", won(row.gross_amount))}
        ${
          m.royalty_tax_mode === "OTHER_88"
            ? line(
                "기타소득 과세표준(필요경비 60% 공제)",
                `필요경비 ${won(Math.round(row.gross_amount * 0.6))} 공제 → 과세소득금액 ${won(
                  row.gross_amount - Math.round(row.gross_amount * 0.6)
                )}`
              )
            : ""
        }
        ${line("소득세", won(row.income_tax))}
        ${line("지방소득세", won(row.local_income_tax))}
        <tr class="total"><th>실지급액</th><td>${escapeHtml(won(row.net_amount))}</td></tr>
        ${line("지급 예정일", row.pay_date || "-")}
      </table>
      <div class="foot">
        · 원천징수 구분: ${escapeHtml(m.royalty_tax_mode === "OTHER_88" ? "기타소득 8.8%" : "사업소득 3.3%")} — 소득세법에 따라 원천징수 후 지급하며, 원천징수영수증은 요청 시 발급합니다.<br/>
        · 본 정산서의 부수·정가 근거 자료는 저작권자의 요청이 있을 경우 열람할 수 있습니다.
      </div>
      <script>window.onload=function(){window.print()}</script>
    </body></html>`;
    const w = window.open("", "_blank", "width=820,height=1000");
    if (!w) {
      alert("팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.");
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  const linkPublication = async (c: HqContract, pubId: string) => {
    setLinkingId(c.contract_id);
    try {
      await hqFetch("/api/hq/contracts", {
        method: "PATCH",
        body: { contract_id: c.contract_id, action: "LINK_PUBLICATION", pub_id: pubId || null },
      });
      await onReloadContracts();
    } catch (e: any) {
      alert(e?.message || "도서 연결 실패");
    } finally {
      setLinkingId("");
    }
  };

  const exportRightsCsv = () => {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "계약번호",
      "도서명",
      "ISBN",
      "저작권자/상대방",
      "계약유형",
      "설정 권리",
      "인세율/매절",
      "산정기준",
      "정산주기",
      "존속기간 만료일",
      "만료 산정근거",
      "상태",
    ];
    const lines = rightsRows.map(({ c, book, expiry }) => {
      const r = withRightsDefaults(c.rights_meta);
      return [
        c.contract_no,
        book?.title || c.book_title || "",
        book?.isbn || "",
        c.counterparty_name,
        c.category === "ROYALTY" ? "출판권 설정" : "외주(저작재산권 양도)",
        c.category === "ROYALTY"
          ? r.rights_scope.map((s) => RIGHTS_SCOPE_LABELS[s]).join(" / ")
          : RIGHTS_SCOPE_LABELS.COPYRIGHT_TRANSFER,
        c.category === "ROYALTY"
          ? r.deal_type === "FLAT_FEE"
            ? `매절 ${c.contract_amount}`
            : `${c.royalty_rate ?? ""}%`
          : `용역비 ${c.contract_amount}`,
        c.category === "ROYALTY" ? ROYALTY_BASIS_LABELS[r.royalty_basis] : "",
        c.category === "ROYALTY" ? SETTLE_CYCLE_LABELS[r.settle_cycle] : "",
        expiry.expiryDate || "",
        expiry.basis,
        c.status === "SIGNED" ? "체결" : "서명대기",
      ]
        .map(esc)
        .join(",");
    });
    const blob = new Blob(["\uFEFF" + [header.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `저작권관리대장_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const expiringCount = rightsRows.filter((r) => r.alert && r.c.status === "SIGNED").length;

  return (
    <div className="space-y-4">
      {extSchemaMissing && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
          ⚠️ 도서 연결 · 출판권 약정 조건 · 원격 서명 기능을 저장하려면 Supabase SQL Editor에서{" "}
          <code className="px-1 bg-white rounded">supabase/hq_patch_publishing_rights.sql</code>을 1회 실행해 주세요.
          (실행 전에도 기존 기능은 그대로 동작합니다)
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500">관리 중인 저작권 계약</div>
          <div className="text-2xl font-black text-slate-900 mt-1">{rightsRows.length}건</div>
          <div className="text-[11px] text-slate-400 mt-1">출판권 설정 + 외주 저작재산권 양도</div>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500">90일 내 존속기간 만료</div>
          <div className="text-2xl font-black text-rose-600 mt-1">{expiringCount}건</div>
          <div className="text-[11px] text-slate-400 mt-1">연장 협의·재계약 또는 절판 결정 필요</div>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500">계약 미체결 외부 저자 도서</div>
          <div className="text-2xl font-black text-amber-600 mt-1">{booksMissingContract.length}종</div>
          <div className="text-[11px] text-slate-400 mt-1">편집 단계 이후인데 출판권 계약 없음</div>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500">인세 정산 대기</div>
          <div className="text-2xl font-black text-emerald-700 mt-1">
            {isHrManager ? `${royaltyTodoCount}건` : "-"}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">미정산 쇄 발행 · 선인세 미지급 계약</div>
        </div>
      </div>

      {/* 서브 탭 */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-3 rounded-2xl border border-slate-200">
        <div className="flex gap-1.5">
          {(
            [
              ["RIGHTS", "📜 저작권 · 출판권 관리대장"],
              ["ROYALTY", `💰 저자 인세 정산 원장${isHrManager && royaltyTodoCount > 0 ? ` (${royaltyTodoCount})` : ""}`],
            ] as [SubTab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSubTab(k)}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold ${
                subTab === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="저자명 · 도서명 · 계약번호"
            className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold w-52"
          />
          {subTab === "RIGHTS" && (
            <>
              <label className="flex items-center gap-1 text-xs font-bold text-slate-600">
                <input type="checkbox" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} />
                조치 필요만
              </label>
              <button
                type="button"
                onClick={exportRightsCsv}
                className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-600"
              >
                ⤓ 관리대장 CSV
              </button>
            </>
          )}
        </div>
      </div>

      {subTab === "RIGHTS" && (
        <>
          {booksMissingContract.length > 0 && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
              <div className="text-xs font-extrabold text-amber-900">
                ⚠️ 외부 저자 원고인데 체결된 출판권 설정 계약이 없는 도서 — 인쇄(하판) 전 계약 체결 필수
              </div>
              <div className="flex flex-wrap gap-2">
                {booksMissingContract.map((p) => (
                  <div
                    key={p.pub_id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-amber-200 text-xs"
                  >
                    <span className="font-bold text-slate-800">{p.title}</span>
                    <span className="text-slate-500">({p.author_name})</span>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => onCreateRoyaltyContract(p)}
                        className="px-2 py-0.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold"
                      >
                        + 출판권 계약
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500">
                    <th className="py-3 px-4">도서 (공정 연결)</th>
                    <th className="py-3 px-4">저작권자 / 상대방</th>
                    <th className="py-3 px-4">설정 권리</th>
                    <th className="py-3 px-4">대가 조건</th>
                    <th className="py-3 px-4">존속기간 만료</th>
                    <th className="py-3 px-4 text-right">계약서</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRightsRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-14 text-center text-slate-400">
                        표시할 저작권 계약이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredRightsRows.map(({ c, book, expiry, alert }) => {
                      const r = withRightsDefaults(c.rights_meta);
                      const bookKey = book?.pub_id || (c.book_title || "").replace(/\s+/g, "");
                      const coInfo = bookKey ? coAuthorStatsByBookKey.get(bookKey) : undefined;
                      return (
                        <tr key={c.contract_id} className="hover:bg-slate-50/60 align-top">
                          <td className="py-3 px-4 min-w-[220px]">
                            <div className="font-extrabold text-slate-900">
                              {book?.title || c.book_title || "(도서 미지정)"}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {book
                                ? `${book.isbn || "ISBN 미발급"} · ${book.edition_info || ""}`
                                : "출판 공정 도서 미연결"}
                              {!c.pub_id && book && " · 제목 일치로 추정"}
                            </div>
                            {c.category === "ROYALTY" && coInfo && coInfo.count >= 2 && (
                              <div className="mt-1 inline-block px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold">
                                👥 공동저자 {coInfo.count}인 · 도서 합산 인세 {coInfo.totalRate}%
                              </div>
                            )}
                            {canManage && !extSchemaMissing && !c.pub_id && (
                              <select
                                disabled={linkingId === c.contract_id}
                                value=""
                                onChange={(e) => e.target.value && linkPublication(c, e.target.value)}
                                className="mt-1 px-2 py-1 rounded-lg border border-slate-300 text-[11px] bg-white"
                              >
                                <option value="">🔗 공정 도서와 연결...</option>
                                {publications.map((p) => (
                                  <option key={p.pub_id} value={p.pub_id}>
                                    {p.title}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-bold text-slate-800">{c.counterparty_name}</div>
                            <div className="text-[11px] text-slate-500">
                              {c.counterparty_role} · {CONTRACT_TAX_LABELS[c.tax_type]}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1 max-w-[260px]">
                              {(c.category === "ROYALTY" ? r.rights_scope : (["COPYRIGHT_TRANSFER"] as const)).map(
                                (s) => (
                                  <span
                                    key={s}
                                    className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold"
                                  >
                                    {RIGHTS_SCOPE_LABELS[s]}
                                  </span>
                                )
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {c.category === "ROYALTY" ? (
                              r.deal_type === "FLAT_FEE" ? (
                                <span className="font-bold text-slate-800">매절 {won(c.contract_amount)}</span>
                              ) : (
                                <>
                                  <div className="font-bold text-emerald-700">
                                    인세 {c.royalty_rate ?? "-"}%
                                    {r.co_author_share_pct < 100
                                      ? ` (지분 ${r.co_author_share_pct}%)`
                                      : ""}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {r.royalty_basis === "PRINT" ? "발행부수" : "판매부수"} ·{" "}
                                    {SETTLE_CYCLE_LABELS[r.settle_cycle]}
                                    {c.contract_amount > 0 && ` · 선인세 ${won(c.contract_amount)}`}
                                  </div>
                                </>
                              )
                            ) : (
                              <span className="font-bold text-slate-800">용역비 {won(c.contract_amount)}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-bold text-slate-800">{expiry.expiryDate || "-"}</div>
                            <div className="text-[11px] text-slate-500">{expiry.basis}</div>
                            {alert && (
                              <span
                                className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                  c.status === "SENT"
                                    ? "bg-amber-50 text-amber-800 border border-amber-200"
                                    : "bg-rose-50 text-rose-700 border border-rose-200"
                                }`}
                              >
                                {alert}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => onOpenContract(c)}
                              className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 font-bold text-slate-700"
                            >
                              보기
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

      {subTab === "ROYALTY" &&
        (!isHrManager ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center text-xs text-slate-500">
            인세 지급 원장은 경영지원(인사·재무 관리자)만 열람할 수 있습니다. 편집 담당자는 쇄 발행 정보를
            [출판 공정 · ISBN] 메뉴에 등록하면 경영지원에 정산 대기로 표시됩니다.
          </div>
        ) : (
          <section className="space-y-3">
            {loadingRows && <div className="text-xs text-slate-400 px-1">지급 원장을 불러오는 중...</div>}
            {royaltyLedger.length === 0 && !loadingRows && (
              <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center text-xs text-slate-400">
                체결 완료된 출판권(인세) 계약이 없습니다.
              </div>
            )}
            {royaltyLedger
              .filter((l) => {
                const q = keyword.trim().toLowerCase();
                if (!q) return true;
                return `${l.c.counterparty_name} ${l.book?.title || l.c.book_title || ""} ${l.c.contract_no}`
                  .toLowerCase()
                  .includes(q);
              })
              .map((l) => {
                const open = expandedId === l.c.contract_id;
                const isFlat = l.r.deal_type === "FLAT_FEE";
                return (
                  <div
                    key={l.c.contract_id}
                    className={`rounded-2xl bg-white border ${
                      focusContractId === l.c.contract_id ? "border-brand ring-2 ring-brand/20" : "border-slate-200"
                    } overflow-hidden`}
                  >
                    <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setExpandedId(open ? "" : l.c.contract_id)}
                        className="text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-slate-900 text-sm">
                            {l.book?.title || l.c.book_title || "(도서 미지정)"}
                          </span>
                          <span className="text-xs text-slate-500">· {l.c.counterparty_name}</span>
                          {l.unsettledPrints.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-extrabold">
                              미정산 쇄 {l.unsettledPrints.length}건
                            </span>
                          )}
                          {l.advanceUnpaid && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-extrabold">
                              선인세 미지급
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {isFlat
                            ? `매절 원고료 ${won(l.c.contract_amount)}`
                            : `인세 ${l.c.royalty_rate ?? "-"}% · ${ROYALTY_BASIS_LABELS[l.r.royalty_basis]} · ${
                                SETTLE_CYCLE_LABELS[l.r.settle_cycle]
                              }`}{" "}
                          · {l.c.tax_type === "OTHER_88" ? "기타소득 8.8%" : "사업소득 3.3%"}
                        </div>
                      </button>
                      <div className="flex flex-wrap items-center gap-4 text-xs">
                        {!isFlat && (
                          <>
                            <div className="text-right">
                              <div className="text-[10px] text-slate-400 font-bold">선인세 잔액</div>
                              <div className="font-extrabold text-amber-700">{won(l.advanceRemaining)}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] text-slate-400 font-bold">누적 발생 인세</div>
                              <div className="font-extrabold text-slate-800">{won(l.grossRoyaltyTotal)}</div>
                            </div>
                          </>
                        )}
                        <div className="text-right">
                          <div className="text-[10px] text-slate-400 font-bold">누적 실지급</div>
                          <div className="font-extrabold text-emerald-700">{won(l.paidNet)}</div>
                        </div>
                        <div className="flex gap-1.5">
                          {l.advanceUnpaid && (
                            <button
                              type="button"
                              onClick={() => openSettle(l.c, "ADVANCE")}
                              className="px-3 py-1.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold"
                            >
                              {isFlat ? "원고료 지급 등록" : "선인세 지급 등록"}
                            </button>
                          )}
                          {!isFlat && (
                            <button
                              type="button"
                              onClick={() => openSettle(l.c, "SETTLEMENT")}
                              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold"
                            >
                              인세 정산서 작성
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {open && (
                      <div className="border-t border-slate-100 bg-slate-50/50 p-4 space-y-3">
                        {l.r.royalty_basis === "PRINT" && !isFlat && (
                          <div className="text-[11px] text-slate-600">
                            <span className="font-bold">쇄 이력:</span>{" "}
                            {l.book && getPrintHistory(l.book).length > 0
                              ? getPrintHistory(l.book)
                                  .map(
                                    (h) =>
                                      `${formatEditionLabel(h.edition_no, h.printing_no)} ${h.print_date} ${h.copies.toLocaleString(
                                        "ko-KR"
                                      )}부${l.unsettledPrints.some((u) => u.id === h.id) ? "(미정산)" : ""}`
                                  )
                                  .join(" · ")
                              : "등록된 쇄 이력이 없습니다 (출판 공정 · ISBN 메뉴에서 [중쇄 등록] 또는 출간 처리 시 자동 생성)"}
                          </div>
                        )}
                        <table className="w-full text-xs border-collapse bg-white rounded-xl overflow-hidden">
                          <thead>
                            <tr className="bg-slate-100 text-[11px] text-slate-500 font-bold">
                              <th className="py-2 px-3 text-left">귀속월 / 구분</th>
                              <th className="py-2 px-3 text-right">대상부수</th>
                              <th className="py-2 px-3 text-right">발생 인세</th>
                              <th className="py-2 px-3 text-right">선인세 상계</th>
                              <th className="py-2 px-3 text-right">원천세</th>
                              <th className="py-2 px-3 text-right">실지급</th>
                              <th className="py-2 px-3 text-left">상태</th>
                              <th className="py-2 px-3 text-right">정산서</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {l.rows.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="py-6 text-center text-slate-400">
                                  아직 지급·정산 내역이 없습니다.
                                </td>
                              </tr>
                            ) : (
                              l.rows.map((p) => {
                                const m = p.calc_meta as RoyaltyLedgerMeta;
                                return (
                                  <tr key={p.payroll_id}>
                                    <td className="py-2 px-3">
                                      <div className="font-bold text-slate-800">{p.pay_month}</div>
                                      <div className="text-[11px] text-slate-500">{m.period_label || "-"}</div>
                                    </td>
                                    <td className="py-2 px-3 text-right tabular-nums">
                                      {m.royalty_kind === "ADVANCE" ? "-" : `${Number(m.royalty_copies || 0).toLocaleString("ko-KR")}부`}
                                    </td>
                                    <td className="py-2 px-3 text-right tabular-nums">
                                      {m.royalty_kind === "ADVANCE" ? `선인세 ${won(p.gross_amount)}` : won(Number(m.gross_royalty || 0))}
                                    </td>
                                    <td className="py-2 px-3 text-right tabular-nums text-amber-700">
                                      {m.advance_recouped ? `- ${won(m.advance_recouped)}` : "-"}
                                    </td>
                                    <td className="py-2 px-3 text-right tabular-nums text-rose-600">
                                      {won(p.income_tax + p.local_income_tax)}
                                    </td>
                                    <td className="py-2 px-3 text-right tabular-nums font-extrabold text-emerald-700">
                                      {won(p.net_amount)}
                                    </td>
                                    <td className="py-2 px-3">
                                      {p.status === "PAID" ? "이체완료" : p.status === "CONFIRMED" ? "지급확정" : "초안"}
                                    </td>
                                    <td className="py-2 px-3 text-right">
                                      <button
                                        type="button"
                                        onClick={() => printStatement(p, l.c)}
                                        className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 font-bold"
                                      >
                                        🖨️ 출력
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
          </section>
        ))}

      {/* 정산서 작성 모달 */}
      {settleTarget && calc && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  {settleKind === "ADVANCE" ? "선인세(계약금) 지급 등록" : "저자 인세 정산서 작성"}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {settleTarget.counterparty_name} · {ledgerOfTarget?.book?.title || settleTarget.book_title} ·{" "}
                  {settleTarget.contract_no}
                </p>
              </div>
              <button type="button" onClick={() => setSettleTarget(null)} className="text-lg font-bold text-slate-400">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">귀속월 (지급대장 반영)</label>
                <input
                  type="month"
                  value={payMonth}
                  onChange={(e) => setPayMonth(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">정산 구분 (정산서 표기)</label>
                <input
                  value={periodLabel}
                  onChange={(e) => setPeriodLabel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </div>
            </div>

            {settleKind === "SETTLEMENT" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">산정 기준</label>
                    <select
                      value={basis}
                      onChange={(e) => setBasis(e.target.value as HqRoyaltyBasis)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                    >
                      <option value="PRINT">발행부수 (쇄 단위)</option>
                      <option value="SALES">판매부수 (기간 마감)</option>
                    </select>
                  </div>
                  {basis === "PRINT" ? (
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">정산할 쇄</label>
                      <select
                        value={printingId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setPrintingId(id);
                          const h: HqPrintRunItem | undefined = ledgerOfTarget?.book
                            ? getPrintHistory(ledgerOfTarget.book).find((x) => x.id === id)
                            : undefined;
                          if (h) {
                            setCopies(String(h.copies));
                            setPeriodLabel(`${formatEditionLabel(h.edition_no, h.printing_no)} 발행분`);
                          }
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                      >
                        <option value="">직접 입력</option>
                        {(ledgerOfTarget?.book ? getPrintHistory(ledgerOfTarget.book) : []).map((h) => (
                          <option key={h.id} value={h.id}>
                            {formatEditionLabel(h.edition_no, h.printing_no)} · {h.print_date} ·{" "}
                            {h.copies.toLocaleString("ko-KR")}부
                            {ledgerOfTarget?.unsettledPrints.some((u) => u.id === h.id) ? " (미정산)" : " (정산됨)"}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 flex items-end">
                      총판·서점 판매 보고서(반품 차감 후)의 순판매부수를 입력하세요.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">대상 부수</label>
                    <input
                      type="number"
                      min={0}
                      value={copies}
                      onChange={(e) => setCopies(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">면제 부수</label>
                    <input
                      type="number"
                      min={0}
                      value={freeCopies}
                      onChange={(e) => setFreeCopies(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">정가</label>
                    <input
                      type="number"
                      min={0}
                      value={listPrice}
                      onChange={(e) => setListPrice(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">인세율 %</label>
                    <input
                      type="number"
                      step="0.5"
                      value={ratePct}
                      onChange={(e) => setRatePct(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">원천징수 구분</label>
                <select
                  value={taxMode}
                  onChange={(e) => setTaxMode(e.target.value as WithholdingMode)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                >
                  <option value="BIZ_33">사업소득 3.3%</option>
                  <option value="OTHER_88">기타소득 8.8%</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">주민/사업자번호 (신고용)</label>
                <input
                  value={residentOrBizNo}
                  onChange={(e) => setResidentOrBizNo(e.target.value)}
                  placeholder="850101-1****** / 사업자번호"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">지급 계좌 (선택)</label>
                <input
                  value={bankInfo}
                  onChange={(e) => setBankInfo(e.target.value)}
                  placeholder="은행 계좌번호 예금주"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
            </div>

            <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-3 space-y-1 tabular-nums">
              {settleKind === "SETTLEMENT" ? (
                <>
                  <div className="flex justify-between">
                    <span>
                      발생 인세 ({Number(listPrice || 0).toLocaleString("ko-KR")}원 × {calc.royaltyCopies.toLocaleString("ko-KR")}부 ×{" "}
                      {ratePct}%)
                    </span>
                    <strong>{won(calc.gross)}</strong>
                  </div>
                  <div className="flex justify-between text-amber-700">
                    <span>선인세 상계 (잔액 {won(ledgerOfTarget?.advanceRemaining || 0)} → {won(calc.remainingAfter)})</span>
                    <strong>- {won(calc.recoupNow)}</strong>
                  </div>
                </>
              ) : (
                <div className="flex justify-between">
                  <span>선인세(계약금)</span>
                  <strong>{won(calc.gross)}</strong>
                </div>
              )}
              <div className="flex justify-between">
                <span>지급 대상액 (세전)</span>
                <strong>{won(calc.payable)}</strong>
              </div>
              <div className="flex justify-between text-rose-600">
                <span>원천세 — {calc.wh.note}</span>
                <strong>- {won(calc.wh.total)}</strong>
              </div>
              <div className="flex justify-between text-sm pt-1 border-t border-emerald-200">
                <span className="font-extrabold">실지급액</span>
                <strong className="text-emerald-800">{won(calc.payable - calc.wh.total)}</strong>
              </div>
              {settleKind === "SETTLEMENT" && calc.payable === 0 && (
                <div className="text-[11px] text-amber-700 font-bold pt-1">
                  발생 인세 전액이 선인세로 상계되어 이번 지급액은 0원입니다. 정산 기록(정산서)은 저자 통보용으로 남겨두세요.
                </div>
              )}
            </div>

            <input
              value={settleMemo}
              onChange={(e) => setSettleMemo(e.target.value)}
              placeholder="메모 (비우면 정산 구분·계약번호·상계액 자동 기록)"
              className="w-full px-3 py-2 rounded-xl border border-slate-300"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSettleTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-slate-700"
              >
                취소
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={submitSettle}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold disabled:opacity-50"
              >
                {saving ? "등록 중..." : "지급대장에 등록"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
