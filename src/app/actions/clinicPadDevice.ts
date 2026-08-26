// src/app/actions/clinicPadDevice.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

async function getTenantId() {
    const cookieStore = await cookies();
    return cookieStore.get("logica_tenant_id")?.value;
}

// 이 기기가 어느 좌석에 고정 등록돼 있는지 조회한다. 클라이언트가 anon key로 clinic_pad_device를
// 직접 조회하지 못하게(RLS에 정책을 안 둠) 서버 액션(service role)으로만 접근한다.
// 등록 안 된 기기면 null을 반환한다.
export async function getSeatForDevice(deviceId: string): Promise<string | null> {
    if (!deviceId) return null;

    const { data, error } = await supabaseAdmin
        .from('clinic_pad_device')
        .select('seat_number')
        .eq('device_id', deviceId)
        .maybeSingle();

    if (error || !data) return null;
    return data.seat_number;
}

// 신규 기기 등록 화면(학생 로그인의 미등록 패드 패널)에서 지점을 고를 수 있게 목록을 돌려준다.
// academy_tenant는 RLS가 anon 세션(비로그인 상태)의 조회를 막아두므로, service role로만 접근한다.
export async function listActiveTenants(): Promise<{ tenant_id: string; name: string }[]> {
    const { data, error } = await supabaseAdmin
        .from('academy_tenant')
        .select('tenant_id, name, tenant_type')
        .eq('status', 'ACTIVE');

    if (error || !data) return [];
    return data
        .filter((t: any) => t.tenant_type?.toUpperCase() !== 'HQ' && !String(t.name || '').includes('본사'))
        .map((t: any) => ({ tenant_id: t.tenant_id, name: t.name }));
}

// 관리자(등록 화면)가 우리 지점에 등록된 패드 전체를 본다. { seat_number: device_id } 맵으로 돌려준다.
export async function listPadDevicesByTenant(): Promise<Record<string, string>> {
    const tenantId = await getTenantId();
    if (!tenantId) return {};

    const { data, error } = await supabaseAdmin
        .from('clinic_pad_device')
        .select('device_id, seat_number')
        .eq('tenant_id', tenantId);

    if (error || !data) return {};
    const map: Record<string, string> = {};
    data.forEach((row: any) => { map[row.seat_number] = row.device_id; });
    return map;
}

// 좌석 하나에 기기ID를 등록/재등록한다. seat_number는 (tenant_id, seat_number) 유니크 제약이 걸려
// 있어서, 이 좌석에 이미 다른 기기ID가 물려있으면 먼저 떼어내야 upsert가 그 제약에 걸리지 않는다
// (device_id는 PK라 그쪽 충돌은 upsert가 알아서 처리해준다).
// tenantIdOverride: 학생 로그인 화면(미등록 패드 즉석 등록)처럼 강사 로그인 쿠키가 없는 곳에서
// 호출할 때 tenant_id를 직접 넘기기 위한 파라미터. 넘기지 않으면 기존처럼 쿠키에서 읽는다.
export async function assignPadDevice(deviceId: string, seatNumber: string, tenantIdOverride?: string): Promise<{ success: boolean; message?: string }> {
    const tenantId = tenantIdOverride || await getTenantId();
    if (!tenantId) return { success: false, message: "지점 인증 정보가 없습니다. 다시 로그인해주세요." };
    if (!deviceId || !seatNumber) return { success: false, message: "기기ID와 좌석번호를 모두 입력해주세요." };

    await supabaseAdmin
        .from('clinic_pad_device')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('seat_number', seatNumber)
        .neq('device_id', deviceId);

    const { error } = await supabaseAdmin
        .from('clinic_pad_device')
        .upsert({ device_id: deviceId, tenant_id: tenantId, seat_number: seatNumber }, { onConflict: 'device_id' });

    if (error) return { success: false, message: error.message };
    return { success: true };
}

// 좌석에서 기기 등록을 해제한다(예: 그 좌석의 패드를 교체하기 전).
export async function unassignPadDevice(seatNumber: string): Promise<{ success: boolean; message?: string }> {
    const tenantId = await getTenantId();
    if (!tenantId) return { success: false, message: "지점 인증 정보가 없습니다. 다시 로그인해주세요." };

    const { error } = await supabaseAdmin
        .from('clinic_pad_device')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('seat_number', seatNumber);

    if (error) return { success: false, message: error.message };
    return { success: true };
}
