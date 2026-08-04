// src/components/TopHeader.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getSecureNotifications } from "@/app/actions/profile";
import { supabase } from "@/lib/supabase";

function DigitalClock() {
  const [time, setTime] = useState<Date | null>(null);
  useEffect(() => {
    setTime(new Date()); 
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!time) return <div className="w-[120px] h-[48px] shrink-0 mr-4"></div>;
  return (
    <div className="shrink-0 mr-5 font-mono text-xl md:text-2xl font-black text-slate-800 bg-slate-100/80 px-4 py-1.5 rounded-xl border border-slate-200 shadow-inner flex items-center justify-center tracking-widest">
      {time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </div>
  );
}

interface TopHeaderProps {
  instId: string;
  instructorName: string;
  profileImgUrl: string;
  isSuperAdmin?: boolean;
  onOpenProfile?: () => void;
  onLogout: () => void;
}

export default function TopHeader({ instId, instructorName, profileImgUrl, isSuperAdmin, onOpenProfile, onLogout }: TopHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [isHeaderExpanded, setIsHeaderExpanded] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isNotiOpen, setIsNotiOpen] = useState(false);
  const [unreadNotiCount, setUnreadNotiCount] = useState(0);

  const [currentUid, setCurrentUid] = useState(instId);
  const [currentName, setCurrentName] = useState(instructorName);
  const [currentProfileImg, setCurrentProfileImg] = useState(profileImgUrl);
  const [imgError, setImgError] = useState(false);

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (profileImgUrl && profileImgUrl !== "null" && profileImgUrl !== "undefined") {
      setCurrentProfileImg(profileImgUrl);
      setImgError(false);
    }
  }, [profileImgUrl]);

  useEffect(() => {
    if (instructorName) setCurrentName(instructorName);
  }, [instructorName]);

  useEffect(() => {
    setImgError(false);
  }, [pathname]);

  useEffect(() => {
    let isMounted = true;
    const verifyAndFetchUserInfo = async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) return; 
      
      if (isMounted) setCurrentUid(user.id);

      const { data: instructorData, error: dbError } = await supabase
        .from('instructor')
        .select('*')
        .eq('instructor_id', user.id)
        .single();

      if (dbError || !instructorData || !isMounted) return;

      if (instructorData.name) {
        setCurrentName((prev) => prev !== instructorData.name ? instructorData.name : prev);
      }
      
      const dbImg = instructorData.profile_img_url || instructorData.profile_image;
      if (dbImg && dbImg !== "null" && dbImg !== "undefined") {
        setCurrentProfileImg((prevImg) => {
          if (prevImg !== dbImg) {
            setImgError(false);
            return dbImg;
          }
          return prevImg;
        });
      }
    };

    verifyAndFetchUserInfo();
    return () => { isMounted = false; };
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!currentUid) return;

    // 💡 권한 로직을 실시간으로 확인 (관리자는 모든 CS 확인 가능)
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const isAdmin = ["SUPER_ADMIN", "ADMIN", "MANAGER", "PRINCIPAL"].includes(role.toUpperCase()) || 
                    ["최고관리자", "대장", "원장", "실장"].some(p => pos.includes(p));

    const clearedStr = localStorage.getItem(`noti_cleared_at_${currentUid}`);
    const clearedTime = clearedStr ? new Date(clearedStr).getTime() : 0;
    const clearedIso = new Date(clearedTime).toISOString();

    const res = await getSecureNotifications(clearedTime);
    let allNotis = res.success && res.notiData ? res.notiData : [];

    // 1. 업무 보드의 '긴급공지' (완료 제외) - 모두에게 보임
    const { data: urgentMemos } = await supabase
      .from("instructor_memo")
      .select("memo_id, author_name, content, created_at, updated_at, status")
      .eq("memo_type", "긴급공지")
      .or(`created_at.gt.${clearedIso},updated_at.gt.${clearedIso}`);

    if (urgentMemos && urgentMemos.length > 0) {
      const activeMemos = urgentMemos.filter(m => m.status !== "완료");
      const memoNotis = activeMemos.map(m => ({
        id: `memo_${m.memo_id}`,
        title: `🚨 긴급공지 (${m.author_name})`,
        time: new Date(m.updated_at || m.created_at), 
        content: m.content,
        link: "/task" 
      }));
      allNotis = [...allNotis, ...memoNotis];
    }

    // 2. 💡 학부모 요청(CS) 로드 (관리자: 모두 / 일반: 본인 배정건만)
    let csQuery = supabase
      .from("parent_request_log")
      .select("request_id, request_type, reason, created_at, updated_at, status, student(name)")
      .or(`created_at.gt.${clearedIso},updated_at.gt.${clearedIso}`);

    // 관리자가 아니면 '내게 배정된 CS'만 필터링
    if (!isAdmin) {
      csQuery = csQuery.eq("processed_instructor_id", currentUid);
    }

    const { data: csLogs } = await csQuery;

    if (csLogs && csLogs.length > 0) {
      const activeCS = csLogs.filter(c => c.status !== "완료");
      const csNotis = activeCS.map((c: any) => {
        const sName = Array.isArray(c.student) ? c.student[0]?.name : c.student?.name;
        return {
          id: `cs_${c.request_id}`,
          title: `👨‍👩‍👧‍👦 CS 요청: ${sName || '알수없음'} 학생 (${c.request_type})`,
          time: new Date(c.updated_at || c.created_at), 
          content: c.reason || "내용 없음",
          link: "/cs"
        };
      });
      allNotis = [...allNotis, ...csNotis];
    }

    // 시간순 정렬 및 반영
    allNotis.sort((a, b) => b.time.getTime() - a.time.getTime());
    setNotifications(allNotis);
    
    setUnreadNotiCount(prev => allNotis.length);
  }, [currentUid]);

  useEffect(() => {
    if (!currentUid) return;

    loadNotifications();

    const notiChannel = supabase.channel('header_noti_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'instructor_memo' }, () => {
        loadNotifications(); 
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parent_request_log' }, () => {
        loadNotifications();
      })
      .subscribe();

    return () => { 
      supabase.removeChannel(notiChannel); 
    };
  }, [currentUid, loadNotifications]);

  const toggleNotiWindow = () => {
    if (!isNotiOpen) loadNotifications(); 
    setIsNotiOpen(!isNotiOpen);
    setUnreadNotiCount(0); 
  };

  const clearNotifications = () => {
    localStorage.setItem(`noti_cleared_at_${currentUid}`, new Date().toISOString());
    setNotifications([]);
    setUnreadNotiCount(0);
    setIsNotiOpen(false);
  };

  const handleSupervisorClick = () => {
    if (isSuperAdmin) {
      router.push('/supervisor');
    } else {
      alert('접근 권한이 없습니다.\n원장 또는 실장 권한만 접속 가능합니다.');
    }
  };

  const handleOpenProfile = async () => {
    if (onOpenProfile) {
      onOpenProfile();
    } else {
      setIsProfileModalOpen(true);
      setImageSrc(null);
      setPosition({ x: 0, y: 0 });
      setZoom(1);

      const { data } = await supabase
        .from('instructor')
        .select('name, phone, email')
        .eq('instructor_id', currentUid)
        .single();
        
      if (data) {
        setEditName(data.name || "");
        setEditPhone(data.phone || "");
        setEditEmail(data.email || "");
      }
    }
  };

  const formatPhone = (val: string) => {
    let res = val.replace(/[^0-9]/g, '');
    if (res.length < 4) return res;
    if (res.length < 8) return res.substring(0, 3) + '-' + res.substring(3);
    if (res.length < 12) return res.substring(0, 3) + '-' + res.substring(3, 7) + '-' + res.substring(7);
    return res.substring(0, 3) + '-' + res.substring(3, 7) + '-' + res.substring(7, 11) + '-' + res.substring(11);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setImageSrc(event.target.result as string);
        setPosition({ x: 0, y: 0 });
        setZoom(1);
      }
    };
    reader.readAsDataURL(file);
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

    const CONTAINER_SIZE = 200; 
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

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName) return alert("이름은 필수 항목입니다.");

    setIsSavingProfile(true);

    try {
      let newImgUrl = currentProfileImg;

      if (imageSrc) {
        const blob = await getCroppedImageBlob();
        if (!blob) throw new Error("사진 영역을 잡지 못했습니다. 사진을 다시 선택해주세요.");
        
        const fileName = `profiles/${currentUid}_${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('system_images')
          .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

        if (uploadError) throw new Error(`사진 업로드 에러: ${uploadError.message}`);
        newImgUrl = fileName;
      }

      if (newPassword) {
        if (newPassword.length < 6) throw new Error("비밀번호는 최소 6자리 이상이어야 합니다.");
        if (newPassword !== confirmPassword) throw new Error("새 비밀번호와 확인 비밀번호가 일치하지 않습니다.");

        const { error: authError } = await supabase.auth.updateUser({ password: newPassword });
        if (authError) throw new Error(`비밀번호 변경 에러: ${authError.message}`);
      }

      const { error: dbError } = await supabase
        .from('instructor')
        .update({ 
          name: editName, 
          phone: editPhone, 
          email: editEmail, 
          profile_img_url: newImgUrl,
          profile_image: newImgUrl 
        })
        .eq('instructor_id', currentUid);

      if (dbError) throw new Error(`기본 정보 업데이트 에러: ${dbError.message}`);

      alert(newPassword ? "정보 및 비밀번호가 성공적으로 변경되었습니다!" : "정보가 성공적으로 변경되었습니다!");
      setIsProfileModalOpen(false);
      setNewPassword("");
      setConfirmPassword("");
      
      if (editName !== currentName) {
        localStorage.setItem("logica_instructor_name", editName);
        setCurrentName(editName); 
      }

      if (imageSrc) {
        setCurrentProfileImg(newImgUrl);
        setImgError(false);
      }

    } catch (error: any) {
      alert(`수정 실패: ${error.message}`);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const getValidImageUrl = (url: string | null | undefined) => {
    if (!url || url === "null" || url === "undefined" || url.trim() === "") return null;
    if (url.startsWith('http')) return url;
    if (url.startsWith('/storage/v1/object/public/')) return `https://kfwlmbwornivkrvoeqdh.supabase.co${url}`;
    const cleanUrl = url.replace(/^system_images\//, '');
    return `https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/${cleanUrl}`;
  };

  const finalProfileImgUrl = getValidImageUrl(currentProfileImg);

  return (
    <>
      <div className={`absolute top-5 right-8 z-[60] flex items-center bg-white/90 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.08)] border border-slate-200 rounded-full transition-all duration-500 ease-out ${isHeaderExpanded ? 'pr-6 pl-2 py-2' : 'px-2 py-2'}`}>
        <button onClick={() => setIsHeaderExpanded(!isHeaderExpanded)} className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
          <svg className={`w-5 h-5 transition-transform duration-500 ${isHeaderExpanded ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
        </button>

        <div className={`relative shrink-0 transition-all duration-500 ${isHeaderExpanded ? 'ml-2' : 'ml-1'}`}>
          <button onClick={toggleNotiWindow} className="w-10 h-10 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors focus:outline-none">
            🔔 {unreadNotiCount > 0 && !isNotiOpen && <span className="absolute top-0 right-0 w-3 h-3 bg-rose-500 rounded-full border-2 border-white"></span>}
          </button>

          {isNotiOpen && (
            <div className="absolute top-14 right-0 w-80 bg-white rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.12)] border border-slate-200 z-[70] flex flex-col overflow-hidden">
              <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center shrink-0">
                <h3 className="font-bold text-slate-800 text-sm">🔔 내 알림 (긴급/배정)</h3>
                <button onClick={() => setIsNotiOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold">&times;</button>
              </div>
              <div className="max-h-[400px] overflow-y-auto custom-scroll p-2 flex flex-col gap-2 bg-white">
                {notifications.length === 0 ? <div className="text-center py-8 text-xs font-bold text-slate-400">새로운 알림이 없습니다.</div> :
                  notifications.map((n, idx) => (
                    <div key={idx} onClick={() => { setIsNotiOpen(false); router.push(n.link); }} className="p-3 border bg-slate-50 text-slate-600 border-slate-200 rounded-lg cursor-pointer hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[11px] font-extrabold">{n.title}</span>
                        <span className="text-[9px] font-bold opacity-70">{n.time.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' })}</span>
                      </div>
                      <div className="text-xs font-medium line-clamp-2 leading-snug">{n.content}</div>
                    </div>
                  ))
                }
              </div>
              <div className="p-2 border-t border-slate-100 bg-slate-50 text-center shrink-0">
                <button onClick={clearNotifications} className="text-[10px] font-bold text-slate-400 hover:text-rose-500 transition-colors">모두 읽음 처리 및 비우기</button>
              </div>
            </div>
          )}
        </div>

        <div className={`flex items-center overflow-hidden transition-all duration-500 ease-in-out ${isHeaderExpanded ? 'max-w-[800px] opacity-100 ml-4 pl-4 border-l border-slate-200' : 'max-w-0 opacity-0 ml-0 pl-0 border-transparent'}`}>
          <DigitalClock />
          <button onClick={handleSupervisorClick} className="shrink-0 mr-5 bg-[#002864] hover:bg-blue-900 text-white border border-blue-800 px-4 py-2 rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5">
            <span className="text-lg">📡</span> 클리닉 관제탑
          </button>

          <div className="w-11 h-11 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shadow-sm shrink-0 mr-3">
            {finalProfileImgUrl && !imgError ? (
              <img src={finalProfileImgUrl} className="w-full h-full object-cover" alt="profile" onError={() => setImgError(true)} />
            ) : (
              <span className="text-lg">👨‍🏫</span>
            )}
          </div>
          
          <div className="flex flex-col text-left shrink-0">
            <p className="font-extrabold text-slate-800 leading-tight truncate">{currentName} 선생님</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] font-bold text-blue-500 cursor-pointer hover:text-blue-700 transition-colors" onClick={handleOpenProfile}>정보수정</span>
              <div className="w-1 h-1 bg-slate-300 rounded-full"></div>
              <span className="text-[10px] font-bold text-slate-400 cursor-pointer hover:text-rose-500 transition-colors" onClick={onLogout}>로그아웃</span>
            </div>
          </div>
        </div>
      </div>

      {isProfileModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-[#002864] shrink-0">
              <h2 className="text-lg font-bold text-white">⚙️ 내 정보 수정</h2>
              <button onClick={() => { setIsProfileModalOpen(false); setNewPassword(""); setConfirmPassword(""); }} className="text-blue-200 hover:text-white text-2xl leading-none transition-colors">&times;</button>
            </div>
            
            <form onSubmit={handleSaveProfile} className="p-6 flex-1 overflow-y-auto custom-scroll space-y-6">
              
              <div className="flex flex-col items-center border-b border-slate-100 pb-6">
                <h3 className="text-sm font-black text-slate-800 mb-4 w-full text-left">프로필 사진</h3>
                
                {!imageSrc ? (
                  <div className="flex flex-col items-center">
                    <div className="w-[160px] h-[160px] rounded-full border border-slate-200 shadow-sm overflow-hidden mb-4 bg-slate-100 flex items-center justify-center">
                      {finalProfileImgUrl && !imgError ? (
                        <img src={finalProfileImgUrl} className="w-full h-full object-cover" alt="current profile" onError={() => setImgError(true)} />
                      ) : (
                        <span className="text-4xl">👨‍🏫</span>
                      )}
                    </div>
                    
                    <label className="relative overflow-hidden cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2.5 px-5 rounded-xl border border-slate-300 transition-colors shadow-sm flex items-center gap-2">
                      <span className="text-base z-10">📸</span> <span className="z-10 relative">새 사진 업로드 및 자르기</span>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" 
                        onChange={handleFileChange} 
                        onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="flex flex-col items-center w-full bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-inner">
                    <p className="text-[11px] font-bold text-blue-600 mb-3 bg-blue-50 px-3 py-1 rounded-full">👆 마우스나 손가락으로 사진을 끌어 맞추세요</p>
                    
                    <div 
                      className="relative w-[200px] h-[200px] rounded-full overflow-hidden bg-white border-4 border-[#002864] mx-auto cursor-move shadow-md"
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
                        style={{
                          transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${zoom})`,
                          top: '50%', left: '50%', width: '100%' 
                        }}
                      />
                    </div>
                    
                    <div className="w-full max-w-[240px] mt-6 flex items-center gap-3 bg-white px-3 py-2.5 rounded-lg border border-slate-200 shadow-sm">
                      <span className="text-xs font-bold text-slate-500 shrink-0">축소</span>
                      <input 
                        type="range" min="0.5" max="3" step="0.05" 
                        value={zoom} onChange={(e) => setZoom(Number(e.target.value))} 
                        className="flex-1 accent-[#002864]" 
                      />
                      <span className="text-xs font-bold text-slate-500 shrink-0">확대</span>
                    </div>

                    <button type="button" onClick={() => { setImageSrc(null); setPosition({x:0, y:0}); setZoom(1); }} className="mt-4 text-[11px] font-bold text-slate-500 hover:text-slate-700 underline underline-offset-2 transition-colors">
                      취소하고 이전 사진 유지
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-4 pb-5 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-800">기본 정보</h3>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">이름</label>
                  <input type="text" required value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-700 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864]" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">연락처</label>
                  <input type="text" value={editPhone} onChange={(e) => setEditPhone(formatPhone(e.target.value))} maxLength={13} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-medium text-slate-700 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864]" placeholder="010-0000-0000" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">이메일</label>
                  <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-medium text-slate-700 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864]" placeholder="email@example.com" />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-black text-slate-800">비밀번호 변경 <span className="text-xs font-normal text-slate-400 ml-1">(선택 사항)</span></h3>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">새 비밀번호</label>
                  <input 
                    type="password" 
                    value={newPassword} 
                    onChange={(e) => setNewPassword(e.target.value)} 
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864]" 
                    placeholder="변경할 경우에만 입력 (최소 6자리)" 
                  />
                </div>
                {newPassword && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">새 비밀번호 확인</label>
                    <input 
                      type="password" 
                      required={!!newPassword}
                      value={confirmPassword} 
                      onChange={(e) => setConfirmPassword(e.target.value)} 
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864]" 
                      placeholder="다시 한번 입력" 
                    />
                  </div>
                )}
              </div>

              <div className="pt-4 shrink-0">
                <button 
                  type="submit" 
                  disabled={isSavingProfile} 
                  className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold py-3.5 rounded-xl shadow-md transition-colors disabled:opacity-50 text-sm"
                >
                  {isSavingProfile ? "업로드 및 저장 중... ⏳" : "수정 내용 적용하기"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}