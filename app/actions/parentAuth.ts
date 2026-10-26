// src/app/actions/parentAuth.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { phoneVariants } from "@/lib/normalize";

type ParentPwCol = "password_hash" | "password_hash_2" | "password_hash_3";
type ParentNameCol = "name" | "name_2" | "name_3";

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

  const pwCol: ParentPwCol =
    slot === 1 ? "password_hash" : slot === 2 ? "password_hash_2" : "password_hash_3";
  const nameCol: ParentNameCol =
    slot === 1 ? "name" : slot === 2 ? "name_2" : "name_3";

  return {
    parent,
    slot,
    pwCol,
    nameCol,
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