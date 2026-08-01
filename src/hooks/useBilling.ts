// src/hooks/useBilling.ts
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export function useBilling() {
  const [filterMonth, setFilterMonth] = useState("");
  const [filterClass, setFilterClass] = useState("all");
  const [filterName, setFilterName] = useState("");
  
  const [billingData, setBillingData] = useState<any[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, paid: 0, unpaid: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const today = new Date();
    setFilterMonth(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
    
    // 필터 및 검색용 기초 데이터 로드 (학교, 학년, 학부모 연락처 추가)
    Promise.all([
      supabase.from("class").select("class_id, name").order("name"),
      supabase.from("student").select("student_id, name, school, grade, parent(phone)").eq("status", "재원").order("name")
    ]).then(([classRes, stuRes]) => {
      if (classRes.data) setClasses(classRes.data);
      if (stuRes.data) setStudents(stuRes.data);
    });
  }, []);

  useEffect(() => {
    if (filterMonth) loadBillingData();
  }, [filterMonth, filterClass]);

  const loadBillingData = async () => {
    setIsLoading(true);
    setSelectedKeys([]);
    try {
      const [y, m] = filterMonth.split('-');
      const startDate = new Date(parseInt(y), parseInt(m) - 1, 1).toISOString();
      const endDate = new Date(parseInt(y), parseInt(m), 1).toISOString();

      const [billsRes, notiRes, enrollRes] = await Promise.all([
        supabase.from("academy_billing").select("*, student!inner(name, phone, parent_id, parent(phone)), class!inner(name, tuition_fee)").eq("billing_month", filterMonth),
        supabase.from("notification_log").select("message_content").eq("noti_type", "BILLING_ALERT").gte("created_at", startDate).lt("created_at", endDate),
        supabase.from("enrollment").select("student_id, class_id, class!inner(name, tuition_fee), student!inner(name, status, phone, parent_id, parent(phone))").eq("student.status", "재원").gt("class.tuition_fee", 0)
      ]);

      const sentBillIds = (notiRes.data || []).map(n => {
        const match = n.message_content.match(/\[BILL_ID:(\d+)\]/);
        return match ? parseInt(match[1]) : null;
      }).filter(Boolean);

      const merged: any[] = [];
      const billMap = new Set();
      let tBill = 0, tPaid = 0, tUnpaid = 0;

      billsRes.data?.forEach((b: any) => {
        billMap.add(`${b.student_id}_${b.class_id}`);
        if (filterClass !== "all" && b.class_id !== filterClass) return;
        if (filterName && !b.student.name.includes(filterName)) return;

        const kanbanStatus = b.status === "완납" ? "납부완료" : sentBillIds.includes(b.billing_id) ? "발송됨" : "미전송";
        const contact = b.student.parent?.phone || b.student.phone || "";
        const finalAmt = parseInt(b.amount) || 0;

        tBill += finalAmt;
        if (b.status === "완납") tPaid += finalAmt; else tUnpaid += finalAmt;

        merged.push({
          key: `${b.student_id}_${b.class_id}`, billing_id: b.billing_id, student_id: b.student_id, class_id: b.class_id,
          student_name: b.student.name, class_name: b.class.name,
          base_fee: parseInt(b.amount) + parseInt(b.discount_amount || 0), discount_amount: parseInt(b.discount_amount) || 0,
          final_amount: finalAmt, due_date: b.due_date || "-", status: b.status, kanban_status: kanbanStatus, is_issued: true, contact
        });
      });

      enrollRes.data?.forEach((e: any) => {
        const key = `${e.student_id}_${e.class_id}`;
        if (!billMap.has(key)) {
          if (filterClass !== "all" && e.class_id !== filterClass) return;
          if (filterName && !e.student.name.includes(filterName)) return;

          const contact = e.student.parent?.phone || e.student.phone || "";
          const baseFee = parseInt(e.class.tuition_fee) || 0;

          tBill += baseFee; tUnpaid += baseFee;

          merged.push({
            key, billing_id: null, student_id: e.student_id, class_id: e.class_id,
            student_name: e.student.name, class_name: e.class.name,
            base_fee: baseFee, discount_amount: 0, final_amount: baseFee, due_date: "-",
            status: "미발행", kanban_status: "미발행", is_issued: false, contact
          });
        }
      });

      merged.sort((a, b) => a.student_name.localeCompare(b.student_name));
      setBillingData(merged);
      setStats({ total: tBill, paid: tPaid, unpaid: tUnpaid });
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const exportPaybillExcel = () => {
    const targets = selectedKeys.length > 0 
      ? selectedKeys.map(k => billingData.find(d => d.key === k)).filter(Boolean)
      : billingData.filter(d => d.kanban_status !== '납부완료');

    if (targets.length === 0) return alert("추출할 대상이 없습니다.");

    let csvContent = '\uFEFF소속,받는사람,모바일번호,청구금액,청구사유,안내메시지\n';
    targets.forEach((t: any) => {
      const className = `"${(t.class_name || '').replace(/"/g, '""')}"`;
      const studentName = `"${(t.student_name || '').replace(/"/g, '""')}"`;
      const phone = `="${(t.contact || '').replace(/[^0-9]/g, '')}"`;
      const amount = t.final_amount;
      const reason = `"Logica ${filterMonth} 수강료"`;
      const msg = `"안녕하세요. Logica 학원입니다. ${filterMonth}월 수강료 청구서입니다."`;

      csvContent += `${className},${studentName},${phone},${amount},${reason},${msg}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    // 💡 저장되는 파일명을 요청하신 대로 변경했습니다.
    link.download = `업로드용_대량청구_${filterMonth}.csv`;
    link.click();
  };

  const executeAction = async (targetKanbanStatus: string, action: string) => {
    const targets = selectedKeys.map(k => billingData.find(d => d.key === k)).filter(d => d && d.kanban_status === targetKanbanStatus);
    if (targets.length === 0) return alert("해당 영역에서 체크된 카드가 없습니다.");

    const msgs: any = {
      'issue': "선택한 청구서를 발행하시겠습니까?", 'issue_send': "선택 청구서를 발행하고 즉시 알림톡을 발송하시겠습니까?", 'cancel_issue': "선택한 청구서의 발행을 취소하시겠습니까?",
      'send': "선택한 청구서에 대해 알림톡을 발송하시겠습니까?", 'pay': "선택한 항목을 직접 납부 완료 처리하시겠습니까?", 
      'mark_unpaid': "'미납' 상태로 전환하여 미납 관리 페이지로 넘기시겠습니까?", 'delete': "DB에서 완전히 삭제하시겠습니까?"
    };
    if (!confirm(msgs[action])) return;

    const [y, m] = filterMonth.split('-');
    const due = `${filterMonth}-${new Date(parseInt(y), parseInt(m), 0).getDate()}`;

    try {
      if (action === 'issue' || action === 'issue_send') {
        const ins = targets.map((t: any) => ({ student_id: t.student_id, class_id: t.class_id, billing_month: filterMonth, amount: t.final_amount, discount_amount: t.discount_amount, due_date: due, status: '청구' }));
        const { data: bData } = await supabase.from('academy_billing').insert(ins).select();
        
        if (action === 'issue_send' && bData) {
          const notis = bData.map(b => {
            const t = targets.find((x: any) => x.student_id === b.student_id && x.class_id === b.class_id) || {};
            return { receiver_phone: t.contact || '01000000000', noti_type: 'BILLING_ALERT', message_content: `[BILL_ID:${b.billing_id}] 청구서 발행`, status: '발송완료' };
          });
          await supabase.from('notification_log').insert(notis);
        }
      }
      else if (action === 'cancel_issue' || action === 'delete') {
        const ids = targets.map((t: any) => t.billing_id);
        await supabase.from('payment_history').delete().in('billing_id', ids);
        await supabase.from('academy_billing').delete().in('billing_id', ids);
      }
      else if (action === 'send') {
        const notis = targets.map((t: any) => ({ receiver_phone: t.contact || '01000000000', noti_type: 'BILLING_ALERT', message_content: `[BILL_ID:${t.billing_id}] 청구서 발행`, status: '발송완료' }));
        await supabase.from('notification_log').insert(notis);
      }
      else if (action === 'pay') {
        const method = prompt("결제 수단을 입력하세요", "계좌이체");
        if (!method) return;
        const ids = targets.map((t: any) => t.billing_id);
        await supabase.from('academy_billing').update({ status: '완납' }).in('billing_id', ids);
        const hists = targets.map((t: any, idx) => ({ billing_id: t.billing_id, payment_method: method, paid_amount: t.final_amount, transaction_key: `BATCH_${Date.now()}_${idx}` }));
        await supabase.from('payment_history').insert(hists);
      }
      else if (action === 'mark_unpaid') {
        const ids = targets.map((t: any) => t.billing_id);
        await supabase.from('academy_billing').update({ status: '미납' }).in('billing_id', ids);
      }

      alert("처리가 완료되었습니다.");
      loadBillingData();
    } catch (e: any) { alert("처리 중 오류: " + e.message); }
  };

  const saveDiscount = async (discItem: any, discAmount: number) => {
    const finalAmt = Math.max(0, discItem.base_fee - discAmount);
    const [y, m] = filterMonth.split('-');
    const due = `${filterMonth}-${new Date(parseInt(y), parseInt(m), 0).getDate()}`;

    try {
      if (discItem.is_issued) {
        await supabase.from('academy_billing').update({ discount_amount: discAmount, amount: finalAmt }).eq('billing_id', discItem.billing_id);
      } else {
        await supabase.from('academy_billing').insert({ student_id: discItem.student_id, class_id: discItem.class_id, billing_month: filterMonth, amount: finalAmt, discount_amount: discAmount, due_date: due, status: '청구' });
      }
      loadBillingData();
      return true;
    } catch (e: any) { 
      alert("할인 적용 오류: " + e.message); 
      return false;
    }
  };

  return {
    filterMonth, setFilterMonth, filterClass, setFilterClass, filterName, setFilterName,
    billingData, classes, students, stats, isLoading, loadBillingData,
    selectedKeys, setSelectedKeys, executeAction, exportPaybillExcel, saveDiscount
  };
}