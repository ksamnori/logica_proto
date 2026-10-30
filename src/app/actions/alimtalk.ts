// src/app/actions/alimtalk.ts
"use server";

import { SolapiMessageService } from "solapi";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const ATTENDANCE_TEMPLATE_ID = "KA01TP260921034958500GAtQOl600yJ";

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

  return { success: true, pending: true, reason: "결과 확인 불가" };
}

// ------------------------------------------------------------------
// 1. 출결 안내 알림톡
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
// 2. 학습(테스트) 결과 안내 알림톡
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

  const testResultText = `[로지카대치본원학원] 학습 결과 안내\n\n${parentName || "학부모"} 학부모님,\n${studentName} 학생의 ${testName} 결과를 안내해 드립니다.\n\n시험명 : ${testName}\n\n학생 점수 : ${studentScore}점\n\n반 평균 : ${classAverage}점\n\n선생님 코멘트 : ${comment}\n\n상세한 분석 리포트는 다음 등원 시 배부될 예정입니다. 감사합니다.`;

  try {
    const response = await messageService.send([{
      to: String(parentPhone).replace(/[^0-9]/g, ""), 
      from: String(senderPhone).replace(/[^0-9]/g, ""),
      text: testResultText,
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
    try {
      const statusStr = !r.success ? "실패" : (r.pending ? "대기" : "성공");
      const contentStr = `[학습결과] ${testName} (점수: ${studentScore}, 반평균: ${classAverage})${comment ? `\n${comment}` : ""}`;
      await supabaseAdmin.from("notification_log").insert({
        target_name: `${studentName} / ${parentName || "학부모"}`,
        target_phone: parentPhone,
        message_content: r.reason ? `${contentStr} — ${r.reason}` : contentStr,
        status: statusStr,
      });
    } catch {}
    return { success: r.success, pending: r.pending, message: r.reason, data: response };
  } catch (error: any) {
    return { success: false, message: typeof error === 'object' ? JSON.stringify(error) : String(error) };
  }
}

// ------------------------------------------------------------------
// 3. 학사일정(휴원/개강) 안내 알림톡
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

  const scheduleText = `[로지카대치본원학원] 학사일정(휴원/개강) 안내\n\n${parentName || "학부모"} 학부모님,\n로지카 학원 대치 본원의 주요 학사일정을 안내해 드립니다.\n\n■ 일정 구분 : ${scheduleName}\n■ 적용 일시 : ${applyDate}\n■ 상세 안내 : ${details}\n\n학원 이용에 참고 부탁드리며, 관련하여 궁금하신 점은 학원으로 문의해 주시기 바랍니다. 감사합니다.`;

  try {
    const response = await messageService.send([{
      to: String(parentPhone).replace(/[^0-9]/g, ""), 
      from: String(senderPhone).replace(/[^0-9]/g, ""),
      text: scheduleText,
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
// 4. 시간표 변경 및 보강 안내 알림톡
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

  const changeText = `[로지카대치본원학원] 시간표 변경 및 보강 안내\n\n${parentName || "학부모"} 학부모님,\n원생의 수업 시간 변경 및 보강 일정을 안내해 드립니다.\n\n■ 기존 일시 : ${oldDate}\n■ 변경 일시 : ${newDate}\n■ 상세 안내 : ${details}\n\n일정 확인 부탁드리며, 해당 일시에 등원이 어려운 경우 학원으로 미리 연락해 주시기 바랍니다. 감사합니다.`;

  try {
    const response = await messageService.send([{
      to: String(parentPhone).replace(/[^0-9]/g, ""), 
      from: String(senderPhone).replace(/[^0-9]/g, ""),
      text: changeText,
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
// 5. 자유 내용 일반 문자(SMS/LMS) 전용 발송
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
      text: String(textContent) 
    }]);
    const r = interpretSolapiResult(response);
    return { success: r.success, pending: r.pending, message: r.reason, data: response };
  } catch (error: any) {
    return { success: false, message: typeof error === 'object' ? JSON.stringify(error) : String(error) };
  }
}

// ------------------------------------------------------------------
// 6. 출결 알림톡 대기열 적재 (키오스크 전용)
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
      
      const finalName = name && name !== "미입력" ? `${name}(${relStr})` : `${student.name}(${relStr})`;

      rows.push({
        tenant_id: student.tenant_id,          
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

      const finalName = name && name !== "미입력" ? `${name}(${relStr})` : `${stu.name}(${relStr})`;

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
    
    // 🌟 환경 변수에서 기본 도메인을 가져오고, 없으면 기본 Vercel 앱 주소를 세팅합니다.
    const portalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://www.logicaclass.com";

    for (const msg of toSend) {
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
        if (msg.template_id === "KA01TP260921034958500GAtQOl600yJ") {
          res = await sendAttendanceAlimtalk(payload as any);
        } else if (msg.template_id === "KA01TP260921035109788D7zIQYMgqvp") {
          res = await sendScheduleNoticeAlimtalk(payload as any);
        } else if (msg.template_id === "KA01TP26092103514300371OMrxorSxG") {
          res = await sendClassChangeAlimtalk(payload as any);
        } else if (msg.template_id === "GENERAL_SMS") {
          // 🌟 텍스트 기반 버튼 스타일 렌더링 (개별 보강 문자처럼 이미 머리말/학부모 호칭이 포함된 경우 중복 방지)
          const rawDetails = String(msg.details || "").trim();
          const isPreformatted =
            rawDetails.startsWith("[로지카대치본원학원] 보강 안내") ||
            rawDetails.includes("학부모님,");
          const cleanedDetails = rawDetails.replace(/^\[로지카대치본원학원\]\s*/, "");
          const textContent = isPreformatted
            ? `${rawDetails}\n\n━━━━━━━━━━━━━━\n📱 [자녀 학습 현황 / 학부모 포탈]\n👉 ${portalBaseUrl}/p\n━━━━━━━━━━━━━━\n\n문의: 02-555-8875`
            : `[로지카대치본원학원]\n\n${msg.parent_name} 학부모님,\n\n${cleanedDetails}\n\n━━━━━━━━━━━━━━\n📱 [자녀 학습 현황 / 학부모 포탈]\n👉 ${portalBaseUrl}/p\n━━━━━━━━━━━━━━\n\n문의: 02-555-8875`;
          res = await sendGeneralMessage({ parentPhone: msg.parent_phone, textContent });
        } else {
          res = { success: false, message: `알 수 없는 템플릿: ${msg.template_id}` };
        }
      } catch (e: any) {
        res = { success: false, message: e?.message || String(e) };
      }

      let logMessage = msg.preview_title || "[알림]";
      if (msg.template_id === "KA01TP260921034958500GAtQOl600yJ") {
        // 출결 알림톡: 일시 및 출결상태 상세 포함
        const parts = [
          msg.preview_title || `[출결] ${msg.status_label || ""}`,
          msg.time_string ? `(${msg.time_string})` : "",
        ].filter(Boolean);
        logMessage = parts.join(" ");
      } else if (msg.template_id === "KA01TP260921035109788D7zIQYMgqvp") {
        // 학사일정 알림톡: 적용일시 및 상세내용 포함
        const detailParts = [
          msg.apply_date ? `적용일시: ${msg.apply_date}` : "",
          msg.details ? String(msg.details).trim() : "",
        ].filter(Boolean);
        logMessage = detailParts.length > 0
          ? `${msg.preview_title}\n${detailParts.join("\n")}`
          : msg.preview_title;
      } else if (msg.template_id === "KA01TP26092103514300371OMrxorSxG") {
        // 시간표 변경 및 보강 안내 알림톡: 기존/변경일시 및 상세내용 포함
        const changeInfo =
          msg.old_date || msg.new_date
            ? `일시변경: ${msg.old_date || "-"} → ${msg.new_date || "-"}`
            : "";
        const detailParts = [
          changeInfo,
          msg.details ? String(msg.details).trim() : "",
        ].filter(Boolean);
        logMessage = detailParts.length > 0
          ? `${msg.preview_title}\n${detailParts.join("\n")}`
          : msg.preview_title;
      } else if (msg.template_id === "GENERAL_SMS") {
        // 일반 문자: 제목 + 실제 발송 본문(details) 전체 저장
        logMessage = msg.details
          ? `${msg.preview_title} 발송\n${String(msg.details).trim()}`
          : `${msg.preview_title} 발송`;
      }

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
// 10. 대기열에 메시지 추가
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

// ------------------------------------------------------------------
// 11. 키오스크 출결 처리
// ------------------------------------------------------------------
const CHECKOUT_COOLDOWN_MIN = 3;

export async function kioskAttendance(studentId: string) {
  if (!studentId) return { success: false, message: "studentId 누락" };

  try {
    const now = new Date();
    const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = kstTime.toISOString().split("T")[0];
    const timestamp = now.toISOString();
    const timeStr =
      `${String(kstTime.getUTCHours()).padStart(2, "0")}:` +
      `${String(kstTime.getUTCMinutes()).padStart(2, "0")}`;

    const { data: stu, error: sErr } = await supabaseAdmin
      .from("student")
      .select("student_id, name, tenant_id, enrollment(enrollment_id, status, end_date, class(class_id))")
      .eq("student_id", studentId)
      .maybeSingle();

    if (sErr) throw sErr;
    if (!stu) return { success: false, message: "학생을 찾을 수 없습니다." };

    const enrollArr = Array.isArray(stu.enrollment) ? stu.enrollment : (stu.enrollment ? [stu.enrollment] : []);
    const activeEnrolls = enrollArr.filter((e: any) => !["수강종료", "종료", "퇴원", "취소"].includes(String(e?.status || "").trim()) && !e?.end_date);
    const enr: any = activeEnrolls[0] || null;
    const enrollmentId = enr?.enrollment_id ?? null;
    const classId = enr?.class?.class_id ?? null;

    const { data: rawRecords, error: fErr } = await supabaseAdmin
      .from("attendance")
      .select("*")
      .eq("student_id", studentId)
      .eq("attendance_date", today)
      .order("attendance_id", { ascending: true });

    if (fErr) throw fErr;

    const records = rawRecords || [];
    const latest = records.length > 0 ? records[records.length - 1] : null;

    let popupType: "in" | "out" | "reentry" = "in";
    let statusLabel = "등원";

    if (!latest) {
      const { error } = await supabaseAdmin.from("attendance").insert({
        student_id: stu.student_id,
        tenant_id: stu.tenant_id,
        class_id: classId,
        enrollment_id: enrollmentId,
        attendance_date: today,
        status: "등원",
        check_in_time: timestamp,
      });
      if (error) throw error;

    } else if (!latest.check_out_time) {
      const mins = (now.getTime() - new Date(latest.check_in_time).getTime()) / 60000;
      if (mins < CHECKOUT_COOLDOWN_MIN) {
        const remaining = Math.ceil(CHECKOUT_COOLDOWN_MIN - mins);
        return { success: false, cooldown: true, remaining, message: `등원 후 ${CHECKOUT_COOLDOWN_MIN}분이 지나야 하원할 수 있습니다. (${remaining}분 남음)` };
      }

      const { error } = await supabaseAdmin
        .from("attendance")
        .update({ check_out_time: timestamp, status: "하원" })
        .eq("attendance_id", latest.attendance_id);
      if (error) throw error;

      popupType = "out";
      statusLabel = "하원";

    } else {
      const { error } = await supabaseAdmin.from("attendance").insert({
        student_id: stu.student_id,
        tenant_id: stu.tenant_id,
        class_id: classId,
        enrollment_id: enrollmentId,
        attendance_date: today,
        status: "등원",
        check_in_time: timestamp,
      });
      if (error) throw error;

      popupType = "reentry";
      statusLabel = "등원";
    }

    const q = await queueAttendanceAlimtalk({
      studentId: stu.student_id,
      statusLabel,
      timeString: timeStr,
    });

    return { success: true, popupType, statusLabel, queued: q.queued ?? 0, name: stu.name };
  } catch (error: any) {
    console.error("[kioskAttendance]", error);
    return { success: false, message: error?.message || String(error) };
  }
}


// ------------------------------------------------------------------
// 12. 학생별(학부모별) 지난 카톡 알림톡 및 문자 내역 통합 조회 (DB + 솔라피 서버 직접 조회)
// ------------------------------------------------------------------
function formatPhoneVariants(rawPhones: string[]): { rawList: string[]; allVariants: string[] } {
  const rawSet = new Set<string>();
  const varSet = new Set<string>();

  for (const p of rawPhones) {
    if (!p || String(p).includes("unassigned")) continue;
    const digits = String(p).replace(/[^0-9]/g, "");
    if (digits.length < 9) continue;
    rawSet.add(digits);
    varSet.add(digits);
    if (digits.length === 11) {
      varSet.add(`${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`);
    } else if (digits.length === 10) {
      varSet.add(`${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`);
    }
  }
  return {
    rawList: Array.from(rawSet),
    allVariants: Array.from(varSet),
  };
}

function buildSolapiDisplayContent(msg: any): { title: string; body: string; channelLabel: string } {
  const msgType = String(msg?.type || "").toUpperCase();
  const vars = msg?.kakaoOptions?.variables || {};
  const rawText = String(msg?.text || msg?.content || "").trim();

  if (msgType === "ATA" || msgType === "CTA" || msg?.kakaoOptions) {
    const channelLabel = "카카오 알림톡";
    // 변수들이 있으면 실제 발송된 알림톡 내용을 보기 좋게 재구성
    if (vars && Object.keys(vars).length > 0) {
      const stu = vars["#{학생명}"] || "";
      const attStatus = vars["#{출결상태}"] || "";
      const timeStr = vars["#{일시}"] || "";
      const schName = vars["#{일정명}"] || "";
      const applyDate = vars["#{적용일시}"] || "";
      const oldDate = vars["#{기존일시}"] || "";
      const newDate = vars["#{변경일시}"] || "";
      const details = vars["#{상세내용}"] || "";
      const testName = vars["#{테스트명}"] || "";
      const stuScore = vars["#{학생점수}"] || "";
      const classAvg = vars["#{반평균}"] || "";
      const comment = vars["#{코멘트}"] || "";

      if (attStatus || timeStr) {
        return {
          title: `[출결 안내] ${attStatus}`,
          body: `${stu ? `${stu} 학생 ` : ""}${attStatus ? `[${attStatus}] ` : ""}${timeStr ? `일시: ${timeStr}` : ""}`.trim(),
          channelLabel,
        };
      }
      const pName = vars["#{이름}"] || "학부모";
      if (schName) {
        return {
          title: `[로지카대치본원학원] 학사일정(휴원/개강) 안내`,
          body: `[로지카대치본원학원] 학사일정(휴원/개강) 안내\n\n${pName} 학부모님,\n로지카 학원 대치 본원의 주요 학사일정을 안내해 드립니다.\n\n■ 일정 구분 : ${schName}\n■ 적용 일시 : ${applyDate || "-"}\n■ 상세 안내 : ${details || "-"}\n\n학원 이용에 참고 부탁드리며, 관련하여 궁금하신 점은 학원으로 문의해 주시기 바랍니다. 감사합니다.`,
          channelLabel,
        };
      }
      if (oldDate || newDate) {
        return {
          title: `[로지카대치본원학원] 시간표 변경 및 보강 안내`,
          body: `[로지카대치본원학원] 시간표 변경 및 보강 안내\n\n${pName} 학부모님,\n원생의 수업 시간 변경 및 보강 일정을 안내해 드립니다.\n\n■ 기존 일시 : ${oldDate || "-"}\n■ 변경 일시 : ${newDate || "-"}\n■ 상세 안내 : ${details || "-"}\n\n일정 확인 부탁드리며, 해당 일시에 등원이 어려운 경우 학원으로 미리 연락해 주시기 바랍니다. 감사합니다.`,
          channelLabel,
        };
      }
      if (testName) {
        return {
          title: `[로지카대치본원학원] 학습 결과 안내`,
          body: `[로지카대치본원학원] 학습 결과 안내\n\n${pName} 학부모님,\n${stu} 학생의 ${testName} 결과를 안내해 드립니다.\n\n시험명 : ${testName}\n\n학생 점수 : ${stuScore || "-"}점\n\n반 평균 : ${classAvg || "-"}점\n\n선생님 코멘트 : ${comment || "-"}\n\n상세한 분석 리포트는 다음 등원 시 배부될 예정입니다. 감사합니다.`,
          channelLabel,
        };
      }

      const fallbackPairs = Object.entries(vars)
        .map(([k, v]) => `${k.replace(/[#{}]/g, "")}: ${v}`)
        .join("\n");
      return {
        title: rawText || "카카오 알림톡",
        body: fallbackPairs,
        channelLabel,
      };
    }

    return {
      title: rawText.split("\n")[0] || "카카오 알림톡",
      body: rawText,
      channelLabel,
    };
  }

  const channelLabel =
    msgType === "LMS" ? "장문 문자(LMS)" : msgType === "MMS" ? "멀티 문자(MMS)" : "일반 문자(SMS)";
  const lines = rawText.split("\n").filter((l) => l.trim() !== "");
  const firstLine = lines[0] || channelLabel;
  return {
    title: firstLine.length > 36 ? firstLine.slice(0, 36) + "..." : firstLine,
    body: rawText,
    channelLabel,
  };
}

export async function getStudentMessageHistoryAction({
  studentId,
  studentName,
  phones = [],
}: {
  studentId: string;
  studentName?: string;
  phones?: string[];
}) {
  try {
    // 1. 학생 및 학부모 연락처 수집
    const phoneCandidates: string[] = [...(phones || [])];
    const parentLabelMap: Record<string, string> = {};

    if (studentId) {
      const { data: stuRow } = await supabaseAdmin
        .from("student")
        .select(
          "name, phone, parent(name, phone, relationship, name_2, phone_2, relationship_2, name_3, phone_3, relationship_3)"
        )
        .eq("student_id", studentId)
        .maybeSingle();

      if (stuRow) {
        if (!studentName && stuRow.name) studentName = stuRow.name;
        if (stuRow.phone) {
          const d = String(stuRow.phone).replace(/[^0-9]/g, "");
          if (d) {
            phoneCandidates.push(d);
            parentLabelMap[d] = `${stuRow.name} (학생 본인)`;
          }
        }
        const pObj: any = Array.isArray(stuRow.parent) ? stuRow.parent[0] : stuRow.parent;
        if (pObj) {
          const addP = (ph?: string | null, nm?: string | null, rel?: string | null) => {
            if (!ph || String(ph).includes("unassigned")) return;
            const d = String(ph).replace(/[^0-9]/g, "");
            if (!d) return;
            phoneCandidates.push(d);
            const relLabel = rel || "학부모";
            const nameLabel = nm && nm !== "미입력" ? `${nm} (${relLabel})` : `${stuRow.name} ${relLabel}`;
            parentLabelMap[d] = nameLabel;
          };
          addP(pObj.phone, pObj.name, pObj.relationship);
          addP(pObj.phone_2, pObj.name_2, pObj.relationship_2);
          addP(pObj.phone_3, pObj.name_3, pObj.relationship_3);
        }
      }
    }

    const { rawList, allVariants } = formatPhoneVariants(phoneCandidates);

    // 2. 학원 DB (notification_log) 조회
    let dbLogs: any[] = [];
    const orFilters: string[] = [];
    allVariants.forEach((v) => {
      orFilters.push(`target_phone.eq.${v}`);
      orFilters.push(`receiver_phone.eq.${v}`);
    });
    if (studentName && studentName.trim()) {
      orFilters.push(`target_name.ilike.%${studentName.trim()}%`);
    }

    if (orFilters.length > 0) {
      const { data: rows, error: dbErr } = await supabaseAdmin
        .from("notification_log")
        .select("*")
        .or(orFilters.join(","))
        .order("created_at", { ascending: false })
        .limit(200);

      if (dbErr) {
        // receiver_phone 컬럼이 없는 스키마일 경우 target_phone과 target_name만으로 재시도
        const fallbackFilters: string[] = [];
        allVariants.forEach((v) => fallbackFilters.push(`target_phone.eq.${v}`));
        if (studentName && studentName.trim()) {
          fallbackFilters.push(`target_name.ilike.%${studentName.trim()}%`);
        }
        if (fallbackFilters.length > 0) {
          const { data: fbRows } = await supabaseAdmin
            .from("notification_log")
            .select("*")
            .or(fallbackFilters.join(","))
            .order("created_at", { ascending: false })
            .limit(200);
          dbLogs = fbRows || [];
        }
      } else {
        dbLogs = rows || [];
      }
    }

    const formattedDbLogs = dbLogs.map((row: any, idx: number) => {
      const rawPhone = String(row.target_phone || row.receiver_phone || "");
      const digits = rawPhone.replace(/[^0-9]/g, "");
      const fullContent = String(row.message_content || row.content || "").trim();
      const catMatch = fullContent.match(/^\[(.*?)\]/);
      const category = catMatch ? catMatch[1] : row.noti_type || "알림";
      const sentAt = row.created_at || row.sent_at || new Date().toISOString();

      return {
        id: `db_${row.noti_log_id || row.id || idx}`,
        source: "db" as const,
        category,
        channelLabel:
          category.includes("문자") || category.includes("SMS") || category.includes("BILL") || category.includes("UNPAID")
            ? "문자(SMS/LMS)"
            : "카카오 알림톡",
        recipientName:
          row.target_name || parentLabelMap[digits] || (studentName ? `${studentName} 학부모` : "학부모"),
        recipientPhone: rawPhone,
        title: fullContent.split("\n")[0] || category,
        body: fullContent,
        status: row.status || "성공",
        sentAt,
      };
    });

    // 3. 솔라피(Solapi) 서버 발송 내역 직접 조회
    const solapiLogs: any[] = [];
    if (
      process.env.SOLAPI_API_KEY &&
      process.env.SOLAPI_API_SECRET &&
      rawList.length > 0
    ) {
      const messageService = new SolapiMessageService(
        process.env.SOLAPI_API_KEY,
        process.env.SOLAPI_API_SECRET
      );

      await Promise.all(
        rawList.map(async (digits) => {
          try {
            const res: any = await (messageService as any).getMessages({
              to: digits,
              limit: 50,
            });
            const listObj = res?.messageList || res?.data?.messageList || {};
            const items: any[] = Array.isArray(listObj)
              ? listObj
              : Object.values(listObj);

            items.forEach((m: any, i: number) => {
              if (!m) return;
              // 비밀번호 재설정 인증번호 문자는 발송 내역에서 제외
              const rawText = String(m.text || m.content || "");
              if (rawText.includes("비밀번호 재설정 인증번호는")) return;

              const { title, body, channelLabel } = buildSolapiDisplayContent(m);
              const sCode = String(m.statusCode || "");
              let status = "성공";
              if (sCode === "4000") status = "성공";
              else if (["2000", "3000"].includes(sCode) || !sCode) status = "대기";
              else status = `실패 (${m.statusMessage || sCode})`;

              const sentAt =
                m.dateSent || m.dateCreated || m.dateUpdated || m.createdAt || new Date().toISOString();
              const fmtPhone =
                digits.length === 11
                  ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
                  : digits;

              solapiLogs.push({
                id: `solapi_${m.messageId || m._id || `${digits}_${i}`}`,
                source: "solapi" as const,
                category: channelLabel.includes("알림톡") ? "알림톡" : "문자",
                channelLabel,
                recipientName:
                  parentLabelMap[digits] || (studentName ? `${studentName} 학부모` : "학부모"),
                recipientPhone: fmtPhone,
                title,
                body,
                status,
                sentAt,
              });
            });
          } catch (err) {
            console.warn(`[getStudentMessageHistoryAction] 솔라피 조회 실패 (${digits}):`, err);
          }
        })
      );
    }

    solapiLogs.sort((a, b) =>
      String(b.sentAt || "").localeCompare(String(a.sentAt || ""))
    );

    return {
      success: true,
      dbLogs: formattedDbLogs,
      solapiLogs,
      trackedPhones: allVariants.filter((p) => p.includes("-")),
    };
  } catch (err: any) {
    console.error("[getStudentMessageHistoryAction]", err);
    return {
      success: false,
      dbLogs: [],
      solapiLogs: [],
      trackedPhones: [],
      message: err?.message || String(err),
    };
  }
}
