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
  
  // 🌟 교재 이름 상태 (기본값은 비워두고 파일 업로드 시 자동 채움)
  const [bookTitle, setBookTitle] = useState("");
  
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLogs, setUploadLogs] = useState<string[]>([]);
  
  // 🌟 드래그 앤 드롭 상태 관리
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      if (!role || !tId) {
        alert("로그인 정보가 없습니다.");
        router.replace("/home");
        return;
      }

      // SUPER_ADMIN은 무조건 통과
      if (role === 'SUPER_ADMIN') {
        setIsAuthorized(true);
        return;
      }

      // DB에서 현재 직급의 권한 조회
      const { data, error } = await supabase
        .from('tenant_role_permissions')
        .select('allowed_menus')
        .eq('tenant_id', tId)
        .eq('role_name', role)
        .single();

      if (!error && data && data.allowed_menus.includes("/qdb-upload")) {
        setIsAuthorized(true);
      } else {
        alert("⛔ 마스터 DB 업로드 툴 접근 권한이 없습니다. 권한 관리 페이지에서 허용해주세요.");
        router.replace("/home");
      }
    };
    checkAccess();
  }, [router]);

  const addLog = (msg: string) => {
    setUploadLogs(prev => [...prev, msg]);
  };

  // 🌟 공통 파일 처리 로직 (드래그 앤 드롭과 클릭 업로드 모두 사용)
  const processFile = (file: File) => {
    setFileName(file.name);
    setUploadLogs([]);

    // 🌟 [핵심] 파일명에서 쓸데없는 꼬리표 자르고 순수 교재명 자동 추출
    let cleanName = file.name.replace(/\.json$/i, ''); // 1. 확장자 제거
    cleanName = cleanName.split('_Problems')[0]; // 2. _Problems... 뒷부분 전부 제거
    setBookTitle(cleanName); // 3. 입력창에 강제 세팅

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          setFileData(json);
          addLog(`✅ 파일 로드 성공: 총 ${json.length}개의 문항 데이터 감지.`);
          addLog(`💡 추출된 기본 교재명: [${cleanName}]`);
        } else {
          alert("유효하지 않은 JSON 형식입니다. 배열 형태여야 합니다.");
        }
      } catch (err) {
        alert("JSON 파일 파싱 중 오류가 발생했습니다.");
      }
    };
    reader.readAsText(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.json')) {
      processFile(file);
    } else {
      alert("JSON 파일만 업로드 가능합니다.");
    }
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
    addLog(`🚀 마스터 DB(question_db) 스마트 일괄 업로드 시작...`);

    try {
      // 1. JSON 파일 안의 question_id 목록 추출하여 기존 DB와 대조
      const incomingIds = fileData.map(q => q.question_id).filter(Boolean);
      
      const { data: existingQs, error: fetchErr } = await supabase
        .from('question_db')
        .select('question_id')
        .in('question_id', incomingIds);
        
      if (fetchErr) throw new Error("기존 데이터 확인 중 오류 발생");

      const existingIdSet = new Set(existingQs?.map(q => q.question_id) || []);
      
      let updateCount = 0;
      let insertCount = 0;

      // 2. 완벽하게 스키마에 맞게 데이터 매핑
      const questionsToUpsert = fileData.map((q) => {
        if (existingIdSet.has(q.question_id)) updateCount++;
        else insertCount++;

        return {
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
          
          book_name: finalBookName || q.book_name || null,
          source_book_name: finalBookName || q.source_book_name || q.book_name || null,
          
          updated_at: new Date().toISOString()
        };
      });

      addLog(`📊 데이터 분석 결과: 기존 덮어쓰기(Update) ${updateCount}건 | 신규 이어붙이기(Insert) ${insertCount}건`);

      // 3. Supabase UPSERT를 활용한 일괄 처리
      const chunkSize = 100;
      let processedCount = 0;

      for (let i = 0; i < questionsToUpsert.length; i += chunkSize) {
        const chunk = questionsToUpsert.slice(i, i + chunkSize);
        
        const { error: upsertErr } = await supabase
          .from('question_db')
          .upsert(chunk, { onConflict: 'question_id' });

        if (upsertErr) {
          throw new Error(`청크 업로드 오류 (Row ${i}): ${upsertErr.message}`);
        }
        
        processedCount += chunk.length;
        setUploadProgress(5 + Math.round((processedCount / questionsToUpsert.length) * 95));
        addLog(`⏳ ${processedCount} / ${questionsToUpsert.length} 문항 안전하게 Upsert 처리 완료...`);
      }

      addLog(`🎉 마스터 DB 업로드 최종 완료!`);
      alert(`✅ 마스터 문제은행 처리가 완료되었습니다!\n총 처리 문항: ${processedCount}개\n(신규: ${insertCount}개 / 업데이트: ${updateCount}개)\n적용된 교재명: ${finalBookName}`);

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
        
        <div className="bg-slate-800 p-6 text-white shrink-0">
          <h1 className="text-2xl font-black flex items-center gap-2">
            <span>🗄️</span> 마스터 문제은행 (question_db) 스마트 업로드
          </h1>
          <p className="text-slate-300 text-sm mt-2 font-medium">
            AI로 파싱된 원본 문제 JSON 파일을 마스터 DB에 추가합니다. (기존 데이터는 덮어쓰고, 신규는 이어붙입니다.)
          </p>
        </div>

        <div className="p-8 space-y-6 flex-1 overflow-y-auto custom-scroll">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <h3 className="text-blue-800 font-bold text-sm mb-1">💡 스마트 이어붙이기(Upsert) 안내</h3>
            <ul className="text-xs text-blue-700 list-disc list-inside ml-4 space-y-1">
              <li>이곳에 먼저 문제가 등록되어 있어야 <b>교재 구조화 업로드</b>가 가능합니다.</li>
              <li>동일한 <code>question_id</code>가 이미 존재하면 <b>내용만 업데이트(Update)</b> 합니다.</li>
              <li>데이터베이스에 없는 새로운 문제라면 맨 뒤에 <b>새로 추가(Insert)</b> 합니다.</li>
            </ul>
          </div>

          {/* 🌟 드래그 앤 드롭 영역 */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">1. 문제 데이터 JSON 파일 등록 (드래그 앤 드롭 지원)</label>
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => document.getElementById('jsonFileInput')?.click()}
              className={`mt-2 flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl transition-all cursor-pointer ${
                isDragOver ? 'border-indigo-500 bg-indigo-50 scale-[1.02]' : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400'
              }`}
            >
              <input id="jsonFileInput" type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
              <div className="text-4xl mb-3">{isDragOver ? '📂' : '📄'}</div>
              <p className="text-slate-600 font-bold mb-1">여기로 JSON 파일을 드래그하거나 클릭하세요</p>
              <div className="text-xs text-slate-500 font-medium h-4 mt-1">
                {fileName ? <span className="text-indigo-600 font-bold bg-indigo-100 px-2 py-1 rounded">{fileName} ({fileData?.length}문항)</span> : "선택된 파일이 없습니다."}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <label className="block text-sm font-bold text-slate-700 mb-2">2. 강제 지정할 교재 이름 (book_name)</label>
            <input 
              type="text" 
              value={bookTitle} 
              onChange={(e) => setBookTitle(e.target.value)} 
              placeholder="파일을 올리면 자동으로 추출됩니다."
              className="w-full px-4 py-3 rounded-xl border border-slate-300 font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm transition-all" 
            />
            <p className="text-xs text-slate-500 mt-1.5 ml-1">※ 파일명에서 자동 추출된 이름입니다. 필요한 경우 수정하세요. 이 이름이 모든 문제에 일괄 적용됩니다.</p>
          </div>

          <div className="bg-slate-900 rounded-xl p-4 h-48 overflow-y-auto custom-scroll font-mono text-xs text-emerald-400">
            {uploadLogs.length === 0 ? (
              <span className="text-slate-600">대기 중... JSON 파일을 드래그 앤 드롭 하세요.</span>
            ) : (
              uploadLogs.map((log, i) => (
                <div key={i} className="mb-1">{`> ${log}`}</div>
              ))
            )}
          </div>
        </div>

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
            {isUploading ? "데이터 동기화 진행 중..." : "🗄️ 문제은행 마스터 DB 스마트 일괄 업로드 실행"}
          </button>
        </div>

      </div>
    </div>
  );
}