"use client";

import React, { useState, useRef, useEffect, MouseEvent } from "react";
import { createClient } from "@supabase/supabase-js";
import dynamic from "next/dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const DEFAULT_BOX = { width: 5.0, height: 2.5 };

interface PdfField {
  id: string;
  pdf_id: string;
  page_num: number;
  x_pos: number;
  y_pos: number;
  width: number;
  height: number;
  max_length: number;
  correct_answer: string;
}

type AuthState = "LOADING" | "UNAUTHENTICATED" | "UNAUTHORIZED" | "AUTHORIZED";

const PdfViewerWithOverlay = dynamic(
  async () => {
    const { Document, Page, pdfjs } = await import("react-pdf");
    pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;
    return function Viewer({ file, pageNumber, width, onLoadSuccess, children }: any) {
      return (
        <Document file={file} onLoadSuccess={onLoadSuccess} className="flex flex-col items-center">
          <Page pageNumber={pageNumber} renderTextLayer={false} renderAnnotationLayer={false} width={width} className="relative shadow-2xl overflow-hidden select-none">
            {children}
          </Page>
        </Document>
      );
    };
  },
  { ssr: false }
);

export default function AdminMappingTool() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [authState, setAuthState] = useState<AuthState>("LOADING");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [pdfFiles, setPdfFiles] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [pdfUrl, setPdfUrl] = useState<string>("");

  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPageNum, setCurrentPageNum] = useState(1);

  const [fields, setFields] = useState<PdfField[]>([]);
  const [activeForm, setActiveForm] = useState<{ x: number; y: number } | null>(null);
  const [formData, setFormData] = useState({ correct_answer: "", max_length: 1, ...DEFAULT_BOX });
  
  // 🌟 수정 모드를 위한 State
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setAuthState("UNAUTHENTICATED"); return; }

    const { data: roleData, error } = await supabase.from('instructor').select('role').eq('email', session.user.email).single();
    if (error) { setAuthState("UNAUTHORIZED"); return; }
    if (roleData && (roleData.role === 'SUPER_ADMIN' || roleData.role === 'super_admin' || roleData.role === 'director' || roleData.role === 'DIRECTOR')) {
      setAuthState("AUTHORIZED"); 
    } else setAuthState("UNAUTHORIZED"); 
  };

  useEffect(() => { checkAuth(); }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthState("LOADING");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { alert("로그인 실패: " + error.message); setAuthState("UNAUTHENTICATED"); } 
    else checkAuth(); 
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setAuthState("UNAUTHENTICATED");
  };

  useEffect(() => {
    if (authState !== "AUTHORIZED") return;
    const fetchPdfs = async () => {
      const { data } = await supabase.storage.from("textbooks").list();
      if (data) {
        const pdfs = data.filter((file) => file.name && file.name.toLowerCase().endsWith(".pdf"));
        setPdfFiles(pdfs);
        if (pdfs.length > 0) setSelectedFile(pdfs[0].name);
      }
    };
    fetchPdfs();
  }, [authState]);

  useEffect(() => {
    if (selectedFile) {
      const { data } = supabase.storage.from("textbooks").getPublicUrl(selectedFile);
      setPdfUrl(data.publicUrl);
      setCurrentPageNum(1);
      setNumPages(null);
      cancelEdit(); // 파일 바뀌면 에디트 모드 취소
    }
  }, [selectedFile]);

  useEffect(() => {
    const fetchFields = async () => {
      if (!selectedFile || authState !== "AUTHORIZED") return;
      // 생성 순서대로 불러오기 (학생 화면 동기화)
      const { data } = await supabase.from("pdf_fields").select("*").eq("pdf_id", selectedFile).eq("page_num", currentPageNum).order("created_at", { ascending: true });
      if (data) setFields(data);
    };
    fetchFields();
  }, [selectedFile, currentPageNum, authState]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => setNumPages(numPages);

  // ---------- 드래그 및 박스 갱신 로직 ----------
  type Point = { x: number; y: number };
  const [hoverPos, setHoverPos] = useState<Point | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);

  const toPercent = (clientX: number, clientY: number): Point | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const clamp = (v: number) => Math.min(100, Math.max(0, v));
    return {
      x: Number(clamp(((clientX - rect.left) / rect.width) * 100).toFixed(2)),
      y: Number(clamp(((clientY - rect.top) / rect.height) * 100).toFixed(2)),
    };
  };

  const toRect = (a: Point, b: Point) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Number(Math.abs(a.x - b.x).toFixed(2)),
    height: Number(Math.abs(a.y - b.y).toFixed(2)),
  });

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; 
    e.preventDefault(); 
    const pos = toPercent(e.clientX, e.clientY);
    if (!pos) return;
    
    // 만약 수정 모드가 아니라면, 폼 박스를 띄울 때 빈칸으로 띄움
    if (!editingFieldId) setActiveForm(null); 
    setDragStart(pos);
    setHoverPos(pos);
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (dragStart) return; 
    setHoverPos(toPercent(e.clientX, e.clientY));
  };

  const handleMouseLeave = () => { if (!dragStart) setHoverPos(null); };

  useEffect(() => {
    if (!dragStart) return;
    const onMove = (e: globalThis.MouseEvent) => setHoverPos(toPercent(e.clientX, e.clientY));
    const onUp = (e: globalThis.MouseEvent) => {
      const end = toPercent(e.clientX, e.clientY);
      setDragStart(null);
      if (!end) return;
      const r = toRect(dragStart, end);
      
      if (r.width < 0.5 && r.height < 0.5) {
        setActiveForm({ x: dragStart.x, y: dragStart.y });
      } else {
        setActiveForm({ x: r.x, y: r.y });
        setFormData((prev) => ({ ...prev, width: Math.max(r.width, 0.5), height: Math.max(r.height, 0.5) }));
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragStart]);

  const dragRect = dragStart && hoverPos ? toRect(dragStart, hoverPos) : null;

  // 🌟 항목 클릭 시 수정 모드 진입
  const handleEditField = (field: PdfField) => {
    setEditingFieldId(field.id);
    setActiveForm({ x: field.x_pos, y: field.y_pos });
    setFormData({
      correct_answer: field.correct_answer,
      max_length: field.max_length,
      width: field.width,
      height: field.height
    });
  };

  // 취소 및 초기화
  const cancelEdit = () => {
    setEditingFieldId(null);
    setActiveForm(null);
    setFormData({ correct_answer: "", max_length: 1, ...DEFAULT_BOX });
  };

  // 🌟 저장 (수정 모드면 Update, 아니면 Insert)
  const handleSaveField = async () => {
    if (!activeForm || !formData.correct_answer) return;
    const savePayload = {
      pdf_id: selectedFile, page_num: currentPageNum,
      x_pos: activeForm.x, y_pos: activeForm.y,
      width: formData.width, height: formData.height,
      max_length: formData.max_length, correct_answer: formData.correct_answer,
    };

    if (editingFieldId) {
      // 덮어쓰기 (Update)
      const { data, error } = await supabase.from('pdf_fields').update(savePayload).eq('id', editingFieldId).select().single();
      if (error) { alert("수정 실패: " + error.message); return; }
      if (data) setFields(fields.map(f => f.id === editingFieldId ? (data as PdfField) : f));
    } else {
      // 새로 만들기 (Insert)
      const { data, error } = await supabase.from('pdf_fields').insert([savePayload]).select().single();
      if (error) { alert("저장 실패: " + error.message); return; }
      if (data) setFields([...fields, data as PdfField]);
    }
    
    cancelEdit(); // 저장 후 상태 초기화
  };

  const handleDeleteField = async (id: string, e?: React.MouseEvent) => {
    if(e) e.stopPropagation();
    if(!confirm("정말 이 빈칸을 삭제하시겠습니까?")) return;

    const { error } = await supabase.from('pdf_fields').delete().eq('id', id);
    if (error) { alert("삭제 실패: " + error.message); return; }
    setFields(fields.filter(field => field.id !== id));
    if (editingFieldId === id) cancelEdit();
  };

  const currentPageFields = fields.filter((f) => f.page_num === currentPageNum);

  if (authState === "LOADING") return <div className="flex h-screen items-center justify-center bg-slate-100 font-bold text-slate-500">권한 확인 중...</div>;
  if (authState === "UNAUTHENTICATED") { /* ... 로그인 폼 (이전과 동일) ... */
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 font-pretendard">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-xl w-96 flex flex-col gap-4 border border-slate-200">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-[#002864] mb-2 mx-auto shadow-md"><span className="font-black text-2xl text-white">L</span></div>
          <h1 className="text-xl font-extrabold text-center text-slate-800 mb-4">관리자 로그인</h1>
          <input type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:border-blue-500" />
          <input type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:border-blue-500" />
          <button type="submit" className="w-full bg-[#002864] text-white font-bold py-3 rounded-lg mt-2 hover:bg-blue-900 shadow-md">로그인</button>
        </form>
      </div>
    );
  }
  if (authState === "UNAUTHORIZED") { /* ... 권한 에러 폼 (이전과 동일) ... */
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-100 font-pretendard">
        <div className="text-5xl mb-4">🚫</div><h1 className="text-2xl font-bold text-slate-800 mb-2">접근 권한이 없습니다</h1>
        <p className="text-slate-500 mb-6">최고관리자 및 원장만 접근할 수 있습니다.</p>
        <button onClick={handleLogout} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-700">다른 계정으로 로그인</button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-100 font-pretendard">
      <div className="flex-[7] p-8 flex flex-col items-center overflow-y-auto custom-scrollbar">
        <div className="mb-6 flex items-center justify-between w-full max-w-[800px] bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-3">
            <label className="text-sm font-bold text-slate-700">교재 선택:</label>
            <select value={selectedFile} onChange={(e) => setSelectedFile(e.target.value)} className="border border-slate-300 rounded p-1.5 text-sm font-bold min-w-[200px] outline-none focus:border-blue-500">
              {pdfFiles.length === 0 && <option>로딩 중...</option>}
              {pdfFiles.map((file) => <option key={file.id ?? file.name} value={file.name}>{file.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
            <button onClick={() => { setCurrentPageNum(p => Math.max(1, p - 1)); cancelEdit(); }} disabled={currentPageNum === 1} className="px-3 py-1 bg-white shadow-sm rounded text-sm font-bold text-slate-600 disabled:opacity-50">이전</button>
            <span className="text-sm font-bold text-slate-700 px-2">{currentPageNum} / {numPages || '-'}</span>
            <button onClick={() => { setCurrentPageNum(p => Math.min(numPages || 1, p + 1)); cancelEdit(); }} disabled={currentPageNum === numPages || numPages === null} className="px-3 py-1 bg-white shadow-sm rounded text-sm font-bold text-slate-600 disabled:opacity-50">다음</button>
          </div>
        </div>

        {pdfUrl ? (
          <div className="relative inline-block mt-4 select-none">
            <PdfViewerWithOverlay file={pdfUrl} pageNumber={currentPageNum} width={800} onLoadSuccess={onDocumentLoadSuccess}>
              <div ref={containerRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} className="absolute inset-0 z-10 cursor-crosshair">
                
                {currentPageFields.map((field) => {
                  // 수정 중인 박스는 여기서 렌더링하지 않고 activeForm(빨간 테두리)으로 렌더링
                  if (field.id === editingFieldId) return null; 

                  return (
                    <div 
                      key={field.id} 
                      onClick={() => handleEditField(field)}
                      className="absolute bg-blue-500/20 border-2 border-blue-600 flex items-center justify-center font-bold text-blue-900 text-sm shadow-sm cursor-pointer hover:bg-blue-400/40 transition-colors pointer-events-auto" 
                      style={{ left: `${field.x_pos}%`, top: `${field.y_pos}%`, width: `${field.width}%`, height: `${field.height}%` }}
                    >
                      {field.correct_answer}
                    </div>
                  );
                })}
                
                {/* 현재 조작 중인(새로 그리거나 수정 중인) 폼 박스 */}
                {activeForm && !dragRect && (
                  <div className="absolute bg-red-500/30 border-2 border-red-600 shadow-[0_0_15px_rgba(239,68,68,0.5)] pointer-events-none" style={{ left: `${activeForm.x}%`, top: `${activeForm.y}%`, width: `${formData.width}%`, height: `${formData.height}%` }} />
                )}
                {dragRect && (
                  <div className="absolute bg-red-500/20 border-2 border-dashed border-red-600 pointer-events-none" style={{ left: `${dragRect.x}%`, top: `${dragRect.y}%`, width: `${dragRect.width}%`, height: `${dragRect.height}%` }} />
                )}
                
                {hoverPos && (
                  <>
                    <div className="absolute left-0 w-full h-px bg-rose-500/70 pointer-events-none z-20" style={{ top: `${hoverPos.y}%` }} />
                    <div className="absolute top-0 h-full w-px bg-rose-500/70 pointer-events-none z-20" style={{ left: `${hoverPos.x}%` }} />
                    <div className="absolute z-30 pointer-events-none whitespace-nowrap rounded bg-slate-900/85 px-2 py-1 font-mono text-[11px] leading-tight text-white shadow" style={{ left: `${hoverPos.x}%`, top: `${hoverPos.y}%`, transform: `translate(${hoverPos.x > 80 ? "calc(-100% - 10px)" : "10px"}, ${hoverPos.y > 92 ? "calc(-100% - 10px)" : "10px"})` }}>
                      <div>X {hoverPos.x.toFixed(2)}% · Y {hoverPos.y.toFixed(2)}%</div>
                      {dragRect && <div className="text-rose-300">W {dragRect.width.toFixed(2)}% × H {dragRect.height.toFixed(2)}%</div>}
                    </div>
                  </>
                )}
              </div>
            </PdfViewerWithOverlay>
          </div>
        ) : (
          <div className="flex items-center justify-center w-[800px] h-[1130px] border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 text-slate-400 font-bold">선택된 교재가 없습니다.</div>
        )}
      </div>

      <div className="flex-[3] bg-white border-l border-slate-200 p-6 flex flex-col shadow-xl z-10 min-w-[350px]">
        <div className="flex justify-between items-center border-b pb-3 mb-6">
          <h2 className="text-lg font-bold text-[#002864]">
            {editingFieldId ? "✏️ 매핑 수정 모드" : "문제 입력 매핑"}
          </h2>
          <button onClick={handleLogout} className="text-xs font-bold text-slate-400 hover:text-rose-500">로그아웃</button>
        </div>

        {activeForm ? (
          <div className={`border rounded-xl p-5 mb-6 shadow-sm ${editingFieldId ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="mb-4">
              <span className="text-xs font-bold text-slate-500">좌표 및 크기</span>
              <div className="text-sm font-mono text-slate-700 bg-white/50 border border-slate-200 px-2 py-1 rounded mt-1">
                X: {activeForm.x}% , Y: {activeForm.y}%<br />
                W: {formData.width}% , H: {formData.height}%
              </div>
            </div>
            <label className="block mb-3">
              <span className="text-sm font-bold text-slate-700">정답</span>
              <input type="text" autoFocus value={formData.correct_answer} onChange={(e) => setFormData({ ...formData, correct_answer: e.target.value })} className="mt-1 block w-full rounded-md border-slate-300 p-2 border outline-none focus:border-blue-500" placeholder="예: 400" />
            </label>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <label className="block"><span className="text-sm font-bold text-slate-700">최대 자릿수</span><input type="number" min={1} value={formData.max_length} onChange={(e) => setFormData({ ...formData, max_length: Number(e.target.value) })} className="mt-1 block w-full rounded-md border-slate-300 p-2 border outline-none" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">너비 (%)</span><input type="number" step="0.1" min={0.5} value={formData.width} onChange={(e) => setFormData({ ...formData, width: Number(e.target.value) })} className="mt-1 block w-full rounded-md border-slate-300 p-2 border outline-none" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">높이 (%)</span><input type="number" step="0.1" min={0.5} value={formData.height} onChange={(e) => setFormData({ ...formData, height: Number(e.target.value) })} className="mt-1 block w-full rounded-md border-slate-300 p-2 border outline-none" /></label>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleSaveField} className={`flex-1 text-white font-bold py-2 rounded shadow ${editingFieldId ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-[#002864] hover:bg-blue-900'}`}>
                {editingFieldId ? '수정 완료' : '저장'}
              </button>
              <button onClick={cancelEdit} className="flex-1 bg-white border border-slate-300 text-slate-600 font-bold py-2 rounded hover:bg-slate-50">취소</button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-100 border border-slate-200 border-dashed rounded-xl p-8 text-center text-slate-400 font-bold mb-6">
            좌측 PDF에서 입력칸을 그리거나,<br />등록된 박스를 클릭해 수정하세요.
          </div>
        )}

        <h3 className="text-sm font-bold text-slate-500 mb-3">현재 페이지 매핑 리스트 ({currentPageFields.length})</h3>
        <div className="flex-1 overflow-y-auto border border-slate-200 rounded-lg bg-slate-50 p-2">
          {currentPageFields.map((f, i) => (
            <div 
              key={f.id} 
              onClick={() => handleEditField(f)}
              className={`p-3 border rounded-md mb-2 shadow-sm flex justify-between items-center cursor-pointer transition-colors ${
                editingFieldId === f.id ? 'bg-indigo-100 border-indigo-300 ring-1 ring-indigo-300' : 'bg-white border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div>
                <div className="text-sm font-bold text-[#002864]">#{i + 1} 정답: {f.correct_answer}</div>
                <div className="text-xs text-slate-500 mt-1">X: {f.x_pos}% / Y: {f.y_pos}% (Len: {f.max_length})</div>
              </div>
              <button onClick={(e) => handleDeleteField(f.id, e)} className="text-slate-400 hover:text-rose-500 p-2 rounded-lg hover:bg-rose-50">🗑️</button>
            </div>
          ))}
          {currentPageFields.length === 0 && <p className="text-xs text-slate-400 text-center py-4">등록된 필드가 없습니다.</p>}
        </div>
      </div>
    </div>
  );
}