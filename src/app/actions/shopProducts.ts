// src/app/actions/shopProducts.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { spendPoints, addPoints } from "./shopPoints";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

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

// 🌟 모든 액션에 tenantId 파라미터 추가
export async function listProducts(tenantId: string): Promise<ShopProduct[]> {
  if (!tenantId) return [];
  const { data, error } = await supabaseAdmin.from('shop_product').select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(rowToProduct);
}

export async function createProduct(tenantId: string, input: { name: string; description: string; price: number; imageDataUrl: string | null; stock: number | null }): Promise<ShopProduct | null> {
  if (!tenantId) return null;
  const { data, error } = await supabaseAdmin.from('shop_product').insert({
    name: input.name, description: input.description, price: input.price,
    image_data_url: input.imageDataUrl, stock: input.stock,
    tenant_id: tenantId 
  }).select().single();
  if (error || !data) return null;
  return rowToProduct(data);
}

export async function updateProduct(tenantId: string, id: string, input: { name: string; description: string; price: number; imageDataUrl: string | null; stock: number | null }): Promise<ShopProduct | null> {
  if (!tenantId) return null;
  const { data, error } = await supabaseAdmin.from('shop_product').update({
    name: input.name, description: input.description, price: input.price,
    image_data_url: input.imageDataUrl, stock: input.stock,
  }).eq('id', id).eq('tenant_id', tenantId).select().single(); 
  if (error || !data) return null;
  return rowToProduct(data);
}

export async function deleteProduct(tenantId: string, id: string): Promise<{ success: boolean; message?: string }> {
  if (!tenantId) return { success: false, message: "권한이 없습니다." };
  const { error } = await supabaseAdmin.from('shop_product').delete().eq('id', id).eq('tenant_id', tenantId); 
  if (error) return { success: false, message: error.message };
  return { success: true };
}

export async function listPurchases(tenantId: string): Promise<ShopPurchase[]> {
  if (!tenantId) return [];
  const { data, error } = await supabaseAdmin.from('shop_purchase').select('*')
    .eq('tenant_id', tenantId) 
    .order('purchased_at', { ascending: false });
  if (error || !data) return [];
  return data.map(rowToPurchase);
}

export async function purchaseProduct(tenantId: string, studentId: string, studentName: string, productId: string): Promise<{ success: boolean; message?: string; status?: PurchaseStatus }> {
  if (!tenantId) return { success: false, message: "지점 정보가 없습니다." };

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
    tenant_id: tenantId 
  });
  if (error) return { success: false, message: error.message };
  return { success: true, status };
}

export async function cancelPurchase(tenantId: string, purchaseId: string): Promise<{ success: boolean; message?: string }> {
  if (!tenantId) return { success: false, message: "권한이 없습니다." };

  const { data: purchase } = await supabaseAdmin.from('shop_purchase').select('*').eq('id', purchaseId).maybeSingle();
  if (!purchase) return { success: false, message: '존재하지 않는 구매입니다.' };
  if (purchase.status === 'cancelled') return { success: false, message: '이미 취소된 구매입니다.' };

  const { data: claimed } = await supabaseAdmin.from('shop_purchase')
    .update({ status: 'cancelled' })
    .eq('id', purchaseId).neq('status', 'cancelled').eq('tenant_id', tenantId) 
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