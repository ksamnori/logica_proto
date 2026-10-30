// src/components/makeup/MakeupModal.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { addToQueue } from "@/app/actions/alimtalk";

const hours = Array.from({ length: 15 }, (_, i) => String(i + 8).padStart(2, "0")); // 08시 ~ 22시
const minutes = ["00", "10", "20", "30", "40", "50"];

const ENDED_ENROLLMENT_STATUSES = ["수강종료", "종료", "퇴원", "취소"];
const isEndedEnrollment = (e: any): boolean => {
  if (!e) return true;
  if (ENDED_ENROLLMENT_STATUSES.includes(String(e.status || "").trim())) return true;
  if (e.end_date) return true;
  return false;
};

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

interface MakeupModalProps {
  isOpen: boolean;
  makeupData: any | null;
  students: any[];
  initialClassId?: string | null;
  instructors: any[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function MakeupModal({
  isOpen,
  makeupData,
  students,
  initialClassId = null,
  instructors,
  onClose,
  onSuccess,
}: MakeupModalProps) {
  const [mClassId, setMClassId] = useState<string>("all");
  const [mStudentId, setMStudentId] = useState("");
  const [mInstructorId, setMInstructorId] = useState("");
  const [mClassroom, setMClassroom] = useState("");
  const [mTopic, setMTopic] = useState("");
  const [mNote, setMNote] = useState("");
  const [mStatus, setMStatus] = useState("예정");

  // 시/분을 각각의 드롭다운 상태로 관리
  const [schedules, setSchedules] = useState([{ date: "", sHour: "", sMin: "", eHour: "", eMin: "" }]);
  const [isSaving, setIsSaving] = useState(false);

  // 일반 문자(보강 안내) 템플릿 발송 대기열 도구 상태
  const [smsScheduleCustom, setSmsScheduleCustom] = useState("");
  const [isSmsScheduleEdited, setIsSmsScheduleEdited] = useState(false);
  const [smsClassroomCustom, setSmsClassroomCustom] = useState("");
  const [isSmsClassroomEdited, setIsSmsClassroomEdited] = useState(false);
  const [smsDetailsCustom, setSmsDetailsCustom] = useState("");
  const [isSmsDetailsEdited, setIsSmsDetailsEdited] = useState(false);
  const [showSmsPreview, setShowSmsPreview] = useState(true);
  const [isQueueingSms, setIsQueueingSms] = useState(false);

  const toLocalDateString = (d: Date) => {
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().split("T")[0];
  };

  // 전체 학생의 수강 정보에서 반 목록 추출
  const classOptions = useMemo(() => {
    const map = new Map<string, string>();
    (students || []).forEach((s: any) => {
      const enrolls = Array.isArray(s.enrollment) ? s.enrollment : s.enrollment ? [s.enrollment] : [];
      enrolls.forEach((e: any) => {
        if (isEndedEnrollment(e)) return;
        const cls = unwrap(e.class);
        const cid = cls?.class_id ? String(cls.class_id) : "";
        const cname = cls?.class_name || cls?.name || "";
        if (cid && cname) {
          map.set(cid, cname);
        }
      });
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
  }, [students]);

  // 선택된 반에 속하는 학생 필터링
  const filteredStudents = useMemo(() => {
    if (!mClassId || mClassId === "all") return students;
    if (mClassId === "unassigned") {
      return (students || []).filter((s: any) => {
        const enrolls = Array.isArray(s.enrollment) ? s.enrollment : s.enrollment ? [s.enrollment] : [];
        return !enrolls.some((e: any) => !isEndedEnrollment(e) && unwrap(e.class)?.class_id);
      });
    }
    return (students || []).filter((s: any) => {
      const enrolls = Array.isArray(s.enrollment) ? s.enrollment : s.enrollment ? [s.enrollment] : [];
      return enrolls.some((e: any) => !isEndedEnrollment(e) && String(unwrap(e.class)?.class_id) === String(mClassId));
    });
  }, [students, mClassId]);

  const selectedStudentObj = useMemo(() => {
    return (students || []).find((s: any) => String(s.student_id) === String(mStudentId)) || null;
  }, [students, mStudentId]);

  const selectedInstructorObj = useMemo(() => {
    return (instructors || []).find((i: any) => String(i.instructor_id) === String(mInstructorId)) || null;
  }, [instructors, mInstructorId]);

  useEffect(() => {
    if (isOpen) {
      setIsSmsScheduleEdited(false);
      setIsSmsClassroomEdited(false);
      setIsSmsDetailsEdited(false);

      if (makeupData) {
        const sid = makeupData.student_id?.toString() || "";
        setMStudentId(sid);
        const stu = (students || []).find((s: any) => String(s.student_id) === sid);
        const enrolls = Array.isArray(stu?.enrollment) ? stu.enrollment : stu?.enrollment ? [stu.enrollment] : [];
        const activeEnroll = enrolls.find((e: any) => !isEndedEnrollment(e));
        const activeCid = unwrap(activeEnroll?.class)?.class_id;
        setMClassId(activeCid ? String(activeCid) : "all");

        setMInstructorId(makeupData.instructor_id?.toString() || "");
        setMClassroom(makeupData.classroom || "");
        setMTopic(makeupData.target_category_id || "");
        setMStatus(makeupData.status || "예정");

        const d = new Date(makeupData.schedule_date);
        const dateStr = toLocalDateString(d);
        const sHour = String(d.getHours()).padStart(2, "0");
        const sMin = String(d.getMinutes()).padStart(2, "0");

        let eHour = "";
        let eMin = "";
        let cleanNote = makeupData.instructor_note || "";
        const match = cleanNote.match(/\[종료예정 (\d{2}):(\d{2})\]/);
        if (match) {
          eHour = match[1];
          eMin = match[2];
          cleanNote = cleanNote.replace(/\[종료예정 \d{2}:\d{2}\]\s*/, "").trim();
        }

        setSchedules([{ date: dateStr, sHour, sMin, eHour, eMin }]);
        setMNote(cleanNote);
      } else {
        setMClassId(initialClassId ? String(initialClassId) : "all");
        setMStudentId("");
        setMInstructorId("");
        setMClassroom("");
        setMTopic("");
        setMNote("");
        setMStatus("예정");
        setSchedules([{ date: toLocalDateString(new Date()), sHour: "", sMin: "", eHour: "", eMin: "" }]);
      }
    }
  }, [isOpen, makeupData, initialClassId, students]);

  // 보강 날짜/시간으로부터 자동으로 보강일시 텍스트 생성
  const autoGeneratedScheduleStr = useMemo(() => {
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    const valid = schedules.filter((sch) => sch.date && sch.sHour && sch.sMin);
    if (valid.length === 0) return "";
    const formattedList = valid.map((sch) => {
      const [, mm, dd] = sch.date.split("-");
      const dObj = new Date(`${sch.date}T00:00:00`);
      const dayLabel = !isNaN(dObj.getTime()) ? `(${days[dObj.getDay()]})` : "";
      const timeRange =
        sch.eHour && sch.eMin
          ? `${sch.sHour}:${sch.sMin}~${sch.eHour}:${sch.eMin}`
          : `${sch.sHour}:${sch.sMin}`;
      return `${Number(mm)}월 ${Number(dd)}일${dayLabel} ${timeRange}`;
    });
    return formattedList.join(", ");
  }, [schedules]);

  // 강사/단원/메모로부터 자동으로 상세내용 텍스트 생성
  const autoGeneratedDetailsStr = useMemo(() => {
    const parts: string[] = [];
    if (selectedInstructorObj?.name) {
      parts.push(`담당강사: ${selectedInstructorObj.name} 선생님`);
    }
    if (mTopic.trim()) {
      parts.push(`보강내용: ${mTopic.trim()}`);
    }
    if (mNote.trim()) {
      parts.push(`안내사항: ${mNote.trim()}`);
    }
    return parts.length > 0 ? parts.join(" / ") : "개별 보강 수업이 진행됩니다.";
  }, [selectedInstructorObj, mTopic, mNote]);

  useEffect(() => {
    if (!isSmsScheduleEdited) {
      setSmsScheduleCustom(autoGeneratedScheduleStr);
    }
  }, [autoGeneratedScheduleStr, isSmsScheduleEdited]);

  useEffect(() => {
    if (!isSmsClassroomEdited) {
      setSmsClassroomCustom(mClassroom || "");
    }
  }, [mClassroom, isSmsClassroomEdited]);

  useEffect(() => {
    if (!isSmsDetailsEdited) {
      setSmsDetailsCustom(autoGeneratedDetailsStr);
    }
  }, [autoGeneratedDetailsStr, isSmsDetailsEdited]);

  // 시작 시간을 고르면 종료 시간이 자동으로 1시간 뒤로 입력되는 로직
  const updateSchedule = (index: number, field: string, value: string) => {
    setSchedules((prev) =>
      prev.map((sch, i) => {
        if (i !== index) return sch;

        const updated = { ...sch, [field]: value };

        if (field === "sHour" && value) {
          let nextH = parseInt(value, 10) + 1;
          if (nextH >= 24) nextH = 23;
          updated.eHour = String(nextH).padStart(2, "0");
          if (!updated.eMin && updated.sMin) updated.eMin = updated.sMin;
        }
        if (field === "sMin" && value) {
          if (!updated.eMin) updated.eMin = value;
          if (!updated.eHour && updated.sHour) {
            let nextH = parseInt(updated.sHour, 10) + 1;
            if (nextH >= 24) nextH = 23;
            updated.eHour = String(nextH).padStart(2, "0");
          }
        }

        return updated;
      })
    );
  };

  const addScheduleRow = () => {
    setSchedules((prev) => [...prev, { date: toLocalDateString(new Date()), sHour: "", sMin: "", eHour: "", eMin: "" }]);
  };

  const removeScheduleRow = (index: number) => {
    setSchedules((prev) => prev.filter((_, i) => i !== index));
  };

  const formatGrade = (grade: any) => {
    if (!grade) return "-";
    if (isNaN(Number(grade))) return grade;
    const g = parseInt(grade, 10);
    if (g >= 1 && g <= 6) return `초${g}`;
    if (g >= 7 && g <= 9) return `중${g - 6}`;
    if (g >= 10 && g <= 12) return `고${g - 9}`;
    return `${g}학년`;
  };

  // 선택된 학생의 학부모 연락처 목록 추출
  const parentTargets = useMemo(() => {
    if (!selectedStudentObj) return [];
    const pInfo = unwrap(selectedStudentObj.parent);
    if (!pInfo) return [];
    const list: { phone: string; finalName: string }[] = [];
    const pushTarget = (phone?: string, name?: string, rel?: string) => {
      if (!phone || String(phone).includes("unassigned") || !String(phone).trim()) return;
      const relStr = rel || "학부모";
      const finalName = name && name !== "미입력" ? `${name}(${relStr})` : `${selectedStudentObj.name}(${relStr})`;
      list.push({ phone: String(phone).trim(), finalName });
    };
    pushTarget(pInfo.phone, pInfo.name, pInfo.relationship);
    pushTarget(pInfo.phone_2, pInfo.name_2, pInfo.relationship_2);
    return list;
  }, [selectedStudentObj]);

  // 개별 보강 안내 일반 문자(GENERAL_SMS) 본문 생성 헬퍼
  const buildMakeupSmsBody = (parentName: string, studentName: string, schStr: string, roomStr: string, detailStr: string) => {
    return `[로지카대치본원학원] 보강 안내\n\n${parentName} 학부모님,\n${studentName}학생의 보강 일정을 안내해 드립니다.\n\n■ 보강 일시 : ${schStr}\n■ 강의실 : ${roomStr}\n■ 상세 내용 : ${detailStr}`;
  };

  // 보강 안내 일반 문자를 발송 대기열(alimtalk_queue)에 등록하는 함수
  const handleQueueMakeupSms = async (silentSuccess = false): Promise<boolean> => {
    if (!mStudentId || !selectedStudentObj) {
      alert("먼저 보강 대상 학생을 선택해주세요.");
      return false;
    }
    const finalSchedule = (smsScheduleCustom || autoGeneratedScheduleStr).trim();
    const finalClassroom = (smsClassroomCustom || mClassroom || "-").trim();
    const finalDetails = (smsDetailsCustom || autoGeneratedDetailsStr).trim();

    if (!finalSchedule) {
      alert("보강 일시(날짜 및 시작 시간)를 먼저 선택하거나 보강 일시를 입력해주세요.");
      return false;
    }

    const myTenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId =
      myTenantId === "hq"
        ? "1ff4299c-d72b-4d99-97b0-45fee08e3b73"
        : myTenantId || selectedStudentObj.tenant_id;

    if (!validTenantId) {
      alert("소속 지점 정보가 없습니다.");
      return false;
    }

    setIsQueueingSms(true);
    try {
      let targets = [...parentTargets];

      // 만약 학생 객체에 parent 정보가 아직 없다면 DB에서 직접 조회
      if (targets.length === 0) {
        const { data: stuWithParent } = await supabase
          .from("student")
          .select("name, parent(name, phone, relationship, name_2, phone_2, relationship_2)")
          .eq("student_id", mStudentId)
          .maybeSingle();

        const pInfo: any = unwrap(stuWithParent?.parent);
        if (pInfo) {
          const pushTarget = (phone?: string, name?: string, rel?: string) => {
            if (!phone || String(phone).includes("unassigned") || !String(phone).trim()) return;
            const relStr = rel || "학부모";
            const finalName =
              name && name !== "미입력" ? `${name}(${relStr})` : `${selectedStudentObj.name}(${relStr})`;
            targets.push({ phone: String(phone).trim(), finalName });
          };
          pushTarget(pInfo.phone, pInfo.name, pInfo.relationship);
          pushTarget(pInfo.phone_2, pInfo.name_2, pInfo.relationship_2);
        }
      }

      if (targets.length === 0) {
        alert("선택한 학생에게 등록된 학부모 연락처가 없어 대기열에 담을 수 없습니다.");
        return false;
      }

      const currentTimeStr = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      const newMessages = targets.map((t) => {
        const fullSmsText = buildMakeupSmsBody(
          t.finalName,
          selectedStudentObj.name,
          finalSchedule,
          finalClassroom,
          finalDetails
        );
        return {
          tenant_id: validTenantId,
          student_id: selectedStudentObj.student_id,
          student_name: selectedStudentObj.name,
          parent_name: t.finalName,
          parent_phone: t.phone,
          template_id: "GENERAL_SMS",
          details: fullSmsText,
          preview_title: `[보강] ${selectedStudentObj.name}`,
          preview_desc: `${finalSchedule} (${finalClassroom})`,
          time_string: currentTimeStr,
          status: "대기",
        };
      });

      const res = await addToQueue(newMessages);
      if (!res.success) {
        alert(`발송 대기열 등록 실패: ${res.message}`);
        return false;
      }

      if (!silentSuccess) {
        alert(`✅ ${selectedStudentObj.name} 학생 학부모님(${res.inserted}건)께 보강 안내 일반 문자가 발송 대기열에 등록되었습니다.`);
      }
      return true;
    } catch (e: any) {
      alert("대기열 등록 중 오류: " + (e?.message || String(e)));
      return false;
    } finally {
      setIsQueueingSms(false);
    }
  };

  const saveMakeup = async (alsoQueueSms = false) => {
    if (!mStudentId || !mInstructorId || !mClassroom) return alert("학생, 강사, 강의실은 필수 항목입니다.");

    for (const sch of schedules) {
      if (!sch.date || !sch.sHour || !sch.sMin) {
        return alert("모든 보강 일정의 날짜와 시작 시간을 정확히 선택해주세요.");
      }
    }

    const myTenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = myTenantId === "hq" ? "1ff4299c-d72b-4d99-97b0-45fee08e3b73" : myTenantId;
    if (!validTenantId) return alert("소속 지점 정보가 없습니다.");

    setIsSaving(true);
    try {
      const scheduleData: any[] = schedules.map((sch) => {
        const targetDate = new Date(`${sch.date}T${sch.sHour}:${sch.sMin}:00+09:00`);
        let finalNote = mNote;
        if (sch.eHour && sch.eMin) {
          finalNote = `[종료예정 ${sch.eHour}:${sch.eMin}] ` + finalNote;
        }

        return {
          student_id: mStudentId,
          instructor_id: mInstructorId,
          schedule_date: targetDate.toISOString(),
          classroom: mClassroom,
          target_category_id: mTopic,
          instructor_note: finalNote,
          status: mStatus,
          tenant_id: validTenantId,
        };
      });

      if (makeupData) {
        const { error } = await supabase
          .from("individual_makeup")
          .update(scheduleData[0])
          .eq("makeup_id", makeupData.makeup_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("individual_makeup").insert(scheduleData);
        if (error) throw error;
      }

      if (alsoQueueSms) {
        const queuedOk = await handleQueueMakeupSms(true);
        if (queuedOk) {
          alert(
            makeupData
              ? "✅ 보강 일정이 수정되었으며, 보강 안내 문자가 발송 대기열에도 함께 등록되었습니다!"
              : `✅ ${scheduleData.length}개의 보강 일정이 등록되었으며, 보강 안내 문자가 발송 대기열에도 함께 담겼습니다!`
          );
        } else {
          alert(
            makeupData
              ? "보강 일정은 수정되었으나 문자 발송 대기열 등록은 완료되지 않았습니다."
              : `${scheduleData.length}개의 보강 일정은 등록되었으나 문자 발송 대기열 등록은 완료되지 않았습니다.`
          );
        }
      } else {
        alert(
          makeupData
            ? "보강 일정이 성공적으로 수정되었습니다."
            : `${scheduleData.length}개의 보강 일정이 성공적으로 등록되었습니다.`
        );
      }

      onSuccess();
      onClose();
    } catch (e: any) {
      alert("저장 실패: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const previewParentName =
    parentTargets.length > 0
      ? parentTargets[0].finalName
      : selectedStudentObj
      ? `${selectedStudentObj.name}(학부모)`
      : "#{이름}";

  const previewStudentName = selectedStudentObj?.name || "#{학생명}";
  const previewSchedule = (smsScheduleCustom || autoGeneratedScheduleStr).trim() || "(날짜 및 시간을 선택하세요)";
  const previewClassroom = (smsClassroomCustom || mClassroom).trim() || "(강의실을 선택하세요)";
  const previewDetails = (smsDetailsCustom || autoGeneratedDetailsStr).trim();

  const fullPreviewText = buildMakeupSmsBody(
    previewParentName,
    previewStudentName,
    previewSchedule,
    previewClassroom,
    previewDetails
  );

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[99] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-brand p-5 text-white flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold tracking-tight">
            📅 1:1 개별 보강 일정 {makeupData ? "수정" : "등록"}
          </h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">
            &times;
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scroll max-h-[82vh] bg-slate-50 space-y-4">
          {/* 좌상단: 반 선택 드롭다운 -> 해당 반 학생 선택 드롭다운 + 우측 담당 강사 선택 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">수강 반 선택</label>
              <select
                value={mClassId}
                onChange={(e) => {
                  const nextClassId = e.target.value;
                  setMClassId(nextClassId);
                  if (nextClassId !== "all" && mStudentId) {
                    const stillInClass = (students || []).some((s: any) => {
                      if (String(s.student_id) !== String(mStudentId)) return false;
                      const enrolls = Array.isArray(s.enrollment)
                        ? s.enrollment
                        : s.enrollment
                        ? [s.enrollment]
                        : [];
                      if (nextClassId === "unassigned") {
                        return !enrolls.some((en: any) => !isEndedEnrollment(en) && unwrap(en.class)?.class_id);
                      }
                      return enrolls.some(
                        (en: any) =>
                          !isEndedEnrollment(en) && String(unwrap(en.class)?.class_id) === String(nextClassId)
                      );
                    });
                    if (!stillInClass) setMStudentId("");
                  }
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-slate-50/70 text-slate-700 focus:outline-none focus:border-brand"
              >
                <option value="all">전체 반 ({students.length}명)</option>
                {classOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="unassigned">반 미배정</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">
                대상 학생 <span className="text-rose-500">*</span>
                <span className="ml-1 text-[11px] font-bold text-indigo-500">({filteredStudents.length}명)</span>
              </label>
              <select
                value={mStudentId}
                onChange={(e) => setMStudentId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-brand"
              >
                <option value="">학생을 선택하세요</option>
                {filteredStudents.map((s: any) => (
                  <option key={s.student_id} value={s.student_id}>
                    {s.name} ({formatGrade(s.grade)}
                    {mClassId === "all" && s.class_name ? ` · ${s.class_name}` : ""})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">
                담당 강사 <span className="text-rose-500">*</span>
              </label>
              <select
                value={mInstructorId}
                onChange={(e) => setMInstructorId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-brand"
              >
                <option value="">강사를 선택하세요</option>
                {instructors.map((i: any) => (
                  <option key={i.instructor_id} value={i.instructor_id}>
                    {i.name} 선생님
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <label className="block text-sm font-bold text-slate-700 mb-3">
              보강 날짜 및 시간 설정 <span className="text-rose-500">*</span>
            </label>
            <div className="flex flex-col gap-2">
              {schedules.map((sch, idx) => (
                <div
                  key={idx}
                  className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 transition-all focus-within:border-brand focus-within:ring-1 focus-within:ring-brand"
                >
                  <input
                    type="date"
                    value={sch.date}
                    onChange={(e) => updateSchedule(idx, "date", e.target.value)}
                    className="w-[120px] shrink-0 px-2 py-1.5 rounded border border-slate-300 font-bold text-[13px] text-slate-700 bg-white focus:outline-none focus:border-brand"
                  />

                  <div className="flex-1 flex items-center gap-1 min-w-0">
                    <select
                      value={sch.sHour}
                      onChange={(e) => updateSchedule(idx, "sHour", e.target.value)}
                      className="flex-1 min-w-0 px-1 py-1.5 rounded border border-slate-300 font-bold text-[13px] text-slate-700 bg-white text-center focus:outline-none focus:border-brand"
                    >
                      <option value="">시</option>
                      {hours.map((h) => (
                        <option key={h} value={h}>
                          {h}시
                        </option>
                      ))}
                    </select>
                    <span className="font-bold text-slate-400">:</span>
                    <select
                      value={sch.sMin}
                      onChange={(e) => updateSchedule(idx, "sMin", e.target.value)}
                      className="flex-1 min-w-0 px-1 py-1.5 rounded border border-slate-300 font-bold text-[13px] text-slate-700 bg-white text-center focus:outline-none focus:border-brand"
                    >
                      <option value="">분</option>
                      {minutes.map((m) => (
                        <option key={m} value={m}>
                          {m}분
                        </option>
                      ))}
                    </select>

                    <span className="text-slate-400 font-bold px-1.5">~</span>

                    <select
                      value={sch.eHour}
                      onChange={(e) => updateSchedule(idx, "eHour", e.target.value)}
                      className="flex-1 min-w-0 px-1 py-1.5 rounded border border-slate-300 font-bold text-[13px] text-slate-700 bg-white text-center focus:outline-none focus:border-brand"
                    >
                      <option value="">시</option>
                      {hours.map((h) => (
                        <option key={h} value={h}>
                          {h}시
                        </option>
                      ))}
                    </select>
                    <span className="font-bold text-slate-400">:</span>
                    <select
                      value={sch.eMin}
                      onChange={(e) => updateSchedule(idx, "eMin", e.target.value)}
                      className="flex-1 min-w-0 px-1 py-1.5 rounded border border-slate-300 font-bold text-[13px] text-slate-700 bg-white text-center focus:outline-none focus:border-brand"
                    >
                      <option value="">분</option>
                      {minutes.map((m) => (
                        <option key={m} value={m}>
                          {m}분
                        </option>
                      ))}
                    </select>
                  </div>

                  {!makeupData && schedules.length > 1 && (
                    <button
                      onClick={() => removeScheduleRow(idx)}
                      className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors shrink-0"
                      title="이 일정 삭제"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        ></path>
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!makeupData && (
              <button
                onClick={addScheduleRow}
                className="mt-3 w-full py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs font-bold transition-colors shadow-sm"
              >
                ➕ 날짜 추가하여 여러 번 한 번에 보강 등록하기
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">
                강의실 <span className="text-rose-500">*</span>
              </label>
              <select
                value={mClassroom}
                onChange={(e) => setMClassroom(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-brand"
              >
                <option value="">선택하세요</option>
                {["1강의실", "2강의실", "3강의실", "4강의실", "5강의실", "6강의실", "7강의실", "클리닉실"].map(
                  (c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  )
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">보강 상태</label>
              <select
                value={mStatus}
                onChange={(e) => setMStatus(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-brand"
              >
                <option value="예정">예정</option>
                <option value="진행중">진행중</option>
                <option value="완료">완료</option>
                <option value="취소">취소</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">보강 내용 및 목표 (단원)</label>
            <input
              type="text"
              value={mTopic}
              onChange={(e) => setMTopic(e.target.value)}
              placeholder="예: 2단원 방정식 재시험 및 오답"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-brand"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">강사 전달 메모</label>
            <textarea
              rows={2}
              value={mNote}
              onChange={(e) => setMNote(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-brand custom-scroll resize-none"
              placeholder="특이사항 메모"
            ></textarea>
          </div>

          {/* 하단: 개별 보강 안내 일반 문자(SMS/LMS) 템플릿 작성 & 미리보기 & 발송 대기열 전송 도구 */}
          <div className="bg-indigo-50/50 border border-indigo-200 rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="bg-indigo-600 text-white text-xs font-extrabold px-2 py-0.5 rounded shadow-sm">
                  일반 문자 (SMS/LMS)
                </span>
                <span className="text-sm font-bold text-slate-800">
                  [로지카대치본원학원] 보강 안내 문자 템플릿 (발송 대기열 연동)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowSmsPreview((prev) => !prev)}
                className="text-xs font-bold text-indigo-700 bg-white hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-lg transition-colors shadow-sm"
              >
                {showSmsPreview ? "🔼 미리보기 접기" : "🔍 발송 내용 미리보기"}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-bold text-slate-600">보강 일시</label>
                  {isSmsScheduleEdited && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSmsScheduleEdited(false);
                        setSmsScheduleCustom(autoGeneratedScheduleStr);
                      }}
                      className="text-[10px] font-bold text-indigo-600 hover:underline"
                    >
                      위 일정으로 자동동기화
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={smsScheduleCustom}
                  onChange={(e) => {
                    setIsSmsScheduleEdited(true);
                    setSmsScheduleCustom(e.target.value);
                  }}
                  placeholder="위 날짜/시간 선택 시 자동 입력됩니다"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-bold text-slate-600">강의실</label>
                  {isSmsClassroomEdited && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSmsClassroomEdited(false);
                        setSmsClassroomCustom(mClassroom || "");
                      }}
                      className="text-[10px] font-bold text-indigo-600 hover:underline"
                    >
                      위 강의실로 자동동기화
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={smsClassroomCustom}
                  onChange={(e) => {
                    setIsSmsClassroomEdited(true);
                    setSmsClassroomCustom(e.target.value);
                  }}
                  placeholder="위 강의실 선택 시 자동 입력됩니다"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold text-slate-600">상세 내용</label>
                {isSmsDetailsEdited && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSmsDetailsEdited(false);
                      setSmsDetailsCustom(autoGeneratedDetailsStr);
                    }}
                    className="text-[10px] font-bold text-indigo-600 hover:underline"
                  >
                    위 입력내용으로 자동동기화
                  </button>
                )}
              </div>
              <textarea
                rows={2}
                value={smsDetailsCustom}
                onChange={(e) => {
                  setIsSmsDetailsEdited(true);
                  setSmsDetailsCustom(e.target.value);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
                placeholder="담당 강사, 보강 단원, 전달 메모 등이 자동 반영됩니다."
              />
            </div>

            {showSmsPreview && (
              <div className="bg-slate-100 p-3.5 rounded-xl border border-slate-300 shadow-inner">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    📱 발송 대기열에 담길 일반 문자 미리보기
                  </span>
                  <span className="text-[11px] font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                    {selectedStudentObj ? (
                      parentTargets.length > 0 ? (
                        `수신: ${parentTargets.map((t) => `${t.finalName} ${t.phone}`).join(", ")}`
                      ) : (
                        `수신: ${selectedStudentObj.name} 학부모 (연락처 확인 필요)`
                      )
                    ) : (
                      "학생을 선택하면 수신 번호가 표시됩니다"
                    )}
                  </span>
                </div>

                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 max-w-md mx-auto text-xs text-slate-800 whitespace-pre-wrap leading-relaxed font-medium">
                  {fullPreviewText}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => handleQueueMakeupSms(false)}
                disabled={isQueueingSms}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {isQueueingSms ? "대기열 등록 중..." : "✉️ 문자 발송 대기열에 바로 담기"}
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center gap-2 shrink-0 flex-wrap">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors text-sm"
          >
            취소
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => saveMakeup(false)}
              disabled={isSaving}
              className="px-4 py-2.5 bg-slate-700 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-sm text-sm disabled:opacity-50"
            >
              {makeupData ? "변경사항만 저장" : "일정만 저장"}
            </button>
            <button
              onClick={() => saveMakeup(true)}
              disabled={isSaving}
              className="px-5 py-2.5 bg-brand text-white font-bold rounded-xl hover:bg-blue-900 transition-colors shadow-md text-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              <span>💾</span>
              <span>{makeupData ? "저장 + 문자 대기열 담기" : "일정 저장 + 문자 대기열 담기"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}