// src/app/(dashboard)/admission/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { unassignStudentAction, forceAssignExamAction } from "@/app/actions/admission";
import AssignModal from "@/components/admission/AssignModal";
import CounselingModal from "@/components/admission/CounselingModal";
import LevelTestModal from "@/components/admission/LevelTestModal"; 

const parseExamGrade = (session: any) => {
  const texts = [
    session.title,
    session.exam_master?.title,
    session.exam_master?.sub_title,
    session.exam_master?.major_grade
  ].filter(Boolean).join(" ");

  let match = texts.match(/초등?\s*([1-6])\s*[-_]?\s*([1-2])/);
  if (match) return `초${match[1]}-${match[2]}`;
  
  match = texts.match(/중등?\s*([1-3])\s*[-_]?\s*([1-2])/);
  if (match) return `중${match[1]}-${match[2]}`;

  match = texts.match(/(7|8|9)\s*[-_]?\s*([1-2])/);
  if (match) return `중${parseInt(match[1], 10) - 6}-${match[2]}`;

  match = texts.match(/고등?\s*([1-3])\s*[-_]?\s*([1-2])/);
  if (match) return `고${match[1]}-${match[2]}`;

  match = texts.match(/초등?\s*([1-6])/);
  if (match) return `초${match[1]}`;

  match = texts.match(/중등?\s*([1-3])/);
  if (match) return `중${match[1]}`;

  match = texts.match(/고등?\s*([1-3])/);
  if (match) return `고${match[1]}`;

  match = texts.match(/(7|8|9)학년/);
  if (match) return `중${parseInt(match[1], 10) - 6}`;

  return "기타";
};

const getTestGradeOrder = (g: string) => {
  if (g === "기타") return 999;
  let weight = 0;
  if (g.startsWith("초")) weight = 100;
  else if (g.startsWith("중")) weight = 200;
  else if (g.startsWith("고")) weight = 300;
  
  const nums = g.match(/\d+/g);
  if (nums && nums.length > 0) {
    weight += parseInt(nums[0], 10) * 10;
    if (nums.length > 1) weight += parseInt(nums[1], 10);
  }
  return weight;
};

const formatDateTimeDisplay = (dtString: string) => {
  if (!dtString) return "";
  const parts = dtString.split(" ");
  const datePart = parts[0];
  const timePart = parts[1] || "";
  
  const dParts = datePart.split("-");
  let dateStr = datePart;
  if (dParts.length >= 3) {
    dateStr = `${parseInt(dParts[1], 10)}월 ${parseInt(dParts[2], 10)}일`;
  }
  return timePart ? `${dateStr} ${timePart}` : dateStr;
};

export default function AdmissionPage() {
  const router = useRouter();

  // 🌟 [보안 로직 추가] 권한 확인 상태
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [shadowMap, setShadowMap] = useState<any>({});
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingApps, setIsLoadingApps] = useState(false);

  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [counselData, setCounselData] = useState<any | null>(null);
  const [isLevelTestModalOpen, setIsLevelTestModalOpen] = useState(false);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [filterDateTime, setFilterDateTime] = useState("ALL");
  const [filterGrade, setFilterGrade] = useState("ALL");
  const [searchKeyword, setSearchKeyword] = useState("");
  
  const [primarySort, setPrimarySort] = useState<"date" | "grade">("date");
  const [dateSortOrder, setDateSortOrder] = useState<"desc" | "asc">("desc");
  const [gradeSortOrder, setGradeSortOrder] = useState<"asc" | "desc">("asc");

  const [isFiltersLoaded, setIsFiltersLoaded] = useState(false);

  const appsScrollRef = useRef<HTMLDivElement>(null);

  // 🌟 [보안 로직 추가] 컴포넌트 마운트 시 즉시 권한부터 검사합니다!
  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || 
                        pos.includes('최고관리자') || pos.includes('원장');
      
      if (isGodMode) {
        setIsAuthorized(true);
        return;
      }

      if (!tId || !role) {
         alert("권한 정보가 없습니다.");
         router.replace("/home");
         return;
      }

      const { data } = await supabase
        .from('tenant_role_permissions')
        .select('allowed_menus')
        .eq('tenant_id', tId)
        .eq('role_name', role)
        .maybeSingle();

      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/admission"))) {
        alert("⛔ 진단평가 관리 페이지에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
      }
    };

    checkAccess();
  }, [router]);

  useEffect(() => {
    const savedDt = sessionStorage.getItem('logica_adm_filter_dt');
    const savedGr = sessionStorage.getItem('logica_adm_filter_gr');
    const savedKw = sessionStorage.getItem('logica_adm_filter_kw');
    
    if (savedDt) setFilterDateTime(savedDt);
    if (savedGr) setFilterGrade(savedGr);
    if (savedKw !== null) setSearchKeyword(savedKw);
    
    setIsFiltersLoaded(true);
  }, []);

  useEffect(() => {
    if (isFiltersLoaded) {
      sessionStorage.setItem('logica_adm_filter_dt', filterDateTime);
      sessionStorage.setItem('logica_adm_filter_gr', filterGrade);
      sessionStorage.setItem('logica_adm_filter_kw', searchKeyword);
    }
  }, [filterDateTime, filterGrade, searchKeyword, isFiltersLoaded]);

  const formatGrade = (grade: any) => {
    if (!grade) return '-';
    if (isNaN(Number(grade))) return grade;
    const g = parseInt(grade, 10);
    if (g >= 1 && g <= 6) return `초${g}`;
    if (g >= 7 && g <= 9) return `중${g - 6}`;
    if (g >= 10 && g <= 12) return `고${g - 9}`;
    return `${g}학년`;
  };

  const getStudentGradeOrder = (g: any) => {
    if (!g) return 99;
    const str = String(g).trim();
    if (str.includes('7세')) return 0;
    const gradeMap: Record<string, number> = { '초1':1, '초2':2, '초3':3, '초4':4, '초5':5, '초6':6, '중1':7, '중2':8, '중3':9, '고1':10, '고2':11, '고3':12 };
    if (gradeMap[str]) return gradeMap[str];
    const num = parseInt(str, 10);
    return isNaN(num) ? 99 : num;
  };

  const fetchSessions = async () => {
    setIsLoadingSessions(true);
    const { data, error } = await supabase
      .from('admission_session')
      .select('*, exam_master(title, sub_title, major_grade), admission_application(application_id)')
      .order('test_date', { ascending: false }); 
      
    if (error) console.error("일정 로드 오류:", error);

    const enrichedData = data?.map(s => ({
      ...s,
      _extractedGrade: parseExamGrade(s)
    })) || [];

    setSessions(enrichedData);
    
    setSelectedSession((prev: any) => {
      if (enrichedData.length > 0) {
        const savedId = sessionStorage.getItem('logica_adm_selected_session_id');
        if (savedId) {
          const match = enrichedData.find((s: any) => String(s.admission_session_id) === savedId);
          if (match) return match; 
        }

        if (prev?.admission_session_id) {
          const stillExists = enrichedData.find((s: any) => String(s.admission_session_id) === String(prev.admission_session_id));
          if (stillExists) return stillExists;
        }

        return enrichedData[0];
      }
      return null;
    });

    setIsLoadingSessions(false);
  };

  const fetchApplications = async (sessionId: string, examId: string) => {
    setIsLoadingApps(true);
    try {
      const { data: apps, error } = await supabase
        .from('admission_application')
        .select('*, student(name, grade, school, school_name, phone, parent(phone))')
        .eq('admission_session_id', sessionId);
        
      if (error) throw error;

      const validApps = (apps || []).sort((a: any, b: any) => (a.student?.name || '').localeCompare(b.student?.name || '', 'ko-KR'));
      const studentIds = validApps.map((a: any) => a.student_id);
      
      let sMap: any = {};
      
      if (studentIds.length > 0) {
        const fetchAssignments = async () => {
          const { data: assignments, error: assignErr } = await supabase.from('exam_assignment').select('*').in('student_id', studentIds);
          if (assignErr) throw assignErr;
          
          const map: any = {};
          assignments?.forEach((a: any) => {
            if (String(a.admission_session_id) === String(sessionId) || (examId && String(a.exam_id) === String(examId))) {
              if (!map[a.student_id] || a.status === '채점완료') map[a.student_id] = a;
            }
          });
          return map;
        };

        sMap = await fetchAssignments();

        if (examId) {
          const unassignedStudents = validApps.filter((app: any) => !sMap[app.student_id]);
          if (unassignedStudents.length > 0) {
            await Promise.all(
              unassignedStudents.map(async (app: any) => {
                const res = await forceAssignExamAction(app.student_id, sessionId, examId);
                if (!res.success) console.error("자동 연결 실패:", res.message);
              })
            );
            sMap = await fetchAssignments();
          }
        }
      }
      
      setApplications(validApps);
      setShadowMap(sMap);
    } catch (e: any) {
      console.error("fetchApplications Error:", e);
    } finally {
      setIsLoadingApps(false);
    }
  };

  // 권한이 통과되었을 때만 데이터 페칭을 시작하도록 방어
  useEffect(() => {
    if (isAuthorized) {
      fetchSessions();
    }
  }, [refreshTrigger, isAuthorized]);

  useEffect(() => {
    if (isAuthorized) {
      if (selectedSession?.admission_session_id) {
        fetchApplications(selectedSession.admission_session_id, selectedSession.exam_id);
      } else {
        setApplications([]);
        setShadowMap({});
      }
    }
  }, [selectedSession?.admission_session_id, selectedSession?.exam_id, refreshTrigger, isAuthorized]);

  useEffect(() => {
    if (!isLoadingApps && appsScrollRef.current) {
      const savedScroll = sessionStorage.getItem('logica_adm_apps_scroll');
      if (savedScroll) {
        appsScrollRef.current.scrollTop = parseInt(savedScroll, 10);
      }
    }
  }, [isLoadingApps, applications]);

  const handleScroll = () => {
    if (appsScrollRef.current) {
      sessionStorage.setItem('logica_adm_apps_scroll', appsScrollRef.current.scrollTop.toString());
    }
  };

  const forceAssignExam = async (studentId: string, sessionId: string, examId: string) => {
    const res = await forceAssignExamAction(studentId, sessionId, examId);
    if(res.success) setRefreshTrigger(prev => prev + 1);
    else alert("시험지 연결 실패: " + res.message);
  };

  const unassignStudent = async (studentId: string, studentName: string, sessionId: string) => {
    if (!confirm(`[${studentName}] 지원자의 테스트 예약을 취소하시겠습니까?\n(제출한 채점 답안 영구 삭제)`)) return;
    const res = await unassignStudentAction(studentId, sessionId);
    if(res.success) { 
      alert(`✅ 취소 완료`); 
      setRefreshTrigger(prev => prev + 1); 
    } else { 
      alert(`❌ 취소 실패: ${res.message}`); 
    }
  };

  const uniqueDateTimes = useMemo(() => {
    const dts = sessions.map(s => {
      if (!s.test_date) return null;
      return `${s.test_date} ${s.start_time ? s.start_time.substring(0, 5) : ''}`.trim();
    }).filter(Boolean);
    return Array.from(new Set(dts)).sort((a, b) => (b as string).localeCompare(a as string));
  }, [sessions]);

  const uniqueGrades = useMemo(() => {
    const grades = sessions.map(s => s._extractedGrade).filter(g => g && g !== '기타');
    return Array.from(new Set(grades)).sort((a, b) => getTestGradeOrder(a) - getTestGradeOrder(b));
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const filtered = sessions.filter(s => {
      const sessionDt = `${s.test_date} ${s.start_time ? s.start_time.substring(0, 5) : ''}`.trim();
      const matchDate = filterDateTime === "ALL" || sessionDt === filterDateTime;
      const matchGrade = filterGrade === "ALL" || s._extractedGrade === filterGrade;
      
      const keyword = searchKeyword.toLowerCase().trim();
      const matchKeyword = !keyword || 
        s.title.toLowerCase().includes(keyword) || 
        (s.exam_master?.title || "").toLowerCase().includes(keyword) ||
        (s.exam_master?.sub_title || "").toLowerCase().includes(keyword);

      return matchDate && matchGrade && matchKeyword;
    });

    return filtered.sort((a, b) => {
      const dateA = a.test_date || "";
      const dateB = b.test_date || "";
      const timeA = a.start_time || "";
      const timeB = b.start_time || "";
      const gradeOrderA = getTestGradeOrder(a._extractedGrade || "기타");
      const gradeOrderB = getTestGradeOrder(b._extractedGrade || "기타");

      if (primarySort === "date") {
        if (dateA !== dateB) return dateSortOrder === "desc" ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
        if (timeA !== timeB) return dateSortOrder === "desc" ? timeB.localeCompare(timeA) : timeA.localeCompare(timeB);
        return gradeSortOrder === "asc" ? gradeOrderA - gradeOrderB : gradeOrderB - gradeOrderA;
      } else {
        if (gradeOrderA !== gradeOrderB) return gradeSortOrder === "asc" ? gradeOrderA - gradeOrderB : gradeOrderB - gradeOrderA;
        if (dateA !== dateB) return dateSortOrder === "desc" ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
        if (timeA !== timeB) return dateSortOrder === "desc" ? timeB.localeCompare(timeA) : timeA.localeCompare(timeB);
        return 0;
      }
    });
  }, [sessions, filterDateTime, filterGrade, searchKeyword, primarySort, dateSortOrder, gradeSortOrder]);

  const resetFilters = () => {
    setFilterDateTime("ALL");
    setFilterGrade("ALL");
    setSearchKeyword("");
    sessionStorage.removeItem('logica_adm_filter_dt');
    sessionStorage.removeItem('logica_adm_filter_gr');
    sessionStorage.removeItem('logica_adm_filter_kw');
  };

  const downloadExcel = async () => {
    if (filteredSessions.length === 0) {
      alert("엑셀로 추출할 일정이 없습니다.");
      return;
    }
    setIsDownloadingExcel(true);
    try {
      const sessionIds = filteredSessions.map(s => s.admission_session_id);

      const { data: apps, error } = await supabase
        .from('admission_application')
        .select('admission_session_id, student(name, grade, school, school_name, phone, parent(phone))')
        .in('admission_session_id', sessionIds);

      if (error) throw error;

      if (!apps || apps.length === 0) {
        alert("해당 조건의 일정들에 배정된 학생이 없습니다.");
        setIsDownloadingExcel(false);
        return;
      }

      const sessionMap = new Map();
      filteredSessions.forEach(s => {
        sessionMap.set(s.admission_session_id, s);
      });

      let exportRows = apps.map((app: any) => {
        const session = sessionMap.get(app.admission_session_id);
        const testRoomName = session ? session.title : "알수없음";
        const examPaperName = session?.exam_master ? `${session.exam_master.title} ${session.exam_master.sub_title ? `[${session.exam_master.sub_title}]` : ''}`.trim() : "미지정";
        const rawDateTime = session ? `${session.test_date} ${session.start_time?.substring(0, 5)}`.trim() : "";
        const dateTime = formatDateTimeDisplay(rawDateTime); 
        
        const st = Array.isArray(app.student) ? app.student[0] : app.student;
        
        const studentName = st?.name || "";
        const school = st?.school_name || st?.school || "";
        const grade = formatGrade(st?.grade);

        const parentPhone = Array.isArray(st?.parent) 
                      ? st?.parent[0]?.phone 
                      : st?.parent?.phone;
        const displayPhone = parentPhone || st?.phone || "";

        return { testRoomName, examPaperName, dateTime, studentName, school, grade, displayPhone };
      });

      exportRows.sort((a, b) => b.testRoomName.localeCompare(a.testRoomName));

      const header = ["테스트이름", "테스트지 이름", "시험일시", "학생이름", "학교", "학년", "학부모연락처"];
      let csvContent = "\uFEFF" + header.join(",") + "\n"; 

      const escapeCSV = (str: any) => `"${String(str).replace(/"/g, '""')}"`;
      const escapePhoneCSV = (str: any) => str ? `="${String(str)}"` : `""`;

      const finalCsvRows: string[] = [];
      let currentRoomName = "";

      exportRows.forEach((obj) => {
        if (currentRoomName !== obj.testRoomName) {
          if (currentRoomName !== "") {
            finalCsvRows.push(["", "", "", "", "", "", ""].join(","));
          }
          finalCsvRows.push([escapeCSV(`[ ■ ${obj.dateTime} ]`), "", "", "", "", "", ""].join(","));
          currentRoomName = obj.testRoomName;
        }

        finalCsvRows.push([
          escapeCSV(obj.testRoomName),
          escapeCSV(obj.examPaperName),
          escapeCSV(obj.dateTime),
          escapeCSV(obj.studentName),
          escapeCSV(obj.school),
          escapeCSV(obj.grade),
          escapePhoneCSV(obj.displayPhone)
        ].join(","));
      });

      csvContent += finalCsvRows.join("\n");

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      
      const fileNameDate = filterDateTime === "ALL" ? "전체일시" : filterDateTime.replace(/[- :]/g, "");
      link.setAttribute("download", `입학테스트_대기생명단_${fileNameDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (e: any) {
      console.error("Excel download error:", e);
      alert("엑셀 추출 중 오류가 발생했습니다.");
    } finally {
      setIsDownloadingExcel(false);
    }
  };

  // 🌟 권한 확인이 끝나지 않았거나 권한이 없으면 렌더링하지 않음
  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }
  
  if (isAuthorized === false) {
    return null; // 이미 useEffect에서 alert 후 home으로 튕겨냅니다.
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-6 overflow-hidden relative">
      
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">입학테스트 관리 및 채점 대시보드</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">개설된 입학테스트 일정과 배정된 대기생을 관리합니다.</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 shrink-0 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-slate-600 text-sm mr-1">🔍 검색 필터</span>
          
          <select value={filterDateTime} onChange={e => setFilterDateTime(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864] min-w-[140px] bg-slate-50 hover:bg-white transition-colors cursor-pointer">
            <option value="ALL">🗓️ 일시 전체</option>
            {uniqueDateTimes.map(dt => <option key={dt as string} value={dt as string}>{formatDateTimeDisplay(dt as string)}</option>)}
          </select>
          
          <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864] min-w-[120px] bg-slate-50 hover:bg-white transition-colors cursor-pointer">
            <option value="ALL">👨‍🎓 학년 전체</option>
            {uniqueGrades.map(g => <option key={g as string} value={g as string}>{g as string}</option>)}
          </select>

          <div className="relative">
            <input 
              type="text" 
              value={searchKeyword} 
              onChange={e => setSearchKeyword(e.target.value)} 
              placeholder="방 코드(LT..), 시험지명 검색" 
              className="border border-slate-300 text-slate-700 text-sm font-bold rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:border-[#002864] w-[220px] bg-slate-50 focus:bg-white transition-colors"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">⌨️</span>
          </div>

          <button onClick={resetFilters} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-lg transition-colors border border-slate-300 flex items-center gap-1 ml-1">
            🔄 초기화
          </button>

          <button 
            onClick={downloadExcel} 
            disabled={isDownloadingExcel} 
            className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-sm rounded-lg transition-colors border border-emerald-200 flex items-center gap-1 ml-1 disabled:opacity-50"
          >
            {isDownloadingExcel ? "⏳ 추출 중..." : "📊 엑셀 다운로드"}
          </button>
        </div>
        
        <div className="flex items-center gap-2">
          <button onClick={() => window.open('/student/enroll?mode=admission', '_blank', 'width=700,height=850,top=100,left=100')} className="bg-[#002864] text-white px-5 py-2.5 rounded-lg font-bold text-sm shadow-sm hover:bg-blue-900 transition-colors">
            + 대기생 등록
          </button>
          <button onClick={() => setIsLevelTestModalOpen(true)} className="bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-bold text-sm shadow-sm hover:bg-emerald-700 transition-colors">
            새 일정 만들기 / 일괄 관리 열기
          </button>
        </div>
      </div>

      <div className="flex gap-6 flex-1 overflow-hidden">
        {/* 좌측 패널: 필터링된 일정 목록 */}
        <div className="w-1/3 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
            <div className="flex items-center">
              <h3 className="font-bold text-[#002864] flex items-center gap-2">
                <span>🗓️</span> 
                개설된 일정 목록 
                <span className="text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full ml-1">{filteredSessions.length}건</span>
              </h3>
              
              <button 
                onClick={() => {
                  if (primarySort === "date") setDateSortOrder(prev => prev === "desc" ? "asc" : "desc");
                  setPrimarySort("date");
                }} 
                className={`ml-3 text-[10px] font-bold border px-2 py-1.5 rounded transition-colors shadow-sm flex items-center gap-1 ${primarySort === 'date' ? 'bg-[#002864] text-white border-[#002864]' : 'bg-white text-slate-600 border-slate-200 hover:text-[#002864] hover:border-[#002864]'}`}
                title="일자를 최우선 기준으로 정렬합니다"
              >
                {dateSortOrder === "desc" ? "🔻 최신순" : "🔺 과거순"}
              </button>

              <button 
                onClick={() => {
                  if (primarySort === "grade") setGradeSortOrder(prev => prev === "asc" ? "desc" : "asc");
                  setPrimarySort("grade");
                }} 
                className={`ml-1 text-[10px] font-bold border px-2 py-1.5 rounded transition-colors shadow-sm flex items-center gap-1 ${primarySort === 'grade' ? 'bg-[#002864] text-white border-[#002864]' : 'bg-white text-slate-600 border-slate-200 hover:text-[#002864] hover:border-[#002864]'}`}
                title="학년을 최우선 기준으로 정렬합니다"
              >
                {gradeSortOrder === "asc" ? "🔺 저학년순" : "🔻 고학년순"}
              </button>
            </div>
            <button onClick={() => setRefreshTrigger(prev => prev + 1)} className="text-[12px] font-bold text-slate-500 hover:text-[#002864]">새로고침 ↻</button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll">
            {isLoadingSessions ? (
              <div className="p-5 text-center text-slate-400 font-bold">로딩 중...</div>
            ) : filteredSessions.length === 0 ? (
              <div className="p-10 text-center flex flex-col items-center">
                <span className="text-4xl mb-2">🕵️‍♂️</span>
                <span className="text-slate-400 font-bold">조건에 맞는 일정이 없습니다.</span>
              </div>
            ) : (
              filteredSessions.map(s => {
                const fullExamName = s.exam_master ? `${s.exam_master.title} ${s.exam_master.sub_title ? `[${s.exam_master.sub_title}]` : ''}` : '시험지 미지정';
                const isSelected = String(selectedSession?.admission_session_id) === String(s.admission_session_id);
                const sessionDt = `${s.test_date} ${s.start_time ? s.start_time.substring(0, 5) : ''}`.trim();

                return (
                  <div key={s.admission_session_id} 
                    onClick={() => { 
                      setSelectedSession(s); 
                      sessionStorage.setItem('logica_adm_selected_session_id', String(s.admission_session_id));
                    }} 
                    className={`px-4 py-2 border-b border-slate-100 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 border-blue-200 shadow-inner' : 'hover:bg-blue-50'}`}
                  >
                    
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {/* 일자 및 시간 */}
                        <div className="text-[14px] font-black text-slate-800 tracking-tight shrink-0">
                          🗓️ {formatDateTimeDisplay(sessionDt)}
                        </div>
                        {/* 테스트 이름(방 이름) 나란히 배치 */}
                        <h4 className="font-bold text-[13px] text-blue-800 truncate">{s.title}</h4>
                        {/* 학년 배지 */}
                        {s._extractedGrade && s._extractedGrade !== '기타' && (
                          <span className="bg-emerald-50 text-emerald-600 border border-emerald-200 px-1 py-0.5 rounded text-[9px] font-bold shrink-0 hidden lg:inline-block">
                            {s._extractedGrade}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {/* 배정 인원 */}
                        <span className="bg-blue-100 text-blue-700 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">
                          {s.admission_application?.length || 0}명
                        </span>
                        {/* 배정 버튼 (작게) */}
                        <button onClick={(e) => { 
                          e.stopPropagation(); 
                          setSelectedSession(s); 
                          sessionStorage.setItem('logica_adm_selected_session_id', String(s.admission_session_id));
                          setTimeout(() => setIsAssignModalOpen(true), 0); 
                        }} className="text-[10px] bg-[#002864] text-white px-2 py-0.5 rounded font-bold shadow-sm">
                          + 배정
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex flex-row items-center min-w-0 mt-1 gap-1.5">
                      {s.exam_id ? (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?exam_id=${s.exam_id}`, '_blank'); }} className="text-[11px] font-extrabold text-[#002864] hover:text-blue-600 hover:underline truncate text-left shrink-0 max-w-[50%]" title={fullExamName}>
                            📝 {fullExamName}
                          </button>
                          {s.session_comment && (
                            <span className="text-[10px] font-medium text-emerald-700 truncate min-w-0" title={s.session_comment}>
                              ↳ {s.session_comment}
                            </span>
                          )}
                        </>
                      ) : <span className="text-[11px] font-bold text-slate-400 truncate shrink-0">📝 시험지 미지정</span>}
                    </div>

                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 우측 패널: 배정 명단 */}
        <div className="w-2/3 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
            <h3 className="font-bold text-slate-800">{selectedSession ? `[${selectedSession.title}] 배정 명단` : '일정을 선택해주세요'}</h3>
          </div>
          <div ref={appsScrollRef} onScroll={handleScroll} className="overflow-y-auto flex-1 custom-scroll">
            {isLoadingApps ? (
              <div className="py-20 text-center text-slate-400 font-bold">대기생 정보를 불러오고 시험지를 연결하는 중입니다...</div>
            ) : (
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-white sticky top-0 z-10 shadow-sm border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-3 text-center w-12 text-slate-500 font-bold">No</th>
                    <th className="px-5 w-28 font-bold">이름</th>
                    <th className="px-5 w-40 font-bold">학교</th>
                    <th className="px-5 w-24 font-bold">학년</th>
                    <th className="px-5 w-40 font-bold">학부모 연락처</th>
                    <th className="px-2 w-16 text-center font-bold">결과</th>
                    <th className="text-right px-4 font-bold">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {applications.length === 0 ? <tr><td colSpan={7} className="py-20 text-center text-slate-400 font-bold">배정된 지원자가 없습니다.</td></tr> :
                    applications.map((app, idx) => {
                      const shadowAssign = shadowMap[app.student_id];
                      let gradeBtnHtml, scoreDisplay;
                      
                      const isDone = shadowAssign ? ['채점완료', '완료'].includes(shadowAssign.status) : false;

                      let displayResult = app.test_result || app.status || '대기';
                      if (isDone && !['합격', '불합격'].includes(displayResult)) {
                        displayResult = '검토중';
                      }

                      let badgeStyle = 'bg-slate-100 text-slate-600 border border-slate-200';
                      if (displayResult === '합격') badgeStyle = 'bg-emerald-100 text-emerald-700 border border-emerald-200';
                      else if (displayResult === '불합격') badgeStyle = 'bg-rose-100 text-rose-700 border border-rose-200';
                      else if (displayResult === '검토중') badgeStyle = 'bg-amber-100 text-amber-700 border border-amber-200';

                      if (shadowAssign) {
                        gradeBtnHtml = (
                          <div className="flex items-center">
                            <button onClick={() => router.push(`/admission/review?assignment_id=${shadowAssign.assignment_id}`)} className={`text-[11px] px-2.5 py-1.5 rounded font-bold shadow-sm border transition-colors flex items-center gap-1 shrink-0 ${isDone ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' : 'bg-[#002864] text-white border-[#002864] hover:bg-blue-900'}`}>
                              {isDone ? '채점/리뷰' : '채점하기'}
                            </button>
                            {isDone && <button onClick={() => window.open(`/print/report?assignment_id=${shadowAssign.assignment_id}`, '_blank')} className="text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-1.5 rounded font-bold transition-colors shadow-sm ml-1 shrink-0">📊 리포트</button>}
                          </div>
                        );
                        scoreDisplay = isDone ? <span className="font-black text-[#002864] bg-blue-50 px-2 py-1.5 rounded border border-blue-100 text-[13px] w-14 text-center shrink-0 shadow-sm">{shadowAssign.total_score || 0}점</span> : <span className="font-bold text-slate-300 text-[12px] w-14 text-center shrink-0">-점</span>;
                      } else {
                        if (selectedSession?.exam_id) {
                          gradeBtnHtml = <button onClick={() => forceAssignExam(app.student_id, selectedSession.admission_session_id, selectedSession.exam_id)} className="text-[11px] bg-amber-50 hover:bg-amber-100 text-amber-600 px-3 py-1.5 rounded border border-amber-300 transition-colors font-extrabold shadow-md shrink-0 animate-pulse">수동 연결 시도</button>;
                        } else {
                          gradeBtnHtml = <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded shrink-0">시험지없음</span>;
                        }
                        scoreDisplay = <span className="font-bold text-slate-300 text-[12px] w-14 text-center shrink-0">-</span>;
                      }

                      const parentPhone = Array.isArray(app.student?.parent) 
                        ? app.student?.parent[0]?.phone 
                        : app.student?.parent?.phone;
                      const displayPhone = parentPhone || app.student?.phone || '-';

                      return (
                        <tr key={app.application_id} className="hover:bg-blue-50/50 transition-colors">
                          <td className="py-3 px-3 text-center text-xs text-slate-400 font-bold">{idx + 1}</td>
                          <td className="py-3 px-5 font-extrabold text-[#002864] cursor-pointer hover:underline" onClick={() => window.open(`/student/${app.student_id}`, '_blank')}>{app.student?.name}</td>
                          <td className="px-5 text-sm font-bold text-slate-600">{app.student?.school_name || app.student?.school || '-'}</td>
                          <td className="px-5 text-sm font-bold text-slate-600">{formatGrade(app.student?.grade)}</td>
                          <td className="px-5 text-sm font-bold text-slate-500">{displayPhone}</td>
                          <td className="px-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold shadow-sm whitespace-nowrap ${badgeStyle}`}>
                              {displayResult}
                            </span>
                          </td>
                          <td className="py-3 px-4 align-middle">
                            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                              {scoreDisplay}
                              {gradeBtnHtml}
                              <div className="w-px h-5 bg-slate-200 mx-1"></div>
                              <button onClick={() => setCounselData({ appId: app.application_id, studentId: app.student_id, name: app.student?.name, result: displayResult, memo: app.counseling_memo || '' })} className="text-[11px] bg-white text-slate-700 border border-slate-300 px-2.5 py-1.5 rounded font-bold hover:bg-slate-50 transition-colors shadow-sm shrink-0">상담/결과</button>
                              <button onClick={() => unassignStudent(app.student_id, app.student?.name, selectedSession?.admission_session_id)} className="text-[11px] bg-rose-50 text-rose-500 border border-rose-200 px-2.5 py-1.5 rounded font-bold hover:bg-rose-500 hover:text-white transition-colors shadow-sm shrink-0">배정취소</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {isAssignModalOpen && (
        <AssignModal 
          isOpen={isAssignModalOpen} 
          onClose={() => setIsAssignModalOpen(false)} 
          session={selectedSession} 
          onSuccess={() => setRefreshTrigger(prev => prev + 1)} 
          formatGrade={formatGrade} 
          getGradeOrder={getStudentGradeOrder} 
        />
      )}
      
      {counselData && (
        <CounselingModal 
          counselData={counselData} 
          onClose={() => setCounselData(null)} 
          onSuccess={() => setRefreshTrigger(prev => prev + 1)} 
        />
      )}

      {isLevelTestModalOpen && (
        <LevelTestModal 
          onClose={() => setIsLevelTestModalOpen(false)}
          onSuccess={() => setRefreshTrigger(prev => prev + 1)}
        />
      )}
    </div>
  );
}