// src/app/actions/clinicActions.ts
"use server";

import { createClient } from '@supabase/supabase-js';

// RLS를 우회하여 강제로 처리하기 위해 Service Role Key 사용
const getAdminClient = () => {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!, 
        { auth: { persistSession: false } }
    );
};

// 🌟 공통 헬퍼: 유효한 instructor_id를 찾기 위한 폴백(대비책) 함수
async function getFallbackInstructorId(supabaseAdmin: any): Promise<string | null> {
    // class 테이블에서 instructor_id가 비어있지 않은 아무 레코드나 하나 가져옵니다.
    const { data } = await supabaseAdmin.from('class')
        .select('instructor_id')
        .not('instructor_id', 'is', null)
        .limit(1)
        .maybeSingle();
    return data?.instructor_id || null;
}

export async function processIncompleteHomeworks(studentId: string, pendingHwIds: number[], tenantId: string) {
    const supabaseAdmin = getAdminClient();

    try {
        const { data: hwData, error: hwErr } = await supabaseAdmin.from('homework_assignment')
            .select(`
                homework_id, 
                class_id, 
                homework_title, 
                target_questions,
                class ( instructor_id )
            `)
            .in('homework_id', pendingHwIds);
        
        if (hwErr) throw hwErr;

        const { data: hwAnsData } = await supabaseAdmin.from('student_homework_answer')
            .select('homework_id, tq_id')
            .eq('student_id', studentId)
            .in('homework_id', pendingHwIds)
            .in('grading_code', ['O', 'TO', 'RO']);

        const hwResolvedMap = new Map<number, Set<number>>();
        hwAnsData?.forEach((a: any) => {
            if (!hwResolvedMap.has(a.homework_id)) hwResolvedMap.set(a.homework_id, new Set());
            if (a.tq_id) hwResolvedMap.get(a.homework_id)!.add(a.tq_id);
        });

        let allTargetTqIds = new Set<number>();
        hwData?.forEach((hw: any) => {
            let tqs = [];
            try { tqs = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : (hw.target_questions || []); } catch(e){}
            tqs.forEach((t: number) => allTargetTqIds.add(t));
        });

        const tqToQidMap = new Map<number, number>();
        if (allTargetTqIds.size > 0) {
            const { data: tqRows } = await supabaseAdmin.from('textbook_question')
                .select('tq_id, question_id')
                .in('tq_id', Array.from(allTargetTqIds));
            tqRows?.forEach((row: any) => { if (row.question_id) tqToQidMap.set(row.tq_id, row.question_id); });
        }

        const fallbackInstId = await getFallbackInstructorId(supabaseAdmin);

        // 🌟 수정됨: hwData를 any[]로 캐스팅하여 'never' 타입 에러 우회
        for (const hw of (hwData as any[]) || []) {
            let tqs = [];
            try { tqs = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : (hw.target_questions || []); } catch(e){}

            const resolvedTqIds = hwResolvedMap.get(hw.homework_id) || new Set();
            const unresolvedQids = tqs
                .filter((tq: number) => !resolvedTqIds.has(tq))
                .map((tq: number) => tqToQidMap.get(tq) || tq)
                .filter(Boolean);

            if (unresolvedQids.length > 0) {
                
                let currentInstId = fallbackInstId;
                if (hw.class && !Array.isArray(hw.class) && hw.class.instructor_id) {
                    currentInstId = hw.class.instructor_id;
                } else if (Array.isArray(hw.class) && hw.class[0]?.instructor_id) {
                    currentInstId = hw.class[0].instructor_id;
                }

                if (!currentInstId) {
                    throw new Error("시험지를 배부할 강사(instructor_id) 정보를 DB에서 찾을 수 없어 미완료과제 생성을 중단했습니다.");
                }

                const { data: masterData, error: masterErr } = await supabaseAdmin.from('exam_master').insert({
                    title: `[미완료과제] ${hw.homework_title}`,
                    exam_type: '미완료과제',
                    total_questions: unresolvedQids.length,
                    tenant_id: tenantId,
                    instructor_id: currentInstId, 
                    layout_settings: {
                        column: 2, split: 4, titleMode: 'all', template: 'basic1',
                        numberColor: '#175b6a', titleColor: '#002864', lineColor: '#94a3b8'
                    }
                }).select().single();

                if (masterErr) throw masterErr;

                if (masterData) {
                    const newExamId = masterData.exam_id;
                    const examItems = unresolvedQids.map((qId: number, idx: number) => ({
                        exam_id: newExamId, question_id: qId, sort_order: idx + 1
                    }));

                    for (let i = 0; i < examItems.length; i += 100) {
                        await supabaseAdmin.from('exam_item').insert(examItems.slice(i, i + 100));
                    }

                    await supabaseAdmin.from('exam_assignment').insert({
                        exam_id: newExamId,
                        student_id: studentId,
                        class_id: hw.class_id,
                        status: '미응시'
                    });
                }
            }

            const { data: existingResult } = await supabaseAdmin.from('student_homework_result')
                .select('id')
                .eq('student_id', studentId)
                .eq('homework_id', hw.homework_id)
                .maybeSingle();

            if (existingResult) {
                await supabaseAdmin.from('student_homework_result').update({ status: '완료' }).eq('id', existingResult.id);
            } else {
                await supabaseAdmin.from('student_homework_result').insert({ student_id: studentId, homework_id: hw.homework_id, status: '완료' });
            }
        }

        return { success: true };
    } catch (err: any) {
        console.error(err);
        return { success: false, error: err.message };
    }
}

// 🌟 [통합] 오답 클리닉 생성용
export async function generateIncorrectClinic(params: {
    studentId: string;
    studentName: string;
    targetClassId: string | null;
    targetInstructorId: string | null; 
    uniqueQids: number[];
    tenantId: string;
}) {
    const supabaseAdmin = getAdminClient();
    const { studentId, studentName, targetClassId, targetInstructorId, uniqueQids, tenantId } = params;

    try {
        const { data: oldPrints } = await supabaseAdmin.from('exam_assignment')
            .select('assignment_id, exam_id, exam_master!inner(exam_type)')
            .eq('student_id', studentId)
            .in('status', ['미응시', '진행중', '대기'])
            .eq('exam_master.exam_type', '오답프린트');
            
        if (oldPrints && oldPrints.length > 0) {
            const oldAssignIds = oldPrints.map((p: any) => p.assignment_id);
            const oldExamIds = oldPrints.map((p: any) => p.exam_id);
            await supabaseAdmin.from('student_answer').delete().in('exam_assignment_id', oldAssignIds);
            await supabaseAdmin.from('exam_assignment').delete().in('assignment_id', oldAssignIds);
            await supabaseAdmin.from('exam_item').delete().in('exam_id', oldExamIds);
            await supabaseAdmin.from('exam_master').delete().in('exam_id', oldExamIds);
        }

        let finalInstructorId = targetInstructorId;
        if (!finalInstructorId) {
            finalInstructorId = await getFallbackInstructorId(supabaseAdmin);
        }
        if (!finalInstructorId) {
            throw new Error("시험지를 배부할 강사(instructor_id) 정보를 DB에서 찾을 수 없어 통합 오답 생성을 중단했습니다.");
        }

        const { data: masterData, error: masterErr } = await supabaseAdmin.from('exam_master').insert({
            title: `[통합] ${studentName} 오답 클리닉`,
            sub_title: '누적 오답 모음',
            exam_type: '오답프린트',
            total_questions: uniqueQids.length,
            tenant_id: tenantId,
            instructor_id: finalInstructorId,
            layout_settings: {
                column: 2,
                split: 4,
                titleMode: 'all',
                template: 'basic1',
                numberColor: '#175b6a',
                titleColor: '#002864',
                lineColor: '#94a3b8'
            }
        }).select().single();
        
        if (masterErr || !masterData) {
            throw new Error(masterErr?.message || "시험지 생성을 실패했습니다.");
        }

        const newExamId = masterData.exam_id;
        
        const examItems = uniqueQids.map((qId, idx) => ({
            exam_id: newExamId,
            question_id: qId,
            sort_order: idx + 1
        }));
        
        for (let i = 0; i < examItems.length; i += 100) {
            await supabaseAdmin.from('exam_item').insert(examItems.slice(i, i + 100));
        }
        
        const { data: assignData, error: assignErr } = await supabaseAdmin.from('exam_assignment').insert({
            exam_id: newExamId,
            student_id: studentId,
            class_id: targetClassId,
            status: '미응시'
        }).select().single();

        if (assignErr || !assignData) {
            throw new Error(assignErr?.message || "시험지 배부를 실패했습니다.");
        }

        return { success: true, assignmentId: assignData.assignment_id };
    } catch (err: any) {
        console.error(err);
        return { success: false, error: err.message };
    }
}