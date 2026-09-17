"use client";

import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export default function UnlockPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("exam_assignment")
        .select("assignment_id, student_id, status, total_score, created_at, student(name), exam_master(title)")
        .eq("status", "제출완료")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setRows(data || []);
    } catch (e: any) {
      console.error("[잠금해제] 목록 조회 실패", e);
      alert("목록을 불러오지 못했습니다: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // 15초마다 자동 갱신
    return () => clearInterval(t);
  }, [load]);

  const unlock = async (assignmentId: number, name: string) => {
    if (!confirm(`[${name}] 학생의 채점을 확정하고 잠금을 풀까요?`)) return;
    setBusyId(assignmentId);
    try {
      const { error } = await supabase
        .from("exam_assignment")
        .update({ status: "채점확정" })
        .eq("assignment_id", assignmentId);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert("해제 실패: " + (e?.message || e));
    } finally {
      setBusyId(null);
    }
  };

  const unwrap = (v: any) => (Array.isArray(v) ? v[0] : v);

  return (
    <div className="bg-white border border-amber-300 rounded-xl shadow-sm overflow-hidden">
      <div className="bg-amber-500 text-white px-4 py-2 flex justify-between items-center">
        <span className="font-bold text-[13px]">🔓 채점 확인 대기 ({rows.length})</span>
        <button
          onClick={load}
          className="text-[11px] bg-white/20 hover:bg-white/30 px-2 py-1 rounded font-bold"
        >
          {loading ? "..." : "새로고침"}
        </button>
      </div>

      <div className="max-h-[300px] overflow-y-auto divide-y divide-slate-100">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-[12px] font-bold">
            대기 중인 학생이 없습니다.
          </div>
        ) : (
          rows.map((r) => {
            const name = unwrap(r.student)?.name || "알수없음";
            const title = unwrap(r.exam_master)?.title || "-";
            return (
              <div key={r.assignment_id} className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-extrabold text-slate-800 text-[13px] truncate">{name}</div>
                  <div className="text-[10px] text-slate-500 truncate">{title}</div>
                  <div className="text-[10px] text-slate-400">가채점 {r.total_score ?? 0}점</div>
                </div>
                <button
                  onClick={() => unlock(r.assignment_id, name)}
                  disabled={busyId === r.assignment_id}
                  className="shrink-0 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-[11px] font-bold px-3 py-2 rounded-lg"
                >
                  {busyId === r.assignment_id ? "처리중" : "확정 & 해제"}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}