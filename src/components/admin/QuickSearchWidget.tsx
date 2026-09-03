// src/components/admin/QuickSearchWidget.tsx
"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

interface QuickSearchWidgetProps {
  allStudentsData: any[];
}

export default function QuickSearchWidget({ allStudentsData }: QuickSearchWidgetProps) {
  const router = useRouter();

  // 검색 및 필터 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [searchClassFilter, setSearchClassFilter] = useState("all");
  const [searchStatusFilter, setSearchStatusFilter] = useState("재원");
  const [searchGradeFilter, setSearchGradeFilter] = useState("all");
  const [showStudentPhone, setShowStudentPhone] = useState<Record<string, boolean>>({});

  // 1. 필터용 드롭다운 데이터 추출
  const availableGrades = useMemo(() => {
    const grades = allStudentsData.map(s => s.grade).filter(Boolean);
    return Array.from(new Set(grades)).sort((a, b) => {
      const order = { '초': 1, '중': 2, '고': 3 };
      const aMatch = String(a).match(/([초중고])\s*(\d)/);
      const bMatch = String(b).match(/([초중고])\s*(\d)/);
      if (aMatch && bMatch) {
        if (order[aMatch[1] as keyof typeof order] !== order[bMatch[1] as keyof typeof order]) {
          return order[aMatch[1] as keyof typeof order] - order[bMatch[1] as keyof typeof order];
        }
        return Number(aMatch[2]) - Number(bMatch[2]);
      }
      return String(a).localeCompare(String(b));
    });
  }, [allStudentsData]);

  const availableClasses = useMemo(() => {
    const classSet = new Set<string>();
    allStudentsData.forEach(s => {
      const activeEnrolls = s.enrollment?.filter((e:any) => !e.end_date || e.status === '수강중') || [];
      activeEnrolls.forEach((e:any) => {
        const cName = unwrap(e.class)?.name;
        if (cName) classSet.add(cName);
      });
    });
    return Array.from(classSet).sort();
  }, [allStudentsData]);

  // 2. 필터링된 결과 연산
  const filteredSearchData = useMemo(() => {
    return allStudentsData.filter(s => {
      if (searchStatusFilter !== 'all' && s.status !== searchStatusFilter) return false;
      if (searchGradeFilter !== 'all' && s.grade !== searchGradeFilter) return false;
      
      const activeEnrolls = s.enrollment?.filter((e:any) => !e.end_date || e.status === '수강중') || [];
      const classNames = activeEnrolls.map((e:any) => unwrap(e.class)?.name).filter(Boolean);
      
      if (searchClassFilter !== 'all' && !classNames.includes(searchClassFilter)) return false;
      
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const sName = (s.name || '').toLowerCase();
        const sSchool = (s.school || '').toLowerCase();
        const sPhone = (s.phone || '').replace(/-/g, '');
        const pPhone = (unwrap(s.parent)?.phone || '').replace(/-/g, '');
        const qPhone = q.replace(/-/g, '');
        
        return sName.includes(q) || sSchool.includes(q) || sPhone.includes(qPhone) || pPhone.includes(qPhone);
      }
      return true;
    });
  }, [allStudentsData, searchQuery, searchClassFilter, searchStatusFilter, searchGradeFilter]);

  return (
    <div className="bg-white rounded-2xl p-5 border border-indigo-100 shadow-[0_8px_30px_rgba(0,0,0,0.06)] col-span-1 md:col-span-2 h-64 flex flex-col relative overflow-hidden group">
      <div className="absolute right-[-10px] bottom-[-20px] text-8xl opacity-[0.03] pointer-events-none group-hover:scale-110 transition-transform duration-500">🔎</div>
      
      <div className="flex justify-between items-center mb-3 shrink-0 relative z-10">
        <span className="text-sm font-extrabold text-slate-700 flex items-center gap-1.5">
          <span className="text-base">🔎</span> 통합 원생 검색기
          <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 shadow-sm ml-1">Quick Search</span>
        </span>
      </div>
      
      <div className="flex gap-2 mb-3 shrink-0 relative z-10">
        <select value={searchStatusFilter} onChange={e=>setSearchStatusFilter(e.target.value)} className="w-[80px] border border-slate-300 rounded-lg p-1.5 text-xs font-bold text-slate-600 bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm">
          <option value="all">상태 전체</option>
          <option value="재원">✅ 재원</option>
          <option value="휴원">⏸️ 휴원</option>
          <option value="퇴원">❌ 퇴원</option>
          <option value="입학테스트">📝 대기</option>
        </select>
        <select value={searchGradeFilter} onChange={e=>setSearchGradeFilter(e.target.value)} className="w-[84px] border border-slate-300 rounded-lg p-1.5 text-xs font-bold text-slate-600 bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm">
          <option value="all">학년 전체</option>
          {availableGrades.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={searchClassFilter} onChange={e=>setSearchClassFilter(e.target.value)} className="w-[100px] border border-slate-300 rounded-lg p-1.5 text-xs font-bold text-slate-600 bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm truncate">
          <option value="all">수강반 전체</option>
          {availableClasses.map(cName => <option key={cName} value={cName}>{cName}</option>)}
        </select>
        <div className="flex-1 relative">
          <input type="text" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="이름, 연락처, 학부모 연락처, 학교 검색..." className="w-full border border-slate-300 rounded-lg p-1.5 pl-8 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm placeholder:text-slate-400" />
          <svg className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scroll border border-slate-200 rounded-lg bg-slate-50 relative z-10 min-h-0 shadow-inner">
        <table className="w-full text-left text-[11px] whitespace-nowrap">
          <thead className="sticky top-0 bg-white border-b border-slate-200 z-10 shadow-sm">
            <tr>
              <th className="py-2 px-3 font-extrabold text-slate-500 w-[80px]">이름</th>
              <th className="py-2 px-3 font-extrabold text-slate-500">학교/학년</th>
              <th className="py-2 px-3 font-extrabold text-slate-500">수강반</th>
              <th className="py-2 px-3 font-extrabold text-slate-500">학부모 연락처</th>
              <th className="py-2 px-3 font-extrabold text-slate-500 text-center">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {filteredSearchData.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-slate-400 font-bold">조건에 맞는 학생이 없습니다.</td></tr>
            ) : (
              filteredSearchData.map(s => {
                const activeEnrolls = s.enrollment?.filter((e:any) => !e.end_date || e.status === '수강중') || [];
                const cNames = activeEnrolls.map((e:any)=>unwrap(e.class)?.name).filter(Boolean).join(", ") || "-";
                
                const schoolGradeStr = `${s.school||'-'} ${s.grade||''}`.trim();
                const parentPhone = unwrap(s.parent)?.phone || '미입력';

                return (
                  <tr key={s.student_id} onClick={() => router.push(`/student/${s.student_id}`)} className="cursor-pointer hover:bg-indigo-50/50 transition-colors group bg-white">
                    <td className="py-2 px-3 font-bold text-[#002864] group-hover:text-indigo-600 group-hover:underline max-w-[100px] truncate">{s.name}</td>
                    <td className="py-2 px-3 text-slate-500 max-w-[120px] truncate" title={schoolGradeStr}>{schoolGradeStr}</td>
                    <td className="py-2 px-3 text-slate-600 max-w-[120px] truncate" title={cNames}>{cNames}</td>
                    <td className="py-2 px-3 text-slate-500 align-middle">
                      <div className="flex flex-col gap-1 justify-center">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-700 tabular-nums tracking-tight">{parentPhone}</span>
                          {s.status === '입학테스트' && parentPhone && (
                            <span className="text-[8px] bg-rose-50 text-rose-500 border border-rose-100 px-1 py-0.5 rounded shadow-sm leading-none mt-0.5">학부모</span>
                          )}
                          {s.phone && !showStudentPhone[s.student_id] && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); setShowStudentPhone(p => ({...p, [s.student_id]: true})); }}
                              className="text-[9px] bg-white border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 px-1 py-0.5 rounded font-bold transition-colors shadow-sm flex items-center gap-0.5 leading-none mt-0.5"
                              title="학생 연락처 보기"
                            >
                              학생 <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            </button>
                          )}
                        </div>
                        {s.phone && showStudentPhone[s.student_id] && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[11px] font-bold text-indigo-600 tabular-nums tracking-tight">{s.phone}</span>
                            <span className="text-[8px] bg-indigo-50 text-indigo-500 border border-indigo-100 px-1 py-0.5 rounded shadow-sm">학생</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center align-middle">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shadow-sm border ${s.status==='재원'?'bg-emerald-50 text-emerald-600 border-emerald-100':s.status==='입학테스트'?'bg-amber-50 text-amber-600 border-amber-100':s.status==='휴원'?'bg-rose-50 text-rose-500 border-rose-100':'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {s.status === '입학테스트' ? '대기' : s.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}