// src/app/(dashboard)/admission/analytics/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Chart from "chart.js/auto";

interface ExamOption {
  exam_id: string;
  title: string;
  sub_title: string;
}

export default function AdmissionAnalyticsPage() {
  const router = useRouter();
  
  const [isLoading, setIsLoading] = useState(true);
  const [examList, setExamList] = useState<ExamOption[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [excludeTest, setExcludeTest] = useState<boolean>(true);
  
  const [modalQ, setModalQ] = useState<any>(null);

  const [reportStats, setReportStats] = useState<{
    summary: { totalStudents: number; averageScore: string; highestScore: number } | null;
    questionStats: any[];
    studentList: any[];
  }>({ summary: null, questionStats: [], studentList: [] });

  const [examAssignments, setExamAssignments] = useState<any[]>([]);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<any>(null);
  const mathJaxRef = useRef(false);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = {
        tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]], processEscapes: true },
        svg: { fontCache: 'global' }
      };
      const script = document.createElement("script");
      script.id = "MathJax-script";
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
      script.async = true;
      document.head.appendChild(script);
    }
  };

  useEffect(() => { loadMathJax(); }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== "undefined" && (window as any).MathJax?.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch(() => {});
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [modalQ, reportStats]);

  const getCleanUrl = (url: string) => {
    if (!url || url === 'null') return '';
    let validUrl = url;
    if (typeof validUrl === 'string' && validUrl.trim().startsWith('[')) { try { validUrl = JSON.parse(validUrl)[0]; } catch(e) {} }
    if (validUrl && validUrl !== 'null' && !validUrl.startsWith('http') && !validUrl.startsWith('data:image')) { 
      validUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/question_images/${validUrl}`; 
    }
    return validUrl;
  };
  
  const formatMathTextForWeb = (text: string) => {
    if (!text) return "";
    let t = String(text).replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ');
    t = t.replace(/\\bigcirc/g, '\\circ').replace(/\^{?[○◯]}?/g, '^{\\circ}').replace(/([0-9]+)\s*[○◯]/g, '$1^{\\circ}');
    return t; 
  };

  useEffect(() => {
    const fetchBaseData = async () => {
      try {
        const { data, error } = await supabase
          .from('exam_assignment')
          .select('assignment_id, total_score, exam_id, student(name), exam_master!inner(title, sub_title, exam_type)')
          .eq('status', '채점완료')
          .eq('exam_master.exam_type', '입학테스트')
          .limit(5000);

        if (error) throw error;
        setExamAssignments(data || []);

        const uniqueMap = new Map<string, ExamOption>();
        (data || []).forEach((a: any) => {
          if (a.exam_id && !uniqueMap.has(a.exam_id)) {
            const em = Array.isArray(a.exam_master) ? a.exam_master[0] : a.exam_master;
            uniqueMap.set(a.exam_id, {
              exam_id: a.exam_id,
              title: em?.title || '제목 없음',
              sub_title: em?.sub_title || ''
            });
          }
        });

        const arr = Array.from(uniqueMap.values()).sort((a, b) => a.sub_title.localeCompare(b.sub_title));
        setExamList(arr);
        if (arr.length > 0) setSelectedExamId(arr[0].exam_id);
      } catch (err) {
        console.error("데이터 로드 실패:", err);
      }
    };
    fetchBaseData();
  }, []);

  useEffect(() => {
    const fetchDetailedStats = async () => {
      if (!selectedExamId) return;
      setIsLoading(true);

      try {
        const { data: assigns, error: aErr } = await supabase
          .from('exam_assignment')
          .select('assignment_id, total_score, student!inner(name, grade)')
          .eq('exam_id', selectedExamId)
          .eq('status', '채점완료');
          
        if (aErr) throw aErr;

        let filteredAssigns = assigns || [];
        
        if (excludeTest) {
          filteredAssigns = filteredAssigns.filter((a: any) => {
            const name = Array.isArray(a.student) ? a.student[0]?.name : a.student?.name;
            return name && !name.includes('테스트') && !name.toLowerCase().includes('test');
          });
        }

        const assignIds = filteredAssigns.map(a => a.assignment_id);

        let allAnswers: any[] = [];
        const chunkSize = 200;
        for (let i = 0; i < assignIds.length; i += chunkSize) {
          const chunk = assignIds.slice(i, i + chunkSize);
          const { data: ansChunk } = await supabase
            .from('student_answer')
            .select('exam_assignment_id, question_id, is_correct, earned_score')
            .in('exam_assignment_id', chunk);
          if (ansChunk) allAnswers.push(...ansChunk);
        }

        const { data: items, error: iErr } = await supabase
          .from('exam_item')
          .select('question_id, sort_order, assigned_score')
          .eq('exam_id', selectedExamId)
          .order('sort_order');
          
        if (iErr) throw iErr;
        const itemsData = items || [];

        const qIds = itemsData.map(i => i.question_id);
        const uuidIds = qIds.filter(id => typeof id === 'string' && id.includes('-'));
        const numIds = qIds.filter(id => typeof id === 'number' || (typeof id === 'string' && !id.includes('-') && !isNaN(Number(id)))).map(Number);

        let fetchedQuestions: any[] = [];
        if (uuidIds.length > 0) {
          const { data: qDbData } = await supabase.from('question_db')
            .select('question_id, parent_question_id, question_number, sub_num, question, image_url, answer')
            .in('question_id', uuidIds).limit(10000);
          if (qDbData) fetchedQuestions.push(...qDbData);
        }
        
        const foundUuids = fetchedQuestions.map(q => q.question_id);
        const missingUuids = uuidIds.filter(id => !foundUuids.includes(id));

        if (missingUuids.length > 0) {
          const { data: tqUuidData } = await supabase.from('textbook_question')
            .select('question_id, parent_tq_id, question_number, question, answer')
            .in('question_id', missingUuids).limit(10000);
          if (tqUuidData) fetchedQuestions.push(...tqUuidData);
        }
        
        if (numIds.length > 0) {
          const { data: numData } = await supabase.from('textbook_question')
            .select('tq_id, parent_tq_id, question_number, question, answer')
            .in('tq_id', numIds).limit(10000);
          if (numData) fetchedQuestions.push(...numData);
        }

        const qMap: any = {};
        fetchedQuestions.forEach(q => {
          if (q.question_id) qMap[String(q.question_id)] = q;
          if (q.tq_id) qMap[String(q.tq_id)] = q;
        });

        const groupMap = new Map();
        const groups: any[] = [];

        itemsData.forEach(item => {
          const q = qMap[String(item.question_id)] || {};
          const baseNum = String(q.question_number || '').match(/\d+/) ? String(q.question_number).match(/\d+/)?.[0] : item.question_id;
          const parentId = q.parent_question_id || q.parent_tq_id;

          let gId = `q_${baseNum}`;
          if (parentId && String(parentId) !== 'null' && String(parentId).trim() !== '') {
            gId = `parent_${parentId}`;
          }

          if (!groupMap.has(gId)) {
            const newG = { id: gId, sort_order: item.sort_order, items: [] };
            groupMap.set(gId, newG);
            groups.push(newG);
          }
          groupMap.get(gId).items.push({
            ...item,
            parentId: parentId,
            question_number: q.question_number,
            sub_num: q.sub_num || 0,
            questionContent: q.question,
            imageUrl: q.image_url,
            answerContent: q.answer
          });
        });

        groups.forEach(g => {
          g.sort_order = Math.min(...g.items.map((i:any) => i.sort_order));
          g.items.sort((a:any, b:any) => {
            const subA = a.sub_num || 0;
            const subB = b.sub_num || 0;
            if (a.question_id === a.parentId || subA === 0) return -1;
            if (b.question_id === b.parentId || subB === 0) return 1;
            return subA - subB;
          });
        });
        groups.sort((a, b) => a.sort_order - b.sort_order);

        const questionStatsArray: any[] = [];
        groups.forEach((g, gIdx) => {
          const logicalMainNum = gIdx + 1;
          const isMulti = g.items.length > 1;

          let maxScore = Math.max(...g.items.map((i:any) => parseFloat(i.assigned_score) || 0));
          if (isNaN(maxScore) || maxScore === 0) maxScore = 100 / groups.length;
          const subScore = maxScore / g.items.length;

          g.items.forEach((item: any, subIdx: number) => {
            const logicalNumber = isMulti ? `${logicalMainNum}-${subIdx + 1}` : `${logicalMainNum}`;
            let totalCount = 0;
            let correctCount = 0;

            allAnswers.forEach(ans => {
              if (String(ans.question_id) === String(item.question_id)) {
                totalCount += 1;
                const isCor = ans.is_correct === true || String(ans.is_correct).toLowerCase() === 'true';
                const earned = parseFloat(ans.earned_score) || 0;
                
                if (isCor || earned >= (subScore - 0.01)) {
                  correctCount += 1;
                }
              }
            });

            const rate = totalCount > 0 ? (correctCount / totalCount) * 100 : 0;

            questionStatsArray.push({
              questionId: item.question_id,
              logicalNumber,
              assignedScore: subScore,
              correctRate: rate,
              totalCount,
              correctCount,
              questionContent: item.questionContent,
              imageUrl: item.imageUrl,
              answerContent: item.answerContent
            });
          });
        });

        const totalStudents = filteredAssigns.length;
        const totalScoreSum = filteredAssigns.reduce((acc, cur) => acc + (Number(cur.total_score) || 0), 0);
        const averageScore = totalStudents > 0 ? (totalScoreSum / totalStudents).toFixed(1) : "0.0";
        const highestScore = totalStudents > 0 ? Math.max(...filteredAssigns.map(a => Number(a.total_score) || 0)) : 0;

        const studentStatsList = filteredAssigns.map((a: any) => {
          const st = Array.isArray(a.student) ? a.student[0] : a.student;
          return {
            assignmentId: a.assignment_id,
            studentName: st?.name || "알 수 없음",
            grade: st?.grade || "-",
            totalScore: Number(a.total_score || 0)
          };
        }).sort((a, b) => b.totalScore - a.totalScore);

        setReportStats({
          summary: { totalStudents, averageScore, highestScore },
          questionStats: questionStatsArray,
          studentList: studentStatsList
        });

      } catch (err: any) {
        alert("데이터 연산 중 오류 발생: " + err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDetailedStats();
  }, [selectedExamId, excludeTest]);

  const semesterStats = useMemo(() => {
    const map = new Map();
    let filtered = examAssignments;
    
    if (excludeTest) {
      filtered = filtered.filter((a: any) => {
        const name = Array.isArray(a.student) ? a.student[0]?.name : a.student?.name;
        return name && !name.includes('테스트') && !name.toLowerCase().includes('test');
      });
    }

    filtered.forEach((a: any) => {
      const em = Array.isArray(a.exam_master) ? a.exam_master[0] : a.exam_master;
      const match = em?.sub_title?.match(/\d+-\d+/);
      const sem = match ? match[0] : em?.sub_title;
      if (sem) {
        if (!map.has(sem)) map.set(sem, { sum: 0, count: 0 });
        map.get(sem).sum += Number(a.total_score || 0);
        map.get(sem).count += 1;
      }
    });

    return Array.from(map.entries()).map(([sem, data]) => ({
      semester: sem,
      average: data.count > 0 ? Number((data.sum / data.count).toFixed(1)) : 0
    })).sort((a, b) => a.semester.localeCompare(b.semester));
  }, [examAssignments, excludeTest]);

  useEffect(() => {
    if (!chartRef.current || semesterStats.length === 0) return;

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    chartInstance.current = new Chart(chartRef.current, {
      type: 'bar',
      data: {
        labels: semesterStats.map(s => s.semester),
        datasets: [{
          label: '학기 평균(점)',
          data: semesterStats.map(s => s.average),
          backgroundColor: semesterStats.map(s => s.semester === (examList.find(e => e.exam_id === selectedExamId)?.sub_title || '') ? '#10b981' : '#cbd5e1'),
          hoverBackgroundColor: '#059669',
          borderRadius: 6,
          barThickness: 24,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `평균: ${ctx.raw}점` } }
        },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { stepSize: 20, font: { weight: 'bold', size: 10 } } },
          x: { grid: { display: false }, ticks: { font: { weight: 'bold', size: 11 } } }
        }
      }
    });

    return () => {
      if (chartInstance.current) chartInstance.current.destroy();
    };
  }, [semesterStats, selectedExamId, examList]);

  // 🌟 2단 분할을 위한 데이터 슬라이싱 로직
  const midPoint = Math.ceil((reportStats?.questionStats?.length || 0) / 2);
  const leftStats = reportStats.questionStats.slice(0, midPoint);
  const rightStats = reportStats.questionStats.slice(midPoint);
  const splitStats = [leftStats, rightStats];

  if (isLoading && examList.length === 0) {
    return <div className="flex h-screen items-center justify-center font-bold text-slate-400">시스템 데이터 동기화 중...</div>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f1f5f9] w-full">
      <main className="flex-1 overflow-y-auto custom-scroll p-4 sm:p-8 relative">
        <div className="max-w-[1400px] w-full mx-auto relative pb-24 space-y-6">
          
          <div className="bg-[#002864] text-white p-6 rounded-2xl shadow-md flex justify-between items-center no-print shrink-0">
            <div>
              <button onClick={() => router.back()} className="text-white hover:text-blue-200 flex items-center gap-2 font-extrabold text-sm mb-3 transition-colors bg-blue-900/40 px-3 py-1.5 rounded-lg border border-blue-800/50 w-fit shadow-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg> 뒤로가기
              </button>
              <h1 className="text-2xl font-bold tracking-tight">📊 입학 진단평가 종합 대시보드</h1>
              <p className="text-blue-200 text-sm mt-1">학기별 성취도 추이와 문항별 정답률을 심층 분석합니다.</p>
            </div>
            
            <div className="flex items-center gap-4">
              <label className="flex items-center space-x-2 cursor-pointer bg-blue-900/50 px-3 py-2.5 rounded-lg border border-blue-800 transition-colors hover:bg-blue-800/80 shadow-inner">
                <input 
                  type="checkbox" 
                  checked={excludeTest} 
                  onChange={(e) => setExcludeTest(e.target.checked)} 
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
                <span className="text-sm font-bold text-blue-100">테스트 계정 제외</span>
              </label>

              <div className="bg-blue-900/50 p-2 rounded-lg border border-blue-800 flex items-center gap-3 shadow-inner">
                <span className="pl-2 text-sm font-bold text-blue-200">대상 시험지</span>
                <select 
                  value={selectedExamId} 
                  onChange={(e) => setSelectedExamId(e.target.value)}
                  className="bg-white text-slate-800 font-extrabold text-sm px-4 py-2 rounded-md outline-none cursor-pointer w-64 truncate shadow-sm focus:ring-2 focus:ring-emerald-500"
                >
                  {examList.length === 0 ? <option value="">분석 가능한 시험지가 없습니다.</option> : null}
                  {examList.map(exam => (
                    <option key={exam.exam_id} value={exam.exam_id}>
                      {exam.title} {exam.sub_title ? `[${exam.sub_title}]` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* 좌측 메인 영역 */}
            <div className="lg:col-span-2 space-y-6 flex flex-col">
              
              {/* 1. KPI 영역 */}
              <div className="grid grid-cols-3 gap-4 shrink-0">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-center items-center relative overflow-hidden transition-transform hover:-translate-y-1">
                  {excludeTest && <div className="absolute top-2 left-2 text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-bold border border-slate-200">필터 적용</div>}
                  <span className="text-slate-500 font-bold text-sm mb-1">현재 시험지 응시 인원</span>
                  <span className="text-3xl font-black text-[#002864]">
                    {isLoading ? "-" : reportStats.summary?.totalStudents || 0} <span className="text-lg font-bold text-slate-400">명</span>
                  </span>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-center items-center transition-transform hover:-translate-y-1">
                  <span className="text-slate-500 font-bold text-sm mb-1">현재 시험지 평균</span>
                  <span className="text-3xl font-black text-emerald-600">
                    {isLoading ? "-" : reportStats.summary?.averageScore || 0} <span className="text-lg font-bold text-slate-400">점</span>
                  </span>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-center items-center transition-transform hover:-translate-y-1">
                  <span className="text-slate-500 font-bold text-sm mb-1">현재 시험지 최고점</span>
                  <span className="text-3xl font-black text-rose-500">
                    {isLoading ? "-" : reportStats.summary?.highestScore || 0} <span className="text-lg font-bold text-slate-400">점</span>
                  </span>
                </div>
              </div>

              {/* 2. 차트 영역 (높이 축소 h-52) */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden shrink-0">
                <div className="bg-slate-50 border-b border-slate-200 py-3 px-4 flex items-center justify-between">
                  <h3 className="font-extrabold text-slate-800 text-[15px]">📊 전체 학기별 평균 추이</h3>
                  <span className="text-[10px] text-slate-400 font-bold bg-white px-2 py-1 rounded border border-slate-200 shadow-sm">현재 선택: 초록색</span>
                </div>
                <div className="w-full h-52 p-4 relative">
                  {semesterStats.length > 0 ? (
                    <canvas ref={chartRef}></canvas>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center font-bold text-slate-400 text-sm">표시할 데이터가 없습니다.</div>
                  )}
                </div>
              </div>

              {/* 3. 정답률 2단 분할 테이블 영역 */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
                <div className="bg-slate-50 border-b border-slate-200 py-3 px-4 flex justify-between items-center shrink-0">
                  <h3 className="font-extrabold text-slate-800 text-[15px]">📈 문항별 분할 배점 & 정답률</h3>
                  {isLoading && <span className="text-[11px] font-bold text-emerald-600 animate-pulse bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">업데이트 중...</span>}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                  {splitStats.map((statsChunk, colIdx) => (
                    <div key={colIdx} className="overflow-x-auto custom-scroll pb-2">
                      <table className="w-full text-left border-collapse min-w-max">
                        <thead className="bg-slate-100/40 text-slate-500 border-b border-slate-200 sticky top-0 z-10">
                          <tr>
                            {/* 🌟 공간 확보 및 줄바꿈 방지(whitespace-nowrap) 처리 */}
                            <th className="py-2.5 px-2 text-center font-bold text-[11px] w-[60px] whitespace-nowrap">문항</th>
                            <th className="py-2.5 px-2 text-center font-bold text-[11px] w-[50px] whitespace-nowrap">배점</th>
                            <th className="py-2.5 px-3 font-bold text-[11px] whitespace-nowrap">정답률 분포 시각화</th>
                            <th className="py-2.5 px-2 text-right font-bold text-[11px] w-[55px] pr-4 whitespace-nowrap">%</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {statsChunk.length === 0 && !isLoading ? (
                            <tr><td colSpan={4} className="p-6 text-center text-slate-400 font-bold text-xs">구성 문항이 없습니다.</td></tr>
                          ) : (
                            statsChunk.map((q, idx) => {
                              const rateColor = q.correctRate >= 70 ? 'bg-emerald-500' : q.correctRate >= 40 ? 'bg-amber-400' : 'bg-rose-500';
                              return (
                                <tr key={idx} className="hover:bg-blue-50/50 transition-colors">
                                  <td className="py-2.5 px-2 text-center border-r border-slate-100/50 whitespace-nowrap">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button onClick={() => setModalQ(q)} title="문제 보기" className="text-sm grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all hover:scale-125 active:scale-95 leading-none mt-0.5">
                                        🔍
                                      </button>
                                      <span className="font-extrabold text-slate-800 text-[13px] w-6 text-left">{q.logicalNumber}</span>
                                    </div>
                                  </td>
                                  {/* 🌟 텍스트 무조건 가로 출력 (whitespace-nowrap) */}
                                  <td className="py-2.5 px-2 text-center text-[12px] font-bold text-slate-500 bg-slate-50/40 whitespace-nowrap">
                                    {q.assignedScore.toFixed(1)}
                                  </td>
                                  <td className="py-2.5 px-3 align-middle">
                                    {/* 🌟 막대 최대 길이(max-w) 제한으로 과도한 늘어남 방지 */}
                                    <div className="w-full max-w-[150px] bg-slate-200 rounded-full h-[6px] relative group cursor-pointer shadow-inner">
                                      <div className={`${rateColor} h-[6px] rounded-full transition-all duration-700 ease-out shadow-sm`} style={{ width: `${q.correctRate}%` }}></div>
                                      <div className="hidden group-hover:flex absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-0.5 rounded shadow-md z-20 font-bold items-center gap-1">
                                        <span className="text-emerald-300">{q.correctCount}</span> / {q.totalCount}명
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-2 text-right pr-4 font-extrabold text-slate-800 text-[13px] whitespace-nowrap">
                                    {q.correctRate.toFixed(1)}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* 우측 랭킹 영역 */}
            <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-140px)] sticky top-6">
              <div className="bg-emerald-700 p-5 shrink-0 flex justify-between items-center shadow-sm z-10">
                <h3 className="font-bold text-white text-lg">🏆 전체 학생 랭킹</h3>
                <span className="bg-emerald-800 text-emerald-100 text-[11px] font-bold px-2.5 py-1 rounded-md border border-emerald-600 shadow-inner">고득점순</span>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scroll p-4 bg-slate-50">
                <div className="space-y-3">
                  {reportStats.studentList.length === 0 && !isLoading ? (
                    <div className="text-center text-slate-400 py-10 font-bold text-sm border-2 border-dashed border-slate-200 rounded-xl">해당 시험지의 응시자 기록이 없습니다.</div>
                  ) : (
                    reportStats.studentList.map((st, index) => (
                      <div key={st.assignmentId} className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between shadow-sm hover:border-emerald-400 hover:shadow-md transition-all group">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-black shrink-0 shadow-sm ${index < 3 ? 'bg-gradient-to-br from-amber-200 to-amber-100 text-amber-700 border border-amber-300' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                            {index + 1}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-slate-800 truncate text-[15px]">{st.studentName}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-bold mt-0.5">{st.grade}</span>
                          </div>
                        </div>
                        <div className="font-black text-xl text-emerald-600 shrink-0 ml-2 group-hover:scale-110 transition-transform origin-right">
                          {st.totalScore}<span className="text-[13px] text-slate-400 font-bold ml-0.5">점</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* 🔍 문항 상세 뷰 모달 */}
        {modalQ && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print animate-in fade-in zoom-in duration-200">
            <div className="bg-white w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0 shadow-sm">
                <h2 className="font-bold text-lg flex items-center gap-2"><span>🔍</span> 문항 {modalQ.logicalNumber} 상세 뷰어</h2>
                <button onClick={() => setModalQ(null)} className="text-white hover:text-rose-400 font-bold text-3xl leading-none transition-colors">&times;</button>
              </div>
              <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50 space-y-6">
                
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <h3 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center justify-between">
                    질문 내용
                    <span className="text-[11px] bg-slate-100 text-slate-600 px-2.5 py-1 rounded-md font-bold border border-slate-200 shadow-inner">배점: {modalQ.assignedScore.toFixed(1)}점</span>
                  </h3>
                  <div className="math-text text-slate-700 font-medium whitespace-pre-wrap leading-relaxed text-[15px]" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(modalQ.questionContent || '문제 텍스트가 없습니다.') }} />
                  {getCleanUrl(modalQ.imageUrl) && (
                    <img src={getCleanUrl(modalQ.imageUrl)} className="max-w-full mt-5 rounded-lg border border-slate-200 shadow-sm" alt="Question Image" />
                  )}
                </div>

                <div className="bg-blue-50/50 p-5 rounded-xl border border-blue-200 shadow-sm">
                  <h3 className="font-extrabold text-blue-800 border-b border-blue-200/50 pb-2 mb-3">정답</h3>
                  <div className="math-text text-blue-800 font-black text-[16px] whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(modalQ.answerContent || '정답 데이터가 없습니다.') }} />
                </div>

                <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-200 shadow-sm flex items-center justify-between">
                  <span className="font-bold text-emerald-800">이 문항의 현재 정답률</span>
                  <div className="flex flex-col items-end">
                    <span className="font-black text-emerald-600 text-2xl">{modalQ.correctRate.toFixed(1)}%</span>
                    <span className="text-xs font-bold text-emerald-800/60 mt-0.5">총 {modalQ.totalCount}명 중 {modalQ.correctCount}명 정답</span>
                  </div>
                </div>

              </div>
              <div className="p-4 bg-slate-100 border-t border-slate-200 flex justify-end shrink-0">
                <button onClick={() => setModalQ(null)} className="px-8 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg shadow-md transition-all hover:-translate-y-0.5">닫기</button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}