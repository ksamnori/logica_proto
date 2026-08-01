// src/app/exam/step3/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ExamStep3Page() {
  const router = useRouter();

  // === 기본 정보 상태 ===
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [layoutType, setLayoutType] = useState("주간테스트");

  // === 세션 요약 데이터 상태 ===
  const [qCount, setQCount] = useState(0);
  const [majorGrade, setMajorGrade] = useState("-");
  const [avgDiff, setAvgDiff] = useState("-");
  const [scopeHtml, setScopeHtml] = useState("-");

  // === 대상 학생 선택 상태 ===
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [allAvailableClasses, setAllAvailableClasses] = useState<any[]>([]);
  const [addedClassTabs, setAddedClassTabs] = useState<any[]>([]);
  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const [classStudentsMap, setClassStudentsMap] = useState<Record<string, any[]>>({});
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());

  // === 레이아웃 설정 상태 ===
  const [columns, setColumns] = useState(2);
  const [splits, setSplits] = useState(4);
  const [fontSize, setFontSize] = useState(16);

  // === 처리 상태 ===
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  useEffect(() => {
    const editExamId = sessionStorage.getItem('editExamId');
    const duplicateExamId = sessionStorage.getItem('duplicateExamId');
    const targetId = editExamId || duplicateExamId;

    const initData = async () => {
      if (targetId) {
        const { data } = await supabase.from('exam_master').select('title, sub_title, exam_type').eq('exam_id', targetId).single();
        if (data) {
          setTitle(duplicateExamId ? data.title + ' (복제본)' : data.title);
          setSubtitle(data.sub_title || '');
          setLayoutType(data.exam_type || '주간테스트');
        }
      } else {
        setTitle(sessionStorage.getItem('examTitle') || '새로운 테스트');
      }

      setQCount(parseInt(sessionStorage.getItem('qCount') || '0'));
      setMajorGrade(sessionStorage.getItem('majorGrade') || '-');
      setAvgDiff(sessionStorage.getItem('avgDifficulty') || '-');
      
      const scopeStartRaw = sessionStorage.getItem('scopeStart') || '-';
      const scopeEndRaw = sessionStorage.getItem('scopeEnd') || '-';
      
      const truncateToDepth5 = (scopeStr: string) => {
        if (!scopeStr || scopeStr === '-') return scopeStr;
        const parts = scopeStr.split('>').map(s => s.trim());
        return parts.length > 5 ? parts.slice(0, 5).join(' > ') : scopeStr;
      };

      const sStart = truncateToDepth5(scopeStartRaw);
      const sEnd = truncateToDepth5(scopeEndRaw);

      if (sStart === sEnd) {
        setScopeHtml(sStart);
      } else {
        setScopeHtml(`${sStart} <br/><span class="text-blue-300">~</span> ${sEnd}`);
      }
    };

    initData();
  }, []);

  // ==========================================
  // 배포 대상 (클래스/학생) 관리 로직
  // ==========================================
  const fetchClasses = async () => {
    if (allAvailableClasses.length === 0) {
      const { data } = await supabase.from('class').select('*').order('class_id', { ascending: false });
      setAllAvailableClasses(data || []);
    }
  };

  const openClassModal = async () => {
    await fetchClasses();
    setIsClassModalOpen(true);
  };

  const addClassToTabs = async (classId: string, className: string) => {
    setIsClassModalOpen(false);
    setAddedClassTabs(prev => [...prev, { class_id: classId, class_name: className }]);
    setActiveClassId(classId);

    try {
      const [ { data: directStudents }, { data: enrolls } ] = await Promise.all([
        supabase.from('student').select('student_id, name, status').eq('class_id', classId),
        supabase.from('enrollment').select('student_id, student(name, status)').eq('class_id', classId)
      ]);

      const studentMap = new Map();
      if (directStudents) directStudents.forEach(s => studentMap.set(s.student_id, s));
      if (enrolls) enrolls.forEach(e => {
        if (e.student) studentMap.set(e.student_id, { student_id: e.student_id, name: (e.student as any).name, status: (e.student as any).status });
      });

      const students = Array.from(studentMap.values());
      setClassStudentsMap(prev => ({ ...prev, [classId]: students }));
      
      setSelectedStudentIds(prev => {
        const next = new Set(prev);
        students.forEach(s => { if (s.status === '재원') next.add(s.student_id); });
        return next;
      });
    } catch (err) {
      console.error(err);
      setClassStudentsMap(prev => ({ ...prev, [classId]: [] }));
    }
  };

  const removeClassTab = (classId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTabs = addedClassTabs.filter(c => c.class_id !== classId);
    setAddedClassTabs(newTabs);

    const studentsToRemove = classStudentsMap[classId] || [];
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      studentsToRemove.forEach(s => next.delete(s.student_id));
      return next;
    });

    const newMap = { ...classStudentsMap };
    delete newMap[classId];
    setClassStudentsMap(newMap);

    if (newTabs.length > 0) {
      setActiveClassId(newTabs[0].class_id);
    } else {
      setActiveClassId(null);
    }
  };

  const toggleStudent = (studentId: string, checked: boolean) => {
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      checked ? next.add(studentId) : next.delete(studentId);
      return next;
    });
  };

  const toggleAllActiveStudents = (checked: boolean) => {
    if (!activeClassId) return;
    const students = classStudentsMap[activeClassId] || [];
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      students.forEach(s => checked ? next.add(s.student_id) : next.delete(s.student_id));
      return next;
    });
  };

  const activeStudents = activeClassId ? (classStudentsMap[activeClassId] || []) : [];
  const isAllChecked = activeStudents.length > 0 && activeStudents.every(s => selectedStudentIds.has(s.student_id));
  const activeClassName = addedClassTabs.find(c => c.class_id === activeClassId)?.class_name || '선택된 반';

  // ==========================================
  // DB 저장 및 시험지 생성 로직
  // ==========================================
  const saveExamToDB = async () => {
    setIsSaving(true);

    try {
      const instId = localStorage.getItem('logica_instructor_id');
      if (!instId) {
        alert("로그인 정보(강사 식별자)를 찾을 수 없습니다.\n시스템에 다시 로그인해주세요.");
        setIsSaving(false);
        return;
      }

      const finalTitle = title || '새로운 테스트';
      const editExamId = sessionStorage.getItem('editExamId');
      let examId;

      if (editExamId) {
        const { error: examErr } = await supabase.from('exam_master').update({
          title: finalTitle, sub_title: subtitle, exam_type: layoutType,       
          total_questions: qCount, instructor_id: instId,     
          major_grade: majorGrade, avg_difficulty: avgDiff,     
          scope_start: sessionStorage.getItem('scopeStart'), scope_end: sessionStorage.getItem('scopeEnd')              
        }).eq('exam_id', editExamId);
        
        if (examErr) throw examErr;
        examId = editExamId;
        await supabase.from('exam_item').delete().eq('exam_id', editExamId);

      } else {
        const { data: examData, error: examErr } = await supabase.from('exam_master').insert({
          title: finalTitle, sub_title: subtitle, exam_type: layoutType,       
          total_questions: qCount, instructor_id: instId,     
          major_grade: majorGrade, avg_difficulty: avgDiff,     
          scope_start: sessionStorage.getItem('scopeStart'), scope_end: sessionStorage.getItem('scopeEnd')              
        }).select().single();
        
        if (examErr) throw examErr;
        examId = examData.exam_id;
      }

      if (selectedStudentIds.size > 0) {
        const { data: existing } = await supabase.from('exam_assignment').select('student_id').eq('exam_id', examId);
        const existingIds = existing ? existing.map(e => e.student_id) : [];

        const assignmentInserts: any[] = [];
        selectedStudentIds.forEach(studentId => {
          if (!existingIds.includes(studentId)) {
            assignmentInserts.push({ exam_id: examId, student_id: studentId, status: '응시전' });
          }
        });

        if (assignmentInserts.length > 0) {
          const { error: assignErr } = await supabase.from('exam_assignment').insert(assignmentInserts);
          if (assignErr) throw assignErr;
        }
      }
      
      const qIdsStr = sessionStorage.getItem('examQuestions');
      if (qIdsStr) {
        const parsedData = JSON.parse(qIdsStr);
        const items: any[] = [];
        let flatIndex = 1; 

        parsedData.forEach((group: any, gIdx: number) => {
          const groupNum = gIdx + 1; 
          let score = null;
          
          if (layoutType === '입학테스트') {
            if (groupNum >= 1 && groupNum <= 4) score = 2;
            else if (groupNum >= 5 && groupNum <= 13) score = 3;
            else if (groupNum >= 14 && groupNum <= 20) score = 4;
            else if (groupNum === 21) score = 5;
            else if (groupNum >= 22 && groupNum <= 23) score = 2;
            else if (groupNum >= 24 && groupNum <= 25) score = 3;
            else if (groupNum >= 26 && groupNum <= 28) score = 4;
            else if (groupNum >= 29 && groupNum <= 30) score = 5;
          }

          if (Array.isArray(group)) {
            group.forEach(qid => {
              items.push({ exam_id: examId, question_id: qid, sort_order: flatIndex++, assigned_score: score });
            });
          } else {
            items.push({ exam_id: examId, question_id: group, sort_order: flatIndex++, assigned_score: score });
          }
        });
        
        const { error: itemErr } = await supabase.from('exam_item').insert(items);
        if (itemErr) throw itemErr;
      }

      alert("✅ 성공적으로 생성 및 배포되었습니다! 시험지 목록으로 이동합니다.");
      sessionStorage.clear();
      router.push('/exam-list'); 

    } catch (err: any) {
      alert("❌ 저장 중 오류 발생: \n" + err.message);
      setIsSaving(false);
    }
  };

  // ==========================================
  // PDF 다운로드 (Node.js 서버 연동)
  // ==========================================
  const downloadPDF = async () => {
    setIsGeneratingPdf(true);
    const examTitle = title || '테스트 시험지';

    try {
      const qIdsStr = sessionStorage.getItem('examQuestions');
      if (!qIdsStr) {
        alert('선택된 문항이 없습니다. Step 2에서 문항을 확정해주세요.');
        setIsGeneratingPdf(false);
        return;
      }
      
      const parsedData = JSON.parse(qIdsStr);
      const flatIds = parsedData.flat(); 

      const { data: qData, error: qErr } = await supabase
        .from('question_db')
        .select('*')
        .in('question_id', flatIds);

      if (qErr || !qData) throw new Error('DB에서 문항 데이터를 불러오지 못했습니다.');

      const qMap = new Map();
      qData.forEach(q => qMap.set(q.question_id, q));

      let examQuestionsHtml = '';
      let answerQuestionsHtml = '';
      let qIndex = 1;

      parsedData.forEach((group: any) => {
        const ids = Array.isArray(group) ? group : [group];
        ids.forEach((qid: string) => {
          const q = qMap.get(qid);
          if (q) {
            const questionText = q.question || "문항 내용 없음";
            const answerText = q.answer || "정답 없음";
            const solutionText = q.solution || q.explanation || "해설 없음";

            examQuestionsHtml += `
              <div class="question-box">
                <div style="display:flex; gap:10px;">
                  <span style="font-weight:bold; font-size:1.1em;">${qIndex}.</span>
                  <div style="flex:1;">${questionText}</div>
                </div>
              </div>
            `;

            answerQuestionsHtml += `
              <div class="answer-box">
                <div style="margin-bottom: 5px;">${qIndex}번 정답: <span style="color:#e11d48;">${answerText}</span></div>
                <div style="font-weight:normal; font-size: 0.9em; color:#555; background: #f8fafc; padding: 10px; border-radius: 8px;">
                  <strong style="color:#002864;">[해설]</strong><br>
                  ${solutionText}
                </div>
              </div>
            `;
            qIndex++;
          }
        });
      });

      const mathJaxScript = `
        <script>
        window.MathJax = {
            tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']] },
            startup: { pageReady: () => { return MathJax.startup.defaultPageReady(); } }
        };
        </script>
        <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
      `;

      const baseCss = `
        body { font-family: 'Pretendard', sans-serif; margin: 0; padding: 0; background: #eee; font-size: ${fontSize}px; }
        .a4-page { width: 210mm; height: 297mm; background: white; margin: 0 auto; padding: 15mm; box-sizing: border-box; overflow: hidden; page-break-after: always; }
        .header { text-align: center; border-bottom: 2px solid #002864; padding-bottom: 15px; margin-bottom: 20px; color: #002864; font-weight: bold; font-size: 24px; }
        .layout-col-1 { column-count: 1; height: calc(100% - 60px); }
        .layout-col-2 { column-count: 2; column-gap: 10mm; height: calc(100% - 60px); }
        .question-box { break-inside: avoid; page-break-inside: avoid; width: 100%; padding: 10px 15px; box-sizing: border-box; display: inline-block; border-bottom: 1px dashed #ddd; margin-bottom: 5px; }
        .layout-split-2 .question-box { min-height: calc(100% / 1); }
        .layout-split-4 .question-box { min-height: calc(100% / 2); }
        .layout-split-6 .question-box { min-height: calc(100% / 3); }
        .answer-box { break-inside: avoid; page-break-inside: avoid; margin-bottom: 20px; font-weight: bold; border-bottom: 1px dashed #ddd; padding-bottom: 15px;}
        .question-box img, .answer-box img { max-width: 100%; height: auto; }
      `;

      const examHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">${mathJaxScript}<style>${baseCss}</style></head><body><div class="a4-page"><div class="header">${examTitle}</div><div class="layout-col-${columns} layout-split-${splits}">${examQuestionsHtml}</div></div></body></html>`;
      const answerHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">${mathJaxScript}<style>${baseCss}</style></head><body><div class="a4-page"><div class="header">${examTitle} - 정답 및 해설</div><div class="layout-col-2">${answerQuestionsHtml}</div></div></body></html>`;

      const [examResponse, answerResponse] = await Promise.all([
        fetch('http://localhost:3000/generate-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ htmlContent: examHtml }) }),
        fetch('http://localhost:3000/generate-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ htmlContent: answerHtml }) })
      ]);

      if (!examResponse.ok || !answerResponse.ok) throw new Error('Node.js 서버 통신 에러');

      const examBlob = await examResponse.blob();
      const examUrl = window.URL.createObjectURL(examBlob);
      const a1 = document.createElement('a'); a1.href = examUrl; a1.download = `${examTitle}_문제지.pdf`;
      document.body.appendChild(a1); a1.click(); a1.remove(); window.URL.revokeObjectURL(examUrl);

      setTimeout(async () => {
        const answerBlob = await answerResponse.blob();
        const answerUrl = window.URL.createObjectURL(answerBlob);
        const a2 = document.createElement('a'); a2.href = answerUrl; a2.download = `${examTitle}_정답지.pdf`;
        document.body.appendChild(a2); a2.click(); a2.remove(); window.URL.revokeObjectURL(answerUrl);
      }, 1500);
      
    } catch (error: any) {
      console.error('에러:', error);
      alert('PDF 생성 실패: ' + error.message);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col pb-12 bg-slate-50 font-pretendard">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-6">
          <button onClick={() => router.push('/exam/step2')} className="text-slate-500 hover:text-slate-800 flex items-center gap-2 font-bold transition-colors bg-slate-50 border border-slate-200 hover:bg-slate-100 px-3 py-1.5 rounded-lg text-sm shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg> Step 2 가기
          </button>
          <div className="w-px h-6 bg-slate-300"></div>
          <h1 className="text-xl font-extrabold text-slate-800">새 시험지 출제 및 배포</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2"><div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center font-bold text-xs">1</div></div>
          <div className="w-4 h-px bg-slate-200"></div>
          <div className="flex items-center gap-2"><div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center font-bold text-xs">2</div></div>
          <div className="w-4 h-px bg-slate-200"></div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-md">3</div>
            <span className="font-extrabold text-emerald-600 text-sm">출제 설정 및 저장</span>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] w-full mx-auto mt-8 px-8 grid grid-cols-12 gap-8 items-start">
        <div className="col-span-12 lg:col-span-8 space-y-6">
          
          {/* 시험지 기본 정보 */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
            <h2 className="text-lg font-extrabold text-slate-800 mb-5 flex items-center gap-2"><span className="text-xl">🏷️</span> 시험지 기본 정보</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="col-span-2 md:col-span-1">
                <label className="block text-sm font-bold text-slate-600 mb-2">시험지 제목 (학생 노출용 메인 타이틀)</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-3 font-bold text-slate-800 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864]" />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-sm font-bold text-slate-600 mb-2">학년/과정 표기 (뷰어 우측 상단 뱃지용)</label>
                <input type="text" value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="예: 초등 4-2" className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-3 font-bold text-slate-800 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864]" />
              </div>
            </div>
          </section>

          {/* 배포 대상 선택 */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2"><span className="text-xl">🎯</span> 배포 대상(학생) 선택 <span className="text-slate-400 text-sm font-normal ml-2">(미지정 시 종이 출력용으로 저장)</span></h2>
              <span className="bg-blue-50 text-[#002864] font-bold text-xs px-3 py-1.5 rounded-lg border border-blue-100">현재 배포 대상: <span className="text-lg text-blue-600">{selectedStudentIds.size}</span>명</span>
            </div>
            
            <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar pb-2">
              <button onClick={openClassModal} className="bg-white border-2 border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors flex items-center gap-1 shadow-sm shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                클래스 추가
              </button>
              {addedClassTabs.map(c => (
                <div key={c.class_id} onClick={() => setActiveClassId(c.class_id)} className={`cursor-pointer border px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors flex items-center gap-2 shrink-0 ${activeClassId === c.class_id ? "bg-[#002864] text-white shadow-md border-[#002864]" : "bg-white text-slate-600 border-slate-300 shadow-sm"}`}>
                  {c.class_name}
                  <button onClick={(e) => removeClassTab(c.class_id, e)} className="hover:text-rose-400 w-4 h-4 flex justify-center items-center rounded-full bg-black/10">✕</button>
                </div>
              ))}
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 max-h-[250px] overflow-y-auto custom-scrollbar mb-8">
              <div className="flex justify-between items-center mb-3 pb-3 border-b border-slate-200">
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={isAllChecked} onChange={(e) => toggleAllActiveStudents(e.target.checked)} className="w-4 h-4 accent-[#002864] cursor-pointer rounded" /> 
                  <span><span className="text-blue-600">{activeClassName}</span> 학생 모두 선택</span>
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {activeStudents.length === 0 ? (
                  <div className="col-span-3 text-center text-slate-400 font-bold text-sm py-4">반을 추가해주세요.</div>
                ) : (
                  activeStudents.map(s => (
                    <label key={s.student_id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white p-2 rounded transition-colors border border-transparent hover:border-slate-200">
                      <input type="checkbox" checked={selectedStudentIds.has(s.student_id)} onChange={(e) => toggleStudent(s.student_id, e.target.checked)} className="w-4 h-4 accent-[#002864] rounded" /> 
                      <span className={s.status === '재원' ? 'text-slate-700 font-bold' : 'text-slate-400 font-medium line-through'}>{s.name} {s.status !== '재원' ? `(${s.status})` : ''}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            
            <h2 className="text-lg font-extrabold text-slate-800 mb-4 border-t border-slate-200 pt-6 flex items-center gap-2"><span className="text-xl">🖨️</span> 프린트 양식 (테스트 유형) 선택</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {['과제프린트', '주간테스트', '중간평가', '분기평가', '입학테스트'].map(type => (
                <label key={type} className={`border-2 rounded-xl p-3 cursor-pointer transition-colors flex flex-col items-center gap-2 ${layoutType === type ? (type === '입학테스트' ? 'border-emerald-600 bg-emerald-50/50' : 'border-[#002864] bg-blue-50/50') : 'border-slate-200 hover:bg-blue-50'}`}>
                  <input type="radio" name="layout_type" value={type} checked={layoutType === type} onChange={(e) => setLayoutType(e.target.value)} className={`w-4 h-4 ${type === '입학테스트' ? 'accent-emerald-600' : 'accent-[#002864]'}`} />
                  <span className={`font-bold text-sm ${layoutType === type ? (type === '입학테스트' ? 'text-emerald-700' : 'text-[#002864]') : 'text-slate-700'}`}>{type}</span>
                </label>
              ))}
            </div>
          </section>

          {/* 🎛️ 시험지 레이아웃 편집 컨트롤러 */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
            <h2 className="text-lg font-extrabold text-slate-800 mb-5 flex items-center gap-2"><span className="text-xl">🎛️</span> 시험지 레이아웃 설정</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 단 설정 */}
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-3">단 구성</label>
                <div className="flex gap-2">
                  <button onClick={() => setColumns(1)} className={`flex-1 py-2 rounded-lg border-2 font-bold ${columns === 1 ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>1단</button>
                  <button onClick={() => setColumns(2)} className={`flex-1 py-2 rounded-lg border-2 font-bold ${columns === 2 ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>2단</button>
                </div>
              </div>

              {/* 분할 설정 */}
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-3">페이지 당 문항 수 (분할)</label>
                <div className="flex gap-2">
                  {[2, 4, 6].map(num => (
                    <button key={num} onClick={() => setSplits(num)} className={`flex-1 py-2 rounded-lg border-2 font-bold ${splits === num ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{num}분할</button>
                  ))}
                </div>
              </div>

              {/* 폰트 사이즈 설정 */}
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-3">문항 폰트 크기</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => setFontSize(Math.max(10, fontSize - 1))} className="w-10 h-10 rounded-lg bg-slate-100 text-slate-600 font-bold hover:bg-slate-200">-</button>
                  <span className="font-bold text-lg text-[#002864] flex-1 text-center">{fontSize}px</span>
                  <button onClick={() => setFontSize(Math.min(30, fontSize + 1))} className="w-10 h-10 rounded-lg bg-slate-100 text-slate-600 font-bold hover:bg-slate-200">+</button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* 우측: 영수증 패널 */}
        <div className="col-span-12 lg:col-span-4 relative">
          <div className="sticky top-[100px] space-y-4">
            <div className="bg-[#0b1b3d] rounded-2xl shadow-2xl p-7 text-white border border-slate-700/50">
              <h3 className="font-extrabold text-blue-300 text-sm mb-5 border-b border-blue-900/50 pb-3 flex items-center gap-2"><span className="text-xl">🧾</span> 최종 발행 영수증</h3>
              <div className="space-y-6 mb-8">
                <div>
                  <p className="text-[11px] text-slate-400 font-bold mb-1.5">시험지명</p>
                  <p className="text-[15px] font-bold text-white break-keep leading-snug">{title || '제목 없음'}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 bg-slate-800/30 p-4 rounded-xl border border-slate-700/30">
                  <div>
                    <p className="text-[11px] text-slate-400 font-bold mb-1">총 출제 문항</p>
                    <p className="text-3xl font-black text-white">{qCount}<span className="text-xs font-bold text-slate-400 ml-1.5">문항</span></p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400 font-bold mb-1">배포 대상</p>
                    <p className="text-3xl font-black text-emerald-400">{selectedStudentIds.size}<span className="text-xs font-bold text-emerald-600 ml-1.5">명</span></p>
                  </div>
                </div>

                <div className="bg-blue-900/30 p-4 rounded-xl border border-blue-800/50 space-y-3">
                  <div className="flex justify-between items-center border-b border-blue-800/50 pb-2">
                    <span className="text-[11px] text-blue-300 font-bold">주요 학년</span>
                    <span className="text-[13px] font-bold text-white">{majorGrade}</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-blue-800/50 pb-2">
                    <span className="text-[11px] text-blue-300 font-bold">평균 난이도</span>
                    <span className="text-[13px] font-bold text-rose-300">{avgDiff}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-blue-300 font-bold block mb-1">출제 범위 (Depth 5 기준)</span>
                    <span className="text-[12px] font-bold text-blue-100 leading-snug break-keep block" dangerouslySetInnerHTML={{ __html: scopeHtml }}></span>
                  </div>
                </div>

                <div>
                  <p className="text-[11px] text-slate-400 font-bold mb-1.5">학년/과정 표기</p>
                  <p className="text-[13px] font-bold text-emerald-300">{subtitle || '-'}</p>
                </div>
              </div>

              <div className="space-y-3 pt-5 border-t border-slate-700/50">
                <button onClick={saveExamToDB} disabled={isSaving || isGeneratingPdf} className="w-full bg-blue-600 border border-blue-500 hover:border-blue-400 text-white font-extrabold py-4 rounded-xl shadow-[0_0_15px_rgba(37,99,235,0.4)] hover:bg-blue-500 transition-colors text-lg flex justify-center items-center gap-2 disabled:opacity-50">
                  {isSaving ? "저장 중... ⏳" : "💾 출제 완료 및 시험지 생성"}
                </button>
                
                <button onClick={downloadPDF} disabled={isSaving || isGeneratingPdf} className="w-full bg-slate-700 border border-slate-600 hover:border-slate-500 text-white font-extrabold py-3 rounded-xl hover:bg-slate-600 transition-colors text-sm flex justify-center items-center gap-2 disabled:opacity-50">
                  {isGeneratingPdf ? "⏳ PDF 생성 중..." : "🖨️ PDF 인쇄 테스트 (서버 연동)"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 클래스 선택 모달 */}
      {isClassModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex justify-center items-center z-50">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-slate-50 px-6 py-4 flex justify-between items-center border-b border-slate-200">
              <h3 className="text-slate-800 font-extrabold text-lg">🏫 배포할 클래스 선택</h3>
              <button onClick={() => setIsClassModalOpen(false)} className="text-slate-400 hover:text-slate-700 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="p-4 max-h-[300px] overflow-y-auto custom-scrollbar space-y-2">
              {allAvailableClasses.length === 0 ? (
                <div className="text-center py-5 text-slate-400 font-bold">로딩 중이거나 반이 없습니다.</div>
              ) : (
                allAvailableClasses.map(c => {
                  const isAlreadyAdded = addedClassTabs.find(tab => tab.class_id === c.class_id);
                  if (isAlreadyAdded) return null;
                  return (
                    <div key={c.class_id} onClick={() => addClassToTabs(c.class_id, c.name)} className="p-3 border border-slate-200 rounded-lg hover:bg-blue-50 cursor-pointer flex justify-between items-center group transition-colors">
                      <span className="font-bold text-slate-700 group-hover:text-blue-700">{c.name}</span>
                      <span className="text-xs text-blue-500 font-bold bg-white px-2 py-1 rounded shadow-sm border border-blue-100">+ 추가</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}