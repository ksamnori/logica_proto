// src/app/supervisor/supervisorUtils.ts
import { createClient } from '@supabase/supabase-js';

// --- 환경 변수 & 초기 설정 ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const CLINIC_ROOM = 'logica-clinic-room';

export const SEAT_ROWS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const SEAT_COLS = 10;
export const seats = SEAT_ROWS.flatMap(row => 
    Array.from({ length: SEAT_COLS }, (_, i) => `${row}-${String(i + 1).padStart(2, '0')}`)
);

export const DEFAULT_CLINIC_DURATION_MS = 60 * 60 * 1000;
export const ALERT_THRESHOLD_MS = 3 * 60 * 1000;
export const LOG_AUTO_EXPIRE_MS = 5 * 60 * 1000;
export const PENDING_GUARD_MS = 8000;
// 학생 화면의 하트비트 주기(15초)보다 충분히 여유를 둔 타임아웃(45초) — 이 시간 동안
// last_seen_at 갱신이 없으면 전원 종료/크래시 등으로 보고 비정상 종료 처리한다.
export const HEARTBEAT_TIMEOUT_MS = 45 * 1000;

// 한국 표준시(KST) 기준 날짜 문자열 구하기
export const getKSTDateString = () => {
    const kstTime = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return kstTime.toISOString().split('T')[0];
};

export const formatDuration = (ms: number) => {
    if (ms < 0 || isNaN(ms)) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

export const formatShortAgo = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}초`;
    return `${Math.floor(sec / 60)}분`;
};

// 시:분만 표시 (클리닉 이용 기록용) — 예: 5400000ms -> "1:30"
export const formatHM = (ms: number) => {
    if (ms < 0 || isNaN(ms)) ms = 0;
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
};

// 시각(HH:MM) 표시 (클리닉 이용 기록의 시작/종료 시각용)
export const formatClockTime = (ms: number) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });