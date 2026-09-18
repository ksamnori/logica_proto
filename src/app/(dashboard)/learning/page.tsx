// src/app/(dashboard)/learning/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { ViewState } from "./types";
import { useLearningFetch, LEVEL_ORDER } from "./hooks/useLearningFetch";
import { useLearningActions } from "./hooks/useLearningActions";

import LearningSidebar from "./components/LearningSidebar";
import StudentDashboard from "./components/StudentDashboard";
import GlobalList from "./components/GlobalList";
import StudentTimeline from "./components/StudentTimeline";
import LearningCalendar from "./components/LearningCalendar";

export default function LearningPage() {
  const [activeTab, setActiveTab] = useState<any>('DASHBOARD');
  const [currentView, setCurrentView] = useState<ViewState>({ type: 'ALL', classId: '', className: '', studentId: '', studentName: '' });

  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [globalSelectedBlocks, setGlobalSelectedBlocks] = useState<string[]>([]);

  const [showCompleted, setShowCompleted] = useState<boolean>(false);
  const [dateFilter, setDateFilter] = useState<'ALL' | '1W' | '1M'>('ALL');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isGeneratingPrint, setIsGeneratingPrint] = useState(false);
  const [isFilterActive, setIsFilterActive] = useState(false);

  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  
  // 🌟 클리닉 미리보기 모달 상태
  const [previewModal, setPreviewModal] = useState<{ isOpen: boolean; studentName: string; stats: any } | null>(null);

  // 🌟 개별 오답 관리 모달 상태
  const [rawIncManageModal, setRawIncManageModal] = useState<{ isOpen: boolean; studentId: string; studentName: string; month: string; records: any[] } | null>(null);

  // 🌟 문제/정답 간단 확인 모달 상태
  const [singleQuestionPreview, setSingleQuestionPreview] = useState<any | null>(null);

  const [bulkStartDate, setBulkStartDate] = useState(() => {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000); 
    d.setDate(d.getDate() - 7); 
    return d.toISOString().split('T')[0];
  });
  const [bulkEndDate, setBulkEndDate] = useState(() => {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  });

  const [bulkFilters, setBulkFilters] = useState({
    exam: true,      // 주간/중간테스트
    homework: true,  // 과제
    overdue: true,   // 미완료과제
    print: true,     // 오답
    similar: true    // 오답유사
  });

  const [isBulkTargetDateActive, setIsBulkTargetDateActive] = useState(false);
  const [bulkTargetDate, setBulkTargetDate] = useState(() => {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  });
  
  const [bulkTwin, setBulkTwin] = useState(1);
  const [bulkSim, setBulkSim] = useState(1);
  const [bulkDiff, setBulkDiff] = useState('그대로');
  const [bulkExclude, setBulkExclude] = useState(true);
  const [bulkLimitActive, setBulkLimitActive] = useState(true);
  const [bulkLimit, setBulkLimit] = useState(3);
  const [bulkTotalLimitActive, setBulkTotalLimitActive] = useState(true);
  const [bulkTotalLimit, setBulkTotalLimit] = useState(10);

  const [bulkStatus, setBulkStatus] = useState({ isRunning: false, current: 0, total: 0, studentName: '' });

  const {
    isAuthorized, isLoading, setIsLoading,
    groupedClasses, allStudentsList, currentStats,
    globalList, setGlobalList, timelineData, setTimelineData,
    classCalendarEvents,
    fetchBaseData, fetchStatsForTab, fetchStudentTimeline, fetchGlobalListForTab, fetchStudentClinicPreview
  } = useLearningFetch();

  const actions = useLearningActions({
    currentView, activeTab, allStudentsList,
    selectedBlocks, setSelectedBlocks, globalSelectedBlocks, setGlobalSelectedBlocks,
    setIsLoading, setIsGeneratingPrint, setDateFilter,
    fetchStudentTimeline, fetchGlobalListForTab, fetchStatsForTab
  });

  useEffect(() => {
    if (isAuthorized) fetchBaseData();
  }, [isAuthorized]);

  useEffect(() => {
    if (allStudentsList.length > 0) {
      const savedTab = sessionStorage.getItem('logica_learning_tab') || 'DASHBOARD';
      const savedViewStr = sessionStorage.getItem('logica_learning_view');
      let view: ViewState = { type: 'ALL', classId: '', className: '', studentId: '', studentName: '' };

      if (savedViewStr) {
        try { 
          const parsed = JSON.parse(savedViewStr); 
          if (['ALL', 'CLASS', 'STUDENT'].includes(parsed.type)) view = parsed;
        } catch(e){}
      }

      const urlStudentId = new URLSearchParams(window.location.search).get('studentId');
      if (urlStudentId) {
        const matched = allStudentsList.find(s => s.id === urlStudentId);
        if (matched) view = { type: 'STUDENT', classId: matched.classId, className: matched.className, studentId: matched.id, studentName: matched.name };
      }

      setActiveTab(savedTab);
      setCurrentView(view);
      setIsFilterActive(false);

      fetchStatsForTab(allStudentsList);

      if (view.type === 'STUDENT') fetchStudentTimeline(view.studentId, view.classId, allStudentsList);
      else fetchGlobalListForTab(savedTab, allStudentsList);
    }
  }, [allStudentsList]);

  const handleMainTabClick = (tab: any) => {
    setActiveTab(tab);
    sessionStorage.setItem('logica_learning_tab', tab);
    setSelectedBlocks([]); setGlobalSelectedBlocks([]); setIsFilterActive(false); setSelectedDate(null); 
    if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
    else fetchGlobalListForTab(tab, allStudentsList);
  };

  const handleCalendarSummaryClick = (tab: any) => {
    setActiveTab(tab);
    sessionStorage.setItem('logica_learning_tab', tab);
    setSelectedBlocks([]); setGlobalSelectedBlocks([]); setGlobalList([]); setTimelineData([]);
    if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
    else fetchGlobalListForTab(tab, allStudentsList);
  };

  const handleViewChange = (view: ViewState) => {
    setCurrentView(view);
    sessionStorage.setItem('logica_learning_view', JSON.stringify(view));
    setSelectedBlocks([]); setGlobalSelectedBlocks([]); setSelectedDate(null); 
    setGlobalList([]); setTimelineData([]);
    if (view.type === 'STUDENT') fetchStudentTimeline(view.studentId, view.classId, allStudentsList);
    else fetchGlobalListForTab(activeTab, allStudentsList);
  };

  const handleStudentClick = (studentId: string, studentName: string, classId: string, className: string) => {
    handleViewChange({ type: 'STUDENT', classId, className, studentId, studentName });
  };

  const filterByDate = (dateStr: string) => {
    if (selectedDate) {
      const d = new Date(dateStr);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return ymd === selectedDate;
    }
    if (dateFilter === 'ALL') return true;
    const diff = new Date().getTime() - new Date(dateStr).getTime();
    return dateFilter === '1W' ? diff <= 7 * 24 * 3600000 : diff <= 30 * 24 * 3600000;
  };

  const filteredGlobalList = useMemo(() => {
    return globalList.filter(item => {
      if (currentView.type === 'CLASS') {
        if (item.class_id) {
          if (item.class_id !== currentView.classId) return false;
        } else {
          const stu = allStudentsList.find(s => s.id === item.student_id);
          if (!stu || (stu.classId !== currentView.classId && !stu.allClassIds?.includes(currentView.classId))) {
            return false;
          }
        }
      }
      if (!filterByDate(item.sort_date || item.created_at)) return false;
      const isCompleted = ['채점완료', '제출완료', '완료'].includes(item.status);
      if (!showCompleted && isCompleted) return false; 
      return true;
    });
  }, [globalList, dateFilter, selectedDate, currentView, showCompleted, allStudentsList]);

  const filteredTimeline = useMemo(() => {
    return timelineData.filter(item => {
      if (!filterByDate(item.date)) return false;
      if (activeTab === 'EXAM' && item.type !== 'exam') return false;
      if (activeTab === 'QUARTERLY' && item.type !== 'quarterly') return false; 
      if (activeTab === 'HOMEWORK' && !item.type.includes('hw')) return false;
      if (activeTab === 'INCORRECT' && item.type !== 'print') return false;
      if (activeTab === 'SIMILAR' && item.type !== 'similar') return false; 
      if (activeTab === 'OVERDUE' && item.type !== 'overdue') return false; 
      if (activeTab === 'ARCHIVE' && item.type !== 'archive') return false;
      if (activeTab === 'RAW_INCORRECT' && item.type !== 'raw_inc') return false;
      if (!showCompleted && item.isCompleted && activeTab !== 'ARCHIVE' && activeTab !== 'RAW_INCORRECT') return false; 
      return true;
    });
  }, [timelineData, dateFilter, activeTab, selectedDate, showCompleted]);

  const toggleGlobalSelection = (id: string) => {
    setGlobalSelectedBlocks(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  };

  const handleSelectAllGlobal = () => {
    if (globalSelectedBlocks.length === filteredGlobalList.length && filteredGlobalList.length > 0) {
      setGlobalSelectedBlocks([]);
    } else {
      setGlobalSelectedBlocks(filteredGlobalList.map(res => {
         const safeId = res.assignment_id || res.homework_id || Math.random().toString(36).substr(2, 9);
         if (activeTab === 'EXAM') return `exam_${safeId}_${res.student_id}`;
         if (activeTab === 'QUARTERLY') return `quarterly_${safeId}_${res.student_id}`;
         if (activeTab === 'HOMEWORK') return res.is_exam_hw ? `hw_exam_${safeId}_${res.student_id}` : `hw_${safeId}_${res.student_id}`;
         if (activeTab === 'INCORRECT') return `print_${safeId}_${res.student_id}`;
         if (activeTab === 'SIMILAR') return `similar_${safeId}_${res.student_id}`; 
         if (activeTab === 'OVERDUE') return `overdue_${safeId}_${res.student_id}`; 
         if (activeTab === 'ARCHIVE') return `archive_${res.realId}_${res.student_id}`;
         if (activeTab === 'RAW_INCORRECT') return `raw_inc_${res.realId}_${res.student_id}`;
         return '';
      }));
    }
  };

  const handleSelectAllStudent = () => {
    const visibleIds = filteredTimeline.map((i: any) => i.id);
    if (selectedBlocks.length === visibleIds.length && visibleIds.length > 0) setSelectedBlocks([]); 
    else setSelectedBlocks(visibleIds);
  };

  const studentStatsMap = useMemo(() => {
    const map: Record<string, { examC: number; examQ: number; hwC: number; hwQ: number; printC: number; printQ: number; similarC: number; similarQ: number; overdueC: number; overdueQ: number }> = {};
    currentStats.forEach(e => {
      let statClassId = e.class_id || 'UNKNOWN';
      const key = `${e.student_id}_${statClassId}`;
      const globalKey = `${e.student_id}_ALL`;
      
      if (!map[key]) map[key] = { examC: 0, examQ: 0, hwC: 0, hwQ: 0, printC: 0, printQ: 0, similarC: 0, similarQ: 0, overdueC: 0, overdueQ: 0 };
      if (!map[globalKey]) map[globalKey] = { examC: 0, examQ: 0, hwC: 0, hwQ: 0, printC: 0, printQ: 0, similarC: 0, similarQ: 0, overdueC: 0, overdueQ: 0 };
      
      const statusStr = e.status || '미제출';
      const isPending = ['미제출', '진행중', '미응시', '응시전', '응시중'].includes(statusStr);
      
      if (isPending) { 
        const qCount = e.qCount || 0;
        if (e.type === 'EXAM') { map[key].examC += 1; map[key].examQ += qCount; map[globalKey].examC += 1; map[globalKey].examQ += qCount; }
        else if (e.type === 'HW') { map[key].hwC += 1; map[key].hwQ += qCount; map[globalKey].hwC += 1; map[globalKey].hwQ += qCount; }
        else if (e.type === 'PRINT') { map[key].printC += 1; map[key].printQ += qCount; map[globalKey].printC += 1; map[globalKey].printQ += qCount; }
        else if (e.type === 'SIMILAR') { map[key].similarC += 1; map[key].similarQ += qCount; map[globalKey].similarC += 1; map[globalKey].similarQ += qCount; }
        else if (e.type === 'OVERDUE') { map[key].overdueC += 1; map[key].overdueQ += qCount; map[globalKey].overdueC += 1; map[globalKey].overdueQ += qCount; } 
      }
    });
    return map;
  }, [currentStats]);

  const handleOpenPreview = async () => {
    if (currentView.type !== 'STUDENT') return;
    setIsLoading(true);
    const stats = await fetchStudentClinicPreview(currentView.studentId, currentView.classId);
    const statKey = `${currentView.studentId}_${currentView.classId}`;
    const localStats = studentStatsMap[statKey] || { examQ: 0, hwQ: 0, overdueQ: 0, printQ: 0 };
    
    const mergedStats = {
      ...stats,
      examQCount: localStats.examQ,
      hwQCount: localStats.hwQ,
      overdueQCount: localStats.overdueQ,
      printQCount: localStats.printQ
    };

    setPreviewModal({ isOpen: true, studentName: currentView.studentName, stats: mergedStats });
    setIsLoading(false);
  };

  const openRawIncManageModal = async (studentId: string, studentName: string, month: string) => {
    setIsLoading(true);
    const { data } = await supabase.from('student_incorrect_record')
      .select('record_id, source_type, created_at, question_id, tq_id')
      .eq('student_id', studentId)
      .is('resolved_at', null);

    const records = (data || [])
      .filter(d => d.created_at && d.created_at.startsWith(month))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setRawIncManageModal({ isOpen: true, studentId, studentName, month, records });
    setIsLoading(false);
  };

  const handleDeleteSingleRawInc = async (recordId: number) => {
    if (!confirm('이 문항을 오답 목록에서 완전히 삭제(해결 처리)하시겠습니까?')) return;
    try {
      await supabase.from('student_incorrect_record')
        .update({ resolved_at: new Date().toISOString(), status: 'B' }) 
        .eq('record_id', recordId);
        
      setRawIncManageModal(prev => prev ? { ...prev, records: prev.records.filter(r => r.record_id !== recordId) } : null);
      
      // 🔥 actions. 없이 직접 호출
      if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      else fetchGlobalListForTab(activeTab, allStudentsList);
    } catch (e) {
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  // 🔥 [초강력 방어 로직] question_db, textbook_question 완벽 매핑
  const handleViewSingleRawInc = async (qId: string | number | null) => {
    if (!qId) return alert('문항 식별자가 존재하지 않습니다.');
    setIsLoading(true);
    try {
        let finalQId = String(qId);
        
        // 교재 ID(숫자)일 경우 먼저 textbook_question 뒤져서 문제은행 UUID 획득
        if (!isNaN(Number(qId))) {
            const { data: tqData } = await supabase.from('textbook_question').select('question_id').eq('tq_id', Number(qId)).maybeSingle();
            if (tqData?.question_id) {
                finalQId = tqData.question_id;
            }
        }

        // 🌟 question_db에서 긁어오기
        const { data: qData, error } = await supabase.from('question_db').select('*').eq('question_id', finalQId).maybeSingle();

        if (error || !qData) {
            alert(`DB에서 해당 문제(${qId} -> ${finalQId})를 찾을 수 없습니다.\n삭제되었거나 데이터 연결이 유실된 문항입니다.`);
        } else {
            setSingleQuestionPreview(qData);
        }
    } catch (e) {
        console.error(e);
        alert('문제 정보를 불러오는 중 오류가 발생했습니다.');
    } finally {
        setIsLoading(false);
    }
  };

  const formatDateLabel = (dateStr: string, includeTime = false) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const dt = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} (${['일','월','화','수','목','금','토'][d.getDay()]})`;
    if (includeTime) return `${dt} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    return dt;
  };

  const handleRunBulkPrint = async () => {
    const studentsInClass = allStudentsList.filter(s => s.classId === currentView.classId);
    if (studentsInClass.length === 0) return alert('선택하신 반에 등록된 학생이 없습니다.');

    const allowedSourceTypes = [];
    if (bulkFilters.exam) allowedSourceTypes.push('주간테스트', '중간평가', '중간테스트', '입학테스트', '진단평가', '분기평가', '분기테스트', '시험지');
    if (bulkFilters.homework) allowedSourceTypes.push('과제', '과제프린트', '교재과제');
    if (bulkFilters.overdue) allowedSourceTypes.push('미완료과제');
    if (bulkFilters.print) allowedSourceTypes.push('오답프린트', '오답');
    if (bulkFilters.similar) allowedSourceTypes.push('오답유사', '과제오답유사');
    
    if (allowedSourceTypes.length === 0) {
      alert('오답 지정 범위를 최소 1개 이상 선택해주세요.');
      return;
    }

    setBulkStatus({ isRunning: true, current: 0, total: studentsInClass.length, studentName: '' });

    let successCount = 0;
    let skipNoSource = 0; 
    let skipNoMatch = 0;  

    const myTenantId = localStorage.getItem("logica_tenant_id") || 'hq';
    const instId = localStorage.getItem('logica_instructor_id') || 'system';

    for (let i = 0; i < studentsInClass.length; i++) {
      const st = studentsInClass[i];
      setBulkStatus({ isRunning: true, current: i + 1, total: studentsInClass.length, studentName: st.name });

      try {
        const targetQids = new Set<string>();

        const { data: exams, error: exErr } = await supabase.from('exam_assignment')
          .select('assignment_id, created_at, exam_master(exam_type)')
          .eq('student_id', st.id);

        if (!exErr && exams) {
          const validAssignIds = (exams as any[]).filter(ex => {
            const kst = new Date(new Date(ex.created_at).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
            if (kst < bulkStartDate || kst > bulkEndDate) return false;
            
            const m = ex.exam_master;
            const type = m ? (Array.isArray(m) ? m[0]?.exam_type : m.exam_type) : '';
            const t = type || '';
            
            if (bulkFilters.print && ['오답프린트', '오답'].includes(t)) return true;
            if (bulkFilters.similar && ['오답유사', '과제오답유사'].includes(t)) return true;
            if (bulkFilters.homework && ['과제', '과제프린트'].includes(t)) return true;
            if (bulkFilters.overdue && t === '미완료과제') return true;
            if (bulkFilters.exam && !['과제', '과제프린트', '미완료과제', '오답프린트', '오답', '오답유사', '과제오답유사'].includes(t)) return true;
            
            return false;
          }).map(ex => ex.assignment_id);

          if (validAssignIds.length > 0) {
            const { data: ans } = await supabase.from('student_answer')
              .select('question_id')
              .in('exam_assignment_id', validAssignIds)
              .in('grading_code', ['X', 'TX', '☆', 'B']);
              
            ans?.forEach(a => { if (a.question_id) targetQids.add(a.question_id); });
          }
        }

        if (bulkFilters.homework) {
          const { data: hwRes, error: hwErr } = await supabase.from('student_homework_result')
            .select('homework_id, homework_assignment(created_at)')
            .eq('student_id', st.id);
            
          if (!hwErr && hwRes) {
            const validHwIds = (hwRes as any[]).filter(r => {
              const hwObj = r.homework_assignment;
              const hw = hwObj ? (Array.isArray(hwObj) ? hwObj[0] : hwObj) : null;
              if (!hw || !hw.created_at) return false;
              
              const kst = new Date(new Date(hw.created_at).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
              return kst >= bulkStartDate && kst <= bulkEndDate;
            }).map(r => r.homework_id);

            if (validHwIds.length > 0) {
              const { data: hwAns } = await supabase.from('student_homework_answer')
                .select('tq_id, question_id')
                .eq('student_id', st.id)
                .in('homework_id', validHwIds)
                .in('grading_code', ['X', 'TX', '☆', 'B']);
                
              if (hwAns && hwAns.length > 0) {
                const tqIds = hwAns.map(a => a.tq_id).filter(Boolean);
                if (tqIds.length > 0) {
                  const { data: tqs } = await supabase.from('textbook_question').select('question_id').in('tq_id', tqIds);
                  tqs?.forEach(t => { if(t.question_id) targetQids.add(t.question_id); });
                }
                hwAns.forEach(a => { if(a.question_id) targetQids.add(a.question_id); });
              }
            }
          }
        }

        const uniqueQids = Array.from(targetQids);
        
        if (uniqueQids.length === 0) { 
            console.log(`[스킵] ${st.name}: 조건에 맞는 원본 오답을 찾지 못함.`);
            skipNoSource++; 
            continue; 
        }

        const { data: matchedIds, error: matchErr } = await supabase.rpc('get_clinic_matches', {
          p_target_qids: uniqueQids,
          p_twin_count: bulkTwin,
          p_sim_count: bulkSim,
          p_diff_opt: bulkDiff,
          p_exclude_orig: bulkExclude,
          p_max_limit: bulkLimit,
          p_is_limit_active: bulkLimitActive
        });

        if (matchErr) {
            console.error("🔥 DB 매칭 에러 발생! 오버로딩 또는 파라미터 충돌:", matchErr);
            alert(`학생 [${st.name}] 매칭 중 DB 에러가 발생했습니다: ${matchErr.message}`);
            skipNoMatch++;
            continue;
        }

        if (!matchedIds || matchedIds.length === 0) { 
            console.log(`[스킵] ${st.name}: DB 매칭이 0개입니다.`);
            skipNoMatch++; 
            continue; 
        }

        let finalMatchedIds = matchedIds;
        if (bulkTotalLimitActive && bulkTotalLimit > 0) {
            finalMatchedIds = matchedIds.slice(0, bulkTotalLimit);
        }

        if (finalMatchedIds.length === 0) { skipNoMatch++; continue; }

        const examTitle = `[${currentView.className}] ${st.name} 오답유사 클리닉`;
        const subTitle = isBulkTargetDateActive ? `${bulkTargetDate.split('-')[1]}월 ${bulkTargetDate.split('-')[2]}일 수행 목표` : '-';
        const finalExamDate = isBulkTargetDateActive ? bulkTargetDate : null;

        const { data: masterData, error: mstErr } = await supabase.from('exam_master').insert({
          title: examTitle, sub_title: subTitle, exam_type: '오답유사', total_questions: finalMatchedIds.length,
          instructor_id: instId, tenant_id: myTenantId,
          layout_settings: { column: 2, split: 4, titleMode: 'all', template: 'basic1', numberColor: '#175b6a', titleColor: '#002864', lineColor: '#94a3b8', examDate: finalExamDate }
        }).select().single();

        if (mstErr || !masterData) { skipNoMatch++; continue; }

        const examItems = finalMatchedIds.map((qId: string, idx: number) => ({ exam_id: masterData.exam_id, question_id: qId, sort_order: idx + 1 }));
        await supabase.from('exam_item').insert(examItems);

        await supabase.from('exam_assignment').insert({ exam_id: masterData.exam_id, student_id: st.id, class_id: currentView.classId, status: '미응시' });

        const tasks = finalMatchedIds.map((qId: string) => ({ student_id: st.id, task_type: '유형오답클리닉', question_id: qId, status: '대기' }));
        await supabase.from('clinic_task').insert(tasks);

        successCount++;
      } catch (err) {
        console.error("Bulk Generate Error for student " + st.name, err);
        skipNoSource++;
      }
    }

    alert(`✅ 일괄 생성이 완료되었습니다.\n- 🟢 성공: ${successCount}명 배부 완료\n- 🔴 스킵 (기간 내 오답 없음): ${skipNoSource}명\n- 🟡 스킵 (유사 문제 DB 부족 또는 에러): ${skipNoMatch}명\n\n※ 유사문제가 부족하여 스킵된 경우 AI 유사문제 생성기 도입이 필요합니다.`);
    setBulkStatus({ isRunning: false, current: 0, total: 0, studentName: '' });
    setIsBulkModalOpen(false);

    fetchGlobalListForTab(activeTab, allStudentsList);
    fetchStatsForTab(allStudentsList);
  };

  // 🔥 밖으로 빼놓은 handleRenameItem
  const handleRenameItem = async (e: React.MouseEvent, type: string, realId: string, masterId: string | null, currentTitle: string) => {
    e.stopPropagation();
    const cleanCurrent = currentTitle.replace(/^\[시스템\]\s*/, '');
    const newTitle = window.prompt("새로운 이름을 입력하세요:", cleanCurrent);
    if (!newTitle || newTitle.trim() === "" || newTitle === cleanCurrent) return;

    try {
      setIsLoading(true);
      const isExamType = ['exam', 'quarterly', 'print', 'similar', 'overdue', 'hw_exam'].includes(type);
      const isHwType = type === 'hw' || (type.includes('hw') && type !== 'hw_exam');

      if (isHwType) {
        const { error } = await supabase.from('homework_assignment')
          .update({ homework_title: newTitle.trim() })
          .eq('homework_id', realId);
        if (error) throw error;
      } else if (isExamType) {
        if (!masterId) throw new Error("마스터 ID를 찾을 수 없습니다.");
        const { error } = await supabase.from('exam_master')
          .update({ title: newTitle.trim() })
          .eq('exam_id', masterId);
        if (error) throw error;
      }

      if (currentView.type === 'STUDENT') {
        await fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      } else {
        await fetchGlobalListForTab(activeTab, allStudentsList);
      }
    } catch (err: any) {
      console.error(err);
      alert(`이름 변경 실패: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthorized === null) {
    return (
      <div className="flex w-full h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-[#002864] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-slate-500 font-bold text-sm">보안 권한을 확인하는 중입니다...</span>
        </div>
      </div>
    );
  }
  
  if (isAuthorized === false) return null; 

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-4 overflow-hidden relative font-pretendard">
      <div className="flex justify-between items-center shrink-0">
        
        <div className="flex items-center gap-2 p-1.5 bg-slate-200/60 rounded-xl shadow-inner overflow-x-auto">
          <button onClick={() => handleMainTabClick('DASHBOARD')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'DASHBOARD' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📈 학생 대시보드</button>
          <div className="w-px h-6 bg-slate-300 mx-0.5 shrink-0"></div>
          
          <button onClick={() => handleMainTabClick('EXAM')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'EXAM' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>💯 주간/중간테스트</button>
          <button onClick={() => handleMainTabClick('HOMEWORK')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'HOMEWORK' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📝 과제</button>
          <button onClick={() => handleMainTabClick('OVERDUE')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'OVERDUE' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>⏰ 미완료과제</button>
          <button onClick={() => handleMainTabClick('INCORRECT')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'INCORRECT' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>❌ 오답</button>
          <button onClick={() => handleMainTabClick('SIMILAR')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'SIMILAR' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>🔄 오답유사</button>
          
          <div className="w-px h-6 bg-slate-300 mx-1 shrink-0"></div>
          <button onClick={() => handleMainTabClick('QUARTERLY')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'QUARTERLY' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📅 분기평가</button>
          
          <div className="w-px h-6 bg-slate-300 mx-1 shrink-0"></div>
          <button onClick={() => handleMainTabClick('RAW_INCORRECT')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'RAW_INCORRECT' ? 'bg-rose-800 text-rose-100 shadow-md border border-rose-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>🔥 누적 원본 오답</button>
          <button onClick={() => handleMainTabClick('ARCHIVE')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'ARCHIVE' ? 'bg-slate-800 text-amber-400 shadow-md border border-slate-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📦 해결된 오답</button>

          {currentView.type === 'CLASS' && (
            <>
              <div className="w-px h-6 bg-slate-300 mx-0.5 shrink-0"></div>
              <button 
                onClick={() => setIsBulkModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 text-white font-black text-[13px] shadow-sm transition-colors animate-[fadeIn_0.3s_ease-out] shrink-0"
              >
                <span className="text-sm">🖨️</span>
                <span>[{currentView.className}] 전원 오답유사 생성</span>
              </button>
            </>
          )}
        </div>

      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        <LearningSidebar 
           currentView={currentView} groupedClasses={groupedClasses} studentStatsMap={studentStatsMap} 
           isLoading={isLoading} handleViewChange={handleViewChange} handleStudentClick={handleStudentClick} 
        />

        <div className="flex-1 flex flex-col relative bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          
          {currentView.type === 'STUDENT' && (
            <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
               <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#002864] text-white flex items-center justify-center font-black shadow-sm">
                     {currentView.studentName.charAt(0)}
                  </div>
                  <div>
                     <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                        {currentView.studentName} 학생
                        <span className="text-xs font-bold bg-white text-slate-500 px-2 py-0.5 rounded-full border border-slate-200 shadow-sm">{currentView.className}</span>
                     </h2>
                  </div>
               </div>
               <button 
                  onClick={handleOpenPreview}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-extrabold rounded-xl shadow-sm transition-all"
               >
                  <span className="text-lg">👀</span> 학생 포털 미리보기
               </button>
            </div>
          )}

          { (currentView.type === 'ALL' || currentView.type === 'CLASS') && activeTab === 'DASHBOARD' && (
            <StudentDashboard currentView={currentView} activeTab={activeTab} isFilterActive={isFilterActive} setIsFilterActive={setIsFilterActive} handleViewChange={handleViewChange} handleStudentClick={handleStudentClick} groupedClasses={groupedClasses} studentStatsMap={studentStatsMap} LEVEL_ORDER={LEVEL_ORDER} />
          )}  

          { (currentView.type === 'ALL' || currentView.type === 'CLASS') && activeTab !== 'DASHBOARD' && (
            <div className="flex flex-col h-full overflow-hidden">
              {(activeTab === 'INCORRECT' || activeTab === 'SIMILAR') && currentView.type === 'ALL' && (
                <div className="bg-indigo-50/80 border border-indigo-200 p-4 m-6 mb-2 rounded-xl flex items-center justify-between shadow-sm shrink-0">
                  <div className="flex flex-col gap-1">
                     <h3 className="text-indigo-800 font-extrabold text-[13px] flex items-center gap-1.5"><span>💡</span> 오답 및 오답유사 프린트는 어디서 만드나요?</h3>
                     <p className="text-indigo-600/90 font-bold text-[11px] pl-5 leading-relaxed">
                        좌측 아코디언 메뉴에서 <strong className="text-indigo-700 font-black">특정 반</strong>을 선택하시면 상단 탭 맨 우측에 <strong className="text-indigo-700 font-black">전원 일괄 생성</strong> 버튼이 나타나며,<br/>
                        <strong className="text-indigo-700 font-black">특정 학생</strong>을 선택하시면 해당 학생만을 위한 오답 생성 마법사가 열립니다.
                     </p>
                  </div>
                </div>
              )}
              {activeTab === 'ARCHIVE' && (
                <div className="bg-amber-50/80 border border-amber-200 p-4 m-6 mb-2 rounded-xl flex items-center justify-between shadow-sm shrink-0">
                  <div className="flex flex-col gap-1">
                     <h3 className="text-amber-800 font-extrabold text-[13px] flex items-center gap-1.5"><span>📦</span> 영구 보존 오답 아카이브</h3>
                     <p className="text-amber-700/90 font-bold text-[11px] pl-5 leading-relaxed">
                        학생이 과거에 틀렸던 문제 중 클리닉을 통해 완벽히 극복(O, RO, TO)하여 <strong className="text-amber-800 font-black">'해결됨'</strong> 처리된 문항들입니다.<br/>
                        이곳의 데이터는 더 초과로 오답 클리닉 문제지로 출제되지 않습니다.
                     </p>
                  </div>
                </div>
              )}
              {activeTab === 'RAW_INCORRECT' && (
                <div className="bg-rose-50/80 border border-rose-200 p-4 m-6 mb-2 rounded-xl flex items-center justify-between shadow-sm shrink-0">
                  <div className="flex flex-col gap-1">
                     <h3 className="text-rose-800 font-extrabold text-[13px] flex items-center gap-1.5"><span>🔥</span> 누적 원본 오답 리스트</h3>
                     <p className="text-rose-700/90 font-bold text-[11px] pl-5 leading-relaxed">
                        월별로 누적된 <strong className="text-rose-800 font-black">'순수 미해결 오답 원본'</strong>들을 모아놓은 목록입니다.<br/>
                        우측의 프린트(🖨️) 버튼을 누르면 해당 월에 틀린 모든 오답을 즉시 눈으로 확인할 수 있습니다.
                     </p>
                  </div>
                </div>
              )}
              <div className="w-full flex justify-end px-5 pt-3 pb-1 -mb-1 relative z-20 pointer-events-none">
                 <button onClick={() => setShowCompleted(prev => !prev)} className={`pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all border shadow-sm ${showCompleted ? 'bg-blue-50 border-blue-200 text-[#002864] hover:bg-blue-100' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`} title="완료된 항목 숨김/표시 전환">
                    <span>{showCompleted ? '✅' : '🔒'}</span><span>{showCompleted ? '완료 포함' : '미완료만 보기'}</span>
                 </button>
              </div>
              <GlobalList 
                currentView={currentView} activeTab={activeTab} globalList={filteredGlobalList} isLoading={isLoading} 
                globalSelectedBlocks={globalSelectedBlocks} handleSelectAllGlobal={handleSelectAllGlobal} 
                toggleGlobalSelection={toggleGlobalSelection} formatDateLabel={formatDateLabel} 
                handleViewChange={handleViewChange} 
                openRawIncManageModal={openRawIncManageModal}
                handleRenameItem={handleRenameItem} // 🔥 여기서 다시 직접 넘김
                {...actions} 
              />
            </div>
          )}

          {currentView.type === 'STUDENT' && (
            <div className="flex flex-col h-full overflow-hidden">
              {activeTab !== 'DASHBOARD' && (
                <div className="w-full flex justify-end px-5 pt-3 pb-1 -mb-1 relative z-20 pointer-events-none flex-col items-end gap-2">
                   {activeTab === 'ARCHIVE' && (
                      <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg shadow-sm pointer-events-auto">
                        📦 완전히 극복하여 클리닉에서 제외된 오답 기록입니다.
                      </span>
                   )}
                   {activeTab === 'RAW_INCORRECT' && (
                      <span className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg shadow-sm pointer-events-auto">
                        🔥 개별 문항 삭제/관리 버튼(✂️)을 눌러 원치 않는 오답을 영구 삭제할 수 있습니다.
                      </span>
                   )}
                   <button onClick={() => setShowCompleted(prev => !prev)} className={`pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all border shadow-sm ${showCompleted ? 'bg-blue-50 border-blue-200 text-[#002864] hover:bg-blue-100' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`} title="완료된 항목 숨김/표시 전환">
                      <span>{showCompleted ? '✅' : '🔒'}</span><span>{showCompleted ? '완료 포함' : '미완료만 보기'}</span>
                   </button>
                </div>
              )}
              <StudentTimeline 
                currentView={currentView} activeTab={activeTab} dateFilter={dateFilter} setDateFilter={setDateFilter} 
                isLoading={isLoading} filteredTimeline={filteredTimeline} selectedBlocks={selectedBlocks} 
                setSelectedBlocks={setSelectedBlocks} handleSelectAllStudent={handleSelectAllStudent} 
                isGeneratingPrint={isGeneratingPrint} formatDateLabel={formatDateLabel} 
                openRawIncManageModal={openRawIncManageModal}
                handleRenameItem={handleRenameItem} // 🔥 여기서 다시 직접 넘김
                {...actions} 
              />
            </div>
          )}
        </div>

        <div className="w-[300px] shrink-0">
          <LearningCalendar 
             currentView={currentView} activeTab={activeTab} timelineData={timelineData} globalList={globalList} 
             classCalendarEvents={classCalendarEvents} selectedDate={selectedDate} setSelectedDate={setSelectedDate} 
             handleCalendarSummaryClick={handleCalendarSummaryClick} handleViewAllStudents={() => handleViewChange({ type: 'ALL', classId: '', className: '', studentId: '', studentName: '' })}
          />
        </div>
      </div>

      {/* 🌟 클리닉 미리보기 모달 UI */}
      {previewModal?.isOpen && (
        <div className="fixed inset-0 z-[100] flex justify-center items-center bg-slate-900/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out] p-4">
          <div className="bg-slate-100 w-[950px] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-8 py-5 border-b border-slate-200 bg-white shrink-0">
              <h2 className="text-xl font-black text-slate-800 flex items-center gap-3">
                <span className="text-2xl">👀</span>
                <span className="text-[#002864]">{previewModal.studentName}</span> 학생의 포털 진입 화면
              </h2>
              <button onClick={() => setPreviewModal(null)} className="text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 hover:bg-slate-100 p-2 rounded-full">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="p-8 grid grid-cols-2 grid-rows-2 gap-8 bg-slate-100">
              {/* 1. 주간테스트 (EXAM) */}
              <div className="w-full h-[220px] bg-gradient-to-br from-[#002864] to-blue-800 rounded-[2rem] p-8 text-white shadow-xl relative overflow-hidden group flex flex-col justify-between">
                <div className="relative z-10 shrink-0">
                  <div className="flex flex-wrap items-center gap-2.5 mb-3">
                    <span className="text-sm font-black bg-blue-500 text-white px-4 py-2 rounded-xl shadow-sm flex items-center">📝 주간테스트</span>
                  </div>
                  <div className="absolute top-0 right-0 flex flex-col items-end gap-2 z-20 w-auto">
                    <span className="text-sm font-bold text-blue-200 bg-black/10 px-3.5 py-1.5 rounded-lg whitespace-nowrap shadow-sm">
                      남은 문제: {previewModal.stats.examQCount ?? 0}
                    </span>
                  </div>
                  <h3 className="text-[28px] font-black mb-1.5 leading-tight pr-[80px]">주간테스트 클리닉</h3>
                  <p className="text-sm font-medium mt-0 mb-1.5 leading-snug text-blue-200 pr-[60px]">
                    오늘 배정된 테스트를 응시합니다.
                  </p>
                </div>
              </div>

              {/* 2. 과제 (HW) */}
              <div className="w-full h-[220px] bg-gradient-to-br from-amber-600 to-amber-500 rounded-[2rem] p-8 text-white shadow-xl relative overflow-hidden group flex flex-col justify-between">
                <div className="relative z-10 shrink-0">
                  <div className="flex flex-wrap items-center gap-2.5 mb-3">
                    <span className="text-sm font-black bg-amber-400 text-amber-900 px-4 py-2 rounded-xl shadow-sm flex items-center">📚 과제</span>
                  </div>
                  <div className="absolute top-0 right-0 flex flex-col items-end gap-2 z-20 w-auto">
                    <span className="text-sm font-bold text-amber-100 bg-black/10 px-3.5 py-1.5 rounded-lg whitespace-nowrap shadow-sm">
                      남은 문제: {previewModal.stats.hwQCount ?? 0}
                    </span>
                  </div>
                  <h3 className="text-[28px] font-black mb-1.5 leading-tight pr-[80px]">과제 클리닉</h3>
                  <p className="text-sm font-medium mt-0 mb-1.5 leading-snug text-amber-100 pr-[60px]">
                    미제출 과제 문항을 학습합니다.
                  </p>
                </div>
              </div>

              {/* 3. 미완료 과제 (OVERDUE) */}
              <div className="w-full h-[220px] bg-gradient-to-br from-rose-700 to-rose-600 rounded-[2rem] p-8 text-white shadow-xl relative overflow-hidden group flex flex-col justify-between">
                <div className="relative z-10 shrink-0">
                  <div className="flex flex-wrap items-center gap-2.5 mb-3">
                    <span className="text-sm font-black bg-rose-400 text-rose-900 px-4 py-2 rounded-xl shadow-sm flex items-center">⏰ 미완료 과제</span>
                  </div>
                  <div className="absolute top-0 right-0 flex flex-col items-end gap-2 z-20 w-auto">
                    <span className="text-sm font-bold text-rose-100 bg-black/10 px-3.5 py-1.5 rounded-lg whitespace-nowrap shadow-sm">
                      남은 문제: {previewModal.stats.overdueQCount ?? 0}
                    </span>
                  </div>
                  <h3 className="text-[28px] font-black mb-1.5 leading-tight pr-[80px]">미완료 과제 클리닉</h3>
                  <p className="text-sm font-medium mt-0 mb-1.5 leading-snug text-rose-100 pr-[60px]">
                    다음 수업 전까지 끝내지 못해 밀린 과제입니다.
                  </p>
                </div>
              </div>

              {/* 4. 오답 (PRINT) */}
              <div className="w-full h-[220px] bg-gradient-to-br from-emerald-700 to-emerald-600 rounded-[2rem] p-8 text-white shadow-xl relative overflow-hidden group flex flex-col justify-between">
                <div className="relative z-10 shrink-0">
                  <div className="flex flex-wrap items-center gap-2.5 mb-3">
                    <span className="text-sm font-black bg-emerald-400 text-emerald-900 px-4 py-2 rounded-xl shadow-sm flex items-center">🖨️ 누적 오답</span>
                  </div>
                  <div className="absolute top-0 right-0 flex flex-col items-end gap-2 z-20 w-auto">
                    <span className="text-sm font-bold text-emerald-100 bg-black/10 px-3.5 py-1.5 rounded-lg whitespace-nowrap shadow-sm">
                      남은 문제: {previewModal.stats.printQCount ?? 0}
                    </span>
                  </div>
                  <h3 className="text-[28px] font-black mb-1.5 leading-tight pr-[80px]">통합 오답 클리닉</h3>
                  <p className="text-sm font-medium mt-0 mb-1.5 leading-snug text-emerald-100 pr-[60px]">
                    틀린 문제들만 모아 다시 풉니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-8 py-5 bg-white border-t border-slate-200 text-center text-sm font-bold text-slate-500">
               학생이 포털 화면에서 마주하게 될 실제 디자인 및 잔여 문제(문항) 수와 동일하게 구성된 미리보기입니다.
            </div>
          </div>
        </div>
      )}

      {/* 🌟 [신규] 개별 오답 목록 관리 모달 UI */}
      {rawIncManageModal?.isOpen && (
        <div className="fixed inset-0 z-[110] flex justify-center items-center bg-slate-900/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out] p-4">
          <div className="bg-white w-[700px] max-h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 bg-rose-50 shrink-0">
              <h2 className="text-lg font-black text-rose-800 flex items-center gap-2">
                <span className="text-xl">✂️</span>
                {rawIncManageModal.studentName} 학생 - {rawIncManageModal.month}월 누적 오답 개별 관리
              </h2>
              <button onClick={() => setRawIncManageModal(null)} className="text-slate-400 hover:text-rose-600 transition-colors bg-white p-2 rounded-full shadow-sm">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto bg-slate-50 flex-1">
              {rawIncManageModal.records.length === 0 ? (
                 <div className="text-center py-20 text-slate-400 font-bold">이 달의 남은 미해결 오답이 없습니다.</div>
              ) : (
                 <div className="space-y-2">
                   {rawIncManageModal.records.map((r, i) => (
                      <div key={r.record_id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-3">
                           <span className="text-xs font-bold text-slate-400">{i + 1}</span>
                           <div className="flex flex-col">
                              <span className="text-sm font-bold text-slate-700">{formatDateLabel(r.created_at)} 발생</span>
                              <span className="text-xs font-bold text-slate-500 mt-0.5">출처: {r.source_type || '알 수 없음'}</span>
                           </div>
                        </div>
                        <div className="flex items-center gap-2">
                           <button 
                             onClick={() => handleViewSingleRawInc(r.question_id || r.tq_id)}
                             className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors border border-blue-200"
                           >
                             👁️ 눈으로 확인
                           </button>
                           <button 
                             onClick={() => handleDeleteSingleRawInc(r.record_id)}
                             className="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-xs font-bold transition-colors border border-rose-200"
                           >
                             🗑️ 해결(삭제) 처리
                           </button>
                        </div>
                      </div>
                   ))}
                 </div>
              )}
            </div>
            
            <div className="px-6 py-4 bg-white border-t border-slate-200 text-center">
              <span className="text-xs font-bold text-slate-500">
                 개별 삭제 처리된 문항은 '해결된 오답' 탭으로 이동하며 오답 클리닉에서 영구 제외됩니다.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 🌟 [신규] 개별 문항 눈으로 확인하기 전용 모달 UI */}
      {singleQuestionPreview && (() => {
        // question_db 테이블 스키마에 맞춘 완벽한 이미지/텍스트 파싱
        const qImg = singleQuestionPreview.image_url;
        const qImg2 = singleQuestionPreview.image_2_url;
        const aText = singleQuestionPreview.answer;
        const aImg = singleQuestionPreview.answer_image_url;
        const aImg2 = singleQuestionPreview.answer_image_2_url;
        const expText = singleQuestionPreview.explanation;
        const solText = singleQuestionPreview.solution;
        const qText = singleQuestionPreview.question;

        return (
          <div className="fixed inset-0 z-[120] flex justify-center items-center bg-slate-900/60 backdrop-blur-sm p-4 animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-white w-[700px] max-h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
              <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
                <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <span className="text-xl">👁️</span> 문항 및 정답 미리보기
                </h2>
                <button onClick={() => setSingleQuestionPreview(null)} className="text-slate-400 hover:text-rose-600 transition-colors bg-white p-2 rounded-full shadow-sm">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>

              <div className="p-6 overflow-y-auto bg-slate-100 flex-1 flex flex-col gap-6 custom-scrollbar">
                 {/* 문제 영역 */}
                 <div>
                    <h3 className="text-sm font-extrabold text-slate-500 mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>문제
                    </h3>
                    {qImg || qImg2 ? (
                      <div className="space-y-2 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        {qImg && <img src={qImg} alt="문제1" className="w-full object-contain" />}
                        {qImg2 && <img src={qImg2} alt="문제2" className="w-full object-contain mt-2 border-t border-slate-100 pt-2" />}
                      </div>
                    ) : qText ? (
                      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm text-slate-700 whitespace-pre-wrap">
                        {qText}
                      </div>
                    ) : (
                      <div className="w-full h-32 bg-white rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 font-bold text-sm shadow-sm">등록된 문제 데이터가 없습니다.</div>
                    )}
                 </div>

                 {/* 정답 및 해설 영역 */}
                 <div>
                    <h3 className="text-sm font-extrabold text-slate-500 mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>정답 및 해설
                    </h3>
                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
                        {/* 텍스트 정답 */}
                        {aText && (
                            <div className="text-lg font-black text-[#002864] bg-blue-50 p-3 rounded-lg text-center border border-blue-100">
                               정답: {aText}
                            </div>
                        )}
                        
                        {/* 이미지 정답 */}
                        {(aImg || aImg2) && (
                          <div className="space-y-2">
                             {aImg && <img src={aImg} alt="정답 이미지" className="w-full object-contain rounded-lg border border-slate-100" />}
                             {aImg2 && <img src={aImg2} alt="정답 이미지 2" className="w-full object-contain rounded-lg border border-slate-100" />}
                          </div>
                        )}

                        {/* 텍스트 풀이 및 해설 */}
                        {(expText || solText) && (
                          <div className="mt-2 text-sm text-slate-700 bg-slate-50 p-4 rounded-lg border border-slate-100 whitespace-pre-wrap leading-relaxed">
                            {solText && <div className="mb-2"><strong className="text-slate-800">풀이:</strong><br/>{solText}</div>}
                            {expText && <div><strong className="text-slate-800">해설:</strong><br/>{expText}</div>}
                          </div>
                        )}

                        {!aText && !aImg && !aImg2 && !expText && !solText && (
                          <div className="text-slate-400 font-bold text-sm text-center py-4">등록된 정답/해설 데이터가 없습니다.</div>
                        )}
                    </div>
                 </div>
              </div>
              
              <div className="px-6 py-4 bg-white border-t border-slate-200 flex justify-end shrink-0">
                <button onClick={() => setSingleQuestionPreview(null)} className="px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl shadow-sm transition-colors">
                   닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {isBulkModalOpen && (
        <div className="fixed inset-0 z-[100] flex justify-center items-center bg-slate-900/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white w-[600px] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 bg-violet-50 shrink-0">
              <h2 className="text-lg font-black text-violet-800 flex items-center gap-2">
                <span className="text-xl">🖨️</span>
                [{currentView.className}] 전원 맞춤 오답유사 일괄 생성
              </h2>
              <button disabled={bulkStatus.isRunning} onClick={() => setIsBulkModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-30">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>

            <div className="p-6 flex flex-col gap-6 bg-white">
              {bulkStatus.isRunning ? (
                <div className="flex flex-col items-center justify-center py-10 gap-4">
                   <div className="text-4xl animate-bounce">🚀</div>
                   <h3 className="text-xl font-extrabold text-slate-800">일괄 배부 진행 중입니다...</h3>
                   <div className="w-full bg-slate-100 rounded-full h-4 mt-2 overflow-hidden shadow-inner">
                      <div className="bg-violet-500 h-full transition-all duration-300" style={{ width: `${(bulkStatus.current / bulkStatus.total) * 100}%` }}></div>
                   </div>
                   <p className="text-sm font-bold text-slate-500">
                     ({bulkStatus.current} / {bulkStatus.total}) <span className="text-violet-600">{bulkStatus.studentName}</span> 생성 중...
                   </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-extrabold text-slate-800">1. 오답 추출 기간 설정</label>
                    <div className="flex items-center gap-3">
                      <input type="date" style={{ colorScheme: 'light' }} value={bulkStartDate} onChange={e => setBulkStartDate(e.target.value)} className="flex-1 px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-700 outline-none focus:border-violet-500" />
                      <span className="text-slate-400 font-bold">~</span>
                      <input type="date" style={{ colorScheme: 'light' }} value={bulkEndDate} onChange={e => setBulkEndDate(e.target.value)} className="flex-1 px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-700 outline-none focus:border-violet-500" />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 mt-2">
                    <label className="text-sm font-extrabold text-slate-800">2. 오답 지정 범위 설정</label>
                    <div className="flex flex-wrap gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={bulkFilters.exam} onChange={e => setBulkFilters(p => ({...p, exam: e.target.checked}))} className="w-4 h-4 rounded border-slate-300 accent-violet-500" />
                        <span className="text-[13px] font-bold text-slate-700">주간/중간테스트</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={bulkFilters.homework} onChange={e => setBulkFilters(p => ({...p, homework: e.target.checked}))} className="w-4 h-4 rounded border-slate-300 accent-violet-500" />
                        <span className="text-[13px] font-bold text-slate-700">과제</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={bulkFilters.overdue} onChange={e => setBulkFilters(p => ({...p, overdue: e.target.checked}))} className="w-4 h-4 rounded border-slate-300 accent-violet-500" />
                        <span className="text-[13px] font-bold text-slate-700">미완료과제</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={bulkFilters.print} onChange={e => setBulkFilters(p => ({...p, print: e.target.checked}))} className="w-4 h-4 rounded border-slate-300 accent-violet-500" />
                        <span className="text-[13px] font-bold text-slate-700">오답</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={bulkFilters.similar} onChange={e => setBulkFilters(p => ({...p, similar: e.target.checked}))} className="w-4 h-4 rounded border-slate-300 accent-violet-500" />
                        <span className="text-[13px] font-bold text-slate-700">오답유사</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 mt-2">
                    <label className="text-sm font-extrabold text-slate-800">3. 생성 옵션 설정</label>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-[14px] font-bold text-slate-600 leading-loose shadow-sm break-keep">
                      해당 기간 오답의 <span className="text-violet-500 font-black">쌍둥이</span>
                      <select value={bulkTwin} onChange={e => setBulkTwin(Number(e.target.value))} className="border border-slate-300 rounded-md mx-2 p-1.5 outline-none text-slate-800 bg-white focus:border-violet-500 font-black shadow-sm">
                        {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>개와 <span className="text-violet-500 font-black">유사</span>
                      <select value={bulkSim} onChange={e => setBulkSim(Number(e.target.value))} className="border border-slate-300 rounded-md mx-2 p-1.5 outline-none text-slate-800 bg-white focus:border-violet-500 font-black shadow-sm">
                        {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>개로 학습지를 만듭니다. 난이도는
                      <select value={bulkDiff} onChange={e => setBulkDiff(e.target.value)} className="border border-slate-300 rounded-md mx-2 p-1.5 outline-none text-slate-800 bg-white focus:border-violet-500 font-black shadow-sm">
                        <option value="그대로">그대로</option><option value="더 쉽게">더 쉽게</option><option value="더 어렵게">더 어렵게</option>
                      </select> 출제합니다.
                      
                      <div className="mt-4 pt-4 border-t border-slate-200 flex flex-col gap-3">
                        <label className="flex items-center gap-2 cursor-pointer group w-max">
                          <input type="checkbox" checked={bulkExclude} onChange={e => setBulkExclude(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-violet-500" />
                          <span className="text-[13px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">기존에 이미 틀렸던 원본 문제는 포함하지 않기</span>
                        </label>

                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 cursor-pointer group">
                            <input type="checkbox" checked={bulkLimitActive} onChange={(e) => setBulkLimitActive(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-violet-500" />
                            <span className="text-[13px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">한 유형당 최대 </span>
                          </label>
                          <div className={`flex items-center border rounded shadow-sm overflow-hidden transition-colors ${bulkLimitActive ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                            <button onClick={() => setBulkLimit(p => Math.max(1, p - 1))} disabled={!bulkLimitActive} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-r border-slate-200 transition-colors font-bold disabled:opacity-40">−</button>
                            <input type="text" value={bulkLimit} readOnly className="w-10 text-center text-[13px] font-bold text-slate-700 outline-none bg-transparent" />
                            <button onClick={() => setBulkLimit(p => p + 1)} disabled={!bulkLimitActive} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-l border-slate-200 transition-colors font-bold disabled:opacity-40">+</button>
                          </div>
                          <span className="text-[13px] font-bold text-slate-700">문제까지만 제한</span>
                        </div>

                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 cursor-pointer group">
                            <input type="checkbox" checked={bulkTotalLimitActive} onChange={(e) => setBulkTotalLimitActive(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-violet-500" />
                            <span className="text-[13px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">학생당 총 출제 문항 수 제한</span>
                          </label>
                          <div className={`flex items-center border rounded shadow-sm overflow-hidden transition-colors ${bulkTotalLimitActive ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                            <button onClick={() => setBulkTotalLimit(p => Math.max(1, p - 1))} disabled={!bulkTotalLimitActive} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-r border-slate-200 transition-colors font-bold disabled:opacity-40">−</button>
                            <input type="text" value={bulkTotalLimit} readOnly className="w-10 text-center text-[13px] font-bold text-slate-700 outline-none bg-transparent" />
                            <button onClick={() => setBulkTotalLimit(p => p + 1)} disabled={!bulkTotalLimitActive} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-l border-slate-200 transition-colors font-bold disabled:opacity-40">+</button>
                          </div>
                          <span className="text-[13px] font-bold text-slate-700">문제까지만 출제</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer group w-max">
                      <input 
                        type="checkbox" 
                        checked={isBulkTargetDateActive} 
                        onChange={e => setIsBulkTargetDateActive(e.target.checked)} 
                        className="w-4 h-4 rounded border-slate-300 accent-violet-500 cursor-pointer" 
                      />
                      <span className="text-sm font-extrabold text-slate-800">
                        4. 클리닉 수행 목표일 지정 <span className="text-xs text-slate-400 font-medium">(선택)</span>
                      </span>
                    </label>
                    <div className={`flex items-center gap-3 transition-opacity ${!isBulkTargetDateActive ? 'opacity-40 pointer-events-none' : ''}`}>
                      <input 
                        type="date" 
                        style={{ colorScheme: 'light' }}
                        value={bulkTargetDate} 
                        onChange={e => setBulkTargetDate(e.target.value)} 
                        disabled={!isBulkTargetDateActive}
                        className="flex-1 px-4 py-3 bg-violet-50 border border-violet-200 rounded-xl font-bold text-violet-700 outline-none focus:border-violet-500 shadow-sm disabled:bg-slate-100 disabled:border-slate-200 disabled:text-slate-400" 
                      />
                      <span className="text-[12px] font-bold text-slate-500 flex-1 pl-2">
                        지정된 날짜가 학생 화면에 표시되어, <br/> 언제 풀어야 하는지 명확히 인지하게 합니다.
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-4">
                    <button onClick={() => setIsBulkModalOpen(false)} className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-extrabold rounded-xl transition-colors">취소</button>
                    <button onClick={handleRunBulkPrint} className="flex-1 py-4 bg-violet-500 hover:bg-violet-600 text-white font-extrabold rounded-xl shadow-md transition-colors">🚀 전원 일괄 배부하기</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}