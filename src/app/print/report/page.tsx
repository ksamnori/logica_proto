// src/app/print/report/page.tsx
"use client";

import React, { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Chart from "chart.js/auto";

function PrintReportContent() {
  const searchParams = useSearchParams();
  const assignmentId = searchParams.get("assignment_id");

  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [reportData, setReportData] = useState<any>(null);

  // 차트 렌더링용 Refs
  const catChartRef = useRef<HTMLCanvasElement>(null);
  const diffChartRef = useRef<HTMLCanvasElement>(null);
  const cogLeftChartRef = useRef<HTMLCanvasElement>(null);
  const cogRightChartRef = useRef<HTMLCanvasElement>(null);
  const chartInstances = useRef<{ [key: string]: any }>({});

  const catMap: any = { '수와 연산': '수·연', '도형': '도형', '측정': '측정', '규칙성': '규칙', '확률과 통계': '확·통', '규칙과 논리': '논리' };

  useEffect(() => {
    if (assignmentId && assignmentId !== "null") {
      fetchReportData();
    } else {
      setErrorMsg("❌ assignment_id 값이 URL에 없습니다.");
      setIsLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    if (reportData && !isLoading) {
      renderCharts();
      // 데이터를 불러오고 차트가 그려진 후 0.5초 뒤에 자동으로 인쇄창을 띄우고 싶다면 아래 주석을 해제하세요.
      // setTimeout(() => window.print(), 500);
    }
    return () => {
      Object.values(chartInstances.current).forEach(chart => chart?.destroy());
    };
  }, [reportData, isLoading]);

  const fetchReportData = async () => {
    try {
      // 💡 406 에러의 주범이었던 .neq(cacheBuster) 로직을 모두 제거하고 순수 데이터 조회로 롤백했습니다.
      
      // 1. 기본 배정 정보 로드
      const { data: assign, error: aErr } = await supabase.from('exam_assignment')
        .select('*, student(name), exam_master(title, sub_title)')
        .eq('assignment_id', assignmentId)
        .single();
        
      if (aErr) throw new Error(`[기본 배정 정보 로드 실패]\n${aErr.message}`);

      // 2. 🌟 핵심: admission_test_report 스냅샷 가져오기
      const { data: reportSnap, error: snapErr } = await supabase.from('admission_test_report')
        .select('*')
        .eq('assignment_id', assignmentId)
        .single(); // 💡 .neq 조건 삭제. 없으면 자연스럽게 에러 캐치로 넘어감

      if (snapErr || !reportSnap) {
        throw new Error("저장된 분석 리포트가 없습니다. 이전 화면에서 [진단 리포트 생성하기]를 먼저 진행해주세요.");
      }

      const rawTitle = assign.exam_master?.title || '';
      const rawSub = assign.exam_master?.sub_title || '';
      const matchTag = rawSub.match(/\d+-\d+/) || rawTitle.match(/\d+-\d+/);
      const standardName = matchTag ? matchTag[0] : '4-2';
      
      const examPaperId = assign.exam_id || assign.exam_paper_id;
      if (!examPaperId) throw new Error("시험지 ID를 찾을 수 없습니다.");

      const studentName = Array.isArray(assign.student) ? assign.student[0]?.name : assign.student?.name || '알수없음';
      const reportDate = new Date(assign.created_at).toLocaleDateString('ko-KR');

      // 3. 런타임 Max 스코어 빌더
      const { data: meta } = await supabase.from('admission_standard_meta')
        .select('*')
        .eq('standard_name', standardName);

      let rBase = { max_geometry:0, max_measure:0, max_stat:0, max_rule:0, max_calc:0, max_calc_sense:0, max_spatial:0, max_logic:0, max_knowledge:0, max_thinking:0, max_persistence:0, max_diff_1:0, max_diff_2:0, max_diff_3:0, max_diff_4:0, max_diff_5:0, max_total_score:0 };
      const mData: any = {};
      
      if (meta) {
        meta.forEach((m: any) => {
          mData[m.question_number] = m;
          const s = parseFloat(m.assigned_score) || 0;
          rBase.max_total_score += s;
          
          if (m.math_category === '도형') rBase.max_geometry += s;
          else if (m.math_category === '측정') rBase.max_measure += s;
          else if (m.math_category === '확률과 통계') rBase.max_stat += s;
          else if (m.math_category === '규칙과 논리' || m.math_category === '규칙성') rBase.max_rule += s;
          else if (m.math_category === '수와 연산') rBase.max_calc += s;
          
          if (m.is_calc_sense) rBase.max_calc_sense += s;
          if (m.is_spatial_perception) rBase.max_spatial += s;
          if (m.is_logical_reasoning) rBase.max_logic += s;
          if (m.is_background_knowledge) rBase.max_knowledge += s;
          if (m.is_thinking_ability) rBase.max_thinking += s;
          if (m.is_task_persistence) rBase.max_persistence += s;
          
          const d = m.difficulty_level;
          if(d===1) rBase.max_diff_1 += s; else if(d===2) rBase.max_diff_2 += s; else if(d===3) rBase.max_diff_3 += s; else if(d===4) rBase.max_diff_4 += s; else if(d===5) rBase.max_diff_5 += s;
        });
      }

      // 4. 학생 답안 및 O/X 테이블 구성
      const { data: items } = await supabase.from('exam_item').select('*').eq('exam_id', examPaperId).order('sort_order');
      const { data: answers } = await supabase.from('student_answer')
        .select('*')
        .eq('exam_assignment_id', assignmentId);

      const qIds = (items || []).map((i: any) => i.question_id);
      const uuidIds = qIds.filter((id: any) => typeof id === 'string' && id.includes('-'));
      const numIds = qIds.filter((id: any) => typeof id === 'number' || (typeof id === 'string' && !id.includes('-') && !isNaN(Number(id)))).map(Number);
      
      let fetchedQuestions: any[] = [];
      if (uuidIds.length > 0) {
        const { data: qDbData } = await supabase.from('question_db').select('question_id, parent_question_id, pdf_source, detected_page_num, final_printed_page, question_number').in('question_id', uuidIds);
        if (qDbData) fetchedQuestions.push(...qDbData);
      }
      const foundUuids = fetchedQuestions.map((q: any) => q.question_id);
      const missingUuids = uuidIds.filter((id: any) => !foundUuids.includes(id));
      
      if (missingUuids.length > 0) {
        const { data: tqUuidData } = await supabase.from('textbook_question').select('question_id, parent_tq_id, pdf_source, detected_page_num, final_printed_page, question_number').in('question_id', missingUuids);
        if (tqUuidData) fetchedQuestions.push(...tqUuidData);
      }
      if (numIds.length > 0) {
        const { data: numData } = await supabase.from('textbook_question').select('tq_id, parent_tq_id, pdf_source, detected_page_num, final_printed_page, question_number').in('tq_id', numIds);
        if (numData) fetchedQuestions.push(...numData);
      }
      const qMap: any = {};
      fetchedQuestions.forEach((q: any) => {
        if (q.question_id) qMap[String(q.question_id)] = q;
        if (q.tq_id) qMap[String(q.tq_id)] = q; 
      });

      const groupMap = new Map(); const groups: any[] = [];
      (items || []).forEach((item: any) => {
        const q = qMap[String(item.question_id)] || {};
        const ans = (answers || []).find((a: any) => String(a.question_id) === String(item.question_id));
        const src = String(q.pdf_source || 'UNKNOWN'); 
        const page = String(q.detected_page_num || q.final_printed_page || 'U');
        const baseNum = String(q.question_number || '').match(/\d+/) ? String(q.question_number).match(/\d+/)?.[0] : q.question_id; 
        
        let gId = `${src}_${page}_${baseNum}`;
        const parentId = q.parent_question_id || q.parent_tq_id;
        if (parentId && String(parentId) !== 'null' && String(parentId).trim() !== '') { gId = `${src}_${page}_${parentId}`; }

        if (!groupMap.has(gId)) {
          const newG = { id: gId, sort_order: item.sort_order, items: [] };
          groupMap.set(gId, newG); groups.push(newG);
        }
        groupMap.get(gId).items.push({ sort_order: item.sort_order, assigned_score: item.assigned_score, question: q, answer: ans || {earned_score: 0, grading_code: null}, question_id: item.question_id });
      });

      groups.forEach((g: any) => { g.sort_order = Math.min(...g.items.map((i: any) => i.sort_order)); });
      groups.sort((a, b) => a.sort_order - b.sort_order);

      // O/X 테이블용 sData 매핑 및 정답 갯수 카운트
      let correct_cnt = 0;
      const sData: any = {};

      groups.forEach((g: any, index: number) => {
        const logicalQNum = index + 1;
        const m = mData[logicalQNum];
        let maxScore = m ? parseFloat(m.assigned_score) : Math.max(...g.items.map((i: any) => parseFloat(i.assigned_score) || 0));
        if (maxScore === 0) maxScore = 100/30;

        let groupEarned = 0;
        g.items.forEach((i: any) => {
          groupEarned += parseFloat(i.answer?.earned_score || 0);
        });
        
        sData[logicalQNum] = { earned_score: groupEarned, max_score: maxScore, meta: m };

        if (groupEarned > 0 && groupEarned >= (maxScore - 0.01)) {
          correct_cnt++;
        }
      });

      // 5. 🌟 스냅샷 기반으로 학생 스탯 완벽 매핑 (재계산 금지)
      const stats = { 
        geo: reportSnap.score_geometry, mea: reportSnap.score_measure, stat: reportSnap.score_stat, 
        rule: reportSnap.score_rule, calc: reportSnap.score_calc, sense: reportSnap.score_calc_sense, 
        space: reportSnap.score_spatial_percep, logic: reportSnap.score_logical_reason, 
        know: reportSnap.score_knowledge, think: reportSnap.score_thinking, persist: reportSnap.score_persistence, 
        d1: reportSnap.score_diff_1, d2: reportSnap.score_diff_2, d3: reportSnap.score_diff_3, 
        d4: reportSnap.score_diff_4, d5: reportSnap.score_diff_5, total: reportSnap.total_score, 
        correct_cnt 
      };

      // 6. 평균 산출
      let avgStats = { geo: 0, mea: 0, stat: 0, rule: 0, calc: 0, sense: 0, space: 0, logic: 0, know: 0, think: 0, persist: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, total: 0 };
      
      let { data: allAssignments } = await supabase.from('exam_assignment').select('assignment_id').eq('exam_id', examPaperId);
      if (!allAssignments) {
        const res = await supabase.from('exam_assignment').select('assignment_id').eq('exam_paper_id', examPaperId);
        allAssignments = res.data;
      }
      
      if (allAssignments && allAssignments.length > 0) {
        const assignIds = allAssignments.map((a: any) => a.assignment_id);
        const { data: allAnswers } = await supabase.from('student_answer')
          .select('exam_assignment_id, question_id, earned_score')
          .in('exam_assignment_id', assignIds)
          .limit(10000);
        
        if (allAnswers && allAnswers.length > 0) {
          const activeAssignIds = assignIds.filter(aId => allAnswers.some((ans: any) => ans.exam_assignment_id === aId));
          
          activeAssignIds.forEach(aId => {
            let sStat = { geo:0, mea:0, stat:0, rule:0, calc:0, sense:0, space:0, logic:0, know:0, think:0, persist:0, d1:0, d2:0, d3:0, d4:0, d5:0, total:0 };
            
            groups.forEach((g: any, index: number) => {
              const logicalQNum = index + 1;
              const m = mData[logicalQNum];
              
              let groupEarned = 0;
              g.items.forEach((i: any) => {
                const ans = allAnswers.find((x: any) => x.exam_assignment_id === aId && String(x.question_id) === String(i.question_id));
                groupEarned += parseFloat(ans?.earned_score || 0);
              });

              if (m) {
                sStat.total += groupEarned;
                if (m.math_category === '도형') sStat.geo += groupEarned;
                else if (m.math_category === '측정') sStat.mea += groupEarned;
                else if (m.math_category === '확률과 통계') sStat.stat += groupEarned;
                else if (m.math_category === '규칙과 논리' || m.math_category === '규칙성') sStat.rule += groupEarned;
                else if (m.math_category === '수와 연산') sStat.calc += groupEarned;

                if (m.is_calc_sense) sStat.sense += groupEarned;
                if (m.is_spatial_perception) sStat.space += groupEarned;
                if (m.is_logical_reasoning) sStat.logic += groupEarned;
                if (m.is_background_knowledge) sStat.know += groupEarned;
                if (m.is_thinking_ability) sStat.think += groupEarned;
                if (m.is_task_persistence) sStat.persist += groupEarned;

                const d = m.difficulty_level;
                if(d===1) sStat.d1 += groupEarned; else if(d===2) sStat.d2 += groupEarned; else if(d===3) sStat.d3 += groupEarned; else if(d===4) sStat.d4 += groupEarned; else if(d===5) sStat.d5 += groupEarned;
              }
            });
            
            for(let k in avgStats) (avgStats as any)[k] += (sStat as any)[k];
          });
          
          const cnt = activeAssignIds.length;
          if (cnt > 0) {
            for(let k in avgStats) (avgStats as any)[k] = parseFloat(((avgStats as any)[k] / cnt).toFixed(1));
          }
        }
      }

      // 7. 코멘트 등 스냅샷 데이터 활용
      const evalComment = reportSnap.final_comment || '분석된 종합 평가 결과가 없습니다.';
      const getPct = (earned: number, max: number) => (!max || max === 0) ? 0 : Math.round((earned / max) * 100);
      const totalPct = getPct(stats.total, rBase.max_total_score);

      const getUmathClass = (pct: number) => {
        if (pct >= 90) return 'Ultimate<br><span class="text-[11px] font-normal text-amber-100">(최상위 영재반)</span>';
        if (pct >= 80) return 'Master<br><span class="text-[11px] font-normal text-amber-100">(심화 사고력반)</span>';
        if (pct >= 65) return 'Apex<br><span class="text-[11px] font-normal text-amber-100">(응용 심화반)</span>';
        if (pct >= 50) return 'Titan<br><span class="text-[11px] font-normal text-amber-100">(개념 응용반)</span>';
        return 'Horizon<br><span class="text-[11px] font-normal text-amber-100">(기초 탄탄반)</span>';
      };

      const catPcts = [
        { name: '수와 연산', pct: getPct(stats.calc, rBase.max_calc) },
        { name: '도형', pct: getPct(stats.geo, rBase.max_geometry) },
        { name: '측정', pct: getPct(stats.mea, rBase.max_measure) },
        { name: '규칙', pct: getPct(stats.rule, rBase.max_rule) },
        { name: '확률과 통계', pct: getPct(stats.stat, rBase.max_stat) }
      ].sort((a, b) => b.pct - a.pct); 
      
      let bestCat = '-'; let worstCat = '-';
      if (catPcts[0].pct === 0) { bestCat = '-'; worstCat = '전 영역 기초 부족'; } 
      else if (catPcts[0].pct === 100 && catPcts[4].pct === 100) { bestCat = '전 영역 만점 🏆'; worstCat = '취약점 없음 ✨'; } 
      else if (catPcts[0].pct === catPcts[4].pct) { bestCat = '전 영역 고른 성취'; worstCat = '특이 취약점 없음'; } 
      else { bestCat = catPcts[0].name; worstCat = catPcts[4].name; }

      setReportData({
        studentName, standardName, reportDate,
        totalScore: parseFloat(stats.total.toFixed(1)), correctCount: stats.correct_cnt,
        avgTotalScore: parseFloat(avgStats.total.toFixed(1)),
        recommendedClass: getUmathClass(totalPct),
        bestCat, worstCat, evalComment,
        sData, stats, avgStats, rBase
      });
      setIsLoading(false);

    } catch (e: any) {
      setErrorMsg(e.message);
      setIsLoading(false);
    }
  };

  const renderCharts = () => {
    if (!reportData) return;
    const { stats: st, avgStats: avg, rBase: base } = reportData;
    const getPct = (earned: number, max: number) => (!max || max === 0) ? 0 : Math.round((earned / max) * 100);

    Chart.defaults.font.family = "'Pretendard', sans-serif"; 
    Chart.defaults.font.weight = 'bold';

    if (catChartRef.current) {
      if (chartInstances.current.cat) chartInstances.current.cat.destroy();
      chartInstances.current.cat = new Chart(catChartRef.current, {
        type: 'bar',
        data: {
          labels: ['수·연', '도형', '측정', '규칙', '확·통'], 
          datasets: [
            { label: '학생', data: [ getPct(st.calc, base.max_calc), getPct(st.geo, base.max_geometry), getPct(st.mea, base.max_measure), getPct(st.rule, base.max_rule), getPct(st.stat, base.max_stat) ], backgroundColor: '#1e493b', borderRadius: 4, barThickness: 12 },
            { label: '평균', data: [ getPct(avg.calc, base.max_calc), getPct(avg.geo, base.max_geometry), getPct(avg.mea, base.max_measure), getPct(avg.rule, base.max_rule), getPct(avg.stat, base.max_stat) ], backgroundColor: '#94a3b8', borderRadius: 4, barThickness: 12 }
          ]
        },
        options: { devicePixelRatio: 4, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { min: 0, max: 100, ticks: { stepSize: 25, font: { size: 9 } } }, x: { ticks: { font: { size: 10, weight: 'bold' } } } } }
      });
    }

    if (diffChartRef.current) {
      if (chartInstances.current.diff) chartInstances.current.diff.destroy();
      chartInstances.current.diff = new Chart(diffChartRef.current, {
        type: 'bar',
        data: {
          labels: ['Lv 1', 'Lv 2', 'Lv 3', 'Lv 4', 'Lv 5'],
          datasets: [
            { label: '학생', data: [ getPct(st.d1, base.max_diff_1), getPct(st.d2, base.max_diff_2), getPct(st.d3, base.max_diff_3), getPct(st.d4, base.max_diff_4), getPct(st.d5, base.max_diff_5) ], backgroundColor: '#0f172a', borderRadius: 4, barThickness: 12 },
            { label: '평균', data: [ getPct(avg.d1, base.max_diff_1), getPct(avg.d2, base.max_diff_2), getPct(avg.d3, base.max_diff_3), getPct(avg.d4, base.max_diff_4), getPct(avg.d5, base.max_diff_5) ], backgroundColor: '#94a3b8', borderRadius: 4, barThickness: 12 }
          ]
        },
        options: { devicePixelRatio: 4, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { min: 0, max: 100, ticks: { stepSize: 25, font: { size: 9 } } }, x: { ticks: { font: { size: 10, weight: 'bold' } } } } }
      });
    }

    const radarOptions: any = { devicePixelRatio: 4, responsive: true, maintainAspectRatio: false, scales: { r: { min: 0, max: 100, ticks: { display: false }, pointLabels: { font: { size: 12, weight: '900' }, color: '#1e293b' } } }, plugins: { legend: { display: false } } };

    if (cogLeftChartRef.current) {
      if (chartInstances.current.left) chartInstances.current.left.destroy();
      chartInstances.current.left = new Chart(cogLeftChartRef.current, {
        type: 'radar',
        data: {
          labels: ['수 감각', '공간지각력', '논리추론'],
          datasets: [
            { label: '학생(%)', data: [ getPct(st.sense, base.max_calc_sense), getPct(st.space, base.max_spatial), getPct(st.logic, base.max_logic) ], backgroundColor: 'rgba(30, 73, 59, 0.4)', borderColor: '#1e493b', pointBackgroundColor: '#122e25', borderWidth: 2, pointRadius: 3 },
            { label: '평균(%)', data: [ getPct(avg.sense, base.max_calc_sense), getPct(avg.space, base.max_spatial), getPct(avg.logic, base.max_logic) ], backgroundColor: 'transparent', borderColor: '#f59e0b', borderDash: [6, 4], borderWidth: 3, pointBackgroundColor: '#f59e0b', pointRadius: 1.5 }
          ]
        },
        options: radarOptions
      });
    }

    if (cogRightChartRef.current) {
      if (chartInstances.current.right) chartInstances.current.right.destroy();
      chartInstances.current.right = new Chart(cogRightChartRef.current, {
        type: 'radar',
        data: {
          labels: ['배경지식', '사고력', '과제집착력'],
          datasets: [
            { label: '학생(%)', data: [ getPct(st.know, base.max_knowledge), getPct(st.think, base.max_thinking), getPct(st.persist, base.max_persistence) ], backgroundColor: 'rgba(51, 65, 85, 0.3)', borderColor: '#334155', pointBackgroundColor: '#0f172a', borderWidth: 2, pointRadius: 3 },
            { label: '평균(%)', data: [ getPct(avg.know, base.max_knowledge), getPct(avg.think, base.max_thinking), getPct(avg.persist, base.max_persistence) ], backgroundColor: 'transparent', borderColor: '#f59e0b', borderDash: [6, 4], borderWidth: 3, pointBackgroundColor: '#f59e0b', pointRadius: 1.5 }
          ]
        },
        options: radarOptions
      });
    }
  };

  const renderQTable = (start: number, end: number) => {
    if (!reportData) return null;
    const cols = [];
    for (let i = start; i <= end; i++) cols.push(i);

    return (
      <table className="w-full table-fixed border-collapse">
        <tbody>
          <tr>
            <td className="border border-slate-300 text-center p-1 text-xs font-bold bg-slate-50 text-slate-700 w-[12%]">구분</td>
            {cols.map(i => <td key={i} className="border border-slate-300 text-center p-1 text-xs font-bold bg-slate-50 text-slate-700 w-[5.8%]">{i}</td>)}
          </tr>
          <tr>
            <td className="border border-slate-300 text-center p-1 text-xs font-bold bg-slate-50 text-slate-700">수학영역</td>
            {cols.map(i => <td key={i} className="border border-slate-300 text-center p-1 text-[10px] text-slate-500 tracking-tighter">{catMap[reportData.sData[i]?.meta?.math_category] || '-'}</td>)}
          </tr>
          <tr>
            <td className="border border-slate-300 text-center p-1 text-xs font-bold bg-slate-50 text-slate-700">난이도</td>
            {cols.map(i => <td key={i} className="border border-slate-300 text-center p-1 text-[10px] text-slate-600 font-bold">L{reportData.sData[i]?.meta?.difficulty_level || '-'}</td>)}
          </tr>
          <tr>
            <td className="border border-slate-300 text-center p-1 text-xs font-bold bg-slate-50 text-slate-700">결과</td>
            {cols.map(i => {
              const ans = reportData.sData[i];
              const score = ans ? (parseFloat(ans.earned_score) || 0) : 0;
              const max = ans?.meta ? parseFloat(ans.meta.assigned_score) : 0;
              let isCorStatus = 'X';
              if (score > 0) {
                if (max > 0 && score >= max - 0.01) isCorStatus = 'O';
                else isCorStatus = 'TRI';
              }
              if (isCorStatus === 'O') return <td key={i} className="border border-slate-300 text-center p-1 text-[1.1rem] font-black text-[#10b981] bg-emerald-50/50">○</td>;
              else if (isCorStatus === 'TRI') return <td key={i} className="border border-slate-300 text-center p-1 text-[1rem] font-black text-[#f59e0b] bg-amber-50/50">△</td>;
              return <td key={i} className="border border-slate-300 text-center p-1 text-[1.1rem] font-black text-[#ef4444] bg-red-50/50">×</td>;
            })}
          </tr>
        </tbody>
      </table>
    );
  };

  const getPct = (earned: number, max: number) => (!max || max === 0) ? 0 : Math.round((earned / max) * 100);
  const getTraitLevel = (pct: number) => { if (pct >= 80) return '탁월'; if (pct >= 60) return '양호'; return '도약'; };

  const renderDetailRow = (name: string, earned: number, avgScore: number, max: number) => (
    <tr key={name}>
      <td className="py-1.5 bg-white text-slate-700">{name}</td>
      <td className="py-1.5 bg-white text-slate-400 font-medium">{max}</td>
      <td className="py-1.5 bg-white text-slate-400 font-medium">{avgScore}</td>
      <td className="py-1.5 bg-[#1e493b]/5 text-[#1e493b] font-black">{parseFloat(earned.toFixed(1))}</td>
      <td className="py-1.5 bg-white text-emerald-600">{getPct(earned, max)}%</td>
    </tr>
  );

  const renderCogRow = (name: string, pct: number) => {
    const studentLv = getTraitLevel(pct);
    let lvStyle = studentLv === '탁월' ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : (studentLv === '양호' ? 'text-blue-600 bg-blue-50 border-blue-200' : 'text-amber-600 bg-amber-50 border-amber-200');
    return (
      <tr key={name}>
        <td className="py-2.5 text-left border-b border-slate-100 flex items-center gap-2 px-2"><div className="w-1.5 h-1.5 rounded-full bg-[#1e493b]/60"></div> {name}</td>
        <td className="py-2.5 text-center border-b border-slate-100 font-black text-[#1e493b] text-sm">{pct}%</td>
        <td className="py-2.5 text-center border-b border-slate-100 px-2"><span className={`w-full block py-1 rounded border text-[11px] font-black ${lvStyle}`}>{studentLv}</span></td>
      </tr>
    );
  };

  return (
    <div className="min-h-screen w-full bg-[#e2e8f0] flex flex-col items-center custom-scroll">
      
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page { size: A4; margin: 0; }
          html, body { 
            background: white !important; 
            margin: 0 !important; 
            padding: 0 !important;
            height: auto !important;
            min-height: auto !important;
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important; 
          }
          
          .min-h-screen { 
            background: white !important; 
            padding: 0 !important; 
            margin: 0 !important;
            min-height: 0 !important;
            height: auto !important;
            display: block !important; 
          }

          .no-print { display: none !important; }

          .a4-page { 
            width: 210mm !important; 
            height: 297mm !important; 
            margin: 0 !important; 
            padding: 10mm 15mm !important; 
            box-sizing: border-box !important;
            box-shadow: none !important; 
            border: none !important; 
            page-break-after: always !important; 
            break-after: page !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            overflow: hidden !important;
          }
          
          .a4-page:last-of-type {
            page-break-after: auto !important;
            break-after: auto !important;
          }
        }

        .a4-page { 
          width: 210mm; 
          min-height: 297mm; 
          background: white; 
          margin: 2rem auto; 
          padding: 12mm 18mm; 
          box-sizing: border-box; 
          box-shadow: 0 10px 25px rgba(0,0,0,0.1); 
          display: flex; 
          flex-direction: column; 
        }
      `}} />

      {/* 플로팅 액션 버튼 */}
      <div className="fixed bottom-8 right-8 z-50 flex items-center gap-3 no-print">
        <button onClick={() => window.print()} className="bg-[#1e493b] hover:bg-[#122e25] text-white font-extrabold px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 transition-transform transform hover:scale-105">
          🖨️ 리포트 인쇄 (PDF)
        </button>
        <button onClick={() => window.close()} className="bg-slate-700 hover:bg-slate-900 text-white font-extrabold px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 transition-transform transform hover:scale-105">
          ✖ 창닫기
        </button>
      </div>

      {/* 로딩 상태 화면 */}
      {isLoading && (
        <div className="fixed inset-0 bg-white z-[10000] flex flex-col items-center justify-center no-print">
          {errorMsg ? (
            <div className="bg-red-50 border border-red-200 p-8 rounded-2xl max-w-2xl text-center shadow-lg">
              <h2 className="text-2xl font-black text-red-600 mb-4">🚨 리포트 생성 중단</h2>
              <p className="text-slate-500 text-sm bg-white p-4 rounded border border-slate-200 whitespace-pre-wrap font-mono text-left">{errorMsg}</p>
              <button onClick={() => window.close()} className="mt-6 px-6 py-2 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-900 shadow-sm">창 닫기</button>
            </div>
          ) : (
            <>
              <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-[#1e493b] mb-4"></div>
              <h2 className="text-xl font-bold text-slate-700">데이터를 분석하여 완벽한 인쇄용 페이지를 생성 중입니다...</h2>
            </>
          )}
        </div>
      )}

      {/* 분석 결과 데이터 렌더링 영역 */}
      {reportData && (
        <>
          {/* 첫 번째 A4 페이지 */}
          <div className="a4-page relative">
            <header className="border-b-[3px] border-[#1e493b] pb-3 mb-5 flex justify-between items-end shrink-0">
              <div>
                <h1 className="text-[34px] font-black text-[#1e493b] tracking-tight leading-none flex items-center gap-3">
                  <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica 로고" className="h-8 object-contain" />
                  <span className="font-light">진단평가 분석 결과</span>
                </h1>
                <p className="text-slate-500 font-bold mt-1.5 text-sm">{reportData.reportDate}</p>
              </div>
              <div className="text-right flex flex-col items-end">
                <div className="text-xl font-extrabold text-slate-800"><span className="text-[#1e493b] text-2xl">{reportData.studentName}</span> 학생</div>
                <div className="text-xs font-bold text-slate-500 mt-1">평가 기준: <span className="bg-[#1e493b]/10 text-[#1e493b] px-2 py-0.5 rounded ml-1">{reportData.standardName}</span></div>
              </div>
            </header>

            <main className="flex-1 flex flex-col gap-5">
              <section className="shrink-0">
                <h2 className="text-lg font-black text-slate-800 mb-2 border-b-2 border-slate-800 pb-1.5 flex items-center gap-2">문항별 상세 채점 결과</h2>
                <div className="w-full overflow-hidden border border-slate-300 rounded mb-3">{renderQTable(1, 15)}</div>
                <div className="w-full overflow-hidden border border-slate-300 rounded">{renderQTable(16, 30)}</div>
              </section>

              <section className="grid grid-cols-12 gap-4 flex-1">
                <div className="col-span-3 bg-gradient-to-br from-[#1e493b] to-[#0f251d] text-white rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-5 rounded-full -mr-10 -mt-10"></div>
                  <div className="px-1 text-center w-full">
                    <span className="text-[13px] font-bold text-emerald-100/70 block mb-1">Logica 진단평가</span>
                    <span className="text-base font-black text-white block">최종 종합 점수</span>
                  </div>
                  
                  <div className="my-4 flex justify-center items-baseline whitespace-nowrap w-full">
                    <span className="text-[44px] font-black leading-none drop-shadow-md tracking-tighter">
                      {reportData.totalScore}
                    </span>
                    <span className="text-lg font-bold ml-1.5 tracking-normal text-emerald-100/80">
                      점
                    </span>
                  </div>
                  
                  <div className="space-y-1.5 mt-auto relative z-10 w-full">
                    <div className="flex justify-between items-center bg-white/10 px-2 py-1.5 rounded-lg backdrop-blur-sm gap-2">
                      <span className="text-[11px] font-bold text-emerald-100/90 whitespace-nowrap flex-shrink-0">응시자 평균</span>
                      <span className="text-xs font-black text-white whitespace-nowrap truncate text-right">{reportData.avgTotalScore}점</span>
                    </div>
                    
                    <div className="flex flex-col items-center bg-amber-500/20 px-2 py-2 rounded-lg backdrop-blur-sm border border-amber-400/30 gap-1 my-2">
                      <span className="text-[13px] font-bold text-amber-200 text-center w-full block">💡 Logica 클래스</span>
                      <span dangerouslySetInnerHTML={{ __html: reportData.recommendedClass }} className="text-[14px] font-black text-white text-center w-full leading-tight block" />
                    </div>

                    <div className="flex justify-between items-center bg-white/10 px-2 py-1.5 rounded-lg backdrop-blur-sm gap-2">
                      <span className="text-[11px] font-bold text-emerald-100/90 whitespace-nowrap flex-shrink-0">정답 문항 수</span>
                      <span className="text-xs font-black text-white whitespace-nowrap truncate text-right">{reportData.correctCount} / 30</span>
                    </div>
                    <div className="flex flex-col bg-white/10 px-2 py-2 rounded-lg backdrop-blur-sm border-t border-white/10 gap-1 mt-1">
                      <span className="text-[11px] font-bold text-emerald-100/90">🏆 최우수 영역</span>
                      <span className="text-[12px] font-black text-amber-300 text-right w-full">{reportData.bestCat}</span>
                    </div>
                    <div className="flex flex-col bg-white/10 px-2 py-2 rounded-lg backdrop-blur-sm gap-1">
                      <span className="text-[11px] font-bold text-emerald-100/90">🔧 보완 영역</span>
                      <span className="text-[12px] font-black text-rose-300 text-right w-full">{reportData.worstCat}</span>
                    </div>
                  </div>
                </div>

                <div className="col-span-9 grid grid-cols-2 gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col">
                    <h3 className="text-sm font-extrabold text-slate-800 mb-3 text-center bg-slate-50 py-1.5 rounded">수학 내용 영역별 분석</h3>
                    <table className="w-full text-[11px] text-center border-collapse mb-3">
                      <thead className="bg-slate-100 text-slate-600 border-y border-slate-300">
                        <tr><th className="py-1">영역</th><th className="py-1">만점</th><th className="py-1">평균</th><th className="py-1 text-[#1e493b]">획득</th><th className="py-1 text-emerald-600">성취율</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                        {renderDetailRow('수와 연산', reportData.stats.calc, reportData.avgStats.calc, reportData.rBase.max_calc)}
                        {renderDetailRow('도형', reportData.stats.geo, reportData.avgStats.geo, reportData.rBase.max_geometry)}
                        {renderDetailRow('측정', reportData.stats.mea, reportData.avgStats.mea, reportData.rBase.max_measure)}
                        {renderDetailRow('규칙성', reportData.stats.rule, reportData.avgStats.rule, reportData.rBase.max_rule)}
                        {renderDetailRow('확률과 통계', reportData.stats.stat, reportData.avgStats.stat, reportData.rBase.max_stat)}
                      </tbody>
                    </table>
                    <div className="flex-1 relative min-h-[140px] mt-auto w-full"><canvas ref={catChartRef}></canvas></div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col">
                    <h3 className="text-sm font-extrabold text-slate-800 mb-3 text-center bg-slate-50 py-1.5 rounded">문항 난이도별 분석</h3>
                    <table className="w-full text-[11px] text-center border-collapse mb-3">
                      <thead className="bg-slate-100 text-slate-600 border-y border-slate-300">
                        <tr><th className="py-1">단계</th><th className="py-1">만점</th><th className="py-1">평균</th><th className="py-1 text-[#1e493b]">획득</th><th className="py-1 text-emerald-600">성취율</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                        {renderDetailRow('Level 1', reportData.stats.d1, reportData.avgStats.d1, reportData.rBase.max_diff_1)}
                        {renderDetailRow('Level 2', reportData.stats.d2, reportData.avgStats.d2, reportData.rBase.max_diff_2)}
                        {renderDetailRow('Level 3', reportData.stats.d3, reportData.avgStats.d3, reportData.rBase.max_diff_3)}
                        {renderDetailRow('Level 4', reportData.stats.d4, reportData.avgStats.d4, reportData.rBase.max_diff_4)}
                        {renderDetailRow('Level 5', reportData.stats.d5, reportData.avgStats.d5, reportData.rBase.max_diff_5)}
                      </tbody>
                    </table>
                    <div className="flex-1 relative min-h-[140px] mt-auto w-full"><canvas ref={diffChartRef}></canvas></div>
                  </div>
                </div>
              </section>
            </main>
            <footer className="mt-4 pt-3 border-t border-slate-200 text-center text-[11px] text-slate-400 font-bold shrink-0">LOGICA. 깊고 단단한 심화 수학.</footer>
          </div>

          {/* 두 번째 A4 페이지 */}
          <div className="a4-page relative">
            <header className="border-b-[3px] border-[#1e493b] pb-3 mb-5 flex justify-between items-end shrink-0">
              <h1 className="text-[26px] font-black text-[#1e493b] tracking-tight leading-none">인지 및 행동 특성 분석</h1>
              <div className="text-xl font-extrabold text-slate-800"><span className="text-[#1e493b]">{reportData.studentName}</span> 학생</div>
            </header>

            <main className="flex-1 flex flex-col gap-6">
              <section className="grid grid-cols-2 gap-6 mb-2 shrink-0">
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col items-center relative overflow-hidden">
                  <h3 className="text-sm font-extrabold text-white bg-[#1e493b] px-6 py-1.5 rounded-full mb-3 w-max relative z-10">3대 인지 특성</h3>
                  <div className="w-full relative h-[200px] mb-3 z-10"><canvas ref={cogLeftChartRef}></canvas></div>
                  <table className="w-full text-xs text-center border-collapse relative z-10">
                    <thead className="bg-slate-50 text-slate-500 border-y border-slate-200">
                      <tr><th className="py-1.5 w-1/2">분석 항목</th><th className="py-1.5 w-1/4">성취율</th><th className="py-1.5 w-1/4">수준</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                      {renderCogRow('수 감각', getPct(reportData.stats.sense, reportData.rBase.max_calc_sense))}
                      {renderCogRow('공간지각력', getPct(reportData.stats.space, reportData.rBase.max_spatial))}
                      {renderCogRow('논리추론', getPct(reportData.stats.logic, reportData.rBase.max_logic))}
                    </tbody>
                  </table>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 mt-3 w-full text-[10px] text-slate-600 font-medium leading-relaxed space-y-1 relative z-10">
                    <div>• <span className="text-[#1e493b] font-bold">수 감각:</span> 수의 구조/크기를 이해하는 직관력</div>
                    <div>• <span className="text-[#1e493b] font-bold">공간지각력:</span> 3차원 상상 및 도형 파악 능력</div>
                    <div>• <span className="text-[#1e493b] font-bold">논리추론:</span> 규칙을 발견하고 결론을 도출하는 힘</div>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col items-center relative overflow-hidden">
                  <h3 className="text-sm font-extrabold text-white bg-slate-700 px-6 py-1.5 rounded-full mb-3 w-max relative z-10">3대 행동 특성</h3>
                  <div className="w-full relative h-[200px] mb-3 z-10"><canvas ref={cogRightChartRef}></canvas></div>
                  <table className="w-full text-xs text-center border-collapse relative z-10">
                    <thead className="bg-slate-50 text-slate-500 border-y border-slate-200">
                      <tr><th className="py-1.5 w-1/2">분석 항목</th><th className="py-1.5 w-1/4">성취율</th><th className="py-1.5 w-1/4">수준</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                      {renderCogRow('배경지식', getPct(reportData.stats.know, reportData.rBase.max_knowledge))}
                      {renderCogRow('사고력', getPct(reportData.stats.think, reportData.rBase.max_thinking))}
                      {renderCogRow('과제집착력', getPct(reportData.stats.persist, reportData.rBase.max_persistence))}
                    </tbody>
                  </table>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 mt-3 w-full text-[10px] text-slate-600 font-medium leading-relaxed space-y-1 relative z-10">
                    <div>• <span className="text-slate-700 font-bold">배경지식:</span> 수학 개념과 원리에 대한 사전 지식</div>
                    <div>• <span className="text-slate-700 font-bold">사고력:</span> 새롭고 복합적인 문제를 해결하는 유연함</div>
                    <div>• <span className="text-slate-700 font-bold">과제집착력:</span> 끝까지 포기하지 단단하게 몰입하는 끈기</div>
                  </div>
                </div>
              </section>

              <section className="flex-1 flex flex-col">
                <h2 className="text-lg font-black text-slate-800 mb-3 border-b-2 border-slate-800 pb-1.5 flex items-center gap-2">
                  <span>💡</span> 진단 평가 종합 결과
                </h2>
                <div className="bg-white border-2 border-[#1e493b]/20 rounded-2xl p-7 flex-1 relative shadow-sm flex flex-col">
                  <svg className="absolute top-4 left-4 text-[#1e493b] w-10 h-10 opacity-10" fill="currentColor" viewBox="0 0 24 24"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h4v10h-10z"/></svg>
                  <div className="flex gap-2 mb-4 relative z-10">
                    <span className="px-3 py-1 bg-[#1e493b] text-white rounded-full text-[12px] font-black shadow-sm">종합 분석</span>
                  </div>
                  <p className="text-slate-700 font-bold text-[15px] leading-loose tracking-tight text-justify indent-2 whitespace-pre-line relative z-10 flex-1">
                    {reportData.evalComment}
                  </p>
                </div>
              </section>
            </main>
            <footer className="mt-4 pt-3 border-t border-slate-200 text-center text-[11px] text-slate-400 font-bold shrink-0">LOGICA. 깊고 단단한 심화 수학.</footer>
          </div>
        </>
      )}
    </div>
  );
}

export default function PrintReportPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center font-bold text-slate-500">로딩 중...</div>}>
      <PrintReportContent />
    </Suspense>
  );
}