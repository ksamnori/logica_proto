// src/hooks/useUnpaid.ts
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

export function useUnpaid() {
  const [viewMode, setViewMode] = useState<"student" | "class">("student");
  const [unpaidData, setUnpaidData] = useState<any[]>([]);
  const [sendCounts, setSendCounts] = useState<{ [key: number]: number }>({});
  const [isLoading, setIsLoading] = useState(true);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [smsTemplate, setSmsTemplate] = useState("[{학원명}] 미납 안내\n{학생명} 수강생의 수강료 {미납액}원 납부 바랍니다.");
  const [sendTime, setSendTime] = useState<"now" | "reserve">("now");
  const [resDate, setResDate] = useState("");
  const [resTime, setResTime] = useState("");
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadUnpaidBills();
  }, []);

  const loadUnpaidBills = async () => {
    setIsLoading(true);
    setSelectedIds([]);
    try {
      const { data: bills, error } = await supabase
        .from('academy_billing')
        .select('*, student(name, phone, parent(phone)), class(name)')
        .eq('status', '미납')
        .order('billing_month', { ascending: false });

      if (error) throw error;
      setUnpaidData(bills || []);

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const { data: notiLogs } = await supabase
        .from('notification_log')
        .select('message_content')
        .eq('noti_type', 'UNPAID_ALERT')
        .gte('created_at', sixMonthsAgo.toISOString());

      const counts: { [key: number]: number } = {};
      notiLogs?.forEach((n: any) => {
        const match = n.message_content?.match(/\[BILL_ID:(\d+)\]/);
        if (match) {
          const bId = parseInt(match[1]);
          counts[bId] = (counts[bId] || 0) + 1;
        }
      });
      setSendCounts(counts);

    } catch (e: any) {
      alert("데이터 로드 중 에러가 발생했습니다:\n" + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAll = (checked: boolean) => {
    if (checked) setSelectedIds(unpaidData.map(item => item.billing_id));
    else setSelectedIds([]);
  };

  const toggleRowCheck = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const getSortedData = () => {
    const sorted = [...unpaidData];
    if (viewMode === 'class') {
      sorted.sort((a, b) => {
        const cA = a.class?.name || '분류없음';
        const cB = b.class?.name || '분류없음';
        const nA = a.student?.name || '이름없음';
        const nB = b.student?.name || '이름없음';
        if (cA === cB) return nA.localeCompare(nB);
        return cA.localeCompare(cB);
      });
    } else {
      sorted.sort((a, b) => {
        const nA = a.student?.name || '이름없음';
        const nB = b.student?.name || '이름없음';
        return nA.localeCompare(nB);
      });
    }
    return sorted;
  };

  const handleInsertVar = (val: string) => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const newText = smsTemplate.substring(0, start) + val + smsTemplate.substring(end);
    setSmsTemplate(newText);
    
    setTimeout(() => {
      textareaRef.current!.selectionStart = textareaRef.current!.selectionEnd = start + val.length;
      textareaRef.current!.focus();
    }, 0);
  };

  const getSmsBytes = () => {
    let bytes = 0;
    for (let i = 0; i < smsTemplate.length; i++) bytes += (smsTemplate.charCodeAt(i) > 127) ? 2 : 1;
    return bytes;
  };

  const sendUnpaidSms = async () => {
    if (selectedIds.length === 0) return alert("발송할 대상을 체크박스로 선택해주세요.");
    if (sendTime === 'reserve' && (!resDate || !resTime)) return alert("예약 날짜와 시간을 입력해주세요.");

    const targets = selectedIds.map(id => unpaidData.find(d => d.billing_id === id)).filter(Boolean);

    try {
      const payloads = targets.map((item: any) => {
        const studentName = item.student?.name || '학생';
        const studentContact = item.student?.parent?.phone || item.student?.phone || '01000000000';
        
        const msg = smsTemplate
          .replace(/{학생명}/g, studentName)
          .replace(/{학원명}/g, '로지카학원')
          .replace(/{미납액}/g, (parseInt(item.amount) || 0).toLocaleString());

        let sentAt = null;
        if (sendTime === 'reserve') {
          sentAt = new Date(`${resDate}T${resTime}`).toISOString();
        } else {
          sentAt = new Date().toISOString();
        }

        // 💡 알림(Notification) 테이블은 전 지점 공용으로 쏴주는 테이블이라 tenant_id 꼬리표가 따로 없습니다.
        // 따라서 기존대로 보내기만 하면 됩니다.
        return {
          receiver_phone: studentContact, 
          noti_type: 'UNPAID_ALERT',
          message_content: `[BILL_ID:${item.billing_id}] ` + msg,
          status: sendTime === 'reserve' ? '대기' : '발송완료',
          sent_at: sentAt
        };
      });

      const { error } = await supabase.from('notification_log').insert(payloads);
      if (error) throw error;

      alert(`선택하신 ${selectedIds.length}건이 ${sendTime === 'reserve' ? '성공적으로 예약' : '즉시 발송'} 처리되었습니다!`);
      setSelectedIds([]);
      loadUnpaidBills(); 

    } catch (err: any) {
      alert("발송 처리 중 에러가 발생했습니다:\n" + err.message);
    }
  };

  return {
    viewMode, setViewMode, unpaidData, sendCounts, isLoading, selectedIds,
    smsTemplate, setSmsTemplate, sendTime, setSendTime, resDate, setResDate, resTime, setResTime,
    textareaRef, toggleAll, toggleRowCheck, getSortedData, handleInsertVar, getSmsBytes, sendUnpaidSms
  };
}