// src/components/minutes/SimpleEditor.tsx
"use client";

import React, { useEffect, useRef } from "react";

interface SimpleEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export default function SimpleEditor({ value, onChange, placeholder }: SimpleEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.innerHTML) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const exec = (command: string, arg: string | null = null) => {
    document.execCommand(command, false, arg || undefined);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  return (
    <div className="border border-slate-300 rounded-lg overflow-hidden flex flex-col h-full bg-white">
      <div className="bg-slate-50 p-1.5 flex gap-1.5 border-b border-slate-200 flex-wrap shrink-0 items-center">
        <button type="button" onClick={() => exec('bold')} className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded hover:bg-slate-100 font-black shadow-sm text-[#002864] text-xs" title="굵게">B</button>
        <button type="button" onClick={() => exec('italic')} className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded hover:bg-slate-100 italic font-serif shadow-sm text-[#002864] text-xs" title="기울임">I</button>
        <button type="button" onClick={() => exec('underline')} className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded hover:bg-slate-100 underline shadow-sm text-[#002864] text-xs" title="밑줄">U</button>
        <div className="w-px h-4 bg-slate-300 mx-1"></div>
        <button type="button" onClick={() => exec('insertUnorderedList')} className="px-2 h-6 flex items-center justify-center bg-white border border-slate-200 rounded hover:bg-slate-100 text-[10px] font-bold shadow-sm text-[#002864]" title="글머리 기호">목록</button>
        <div className="w-px h-4 bg-slate-300 mx-1"></div>
        <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 cursor-pointer">
          색상
          <input type="color" onChange={(e) => exec('foreColor', e.target.value)} className="w-5 h-5 border-0 p-0 rounded cursor-pointer" />
        </label>
        <select onChange={(e) => exec('fontSize', e.target.value)} className="h-6 px-1 border border-slate-200 rounded bg-white text-[10px] font-bold text-[#002864] shadow-sm focus:outline-none ml-1">
          <option value="2">작게</option>
          <option value="3">보통</option>
          <option value="4">크게</option>
        </select>
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        className="flex-1 p-3 overflow-y-auto custom-scroll outline-none text-[12px] text-slate-800 font-medium prose prose-sm max-w-none"
        style={{ minHeight: "200px" }}
        data-placeholder={placeholder}
      />
    </div>
  );
}