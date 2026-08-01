// src/hooks/useAdminDashboard.ts
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function useAdminDashboard() {
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "관리자" });
  const [todayString, setTodayString] = useState("데이터를 불러오는 중입니다...");
  const [dateFilters, setDateFilters] = useState({ thisMonthStr: "", firstDayOfMonth: "", todayIso: "" });

  const [kpi, setKpi] = useState({
    totalStu: 0, newStu: 0, leftStu: 0,
    payRate: 0, paidAmt: 0, unpaidAmt: 0,
    waitingStu: 0, passedStu: 0, csCount: 0
  });

  const [dashboardData, setDashboardData] = useState({
    csRequests: [] as any[],
    memos: [] as any[],
    instructorsStats: [] as any[],
    classStats: [] as any[],
    levelCounts: null as any,
    admissions: [] as any[],
    liveFeeds: [] as any[],
  });

  useEffect(() => {
    // [보안 경고] 추후 반드시 supabase.auth.getSession() 기반으로 변경해야 합니다.
    const instId = localStorage.getItem('logica_instructor_id') || "1";
    const name = localStorage.getItem('logica_instructor_name') || "관리자";
    setCurrentUser({ instId, name });

    const today = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    setTodayString(`${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 (${days[today.getDay()]}) 실시간 요약 지표`);
    
    setDateFilters({
      thisMonthStr: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
      firstDayOfMonth: new Date(today.getFullYear(), today.getMonth(), 1).toISOString(),
      todayIso: today.toISOString().split('T')[0]
    });
  }, []);

  useEffect(() => {
    if (dateFilters.thisMonthStr) {
      loadDashboardData();
    }
  }, [dateFilters]);

  const loadDashboardData = async () => {
    const { thisMonthStr, firstDayOfMonth, todayIso } = dateFilters;

    // [최적화 노트] 추후 이 부분은 Supabase의 View나 RPC(Postgres 함수)를 호출하는 방식으로 변경을 권장합니다.
    const [
      { data: students }, { data: billing }, { data: apps }, 
      { data: csLog }, { data: memos }, { data: admissions }, 
      { data: feeds }, { data: classes }, { data: enrolls }, { data: rawInsts }
    ] = await Promise.all([
      supabase.from('student').select('student_id, name, status, created_at, updated_at, class_id'),
      supabase.from('academy_billing').select('amount, status').eq('billing_month', thisMonthStr),
      supabase.from('admission_application').select('test_result, status, application_status').gte('created_at', firstDayOfMonth),
      supabase.from('parent_request_log').select('*, student(name)').eq('status', '대기').order('created_at', { ascending: false }).limit(15),
      supabase.from('instructor_memo').select('*').neq('status', '완료').order('created_at', { ascending: false }).limit(20),
      supabase.from('admission_session').select('*, admission_application(*)').gte('test_date', todayIso).order('test_date', { ascending: true }).limit(5),
      supabase.from('notification_log').select('*').order('created_at', { ascending: false }).limit(15),
      supabase.from('class').select('*, instructor(*), class_schedule(*)').neq('status', '종료'),
      supabase.from('enrollment').select('*'),
      supabase.from('instructor').select('*').eq('status', '재직')
    ]);

    // 1. KPI - 학생
    let enrolled = 0, newM = 0, leftM = 0;
    students?.forEach(s => {
      if (s.status === '재원') {
        enrolled++;
        if (s.created_at >= firstDayOfMonth) newM++;
      } else if (s.status === '퇴원' || s.status === '휴원') {
        if (s.updated_at >= firstDayOfMonth) leftM++;
      }
    });

    // 2. KPI - 수납
    let paidAmt = 0, unpaidAmt = 0;
    billing?.forEach(b => {
      const amt = parseInt(b.amount) || 0;
      if (b.status === '완납') paidAmt += amt; else unpaidAmt += amt;
    });
    const totalAmt = paidAmt + unpaidAmt;
    const payRate = totalAmt > 0 ? Math.round((paidAmt / totalAmt) * 100) : 0;

    // 3. KPI - 입학
    const passedCount = apps?.filter(a => ['합격'].includes(a.test_result || a.status || a.application_status)).length || 0;
    const waitingStu = students?.filter(s => s.status === '입학테스트').length || 0;

    setKpi({ totalStu: enrolled, newStu: newM, leftStu: leftM, payRate, paidAmt, unpaidAmt, passedStu: passedCount, waitingStu, csCount: csLog?.length || 0 });

    // 4. 강사 통계
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

    const instructorsStats = insts.map(inst => {
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

    // 5. 수강반 결원 모니터링 및 레벨별 통계 (중복 카운트 문제 해결)
    let lvCounts: any = { 'Ultimate': 0, 'Master': 0, 'Apex': 0, 'Titan': 0, 'Horizon': 0, '기타': 0 };
    
    // [수정됨] 레벨은 '고유 학생'을 기준으로 세팅합니다.
    const activeStudents = students?.filter(s => s.status === '재원') || [];
    activeStudents.forEach(stu => {
      // 학생의 주 클래스(class_id)를 기준으로 레벨을 찾음
      const mainClass = classes?.find(c => c.class_id === stu.class_id);
      const lv = mainClass?.level_name || '기타';
      if (lvCounts[lv] !== undefined) lvCounts[lv]++;
      else lvCounts['기타']++;
    });

    const classStats = (classes || []).map(c => {
      let sCount = 0;
      (students || []).forEach(s => {
        if (s.class_id === c.class_id || (enrolls?.some(e => e.student_id === s.student_id && e.class_id === c.class_id))) sCount++;
      });
      const capacity = 12, vacancy = capacity - sCount, fillRate = Math.min(100, Math.round((sCount / capacity) * 100));
      return { ...c, sCount, capacity, vacancy, fillRate };
    }).sort((a, b) => b.vacancy - a.vacancy);

    setDashboardData({
      csRequests: csLog || [],
      memos: memos || [],
      admissions: admissions || [],
      liveFeeds: feeds || [],
      instructorsStats,
      classStats,
      levelCounts: lvCounts // ✅ 계산된 lvCounts 변수를 매핑
    })
  };

  const deleteMemo = async (memoId: string) => {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    try {
      await supabase.from('instructor_memo').delete().eq('memo_id', memoId);
      loadDashboardData();
    } catch (err) { alert("삭제 실패"); }
  };

  return { currentUser, todayString, kpi, dashboardData, loadDashboardData, deleteMemo };
}