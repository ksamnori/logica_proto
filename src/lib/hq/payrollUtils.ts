// src/lib/hq/payrollUtils.ts
import { calculatePayrollAmounts } from "./constants";
import { describeExternalWithholdingRecord } from "./publishingRights";
import type {
  HqApprovalDoc,
  HqAttendanceRecord,
  HqMember,
  HqPayrollRecord,
  HqPayrollType,
} from "./types";

// ============================================================================
// 1. 숫자 · 문자열 · CSV 유틸리티
// ============================================================================

export function parseCurrencyNumber(raw: unknown): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.round(raw) : 0;
  }
  if (raw === null || raw === undefined) return 0;
  let str = String(raw).trim();
  if (!str || str === "-" || str === "—") return 0;
  // 회계 음수 표기 (12,340) 또는 △12,340 처리
  let negative = false;
  if (/^\(.*\)$/.test(str) || /^[△▲\-]/.test(str)) {
    if (str.startsWith("(") && str.endsWith(")")) {
      negative = true;
      str = str.slice(1, -1);
    } else if (str.startsWith("△") || str.startsWith("▲")) {
      negative = true;
      str = str.slice(1);
    } else if (str.startsWith("-")) {
      negative = true;
      str = str.slice(1);
    }
  }
  const cleaned = str.replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const num = Math.round(Number(cleaned));
  if (!Number.isFinite(num)) return 0;
  return negative ? -num : num;
}

export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvContent(rows: (string | number | null | undefined)[][]): string {
  // 한글 Windows Excel에서 깨지지 않도록 UTF-8 BOM(\uFEFF) 부착
  return (
    "\uFEFF" +
    rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\r\n")
  );
}

export function triggerCsvDownload(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// 2. CSV(UTF-8 / CP949 자동 감지) · TSV 붙여넣기 · XLSX(엑셀 원본) 파서
// ============================================================================

export function decodeCsvArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // 한국 세무사 사무소 Windows Excel에서 저장한 CP949(EUC-KR) CSV 자동 디코딩
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

export function parseSpreadsheetRowsFromText(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text.trim()) return [];

  // 첫 비어있지 않은 줄에서 탭(\t) 우세 여부 판별 (엑셀 Ctrl+C -> Ctrl+V 대응)
  const sampleLine =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) || "";
  const tabCount = (sampleLine.match(/\t/g) || []).length;
  const commaCount = (sampleLine.match(/,/g) || []).length;
  const delimiter = tabCount >= 2 && tabCount >= commaCount ? "\t" : ",";

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentCell.trim());
        currentCell = "";
      } else if (ch === "\n") {
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = "";
      } else {
        currentCell += ch;
      }
    }
  }
  currentRow.push(currentCell.trim());
  if (currentRow.some((c) => c !== "")) {
    rows.push(currentRow);
  }

  return rows;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&amp;/g, "&");
}

function excelColLettersToIndex(colRef: string): number {
  const letters = colRef.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (!letters) return -1;
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  // 일부 스트림 구현에서 끝 바이트 대기를 피하기 위해 write/close 비동기 병렬 처리
  const writePromise = writer
    .write(compressed as unknown as BufferSource)
    .then(() => writer.close())
    .catch(() => {});

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  await writePromise;

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * 외부 라이브러리 없이 표준 .xlsx (OpenXML PKZIP) 첫 시트를 2차원 문자열 배열로 추출
 */
export async function parseXlsxArrayBuffer(buf: ArrayBuffer): Promise<string[][]> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  // PKZIP End of Central Directory (0x06054b50) 탐색
  let eocdOffset = -1;
  const minSearch = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("유효한 엑셀(.xlsx) 파일이 아닙니다. (.xls 구버전은 .xlsx 또는 .csv로 저장해 주세요)");
  }

  const cdEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const zipFiles = new Map<
    string,
    { method: number; compressedSize: number; localHeaderOffset: number }
  >();

  let ptr = cdOffset;
  const utf8 = new TextDecoder("utf-8");
  for (let i = 0; i < cdEntries && ptr + 46 <= bytes.length; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);
    const fileName = utf8.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    zipFiles.set(fileName, { method, compressedSize, localHeaderOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  const readZipXml = async (entryName: string): Promise<string | null> => {
    const meta = zipFiles.get(entryName);
    if (!meta) return null;
    const lh = meta.localHeaderOffset;
    if (lh + 30 > bytes.length || view.getUint32(lh, true) !== 0x04034b50) {
      return null;
    }
    const nameLen = view.getUint16(lh + 26, true);
    const extraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + nameLen + extraLen;
    const slice = bytes.subarray(dataStart, dataStart + meta.compressedSize);
    if (meta.method === 0) {
      return utf8.decode(slice);
    }
    if (meta.method === 8) {
      const inflated = await inflateRawBytes(slice);
      return utf8.decode(inflated);
    }
    throw new Error(`지원하지 않는 압축 방식(method=${meta.method})입니다.`);
  };

  // 1) 공유 문자열(sharedStrings.xml) 파싱
  const sharedStrings: string[] = [];
  const sstXml = await readZipXml("xl/sharedStrings.xml");
  if (sstXml) {
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch: RegExpExecArray | null;
    while ((siMatch = siRegex.exec(sstXml)) !== null) {
      // 후리가나(<rPh>) 제거 후 <t> 텍스트 결합
      const cleanedSi = siMatch[1].replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
      const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let textAcc = "";
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRegex.exec(cleanedSi)) !== null) {
        textAcc += decodeXmlEntities(tMatch[1]);
      }
      sharedStrings.push(textAcc.trim());
    }
  }

  // 2) 첫 번째 워크시트 찾기
  let sheetEntry = "xl/worksheets/sheet1.xml";
  if (!zipFiles.has(sheetEntry)) {
    const found = Array.from(zipFiles.keys())
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
      .sort()[0];
    if (found) sheetEntry = found;
  }
  const sheetXml = await readZipXml(sheetEntry);
  if (!sheetXml) {
    throw new Error("엑셀 파일에서 워크시트 데이터를 찾을 수 없습니다.");
  }

  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowInner = rowMatch[1];
    const rowCells: string[] = [];
    let autoCol = 0;

    // 빈 셀(<c r="C2" s="1"/>)과 내용이 있는 셀(<c ...>...</c>) 모두 매칭
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowInner)) !== null) {
      const attrs = cellMatch[1] || "";
      const cellBody = cellMatch[2] || "";

      const rAttr = /\br="([A-Za-z]+\d+)"/.exec(attrs);
      const tAttr = /\bt="([^"]+)"/.exec(attrs);
      const colIdx = rAttr ? excelColLettersToIndex(rAttr[1]) : autoCol;
      const targetIdx = colIdx >= 0 ? colIdx : autoCol;
      autoCol = targetIdx + 1;

      while (rowCells.length <= targetIdx) {
        rowCells.push("");
      }

      if (!cellBody) continue;

      const cellType = tAttr ? tAttr[1] : "";
      let val = "";
      if (cellType === "inlineStr") {
        const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
        let tMatch: RegExpExecArray | null;
        while ((tMatch = tRegex.exec(cellBody)) !== null) {
          val += decodeXmlEntities(tMatch[1]);
        }
      } else {
        const vMatch = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cellBody);
        const rawV = vMatch ? decodeXmlEntities(vMatch[1]).trim() : "";
        if (cellType === "s") {
          const sIdx = Number(rawV);
          val =
            Number.isFinite(sIdx) && sharedStrings[sIdx] !== undefined
              ? sharedStrings[sIdx]
              : rawV;
        } else {
          val = rawV;
        }
      }
      rowCells[targetIdx] = val.trim();
    }

    if (rowCells.some((c) => c !== "")) {
      rows.push(rowCells);
    }
  }

  return rows;
}

// ============================================================================
// 3. 세무사 급여대장 열 자동 매핑 & 구성원 매칭 엔진
// ============================================================================

export interface TaxLedgerParsedRow {
  rowIndex: number;
  matchedMemberId: string | null;
  matchedBy: "EMP_NO" | "NAME" | "UNMATCHED";
  employeeNo: string;
  payeeName: string;
  departmentOrRole: string;
  bankInfo: string;
  payDate: string;
  basePay: number;
  mealAllowance: number;
  overtimePay: number;
  bonusPay: number;
  grossAmount: number;
  nationalPension: number;
  healthInsurance: number;
  longTermCare: number;
  employmentInsurance: number;
  incomeTax: number;
  localIncomeTax: number;
  otherDeduction: number;
  deductionTotal: number;
  netAmount: number;
  deductionMode: "EXACT" | "AUTO";
  extraAllowances: { label: string; amount: number }[];
  extraDeductions: { label: string; amount: number }[];
  memo: string;
}

export interface TaxLedgerParseResult {
  headerRowIndex: number;
  detectedColumns: string[];
  rows: TaxLedgerParsedRow[];
  skippedSummaryRows: number;
}

function normHeader(h: string): string {
  return h.replace(/[\s_\-·()\[\]\/]/g, "").toLowerCase();
}

type ColRole =
  | "EMP_NO"
  | "NAME"
  | "DEPT"
  | "TITLE"
  | "BANK"
  | "PAY_DATE"
  | "BASE_PAY"
  | "MEAL"
  | "OVERTIME"
  | "BONUS"
  | "GROSS_TOTAL"
  | "NP"
  | "HI"
  | "LTC"
  | "EI"
  | "INCOME_TAX"
  | "LOCAL_TAX"
  | "OTHER_DEDUCT"
  | "DEDUCT_TOTAL"
  | "NET_PAY"
  | "MEMO"
  | "IGNORE";

function classifyHeaderColumn(rawLabel: string): ColRole {
  const n = normHeader(rawLabel);
  if (!n) return "IGNORE";

  if (/^(사번|사원번호|직원번호|사원코드|코드|직번|empno)$/.test(n)) return "EMP_NO";
  if (/^(성명|이름|사원명|직원명|수령인|대상자|근로자명|name)$/.test(n)) return "NAME";
  if (/^(부서|부서명|소속|소속부서|조직|팀|부서직책)$/.test(n)) return "DEPT";
  if (/^(직책|직위|직급|직위직책)$/.test(n)) return "TITLE";
  if (/^(계좌|계좌번호|입금계좌|지급계좌|은행계좌|입금은행계좌|은행)$/.test(n)) return "BANK";
  if (/^(지급일|지급일자|지급예정일|이체일)$/.test(n)) return "PAY_DATE";
  if (/^(비고|메모|적요|참고)$/.test(n)) return "MEMO";

  // 합계/실지급 먼저 판별
  if (
    /^(지급총액|지급합계|지급액계|급여총액|급여합계|세전총액|세전급여|세전금액|총지급액|합계액)$/.test(
      n
    )
  ) {
    return "GROSS_TOTAL";
  }
  if (/^(공제총액|공제합계|공제액계|공제계|총공제액)$/.test(n)) {
    return "DEDUCT_TOTAL";
  }
  if (
    /^(실지급액|차인지급액|실수령액|차감지급액|세후금액|세후급여|이체금액|실입금액)$/.test(
      n
    )
  ) {
    return "NET_PAY";
  }

  // 4대보험 & 세금 공제 항목
  if (/국민연금|연금보험/.test(n)) return "NP";
  if (/장기요양|노인장기/.test(n)) return "LTC";
  if (/건강보험|건보료/.test(n)) return "HI";
  if (/고용보험/.test(n)) return "EI";
  if (/지방소득세|주민세|지방세|중도정산지방|연말정산지방/.test(n)) return "LOCAL_TAX";
  if (/소득세|갑근세|근로소득세|중도정산소득|연말정산소득/.test(n)) return "INCOME_TAX";
  if (/기타공제|가불|학자금|사우회|노동조합|압류|상조회|연말정산추징/.test(n)) {
    return "OTHER_DEDUCT";
  }

  // 지급 항목
  if (/^(기본급|본봉|월기본급|월급여|정기급여)$/.test(n)) return "BASE_PAY";
  if (/식대|중식대|급식비/.test(n)) return "MEAL";
  if (/연장|시간외|초과근무|야간|휴일근로|휴일수당|마감수당|특근/.test(n)) {
    return "OVERTIME";
  }
  if (
    /상여|보너스|인센티브|성과급|직책|직무|연차수당|연구수당|차량|자가운전|보육|육아|가족수당|명절|휴가비|기타수당|자격수당|근속수당|비과세/.test(
      n
    )
  ) {
    return "BONUS";
  }

  return "IGNORE";
}

export function mapTaxLedgerRowsToDrafts(params: {
  matrix: string[][];
  members: HqMember[];
  payMonth: string;
  defaultPayDate: string;
}): TaxLedgerParseResult {
  const { matrix, members, payMonth, defaultPayDate } = params;
  if (!matrix || matrix.length === 0) {
    return {
      headerRowIndex: -1,
      detectedColumns: [],
      rows: [],
      skippedSummaryRows: 0,
    };
  }

  // 상단 15행 이내에서 가장 많은 급여 키워드가 매칭되는 헤더 행 탐색 (세무사 엑셀 상단 제목줄 자동 스킵)
  let bestRowIdx = 0;
  let bestScore = -1;
  const scanLimit = Math.min(matrix.length, 15);

  for (let r = 0; r < scanLimit; r++) {
    const row = matrix[r];
    let score = 0;
    let hasName = false;
    row.forEach((cell) => {
      const role = classifyHeaderColumn(cell);
      if (role === "NAME") {
        hasName = true;
        score += 5;
      } else if (role !== "IGNORE") {
        score += 2;
      }
    });
    if (hasName && score > bestScore) {
      bestScore = score;
      bestRowIdx = r;
    }
  }

  const rawHeaders = matrix[bestRowIdx].map((h) => h.trim());
  // 더존/위하고 2줄 병합 헤더 대응: 바로 다음 줄에 숫자보다 공제/수당 한글 헤더가 더 많으면 보조 헤더 병합
  let dataStartIdx = bestRowIdx + 1;
  if (dataStartIdx < matrix.length) {
    const nextRow = matrix[dataStartIdx];
    let subHeaderHits = 0;
    let hasNameLikeValue = false;
    nextRow.forEach((cell, idx) => {
      const role = classifyHeaderColumn(cell);
      if (role !== "IGNORE" && role !== "NAME") subHeaderHits++;
      if (classifyHeaderColumn(rawHeaders[idx] || "") === "NAME" && cell.trim()) {
        if (!/성명|이름|사원명/.test(cell)) hasNameLikeValue = true;
      }
    });
    if (subHeaderHits >= 2 && !hasNameLikeValue) {
      nextRow.forEach((subCell, idx) => {
        if (subCell.trim() && classifyHeaderColumn(subCell) !== "IGNORE") {
          rawHeaders[idx] = subCell.trim();
        }
      });
      dataStartIdx++;
    }
  }

  const colRoles = rawHeaders.map((h) => classifyHeaderColumn(h));
  const detectedColumns = rawHeaders
    .map((h, i) => (colRoles[i] !== "IGNORE" ? `${h}(${colRoles[i]})` : null))
    .filter((x): x is string => Boolean(x));

  const hasAnyDeductionCol = colRoles.some((r) =>
    ["NP", "HI", "LTC", "EI", "INCOME_TAX", "LOCAL_TAX", "DEDUCT_TOTAL"].includes(r)
  );

  // 구성원 매칭 인덱스 준비
  const byEmpNo = new Map<string, HqMember>();
  const byName = new Map<string, HqMember[]>();
  members.forEach((m) => {
    if (m.employee_no) {
      byEmpNo.set(m.employee_no.trim().toUpperCase(), m);
    }
    const cleanName = (m.name || "").replace(/\s+/g, "");
    if (cleanName) {
      const list = byName.get(cleanName) || [];
      list.push(m);
      byName.set(cleanName, list);
    }
  });

  const parsedRows: TaxLedgerParsedRow[] = [];
  let skippedSummaryRows = 0;

  for (let r = dataStartIdx; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line || line.every((c) => !c || !c.trim())) continue;

    let empNo = "";
    let name = "";
    let dept = "";
    let title = "";
    let bank = "";
    let rowPayDate = "";
    let memo = "";

    let basePay = 0;
    let mealAllowance = 0;
    let overtimePay = 0;
    let bonusPay = 0;
    let explicitGross: number | null = null;

    let np = 0;
    let hi = 0;
    let ltc = 0;
    let ei = 0;
    let incomeTax = 0;
    let localTax = 0;
    let otherDeduct = 0;
    let explicitDeductTotal: number | null = null;
    let explicitNetPay: number | null = null;

    const extraAllowances: { label: string; amount: number }[] = [];
    const extraDeductions: { label: string; amount: number }[] = [];

    for (let c = 0; c < colRoles.length; c++) {
      const role = colRoles[c];
      const val = (line[c] ?? "").trim();
      if (!val || role === "IGNORE") continue;

      switch (role) {
        case "EMP_NO":
          empNo = val;
          break;
        case "NAME":
          name = val;
          break;
        case "DEPT":
          dept = val;
          break;
        case "TITLE":
          title = val;
          break;
        case "BANK":
          bank = bank ? `${bank} ${val}` : val;
          break;
        case "PAY_DATE":
          rowPayDate = val;
          break;
        case "MEMO":
          memo = memo ? `${memo} / ${val}` : val;
          break;
        case "BASE_PAY":
          basePay += Math.max(0, parseCurrencyNumber(val));
          break;
        case "MEAL":
          mealAllowance += Math.max(0, parseCurrencyNumber(val));
          break;
        case "OVERTIME":
          overtimePay += Math.max(0, parseCurrencyNumber(val));
          break;
        case "BONUS": {
          const amt = parseCurrencyNumber(val);
          if (amt !== 0) {
            bonusPay += amt;
            extraAllowances.push({
              label: rawHeaders[c] || "기타수당",
              amount: amt,
            });
          }
          break;
        }
        case "GROSS_TOTAL":
          explicitGross = parseCurrencyNumber(val);
          break;
        case "NP":
          np += parseCurrencyNumber(val);
          break;
        case "HI":
          hi += parseCurrencyNumber(val);
          break;
        case "LTC":
          ltc += parseCurrencyNumber(val);
          break;
        case "EI":
          ei += parseCurrencyNumber(val);
          break;
        case "INCOME_TAX":
          incomeTax += parseCurrencyNumber(val);
          break;
        case "LOCAL_TAX":
          localTax += parseCurrencyNumber(val);
          break;
        case "OTHER_DEDUCT": {
          const amt = parseCurrencyNumber(val);
          if (amt !== 0) {
            otherDeduct += amt;
            extraDeductions.push({
              label: rawHeaders[c] || "기타공제",
              amount: amt,
            });
          }
          break;
        }
        case "DEDUCT_TOTAL":
          explicitDeductTotal = parseCurrencyNumber(val);
          break;
        case "NET_PAY":
          explicitNetPay = parseCurrencyNumber(val);
          break;
      }
    }

    const joinedFirstCells = line.slice(0, 4).join(" ");
    if (
      !name ||
      /^(합계|총계|소계|계|총합계|total|sum)$/i.test(name.replace(/\s+/g, "")) ||
      /합\s*계|총\s*계|소\s*계/.test(joinedFirstCells)
    ) {
      skippedSummaryRows++;
      continue;
    }

    // 세전 총액 보정: 세무사 급여대장에 미분류 수당 열이 있어 지급총액이 더 크면 차액을 기타수당으로 보전
    let sumAllowances = basePay + mealAllowance + overtimePay + bonusPay;
    if (explicitGross !== null && explicitGross > 0 && sumAllowances === 0) {
      basePay = explicitGross;
      sumAllowances = explicitGross;
    } else if (explicitGross !== null && explicitGross !== sumAllowances) {
      const diff = explicitGross - sumAllowances;
      bonusPay += diff;
      extraAllowances.push({ label: "기타 지급항목(대장차액)", amount: diff });
      sumAllowances = explicitGross;
    }

    if (sumAllowances <= 0 && (explicitNetPay ?? 0) <= 0) {
      skippedSummaryRows++;
      continue;
    }

    let deductionMode: "EXACT" | "AUTO" = hasAnyDeductionCol ? "EXACT" : "AUTO";
    let deductionTotal = 0;
    let netAmount = 0;

    if (deductionMode === "EXACT") {
      const sumSix = np + hi + ltc + ei + incomeTax + localTax + otherDeduct;
      if (explicitDeductTotal !== null && explicitDeductTotal !== sumSix) {
        const diff = explicitDeductTotal - sumSix;
        otherDeduct += diff;
        extraDeductions.push({ label: "기타·정산공제", amount: diff });
        deductionTotal = explicitDeductTotal;
      } else if (
        explicitDeductTotal === null &&
        explicitNetPay !== null &&
        sumAllowances - explicitNetPay !== sumSix
      ) {
        const targetDeduct = sumAllowances - explicitNetPay;
        const diff = targetDeduct - sumSix;
        otherDeduct += diff;
        extraDeductions.push({ label: "기타·정산공제", amount: diff });
        deductionTotal = targetDeduct;
      } else {
        deductionTotal = sumSix;
      }
      netAmount =
        explicitNetPay !== null
          ? explicitNetPay
          : Math.max(0, sumAllowances - deductionTotal);
    } else {
      const auto = calculatePayrollAmounts({
        payType: "EMPLOYEE",
        basePay,
        mealAllowance,
        overtimePay,
        bonusPay: Math.max(0, bonusPay),
      });
      np = auto.nationalPension;
      hi = auto.healthInsurance;
      ltc = auto.longTermCare;
      ei = auto.employmentInsurance;
      incomeTax = auto.incomeTax;
      localTax = auto.localIncomeTax;
      deductionTotal = auto.deductionTotal;
      netAmount = auto.netAmount;
    }

    // 구성원 자동 매칭 (1순위: 사번, 2순위: 성명)
    let matched: HqMember | null = null;
    let matchedBy: "EMP_NO" | "NAME" | "UNMATCHED" = "UNMATCHED";

    if (empNo && byEmpNo.has(empNo.trim().toUpperCase())) {
      matched = byEmpNo.get(empNo.trim().toUpperCase()) || null;
      if (matched) matchedBy = "EMP_NO";
    }
    if (!matched) {
      const cleanName = name.replace(/\s+/g, "");
      const candidates = byName.get(cleanName) || [];
      if (candidates.length === 1) {
        matched = candidates[0];
        matchedBy = "NAME";
      } else if (candidates.length > 1) {
        matched =
          candidates.find((c) => dept && c.department.includes(dept)) ||
          candidates.find((c) => c.work_status === "재직") ||
          candidates[0];
        matchedBy = "NAME";
      }
    }

    const finalDeptOrRole =
      [dept, title].filter(Boolean).join(" · ") ||
      (matched ? `${matched.department} · ${matched.job_title}` : "본부 임직원");

    const finalBank =
      bank ||
      (matched
        ? [matched.bank_name, matched.bank_account, matched.account_holder]
            .filter(Boolean)
            .join(" ")
        : "");

    // 날짜 정규화 (YYYY-MM-DD 형태 유지, 아니면 기본 지급일 사용)
    const normalizedDate = /^\d{4}[-.]\d{1,2}[-.]\d{1,2}$/.test(rowPayDate)
      ? rowPayDate
          .split(/[-.]/)
          .map((p, idx) => (idx === 0 ? p : p.padStart(2, "0")))
          .join("-")
      : defaultPayDate || `${payMonth}-25`;

    parsedRows.push({
      rowIndex: r + 1,
      matchedMemberId: matched?.instructor_id || null,
      matchedBy,
      employeeNo: empNo || matched?.employee_no || "",
      payeeName: matched?.name || name,
      departmentOrRole: finalDeptOrRole,
      bankInfo: finalBank,
      payDate: normalizedDate,
      basePay,
      mealAllowance,
      overtimePay,
      bonusPay,
      grossAmount: sumAllowances,
      nationalPension: np,
      healthInsurance: hi,
      longTermCare: ltc,
      employmentInsurance: ei,
      incomeTax,
      localIncomeTax: localTax,
      otherDeduction: otherDeduct,
      deductionTotal,
      netAmount,
      deductionMode,
      extraAllowances,
      extraDeductions,
      memo: memo || "세무사 급여대장 업로드 확정분",
    });
  }

  return {
    headerRowIndex: bestRowIdx + 1,
    detectedColumns,
    rows: parsedRows,
    skippedSummaryRows,
  };
}

// ============================================================================
// 4. 표준 양식 · 세무사 전달 패키지 · 은행 대량이체 CSV 생성기
// ============================================================================

export function buildTaxLedgerUploadTemplateCsv(
  members: HqMember[],
  payMonth: string
): string {
  const active = members.filter((m) => m.work_status === "재직");
  const header = [
    "사번",
    "성명",
    "부서",
    "직책",
    "기본급",
    "비과세식대",
    "연장수당",
    "상여수당",
    "국민연금",
    "건강보험",
    "장기요양보험",
    "고용보험",
    "소득세",
    "지방소득세",
    "기타공제",
    "실지급액",
    "지급계좌",
    "지급일",
    "비고",
  ];

  const rows: (string | number)[][] = [header];
  active.forEach((m) => {
    const wc = m.profile_extra?.wage_contract;
    const lc = m.profile_extra?.labor_contract;
    const defaultMeal =
      wc?.meal_allowance !== undefined ? Number(wc.meal_allowance) : 200_000;
    const rawBase = wc?.monthly_base
      ? Number(wc.monthly_base)
      : wc?.annual_salary
      ? Math.max(0, Math.round(Number(wc.annual_salary) / 12) - defaultMeal)
      : 2_800_000;
    const rawFixedOt = Number(wc?.fixed_overtime_allowance || 0);

    const inProbation =
      Boolean(lc?.probation_end_date && lc.probation_end_date >= `${payMonth}-01`) &&
      (!lc?.probation_start_date || lc.probation_start_date <= `${payMonth}-31`);
    const rateRatio =
      inProbation &&
      lc?.salary_pay_rate !== undefined &&
      lc?.salary_pay_rate !== null &&
      Number(lc.salary_pay_rate) > 0 &&
      Number(lc.salary_pay_rate) < 100
        ? Number(lc.salary_pay_rate) / 100
        : 1;

    const defaultBase = Math.round(rawBase * rateRatio);
    const defaultOvertime = Math.round(rawFixedOt * rateRatio);

    const auto = calculatePayrollAmounts({
      payType: "EMPLOYEE",
      basePay: defaultBase,
      mealAllowance: defaultMeal,
      overtimePay: defaultOvertime,
      bonusPay: 0,
    });
    const bank = [m.bank_name, m.bank_account, m.account_holder]
      .filter(Boolean)
      .join(" ");

    rows.push([
      m.employee_no || "",
      m.name,
      m.department || "",
      m.job_title || "",
      defaultBase,
      defaultMeal,
      defaultOvertime,
      0,
      auto.nationalPension,
      auto.healthInsurance,
      auto.longTermCare,
      auto.employmentInsurance,
      auto.incomeTax,
      auto.localIncomeTax,
      0,
      auto.netAmount,
      bank,
      `${payMonth}-25`,
      "세무사 급여대장 확정치 입력",
    ]);
  });

  return buildCsvContent(rows);
}

export interface MonthlyPrepAttendanceSummary {
  memberId: string;
  workDays: number;
  workedHours: number;
  overtimeHours: number;
  annualLeaveDays: number;
  specialOrUnpaidLeaves: string[];
}

export function summarizeMonthlyPrepByMember(params: {
  payMonth: string;
  members: HqMember[];
  attendanceRows: HqAttendanceRecord[];
  leaveDocs: HqApprovalDoc[];
}): Map<string, MonthlyPrepAttendanceSummary> {
  const { payMonth, members, attendanceRows, leaveDocs } = params;
  const map = new Map<string, MonthlyPrepAttendanceSummary>();

  members.forEach((m) => {
    map.set(m.instructor_id, {
      memberId: m.instructor_id,
      workDays: 0,
      workedHours: 0,
      overtimeHours: 0,
      annualLeaveDays: 0,
      specialOrUnpaidLeaves: [],
    });
  });

  attendanceRows.forEach((a) => {
    if (!a.work_date?.startsWith(payMonth)) return;
    const item = map.get(a.instructor_id);
    if (!item) return;
    if (a.status === "WORKING" || a.status === "DONE" || a.status === "HALF_LEAVE") {
      item.workDays += 1;
    }
    item.workedHours += Number(a.worked_minutes || 0) / 60;
    item.overtimeHours += Number(a.overtime_minutes || 0) / 60;
  });

  const [yStr, mStr] = payMonth.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const monthStart = `${payMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${payMonth}-${String(lastDay).padStart(2, "0")}`;

  leaveDocs.forEach((doc) => {
    if (doc.status !== "APPROVED") return;
    const s = doc.effective_date || "";
    const e = doc.end_date || s;
    if (!s || e < monthStart || s > monthEnd) return;
    const item = map.get(doc.drafter_id);
    if (!item) return;

    const lType = doc.leave_type || "연차";
    const days = Number(doc.leave_days || 1);
    if (/연차|반차|반반차/.test(lType)) {
      item.annualLeaveDays += days;
    } else {
      item.specialOrUnpaidLeaves.push(`${lType}(${days}일, ${s})`);
    }
  });

  map.forEach((v) => {
    v.workedHours = Math.round(v.workedHours * 10) / 10;
    v.overtimeHours = Math.round(v.overtimeHours * 10) / 10;
    v.annualLeaveDays = Math.round(v.annualLeaveDays * 100) / 100;
  });

  return map;
}

export function buildTaxAccountantMonthlyPackageCsv(params: {
  companyName: string;
  payMonth: string;
  members: HqMember[];
  payrollRecords: HqPayrollRecord[];
  prepMap: Map<string, MonthlyPrepAttendanceSummary>;
}): string {
  const { companyName, payMonth, members, payrollRecords, prepMap } = params;

  const hrChanges = members.filter(
    (m) =>
      (m.hire_date && m.hire_date.startsWith(payMonth)) ||
      (m.resign_date && m.resign_date.startsWith(payMonth)) ||
      m.work_status === "휴직"
  );

  const empPayrollByMember = new Map<string, HqPayrollRecord>();
  payrollRecords
    .filter((r) => r.pay_type === "EMPLOYEE" && r.member_id)
    .forEach((r) => empPayrollByMember.set(String(r.member_id), r));

  const externalWithholding = payrollRecords.filter(
    (r) => r.pay_type !== "EMPLOYEE"
  );

  const rows: (string | number)[][] = [];
  rows.push([`[${companyName}] ${payMonth} 귀속 세무사 전달용 급여 · 원천세 기초자료`]);
  rows.push([`생성일시`, new Date().toLocaleString("ko-KR")]);
  rows.push([]);

  // 섹션 1: 당월 입·퇴사 및 휴직 변동자 (4대보험 취득·상실·휴직 신고 대상)
  rows.push(["■ 1. 당월 입사 · 퇴사 · 휴직 변동자 (4대보험 취득/상실/유예 확인)"]);
  rows.push([
    "구분",
    "사번",
    "성명",
    "주민등록번호(앞-뒷첫자리)",
    "소속부서",
    "직책",
    "고용형태",
    "입사일",
    "퇴사일",
    "계약 월기본급",
    "비과세식대",
    "급여계좌",
  ]);
  if (hrChanges.length === 0) {
    rows.push(["해당 없음 (당월 입·퇴사 및 휴직 변동 인원 없음)"]);
  } else {
    hrChanges.forEach((m) => {
      const changeLabel =
        m.resign_date && m.resign_date.startsWith(payMonth)
          ? "당월 퇴사"
          : m.hire_date && m.hire_date.startsWith(payMonth)
          ? "당월 신규입사"
          : m.work_status;
      const rrnFront = m.profile_extra?.rrn_front || "";
      const rrnDigit = m.profile_extra?.rrn_gender_digit || "";
      const rrnMasked = rrnFront ? `${rrnFront}-${rrnDigit || "*"}******` : "미등록";
      const wc = m.profile_extra?.wage_contract;
      rows.push([
        changeLabel,
        m.employee_no || "",
        m.name,
        rrnMasked,
        m.department,
        m.job_title,
        m.employment_type,
        m.hire_date || "",
        m.resign_date || "",
        wc?.monthly_base || "",
        wc?.meal_allowance ?? 200000,
        [m.bank_name, m.bank_account, m.account_holder].filter(Boolean).join(" "),
      ]);
    });
  }
  rows.push([]);

  // 섹션 2: 재직 임직원 월간 근태 · 휴가 · 변동수당 요약
  rows.push(["■ 2. 재직 임직원 월간 근태 · 연장근무 · 변동수당 집계"]);
  rows.push([
    "사번",
    "성명",
    "부서",
    "직책",
    "출근일수",
    "총근무(시간)",
    "연장근무(시간)",
    "연차사용(일)",
    "기타/특별휴가(병가·출산·무급 등)",
    "당월 기본급(안)",
    "비과세식대(안)",
    "연장·마감수당",
    "상여·기타수당",
    "전달 메모",
  ]);

  const activeMembers = members.filter(
    (m) =>
      m.work_status === "재직" ||
      (m.resign_date && m.resign_date.startsWith(payMonth))
  );
  activeMembers.forEach((m) => {
    const prep = prepMap.get(m.instructor_id);
    const pr = empPayrollByMember.get(m.instructor_id);
    const wc = m.profile_extra?.wage_contract;
    const baseEst =
      pr?.base_pay ??
      wc?.monthly_base ??
      (wc?.annual_salary ? Math.round(wc.annual_salary / 12) - 200000 : "");
    const mealEst = pr?.meal_allowance ?? wc?.meal_allowance ?? 200000;

    rows.push([
      m.employee_no || "",
      m.name,
      m.department,
      m.job_title,
      prep?.workDays ?? 0,
      prep?.workedHours ?? 0,
      prep?.overtimeHours ?? 0,
      prep?.annualLeaveDays ?? 0,
      prep?.specialOrUnpaidLeaves.join("; ") || "-",
      baseEst,
      mealEst,
      pr?.overtime_pay ?? 0,
      pr?.bonus_pay ?? 0,
      pr?.memo || "",
    ]);
  });
  rows.push([]);

  // 섹션 3: 외주 사업소득(3.3%) · 기타소득(8.8%) · 저자 인세 지급내역
  rows.push([
    "■ 3. 당월 외주 프리랜서(3.3%) · 원고검토 기타소득(8.8%) · 저자 인세 지급내역 (원천세 및 간이지급명세서 신고용)",
  ]);
  rows.push([
    "소득구분",
    "홈택스 신고안내",
    "수령인 성명(상호)",
    "주민/사업자번호(메모)",
    "역할/구분",
    "대상 도서 · 프로젝트",
    "지급일자",
    "총지급액(세전)",
    "필요경비(60%)",
    "과세소득금액",
    "소득세",
    "지방소득세",
    "원천세 합계",
    "차인 실지급액",
    "입금계좌",
    "비고",
  ]);
  if (externalWithholding.length === 0) {
    rows.push(["해당 없음 (당월 등록된 사업·기타·인세 원천징수 내역 없음)"]);
  } else {
    externalWithholding.forEach((r) => {
      const wh = describeExternalWithholdingRecord(r);
      rows.push([
        wh.ledgerLabel,
        wh.hometaxCodeHint,
        r.payee_name,
        r.calc_meta?.resident_or_biz_no || "",
        r.department_or_role || "",
        r.book_or_project || "",
        r.pay_date || "",
        wh.grossAmount,
        wh.necessaryExpense,
        wh.taxableIncome,
        wh.incomeTax,
        wh.localIncomeTax,
        wh.withholdingTotal,
        wh.netAmount,
        r.bank_info || "",
        [r.memo, wh.taxExemptionNote].filter(Boolean).join(" / "),
      ]);
    });
  }

  return buildCsvContent(rows);
}

/**
 * 사업소득(3.3%) · 기타소득(8.8%) · 저자인세 전용 원천징수 & 간이지급명세서 검증용 CSV 생성기
 */
export function buildExternalWithholdingStatementCsv(params: {
  companyName: string;
  payMonth: string;
  payrollRecords: HqPayrollRecord[];
}): string {
  const { companyName, payMonth, payrollRecords } = params;
  const ext = payrollRecords.filter((r) => r.pay_type !== "EMPLOYEE");
  const rows: (string | number)[][] = [];
  rows.push([
    `[${companyName}] ${payMonth} 귀속 사업소득(A25) · 기타소득(A40) · 저자인세 원천징수 및 간이지급명세서 대장`,
  ]);
  rows.push([
    "귀속연월",
    "원천징수세목",
    "소득구분 상세",
    "홈택스 업종/소득코드 안내",
    "수령인 성명(상호)",
    "주민/사업자등록번호",
    "대상 도서 · 프로젝트",
    "지급일자",
    "총지급액(공급가액)",
    "필요경비(기타 60%)",
    "과세소득금액",
    "적용세율 안내",
    "소득세",
    "지방소득세",
    "원천세 합계",
    "차인 실지급액",
    "입금계좌",
    "비고(과세최저한·선인세 상계 등)",
  ]);

  let bizCnt = 0,
    bizGross = 0,
    bizItax = 0,
    bizLtax = 0;
  let othCnt = 0,
    othGross = 0,
    othExp = 0,
    othInc = 0,
    othItax = 0,
    othLtax = 0;

  ext.forEach((r) => {
    const wh = describeExternalWithholdingRecord(r);
    if (wh.mode === "OTHER_88") {
      othCnt += 1;
      othGross += wh.grossAmount;
      othExp += wh.necessaryExpense;
      othInc += wh.taxableIncome;
      othItax += wh.incomeTax;
      othLtax += wh.localIncomeTax;
    } else {
      bizCnt += 1;
      bizGross += wh.grossAmount;
      bizItax += wh.incomeTax;
      bizLtax += wh.localIncomeTax;
    }
    rows.push([
      r.pay_month,
      wh.mode === "OTHER_88" ? "A40 기타소득" : "A25 거주자 사업소득",
      wh.ledgerLabel,
      wh.hometaxCodeHint,
      r.payee_name,
      r.calc_meta?.resident_or_biz_no || "미입력",
      r.book_or_project || "",
      r.pay_date || "",
      wh.grossAmount,
      wh.necessaryExpense,
      wh.taxableIncome,
      wh.nominalRateText,
      wh.incomeTax,
      wh.localIncomeTax,
      wh.withholdingTotal,
      wh.netAmount,
      r.bank_info || "",
      [r.memo, wh.taxExemptionNote].filter(Boolean).join(" / "),
    ]);
  });

  rows.push([]);
  rows.push(["■ 원천징수이행상황신고서 세목별 합계 요약"]);
  rows.push([
    "세목코드",
    "인원(건수)",
    "총지급액 합계",
    "필요경비 합계",
    "소득금액 합계",
    "소득세 합계",
    "지방소득세 합계",
    "납부할 원천세 합계",
  ]);
  rows.push([
    "A25 거주자 사업소득 (외주 프리랜서 · 사업자 저자 인세)",
    bizCnt,
    bizGross,
    0,
    bizGross,
    bizItax,
    bizLtax,
    bizItax + bizLtax,
  ]);
  rows.push([
    "A40 기타소득 (원고·검토료 · 비사업자 저자 인세)",
    othCnt,
    othGross,
    othExp,
    othInc,
    othItax,
    othLtax,
    othItax + othLtax,
  ]);

  return buildCsvContent(rows);
}

// ============================================================================
// 5. 은행 대량이체용 계좌 파서 & CSV 생성기
// ============================================================================

const KNOWN_BANK_NAMES = [
  "KB국민",
  "국민은행",
  "국민",
  "신한은행",
  "신한",
  "하나은행",
  "KEB하나",
  "하나",
  "우리은행",
  "우리",
  "IBK기업",
  "기업은행",
  "기업",
  "NH농협",
  "농협은행",
  "농협",
  "카카오뱅크",
  "카뱅",
  "토스뱅크",
  "토스",
  "케이뱅크",
  "SC제일은행",
  "SC제일",
  "제일",
  "한국씨티",
  "씨티",
  "부산은행",
  "부산",
  "대구은행",
  "iM뱅크",
  "대구",
  "경남은행",
  "경남",
  "광주은행",
  "광주",
  "전북은행",
  "전북",
  "제주은행",
  "제주",
  "수협은행",
  "수협",
  "신협",
  "새마을금고",
  "새마을",
  "우체국",
  "산업은행",
  "산은",
];

export interface ParsedBankTransferItem {
  payrollId: string;
  payType: HqPayrollType;
  payeeName: string;
  bankName: string;
  accountNo: string;
  accountHolder: string;
  netAmount: number;
  senderMemo: string;
  receiverMemo: string;
  missingAccount: boolean;
}

export function parseBankTransferItems(params: {
  records: HqPayrollRecord[];
  members: HqMember[];
  companyName: string;
  stripHyphens: boolean;
  receiverMemoCustom?: string;
}): ParsedBankTransferItem[] {
  const { records, members, companyName, stripHyphens, receiverMemoCustom } = params;
  const memberMap = new Map<string, HqMember>();
  members.forEach((m) => memberMap.set(m.instructor_id, m));

  return records.map((r) => {
    const matchedMember = r.member_id ? memberMap.get(r.member_id) : undefined;
    let bankName = matchedMember?.bank_name?.trim() || "";
    let accountNo = matchedMember?.bank_account?.trim() || "";
    let accountHolder = matchedMember?.account_holder?.trim() || r.payee_name;

    // 레코드의 bank_info 텍스트에서 파싱 보완 (예: "신한 110-123-456789 홍길동")
    if ((!bankName || !accountNo) && r.bank_info) {
      const raw = r.bank_info.trim();
      const accMatch = raw.match(/\d[\d\-]{6,}\d/);
      if (accMatch) {
        accountNo = accMatch[0];
        const before = raw.slice(0, accMatch.index).trim();
        const after = raw
          .slice((accMatch.index || 0) + accMatch[0].length)
          .replace(/[()]/g, "")
          .trim();
        if (before) bankName = before;
        if (after) accountHolder = after;
      } else {
        const foundBank = KNOWN_BANK_NAMES.find((b) => raw.includes(b));
        if (foundBank && !bankName) bankName = foundBank;
      }
    }

    const formattedAccount = stripHyphens
      ? accountNo.replace(/[^0-9]/g, "")
      : accountNo;

    const ymShort = r.pay_month ? `${Number(r.pay_month.split("-")[1])}월` : "";
    const kindWord =
      r.pay_type === "EMPLOYEE"
        ? "급여"
        : r.pay_type === "ROYALTY"
        ? "인세"
        : "용역비";

    return {
      payrollId: r.payroll_id,
      payType: r.pay_type,
      payeeName: r.payee_name,
      bankName,
      accountNo: formattedAccount,
      accountHolder: accountHolder || r.payee_name,
      netAmount: Number(r.net_amount || 0),
      senderMemo: `${ymShort}${kindWord}_${r.payee_name}`.slice(0, 14),
      receiverMemo: (receiverMemoCustom || companyName || "천종현수학연구소").slice(
        0,
        14
      ),
      missingAccount: !bankName || !formattedAccount,
    };
  });
}

export function buildBankBulkTransferCsv(items: ParsedBankTransferItem[]): string {
  const header = [
    "입금은행",
    "입금계좌번호",
    "이체금액(원)",
    "예금주성명",
    "출금통장표시(회사)",
    "입금통장표시(수령인)",
  ];
  const rows: (string | number)[][] = [header];
  items.forEach((it) => {
    rows.push([
      it.bankName,
      it.accountNo,
      it.netAmount,
      it.accountHolder,
      it.senderMemo,
      it.receiverMemo,
    ]);
  });
  return buildCsvContent(rows);
}

// ============================================================================
// 6. 근로기준법 · 퇴직급여보장법 기반 퇴직금 시뮬레이터
// ============================================================================

export interface SeveranceMonthSlice {
  label: string; // 예: "퇴직 전 1개월"
  startDate: string;
  endDate: string;
  calendarDays: number;
  baseAndFixedPay: number;
  variableOvertimePay: number;
}

export interface SeveranceCalcResult {
  eligible: boolean; // 재직일수 365일 이상 여부
  tenureDays: number;
  tenureYearsCeiling: number;
  tenureText: string;
  threeMonthDays: number;
  threeMonthWageSum: number;
  bonusThreeMonthPortion: number;
  annualLeaveThreeMonthPortion: number;
  totalThreeMonthBase: number;
  dailyAverageWage: number; // 1일 평균임금
  dailyOrdinaryWage: number; // 1일 통상임금 (월통상임금 / 209 * 8)
  appliedDailyWage: number; // 법정 적용 1일 임금 (평균 < 통상 시 통상임금 적용)
  ordinaryWageApplied: boolean;
  grossSeverance: number; // 세전 퇴직급여
  estimatedIncomeTax: number; // 퇴직소득세 근사치
  estimatedLocalTax: number; // 지방소득세 근사치
  netSeverance: number; // 예상 차인지급 퇴직금
}

function parseLocalYmd(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatUtcYmd(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/**
 * 마지막 근무일(또는 퇴직일 전날) 기준 직전 3개월 구간 및 역일수(89~92일) 자동 산출
 */
export function buildDefaultThreeMonthSlices(
  resignDateYmd: string,
  defaultMonthlyBase: number,
  defaultMeal: number
): SeveranceMonthSlice[] {
  const resignDt = parseLocalYmd(resignDateYmd);
  if (!resignDt) return [];

  // 퇴직일 = 마지막 근무일의 다음날 기준이 원칙이나, 실무 편의를 위해 퇴직일 전날까지 3개월 역산
  const endAnchor = new Date(resignDt.getTime() - 86400000);
  const slices: SeveranceMonthSlice[] = [];

  let cursorEnd = endAnchor;
  for (let i = 1; i <= 3; i++) {
    const endY = cursorEnd.getUTCFullYear();
    const endM = cursorEnd.getUTCMonth();
    const endD = cursorEnd.getUTCDate();

    // 직전 달 같은 날 + 1일
    const prevMonthSameDay = new Date(Date.UTC(endY, endM - 1, endD));
    // 월말 보정 (예: 3월 31일의 1개월 전 -> 2월 말일)
    if (prevMonthSameDay.getUTCMonth() !== (endM + 11) % 12) {
      prevMonthSameDay.setUTCDate(0);
    }
    const startDt = new Date(prevMonthSameDay.getTime() + 86400000);
    const days =
      Math.round((cursorEnd.getTime() - startDt.getTime()) / 86400000) + 1;

    slices.push({
      label: `직전 ${i}개월`,
      startDate: formatUtcYmd(startDt),
      endDate: formatUtcYmd(cursorEnd),
      calendarDays: Math.max(28, days),
      baseAndFixedPay: Math.max(0, defaultMonthlyBase + defaultMeal),
      variableOvertimePay: 0,
    });

    cursorEnd = new Date(startDt.getTime() - 86400000);
  }

  return slices.reverse();
}

export function calculateSeveranceEstimate(params: {
  hireDate: string;
  resignDate: string; // 퇴직일 (마지막 근무일 다음날 기준)
  slices: SeveranceMonthSlice[];
  annualBonusTotal: number; // 퇴직 전 1년간 지급된 상여금 총액
  unusedAnnualLeavePay: number; // 전년도 미사용 연차수당
  monthlyOrdinaryWage: number; // 월 통상임금 (기본급 + 고정식대 등)
}): SeveranceCalcResult {
  const hireDt = parseLocalYmd(params.hireDate);
  const resignDt = parseLocalYmd(params.resignDate);

  if (!hireDt || !resignDt || resignDt <= hireDt) {
    return {
      eligible: false,
      tenureDays: 0,
      tenureYearsCeiling: 0,
      tenureText: "입사일 · 퇴직일 확인 필요",
      threeMonthDays: 0,
      threeMonthWageSum: 0,
      bonusThreeMonthPortion: 0,
      annualLeaveThreeMonthPortion: 0,
      totalThreeMonthBase: 0,
      dailyAverageWage: 0,
      dailyOrdinaryWage: 0,
      appliedDailyWage: 0,
      ordinaryWageApplied: false,
      grossSeverance: 0,
      estimatedIncomeTax: 0,
      estimatedLocalTax: 0,
      netSeverance: 0,
    };
  }

  const tenureDays = Math.round(
    (resignDt.getTime() - hireDt.getTime()) / 86400000
  );
  const eligible = tenureDays >= 365;
  const years = Math.floor(tenureDays / 365);
  const remDays = tenureDays % 365;
  const tenureYearsCeiling = Math.max(1, Math.ceil(tenureDays / 365));
  const tenureText =
    years > 0 ? `${years}년 ${remDays}일 (총 ${tenureDays.toLocaleString()}일)` : `${tenureDays}일 (1년 미만)`;

  const threeMonthDays = params.slices.reduce(
    (acc, s) => acc + Math.max(1, Number(s.calendarDays || 0)),
    0
  );
  const threeMonthWageSum = params.slices.reduce(
    (acc, s) =>
      acc +
      Math.max(0, Number(s.baseAndFixedPay || 0)) +
      Math.max(0, Number(s.variableOvertimePay || 0)),
    0
  );

  const bonusThreeMonthPortion = Math.round(
    (Math.max(0, params.annualBonusTotal || 0) * 3) / 12
  );
  const annualLeaveThreeMonthPortion = Math.round(
    (Math.max(0, params.unusedAnnualLeavePay || 0) * 3) / 12
  );
  const totalThreeMonthBase =
    threeMonthWageSum + bonusThreeMonthPortion + annualLeaveThreeMonthPortion;

  const dailyAverageWage =
    threeMonthDays > 0 ? Math.round(totalThreeMonthBase / threeMonthDays) : 0;
  const dailyOrdinaryWage = Math.round(
    (Math.max(0, params.monthlyOrdinaryWage || 0) / 209) * 8
  );

  // 근로기준법 제2조 제2항: 산출된 평균임금이 통상임금보다 적으면 통상임금을 평균임금으로 함
  const ordinaryWageApplied = dailyOrdinaryWage > dailyAverageWage;
  const appliedDailyWage = ordinaryWageApplied
    ? dailyOrdinaryWage
    : dailyAverageWage;

  const grossSeverance = Math.floor(
    (appliedDailyWage * 30 * (tenureDays / 365)) / 10
  ) * 10;

  // 현행 소득세법 근속연수공제(2023년 이후 상향 기준) 및 환산급여공제 기반 퇴직소득세 근사치 계산
  let serviceDeduction = 0;
  const y = tenureYearsCeiling;
  if (y <= 5) serviceDeduction = y * 1_000_000;
  else if (y <= 10) serviceDeduction = 5_000_000 + (y - 5) * 2_000_000;
  else if (y <= 20) serviceDeduction = 15_000_000 + (y - 10) * 2_500_000;
  else serviceDeduction = 40_000_000 + (y - 20) * 3_000_000;

  const afterService = Math.max(0, grossSeverance - serviceDeduction);
  const convertedSalary = y > 0 ? Math.round((afterService * 12) / y) : 0;

  let convertedDeduction = 0;
  if (convertedSalary <= 8_000_000) {
    convertedDeduction = convertedSalary;
  } else if (convertedSalary <= 70_000_000) {
    convertedDeduction = 8_000_000 + Math.round((convertedSalary - 8_000_000) * 0.6);
  } else if (convertedSalary <= 100_000_000) {
    convertedDeduction = 45_200_000 + Math.round((convertedSalary - 70_000_000) * 0.55);
  } else if (convertedSalary <= 300_000_000) {
    convertedDeduction = 61_700_000 + Math.round((convertedSalary - 100_000_000) * 0.45);
  } else {
    convertedDeduction = 151_700_000 + Math.round((convertedSalary - 300_000_000) * 0.35);
  }

  const convertedTaxBase = Math.max(0, convertedSalary - convertedDeduction);

  // 기본 종합소득세율표 적용 후 연수 환산
  let convertedTax = 0;
  if (convertedTaxBase <= 14_000_000) {
    convertedTax = convertedTaxBase * 0.06;
  } else if (convertedTaxBase <= 50_000_000) {
    convertedTax = 840_000 + (convertedTaxBase - 14_000_000) * 0.15;
  } else if (convertedTaxBase <= 88_000_000) {
    convertedTax = 6_240_000 + (convertedTaxBase - 50_000_000) * 0.24;
  } else if (convertedTaxBase <= 150_000_000) {
    convertedTax = 15_360_000 + (convertedTaxBase - 88_000_000) * 0.35;
  } else {
    convertedTax = 37_060_000 + (convertedTaxBase - 150_000_000) * 0.38;
  }

  const floor10 = (n: number) => Math.floor(n / 10) * 10;
  const estimatedIncomeTax =
    grossSeverance > 0 ? floor10((convertedTax / 12) * y) : 0;
  const estimatedLocalTax = floor10(estimatedIncomeTax * 0.1);
  const netSeverance = Math.max(
    0,
    grossSeverance - estimatedIncomeTax - estimatedLocalTax
  );

  return {
    eligible,
    tenureDays,
    tenureYearsCeiling,
    tenureText,
    threeMonthDays,
    threeMonthWageSum,
    bonusThreeMonthPortion,
    annualLeaveThreeMonthPortion,
    totalThreeMonthBase,
    dailyAverageWage,
    dailyOrdinaryWage,
    appliedDailyWage,
    ordinaryWageApplied,
    grossSeverance,
    estimatedIncomeTax,
    estimatedLocalTax,
    netSeverance,
  };
}
