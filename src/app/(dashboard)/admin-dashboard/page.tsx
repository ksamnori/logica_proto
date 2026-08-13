// src/app/(dashboard)/admin-dashboard/page.tsx
"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Chart from "chart.js/auto";
import AgendaSidebar from "@/components/dashboard/AgendaSidebar";

const ClassVacancyBadge = ({ vacancy }: { vacancy: number }) => {
  if (vacancy <= 0) return <span className="text-[9px] font-black text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded shadow-sm">마감</span>;
  if (vacancy <= 2) return <span className="text-[9px] font-black text-amber-500 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded shadow-sm">마감 임박</span>;
  return <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded shadow-sm">{vacancy}자리 여유</span>;
};

const NotiStatusBadge = ({ status }: { status: string }) => {
  const isFail = status?.includes('실패') || status?.includes('에러');
  const isWait = status?.includes('대기') || status?.includes('예약');
  if (isFail) return <span className="bg-rose-50 text-rose-600 border border-rose-100 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 shadow-sm">실패</span>;
  if (isWait) return <span className="bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 shadow-sm">{status}</span>;
  return <span className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 shadow-sm">성공</span>;
};

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchClassFilter, setSearchClassFilter] = useState("all");
  const [searchStatusFilter, setSearchStatusFilter] = useState("재원");
  const [searchGradeFilter, setSearchGradeFilter] = useState("all");
  
  const [showStudentPhone, setShowStudentPhone] = useState<Record<string, boolean>>({});

  const [csRequests, setCsRequests] = useState<any[]>([]);
  const [memos, setMemos] = useState<any[]>([]);
  const [instructorsStats, setInstructorsStats] = useState<any[]>([]);
  const [classStats, setClassStats] = useState<any[]>([]);
  const [levelCounts, setLevelCounts] = useState<any>(null);
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [liveFeeds, setLiveFeeds] = useState<any[]>([]);

  const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
  const [memoData, setMemoData] = useState({ type: "일반공지", content: "" });
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [classModalData, setClassModalData] = useState<any>({});
  const [classStudents, setClassStudents] = useState<any[]>([]);
  const [classSchedules, setClassSchedules] = useState<any[]>([]);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<any>(null);

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
    if (levelCounts && chartRef.current) {
      if (chartInstance.current) chartInstance.current.destroy();
      
      const total = Object.values(levelCounts).reduce((a: any, b: any) => a + b, 0) as number;
      if (total === 0) return;

      chartInstance.current = new Chart(chartRef.current, {
        type: 'doughnut',
        data: {
          labels: ['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon', '기타'],
          datasets: [{
            data: [levelCounts['Ultimate']||0, levelCounts['Master']||0, levelCounts['Apex']||0, levelCounts['Titan']||0, levelCounts['Horizon']||0, levelCounts['기타']||0],
            backgroundColor: ['#0f172a', '#002864', '#0ea5e9', '#10b981', '#f59e0b', '#cbd5e1'],
            borderWidth: 0,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '65%',
          plugins: { legend: { position: 'right', labels: { font: { weight: 'bold', size: 11 }, usePointStyle: true, padding: 15 } } }
        },
        plugins: [{
          id: 'textCenter',
          beforeDraw: function(chart) {
            const { width, height, ctx } = chart;
            ctx.restore();
            const fontSize = (height / 110).toFixed(2);
            ctx.font = `900 ${fontSize}em Pretendard`;
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#1e293b";
            const text = `${total}건`, textX = Math.round((width - ctx.measureText(text).width) / 2) - 40, textY = height / 2;
            ctx.fillText(text, textX, textY);
            ctx.save();
          }
        }]
      });
    }
  }, [levelCounts]);

  const loadDashboardData = async () => {
    await Promise.allSettled([
      fetchKPIStudents(), fetchKPIBilling(), fetchKPIAdmission(),
      fetchCSRequests(), fetchAdmissions(), fetchLiveFeeds(),
      fetchInstructorStats(), fetchClassMonitoring(), fetchMemos(),
      fetchAllSearchData() 
    ]);
  };

  // 🌟 [수정] 학생 수강 기록 조회 시 'end_date' 필드를 추가로 가져옵니다!
  const fetchAllSearchData = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    // enrollment 에서 status 뿐만 아니라 end_date 도 가져와야 현재 수강중인지 정확히 알 수 있습니다.
    let query = supabase.from('student').select('student_id, name, phone, school, grade, status, parent(phone), enrollment(status, end_date, class(name))');
    if (tId && tId !== 'hq') query = query.eq('tenant_id', tId);
    
    const { data } = await query.order('name');
    setAllStudentsData(data || []);
  };

  const availableGrades = useMemo(() => {
    const grades = allStudentsData.map(s => s.grade).filter(Boolean);
    return Array.from(new Set(grades)).sort((a, b) => {
      const order = { '초': 1, '중': 2, '고': 3 };
      const aMatch = String(a).match(/([초중고])\s*(\d)/);
      const bMatch = String(b).match(/([초중고])\s*(\d)/);
      if (aMatch && bMatch) {
        if (order[aMatch[1] as keyof typeof order] !== order[bMatch[1] as keyof typeof order]) {
          return order[aMatch[1] as keyof typeof order] - order[bMatch[1] as keyof typeof order];
        }
        return Number(aMatch[2]) - Number(bMatch[2]);
      }
      return String(a).localeCompare(String(b));
    });
  }, [allStudentsData]);

  // 🌟 [추가] 학생들의 실제 수강 기록을 뒤져 존재하는 모든 반의 이름을 동적으로 추출합니다.
  const availableClasses = useMemo(() => {
    const classSet = new Set<string>();
    allStudentsData.forEach(s => {
      // 🌟 [핵심 변경] end_date가 없거나, status가 수강중인 기록만 유효한 것으로 처리
      const activeEnrolls = s.enrollment?.filter((e:any) => !e.end_date || e.status === '수강중') || [];
      activeEnrolls.forEach((e:any) => {
        const cName = unwrap(e.class)?.name;
        if (cName) classSet.add(cName);
      });
    });
    return Array.from(classSet).sort();
  }, [allStudentsData]);

  const filteredSearchData = useMemo(() => {
    return allStudentsData.filter(s => {
      if (searchStatusFilter !== 'all' && s.status !== searchStatusFilter) return false;
      if (searchGradeFilter !== 'all' && s.grade !== searchGradeFilter) return false;
      
      // 🌟 [핵심 변경] end_date 판별 로직 적용
      const activeEnrolls = s.enrollment?.filter((e:any) => !e.end_date || e.status === '수강중') || [];
      const classNames = activeEnrolls.map((e:any) => unwrap(e.class)?.name).filter(Boolean);
      
      if (searchClassFilter !== 'all' && !classNames.includes(searchClassFilter)) return false;
      
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const sName = (s.name || '').toLowerCase();
        const sSchool = (s.school || '').toLowerCase();
        const sPhone = (s.phone || '').replace(/-/g, '');
        const pPhone = (unwrap(s.parent)?.phone || '').replace(/-/g, '');
        const qPhone = q.replace(/-/g, '');
        
        return sName.includes(q) || sSchool.includes(q) || sPhone.includes(qPhone) || pPhone.includes(qPhone);
      }
      return true;
    });
  }, [allStudentsData, searchQuery, searchClassFilter, searchStatusFilter, searchGradeFilter]);


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
      let query = supabase.from('instructor_memo').select('*').neq('status', '완료').order('created_at', { ascending: false }).limit(20);
      if (tId && tId !== 'hq') query = query.eq('tenant_id', tId);
      const { data, error } = await query;
      if (error) throw error;
      setMemos(data || []);
    } catch (err) {
      console.error("업무 보드 로딩 에러:", err);
      setMemos([]);
    }
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
    let query = supabase.from('notification_log').select('*').order('created_at', { ascending: false }).limit(20);
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
        const isGuest = pos.includes('테스트') || pos.includes('체험') || role === 'GUEST';
        const isSuper = pos.includes('최고관리자') || role === 'SUPER_ADMIN';
        const isTA = pos.includes('조교') || role === 'TA';
        return !isGuest && !isSuper && !isTA;
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
      if (lvCounts[lv] !== undefined) {
        lvCounts[lv] += c.sCount;
      } else {
        lvCounts['기타'] += c.sCount;
      }
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
    if (enrollIds.length === 0) { 
      setClassStudents([]); 
      return; 
    }
    const { data } = await supabase.from("student").select("*, parent(phone), enrollment(class(name))").in("student_id", enrollIds);
    setClassStudents(data || []);
  };

  const saveMemo = async () => {
    if (!memoData.content.trim()) return alert("내용을 입력해주세요.");
    
    const myTenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = myTenantId === 'hq' ? '1ff4299c-d72b-4d99-97b0-45fee08e3b73' : myTenantId;

    if (!validTenantId) return alert("소속 지점 정보가 없습니다.");

    try {
      const { error } = await supabase.from('instructor_memo').insert({ 
        instructor_id: currentUser.instId, 
        author_name: currentUser.name, 
        memo_type: memoData.type, 
        content: memoData.content,
        tenant_id: validTenantId
      });

      if (error) throw error;

      setIsMemoModalOpen(false);
      setMemoData({ type: "일반공지", content: "" });
      fetchMemos();
    } catch (err: any) { 
      alert("등록 실패: " + err.message); 
    }
  };

  const deleteMemo = async (memoId: string) => {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    try {
      await supabase.from('instructor_memo').delete().eq('memo_id', memoId);
      fetchMemos();
    } catch (err) { alert("삭제 실패"); }
  };

  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }
  
  if (isAuthorized === false) {
    return null; 
  }

  return (
    <div className="flex w-full h-full bg-slate-50 overflow-hidden font-pretendard">
      
      <div className="flex-1 flex flex-col h-full overflow-y-auto custom-scroll relative z-0 -mx-8 -mt-4">
        <header className="bg-gradient-to-br from-[#0f172a] to-[#1e1b4b] text-white pt-8 pb-20 px-8 shrink-0 relative z-0">
          <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
          <div className="relative z-10 flex justify-between items-center ml-6">
            <div>
              <h1 className="text-3xl font-black tracking-tight font-lexend flex items-center gap-3">
                <span>LOGICA 학원 통합 관리</span>
                <span className="bg-blue-500/30 text-blue-100 text-[15px] px-3 py-1 rounded-lg font-bold border border-blue-400/30 font-pretendard shadow-sm flex items-center shadow-inner">
                  🏢 {tenantName}
                </span>
                <button onClick={() => router.push('/supervisor')} className="shrink-0 ml-3 bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white border border-indigo-400/50 px-4 py-1.5 rounded-xl text-sm font-bold shadow-md transition-all flex items-center gap-1.5">
                  <span className="text-lg">📡</span> 클리닉 관제탑
                </button>
              </h1>
              <p className="text-slate-300 text-sm mt-2 font-medium tracking-tight">{todayString}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-visible px-8 pb-10 -mt-14 relative z-10 bg-transparent">
          
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 mb-6 px-6">
            
            {/* KPI 요약 블록 */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-lg relative overflow-hidden flex flex-col justify-between h-64 col-span-1">
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

            {/* 통합 빠른 검색기 */}
            <div className="bg-white rounded-2xl p-5 border border-indigo-100 shadow-lg col-span-1 md:col-span-2 h-64 flex flex-col relative overflow-hidden group">
              <div className="absolute right-[-10px] bottom-[-20px] text-8xl opacity-[0.03] pointer-events-none group-hover:scale-110 transition-transform duration-500">🔎</div>
              
              <div className="flex justify-between items-center mb-3 shrink-0 relative z-10">
                <span className="text-sm font-extrabold text-slate-700 flex items-center gap-1.5">
                  <span className="text-base">🔎</span> 통합 원생 검색기
                  <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 shadow-sm ml-1">Quick Search</span>
                </span>
              </div>
              
              <div className="flex gap-2 mb-3 shrink-0 relative z-10">
                <select value={searchStatusFilter} onChange={e=>setSearchStatusFilter(e.target.value)} className="w-[80px] border border-slate-300 rounded-lg p-1.5 text-xs font-bold text-slate-600 bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm">
                  <option value="all">상태 전체</option>
                  <option value="재원">✅ 재원</option>
                  <option value="휴원">⏸️ 휴원</option>
                  <option value="퇴원">❌ 퇴원</option>
                  <option value="입학테스트">📝 대기</option>
                </select>
                <select value={searchGradeFilter} onChange={e=>setSearchGradeFilter(e.target.value)} className="w-[84px] border border-slate-300 rounded-lg p-1.5 text-xs font-bold text-slate-600 bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm">
                  <option value="all">학년 전체</option>
                  {availableGrades.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <select value={searchClassFilter} onChange={e=>setSearchClassFilter(e.target.value)} className="w-[100px] border border-slate-300 rounded-lg p-1.5 text-xs font-bold text-slate-600 bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm truncate">
                  <option value="all">수강반 전체</option>
                  {/* 🌟 동적으로 추출된 정확한 진행 반 목록 렌더링 */}
                  {availableClasses.map(cName => <option key={cName} value={cName}>{cName}</option>)}
                </select>
                <div className="flex-1 relative">
                  <input type="text" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="이름, 연락처, 학부모 연락처, 학교 검색..." className="w-full border border-slate-300 rounded-lg p-1.5 pl-8 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm placeholder:text-slate-400" />
                  <svg className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scroll border border-slate-200 rounded-lg bg-slate-50 relative z-10 min-h-0 shadow-inner">
                <table className="w-full text-left text-[11px] whitespace-nowrap">
                  <thead className="sticky top-0 bg-white border-b border-slate-200 z-10 shadow-sm">
                    <tr>
                      <th className="py-2 px-3 font-extrabold text-slate-500 w-[80px]">이름</th>
                      <th className="py-2 px-3 font-extrabold text-slate-500">학교/학년</th>
                      <th className="py-2 px-3 font-extrabold text-slate-500">수강반</th>
                      <th className="py-2 px-3 font-extrabold text-slate-500">학부모 연락처</th>
                      <th className="py-2 px-3 font-extrabold text-slate-500 text-center">상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {filteredSearchData.length === 0 ? (
                      <tr><td colSpan={5} className="py-8 text-center text-slate-400 font-bold">조건에 맞는 학생이 없습니다.</td></tr>
                    ) : (
                      filteredSearchData.map(s => {
                        // 🌟 [핵심 변경] end_date가 비어있거나 status가 수강중인 것만 활성으로 판별!
                        const activeEnrolls = s.enrollment?.filter((e:any) => !e.end_date || e.status === '수강중') || [];
                        const cNames = activeEnrolls.map((e:any)=>unwrap(e.class)?.name).filter(Boolean).join(", ") || "-";
                        
                        const schoolGradeStr = `${s.school||'-'} ${s.grade||''}`.trim();
                        const parentPhone = unwrap(s.parent)?.phone || '미입력';

                        return (
                          <tr key={s.student_id} onClick={() => router.push(`/student/${s.student_id}`)} className="cursor-pointer hover:bg-indigo-50/50 transition-colors group bg-white">
                            <td className="py-2 px-3 font-bold text-[#002864] group-hover:text-indigo-600 group-hover:underline max-w-[100px] truncate">{s.name}</td>
                            <td className="py-2 px-3 text-slate-500 max-w-[120px] truncate" title={schoolGradeStr}>{schoolGradeStr}</td>
                            <td className="py-2 px-3 text-slate-600 max-w-[120px] truncate" title={cNames}>{cNames}</td>
                            <td className="py-2 px-3 text-slate-500 align-middle">
                              <div className="flex flex-col gap-1 justify-center">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-slate-700 tabular-nums tracking-tight">{parentPhone}</span>
                                  {s.status === '입학테스트' && parentPhone && (
                                    <span className="text-[8px] bg-rose-50 text-rose-500 border border-rose-100 px-1 py-0.5 rounded shadow-sm leading-none mt-0.5">학부모</span>
                                  )}
                                  {s.phone && !showStudentPhone[s.student_id] && (
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); setShowStudentPhone(p => ({...p, [s.student_id]: true})); }}
                                      className="text-[9px] bg-white border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 px-1 py-0.5 rounded font-bold transition-colors shadow-sm flex items-center gap-0.5 leading-none mt-0.5"
                                      title="학생 연락처 보기"
                                    >
                                      학생 <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                    </button>
                                  )}
                                </div>
                                {s.phone && showStudentPhone[s.student_id] && (
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[11px] font-bold text-indigo-600 tabular-nums tracking-tight">{s.phone}</span>
                                    <span className="text-[8px] bg-indigo-50 text-indigo-500 border border-indigo-100 px-1 py-0.5 rounded shadow-sm">학생</span>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-center align-middle">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shadow-sm border ${s.status==='재원'?'bg-emerald-50 text-emerald-600 border-emerald-100':s.status==='입학테스트'?'bg-amber-50 text-amber-600 border-amber-100':s.status==='휴원'?'bg-rose-50 text-rose-500 border-rose-100':'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                {s.status === '입학테스트' ? '대기' : s.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* CS 영역 */}
            <div onClick={() => router.push('/cs')} className="bg-white rounded-2xl p-5 border border-rose-100 shadow-lg relative overflow-hidden hover:border-rose-400 transition-colors cursor-pointer h-64 flex flex-col">
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

            {/* 업무 메모 영역 */}
            <div className="bg-white rounded-2xl p-5 border border-purple-100 shadow-lg relative overflow-hidden hover:border-purple-300 transition-colors cursor-pointer h-64 flex flex-col" onClick={() => router.push('/task')}>
              <div className="flex justify-between items-center mb-3 shrink-0 relative z-10">
                <span className="text-sm font-extrabold text-slate-700 flex items-center gap-1">📌 업무 공유 보드</span>
                <button onClick={(e) => { e.stopPropagation(); setIsMemoModalOpen(true); }} className="text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1.5 rounded font-bold transition-colors border border-blue-200 shadow-sm">+ 작성</button>
              </div>
              <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto custom-scroll pr-1 relative z-10 min-h-0">
                {memos.length === 0 ? <div className="text-center py-6 text-slate-400 font-bold text-xs mt-4">등록된 공지/업무가 없습니다.</div> :
                  memos.map(m => {
                    let typeColor = 'text-slate-600 bg-slate-100 border-slate-200'; 
                    if (m.memo_type === '긴급공지') typeColor = 'text-rose-600 bg-rose-100 border-rose-200';
                    else if (m.memo_type === '학생인계') typeColor = 'text-blue-600 bg-blue-100 border-blue-200';
                    else if (m.memo_type === '일반공지') typeColor = 'text-emerald-600 bg-emerald-100 border-emerald-200';
                    return (
                      <div key={m.memo_id} className="shrink-0 flex flex-col border-b border-slate-100 pb-2 mb-1 last:border-0 hover:bg-slate-50/50 p-1 rounded transition-colors group">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[9px] font-black ${typeColor} px-1.5 py-0.5 rounded border`}>{m.memo_type}</span>
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

          <div className="mb-6">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-white rounded-t-2xl border shadow-sm relative z-10">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">👨‍🏫 강사별 운영 및 원생 관리 성과</h3>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 border border-slate-200 px-2 py-1 rounded shadow-sm">실시간 자동 분류</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-5 bg-transparent border border-t-0 border-slate-200 rounded-b-2xl shadow-sm">
              {instructorsStats.length === 0 ? <div className="col-span-full text-center py-10 text-slate-400 font-bold text-sm">강사 데이터를 불러오는 중입니다...</div> : 
                instructorsStats.map(inst => (
                  <div key={inst.instructor_id} className="border border-slate-200 rounded-xl p-3 shadow-sm bg-white flex gap-2.5 h-[110px]">
                    
                    <div className="w-[72px] bg-slate-100 rounded-lg shadow-inner overflow-hidden flex-shrink-0 border border-slate-200 relative h-full">
                      {inst.profile_image_url ? (
                        <img 
                          src={inst.profile_image_url.startsWith('http') ? inst.profile_image_url : `https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/${inst.profile_image_url}`} 
                          className="absolute inset-0 w-full h-full object-cover" 
                          alt="profile"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-2xl font-black text-blue-400 bg-blue-50">
                          {inst.name?.charAt(0) || 'T'}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 flex flex-col min-w-0 h-full">
                      <div className="flex justify-between items-center mb-1.5 gap-1 shrink-0">
                        <div 
                          className="font-extrabold text-[13px] text-slate-800 truncate leading-none mt-0.5 cursor-pointer hover:text-[#002864] hover:underline" 
                          onClick={() => router.push('/instructor')}
                          title="강사 관리 페이지로 이동"
                        >
                          {inst.name} 선생님
                        </div>
                        
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="flex gap-0.5 text-[9px] font-bold">
                            <span className="text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100 shadow-sm flex items-center">입학 +{inst.newCnt}</span>
                            <span className="text-rose-500 bg-rose-50 px-1 py-0.5 rounded border border-rose-100 shadow-sm flex items-center">퇴원 -{inst.leftCnt}</span>
                          </div>
                          
                          <div className="text-right leading-none shrink-0 border-l border-slate-200 pl-1.5 flex items-baseline">
                            <span className="text-base font-black text-[#002864]">{inst.studentCount}</span><span className="text-[9px] font-bold text-slate-400 ml-0.5">명</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="border-t border-slate-100 pt-1.5 flex flex-col flex-1 min-h-0">
                        <div className="text-[9px] font-bold text-slate-500 mb-1 flex items-center gap-1 shrink-0"><span>📚</span> 담당 수강반 ({inst.myClasses.length})</div>
                        <div className="flex flex-wrap gap-1 content-start flex-1 overflow-y-auto custom-scroll pr-1 pb-1 min-h-0">
                          {inst.myClasses.length === 0 ? <span className="text-[10px] text-slate-400 font-bold">배정된 반 없음</span> : 
                            inst.myClasses.map((c: any) => (
                              <span 
                                key={c.class_id} 
                                onClick={(e) => { e.stopPropagation(); openClassModal({...c, instructor: { name: inst.name }}); }} 
                                className="text-[9px] font-bold bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-slate-600 shadow-sm whitespace-nowrap cursor-pointer hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
                              >
                                {c.name}
                              </span>
                            ))
                          }
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-[380px]">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
                <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                  💬 단체 알림톡 발송 
                  <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">서류 심사 중</span>
                </h3>
              </div>
              <div className="flex-1 p-6 flex flex-col gap-4 bg-white opacity-90 relative">
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center backdrop-blur-sm bg-white/40">
                    <span className="text-5xl mb-4 drop-shadow-md">⏳</span>
                    <p className="text-slate-800 font-black text-xl mb-1 drop-shadow-sm">카카오톡 비즈니스 채널 연동 대기 중</p>
                    <p className="text-slate-600 font-bold text-sm bg-white/80 px-3 py-1 rounded-md shadow-sm">제출하신 채널 서류가 심사 중입니다. 카카오 승인 후 발송 기능이 활성화됩니다.</p>
                  </div>
                  
                  <div className="pointer-events-none opacity-40">
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">발송 대상 선택</label>
                    <select className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-bold text-slate-600 bg-slate-50 mb-4">
                      <option>전체 재원생 학부모</option>
                      <option>특정 반 선택...</option>
                    </select>
                  </div>
                  <div className="flex-1 flex flex-col min-h-0 pointer-events-none opacity-40">
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">메시지 내용</label>
                    <textarea className="w-full flex-1 border border-slate-300 rounded-lg p-3 text-sm font-medium text-slate-600 bg-slate-50 resize-none" placeholder="발송할 알림톡 내용을 입력하세요..."></textarea>
                  </div>
                  <div className="flex justify-end shrink-0 pointer-events-none opacity-40 mt-4">
                     <button className="px-8 py-3 bg-[#fef01b] text-[#3a2929] font-black rounded-xl shadow-sm">카카오톡 발송하기</button>
                  </div>
              </div>
            </div>

            <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-[380px]">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
                <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">🔔 알림톡/문자 발송 피드</h3>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-2">
                {liveFeeds.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 font-bold text-sm">최근 발송 내역이 없습니다.</div>
                ) : (
                  liveFeeds.map((feed, idx) => {
                    const timeStr = new Date(feed.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={idx} className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex flex-col gap-1.5 hover:bg-slate-100 transition-colors">
                         <div className="flex items-center justify-between">
                           <NotiStatusBadge status={feed.status || '성공'} />
                           <span className="text-[10px] font-bold text-slate-400">{timeStr}</span>
                         </div>
                         <div className="flex items-center gap-1.5">
                           <span className="text-[11px] font-black text-slate-700">{feed.target_name || feed.student_name || '학부모'}</span>
                           <span className="text-[10px] font-bold text-slate-400 truncate">{feed.target_phone || feed.phone || ''}</span>
                         </div>
                         <p className="text-[11px] font-medium text-slate-600 truncate">{feed.message || feed.content || '알림톡 발송 완료'}</p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="lg:col-span-2 bg-transparent rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-[380px]">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-white shrink-0 rounded-t-2xl">
                <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">🏫 수강반 결원 모니터링 <span className="text-xs font-normal text-slate-400">(목표 정원 기준)</span></h3>
                <span className="text-[10px] font-bold text-rose-500 bg-rose-50 border border-rose-100 px-2 py-1 rounded shadow-sm">결원이 많은 순 (모집 시급) 정렬</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-5 bg-transparent border-t-0 border-slate-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {classStats.length === 0 ? <div className="col-span-full text-center py-10 text-slate-400 font-bold text-sm">운영 중인 반이 없습니다.</div> : 
                    classStats.map(c => {
                      const bgClass = c.vacancy > 2 ? 'bg-blue-50/20 border-blue-200' : 'bg-white border-slate-200';
                      const barColor = c.vacancy <= 0 ? 'bg-rose-400' : c.vacancy <= 2 ? 'bg-amber-400' : 'bg-[#002864]';
                      return (
                        <div key={c.class_id} onClick={() => openClassModal(c)} className={`p-3 border rounded-xl hover:shadow-md transition-all cursor-pointer flex flex-col justify-between ${bgClass}`}>
                          <div className="flex justify-between items-start mb-2 gap-1">
                            <span className="text-[11px] font-extrabold text-slate-700 truncate" title={c.name}>{c.name}</span>
                            <ClassVacancyBadge vacancy={c.vacancy} />
                          </div>
                          <div>
                            <div className="flex justify-between items-end mb-1">
                              <span className="text-[10px] font-bold text-slate-400">{c.instructor?.name || '미정'} 선생님</span>
                              <span className="text-sm font-black text-[#002864]">{c.sCount}<span className="text-[9px] text-slate-400 font-bold ml-0.5">/ {c.capacity}명</span></span>
                            </div>
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden shadow-inner mt-1">
                              <div className={`${barColor} h-1.5 rounded-full transition-all duration-1000`} style={{ width: `${c.fillRate}%` }}></div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  }
                </div>
              </div>
            </div>

            <div className="lg:col-span-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden h-[380px]">
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                <h3 className="text-sm font-extrabold text-slate-800">📊 레벨별 수강 비중 <span className="text-xs font-normal text-slate-500">(총 수강 건수)</span></h3>
              </div>
              <div className="flex-1 p-5 flex flex-col items-center justify-center relative bg-white">
                <div className="absolute inset-0 p-5 pb-8 flex items-center justify-center">
                  <canvas id="levelChart" ref={chartRef}></canvas>
                </div>
                {(!levelCounts || Object.values(levelCounts).reduce((a:any,b:any)=>a+b,0) === 0) && (
                  <div className="z-10 text-xs font-bold text-slate-400 bg-white/80 p-2 rounded">재원생 데이터가 없습니다.</div>
                )}
              </div>
            </div>
          </div>

        </main>
      </div>

      <AgendaSidebar 
        currentUser={{ instId: currentUser.instId, name: currentUser.name, isSuperLevel: true }} 
        tenantId={tenantId} 
        hasAccess={() => true} 
      />

      {isMemoModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-sm">업무 공유 / 공지사항 작성</h2>
              <button onClick={() => setIsMemoModalOpen(false)} className="text-white hover:text-rose-400 text-2xl font-bold leading-none">&times;</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">분류 (태그)</label>
                <select value={memoData.type} onChange={(e) => setMemoData({...memoData, type: e.target.value})} className="w-full text-sm font-bold text-slate-700 border border-slate-300 rounded-lg p-2 focus:outline-none focus:border-[#002864]">
                  <option value="긴급공지">🚨 긴급공지</option>
                  <option value="일반공지">📢 일반공지</option>
                  <option value="학생인계">🤝 학생인계</option>
                  <option value="행정요청">📝 행정요청</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">내용 작성</label>
                <textarea value={memoData.content} onChange={(e) => setMemoData({...memoData, content: e.target.value})} rows={4} className="w-full text-sm font-medium text-slate-800 border border-slate-300 rounded-lg p-3 focus:outline-none focus:border-[#002864] resize-none" placeholder="선생님들께 공유할 내용을 입력하세요..."></textarea>
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button onClick={() => setIsMemoModalOpen(false)} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-50 transition-colors shadow-sm">취소</button>
              <button onClick={async () => {
                if (!memoData.content.trim()) return alert("내용을 입력해주세요.");
                const myTenantId = localStorage.getItem("logica_tenant_id");
                const validTenantId = myTenantId === 'hq' ? '1ff4299c-d72b-4d99-97b0-45fee08e3b73' : myTenantId;
                if (!validTenantId) return alert("소속 지점 정보가 없습니다.");
                try {
                  const { error } = await supabase.from('instructor_memo').insert({
                    instructor_id: currentUser.instId, author_name: currentUser.name,
                    memo_type: memoData.type, content: memoData.content, tenant_id: validTenantId
                  });
                  if (error) throw error;
                  setIsMemoModalOpen(false); setMemoData({ type: "일반공지", content: "" }); fetchMemos();
                } catch (err: any) { alert("등록 실패: " + err.message); }
              }} className="px-4 py-2 bg-[#002864] text-white text-xs font-bold rounded-lg hover:bg-blue-900 transition-colors shadow-sm">공지 등록</button>
            </div>
          </div>
        </div>
      )}

      {isClassModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-[#002864] p-5 text-white flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold tracking-tight">🏫 반 상세 정보 및 수강생 목록</h2>
              <button onClick={() => setIsClassModalOpen(false)} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50">
              <h3 className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2">📋 기본 정보</h3>
              <div className="grid grid-cols-2 gap-4 mb-8 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">반 코드</label>
                  <input type="text" value={classModalData.code || ""} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100 uppercase" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">반 이름</label>
                  <input type="text" value={classModalData.name || ""} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">대상 학년</label>
                  <input type="text" value={classModalData.target_grade || ""} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">월 정규 수강료</label>
                  <div className="flex items-center gap-2">
                    <input type="number" value={classModalData.tuition_fee || 0} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100" />
                    <span className="font-bold text-slate-500">원</span>
                  </div>
                </div>

                <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <label className="block text-xs font-bold text-slate-500 mb-3">수업 요일 및 시간</label>
                  <div className="flex flex-col gap-2">
                    {classSchedules.map(s => (
                      <div key={s.day} className={`flex items-center gap-4 bg-white p-2.5 rounded-lg border border-slate-200`}>
                        <label className="flex items-center gap-2 w-16 shrink-0">
                          <input type="checkbox" disabled checked={s.checked} className="w-5 h-5 accent-[#002864]" />
                          <span className={`font-bold ${s.day === '토' ? 'text-blue-600' : s.day === '일' ? 'text-red-500' : 'text-slate-700'}`}>{s.day}</span>
                        </label>
                        {s.checked && (
                          <div className="flex-1 flex items-center gap-2">
                            <input type="time" disabled value={s.start_time} className="px-3 py-1 rounded border border-slate-300 text-sm w-full font-bold bg-slate-100" />
                            <span className="font-bold text-slate-400">~</span>
                            <input type="time" disabled value={s.end_time} className="px-3 py-1 rounded border border-slate-300 text-sm w-full font-bold bg-slate-100" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">상태</label>
                  <input type="text" value={classModalData.status || "예정"} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">담당 강사</label>
                  <input type="text" value={classModalData.instructorName ? `${classModalData.instructorName} 선생님` : "미정"} readOnly className="w-full px-3 py-2 rounded border border-slate-300 font-bold bg-slate-100" />
                </div>
              </div>

              <div className="flex justify-between items-end mb-3 border-b border-slate-200 pb-2">
                <h3 className="font-bold text-slate-800">👨‍🎓 수강 학생 리스트</h3>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-4 font-bold text-slate-500">이름</th>
                      <th className="py-2.5 px-4 font-bold text-slate-500">학년</th>
                      <th className="py-2.5 px-4 font-bold text-slate-500">수강반</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {classStudents.length === 0 ? (
                      <tr><td colSpan={3} className="py-6 text-center text-slate-400 font-bold">배정된 학생이 없습니다.</td></tr>
                    ) : (
                      classStudents.map(s => {
                        const uniqueClasses = Array.from(new Set(s.enrollment?.map((e: any) => e.class?.name).filter(Boolean))).join(", ") || "-";
                        return (
                          <tr key={s.student_id}>
                            <td className="py-2.5 px-4 font-bold text-[#002864]">{s.name}</td>
                            <td className="py-2.5 px-4 text-slate-600 text-xs font-bold">{s.grade || "-"}</td>
                            <td className="py-2.5 px-4 text-slate-600 text-xs font-bold max-w-[200px] truncate">{uniqueClasses}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0">
              <button onClick={() => setIsClassModalOpen(false)} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-lg hover:bg-slate-200 shadow-sm transition-colors">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}