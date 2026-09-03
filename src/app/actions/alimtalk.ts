// src/app/actions/alimtalk.ts
"use server";

import { SolapiMessageService } from "solapi";

// ------------------------------------------------------------------
// 1. [기존] 출결 안내 알림톡
// ------------------------------------------------------------------
export async function sendAttendanceAlimtalk({
  parentPhone, parentName, studentName, timeString, statusLabel, templateId
}: {
  parentPhone: string; parentName: string; studentName: string; timeString: string; statusLabel: string; templateId: string;
}) {
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) {
    return { success: false, message: "솔라피 환경변수가 설정되지 않았습니다." };
  }

  const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
  const senderPhone = process.env.SOLAPI_SENDER_PHONE || process.env.SOLAPI_SENDER_NUMBER || "025558875";
  const kakaoPfId = process.env.SOLAPI_KAKAO_PFID || process.env.KAKAO_PFID || "KA01PF26082601194637290lqdNuJR1q";

  try {
    const response = await messageService.send([{
      to: String(parentPhone).replace(/[^0-9]/g, ""), 
      from: String(senderPhone).replace(/[^0-9]/g, ""),
      text: "출결 안내",
      kakaoOptions: {
        pfId: String(kakaoPfId), templateId: String(templateId),
        variables: {
          "#{이름}": String(parentName || "학부모"),
          "#{학생명}": String(studentName),
          "#{일시}": String(timeString),
          "#{출결상태}": String(statusLabel),
          "#{학원전화번호}": "02-555-8875"
        }
      }
    }]);
    return { success: true, data: response };
  } catch (error: any) {
    return { success: false, message: typeof error === 'object' ? JSON.stringify(error) : String(error) };
  }
}

// ------------------------------------------------------------------
// 2. [신규] 학습(테스트) 결과 안내 알림톡
// ------------------------------------------------------------------
export async function sendTestResultAlimtalk({
  parentPhone, parentName, studentName, testName, studentScore, classAverage, comment, templateId
}: {
  parentPhone: string; parentName: string; studentName: string; testName: string; studentScore: string; classAverage: string; comment: string; templateId: string;
}) {
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) return { success: false, message: "키 누락" };
  const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
  const senderPhone = process.env.SOLAPI_SENDER_PHONE || process.env.SOLAPI_SENDER_NUMBER || "025558875";
  const kakaoPfId = process.env.SOLAPI_KAKAO_PFID || process.env.KAKAO_PFID || "KA01PF26082601194637290lqdNuJR1q";

  try {
    const response = await messageService.send([{
      to: String(parentPhone).replace(/[^0-9]/g, ""), 
      from: String(senderPhone).replace(/[^0-9]/g, ""),
      text: "학습 결과 안내",
      kakaoOptions: {
        pfId: String(kakaoPfId), templateId: String(templateId),
        variables: {
          "#{이름}": String(parentName || "학부모"),
          "#{학생명}": String(studentName),
          "#{테스트명}": String(testName),
          "#{학생점수}": String(studentScore),
          "#{반평균}": String(classAverage),
          "#{코멘트}": String(comment)
        }
      }
    }]);
    return { success: true, data: response };
  } catch (error: any) {
    return { success: false, message: typeof error === 'object' ? JSON.stringify(error) : String(error) };
  }
}

// ------------------------------------------------------------------
// 3. [신규] 학사일정(휴원/개강) 안내 알림톡
// ------------------------------------------------------------------
export async function sendScheduleNoticeAlimtalk({
  parentPhone, parentName, scheduleName, applyDate, details, templateId
}: {
  parentPhone: string; parentName: string; scheduleName: string; applyDate: string; details: string; templateId: string;
}) {
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) return { success: false, message: "키 누락" };
  const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
  const senderPhone = process.env.SOLAPI_SENDER_PHONE || process.env.SOLAPI_SENDER_NUMBER || "025558875";
  const kakaoPfId = process.env.SOLAPI_KAKAO_PFID || process.env.KAKAO_PFID || "KA01PF26082601194637290lqdNuJR1q";

  try {
    const response = await messageService.send([{
      to: String(parentPhone).replace(/[^0-9]/g, ""), 
      from: String(senderPhone).replace(/[^0-9]/g, ""),
      text: "학사일정 안내",
      kakaoOptions: {
        pfId: String(kakaoPfId), templateId: String(templateId),
        variables: {
          "#{이름}": String(parentName || "학부모"),
          "#{일정명}": String(scheduleName),
          "#{적용일시}": String(applyDate),
          "#{상세내용}": String(details)
        }
      }
    }]);
    return { success: true, data: response };
  } catch (error: any) {
    return { success: false, message: typeof error === 'object' ? JSON.stringify(error) : String(error) };
  }
}

// ------------------------------------------------------------------
// 4. [신규] 시간표 변경 및 보강 안내 알림톡
// ------------------------------------------------------------------
export async function sendClassChangeAlimtalk({
  parentPhone, parentName, oldDate, newDate, details, templateId
}: {
  parentPhone: string; parentName: string; oldDate: string; newDate: string; details: string; templateId: string;
}) {
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) return { success: false, message: "키 누락" };
  const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
  const senderPhone = process.env.SOLAPI_SENDER_PHONE || process.env.SOLAPI_SENDER_NUMBER || "025558875";
  const kakaoPfId = process.env.SOLAPI_KAKAO_PFID || process.env.KAKAO_PFID || "KA01PF26082601194637290lqdNuJR1q";

  try {
    const response = await messageService.send([{
      to: String(parentPhone).replace(/[^0-9]/g, ""), 
      from: String(senderPhone).replace(/[^0-9]/g, ""),
      text: "보강 안내",
      kakaoOptions: {
        pfId: String(kakaoPfId), templateId: String(templateId),
        variables: {
          "#{이름}": String(parentName || "학부모"),
          "#{기존일시}": String(oldDate),
          "#{변경일시}": String(newDate),
          "#{상세내용}": String(details)
        }
      }
    }]);
    return { success: true, data: response };
  } catch (error: any) {
    return { success: false, message: typeof error === 'object' ? JSON.stringify(error) : String(error) };
  }
}

// ------------------------------------------------------------------
// 5. [신규] 자유 내용 일반 문자(SMS/LMS) 전용 발송
// ------------------------------------------------------------------
export async function sendGeneralMessage({
  parentPhone, textContent
}: {
  parentPhone: string; textContent: string;
}) {
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) return { success: false, message: "키 누락" };
  const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
  const senderPhone = process.env.SOLAPI_SENDER_PHONE || process.env.SOLAPI_SENDER_NUMBER || "025558875";

  try {
    const response = await messageService.send([{
      to: String(parentPhone).replace(/[^0-9]/g, ""), 
      from: String(senderPhone).replace(/[^0-9]/g, ""),
      text: String(textContent) // 카카오 옵션 없이 텍스트만 넣으면 일반 문자로 전송됨
    }]);
    return { success: true, data: response };
  } catch (error: any) {
    return { success: false, message: typeof error === 'object' ? JSON.stringify(error) : String(error) };
  }
}