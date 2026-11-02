// src/app/api/gemini-twin/route.ts
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

async function fetchImageAsInlinePart(url?: string | null) {
  if (!url || typeof url !== "string" || url === "null" || url === "undefined") return null;
  try {
    let targetUrl = url.trim();
    if (!targetUrl.startsWith("http")) {
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfwlmbwornivkrvoeqdh.supabase.co";
      targetUrl = `${baseUrl}/storage/v1/object/public/question_images/${targetUrl.replace(/^\/+/, "")}`;
    }
    const res = await fetch(targetUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const arrayBuffer = await res.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    return {
      inlineData: {
        data: base64Data,
        mimeType: contentType.startsWith("image/") ? contentType : "image/png",
      },
    };
  } catch (e) {
    console.warn("원본 이미지 로드 실패 (텍스트만으로 진행):", e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    // 🔒 1. 보안 자물쇠: 토큰 검증
    let token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) token = req.cookies.get("sb-access-token")?.value;
    if (!token) {
      const allCookies = req.cookies.getAll();
      const authCookie = allCookies.find((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));
      if (authCookie) {
        try {
          token = JSON.parse(authCookie.value)[0];
        } catch (e) {}
      }
    }

    if (!token) {
      return NextResponse.json({ success: false, error: "Unauthorized: 접근 권한이 없습니다." }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized: 유효하지 않은 세션입니다." }, { status: 401 });
    }

    // ----------------------------------------------------
    // 2. 본문 로직 (멀티모달 원본 이미지 분석 + 코드 기반 SVG 도형/그래프 생성)
    // ----------------------------------------------------
    const body = await req.json();
    const {
      originalQuestion,
      originalQuestion2,
      originalAnswer,
      taxonomyStr,
      step1Concept,
      step2Approach,
      step3Process,
      step4Conclusion,
      imageUrl,
      image2Url,
      answerImageUrl,
      modelName,
    } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: "서버에 API 키가 설정되지 않았습니다." });
    }

    const primaryImgUrl = imageUrl || image2Url || "";
    const [problemImgPart, answerImgPart] = await Promise.all([
      fetchImageAsInlinePart(primaryImgUrl),
      fetchImageAsInlinePart(answerImageUrl),
    ]);
    const hasProblemImage = Boolean(problemImgPart);
    const hasAnswerImage = Boolean(answerImgPart);

    const requestedModel =
      modelName === "gemini-4-argon" ? "gemini-4-argon" : "gemini-3.8-flash";

    const genAI = new GoogleGenerativeAI(apiKey);

    const buildModel = (mName: string) =>
      genAI.getGenerativeModel({
        model: mName,
        generationConfig: {
          temperature: 0.55,
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                question_type: { type: SchemaType.STRING, description: "'쌍둥이' 또는 '유사'" },
                question: { type: SchemaType.STRING, description: "생성된 문제 상단 텍스트 (LaTeX 수식 포함)" },
                question_2: {
                  type: SchemaType.STRING,
                  description: "이미지 하단에 이어지는 추가 발문 텍스트 (원본에 question_2가 있을 때만 작성, 없으면 빈 문자열)",
                },
                answer: { type: SchemaType.STRING, description: "생성된 문제의 정확한 정답" },
                step_1_concept: { type: SchemaType.STRING, description: "핵심 개념 1~2줄 요약 (해당 학년 교육과정 수준 준수)" },
                step_2_approach: { type: SchemaType.STRING, description: "풀이 전략 2~3줄 요약" },
                step_3_process: { type: SchemaType.STRING, description: "구체적인 단계별 풀이 과정" },
                step_4_conclusion: { type: SchemaType.STRING, description: "최종 정답 도출 1줄 결론" },
                svg_code: {
                  type: SchemaType.STRING,
                  description:
                    "원본에 문제 이미지가 있을 때, 변형된 문제의 수치·도형·그래프 조건과 100% 일치하도록 원본 교재 디자인 스타일로 새로 렌더링한 완전한 <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"...\">...</svg> 벡터 코드 (원본 이미지가 없으면 빈 문자열)",
                },
                answer_svg_code: {
                  type: SchemaType.STRING,
                  description:
                    "원본에 정답/해설 이미지(answer_image_url)가 있을 때, 변형된 문제의 정답(예: 도형 분할선 등)을 표시한 완전한 <svg> 벡터 코드 (없으면 빈 문자열)",
                },
              },
              required: [
                "question_type",
                "question",
                "question_2",
                "answer",
                "step_1_concept",
                "step_2_approach",
                "step_3_process",
                "step_4_conclusion",
                "svg_code",
                "answer_svg_code",
              ],
            },
          },
        },
      });

    const imageInstructions = hasProblemImage
      ? `
      [🎨 원본 이미지 분석 및 코드 기반 고품질 SVG 복제 지침 (필수!)]
      첨부된 원본 문제 이미지를 정밀 분석하여, '쌍둥이'와 '유사' 두 문항 모두 각각의 새로운 조건/수치에 완벽히 부합하는 새로운 <svg> 이미지를 \`svg_code\` 필드에 작성하십시오. (절대 svg_code를 비워두지 마십시오!)
      1. 공통 SVG 규칙:
         - 반드시 \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 360" width="100%" height="100%">\` 형태로 시작하고 맨 뒤에 \`</svg>\`로 닫으십시오.
         - 첫 줄에 흰색 배경 \`<rect width="100%" height="100%" fill="#ffffff" />\`를 깔아주십시오.
         - 모든 한글/숫자 텍스트는 \`font-family="Pretendard, 'NanumSquare', 'Malgun Gothic', sans-serif"\` 속성을 지정하여 깨짐 없이 선명하게 렌더링되게 하십시오.
      2. 모눈종이(Grid) 도형 넓이/분할 문제인 경우:
         - 원본처럼 정갈한 사각 점선 모눈(예: 한 칸 크기 50px, 외곽선 \`stroke="#888888" stroke-width="1.5"\`, 내부 점선 \`stroke="#999999" stroke-dasharray="4,4" stroke-width="1"\`)을 그리십시오.
         - 각 도형의 꼭짓점은 반드시 격자점(Grid intersection) 위에 정확히 위치시켜 \`<polygon points="..." fill="..." fill-opacity="0.78" stroke="#333333" stroke-width="1.8" stroke-linejoin="round" />\`로 그리십시오.
         - 파스텔톤 색상(\`#dcf0f7\` 하늘색, \`#e2f0d5\` 연두색, \`#e5dff0\` 연보라색, \`#faecc0\` 연노란색)을 원본처럼 도형별로 적용하십시오.
         - 원본 이미지 하단에 빈칸 네모 박스(□)가 있다면 각 도형 중앙 하단에 둥근 사각형(\`<rect width="36" height="36" rx="6" ry="6" fill="#ffffff" stroke="#999999" stroke-width="1.5" />\`)을 배치하십시오.
         - ⚠️ [수학적 무결성 절대 검증]: 도형의 격자 꼭짓점 좌표로 계산한 실제 넓이(신발끈 공식 또는 온전한 칸 + 반 칸의 합)와 \`answer\`, \`step_3_process\`, \`step_4_conclusion\`의 수치가 단 1의 오차도 없이 100% 일치해야 합니다!
      3. 꺾은선그래프 / 막대그래프 / 표 문제인 경우:
         - 한국 초등 수학 교과서 특유의 표 결합형 축 헤더(배경 \`#d2eef0\`, 테두리 및 눈금선 \`#009eb0\`, 대각선 분할 라벨, 물결선 생략 기호, 자주색 꺾은선 \`#a6004b\` 및 데이터 점 \`<circle>\`)를 원본과 동일한 디자인으로 그리십시오.
         - 변형된 문제의 질문(\`question\`, \`question_2\`)과 정답(\`answer\`)이 그래프에 찍힌 점의 눈금 위치와 정확히 일치하는지 검증하십시오.
      ${
        hasAnswerImage
          ? `4. 정답/해설 이미지(\`answer_svg_code\`) 생성:
         - 원본에 정답 이미지가 포함되어 있으므로, \`svg_code\`의 문제 도형 위에 정답 보조선/분할선(예: 굵은 빨간색 실선 \`stroke="#e11d48" stroke-width="3.5"\`)을 추가한 완전한 \`<svg>\` 코드를 \`answer_svg_code\`에 함께 작성하십시오.`
          : `- 원본에 별도 정답 이미지가 없으므로 \`answer_svg_code\`는 빈 문자열("")로 두십시오.`
      }
      `
      : `- 이 문항은 원본 이미지가 없으므로 \`svg_code\`와 \`answer_svg_code\`는 빈 문자열("")로 두십시오.`;

    const promptText = `
      당신은 대한민국 최고 수준의 초·중등 사고력 수학 교재 출제 및 그래픽 조판 AI입니다.
      아래 원본 문항(및 첨부된 이미지)을 분석하여, 학생이 완벽하게 복습할 수 있도록 변형 문제 딱 2개(1번: "쌍둥이", 2번: "유사")를 생성하십시오.

      [원본 문항 정보]
      - 문항 분류(Taxonomy): ${taxonomyStr || "미분류"}
      - 원본 문제 상단 텍스트(question): ${originalQuestion || ""}
      - 원본 문제 하단 추가 발문(question_2): ${originalQuestion2 || "(없음)"}
      - 원본 정답(answer): ${originalAnswer || "제공되지 않음"}
      - 원본 해설 참고:
        * 개념: ${step1Concept || ""}
        * 접근: ${step2Approach || ""}
        * 과정: ${step3Process || ""}
        * 결론: ${step4Conclusion || ""}

      [🚨 변형 문항 출제 규칙 (정확히 2개 생성)]
      1. 첫 번째 문항 (question_type: "쌍둥이"):
         - 원본 문항의 구조, 발문 형태, 도형/그래프 구성을 그대로 유지하되, 도형의 모양(좌표)·수치·주제를 새롭게 변형하십시오.
         - 이미지가 있는 문항이라면 원본처럼 "아래 도형/그래프를 보고..." 식의 발문을 유지하고, 변형된 새 도형/그래프를 \`svg_code\`로 그리십시오. (절대 이미지 문제를 텍스트만의 문장제로 바꾸지 마십시오!)
      2. 두 번째 문항 (question_type: "유사"):
         - 핵심 수학 개념은 동일하되, 조건을 한 단계 응용(예: 모눈 한 칸의 넓이를 다르게 주거나, 모양과 넓이 조건을 변형)하되, 원본에 이미지가 있다면 유사 문항 역시 그에 맞는 새 도형/그래프 이미지를 \`svg_code\`로 함께 생성하십시오.

      [🚨 학년 수준에 맞는 해설 교정 및 수식 규칙]
      1. 분류 코드(Taxonomy)나 문제 수준이 초등 저·중학년(예: 초3 E3...)인 경우, 고학년 공식(밑변×높이÷2 등)을 쓰지 말고 '온전한 모눈 칸의 개수와 나누어진 조각(반 칸 등)을 합쳐서 세는 방법'으로 해당 학년 눈높이에 맞게 해설을 정확히 작성하십시오.
      2. 수식 포맷: 달러 기호($)를 사용한 LaTeX 형식을 유지하십시오. (예: $\\square$, $\\frac{1}{2}$, $18\\text{cm}$)
      3. 원본에 \`question_2\`(이미지 아래에 나오는 질문)가 있었다면 생성되는 문항도 상단 도입부는 \`question\`에, 이미지 아래 질문은 \`question_2\`에 나누어 담으십시오. 원본에 \`question_2\`가 없었다면 \`question_2\`는 ""(빈 문자열)로 두십시오.
      ${imageInstructions}
    `;

    const contents: any[] = [];
    if (problemImgPart) {
      contents.push(problemImgPart);
    }
    if (answerImgPart) {
      contents.push(answerImgPart);
    }
    contents.push({ text: promptText });

    let result;
    let usedModel = requestedModel;
    try {
      const model = buildModel(requestedModel);
      result = await model.generateContent(contents);
    } catch (modelErr: any) {
      if (requestedModel !== "gemini-3.8-flash") {
        console.warn(`${requestedModel} 호출 실패, gemini-3.8-flash로 자동 폴백합니다:`, modelErr?.message);
        usedModel = "gemini-3.8-flash";
        const fallbackModel = buildModel("gemini-3.8-flash");
        result = await fallbackModel.generateContent(contents);
      } else {
        throw modelErr;
      }
    }

    let responseText = result.response.text();
    responseText = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();

    let parsedData;
    try {
      parsedData = JSON.parse(responseText);
    } catch (parseError) {
      const escapedText = responseText.replace(/\\/g, "\\\\");
      parsedData = JSON.parse(escapedText);
    }

    return NextResponse.json({
      success: true,
      modelUsed: usedModel,
      hasImageGenerated: hasProblemImage,
      data: parsedData,
    });
  } catch (error: any) {
    console.error("Twin Generator Error:", error);
    return NextResponse.json({ success: false, error: `AI 생성 실패: ${error.message}` });
  }
}


// 🔒 마스터키(SERVICE_ROLE_KEY)를 사용하여 RLS 정책에 막히지 않고 question_images 스토리지 업로드 및 question_db 저장을 처리합니다.
export async function PUT(req: NextRequest) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfwlmbwornivkrvoeqdh.supabase.co";
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json();
    const { action } = body;

    if (action === "upload_image") {
      const { imageBase64, fileName, contentType = "image/png" } = body;
      if (!imageBase64 || !fileName) {
        return NextResponse.json({
          success: false,
          error: "이미지 데이터 또는 파일명이 누락되었습니다.",
        });
      }

      const base64Clean = String(imageBase64).replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64Clean, "base64");

      let { error: uploadErr } = await supabaseAdmin.storage
        .from("question_images")
        .upload(fileName, buffer, {
          contentType,
          upsert: false,
        });

      if (uploadErr && /already exists|Duplicate/i.test(uploadErr.message || "")) {
        const retry = await supabaseAdmin.storage
          .from("question_images")
          .upload(fileName, buffer, {
            contentType,
            upsert: true,
          });
        uploadErr = retry.error;
      }

      if (uploadErr) {
        return NextResponse.json({ success: false, error: uploadErr.message });
      }

      const publicUrl = `${supabaseUrl}/storage/v1/object/public/question_images/${fileName}`;
      return NextResponse.json({ success: true, publicUrl });
    }

    if (action === "save_twins") {
      const { twinInserts } = body;
      if (!Array.isArray(twinInserts) || twinInserts.length === 0) {
        return NextResponse.json({ success: false, error: "저장할 문항 데이터가 없습니다." });
      }

      const { error: insertErr } = await supabaseAdmin
        .from("question_db")
        .insert(twinInserts);

      if (insertErr) {
        return NextResponse.json({ success: false, error: insertErr.message });
      }

      const uniqueBooks = Array.from(
        new Set(twinInserts.map((q: any) => q.source_book_name).filter(Boolean))
      );

      for (const book of uniqueBooks) {
        const { data: tb } = await supabaseAdmin
          .from("textbook")
          .select("book_id")
          .eq("title", book)
          .maybeSingle();

        if (tb && tb.book_id) {
          const tqInserts = twinInserts
            .filter((q: any) => q.source_book_name === book)
            .map((q: any) => ({
              book_id: tb.book_id,
              question_id: q.question_id,
              page_number: q.final_printed_page || 999,
              question_number: q.question_number,
              question: q.question,
              answer: q.answer,
              taxonomy_id: q.taxonomy_id,
              taxonomy_name: q.taxonomy_name || null,
              sub_taxonomy_id: q.sub_taxonomy_id || null,
              sub_taxonomy_name: q.sub_taxonomy_name || null,
              thk_taxonomy_id: q.thk_taxonomy_id || null,
              thk_taxonomy_name: q.thk_taxonomy_name || null,
              question_category: "일반",
            }));

          if (tqInserts.length > 0) {
            await supabaseAdmin.from("textbook_question").insert(tqInserts);
          }
        }
      }

      return NextResponse.json({ success: true });
    }

    if (action === "update_question") {
      const { questionId, updateData, textbookUpdateData } = body;
      if (!questionId) {
        return NextResponse.json({ success: false, error: "문항 ID가 없습니다." });
      }

      const { error: dbErr } = await supabaseAdmin
        .from("question_db")
        .update(updateData)
        .eq("question_id", questionId);

      if (dbErr) {
        return NextResponse.json({ success: false, error: dbErr.message });
      }

      if (textbookUpdateData && Object.keys(textbookUpdateData).length > 0) {
        await supabaseAdmin
          .from("textbook_question")
          .update(textbookUpdateData)
          .eq("question_id", questionId);
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "알 수 없는 요청입니다." }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "서버 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
