// src/lib/hq/defaultIntegrationSettings.ts
import type { HqIntegrationSettings } from "./types";

/**
 * 본부(HQ) 기본 Google 캘린더 ID
 * - 서비스 계정(logica-bot@logica-minutes.iam.gserviceaccount.com)이 공유 초대된 본부 캘린더
 * - 학원 공용 캘린더(TARGET_CALENDAR_ID)와 분리하여 본부 대시보드에 표시
 */
export const HQ_DEFAULT_GOOGLE_CALENDAR_ID = "01000math@gmail.com";

export const DEFAULT_INTEGRATION_SETTINGS: HqIntegrationSettings = {
  slack: {
    enabled: false,
    webhook_url: "",
    channel_name: "#본사-근태알림",
    notify_attendance: true,
    notify_leave: true,
    notify_approval: true,
    last_tested_at: null,
  },
  google_calendar: {
    enabled: false,
    calendar_id: "",
    event_prefix: "[HQ]",
    sync_leaves: true,
    sync_work_forms: true,
    sync_company_holidays: false,
    last_synced_at: null,
    verified_calendar_title: null,
  },
  secom: {
    enabled: false,
    terminal_name: "에스원 세콤 출입단말기",
    contract_no: "",
    webhook_secret: "hq-secom-bridge-key",
    punch_rule: "FIRST_IN_LAST_OUT",
    member_mappings: [],
    last_synced_at: null,
    last_synced_summary: null,
  },
  adt_caps: {
    enabled: false,
    terminal_name: "본사 402호 ADT 캡스 출입리더기",
    contract_no: "",
    webhook_secret: "hq-adtcaps-bridge-key",
    punch_rule: "FIRST_IN_LAST_OUT",
    member_mappings: [],
    last_synced_at: null,
    last_synced_summary: null,
  },
  kt_telecop: {
    enabled: false,
    terminal_name: "KT텔레캅 출입단말기",
    contract_no: "",
    webhook_secret: "hq-kttelecop-bridge-key",
    punch_rule: "FIRST_IN_LAST_OUT",
    member_mappings: [],
    last_synced_at: null,
    last_synced_summary: null,
  },
};
