// src/app/(dashboard)/qdb-upload/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function QuestionDBUploadPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  // JSON 데이터 상태
  const [fileData, setFileData] = useState<any[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  
  // 🌟 다중 이미지 업로드 상태 추가
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [isImageDragOver, setIsImageDragOver] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState(0);

  // 업로드 진행 상태
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLogs, setUploadLogs] = useState<string[]>([]);
  
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

      if (role === 'SUPER_ADMIN') {
        setIsAuthorized(true);
        return;
      }

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

  // JSON 파일 처리
  const processFile = (file: File) => {
    setFileName(file.name);
    setUploadLogs([]);

    let cleanName = file.name.replace(/\.json$/i, ''); 
    cleanName = cleanName.split('_Problems')[0]; 
    setBookTitle(cleanName); 

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          setFileData(json);
          addLog(`✅ JSON 파싱 성공: 총 ${json.length}개의 문항 데이터 감지.`);
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

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); };
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

  // 🌟 다중 이미지 핸들러 추가
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setImageFiles(Array.from(e.target.files));
  };
  const handleImageDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsImageDragOver(true); };
  const handleImageDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsImageDragOver(false); };
  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsImageDragOver(false);
    if (e.dataTransfer.files) {
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      setImageFiles(files);
      if (files.length > 0) addLog(`✅ 대기 중인 이미지 파일 ${files.length}개 인식 완료.`);
    }
  };

  const mapDifficulty = (diff: string | null) => {
    if (!diff) return null;
    const cleanDiff = diff.trim();
    if (cleanDiff === '중상') return '상';
    if (cleanDiff === '중하') return '중';
    
    const allowed = ['최상', '상', '중', '하', '최하'];
    return allowed.includes(cleanDiff) ? cleanDiff : null;
  };

  const processUpload = async () => {
    if (!fileData || fileData.length === 0) return alert("업로드할 JSON 데이터가 없습니다.");
    
    const finalBookName = bookTitle.trim();
    if (!finalBookName) return alert("교재 이름을 입력해주세요.");

    setIsUploading(true);
    setUploadProgress(0);
    setImageUploadProgress(0);

    try {
      // 🌟 1. 이미지 업로드 (Upsert 처리)
      if (imageFiles.length > 0) {
        addLog(`🚀 [1단계] 이미지 파일 ${imageFiles.length}개 업로드 시작...`);
        let imgSuccess = 0;
        
        for (let i = 0; i < imageFiles.length; i++) {
          const file = imageFiles[i];
          const { error: imgErr } = await supabase.storage
            .from('question_images') // 기존 문제 이미지 버킷
            .upload(file.name, file, { 
              upsert: true, // 🌟 이름 중복 시 덮어쓰기 옵션 
              cacheControl: '3600' 
            });
          
          if (imgErr) {
            addLog(`❌ 이미지 업로드 실패 [${file.name}]: ${imgErr.message}`);
          } else {
            imgSuccess++;
          }
          setImageUploadProgress(Math.round(((i + 1) / imageFiles.length) * 100));
        }
        addLog(`✅ 이미지 업로드 완료 (성공: ${imgSuccess} / 전체: ${imageFiles.length})`);
      }

      // 🌟 2. 마스터 DB (JSON) 업로드
      addLog(`🚀 [2단계] 마스터 DB(question_db) 스마트 일괄 동기화 시작...`);
      const incomingIds = fileData.map(q => q.question_id).filter(Boolean);
      
      const { data: existingQs, error: fetchErr } = await supabase
        .from('question_db')
        .select('question_id')
        .in('question_id', incomingIds);
        
      if (fetchErr) throw new Error("기존 DB 데이터 확인 중 오류 발생");

      const existingIdSet = new Set(existingQs?.map(q => q.question_id) || []);
      
      let updateCount = 0;
      let insertCount = 0;

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

      addLog(`📊 DB 분석 결과: 기존 덮어쓰기(Update) ${updateCount}건 | 신규 이어붙이기(Insert) ${insertCount}건`);

      const chunkSize = 100;
      let processedCount = 0;

      for (let i = 0; i < questionsToUpsert.length; i += chunkSize) {
        const chunk = questionsToUpsert.slice(i, i + chunkSize);
        
        const { error: upsertErr } = await supabase
          .from('question_db')
          .upsert(chunk, { onConflict: 'question_id' });

        if (upsertErr) {
          throw new Error(`청크 DB 업로드 오류 (Row ${i}): ${upsertErr.message}`);
        }
        
        processedCount += chunk.length;
        setUploadProgress(Math.round((processedCount / questionsToUpsert.length) * 100));
        addLog(`⏳ DB ${processedCount} / ${questionsToUpsert.length} 문항 안전하게 Upsert 처리 완료...`);
      }

      addLog(`🎉 모든 동기화 작업 최종 완료!`);
      alert(`✅ 문제은행 처리 및 이미지 업로드가 완료되었습니다!\n\n[처리 문항]\n총 ${processedCount}개 (신규 ${insertCount} / 업데이트 ${updateCount})\n\n[이미지]\n총 ${imageFiles.length}개 안전하게 덮어쓰기 완료\n\n적용된 교재명: ${finalBookName}`);

      setFileData(null);
      setFileName("");
      setImageFiles([]);
      const jsonInput = document.getElementById('jsonFileInput') as HTMLInputElement;
      if (jsonInput) jsonInput.value = '';
      const imgInput = document.getElementById('imageFileInput') as HTMLInputElement;
      if (imgInput) imgInput.value = '';

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
      addLog(`❌ 업로드 실패: ${errorMessage}`);
      alert(`업로드 실패:\n${errorMessage}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setImageUploadProgress(0);
    }
  };

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden items-center">
      <div className="w-full max-w-4xl bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col mt-4 overflow-hidden h-[calc(100vh-6rem)]">
        
        <div className="bg-[#002864] p-6 text-white shrink-0">
          <h1 className="text-2xl font-black flex items-center gap-2">
            <span>🗄️</span> 마스터 문제은행 스마트 업로드
          </h1>
          <p className="text-blue-200 text-sm mt-2 font-medium">
            JSON 문제 데이터와 다중 이미지 파일을 한 번에 처리합니다. (기존 데이터/이미지는 자동으로 덮어씁니다.)
          </p>
        </div>

        <div className="p-8 space-y-6 flex-1 overflow-y-auto custom-scroll">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <h3 className="text-blue-800 font-bold text-sm mb-1">💡 스마트 이어붙이기(Upsert) 안내</h3>
            <ul className="text-xs text-blue-700 list-disc list-inside ml-4 space-y-1">
              <li>JSON 파일의 <code>question_id</code>가 이미 존재하면 <b>내용만 업데이트</b> 됩니다.</li>
              <li>마찬가지로 첨부된 이미지도 동일한 이름이 있으면 <b>안전하게 최신 파일로 덮어쓰기</b> 됩니다.</li>
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* 1. JSON 업로드 영역 */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">1. JSON 데이터 파일</label>
              <div 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => document.getElementById('jsonFileInput')?.click()}
                className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl transition-all cursor-pointer h-40 ${
                  isDragOver ? 'border-indigo-500 bg-indigo-50 scale-[1.02]' : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400'
                }`}
              >
                <input id="jsonFileInput" type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
                <div className="text-3xl mb-2">{isDragOver ? '📂' : '📄'}</div>
                <p className="text-slate-600 font-bold text-xs mb-1">JSON 파일 드래그 & 클릭</p>
                <div className="text-[10px] text-slate-500 font-medium h-4 mt-1">
                  {fileName ? <span className="text-indigo-600 font-bold bg-indigo-100 px-2 py-0.5 rounded">{fileName}</span> : "필수 업로드"}
                </div>
              </div>
            </div>

            {/* 🌟 2. 다중 이미지 업로드 영역 추가 */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">2. 문제/정답 이미지 파일 (선택)</label>
              <div 
                onDragOver={handleImageDragOver}
                onDragLeave={handleImageDragLeave}
                onDrop={handleImageDrop}
                onClick={() => document.getElementById('imageFileInput')?.click()}
                className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl transition-all cursor-pointer h-40 ${
                  isImageDragOver ? 'border-emerald-500 bg-emerald-50 scale-[1.02]' : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400'
                }`}
              >
                {/* multiple 속성을 추가하여 다중 파일 선택 허용 */}
                <input id="imageFileInput" type="file" multiple accept="image/*" onChange={handleImageSelect} className="hidden" />
                <div className="text-3xl mb-2">{isImageDragOver ? '🖼️' : '📸'}</div>
                <p className="text-slate-600 font-bold text-xs mb-1">이미지 다중 선택 & 드래그</p>
                <div className="text-[10px] text-slate-500 font-medium h-4 mt-1">
                  {imageFiles.length > 0 ? <span className="text-emerald-600 font-bold bg-emerald-100 px-2 py-0.5 rounded">총 {imageFiles.length}개 파일 대기 중</span> : "선택 안 함"}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <label className="block text-sm font-bold text-slate-700 mb-2">3. 강제 지정할 교재 이름 (book_name) <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded ml-1 font-bold">전국 공용 설정</span></label>
            <input 
              type="text" 
              value={bookTitle} 
              onChange={(e) => setBookTitle(e.target.value)} 
              placeholder="JSON 파일을 올리면 자동으로 추출됩니다."
              className="w-full px-4 py-3 rounded-xl border border-slate-300 font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm transition-all" 
            />
          </div>

          <div className="bg-slate-900 rounded-xl p-4 h-40 overflow-y-auto custom-scroll font-mono text-[11px] text-emerald-400 shadow-inner">
            {uploadLogs.length === 0 ? (
              <span className="text-slate-600">대기 중... 작업할 파일을 드래그 앤 드롭 하세요.</span>
            ) : (
              uploadLogs.map((log, i) => (
                <div key={i} className="mb-1">{`> ${log}`}</div>
              ))
            )}
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-200 shrink-0">
          {isUploading && (
            <div className="mb-4 space-y-2">
              {imageFiles.length > 0 && (
                <div>
                  <div className="flex justify-between text-[11px] font-bold text-emerald-700 mb-1">
                    <span>🖼️ 이미지 덮어쓰기 진행률</span>
                    <span>{imageUploadProgress}%</span>
                  </div>
                  <div className="w-full bg-emerald-100 rounded-full h-1.5 overflow-hidden shadow-inner">
                    <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${imageUploadProgress}%` }}></div>
                  </div>
                </div>
              )}
              <div>
                <div className="flex justify-between text-[11px] font-bold text-indigo-700 mb-1">
                  <span>🗄️ JSON DB 동기화 진행률</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-indigo-100 rounded-full h-1.5 overflow-hidden shadow-inner">
                  <div className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                </div>
              </div>
            </div>
          )}
          
          <button 
            onClick={processUpload} 
            disabled={(!fileData && imageFiles.length === 0) || isUploading}
            className={`w-full py-4 rounded-xl font-black text-lg transition-all shadow-md flex items-center justify-center gap-2
              ${(!fileData && imageFiles.length === 0) ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 
                isUploading ? 'bg-indigo-400 text-white cursor-wait' : 'bg-[#002864] hover:bg-blue-900 text-white active:scale-[0.98]'}`}
          >
            {isUploading ? "데이터 동기화 진행 중..." : "🚀 파일 및 데이터 스마트 동기화 시작"}
          </button>
        </div>

      </div>
    </div>
  );
}