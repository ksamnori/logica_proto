"use client";

import { useEffect } from "react";
import { MATHJAX_FONT_INIT_SCRIPT } from "../lib/mathJaxFontConfig";

export default function MathJaxFontBridge() {
  useEffect(() => {
    const w = window as any;
    try {
      new Function(MATHJAX_FONT_INIT_SCRIPT)();
    } catch (e) {
      console.warn("[MathJaxFontBridge] init failed:", e);
    }
    w.__applyLogicaMathJaxFont?.(true);
  }, []);

  return null;
}
