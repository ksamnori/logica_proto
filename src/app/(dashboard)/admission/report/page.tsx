// src/app/(dashboard)/admission/report/page.tsx
"use client";

import React, { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

// 🌟 [내장 헬퍼] 진단평가 2610 기준표 로더 및 배점 정규화 유틸리티 (외부 파일 의존성 제거)
const FALLBACK_META_2610_INLINE: any[] = [{"standard_name": "2-2", "question_number": 1, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "2-2", "question_number": 2, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "2-2", "question_number": 3, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "2-2", "question_number": 4, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "2-2", "question_number": 5, "math_category": "측정", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "2-2", "question_number": 6, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "2-2", "question_number": 7, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "2-2", "question_number": 8, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "2-2", "question_number": 9, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "2-2", "question_number": 10, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "2-2", "question_number": 11, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "2-2", "question_number": 12, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "2-2", "question_number": 13, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "2-2", "question_number": 14, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "2-2", "question_number": 15, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "2-2", "question_number": 16, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "2-2", "question_number": 17, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "2-2", "question_number": 18, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "2-2", "question_number": 19, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "2-2", "question_number": 20, "math_category": "측정", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "2-2", "question_number": 21, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "2-2", "question_number": 22, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "2-2", "question_number": 23, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "2-2", "question_number": 24, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "2-2", "question_number": 25, "math_category": "측정", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "2-2", "question_number": 26, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "2-2", "question_number": 27, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "2-2", "question_number": 28, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "2-2", "question_number": 29, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "2-2", "question_number": 30, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "3-1", "question_number": 1, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-1", "question_number": 2, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-1", "question_number": 3, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-1", "question_number": 4, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-1", "question_number": 5, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-1", "question_number": 6, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-1", "question_number": 7, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-1", "question_number": 8, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-1", "question_number": 9, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-1", "question_number": 10, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "3-1", "question_number": 11, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "3-1", "question_number": 12, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "3-1", "question_number": 13, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "3-1", "question_number": 14, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-1", "question_number": 15, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-1", "question_number": 16, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-1", "question_number": 17, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-1", "question_number": 18, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-1", "question_number": 19, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-1", "question_number": 20, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-1", "question_number": 21, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "3-1", "question_number": 22, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-1", "question_number": 23, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-1", "question_number": 24, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-1", "question_number": 25, "math_category": "측정", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "3-1", "question_number": 26, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-1", "question_number": 27, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-1", "question_number": 28, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-1", "question_number": 29, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "3-1", "question_number": 30, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "3-2", "question_number": 1, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-2", "question_number": 2, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-2", "question_number": 3, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-2", "question_number": 4, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-2", "question_number": 5, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-2", "question_number": 6, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-2", "question_number": 7, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-2", "question_number": 8, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-2", "question_number": 9, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-2", "question_number": 10, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "3-2", "question_number": 11, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "3-2", "question_number": 12, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "3-2", "question_number": 13, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "3-2", "question_number": 14, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-2", "question_number": 15, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-2", "question_number": 16, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-2", "question_number": 17, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-2", "question_number": 18, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-2", "question_number": 19, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-2", "question_number": 20, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-2", "question_number": 21, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "3-2", "question_number": 22, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-2", "question_number": 23, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "3-2", "question_number": 24, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "3-2", "question_number": 25, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "3-2", "question_number": 26, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-2", "question_number": 27, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-2", "question_number": 28, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "3-2", "question_number": 29, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "3-2", "question_number": 30, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "4-1", "question_number": 1, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-1", "question_number": 2, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-1", "question_number": 3, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-1", "question_number": 4, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-1", "question_number": 5, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-1", "question_number": 6, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-1", "question_number": 7, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-1", "question_number": 8, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-1", "question_number": 9, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-1", "question_number": 10, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "4-1", "question_number": 11, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "4-1", "question_number": 12, "math_category": "측정", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "4-1", "question_number": 13, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "4-1", "question_number": 14, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-1", "question_number": 15, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-1", "question_number": 16, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-1", "question_number": 17, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-1", "question_number": 18, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-1", "question_number": 19, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-1", "question_number": 20, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-1", "question_number": 21, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "4-1", "question_number": 22, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-1", "question_number": 23, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-1", "question_number": 24, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-1", "question_number": 25, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "4-1", "question_number": 26, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-1", "question_number": 27, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-1", "question_number": 28, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-1", "question_number": 29, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "4-1", "question_number": 30, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "4-2", "question_number": 1, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-2", "question_number": 2, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-2", "question_number": 3, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-2", "question_number": 4, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-2", "question_number": 5, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-2", "question_number": 6, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-2", "question_number": 7, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-2", "question_number": 8, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-2", "question_number": 9, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-2", "question_number": 10, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "4-2", "question_number": 11, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "4-2", "question_number": 12, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "4-2", "question_number": 13, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "4-2", "question_number": 14, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-2", "question_number": 15, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-2", "question_number": 16, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-2", "question_number": 17, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-2", "question_number": 18, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-2", "question_number": 19, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-2", "question_number": 20, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-2", "question_number": 21, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "4-2", "question_number": 22, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-2", "question_number": 23, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "4-2", "question_number": 24, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "4-2", "question_number": 25, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "4-2", "question_number": 26, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-2", "question_number": 27, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-2", "question_number": 28, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "4-2", "question_number": 29, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "4-2", "question_number": 30, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "5-1", "question_number": 1, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-1", "question_number": 2, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-1", "question_number": 3, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-1", "question_number": 4, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-1", "question_number": 5, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-1", "question_number": 6, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-1", "question_number": 7, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-1", "question_number": 8, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-1", "question_number": 9, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-1", "question_number": 10, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "5-1", "question_number": 11, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "5-1", "question_number": 12, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "5-1", "question_number": 13, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "5-1", "question_number": 14, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-1", "question_number": 15, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-1", "question_number": 16, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-1", "question_number": 17, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-1", "question_number": 18, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-1", "question_number": 19, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-1", "question_number": 20, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-1", "question_number": 21, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "5-1", "question_number": 22, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-1", "question_number": 23, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-1", "question_number": 24, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-1", "question_number": 25, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "5-1", "question_number": 26, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-1", "question_number": 27, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-1", "question_number": 28, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-1", "question_number": 29, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "5-1", "question_number": 30, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "5-2", "question_number": 1, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-2", "question_number": 2, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-2", "question_number": 3, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-2", "question_number": 4, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-2", "question_number": 5, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-2", "question_number": 6, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-2", "question_number": 7, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-2", "question_number": 8, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-2", "question_number": 9, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-2", "question_number": 10, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "5-2", "question_number": 11, "math_category": "측정", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "5-2", "question_number": 12, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "5-2", "question_number": 13, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "5-2", "question_number": 14, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-2", "question_number": 15, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-2", "question_number": 16, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-2", "question_number": 17, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-2", "question_number": 18, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-2", "question_number": 19, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-2", "question_number": 20, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-2", "question_number": 21, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "5-2", "question_number": 22, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-2", "question_number": 23, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "5-2", "question_number": 24, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "5-2", "question_number": 25, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "5-2", "question_number": 26, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-2", "question_number": 27, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-2", "question_number": 28, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "5-2", "question_number": 29, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "5-2", "question_number": 30, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "6-1", "question_number": 1, "math_category": "측정", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-1", "question_number": 2, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-1", "question_number": 3, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-1", "question_number": 4, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-1", "question_number": 5, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-1", "question_number": 6, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-1", "question_number": 7, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-1", "question_number": 8, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-1", "question_number": 9, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-1", "question_number": 10, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "6-1", "question_number": 11, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "6-1", "question_number": 12, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "6-1", "question_number": 13, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "6-1", "question_number": 14, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-1", "question_number": 15, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-1", "question_number": 16, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-1", "question_number": 17, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-1", "question_number": 18, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-1", "question_number": 19, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-1", "question_number": 20, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-1", "question_number": 21, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "6-1", "question_number": 22, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-1", "question_number": 23, "math_category": "확률과 통계", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-1", "question_number": 24, "math_category": "수와 연산", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-1", "question_number": 25, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "6-1", "question_number": 26, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-1", "question_number": 27, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-1", "question_number": 28, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-1", "question_number": 29, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "6-1", "question_number": 30, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "6-2", "question_number": 1, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-2", "question_number": 2, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-2", "question_number": 3, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-2", "question_number": 4, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-2", "question_number": 5, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-2", "question_number": 6, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-2", "question_number": 7, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-2", "question_number": 8, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-2", "question_number": 9, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-2", "question_number": 10, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "6-2", "question_number": 11, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "6-2", "question_number": 12, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "6-2", "question_number": 13, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "6-2", "question_number": 14, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-2", "question_number": 15, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-2", "question_number": 16, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-2", "question_number": 17, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-2", "question_number": 18, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-2", "question_number": 19, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-2", "question_number": 20, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-2", "question_number": 21, "math_category": "측정", "is_calc_sense": false, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "6-2", "question_number": 22, "math_category": "측정", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-2", "question_number": 23, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "6-2", "question_number": 24, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "6-2", "question_number": 25, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "6-2", "question_number": 26, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-2", "question_number": 27, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-2", "question_number": 28, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "6-2", "question_number": 29, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "6-2", "question_number": 30, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "7-1", "question_number": 1, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "7-1", "question_number": 2, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "7-1", "question_number": 3, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "7-1", "question_number": 4, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "7-1", "question_number": 5, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "7-1", "question_number": 6, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "7-1", "question_number": 7, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "7-1", "question_number": 8, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "7-1", "question_number": 9, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "7-1", "question_number": 10, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "7-1", "question_number": 11, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "7-1", "question_number": 12, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "7-1", "question_number": 13, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "7-1", "question_number": 14, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "7-1", "question_number": 15, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "7-1", "question_number": 16, "math_category": "확률과 통계", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "7-1", "question_number": 17, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "7-1", "question_number": 18, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "7-1", "question_number": 19, "math_category": "규칙과 논리", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "7-1", "question_number": 20, "math_category": "측정", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "7-1", "question_number": 21, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": false, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "7-1", "question_number": 22, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "7-1", "question_number": 23, "math_category": "측정", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 1, "assigned_score": 2.0}, {"standard_name": "7-1", "question_number": 24, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 2, "assigned_score": 3.0}, {"standard_name": "7-1", "question_number": 25, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": false, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": true, "difficulty_level": 3, "assigned_score": 3.0}, {"standard_name": "7-1", "question_number": 26, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": false, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "7-1", "question_number": 27, "math_category": "수와 연산", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "7-1", "question_number": 28, "math_category": "규칙과 논리", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": false, "difficulty_level": 4, "assigned_score": 4.0}, {"standard_name": "7-1", "question_number": 29, "math_category": "도형", "is_calc_sense": false, "is_spatial_perception": true, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}, {"standard_name": "7-1", "question_number": 30, "math_category": "도형", "is_calc_sense": true, "is_spatial_perception": false, "is_logical_reasoning": true, "is_background_knowledge": true, "is_thinking_ability": true, "is_task_persistence": true, "difficulty_level": 5, "assigned_score": 5.0}];

const FALLBACK_BASELINE_2610_INLINE: any[] = [{"baseline_id": 1, "standard_name": "2-2", "max_geometry": 21.0, "max_measure": 12.0, "max_stat": 19.0, "max_rule": 18.0, "max_calc": 30.0, "max_calc_sense": 22.0, "max_spatial": 27.0, "max_logic": 68.0, "max_knowledge": 25.0, "max_thinking": 67.0, "max_persistence": 38.0, "max_diff_1": 12.0, "max_diff_2": 18.0, "max_diff_3": 15.0, "max_diff_4": 40.0, "max_diff_5": 15.0, "max_total_score": 100.0}, {"baseline_id": 2, "standard_name": "3-1", "max_geometry": 21.0, "max_measure": 16.0, "max_stat": 18.0, "max_rule": 29.0, "max_calc": 16.0, "max_calc_sense": 38.0, "max_spatial": 27.0, "max_logic": 60.0, "max_knowledge": 25.0, "max_thinking": 65.0, "max_persistence": 23.0, "max_diff_1": 12.0, "max_diff_2": 18.0, "max_diff_3": 15.0, "max_diff_4": 40.0, "max_diff_5": 15.0, "max_total_score": 100.0}, {"baseline_id": 3, "standard_name": "3-2", "max_geometry": 17.0, "max_measure": 12.0, "max_stat": 13.0, "max_rule": 9.0, "max_calc": 49.0, "max_calc_sense": 70.0, "max_spatial": 24.0, "max_logic": 78.0, "max_knowledge": 44.0, "max_thinking": 67.0, "max_persistence": 63.0, "max_diff_1": 12.0, "max_diff_2": 18.0, "max_diff_3": 15.0, "max_diff_4": 40.0, "max_diff_5": 15.0, "max_total_score": 100.0}, {"baseline_id": 4, "standard_name": "4-1", "max_geometry": 21.0, "max_measure": 16.0, "max_stat": 14.0, "max_rule": 7.0, "max_calc": 42.0, "max_calc_sense": 79.0, "max_spatial": 20.0, "max_logic": 63.0, "max_knowledge": 24.0, "max_thinking": 59.0, "max_persistence": 56.0, "max_diff_1": 12.0, "max_diff_2": 18.0, "max_diff_3": 15.0, "max_diff_4": 40.0, "max_diff_5": 15.0, "max_total_score": 100.0}, {"baseline_id": 5, "standard_name": "4-2", "max_geometry": 40.0, "max_measure": 7.0, "max_stat": 6.0, "max_rule": 9.0, "max_calc": 38.0, "max_calc_sense": 73.0, "max_spatial": 44.0, "max_logic": 60.0, "max_knowledge": 30.0, "max_thinking": 79.0, "max_persistence": 48.0, "max_diff_1": 12.0, "max_diff_2": 18.0, "max_diff_3": 15.0, "max_diff_4": 40.0, "max_diff_5": 15.0, "max_total_score": 100.0}, {"baseline_id": 6, "standard_name": "5-1", "max_geometry": 33.0, "max_measure": 7.0, "max_stat": 15.0, "max_rule": 16.0, "max_calc": 29.0, "max_calc_sense": 44.0, "max_spatial": 33.0, "max_logic": 62.0, "max_knowledge": 44.0, "max_thinking": 68.0, "max_persistence": 43.0, "max_diff_1": 12.0, "max_diff_2": 18.0, "max_diff_3": 15.0, "max_diff_4": 40.0, "max_diff_5": 15.0, "max_total_score": 100.0}, {"baseline_id": 7, "standard_name": "5-2", "max_geometry": 15.0, "max_measure": 6.0, "max_stat": 7.0, "max_rule": 13.0, "max_calc": 59.0, "max_calc_sense": 87.0, "max_spatial": 11.0, "max_logic": 83.0, "max_knowledge": 91.0, "max_thinking": 72.0, "max_persistence": 40.0, "max_diff_1": 12.0, "max_diff_2": 18.0, "max_diff_3": 15.0, "max_diff_4": 40.0, "max_diff_5": 15.0, "max_total_score": 100.0}, {"baseline_id": 8, "standard_name": "6-1", "max_geometry": 28.0, "max_measure": 5.0, "max_stat": 12.0, "max_rule": 13.0, "max_calc": 42.0, "max_calc_sense": 55.0, "max_spatial": 37.0, "max_logic": 84.0, "max_knowledge": 98.0, "max_thinking": 41.0, "max_persistence": 35.0, "max_diff_1": 12.0, "max_diff_2": 18.0, "max_diff_3": 15.0, "max_diff_4": 40.0, "max_diff_5": 15.0, "max_total_score": 100.0}, {"baseline_id": 9, "standard_name": "6-2", "max_geometry": 28.0, "max_measure": 11.0, "max_stat": 7.0, "max_rule": 8.0, "max_calc": 46.0, "max_calc_sense": 73.0, "max_spatial": 33.0, "max_logic": 59.0, "max_knowledge": 59.0, "max_thinking": 70.0, "max_persistence": 38.0, "max_diff_1": 12.0, "max_diff_2": 18.0, "max_diff_3": 15.0, "max_diff_4": 40.0, "max_diff_5": 15.0, "max_total_score": 100.0}, {"baseline_id": 10, "standard_name": "7-1", "max_geometry": 29.0, "max_measure": 6.0, "max_stat": 7.0, "max_rule": 12.0, "max_calc": 46.0, "max_calc_sense": 78.0, "max_spatial": 35.0, "max_logic": 53.0, "max_knowledge": 79.0, "max_thinking": 65.0, "max_persistence": 30.0, "max_diff_1": 12.0, "max_diff_2": 18.0, "max_diff_3": 15.0, "max_diff_4": 40.0, "max_diff_5": 15.0, "max_total_score": 100.0}];

function _toBoolStd(v: any): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return ["true", "t", "1", "y", "yes", "o", "○", "◯", "●", "v", "✓", "✔", "해당"].includes(s);
  }
  return false;
}

function _toNumberStd(v: any, fallback = 0): number {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const cleaned = String(v).replace(/[^0-9.-]/g, "");
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function _toIntStd(v: any, fallback = 0): number {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  const match = String(v).match(/\d+/);
  return match ? parseInt(match[0], 10) : fallback;
}

function _normalizeMathCatStd(rawCat: any): string {
  const s = String(rawCat ?? "").trim();
  if (!s) return "수와 연산";
  if (s.includes("도형")) return "도형";
  if (s.includes("측정")) return "측정";
  if (s.includes("확률") || s.includes("통계") || s.includes("자료") || s.includes("가능성") || s.includes("확·통")) return "확률과 통계";
  if (s.includes("규칙") || s.includes("논리") || s.includes("패턴")) return s === "규칙성" ? "규칙성" : "규칙과 논리";
  if (s.includes("수") || s.includes("연산") || s.includes("계산") || s.includes("방정식") || s.includes("문자") || s.includes("함수")) return "수와 연산";
  return s;
}

function _normalizeMetaRowStd(raw: any, indexFallback = 1) {
  const qNum = _toIntStd(raw?.question_number ?? raw?.q_num ?? raw?.question_no ?? raw?.no, indexFallback);
  const assignedScore = _toNumberStd(raw?.assigned_score ?? raw?.score ?? raw?.max_score ?? raw?.point, 0);
  const diffRaw = _toIntStd(raw?.difficulty_level ?? raw?.difficulty ?? raw?.level ?? raw?.lv, 3);
  const difficultyLevel = Math.min(5, Math.max(1, diffRaw || 3));
  const mathCategory = _normalizeMathCatStd(raw?.math_category ?? raw?.category ?? raw?.domain ?? raw?.area);

  const isCalcSense = _toBoolStd(raw?.is_calc_sense ?? raw?.calc_sense ?? raw?.sense);
  const isSpatial = _toBoolStd(raw?.is_spatial_perception ?? raw?.spatial_perception ?? raw?.is_spatial_percep ?? raw?.spatial_percep ?? raw?.spatial ?? raw?.space);
  const isLogic = _toBoolStd(raw?.is_logical_reasoning ?? raw?.logical_reasoning ?? raw?.is_logical_reason ?? raw?.logical_reason ?? raw?.logic);
  const isKnowledge = _toBoolStd(raw?.is_background_knowledge ?? raw?.background_knowledge ?? raw?.is_knowledge ?? raw?.knowledge);
  const isThinking = _toBoolStd(raw?.is_thinking_ability ?? raw?.thinking_ability ?? raw?.is_thinking ?? raw?.thinking);
  const isPersistence = _toBoolStd(raw?.is_task_persistence ?? raw?.task_persistence ?? raw?.is_persistence ?? raw?.persistence);

  return {
    ...raw,
    question_number: qNum,
    assigned_score: assignedScore,
    difficulty_level: difficultyLevel,
    math_category: mathCategory,
    is_calc_sense: isCalcSense,
    is_spatial_perception: isSpatial,
    is_logical_reasoning: isLogic,
    is_background_knowledge: isKnowledge,
    is_thinking_ability: isThinking,
    is_task_persistence: isPersistence,
    calc_sense: isCalcSense,
    spatial_perception: isSpatial,
    logical_reasoning: isLogic,
    background_knowledge: isKnowledge,
    thinking_ability: isThinking,
    task_persistence: isPersistence,
  };
}

function _buildBaselineStd(metaRows: any[], rawBaselineRow?: any) {
  const fromMeta: any = {
    max_geometry: 0, max_measure: 0, max_stat: 0, max_rule: 0, max_calc: 0,
    max_calc_sense: 0, max_spatial: 0, max_logic: 0,
    max_knowledge: 0, max_thinking: 0, max_persistence: 0,
    max_diff_1: 0, max_diff_2: 0, max_diff_3: 0, max_diff_4: 0, max_diff_5: 0,
    max_total_score: 0,
  };

  metaRows.forEach((m) => {
    const s = _toNumberStd(m.assigned_score, 0);
    fromMeta.max_total_score += s;
    if (m.math_category === "도형") fromMeta.max_geometry += s;
    else if (m.math_category === "측정") fromMeta.max_measure += s;
    else if (m.math_category === "확률과 통계") fromMeta.max_stat += s;
    else if (m.math_category === "규칙과 논리" || m.math_category === "규칙성") fromMeta.max_rule += s;
    else if (m.math_category === "수와 연산") fromMeta.max_calc += s;

    if (m.is_calc_sense) fromMeta.max_calc_sense += s;
    if (m.is_spatial_perception) fromMeta.max_spatial += s;
    if (m.is_logical_reasoning) fromMeta.max_logic += s;
    if (m.is_background_knowledge) fromMeta.max_knowledge += s;
    if (m.is_thinking_ability) fromMeta.max_thinking += s;
    if (m.is_task_persistence) fromMeta.max_persistence += s;

    const d = m.difficulty_level;
    if (d === 1) fromMeta.max_diff_1 += s;
    else if (d === 2) fromMeta.max_diff_2 += s;
    else if (d === 3) fromMeta.max_diff_3 += s;
    else if (d === 4) fromMeta.max_diff_4 += s;
    else if (d === 5) fromMeta.max_diff_5 += s;
  });

  Object.keys(fromMeta).forEach((k) => {
    fromMeta[k] = Math.round((fromMeta[k] + Number.EPSILON) * 10) / 10;
  });

  if (rawBaselineRow) {
    Object.keys(fromMeta).forEach((k) => {
      const baseVal = _toNumberStd(rawBaselineRow[k], 0);
      if (fromMeta[k] === 0 && baseVal > 0) {
        fromMeta[k] = baseVal;
      }
    });
  }
  return fromMeta;
}

function computeItemEarnedByStandard(
  ans: any,
  subScore: number,
  rawItemAssignedScore?: any,
  gcMap?: Record<string, any>,
  isAdmission = true
): { earned: number; isFullCorrect: boolean } {
  if (!ans) return { earned: 0, isFullCorrect: false };

  const code = String(ans.grading_code ?? "").trim();
  if (code) {
    let ratio = 0;
    const meta = gcMap ? gcMap[code] : null;
    if (meta) {
      if (isAdmission) {
        if (meta.admission_ratio !== undefined && meta.admission_ratio !== null) {
          ratio = Number(meta.admission_ratio) || 0;
          if (ratio > 1) ratio /= 100;
        } else if (["O", "TO", "a", "b", "c"].includes(code)) {
          ratio = 1.0;
        } else if (code === "RO") {
          ratio = 0.8;
        } else if (code === "q") {
          ratio = 0.0;
        } else {
          ratio = Number(meta.score_ratio) || 0;
          if (ratio > 1) ratio /= 100;
        }
      } else {
        ratio = Number(meta.score_ratio) || 0;
        if (ratio > 1) ratio /= 100;
      }
    } else {
      if (["O", "a", "b", "c"].includes(code)) ratio = 1.0;
      else if (code === "TO") ratio = isAdmission ? 1.0 : 0.8;
      else if (code === "RO") ratio = 0.8;
      else if (code === "q") ratio = isAdmission ? 0.0 : 0.5;
      else ratio = 0.0;
    }

    const earned = Math.round((subScore * ratio + Number.EPSILON) * 1000) / 1000;
    const isFullCorrect = ratio >= 0.99 || ["O", "TO", "a", "b", "c"].includes(code);
    return { earned, isFullCorrect };
  }

  const isCor = ans.is_correct === true || String(ans.is_correct).toLowerCase() === "true";
  if (isCor) {
    return { earned: subScore, isFullCorrect: true };
  }

  const rawEarned = parseFloat(ans.earned_score) || 0;
  if (rawEarned > 0) {
    const oldBase = parseFloat(rawItemAssignedScore) || 100 / 30;
    if (Math.abs(rawEarned - oldBase) < 0.08 || Math.abs(rawEarned - subScore) < 0.08) {
      return { earned: subScore, isFullCorrect: true };
    }
    const ratio = oldBase > 0 ? Math.min(1, rawEarned / oldBase) : 0;
    const earned = Math.round((subScore * ratio + Number.EPSILON) * 1000) / 1000;
    return { earned, isFullCorrect: ratio >= 0.99 };
  }

  return { earned: 0, isFullCorrect: false };
}

function resolveAdmissionStandardName(subTitle?: string, title?: string, majorGrade?: string): string {
  // 날짜 문자열(예: 2026-11-09)이 학기(6-1 등)로 오인되지 않도록 먼저 제거
  const rawCombined = [subTitle, title, majorGrade].filter(Boolean).join(" ");
  const combined = rawCombined.replace(/20\d{2}\s*[-./]\s*\d{1,2}(?:\s*[-./]\s*\d{1,2})?/g, " ");
  if (!combined.trim()) return "";

  // 1. 구 입학테스트 중등 표기(7-1 ~ 9-2)가 명시된 경우 (예: "입학테스트 중등 7-1", "입학테스트 7-1")
  const sevenToNineMatch = combined.match(/(?:^|[^0-9])([7-9])\s*[-_]\s*([1-2])(?:$|[^0-9])/);
  if (sevenToNineMatch) {
    return `${sevenToNineMatch[1]}-${sevenToNineMatch[2]}`;
  }

  // 2. 현 진단평가 중등 표기("중등 1-1", "중1-1", "중학교 1-1", "M1-1" 등) -> 7-1 ~ 9-2로 통일 (+6)
  const midMatch =
    combined.match(/중(?:등|학교|학)?\s*([1-3])\s*[-_]\s*([1-2])/) ||
    combined.match(/\bM\s*([1-3])\s*[-_]\s*([1-2])/i);
  if (midMatch) {
    return `${parseInt(midMatch[1], 10) + 6}-${midMatch[2]}`;
  }

  // 3. 텍스트 내에 "중등/중학교/중1~3" 키워드가 있으면서 "1-1" ~ "3-2"가 있는 경우 -> 7-1 ~ 9-2로 통일
  if (/중(?:등|학교|학|[1-3])/.test(combined)) {
    const cleanSub = String(subTitle || "").replace(/20\d{2}\s*[-./]\s*\d{1,2}(?:\s*[-./]\s*\d{1,2})?/g, " ");
    const cleanTitle = String(title || "").replace(/20\d{2}\s*[-./]\s*\d{1,2}(?:\s*[-./]\s*\d{1,2})?/g, " ");
    const tag =
      cleanSub.match(/(?:^|[^0-9])([1-3])\s*[-_]\s*([1-2])(?:$|[^0-9])/) ||
      cleanTitle.match(/(?:^|[^0-9])([1-3])\s*[-_]\s*([1-2])(?:$|[^0-9])/) ||
      combined.match(/(?:^|[^0-9])([1-3])\s*[-_]\s*([1-2])(?:$|[^0-9])/);
    if (tag) {
      return `${parseInt(tag[1], 10) + 6}-${tag[2]}`;
    }
  }

  // 4. 일반 학기 태그 추출 (초등 2-2 ~ 6-2, 또는 중등 1-1/1-2)
  const cleanSub = String(subTitle || "").replace(/20\d{2}\s*[-./]\s*\d{1,2}(?:\s*[-./]\s*\d{1,2})?/g, " ");
  const cleanTitle = String(title || "").replace(/20\d{2}\s*[-./]\s*\d{1,2}(?:\s*[-./]\s*\d{1,2})?/g, " ");
  const matchTag =
    cleanSub.match(/(?:^|[^0-9])([1-9])\s*[-_]\s*([1-2])(?:$|[^0-9])/) ||
    cleanTitle.match(/(?:^|[^0-9])([1-9])\s*[-_]\s*([1-2])(?:$|[^0-9])/) ||
    combined.match(/(?:^|[^0-9])([1-9])\s*[-_]\s*([1-2])(?:$|[^0-9])/);
  if (matchTag) {
    const g = parseInt(matchTag[1], 10);
    const s = matchTag[2];
    // 초등 진단평가/입학테스트는 2-2부터 시작하므로 1-1, 1-2는 중등 1-1(7-1), 중등 1-2(7-2)로 매핑
    if (g === 1 && !/초(?:등|학교)?\s*1/.test(combined)) {
      return `7-${s}`;
    }
    return `${g}-${s}`;
  }
  return "";
}

function isAdmissionOrDiagnosticExamMeta(em: any, sessionExamIds?: Set<string>): boolean {
  if (!em) return false;
  if (sessionExamIds && em.exam_id && sessionExamIds.has(String(em.exam_id))) return true;
  const t = String(em.exam_type || "").trim();
  const title = String(em.title || "").trim();
  const sub = String(em.sub_title || "").trim();
  return (
    t.includes("입학") ||
    t.includes("진단") ||
    title.includes("입학") ||
    title.includes("진단") ||
    sub.includes("입학") ||
    sub.includes("진단")
  );
}

function buildExamQuestionGroupsForCohort(
  items: any[],
  qMap: Record<string, any>,
  layoutSettingsRaw?: any
): any[] {
  let layoutSettings = layoutSettingsRaw;
  if (typeof layoutSettings === "string") {
    try {
      layoutSettings = JSON.parse(layoutSettings);
    } catch {}
  }
  const customGroupMap = new Map<string, string>();
  if (Array.isArray(layoutSettings?.userMergedTextQuestions)) {
    layoutSettings.userMergedTextQuestions.forEach((arr: any, idx: number) => {
      if (Array.isArray(arr)) {
        arr.forEach((qid: any) => customGroupMap.set(String(qid), `custom_group_${idx}`));
      }
    });
  }

  const groupMap = new Map<string, any>();
  const groups: any[] = [];
  (items || []).forEach((item: any) => {
    const q = qMap[String(item.question_id)] || {};
    let gId = customGroupMap.get(String(item.question_id)) || "";
    if (!gId) {
      const src = String(q.pdf_source || "UNKNOWN");
      const page = String(q.detected_page_num || q.final_printed_page || "U");
      const baseNum = String(q.question_number || "").match(/\d+/)
        ? String(q.question_number).match(/\d+/)?.[0]
        : item.question_id;
      gId = `${src}_${page}_${baseNum}`;
      const parentId = q.parent_question_id || q.parent_tq_id;
      if (parentId && String(parentId) !== "null" && String(parentId).trim() !== "") {
        gId = `${src}_${page}_${parentId}`;
      }
    }

    if (!groupMap.has(gId)) {
      const newG = { id: gId, sort_order: item.sort_order, items: [] };
      groupMap.set(gId, newG);
      groups.push(newG);
    }
    groupMap.get(gId).items.push({
      sort_order: item.sort_order,
      assigned_score: item.assigned_score,
      question: q,
      question_id: item.question_id,
    });
  });

  groups.forEach((g: any) => {
    g.sort_order = Math.min(...g.items.map((i: any) => Number(i.sort_order) || 0));
  });
  groups.sort((a, b) => a.sort_order - b.sort_order);
  return groups;
}

function buildStandardCandidateList(standardName: string): string[] {
  const raw = String(standardName || "").trim();
  const list: string[] = [];
  const pushUnique = (v: string) => {
    const t = String(v || "").trim();
    if (t && !list.includes(t)) list.push(t);
  };

  const midMatch =
    raw.match(/중(?:등|학교)?\s*([1-3])\s*[-_]\s*([1-2])/) ||
    raw.match(/\bM\s*([1-3])\s*[-_]\s*([1-2])/i);
  if (midMatch) {
    const mapped = `${parseInt(midMatch[1], 10) + 6}-${midMatch[2]}`;
    pushUnique(mapped);
    pushUnique(`${midMatch[1]}-${midMatch[2]}`);
    pushUnique(raw);
  }

  const matchTag = raw.match(/\d+-\d+/);
  const coreTag = matchTag ? matchTag[0] : raw;
  pushUnique(raw);
  pushUnique(coreTag);

  if (coreTag === "1-1") {
    pushUnique("7-1");
    pushUnique("중1-1");
    pushUnique("중등 1-1");
    pushUnique("2-2");
  } else if (coreTag === "7-1") {
    pushUnique("1-1");
    pushUnique("중1-1");
    pushUnique("중등 1-1");
  } else if (coreTag === "1-2" || coreTag === "7-2") {
    pushUnique("7-2");
    pushUnique("1-2");
    pushUnique("중1-2");
    pushUnique("중등 1-2");
    pushUnique("7-1");
  } else if (coreTag === "2-1" || coreTag === "8-1") {
    pushUnique("8-1");
    pushUnique("2-1");
    pushUnique("중2-1");
    pushUnique("중등 2-1");
    pushUnique("7-1");
  } else if (coreTag === "8-2") {
    pushUnique("8-2");
    pushUnique("중2-2");
    pushUnique("7-1");
  } else if (coreTag === "9-1" || coreTag === "9-2") {
    pushUnique(coreTag);
    pushUnique("7-1");
  }

  return list;
}

function pickRowsByStandardCandidates(rows: any[], candidates: string[]): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  for (const cand of candidates) {
    const exact = rows.filter(
      (r: any) => String(r.standard_name ?? r.standard ?? "").trim() === cand
    );
    if (exact.length > 0) return exact;
  }
  for (const cand of candidates) {
    const partial = rows.filter((r: any) =>
      String(r.standard_name ?? r.standard ?? "").includes(cand)
    );
    if (partial.length > 0) return partial;
  }
  return [];
}

function pickSingleByStandardCandidates(rows: any[], candidates: string[]): any {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  for (const cand of candidates) {
    const exact = rows.find(
      (r: any) => String(r.standard_name ?? r.standard ?? "").trim() === cand
    );
    if (exact) return exact;
  }
  for (const cand of candidates) {
    const partial = rows.find((r: any) =>
      String(r.standard_name ?? r.standard ?? "").includes(cand)
    );
    if (partial) return partial;
  }
  return null;
}

function _buildMetaMapAndBaseline(rawRows: any[], rawBaseRow: any) {
  const normalizedMeta = (rawRows || [])
    .map((r: any, idx: number) => _normalizeMetaRowStd(r, idx + 1))
    .sort((a: any, b: any) => a.question_number - b.question_number);

  const defaultScorePerQ = normalizedMeta.length > 0 ? 100 / normalizedMeta.length : 100 / 30;
  normalizedMeta.forEach((m: any) => {
    if (!m.assigned_score || m.assigned_score <= 0) {
      m.assigned_score = defaultScorePerQ;
    }
  });

  const mData: { [qNum: number]: any } = {};
  const metaScores: { [qNum: number]: number } = {};
  normalizedMeta.forEach((m: any, idx: number) => {
    const qn = m.question_number || idx + 1;
    mData[qn] = m;
    metaScores[qn] = m.assigned_score;
  });

  const rBase = _buildBaselineStd(normalizedMeta, rawBaseRow);
  return { normalizedMeta, mData, metaScores, rBase };
}

async function loadAdmissionStandardData(supabaseClient: any, standardName: string) {
  const rawStd = String(standardName || "").trim();
  const candidates = buildStandardCandidateList(rawStd);
  const primaryTag = candidates[0] || "7-1";

  let rawMetaRows: any[] = [];
  let rawBaselineRow: any = null;
  let rawLegacyMetaRows: any[] = [];
  let rawLegacyBaselineRow: any = null;

  // 1. 서버 액션(Service Role Key) 우선 시도 (RLS 우회)
  try {
    const admMod: any = await import("@/app/actions/admission").catch(() => null);
    if (admMod && typeof admMod.fetchAdmissionStandardDataAction === "function") {
      const serverRes = await admMod.fetchAdmissionStandardDataAction(rawStd);
      if (serverRes && serverRes.success) {
        if (Array.isArray(serverRes.metaRows) && serverRes.metaRows.length > 0) {
          rawMetaRows = serverRes.metaRows;
          rawBaselineRow = serverRes.baselineRow || null;
        }
        if (Array.isArray(serverRes.legacyMetaRows) && serverRes.legacyMetaRows.length > 0) {
          rawLegacyMetaRows = serverRes.legacyMetaRows;
          rawLegacyBaselineRow = serverRes.legacyBaselineRow || null;
        }
      }
    }
  } catch (e) {}

  // 2. 클라이언트 쿼리 (admission_standard_meta_2610 & admission_standard_meta)
  if (supabaseClient) {
    if (!rawMetaRows || rawMetaRows.length === 0) {
      try {
        const { data: mAll2610 } = await supabaseClient
          .from("admission_standard_meta_2610")
          .select("*");
        if (Array.isArray(mAll2610) && mAll2610.length > 0) {
          rawMetaRows = pickRowsByStandardCandidates(mAll2610, candidates);
        }
      } catch (e) {}
    }

    if (!rawLegacyMetaRows || rawLegacyMetaRows.length === 0) {
      try {
        const { data: mLegacy } = await supabaseClient
          .from("admission_standard_meta")
          .select("*");
        if (Array.isArray(mLegacy) && mLegacy.length > 0) {
          rawLegacyMetaRows = pickRowsByStandardCandidates(mLegacy, candidates);
        }
      } catch (e) {}
    }

    if (!rawMetaRows || rawMetaRows.length === 0) {
      rawMetaRows = rawLegacyMetaRows;
    }

    if (!rawBaselineRow) {
      try {
        const { data: bAll2610 } = await supabaseClient
          .from("admission_standard_baseline_2610")
          .select("*");
        if (Array.isArray(bAll2610) && bAll2610.length > 0) {
          rawBaselineRow = pickSingleByStandardCandidates(bAll2610, candidates);
        }
      } catch (e) {}
    }

    if (!rawLegacyBaselineRow) {
      try {
        const { data: bLegacy } = await supabaseClient
          .from("admission_standard_baseline")
          .select("*");
        if (Array.isArray(bLegacy) && bLegacy.length > 0) {
          rawLegacyBaselineRow = pickSingleByStandardCandidates(bLegacy, candidates);
        }
      } catch (e) {}
    }
  }

  // 3. 내장 2610 기준표 폴백 (RLS 차단 또는 중1-1 -> 7-1 매핑 보장)
  if (!rawMetaRows || rawMetaRows.length === 0) {
    rawMetaRows = pickRowsByStandardCandidates(FALLBACK_META_2610_INLINE, candidates);
  }
  if (!rawMetaRows || rawMetaRows.length === 0) {
    const fallbackStd = rawStd.includes("1-1") || rawStd.includes("중") ? "7-1" : "4-2";
    rawMetaRows = FALLBACK_META_2610_INLINE.filter((r) => r.standard_name === fallbackStd);
  }
  if (!rawBaselineRow) {
    rawBaselineRow =
      pickSingleByStandardCandidates(FALLBACK_BASELINE_2610_INLINE, candidates) ||
      FALLBACK_BASELINE_2610_INLINE.find(
        (r) => r.standard_name === (rawStd.includes("1-1") || rawStd.includes("중") ? "7-1" : "4-2")
      ) ||
      null;
  }

  const mainBuilt = _buildMetaMapAndBaseline(rawMetaRows, rawBaselineRow);
  const legacyBuilt =
    rawLegacyMetaRows && rawLegacyMetaRows.length > 0
      ? _buildMetaMapAndBaseline(rawLegacyMetaRows, rawLegacyBaselineRow)
      : mainBuilt;

  return {
    meta: mainBuilt.normalizedMeta,
    mData: mainBuilt.mData,
    metaScores: mainBuilt.metaScores,
    baselineRow: rawBaselineRow,
    rBase: mainBuilt.rBase,
    legacyMData: legacyBuilt.mData,
    legacyRBase: legacyBuilt.rBase,
    resolvedStandardName: primaryTag,
  };
}

import Chart from "chart.js/auto";

async function fetchAllRows(buildQuery: (from: number, to: number) => any, pageSize = 1000) {
  let all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function AdmissionReportContent() {
  const searchParams = useSearchParams();
  const assignmentId = searchParams.get("assignment_id");

  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [reportData, setReportData] = useState<any>(null);

  // 차트 렌더링용 Refs
  const catChartRef = useRef<HTMLCanvasElement>(null);
  const diffChartRef = useRef<HTMLCanvasElement>(null);
  const cogLeftChartRef = useRef<HTMLCanvasElement>(null);
  const cogRightChartRef = useRef<HTMLCanvasElement>(null);

  const chartInstances = useRef<{ [key: string]: any }>({});

  const catMap: any = { '수와 연산': '수·연', '도형': '도형', '측정': '측정', '규칙성': '규칙', '확률과 통계': '확·통', '규칙과 논리': '논리' };

  useEffect(() => {
    if (assignmentId && assignmentId !== "null") {
      fetchReportData();
    } else {
      setErrorMsg("❌ assignment_id 값이 URL에 없습니다.");
      setIsLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    if (reportData && !isLoading) {
      renderCharts();
    }
    return () => {
      // 컴포넌트 언마운트 시 차트 파괴 (메모리 누수 방지)
      Object.values(chartInstances.current).forEach(chart => chart?.destroy());
    };
  }, [reportData, isLoading]);

  const fetchReportData = async () => {
    try {
      // 1. 기본 배정 정보 로드
      const { data: assign, error: aErr } = await supabase.from('exam_assignment').select('*, student(name), exam_master(title, sub_title)').eq('assignment_id', assignmentId).single();
      if (aErr) throw new Error(`[기본 배정 정보 로드 실패]\n${aErr.message}`);

      const exMasterTop = Array.isArray(assign.exam_master) ? assign.exam_master[0] : assign.exam_master;
      const rawTitle = exMasterTop?.title || '';
      const rawSub = exMasterTop?.sub_title || '';
      const standardName = resolveAdmissionStandardName(rawSub, rawTitle, exMasterTop?.major_grade) || '7-1';
      
      const examPaperId = assign.exam_id || assign.exam_paper_id;
      if (!examPaperId) throw new Error("시험지 ID를 찾을 수 없습니다.");

      const studentName = Array.isArray(assign.student) ? assign.student[0]?.name : assign.student?.name || '알수없음';
      const reportDate = new Date(assign.created_at).toLocaleDateString('ko-KR');

      // 2. 런타임 Max 스코어 빌더 (admission_standard_meta_2610 / admission_standard_baseline_2610 + 구 입학테스트 호환)
      const { mData, rBase, legacyMData, legacyRBase } = await loadAdmissionStandardData(supabase, standardName);

      // 3. 마스터 채점 코드 비율 로드
      const { data: gcData } = await supabase.from('master_grading_code').select('code, score_ratio, admission_ratio, is_correct');
      let gcMap: any = {};
      if (gcData) gcData.forEach((c: any) => gcMap[c.code] = c);

      // 4. 문항 및 학생 답안 데이터 로드
      const { data: items, error: itemsErr } = await supabase.from('exam_item').select('*').eq('exam_id', examPaperId).order('sort_order');
      if (itemsErr) throw new Error(`[문항 로드 실패]\n${itemsErr.message}`);
      
      const { data: answers } = await supabase.from('student_answer').select('*').eq('exam_assignment_id', assignmentId);
      
      const qIds = (items || []).map((i: any) => i.question_id);
      const uuidIds = qIds.filter((id: any) => typeof id === 'string' && id.includes('-'));
      const numIds = qIds.filter((id: any) => typeof id === 'number' || (typeof id === 'string' && !id.includes('-') && !isNaN(Number(id)))).map(Number);
      
      let fetchedQuestions: any[] = [];
      if (uuidIds.length > 0) {
        const { data: qDbData } = await supabase.from('question_db').select('question_id, parent_question_id, pdf_source, detected_page_num, final_printed_page, question_number').in('question_id', uuidIds);
        if (qDbData) fetchedQuestions.push(...qDbData);
      }
      const foundUuids = fetchedQuestions.map((q: any) => q.question_id);
      const missingUuids = uuidIds.filter((id: any) => !foundUuids.includes(id));
      
      if (missingUuids.length > 0) {
        const { data: tqUuidData } = await supabase.from('textbook_question').select('question_id, parent_tq_id, pdf_source, detected_page_num, final_printed_page, question_number').in('question_id', missingUuids);
        if (tqUuidData) fetchedQuestions.push(...tqUuidData);
      }
      if (numIds.length > 0) {
        const { data: numData } = await supabase.from('textbook_question').select('tq_id, parent_tq_id, pdf_source, detected_page_num, final_printed_page, question_number').in('tq_id', numIds);
        if (numData) fetchedQuestions.push(...numData);
      }
      const qMap: any = {};
      fetchedQuestions.forEach((q: any) => {
        if (q.question_id) qMap[String(q.question_id)] = q;
        if (q.tq_id) qMap[String(q.tq_id)] = q; 
      });

      const groupMap = new Map(); const groups: any[] = [];
      (items || []).forEach((item: any) => {
        const q = qMap[String(item.question_id)] || {};
        const ans = (answers || []).find((a: any) => String(a.question_id) === String(item.question_id));
        const src = String(q.pdf_source || 'UNKNOWN'); 
        const page = String(q.detected_page_num || q.final_printed_page || 'U');
        const baseNum = String(q.question_number || '').match(/\d+/) ? String(q.question_number).match(/\d+/)?.[0] : q.question_id; 
        
        let gId = `${src}_${page}_${baseNum}`;
        const parentId = q.parent_question_id || q.parent_tq_id;
        if (parentId && String(parentId) !== 'null' && String(parentId).trim() !== '') { gId = `${src}_${page}_${parentId}`; }

        if (!groupMap.has(gId)) {
          const newG = { id: gId, sort_order: item.sort_order, items: [] };
          groupMap.set(gId, newG); groups.push(newG);
        }
        groupMap.get(gId).items.push({ sort_order: item.sort_order, assigned_score: item.assigned_score, question: q, answer: ans || {earned_score: 0, grading_code: null}, question_id: item.question_id });
      });

      groups.forEach((g: any) => { g.sort_order = Math.min(...g.items.map((i: any) => i.sort_order)); });
      groups.sort((a, b) => a.sort_order - b.sort_order);

      // 본인 점수 산출
      let stats = { geo:0, mea:0, stat:0, rule:0, calc:0, sense:0, space:0, logic:0, know:0, think:0, persist:0, d1:0, d2:0, d3:0, d4:0, d5:0, total:0, correct_cnt:0 };
      const sData: any = {};

      groups.forEach((g: any, index: number) => {
        const logicalQNum = index + 1;
        const qNumMatch = String(g.items[0]?.question?.question_number || '').match(/\d+/);
        const parsedQNum = qNumMatch ? parseInt(qNumMatch[0], 10) : logicalQNum;
        const m = mData[logicalQNum];
        let maxScore = m ? parseFloat(m.assigned_score) : Math.max(...g.items.map((i: any) => parseFloat(i.assigned_score) || 0));
        if (maxScore === 0) maxScore = 100/30;

        const subScore = maxScore / (g.items.length || 1);
        let groupEarned = 0;

        g.items.forEach((i: any) => {
          let earned = 0;
          if (i.answer && i.answer.grading_code) {
            const code = i.answer.grading_code;
            let metaCode = gcMap[code];
            let ratio = 0;
            if (metaCode) {
              ratio = parseFloat(metaCode.score_ratio) || 0;
              if (ratio > 1) ratio = ratio / 100;
            } else {
              if (['O', 'a', 'b', 'c'].includes(code)) ratio = 1.0;
              else if (code === 'TO') ratio = 0.8;
              else if (code === 'q') ratio = 0.5;
            }
            earned = subScore * ratio;
          }
          groupEarned += earned;
        });
        
        sData[logicalQNum] = { earned_score: groupEarned, max_score: maxScore, meta: m };

        if (m) {
          stats.total += groupEarned;
          if (m.math_category === '도형') stats.geo += groupEarned;
          else if (m.math_category === '측정') stats.mea += groupEarned;
          else if (m.math_category === '확률과 통계') stats.stat += groupEarned;
          else if (m.math_category === '규칙과 논리' || m.math_category === '규칙성') stats.rule += groupEarned;
          else if (m.math_category === '수와 연산') stats.calc += groupEarned;

          if (m.is_calc_sense) stats.sense += groupEarned;
          if (m.is_spatial_perception) stats.space += groupEarned;
          if (m.is_logical_reasoning) stats.logic += groupEarned;
          if (m.is_background_knowledge) stats.know += groupEarned;
          if (m.is_thinking_ability) stats.think += groupEarned;
          if (m.is_task_persistence) stats.persist += groupEarned;

          const d = m.difficulty_level;
          if(d===1) stats.d1 += groupEarned; else if(d===2) stats.d2 += groupEarned; else if(d===3) stats.d3 += groupEarned; else if(d===4) stats.d4 += groupEarned; else if(d===5) stats.d5 += groupEarned;

          if (groupEarned > 0 && groupEarned >= (maxScore - 0.01)) {
            stats.correct_cnt++;
          }
        }
      });

      // 🌟 [핵심 동기화] 현 '진단평가'(예: 중등 1-1, 5-1)와 과거 '입학테스트'(예: 중등 7-1, 5-1)를 동일 과정(standardName)으로 묶어 평균 산출
      let avgStats = { geo: 0, mea: 0, stat: 0, rule: 0, calc: 0, sense: 0, space: 0, logic: 0, know: 0, think: 0, persist: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, total: 0 };
      let validSampleCount = 0;

      // 1) 동일 과정(standardName, 예: '7-1' = 중등 1-1 & 중등 7-1, '5-1' = 진단평가 5-1 & 입학테스트 5-1)에 해당하는 모든 시험지 ID 탐색
      const siblingExamIdSet = new Set<string>([String(examPaperId)]);
      const examMasterById = new Map<string, any>();
      if (exMasterTop) {
        examMasterById.set(String(examPaperId), exMasterTop);
      }

      try {
        const [{ data: allMasterRows }, { data: allSessionRows }] = await Promise.all([
          supabase.from('exam_master').select('exam_id, title, sub_title, major_grade, exam_type, layout_settings'),
          supabase.from('admission_session').select('exam_id, title').not('exam_id', 'is', null),
        ]);

        const sessionExamIds = new Set<string>();
        const sessionTitleByExamId = new Map<string, string>();
        (allSessionRows || []).forEach((s: any) => {
          if (s.exam_id) {
            const eid = String(s.exam_id);
            sessionExamIds.add(eid);
            if (s.title && !sessionTitleByExamId.has(eid)) {
              sessionTitleByExamId.set(eid, String(s.title));
            }
          }
        });

        (allMasterRows || []).forEach((em: any) => {
          if (!em || !em.exam_id) return;
          const eid = String(em.exam_id);
          examMasterById.set(eid, em);
          if (!isAdmissionOrDiagnosticExamMeta(em, sessionExamIds)) return;
          const sessTitle = sessionTitleByExamId.get(eid) || '';
          const resolved = resolveAdmissionStandardName(em.sub_title, `${em.title || ''} ${sessTitle}`, em.major_grade);
          if (resolved && resolved === standardName) {
            siblingExamIdSet.add(eid);
          }
        });
      } catch (e) {
        console.warn('동일 과정 시험지 탐색 중 경미한 오류(단일 시험지로 폴백):', e);
      }

      const siblingExamIds = Array.from(siblingExamIdSet);

      // 2) 매칭된 모든 시험지(진단평가 + 구 입학테스트)의 채점완료 응시 기록 통합 로드
      let rawAllAssignments = await fetchAllRows((from, to) =>
        supabase
          .from('exam_assignment')
          .select('assignment_id, exam_id, total_score, status, student(name)')
          .in('exam_id', siblingExamIds)
          .in('status', ['채점완료', '완료'])
          .range(from, to)
      );

      if (!rawAllAssignments || rawAllAssignments.length === 0) {
        rawAllAssignments = await fetchAllRows((from, to) =>
          supabase
            .from('exam_assignment')
            .select('assignment_id, exam_paper_id, total_score, status, student(name)')
            .in('exam_paper_id', siblingExamIds)
            .in('status', ['채점완료', '완료'])
            .range(from, to)
        );
      }

      // 통계 페이지의 excludeTest = true 기본 조건과 동일하게 테스트 계정 제외
      let validAssignments = (rawAllAssignments || []).filter((a: any) => {
        const st = Array.isArray(a.student) ? a.student[0] : a.student;
        const name = st?.name || '';
        if (!name || name.includes('테스트') || name.toLowerCase().includes('test')) {
          return false;
        }
        return true;
      });

      if (validAssignments.length === 0 && rawAllAssignments && rawAllAssignments.length > 0) {
        validAssignments = rawAllAssignments;
      }

      if (validAssignments.length > 0) {
        validSampleCount = validAssignments.length;
        const assignIds = validAssignments.map((a: any) => a.assignment_id);
        const assignByIdMap = new Map<string, any>();
        validAssignments.forEach((a: any) => assignByIdMap.set(String(a.assignment_id), a));

        const totalScoreSum = validAssignments.reduce((acc: number, cur: any) => acc + (Number(cur.total_score) || 0), 0);
        const analyticsMatchedAvgTotal = parseFloat((totalScoreSum / validSampleCount).toFixed(1));

        // 3) 타 시험지(구 입학테스트 등)의 문항 그룹(1~30번) 구성
        const groupsByExamId = new Map<string, any[]>();
        groupsByExamId.set(String(examPaperId), groups);

        const otherExamIds = Array.from(
          new Set(
            validAssignments
              .map((a: any) => String(a.exam_id || a.exam_paper_id || examPaperId))
              .filter((eid: string) => eid && eid !== String(examPaperId))
          )
        );

        if (otherExamIds.length > 0) {
          try {
            const { data: otherItems } = await supabase
              .from('exam_item')
              .select('*')
              .in('exam_id', otherExamIds)
              .order('sort_order');

            const oQIds = Array.from(new Set((otherItems || []).map((i: any) => i.question_id).filter(Boolean)));
            const oUuidIds = oQIds.filter((id: any) => typeof id === 'string' && id.includes('-'));
            const oNumIds = oQIds
              .filter((id: any) => typeof id === 'number' || (typeof id === 'string' && !id.includes('-') && !isNaN(Number(id))))
              .map(Number);

            const otherFetchedQs: any[] = [];
            if (oUuidIds.length > 0) {
              const { data: oQDb } = await supabase
                .from('question_db')
                .select('question_id, parent_question_id, pdf_source, detected_page_num, final_printed_page, question_number')
                .in('question_id', oUuidIds);
              if (oQDb) otherFetchedQs.push(...oQDb);
            }
            const foundOUuids = new Set(otherFetchedQs.map((q: any) => String(q.question_id)));
            const missingOUuids = oUuidIds.filter((id: any) => !foundOUuids.has(String(id)));
            if (missingOUuids.length > 0) {
              const { data: oTqUuid } = await supabase
                .from('textbook_question')
                .select('question_id, parent_tq_id, pdf_source, detected_page_num, final_printed_page, question_number')
                .in('question_id', missingOUuids);
              if (oTqUuid) otherFetchedQs.push(...oTqUuid);
            }
            if (oNumIds.length > 0) {
              const { data: oTqNum } = await supabase
                .from('textbook_question')
                .select('tq_id, parent_tq_id, pdf_source, detected_page_num, final_printed_page, question_number')
                .in('tq_id', oNumIds);
              if (oTqNum) otherFetchedQs.push(...oTqNum);
            }

            const otherQMap: Record<string, any> = { ...qMap };
            otherFetchedQs.forEach((q: any) => {
              if (q.question_id) otherQMap[String(q.question_id)] = q;
              if (q.tq_id) otherQMap[String(q.tq_id)] = q;
            });

            otherExamIds.forEach((eid: string) => {
              const eItems = (otherItems || []).filter((it: any) => String(it.exam_id) === eid);
              const emMeta = examMasterById.get(eid);
              const builtGroups = buildExamQuestionGroupsForCohort(eItems, otherQMap, emMeta?.layout_settings);
              if (builtGroups.length > 0) {
                groupsByExamId.set(eid, builtGroups);
              }
            });
          } catch (e) {
            console.warn('타 시험지 문항 그룹 로드 중 경미한 오류:', e);
          }
        }

        // 4) 학생 답안 및 리포트 스냅샷(폴백용) 일괄 조회
        let allAnswers: any[] = [];
        let allReportSnaps: any[] = [];
        const chunkSize = 100;
        for (let i = 0; i < assignIds.length; i += chunkSize) {
          const chunk = assignIds.slice(i, i + chunkSize);
          const [ansChunk, repChunkRes] = await Promise.all([
            fetchAllRows((from, to) =>
              supabase
                .from('student_answer')
                .select('exam_assignment_id, question_id, earned_score, grading_code, is_correct')
                .in('exam_assignment_id', chunk)
                .range(from, to)
            ),
            supabase
              .from('admission_test_report')
              .select('assignment_id, total_score, score_geometry, score_measure, score_stat, score_rule, score_calc, score_calc_sense, score_spatial_percep, score_logical_reason, score_knowledge, score_thinking, score_persistence, score_diff_1, score_diff_2, score_diff_3, score_diff_4, score_diff_5')
              .in('assignment_id', chunk),
          ]);
          allAnswers = allAnswers.concat(ansChunk);
          if (repChunkRes?.data) allReportSnaps = allReportSnaps.concat(repChunkRes.data);
        }

        const ansByAssign = new Map<string, Map<string, any>>();
        allAnswers.forEach((ans: any) => {
          const aKey = String(ans.exam_assignment_id);
          const qKey = String(ans.question_id);
          if (!ansByAssign.has(aKey)) ansByAssign.set(aKey, new Map());
          ansByAssign.get(aKey)!.set(qKey, ans);
        });

        const repByAssign = new Map<string, any>();
        allReportSnaps.forEach((rep: any) => {
          if (rep && rep.assignment_id) repByAssign.set(String(rep.assignment_id), rep);
        });

        // 구 입학테스트와 현 진단평가 간 영역/난이도 만점 배점이 다를 경우 현재 리포트 기준(rBase) 스케일로 정규화
        const scaleToCurrentBase = (val: number, srcMax: number, dstMax: number) => {
          if (!val || val <= 0) return 0;
          if (srcMax > 0 && dstMax > 0 && Math.abs(srcMax - dstMax) > 0.05) {
            return Math.min(dstMax, val * (dstMax / srcMax));
          }
          return dstMax > 0 ? Math.min(dstMax, val) : val;
        };

        let activeCnt = 0;

        assignIds.forEach((aId: any) => {
          const aKey = String(aId);
          const assignRow = assignByIdMap.get(aKey);
          const eid = String(assignRow?.exam_id || assignRow?.exam_paper_id || examPaperId);
          const emMeta = examMasterById.get(eid);
          const emTitleCombined = `${emMeta?.title || ''} ${emMeta?.sub_title || ''}`;
          const isLegacyExam =
            eid !== String(examPaperId) &&
            emTitleCombined.includes('입학') &&
            !emTitleCombined.includes('진단') &&
            !emTitleCombined.includes('2610');

          const activeMData = isLegacyExam ? (legacyMData || mData) : mData;
          const activeRBase = isLegacyExam ? (legacyRBase || rBase) : rBase;
          const targetGroups = groupsByExamId.get(eid) || groups;

          const studentMap = ansByAssign.get(aKey);
          const savedRep = repByAssign.get(aKey);
          if (!studentMap && !savedRep) return;

          let sStat = { geo:0, mea:0, stat:0, rule:0, calc:0, sense:0, space:0, logic:0, know:0, think:0, persist:0, d1:0, d2:0, d3:0, d4:0, d5:0, total:0 };

          if (studentMap && targetGroups && targetGroups.length > 0) {
            targetGroups.forEach((g: any, index: number) => {
              const logicalQNum = index + 1;
              const m = activeMData[logicalQNum];
              let maxScore = m ? parseFloat(String(m.assigned_score)) : Math.max(...g.items.map((i: any) => parseFloat(i.assigned_score) || 0));
              if (!maxScore || maxScore === 0) maxScore = 100 / (targetGroups.length || 30);
              const subScore = maxScore / (g.items.length || 1);

              let groupEarned = 0;
              g.items.forEach((i: any) => {
                const ansObj = studentMap.get(String(i.question_id));
                const oldItemScore = parseFloat(i.assigned_score) || ((100 / (targetGroups.length || 30)) / (g.items.length || 1));
                const { earned } = computeItemEarnedByStandard(ansObj, subScore, oldItemScore, gcMap, true);
                groupEarned = Math.min(maxScore, groupEarned + earned);
              });

              if (m) {
                sStat.total += groupEarned;
                if (m.math_category === '도형') sStat.geo += groupEarned;
                else if (m.math_category === '측정') sStat.mea += groupEarned;
                else if (m.math_category === '확률과 통계') sStat.stat += groupEarned;
                else if (m.math_category === '규칙과 논리' || m.math_category === '규칙성') sStat.rule += groupEarned;
                else if (m.math_category === '수와 연산') sStat.calc += groupEarned;

                if (m.is_calc_sense) sStat.sense += groupEarned;
                if (m.is_spatial_perception) sStat.space += groupEarned;
                if (m.is_logical_reasoning) sStat.logic += groupEarned;
                if (m.is_background_knowledge) sStat.know += groupEarned;
                if (m.is_thinking_ability) sStat.think += groupEarned;
                if (m.is_task_persistence) sStat.persist += groupEarned;

                const d = m.difficulty_level;
                if (d === 1) sStat.d1 += groupEarned;
                else if (d === 2) sStat.d2 += groupEarned;
                else if (d === 3) sStat.d3 += groupEarned;
                else if (d === 4) sStat.d4 += groupEarned;
                else if (d === 5) sStat.d5 += groupEarned;
              }
            });
          }

          // 문항 매칭 점수가 0점인데 저장된 리포트 스냅샷이 있는 경우(과거 입학테스트 등) 스냅샷 사용
          if (sStat.total === 0 && savedRep) {
            sStat = {
              geo: Number(savedRep.score_geometry) || 0,
              mea: Number(savedRep.score_measure) || 0,
              stat: Number(savedRep.score_stat) || 0,
              rule: Number(savedRep.score_rule) || 0,
              calc: Number(savedRep.score_calc) || 0,
              sense: Number(savedRep.score_calc_sense) || 0,
              space: Number(savedRep.score_spatial_percep) || 0,
              logic: Number(savedRep.score_logical_reason) || 0,
              know: Number(savedRep.score_knowledge) || 0,
              think: Number(savedRep.score_thinking) || 0,
              persist: Number(savedRep.score_persistence) || 0,
              d1: Number(savedRep.score_diff_1) || 0,
              d2: Number(savedRep.score_diff_2) || 0,
              d3: Number(savedRep.score_diff_3) || 0,
              d4: Number(savedRep.score_diff_4) || 0,
              d5: Number(savedRep.score_diff_5) || 0,
              total: Number(savedRep.total_score) || Number(assignRow?.total_score) || 0,
            };
          }

          if (sStat.total === 0 && Number(assignRow?.total_score) > 0) {
            sStat.total = Number(assignRow.total_score);
          }

          if (isLegacyExam && activeRBase && rBase) {
            sStat.geo = scaleToCurrentBase(sStat.geo, activeRBase.max_geometry, rBase.max_geometry);
            sStat.mea = scaleToCurrentBase(sStat.mea, activeRBase.max_measure, rBase.max_measure);
            sStat.stat = scaleToCurrentBase(sStat.stat, activeRBase.max_stat, rBase.max_stat);
            sStat.rule = scaleToCurrentBase(sStat.rule, activeRBase.max_rule, rBase.max_rule);
            sStat.calc = scaleToCurrentBase(sStat.calc, activeRBase.max_calc, rBase.max_calc);
            sStat.sense = scaleToCurrentBase(sStat.sense, activeRBase.max_calc_sense, rBase.max_calc_sense);
            sStat.space = scaleToCurrentBase(sStat.space, activeRBase.max_spatial, rBase.max_spatial);
            sStat.logic = scaleToCurrentBase(sStat.logic, activeRBase.max_logic, rBase.max_logic);
            sStat.know = scaleToCurrentBase(sStat.know, activeRBase.max_knowledge, rBase.max_knowledge);
            sStat.think = scaleToCurrentBase(sStat.think, activeRBase.max_thinking, rBase.max_thinking);
            sStat.persist = scaleToCurrentBase(sStat.persist, activeRBase.max_persistence, rBase.max_persistence);
            sStat.d1 = scaleToCurrentBase(sStat.d1, activeRBase.max_diff_1, rBase.max_diff_1);
            sStat.d2 = scaleToCurrentBase(sStat.d2, activeRBase.max_diff_2, rBase.max_diff_2);
            sStat.d3 = scaleToCurrentBase(sStat.d3, activeRBase.max_diff_3, rBase.max_diff_3);
            sStat.d4 = scaleToCurrentBase(sStat.d4, activeRBase.max_diff_4, rBase.max_diff_4);
            sStat.d5 = scaleToCurrentBase(sStat.d5, activeRBase.max_diff_5, rBase.max_diff_5);
          }

          activeCnt++;
          for (let k in avgStats) (avgStats as any)[k] += (sStat as any)[k];
        });

        if (activeCnt > 0) {
          for (let k in avgStats) (avgStats as any)[k] = parseFloat(((avgStats as any)[k] / activeCnt).toFixed(1));
        }

        if (analyticsMatchedAvgTotal > 0) {
          avgStats.total = analyticsMatchedAvgTotal;
        }
      }

      // 종합 코멘트 
      const getPct = (earned: number, max: number) => (!max || max === 0) ? 0 : Math.round((earned / max) * 100);
      const getLevel = (earned: number, max: number) => { if (max === 0) return '중'; const pct = (earned / max) * 100; if (pct >= 70) return '상'; if (pct >= 50) return '중'; return '하'; };
      
      const lvThink = getLevel(stats.think, rBase.max_thinking); 
      const lvPersist = getLevel(stats.persist, rBase.max_persistence); 
      const lvKnow = getLevel(stats.know, rBase.max_knowledge);

      const { data: commentData } = await supabase.from('admission_eval_comment').select('comment_text').eq('thinking_level', lvThink).eq('persistence_level', lvPersist).eq('knowledge_level', lvKnow).maybeSingle();
      const evalComment = commentData ? commentData.comment_text : '분석된 종합 평가 결과가 없습니다.';

      const totalPct = getPct(stats.total, rBase.max_total_score);

      const getUmathClass = (pct: number) => {
        if (pct >= 90) return 'Ultimate<br><span class="text-[11px] font-normal text-amber-100">(최상위 영재반)</span>';
        if (pct >= 80) return 'Master<br><span class="text-[11px] font-normal text-amber-100">(심화 사고력반)</span>';
        if (pct >= 65) return 'Apex<br><span class="text-[11px] font-normal text-amber-100">(응용 심화반)</span>';
        if (pct >= 50) return 'Titan<br><span class="text-[11px] font-normal text-amber-100">(개념 응용반)</span>';
        return 'Horizon<br><span class="text-[11px] font-normal text-amber-100">(기초 탄탄반)</span>';
      };

      const catPcts = [
        { name: '수와 연산', pct: getPct(stats.calc, rBase.max_calc) },
        { name: '도형', pct: getPct(stats.geo, rBase.max_geometry) },
        { name: '측정', pct: getPct(stats.mea, rBase.max_measure) },
        { name: '규칙', pct: getPct(stats.rule, rBase.max_rule) },
        { name: '확률과 통계', pct: getPct(stats.stat, rBase.max_stat) }
      ].sort((a, b) => b.pct - a.pct); 
      
      let bestCat = '-'; let worstCat = '-';
      if (catPcts[0].pct === 0) { bestCat = '-'; worstCat = '전 영역 기초 부족'; } 
      else if (catPcts[0].pct === 100 && catPcts[4].pct === 100) { bestCat = '전 영역 만점 🏆'; worstCat = '취약점 없음 ✨'; } 
      else if (catPcts[0].pct === catPcts[4].pct) { bestCat = '전 영역 고른 성취'; worstCat = '특 특이 취약점 없음'; } 
      else { bestCat = catPcts[0].name; worstCat = catPcts[4].name; }

      // 데이터 통합 저장
      setReportData({
        studentName, standardName, reportDate,
        totalScore: parseFloat(stats.total.toFixed(1)), correctCount: stats.correct_cnt,
        avgTotalScore: parseFloat(avgStats.total.toFixed(1)),
        recommendedClass: getUmathClass(totalPct),
        bestCat, worstCat, evalComment,
        sData, stats, avgStats, rBase
      });
      setIsLoading(false);

    } catch (e: any) {
      setErrorMsg(e.message);
      setIsLoading(false);
    }
  };

  const renderCharts = () => {
    if (!reportData) return;
    const { stats: st, avgStats: avg, rBase: base } = reportData;
    const getPct = (earned: number, max: number) => (!max || max === 0) ? 0 : Math.round((earned / max) * 100);

    Chart.defaults.font.family = "'Pretendard', sans-serif"; 
    Chart.defaults.font.weight = 'bold';

    if (catChartRef.current) {
      if (chartInstances.current.cat) chartInstances.current.cat.destroy();
      chartInstances.current.cat = new Chart(catChartRef.current, {
        type: 'bar',
        data: {
          labels: ['수·연', '도형', '측정', '규칙', '확·통'], 
          datasets: [
            { label: '학생', data: [ getPct(st.calc, base.max_calc), getPct(st.geo, base.max_geometry), getPct(st.mea, base.max_measure), getPct(st.rule, base.max_rule), getPct(st.stat, base.max_stat) ], backgroundColor: '#1e493b', borderRadius: 4, barThickness: 12 },
            { label: '평균', data: [ getPct(avg.calc, base.max_calc), getPct(avg.geo, base.max_geometry), getPct(avg.mea, base.max_measure), getPct(avg.rule, base.max_rule), getPct(avg.stat, base.max_stat) ], backgroundColor: '#94a3b8', borderRadius: 4, barThickness: 12 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { min: 0, max: 100, ticks: { stepSize: 25, font: { size: 9 } } }, x: { ticks: { font: { size: 10, weight: 'bold' } } } } }
      });
    }

    if (diffChartRef.current) {
      if (chartInstances.current.diff) chartInstances.current.diff.destroy();
      chartInstances.current.diff = new Chart(diffChartRef.current, {
        type: 'bar',
        data: {
          labels: ['Lv 1', 'Lv 2', 'Lv 3', 'Lv 4', 'Lv 5'],
          datasets: [
            { label: '학생', data: [ getPct(st.d1, base.max_diff_1), getPct(st.d2, base.max_diff_2), getPct(st.d3, base.max_diff_3), getPct(st.d4, base.max_diff_4), getPct(st.d5, base.max_diff_5) ], backgroundColor: '#0f172a', borderRadius: 4, barThickness: 12 },
            { label: '평균', data: [ getPct(avg.d1, base.max_diff_1), getPct(avg.d2, base.max_diff_2), getPct(avg.d3, base.max_diff_3), getPct(avg.d4, base.max_diff_4), getPct(avg.d5, base.max_diff_5) ], backgroundColor: '#94a3b8', borderRadius: 4, barThickness: 12 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { min: 0, max: 100, ticks: { stepSize: 25, font: { size: 9 } } }, x: { ticks: { font: { size: 10, weight: 'bold' } } } } }
      });
    }

    const radarOptions: any = { responsive: true, maintainAspectRatio: false, scales: { r: { min: 0, max: 100, ticks: { display: false }, pointLabels: { font: { size: 12, weight: '900' }, color: '#1e293b' } } }, plugins: { legend: { display: false } } };

    if (cogLeftChartRef.current) {
      if (chartInstances.current.left) chartInstances.current.left.destroy();
      chartInstances.current.left = new Chart(cogLeftChartRef.current, {
        type: 'radar',
        data: {
          labels: ['수 감각', '공간지각력', '논리추론'],
          datasets: [
            { label: '학생(%)', data: [ getPct(st.sense, base.max_calc_sense), getPct(st.space, base.max_spatial), getPct(st.logic, base.max_logic) ], backgroundColor: 'rgba(30, 73, 59, 0.4)', borderColor: '#1e493b', pointBackgroundColor: '#122e25', borderWidth: 2, pointRadius: 3 },
            { label: '평균(%)', data: [ getPct(avg.sense, base.max_calc_sense), getPct(avg.space, base.max_spatial), getPct(avg.logic, base.max_logic) ], backgroundColor: 'transparent', borderColor: '#f59e0b', borderDash: [6, 4], borderWidth: 3, pointBackgroundColor: '#f59e0b', pointRadius: 1.5 }
          ]
        },
        options: radarOptions
      });
    }

    if (cogRightChartRef.current) {
      if (chartInstances.current.right) chartInstances.current.right.destroy();
      chartInstances.current.right = new Chart(cogRightChartRef.current, {
        type: 'radar',
        data: {
          labels: ['배경지식', '사고력', '과제집착력'],
          datasets: [
            { label: '학생(%)', data: [ getPct(st.know, base.max_knowledge), getPct(st.think, base.max_thinking), getPct(st.persist, base.max_persistence) ], backgroundColor: 'rgba(51, 65, 85, 0.3)', borderColor: '#334155', pointBackgroundColor: '#0f172a', borderWidth: 2, pointRadius: 3 },
            { label: '평균(%)', data: [ getPct(avg.know, base.max_knowledge), getPct(avg.think, base.max_thinking), getPct(avg.persist, base.max_persistence) ], backgroundColor: 'transparent', borderColor: '#f59e0b', borderDash: [6, 4], borderWidth: 3, pointBackgroundColor: '#f59e0b', pointRadius: 1.5 }
          ]
        },
        options: radarOptions
      });
    }
  };

  // 테이블 렌더링 헬퍼 함수
  const renderQTable = (start: number, end: number) => {
    if (!reportData) return null;
    const cols = [];
    for (let i = start; i <= end; i++) cols.push(i);

    return (
      <table className="w-full table-fixed border-collapse">
        <tbody>
          <tr>
            <td className="border border-slate-300 text-center p-1 text-xs font-bold bg-slate-50 text-slate-700 w-[12%]">구분</td>
            {cols.map(i => <td key={i} className="border border-slate-300 text-center p-1 text-xs font-bold bg-slate-50 text-slate-700 w-[5.8%]">{i}</td>)}
          </tr>
          <tr>
            <td className="border border-slate-300 text-center p-1 text-xs font-bold bg-slate-50 text-slate-700">수학영역</td>
            {cols.map(i => <td key={i} className="border border-slate-300 text-center p-1 text-[10px] text-slate-500 tracking-tighter">{catMap[reportData.sData[i]?.meta?.math_category] || '-'}</td>)}
          </tr>
          <tr>
            <td className="border border-slate-300 text-center p-1 text-xs font-bold bg-slate-50 text-slate-700">난이도</td>
            {cols.map(i => <td key={i} className="border border-slate-300 text-center p-1 text-[10px] text-slate-600 font-bold">L{reportData.sData[i]?.meta?.difficulty_level || '-'}</td>)}
          </tr>
          <tr>
            <td className="border border-slate-300 text-center p-1 text-xs font-bold bg-slate-50 text-slate-700">결과</td>
            {cols.map(i => {
              const ans = reportData.sData[i];
              const score = ans ? (parseFloat(ans.earned_score) || 0) : 0;
              const max = (ans?.meta && parseFloat(ans.meta.assigned_score) > 0) ? parseFloat(ans.meta.assigned_score) : (parseFloat(ans?.max_score) || 0);
              let isCorStatus = 'X';
              if (score > 0) {
                if (max > 0 && score >= max - 0.05) isCorStatus = 'O';
                else isCorStatus = 'TRI';
              }
              if (isCorStatus === 'O') return <td key={i} className="border border-slate-300 text-center p-1 text-[1.1rem] font-black text-[#10b981] bg-emerald-50/50">○</td>;
              else if (isCorStatus === 'TRI') return <td key={i} className="border border-slate-300 text-center p-1 text-[1rem] font-black text-[#f59e0b] bg-amber-50/50">△</td>;
              return <td key={i} className="border border-slate-300 text-center p-1 text-[1.1rem] font-black text-[#ef4444] bg-red-50/50">×</td>;
            })}
          </tr>
        </tbody>
      </table>
    );
  };

  const getPct = (earned: number, max: number) => (!max || max === 0) ? 0 : Math.round((earned / max) * 100);
  const getTraitLevel = (pct: number) => { if (pct >= 80) return '탁월'; if (pct >= 60) return '양호'; return '도약'; };

  const renderDetailRow = (name: string, earned: number, avgScore: number, max: number) => (
    <tr key={name}>
      <td className="py-1.5 bg-white text-slate-700">{name}</td>
      <td className="py-1.5 bg-white text-slate-400 font-medium">{max}</td>
      <td className="py-1.5 bg-white text-slate-400 font-medium">{avgScore}</td>
      <td className="py-1.5 bg-[#1e493b]/5 text-[#1e493b] font-black">{parseFloat(earned.toFixed(1))}</td>
      <td className="py-1.5 bg-white text-emerald-600">{getPct(earned, max)}%</td>
    </tr>
  );

  const renderCogRow = (name: string, pct: number) => {
    const studentLv = getTraitLevel(pct);
    let lvStyle = studentLv === '탁월' ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : (studentLv === '양호' ? 'text-blue-600 bg-blue-50 border-blue-200' : 'text-amber-600 bg-amber-50 border-amber-200');
    return (
      <tr key={name}>
        <td className="py-2.5 text-left border-b border-slate-100 flex items-center gap-2 px-2"><div className="w-1.5 h-1.5 rounded-full bg-[#1e493b]/60"></div> {name}</td>
        <td className="py-2.5 text-center border-b border-slate-100 font-black text-[#1e493b] text-sm">{pct}%</td>
        <td className="py-2.5 text-center border-b border-slate-100 px-2"><span className={`w-full block py-1 rounded border text-[11px] font-black ${lvStyle}`}>{studentLv}</span></td>
      </tr>
    );
  };

  return (
    <div id="report-container" className="absolute inset-0 z-[9999] bg-[#e2e8f0] overflow-y-auto custom-scroll">
      
      {/* 플로팅 액션 버튼 (인쇄/닫기) */}
      <div className="fixed bottom-8 right-8 z-50 flex items-center gap-3 print:hidden no-print">
        <button onClick={() => window.print()} className="bg-[#1e493b] hover:bg-[#122e25] text-white font-extrabold px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 transition-transform transform hover:scale-105">
          🖨️ 리포트 인쇄 (PDF)
        </button>
        <button onClick={() => window.close()} className="bg-slate-700 hover:bg-slate-900 text-white font-extrabold px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 transition-transform transform hover:scale-105">
          ✖ 창닫기
        </button>
      </div>

      {/* 로딩 및 에러 화면 */}
      {isLoading && (
        <div className="fixed inset-0 bg-white z-[10000] flex flex-col items-center justify-center print:hidden">
          {errorMsg ? (
            <div className="bg-red-50 border border-red-200 p-8 rounded-2xl max-w-2xl text-center shadow-lg">
              <h2 className="text-2xl font-black text-red-600 mb-4">🚨 리포트 생성 중단</h2>
              <p className="text-slate-500 text-sm bg-white p-4 rounded border border-slate-200 whitespace-pre-wrap font-mono text-left">{errorMsg}</p>
              <button onClick={() => window.close()} className="mt-6 px-6 py-2 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-900 shadow-sm">창 닫기</button>
            </div>
          ) : (
            <>
              <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-[#1e493b] mb-4"></div>
              <h2 className="text-xl font-bold text-slate-700">리포트 데이터를 분석하여 100% 정확한 평균을 산출 중입니다...</h2>
            </>
          )}
        </div>
      )}

      {/* 💡 A4 페이지 전용 CSS 주입: 이 스타일이 다중 페이지 인쇄를 완벽하게 제어합니다. */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page { size: A4; margin: 0; }
          
          /* 1. Next.js 등 최상위 부모 요소의 높이 제한을 완전히 풉니다 */
          html, body {
            height: auto !important;
            min-height: auto !important;
            overflow: visible !important;
            background: white !important;
          }
          
          /* 2. 화면 전체 요소 숨김 (레이아웃 간섭 차단) */
          body * {
            visibility: hidden !important;
          }
          
          /* 3. 리포트 컨테이너와 하위 내용만 강제 표시 */
          #report-container, #report-container * {
            visibility: visible !important;
          }
          
          /* 4. [핵심 수정] 1페이지 잘림 현상 방지
             화면용 클래스인 inset-0는 bottom:0 을 포함하고 있어 인쇄 시 높이를 1페이지(100vh)로 강제 제한합니다.
             여기서 bottom: auto 를 주어 제한을 풀고 height: auto 로 무한정 늘어날 수 있게 만듭니다. */
          #report-container {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            right: 0 !important;
            bottom: auto !important;      /* 🌟 매우 중요: 100vh 제한 해제 */
            width: 100% !important;
            height: auto !important;      /* 전체 콘텐츠 높이 허용 */
            overflow: visible !important;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
          }

          /* 5. 버튼 등 불필요한 영역은 아예 구조에서 제거 */
          .print\\:hidden, .no-print {
            display: none !important;
            visibility: hidden !important;
          }

          * { 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important;
            color-adjust: exact !important; 
          }
          
          /* 6. 정확한 A4 사이즈 분할 설정 (최신 브라우저 속성 추가) */
          .a4-page { 
            margin: 0 auto !important; 
            padding: 10mm 15mm !important; 
            box-shadow: none !important; 
            border: none !important; 
            
            /* 구형 브라우저 지원 */
            page-break-after: always !important; 
            page-break-inside: avoid !important;
            
            /* 최신 크롬/사파리/엣지 지원 */
            break-after: page !important;
            break-inside: avoid !important;
          }

          /* 7. 마지막 페이지 뒤에 불필요한 빈 페이지가 한 장 더 출력되는 것 방지 */
          .a4-page:last-of-type {
            page-break-after: auto !important;
            break-after: auto !important;
          }
        }

        /* 평소 모니터 화면에서 보여질 때의 디자인 */
        .a4-page { 
          width: 210mm; 
          min-height: 297mm; 
          background: white; 
          margin: 2rem auto; 
          padding: 12mm 18mm; 
          box-sizing: border-box; 
          box-shadow: 0 10px 25px rgba(0,0,0,0.1); 
          position: relative; 
          display: flex; 
          flex-direction: column; 
        }
      `}} />

      {/* 실제 리포트 내용 */}
      {reportData && (
        <>
          {/* 첫 번째 A4 페이지 */}
          <div className="a4-page">
            <header className="border-b-[3px] border-[#1e493b] pb-3 mb-5 flex justify-between items-end shrink-0">
              <div>
                <h1 className="text-[34px] font-black text-[#1e493b] tracking-tight leading-none flex items-center gap-3">
                  <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica 로고" className="h-8 object-contain" />
                  <span className="font-light">진단평가 분석 결과</span>
                </h1>
                <p className="text-slate-500 font-bold mt-1.5 text-sm">{reportData.reportDate}</p>
              </div>
              <div className="text-right flex flex-col items-end">
                <div className="text-xl font-extrabold text-slate-800"><span className="text-[#1e493b] text-2xl">{reportData.studentName}</span> 학생</div>
                <div className="text-xs font-bold text-slate-500 mt-1">평가 기준: <span className="bg-[#1e493b]/10 text-[#1e493b] px-2 py-0.5 rounded ml-1">{reportData.standardName}</span></div>
              </div>
            </header>

            <main className="flex-1 flex flex-col gap-5">
              <section className="shrink-0">
                <h2 className="text-lg font-black text-slate-800 mb-2 border-b-2 border-slate-800 pb-1.5 flex items-center gap-2">문항별 상세 채점 결과</h2>
                <div className="w-full overflow-hidden border border-slate-300 rounded mb-3">{renderQTable(1, 15)}</div>
                <div className="w-full overflow-hidden border border-slate-300 rounded">{renderQTable(16, 30)}</div>
              </section>

              <section className="grid grid-cols-12 gap-4 flex-1">
                <div className="col-span-3 bg-gradient-to-br from-[#1e493b] to-[#0f251d] text-white rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-5 rounded-full -mr-10 -mt-10"></div>
                  <div className="px-1">
                    <span className="text-[13px] font-bold text-emerald-100/70 block mb-1">Logica 진단평가</span>
                    <span className="text-base font-black text-white">최종 종합 점수</span>
                  </div>
                  {/* 💡 수정된 부분: Flexbox baseline 정렬 및 whitespace-nowrap 적용 */}
                  <div className="my-4 flex justify-center items-baseline whitespace-nowrap w-full">
                    <span className="text-[44px] font-black leading-none drop-shadow-md tracking-tighter">
                      {reportData.totalScore}
                    </span>
                    <span className="text-lg font-bold ml-1.5 tracking-normal text-emerald-100/80">
                      점
                    </span>
                  </div>
                  
                  <div className="space-y-1.5 mt-auto relative z-10 w-full">
                    <div className="flex justify-between items-center bg-white/10 px-2 py-1.5 rounded-lg backdrop-blur-sm gap-2">
                      <span className="text-[11px] font-bold text-emerald-100/90 whitespace-nowrap flex-shrink-0">응시자 평균</span>
                      <span className="text-xs font-black text-white whitespace-nowrap truncate text-right">{reportData.avgTotalScore}점</span>
                    </div>
                    
                    <div className="flex flex-col bg-amber-500/20 px-2 py-2 rounded-lg backdrop-blur-sm border border-amber-400/30 gap-1 my-2">
                      <span className="text-[13px] font-bold text-amber-200">💡 Logica 클래스</span>
                      <span dangerouslySetInnerHTML={{ __html: reportData.recommendedClass }} className="text-[14px] font-black text-white text-center w-full leading-tight" />
                    </div>

                    <div className="flex justify-between items-center bg-white/10 px-2 py-1.5 rounded-lg backdrop-blur-sm gap-2">
                      <span className="text-[11px] font-bold text-emerald-100/90 whitespace-nowrap flex-shrink-0">정답 문항 수</span>
                      <span className="text-xs font-black text-white whitespace-nowrap truncate text-right">{reportData.correctCount} / 30</span>
                    </div>
                    <div className="flex flex-col bg-white/10 px-2 py-2 rounded-lg backdrop-blur-sm border-t border-white/10 gap-1 mt-1">
                      <span className="text-[11px] font-bold text-emerald-100/90">🏆 최우수 영역</span>
                      <span className="text-[12px] font-black text-amber-300 text-right w-full">{reportData.bestCat}</span>
                    </div>
                    <div className="flex flex-col bg-white/10 px-2 py-2 rounded-lg backdrop-blur-sm gap-1">
                      <span className="text-[11px] font-bold text-emerald-100/90">🔧 보완 영역</span>
                      <span className="text-[12px] font-black text-rose-300 text-right w-full">{reportData.worstCat}</span>
                    </div>
                  </div>
                </div>

                <div className="col-span-9 grid grid-cols-2 gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col">
                    <h3 className="text-sm font-extrabold text-slate-800 mb-3 text-center bg-slate-50 py-1.5 rounded">수학 내용 영역별 분석</h3>
                    <table className="w-full text-[11px] text-center border-collapse mb-3">
                      <thead className="bg-slate-100 text-slate-600 border-y border-slate-300">
                        <tr><th className="py-1">영역</th><th className="py-1">만점</th><th className="py-1">평균</th><th className="py-1 text-[#1e493b]">획득</th><th className="py-1 text-emerald-600">성취율</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                        {renderDetailRow('수와 연산', reportData.stats.calc, reportData.avgStats.calc, reportData.rBase.max_calc)}
                        {renderDetailRow('도형', reportData.stats.geo, reportData.avgStats.geo, reportData.rBase.max_geometry)}
                        {renderDetailRow('측정', reportData.stats.mea, reportData.avgStats.mea, reportData.rBase.max_measure)}
                        {renderDetailRow('규칙성', reportData.stats.rule, reportData.avgStats.rule, reportData.rBase.max_rule)}
                        {renderDetailRow('확률과 통계', reportData.stats.stat, reportData.avgStats.stat, reportData.rBase.max_stat)}
                      </tbody>
                    </table>
                    <div className="flex-1 relative min-h-[140px] mt-auto w-full"><canvas ref={catChartRef}></canvas></div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col">
                    <h3 className="text-sm font-extrabold text-slate-800 mb-3 text-center bg-slate-50 py-1.5 rounded">문항 난이도별 분석</h3>
                    <table className="w-full text-[11px] text-center border-collapse mb-3">
                      <thead className="bg-slate-100 text-slate-600 border-y border-slate-300">
                        <tr><th className="py-1">단계</th><th className="py-1">만점</th><th className="py-1">평균</th><th className="py-1 text-[#1e493b]">획득</th><th className="py-1 text-emerald-600">성취율</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                        {renderDetailRow('Level 1', reportData.stats.d1, reportData.avgStats.d1, reportData.rBase.max_diff_1)}
                        {renderDetailRow('Level 2', reportData.stats.d2, reportData.avgStats.d2, reportData.rBase.max_diff_2)}
                        {renderDetailRow('Level 3', reportData.stats.d3, reportData.avgStats.d3, reportData.rBase.max_diff_3)}
                        {renderDetailRow('Level 4', reportData.stats.d4, reportData.avgStats.d4, reportData.rBase.max_diff_4)}
                        {renderDetailRow('Level 5', reportData.stats.d5, reportData.avgStats.d5, reportData.rBase.max_diff_5)}
                      </tbody>
                    </table>
                    <div className="flex-1 relative min-h-[140px] mt-auto w-full"><canvas ref={diffChartRef}></canvas></div>
                  </div>
                </div>
              </section>
            </main>
            <footer className="mt-4 pt-3 border-t border-slate-200 text-center text-[11px] text-slate-400 font-bold shrink-0">LOGICA. 깊고 단단한 심화 수학.</footer>
          </div>

          {/* 두 번째 A4 페이지 */}
          <div className="a4-page">
            <header className="border-b-[3px] border-[#1e493b] pb-3 mb-5 flex justify-between items-end shrink-0">
              <h1 className="text-[26px] font-black text-[#1e493b] tracking-tight leading-none">인지 및 행동 특성 분석</h1>
              <div className="text-xl font-extrabold text-slate-800"><span className="text-[#1e493b]">{reportData.studentName}</span> 학생</div>
            </header>

            <main className="flex-1 flex flex-col gap-6">
              <section className="grid grid-cols-2 gap-6 mb-2 shrink-0">
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col items-center relative overflow-hidden">
                  <h3 className="text-sm font-extrabold text-white bg-[#1e493b] px-6 py-1.5 rounded-full mb-3 w-max relative z-10">3대 인지 특성</h3>
                  <div className="w-full relative h-[200px] mb-3 z-10"><canvas ref={cogLeftChartRef}></canvas></div>
                  <table className="w-full text-xs text-center border-collapse relative z-10">
                    <thead className="bg-slate-50 text-slate-500 border-y border-slate-200">
                      <tr><th className="py-1.5 w-1/2">분석 항목</th><th className="py-1.5 w-1/4">성취율</th><th className="py-1.5 w-1/4">수준</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                      {renderCogRow('수 감각', getPct(reportData.stats.sense, reportData.rBase.max_calc_sense))}
                      {renderCogRow('공간지각력', getPct(reportData.stats.space, reportData.rBase.max_spatial))}
                      {renderCogRow('논리추론', getPct(reportData.stats.logic, reportData.rBase.max_logic))}
                    </tbody>
                  </table>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 mt-3 w-full text-[10px] text-slate-600 font-medium leading-relaxed space-y-1 relative z-10">
                    <div>• <span className="text-[#1e493b] font-bold">수 감각:</span> 수의 구조/크기를 이해하는 직관력</div>
                    <div>• <span className="text-[#1e493b] font-bold">공간지각력:</span> 3차원 상상 및 도형 파악 능력</div>
                    <div>• <span className="text-[#1e493b] font-bold">논리추론:</span> 규칙을 발견하고 결론을 도출하는 힘</div>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col items-center relative overflow-hidden">
                  <h3 className="text-sm font-extrabold text-white bg-slate-700 px-6 py-1.5 rounded-full mb-3 w-max relative z-10">3대 행동 특성</h3>
                  <div className="w-full relative h-[200px] mb-3 z-10"><canvas ref={cogRightChartRef}></canvas></div>
                  <table className="w-full text-xs text-center border-collapse relative z-10">
                    <thead className="bg-slate-50 text-slate-500 border-y border-slate-200">
                      <tr><th className="py-1.5 w-1/2">분석 항목</th><th className="py-1.5 w-1/4">성취율</th><th className="py-1.5 w-1/4">수준</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                      {renderCogRow('배경지식', getPct(reportData.stats.know, reportData.rBase.max_knowledge))}
                      {renderCogRow('사고력', getPct(reportData.stats.think, reportData.rBase.max_thinking))}
                      {renderCogRow('과제집착력', getPct(reportData.stats.persist, reportData.rBase.max_persistence))}
                    </tbody>
                  </table>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 mt-3 w-full text-[10px] text-slate-600 font-medium leading-relaxed space-y-1 relative z-10">
                    <div>• <span className="text-slate-700 font-bold">배경지식:</span> 수학 개념과 원리에 대한 사전 지식</div>
                    <div>• <span className="text-slate-700 font-bold">사고력:</span> 새롭고 복합적인 문제를 해결하는 유연함</div>
                    <div>• <span className="text-slate-700 font-bold">과제집착력:</span> 끝까지 포기하지 단단하게 몰입하는 끈기</div>
                  </div>
                </div>
              </section>

              <section className="flex-1 flex flex-col">
                <h2 className="text-lg font-black text-slate-800 mb-3 border-b-2 border-slate-800 pb-1.5 flex items-center gap-2">
                  <span>💡</span> 진단 평가 종합 결과
                </h2>
                <div className="bg-white border-2 border-[#1e493b]/20 rounded-2xl p-7 flex-1 relative shadow-sm flex flex-col">
                  <svg className="absolute top-4 left-4 text-[#1e493b] w-10 h-10 opacity-10" fill="currentColor" viewBox="0 0 24 24"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h4v10h-10z"/></svg>
                  <div className="flex gap-2 mb-4 relative z-10">
                    <span className="px-3 py-1 bg-[#1e493b] text-white rounded-full text-[12px] font-black shadow-sm">종합 분석</span>
                  </div>
                  <p className="text-slate-700 font-bold text-[15px] leading-loose tracking-tight text-justify indent-2 whitespace-pre-line relative z-10 flex-1">
                    {reportData.evalComment}
                  </p>
                </div>
              </section>
            </main>
            <footer className="mt-4 pt-3 border-t border-slate-200 text-center text-[11px] text-slate-400 font-bold shrink-0">LOGICA. 깊고 단단한 심화 수학.</footer>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdmissionReportPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center font-bold text-slate-500">로딩 중...</div>}>
      <AdmissionReportContent />
    </Suspense>
  );
}