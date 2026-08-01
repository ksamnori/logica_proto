// src/app/student/shop/page.tsx
"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getProducts, getPointBalance, purchaseProduct, ShopProduct } from '@/lib/mockShop';

export default function StudentShopPage() {
  const router = useRouter();
  const [studentInfo, setStudentInfo] = useState({ id: '', name: '' });
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [points, setPoints] = useState(0);
  const [confirmTarget, setConfirmTarget] = useState<ShopProduct | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const sId = localStorage.getItem('logica_student_id');
    const sName = localStorage.getItem('logica_student_name');
    if (!sId || !sName) { router.push('/student/login'); return; }
    setStudentInfo({ id: sId, name: sName });
    setProducts(getProducts());
    setPoints(getPointBalance(sId));
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const confirmPurchase = () => {
    if (!confirmTarget) return;
    const ok = purchaseProduct(studentInfo.id, studentInfo.name, confirmTarget);
    if (ok) {
      setPoints(getPointBalance(studentInfo.id));
      setToast(`🎉 [${confirmTarget.name}] 구매 완료!`);
    } else {
      setToast('포인트가 부족합니다.');
    }
    setConfirmTarget(null);
  };

  return (
    <div className="min-h-screen bg-slate-100 font-['Pretendard']">
      <nav className="bg-white px-8 py-4 flex justify-between items-center border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/student/portal')} className="text-slate-400 hover:text-slate-700 font-bold text-sm">← 포탈로</button>
          <h1 className="text-lg font-black text-[#002864]">🛒 포인트 상점</h1>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">임시(목업) 버전</span>
        </div>
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-4 py-2 shadow-sm">
          <span className="text-amber-500 text-lg font-black font-lexend">{points.toLocaleString()} P</span>
        </div>
      </nav>

      <main className="max-w-[1200px] mx-auto p-6 md:p-8">
        {products.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-slate-400 font-bold">
            아직 등록된 상품이 없습니다. 선생님이 상품을 추가할 때까지 기다려주세요!
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {products.map(p => {
              const affordable = points >= p.price;
              return (
                <div key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
                    {p.imageDataUrl ? <img src={p.imageDataUrl} className="w-full h-full object-cover" /> : <span className="text-4xl">🎁</span>}
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="font-bold text-slate-800 text-sm truncate">{p.name}</h3>
                    {p.description && <p className="text-xs text-slate-400 mt-1 line-clamp-2 flex-1">{p.description}</p>}
                    <div className="flex items-center justify-between mt-3">
                      <span className="font-black text-amber-600 font-lexend">{p.price.toLocaleString()} P</span>
                      <button onClick={() => setConfirmTarget(p)} disabled={!affordable} className="bg-[#002864] hover:bg-blue-900 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors">
                        {affordable ? '구매하기' : '포인트 부족'}
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
            <p className="text-sm text-slate-500 mb-5">{confirmTarget.price.toLocaleString()} P를 사용해서 구매할까요?</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmTarget(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-semibold hover:bg-slate-50">취소</button>
              <button onClick={confirmPurchase} className="flex-1 py-2.5 rounded-xl bg-[#002864] text-white text-sm font-semibold shadow-md hover:bg-blue-900">구매 확정</button>
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
