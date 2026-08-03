// src/app/student/shop/page.tsx
"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { listProducts, purchaseProduct, ShopProduct } from '@/app/actions/shopProducts';
import { getPointBalance } from '@/app/actions/shopPoints';
import PointBadge from '@/components/clinic/PointBadge';

export default function StudentShopPage() {
  const router = useRouter();
  const [studentInfo, setStudentInfo] = useState({ id: '', name: '' });
  const [products, setProducts] = useState<ShopProduct[]>([]);
  // 💡 0으로 초기화해두면, 비동기로 실제 잔액이 로드되는 순간 PointBadge가 "0 → 실제잔액"을
  // 진짜 적립으로 착각해서 페이지에 들어올 때마다 튀어오르는 애니메이션이 떴다. null(아직 모름)로
  // 시작해서, 처음으로 값이 채워지는 렌더에서는 애니메이션이 절대 트리거되지 않게 한다.
  const [points, setPoints] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ShopProduct | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [toast, setToast] = useState('');

  const loadProducts = () => listProducts().then(setProducts).catch(err => console.error('상품 조회 중 오류:', err));

  useEffect(() => {
    const sId = localStorage.getItem('logica_student_id');
    const sName = localStorage.getItem('logica_student_name');
    if (!sId || !sName) { router.push('/student/login'); return; }
    setStudentInfo({ id: sId, name: sName });
    loadProducts();
    getPointBalance(sId).then(setPoints).catch(err => console.error('포인트 조회 중 오류:', err));
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // 💡 선생님이 다른 화면에서 상품을 추가/수정/삭제하거나 재고가 바뀌면, 새로고침 없이 바로
  // 반영되도록 상품 목록만 실시간 구독한다(구매내역/포인트는 개인정보라 공개 구독 대상이 아님).
  useEffect(() => {
    const channel = supabase.channel('shop_product_student_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_product' }, () => loadProducts())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const confirmPurchase = async () => {
    if (!confirmTarget || purchasing) return;
    setPurchasing(true);
    try {
      const result = await purchaseProduct(studentInfo.id, studentInfo.name, confirmTarget.id);
      if (result.success) {
        setPoints(await getPointBalance(studentInfo.id));
        loadProducts(); // 재고가 줄었을 수 있으니 다시 불러온다
        setToast(`🎉 [${confirmTarget.name}] 구매 완료!`);
      } else {
        setToast(result.message || '구매에 실패했습니다.');
      }
    } finally {
      setPurchasing(false);
      setConfirmTarget(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 font-['Pretendard']">
      <nav className="bg-white px-8 py-4 flex justify-between items-center border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/student/portal')} className="text-slate-400 hover:text-slate-700 font-bold text-sm">← 포탈로</button>
          <h1 className="text-lg font-black text-[#002864]">🛒 포인트 상점</h1>
        </div>
        <PointBadge points={points} className="bg-amber-50 border-amber-200 text-amber-600" />
      </nav>

      <main className="max-w-[1200px] mx-auto p-6 md:p-8">
        {products.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-slate-400 font-bold">
            아직 등록된 상품이 없습니다. 선생님이 상품을 추가할 때까지 기다려주세요!
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {products.map(p => {
              const soldOut = p.stock !== null && p.stock <= 0;
              const affordable = points !== null && points >= p.price;
              const canBuy = affordable && !soldOut;
              return (
                <div key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="aspect-square bg-slate-100 flex items-center justify-center overflow-hidden relative">
                    {p.imageDataUrl ? <img src={p.imageDataUrl} className="w-full h-full object-cover" /> : <span className="text-4xl">🎁</span>}
                    {soldOut && (
                      <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center">
                        <span className="text-white font-black text-sm">품절</span>
                      </div>
                    )}
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="font-bold text-slate-800 text-sm truncate">{p.name}</h3>
                    {p.description && <p className="text-xs text-slate-400 mt-1 line-clamp-2 flex-1">{p.description}</p>}
                    {p.stock !== null && !soldOut && <p className="text-[10px] text-slate-400 mt-1">재고 {p.stock}개</p>}
                    <div className="flex items-center justify-between mt-3">
                      <span className="font-black text-amber-600 font-lexend">{p.price.toLocaleString()} P</span>
                      <button onClick={() => setConfirmTarget(p)} disabled={!canBuy} className="bg-[#002864] hover:bg-blue-900 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors">
                        {soldOut ? '품절' : affordable ? '구매하기' : points !== null ? `${(p.price - points).toLocaleString()}P 부족` : '포인트 부족'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {confirmTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl">
            <p className="font-bold text-slate-800 mb-1">[{confirmTarget.name}]</p>
            <p className="text-sm text-slate-500 mb-2">{confirmTarget.price.toLocaleString()} P를 사용해서 구매할까요?</p>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setConfirmTarget(null)} disabled={purchasing} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">취소</button>
              <button onClick={confirmPurchase} disabled={purchasing} className="flex-1 py-2.5 rounded-xl bg-[#002864] text-white text-sm font-semibold shadow-md hover:bg-blue-900 disabled:opacity-50">{purchasing ? '처리 중...' : '구매 확정'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-full shadow-2xl z-50 animate-[fadeIn_0.2s_ease-out]">
          {toast}
        </div>
      )}
    </div>
  );
}
