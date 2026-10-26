// src/app/actions/notification.ts
"use server";

import { SolapiMessageService } from "solapi";
import { createClient } from "@supabase/supabase-js";

// 솔라피 SDK 초기화
const messageService = new SolapiMessageService(
  process.env.SOLAPI_API_KEY || "",
  process.env.SOLAPI_API_SECRET || ""
);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

interface SendMessageParams {
  receiverPhone: string;
  messageContent: string;
  isAlimtalk?: boolean;
  templateId?: string; // 카카오 알림톡 템플릿 ID
}

export async function sendBulkMessages(messages: SendMessageParams[]) {
  try {
    const senderNumber = process.env.SOLAPI_SENDER_NUMBER || "";
    const pfId = process.env.KAKAO_PFID || "";

    // 1. 솔라피 발송 요청 데이터 구성
    const solapiMessages = messages.map((msg) => {
      const payload: any = {
        to: msg.receiverPhone.replace(/[^0-9]/g, ""), // 하이픈 제거
        from: senderNumber,
        text: msg.messageContent,
      };

      // 알림톡 템플릿이 지정된 경우 카카오톡 옵션 추가
      if (msg.isAlimtalk && msg.templateId) {
        payload.kakaoOptions = {
          pfId: pfId,
          templateId: msg.templateId,
          // 알림톡 발송 실패 시 자동으로 일반 문자로 대체 발송 (Fallback)
          disableSms: false, 
        };
      }

      return payload;
    });

    // 2. 솔라피 API로 다량 발송 요청 (한 번에 최대 10,000건 가능)
    const result = await messageService.send(solapiMessages);

    // 3. 발송 완료 후 Supabase `notification_log` 테이블에 기록 저장
    const logInserts = messages.map((msg) => ({
      receiver_phone: msg.receiverPhone,
      noti_type: msg.isAlimtalk ? "알림톡" : "문자(LMS)",
      message_content: msg.messageContent,
      status: "성공", // 솔라피 응답에 따라 상세 분기 가능
      sent_at: new Date().toISOString(),
    }));

    const { error: dbError } = await supabaseAdmin
      .from("notification_log")
      .insert(logInserts);

    if (dbError) {
      console.error("DB 로그 기록 실패:", dbError);
      // 문자는 나갔지만 DB 기록만 실패한 경우
    }

    return { success: true, count: messages.length, result };
  } catch (error: any) {
    console.error("메시지 발송 에러:", error);
    return { success: false, message: error.message };
  }
}