// src/components/parent/StudentCard.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

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
    case '퇴원상담': return 'bg-[#FBEAE8] text-[#A32A22]';
    case '신규상담':
    case '입학상담': return 'bg-[#E7F4EE] text-[#0B5E41]';
    case '태도상담': return 'bg-[#FDF1DC] text-[#7A4A00]';
    case '성적상담': return 'bg-[#EAF1F9] text-[#24578F]';
    default: return 'bg-[#EEF0F2] text-[#3E4C59]';
  }
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// "10월 6일 화요일"
const formatKDate = (dateStr: string) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
};

// "10월 7일(수) 22:00"
const formatDueLabel = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEKDAYS[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
    return <div className="text-center text-[#616E7C] text-[14px] py-8 leading-relaxed">단원이 3개 이상 쌓이면<br/>그래프로 보여드려요.</div>;
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
    return <polygon key={levelIndex} points={pts} fill="none" stroke="#E4E7EB" strokeWidth="1" />;
  });

  const axes = data.map((_, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / data.length;
    return <line key={i} x1={center} y1={center} x2={center + radius * Math.cos(angle)} y2={center + radius * Math.sin(angle)} stroke="#E4E7EB" strokeWidth="1" />;
  });

  const polyFinStr = pointsFin.map(p => `${p.x},${p.y}`).join(' ');
  const polyInitStr = pointsInit.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg width="100%" height={size} viewBox={`0 0 ${size} ${size}`}>
      {bgPolygons}
      {axes}
      
      <polygon points={polyFinStr} fill="rgba(157, 185, 227, 0.45)" stroke="#9DB9E3" strokeWidth="2" strokeLinejoin="round" />
      {pointsFin.map((p, i) => <circle key={`fin-dot-${i}`} cx={p.x} cy={p.y} r="3" fill="#6F93C8" />)}

      <polygon points={polyInitStr} fill="rgba(0, 40, 100, 0.35)" stroke="#002864" strokeWidth="2" strokeLinejoin="round" />
      {pointsInit.map((p, i) => <circle key={`init-dot-${i}`} cx={p.x} cy={p.y} r="3" fill="#002864" />)}

      {labelPoints.map((p, i) => {
        const lines = splitLabel(p.label);
        return (
          <text key={`text-${i}`} fontSize="11" fill="#3E4C59" textAnchor="middle">
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
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"attendance" | "progress" | "homework" | "makeup" | "exam" | "consultation">("attendance");

  // 캘린더용 상태
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // 데이터 로딩 상태
  const [lessonLogs, setLessonLogs] = useState<any[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false); // 🌟 더보기 토글 상태 추가
  
  // 성적 데이터 상태
  const [examResults, setExamResults] = useState<any[]>([]);
  const [categoryAnalysis, setCategoryAnalysis] = useState<any[]>([]);
  const [schoolExams, setSchoolExams] = useState<any[]>([]);
  const [isExamLoading, setIsExamLoading] = useState(false);

  // 🌟 보강 관리 상태
  const [makeups, setMakeups] = useState<any[]>([]);
  const [isMakeupLoading, setIsMakeupLoading] = useState(false);

  // 토스트 팝업 상태 관리
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // 🌟 [첫 화면 요약] 마감 전이면서 아직 끝내지 않은 과제 수 (조회 실패 시 줄을 숨김)
  const [pendingHw, setPendingHw] = useState<{ count: number; nextDue: string | null } | null>(null);
  useEffect(() => {
    if (!student?.student_id) return;
    const loadPendingHomework = async () => {
      try {
        const { data, error } = await supabase
          .from("student_homework_result")
          .select("status, homework_assignment!inner(homework_title, due_date)")
          .eq("student_id", student.student_id)
          .gte("homework_assignment.due_date", new Date().toISOString());
        if (error) throw error;
        const DONE = ['제출완료', '채점완료', '완료'];
        const dues = (data || [])
          .map((r: any) => ({ status: r.status, hw: unwrap(r.homework_assignment) as any }))
          .filter(r => r.hw && r.hw.homework_title !== '[시스템] 수업 진도 완료 기록' && !DONE.includes(r.status))
          .map(r => r.hw.due_date as string)
          .sort();
        setPendingHw({ count: dues.length, nextDue: dues[0] || null });
      } catch (e) {
        console.warn("남은 과제 조회 실패:", e);
        setPendingHw(null);
      }
    };
    loadPendingHomework();
  }, [student?.student_id]);

  // 🌟 [첫 화면 요약] 최근 주간테스트 점수 (성적 탭을 열지 않아도 표시)
  useEffect(() => {
    if (student?.student_id) loadExamResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.student_id]);

  const activeEnrollment = student.enrollment?.find((e: any) => (!e.end_date || new Date(e.end_date) >= new Date()) && unwrap(e.class)?.name);
  const currentClass = activeEnrollment ? unwrap(activeEnrollment.class) : null;
  const className = currentClass?.name || "소속 반 없음";
  const classId = currentClass?.class_id;

  const consultLogs = student.consultation_log ? [...student.consultation_log].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) : [];

  // 🌟 일지 데이터를 진도와 과제로 쪼개서 활용할 수 있도록 전체 로드 및 조인
  useEffect(() => {
    if ((activeTab === "homework" || activeTab === "progress") && classId) {
      const fetchLogs = async () => {
        setIsLogsLoading(true);
        try {
          const { data } = await supabase
            .from("daily_lesson_log")
            .select(`
               lesson_log_id, actual_date, homework_desc,
               lesson_log_student_comment(student_id, comment)
            `)
            .eq("class_id", classId)
            .order("actual_date", { ascending: false });
          
          if (data) {
             // 병합되어 있는 homework_desc를 진도와 공통과제로 파싱하고, 현재 학생의 개별 코멘트를 붙임
             const parsedLogs = data.map(log => {
                const desc = log.homework_desc || "";
                const progressMatch = desc.match(/\[📖 오늘의 진도\]\n([\s\S]*?)(?=\n\n\[📝 공통 과제\]|\n\n\[🧑‍🎓 개별 과제\]|$)/);
                const hwMatch = desc.match(/\[📝 공통 과제\]\n([\s\S]*?)(?=\n\n\[🧑‍🎓 개별 과제\]|$)/);
                
                let pDesc = progressMatch ? progressMatch[1].trim() : "";
                let hDesc = hwMatch ? hwMatch[1].trim() : "";
                if (!progressMatch && !hwMatch) hDesc = desc; // 구형 포맷 대응

                const myComment = (log.lesson_log_student_comment || []).find((c: any) => c.student_id === student.student_id);

                return {
                   ...log,
                   parsed_progress: pDesc,
                   parsed_homework: hDesc,
                   my_individual_comment: myComment ? myComment.comment : null
                };
             });
             
             // 과제나 진도 내용이 하나라도 있는 것만 필터링
             setLessonLogs(parsedLogs.filter(l => l.parsed_progress || l.parsed_homework || l.my_individual_comment));
          }
        } catch (error) {
          console.error("일지 정보 로딩 에러:", error);
        } finally {
          setIsLogsLoading(false);
        }
      };
      fetchLogs();
    }
  }, [activeTab, classId, student.student_id]);

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

  // 보강 일정 데이터 로드
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

  // 출결 데이터 매핑
  const attendanceMap = new Map();
  if (student.attendance) {
    student.attendance.forEach((record: any) => {
      if (record.attendance_date) {
        let st = record.status;
        if (!['조퇴', '결석', '지각'].includes(st) && (st === '등원' || record.check_in_time)) {
          st = '출석';
        }
        attendanceMap.set(record.attendance_date, { ...record, status: st });
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

  // 🌟 최근 2주의 기준 날짜 계산 (필터링 용도)
  const twoWeeksAgoMs = new Date(getKSTDateStr()).getTime() - (14 * 24 * 3600000);

  // ==========================================================
  // 🎨 화면 (2026-10 리디자인)
  // 색: 남색 #002864(주색) / 완료 #0F8A5F / 진행·주의 #E9A23B / 위험 #C8372D / 정보 #2F6FB2
  // 글자: 보조 12~13px, 본문 14~15px, 제목 17~22px, 핵심 숫자 26~44px
  // ==========================================================

  const todayStatus = useMemo(() => {
    const todayStr = getKSTDateStr();
    const todayAtt = attendanceMap.get(todayStr);
    // tone: done(초록) / warn(호박) / danger(빨강) / idle(회색)
    if (!todayAtt) return { text: "아직 등원 전이에요", tone: "idle" };
    const inTime = formatTime(todayAtt.check_in_time);
    const outTime = formatTime(todayAtt.check_out_time);
    if (todayAtt.status === '결석') return { text: "오늘은 결석으로 처리되었어요", tone: "danger" };
    if (todayAtt.status === '조퇴') return { text: `${outTime || ''} 조퇴했어요`.trim(), tone: "warn" };
    if (todayAtt.check_out_time || todayAtt.status === '하원') return { text: `${inTime ? inTime + ' 등원, ' : ''}${outTime} 하원했어요`, tone: "done" };
    if (todayAtt.status === '지각') return { text: `${inTime} 등원(지각), 학원에 있어요`, tone: "warn" };
    return { text: `${inTime} 등원, 학원에 있어요`, tone: "done" };
  }, [attendanceMap]);

  const TONE_DOT: Record<string, string> = { done: "bg-[#0F8A5F]", warn: "bg-[#E9A23B]", danger: "bg-[#C8372D]", idle: "bg-[#C3CAD2]" };

  const todayLabel = (() => {
    const d = new Date(getKSTDateStr());
    return `오늘, ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
  })();

  // 최근 4주 출결 요약
  const recentAttendance = useMemo(() => {
    const fromStr = getKSTDateStr(-27);
    let present = 0, late = 0, absent = 0, early = 0;
    attendanceMap.forEach((rec: any, date: string) => {
      if (date < fromStr) return;
      if (rec.status === '결석') absent++;
      else if (rec.status === '지각') late++;
      else if (rec.status === '조퇴') early++;
      else present++;
    });
    return { attended: present + late + early, total: present + late + early + absent, late, absent, early };
  }, [attendanceMap]);

  // 이번에 보는 달의 출결 요약
  const monthAttendance = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    let present = 0, late = 0, absent = 0, early = 0;
    attendanceMap.forEach((rec: any, date: string) => {
      if (!date.startsWith(prefix)) return;
      if (rec.status === '결석') absent++;
      else if (rec.status === '지각') late++;
      else if (rec.status === '조퇴') early++;
      else present++;
    });
    return { present, late, absent, early };
  }, [attendanceMap, year, month]);

  // 시간표 한 줄 요약: 시간이 모두 같으면 "화수금 17:00~19:00"
  const scheduleText = (() => {
    const list = currentClass?.class_schedule || [];
    if (list.length === 0) return "";
    const order = ['월', '화', '수', '목', '금', '토', '일'];
    const sorted = [...list].sort((a: any, b: any) => order.indexOf(String(a.day_of_week).charAt(0)) - order.indexOf(String(b.day_of_week).charAt(0)));
    const timeOf = (sc: any) => { const s = sc.start_time?.substring(0, 5) || ""; const e = sc.end_time?.substring(0, 5) || ""; return e ? `${s}~${e}` : s; };
    const times = Array.from(new Set(sorted.map(timeOf)));
    if (times.length === 1) return `${sorted.map((sc: any) => String(sc.day_of_week).charAt(0)).join('')} ${times[0]}`;
    return sorted.map((sc: any) => `${String(sc.day_of_week).charAt(0)} ${timeOf(sc)}`).join(', ');
  })();

  const books: any[] = student.progressBooks || [];
  const mainBook = books.find((cb: any) => unwrap(cb.textbook)?.book_type === '주교재') || books[0];
  const latestExam = examResults[0];

  const [selectedBookIdx, setSelectedBookIdx] = useState(0);
  const selectedBook = books[Math.min(selectedBookIdx, Math.max(0, books.length - 1))];

  // 한 줄 20쪽의 촘촘한 진도 블록
  const renderPageBlocks = (bookPages: number[], pageStatuses: Record<number, 'done' | 'homework' | 'none' | 'excluded'>, startPage?: number) => {
    if (!bookPages || bookPages.length === 0) {
      return <p className="text-[14px] text-[#616E7C]">이 교재의 페이지 정보가 아직 없어요.</p>;
    }
    const PER_ROW = 20;
    const rows: number[][] = [];
    for (let i = 0; i < bookPages.length; i += PER_ROW) rows.push(bookPages.slice(i, i + PER_ROW));
    const look = (p: number) => {
      const st = pageStatuses[p] || "none";
      const before = startPage !== undefined && p < startPage;
      if (st === "done" && before) return { cls: "bg-[#A8D8C2]", text: `${p}쪽: 합류 이전, 보강으로 완료` };
      if (st === "done") return { cls: "bg-[#0F8A5F]", text: `${p}쪽: 완료` };
      if (st === "homework") return { cls: "bg-[#E9A23B]", text: `${p}쪽: 과제 진행 중` };
      if (st === "excluded" || before) return { cls: "bg-[#ECEFF2]", text: `${p}쪽: 합류 이전 (진도율 계산 제외)` };
      return { cls: "bg-[#C3CAD2]", text: `${p}쪽: 아직 안 함` };
    };
    return (
      <div className="flex flex-col gap-[3px]" aria-label="페이지별 진도, 한 줄에 20쪽">
        {rows.map((row, ri) => (
          <div key={ri} className="flex items-center gap-1.5">
            <span className="w-8 shrink-0 text-right text-[12px] text-[#616E7C] tabular-nums">{row[0]}</span>
            <div className="flex-1 grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${PER_ROW}, minmax(0, 1fr))` }}>
              {row.map((p) => {
                const l = look(p);
                return <button key={p} type="button" aria-label={l.text} onClick={() => showToast(l.text)} className={`h-[14px] rounded-[2px] ${l.cls}`} />;
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderGrowthChart = () => {
    if (examResults.length === 0) return <EmptyBox text="아직 주간테스트 기록이 없어요." />;

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
      <section className="bg-white p-4 rounded-xl border border-[#E4E7EB] flex flex-col gap-3">
        <div>
          <h3 className="text-[17px] font-bold text-[#1F2933]">주간테스트 점수 변화</h3>
          <p className="text-[13px] text-[#616E7C] mt-1 leading-relaxed">처음 푼 점수와 오답을 고친 뒤의 점수, 같은 시험의 반 평균이에요.</p>
        </div>
        <ul className="grid grid-cols-2 gap-2 text-[13px] text-[#3E4C59]">
          <li className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-[#002864]"></span>처음 점수</li>
          <li className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-[#9DB9E3]"></span>고친 뒤 점수</li>
          <li className="flex items-center gap-2"><svg width="20" height="10" aria-hidden="true"><line x1="0" y1="5" x2="20" y2="5" stroke="#7B8794" strokeWidth="2" strokeDasharray="3 3" /></svg>반 평균 (처음)</li>
          <li className="flex items-center gap-2"><svg width="20" height="10" aria-hidden="true"><line x1="0" y1="5" x2="20" y2="5" stroke="#0F8A5F" strokeWidth="2" strokeDasharray="3 3" /></svg>반 평균 (고친 뒤)</li>
        </ul>

        <div className="w-full overflow-x-auto overflow-y-hidden pb-1">
          <svg viewBox={`0 0 ${dynamicWidth} ${height}`} className="w-full" style={{ minWidth: dynamicWidth, height }} role="img" aria-label="주간테스트 점수 막대 그래프">
            {[0, 25, 50, 75, 100].map(score => (
              <g key={score}>
                <line x1={paddingX - 10} y1={getY(score)} x2={dynamicWidth - 10} y2={getY(score)} stroke="#EEF0F2" strokeWidth="1.5" />
                <text x={paddingX - 15} y={getY(score) + 4} fontSize="11" fill="#616E7C" textAnchor="end">{score}</text>
              </g>
            ))}
            {chartData.map((r: any, i: number) => {
              const cx = paddingX + (i * xStep) + 20;
              const initialScore = r.original_score || 0;
              const finalScore = r.final_score || initialScore;
              const barWidth = 32;
              const shortTitle = (r.title || '시험').length > 8 ? (r.title || '시험').substring(0, 8) + '..' : (r.title || '시험');
              return (
                <g key={`bar-${i}`}>
                  {finalScore > 0 && <rect x={cx - barWidth / 2} y={getY(finalScore)} width={barWidth} height={height - paddingY - getY(finalScore)} fill="#9DB9E3" rx="4" />}
                  {initialScore > 0 && <rect x={cx - barWidth / 2} y={getY(initialScore)} width={barWidth} height={height - paddingY - getY(initialScore)} fill="#002864" rx="4" />}
                  <text x={cx} y={height - 15} fontSize="11" fill="#3E4C59" textAnchor="middle">{shortTitle}</text>
                  {finalScore > 0 && <text x={cx} y={getY(100) - 12} fontSize="13" fill="#1F2933" textAnchor="middle" fontWeight="700">{finalScore}</text>}
                </g>
              );
            })}
            <polyline points={pointsInitAvg} fill="none" stroke="#7B8794" strokeWidth="2" strokeDasharray="4 4" />
            <polyline points={pointsFinAvg} fill="none" stroke="#0F8A5F" strokeWidth="2" strokeDasharray="4 4" />
            {chartData.map((r: any, i: number) => {
              const cx = paddingX + (i * xStep) + 20;
              return (
                <g key={`avg-${i}`}>
                  <circle cx={cx} cy={getY(r.class_init_avg)} r="4" fill="#FFFFFF" stroke="#7B8794" strokeWidth="2" />
                  <circle cx={cx} cy={getY(r.class_fin_avg)} r="4" fill="#FFFFFF" stroke="#0F8A5F" strokeWidth="2" />
                </g>
              );
            })}
          </svg>
        </div>
      </section>
    );
  };

  const TABS: { id: typeof activeTab; label: string }[] = [
    { id: "attendance", label: "출결" },
    { id: "progress", label: "진도" },
    { id: "homework", label: "과제" },
    { id: "makeup", label: "보강" },
    { id: "exam", label: "성적" },
    { id: "consultation", label: "상담" },
  ];

  const ATT_DOT: Record<string, string> = { '출석': 'bg-[#0F8A5F]', '지각': 'bg-[#E9A23B]', '조퇴': 'bg-[#E9A23B]', '결석': 'bg-[#C8372D]' };
  const ATT_TEXT: Record<string, string> = { '출석': 'text-[#0B5E41]', '지각': 'text-[#7A4A00]', '조퇴': 'text-[#7A4A00]', '결석': 'text-[#A32A22]' };

  const MAKEUP_CHIP: Record<string, string> = {
    '예정': 'bg-[#EAF1F9] text-[#24578F]',
    '진행중': 'bg-[#FDF1DC] text-[#7A4A00]',
    '완료': 'bg-[#E7F4EE] text-[#0B5E41]',
    '취소': 'bg-[#EEF0F2] text-[#616E7C]',
  };

  const progressLogs = lessonLogs.filter(l => l.parsed_progress || l.parsed_homework);
  const visibleProgressLogs = showAllLogs ? progressLogs : progressLogs.filter(l => new Date(l.actual_date).getTime() >= twoWeeksAgoMs);
  const hiddenOlderCount = progressLogs.length - visibleProgressLogs.length;

  return (
    <div className="bg-[#F5F7FA] rounded-2xl border border-[#E4E7EB] overflow-hidden font-pretendard relative max-w-full text-[#1F2933]">

      {/* 학생 요약 */}
      <div className="bg-white px-5 pt-5 pb-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[22px] font-bold leading-tight">{student.name}</h2>
          <p className="text-[14px] text-[#616E7C]">
            {[student.grade || "학년 정보 없음", className, scheduleText].filter(Boolean).join(", ")}
          </p>
        </div>

        <section aria-label="오늘" className="rounded-xl border border-[#E4E7EB] p-4 flex flex-col gap-3">
          <div className="text-[13px] font-semibold text-[#616E7C]">{todayLabel}</div>
          <div className="flex items-center gap-2.5">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TONE_DOT[todayStatus.tone]}`}></span>
            <span className="text-[16px] font-semibold">{todayStatus.text}</span>
          </div>
          {pendingHw && (
            <div className="flex items-center gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${pendingHw.count > 0 ? 'bg-[#E9A23B]' : 'bg-[#0F8A5F]'}`}></span>
              <span className="text-[15px] text-[#3E4C59]">
                {pendingHw.count > 0
                  ? `남은 과제 ${pendingHw.count}개${pendingHw.nextDue ? `, 가장 빠른 마감 ${formatDueLabel(pendingHw.nextDue)}` : ''}`
                  : '마감 전 남은 과제가 없어요'}
              </span>
            </div>
          )}
        </section>

        <section aria-label="요약" className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-[#E4E7EB] px-3 py-3 flex flex-col gap-1">
            <span className="text-[13px] text-[#616E7C]">최근 4주 출석</span>
            <span className="text-[26px] font-bold tabular-nums leading-tight">{recentAttendance.attended}<span className="text-[15px] font-medium text-[#616E7C]">/{recentAttendance.total}회</span></span>
            {(recentAttendance.late > 0 || recentAttendance.absent > 0) && (
              <span className="text-[12px] text-[#616E7C]">{[recentAttendance.late > 0 ? `지각 ${recentAttendance.late}회` : '', recentAttendance.absent > 0 ? `결석 ${recentAttendance.absent}회` : ''].filter(Boolean).join(', ')}</span>
            )}
          </div>
          <div className="rounded-xl border border-[#E4E7EB] px-3 py-3 flex flex-col gap-1">
            <span className="text-[13px] text-[#616E7C]">주교재 진도</span>
            <span className="text-[26px] font-bold tabular-nums leading-tight">{mainBook ? (mainBook.stats?.percent ?? 0) : '-'}<span className="text-[15px] font-medium text-[#616E7C]">{mainBook ? '%' : ''}</span></span>
          </div>
          <div className="rounded-xl border border-[#E4E7EB] px-3 py-3 flex flex-col gap-1">
            <span className="text-[13px] text-[#616E7C]">주간테스트</span>
            <span className="text-[26px] font-bold tabular-nums leading-tight">{latestExam ? (latestExam.original_score ?? 0) : '-'}<span className="text-[15px] font-medium text-[#616E7C]">{latestExam ? '점' : ''}</span></span>
            {latestExam && <span className="text-[12px] text-[#616E7C]">반 평균 {latestExam.class_init_avg}점</span>}
          </div>
        </section>
      </div>

      {/* 탭 */}
      <nav aria-label="자세히 보기" className="bg-white border-b border-[#E4E7EB] px-3 flex gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 min-h-[48px] px-3 text-[15px] border-b-[3px] transition-colors ${active ? 'border-[#002864] text-[#002864] font-bold' : 'border-transparent text-[#616E7C] font-medium'}`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 sm:p-5 min-h-[400px] flex flex-col gap-4">

        {/* 출결 */}
        {activeTab === "attendance" && (
          <>
            <section className="bg-white rounded-xl border border-[#E4E7EB] p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <button type="button" onClick={handlePrevMonth} aria-label="이전 달" className="w-11 h-11 rounded-full flex items-center justify-center text-[#3E4C59] hover:bg-[#F5F7FA]">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                </button>
                <span className="text-[17px] font-bold">{year}년 {month + 1}월</span>
                <button type="button" onClick={handleNextMonth} aria-label="다음 달" className="w-11 h-11 rounded-full flex items-center justify-center text-[#3E4C59] hover:bg-[#F5F7FA]">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                </button>
              </div>

              <div className="grid grid-cols-7 text-center text-[12px] text-[#616E7C]">
                {WEEKDAYS.map((w, i) => <span key={w} className={i === 0 ? 'text-[#C8372D]' : ''}>{w}</span>)}
              </div>

              <div className="grid grid-cols-7 gap-y-1 text-center">
                {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`empty-${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const d = i + 1;
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const isSelected = selectedDateStr === dateStr;
                  const att = attendanceMap.get(dateStr);
                  const dot = att ? (ATT_DOT[att.status] || 'bg-[#9AA5B1]') : '';
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelectedDate(new Date(year, month, d))}
                      aria-label={`${month + 1}월 ${d}일${att ? `, ${att.status}` : ''}`}
                      aria-pressed={isSelected}
                      className="h-11 flex flex-col items-center justify-center gap-[3px]"
                    >
                      <span className={`w-8 h-8 flex items-center justify-center rounded-full text-[14px] tabular-nums ${isSelected ? 'bg-[#002864] text-white font-semibold' : 'text-[#3E4C59]'}`}>{d}</span>
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`}></span>
                    </button>
                  );
                })}
              </div>

              <ul aria-label="달력 안내" className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-[#3E4C59]">
                <li className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#0F8A5F]"></span>출석</li>
                <li className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#E9A23B]"></span>지각·조퇴</li>
                <li className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#C8372D]"></span>결석</li>
              </ul>
            </section>

            <section className="bg-white rounded-xl border border-[#E4E7EB] p-4 flex flex-col gap-3">
              <h3 className="text-[15px] font-semibold">{selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일 {WEEKDAYS[selectedDate.getDay()]}요일</h3>
              {selectedAtt ? (
                <div className="grid grid-cols-[64px_1fr] gap-y-2 text-[15px]">
                  <span className="text-[#616E7C]">상태</span>
                  <span className={`font-semibold ${ATT_TEXT[selectedAtt.status] || 'text-[#3E4C59]'}`}>{selectedAtt.status}</span>
                  {selectedAtt.status !== '결석' && (
                    <>
                      <span className="text-[#616E7C]">등원</span>
                      <span className="tabular-nums">{formatTime(selectedAtt.check_in_time) || '-'}</span>
                      <span className="text-[#616E7C]">하원</span>
                      <span className="tabular-nums">{formatTime(selectedAtt.check_out_time) || '아직 학원에 있어요'}</span>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-[14px] text-[#616E7C]">이 날의 출결 기록이 없어요.</p>
              )}
            </section>

            <section aria-label={`${month + 1}월 출결 요약`} className="grid grid-cols-3 gap-2">
              <div className="bg-white rounded-xl border border-[#E4E7EB] px-3 py-3 flex flex-col gap-1">
                <span className="text-[13px] text-[#616E7C]">{month + 1}월 출석</span>
                <span className="text-[26px] font-bold text-[#0F8A5F] tabular-nums leading-tight">{monthAttendance.present}<span className="text-[15px] font-medium text-[#616E7C]">회</span></span>
              </div>
              <div className="bg-white rounded-xl border border-[#E4E7EB] px-3 py-3 flex flex-col gap-1">
                <span className="text-[13px] text-[#616E7C]">지각·조퇴</span>
                <span className="text-[26px] font-bold text-[#9A5B00] tabular-nums leading-tight">{monthAttendance.late + monthAttendance.early}<span className="text-[15px] font-medium text-[#616E7C]">회</span></span>
              </div>
              <div className="bg-white rounded-xl border border-[#E4E7EB] px-3 py-3 flex flex-col gap-1">
                <span className="text-[13px] text-[#616E7C]">결석</span>
                <span className={`text-[26px] font-bold tabular-nums leading-tight ${monthAttendance.absent > 0 ? 'text-[#C8372D]' : 'text-[#1F2933]'}`}>{monthAttendance.absent}<span className="text-[15px] font-medium text-[#616E7C]">회</span></span>
              </div>
            </section>
          </>
        )}

        {/* 진도 */}
        {activeTab === "progress" && (
          <>
            {books.length === 0 ? (
              <EmptyBox text="지금 반에 배정된 교재가 없어요." />
            ) : (
              <>
                {books.length > 1 && (
                  <div role="group" aria-label="교재 선택" className="flex gap-1 bg-[#E4E7EB] rounded-[10px] p-1 overflow-x-auto">
                    {books.map((cb: any, idx: number) => {
                      const tb = unwrap(cb.textbook);
                      const active = selectedBook === cb;
                      return (
                        <button
                          key={cb.class_textbook_id || cb.book_id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setSelectedBookIdx(idx)}
                          className={`flex-1 min-w-[88px] min-h-[40px] px-3 rounded-lg text-[14px] truncate ${active ? 'bg-white text-[#1F2933] font-semibold' : 'text-[#616E7C] font-medium'}`}
                        >
                          {tb?.book_type || '교재'}{books.filter((b: any) => unwrap(b.textbook)?.book_type === tb?.book_type).length > 1 ? ` ${idx + 1}` : ''}
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedBook && (() => {
                  const tb = unwrap(selectedBook.textbook);
                  const stats = selectedBook.stats || { percent: 0, donePagesCount: 0, maxPageCount: 0, pageStatuses: {}, bookPages: [] };
                  const hasStart = stats.startPage !== undefined;
                  return (
                    <section className="bg-white rounded-xl border border-[#E4E7EB] p-4 flex flex-col gap-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-[13px] text-[#616E7C]">{tb?.book_type || '교재'}, {tb?.title || '교재명 없음'}</span>
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[44px] font-bold text-[#002864] tabular-nums leading-none">{stats.percent}%</span>
                          <span className="text-[15px] text-[#3E4C59]">{stats.maxPageCount}쪽 중 {stats.donePagesCount}쪽 완료</span>
                        </div>
                      </div>
                      {hasStart && (
                        <p className="text-[14px] leading-relaxed text-[#3E4C59] bg-[#F5F7FA] rounded-lg px-3 py-2.5">
                          {stats.startPage}쪽부터 반에 합류해, 그 이전 페이지는 진도율에서 빼고 계산했어요.
                        </p>
                      )}
                      <ul aria-label="색 안내" className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px] text-[#3E4C59]">
                        <li className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-[3px] bg-[#0F8A5F]"></span>완료</li>
                        <li className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-[3px] bg-[#E9A23B]"></span>과제 진행 중</li>
                        <li className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-[3px] bg-[#C3CAD2]"></span>아직 안 함</li>
                        {hasStart && <li className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-[3px] bg-[#ECEFF2]"></span>합류 이전 (계산 제외)</li>}
                        {hasStart && <li className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-[3px] bg-[#A8D8C2]"></span>합류 이전, 보강 완료</li>}
                      </ul>
                      {renderPageBlocks(stats.bookPages, stats.pageStatuses, stats.startPage)}
                    </section>
                  );
                })()}
              </>
            )}

            <section className="flex flex-col gap-3">
              <h3 className="text-[17px] font-bold mt-1">수업별 기록</h3>
              {isLogsLoading ? (
                <LoadingBox text="수업 기록을 불러오는 중이에요." />
              ) : visibleProgressLogs.length === 0 && hiddenOlderCount === 0 ? (
                <EmptyBox text="아직 등록된 수업 기록이 없어요." />
              ) : (
                <>
                  {visibleProgressLogs.map((log) => (
                    <article key={`prog-${log.lesson_log_id}`} className="bg-white rounded-xl border border-[#E4E7EB] px-4 py-3.5 flex flex-col gap-2">
                      <div className="text-[15px] font-semibold">{formatKDate(log.actual_date)}</div>
                      <div className="grid grid-cols-[40px_1fr] gap-x-2 gap-y-1 text-[14px] leading-relaxed">
                        {log.parsed_progress && (<><span className="text-[#616E7C]">진도</span><span className="whitespace-pre-wrap">{log.parsed_progress}</span></>)}
                        {log.parsed_homework && (<><span className="text-[#616E7C]">과제</span><span className="whitespace-pre-wrap">{log.parsed_homework}</span></>)}
                      </div>
                    </article>
                  ))}
                  {!showAllLogs && hiddenOlderCount > 0 && (
                    <button type="button" onClick={() => setShowAllLogs(true)} className="min-h-[48px] rounded-lg border border-[#CBD2D9] bg-white text-[15px] font-semibold text-[#3E4C59]">
                      이전 기록 {hiddenOlderCount}개 더 보기
                    </button>
                  )}
                </>
              )}
            </section>
          </>
        )}

        {/* 과제 */}
        {activeTab === "homework" && (
          <>
            <h3 className="text-[17px] font-bold">수업에서 받은 과제</h3>
            {isLogsLoading ? (
              <LoadingBox text="과제를 불러오는 중이에요." />
            ) : lessonLogs.filter(l => l.parsed_homework || l.my_individual_comment).length === 0 ? (
              <EmptyBox text="아직 받은 과제가 없어요." />
            ) : (
              lessonLogs.filter(l => l.parsed_homework || l.my_individual_comment).map((log) => (
                <article key={`hw-${log.lesson_log_id}`} className="bg-white rounded-xl border border-[#E4E7EB] px-4 py-3.5 flex flex-col gap-3">
                  <div className="text-[15px] font-semibold">{formatKDate(log.actual_date)} 수업</div>
                  {log.my_individual_comment && (
                    <div className="bg-[#EAF1F9] rounded-lg px-3 py-2.5 flex flex-col gap-1">
                      <span className="text-[13px] font-semibold text-[#24578F]">{student.name} 학생에게 따로 남긴 말</span>
                      <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{log.my_individual_comment}</p>
                    </div>
                  )}
                  {log.parsed_homework && (
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-[#3E4C59]">{log.parsed_homework}</p>
                  )}
                </article>
              ))
            )}
          </>
        )}

        {/* 보강 */}
        {activeTab === "makeup" && (
          <>
            <h3 className="text-[17px] font-bold">보강 일정</h3>
            {isMakeupLoading ? (
              <LoadingBox text="보강 일정을 불러오는 중이에요." />
            ) : makeups.length === 0 ? (
              <EmptyBox text="잡힌 보강 일정이 없어요." />
            ) : (
              makeups.map((m: any) => {
                const d = new Date(m.schedule_date);
                const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                const status = m.status || '예정';
                return (
                  <article key={m.makeup_id} className="bg-white rounded-xl border border-[#E4E7EB] px-4 py-3.5 flex flex-col gap-2">
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-[15px] font-semibold">{d.getMonth() + 1}월 {d.getDate()}일 {WEEKDAYS[d.getDay()]}요일 {timeStr}</span>
                      <span className={`text-[12px] font-semibold rounded-full px-2.5 py-1 shrink-0 ${MAKEUP_CHIP[status] || MAKEUP_CHIP['예정']}`}>{status}</span>
                    </div>
                    <div className="grid grid-cols-[48px_1fr] gap-x-2 gap-y-1 text-[14px]">
                      <span className="text-[#616E7C]">내용</span><span>{m.target_category_id || '정해지는 대로 알려드릴게요'}</span>
                      <span className="text-[#616E7C]">장소</span><span>{m.classroom || '-'}</span>
                      <span className="text-[#616E7C]">담당</span><span>{m.instructor?.name ? `${m.instructor.name} 선생님` : '정해지는 대로 알려드릴게요'}</span>
                    </div>
                  </article>
                );
              })
            )}
          </>
        )}

        {/* 성적 */}
        {activeTab === "exam" && (
          isExamLoading ? (
            <LoadingBox text="성적을 불러오는 중이에요." />
          ) : (
            <>
              {renderGrowthChart()}

              <section className="bg-white rounded-xl border border-[#E4E7EB] p-4 flex flex-col gap-3">
                <h3 className="text-[17px] font-bold">주간테스트 기록</h3>
                {examResults.length === 0 ? <p className="text-[14px] text-[#616E7C]">아직 기록이 없어요.</p> : (
                  <div className="flex flex-col divide-y divide-[#E4E7EB]">
                    {examResults.map((ex: any, i: number) => (
                      <div key={i} className="py-3 flex flex-col gap-2">
                        <div className="flex justify-between items-start gap-3">
                          <div className="min-w-0">
                            <div className="text-[15px] font-semibold truncate" title={ex.title}>{ex.title}</div>
                            <div className="text-[12px] text-[#616E7C]">{ex.created_at ? formatKDate(ex.created_at) : '-'}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[15px] tabular-nums"><span className="font-bold text-[#002864]">{ex.original_score || 0}</span><span className="text-[#616E7C]"> → </span><span className="font-bold">{ex.final_score || 0}점</span></div>
                            <div className="text-[12px] text-[#616E7C] tabular-nums">반 평균 {ex.class_init_avg} → {ex.class_fin_avg}점</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-[12px] font-semibold">
                          {ex.oCount > 0 && <span className="rounded-full px-2 py-0.5 bg-[#E7F4EE] text-[#0B5E41]">처음부터 정답 {ex.oCount}</span>}
                          {ex.roCount > 0 && <span className="rounded-full px-2 py-0.5 bg-[#EAF1F9] text-[#24578F]">스스로 고침 {ex.roCount}</span>}
                          {ex.toCount > 0 && <span className="rounded-full px-2 py-0.5 bg-[#FDF1DC] text-[#7A4A00]">힌트 후 정답 {ex.toCount}</span>}
                          {ex.xCount > 0 && <span className="rounded-full px-2 py-0.5 bg-[#FBEAE8] text-[#A32A22]">아직 오답 {ex.xCount}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="bg-white rounded-xl border border-[#E4E7EB] p-4 flex flex-col gap-3">
                <div className="flex justify-between items-end gap-2">
                  <h3 className="text-[17px] font-bold">단원별 성취도</h3>
                  <div className="flex gap-3 text-[12px] text-[#3E4C59]">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#002864]"></span>처음</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#9DB9E3]"></span>고친 뒤</span>
                  </div>
                </div>
                <div className="flex items-center justify-center overflow-hidden">
                  <RadarChart data={categoryAnalysis} />
                </div>
                {categoryAnalysis.length === 0 ? (
                  <p className="text-[14px] text-[#616E7C]">아직 단원별 기록이 없어요.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {categoryAnalysis.map((cat: any, i: number) => (
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex justify-between items-center text-[14px]">
                          <span className="truncate pr-2">{cat.name}</span>
                          <span className="shrink-0 tabular-nums font-semibold">{cat.final_rate}%</span>
                        </div>
                        <div className="w-full bg-[#EEF0F2] h-2 rounded-full relative overflow-hidden">
                          <div className="absolute inset-y-0 left-0 bg-[#9DB9E3] rounded-full" style={{ width: `${cat.final_rate}%` }}></div>
                          <div className="absolute inset-y-0 left-0 bg-[#002864] rounded-full" style={{ width: `${cat.initial_rate}%` }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="bg-white rounded-xl border border-[#E4E7EB] p-4 flex flex-col gap-3">
                <h3 className="text-[17px] font-bold">학교 내신 성적</h3>
                {schoolExams.length === 0 ? <p className="text-[14px] text-[#616E7C]">등록된 학교 성적이 없어요.</p> : (
                  <div className="grid grid-cols-2 gap-2">
                    {schoolExams.map((se: any, idx: number) => (
                      <div key={se.id || idx} className="rounded-lg bg-[#F5F7FA] px-3 py-2.5 flex flex-col gap-1">
                        <span className="text-[12px] text-[#616E7C]">{se.year}년 {se.semester}학기 {se.exam_type}</span>
                        <div className="flex justify-between items-baseline">
                          <span className="text-[14px] font-semibold">{se.subject}</span>
                          <span className="text-[17px] font-bold tabular-nums">{se.score}점</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )
        )}

        {/* 상담 */}
        {activeTab === "consultation" && (
          <>
            <h3 className="text-[17px] font-bold">상담 기록</h3>
            {consultLogs.length === 0 ? (
              <EmptyBox text="아직 상담 기록이 없어요. 궁금한 점은 상담 버튼으로 남겨 주세요." />
            ) : (
              consultLogs.map((log: any, idx: number) => {
                const instName = unwrap(log.instructor)?.name;
                const hasSummary = log.parent_summary && log.parent_summary.trim() !== "";
                return (
                  <article key={idx} className="bg-white rounded-xl border border-[#E4E7EB] px-4 py-3.5 flex flex-col gap-2">
                    <div className="flex justify-between items-center gap-2">
                      <span className={`text-[12px] font-semibold rounded-full px-2.5 py-1 ${getConsultBadgeColor(log.consultation_type)}`}>{log.consultation_type || '상담'}</span>
                      <span className="text-[13px] text-[#616E7C]">{formatKDate(log.created_at)}{instName ? `, ${instName} 선생님` : ''}</span>
                    </div>
                    {hasSummary && <p className="text-[15px] leading-relaxed">{log.parent_summary}</p>}
                  </article>
                );
              })
            )}
          </>
        )}

      </div>

      {toastMessage && (
        <div role="status" className="absolute bottom-6 left-1/2 -translate-x-1/2 w-max max-w-[90%] bg-[#1F2933] text-white px-4 py-2.5 rounded-lg text-[14px] shadow-lg z-[9999] pointer-events-none">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

const EmptyBox = ({ text }: { text: string }) => (
  <div className="bg-white rounded-xl border border-[#E4E7EB] px-4 py-10 text-center text-[14px] text-[#616E7C]">{text}</div>
);

const LoadingBox = ({ text }: { text: string }) => (
  <div className="bg-white rounded-xl border border-[#E4E7EB] px-4 py-10 flex flex-col items-center gap-3 text-[14px] text-[#616E7C]" role="status">
    <span className="w-6 h-6 border-[3px] border-[#002864] border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
    {text}
  </div>
);
