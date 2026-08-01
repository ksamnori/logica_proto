// src/app/exam/step1/useStep1Data.ts
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

const URL_MASTER_CAT = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_data/Master_Category.json";
const URL_MASTER_ITEM = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_data/Master_Item.json";
const URL_THINKING_CAT = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_data/Thinking_Category.json";

export const TEST_DATA = {
  "단원테스트": { "초등 단원평가": { itemId: "테스트_단원_초등" }, "중등 단원평가": { itemId: "테스트_단원_중등" } },
  "입학테스트": {
    "초등 저학년 (1~3학년)": { children: { "1학년 1학기": { itemId: "초등 입학테스트지 1-1" }, "1학년 2학기": { itemId: "초등 입학테스트지 1-2" }, "2학년 1학기": { itemId: "초등 입학테스트지 2-1" }, "2학년 2학기": { itemId: "초등 입학테스트지 2-2" }, "3학년 1학기": { itemId: "초등 입학테스트지 3-1" }, "3학년 2학기": { itemId: "초등 입학테스트지 3-2" } } },
    "초등 고학년 (4~6학년)": { children: { "4학년 1학기": { itemId: "초등 입학테스트지 4-1" }, "4학년 2학기": { itemId: "초등 입학테스트지 4-2" }, "5학년 1학기": { itemId: "초등 입학테스트지 5-1" }, "5학년 2학기": { itemId: "초등 입학테스트지 5-2" }, "6학년 1학기": { itemId: "초등 입학테스트지 6-1" }, "6학년 2학기": { itemId: "초등 입학테스트지 6-2" } } },
    "중등 입학테스트": { children: { "중 1학년 1학기": { itemId: "중등 입학테스트지 7-1" }, "중 1학년 2학기": { itemId: "중등 입학테스트지 7-2" } } }
  }
};

export function useStep1Data() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [masterData, setMasterData] = useState<any>({});
  const [thinkingData, setThinkingData] = useState<any>({});
  
  const [currentMode, setCurrentMode] = useState("regular");
  const [currentD1, setCurrentD1] = useState("");
  const [currentD2, setCurrentD2] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  
  const [searchKeyword, setSearchKeyword] = useState("");
  const [flatSearchIndex, setFlatSearchIndex] = useState<any[]>([]);

  const [qCount, setQCount] = useState(20);
  const [diffBounds, setDiffBounds] = useState([10, 30, 70, 90]);
  const [rateMax, setRateMax] = useState(100); 
  const [rateMin, setRateMin] = useState(0);   
  const [types, setTypes] = useState({ obj: true, subj: true, essay: true });
  const [isSettingsDisabled, setIsSettingsDisabled] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [resCat, resItem, resThk] = await Promise.all([fetch(URL_MASTER_CAT), fetch(URL_MASTER_ITEM), fetch(URL_THINKING_CAT)]);
        const catData = await resCat.json();
        const itemData = await resItem.json();
        const thkData = await resThk.json();

        const mData: any = {}; const catMap: any = {};
        catData.forEach((cat: any) => {
          if (!cat.depth1 || !cat.depth2) return;
          if (!mData[cat.depth1]) mData[cat.depth1] = {};
          if (!mData[cat.depth1][cat.depth2]) mData[cat.depth1][cat.depth2] = {};
          let curr = mData[cat.depth1][cat.depth2];
          const depths = [cat.depth3, cat.depth4, cat.depth5, cat.depth6, cat.depth7].filter(d => d && !d.includes("세부 정보"));
          
          if (depths.length === 0) catMap[cat.category_id] = curr;
          else {
            depths.forEach((d, idx) => {
              if (!curr[d]) curr[d] = { children: {}, categoryId: idx === depths.length - 1 ? cat.category_id : null };
              if (idx === depths.length - 1) catMap[cat.category_id] = curr[d];
              curr = curr[d].children;
            });
          }
        });
        itemData.forEach((item: any) => {
          const parent = catMap[item.category_id];
          if (parent) {
            let leaf = item.depth8 || "기본 유형";
            if (!parent.children) parent.children = {};
            parent.children[leaf] = { itemId: item.item_id };
          }
        });

        const tData: any = {};
        thkData.forEach((cat: any) => {
          if (!cat.depth1) return;
          if (!tData[cat.depth1]) tData[cat.depth1] = {};
          let curr = tData[cat.depth1];
          const depths = [cat.depth2, cat.depth3].filter(d => d && !d.includes("세부 정보"));
          depths.forEach((d, idx) => {
            if (!curr[d]) curr[d] = { children: idx === depths.length - 1 ? null : {}, itemId: idx === depths.length - 1 ? cat.category_id : null };
            if (curr[d].children) curr = curr[d].children;
          });
        });

        const flatIndex: any[] = [];
        const traverseAndFlatten = (obj: any, currentPath: string, mode: string, out: any[]) => {
          if (!obj) return;
          if (obj.itemId && !obj.children) {
             if (mode === 'regular') return; 
             out.push({ path: currentPath, node: obj, mode, title: currentPath.split(' > ').pop() });
             return;
          }
          if (currentPath) {
             out.push({ path: currentPath, node: obj, mode, title: currentPath.split(' > ').pop() });
          }
          if (obj.children) {
             for (const k in obj.children) traverseAndFlatten(obj.children[k], currentPath ? `${currentPath} > ${k}` : k, mode, out);
          } else {
             for (const k in obj) {
                 if (k !== 'itemId' && k !== 'categoryId') traverseAndFlatten(obj[k], currentPath ? `${currentPath} > ${k}` : k, mode, out);
             }
          }
        };

        for (const k in mData) traverseAndFlatten(mData[k], k, "regular", flatIndex);
        for (const k in tData) traverseAndFlatten(tData[k], k, "thinking", flatIndex);
        for (const k in TEST_DATA) traverseAndFlatten((TEST_DATA as any)[k], k, "test", flatIndex);
        
        setFlatSearchIndex(flatIndex);
        setMasterData(mData); 
        setThinkingData(tData);
        switchMainTab("regular", mData, tData);
        setIsLoading(false);
      } catch (e) { console.error(e); }
    };
    fetchData();
  }, []);

  const switchMainTab = (mode: string, mData = masterData, tData = thinkingData) => {
    setCurrentMode(mode);
    setSearchKeyword(""); 
    if (mode === "regular") {
      const d1Keys = Object.keys(mData).sort();
      if (d1Keys.length > 0) {
        const d1 = d1Keys.includes("중학교") ? "중학교" : d1Keys[0];
        updateD1(d1, mode);
        const d2Keys = Object.keys(mData[d1] || {}).sort();
        if (d2Keys.length > 0) setCurrentD2(d2Keys.includes("1학년 1학기") ? "1학년 1학기" : d2Keys[0]);
      }
    } else if (mode === "thinking") {
      const d1Keys = Object.keys(tData).sort();
      if (d1Keys.length > 0) updateD1(d1Keys[0], mode);
    } else if (mode === "test") {
      const d1Keys = Object.keys(TEST_DATA).sort();
      if (d1Keys.length > 0) updateD1(d1Keys[0], mode);
    }
  };

  const updateD1 = (d1: string, mode: string = currentMode) => {
    setCurrentD1(d1);
    if (mode === "test" && d1 === "입학테스트") {
      setIsSettingsDisabled(true);
      setQCount(30); 
    } else {
      setIsSettingsDisabled(false);
    }
  };

  const toggleItem = (id: string, checked: boolean) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleFolder = (node: any, checked: boolean) => {
    const ids: string[] = [];
    const traverse = (n: any) => { if (n.itemId) ids.push(n.itemId); if (n.children) Object.values(n.children).forEach(traverse); };
    traverse(node);
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => checked ? next.add(id) : next.delete(id));
      return next;
    });
  };

  const searchResults = useMemo(() => {
    const kw = searchKeyword.trim();
    if (kw.length < 2) return [];
    const lowerKw = kw.toLowerCase();
    return flatSearchIndex.filter(item => item.path.toLowerCase().includes(lowerKw));
  }, [searchKeyword, flatSearchIndex]);

  const generateExam = () => {
    if (selectedItemIds.size === 0) return alert("출제할 단원(유형)이나 테스트를 최소 1개 이상 왼쪽 트리에서 선택해주세요!");

    const finalDistributions = isSettingsDisabled 
      ? [10, 20, 40, 20, 10] 
      : [diffBounds[0], diffBounds[1]-diffBounds[0], diffBounds[2]-diffBounds[1], diffBounds[3]-diffBounds[2], 100-diffBounds[3]];
    
    const finalTypes = isSettingsDisabled ? { obj: true, subj: true, essay: true } : types;
    const finalRateRange = isSettingsDisabled ? [100, 0] : [rateMax, rateMin];
    
    sessionStorage.removeItem("editExamId");
    sessionStorage.setItem("examMode", currentMode);
    sessionStorage.setItem("testCategory", currentD1);
    sessionStorage.setItem("selectedItemIds", JSON.stringify(Array.from(selectedItemIds)));
    sessionStorage.setItem("qCount", String(qCount));
    sessionStorage.setItem("distributions", JSON.stringify(finalDistributions));
    sessionStorage.setItem("problemTypes", JSON.stringify(finalTypes));
    sessionStorage.setItem("correctRateRange", JSON.stringify(finalRateRange));

    router.push("/exam/step2"); 
  };

  return {
    isLoading, masterData, thinkingData,
    currentMode, currentD1, currentD2, setCurrentD2,
    selectedItemIds, setSelectedItemIds,
    searchKeyword, setSearchKeyword, searchResults,
    qCount, setQCount, diffBounds, setDiffBounds,
    rateMax, setRateMax, rateMin, setRateMin,
    types, setTypes, isSettingsDisabled,
    switchMainTab, updateD1, toggleItem, toggleFolder, generateExam
  };
}