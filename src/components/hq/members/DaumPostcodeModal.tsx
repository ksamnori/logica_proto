// src/components/hq/members/DaumPostcodeModal.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: {
        oncomplete: (data: {
          zonecode: string;
          roadAddress: string;
          jibunAddress: string;
          userSelectedType: "R" | "J";
          bname: string;
          buildingName: string;
          apartment: "Y" | "N";
        }) => void;
        width?: string | number;
        height?: string | number;
      }) => {
        embed: (element: HTMLElement) => void;
      };
    };
  }
}

const DAUM_POSTCODE_SCRIPT_URL =
  "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

function loadDaumPostcodeScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (window.daum?.Postcode) return resolve();

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${DAUM_POSTCODE_SCRIPT_URL}"]`
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("주소 검색 스크립트를 불러오지 못했습니다.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = DAUM_POSTCODE_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("주소 검색 스크립트를 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
}

interface DaumPostcodeModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (result: { postalCode: string; baseAddress: string }) => void;
}

export default function DaumPostcodeModal({
  open,
  onClose,
  onSelect,
}: DaumPostcodeModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setErrorMsg("");

    loadDaumPostcodeScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.daum?.Postcode) return;
        containerRef.current.innerHTML = "";
        const postcode = new window.daum.Postcode({
          width: "100%",
          height: "100%",
          oncomplete: (data) => {
            let addr =
              data.userSelectedType === "R"
                ? data.roadAddress
                : data.jibunAddress;
            if (!addr) {
              addr = data.roadAddress || data.jibunAddress || "";
            }
            if (data.userSelectedType === "R") {
              const extras: string[] = [];
              if (data.bname && /[동|로|가]$/g.test(data.bname)) {
                extras.push(data.bname);
              }
              if (data.buildingName && data.apartment === "Y") {
                extras.push(data.buildingName);
              }
              if (extras.length > 0) {
                addr += ` (${extras.join(", ")})`;
              }
            }
            onSelect({
              postalCode: data.zonecode || "",
              baseAddress: addr.trim(),
            });
            onClose();
          },
        });
        postcode.embed(containerRef.current);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setErrorMsg(
            err?.message || "우편번호 검색 서비스를 불러오지 못했습니다."
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, onClose, onSelect]);

  if (!open) return null;

  return (
    <div
      onMouseDown={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 bg-slate-900/60 z-[90] flex items-center justify-center p-4"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-[480px] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
      >
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <h4 className="text-sm font-extrabold">🔍 우편번호 · 도로명 주소 검색</h4>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-300 hover:text-white text-lg font-bold leading-none"
          >
            ✕
          </button>
        </div>

        {errorMsg ? (
          <div className="p-8 text-center text-xs text-rose-600 font-semibold">
            {errorMsg}
          </div>
        ) : (
          <div ref={containerRef} className="w-full h-[440px] bg-white" />
        )}
      </div>
    </div>
  );
}
