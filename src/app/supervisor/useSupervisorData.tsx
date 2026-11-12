// src/app/supervisor/useSupervisorData.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabaseClient, CLINIC_ROOM, getKSTDateString, DEFAULT_CLINIC_DURATION_MS, LOG_AUTO_EXPIRE_MS, PENDING_GUARD_MS, HEARTBEAT_TIMEOUT_MS, SUBMITTED_VERIFICATION_TIMEOUT_MS } from './supervisorUtils';
import { saveVerifiedRecordToLocalCache, VerifiedGradingRecord, buildCompactGradingStatusTag } from '@/components/clinic/UnlockPanel';
import { endTodaySession, pickLatestSessionPerStudent, resolveEndSessionForStudent, END_REQUEST_COOLDOWN_MS, clearAway } from '@/lib/clinicSession';
import { getActiveSeatLayout } from '@/app/actions/clinicSeatLayout';
import { listPadDevicesByTenant } from '@/app/actions/clinicPadDevice';
import { Seat, SEAT_LAYOUT_UPDATED_EVENT, DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, DEFAULT_SEAT_CARD_W, DEFAULT_SEAT_CARD_H } from '@/lib/clinicSeatLayout';
import { resolvePositionLabel } from '@/app/clinic/ta/taAccess';

// 대문항(그룹) 기준 균등 배점 + 서브문항((1),(2) 등) 분할 배점 및 TO/RO 부분점수(score_ratio) 계산 유틸리티

/**
 * 소수점 첫째 자리까지 반올림 (예: 97.5 -> 97.5, 100.0 -> 100)
 */
function roundScore(val: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 10) / 10;
}

/**
 * 채점 기호(O, TO, RO, X, TX 등)와 문항 배점(assignedScore), 마스터 채점 기준(metaMap)을 바탕으로
 * 획득 점수(newEarned), 정답 여부(isCorrectEq), 적용 비율(ratio)을 계산합니다.
 */
function calcScoreRatio(
  code: string | null | undefined,
  assignedScore: number,
  metaMap?: Record<string, any>,
  isAdmission: boolean = false
): { newEarned: number; isCorrectEq: boolean; ratio: number } {
  if (!code) return { newEarned: 0, isCorrectEq: false, ratio: 0 };
  const c = String(code).trim();
  if (!c) return { newEarned: 0, isCorrectEq: false, ratio: 0 };

  const meta = metaMap?.[c];
  let ratio = 0;
  let isCorrectEq = false;

  if (meta) {
    const rawRatio =
      isAdmission && meta.admission_ratio !== undefined && meta.admission_ratio !== null
        ? meta.admission_ratio
        : meta.score_ratio;
    ratio = parseFloat(rawRatio);
    if (isNaN(ratio)) ratio = 0;
    if (ratio > 1) ratio = ratio / 100;

    if (isAdmission) {
      isCorrectEq = ratio > 0;
    } else {
      isCorrectEq =
        meta.is_correct === true ||
        String(meta.is_correct).toLowerCase() === "true" ||
        ["O", "TO", "RO", "a", "b", "c"].includes(c);
    }
  } else {
    if (["O", "a", "b", "c"].includes(c)) {
      ratio = 1.0;
      isCorrectEq = true;
    } else if (c === "TO" || c === "RO") {
      ratio = isAdmission && c === "TO" ? 1.0 : 0.8;
      isCorrectEq = isAdmission ? ratio > 0 : true;
    } else if (c === "q") {
      ratio = isAdmission ? 0.0 : 0.5;
      isCorrectEq = false;
    } else {
      ratio = 0.0;
      isCorrectEq = false;
    }
  }

  const base = Number(assignedScore) || 0;
  const newEarned = Math.round((base * ratio + Number.EPSILON) * 1000) / 1000;
  return { newEarned, isCorrectEq, ratio };
}

/**
 * layout_settings에서 userMergedTextQuestions 배열을 안전하게 추출합니다.
 */
function extractMergedQuestionGroups(layoutSettings: any): string[][] {
  if (!layoutSettings) return [];
  let s = layoutSettings;
  if (typeof s === "string") {
    try {
      s = JSON.parse(s);
    } catch {
      return [];
    }
  }
  if (Array.isArray(s?.userMergedTextQuestions)) {
    return s.userMergedTextQuestions
      .filter((arr: any) => Array.isArray(arr) && arr.length > 0)
      .map((arr: any[]) => arr.map((id: any) => String(id)));
  }
  return [];
}

/**
 * 시험 문항 목록(items)과 layout_settings(userMergedTextQuestions)를 기반으로
 * 대문항(그룹)당 배점을 먼저 구한 뒤(예: 20대문항이면 대문항당 5점),
 * 그룹 내 서브문항 개수로 나눈 세부 배점(예: 서브문항 2개면 각 2.5점) 맵을 반환합니다.
 */
function buildExamQuestionScoreMap(
  items: { question_id: any; sort_order?: number; assigned_score?: any }[],
  layoutSettings?: any,
  examType?: string,
  totalQuestionsFallback?: number
): {
  scoreByQuestionId: Map<string, number>;
  groupCount: number;
  groups: { id: string; is_merged_text: boolean; items: any[]; groupScore: number; subScore: number }[];
} {
  const mergedArrays = extractMergedQuestionGroups(layoutSettings);
  const customGroupMap = new Map<string, string>();
  const customGroupSizeMap = new Map<string, number>();

  mergedArrays.forEach((arr, idx) => {
    const gId = `custom_group_${idx}`;
    customGroupSizeMap.set(gId, arr.length);
    arr.forEach((qid) => customGroupMap.set(String(qid), gId));
  });

  const scoreByQuestionId = new Map<string, number>();

  if (!items || items.length === 0) {
    const flatCount = totalQuestionsFallback || 1;
    const extraSubItems = mergedArrays.reduce(
      (acc, arr) => acc + Math.max(0, arr.length - 1),
      0
    );
    const groupCount = Math.max(1, flatCount - extraSubItems);
    const baseGroupScore = 100 / groupCount;

    mergedArrays.forEach((arr) => {
      const subScore = baseGroupScore / (arr.length || 1);
      arr.forEach((qid) => scoreByQuestionId.set(String(qid), subScore));
    });

    return { scoreByQuestionId, groupCount, groups: [] };
  }

  const sortedItems = [...items].sort(
    (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
  );

  const groupMap = new Map<
    string,
    { id: string; is_merged_text: boolean; items: any[]; groupScore: number; subScore: number }
  >();
  const groups: {
    id: string;
    is_merged_text: boolean;
    items: any[];
    groupScore: number;
    subScore: number;
  }[] = [];

  sortedItems.forEach((item, idx) => {
    const qidStr = String(item.question_id);
    const customGId = customGroupMap.get(qidStr);
    const gId = customGId || `single_${qidStr}_${idx}`;

    if (!groupMap.has(gId)) {
      const newG = {
        id: gId,
        is_merged_text: !!customGId,
        items: [] as any[],
        groupScore: 0,
        subScore: 0,
      };
      groupMap.set(gId, newG);
      groups.push(newG);
    }
    groupMap.get(gId)!.items.push(item);
  });

  const groupCount = groups.length || 1;
  const baseGroupScore = 100 / groupCount;
  const isAdmissionExam = Boolean(
    examType && (examType.includes("입학테스트") || examType.includes("진단평가"))
  );

  groups.forEach((g) => {
    const explicitMax = Math.max(
      ...g.items.map((i: any) => parseFloat(i.assigned_score) || 0)
    );
    const groupMaxScore =
      isAdmissionExam && explicitMax > 0 ? explicitMax : baseGroupScore;
    const subScore = groupMaxScore / (g.items.length || 1);

    g.groupScore = groupMaxScore;
    g.subScore = subScore;

    g.items.forEach((item: any) => {
      scoreByQuestionId.set(String(item.question_id), subScore);
    });
  });

  return { scoreByQuestionId, groupCount, groups };
}
const ENDED_ENROLLMENT_STATUSES = ["수강종료", "종료", "퇴원", "취소"];
const isEndedEnrollment = (e: any): boolean => {
  if (!e) return true;
  if (ENDED_ENROLLMENT_STATUSES.includes(String(e.status || "").trim())) return true;
  if (e.end_date) return true;
  return false;
};

const PERSIST_UNTIL_RESOLVED_TYPES = ['call', 'away', 'recheck', 'end_request'];

export function useSupervisorData() {
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
    const [authMessage, setAuthMessage] = useState<string>('권한을 확인하는 중입니다...');

    const [now, setNow] = useState(Date.now());
    const [startedAt] = useState(Date.now());
    const [connectionStatus, setConnectionStatus] = useState('connecting');
    const [activeStudents, setActiveStudents] = useState<Record<string, any>>({});
    const [activeTAs, setActiveTAs] = useState<Record<string, any>>({});
    const [taStats, setTaStats] = useState<Record<string, any>>({});
    const [logs, setLogs] = useState<any[]>([]);
    const [isMounted, setIsMounted] = useState(false);
    
    const [leftTab, setLeftTab] = useState<'ta' | 'students' | 'records'>('ta');
    const [allStudents, setAllStudents] = useState<Record<string, { label: string; students: any[] }>>({});
    const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});

    const [clinicRecords, setClinicRecords] = useState<Record<string, any>>({});
    const [expandedRecords, setExpandedRecords] = useState<Record<string, boolean>>({});
    
    const [draggedSeat, setDraggedSeat] = useState<string | null>(null);
    const [draggedListStudent, setDraggedListStudent] = useState<any>(null);
    const [selectedSeatForMove, setSelectedSeatForMove] = useState<string | null>(null);
    const [ghostRect, setGhostRect] = useState<{ left: number; top: number; width: number; height: number; scale: number } | null>(null);
    const dragOffsetRef = useRef({ x: 0, y: 0 });

    const [forceCheckoutModal, setForceCheckoutModal] = useState<{ isOpen: boolean, seat: string | null }>({ isOpen: false, seat: null });
    const [recheckModal, setRecheckModal] = useState<{ isOpen: boolean, seat: string | null, uid: string | null }>({ isOpen: false, seat: null, uid: null });
    const [endRequestModal, setEndRequestModal] = useState<{ isOpen: boolean, seat: string | null }>({ isOpen: false, seat: null });
    const [reservationModal, setReservationModal] = useState<{ isOpen: boolean; seat: string | null; student: any | null }>({ isOpen: false, seat: null, student: null });
    const RESERVATION_GRACE_MS = 10 * 60 * 1000;

    const [pendingVerifications, setPendingVerifications] = useState<any[]>([]);

    const studentsRef = useRef<Record<string, any>>({});
    const instructorPosByIdRef = useRef<Record<string, string>>({});
    const instructorPosByNameRef = useRef<Record<string, string>>({});
    const taHandlingBroadcastRef = useRef<Record<string, { handling: string | null; name?: string; position?: string; instructorId?: string | null; updatedAt: number }>>({});
    const channelRef = useRef<any>(null);

    const registeredSeatsRef = useRef<Set<string>>(new Set());
    const pendingMovesRef = useRef<Record<string, any>>({});
    const lastRelocateAtRef = useRef<number>(0);
    const pendingDeletesRef = useRef<Record<string, number>>({});
    const pendingTimeAdjustRef = useRef<Record<string, any>>({});
    const syncPresenceRef = useRef<any>(null);
    const checkReservationExpiryRef = useRef<any>(null);
    const checkClinicTimeExpiryRef = useRef<any>(null);
    
    const offlineLogSentRef = useRef<Set<string>>(new Set());

    const [seats, setSeats] = useState<string[]>([]);
    const [seatObjs, setSeatObjs] = useState<Seat[]>([]);
    const [canvasWidth, setCanvasWidth] = useState(DEFAULT_CANVAS_W);
    const [canvasHeight, setCanvasHeight] = useState(DEFAULT_CANVAS_H);
    const [seatWidth, setSeatWidth] = useState(DEFAULT_SEAT_CARD_W);
    const [seatHeight, setSeatHeight] = useState(DEFAULT_SEAT_CARD_H);
    const [editorLocked, setEditorLocked] = useState(false);

    const [reconnectTrigger, setReconnectTrigger] = useState(0);

    const loadSeats = useCallback(() => {
        getActiveSeatLayout().then(layout => {
            const sorted = [...layout.seats].sort((a, b) => a.number - b.number);
            setSeats(sorted.map(s => String(s.number)));
            setSeatObjs(sorted);
            setCanvasWidth(layout.canvasWidth);
            setCanvasHeight(layout.canvasHeight);
            setSeatWidth(layout.seatWidth);
            setSeatHeight(layout.seatHeight);
        });
        listPadDevicesByTenant().then(deviceBySeat => {
            registeredSeatsRef.current = new Set(Object.keys(deviceBySeat));
        });
    }, []);

    useEffect(() => { loadSeats(); }, [loadSeats]);

    useEffect(() => {
        setIsMounted(true);
        const verifyAdminAccess = () => {
            const instId = localStorage.getItem('logica_instructor_id');
            const role = localStorage.getItem('logica_instructor_role') || '';
            const position = localStorage.getItem('logica_instructor_position') || '';

            if (!instId) {
                setAuthMessage('로그인이 필요합니다. 먼저 시스템에 로그인해 주세요.');
                setIsAuthorized(false);
                return;
            }

            if (
                role === 'ADMIN' || role === 'MANAGER' || role === 'PRINCIPAL' || role === 'SUPER_ADMIN' ||
                position.includes('원장') || position.includes('실장') || position.includes('최고관리자') || position.includes('대장')
            ) {
                setIsAuthorized(true);
            } else {
                setAuthMessage(`접근 불가: [${position || '미지정'}] 권한입니다. 원장 또는 실장만 접속 가능합니다.`);
                setIsAuthorized(false);
            }
        };
        verifyAdminAccess();
    }, []);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (channelRef.current && channelRef.current.state !== 'joined') {
                    setReconnectTrigger(prev => prev + 1);
                }
            }
        };
        const handleOnline = () => { setReconnectTrigger(prev => prev + 1); };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleVisibilityChange);
        window.addEventListener('online', handleOnline);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleVisibilityChange);
            window.removeEventListener('online', handleOnline);
        };
    }, []);

    const updateStudents = useCallback((newStudents: any) => {
        studentsRef.current = newStudents;
        setActiveStudents({ ...newStudents });
    }, []);

    const appendLog = useCallback((borderClass: string, badgeBg: string, badgeText: string, title: string | React.ReactNode, subtitle: string | React.ReactNode, type?: string, data?: any) => {
        const logId = `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const persistUntilResolved = !!type && PERSIST_UNTIL_RESOLVED_TYPES.includes(type);
        
        const newLog = {
            id: logId, 
            timestamp: new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            borderClass, badgeBg, badgeText, title, subtitle, type, data, 
            expiresAt: persistUntilResolved ? null : Date.now() + LOG_AUTO_EXPIRE_MS
        };

        setLogs(prev => {
            // 동일 좌석의 이전 'update_activity'(상태 갱신) 로그는 최신 상태 1개로 교체하여 로그 폭주 방지
            const filtered =
                type === 'update_activity' && data?.seat
                    ? prev.filter(l => !(l.type === 'update_activity' && l.data?.seat === data.seat))
                    : prev;
            const next = [newLog, ...filtered];
            if (next.length <= 150) return next;
            // 150개 초과 시 미해결 호출/재확인/종료요청 로그는 절대 밀려나지 않도록 보존
            const persistent = next.filter(l => l.type && PERSIST_UNTIL_RESOLVED_TYPES.includes(l.type));
            const normal = next.filter(l => !l.type || !PERSIST_UNTIL_RESOLVED_TYPES.includes(l.type)).slice(0, Math.max(50, 150 - persistent.length));
            return [...persistent, ...normal].sort((a, b) => (b.id > a.id ? 1 : -1));
        });

        if (!persistUntilResolved) {
            setTimeout(() => {
                setLogs(prev => prev.filter(l => l.id !== logId));
            }, LOG_AUTO_EXPIRE_MS);
        }
        return logId;
    }, []);

    const removeLogsByTypeAndSeat = useCallback((type: string, seat: string, qNum?: any, uid?: string | null) => {
        setLogs(prev => prev.filter(l => {
            const matchSeatAndType = l.data?.seat === seat && l.type === type;
            if (!matchSeatAndType) return true;
            if (qNum != null) {
                const bothNaN = typeof l.data?.qNum === 'number' && typeof qNum === 'number' && isNaN(l.data.qNum) && isNaN(qNum);
                if (!bothNaN && String(l.data?.qNum) !== String(qNum)) return true;
            }
            if (uid != null && l.data?.uid !== uid) return true;
            return false;
        }));
    }, []);

    const sendToStudent = (seat: string, action: string, extra = {}) => {
        if (!channelRef.current) return;
        const studentId = studentsRef.current[seat]?.studentId;
        const msg = { type: 'broadcast', event: 'ta_action', payload: { seat, studentId, action, ...extra, timestamp: Date.now() } };
        
        if (channelRef.current.state === 'joined') {
            channelRef.current.send(msg);
        } else {
            setReconnectTrigger(p => p + 1);
        }
    };

    const confirmVerification = async (assignmentId: string, studentId: string, overrides: Record<string, boolean>, verifierNameOverride?: string) => {
        try {
            const actorName = (verifierNameOverride || (typeof window !== 'undefined' && (localStorage.getItem('logica_instructor_name') || localStorage.getItem('logica_ta_name'))) || '총책임자').trim();
            const nowIso = new Date().toISOString();
            const statusTag = buildCompactGradingStatusTag(actorName, nowIso);

            const [{ data: allAnswers }, { data: asgData }, { data: gcData }] = await Promise.all([
                supabaseClient.from('student_answer').select('answer_id, question_id, is_correct, grading_code, earned_score').eq('exam_assignment_id', assignmentId),
                supabaseClient.from('exam_assignment').select('exam_id, student(name), exam_master(title, exam_type, total_questions, layout_settings)').eq('assignment_id', assignmentId).maybeSingle(),
                supabaseClient.from('master_grading_code').select('code, description, is_correct, score_ratio, admission_ratio')
            ]);

            const gcMeta: Record<string, any> = {};
            gcData?.forEach((row: any) => { if (row.code) gcMeta[row.code] = row; });

            const em: any = Array.isArray(asgData?.exam_master) ? asgData?.exam_master[0] : asgData?.exam_master;
            const { data: examItems } = asgData?.exam_id
                ? await supabaseClient.from('exam_item').select('question_id, sort_order, assigned_score').eq('exam_id', asgData.exam_id).order('sort_order')
                : { data: [] as any[] };

            const totalAnsCount = allAnswers ? allAnswers.length : 0;
            const { scoreByQuestionId, groupCount } = buildExamQuestionScoreMap(
                examItems || [],
                em?.layout_settings,
                em?.exam_type,
                em?.total_questions || totalAnsCount || 1
            );
            const defaultQScore = 100 / (groupCount || totalAnsCount || 1);

            let totalScoreSum = 0;
            const updates = [];
            const toDeleteIncorrectRecords = [];
            
            if (allAnswers && totalAnsCount > 0) {
                for (const ans of allAnswers) {
                    const isOverridden = overrides[ans.answer_id] !== undefined;
                    const isCorrect = isOverridden ? overrides[ans.answer_id] : ans.is_correct;
                    const qScore = scoreByQuestionId.get(String(ans.question_id)) ?? defaultQScore;
                    const nextCode = isOverridden ? (isCorrect ? 'O' : 'X') : (ans.grading_code || (isCorrect ? 'O' : 'X'));
                    const { newEarned } = calcScoreRatio(nextCode, qScore, gcMeta, false);
                    totalScoreSum += newEarned;
                    
                    if (isOverridden) {
                        updates.push({
                            answer_id: ans.answer_id,
                            is_correct: isCorrect,
                            grading_code: nextCode,
                            earned_score: newEarned
                        });
                        if (isCorrect && ans.question_id) {
                            toDeleteIncorrectRecords.push(ans.question_id);
                        }
                    }
                }
                
                if (updates.length > 0) {
                    // 🌟 [23502 에러 방지] .upsert() 대신 .update().eq('answer_id', ...) 사용
                    const updateResults = await Promise.all(
                        updates.map((u: any) =>
                            supabaseClient
                                .from('student_answer')
                                .update({
                                    is_correct: u.is_correct,
                                    grading_code: u.grading_code,
                                    earned_score: u.earned_score,
                                })
                                .eq('answer_id', u.answer_id)
                        )
                    );
                    const firstErr = updateResults.find((r) => r.error)?.error;
                    if (firstErr) console.error('검수 답안 개별 수정 에러:', firstErr);
                }

                await supabaseClient
                    .from('student_answer')
                    .update({ grading_status: statusTag })
                    .eq('exam_assignment_id', assignmentId);
                
                if (toDeleteIncorrectRecords.length > 0) {
                    await supabaseClient.from('student_incorrect_record')
                        .delete()
                        .eq('student_id', studentId)
                        .in('question_id', toDeleteIncorrectRecords);
                }
            }
            
            const totalScore = totalAnsCount > 0 ? roundScore(totalScoreSum) : 0;
            
            const { error: updateError } = await supabaseClient.from('exam_assignment').update({
                status: '채점확정',
                total_score: totalScore
            }).eq('assignment_id', assignmentId);

            if (updateError) console.error("시험 확정 업데이트 에러:", updateError);

            const seat = Object.keys(studentsRef.current).find(s => studentsRef.current[s].studentId === studentId);
            const rawSt: any = Array.isArray((asgData as any)?.student) ? (asgData as any)?.student[0] : (asgData as any)?.student;
            const studentName = (seat && studentsRef.current[seat]?.name) || rawSt?.name || '학생';
            const examTitle = em?.title || '테스트';

            if (seat) {
                const sid = studentsRef.current[seat]?.sessionId;
                if (sid) {
                    const { data: sessData } = await supabaseClient.from('clinic_session_state').select('active_calls').eq('id', sid).maybeSingle();
                    const newCalls = {
                        ...(sessData?.active_calls || {}),
                        REFRESH: Date.now(),
                        __last_verified: {
                            assignmentId: Number(assignmentId),
                            examTitle,
                            finalScore: totalScore,
                            verifierName: actorName,
                            verifiedAt: nowIso
                        }
                    };
                    await supabaseClient.from('clinic_session_state').update({ active_calls: newCalls, last_seen_at: nowIso }).eq('id', sid);
                }
                if (studentsRef.current[seat]?.status === 'submitted') {
                    studentsRef.current[seat].status = 'idle';
                    updateStudents({ ...studentsRef.current });
                }
                sendToStudent(seat, 'force_refresh'); 
            }

            const verifiedRecord: VerifiedGradingRecord = {
                assignmentId: Number(assignmentId),
                studentId: String(studentId),
                studentName,
                examTitle,
                finalScore: totalScore,
                verifierName: actorName,
                verifiedAt: nowIso
            };
            saveVerifiedRecordToLocalCache(verifiedRecord);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('logica:grading-verified', { detail: verifiedRecord }));
            }
            if (channelRef.current && channelRef.current.state === 'joined') {
                channelRef.current.send({
                    type: 'broadcast',
                    event: 'ta_action',
                    payload: {
                        seat: seat || null,
                        studentId,
                        action: 'grading_verified',
                        assignmentId: Number(assignmentId),
                        studentName,
                        examTitle,
                        finalScore: totalScore,
                        verifierName: actorName,
                        taName: actorName,
                        verifiedAt: nowIso,
                        timestamp: Date.now()
                    }
                });
            }
            appendLog('border-emerald-500', 'bg-emerald-100 text-emerald-700', '채점확정', `${seat ? '[' + seat + '] ' : ''}${studentName} 채점 확인 완료`, `확인자: ${actorName} · 최종 ${totalScore}점 (${examTitle})`);
            recordTaStat(actorName, 'verify');
            
            setPendingVerifications(prev => prev.filter(p => String(p.assignment_id) !== String(assignmentId)));
        } catch (error) {
            console.error("검수 처리 중 예상치 못한 에러:", error);
            setPendingVerifications(prev => prev.filter(p => p.assignment_id !== assignmentId));
        }
    };

    useEffect(() => {
        if (!isAuthorized) return;
        
        const fetchInstructorsForTaPosition = async () => {
            const myTenantId = localStorage.getItem('logica_tenant_id') || '';
            let instQuery = supabaseClient
                .from('instructor')
                .select('instructor_id, name, position, role')
                .is('deleted_at', null);
            if (myTenantId && myTenantId !== 'hq') {
                instQuery = instQuery.eq('tenant_id', myTenantId);
            }
            const { data: instRows } = await instQuery;
            if (instRows) {
                const byId: Record<string, string> = {};
                const byName: Record<string, string> = {};
                instRows.forEach((row: any) => {
                    const posLabel = resolvePositionLabel(row.position, row.role);
                    if (row.instructor_id && posLabel) byId[String(row.instructor_id)] = posLabel;
                    if (row.name && posLabel) byName[String(row.name).trim()] = posLabel;
                });
                instructorPosByIdRef.current = byId;
                instructorPosByNameRef.current = byName;
                if (channelRef.current && syncPresenceRef.current) {
                    syncPresenceRef.current(channelRef.current.presenceState());
                }
            }
        };

        const fetchAllStudents = async () => {
            const myTenantId = localStorage.getItem('logica_tenant_id') || '';
            let stuQuery = supabaseClient
                .from('student')
                .select('student_id, name, status, deleted_at, enrollment(status, end_date, class(name, code, status))')
                .eq('status', '재원')
                .is('deleted_at', null)
                .not('name', 'ilike', '%테스트%');
            if (myTenantId && myTenantId !== 'hq') {
                stuQuery = stuQuery.eq('tenant_id', myTenantId);
            }

            const { data } = await stuQuery;
            if (data) {
                const grouped: Record<string, { label: string; students: any[] }> = {};
                data.forEach((s: any) => {
                    const trimmedName = String(s.name || '').trim();
                    // 학원에 정식 등록된('재원') 학생만 표시하고 이름에 '테스트'가 포함된 계정은 원천 제외
                    if (!trimmedName || trimmedName.includes('테스트')) return;
                    if (String(s.status || '').trim() !== '재원' || s.deleted_at) return;

                    const activeEnrolls = (s.enrollment || []).filter((e: any) => {
                        if (isEndedEnrollment(e)) return false;
                        const cls = Array.isArray(e.class) ? e.class[0] : e.class;
                        if (!cls) return false;
                        return cls.status !== '종료' && cls.status !== '폐강';
                    });
                    const classEntries = activeEnrolls
                        .map((e: any) => (Array.isArray(e.class) ? e.class[0] : e.class))
                        .filter(Boolean);
                    const classes = classEntries.map((c: any) => c.name);
                    const firstClass = classEntries[0];
                    const cLabel = firstClass ? firstClass.name : '반 미배정';
                    const cKey = firstClass ? `${firstClass.name}::${firstClass.code || ''}` : '반 미배정';
                    if (!grouped[cKey]) grouped[cKey] = { label: cLabel, students: [] };
                    grouped[cKey].students.push({ id: s.student_id, name: trimmedName, classes });
                });
                const sortedGrouped: Record<string, { label: string; students: any[] }> = {};
                Object.keys(grouped).sort((a, b) => grouped[a].label.localeCompare(grouped[b].label)).forEach(k => {
                    sortedGrouped[k] = { label: grouped[k].label, students: grouped[k].students.sort((a, b) => a.name.localeCompare(b.name)) };
                });
                setAllStudents(sortedGrouped);
                if (Object.keys(sortedGrouped).length > 0) setExpandedClasses({ [Object.keys(sortedGrouped)[0]]: true });
            }
        };

        const CLINIC_SESSION_SYNC_COLS = 'id, student_id, seat, manual_seat, session_date, session_no, started_at, ended_at, duration_ms, last_seen_at, away_since, end_request_status, end_request_cooldown_until, active_calls, active_rechecks';

        const loadInitialSeatsFromDB = async () => {
            const todayStr = getKSTDateString();
            const { data: rawSessionData } = await supabaseClient.from('clinic_session_state').select(CLINIC_SESSION_SYNC_COLS).eq('session_date', todayStr);
            const sessionData = rawSessionData && rawSessionData.length > 0 ? pickLatestSessionPerStudent(rawSessionData as any[]) : [];

            const seatSyncPromises: PromiseLike<any>[] = [];
            const seatedSessions: { sess: any; effectiveSeat: string }[] = [];
            for (const sess of sessionData) {
                let effectiveSeat = sess.manual_seat;
                if (!effectiveSeat && sess.seat) {
                    effectiveSeat = sess.seat;
                    seatSyncPromises.push(supabaseClient.from('clinic_session_state').update({ manual_seat: effectiveSeat }).eq('id', sess.id));
                }
                if (effectiveSeat) seatedSessions.push({ sess, effectiveSeat });
            }
            if (seatSyncPromises.length > 0) await Promise.all(seatSyncPromises);

            const targetStudentIds = Array.from(new Set(seatedSessions.map(x => x.sess.student_id).filter(Boolean)));
            const studentMetaMap = new Map<string, { name: string; classes: string[] }>();
            if (targetStudentIds.length > 0) {
                const { data: sRows } = await supabaseClient.from('student').select('student_id, name, enrollment(status, end_date, class(name))').in('student_id', targetStudentIds);
                (sRows || []).forEach((sData: any) => {
                    const activeEnrolls = (sData?.enrollment || []).filter((e: any) => !isEndedEnrollment(e));
                    const metaClasses = activeEnrolls.map((e: any) => (Array.isArray(e.class) ? e.class[0]?.name : e.class?.name)).filter(Boolean);
                    if (metaClasses.length === 0) metaClasses.push('반 미배정');
                    studentMetaMap.set(sData.student_id, { name: sData?.name || '학생', classes: metaClasses });
                });
            }

            const newStudents = { ...studentsRef.current };
            for (const { sess, effectiveSeat } of seatedSessions) {
                const meta = studentMetaMap.get(sess.student_id) || { name: '학생', classes: ['반 미배정'] };
                if (!newStudents[effectiveSeat]) {
                    newStudents[effectiveSeat] = {
                        name: meta.name, classes: meta.classes, status: 'idle', studentId: sess.student_id, sessionId: sess.id,
                        firstSeenAt: new Date(sess.started_at).getTime() || Date.now(),
                        clinicDurationMs: sess.duration_ms || DEFAULT_CLINIC_DURATION_MS,
                        sessionNo: sess.session_no || 1,
                        totalCalls: 0, totalHints: 0, calls: {},
                        lastUpdatedAt: Date.now()
                    };
                }
            }

            const assignedStudentIds = new Set(Object.values(newStudents).map((s: any) => s.studentId));
            const { data: reservations } = await supabaseClient.from('clinic_reservation').select('*').eq('session_date', todayStr);
            (reservations || []).forEach((r: any) => {
                if (assignedStudentIds.has(r.student_id) || newStudents[r.seat]) return;
                const expiresAt = new Date(r.expires_at).getTime();
                if (Date.now() > expiresAt) return;
                newStudents[r.seat] = {
                    type: 'reserved', name: r.student_name || '학생', classes: r.classes || [], studentId: r.student_id,
                    reservedFor: new Date(r.reserved_for).getTime(), expiresAt, calls: {}, totalCalls: 0, totalHints: 0
                };
            });

            updateStudents(newStudents);
        };
        fetchInstructorsForTaPosition(); fetchAllStudents(); loadInitialSeatsFromDB();
    }, [isAuthorized, updateStudents]);

    const fetchClinicRecords = useCallback(async () => {
        const todayStr = getKSTDateString();
        const { data: sessions } = await supabaseClient
            .from('clinic_session_state')
            .select('student_id, session_no, started_at, ended_at')
            .eq('session_date', todayStr)
            .order('session_no', { ascending: true });

        if (!sessions || sessions.length === 0) { setClinicRecords({}); return; }

        const studentIds = Array.from(new Set(sessions.map((s: any) => s.student_id)));
        const { data: students } = await supabaseClient.from('student').select('student_id, name').in('student_id', studentIds);
        const nameMap: Record<string, string> = {};
        (students || []).forEach((s: any) => { nameMap[s.student_id] = s.name; });

        const grouped: Record<string, any> = {};
        sessions.forEach((s: any) => {
            const startedAt = new Date(s.started_at).getTime();
            const endedAt = s.ended_at ? new Date(s.ended_at).getTime() : null;
            const durationMs = Math.max(0, (endedAt ?? Date.now()) - startedAt);

            if (!grouped[s.student_id]) grouped[s.student_id] = { name: nameMap[s.student_id] || '학생', totalMs: 0, sessions: [] };
            grouped[s.student_id].sessions.push({ sessionNo: s.session_no, startedAt, endedAt, durationMs });
            grouped[s.student_id].totalMs += durationMs;
        });

        setClinicRecords(grouped);
    }, []);

    useEffect(() => {
        if (!isAuthorized || leftTab !== 'records') return;
        fetchClinicRecords();
        const interval = setInterval(fetchClinicRecords, 10000);
        return () => clearInterval(interval);
    }, [isAuthorized, leftTab, fetchClinicRecords]);

    const toggleRecordExpand = useCallback((studentId: string) => {
        setExpandedRecords(prev => ({ ...prev, [studentId]: !prev[studentId] }));
    }, []);

    useEffect(() => {
        if (!isAuthorized) return;
        const interval = setInterval(() => {
            setNow(Date.now());
            if (channelRef.current && syncPresenceRef.current) syncPresenceRef.current(channelRef.current.presenceState());
            checkReservationExpiryRef.current?.();
            checkClinicTimeExpiryRef.current?.();
        }, 1000);
        return () => clearInterval(interval);
    }, [isAuthorized]);

    useEffect(() => {
        if (!isAuthorized || !isMounted) return;
        const CLINIC_SESSION_SYNC_COLS = 'id, student_id, seat, manual_seat, session_date, session_no, started_at, ended_at, duration_ms, last_seen_at, away_since, end_request_status, end_request_cooldown_until, active_calls, active_rechecks';
        let isCrossValidating = false;

        const runCrossValidation = async () => {
            if (isCrossValidating) return;
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            isCrossValidating = true;
            try {
            const todayStr = getKSTDateString();
            const { data: rawSessionData, error } = await supabaseClient.from('clinic_session_state').select(CLINIC_SESSION_SYNC_COLS).eq('session_date', todayStr);
            if (error || !rawSessionData) return;
            const sessionData = pickLatestSessionPerStudent(rawSessionData as any[]);

            const dbSeats = new Map();
            for (const s of sessionData) {
                let effectiveSeat = s.manual_seat;
                if (!effectiveSeat && s.seat) {
                    effectiveSeat = s.seat;
                    supabaseClient.from('clinic_session_state').update({ manual_seat: effectiveSeat }).eq('id', s.id).then();
                }
                if (effectiveSeat) {
                    const existing = dbSeats.get(effectiveSeat);
                    if (!existing || new Date(s.started_at).getTime() > new Date(existing.started_at).getTime()) {
                        dbSeats.set(effectiveSeat, s);
                    }
                }
            }

            const current = { ...studentsRef.current };
            let isModified = false;

            for (const [targetSeat, dbRecord] of Array.from(dbSeats.entries())) {
                const staleReservedSeat = Object.keys(current).find(s => current[s].type === 'reserved' && current[s].studentId === dbRecord.student_id);
                if (staleReservedSeat) {
                    delete current[staleReservedSeat]; isModified = true;
                    supabaseClient.from('clinic_reservation').delete().eq('student_id', dbRecord.student_id).eq('session_date', todayStr).then();
                }

                if (current[targetSeat] && current[targetSeat].type !== 'reserved' && current[targetSeat].studentId !== dbRecord.student_id) {
                    appendLog('border-slate-500', 'bg-slate-100 text-slate-500', '로그아웃', `[${targetSeat}] ${current[targetSeat].name} 밀어내기`, `새로운 학생이 로그인하여 기존 세션을 정리합니다.`);
                    removeLogsByTypeAndSeat('call', targetSeat); 
                    removeLogsByTypeAndSeat('submit', targetSeat); 
                    removeLogsByTypeAndSeat('away', targetSeat); 
                    removeLogsByTypeAndSeat('recheck', targetSeat); 
                    removeLogsByTypeAndSeat('end_request', targetSeat);
                    
                    endTodaySession(supabaseClient, current[targetSeat].studentId, todayStr);
                    
                    delete current[targetSeat];
                    offlineLogSentRef.current.delete(targetSeat);
                    isModified = true;
                }

                const oldSeat = Object.keys(current).find(s => current[s].studentId === dbRecord.student_id && current[s].type !== 'reserved');
                if (oldSeat && oldSeat !== targetSeat) {
                    current[targetSeat] = { ...current[oldSeat], clinicDurationMs: dbRecord.duration_ms, sessionId: dbRecord.id };
                    delete current[oldSeat]; isModified = true;
                } else if (!oldSeat && !current[targetSeat]) {
                    const { data: sData } = await supabaseClient.from('student').select('name, enrollment(status, end_date, class(name))').eq('student_id', dbRecord.student_id).single();
                    const entryName = sData?.name || '학생';
                    const activeEnrolls = (sData?.enrollment || []).filter((e: any) => !isEndedEnrollment(e));
                    const activeClassNames = activeEnrolls.map((e: any) => e.class?.name).filter(Boolean);
                    current[targetSeat] = {
                        name: entryName, classes: activeClassNames.length > 0 ? activeClassNames : ['반 미배정'],
                        status: 'idle', studentId: dbRecord.student_id, sessionId: dbRecord.id, firstSeenAt: new Date(dbRecord.started_at).getTime() || Date.now(),
                        clinicDurationMs: dbRecord.duration_ms || DEFAULT_CLINIC_DURATION_MS,
                        sessionNo: dbRecord.session_no || 1,
                        endRequestPending: dbRecord.end_request_status === 'pending',
                        totalCalls: 0, totalHints: 0, calls: {}, activity: '포털/수동 배정 연동',
                        lastUpdatedAt: Date.now()
                    };
                    isModified = true;
                    const justStarted = Date.now() - (new Date(dbRecord.started_at).getTime() || 0) < 10000;
                    if (justStarted) {
                        appendLog('border-emerald-500', 'bg-emerald-100 text-emerald-600', '입장', `[${targetSeat}] ${entryName} 입장`, `클리닉에 접속했습니다.`);
                    }
                } else if (oldSeat === targetSeat) {
                    const isTimeAdjusting = pendingTimeAdjustRef.current[targetSeat] && Date.now() < pendingTimeAdjustRef.current[targetSeat].expiresAt;
                    if (!isTimeAdjusting && dbRecord.duration_ms !== undefined && current[targetSeat].clinicDurationMs !== dbRecord.duration_ms) {
                        current[targetSeat].clinicDurationMs = dbRecord.duration_ms; isModified = true;
                    }
                    if (current[targetSeat].sessionId !== dbRecord.id) {
                        current[targetSeat].sessionId = dbRecord.id; isModified = true;
                    }
                    if (dbRecord.session_no && current[targetSeat].sessionNo !== dbRecord.session_no) {
                        current[targetSeat].sessionNo = dbRecord.session_no;
                        current[targetSeat].firstSeenAt = new Date(dbRecord.started_at).getTime() || current[targetSeat].firstSeenAt;
                        isModified = true;
                    }
                    const dbPending = dbRecord.end_request_status === 'pending';
                    if (dbPending && !current[targetSeat].endRequestPending) {
                        current[targetSeat].endRequestPending = true;
                        appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '종료요청',
                            <span className="underline decoration-dotted cursor-pointer hover:text-rose-600" onClick={() => setEndRequestModal({ isOpen: true, seat: targetSeat })}>[{targetSeat}] {current[targetSeat].name}</span>,
                            `클리닉 종료를 요청했습니다 · 클릭해서 승인/거부하세요.`, 'end_request', { seat: targetSeat }
                        );
                        isModified = true;
                    } else if (!dbPending && current[targetSeat].endRequestPending) {
                        current[targetSeat].endRequestPending = false;
                        removeLogsByTypeAndSeat('end_request', targetSeat);
                        isModified = true;
                    }
                }

                if (current[targetSeat] && current[targetSeat].type !== 'reserved') {
                    const st = current[targetSeat];
                    if (!st.calls) st.calls = {};
                    if (!st.rechecks) st.rechecks = {};
                    const dbCalls = dbRecord.active_calls || {};
                    const dbRechecks = dbRecord.active_rechecks || {};

                    const isSystemCallKey = (k: string) =>
                        !k || k === 'REFRESH' || k.startsWith('__') || (k !== 'general' && isNaN(Number(k)));

                    Object.keys(dbCalls).forEach(qNumKey => {
                        if (isSystemCallKey(qNumKey)) return;
                        if (dbCalls[qNumKey]?.verdict) return; 
                        if (st.calls[qNumKey]) return;
                        
                        const qNum = qNumKey === 'general' ? 'general' : Number(qNumKey);
                        st.calls[qNumKey] = dbCalls[qNumKey] || { requestedAt: Date.now(), qNum: qNumKey };
                        
                        if (st.status !== 'offline') st.status = 'call';
                        isModified = true;
                        const isGeneral = qNumKey === 'general';
                        appendLog('border-rose-500', 'bg-rose-100 text-rose-600', isGeneral ? '조교호출' : '질문호출',
                            isGeneral ? `[${targetSeat}] ${st.name} 조교 호출` : `[${targetSeat}] ${st.name} 질문 요청`,
                            isGeneral ? `포탈에서 호출했습니다 · 확인 후 처리하세요.` : `${qNumKey}번 문항 설명 대기 중`,
                            'call', { seat: targetSeat, qNum }
                        );
                    });
                    
                    Object.keys(st.calls).forEach(qNumKey => {
                        if (isSystemCallKey(qNumKey)) {
                            delete st.calls[qNumKey];
                            return;
                        }
                        if (dbCalls[qNumKey] && !dbCalls[qNumKey].verdict) return; 
                        delete st.calls[qNumKey];
                        if (Object.keys(st.calls).length === 0 && st.status === 'call') st.status = 'idle';
                        removeLogsByTypeAndSeat('call', targetSeat, (qNumKey === 'general' ? 'general' : Number(qNumKey)) as any);
                        isModified = true;
                    });

                    Object.keys(dbRechecks).forEach(uid => {
                        if (dbRechecks[uid]?.verdict) return; 
                        if (st.rechecks[uid]) return;
                        st.rechecks[uid] = { ...dbRechecks[uid], seat: targetSeat };
                        isModified = true;
                        appendLog('border-indigo-500', 'bg-indigo-100 text-indigo-600', '재확인요청',
                            <span className="underline decoration-dotted cursor-pointer hover:text-indigo-600" onClick={() => setRecheckModal({ isOpen: true, seat: targetSeat, uid })}>[{targetSeat}] {st.name}</span>,
                            `${dbRechecks[uid]?.qNum ?? ''}번 문항 · 직접 확인하세요.`, 'recheck', { seat: targetSeat, uid }
                        );
                    });

                    Object.keys(st.rechecks).forEach(uid => {
                        if (dbRechecks[uid] && !dbRechecks[uid].verdict) return; 
                        delete st.rechecks[uid];
                        removeLogsByTypeAndSeat('recheck', targetSeat, null, uid);
                        isModified = true;
                    });

                    const dbAwaySince = dbRecord.away_since ? new Date(dbRecord.away_since).getTime() : null;
                    if (dbAwaySince && !st.awaySince) {
                        st.awaySince = dbAwaySince; 
                        if (st.status !== 'offline') st.status = 'away'; 
                        isModified = true;
                        appendLog('border-amber-500', 'bg-amber-100 text-amber-700', '자리비움', `[${targetSeat}] ${st.name} 자리비움`, `학생이 자리를 비웠습니다.`, 'away', { seat: targetSeat });
                    } else if (!dbAwaySince && st.awaySince) {
                        st.awaySince = null; 
                        if (st.status === 'away') st.status = 'idle'; 
                        isModified = true;
                        removeLogsByTypeAndSeat('away', targetSeat);
                    }
                }
            }

            const { data: pExams } = await supabaseClient
                .from('exam_assignment')
                .select('assignment_id, student_id, total_score, exam_master!inner(title, exam_type), student!inner(name)')
                .eq('status', '제출완료')
                .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());

            const pendingVerifyStudentIds = new Set(
                (pExams || []).map((ex: any) => String(ex.student_id))
            );

            for (const [seat, dbRecord] of Array.from(dbSeats.entries())) {
                if (!current[seat] || current[seat].dummy || current[seat].type === 'reserved' || !dbRecord.last_seen_at) continue;
                
                const sinceLastSeen = Date.now() - new Date(dbRecord.last_seen_at).getTime();
                // 🌟 주간테스트 제출 후 채점 검수를 대기 중인 학생은 패드를 내려놓고 대기하므로 15분 동안 오프라인(연결 끊김) 알림을 띄우지 않음
                const isWaitingVerification =
                    current[seat].status === 'submitted' ||
                    pendingVerifyStudentIds.has(String(current[seat].studentId));
                const timeoutLimitMs = isWaitingVerification
                    ? SUBMITTED_VERIFICATION_TIMEOUT_MS
                    : HEARTBEAT_TIMEOUT_MS;
                
                if (sinceLastSeen > timeoutLimitMs) {
                    if (current[seat].status !== 'offline') {
                        current[seat].status = 'offline';
                        isModified = true;
                    }
                    if (!offlineLogSentRef.current.has(seat)) {
                        appendLog('border-slate-500', 'bg-slate-100 text-slate-500', '오프라인', `[${seat}] ${current[seat].name} 연결 끊김`, `학생 패드의 화면이 꺼졌거나 앱이 백그라운드로 내려갔습니다.`);
                        offlineLogSentRef.current.add(seat);
                    }
                } else {
                    if (current[seat].status === 'offline') {
                        current[seat].status = isWaitingVerification ? 'submitted' : 'idle';
                        isModified = true;
                    }
                    if (offlineLogSentRef.current.has(seat)) {
                        if (!isWaitingVerification) {
                            appendLog('border-emerald-500', 'bg-emerald-100 text-emerald-600', '복귀', `[${seat}] ${current[seat].name} 연결 복구`, `기기 연결이 정상적으로 복구되었습니다.`);
                        }
                        offlineLogSentRef.current.delete(seat);
                    }
                }
            }

            Object.keys(current).forEach(uiSeat => {
                const isPendingDelete = pendingDeletesRef.current[uiSeat] && Date.now() < pendingDeletesRef.current[uiSeat];
                const isPendingMove = pendingMovesRef.current[uiSeat] && Date.now() < pendingMovesRef.current[uiSeat].expiresAt;
                if (!dbSeats.has(uiSeat) && !isPendingDelete && !isPendingMove && !current[uiSeat].dummy && current[uiSeat].type !== 'reserved') {
                    delete current[uiSeat]; 
                    offlineLogSentRef.current.delete(uiSeat); 
                    isModified = true;
                }
            });
            
            if (pExams) {
                const enriched = pExams.map((ex: any) => {
                    const seatInfo = Object.values(current).find((s:any) => s.studentId === ex.student_id);
                    const dbName = Array.isArray(ex.student) ? ex.student[0]?.name : ex.student?.name;
                    const title = Array.isArray(ex.exam_master) ? ex.exam_master[0]?.title : ex.exam_master?.title;
                    return { 
                        ...ex, 
                        studentName: seatInfo ? seatInfo.name : (dbName || '이름 미상'), 
                        examTitle: title || '테스트' 
                    };
                });
                setPendingVerifications(enriched);
            }

            if (isModified) updateStudents(current);
            } finally {
                isCrossValidating = false;
            }
        };

        const dbCrossValidationInterval = setInterval(runCrossValidation, 8000);
        const handleVisible = () => {
            if (document.visibilityState === 'visible') runCrossValidation();
        };
        document.addEventListener('visibilitychange', handleVisible);
        return () => {
            clearInterval(dbCrossValidationInterval);
            document.removeEventListener('visibilitychange', handleVisible);
        };
    }, [isAuthorized, isMounted, updateStudents, appendLog, removeLogsByTypeAndSeat]);

    const recordTaStat = (key: string, mark: string) => {
        if (!key) return;
        setTaStats(prev => {
            const next = { ...prev };
            if (!next[key]) next[key] = { total: 0, hint: 0, skip: 0, verify: 0 };
            next[key].total++;
            if (mark === 'hint') next[key].hint++;
            else if (mark === 'skip') next[key].skip++;
            else if (mark === 'verify') next[key].verify = (next[key].verify || 0) + 1;
            return next;
        });
    };

    const handleTaActionFromOtherScreen = async (payload: any) => {
        const { seat, action, qNum, taName, taClientId, mark, uid } = payload;
        if (action === 'editor_lock') {
            setEditorLocked(Boolean(payload.locked));
            return;
        }
        if (action === 'ta_handling') {
            const key = String(taClientId || taName || '').trim();
            if (!key) return;
            const trimmedName = String(taName || '이름 미상').trim();
            const resolvedPos =
                String(payload.taPosition || '').trim() ||
                (payload.instructorId ? instructorPosByIdRef.current[String(payload.instructorId)] : '') ||
                instructorPosByNameRef.current[trimmedName] ||
                '';
            const updatedAt = Number(payload.updatedAt || Date.now());
            taHandlingBroadcastRef.current[key] = {
                handling: payload.handling ?? null,
                name: trimmedName,
                position: resolvedPos,
                instructorId: payload.instructorId || null,
                updatedAt,
            };
            setActiveTAs((prev) => {
                const existing = prev[key];
                return {
                    ...prev,
                    [key]: {
                        name: trimmedName || existing?.name || '이름 미상',
                        position: resolvedPos || existing?.position || '',
                        instructorId: payload.instructorId || existing?.instructorId || null,
                        joined_at: existing?.joined_at || updatedAt,
                        handling: payload.handling ?? null,
                        clientId: taClientId || existing?.clientId || key,
                    },
                };
            });
            return;
        }
        const currentStudents = { ...studentsRef.current };

        if (action === 'force_cancel_call') {
            if (currentStudents[seat]?.sessionId) {
                 const sid = currentStudents[seat].sessionId;
                 const { data } = await supabaseClient.from('clinic_session_state').select('active_calls').eq('id', sid).single();
                 if (data && data.active_calls && data.active_calls[qNum]) {
                     const newCalls = { ...data.active_calls };
                     newCalls[qNum] = { ...newCalls[qNum], verdict: 'resolved', mark: mark || 'skip' };
                     await supabaseClient.from('clinic_session_state').update({ active_calls: newCalls }).eq('id', sid);
                 }
            }
            if (currentStudents[seat]?.calls) delete currentStudents[seat].calls[qNum];
            if (Object.keys(currentStudents[seat]?.calls || {}).length === 0 && currentStudents[seat]?.status !== 'offline') currentStudents[seat].status = 'idle';
            removeLogsByTypeAndSeat('call', seat, qNum);
            appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '호출해제', `[${seat}] ${currentStudents[seat]?.name || '학생'} 지도 종료`, `${taName || '총책임자'} · ${mark === 'hint' ? '힌트 제공 후 종료' : mark === 'skip' ? '설명 없이 넘어감' : '지도 종료'}`);
            recordTaStat(taClientId || taName || '총책임자', mark);
        } else if (action === 'force_return_to_seat') {
            if (currentStudents[seat]) { 
                if (currentStudents[seat].status !== 'offline') currentStudents[seat].status = 'idle'; 
                currentStudents[seat].awaySince = null; 
            }
            removeLogsByTypeAndSeat('away', seat);
            appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '복귀처리', `[${seat}] ${currentStudents[seat]?.name || '학생'} 자리비움 해제`, `다른 화면에서 해제했습니다.`);
        } else if (action === 'force_checkout' || action === 'force_checkout_by_ta') {
            if (currentStudents[seat]) {
                const st = currentStudents[seat];
                if (st.studentId) endTodaySession(supabaseClient, st.studentId, getKSTDateString());
                appendLog(action === 'force_checkout_by_ta' ? 'border-rose-600' : 'border-slate-800', action === 'force_checkout_by_ta' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white', action === 'force_checkout_by_ta' ? '강제퇴실' : '퇴실완료', `[${seat}] ${st.name} 퇴실 처리`, `다른 화면에서 처리되었습니다.`);
                removeLogsByTypeAndSeat('call', seat); removeLogsByTypeAndSeat('submit', seat); removeLogsByTypeAndSeat('away', seat); removeLogsByTypeAndSeat('recheck', seat);
                delete currentStudents[seat]; 
                offlineLogSentRef.current.delete(seat);
                pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
            }
        } else if (action === 'resolve_recheck') {
            if (currentStudents[seat] && currentStudents[seat].rechecks) {
                delete currentStudents[seat].rechecks[uid];
            }
            removeLogsByTypeAndSeat('recheck', seat, null, uid);
        } else if (action === 'grading_verified') {
            const targetSeat = seat || Object.keys(currentStudents).find(s => currentStudents[s].studentId === payload.studentId);
            if (targetSeat && currentStudents[targetSeat]?.status === 'submitted') {
                currentStudents[targetSeat].status = 'idle';
            }
            if (payload.assignmentId) {
                setPendingVerifications(prev => prev.filter(p => String(p.assignment_id) !== String(payload.assignmentId)));
                saveVerifiedRecordToLocalCache({
                    assignmentId: Number(payload.assignmentId),
                    studentId: String(payload.studentId || ''),
                    studentName: payload.studentName || (targetSeat && currentStudents[targetSeat]?.name) || '학생',
                    examTitle: payload.examTitle || '테스트',
                    finalScore: Number(payload.finalScore ?? 0),
                    verifierName: payload.verifierName || payload.taName || '조교',
                    verifierClientId: payload.taClientId || '',
                    verifiedAt: payload.verifiedAt || new Date().toISOString()
                });
            }
            const vName = payload.verifierName || payload.taName || '조교';
            const sName = payload.studentName || (targetSeat && currentStudents[targetSeat]?.name) || '학생';
            appendLog('border-emerald-500', 'bg-emerald-100 text-emerald-700', '채점확정', `${targetSeat ? '[' + targetSeat + '] ' : ''}${sName} 채점 확인 완료`, `확인자: ${vName} · 최종 ${payload.finalScore ?? 0}점 (${payload.examTitle || '테스트'})`);
            recordTaStat(payload.taClientId || vName, 'verify');
            if (payload.taClientId && vName && payload.taClientId !== vName) {
                recordTaStat(vName, 'verify');
            }
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('logica:grading-verified', { detail: payload }));
            }
        }
        updateStudents(currentStudents);
    };

    useEffect(() => {
        if (!isAuthorized) return;
        
        const myTenantId = localStorage.getItem("logica_tenant_id") || "hq";
        const channelName = `${CLINIC_ROOM}_${myTenantId}`;
        
        let isDisposed = false;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

        if (channelRef.current) {
            const oldCh = channelRef.current;
            channelRef.current = null;
            supabaseClient.removeChannel(oldCh).catch(console.error);
        }
        
        const channel = supabaseClient.channel(channelName);
        channelRef.current = channel;

        channel
            .on('presence', { event: 'sync' }, () => { if (syncPresenceRef.current) syncPresenceRef.current(channel.presenceState()); })
            .on('broadcast', { event: 'student_action' }, ({ payload }: { payload: any }) => {
                const { seat, data, action } = payload;
                const st = { ...studentsRef.current };
                const activeSeat = Object.keys(st).find(s => st[s].studentId === data.studentId) || seat;

                if (action === 'depart') {
                    if (st[activeSeat]) {
                        appendLog('border-indigo-400', 'bg-indigo-50 text-indigo-600', '화면전환', `[${activeSeat}] ${st[activeSeat].name} 이동`, `포탈로 이동했거나 대기 중입니다.`);
                    }
                } else if (st[activeSeat]) {
                    if (st[activeSeat].status === 'offline') {
                        st[activeSeat].status = 'idle';
                    }

                    st[activeSeat].lastUpdatedAt = Date.now();

                    if (action === 'update_activity') { 
                        st[activeSeat].activity = data.activity; 
                        appendLog('border-blue-400', 'bg-blue-50 text-blue-700', '활동갱신', `[${activeSeat}] ${data.name || st[activeSeat].name || '학생'} 상태 갱신`, data.activity, 'update_activity', { seat: activeSeat });
                    }
                    else if (action === 'typing') {
                        st[activeSeat].isTyping = true;
                        if (st[activeSeat].typingTimeout) clearTimeout(st[activeSeat].typingTimeout);
                        st[activeSeat].typingTimeout = setTimeout(() => {
                            if (studentsRef.current[activeSeat]) updateStudents({ ...studentsRef.current, [activeSeat]: { ...studentsRef.current[activeSeat], isTyping: false } });
                        }, 2000);
                    } else if (action === 'call') {
                        st[activeSeat].calls[data.qNum] = { ...data, requestedAt: Date.now() }; 
                        st[activeSeat].status = 'call';
                        if (data.qNum === 'general') {
                            appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '조교호출', `[${activeSeat}] ${data.name} 조교 호출`, `포탈에서 호출했습니다 · 확인 후 처리하세요.`, 'call', { seat: activeSeat, qNum: data.qNum });
                        } else {
                            appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '질문호출', `[${activeSeat}] ${data.name} 질문 요청`, `${data.qNum}번 문항 설명 대기 중`, 'call', { seat: activeSeat, qNum: data.qNum });
                        }
                    } else if (action === 'cancel_call') {
                        delete st[activeSeat].calls[data.qNum];
                        if (Object.keys(st[activeSeat].calls).length === 0 && st[activeSeat].status !== 'offline') st[activeSeat].status = 'idle';
                        removeLogsByTypeAndSeat('call', activeSeat, data.qNum);
                    } else if (action === 'away') {
                        st[activeSeat].status = 'away'; st[activeSeat].awaySince = Date.now();
                        appendLog('border-amber-500', 'bg-amber-100 text-amber-700', '자리비움', `[${activeSeat}] ${data.name} 자리비움`, `학생이 자리를 비웠습니다.`, 'away', { seat: activeSeat });
                    } else if (action === 'cancel_away') {
                        st[activeSeat].status = 'idle'; st[activeSeat].awaySince = null;
                        removeLogsByTypeAndSeat('away', activeSeat);
                    } else if (action === 'hint') {
                        st[activeSeat].status = 'hint'; st[activeSeat].lastHint = { qNum: data.qNum, level: data.level, at: Date.now() }; st[activeSeat].totalHints = (st[activeSeat].totalHints || 0) + 1;
                        setTimeout(() => { if (studentsRef.current[activeSeat]?.status === 'hint') updateStudents({ ...studentsRef.current, [activeSeat]: { ...studentsRef.current[activeSeat], status: 'idle' } }); }, 10000);
                    } else if (action === 'submit') {
                        st[activeSeat].status = 'submitted'; st[activeSeat].score = data.score;
                        offlineLogSentRef.current.delete(activeSeat);
                        appendLog('border-emerald-500', 'bg-emerald-100 text-emerald-600', '답안제출', `[${activeSeat}] ${data.name} 제출`, `최종 점수 [${data.score}].`, 'submit', { seat: activeSeat, studentId: data.studentId });
                    } else if (action === 'recheck_request') {
                        if (!st[activeSeat].rechecks) st[activeSeat].rechecks = {};
                        st[activeSeat].rechecks[data.uid] = { ...data, seat: activeSeat };
                        appendLog('border-indigo-500', 'bg-indigo-100 text-indigo-600', '재확인요청',
                            <span className="underline decoration-dotted cursor-pointer hover:text-indigo-600" onClick={() => setRecheckModal({ isOpen: true, seat: activeSeat, uid: data.uid })}>[{activeSeat}] {data.name}</span>,
                            `${data.qNum}번 문항 · 직접 확인하세요.`, 'recheck', { seat: activeSeat, uid: data.uid }
                        );
                    } else if (action === 'end_clinic_request') {
                        st[activeSeat].endRequestPending = true;
                        appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '종료요청',
                            <span className="underline decoration-dotted cursor-pointer hover:text-rose-600" onClick={() => setEndRequestModal({ isOpen: true, seat: activeSeat })}>[{activeSeat}] {data.name}</span>,
                            `클리닉 종료를 요청했습니다 · 클릭해서 승인/거부하세요.`, 'end_request', { seat: activeSeat }
                        );
                    } else if (action === 'end_clinic_cancel_request') {
                        st[activeSeat].endRequestPending = false;
                        removeLogsByTypeAndSeat('end_request', activeSeat);
                    }
                }
                updateStudents(st);
            })
            .on('broadcast', { event: 'ta_action' }, ({ payload }: { payload: any }) => handleTaActionFromOtherScreen(payload))
            .on('broadcast', { event: SEAT_LAYOUT_UPDATED_EVENT }, () => loadSeats())
            .subscribe((status: string) => {
                if (isDisposed || channelRef.current !== channel) return;
                setConnectionStatus(status === 'SUBSCRIBED' ? 'connected' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : 'connecting');
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    if (reconnectTimer) clearTimeout(reconnectTimer);
                    const jitterMs = 3000 + Math.floor(Math.random() * 3500);
                    reconnectTimer = setTimeout(() => {
                        if (!isDisposed && channelRef.current === channel) {
                            setReconnectTrigger(p => p + 1);
                        }
                    }, jitterMs);
                }
            });

        return () => { 
            isDisposed = true;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (channelRef.current) {
                const ch = channelRef.current;
                channelRef.current = null;
                supabaseClient.removeChannel(ch).catch(console.error);
            }
        };
    }, [isAuthorized, updateStudents, appendLog, removeLogsByTypeAndSeat, loadSeats, reconnectTrigger]);

    const syncActiveStudentsFromPresence = (presenceState: any) => {
        const currentStudents = { ...studentsRef.current };
        const presenceByStudentId: any = {};
        const newActiveTAs: any = {};

        let hasEditor = false;
        Object.values(presenceState).forEach((metas: any) => {
            let latestMeta = metas.reduce((prev: any, curr: any) => (curr.updatedAt || 0) > (prev.updatedAt || 0) ? curr : prev, metas[0]);
            if (!latestMeta) return;

            if (latestMeta.role === 'editor') {
                hasEditor = true;
                return;
            }
            if (latestMeta.role === 'ta') {
                const key = latestMeta.clientId || latestMeta.name;
                const trimmedName = String(latestMeta.name || '이름 미상').trim();
                const bc = key ? taHandlingBroadcastRef.current[String(key)] : undefined;
                const resolvedPos =
                    String(latestMeta.position || bc?.position || '').trim() ||
                    (latestMeta.instructorId ? instructorPosByIdRef.current[String(latestMeta.instructorId)] : '') ||
                    instructorPosByNameRef.current[trimmedName] ||
                    '';
                const metaUpdatedAt = Number(latestMeta.updatedAt || 0);
                const effectiveHandling =
                    bc && bc.updatedAt >= metaUpdatedAt
                        ? bc.handling
                        : (latestMeta.handling || null);
                newActiveTAs[key] = {
                    name: trimmedName,
                    position: resolvedPos,
                    instructorId: latestMeta.instructorId || bc?.instructorId || null,
                    joined_at: latestMeta.joined_at || Date.now(),
                    handling: effectiveHandling,
                    clientId: latestMeta.clientId || key,
                };
            } else if (latestMeta.studentId) {
                if (!presenceByStudentId[latestMeta.studentId] || latestMeta.updatedAt > presenceByStudentId[latestMeta.studentId].lastUpdatedAt) {
                    presenceByStudentId[latestMeta.studentId] = { ...latestMeta, lastUpdatedAt: latestMeta.updatedAt };
                }
            }
        });

        let isModified = false;
        Object.keys(currentStudents).forEach(seat => {
            const st = currentStudents[seat];
            if (st.dummy || !st.studentId || st.type === 'reserved') return;
            const pData = presenceByStudentId[st.studentId];
            if (pData) {
                st.lastUpdatedAt = pData.lastUpdatedAt;
                if (pData.activity && st.activity !== pData.activity) { st.activity = pData.activity; isModified = true; }
            }
        });
        setActiveTAs(newActiveTAs);
        setEditorLocked(hasEditor);
        if (isModified) updateStudents(currentStudents);
    };
    syncPresenceRef.current = syncActiveStudentsFromPresence;

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onLocalVerified = (ev: Event) => {
            const detail = (ev as CustomEvent<VerifiedGradingRecord>).detail;
            if (!detail?.assignmentId) return;
            setPendingVerifications(prev => prev.filter(p => Number(p.assignment_id) !== Number(detail.assignmentId)));
        };
        window.addEventListener('logica:grading-verified', onLocalVerified);
        return () => window.removeEventListener('logica:grading-verified', onLocalVerified);
    }, []);

    const checkClinicTimeExpiry = useCallback(() => {
        const current = { ...studentsRef.current };
        let isModified = false;
        Object.keys(current).forEach(seat => {
            const st = current[seat];
            if (st.dummy || st.type === 'reserved' || !st.studentId || !st.firstSeenAt || st.clinicDurationMs == null) return;
            if (Date.now() < st.firstSeenAt + st.clinicDurationMs) return;

            endTodaySession(supabaseClient, st.studentId, getKSTDateString());
            sendToStudent(seat, 'force_checkout');
            appendLog('border-slate-800', 'bg-slate-900 text-white', '시간종료', `[${seat}] ${st.name} 이용시간 종료`, `배정된 클리닉 시간이 모두 소진되어 자동 퇴실 처리되었습니다.`);
            removeLogsByTypeAndSeat('call', seat); removeLogsByTypeAndSeat('submit', seat); removeLogsByTypeAndSeat('away', seat); removeLogsByTypeAndSeat('recheck', seat); removeLogsByTypeAndSeat('end_request', seat);
            delete current[seat];
            pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
            isModified = true;
        });
        if (isModified) updateStudents(current);
    }, [updateStudents, appendLog, removeLogsByTypeAndSeat]);
    checkClinicTimeExpiryRef.current = checkClinicTimeExpiry;

    const checkReservationExpiry = useCallback(() => {
        const current = { ...studentsRef.current };
        let isModified = false;
        Object.keys(current).forEach(seat => {
            const st = current[seat];
            if (st.type === 'reserved' && Date.now() > st.expiresAt) {
                appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '예약만료', `[${seat}] ${st.name} 예약 만료`, `예약 시간이 초과되어 예약이 종료되었습니다.`);
                if (st.studentId) supabaseClient.from('clinic_reservation').delete().eq('student_id', st.studentId).eq('session_date', getKSTDateString()).then();
                delete current[seat];
                isModified = true;
            }
        });
        if (isModified) updateStudents(current);
    }, [updateStudents, appendLog]);
    checkReservationExpiryRef.current = checkReservationExpiry;

    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => {
            if (!draggedSeat && !draggedListStudent) return;
            const ghost = document.getElementById('drag-ghost');
            if (ghost) {
                ghost.style.left = `${e.clientX - dragOffsetRef.current.x}px`;
                ghost.style.top = `${e.clientY - dragOffsetRef.current.y}px`;
            }
            const elements = document.elementsFromPoint(e.clientX, e.clientY);
            const cell = elements.find(el => el.getAttribute('data-seat'));
            document.querySelectorAll('[data-seat]').forEach(el => el.classList.remove('ring-4', 'ring-indigo-400'));
            if (cell) {
                const targetSeat = cell.getAttribute('data-seat');
                if (targetSeat && targetSeat !== draggedSeat && !studentsRef.current[targetSeat]) {
                    cell.classList.add('ring-4', 'ring-indigo-400');
                }
            }
        };

        const handlePointerUp = async (e: PointerEvent) => {
            if (!draggedSeat && !draggedListStudent) return;
            document.querySelectorAll('[data-seat]').forEach(el => el.classList.remove('ring-4', 'ring-indigo-400'));
            const elements = document.elementsFromPoint(e.clientX, e.clientY);
            const cell = elements.find(el => el.getAttribute('data-seat'));
            
            if (draggedListStudent) {
                if (cell) {
                    const targetSeat = cell.getAttribute('data-seat')!;
                    if (!studentsRef.current[targetSeat]) {
                        setReservationModal({ isOpen: true, seat: targetSeat, student: draggedListStudent });
                    } else alert('이미 다른 학생이 있는 자리입니다.');
                }
                setDraggedListStudent(null);
                setGhostRect(null);
                return;
            }

            if (cell) {
                const targetSeat = cell.getAttribute('data-seat')!;
                if (targetSeat !== draggedSeat && !studentsRef.current[targetSeat] && !registeredSeatsRef.current.has(targetSeat)) {
                    alert(`${targetSeat}번 좌석엔 등록된 패드가 없습니다. 학생이 인계받을 화면이 없어 이동할 수 없습니다.\n먼저 /clinic-pad-registry에서 그 좌석에 패드를 등록해주세요.`);
                } else if (targetSeat !== draggedSeat && !studentsRef.current[targetSeat]) {
                    const studentId = studentsRef.current[draggedSeat!]?.studentId;
                    const sessionId = studentsRef.current[draggedSeat!]?.sessionId;
                    const sName = studentsRef.current[draggedSeat!]?.name || '학생';

                    if (studentId && sessionId) {
                        const RELOCATE_DEBOUNCE_MS = 5000;
                        const sinceLastRelocate = Date.now() - lastRelocateAtRef.current;
                        if (sinceLastRelocate < RELOCATE_DEBOUNCE_MS) {
                            const remainingSec = Math.ceil((RELOCATE_DEBOUNCE_MS - sinceLastRelocate) / 1000);
                            alert(`방금 다른 좌석 이동이 있었습니다. ${remainingSec}초 후 다시 시도해주세요.`);
                        } else if (window.confirm(`${sName} 학생을 ${draggedSeat}에서 ${targetSeat}으로 이동하시겠습니까?\n(실제로 그 자리 패드에서 이어받아야 이동이 완료됩니다)`)) {
                            const token = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
                            const expiresAt = new Date(Date.now() + 60000).toISOString();
                            lastRelocateAtRef.current = Date.now();
                            await supabaseClient.from('clinic_session_state')
                                .update({ transfer_token: token, transfer_token_expires_at: expiresAt })
                                .eq('id', sessionId);
                            sendToStudent(draggedSeat!, 'relocated_away', {});
                            sendToStudent(targetSeat, 'relocated_in', { studentId, name: sName, token });
                            appendLog('border-indigo-500', 'bg-indigo-100 text-indigo-600', '좌석이동', `[${draggedSeat}] ${sName} 학생`, `[${draggedSeat}] → [${targetSeat}] 이동 요청 — 목적지 패드에서 인계 대기 중`);
                        }
                    }
                } else if (studentsRef.current[targetSeat] && targetSeat !== draggedSeat) {
                    alert('빈 자리로만 옮길 수 있습니다.');
                }
            }
            setDraggedSeat(null); setSelectedSeatForMove(null); setGhostRect(null);
        };

        if (draggedSeat || draggedListStudent) {
            document.addEventListener('pointermove', handlePointerMove);
            document.addEventListener('pointerup', handlePointerUp);
        }
        return () => {
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
        };
    }, [draggedSeat, draggedListStudent, updateStudents, appendLog]);

    const handlePointerDown = (e: React.PointerEvent, seat: string) => {
        if (e.button !== 0 || !activeStudents[seat] || (e.target as HTMLElement).closest('button')) return;
        const st = activeStudents[seat];
        const hasPendingRecheck = !!(st.rechecks && Object.keys(st.rechecks).length > 0);
        if (st.type !== 'reserved' && ((st.status && st.status !== 'idle') || hasPendingRecheck)) {
            const statusLabel = hasPendingRecheck ? '채점 대기' : st.status === 'away' ? '자리비움' : st.status === 'call' ? '호출' : st.status === 'hint' ? '힌트 진행' : st.status === 'submitted' ? '제출' : st.status;
            alert(`[${statusLabel}] 상태인 학생은 자리를 이동할 수 없습니다. 상태 해제 후 다시 시도해주세요.`);
            return;
        }
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const scale = target.offsetWidth > 0 ? rect.width / target.offsetWidth : 1;
        dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setGhostRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, scale });
        setDraggedSeat(seat); setSelectedSeatForMove(seat); e.preventDefault();
    };

    const handleListPointerDown = (e: React.PointerEvent, student: any) => {
        if (e.button !== 0) return;
        const anySeatEl = document.querySelector('[data-seat]') as HTMLElement | null;
        const rect = anySeatEl?.getBoundingClientRect();
        const width = rect?.width || seatWidth;
        const height = rect?.height || seatHeight;
        dragOffsetRef.current = { x: width / 2, y: height / 2 };
        setGhostRect({ left: e.clientX - width / 2, top: e.clientY - height / 2, width, height, scale: 1 });
        setDraggedListStudent(student); e.preventDefault();
    };

    const confirmReservation = async (timeStr: string) => {
        const { seat, student } = reservationModal;
        if (!seat || !student || !timeStr) return;
        const [h, m] = timeStr.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) { alert('시간을 올바르게 입력해주세요.'); return; }

        const reservedDate = new Date();
        reservedDate.setHours(h, m, 0, 0);
        const reservedFor = reservedDate.getTime();
        const expiresAt = reservedFor + RESERVATION_GRACE_MS;
        const todayStr = getKSTDateString();

        const currentStudents = { ...studentsRef.current };
        currentStudents[seat] = {
            type: 'reserved', name: student.name, classes: student.classes, studentId: student.id,
            reservedFor, expiresAt, calls: {}, totalCalls: 0, totalHints: 0
        };
        updateStudents(currentStudents);
        appendLog('border-indigo-500', 'bg-indigo-100 text-indigo-700', '예약', `[${seat}] ${student.name} 예약`, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} 예약 등록`);
        setReservationModal({ isOpen: false, seat: null, student: null });

        await supabaseClient.from('clinic_reservation').upsert({
            student_id: student.id, student_name: student.name, classes: student.classes, seat, session_date: todayStr,
            reserved_for: new Date(reservedFor).toISOString(), expires_at: new Date(expiresAt).toISOString()
        }, { onConflict: 'student_id, session_date' });
    };

    const cancelReservation = async (seat: string) => {
        const st = studentsRef.current[seat];
        const currentStudents = { ...studentsRef.current };
        delete currentStudents[seat];
        updateStudents(currentStudents);
        if (st?.studentId) await supabaseClient.from('clinic_reservation').delete().eq('student_id', st.studentId).eq('session_date', getKSTDateString());
    };

    const adjustClinicTime = async (seat: string, deltaMinutes: number) => {
        const st = studentsRef.current[seat];
        if (!st) return;
        const newDuration = Math.max(0, (st.clinicDurationMs || DEFAULT_CLINIC_DURATION_MS) + (deltaMinutes * 60 * 1000));
        const currentStudents = { ...studentsRef.current };
        currentStudents[seat].clinicDurationMs = newDuration;
        updateStudents(currentStudents);
        pendingTimeAdjustRef.current[seat] = { value: newDuration, expiresAt: Date.now() + 3000 };
        
        if (st.sessionId) {
            await supabaseClient.from('clinic_session_state').update({ duration_ms: newDuration }).eq('id', st.sessionId);
        } else if (st.studentId) {
            await supabaseClient.from('clinic_session_state').update({ duration_ms: newDuration }).eq('student_id', st.studentId).eq('session_date', getKSTDateString()).is('ended_at', null);
        }
        sendToStudent(seat, 'adjust_clinic_time', { deltaMs: deltaMinutes * 60 * 1000, newDuration, studentId: st.studentId || null });
    };

    const confirmForceCheckout = () => {
        const seat = forceCheckoutModal.seat;
        if (!seat) return;
        const currentStudents = { ...studentsRef.current };
        if (currentStudents[seat]) {
            const st = currentStudents[seat];
            sendToStudent(seat, 'force_checkout_by_ta');
            if (st.studentId) endTodaySession(supabaseClient, st.studentId, getKSTDateString());
            removeLogsByTypeAndSeat('call', seat); delete currentStudents[seat];
            offlineLogSentRef.current.delete(seat);
            pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
        }
        updateStudents(currentStudents);
        setForceCheckoutModal({ isOpen: false, seat: null });
    };

    const resolveEndRequest = async (approved: boolean) => {
        const seat = endRequestModal.seat;
        if (!seat) return;
        const st = studentsRef.current[seat];
        setEndRequestModal({ isOpen: false, seat: null });
        if (!st) return;

        removeLogsByTypeAndSeat('end_request', seat);

        if (approved) {
            sendToStudent(seat, 'end_clinic_resolved', { approved: true, studentId: st.studentId || null });
            if (st.studentId) await resolveEndSessionForStudent(supabaseClient, st.studentId, getKSTDateString(), true);
            const currentStudents = { ...studentsRef.current };
            appendLog('border-slate-800', 'bg-slate-900 text-white', '퇴실완료', `[${seat}] ${st.name} 퇴실`, `종료 요청이 승인되었습니다.`);
            delete currentStudents[seat];
            offlineLogSentRef.current.delete(seat);
            pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
            updateStudents(currentStudents);
        } else {
            const cooldownUntil = Date.now() + END_REQUEST_COOLDOWN_MS;
            sendToStudent(seat, 'end_clinic_resolved', { approved: false, cooldownUntil, studentId: st.studentId || null });
            if (st.studentId) await resolveEndSessionForStudent(supabaseClient, st.studentId, getKSTDateString(), false);
            const currentStudents = { ...studentsRef.current };
            if (currentStudents[seat]) currentStudents[seat].endRequestPending = false;
            appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '종료요청거부', `[${seat}] ${st.name} 종료요청 거부`, `종료 요청을 거부했습니다 (5분 쿨타임).`);
            updateStudents(currentStudents);
        }
    };

    const resolveRecheck = async (seat: string, uid: string, verdict: 'correct' | 'incorrect') => {
        const st = studentsRef.current[seat];
        if (!st) return;

        const targetRecheck = st.rechecks?.[uid];
        const qNum = targetRecheck?.qNum;

        if (verdict === 'correct' && targetRecheck) {
            if (targetRecheck.deferredWrite) {
                const nowIso = new Date().toISOString();
                if (targetRecheck.recordId) {
                    await supabaseClient.from('student_incorrect_record').update({ status: 'O', resolved_at: nowIso }).eq('record_id', targetRecheck.recordId);
                } else if (st.studentId && (targetRecheck.tqId || targetRecheck.questionId)) {
                    const filterCol = targetRecheck.tqId ? 'tq_id' : 'question_id';
                    const filterVal = targetRecheck.tqId ?? targetRecheck.questionId;
                    await supabaseClient.from('student_incorrect_record').update({ status: 'O', resolved_at: nowIso }).eq('student_id', st.studentId).eq(filterCol, filterVal).is('resolved_at', null);
                }
                if (targetRecheck.examAssignmentId && targetRecheck.questionId && st.studentId) {
                    const [{ data: asgData }, { data: gcData }] = await Promise.all([
                        supabaseClient.from('exam_assignment').select('exam_id, exam_master(exam_type, total_questions, layout_settings)').eq('assignment_id', targetRecheck.examAssignmentId).maybeSingle(),
                        supabaseClient.from('master_grading_code').select('code, description, is_correct, score_ratio, admission_ratio')
                    ]);
                    const gcMeta: Record<string, any> = {};
                    gcData?.forEach((row: any) => { if (row.code) gcMeta[row.code] = row; });
                    const em: any = Array.isArray(asgData?.exam_master) ? asgData?.exam_master[0] : asgData?.exam_master;
                    const { data: examItems } = asgData?.exam_id
                        ? await supabaseClient.from('exam_item').select('question_id, sort_order, assigned_score').eq('exam_id', asgData.exam_id).order('sort_order')
                        : { data: [] as any[] };
                    const { scoreByQuestionId, groupCount } = buildExamQuestionScoreMap(
                        examItems || [],
                        em?.layout_settings,
                        em?.exam_type,
                        em?.total_questions || 1
                    );
                    const defaultQScore = 100 / (groupCount || em?.total_questions || 1);
                    const qScore = scoreByQuestionId.get(String(targetRecheck.questionId)) ?? defaultQScore;
                    await supabaseClient.from('student_answer').update({ is_correct: true, grading_code: 'O', earned_score: qScore }).eq('exam_assignment_id', targetRecheck.examAssignmentId).eq('student_id', st.studentId).eq('question_id', targetRecheck.questionId);
                    const { data: rows } = await supabaseClient.from('student_answer').select('question_id, grading_code, is_correct').eq('exam_assignment_id', targetRecheck.examAssignmentId).eq('student_id', st.studentId);
                    if (rows && rows.length > 0) {
                        let sum = 0;
                        rows.forEach((r: any) => {
                            const s = scoreByQuestionId.get(String(r.question_id)) ?? (100 / (groupCount || rows.length || 1));
                            const code = r.grading_code || (r.is_correct ? 'O' : 'X');
                            sum += calcScoreRatio(code, s, gcMeta, false).newEarned;
                        });
                        const total = roundScore(sum);
                        await supabaseClient.from('exam_assignment').update({ total_score: total }).eq('assignment_id', targetRecheck.examAssignmentId);
                    }
                }
            } else {
                if (targetRecheck.recordId) {
                    await supabaseClient.from('student_incorrect_record').delete().eq('record_id', targetRecheck.recordId);
                } else if (targetRecheck.tqId || targetRecheck.questionId) {
                    const filterCol = targetRecheck.tqId ? 'tq_id' : 'question_id';
                    const filterVal = targetRecheck.tqId ?? targetRecheck.questionId;
                    await supabaseClient.from('student_incorrect_record').delete()
                        .eq('student_id', st.studentId)
                        .eq(filterCol, filterVal);
                }
            }
        }

        if (st.sessionId) {
            const { data } = await supabaseClient.from('clinic_session_state').select('active_rechecks').eq('id', st.sessionId).single();
            if (data && data.active_rechecks && data.active_rechecks[uid]) {
                const newRechecks = { ...data.active_rechecks };
                newRechecks[uid].verdict = verdict; 
                if (qNum) newRechecks[uid].qNum = qNum; 
                await supabaseClient.from('clinic_session_state').update({ active_rechecks: newRechecks }).eq('id', st.sessionId);
            }
        }

        sendToStudent(seat, 'resolve_recheck', { uid, verdict, qNum });

        const currentStudents = { ...studentsRef.current };
        if (currentStudents[seat] && currentStudents[seat].rechecks) {
            delete currentStudents[seat].rechecks[uid];
        }
        removeLogsByTypeAndSeat('recheck', seat, null, uid);
        updateStudents(currentStudents);
        setRecheckModal({ isOpen: false, seat: null, uid: null });
    };

    const taAction = async (seat: string, type: string, qNum: any = null, mark: string = 'skip') => {
        const currentStudents = { ...studentsRef.current };
        
        if (type === 'cancel_call') {
            if (qNum !== null) {
                const qNumStr = String(qNum);
                const isInvalidCallKey =
                    !qNumStr ||
                    qNumStr === 'NaN' ||
                    qNumStr === 'REFRESH' ||
                    qNumStr.startsWith('__') ||
                    (qNumStr !== 'general' && isNaN(Number(qNumStr)));

                if (isInvalidCallKey) {
                    if (currentStudents[seat]?.calls) {
                        delete currentStudents[seat].calls[qNum];
                        delete currentStudents[seat].calls['__last_verified'];
                    }
                    if (Object.keys(currentStudents[seat]?.calls || {}).length === 0 && currentStudents[seat]?.status !== 'offline') {
                        if (currentStudents[seat]) currentStudents[seat].status = 'idle';
                    }
                    removeLogsByTypeAndSeat('call', seat, qNum);
                    updateStudents(currentStudents);
                    return;
                }

                if (currentStudents[seat]?.sessionId) {
                     const sid = currentStudents[seat].sessionId;
                     const { data } = await supabaseClient.from('clinic_session_state').select('active_calls').eq('id', sid).maybeSingle();
                     if (data && data.active_calls && data.active_calls[qNum]) {
                         const newCalls = { ...data.active_calls };
                         newCalls[qNum] = { ...newCalls[qNum], verdict: 'resolved', mark: mark };
                         await supabaseClient.from('clinic_session_state').update({ active_calls: newCalls }).eq('id', sid);
                     }
                }
                if (currentStudents[seat]?.calls) delete currentStudents[seat].calls[qNum];
                if (Object.keys(currentStudents[seat]?.calls || {}).length === 0 && currentStudents[seat]?.status !== 'offline') currentStudents[seat].status = 'idle';
                removeLogsByTypeAndSeat('call', seat, qNum);
                sendToStudent(seat, 'force_cancel_call', { qNum });
                
                appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '호출처리완료', `[${seat}] ${currentStudents[seat]?.name || '학생'} 지도 완료`, `원장/실장 · ${mark === 'hint' ? '💡 힌트 제공 후 종료' : '⏭️ 설명 생략하고 넘김'}`);
            }
        } else if (type === 'clear_away') {
            if (currentStudents[seat]) { 
                if (currentStudents[seat].status !== 'offline') currentStudents[seat].status = 'idle'; 
                currentStudents[seat].awaySince = null; 
            }
            removeLogsByTypeAndSeat('away', seat); sendToStudent(seat, 'force_return_to_seat');
            if (currentStudents[seat]?.sessionId) clearAway(supabaseClient, currentStudents[seat].sessionId);
            appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '복귀처리', `[${seat}] ${currentStudents[seat]?.name || '학생'} 복귀 처리`, `다른 화면에서 복귀 처리했습니다.`);
        } else if (type === 'confirm_checkout') {
            if (currentStudents[seat]) {
                const st = currentStudents[seat]; sendToStudent(seat, 'force_checkout');
                if (st.studentId) endTodaySession(supabaseClient, st.studentId, getKSTDateString());
                removeLogsByTypeAndSeat('submit', seat); delete currentStudents[seat];
                offlineLogSentRef.current.delete(seat);
                pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
            }
        } else if (type === 'force_refresh') {
            if (currentStudents[seat]?.sessionId) {
                supabaseClient.from('clinic_session_state')
                    .select('active_calls')
                    .eq('id', currentStudents[seat].sessionId)
                    .single()
                    .then(({ data }) => {
                        const newCalls = { ...(data?.active_calls || {}), REFRESH: Date.now() };
                        supabaseClient.from('clinic_session_state').update({ active_calls: newCalls }).eq('id', currentStudents[seat].sessionId).then();
                    });
            }
            sendToStudent(seat, 'force_refresh');
            appendLog('border-blue-500', 'bg-blue-100 text-blue-700', '새로고침', `[${seat}] ${currentStudents[seat]?.name || '학생'} 기기 새로고침`, `학생 패드에 강제 새로고침 신호를 전송했습니다.`);
        } else if (type === 'force_reset') {
            if (currentStudents[seat]) {
                const st = currentStudents[seat];
                if (st.status !== 'offline') st.status = 'idle';
                st.awaySince = null;
                st.calls = {};
                st.rechecks = {};
                st.endRequestPending = false;
                removeLogsByTypeAndSeat('call', seat);
                removeLogsByTypeAndSeat('away', seat);
                removeLogsByTypeAndSeat('recheck', seat);
                removeLogsByTypeAndSeat('end_request', seat);
                
                if (st.sessionId) {
                    supabaseClient.from('clinic_session_state').update({
                        active_calls: { REFRESH: Date.now() },
                        active_rechecks: {},
                        away_since: null,
                        end_request_status: 'idle'
                    }).eq('id', st.sessionId).then();
                }

                sendToStudent(seat, 'force_refresh');
                appendLog('border-fuchsia-500', 'bg-fuchsia-100 text-fuchsia-700', '강제초기화', `[${seat}] ${st.name} 상태 리셋`, `프리징된 모든 상태를 강제로 해제하고 기기를 새로고침했습니다.`);
            }
        }
        updateStudents(currentStudents);
    };

    return {
        isAuthorized, authMessage,
        now, startedAt, connectionStatus, isMounted,
        activeStudents, activeTAs, taStats, logs,
        allStudents, leftTab, setLeftTab, expandedClasses, setExpandedClasses,
        clinicRecords, expandedRecords, toggleRecordExpand, fetchClinicRecords,
        draggedSeat, draggedListStudent, selectedSeatForMove,
        forceCheckoutModal, setForceCheckoutModal, recheckModal, setRecheckModal,
        endRequestModal, setEndRequestModal, resolveEndRequest,
        reservationModal, setReservationModal, confirmReservation, cancelReservation,
        handlePointerDown, handleListPointerDown, adjustClinicTime, confirmForceCheckout, taAction, sendToStudent, removeLogsByTypeAndSeat, appendLog,
        resolveRecheck,
        ghostRect,
        seats, seatObjs, canvasWidth, canvasHeight, seatWidth, seatHeight, editorLocked,
        pendingVerifications, setPendingVerifications, confirmVerification
    };
}