// src/lib/presenceThrottle.ts
// =========================================================
// Supabase Realtime ClientPresenceRateLimitReached 원천 차단기
// - Supabase 기본 정책: 단일 WebSocket 연결당 30초 내 track() + untrack() 합산 최대 5회
// - 싱글톤 WebSocket(SPA 페이지 이동 포함) 전체에서 32초 슬라이딩 윈도우 내 최대 4회로 엄격 제한
// - 제한 구간 중 들어온 연속 상태 변경은 버리지 않고 마지막 상태 1건으로 병합(Coalescing)하여 예약 전송
// =========================================================

const CONNECTION_WINDOW_MS = 32_000; // 서버 30초 윈도우 대비 2초 안전 마진 확보
const MAX_CONNECTION_OPS_PER_WINDOW = 4; // 서버 한도(5회) 대비 여유 마진 확보 (절대 5회 도달 불가)
const MIN_CONNECTION_BURST_GAP_MS = 1_500; // 서로 다른 화면 전환 직후 연속 전송 최소 간격

// 브라우저 탭(싱글톤 WebSocket) 전역 슬라이딩 윈도우 타임스탬프 기록
const connectionOpTimestamps: number[] = [];

function pruneExpiredTimestamps(now: number): void {
  while (
    connectionOpTimestamps.length > 0 &&
    now - connectionOpTimestamps[0] >= CONNECTION_WINDOW_MS
  ) {
    connectionOpTimestamps.shift();
  }
}

function getWaitMsForConnectionBudget(now: number, controllerLastAt: number, minGapMs: number): number {
  pruneExpiredTimestamps(now);

  let waitMs = 0;

  // 1) 개별 컨트롤러 최소 간격 (초기 첫 전송 controllerLastAt === 0 일 때는 면제)
  if (controllerLastAt > 0) {
    const gapWait = minGapMs - (now - controllerLastAt);
    if (gapWait > waitMs) waitMs = gapWait;
  }

  // 2) WebSocket 전역 연속 버스트 방지 간격
  if (connectionOpTimestamps.length > 0) {
    const lastGlobalAt = connectionOpTimestamps[connectionOpTimestamps.length - 1];
    const burstWait = MIN_CONNECTION_BURST_GAP_MS - (now - lastGlobalAt);
    if (burstWait > waitMs) waitMs = burstWait;
  }

  // 3) WebSocket 전역 32초 슬라이딩 윈도우 한도(최대 4회) 검사
  if (connectionOpTimestamps.length >= MAX_CONNECTION_OPS_PER_WINDOW) {
    const oldestInWindow = connectionOpTimestamps[0];
    const windowWait = CONNECTION_WINDOW_MS - (now - oldestInWindow) + 250;
    if (windowWait > waitMs) waitMs = windowWait;
  }

  return Math.max(0, waitMs);
}

function recordConnectionOp(now: number): void {
  pruneExpiredTimestamps(now);
  connectionOpTimestamps.push(now);
}

export interface PresenceRateLimiterOptions {
  minGapMs?: number;
  dedupTtlMs?: number;
}

export interface PresenceRateLimiter {
  scheduleTrack: (
    getChannel: () => any,
    payload: Record<string, any>,
    dedupKey?: string,
    force?: boolean
  ) => void;
  scheduleUntrack: (getChannel: () => any) => void;
  cancelPending: () => void;
  resetControllerState: () => void;
}

export function createPresenceRateLimiter(
  options?: PresenceRateLimiterOptions
): PresenceRateLimiter {
  const minGapMs = options?.minGapMs ?? 8_000;
  const dedupTtlMs = options?.dedupTtlMs ?? 28_000;

  let lastSentAt = 0;
  let lastSentKey = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingAction:
    | {
        kind: "track";
        getChannel: () => any;
        payload: Record<string, any>;
        dedupKey: string;
      }
    | {
        kind: "untrack";
        getChannel: () => any;
      }
    | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flushPending = () => {
    timer = null;
    if (!pendingAction) return;

    const now = Date.now();
    const waitMs = getWaitMsForConnectionBudget(now, lastSentAt, minGapMs);
    if (waitMs > 0) {
      timer = setTimeout(flushPending, waitMs);
      return;
    }

    const actionToRun = pendingAction;
    pendingAction = null;

    const ch = actionToRun.getChannel();
    if (!ch) return;

    if (actionToRun.kind === "track") {
      if (typeof ch.track !== "function") return;
      const finalPayload = {
        ...actionToRun.payload,
        updatedAt: now,
      };
      lastSentAt = now;
      lastSentKey = actionToRun.dedupKey;
      recordConnectionOp(now);
      Promise.resolve(ch.track(finalPayload)).catch(() => {});
    } else {
      if (typeof ch.untrack !== "function") return;
      lastSentAt = now;
      lastSentKey = "__UNTRACKED__";
      recordConnectionOp(now);
      Promise.resolve(ch.untrack()).catch(() => {});
    }
  };

  const scheduleTrack = (
    getChannel: () => any,
    payload: Record<string, any>,
    dedupKey?: string,
    force = false
  ) => {
    const computedKey =
      dedupKey ??
      JSON.stringify(
        Object.keys(payload)
          .filter((k) => k !== "updatedAt")
          .sort()
          .reduce((acc: Record<string, any>, k: string) => {
            acc[k] = payload[k];
            return acc;
          }, {})
      );

    const now = Date.now();

    // 이미 동일한 페이로드를 최근에 보냈고 예약된 반대 작업(untrack)도 없다면 중복 전송 생략
    if (
      !force &&
      !pendingAction &&
      computedKey === lastSentKey &&
      now - lastSentAt < dedupTtlMs
    ) {
      return;
    }

    pendingAction = {
      kind: "track",
      getChannel,
      payload,
      dedupKey: computedKey,
    };

    clearTimer();
    const waitMs = getWaitMsForConnectionBudget(now, lastSentAt, minGapMs);
    if (waitMs === 0) {
      flushPending();
    } else {
      timer = setTimeout(flushPending, waitMs);
    }
  };

  const scheduleUntrack = (getChannel: () => any) => {
    const now = Date.now();

    // 아직 서버에 한 번도 track을 보내지 않았고 대기 중인 track만 있었다면 로컬에서 즉시 상쇄 (네트워크 호출 0회)
    if (lastSentAt === 0 || lastSentKey === "__UNTRACKED__") {
      pendingAction = null;
      clearTimer();
      return;
    }

    pendingAction = {
      kind: "untrack",
      getChannel,
    };

    clearTimer();
    const waitMs = getWaitMsForConnectionBudget(now, lastSentAt, minGapMs);
    if (waitMs === 0) {
      flushPending();
    } else {
      timer = setTimeout(flushPending, waitMs);
    }
  };

  const cancelPending = () => {
    pendingAction = null;
    clearTimer();
  };

  const resetControllerState = () => {
    pendingAction = null;
    clearTimer();
    lastSentAt = 0;
    lastSentKey = "";
  };

  return {
    scheduleTrack,
    scheduleUntrack,
    cancelPending,
    resetControllerState,
  };
}
