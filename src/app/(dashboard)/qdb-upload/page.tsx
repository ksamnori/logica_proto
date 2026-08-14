// src/app/(dashboard)/qdb-upload/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function QuestionDBUploadPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [fileData, setFileData] = useState<any[] | null>(null);
  const [fileName, setFileName] = useState("");
  
  // 🌟 교재 이름 강제 지정 상태
  const [bookTitle, setBookTitle] = useState("초등로지카 MAX 6-1 1단원_1교_디수정");
  
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLogs, setUploadLogs] = useState<string[]>([]);

  useEffect(() => {
    const checkAccess = () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || pos.includes('최고관리자') || pos.includes('원장');
      if (isGodMode) {
        setIsAuthorized(true);
      } else {
        alert("⛔ 마스터 DB 업로드 툴은 원장 및 최고관리자 전용입니다.");
        router.replace("/home");
      }
    };
    checkAccess();
  }, [router]);

  const addLog = (msg: string) => {
    setUploadLogs(prev => [...prev, msg]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setUploadLogs([]);

    // 파일명에 따라 기본 교재명 세팅
    if (file.name.includes("워크북")) {
      setBookTitle("초등로지카 MAX 6-1 1단원 워크북_1교_디수정");
    } else {
      setBookTitle("초등로지카 MAX 6-1 1단원_1교_디수정");
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          setFileData(json);
          addLog(`✅ 파일 로드 성공: 총 ${json.length}개의 문항 데이터 감지.`);
        } else {
          alert("유효하지 않은 JSON 형식입니다. 배열 형태여야 합니다.");
        }
      } catch (err) {
        alert("JSON 파일 파싱 중 오류가 발생했습니다.");
      }
    };
    reader.readAsText(file);
  };

  // DB의 CHECK 제약조건 충돌 방지를 위한 난이도 필터
  const mapDifficulty = (diff: string | null) => {
    if (!diff) return null;
    const cleanDiff = diff.trim();
    if (cleanDiff === '중상') return '상';
    if (cleanDiff === '중하') return '중';
    
    const allowed = ['최상', '상', '중', '하', '최하'];
    return allowed.includes(cleanDiff) ? cleanDiff : null;
  };

  const processUpload = async () => {
    if (!fileData || fileData.length === 0) return alert("업로드할 데이터가 없습니다.");
    
    // 교재명 입력 확인
    const finalBookName = bookTitle.trim();
    if (!finalBookName) return alert("교재 이름을 입력해주세요.");

    setIsUploading(true);
    setUploadProgress(5);
    addLog(`🚀 마스터 DB(question_db) 스마트 업로드 시작...`);

    try {
      // 1. JSON 파일 안의 question_id 목록 추출
      const incomingIds = fileData.map(q => q.question_id).filter(Boolean);
      
      // 2. DB에 이미 존재하는 question_id 가져오기 (비교용)
      const { data: existingQs, error: fetchErr } = await supabase
        .from('question_db')
        .select('question_id')
        .in('question_id', incomingIds);
        
      if (fetchErr) throw new Error("기존 데이터 확인 중 오류 발생");

      const existingIdSet = new Set(existingQs?.map(q => q.question_id) || []);
      addLog(`✅ 기존 등록된 마스터 문항 ${existingIdSet.size}개 감지됨.`);

      // 3. 업데이트할 녀석과 새로 추가할 녀석을 분리
      const toInsert: any[] = [];
      const toUpdate: any[] = [];

      fileData.forEach((q) => {
        const payload = {
          question_id: q.question_id,
          item_id: q.item_id || null,
          parent_question_id: q.parent_question_id || null,
          pdf_source: q.pdf_source || null,
          detected_page_num: typeof q.detected_page_num === 'number' ? q.detected_page_num : null,
          final_printed_page: q.final_printed_page ? String(q.final_printed_page) : null,
          question_number: q.question_number ? String(q.question_number) : null,
          sub_num: typeof q.sub_num === 'number' ? q.sub_num : 0,
          problem_type: q.problem_type || null,
          difficulty: mapDifficulty(q.difficulty), 
          solving_probability: typeof q.solving_probability === 'number' ? q.solving_probability : null,
          question: q.question || "",
          options: q.options || null,
          answer: q.answer || null,
          step_1_concept: q.step_1_concept || null,
          step_2_approach: q.step_2_approach || null,
          step_3_process: q.step_3_process || null,
          step_4_conclusion: q.step_4_conclusion || null,
          image_box: q.image_box || null,
          image_url: q.image_url || null,
          image_type: q.image_type || null,
          is_new_trend: q.is_new_trend || false,
          ai_status: q.ai_status || '대기',
          exposure_tier: q.exposure_tier || 'PUBLIC',
          curriculum_type: q.curriculum_type || 'COMMON',
          related_question_ids: q.related_question_ids || null,
          classification_status: q.classification_status || 'PENDING',
          engine_ver: q.engine_ver || null,
          derivation_type: q.derivation_type || null,
          group_id: q.group_id || null,
          taxonomy_id: q.taxonomy_id || null,
          taxonomy_name: q.taxonomy_name || null,
          cognitive_level: q.cognitive_level || null,
          verification_status: q.verification_status || 'PENDING',
          is_human_verified: q.human_verified === true || q.is_human_verified === true,
          answer_image_box: q.answer_image_box || null,
          answer_image_url: q.answer_image_url || null,
          answer_image_type: q.answer_image_type || null,
          thk_taxonomy_id: q.thk_taxonomy_id || null,
          thk_taxonomy_name: q.thk_taxonomy_name || null,
          is_hidden: q.is_hidden || false,
          parent_relations: q.parent_relations || null,
          raw_source_tags: q.raw_source_tags || q.source_tag || null,
          explanation: q.explanation || null,
          solution: q.solution || null,
          image_2_box: q.image_2_box || null,
          image_2_url: q.image_2_url || null,
          image_2_type: q.image_2_type || null,
          
          // 🌟 입력한 교재명 강제 주입
          book_name: finalBookName || q.book_name || null,
          source_book_name: finalBookName || q.source_book_name || q.book_name || null,
          
          updated_at: new Date().toISOString()
        };

        if (existingIdSet.has(q.question_id)) {
          toUpdate.push(payload);
        } else {
          toInsert.push(payload);
        }
      });

      let processedCount = 0;
      const totalCount = toUpdate.length + toInsert.length;

      // 4. 🔄 기존 문항 덮어쓰기 (Update)
      if (toUpdate.length > 0) {
        addLog(`🔄 기존 문항 덮어쓰기(Update) ${toUpdate.length}개 진행 중...`);
        const updateChunkSize = 50;
        for (let i = 0; i < toUpdate.length; i += updateChunkSize) {
          const chunk = toUpdate.slice(i, i + updateChunkSize);
          await Promise.all(chunk.map(async (item) => {
            const { question_id, ...updateData } = item;
            await supabase.from('question_db').update(updateData).eq('question_id', question_id);
          }));
          processedCount += chunk.length;
          setUploadProgress(5 + Math.round((processedCount / totalCount) * 90));
        }
      }

      // 5. ➕ 새 문항 이어붙이기 (Insert)
      if (toInsert.length > 0) {
        addLog(`➕ 신규 문항 이어붙이기(Insert) ${toInsert.length}개 진행 중...`);
        const insertChunkSize = 100;
        for (let i = 0; i < toInsert.length; i += insertChunkSize) {
          const chunk = toInsert.slice(i, i + insertChunkSize);
          const { error: insertErr } = await supabase.from('question_db').insert(chunk);
          if (insertErr) throw new Error(`문항 이어붙이기 오류: ${insertErr.message}`);
          
          processedCount += chunk.length;
          setUploadProgress(5 + Math.round((processedCount / totalCount) * 90));
        }
      }

      addLog(`🎉 마스터 DB 업로드 최종 완료!`);
      alert(`✅ 마스터 문제은행 처리가 완료되었습니다!\n새로 추가됨: ${toInsert.length}개\n기존 덮어쓰기됨: ${toUpdate.length}개\n적용된 교재명: ${finalBookName}`);

      setFileData(null);
      setFileName("");
      const fileInput = document.getElementById('jsonFileInput') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
      addLog(`❌ 업로드 실패: ${errorMessage}`);
      alert(`업로드 실패:\n${errorMessage}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden items-center">
      
      <div className="w-full max-w-3xl bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col mt-10 overflow-hidden">
        
        {/* 헤더 */}
        <div className="bg-slate-800 p-6 text-white shrink-0">
          <h1 className="text-2xl font-black flex items-center gap-2">
            <span>🗄️</span> 마스터 문제은행 (question_db) 스마트 업로드
          </h1>
          <p className="text-slate-300 text-sm mt-2 font-medium">
            AI로 파싱된 원본 문제 JSON 파일을 마스터 DB에 추가합니다. 기존 데이터는 덮어쓰고, 새로운 데이터는 이어붙입니다.
          </p>
        </div>

        {/* 폼 영역 */}
        <div className="p-8 space-y-6 flex-1 overflow-y-auto custom-scroll">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <h3 className="text-blue-800 font-bold text-sm mb-1">💡 스마트 이어붙이기 작동 안내</h3>
            <ul className="text-xs text-blue-700 list-disc list-inside ml-4 space-y-1">
              <li>이곳에 등록된 <code>question_id</code>가 있어야만 교재 뼈대(textbook_question)에 등록이 가능합니다.</li>
              <li>만약 마스터 DB에 이미 있는 문제(UUID 동일)라면 기존 정보는 <b>새로운 내용으로 덮어씁니다(Update).</b></li>
              <li>마스터 DB에 없는 새로운 문제라면 맨 뒤에 <b>이어서 추가합니다(Insert).</b></li>
            </ul>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">1. 문제 데이터 JSON 파일 선택</label>
            <div className="flex items-center gap-3">
              <label className="cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2.5 rounded-xl border border-slate-300 transition-colors font-bold shadow-sm flex-shrink-0">
                파일 찾기...
                <input id="jsonFileInput" type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
              </label>
              <div className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-500 truncate">
                {fileName ? <span className="text-indigo-600 font-bold">{fileName} ({fileData?.length}문항 감지됨)</span> : "선택된 파일이 없습니다."}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <label className="block text-sm font-bold text-slate-700 mb-2">2. 강제 지정할 교재 이름 (book_name)</label>
            <input 
              type="text" 
              value={bookTitle} 
              onChange={(e) => setBookTitle(e.target.value)} 
              placeholder="예: 초등로지카 MAX 6-1 1단원"
              className="w-full px-4 py-3 rounded-xl border border-slate-300 font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm" 
            />
            <p className="text-xs text-slate-500 mt-1.5 ml-1">※ 입력한 교재명이 JSON의 기존 정보를 덮어쓰고 모든 문제에 일괄 적용됩니다.</p>
          </div>

          {/* 터미널 느낌의 로그 창 */}
          <div className="bg-slate-900 rounded-xl p-4 h-48 overflow-y-auto custom-scroll font-mono text-xs text-emerald-400">
            {uploadLogs.length === 0 ? (
              <span className="text-slate-600">대기 중... JSON 파일을 로드해주세요.</span>
            ) : (
              uploadLogs.map((log, i) => (
                <div key={i} className="mb-1">{`> ${log}`}</div>
              ))
            )}
          </div>
        </div>

        {/* 하단 버튼 및 진행바 */}
        <div className="p-6 bg-slate-50 border-t border-slate-200 shrink-0">
          {isUploading && (
            <div className="mb-4">
              <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                <span>데이터 베이스 동기화 중...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                <div className="bg-slate-700 h-2.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            </div>
          )}
          
          <button 
            onClick={processUpload} 
            disabled={!fileData || isUploading}
            className={`w-full py-4 rounded-xl font-black text-lg transition-all shadow-md flex items-center justify-center gap-2
              ${!fileData ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 
                isUploading ? 'bg-slate-400 text-white cursor-wait' : 'bg-slate-800 hover:bg-slate-950 text-white active:scale-[0.98]'}`}
          >
            {isUploading ? "데이터 동기화 진행 중..." : "🗄️ 문제은행 마스터 DB (question_db) 일괄 등록 실행"}
          </button>
        </div>

      </div>
    </div>
  );
}