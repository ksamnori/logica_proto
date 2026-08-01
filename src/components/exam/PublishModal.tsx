// src/components/exam/PublishModal.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

interface PublishModalProps {
  isOpen: boolean;
  examId: string;
  title: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function PublishModal({ isOpen, examId, title, onClose, onSuccess }: PublishModalProps) {
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [groupedStudents, setGroupedStudents] = useState<{ [key: string]: any[] }>({});
  const [allClasses, setAllClasses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [publishTab, setPublishTab] = useState("grade");
  const [publishSearch, setPublishSearch] = useState("");
  const [alwaysOpen, setAlwaysOpen] = useState(true);
  
  // 💡 [핵심 수정] 선택된 학생 목록에 class_id를 함께 저장하도록 객체 배열로 변경
  const [selectedStudents, setSelectedStudents] = useState<any[]>([]);
  
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [expandedClassGroups, setExpandedClassGroups] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setSelectedStudents([]);
      setPublishSearch("");
      loadStudentsAndClasses();
    }
  }, [isOpen]);

  const formatGrade = (g: any) => {
    if (!g) return '-';
    if (isNaN(Number(g))) return g;
    const num = parseInt(g, 10);
    if (num >= 1 && num <= 6) return `초등 ${num}학년`;
    if (num >= 7 && num <= 9) return `중등 ${num - 6}학년`;
    if (num >= 10 && num <= 12) return `고등 ${num - 9}학년`;
    return `${num}학년`;
  };

  const loadStudentsAndClasses = async () => {
    setIsLoading(true);
    try {
      const instId = localStorage.getItem('logica_instructor_id');
      const role = localStorage.getItem('logica_instructor_role') || '';
      const pos = localStorage.getItem('logica_instructor_position') || '';
      
      // 💡 최고관리자, SUPER_ADMIN 권한 적용
      const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'PRINCIPAL'].includes(role.toUpperCase()) || pos.includes('최고관리자') || pos.includes('원장') || pos.includes('실장');

      let classQuery = supabase.from('class').select('*');
      if (!isAdmin) classQuery = classQuery.eq('instructor_id', instId);

      const [ { data: studentsData }, { data: classesData }, { data: enrollsData } ] = await Promise.all([
        supabase.from('student').select('*').eq('status', '재원'),
        classQuery,
        supabase.from('enrollment').select('*')
      ]);

      const activeStudents = studentsData || [];
      const cls = classesData || [];
      const enrolls = enrollsData || [];

      const classNameMap = new Map();
      cls.forEach(c => classNameMap.set(c.class_id, c.name));

      const classIdsByStudent = new Map();
      const studentIdsByClass = new Map();
      cls.forEach(c => studentIdsByClass.set(c.class_id, new Set()));

      enrolls.forEach(e => {
        if (!classIdsByStudent.has(e.student_id)) classIdsByStudent.set(e.student_id, new Set());
        classIdsByStudent.get(e.student_id).add(e.class_id);
        if (studentIdsByClass.has(e.class_id)) studentIdsByClass.get(e.class_id).add(e.student_id);
      });

      const processedStudents = activeStudents.map((s: any) => {
        const cIds = classIdsByStudent.get(s.student_id) || new Set();
        const cIdsArr = Array.from(cIds);
        const cNames = cIdsArr.map(cid => classNameMap.get(cid)).filter(Boolean);
        return { ...s, classIds: cIdsArr, displayClassNames: cNames.join(', ') || '반 미지정' };
      });

      setAllStudents(processedStudents);

      const grouped: { [key: string]: any[] } = {};
      processedStudents.forEach(s => {
        const gName = formatGrade(s.grade);
        if (!grouped[gName]) grouped[gName] = [];
        grouped[gName].push(s);
      });
      setGroupedStudents(grouped);

      const activeStudentsMap = new Map();
      processedStudents.forEach(s => activeStudentsMap.set(s.student_id, s));

      const order = ['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon', '특강'];
      const getOrder = (name: string) => {
        for (let i = 0; i < order.length; i++) if (name.includes(order[i])) return i;
        return 999; 
      };

      cls.sort((a, b) => {
        const oA = getOrder(a.name);
        const oB = getOrder(b.name);
        if (oA !== oB) return oA - oB;
        return a.name.localeCompare(b.name);
      });

      const classesWithStudents = cls.map(c => {
        const sIds = studentIdsByClass.get(c.class_id) || new Set();
        const studentsInThisClass = Array.from(sIds).map(sid => activeStudentsMap.get(sid)).filter(Boolean);
        return { ...c, students: studentsInThisClass };
      });

      setAllClasses(classesWithStudents);
    } catch (e) {
      console.error("데이터 로딩 오류:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleGroup = (groupName: string) => {
    if (alwaysOpen) return;
    setExpandedGroups(prev => prev.includes(groupName) ? prev.filter(g => g !== groupName) : [...prev, groupName]);
  };

  const toggleClassGroup = (classId: string) => {
    if (alwaysOpen) return;
    setExpandedClassGroups(prev => prev.includes(classId) ? prev.filter(id => id !== classId) : [...prev, classId]);
  };

  // 💡 선택 헬퍼 함수
  const isSelected = (studentId: string, classId: string | null) => {
    return selectedStudents.some(s => s.student_id === studentId && s.class_id === classId);
  };

  const toggleStudentSelect = (student: any, classId: string | null, className: string) => {
    setSelectedStudents(prev => {
      const exists = prev.find(s => s.student_id === student.student_id && s.class_id === classId);
      if (exists) return prev.filter(s => !(s.student_id === student.student_id && s.class_id === classId));
      return [...prev, { student_id: student.student_id, class_id: classId, name: student.name, grade: student.grade, className }];
    });
  };

  const selectAllInGroup = (groupName: string, e: any) => {
    e.stopPropagation();
    const targetStudents = groupedStudents[groupName] || [];
    setSelectedStudents(prev => {
      const newArr = [...prev];
      targetStudents.forEach(s => {
        // 학년 탭에서 선택 시 학생의 첫 번째 등록된 반을 사용하거나 없으면 null
        const defaultClassId = s.classIds && s.classIds.length > 0 ? s.classIds[0] : null;
        const defaultClassName = s.displayClassNames.split(',')[0] || '반 미지정';
        
        if (!newArr.find(x => x.student_id === s.student_id && x.class_id === defaultClassId)) {
          newArr.push({ student_id: s.student_id, class_id: defaultClassId, name: s.name, grade: s.grade, className: defaultClassName });
        }
      });
      return newArr;
    });
  };

  const selectAllInClass = (classId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const targetClass = allClasses.find(c => c.class_id === classId);
    if (!targetClass) return;
    
    setSelectedStudents(prev => {
      const newArr = [...prev];
      targetClass.students.forEach((s: any) => {
        if (!newArr.find(x => x.student_id === s.student_id && x.class_id === classId)) {
          newArr.push({ student_id: s.student_id, class_id: classId, name: s.name, grade: s.grade, className: targetClass.name });
        }
      });
      return newArr;
    });
  };

  const submitPublish = async () => {
    if (selectedStudents.length === 0 || !examId) return;
    if (!confirm(`선택한 ${selectedStudents.length}건의 출제를 진행하시겠습니까?`)) return;

    try {
      // 💡 기존에 배부된 기록을 가져올 때 class_id도 함께 조회하여, '같은 학생이더라도 반이 다르면' 새로 배부할 수 있도록 허용
      const { data: existing } = await supabase.from('exam_assignment').select('student_id, class_id').eq('exam_id', examId);
      
      const inserts = selectedStudents.filter(sel => {
        const isDuplicate = existing?.some(e => e.student_id === sel.student_id && e.class_id === sel.class_id);
        return !isDuplicate;
      }).map(sel => ({
        exam_id: examId,
        student_id: sel.student_id,
        class_id: sel.class_id, // 💡 드디어 반 정보를 함께 저장!
        status: '미응시'
      }));

      if (inserts.length === 0) { 
        alert("선택한 모든 학생이 이미 이 반으로 시험지를 배부받았습니다."); 
        onClose(); 
        return; 
      }

      const { error } = await supabase.from('exam_assignment').insert(inserts);
      if (error) throw error;

      alert(`🎉 성공적으로 ${inserts.length}건의 문제지가 배부되었습니다.`);
      onSuccess();
      onClose();
    } catch (e: any) { alert(`❌ 출제 실패: ${e.message}`); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[99] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-xl shadow-2xl flex flex-col overflow-hidden h-[80vh]">
        <div className="p-4 flex justify-between items-center border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
            학습지 배부하기 <span className="text-sm font-bold text-slate-400 font-normal truncate max-w-[300px]">{title}</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-rose-500 font-bold text-xl">&times;</button>
        </div>
        
        <div className="px-4 pt-3 shrink-0">
          <div className="flex border border-slate-200 rounded-md overflow-hidden bg-slate-50">
            <button onClick={() => setPublishTab('grade')} className={`flex-1 py-2 text-sm font-extrabold transition-colors ${publishTab === 'grade' ? 'bg-white text-slate-800 border-b-2 border-[#002864]' : 'text-slate-400 hover:text-slate-600 border-b-2 border-transparent'}`}>학년별 선택</button>
            <button onClick={() => setPublishTab('class')} className={`flex-1 py-2 text-sm font-extrabold transition-colors ${publishTab === 'class' ? 'bg-white text-slate-800 border-b-2 border-[#002864]' : 'text-slate-400 hover:text-slate-600 border-b-2 border-transparent'}`}>수강반별 선택</button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden p-4 gap-4">
          <div className="w-1/2 flex flex-col border border-slate-200 rounded-md overflow-hidden bg-white">
            <div className="p-2 border-b border-slate-200 bg-white relative">
              <svg className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              <input type="text" value={publishSearch} onChange={e => setPublishSearch(e.target.value)} placeholder="학생 이름 검색" className="w-full pl-8 pr-8 py-1.5 text-sm font-bold border-none focus:outline-none focus:ring-0" />
              <button onClick={() => setPublishSearch("")} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-300 hover:text-slate-500">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll relative">
              {isLoading ? (
                <div className="absolute inset-0 flex items-center justify-center text-slate-400 font-bold text-sm">데이터를 불러오는 중입니다...</div>
              ) : publishTab === 'grade' ? (
                Object.keys(groupedStudents).sort().map(groupName => {
                  const studentsInGroup = groupedStudents[groupName].filter((s: any) => {
                    const defaultClassId = s.classIds && s.classIds.length > 0 ? s.classIds[0] : null;
                    return !isSelected(s.student_id, defaultClassId) && (publishSearch === '' || s.name.toLowerCase().includes(publishSearch.toLowerCase()));
                  });
                  if (studentsInGroup.length === 0 && publishSearch !== '') return null;
                  if (groupedStudents[groupName].length === 0) return null;

                  const isExpanded = alwaysOpen || publishSearch !== '' || expandedGroups.includes(groupName);

                  return (
                    <div key={groupName} className="border-b border-slate-100">
                      <div className="px-4 py-2.5 bg-slate-50 flex justify-between items-center cursor-pointer hover:bg-slate-100" onClick={() => toggleGroup(groupName)}>
                        <div className="flex items-center gap-2">
                          <svg className={`w-4 h-4 text-slate-400 transform transition-transform ${isExpanded ? "" : "-rotate-90"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                          <span className="text-sm font-extrabold text-slate-700">{groupName} <span className="text-slate-400 font-bold ml-1">{groupedStudents[groupName].length}명</span></span>
                        </div>
                        <button onClick={(e) => selectAllInGroup(groupName, e)} className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded text-xs hover:bg-blue-200 transition-colors shadow-sm ml-2 font-bold">+ 전체선택</button>
                      </div>
                      {isExpanded && (
                        <div>
                          {studentsInGroup.map((s: any) => {
                            const defaultClassId = s.classIds && s.classIds.length > 0 ? s.classIds[0] : null;
                            const defaultClassName = s.displayClassNames.split(',')[0] || '반 미지정';
                            return (
                              <div key={s.student_id} className="px-4 py-2 bg-white flex justify-between items-center hover:bg-blue-50 border-t border-slate-50 transition-colors">
                                <span className="text-sm font-bold text-slate-600 ml-6">{s.name} <span className="text-[11px] text-slate-400 font-medium">({formatGrade(s.grade)} | {defaultClassName})</span></span>
                                <button onClick={() => toggleStudentSelect(s, defaultClassId, defaultClassName)} className="text-blue-500 hover:text-blue-700 focus:outline-none"><svg className="w-5 h-5 fill-current" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd"></path></svg></button>
                              </div>
                            );
                          })}
                          {studentsInGroup.length === 0 && groupedStudents[groupName].length > 0 && (
                            <div className="px-4 py-3 text-center text-xs text-slate-400 font-bold bg-white">해당 학년의 모든 학생이 선택되었습니다.</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                allClasses.map(c => {
                    if (c.students.length === 0) return null;
                    const studentsInClass = c.students.filter((s: any) => !isSelected(s.student_id, c.class_id) && (publishSearch === '' || s.name.toLowerCase().includes(publishSearch.toLowerCase())));
                    if (studentsInClass.length === 0 && publishSearch !== '') return null;
                    
                    const isExpanded = alwaysOpen || publishSearch !== '' || expandedClassGroups.includes(c.class_id);

                    return (
                      <div key={c.class_id} className="border-b border-slate-100">
                        <div className="px-4 py-2.5 bg-slate-50 flex justify-between items-center cursor-pointer hover:bg-slate-100" onClick={() => toggleClassGroup(c.class_id)}>
                          <div className="flex items-center gap-2">
                            <svg className={`w-4 h-4 text-slate-400 transform transition-transform ${isExpanded ? "" : "-rotate-90"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            <span className="text-sm font-extrabold text-slate-700">{c.name} <span className="text-slate-400 font-bold ml-1">{c.students.length}명</span></span>
                          </div>
                          <button onClick={(e) => selectAllInClass(c.class_id, e)} className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded text-xs hover:bg-blue-200 transition-colors shadow-sm ml-2 font-bold">+ 반 전체추가</button>
                        </div>
                        {isExpanded && (
                          <div>
                            {studentsInClass.map((s: any) => (
                              <div key={s.student_id} className="px-4 py-2 bg-white flex justify-between items-center hover:bg-blue-50 border-t border-slate-50 transition-colors">
                                <span className="text-sm font-bold text-slate-600 ml-6">{s.name} <span className="text-[11px] text-slate-400 font-medium">({formatGrade(s.grade)})</span></span>
                                <button onClick={() => toggleStudentSelect(s, c.class_id, c.name)} className="text-blue-500 hover:text-blue-700 focus:outline-none"><svg className="w-5 h-5 fill-current" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd"></path></svg></button>
                              </div>
                            ))}
                            {studentsInClass.length === 0 && c.students.length > 0 && (
                              <div className="px-4 py-3 text-center text-xs text-slate-400 font-bold bg-white">이 반의 모든 학생이 선택되었습니다.</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                })
              )}
            </div>
          </div>

          <div className="w-1/2 flex flex-col border border-slate-200 rounded-md overflow-hidden bg-slate-50">
            <div className="p-3 border-b border-slate-200 bg-white flex justify-between items-center shrink-0">
              <span className="text-sm font-extrabold text-slate-800">배부 대상 목록 <span className="text-[#002864] font-black">{selectedStudents.length}건</span></span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll relative bg-white">
              {selectedStudents.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 p-6 text-center z-0">
                  <span className="text-sm font-bold">왼쪽의 <span className="bg-blue-500 text-white rounded-full w-4 h-4 inline-flex items-center justify-center font-black mx-1">+</span> 를 눌러<br/>출제할 학생/반을 선택해 주세요.</span>
                </div>
              ) : (
                <div className="relative z-10 bg-white min-h-full">
                  {selectedStudents.map(sel => (
                    <div key={`${sel.student_id}_${sel.class_id}`} className="px-4 py-2.5 bg-white flex justify-between items-center border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <span className="text-sm font-bold text-slate-800">
                        {sel.name} <span className="text-[11px] text-slate-400 ml-1">({formatGrade(sel.grade)} | <span className="text-[#002864]">{sel.className}</span>)</span>
                      </span>
                      <button onClick={() => toggleStudentSelect({ student_id: sel.student_id }, sel.class_id, sel.className)} className="text-rose-400 hover:text-rose-600 focus:outline-none"><svg className="w-5 h-5 fill-current" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd"></path></svg></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 bg-white flex justify-between items-center shrink-0">
          <label className="relative inline-flex items-center cursor-pointer gap-2">
            <input type="checkbox" checked={alwaysOpen} onChange={(e) => setAlwaysOpen(e.target.checked)} className="sr-only peer" />
            <div className="w-10 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
            <span className="text-sm font-bold text-slate-600">목록 항상 열어서 보기</span>
          </label>
          <button 
            onClick={submitPublish} 
            className={`px-6 py-2.5 font-extrabold text-sm rounded-md transition-colors shadow-sm ${selectedStudents.length > 0 ? 'bg-[#002864] hover:bg-blue-900 text-white cursor-pointer' : 'bg-slate-100 text-slate-400 pointer-events-none'}`}
          >
            선택 완료 및 배포
          </button>
        </div>
      </div>
    </div>
  );
}