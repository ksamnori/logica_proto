// 학부모 포탈 페이지 파일 전체 복사 & 붙여넣기
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import ChatWidget from "@/components/parent/ChatWidget";
import StudentCard from "@/components/parent/StudentCard";
import { verifyParentPhone, loginParentAction, setupParentAction } from "@/app/actions/parentAuth";

// 🌟 데이터 파싱을 위한 유틸리티 함수 추가
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
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [authState, setAuthState] = useState<"check_phone" | "login" | "setup" | "dashboard">("check_phone");
  const [isKakaoLoading, setIsKakaoLoading] = useState(false);
  
  const [phoneInput, setPhoneInput] = useState("");
  const [pwInput, setPwInput] = useState("");
  const [setupName, setSetupName] = useState("");
  const [setupPw, setSetupPw] = useState("");
  
  const [parentId, setParentId] = useState<string | null>(null);
  const [infoName, setInfoName] = useState("");
  const [studentsData, setStudentsData] = useState<any[]>([]);
  
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  const isExitModalOpenRef = useRef(isExitModalOpen);
  isExitModalOpenRef.current = isExitModalOpen;
  const authStateRef = useRef(authState);
  authStateRef.current = authState;

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (isExitModalOpenRef.current) {
        setIsExitModalOpen(false);
        window.history.pushState({ app_state: "trap" }, "", window.location.href);
      } else if (authStateRef.current === "dashboard") {
        setIsExitModalOpen(true);
        window.history.pushState({ app_state: "modal" }, "", window.location.href);
      } else {
        window.history.pushState({ app_state: "trap" }, "", window.location.href);
      }
    };
    window.history.replaceState({ app_state: "main" }, "", window.location.href);
    window.history.pushState({ app_state: "trap" }, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => { window.removeEventListener("popstate", handlePopState); };
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    const search = window.location.search;
    
    // 🌟 [핵심 방어 1] 카카오 로그인 시간이 초과되거나 에러로 튕겨 돌아왔을 때 무한 로딩 방지 및 초기화
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
      const formattedPhone = rawPhone.replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));

      try {
        const { data } = await supabase
          .from("parent")
          .select("parent_id")
          .or(`phone.eq.${rawPhone},phone.eq.${formattedPhone}`)
          .limit(1)
          .maybeSingle();
        
        if (data) {
          sessionStorage.setItem("logica_parent_id", data.parent_id);
          window.history.replaceState({ app_state: "trap" }, "", window.location.pathname);
          setIsKakaoLoading(false);
          loadDashboard(data.parent_id);
        } else {
          alert(`등록된 학원 연락처(${formattedPhone})와 일치하는 학부모 정보가 없습니다.`);
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
      if (session) await handleKakaoSession(session);
      else if (savedParentId && !hash.includes("access_token")) loadDashboard(savedParentId);
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
    setAuthState(result.needsSetup ? "setup" : "login");
  };

  const loginParent = async () => {
    const result = await loginParentAction(phoneInput, pwInput);
    if (result.success && result.parentId) {
      sessionStorage.setItem("logica_parent_id", result.parentId);
      loadDashboard(result.parentId);
    } else {
      alert(result.message);
    }
  };

  const setupParent = async () => {
    if (!setupName.trim() || !setupPw.trim() || !parentId) return alert("모두 입력해주세요.");
    const result = await setupParentAction(parentId, setupName, setupPw);
    if (result.success) {
      sessionStorage.setItem("logica_parent_id", parentId);
      loadDashboard(parentId);
    } else {
      alert(result.message);
    }
  };

  const loginWithKakao = async () => {
    // 🌟 [핵심 방어 2] 카카오 로그인 출발지가 '학부모 페이지'임을 브라우저에 단기 기록
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
      await supabase.auth.signOut();
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    }
  };

  const loadDashboard = async (pid: string) => {
    setParentId(pid);
    setAuthState("dashboard");
    try {
      const { data: pData } = await supabase.from("parent").select("name, phone").eq("parent_id", pid).single();
      setInfoName(pData?.name || "");

      if (!pData?.phone) return;

      const rawPhone = pData.phone.replace(/[^0-9]/g, "");
      const formattedPhone = rawPhone.replace(/^(\d{0,3})(\d{0,4})(\d{0,4})$/g, (m: string, p1: string, p2: string, p3: string) => p1 + (p2 ? "-" + p2 : "") + (p3 ? "-" + p3 : ""));

      const { data: allParents } = await supabase
        .from("parent")
        .select("parent_id")
        .or(`phone.eq.${rawPhone},phone.eq.${formattedPhone}`);

      const pids = allParents?.map(p => p.parent_id) || [pid];

      const { data: sData, error } = await supabase
        .from("student")
        .select("*, enrollment(start_date, end_date, class(class_id, name, class_schedule(day_of_week, start_time), class_extra_session(id, session_date, reason, start_time, end_time, replaces_holiday_id), class_holiday(id, holiday_date, reason))), exam_assignment(total_score, status, created_at, exam_id), attendance(attendance_id, attendance_date, status, check_in_time, check_out_time), student_homework_result(status, completed_tq_ids, homework_assignment(homework_title, target_questions, due_date, created_at, book_id, textbook(title))), consultation_log(consultation_log_id, consultation_type, contact_method, parent_summary, created_at, instructor(name)), individual_makeup(makeup_id, schedule_date, status, classroom, instructor_note, instructor(name))")
        .in("parent_id", pids);

      if (!error && sData && sData.length > 0) {
        const sorted = sData.sort((a, b) => (parseInt(b.grade) || 0) - (parseInt(a.grade) || 0));
        
        for (let stu of sorted) {
          const activeEnrollment = stu.enrollment?.find((e: any) => (!e.end_date || new Date(e.end_date) >= new Date()) && unwrap(e.class)?.class_id);
          const classId = activeEnrollment ? unwrap(activeEnrollment.class)?.class_id : null;
          
          if (classId) {
            const { data: ctData } = await supabase.from("class_textbook").select("*, textbook(*)").eq("class_id", classId);
            if (ctData && ctData.length > 0) {
              const bIds = ctData.map(cb => cb.book_id);
              
              let qData: any[] = [];
              for (const bId of bIds) {
                 let from = 0;
                 while (true) {
                   const { data: qChunk } = await supabase.from("textbook_question").select("tq_id, book_id, page_number, question_id").eq("book_id", bId).range(from, from + 999);
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

              const { data: hwAssignments } = await supabase.from("homework_assignment")
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
                  const { data: chunk } = await supabase.from('exam_assignment')
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
                          const { data: chunk } = await supabase.from('exam_item')
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
                 const { data: chunk } = await supabase.from('student_homework_answer').select('tq_id, is_correct, grading_code').eq('student_id', stu.student_id).range(fromHw, fromHw + 999);
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
                 const { data: chunk } = await supabase.from('student_answer').select('question_id, is_correct, grading_code').eq('student_id', stu.student_id).range(fromEx, fromEx + 999);
                 if (!chunk || chunk.length === 0) break;
                 exAns.push(...chunk);
                 if (chunk.length < 1000) break;
                 fromEx += 1000;
              }
              exAns.forEach(ans => {
                 const tqId = qIdToTqId.get(ans.question_id);
                 if (tqId && (['O', 'TO', 'RO'].includes(ans.grading_code) || ans.is_correct)) globalStatusMap[tqId] = 'done';
              });

              stu.progressBooks = ctData.map(cb => {
                 const bId = cb.book_id;
                 const totalPages = Array.from(bookPagesMap[bId] || []).sort((a,b)=>a-b);
                 let donePagesCount = 0;
                 const pageStatuses: Record<number, 'done'|'homework'|'none'> = {};

                 totalPages.forEach(p => {
                   const tqs = bookPageTqsMap[bId][p] || [];
                   let doneCount = 0;
                   let hwCount = 0;
                   tqs.forEach(tq => {
                     if (globalStatusMap[tq] === 'done') doneCount++;
                     else if (globalStatusMap[tq] === 'homework') hwCount++;
                   });
                   if (tqs.length > 0 && doneCount === tqs.length) {
                     pageStatuses[p] = 'done';
                     donePagesCount++;
                   } else if (doneCount > 0 || hwCount > 0) {
                     pageStatuses[p] = 'homework';
                   } else {
                     pageStatuses[p] = 'none';
                   }
                 });

                 const percent = totalPages.length > 0 ? Math.min(100, Math.round((donePagesCount / totalPages.length) * 100)) : 0;
                 return {
                   ...cb,
                   stats: { percent, donePagesCount, maxPageCount: totalPages.length, pageStatuses, bookPages: totalPages }
                 };
              });
            }
          }
        }
        
        setStudentsData(sorted);
        setSelectedStudentId(sorted[0].student_id);
      }
    } catch (err) { console.error("대시보드 로드 에러", err); }
  };

  const renderAuthSection = () => {
    if (authState === "dashboard") return null;
    if (isKakaoLoading) return (
      <div className="flex-1 flex items-center justify-center p-4 bg-slate-50">
        <div className="text-lg font-bold text-[#FEE500] bg-slate-800 px-6 py-3 rounded-full animate-pulse shadow-lg">카카오 계정 연동 중...</div>
      </div>
    );
    
    return (
      <div className="flex-1 flex items-center justify-center p-4 h-full bg-slate-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100">
          <div className="text-center mb-6 flex justify-center">
            <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-10 object-contain" alt="Logica" />
          </div>
          {authState === "check_phone" && (
            <div className="animate-[fadeIn_0.3s_ease-out]">
              <button onClick={loginWithKakao} className="w-full flex items-center justify-center gap-2 bg-[#FEE500] text-[#000000] font-black py-4 px-4 rounded-xl hover:bg-[#e6cf00] transition-colors shadow-md mb-6">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-5.523 0-10 3.51-10 7.839 0 2.825 1.83 5.305 4.606 6.643l-1.18 4.316c-.086.315.267.559.53.376l5.06-3.348c.323.033.655.051.984.051 5.523 0 10-3.51 10-7.839C22 6.51 17.523 3 12 3z"/></svg>
                카카오톡으로 1초만에 시작하기
              </button>
              
              <div className="flex items-center my-6">
                <div className="flex-1 border-t border-slate-200"></div>
                <span className="px-4 text-xs font-bold text-slate-400">또는 다른 방법으로 로그인</span>
                <div className="flex-1 border-t border-slate-200"></div>
              </div>
              
              <input type="text" maxLength={13} value={phoneInput} onChange={e => handlePhoneInput(e.target.value)} className="w-full px-4 py-3 mb-4 rounded-xl border border-slate-300 text-center font-bold outline-none focus:border-[#002864]" placeholder="등록된 학부모 휴대전화번호" />
              <button onClick={checkPhone} className="w-full bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200 transition-colors">전화번호로 로그인</button>
            </div>
          )}

          <div className="mt-6 text-center">
            <a 
              href="/privacy" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-[11px] font-bold text-slate-400 hover:text-slate-600 underline decoration-slate-300 underline-offset-2"
            >
              개인정보 처리방침
            </a>
          </div>

          {authState === "login" && (
            <div className="animate-[fadeIn_0.3s_ease-out]">
              <input type="password" value={pwInput} onChange={e => setPwInput(e.target.value)} className="w-full px-4 py-3 mb-4 rounded-xl border border-slate-300 text-center font-bold outline-none focus:border-[#002864]" placeholder="비밀번호 입력" />
              <div className="flex gap-2">
                <button onClick={() => setAuthState("check_phone")} className="w-1/3 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl">뒤로</button>
                <button onClick={loginParent} className="w-2/3 bg-[#002864] text-white font-bold py-3.5 rounded-xl">로그인</button>
              </div>
            </div>
          )}
          {authState === "setup" && (
            <div className="animate-[fadeIn_0.3s_ease-out]">
              <div className="bg-blue-50 text-blue-600 font-bold text-xs p-3 rounded-lg mb-4 text-center">처음 오셨군요! 사용할 비밀번호를 설정해주세요.</div>
              <input type="text" value={setupName} onChange={e => setSetupName(e.target.value)} className="w-full px-4 py-2.5 mb-3 rounded-lg border border-slate-300 font-bold text-center" placeholder="학부모님 성함 (예: 홍길동)" />
              <input type="password" value={setupPw} onChange={e => setSetupPw(e.target.value)} className="w-full px-4 py-2.5 mb-5 rounded-lg border border-slate-300 font-bold text-center" placeholder="사용할 비밀번호 설정" />
              <button onClick={setupParent} className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl">비밀번호 설정 완료</button>
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <a 
              href="/privacy" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-[11px] font-bold text-slate-400 hover:text-slate-600 underline decoration-slate-300 underline-offset-2 mb-4 inline-block"
            >
            </a>
            
            <div className="text-[10px] text-slate-400 leading-relaxed">
              <p className="font-bold text-slate-500 mb-1">LOGICA학원 대치 본원</p>
              <p>대표자: 이웅행 | 사업자등록번호: 732-85-02927</p>
              <p>주소: 서울특별시 강남구 역삼로 448, 3층(대치동)</p>
              <p>대표번호: 02-555-8875</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const selectedStudent = studentsData.find(s => s.student_id === selectedStudentId);

  return (
    <div className="text-slate-800 relative h-[100dvh] w-full overflow-hidden flex flex-col font-pretendard bg-slate-50 overscroll-none">
      
      {isExitModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[280px] rounded-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="p-6 text-center space-y-2"><div className="text-4xl mb-3">👋</div><h2 className="font-bold text-lg text-slate-800">앱을 종료하시겠습니까?</h2></div>
            <div className="flex border-t border-slate-200">
              <button onClick={() => { setIsExitModalOpen(false); window.history.replaceState({ app_state: "trap" }, "", window.location.href); }} className="flex-1 py-3.5 text-slate-500 font-bold border-r border-slate-200">취소</button>
              <button onClick={() => window.history.go(-2)} className="flex-1 py-3.5 text-rose-500 font-bold">종료하기</button>
            </div>
          </div>
        </div>
      )}

      {authState === "dashboard" ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          
          <header className="bg-white px-6 py-4 flex justify-between items-center shadow-sm shrink-0 z-20">
            <div className="flex items-center">
              <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-6 object-contain" alt="Logica" />
            </div>
            <button onClick={logout} className="text-xs font-bold text-slate-500 hover:text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg transition-colors">
              로그아웃
            </button>
          </header>

          {studentsData.length > 1 && (
            <div className="bg-white px-4 pb-3 shrink-0 z-10 border-b border-slate-200">
              <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                {studentsData.map((student) => (
                  <button
                    key={student.student_id}
                    onClick={() => setSelectedStudentId(student.student_id)}
                    className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                      selectedStudentId === student.student_id
                        ? "bg-white text-slate-800 shadow-sm border border-slate-200"
                        : "text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    {student.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <main className="flex-1 overflow-y-auto custom-scroll w-full mx-auto p-4 sm:p-6 pb-32 overscroll-contain">
            <div className="w-full max-w-4xl mx-auto">
              {!selectedStudent ? (
                <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-2xl border border-slate-200">등록된 자녀 정보가 없습니다.</div>
              ) : (
                <StudentCard student={selectedStudent} />
              )}
            </div>
          </main>

          {parentId && <ChatWidget parentId={parentId} />}
        </div>
      ) : (
        renderAuthSection()
      )}
    </div>
  );
}