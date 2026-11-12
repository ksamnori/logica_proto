// src/lib/postgresRealtimeHub.ts
// ============================================================================
// Supabase postgres_changes 공유 구독 허브 (SQLSTATE 57014 / 구독 풀 병목 원천 완화)
// 1) 테이블 단위 싱글톤 채널 공유:
//    - TopHeader, FloatingChat, AgendaSidebar와 각 페이지(/task, /supply, /cs,
//      /minutes, /home, /admin-dashboard, /makeup, /hq 등)가 동일 테이블을 중복 구독할 때
//      realtime.subscription INSERT를 단 1회만 수행하고 메모리에서 이벤트를 팬아웃합니다.
//    - 서로 다른 테이블을 억지로 한 채널에 묶지 않아 특정 테이블이 Publication에서 빠지더라도
//      다른 테이블 채널의 phx_join이 연쇄 거절되지 않도록 격리성을 유지합니다.
// 2) 동일 테이블 다중 이벤트 통합:
//    - 기본값으로 서버에는 event: '*' 1건만 등록하고 JS에서 INSERT/UPDATE/DELETE를 필터링해
//      테이블당 realtime.subscription 행 수와 subscription_check_filters() 실행 횟수를 최소화합니다.
//    - 단, clinic_session_state처럼 UPDATE(하트비트) 제외가 필수인 테이블은 serverEvents로
//      DB 레벨 필터(['INSERT', 'DELETE'])를 그대로 유지합니다.
// 3) 순차 구독 큐(Staggered Join Queue):
//    - 초기 대시보드 진입 시 수십 개의 phx_join이 1ms 안에 동시 발사되어
//      realtime_subscription_manager_pub 커넥션 풀이 포화되는 현상을 막기 위해
//      채널 subscribe() 호출 간 최소 간격(120ms)을 두고 순차 연결합니다.
// 4) 인플라이트 보호 + 유예 해제(15초 Grace Teardown):
//    - 빠른 메뉴 이동이나 React StrictMode/의존성 재실행 시 진행 중인 구독 INSERT를
//      즉시 removeChannel()로 끊어 발생하는 57014(canceling statement due to user request)를
//      방지하기 위해 마지막 리스너 해제 후 15초 유예 뒤 안전하게 채널을 정리합니다.
// ============================================================================

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/lib/supabase';

export type PgChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export interface PgRealtimePayload<T = Record<string, any>> {
  schema: string;
  table: string;
  commit_timestamp: string;
  eventType: PgChangeEvent;
  new: T;
  old: Partial<T>;
  errors: string[] | null;
}

export interface SharedPgSubscriptionOptions {
  table: string;
  schema?: string;
  filter?: string;
  /** JS 콜백으로 전달받을 이벤트 타입 (미지정 시 INSERT, UPDATE, DELETE 모두 수신) */
  events?: PgChangeEvent[];
  /**
   * 서버(Postgres WAL) 단에서 특정 이벤트만 바인딩해야 할 때 지정.
   * 예: clinic_session_state의 UPDATE 하트비트 폭주를 막기 위한 ['INSERT', 'DELETE']
   */
  serverEvents?: PgChangeEvent[];
  /** 별도 인증 토큰 클라이언트를 쓰는 경우 주입 (기본값: 공용 싱글톤 supabase) */
  client?: SupabaseClient;
}

interface HubListener {
  id: number;
  events: Set<PgChangeEvent> | null; // null 이면 모든 이벤트 수신
  callback: (payload: PgRealtimePayload<any>) => void;
}

interface HubChannelEntry {
  key: string;
  topicName: string;
  client: SupabaseClient;
  schema: string;
  table: string;
  filter?: string;
  serverEvents: PgChangeEvent[] | null;
  channel: RealtimeChannel | null;
  status: 'QUEUED' | 'JOINING' | 'SUBSCRIBED' | 'ERROR' | 'CLOSED';
  joinStartedAt: number;
  listeners: Map<number, HubListener>;
  teardownTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryCount: number;
}

interface GlobalPgHubState {
  nextListenerId: number;
  nextTopicSeq: number;
  clientIds: WeakMap<object, number>;
  nextClientId: number;
  entries: Map<string, HubChannelEntry>;
  joinQueue: HubChannelEntry[];
  joinDrainTimer: ReturnType<typeof setTimeout> | null;
  lastJoinDispatchedAt: number;
}

const JOIN_MIN_INTERVAL_MS = 120; // 동시 phx_join 폭주 방지 간격
const IDLE_TEARDOWN_MS = 15_000; // 페이지 전환 시 채널 재사용 및 인플라이트 취소(57014) 방지 유예 시간
const JOINING_SAFE_GUARD_MS = 6_000; // JOINING 상태일 때 중도 취소 방지 최소 보호 시간

function getHubState(): GlobalPgHubState {
  const globalTarget = (typeof window !== 'undefined' ? window : globalThis) as unknown as {
    _logicaPgRealtimeHub?: GlobalPgHubState;
  };

  if (!globalTarget._logicaPgRealtimeHub) {
    globalTarget._logicaPgRealtimeHub = {
      nextListenerId: 1,
      nextTopicSeq: 1,
      clientIds: new WeakMap<object, number>(),
      nextClientId: 1,
      entries: new Map<string, HubChannelEntry>(),
      joinQueue: [],
      joinDrainTimer: null,
      lastJoinDispatchedAt: 0,
    };
  }

  return globalTarget._logicaPgRealtimeHub;
}

function getClientTag(hub: GlobalPgHubState, client: SupabaseClient): number {
  const existing = hub.clientIds.get(client as unknown as object);
  if (existing) return existing;
  const created = hub.nextClientId++;
  hub.clientIds.set(client as unknown as object, created);
  return created;
}

function normalizeServerEvents(serverEvents?: PgChangeEvent[]): PgChangeEvent[] | null {
  if (!serverEvents || serverEvents.length === 0) return null;
  const uniq = Array.from(new Set<PgChangeEvent>(serverEvents)).sort();
  if (uniq.length === 3) return null; // INSERT+UPDATE+DELETE 모두면 '*'와 동일
  return uniq;
}

function buildEntryKey(
  clientTag: number,
  schema: string,
  table: string,
  filter: string | undefined,
  serverEvents: PgChangeEvent[] | null
): string {
  const evSig = serverEvents ? serverEvents.join(',') : '*';
  return `c${clientTag}|${schema}|${table}|${filter || ''}|${evSig}`;
}

function dispatchToListeners(entry: HubChannelEntry, rawPayload: unknown): void {
  const payload = rawPayload as PgRealtimePayload<any>;
  const evType = payload?.eventType;
  const snapshot = Array.from(entry.listeners.values());

  for (const listener of snapshot) {
    if (listener.events && evType && !listener.events.has(evType)) {
      continue;
    }
    try {
      listener.callback(payload);
    } catch (err) {
      console.error(`[PgRealtimeHub] listener error on ${entry.table}:`, err);
    }
  }
}

function scheduleJoinDrain(hub: GlobalPgHubState): void {
  if (hub.joinDrainTimer !== null) return;
  if (hub.joinQueue.length === 0) return;

  const now = Date.now();
  const elapsed = now - hub.lastJoinDispatchedAt;
  const waitMs = hub.lastJoinDispatchedAt === 0 ? 0 : Math.max(0, JOIN_MIN_INTERVAL_MS - elapsed);

  hub.joinDrainTimer = setTimeout(() => {
    hub.joinDrainTimer = null;
    drainNextJoin(hub);
  }, waitMs);
}

function drainNextJoin(hub: GlobalPgHubState): void {
  while (hub.joinQueue.length > 0) {
    const entry = hub.joinQueue.shift()!;
    // 대기 중 이미 폐기되었거나 리스너가 사라지고 유예 만료된 엔트리는 건너뜀
    if (!hub.entries.has(entry.key)) continue;
    if (entry.channel !== null) continue;

    hub.lastJoinDispatchedAt = Date.now();
    mountAndSubscribeChannel(hub, entry);
    break;
  }

  if (hub.joinQueue.length > 0) {
    scheduleJoinDrain(hub);
  }
}

function mountAndSubscribeChannel(hub: GlobalPgHubState, entry: HubChannelEntry): void {
  const safeTableSlug = entry.table.replace(/[^a-zA-Z0-9_]/g, '');
  const topicName = `pg_shared_${safeTableSlug}_${hub.nextTopicSeq++}`;
  entry.topicName = topicName;
  entry.status = 'JOINING';
  entry.joinStartedAt = Date.now();

  let ch: RealtimeChannel = entry.client.channel(topicName);

  if (entry.serverEvents && entry.serverEvents.length > 0) {
    for (const ev of entry.serverEvents) {
      const pgFilter: {
        event: PgChangeEvent;
        schema: string;
        table: string;
        filter?: string;
      } = {
        event: ev,
        schema: entry.schema,
        table: entry.table,
      };
      if (entry.filter) pgFilter.filter = entry.filter;
      ch = (ch as any).on('postgres_changes', pgFilter, (payload: unknown) => {
        dispatchToListeners(entry, payload);
      });
    }
  } else {
    const pgFilter: {
      event: '*';
      schema: string;
      table: string;
      filter?: string;
    } = {
      event: '*',
      schema: entry.schema,
      table: entry.table,
    };
    if (entry.filter) pgFilter.filter = entry.filter;
    ch = (ch as any).on('postgres_changes', pgFilter, (payload: unknown) => {
      dispatchToListeners(entry, payload);
    });
  }

  entry.channel = ch;

  ch.subscribe((status: string) => {
    if (entry.channel !== ch) return;

    if (status === 'SUBSCRIBED') {
      entry.status = 'SUBSCRIBED';
      entry.retryCount = 0;
      return;
    }

    if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
      entry.status = 'ERROR';
      // 여전히 활성 구독자가 존재하면 지수 백오프로 조용히 재구독 (폭주 방지)
      if (entry.listeners.size > 0 && entry.retryTimer === null) {
        const delayMs = Math.min(15_000, 1_500 * Math.pow(2, entry.retryCount));
        entry.retryCount = Math.min(entry.retryCount + 1, 4);
        entry.retryTimer = setTimeout(() => {
          entry.retryTimer = null;
          if (!hub.entries.has(entry.key) || entry.listeners.size === 0) return;
          const oldCh = entry.channel;
          entry.channel = null;
          entry.status = 'QUEUED';
          if (oldCh) {
            Promise.resolve(entry.client.removeChannel(oldCh)).catch(() => {});
          }
          if (!hub.joinQueue.includes(entry)) {
            hub.joinQueue.push(entry);
            scheduleJoinDrain(hub);
          }
        }, delayMs);
      }
    } else if (status === 'CLOSED') {
      entry.status = 'CLOSED';
    }
  });
}

function scheduleEntryTeardown(hub: GlobalPgHubState, entry: HubChannelEntry): void {
  if (entry.teardownTimer !== null) return;

  const attemptTeardown = () => {
    entry.teardownTimer = null;
    if (entry.listeners.size > 0) return;

    // 아직 JOINING 중이고 최소 보호 시간 내라면 DB INSERT 중도 취소(57014) 방지를 위해 잠깐 더 대기
    const now = Date.now();
    if (
      entry.status === 'JOINING' &&
      now - entry.joinStartedAt < JOINING_SAFE_GUARD_MS
    ) {
      const extraWait = JOINING_SAFE_GUARD_MS - (now - entry.joinStartedAt) + 250;
      entry.teardownTimer = setTimeout(attemptTeardown, extraWait);
      return;
    }

    if (entry.retryTimer !== null) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }

    hub.entries.delete(entry.key);
    const qIdx = hub.joinQueue.indexOf(entry);
    if (qIdx >= 0) {
      hub.joinQueue.splice(qIdx, 1);
    }

    const ch = entry.channel;
    entry.channel = null;
    entry.status = 'CLOSED';
    if (ch) {
      Promise.resolve(entry.client.removeChannel(ch)).catch(() => {});
    }
  };

  // 아직 채널 생성 전(큐 대기 중)에 즉시 언마운트된 경우(예: React StrictMode 첫 마운트 해제)
  // 짧은 300ms 유예만 두어 다음 마운트가 곧바로 재사용하거나 DB 쿼리 0회로 소멸되게 처리
  const delay = entry.channel === null ? 300 : IDLE_TEARDOWN_MS;
  entry.teardownTimer = setTimeout(attemptTeardown, delay);
}

/**
 * 테이블 단위 공유 postgres_changes 구독을 등록하고 해제 함수를 반환합니다.
 */
export function subscribePostgresChanges<T = Record<string, any>>(
  options: SharedPgSubscriptionOptions,
  callback: (payload: PgRealtimePayload<T>) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const hub = getHubState();
  const client = options.client ?? defaultSupabase;
  const schema = options.schema ?? 'public';
  const table = options.table;
  const filter = options.filter?.trim() || undefined;
  const serverEvents = normalizeServerEvents(options.serverEvents);
  const clientTag = getClientTag(hub, client);
  const key = buildEntryKey(clientTag, schema, table, filter, serverEvents);

  let entry = hub.entries.get(key);
  if (!entry) {
    entry = {
      key,
      topicName: '',
      client,
      schema,
      table,
      filter,
      serverEvents,
      channel: null,
      status: 'QUEUED',
      joinStartedAt: 0,
      listeners: new Map<number, HubListener>(),
      teardownTimer: null,
      retryTimer: null,
      retryCount: 0,
    };
    hub.entries.set(key, entry);
    hub.joinQueue.push(entry);
    scheduleJoinDrain(hub);
  } else if (entry.teardownTimer !== null) {
    clearTimeout(entry.teardownTimer);
    entry.teardownTimer = null;
  }

  const listenerId = hub.nextListenerId++;
  const eventSet =
    options.events && options.events.length > 0
      ? new Set<PgChangeEvent>(options.events)
      : null;

  entry.listeners.set(listenerId, {
    id: listenerId,
    events: eventSet,
    callback: callback as (payload: PgRealtimePayload<any>) => void,
  });

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;

    const currentEntry = hub.entries.get(key);
    if (!currentEntry) return;

    currentEntry.listeners.delete(listenerId);
    if (currentEntry.listeners.size === 0) {
      scheduleEntryTeardown(hub, currentEntry);
    }
  };
}
