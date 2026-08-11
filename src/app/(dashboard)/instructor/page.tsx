// src/app/(dashboard)/instructor/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function InstructorManagementPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [instructors, setInstructors] = useState<any[]>([]);
  const [selectedInstId, setSelectedInstId] = useState<string | null>(null);
  
  const [instStats, setInstStats] = useState<any>(null);
  
  const [secretForm, setSecretForm] = useState({
    contract_type: "",
    performance_grade: "",
    warning_count: 0,
    admin_memo: ""
  });
  const [isSecretVisible, setIsSecretVisible] = useState(false);
  const [isSavingSecret, setIsSavingSecret] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    
    // 🌟 [보안 강화] URL 직접 타이핑 우회 차단! "실장"을 제외하고 오직 원장/최고관리자만 허용합니다.
    const adminFlag = ["SUPER_ADMIN", "ADMIN"].includes(role.toUpperCase()) || 
                      ["최고관리자", "대장", "원장"].some(p => pos.includes(p));
                      
    if (!adminFlag) {
      alert("⛔ 해당 페이지에 접근할 권한이 없습니다. (원장 및 최고관리자 전용)");
      router.push("/home");
      return;
    }
    
    setIsAuthorized(true);
    fetchInstructors();
  }, []);

  useEffect(() => {
    if (selectedInstId) {
      setIsSecretVisible(false);
      calculateInstructorStats(selectedInstId);
    }
  }, [selectedInstId]);

  const fetchInstructors = async () => {
    setIsLoading(true);
    try {
      const tenantId = localStorage.getItem("logica_tenant_id");
      
      let query = supabase.from("instructor").select("*").eq("status", "재직");
      if (tenantId && tenantId !== 'hq') {
        query = query.eq("tenant_id", tenantId);
      }

      const { data, error } = await query.order("name", { ascending: true });
      if (error) throw error;
      
      if (data && data.length > 0) {
        setInstructors(data);
        if (!selectedInstId) setSelectedInstId(data[0].instructor_id);
      }
    } catch (e) {
      console.error("강사 목록 로드 에러:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const getProfileImageUrl = (path: string | null | undefined) => {
    if (!path || path.trim() === "") return null;
    if (path.startsWith("http")) return path;
    const { data } = supabase.storage.from("system_images").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedInstId) return;

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `profiles/inst_${selectedInstId}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('system_images')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('instructor')
        .update({ profile_image_url: fileName })
        .eq('instructor_id', selectedInstId);

      if (updateError) throw updateError;

      alert("프로필 이미지가 변경되었습니다.");
      fetchInstructors(); 
    } catch (error: any) {
      alert("이미지 업로드 실패: " + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const calculateInstructorStats = async (instId: string) => {
    setInstStats(null); 
    
    try {
      const inst = instructors.find(i => i.instructor_id === instId);
      if (inst) {
        setSecretForm({
          contract_type: inst.contract_type || "",
          performance_grade: inst.performance_grade || "",
          warning_count: inst.warning_count || 0,
          admin_memo: inst.admin_memo || ""
        });
      }

      const [
        { data: classes, error: classErr },
        { data: allEnrolls },
        { data: allStudents }
      ] = await Promise.all([
        supabase.from("class").select("*").eq("instructor_id", instId).eq("status", "진행중"),
        supabase.from("enrollment").select("*"),
        supabase.from("student").select("*, consultation_log(created_at)")
      ]);

      if (classErr) throw classErr;

      const classIds = classes?.map(c => c.class_id) || [];
      
      let totalStudents = 0;
      let consultStatus = { green: 0, yellow: 0, red: 0, redList: [] as string[] };
      let activeStudentsList: any[] = [];
      let levelCounts: Record<string, number> = {};
      let classDataList: any[] = [];
      let attendanceIssues = { absent: 0, late: 0 };
      let hwSubmitRate = 0;
      let overallAvgScore = 0;
      let recentDropouts = 0;

      if (classIds.length > 0) {
        let myAllStudents: any[] = [];
        (allStudents || []).forEach(s => {
          const belongsToInst = classIds.includes(s.class_id) || 
                                (allEnrolls || []).some(e => e.student_id === s.student_id && classIds.includes(e.class_id));
          if (belongsToInst) {
            myAllStudents.push(s);
          }
        });

        activeStudentsList = myAllStudents.filter(s => s.status === '재원');
        totalStudents = activeStudentsList.length;

        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
        
        recentDropouts = myAllStudents.filter(s => 
          (s.status === '퇴원' || s.status === '휴원') && s.updated_at >= firstDayOfMonth
        ).length;

        const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const { data: attData } = await supabase
          .from("attendance")
          .select("status")
          .in("class_id", classIds)
          .gte("attendance_date", lastWeek)
          .in("status", ['결석', '지각']);
        
        attData?.forEach(a => {
          if (a.status === '결석') attendanceIssues.absent++;
          if (a.status === '지각') attendanceIssues.late++;
        });

        const now = today.getTime();
        activeStudentsList.forEach(s => {
          if (!s.consultation_log || s.consultation_log.length === 0) {
            consultStatus.red++;
            consultStatus.redList.push(s.name);
          } else {
            const sortedLogs = [...s.consultation_log].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            const lastConsultDate = new Date(sortedLogs[0].created_at).getTime();
            const daysDiff = (now - lastConsultDate) / (1000 * 3600 * 24);

            if (daysDiff <= 14) consultStatus.green++;
            else if (daysDiff <= 30) consultStatus.yellow++;
            else {
              consultStatus.red++;
              consultStatus.redList.push(s.name);
            }
          }
        });

        const studentIds = activeStudentsList.map(s => s.student_id).filter(Boolean);
        if (studentIds.length > 0) {
           const { data: hwData } = await supabase
             .from("student_homework_result")
             .select("status")
             .in("student_id", studentIds);
           
           if (hwData && hwData.length > 0) {
              const submitted = hwData.filter(h => h.status === '제출완료' || h.status === '채점완료').length;
              hwSubmitRate = Math.round((submitted / hwData.length) * 100);
           }
        }

        const { data: examData } = await supabase
          .from("exam_assignment")
          .select("class_id, total_score, exam_master!inner(created_at)")
          .in("class_id", classIds)
          .not("total_score", "is", null);

        const classExamGroups: Record<string, Record<string, number[]>> = {};
        let allScoresTotal = 0;
        let allScoresCount = 0;

        examData?.forEach((ea: any) => {
           const cId = ea.class_id;
           const dStr = ea.exam_master?.created_at?.split('T')[0];
           const score = ea.total_score;
           
           if (cId && dStr && score !== null) {
              if (!classExamGroups[cId]) classExamGroups[cId] = {};
              if (!classExamGroups[cId][dStr]) classExamGroups[cId][dStr] = [];
              classExamGroups[cId][dStr].push(score);

              allScoresTotal += score;
              allScoresCount++;
           }
        });

        if (allScoresCount > 0) {
           overallAvgScore = Math.round(allScoresTotal / allScoresCount);
        }

        const activeStudentIdSet = new Set(studentIds);

        classDataList = classes?.map(c => {
          const cId = c.class_id;
          
          let sCount = 0;
          (allEnrolls || []).forEach(e => {
            if (e.class_id === cId && activeStudentIdSet.has(e.student_id)) {
              sCount++;
            }
          });
          activeStudentsList.forEach(s => {
            if (s.class_id === cId && !(allEnrolls || []).some(e => e.student_id === s.student_id && e.class_id === cId)) {
              sCount++;
            }
          });
          
          const capacity = c.capacity || 12; 
          const vacancy = Math.max(0, capacity - sCount);
          const fillRate = Math.min(100, Math.round((sCount / capacity) * 100));
          
          const lName = c.level_name || '기타';
          if (!levelCounts[lName]) levelCounts[lName] = 0;
          levelCounts[lName] += sCount;

          let cAvg = 0;
          let trendData: number[] = [];

          if (classExamGroups[cId]) {
             const dates = Object.keys(classExamGroups[cId]).sort();
             const recentDates = dates.slice(-5); 
             trendData = recentDates.map(d => {
                const scores = classExamGroups[cId][d];
                return Math.round(scores.reduce((a,b)=>a+b,0) / scores.length);
             });
             if (trendData.length > 0) {
                cAvg = trendData[trendData.length - 1]; 
             }
          }

          return {
            ...c,
            enrolledCount: sCount,
            vacancy,
            capacity,
            fillRate,
            avgScore: cAvg,
            trendData
          };
        }).sort((a, b) => b.vacancy - a.vacancy) || [];
      }

      const totalEnrolls = Object.values(levelCounts).reduce((a, b) => a + b, 0);
      const levelProportion = Object.entries(levelCounts).map(([name, count]) => ({
        name, count, percent: totalEnrolls > 0 ? Math.round((count / totalEnrolls) * 100) : 0
      })).sort((a, b) => b.count - a.count);

      setInstStats({
        classesCount: classIds.length,
        totalStudents,
        hwSubmitRate,
        overallAvgScore,
        consultStatus,
        attendanceIssues,
        recentDropouts,
        levelProportion,
        classDataList
      });

    } catch (e: any) {
      console.error("강사 통계 로드 에러:", e);
    }
  };

  const handleSecretSave = async () => {
    if (!selectedInstId) return;
    setIsSavingSecret(true);
    try {
      const { error } = await supabase
        .from("instructor")
        .update({
          contract_type: secretForm.contract_type,
          performance_grade: secretForm.performance_grade,
          warning_count: secretForm.warning_count,
          admin_memo: secretForm.admin_memo
        })
        .eq("instructor_id", selectedInstId);

      if (error) throw error;
      
      alert("🔐 관리자 시크릿 노트가 안전하게 저장되었습니다.");
      setInstructors(prev => prev.map(i => i.instructor_id === selectedInstId ? { ...i, ...secretForm } : i));
      
    } catch (e: any) {
      alert("저장 실패: " + e.message);
    } finally {
      setIsSavingSecret(false);
    }
  };

  const Sparkline = ({ data }: { data: number[] }) => {
    if (!data || data.length === 0) return <div className="text-[10px] text-slate-400 font-bold w-16 h-8 flex items-center justify-center bg-slate-100 rounded border border-dashed border-slate-200">기록없음</div>;
    
    if (data.length === 1) {
      return (
        <svg width={80} height={30} className="overflow-visible">
          <circle cx={40} cy={15} r="2.5" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.5" />
        </svg>
      );
    }

    const maxVal = Math.max(...data, 100);
    const minVal = Math.max(0, Math.min(...data) - 10);
    const width = 80;
    const height = 30;
    
    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((d - minVal) / (maxVal - minVal)) * height;
      return `${x},${y}`;
    }).join(" ");

    return (
      <svg width={width} height={height} className="overflow-visible">
        <polyline fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
        {data.map((d, i) => {
          const x = (i / (data.length - 1)) * width;
          const y = height - ((d - minVal) / (maxVal - minVal)) * height;
          return <circle key={i} cx={x} cy={y} r="2.5" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.5" />;
        })}
      </svg>
    );
  };

  const ClassVacancyBadge = ({ vacancy }: { vacancy: number }) => {
    if (vacancy <= 0) return <span className="text-[9px] font-black text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded shadow-sm">마감</span>;
    if (vacancy <= 2) return <span className="text-[9px] font-black text-amber-500 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded shadow-sm">마감 임박</span>;
    return <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded shadow-sm">{vacancy}자리 여유</span>;
  };

  if (isAuthorized === null) return null; 

  const selectedInst = instructors.find(i => i.instructor_id === selectedInstId);
  const avatarUrl = selectedInst ? getProfileImageUrl(selectedInst.profile_image_url) : null;

  return (
    <div className="flex w-full h-full bg-slate-50 overflow-hidden font-pretendard">
      
      {/* 🌟 좌측 패널: 강사 리스트 */}
      <aside className="w-[320px] bg-white border-r border-slate-200 flex flex-col shrink-0 h-full z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        <div className="p-5 border-b border-slate-200 bg-slate-50/80 shrink-0">
          <h2 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
            👨‍🏫 강사 관리 (HR)
          </h2>
          <p className="text-[11px] font-bold text-slate-500 mt-1">소속 강사들의 퍼포먼스와 CRM 내역을 조회합니다.</p>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scroll p-3 space-y-1.5 bg-slate-50/30">
          {isLoading ? (
            <div className="text-center py-10 text-slate-400 font-bold text-xs">로딩 중...</div>
          ) : instructors.length === 0 ? (
            <div className="text-center py-10 text-slate-400 font-bold text-xs">조회된 강사가 없습니다.</div>
          ) : (
            instructors.map(inst => {
              const isActive = selectedInstId === inst.instructor_id;
              const hasWarning = inst.warning_count > 0;
              const instAvatar = getProfileImageUrl(inst.profile_image_url);

              return (
                <div 
                  key={inst.instructor_id} 
                  onClick={() => setSelectedInstId(inst.instructor_id)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col gap-2 ${isActive ? 'bg-[#002864] border-[#002864] shadow-md' : 'bg-white border-slate-200 hover:border-slate-400 hover:shadow-sm'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`relative w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 border-2 overflow-hidden ${isActive ? 'bg-white/10 text-white border-white/20' : 'bg-slate-100 text-[#002864] border-slate-200'}`}>
                      <span className="absolute z-0">{inst.name.substring(1)}</span>
                      {instAvatar && <img src={instAvatar} alt="profile" className="absolute inset-0 w-full h-full object-cover z-10" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[14px] font-extrabold truncate ${isActive ? 'text-white' : 'text-slate-800'}`}>{inst.name}</span>
                        <span className={`text-[9px] font-black px-1.5 py-[1px] rounded ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                          {inst.position || '강사'}
                        </span>
                      </div>
                      <div className={`text-[11px] font-medium truncate mt-0.5 ${isActive ? 'text-blue-200' : 'text-slate-400'}`}>
                        {inst.phone || '연락처 미등록'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1.5 pl-1">
                    {hasWarning && <span className="bg-rose-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm">경고 누적</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* 🌟 우측 패널: 강사 상세 대시보드 */}
      <main className="flex-1 flex flex-col h-full bg-slate-50 relative overflow-y-auto custom-scroll p-6 lg:p-8">
        
        {!selectedInst ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 font-bold text-sm">
            좌측에서 관리할 강사를 선택해주세요.
          </div>
        ) : (
          <div className="max-w-[1200px] w-full mx-auto flex flex-col gap-6 pb-20">
            
            {/* 프로필 헤더 */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex justify-between items-center relative overflow-hidden shrink-0">
              <div className="absolute top-0 right-0 w-64 h-full bg-gradient-to-l from-indigo-50/50 to-transparent"></div>
              
              <div className="flex items-center gap-6 relative z-10">
                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" />
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="relative w-24 h-24 bg-gradient-to-br from-[#002864] to-[#1e3a8a] text-white rounded-full flex items-center justify-center text-3xl font-extrabold shadow-lg shrink-0 overflow-hidden cursor-pointer group border-4 border-white ring-1 ring-slate-200"
                  title="클릭하여 프로필 이미지 강제 변경"
                >
                  <span className="absolute z-0">{selectedInst.name.substring(1, 3)}</span>
                  {avatarUrl && <img src={avatarUrl} alt="profile" className="absolute inset-0 w-full h-full object-cover z-10" />}
                  <div className="absolute inset-0 bg-black/50 hidden group-hover:flex flex-col items-center justify-center z-20 transition-opacity">
                    <span className="text-white text-[10px] font-bold mt-1">{isUploading ? '업로드중' : '사진 변경'}</span>
                  </div>
                </div>
                <div>
                  <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                    {selectedInst.name} 선생님
                    <span className="bg-slate-100 text-slate-600 border border-slate-200 text-[11px] px-2 py-0.5 rounded-md font-bold shadow-sm">{selectedInst.position || '직급 미지정'}</span>
                  </h1>
                  <p className="text-[13px] font-bold text-slate-500 mt-1.5 flex items-center gap-3">
                    <span>📧 {selectedInst.email || "이메일 미등록"}</span>
                    <span className="text-slate-300">|</span>
                    <span>📱 {selectedInst.phone || "연락처 미등록"}</span>
                  </p>
                </div>
              </div>

              <div className="relative z-10 flex gap-2">
                <button onClick={() => router.push('/permission')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[12px] rounded-xl transition-colors border border-slate-300 shadow-sm flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                  권한 제어
                </button>
              </div>
            </div>

            {!instStats ? (
              <div className="py-20 text-center text-slate-400 font-bold text-sm animate-pulse">지표 데이터를 분석 중입니다...</div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between group hover:border-[#002864] transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">운영 지표</span>
                      <span className="text-lg">👨‍🎓</span>
                    </div>
                    <div>
                      <div className="flex items-end gap-1.5 mb-1">
                        <span className="text-3xl font-black text-slate-800 tracking-tighter">{instStats.totalStudents}</span>
                        <span className="text-xs font-bold text-slate-500 mb-1">명 수강중</span>
                      </div>
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${instStats.recentDropouts > 0 ? 'text-rose-600 bg-rose-50 border-rose-200' : 'text-slate-500 bg-slate-50 border-slate-200'}`}>
                          최근 1달 퇴원: {instStats.recentDropouts}명
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-rose-100 shadow-sm flex flex-col justify-between hover:border-rose-300 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[11px] font-black text-rose-400 uppercase tracking-wider">최근 7일 반 출결 이슈</span>
                      <span className="text-lg">🚨</span>
                    </div>
                    <div>
                      <div className="flex items-end gap-1.5 mb-1">
                        <span className="text-3xl font-black text-rose-600 tracking-tighter">{instStats.attendanceIssues.absent + instStats.attendanceIssues.late}</span>
                        <span className="text-xs font-bold text-slate-500 mb-1">건 발생</span>
                      </div>
                      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100">
                        <span className="text-[10px] font-black text-rose-500">결석 {instStats.attendanceIssues.absent}건</span>
                        <span className="text-[10px] font-black text-amber-500">지각 {instStats.attendanceIssues.late}건</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between group hover:border-blue-400 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">학습 지표</span>
                      <span className="text-lg">📝</span>
                    </div>
                    <div>
                      <div className="flex items-end gap-1.5 mb-1">
                        <span className="text-3xl font-black text-slate-800 tracking-tighter">{instStats.overallAvgScore}</span>
                        <span className="text-xs font-bold text-slate-500 mb-1">점 (평균)</span>
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                        <span className="text-[10px] font-bold text-slate-500">과제 제출률</span>
                        <span className={`text-[11px] font-black ${instStats.hwSubmitRate < 70 ? 'text-rose-500' : 'text-blue-600'}`}>{instStats.hwSubmitRate}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between group hover:border-amber-400 transition-colors">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">상담 신호등</span>
                      <span className="text-lg">🚦</span>
                    </div>
                    <div className="flex items-end justify-between">
                      <div className="flex flex-col items-center gap-1.5">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black shadow-inner ${instStats.consultStatus.green > 0 ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-slate-200 text-slate-400'}`}>{instStats.consultStatus.green}</div>
                        <span className="text-[8px] font-bold text-slate-400">양호</span>
                      </div>
                      <div className="flex flex-col items-center gap-1.5">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black shadow-inner ${instStats.consultStatus.yellow > 0 ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'bg-slate-200 text-slate-400'}`}>{instStats.consultStatus.yellow}</div>
                        <span className="text-[8px] font-bold text-slate-400">주의</span>
                      </div>
                      <div className="flex flex-col items-center gap-1.5">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black shadow-inner ${instStats.consultStatus.red > 0 ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.6)] animate-pulse' : 'bg-slate-200 text-slate-400'}`}>{instStats.consultStatus.red}</div>
                        <span className="text-[8px] font-bold text-slate-400">위험/누락</span>
                      </div>
                    </div>
                  </div>

                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                    <h3 className="text-[13px] font-black text-slate-700 mb-4 flex items-center gap-2">📊 레벨별 수강 비중</h3>
                    <div className="flex-1 flex flex-col justify-center gap-3">
                      {instStats.levelProportion.length === 0 ? <span className="text-xs text-slate-400">데이터 없음</span> : 
                        instStats.levelProportion.map((l: any, idx: number) => {
                          const colors = ['bg-[#002864]', 'bg-blue-500', 'bg-sky-400', 'bg-emerald-400', 'bg-amber-400'];
                          const color = colors[idx % colors.length];
                          return (
                            <div key={l.name} className="flex items-center gap-3">
                              <span className="w-16 text-[11px] font-bold text-slate-600 truncate text-right">{l.name}</span>
                              <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full ${color} rounded-full`} style={{ width: `${l.percent}%` }}></div>
                              </div>
                              <span className="w-12 text-[10px] font-black text-slate-500 text-right">{l.percent}% ({l.count}명)</span>
                            </div>
                          )
                        })
                      }
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-[13px] font-black text-slate-700 flex items-center gap-2">🪑 수강반 결원 모니터링</h3>
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold border border-slate-200">정원 대비 등록 현황</span>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scroll pr-1 space-y-3 max-h-[140px]">
                      {instStats.classDataList.length === 0 ? <span className="text-xs text-slate-400">담당 반이 없습니다.</span> : 
                        instStats.classDataList.map((c: any) => {
                          const isFull = c.enrolledCount >= c.capacity;
                          const barColor = isFull ? 'bg-rose-500' : 'bg-emerald-500';
                          return (
                            <div key={c.class_id} className="flex flex-col gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-100 hover:border-blue-200 transition-colors">
                              <div className="flex justify-between items-end">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-[12px] font-bold text-[#002864] truncate max-w-[120px]" title={c.name}>{c.name}</span>
                                  <span className="text-[9px] text-slate-400 bg-white px-1 border border-slate-200 rounded truncate">{c.level_name}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <ClassVacancyBadge vacancy={c.vacancy} />
                                  <span className={`text-[10px] font-black ${isFull ? 'text-rose-500' : 'text-emerald-600'}`}>{c.enrolledCount} <span className="text-slate-400 font-medium">/ {c.capacity}</span></span>
                                </div>
                              </div>
                              <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden flex">
                                <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${c.fillRate}%` }}></div>
                              </div>
                            </div>
                          )
                        })
                      }
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 text-sm">📋 담당 반 상세 정보 및 성적 추이</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse whitespace-nowrap">
                      <thead className="bg-white border-b border-slate-200 text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
                        <tr>
                          <th className="py-3 px-5">반 이름 (레벨)</th>
                          <th className="py-3 px-5 text-center">정원/현원</th>
                          <th className="py-3 px-5 text-center">최근 평균 성적</th>
                          <th className="py-3 px-5">성적 흐름 (최근 5회)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-[13px] font-bold text-slate-700">
                        {instStats.classDataList.length === 0 ? (
                          <tr><td colSpan={4} className="py-10 text-center text-slate-400">데이터가 없습니다.</td></tr>
                        ) : (
                          instStats.classDataList.map((c: any) => (
                            <tr key={c.class_id} className="hover:bg-slate-50 transition-colors">
                              <td className="py-3 px-5">
                                <div className="text-[#002864] font-black">{c.name}</div>
                                <div className="text-[10px] text-slate-400 font-medium">{c.level_name}</div>
                              </td>
                              <td className="py-3 px-5 text-center text-slate-600">{c.enrolledCount}명 <span className="text-slate-300 mx-1">/</span> {c.capacity}명</td>
                              <td className="py-3 px-5 text-center text-[#002864] text-[15px] font-black">{c.avgScore > 0 ? `${c.avgScore}점` : '-'}</td>
                              <td className="py-3 px-5">
                                <div className="bg-slate-50 rounded-lg border border-slate-200 p-1.5 inline-block">
                                  <Sparkline data={c.trendData} />
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-slate-800 rounded-3xl border border-slate-700 shadow-xl overflow-hidden mt-2 relative min-h-[300px] flex flex-col">
                  <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, #ffffff 10px, #ffffff 20px)' }}></div>
                  
                  <div className="relative z-10 px-6 py-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center shrink-0">
                    <h2 className="text-[15px] font-black text-amber-400 flex items-center gap-2 tracking-tight">
                      <span>🕵️‍♂️</span> HR 시크릿 노트 (관리자 전용)
                    </h2>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-800 px-2 py-1 rounded-md border border-slate-700">본인 열람 불가</span>
                  </div>

                  {!isSecretVisible && (
                    <div className="absolute inset-0 top-[60px] z-20 backdrop-blur-xl bg-slate-900/60 flex flex-col items-center justify-center">
                      <div className="text-4xl mb-4">🔒</div>
                      <p className="text-slate-300 font-bold text-sm mb-6">원장 및 인사권자만 열람할 수 있는 민감한 데이터입니다.</p>
                      <button onClick={() => setIsSecretVisible(true)} className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-amber-950 font-black text-[13px] rounded-xl transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                        내용 열람하기
                      </button>
                    </div>
                  )}

                  <div className={`relative z-10 p-6 grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 transition-opacity duration-500 ${isSecretVisible ? 'opacity-100' : 'opacity-10 pointer-events-none blur-sm'}`}>
                    
                    <div className="col-span-1 flex flex-col gap-4">
                      <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-1.5 uppercase tracking-wider">계약 / 급여 형태</label>
                        <select 
                          value={secretForm.contract_type} 
                          onChange={(e) => setSecretForm({...secretForm, contract_type: e.target.value})}
                          className="w-full bg-slate-900 border border-slate-600 text-slate-200 font-bold text-[13px] rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 transition-colors appearance-none"
                        >
                          <option value="">형태 선택 (미입력)</option>
                          <option value="비율제(비전임)">비율제 (파트/비전임)</option>
                          <option value="비율제(전임)">비율제 (전임)</option>
                          <option value="기본급+인센티브">기본급 + 인센티브</option>
                          <option value="100% 기본급">100% 기본급 (고정)</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[11px] font-black text-slate-400 mb-1.5 uppercase tracking-wider">내부 평가 등급</label>
                          <select 
                            value={secretForm.performance_grade} 
                            onChange={(e) => setSecretForm({...secretForm, performance_grade: e.target.value})}
                            className="w-full bg-slate-900 border border-slate-600 text-amber-400 font-black text-[14px] rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 transition-colors text-center appearance-none"
                          >
                            <option value="">-</option>
                            <option value="S">S 등급</option>
                            <option value="A">A 등급</option>
                            <option value="B">B 등급</option>
                            <option value="C">C 등급 (주의)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-black text-slate-400 mb-1.5 uppercase tracking-wider text-center">경고 누적 횟수</label>
                          <div className="flex items-center bg-slate-900 border border-slate-600 rounded-xl overflow-hidden h-[42px]">
                            <button onClick={() => setSecretForm(p => ({...p, warning_count: Math.max(0, p.warning_count - 1)}))} className="w-8 h-full bg-slate-800 text-slate-400 hover:text-white font-bold transition-colors">-</button>
                            <input type="text" readOnly value={secretForm.warning_count} className="flex-1 w-full bg-transparent text-center font-black text-rose-400 text-[14px] outline-none" />
                            <button onClick={() => setSecretForm(p => ({...p, warning_count: p.warning_count + 1}))} className="w-8 h-full bg-slate-800 text-slate-400 hover:text-rose-400 font-bold transition-colors">+</button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="col-span-1 md:col-span-2 flex flex-col min-h-0">
                      <label className="block text-[11px] font-black text-slate-400 mb-1.5 uppercase tracking-wider">특이사항 및 면담 기록</label>
                      <textarea 
                        value={secretForm.admin_memo} 
                        onChange={(e) => setSecretForm({...secretForm, admin_memo: e.target.value})}
                        placeholder="이곳에 작성된 메모는 강사 본인에게 절대 노출되지 않습니다. 원장 및 최고관리자만 열람할 수 있습니다."
                        className="flex-1 w-full bg-slate-900 border border-slate-600 text-slate-300 font-medium text-[13px] rounded-xl p-4 focus:outline-none focus:border-amber-400 transition-colors resize-none custom-scroll placeholder:text-slate-600 min-h-[120px]"
                      ></textarea>
                    </div>

                  </div>

                  <div className={`relative z-10 px-6 py-4 border-t border-slate-700 bg-slate-900/80 flex justify-end gap-3 transition-opacity duration-500 ${isSecretVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <button 
                      onClick={() => setIsSecretVisible(false)} 
                      className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-[13px] rounded-xl transition-colors"
                    >
                      다시 숨기기
                    </button>
                    <button 
                      onClick={handleSecretSave} 
                      disabled={isSavingSecret}
                      className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-amber-950 font-black text-[13px] rounded-xl transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)] hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] disabled:opacity-50"
                    >
                      {isSavingSecret ? "저장 중..." : "시크릿 노트 저장하기"}
                    </button>
                  </div>
                </div>

              </>
            )}
          </div>
        )}
      </main>

    </div>
  );
}