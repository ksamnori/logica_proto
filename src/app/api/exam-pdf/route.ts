// src/app/api/exam-pdf/route.ts

import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer-core";
// @ts-ignore: 해당 패키지는 공식 타입 선언이 없으므로 TS 에러 무시
import chromium from "@sparticuz/chromium-min";
import { PDFDocument } from "pdf-lib";
import fs from "fs";
import os from "os";

export const runtime = "nodejs";
export const maxDuration = 60;

const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function findExistingChrome(): string | null {
  if (process.env.CHROME_EXECUTABLE_PATH && fs.existsSync(process.env.CHROME_EXECUTABLE_PATH)) {
    return process.env.CHROME_EXECUTABLE_PATH;
  }
  const home = os.homedir();
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${home}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    `${home}\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe`,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const existingChromePath = isServerless ? null : findExistingChrome();

async function generateTrimmedPdf(origin: string, examId: string, extraParams: Record<string, string>, authToken: string | null) {
  const browser = await puppeteer.launch(
    isServerless
      ? {
          args: chromium.args,
          executablePath: await chromium.executablePath(
            "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar"
          ),
          headless: true,
        }
      : {
          headless: true,
          executablePath: existingChromePath || undefined,
        }
  );

  console.log(`[Puppeteer 브라우저 정보] executablePath=${isServerless ? '(@sparticuz/chromium-min)' : (existingChromePath || '(내장 Chromium 없음)')}, version=${await browser.version()}`);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 2000, deviceScaleFactor: 1 });

    if (authToken) {
      await page.setCookie({ name: "sb-access-token", value: authToken, url: origin });
    }

    const pageErrors: string[] = [];
    page.on("pageerror", (err: any) => pageErrors.push(err.message));
    page.on("console", (msg: any) => {
      if (msg.type() === "error") pageErrors.push(`[console.error] ${msg.text()}`);
      if (msg.text().includes('[EXAM_VIEWER_DEBUG]')) {
        console.log(`[Puppeteer 페이지 콘솔] ${msg.text()}`);
      }
    });

    page.on('requestfailed', (req: any) => {
      console.log(`[Puppeteer 네트워크 요청 실패] url=${req.url()}, reason=${req.failure()?.errorText}`);
    });

    const query = new URLSearchParams({ exam_id: examId, ...extraParams });
    const url = `${origin}/exam/viewer?${query.toString()}`;
    await page.goto(url, { waitUntil: "load", timeout: 30000 });

    let renderReady = false;
    for (let i = 0; i < 100; i++) {
      renderReady = await page.evaluate(() => (window as any).__examRenderReady === true);
      if (renderReady) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    if (renderReady) {
      await new Promise((r) => setTimeout(r, 500));
      let stillReady = await page.evaluate(() => (window as any).__examRenderReady === true);
      if (!stillReady) {
        for (let i = 0; i < 100 && !stillReady; i++) {
          await new Promise((r) => setTimeout(r, 300));
          stillReady = await page.evaluate(() => (window as any).__examRenderReady === true);
        }
        renderReady = stillReady;
      }
    }

    if (!renderReady) {
      let containerText = "";
      try {
        containerText = await page.evaluate(
          () => document.getElementById("exam-container")?.innerText?.trim() || ""
        );
      } catch (e) {}

      const detailParts: string[] = [];
      if (containerText) detailParts.push(`화면에 표시된 내용: "${containerText}"`);
      if (pageErrors.length > 0) detailParts.push(`브라우저 에러 로그:\n- ${pageErrors.join("\n- ")}`);
      const detail =
        detailParts.length > 0
          ? `\n${detailParts.join("\n")}`
          : " (화면에 아무 에러도 안 뜨고 그냥 멈춰있음 - exam_id 확인 필요)";

      throw new Error(`문제지 렌더링이 시간 내에 끝나지 않음${detail}`);
    }

    const intendedPages = await page.evaluate(() => document.querySelectorAll(".a3-page").length);
    if (intendedPages === 0) throw new Error("문제지 렌더링 실패 (.a3-page 없음) - exam_id 확인 필요");

    const colCounts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-col-count]')).map((el) => el.getAttribute('data-col-count'))
    );
    console.log(`[PDF 컬럼 분할 확인] exam_id=${examId}, 각 컬럼당 묶인 문항 수=`, colCounts);

    await page.emulateMediaType("print");
    const pdfBuffer = await page.pdf({ printBackground: true, preferCSSPageSize: true });

    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const actualPages = pdfDoc.getPageCount();
    if (actualPages > intendedPages) {
      for (let i = 0; i < actualPages - intendedPages; i++) {
        pdfDoc.removePage(pdfDoc.getPageCount() - 1);
      }
    }
    return await pdfDoc.save();
  } finally {
    await browser.close();
  }
}

export async function GET(req: NextRequest) {
  const examId = req.nextUrl.searchParams.get("exam_id");
  if (!examId) {
    return NextResponse.json({ error: "exam_id 파라미터가 필요합니다." }, { status: 400 });
  }

  const extraParams: Record<string, string> = {};
  ["column", "split", "numberColor", "titleColor", "lineColor", "titleMode"].forEach((key) => {
    const v = req.nextUrl.searchParams.get(key);
    if (v) extraParams[key] = v;
  });

  const authToken = req.cookies.get("sb-access-token")?.value || null;
  if (!authToken) {
    return NextResponse.json(
      { error: "로그인 세션이 만료되었습니다. 다시 로그인 후 PDF를 생성해주세요." },
      { status: 401 }
    );
  }

  try {
    console.log(`[PDF 생성 시작] exam_id=${examId}`, extraParams);
    const pdfBytes = await generateTrimmedPdf(req.nextUrl.origin, examId, extraParams, authToken);
    console.log(`[PDF 생성 완료] exam_id=${examId}, ${pdfBytes.length} bytes`);

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="exam_${examId}.pdf"`,
      },
    });
  } catch (e: any) {
    console.error(`[PDF 생성 실패] exam_id=${examId}:`, e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}