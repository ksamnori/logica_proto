// src/app/actions/clinicSeatLayout.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { Seat, SeatLayout, DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, DEFAULT_SEAT_CARD_W, DEFAULT_SEAT_CARD_H, buildDefaultSeats, renumberSeats } from "@/lib/clinicSeatLayout";

// 💡 admission.ts와 동일한 패턴: 서버 액션에서만 service_role 키를 사용해 RLS 없이 관리한다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function rowToLayout(row: any): SeatLayout {
    return {
        id: row.id,
        canvasWidth: row.canvas_width,
        canvasHeight: row.canvas_height,
        seatWidth: row.seat_width ?? DEFAULT_SEAT_CARD_W,
        seatHeight: row.seat_height ?? DEFAULT_SEAT_CARD_H,
        seats: row.seats,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
    };
}

// 현재 활성 좌석 배치를 가져온다. 아직 한 번도 저장된 적이 없으면(테이블은 있으나 행이 없으면)
// 기존 6x10 그리드와 동일한 기본 배치를 그 자리에서 만들어 반환한다(저장은 하지 않음).
export async function getActiveSeatLayout(): Promise<SeatLayout> {
    const { data, error } = await supabaseAdmin
        .from('clinic_seat_layout')
        .select('*')
        .eq('is_active', true)
        .maybeSingle();

    if (error || !data) {
        return {
            id: '', canvasWidth: DEFAULT_CANVAS_W, canvasHeight: DEFAULT_CANVAS_H,
            seatWidth: DEFAULT_SEAT_CARD_W, seatHeight: DEFAULT_SEAT_CARD_H,
            seats: buildDefaultSeats(), updatedAt: new Date().toISOString(), updatedBy: null,
        };
    }
    return rowToLayout(data);
}

// 좌석 배치를 저장한다. 저장 직전 reading-order로 번호를 재계산해(가/감 후 번호가 항상 1..N으로
// 이어지도록) 일관성을 보장한다. 기존 활성 행이 있으면 그대로 갱신(단일 활성 배치 방식).
export async function saveSeatLayout(seats: Seat[], canvasWidth: number, canvasHeight: number, seatWidth: number, seatHeight: number, updatedBy: string | null): Promise<{ success: boolean; message?: string; layout?: SeatLayout }> {
    try {
        const renumbered = renumberSeats(seats, canvasHeight);

        const { data: existing } = await supabaseAdmin
            .from('clinic_seat_layout')
            .select('id')
            .eq('is_active', true)
            .maybeSingle();

        const payload = {
            canvas_width: canvasWidth,
            canvas_height: canvasHeight,
            seat_width: seatWidth,
            seat_height: seatHeight,
            seats: renumbered,
            is_active: true,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy,
        };

        const { data, error } = existing
            ? await supabaseAdmin.from('clinic_seat_layout').update(payload).eq('id', existing.id).select().single()
            : await supabaseAdmin.from('clinic_seat_layout').insert(payload).select().single();

        if (error) throw new Error(error.message);
        return { success: true, layout: rowToLayout(data) };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}
