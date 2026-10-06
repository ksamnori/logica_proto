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
  problem_num?: string;
  video_url?: string;
  display_order?: number;
  field_type?: 'input' | 'select' | 'video';
  created_at?: string;
}

interface ConceptVideo {
  id: string;
  pdf_id: string;
  start_page: number;
  end_page: number;
  video_url: string;
}

type AuthState = "LOADING" | "UNAUTHENTICATED" | "UNAUTHORIZED" | "AUTHORIZED";

const PdfViewerWithOverlay = dynamic(
  async () => {
    const { Document, Page, pdfjs } = await import("react-pdf");
    pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;
    const pdfOptions = { cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`, cMapPacked: true };

    return function Viewer({ file, pageNumber, width, onLoadSuccess, children }: any) {
      return (
        <Document file={file} onLoadSuccess={onLoadSuccess} options={pdfOptions} className="flex flex-col items-center">
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

  const [activeTab, setActiveTab] = useState<'mapping' | 'concept'>('mapping');

  const [pdfFiles, setPdfFiles] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [pdfUrl, setPdfUrl] = useState<string>("");

  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPageNum, setCurrentPageNum] = useState(1);

  const [fields, setFields] = useState<PdfField[]>([]);
  const [conceptVideos, setConceptVideos] = useState<ConceptVideo[]>([]);
  
  const [activeForm, setActiveForm] = useState<{ x: number; y: number } | null>(null);
  const [formData, setFormData] = useState<{
    correct_answer: string; max_length: number; problem_num: string; video_url: string; width: number; height: number; field_type: 'input' | 'select' | 'video';
  }>({ correct_answer: "", max_length: 1, problem_num: "", video_url: "", field_type: 'input', ...DEFAULT_BOX });
  
  const [conceptForm, setConceptForm] = useState({ start_page: 1, end_page: 1, video_url: "" });

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkProblemNum, setBulkProblemNum] = useState("");

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setAuthState("UNAUTHENTICATED"); return; }
    const { data: roleData, error } = await supabase.from('instructor').select('role').eq('email', session.user.email).single();
    if (error) { setAuthState("UNAUTHORIZED"); return; }
    if (roleData && ['SUPER_ADMIN', 'super_admin', 'director', 'DIRECTOR'].includes(roleData.role)) {
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
      cancelEdit();
      setSelectedIds([]);
      fetchConceptVideos();
    }
  }, [selectedFile]);

  const fetchFields = async () => {
    if (!selectedFile || authState !== "AUTHORIZED") return;
    const { data } = await supabase.from("pdf_fields").select("*").eq("pdf_id", selectedFile).eq("page_num", currentPageNum);
    if (data) setFields(data);
    setSelectedIds([]); 
  };

  const fetchConceptVideos = async () => {
    if (!selectedFile) return;
    const { data } = await supabase.from("pdf_concept_videos").select("*").eq("pdf_id", selectedFile).order("start_page", { ascending: true });
    if (data) setConceptVideos(data);
  };

  useEffect(() => { fetchFields(); }, [selectedFile, currentPageNum, authState]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => setNumPages(numPages);

  type Point = { x: number; y: number };
  const [action, setAction] = useState<{ type: 'draw' | 'move' | 'resize', start: Point, initBox?: any } | null>(null);
  const [hoverPos, setHoverPos] = useState<Point | null>(null);

  const toPercent = (clientX: number, clientY: number): Point | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const clamp = (v: number) => Math.min(100, Math.max(0, v));
    return { x: Number(clamp(((clientX - rect.left) / rect.width) * 100).toFixed(2)), y: Number(clamp(((clientY - rect.top) / rect.height) * 100).toFixed(2)) };
  };

  const toRect = (a: Point, b: Point) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Number(Math.abs(a.x - b.x).toFixed(2)), height: Number(Math.abs(a.y - b.y).toFixed(2)) });

  const handleContainerMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || activeTab !== 'mapping') return; 
    const pos = toPercent(e.clientX, e.clientY);
    if (!pos) return;
    if (!editingFieldId) setActiveForm(null); 
    setAction({ type: 'draw', start: pos });
  };

  useEffect(() => {
    if (!action || activeTab !== 'mapping') return;
    const onMove = (e: globalThis.MouseEvent) => {
      const current = toPercent(e.clientX, e.clientY);
      if (!current) return;
      setHoverPos(current);
      if (action.type === 'move' && action.initBox) {
        setActiveForm({ x: action.initBox.x + (current.x - action.start.x), y: action.initBox.y + (current.y - action.start.y) });
      } else if (action.type === 'resize' && action.initBox) {
        setFormData(prev => ({ ...prev, width: Math.max(0.5, action.initBox.w + (current.x - action.start.x)), height: Math.max(0.5, action.initBox.h + (current.y - action.start.y)) }));
      }
    };
    const onUp = (e: globalThis.MouseEvent) => {
      const current = toPercent(e.clientX, e.clientY);
      if (action.type === 'draw' && current) {
        const r = toRect(action.start, current);
        if (r.width < 0.5 && r.height < 0.5) setActiveForm({ x: action.start.x, y: action.start.y });
        else { setActiveForm({ x: r.x, y: r.y }); setFormData(prev => ({ ...prev, width: Math.max(r.width, 0.5), height: Math.max(r.height, 0.5) })); }
      }
      setAction(null);
    };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [action, activeTab]);

  const handleMouseLeave = () => { if (!action) setHoverPos(null); };

  const handleEditField = (field: PdfField) => {
    setActiveTab('mapping');
    setEditingFieldId(field.id);
    setActiveForm({ x: field.x_pos, y: field.y_pos });
    setFormData({
      correct_answer: field.correct_answer,
      max_length: field.max_length,
      problem_num: field.problem_num || "",
      video_url: field.video_url || "",
      width: field.width,
      height: field.height,
      field_type: field.field_type || 'input'
    });
  };

  const cancelEdit = () => {
    setEditingFieldId(null); setActiveForm(null);
    setFormData({ correct_answer: "", max_length: 1, problem_num: "", video_url: "", field_type: 'input', ...DEFAULT_BOX });
  };

  const handleReorder = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= currentPageFields.length) return;
    const newList = [...currentPageFields];
    [newList[index], newList[newIndex]] = [newList[newIndex], newList[index]];
    const updates = newList.map((f, i) => ({ id: f.id, display_order: i }));
    setFields(prev => prev.map(f => { const updated = updates.find(u => u.id === f.id); return updated ? { ...f, display_order: updated.display_order } : f; }));
    for (const u of updates) await supabase.from('pdf_fields').update({ display_order: u.display_order }).eq('id', u.id);
  };

  const handleSaveField = async () => {
    if (!activeForm) return;
    const savePayload = {
      pdf_id: selectedFile, page_num: currentPageNum,
      x_pos: activeForm.x, y_pos: activeForm.y,
      width: formData.width, height: formData.height,
      max_length: formData.max_length, correct_answer: formData.field_type === 'video' ? 'VIDEO' : formData.correct_answer,
      problem_num: formData.problem_num, video_url: formData.video_url, field_type: formData.field_type,
    };

    if (editingFieldId) {
      const { data, error } = await supabase.from('pdf_fields').update(savePayload).eq('id', editingFieldId).select().single();
      if (error) { alert("수정 실패: " + error.message); return; }
      if (data) setFields(fields.map(f => f.id === editingFieldId ? (data as PdfField) : f));
    } else {
      const newOrder = currentPageFields.length > 0 ? Math.max(...currentPageFields.map(f => f.display_order || 0)) + 1 : 0;
      const { data, error } = await supabase.from('pdf_fields').insert([{ ...savePayload, display_order: newOrder }]).select().single();
      if (error) { alert("저장 실패: " + error.message); return; }
      if (data) setFields([...fields, data as PdfField]);
    }
    cancelEdit(); 
  };

  const handleDeleteField = async (id: string, e?: React.MouseEvent) => {
    if(e) e.stopPropagation();
    if(!confirm("이 영역을 삭제하시겠습니까?")) return;
    const { error } = await supabase.from('pdf_fields').delete().eq('id', id);
    if (error) { alert("삭제 실패: " + error.message); return; }
    setFields(fields.filter(field => field.id !== id));
    setSelectedIds(prev => prev.filter(x => x !== id)); 
    if (editingFieldId === id) cancelEdit();
  };

  const handleSaveConceptVideo = async () => {
    if (!conceptForm.video_url) return alert("영상 링크를 입력해주세요.");
    const payload = { pdf_id: selectedFile, ...conceptForm };
    const { data, error } = await supabase.from('pdf_concept_videos').insert([payload]).select().single();
    if (error) return alert("저장 실패: " + error.message);
    setConceptVideos([...conceptVideos, data]);
    setConceptForm({ start_page: currentPageNum, end_page: currentPageNum, video_url: "" });
  };

  const handleDeleteConceptVideo = async (id: string) => {
    if(!confirm("이 구간의 개념 영상을 삭제하시겠습니까?")) return;
    await supabase.from('pdf_concept_videos').delete().eq('id', id);
    setConceptVideos(conceptVideos.filter(v => v.id !== id));
  };

  const handleBulkApply = async () => {
    if (selectedIds.length === 0) return;
    const { error } = await supabase.from('pdf_fields').update({ problem_num: bulkProblemNum }).in('id', selectedIds);
    if (error) { alert("일괄 적용 실패: " + error.message); return; }
    setFields(fields.map(f => selectedIds.includes(f.id) ? { ...f, problem_num: bulkProblemNum } : f));
    setSelectedIds([]); setBulkProblemNum("");
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if(!confirm(`선택한 ${selectedIds.length}개의 영역을 일괄 삭제하시겠습니까?`)) return;
    const { error } = await supabase.from('pdf_fields').delete().in('id', selectedIds);
    if (error) { alert("삭제 실패: " + error.message); return; }
    setFields(fields.filter(f => !selectedIds.includes(f.id)));
    setSelectedIds([]);
    if (editingFieldId && selectedIds.includes(editingFieldId)) cancelEdit();
  };

  const currentPageFields = fields.filter((f) => f.page_num === currentPageNum).sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || new Date(a.created_at || "").getTime() - new Date(b.created_at || "").getTime());
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.checked) setSelectedIds(currentPageFields.map(f => f.id)); else setSelectedIds([]); };

  if (authState === "LOADING") return <div className="flex h-screen items-center justify-center bg-slate-100 font-bold text-slate-500">권한 확인 중...</div>;
  if (authState === "UNAUTHENTICATED") {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 font-pretendard">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-xl w-96 flex flex-col gap-4 border border-slate-200">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-brand mb-2 mx-auto shadow-md"><span className="font-bold text-2xl text-white">L</span></div>
          <h1 className="text-xl font-bold text-center text-slate-800 mb-4">관리자 로그인</h1>
          <input type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full p-3 border border-slate-300 rounded-lg outline-none" />
          <input type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full p-3 border border-slate-300 rounded-lg outline-none" />
          <button type="submit" className="w-full bg-brand text-white font-bold py-3 rounded-lg mt-2">로그인</button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-100 font-pretendard">
      <div className="flex-[7] p-8 flex flex-col items-center overflow-y-auto custom-scrollbar">
        <div className="mb-6 flex items-center justify-between w-full max-w-[800px] bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-3">
            <label className="text-sm font-bold text-slate-700">교재 선택:</label>
            <select value={selectedFile} onChange={(e) => setSelectedFile(e.target.value)} className="border border-slate-300 rounded p-1.5 text-sm font-bold min-w-[200px] outline-none">
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
          <div className="relative inline-block mt-4 select-none" onMouseLeave={handleMouseLeave}>
            <PdfViewerWithOverlay file={pdfUrl} pageNumber={currentPageNum} width={800} onLoadSuccess={onDocumentLoadSuccess}>
              <div ref={containerRef} onMouseDown={handleContainerMouseDown} className={`absolute inset-0 z-10 ${activeTab === 'mapping' ? 'cursor-crosshair' : 'cursor-default pointer-events-none'}`}>
                
                {activeTab === 'mapping' && currentPageFields.map((field) => {
                  if (field.id === editingFieldId) return null; 
                  const isSelected = selectedIds.includes(field.id);
                  const isSelectType = field.field_type === 'select';
                  const isVideoType = field.field_type === 'video';

                  return (
                    <div 
                      key={field.id} 
                      onMouseDown={(e) => { e.stopPropagation(); handleEditField(field); }} 
                      className={`absolute flex flex-col items-center justify-center font-bold text-sm shadow-sm cursor-pointer transition-all pointer-events-auto ${
                        isSelected ? "bg-indigo-500/20 border-2 border-indigo-600 text-indigo-900 ring-2 ring-indigo-400/50 scale-105 z-20" : isSelectType ? "bg-emerald-500/10 border-2 border-emerald-500 text-emerald-900 hover:bg-emerald-500/30" : isVideoType ? "bg-amber-500/90 text-white rounded-lg shadow-md hover:bg-amber-400" : "bg-blue-500/10 border-2 border-blue-600 text-blue-900 hover:bg-blue-500/30"
                      }`} 
                      style={{ left: `${field.x_pos}%`, top: `${field.y_pos}%`, width: `${field.width}%`, height: `${field.height}%` }}
                    >
                      {field.problem_num && !isVideoType && <span className={`absolute -top-3 left-1/2 -translate-x-1/2 text-xs text-white px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap ${isSelected ? 'bg-indigo-600' : isSelectType ? 'bg-emerald-500' : 'bg-blue-600'}`}>문 {field.problem_num}</span>}
                      <span>{isVideoType ? '▶️' : isSelectType ? (field.correct_answer === 'O' ? '⭕' : '❌') : field.correct_answer}</span>
                    </div>
                  );
                })}
                
                {activeForm && activeTab === 'mapping' && (
                  <div 
                    className={`absolute border-[3px] z-30 flex items-center justify-center shadow-lg pointer-events-auto ${formData.field_type === 'select' ? 'border-emerald-500 bg-emerald-500/10' : formData.field_type === 'video' ? 'bg-amber-500/80 text-white rounded-lg border-none' : 'border-rose-500 bg-rose-500/10'} ${action?.type === 'move' ? 'cursor-grabbing' : 'cursor-grab'}`} 
                    style={{ left: `${activeForm.x}%`, top: `${activeForm.y}%`, width: `${formData.width}%`, height: `${formData.height}%` }}
                    onMouseDown={(e) => {
                      e.stopPropagation(); 
                      const pos = toPercent(e.clientX, e.clientY);
                      if (pos) setAction({ type: 'move', start: pos, initBox: { x: activeForm.x, y: activeForm.y } });
                    }}
                  >
                    {formData.problem_num && formData.field_type !== 'video' && <span className={`absolute -top-4 left-1/2 -translate-x-1/2 text-xs text-white font-bold px-2 py-0.5 rounded shadow-sm whitespace-nowrap pointer-events-none ${formData.field_type === 'select' ? 'bg-emerald-500' : 'bg-rose-500'}`}>문 {formData.problem_num}</span>}
                    <span className={`font-bold text-lg pointer-events-none select-none ${formData.field_type === 'select' ? 'text-emerald-700 opacity-60' : formData.field_type === 'video' ? 'text-white' : 'text-rose-500 opacity-60'}`}>
                      {formData.field_type === 'video' ? '▶️' : formData.field_type === 'select' ? (formData.correct_answer === 'O' ? '⭕' : '❌') : formData.correct_answer}
                    </span>
                    <div 
                      className={`absolute -bottom-2 -right-2 w-4 h-4 bg-white border-2 rounded-full cursor-nwse-resize shadow-sm ${formData.field_type === 'select' ? 'border-emerald-500 hover:bg-emerald-100' : formData.field_type === 'video' ? 'border-amber-500 hover:bg-amber-100' : 'border-rose-500 hover:bg-rose-100'}`}
                      onMouseDown={(e) => { e.stopPropagation(); const pos = toPercent(e.clientX, e.clientY); if (pos) setAction({ type: 'resize', start: pos, initBox: { w: formData.width, h: formData.height, x: activeForm.x, y: activeForm.y } }); }}
                    />
                  </div>
                )}
                {action?.type === 'draw' && hoverPos && activeTab === 'mapping' && (
                  <div className="absolute bg-rose-500/20 border-2 border-dashed border-rose-600 pointer-events-none" style={{ left: `${Math.min(action.start.x, hoverPos.x)}%`, top: `${Math.min(action.start.y, hoverPos.y)}%`, width: `${Math.abs(action.start.x - hoverPos.x)}%`, height: `${Math.abs(action.start.y - hoverPos.y)}%` }} />
                )}
              </div>
            </PdfViewerWithOverlay>
          </div>
        ) : (
          <div className="flex items-center justify-center w-[800px] h-[1130px] border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 text-slate-400 font-bold">선택된 교재가 없습니다.</div>
        )}
      </div>

      <div className="flex-[3] bg-white border-l border-slate-200 p-6 flex flex-col shadow-xl z-10 min-w-[380px]">
        <div className="flex justify-between items-center mb-4">
          <div className="flex gap-2">
            <button onClick={() => setActiveTab('mapping')} className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${activeTab === 'mapping' ? 'bg-brand text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>✏ 매핑</button>
            <button onClick={() => setActiveTab('concept')} className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${activeTab === 'concept' ? 'bg-amber-500 text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>📺 개념 영상</button>
          </div>
          <button onClick={handleLogout} className="text-xs font-bold text-slate-400 hover:text-rose-500">로그아웃</button>
        </div>

        {activeTab === 'mapping' ? (
          <>
            {activeForm ? (
              <div className={`border rounded-xl p-5 mb-6 shadow-sm ${editingFieldId ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
                
                <div className="flex flex-wrap gap-3 mb-4 pb-4 border-b border-slate-200">
                  <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 cursor-pointer">
                    <input type="radio" value="input" checked={formData.field_type === 'input'} onChange={() => setFormData({...formData, field_type: 'input', correct_answer: ''})} className="accent-blue-600 w-4 h-4" /> ✍️ 숫자
                  </label>
                  <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 cursor-pointer">
                    <input type="radio" value="select" checked={formData.field_type === 'select'} onChange={() => setFormData({...formData, field_type: 'select', correct_answer: 'O', max_length: 1})} className="accent-emerald-500 w-4 h-4" /> 👆 선택
                  </label>
                  <label className="flex items-center gap-1.5 text-sm font-bold text-amber-700 cursor-pointer bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    <input type="radio" value="video" checked={formData.field_type === 'video'} onChange={() => setFormData({...formData, field_type: 'video', correct_answer: 'VIDEO', max_length: 1})} className="accent-amber-500 w-4 h-4" /> 🎬 영상 버튼
                  </label>
                </div>
                
                {formData.field_type !== 'video' && (
                  <label className="block mb-3">
                    <span className="text-sm font-bold text-slate-700">정답</span>
                    {formData.field_type === 'select' ? (
                      <div className="flex gap-2 mt-1">
                        <button onClick={() => setFormData({...formData, correct_answer: 'O'})} className={`flex-1 py-2 rounded-lg font-bold border ${formData.correct_answer === 'O' ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-white text-slate-400 border-slate-200'}`}>⭕ 정답 보기</button>
                        <button onClick={() => setFormData({...formData, correct_answer: 'X'})} className={`flex-1 py-2 rounded-lg font-bold border ${formData.correct_answer === 'X' ? 'bg-rose-500 text-white border-rose-600' : 'bg-white text-slate-400 border-slate-200'}`}>❌ 오답 보기</button>
                      </div>
                    ) : (
                      <input type="text" autoFocus value={formData.correct_answer} onChange={(e) => setFormData({ ...formData, correct_answer: e.target.value, max_length: e.target.value.length || 1 })} className="mt-1 block w-full rounded-md border-slate-300 p-2 border outline-none focus:border-blue-500" placeholder="예: 400" />
                    )}
                  </label>
                )}

                <label className="block mb-3">
                  <span className="text-sm font-bold text-slate-700 flex items-center gap-1">문제 번호 (그룹 매핑용)</span>
                  <input type="text" value={formData.problem_num} onChange={(e) => setFormData({ ...formData, problem_num: e.target.value })} className="mt-1 block w-full rounded-md border-slate-300 p-2 border outline-none bg-yellow-50 focus:border-yellow-500" placeholder="예: 2, 2-1" />
                </label>

                {/* 영상 버튼일 경우 링크 입력란을 강조 */}
                <label className="block mb-4">
                  <span className={`text-sm font-bold flex justify-between items-end ${formData.field_type === 'video' ? 'text-amber-700' : 'text-slate-700'}`}>
                    <span>{formData.field_type === 'video' ? '🎬 실행할 영상 링크 URL' : '해설 영상 링크 (선택)'}</span>
                  </span>
                  <input type="text" value={formData.video_url} onChange={(e) => setFormData({ ...formData, video_url: e.target.value })} className={`mt-1 block w-full text-xs rounded-md border p-2 outline-none ${formData.field_type === 'video' ? 'border-amber-400 bg-amber-50 focus:ring-2 focus:ring-amber-300' : 'border-slate-300 focus:border-indigo-400'}`} placeholder="https://youtube.com/watch?v=..." />
                </label>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <label className="block"><span className="text-sm font-bold text-slate-700">너비(%)</span><input type="number" step="0.1" value={formData.width} onChange={(e) => setFormData({ ...formData, width: Number(e.target.value) })} className="mt-1 block w-full rounded-md border-slate-300 p-2 border outline-none" /></label>
                  <label className="block"><span className="text-sm font-bold text-slate-700">높이(%)</span><input type="number" step="0.1" value={formData.height} onChange={(e) => setFormData({ ...formData, height: Number(e.target.value) })} className="mt-1 block w-full rounded-md border-slate-300 p-2 border outline-none" /></label>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={handleSaveField} className={`flex-[2] text-white font-bold py-2.5 rounded-lg shadow-md ${editingFieldId ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-brand hover:bg-blue-900'}`}>{editingFieldId ? '수정 완료' : '저장'}</button>
                  <button onClick={cancelEdit} className="flex-1 bg-white border border-slate-300 text-slate-600 font-bold py-2.5 rounded-lg hover:bg-slate-50">취소</button>
                </div>
              </div>
            ) : (
              <div className="bg-slate-100 border border-slate-200 border-dashed rounded-xl p-8 text-center text-slate-400 font-bold mb-6">좌측 PDF에서 빈칸을 그리거나,<br />등록된 박스를 클릭해 수정/이동하세요.</div>
            )}

            <div className="mb-2">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <input type="checkbox" checked={selectedIds.length === currentPageFields.length && currentPageFields.length > 0} onChange={handleSelectAll} className="w-4 h-4 rounded cursor-pointer accent-indigo-600" />
                  <span>전체 선택 ({currentPageFields.length})</span>
                </h3>
              </div>
              {selectedIds.length > 0 && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 mb-3 flex flex-col gap-2">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-xs font-bold text-indigo-700">✓ {selectedIds.length}개 선택됨</span>
                    <button onClick={handleBulkDelete} className="text-xs font-bold text-rose-500 hover:underline">선택 일괄 삭제</button>
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={bulkProblemNum} onChange={(e) => setBulkProblemNum(e.target.value)} placeholder="문제 번호 일괄 부여" className="flex-1 text-sm p-1.5 border border-indigo-200 rounded outline-none" />
                    <button onClick={handleBulkApply} className="text-xs bg-indigo-600 text-white font-bold px-3 py-1.5 rounded">적용</button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-lg bg-slate-50 p-2 custom-scrollbar">
              {currentPageFields.map((f, i) => {
                const isSelectType = f.field_type === 'select';
                const isVideoType = f.field_type === 'video';
                return (
                  <div key={f.id} onClick={() => handleEditField(f)} className={`p-3 border rounded-md mb-2 shadow-sm cursor-pointer ${editingFieldId === f.id ? 'bg-indigo-100 border-indigo-300' : 'bg-white hover:bg-slate-50'}`}>
                    <div className="flex justify-between items-start">
                      <div className="flex gap-3 items-center">
                        <input type="checkbox" checked={selectedIds.includes(f.id)} onChange={(e) => { e.stopPropagation(); e.target.checked ? setSelectedIds([...selectedIds, f.id]) : setSelectedIds(selectedIds.filter(id => id !== f.id))}} className="w-4 h-4 accent-indigo-600" />
                        <div>
                          <div className="text-sm font-bold flex items-center gap-1.5">
                            {isVideoType ? <span className="text-xs bg-amber-500 text-white px-1.5 py-0.5 rounded shadow-sm">▶️ 영상 버튼</span> : isSelectType ? <span className="text-xs bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded">선택형</span> : <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">입력형</span>}
                            {f.problem_num ? <span className="text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">문 {f.problem_num}</span> : <span className="text-xs bg-rose-100 text-rose-500 px-1.5 py-0.5 rounded border border-rose-200">번호 없음</span>}
                          </div>
                          {!isVideoType && <div className="text-sm font-bold text-slate-700 mt-1">정답: {isSelectType ? (f.correct_answer === 'O' ? '⭕ 정답' : '❌ 오답') : f.correct_answer}</div>}
                          {f.video_url && <div className="text-xs text-indigo-500 mt-1 font-bold">🔗 {f.video_url.substring(0, 30)}...</div>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 items-end">
                        <button onClick={(e) => handleDeleteField(f.id, e)} className="text-slate-400 hover:text-rose-500 p-1">🗑</button>
                        <div className="flex gap-1 bg-slate-100 rounded">
                          <button onClick={(e) => { e.stopPropagation(); handleReorder(i, 'up'); }} disabled={i===0} className="px-1.5 text-xs text-slate-400 hover:text-indigo-600 disabled:opacity-20">▲</button>
                          <button onClick={(e) => { e.stopPropagation(); handleReorder(i, 'down'); }} disabled={i===currentPageFields.length-1} className="px-1.5 text-xs text-slate-400 hover:text-indigo-600 disabled:opacity-20">▼</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="bg-amber-50 border border-amber-200 p-5 rounded-xl mb-6 shadow-sm">
              <h3 className="font-bold text-amber-800 text-sm mb-3">📺 페이지 구간별 개념 영상 등록</h3>
              <div className="flex items-center gap-2 mb-3">
                <input type="number" value={conceptForm.start_page} onChange={e => setConceptForm({...conceptForm, start_page: Number(e.target.value)})} className="w-16 p-2 border rounded outline-none text-center font-bold text-slate-700" min="1" />
                <span className="text-sm text-slate-500 font-bold">쪽 부터</span>
                <input type="number" value={conceptForm.end_page} onChange={e => setConceptForm({...conceptForm, end_page: Number(e.target.value)})} className="w-16 p-2 border rounded outline-none text-center font-bold text-slate-700" min={conceptForm.start_page} />
                <span className="text-sm text-slate-500 font-bold">쪽 까지</span>
              </div>
              <input type="text" value={conceptForm.video_url} onChange={e => setConceptForm({...conceptForm, video_url: e.target.value})} placeholder="유튜브/영상 링크 URL 입력" className="w-full p-2 border rounded outline-none text-sm mb-3 focus:border-amber-400" />
              <button onClick={handleSaveConceptVideo} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-lg shadow">구간 영상 저장하기</button>
            </div>
            <h3 className="text-sm font-bold text-slate-500 mb-2">등록된 구간 영상 리스트 ({conceptVideos.length})</h3>
            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-lg bg-slate-50 p-2 custom-scrollbar">
              {conceptVideos.map(v => (
                <div key={v.id} className="bg-white p-3 border border-slate-200 rounded-lg mb-2 flex justify-between items-center shadow-sm">
                  <div>
                    <div className="text-xs font-bold text-amber-600 mb-1 bg-amber-100 inline-block px-1.5 py-0.5 rounded">{v.start_page}쪽 ~ {v.end_page}쪽</div>
                    <div className="text-xs text-slate-500 truncate max-w-[200px]">{v.video_url}</div>
                  </div>
                  <button onClick={() => handleDeleteConceptVideo(v.id)} className="text-slate-400 hover:text-rose-500 p-2 bg-slate-50 rounded-lg hover:bg-rose-50">🗑️</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}