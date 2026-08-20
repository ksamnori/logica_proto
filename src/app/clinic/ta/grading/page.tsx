// src/app/clinic/ta/grading/page.tsx
//
// 조교(TA) 전용 채점 페이지. clinic/ta/pad 와 같은 계열로,
// 강사 로그인 없이 조교가 바로 열어서 쓰는 화면이다.
// 흐름: 1) 학생 선택 → 2) 그 학생에게 나간 시험지/과제 중 채점할 항목 선택 → 3) 채점(GradingBoard).
// 💡 여러 명을 동시에 화면에 띄우는 대신, 고른 항목은 "패널"로 목록에 쌓이고 한 번에 하나만
// 메인 화면에 표시된다. 왼쪽 바에서 패널을 눌러 채점 중인 학생 사이를 빠르게 전환한다.
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import GradingBoard from "./GradingBoard";
import TaTopBar from "../TaTopBar";
import { useTaEntry } from "../TaEntryGate";

interface StudentInfo {
  id: string;
  name: string;
  className: string;
  classId: string;
  allClassIds: string[];
}

interface ClassInfo {
  class_id: string;
  name: string;
  students: StudentInfo[];
}

interface AssignmentItem {
  key: string;
  kind: 'exam' | 'hw';
  title: string;
  subtitle: string;
  date: string;
  status: string;
  assignmentId?: string;
  homeworkId?: string;
}

type Step = 'STUDENT' | 'ITEM';

interface Panel {
  id: string;
  mode: 'exam' | 'homework';
  assignmentId?: string;
  homeworkId?: string;
  studentId: string;
  studentName: string;
  title: string;
}

const STATUS_STYLE: Record<string, string> = {
  '채점완료': 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  '완료': 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  '제출완료': 'bg-rose-100 text-rose-600 border border-rose-200',
  '응시중': 'bg-blue-100 text-blue-600 border border-blue-200',
  '미응시': 'bg-slate-100 text-slate-500 border border-slate-200',
  '미제출': 'bg-slate-100 text-slate-500 border border-slate-200',
};

export default function TaGradingPage() {
  const { taName, ready } = useTaEntry();

  const [step, setStep] = useState<Step>('STUDENT');
  const [isLoading, setIsLoading] = useState(true);

  const [groupedClasses, setGroupedClasses] = useState<ClassInfo[]>([]);
  const [expandedClasses, setExpandedClasses] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const [selectedStudent, setSelectedStudent] = useState<StudentInfo | null>(null);
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  const [panels, setPanels] = useState<Panel[]>([]);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [activeDirty, setActiveDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(true);

  useEffect(() => { setActiveDirty(false); }, [activePanelId]);

  useEffect(() => {
    if (taName) loadStudents();
  }, [taName]);

  const loadStudents = async () => {
    setIsLoading(true);
    try {
      const tenantId = localStorage.getItem("logica_tenant_id") || "";

      // 💡 [지점 누출 방지] tenantId가 아예 없으면(=조교가 PIN도 없이 URL로 바로 들어온
      // 이례적인 상태) 필터 없이 전체 지점을 보여주는 대신 아무것도 보여주지 않는다.
      // 'hq'는 실제로 로그인해서 얻은 본사 권한이므로 그대로 전체 조회를 허용한다.
      if (!tenantId) { setGroupedClasses([]); setIsLoading(false); return; }

      let classQuery = supabase.from('class').select('class_id, name').order('name');
      if (tenantId !== 'hq') classQuery = classQuery.eq('tenant_id', tenantId);
      const { data: classes } = await classQuery;
      if (!classes || classes.length === 0) { setGroupedClasses([]); setIsLoading(false); return; }

      const classIds = classes.map(c => c.class_id);
      const { data: enrollments } = await supabase.from('enrollment').select('class_id, student_id, student(name, status)').in('class_id', classIds);

      const studentClassMap = new Map<string, { classId: string; className: string }[]>();
      const namesMap: Record<string, string> = {};
      enrollments?.forEach((e: any) => {
        if (!e.student || e.student.status !== '재원') return;
        const studentName = Array.isArray(e.student) ? e.student[0]?.name : e.student.name;
        namesMap[e.student_id] = studentName;
        if (!studentClassMap.has(e.student_id)) studentClassMap.set(e.student_id, []);
        const className = classes.find(c => c.class_id === e.class_id)?.name || '';
        studentClassMap.get(e.student_id)!.push({ classId: e.class_id, className });
      });

      const groups: ClassInfo[] = classes.map(c => {
        const studentsInClass: StudentInfo[] = [];
        studentClassMap.forEach((classList, studentId) => {
          if (classList.some(cl => cl.classId === c.class_id)) {
            studentsInClass.push({
              id: studentId,
              name: namesMap[studentId] || '이름없음',
              classId: c.class_id,
              className: c.name,
              allClassIds: classList.map(cl => cl.classId),
            });
          }
        });
        studentsInClass.sort((a, b) => a.name.localeCompare(b.name));
        return { class_id: c.class_id, name: c.name, students: studentsInClass };
      }).filter(c => c.students.length > 0);

      setGroupedClasses(groups);
    } catch (e) {
      console.error(e);
      alert("학생 목록을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const filteredGroups = useMemo(() => {
    const q = search.trim();
    if (!q) return groupedClasses;
    return groupedClasses
      .map(c => ({ ...c, students: c.students.filter(s => s.name.includes(q)) }))
      .filter(c => c.students.length > 0);
  }, [groupedClasses, search]);

  useEffect(() => {
    if (search.trim()) setExpandedClasses(filteredGroups.map(c => c.class_id));
  }, [search]);

  const toggleClass = (classId: string) => {
    setExpandedClasses(prev => prev.includes(classId) ? prev.filter(c => c !== classId) : [...prev, classId]);
  };

  const handleSelectStudent = (student: StudentInfo) => {
    setSelectedStudent(student);
    setStep('ITEM');
    loadItemsForStudent(student);
  };

  const loadItemsForStudent = async (student: StudentInfo) => {
    setIsLoadingItems(true);
    setItems([]);
    try {
      const { data: exams } = await supabase.from('exam_assignment')
        .select('assignment_id, status, total_score, created_at, exam_master!inner(title, sub_title, exam_type)')
        .eq('student_id', student.id)
        .neq('exam_master.exam_type', '입학테스트')
        .neq('exam_master.exam_type', '주간테스트')
        .order('created_at', { ascending: false });

      const examItems: AssignmentItem[] = (exams || []).map((e: any) => {
        const m = Array.isArray(e.exam_master) ? e.exam_master[0] : e.exam_master;
        const statusText = ['채점완료', '완료'].includes(e.status) ? `채점완료 (${e.total_score ?? 0}점)` : (e.status || '미응시');
        return {
          key: `exam_${e.assignment_id}`,
          kind: 'exam',
          title: m?.title || '제목 없음',
          subtitle: m?.exam_type === '과제' ? '시험지(과제유형)' : (m?.sub_title || '시험'),
          date: e.created_at,
          status: statusText,
          assignmentId: String(e.assignment_id),
        };
      });

      const { data: allHws } = await supabase.from('homework_assignment')
        .select('homework_id, class_id, homework_title, target_student_id, created_at, due_date, textbook(title)')
        .in('class_id', student.allClassIds)
        .neq('homework_title', '[시스템] 수업 진도 완료 기록');

      const relevantHws = (allHws || []).filter((h: any) => !h.target_student_id || h.target_student_id === student.id);
      const hwIds = relevantHws.map((h: any) => h.homework_id);

      let resultMap = new Map<number, any>();
      if (hwIds.length > 0) {
        const { data: hwResults } = await supabase.from('student_homework_result').select('*').eq('student_id', student.id).in('homework_id', hwIds);
        hwResults?.forEach((r: any) => resultMap.set(r.homework_id, r));
      }

      const hwItems: AssignmentItem[] = relevantHws.map((h: any) => {
        const res = resultMap.get(h.homework_id);
        const tb = Array.isArray(h.textbook) ? h.textbook[0] : h.textbook;
        return {
          key: `hw_${h.homework_id}`,
          kind: 'hw',
          title: h.homework_title || '교재 과제',
          subtitle: tb?.title || '교재',
          date: h.due_date || h.created_at,
          status: res?.status || '미제출',
          homeworkId: String(h.homework_id),
        };
      });

      const combined = [...examItems, ...hwItems].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setItems(combined);
    } catch (e) {
      console.error(e);
      alert("문제지/과제 목록을 불러오지 못했습니다.");
    } finally {
      setIsLoadingItems(false);
    }
  };

  // 💡 [학생당 패널 1개] 패널 id = studentId. 이미 그 학생 패널이 열려있으면 새로 안 만들고
  // 그 자리에서 시험지/과제 내용만 바꿔치기한다 — "시험지 바꾸기".
  const handleSelectItem = (item: AssignmentItem) => {
    if (!selectedStudent) return;
    if (selectedStudent.id === activePanelId && !confirmLeaveIfDirty('저장되지 않은 채점 내용이 있습니다. 저장하지 않고 시험지를 바꾸시겠습니까?')) return;

    const panel: Panel = item.kind === 'exam'
      ? { id: selectedStudent.id, mode: 'exam', assignmentId: item.assignmentId, studentId: selectedStudent.id, studentName: selectedStudent.name, title: item.title }
      : { id: selectedStudent.id, mode: 'homework', homeworkId: item.homeworkId, studentId: selectedStudent.id, studentName: selectedStudent.name, title: item.title };

    setPanels(prev => {
      const idx = prev.findIndex(p => p.id === panel.id);
      if (idx === -1) return [...prev, panel];
      const next = [...prev];
      next[idx] = panel;
      return next;
    });
    setActivePanelId(panel.id);
    setPickerOpen(false);
    setStep('STUDENT');
    setSelectedStudent(null);
  };

  const confirmLeaveIfDirty = (message: string) => !activeDirty || confirm(message);

  const closePanel = (id: string) => {
    if (id === activePanelId && !confirmLeaveIfDirty('저장되지 않은 채점 내용이 있습니다. 저장하지 않고 닫으시겠습니까?')) return;
    const next = panels.filter(p => p.id !== id);
    setPanels(next);
    if (activePanelId === id) setActivePanelId(next[0]?.id ?? null);
  };

  const switchPanel = (id: string) => {
    if (id === activePanelId) return;
    if (!confirmLeaveIfDirty('저장되지 않은 채점 내용이 있습니다. 저장하지 않고 다른 학생으로 이동하시겠습니까?')) return;
    setActivePanelId(id);
  };

  const openPicker = () => {
    setStep('STUDENT');
    setSelectedStudent(null);
    setPickerOpen(true);
  };

  // 시험지 바꾸기: 현재 보고 있는 학생의 항목 선택 화면으로 바로 진입.
  const openItemPickerForPanel = (panel: Panel) => {
    if (!confirmLeaveIfDirty('저장되지 않은 채점 내용이 있습니다. 저장하지 않고 시험지 선택 화면으로 이동하시겠습니까?')) return;
    let found: StudentInfo | null = null;
    for (const c of groupedClasses) {
      const s = c.students.find(st => st.id === panel.studentId);
      if (s) { found = s; break; }
    }
    const student: StudentInfo = found || { id: panel.studentId, name: panel.studentName, className: '', classId: '', allClassIds: [] };
    setSelectedStudent(student);
    setStep('ITEM');
    setPickerOpen(true);
    loadItemsForStudent(student);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  if (!ready) return <div className="h-screen bg-slate-100" />;

  const activePanel = panels.find(p => p.id === activePanelId) || null;

  const pickerBlock = (
    <>
      {step === 'STUDENT' && (
        <div className="max-w-2xl mx-auto h-full flex flex-col w-full">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="학생 이름으로 검색..."
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 focus:outline-none focus:border-[#002864] bg-white shadow-sm mb-3"
          />
          <div className="flex-1 overflow-y-auto custom-scroll bg-white rounded-xl border border-slate-200 shadow-sm">
            {isLoading ? (
              <div className="p-10 text-center text-slate-400 font-bold text-sm">학생 목록을 불러오는 중...</div>
            ) : filteredGroups.length === 0 ? (
              <div className="p-10 text-center text-slate-400 font-bold text-sm">일치하는 학생이 없습니다.</div>
            ) : (
              filteredGroups.map(c => {
                const isOpen = expandedClasses.includes(c.class_id);
                return (
                  <div key={c.class_id} className="border-b border-slate-100 last:border-0">
                    <button onClick={() => toggleClass(c.class_id)} className={`w-full flex justify-between items-center px-4 py-2.5 transition-colors ${isOpen ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                      <span className="font-bold text-[12px] text-[#002864]">📁 {c.name} <span className="text-slate-400 font-medium">({c.students.length}명)</span></span>
                      <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    {isOpen && (
                      <div className="flex flex-col bg-slate-50/50">
                        {c.students.map(s => {
                          const alreadyOpen = panels.some(p => p.studentId === s.id);
                          return (
                            <button key={s.id} onClick={() => handleSelectStudent(s)} className="w-full text-left pl-9 pr-4 py-2.5 text-[12px] font-bold text-slate-600 hover:bg-blue-50 hover:text-[#002864] transition-colors border-t border-slate-100/80 flex items-center justify-between gap-2">
                              <span>👤 {s.name}</span>
                              {alreadyOpen && <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">채점 중</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {step === 'ITEM' && selectedStudent && (
        <div className="max-w-2xl mx-auto h-full flex flex-col w-full">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-3 flex items-center gap-2">
            <button onClick={() => { setStep('STUDENT'); setSelectedStudent(null); }} className="text-slate-400 hover:text-slate-600 text-xs font-bold mr-1">←</button>
            <span className="text-sm font-black text-[#002864]">👤 {selectedStudent.name}</span>
            <span className="text-[11px] text-slate-400 font-semibold">{selectedStudent.className}</span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scroll bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {isLoadingItems ? (
              <div className="p-10 text-center text-slate-400 font-bold text-sm">불러오는 중...</div>
            ) : items.length === 0 ? (
              <div className="p-10 text-center text-slate-400 font-bold text-sm">이 학생에게 나간 시험지/과제가 없습니다.</div>
            ) : (
              items.map(item => {
                const existingPanel = panels.find(p => p.studentId === selectedStudent.id);
                const isCurrentlyLoaded = !!existingPanel && (
                  (item.kind === 'exam' && existingPanel.mode === 'exam' && existingPanel.assignmentId === item.assignmentId) ||
                  (item.kind === 'hw' && existingPanel.mode === 'homework' && existingPanel.homeworkId === item.homeworkId)
                );
                return (
                  <button key={item.key} onClick={() => handleSelectItem(item)} className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${item.kind === 'exam' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-700'}`}>{item.kind === 'exam' ? '시험' : '과제'}</span>
                        <span className="text-[13px] font-bold text-slate-700 truncate">{item.title}</span>
                        {isCurrentlyLoaded && <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">보는 중</span>}
                      </div>
                      <p className="text-[11px] text-slate-400 font-medium mt-0.5 truncate">{item.subtitle} · {formatDate(item.date)}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-extrabold px-2 py-1 rounded whitespace-nowrap ${STATUS_STYLE[item.status] || STATUS_STYLE[item.status.split(' ')[0]] || 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                      {item.status}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50 font-pretendard">
      <TaTopBar taName={taName} />
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div>
          <h1 className="font-lexend text-lg font-bold text-[#002864] tracking-tight leading-none">Logica Clinic <span className="text-slate-300 mx-1">·</span> 조교 채점</h1>
          {panels.length === 0 ? (
            <p className="text-[11px] text-slate-400 font-medium mt-1">
              <span className={step === 'STUDENT' ? 'text-[#002864] font-bold' : ''}>1. 학생 선택</span>
              <span className="mx-1.5">→</span>
              <span className={step === 'ITEM' ? 'text-[#002864] font-bold' : ''}>2. 문제지 선택</span>
              <span className="mx-1.5">→</span>
              <span>3. 채점</span>
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 font-medium mt-1">
              <span className="text-[#002864] font-bold">{panels.length}명</span> 채점 대기 중 — 왼쪽 바에서 학생을 눌러 전환하세요
            </p>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-hidden relative flex">
        {panels.length > 0 && (
          <div className="w-[180px] shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
            <div className="shrink-0 px-3 py-1 border-b border-slate-100">
              <span className="text-[8px] font-black text-slate-400 tracking-wide">채점 중 {panels.length}명</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll p-1.5 space-y-0.5">
              {panels.map(panel => {
                const isActive = activePanelId === panel.id;
                return (
                  <button
                    key={panel.id}
                    onClick={() => switchPanel(panel.id)}
                    title={`${panel.studentName} · ${panel.title || '제목 없음'}`}
                    className={`group relative w-full text-left rounded-md pl-2 pr-5 py-1 transition-colors border-l-[3px] ${isActive ? 'bg-blue-50 border-l-[#002864]' : 'bg-white border-l-transparent hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <span className={`shrink-0 text-[7px] font-black px-1 rounded ${panel.mode === 'exam' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-700'}`}>
                        {panel.mode === 'exam' ? '시험' : '과제'}
                      </span>
                      <span className={`shrink-0 max-w-[42px] text-[10px] font-black truncate ${isActive ? 'text-[#002864]' : 'text-slate-700'}`}>{panel.studentName}</span>
                      <span className="min-w-0 flex-1 text-[8px] text-slate-400 font-semibold truncate">· {panel.title || '제목 없음'}</span>
                    </div>
                    <span
                      onClick={e => { e.stopPropagation(); closePanel(panel.id); }}
                      title="이 학생 닫기"
                      className="absolute top-1/2 -translate-y-1/2 right-1 shrink-0 text-[11px] leading-none font-bold px-0.5 text-slate-300 hover:text-rose-500"
                    >×</span>
                  </button>
                );
              })}
            </div>
            <div className="shrink-0 p-1.5 border-t border-slate-100">
              <button onClick={openPicker} className="w-full text-[9px] font-black bg-[#002864] hover:bg-blue-900 text-white rounded-md px-1.5 py-1 transition-colors">
                + 학생 추가
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-hidden relative">
          {panels.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm px-6 text-center">
              학생과 문제지를 골라 채점을 시작하세요.
            </div>
          ) : activePanel ? (
            <div className="h-full flex flex-col bg-slate-100">
              <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-2">
                <span className="text-[12px] font-black text-[#002864] truncate">👤 {activePanel.studentName}</span>
                <button onClick={() => openItemPickerForPanel(activePanel)} className="shrink-0 text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md px-2 py-1 transition-colors">
                  🔄 시험지 바꾸기
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <GradingBoard
                  mode={activePanel.mode}
                  assignmentId={activePanel.assignmentId}
                  homeworkId={activePanel.homeworkId}
                  studentId={activePanel.studentId}
                  onBack={() => closePanel(activePanel.id)}
                  onDirtyChange={setActiveDirty}
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm px-6 text-center">
              왼쪽에서 채점할 학생을 선택하세요.
            </div>
          )}

          {pickerOpen && (
            <div className={`absolute inset-0 z-20 flex flex-col ${panels.length > 0 ? 'bg-slate-900/40 backdrop-blur-sm p-4 sm:p-6' : ''}`}>
              <div className={`flex-1 flex flex-col overflow-hidden min-h-0 ${panels.length > 0 ? 'bg-slate-50 rounded-2xl shadow-2xl p-4 sm:p-6 max-w-2xl w-full mx-auto' : 'p-4 sm:p-6'}`}>
                {panels.length > 0 && (
                  <div className="flex justify-between items-center mb-2 shrink-0">
                    <span className="text-xs font-bold text-slate-400">채점 중인 학생에 추가할 항목을 골라주세요</span>
                    <button onClick={() => setPickerOpen(false)} className="text-xs font-bold text-slate-400 hover:text-slate-600">닫기 ✕</button>
                  </div>
                )}
                {pickerBlock}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
