// src/app/(dashboard)/shop-admin/page.tsx
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { listProducts, createProduct, updateProduct, deleteProduct, listPurchases, cancelPurchase, ShopProduct, ShopPurchase } from '@/app/actions/shopProducts';
import { getPointBalance, addPoints, spendPoints } from '@/app/actions/shopPoints';

export default function ShopAdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [purchases, setPurchases] = useState<ShopPurchase[]>([]);
  const [purchaseSearch, setPurchaseSearch] = useState('');

  // 상품 폼 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState(''); 
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);

  // 학생 포인트 관리 상태
  const [studentSearchText, setStudentSearchText] = useState('');
  const [studentSearchResults, setStudentSearchResults] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [studentPoints, setStudentPoints] = useState<number | null>(null);
  const [customPointAmount, setCustomPointAmount] = useState('');
  const [isPointUpdating, setIsPointUpdating] = useState(false);

  const loadProducts = useCallback(() => {
    if (tenantId) listProducts(tenantId).then(setProducts).catch(err => console.error('상품 조회 오류:', err));
  }, [tenantId]);

  const loadPurchases = useCallback(() => {
    if (tenantId) listPurchases(tenantId).then(setPurchases).catch(err => console.error('구매내역 조회 오류:', err));
  }, [tenantId]);

  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem('logica_instructor_role') || '';
      const pos = localStorage.getItem('logica_instructor_position') || '';
      const tId = localStorage.getItem('logica_tenant_id') || '';

      if (!tId) {
        alert("지점 정보가 없습니다.");
        window.history.back();
        return;
      }
      setTenantId(tId);

      const isGodMode = ['SUPER_ADMIN', 'ADMIN'].includes(role) || pos.includes('최고관리자') || pos.includes('원장') || pos.includes('대장');

      if (isGodMode) {
        setIsAdmin(true);
      } else {
        const { data } = await supabase
          .from('tenant_role_permissions')
          .select('allowed_menus')
          .eq('tenant_id', tId)
          .eq('role_name', role)
          .maybeSingle();

        if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/shop-admin"))) {
          setIsAdmin(false);
        } else {
          setIsAdmin(true);
        }
      }
    };
    checkAccess();
  }, []);

  useEffect(() => {
    if (isAdmin && tenantId) {
      loadProducts();
      loadPurchases();
    }
  }, [isAdmin, tenantId, loadProducts, loadPurchases]);

  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase.channel(`shop_product_admin_sync_${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_product', filter: `tenant_id=eq.${tenantId}` }, () => loadProducts())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId, loadProducts]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSubmitting(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `shop_${Date.now()}.${fileExt}`;
      const filePath = `shop/${fileName}`;

      const { error } = await supabase.storage.from('question_images').upload(filePath, file);
      if (error) throw error;
      
      const { data } = supabase.storage.from('question_images').getPublicUrl(filePath);
      setImageDataUrl(data.publicUrl);
    } catch (err) {
      alert("이미지 업로드에 실패했습니다. 용량을 확인해주세요.");
    } finally {
      setSubmitting(false);
    }
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
    if (!tenantId) return;

    const priceNum = Number(price);
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
      const result = editingId ? await updateProduct(tenantId, editingId, input) : await createProduct(tenantId, input);
      if (!result) { alert(editingId ? '상품 수정에 실패했습니다.' : '상품 등록에 실패했습니다.'); return; }
      loadProducts();
      resetForm();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!tenantId || !window.confirm('이 상품을 삭제할까요? (이미 구매된 학생의 구매내역은 그대로 남습니다)')) return;
    const result = await deleteProduct(tenantId, id);
    if (!result.success) { alert(result.message || '삭제에 실패했습니다.'); return; }
    if (editingId === id) resetForm();
    loadProducts();
  };

  const handleCancel = async (purchase: ShopPurchase) => {
    if (!tenantId || !window.confirm(`${purchase.studentName} 학생의 [${purchase.productName}] 구매를 취소할까요?\n포인트 ${purchase.pricePaid.toLocaleString()}P가 환불되고, 재고가 있는 상품이면 재고도 복원됩니다.`)) return;
    const result = await cancelPurchase(tenantId, purchase.id);
    if (!result.success) { alert(result.message || '취소에 실패했습니다.'); return; }
    loadPurchases();
  };

  // --- 학생 포인트 관리 핸들러 ---
  const handleStudentSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setStudentSearchText(val);
    
    if (val.trim().length < 2) {
      setStudentSearchResults([]);
      return;
    }
    if (!tenantId) return;

    const { data } = await supabase
      .from('student')
      .select('student_id, name, grade, status')
      .eq('tenant_id', tenantId)
      .eq('status', '재원')
      .ilike('name', `%${val.trim()}%`)
      .limit(8);
      
    setStudentSearchResults(data || []);
  };

  const handleSelectStudent = async (student: any) => {
    setSelectedStudent(student);
    setStudentSearchText('');
    setStudentSearchResults([]);
    setStudentPoints(null);
    const pts = await getPointBalance(student.student_id);
    setStudentPoints(pts);
  };

  const handlePointUpdate = async (amount: number, reason: string) => {
    if (!selectedStudent || !tenantId) return;
    const actionText = amount > 0 ? '지급' : '차감';
    
    if (!window.confirm(`${selectedStudent.name} 학생에게 ${Math.abs(amount)}P를 ${actionText}할까요?\n(사유: ${reason})`)) return;

    setIsPointUpdating(true);
    try {
      let res;
      if (amount > 0) {
        res = await addPoints(selectedStudent.student_id, amount);
      } else {
        res = await spendPoints(selectedStudent.student_id, Math.abs(amount));
      }

      if (res.success) {
        alert(`포인트가 ${actionText}되었습니다. (현재 잔여: ${res.balance}P)`);
        setStudentPoints(res.balance);
      } else {
        alert(`${actionText} 실패: ${res.message}`);
      }
    } catch (err) {
      alert('오류가 발생했습니다.');
    } finally {
      setIsPointUpdating(false);
    }
  };

  if (isAdmin === null) return (
    <div className="h-full flex items-center justify-center bg-slate-50">
      <div className="animate-spin text-4xl">⏳</div>
    </div>
  );
  
  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border border-slate-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-extrabold text-rose-600 mb-2">접근 권한 없음</h2>
          <p className="text-sm text-slate-500 font-bold">상점 관리는 접근 권한이 있는 관리자만 접속할 수 있습니다.</p>
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
    <div className="h-full overflow-y-auto bg-slate-50 p-8 font-pretendard">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-black text-slate-800 mb-6">🛒 포인트 상점 관리</h1>

        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
          {/* 좌측 패널: 상품 폼 & 포인트 관리 */}
          <div className="flex flex-col gap-6">
            
            {/* 상품 등록/수정 폼 */}
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4 shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-slate-700 text-sm">{editingId ? '상품 수정' : '새 상품 등록'}</h2>
                {editingId && <button type="button" onClick={resetForm} className="text-[11px] font-bold text-slate-400 hover:text-slate-600">취소하고 새로 등록</button>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">상품 이미지</label>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" id="shop-img-upload" />
                <label htmlFor="shop-img-upload" className="block w-full aspect-square rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer overflow-hidden flex items-center justify-center transition-colors relative">
                  {submitting && <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10"><span className="animate-spin text-2xl">⏳</span></div>}
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

            {/* 🌟 신규 추가: 학생 포인트 관리 패널 */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 shrink-0 space-y-4">
              <h2 className="font-bold text-slate-700 text-sm">🎁 학생 포인트 직권 부여/차감</h2>

              <div className="relative z-10">
                <input
                  value={studentSearchText}
                  onChange={handleStudentSearch}
                  placeholder="학생 이름 검색 (2글자 이상)"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 bg-amber-50/30"
                />
                {studentSearchResults.length > 0 && (
                  <ul className="absolute w-full bg-white border border-slate-200 rounded-xl mt-1 shadow-xl overflow-hidden max-h-48 overflow-y-auto">
                    {studentSearchResults.map(s => (
                      <li
                        key={s.student_id}
                        onClick={() => handleSelectStudent(s)}
                        className="px-4 py-3 hover:bg-slate-50 cursor-pointer text-sm font-bold text-slate-700 border-b border-slate-100 last:border-0 flex items-center justify-between"
                      >
                        {s.name} <span className="text-[11px] text-slate-400 font-medium bg-slate-100 px-1.5 py-0.5 rounded">{s.grade}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selectedStudent && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4 animate-[fadeIn_0.2s_ease-out]">
                  <div className="flex justify-between items-center">
                    <div className="font-black text-slate-800 text-lg flex items-center gap-2">
                      {selectedStudent.name} 
                      <span className="text-xs font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">{selectedStudent.grade}</span>
                    </div>
                    <button onClick={() => setSelectedStudent(null)} className="text-[10px] font-bold text-slate-400 hover:text-rose-500 bg-white border border-slate-200 px-2 py-1 rounded transition-colors">✕ 닫기</button>
                  </div>
                  
                  <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                    <span className="text-xs font-bold text-slate-500">현재 보유 포인트</span>
                    <span className="font-black text-amber-600 text-lg">
                      {studentPoints === null ? '조회 중...' : `${studentPoints.toLocaleString()} P`}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-400">보상 (칭찬)</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button disabled={isPointUpdating || studentPoints === null} onClick={() => handlePointUpdate(500, '성적 우수')} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">+500P (성적)</button>
                      <button disabled={isPointUpdating || studentPoints === null} onClick={() => handlePointUpdate(100, '출결/태도 우수')} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">+100P (출결)</button>
                      <button disabled={isPointUpdating || studentPoints === null} onClick={() => handlePointUpdate(50, '과제 우수')} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">+50P (과제)</button>
                      <button disabled={isPointUpdating || studentPoints === null} onClick={() => handlePointUpdate(10, '칭찬 보너스')} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">+10P (칭찬)</button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-400">차감 (패널티)</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button disabled={isPointUpdating || studentPoints === null} onClick={() => handlePointUpdate(-100, '지각/결석')} className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">-100P (지각/결석)</button>
                      <button disabled={isPointUpdating || studentPoints === null} onClick={() => handlePointUpdate(-200, '과제 미흡')} className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">-200P (과제미흡)</button>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200 space-y-2">
                     <p className="text-[10px] font-bold text-slate-400">직접 입력</p>
                     <div className="flex gap-2">
                       <input type="number" min="1" value={customPointAmount} onChange={e => setCustomPointAmount(e.target.value)} placeholder="금액" className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-center focus:outline-none focus:border-amber-500" />
                       <button disabled={isPointUpdating || studentPoints === null || !customPointAmount} onClick={() => { handlePointUpdate(Number(customPointAmount), '직접 입력 지급'); setCustomPointAmount(''); }} className="flex-1 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold py-1.5 rounded-lg disabled:opacity-50 transition-colors shadow-sm">지급 (+)</button>
                       <button disabled={isPointUpdating || studentPoints === null || !customPointAmount} onClick={() => { handlePointUpdate(-Number(customPointAmount), '직접 입력 차감'); setCustomPointAmount(''); }} className="flex-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-1.5 rounded-lg disabled:opacity-50 transition-colors shadow-sm">차감 (-)</button>
                     </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 우측 패널: 상품 목록 + 구매내역 */}
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