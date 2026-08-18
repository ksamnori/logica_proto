// src/app/(dashboard)/book-upload/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface ParsedQuestion {
  question_id: string;
  question_number?: string | number;
  sub_num?: number;
  question?: string;
  answer?: string | null;
  final_printed_page?: string | number | null;
  detected_page_num?: number | null;
  difficulty?: string | null;
  problem_type?: string | null;
  taxonomy_id?: string | null;
  thk_taxonomy_id?: string | null;
  human_verified?: boolean;
  is_human_verified?: boolean;
  [key: string]: any;
}

interface TextbookQuestionInsert {
  book_id: string; 
  page_number: number;
  question_number: string;
  answer: string | null;
  question_category: string;
  problem_type: string | null;
  question_id: string;
  difficulty: string | null;
  taxonomy_id: string | null;
  thk_taxonomy_id: string | null;
  question: string | null;
  raw_metadata: Record<string, unknown>;
}

export default function BookUploadPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [bookTitle, setBookTitle] = useState("");
  const [bookType, setBookType] = useState("주교재");
  const [targetSessions, setTargetSessions] = useState(12);

  const [fileData, setFileData] = useState<ParsedQuestion[] | null>(null);
  const [fileName, setFileName] = useState("");
  
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLogs, setUploadLogs] = useState<string[]>([]);

  // 🌟 드래그 앤 드롭 상태 관리
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const checkAccess = () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || pos.includes('최고관리자') || pos.includes('원장');
      if (isGodMode) setIsAuthorized(true);
      else { alert("⛔ 교재 업로드 툴은 원장 및 최고관리자 전용입니다."); router.replace("/home"); }
    };
    checkAccess();
  }, [router]);

  const addLog = (msg: string) => setUploadLogs(prev => [...prev, msg]);

  // 🌟 파일 처리 및 스마트 이름 추출 공통 로직
  const processFile = (file: File) => {
    setFileName(file.name);
    setUploadLogs([]);
    
    // 파일명에서 쓸데없는 꼬리표 자르고 순수 교재명 자동 추출
    let cleanName = file.name.replace(/\.json$/i, ''); // 확장자 제거
    cleanName = cleanName.split('_Problems')[0]; // _Problems 뒷부분 전부 제거
    
    setBookTitle(cleanName); // 입력창에 자동 세팅

    if (cleanName.includes("워크북") || file.name.includes("워크북")) {
      setBookType("워크북");
    } else {
      setBookType("주교재");
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          setFileData(json);
          addLog(`✅ 파일 로드 완료: 총 ${json.length}개의 문항 감지.`);
          addLog(`💡 추출된 기본 교재명: [${cleanName}]`);
        } else alert("유효하지 않은 JSON 형식입니다. 배열 형태여야 합니다.");
      } catch (err) { alert("JSON 파일 파싱 중 오류가 발생했습니다."); }
    };
    reader.readAsText(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  // 🌟 드래그 앤 드롭 이벤트 핸들러
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
    } else if (file) {
      alert("JSON 파일만 업로드 가능합니다.");
    }
  };

  const mapDifficulty = (diff: string | null | undefined) => {
    if (!diff) return null;
    const clean = diff.trim();
    if (clean === '중상') return '상';
    if (clean === '중하') return '중';
    const allowed = ['최상', '상', '중', '하', '최하'];
    return allowed.includes(clean) ? clean : null;
  };

  const processUpload = async () => {
    if (!fileData || fileData.length === 0) return alert("업로드할 데이터가 없습니다.");
    if (!bookTitle.trim()) return alert("교재 이름을 입력해주세요.");

    setIsUploading(true);
    setUploadProgress(0);

    try {
      addLog(`🚀 [Step 1] 마스터 DB(question_db)에 데이터 안전 동기화 시작...`);
      const masterDbData = fileData.map((q) => ({
        question_id: q.question_id,
        item_id: q.item_id || null,
        pdf_source: q.pdf_source || null,
        detected_page_num: typeof q.detected_page_num === 'number' ? q.detected_page_num : null,
        final_printed_page: q.final_printed_page ? String(q.final_printed_page) : null,
        question_number: q.question_number ? String(q.question_number) : null,
        sub_num: typeof q.sub_num === 'number' ? q.sub_num : 0,
        problem_type: q.problem_type || null,
        difficulty: mapDifficulty(q.difficulty), 
        question: q.question || "",
        answer: q.answer || null,
        step_1_concept: q.step_1_concept || null,
        step_2_approach: q.step_2_approach || null,
        step_3_process: q.step_3_process || null,
        step_4_conclusion: q.step_4_conclusion || null,
        taxonomy_id: q.taxonomy_id || null,
        taxonomy_name: q.taxonomy_name || null,
        cognitive_level: q.cognitive_level || null,
        is_human_verified: q.human_verified === true || q.is_human_verified === true,
        thk_taxonomy_id: q.thk_taxonomy_id || null,
        thk_taxonomy_name: q.thk_taxonomy_name || null,
        source_book_name: q.source_book_name || q.book_name || bookTitle,
        updated_at: new Date().toISOString()
      }));

      const chunkSize = 100;
      for (let i = 0; i < masterDbData.length; i += chunkSize) {
        const chunk = masterDbData.slice(i, i + chunkSize);
        const { error: upsertErr } = await supabase.from('question_db').upsert(chunk, { onConflict: 'question_id' });
        if (upsertErr) throw new Error(`마스터 DB 병합 오류: ${upsertErr.message}`);
        setUploadProgress(Math.round(((i + chunk.length) / masterDbData.length) * 40)); 
      }
      addLog(`✅ [Step 1 완료] 마스터 DB 업데이트 완료.`);

      addLog(`🚀 [Step 2] 교재 골격(textbook) 확인 중...`);
      let currentBookId: string; 
      
      const { data: existingBook, error: checkErr } = await supabase.from('textbook').select('book_id').eq('title', bookTitle).eq('book_type', bookType).maybeSingle();
      if (checkErr) throw new Error("교재 중복 확인 오류");

      const existingTqMap: Record<string, number> = {};

      if (existingBook) {
        if (!confirm(`이미 '${bookTitle}' 교재가 존재합니다.\n기존 문항을 삭제하지 않고 변경사항은 덮어쓰며, 새 문항은 이어서 추가하시겠습니까?`)) { 
          setIsUploading(false); return; 
        }
        currentBookId = existingBook.book_id;
        
        const { data: existingQs } = await supabase.from('textbook_question').select('tq_id, question_id').eq('book_id', currentBookId);
        if (existingQs) {
          existingQs.forEach(q => {
            if (q.question_id) existingTqMap[q.question_id] = q.tq_id;
          });
        }
        addLog(`✅ 기존 교재 감지됨. 기존 문항 ${Object.keys(existingTqMap).length}개 로드 완료.`);
      } else {
        // 🌟 [핵심 변경] tenant_id: null 로 고정하여 전 지점 공용(글로벌) 교재로 생성되게 함!
        const { data: newBook, error: insertBookErr } = await supabase.from('textbook').insert({
            title: bookTitle, 
            book_type: bookType, 
            target_sessions: targetSessions, 
            tenant_id: null 
        }).select('book_id').single();
        
        if (insertBookErr || !newBook) throw new Error(`교재 생성 실패: ${insertBookErr?.message}`);
        currentBookId = newBook.book_id;
        addLog(`✅ [Step 2 완료] 전 지점 공용 교재 골격 새롭게 세팅 완료`);
      }
      
      setUploadProgress(50);

      addLog(`🚀 [Step 3] 교재-문항 매핑 데이터 갱신 중...`);
      
      const toInsert: TextbookQuestionInsert[] = [];
      const toUpdate: (TextbookQuestionInsert & { tq_id: number })[] = [];

      fileData.forEach((q) => {
        let pageNum = parseInt(String(q.final_printed_page) || "");
        if (isNaN(pageNum)) pageNum = q.detected_page_num || 0;
        const qNumberStr = q.question_number ? String(q.question_number) : '0';

        const payload: TextbookQuestionInsert = {
          book_id: currentBookId,
          page_number: pageNum,
          question_number: qNumberStr,
          answer: q.answer || null,
          question_category: '일반',
          problem_type: q.problem_type || null,
          question_id: q.question_id, 
          difficulty: mapDifficulty(q.difficulty),
          taxonomy_id: q.taxonomy_id || null,
          thk_taxonomy_id: q.thk_taxonomy_id || null,
          question: q.question || null,
          raw_metadata: q as Record<string, unknown>
        };

        if (existingTqMap[q.question_id]) {
          toUpdate.push({ ...payload, tq_id: existingTqMap[q.question_id] });
        } else {
          toInsert.push(payload);
        }
      });

      let processedCount = 0;
      const totalCount = toInsert.length + toUpdate.length;

      if (toUpdate.length > 0) {
        addLog(`🔄 기존 문항 덮어쓰기(Update) ${toUpdate.length}개 진행 중...`);
        const updateChunkSize = 50; 
        for (let i = 0; i < toUpdate.length; i += updateChunkSize) {
          const chunk = toUpdate.slice(i, i + updateChunkSize);
          await Promise.all(chunk.map(async (item) => {
            const { tq_id, ...updateData } = item;
            await supabase.from('textbook_question').update(updateData).eq('tq_id', tq_id);
          }));
          processedCount += chunk.length;
          setUploadProgress(50 + Math.round((processedCount / totalCount) * 50));
        }
      }

      if (toInsert.length > 0) {
        addLog(`➕ 신규 문항 이어붙이기(Insert) ${toInsert.length}개 진행 중...`);
        for (let i = 0; i < toInsert.length; i += chunkSize) {
          const chunk = toInsert.slice(i, i + chunkSize);
          const { error: insertQErr } = await supabase.from('textbook_question').insert(chunk as any);
          if (insertQErr) throw new Error(`문항 이어붙이기 오류: ${insertQErr.message}`);
          
          processedCount += chunk.length;
          setUploadProgress(50 + Math.round((processedCount / totalCount) * 50));
        }
      }

      addLog(`🎉 모든 업로드 과정이 완벽하게 종료되었습니다!`);
      alert(`✅ 성공적으로 공용 교재 처리가 완료되었습니다!\n교재명: ${bookTitle}\n새로 추가됨: ${toInsert.length}개\n기존 업데이트됨: ${toUpdate.length}개`);
      
      setFileData(null); setFileName(""); setBookTitle("");
      const fileInput = document.getElementById('jsonFileInput') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류";
      addLog(`❌ 시스템 오류: ${errorMessage}`);
      alert(`업로드 중단:\n${errorMessage}`);
    } finally {
      setIsUploading(false);
    }
  };

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden items-center">
      <div className="w-full max-w-4xl bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col mt-4 overflow-hidden">
        
        <div className="bg-[#002864] p-6 text-white shrink-0">
          <h1 className="text-2xl font-black flex items-center gap-2">
            <span>🚀</span> 통합 교재 일괄 업로드 시스템
          </h1>
          <p className="text-blue-200 text-sm mt-2 font-medium">
            마스터 문제은행(<code>question_db</code>)과 교재 구조(<code>textbook_question</code>)를 한 번에 묶어서 안전하게 처리합니다.
          </p>
        </div>

        <div className="p-8 space-y-6 flex-1 overflow-y-auto custom-scroll">
          
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <h3 className="text-blue-800 font-bold text-sm mb-1">💡 스마트 이어붙이기 작동 방식</h3>
            <ul className="text-xs text-blue-700 list-disc list-inside ml-4 space-y-1">
              <li>제출된 JSON은 먼저 <b>마스터 DB에 병합(Upsert)</b>되어 최신 상태로 갱신됩니다.</li>
              <li>교재 이름이 같다면 기존 데이터를 날리지 않고 <b>신규 문항만 꼬리에 이어붙입니다(Append).</b></li>
              <li>만약 교재 내에 이미 존재하는 UUID 문항이 다시 업로드되면 내용만 <b>최신 버전으로 업데이트(Update)</b> 합니다.</li>
            </ul>
          </div>

          {/* 🌟 드래그 앤 드롭 지원 영역 */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">1. 파싱된 교재 JSON 파일 등록 (드래그 앤 드롭 지원)</label>
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => document.getElementById('jsonFileInput')?.click()}
              className={`mt-2 flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl transition-all cursor-pointer ${
                isDragOver ? 'border-indigo-500 bg-indigo-50 scale-[1.02]' : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400'
              }`}
            >
              <input id="jsonFileInput" type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
              <div className="text-4xl mb-3">{isDragOver ? '📂' : '📄'}</div>
              <p className="text-slate-600 font-bold mb-1">여기로 JSON 파일을 드래그하거나 클릭하세요</p>
              <div className="text-xs text-slate-500 font-medium h-4 mt-1">
                {fileName ? <span className="text-indigo-600 font-bold bg-indigo-100 px-2 py-1 rounded">{fileName} ({fileData?.length}문항)</span> : "선택된 파일이 없습니다."}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5 pt-4 border-t border-slate-100">
            <div className="col-span-2">
              <label className="block text-sm font-bold text-slate-700 mb-2">2. 교재 공식 명칭 <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded ml-1 font-bold">전국 공용 자동 설정</span></label>
              <input 
                type="text" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} 
                placeholder="파일을 올리면 자동으로 추출됩니다."
                className="w-full px-4 py-3 rounded-xl border border-slate-300 font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm transition-all" 
              />
              <p className="text-xs text-slate-500 mt-1.5 ml-1">※ 파일명에서 자동 추출된 이름입니다. 이 이름이 교재와 문항 전체에 일괄 적용됩니다.</p>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">교재 분류</label>
              <select value={bookType} onChange={(e) => setBookType(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-300 font-bold text-slate-800 focus:outline-none focus:border-indigo-500 shadow-sm">
                <option value="주교재">주교재</option>
                <option value="워크북">워크북</option>
                <option value="부교재">부교재</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">권장 커리큘럼 회차</label>
              <div className="relative">
                <input type="number" value={targetSessions} onChange={(e) => setTargetSessions(parseInt(e.target.value) || 1)} className="w-full px-4 py-3 rounded-xl border border-slate-300 font-bold text-slate-800 focus:outline-none focus:border-indigo-500 shadow-sm" />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">회차</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 rounded-xl p-4 h-32 overflow-y-auto custom-scroll font-mono text-[11px] text-emerald-400 shadow-inner">
            {uploadLogs.length === 0 ? <span className="text-slate-600">시스템 대기 중... JSON 파일을 로드해주세요.</span>
            : uploadLogs.map((log, i) => <div key={i} className="mb-1">{`> ${log}`}</div>)}
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-200 shrink-0">
          {isUploading && (
            <div className="mb-4">
              <div className="flex justify-between text-xs font-bold text-indigo-700 mb-1">
                <span>데이터베이스 동기화 및 맵핑 중...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-indigo-100 rounded-full h-2.5 overflow-hidden shadow-inner">
                <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            </div>
          )}
          
          <button 
            onClick={processUpload} disabled={!fileData || isUploading}
            className={`w-full py-4 rounded-xl font-black text-lg transition-all shadow-md flex items-center justify-center gap-2
              ${!fileData ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : isUploading ? 'bg-indigo-400 text-white cursor-wait' : 'bg-[#002864] hover:bg-blue-900 text-white active:scale-[0.98]'}`}
          >
            {isUploading ? "데이터 동기화 진행 중..." : "🚀 완벽하게 교재 및 문항 일괄 등록 시작"}
          </button>
        </div>

      </div>
    </div>
  );
}