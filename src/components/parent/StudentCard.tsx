// src/components/parent/StudentCard.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

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

// 💡 오늘의 KST 날짜 구하기 헬퍼 함수
const getKSTDateStr = (offsetDays = 0) => {
  const kstAdjusted = new Date(Date.now() + (9 * 3600000) - (6 * 3600000) + (offsetDays * 86400000));
  return kstAdjusted.toISOString().split('T')[0];
};

// 💡 상담 유형별 테마 컬러
const getConsultBadgeColor = (type: string) => {
  switch(type) {
    case '퇴원상담': return 'bg-rose-50 text-rose-600 border-rose-200';
    case '신규상담': return 'bg-emerald-50 text-emerald-600 border-emerald-200';
    case '성적상담': return 'bg-violet-50 text-violet-600 border-violet-200';
    case '태도상담': return 'bg-amber-50 text-amber-600 border-amber-200';
    case '입학상담': return 'bg-amber-50 text-amber-700 border-amber-200';
    default: return 'bg-indigo-50 text-indigo-600 border-indigo-100';
  }
};

// 🌟 방사 차트용 스마트 텍스트 줄바꿈 함수 (12글자 기준)
const splitLabel = (label: string) => {
  if (!label) return [];
  if (label.length <= 12) return [label];

  const words = label.split(' ');
  if (words.length === 1) {
    const mid = Math.ceil(label.length / 2);
    return [label.substring(0, mid), label.substring(mid)];
  }
  
  let midIdx = 0;
  let minDiff = Infinity;
  let currentLen = 0;
  
  for (let i = 0; i < words.length - 1; i++) {
    currentLen += words[i].length + (i > 0 ? 1 : 0);
    const diff = Math.abs(currentLen - (label.length / 2));
    if (diff < minDiff) {
      minDiff = diff;
      midIdx = i;
    }
  }
  
  return [
    words.slice(0, midIdx + 1).join(' '),
    words.slice(midIdx + 1).join(' ')
  ];
};

// 🌟 방사 차트 컴포넌트
const RadarChart = ({ data }: { data: any[] }) => {
  if (!data || data.length < 3) {
    return <div className="text-center text-slate-400 text-[11px] font-bold py-10">데이터가 부족합니다.<br/>(최소 3개 이상의 단원 데이터 필요)</div>;
  }

  const size = 320; 
  const center = size / 2;
  const radius = size * 0.35; 
  const levels = 5;

  const pointsFin = data.map((d, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / data.length;
    const value = Math.max(0.01, d.final_rate / 100); 
    return { x: center + radius * value * Math.cos(angle), y: center + radius * value * Math.sin(angle) };
  });

  const pointsInit = data.map((d, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / data.length;
    const value = Math.max(0.01, d.initial_rate / 100); 
    return { x: center + radius * value * Math.cos(angle), y: center + radius * value * Math.sin(angle) };
  });

  const labelPoints = data.map((d, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / data.length;
    return {
      labelX: center + (radius + 32) * Math.cos(angle),
      labelY: center + (radius + 32) * Math.sin(angle),
      label: d.name
    };
  });

  const bgPolygons = Array.from({length: levels}).map((_, levelIndex) => {
    const r = radius * ((levelIndex + 1) / levels);
    const pts = data.map((_, i) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * i) / data.length;
      return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
    }).join(' ');
    return <polygon key={levelIndex} points={pts} fill="none" stroke="#e2e8f0" strokeWidth="1" />;
  });

  const axes = data.map((_, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / data.length;
    return <line key={i} x1={center} y1={center} x2={center + radius * Math.cos(angle)} y2={center + radius * Math.sin(angle)} stroke="#e2e8f0" strokeWidth="1" />;
  });

  const polyFinStr = pointsFin.map(p => `${p.x},${p.y}`).join(' ');
  const polyInitStr = pointsInit.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg width="100%" height={size} viewBox={`0 0 ${size} ${size}`}>
      {bgPolygons}
      {axes}
      
      <polygon points={polyFinStr} fill="rgba(147, 197, 253, 0.4)" stroke="#93c5fd" strokeWidth="2" strokeLinejoin="round" />
      {pointsFin.map((p, i) => <circle key={`fin-dot-${i}`} cx={p.x} cy={p.y} r="3" fill="#3b82f6" />)}

      <polygon points={polyInitStr} fill="rgba(0, 40, 100, 0.5)" stroke="#002864" strokeWidth="2" strokeLinejoin="round" />
      {pointsInit.map((p, i) => <circle key={`init-dot-${i}`} cx={p.x} cy={p.y} r="3" fill="#002864" />)}

      {labelPoints.map((p, i) => {
        const lines = splitLabel(p.label);
        return (
          <text key={`text-${i}`} fontSize="10" fill="#475569" textAnchor="middle" fontWeight="bold">
            {lines.length === 1 ? (
              <tspan x={p.labelX} y={p.labelY} dominantBaseline="central">{lines[0]}</tspan>
            ) : (
              <>
                <tspan x={p.labelX} y={p.labelY - 6} dominantBaseline="central">{lines[0]}</tspan>
                <tspan x={p.labelX} y={p.labelY + 6} dominantBaseline="central">{lines[1]}</tspan>
              </>
            )}
          </text>
        );
      })}
    </svg>
  );
};

export default function StudentCard({ student }: { student: any }) {
  const [activeTab, setActiveTab] = useState<"attendance" | "progress" | "homework" | "makeup" | "exam" | "consultation">("attendance");

  // 캘린더용 상태
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // 데이터 로딩 상태
  const [lessonLogs, setLessonLogs] = useState<any[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  
  // 성적 데이터 상태
  const [examResults, setExamResults] = useState<any[]>([]);
  const [categoryAnalysis, setCategoryAnalysis] = useState<any[]>([]);
  const [schoolExams, setSchoolExams] = useState<any[]>([]);
  const [isExamLoading, setIsExamLoading] = useState(false);

  // 🌟 [추가] 보강 관리 상태
  const [makeups, setMakeups] = useState<any[]>([]);
  const [isMakeupLoading, setIsMakeupLoading] = useState(false);

  // 토스트 팝업 상태 관리
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const activeEnrollment = student.enrollment?.find((e: any) => (!e.end_date || new Date(e.end_date) >= new Date()) && unwrap(e.class)?.name);
  const currentClass = activeEnrollment ? unwrap(activeEnrollment.class) : null;
  const className = currentClass?.name || "소속 반 없음";
  const classId = currentClass?.class_id;

  const consultLogs = student.consultation_log ? [...student.consultation_log].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) : [];

  // 과제 데이터 로드
  useEffect(() => {
    if (activeTab === "homework" && classId) {
      const fetchLogs = async () => {
        setIsLogsLoading(true);
        try {
          const { data } = await supabase
            .from("daily_lesson_log")
            .select("lesson_log_id, actual_date, actual_session_no, homework_desc")
            .eq("class_id", classId)
            .not("homework_desc", "is", null)
            .order("actual_date", { ascending: false });
          
          setLessonLogs(data || []);
        } catch (error) {
          console.error("과제 정보 로딩 에러:", error);
        } finally {
          setIsLogsLoading(false);
        }
      };
      fetchLogs();
    }
  }, [activeTab, classId]);

  // 성적 데이터 로드
  useEffect(() => {
    if (activeTab === "exam" && student?.student_id) {
      const loadAllExamData = async () => {
        setIsExamLoading(true);
        await Promise.all([
          loadExamResults(),
          loadCategoryAnalysis(),
          loadSchoolExams()
        ]);
        setIsExamLoading(false);
      };
      loadAllExamData();
    }
  }, [activeTab, student]);

  // 🌟 [추가] 보강 일정 데이터 로드
  useEffect(() => {
    if (activeTab === "makeup" && student?.student_id) {
      const fetchMakeups = async () => {
        setIsMakeupLoading(true);
        try {
          const { data } = await supabase
            .from('individual_makeup')
            .select('*, instructor(name)')
            .eq('student_id', student.student_id)
            .order('schedule_date', { ascending: false });
          setMakeups(data || []);
        } catch (err) {
          console.error("보강 내역 로드 에러:", err);
        } finally {
          setIsMakeupLoading(false);
        }
      };
      fetchMakeups();
    }
  }, [activeTab, student?.student_id]);

  const loadExamResults = async () => {
    try {
      const { data: assignments } = await supabase.from("exam_assignment")
        .select("assignment_id, exam_id, total_score, status, created_at, exam_master(title, total_questions, exam_type)")
        .eq("student_id", student.student_id)
        .order("created_at", { ascending: false });

      const validAssignments = (assignments || []).filter((a: any) => {
        if (['응시전', '미응시', '예정', '대기'].includes(a.status)) return false;
        const master = Array.isArray(a.exam_master) ? a.exam_master[0] : a.exam_master;
        if (master?.exam_type !== '주간테스트') return false;
        return true;
      }).slice(0, 10); 

      if (validAssignments.length === 0) {
        setExamResults([]); return;
      }

      const examIds = Array.from(new Set(validAssignments.map((a: any) => a.exam_id)));
      const { data: allAssignmentsForExams } = await supabase.from("exam_assignment")
        .select("assignment_id, exam_id")
        .in("exam_id", examIds)
        .not("status", "in", '("응시전","미응시","예정","대기")');

      const allAssignIds = (allAssignmentsForExams || []).map(a => a.assignment_id);
      let allAnswers: any[] = [];
      for (let i = 0; i < allAssignIds.length; i += 200) {
        const chunk = allAssignIds.slice(i, i + 200);
        const { data: chunkAnswers } = await supabase.from("student_answer")
          .select("exam_assignment_id, grading_code")
          .in("exam_assignment_id", chunk);
        if (chunkAnswers) allAnswers = [...allAnswers, ...chunkAnswers];
      }

      const examTotalQMap = new Map();
      validAssignments.forEach((a: any) => {
        const master = Array.isArray(a.exam_master) ? a.exam_master[0] : a.exam_master;
        examTotalQMap.set(a.exam_id, master?.total_questions || 1);
      });

      const assignCounts: Record<string, { o: number, ro: number, to: number, totalAns: number, x: number }> = {};
      allAnswers.forEach(ans => {
         if(!assignCounts[ans.exam_assignment_id]) assignCounts[ans.exam_assignment_id] = { o:0, ro:0, to:0, totalAns:0, x:0 };
         const c = assignCounts[ans.exam_assignment_id];
         c.totalAns++;
         if (ans.grading_code === 'O') c.o++;
         else if (ans.grading_code === 'RO') c.ro++;
         else if (ans.grading_code === 'TO') c.to++;
         else if (['X', 'TX'].includes(ans.grading_code)) c.x++;
      });

      const examScoreMap = new Map();
      (allAssignmentsForExams || []).forEach(a => {
         const counts = assignCounts[a.assignment_id] || { o:0, ro:0, to:0, totalAns:0, x:0 };
         let totalQ = examTotalQMap.get(a.exam_id) || counts.totalAns || 1;
         if (totalQ === 0) totalQ = 1;

         const initScore = (counts.o / totalQ) * 100;
         const finScore = ((counts.o + counts.ro + counts.to) / totalQ) * 100;

         if(!examScoreMap.has(a.exam_id)) examScoreMap.set(a.exam_id, { initSum: 0, finSum: 0, count: 0 });
         const avgData = examScoreMap.get(a.exam_id);
         avgData.initSum += initScore;
         avgData.finSum += finScore;
         avgData.count += 1;
      });

      const results = validAssignments.map((a: any) => {
        const counts = assignCounts[a.assignment_id] || { o:0, ro:0, to:0, totalAns:0, x:0 };
        let totalQ = examTotalQMap.get(a.exam_id) || counts.totalAns || 1;
        
        const originalScore = Math.round((counts.o / totalQ) * 100);
        const finalScore = Math.round(((counts.o + counts.ro + counts.to) / totalQ) * 100);
        
        const avgData = examScoreMap.get(a.exam_id);
        const classInitAvg = avgData && avgData.count > 0 ? Math.round(avgData.initSum / avgData.count) : 0;
        const classFinAvg = avgData && avgData.count > 0 ? Math.round(avgData.finSum / avgData.count) : 0;

        return {
          assignment_id: a.assignment_id,
          title: Array.isArray(a.exam_master) ? a.exam_master[0]?.title : a.exam_master?.title || '주간테스트',
          original_score: originalScore,
          final_score: finalScore,
          oCount: counts.o,
          roCount: counts.ro,
          toCount: counts.to,
          xCount: counts.x,
          class_init_avg: classInitAvg,
          class_fin_avg: classFinAvg,
          created_at: a.created_at
        };
      });
      setExamResults(results); 
    } catch (err) { console.error("시험 결과 로드 실패:", err); }
  };

  const loadCategoryAnalysis = async () => {
    try {
      const { data: assignments } = await supabase.from("exam_assignment")
        .select("assignment_id, status, exam_master(exam_type)")
        .eq("student_id", student.student_id)
        .order("created_at", { ascending: false });

      const validAssignments = (assignments || []).filter((a: any) => {
        if (['응시전', '미응시', '예정', '대기'].includes(a.status)) return false;
        const master = Array.isArray(a.exam_master) ? a.exam_master[0] : a.exam_master;
        if (master?.exam_type !== '주간테스트') return false;
        return true;
      }).slice(0, 10);

      if (validAssignments.length === 0) { setCategoryAnalysis([]); return; }
      const targetAssignIds = validAssignments.map(a => a.assignment_id);

      const { data: answers } = await supabase.from('student_answer').select('question_id, is_correct, grading_code').in('exam_assignment_id', targetAssignIds);
      if (!answers || answers.length === 0) { setCategoryAnalysis([]); return; }

      const qIds = Array.from(new Set(answers.map(a => a.question_id)));
      let questions: any[] = [];
      for (let i = 0; i < qIds.length; i += 200) {
        const chunk = qIds.slice(i, i + 200);
        const { data: qData } = await supabase.from('question_db').select('question_id, taxonomy_id').in('question_id', chunk);
        if (qData) questions = [...questions, ...qData];
      }

      const d4Codes = new Set<string>();
      const qIdToD4 = new Map<string, string>();

      questions.forEach(q => {
        if (!q.taxonomy_id) return;
        const parts = q.taxonomy_id.split('-');
        const d4Code = parts.length >= 2 ? parts.slice(0, 2).join('-') : q.taxonomy_id;
        d4Codes.add(d4Code);
        qIdToD4.set(q.question_id, d4Code);
      });

      const uniqueD4Array = Array.from(d4Codes).filter(Boolean);
      if (uniqueD4Array.length === 0) { setCategoryAnalysis([]); return; }

      const catMap = new Map<string, string>();
      await Promise.all(uniqueD4Array.map(async (code) => {
        try {
          const { data } = await supabase.from('master_category').select('category_id, depth4').eq('category_id', code).limit(1);
          if (data && data.length > 0 && data[0].depth4) { catMap.set(code, data[0].depth4); return; }
          const { data: likeData } = await supabase.from('master_category').select('category_id, depth4').like('category_id', `${code}-%`).limit(1);
          if (likeData && likeData.length > 0 && likeData[0].depth4) { catMap.set(code, likeData[0].depth4); }
        } catch (e) {}
      }));

      const aggMap = new Map();
      answers.forEach(a => {
        const d4Code = qIdToD4.get(a.question_id);
        if (!d4Code) return;
        let depth4Name = catMap.get(d4Code);
        if (!depth4Name || depth4Name.trim() === '') depth4Name = d4Code;

        if (!aggMap.has(d4Code)) {
          aggMap.set(d4Code, { code: d4Code, name: depth4Name, total: 0, initCorrect: 0, finCorrect: 0 });
        }
        const obj = aggMap.get(d4Code);
        obj.total += 1;
        
        if (a.grading_code === 'O') { obj.initCorrect += 1; obj.finCorrect += 1; } 
        else if (a.grading_code === 'RO' || a.grading_code === 'TO') { obj.finCorrect += 1; } 
        else if (!a.grading_code && a.is_correct) { obj.initCorrect += 1; obj.finCorrect += 1; }
      });

      const finalData = Array.from(aggMap.values())
        .map(d => ({
          ...d,
          initial_rate: d.total > 0 ? Math.round((d.initCorrect / d.total) * 100) : 0,
          final_rate: d.total > 0 ? Math.round((d.finCorrect / d.total) * 100) : 0
        }))
        .sort((a, b) => a.code.localeCompare(b.code));

      setCategoryAnalysis(finalData);
    } catch (err) {}
  };

  const loadSchoolExams = async () => {
    const { data } = await supabase.from("student_school_exam").select("*").eq("student_id", student.student_id).order("year", { ascending: false }).order("semester", { ascending: false }).order("exam_type", { ascending: true });
    setSchoolExams(data || []);
  };

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const handlePrevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const attendanceMap = new Map();
  if (student.attendance) {
    student.attendance.forEach((record: any) => {
      if (record.attendance_date) {
        attendanceMap.set(record.attendance_date, record);
      }
    });
  }

  const selectedDateStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
  const selectedAtt = attendanceMap.get(selectedDateStr);

  const formatTime = (isoString: string) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    return date.toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" });
  };

  const formatDateLabel = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const todayStatus = useMemo(() => {
    const todayStr = getKSTDateStr();
    const todayAtt = attendanceMap.get(todayStr);

    let text = "오늘 아직 등원 전입니다.";
    let color = "bg-slate-50 text-slate-500 border-slate-200";
    let icon = "⏳";

    if (todayAtt) {
      const inTime = formatTime(todayAtt.check_in_time);
      const outTime = formatTime(todayAtt.check_out_time);

      if (todayAtt.status === '결석') {
        text = "오늘 결석 처리되었습니다.";
        color = "bg-rose-50 text-rose-600 border-rose-200";
        icon = "❌";
      } else if (todayAtt.status === '조퇴') {
        text = `오늘 ${outTime || '조기'} 조퇴 하원했습니다.`;
        color = "bg-orange-50 text-orange-600 border-orange-200";
        icon = "🏃";
      } else if (todayAtt.check_out_time || todayAtt.status === '하원') {
        text = `오늘 ${outTime} 하원 완료했습니다.`;
        color = "bg-emerald-50 text-emerald-600 border-emerald-200";
        icon = "👋";
      } else if (todayAtt.status === '지각') {
        text = `오늘 ${inTime} 지각 등원 (원내 체류중)`;
        color = "bg-amber-50 text-amber-600 border-amber-200";
        icon = "🏫";
      } else {
        text = `오늘 ${inTime} 등원 완료 (원내 체류중)`;
        color = "bg-blue-50 text-blue-600 border-blue-200";
        icon = "🏫";
      }
    }
    return { text, color, icon };
  }, [attendanceMap]);

  const renderPageBlocks = (bookPages: number[], pageStatuses: Record<number, 'done' | 'homework' | 'none'>) => {
    if (!bookPages || bookPages.length === 0) {
      return <span className="text-xs font-bold text-slate-400">교재 데이터가 없습니다.</span>;
    }
    return (
      <div className="flex flex-wrap gap-1 items-center">
        {bookPages.map((p) => {
          const status = pageStatuses[p] || "none";
          let bgColor = "bg-slate-200";
          let title = `${p}p (미진행)`;
          if (status === "done") { bgColor = "bg-emerald-500"; title = `${p}p (완료)`; } 
          else if (status === "homework") { bgColor = "bg-amber-400"; title = `${p}p (과제 진행중)`; }

          return (
            <button 
              key={p} 
              onClick={() => showToast(title)}
              className={`w-2 h-2.5 rounded-[1px] ${bgColor} shadow-sm transition-colors hover:scale-150 active:scale-150 transform`} 
            />
          );
        })}
      </div>
    );
  };

  const renderGrowthChart = () => {
    if (examResults.length === 0) return <div className="text-center py-20 text-slate-400 font-bold text-sm bg-slate-50 rounded-xl">최근 시험 데이터가 없습니다.</div>;
    
    const chartData = [...examResults.slice(0, 10)].reverse();
    const height = 260;
    const paddingX = 40;
    const paddingY = 40;
    const maxScore = 100;
    const xStep = 85; 
    const dynamicWidth = Math.max(300, paddingX * 2 + (chartData.length - 1) * xStep + 40);
    const getY = (score: number) => height - paddingY - (score / maxScore) * (height - paddingY * 2);

    const pointsInitAvg = chartData.map((r: any, i: number) => `${paddingX + (i * xStep) + 20},${getY(r.class_init_avg)}`).join(' ');
    const pointsFinAvg = chartData.map((r: any, i: number) => `${paddingX + (i * xStep) + 20},${getY(r.class_fin_avg)}`).join(' ');

    return (
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col w-full">
        <div className="flex flex-col gap-4 mb-4">
          <div>
             <h3 className="text-[14px] font-black text-[#002864] mb-1">📈 최근 주간테스트 성장 그래프</h3>
             <p className="text-[11px] font-bold text-slate-400 leading-relaxed whitespace-pre-wrap">
               최초 정답(O)과 오답 정정(RO, TO) 후의 최종 점수 및{"\n"}같은 시험지의 반 평균 변화입니다.
             </p>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
             <div className="flex items-center gap-1.5"><div className="w-5 flex justify-center"><div className="w-3 h-3 bg-[#002864] rounded-sm"></div></div><span className="text-[10px] sm:text-[11px] font-bold text-slate-600">최초(내 점수)</span></div>
             <div className="flex items-center gap-1.5"><div className="w-5 flex justify-center"><div className="w-3 h-3 bg-[#93c5fd] rounded-sm"></div></div><span className="text-[10px] sm:text-[11px] font-bold text-slate-600">최종(내 점수)</span></div>
             <div className="flex items-center gap-1.5">
               <div className="w-5 flex justify-center"><svg width="20" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 3" /><circle cx="10" cy="5" r="3.5" fill="#ffffff" stroke="#94a3b8" strokeWidth="2" /></svg></div>
               <span className="text-[10px] sm:text-[11px] font-bold text-slate-600">최초(반 평균)</span>
             </div>
             <div className="flex items-center gap-1.5">
               <div className="w-5 flex justify-center"><svg width="20" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#10b981" strokeWidth="2" strokeDasharray="3 3" /><circle cx="10" cy="5" r="3.5" fill="#ffffff" stroke="#10b981" strokeWidth="2" /></svg></div>
               <span className="text-[10px] sm:text-[11px] font-bold text-slate-600">최종(반 평균)</span>
             </div>
          </div>
        </div>

        <div className="w-full overflow-x-auto overflow-y-hidden custom-scroll pb-2">
          <svg viewBox={`0 0 ${dynamicWidth} ${height}`} className="w-full" style={{ minWidth: dynamicWidth, height: height }}>
            {[0, 25, 50, 75, 100].map(score => (
              <g key={score}>
                <line x1={paddingX - 10} y1={getY(score)} x2={dynamicWidth - 10} y2={getY(score)} stroke="#f1f5f9" strokeWidth="1.5" />
                <text x={paddingX - 15} y={getY(score) + 4} fontSize="10" fill="#94a3b8" textAnchor="end" fontWeight="bold">{score}</text>
              </g>
            ))}
            
            {chartData.map((r: any, i: number) => {
               const cx = paddingX + (i * xStep) + 20; 
               const barWidth = 32;
               return <rect key={`bg-${i}`} x={cx - barWidth/2} y={getY(100)} width={barWidth} height={height - paddingY * 2} fill="#f8fafc" rx="6" />;
            })}

            {chartData.map((r: any, i: number) => {
               const cx = paddingX + (i * xStep) + 20; 
               const initialScore = r.original_score || 0; 
               const finalScore = r.final_score || initialScore;
               
               const yInitial = getY(initialScore);
               const yFinal = getY(finalScore);
               const barWidth = 32;
               const shortTitle = (r.title || '시험').length > 8 ? (r.title || '시험').substring(0,8)+'..' : (r.title || '시험');

               return (
                 <g key={`bar-${i}`}>
                   {finalScore > 0 && <rect x={cx - barWidth/2} y={yFinal} width={barWidth} height={height - paddingY - yFinal} fill="#93c5fd" rx="6" />}
                   {initialScore > 0 && <rect x={cx - barWidth/2} y={yInitial} width={barWidth} height={height - paddingY - yInitial} fill="#002864" rx="6" />}
                   <text x={cx} y={height - 15} fontSize="10" fill="#64748b" textAnchor="middle" fontWeight="bold">{shortTitle}</text>
                 </g>
               );
            })}

            <polyline points={pointsInitAvg} fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeDasharray="4 4" />
            <polyline points={pointsFinAvg} fill="none" stroke="#10b981" strokeWidth="2.5" strokeDasharray="4 4" />
            
            {chartData.map((r: any, i: number) => {
               const cx = paddingX + (i * xStep) + 20; 
               return (
                 <g key={`avg-dots-${i}`}>
                   <circle cx={cx} cy={getY(r.class_init_avg)} r="4.5" fill="#ffffff" stroke="#94a3b8" strokeWidth="2.5" />
                   <circle cx={cx} cy={getY(r.class_fin_avg)} r="4.5" fill="#ffffff" stroke="#10b981" strokeWidth="2.5" />
                 </g>
               );
            })}

            {chartData.map((r: any, i: number) => {
               const cx = paddingX + (i * xStep) + 20; 
               const finalScore = r.final_score || (r.original_score || 0);

               return finalScore > 0 ? (
                 <text key={`text-${i}`} x={cx} y={getY(100) - 12} fontSize="13" fill="#1e3a8a" textAnchor="middle" fontWeight="900">
                   {finalScore}
                 </text>
               ) : null;
            })}
          </svg>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden font-pretendard relative max-w-full">
      <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black text-slate-800">{student.name}</span>
            <span className="text-xs font-bold text-slate-400">학생</span>
          </div>
          <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full border border-slate-200 shadow-sm">
            {student.grade || "학년 정보 없음"}
          </span>
        </div>

        <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-sm mt-1 mb-1 ${todayStatus.color}`}>
          <span className="text-xl leading-none shrink-0">{todayStatus.icon}</span>
          <span className="font-extrabold text-[13px]">{todayStatus.text}</span>
        </div>

        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-2">
          <div className="flex justify-between items-center text-xs font-bold">
            <span className="text-slate-500 shrink-0 mr-2">소속 반</span>
            <span className="text-[#002864] font-black text-right">{className}</span>
          </div>
          {currentClass?.class_schedule && currentClass.class_schedule.length > 0 && (
            <div className="flex justify-between items-start text-xs font-bold">
              <span className="text-slate-500 shrink-0 mr-2 pt-0.5">시간표</span>
              <div className="flex flex-col items-end gap-1 text-slate-700">
                {currentClass.class_schedule.map((sc: any, idx: number) => {
                   const sTime = sc.start_time?.substring(0, 5) || "";
                   const eTime = sc.end_time?.substring(0, 5) || "";
                   const timeString = eTime ? `${sTime}~${eTime}` : sTime;
                   return (
                     <span key={idx} className="bg-white px-2 py-0.5 rounded border border-slate-200 shadow-sm whitespace-nowrap">
                       {sc.day_of_week} {timeString}
                     </span>
                   );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 🌟 완전히 새로워진 2행 3열 세그먼트 컨트롤 메뉴 디자인 */}
      <div className="px-4 sm:px-6 py-4 bg-white border-b border-slate-100">
        <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-[#f1f5f9] rounded-[18px] shadow-inner border border-slate-200/60">
          {[
            { id: "attendance", label: "출결", e_label: "Attendance" },
            { id: "progress", label: "진도", e_label: "Progress" },
            { id: "homework", label: "과제", e_label: "Homework" },
            { id: "makeup", label: "보강", e_label: "Makeup" },
            { id: "exam", label: "성적", e_label: "Report" },
            { id: "consultation", label: "상담", e_label: "Counsel" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`relative flex flex-col items-center justify-center py-2.5 rounded-xl transition-all duration-300 ${
                activeTab === tab.id
                  ? "bg-white text-[#002864] shadow-[0_2px_10px_-3px_rgba(0,0,0,0.1)] border border-slate-200/50 transform scale-[1.02] z-10"
                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/50"
              }`}
            >
              <span className="text-[13px] font-black">{tab.label}</span>
              <span className={`text-[9px] font-bold mt-[2px] transition-colors duration-300 ${activeTab === tab.id ? 'text-blue-500/70' : 'text-slate-300'}`}>{tab.e_label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-5 sm:p-6 bg-slate-50/50 min-h-[400px]">
        
        {activeTab === "attendance" && (
          <div className="animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex justify-between items-center mb-6 px-2">
                <button onClick={handlePrevMonth} className="text-slate-400 hover:text-slate-600 transition-colors p-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"></path></svg></button>
                <span className="font-black text-lg text-[#002864]">{year}년 {month + 1}월</span>
                <button onClick={handleNextMonth} className="text-slate-400 hover:text-slate-600 transition-colors p-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path></svg></button>
              </div>
              
              <div className="grid grid-cols-7 text-center text-[11px] font-extrabold mb-3">
                <span className="text-rose-500">일</span>
                <span className="text-slate-400">월</span>
                <span className="text-slate-400">화</span>
                <span className="text-slate-400">수</span>
                <span className="text-slate-400">목</span>
                <span className="text-slate-400">금</span>
                <span className="text-blue-500">토</span>
              </div>
              
              <div className="grid grid-cols-7 gap-y-3 text-center text-[13px] font-bold">
                {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`empty-${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const d = i + 1;
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const isSelected = selectedDateStr === dateStr;
                  const att = attendanceMap.get(dateStr);
                  
                  let dotColor = "";
                  if (att) {
                    if (att.status === '출석') dotColor = 'bg-emerald-500';
                    else if (att.status === '결석') dotColor = 'bg-rose-500';
                    else if (att.status === '지각') dotColor = 'bg-amber-500';
                    else dotColor = 'bg-slate-400';
                  }

                  return (
                     <div key={d} onClick={() => setSelectedDate(new Date(year, month, d))} className="flex flex-col items-center cursor-pointer group">
                       <div className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all ${isSelected ? 'bg-[#5b64f9] text-white shadow-md shadow-indigo-200' : 'hover:bg-slate-100 text-slate-700'}`}>
                         {d}
                       </div>
                       <div className="h-2 mt-1">
                          {att && <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />}
                       </div>
                     </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 bg-slate-50 rounded-xl p-4 border border-slate-200 shadow-sm">
               <div className="flex items-center gap-1.5 mb-3">
                 <span className="text-base">🗓️</span>
                 <span className="font-extrabold text-slate-800 text-[13px]">{String(selectedDate.getMonth() + 1).padStart(2, '0')}월 {String(selectedDate.getDate()).padStart(2, '0')}일 출결 현황</span>
               </div>
               
               {selectedAtt ? (
                 <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col gap-3">
                   <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                     <span className="text-[11px] font-extrabold text-slate-400">출석 상태</span>
                     <span className={`text-sm font-black ${selectedAtt.status === '출석' ? 'text-emerald-600' : selectedAtt.status === '결석' ? 'text-rose-600' : 'text-amber-600'}`}>
                       {selectedAtt.status}
                     </span>
                   </div>
                   
                   {selectedAtt.status !== '결석' && (
                     <div className="flex items-center justify-between gap-4">
                       <div className="flex-1 bg-slate-50 p-3 rounded-lg flex flex-col items-center justify-center border border-slate-100">
                         <span className="text-[10px] font-bold text-slate-400 mb-1">등원 시간</span>
                         <span className="text-base font-black text-slate-700">
                           {formatTime(selectedAtt.check_in_time) || "-"}
                         </span>
                       </div>
                       <div className="flex-1 bg-slate-50 p-3 rounded-lg flex flex-col items-center justify-center border border-slate-100">
                         <span className="text-[10px] font-bold text-slate-400 mb-1">하원 시간</span>
                         <span className="text-base font-black text-slate-700">
                           {formatTime(selectedAtt.check_out_time) || <span className="text-sm text-emerald-500">학습 진행중</span>}
                         </span>
                       </div>
                     </div>
                   )}
                 </div>
               ) : (
                 <div className="bg-white p-5 rounded-xl border border-slate-100 text-center shadow-sm">
                   <span className="text-sm font-bold text-slate-400">해당 날짜의 출결 기록이 없습니다.</span>
                 </div>
               )}
            </div>
          </div>
        )}

        {activeTab === "progress" && (
          <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 bg-white px-3 py-2 rounded-lg border border-slate-200 w-fit mb-4 shadow-sm">
              <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><span className="w-2.5 h-3 rounded-sm bg-emerald-500 inline-block"></span> 완료</span>
              <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><span className="w-2.5 h-3 rounded-sm bg-amber-400 inline-block"></span> 과제 진행중</span>
              <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><span className="w-2.5 h-3 rounded-sm bg-slate-200 inline-block"></span> 미진행</span>
            </div>

            {!student.progressBooks || student.progressBooks.length === 0 ? (
              <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm">
                현재 반에 배정된 교재 진도 정보가 없습니다.
              </div>
            ) : (
              student.progressBooks.map((cb: any) => {
                const tb = unwrap(cb.textbook);
                const stats = cb.stats || { percent: 0, donePagesCount: 0, maxPageCount: 0, pageStatuses: {}, bookPages: [] };

                let bookBadgeClass = "bg-blue-50 text-blue-700 border-blue-200";
                if (tb?.book_type === "부교재") bookBadgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
                else if (tb?.book_type === "연산교재") bookBadgeClass = "bg-purple-50 text-purple-700 border-purple-200";
                else if (tb?.book_type === "워크북") bookBadgeClass = "bg-amber-50 text-amber-700 border-amber-200";

                return (
                  <div key={cb.class_textbook_id || cb.book_id} className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border shadow-sm ${bookBadgeClass} mr-2 inline-block mb-1`}>
                          {tb?.book_type || "교재"}
                        </span>
                        <div className="font-black text-slate-800 text-[15px]">{tb?.title || "교재명 없음"}</div>
                      </div>
                      <div className="text-right">
                        <span className="text-base font-black text-[#002864] tabular-nums">{stats.percent}%</span>
                        <div className="text-[10px] font-bold text-slate-400 tabular-nums mt-0.5">
                          {stats.donePagesCount} / {stats.maxPageCount}p
                        </div>
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50/70 rounded-lg border border-slate-100 overflow-hidden">
                      {renderPageBlocks(stats.bookPages, stats.pageStatuses)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === "homework" && (
          <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
            {isLogsLoading ? (
              <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="w-6 h-6 border-4 border-[#002864] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                과제 및 진도 정보를 불러오는 중입니다...
              </div>
            ) : lessonLogs.length === 0 ? (
              <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm">
                <span className="text-3xl block mb-3 opacity-50">📚</span>
                아직 등록된 과제/알림장 내역이 없습니다.
              </div>
            ) : (
              lessonLogs.map((log) => (
                <div key={log.lesson_log_id || log.actual_date} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-3 transition-shadow hover:shadow-md">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                    <span className="text-sm font-black text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">
                      {formatDateLabel(log.actual_date)}
                    </span>
                    {log.actual_session_no && (
                      <span className="text-[11px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                        {log.actual_session_no}회차 수업
                      </span>
                    )}
                  </div>
                  <div className="text-[14px] font-medium text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {log.homework_desc}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 🌟 보강 (개별 클리닉/메이크업 일정 연동 뷰) */}
        {activeTab === "makeup" && (
          <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
            {isMakeupLoading ? (
              <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="w-6 h-6 border-4 border-[#002864] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                보강 일정을 불러오는 중입니다...
              </div>
            ) : makeups.length === 0 ? (
              <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm">
                {/* 🌟 빈 화면 아이콘 💡(전구)로 교체 */}
                <span className="text-3xl block mb-3 opacity-50">💡</span>
                등록된 보강/클리닉 일정이 없습니다.
              </div>
            ) : (
              makeups.map((m: any) => {
                const d = new Date(m.schedule_date);
                const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
                const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                const instName = m.instructor?.name ? `${m.instructor.name} 선생님` : '담당 미정';
                
                let statusColor = "bg-slate-100 text-slate-600 border-slate-200";
                if (m.status === '예정') statusColor = "bg-blue-50 text-blue-600 border-blue-200";
                else if (m.status === '진행중') statusColor = "bg-amber-50 text-amber-600 border-amber-200";
                else if (m.status === '완료') statusColor = "bg-emerald-50 text-emerald-600 border-emerald-200";
                else if (m.status === '취소') statusColor = "bg-rose-50 text-rose-500 border-rose-200";

                return (
                  <div key={m.makeup_id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-3 transition-shadow hover:shadow-md">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${statusColor} shadow-sm`}>
                          {m.status || '예정'}
                        </span>
                        <span className="text-[14px] font-black text-[#002864] tracking-tight">
                          {dateStr} {timeStr}
                        </span>
                      </div>
                      <span className="text-[11px] font-bold text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-100">
                        {instName}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-bold text-slate-400 w-12 pt-0.5 shrink-0">보강내용</span>
                        <span className="text-[13px] font-bold text-slate-700 leading-snug">{m.target_category_id || '내용 미정'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 w-12 shrink-0">강의실</span>
                        <span className="text-[12px] font-medium text-slate-600">{m.classroom || '-'}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === "consultation" && (
          <div className="space-y-3 animate-[fadeIn_0.2s_ease-out]">
             {consultLogs.length === 0 ? (
               <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm">
                 <span className="text-3xl block mb-3 opacity-50">💬</span>
                 아직 등록된 상담 기록이 없습니다.
               </div>
             ) : (
               consultLogs.map((log: any, idx: number) => {
                 const badgeColor = getConsultBadgeColor(log.consultation_type);
                 const dateStr = formatDateLabel(log.created_at);
                 const instName = unwrap(log.instructor)?.name || '학원';
                 const hasSummary = log.parent_summary && log.parent_summary.trim() !== "";

                 return (
                   <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2 transition-colors hover:bg-slate-50">
                     <div className="flex justify-between items-center">
                       <div className="flex items-center gap-2">
                         <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${badgeColor} whitespace-nowrap shadow-sm`}>
                           {log.consultation_type || '상담진행'}
                         </span>
                         <span className="text-[11px] font-bold text-slate-500">
                           {dateStr}
                         </span>
                       </div>
                       <div className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded border border-slate-200 whitespace-nowrap">
                         담당: {instName} 선생님
                       </div>
                     </div>
                     {hasSummary && (
                       <div className="text-[13px] font-extrabold text-slate-800 pl-1 mt-1 leading-snug">
                         {log.parent_summary}
                       </div>
                     )}
                   </div>
                 );
               })
             )}
          </div>
        )}

        {activeTab === "exam" && (
          <div className="space-y-6 animate-[fadeIn_0.2s_ease-out]">
            {isExamLoading ? (
              <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="w-6 h-6 border-4 border-[#002864] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                성적 데이터를 불러오는 중입니다...
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {/* 1. 성장 막대 그래프 */}
                {renderGrowthChart()}

                {/* 2. 주간테스트 상세 기록 리스트 */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex-1">
                  <h3 className="font-extrabold text-slate-700 text-[14px] flex items-center gap-1.5 mb-4 border-b border-slate-100 pb-2">
                    <span className="w-1 h-3.5 bg-emerald-500 rounded-full"></span>주간테스트 상세 기록
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {examResults.length === 0 ? <div className="col-span-full text-[11px] text-slate-400 text-center py-4 bg-slate-50 rounded-xl">테스트 기록이 없습니다.</div> :
                       examResults.map((ex: any, i: number) => {
                         const initial = ex.original_score || 0;
                         const final = ex.final_score || 0;
                         
                         return (
                           <div key={i} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between gap-3">
                             <div className="flex justify-between items-start">
                                <div className="flex flex-col gap-1.5 overflow-hidden pr-2 pt-1">
                                   <div className="text-[13px] font-black text-slate-700 truncate" title={ex.title}>{ex.title}</div>
                                   <div className="text-[10px] text-slate-400 font-bold">
                                     {ex.created_at ? new Date(ex.created_at).toLocaleDateString() : '-'}
                                   </div>
                                </div>
                                <div className="flex flex-col gap-0.5 shrink-0">
                                   <div className="flex items-center bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                      <span className="text-[10px] font-bold text-slate-500 w-10 text-left">내 점수</span>
                                      <span className="text-[13px] font-black text-[#002864] w-9 text-right">{initial}점</span>
                                      <span className="text-slate-300 text-[10px] w-6 text-center">➔</span>
                                      <span className="text-[13px] font-black text-blue-600 w-9 text-right">{final}점</span>
                                   </div>
                                   <div className="flex items-center px-2 py-0.5">
                                      <span className="text-[10px] font-bold text-slate-500 w-10 text-left">반 평균</span>
                                      <span className="text-[11px] font-black text-slate-600 w-9 text-right">{ex.class_init_avg}점</span>
                                      <span className="text-slate-300 text-[10px] w-6 text-center">➔</span>
                                      <span className="text-[11px] font-black text-emerald-600 w-9 text-right">{ex.class_fin_avg}점</span>
                                   </div>
                                </div>
                             </div>
                             <div className="flex flex-wrap gap-1 mt-auto">
                               {ex.oCount > 0 && <span className="bg-emerald-50 text-emerald-600 border border-emerald-200 px-1.5 py-0.5 rounded text-[9px] font-black">O 정답 ({ex.oCount})</span>}
                               {ex.roCount > 0 && <span className="bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded text-[9px] font-black">RO 정정 ({ex.roCount})</span>}
                               {ex.toCount > 0 && <span className="bg-teal-50 text-teal-600 border border-teal-200 px-1.5 py-0.5 rounded text-[9px] font-black">TO 힌트 ({ex.toCount})</span>}
                               {ex.xCount > 0 && <span className="bg-rose-50 text-rose-500 border border-rose-200 px-1.5 py-0.5 rounded text-[9px] font-black">X 오답 ({ex.xCount})</span>}
                             </div>
                           </div>
                         )
                       })
                    }
                  </div>
                </div>

                {/* 3. 단원별 성취도 (방사 차트 + 상세 바) */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-end mb-4 border-b border-slate-100 pb-2 gap-2 shrink-0">
                    <h3 className="font-extrabold text-slate-700 text-[14px] flex items-center gap-1.5">
                      <span className="w-1 h-3.5 bg-indigo-500 rounded-full"></span>단원별 성취도 분석
                    </h3>
                    <div className="flex gap-2">
                       <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1"><div className="w-2 h-2 bg-[#002864] rounded-sm"></div>최초</span>
                       <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1"><div className="w-2 h-2 bg-[#93c5fd] rounded-sm"></div>최종</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-center py-2 shrink-0 overflow-hidden">
                    <RadarChart data={categoryAnalysis} />
                  </div>
                  
                  <div className="mt-6 space-y-3">
                    {categoryAnalysis.length === 0 && (
                      <div className="text-center py-10 text-slate-400 text-xs font-bold bg-slate-50 rounded-xl">성취도 데이터가 없습니다.</div>
                    )}
                    {categoryAnalysis.map((cat: any, i: number) => (
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex justify-between items-center text-[11px] font-bold text-slate-700 mb-1">
                          <span className="truncate pr-2">{cat.name}</span>
                          <span className="text-indigo-600 shrink-0">최종 {cat.final_rate}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full relative overflow-hidden">
                          <div className="absolute top-0 left-0 h-full bg-[#93c5fd] rounded-full transition-all duration-1000" style={{ width: `${cat.final_rate}%` }}></div>
                          <div className="absolute top-0 left-0 h-full bg-[#002864] rounded-full transition-all duration-1000" style={{ width: `${cat.initial_rate}%` }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4. 학교 내신 성적 */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                  <h3 className="font-extrabold text-slate-700 text-[14px] flex items-center gap-1.5 mb-4 border-b border-slate-100 pb-2">
                    <span className="w-1 h-3.5 bg-fuchsia-500 rounded-full"></span>학교 내신 성적
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {schoolExams.length === 0 ? <div className="col-span-full text-[11px] text-center py-6 text-slate-400 bg-slate-50 rounded-xl">등록된 학교 성적이 없습니다.</div> :
                      schoolExams.map((se: any, idx: number) => (
                        <div key={se.id || idx} className="bg-slate-50 p-3 rounded-xl border border-slate-100 shadow-sm">
                          <div className="text-[9px] font-bold text-slate-400 mb-0.5">{se.year}년 {se.semester}학기 {se.exam_type}</div>
                          <div className="flex justify-between items-end">
                            <div className="font-black text-[11px] text-slate-700">{se.subject}</div>
                            <div className="text-[13px] font-black text-indigo-600">{se.score}점</div>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>

              </div>
            )}
          </div>
        )}
      </div>

      {toastMessage && (
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 w-max max-w-[90%] bg-slate-800/90 text-white px-5 py-2.5 rounded-full text-[13px] font-bold shadow-lg z-[9999] pointer-events-none transition-all animate-[fadeIn_0.2s_ease-out]">
          📖 {toastMessage}
        </div>
      )}
    </div>
  );
}