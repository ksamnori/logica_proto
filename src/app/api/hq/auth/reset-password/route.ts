// src/app/api/hq/auth/reset-password/route.ts
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { SolapiMessageService } from "solapi";
import {
  appendHqAuditLog,
  readLoginAttemptRecords,
  writeLoginAttemptRecords,
} from "@/lib/hq/auditLogServer";
import { FALLBACK_HQ_TENANT_ID } from "@/lib/hq/constants";
import { readHqKvPayload, writeHqKvPayload } from "@/lib/hq/hqKvStoreServer";
import { apiFail, getSupabaseAdmin } from "@/lib/hq/serverAuth";

export const runtime = "nodejs";

const PW_RESET_KV_KEY = "hq_pw_reset_codes_v1";
const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 45 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

interface StoredResetCodeEntry {
  userId: string;
  userName: string;
  authEmail: string;
  department: string;
  phone: string;
  codeHash: string;
  expiresAt: number;
  sentAt: number;
  attempts: number;
}

type ResetCodeStoreMap = Record<string, StoredResetCodeEntry>;

function hashResetCode(phone: string, code: string): string {
  return crypto
    .createHash("sha256")
    .update(`hq-pw-reset:${phone}:${code}`)
    .digest("hex");
}

function maskPhone(cleanPhone: string): string {
  if (cleanPhone.length === 11) {
    return `${cleanPhone.slice(0, 3)}-****-${cleanPhone.slice(7)}`;
  }
  if (cleanPhone.length === 10) {
    return `${cleanPhone.slice(0, 3)}-***-${cleanPhone.slice(6)}`;
  }
  return cleanPhone;
}

interface InstructorLite {
  instructor_id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  role?: string | null;
  position?: string | null;
  department?: string | null;
  tenant_id?: string | null;
  status?: string | null;
}

interface TenantLite {
  tenant_id: string;
  name?: string | null;
  tenant_type?: string | null;
}

async function loadHqEligibleInstructors(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>
): Promise<InstructorLite[]> {
  const [tenantRes, instRes] = await Promise.all([
    supabaseAdmin.from("academy_tenant").select("tenant_id, name, tenant_type"),
    supabaseAdmin
      .from("instructor")
      .select(
        "instructor_id, name, phone, email, role, position, department, tenant_id, status"
      ),
  ]);

  const hqTenantIds = new Set<string>([FALLBACK_HQ_TENANT_ID]);
  ((tenantRes.data || []) as TenantLite[]).forEach((t) => {
    if (
      String(t.tenant_type || "").toUpperCase() === "HQ" ||
      String(t.name || "").includes("본사")
    ) {
      hqTenantIds.add(String(t.tenant_id));
    }
  });

  return ((instRes.data || []) as InstructorLite[]).filter((inst) => {
    const st = String(inst.status || "");
    if (st === "퇴사" || st === "퇴직") return false;
    const tId = String(inst.tenant_id || "");
    const posStr = String(inst.position || "");
    const isSuper =
      String(inst.role || "").toUpperCase() === "SUPER_ADMIN" ||
      posStr.includes("최고관리자") ||
      posStr.includes("대장");
    return hqTenantIds.has(tId) || isSuper;
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const supabaseAdmin = getSupabaseAdmin();

    // -----------------------------------------------------------------------
    // 1. 이메일 재설정 링크 발송 전 본부 계정 확인
    // -----------------------------------------------------------------------
    if (action === "CHECK_EMAIL_TARGET") {
      const rawEmail = String(body?.email || "")
        .trim()
        .toLowerCase();
      if (!rawEmail || !rawEmail.includes("@")) {
        return apiFail("올바른 이메일 주소를 입력해 주세요.", 400);
      }
      if (rawEmail.endsWith("@logica.com")) {
        return NextResponse.json(
          {
            success: false,
            useSmsInstead: true,
            error:
              "휴대폰 번호로 가입된 계정(@logica.com 가상메일)은 이메일 수신이 불가합니다. 상단의 [휴대폰 문자 인증] 탭에서 즉시 비밀번호를 재설정해 주세요.",
          },
          { status: 400 }
        );
      }

      const hqList = await loadHqEligibleInstructors(supabaseAdmin);
      const matchedByInst = hqList.find(
        (m) => String(m.email || "").trim().toLowerCase() === rawEmail
      );

      if (matchedByInst) {
        const { data: authRes } = await supabaseAdmin.auth.admin.getUserById(
          matchedByInst.instructor_id
        );
        const authEmail = String(authRes?.user?.email || "")
          .trim()
          .toLowerCase();

        if (authEmail.endsWith("@logica.com")) {
          return NextResponse.json(
            {
              success: false,
              useSmsInstead: true,
              error:
                "해당 계정은 휴대폰 번호 기반으로 생성되어 있습니다. 상단의 [휴대폰 문자 인증] 탭에서 인증번호를 받아 새 비밀번호를 설정해 주세요.",
            },
            { status: 400 }
          );
        }
        if (authEmail === rawEmail) {
          return NextResponse.json({
            success: true,
            targetEmail: authEmail,
          });
        }
      }

      // instructor.email에 미기재되어 있으나 auth.users 이메일과 직접 일치하는 본부 구성원 탐색
      for (const m of hqList) {
        const { data: authRes } = await supabaseAdmin.auth.admin.getUserById(
          m.instructor_id
        );
        const authEmail = String(authRes?.user?.email || "")
          .trim()
          .toLowerCase();
        if (authEmail && authEmail === rawEmail) {
          return NextResponse.json({
            success: true,
            targetEmail: authEmail,
          });
        }
      }

      return apiFail(
        "입력하신 이메일로 등록된 본부(HQ) 재직 구성원 계정을 찾을 수 없습니다. 휴대폰 번호로 가입하셨다면 [휴대폰 문자 인증] 탭을 이용해 주세요.",
        404
      );
    }

    // -----------------------------------------------------------------------
    // 2. 휴대폰 SMS 6자리 인증번호 발송
    // -----------------------------------------------------------------------
    if (action === "SEND_SMS_CODE") {
      const name = String(body?.name || "").trim();
      const cleanPhone = String(body?.phone || "").replace(/[^0-9]/g, "");

      if (!name) {
        return apiFail("이름을 입력해 주세요.", 400);
      }
      if (!/^01\d{8,9}$/.test(cleanPhone)) {
        return apiFail(
          "올바른 휴대폰 번호(010-XXXX-XXXX)를 입력해 주세요.",
          400
        );
      }

      const hqList = await loadHqEligibleInstructors(supabaseAdmin);
      const sameNameCandidates = hqList.filter(
        (m) => String(m.name || "").trim() === name
      );

      let matchedInst: InstructorLite | null = null;
      let resolvedAuthEmail = "";

      for (const cand of sameNameCandidates) {
        const instPhone = String(cand.phone || "").replace(/[^0-9]/g, "");
        const instEmail = String(cand.email || "").trim().toLowerCase();
        const { data: authRes } = await supabaseAdmin.auth.admin.getUserById(
          cand.instructor_id
        );
        const authEmail = String(authRes?.user?.email || "")
          .trim()
          .toLowerCase();
        if (!authRes?.user) continue;

        if (
          instPhone === cleanPhone ||
          instEmail === `${cleanPhone}@logica.com` ||
          authEmail === `${cleanPhone}@logica.com`
        ) {
          matchedInst = cand;
          resolvedAuthEmail = authEmail;
          break;
        }
      }

      if (!matchedInst) {
        return apiFail(
          "입력하신 이름과 휴대폰 번호가 일치하는 본부 구성원 계정을 찾을 수 없습니다.",
          404
        );
      }

      const now = Date.now();
      const rawStore =
        (await readHqKvPayload<ResetCodeStoreMap>(
          supabaseAdmin,
          PW_RESET_KV_KEY
        )) || {};

      // 만료된 항목 정리
      const nextStore: ResetCodeStoreMap = {};
      Object.entries(rawStore).forEach(([k, v]) => {
        if (v && v.expiresAt > now) {
          nextStore[k] = v;
        }
      });

      const prevEntry = nextStore[cleanPhone];
      if (prevEntry && now - prevEntry.sentAt < RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil(
          (RESEND_COOLDOWN_MS - (now - prevEntry.sentAt)) / 1000
        );
        return apiFail(
          `인증번호가 이미 발송되었습니다. ${waitSec}초 후에 다시 요청해 주세요.`,
          429
        );
      }

      const apiKey = process.env.SOLAPI_API_KEY || "";
      const apiSecret = process.env.SOLAPI_API_SECRET || "";
      if (!apiKey || !apiSecret) {
        return apiFail(
          "서버 SMS 발송 환경변수(SOLAPI_API_KEY / SOLAPI_API_SECRET)가 설정되어 있지 않습니다. 관리자에게 문의해 주세요.",
          500
        );
      }

      const code = String(crypto.randomInt(100000, 1000000));
      const senderPhone = (
        process.env.SOLAPI_SENDER_PHONE ||
        process.env.SOLAPI_SENDER_NUMBER ||
        "025558875"
      ).replace(/[^0-9]/g, "");

      const messageService = new SolapiMessageService(apiKey, apiSecret);
      await messageService.send([
        {
          to: cleanPhone,
          from: senderPhone,
          text: `[천종현수학연구소 HQ]\n비밀번호 재설정 인증번호는 [${code}] 입니다.\n5분 이내에 입력해 주세요.`,
        },
      ]);

      nextStore[cleanPhone] = {
        userId: matchedInst.instructor_id,
        userName: String(matchedInst.name || name),
        authEmail: resolvedAuthEmail,
        department: String(matchedInst.department || ""),
        phone: cleanPhone,
        codeHash: hashResetCode(cleanPhone, code),
        expiresAt: now + CODE_TTL_MS,
        sentAt: now,
        attempts: 0,
      };
      await writeHqKvPayload(supabaseAdmin, PW_RESET_KV_KEY, nextStore);

      return NextResponse.json({
        success: true,
        data: {
          maskedPhone: maskPhone(cleanPhone),
          expiresInSeconds: 300,
        },
      });
    }

    // -----------------------------------------------------------------------
    // 3. 인증번호 검증 및 새 비밀번호 즉시 변경
    // -----------------------------------------------------------------------
    if (action === "CONFIRM_SMS_RESET") {
      const name = String(body?.name || "").trim();
      const cleanPhone = String(body?.phone || "").replace(/[^0-9]/g, "");
      const code = String(body?.code || "").trim();
      const newPassword = String(body?.newPassword || "").trim();

      if (!name || !cleanPhone || !code || !newPassword) {
        return apiFail("모든 항목을 입력해 주세요.", 400);
      }
      if (newPassword.length < 6) {
        return apiFail("새 비밀번호는 최소 6자리 이상이어야 합니다.", 400);
      }

      const now = Date.now();
      const store =
        (await readHqKvPayload<ResetCodeStoreMap>(
          supabaseAdmin,
          PW_RESET_KV_KEY
        )) || {};
      const entry = store[cleanPhone];

      if (!entry || entry.userName !== name) {
        return apiFail(
          "발급된 인증번호 내역이 없습니다. 인증번호를 먼저 요청해 주세요.",
          400
        );
      }

      if (now > entry.expiresAt) {
        delete store[cleanPhone];
        await writeHqKvPayload(supabaseAdmin, PW_RESET_KV_KEY, store);
        return apiFail(
          "인증번호 유효시간(5분)이 만료되었습니다. 인증번호를 다시 받아 주세요.",
          400
        );
      }

      if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
        delete store[cleanPhone];
        await writeHqKvPayload(supabaseAdmin, PW_RESET_KV_KEY, store);
        return apiFail(
          "인증번호 입력 오류 횟수(5회)를 초과했습니다. 인증번호를 다시 받아 주세요.",
          400
        );
      }

      const expectedBuf = Buffer.from(entry.codeHash, "hex");
      const actualBuf = Buffer.from(hashResetCode(cleanPhone, code), "hex");
      const isMatch =
        expectedBuf.length === actualBuf.length &&
        crypto.timingSafeEqual(expectedBuf, actualBuf);

      if (!isMatch) {
        entry.attempts += 1;
        store[cleanPhone] = entry;
        await writeHqKvPayload(supabaseAdmin, PW_RESET_KV_KEY, store);
        return apiFail(
          `인증번호가 일치하지 않습니다. (${entry.attempts}/${MAX_VERIFY_ATTEMPTS}회)`,
          400
        );
      }

      const { error: updateErr } =
        await supabaseAdmin.auth.admin.updateUserById(entry.userId, {
          password: newPassword,
        });

      if (updateErr) {
        return apiFail(
          `비밀번호 변경 실패: ${updateErr.message}`,
          500
        );
      }

      // 사용한 인증번호 즉시 폐기
      delete store[cleanPhone];
      await writeHqKvPayload(supabaseAdmin, PW_RESET_KV_KEY, store);

      // 로그인 실패 잠금 기록이 있었다면 함께 자동 해제
      try {
        const lockRecords = await readLoginAttemptRecords(supabaseAdmin);
        let changed = false;
        if (lockRecords[cleanPhone]) {
          delete lockRecords[cleanPhone];
          changed = true;
        }
        if (entry.authEmail && lockRecords[entry.authEmail]) {
          delete lockRecords[entry.authEmail];
          changed = true;
        }
        if (changed) {
          await writeLoginAttemptRecords(supabaseAdmin, lockRecords);
        }
      } catch {
        // 잠금 해제 보조 로직 실패 무시
      }

      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "인증",
        user_id: entry.userId,
        user_name: entry.userName,
        user_email: entry.authEmail,
        department: entry.department,
        event_type: "수정",
        info_type: "인사정보",
        description: "본부 로그인 비밀번호 재설정 완료 (휴대폰 SMS 본인인증)",
      }).catch(() => {});

      return NextResponse.json({
        success: true,
      });
    }

    return apiFail("지원하지 않는 요청입니다.", 400);
  } catch (err: unknown) {
    console.error("HQ password reset POST error:", err);
    const msg =
      err instanceof Error ? err.message : "비밀번호 재설정 처리 중 오류가 발생했습니다.";
    return apiFail(msg, 500);
  }
}
