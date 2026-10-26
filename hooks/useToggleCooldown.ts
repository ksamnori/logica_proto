// src/hooks/useToggleCooldown.ts
// 호출/자리비움처럼 학생이 연타할 수 있는 토글 버튼에 붙이는 공용 쿨다운.
// start()를 부르면 cooldownMs 동안 isActive가 true가 되어 버튼을 잠글 수 있다.
import { useState, useEffect, useCallback } from 'react';
export { TOGGLE_COOLDOWN_MS } from '@/lib/clinicSession';

export function useToggleCooldown(cooldownMs: number) {
    const [until, setUntil] = useState(0);
    const [, forceTick] = useState(0);

    useEffect(() => {
        if (!until) return;
        const iv = setInterval(() => {
            if (Date.now() >= until) setUntil(0);
            else forceTick(t => t + 1);
        }, 250);
        return () => clearInterval(iv);
    }, [until]);

    const isActive = until > Date.now();
    const remainingMs = isActive ? until - Date.now() : 0;
    const start = useCallback(() => setUntil(Date.now() + cooldownMs), [cooldownMs]);
    // 서버(DB)에 남아있는 실제 쿨다운 종료 시각으로 맞춘다 — 새로고침 복구, 서버측 거부 동기화에 쓴다.
    const startUntil = useCallback((timestampMs: number) => setUntil(timestampMs), []);

    return { isActive, remainingMs, start, startUntil };
}
