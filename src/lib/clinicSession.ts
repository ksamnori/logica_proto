// src/lib/clinicSession.ts
// clinic_session_state는 학생 1명이 하루에 여러 번(재이용) 세션을 가질 수 있다(session_no로 회차 구분).
// student_id만으로는 어느 회차인지 알 수 없으므로, 세션을 만들거나/끝내거나/여러 명을 한 번에 읽을 때는
// 항상 이 유틸을 통해 "오늘 가장 최근(session_no가 가장 큰) 세션"을 정확히 다룬다.

export const DEFAULT_CLINIC_SESSION_DURATION_MS = 60 * 60 * 1000; // 첫 클리닉: 60분
export const RENEWAL_CLINIC_SESSION_DURATION_MS = 30 * 60 * 1000; // 재이용(2회차 이상): 30분
export const END_REQUEST_COOLDOWN_MS = 5 * 60 * 1000; // 종료 요청 거부/취소 후 재요청 쿨타임
export const TOGGLE_COOLDOWN_MS = 10 * 1000; // 호출/자리비움 연타 방지 쿨다운 (useToggleCooldown과 값을 맞춘다)

export function isSessionExpired(session: { started_at: string; duration_ms: number } | null | undefined, now = Date.now()) {
    if (!session) return false;
    return (new Date(session.started_at).getTime() + session.duration_ms) <= now;
}

async function fetchLatestSession(supabaseClient: any, studentId: string, todayStr: string) {
    const { data: rows } = await supabaseClient
        .from('clinic_session_state')
        .select('*')
        .eq('student_id', studentId)
        .eq('session_date', todayStr)
        .order('session_no', { ascending: false })
        .limit(1);
    return rows?.[0] || null;
}

// 💡 세션을 닫는 경로(closeSessionAtLimit=시간초과 자동종료, 하트비트 타임아웃)는 전부 그 순간에
// 학생/수퍼바이저 화면이 켜져있어야만 동작한다 — 탭이 갑자기 닫히거나 기기 전원이 나가면 아무도
// 그 세션을 안 닫아준다. resolveTodaySession은 원래 "오늘" 날짜만 조회해서, 지나간 날짜의 미종료
// 세션은 이후로 다시 들여다볼 방법이 없어 ended_at이 null인 채로 영원히 쌓였다. 학생이 새로 접속할
// 때(=여기)마다 그 학생의 지나간 날짜 미종료 세션을 자연 만료 시각(started_at+duration_ms)으로
// 정리해서, 서버 크론 없이도 다음 접속 시점에 자동으로 청소되게 한다.
async function closeStaleSessions(supabaseClient: any, studentId: string, todayStr: string) {
    const { data: staleRows } = await supabaseClient
        .from('clinic_session_state')
        .select('id, started_at, duration_ms')
        .eq('student_id', studentId)
        .is('ended_at', null)
        .neq('session_date', todayStr);
    if (!staleRows || staleRows.length === 0) return;
    await Promise.all(staleRows.map((row: any) => {
        const endedAt = new Date(new Date(row.started_at).getTime() + row.duration_ms).toISOString();
        return supabaseClient.from('clinic_session_state').update({ seat: null, manual_seat: null, ended_at: endedAt }).eq('id', row.id);
    }));
}

// 오늘 학생의 최신 세션을 가져오거나, 없거나 이미 시간이 다 지났으면 새로 만든다(재이용은 30분).
// fixedSeat: 키오스크 패드처럼 좌석이 기기에 고정된 경우, 그 좌석 번호를 그대로 강제한다
// (빈 좌석을 찾는 경쟁 로직 없이 항상 이 값을 쓴다). 안 넘기면 기존처럼 seat: null로 시작해서
// 화면 쪽 좌석배정 로직(assignSeatDirectly 등)이 나중에 채운다.
export async function resolveTodaySession(supabaseClient: any, studentId: string, todayStr: string, fixedSeat?: string | null) {
    await closeStaleSessions(supabaseClient, studentId, todayStr);
    const latest = await fetchLatestSession(supabaseClient, studentId, todayStr);

    if (!latest) {
        const fresh = { student_id: studentId, session_date: todayStr, session_no: 1, started_at: new Date().toISOString(), duration_ms: DEFAULT_CLINIC_SESSION_DURATION_MS, seat: fixedSeat || null, manual_seat: null, ended_at: null };
        const { data: inserted } = await supabaseClient.from('clinic_session_state').insert(fresh).select().single();
        // 💡 같은 학생 화면이 거의 동시에 두 번 마운트되면(React strict mode의 effect 중복 실행,
        // 새로고침 겹침 등) 둘 다 "오늘 세션 없음"을 보고 동시에 insert를 시도할 수 있다. 이때 진
        // 쪽은 (student_id, session_date, session_no) unique 제약으로 insert가 실패하는데, 그 결과를
        // 그대로 id 없는 로컬 fresh 객체로 반환해버리면 이후 좌석 배정/호출/자리비움 DB 갱신이
        // 전부 조용히 씹힌다. insert가 실패하면 이긴 쪽이 이미 만들어둔 실제 행을 다시 읽어와 쓴다.
        return inserted || await fetchLatestSession(supabaseClient, studentId, todayStr) || fresh;
    }

    // 시간이 다 지났거나(자연 만료), 이미 종료 처리된(승인된 조기 종료 등) 세션이면 재이용 세션을 새로 연다.
    if (latest.ended_at || isSessionExpired(latest)) {
        // 방금 끝난 회차는 좌석을 반납하고 종료 시각을 남겨 기록을 완결시킨다.
        await supabaseClient.from('clinic_session_state').update({ seat: null, ended_at: latest.ended_at || new Date().toISOString() }).eq('id', latest.id);
        const fresh = { student_id: studentId, session_date: todayStr, session_no: latest.session_no + 1, started_at: new Date().toISOString(), duration_ms: RENEWAL_CLINIC_SESSION_DURATION_MS, seat: fixedSeat || null, manual_seat: latest.manual_seat || null, ended_at: null };
        const { data: inserted } = await supabaseClient.from('clinic_session_state').insert(fresh).select().single();
        return inserted || await fetchLatestSession(supabaseClient, studentId, todayStr) || fresh;
    }

    // 이미 진행 중인 세션인데 저장된 좌석이 지금 로그인한 패드의 고정 좌석과 다르면(예: 관리자가
    // 이 패드를 다른 좌석에 재등록했다) 다음 로그인 시점에 스스로 맞춰준다.
    if (fixedSeat && latest.seat !== fixedSeat) {
        await supabaseClient.from('clinic_session_state').update({ seat: fixedSeat }).eq('id', latest.id);
        return { ...latest, seat: fixedSeat };
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

// 호출/자리비움은 학생이 직접 누르는 토글이라, 클라이언트 쿨다운(useToggleCooldown)만으로는
// 새로고침하면 풀려버린다. 그래서 여기서도 쿨다운 시각을 확인/기록한다 — requestEndSession과
// 동일한 패턴(읽고 아직 안 지났으면 거부, 지났으면 새 쿨다운을 걸고 통과).
// 💡 조교/수퍼바이저가 clearActiveCall/clearAway를 호출해 처리하는 경로는 이 가드를 거치지 않는다
// (학생의 연타 방지와 무관한 정상 처리라서 여기서 막으면 안 된다) — 그래서 setActiveCall/clearActiveCall/
// setAway/clearAway 내부가 아니라, 학생이 직접 누르는 화면(clinic/viewer, student/portal)에서만
// 이 함수를 먼저 호출하고 통과했을 때만 저 함수들을 부르게 한다.
export async function checkAndBumpToggleCooldown(supabaseClient: any, sessionId: string, kind: 'call' | 'away'): Promise<{ ok: boolean; cooldownUntil: string }> {
    const column = kind === 'call' ? 'call_cooldown_until' : 'away_cooldown_until';
    const { data: row } = await supabaseClient.from('clinic_session_state').select(column).eq('id', sessionId).maybeSingle();
    const current = row?.[column] as string | null | undefined;
    if (current && new Date(current).getTime() > Date.now()) {
        return { ok: false, cooldownUntil: current };
    }
    const cooldownUntil = new Date(Date.now() + TOGGLE_COOLDOWN_MS).toISOString();
    await supabaseClient.from('clinic_session_state').update({ [column]: cooldownUntil }).eq('id', sessionId);
    return { ok: true, cooldownUntil };
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
