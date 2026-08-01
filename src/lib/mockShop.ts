// src/lib/mockShop.ts
// 💡 임시(목업) 상점 데이터 레이어 — 아직 실제 Supabase 테이블이 없어서 전부 localStorage에만 저장된다.
// 나중에 진짜 DB(포인트 컬럼, product/purchase 테이블)가 생기면 이 파일의 함수들만 Supabase 호출로
// 바꿔치면 되도록, 화면 쪽 코드는 이 파일이 내보내는 함수만 통해서 상점 데이터를 읽고 쓴다.

export type ShopProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageDataUrl: string | null;
  createdAt: number;
};

export type ShopPurchase = {
  id: string;
  studentId: string;
  studentName: string;
  productId: string;
  productName: string;
  pricePaid: number;
  purchasedAt: number;
};

const PRODUCTS_KEY = 'logica_mock_shop_products';
const PURCHASES_KEY = 'logica_mock_shop_purchases';
const DEFAULT_POINTS = 12500;

const readJson = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
};

// 💡 로그인 화면(src/app/page.tsx)이 세션 초기화를 위해 localStorage.clear()를 호출하는데,
// 그러면 이 임시 상점 데이터(상품/구매내역/포인트)까지 통째로 날아간다. 그 clear() 전후로
// 이 함수들을 불러서 logica_mock_* 키만 스냅샷/복원하면 로그인해도 상점 데이터가 유지된다.
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

export const getProducts = (): ShopProduct[] => readJson<ShopProduct[]>(PRODUCTS_KEY, []);

export const saveProducts = (products: ShopProduct[]) => writeJson(PRODUCTS_KEY, products);

export const addProduct = (input: { name: string; description: string; price: number; imageDataUrl: string | null }): ShopProduct => {
  const product: ShopProduct = { id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), ...input };
  saveProducts([product, ...getProducts()]);
  return product;
};

export const deleteProduct = (productId: string) => {
  saveProducts(getProducts().filter(p => p.id !== productId));
};

export const getPurchases = (): ShopPurchase[] => readJson<ShopPurchase[]>(PURCHASES_KEY, []);

const pointsKey = (studentId: string) => `logica_mock_points_${studentId}`;

export const getPointBalance = (studentId: string): number => {
  if (typeof window === 'undefined') return DEFAULT_POINTS;
  const raw = localStorage.getItem(pointsKey(studentId));
  if (raw === null) {
    localStorage.setItem(pointsKey(studentId), String(DEFAULT_POINTS));
    return DEFAULT_POINTS;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_POINTS;
};

export const setPointBalance = (studentId: string, value: number) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(pointsKey(studentId), String(value));
};

// 포인트가 충분하면 차감 + 구매내역 기록까지 한 번에 처리한다. 부족하면 아무것도 바꾸지 않고 false를 반환.
export const purchaseProduct = (studentId: string, studentName: string, product: ShopProduct): boolean => {
  const balance = getPointBalance(studentId);
  if (balance < product.price) return false;
  setPointBalance(studentId, balance - product.price);
  const purchase: ShopPurchase = {
    id: `o_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    studentId, studentName, productId: product.id, productName: product.name,
    pricePaid: product.price, purchasedAt: Date.now(),
  };
  writeJson(PURCHASES_KEY, [purchase, ...getPurchases()]);
  return true;
};
