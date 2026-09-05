// src/app/(dashboard)/admin-dashboard/page.tsx
"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Chart from "chart.js/auto";
import AgendaSidebar from "@/components/dashboard/AgendaSidebar";
import AttendanceControlPanel from "@/components/admin/AttendanceControlPanel";
import QuickSearchWidget from "@/components/admin/QuickSearchWidget";
import MemoCreateModal from "@/components/admin/MemoCreateModal";
import ClassDetailModal from "@/components/admin/ClassDetailModal";
import InstructorPerformance from "@/components/admin/InstructorPerformance";

// 🌟 알림톡 및 일반문자 액션 임포트
import { sendAttendanceAlimtalk, sendScheduleNoticeAlimtalk, sendClassChangeAlimtalk, sendGeneralMessage } from "@/app/actions/alimtalk";

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

const getKSTDateStr = (offsetDays = 0) => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kst = new Date(utc + (9 * 3600000) + (offsetDays * 86400000));
  return kst.toISOString().split('T')[0];
};

const formatTimeAsKST = (isoStr: string) => {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const kst = new Date(utc + (9 * 3600000));
  return `${String(kst.getHours()).padStart(2, '0')}:${String(kst.getMinutes()).padStart(2, '0')}`;
};

// 💡 [핵심 교정] 대기열 텍스트 정제 및 중복 알림 방지 클리너
const cleanAndDeduplicateQueue = (rawQueue: any[]) => {
  if (!Array.isArray(rawQueue)) return [];
  
  const normalized = rawQueue.map(m => {
    let title = typeof m.previewTitle === 'string' && m.previewTitle.trim() !== '' 
        ? m.previewTitle 
        : (m.templateId === 'KA01TP260826014520504X1Fplf8R0FH' ? `[출결] ${m.statusLabel || '등원'}` : '');
    
    let label = m.statusLabel || '';
    
    if (m.templateId === 'KA01TP260826014520504X1Fplf8R0FH' || title.includes('출결') || label) {
        if (!label) {
            if (title.includes('등원') || title.includes('출석')) label = '등원';
            else if (title.includes('지각')) label = '지각';
            else if (title.includes('조퇴')) label = '조퇴';
            else if (title.includes('하원')) label = '하원';
            else if (title.includes('결석')) label = '결석';
            else label = '등원';
        }
        
        if (label === '출석') label = '등원';
        if (label === '수업종료') label = '하원'; 
        
        title = `[출결] ${label}`;
    }
    
    return { ...m, previewTitle: title, statusLabel: label };
  });

  const seen = new Set();
  const deduplicated = [];
  
  for (let i = normalized.length - 1; i >= 0; i--) {
    const m = normalized[i];
    let key = '';
    
    if (m.templateId === 'KA01TP260826014520504X1Fplf8R0FH' || m.previewTitle?.includes('[출결]')) {
        const isOut = m.statusLabel === '조퇴' || m.statusLabel === '하원';
        const group = isOut ? 'OUT' : 'IN';
        key = `${m.studentName}_ATT_${group}`;
    } else {
        key = m.id || `${m.studentName}_${m.previewTitle}_${i}`;
    }
    
    if (!seen.has(key)) {
        seen.add(key);
        deduplicated.unshift(m); 
    }
  }
  return deduplicated;
};

export default function AdminDashboardPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "관리자" });
  const [tenantId, setTenantId] = useState("hq");
  const [tenantName, setTenantName] = useState("로딩중...");
  
  const [todayString, setTodayString] = useState("데이터를 불러오는 중입니다...");
  const [thisMonthStr, setThisMonthStr] = useState("");
  const [firstDayOfMonth, setFirstDayOfMonth] = useState("");
  const [todayIso, setTodayIso] = useState("");

  const [kpi, setKpi] = useState({
    totalStu: 0, newStu: 0, leftStu: 0, payRate: 0, paidAmt: 0, unpaidAmt: 0, waitingStu: 0, passedStu: 0, csCount: 0
  });

  const [allStudentsData, setAllStudentsData] = useState<any[]>([]);
  const [csRequests, setCsRequests] = useState<any[]>([]);
  const [memos, setMemos] = useState<any[]>([]);
  const [instructorsStats, setInstructorsStats] = useState<any[]>([]);
  const [classStats, setClassStats] = useState<any[]>([]);
  const [levelCounts, setLevelCounts] = useState<any>(null);
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [liveFeeds, setLiveFeeds] = useState<any[]>([]);

  // 💡 신규 위젯 상태 추가
  const [todayAgendas, setTodayAgendas] = useState<any[]>([]);
  const [riskStudents, setRiskStudents] = useState<any[]>([]);

  const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
  const [memoData, setMemoData] = useState({ type: "일반공지", content: "" });
  
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [classModalData, setClassModalData] = useState<any>({});
  const [classStudents, setClassStudents] = useState<any[]>([]);
  const [classSchedules, setClassSchedules] = useState<any[]>([]);

  const [queuedMessages, setQueuedMessages] = useState<any[]>([]);
  const [isQueueLoaded, setIsQueueLoaded] = useState(false);
  const [isSendingAlimtalk, setIsSendingAlimtalk] = useState(false);
  
  const [bulkType, setBulkType] = useState('schedule');
  const [bulkTarget, setBulkTarget] = useState('all');
  const [bulkForm, setBulkForm] = useState({ scheduleName: '', applyDate: '', oldDate: '', newDate: '', details: '' });

  useEffect(() => {
    const savedQueue = localStorage.getItem("logica_queued_messages");
    if (savedQueue) {
      try {
        setQueuedMessages(cleanAndDeduplicateQueue(JSON.parse(savedQueue)));
      } catch (e) {
        console.error("대기열 복구 에러:", e);
      }
    }
    setIsQueueLoaded(true);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'logica_queued_messages') {
        const newQ = localStorage.getItem("logica_queued_messages");
        if (newQ) {
          try {
            const cleaned = cleanAndDeduplicateQueue(JSON.parse(newQ));
            setQueuedMessages(prev => JSON.stringify(prev) !== JSON.stringify(cleaned) ? cleaned : prev);
          } catch (e) {}
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    if (isQueueLoaded) {
      const currentSaved = localStorage.getItem("logica_queued_messages");
      const newToSave = JSON.stringify(queuedMessages);
      if (currentSaved !== newToSave) {
        localStorage.setItem("logica_queued_messages", newToSave);
      }
    }
  }, [queuedMessages, isQueueLoaded]);

  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || 
                        pos.includes('최고관리자') || pos.includes('대장') || pos.includes('원장');
      
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

      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/admin-dashboard"))) {
        alert("⛔ 운영 대시보드(KPI/통계)에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
      }
    };
    checkAccess();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) {
      const instId = localStorage.getItem('logica_instructor_id') || "1";
      const name = localStorage.getItem('logica_instructor_name') || "관리자";
      const tId = localStorage.getItem("logica_tenant_id") || "hq"; 
      
      setCurrentUser({ instId, name });
      setTenantId(tId);

      const getTenantName = async () => {
        if (tId && tId !== 'hq') {
          const { data } = await supabase.from('academy_tenant').select('name').eq('tenant_id', tId).single();
          if (data) setTenantName(data.name);
        } else if (tId === 'hq') {
          setTenantName('본사 (HQ)');
        }
      };
      getTenantName();

      const today = new Date();
      const days = ['일', '월', '화', '수', '목', '금', '토'];
      setTodayString(`${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 (${days[today.getDay()]}) 실시간 요약 지표`);
      setThisMonthStr(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
      setTodayIso(today.toISOString().split('T')[0]);
      setFirstDayOfMonth(new Date(today.getFullYear(), today.getMonth(), 1).toISOString());
    }
  }, [isAuthorized]);

  useEffect(() => {
    if (isAuthorized && thisMonthStr && firstDayOfMonth) {
      loadDashboardData();
    }
  }, [isAuthorized, thisMonthStr, firstDayOfMonth]);

  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase.channel('feed_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_log' }, () => {
        fetchLiveFeeds(); 
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId]);

  const loadDashboardData = async () => {
    await Promise.allSettled([
      fetchKPIStudents(), fetchKPIBilling(), fetchKPIAdmission(),
      fetchCSRequests(), fetchAdmissions(), fetchLiveFeeds(),
      fetchInstructorStats(), fetchClassMonitoring(), fetchMemos(), fetchAllSearchData(),
      fetchTodayAgendas(), fetchRiskStudents() // 💡 신규 위젯 2종 데이터 로드
    ]);
  };

  const fetchAllSearchData = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    let query = supabase.from('student').select('student_id, name, phone, school, grade, status, parent(name, phone), enrollment(status, end_date, class(class_id, name))');
    if (tId && tId !== 'hq') query = query.eq('tenant_id', tId);
    
    const { data } = await query.order('name');
    setAllStudentsData(data || []);
  };

  // 💡 [위젯 4] 오늘의 주요 일정 및 상담 데이터 가져오기
  const fetchTodayAgendas = async () => {
    const today = getKSTDateStr();
    const nextDay = getKSTDateStr(1);
    
    try {
      const { data } = await supabase
        .from("agenda")
        .select("title, meeting_date, source")
        .gte("meeting_date", `${today}T00:00:00`)
        .lt("meeting_date", `${nextDay}T00:00:00`)
        .order("meeting_date", { ascending: true })
        .limit(10);
        
      setTodayAgendas(data || []);
    } catch(e) { console.error(e) }
  };

  // 💡 [위젯 3] 장기 결석 및 이탈 위험군 데이터 가져오기 (지능형 분석)
  const fetchRiskStudents = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    let query = supabase.from('student')
      .select('student_id, name, parent(name, phone), attendance(status, attendance_date), consultation_log(created_at)')
      .eq('status', '재원');
    if (tId && tId !== 'hq') query = query.eq('tenant_id', tId);
    
    const { data } = await query;
    if (!data) return;
    
    const twoWeeksAgo = getKSTDateStr(-14);
    const oneMonthAgo = new Date(Date.now() - 30 * 86400000).getTime();
    
    const risks: any[] = [];
    data.forEach(st => {
       let absentCount = 0;
       let lateCount = 0;
       st.attendance?.forEach((a: any) => {
          if (a.attendance_date >= twoWeeksAgo) {
             if (a.status === '결석') absentCount++;
             if (a.status === '지각') lateCount++;
          }
       });
       
       let lastConsultTime = 0;
       if (st.consultation_log && st.consultation_log.length > 0) {
           const logs = [...st.consultation_log].sort((x: any, y: any) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime());
           lastConsultTime = new Date(logs[0].created_at).getTime();
       }
       
       const noConsult = lastConsultTime === 0 || lastConsultTime < oneMonthAgo;
       
       let reasons = [];
       if (absentCount >= 2) reasons.push(`결석 ${absentCount}회`);
       if (lateCount >= 3) reasons.push(`지각 ${lateCount}회`);
       if (noConsult) reasons.push('상담 한달 경과');
       
       if (reasons.length > 0) {
           const parentInfo = Array.isArray(st.parent) ? st.parent[0] : st.parent;
           risks.push({ id: st.student_id, name: st.name, phone: parentInfo?.phone, reasons });
       }
    });
    
    // 심각도(이유 갯수)가 높은 순서대로 6명만 뽑아서 표시
    risks.sort((a, b) => b.reasons.length - a.reasons.length);
    setRiskStudents(risks.slice(0, 6)); 
  };

  const fetchKPIStudents = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    let query = supabase.from('student').select('*');
    if (tId && tId !== 'hq') query = query.eq('tenant_id', tId);

    const { data } = await query;
    let enrolled = 0, newM = 0, leftM = 0;
    data?.forEach(s => {
      if (s.status === '재원') {
        enrolled++;
        if (s.created_at >= firstDayOfMonth) newM++;
      } else if (s.status === '퇴원' || s.status === '휴원') {
        if (s.updated_at >= firstDayOfMonth) leftM++;
      }
    });
    setKpi(prev => ({ ...prev, totalStu: enrolled, newStu: newM, leftStu: leftM }));
  };

  const fetchKPIBilling = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    let query = supabase.from('academy_billing').select('*').eq('billing_month', thisMonthStr);
    if (tId && tId !== 'hq') query = query.eq('tenant_id', tId);

    const { data } = await query;
    let paidAmt = 0, unpaidAmt = 0;
    data?.forEach(b => {
      const amt = parseInt(b.amount) || 0;
      if (b.status === '완납') paidAmt += amt; else unpaidAmt += amt;
    });
    const totalAmt = paidAmt + unpaidAmt;
    const payRate = totalAmt > 0 ? Math.round((paidAmt / totalAmt) * 100) : 0;
    setKpi(prev => ({ ...prev, payRate, paidAmt, unpaidAmt }));
  };

  const fetchKPIAdmission = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    let stuQuery = supabase.from('student').select('*').eq('status', '입학테스트');
    if (tId && tId !== 'hq') stuQuery = stuQuery.eq('tenant_id', tId);
    const { data: students } = await stuQuery;
    
    const { data: apps } = await supabase.from('admission_application').select('*').gte('created_at', firstDayOfMonth);
    const passedCount = apps?.filter(a => ['합격'].includes(a.test_result || a.status || a.application_status)).length || 0;
    
    setKpi(prev => ({ ...prev, passedStu: passedCount, waitingStu: students?.length || 0 }));
  };

  const fetchCSRequests = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    let query = supabase.from('parent_request_log')
      .select('*, student!inner(name, tenant_id)')
      .neq('status', '완료') 
      .order('created_at', { ascending: false })
      .limit(15);
      
    if (tId && tId !== 'hq') query = query.eq('student.tenant_id', tId);
    
    const { data } = await query;
    setCsRequests(data || []);
    setKpi(prev => ({ ...prev, csCount: data?.length || 0 }));
  };

  const fetchMemos = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    try {
      let query = supabase.from('instructor_memo')
        .select('*')
        .in('status', ['할일', '진행중'])
        .order('created_at', { ascending: false })
        .limit(20);
        
      if (tId && tId !== 'hq') query = query.eq('tenant_id', tId);
      const { data, error } = await query;
      if (error) throw error;
      setMemos(data || []);
    } catch (err) { console.error("업무 보드 로딩 에러:", err); setMemos([]); }
  };

  const fetchAdmissions = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    let query = supabase.from('admission_session').select('*, admission_application(*)').gte('test_date', todayIso).order('test_date', { ascending: true }).limit(5);
    if (tId && tId !== 'hq') query = query.eq('tenant_id', tId);

    const { data } = await query;
    setAdmissions(data || []);
  };

  const fetchLiveFeeds = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    let query = supabase.from('notification_log').select('*').order('created_at', { ascending: false }).limit(30);
    if (tId && tId !== 'hq') query = query.eq('tenant_id', tId);

    const { data } = await query;
    setLiveFeeds(data || []);
  };

  const fetchInstructorStats = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    const hqTenantId = 'd59395b0-8c9c-4dd3-9e25-ff569da98abc'; 

    let instQuery = supabase.from('instructor').select('*').eq('status', '재직');
    let classQuery = supabase.from('class').select('*, class_schedule(*)').eq('status', '진행중');
    let stuQuery = supabase.from('student').select('*');
    let enrollQuery = supabase.from('enrollment').select('*');

    if (tId && tId !== 'hq') {
      instQuery = instQuery.eq('tenant_id', tId);
      classQuery = classQuery.eq('tenant_id', tId);
      stuQuery = stuQuery.eq('tenant_id', tId);
    }

    const [{ data: rawInsts }, { data: classes }, { data: students }, { data: enrolls }] = await Promise.all([
      instQuery, classQuery, stuQuery, enrollQuery
    ]);

    const getRoleRank = (pos: string) => {
      if (!pos) return 99;
      if (pos.includes('원장') && !pos.includes('부원장')) return 1; 
      if (pos.includes('부원장')) return 2;
      if (pos.includes('실장')) return 3;
      if (pos.includes('전임')) return 4; 
      if (pos.includes('파트')) return 5; 
      return 99;
    };

    const insts = (rawInsts || [])
      .filter(i => i.tenant_id !== hqTenantId) 
      .filter(i => {
        const pos = i.position || '';
        const role = i.role || '';
        return !(pos.includes('테스트') || pos.includes('체험') || role === 'GUEST' || pos.includes('최고관리자') || role === 'SUPER_ADMIN' || pos.includes('조교') || role === 'TA');
      })
      .sort((a, b) => {
        const rankA = getRoleRank(a.position), rankB = getRoleRank(b.position);
        if (rankA !== rankB) return rankA - rankB;
        return (b.name || '').localeCompare(a.name || '');
      });

    const stats = insts.map(inst => {
      const myClasses = (classes || []).filter(c => c.instructor_id === inst.instructor_id);
      const classIds = myClasses.map(c => c.class_id);
      let myStudents = new Set();
      let newCnt = 0, leftCnt = 0;

      (students || []).forEach(s => {
        let belongs = classIds.includes(s.class_id) || (enrolls?.some(e => e.student_id === s.student_id && classIds.includes(e.class_id)));
        if (belongs) {
          if (s.status === '재원') {
            myStudents.add(s.student_id);
            if (s.created_at >= firstDayOfMonth) newCnt++;
          } else if (s.status === '퇴원' || s.status === '휴원') {
            if (s.updated_at >= firstDayOfMonth) leftCnt++;
          }
        }
      });
      return { ...inst, myClasses, studentCount: myStudents.size, newCnt, leftCnt };
    });
    setInstructorsStats(stats);
  };

  const fetchClassMonitoring = async () => {
    const tId = localStorage.getItem("logica_tenant_id");

    let classQuery = supabase.from('class').select('*, instructor(*), class_schedule(*)').eq('status', '진행중');
    let stuQuery = supabase.from('student').select('student_id, status');
    let enrollQuery = supabase.from('enrollment').select('*');

    if (tId && tId !== 'hq') {
      classQuery = classQuery.eq('tenant_id', tId);
      stuQuery = stuQuery.eq('tenant_id', tId);
    }

    const [{ data: classes }, { data: students }, { data: enrolls }] = await Promise.all([
      classQuery, stuQuery, enrollQuery
    ]);

    const activeStudentIds = new Set(
      (students || []).filter(s => s.status === '재원').map(s => s.student_id)
    );

    const cStats = (classes || []).map(c => {
      let sCount = 0;
      (enrolls || []).forEach(e => {
        if (e.class_id === c.class_id && activeStudentIds.has(e.student_id)) {
          sCount++;
        }
      });
      const capacity = c.capacity || 12;
      const vacancy = Math.max(0, capacity - sCount);
      const fillRate = Math.min(100, Math.round((sCount / capacity) * 100));
      return { ...c, sCount, capacity, vacancy, fillRate };
    }).sort((a, b) => b.vacancy - a.vacancy);
    
    let lvCounts: any = { 'Ultimate': 0, 'Master': 0, 'Apex': 0, 'Titan': 0, 'Horizon': 0, '기타': 0 };
    cStats.forEach(c => {
      const lv = c.level_name || '기타';
      if (lvCounts[lv] !== undefined) lvCounts[lv] += c.sCount;
      else lvCounts['기타'] += c.sCount;
    });

    setClassStats(cStats);
    setLevelCounts(lvCounts);
  };

  const openClassModal = async (classItem: any) => {
    setClassModalData({ ...classItem, instructorName: classItem.instructor?.name || '미정' });
    const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
    const schedules = DAYS.map(day => {
      const exist = (classItem.class_schedule || []).find((s: any) => s.day_of_week === day);
      return { day, checked: !!exist, start_time: exist?.start_time?.substring(0, 5) || "", end_time: exist?.end_time?.substring(0, 5) || "" };
    });
    setClassSchedules(schedules);
    setIsClassModalOpen(true);

    const { data: enrollData } = await supabase.from("enrollment").select("student_id").eq("class_id", classItem.class_id);
    const enrollIds = enrollData?.map(e => e.student_id) || [];
    if (enrollIds.length === 0) { setClassStudents([]); return; }
    
    const { data } = await supabase.from("student").select("*, parent(name, phone), enrollment(class(name))").in("student_id", enrollIds);
    setClassStudents(data || []);
  };

  const saveMemo = async () => {
    if (!memoData.content.trim()) return alert("내용을 입력해주세요.");
    const myTenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = myTenantId === 'hq' ? '1ff4299c-d72b-4d99-97b0-45fee08e3b73' : myTenantId;

    try {
      await supabase.from('instructor_memo').insert({ 
        instructor_id: currentUser.instId, author_name: currentUser.name, 
        memo_type: memoData.type, content: memoData.content, tenant_id: validTenantId, status: '할일'
      });
      setIsMemoModalOpen(false);
      setMemoData({ type: "일반공지", content: "" });
      fetchMemos();
    } catch (err: any) { alert("등록 실패"); }
  };

  const deleteMemo = async (memoId: string) => {
    if (!confirm("이 업무를 삭제하시겠습니까?")) return;
    await supabase.from('instructor_memo').delete().eq('memo_id', memoId);
    fetchMemos();
  };

  const handleAddBulkToQueue = () => {
    if (bulkType === 'schedule' && (!bulkForm.scheduleName || !bulkForm.applyDate || !bulkForm.details)) return alert('모든 항목을 입력해주세요.');
    if (bulkType === 'makeup' && (!bulkForm.oldDate || !bulkForm.newDate || !bulkForm.details)) return alert('모든 항목을 입력해주세요.');
    if (bulkType === 'general' && !bulkForm.details) return alert('발송할 자유 내용을 입력해주세요.');

    let targets = allStudentsData.filter(s => s.status === '재원');
    if (bulkTarget !== 'all') {
      targets = targets.filter(s => {
        const activeEnrolls = s.enrollment?.filter((e:any) => !e.end_date || e.status === '수강중') || [];
        return activeEnrolls.some((e:any) => unwrap(e.class)?.class_id === bulkTarget);
      });
    }

    if (targets.length === 0) return alert('발송 대상(재원생)이 없습니다.');

    const currentTimeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

    const newMessages: any[] = targets.map(student => {
      const parentInfo = unwrap(student.parent);
      const parentPhone = parentInfo?.phone;
      if (!parentPhone) return null;

      const isValidParentName = parentInfo.name && parentInfo.name.trim() !== "" && parentInfo.name !== "미입력";
      const parentName = isValidParentName ? parentInfo.name : student.name;

      if (bulkType === 'schedule') {
        return {
          id: `sched_${student.student_id}_${bulkForm.scheduleName}`,
          templateId: 'KA01TP260826015150733a1AW4dFE1qM',
          parentPhone, parentName, studentName: student.name,
          scheduleName: bulkForm.scheduleName, applyDate: bulkForm.applyDate, details: bulkForm.details,
          previewTitle: `[일정] ${bulkForm.scheduleName}`,
          previewDesc: `${student.name} 학부모님`,
          queuedAt: currentTimeStr
        };
      } else if (bulkType === 'makeup') {
        return {
          id: `make_${student.student_id}_${bulkForm.newDate}`,
          templateId: 'KA01TP260831032803585c1Me7WbxjUe',
          parentPhone, parentName, studentName: student.name,
          oldDate: bulkForm.oldDate, newDate: bulkForm.newDate, details: bulkForm.details,
          previewTitle: `[보강] ${student.name}`,
          previewDesc: `${bulkForm.oldDate} ➡️ ${bulkForm.newDate}`,
          queuedAt: currentTimeStr
        };
      } else {
        return {
          id: `gen_${student.student_id}_${bulkForm.details.substring(0, 10)}`,
          templateId: 'GENERAL_SMS',
          parentPhone, parentName, studentName: student.name,
          details: bulkForm.details,
          previewTitle: `[일반문자]`,
          previewDesc: `${student.name} 학부모님`,
          queuedAt: currentTimeStr
        };
      }
    }).filter(Boolean);

    setQueuedMessages(prev => {
      return cleanAndDeduplicateQueue([...prev, ...newMessages]);
    });
    
    alert(`${newMessages.length}건이 발송 대기열에 추가되었습니다.\n(가운데 큐에서 전체 발송을 눌러주세요)`);
    setBulkForm({ scheduleName: '', applyDate: '', oldDate: '', newDate: '', details: '' });
  };

  const handleSendQueuedMessages = async () => {
    if (queuedMessages.length === 0) return;
    if (!confirm(`대기 중인 ${queuedMessages.length}건의 메시지를 발송하시겠습니까?`)) return;

    setIsSendingAlimtalk(true);
    let successCount = 0;
    let failCount = 0;

    for (const msg of queuedMessages) {
      let res: any;
      if (msg.templateId === "KA01TP260826014520504X1Fplf8R0FH") {
        res = await sendAttendanceAlimtalk(msg);
      } else if (msg.templateId === "KA01TP260826015150733a1AW4dFE1qM") {
        res = await sendScheduleNoticeAlimtalk(msg);
      } else if (msg.templateId === "KA01TP260831032803585c1Me7WbxjUe") {
        res = await sendClassChangeAlimtalk(msg);
      } else if (msg.templateId === "GENERAL_SMS") {
        const textContent = `[로지카 학원 대치본원]\n\n${msg.parentName} 학부모님,\n\n${msg.details}\n\n문의: 02-555-8875`;
        res = await sendGeneralMessage({ parentPhone: msg.parentPhone, textContent });
      }

      const logMessage = msg.templateId === "GENERAL_SMS" ? `[일반문자] ${msg.details.substring(0, 30)}...` : msg.previewTitle;

      const { error: insertError } = await supabase.from('notification_log').insert({
        tenant_id: tenantId === 'hq' ? '1ff4299c-d72b-4d99-97b0-45fee08e3b73' : tenantId,
        target_name: msg.studentName,
        target_phone: msg.parentPhone,
        message: logMessage,
        status: res?.success ? '성공' : '실패'
      });

      if (insertError) {
        console.error("❌ 피드 기록 실패 상세 에러:", insertError);
      }

      if (res?.success) successCount++; else failCount++;
    }

    setIsSendingAlimtalk(false);
    setQueuedMessages([]);
    fetchLiveFeeds(); 
    alert(`메시지 전송 완료!\n(성공: ${successCount}건, 실패: ${failCount}건)`);
  };

  const getBadgeColor = (title: string) => {
    if (!title) return 'bg-transparent text-transparent border-transparent';
    if (title.includes('출석') || title.includes('등원')) return 'bg-emerald-50 text-emerald-600 border-emerald-100';
    if (title.includes('지각')) return 'bg-amber-50 text-amber-600 border-amber-100';
    if (title.includes('결석')) return 'bg-rose-50 text-rose-500 border-rose-100';
    if (title.includes('일정')) return 'bg-blue-50 text-blue-600 border-blue-100';
    if (title.includes('보강')) return 'bg-purple-50 text-purple-600 border-purple-100';
    if (title.includes('일반문자')) return 'bg-slate-100 text-slate-600 border-slate-300';
    return 'bg-indigo-50 text-indigo-500 border-indigo-100';
  };

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  if (isAuthorized === false) return null; 

  return (
    <div className="flex w-full h-full bg-slate-50 overflow-hidden font-pretendard">
      
      <div className="flex-1 flex flex-col h-full overflow-y-auto custom-scroll relative z-0 -mx-8 -mt-4">
        <header className="bg-gradient-to-br from-[#0f172a] to-[#1e1b4b] text-white pt-8 pb-20 px-8 shrink-0 relative z-0">
          <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
          <div className="relative z-10 flex justify-between items-center ml-6">
            <div>
              <h1 className="text-3xl font-black tracking-tight font-lexend flex items-center gap-3">
                <span>LOGICA 학원 통합 관리</span>
                <span className="bg-blue-500/30 text-blue-100 text-[15px] px-3 py-1 rounded-lg font-bold border border-blue-400/30 font-pretendard shadow-sm flex items-center shadow-inner">🏢 {tenantName}</span>
                <button onClick={() => router.push('/supervisor')} className="shrink-0 ml-3 bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white border border-indigo-400/50 px-4 py-1.5 rounded-xl text-sm font-bold shadow-md transition-all flex items-center gap-1.5">
                  <span className="text-lg">📡</span> 클리닉 관제탑
                </button>
              </h1>
              <p className="text-slate-300 text-sm mt-2 font-medium tracking-tight">{todayString}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-visible px-8 pb-10 -mt-14 relative z-10 bg-transparent">
          
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 mb-6 px-6 sticky top-4 z-[50]">
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-[0_8px_30px_rgba(0,0,0,0.06)] relative overflow-hidden flex flex-col justify-between h-64 col-span-1">
              <div className="absolute right-[-10px] top-[-10px] w-32 h-32 bg-slate-50 rounded-full opacity-50"></div>
              
              <div className="flex-1 flex justify-between items-center border-b border-slate-100 pb-2 cursor-pointer group relative z-10" onClick={() => router.push('/student')}>
                 <div>
                   <div className="text-[11px] font-bold text-slate-500 mb-0.5">전체 재원생</div>
                   <div className="flex items-end gap-1"><span className="text-2xl font-black text-[#002864] group-hover:text-blue-600 transition-colors">{kpi.totalStu}</span><span className="text-[10px] font-bold text-slate-400 mb-1.5">명</span></div>
                 </div>
                 <div className="text-right text-[10px] font-bold flex flex-col gap-0.5">
                   <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 shadow-sm">신규 +{kpi.newStu}</span>
                   <span className="text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100 shadow-sm">퇴원 -{kpi.leftStu}</span>
                 </div>
              </div>
              
              <div className="flex-1 flex flex-col justify-center border-b border-slate-100 py-1.5 cursor-pointer group relative z-10" onClick={() => router.push('/billing')}>
                 <div className="flex justify-between items-end mb-1">
                   <span className="text-[11px] font-bold text-slate-500">{new Date().getMonth() + 1}월 수납률</span>
                   <span className="text-lg font-black text-sky-600 group-hover:text-sky-400 transition-colors">{kpi.payRate}%</span>
                 </div>
                 <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden shadow-inner">
                   <div className={`h-full rounded-full transition-all ${kpi.payRate < 60 ? 'bg-rose-500' : 'bg-sky-400'}`} style={{ width: `${kpi.payRate}%` }}></div>
                 </div>
              </div>

              <div className="flex-1 flex justify-between items-center pt-2 cursor-pointer group relative z-10" onClick={() => router.push('/admission')}>
                 <div>
                   <div className="text-[11px] font-bold text-slate-500 mb-0.5">입학 대기생</div>
                   <div className="flex items-end gap-1"><span className="text-2xl font-black text-amber-500 group-hover:text-amber-400 transition-colors">{kpi.waitingStu}</span><span className="text-[10px] font-bold text-slate-400 mb-1.5">명</span></div>
                 </div>
                 <div className="text-[10px] font-bold text-slate-500 text-right">
                   이번 달 승인<br/><span className="text-amber-600 font-black text-sm">{kpi.passedStu}</span> 명
                 </div>
              </div>
            </div>

            <QuickSearchWidget allStudentsData={allStudentsData} />

            <div onClick={() => router.push('/cs')} className="bg-white rounded-2xl p-5 border border-rose-100 shadow-[0_8px_30px_rgba(0,0,0,0.06)] relative overflow-hidden hover:border-rose-400 transition-colors cursor-pointer h-64 flex flex-col">
              <div className="absolute left-0 top-0 w-1.5 h-full bg-rose-500"></div>
              <div className="flex justify-between items-center mb-3 pl-1 shrink-0 relative z-10">
                <span className="text-sm font-extrabold text-slate-700 flex items-center gap-1">🚨 학부모 요청</span>
                <span className="bg-rose-100 text-rose-600 text-[10px] font-bold px-1.5 py-0.5 rounded border border-rose-200 shadow-sm">{kpi.csCount}건 미결</span>
              </div>
              <div className="flex-1 flex flex-col gap-2 overflow-y-auto custom-scroll pr-1 relative z-10 min-h-0">
                {csRequests.length === 0 ? <div className="text-center py-6 text-slate-400 font-bold text-xs mt-4">미처리 요청이 없습니다. 🎉</div> : 
                  csRequests.map(r => {
                    const isProcessing = r.status === '처리중';
                    return (
                      <div key={r.request_id} className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-slate-600 bg-rose-50 p-2 rounded border border-rose-100 shadow-sm">
                        <span className={`px-1 py-0.5 rounded text-[9px] shrink-0 ${isProcessing ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-rose-200 text-rose-700 border border-rose-300'}`}>
                          {isProcessing ? '처리중' : '대기'}
                        </span>
                        <span className="truncate flex-1"><span className="text-rose-600 mr-1">{r.student?.name || '알수없음'}:</span>{r.reason}</span>
                      </div>
                    );
                  })
                }
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-purple-100 shadow-[0_8px_30px_rgba(0,0,0,0.06)] relative overflow-hidden hover:border-purple-300 transition-colors cursor-pointer h-64 flex flex-col" onClick={() => router.push('/task')}>
              <div className="flex justify-between items-center mb-3 shrink-0 relative z-10">
                <span className="text-sm font-extrabold text-slate-700 flex items-center gap-1">📌 업무 공유 보드</span>
                <button onClick={(e) => { e.stopPropagation(); setIsMemoModalOpen(true); }} className="text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1.5 rounded font-bold transition-colors border border-blue-200 shadow-sm">+ 작성</button>
              </div>
              <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto custom-scroll pr-1 relative z-10 min-h-0">
                {memos.length === 0 ? <div className="text-center py-6 text-slate-400 font-bold text-xs mt-4">진행 중인 업무가 없습니다.</div> :
                  memos.map(m => {
                    let typeColor = 'text-slate-600 bg-slate-100 border-slate-200'; 
                    if (m.memo_type === '긴급공지') typeColor = 'text-rose-600 bg-rose-100 border-rose-200';
                    else if (m.memo_type === '학생인계') typeColor = 'text-blue-600 bg-blue-100 border-blue-200';
                    else if (m.memo_type === '일반공지') typeColor = 'text-emerald-600 bg-emerald-100 border-emerald-200';
                    return (
                      <div key={m.memo_id} className="shrink-0 flex flex-col border-b border-slate-100 pb-2 mb-1 last:border-0 hover:bg-slate-50/50 p-1 rounded transition-colors group">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1">
                            <span className={`text-[9px] font-black ${typeColor} px-1.5 py-0.5 rounded border`}>{m.memo_type}</span>
                            {m.status === '진행중' && <span className="text-[9px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded border border-amber-200">진행중</span>}
                          </div>
                          <div className="flex items-center">
                            <span className="text-[9px] font-bold text-slate-400">{m.author_name}</span>
                            {String(m.instructor_id) === currentUser.instId && <button onClick={(e) => { e.stopPropagation(); deleteMemo(m.memo_id); }} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 font-bold ml-2">×</button>}
                          </div>
                        </div>
                        <span className="text-[11px] font-bold text-slate-700 leading-snug whitespace-pre-wrap">{m.content}</span>
                      </div>
                    );
                  })
                }
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            
            <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-[520px]">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
                <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">📝 단체 알림톡 / 문자 작성</h3>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-5 flex flex-col gap-3">
                
                <select value={bulkType} onChange={e => { setBulkType(e.target.value); setBulkForm({ scheduleName: '', applyDate: '', oldDate: '', newDate: '', details: '' }); }} className="w-full border border-slate-300 rounded-lg p-2 text-xs font-bold text-slate-700 bg-white shadow-sm focus:border-indigo-500 focus:outline-none">
                  <option value="schedule">📅 학사일정 (개강/휴원) 안내</option>
                  <option value="makeup">⏰ 시간표 변경 및 보강 안내</option>
                  <option value="general">💬 자유 내용 (일반 SMS/LMS 발송)</option>
                </select>

                <select value={bulkTarget} onChange={e => setBulkTarget(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2 text-xs font-bold text-slate-700 bg-white shadow-sm focus:border-indigo-500 focus:outline-none">
                  <option value="all">전체 재원생 대상</option>
                  {classStats.map(c => <option key={c.class_id} value={c.class_id}>{c.name}</option>)}
                </select>

                <div className="flex-1 flex flex-col gap-2 mt-2 h-full">
                  {bulkType === 'general' ? (
                    <textarea placeholder="학부모님들께 발송할 자유 내용을 입력하세요... (카카오톡 미가입자에게도 SMS로 발송됩니다)" value={bulkForm.details} onChange={e=>setBulkForm({...bulkForm, details: e.target.value})} className="border border-slate-300 p-2 rounded-lg text-xs font-bold text-slate-800 flex-1 resize-none min-h-[100px] h-full focus:border-indigo-500 focus:outline-none placeholder:font-normal leading-relaxed"></textarea>
                  ) : bulkType === 'schedule' ? (
                    <>
                      <input type="text" placeholder="일정 구분 (예: 11월 대개강, 중간고사 휴원)" value={bulkForm.scheduleName} onChange={e=>setBulkForm({...bulkForm, scheduleName: e.target.value})} className="border border-slate-300 p-2 rounded-lg text-xs font-bold text-slate-800 focus:border-indigo-500 focus:outline-none placeholder:font-normal" />
                      <input type="text" placeholder="적용 일시 (예: 10월 3일 월요일)" value={bulkForm.applyDate} onChange={e=>setBulkForm({...bulkForm, applyDate: e.target.value})} className="border border-slate-300 p-2 rounded-lg text-xs font-bold text-slate-800 focus:border-indigo-500 focus:outline-none placeholder:font-normal" />
                      <textarea placeholder="상세 안내 내용..." value={bulkForm.details} onChange={e=>setBulkForm({...bulkForm, details: e.target.value})} className="border border-slate-300 p-2 rounded-lg text-xs font-bold text-slate-800 flex-1 resize-none min-h-[60px] h-full focus:border-indigo-500 focus:outline-none placeholder:font-normal"></textarea>
                    </>
                  ) : (
                    <>
                      <input type="text" placeholder="기존 일시 (예: 10/3 14:00)" value={bulkForm.oldDate} onChange={e=>setBulkForm({...bulkForm, oldDate: e.target.value})} className="border border-slate-300 p-2 rounded-lg text-xs font-bold text-slate-800 focus:border-indigo-500 focus:outline-none placeholder:font-normal" />
                      <input type="text" placeholder="변경 일시 (예: 10/4 16:00)" value={bulkForm.newDate} onChange={e=>setBulkForm({...bulkForm, newDate: e.target.value})} className="border border-slate-300 p-2 rounded-lg text-xs font-bold text-slate-800 focus:border-indigo-500 focus:outline-none placeholder:font-normal" />
                      <textarea placeholder="상세 안내 내용..." value={bulkForm.details} onChange={e=>setBulkForm({...bulkForm, details: e.target.value})} className="border border-slate-300 p-2 rounded-lg text-xs font-bold text-slate-800 flex-1 resize-none min-h-[60px] h-full focus:border-indigo-500 focus:outline-none placeholder:font-normal"></textarea>
                    </>
                  )}
                </div>
                <button onClick={handleAddBulkToQueue} className="w-full py-2.5 bg-slate-800 text-white font-bold text-xs rounded-xl shadow-sm hover:bg-slate-900 mt-2 transition-colors">대기열에 담기 ➡️</button>
              </div>
            </div>

            <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-[520px]">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
                <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                  💬 발송 대기열
                  {queuedMessages.length > 0 && <span className="text-[10px] font-bold text-[#3a2929] bg-[#fef01b] px-2 py-0.5 rounded-full shadow-sm">{queuedMessages.length}건 대기중</span>}
                </h3>
                {queuedMessages.length > 0 && <button onClick={() => setQueuedMessages([])} className="text-[10px] text-slate-400 hover:text-rose-500 font-bold transition-colors">전체 비우기</button>}
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scroll p-3 bg-slate-50/50">
                {queuedMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-80">
                    <span className="text-5xl mb-3 drop-shadow-sm">📬</span>
                    <p className="font-bold text-sm">대기 중인 메시지가 없습니다.</p>
                    <p className="text-[10px] mt-1 px-4 text-center leading-relaxed">출결 패널이나 좌측 작성 폼에서<br/>요청을 넘기면 이곳에 담깁니다.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {queuedMessages.map((msg) => (
                      <div key={msg.id} className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-sm flex flex-col group hover:border-indigo-300 transition-colors relative gap-0.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm border truncate max-w-[70px] ${getBadgeColor(msg.previewTitle)}`}>{msg.previewTitle}</span>
                            <div className="flex items-baseline gap-1">
                              <span className="text-[11px] font-extrabold text-slate-700">{msg.studentName}</span>
                              <span className="text-[9px] text-slate-400 font-medium">{msg.parentPhone}</span>
                            </div>
                          </div>
                          <div className="flex items-center pr-5">
                            <span className="text-[9px] font-bold text-slate-400">{msg.queuedAt || msg.timeString || ''}</span>
                          </div>
                          <button onClick={() => setQueuedMessages(prev => prev.filter(m => m.id !== msg.id))} className="w-5 h-5 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-rose-100 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 font-black shrink-0 absolute right-1.5 top-1.5">×</button>
                        </div>
                        
                        {msg.templateId !== "KA01TP260826014520504X1Fplf8R0FH" && msg.details && (
                          <div className="mt-0.5 bg-slate-50 px-2 py-1 rounded text-[9px] text-slate-600 border border-slate-100 line-clamp-1 leading-snug" title={msg.details}>
                            {msg.details}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0">
                <button onClick={handleSendQueuedMessages} disabled={queuedMessages.length === 0 || isSendingAlimtalk} className="w-full py-2.5 bg-[#fef01b] hover:bg-[#eade16] disabled:opacity-50 disabled:bg-slate-100 disabled:text-slate-400 text-[#3a2929] text-sm font-black rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2">
                  {isSendingAlimtalk ? <>발송 중... <span className="animate-spin">⏳</span></> : <>🚀 {queuedMessages.length}건 전체 발송</>}
                </button>
              </div>
            </div>

            <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-[520px]">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
                <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">🔔 발송 완료 피드 <span className="relative flex h-2 w-2 ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span></span></h3>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scroll bg-white">
                {liveFeeds.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 font-bold text-sm">최근 발송 내역이 없습니다.</div>
                ) : (
                  <div className="flex flex-col">
                    {liveFeeds.map((feed, idx) => {
                      const timeStr = new Date(feed.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                      const fullMsg = feed.message || feed.content || '';
                      const match = fullMsg.match(/^\[(.*?)\]/);
                      const categoryName = match ? match[1] : '알림';
                      const descText = match ? fullMsg.replace(/^\[.*?\]\s*/, '') : fullMsg;
                      const badgeColorClass = getBadgeColor(fullMsg);
                      const isSuccess = feed.status === '성공';

                      return (
                        <div key={idx} className="px-3 py-1.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors flex items-center gap-1.5 text-[11px] w-full">
                          <span className={`text-xs font-black shrink-0 ${isSuccess ? 'text-emerald-500' : 'text-rose-500'}`} title={isSuccess ? '성공' : '실패'}>
                            {isSuccess ? '✓' : '✗'}
                          </span>
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${badgeColorClass} shrink-0`}>
                            {categoryName}
                          </span>
                          <div className="flex gap-1 items-baseline shrink-0 w-[100px]">
                            <span className="font-extrabold text-slate-700 truncate max-w-[45px]">{feed.target_name || feed.student_name || '학부모'}</span>
                            <span className="text-[9px] text-slate-400 font-medium truncate">{feed.target_phone || feed.phone || ''}</span>
                          </div>
                          <span className="text-[10px] text-slate-600 truncate flex-1" title={descText}>{descText}</span>
                          <span className="text-[9px] font-bold text-slate-400 shrink-0 ml-1">{timeStr}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
            
            <div className="xl:col-span-2 flex flex-col">
              <AttendanceControlPanel 
                classStats={classStats} 
                todayIso={todayIso} 
                onQueueMessage={(msgOrMsgs) => setQueuedMessages(prev => {
                  const currentTimeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
                  const msgs = Array.isArray(msgOrMsgs) ? msgOrMsgs : [msgOrMsgs];
                  const newMsgs = msgs.map(m => ({ ...m, queuedAt: m.queuedAt || currentTimeStr }));
                  return cleanAndDeduplicateQueue([...prev, ...newMsgs]);
                })} 
              />
            </div>

            {/* 💡 신규 위젯 영역 (기존 결원 모니터링 자리 대체) */}
            <div className="xl:col-span-1 flex flex-col gap-6">
              
              {/* 위젯 4. 오늘의 주요 일정 및 상담 */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col hover:border-indigo-300 transition-colors flex-1 min-h-[250px] max-h-[300px]">
                <div className="flex justify-between items-center mb-3 shrink-0">
                  <span className="text-sm font-extrabold text-slate-700 flex items-center gap-1.5">🗣️ 오늘의 일정 및 상담</span>
                </div>
                <div className="flex-1 overflow-y-auto custom-scroll pr-1 flex flex-col gap-2">
                  {todayAgendas.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs font-bold text-slate-400">오늘 예정된 일정이 없습니다.</div>
                  ) : (
                    todayAgendas.map((ag, i) => {
                       const isMeeting = ag.source === 'Meeting';
                       return (
                          <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:border-indigo-200 transition-colors">
                            <span className={`text-[10px] font-black px-2 py-1 rounded shrink-0 ${isMeeting ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'}`}>
                              {formatTimeAsKST(ag.meeting_date)}
                            </span>
                            <span className="text-xs font-bold text-slate-700 truncate">{ag.title}</span>
                          </div>
                       )
                    })
                  )}
                </div>
              </div>

              {/* 위젯 3. 장기 결석 및 이탈 위험군 경고등 */}
              <div className="bg-white rounded-2xl p-5 border border-rose-100 shadow-sm flex flex-col hover:border-rose-300 transition-colors flex-1 min-h-[250px] max-h-[300px]">
                <div className="flex justify-between items-center mb-3 shrink-0">
                  <span className="text-sm font-extrabold text-rose-600 flex items-center gap-1.5">🚨 이탈 위험군 경고등</span>
                </div>
                <div className="flex-1 overflow-y-auto custom-scroll pr-1 flex flex-col gap-2">
                  {riskStudents.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs font-bold text-slate-400">주의 대상 학생이 없습니다. 🎉</div>
                  ) : (
                    riskStudents.map((st, i) => (
                      <div key={i} className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-rose-50 border border-rose-100 hover:bg-rose-100 transition-colors group">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-extrabold text-slate-800">{st.name}</span>
                            <span className="text-[9px] text-slate-400 font-medium">{st.phone || ''}</span>
                          </div>
                          <button onClick={() => router.push(`/student/${st.id}?tab=consult`)} className="text-[10px] text-rose-500 font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                            상담기록 ➡️
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {st.reasons.map((r: string, j: number) => (
                            <span key={j} className="text-[9px] font-black bg-white text-rose-600 border border-rose-200 px-1.5 py-0.5 rounded shadow-sm">{r}</span>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <InstructorPerformance instructorsStats={instructorsStats} openClassModal={openClassModal} />
            </div>

          </div>

        </main>
      </div>

      <AgendaSidebar currentUser={{ instId: currentUser.instId, name: currentUser.name, isSuperLevel: true }} tenantId={tenantId} hasAccess={() => true} />

      <MemoCreateModal isOpen={isMemoModalOpen} onClose={() => setIsMemoModalOpen(false)} memoData={memoData} setMemoData={setMemoData} onSave={saveMemo} />

      <ClassDetailModal isOpen={isClassModalOpen} onClose={() => setIsClassModalOpen(false)} classModalData={classModalData} classSchedules={classSchedules} classStudents={classStudents} />
      
    </div>
  );
}