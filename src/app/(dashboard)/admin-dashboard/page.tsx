// src/app/(dashboard)/admin-dashboard/page.tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Chart from "chart.js/auto";

// ==========================================
// 보안 강화를 위한 인라인 헬퍼 컴포넌트 (XSS 방어)
// ==========================================
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

export default function AdminDashboardPage() {
  const router = useRouter();

  // === 상태 관리 ===
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "관리자" });
  const [todayString, setTodayString] = useState("데이터를 불러오는 중입니다...");
  const [thisMonthStr, setThisMonthStr] = useState("");
  const [firstDayOfMonth, setFirstDayOfMonth] = useState("");
  const [todayIso, setTodayIso] = useState("");

  const [kpi, setKpi] = useState({
    totalStu: 0, newStu: 0, leftStu: 0, payRate: 0, paidAmt: 0, unpaidAmt: 0, waitingStu: 0, passedStu: 0, csCount: 0
  });

  const [csRequests, setCsRequests] = useState<any[]>([]);
  const [memos, setMemos] = useState<any[]>([]);
  const [instructorsStats, setInstructorsStats] = useState<any[]>([]);
  const [classStats, setClassStats] = useState<any[]>([]);
  const [levelCounts, setLevelCounts] = useState<any>(null);
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [liveFeeds, setLiveFeeds] = useState<any[]>([]);

  // === 모달 상태 ===
  const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
  const [memoData, setMemoData] = useState({ type: "일반공지", content: "" });
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [classModalData, setClassModalData] = useState<any>({});
  const [classStudents, setClassStudents] = useState<any[]>([]);
  const [classSchedules, setClassSchedules] = useState<any[]>([]);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<any>(null);

  // === 초기 세팅 ===
  useEffect(() => {
    const instId = localStorage.getItem('logica_instructor_id') || "1";
    const name = localStorage.getItem('logica_instructor_name') || "관리자";
    setCurrentUser({ instId, name });

    const today = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    setTodayString(`${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 (${days[today.getDay()]}) 실시간 요약 지표`);
    setThisMonthStr(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
    setTodayIso(today.toISOString().split('T')[0]);
    setFirstDayOfMonth(new Date(today.getFullYear(), today.getMonth(), 1).toISOString());
  }, []);

  useEffect(() => {
    if (thisMonthStr && firstDayOfMonth) {
      loadDashboardData();
    }
  }, [thisMonthStr, firstDayOfMonth]);

  // === 차트 렌더링 ===
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
            // 💡 [변경됨] "명" -> "건" 으로 변경하여 오해를 방지합니다.
            const text = `${total}건`, textX = Math.round((width - ctx.measureText(text).width) / 2) - 40, textY = height / 2;
            ctx.fillText(text, textX, textY);
            ctx.save();
          }
        }]
      });
    }
  }, [levelCounts]);

  // ==========================================
  // 데이터 Fetching 로직
  // ==========================================
  const loadDashboardData = async () => {
    await Promise.allSettled([
      fetchKPIStudents(), fetchKPIBilling(), fetchKPIAdmission(),
      fetchCSRequests(), fetchAdmissions(), fetchLiveFeeds(),
      fetchInstructorStats(), fetchClassMonitoring(), fetchMemos()
    ]);
  };

  const fetchKPIStudents = async () => {
    const { data } = await supabase.from('student').select('*');
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
    const { data } = await supabase.from('academy_billing').select('*').eq('billing_month', thisMonthStr);
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
    const { data: apps } = await supabase.from('admission_application').select('*').gte('created_at', firstDayOfMonth);
    const passedCount = apps?.filter(a => ['합격'].includes(a.test_result || a.status || a.application_status)).length || 0;
    const { data: students } = await supabase.from('student').select('*').eq('status', '입학테스트');
    setKpi(prev => ({ ...prev, passedStu: passedCount, waitingStu: students?.length || 0 }));
  };

  const fetchCSRequests = async () => {
    const { data } = await supabase.from('parent_request_log').select('*, student(name)').eq('status', '대기').order('created_at', { ascending: false }).limit(15);
    setCsRequests(data || []);
    setKpi(prev => ({ ...prev, csCount: data?.length || 0 }));
  };

  const fetchMemos = async () => {
    const { data } = await supabase.from('instructor_memo').select('*').neq('status', '완료').order('created_at', { ascending: false }).limit(20);
    setMemos(data || []);
  };

  const fetchAdmissions = async () => {
    const { data } = await supabase.from('admission_session').select('*, admission_application(*)').gte('test_date', todayIso).order('test_date', { ascending: true }).limit(5);
    setAdmissions(data || []);
  };

  const fetchLiveFeeds = async () => {
    const { data } = await supabase.from('notification_log').select('*').order('created_at', { ascending: false }).limit(15);
    setLiveFeeds(data || []);
  };

  const fetchInstructorStats = async () => {
    const [{ data: rawInsts }, { data: classes }, { data: students }, { data: enrolls }] = await Promise.all([
      supabase.from('instructor').select('*').eq('status', '재직'),
      supabase.from('class').select('*').neq('status', '종료'),
      supabase.from('student').select('*'),
      supabase.from('enrollment').select('*')
    ]);

    const getRoleRank = (pos: string) => {
      if (!pos) return 99;
      if (pos.includes('원장')) return 1; if (pos.includes('실장')) return 2;
      if (pos.includes('전임')) return 3; if (pos.includes('파트')) return 4; return 99;
    };

    const insts = (rawInsts || []).filter(i => !(i.position?.includes('조교'))).sort((a, b) => {
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

  // 💡 [핵심 수정 부분] 차트 데이터와 반별 데이터를 1:1로 일치시킵니다.
  const fetchClassMonitoring = async () => {
    const [{ data: classes }, { data: students }, { data: enrolls }] = await Promise.all([
      supabase.from('class').select('*, instructor(*), class_schedule(*)').neq('status', '종료'),
      supabase.from('student').select('student_id, status'), // 상태 체크용
      supabase.from('enrollment').select('*')
    ]);

    // 1. 현재 '재원' 상태인 학생들의 ID만 Set으로 만들어 빠르게 필터링할 준비를 합니다.
    const activeStudentIds = new Set(
      (students || []).filter(s => s.status === '재원').map(s => s.student_id)
    );

    // 2. 각 수강반(Class)별로 '재원생'의 수강 기록(Enrollment)을 카운트합니다.
    const cStats = (classes || []).map(c => {
      let sCount = 0;
      (enrolls || []).forEach(e => {
        // 해당 반에 등록되어 있고, 학생 상태가 '재원'인 경우에만 인원수로 산정!
        if (e.class_id === c.class_id && activeStudentIds.has(e.student_id)) {
          sCount++;
        }
      });
      const capacity = 12, vacancy = capacity - sCount, fillRate = Math.min(100, Math.round((sCount / capacity) * 100));
      return { ...c, sCount, capacity, vacancy, fillRate };
    }).sort((a, b) => b.vacancy - a.vacancy);
    
    // 3. 차트용 레벨 데이터 집계 (위에서 계산된 sCount를 그대로 레벨별로 누적합)
    // -> 이렇게 하면 왼쪽 결원 모니터링의 합과 오른쪽 그래프의 합이 완벽하게 100% 일치합니다.
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

  // ==========================================
  // 모달 제어 함수
  // ==========================================
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
    // 현재 모달에 띄운 클래스의 학생들만 필터링 (퇴원생 제외 등 로직 추가 가능)
    setClassStudents(data || []);
  };

  const saveMemo = async () => {
    if (!memoData.content.trim()) return alert("내용을 입력해주세요.");
    try {
      await supabase.from('instructor_memo').insert({ instructor_id: currentUser.instId, author_name: currentUser.name, memo_type: memoData.type, content: memoData.content });
      setIsMemoModalOpen(false);
      setMemoData({ type: "일반공지", content: "" });
      fetchMemos();
    } catch (err) { alert("등록 실패"); }
  };

  const deleteMemo = async (memoId: string) => {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    try {
      await supabase.from('instructor_memo').delete().eq('memo_id', memoId);
      fetchMemos();
    } catch (err) { alert("삭제 실패"); }
  };

  // ==========================================
  // 화면 렌더링
  // ==========================================
  return (
    <div className="flex flex-col h-full bg-slate-50 relative z-0 -mx-8 -mt-4">
      {/* 1. 수퍼 어드민 전용 다크 헤더 */}
      <header className="bg-gradient-to-br from-[#0f172a] to-[#1e1b4b] text-white pt-8 pb-20 px-8 shrink-0 relative z-0">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
        <div className="relative z-10 flex justify-between items-center ml-6">
          <div>
            <h1 className="text-3xl font-black tracking-tight font-lexend flex items-center gap-3">
              <span>Logica Super Admin</span>
              <span className="bg-blue-500/30 text-blue-200 text-xs px-2 py-1 rounded font-bold border border-blue-400/30 font-pretendard shadow-sm">
                최고 관리자 통제실
              </span>
            </h1>
            <p className="text-slate-300 text-sm mt-2 font-medium tracking-tight">{todayString}</p>
          </div>
        </div>
      </header>

      {/* 2. 메인 컨텐츠 영역 */}
      <main className="flex-1 overflow-y-auto custom-scroll px-8 pb-10 -mt-14 relative z-10 bg-transparent">
        
        {/* KPI 5구역 */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 mb-6 px-6">
          <div onClick={() => router.push('/student')} className="bg-white rounded-2xl p-6 border border-slate-200/60 shadow-lg relative overflow-hidden group hover:border-[#002864] transition-colors cursor-pointer h-64 flex flex-col">
            <div className="absolute right-[-10px] top-[-10px] w-24 h-24 bg-blue-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="flex-1">
              <div className="flex justify-between items-start mb-2 relative z-10">
                <span className="text-sm font-bold text-slate-500">전체 재원생 수</span>
                <span className="bg-blue-100 text-[#002864] text-[10px] font-black px-2 py-0.5 rounded border border-blue-200 shadow-sm">LIVE</span>
              </div>
              <div className="flex items-end gap-2 relative z-10 mt-1">
                <span className="text-4xl font-black text-[#002864]">{kpi.totalStu}</span>
                <span className="text-sm font-bold text-slate-400 mb-1">명</span>
              </div>
            </div>
            <div className="pt-4 border-t border-slate-100 flex gap-2 text-[11px] font-bold relative z-10 shrink-0">
              <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded shadow-sm border border-emerald-100 flex-1 text-center">이달 신규 +{kpi.newStu}</span>
              <span className="text-rose-500 bg-rose-50 px-2 py-1 rounded shadow-sm border border-rose-100 flex-1 text-center">퇴원 -{kpi.leftStu}</span>
            </div>
          </div>

          <div onClick={() => router.push('/billing')} className="bg-white rounded-2xl p-6 border border-blue-200 shadow-lg relative overflow-hidden group cursor-pointer h-64 flex flex-col">
             <div className="absolute right-[-10px] top-[-10px] w-24 h-24 bg-sky-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
             <div className="flex-1">
               <div className="flex justify-between items-start mb-2 relative z-10">
                 <span className="text-sm font-bold text-slate-500">{new Date().getMonth() + 1}월 수납률</span>
               </div>
               <div className="flex items-end gap-1.5 relative z-10 mt-1 mb-3">
                 <span className="text-4xl font-black tracking-tighter text-[#002864]">{kpi.payRate}</span>
                 <span className="text-xl font-bold text-slate-400 mb-1">%</span>
               </div>
               <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden relative z-10">
                 <div className={`h-full rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(56,189,248,0.5)] ${kpi.payRate < 60 ? 'bg-rose-500' : 'bg-sky-400'}`} style={{ width: `${kpi.payRate}%` }}></div>
               </div>
             </div>
             <div className="flex justify-between text-[11px] font-bold text-slate-500 relative z-10 pt-4 border-t border-slate-100 shrink-0">
               <span>수납: <span className="text-slate-800 text-xs">{kpi.paidAmt.toLocaleString()}</span></span>
               <span className="text-rose-400">미납: <span className="text-rose-500 text-xs">{kpi.unpaidAmt.toLocaleString()}</span></span>
             </div>
           </div>

          <div onClick={() => router.push('/admission')} className="bg-white rounded-2xl p-6 border border-slate-200/60 shadow-lg relative overflow-hidden group hover:border-amber-400 transition-colors cursor-pointer h-64 flex flex-col">
            <div className="absolute right-[-10px] top-[-10px] w-24 h-24 bg-amber-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="flex-1">
              <div className="flex justify-between items-start mb-2 relative z-10">
                <span className="text-sm font-bold text-slate-500">입학테스트 대기생</span>
                <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded border border-amber-200 shadow-sm">잠재 고객</span>
              </div>
              <div className="flex items-end gap-2 relative z-10 mt-1">
                <span className="text-4xl font-black text-amber-500">{kpi.waitingStu}</span>
                <span className="text-sm font-bold text-slate-400 mb-1">명</span>
              </div>
            </div>
            <div className="pt-4 border-t border-slate-100 flex justify-between items-center text-[11px] font-bold relative z-10 shrink-0">
              <span className="text-slate-500">이번 달 입학 승인</span>
              <span className="text-slate-800"><span className="font-black text-amber-600 text-sm">{kpi.passedStu}</span> 명</span>
            </div>
          </div>

          <div onClick={() => router.push('/cs')} className="bg-white rounded-2xl p-5 border border-rose-100 shadow-lg relative overflow-hidden hover:border-rose-400 transition-colors cursor-pointer h-64 flex flex-col">
            <div className="absolute left-0 top-0 w-1.5 h-full bg-rose-500"></div>
            <div className="flex justify-between items-center mb-3 pl-1 shrink-0 relative z-10">
              <span className="text-sm font-extrabold text-slate-700 flex items-center gap-1">🚨 학부모 요청</span>
              <span className="bg-rose-100 text-rose-600 text-[10px] font-bold px-1.5 py-0.5 rounded border border-rose-200 shadow-sm">{kpi.csCount}건</span>
            </div>
            <div className="flex-1 flex flex-col gap-2 overflow-y-auto custom-scroll pr-1 relative z-10 min-h-0">
              {csRequests.length === 0 ? <div className="text-center py-6 text-slate-400 font-bold text-xs mt-4">미처리 요청이 없습니다. 🎉</div> : 
                csRequests.map(r => (
                  <div key={r.request_id} className="shrink-0 text-[11px] font-bold text-slate-600 bg-rose-50 p-2 rounded border border-rose-100 truncate shadow-sm">
                    <span className="text-rose-600 mr-1">{r.student?.name || '알수없음'}:</span>{r.reason}
                  </div>
                ))
              }
            </div>
          </div>

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

        {/* Section 2: 강사별 성과 지표 */}
        <div className="mb-6">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-white rounded-t-2xl border shadow-sm relative z-10">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">👨‍🏫 강사별 운영 및 원생 관리 성과</h3>
            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 border border-slate-200 px-2 py-1 rounded shadow-sm">실시간 자동 분류</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6 bg-transparent border border-t-0 border-slate-200 rounded-b-2xl shadow-sm">
            {instructorsStats.length === 0 ? <div className="col-span-full text-center py-10 text-slate-400 font-bold text-sm">강사 데이터를 불러오는 중입니다...</div> : 
              instructorsStats.map(inst => (
                <div key={inst.instructor_id} onClick={() => router.push(`/instructor/${inst.instructor_id}`)} className="border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-lg transition-shadow bg-white hover:border-[#002864] flex flex-col justify-between cursor-pointer">
                  <div className="flex gap-4">
                    <div className="w-20 h-24 bg-gradient-to-br from-[#002864] to-blue-500 rounded-xl shadow-inner overflow-hidden flex-shrink-0 border border-slate-200">
                      {inst.profile_image_url ? (
                        <img 
                          src={inst.profile_image_url.startsWith('http') ? inst.profile_image_url : `https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/${inst.profile_image_url}`} 
                          className="w-full h-full object-cover" 
                          alt="profile"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-3xl font-black text-blue-200">
                          {inst.name?.charAt(0) || 'T'}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 flex flex-col min-w-0">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-extrabold text-[16px] text-slate-800">{inst.name} 선생님</div>
                        <div className="text-right leading-none">
                          <span className="text-xl font-black text-[#002864]">{inst.studentCount}</span><span className="text-[10px] font-bold text-slate-400 ml-0.5">명</span>
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-slate-500 mb-1 flex items-center gap-1"><span>📚</span> 담당 수강반 ({inst.myClasses.length})</div>
                      <div className="flex flex-wrap gap-1 content-start flex-1 overflow-y-auto max-h-[50px] custom-scroll pr-1">
                        {inst.myClasses.length === 0 ? <span className="text-[10px] text-slate-400 mt-0.5 font-bold">배정된 반 없음</span> : 
                          inst.myClasses.map((c: any) => <span key={c.class_id} className="text-[10px] font-bold bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600 shadow-sm whitespace-nowrap">{c.name}</span>)
                        }
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-3 mt-3 text-[11px] font-bold">
                    <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 shadow-sm flex items-center gap-1">이달 입학 <span className="text-xs">+{inst.newCnt}</span></span>
                    <span className="text-rose-500 bg-rose-50 px-2 py-1 rounded border border-rose-100 shadow-sm flex items-center gap-1">퇴/휴원 <span className="text-xs">-{inst.leftCnt}</span></span>
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* Section 3: 수강반 결원 모니터링 & 레벨 분포 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2 bg-transparent rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-[380px]">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-white shrink-0 rounded-t-2xl">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">🏫 수강반 결원 모니터링 <span className="text-xs font-normal text-slate-400">(목표 정원 12명 기준)</span></h3>
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
              {/* 💡 [변경됨] 그래프 제목을 명확히 하여 혼동을 줄입니다. */}
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

        {/* Section 4: 다가오는 입학 & 알림 피드 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[400px]">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-amber-50/30 flex justify-between items-center shrink-0">
              <h2 className="font-extrabold text-slate-800 text-sm flex items-center gap-2"><span className="text-amber-500">📝</span> 다가오는 입학테스트 예약</h2>
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-3 bg-white">
              {admissions.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold text-xs">예정된 입학테스트 일정이 없습니다.</div> :
                admissions.map(a => (
                  <div key={a.admission_session_id} onClick={() => router.push('/admission')} className="bg-white border border-slate-200 rounded-lg p-3.5 hover:shadow-md transition-shadow cursor-pointer hover:border-amber-300 flex justify-between items-center group">
                    <div className="min-w-0 flex-1">
                      <h4 className="text-[13px] font-black text-slate-800 mb-1 group-hover:text-amber-600 transition-colors truncate">{a.title}</h4>
                      <div className="text-[11px] font-bold text-slate-500">🗓️ {a.test_date} {a.start_time?.substring(0,5)}</div>
                    </div>
                    <div className="shrink-0 ml-3">
                      <span className="bg-amber-50 text-amber-600 text-[11px] font-black px-2.5 py-1 rounded-lg border border-amber-100 shadow-sm">{a.admission_application?.length || 0}명 대기</span>
                    </div>
                  </div>
                ))
              }
            </div>
            <div className="p-3 border-t border-slate-100 bg-slate-50 shrink-0 text-center">
              <button onClick={() => router.push('/admission')} className="text-xs font-bold text-slate-500 hover:text-[#002864] transition-colors">입학 테스트 대시보드로 이동 →</button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-blue-50/30 flex justify-between items-center shrink-0">
              <h2 className="font-extrabold text-slate-800 text-sm flex items-center gap-2"><span className="text-blue-500">📡</span> 최근 알림톡 발송 피드</h2>
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-3 bg-white">
              {liveFeeds.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold text-xs">발송 내역이 없습니다.</div> :
                liveFeeds.map((log) => {
                  let typeColor = 'text-blue-500 bg-blue-50 border-blue-100';
                  if (log.noti_type?.includes('BILLING') || log.noti_type?.includes('UNPAID')) typeColor = 'text-rose-500 bg-rose-50 border-rose-100';

                  const tDate = log.sent_at ? new Date(log.sent_at) : new Date(log.created_at);
                  const timeStr = `${tDate.getMonth()+1}/${tDate.getDate()} ${String(tDate.getHours()).padStart(2,'0')}:${String(tDate.getMinutes()).padStart(2,'0')}`;
                  
                  return (
                    <div key={log.noti_log_id} className="p-2.5 bg-white border border-slate-200 rounded-lg flex items-center justify-between gap-3 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm">
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-[9px] font-bold text-slate-400 shrink-0 w-12 text-right">{timeStr}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${typeColor} shrink-0`}>{log.noti_type || '안내'}</span>
                        <p className="text-[11px] font-bold text-slate-600 truncate flex-1" title={log.message_content}>{log.message_content}</p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <span className="text-[9px] font-black text-slate-300">**{(log.receiver_phone || log.receiver_contact || '0000').slice(-4)}</span>
                        <NotiStatusBadge status={log.status} />
                      </div>
                    </div>
                  );
                })
              }
            </div>
            <div className="p-3 border-t border-slate-100 bg-slate-50 shrink-0 text-center">
              <span className="text-[10px] font-bold text-slate-400">발송 내역은 실시간으로 자동 갱신됩니다.</span>
            </div>
          </div>
        </div>

      </main>

      {/* 5. 공지 작성 팝업 모달 */}
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
              <button onClick={saveMemo} className="px-4 py-2 bg-[#002864] text-white text-xs font-bold rounded-lg hover:bg-blue-900 transition-colors shadow-sm">공지 등록</button>
            </div>
          </div>
        </div>
      )}

      {/* 6. 수강반 상세 정보 팝업 모달 */}
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

              {/* 학생 리스트 */}
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