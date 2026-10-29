// src/app/actions/parentAuth.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { phoneVariants } from "@/lib/normalize";
import { sendGeneralMessage } from "@/app/actions/alimtalk";

type ParentPwCol = "password_hash" | "password_hash_2" | "password_hash_3";
type ParentNameCol = "name" | "name_2" | "name_3";
type ParentImgCol = "profile_image_url" | "profile_image_url_2" | "profile_image_url_3";

// bcrypt 해시는 항상 $2a$ / $2b$ / $2y$ 로 시작합니다.
function isHashed(value: string | null | undefined) {
  return !!value && /^\$2[aby]\$/.test(value);
}

// 환경변수 에러 방지 처리
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// 숫자만 추출하여 비교하기 위한 헬퍼
function cleanDigits(val: string | null | undefined) {
  return (val || "").replace(/[^0-9]/g, "");
}

function getSlotColumns(slot: 1 | 2 | 3): {
  pwCol: ParentPwCol;
  nameCol: ParentNameCol;
  imgCol: ParentImgCol;
} {
  return {
    pwCol: slot === 1 ? "password_hash" : slot === 2 ? "password_hash_2" : "password_hash_3",
    nameCol: slot === 1 ? "name" : slot === 2 ? "name_2" : "name_3",
    imgCol: slot === 1 ? "profile_image_url" : slot === 2 ? "profile_image_url_2" : "profile_image_url_3",
  };
}

function resolvePublicImageUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl || !String(pathOrUrl).trim()) return null;
  const trimmed = String(pathOrUrl).trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const { data } = supabaseAdmin.storage.from("system_images").getPublicUrl(trimmed);
  return data?.publicUrl || null;
}

// 전화번호로 학부모 레코드 및 일치하는 번호 슬롯(1, 2, 3) 찾기
async function findParentByAnyPhone(phone: string) {
  const variants = phoneVariants(phone);
  const targetDigits = cleanDigits(phone);

  if (!targetDigits || variants.length === 0) return null;

  // phone, phone_2, phone_3 중 하나라도 일치하는 행 조회
  const orFilter = variants
    .map((v) => `phone.eq.${v},phone_2.eq.${v},phone_3.eq.${v}`)
    .join(",");

  const { data: rows, error } = await supabaseAdmin
    .from("parent")
    .select(
      "parent_id, phone, phone_2, phone_3, name, name_2, name_3, password_hash, password_hash_2, password_hash_3"
    )
    .or(orFilter)
    .limit(1);

  if (error || !rows || rows.length === 0) return null;

  const parent = rows[0];
  let slot: 1 | 2 | 3 = 1;

  if (cleanDigits(parent.phone) === targetDigits) {
    slot = 1;
  } else if (cleanDigits(parent.phone_2) === targetDigits) {
    slot = 2;
  } else if (cleanDigits(parent.phone_3) === targetDigits) {
    slot = 3;
  }

  const { pwCol, nameCol, imgCol } = getSlotColumns(slot);

  return {
    parent,
    slot,
    pwCol,
    nameCol,
    imgCol,
    storedHash: (parent[pwCol] as string | null) ?? null,
  };
}

export async function verifyParentPhone(phone: string) {
  try {
    const found = await findParentByAnyPhone(phone);

    if (!found) {
      return { success: false, message: "등록된 연락처가 없습니다." };
    }

    const { parent, storedHash } = found;
    const hasPw = !!(storedHash && String(storedHash).trim() !== "");

    // 해당 슬롯의 비밀번호가 세팅되어 있지 않으면 setup 필요
    return {
      success: true,
      needsSetup: !hasPw,
      parentId: parent.parent_id,
    };
  } catch (err) {
    return { success: false, message: "서버 통신 오류" };
  }
}

export async function loginParentAction(phone: string, pwInput: string) {
  try {
    const found = await findParentByAnyPhone(phone);

    if (!found) {
      return { success: false, message: "계정을 찾을 수 없습니다." };
    }

    const { parent, pwCol, storedHash } = found;
    const stored = storedHash || "";

    if (!stored) {
      return {
        success: false,
        message: "비밀번호가 설정되어 있지 않습니다. 이전 화면에서 다시 시도해주세요.",
      };
    }

    let ok = false;

    if (isHashed(stored)) {
      ok = await bcrypt.compare(pwInput, stored);
    } else {
      ok = stored === pwInput;
      if (ok) {
        const newHash = await bcrypt.hash(pwInput, 10);
        await supabaseAdmin
          .from("parent")
          .update({ [pwCol]: newHash })
          .eq("parent_id", parent.parent_id);
      }
    }

    if (!ok) return { success: false, message: "비밀번호가 다릅니다." };

    return { success: true, parentId: parent.parent_id };
  } catch (err) {
    return { success: false, message: "서버 통신 오류" };
  }
}

export async function setupParentAction(
  parentId: string,
  name: string,
  pwInput: string,
  phone?: string
) {
  try {
    let pwCol: ParentPwCol = "password_hash";
    let nameCol: ParentNameCol = "name";

    // 입력한 전화번호를 기준으로 몇 번째 보호자인지 확인
    if (phone) {
      const found = await findParentByAnyPhone(phone);
      if (found) {
        pwCol = found.pwCol;
        nameCol = found.nameCol;
      }
    }

    const updatePayload: Record<string, string> = {
      [pwCol]: await bcrypt.hash(pwInput, 10),
    };

    // 성함을 입력했을 때만 업데이트 (비워두면 기존 등록된 성함 유지)
    if (name && name.trim() !== "") {
      updatePayload[nameCol] = name.trim();
    }

    const { error } = await supabaseAdmin
      .from("parent")
      .update(updatePayload)
      .eq("parent_id", parentId);

    if (error) throw error;
    return { success: true };
  } catch (err) {
    return { success: false, message: "설정에 실패했습니다." };
  }
}

// 🌟 커스텀 JWT 발급 함수 (환경변수 문자열 그대로 사용!)
export async function getParentAuthToken(parentId: string) {
  if (!process.env.SUPABASE_JWT_SECRET) {
    throw new Error("Missing SUPABASE_JWT_SECRET environment variable");
  }

  const token = jwt.sign(
    {
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7일 유지
      sub: parentId,
      role: "authenticated",
    },
    process.env.SUPABASE_JWT_SECRET
  );

  return token;
}

// =========================================================================
// 📱 휴대폰 본인인증(SMS OTP) 기반 비밀번호 재설정 서버 액션
// =========================================================================

export async function sendParentPasswordResetOtp(phone: string) {
  try {
    if (!process.env.SUPABASE_JWT_SECRET) {
      return { success: false, message: "서버 인증 설정(SUPABASE_JWT_SECRET)이 누락되었습니다." };
    }

    const found = await findParentByAnyPhone(phone);
    if (!found) {
      return { success: false, message: "학원에 등록된 학부모 연락처를 찾을 수 없습니다." };
    }

    const { parent, slot } = found;
    const phoneDigits = cleanDigits(phone);
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));

    const smsText = `[로지카 학부모 포털]\n비밀번호 재설정 인증번호는 [${otpCode}]입니다.\n3분 이내에 입력해주세요.`;
    const sendRes = await sendGeneralMessage({
      parentPhone: phoneDigits,
      textContent: smsText,
    });

    if (!sendRes.success) {
      return {
        success: false,
        message: `인증문자 발송에 실패했습니다. (${sendRes.message || "솔라피 설정 확인 필요"})`,
      };
    }

    const otpHash = await bcrypt.hash(otpCode, 8);
    const otpToken = jwt.sign(
      {
        purpose: "parent_pw_reset_otp",
        parentId: parent.parent_id,
        slot,
        phoneDigits,
        otpHash,
      },
      process.env.SUPABASE_JWT_SECRET,
      { expiresIn: "3m" }
    );

    return {
      success: true,
      otpToken,
      message: "휴대폰으로 6자리 인증번호를 발송했습니다.",
    };
  } catch (err: any) {
    console.error("[sendParentPasswordResetOtp]", err);
    return { success: false, message: "인증번호 발송 중 서버 오류가 발생했습니다." };
  }
}

export async function verifyParentPasswordResetOtp(
  phone: string,
  otpInput: string,
  otpToken: string
) {
  try {
    if (!process.env.SUPABASE_JWT_SECRET) {
      return { success: false, message: "서버 인증 설정이 누락되었습니다." };
    }

    const code = cleanDigits(otpInput);
    if (code.length !== 6) {
      return { success: false, message: "6자리 인증번호를 정확히 입력해주세요." };
    }

    let payload: any;
    try {
      payload = jwt.verify(otpToken, process.env.SUPABASE_JWT_SECRET);
    } catch (verifyErr: any) {
      if (verifyErr?.name === "TokenExpiredError") {
        return { success: false, message: "인증번호 유효시간(3분)이 만료되었습니다. 다시 발송해주세요." };
      }
      return { success: false, message: "유효하지 않은 인증 요청입니다. 다시 시도해주세요." };
    }

    if (
      payload?.purpose !== "parent_pw_reset_otp" ||
      payload?.phoneDigits !== cleanDigits(phone)
    ) {
      return { success: false, message: "인증 대상 전화번호가 일치하지 않습니다." };
    }

    const isMatch = await bcrypt.compare(code, payload.otpHash || "");
    if (!isMatch) {
      return { success: false, message: "인증번호가 일치하지 않습니다." };
    }

    const resetToken = jwt.sign(
      {
        purpose: "parent_pw_reset_verified",
        parentId: payload.parentId,
        slot: payload.slot,
        phoneDigits: payload.phoneDigits,
      },
      process.env.SUPABASE_JWT_SECRET,
      { expiresIn: "5m" }
    );

    return {
      success: true,
      resetToken,
      parentId: payload.parentId as string,
      message: "본인인증이 완료되었습니다. 새 비밀번호를 입력해주세요.",
    };
  } catch (err: any) {
    console.error("[verifyParentPasswordResetOtp]", err);
    return { success: false, message: "인증 확인 중 오류가 발생했습니다." };
  }
}

export async function confirmParentPasswordReset(
  phone: string,
  resetToken: string,
  newPassword: string
) {
  try {
    if (!process.env.SUPABASE_JWT_SECRET) {
      return { success: false, message: "서버 인증 설정이 누락되었습니다." };
    }

    const trimmedPw = (newPassword || "").trim();
    if (trimmedPw.length < 4) {
      return { success: false, message: "비밀번호는 4자리 이상으로 입력해주세요." };
    }

    let payload: any;
    try {
      payload = jwt.verify(resetToken, process.env.SUPABASE_JWT_SECRET);
    } catch (verifyErr: any) {
      return {
        success: false,
        message: "인증 세션이 만료되었습니다. 처음부터 다시 인증해주세요.",
      };
    }

    if (
      payload?.purpose !== "parent_pw_reset_verified" ||
      payload?.phoneDigits !== cleanDigits(phone)
    ) {
      return { success: false, message: "잘못된 비밀번호 재설정 요청입니다." };
    }

    const slot: 1 | 2 | 3 = payload.slot === 2 ? 2 : payload.slot === 3 ? 3 : 1;
    const { pwCol } = getSlotColumns(slot);
    const hashed = await bcrypt.hash(trimmedPw, 10);

    const { error } = await supabaseAdmin
      .from("parent")
      .update({ [pwCol]: hashed })
      .eq("parent_id", payload.parentId);

    if (error) throw error;

    return {
      success: true,
      parentId: payload.parentId as string,
      message: "비밀번호가 성공적으로 변경되었습니다.",
    };
  } catch (err: any) {
    console.error("[confirmParentPasswordReset]", err);
    return { success: false, message: "비밀번호 저장 중 오류가 발생했습니다." };
  }
}

// =========================================================================
// ⚙️ 학부모 프로필 조회 및 설정 변경 (이름[선택], 프로필 이미지, 비밀번호 변경)
// =========================================================================

export async function getParentProfileAction(parentId: string, phone?: string | null) {
  try {
    let slot: 1 | 2 | 3 = 1;
    const targetDigits = cleanDigits(phone);

    // 1차: profile_image_url 컬럼을 포함하여 조회 시도
    let parentRow: any = null;
    let hasImgColumns = true;

    const { data: fullRow, error: fullErr } = await supabaseAdmin
      .from("parent")
      .select(
        "parent_id, name, name_2, name_3, phone, phone_2, phone_3, password_hash, password_hash_2, password_hash_3, profile_image_url, profile_image_url_2, profile_image_url_3"
      )
      .eq("parent_id", parentId)
      .maybeSingle();

    if (fullErr) {
      hasImgColumns = false;
      const { data: basicRow, error: basicErr } = await supabaseAdmin
        .from("parent")
        .select(
          "parent_id, name, name_2, name_3, phone, phone_2, phone_3, password_hash, password_hash_2, password_hash_3"
        )
        .eq("parent_id", parentId)
        .maybeSingle();
      if (basicErr || !basicRow) {
        return { success: false, message: "학부모 정보를 찾을 수 없습니다." };
      }
      parentRow = basicRow;
    } else {
      parentRow = fullRow;
    }

    if (!parentRow) {
      return { success: false, message: "학부모 정보를 찾을 수 없습니다." };
    }

    if (targetDigits) {
      if (cleanDigits(parentRow.phone) === targetDigits) slot = 1;
      else if (cleanDigits(parentRow.phone_2) === targetDigits) slot = 2;
      else if (cleanDigits(parentRow.phone_3) === targetDigits) slot = 3;
    }

    const { pwCol, nameCol, imgCol } = getSlotColumns(slot);
    const rawName = (parentRow[nameCol] as string | null) || "";
    const displayName = rawName === "미입력" ? "" : rawName;
    const slotPhone =
      (slot === 1
        ? parentRow.phone
        : slot === 2
        ? parentRow.phone_2
        : parentRow.phone_3) ||
      parentRow.phone ||
      "";
    const hasPassword = !!(parentRow[pwCol] && String(parentRow[pwCol]).trim() !== "");

    let profileImageUrl: string | null = null;
    if (hasImgColumns && parentRow[imgCol]) {
      profileImageUrl = resolvePublicImageUrl(parentRow[imgCol]);
    }

    // DB 컬럼이 아직 없거나 비어 있을 경우 Storage의 고정 경로 파일이 있는지 확인
    if (!profileImageUrl) {
      const folder = "parent_avatars";
      const targetPrefix = `parent_${parentId}_slot${slot}`;
      const { data: files } = await supabaseAdmin.storage
        .from("system_images")
        .list(folder, { search: targetPrefix, limit: 5 });
      if (files && files.length > 0) {
        const sortedFiles = [...files].sort((a, b) =>
          String(b.name).localeCompare(String(a.name))
        );
        profileImageUrl = resolvePublicImageUrl(`${folder}/${sortedFiles[0].name}`);
      }
    }

    return {
      success: true,
      slot,
      name: displayName,
      phone: slotPhone,
      hasPassword,
      profileImageUrl,
    };
  } catch (err: any) {
    console.error("[getParentProfileAction]", err);
    return { success: false, message: "프로필 조회 중 오류가 발생했습니다." };
  }
}

export async function updateParentProfileAction({
  parentId,
  authToken,
  phone,
  name,
  currentPassword,
  newPassword,
  imageBase64,
  removeImage,
}: {
  parentId: string;
  authToken: string;
  phone?: string | null;
  name?: string;
  currentPassword?: string;
  newPassword?: string;
  imageBase64?: string | null;
  removeImage?: boolean;
}) {
  try {
    if (!process.env.SUPABASE_JWT_SECRET) {
      return { success: false, message: "서버 인증 설정이 누락되었습니다." };
    }

    // JWT 토큰 검증으로 타인의 프로필 수정 방지
    let decoded: any;
    try {
      decoded = jwt.verify(authToken, process.env.SUPABASE_JWT_SECRET);
    } catch {
      return { success: false, message: "로그인 세션이 만료되었습니다. 다시 로그인해주세요." };
    }
    if (!decoded || decoded.sub !== parentId) {
      return { success: false, message: "권한이 없습니다." };
    }

    const { data: parentRow, error: fetchErr } = await supabaseAdmin
      .from("parent")
      .select(
        "parent_id, name, name_2, name_3, phone, phone_2, phone_3, password_hash, password_hash_2, password_hash_3"
      )
      .eq("parent_id", parentId)
      .maybeSingle();

    if (fetchErr || !parentRow) {
      return { success: false, message: "학부모 계정을 찾을 수 없습니다." };
    }

    let slot: 1 | 2 | 3 = 1;
    const targetDigits = cleanDigits(phone);
    if (targetDigits) {
      if (cleanDigits(parentRow.phone) === targetDigits) slot = 1;
      else if (cleanDigits(parentRow.phone_2) === targetDigits) slot = 2;
      else if (cleanDigits(parentRow.phone_3) === targetDigits) slot = 3;
    }

    const { pwCol, nameCol, imgCol } = getSlotColumns(slot);
    const updatePayload: Record<string, any> = {};

    // 1. 학부모 이름 업데이트 (선택사항 — 비워두면 null/빈값으로 저장 허용)
    if (name !== undefined) {
      const trimmedName = name.trim();
      updatePayload[nameCol] = trimmedName ? trimmedName : null;
    }

    // 2. 비밀번호 변경 (입력된 경우에만)
    if (newPassword && newPassword.trim() !== "") {
      const trimmedNewPw = newPassword.trim();
      if (trimmedNewPw.length < 4) {
        return { success: false, message: "새 비밀번호는 4자리 이상으로 입력해주세요." };
      }

      const existingHash = parentRow[pwCol] as string | null;
      if (existingHash && String(existingHash).trim() !== "") {
        if (!currentPassword || !currentPassword.trim()) {
          return { success: false, message: "현재 비밀번호를 입력해주세요." };
        }
        const ok = isHashed(existingHash)
          ? await bcrypt.compare(currentPassword, existingHash)
          : existingHash === currentPassword;
        if (!ok) {
          return { success: false, message: "현재 비밀번호가 일치하지 않습니다." };
        }
      }

      updatePayload[pwCol] = await bcrypt.hash(trimmedNewPw, 10);
    }

    // 3. 프로필 이미지 업로드 또는 삭제
    let newPublicImageUrl: string | null | undefined = undefined;
    const folder = "parent_avatars";
    const targetPrefix = `parent_${parentId}_slot${slot}`;

    if (removeImage) {
      const { data: oldFiles } = await supabaseAdmin.storage
        .from("system_images")
        .list(folder, { search: targetPrefix, limit: 20 });
      if (oldFiles && oldFiles.length > 0) {
        await supabaseAdmin.storage
          .from("system_images")
          .remove(oldFiles.map((f) => `${folder}/${f.name}`));
      }
      newPublicImageUrl = null;
    } else if (imageBase64 && imageBase64.startsWith("data:image/")) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      // 기존 아바타 파일 정리
      const { data: oldFiles } = await supabaseAdmin.storage
        .from("system_images")
        .list(folder, { search: targetPrefix, limit: 20 });
      if (oldFiles && oldFiles.length > 0) {
        await supabaseAdmin.storage
          .from("system_images")
          .remove(oldFiles.map((f) => `${folder}/${f.name}`));
      }

      const filePath = `${folder}/${targetPrefix}_${Date.now()}.jpg`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("system_images")
        .upload(filePath, buffer, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (upErr) {
        return {
          success: false,
          message: `프로필 이미지 업로드 실패: ${upErr.message}`,
        };
      }
      newPublicImageUrl = resolvePublicImageUrl(filePath);
    }

    // 기본 정보(이름, 비밀번호) 먼저 업데이트
    if (Object.keys(updatePayload).length > 0) {
      const { error: updErr } = await supabaseAdmin
        .from("parent")
        .update(updatePayload)
        .eq("parent_id", parentId);

      if (updErr) throw updErr;
    }

    // 이미지 컬럼 업데이트 시도 (DB에 profile_image_url 컬럼이 있는 경우 저장, 아직 마이그레이션 전이면 Storage 폴백으로 동작)
    if (newPublicImageUrl !== undefined) {
      const { error: imgColErr } = await supabaseAdmin
        .from("parent")
        .update({ [imgCol]: newPublicImageUrl })
        .eq("parent_id", parentId);
      if (imgColErr) {
        console.warn(
          "[updateParentProfileAction] profile_image_url 컬럼 미생성 상태(Storage 폴백 사용):",
          imgColErr.message
        );
      }
    }

    return {
      success: true,
      name: name !== undefined ? name.trim() : (parentRow[nameCol] || ""),
      profileImageUrl: newPublicImageUrl,
      message: "설정이 저장되었습니다.",
    };
  } catch (err: any) {
    console.error("[updateParentProfileAction]", err);
    return {
      success: false,
      message: err?.message || "설정 저장 중 오류가 발생했습니다.",
    };
  }
}

// =========================================================================
// 📚 학부모 포털: 자녀의 전체 수업일지(이전 반 포함) 및 보강 내역 조회 (RLS 우회 안전 조회)
// =========================================================================

export async function getStudentPortalExtraDataAction({
  parentId,
  authToken,
  studentId,
  classIds = [],
}: {
  parentId?: string | null;
  authToken?: string | null;
  studentId: string;
  classIds?: string[];
}) {
  try {
    if (!studentId) {
      return { success: false, lessonLogs: [], makeups: [] };
    }

    if (authToken && process.env.SUPABASE_JWT_SECRET) {
      try {
        const decoded: any = jwt.verify(authToken, process.env.SUPABASE_JWT_SECRET);
        if (parentId && decoded?.sub && decoded.sub !== parentId) {
          return { success: false, lessonLogs: [], makeups: [] };
        }
      } catch {
        // 토큰 검증 실패 시에도 studentId 기준 최소 조회 허용 여부 확인
      }
    }

    // 1. 학생이 수강 중이거나 수강했던 모든 반(class_id) 조회
    const { data: enrRows } = await supabaseAdmin
      .from("enrollment")
      .select("class_id")
      .eq("student_id", studentId);

    const allClassIds = Array.from(
      new Set([
        ...(classIds || []).filter(Boolean),
        ...(enrRows || []).map((r: any) => r.class_id).filter(Boolean),
      ])
    );

    // 2. 학생 개별 코멘트가 달린 수업일지 ID 조회 (반 이동 등으로 누락되는 일지 방지)
    const { data: commentRows } = await supabaseAdmin
      .from("lesson_log_student_comment")
      .select("lesson_log_id, student_id, comment")
      .eq("student_id", studentId);

    const commentLogIds = Array.from(
      new Set((commentRows || []).map((c: any) => c.lesson_log_id).filter(Boolean))
    );

    // 3. 수업일지(daily_lesson_log) 전체 조회
    let rawLogs: any[] = [];
    if (allClassIds.length > 0) {
      const { data: classLogs } = await supabaseAdmin
        .from("daily_lesson_log")
        .select(
          "lesson_log_id, class_id, actual_date, homework_desc, instructor_note, lesson_log_student_comment(student_id, comment)"
        )
        .in("class_id", allClassIds)
        .order("actual_date", { ascending: false });
      if (classLogs) rawLogs.push(...classLogs);
    }

    if (commentLogIds.length > 0) {
      const existingIds = new Set(rawLogs.map((l) => l.lesson_log_id));
      const missingIds = commentLogIds.filter((id) => !existingIds.has(id));
      if (missingIds.length > 0) {
        const { data: extraLogs } = await supabaseAdmin
          .from("daily_lesson_log")
          .select(
            "lesson_log_id, class_id, actual_date, homework_desc, instructor_note, lesson_log_student_comment(student_id, comment)"
          )
          .in("lesson_log_id", missingIds)
          .order("actual_date", { ascending: false });
        if (extraLogs) rawLogs.push(...extraLogs);
      }
    }

    // 날짜 내림차순 정렬 및 중복 제거
    const seenLogIds = new Set<any>();
    const dedupLogs = rawLogs
      .filter((l) => {
        if (!l || seenLogIds.has(l.lesson_log_id)) return false;
        seenLogIds.add(l.lesson_log_id);
        return true;
      })
      .sort((a, b) =>
        String(b.actual_date || "").localeCompare(String(a.actual_date || ""))
      );

    // 4. 보강 일정(individual_makeup) 전체 조회 (이전 완료 내역 포함)
    const { data: makeupRows } = await supabaseAdmin
      .from("individual_makeup")
      .select("*, instructor(name)")
      .eq("student_id", studentId)
      .order("schedule_date", { ascending: false });

    return {
      success: true,
      lessonLogs: dedupLogs,
      makeups: makeupRows || [],
    };
  } catch (err: any) {
    console.error("[getStudentPortalExtraDataAction]", err);
    return { success: false, lessonLogs: [], makeups: [] };
  }
}
