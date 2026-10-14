// src/app/supervisor/supervisorUtils.ts
export { supabase as supabaseClient, CLINIC_ROOM } from '@/lib/supabase';

export const SEAT_ROWS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const SEAT_COLS = 10;
export const seats = SEAT_ROWS.flatMap(row => 
    Array.from({ length: SEAT_COLS }, (_, i) => `${row}-${String(i + 1).padStart(2, '0')}`)
);

export const DEFAULT_CLINIC_DURATION_MS = 60 * 60 * 1000;
export const ALERT_THRESHOLD_MS = 3 * 60 * 1000;
export const LOG_AUTO_EXPIRE_MS = 5 * 60 * 1000;
export const PENDING_GUARD_MS = 8000;
export const HEARTBEAT_TIMEOUT_MS = 45 * 1000;

// 한국 표준시(KST) 기준 날짜 문자열 구하기 (오전 6시 리셋)
export const getKSTDateString = () => {
    const kstAdjusted = new Date(Date.now() + 9 * 60 * 60 * 1000 - 6 * 60 * 60 * 1000);
    return kstAdjusted.toISOString().split('T')[0];
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

export const formatHM = (ms: number) => {
    if (ms < 0 || isNaN(ms)) ms = 0;
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
};

export const formatClockTime = (ms: number) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });