// src/app/(dashboard)/shop-admin/page.tsx
"use client";

import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { listProducts, createProduct, updateProduct, deleteProduct, listPurchases, cancelPurchase, ShopProduct, ShopPurchase } from '@/app/actions/shopProducts';

export default function ShopAdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [purchases, setPurchases] = useState<ShopPurchase[]>([]);
  const [purchaseSearch, setPurchaseSearch] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState(''); // 빈 값 = 무제한
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadProducts = () => listProducts().then(setProducts).catch(err => console.error('상품 조회 중 오류:', err));
  const loadPurchases = () => listPurchases().then(setPurchases).catch(err => console.error('구매내역 조회 중 오류:', err));
  const reload = () => { loadProducts(); loadPurchases(); };

  useEffect(() => {
    const role = localStorage.getItem('logica_instructor_role') || '';
    const pos = localStorage.getItem('logica_instructor_position') || '';
    setIsAdmin(['ADMIN', 'MANAGER', 'PRINCIPAL', 'SUPER_ADMIN'].includes(role.toUpperCase()) || pos.includes('원장') || pos.includes('실장') || pos.includes('최고관리자') || pos.includes('대장'));
    reload();
  }, []);

  // 💡 상품 목록만 실시간으로 동기화한다(다른 관리자가 동시에 상품을 추가/수정/삭제해도 새로고침
  // 없이 반영됨). 구매내역/포인트는 학생 개인정보가 섞여 있어 anon 키로 공개 조회를 열어두지
  // 않았으므로(RLS로 계속 막아둠) 실시간 구독 대상이 아니다 — 액션 실행 뒤 reload()로 갱신한다.
  useEffect(() => {
    const channel = supabase.channel('shop_product_admin_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_product' }, () => loadProducts())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const resetForm = () => {
    setEditingId(null);
    setName(''); setDescription(''); setPrice(''); setStock(''); setImageDataUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startEdit = (p: ShopProduct) => {
    setEditingId(p.id);
    setName(p.name); setDescription(p.description); setPrice(String(p.price));
    setStock(p.stock === null ? '' : String(p.stock));
    setImageDataUrl(p.imageDataUrl);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = Number(price);
    // 💡 소수점 가격을 막는다 — Number.isInteger는 "12.0" 같은 표기는 통과시키지만 진짜 정수값만
    // 허용하므로, 사용자가 "1000.5"를 입력하면 여기서 걸러진다.
    if (!name.trim()) { alert('상품명을 입력해주세요.'); return; }
    if (!Number.isInteger(priceNum) || priceNum < 0) { alert('가격은 0 이상의 정수로 입력해주세요.'); return; }
    let stockNum: number | null = null;
    if (stock.trim() !== '') {
      stockNum = Number(stock);
      if (!Number.isInteger(stockNum) || stockNum < 0) { alert('재고는 0 이상의 정수로 입력해주세요(비워두면 무제한).'); return; }
    }
    setSubmitting(true);
    try {
      const input = { name: name.trim(), description: description.trim(), price: priceNum, imageDataUrl, stock: stockNum };
      const result = editingId ? await updateProduct(editingId, input) : await createProduct(input);
      if (!result) { alert(editingId ? '상품 수정에 실패했습니다.' : '상품 등록에 실패했습니다.'); return; }
      loadProducts();
      resetForm();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('이 상품을 삭제할까요? (이미 구매된 학생의 구매내역은 그대로 남습니다)')) return;
    const result = await deleteProduct(id);
    if (!result.success) { alert(result.message || '삭제에 실패했습니다.'); return; }
    if (editingId === id) resetForm();
    loadProducts();
  };

  const handleCancel = async (purchase: ShopPurchase) => {
    if (!window.confirm(`${purchase.studentName} 학생의 [${purchase.productName}] 구매를 취소할까요?\n포인트 ${purchase.pricePaid.toLocaleString()}P가 환불되고, 재고가 있는 상품이면 재고도 복원됩니다.`)) return;
    const result = await cancelPurchase(purchase.id);
    if (!result.success) { alert(result.message || '취소에 실패했습니다.'); return; }
    loadPurchases();
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

  const filteredPurchases = purchaseSearch.trim()
    ? purchases.filter(p => p.studentName.toLowerCase().includes(purchaseSearch.trim().toLowerCase()))
    : purchases;

  const statusBadge = (p: ShopPurchase) => {
    if (p.status === 'cancelled') return <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">취소됨</span>;
    return null;
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-black text-slate-800 mb-6">🛒 포인트 상점 관리</h1>

        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
          {/* 상품 등록/수정 폼 */}
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 h-fit space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-700 text-sm">{editingId ? '상품 수정' : '새 상품 등록'}</h2>
              {editingId && <button type="button" onClick={resetForm} className="text-[11px] font-bold text-slate-400 hover:text-slate-600">취소하고 새로 등록</button>}
            </div>

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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">가격 (P)</label>
                <input type="number" min={0} step={1} value={price} onChange={e => setPrice(e.target.value)} placeholder="1000" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#002864]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">재고 (비우면 무제한)</label>
                <input type="number" min={0} step={1} value={stock} onChange={e => setStock(e.target.value)} placeholder="예: 10" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#002864]" />
              </div>
            </div>

            <button type="submit" disabled={submitting} className="w-full bg-[#002864] hover:bg-blue-900 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-sm transition-colors">{submitting ? '처리 중...' : editingId ? '수정 완료' : '상품 등록'}</button>
          </form>

          {/* 상품 목록 + 실물 수령 대기 + 구매내역 */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h2 className="font-bold text-slate-700 text-sm mb-4">등록된 상품 <span className="text-slate-400 font-normal">({products.length}개)</span></h2>
              {products.length === 0 ? (
                <p className="text-center text-slate-300 text-sm py-8">등록된 상품이 없습니다.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {products.map(p => (
                    <div key={p.id} className={`border rounded-xl overflow-hidden group relative ${editingId === p.id ? 'border-[#002864] ring-2 ring-blue-100' : 'border-slate-200'}`}>
                      <div className="aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
                        {p.imageDataUrl ? <img src={p.imageDataUrl} className="w-full h-full object-cover" /> : <span className="text-3xl">🎁</span>}
                      </div>
                      <div className="p-3">
                        <p className="font-bold text-slate-800 text-xs truncate">{p.name}</p>
                        <p className="text-amber-600 font-black text-sm mt-0.5">{p.price.toLocaleString()} P</p>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-[9px] text-slate-400">{p.stock === null ? '무제한' : `재고 ${p.stock}`}</span>
                        </div>
                      </div>
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(p)} title="수정" className="bg-white/90 hover:bg-blue-50 text-[#002864] text-xs font-bold w-7 h-7 rounded-full shadow-sm flex items-center justify-center">✏️</button>
                        <button onClick={() => handleDelete(p.id)} title="삭제" className="bg-white/90 hover:bg-rose-50 text-rose-500 text-xs font-bold w-7 h-7 rounded-full shadow-sm flex items-center justify-center">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-slate-700 text-sm">구매내역 <span className="text-slate-400 font-normal">({filteredPurchases.length}{purchaseSearch.trim() ? ` / 전체 ${purchases.length}` : ''}건)</span></h2>
                <input value={purchaseSearch} onChange={e => setPurchaseSearch(e.target.value)} placeholder="학생 이름 검색" className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 w-36 focus:outline-none focus:border-[#002864]" />
              </div>
              {filteredPurchases.length === 0 ? (
                <p className="text-center text-slate-300 text-sm py-8">{purchaseSearch.trim() ? '검색 결과가 없습니다.' : '아직 구매 기록이 없습니다.'}</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {filteredPurchases.map(o => (
                    <div key={o.id} className={`flex items-center justify-between border-b border-slate-100 pb-2 text-sm ${o.status === 'cancelled' ? 'opacity-50' : ''}`}>
                      <div>
                        <span className="font-bold text-slate-700">{o.studentName}</span>
                        <span className="text-slate-400 mx-1.5">·</span>
                        <span className={`text-slate-500 ${o.status === 'cancelled' ? 'line-through' : ''}`}>{o.productName}</span>
                        {statusBadge(o)}
                      </div>
                      <div className="text-right flex items-center gap-2 shrink-0">
                        <div>
                          <span className="font-bold text-amber-600">-{o.pricePaid.toLocaleString()}P</span>
                          <span className="text-[10px] text-slate-400 ml-2">{new Date(o.purchasedAt).toLocaleString('ko-KR')}</span>
                        </div>
                        {o.status !== 'cancelled' && (
                          <button onClick={() => handleCancel(o)} className="text-[10px] font-bold text-rose-500 hover:text-rose-700 shrink-0">취소</button>
                        )}
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
