import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // 통신사에서 넘어온 번호 파싱 (하이픈 제거)
    const callerNumber = body.caller?.replace(/-/g, '');

    if (!callerNumber) {
      return NextResponse.json({ error: 'No caller number provided' }, { status: 400 });
    }

    // 1. parent 테이블에서 번호로 학부모 검색
    const { data: parentData } = await supabaseAdmin
      .from('parent')
      .select('parent_id, name')
      .eq('phone', callerNumber)
      .single();

    // 2. call_log 테이블에 기록 Insert
    const { error: insertError } = await supabaseAdmin
      .from('call_log')
      .insert({
        caller_number: callerNumber,
        receiver_number: body.called,
        parent_id: parentData ? parentData.parent_id : null,
      });

    if (insertError) throw insertError;

    return NextResponse.json({ success: true, message: 'Call logged successfully' }, { status: 200 });

  } catch (error) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}