// src/components/hq/settings/HqIntegrationSettingsSection.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { hqFetch } from "@/lib/hq/clientApi";
import { DEFAULT_INTEGRATION_SETTINGS } from "@/lib/hq/defaultIntegrationSettings";
import type {
  HqAccessTerminalConfig,
  HqAccessTerminalProvider,
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqGoogleCalendarIntegrationConfig,
  HqIntegrationSettings,
  HqMember,
  HqSlackIntegrationConfig,
  HqTerminalCardMapping,
} from "@/lib/hq/types";
import type { HqSettingsTab } from "./HqSettingsModal";

function randomSecret(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

interface ParsedCsvPunch {
  work_date: string;
  time_str: string;
  user_no: string;
  user_name: string;
  mode: string;
}

/**
 * ADT 캡스 / 에스원 세콤 / KT텔레캅 출입이력 CSV 텍스트 지능형 파서
 * - 한글 헤더('발생일자', '출입시각', '성명', '카드번호', '사번', '모드' 등) 및 일반 열 순서 모두 지원
 */
function parseAccessControlCsv(rawText: string): ParsedCsvPunch[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const splitCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    const sep = line.includes("\t") && !line.includes(",") ? "\t" : ",";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === sep && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const rows = lines.map(splitCsvLine);
  const header = rows[0].map((h) => h.replace(/\s+/g, "").toLowerCase());
  const hasHeader = header.some((h) =>
    /일자|날짜|date|시간|시각|time|이름|성명|name|사번|카드|card/.test(h)
  );

  const findIdx = (regex: RegExp) => header.findIndex((h) => regex.test(h));
  const dateIdx = hasHeader ? findIdx(/일자|날짜|date/) : -1;
  const timeIdx = hasHeader ? findIdx(/시간|시각|time/) : -1;
  const nameIdx = hasHeader ? findIdx(/이름|성명|사용자|name/) : -1;
  const noIdx = hasHeader ? findIdx(/카드|사번|번호|id|no/) : -1;
  const modeIdx = hasHeader ? findIdx(/구분|모드|상태|이벤트|출입|mode|type/) : -1;

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const parsed: ParsedCsvPunch[] = [];

  for (const cols of dataRows) {
    if (cols.length < 2) continue;

    let workDate = "";
    let timeStr = "";
    let userName = nameIdx >= 0 ? cols[nameIdx] || "" : "";
    let userNo = noIdx >= 0 ? cols[noIdx] || "" : "";
    let mode = modeIdx >= 0 ? cols[modeIdx] || "" : "";

    // 날짜·시각이 한 셀("2026-11-16 08:51:22")에 합쳐져 있는 캡스 포맷도 자동 분리
    const rawDateCell = dateIdx >= 0 ? cols[dateIdx] || "" : "";
    const rawTimeCell = timeIdx >= 0 ? cols[timeIdx] || "" : "";

    const extractDateAndTime = (cell: string) => {
      const dtMatch =
        /(\d{4})[-./]?(\d{2})[-./]?(\d{2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/.exec(
          cell
        );
      if (dtMatch) {
        if (!workDate)
          workDate = `${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]}`;
        if (dtMatch[4] && !timeStr) timeStr = dtMatch[4];
      }
      const tOnly = /(?:오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/i.exec(
        cell
      );
      if (tOnly && !/\d{4}/.test(cell) && !timeStr) {
        let hh = Number(tOnly[1]);
        if (/오후|PM/i.test(cell) && hh < 12) hh += 12;
        if (/오전|AM/i.test(cell) && hh === 12) hh = 0;
        timeStr = `${String(hh).padStart(2, "0")}:${tOnly[2]}:${
          tOnly[3] || "00"
        }`;
      }
    };

    if (rawDateCell) extractDateAndTime(rawDateCell);
    if (rawTimeCell) extractDateAndTime(rawTimeCell);

    if (!workDate || !timeStr) {
      cols.forEach((c) => extractDateAndTime(c));
    }

    if (!userName) {
      const koreanNameCol = cols.find((c) => /^[가-힣]{2,5}$/.test(c));
      if (koreanNameCol) userName = koreanNameCol;
    }

    if (!mode) {
      const modeCol = cols.find((c) =>
        /^(출근|퇴근|해제|세트|경비|입실|퇴실|일반출입)$/.test(c)
      );
      if (modeCol) mode = modeCol;
    }

    if (workDate && timeStr && (userName || userNo)) {
      parsed.push({
        work_date: workDate,
        time_str: timeStr,
        user_no: userNo,
        user_name: userName,
        mode: mode || "출입",
      });
    }
  }

  return parsed;
}

/* ========================================================================= */
/* 5대 연동 제품 브랜드 로고 아이콘 (스크린샷 ad139d94.jpg 동일)              */
/* ========================================================================= */
function BrandLogo({
  kind,
}: {
  kind: "slack" | "gcal" | "secom" | "adt_caps" | "kt_telecop";
}) {
  if (kind === "slack") {
    return (
      <div className="w-9 h-9 rounded-xl bg-white border border-slate-100 flex items-center justify-center shrink-0">
        <svg className="w-6 h-6" viewBox="0 0 24 24">
          <path
            fill="#E01E5A"
            d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
          />
          <path
            fill="#36C5F0"
            d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
          />
          <path
            fill="#2EB67D"
            d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
          />
          <path
            fill="#ECB22E"
            d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
          />
        </svg>
      </div>
    );
  }

  if (kind === "gcal") {
    return (
      <div className="w-9 h-9 rounded-xl bg-white border border-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
        <div className="w-7 h-7 rounded-md border-2 border-[#4285F4] flex flex-col overflow-hidden bg-white">
          <div className="h-1.5 w-full flex">
            <span className="flex-1 bg-[#4285F4]" />
            <span className="w-2 bg-[#EA4335]" />
          </div>
          <div className="flex-1 flex items-center justify-center text-[10px] font-black text-[#1a73e8] leading-none">
            31
          </div>
          <div className="h-1 w-full flex">
            <span className="flex-1 bg-[#34A853]" />
            <span className="w-2 bg-[#FBBC05]" />
          </div>
        </div>
      </div>
    );
  }

  if (kind === "secom") {
    return (
      <div className="w-9 h-9 rounded-xl bg-white border border-slate-100 flex items-center justify-center shrink-0">
        <span className="text-[9px] font-black tracking-tighter text-[#005bac]">
          SECOM
        </span>
      </div>
    );
  }

  if (kind === "adt_caps") {
    return (
      <div className="w-9 h-9 rounded-xl bg-white border border-slate-100 flex items-center justify-center shrink-0">
        <div
          style={{
            clipPath:
              "polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)",
          }}
          className="w-7 h-7 bg-[#005596] flex items-center justify-center text-white text-[8.5px] font-black tracking-tight"
        >
          ADT
        </div>
      </div>
    );
  }

  return (
    <div className="w-9 h-9 rounded-xl bg-white border border-slate-100 flex items-center justify-center shrink-0 relative">
      <span className="text-[13px] font-black tracking-tight text-slate-900">
        kt
      </span>
      <span className="w-1.5 h-1.5 rounded-xs bg-[#ed1c24] ml-0.5 -mt-2" />
    </div>
  );
}

interface Props {
  settings: HqCompanySettings;
  members: HqMember[];
  canEdit: boolean;
  saving: boolean;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onNavigateTab: (tab: HqSettingsTab) => void;
}

const TERMINAL_META: Record<
  HqAccessTerminalProvider,
  { title: string; subtitle: string; brandKey: "secom" | "adt_caps" | "kt_telecop" }
> = {
  secom: {
    title: "에스원 세콤",
    subtitle: "구성원이 세콤 기기를 통해 간편하게 근무를 기록할 수 있어요.",
    brandKey: "secom",
  },
  adt_caps: {
    title: "ADT 캡스",
    subtitle: "구성원이 캡스 기기를 통해 간편하게 근무를 기록할 수 있어요.",
    brandKey: "adt_caps",
  },
  kt_telecop: {
    title: "KT텔레캅",
    subtitle: "구성원이 KT텔레캅 기기를 통해 간편하게 근무를 기록할 수 있어요.",
    brandKey: "kt_telecop",
  },
};

export default function HqIntegrationSettingsSection({
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: Props) {
  const integ: HqIntegrationSettings = useMemo(() => {
    const raw = settings.extra_settings?.integration_settings;
    return {
      slack: { ...DEFAULT_INTEGRATION_SETTINGS.slack, ...(raw?.slack || {}) },
      google_calendar: {
        ...DEFAULT_INTEGRATION_SETTINGS.google_calendar,
        ...(raw?.google_calendar || {}),
      },
      secom: { ...DEFAULT_INTEGRATION_SETTINGS.secom, ...(raw?.secom || {}) },
      adt_caps: {
        ...DEFAULT_INTEGRATION_SETTINGS.adt_caps,
        ...(raw?.adt_caps || {}),
      },
      kt_telecop: {
        ...DEFAULT_INTEGRATION_SETTINGS.kt_telecop,
        ...(raw?.kt_telecop || {}),
      },
    };
  }, [settings.extra_settings?.integration_settings]);

  // 서버 환경변수 상태 조회 (Google 서비스 계정 이메일 · 기본 TARGET_CALENDAR_ID)
  const [serverEnv, setServerEnv] = useState<{
    hasGoogleServiceAccount: boolean;
    serviceAccountEmail: string;
    defaultTargetCalendarId: string;
  }>({
    hasGoogleServiceAccount: false,
    serviceAccountEmail: "",
    defaultTargetCalendarId: "",
  });

  useEffect(() => {
    hqFetch<{
      success: boolean;
      data: {
        hasGoogleServiceAccount: boolean;
        serviceAccountEmail: string;
        defaultTargetCalendarId: string;
      };
    }>("/api/hq/integrations")
      .then((res) => {
        if (res.data) setServerEnv(res.data);
      })
      .catch(() => {});
  }, []);

  // 모달 오픈 상태
  const [slackDraft, setSlackDraft] =
    useState<HqSlackIntegrationConfig | null>(null);
  const [gcalDraft, setGcalDraft] =
    useState<HqGoogleCalendarIntegrationConfig | null>(null);
  const [terminalModal, setTerminalModal] = useState<{
    provider: HqAccessTerminalProvider;
    draft: HqAccessTerminalConfig;
  } | null>(null);
  const [terminalSubTab, setTerminalSubTab] = useState<
    "BASIC" | "MAPPING" | "CSV"
  >("BASIC");

  // 비동기 테스트/동기화 진행 상태
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [gcalStatusMsg, setGcalStatusMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // CSV 파싱 미리보기 상태
  const [csvFileName, setCsvFileName] = useState("");
  const [csvPreviewRows, setCsvPreviewRows] = useState<ParsedCsvPunch[]>([]);
  const [csvResultMsg, setCsvResultMsg] = useState<string | null>(null);

  const activeMembers = useMemo(
    () =>
      members
        .filter((m) => m.work_status !== "퇴직")
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [members]
  );

  const saveIntegrationPatch = async (
    partial: Partial<HqIntegrationSettings>,
    toastMessage: string
  ) => {
    await onSaveExtra(
      {
        integration_settings: {
          ...integ,
          ...partial,
        },
      },
      toastMessage
    );
  };

  const renderSwitch = (
    checked: boolean,
    onToggle: () => void,
    disabled = false
  ) => (
    <button
      type="button"
      disabled={!canEdit || disabled || saving}
      onClick={onToggle}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
        checked ? "bg-[#00c458]" : "bg-slate-200"
      } ${!canEdit || disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`w-4 h-4 rounded-full bg-white shadow-xs absolute top-1 transition-all ${
          checked ? "left-6" : "left-1"
        }`}
      />
    </button>
  );

  const copyText = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore
    }
  };

  // =========================================================================
  // 1) Google Calendar 연결 테스트 & 지금 동기화
  // =========================================================================
  const handleTestGoogleCalendar = async () => {
    if (!gcalDraft) return;
    setBusyAction("TEST_GCAL");
    setGcalStatusMsg(null);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { calendarId: string; summary: string };
      }>("/api/hq/integrations", {
        method: "POST",
        body: {
          action: "TEST_GCAL",
          calendar_id: gcalDraft.calendar_id,
        },
      });
      const title = res.data?.summary || "";
      setGcalDraft({
        ...gcalDraft,
        verified_calendar_title: title,
      });
      setGcalStatusMsg(`✅ 연결 확인 완료: '${title}' 캘린더에 정상 접근됩니다.`);
    } catch (err: any) {
      setGcalStatusMsg(
        `⚠️ 연결 확인 실패: ${err?.message || "캘린더 공유 권한을 확인해주세요."}`
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncGoogleCalendarNow = async () => {
    if (!gcalDraft) return;
    setBusyAction("SYNC_GCAL");
    setGcalStatusMsg(null);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { syncedCount: number; calendarSummary: string };
      }>("/api/hq/integrations", {
        method: "POST",
        body: {
          action: "SYNC_GCAL_NOW",
          calendar_id: gcalDraft.calendar_id,
        },
      });
      const nowIso = new Date().toISOString();
      const updated: HqGoogleCalendarIntegrationConfig = {
        ...gcalDraft,
        enabled: true,
        last_synced_at: nowIso,
        verified_calendar_title: res.data.calendarSummary,
      };
      setGcalDraft(updated);
      await saveIntegrationPatch(
        { google_calendar: updated },
        `Google Calendar('${res.data.calendarSummary}')에 ${res.data.syncedCount}건의 신규 일정이 동기화되었습니다.`
      );
      setGcalStatusMsg(
        `✅ '${res.data.calendarSummary}' 동기화 완료 (신규 등록 ${res.data.syncedCount}건)`
      );
    } catch (err: any) {
      setGcalStatusMsg(`⚠️ 동기화 실패: ${err?.message || "오류 발생"}`);
    } finally {
      setBusyAction(null);
    }
  };

  // =========================================================================
  // 2) ADT 캡스 / 에스원 세콤 / KT텔레캅 모달 열기 & CSV 파일 파싱·반영
  // =========================================================================
  const openTerminalModal = (provider: HqAccessTerminalProvider) => {
    const base = integ[provider];
    const mapByName = new Map(
      (base.member_mappings || []).map((m) => [m.member_name, m])
    );
    const mergedMappings: HqTerminalCardMapping[] = activeMembers.map((m) => {
      const prev = mapByName.get(m.name);
      const defaultEmpNo =
        m.name === "테스트51" && !m.employee_no
          ? "HQ-2026-C2FD"
          : m.employee_no || "";
      return {
        member_id: m.instructor_id,
        member_name: m.name,
        department: m.department,
        terminal_user_no: prev?.terminal_user_no || defaultEmpNo,
      };
    });

    setTerminalSubTab("BASIC");
    setCsvFileName("");
    setCsvPreviewRows([]);
    setCsvResultMsg(null);
    setTerminalModal({
      provider,
      draft: {
        ...base,
        webhook_secret:
          base.webhook_secret || randomSecret(`hq-${provider}`),
        member_mappings: mergedMappings,
      },
    });
  };

  const handleSelectTerminalCsv = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    setCsvResultMsg(null);

    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    // 한국 캡스/세콤 프로그램의 기본 CP949(EUC-KR) CSV 한글 깨짐 자동 복원
    if (text.includes("\uFFFD")) {
      try {
        text = new TextDecoder("euc-kr").decode(buf);
      } catch {
        // fallback utf-8
      }
    }
    const rows = parseAccessControlCsv(text);
    setCsvPreviewRows(rows);
    if (rows.length === 0) {
      setCsvResultMsg(
        "⚠️ 인식 가능한 출입 기록 행을 찾지 못했습니다. (일자, 시각, 성명 또는 카드번호 열을 확인해주세요.)"
      );
    }
  };

  const handleDownloadSampleCsv = (providerTitle: string) => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(now.getDate()).padStart(2, "0")}`;
    const otherMember =
      activeMembers.find((m) => m.name !== "테스트51")?.name || "천종현";
    const csv =
      "\uFEFF발생일자,출입시각,카드번호,성명,출입모드\r\n" +
      `${today},08:52:10,HQ-2026-C2FD,테스트51,출근\r\n` +
      `${today},18:14:35,HQ-2026-C2FD,테스트51,퇴근\r\n` +
      `${today},08:58:04,CAPS-002,${otherMember},출근\r\n` +
      `${today},18:30:22,CAPS-002,${otherMember},퇴근\r\n`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${providerTitle}_출입기록_업로드샘플.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTerminalPunches = async (
    eventsToSend: ParsedCsvPunch[],
    isQuickTest = false
  ) => {
    if (!terminalModal) return;
    setBusyAction("IMPORT_TERMINAL");
    setCsvResultMsg(null);
    try {
      // 먼저 현재 매핑 설정도 함께 저장
      const preSaved: HqAccessTerminalConfig = {
        ...terminalModal.draft,
        enabled: true,
      };
      const res = await hqFetch<{
        success: boolean;
        data: {
          matchedPunches: number;
          upsertedDays: number;
          unmatchedIdentifiers: string[];
        };
      }>("/api/hq/integrations", {
        method: "POST",
        body: {
          action: "IMPORT_TERMINAL",
          provider: terminalModal.provider,
          events: eventsToSend,
        },
      });

      const summaryText = `최근 반영 ${res.data.upsertedDays}건 (타각 ${res.data.matchedPunches}회 매칭)`;
      const updatedDraft: HqAccessTerminalConfig = {
        ...preSaved,
        last_synced_at: new Date().toISOString(),
        last_synced_summary: summaryText,
      };
      setTerminalModal({ ...terminalModal, draft: updatedDraft });
      await saveIntegrationPatch(
        { [terminalModal.provider]: updatedDraft },
        isQuickTest
          ? `${TERMINAL_META[terminalModal.provider].title} 테스트 출입 기록이 근태 현황에 반영되었습니다.`
          : `${TERMINAL_META[terminalModal.provider].title} 출입 기록 ${res.data.upsertedDays}건이 근태에 반영되었습니다.`
      );

      const unmatchedNote =
        res.data.unmatchedIdentifiers.length > 0
          ? ` (미매칭 이름/번호: ${res.data.unmatchedIdentifiers.join(", ")})`
          : "";
      setCsvResultMsg(
        `✅ 총 ${res.data.matchedPunches}건의 출입 이벤트를 분석하여 ${res.data.upsertedDays}건의 일별 출퇴근 기록을 반영했습니다.${unmatchedNote}`
      );
      window.dispatchEvent(new Event("hq:attendance-updated"));
    } catch (err: any) {
      setCsvResultMsg(`⚠️ 근태 반영 실패: ${err?.message || "오류 발생"}`);
    } finally {
      setBusyAction(null);
    }
  };

  // =========================================================================
  // 3) Slack 테스트 발송
  // =========================================================================
  const handleTestSlack = async () => {
    if (!slackDraft) return;
    setBusyAction("TEST_SLACK");
    try {
      await hqFetch("/api/hq/integrations", {
        method: "POST",
        body: {
          action: "TEST_SLACK",
          webhook_url: slackDraft.webhook_url,
          channel_name: slackDraft.channel_name,
        },
      });
      setSlackDraft({
        ...slackDraft,
        last_tested_at: new Date().toISOString(),
      });
      alert("Slack 채널로 테스트 메시지가 정상 발송되었습니다!");
    } catch (err: any) {
      alert(err?.message || "Slack 웹훅 발송 실패");
    } finally {
      setBusyAction(null);
    }
  };

  const renderStatusRight = (connected: boolean) =>
    connected ? (
      <span className="flex items-center gap-2 shrink-0">
        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-[#00a84b] text-[10px] font-extrabold">
          연결됨
        </span>
        <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
          <span>설정 관리</span>
          <span className="text-slate-400">›</span>
        </span>
      </span>
    ) : (
      <span className="text-xs font-semibold text-slate-600 flex items-center gap-1 shrink-0">
        <span>연결하기</span>
        <span className="text-slate-400">›</span>
      </span>
    );

  const webhookBaseUrl =
    typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <div className="space-y-9">
        {/* 상단 타이틀 (스크린샷 ad139d94.jpg 동일) */}
        <div>
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            연결 설정
          </h2>
        </div>

        {/* 다른 제품과 연결 (5개 카드) */}
        <section className="space-y-3.5">
          <div>
            <h3 className="text-[15px] font-extrabold text-slate-900">
              다른 제품과 연결
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              사용 중인 다른 제품과 연동해서 생산성을 올려보세요.
            </p>
          </div>

          <div className="space-y-2.5">
            {/* 1. Slack */}
            <div
              onClick={() => setSlackDraft({ ...integ.slack })}
              className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-4 cursor-pointer shadow-2xs transition-colors"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <BrandLogo kind="slack" />
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-slate-900">
                    Slack
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    출/퇴근 기록 및 워크플로우 등 승인관리, 휴가 사용 등을 확인할 수 있어요.
                  </p>
                </div>
              </div>
              {renderStatusRight(
                Boolean(integ.slack.enabled && integ.slack.webhook_url)
              )}
            </div>

            {/* 2. Google Calendar */}
            <div
              onClick={() => {
                setGcalStatusMsg(null);
                setGcalDraft({ ...integ.google_calendar });
              }}
              className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-4 cursor-pointer shadow-2xs transition-colors"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <BrandLogo kind="gcal" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-slate-900">
                      Google Calendar
                    </span>
                    {integ.google_calendar.verified_calendar_title && (
                      <span className="text-[11px] text-blue-600 font-semibold truncate max-w-[200px]">
                        · {integ.google_calendar.verified_calendar_title}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    구성원의 근무, 휴가 일정과 채용 인터뷰 일정을 손 쉽게 확인할 수 있어요.
                  </p>
                </div>
              </div>
              {renderStatusRight(integ.google_calendar.enabled)}
            </div>

            {/* 3. 에스원 세콤 / 4. ADT 캡스 / 5. KT텔레캅 */}
            {(["secom", "adt_caps", "kt_telecop"] as const).map((prov) => {
              const meta = TERMINAL_META[prov];
              const cfg = integ[prov];
              return (
                <div
                  key={prov}
                  onClick={() => openTerminalModal(prov)}
                  className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-4 cursor-pointer shadow-2xs transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <BrandLogo kind={meta.brandKey} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-slate-900">
                          {meta.title}
                        </span>
                        {cfg.last_synced_summary && (
                          <span className="text-[11px] text-slate-400 truncate max-w-[220px]">
                            · {cfg.last_synced_summary}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {meta.subtitle}
                      </p>
                    </div>
                  </div>
                  {renderStatusRight(cfg.enabled)}
                </div>
              );
            })}
          </div>

          {/* 하단 안내 문구 + 근무 유형 바로가기 (스크린샷 동일) */}
          <p className="text-[11px] text-slate-400 pt-1">
            근무 유형 항목의 고급 설정에서 출퇴근 기록 수단을 설정할 수 있어요.{" "}
            <button
              type="button"
              onClick={() => onNavigateTab("work-type")}
              className="text-blue-600 font-semibold hover:underline"
            >
              근무 유형 바로가기
            </button>
          </p>
        </section>

        {/* 하단 전체폭 단일 이전으로 카드 (마지막 설정 메뉴 — 스크린샷 동일) */}
        <div className="pt-8">
          <button
            type="button"
            onClick={() => onNavigateTab("permission-setting")}
            className="w-full px-6 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                권한 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 모달 1: Google Calendar 실제 연동 설정 모달                        */}
      {/* ================================================================= */}
      {gcalDraft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[520px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <BrandLogo kind="gcal" />
                <div>
                  <h3 className="text-[15px] font-extrabold text-slate-900">
                    Google Calendar 연결 설정
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    휴가 · 출장 · 사내 쉬는 날을 Google 공유 캘린더에 자동 등록합니다.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGcalDraft(null)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll p-6 space-y-5">
              {/* 서비스 계정 안내 박스 */}
              <div className="rounded-xl bg-blue-50/70 border border-blue-100 p-4 space-y-2">
                <div className="font-extrabold text-blue-900 flex items-center justify-between">
                  <span>
                    {serverEnv.hasGoogleServiceAccount
                      ? "🟢 서버 Google 서비스 계정 준비됨"
                      : "⚠️ 서버 Google 서비스 계정 미설정"}
                  </span>
                  {serverEnv.serviceAccountEmail && (
                    <button
                      type="button"
                      onClick={() =>
                        copyText("gcal-sa", serverEnv.serviceAccountEmail)
                      }
                      className="px-2 py-0.5 rounded bg-white border border-blue-200 text-[10px] font-bold text-blue-700"
                    >
                      {copiedKey === "gcal-sa" ? "✓ 복사됨" : "이메일 복사"}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-blue-800/80 leading-relaxed">
                  Google 캘린더의 <b>[설정 및 공유 &gt; 특정 사용자와 공유]</b>에{" "}
                  <code className="px-1 py-0.5 rounded bg-white text-[10px] font-mono">
                    {serverEnv.serviceAccountEmail || "GOOGLE_CLIENT_EMAIL"}
                  </code>{" "}
                  계정을 <b>일정 변경 권한</b>으로 추가하면 모든 본사 휴가·출장 일정이 실시간 자동 기록됩니다.
                </p>
              </div>

              {/* 활성화 스위치 */}
              <div className="px-4 py-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800">
                    Google Calendar 자동 연동 사용
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    전자결재 승인 즉시 구글 캘린더에 일정을 생성해요.
                  </div>
                </div>
                {renderSwitch(gcalDraft.enabled, () =>
                  setGcalDraft({ ...gcalDraft, enabled: !gcalDraft.enabled })
                )}
              </div>

              {/* 캘린더 ID & 일정 말머리 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    연동할 Google Calendar ID
                  </label>
                  <input
                    value={gcalDraft.calendar_id}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setGcalDraft({
                        ...gcalDraft,
                        calendar_id: e.target.value,
                      })
                    }
                    placeholder={
                      serverEnv.defaultTargetCalendarId
                        ? `기본값: ${serverEnv.defaultTargetCalendarId}`
                        : "예: xxx@group.calendar.google.com"
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-mono text-[11px] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    일정 말머리
                  </label>
                  <input
                    value={gcalDraft.event_prefix}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setGcalDraft({
                        ...gcalDraft,
                        event_prefix: e.target.value,
                      })
                    }
                    placeholder="[HQ]"
                    className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold focus:outline-none"
                  />
                </div>
              </div>

              {/* 동기화 항목 선택 */}
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-800">
                      🏖️ 휴가 · 연차 · 반차 일정 동기화
                    </div>
                    <div className="text-[11px] text-slate-400">
                      휴가 신청서가 최종 승인되면 캘린더에 자동 등록해요.
                    </div>
                  </div>
                  {renderSwitch(gcalDraft.sync_leaves, () =>
                    setGcalDraft({
                      ...gcalDraft,
                      sync_leaves: !gcalDraft.sync_leaves,
                    })
                  )}
                </div>

                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-800">
                      ✈️ 외근 · 출장 · 원격근무 일정 동기화
                    </div>
                    <div className="text-[11px] text-slate-400">
                      출장·외근 등 근무 결재 승인 시 캘린더에 표시해요.
                    </div>
                  </div>
                  {renderSwitch(gcalDraft.sync_work_forms, () =>
                    setGcalDraft({
                      ...gcalDraft,
                      sync_work_forms: !gcalDraft.sync_work_forms,
                    })
                  )}
                </div>

                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-800">
                      🏢 회사 지정 쉬는 날 동기화
                    </div>
                    <div className="text-[11px] text-slate-400">
                      창립기념일 등 회사 자체 지정 휴무일을 함께 등록해요.
                    </div>
                  </div>
                  {renderSwitch(gcalDraft.sync_company_holidays, () =>
                    setGcalDraft({
                      ...gcalDraft,
                      sync_company_holidays: !gcalDraft.sync_company_holidays,
                    })
                  )}
                </div>
              </div>

              {/* 실시간 테스트 & 즉시 동기화 */}
              {canEdit && (
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleTestGoogleCalendar}
                    className="py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 font-bold text-slate-700"
                  >
                    {busyAction === "TEST_GCAL"
                      ? "확인 중..."
                      : "🔌 연결 권한 테스트"}
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleSyncGoogleCalendarNow}
                    className="py-2.5 rounded-xl border border-blue-200 bg-blue-50/60 hover:bg-blue-50 font-extrabold text-blue-700"
                  >
                    {busyAction === "SYNC_GCAL"
                      ? "동기화 중..."
                      : "🔄 기존 승인 일정 지금 동기화"}
                  </button>
                </div>
              )}

              {gcalStatusMsg && (
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-semibold text-slate-700">
                  {gcalStatusMsg}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setGcalDraft(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600"
              >
                취소
              </button>
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await saveIntegrationPatch(
                      { google_calendar: gcalDraft },
                      gcalDraft.enabled
                        ? "Google Calendar 연동 설정이 저장되었습니다."
                        : "Google Calendar 연동이 해제되었습니다."
                    );
                    setGcalDraft(null);
                  }}
                  className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold"
                >
                  저장하기
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 2: ADT 캡스 / 에스원 세콤 / KT텔레캅 출퇴근 단말기 연동 모달  */}
      {/* ================================================================= */}
      {terminalModal && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[600px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs">
            {/* 헤더 */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <BrandLogo
                  kind={TERMINAL_META[terminalModal.provider].brandKey}
                />
                <div>
                  <h3 className="text-[15px] font-extrabold text-slate-900">
                    {TERMINAL_META[terminalModal.provider].title} 출퇴근 기기 연결
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    출입리더기 실시간 웹훅 API 및 출입내역 CSV 일괄 가져오기를 모두 지원합니다.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTerminalModal(null)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            {/* 3탭 네비게이션 */}
            <div className="px-6 pt-3 border-b border-slate-100 flex items-center gap-5 shrink-0">
              {(
                [
                  { key: "BASIC", label: "기본 설정 · 실시간 API" },
                  {
                    key: "MAPPING",
                    label: `구성원 카드·사번 매핑 (${activeMembers.length})`,
                  },
                  { key: "CSV", label: "출입기록 파일(CSV) 반영" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTerminalSubTab(t.key)}
                  className={`pb-2.5 border-b-2 transition-colors ${
                    terminalSubTab === t.key
                      ? "border-slate-900 text-slate-900 font-extrabold"
                      : "border-transparent text-slate-400 hover:text-slate-700 font-semibold"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* 본문 */}
            <div className="flex-1 overflow-y-auto custom-scroll p-6 space-y-5">
              {/* 탭 1: 기본 설정 & 실시간 웹훅 API */}
              {terminalSubTab === "BASIC" && (
                <>
                  <div className="px-4 py-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-800">
                        {TERMINAL_META[terminalModal.provider].title} 출퇴근 연동 사용
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        단말기 인증 기록을 본사 근태(출근·퇴근)에 자동 반영해요.
                      </div>
                    </div>
                    {renderSwitch(terminalModal.draft.enabled, () =>
                      setTerminalModal({
                        ...terminalModal,
                        draft: {
                          ...terminalModal.draft,
                          enabled: !terminalModal.draft.enabled,
                        },
                      })
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                        단말기 · 출입구 명칭
                      </label>
                      <input
                        value={terminalModal.draft.terminal_name}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setTerminalModal({
                            ...terminalModal,
                            draft: {
                              ...terminalModal.draft,
                              terminal_name: e.target.value,
                            },
                          })
                        }
                        placeholder="예: 본사 402호 캡스 리더기"
                        className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                        계약번호 / 사업장 코드 (선택)
                      </label>
                      <input
                        value={terminalModal.draft.contract_no}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setTerminalModal({
                            ...terminalModal,
                            draft: {
                              ...terminalModal.draft,
                              contract_no: e.target.value,
                            },
                          })
                        }
                        placeholder="예: CAPS-2026-0402"
                        className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-mono focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* 출퇴근 판정 기준 */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                      출퇴근 시각 자동 판정 규칙
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      {(
                        [
                          {
                            val: "FIRST_IN_LAST_OUT",
                            title: "최초 출입 = 출근 · 최종 출입 = 퇴근",
                            desc: "일반 지문·카드 출입문 환경에 권장",
                          },
                          {
                            val: "EXPLICIT_MODE",
                            title: "단말기 출근/퇴근(해제/세트) 버튼 구분",
                            desc: "리더기에서 출근·퇴근 모드를 눌러 태깅할 때",
                          },
                        ] as const
                      ).map((opt) => {
                        const active =
                          terminalModal.draft.punch_rule === opt.val;
                        return (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() =>
                              setTerminalModal({
                                ...terminalModal,
                                draft: {
                                  ...terminalModal.draft,
                                  punch_rule: opt.val,
                                },
                              })
                            }
                            className={`p-3.5 rounded-xl border text-left transition-all ${
                              active
                                ? "border-[#00c458] bg-emerald-50/30"
                                : "border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            <div className="font-bold text-slate-800">
                              {opt.title}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {opt.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 실시간 브릿지 웹훅 엔드포인트 & 인증키 */}
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
                    <div className="font-extrabold text-slate-800">
                      🔗 실시간 단말기 브릿지 Webhook API 정보
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200">
                        <code className="text-[10px] font-mono text-slate-700 truncate">
                          POST {webhookBaseUrl}
                          /api/webhooks/attendance-terminal?provider=
                          {terminalModal.provider}
                        </code>
                        <button
                          type="button"
                          onClick={() =>
                            copyText(
                              "wh-url",
                              `${webhookBaseUrl}/api/webhooks/attendance-terminal?provider=${terminalModal.provider}`
                            )
                          }
                          className="text-[10px] font-bold text-blue-600 shrink-0"
                        >
                          {copiedKey === "wh-url" ? "✓ 복사됨" : "URL 복사"}
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200">
                        <span className="text-[11px] text-slate-500">
                          Header <code className="font-mono">x-terminal-key</code>:{" "}
                          <b className="font-mono text-slate-800">
                            {terminalModal.draft.webhook_secret}
                          </b>
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() =>
                                setTerminalModal({
                                  ...terminalModal,
                                  draft: {
                                    ...terminalModal.draft,
                                    webhook_secret: randomSecret(
                                      `hq-${terminalModal.provider}`
                                    ),
                                  },
                                })
                              }
                              className="text-[10px] font-bold text-slate-500 hover:text-slate-800"
                            >
                              재발급
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              copyText(
                                "wh-key",
                                terminalModal.draft.webhook_secret
                              )
                            }
                            className="text-[10px] font-bold text-blue-600"
                          >
                            {copiedKey === "wh-key" ? "✓ 복사됨" : "키 복사"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {canEdit && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => {
                          const now = new Date();
                          const ymd = `${now.getFullYear()}-${String(
                            now.getMonth() + 1
                          ).padStart(2, "0")}-${String(now.getDate()).padStart(
                            2,
                            "0"
                          )}`;
                          const hh = String(now.getHours()).padStart(2, "0");
                          const mm = String(now.getMinutes()).padStart(2, "0");
                          const targetMember = activeMembers.find(
                            (m) =>
                              m.name === "테스트51" ||
                              m.employee_no === "HQ-2026-C2FD"
                          );
                          const simName = targetMember?.name || "테스트51";
                          const simUserNo =
                            targetMember?.employee_no || "HQ-2026-C2FD";
                          handleImportTerminalPunches(
                            [
                              {
                                work_date: ymd,
                                time_str: `${hh}:${mm}:00`,
                                user_no: simUserNo,
                                user_name: simName,
                                mode: "출근",
                              },
                            ],
                            true
                          );
                        }}
                        className="w-full py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-[11px] font-bold text-slate-700"
                      >
                        ⚡ 테스트 타각 전송 (테스트51 님 · HQ-2026-C2FD 현재시각 출입 시뮬레이션)
                      </button>
                    )}

                    {csvResultMsg && (
                      <div className="text-[11px] font-semibold text-emerald-700">
                        {csvResultMsg}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* 탭 2: 구성원별 카드번호·사번 매핑 */}
              {terminalSubTab === "MAPPING" && (
                <div className="space-y-3">
                  <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-[11px] text-slate-600 leading-relaxed">
                    단말기에 등록된 <b>카드번호·지문 ID·사원번호</b>를 입력해 두면 동명이인이 있거나 이름 없이 번호만 기록되는 캡스 로그도 정확하게 매칭됩니다. (비워두면 <b>성명</b>으로 자동 매칭됩니다.)
                  </div>

                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                    {terminalModal.draft.member_mappings.map((mp, idx) => (
                      <div
                        key={mp.member_name}
                        className="px-4 py-2.5 flex items-center justify-between gap-3"
                      >
                        <div>
                          <span className="font-bold text-slate-800">
                            {mp.member_name}
                          </span>
                          <span className="ml-2 text-[11px] text-slate-400">
                            {mp.department}
                          </span>
                        </div>
                        <input
                          value={mp.terminal_user_no}
                          disabled={!canEdit}
                          onChange={(e) => {
                            const next = [
                              ...terminalModal.draft.member_mappings,
                            ];
                            next[idx] = {
                              ...mp,
                              terminal_user_no: e.target.value,
                            };
                            setTerminalModal({
                              ...terminalModal,
                              draft: {
                                ...terminalModal.draft,
                                member_mappings: next,
                              },
                            });
                          }}
                          placeholder="카드번호 / 단말기 ID (선택)"
                          className="w-48 px-3 py-1.5 rounded-lg bg-[#f5f6f8] font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-[#00c458]"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 탭 3: 캡스/세콤 출입기록 CSV 파일 일괄 반영 */}
              {terminalSubTab === "CSV" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-slate-500">
                      {TERMINAL_META[terminalModal.provider].title} 관리 프로그램에서 내보낸{" "}
                      <b>출입이력 CSV 파일</b>(한글 CP949 · UTF-8 자동 지원)을 업로드하면 일자별 출근·퇴근을 자동 계산해 근태에 반영합니다.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadSampleCsv(
                          TERMINAL_META[terminalModal.provider].title
                        )
                      }
                      className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-bold text-slate-700 shrink-0 ml-2"
                    >
                      ⬇️ 샘플 CSV
                    </button>
                  </div>

                  <label className="w-full py-6 px-4 rounded-2xl border-2 border-dashed border-slate-200 hover:border-[#00c458] bg-slate-50/50 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors">
                    <span className="text-xl">📂</span>
                    <span className="font-extrabold text-slate-700">
                      {csvFileName ||
                        `${
                          TERMINAL_META[terminalModal.provider].title
                        } 출입이력 CSV 파일 선택`}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      발생일자 · 출입시각 · 성명(또는 카드번호) 열 자동 인식
                    </span>
                    <input
                      type="file"
                      accept=".csv,.txt"
                      onChange={handleSelectTerminalCsv}
                      className="hidden"
                    />
                  </label>

                  {csvPreviewRows.length > 0 && (
                    <div className="space-y-3">
                      <div className="text-[11px] font-bold text-slate-600">
                        미리보기 ({csvPreviewRows.length}건의 출입 태깅 감지됨)
                      </div>
                      <div className="max-h-[180px] overflow-y-auto custom-scroll rounded-xl border border-slate-200">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-slate-50 text-slate-500 font-bold sticky top-0">
                            <tr>
                              <th className="px-3 py-2">일자</th>
                              <th className="px-3 py-2">시각</th>
                              <th className="px-3 py-2">성명</th>
                              <th className="px-3 py-2">카드/사번</th>
                              <th className="px-3 py-2">구분</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {csvPreviewRows.slice(0, 30).map((r, idx) => (
                              <tr key={idx}>
                                <td className="px-3 py-1.5 font-mono">
                                  {r.work_date}
                                </td>
                                <td className="px-3 py-1.5 font-mono">
                                  {r.time_str}
                                </td>
                                <td className="px-3 py-1.5 font-bold text-slate-800">
                                  {r.user_name || "-"}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-slate-500">
                                  {r.user_no || "-"}
                                </td>
                                <td className="px-3 py-1.5 text-slate-600">
                                  {r.mode}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {canEdit && (
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            handleImportTerminalPunches(csvPreviewRows, false)
                          }
                          className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold"
                        >
                          {busyAction === "IMPORT_TERMINAL"
                            ? "근태 기록 반영 중..."
                            : `📥 ${csvPreviewRows.length}건 출입기록으로 출퇴근 일괄 반영하기`}
                        </button>
                      )}
                    </div>
                  )}

                  {csvResultMsg && (
                    <div className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-semibold text-slate-700">
                      {csvResultMsg}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 푸터 */}
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setTerminalModal(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600"
              >
                닫기
              </button>
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await saveIntegrationPatch(
                      { [terminalModal.provider]: terminalModal.draft },
                      `${
                        TERMINAL_META[terminalModal.provider].title
                      } 연결 설정이 저장되었습니다.`
                    );
                    setTerminalModal(null);
                  }}
                  className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold"
                >
                  설정 저장
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 3: Slack Incoming Webhook 연동 설정 모달                      */}
      {/* ================================================================= */}
      {slackDraft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[480px] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <BrandLogo kind="slack" />
                <div>
                  <h3 className="text-[15px] font-extrabold text-slate-900">
                    Slack 연결 설정
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    출퇴근 · 휴가 · 전자결재 승인 알림을 슬랙 채널로 발송해요.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSlackDraft(null)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="px-4 py-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <span className="font-bold text-slate-800">Slack 알림 사용</span>
                {renderSwitch(slackDraft.enabled, () =>
                  setSlackDraft({ ...slackDraft, enabled: !slackDraft.enabled })
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                  Slack Incoming Webhook URL
                </label>
                <input
                  value={slackDraft.webhook_url}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSlackDraft({
                      ...slackDraft,
                      webhook_url: e.target.value,
                    })
                  }
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-mono text-[11px] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                  수신 채널 표기명
                </label>
                <input
                  value={slackDraft.channel_name}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSlackDraft({
                      ...slackDraft,
                      channel_name: e.target.value,
                    })
                  }
                  placeholder="#본사-근태알림"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold focus:outline-none"
                />
              </div>

              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="font-bold text-slate-700">
                    출근 · 퇴근 실시간 알림
                  </span>
                  {renderSwitch(slackDraft.notify_attendance, () =>
                    setSlackDraft({
                      ...slackDraft,
                      notify_attendance: !slackDraft.notify_attendance,
                    })
                  )}
                </div>
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="font-bold text-slate-700">
                    휴가 · 반차 승인 알림
                  </span>
                  {renderSwitch(slackDraft.notify_leave, () =>
                    setSlackDraft({
                      ...slackDraft,
                      notify_leave: !slackDraft.notify_leave,
                    })
                  )}
                </div>
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="font-bold text-slate-700">
                    전자결재 · 품의 승인 완료 알림
                  </span>
                  {renderSwitch(slackDraft.notify_approval, () =>
                    setSlackDraft({
                      ...slackDraft,
                      notify_approval: !slackDraft.notify_approval,
                    })
                  )}
                </div>
              </div>

              {canEdit && slackDraft.webhook_url && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={handleTestSlack}
                  className="w-full py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 font-bold text-slate-700"
                >
                  {busyAction === "TEST_SLACK"
                    ? "발송 중..."
                    : "📨 Slack 테스트 메시지 발송"}
                </button>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSlackDraft(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600"
              >
                취소
              </button>
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await saveIntegrationPatch(
                      { slack: slackDraft },
                      "Slack 연결 설정이 저장되었습니다."
                    );
                    setSlackDraft(null);
                  }}
                  className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold"
                >
                  저장하기
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
