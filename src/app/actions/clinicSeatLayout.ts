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

export async function getActiveSeatLayout(): Promise<SeatLayout> {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("인증 정보(쿠키)가 없거나 지점이 할당되지 않았습니다. 다시 로그인해주세요.");

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
      updatedAt: data.updated_at,       // 🌟 [추가] 타입스크립트가 찾던 속성 1
      updatedBy: data.updated_by || ""  // 🌟 [추가] 타입스크립트가 찾던 속성 2
    };
  }

  return {
    id: "",
    canvasWidth: 1600,
    canvasHeight: 900,
    seatWidth: 140,
    seatHeight: 80,
    seats: [],
    updatedAt: new Date().toISOString(), // 🌟 [추가] 빈 데이터일 때도 시간 부여
    updatedBy: ""                        // 🌟 [추가] 빈 데이터일 때도 작성자 빈칸 부여
  };
}

export async function saveSeatLayout(
  seats: Seat[],
  canvasWidth: number,
  canvasHeight: number,
  seatWidth: number,
  seatHeight: number,
  editorClientId: string
) {
  const tenantId = await getTenantId();
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
        updatedAt: data.updated_at,      // 🌟 [추가] 리턴할 때 누락 방지
        updatedBy: data.updated_by || "" // 🌟 [추가] 리턴할 때 누락 방지
      }
    };
  } catch (e: any) {
    console.error("좌석 저장 에러:", e);
    return { success: false, message: e.message };
  }
}