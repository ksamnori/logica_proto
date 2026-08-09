// src/components/exam/PublishPanel.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface ClassInfo {
  class_id: string;
  name: string;
  studentCount: number;
}

interface PublishPanelProps {
  examId: string | null;
  layoutType: string;
  initialTargetGrade?: string;
  onWeeklyMetaChange?: (targetGrade: string) => void;
  onPublishComplete: () => void;
}

const ALL_GRADES = '전체 학년';

export default function PublishPanel({ examId, layoutType, initialTargetGrade, onWeeklyMetaChange, onPublishComplete }: PublishPanelProps) {
  const router = useRouter();
  const isWeeklyTest = layoutType === '주간테스트';

  const [assignedStudents, setAssignedStudents] = useState<any[]>([]);
  const [selectedPublishStudents, setSelectedPublishStudents] = useState<Set<string>>(new Set());

  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [allClasses, setAllClasses] = useState<ClassInfo[]>([]);
  const [addedClassTabs, setAddedClassTabs] = useState<{class_id: string, class_name: string}[]>([]);
  const [classStudentsMap, setClassStudentsMap] = useState<Record<string, any[]>>({});

  // === 주간테스트 학년 배정 상태 (주차 선택은 시험지 메타 수정 쪽으로 옮겨졌다) ===
  const [weeklyTargetGrade, setWeeklyTargetGrade] = useState("");
  const [gradeOptions, setGradeOptions] = useState<string[]>([]);

  // 기존에 저장된 시험지를 다시 열었을 때 학년 배정 값을 복원한다.
  // 부모(exam/viewer)가 examId를 먼저 세팅한 뒤 비동기로 wGrade를 불러오므로, 이 값은 마운트
  // 이후에 뒤늦게 도착할 수 있다 — 아직 사용자가 직접 고르지 않은 상태에서만 반영한다.
  useEffect(() => {
    if (initialTargetGrade && !weeklyTargetGrade) setWeeklyTargetGrade(initialTargetGrade);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTargetGrade]);

  // 부모(exam_master 저장용)에 현재 학년 값을 알려준다.
  useEffect(() => {
    onWeeklyMetaChange?.(weeklyTargetGrade);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeklyTargetGrade]);

  useEffect(() => {
    if (!isWeeklyTest) return;
    (async () => {
      const { data } = await supabase.from('class').select('class_id, target_grade').not('target_grade', 'is', null);
      const options = Array.from(new Set((data || []).map((c: any) => c.target_grade).filter(Boolean))) as string[];
      setGradeOptions(options);
    })();
  }, [isWeeklyTest]);

  const [isGradeModalOpen, setIsGradeModalOpen] = useState(false);

  const loadAssignedStudents = useCallback(async () => {
    if (!examId) return;
    const { data } = await supabase.from('exam_assignment').select('*, student(name, grade), class(name)').eq('exam_id', examId).order('created_at', { ascending: false });
    setAssignedStudents(data || []);
  }, [examId]);

  useEffect(() => {
    loadAssignedStudents();
  }, [loadAssignedStudents]);

  // 반(class) 기준으로 묶어서 "현재 배포된 학생 현황"에 표시 — class_id가 없는 배정 건(과거 데이터 등)은
  // "반 미지정"으로 따로 묶는다.
  const groupedAssigned = useMemo(() => {
    const groups = new Map<string, any[]>();
    assignedStudents.forEach(a => {
      const key = a.class?.name || '반 미지정';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    });
    return Array.from(groups.entries());
  }, [assignedStudents]);

  const fetchClasses = async () => {
    try {
      const instId = localStorage.getItem('logica_instructor_id');
      const role = localStorage.getItem('logica_instructor_role') || '';
      const pos = localStorage.getItem('logica_instructor_position') || '';
      const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'PRINCIPAL'].includes(role.toUpperCase()) || pos.includes('최고관리자') || pos.includes('원장') || pos.includes('실장');

      let classQuery = supabase.from('class').select('class_id, name, enrollment(student_id)');
      if (!isAdmin) classQuery = classQuery.eq('instructor_id', instId);

      const { data: classesData, error } = await classQuery;
      if (error) throw error;

      let cls = classesData || [];
      const order = ['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon', '특강'];
      const getOrder = (name: string) => {
        for (let i = 0; i < order.length; i++) {
          if (name.includes(order[i])) return i;
        }
        return 999;
      };

      cls.sort((a, b) => {
        const oA = getOrder(a.name);
        const oB = getOrder(b.name);
        if (oA !== oB) return oA - oB;
        return a.name.localeCompare(b.name);
      });

      const classesWithCount = cls.map(c => {
        const studentCount = new Set((c.enrollment || []).map((e: any) => e.student_id)).size;
        return { ...c, studentCount };
      });

      setAllClasses(classesWithCount);
    } catch (e) {
      console.error("클래스 로딩 실패:", e);
    }
  };

  const addClassToTabs = async (classObj: {class_id: string, class_name: string}) => {
    setIsClassModalOpen(false);
    if (addedClassTabs.find(c => c.class_id === classObj.class_id)) return;

    setAddedClassTabs(prev => [...prev, classObj]);

    try {
        const [ { data: directStudents }, { data: enrolls } ] = await Promise.all([
            supabase.from('student').select('student_id, name, status').eq('class_id', classObj.class_id),
            supabase.from('enrollment').select('student_id, student(name, status)').eq('class_id', classObj.class_id)
        ]);

        const studentMap = new Map();
        if (directStudents) directStudents.forEach((s:any) => studentMap.set(s.student_id, s));
        if (enrolls) enrolls.forEach((e:any) => { if(e.student) studentMap.set(e.student_id, { student_id: e.student_id, name: e.student.name, status: e.student.status }) });

        const studentsList = Array.from(studentMap.values());
        setClassStudentsMap(prev => ({ ...prev, [classObj.class_id]: studentsList }));

        setSelectedPublishStudents(prev => {
            const newSelected = new Set(prev);
            studentsList.forEach(s => {
                if (s.status === '재원') newSelected.add(s.student_id);
            });
            return newSelected;
        });
    } catch (e) { console.error("학생 목록 불러오기 실패:", e); }
  };

  // 학년을 클릭하면 그 학년(또는 전체 학년)에 속한 반을 전부 한 번에 탭으로 추가한다 — 반을
  // 하나씩 체크하는 중간 단계 없이, 클릭 한 번으로 그 학년 전체가 원래 있던 "선택" 개념처럼 뜬다.
  const addGradeClasses = async (grade: string) => {
    setIsGradeModalOpen(false);
    setWeeklyTargetGrade(grade);
    const classQuery = grade === ALL_GRADES
      ? supabase.from('class').select('class_id, name')
      : supabase.from('class').select('class_id, name').eq('target_grade', grade);
    const { data } = await classQuery;
    const classes = (data || []).filter((c: any) => !addedClassTabs.some(t => t.class_id === c.class_id));
    await Promise.all(classes.map((c: any) => addClassToTabs({ class_id: c.class_id, class_name: c.name })));
  };

  const removeClassById = (classId: string) => {
    setAddedClassTabs(prev => prev.filter(c => c.class_id !== classId));

    const studentsToRemove = classStudentsMap[classId] || [];
    setSelectedPublishStudents(prev => {
        const newSelected = new Set(prev);
        studentsToRemove.forEach(s => newSelected.delete(s.student_id));
        return newSelected;
    });
  };

  const removeClassTab = (classId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeClassById(classId);
  };

  const submitPublish = async () => {
    if (!examId) return alert("시험지가 저장되지 않았습니다.");
    if (selectedPublishStudents.size === 0) return;
    if (!confirm(`${selectedPublishStudents.size}명에게 출제할까요?`)) return;
    try {
      // 배포 현황을 반별로 묶어 보여줄 수 있도록, 학생이 어느 탭(반)에서 체크됐는지로 class_id를 채운다.
      // 한 학생이 여러 탭에 걸쳐 있으면 먼저 발견된 탭을 대표 반으로 삼는다.
      const studentClassMap = new Map<string, string>();
      Object.entries(classStudentsMap).forEach(([classId, list]) => {
        list.forEach((s: any) => { if (!studentClassMap.has(s.student_id)) studentClassMap.set(s.student_id, classId); });
      });

      const inserts = Array.from(selectedPublishStudents).filter(id => !assignedStudents.some(a => a.student_id === id)).map(id => ({ exam_id: examId, student_id: id, class_id: studentClassMap.get(id) || null, status: '미응시' }));
      if (inserts.length > 0) {
        const { error: assignErr } = await supabase.from('exam_assignment').insert(inserts);
        if (assignErr) throw new Error(assignErr.message);
      }
      alert("출제 완료!");
      setSelectedPublishStudents(new Set());
      await loadAssignedStudents();
      onPublishComplete();
    } catch(e: any) { alert("출제 실패: " + e.message); }
  };

  const cancelAssignment = async (assignmentId: string) => {
    if (!confirm("⚠️ 이 학생의 출제를 취소하시겠습니까?\n(입력된 답안과 채점 기록이 있다면 모두 삭제됩니다.)")) return;
    try {
      await supabase.from('student_answer').delete().eq('exam_assignment_id', assignmentId);
      await supabase.from('student_exam_result').delete().eq('assignment_id', assignmentId);
      await supabase.from('exam_assignment').delete().eq('assignment_id', assignmentId);

      alert("✅ 출제가 성공적으로 취소되었습니다.");
      await loadAssignedStudents();
    } catch (e: any) { alert("❌ 출제 취소 중 오류가 발생했습니다: \n" + e.message); }
  };

  if (!examId) {
    return (
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-center">
        <h3 className="font-extrabold text-slate-700 text-lg mb-2">학생 배포 패널</h3>
        <p className="text-sm font-bold text-slate-400">새로운 시험지입니다.<br/>좌측 하단의 <span className="text-blue-600">[💾 저장]</span> 버튼을 먼저 눌러주세요.</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-700 border-b pb-2 flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-1.5">🎯 출제 및 배포 대상 관리</span>
          <span className="bg-blue-50 text-[#002864] font-bold text-[11px] px-2 py-1 rounded border border-blue-100">현재 배포 대상: <span className="text-[13px] text-blue-600">{selectedPublishStudents.size}</span>명</span>
        </h3>

        <div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                {isWeeklyTest && (
                    <button onClick={() => setIsGradeModalOpen(true)} className="bg-white border border-dashed border-[#009966] text-[#009966] hover:bg-[#009966]/10 px-3 py-1.5 rounded text-[11px] font-bold whitespace-nowrap transition-colors flex items-center gap-1 shadow-sm shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                        학년 추가
                    </button>
                )}
                <button onClick={() => { fetchClasses(); setIsClassModalOpen(true); }} className="bg-white border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded text-[11px] font-bold whitespace-nowrap transition-colors flex items-center gap-1 shadow-sm shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                    클래스 추가
                </button>
                {addedClassTabs.map(c => (
                    <div key={c.class_id} className="border px-3 py-1.5 rounded text-[11px] font-bold whitespace-nowrap flex items-center gap-1.5 shrink-0 bg-white text-slate-600 border-slate-300 shadow-sm">
                        {c.class_name}
                        <button onClick={(e) => removeClassTab(c.class_id, e)} className="hover:text-rose-400 w-3.5 h-3.5 flex justify-center items-center rounded-full bg-black/10 text-[9px]">✕</button>
                    </div>
                ))}
            </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-[350px] overflow-y-auto custom-scrollbar space-y-4">
            {addedClassTabs.length > 0 ? (
                addedClassTabs.map(c => (
                    <div key={c.class_id}>
                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-200">
                            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 cursor-pointer">
                                <input type="checkbox"
                                    checked={(classStudentsMap[c.class_id] || []).length > 0 && (classStudentsMap[c.class_id] || []).every(s => selectedPublishStudents.has(s.student_id))}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        const newSelected = new Set(selectedPublishStudents);
                                        (classStudentsMap[c.class_id] || []).forEach(s => {
                                            if (checked) newSelected.add(s.student_id);
                                            else newSelected.delete(s.student_id);
                                        });
                                        setSelectedPublishStudents(newSelected);
                                    }}
                                    className="w-3.5 h-3.5 accent-[#002864] cursor-pointer rounded" />
                                <span><span className="text-blue-600">{c.class_name}</span> 학생 모두 선택</span>
                            </label>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                            {classStudentsMap[c.class_id]?.length > 0 ? (
                                classStudentsMap[c.class_id].map(s => (
                                    <label key={s.student_id} className="flex items-center gap-1.5 text-[11px] cursor-pointer hover:bg-white p-1.5 rounded transition-colors border border-transparent hover:border-slate-200">
                                        <input type="checkbox"
                                            checked={selectedPublishStudents.has(s.student_id)}
                                            onChange={(e) => {
                                                const newSelected = new Set(selectedPublishStudents);
                                                if (e.target.checked) newSelected.add(s.student_id);
                                                else newSelected.delete(s.student_id);
                                                setSelectedPublishStudents(newSelected);
                                            }}
                                            className="w-3.5 h-3.5 accent-[#002864] rounded" />
                                        <span className={s.status === '재원' ? 'text-slate-700 font-bold' : 'text-slate-400 font-medium line-through'}>{s.name} {s.status !== '재원' ? `(${s.status})` : ''}</span>
                                    </label>
                                ))
                            ) : (
                                <div className="col-span-full text-center text-slate-400 font-bold text-[11px] py-4">해당 반에 등록된 학생이 없습니다.</div>
                            )}
                        </div>
                    </div>
                ))
            ) : (
                <div className="text-center text-slate-400 font-bold text-[11px] py-6">
                    {isWeeklyTest ? "위에서 학년을 선택하거나, [+ 클래스 추가] 버튼을 눌러 반을 추가해주세요." : "상단의 [+ 클래스 추가] 버튼을 눌러 반을 추가하고 학생을 선택해주세요."}
                </div>
            )}
        </div>

        <button onClick={submitPublish} disabled={selectedPublishStudents.size === 0} className="w-full bg-[#002864] text-white py-2 rounded-lg font-bold text-[12px] hover:bg-blue-900 transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5">
            🚀 선택한 {selectedPublishStudents.size}명에게 시험지 출제 및 배포하기
        </button>

        {assignedStudents.length > 0 && (
            <div className="mt-6 border-t border-slate-200 pt-4">
                <h4 className="text-[12px] font-bold text-slate-700 flex items-center gap-1.5 mb-3">📋 현재 배포된 학생 현황</h4>
                <div className="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                    {groupedAssigned.map(([className, list]) => (
                        <div key={className}>
                            <p className="text-[11px] font-extrabold text-[#002864] mb-1.5 flex items-center gap-1">📚 {className} <span className="text-slate-400 font-bold">({list.length}명)</span></p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {list.map(a => {
                                    const statusField = a.status || '미응시';
                                    let statusText = '', statusColor = '';
                                    if (['채점완료', '완료'].includes(statusField)) { statusText = `${a.total_score || 0}점`; statusColor = 'text-blue-600 bg-blue-50 border-blue-200'; }
                                    else if (['응시중', '제출완료'].includes(statusField)) { statusText = '대기중'; statusColor = 'text-rose-500 bg-rose-50 border-rose-200'; }
                                    else { statusText = '미응시'; statusColor = 'text-slate-500 bg-slate-100 border-slate-200'; }
                                    return (
                                        <div key={a.assignment_id} className="p-2.5 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col gap-2">
                                            <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
                                                <span className="font-bold text-[#002864] text-[11px]">{a.student?.name} <span className="text-[9px] text-slate-400 font-normal">({a.student?.grade})</span></span>
                                                <span className={`px-1.5 py-0.5 border rounded text-[10px] font-extrabold ${statusColor}`}>{statusText}</span>
                                            </div>
                                            <div className="flex justify-end gap-1.5">
                                                <button onClick={() => router.push(`/exam/review?assignment_id=${a.assignment_id}`)} className="px-2 py-1 bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white border border-emerald-200 rounded text-[10px] font-bold transition-colors">리뷰/채점</button>
                                                <button onClick={() => cancelAssignment(a.assignment_id)} className="px-2 py-1 bg-white hover:bg-rose-50 border border-slate-300 hover:border-rose-300 text-slate-500 hover:text-rose-500 rounded text-[10px] font-bold transition-colors">출제 취소</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}
      </div>

      {isClassModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex justify-center items-center z-[70] no-print">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
                <div className="bg-slate-50 px-6 py-4 flex justify-between items-center border-b border-slate-200">
                    <h3 className="text-slate-800 font-extrabold text-[15px]">🏫 배포할 클래스 선택</h3>
                    <button onClick={() => setIsClassModalOpen(false)} className="text-slate-400 hover:text-slate-700 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div className="p-4 max-h-[400px] overflow-y-auto custom-scrollbar space-y-2">
                    {allClasses.length === 0 ? (
                        <div className="text-center py-5 text-slate-400 font-bold text-[12px]">불러오는 중이거나 등록된 클래스가 없습니다.</div>
                    ) : (
                        allClasses.map(c => {
                            const isAdded = addedClassTabs.find(tab => tab.class_id === c.class_id);
                            if (isAdded) return null;
                            return (
                                <div key={c.class_id} onClick={() => addClassToTabs({class_id: c.class_id, class_name: c.name})} className="p-2.5 border border-slate-200 rounded-lg hover:bg-blue-50 cursor-pointer flex justify-between items-center group transition-colors">
                                    <span className="font-bold text-[12px] text-slate-700 group-hover:text-blue-700">
                                        {c.name} <span className="text-[10px] text-slate-400 font-normal ml-1">({c.studentCount}명)</span>
                                    </span>
                                    <span className="text-[10px] text-blue-500 font-bold bg-white px-2 py-1 rounded shadow-sm border border-blue-100 group-hover:bg-blue-500 group-hover:text-white transition-colors">+ 추가</span>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
      )}

      {isGradeModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex justify-center items-center z-[70] no-print">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
                <div className="bg-slate-50 px-6 py-4 flex justify-between items-center border-b border-slate-200">
                    <h3 className="text-slate-800 font-extrabold text-[15px]">🎓 배포할 학년 선택</h3>
                    <button onClick={() => setIsGradeModalOpen(false)} className="text-slate-400 hover:text-slate-700 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div className="p-4 max-h-[400px] overflow-y-auto custom-scrollbar space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 mb-1">학년을 고르면 그 학년에 속한 반이 전부 한 번에 배포 대상에 추가됩니다.</p>
                    <div onClick={() => addGradeClasses(ALL_GRADES)} className="p-2.5 border border-slate-200 rounded-lg hover:bg-[#009966]/10 cursor-pointer flex justify-between items-center group transition-colors">
                        <span className="font-bold text-[12px] text-slate-700 group-hover:text-[#009966]">🏫 {ALL_GRADES}</span>
                        <span className="text-[10px] text-[#009966] font-bold bg-white px-2 py-1 rounded shadow-sm border border-[#009966]/30 group-hover:bg-[#009966] group-hover:text-white transition-colors">+ 추가</span>
                    </div>
                    {gradeOptions.length === 0 ? (
                        <div className="text-center py-5 text-slate-400 font-bold text-[12px]">불러오는 중이거나 등록된 학년이 없습니다.</div>
                    ) : (
                        gradeOptions.map(g => (
                            <div key={g} onClick={() => addGradeClasses(g)} className="p-2.5 border border-slate-200 rounded-lg hover:bg-[#009966]/10 cursor-pointer flex justify-between items-center group transition-colors">
                                <span className="font-bold text-[12px] text-slate-700 group-hover:text-[#009966]">{g}</span>
                                <span className="text-[10px] text-[#009966] font-bold bg-white px-2 py-1 rounded shadow-sm border border-[#009966]/30 group-hover:bg-[#009966] group-hover:text-white transition-colors">+ 추가</span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
      )}
    </>
  );
}
