// src/app/(dashboard)/learning/hooks/useLearningActions.ts
import { supabase } from "@/lib/supabase";
import { StudentInfo, ViewState, TabType } from "../types";
import { toast } from "react-toastify"; 

interface ActionProps {
  currentView: ViewState;
  activeTab: TabType | string; // 🌟 타입 에러 방지를 위해 string 허용
  allStudentsList: StudentInfo[];
  selectedBlocks: string[];
  setSelectedBlocks: React.Dispatch<React.SetStateAction<string[]>>;
  globalSelectedBlocks: string[];
  setGlobalSelectedBlocks: React.Dispatch<React.SetStateAction<string[]>>;
  setIsLoading: (val: boolean) => void;
  setIsGeneratingPrint: (val: boolean) => void;
  setDateFilter: (val: 'ALL' | '1W' | '1M') => void;
  fetchStudentTimeline: (sId: string, cId: string, all: StudentInfo[]) => void;
  fetchGlobalListForTab: (tab: TabType | string, all: StudentInfo[]) => void; // 🌟 타입 에러 방지
  fetchStatsForTab: (all: StudentInfo[]) => void;
}

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
    return [];
  }
  return [];
};

const purgeOldSession = () => {
  const keysToRemove = [
    'restoreExamQuestions', 'examQuestions', 'examTitle', 'examSubTitle', 'examType',
    'editOriginalType', 'editOriginalId', 'editStudentId', 'editClassId', 'editMasterId',
    'examUserMergedTextQuestions', 'clinicTargetStudentId', 'clinicTargetClassId', 'clinicTargetStudentIds',
    'editHomeworkId', 'editExamId', 'duplicateExamId', 'splitHomeworkIds', 'splitCommonTqIds'
  ];
  keysToRemove.forEach(k => sessionStorage.removeItem(k));
};

export function useLearningActions({
  currentView, activeTab, allStudentsList,
  selectedBlocks, setSelectedBlocks, globalSelectedBlocks, setGlobalSelectedBlocks,
  setIsLoading, setIsGeneratingPrint, setDateFilter,
  fetchStudentTimeline, fetchGlobalListForTab, fetchStatsForTab
}: ActionProps) {

  const handleExtractCommonHomework = async () => {
    const listToUse = currentView.type === 'STUDENT' ? selectedBlocks : globalSelectedBlocks;
    const isStudentView = currentView.type === 'STUDENT';
    
    if (listToUse.length < 2) {
      toast.warning("공통 문항을 추출할 2개 이상의 과제를 선택해주세요.");
      return;
    }
    
    const hwIds = listToUse.map(b => b.startsWith('hw_exam_') ? b.split('_')[2] : b.split('_')[1]);
    
    setIsLoading(true);
    try {
      const { data: assignments, error } = await supabase.from('homework_assignment')
        .select('homework_id, target_questions, is_exam_hw')
        .in('homework_id', hwIds);
        
      if (error || !assignments) throw new Error("과제 정보를 불러올 수 없습니다.");

      const isMixed = assignments.some(a => a.is_exam_hw) && assignments.some(a => !a.is_exam_hw);
      if (isMixed) throw new Error("교재 기반 과제와 문제지 기반 과제는 함께 병합할 수 없습니다. 같은 종류끼리만 선택해주세요.");

      let allQuestions: any[] = [];
      
      assignments.forEach(a => {
        let tq = typeof a.target_questions === 'string' ? JSON.parse(a.target_questions) : a.target_questions;
        if (Array.isArray(tq)) allQuestions.push(...tq);
      });
      
      const counts: Record<string, number> = {};
      allQuestions.forEach(q => counts[q] = (counts[q] || 0) + 1);
      
      const commonQuestions = Object.keys(counts).filter(q => counts[q] === assignments.length);
      
      if (commonQuestions.length === 0) {
        setIsLoading(false);
        toast.error("선택된 과제들 사이에 공통된 문항이 없습니다.");
        return;
      }

      sessionStorage.clear();
      
      if (assignments[0].is_exam_hw) {
        sessionStorage.setItem('examQuestions', JSON.stringify(commonQuestions));
        sessionStorage.setItem('examTitle', '[병합] 오답 및 유사 문제 프린트');
        sessionStorage.setItem('examType', '과제프린트');
        
        if (isStudentView) {
          sessionStorage.setItem('clinicTargetStudentId', currentView.studentId);
          sessionStorage.setItem('clinicTargetClassId', currentView.classId || '');
          sessionStorage.setItem('isClinicMode', 'true');
        } else {
          sessionStorage.setItem('isClinicMode', 'false');
        }
        window.location.href = '/exam/step2';
      } else {
        sessionStorage.setItem('hwQuestions', JSON.stringify(commonQuestions));
        sessionStorage.setItem('hwTitle', '[병합] 복습 및 오답 교재 과제');
        
        if (isStudentView) {
          sessionStorage.setItem('clinicTargetStudentId', currentView.studentId);
          sessionStorage.setItem('clinicTargetClassId', currentView.classId || '');
          sessionStorage.setItem('isClinicMode', 'true');
        } else {
          sessionStorage.setItem('isClinicMode', 'false');
        }
        window.location.href = '/homework/step2';
      }
      
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "오류가 발생했습니다.");
      setIsLoading(false);
    }
  };

  const handleBulkCompleteGlobal = async () => {
    if (globalSelectedBlocks.length === 0) return;
    if (!confirm(`선택한 ${globalSelectedBlocks.length}개의 항목을 강제로 '채점완료' 처리하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      for (const block of globalSelectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('print_') || block.startsWith('similar_') || block.startsWith('overdue_') || block.startsWith('hw_exam_')) {
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
      toast.success("✅ 선택 항목이 일괄 완료처리 되었습니다.");
      setGlobalSelectedBlocks([]);
      fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch(e: any) {
      console.error(e);
      toast.error("처리 중 오류가 발생했습니다.");
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
        } else if (block.startsWith('print_') || block.startsWith('similar_') || block.startsWith('overdue_')) {
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
      toast.success("🗑️ 선택 항목이 삭제되었습니다.");
      setGlobalSelectedBlocks([]);
      fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch(e: any) {
       console.error(e);
       toast.error("삭제 중 오류가 발생했습니다.");
       setIsLoading(false);
    }
  };

  const handleBulkCompleteStudent = async () => {
    if (selectedBlocks.length === 0) return;
    if (!confirm(`선택한 ${selectedBlocks.length}개의 항목을 강제로 '채점완료' 처리하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      for (const block of selectedBlocks) {
        if (block.startsWith('exam_') || block.startsWith('print_') || block.startsWith('similar_') || block.startsWith('overdue_') || block.startsWith('hw_exam_')) {
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
      toast.success("✅ 선택 항목이 일괄 완료처리 되었습니다.");
      setSelectedBlocks([]);
      fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch(e: any) {
       console.error(e);
       toast.error("처리 중 오류가 발생했습니다.");
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
        } else if (block.startsWith('print_') || block.startsWith('similar_') || block.startsWith('overdue_')) {
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
      toast.success("🗑️ 선택 항목이 삭제되었습니다.");
      setSelectedBlocks([]);
      fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch(e: any) {
       console.error(e);
       toast.error("삭제 중 오류가 발생했습니다.");
       setIsLoading(false);
    }
  };

  const handleForceComplete = async (e: React.MouseEvent, type: string, id: string, targetStudentId: string) => {
    e.stopPropagation();
    if (!confirm("이 항목을 강제로 '채점완료' 처리하시겠습니까?")) return;
    
    try {
      if (type === 'exam' || type === 'print' || type === 'similar' || type === 'overdue' || type === 'hw_exam') {
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
      
      toast.success("✅ 채점 완료 처리되었습니다.");
      if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      else fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch (err: any) {
      console.error(err);
      toast.error("완료 처리 중 오류가 발생했습니다.");
    }
  };

  const handleDeleteExam = async (assignmentId: string, studentId: string) => {
    if (!confirm("해당 출제를 완전히 취소 및 삭제하시겠습니까?")) return;
    try {
      await supabase.from('student_answer').delete().eq('exam_assignment_id', assignmentId);
      await supabase.from('exam_assignment').delete().eq('assignment_id', assignmentId);
      
      toast.success("🗑️ 삭제되었습니다.");
      if (currentView.type === 'STUDENT') fetchStudentTimeline(studentId, currentView.classId, allStudentsList);
      else fetchGlobalListForTab(activeTab, allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch (e) { toast.error("삭제 실패"); }
  };

  const handleEditHomeworkTitle = async (hwId: string, oldTitle: string) => {
    const newTitle = window.prompt("수정할 과제 제목을 입력하세요:", oldTitle);
    if (!newTitle || newTitle.trim() === '' || newTitle === oldTitle) return;
    try {
      await supabase.from('homework_assignment').update({ homework_title: newTitle.trim() }).eq('homework_id', hwId);
      toast.success("제목이 수정되었습니다.");
      if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      else fetchGlobalListForTab('HOMEWORK', allStudentsList);
    } catch (e) { toast.error("수정 실패"); }
  };

  const handleDeleteHomework = async (hwId: string, studentId: string) => {
    if (!confirm("이 교재 과제를 완전히 삭제하시겠습니까?\n(주의: 반 전체에 부여된 과제인 경우 모든 학생의 기록이 함께 삭제됩니다.)")) return;
    try {
      await supabase.from('student_homework_answer').delete().eq('homework_id', hwId);
      await supabase.from('student_homework_result').delete().eq('homework_id', hwId);
      await supabase.from('homework_assignment').delete().eq('homework_id', hwId);
      
      toast.success("🗑️ 삭제되었습니다.");
      if (currentView.type === 'STUDENT') fetchStudentTimeline(studentId, currentView.classId, allStudentsList);
      else fetchGlobalListForTab('HOMEWORK', allStudentsList);
      fetchStatsForTab(allStudentsList);
    } catch (e) { toast.error("삭제 실패"); }
  };

  const handleDeletePrint = async (assignmentId: string, examId: string) => {
    if (!confirm("해당 프린트를 완전히 삭제하시겠습니까?")) return;
    try {
      await supabase.from('student_answer').delete().eq('exam_assignment_id', assignmentId);
      await supabase.from('exam_assignment').delete().eq('assignment_id', assignmentId);
      await supabase.from('exam_item').delete().eq('exam_id', examId);
      await supabase.from('exam_master').delete().eq('exam_id', examId);
      
      toast.success("🗑️ 프린트가 삭제되었습니다.");
      if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
      else {
        if (activeTab === 'INCORRECT' || activeTab === 'SIMILAR' || activeTab === 'OVERDUE') fetchGlobalListForTab(activeTab, allStudentsList);
      }
    } catch (e) { toast.error("삭제 실패"); }
  };

  const handlePrintItem = async (e: React.MouseEvent, type: string, masterId: any, targetQuestions?: any[], title?: string, subTitle?: string) => {
    e.stopPropagation();
    
    let qIds: any[] = [];
    if (targetQuestions) {
        if (typeof targetQuestions === 'string') {
            try { qIds = JSON.parse(targetQuestions); } catch(err){}
        } else if (Array.isArray(targetQuestions)) {
            qIds = targetQuestions;
        }
    }
    
    if (type === 'hw') {
      if (qIds.length === 0) { toast.warning('출력할 문항이 없습니다.'); return; }
      try {
        setIsLoading(true);
        const tqIds = qIds.map(id => Number(id)).filter(id => !isNaN(id));
        const { data: tqData, error } = await supabase.from('textbook_question').select('tq_id, question_id').in('tq_id', tqIds);
        if (error) throw error;

        const tqMap = new Map();
        tqData?.forEach(item => { if (item.question_id) tqMap.set(item.tq_id, item.question_id); });
        const finalQIds = tqIds.map(id => tqMap.get(id)).filter(Boolean);

        if (finalQIds.length === 0) { toast.error('해당 과제에 연결된 실제 문항 데이터를 찾을 수 없습니다.'); return; }

        purgeOldSession();
        
        sessionStorage.setItem('examQuestions', JSON.stringify(finalQIds));
        sessionStorage.setItem('examTitle', title || '교재 과제');
        sessionStorage.setItem('examSubTitle', subTitle || '과제 프린트');
        sessionStorage.setItem('examType', '과제프린트');
        
        window.open('/exam/viewer', '_blank');
      } catch (err: any) {
        console.error(err);
        toast.error('프린트 문항 정보를 불러오는 중 오류가 발생했습니다.');
      } finally { setIsLoading(false); }
      
    } else {
      if (!masterId) { toast.error('시험지 정보를 찾을 수 없습니다.'); return; }
      window.open(`/exam/viewer?exam_id=${masterId}`, '_blank');
    }
  };

  const handleEditHomeworkToStep2 = async (e: React.MouseEvent, type: string, hwId: any, targetQuestions?: any[], title?: string, subTitle?: string, studentName?: string, studentId?: string, classId?: string) => {
    e.stopPropagation();
    if (!targetQuestions || targetQuestions.length === 0) { toast.warning('수정할 문항이 없습니다.'); return; }

    try {
      setIsLoading(true);
      const tqIds = targetQuestions.map(id => Number(id)).filter(id => !isNaN(id));
      const { data: tqData, error } = await supabase.from('textbook_question').select('tq_id, question_id').in('tq_id', tqIds);
      if (error) throw error;

      const tqMap = new Map();
      tqData?.forEach(item => { if (item.question_id) tqMap.set(item.tq_id, item.question_id); });
      const qIds = tqIds.map(id => tqMap.get(id)).filter(Boolean);

      if (qIds.length === 0) { toast.error('연결된 문제 데이터를 찾을 수 없습니다.'); return; }

      const safeStudentName = studentName && studentName !== '알수없음' ? `[${studentName}] ` : '';
      const finalTitle = `${safeStudentName}${title || '과제 문항 수정'}`;

      purgeOldSession();

      sessionStorage.setItem('restoreExamQuestions', '1');
      sessionStorage.setItem('examQuestions', JSON.stringify(qIds));
      sessionStorage.setItem('examTitle', finalTitle);
      sessionStorage.setItem('examSubTitle', subTitle || '교재 과제'); 
      sessionStorage.setItem('examType', '과제프린트');

      sessionStorage.setItem('editOriginalType', 'hw');
      sessionStorage.setItem('editOriginalId', String(hwId));
      sessionStorage.setItem('editStudentId', String(studentId));
      sessionStorage.setItem('editClassId', String(classId));

      window.location.href = '/homework/step2';

    } catch (err: any) {
      console.error(err);
      toast.error('문항 정보를 불러오는 중 오류가 발생했습니다.');
    } finally { setIsLoading(false); }
  };

  const handleEditExamToStep2 = async (e: React.MouseEvent, assignId: any, masterId: any, title: string, subTitle: string, studentName: string, studentId: string, classId: string, examType: string) => {
    e.stopPropagation();
    if (!masterId || !assignId) return toast.error('시험지 정보를 찾을 수 없습니다.');
    
    try {
      setIsLoading(true);
      const { data: items, error } = await supabase.from('exam_item').select('question_id').eq('exam_id', masterId).order('sort_order');
      if (error) throw error;
      
      const qIds = items?.map(i => String(i.question_id)) || [];
      if (qIds.length === 0) return toast.error('연결된 문제 데이터를 찾을 수 없습니다.');

      const safeStudentName = studentName && studentName !== '알수없음' ? `[${studentName}] ` : '';
      const finalTitle = title.startsWith('[') ? title : `${safeStudentName}${title || '문제지 수정'}`;

      const { data: masterData } = await supabase.from('exam_master').select('layout_settings').eq('exam_id', masterId).single();

      purgeOldSession();

      sessionStorage.setItem('restoreExamQuestions', '1');
      sessionStorage.setItem('examQuestions', JSON.stringify(qIds));
      sessionStorage.setItem('examTitle', finalTitle);
      sessionStorage.setItem('examSubTitle', subTitle || '');
      sessionStorage.setItem('examType', examType || '오답프린트');
      
      if (masterData?.layout_settings?.userMergedTextQuestions) {
         sessionStorage.setItem('examUserMergedTextQuestions', JSON.stringify(masterData.layout_settings.userMergedTextQuestions));
      }

      sessionStorage.setItem('editOriginalType', 'exam');
      sessionStorage.setItem('editOriginalId', String(assignId));
      sessionStorage.setItem('editMasterId', String(masterId));
      sessionStorage.setItem('editStudentId', String(studentId));
      sessionStorage.setItem('editClassId', String(classId));

      window.location.href = '/exam/step2';
    } catch (err: any) {
      console.error(err);
      toast.error('문항 정보를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateIncorrectPrint = async () => {
    // 내부 StudentTimeline의 마법사 로직으로 이전됨.
  };

  return {
    handleForceComplete, handleDeleteExam, handleEditHomeworkTitle,
    handleDeleteHomework, handleDeletePrint, handlePrintItem, handleEditHomeworkToStep2,
    handleEditExamToStep2, handleExtractCommonHomework,
    handleBulkCompleteGlobal, handleBulkDeleteGlobal, handleBulkCompleteStudent,
    handleBulkDeleteStudent, handleGenerateIncorrectPrint
  };
}