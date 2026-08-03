// src/app/actions/shopPoints.ts
"use server";

import { createClient } from "@supabase/supabase-js";

// 💡 clinicSeatLayout.ts/admission.ts와 동일한 패턴: 서버 액션에서만 service_role 키를 써서
// RLS 없이 관리한다. 학생 포인트는 클라이언트가 직접 읽거나 쓸 수 없어야 하므로(위조 방지),
// 잔액 조회/차감/적립은 반드시 이 파일을 거친다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const DEFAULT_POINTS = 1000;

const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

type PointRow = { student_id: string; balance: number; last_accrued_at: string | null };

async function getOrCreatePointRow(studentId: string): Promise<PointRow> {
  const { data } = await supabaseAdmin.from('student_points').select('*').eq('student_id', studentId).maybeSingle();
  if (data) return data;

  const { data: created, error } = await supabaseAdmin.from('student_points')
    .insert({ student_id: studentId, balance: DEFAULT_POINTS })
    .select().single();
  if (!error) return created;

  // 💡 최초 접속 순간 두 요청이 동시에 행을 만들려 하면 primary key 충돌이 날 수 있다 —
  // 그 경우 이미 다른 요청이 만들어둔 행을 다시 읽어온다.
  const { data: existing } = await supabaseAdmin.from('student_points').select('*').eq('student_id', studentId).maybeSingle();
  if (existing) return existing;
  throw new Error(error.message);
}

export async function getPointBalance(studentId: string): Promise<number> {
  if (!studentId) return 0;
  const row = await getOrCreatePointRow(studentId);
  return row.balance;
}

// 포인트가 충분하면 차감. 부족하면 아무것도 바꾸지 않고 success:false를 반환한다.
export async function spendPoints(studentId: string, amount: number): Promise<{ success: boolean; balance: number; message?: string }> {
  if (!studentId) return { success: false, balance: 0, message: '학생 정보가 없습니다.' };
  const row = await getOrCreatePointRow(studentId);
  if (row.balance < amount) return { success: false, balance: row.balance, message: '포인트가 부족합니다.' };

  const newBalance = row.balance - amount;
  const { error } = await supabaseAdmin.from('student_points')
    .update({ balance: newBalance })
    .eq('student_id', studentId);
  if (error) return { success: false, balance: row.balance, message: error.message };
  return { success: true, balance: newBalance };
}

// 구매 취소/환불 등으로 포인트를 되돌려줄 때 쓴다.
export async function addPoints(studentId: string, amount: number): Promise<{ success: boolean; balance: number; message?: string }> {
  if (!studentId) return { success: false, balance: 0, message: '학생 정보가 없습니다.' };
  const row = await getOrCreatePointRow(studentId);
  const newBalance = row.balance + amount;
  const { error } = await supabaseAdmin.from('student_points').update({ balance: newBalance }).eq('student_id', studentId);
  if (error) return { success: false, balance: row.balance, message: error.message };
  return { success: true, balance: newBalance };
}

// 클리닉 이용 1분당 1포인트를 적립한다. 클라이언트(clinic/viewer)가 짧은 주기로 이 함수를
// 계속 호출해도, 실제 지급량은 항상 "실제로 흐른 시간"만큼만 나온다 — last_accrued_at을
// 서버 쪽에만 저장해두고, 매 호출마다 (지금 - last_accrued_at)을 분 단위로 잘라서 지급한
// 뒤 그만큼만 커서를 전진시키기 때문에 여러 번 연타해도 더 받을 수 없다.
//
// 💡 오늘자 "종료되지 않은" 클리닉 세션이 있을 때만 지급한다 — 세션이 없으면(포탈에 있거나
// 아예 클리닉 밖이면) 아무 것도 하지 않는다. 또한 기준 시각(baseline)을 세션 시작 시각보다
// 앞설 수 없게 고정해서, 며칠 쉬었다가 다시 접속해도 그 공백 기간이 통째로 포인트로
// 계산되는 일이 없다 — 항상 "이번 세션 안에서 흐른 시간"만 계산된다.
export async function awardClinicMinutePoints(studentId: string): Promise<{ balance: number; awarded: number }> {
  if (!studentId) return { balance: 0, awarded: 0 };

  const { data: session } = await supabaseAdmin
    .from('clinic_session_state')
    .select('started_at')
    .eq('student_id', studentId)
    .eq('session_date', getKSTDateString())
    .is('ended_at', null)
    .order('session_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = await getOrCreatePointRow(studentId);
  if (!session) return { balance: row.balance, awarded: 0 };

  const sessionStart = new Date(session.started_at).getTime();
  const lastAccrued = row.last_accrued_at ? new Date(row.last_accrued_at).getTime() : sessionStart;
  const baseline = Math.max(lastAccrued, sessionStart);
  const minutes = Math.floor((Date.now() - baseline) / 60000);
  if (minutes <= 0) return { balance: row.balance, awarded: 0 };

  const newBalance = row.balance + minutes;
  const newLastAccrued = new Date(baseline + minutes * 60000).toISOString();
  const { error } = await supabaseAdmin.from('student_points')
    .update({ balance: newBalance, last_accrued_at: newLastAccrued })
    .eq('student_id', studentId);
  if (error) return { balance: row.balance, awarded: 0 };
  return { balance: newBalance, awarded: minutes };
}
