// src/app/(dashboard)/p/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import ChatWidget from "@/components/parent/ChatWidget";
import StudentCard from "@/components/parent/StudentCard";
import {
  verifyParentPhone,
  loginParentAction,
  setupParentAction,
  getParentAuthToken,
  sendParentPasswordResetOtp,
  verifyParentPasswordResetOtp,
  confirmParentPasswordReset,
  getParentProfileAction,
  updateParentProfileAction,
} from "@/app/actions/parentAuth";

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

const ENDED_ENROLLMENT_STATUSES = ["수강종료", "종료", "퇴원", "취소"];
const isEndedEnrollment = (e: any): boolean => {
  if (!e) return true;
  if (ENDED_ENROLLMENT_STATUSES.includes(String(e.status || "").trim())) return true;
  if (e.end_date) return true;
  return false;
};

const safeParseIds = (raw: any): number[] => {
  if (!raw) return [];
  try {
    let val = raw;
    if (typeof val === "string") {
      if (val === "null" || val.trim() === "") return [];
      val = JSON.parse(val);
    }
    if (Array.isArray(val)) return val.map(Number);
  } catch (err) {
    console.warn("데이터 파싱 경고:", err);
  }
  return [];
};

const formatPageRanges = (pages: number[], maxSegments = 3): string => {
  if (!pages || pages.length === 0) return "";
  const sorted = Array.from(new Set(pages.filter((p) => p > 0))).sort(
    (a, b) => a - b
  );
  if (sorted.length === 0) return "";

  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
    } else {
      ranges.push(start === prev ? `${start}` : `${start}~${prev}`);
      start = cur;
      prev = cur;
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}~${prev}`);

  if (ranges.length > maxSegments) {
    const tail = ranges.slice(ranges.length - maxSegments);
    return `... ${tail.join(", ")}쪽`;
  }
  return `${ranges.join(", ")}쪽`;
};

const getKSTTodayStr = () => {
  const kst = new Date(Date.now() + 9 * 3600000);
  return kst.toISOString().split("T")[0];
};

export default function ParentPortalPage() {
  const [authState, setAuthState] = useState<
    "check_phone" | "login" | "setup" | "reset_otp" | "reset_new_pw" | "dashboard"
  >("check_phone");
  const [isKakaoLoading, setIsKakaoLoading] = useState(false);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);

  const [phoneInput, setPhoneInput] = useState("");
  const [pwInput, setPwInput] = useState("");
  const [setupName, setSetupName] = useState("");
  const [setupPw, setSetupPw] = useState("");
  const [isAgreed, setIsAgreed] = useState(false);

  // 📱 휴대폰 본인인증 비밀번호 리셋 상태
  const [otpInput, setOtpInput] = useState("");
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [otpTimeLeft, setOtpTimeLeft] = useState(0);
  const [isOtpSending, setIsOtpSending] = useState(false);
  const [isOtpVerifying, setIsOtpVerifying] = useState(false);
  const [resetNewPw, setResetNewPw] = useState("");
  const [resetNewPwConfirm, setResetNewPwConfirm] = useState("");
  const [isResetSaving, setIsResetSaving] = useState(false);

  const [parentId, setParentId] = useState<string | null>(null);
  const [activeParentPhone, setActiveParentPhone] = useState<string>("");
  const [infoName, setInfoName] = useState("");
  const [parentAvatarUrl, setParentAvatarUrl] = useState<string | null>(null);
  const [parentHasPassword, setParentHasPassword] = useState<boolean>(true);
  const [studentsData, setStudentsData] = useState<any[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  // ⚙️ 우측 상단 학부모 설정 모달 상태
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsName, setSettingsName] = useState("");
  const [settingsCurrentPw, setSettingsCurrentPw] = useState("");
  const [settingsNewPw, setSettingsNewPw] = useState("");
  const [settingsNewPwConfirm, setSettingsNewPwConfirm] = useState("");
  const [removeAvatarFlag, setRemoveAvatarFlag] = useState(false);

  // 프로필 사진 크롭 상태
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const [cropDragStart, setCropDragStart] = useState({ x: 0, y: 0 });
  const cropImgRef = useRef<HTMLImageElement>(null);

  // OTP 타이머 카운트다운
  useEffect(() => {
    if (authState !== "reset_otp" || otpTimeLeft <= 0) return;
    const timer = setInterval(() => {
      setOtpTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [authState, otpTimeLeft]);

  useEffect(() => {
    if (window.history.state?.app_state === "trap") {
      window.history.replaceState(null, "", window.location.href);
    }
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    const search = window.location.search;

    if (hash.includes("error=") || search.includes("error=")) {
      alert("카카오 로그인 인증 시간이 초과되었거나 취소되었습니다. 다시 시도해주세요.");
      window.history.replaceState(null, "", window.location.pathname);
      sessionStorage.removeItem("logica_oauth_source");
      setIsKakaoLoading(false);
      return;
    }

    if (localStorage.getItem("logica_parent_id")) {
      localStorage.removeItem("logica_parent_id");
    }

    const savedParentId = sessionStorage.getItem("logica_parent_id");
    const savedParentPhone = sessionStorage.getItem("logica_parent_phone") || "";

    if (hash.includes("access_token")) setIsKakaoLoading(true);

    const handleKakaoSession = async (session: any) => {
      let kakaoPhone = "";

      if (session.provider_token) {
        try {
          const res = await fetch("https://kapi.kakao.com/v2/user/me", {
            headers: {
              Authorization: `Bearer ${session.provider_token}`,
              "Content-type": "application/x-www-form-urlencoded;charset=utf-8",
            },
          });
          const kakaoData = await res.json();
          kakaoPhone = kakaoData?.kakao_account?.phone_number || "";
        } catch (e) {
          console.error("카카오 다이렉트 호출 실패", e);
        }
      }

      if (!kakaoPhone) {
        const meta = session.user?.user_metadata || {};
        kakaoPhone =
          meta.phone_number ||
          meta.phone ||
          session.user?.identities?.[0]?.identity_data?.phone_number ||
          "";
      }

      if (!kakaoPhone) {
        alert(
          "카카오에서 연락처 정보를 가져올 수 없습니다.\n카카오 계정 설정을 확인하거나 일반 로그인(전화번호)을 이용해주세요."
        );
        await supabase.auth.signOut();
        setIsKakaoLoading(false);
        return;
      }

      if (kakaoPhone.startsWith("+82")) {
        kakaoPhone = "0" + kakaoPhone.slice(3).trim();
      }

      const rawPhone = kakaoPhone.replace(/[^0-9]/g, "");

      try {
        let { data: foundParentId } = await supabase.rpc("get_parent_by_phone", {
          phone_req: rawPhone,
        });
        if (!foundParentId) {
          const hyphen = rawPhone.replace(
            /^(\d{3})(\d{3,4})(\d{4})$/,
            "$1-$2-$3"
          );
          if (hyphen !== rawPhone)
            ({ data: foundParentId } = await supabase.rpc("get_parent_by_phone", {
              phone_req: hyphen,
            }));
        }

        if (!foundParentId) {
          const verifyRes = await verifyParentPhone(rawPhone);
          if (verifyRes.success && verifyRes.parentId) {
            foundParentId = verifyRes.parentId;
          }
        }

        if (foundParentId) {
          const token = await getParentAuthToken(foundParentId);
          sessionStorage.setItem("logica_parent_id", foundParentId);
          sessionStorage.setItem("logica_parent_phone", rawPhone);
          setActiveParentPhone(rawPhone);
          window.history.replaceState(null, "", window.location.pathname);
          setIsKakaoLoading(false);
          loadDashboard(foundParentId, token, rawPhone);
        } else {
          alert("등록된 학원 연락처와 일치하는 학부모 정보가 없습니다.");
          await supabase.auth.signOut();
          setIsKakaoLoading(false);
        }
      } catch (err) {
        console.error(err);
        setIsKakaoLoading(false);
      }
    };

    const initAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const isKakao = session?.user?.app_metadata?.provider === "kakao";

      if (session && isKakao) {
        await handleKakaoSession(session);
      } else if (savedParentId && !hash.includes("access_token")) {
        setActiveParentPhone(savedParentPhone);
        getParentAuthToken(savedParentId)
          .then((token) => {
            loadDashboard(savedParentId, token, savedParentPhone);
          })
          .catch((err) => {
            console.error("저장된 세션 토큰 발급 실패:", err);
            setAuthState("check_phone");
          });
      }
    };
    initAuth();
  }, []);

  const handlePhoneInput = (val: string) => {
    const formatted = val
      .replace(/[^0-9]/g, "")
      .replace(
        /^(\d{0,3})(\d{0,4})(\d{0,4})$/g,
        (m: string, p1: string, p2: string, p3: string) =>
          p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : "")
      );
    setPhoneInput(formatted);
  };

  const checkPhone = async () => {
    if (phoneInput.length < 12) return alert("연락처를 정확히 입력해주세요.");
    const result = await verifyParentPhone(phoneInput);
    if (!result.success) return alert(result.message);
    setParentId(result.parentId || null);

    if (result.needsSetup) {
      setIsAgreed(false);
      setAuthState("setup");
    } else {
      setPwInput("");
      setAuthState("login");
    }
  };

  const loginParent = async () => {
    const result = await loginParentAction(phoneInput, pwInput);
    if (result.success && result.parentId) {
      const token = await getParentAuthToken(result.parentId);
      sessionStorage.setItem("logica_parent_id", result.parentId);
      sessionStorage.setItem("logica_parent_phone", phoneInput);
      setActiveParentPhone(phoneInput);
      loadDashboard(result.parentId, token, phoneInput);
    } else {
      alert(result.message);
    }
  };

  const setupParent = async () => {
    if (!isAgreed)
      return alert("개인정보 수집 및 법정대리인 동의에 체크해주세요.");
    if (!setupPw.trim() || !parentId)
      return alert("사용할 비밀번호를 입력해주세요.");

    const result = await setupParentAction(
      parentId,
      setupName,
      setupPw,
      phoneInput
    );
    if (result.success) {
      const token = await getParentAuthToken(parentId);
      sessionStorage.setItem("logica_parent_id", parentId);
      sessionStorage.setItem("logica_parent_phone", phoneInput);
      setActiveParentPhone(phoneInput);
      loadDashboard(parentId, token, phoneInput);
    } else {
      alert(result.message);
    }
  };

  // 📱 휴대폰 인증번호 발송 및 재설정 시작
  const handleSendResetOtp = async () => {
    if (!phoneInput || phoneInput.length < 12) {
      return alert("휴대폰 번호를 먼저 확인해주세요.");
    }
    setIsOtpSending(true);
    try {
      const res = await sendParentPasswordResetOtp(phoneInput);
      if (!res.success || !res.otpToken) {
        alert(res.message || "인증번호 발송에 실패했습니다.");
        return;
      }
      setOtpToken(res.otpToken);
      setOtpInput("");
      setOtpTimeLeft(180);
      setAuthState("reset_otp");
      alert(res.message);
    } finally {
      setIsOtpSending(false);
    }
  };

  // 📱 6자리 인증번호 검증
  const handleVerifyResetOtp = async () => {
    if (!otpToken) {
      return alert("인증번호를 먼저 발송해주세요.");
    }
    if (otpTimeLeft <= 0) {
      return alert("인증 유효시간(3분)이 만료되었습니다. 인증번호를 다시 받아주세요.");
    }
    setIsOtpVerifying(true);
    try {
      const res = await verifyParentPasswordResetOtp(
        phoneInput,
        otpInput,
        otpToken
      );
      if (!res.success || !res.resetToken) {
        alert(res.message || "인증번호 확인에 실패했습니다.");
        return;
      }
      setResetToken(res.resetToken);
      if (res.parentId) setParentId(res.parentId);
      setResetNewPw("");
      setResetNewPwConfirm("");
      setAuthState("reset_new_pw");
    } finally {
      setIsOtpVerifying(false);
    }
  };

  // 📱 새 비밀번호 저장 및 즉시 로그인
  const handleConfirmResetPw = async () => {
    if (!resetToken) {
      return alert("인증 정보가 만료되었습니다. 다시 시도해주세요.");
    }
    if (!resetNewPw.trim() || resetNewPw.trim().length < 4) {
      return alert("새 비밀번호를 4자리 이상 입력해주세요.");
    }
    if (resetNewPw.trim() !== resetNewPwConfirm.trim()) {
      return alert("새 비밀번호와 확인 비밀번호가 일치하지 않습니다.");
    }
    setIsResetSaving(true);
    try {
      const res = await confirmParentPasswordReset(
        phoneInput,
        resetToken,
        resetNewPw.trim()
      );
      if (!res.success || !res.parentId) {
        alert(res.message || "비밀번호 변경에 실패했습니다.");
        return;
      }
      alert("비밀번호가 성공적으로 재설정되었습니다.");
      const token = await getParentAuthToken(res.parentId);
      sessionStorage.setItem("logica_parent_id", res.parentId);
      sessionStorage.setItem("logica_parent_phone", phoneInput);
      setActiveParentPhone(phoneInput);
      loadDashboard(res.parentId, token, phoneInput);
    } finally {
      setIsResetSaving(false);
    }
  };

  const loginWithKakao = async () => {
    sessionStorage.setItem("logica_oauth_source", "parent");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "kakao",
      options: {
        redirectTo: `${window.location.origin}/p`,
        scopes: "phone_number profile_nickname profile_image account_email",
      },
    });
    if (error) alert("카카오 로그인 중 오류가 발생했습니다.");
  };

  const logout = async () => {
    if (confirm("로그아웃 하시겠습니까?")) {
      await supabase.auth.signOut({ scope: "local" });
      localStorage.clear();
      sessionStorage.clear();
      setAuthState("check_phone");
      setParentId(null);
      setAuthToken(null);
      setStudentsData([]);
      window.history.replaceState(null, "", window.location.pathname);
      window.location.reload();
    }
  };

  // ⚙️ 설정 모달 열기
  const openSettingsModal = async () => {
    if (!parentId) return;
    setCropImageSrc(null);
    setCropPos({ x: 0, y: 0 });
    setCropZoom(1);
    setRemoveAvatarFlag(false);
    setSettingsCurrentPw("");
    setSettingsNewPw("");
    setSettingsNewPwConfirm("");
    setSettingsName(infoName || "");
    setIsSettingsOpen(true);

    const prof = await getParentProfileAction(parentId, activeParentPhone);
    if (prof.success) {
      setSettingsName(prof.name || "");
      setInfoName(prof.name || "");
      setParentAvatarUrl(prof.profileImageUrl || null);
      setParentHasPassword(prof.hasPassword ?? true);
      if (prof.phone && !activeParentPhone) {
        setActiveParentPhone(prof.phone);
      }
    }
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const objUrl = URL.createObjectURL(file);
    setCropImageSrc(objUrl);
    setCropPos({ x: 0, y: 0 });
    setCropZoom(1);
    setRemoveAvatarFlag(false);
    e.target.value = "";
  };

  const startCropDrag = (clientX: number, clientY: number) => {
    setIsDraggingCrop(true);
    setCropDragStart({ x: clientX - cropPos.x, y: clientY - cropPos.y });
  };
  const moveCropDrag = (clientX: number, clientY: number) => {
    if (!isDraggingCrop) return;
    setCropPos({
      x: clientX - cropDragStart.x,
      y: clientY - cropDragStart.y,
    });
  };
  const endCropDrag = () => setIsDraggingCrop(false);

  const getCroppedAvatarDataUrl = async (): Promise<string | null> => {
    const img = cropImgRef.current;
    if (!img) return null;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const CANVAS_SIZE = 320;
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;

    const CONTAINER_SIZE = 150;
    const ratio = CANVAS_SIZE / CONTAINER_SIZE;

    const naturalW = img.naturalWidth || 1;
    const naturalH = img.naturalHeight || 1;
    const renderW = CONTAINER_SIZE;
    const renderH = CONTAINER_SIZE * (naturalH / naturalW);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.save();
    ctx.translate(CANVAS_SIZE / 2, CANVAS_SIZE / 2);
    ctx.scale(cropZoom, cropZoom);
    ctx.translate(cropPos.x * ratio, cropPos.y * ratio);

    const drawW = renderW * ratio;
    const drawH = renderH * ratio;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    return canvas.toDataURL("image/jpeg", 0.9);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parentId || !authToken) return;

    if (settingsNewPw.trim() !== "") {
      if (settingsNewPw.trim().length < 4) {
        return alert("새 비밀번호는 4자리 이상으로 입력해주세요.");
      }
      if (settingsNewPw.trim() !== settingsNewPwConfirm.trim()) {
        return alert("새 비밀번호와 확인 비밀번호가 일치하지 않습니다.");
      }
      if (parentHasPassword && !settingsCurrentPw.trim()) {
        return alert("비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.");
      }
    }

    setIsSavingSettings(true);
    try {
      let croppedBase64: string | null = null;
      if (cropImageSrc) {
        croppedBase64 = await getCroppedAvatarDataUrl();
        if (!croppedBase64) {
          alert("프로필 사진 영역을 처리하지 못했습니다. 다시 시도해주세요.");
          return;
        }
      }

      const res = await updateParentProfileAction({
        parentId,
        authToken,
        phone: activeParentPhone || phoneInput,
        name: settingsName,
        currentPassword: settingsCurrentPw,
        newPassword: settingsNewPw,
        imageBase64: croppedBase64,
        removeImage: removeAvatarFlag,
      });

      if (!res.success) {
        alert(res.message || "설정 저장에 실패했습니다.");
        return;
      }

      setInfoName(res.name || "");
      if (res.profileImageUrl !== undefined) {
        setParentAvatarUrl(res.profileImageUrl);
      }
      if (settingsNewPw.trim() !== "") {
        setParentHasPassword(true);
      }
      setIsSettingsOpen(false);
      alert("설정이 저장되었습니다.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const loadDashboard = async (
    pid: string,
    providedToken?: string,
    loginPhone?: string
  ) => {
    setParentId(pid);
    setAuthState("dashboard");
    setIsDashboardLoading(true);

    try {
      let token = providedToken;
      if (!token) {
        token = await getParentAuthToken(pid);
      }
      setAuthToken(token);

      const currentPhone =
        loginPhone ||
        activeParentPhone ||
        sessionStorage.getItem("logica_parent_phone") ||
        "";

      // 학부모 프로필(이름·아바타·비밀번호 설정 여부) 로드
      getParentProfileAction(pid, currentPhone)
        .then((prof) => {
          if (prof.success) {
            setInfoName(prof.name || "");
            setParentAvatarUrl(prof.profileImageUrl || null);
            setParentHasPassword(prof.hasPassword ?? true);
            if (prof.phone && !currentPhone) {
              setActiveParentPhone(prof.phone);
            }
          }
        })
        .catch(() => {});

      const authSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        }
      );

      const { data: pData } = await authSupabase
        .from("parent")
        .select("name, name_2, name_3, phone, phone_2, phone_3")
        .eq("parent_id", pid)
        .single();

      if (!pData?.phone && !pData?.phone_2 && !pData?.phone_3) return;

      const orConditions: string[] = [];
      [pData?.phone, pData?.phone_2, pData?.phone_3].forEach((p) => {
        if (!p || p.includes("unassigned")) return;
        const raw = p.replace(/[^0-9]/g, "");
        if (!raw) return;
        const fmt = raw.replace(
          /^(\d{0,3})(\d{0,4})(\d{0,4})$/g,
          (m: string, p1: string, p2: string, p3: string) =>
            p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : "")
        );
        orConditions.push(
          `phone.eq.${raw},phone.eq.${fmt},phone_2.eq.${raw},phone_2.eq.${fmt},phone_3.eq.${raw},phone_3.eq.${fmt}`
        );
      });

      let pids = [pid];
      if (orConditions.length > 0) {
        const { data: allParents } = await authSupabase
          .from("parent")
          .select("parent_id")
          .or(orConditions.join(","));
        if (allParents && allParents.length > 0) {
          pids = Array.from(
            new Set([pid, ...allParents.map((p) => p.parent_id)])
          );
        }
      }

      const { data: sData, error } = await authSupabase
        .from("student")
        .select(
          "*, enrollment(status, start_date, end_date, class(class_id, name, class_schedule(day_of_week, start_time, end_time), class_extra_session(id, session_date, reason, start_time, end_time, replaces_holiday_id), class_holiday(id, holiday_date, reason))), exam_assignment(total_score, status, created_at, exam_id), attendance(attendance_id, attendance_date, status, check_in_time, check_out_time), student_homework_result(status, completed_tq_ids, homework_assignment(homework_id, homework_title, target_questions, due_date, created_at, book_id, textbook(title, book_type))), consultation_log(consultation_log_id, consultation_type, contact_method, parent_summary, created_at, instructor(name)), individual_makeup(makeup_id, schedule_date, status, classroom, target_category_id, instructor_note, instructor(name))"
        )
        .in("parent_id", pids);

      if (error) {
        console.error("데이터 조회 에러:", error);
      }

      if (!error && sData && sData.length > 0) {
        const sorted = sData.sort(
          (a, b) => (parseInt(b.grade) || 0) - (parseInt(a.grade) || 0)
        );
        const todayKst = getKSTTodayStr();

        for (const stu of sorted) {
          const activeEnrollment = stu.enrollment?.find(
            (e: any) => !isEndedEnrollment(e) && unwrap(e.class)?.class_id
          );
          const classId = activeEnrollment
            ? unwrap(activeEnrollment.class)?.class_id
            : null;

          const tqToPageMap = new Map<number, number>();
          const tqToBookMap = new Map<number, string>();
          const globalStatusMap: Record<number, "done" | "homework"> = {};

          if (classId) {
            const { data: ctData } = await authSupabase
              .from("class_textbook")
              .select("*, textbook(*)")
              .eq("class_id", classId);

            if (ctData && ctData.length > 0) {
              const bIds = ctData.map((cb) => cb.book_id);

              let qData: any[] = [];
              for (const bId of bIds) {
                let from = 0;
                while (true) {
                  const { data: qChunk } = await authSupabase
                    .from("textbook_question")
                    .select("tq_id, book_id, page_number, question_id")
                    .eq("book_id", bId)
                    .range(from, from + 999);
                  if (!qChunk || qChunk.length === 0) break;
                  qData.push(...qChunk);
                  if (qChunk.length < 1000) break;
                  from += 1000;
                }
              }

              const qIdToTqId = new Map<number, number>();
              const bookPagesMap: Record<string, Set<number>> = {};
              const bookPageTqsMap: Record<string, Record<number, number[]>> =
                {};
              const bookMinDateMap: Record<string, string> = {};
              const bookMaxDateMap: Record<string, string> = {};

              bIds.forEach((b) => {
                bookPagesMap[b] = new Set();
                bookPageTqsMap[b] = {};
              });

              qData.forEach((q) => {
                if (q.question_id) qIdToTqId.set(q.question_id, q.tq_id);
                const pNum = Number(q.page_number) || 0;
                tqToPageMap.set(q.tq_id, pNum);
                tqToBookMap.set(q.tq_id, q.book_id);
                bookPagesMap[q.book_id].add(pNum);
                if (!bookPageTqsMap[q.book_id][pNum])
                  bookPageTqsMap[q.book_id][pNum] = [];
                bookPageTqsMap[q.book_id][pNum].push(q.tq_id);
              });

              const recordBookDate = (
                bId: string | undefined,
                rawDate: string | null | undefined
              ) => {
                if (!bId || !rawDate) return;
                const dStr = String(rawDate).split("T")[0];
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return;
                if (!bookMinDateMap[bId] || dStr < bookMinDateMap[bId]) {
                  bookMinDateMap[bId] = dStr;
                }
                if (!bookMaxDateMap[bId] || dStr > bookMaxDateMap[bId]) {
                  bookMaxDateMap[bId] = dStr;
                }
              };

              const { data: hwAssignments } = await authSupabase
                .from("homework_assignment")
                .select(
                  "book_id, target_questions, target_student_id, created_at, due_date, student_homework_result(student_id, completed_tq_ids, status)"
                )
                .eq("class_id", classId)
                .in("book_id", bIds);

              hwAssignments?.forEach((hw) => {
                const targetQs = safeParseIds(hw.target_questions);
                const isClassWide = !hw.target_student_id;
                const hwDateStr = (hw.created_at || hw.due_date || "").split(
                  "T"
                )[0];

                if (isClassWide || hw.target_student_id === stu.student_id) {
                  if (targetQs.length > 0) {
                    recordBookDate(hw.book_id, hwDateStr);
                  }
                  targetQs.forEach((tq) => (globalStatusMap[tq] = "homework"));
                }

                hw.student_homework_result?.forEach((res: any) => {
                  if (res.student_id === stu.student_id) {
                    const parsedCompleted = safeParseIds(res.completed_tq_ids);
                    const isFullyCompleted = [
                      "채점완료",
                      "제출완료",
                      "완료",
                    ].includes(res.status);
                    let completedQs = parsedCompleted;
                    if (isFullyCompleted && targetQs.length > 0)
                      completedQs = Array.from(
                        new Set([...targetQs, ...parsedCompleted])
                      );
                    if (completedQs.length > 0) {
                      recordBookDate(hw.book_id, hwDateStr);
                    }
                    completedQs.forEach(
                      (tqId) => (globalStatusMap[tqId] = "done")
                    );
                  }
                });
              });

              let exAssigns: any[] = [];
              let fromEA = 0;
              while (true) {
                const { data: chunk } = await authSupabase
                  .from("exam_assignment")
                  .select("assignment_id, status, exam_id, created_at")
                  .eq("student_id", stu.student_id)
                  .range(fromEA, fromEA + 999);
                if (!chunk || chunk.length === 0) break;
                exAssigns.push(...chunk);
                if (chunk.length < 1000) break;
                fromEA += 1000;
              }
              const eIds = [
                ...new Set(exAssigns.map((a) => a.exam_id).filter(Boolean)),
              ];
              if (eIds.length > 0) {
                let eItems: any[] = [];
                for (let i = 0; i < eIds.length; i += 100) {
                  const chunkIds = eIds.slice(i, i + 100);
                  let fromEI = 0;
                  while (true) {
                    const { data: chunk } = await authSupabase
                      .from("exam_item")
                      .select("exam_id, question_id")
                      .in("exam_id", chunkIds)
                      .range(fromEI, fromEI + 999);
                    if (!chunk || chunk.length === 0) break;
                    eItems.push(...chunk);
                    if (chunk.length < 1000) break;
                    fromEI += 1000;
                  }
                }
                const examQMap = new Map<string, number[]>();
                eItems.forEach((item) => {
                  if (!examQMap.has(item.exam_id))
                    examQMap.set(item.exam_id, []);
                  examQMap.get(item.exam_id)!.push(item.question_id);
                });
                exAssigns.forEach((assign) => {
                  const qIdsInExam = examQMap.get(assign.exam_id) || [];
                  const isCompleted = [
                    "채점완료",
                    "제출완료",
                    "완료",
                  ].includes(assign.status);
                  qIdsInExam.forEach((qId) => {
                    const tqId = qIdToTqId.get(qId);
                    if (tqId) {
                      const bId = tqToBookMap.get(tqId);
                      recordBookDate(bId, assign.created_at);
                      const curStatus = globalStatusMap[tqId];
                      if (isCompleted) {
                        globalStatusMap[tqId] = "done";
                      } else if (curStatus !== "done") {
                        globalStatusMap[tqId] = "homework";
                      }
                    }
                  });
                });
              }

              let hwAns: any[] = [];
              let fromHw = 0;
              while (true) {
                const { data: chunk } = await authSupabase
                  .from("student_homework_answer")
                  .select("tq_id, is_correct, grading_code")
                  .eq("student_id", stu.student_id)
                  .range(fromHw, fromHw + 999);
                if (!chunk || chunk.length === 0) break;
                hwAns.push(...chunk);
                if (chunk.length < 1000) break;
                fromHw += 1000;
              }
              hwAns.forEach((ans) => {
                if (
                  ["O", "TO", "RO"].includes(ans.grading_code) ||
                  ans.is_correct
                )
                  globalStatusMap[ans.tq_id] = "done";
              });

              let exAns: any[] = [];
              let fromEx = 0;
              while (true) {
                const { data: chunk } = await authSupabase
                  .from("student_answer")
                  .select("question_id, is_correct, grading_code")
                  .eq("student_id", stu.student_id)
                  .range(fromEx, fromEx + 999);
                if (!chunk || chunk.length === 0) break;
                exAns.push(...chunk);
                if (chunk.length < 1000) break;
                fromEx += 1000;
              }
              exAns.forEach((ans) => {
                const tqId = qIdToTqId.get(ans.question_id);
                if (
                  tqId &&
                  (["O", "TO", "RO"].includes(ans.grading_code) ||
                    ans.is_correct)
                )
                  globalStatusMap[tqId] = "done";
              });

              const startPageByBook: Record<string, number> = {};
              const { data: spRows, error: spErr } = await authSupabase
                .from("student_textbook_start")
                .select("book_id, start_page")
                .eq("class_id", classId)
                .eq("student_id", stu.student_id);
              if (spErr)
                console.warn(
                  "시작 페이지 조회 실패(무시하고 진행):",
                  spErr.message
                );
              (spRows || []).forEach((r: any) => {
                startPageByBook[r.book_id] = Number(r.start_page);
              });

              stu.progressBooks = ctData.map((cb) => {
                const bId = cb.book_id;
                const totalPages = Array.from(bookPagesMap[bId] || []).sort(
                  (a, b) => a - b
                );
                const startPage: number | undefined = startPageByBook[bId];
                const countedPages =
                  startPage !== undefined
                    ? totalPages.filter((p) => p >= startPage)
                    : totalPages;
                let donePagesCount = 0;
                const pageStatuses: Record<
                  number,
                  "done" | "homework" | "none" | "excluded"
                > = {};
                const donePageList: number[] = [];

                totalPages.forEach((p) => {
                  const tqs = bookPageTqsMap[bId][p] || [];
                  let doneCount = 0;
                  let hwCount = 0;
                  tqs.forEach((tq) => {
                    if (globalStatusMap[tq] === "done") doneCount++;
                    else if (globalStatusMap[tq] === "homework") hwCount++;
                  });
                  const isBeforeStart =
                    startPage !== undefined && p < startPage;
                  if (tqs.length > 0 && doneCount === tqs.length) {
                    pageStatuses[p] = "done";
                    donePageList.push(p);
                    if (!isBeforeStart) donePagesCount++;
                  } else if (isBeforeStart) {
                    pageStatuses[p] = "excluded";
                  } else if (doneCount > 0 || hwCount > 0) {
                    pageStatuses[p] = "homework";
                  } else {
                    pageStatuses[p] = "none";
                  }
                });

                const percent =
                  countedPages.length > 0
                    ? Math.min(
                        100,
                        Math.round((donePagesCount / countedPages.length) * 100)
                      )
                    : 0;

                const actualStartDate = bookMinDateMap[bId] || null;
                const actualEndDate = actualStartDate
                  ? percent >= 100
                    ? bookMaxDateMap[bId] || todayKst
                    : todayKst
                  : null;
                const recentDonePageRange =
                  donePageList.length > 0
                    ? formatPageRanges(donePageList.slice(-8), 2)
                    : "";

                return {
                  ...cb,
                  stats: {
                    percent,
                    donePagesCount,
                    maxPageCount: countedPages.length,
                    startPage,
                    pageStatuses,
                    bookPages: totalPages,
                    actualStartDate,
                    actualEndDate,
                    recentDonePageRange,
                  },
                };
              });
            }
          }

        }

        setStudentsData(sorted);
        setSelectedStudentId(sorted[0].student_id);
      }
    } catch (err) {
      console.error("대시보드 로드 에러", err);
    } finally {
      setIsDashboardLoading(false);
    }
  };

  const LOGO_URL =
    "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png";
  const inputCls =
    "w-full min-h-[48px] px-4 rounded-lg border border-[#CBD5E1] bg-white text-[16px] text-[#1E293B] placeholder:text-[#9AA5B1] outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15";
  const primaryBtn =
    "w-full min-h-[48px] rounded-lg bg-[#2563EB] text-white text-[16px] font-semibold hover:bg-[#1D4ED8] shadow-xs transition-colors disabled:opacity-50";
  const secondaryBtn =
    "w-full min-h-[48px] rounded-lg border border-[#CBD5E1] bg-white text-[#334155] text-[16px] font-semibold hover:bg-[#F8FAFC] transition-colors disabled:opacity-50";

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const AcademyInfo = () => (
    <div className="text-[12px] text-[#64748B] leading-relaxed text-center">
      <p className="font-semibold text-[#334155]">
        (주)이배움 로지카대치본원학원
      </p>
      <p>대표자 천종현, 사업자등록번호 732-85-02927</p>
      <p>서울특별시 강남구 역삼로 448, 3층(대치동)</p>
      <p>
        대표번호{" "}
        <a
          href="tel:025558875"
          className="underline underline-offset-2 text-[#334155]"
        >
          02-555-8875
        </a>
      </p>
    </div>
  );

  const renderAuthSection = () => {
    if (authState === "dashboard") return null;
    if (isKakaoLoading)
      return (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-4 p-6 bg-[#F8FAFC]"
          role="status"
        >
          <span
            className="w-8 h-8 border-[3px] border-[#2563EB] border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          ></span>
          <p className="text-[16px] font-semibold text-[#1E293B]">
            카카오 계정을 확인하고 있어요
          </p>
        </div>
      );

    return (
      <div className="flex-1 overflow-y-auto bg-[#F8FAFC]">
        <div className="min-h-full flex flex-col items-center justify-center px-5 py-10">
          <div className="w-full max-w-[400px] bg-white rounded-2xl border border-[#E2E8F0] px-6 py-8 flex flex-col gap-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <img src={LOGO_URL} className="h-9 object-contain" alt="로지카" />
              <div>
                <h1 className="text-[20px] font-bold text-[#1E293B]">
                  {authState === "setup"
                    ? "처음 오셨군요"
                    : authState === "reset_otp" || authState === "reset_new_pw"
                    ? "비밀번호 재설정"
                    : "학부모님, 반가워요"}
                </h1>
                <p className="text-[14px] text-[#64748B] mt-1">
                  {authState === "check_phone" &&
                    "자녀의 출결, 진도, 성적을 확인할 수 있어요."}
                  {authState === "login" && "비밀번호를 입력해 주세요."}
                  {authState === "setup" &&
                    "앞으로 쓰실 비밀번호를 정해 주세요."}
                  {authState === "reset_otp" &&
                    "휴대폰 문자로 전송된 6자리 인증번호를 입력해 주세요."}
                  {authState === "reset_new_pw" &&
                    "본인인증이 확인되었어요. 새 비밀번호를 설정해 주세요."}
                </p>
              </div>
            </div>

            {authState === "check_phone" && (
              <div className="flex flex-col gap-5">
                <button
                  type="button"
                  onClick={loginWithKakao}
                  className="w-full min-h-[52px] flex items-center justify-center gap-2 rounded-lg bg-[#FEE500] text-[rgba(0,0,0,0.85)] text-[16px] font-semibold hover:bg-[#F4DC00] transition-colors"
                >
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M12 3c-5.523 0-10 3.51-10 7.839 0 2.825 1.83 5.305 4.606 6.643l-1.18 4.316c-.086.315.267.559.53.376l5.06-3.348c.323.033.655.051.984.051 5.523 0 10-3.51 10-7.839C22 6.51 17.523 3 12 3z" />
                  </svg>
                  카카오로 시작하기
                </button>

                <div className="flex items-center gap-3" aria-hidden="true">
                  <div className="flex-1 border-t border-[#E2E8F0]"></div>
                  <span className="text-[13px] text-[#64748B]">
                    또는 전화번호로
                  </span>
                  <div className="flex-1 border-t border-[#E2E8F0]"></div>
                </div>

                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    checkPhone();
                  }}
                >
                  <label
                    htmlFor="parent-phone"
                    className="text-[14px] font-semibold text-[#334155]"
                  >
                    학원에 등록한 학부모 휴대전화번호
                  </label>
                  <input
                    id="parent-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={13}
                    value={phoneInput}
                    onChange={(e) => handlePhoneInput(e.target.value)}
                    className={`${inputCls} tracking-wide`}
                    placeholder="010-0000-0000"
                  />
                  <button type="submit" className={secondaryBtn}>
                    전화번호로 로그인
                  </button>
                </form>
              </div>
            )}

            {authState === "login" && (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  loginParent();
                }}
              >
                <div className="rounded-lg bg-[#F8FAFC] px-4 py-3 text-[15px] text-[#334155] tabular-nums">
                  {phoneInput}
                </div>
                <label
                  htmlFor="parent-pw"
                  className="text-[14px] font-semibold text-[#334155]"
                >
                  비밀번호
                </label>
                <input
                  id="parent-pw"
                  type="password"
                  autoComplete="current-password"
                  value={pwInput}
                  onChange={(e) => setPwInput(e.target.value)}
                  className={inputCls}
                  placeholder="비밀번호 입력"
                  autoFocus
                />
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setAuthState("check_phone")}
                    className={`${secondaryBtn} !w-1/3`}
                  >
                    뒤로
                  </button>
                  <button type="submit" className={`${primaryBtn} !w-2/3`}>
                    로그인
                  </button>
                </div>

                <div className="pt-2 border-t border-[#EEF0F2] mt-1 flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isOtpSending}
                    onClick={handleSendResetOtp}
                    className="text-[13.5px] font-semibold text-[#1D4ED8] hover:underline underline-offset-4 py-1.5 disabled:opacity-50"
                  >
                    {isOtpSending
                      ? "인증번호 문자 발송 중..."
                      : "비밀번호를 잊으셨나요? 휴대폰 인증으로 재설정"}
                  </button>
                </div>
              </form>
            )}

            {authState === "reset_otp" && (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleVerifyResetOtp();
                }}
              >
                <div className="rounded-lg bg-[#F8FAFC] px-4 py-3 flex items-center justify-between text-[14px] text-[#334155]">
                  <span className="tabular-nums font-medium">{phoneInput}</span>
                  <button
                    type="button"
                    disabled={isOtpSending}
                    onClick={handleSendResetOtp}
                    className="text-[12.5px] font-semibold text-[#1D4ED8] underline underline-offset-2 disabled:opacity-50"
                  >
                    {isOtpSending ? "재발송 중..." : "인증번호 재발송"}
                  </button>
                </div>

                <div className="flex items-center justify-between mt-1">
                  <label
                    htmlFor="parent-otp"
                    className="text-[14px] font-semibold text-[#334155]"
                  >
                    인증번호 6자리
                  </label>
                  <span
                    className={`text-[13px] font-bold tabular-nums ${
                      otpTimeLeft <= 30 ? "text-[#C8372D]" : "text-[#1D4ED8]"
                    }`}
                  >
                    남은 시간 {formatCountdown(otpTimeLeft)}
                  </span>
                </div>

                <input
                  id="parent-otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpInput}
                  onChange={(e) =>
                    setOtpInput(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  className={`${inputCls} tracking-[0.25em] text-center font-bold text-[18px]`}
                  placeholder="000000"
                  autoFocus
                />

                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setAuthState("login")}
                    className={`${secondaryBtn} !w-1/3`}
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={isOtpVerifying || otpInput.length !== 6}
                    className={`${primaryBtn} !w-2/3`}
                  >
                    {isOtpVerifying ? "확인 중..." : "인증번호 확인"}
                  </button>
                </div>
              </form>
            )}

            {authState === "reset_new_pw" && (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleConfirmResetPw();
                }}
              >
                <div className="rounded-lg bg-[#E7F4EE] text-[#0B5E41] px-4 py-2.5 text-[13.5px] font-semibold flex items-center justify-between">
                  <span>✓ 휴대폰 본인인증 완료</span>
                  <span className="tabular-nums">{phoneInput}</span>
                </div>

                <label
                  htmlFor="reset-new-pw"
                  className="text-[14px] font-semibold text-[#334155] mt-1"
                >
                  새 비밀번호
                </label>
                <input
                  id="reset-new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={resetNewPw}
                  onChange={(e) => setResetNewPw(e.target.value)}
                  className={inputCls}
                  placeholder="새 비밀번호 입력 (4자리 이상)"
                  autoFocus
                />

                <label
                  htmlFor="reset-new-pw-confirm"
                  className="text-[14px] font-semibold text-[#334155]"
                >
                  새 비밀번호 확인
                </label>
                <input
                  id="reset-new-pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={resetNewPwConfirm}
                  onChange={(e) => setResetNewPwConfirm(e.target.value)}
                  className={inputCls}
                  placeholder="새 비밀번호 다시 입력"
                />

                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setAuthState("login")}
                    className={`${secondaryBtn} !w-1/3`}
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={isResetSaving}
                    className={`${primaryBtn} !w-2/3`}
                  >
                    {isResetSaving ? "변경 중..." : "비밀번호 변경 및 로그인"}
                  </button>
                </div>
              </form>
            )}

            {authState === "setup" && (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  setupParent();
                }}
              >
                <div className="rounded-lg bg-[#F8FAFC] px-4 py-3 text-[15px] text-[#334155] tabular-nums">
                  {phoneInput}
                </div>
                <label
                  htmlFor="parent-name"
                  className="text-[14px] font-semibold text-[#334155]"
                >
                  학부모님 성함{" "}
                  <span className="font-normal text-[#64748B]">(선택)</span>
                </label>
                <input
                  id="parent-name"
                  type="text"
                  autoComplete="name"
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                  className={inputCls}
                  placeholder="비워 두셔도 돼요"
                />
                <label
                  htmlFor="parent-new-pw"
                  className="text-[14px] font-semibold text-[#334155] mt-1"
                >
                  사용할 비밀번호
                </label>
                <input
                  id="parent-new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={setupPw}
                  onChange={(e) => setSetupPw(e.target.value)}
                  className={inputCls}
                  placeholder="비밀번호 입력"
                />

                <label className="flex items-start gap-3 mt-2 cursor-pointer rounded-lg border border-[#E2E8F0] px-3 py-3">
                  <input
                    type="checkbox"
                    checked={isAgreed}
                    onChange={(e) => setIsAgreed(e.target.checked)}
                    className="mt-0.5 w-5 h-5 shrink-0 accent-[#2563EB]"
                  />
                  <span className="text-[13px] text-[#334155] leading-relaxed">
                    (필수) 만 14세 미만 자녀의 개인정보 수집·이용 및{" "}
                    <a
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#1D4ED8] underline underline-offset-2"
                    >
                      개인정보 처리방침
                    </a>
                    에 동의하며, 본인이 법정대리인임을 확인합니다.
                  </span>
                </label>

                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setAuthState("check_phone")}
                    className={`${secondaryBtn} !w-1/3`}
                  >
                    뒤로
                  </button>
                  <button type="submit" className={`${primaryBtn} !w-2/3`}>
                    설정하고 시작하기
                  </button>
                </div>
              </form>
            )}

            <div className="flex flex-col gap-4 pt-5 border-t border-[#E2E8F0]">
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-[#64748B] underline underline-offset-2 text-center"
              >
                개인정보 처리방침
              </a>
              <AcademyInfo />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const selectedStudent = studentsData.find(
    (s) => s.student_id === selectedStudentId
  );

  return (
    <div className="text-[#1E293B] relative h-[100dvh] w-full overflow-hidden flex flex-col font-pretendard bg-[#F8FAFC] overscroll-none">
      {authState === "dashboard" ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          <header className="bg-white shrink-0 z-20 border-b border-[#E2E8F0]">
            <div className="w-full max-w-2xl mx-auto px-4 h-14 flex justify-between items-center">
              <img src={LOGO_URL} className="h-6 object-contain" alt="로지카" />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={openSettingsModal}
                  className="min-h-[38px] px-2.5 py-1 flex items-center gap-2 text-[13.5px] font-semibold text-[#334155] hover:text-[#1E293B] hover:bg-[#F8FAFC] rounded-lg border border-[#E2E8F0] transition-colors"
                >
                  <span className="w-6 h-6 rounded-full bg-[#EFF6FF] border border-[#CBD5E1] overflow-hidden flex items-center justify-center shrink-0 text-[12px] text-[#1D4ED8] font-bold">
                    {parentAvatarUrl ? (
                      <img
                        src={parentAvatarUrl}
                        alt="프로필"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <svg
                        className="w-3.5 h-3.5 text-[#1D4ED8]"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                    )}
                  </span>
                  {infoName && (
                    <span className="max-w-[84px] truncate text-[#1E293B]">
                      {infoName}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[#64748B]">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    설정
                  </span>
                </button>

                <button
                  type="button"
                  onClick={logout}
                  className="min-h-[38px] px-2.5 text-[13.5px] font-medium text-[#64748B] hover:text-[#1E293B] hover:bg-[#F8FAFC] rounded-lg transition-colors"
                >
                  로그아웃
                </button>
              </div>
            </div>

            {!isDashboardLoading && studentsData.length > 1 && (
              <nav
                aria-label="자녀 선택"
                className="w-full max-w-2xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto"
              >
                {studentsData.map((student) => {
                  const active = selectedStudentId === student.student_id;
                  return (
                    <button
                      key={student.student_id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedStudentId(student.student_id)}
                      className={`shrink-0 min-h-[40px] px-4 rounded-full text-[14px] transition-colors ${
                        active
                          ? "bg-[#2563EB] text-white font-semibold shadow-xs"
                          : "bg-white text-[#334155] font-medium border border-[#CBD5E1] hover:bg-[#F8FAFC]"
                      }`}
                    >
                      {student.name}
                    </button>
                  );
                })}
              </nav>
            )}
          </header>

          {isDashboardLoading ? (
            <div
              className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center"
              role="status"
            >
              <span
                className="w-8 h-8 border-[3px] border-[#2563EB] border-t-transparent rounded-full animate-spin"
                aria-hidden="true"
              ></span>
              <div>
                <p className="text-[16px] font-semibold text-[#1E293B]">
                  자녀의 학습 기록을 불러오고 있어요
                </p>
                <p className="mt-1 text-[14px] text-[#64748B]">
                  기록이 많으면 몇 초 걸릴 수 있어요.
                </p>
              </div>
            </div>
          ) : (
            <>
              <main className="flex-1 overflow-y-auto w-full px-4 py-4 sm:py-6 pb-32 overscroll-contain">
                <div className="w-full max-w-2xl mx-auto flex flex-col gap-6">
                  {!selectedStudent ? (
                    <div className="bg-white rounded-xl border border-[#E2E8F0] px-5 py-12 text-center flex flex-col gap-2">
                      <p className="text-[16px] font-semibold text-[#1E293B]">
                        연결된 자녀 정보가 없어요
                      </p>
                      <p className="text-[14px] text-[#64748B]">
                        학원에 등록된 연락처와 로그인한 번호가 같은지 학원에 확인해 주세요.
                      </p>
                    </div>
                  ) : (
                    <StudentCard
                      key={selectedStudent.student_id}
                      student={selectedStudent}
                      authToken={authToken}
                      parentId={parentId}
                    />
                  )}
                  <AcademyInfo />
                </div>
              </main>

              {parentId && (
                <ChatWidget parentId={parentId} authToken={authToken} />
              )}
            </>
          )}

          {/* ⚙️ 학부모 프로필 및 비밀번호 설정 모달 */}
          {isSettingsOpen && (
            <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-md rounded-2xl border border-[#E2E8F0] shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
                <div className="px-5 py-4 bg-gradient-to-r from-[#1E3A8A] to-[#2563EB] text-white flex items-center justify-between shrink-0">
                  <h2 className="text-[17px] font-bold">학부모 계정 설정</h2>
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="text-white/80 hover:text-white text-2xl leading-none font-bold"
                  >
                    &times;
                  </button>
                </div>

                <form
                  onSubmit={handleSaveSettings}
                  className="p-5 flex flex-col gap-5 overflow-y-auto flex-1"
                >
                  {/* 1. 프로필 이미지 설정 */}
                  <div className="flex flex-col items-center gap-3 pb-4 border-b border-[#E2E8F0]">
                    <span className="text-[13px] font-semibold text-[#64748B]">
                      프로필 이미지 <span className="font-normal">(선택)</span>
                    </span>

                    {!cropImageSrc ? (
                      <>
                        <div className="w-20 h-20 rounded-full bg-[#F8FAFC] border-2 border-[#CBD5E1] overflow-hidden flex items-center justify-center">
                          {!removeAvatarFlag && parentAvatarUrl ? (
                            <img
                              src={parentAvatarUrl}
                              alt="학부모 프로필"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <svg
                              className="w-9 h-9 text-[#9AA5B1]"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="1.8"
                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                              />
                            </svg>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="relative overflow-hidden cursor-pointer px-3.5 py-1.5 rounded-lg bg-[#EFF6FF] hover:bg-[#dce8f5] text-[#1D4ED8] text-[13px] font-semibold transition-colors">
                            <span>사진 선택 및 자르기</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleAvatarFileChange}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                          </label>
                          {!removeAvatarFlag && parentAvatarUrl && (
                            <button
                              type="button"
                              onClick={() => setRemoveAvatarFlag(true)}
                              className="px-3 py-1.5 rounded-lg border border-[#CBD5E1] text-[#64748B] hover:text-[#C8372D] text-[13px] font-medium"
                            >
                              기본 이미지로
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="w-full bg-[#F8FAFC] p-3.5 rounded-xl border border-[#CBD5E1] flex flex-col items-center gap-2.5">
                        <span className="text-[12px] font-semibold text-[#1D4ED8]">
                          사진을 끌어서 위치를 맞춘 뒤 확대/축소해 주세요
                        </span>
                        <div
                          className="relative w-[150px] h-[150px] rounded-full overflow-hidden bg-white border-2 border-[#2563EB] cursor-move select-none"
                          style={{ touchAction: "none" }}
                          onMouseDown={(e) => startCropDrag(e.clientX, e.clientY)}
                          onMouseMove={(e) => moveCropDrag(e.clientX, e.clientY)}
                          onMouseUp={endCropDrag}
                          onMouseLeave={endCropDrag}
                          onTouchStart={(e) =>
                            startCropDrag(
                              e.touches[0].clientX,
                              e.touches[0].clientY
                            )
                          }
                          onTouchMove={(e) =>
                            moveCropDrag(
                              e.touches[0].clientX,
                              e.touches[0].clientY
                            )
                          }
                          onTouchEnd={endCropDrag}
                        >
                          <img
                            ref={cropImgRef}
                            src={cropImageSrc}
                            alt="크롭 미리보기"
                            draggable={false}
                            style={{
                              transform: `translate(-50%, -50%) scale(${cropZoom}) translate(${cropPos.x}px, ${cropPos.y}px)`,
                              transformOrigin: "center",
                            }}
                            className="absolute top-1/2 left-1/2 w-[150px] max-w-none pointer-events-none select-none"
                          />
                        </div>
                        <div className="w-full flex items-center gap-2 px-2">
                          <span className="text-[12px] text-[#64748B]">축소</span>
                          <input
                            type="range"
                            min={0.5}
                            max={3}
                            step={0.05}
                            value={cropZoom}
                            onChange={(e) =>
                              setCropZoom(parseFloat(e.target.value))
                            }
                            className="flex-1 accent-[#2563EB]"
                          />
                          <span className="text-[12px] text-[#64748B]">확대</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCropImageSrc(null)}
                          className="text-[12.5px] text-[#64748B] underline"
                        >
                          사진 선택 취소
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 2. 학부모 성함 설정 (선택사항) */}
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="settings-parent-name"
                      className="text-[14px] font-semibold text-[#334155]"
                    >
                      학부모님 성함{" "}
                      <span className="font-normal text-[#64748B]">
                        (선택사항)
                      </span>
                    </label>
                    <input
                      id="settings-parent-name"
                      type="text"
                      value={settingsName}
                      onChange={(e) => setSettingsName(e.target.value)}
                      className={inputCls}
                      placeholder="비워 두셔도 괜찮아요 (예: 김로지 학부모)"
                    />
                  </div>

                  {/* 3. 로그인 비밀번호 변경 */}
                  <div className="flex flex-col gap-2.5 pt-3 border-t border-[#E2E8F0]">
                    <div>
                      <h3 className="text-[14px] font-semibold text-[#334155]">
                        로그인 비밀번호 변경{" "}
                        <span className="font-normal text-[#64748B]">
                          (변경 시에만 입력)
                        </span>
                      </h3>
                    </div>

                    {parentHasPassword && (
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={settingsCurrentPw}
                        onChange={(e) => setSettingsCurrentPw(e.target.value)}
                        className={inputCls}
                        placeholder="현재 비밀번호"
                      />
                    )}
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={settingsNewPw}
                      onChange={(e) => setSettingsNewPw(e.target.value)}
                      className={inputCls}
                      placeholder="새 비밀번호 (4자리 이상)"
                    />
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={settingsNewPwConfirm}
                      onChange={(e) =>
                        setSettingsNewPwConfirm(e.target.value)
                      }
                      className={inputCls}
                      placeholder="새 비밀번호 확인"
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsSettingsOpen(false)}
                      className={`${secondaryBtn} !w-1/3`}
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingSettings}
                      className={`${primaryBtn} !w-2/3`}
                    >
                      {isSavingSettings ? "저장 중..." : "설정 저장하기"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      ) : (
        renderAuthSection()
      )}
    </div>
  );
}