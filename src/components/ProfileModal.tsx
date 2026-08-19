// src/components/ProfileModal.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  instId: string;
  instructorName: string;
  isHQ?: boolean; 
}

interface InstructorUpdateData {
  phone: string;
  chat_position: string;
  auto_reply_active: boolean;
  chat_allow_start: string | null;
  chat_allow_end: string | null;
  auto_reply_message: string | null;
  profile_image_url?: string;
}

export default function ProfileModal({ isOpen, onClose, instId, instructorName, isHQ = false }: ProfileModalProps) {
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  
  // 🌟 게스트(체험용) 계정 여부 판별 상태 추가
  const [isGuest, setIsGuest] = useState(false);
  
  const [profileForm, setProfileForm] = useState({ 
    phone: "", 
    password: "", 
    passwordConfirm: "", 
    chatPosition: "", 
    autoActive: false, 
    chatStart: isHQ ? "09:00" : "", 
    chatEnd: isHQ ? "18:00" : "", 
    autoMsg: "" 
  });
  
  const [currentImgUrl, setCurrentImgUrl] = useState("");

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

  const formatPhone = (val: string) => {
    let res = val.replace(/[^0-9]/g, '');
    if (res.length < 4) return res;
    if (res.length < 8) return res.substring(0, 3) + '-' + res.substring(3);
    if (res.length < 12) return res.substring(0, 3) + '-' + res.substring(3, 7) + '-' + res.substring(7);
    return res.substring(0, 3) + '-' + res.substring(3, 7) + '-' + res.substring(7, 11) + '-' + res.substring(11);
  };

  useEffect(() => {
    // 🌟 컴포넌트 마운트 시 권한 확인
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    if (role === 'GUEST' || pos.includes('테스트') || pos.includes('체험')) {
      setIsGuest(true);
    }
  }, []);

  useEffect(() => {
    if (isOpen && instId) {
      setImageSrc(null);
      setPosition({ x: 0, y: 0 });
      setZoom(1);

      setProfileForm({
        phone: "", password: "", passwordConfirm: "", chatPosition: "", autoActive: false, chatStart: "", chatEnd: "", autoMsg: ""
      });

      supabase.from("instructor").select("*").eq("instructor_id", instId).single().then(({ data }) => {
        if (data) {
          setProfileForm({
            phone: data.phone ? formatPhone(data.phone) : "",
            password: "", 
            passwordConfirm: "",
            chatPosition: data.chat_position || "", 
            autoActive: data.auto_reply_active === true, 
            chatStart: data.chat_allow_start || (isHQ ? "09:00" : ""), 
            chatEnd: data.chat_allow_end || (isHQ ? "18:00" : ""), 
            autoMsg: data.auto_reply_message || ""
          });
          setCurrentImgUrl(data.profile_image_url ? (data.profile_image_url.startsWith("http") ? data.profile_image_url : `https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/${data.profile_image_url}`) : "");
        }
      });
    }
  }, [isOpen, instId, isHQ]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setImageSrc(objectUrl);
    setPosition({ x: 0, y: 0 });
    setZoom(1);

    e.target.value = ''; 
  };

  const startDrag = (clientX: number, clientY: number) => {
    setIsDragging(true);
    setDragStart({ x: clientX - position.x, y: clientY - position.y });
  };
  const onDrag = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    setPosition({ x: clientX - dragStart.x, y: clientY - dragStart.y });
  };
  const endDrag = () => setIsDragging(false);

  const getCroppedImageBlob = async (): Promise<Blob | null> => {
    const img = imageRef.current;
    if (!img) return null;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const CANVAS_SIZE = 400; 
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;

    const CONTAINER_SIZE = 160; 
    const ratio = CANVAS_SIZE / CONTAINER_SIZE; 

    const naturalW = img.naturalWidth || 1;
    const naturalH = img.naturalHeight || 1;
    
    const renderW = CONTAINER_SIZE; 
    const renderH = CONTAINER_SIZE * (naturalH / naturalW);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.save();
    ctx.translate(CANVAS_SIZE / 2, CANVAS_SIZE / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(position.x * ratio, position.y * ratio);

    const drawW = renderW * ratio;
    const drawH = renderH * ratio;

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.95);
    });
  };

  const saveProfile = async () => {
    // 🌟 안전장치: 게스트 계정은 저장 함수 실행 원천 차단
    if (isGuest) {
      alert("🔒 체험용(게스트) 계정은 프로필 정보를 수정할 수 없습니다.");
      return;
    }

    setIsSavingProfile(true);
    try {
      if (profileForm.password) {
        if (profileForm.password.length < 6) throw new Error("비밀번호는 최소 6자리 이상이어야 합니다.");
        if (profileForm.password !== profileForm.passwordConfirm) throw new Error("새 비밀번호와 확인 비밀번호가 일치하지 않습니다.");
        
        const { error: authError } = await supabase.auth.updateUser({ password: profileForm.password });
        if (authError) throw new Error(`비밀번호 변경 실패: ${authError.message}`);
      }

      let updateData: InstructorUpdateData = {
        phone: profileForm.phone, 
        chat_position: profileForm.chatPosition, 
        auto_reply_active: profileForm.autoActive,
        chat_allow_start: profileForm.chatStart || null, 
        chat_allow_end: profileForm.chatEnd || null,
        auto_reply_message: profileForm.autoMsg || null
      };

      if (imageSrc) {
        const blob = await getCroppedImageBlob();
        if (!blob) throw new Error("사진 영역을 잡지 못했습니다. 다시 시도해주세요.");

        const fileName = `instructor_${instId}_${Date.now()}.jpg`;
        const { error: uploadErr } = await supabase.storage.from("system_images").upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });
        
        if (uploadErr) throw new Error(`이미지 업로드 실패: ${uploadErr.message}`);
        updateData.profile_image_url = fileName;
      }

      const { error: dbError } = await supabase
        .from("instructor")
        .update(updateData as any)
        .eq("instructor_id", instId);

      if (dbError) throw new Error(`DB 저장 실패: ${dbError.message}`);

      if (profileForm.chatPosition) {
        localStorage.setItem("logica_instructor_position", profileForm.chatPosition);
      }

      alert(profileForm.password ? "기본 정보와 비밀번호가 모두 성공적으로 수정되었습니다." : "정보가 성공적으로 수정되었습니다.");
      onClose();
      window.location.reload(); 
    } catch (e: unknown) { 
      const errorMessage = e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.';
      alert("정보 수정 실패: " + errorMessage); 
    } finally { 
      setIsSavingProfile(false); 
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 allow-guest-interaction">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
          <h2 className="font-bold">{isHQ ? "내 프로필 및 설정" : "선생님 프로필 및 설정"}</h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 text-2xl font-bold transition-colors leading-none">&times;</button>
        </div>
        
        <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); saveProfile(); }} className="p-6 space-y-3 overflow-y-auto custom-scroll flex-1">
          
          <div className="flex flex-col items-center justify-center mb-4 pb-4 border-b border-slate-100">
            {!imageSrc ? (
              <>
                <div className="w-20 h-20 rounded-full bg-slate-100 border-2 border-slate-200 shadow-inner flex items-center justify-center overflow-hidden mb-3 relative">
                  {currentImgUrl ? <img src={currentImgUrl} className="w-full h-full object-cover" alt="current" /> : <span className="text-2xl">👨‍🏫</span>}
                </div>
                {/* 🌟 게스트는 사진 업로드 비활성화 */}
                <label className={`relative overflow-hidden text-[11px] font-bold px-3 py-1.5 rounded transition-colors ${isGuest ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'text-blue-600 bg-blue-50 hover:bg-blue-100 cursor-pointer'}`}>
                  <span className="z-10 relative">사진 변경 및 자르기</span>
                  <input type="file" accept="image/*" disabled={isGuest} className={`absolute inset-0 w-full h-full opacity-0 z-20 ${isGuest ? 'cursor-not-allowed' : 'cursor-pointer'}`} onChange={handleFileChange} />
                </label>
              </>
            ) : (
              <div className="flex flex-col items-center w-full bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-inner">
                <p className="text-[10px] font-bold text-blue-600 mb-2 bg-blue-50 px-2 py-1 rounded-full">👆 끌어서 맞추세요</p>
                <div 
                  className="relative w-[160px] h-[160px] rounded-full overflow-hidden bg-white border-2 border-[#002864] mx-auto cursor-move shadow-sm"
                  style={{ touchAction: 'none' }} 
                  onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
                  onMouseMove={(e) => onDrag(e.clientX, e.clientY)}
                  onMouseUp={endDrag}
                  onMouseLeave={endDrag}
                  onTouchStart={(e) => startDrag(e.touches[0].clientX, e.touches[0].clientY)}
                  onTouchMove={(e) => onDrag(e.touches[0].clientX, e.touches[0].clientY)}
                  onTouchEnd={endDrag}
                >
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30 z-10">
                    <div className="w-full h-[1px] bg-white"></div>
                    <div className="absolute h-full w-[1px] bg-white"></div>
                  </div>
                  <img
                    ref={imageRef}
                    src={imageSrc}
                    alt="crop"
                    className="absolute pointer-events-none max-w-none"
                    style={{ transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${zoom})`, top: '50%', left: '50%', width: '100%' }}
                  />
                </div>
                <div className="w-full mt-4 flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-500 shrink-0">축소</span>
                  <input type="range" min="0.5" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-[#002864] h-1" />
                  <span className="text-[10px] font-bold text-slate-500 shrink-0">확대</span>
                </div>
                <button type="button" onClick={() => { setImageSrc(null); setPosition({x:0, y:0}); setZoom(1); }} className="mt-3 text-[10px] font-bold text-slate-400 hover:text-slate-600 underline">취소</button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">이름 (변경불가)</label>
            <input type="text" value={instructorName} readOnly autoComplete="none" data-lpignore="true" className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-800 bg-slate-100 outline-none cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">내 직책 (채팅 표시용)</label>
            <input 
              type="text" 
              disabled={isGuest}
              value={profileForm.chatPosition} 
              onChange={e => setProfileForm({...profileForm, chatPosition: e.target.value})} 
              placeholder={isHQ ? "예: 팀장, 주임, 연구원" : "예: 원장, 강사"} 
              autoComplete="none" data-lpignore="true"
              className={`w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-sm focus:outline-none focus:border-[#002864] ${isGuest ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white text-slate-800'}`} 
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">연락처</label>
            <input 
              type="text" 
              disabled={isGuest}
              value={profileForm.phone} 
              maxLength={13} 
              onChange={e => setProfileForm({...profileForm, phone: formatPhone(e.target.value)})} 
              autoComplete="none" data-lpignore="true" placeholder="010-0000-0000" 
              className={`w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-sm focus:outline-none focus:border-[#002864] ${isGuest ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white text-slate-800'}`} 
            />
          </div>
          
          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">새 비밀번호 (선택)</label>
              <input 
                type="password" 
                disabled={isGuest}
                value={profileForm.password} 
                onChange={e => setProfileForm({...profileForm, password: e.target.value})} 
                autoComplete="new-password" 
                data-lpignore="true" 
                placeholder="변경할 경우에만 입력하세요 (최소 6자리)" 
                className={`w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-sm focus:outline-none focus:border-[#002864] placeholder-slate-300 ${isGuest ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white text-slate-800'}`} 
              />
            </div>
            {profileForm.password && !isGuest && (
              <div className="animate-[fadeIn_0.2s_ease-out]">
                <label className="block text-xs font-bold text-rose-500 mb-1">새 비밀번호 확인</label>
                <input 
                  type="password" 
                  value={profileForm.passwordConfirm} 
                  onChange={e => setProfileForm({...profileForm, passwordConfirm: e.target.value})} 
                  autoComplete="new-password" 
                  data-lpignore="true" 
                  placeholder="오탈자 방지를 위해 다시 한번 입력하세요" 
                  className={`w-full px-3 py-2 border rounded-lg font-bold text-slate-800 focus:outline-none text-sm placeholder-slate-300 bg-white ${profileForm.password === profileForm.passwordConfirm ? 'border-emerald-500 focus:border-emerald-600 ring-1 ring-emerald-500' : 'border-rose-300 focus:border-rose-500 ring-1 ring-rose-300'}`} 
                />
                {profileForm.passwordConfirm && profileForm.password !== profileForm.passwordConfirm && (
                  <p className="text-[10px] text-rose-500 mt-1 font-bold">비밀번호가 일치하지 않습니다.</p>
                )}
              </div>
            )}
          </div>

          <hr className="border-slate-200 my-4" />
          
          <h3 className="font-bold text-sm text-[#002864] mb-2 flex items-center gap-1">💬 {isHQ ? "부재중 메시지 설정" : "채팅 및 자동응답 설정"}</h3>
          
          <div className={`flex items-center justify-between p-3 rounded-lg border shadow-sm ${isGuest ? 'bg-slate-100 border-slate-200' : 'bg-slate-50 border-slate-200'}`}>
            <div>
              <div className={`font-bold text-sm ${isGuest ? 'text-slate-400' : 'text-slate-700'}`}>자동응답 켜기</div>
              <div className={`text-[10px] ${isGuest ? 'text-slate-400' : 'text-slate-500'}`}>{isHQ ? "업무 시간 외에 부재중 메시지를 전송합니다." : "상담 시간 외에 자동 메시지를 전송합니다."}</div>
            </div>
            <label className={`relative inline-flex items-center ${isGuest ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
              <input type="checkbox" disabled={isGuest} checked={profileForm.autoActive} onChange={e => setProfileForm({...profileForm, autoActive: e.target.checked})} className="sr-only peer" />
              <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">{isHQ ? "업무 시작 시간" : "상담 가능 시작 시간"}</label>
              <input type="time" disabled={isGuest} value={profileForm.chatStart} onChange={e => setProfileForm({...profileForm, chatStart: e.target.value})} className={`w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-sm focus:outline-none focus:border-[#002864] ${isGuest ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white text-slate-800'}`} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">{isHQ ? "업무 종료 시간" : "상담 가능 종료 시간"}</label>
              <input type="time" disabled={isGuest} value={profileForm.chatEnd} onChange={e => setProfileForm({...profileForm, chatEnd: e.target.value})} className={`w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-sm focus:outline-none focus:border-[#002864] ${isGuest ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white text-slate-800'}`} />
            </div>
          </div>
          <div className="mt-2">
            <label className="block text-xs font-bold text-slate-500 mb-1">{isHQ ? "부재중 메시지 내용" : "자동응답 메시지 내용"}</label>
            <textarea 
              rows={2} 
              disabled={isGuest}
              value={profileForm.autoMsg} 
              onChange={e => setProfileForm({...profileForm, autoMsg: e.target.value})} 
              className={`w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-[11px] focus:outline-none focus:border-[#002864] resize-none custom-scroll ${isGuest ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white text-slate-800'}`} 
              placeholder={isHQ ? "현재 본사 업무 시간이 아닙니다. 내일 확인 후 답변드리겠습니다." : "선생님께 메시지가 전달되었습니다. 내일 확인하여 답변드리겠습니다."}>
            </textarea>
          </div>
          
          <button type="submit" className="hidden"></button>
        </form>

        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 font-bold rounded-lg hover:bg-slate-50 transition-colors shadow-sm text-sm">닫기</button>
          <button type="button" onClick={saveProfile} disabled={isSavingProfile || isGuest} className={`px-4 py-2 font-bold rounded-lg transition-colors shadow-sm text-sm ${isGuest ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-[#002864] text-white hover:bg-blue-900 disabled:opacity-50'}`}>
            {isGuest ? "🔒 수정 불가" : isSavingProfile ? "저장 중..." : "정보 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}