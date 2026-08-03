// src/app/actions/shopProducts.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { spendPoints, addPoints } from "./shopPoints";

// 💡 shopPoints.ts와 동일한 패턴: 서버 액션에서만 service_role 키를 써서 RLS 없이 관리한다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export type PurchaseStatus = 'completed' | 'cancelled';

export type ShopProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageDataUrl: string | null;
  stock: number | null; // null = 무제한
  createdAt: number;
};

export type ShopPurchase = {
  id: string;
  studentId: string;
  studentName: string;
  productId: string | null;
  productName: string;
  pricePaid: number;
  status: PurchaseStatus;
  purchasedAt: number;
  fulfilledAt: number | null;
  fulfilledBy: string | null;
};

function rowToProduct(row: any): ShopProduct {
  return {
    id: row.id, name: row.name, description: row.description || '', price: row.price,
    imageDataUrl: row.image_data_url, stock: row.stock,
    createdAt: new Date(row.created_at).getTime(),
  };
}

function rowToPurchase(row: any): ShopPurchase {
  return {
    id: row.id, studentId: row.student_id, studentName: row.student_name,
    productId: row.product_id, productName: row.product_name, pricePaid: row.price_paid, status: row.status,
    purchasedAt: new Date(row.purchased_at).getTime(),
    fulfilledAt: row.fulfilled_at ? new Date(row.fulfilled_at).getTime() : null,
    fulfilledBy: row.fulfilled_by,
  };
}

export async function listProducts(): Promise<ShopProduct[]> {
  const { data, error } = await supabaseAdmin.from('shop_product').select('*').order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(rowToProduct);
}

export async function createProduct(input: { name: string; description: string; price: number; imageDataUrl: string | null; stock: number | null }): Promise<ShopProduct | null> {
  const { data, error } = await supabaseAdmin.from('shop_product').insert({
    name: input.name, description: input.description, price: input.price,
    image_data_url: input.imageDataUrl, stock: input.stock,
  }).select().single();
  if (error || !data) return null;
  return rowToProduct(data);
}

export async function updateProduct(id: string, input: { name: string; description: string; price: number; imageDataUrl: string | null; stock: number | null }): Promise<ShopProduct | null> {
  const { data, error } = await supabaseAdmin.from('shop_product').update({
    name: input.name, description: input.description, price: input.price,
    image_data_url: input.imageDataUrl, stock: input.stock,
  }).eq('id', id).select().single();
  if (error || !data) return null;
  return rowToProduct(data);
}

// 구매내역은 상품명/가격을 구매 시점에 스냅샷으로 이미 들고 있어서, 상품을 진짜로 지워도 지난
// 구매내역 표시가 깨지지 않는다 — 그냥 삭제한다.
export async function deleteProduct(id: string): Promise<{ success: boolean; message?: string }> {
  const { error } = await supabaseAdmin.from('shop_product').delete().eq('id', id);
  if (error) return { success: false, message: error.message };
  return { success: true };
}

export async function listPurchases(): Promise<ShopPurchase[]> {
  const { data, error } = await supabaseAdmin.from('shop_purchase').select('*').order('purchased_at', { ascending: false });
  if (error || !data) return [];
  return data.map(rowToPurchase);
}

// 재고가 있는 상품은 "재고 > 0일 때만" 조건부 UPDATE로 먼저 원자적으로 1개 차감한다(동시에 여러
// 학생이 마지막 재고 하나를 두고 구매를 시도해도, DB 행 잠금 덕분에 둘 다 성공하는 일은 없다).
// 재고 차감이 성공한 뒤에 포인트를 차감하고, 포인트가 부족해 실패하면 방금 차감한 재고를 되돌린다
// — 그 반대 순서(포인트 먼저)로 하면 "포인트는 이미 냈는데 재고가 없어서 못 삼" 상황을 되돌리기
// 위해 환불 로직이 따로 필요해지므로, 재고를 먼저 잠그는 순서가 더 단순하다.
export async function purchaseProduct(studentId: string, studentName: string, productId: string): Promise<{ success: boolean; message?: string; status?: PurchaseStatus }> {
  const { data: product } = await supabaseAdmin.from('shop_product').select('*').eq('id', productId).maybeSingle();
  if (!product) return { success: false, message: '존재하지 않는 상품입니다.' };

  let stockReserved = false;
  if (product.stock !== null) {
    const { data: decremented } = await supabaseAdmin.from('shop_product')
      .update({ stock: product.stock - 1 })
      .eq('id', productId).gt('stock', 0)
      .select().maybeSingle();
    if (!decremented) return { success: false, message: '품절된 상품입니다.' };
    stockReserved = true;
  }

  const spend = await spendPoints(studentId, product.price);
  if (!spend.success) {
    if (stockReserved) await supabaseAdmin.from('shop_product').update({ stock: product.stock }).eq('id', productId);
    return { success: false, message: spend.message || '포인트가 부족합니다.' };
  }

  // 💡 product_id를 같이 저장해둔다 — cancelPurchase가 환불 시 재고를 복원하려면 어느 상품
  // 행이었는지 알아야 한다(상품명만으로는 동명이인처럼 같은 이름 상품이 여러 번 등록될 수 있어
  // 안전하게 특정할 수 없다). 상품이 나중에 삭제돼도 이 값은 그냥 고아 참조로 남을 뿐 문제
  // 없다(재고 복원 시도 시 조회가 안 되면 조용히 건너뛴다).
  const status: PurchaseStatus = 'completed';
  const { error } = await supabaseAdmin.from('shop_purchase').insert({
    student_id: studentId, student_name: studentName, product_id: productId,
    product_name: product.name, price_paid: product.price, status,
  });
  if (error) return { success: false, message: error.message };
  return { success: true, status };
}

// 구매 취소/환불: 포인트를 되돌려주고, 재고를 추적하는 상품이었다면(그리고 아직 남아있다면)
// 재고도 +1 복원한 뒤 상태를 cancelled로 바꾼다. 이미 취소된 건은 다시 취소 못 하게 막는다
// (조건부 UPDATE로 처리해 이중 환불을 방지한다).
export async function cancelPurchase(purchaseId: string): Promise<{ success: boolean; message?: string }> {
  const { data: purchase } = await supabaseAdmin.from('shop_purchase').select('*').eq('id', purchaseId).maybeSingle();
  if (!purchase) return { success: false, message: '존재하지 않는 구매입니다.' };
  if (purchase.status === 'cancelled') return { success: false, message: '이미 취소된 구매입니다.' };

  const { data: claimed } = await supabaseAdmin.from('shop_purchase')
    .update({ status: 'cancelled' })
    .eq('id', purchaseId).neq('status', 'cancelled')
    .select().maybeSingle();
  if (!claimed) return { success: false, message: '이미 다른 곳에서 처리된 구매입니다.' };

  const refund = await addPoints(purchase.student_id, purchase.price_paid);
  if (!refund.success) return { success: false, message: '포인트 환불에 실패했습니다.' };

  if (purchase.product_id) {
    const { data: product } = await supabaseAdmin.from('shop_product').select('stock').eq('id', purchase.product_id).maybeSingle();
    if (product && product.stock !== null) {
      await supabaseAdmin.from('shop_product').update({ stock: product.stock + 1 }).eq('id', purchase.product_id);
    }
  }
  return { success: true };
}
