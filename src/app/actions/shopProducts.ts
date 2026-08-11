// src/app/actions/shopProducts.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { spendPoints, addPoints } from "./shopPoints";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SECRET_KEY = new TextEncoder().encode(process.env.SESSION_SECRET_KEY || "fallback-secret-key");

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// 🌟 [추가] 쿠키(JWT)에서 안전하게 내 지점 꼬리표 꺼내기
async function getSecureTenantId() {
  const cookieStore = await cookies();
  const token = cookieStore.get("logica_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET_KEY);
    return payload.tenant_id as string;
  } catch { return null; }
}

export type PurchaseStatus = 'completed' | 'cancelled';

export type ShopProduct = {
  id: string; name: string; description: string; price: number;
  imageDataUrl: string | null; stock: number | null; createdAt: number;
};

export type ShopPurchase = {
  id: string; studentId: string; studentName: string; productId: string | null;
  productName: string; pricePaid: number; status: PurchaseStatus;
  purchasedAt: number; fulfilledAt: number | null; fulfilledBy: string | null;
};

function rowToProduct(row: any): ShopProduct {
  return {
    id: row.id, name: row.name, description: row.description || '', price: row.price,
    imageDataUrl: row.image_data_url, stock: row.stock, createdAt: new Date(row.created_at).getTime(),
  };
}

function rowToPurchase(row: any): ShopPurchase {
  return {
    id: row.id, studentId: row.student_id, studentName: row.student_name,
    productId: row.product_id, productName: row.product_name, pricePaid: row.price_paid, status: row.status,
    purchasedAt: new Date(row.purchased_at).getTime(), fulfilledAt: row.fulfilled_at ? new Date(row.fulfilled_at).getTime() : null,
    fulfilledBy: row.fulfilled_by,
  };
}

export async function listProducts(): Promise<ShopProduct[]> {
  const tenantId = await getSecureTenantId();
  if (!tenantId) return [];

  const { data, error } = await supabaseAdmin.from('shop_product').select('*')
    .eq('tenant_id', tenantId) // 🌟 내 지점 물품만 로드
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(rowToProduct);
}

export async function createProduct(input: { name: string; description: string; price: number; imageDataUrl: string | null; stock: number | null }): Promise<ShopProduct | null> {
  const tenantId = await getSecureTenantId();
  if (!tenantId) return null;

  const { data, error } = await supabaseAdmin.from('shop_product').insert({
    name: input.name, description: input.description, price: input.price,
    image_data_url: input.imageDataUrl, stock: input.stock,
    tenant_id: tenantId // 🌟 생성 시 꼬리표 부착
  }).select().single();
  if (error || !data) return null;
  return rowToProduct(data);
}

export async function updateProduct(id: string, input: { name: string; description: string; price: number; imageDataUrl: string | null; stock: number | null }): Promise<ShopProduct | null> {
  const tenantId = await getSecureTenantId();
  
  const { data, error } = await supabaseAdmin.from('shop_product').update({
    name: input.name, description: input.description, price: input.price,
    image_data_url: input.imageDataUrl, stock: input.stock,
  }).eq('id', id).eq('tenant_id', tenantId).select().single(); // 🌟 내 지점 물품만 수정 허용
  if (error || !data) return null;
  return rowToProduct(data);
}

export async function deleteProduct(id: string): Promise<{ success: boolean; message?: string }> {
  const tenantId = await getSecureTenantId();
  const { error } = await supabaseAdmin.from('shop_product').delete().eq('id', id).eq('tenant_id', tenantId); // 🌟 내 지점 것만 삭제 허용
  if (error) return { success: false, message: error.message };
  return { success: true };
}

export async function listPurchases(): Promise<ShopPurchase[]> {
  const tenantId = await getSecureTenantId();
  if (!tenantId) return [];

  const { data, error } = await supabaseAdmin.from('shop_purchase').select('*')
    .eq('tenant_id', tenantId) // 🌟 내 지점 학생 결제 내역만 로드
    .order('purchased_at', { ascending: false });
  if (error || !data) return [];
  return data.map(rowToPurchase);
}

export async function purchaseProduct(studentId: string, studentName: string, productId: string): Promise<{ success: boolean; message?: string; status?: PurchaseStatus }> {
  const tenantId = await getSecureTenantId();

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

  const status: PurchaseStatus = 'completed';
  const { error } = await supabaseAdmin.from('shop_purchase').insert({
    student_id: studentId, student_name: studentName, product_id: productId,
    product_name: product.name, price_paid: product.price, status,
    tenant_id: tenantId // 🌟 결제 기록에 지점 꼬리표 부착
  });
  if (error) return { success: false, message: error.message };
  return { success: true, status };
}

export async function cancelPurchase(purchaseId: string): Promise<{ success: boolean; message?: string }> {
  const tenantId = await getSecureTenantId();

  const { data: purchase } = await supabaseAdmin.from('shop_purchase').select('*').eq('id', purchaseId).maybeSingle();
  if (!purchase) return { success: false, message: '존재하지 않는 구매입니다.' };
  if (purchase.status === 'cancelled') return { success: false, message: '이미 취소된 구매입니다.' };

  const { data: claimed } = await supabaseAdmin.from('shop_purchase')
    .update({ status: 'cancelled' })
    .eq('id', purchaseId).neq('status', 'cancelled').eq('tenant_id', tenantId) // 🌟 권한 검증
    .select().maybeSingle();
  if (!claimed) return { success: false, message: '이미 다른 곳에서 처리된 구매이거나 권한이 없습니다.' };

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