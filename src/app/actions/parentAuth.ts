// src/app/actions/parentAuth.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { phoneVariants, normalizeMasterCategoryRow } from "@/lib/normalize";
import { sendGeneralMessage } from "@/app/actions/alimtalk";
import {
  buildExamQuestionScoreMap,
  calcScoreRatio,
  extractMergedQuestionGroups,
  roundScore,
} from "@/lib/examScore";
import { THINKING_CATEGORIES, type ThinkingCategoryItem } from "@/app/(dashboard)/pdf-parser/thinkingcategories";

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
    if (hasImgColumns) {
      const candidateCol =
        parentRow[imgCol] ||
        (!targetDigits
          ? parentRow.profile_image_url ||
            parentRow.profile_image_url_2 ||
            parentRow.profile_image_url_3
          : null);
      if (candidateCol) {
        profileImageUrl = resolvePublicImageUrl(candidateCol);
      }
    }

    // DB 컬럼이 아직 없거나 비어 있을 경우 Storage의 고정 경로 파일이 있는지 확인
    if (!profileImageUrl) {
      const folder = "parent_avatars";
      const searchPrefix = targetDigits
        ? `parent_${parentId}_slot${slot}`
        : `parent_${parentId}_slot`;
      const { data: files } = await supabaseAdmin.storage
        .from("system_images")
        .list(folder, { search: searchPrefix, limit: 10 });
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
          "lesson_log_id, class_id, actual_date, homework_desc, instructor_note, class(name), lesson_log_student_comment(student_id, comment)"
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
            "lesson_log_id, class_id, actual_date, homework_desc, instructor_note, class(name), lesson_log_student_comment(student_id, comment)"
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

// =========================================================================
// 📊 학부모 포털: 자녀의 4종 테스트 성적(주간테스트·주차별 오답·중간평가·분기평가),
//    주교재 구분선 정보, 단원별 성취도(최근 2개월 최대 8개), 정기평가 상세 분석 리포트 조회
// =========================================================================

type PortalTestSubTabId = "weekly" | "weekly_incorrect" | "midterm" | "quarterly";
const PORTAL_COMPETENCY_ORDER = ["문제해결", "추론", "의사소통", "연결", "정보처리"] as const;
type PortalCompetencyKey = (typeof PORTAL_COMPETENCY_ORDER)[number];
type PortalDiffTierKey = "BASIC" | "MID" | "KILLER";

function classifyPortalTestSubTab(master: any): PortalTestSubTabId | null {
  if (!master) return null;
  const typeStr = String(master.exam_type || "").normalize("NFC").trim();
  const titleStr = String(master.title || "").normalize("NFC").trim();
  const subTitleStr = String(master.sub_title || "").normalize("NFC").trim();
  const tagsStr = String(master.exam_tags || "").normalize("NFC").trim();

  if (
    typeStr === "미완료과제" ||
    /^\[미완료\s*과제\]/.test(titleStr) ||
    /미완료\s*프린트/.test(titleStr)
  ) {
    return null;
  }
  if (["과제", "과제프린트", "과제오답유사"].includes(typeStr)) {
    return null;
  }
  if (
    ["입학테스트", "진단평가"].some(
      (kw) =>
        typeStr.includes(kw) ||
        titleStr.includes(kw) ||
        subTitleStr.includes(kw) ||
        tagsStr.includes(kw)
    )
  ) {
    return null;
  }
  if (titleStr.includes("[통합]") || subTitleStr === "누적 오답 모음") {
    return null;
  }

  const combinedText = `${titleStr} ${subTitleStr} ${typeStr}`;
  const hasWeekKeyword = /([0-9xX]+\s*주차|[0-9]+\s*주|주차|주간)/.test(combinedText);
  const hasWrongKeyword = /오답\s*(?:프린트|클리닉|노트|유사)?/.test(combinedText);
  if (
    (hasWeekKeyword && hasWrongKeyword) ||
    (["오답프린트", "오답"].includes(typeStr) && !/과제|중간평가|분기평가|단원평가/.test(titleStr))
  ) {
    return "weekly_incorrect";
  }

  const isQuarterly =
    !/오답/.test(titleStr) &&
    (typeStr === "분기평가" ||
      typeStr === "분기테스트" ||
      typeStr.includes("분기평가") ||
      typeStr.includes("분기테스트") ||
      (!["주간테스트", "중간평가", "중간테스트", "단원평가"].includes(typeStr) &&
        (titleStr.includes("분기평가") ||
          titleStr.includes("분기테스트") ||
          subTitleStr.includes("분기평가") ||
          tagsStr.includes("분기평가"))));
  if (isQuarterly) return "quarterly";

  const isMidterm =
    !/오답/.test(titleStr) &&
    (typeStr === "중간평가" ||
      typeStr === "중간테스트" ||
      typeStr.includes("중간평가") ||
      typeStr.includes("중간테스트") ||
      (!["주간테스트", "분기평가", "분기테스트", "단원평가"].includes(typeStr) &&
        (titleStr.includes("중간평가") ||
          titleStr.includes("중간테스트") ||
          subTitleStr.includes("중간평가") ||
          tagsStr.includes("중간평가"))));
  if (isMidterm) return "midterm";

  const isWeekly =
    !/오답/.test(titleStr) &&
    (typeStr === "주간테스트" ||
      /[0-9xX]+\s*주차\s*(?:평가|테스트)/.test(titleStr) ||
      /[0-9xX]+\s*주차\s*(?:평가|테스트)/.test(subTitleStr));
  if (isWeekly) return "weekly";

  return null;
}

function stripPortalStudentPrefix(rawTitle: string, studentName?: string): string {
  let t = String(rawTitle || "").trim();
  if (!t) return "";
  if (studentName) {
    const escaped = studentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`^\\[${escaped}\\]\\s*`), "").trim();
  }
  if (!t.startsWith("[통합]") && !t.startsWith("[미완료")) {
    t = t.replace(/^\[[^\]]{1,12}\]\s*/, "").trim();
  }
  return t;
}

function extractPortalWeekNumber(title?: string, subTitle?: string): number | null {
  const src = `${title || ""} ${subTitle || ""}`;
  const mSpecific = src.match(/(\d+)\s*주차\s*(?:평가|테스트|주간|오답)/);
  if (mSpecific) return parseInt(mSpecific[1], 10);
  const mAny = src.match(/(\d+)\s*주차/);
  if (mAny) return parseInt(mAny[1], 10);
  return null;
}

function stripPortalLeadingIndex(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+|\d+)\s*[.\-)\]]\s*/i, "")
    .replace(/^\(\d+\)\s*/, "")
    .trim();
}

function isValidPortalCompetency(val: any): val is PortalCompetencyKey {
  return (
    typeof val === "string" &&
    (PORTAL_COMPETENCY_ORDER as readonly string[]).includes(val.trim())
  );
}

function extractPortalCompetencyPair(row: any): {
  primary: PortalCompetencyKey | null;
  secondary: PortalCompetencyKey | null;
} {
  if (!row) return { primary: null, secondary: null };
  const hasConfirmedPrimary = Boolean(String(row.final_primary || "").trim());
  const pRaw = String(hasConfirmedPrimary ? row.final_primary : row.ai_primary || "").trim();
  const sRaw = String(
    hasConfirmedPrimary ? row.final_secondary || "" : row.ai_secondary || ""
  ).trim();
  const primary = isValidPortalCompetency(pRaw) ? pRaw : null;
  const secondary = isValidPortalCompetency(sRaw) && sRaw !== primary ? sRaw : null;
  return { primary, secondary };
}

function inferPortalFallbackCompetencies(hintText: string): PortalCompetencyKey[] {
  const s = String(hintText || "");
  const matched: PortalCompetencyKey[] = [];
  if (/표|그래프|통계|자료|경우의\s*수|확률|평균|가능성|분류|정리/.test(s)) {
    matched.push("정보처리");
  }
  if (/새\s*연산|기호|정의|식\s*세우|서술|설명|나타내기|표현/.test(s)) {
    matched.push("의사소통");
  }
  if (/규칙|수열|논리|추리|추론|복면산|벌레먹은|마방진|스도쿠|퍼즐|배열|참.*거짓/.test(s)) {
    matched.push("추론");
  }
  if (/실생활|활용|측정|시계|시간|달력|길이|들이|무게|이동|전개도|쌓기나무|닮음/.test(s)) {
    matched.push("연결");
  }
  if (matched.length === 0) return ["문제해결"];
  if (
    matched.length === 1 &&
    matched[0] !== "문제해결" &&
    /조건|구하|만들기|해결|최대|최소/.test(s)
  ) {
    matched.push("문제해결");
  }
  return matched.slice(0, 2);
}

async function fetchAllAdminRows(
  buildQuery: (from: number, to: number) => any,
  pageSize = 1000
) {
  let all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function getStudentPortalExamDataAction({
  parentId,
  authToken,
  studentId,
}: {
  parentId?: string | null;
  authToken?: string | null;
  studentId: string;
}) {
  const emptyPayload = {
    success: false,
    examResultsBySubTab: {
      weekly: [] as any[],
      weekly_incorrect: [] as any[],
      midterm: [] as any[],
      quarterly: [] as any[],
    },
    categoryAnalysisBySubTab: {
      weekly: [] as any[],
      weekly_incorrect: [] as any[],
    },
    periodicReportsBySubTab: {
      midterm: [] as any[],
      quarterly: [] as any[],
    },
    mainTextbooks: [] as any[],
    schoolExams: [] as any[],
  };

  try {
    if (!studentId) return emptyPayload;

    if (authToken && process.env.SUPABASE_JWT_SECRET) {
      try {
        const decoded: any = jwt.verify(authToken, process.env.SUPABASE_JWT_SECRET);
        if (parentId && decoded?.sub && decoded.sub !== parentId) {
          return emptyPayload;
        }
      } catch {
        // 토큰 검증 예외 시에도 studentId 기준 최소 조회 허용
      }
    }

    // 1단계: 학생 기본정보·수강이력·배정 시험·학교 내신·채점 기준표 병렬 조회
    const [
      { data: stuRow },
      { data: enrollRows },
      { data: assignments },
      { data: schoolExams },
      { data: gcData },
    ] = await Promise.all([
      supabaseAdmin.from("student").select("name").eq("student_id", studentId).maybeSingle(),
      supabaseAdmin.from("enrollment").select("class_id").eq("student_id", studentId),
      supabaseAdmin
        .from("exam_assignment")
        .select("assignment_id, exam_id, class_id, total_score, status, created_at, exam_master(*)")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("student_school_exam")
        .select("*")
        .eq("student_id", studentId)
        .order("year", { ascending: false })
        .order("semester", { ascending: false })
        .order("exam_type", { ascending: true }),
      supabaseAdmin
        .from("master_grading_code")
        .select("code, description, is_correct, score_ratio, admission_ratio"),
    ]);

    const studentName = String(stuRow?.name || "").trim();
    const classIds = Array.from(
      new Set((enrollRows || []).map((r: any) => r.class_id).filter(Boolean))
    );

    // 주교재 목록 조회 (새 과정 1주차 구분선 라벨용)
    let mainTextbooks: any[] = [];
    if (classIds.length > 0) {
      const { data: cbDataRaw } = await supabaseAdmin
        .from("class_textbook")
        .select("*, textbook(title, book_type), class(name)")
        .in("class_id", classIds);
      mainTextbooks = (cbDataRaw || [])
        .map((cb: any) => {
          const tb = Array.isArray(cb?.textbook) ? cb.textbook[0] : cb?.textbook;
          const cls = Array.isArray(cb?.class) ? cb.class[0] : cb?.class;
          return {
            class_textbook_id: cb.class_textbook_id,
            class_id: cb.class_id,
            book_id: cb.book_id,
            title: String(tb?.title || "").trim(),
            book_type: String(tb?.book_type || "").trim(),
            status: String(cb.status || "").trim(),
            start_date: cb.start_date || null,
            created_at: cb.created_at || null,
            className: String(cls?.name || "").trim(),
          };
        })
        .filter((b: any) => {
          if (!b.title) return false;
          if (["워크북", "과제", "부교재", "연산", "테스트"].includes(b.book_type)) return false;
          if (["주교재", "본교재", "개념서", "심화서"].includes(b.book_type)) return true;
          return !/워크북|WORKBOOK|연산|부교재|추가문제|쌍둥이|유사|클리닉|오답/i.test(b.title);
        });
    }

    const preStatuses = ["응시전", "미응시", "예정", "대기"];
    const categorized: { assign: any; master: any; subTab: PortalTestSubTabId }[] = [];
    (assignments || []).forEach((a: any) => {
      if (preStatuses.includes(String(a.status || "").trim())) return;
      const master = Array.isArray(a.exam_master) ? a.exam_master[0] : a.exam_master;
      const subTab = classifyPortalTestSubTab(master);
      if (!subTab) return;
      categorized.push({ assign: a, master, subTab });
    });

    if (categorized.length === 0) {
      return {
        ...emptyPayload,
        success: true,
        mainTextbooks,
        schoolExams: schoolExams || [],
      };
    }

    const gcMeta: Record<string, any> = {};
    (gcData || []).forEach((row: any) => {
      if (row.code) gcMeta[row.code] = row;
    });

    const examIds = Array.from(
      new Set(categorized.map((c) => c.assign.exam_id).filter(Boolean))
    );

    // 2단계: 동일 시험지 응시 배정 + 시험 문항 목록 병렬 조회
    const [allAssignmentsForExams, examItems] = await Promise.all([
      fetchAllAdminRows((from, to) =>
        supabaseAdmin
          .from("exam_assignment")
          .select("assignment_id, exam_id, status, total_score, student(name)")
          .in("exam_id", examIds)
          .not("status", "in", '("응시전","미응시","예정","대기")')
          .range(from, to)
      ),
      fetchAllAdminRows((from, to) =>
        supabaseAdmin
          .from("exam_item")
          .select("exam_id, question_id, sort_order, assigned_score")
          .in("exam_id", examIds)
          .order("sort_order")
          .range(from, to)
      ),
    ]);

    const itemsByExam = new Map<string, any[]>();
    (examItems || []).forEach((it: any) => {
      const k = String(it.exam_id);
      if (!itemsByExam.has(k)) itemsByExam.set(k, []);
      itemsByExam.get(k)!.push(it);
    });

    const examScoreConfigMap = new Map<
      string,
      {
        scoreByQuestionId: Map<string, number>;
        defaultScore: number;
        groupCount: number;
        totalItems: number;
      }
    >();
    categorized.forEach(({ assign, master }) => {
      const k = String(assign.exam_id);
      if (!examScoreConfigMap.has(k)) {
        const items = itemsByExam.get(k) || [];
        const { scoreByQuestionId, groupCount } = buildExamQuestionScoreMap(
          items,
          master?.layout_settings,
          master?.exam_type,
          master?.total_questions || 1
        );
        examScoreConfigMap.set(k, {
          scoreByQuestionId,
          defaultScore: 100 / (groupCount || master?.total_questions || 1),
          groupCount: groupCount || master?.total_questions || items.length || 0,
          totalItems: items.length || master?.total_questions || 0,
        });
      }
    });

    // 3단계: 전체 응시 배정의 답안 일괄 조회
    const allAssignIdSet = new Set<any>();
    (allAssignmentsForExams || []).forEach((a: any) => allAssignIdSet.add(a.assignment_id));
    categorized.forEach((c) => allAssignIdSet.add(c.assign.assignment_id));
    const allAssignIds = Array.from(allAssignIdSet);

    let allAnswers: any[] = [];
    for (let i = 0; i < allAssignIds.length; i += 200) {
      const chunk = allAssignIds.slice(i, i + 200);
      const chunkRows = await fetchAllAdminRows((from, to) =>
        supabaseAdmin
          .from("student_answer")
          .select("exam_assignment_id, question_id, grading_code, earned_score, is_correct")
          .in("exam_assignment_id", chunk)
          .range(from, to)
      );
      if (chunkRows) allAnswers = allAnswers.concat(chunkRows);
    }

    const dedupAnsMap = new Map<string, any>();
    allAnswers.forEach((ans) => {
      if (!ans.grading_code && ans.is_correct == null) return;
      const k = `${ans.exam_assignment_id}_${ans.question_id}`;
      const ex = dedupAnsMap.get(k);
      if (!ex || Number(ans.earned_score || 0) >= Number(ex.earned_score || 0)) {
        dedupAnsMap.set(k, ans);
      }
    });

    const assignToExamMap = new Map<any, string>();
    (allAssignmentsForExams || []).forEach((a: any) =>
      assignToExamMap.set(a.assignment_id, String(a.exam_id))
    );
    categorized.forEach(({ assign }) =>
      assignToExamMap.set(assign.assignment_id, String(assign.exam_id))
    );

    const assignCounts: Record<
      string,
      {
        o: number;
        ro: number;
        to: number;
        totalAns: number;
        x: number;
        initScore: number;
        finScore: number;
      }
    > = {};
    const answersByAssign = new Map<string, any[]>();

    dedupAnsMap.forEach((ans) => {
      const aId = String(ans.exam_assignment_id);
      if (!answersByAssign.has(aId)) answersByAssign.set(aId, []);
      answersByAssign.get(aId)!.push(ans);

      if (!ans.grading_code) return;
      if (!assignCounts[aId]) {
        assignCounts[aId] = { o: 0, ro: 0, to: 0, totalAns: 0, x: 0, initScore: 0, finScore: 0 };
      }
      const c = assignCounts[aId];
      c.totalAns++;
      const exId = assignToExamMap.get(ans.exam_assignment_id) || "";
      const cfg = examScoreConfigMap.get(exId);
      const qScore = cfg?.scoreByQuestionId.get(String(ans.question_id)) ?? cfg?.defaultScore ?? 5;

      if (ans.grading_code === "O") {
        c.o++;
        c.initScore += qScore;
      } else if (ans.grading_code === "RO") {
        c.ro++;
      } else if (ans.grading_code === "TO") {
        c.to++;
      } else if (["X", "TX"].includes(ans.grading_code)) {
        c.x++;
      }
      c.finScore += calcScoreRatio(ans.grading_code, qScore, gcMeta, false).newEarned;
    });

    const examScoreMap = new Map<string, { initSum: number; finSum: number; count: number }>();
    (allAssignmentsForExams || []).forEach((a: any) => {
      const counts = assignCounts[String(a.assignment_id)];
      if (!counts || counts.totalAns === 0) return;

      const initScore = roundScore(counts.initScore);
      const finScore = roundScore(counts.finScore);
      const exKey = String(a.exam_id);
      if (!examScoreMap.has(exKey)) {
        examScoreMap.set(exKey, { initSum: 0, finSum: 0, count: 0 });
      }
      const avgData = examScoreMap.get(exKey)!;
      avgData.initSum += initScore;
      avgData.finSum += finScore;
      avgData.count += 1;
    });

    const examResultsBySubTab: Record<PortalTestSubTabId, any[]> = {
      weekly: [],
      weekly_incorrect: [],
      midterm: [],
      quarterly: [],
    };
    const validCategorized: { assign: any; master: any; subTab: PortalTestSubTabId }[] = [];

    categorized.forEach(({ assign, master, subTab }) => {
      const aIdStr = String(assign.assignment_id);
      const counts = assignCounts[aIdStr] || {
        o: 0,
        ro: 0,
        to: 0,
        totalAns: 0,
        x: 0,
        initScore: 0,
        finScore: 0,
      };
      if (
        ["진행중", "응시중"].includes(String(assign.status || "").trim()) &&
        counts.totalAns === 0 &&
        !(Number(assign.total_score) > 0)
      ) {
        return;
      }

      validCategorized.push({ assign, master, subTab });

      const originalScore =
        counts.totalAns > 0 ? roundScore(counts.initScore) : roundScore(assign.total_score || 0);
      const finalScore =
        counts.totalAns > 0 ? roundScore(counts.finScore) : roundScore(assign.total_score || 0);

      const exKey = String(assign.exam_id);
      const avgData = examScoreMap.get(exKey);
      const classInitAvg =
        avgData && avgData.count > 0 ? roundScore(avgData.initSum / avgData.count) : originalScore;
      const classFinAvg =
        avgData && avgData.count > 0 ? roundScore(avgData.finSum / avgData.count) : finalScore;

      const rawTitle =
        master?.title ||
        (subTab === "weekly"
          ? "주간테스트"
          : subTab === "weekly_incorrect"
          ? "주차별 오답"
          : subTab === "midterm"
          ? "중간평가"
          : "분기평가");
      const cleanTitle = stripPortalStudentPrefix(rawTitle, studentName) || rawTitle;
      const weekNum = extractPortalWeekNumber(cleanTitle, master?.sub_title);
      const cfg = examScoreConfigMap.get(exKey);
      const effectiveDate = master?.exam_date || assign.created_at;

      examResultsBySubTab[subTab].push({
        assignment_id: assign.assignment_id,
        exam_id: assign.exam_id,
        class_id: assign.class_id || null,
        subTab,
        exam_type: master?.exam_type || "",
        title: cleanTitle,
        sub_title: master?.sub_title || "",
        major_grade:
          master?.major_grade && master.major_grade !== "공통 과정" ? master.major_grade : "",
        week_num: weekNum,
        main_question_count: cfg?.groupCount || master?.total_questions || 0,
        total_item_count: cfg?.totalItems || master?.total_questions || 0,
        original_score: originalScore,
        final_score: finalScore,
        oCount: counts.o,
        roCount: counts.ro,
        toCount: counts.to,
        xCount: counts.x,
        class_init_avg: classInitAvg,
        class_fin_avg: classFinAvg,
        exam_date: master?.exam_date || null,
        effective_date: effectiveDate,
        created_at: assign.created_at,
      });
    });

    (Object.keys(examResultsBySubTab) as PortalTestSubTabId[]).forEach((k) => {
      examResultsBySubTab[k].sort(
        (a, b) =>
          new Date(b.effective_date || b.created_at).getTime() -
          new Date(a.effective_date || a.created_at).getTime()
      );
    });

    // 4단계: 주간·주차별오답 최근 2개월 단원분석(최대 8개) + 중간·분기평가 리포트용 문항 DB 일괄 조회
    const twoMonthsCutoff = new Date();
    twoMonthsCutoff.setMonth(twoMonthsCutoff.getMonth() - 2);
    twoMonthsCutoff.setHours(0, 0, 0, 0);
    const cutoffMs = twoMonthsCutoff.getTime();

    const recentWeeklyAssignIds = examResultsBySubTab.weekly
      .filter((r) => new Date(r.effective_date || r.created_at).getTime() >= cutoffMs)
      .map((r) => String(r.assignment_id));
    const recentIncorrectAssignIds = examResultsBySubTab.weekly_incorrect
      .filter((r) => new Date(r.effective_date || r.created_at).getTime() >= cutoffMs)
      .map((r) => String(r.assignment_id));

    const periodicCategorized = validCategorized.filter(
      (c) => c.subTab === "midterm" || c.subTab === "quarterly"
    );

    const neededQIdSet = new Set<string>();
    [...recentWeeklyAssignIds, ...recentIncorrectAssignIds].forEach((aId) => {
      (answersByAssign.get(aId) || []).forEach((ans) => {
        if (ans.question_id) neededQIdSet.add(String(ans.question_id));
      });
    });
    periodicCategorized.forEach(({ assign }) => {
      (itemsByExam.get(String(assign.exam_id)) || []).forEach((it) => {
        if (it.question_id) neededQIdSet.add(String(it.question_id));
      });
    });

    const allNeededQIds = Array.from(neededQIdSet);
    const uuidQIds = allNeededQIds.filter((id) => id.includes("-"));
    const numQIds = allNeededQIds
      .filter((id) => !id.includes("-") && !isNaN(Number(id)))
      .map(Number);

    const fetchedQuestions: any[] = [];
    for (let i = 0; i < uuidQIds.length; i += 200) {
      const chunk = uuidQIds.slice(i, i + 200);
      const { data: qRows, error: qErr } = await supabaseAdmin
        .from("question_db")
        .select(
          "question_id, item_id, parent_question_id, question_number, sub_num, pdf_source, detected_page_num, final_printed_page, book_name, source_book_name, taxonomy_id, taxonomy_name, sub_taxonomy_id, thk_taxonomy_id, thk_taxonomy_name, difficulty, solving_probability"
        )
        .in("question_id", chunk);
      if (!qErr && qRows) {
        fetchedQuestions.push(...qRows);
      } else {
        const { data: fbRows } = await supabaseAdmin
          .from("question_db")
          .select("*")
          .in("question_id", chunk);
        if (fbRows) fetchedQuestions.push(...fbRows);
      }
    }

    const foundUuidSet = new Set(fetchedQuestions.map((q) => String(q.question_id)));
    const missingUuids = uuidQIds.filter((id) => !foundUuidSet.has(id));
    if (missingUuids.length > 0) {
      const { data: tqUuids } = await supabaseAdmin
        .from("textbook_question")
        .select("*")
        .in("question_id", missingUuids);
      if (tqUuids) fetchedQuestions.push(...tqUuids);
    }
    if (numQIds.length > 0) {
      const { data: tqNums } = await supabaseAdmin
        .from("textbook_question")
        .select("*")
        .in("tq_id", numQIds);
      if (tqNums) fetchedQuestions.push(...tqNums);
    }

    const qMap: Record<string, any> = {};
    fetchedQuestions.forEach((q) => {
      if (q.question_id) qMap[String(q.question_id)] = q;
      if (q.tq_id) qMap[String(q.tq_id)] = q;
    });

    // master_item · master_category · taxonomy_competency · thinking_category 조회
    const rawTaxTokens = Array.from(
      new Set(
        fetchedQuestions
          .flatMap((q) => [q.item_id, q.taxonomy_id, q.sub_taxonomy_id])
          .filter((v) => v && v !== "미분류" && v !== "NULL" && v !== "UNDEFINED")
          .map((v) => String(v).trim())
      )
    );

    const itemToCatId = new Map<string, string>();
    const catIdsToFetch = new Set<string>();
    const prefixSetForFallback = new Set<string>();

    for (let i = 0; i < rawTaxTokens.length; i += 200) {
      const chunk = rawTaxTokens.slice(i, i + 200);
      const { data: mItems } = await supabaseAdmin
        .from("master_item")
        .select("item_id, category_id")
        .in("item_id", chunk);
      (mItems || []).forEach((mi: any) => {
        if (mi.item_id && mi.category_id) {
          const iKey = String(mi.item_id).trim();
          const cKey = String(mi.category_id).trim();
          itemToCatId.set(iKey, cKey);
          catIdsToFetch.add(cKey);
        }
      });
      chunk.forEach((tok) => {
        if (!itemToCatId.has(tok)) {
          const parts = tok.split("-");
          if (parts.length >= 6 || (parts.length >= 4 && /^\d{3}$/.test(parts[parts.length - 1]))) {
            const parentCat = parts.slice(0, -1).join("-");
            itemToCatId.set(tok, parentCat);
            catIdsToFetch.add(parentCat);
          }
          catIdsToFetch.add(tok);
          if (parts.length >= 2) {
            prefixSetForFallback.add(parts.slice(0, 2).join("-"));
          }
        }
      });
    }

    fetchedQuestions.forEach((q) => {
      if (q.thk_taxonomy_id) catIdsToFetch.add(String(q.thk_taxonomy_id).trim());
    });

    const catIdsArr = Array.from(catIdsToFetch);
    const catByIdMap = new Map<string, any>();
    const compByCatIdMap = new Map<
      string,
      { primary: PortalCompetencyKey | null; secondary: PortalCompetencyKey | null }
    >();

    for (let i = 0; i < catIdsArr.length; i += 200) {
      const chunk = catIdsArr.slice(i, i + 200);
      const [catRes, compRes] = await Promise.all([
        supabaseAdmin
          .from("master_category")
          .select("category_id, depth1, depth2, depth3, depth4, depth5, depth6, depth7")
          .in("category_id", chunk),
        supabaseAdmin
          .from("taxonomy_competency")
          .select("category_id, status, final_primary, ai_primary, final_secondary, ai_secondary")
          .in("category_id", chunk),
      ]);

      (catRes.data || []).forEach((raw: any) => {
        const norm = normalizeMasterCategoryRow(raw);
        if (norm?.category_id) {
          const cid = String(norm.category_id).trim();
          catByIdMap.set(cid, norm);
          catByIdMap.set(cid.toUpperCase(), norm);
        }
      });

      (compRes.data || []).forEach((row: any) => {
        if (!row?.category_id) return;
        const pair = extractPortalCompetencyPair(row);
        if (pair.primary || pair.secondary) {
          const cid = String(row.category_id).trim();
          compByCatIdMap.set(cid, pair);
          compByCatIdMap.set(cid.toUpperCase(), pair);
        }
      });
    }

    // 상위 prefix 폴백 (단원명 및 교과역량)
    const unresolvedCatPrefixes = Array.from(
      new Set([
        ...Array.from(prefixSetForFallback),
        ...catIdsArr
          .filter((cid) => !cid.startsWith("THK-") && (!catByIdMap.has(cid) || !compByCatIdMap.has(cid)))
          .map((cid) => cid.split("-").slice(0, 3).join("-"))
          .filter((p) => p.length >= 6),
      ])
    );

    const prefixFallbackUnitName = new Map<string, string>();
    if (unresolvedCatPrefixes.length > 0) {
      await Promise.all(
        unresolvedCatPrefixes.slice(0, 40).map(async (prefix) => {
          try {
            const [{ data: fbCats }, { data: fbComps }] = await Promise.all([
              supabaseAdmin
                .from("master_category")
                .select("category_id, depth3, depth4")
                .like("category_id", `${prefix}%`)
                .limit(1),
              supabaseAdmin
                .from("taxonomy_competency")
                .select("category_id, status, final_primary, ai_primary, final_secondary, ai_secondary")
                .like("category_id", `${prefix}%`)
                .limit(1),
            ]);
            if (fbCats && fbCats.length > 0) {
              const norm = normalizeMasterCategoryRow(fbCats[0]);
              if (norm.depth4 || norm.depth3) {
                prefixFallbackUnitName.set(prefix, norm.depth4 || norm.depth3);
                prefixFallbackUnitName.set(prefix.toUpperCase(), norm.depth4 || norm.depth3);
              }
              catIdsArr
                .filter((u) => u.startsWith(prefix) && !catByIdMap.has(u))
                .forEach((u) => catByIdMap.set(u, norm));
            }
            if (fbComps && fbComps.length > 0) {
              const pair = extractPortalCompetencyPair(fbComps[0]);
              if (pair.primary || pair.secondary) {
                catIdsArr
                  .filter((u) => u.startsWith(prefix) && !compByCatIdMap.has(u))
                  .forEach((u) => compByCatIdMap.set(u, pair));
              }
            }
          } catch {}
        })
      );
    }

    // 사고력 분류 로드
    const thinkingMap = new Map<string, ThinkingCategoryItem>();
    THINKING_CATEGORIES.forEach((tc) => thinkingMap.set(tc.category_id, tc));
    if (periodicCategorized.length > 0) {
      try {
        const { data: thkRows } = await supabaseAdmin
          .from("thinking_category")
          .select("category_id, depth1, depth2, depth3, full_path");
        (thkRows || []).forEach((r: any) => {
          if (r?.category_id && r?.depth1) {
            thinkingMap.set(String(r.category_id).trim(), {
              category_id: String(r.category_id).trim(),
              depth1: String(r.depth1).trim(),
              depth2: String(r.depth2 || "").trim(),
              depth3: String(r.depth3 || "").trim(),
              full_path: String(r.full_path || "").trim(),
            });
          }
        });
      } catch {}
    }

    const resolveQuestionCatId = (q: any): string => {
      const cands = [q?.item_id, q?.taxonomy_id, q?.sub_taxonomy_id]
        .filter((v) => v && v !== "미분류")
        .map((v) => String(v).trim());
      for (const c of cands) {
        if (itemToCatId.has(c)) return itemToCatId.get(c)!;
        if (itemToCatId.has(c.toUpperCase())) return itemToCatId.get(c.toUpperCase())!;
      }
      return cands[0] || "";
    };

    // 4-A: 주간테스트 & 주차별 오답 최근 2개월 상위 최대 8개 단원 성취도 구축
    const resolveUnitForRadar = (qId: string): { key: string; name: string } | null => {
      const q = qMap[qId];
      if (!q) return null;
      const cid = resolveQuestionCatId(q);
      if (!cid) return null;
      const cat = catByIdMap.get(cid) || catByIdMap.get(cid.toUpperCase());
      if (cat) {
        const unitName = String(cat.depth4 || cat.depth3 || cat.depth2 || "").trim();
        if (unitName) {
          return {
            key: `${cat.depth1 || ""}|${cat.depth2 || ""}|${unitName}`,
            name: unitName,
          };
        }
      }
      const parts = cid.split("-");
      const p2 = parts.length >= 2 ? parts.slice(0, 2).join("-") : cid;
      const fbName = prefixFallbackUnitName.get(p2) || prefixFallbackUnitName.get(p2.toUpperCase());
      if (fbName) return { key: p2, name: fbName };
      return null;
    };

    const buildTop8Units = (assignIds: string[]) => {
      const agg = new Map<
        string,
        { code: string; name: string; total: number; initCorrect: number; finCorrect: number }
      >();
      assignIds.forEach((aId) => {
        (answersByAssign.get(aId) || []).forEach((a) => {
          const u = resolveUnitForRadar(String(a.question_id));
          if (!u) return;
          if (!agg.has(u.key)) {
            agg.set(u.key, {
              code: u.key,
              name: u.name,
              total: 0,
              initCorrect: 0,
              finCorrect: 0,
            });
          }
          const obj = agg.get(u.key)!;
          obj.total += 1;
          if (a.grading_code === "O") {
            obj.initCorrect += 1;
            obj.finCorrect += 1;
          } else if (a.grading_code === "RO" || a.grading_code === "TO") {
            obj.finCorrect += 1;
          } else if (!a.grading_code && a.is_correct) {
            obj.initCorrect += 1;
            obj.finCorrect += 1;
          }
        });
      });

      return Array.from(agg.values())
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko"))
        .slice(0, 8)
        .map((d) => ({
          ...d,
          initial_rate: d.total > 0 ? Math.round((d.initCorrect / d.total) * 100) : 0,
          final_rate: d.total > 0 ? Math.round((d.finCorrect / d.total) * 100) : 0,
        }));
    };

    const categoryAnalysisBySubTab = {
      weekly: buildTop8Units(recentWeeklyAssignIds),
      weekly_incorrect: buildTop8Units(recentIncorrectAssignIds),
    };

    // 4-B: 중간평가 & 분기평가 모바일 성적 분석 리포트 구축
    const periodicReportsBySubTab: { midterm: any[]; quarterly: any[] } = {
      midterm: [],
      quarterly: [],
    };

    periodicCategorized.forEach(({ assign, master, subTab }) => {
      if (subTab !== "midterm" && subTab !== "quarterly") return;
      const examPaperId = String(assign.exam_id);
      const rawItems = [...(itemsByExam.get(examPaperId) || [])].sort(
        (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
      );
      if (rawItems.length === 0) return;

      const expectedMainCount = subTab === "quarterly" ? 30 : 20;
      const hideQuestionPoints = subTab === "midterm";

      const mergedArrays = extractMergedQuestionGroups(master?.layout_settings);
      const customGroupMap = new Map<string, string>();
      mergedArrays.forEach((arr, idx) => {
        const gId = `custom_group_${idx}`;
        arr.forEach((qid) => customGroupMap.set(String(qid), gId));
      });

      const examQIdSet = new Set(rawItems.map((it) => String(it.question_id)));
      const parentCountMap = new Map<string, number>();
      rawItems.forEach((it) => {
        const q = qMap[String(it.question_id)] || {};
        const pId = String(q.parent_question_id || q.parent_tq_id || "").trim();
        if (pId && pId !== "null") {
          parentCountMap.set(pId, (parentCountMap.get(pId) || 0) + 1);
        }
      });

      const buildExamGroups = (allowSourcePageMerge: boolean) => {
        const gm = new Map<string, { id: string; sort_order: number; items: any[] }>();
        const list: { id: string; sort_order: number; items: any[] }[] = [];

        rawItems.forEach((item, idx) => {
          const qidStr = String(item.question_id);
          const q = qMap[qidStr] || {};
          let gId = customGroupMap.get(qidStr) || "";

          if (!gId) {
            const pId = String(q.parent_question_id || q.parent_tq_id || "").trim();
            if (
              pId &&
              pId !== "null" &&
              (examQIdSet.has(pId) || (parentCountMap.get(pId) || 0) > 1)
            ) {
              gId = `parent_${pId}`;
            } else if (examQIdSet.has(qidStr) && (parentCountMap.get(qidStr) || 0) >= 1) {
              gId = `parent_${qidStr}`;
            }
          }

          if (!gId && allowSourcePageMerge) {
            const src = String(q.pdf_source || "").trim();
            const page = String(q.detected_page_num || q.final_printed_page || "").trim();
            const baseNumMatch = String(q.question_number || "").match(/\d+/);
            if (src && page && baseNumMatch) {
              gId = `src_${src}_${page}_${baseNumMatch[0]}`;
            }
          }

          if (!gId) gId = `single_${qidStr}_${idx}`;

          if (!gm.has(gId)) {
            const newG = { id: gId, sort_order: Number(item.sort_order) || idx, items: [] as any[] };
            gm.set(gId, newG);
            list.push(newG);
          }
          gm.get(gId)!.items.push({
            sort_order: Number(item.sort_order) || idx,
            assigned_score: item.assigned_score,
            question_id: qidStr,
            question: q,
          });
        });

        list.forEach((g) => {
          g.sort_order = Math.min(...g.items.map((i) => i.sort_order));
        });
        list.sort((a, b) => a.sort_order - b.sort_order);
        return list;
      };

      let groups = buildExamGroups(false);
      if (mergedArrays.length === 0 && groups.length > expectedMainCount) {
        const fbGroups = buildExamGroups(true);
        if (fbGroups.length >= Math.min(10, expectedMainCount)) {
          groups = fbGroups;
        }
      }

      const groupCount = groups.length || 1;
      const baseGroupScore = 100 / groupCount;
      const isWeightedExam =
        subTab === "quarterly" ||
        Boolean(
          master?.exam_type &&
            (master.exam_type.includes("분기평가") || master.exam_type.includes("분기테스트"))
        );

      const explicitMaxes = groups.map((g) =>
        Math.max(...g.items.map((i: any) => parseFloat(i.assigned_score) || 0))
      );
      const useExplicitGroupMax =
        isWeightedExam && explicitMaxes.reduce((acc, v) => acc + v, 0) > 0;

      const groupConfigs = groups.map((g, idx) => {
        const gMax = useExplicitGroupMax && explicitMaxes[idx] > 0 ? explicitMaxes[idx] : baseGroupScore;
        const subScore = gMax / (g.items.length || 1);
        return { ...g, qNum: idx + 1, maxScore: gMax, subScore };
      });

      const scoreAssignOriginal = (aIdStr: string) => {
        const ansRows = answersByAssign.get(aIdStr) || [];
        const ansByQId = new Map<string, any>();
        ansRows.forEach((r) => ansByQId.set(String(r.question_id), r));

        let initTotal = 0;
        const perGroup: number[] = [];

        groupConfigs.forEach((g) => {
          let gInit = 0;
          g.items.forEach((it: any) => {
            const ans = ansByQId.get(String(it.question_id));
            if (!ans) return;
            const code = ans.grading_code ? String(ans.grading_code).trim() : "";
            if (code) {
              if (code === "O") gInit += g.subScore;
              else if (["a", "b", "c", "q"].includes(code)) {
                gInit += calcScoreRatio(code, g.subScore, gcMeta, subTab === "quarterly").newEarned;
              }
            } else if (ans.is_correct === true) {
              gInit += g.subScore;
            }
          });
          gInit = Math.min(g.maxScore, gInit);
          initTotal += gInit;
          perGroup.push(gInit);
        });

        return { hasGraded: ansByQId.size > 0, initTotal, perGroup };
      };

      const targetAId = String(assign.assignment_id);
      const myScored = scoreAssignOriginal(targetAId);

      // 동일 시험지 응시 코호트 (테스트 계정 제외)
      const sameExamAssigns = (allAssignmentsForExams || []).filter(
        (a: any) => String(a.exam_id) === examPaperId
      );
      let cohortCandidates = sameExamAssigns.filter((a: any) => {
        const st = Array.isArray(a.student) ? a.student[0] : a.student;
        const nm = String(st?.name || "").trim();
        if (!nm || nm.includes("테스트") || nm.toLowerCase().includes("test")) return false;
        return true;
      });
      if (cohortCandidates.length === 0) cohortCandidates = sameExamAssigns;

      const cohortIdSet = new Set(cohortCandidates.map((a: any) => String(a.assignment_id)));
      if (cohortIdSet.size === 0) cohortIdSet.add(targetAId);

      let validSampleCount = 0;
      let cohortInitSum = 0;
      const cohortGroupInitSum = new Array(groupConfigs.length).fill(0);

      cohortIdSet.forEach((cidStr) => {
        const sc = scoreAssignOriginal(cidStr);
        if (!sc.hasGraded) return;
        validSampleCount += 1;
        cohortInitSum += roundScore(sc.initTotal);
        sc.perGroup.forEach((val, idx) => {
          cohortGroupInitSum[idx] += val;
        });
      });

      const initTotalScore = myScored.hasGraded
        ? roundScore(myScored.initTotal)
        : roundScore(assign.total_score || 0);
      const cohortAvgInit =
        validSampleCount > 0 ? roundScore(cohortInitSum / validSampleCount) : initTotalScore;

      let fullCorrectCount = 0;
      let partialCount = 0;
      let wrongCount = 0;

      const questions = groupConfigs.map((g, idx) => {
        const gInit = myScored.perGroup[idx] ?? 0;
        const cohortAvgEarned =
          validSampleCount > 0 ? cohortGroupInitSum[idx] / validSampleCount : gInit;
        const cohortAccPct =
          validSampleCount > 0 && g.maxScore > 0
            ? Math.round((cohortAvgEarned / g.maxScore) * 100)
            : null;

        let status: "O" | "TRI" | "X" = "X";
        if (gInit >= g.maxScore - 0.05 && g.maxScore > 0) {
          status = "O";
          fullCorrectCount += 1;
        } else if (gInit > 0) {
          status = "TRI";
          partialCount += 1;
        } else {
          wrongCount += 1;
        }

        // 주·보조 교과역량 추출
        const compList: PortalCompetencyKey[] = [];
        const pushComp = (v: PortalCompetencyKey | null | undefined) => {
          if (v && !compList.includes(v)) compList.push(v);
        };
        for (const it of g.items) {
          const q = it.question || {};
          const cid = resolveQuestionCatId(q);
          if (cid) {
            const c = compByCatIdMap.get(cid) || compByCatIdMap.get(cid.toUpperCase());
            if (c) {
              pushComp(c.primary);
              pushComp(c.secondary);
            }
          }
          const thkCid = String(q.thk_taxonomy_id || "").trim();
          if (thkCid && compByCatIdMap.has(thkCid)) {
            const c = compByCatIdMap.get(thkCid)!;
            pushComp(c.primary);
            pushComp(c.secondary);
          }
          if (compList.length >= 2) break;
        }

        const primaryItem =
          g.items.find(
            (it: any) =>
              it.question?.item_id ||
              it.question?.taxonomy_id ||
              it.question?.thk_taxonomy_id ||
              it.question?.taxonomy_name ||
              it.question?.thk_taxonomy_name
          ) || g.items[0];
        const pq = primaryItem?.question || {};
        const rawDiff = String(pq.difficulty || "").trim();
        const cid = resolveQuestionCatId(pq);
        const cat = cid ? catByIdMap.get(cid) || catByIdMap.get(cid.toUpperCase()) : null;
        const thk = pq.thk_taxonomy_id
          ? thinkingMap.get(String(pq.thk_taxonomy_id).trim())
          : null;

        let unitName = "";
        let detailTopic = "";
        if (cat) {
          unitName = stripPortalLeadingIndex(cat.depth4 || cat.depth3 || cat.depth2 || "");
          detailTopic = stripPortalLeadingIndex(cat.depth6 || cat.depth5 || unitName);
        } else if (thk) {
          unitName = thk.depth1;
          detailTopic = thk.depth3 || thk.depth2 || thk.depth1;
        }

        const competencies: PortalCompetencyKey[] =
          compList.length > 0
            ? compList.slice(0, 2)
            : inferPortalFallbackCompetencies(
                `${unitName} ${detailTopic} ${pq.thk_taxonomy_name || ""} ${pq.taxonomy_name || ""}`
              );

        // 문항 전체 정답률(solving_probability) 산출
        const dbProbs = g.items
          .map((it: any) => Number(it.question?.solving_probability))
          .filter((v: number) => Number.isFinite(v) && v > 0 && v <= 100);

        let questionAccPct = 50;
        if (dbProbs.length > 0) {
          questionAccPct = Math.max(
            1,
            Math.min(
              99,
              Math.round(dbProbs.reduce((acc: number, v: number) => acc + v, 0) / dbProbs.length)
            )
          );
        } else if (validSampleCount >= 3 && cohortAccPct !== null) {
          questionAccPct = Math.max(1, Math.min(99, cohortAccPct));
        } else {
          const d = rawDiff.replace(/\s+/g, "");
          if (["최하", "1", "Lv.1", "Lv1"].includes(d)) questionAccPct = 85;
          else if (["하", "2", "Lv.2", "Lv2"].includes(d)) questionAccPct = 72;
          else if (d === "중하") questionAccPct = 62;
          else if (["중", "3", "Lv.3", "Lv3"].includes(d)) questionAccPct = 50;
          else if (["중상", "4", "Lv.4", "Lv4"].includes(d)) {
            questionAccPct = useExplicitGroupMax && g.maxScore >= 4.5 ? 32 : 42;
          } else if (d === "상") questionAccPct = 30;
          else if (["최상", "5", "Lv.5", "Lv5"].includes(d)) questionAccPct = 20;
          else if (useExplicitGroupMax && g.maxScore <= 2.5) questionAccPct = 80;
          else if (useExplicitGroupMax && g.maxScore >= 4.5) questionAccPct = 28;
        }

        let diffTier: PortalDiffTierKey = "MID";
        if (questionAccPct >= 70) diffTier = "BASIC";
        else if (questionAccPct < 40) diffTier = "KILLER";

        return {
          qNum: g.qNum,
          subCount: g.items.length,
          maxScore: roundScore(g.maxScore),
          initEarned: roundScore(gInit),
          cohortAvgEarned,
          questionAccPct,
          status,
          competencies,
          diffTier,
        };
      });

      const compRows = PORTAL_COMPETENCY_ORDER.map((compName) => {
        const qs = questions.filter((q) => q.competencies.includes(compName));
        const maxS = qs.reduce((acc, q) => acc + q.maxScore, 0);
        const initS = qs.reduce((acc, q) => acc + q.initEarned, 0);
        const cohS = qs.reduce((acc, q) => acc + q.cohortAvgEarned, 0);
        return {
          name: compName,
          qCount: qs.length,
          maxScore: roundScore(maxS),
          initEarned: roundScore(initS),
          cohortAvg: roundScore(cohS),
          initPct: maxS > 0 ? Math.round((initS / maxS) * 100) : null,
          cohortPct: maxS > 0 ? Math.round((cohS / maxS) * 100) : null,
        };
      });

      const tierDefs: { key: PortalDiffTierKey; label: string; axisRange: string }[] = [
        { key: "BASIC", label: "핵심 기본", axisRange: "(70%↑)" },
        { key: "MID", label: "중급 응용", axisRange: "(40~69%)" },
        { key: "KILLER", label: "고난도 심화", axisRange: "(40%↓)" },
      ];

      const diffRows = tierDefs.map((tm) => {
        const qs = questions.filter((q) => q.diffTier === tm.key);
        const maxS = qs.reduce((s, q) => s + q.maxScore, 0);
        const initS = qs.reduce((s, q) => s + q.initEarned, 0);
        const cohS = qs.reduce((s, q) => s + q.cohortAvgEarned, 0);
        return {
          key: tm.key,
          label: tm.label,
          axisRange: tm.axisRange,
          qCount: qs.length,
          maxScore: roundScore(maxS),
          initEarned: roundScore(initS),
          cohortAvg: roundScore(cohS),
          initPct: maxS > 0 ? Math.round((initS / maxS) * 100) : 0,
          cohortPct: maxS > 0 ? Math.round((cohS / maxS) * 100) : 0,
        };
      });

      const hasKillerQuestions = questions.some((q) => q.diffTier === "KILLER");
      const mistakeQuestions = questions
        .filter((q) => q.diffTier === "BASIC" && q.status !== "O")
        .sort((a, b) => b.questionAccPct - a.questionAccPct || a.qNum - b.qNum)
        .slice(0, 5)
        .map((q) => ({ qNum: q.qNum, questionAccPct: q.questionAccPct }));
      const killerSolvedQuestions = questions
        .filter((q) => q.diffTier === "KILLER" && q.status === "O")
        .sort((a, b) => a.questionAccPct - b.questionAccPct || a.qNum - b.qNum)
        .slice(0, 5)
        .map((q) => ({ qNum: q.qNum, questionAccPct: q.questionAccPct }));

      const rawTitle = master?.title || (subTab === "quarterly" ? "분기평가" : "중간평가");
      const cleanTitle = stripPortalStudentPrefix(rawTitle, studentName) || rawTitle;
      const courseBadge =
        master?.sub_title ||
        (master?.major_grade && master.major_grade !== "공통 과정"
          ? master.major_grade
          : "") ||
        (subTab === "quarterly" ? "분기평가" : "중간평가");

      periodicReportsBySubTab[subTab].push({
        assignment_id: assign.assignment_id,
        exam_id: assign.exam_id,
        subTab,
        evalKindLabel: subTab === "quarterly" ? "분기평가" : "중간평가",
        hideQuestionPoints,
        title: cleanTitle,
        courseBadge,
        effective_date: master?.exam_date || assign.created_at,
        created_at: assign.created_at,
        totalMainQuestions: questions.length,
        totalSubItems: rawItems.length,
        initTotalScore,
        cohortAvgInit,
        cohortSampleCount: validSampleCount,
        fullCorrectCount,
        partialCount,
        wrongCount,
        questions: questions.map(({ cohortAvgEarned: _omit, ...rest }) => rest),
        compRows,
        diffRows,
        hasKillerQuestions,
        mistakeQuestions,
        killerSolvedQuestions,
      });
    });

    (["midterm", "quarterly"] as const).forEach((k) => {
      periodicReportsBySubTab[k].sort(
        (a, b) =>
          new Date(b.effective_date || b.created_at).getTime() -
          new Date(a.effective_date || a.created_at).getTime()
      );
    });

    return {
      success: true,
      examResultsBySubTab,
      categoryAnalysisBySubTab,
      periodicReportsBySubTab,
      mainTextbooks,
      schoolExams: schoolExams || [],
    };
  } catch (err: any) {
    console.error("[getStudentPortalExamDataAction]", err);
    return emptyPayload;
  }
}
