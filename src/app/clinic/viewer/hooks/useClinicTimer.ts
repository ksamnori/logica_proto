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

  useEffect(() => {
    // 1. 우측 상단 60분 클리닉 전체 세션 타이머
    const sessionTimer = setInterval(() => {
      if (!clinicSessionStateRef.current) return;
      const rem = (new Date(clinicSessionStateRef.current.started_at).getTime() + clinicSessionStateRef.current.duration_ms) - Date.now();
      setIsClinicUrgent(rem <= 5 * 60 * 1000); // 5분 남으면 긴급(빨간색) 처리
      
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

    // 2. 우측 상단 20분 제한 주간테스트용 타이머
    let roundTimer: NodeJS.Timeout | null = null;
    if (isStarted && isTimedRound && !timeIsUp) {
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
  }, [isStarted, isTimedRound, timeIsUp, clinicSessionStateRef, supabaseClient, handleTimeUp]);

  return { clinicRemainingStr, isClinicUrgent, roundRemainingSec };
}