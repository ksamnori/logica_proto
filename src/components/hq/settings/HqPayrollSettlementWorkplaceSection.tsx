// src/components/hq/settings/HqPayrollSettlementWorkplaceSection.tsx
"use client";

import React, { useState } from "react";
import {
  COMPANY_SIZE_TIERS,
  DEFAULT_PAYROLL_SETTINGS,
  DEFAULT_PAYSLIP_BASIS,
  DEFAULT_SEVERANCE_CALC,
  SEVERANCE_PRECISION_UNITS,
  TAX_OFFICES,
} from "@/lib/hq/defaultPayrollSettings";
import type {
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqPayrollCertificateItem,
  HqPayrollRoundingMode,
  HqPayrollSettings,
  HqPayrollTaxWorkplaceItem,
  HqPayslipBasisSettings,
  HqSeveranceCalcSettings,
  HqWithholdingAgentInfo,
} from "@/lib/hq/types";
import type { HqSettingsTab } from "./HqSettingsModal";

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/* ========================================================================= */
/* 공통 모달: 원천징수의무자 정보 (정산 설정 & 사업장 설정 공용 — 154606~154626) */
/* ========================================================================= */
function WithholdingAgentModal({
  initial,
  companySettings,
  canEdit,
  saving,
  onClose,
  onSave,
}: {
  initial: HqWithholdingAgentInfo;
  companySettings: HqCompanySettings;
  canEdit: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (next: HqWithholdingAgentInfo) => Promise<void>;
}) {
  const [draft, setDraft] = useState<HqWithholdingAgentInfo>({ ...initial });

  // 상단 우측 ↻ 버튼: [회사 정보]에서 기본값 자동 불러오기
  const handleSyncFromCompany = () => {
    setDraft((prev) => ({
      ...prev,
      business_reg_no:
        companySettings.business_reg_no || prev.business_reg_no || "",
      corp_name: companySettings.company_name || prev.corp_name || "",
      trade_name: companySettings.company_name || prev.trade_name || "",
      ceo_name: companySettings.ceo_names[0] || prev.ceo_name || "",
      owner_name: companySettings.ceo_names[0] || prev.owner_name || "",
      corp_reg_no: companySettings.corp_reg_no || prev.corp_reg_no || "",
      location_address: companySettings.address || prev.location_address || "",
    }));
  };

  const handleSubmit = async () => {
    if (!draft.business_reg_no.trim()) {
      alert("사업자 등록번호를 입력해주세요.");
      return;
    }
    if (draft.submitter_type === "법인" && !draft.corp_name.trim()) {
      alert("법인명을 입력해주세요.");
      return;
    }
    if (draft.submitter_type === "개인" && !draft.trade_name.trim()) {
      alert("상호를 입력해주세요.");
      return;
    }

    await onSave({
      ...draft,
      is_configured: true,
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/45 z-[80] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-[490px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
        <div className="flex items-center justify-end gap-2 shrink-0">
          {canEdit && (
            <button
              type="button"
              onClick={handleSyncFromCompany}
              title="[회사 정보] 데이터 불러오기"
              className="w-6 h-6 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center text-sm"
            >
              ↻
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-4">
          <div>
            <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
              원천징수의무자 정보
            </h3>
            <p className="text-slate-400 mt-1">
              홈택스 신고, 원천징수영수증 발급 등에 필요한 정보예요.
            </p>
          </div>

          {/* 제출자 구분 + 사업자 등록번호 */}
          <div className="grid grid-cols-12 gap-3 pt-1">
            <div className="col-span-5">
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                제출자 구분
              </label>
              <div className="grid grid-cols-2 p-0.5 rounded-xl bg-[#f5f6f8] border border-slate-200/70">
                {(["법인", "개인"] as const).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setDraft({ ...draft, submitter_type: tp })}
                    className={`py-2 rounded-lg font-bold transition-all ${
                      draft.submitter_type === tp
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-400"
                    }`}
                  >
                    {tp}
                  </button>
                ))}
              </div>
            </div>

            <div className="col-span-7">
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                사업자 등록번호<span className="text-rose-500">*</span>
              </label>
              <input
                disabled={!canEdit}
                value={draft.business_reg_no}
                onChange={(e) =>
                  setDraft({ ...draft, business_reg_no: e.target.value })
                }
                placeholder="000-00-00000"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {draft.submitter_type === "법인" ? (
            <>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                  법인명<span className="text-rose-500">*</span>
                </label>
                <input
                  disabled={!canEdit}
                  value={draft.corp_name}
                  onChange={(e) =>
                    setDraft({ ...draft, corp_name: e.target.value })
                  }
                  placeholder="(주)천종현수학연구소"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                  법인 종류<span className="text-rose-500">*</span>
                </label>
                <select
                  disabled={!canEdit}
                  value={draft.corp_type}
                  onChange={(e) =>
                    setDraft({ ...draft, corp_type: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                >
                  <option value="">법인 종류 선택</option>
                  <option value="내국영리법인">내국영리법인</option>
                  <option value="비영리법인">비영리법인</option>
                  <option value="외국법인">외국법인</option>
                  <option value="국가·지방자치단체">국가·지방자치단체</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    대표자<span className="text-rose-500">*</span>
                  </label>
                  <input
                    disabled={!canEdit}
                    value={draft.ceo_name}
                    onChange={(e) =>
                      setDraft({ ...draft, ceo_name: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    법인등록번호<span className="text-rose-500">*</span>
                  </label>
                  <input
                    disabled={!canEdit}
                    value={draft.corp_reg_no}
                    onChange={(e) =>
                      setDraft({ ...draft, corp_reg_no: e.target.value })
                    }
                    placeholder="000000-0000000"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                  상호<span className="text-rose-500">*</span>
                </label>
                <input
                  disabled={!canEdit}
                  value={draft.trade_name}
                  onChange={(e) =>
                    setDraft({ ...draft, trade_name: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    성명<span className="text-rose-500">*</span>
                  </label>
                  <input
                    disabled={!canEdit}
                    value={draft.owner_name}
                    onChange={(e) =>
                      setDraft({ ...draft, owner_name: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    주민등록번호<span className="text-rose-500">*</span>
                  </label>
                  <input
                    disabled={!canEdit}
                    value={draft.resident_reg_no}
                    onChange={(e) =>
                      setDraft({ ...draft, resident_reg_no: e.target.value })
                    }
                    placeholder="000000-0000000"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
                  />
                </div>
              </div>
            </>
          )}

          {/* 소재지 */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              소재지<span className="text-rose-500">*</span>
            </label>
            <input
              disabled={!canEdit}
              value={draft.location_address}
              onChange={(e) =>
                setDraft({ ...draft, location_address: e.target.value })
              }
              placeholder="소재지 주소 입력"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
            />
          </div>

          {/* 관할 세무서 */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              관할 세무서<span className="text-rose-500">*</span>
            </label>
            <select
              disabled={!canEdit}
              value={draft.tax_office}
              onChange={(e) =>
                setDraft({ ...draft, tax_office: e.target.value })
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
            >
              <option value="">세무서 선택</option>
              {TAX_OFFICES.map((to) => (
                <option key={to} value={to}>
                  {to}
                </option>
              ))}
            </select>
          </div>

          {/* 홈택스 ID */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              홈택스 ID
            </label>
            <input
              disabled={!canEdit}
              value={draft.hometax_id}
              onChange={(e) =>
                setDraft({ ...draft, hometax_id: e.target.value })
              }
              placeholder="홈택스 아이디 입력 (선택)"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
            />
          </div>

          {/* 영문 정보 & 사업자 단위 과세자 */}
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            <div className="py-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-slate-800">영문 정보</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    영문 연말정산 원천징수영수증 출력에 필요해요.
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      english_info_enabled: !draft.english_info_enabled,
                    })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    draft.english_info_enabled ? "bg-[#00c458]" : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                      draft.english_info_enabled
                        ? "translate-x-5"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {draft.english_info_enabled && (
                <div className="grid grid-cols-1 gap-2 pt-1">
                  <input
                    value={draft.english_corp_name || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, english_corp_name: e.target.value })
                    }
                    placeholder="영문 법인명 (Company Name)"
                    className="px-3 py-2 rounded-xl bg-[#f5f6f8] focus:outline-none"
                  />
                  <input
                    value={draft.english_ceo_name || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, english_ceo_name: e.target.value })
                    }
                    placeholder="영문 대표자명 (Representative)"
                    className="px-3 py-2 rounded-xl bg-[#f5f6f8] focus:outline-none"
                  />
                  <input
                    value={draft.english_address || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, english_address: e.target.value })
                    }
                    placeholder="영문 소재지 주소 (Address)"
                    className="px-3 py-2 rounded-xl bg-[#f5f6f8] focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="py-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-slate-800">
                    사업자 단위 과세자
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    해당 하는 경우, 종사업장 일련번호 입력이 필요해요.
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      unit_taxpayer_enabled: !draft.unit_taxpayer_enabled,
                    })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    draft.unit_taxpayer_enabled
                      ? "bg-[#00c458]"
                      : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                      draft.unit_taxpayer_enabled
                        ? "translate-x-5"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {draft.unit_taxpayer_enabled && (
                <input
                  value={draft.sub_business_seq_no || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, sub_business_seq_no: e.target.value })
                  }
                  placeholder="종사업장 일련번호 4자리 (예: 0001)"
                  className="w-full px-3.5 py-2 rounded-xl bg-[#f5f6f8] font-mono font-bold focus:outline-none"
                />
              )}
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="pt-5 shrink-0">
            <button
              type="button"
              disabled={saving}
              onClick={handleSubmit}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md"
            >
              {saving ? "저장 중..." : "저장하기"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ========================================================================= */
/* 3. 설정 > 급여·정산 > 정산 설정 (스크린샷 154602 ~ 154808)                 */
/* ========================================================================= */
interface SettlementSectionProps {
  settings: HqCompanySettings;
  canEdit: boolean;
  saving: boolean;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onNavigateTab: (tab: HqSettingsTab) => void;
}

export function HqPayrollSettlementSection({
  settings,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: SettlementSectionProps) {
  const ex = settings.extra_settings || {};
  const payroll: HqPayrollSettings = ex.payroll_settings
    ? {
        ...DEFAULT_PAYROLL_SETTINGS,
        ...ex.payroll_settings,
        withholding_agent: {
          ...DEFAULT_PAYROLL_SETTINGS.withholding_agent,
          ...(ex.payroll_settings.withholding_agent || {}),
        },
        severance_calc: {
          ...DEFAULT_SEVERANCE_CALC,
          ...(ex.payroll_settings.severance_calc || {}),
        },
        payslip_basis: {
          ...DEFAULT_PAYSLIP_BASIS,
          ...(ex.payroll_settings.payslip_basis || {}),
        },
      }
    : DEFAULT_PAYROLL_SETTINGS;

  // 모달 상태들
  const [withholdingOpen, setWithholdingOpen] = useState(false);
  const [socialModalOpen, setSocialModalOpen] = useState(false);
  const [socialMgmtDraft, setSocialMgmtDraft] = useState(
    payroll.social_insurance_mgmt_no
  );
  const [socialPhoneDraft, setSocialPhoneDraft] = useState(
    payroll.social_insurance_phone
  );
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);

  const [severanceOpen, setSeveranceOpen] = useState(false);
  const [sevDraft, setSevDraft] = useState<HqSeveranceCalcSettings>(
    payroll.severance_calc
  );

  const [basisOpen, setBasisOpen] = useState(false);
  const [basisDraft, setBasisDraft] = useState<HqPayslipBasisSettings>(
    payroll.payslip_basis
  );
  const [samplePreviewOpen, setSamplePreviewOpen] = useState(false);

  const [certModalOpen, setCertModalOpen] = useState(false);
  const [certName, setCertName] = useState("");
  const [certType, setCertType] = useState<"법인" | "개인">("법인");
  const [certPw1, setCertPw1] = useState("");
  const [certPw2, setCertPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [certFileName, setCertFileName] = useState("");

  const patchPayroll = async (
    partial: Partial<HqPayrollSettings>,
    toastMsg: string
  ) => {
    await onSaveExtra(
      {
        payroll_settings: {
          ...payroll,
          ...partial,
        },
      },
      toastMsg
    );
  };

  const handleSaveWithholding = async (nextAgent: HqWithholdingAgentInfo) => {
    // 원천징수의무자 최초 저장 시 사업장 목록이 비어 있으면 기본 사업장 자동 생성
    const nextWorkplaces =
      payroll.tax_workplaces.length > 0
        ? payroll.tax_workplaces
        : [
            {
              id: `twp-${uid()}`,
              name:
                nextAgent.submitter_type === "법인"
                  ? nextAgent.corp_name
                  : nextAgent.trade_name,
              business_reg_no: nextAgent.business_reg_no,
              sub_business_seq_no: nextAgent.sub_business_seq_no || "0000",
              local_gov_name: "관할 시·군·구청",
              address: nextAgent.location_address,
              is_primary: true,
            },
          ];

    await patchPayroll(
      {
        withholding_agent: nextAgent,
        tax_workplaces: nextWorkplaces,
      },
      "원천징수의무자 정보가 저장되었습니다."
    );
    setWithholdingOpen(false);
  };

  const handleSaveSocial = async () => {
    if (!socialMgmtDraft.trim()) {
      alert("사업장 관리번호를 입력해주세요.");
      return;
    }
    await patchPayroll(
      {
        social_insurance_mgmt_no: socialMgmtDraft.trim(),
        social_insurance_phone: socialPhoneDraft.trim(),
      },
      "사회보험 신고 정보가 저장되었습니다."
    );
    setSocialModalOpen(false);
  };

  const handleAddCertificate = async () => {
    if (!certName.trim()) {
      alert("공동인증서 이름을 입력해주세요.");
      return;
    }
    if (!certPw1) {
      alert("인증서 비밀번호를 입력해주세요.");
      return;
    }
    if (certPw1 !== certPw2) {
      alert("비밀번호와 비밀번호 재입력이 일치하지 않습니다.");
      return;
    }
    if (!certFileName) {
      alert("공동인증서 파일(*.pfx, *.p12 등)을 선택해주세요.");
      return;
    }

    const created: HqPayrollCertificateItem = {
      id: `cert-${uid()}`,
      name: certName.trim(),
      cert_type: certType,
      file_name: certFileName,
      registered_at: new Date().toISOString().slice(0, 10),
    };

    await patchPayroll(
      { certificates: [...payroll.certificates, created] },
      `'${created.name}' 공동인증서가 등록되었습니다.`
    );
    setCertName("");
    setCertPw1("");
    setCertPw2("");
    setCertFileName("");
    setCertModalOpen(false);
  };

  const renderSwitch = (checked: boolean, onToggle: () => void, disabled = false) => (
    <button
      type="button"
      disabled={!canEdit || disabled}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
        checked && !disabled ? "bg-[#00c458]" : "bg-slate-200"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
          checked && !disabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );

  return (
    <>
      <div className="space-y-9">
        <div>
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            정산 설정
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            급여 정산 업무를 위해 필요한 정보를 관리해보세요.
          </p>
        </div>

        {/* =============================================================== */}
        {/* 섹션 1: 회사 정보 (154602.png)                                   */}
        {/* =============================================================== */}
        <section className="space-y-3">
          <h3 className="text-[15px] font-extrabold text-slate-900">
            회사 정보
          </h3>

          <div className="space-y-2.5">
            {/* 1) 원천징수의무자 정보 */}
            <button
              type="button"
              onClick={() => setWithholdingOpen(true)}
              className="w-full px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 text-left shadow-2xs"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="text-lg shrink-0">🧑‍💼</span>
                <div>
                  <div className="text-[13px] font-bold text-slate-900">
                    원천징수의무자 정보
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    홈택스 신고, 원천징수영수증 발급 등에 필요한 정보예요.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {payroll.withholding_agent.is_configured ? (
                  <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-[#00a84b] text-[11px] font-extrabold">
                    {payroll.withholding_agent.corp_name ||
                      payroll.withholding_agent.trade_name ||
                      "설정됨"}
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-md bg-rose-50 text-rose-500 text-[11px] font-extrabold">
                    설정되지 않음
                  </span>
                )}
                <span className="text-slate-300 text-sm">›</span>
              </div>
            </button>

            {/* 2) 사회보험 신고 정보 */}
            <button
              type="button"
              onClick={() => {
                setSocialMgmtDraft(payroll.social_insurance_mgmt_no);
                setSocialPhoneDraft(payroll.social_insurance_phone);
                setSocialModalOpen(true);
              }}
              className="w-full px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 text-left shadow-2xs"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="text-lg shrink-0">🚨</span>
                <div>
                  <div className="text-[13px] font-bold text-slate-900">
                    사회보험 신고 정보
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    사회보험 신고시 필요한 정보예요.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 text-xs font-bold text-slate-600">
                {payroll.social_insurance_mgmt_no && (
                  <span>{payroll.social_insurance_mgmt_no}</span>
                )}
                <span className="text-slate-300 text-sm">›</span>
              </div>
            </button>

            {/* 3) 회사 규모 (154635.png 커스텀 드롭다운) */}
            <div className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 shadow-2xs relative">
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="text-lg shrink-0">🏢</span>
                <div>
                  <div className="text-[13px] font-bold text-slate-900">
                    회사 규모
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    고용보험 회사 부담금 요율 계산에 사용해요.
                  </p>
                </div>
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setSizeMenuOpen((p) => !p)}
                  className="text-xs font-bold text-slate-800 flex items-center gap-1 hover:text-slate-950"
                >
                  <span>{payroll.company_size_tier}</span>
                  <span className="text-slate-400 text-[10px]">▾</span>
                </button>

                {sizeMenuOpen && (
                  <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-white border border-slate-200 shadow-2xl p-2 z-30 text-xs">
                    {COMPANY_SIZE_TIERS.map((tier) => {
                      const active = payroll.company_size_tier === tier.value;
                      return (
                        <button
                          key={tier.value}
                          type="button"
                          onClick={async () => {
                            setSizeMenuOpen(false);
                            await patchPayroll(
                              { company_size_tier: tier.value },
                              `회사 규모가 '${tier.value}'으로 변경되었습니다.`
                            );
                          }}
                          className="w-full p-3 rounded-xl hover:bg-slate-50 flex items-start justify-between gap-2 text-left"
                        >
                          <div>
                            <div className="font-bold text-slate-900">
                              {tier.value}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {tier.rateDesc}
                            </div>
                          </div>
                          {active && (
                            <span className="text-[#00c458] font-bold">✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* =============================================================== */}
        {/* 섹션 2: 고급 설정 (154602, 154744)                               */}
        {/* =============================================================== */}
        <section className="space-y-3">
          <div>
            <h3 className="text-[15px] font-extrabold text-slate-900">
              고급 설정
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              우리 회사에 맞는 고급 설정이 필요한 경우 사용해보세요.
            </p>
          </div>

          <div className="space-y-2.5">
            {/* 1) 퇴직 소득 계산 설정 */}
            <button
              type="button"
              onClick={() => {
                setSevDraft({ ...payroll.severance_calc });
                setSeveranceOpen(true);
              }}
              className="w-full px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 text-left shadow-2xs"
            >
              <div className="flex items-center gap-3.5">
                <span className="text-lg">🌴</span>
                <div>
                  <div className="text-[13px] font-bold text-slate-900">
                    퇴직 소득 계산 설정
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    퇴직 소득의 자동 계산을 위한 정보에요.
                  </p>
                </div>
              </div>
              <span className="text-slate-300 text-sm">›</span>
            </button>

            {/* 2) 급여명세서 산출근거 설정 */}
            <button
              type="button"
              onClick={() => {
                setBasisDraft({ ...payroll.payslip_basis });
                setBasisOpen(true);
              }}
              className="w-full px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 text-left shadow-2xs"
            >
              <div className="flex items-center gap-3.5">
                <span className="text-lg">📄</span>
                <div>
                  <div className="text-[13px] font-bold text-slate-900">
                    급여명세서 산출근거 설정
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    임금 항목별 산출근거를 설정할 수 있어요.
                  </p>
                </div>
              </div>
              <span className="text-slate-300 text-sm">›</span>
            </button>

            {/* 3) 중도정산 시 고용보험 제외하기 */}
            <div className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-3.5">
                <span className="text-lg">🚫</span>
                <div>
                  <div className="text-[13px] font-bold text-slate-900">
                    중도정산 시 고용보험 제외하기
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    중도정산 시 퇴사자에게 돌려줘야할 고용보험료가 있다면 문제가 될 수 있어요.
                  </p>
                </div>
              </div>
              {renderSwitch(
                payroll.exclude_emp_ins_on_mid_settlement,
                () =>
                  patchPayroll(
                    {
                      exclude_emp_ins_on_mid_settlement:
                        !payroll.exclude_emp_ins_on_mid_settlement,
                    },
                    "중도정산 시 고용보험 제외 설정이 변경되었습니다."
                  )
              )}
            </div>

            {/* 4) 공제 항목의 소수점 금액 처리 */}
            <div className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-3.5">
                <span className="text-lg">🔢</span>
                <div>
                  <div className="text-[13px] font-bold text-slate-900">
                    공제 항목의 소수점 금액 처리
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    일할 등으로 공제 항목의 금액에 소수점이 발생할때, 어떻게 정수로 바꿀지 정해요.
                  </p>
                </div>
              </div>
              <select
                disabled={!canEdit}
                value={payroll.deduction_decimal_rounding}
                onChange={(e) =>
                  patchPayroll(
                    {
                      deduction_decimal_rounding:
                        e.target.value as HqPayrollRoundingMode,
                    },
                    "공제 항목 소수점 처리 기준이 저장되었습니다."
                  )
                }
                className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
              >
                <option value="반올림">반올림</option>
                <option value="버림">버림</option>
                <option value="올림">올림</option>
              </select>
            </div>

            {/* 5) 원천징수부 지급연월 처리 기준 (154744.png) */}
            <div className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-3.5">
                <span className="text-lg">✏️</span>
                <div>
                  <div className="text-[13px] font-bold text-slate-900">
                    원천징수부 지급연월 처리 기준
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    원천징수부의 지급연월 칸에 표시할 기준을 정해요.
                  </p>
                </div>
              </div>
              <select
                disabled={!canEdit}
                value={payroll.withholding_ledger_month_rule}
                onChange={(e) =>
                  patchPayroll(
                    {
                      withholding_ledger_month_rule:
                        e.target.value as HqPayrollSettings["withholding_ledger_month_rule"],
                    },
                    "원천징수부 지급연월 처리 기준이 저장되었습니다."
                  )
                }
                className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
              >
                <option value="귀속연월">귀속연월</option>
                <option value="마지막 지급연월 기준 표기">
                  마지막 지급연월 기준 표기
                </option>
                <option value="지급연월별 분리 표기">지급연월별 분리 표기</option>
              </select>
            </div>
          </div>
        </section>

        {/* =============================================================== */}
        {/* 섹션 3: 공동 인증서 (154744, 154804, 154808)                     */}
        {/* =============================================================== */}
        <section className="space-y-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-extrabold text-slate-900">
                공동 인증서
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                건강보험 EDI 서비스와, 고용 · 산재보험 토탈서비스에 사용하는 공동인증서를 등록하세요.
              </p>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={() => setCertModalOpen(true)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-[#00c458] font-extrabold text-sm leading-none">
                  +
                </span>
                <span>공동인증서 추가</span>
              </button>
            )}
          </div>

          {payroll.certificates.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <div className="text-slate-300 text-2xl">🎖️</div>
              <div className="text-xs font-bold text-slate-500">
                공동인증서가 없어요.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {payroll.certificates.map((cert) => (
                <div
                  key={cert.id}
                  className="px-5 py-3.5 rounded-2xl border border-slate-200 bg-white flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">🎖️</span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-extrabold text-slate-900">
                          {cert.name}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                          {cert.cert_type}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {cert.file_name} · 등록일 {cert.registered_at}
                      </p>
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        patchPayroll(
                          {
                            certificates: payroll.certificates.filter(
                              (c) => c.id !== cert.id
                            ),
                          },
                          `'${cert.name}' 공동인증서가 삭제되었습니다.`
                        )
                      }
                      className="text-[11px] font-bold text-slate-400 hover:text-rose-500"
                    >
                      삭제
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 하단 이전/다음 이동 카드 (공제 항목 ← / → 사업장 설정) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("payroll-deduction")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                공제 항목
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("payroll-workplace")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                사업장 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* 모달 1: 원천징수의무자 정보 */}
      {withholdingOpen && (
        <WithholdingAgentModal
          initial={payroll.withholding_agent}
          companySettings={settings}
          canEdit={canEdit}
          saving={saving}
          onClose={() => setWithholdingOpen(false)}
          onSave={handleSaveWithholding}
        />
      )}

      {/* 모달 2: 사회보험 신고 정보 (154631.png) */}
      {socialModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[440px] rounded-2xl shadow-2xl border border-slate-200 p-7 text-xs space-y-5">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSocialModalOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 text-slate-500 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>
            <div className="-mt-2">
              <h3 className="text-xl font-extrabold text-slate-900">
                사회보험 신고 정보
              </h3>
              <p className="text-slate-400 mt-1">
                사회보험 신고시 필요한 정보예요.
              </p>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                  사업장 관리번호<span className="text-rose-500">*</span>
                </label>
                <input
                  disabled={!canEdit}
                  value={socialMgmtDraft}
                  onChange={(e) => setSocialMgmtDraft(e.target.value)}
                  placeholder="사업장 관리번호"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                  사업장 전화번호<span className="text-rose-500">*</span>
                </label>
                <input
                  disabled={!canEdit}
                  value={socialPhoneDraft}
                  onChange={(e) => setSocialPhoneDraft(e.target.value)}
                  placeholder="사업장 전화번호"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
                />
              </div>
            </div>

            {canEdit && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveSocial}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] text-white font-extrabold shadow-md"
              >
                저장하기
              </button>
            )}
          </div>
        </div>
      )}

      {/* 모달 3: 퇴직 소득 계산 설정 (154643 ~ 154705) */}
      {severanceOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[540px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            <div className="flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSeveranceOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 text-slate-500 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-6">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                퇴직 소득 계산 설정
              </h3>

              {/* 산정 기준 설정 */}
              <div className="space-y-3">
                <div className="text-sm font-extrabold text-slate-900">
                  산정 기준 설정
                </div>

                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  <div className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800">
                        평균임금 반영 일수
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        평균임금 계산시 기본으로 반영되는 일수를 설정합니다.
                      </div>
                    </div>
                    <select
                      disabled={!canEdit}
                      value={sevDraft.avg_wage_period}
                      onChange={(e) =>
                        setSevDraft({
                          ...sevDraft,
                          avg_wage_period: e.target.value as "3개월" | "90일",
                        })
                      }
                      className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                    >
                      <option value="90일">90일</option>
                      <option value="3개월">3개월</option>
                    </select>
                  </div>

                  <div className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800">
                        퇴직소득 산정 기준
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                        통상/평균임금 혹은 높은 금액을 우선 적용할 수 있습니다.
                        <br />
                        구성원에게 유리한 기준을 적용해야 합니다.
                      </div>
                    </div>
                    <select
                      disabled={!canEdit}
                      value={sevDraft.calc_basis}
                      onChange={(e) =>
                        setSevDraft({
                          ...sevDraft,
                          calc_basis: e.target.value as any,
                        })
                      }
                      className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                    >
                      <option value="높은 금액 적용">
                        [추천] 높은 금액 적용
                      </option>
                      <option value="평균임금">평균임금</option>
                      <option value="통상임금">통상임금</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* 금액 단위 설정 */}
              <div className="space-y-3">
                <div className="text-sm font-extrabold text-slate-900">
                  금액 단위 설정
                </div>

                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {(
                    [
                      {
                        title: "산정 퇴직소득 금액 단위 설정",
                        desc: "산정하는 퇴직소득의 단위를 설정합니다.",
                        unitKey: "severance_unit" as const,
                        roundKey: "severance_rounding" as const,
                      },
                      {
                        title: "평균임금 금액 단위 설정",
                        desc: "평균임금의 금액 단위 처리 방식을 설정합니다.",
                        unitKey: "avg_wage_unit" as const,
                        roundKey: "avg_wage_rounding" as const,
                      },
                    ] as const
                  ).map((row) => (
                    <div
                      key={row.title}
                      className="py-4 flex items-start justify-between gap-4"
                    >
                      <div>
                        <div className="font-bold text-slate-800">
                          {row.title}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {row.desc}
                        </div>
                      </div>
                      <div className="w-48 space-y-2">
                        <select
                          disabled={!canEdit}
                          value={sevDraft[row.unitKey]}
                          onChange={(e) =>
                            setSevDraft({
                              ...sevDraft,
                              [row.unitKey]: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                        >
                          {SEVERANCE_PRECISION_UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                        <div className="grid grid-cols-3 p-0.5 rounded-xl bg-[#f5f6f8]">
                          {(["올림", "버림", "반올림"] as HqPayrollRoundingMode[]).map(
                            (rm) => (
                              <button
                                key={rm}
                                type="button"
                                disabled={!canEdit}
                                onClick={() =>
                                  setSevDraft({
                                    ...sevDraft,
                                    [row.roundKey]: rm,
                                  })
                                }
                                className={`py-1.5 rounded-lg font-bold ${
                                  sevDraft[row.roundKey] === rm
                                    ? "bg-white text-slate-900 shadow-2xs"
                                    : "text-slate-400"
                                }`}
                              >
                                {rm}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* 평균임금 산정 시 소수점 첫째 자리 처리 */}
                  <div className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800">
                        평균임금 산정 시 소수점 첫째 자리 처리
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        일할 계산 시 소수점 첫째 자리 처리 방식을 설정합니다.
                      </div>
                    </div>
                    <div className="w-48 grid grid-cols-3 p-0.5 rounded-xl bg-[#f5f6f8]">
                      {(["올림", "버림", "반올림"] as HqPayrollRoundingMode[]).map(
                        (rm) => (
                          <button
                            key={rm}
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              setSevDraft({
                                ...sevDraft,
                                avg_wage_first_decimal_rounding: rm,
                              })
                            }
                            className={`py-1.5 rounded-lg font-bold ${
                              sevDraft.avg_wage_first_decimal_rounding === rm
                                ? "bg-white text-slate-900 shadow-2xs"
                                : "text-slate-400"
                            }`}
                          >
                            {rm}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* 통상임금 금액 단위 설정 */}
                  <div className="py-4 flex items-start justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800">
                        통상임금 금액 단위 설정
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        통상임금의 금액 단위 처리 방식을 설정합니다.
                      </div>
                    </div>
                    <div className="w-48 space-y-2">
                      <select
                        disabled={!canEdit}
                        value={sevDraft.ordinary_wage_unit}
                        onChange={(e) =>
                          setSevDraft({
                            ...sevDraft,
                            ordinary_wage_unit: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                      >
                        {SEVERANCE_PRECISION_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                      <div className="grid grid-cols-3 p-0.5 rounded-xl bg-[#f5f6f8]">
                        {(["올림", "버림", "반올림"] as HqPayrollRoundingMode[]).map(
                          (rm) => (
                            <button
                              key={rm}
                              type="button"
                              disabled={!canEdit}
                              onClick={() =>
                                setSevDraft({
                                  ...sevDraft,
                                  ordinary_wage_rounding: rm,
                                })
                              }
                              className={`py-1.5 rounded-lg font-bold ${
                                sevDraft.ordinary_wage_rounding === rm
                                  ? "bg-white text-slate-900 shadow-2xs"
                                  : "text-slate-400"
                              }`}
                            >
                              {rm}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setSevDraft({ ...DEFAULT_SEVERANCE_CALC })}
                  className="py-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-rose-500 font-extrabold"
                >
                  설정 초기화
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await patchPayroll(
                      { severance_calc: sevDraft },
                      "퇴직 소득 계산 설정이 저장되었습니다."
                    );
                    setSeveranceOpen(false);
                  }}
                  className="py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] text-white font-extrabold shadow-md"
                >
                  저장하기
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 모달 4: 급여명세서 산출근거 설정 (154719 ~ 154727) */}
      {basisOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[540px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            <div className="flex items-center justify-between shrink-0">
              <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-extrabold">
                ⚠️ 확인이 필요해요
              </span>
              <button
                type="button"
                onClick={() => setBasisOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 text-slate-500 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex items-start justify-between gap-3 mt-3 shrink-0">
              <div>
                <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  급여명세서 산출근거 설정
                </h3>
                <p className="text-slate-400 mt-1">
                  우리 회사의 급여 지급 정책에 알맞은 산출근거를 설정해보세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSamplePreviewOpen(true)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-700 shrink-0"
              >
                👁️ 샘플 미리보기
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-6 mt-5">
              {/* 1) 기본근무 산출근거 */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-extrabold text-slate-900">
                    💼 기본근무 산출근거
                  </span>
                  {renderSwitch(basisDraft.base_work_enabled, () =>
                    setBasisDraft({
                      ...basisDraft,
                      base_work_enabled: !basisDraft.base_work_enabled,
                    })
                  )}
                </div>

                {basisDraft.base_work_enabled && (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 px-4">
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">근로일수</b>{" "}
                        <span className="text-slate-400">OO일</span>
                      </span>
                      {renderSwitch(basisDraft.base_work_days, () =>
                        setBasisDraft({
                          ...basisDraft,
                          base_work_days: !basisDraft.base_work_days,
                        })
                      )}
                    </div>
                    <div className="py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span>
                          <b className="text-slate-800">기준일수</b>{" "}
                          <span className="text-slate-400">OO일</span>
                        </span>
                        {renderSwitch(basisDraft.base_standard_days, () =>
                          setBasisDraft({
                            ...basisDraft,
                            base_standard_days: !basisDraft.base_standard_days,
                          })
                        )}
                      </div>
                      <div className="pl-3 flex items-start justify-between gap-3">
                        <div className="text-[11px] text-slate-400">
                          <div className="font-bold text-slate-600">
                            ↳ 하단 설명 문구
                          </div>
                          기준일수는 근로일수에 비례하여 급여 산정 시 기준으로 사용되며, 귀속월의 월력일수(28·29·30·31일) 또는 회사 정책에 따른 일수를 사용합니다.
                        </div>
                        {renderSwitch(
                          basisDraft.base_standard_days_desc,
                          () =>
                            setBasisDraft({
                              ...basisDraft,
                              base_standard_days_desc:
                                !basisDraft.base_standard_days_desc,
                            }),
                          !basisDraft.base_standard_days
                        )}
                      </div>
                    </div>
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">통상시급</b>{" "}
                        <span className="text-slate-400">OO,OOO원</span>
                      </span>
                      {renderSwitch(basisDraft.base_ordinary_hourly, () =>
                        setBasisDraft({
                          ...basisDraft,
                          base_ordinary_hourly: !basisDraft.base_ordinary_hourly,
                        })
                      )}
                    </div>
                    <div className="py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span>
                          <b className="text-slate-800">기본근무시간 · 시급</b>{" "}
                          <span className="text-slate-400">
                            O시간 OO분 · OO,OOO원
                          </span>
                        </span>
                        {renderSwitch(basisDraft.base_hours_and_hourly, () =>
                          setBasisDraft({
                            ...basisDraft,
                            base_hours_and_hourly:
                              !basisDraft.base_hours_and_hourly,
                          })
                        )}
                      </div>
                      <div className="pl-3 flex items-start justify-between gap-3">
                        <div className="text-[11px] text-slate-400">
                          <div className="font-bold text-slate-600">
                            ↳ 하단 설명 문구
                          </div>
                          기본근무시간은 실제소정근무시간, 연차 등 유급휴가시간, 공휴일 등 유급휴일시간을 합산한 시간입니다.
                        </div>
                        {renderSwitch(
                          basisDraft.base_hours_desc,
                          () =>
                            setBasisDraft({
                              ...basisDraft,
                              base_hours_desc: !basisDraft.base_hours_desc,
                            }),
                          !basisDraft.base_hours_and_hourly
                        )}
                      </div>
                    </div>
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">근무미달시간</b>{" "}
                        <span className="text-slate-400">O시간 OO분</span>
                      </span>
                      {renderSwitch(basisDraft.base_shortage_hours, () =>
                        setBasisDraft({
                          ...basisDraft,
                          base_shortage_hours: !basisDraft.base_shortage_hours,
                        })
                      )}
                    </div>
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">무급휴가시간</b>{" "}
                        <span className="text-slate-400">O시간 OO분</span>
                      </span>
                      {renderSwitch(basisDraft.base_unpaid_leave_hours, () =>
                        setBasisDraft({
                          ...basisDraft,
                          base_unpaid_leave_hours:
                            !basisDraft.base_unpaid_leave_hours,
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 2) 주휴수당 산출근거 */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-extrabold text-slate-900">
                    🏖️ 주휴수당 산출근거
                  </span>
                  {renderSwitch(basisDraft.weekly_holiday_enabled, () =>
                    setBasisDraft({
                      ...basisDraft,
                      weekly_holiday_enabled: !basisDraft.weekly_holiday_enabled,
                    })
                  )}
                </div>
                {basisDraft.weekly_holiday_enabled && (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 px-4">
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">산정기간</b>{" "}
                        <span className="text-slate-400">
                          OOOO년 O월 O일 ~ O월 O일
                        </span>
                      </span>
                      {renderSwitch(basisDraft.weekly_holiday_period, () =>
                        setBasisDraft({
                          ...basisDraft,
                          weekly_holiday_period:
                            !basisDraft.weekly_holiday_period,
                        })
                      )}
                    </div>
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">주휴시간</b>{" "}
                        <span className="text-slate-400">O시간 OO분</span>
                      </span>
                      {renderSwitch(basisDraft.weekly_holiday_hours, () =>
                        setBasisDraft({
                          ...basisDraft,
                          weekly_holiday_hours:
                            !basisDraft.weekly_holiday_hours,
                        })
                      )}
                    </div>
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">통상시급</b>{" "}
                        <span className="text-slate-400">OO,OOO원</span>
                      </span>
                      {renderSwitch(basisDraft.weekly_holiday_hourly, () =>
                        setBasisDraft({
                          ...basisDraft,
                          weekly_holiday_hourly:
                            !basisDraft.weekly_holiday_hourly,
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 3) 고정초과근무 산출근거 */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-extrabold text-slate-900">
                    🕒 고정초과근무 산출근거
                  </span>
                  {renderSwitch(basisDraft.fixed_ot_enabled, () =>
                    setBasisDraft({
                      ...basisDraft,
                      fixed_ot_enabled: !basisDraft.fixed_ot_enabled,
                    })
                  )}
                </div>
                {basisDraft.fixed_ot_enabled && (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 px-4">
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">월 계약시간</b>{" "}
                        <span className="text-slate-400">
                          연장시간(OO%) : O시간 OO분 ...
                        </span>
                      </span>
                      {renderSwitch(basisDraft.fixed_ot_contract_hours, () =>
                        setBasisDraft({
                          ...basisDraft,
                          fixed_ot_contract_hours:
                            !basisDraft.fixed_ot_contract_hours,
                        })
                      )}
                    </div>
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">통상시급</b>{" "}
                        <span className="text-slate-400">OO,OOO원</span>
                      </span>
                      {renderSwitch(basisDraft.fixed_ot_hourly, () =>
                        setBasisDraft({
                          ...basisDraft,
                          fixed_ot_hourly: !basisDraft.fixed_ot_hourly,
                        })
                      )}
                    </div>
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">금액</b>{" "}
                        <span className="text-slate-400">OO,OOO원</span>
                      </span>
                      {renderSwitch(basisDraft.fixed_ot_amount, () =>
                        setBasisDraft({
                          ...basisDraft,
                          fixed_ot_amount: !basisDraft.fixed_ot_amount,
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 4) 초과근무 산출근거 */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-extrabold text-slate-900">
                    🔥 초과근무 산출근거
                  </span>
                  {renderSwitch(basisDraft.variable_ot_enabled, () =>
                    setBasisDraft({
                      ...basisDraft,
                      variable_ot_enabled: !basisDraft.variable_ot_enabled,
                    })
                  )}
                </div>
                {basisDraft.variable_ot_enabled && (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 px-4">
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">초과근무시간 9종</b>{" "}
                        <span className="text-slate-400">
                          연장시간(OO%) : O시간 OO분 ...
                        </span>
                      </span>
                      {renderSwitch(basisDraft.variable_ot_9types, () =>
                        setBasisDraft({
                          ...basisDraft,
                          variable_ot_9types: !basisDraft.variable_ot_9types,
                        })
                      )}
                    </div>
                    <div className="py-3 flex items-center justify-between">
                      <span>
                        <b className="text-slate-800">통상시급</b>{" "}
                        <span className="text-slate-400">OO,OOO원</span>
                      </span>
                      {renderSwitch(basisDraft.variable_ot_hourly, () =>
                        setBasisDraft({
                          ...basisDraft,
                          variable_ot_hourly: !basisDraft.variable_ot_hourly,
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 5) 재직자 연차수당 & 6) 퇴직자 연차수당 */}
              {(
                [
                  {
                    title: "🏖️ 재직자 연차수당 산출근거",
                    enKey: "active_leave_pay_enabled" as const,
                    dKey: "active_leave_unused_days" as const,
                    hKey: "active_leave_daily_hours" as const,
                    wKey: "active_leave_hourly" as const,
                  },
                  {
                    title: "🏖️ 퇴직자 연차수당 산출근거",
                    enKey: "retiree_leave_pay_enabled" as const,
                    dKey: "retiree_leave_unused_days" as const,
                    hKey: "retiree_leave_daily_hours" as const,
                    wKey: "retiree_leave_hourly" as const,
                  },
                ] as const
              ).map((grp) => (
                <div key={grp.title} className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-extrabold text-slate-900">
                      {grp.title}
                    </span>
                    {renderSwitch(basisDraft[grp.enKey], () =>
                      setBasisDraft({
                        ...basisDraft,
                        [grp.enKey]: !basisDraft[grp.enKey],
                      })
                    )}
                  </div>
                  {basisDraft[grp.enKey] && (
                    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 px-4">
                      <div className="py-3 flex items-center justify-between">
                        <span>
                          <b className="text-slate-800">미사용 연차일수</b>{" "}
                          <span className="text-slate-400">O일(O시간 OO분)</span>
                        </span>
                        {renderSwitch(basisDraft[grp.dKey], () =>
                          setBasisDraft({
                            ...basisDraft,
                            [grp.dKey]: !basisDraft[grp.dKey],
                          })
                        )}
                      </div>
                      <div className="py-3 flex items-center justify-between">
                        <span>
                          <b className="text-slate-800">1일 소정근로시간</b>{" "}
                          <span className="text-slate-400">O시간</span>
                        </span>
                        {renderSwitch(basisDraft[grp.hKey], () =>
                          setBasisDraft({
                            ...basisDraft,
                            [grp.hKey]: !basisDraft[grp.hKey],
                          })
                        )}
                      </div>
                      <div className="py-3 flex items-center justify-between">
                        <span>
                          <b className="text-slate-800">통상시급</b>{" "}
                          <span className="text-slate-400">OO,OOO원</span>
                        </span>
                        {renderSwitch(basisDraft[grp.wKey], () =>
                          setBasisDraft({
                            ...basisDraft,
                            [grp.wKey]: !basisDraft[grp.wKey],
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setBasisDraft({ ...DEFAULT_PAYSLIP_BASIS })}
                  className="py-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-extrabold"
                >
                  ↻ 초기화
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await patchPayroll(
                      { payslip_basis: basisDraft },
                      "급여명세서 산출근거 설정이 저장되었습니다."
                    );
                    setBasisOpen(false);
                  }}
                  className="py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] text-white font-extrabold shadow-md"
                >
                  저장하기
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 급여명세서 샘플 미리보기 모달 */}
      {samplePreviewOpen && (
        <div className="fixed inset-0 bg-slate-900/55 z-[90] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-6 text-xs space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-base font-extrabold text-slate-900">
                📄 급여명세서 산출근거 샘플 미리보기
              </h4>
              <button
                type="button"
                onClick={() => setSamplePreviewOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
              {basisDraft.base_work_enabled && (
                <div>
                  <div className="font-extrabold text-slate-800">
                    기본급 산출근거
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1 space-y-0.5">
                    {basisDraft.base_work_days && <div>• 근로일수: 22일</div>}
                    {basisDraft.base_ordinary_hourly && (
                      <div>• 통상시급: 16,746원</div>
                    )}
                    {basisDraft.base_hours_and_hourly && (
                      <div>• 기본근무시간: 174시간 × 16,746원</div>
                    )}
                  </div>
                </div>
              )}
              {basisDraft.fixed_ot_enabled && (
                <div className="pt-2 border-t border-slate-200">
                  <div className="font-extrabold text-slate-800">
                    고정초과근무수당 산출근거
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1 space-y-0.5">
                    {basisDraft.fixed_ot_contract_hours && (
                      <div>• 월 포괄 약정 연장시간(150%): 20시간</div>
                    )}
                    {basisDraft.fixed_ot_hourly && (
                      <div>• 통상시급: 16,746원</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSamplePreviewOpen(false)}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-extrabold"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 모달 5: 공동인증서 추가 모달 (154804, 154808) */}
      {certModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 p-7 text-xs space-y-5">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setCertModalOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 text-slate-500 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <input
              autoFocus
              value={certName}
              onChange={(e) => setCertName(e.target.value)}
              placeholder="공동인증서 이름"
              className="w-full text-xl font-extrabold text-slate-900 placeholder:text-slate-300 focus:outline-none -mt-2"
            />

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                  유형<span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 p-0.5 rounded-xl bg-[#f5f6f8] border border-slate-200/70">
                  {(["법인", "개인"] as const).map((tp) => (
                    <button
                      key={tp}
                      type="button"
                      onClick={() => setCertType(tp)}
                      className={`py-2.5 rounded-lg font-bold transition-all ${
                        certType === tp
                          ? "bg-white text-slate-900 border border-blue-500 shadow-2xs"
                          : "text-slate-400"
                      }`}
                    >
                      {tp}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    비밀번호<span className="text-rose-500">*</span>
                  </label>
                  <div className="px-3 py-2.5 rounded-xl bg-[#f5f6f8] flex items-center justify-between">
                    <input
                      type={showPw ? "text" : "password"}
                      value={certPw1}
                      onChange={(e) => setCertPw1(e.target.value)}
                      placeholder="비밀번호 입력"
                      className="w-full bg-transparent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((p) => !p)}
                      className="text-slate-400 text-[11px]"
                    >
                      👁️
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    비밀번호 재입력<span className="text-rose-500">*</span>
                  </label>
                  <div className="px-3 py-2.5 rounded-xl bg-[#f5f6f8] flex items-center justify-between">
                    <input
                      type={showPw ? "text" : "password"}
                      value={certPw2}
                      onChange={(e) => setCertPw2(e.target.value)}
                      placeholder="비밀번호 재입력"
                      className="w-full bg-transparent focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                  공동인증서 파일<span className="text-rose-500">*</span>
                </label>
                <label className="w-full px-4 py-3.5 rounded-xl bg-[#f5f6f8] hover:bg-slate-200/60 flex items-center gap-2.5 cursor-pointer text-slate-600 font-semibold">
                  <span>☁️</span>
                  <span className="truncate">
                    {certFileName || "파일 선택 또는 끌어놓기"}
                  </span>
                  <input
                    type="file"
                    accept=".pfx,.p12,.der,.key"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setCertFileName(f.name);
                    }}
                    className="hidden"
                  />
                </label>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  *.pfx, *.p12 파일 한 개 또는 signCert.der과 signPri.key 파일 묶음만 업로드하세요.
                </p>
              </div>
            </div>

            {canEdit && (
              <button
                type="button"
                disabled={saving}
                onClick={handleAddCertificate}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] text-white font-extrabold shadow-md"
              >
                추가하기
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ========================================================================= */
/* 4. 설정 > 급여·정산 > 사업장 설정 (스크린샷 154816 ~ 154835)               */
/* ========================================================================= */
export function HqPayrollTaxWorkplaceSection({
  settings,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: SettlementSectionProps) {
  const ex = settings.extra_settings || {};
  const payroll: HqPayrollSettings = ex.payroll_settings
    ? {
        ...DEFAULT_PAYROLL_SETTINGS,
        ...ex.payroll_settings,
        withholding_agent: {
          ...DEFAULT_PAYROLL_SETTINGS.withholding_agent,
          ...(ex.payroll_settings.withholding_agent || {}),
        },
      }
    : DEFAULT_PAYROLL_SETTINGS;

  const [withholdingOpen, setWithholdingOpen] = useState(false);
  const [wpDraft, setWpDraft] = useState<HqPayrollTaxWorkplaceItem | null>(
    null
  );
  const [isNewWp, setIsNewWp] = useState(false);

  const handleSaveWithholding = async (nextAgent: HqWithholdingAgentInfo) => {
    const nextWorkplaces =
      payroll.tax_workplaces.length > 0
        ? payroll.tax_workplaces
        : [
            {
              id: `twp-${uid()}`,
              name:
                nextAgent.submitter_type === "법인"
                  ? nextAgent.corp_name
                  : nextAgent.trade_name,
              business_reg_no: nextAgent.business_reg_no,
              sub_business_seq_no: nextAgent.sub_business_seq_no || "0000",
              local_gov_name: "관할 시·군·구청",
              address: nextAgent.location_address,
              is_primary: true,
            },
          ];

    await onSaveExtra(
      {
        payroll_settings: {
          ...payroll,
          withholding_agent: nextAgent,
          tax_workplaces: nextWorkplaces,
        },
      },
      "원천징수의무자 정보 및 기본 사업장이 설정되었습니다."
    );
    setWithholdingOpen(false);
  };

  const openCreateWp = () => {
    setIsNewWp(true);
    setWpDraft({
      id: `twp-${uid()}`,
      name: "",
      business_reg_no: payroll.withholding_agent.business_reg_no || "",
      sub_business_seq_no: "",
      local_gov_name: "",
      address: "",
      is_primary: payroll.tax_workplaces.length === 0,
    });
  };

  const handleSaveWp = async () => {
    if (!wpDraft) return;
    if (!wpDraft.name.trim()) {
      alert("사업장 이름을 입력해주세요.");
      return;
    }
    const clean: HqPayrollTaxWorkplaceItem = {
      ...wpDraft,
      name: wpDraft.name.trim(),
    };
    const nextList = isNewWp
      ? [...payroll.tax_workplaces, clean]
      : payroll.tax_workplaces.map((w) => (w.id === clean.id ? clean : w));

    await onSaveExtra(
      {
        payroll_settings: {
          ...payroll,
          tax_workplaces: nextList,
        },
      },
      isNewWp
        ? `'${clean.name}' 사업장이 등록되었습니다.`
        : `'${clean.name}' 사업장이 저장되었습니다.`
    );
    setWpDraft(null);
  };

  return (
    <>
      <div className="space-y-9">
        <div>
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            사업장 설정
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            <span className="underline text-blue-600 font-semibold">
              지방소득세 신고
            </span>
            를 위한 사업장 정보를 관리할 수 있어요.
          </p>
        </div>

        <section className="space-y-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-extrabold text-slate-900">
              사업장 목록
            </h3>
            {payroll.withholding_agent.is_configured && canEdit && (
              <button
                type="button"
                onClick={openCreateWp}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-[#00c458] font-extrabold text-sm leading-none">
                  +
                </span>
                <span>사업장 추가</span>
              </button>
            )}
          </div>

          {!payroll.withholding_agent.is_configured ||
          payroll.tax_workplaces.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <div className="text-slate-200 text-2xl">💼</div>
              <div className="text-xs font-extrabold text-slate-700">
                아직 사업장이 없어요.
              </div>
              <p className="text-[11px] text-slate-400">
                사업장을 추가하려면 원천징수의무자 정보가 필요해요.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setWithholdingOpen(true)}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 inline-flex items-center gap-1 shadow-2xs"
                >
                  <span>설정하기</span>
                  <span className="text-slate-400">↗</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {payroll.tax_workplaces.map((tw) => (
                <div
                  key={tw.id}
                  onClick={() => {
                    setIsNewWp(false);
                    setWpDraft({ ...tw });
                  }}
                  className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 cursor-pointer shadow-2xs"
                >
                  <div className="flex items-center gap-3.5">
                    <span className="text-lg">💼</span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-bold text-slate-900">
                          {tw.name}
                        </span>
                        {tw.is_primary && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                            주사업장
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        사업자번호 {tw.business_reg_no} · {tw.local_gov_name} ·{" "}
                        {tw.address}
                      </p>
                    </div>
                  </div>
                  {!tw.is_primary && canEdit && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSaveExtra(
                          {
                            payroll_settings: {
                              ...payroll,
                              tax_workplaces: payroll.tax_workplaces.filter(
                                (x) => x.id !== tw.id
                              ),
                            },
                          },
                          `'${tw.name}' 사업장이 삭제되었습니다.`
                        );
                      }}
                      className="text-[11px] font-bold text-slate-400 hover:text-rose-500"
                    >
                      삭제
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 하단 이전/다음 이동 카드 (정산 설정 ← / → 회사 정보) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("payroll-settlement")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                정산 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("company")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                회사 정보
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">처음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* 원천징수의무자 설정 모달 (154820 ~ 154835 동일) */}
      {withholdingOpen && (
        <WithholdingAgentModal
          initial={payroll.withholding_agent}
          companySettings={settings}
          canEdit={canEdit}
          saving={saving}
          onClose={() => setWithholdingOpen(false)}
          onSave={handleSaveWithholding}
        />
      )}

      {/* 지방소득세 사업장 추가/수정 모달 */}
      {wpDraft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 p-7 text-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-900">
                {isNewWp ? "지방소득세 사업장 추가" : "사업장 정보 수정"}
              </h3>
              <button
                type="button"
                onClick={() => setWpDraft(null)}
                className="w-6 h-6 rounded-full bg-slate-200/80 text-slate-500 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  사업장명
                </label>
                <input
                  value={wpDraft.name}
                  onChange={(e) =>
                    setWpDraft({ ...wpDraft, name: e.target.value })
                  }
                  placeholder="예: (주)천종현수학연구소 본점"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    사업자등록번호
                  </label>
                  <input
                    value={wpDraft.business_reg_no}
                    onChange={(e) =>
                      setWpDraft({
                        ...wpDraft,
                        business_reg_no: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    종사업장 일련번호
                  </label>
                  <input
                    value={wpDraft.sub_business_seq_no || ""}
                    onChange={(e) =>
                      setWpDraft({
                        ...wpDraft,
                        sub_business_seq_no: e.target.value,
                      })
                    }
                    placeholder="0000"
                    className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-mono focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  지방소득세 특별징수 관할 시·군·구청
                </label>
                <input
                  value={wpDraft.local_gov_name}
                  onChange={(e) =>
                    setWpDraft({ ...wpDraft, local_gov_name: e.target.value })
                  }
                  placeholder="예: 서울특별시 송파구청 / 경기도 성남시 수정구청"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  사업장 주소
                </label>
                <input
                  value={wpDraft.address}
                  onChange={(e) =>
                    setWpDraft({ ...wpDraft, address: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold focus:outline-none"
                />
              </div>
            </div>

            {canEdit && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveWp}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] text-white font-extrabold shadow-md"
              >
                저장하기
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
