import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // LG U+ 통신사에서 보내주는 파라미터 추출
    const sender = searchParams.get('sender');     // 발신자 정보
    const receiver = searchParams.get('receiver'); // 수신자 070번호
    const kind = searchParams.get('kind');         // 1: 전화, 2: SMS

    // 전화 수신(kind=1)이 아닌 SMS 수신(kind=2) 이벤트면 무시
    if (kind !== '1') {
      return NextResponse.json({ message: 'Ignored non-call event' }, { status: 200 });
    }

    if (!sender) {
      return NextResponse.json({ error: 'No sender provided' }, { status: 400 });
    }

    // 하이픈 제거 및 정규화
    const callerNumber = sender.replace(/-/g, '');

    // 1. parent 테이블에서 번호로 학부모 검색
    const { data: parentData } = await supabaseAdmin
      .from('parent')
      .select('parent_id, name')
      .eq('phone', callerNumber)
      .single();

    // 2. call_log 테이블에 기록 Insert (Realtime 팝업 트리거)
    const { error: insertError } = await supabaseAdmin
      .from('call_log')
      .insert({
        caller_number: callerNumber,
        receiver_number: receiver,
        parent_id: parentData ? parentData.parent_id : null,
      });

    if (insertError) throw insertError;

    // LG U+ 서버에 정상 처리되었음을 알림
    return NextResponse.json({ success: true, message: 'Call logged' }, { status: 200 });

  } catch (error) {
    console.error('LGU+ Webhook Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}