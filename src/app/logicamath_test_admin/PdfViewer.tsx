"use client";

import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Document/Page와 같은 모듈 안에서 설정해야 확실히 적용됩니다.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Props {
  file: string;
  pageNumber: number;
  width?: number;
  onLoadSuccess: (pdf: { numPages: number }) => void;
}

export default function PdfViewer({ file, pageNumber, width = 800, onLoadSuccess }: Props) {
  return (
    <Document
      file={file}
      onLoadSuccess={onLoadSuccess}
      onLoadError={(err) => console.error("PDF 로드 실패:", err)}
      loading={
        <div className="flex items-center justify-center w-[800px] h-[1130px] bg-slate-50 font-bold text-slate-400">
          PDF를 불러오는 중입니다...
        </div>
      }
    >
      <Page pageNumber={pageNumber} width={width} renderTextLayer={false} renderAnnotationLayer={false} />
    </Document>
  );
}