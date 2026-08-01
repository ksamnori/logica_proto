// src/app/(dashboard)/shop-admin/page.tsx
"use client";

import React, { useEffect, useRef, useState } from 'react';
import { getProducts, addProduct, deleteProduct, getPurchases, ShopProduct, ShopPurchase } from '@/lib/mockShop';

export default function ShopAdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [purchases, setPurchases] = useState<ShopPurchase[]>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const role = localStorage.getItem('logica_instructor_role') || '';
    const pos = localStorage.getItem('logica_instructor_position') || '';
    setIsAdmin(['ADMIN', 'MANAGER', 'PRINCIPAL', 'SUPER_ADMIN'].includes(role.toUpperCase()) || pos.includes('원장') || pos.includes('실장') || pos.includes('최고관리자') || pos.includes('대장'));
    setProducts(getProducts());
    setPurchases(getPurchases());
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const resetForm = () => {
    setName(''); setDescription(''); setPrice(''); setImageDataUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = Number(price);
    if (!name.trim()) { alert('상품명을 입력해주세요.'); return; }
    if (!Number.isFinite(priceNum) || priceNum < 0) { alert('가격을 올바르게 입력해주세요.'); return; }
    addProduct({ name: name.trim(), description: description.trim(), price: priceNum, imageDataUrl });
    setProducts(getProducts());
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('이 상품을 삭제할까요?')) return;
    deleteProduct(id);
    setProducts(getProducts());
  };

  if (isAdmin === null) return null;
  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border border-slate-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-extrabold text-rose-600 mb-2">접근 권한 없음</h2>
          <p className="text-sm text-slate-500 font-bold">상점 관리는 원장/실장 및 최고관리자만 접속할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-black text-slate-800">🛒 포인트 상점 관리</h1>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">임시(목업) 버전</span>
        </div>
        <p className="text-sm text-slate-400 font-medium mb-6">
          상품/구매내역은 이 브라우저(localStorage)에만 저장되는 임시 데모입니다. 실제 DB 연동은 추후 작업 예정입니다.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
          {/* 상품 등록 폼 */}
          <form onSubmit={handleAdd} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 h-fit space-y-4">
            <h2 className="font-bold text-slate-700 text-sm">새 상품 등록</h2>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">상품 이미지</label>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" id="shop-img-upload" />
              <label htmlFor="shop-img-upload" className="block w-full aspect-square rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer overflow-hidden flex items-center justify-center transition-colors">
                {imageDataUrl ? <img src={imageDataUrl} className="w-full h-full object-cover" /> : <span className="text-xs font-bold text-slate-400">📷 이미지 업로드</span>}
              </label>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">상품명</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="예: 학원 굿즈 연필" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#002864]" />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">설명 (선택)</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="상품 설명" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#002864] resize-none" />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">가격 (P)</label>
              <input type="number" min={0} value={price} onChange={e => setPrice(e.target.value)} placeholder="1000" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#002864]" />
            </div>

            <button type="submit" className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold py-3 rounded-xl shadow-sm transition-colors">상품 등록</button>
          </form>

          {/* 상품 목록 + 구매내역 */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h2 className="font-bold text-slate-700 text-sm mb-4">등록된 상품 <span className="text-slate-400 font-normal">({products.length}개)</span></h2>
              {products.length === 0 ? (
                <p className="text-center text-slate-300 text-sm py-8">등록된 상품이 없습니다.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {products.map(p => (
                    <div key={p.id} className="border border-slate-200 rounded-xl overflow-hidden group relative">
                      <div className="aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
                        {p.imageDataUrl ? <img src={p.imageDataUrl} className="w-full h-full object-cover" /> : <span className="text-3xl">🎁</span>}
                      </div>
                      <div className="p-3">
                        <p className="font-bold text-slate-800 text-xs truncate">{p.name}</p>
                        <p className="text-amber-600 font-black text-sm mt-0.5">{p.price.toLocaleString()} P</p>
                      </div>
                      <button onClick={() => handleDelete(p.id)} className="absolute top-2 right-2 bg-white/90 hover:bg-rose-50 text-rose-500 text-xs font-bold w-7 h-7 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h2 className="font-bold text-slate-700 text-sm mb-4">구매내역 <span className="text-slate-400 font-normal">({purchases.length}건)</span></h2>
              {purchases.length === 0 ? (
                <p className="text-center text-slate-300 text-sm py-8">아직 구매 기록이 없습니다.</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {purchases.map(o => (
                    <div key={o.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
                      <div>
                        <span className="font-bold text-slate-700">{o.studentName}</span>
                        <span className="text-slate-400 mx-1.5">·</span>
                        <span className="text-slate-500">{o.productName}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-amber-600">-{o.pricePaid.toLocaleString()}P</span>
                        <span className="text-[10px] text-slate-400 ml-2">{new Date(o.purchasedAt).toLocaleString('ko-KR')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
