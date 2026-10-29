// src/app/exam/step1/useStep1Data.ts
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { normalizeMasterCategories } from "../../../lib/normalize";

const URL_MASTER_CAT = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_data/Master_Category.json";
const URL_MASTER_ITEM = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_data/Master_Item.json";
const URL_THINKING_CAT = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_data/Thinking_Category.json";

export const DIAGNOSTIC_SEMESTERS: {
  group: string;
  groupOrder: number;
  label: string;
  order: number;
  baseSource: string;
  gradeCode: string;
  isMiddle?: boolean;
}[] = [
  { group: "초등 저학년 (1~3학년)", groupOrder: 1, label: "1학년 1학기", order: 1, baseSource: "초등 입학테스트지 1-1", gradeCode: "1-1" },
  { group: "초등 저학년 (1~3학년)", groupOrder: 1, label: "1학년 2학기", order: 2, baseSource: "초등 입학테스트지 1-2", gradeCode: "1-2" },
  { group: "초등 저학년 (1~3학년)", groupOrder: 1, label: "2학년 1학기", order: 3, baseSource: "초등 입학테스트지 2-1", gradeCode: "2-1" },
  { group: "초등 저학년 (1~3학년)", groupOrder: 1, label: "2학년 2학기", order: 4, baseSource: "초등 입학테스트지 2-2", gradeCode: "2-2" },
  { group: "초등 저학년 (1~3학년)", groupOrder: 1, label: "3학년 1학기", order: 5, baseSource: "초등 입학테스트지 3-1", gradeCode: "3-1" },
  { group: "초등 저학년 (1~3학년)", groupOrder: 1, label: "3학년 2학기", order: 6, baseSource: "초등 입학테스트지 3-2", gradeCode: "3-2" },
  { group: "초등 고학년 (4~6학년)", groupOrder: 2, label: "4학년 1학기", order: 1, baseSource: "초등 입학테스트지 4-1", gradeCode: "4-1" },
  { group: "초등 고학년 (4~6학년)", groupOrder: 2, label: "4학년 2학기", order: 2, baseSource: "초등 입학테스트지 4-2", gradeCode: "4-2" },
  { group: "초등 고학년 (4~6학년)", groupOrder: 2, label: "5학년 1학기", order: 3, baseSource: "초등 입학테스트지 5-1", gradeCode: "5-1" },
  { group: "초등 고학년 (4~6학년)", groupOrder: 2, label: "5학년 2학기", order: 4, baseSource: "초등 입학테스트지 5-2", gradeCode: "5-2" },
  { group: "초등 고학년 (4~6학년)", groupOrder: 2, label: "6학년 1학기", order: 5, baseSource: "초등 입학테스트지 6-1", gradeCode: "6-1" },
  { group: "초등 고학년 (4~6학년)", groupOrder: 2, label: "6학년 2학기", order: 6, baseSource: "초등 입학테스트지 6-2", gradeCode: "6-2" },
  { group: "중등 진단평가", groupOrder: 3, label: "중 1학년 1학기", order: 1, baseSource: "중등 입학테스트지 7-1", gradeCode: "7-1", isMiddle: true },
  { group: "중등 진단평가", groupOrder: 3, label: "중 1학년 2학기", order: 2, baseSource: "중등 입학테스트지 7-2", gradeCode: "7-2", isMiddle: true },
];

export const getDiagnosticQuarterInfo = (createdAt?: string | null) => {
  if (!createdAt) {
    return { key: "DEFAULT", label: "기본 버전", sortOrder: 0 };
  }
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) {
    return { key: "DEFAULT", label: "기본 버전", sortOrder: 0 };
  }
  // KST (UTC+9) 기준 연도 및 분기 산출
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const yy = String(year).slice(-2);
  const month = kst.getUTCMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return {
    key: `${yy}Q${quarter}`,
    label: `${yy}년 ${quarter}분기`,
    sortOrder: year * 10 + quarter,
  };
};

export const matchDiagnosticSemester = (
  q: { pdf_source?: string | null; source_book_name?: string | null; book_name?: string | null },
  sem: { baseSource: string; gradeCode: string; isMiddle?: boolean }
): boolean => {
  const srcText = `${q.pdf_source || ""} ${q.source_book_name || ""} ${q.book_name || ""}`.trim();
  if (!srcText) return false;
  if (srcText.includes(sem.baseSource)) return true;

  const isDiagText = srcText.includes("입학테스트") || srcText.includes("진단평가");
  if (!isDiagText) return false;

  const codeRegex = new RegExp(`(?:^|[^0-9])${sem.gradeCode}(?:[^0-9]|$)`);
  if (sem.isMiddle) {
    if (codeRegex.test(srcText)) return true;
    const subSem = sem.gradeCode.split("-")[1];
    const midAltRegex = new RegExp(`중(?:등)?\\s*1-${subSem}(?:[^0-9]|$)`);
    return midAltRegex.test(srcText);
  } else {
    if (srcText.includes("중등") || srcText.includes("중1")) return false;
    return codeRegex.test(srcText);
  }
};

const buildDefaultDiagnosticTree = () => {
  const tree: Record<string, any> = {};
  DIAGNOSTIC_SEMESTERS.forEach((sem) => {
    if (!tree[sem.group]) {
      tree[sem.group] = { sortOrder: sem.groupOrder, children: {} };
    }
    tree[sem.group].children[sem.label] = {
      itemId: sem.baseSource,
      sortOrder: sem.order,
    };
  });
  return tree;
};

export const TEST_DATA: Record<string, any> = {
  "단원테스트": {
    "초등 단원평가": { itemId: "테스트_단원_초등", sortOrder: 1 },
    "중등 단원평가": { itemId: "테스트_단원_중등", sortOrder: 2 },
  },
  "진단평가": buildDefaultDiagnosticTree(),
};

export const TEST_GROUPS = ["주간테스트", "중간테스트", "분기테스트", "단원테스트", "진단평가"];

// 🌟 모듈 레벨 메모리 캐시: Step 1 재진입 시 네트워크/DB 대기 없이 0ms 즉시 렌더링
let cachedStep1Taxonomy: {
  mData: any;
  tData: any;
  flatIndex: any[];
  timestamp: number;
} | null = null;

let cachedStep1Diag: {
  diagTree: Record<string, any>;
  qIdsByItemId: Record<string, string[]>;
  timestamp: number;
} | null = null;

export function useStep1Data() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(!cachedStep1Taxonomy);
  const [masterData, setMasterData] = useState<any>(cachedStep1Taxonomy?.mData || {});
  const [thinkingData, setThinkingData] = useState<any>(cachedStep1Taxonomy?.tData || {});
  const [testData, setTestData] = useState<any>(
    cachedStep1Diag ? { ...TEST_DATA, "진단평가": cachedStep1Diag.diagTree } : TEST_DATA
  );
  const [diagQuestionIdsMap, setDiagQuestionIdsMap] = useState<Record<string, string[]>>(
    cachedStep1Diag?.qIdsByItemId || {}
  );
  
  const [currentMode, setCurrentMode] = useState("regular");
  const [currentTestGroup, setCurrentTestGroup] = useState("주간테스트"); 
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

  const [bookName1, setBookName1] = useState("");
  const [bookName2, setBookName2] = useState("");
  const [pageStart, setPageStart] = useState("");
  const [pageEnd, setPageEnd] = useState("");
  const [sourceCategories, setSourceCategories] = useState({
    extra: true,
    twinSimilar: true,
    excludeMain: true,
    excludeWorkbook: true,
  });

  useEffect(() => {
    const traverseAndFlatten = (obj: any, currentPath: string, mode: string, out: any[]) => {
      if (!obj) return;
      if ((obj.itemId || obj.itemIds) && !obj.children) {
        if (mode === "regular") return;
        out.push({ path: currentPath, node: obj, mode, title: currentPath.split(" > ").pop() });
        return;
      }
      if (currentPath) {
        out.push({ path: currentPath, node: obj, mode, title: currentPath.split(" > ").pop() });
      }
      if (obj.children) {
        for (const k in obj.children) {
          traverseAndFlatten(obj.children[k], currentPath ? `${currentPath} > ${k}` : k, mode, out);
        }
      } else {
        for (const k in obj) {
          if (
            k !== "itemId" &&
            k !== "itemIds" &&
            k !== "categoryId" &&
            k !== "sortOrder" &&
            k !== "defaultOpen" &&
            k !== "_allIds" &&
            k !== "_repId" &&
            typeof obj[k] === "object"
          ) {
            traverseAndFlatten(obj[k], currentPath ? `${currentPath} > ${k}` : k, mode, out);
          }
        }
      }
    };

    // 1) 진단평가 버전 트리는 백그라운드에서 비동기로 로드하여 초기 단원 트리 렌더링을 전혀 블로킹하지 않음
    const loadDiagInBackground = async (baseFlatIndex: any[]) => {
      try {
        if (cachedStep1Diag && Date.now() - cachedStep1Diag.timestamp < 5 * 60 * 1000) {
          setDiagQuestionIdsMap(cachedStep1Diag.qIdsByItemId);
          setTestData({ ...TEST_DATA, "진단평가": cachedStep1Diag.diagTree });
          return;
        }

        let allRows: any[] = [];
        let from = 0;
        const step = 1000;
        while (true) {
          const { data, error } = await supabase
            .from("question_db")
            .select("question_id, pdf_source, source_book_name, book_name, created_at, is_hidden")
            .or("pdf_source.ilike.%입학테스트%,pdf_source.ilike.%진단평가%,source_book_name.ilike.%입학테스트%,source_book_name.ilike.%진단평가%,book_name.ilike.%입학테스트%,book_name.ilike.%진단평가%")
            .order("question_id", { ascending: true })
            .range(from, from + step - 1);
          if (error || !data || data.length === 0) break;
          allRows = allRows.concat(data);
          if (data.length < step) break;
          from += step;
        }
        const diagRows = allRows.filter(
          (q) => q.is_hidden !== true && q.is_hidden !== "Y" && q.is_hidden !== "true"
        );

        const diagTree: Record<string, any> = {};
        const qIdsMap: Record<string, string[]> = {};

        DIAGNOSTIC_SEMESTERS.forEach((sem) => {
          if (!diagTree[sem.group]) {
            diagTree[sem.group] = { sortOrder: sem.groupOrder, children: {} };
          }
          const matched = (diagRows || []).filter((q: any) => matchDiagnosticSemester(q, sem));
          const quarterMap = new Map<string, { key: string; label: string; sortOrder: number; qIds: string[] }>();

          matched.forEach((q: any) => {
            const qInfo = getDiagnosticQuarterInfo(q.created_at);
            if (!quarterMap.has(qInfo.key)) {
              quarterMap.set(qInfo.key, { ...qInfo, qIds: [] });
            }
            if (q.question_id) {
              quarterMap.get(qInfo.key)!.qIds.push(String(q.question_id));
            }
          });

          qIdsMap[sem.baseSource] = matched.map((q: any) => String(q.question_id)).filter(Boolean);

          const quarters = Array.from(quarterMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);

          if (quarters.length > 0) {
            const versionChildren: Record<string, any> = {};
            quarters.forEach((qtr) => {
              const versionItemId = `${sem.baseSource}__QTR__${qtr.key}`;
              qIdsMap[versionItemId] = qtr.qIds;
              versionChildren[qtr.label] = {
                itemId: versionItemId,
                sortOrder: qtr.sortOrder,
              };
            });
            diagTree[sem.group].children[sem.label] = {
              sortOrder: sem.order,
              defaultOpen: true,
              children: versionChildren,
            };
          } else {
            diagTree[sem.group].children[sem.label] = {
              itemId: sem.baseSource,
              sortOrder: sem.order,
            };
          }
        });

        cachedStep1Diag = {
          diagTree,
          qIdsByItemId: qIdsMap,
          timestamp: Date.now(),
        };
        setDiagQuestionIdsMap(qIdsMap);
        const builtTestData: Record<string, any> = {
          ...TEST_DATA,
          "진단평가": diagTree,
        };
        setTestData(builtTestData);

        const nextFlat = baseFlatIndex.filter((item) => item.mode !== "test");
        for (const k in builtTestData) traverseAndFlatten(builtTestData[k], k, "test", nextFlat);
        setFlatSearchIndex(nextFlat);
      } catch (e) {
        console.error(e);
      }
    };

    const fetchData = async () => {
      try {
        // 캐시가 있으면 0ms 즉시 화면 표시
        if (cachedStep1Taxonomy && Date.now() - cachedStep1Taxonomy.timestamp < 10 * 60 * 1000) {
          setMasterData(cachedStep1Taxonomy.mData);
          setThinkingData(cachedStep1Taxonomy.tData);
          setFlatSearchIndex(cachedStep1Taxonomy.flatIndex);
          switchMainTab("regular", cachedStep1Taxonomy.mData, cachedStep1Taxonomy.tData);
          setIsLoading(false);
          loadDiagInBackground(cachedStep1Taxonomy.flatIndex);
          return;
        }

        // 정적 JSON 3개만 병렬 다운로드하여 즉시 단원 트리 렌더링 (question_db 풀스캔 대기 제거!)
        const [resCat, resItem, resThk] = await Promise.all([
          fetch(URL_MASTER_CAT),
          fetch(URL_MASTER_ITEM),
          fetch(URL_THINKING_CAT),
        ]);
        const [rawCatData, itemData, thkData] = await Promise.all([
          resCat.json(),
          resItem.json(),
          resThk.json(),
        ]);
        // 매쓰플랫(MathFLAT) 단원 계층 보정 (누락된 중단원·소단원 복원)
        const catData = normalizeMasterCategories(rawCatData);

        const mData: any = {};
        const catMap: any = {};
        catData.forEach((cat: any) => {
          if (!cat.depth1 || !cat.depth2) return;
          if (!mData[cat.depth1]) mData[cat.depth1] = {};
          if (!mData[cat.depth1][cat.depth2]) mData[cat.depth1][cat.depth2] = {};
          let curr = mData[cat.depth1][cat.depth2];
          const depths = [cat.depth3, cat.depth4, cat.depth5, cat.depth6, cat.depth7].filter(
            (d) => d && !d.includes("세부 정보")
          );

          if (depths.length === 0) catMap[cat.category_id] = curr;
          else {
            depths.forEach((d, idx) => {
              if (!curr[d]) {
                curr[d] = {
                  children: {},
                  categoryId: idx === depths.length - 1 ? cat.category_id : null,
                  defaultOpen: idx === 0, // 대단원(depth3)까지만 기본 펼침(중단원 depth4 이하 기본 접힘)
                };
              }
              if (idx === depths.length - 1) catMap[cat.category_id] = curr[d];
              curr = curr[d].children;
            });
          }
        });
        itemData.forEach((item: any) => {
          const parent = catMap[item.category_id];
          if (parent) {
            const leaf = item.depth8 || item.depth7 || item.depth6 || item.type || "기본 유형";
            if (!parent.children) parent.children = {};
            if (parent.children[leaf]) {
              const existing = parent.children[leaf];
              if (!existing.itemIds) existing.itemIds = existing.itemId ? [existing.itemId] : [];
              if (!existing.itemIds.includes(item.item_id)) existing.itemIds.push(item.item_id);
            } else {
              parent.children[leaf] = { itemId: item.item_id, itemIds: [item.item_id] };
            }
          }
        });

        const tData: any = {};
        thkData.forEach((cat: any) => {
          if (!cat.depth1) return;
          if (!tData[cat.depth1]) tData[cat.depth1] = {};
          let curr = tData[cat.depth1];
          const depths = [cat.depth2, cat.depth3].filter((d) => d && !d.includes("세부 정보"));
          depths.forEach((d, idx) => {
            if (!curr[d]) {
              curr[d] = {
                children: idx === depths.length - 1 ? null : {},
                itemId: idx === depths.length - 1 ? cat.category_id : null,
              };
            }
            if (curr[d].children) curr = curr[d].children;
          });
        });

        const flatIndex: any[] = [];
        for (const k in mData) traverseAndFlatten(mData[k], k, "regular", flatIndex);
        for (const k in tData) traverseAndFlatten(tData[k], k, "thinking", flatIndex);
        for (const k in TEST_DATA) traverseAndFlatten(TEST_DATA[k], k, "test", flatIndex);

        cachedStep1Taxonomy = {
          mData,
          tData,
          flatIndex,
          timestamp: Date.now(),
        };

        setFlatSearchIndex(flatIndex);
        setMasterData(mData);
        setThinkingData(tData);
        switchMainTab("regular", mData, tData);
        setIsLoading(false);

        // 진단평가 분기 트리는 백그라운드에서 비동기 로드
        loadDiagInBackground(flatIndex);
      } catch (e) {
        console.error(e);
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const switchMainTab = (mode: string, mData = masterData, tData = thinkingData) => {
    setCurrentMode(mode);
    setSearchKeyword(""); 
    if (mode === "regular") {
      setIsSettingsDisabled(false);
      const d1Keys = Object.keys(mData).sort();
      if (d1Keys.length > 0) {
        const d1 = d1Keys.includes("초등학교") ? "초등학교" : d1Keys[0];
        setCurrentD1(d1);
        const d2Keys = Object.keys(mData[d1] || {}).sort();
        if (d2Keys.length > 0) setCurrentD2(d2Keys.includes("2학년 1학기") ? "2학년 1학기" : d2Keys[0]);
      }
    } else if (mode === "thinking") {
      setIsSettingsDisabled(false);
      const d1Keys = Object.keys(tData).sort();
      if (d1Keys.length > 0) setCurrentD1(d1Keys[0]);
    } else if (mode === "test") {
      updateTestGroup(currentTestGroup, mData);
    }
  };

  const updateTestGroup = (group: string, mData = masterData) => {
    setCurrentTestGroup(group);
    if (group === "진단평가" || group === "입학테스트") {
      setIsSettingsDisabled(true);
      setQCount(30); 
    } else {
      setIsSettingsDisabled(false);
      if (['주간테스트', '중간테스트', '분기테스트'].includes(group)) {
        const d1Keys = Object.keys(mData).sort();
        if (d1Keys.length > 0) {
          const d1 = d1Keys.includes("초등학교") ? "초등학교" : d1Keys[0];
          setCurrentD1(d1);
          const d2Keys = Object.keys(mData[d1] || {}).sort();
          if (d2Keys.length > 0) setCurrentD2(d2Keys.includes("2학년 1학기") ? "2학년 1학기" : d2Keys[0]);
        }
      }
    }
  };

  const toggleItem = (idOrIds: string | string[], checked: boolean) => {
    const targetIds = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      targetIds.forEach(id => {
        if (!id) return;
        if (checked) next.add(id); else next.delete(id);
      });
      return next;
    });
  };

  const toggleFolder = (node: any, checked: boolean) => {
    const ids: string[] = [];
    const traverse = (n: any) => {
      if (!n) return;
      if (Array.isArray(n.itemIds) && n.itemIds.length > 0) {
        n.itemIds.forEach((id: string) => ids.push(id));
      } else if (n.itemId) {
        ids.push(n.itemId);
      }
      if (n.children) Object.values(n.children).forEach(traverse);
    };
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
    const hasAnySourceTarget =
      sourceCategories.extra ||
      sourceCategories.twinSimilar ||
      sourceCategories.excludeMain === false ||
      sourceCategories.excludeWorkbook === false;
    if (!isSettingsDisabled && !hasAnySourceTarget) {
      return alert("출처 교재 및 페이지 필터에서 '추가문제' 또는 '쌍둥이/유사'를 체크하거나, '주교재 제외'/'워크북 제외' 중 최소 1개 이상을 해제해주세요!");
    }

    sessionStorage.removeItem("isClinicMode");
    sessionStorage.removeItem("examTitle");
    sessionStorage.removeItem("examSubTitle");
    sessionStorage.removeItem("editExamId");
    sessionStorage.removeItem("duplicateExamId");
    sessionStorage.removeItem("examHiddenImageQuestions");

    const finalDistributions = isSettingsDisabled 
      ? [10, 20, 40, 20, 10] 
      : [diffBounds[0], diffBounds[1]-diffBounds[0], diffBounds[2]-diffBounds[1], diffBounds[3]-diffBounds[2], 100-diffBounds[3]];
    
    const finalTypes = isSettingsDisabled ? { obj: true, subj: true, essay: true } : types;
    const finalRateRange = isSettingsDisabled ? [100, 0] : [rateMax, rateMin];
    
    sessionStorage.setItem("examMode", currentMode);
    
    if (currentMode === 'test') {
      sessionStorage.setItem("testCategory", currentTestGroup);
      if (['주간테스트', '중간테스트', '분기테스트'].includes(currentTestGroup)) {
        sessionStorage.setItem("testSourceFilter", currentTestGroup);
      } else {
        sessionStorage.removeItem("testSourceFilter");
      }
      if (currentTestGroup === '진단평가' || currentTestGroup === '입학테스트') {
        sessionStorage.setItem("examType", "입학테스트");
      } else if (currentTestGroup === '주간테스트') {
        sessionStorage.setItem("examType", "주간테스트");
      } else if (currentTestGroup === '중간테스트') {
        sessionStorage.setItem("examType", "중간평가");
      } else if (currentTestGroup === '분기테스트') {
        sessionStorage.setItem("examType", "분기평가");
      } else if (currentTestGroup === '단원테스트') {
        sessionStorage.setItem("examType", "단원평가");
      } else {
        sessionStorage.removeItem("examType");
      }
    } else {
      sessionStorage.setItem("testCategory", currentD1);
      sessionStorage.removeItem("testSourceFilter");
      sessionStorage.removeItem("examType");
    }

    const selectedArr = Array.from(selectedItemIds);
    sessionStorage.setItem("selectedItemIds", JSON.stringify(selectedArr));

    // 진단평가 선택 시 해당 버전(분기)의 정확한 question_id 목록과 학년/학기(예: 초등 5-2)를 함께 전달
    if (currentMode === "test" && (currentTestGroup === "진단평가" || currentTestGroup === "입학테스트")) {
      const diagQIds = new Set<string>();
      const diagBadges = new Set<string>();
      selectedArr.forEach((itemId) => {
        const mapped = diagQuestionIdsMap[itemId];
        if (Array.isArray(mapped)) {
          mapped.forEach((qid) => diagQIds.add(String(qid)));
        }
        const baseSrc = String(itemId).split("__QTR__")[0];
        const sem = DIAGNOSTIC_SEMESTERS.find((s) => s.baseSource === baseSrc);
        if (sem) {
          const badgeLabel = sem.isMiddle ? `중등 1-${sem.gradeCode.split("-")[1]}` : `초등 ${sem.gradeCode}`;
          diagBadges.add(badgeLabel);
        }
      });
      sessionStorage.setItem("diagnosticQuestionIds", JSON.stringify(Array.from(diagQIds)));
      if (diagBadges.size > 0) {
        sessionStorage.setItem("examSubTitle", Array.from(diagBadges)[0]);
      }
      sessionStorage.setItem("examTitle", "진단평가");
    } else {
      sessionStorage.removeItem("diagnosticQuestionIds");
    }

    sessionStorage.setItem("qCount", String(qCount));
    sessionStorage.setItem("distributions", JSON.stringify(finalDistributions));
    sessionStorage.setItem("problemTypes", JSON.stringify(finalTypes));
    sessionStorage.setItem("correctRateRange", JSON.stringify(finalRateRange));

    sessionStorage.setItem("bookName1", isSettingsDisabled ? "" : bookName1.trim());
    sessionStorage.setItem("bookName2", isSettingsDisabled ? "" : bookName2.trim());
    sessionStorage.setItem("pageStart", isSettingsDisabled ? "" : pageStart.trim());
    sessionStorage.setItem("pageEnd", isSettingsDisabled ? "" : pageEnd.trim());
    sessionStorage.setItem(
      "sourceCategories",
      JSON.stringify(
        isSettingsDisabled
          ? { extra: true, twinSimilar: true, excludeMain: true, excludeWorkbook: true }
          : sourceCategories
      )
    );

    router.push("/exam/step2"); 
  };

  return {
    isLoading, masterData, thinkingData, testData,
    currentMode, currentD1, setCurrentD1, currentD2, setCurrentD2,
    currentTestGroup, updateTestGroup,
    selectedItemIds, setSelectedItemIds,
    searchKeyword, setSearchKeyword, searchResults,
    qCount, setQCount, diffBounds, setDiffBounds,
    rateMax, setRateMax, rateMin, setRateMin,
    types, setTypes, isSettingsDisabled,
    
    bookName1, setBookName1,
    bookName2, setBookName2,
    pageStart, setPageStart,
    pageEnd, setPageEnd,
    sourceCategories, setSourceCategories,

    switchMainTab, toggleItem, toggleFolder, generateExam
  };
}