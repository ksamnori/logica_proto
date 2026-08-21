// src/app/(dashboard)/learning/hooks/useLearningActions.ts
import { supabase } from "@/lib/supabase";
import { StudentInfo, ViewState, TabType } from "../types";

interface ActionProps {
  currentView: ViewState;
  activeTab: TabType;
  allStudentsList: StudentInfo[];
  selectedBlocks: string[];
  setSelectedBlocks: React.Dispatch<React.SetStateAction<string[]>>;
  globalSelectedBlocks: string[];
  setGlobalSelectedBlocks: React.Dispatch<React.SetStateAction<string[]>>;
  setIsLoading: (val: boolean) => void;
  setIsGeneratingPrint: (val: boolean) => void;
  setDateFilter: (val: 'ALL' | '1W' | '1M') => void;
  fetchStudentTimeline: (sId: string, cId: string, all: StudentInfo[]) => void;
  fetchGlobalListForTab: (tab: TabType, all: StudentInfo[]) => void;
  fetchStatsForTab: (all: StudentInfo[]) => void;
}

export function useLearningActions({
  currentView, activeTab, allStudentsList,
  selectedBlocks, setSelectedBlocks, globalSelectedBlocks, setGlobalSelectedBlocks,
  setIsLoading, setIsGeneratingPrint, setDateFilter,
  fetchStudentTimeline, fetchGlobalListForTab, fetchStatsForTab
}: ActionProps) {

  const handleBulkCompleteGlobal = async () => {
    if (globalSelectedBlocks.length === 0) return;
    if (!confirm(`선택한 ${globalSelectedBlocks.length}개의 항목을 강제로 '채점완료' 처리하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      for (const block of globalSelectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('print_') || block.startsWith('hw_exam_')) {
          const aId = block.startsWith('hw_exam_') ? block.split('_')[2] : block.split('_')[1];
          const { error } = await supabase.from('exam_assignment').update({ status: '채점완료' }).eq('assignment_id', aId);
          if (error) throw error;
        } else if (block.startsWith('hw_')) {
          const hwId = Number(block.split('_')[1]);
          const stId = block.split('_')[2];
          const { data: existing, error: findErr } = await supabase.from('student_homework_result').select('hw_result_id').eq('homework_id', hwId).eq('student_id', stId).maybeSingle();
          if (findErr) throw findErr;

          if (existing) {
            const { error } = await supabase.from('student_homework_result').update({ status: '채점완료', checked_at: new Date().toISOString() }).eq('hw_result_id', existing.hw_result_id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('student_homework_result').insert({
              homework_id: hwId, student_id: stId, status: '채점완료', checked_at: new Date().toISOString(), completed_tq_ids: [] 
            });
            if (error) throw error;
          }
        }
      }
      alert("✅ 선택 항목이 일괄 완료처리 되었습니다.");
      setGlobalSelectedBlocks([]);
      fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch(e: any) {
      console.error(e);
      alert("처리 중 오류가 발생했습니다: " + e.message);
      setIsLoading(false);
    }
  };

  const handleBulkDeleteGlobal = async () => {
    if (globalSelectedBlocks.length === 0) return;
    if (!confirm(`선택한 ${globalSelectedBlocks.length}개의 항목을 완전히 삭제하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      for (const block of globalSelectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('hw_exam_')) {
          const aId = block.startsWith('hw_exam_') ? block.split('_')[2] : block.split('_')[1];
          await supabase.from('student_answer').delete().eq('exam_assignment_id', aId);
          await supabase.from('exam_assignment').delete().eq('assignment_id', aId);
        } else if (block.startsWith('print_')) {
          const assignId = block.split('_')[1];
          const {data} = await supabase.from('exam_assignment').select('exam_id').eq('assignment_id', assignId).single();
          if(data) {
             await supabase.from('student_answer').delete().eq('exam_assignment_id', assignId);
             await supabase.from('exam_assignment').delete().eq('assignment_id', assignId);
             await supabase.from('exam_item').delete().eq('exam_id', data.exam_id);
             await supabase.from('exam_master').delete().eq('exam_id', data.exam_id);
          }
        } else if (block.startsWith('hw_')) {
          const hwId = block.split('_')[1];
          const studentId = block.split('_')[2];
          await supabase.from('student_homework_answer').delete().eq('homework_id', hwId).eq('student_id', studentId);
          await supabase.from('student_homework_result').delete().eq('homework_id', hwId).eq('student_id', studentId);
          const { count } = await supabase.from('student_homework_result').select('*', { count: 'exact', head: true }).eq('homework_id', hwId);
          if (count === 0) await supabase.from('homework_assignment').delete().eq('homework_id', hwId);
        }
      }
      alert("🗑️ 선택 항목이 삭제되었습니다.");
      setGlobalSelectedBlocks([]);
      fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch(e: any) {
       console.error(e);
       alert("삭제 중 오류가 발생했습니다.");
       setIsLoading(false);
    }
  };

  const handleBulkCompleteStudent = async () => {
    if (selectedBlocks.length === 0) return;
    if (!confirm(`선택한 ${selectedBlocks.length}개의 항목을 강제로 '채점완료' 처리하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      for (const block of selectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('print_') || block.startsWith('hw_exam_')) {
          const assignId = block.split('_').pop();
          const { error } = await supabase.from('exam_assignment').update({ status: '채점완료' }).eq('assignment_id', assignId);
          if (error) throw error;
        } else if (block.startsWith('hw_')) {
          const hwId = Number(block.split('_')[1]);
          const { data: existing, error: findErr } = await supabase.from('student_homework_result').select('hw_result_id').eq('homework_id', hwId).eq('student_id', currentView.studentId).maybeSingle();
          if (findErr) throw findErr;

          if (existing) {
            const { error } = await supabase.from('student_homework_result').update({ status: '채점완료', checked_at: new Date().toISOString() }).eq('hw_result_id', existing.hw_result_id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('student_homework_result').insert({
              homework_id: hwId, student_id: currentView.studentId, status: '채점완료', checked_at: new Date().toISOString(), completed_tq_ids: [] 
            });
            if (error) throw error;
          }
        }
      }
      alert("✅ 선택 항목이 일괄 완료처리 되었습니다.");
      setSelectedBlocks([]);
      fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch(e: any) {
       console.error(e);
       alert("처리 중 오류가 발생했습니다: " + e.message);
       setIsLoading(false);
    }
  };

  const handleBulkDeleteStudent = async () => {
    if (selectedBlocks.length === 0) return;
    if (!confirm(`선택한 ${selectedBlocks.length}개의 항목을 완전히 삭제하시겠습니까?\n(주의: 교재 과제의 경우 반 전체 기록이 함께 삭제됩니다.)`)) return;
    setIsLoading(true);
    try {
      for (const block of selectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('hw_exam_')) {
          const assignId = block.split('_').pop();
          await supabase.from('student_answer').delete().eq('exam_assignment_id', assignId);
          await supabase.from('exam_assignment').delete().eq('assignment_id', assignId);
        } else if (block.startsWith('print_')) {
          const assignId = block.split('_')[1];
          const {data} = await supabase.from('exam_assignment').select('exam_id').eq('assignment_id', assignId).single();
          if(data) {
             await supabase.from('student_answer').delete().eq('exam_assignment_id', assignId);
             await supabase.from('exam_assignment').delete().eq('assignment_id', assignId);
             await supabase.from('exam_item').delete().eq('exam_id', data.exam_id);
             await supabase.from('exam_master').delete().eq('exam_id', data.exam_id);
          }
        } else if (block.startsWith('hw_')) {
          const hwId = block.split('_')[1];
          await supabase.from('student_homework_answer').delete().eq('homework_id', hwId).eq('student_id', currentView.studentId);
          await supabase.from('student_homework_result').delete().eq('homework_id', hwId).eq('student_id', currentView.studentId);
          const { count } = await supabase.from('student_homework_result').select('*', { count: 'exact', head: true }).eq('homework_id', hwId);
          if (count === 0) await supabase.from('homework_assignment').delete().eq('homework_id', hwId);
        }
      }
      alert("🗑️ 선택 항목이 삭제되었습니다.");
      setSelectedBlocks([]);
      fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch(e: any) {
       console.error(e);
       alert("삭제 중 오류가 발생했습니다.");
       setIsLoading(false);
    }
  };

  const handleForceComplete = async (e: React.MouseEvent, type: string, id: string, targetStudentId: string) => {
    e.stopPropagation();
    if (!confirm("이 항목을 강제로 '채점완료' 처리하시겠습니까?")) return;
    
    try {
      if (type === 'exam' || type === 'print') {
        const { error } = await supabase.from('exam_assignment').update({ status: '채점완료' }).eq('assignment_id', id);
        if (error) throw error;
      } else if (type === 'hw') {
        const { data: existing, error: findErr } = await supabase.from('student_homework_result').select('hw_result_id').eq('homework_id', id).eq('student_id', targetStudentId).maybeSingle();
        if (findErr) throw findErr;

        if (existing) {
          const { error } = await supabase.from('student_homework_result').update({ status: '채점완료', checked_at: new Date().toISOString() }).eq('hw_result_id', existing.hw_result_id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('student_homework_result').insert({
            homework_id: Number(id), student_id: targetStudentId, status: '채점완료', checked_at: new Date().toISOString(), completed_tq_ids: [] 
          });
          if (error) throw error;
        }
      }
      
      alert("✅ 채점 완료 처리되었습니다.");
      if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      else fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch (err: any) {
      console.error(err);
      alert("완료 처리 중 오류가 발생했습니다: " + err.message);
    }
  };

  const handleDeleteExam = async (assignmentId: string, studentId: string) => {
    if (!confirm("해당 출제를 완전히 취소 및 삭제하시겠습니까?")) return;
    try {
      await supabase.from('student_answer').delete().eq('exam_assignment_id', assignmentId);
      await supabase.from('exam_assignment').delete().eq('assignment_id', assignmentId);
      
      if (currentView.type === 'STUDENT') fetchStudentTimeline(studentId, currentView.classId, allStudentsList);
      else fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch (e) { alert("삭제 실패"); }
  };

  const handleEditHomeworkTitle = async (hwId: string, oldTitle: string) => {
    const newTitle = window.prompt("수정할 과제 제목을 입력하세요:", oldTitle);
    if (!newTitle || newTitle.trim() === '' || newTitle === oldTitle) return;
    try {
      await supabase.from('homework_assignment').update({ homework_title: newTitle.trim() }).eq('homework_id', hwId);
      if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      else fetchGlobalListForTab('HOMEWORK', allStudentsList);
    } catch (e) { alert("수정 실패"); }
  };

  const handleDeleteHomework = async (hwId: string, studentId: string) => {
    if (!confirm("이 교재 과제를 완전히 삭제하시겠습니까?\n(주의: 반 전체에 부여된 과제인 경우 모든 학생의 기록이 함께 삭제됩니다.)")) return;
    try {
      await supabase.from('student_homework_answer').delete().eq('homework_id', hwId);
      await supabase.from('student_homework_result').delete().eq('homework_id', hwId);
      await supabase.from('homework_assignment').delete().eq('homework_id', hwId);
      
      if (currentView.type === 'STUDENT') fetchStudentTimeline(studentId, currentView.classId, allStudentsList);
      else fetchGlobalListForTab('HOMEWORK', allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch (e) { alert("삭제 실패"); }
  };

  const handleDeletePrint = async (assignmentId: string, examId: string) => {
    if (!confirm("해당 오답 프린트를 완전히 삭제하시겠습니까?")) return;
    try {
      await supabase.from('student_answer').delete().eq('exam_assignment_id', assignmentId);
      await supabase.from('exam_assignment').delete().eq('assignment_id', assignmentId);
      await supabase.from('exam_item').delete().eq('exam_id', examId);
      await supabase.from('exam_master').delete().eq('exam_id', examId);
      
      if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      else fetchGlobalListForTab('INCORRECT', allStudentsList);
    } catch (e) { alert("삭제 실패"); }
  };

  const handlePrintItem = async (e: React.MouseEvent, type: string, masterId: any, targetQuestions?: any[], title?: string, subTitle?: string) => {
    e.stopPropagation();
    
    if (type === 'hw') {
      if (!targetQuestions || targetQuestions.length === 0) { alert('출력할 문항이 없습니다.'); return; }
      try {
        setIsLoading(true);
        const tqIds = targetQuestions.map(id => Number(id)).filter(id => !isNaN(id));
        const { data: tqData, error } = await supabase.from('textbook_question').select('tq_id, question_id').in('tq_id', tqIds);
        if (error) throw error;

        const tqMap = new Map();
        tqData?.forEach(item => { if (item.question_id) tqMap.set(item.tq_id, item.question_id); });
        const qIds = tqIds.map(id => tqMap.get(id)).filter(Boolean);

        if (qIds.length === 0) { alert('해당 과제에 연결된 실제 문항 데이터를 찾을 수 없습니다.'); return; }

        sessionStorage.setItem('examQuestions', JSON.stringify(qIds));
        sessionStorage.setItem('examTitle', title || '교재 과제');
        sessionStorage.setItem('examSubTitle', subTitle || '과제 프린트');
        sessionStorage.setItem('examType', '과제프린트');
        sessionStorage.removeItem('editExamId');
        sessionStorage.removeItem('duplicateExamId');
        sessionStorage.removeItem('isClinicMode');
        
        window.open('/exam/viewer', '_blank');
      } catch (err: any) {
        console.error(err);
        alert('프린트 문항 정보를 불러오는 중 오류가 발생했습니다.');
      } finally { setIsLoading(false); }
      
    } else {
      if (!masterId) { alert('시험지 정보를 찾을 수 없습니다.'); return; }
      window.open(`/exam/viewer?exam_id=${masterId}`, '_blank');
    }
  };

  const handleEditHomeworkToStep2 = async (e: React.MouseEvent, type: string, hwId: any, targetQuestions?: any[], title?: string) => {
    e.stopPropagation();
    if (type !== 'hw') return;
    if (!targetQuestions || targetQuestions.length === 0) { alert('수정할 문항이 없습니다.'); return; }

    try {
      setIsLoading(true);
      const tqIds = targetQuestions.map(id => Number(id)).filter(id => !isNaN(id));
      const { data: tqData, error } = await supabase.from('textbook_question').select('tq_id, question_id').in('tq_id', tqIds);
      if (error) throw error;

      const tqMap = new Map();
      tqData?.forEach(item => { if (item.question_id) tqMap.set(item.tq_id, item.question_id); });
      const qIds = tqIds.map(id => tqMap.get(id)).filter(Boolean);

      if (qIds.length === 0) { alert('연결된 문제 데이터를 찾을 수 없습니다.'); return; }

      sessionStorage.setItem('restoreExamQuestions', '1');
      sessionStorage.setItem('examQuestions', JSON.stringify(qIds));
      sessionStorage.setItem('examTitle', title || '과제 문항 수정');
      sessionStorage.setItem('editHomeworkId', String(hwId)); 

      window.location.href = '/exam/step2?source=homework_edit';

    } catch (err: any) {
      console.error(err);
      alert('문항 정보를 불러오는 중 오류가 발생했습니다.');
    } finally { setIsLoading(false); }
  };

  const handleGenerateIncorrectPrint = async () => {
    if (selectedBlocks.length === 0) { alert('오답 프린트로 묶을 블록을 하나 이상 선택해주세요.'); return; }
    const myTenantId = localStorage.getItem("logica_tenant_id");
    if (!myTenantId) return alert("소속 지점 정보가 없습니다. 다시 로그인 해주세요.");

    setIsGeneratingPrint(true);
    try {
      let targetQIds: number[] = [];
      for (const block of selectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('hw_exam_') || block.startsWith('print_')) {
          const assignId = block.split('_').pop();
          const { data: ans } = await supabase.from('student_answer').select('question_id, grading_code').eq('exam_assignment_id', assignId).in('grading_code', ['X', 'TX', '☆', 'B']);
          ans?.forEach(a => { if(a.question_id) targetQIds.push(a.question_id); });
        }
        else if (block.startsWith('hw_')) {
          const hwId = block.split('_')[1];
          const { data: hwAns } = await supabase.from('student_homework_answer').select('tq_id, grading_code').eq('homework_id', hwId).eq('student_id', currentView.studentId).in('grading_code', ['X', 'TX', '☆', 'B']);
          if (hwAns && hwAns.length > 0) {
            const tqIds = hwAns.map(a => a.tq_id);
            const { data: tqs } = await supabase.from('textbook_question').select('question_id').in('tq_id', tqIds);
            tqs?.forEach(t => { if(t.question_id) targetQIds.push(t.question_id); });
          }
        }
      }

      targetQIds = [...new Set(targetQIds)];
      if (targetQIds.length > 0) {
        const { data: records } = await supabase.from('student_incorrect_record').select('question_id').eq('student_id', currentView.studentId).is('resolved_at', null).in('question_id', targetQIds);
        targetQIds = records?.map(r => r.question_id) || [];
      }

      if (targetQIds.length === 0) {
        alert('선택하신 항목들에는 아직 미해결 상태인 오답 문항(X, TX, 별, 빈칸)이 존재하지 않습니다.\n(모두 해결되었거나 원래 틀린 문제가 없습니다.)');
        setIsGeneratingPrint(false);
        return;
      }

      const todayStr = new Date().toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
      const title = `[${currentView.studentName}] 통합 오답 프린트 (${todayStr})`;
      const { data: inst } = await supabase.from('class').select('instructor_id').eq('class_id', currentView.classId).single();
      const instId = inst?.instructor_id || localStorage.getItem('logica_instructor_id');

      const { data: exMaster, error: exErr } = await supabase.from('exam_master').insert({
        title, exam_type: '오답프린트', instructor_id: instId, total_questions: targetQIds.length, tenant_id: myTenantId
      }).select().single();

      if (exErr) throw exErr;

      const items = targetQIds.map((qid, idx) => ({
        exam_id: exMaster.exam_id, question_id: qid, sort_order: idx + 1, assigned_score: Math.round(100 / targetQIds.length)
      }));
      await supabase.from('exam_item').insert(items);
      await supabase.from('exam_assignment').insert({
        exam_id: exMaster.exam_id, student_id: currentView.studentId, class_id: currentView.classId, status: '미응시'
      });

      alert(`🎉 오답 프린트가 완성되었습니다! (총 ${targetQIds.length}문항)\n\n오답 관리 탭이나 문제지 보관함에서 확인 가능합니다.`);
      setSelectedBlocks([]);
      setDateFilter('ALL');
    } catch (e: any) {
      console.error(e);
      alert('오답 프린트 생성 중 오류가 발생했습니다: ' + e.message);
    } finally { setIsGeneratingPrint(false); }
  };

  return {
    handleForceComplete, handleDeleteExam, handleEditHomeworkTitle,
    handleDeleteHomework, handleDeletePrint, handlePrintItem, handleEditHomeworkToStep2,
    handleBulkCompleteGlobal, handleBulkDeleteGlobal, handleBulkCompleteStudent,
    handleBulkDeleteStudent, handleGenerateIncorrectPrint
  };
}