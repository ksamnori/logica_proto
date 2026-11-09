// src/app/exam/step2/RightPreview.tsx
import React, { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { getDiffLabelByRate, getTypeName, getDepth6Name, getSubDepth6Name, formatText, getCleanUrl, isThinking, processGroupText, getDiagnosticMainScore, isSubNumberOnlyText, splitTrailingSubNumberText, stripLeadingSubNumber, ensureLeadingSubNumber } from "./examUtils";

// 🌟 /taxonomy-editor와 동일하게 /api/gemini-twin (PUT) 엔드포인트를 호출하여 SERVICE_ROLE_KEY로 스토리지 업로드 및 DB 저장을 처리하는 내장 헬퍼
async function uploadQuestionImageServerAction(
  imageBase64: string,
  fileName: string,
  contentType: string = "image/png"
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  try {
    const res = await fetch("/api/gemini-twin", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upload_image", imageBase64, fileName, contentType }),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e?.message || "서버 업로드 요청 실패" };
  }
}

async function saveTwinsServerAction(
  twinInserts: any[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch("/api/gemini-twin", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_twins", twinInserts }),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e?.message || "서버 저장 요청 실패" };
  }
}

// 🌟 [핵심 수정] 배열([y1,x1,y2,x2])이나 다중 JSON 문자열 형태도 안전하게 객체로 정규화하는 헬퍼
const parseBoxObject = (box: any): Record<string, any> => {
  if (!box || box === 'null' || box === 'undefined') return {};
  let parsed = box;
  for (let i = 0; i < 4; i++) {
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch(e) { break; }
    } else {
      break;
    }
  }
  if (Array.isArray(parsed)) {
    return { bbox: parsed };
  }
  if (parsed && typeof parsed === 'object') {
    return { ...parsed };
  }
  return {};
};

const getBoxWidthNumber = (box: any, defaultWidth: number = 100): number => {
  const obj = parseBoxObject(box);
  if (obj.width !== undefined && obj.width !== null) {
    const w = Number(obj.width);
    if (!isNaN(w)) {
      if (w >= 10 && w <= 100) return Math.round(w);
      if (w > 0 && w <= 1) return Math.max(20, Math.round(w * 100));
    }
  }
  return defaultWidth;
};

const setBoxWidthJson = (box: any, widthVal: number): string => {
  const obj = parseBoxObject(box);
  const clamped = Math.max(20, Math.min(100, Math.round(Number(widthVal) || 100)));
  return JSON.stringify({ ...obj, width: clamped });
};

// 🌟 [핵심 수정] 배율이 없을 때 100%로 늘어나서 '거인증'이 생기는 것을 막기 위해 기본값을 'auto'로 변경
const getBoxWidth = (box: any) => {
  const obj = parseBoxObject(box);
  if (obj.width !== undefined && obj.width !== null) {
    const w = Number(obj.width);
    if (!isNaN(w)) {
      if (w >= 10 && w <= 100) return `${w}%`;
      if (w > 0 && w <= 1) return `${Math.max(20, Math.round(w * 100))}%`;
    }
  }
  return 'auto';
};

export default function RightPreview({ examData }: { examData: any }) {
  const {
    router, questions, setQuestions, isLoading, showAnswer, setShowAnswer,
    depth6Map, editingId, setEditingId, editForm, setEditForm,
    handleDragStart, handleDragOver, handleDrop, openTwinSearch, goToStep3,
    hiddenImageIds, toggleHideImage,
    draggedIdx, setDraggedIdx,
    isClinicMode, isRestoredMode
  } = examData;

  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [previewBadge, setPreviewBadge] = useState<string | null>(null);

  const [hideSubNumber, setHideSubNumber] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("examHideSubNumber") === "1";
    }
    return false;
  });
  const toggleHideSubNumber = () => {
    setHideSubNumber((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        sessionStorage.setItem("examHideSubNumber", next ? "1" : "0");
      }
      return next;
    });
  };
  const [previewSearch, setPreviewSearch] = useState("");

  const [isTwinModalOpen, setIsTwinModalOpen] = useState(false);
  const [isGeneratingTwins, setIsGeneratingTwins] = useState(false);
  const [generatedTwins, setGeneratedTwins] = useState<any[]>([]);
  const [aiTargetInfo, setAiTargetInfo] = useState<{ idx: number, subIdx: number, q: any } | null>(null);
  const [isSavingTwin, setIsSavingTwin] = useState(false);
  const [twinAiModel, setTwinAiModel] = useState<"gemini-3.8-flash" | "gemini-4-argon">("gemini-3.8-flash");
  const [twinTargetBook, setTwinTargetBook] = useState<string>("");
  const [similarTargetBook, setSimilarTargetBook] = useState<string>("");
  const [parentBookName, setParentBookName] = useState<string>("");
  const [replaceTwinIdx, setReplaceTwinIdx] = useState<number | null>(0);

  const [hasTwinPerm, setHasTwinPerm] = useState(false);

  useEffect(() => {
    const checkTwinPermission = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'VICE_ADMIN' || ["최고관리자", "대장", "원장", "부원장"].some(p => pos.includes(p))) {
        setHasTwinPerm(true);
        return;
      }

      if (tId && role) {
        const { data } = await supabase.from('tenant_role_permissions').select('allowed_menus').eq('tenant_id', tId).eq('role_name', role).single();
        if (data?.allowed_menus?.includes("action_generate_twins_exam")) {
          setHasTwinPerm(true);
        } else {
          setHasTwinPerm(false);
        }
      }
    };
    checkTwinPermission();
  }, []);

  useEffect(() => {
    const examMode = sessionStorage.getItem("examMode"); 
    const testCategory = sessionStorage.getItem("testCategory");
    const storedTitle = sessionStorage.getItem("examTitle");
    const storedBadge = sessionStorage.getItem("examSubTitle");

    if (isClinicMode) {
      setPreviewTitle(storedTitle || "오답 클리닉 문항");
      setPreviewBadge(storedBadge || "맞춤형 클리닉");
    } else if (isRestoredMode) {
      setPreviewTitle(storedTitle || "출제 문항 미리보기");
      setPreviewBadge(storedBadge || "편집 모드");
    } else if (examMode === "test" && testCategory) {
      setPreviewTitle(`[${testCategory}] 출제 문항`);
      setPreviewBadge("테스트 전용");
    } else if (examMode === "regular" || examMode === "thinking") {
      setPreviewTitle(storedTitle || "신규 출제 시험지");
      setPreviewBadge(examMode === "regular" ? "정규 교과" : "사고력 교과");
    } else {
      setPreviewTitle(storedTitle || "출제 문항 미리보기");
      setPreviewBadge(storedBadge || "편집 모드");
    }
  }, [questions, isClinicMode, isRestoredMode]);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).MathJax?.typesetPromise) {
      setTimeout(() => {
        (window as any).MathJax.typesetPromise().catch(() => {});
      }, 50);
    }
  }, [draggedIdx, dragOverIdx, generatedTwins, isTwinModalOpen, hideSubNumber]);

  const forceMathRefresh = () => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise) {
      mj.typesetClear();
      mj.typesetPromise().catch((err: any) => console.error("MathJax 강제 새로고침 에러:", err));
    }
  };

  const startEditing = (q: any) => {
    const img1Obj = parseBoxObject(q.image_box);
    const img2Obj = parseBoxObject(q.image_2_box);
    setEditingId(q.question_id);
    setEditForm({
      question: q.question || '', question_2: q.question_2 || '', answer: q.answer || '', explanation: q.explanation || '', solution: q.solution || '',
      step_1_concept: q.step_1_concept || '', step_2_approach: q.step_2_approach || '', step_3_process: q.step_3_process || '', step_4_conclusion: q.step_4_conclusion || '',
      // 🌟 이미지 URL과 박스(배율) 데이터 추가 로드 (배열/다중 문자열도 안전하게 객체 JSON으로 변환)
      image_url: q.image_url || '', image_2_url: q.image_2_url || '',
      image_box: Object.keys(img1Obj).length > 0 ? JSON.stringify(img1Obj) : '',
      image_2_box: Object.keys(img2Obj).length > 0 ? JSON.stringify(img2Obj) : '',
    });
  };

  const saveEdit = async () => {
    try {
      const realId = editingId?.includes('_added_') ? editingId.split('_added_')[0] : editingId;
      
      // 🌟 DB 스키마에 맞춰 박스 데이터 파싱 처리 (배열/다중 문자열 안전 변환)
      const img1Obj = parseBoxObject(editForm.image_box);
      const img2Obj = parseBoxObject(editForm.image_2_box);
      const parsedImgBox = Object.keys(img1Obj).length > 0 ? img1Obj : null;
      const parsedImg2Box = Object.keys(img2Obj).length > 0 ? img2Obj : null;

      const updateData = {
        ...editForm,
        image_box: parsedImgBox,
        image_2_box: parsedImg2Box ? JSON.stringify(parsedImg2Box) : null,
      };

      const { error } = await supabase.from('question_db').update(updateData).eq('question_id', realId);
      if (error) throw error;
      
      setQuestions((prev: any) => prev.map((g: any) => ({
        ...g, items: g.items.map((item: any) => (item.question_id === editingId || item.question_id === realId) ? { ...item, ...updateData } : item)
      })));
      alert("✅ 수정 및 이미지 배율이 데이터베이스에 완벽하게 반영되었습니다!");
      setEditingId(null);
    } catch(e: any) { alert("❌ 저장 실패: " + e.message); }
  };

  const unmergeGroup = (groupId: string) => {
    if (!confirm("병합을 해제하여 각 문항을 독립적으로 분리하시겠습니까?")) return;
    setQuestions((prev: any[]) => {
      const newQs: any[] = [];
      for (const g of prev) {
        if (g.id === groupId) {
          if (g.items.length > 1) {
            g.items.forEach((item: any, i: number) => {
              newQs.push({
                id: `unmerged_${Date.now()}_${item.question_id}_${i}`,
                is_group: false,
                is_merged_text: false,
                items: [item],
                sort_order: g.sort_order + (i * 0.01)
              });
            });
          } else {
             newQs.push({ ...g, is_merged_text: false });
          }
        } else {
          newQs.push(g);
        }
      }
      return newQs;
    });
  };

  // 🌟 SVG 벡터 코드를 고해상도(300 DPI급) PNG Blob으로 변환하여 Supabase Storage(question_images)에 자동 업로드하는 헬퍼 (/taxonomy-editor와 동일)
  const uploadSvgAsPngToStorage = async (svgRaw: string, prefix: string): Promise<string | null> => {
    if (!svgRaw || typeof svgRaw !== "string" || !svgRaw.includes("<svg")) return null;
    try {
      let cleanSvg = svgRaw.trim();
      const svgMatch = cleanSvg.match(/<svg[\s\S]*<\/svg>/i);
      if (svgMatch) cleanSvg = svgMatch[0];
      if (!cleanSvg.includes("xmlns=")) {
        cleanSvg = cleanSvg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      }

      let baseW = 800;
      let baseH = 380;
      const vbMatch = cleanSvg.match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)\s*["']/i);
      if (vbMatch) {
        const w = parseFloat(vbMatch[3]);
        const h = parseFloat(vbMatch[4]);
        if (w > 0 && h > 0) {
          baseW = w;
          baseH = h;
        }
      }

      const scale = 3; // 3배수 고해상도 렌더링 (인쇄 품질)
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(baseW * scale);
      canvas.height = Math.round(baseH * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      const svgBlob = new Blob([cleanSvg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      const rendered = await new Promise<{ blob: Blob | null; dataUrl: string }>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          const dUrl = canvas.toDataURL("image/png", 1.0);
          canvas.toBlob((b) => resolve({ blob: b, dataUrl: dUrl }), "image/png", 1.0);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({ blob: null, dataUrl: "" });
        };
        img.src = url;
      });

      if (!rendered.dataUrl && !rendered.blob) return null;

      const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfwlmbwornivkrvoeqdh.supabase.co";

      // 1차: 서버 액션(SERVICE_ROLE_KEY)을 통해 RLS 정책과 무관하게 안전 업로드
      if (rendered.dataUrl) {
        const serverRes = await uploadQuestionImageServerAction(rendered.dataUrl, fileName, "image/png");
        if (serverRes.success && serverRes.publicUrl) {
          return serverRes.publicUrl;
        }
      }

      // 2차 폴백: 클라이언트 직접 업로드
      if (rendered.blob) {
        const { error } = await supabase.storage
          .from("question_images")
          .upload(fileName, rendered.blob, { contentType: "image/png" });
        if (!error) {
          return `${baseUrl}/storage/v1/object/public/question_images/${fileName}`;
        }
        console.warn("SVG->PNG 스토리지 업로드 경고:", error.message);
      }
      return null;
    } catch (e) {
      console.error("SVG 렌더링/업로드 오류:", e);
      return null;
    }
  };

  const getBaseBookName = (q: any): string => {
    const raw = String(q?.source_book_name || q?.book_name || q?.pdf_source || "기본교재").trim();
    return raw.replace(/\s*(쌍둥이|유사)$/, "").trim() || "기본교재";
  };

  const openAiTwinModal = async (idx: number, subIdx: number, q: any) => {
    const targetObj = { idx, subIdx, q };
    setAiTargetInfo(targetObj);
    setGeneratedTwins([]);
    setTwinAiModel("gemini-3.8-flash");
    setReplaceTwinIdx(0);

    const baseBook = getBaseBookName(q);
    setTwinTargetBook(`${baseBook} 쌍둥이`);
    setSimilarTargetBook(`${baseBook} 유사`);
    setParentBookName("");
    setIsTwinModalOpen(true);

    // 부모 문항이 있는 경우 부모 교재명을 조회하여 드롭다운 선택지에 추가
    const rawPid = q?.parent_question_id;
    if (rawPid && String(rawPid).trim() !== "" && String(rawPid).trim().toLowerCase() !== "null") {
      const cleanPid = String(rawPid).trim().replace(/_added_\d+$/, "");
      supabase
        .from("question_db")
        .select("source_book_name, book_name")
        .eq("question_id", cleanPid)
        .maybeSingle()
        .then(({ data: pData }) => {
          const pBook = String(pData?.source_book_name || pData?.book_name || "").trim();
          if (pBook && pBook !== baseBook) {
            setParentBookName(pBook);
          }
        });
    }

    // 모달 오픈과 동시에 기본 모델(gemini-3.8-flash)로 쌍둥이/유사 자동 생성 시작
    await handleTriggerAIGeneration("gemini-3.8-flash", targetObj);
  };

  const handleManualCreate = () => {
    setGeneratedTwins([
      {
        question_type: "쌍둥이",
        question: aiTargetInfo?.q.question || "",
        question_2: aiTargetInfo?.q.question_2 || "",
        answer: aiTargetInfo?.q.answer || "",
        step_1_concept: aiTargetInfo?.q.step_1_concept || "",
        step_2_approach: aiTargetInfo?.q.step_2_approach || "",
        step_3_process: aiTargetInfo?.q.step_3_process || "",
        step_4_conclusion: aiTargetInfo?.q.step_4_conclusion || "",
        svg_code: "",
        answer_svg_code: "",
        isSelected: true,
        isPreviewMode: false,
      },
      {
        question_type: "유사",
        question: aiTargetInfo?.q.question || "",
        question_2: aiTargetInfo?.q.question_2 || "",
        answer: aiTargetInfo?.q.answer || "",
        step_1_concept: aiTargetInfo?.q.step_1_concept || "",
        step_2_approach: aiTargetInfo?.q.step_2_approach || "",
        step_3_process: aiTargetInfo?.q.step_3_process || "",
        step_4_conclusion: aiTargetInfo?.q.step_4_conclusion || "",
        svg_code: "",
        answer_svg_code: "",
        isSelected: true,
        isPreviewMode: false,
      },
    ]);
    setReplaceTwinIdx(0);
  };

  const handleTriggerAIGeneration = async (
    modelOverride?: "gemini-3.8-flash" | "gemini-4-argon",
    targetOverride?: { idx: number; subIdx: number; q: any }
  ) => {
    const activeTarget = targetOverride || aiTargetInfo;
    if (!activeTarget) return;

    const targetModel: "gemini-3.8-flash" | "gemini-4-argon" =
      modelOverride === "gemini-4-argon" ? "gemini-4-argon" : "gemini-3.8-flash";

    setTwinAiModel(targetModel);
    setIsGeneratingTwins(true);
    setGeneratedTwins([]);

    try {
      const targetQ = activeTarget.q;
      const taxStr = getDepth6Name(targetQ, depth6Map) || targetQ.taxonomy_name || "분류 정보 없음";

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/gemini-twin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          originalQuestion: targetQ.question,
          originalQuestion2: targetQ.question_2 || "",
          originalAnswer: targetQ.answer,
          taxonomyStr: taxStr,
          step1Concept: targetQ.step_1_concept || "",
          step2Approach: targetQ.step_2_approach || "",
          step3Process: targetQ.step_3_process || "",
          step4Conclusion: targetQ.step_4_conclusion || "",
          imageUrl: targetQ.image_url ? getCleanUrl(targetQ.image_url) : "",
          image2Url: targetQ.image_2_url ? getCleanUrl(targetQ.image_2_url) : "",
          answerImageUrl: targetQ.answer_image_url ? getCleanUrl(targetQ.answer_image_url) : "",
          modelName: targetModel,
        }),
      });

      const contentType = res.headers.get("content-type");
      if (!res.ok || !contentType?.includes("application/json")) {
        throw new Error(`AI 서버 연결 오류 (${res.status})`);
      }

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const cleanedTwins = data.data.map((twin: any, idx: number) => ({
        ...twin,
        question: twin.question?.replace(/\\\\(?=[a-zA-Z])/g, "\\"),
        question_2: (twin.question_2 ?? targetQ.question_2 ?? "")?.replace(/\\\\(?=[a-zA-Z])/g, "\\") || "",
        answer: twin.answer?.replace(/\\\\(?=[a-zA-Z])/g, "\\"),
        step_1_concept: twin.step_1_concept?.replace(/\\\\(?=[a-zA-Z])/g, "\\"),
        step_2_approach: twin.step_2_approach?.replace(/\\\\(?=[a-zA-Z])/g, "\\"),
        step_3_process: twin.step_3_process?.replace(/\\\\(?=[a-zA-Z])/g, "\\"),
        step_4_conclusion: twin.step_4_conclusion?.replace(/\\\\(?=[a-zA-Z])/g, "\\"),
        svg_code: twin.svg_code || "",
        answer_svg_code: twin.answer_svg_code || "",
        isSelected: true,
        isPreviewMode: true,
        question_type: twin.question_type || (idx === 0 ? "쌍둥이" : "유사"),
      }));

      setGeneratedTwins(cleanedTwins);
      setReplaceTwinIdx(0);
    } catch (e: any) {
      console.error(e);
      alert("AI 쌍둥이/유사 생성 중 오류 발생: " + e.message);
    } finally {
      setIsGeneratingTwins(false);
    }
  };

  const handleTwinChange = (index: number, field: string, value: any) => {
    setGeneratedTwins((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const saveTwinAndReplace = async () => {
    if (!aiTargetInfo) return;
    const selectedTwinsToSave = generatedTwins.filter((t) => t.isSelected !== false);
    if (selectedTwinsToSave.length === 0) {
      return alert("저장할 문항을 하나 이상 체크박스에서 선택해주세요.");
    }

    const twinCount = selectedTwinsToSave.filter((t) => t.question_type !== "유사").length;
    const similarCount = selectedTwinsToSave.filter((t) => t.question_type === "유사").length;

    const preferredTwin =
      replaceTwinIdx !== null &&
      generatedTwins[replaceTwinIdx] &&
      generatedTwins[replaceTwinIdx].isSelected !== false
        ? generatedTwins[replaceTwinIdx]
        : null;

    const replaceLabel = preferredTwin
      ? `\n📌 현재 시험지 문항 교체: [${preferredTwin.question_type === "유사" ? "유사 문항" : "쌍둥이 문항"}]으로 즉시 교체`
      : `\n📌 현재 시험지 문항 교체: 교체 안 함 (마스터 DB에만 저장)`;

    let confirmMsg = `선택된 ${selectedTwinsToSave.length}개의 문항을 저장하시겠습니까?`;
    if (twinCount > 0 && similarCount > 0) {
      confirmMsg = `쌍둥이 ${twinCount}개 ➔ [${twinTargetBook}]\n유사 ${similarCount}개 ➔ [${similarTargetBook}]${replaceLabel}\n\n위 설정대로 실행하시겠습니까?`;
    } else if (twinCount > 0) {
      confirmMsg = `쌍둥이 ${twinCount}개 ➔ [${twinTargetBook}]${replaceLabel}\n\n위 설정대로 실행하시겠습니까?`;
    } else if (similarCount > 0) {
      confirmMsg = `유사 ${similarCount}개 ➔ [${similarTargetBook}]${replaceLabel}\n\n위 설정대로 실행하시겠습니까?`;
    }

    if (!confirm(confirmMsg)) return;

    setIsSavingTwin(true);
    try {
      const generateUUID = () => {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
          const r = (Math.random() * 16) | 0,
            v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      };

      const targetQ = aiTargetInfo.q;
      const currentRealId = String(targetQ.question_id).replace(/_added_\d+$/, "");

      // 선택한 문항이 이미 부모를 가진 자식 문항이라면 최상위 루트 부모 ID를 찾아 형제 문항으로 편입 (/taxonomy-editor와 동일)
      let targetParentId = currentRealId;
      const rawPid = targetQ.parent_question_id;
      if (rawPid && String(rawPid).trim() !== "" && String(rawPid).trim().toLowerCase() !== "null") {
        let currPid = String(rawPid).trim().replace(/_added_\d+$/, "");
        const visited = new Set<string>();
        while (currPid && !visited.has(currPid.toLowerCase())) {
          visited.add(currPid.toLowerCase());
          const { data: pRow } = await supabase
            .from("question_db")
            .select("question_id, parent_question_id")
            .eq("question_id", currPid)
            .maybeSingle();
          if (
            pRow &&
            pRow.parent_question_id &&
            String(pRow.parent_question_id).trim() !== "" &&
            String(pRow.parent_question_id).trim().toLowerCase() !== "null"
          ) {
            currPid = String(pRow.parent_question_id).trim();
          } else {
            break;
          }
        }
        targetParentId = currPid;
      }

      // 기존 형제 문항 번호(-T1, -S1 등)를 조회하여 중복 없는 다음 순번 자동 부여
      const baseQNum = String(targetQ.question_number || "NEW").replace(/-[TS]\d+$/i, "");
      const { data: existingSiblings } = await supabase
        .from("question_db")
        .select("question_number")
        .eq("parent_question_id", targetParentId);

      let maxT = 0;
      let maxS = 0;
      (existingSiblings || []).forEach((sib: any) => {
        const qn = String(sib.question_number || "");
        const mT = qn.match(/-T(\d+)$/i);
        if (mT) maxT = Math.max(maxT, parseInt(mT[1], 10) || 0);
        const mS = qn.match(/-S(\d+)$/i);
        if (mS) maxS = Math.max(maxS, parseInt(mS[1], 10) || 0);
      });

      let tCount = maxT + 1;
      let sCount = maxS + 1;

      const twinInserts: any[] = [];
      let replacementUiData: any = null;

      // 사용자가 시험지 교체 체크박스를 켠 문항이 있을 때만 교체 대상으로 지정 (체크 해제 시 null -> 시험지 교체 안 함)

      for (const twin of selectedTwinsToSave) {
        const targetBook = twin.question_type === "유사" ? similarTargetBook : twinTargetBook;
        const suffix = twin.question_type === "유사" ? `S${sCount++}` : `T${tCount++}`;
        const newQId = generateUUID();

        // 새로 생성된 SVG 도형/그래프 코드가 있으면 300DPI PNG로 렌더링 후 Supabase Storage에 자동 업로드
        let finalImg1Url = targetQ.image_url || null;
        let finalImg2Url = targetQ.image_2_url || null;
        let finalAnsImgUrl = targetQ.answer_image_url || null;

        if (twin.svg_code && String(twin.svg_code).includes("<svg")) {
          const uploadedProblemImg = await uploadSvgAsPngToStorage(twin.svg_code, `twin_${newQId}_core`);
          if (uploadedProblemImg) {
            if (!targetQ.image_url && targetQ.image_2_url) {
              finalImg2Url = uploadedProblemImg;
            } else {
              finalImg1Url = uploadedProblemImg;
            }
          }
        }

        if (twin.answer_svg_code && String(twin.answer_svg_code).includes("<svg")) {
          const uploadedAnsImg = await uploadSvgAsPngToStorage(twin.answer_svg_code, `twin_${newQId}_sol`);
          if (uploadedAnsImg) {
            finalAnsImgUrl = uploadedAnsImg;
          }
        }

        const dbRow = {
          question_id: newQId,
          parent_question_id: targetParentId,
          source_book_name: targetBook,
          book_name: targetBook,
          pdf_source: targetQ.pdf_source || null,
          detected_page_num: targetQ.detected_page_num || 0,
          final_printed_page: targetQ.final_printed_page,
          question_number: `${baseQNum}-${suffix}`,
          sub_num: targetQ.sub_num || 0,
          question: twin.question,
          question_2:
            twin.question_2 !== undefined && twin.question_2 !== ""
              ? twin.question_2
              : targetQ.question_2 || null,
          answer: twin.answer,
          step_1_concept: twin.step_1_concept,
          step_2_approach: twin.step_2_approach,
          step_3_process: twin.step_3_process,
          step_4_conclusion: twin.step_4_conclusion,
          taxonomy_id: targetQ.taxonomy_id,
          taxonomy_name: targetQ.taxonomy_name || null,
          sub_taxonomy_id: targetQ.sub_taxonomy_id || null,
          sub_taxonomy_name: targetQ.sub_taxonomy_name || null,
          thk_taxonomy_id: targetQ.thk_taxonomy_id || null,
          thk_taxonomy_name: targetQ.thk_taxonomy_name || null,
          difficulty: targetQ.difficulty || "중",
          options: targetQ.options || null,
          is_new_trend: targetQ.is_new_trend || false,
          ai_gradable: targetQ.ai_gradable,
          is_human_verified: true,
          problem_type: targetQ.problem_type || null,
          derivation_type: twin.question_type === "유사" ? "유사" : "TWIN",
          image_url: finalImg1Url,
          image_2_url: finalImg2Url,
          answer_image_url: finalAnsImgUrl,
          answer_image_2_url: targetQ.answer_image_2_url || null,
          image_box: targetQ.image_box,
          image_2_box: targetQ.image_2_box,
          answer_image_box: targetQ.answer_image_box,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        twinInserts.push(dbRow);

        if (preferredTwin && twin === preferredTwin) {
          replacementUiData = { ...targetQ, ...dbRow };
        }
      }

      // 1차: 서버 액션(SERVICE_ROLE_KEY)으로 question_db 및 textbook_question 일괄 저장
      const srvSave = await saveTwinsServerAction(twinInserts);
      const uniqueBooks = Array.from(new Set(twinInserts.map((q) => q.source_book_name)));

      if (!srvSave.success) {
        // 2차 폴백: 클라이언트 직접 저장
        const { error } = await supabase.from("question_db").insert(twinInserts);
        if (error) throw new Error(srvSave.error || error.message);

        for (const book of uniqueBooks) {
          const { data: tb } = await supabase
            .from("textbook")
            .select("book_id")
            .eq("title", book)
            .maybeSingle();
          if (tb) {
            const tqInserts = twinInserts
              .filter((q) => q.source_book_name === book)
              .map((q) => ({
                book_id: tb.book_id,
                question_id: q.question_id,
                page_number: q.final_printed_page || 999,
                question_number: q.question_number,
                question: q.question,
                answer: q.answer,
                taxonomy_id: q.taxonomy_id,
                taxonomy_name: q.taxonomy_name || null,
                sub_taxonomy_id: q.sub_taxonomy_id || null,
                sub_taxonomy_name: q.sub_taxonomy_name || null,
                thk_taxonomy_id: q.thk_taxonomy_id || null,
                thk_taxonomy_name: q.thk_taxonomy_name || null,
                question_category: "일반",
              }));
            await supabase.from("textbook_question").insert(tqInserts);
          }
        }
      }

      if (targetQ.exam_item_id && replacementUiData) {
        await supabase
          .from("exam_item")
          .update({ question_id: replacementUiData.question_id })
          .eq("exam_item_id", targetQ.exam_item_id);
      }

      if (replacementUiData) {
        setQuestions((prev: any[]) => {
          const newQs = [...prev];
          const group = { ...newQs[aiTargetInfo.idx] };
          group.items = [...group.items];
          group.items[aiTargetInfo.subIdx] = replacementUiData;
          newQs[aiTargetInfo.idx] = group;
          return newQs;
        });
      }

      if (replacementUiData) {
        alert(
          `✅ 선택된 ${twinInserts.length}개의 문항이 DB에 저장되었으며, [${
            preferredTwin?.question_type === "유사" ? "유사 문항" : "쌍둥이 문항"
          }]으로 현재 시험지 문항이 교체되었습니다!`
        );
      } else {
        alert(
          `✅ 선택된 ${twinInserts.length}개의 문항이 마스터 DB에 저장되었습니다! (현재 시험지 문항은 그대로 유지됩니다.)`
        );
      }
      setIsTwinModalOpen(false);
      setTwinAiModel("gemini-3.8-flash");
    } catch (err: any) {
      alert("❌ 교체 및 저장 중 에러가 발생했습니다: " + err.message);
    } finally {
      setIsSavingTwin(false);
    }
  };

  return (
    <section className="flex-1 flex flex-col relative bg-slate-100 min-w-0">
      <div className="bg-white px-6 py-4 border-b border-slate-200 shrink-0 flex justify-between items-center shadow-sm z-10">
        <div>
          <h2 className="font-extrabold text-xl text-slate-800 flex items-center"><span className="mr-2">📝</span> 시험지 미리보기</h2>
          {(previewTitle || previewBadge) && (
             <div className="flex items-center gap-2 mt-1.5 animate-[fadeIn_0.3s_ease-out]">
               {previewBadge && <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded shadow-sm">{previewBadge}</span>}
               {previewTitle && <span className="text-[13px] font-bold text-slate-600">{previewTitle}</span>}
             </div>
          )}
        </div>
        <div className="flex space-x-2 items-center">
          
          <button 
            onClick={toggleHideSubNumber} 
            className={`flex items-center gap-1.5 px-4 py-2 font-bold text-[13px] rounded-lg transition-colors border shadow-sm ${hideSubNumber ? 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100' : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'}`}
            title="병합된 서브문항 앞에 (1), (2) 꼬리번호를 자동으로 붙여서 표시하거나 숨깁니다."
          >
            {hideSubNumber ? '🙈 (1) 서브번호 숨김 중' : '🔢 (1) 서브번호 표시 중'}
          </button>

          <button onClick={forceMathRefresh} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-lg transition-colors border border-slate-300">
            <span>🔄</span> 수식 깨짐 해결
          </button>
          
          {!isClinicMode && !isRestoredMode && (
             <button onClick={() => router.push('/exam/step1')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-lg transition-colors border border-slate-300">⟵ Step 1 가기</button>
          )}
          <button onClick={() => setShowAnswer(!showAnswer)} className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg transition-colors border border-blue-200">정답/해설 보기</button>
          <button onClick={goToStep3} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-md">Step 3. 배포 ➔</button>
        </div>
      </div>

      <div className="bg-white/95 border-b border-slate-200 px-6 py-2.5 shrink-0 flex items-center gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={previewSearch}
            onChange={(e) => setPreviewSearch(e.target.value)}
            placeholder="🔍 문제 텍스트, 정답, 해설, 출처 교재, 페이지, 단원/유형 검색..."
            className="w-full px-3.5 py-2 pr-8 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-brand focus:ring-1 focus:ring-brand transition-all"
          />
          {previewSearch && (
            <button
              onClick={() => setPreviewSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
              title="검색어 지우기"
            >
              ✕
            </button>
          )}
        </div>
        {previewSearch.trim() && (
          <span className="text-xs font-bold text-brand shrink-0">
            검색 결과 표시 중
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 pb-32 space-y-6 scroll-smooth" id="right-problem-list">
        {isLoading ? <div className="text-center font-bold text-slate-500 mt-20 flex flex-col items-center"><svg className="animate-spin h-12 w-12 text-[#002864] mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p>DB에서 문제를 추출 중입니다...</p></div> : 
         questions.map((g: any, idx: number) => ({ g, idx })).filter(({ g, idx }: { g: any; idx: number }) => {
           const kw = previewSearch.trim().toLowerCase();
           if (!kw) return true;
           const repQ = g.items[0];
           const d6 = String(getDepth6Name(repQ, depth6Map) || "").toLowerCase();
           const subD6 = String(getSubDepth6Name(repQ, depth6Map) || "").toLowerCase();
           const tName = String(getTypeName(repQ) || "").toLowerCase();
           const numStr = `${idx + 1}번`;
           const itemMatch = g.items.some((q: any) => {
             const txt = String(q.question || q.text_question || "").toLowerCase();
             const ans = String(q.answer || "").toLowerCase();
             const exp = String(q.explanation || q.solution || "").toLowerCase();
             const bk = String(q.source_book_name || q.book_name || q.pdf_source || "").toLowerCase();
             const pg = String(q.final_printed_page || q.detected_page_num || "").toLowerCase();
             const qn = String(q.question_number || "").toLowerCase();
             const tax = String(q.taxonomy_id || "").toLowerCase();
             const subTax = String(q.sub_taxonomy_id || "").toLowerCase();
             const taxName = String(q.taxonomy_name || "").toLowerCase();
             const subTaxName = String(q.sub_taxonomy_name || "").toLowerCase();
             return txt.includes(kw) || ans.includes(kw) || exp.includes(kw) || bk.includes(kw) || pg.includes(kw) || qn.includes(kw) || tax.includes(kw) || subTax.includes(kw) || taxName.includes(kw) || subTaxName.includes(kw);
           });
           return itemMatch || d6.includes(kw) || subD6.includes(kw) || tName.includes(kw) || numStr.includes(kw);
         }).map(({ g, idx }: { g: any; idx: number }) => {
           const qNum = idx + 1;
           const repQ = g.items[0];
           const isThk = isThinking(repQ);
           const depth6Name = getDepth6Name(repQ, depth6Map);
           const subDepth6Name = repQ.sub_taxonomy_id && repQ.sub_taxonomy_id !== repQ.taxonomy_id ? getSubDepth6Name(repQ, depth6Map) : ""; 
           const diffLabel = (repQ.difficulty || getDiffLabelByRate(repQ.solving_probability)).trim();
           const rateVal = repQ.solving_probability != null ? Math.round(repQ.solving_probability) + '%' : '-';
           const typeName = getTypeName(repQ);
           
           const isEditingMode = g.items.some((q: any) => editingId === q.question_id);
           const isDragged = draggedIdx === idx;
           const isDragOverTarget = dragOverIdx === idx && draggedIdx !== idx;

           let cardClass = "rounded-xl shadow-sm overflow-hidden flex flex-row group transition-colors duration-200 border-2 ";
           if (isDragged) cardClass += "opacity-40 border-dashed border-[#002864] bg-slate-50 ";
           else if (isDragOverTarget) cardClass += "border-emerald-400 bg-emerald-50/50 z-20 shadow-md ";
           else cardClass += "bg-white border-slate-200 hover:border-blue-400 ";

           if (!isEditingMode) cardClass += "cursor-grab active:cursor-grabbing ";

           let diffColor = "text-blue-500 bg-blue-50 border-blue-100";
           if (diffLabel === '최하') diffColor = "text-slate-500 bg-slate-100 border-slate-200";
           else if (diffLabel === '하') diffColor = "text-sky-500 bg-sky-50 border-sky-100";
           else if (diffLabel === '상') diffColor = "text-indigo-500 bg-indigo-50 border-indigo-100";
           else if (diffLabel === '최상') diffColor = "text-rose-500 bg-rose-50 border-rose-100";

           const isGroupMerged = g.items.length > 1;
           const { common, remainders } = isGroupMerged ? processGroupText(g.items) : { common: "", remainders: [] };
           const isDiagPreview = typeof window !== "undefined" && (sessionStorage.getItem("testCategory") === "진단평가" || sessionStorage.getItem("testCategory") === "입학테스트" || sessionStorage.getItem("examType") === "입학테스트");
           const mainScoreVal = isDiagPreview ? getDiagnosticMainScore(idx) : Math.round((100 / (questions.length || 1)) * 10) / 10;
           const subScoreVal = Math.round((mainScoreVal / (g.items.length || 1)) * 100) / 100;

           return (
             <div key={g.id} id={`problem-card-${idx}`} 
               draggable={!isEditingMode}
               onDragStart={(e) => { if(!isEditingMode) handleDragStart(e, idx); }}
               onDragEnd={() => { setDragOverIdx(null); setDraggedIdx(null); }}
               onDragEnter={(e) => { e.preventDefault(); if (draggedIdx !== null && draggedIdx !== idx) setDragOverIdx(idx); }}
               onDragOver={(e) => { e.preventDefault(); handleDragOver(e); }}
               onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { if (dragOverIdx === idx) setDragOverIdx(null); } }}
               onDrop={(e) => { setDragOverIdx(null); handleDrop(e, idx); }}
               className={cardClass}
             >
               <div className="w-[64px] flex flex-col items-center py-5 shrink-0 gap-1.5 border-r border-slate-200 relative pointer-events-none" style={{ backgroundColor: isDragOverTarget ? 'transparent' : '#f8fafc' }}>
                 <span className="font-lexend font-black text-[22px] text-slate-800 mb-1 mt-2">{qNum}</span>
                 <span className="text-[11px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded w-[48px] text-center tracking-tighter mb-0.5" title="대문항 총 배점">{mainScoreVal}점</span>
                 <span className={`text-[11px] font-bold border px-1 py-0.5 rounded w-[45px] text-center tracking-tighter ${diffColor}`}>{diffLabel}</span>
                 {isThk && <span className="text-[10px] font-bold text-indigo-500 bg-white border border-indigo-200 px-1 py-0.5 rounded w-[45px] text-center tracking-tighter">사고력</span>}
                 <span className="text-[11px] font-bold text-slate-500 bg-white border border-slate-200 px-1 py-0.5 rounded w-[45px] text-center tracking-tighter">{rateVal}</span>
                 <span className="text-[11px] font-bold text-slate-500 bg-white border border-slate-200 px-1 py-0.5 rounded w-[45px] text-center tracking-tighter">{typeName}</span>
                 {(repQ.is_new_trend === true || repQ.is_new_trend === 'Y') && <span className="text-[10px] font-bold text-rose-500 bg-white border border-rose-200 px-1 py-0.5 rounded w-[45px] text-center tracking-tighter">신경향</span>}
               </div>
               
               <div className="flex-1 flex flex-col relative p-5 min-w-0">
                 <div className="flex justify-between items-center mb-1.5 pointer-events-none">
                   <div className="flex items-center gap-2 flex-wrap">
                     <span className={`text-[14px] font-bold ${isDragOverTarget ? 'text-emerald-700' : 'text-slate-600'}`}>{depth6Name}</span>
                     {subDepth6Name && (
                       <span className="text-[11px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">🧭 서브: {subDepth6Name}</span>
                     )}
                   </div>
                 </div>
                 
                 {isGroupMerged && common && !isEditingMode && (
                   <div className="font-myungjo font-semibold text-[16px] text-slate-800 leading-[2.2] tracking-wide break-keep pointer-events-none mb-4" dangerouslySetInnerHTML={{ __html: formatText(common) }} />
                 )}

                 {g.items.map((q: any, subIdx: number) => {
                   const isEditing = editingId === q.question_id;
                   
                   let textToRender = (isGroupMerged && common && remainders[subIdx] !== undefined) ? remainders[subIdx] : (q.question || q.text_question || '');
                   const rawQ2Str = (q.question_2 && String(q.question_2).trim() !== '' && String(q.question_2) !== 'null' && String(q.question_2) !== 'undefined')
                     ? String(q.question_2)
                     : '';
                   let q2ToRender = rawQ2Str;

                   const isTwin = q.problem_type === '쌍둥이' || q.derivation_type === 'TWIN' || q.derivation_type === '쌍둥이';
                   const isSimilar = q.problem_type === '유사' || q.derivation_type === '유사';
                   const realQId = String(q.question_id).replace(/_added_\d+$/, '');
                   const hasImg1 = Boolean(q.image_url && String(q.image_url).trim() !== '' && String(q.image_url) !== 'null' && String(q.image_url) !== 'undefined');
                   const hasImg2 = Boolean(q.image_2_url && String(q.image_2_url).trim() !== '' && String(q.image_2_url) !== 'null' && String(q.image_2_url) !== 'undefined');
                   const bothImgsExist = hasImg1 && hasImg2;
                   const isImg1Hidden = Boolean(hiddenImageIds && (hiddenImageIds.has(`${realQId}__img1`) || hiddenImageIds.has(realQId)));
                   const isImg2Hidden = Boolean(hiddenImageIds && (hiddenImageIds.has(`${realQId}__img2`) || hiddenImageIds.has(realQId)));
                   const showImg1 = hasImg1 && !isImg1Hidden;
                   const showImg2 = hasImg2 && !isImg2Hidden;
                   const hasVisibleImg = showImg1 || showImg2;

                   if (!isEditing) {
                     if (hideSubNumber) {
                       if (textToRender) textToRender = stripLeadingSubNumber(textToRender);
                       if (q2ToRender) q2ToRender = stripLeadingSubNumber(q2ToRender);
                     } else if (isGroupMerged) {
                       const subNumber = subIdx + 1;
                       if (textToRender && String(textToRender).trim() !== '') {
                         textToRender = ensureLeadingSubNumber(textToRender, subNumber);
                       } else if (q2ToRender && String(q2ToRender).trim() !== '') {
                         q2ToRender = ensureLeadingSubNumber(q2ToRender, subNumber);
                       } else if (hasVisibleImg) {
                         textToRender = `(${subNumber})`;
                       }
                     }
                   }

                   const splitSubInfo = hasVisibleImg
                     ? splitTrailingSubNumberText(textToRender)
                     : { isTrailingSubNum: false, introText: textToRender, subMarkerText: "" };
                   const isNumberOnlySub = splitSubInfo.isTrailingSubNum;

                   return (
                     <div key={q.question_id} className={`relative ${subIdx < g.items.length - 1 ? 'mb-8 pb-8 border-b-2 border-dashed border-slate-200' : ''}`}>
                       <div className="flex justify-between items-start mb-0">
                         <div className="flex-1 flex items-center pointer-events-none mb-2">
                           <div className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
                             <span className="bg-slate-100 text-slate-500 px-1.5 py-[2px] rounded border border-slate-200 leading-none">출처</span>
                             <span className="leading-none mt-0.5 flex items-center">
                               {isTwin && <span className="text-fuchsia-600 font-black mr-1.5">[쌍둥이]</span>}
                               {isSimilar && <span className="text-amber-600 font-black mr-1.5">[유사]</span>}
                               {q.source_book_name || q.book_name || q.pdf_source || '출처 정보 없음'}
                               {q.final_printed_page || q.detected_page_num ? ` p.${String(q.final_printed_page || q.detected_page_num).replace(/p/gi, '').trim()}` : ''}
                               {q.question_number ? ` ${String(q.question_number).replace(/번/g, '').trim()}${q.sub_num && String(q.sub_num) !== '0' ? `-${q.sub_num}` : ''}번` : ''}
                             </span>
                             {g.items.length > 1 && (
                               <span className="ml-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-[2px] rounded text-[10px] font-extrabold leading-none">
                                 서브문항 ({subIdx + 1}) · 배점 {subScoreVal}점 (1/{g.items.length})
                               </span>
                             )}
                           </div>
                         </div>
                         
                         <div className="flex gap-1.5 shrink-0 z-10 relative ml-2" onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }} draggable>
                           {hasImg1 && (
                             <button
                               onClick={() => toggleHideImage && toggleHideImage(q.question_id, 1)}
                               className={`px-2 py-1 text-[11px] font-bold rounded border shadow-sm transition-colors flex items-center gap-1 ${
                                 isImg1Hidden
                                   ? 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100'
                                   : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-indigo-600'
                               }`}
                               title={isImg1Hidden ? `클릭하면 숨겨진 ${bothImgsExist ? '이미지 1을' : '이미지를'} 다시 표시합니다` : `클릭하면 원본 DB에서 삭제하지 않고 이번 시험지에서만 ${bothImgsExist ? '이미지 1을' : '이미지를'} 숨깁니다`}
                             >
                               {isImg1Hidden ? (bothImgsExist ? '👁️ 이미지 1 표시' : '👁️ 이미지 표시') : (bothImgsExist ? '🙈 이미지 1 숨김' : '🙈 이미지 숨김')}
                             </button>
                           )}
                           {hasImg2 && (
                             <button
                               onClick={() => toggleHideImage && toggleHideImage(q.question_id, 2)}
                               className={`px-2 py-1 text-[11px] font-bold rounded border shadow-sm transition-colors flex items-center gap-1 ${
                                 isImg2Hidden
                                   ? 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100'
                                   : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-indigo-600'
                               }`}
                               title={isImg2Hidden ? `클릭하면 숨겨진 ${bothImgsExist ? '이미지 2를' : '이미지를'} 다시 표시합니다` : `클릭하면 원본 DB에서 삭제하지 않고 이번 시험지에서만 ${bothImgsExist ? '이미지 2를' : '이미지를'} 숨깁니다`}
                             >
                               {isImg2Hidden ? (bothImgsExist ? '👁️ 이미지 2 표시' : '👁️ 이미지 표시') : (bothImgsExist ? '🙈 이미지 2 숨김' : '🙈 이미지 숨김')}
                             </button>
                           )}
                           {isGroupMerged && subIdx === 0 && (
                             <button onClick={() => unmergeGroup(g.id)} className="p-1.5 text-slate-400 hover:text-indigo-600 bg-white border border-slate-200 rounded shadow-sm" title="병합 해제">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"></path></svg>
                             </button>
                           )}
                           <button onClick={() => startEditing(q)} className="p-1.5 text-slate-400 hover:text-amber-600 bg-white border border-slate-200 rounded shadow-sm" title="수정"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                           <button onClick={() => { if(confirm("문항을 시험지에서 삭제하시겠습니까?")) setQuestions(questions.map((gItem:any) => gItem.id === g.id ? { ...gItem, items: gItem.items.filter((i:any) => i.question_id !== q.question_id) } : gItem).filter((gItem:any) => gItem.items.length > 0)); }} className="p-1.5 text-slate-400 hover:text-rose-600 bg-white border border-slate-200 rounded shadow-sm" title="삭제"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                         </div>
                       </div>

                       {!isEditing ? (
                         <>
                           <div className="flex gap-1.5 items-start mt-0">
                             <div className="flex-1 space-y-3">
                               {((hasImg1 && isImg1Hidden) || (hasImg2 && isImg2Hidden)) && (
                                 <div className="flex flex-wrap gap-2">
                                   {hasImg1 && isImg1Hidden && (
                                     <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 border border-dashed border-slate-300 rounded-lg text-xs font-bold text-slate-500">
                                       <span>🙈 {bothImgsExist ? '이미지 1' : '이미지'} 숨김 처리됨 (Step 3 미노출)</span>
                                     </div>
                                   )}
                                   {hasImg2 && isImg2Hidden && (
                                     <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 border border-dashed border-slate-300 rounded-lg text-xs font-bold text-slate-500">
                                       <span>🙈 {bothImgsExist ? '이미지 2' : '이미지'} 숨김 처리됨 (Step 3 미노출)</span>
                                     </div>
                                   )}
                                 </div>
                               )}
                               {isNumberOnlySub ? (
                                 <div className="flex flex-col gap-3 w-full">
                                   {splitSubInfo.introText && (
                                     <div className="font-myungjo font-semibold text-[16px] text-slate-800 leading-[2.2] tracking-wide break-keep pointer-events-none" dangerouslySetInnerHTML={{ __html: formatText(splitSubInfo.introText) }} />
                                   )}
                                   {showImg1 && showImg2 && (
                                     <div className="w-full flex justify-center my-1">
                                       <img src={getCleanUrl(q.image_url)} 
                                            className="max-w-full object-contain mix-blend-multiply rounded border border-slate-200 pointer-events-none" 
                                            style={{ width: getBoxWidth(q.image_box), maxHeight: isDiagPreview ? 'none' : '400px' }} alt="" draggable="false" />
                                     </div>
                                   )}
                                   <div className="flex items-start gap-3 w-full mt-1">
                                     <div className="font-myungjo font-semibold text-[16px] text-slate-800 leading-[1.6] tracking-wide shrink-0 pointer-events-none pt-0.5" dangerouslySetInnerHTML={{ __html: formatText(splitSubInfo.subMarkerText) }} />
                                     <div className="flex-1 min-w-0 flex flex-col gap-3 items-start">
                                       {showImg1 && !showImg2 && (
                                         <img src={getCleanUrl(q.image_url)} 
                                              className="max-w-full object-contain mix-blend-multiply rounded border border-slate-200 pointer-events-none" 
                                              style={{ width: getBoxWidth(q.image_box), maxHeight: isDiagPreview ? 'none' : '400px' }} alt="" draggable="false" />
                                       )}
                                       {showImg2 && (
                                         <img src={getCleanUrl(q.image_2_url)} 
                                              className="max-w-full object-contain mix-blend-multiply rounded border border-slate-200 pointer-events-none" 
                                              style={{ width: getBoxWidth(q.image_2_box), maxHeight: isDiagPreview ? 'none' : '400px' }} alt="" draggable="false" />
                                       )}
                                     </div>
                                   </div>
                                 </div>
                               ) : (
                                 <>
                                   {textToRender && <div className="font-myungjo font-semibold text-[16px] text-slate-800 leading-[2.2] tracking-wide break-keep pointer-events-none" dangerouslySetInnerHTML={{ __html: formatText(textToRender) }} />}
                                   
                                   {/* 🌟 [핵심 변경] 거인증 해결! width: auto 기본 적용 및 설정된 width % 반영 */}
                                   {hasVisibleImg && (
                                     <div className="mt-4 flex flex-col gap-4 w-full items-center">
                                       {showImg1 && (
                                         <div className="w-full flex justify-center">
                                           <img src={getCleanUrl(q.image_url)} 
                                                className="max-w-full object-contain mix-blend-multiply rounded border border-slate-200 pointer-events-none" 
                                                style={{ width: getBoxWidth(q.image_box), maxHeight: isDiagPreview ? 'none' : '400px' }} alt="" draggable="false" />
                                         </div>
                                       )}
                                       {showImg2 && (
                                         <div className="w-full flex justify-center">
                                           <img src={getCleanUrl(q.image_2_url)} 
                                                className="max-w-full object-contain mix-blend-multiply rounded border border-slate-200 pointer-events-none" 
                                                style={{ width: getBoxWidth(q.image_2_box), maxHeight: isDiagPreview ? 'none' : '400px' }} alt="" draggable="false" />
                                         </div>
                                       )}
                                     </div>
                                   )}
                                 </>
                               )}

                               {q2ToRender && (
                                 <div
                                   className="font-myungjo font-semibold text-[16px] text-slate-800 leading-[2.2] tracking-wide break-keep pointer-events-none mt-3"
                                   dangerouslySetInnerHTML={{
                                     __html: formatText(q2ToRender)
                                   }}
                                 />
                               )}
                               
                               {q.options && q.options !== 'null' && typeof q.options === 'string' && (
                                  <div className="pl-2 pt-2">
                                    {(() => {
                                      try {
                                        const opts = JSON.parse(q.options);
                                        if (Array.isArray(opts) && opts.length > 0) {
                                          return (
                                            <ul className="space-y-1.5 list-none">
                                              {opts.map((opt: string, oi: number) => (
                                                <li key={oi} className="flex gap-2 text-[15px]">
                                                  <span className="shrink-0 text-slate-500 w-5">①②③④⑤⑥⑦⑧⑨⑩[oi]</span>
                                                  <span dangerouslySetInnerHTML={{ __html: formatText(opt) }} />
                                                </li>
                                              ))}
                                            </ul>
                                          );
                                        }
                                      } catch(e) {}
                                      return null;
                                    })()}
                                  </div>
                               )}
                             </div>
                           </div>
                           
                           {showAnswer && (
                             <div className="mt-6 pt-5 border-t border-dashed border-slate-200 bg-white/50 p-4 rounded-lg pointer-events-none">
                               <div className="flex items-center gap-2 mb-2"><span className="text-xs font-bold text-rose-500 bg-rose-100 px-2 py-0.5 rounded">정답</span><span className="font-myungjo font-bold text-slate-700" dangerouslySetInnerHTML={{ __html: formatText(q.answer) }}></span></div>
                               
                               {/* 🌟 정답 이미지도 배율 완벽 적용 */}
                               {(q.answer_image_url || q.answer_image_2_url) && (
                                 <div className="mt-4 flex flex-col gap-4 w-full items-center">
                                   {q.answer_image_url && (
                                     <div className="w-full flex justify-center">
                                       <img src={getCleanUrl(q.answer_image_url)} 
                                            className="max-w-full rounded border border-slate-200 mix-blend-multiply object-contain" 
                                            style={{ width: getBoxWidth(q.answer_image_box), maxHeight: '400px' }} alt="" draggable="false" />
                                     </div>
                                   )}
                                   {q.answer_image_2_url && (
                                     <div className="w-full flex justify-center">
                                       <img src={getCleanUrl(q.answer_image_2_url)} 
                                            className="max-w-full rounded border border-slate-200 mix-blend-multiply object-contain" 
                                            style={{ width: 'auto', maxHeight: '400px' }} alt="" draggable="false" />
                                     </div>
                                   )}
                                 </div>
                               )}
                               
                               <div className="mt-4 pt-3 border-t border-dashed border-slate-300 text-slate-600 text-[15px] font-myungjo leading-[2.0]">
                                 {q.explanation && <div className="mb-2"><b className="text-blue-700">[해설]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.explanation) }} /></div>}
                                 {q.solution && <div className="mb-2"><b className="text-blue-700">[풀이]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.solution) }} /></div>}
                                 {q.step_1_concept && <div className="mb-2"><b className="text-blue-700">[개념]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.step_1_concept) }} /></div>}
                                 {q.step_2_approach && <div className="mb-2"><b className="text-blue-700">[접근]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.step_2_approach) }} /></div>}
                                 {q.step_3_process && <div className="mb-2"><b className="text-blue-700">[풀이과정]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.step_3_process) }} /></div>}
                                 {q.step_4_conclusion && <div><b className="text-rose-600">[결론]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.step_4_conclusion) }} /></div>}
                               </div>
                             </div>
                           )}
                         </>
                       ) : (
                         <div className="p-5 bg-amber-50 rounded-xl border border-amber-200 shadow-inner cursor-default mt-2" onMouseDown={(e) => e.stopPropagation()}>
                           <label className="block text-[12px] font-extrabold text-amber-800 mb-1">📝 문제 수정</label>
                           <textarea value={editForm.question} onChange={e => setEditForm({...editForm, question: e.target.value})} className="w-full p-3 border border-amber-300 rounded mb-3 text-[14px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={3}></textarea>
                           
                            {(editForm.image_url || editForm.image_2_url) && (
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                               {editForm.image_url && (
                                 <div className="flex flex-col gap-2 p-3 bg-white border border-amber-200 rounded">
                                   <div className="flex justify-between items-center gap-2 flex-wrap">
                                     <span className="text-[12px] font-bold text-amber-800">🖼️ 이미지 1 너비 조절</span>
                                     <div className="flex items-center gap-1">
                                       {[40, 60, 80, 100].map(preset => (
                                         <button
                                           key={preset}
                                           type="button"
                                           onClick={() => setEditForm((prev: any) => ({ ...prev, image_box: setBoxWidthJson(prev.image_box, preset) }))}
                                           className={`px-1.5 py-0.5 text-[10px] font-bold rounded border transition-colors ${getBoxWidthNumber(editForm.image_box, 100) === preset ? 'bg-amber-600 text-white border-amber-600' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}`}
                                         >
                                           {preset}%
                                         </button>
                                       ))}
                                       <span className="text-[11px] font-black text-amber-600 ml-1 min-w-[34px] text-right">
                                         {getBoxWidthNumber(editForm.image_box, 100)}%
                                       </span>
                                     </div>
                                   </div>
                                   <input 
                                     type="range" min="20" max="100" step="5"
                                     draggable={false}
                                     onMouseDown={(e) => e.stopPropagation()}
                                     onPointerDown={(e) => e.stopPropagation()}
                                     onTouchStart={(e) => e.stopPropagation()}
                                     value={getBoxWidthNumber(editForm.image_box, 100)}
                                     onChange={(e) => {
                                       const nextW = parseInt(e.target.value, 10);
                                       setEditForm((prev: any) => ({ ...prev, image_box: setBoxWidthJson(prev.image_box, nextW) }));
                                     }}
                                     className="w-full accent-amber-600 cursor-pointer"
                                   />
                                   <div className="flex justify-center mt-2 border border-slate-100 p-1 bg-slate-50">
                                      <img src={getCleanUrl(editForm.image_url)} style={{ width: `${getBoxWidthNumber(editForm.image_box, 100)}%`, maxHeight: '120px', objectFit: 'contain' }} alt="" draggable="false" />
                                   </div>
                                 </div>
                               )}
                               {editForm.image_2_url && (
                                 <div className="flex flex-col gap-2 p-3 bg-white border border-amber-200 rounded">
                                   <div className="flex justify-between items-center gap-2 flex-wrap">
                                     <span className="text-[12px] font-bold text-amber-800">🖼️ 이미지 2 너비 조절</span>
                                     <div className="flex items-center gap-1">
                                       {[40, 60, 80, 100].map(preset => (
                                         <button
                                           key={preset}
                                           type="button"
                                           onClick={() => setEditForm((prev: any) => ({ ...prev, image_2_box: setBoxWidthJson(prev.image_2_box, preset) }))}
                                           className={`px-1.5 py-0.5 text-[10px] font-bold rounded border transition-colors ${getBoxWidthNumber(editForm.image_2_box, 100) === preset ? 'bg-amber-600 text-white border-amber-600' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}`}
                                         >
                                           {preset}%
                                         </button>
                                       ))}
                                       <span className="text-[11px] font-black text-amber-600 ml-1 min-w-[34px] text-right">
                                         {getBoxWidthNumber(editForm.image_2_box, 100)}%
                                       </span>
                                     </div>
                                   </div>
                                   <input 
                                     type="range" min="20" max="100" step="5"
                                     draggable={false}
                                     onMouseDown={(e) => e.stopPropagation()}
                                     onPointerDown={(e) => e.stopPropagation()}
                                     onTouchStart={(e) => e.stopPropagation()}
                                     value={getBoxWidthNumber(editForm.image_2_box, 100)}
                                     onChange={(e) => {
                                       const nextW = parseInt(e.target.value, 10);
                                       setEditForm((prev: any) => ({ ...prev, image_2_box: setBoxWidthJson(prev.image_2_box, nextW) }));
                                     }}
                                     className="w-full accent-amber-600 cursor-pointer"
                                   />
                                   <div className="flex justify-center mt-2 border border-slate-100 p-1 bg-slate-50">
                                      <img src={getCleanUrl(editForm.image_2_url)} style={{ width: `${getBoxWidthNumber(editForm.image_2_box, 100)}%`, maxHeight: '120px', objectFit: 'contain' }} alt="" draggable="false" />
                                   </div>
                                 </div>
                               )}
                             </div>
                           )}
                           
                           <label className="block text-[12px] font-extrabold text-amber-800 mb-1">📝 문제 2 수정 (이미지 하단 출력 — 선택)</label>
                           <textarea value={editForm.question_2 || ''} onChange={e => setEditForm({...editForm, question_2: e.target.value})} placeholder="이미지(그래프/도형) 아래에 출력할 추가 문제 텍스트가 있는 경우 입력하세요." className="w-full p-2.5 border border-amber-300 rounded mb-3 text-[14px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={2}></textarea>

                           <label className="block text-[12px] font-extrabold text-amber-800 mb-1">🎯 정답 수정</label>
                           <textarea value={editForm.answer} onChange={e => setEditForm({...editForm, answer: e.target.value})} className="w-full p-2 border border-amber-300 rounded mb-3 text-[14px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={1}></textarea>
                           
                           <label className="block text-[12px] font-extrabold text-amber-800 mb-1 mt-2">📖 일반 해설 및 풀이</label>
                           <div className="flex gap-2 mb-3">
                               <textarea value={editForm.explanation} onChange={e => setEditForm({...editForm, explanation: e.target.value})} className="w-1/2 p-2 border border-amber-300 rounded text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={2} placeholder="일반 해설"></textarea>
                               <textarea value={editForm.solution} onChange={e => setEditForm({...editForm, solution: e.target.value})} className="w-1/2 p-2 border border-amber-300 rounded text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={2} placeholder="일반 풀이"></textarea>
                           </div>

                           <div className="flex justify-end gap-2 mt-4">
                               <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 font-bold text-xs rounded hover:bg-slate-50 shadow-sm cursor-pointer">취소</button>
                               <button onClick={saveEdit} className="px-4 py-2 bg-[#002864] text-white font-bold text-xs rounded hover:bg-blue-900 shadow-sm cursor-pointer">💾 각각 저장</button>
                           </div>
                         </div>
                       )}
                       
                       <div className="mt-4 flex justify-end gap-2" onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }} draggable>
                         
                         {hasTwinPerm && (
                           <button onClick={() => openAiTwinModal(idx, subIdx, q)} className="px-3 py-1.5 bg-gradient-to-r from-fuchsia-50 to-indigo-50 hover:from-fuchsia-100 hover:to-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-[12px] rounded shadow-sm flex items-center gap-1.5 transition-colors">
                             <span className="text-[14px]">🤖</span>
                             AI 유사생성 및 교체
                           </button>
                         )}

                         <button onClick={() => openTwinSearch(idx, subIdx, q)} className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 font-bold text-[12px] rounded shadow-sm flex items-center gap-1.5 transition-colors">
                           <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 00-2-2v8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                           기존 문제로 교체 검색
                         </button>
                       </div>

                     </div>
                   );
                 })}
               </div>
             </div>
           );
         })
        }
      </div>

      {/* AI 쌍둥이/유사 문항 생성 및 교체 모달 (/taxonomy-editor와 동일 로직·구성) */}
      {isTwinModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 flex flex-col items-center justify-center p-6 sm:p-10 animate-in fade-in backdrop-blur-sm">
          <div className="bg-white w-full max-w-6xl h-full max-h-[92vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
            <div className="p-5 bg-gradient-to-r from-fuchsia-600 to-indigo-600 flex flex-wrap justify-between items-center gap-3 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>👯</span> AI 쌍둥이/유사 문항 생성기 (코드 기반 도형·그래프 이미지 자동 복제)
                </h2>
                <p className="text-fuchsia-100 font-bold text-xs mt-1">
                  원본 이미지를 분석하여 변형된 도형·그래프(SVG 벡터)와 수식·해설을 동시에 생성합니다. 저장 시 300DPI 고해상도 PNG로 자동 변환됩니다.
                </p>
                {aiTargetInfo?.q?.parent_question_id && (
                  <div className="mt-2 inline-flex items-center gap-1.5 bg-white/20 text-white px-2.5 py-1 rounded-lg text-xs font-bold border border-white/30">
                    <span>🔗 형제 문항 생성 모드:</span>
                    <span>저장 시 최상위 부모 문항의 쌍둥이/유사 문항으로 편입됩니다.</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center bg-black/20 p-1 rounded-xl border border-white/20">
                  <button
                    type="button"
                    disabled={isGeneratingTwins}
                    onClick={() => handleTriggerAIGeneration("gemini-3.8-flash")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      twinAiModel === "gemini-3.8-flash"
                        ? "bg-white text-indigo-700 shadow-sm"
                        : "text-white/80 hover:text-white"
                    }`}
                    title="빠른 생성 속도, 일반 문항 및 기본 도형/그래프용"
                  >
                    ⚡ Gemini 3.8 Flash
                  </button>
                  <button
                    type="button"
                    disabled={isGeneratingTwins}
                    onClick={() => handleTriggerAIGeneration("gemini-4-argon")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      twinAiModel === "gemini-4-argon"
                        ? "bg-amber-300 text-slate-900 shadow-sm"
                        : "text-white/80 hover:text-white"
                    }`}
                    title="고난도 복합 도형·퍼즐·좌표 검증 특화 상위 모델"
                  >
                    🧠 Gemini 4 Argon
                  </button>
                </div>
                <button
                  type="button"
                  disabled={isGeneratingTwins}
                  onClick={() => handleTriggerAIGeneration(twinAiModel)}
                  className="text-white bg-white/15 hover:bg-white/25 border border-white/25 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  🔄 다시 생성
                </button>
                <button
                  type="button"
                  disabled={isGeneratingTwins}
                  onClick={handleManualCreate}
                  className="text-white bg-white/10 hover:bg-white/20 border border-white/20 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  ⌨️ 직접 양식 작성
                </button>
                <button
                  onClick={() => {
                    setIsTwinModalOpen(false);
                    setTwinAiModel("gemini-3.8-flash");
                  }}
                  className="text-white hover:text-fuchsia-200 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors cursor-pointer"
                >
                  닫기 ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scroll">
              {isGeneratingTwins ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                  <span className="text-5xl animate-spin">🌀</span>
                  <p className="font-bold text-lg">
                    AI({twinAiModel})가 원본 도형·그래프와 문제를 분석하여 쌍둥이/유사 문항을 조판하고 있습니다...
                  </p>
                  <p className="text-sm font-bold text-slate-400">
                    수식, 4단계 해설, 그리고 새 문제에 맞춘 벡터 도형/그래프 이미지를 함께 생성 중입니다 (약 8~15초 소요).
                  </p>
                </div>
              ) : generatedTwins.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {generatedTwins.map((twin: any, idx: number) => {
                    const isReplaceTarget =
                      twin.isSelected !== false && replaceTwinIdx === idx;

                    return (
                      <div
                        key={idx}
                        className={`bg-white border rounded-2xl p-5 shadow-sm transition-all flex flex-col gap-3 ${
                          twin.isSelected === false
                            ? "border-slate-200 opacity-60 grayscale-[50%]"
                            : isReplaceTarget
                            ? "border-fuchsia-400 ring-2 ring-fuchsia-100 hover:shadow-md"
                            : "border-indigo-300 hover:shadow-md"
                        }`}
                      >
                        <div className="flex justify-between items-center border-b border-slate-100 pb-2.5 gap-2 flex-wrap">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            {/* 1) DB 저장 여부 체크박스 */}
                            <label
                              className="flex items-center gap-1.5 cursor-pointer select-none bg-slate-50 hover:bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200"
                              title="체크하면 이 문항을 마스터 DB(question_db)에 저장합니다."
                            >
                              <input
                                type="checkbox"
                                checked={twin.isSelected !== false}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  handleTwinChange(idx, "isSelected", checked);
                                  if (!checked && replaceTwinIdx === idx) {
                                    setReplaceTwinIdx(null);
                                  }
                                }}
                                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                              />
                              <span
                                className={`px-1.5 py-0.5 rounded text-xs font-bold transition-colors ${
                                  twin.isSelected === false
                                    ? "text-slate-400"
                                    : twin.question_type === "유사"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-indigo-100 text-indigo-700"
                                }`}
                              >
                                {twin.question_type === "유사" ? "💡 유사 문항" : "👯 쌍둥이 문항"}
                              </span>
                              <span className="text-xs font-bold text-slate-600">DB 저장</span>
                            </label>

                            {/* 2) 현재 시험지 문항 교체 여부 체크박스 (두 문항 중 택1 또는 둘 다 해제하여 교체 안 함 가능) */}
                            <label
                              className={`flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-1 rounded-lg border transition-colors ${
                                isReplaceTarget
                                  ? "bg-fuchsia-50 border-fuchsia-300 text-fuchsia-700 shadow-sm"
                                  : "bg-white border-slate-200 text-slate-500 hover:border-fuchsia-200 hover:text-fuchsia-600"
                              }`}
                              title="체크하면 현재 출제 중인 시험지의 원래 문제를 이 문제로 즉시 교체합니다. (체크 해제 시 시험지 문제는 그대로 두고 DB에만 저장합니다)"
                            >
                              <input
                                type="checkbox"
                                checked={isReplaceTarget}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    if (twin.isSelected === false) {
                                      handleTwinChange(idx, "isSelected", true);
                                    }
                                    setReplaceTwinIdx(idx);
                                  } else {
                                    setReplaceTwinIdx(null);
                                  }
                                }}
                                className="w-4 h-4 text-fuchsia-600 rounded border-slate-300 focus:ring-fuchsia-500 cursor-pointer"
                              />
                              <span className="text-xs font-bold">
                                🔄 이 문제로 현재 시험지 교체
                              </span>
                            </label>

                            {twin.svg_code && twin.svg_code.includes("<svg") && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                🎨 새 도형/그래프 이미지 생성됨
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleTwinChange(idx, "isPreviewMode", !twin.isPreviewMode)}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold transition-colors shadow-sm cursor-pointer ${
                              twin.isPreviewMode
                                ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                                : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                            }`}
                          >
                            {twin.isPreviewMode ? (
                              <>
                                <span>✏️</span> 텍스트 편집 모드
                              </>
                            ) : (
                              <>
                                <span>👀</span> 수식 미리보기
                              </>
                            )}
                          </button>
                        </div>

                        <div className="flex flex-col gap-1.5 mt-1">
                          <label className="text-xs font-bold text-slate-500">문제 텍스트 (상단)</label>
                          {twin.isPreviewMode ? (
                            <div
                              className="w-full min-h-[4.5rem] p-3 text-sm border border-slate-200 rounded-lg bg-white overflow-x-auto shadow-inner whitespace-pre-wrap font-medium text-slate-800"
                              dangerouslySetInnerHTML={{
                                __html: twin.question
                                  ? formatText(twin.question)
                                  : '<span class="text-slate-400 italic text-xs">텍스트가 없습니다.</span>',
                              }}
                            />
                          ) : (
                            <textarea
                              value={twin.question}
                              onChange={(e) => handleTwinChange(idx, "question", e.target.value)}
                              className="w-full h-24 p-3 text-sm border border-slate-300 rounded-lg bg-yellow-50/30 resize-none outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                          )}
                        </div>

                        {/* 새로 생성된 SVG 도형/그래프 이미지 실시간 미리보기 및 코드 편집 */}
                        {(twin.svg_code || aiTargetInfo?.q?.image_url || aiTargetInfo?.q?.image_2_url) && (
                          <div className="flex flex-col gap-1.5 mt-1 bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-600">
                                🖼️ 생성된 문제 이미지{" "}
                                {twin.svg_code?.includes("<svg") ? "(신규 렌더링)" : "(원본 이미지 유지)"}
                              </span>
                            </div>
                            {twin.svg_code && twin.svg_code.includes("<svg") ? (
                              <div
                                className="w-full bg-white rounded-lg border border-slate-200 p-2 flex items-center justify-center overflow-hidden shadow-inner"
                                dangerouslySetInnerHTML={{ __html: twin.svg_code }}
                              />
                            ) : (
                              <div className="w-full bg-white rounded-lg border border-slate-200 p-2 flex items-center justify-center">
                                <img
                                  src={getCleanUrl(aiTargetInfo?.q?.image_url || aiTargetInfo?.q?.image_2_url)}
                                  alt="원본 이미지"
                                  className="max-h-48 object-contain"
                                />
                              </div>
                            )}
                            <details className="mt-1">
                              <summary className="text-[11px] font-bold text-slate-500 cursor-pointer hover:text-indigo-600 select-none">
                                🛠️ 이미지 벡터 코드(SVG) 직접 다듬기
                              </summary>
                              <textarea
                                value={twin.svg_code || ""}
                                onChange={(e) => handleTwinChange(idx, "svg_code", e.target.value)}
                                placeholder="<svg ...>...</svg> 코드를 수정하면 위 미리보기에 즉시 반영됩니다."
                                className="mt-1.5 w-full h-28 p-2 font-mono text-[11px] border border-slate-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400"
                              />
                            </details>
                          </div>
                        )}

                        {(twin.question_2 || aiTargetInfo?.q?.question_2) && (
                          <div className="flex flex-col gap-1.5 mt-1">
                            <label className="text-xs font-bold text-slate-500">문제 텍스트 2 (이미지 하단 질문)</label>
                            {twin.isPreviewMode ? (
                              <div
                                className="w-full min-h-[2.75rem] p-2.5 text-sm border border-slate-200 rounded-lg bg-white overflow-x-auto shadow-inner whitespace-pre-wrap font-medium text-slate-800"
                                dangerouslySetInnerHTML={{
                                  __html: twin.question_2
                                    ? formatText(twin.question_2)
                                    : '<span class="text-slate-400 italic text-xs">하단 질문 없음</span>',
                                }}
                              />
                            ) : (
                              <textarea
                                value={twin.question_2 || ""}
                                onChange={(e) => handleTwinChange(idx, "question_2", e.target.value)}
                                className="w-full h-16 p-2.5 text-sm border border-slate-300 rounded-lg bg-yellow-50/30 resize-none outline-none focus:ring-2 focus:ring-indigo-400"
                              />
                            )}
                          </div>
                        )}

                        <div className="flex flex-col gap-1.5 mt-2">
                          <label className="text-xs font-bold text-slate-500">정답</label>
                          {twin.isPreviewMode ? (
                            <div
                              className="w-full min-h-[38px] p-2 px-3 text-sm border border-slate-200 rounded-lg bg-white overflow-x-auto shadow-inner font-bold text-emerald-800 flex items-center"
                              dangerouslySetInnerHTML={{
                                __html: twin.answer
                                  ? formatText(twin.answer)
                                  : '<span class="text-slate-400 italic text-xs">정답이 없습니다.</span>',
                              }}
                            />
                          ) : (
                            <input
                              type="text"
                              value={twin.answer}
                              onChange={(e) => handleTwinChange(idx, "answer", e.target.value)}
                              className="w-full p-2 px-3 text-sm font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                          )}
                        </div>

                        {twin.answer_svg_code && twin.answer_svg_code.includes("<svg") && (
                          <div className="flex flex-col gap-1.5 mt-1 bg-emerald-50/50 p-3 rounded-xl border border-emerald-200">
                            <span className="text-xs font-bold text-emerald-700">✅ 생성된 해설/정답 이미지</span>
                            <div
                              className="w-full bg-white rounded-lg border border-emerald-200 p-2 flex items-center justify-center overflow-hidden shadow-inner"
                              dangerouslySetInnerHTML={{ __html: twin.answer_svg_code }}
                            />
                          </div>
                        )}

                        <details className="group mt-2">
                          <summary className="text-xs font-bold text-indigo-500 cursor-pointer hover:text-indigo-700 outline-none select-none flex items-center gap-1">
                            <span>▶</span> 상세 해설 (4단계) 보기 및 수정
                          </summary>
                          <div className="mt-3 flex flex-col gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                            {twin.isPreviewMode ? (
                              <div className="flex flex-col gap-2">
                                {twin.step_1_concept && (
                                  <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner">
                                    <span className="font-bold text-indigo-600 mr-2">1. 개념</span>
                                    <span dangerouslySetInnerHTML={{ __html: formatText(twin.step_1_concept) }} />
                                  </div>
                                )}
                                {twin.step_2_approach && (
                                  <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner">
                                    <span className="font-bold text-indigo-600 mr-2">2. 접근</span>
                                    <span dangerouslySetInnerHTML={{ __html: formatText(twin.step_2_approach) }} />
                                  </div>
                                )}
                                {twin.step_3_process && (
                                  <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner whitespace-pre-wrap">
                                    <span className="font-bold text-indigo-600 mr-2">3. 과정</span>
                                    <span dangerouslySetInnerHTML={{ __html: formatText(twin.step_3_process) }} />
                                  </div>
                                )}
                                {twin.step_4_conclusion && (
                                  <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner">
                                    <span className="font-bold text-indigo-600 mr-2">4. 결론</span>
                                    <span dangerouslySetInnerHTML={{ __html: formatText(twin.step_4_conclusion) }} />
                                  </div>
                                )}
                              </div>
                            ) : (
                              <>
                                <textarea
                                  value={twin.step_1_concept}
                                  onChange={(e) => handleTwinChange(idx, "step_1_concept", e.target.value)}
                                  placeholder="1. 개념"
                                  className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-12 outline-none focus:border-indigo-400"
                                />
                                <textarea
                                  value={twin.step_2_approach}
                                  onChange={(e) => handleTwinChange(idx, "step_2_approach", e.target.value)}
                                  placeholder="2. 접근"
                                  className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-12 outline-none focus:border-indigo-400"
                                />
                                <textarea
                                  value={twin.step_3_process}
                                  onChange={(e) => handleTwinChange(idx, "step_3_process", e.target.value)}
                                  placeholder="3. 과정"
                                  className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-16 outline-none focus:border-indigo-400"
                                />
                                <textarea
                                  value={twin.step_4_conclusion}
                                  onChange={(e) => handleTwinChange(idx, "step_4_conclusion", e.target.value)}
                                  placeholder="4. 결론"
                                  className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-12 outline-none focus:border-indigo-400"
                                />
                              </>
                            )}
                          </div>
                        </details>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-20 text-slate-400 font-bold">생성된 문항이 없습니다.</div>
              )}
            </div>

            {/* /taxonomy-editor와 동일한 2개 저장 대상 드롭다운 + 선택 저장 버튼 */}
            {(() => {
              const baseBook = getBaseBookName(aiTargetInfo?.q);
              const selectedCount = generatedTwins.filter((t: any) => t.isSelected !== false).length;
              const activeReplaceTwin =
                replaceTwinIdx !== null &&
                generatedTwins[replaceTwinIdx] &&
                generatedTwins[replaceTwinIdx].isSelected !== false
                  ? generatedTwins[replaceTwinIdx]
                  : null;
              return (
                <div className="p-5 bg-white border-t border-slate-200 flex flex-wrap justify-between items-center gap-4 shrink-0">
                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-bold text-slate-500">👯 쌍둥이 문항 저장 대상:</label>
                      <select
                        value={twinTargetBook}
                        onChange={(e) => setTwinTargetBook(e.target.value)}
                        className="px-3 py-1.5 border border-slate-300 rounded-lg font-bold text-indigo-700 bg-indigo-50 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm cursor-pointer text-sm"
                      >
                        <option value={`${baseBook} 쌍둥이`}>{baseBook} 쌍둥이</option>
                        {parentBookName && parentBookName !== baseBook && (
                          <option value={`${parentBookName} 쌍둥이`}>
                            {parentBookName} 쌍둥이 (부모 교재 기준)
                          </option>
                        )}
                        <option value="주간테스트">주간테스트</option>
                        <option value="중간테스트">중간테스트</option>
                        <option value="분기테스트">분기테스트</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-bold text-slate-500">💡 유사 문항 저장 대상:</label>
                      <select
                        value={similarTargetBook}
                        onChange={(e) => setSimilarTargetBook(e.target.value)}
                        className="px-3 py-1.5 border border-slate-300 rounded-lg font-bold text-amber-700 bg-amber-50 outline-none focus:ring-2 focus:ring-amber-500 shadow-sm cursor-pointer text-sm"
                      >
                        <option value={`${baseBook} 유사`}>{baseBook} 유사</option>
                        {parentBookName && parentBookName !== baseBook && (
                          <option value={`${parentBookName} 유사`}>
                            {parentBookName} 유사 (부모 교재 기준)
                          </option>
                        )}
                        <option value="주간테스트">주간테스트</option>
                        <option value="중간테스트">중간테스트</option>
                        <option value="분기테스트">분기테스트</option>
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={saveTwinAndReplace}
                    disabled={isGeneratingTwins || selectedCount === 0 || isSavingTwin}
                    className="px-8 py-3 bg-[#002864] hover:bg-blue-900 disabled:bg-slate-300 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    {isSavingTwin
                      ? "저장 중..."
                      : activeReplaceTwin
                      ? `💾 선택된 ${selectedCount}개 DB 저장 + [${
                          activeReplaceTwin.question_type === "유사" ? "유사" : "쌍둥이"
                        }]로 시험지 교체`
                      : `💾 선택된 ${selectedCount}개 DB만 저장 (시험지 교체 안 함)`}
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </section>
  );
}
