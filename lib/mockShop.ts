// src/lib/mockShop.ts
// 💡 상점 데이터(포인트/상품/구매내역)는 이제 전부 Supabase DB로 옮겨졌다
// (src/app/actions/shopPoints.ts, src/app/actions/shopProducts.ts). 이 파일은 과거 localStorage
// 시절의 흔적으로, 로그인 화면 등 여러 곳에서 호출하는 snapshot/restore 유틸만 남아있다 — 지금은
// `logica_mock_*` 키 자체가 더 이상 쓰이지 않으므로 사실상 빈 스냅샷을 주고받는 아무 동작도 안 하는
// 함수가 됐지만, 호출부를 일일이 걷어내는 것보다 그대로 두는 편이 안전해서 남겨둔다.
export const snapshotMockShopStorage = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  const snapshot: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('logica_mock_')) snapshot[key] = localStorage.getItem(key) || '';
  }
  return snapshot;
};

export const restoreMockShopStorage = (snapshot: Record<string, string>) => {
  if (typeof window === 'undefined') return;
  Object.entries(snapshot).forEach(([key, value]) => localStorage.setItem(key, value));
};
