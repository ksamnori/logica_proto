
// src/app/api/stt-diarization/route.ts
import { NextResponse } from 'next/server';
import speech from '@google-cloud/speech';

const client = new speech.SpeechClient({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }
});

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as Blob;
    
    if (!audioFile) {
      return NextResponse.json({ success: false, error: "오디오 파일이 없습니다." }, { status: 400 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBytes = Buffer.from(arrayBuffer).toString('base64');

    const requestObj = {
      audio: { content: audioBytes },
      config: {
        encoding: 'WEBM_OPUS' as const,
        sampleRateHertz: 48000, 
        languageCode: 'ko-KR',
        enableWordTimeOffsets: true, 
        // 🚨 [변경됨] 최신 모델을 버리고 콜센터(전화망) 모델로 강제 변경!
        model: 'telephony', 
        diarizationConfig: {
          enableSpeakerDiarization: true,
          minSpeakerCount: 2, 
          maxSpeakerCount: 6, 
        }
      }
    };

    const [response] = await client.recognize(requestObj);
    
    // 🕵️‍♂️ [디버깅 엑스레이] 터미널에서 speakerTag가 어떻게 찍히는지 확인용
    console.log("\n====== 🚨 [구글 STT Telephony 모델 응답 데이터] 🚨 ======");
    console.log(JSON.stringify(response.results, null, 2));
    console.log("================================================\n");

    let allWords: any[] = [];
    
    const lastResult = response.results?.[response.results.length - 1];
    
    if (lastResult?.alternatives?.[0]?.words) {
        allWords = lastResult.alternatives[0].words;
    }

    const diarizationResult: { speaker: string; text: string }[] = [];
    
    if (allWords.length > 0) {
      let currentSpeaker = allWords[0].speakerTag || 1; 
      let currentSentence = "";

      allWords.forEach((wordInfo) => {
        const speakerTag = wordInfo.speakerTag || currentSpeaker; 
        
        if (speakerTag !== currentSpeaker) {
          if (currentSentence) {
            diarizationResult.push({ 
              speaker: `참석자 ${currentSpeaker}`, 
              text: currentSentence.trim() 
            });
          }
          currentSpeaker = speakerTag;
          currentSentence = wordInfo.word as string;
        } else {
          currentSentence += ` ${wordInfo.word}`;
        }
      });
      
      if (currentSentence) {
        diarizationResult.push({ 
          speaker: `참석자 ${currentSpeaker}`, 
          text: currentSentence.trim() 
        });
      }
    } else {
      const fullText = response.results?.map(r => r.alternatives?.[0]?.transcript).join('\n') || "";
      if (fullText) {
        diarizationResult.push({ speaker: "참석자 1", text: fullText.trim() });
      }
    }

    return NextResponse.json({ success: true, transcript: diarizationResult });

  } catch (error: any) {
    console.error("STT Diarization Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}