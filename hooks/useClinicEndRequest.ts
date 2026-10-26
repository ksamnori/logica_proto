// src/hooks/useClinicEndRequest.ts
// 학생이 클리닉을 스스로 로그아웃할 수 없게 하는 대신, "종료 요청 → 수퍼바이저 승인/거부" 흐름을
// portal(홈)과 clinic/viewer(문제풀이) 양쪽에서 동일하게 쓰기 위한 공용 훅.
import { useState, useEffect, useRef, useCallback } from 'react';
import { requestEndSession, cancelEndSession, END_REQUEST_COOLDOWN_MS } from '@/lib/clinicSession';

export type EndRequestState = 'idle' | 'pending' | 'cooldown';

export function useClinicEndRequest({
    supabaseClient, sendAction, sessionId, endRequestStatus, endRequestCooldownUntil, onApproved,
}: {
    supabaseClient: any;
    sendAction: (action: string, extra?: any) => void;
    sessionId: string | null | undefined;
    endRequestStatus?: string | null;
    endRequestCooldownUntil?: string | null;
    onApproved: () => void;
}) {
    const [state, setState] = useState<EndRequestState>('idle');
    const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
    const [, forceTick] = useState(0);
    const initializedRef = useRef(false);

    // 새로고침으로 쿨타임/대기 상태를 우회하지 못하도록, 세션이 처음 로드될 때 DB 값으로 상태를 복원한다.
    useEffect(() => {
        if (!sessionId || initializedRef.current) return;
        initializedRef.current = true;
        if (endRequestStatus === 'pending') {
            setState('pending');
        } else if (endRequestCooldownUntil && new Date(endRequestCooldownUntil).getTime() > Date.now()) {
            setState('cooldown');
            setCooldownUntil(new Date(endRequestCooldownUntil).getTime());
        }
    }, [sessionId, endRequestStatus, endRequestCooldownUntil]);

    useEffect(() => {
        if (state !== 'cooldown') return;
        const iv = setInterval(() => {
            if (cooldownUntil && Date.now() >= cooldownUntil) {
                setState('idle');
                setCooldownUntil(null);
            } else {
                forceTick(t => t + 1);
            }
        }, 1000);
        return () => clearInterval(iv);
    }, [state, cooldownUntil]);

    const requestEnd = useCallback(async () => {
        if (!sessionId || state !== 'idle') return;
        const ok = await requestEndSession(supabaseClient, sessionId);
        if (!ok) return;
        setState('pending');
        sendAction('end_clinic_request');
    }, [sessionId, state, sendAction, supabaseClient]);

    const cancelRequest = useCallback(async () => {
        if (!sessionId || state !== 'pending') return;
        const cooldownIso = await cancelEndSession(supabaseClient, sessionId);
        setState('cooldown');
        setCooldownUntil(new Date(cooldownIso).getTime());
        sendAction('end_clinic_cancel_request');
    }, [sessionId, state, sendAction, supabaseClient]);

    const handleResolved = useCallback((payload: { approved: boolean; cooldownUntil?: number }) => {
        if (payload.approved) {
            setState('idle');
            onApproved();
        } else {
            setState('cooldown');
            setCooldownUntil(payload.cooldownUntil || Date.now() + END_REQUEST_COOLDOWN_MS);
        }
    }, [onApproved]);

    const cooldownRemainingMs = state === 'cooldown' && cooldownUntil ? Math.max(0, cooldownUntil - Date.now()) : 0;

    return { state, cooldownRemainingMs, requestEnd, cancelRequest, handleResolved };
}
