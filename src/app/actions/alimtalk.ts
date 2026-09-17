// src/app/actions/alimtalk.ts
"use server";

import { SolapiMessageService } from "solapi";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const ATTENDANCE_TEMPLATE_ID = "KA01TP260826014520504X1Fplf8R0FH";

// 솔라피 응답을 해석해 실제 성공 여부를 판정합니다.
// 주의: 여기서의 "성공"은 접수 성공이며, 최종 도착 여부는 아닙니다.
function interpretSolapiResult(response: any): {
  success: boolean; pending: boolean; reason: string;
} {
  const failedList = response?.failedMessageList || [];
  if (failedList.length > 0) {
    const f = failedList[0];
    return {
      success: false, pending: false,
      reason: `${f?.statusCode || ""} ${f?.statusMessage || "발송 실패"}`.trim(),
    };
  }

  const count = response?.groupInfo?.count;
  if (count) {
    if ((count.registeredFailed ?? 0) > 0) {
      return { success: false, pending: false, reason: `접수 실패 ${count.registeredFailed}건` };
    }
    if ((count.sentFailed ?? 0) > 0) {
      return { success: false, pending: false, reason: `전송 실패 ${count.sentFailed}건` };
    }
    if ((count.sentPending ?? 0) > 0) {
      return { success: true, pending: true, reason: "접수 완료 (전송 대기중)" };
    }
    if ((count.registeredSuccess ?? 0) > 0 || (count.sentSuccess ?? 0) > 0) {
      return { success: true, pending: false, reason: "" };
    }
  }

  // 판단 근거가 없으면 보수적으로 '대기'로 봅니다.
  return { success: true, pending: true, reason: "결과 확인 불가" };
}

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
    const r = interpretSolapiResult(response);
    return { success: r.success, pending: r.pending, message: r.reason, data: response };
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
    const r = interpretSolapiResult(response);
    return { success: r.success, pending: r.pending, message: r.reason, data: response };
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
    const r = interpretSolapiResult(response);
    return { success: r.success, pending: r.pending, message: r.reason, data: response };
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
    const r = interpretSolapiResult(response);
    return { success: r.success, pending: r.pending, message: r.reason, data: response };
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
    const r = interpretSolapiResult(response);
    return { success: r.success, pending: r.pending, message: r.reason, data: response };
  } catch (error: any) {
    return { success: false, message: typeof error === 'object' ? JSON.stringify(error) : String(error) };
  }
}

// ------------------------------------------------------------------
// 6. [신규] 출결 알림톡 대기열 적재 (키오스크 전용)
//    - service_role로 동작하므로 alimtalk_queue에 RLS를 켜도 통과합니다.
//    - tenant_id / 학생명 / 학부모 연락처를 클라이언트에서 받지 않고
//      서버가 DB에서 직접 읽습니다. (키오스크는 비로그인 단말이라 중요)
// ------------------------------------------------------------------
export async function queueAttendanceAlimtalk({
  studentId, statusLabel, timeString
}: {
  studentId: string; statusLabel: string; timeString: string;
}) {
  if (!studentId) return { success: false, queued: 0, message: "studentId가 없습니다." };

  try {
    const { data: student, error: sErr } = await supabaseAdmin
      .from("student")
      .select("student_id, name, tenant_id, parent(name, phone, relationship, name_2, phone_2, relationship_2)")
      .eq("student_id", studentId)
      .maybeSingle();

    if (sErr) throw sErr;
    if (!student) return { success: false, queued: 0, message: "학생을 찾을 수 없습니다." };

    const parentObj: any = Array.isArray(student.parent) ? student.parent[0] : student.parent;
    if (!parentObj) return { success: true, queued: 0, message: "등록된 학부모 정보가 없습니다." };

    const rows: any[] = [];
    const pushTarget = (phone?: string | null, name?: string | null, rel?: string | null) => {
      if (!phone || String(phone).includes("unassigned")) return;
      const relStr = rel || "학부모";
      const finalName = name && name !== "미입력" ? `${name}(${relStr})` : `학부모(${relStr})`;
      rows.push({
        tenant_id: student.tenant_id,          // 🌟 DB에서 읽은 값 — 단말이 조작 불가
        student_id: student.student_id,
        student_name: student.name,
        parent_name: finalName,
        parent_phone: phone,
        template_id: ATTENDANCE_TEMPLATE_ID,
        status_label: statusLabel,
        time_string: timeString,
        preview_title: `[출결] ${statusLabel}`,
        preview_desc: `${student.name} ${finalName}`,
        status: "대기",
      });
    };

    pushTarget(parentObj.phone, parentObj.name, parentObj.relationship);
    pushTarget(parentObj.phone_2, parentObj.name_2, parentObj.relationship_2);

    if (rows.length === 0) {
      return { success: true, queued: 0, message: "발송 가능한 연락처가 없습니다." };
    }

    // 기존 등/하원 대기 건 제거 후 갱신 (기존 로직 유지)
    const { error: dErr } = await supabaseAdmin
      .from("alimtalk_queue")
      .delete()
      .eq("student_id", student.student_id)
      .eq("template_id", ATTENDANCE_TEMPLATE_ID)
      .eq("status", "대기");
    if (dErr) throw dErr;

    const { error: iErr } = await supabaseAdmin.from("alimtalk_queue").insert(rows);
    if (iErr) throw iErr;

    return { success: true, queued: rows.length };
  } catch (error: any) {
    console.error("[queueAttendanceAlimtalk]", error);
    return { success: false, queued: 0, message: error?.message || String(error) };
  }
}

// ------------------------------------------------------------------
// 7. 출결 상태 변경 알림 대기열 적재 (운영 대시보드용)
// ------------------------------------------------------------------
function buildKstTimeString(actionTimeIso: string) {
  const d = actionTimeIso ? new Date(actionTimeIso) : new Date();
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const mo = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const da = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mi = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}.${mo}.${da} ${hh}:${mi}`;
}

export async function queueAttendanceNotice({
  studentId, statusLabel, actionTime
}: {
  studentId: string; statusLabel: string; actionTime: string;
}) {
  if (!studentId || !statusLabel) {
    return { success: false, queued: 0, message: "필수 값 누락" };
  }

  try {
    const { data: stu, error: sErr } = await supabaseAdmin
      .from("student")
      .select("student_id, name, tenant_id, parent(name, phone, relationship, name_2, phone_2, relationship_2)")
      .eq("student_id", studentId)
      .maybeSingle();

    if (sErr) throw sErr;
    if (!stu) return { success: false, queued: 0, message: "학생을 찾을 수 없습니다." };

    const parentObj: any = Array.isArray(stu.parent) ? stu.parent[0] : stu.parent;
    if (!parentObj) return { success: true, queued: 0, message: "학부모 정보 없음" };

    const displayTime = buildKstTimeString(actionTime);
    const rows: any[] = [];

    const pushTarget = (phone?: string | null, name?: string | null, rel?: string | null) => {
      if (!phone || String(phone).includes("unassigned")) return;
      const relStr = rel || "학부모";
      const finalName = name && name !== "미입력" ? `${name}(${relStr})` : `학부모(${relStr})`;
      rows.push({
        tenant_id: stu.tenant_id,
        student_id: stu.student_id,
        student_name: stu.name,
        parent_name: finalName,
        parent_phone: phone,
        template_id: ATTENDANCE_TEMPLATE_ID,
        status_label: statusLabel,
        time_string: displayTime,
        preview_title: `[출결] ${statusLabel}`,
        preview_desc: `${stu.name} ${finalName}`,
        status: "대기",
      });
    };

    pushTarget(parentObj.phone, parentObj.name, parentObj.relationship);
    pushTarget(parentObj.phone_2, parentObj.name_2, parentObj.relationship_2);

    if (rows.length === 0) return { success: true, queued: 0, message: "발송 대상 없음" };

    await supabaseAdmin
      .from("alimtalk_queue")
      .delete()
      .eq("student_id", stu.student_id)
      .eq("template_id", ATTENDANCE_TEMPLATE_ID)
      .eq("status", "대기");

    const { error: iErr } = await supabaseAdmin.from("alimtalk_queue").insert(rows);
    if (iErr) throw iErr;

    return { success: true, queued: rows.length };
  } catch (error: any) {
    console.error("[queueAttendanceNotice]", error);
    return { success: false, queued: 0, message: error?.message || String(error) };
  }
}

export async function queueAttendanceNoticeBulk(
  items: { studentId: string; statusLabel: string; actionTime: string }[]
) {
  if (!items?.length) return { success: true, queued: 0, failed: 0 };

  let queued = 0, failed = 0;
  for (const it of items) {
    const r = await queueAttendanceNotice(it);
    if (r.success) queued += r.queued; else failed++;
  }
  return { success: failed === 0, queued, failed };
}

// ------------------------------------------------------------------
// 8. 대기열 일괄 발송 (운영 대시보드 "발송" 버튼)
//    - 큐 조회 / 상태 변경 / 실제 발송 / 로그 기록 / 큐 삭제를 서버에서 처리
//    - 건별로 처리하므로 중간에 실패해도 나머지가 계속 진행됩니다.
// ------------------------------------------------------------------
export async function sendQueuedMessages(tenantId: string) {
  if (!tenantId) return { success: false, sent: 0, failed: 0, message: "tenantId 누락" };

  try {
    const { data: toSend, error: qErr } = await supabaseAdmin
      .from("alimtalk_queue")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("status", "대기");

    if (qErr) throw qErr;
    if (!toSend || toSend.length === 0) {
      return { success: true, sent: 0, failed: 0, message: "발송할 메시지가 없습니다." };
    }

    let sent = 0, failed = 0;

    for (const msg of toSend) {
      // 이 건만 '발송중'으로 표시 (전체 일괄 변경하지 않음)
      await supabaseAdmin
        .from("alimtalk_queue")
        .update({ status: "발송중" })
        .eq("queue_id", msg.queue_id);

      const payload = {
        id: msg.queue_id, templateId: msg.template_id, parentPhone: msg.parent_phone,
        parentName: msg.parent_name, studentName: msg.student_name,
        statusLabel: msg.status_label, timeString: msg.time_string,
        scheduleName: msg.schedule_name, applyDate: msg.apply_date,
        oldDate: msg.old_date, newDate: msg.new_date, details: msg.details,
        previewTitle: msg.preview_title, previewDesc: msg.preview_desc,
      };

      let res: any;
      try {
        if (msg.template_id === "KA01TP260826014520504X1Fplf8R0FH") {
          res = await sendAttendanceAlimtalk(payload as any);
        } else if (msg.template_id === "KA01TP260826015150733a1AW4dFE1qM") {
          res = await sendScheduleNoticeAlimtalk(payload as any);
        } else if (msg.template_id === "KA01TP260831032803585c1Me7WbxjUe") {
          res = await sendClassChangeAlimtalk(payload as any);
        } else if (msg.template_id === "GENERAL_SMS") {
          const textContent = `[로지카 학원 대치본원]\n\n${msg.parent_name} 학부모님,\n\n${msg.details}\n\n문의: 02-555-8875`;
          res = await sendGeneralMessage({ parentPhone: msg.parent_phone, textContent });
        } else {
          res = { success: false, message: `알 수 없는 템플릿: ${msg.template_id}` };
        }
      } catch (e: any) {
        res = { success: false, message: e?.message || String(e) };
      }

            const logMessage =
        msg.template_id === "GENERAL_SMS" ? `${msg.preview_title} 발송` : msg.preview_title;

      // 🌟 성공 / 대기 / 실패 3단계로 기록
      const logStatus = !res?.success ? "실패" : (res?.pending ? "대기" : "성공");

      await supabaseAdmin.from("notification_log").insert({
        tenant_id: tenantId,
        target_name: `${msg.student_name} / ${msg.parent_name}`,
        target_phone: msg.parent_phone,
        message_content: res?.message ? `${logMessage} — ${res.message}` : logMessage,
        status: logStatus,
      });

      if (res?.success) {
        await supabaseAdmin.from("alimtalk_queue").delete().eq("queue_id", msg.queue_id);
        sent++;
      } else {
        await supabaseAdmin
          .from("alimtalk_queue")
          .update({ status: "대기" })
          .eq("queue_id", msg.queue_id);
        failed++;
        console.error("[sendQueuedMessages] 발송 실패", msg.queue_id, res?.message);
      }
    }

    return { success: true, sent, failed };
  } catch (error: any) {
    console.error("[sendQueuedMessages]", error);
    return { success: false, sent: 0, failed: 0, message: error?.message || String(error) };
  }
}

// ------------------------------------------------------------------
// 9. 대기열 삭제 (전체 비우기 / 개별 ×)
// ------------------------------------------------------------------
export async function clearQueue(tenantId: string) {
  if (!tenantId) return { success: false, message: "tenantId 누락" };
  try {
    const { error } = await supabaseAdmin
      .from("alimtalk_queue")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("status", "대기");
    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error("[clearQueue]", error);
    return { success: false, message: error?.message || String(error) };
  }
}

export async function deleteQueueItem(queueId: string) {
  if (!queueId) return { success: false, message: "queueId 누락" };
  try {
    const { error } = await supabaseAdmin
      .from("alimtalk_queue")
      .delete()
      .eq("queue_id", queueId);
    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error("[deleteQueueItem]", error);
    return { success: false, message: error?.message || String(error) };
  }
}

// ------------------------------------------------------------------
// 10. 대기열에 메시지 추가 (일괄 폼 / 출결 패널 공용)
//     replaceAttendance: true면 같은 학생의 기존 출결 메시지를 먼저 지웁니다.
// ------------------------------------------------------------------
export async function addToQueue(
  rows: any[],
  options?: { replaceAttendanceFor?: string[] }
) {
  if (!rows?.length) return { success: true, inserted: 0 };

  try {
    const tenantId = rows[0]?.tenant_id;
    const replaceIds = options?.replaceAttendanceFor || [];

    if (tenantId && replaceIds.length > 0) {
      const { error: dErr } = await supabaseAdmin
        .from("alimtalk_queue")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("template_id", ATTENDANCE_TEMPLATE_ID)
        .in("student_id", replaceIds);
      if (dErr) throw dErr;
    }

    const { error } = await supabaseAdmin.from("alimtalk_queue").insert(rows);
    if (error) throw error;

    return { success: true, inserted: rows.length };
  } catch (error: any) {
    console.error("[addToQueue]", error);
    return { success: false, inserted: 0, message: error?.message || String(error) };
  }
}