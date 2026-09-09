// src/app/clinic/viewer/hooks/useClinicTimer.ts
import { useState, useEffect, MutableRefObject } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { closeSessionAtLimit } from '@/lib/clinicSession';
import { ROUND1_TIME_LIMIT_SECONDS } from '../utils';

interface UseClinicTimerProps {
  isStarted: boolean;
  isTimedRound: boolean;
  timeIsUp: boolean;
  clinicSessionStateRef: MutableRefObject<any>;
  supabaseClient: SupabaseClient;
  handleTimeUp: (forceAction?: string, sessionExpired?: boolean) => void;
}

export function useClinicTimer({
  isStarted,
  isTimedRound,
  timeIsUp,
  clinicSessionStateRef,
  supabaseClient,
  handleTimeUp
}: UseClinicTimerProps) {
  const [clinicRemainingStr, setClinicRemainingStr] = useState("60:00");
  const [isClinicUrgent, setIsClinicUrgent] = useState(false);
  const [roundRemainingSec, setRoundRemainingSec] = useState(ROUND1_TIME_LIMIT_SECONDS);
  const [isTimerInitialized, setIsTimerInitialized] = useState(false); // 🌟 동적 타이머 초기화 여부

  useEffect(() => {
    // 1. 우측 상단 전체 세션 타이머
    const sessionTimer = setInterval(() => {
      if (!clinicSessionStateRef.current) return;
      const rem = (new Date(clinicSessionStateRef.current.started_at).getTime() + clinicSessionStateRef.current.duration_ms) - Date.now();
      setIsClinicUrgent(rem <= 5 * 60 * 1000); 
      
      if (rem <= 0) {
        setClinicRemainingStr("00:00");
        if (!timeIsUp) {
          if (clinicSessionStateRef.current.id) {
            closeSessionAtLimit(supabaseClient, clinicSessionStateRef.current.id, clinicSessionStateRef.current.started_at, clinicSessionStateRef.current.duration_ms);
          }
          handleTimeUp(undefined, true);
        }
      } else {
        const ts = Math.floor(rem / 1000);
        const h = Math.floor(ts / 3600);
        const m = Math.floor((ts % 3600) / 60);
        const s = ts % 60;
        setClinicRemainingStr(`${h > 0 ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      }
    }, 1000);

    // 2. 우측 상단 문항 풀이 타이머 (20분 or 60분 동적 설정)
    let roundTimer: NodeJS.Timeout | null = null;

    if (isStarted && isTimedRound && !timeIsUp) {
      // 🌟 타이머 시작 직전, DataFetch 훅에서 세팅해 둔 시간 제한(3600 or 1200)을 불러옵니다.
      if (!isTimerInitialized) {
         const dynamicLimit = (typeof window !== 'undefined' && (window as any).__dynamicTimeLimit) 
                              ? (window as any).__dynamicTimeLimit 
                              : ROUND1_TIME_LIMIT_SECONDS;
         setRoundRemainingSec(dynamicLimit);
         setIsTimerInitialized(true);
         return; // 다음 렌더링에 interval 등록
      }

      roundTimer = setInterval(() => {
        setRoundRemainingSec(p => {
          if (p <= 1) { 
            if (roundTimer) clearInterval(roundTimer); 
            handleTimeUp(); 
            return 0; 
          }
          return p - 1;
        });
      }, 1000);
    }

    return () => { 
      clearInterval(sessionTimer); 
      if (roundTimer) clearInterval(roundTimer); 
    };
  }, [isStarted, isTimedRound, timeIsUp, clinicSessionStateRef, supabaseClient, handleTimeUp, isTimerInitialized]);

  return { clinicRemainingStr, isClinicUrgent, roundRemainingSec };
}