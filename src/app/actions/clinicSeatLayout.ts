// src/app/actions/clinicSeatLayout.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SeatLayout, Seat } from "@/lib/clinicSeatLayout";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

async function getTenantId() {
  const cookieStore = await cookies();
  return cookieStore.get("logica_tenant_id")?.value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const emptyLayout = (): SeatLayout => ({
  id: "", canvasWidth: 1600, canvasHeight: 900, seatWidth: 140, seatHeight: 80,
  seats: [], updatedAt: new Date().toISOString(), updatedBy: ""
});

export async function getActiveSeatLayout(overrideTenantId?: string, explicitTenantId?: string): Promise<SeatLayout> {
  // 💡 쿠키는 실제 로그인 세션에서 나온 값이라 신뢰할 수 있다. overrideTenantId(클라이언트
  // localStorage)는 쿠키가 아예 없는 로그인 없는 접근(조교 URL 직접 접근)일 때만 쓰는
  // 폴백이다 — 반대로 하면 localStorage에 남은 예전 지점 값이 방금 로그인한 세션의
  // 지점을 덮어써버린다. explicitTenantId는 그 둘과 다른 경우로, 최고관리자가 좌석
  // 배치도 편집기에서 자기 소속과 다른 지점을 골라서 보는 경우에만 쓰이며, 명시적으로
  // 골랐다는 뜻이므로 쿠키보다도 우선한다.
  const tenantId = explicitTenantId || await getTenantId() || overrideTenantId;
  if (!tenantId) throw new Error("인증 정보(쿠키)가 없거나 지점이 할당되지 않았습니다. 다시 로그인해주세요.");

  // 💡 tenant_id 컬럼은 uuid 타입이라, 'hq'처럼 다른 화면에서 "전체 조회"용으로 쓰는
  // 문자열 fallback을 그대로 넘기면 Postgres가 타입 오류를 던진다. 좌석 배치는 애초에
  // 지점별로만 존재하므로, uuid가 아니면 조회 자체를 생략하고 빈 배치로 처리한다.
  if (!UUID_RE.test(tenantId)) return emptyLayout();

  const { data, error } = await supabaseAdmin
    .from('clinic_seat_layout')
    .select('*')
    .eq('is_active', true)
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("좌석 배치 로드 에러:", error);
    throw new Error("좌석 배치를 불러오는 중 오류가 발생했습니다.");
  }

  if (data) {
    return {
      id: data.id,
      canvasWidth: data.canvas_width,
      canvasHeight: data.canvas_height,
      seatWidth: data.seat_width,
      seatHeight: data.seat_height,
      seats: data.seats as Seat[],
      updatedAt: data.updated_at,       
      updatedBy: data.updated_by || ""  
    };
  }

  return emptyLayout();
}

export async function saveSeatLayout(
  seats: Seat[],
  canvasWidth: number,
  canvasHeight: number,
  seatWidth: number,
  seatHeight: number,
  editorClientId: string,
  explicitTenantId?: string
) {
  const tenantId = explicitTenantId || await getTenantId();
  if (!tenantId) return { success: false, message: "지점 인증 정보가 없습니다. 다시 로그인해주세요." };

  try {
    await supabaseAdmin
      .from('clinic_seat_layout')
      .update({ is_active: false })
      .eq('is_active', true)
      .eq('tenant_id', tenantId);

    const { data, error } = await supabaseAdmin
      .from('clinic_seat_layout')
      .insert({
        canvas_width: canvasWidth,
        canvas_height: canvasHeight,
        seat_width: seatWidth,
        seat_height: seatHeight,
        seats: seats,
        is_active: true,
        updated_by: editorClientId,
        tenant_id: tenantId 
      })
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      layout: {
        id: data.id,
        canvasWidth: data.canvas_width,
        canvasHeight: data.canvas_height,
        seatWidth: data.seat_width,
        seatHeight: data.seat_height,
        seats: data.seats as Seat[],
        updatedAt: data.updated_at,      
        updatedBy: data.updated_by || "" 
      }
    };
  } catch (e: any) {
    console.error("좌석 저장 에러:", e);
    return { success: false, message: e.message };
  }
}