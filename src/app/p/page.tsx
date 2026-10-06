// src/app/(dashboard)/p/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js"; // ★ 추가됨
import ChatWidget from "@/components/parent/ChatWidget";
import StudentCard from "@/components/parent/StudentCard";
import { verifyParentPhone, loginParentAction, setupParentAction, getParentAuthToken } from "@/app/actions/parentAuth";

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

const safeParseIds = (raw: any): number[] => {
  if (!raw) return [];
  try {
    let val = raw;
    if (typeof val === 'string') {
      if (val === "null" || val.trim() === "") return [];
      val = JSON.parse(val);
    }
    if (Array.isArray(val)) return val.map(Number);
  } catch (err) {
    console.warn("데이터 파싱 경고:", err);
  }
  return [];
};

export default function ParentPortalPage() {
  const [authState, setAuthState] = useState<"check_phone" | "login" | "setup" | "dashboard">("check_phone");
  const [isKakaoLoading, setIsKakaoLoading] = useState(false);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  
  const [phoneInput, setPhoneInput] = useState("");
  const [pwInput, setPwInput] = useState("");
  const [setupName, setSetupName] = useState("");
  const [setupPw, setSetupPw] = useState("");
  const [isAgreed, setIsAgreed] = useState(false); 
  
  const [parentId, setParentId] = useState<string | null>(null);
  const [infoName, setInfoName] = useState("");
  const [studentsData, setStudentsData] = useState<any[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

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
        kakaoPhone = meta.phone_number || meta.phone || session.user?.identities?.[0]?.identity_data?.phone_number || "";
      }

      if (!kakaoPhone) {
        alert("카카오에서 연락처 정보를 가져올 수 없습니다.\n카카오 계정 설정을 확인하거나 일반 로그인(전화번호)을 이용해주세요.");
        await supabase.auth.signOut();
        setIsKakaoLoading(false);
        return;
      }

      if (kakaoPhone.startsWith("+82")) {
        kakaoPhone = "0" + kakaoPhone.slice(3).trim(); 
      }
      
      const rawPhone = kakaoPhone.replace(/[^0-9]/g, ""); 

      try {
        const { data: foundParentId, error } = await supabase.rpc('get_parent_by_phone', { phone_req: rawPhone });
        
        if (foundParentId) {
          const token = await getParentAuthToken(foundParentId);
          sessionStorage.setItem("logica_parent_id", foundParentId);
          window.history.replaceState(null, "", window.location.pathname);
          setIsKakaoLoading(false);
          loadDashboard(foundParentId, token);
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
      const { data: { session } } = await supabase.auth.getSession();
      const isKakao = session?.user?.app_metadata?.provider === 'kakao';

      if (session && isKakao) {
        await handleKakaoSession(session);
      } else if (savedParentId && !hash.includes("access_token")) {
        getParentAuthToken(savedParentId).then(token => {
          loadDashboard(savedParentId, token);
        }).catch(err => {
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
      .replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));
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
      setAuthState("login");
    }
  };

  const loginParent = async () => {
    const result = await loginParentAction(phoneInput, pwInput);
    if (result.success && result.parentId) {
      const token = await getParentAuthToken(result.parentId);
      sessionStorage.setItem("logica_parent_id", result.parentId);
      loadDashboard(result.parentId, token);
    } else {
      alert(result.message);
    }
  };

  const setupParent = async () => {
    if (!isAgreed) return alert("개인정보 수집 및 법정대리인 동의에 체크해주세요.");
    if (!setupPw.trim() || !parentId) return alert("사용할 비밀번호를 입력해주세요.");
    
    const result = await setupParentAction(parentId, setupName, setupPw);
    if (result.success) {
      const token = await getParentAuthToken(parentId);
      sessionStorage.setItem("logica_parent_id", parentId);
      loadDashboard(parentId, token);
    } else {
      alert(result.message);
    }
  };

  const loginWithKakao = async () => {
    sessionStorage.setItem("logica_oauth_source", "parent");

    const { error } = await supabase.auth.signInWithOAuth({ 
      provider: "kakao", 
      options: { 
        redirectTo: `${window.location.origin}/p`,
        scopes: "phone_number profile_nickname profile_image account_email"
      }
    });
    if (error) alert("카카오 로그인 중 오류가 발생했습니다.");
  };

  const logout = async () => {
    if (confirm("로그아웃 하시겠습니까?")) {
      await supabase.auth.signOut({ scope: 'local' });
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

  const loadDashboard = async (pid: string, providedToken?: string) => {
    setParentId(pid);
    setAuthState("dashboard");
    setIsDashboardLoading(true);
    
    try {
      let token = providedToken;
      if (!token) {
        token = await getParentAuthToken(pid);
      }
      setAuthToken(token);

      // ★★★ 가장 완벽한 방법: 공식 API 옵션(accessToken)을 통해 매번 헤더에 토큰을 꽂아 넣습니다. ★★★
      const authSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: {
            headers: {
              Authorization: `Bearer ${token}`
            }
          },
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
          }
        }
      );

      const { data: pData, error: pError } = await authSupabase.from("parent").select("name, phone, phone_2").eq("parent_id", pid).single();
      
      setInfoName(pData?.name || "");

      if (!pData?.phone && !pData?.phone_2) return;

      const orConditions: string[] = [];
      [pData?.phone, pData?.phone_2].forEach(p => {
        if (!p) return;
        const raw = p.replace(/[^0-9]/g, "");
        const fmt = raw.replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));
        orConditions.push(`phone.eq.${raw},phone.eq.${fmt},phone_2.eq.${raw},phone_2.eq.${fmt}`);
      });

      const { data: allParents } = await authSupabase
        .from("parent")
        .select("parent_id")
        .or(orConditions.join(","));

      const pids = allParents?.map(p => p.parent_id) || [pid];

      const { data: sData, error } = await authSupabase
        .from("student")
        .select("*, enrollment(start_date, end_date, class(class_id, name, class_schedule(day_of_week, start_time, end_time), class_extra_session(id, session_date, reason, start_time, end_time, replaces_holiday_id), class_holiday(id, holiday_date, reason))), exam_assignment(total_score, status, created_at, exam_id), attendance(attendance_id, attendance_date, status, check_in_time, check_out_time), student_homework_result(status, completed_tq_ids, homework_assignment(homework_title, target_questions, due_date, created_at, book_id, textbook(title))), consultation_log(consultation_log_id, consultation_type, contact_method, parent_summary, created_at, instructor(name)), individual_makeup(makeup_id, schedule_date, status, classroom, instructor_note, instructor(name))")
        .in("parent_id", pids);

      // 에러가 났을 때 무시하지 않고 콘솔에 출력하도록 안전장치 추가
      if (error) {
        console.error("데이터 조회 에러:", error);
      }

      if (!error && sData && sData.length > 0) {
        const sorted = sData.sort((a, b) => (parseInt(b.grade) || 0) - (parseInt(a.grade) || 0));
        
        for (let stu of sorted) {
          const activeEnrollment = stu.enrollment?.find((e: any) => (!e.end_date || new Date(e.end_date) >= new Date()) && unwrap(e.class)?.class_id);
          const classId = activeEnrollment ? unwrap(activeEnrollment.class)?.class_id : null;
          
          if (classId) {
            const { data: ctData } = await authSupabase.from("class_textbook").select("*, textbook(*)").eq("class_id", classId);
            if (ctData && ctData.length > 0) {
              const bIds = ctData.map(cb => cb.book_id);
              
              let qData: any[] = [];
              for (const bId of bIds) {
                 let from = 0;
                 while (true) {
                   const { data: qChunk } = await authSupabase.from("textbook_question").select("tq_id, book_id, page_number, question_id").eq("book_id", bId).range(from, from + 999);
                   if (!qChunk || qChunk.length === 0) break;
                   qData.push(...qChunk);
                   if (qChunk.length < 1000) break;
                   from += 1000;
                 }
              }
              
              const globalStatusMap: Record<number, 'done' | 'homework'> = {};
              const qIdToTqId = new Map<number, number>();
              const bookPagesMap: Record<string, Set<number>> = {};
              const bookPageTqsMap: Record<string, Record<number, number[]>> = {};

              bIds.forEach(b => { bookPagesMap[b] = new Set(); bookPageTqsMap[b] = {}; });
              
              qData.forEach(q => {
                if (q.question_id) qIdToTqId.set(q.question_id, q.tq_id);
                const pNum = Number(q.page_number) || 0;
                bookPagesMap[q.book_id].add(pNum);
                if (!bookPageTqsMap[q.book_id][pNum]) bookPageTqsMap[q.book_id][pNum] = [];
                bookPageTqsMap[q.book_id][pNum].push(q.tq_id);
              });

              const { data: hwAssignments } = await authSupabase.from("homework_assignment")
                .select("book_id, target_questions, target_student_id, student_homework_result(student_id, completed_tq_ids, status)")
                .eq("class_id", classId)
                .in("book_id", bIds);
                
              hwAssignments?.forEach(hw => {
                 const targetQs = safeParseIds(hw.target_questions);
                 const isClassWide = !hw.target_student_id;
                 if (isClassWide || hw.target_student_id === stu.student_id) {
                   targetQs.forEach(tq => globalStatusMap[tq] = 'homework');
                 }
                 
                 hw.student_homework_result?.forEach((res: any) => {
                   if (res.student_id === stu.student_id) {
                      const parsedCompleted = safeParseIds(res.completed_tq_ids);
                      const isFullyCompleted = ['채점완료', '제출완료', '완료'].includes(res.status);
                      let completedQs = parsedCompleted;
                      if (isFullyCompleted && targetQs.length > 0) completedQs = Array.from(new Set([...targetQs, ...parsedCompleted]));
                      completedQs.forEach(tqId => globalStatusMap[tqId] = 'done');
                   }
                 });
              });

              let exAssigns: any[] = [];
              let fromEA = 0;
              while(true) {
                  const { data: chunk } = await authSupabase.from('exam_assignment')
                      .select('assignment_id, status, exam_id')
                      .eq('student_id', stu.student_id)
                      .range(fromEA, fromEA + 999);
                  if (!chunk || chunk.length === 0) break;
                  exAssigns.push(...chunk);
                  if (chunk.length < 1000) break;
                  fromEA += 1000;
              }
              const eIds = [...new Set(exAssigns.map(a => a.exam_id).filter(Boolean))];
              if (eIds.length > 0) {
                  let eItems: any[] = [];
                  for (let i = 0; i < eIds.length; i += 100) {
                      const chunkIds = eIds.slice(i, i + 100);
                      let fromEI = 0;
                      while(true) {
                          const { data: chunk } = await authSupabase.from('exam_item')
                             .select('exam_id, question_id')
                             .in('exam_id', chunkIds)
                             .range(fromEI, fromEI + 999);
                          if (!chunk || chunk.length === 0) break;
                          eItems.push(...chunk);
                          if (chunk.length < 1000) break;
                          fromEI += 1000;
                      }
                  }
                  const examQMap = new Map<string, number[]>();
                  eItems.forEach(item => {
                      if (!examQMap.has(item.exam_id)) examQMap.set(item.exam_id, []);
                      examQMap.get(item.exam_id)!.push(item.question_id);
                  });
                  exAssigns.forEach(assign => {
                      const qIdsInExam = examQMap.get(assign.exam_id) || [];
                      const isCompleted = ['채점완료', '제출완료', '완료'].includes(assign.status);
                      qIdsInExam.forEach(qId => {
                          const tqId = qIdToTqId.get(qId);
                          if (tqId) {
                              const curStatus = globalStatusMap[tqId];
                              if (isCompleted) {
                                  globalStatusMap[tqId] = 'done';
                              } else if (curStatus !== 'done') {
                                  globalStatusMap[tqId] = 'homework';
                              }
                          }
                      });
                  });
              }

              let hwAns: any[] = [];
              let fromHw = 0;
              while(true) {
                 const { data: chunk } = await authSupabase.from('student_homework_answer').select('tq_id, is_correct, grading_code').eq('student_id', stu.student_id).range(fromHw, fromHw + 999);
                 if (!chunk || chunk.length === 0) break;
                 hwAns.push(...chunk);
                 if (chunk.length < 1000) break;
                 fromHw += 1000;
              }
              hwAns.forEach(ans => {
                 if (['O', 'TO', 'RO'].includes(ans.grading_code) || ans.is_correct) globalStatusMap[ans.tq_id] = 'done';
              });

              let exAns: any[] = [];
              let fromEx = 0;
              while(true) {
                 const { data: chunk } = await authSupabase.from('student_answer').select('question_id, is_correct, grading_code').eq('student_id', stu.student_id).range(fromEx, fromEx + 999);
                 if (!chunk || chunk.length === 0) break;
                 exAns.push(...chunk);
                 if (chunk.length < 1000) break;
                 fromEx += 1000;
              }
              exAns.forEach(ans => {
                 const tqId = qIdToTqId.get(ans.question_id);
                 if (tqId && (['O', 'TO', 'RO'].includes(ans.grading_code) || ans.is_correct)) globalStatusMap[tqId] = 'done';
              });

              // 🌟 [중간 합류] 이 학생의 교재별 시작 페이지 (조회 실패 시 처음부터 계산)
              const startPageByBook: Record<string, number> = {};
              const { data: spRows, error: spErr } = await authSupabase.from('student_textbook_start')
                .select('book_id, start_page')
                .eq('class_id', classId)
                .eq('student_id', stu.student_id);
              if (spErr) console.warn("시작 페이지 조회 실패(무시하고 진행):", spErr.message);
              (spRows || []).forEach((r: any) => { startPageByBook[r.book_id] = Number(r.start_page); });

              stu.progressBooks = ctData.map(cb => {
                 const bId = cb.book_id;
                 const totalPages = Array.from(bookPagesMap[bId] || []).sort((a,b)=>a-b);
                 const startPage: number | undefined = startPageByBook[bId];
                 // 진도율 분모: 시작 페이지 이후 페이지만
                 const countedPages = startPage !== undefined ? totalPages.filter(p => p >= startPage) : totalPages;
                 let donePagesCount = 0;
                 const pageStatuses: Record<number, 'done'|'homework'|'none'|'excluded'> = {};

                 totalPages.forEach(p => {
                   const tqs = bookPageTqsMap[bId][p] || [];
                   let doneCount = 0;
                   let hwCount = 0;
                   tqs.forEach(tq => {
                     if (globalStatusMap[tq] === 'done') doneCount++;
                     else if (globalStatusMap[tq] === 'homework') hwCount++;
                   });
                   const isBeforeStart = startPage !== undefined && p < startPage;
                   if (tqs.length > 0 && doneCount === tqs.length) {
                     // 합류 이전 페이지를 끝낸 경우 완료로 보여주되 진도율에는 넣지 않음
                     pageStatuses[p] = 'done';
                     if (!isBeforeStart) donePagesCount++;
                   } else if (isBeforeStart) {
                     pageStatuses[p] = 'excluded';
                   } else if (doneCount > 0 || hwCount > 0) {
                     pageStatuses[p] = 'homework';
                   } else {
                     pageStatuses[p] = 'none';
                   }
                 });

                 const percent = countedPages.length > 0 ? Math.min(100, Math.round((donePagesCount / countedPages.length) * 100)) : 0;
                 return {
                   ...cb,
                   stats: { percent, donePagesCount, maxPageCount: countedPages.length, startPage, pageStatuses, bookPages: totalPages }
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

  // ==========================================================
  // 🎨 화면 (2026-10 리디자인, StudentCard와 같은 규칙)
  // 색: 남색 #002864(주색) / 바탕 #F5F7FA / 선 #E4E7EB / 본문 #1F2933 / 보조 #616E7C
  // ==========================================================
  const LOGO_URL = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png";
  const inputCls = "w-full min-h-[48px] px-4 rounded-lg border border-[#CBD2D9] bg-white text-[16px] text-[#1F2933] placeholder:text-[#9AA5B1] outline-none focus:border-[#002864] focus:ring-2 focus:ring-[#002864]/15";
  const primaryBtn = "w-full min-h-[48px] rounded-lg bg-[#002864] text-white text-[16px] font-semibold hover:bg-[#001a42] transition-colors";
  const secondaryBtn = "w-full min-h-[48px] rounded-lg border border-[#CBD2D9] bg-white text-[#3E4C59] text-[16px] font-semibold hover:bg-[#F5F7FA] transition-colors";

  const AcademyInfo = () => (
    <div className="text-[12px] text-[#616E7C] leading-relaxed text-center">
      <p className="font-semibold text-[#3E4C59]">(주)이배움 로지카대치본원학원</p>
      <p>대표자 천종현, 사업자등록번호 732-85-02927</p>
      <p>서울특별시 강남구 역삼로 448, 3층(대치동)</p>
      <p>대표번호 <a href="tel:025558875" className="underline underline-offset-2 text-[#3E4C59]">02-555-8875</a></p>
    </div>
  );

  const renderAuthSection = () => {
    if (authState === "dashboard") return null;
    if (isKakaoLoading) return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 bg-[#F5F7FA]" role="status">
        <span className="w-8 h-8 border-[3px] border-[#002864] border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
        <p className="text-[16px] font-semibold text-[#1F2933]">카카오 계정을 확인하고 있어요</p>
      </div>
    );

    return (
      <div className="flex-1 overflow-y-auto bg-[#F5F7FA]">
        <div className="min-h-full flex flex-col items-center justify-center px-5 py-10">
          <div className="w-full max-w-[400px] bg-white rounded-2xl border border-[#E4E7EB] px-6 py-8 flex flex-col gap-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <img src={LOGO_URL} className="h-9 object-contain" alt="로지카" />
              <div>
                <h1 className="text-[20px] font-bold text-[#1F2933]">
                  {authState === "setup" ? "처음 오셨군요" : "학부모님, 반가워요"}
                </h1>
                <p className="text-[14px] text-[#616E7C] mt-1">
                  {authState === "check_phone" && "자녀의 출결, 진도, 성적을 확인할 수 있어요."}
                  {authState === "login" && "비밀번호를 입력해 주세요."}
                  {authState === "setup" && "앞으로 쓰실 비밀번호를 정해 주세요."}
                </p>
              </div>
            </div>

            {authState === "check_phone" && (
              <div className="flex flex-col gap-5">
                <button type="button" onClick={loginWithKakao} className="w-full min-h-[52px] flex items-center justify-center gap-2 rounded-lg bg-[#FEE500] text-[rgba(0,0,0,0.85)] text-[16px] font-semibold hover:bg-[#F4DC00] transition-colors">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3c-5.523 0-10 3.51-10 7.839 0 2.825 1.83 5.305 4.606 6.643l-1.18 4.316c-.086.315.267.559.53.376l5.06-3.348c.323.033.655.051.984.051 5.523 0 10-3.51 10-7.839C22 6.51 17.523 3 12 3z"/></svg>
                  카카오로 시작하기
                </button>

                <div className="flex items-center gap-3" aria-hidden="true">
                  <div className="flex-1 border-t border-[#E4E7EB]"></div>
                  <span className="text-[13px] text-[#616E7C]">또는 전화번호로</span>
                  <div className="flex-1 border-t border-[#E4E7EB]"></div>
                </div>

                <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); checkPhone(); }}>
                  <label htmlFor="parent-phone" className="text-[14px] font-semibold text-[#3E4C59]">학원에 등록한 학부모 휴대전화번호</label>
                  <input id="parent-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={13} value={phoneInput} onChange={e => handlePhoneInput(e.target.value)} className={`${inputCls} tracking-wide`} placeholder="010-0000-0000" />
                  <button type="submit" className={secondaryBtn}>전화번호로 로그인</button>
                </form>
              </div>
            )}

            {authState === "login" && (
              <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); loginParent(); }}>
                <div className="rounded-lg bg-[#F5F7FA] px-4 py-3 text-[15px] text-[#3E4C59] tabular-nums">{phoneInput}</div>
                <label htmlFor="parent-pw" className="text-[14px] font-semibold text-[#3E4C59]">비밀번호</label>
                <input id="parent-pw" type="password" autoComplete="current-password" value={pwInput} onChange={e => setPwInput(e.target.value)} className={inputCls} placeholder="비밀번호 입력" autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => setAuthState("check_phone")} className={`${secondaryBtn} !w-1/3`}>뒤로</button>
                  <button type="submit" className={`${primaryBtn} !w-2/3`}>로그인</button>
                </div>
              </form>
            )}

            {authState === "setup" && (
              <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); setupParent(); }}>
                <div className="rounded-lg bg-[#F5F7FA] px-4 py-3 text-[15px] text-[#3E4C59] tabular-nums">{phoneInput}</div>
                <label htmlFor="parent-name" className="text-[14px] font-semibold text-[#3E4C59]">학부모님 성함 <span className="font-normal text-[#616E7C]">(선택)</span></label>
                <input id="parent-name" type="text" autoComplete="name" value={setupName} onChange={e => setSetupName(e.target.value)} className={inputCls} placeholder="비워 두셔도 돼요" />
                <label htmlFor="parent-new-pw" className="text-[14px] font-semibold text-[#3E4C59] mt-1">사용할 비밀번호</label>
                <input id="parent-new-pw" type="password" autoComplete="new-password" value={setupPw} onChange={e => setSetupPw(e.target.value)} className={inputCls} placeholder="비밀번호 입력" />

                <label className="flex items-start gap-3 mt-2 cursor-pointer rounded-lg border border-[#E4E7EB] px-3 py-3">
                  <input
                    type="checkbox"
                    checked={isAgreed}
                    onChange={(e) => setIsAgreed(e.target.checked)}
                    className="mt-0.5 w-5 h-5 shrink-0 accent-[#002864]"
                  />
                  <span className="text-[13px] text-[#3E4C59] leading-relaxed">
                    (필수) 만 14세 미만 자녀의 개인정보 수집·이용 및 <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#002864] underline underline-offset-2">개인정보 처리방침</a>에 동의하며, 본인이 법정대리인임을 확인합니다.
                  </span>
                </label>

                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => setAuthState("check_phone")} className={`${secondaryBtn} !w-1/3`}>뒤로</button>
                  <button type="submit" className={`${primaryBtn} !w-2/3`}>설정하고 시작하기</button>
                </div>
              </form>
            )}

            <div className="flex flex-col gap-4 pt-5 border-t border-[#E4E7EB]">
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[13px] text-[#616E7C] underline underline-offset-2 text-center">개인정보 처리방침</a>
              <AcademyInfo />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const selectedStudent = studentsData.find(s => s.student_id === selectedStudentId);

  return (
    <div className="text-[#1F2933] relative h-[100dvh] w-full overflow-hidden flex flex-col font-pretendard bg-[#F5F7FA] overscroll-none">

      {authState === "dashboard" ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">

          <header className="bg-white shrink-0 z-20 border-b border-[#E4E7EB]">
            <div className="w-full max-w-2xl mx-auto px-4 h-14 flex justify-between items-center">
              <img src={LOGO_URL} className="h-6 object-contain" alt="로지카" />
              <button type="button" onClick={logout} className="min-h-[44px] px-3 text-[14px] font-medium text-[#616E7C] hover:text-[#1F2933] rounded-lg transition-colors">
                로그아웃
              </button>
            </div>

            {!isDashboardLoading && studentsData.length > 1 && (
              <nav aria-label="자녀 선택" className="w-full max-w-2xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto">
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
                          ? "bg-[#002864] text-white font-semibold"
                          : "bg-white text-[#3E4C59] font-medium border border-[#CBD2D9] hover:bg-[#F5F7FA]"
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
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center" role="status">
              <span className="w-8 h-8 border-[3px] border-[#002864] border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              <div>
                <p className="text-[16px] font-semibold text-[#1F2933]">자녀의 학습 기록을 불러오고 있어요</p>
                <p className="mt-1 text-[14px] text-[#616E7C]">기록이 많으면 몇 초 걸릴 수 있어요.</p>
              </div>
            </div>
          ) : (
            <>
              <main className="flex-1 overflow-y-auto w-full px-4 py-4 sm:py-6 pb-32 overscroll-contain">
                <div className="w-full max-w-2xl mx-auto flex flex-col gap-6">
                  {!selectedStudent ? (
                    <div className="bg-white rounded-xl border border-[#E4E7EB] px-5 py-12 text-center flex flex-col gap-2">
                      <p className="text-[16px] font-semibold text-[#1F2933]">연결된 자녀 정보가 없어요</p>
                      <p className="text-[14px] text-[#616E7C]">학원에 등록된 연락처와 로그인한 번호가 같은지 학원에 확인해 주세요.</p>
                    </div>
                  ) : (
                    <StudentCard key={selectedStudent.student_id} student={selectedStudent} />
                  )}
                  <AcademyInfo />
                </div>
              </main>

              {parentId && <ChatWidget parentId={parentId} authToken={authToken} />}
            </>
          )}
        </div>
      ) : (
        renderAuthSection()
      )}
    </div>
  );
}