// src/lib/clinicSession.ts
// clinic_session_state는 학생 1명이 하루에 여러 번(재이용) 세션을 가질 수 있다(session_no로 회차 구분).
// student_id만으로는 어느 회차인지 알 수 없으므로, 세션을 만들거나/끝내거나/여러 명을 한 번에 읽을 때는
// 항상 이 유틸을 통해 "오늘 가장 최근(session_no가 가장 큰) 세션"을 정확히 다룬다.

export const DEFAULT_CLINIC_SESSION_DURATION_MS = 60 * 60 * 1000; // 첫 클리닉: 60분
export const RENEWAL_CLINIC_SESSION_DURATION_MS = 30 * 60 * 1000; // 재이용(2회차 이상): 30분
export const END_REQUEST_COOLDOWN_MS = 5 * 60 * 1000; // 종료 요청 거부/취소 후 재요청 쿨타임

export function isSessionExpired(session: { started_at: string; duration_ms: number } | null | undefined, now = Date.now()) {
    if (!session) return false;
    return (new Date(session.started_at).getTime() + session.duration_ms) <= now;
}

// 오늘 학생의 최신 세션을 가져오거나, 없거나 이미 시간이 다 지났으면 새로 만든다(재이용은 30분).
export async function resolveTodaySession(supabaseClient: any, studentId: string, todayStr: string) {
    const { data: rows } = await supabaseClient
        .from('clinic_session_state')
        .select('*')
        .eq('student_id', studentId)
        .eq('session_date', todayStr)
        .order('session_no', { ascending: false })
        .limit(1);

    const latest = rows?.[0] || null;

    if (!latest) {
        const fresh = { student_id: studentId, session_date: todayStr, session_no: 1, started_at: new Date().toISOString(), duration_ms: DEFAULT_CLINIC_SESSION_DURATION_MS, seat: null, manual_seat: null, ended_at: null };
        const { data: inserted } = await supabaseClient.from('clinic_session_state').insert(fresh).select().single();
        return inserted || fresh;
    }

    // 시간이 다 지났거나(자연 만료), 이미 종료 처리된(승인된 조기 종료 등) 세션이면 재이용 세션을 새로 연다.
    if (latest.ended_at || isSessionExpired(latest)) {
        // 방금 끝난 회차는 좌석을 반납하고 종료 시각을 남겨 기록을 완결시킨다.
        await supabaseClient.from('clinic_session_state').update({ seat: null, ended_at: latest.ended_at || new Date().toISOString() }).eq('id', latest.id);
        const fresh = { student_id: studentId, session_date: todayStr, session_no: latest.session_no + 1, started_at: new Date().toISOString(), duration_ms: RENEWAL_CLINIC_SESSION_DURATION_MS, seat: null, manual_seat: latest.manual_seat || null, ended_at: null };
        const { data: inserted } = await supabaseClient.from('clinic_session_state').insert(fresh).select().single();
        return inserted || fresh;
    }

    return latest;
}

// 로그아웃/강제퇴실 등으로 세션을 명시적으로 끝낼 때: 오늘 그 학생의 최신 세션 행을 찾아 종료 처리한다.
export async function endTodaySession(supabaseClient: any, studentId: string, todayStr: string) {
    const { data: row } = await supabaseClient
        .from('clinic_session_state')
        .select('id')
        .eq('student_id', studentId)
        .eq('session_date', todayStr)
        .order('session_no', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!row?.id) return;
    await supabaseClient.from('clinic_session_state').update({ seat: null, manual_seat: null, ended_at: new Date().toISOString(), end_request_status: null, end_request_cooldown_until: null }).eq('id', row.id);
}

// 학생이 "클리닉 종료"를 요청한다. 이미 쿨타임 중이면(새로고침으로 우회 시도 포함) 서버측에서도 무시한다.
export async function requestEndSession(supabaseClient: any, sessionId: string) {
    const { data: row } = await supabaseClient.from('clinic_session_state').select('end_request_cooldown_until').eq('id', sessionId).maybeSingle();
    if (row?.end_request_cooldown_until && new Date(row.end_request_cooldown_until).getTime() > Date.now()) return false;
    await supabaseClient.from('clinic_session_state').update({ end_request_status: 'pending' }).eq('id', sessionId);
    return true;
}

// 학생이 대기 중이던 종료 요청을 스스로 취소한다 — 취소도 거부와 동일하게 5분 쿨타임이 붙는다.
export async function cancelEndSession(supabaseClient: any, sessionId: string) {
    const cooldownUntil = new Date(Date.now() + END_REQUEST_COOLDOWN_MS).toISOString();
    await supabaseClient.from('clinic_session_state').update({ end_request_status: null, end_request_cooldown_until: cooldownUntil }).eq('id', sessionId);
    return cooldownUntil;
}

// 수퍼바이저가 학생의 종료 요청을 승인/거부한다.
// 승인: 그 시점을 이용시간의 종료 시각으로 확정한다. 거부: 5분 쿨타임을 건다.
export async function resolveEndSession(supabaseClient: any, sessionId: string, approved: boolean) {
    if (approved) {
        await supabaseClient.from('clinic_session_state').update({ seat: null, manual_seat: null, ended_at: new Date().toISOString(), end_request_status: null, end_request_cooldown_until: null }).eq('id', sessionId);
        return { approved: true as const };
    }
    const cooldownUntil = new Date(Date.now() + END_REQUEST_COOLDOWN_MS).toISOString();
    await supabaseClient.from('clinic_session_state').update({ end_request_status: null, end_request_cooldown_until: cooldownUntil }).eq('id', sessionId);
    return { approved: false as const, cooldownUntil };
}

// 수퍼바이저 화면은 세션 행의 id가 아니라 studentId만 들고 있으므로, endTodaySession과 같은 방식으로
// 오늘 그 학생의 최신 세션을 찾아 resolveEndSession을 적용한다.
export async function resolveEndSessionForStudent(supabaseClient: any, studentId: string, todayStr: string, approved: boolean) {
    const { data: row } = await supabaseClient
        .from('clinic_session_state')
        .select('id')
        .eq('student_id', studentId)
        .eq('session_date', todayStr)
        .order('session_no', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!row?.id) return null;
    return resolveEndSession(supabaseClient, row.id, approved);
}

// 버그 등으로 학생 화면이 사라져도, 배정된 제한시간이 지나면 "그 제한시간 시각"을 종료 시각으로 자동 마감한다.
// 이미 다른 경로(승인된 조기 종료 등)로 ended_at이 채워졌다면 덮어쓰지 않는다.
export async function closeSessionAtLimit(supabaseClient: any, sessionId: string, startedAt: string | number, durationMs: number) {
    const endedAt = new Date(new Date(startedAt).getTime() + durationMs).toISOString();
    await supabaseClient.from('clinic_session_state').update({ ended_at: endedAt, seat: null, manual_seat: null }).eq('id', sessionId).is('ended_at', null);
}

// 💡 호출/재확인/자리비움은 원래 실시간 broadcast로만 존재해서, 그 신호가 나간 "이후"에 새로 열린
// 수퍼바이저/조교 화면은 이미 대기 중인 요청을 전혀 알 수 없었다(broadcast는 그 순간 접속해있던
// 화면에만 전달되고 재생되지 않으므로). end_request_status와 같은 방식으로 DB에도 남겨서,
// 새 화면이 마운트될 때 여기서 다시 읽어와 로그를 재생성할 수 있게 한다.

// 진행 중인 호출을 문항번호(qNum)로 등록한다. qNum이 없는 포탈발 일반 호출은 'general'을 쓴다.
export async function setActiveCall(supabaseClient: any, sessionId: string, qNum: string | number, payload: Record<string, any>) {
    const { data: row } = await supabaseClient.from('clinic_session_state').select('active_calls').eq('id', sessionId).maybeSingle();
    const activeCalls = { ...(row?.active_calls || {}), [String(qNum)]: { ...payload, requestedAt: Date.now() } };
    await supabaseClient.from('clinic_session_state').update({ active_calls: activeCalls }).eq('id', sessionId);
}

// 호출을 해제한다(학생이 취소하거나 조교가 처리 완료했을 때).
export async function clearActiveCall(supabaseClient: any, sessionId: string, qNum: string | number) {
    const { data: row } = await supabaseClient.from('clinic_session_state').select('active_calls').eq('id', sessionId).maybeSingle();
    const activeCalls = { ...(row?.active_calls || {}) };
    delete activeCalls[String(qNum)];
    await supabaseClient.from('clinic_session_state').update({ active_calls: activeCalls }).eq('id', sessionId);
}

// 진행 중인 재확인 요청을 uid로 등록한다.
export async function setActiveRecheck(supabaseClient: any, sessionId: string, uid: string, payload: Record<string, any>) {
    const { data: row } = await supabaseClient.from('clinic_session_state').select('active_rechecks').eq('id', sessionId).maybeSingle();
    const activeRechecks = { ...(row?.active_rechecks || {}), [uid]: { ...payload, requestedAt: Date.now() } };
    await supabaseClient.from('clinic_session_state').update({ active_rechecks: activeRechecks }).eq('id', sessionId);
}

// 재확인 요청을 해제한다(조교가 정답/오답 판정을 마쳤을 때).
export async function clearActiveRecheck(supabaseClient: any, sessionId: string, uid: string) {
    const { data: row } = await supabaseClient.from('clinic_session_state').select('active_rechecks').eq('id', sessionId).maybeSingle();
    const activeRechecks = { ...(row?.active_rechecks || {}) };
    delete activeRechecks[uid];
    await supabaseClient.from('clinic_session_state').update({ active_rechecks: activeRechecks }).eq('id', sessionId);
}

// 자리비움 시작/해제를 DB에도 남긴다.
export async function setAway(supabaseClient: any, sessionId: string) {
    await supabaseClient.from('clinic_session_state').update({ away_since: new Date().toISOString() }).eq('id', sessionId);
}

export async function clearAway(supabaseClient: any, sessionId: string) {
    await supabaseClient.from('clinic_session_state').update({ away_since: null }).eq('id', sessionId);
}

// 여러 학생의 오늘자 세션을 한 번에 읽을 때(수퍼바이저/조교 pad), 학생별로 session_no가 가장 큰 행만 남긴다.
export function pickLatestSessionPerStudent<T extends { student_id: string; session_no: number }>(rows: T[]): T[] {
    const map = new Map<string, T>();
    for (const r of rows) {
        const prev = map.get(r.student_id);
        if (!prev || r.session_no > prev.session_no) map.set(r.student_id, r);
    }
    return Array.from(map.values());
}
