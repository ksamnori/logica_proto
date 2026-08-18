// src/app/(dashboard)/factory-dashboard/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// 무한 로딩 헬퍼 (집계용으로 메타데이터만 초고속 호출)
const fetchAllRows = async (tableName: string, selectQuery: string = '*') => {
  let allData: any[] = [];
  let start = 0;
  const step = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase.from(tableName).select(selectQuery).range(start, start + step - 1);
    if (error) break;
    if (data && data.length > 0) { allData = [...allData, ...data]; start += step; }
    if (!data || data.length < step) hasMore = false; 
  }
  return allData;
};

export default function FactoryDashboardPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [stats, setStats] = useState({
    totalQuestions: 0,
    totalBooks: 0,
    recentUploads: 0,
    difficulty: { '최상': 0, '상': 0, '중': 0, '하': 0, '최하': 0, '미지정': 0 },
    schoolLevel: { '초등': 0, '중등': 0, '고등': 0, '분류필요': 0 }
  });

  useEffect(() => {
    const checkAccess = () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER' || 
                        pos.includes('최고관리자') || pos.includes('원장') || 
                        pos.includes('부원장') || pos.includes('실장') || pos.includes('전임강사');
      if (isGodMode) setIsAuthorized(true);
      else { alert("⛔ 권한이 없습니다."); router.replace("/home"); }
    };
    checkAccess();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) loadDashboardData();
  }, [isAuthorized]);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      // 1. 교재 수 집계
      const { count: bookCount } = await supabase.from('textbook').select('*', { count: 'exact', head: true });
      
      // 2. 카테고리 정보 로드 (학교급 판별용)
      const categories = await fetchAllRows('master_category', 'category_id, depth1');
      const items = await fetchAllRows('master_item', 'item_id, category_id');
      
      const catMap = new Map();
      categories.forEach((c: any) => catMap.set(c.category_id, c.depth1));
      items.forEach((i: any) => catMap.set(i.item_id, catMap.get(i.category_id)));

      // 3. 문제은행 전체 메타데이터 로드 (텍스트 제외하여 속도 최적화)
      const qData = await fetchAllRows('question_db', 'question_id, difficulty, taxonomy_id, created_at, is_hidden');
      
      const validQs = qData.filter(q => q.is_hidden !== true && q.is_hidden !== 'Y');
      const totalQ = validQs.length;

      let recent = 0;
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const diffCount = { '최상': 0, '상': 0, '중': 0, '하': 0, '최하': 0, '미지정': 0 };
      const schoolCount = { '초등': 0, '중등': 0, '고등': 0, '분류필요': 0 };

      validQs.forEach(q => {
        // 최근 7일 업로드 확인
        if (new Date(q.created_at) >= sevenDaysAgo) recent++;

        // 난이도 집계
        const diff = (q.difficulty || '').trim();
        if (['최상', '상', '중', '하', '최하'].includes(diff)) {
          diffCount[diff as keyof typeof diffCount]++;
        } else {
          diffCount['미지정']++;
        }

        // 학교급 집계
        const taxId = q.taxonomy_id;
        const depth1Str = catMap.get(taxId) || '';
        
        if (depth1Str.includes('초등') || (taxId && taxId.startsWith('E'))) schoolCount['초등']++;
        else if (depth1Str.includes('중등') || depth1Str.includes('중학') || (taxId && taxId.startsWith('M'))) schoolCount['중등']++;
        else if (depth1Str.includes('고등') || (taxId && taxId.startsWith('H'))) schoolCount['고등']++;
        else schoolCount['분류필요']++;
      });

      setStats({
        totalQuestions: totalQ,
        totalBooks: bookCount || 0,
        recentUploads: recent,
        difficulty: diffCount,
        schoolLevel: schoolCount
      });

    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const ProgressBar = ({ label, count, total, colorClass }: { label: string, count: number, total: number, colorClass: string }) => {
    const percent = total > 0 ? Math.round((count / total) * 100) : 0;
    return (
      <div className="mb-5">
        <div className="flex justify-between text-[13px] font-bold text-slate-600 mb-1.5">
          <span>{label}</span>
          <span>{count.toLocaleString()}제 ({percent}%)</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden shadow-inner border border-slate-200">
          <div className={`h-full rounded-full transition-all duration-1000 ${colorClass}`} style={{ width: `${percent}%` }}></div>
        </div>
      </div>
    );
  };

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden custom-scroll">
      
      <div className="bg-slate-900 rounded-2xl p-8 shadow-lg flex flex-col md:flex-row justify-between items-center mb-6 shrink-0 gap-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-white opacity-5 rounded-full blur-2xl"></div>
        <div className="relative z-10">
          <h1 className="text-3xl font-black text-white flex items-center gap-3">
            <span>📊</span> 마스터 DB 컨트롤 타워
            <span className="text-xs font-bold text-slate-900 bg-emerald-400 px-2.5 py-1 rounded shadow-sm tracking-widest uppercase">Live Status</span>
          </h1>
          <p className="text-sm font-bold text-slate-400 mt-2">학원에 적재된 모든 문제은행 자산의 통계를 실시간으로 분석합니다.</p>
        </div>
        <button onClick={loadDashboardData} disabled={isLoading} className="relative z-10 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl border border-white/20 transition-colors flex items-center gap-2">
          {isLoading ? "데이터 분석 중..." : "🔄 실시간 새로고침"}
        </button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold gap-3">
          <span className="text-4xl animate-spin">⏳</span>
          <p>데이터베이스의 수만 개 문항을 전수조사하고 있습니다...</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scroll pb-10">
          
          {/* Top Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center text-2xl mb-3 shadow-sm">📚</div>
              <p className="text-sm font-bold text-slate-500 mb-1">시스템에 등록된 전체 교재</p>
              <h3 className="text-3xl font-black text-slate-800">{stats.totalBooks.toLocaleString()} <span className="text-lg text-slate-400">권</span></h3>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center text-2xl mb-3 shadow-sm">🧠</div>
              <p className="text-sm font-bold text-slate-500 mb-1">마스터 문제은행 누적 문항</p>
              <h3 className="text-3xl font-black text-indigo-700">{stats.totalQuestions.toLocaleString()} <span className="text-lg text-indigo-400">제</span></h3>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center text-2xl mb-3 shadow-sm">🔥</div>
              <p className="text-sm font-bold text-slate-500 mb-1">최근 7일간 새로 추가된 문항</p>
              <h3 className="text-3xl font-black text-rose-600">+{stats.recentUploads.toLocaleString()} <span className="text-lg text-rose-400">제</span></h3>
            </div>
          </div>

          {/* Middle Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* 학교급별 분포 */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-lg font-extrabold text-slate-800 mb-6 flex items-center gap-2">
                <span>🏫</span> 학교급별 문항 적재 현황
              </h3>
              <div>
                <ProgressBar label="초등부 문항" count={stats.schoolLevel['초등']} total={stats.totalQuestions} colorClass="bg-amber-400" />
                <ProgressBar label="중등부 문항" count={stats.schoolLevel['중등']} total={stats.totalQuestions} colorClass="bg-emerald-500" />
                <ProgressBar label="고등부 문항" count={stats.schoolLevel['고등']} total={stats.totalQuestions} colorClass="bg-blue-600" />
                
                <div className="mt-8 pt-6 border-t border-slate-100">
                  <div className="flex justify-between items-center p-4 bg-rose-50 rounded-xl border border-rose-100">
                    <div>
                      <h4 className="text-sm font-bold text-rose-800">⚠️ 분류 작업이 필요한 문항</h4>
                      <p className="text-[11px] font-medium text-rose-600 mt-1">Taxonomy 분류 체계가 매핑되지 않은 고아 문항들입니다.</p>
                    </div>
                    <div className="text-xl font-black text-rose-600">{stats.schoolLevel['분류필요'].toLocaleString()}제</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 난이도 분포 */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-lg font-extrabold text-slate-800 mb-6 flex items-center gap-2">
                <span>📈</span> 문항 난이도 분포도
              </h3>
              <div>
                <ProgressBar label="최상 (킬러 문항)" count={stats.difficulty['최상']} total={stats.totalQuestions} colorClass="bg-fuchsia-600" />
                <ProgressBar label="상 (심화 문항)" count={stats.difficulty['상']} total={stats.totalQuestions} colorClass="bg-rose-500" />
                <ProgressBar label="중 (응용 문항)" count={stats.difficulty['중']} total={stats.totalQuestions} colorClass="bg-indigo-500" />
                <ProgressBar label="하 (기본 문항)" count={stats.difficulty['하']} total={stats.totalQuestions} colorClass="bg-sky-400" />
                <ProgressBar label="최하 (연산/기초)" count={stats.difficulty['최하']} total={stats.totalQuestions} colorClass="bg-slate-400" />
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}