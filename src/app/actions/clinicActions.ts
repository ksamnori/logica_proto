// src/app/actions/clinicActions.ts
"use server";

import { createClient } from '@supabase/supabase-js';

// RLS를 우회하여 강제로 처리하기 위해 Service Role Key 사용
const getAdminClient = () => {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!, 
        { auth: { persistSession: false, autoRefreshToken: false } }
    );
};

const ENDED_ENROLLMENT_STATUSES = ["수강종료", "종료", "퇴원", "취소"];
const isEndedEnrollment = (e: any): boolean => {
    if (!e) return true;
    if (ENDED_ENROLLMENT_STATUSES.includes(String(e.status || "").trim())) return true;
    if (e.end_date) return true;
    return false;
};

const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

// 🌟 공통 헬퍼: 유효한 instructor_id를 찾기 위한 폴백(대비책) 함수
async function getFallbackInstructorId(supabaseAdmin: any): Promise<string | null> {
    const { data } = await supabaseAdmin.from('class')
        .select('instructor_id')
        .not('instructor_id', 'is', null)
        .limit(1)
        .maybeSingle();
    if (data?.instructor_id) return data.instructor_id;

    const { data: inst } = await supabaseAdmin.from('instructor')
        .select('instructor_id')
        .limit(1)
        .maybeSingle();
    return inst?.instructor_id || null;
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
                        exam_id: newExamId, question_id: String(qId), sort_order: idx + 1
                    }));

                    for (let i = 0; i < examItems.length; i += 100) {
                        await supabaseAdmin.from('exam_item').insert(examItems.slice(i, i + 100));
                    }

                    await supabaseAdmin.from('exam_assignment').insert({
                        exam_id: newExamId,
                        student_id: studentId,
                        class_id: hw.class_id,
                        status: '미응시',
                        tenant_id: tenantId
                    });
                }
            }

            const { data: existingResult } = await supabaseAdmin.from('student_homework_result')
                .select('hw_result_id')
                .eq('student_id', studentId)
                .eq('homework_id', hw.homework_id)
                .maybeSingle();

            if (existingResult) {
                await supabaseAdmin.from('student_homework_result')
                    .update({ status: '완료' })
                    .eq('hw_result_id', existingResult.hw_result_id);
            } else {
                await supabaseAdmin.from('student_homework_result')
                    .insert({ student_id: studentId, homework_id: hw.homework_id, status: '완료' });
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
            question_id: String(qId),
            sort_order: idx + 1
        }));
        
        for (let i = 0; i < examItems.length; i += 100) {
            await supabaseAdmin.from('exam_item').insert(examItems.slice(i, i + 100));
        }
        
        const { data: assignData, error: assignErr } = await supabaseAdmin.from('exam_assignment').insert({
            exam_id: newExamId,
            student_id: studentId,
            class_id: targetClassId,
            status: '미응시',
            tenant_id: tenantId
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

// 🌟 [신규] 클리닉 뷰어(학생 화면)에서 오답 프린트 생성/병합 (Service Role Key로 exam_master RLS 위반 원천 차단)
export async function generateIncorrectPrintServerAction(params: {
    studentId: string;
    studentName: string;
    incQIds: (number | string)[];
    sourceTitle: string;
    syncIncorrectRecord?: boolean;
    statusMap?: Record<string | number, string>;
}) {
    const supabaseAdmin = getAdminClient();
    const { studentId, studentName, incQIds, sourceTitle, syncIncorrectRecord = true, statusMap } = params;
    const uIds = Array.from(new Set((incQIds || []).filter(Boolean).map(String)));
    if (uIds.length === 0) return { success: true };

    try {
        if (syncIncorrectRecord) {
            const incUpserts = uIds.map(qid => ({
                student_id: studentId,
                question_id: qid,
                source_type: '시험지',
                status: statusMap?.[qid] || 'X',
                resolved_at: null
            }));
            await supabaseAdmin.from('student_incorrect_record').upsert(incUpserts, { onConflict: 'student_id, question_id' });
        }

        const cleanSourceTitle = (sourceTitle || '클리닉').replace(new RegExp(`^\\[${studentName}\\]\\s*`), '').trim();
        const title = `[${studentName}] ${cleanSourceTitle} 오답 프린트`;

        const { data: exMasters } = await supabaseAdmin.from('exam_master')
            .select('exam_id, created_at')
            .eq('title', title)
            .eq('exam_type', '오답프린트')
            .order('created_at', { ascending: false })
            .limit(10);

        let existingExamId: string | null = null;
        let merged = false;

        if (exMasters && exMasters.length > 0) {
            const todayStr = getKSTDateString();
            const validMasters = exMasters.filter((m: any) => {
                const createdAtKST = new Date(new Date(m.created_at).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
                return createdAtKST === todayStr;
            });

            if (validMasters.length > 0) {
                const examIds = validMasters.map((m: any) => m.exam_id);
                const { data: assignments } = await supabaseAdmin.from('exam_assignment')
                    .select('assignment_id, exam_id')
                    .eq('student_id', studentId)
                    .in('exam_id', examIds)
                    .eq('status', '미응시')
                    .limit(1);

                if (assignments && assignments.length > 0) {
                    existingExamId = assignments[0].exam_id;
                }
            }
        }

        if (existingExamId) {
            const { data: existingItems } = await supabaseAdmin.from('exam_item').select('question_id').eq('exam_id', existingExamId);
            const existingQIds = new Set((existingItems || []).map((item: any) => String(item.question_id)));
            const newQIds = uIds.filter(id => !existingQIds.has(String(id)));

            if (newQIds.length > 0) {
                const maxSortOrder = existingItems?.length || 0;
                const itemsToInsert = newQIds.map((qid, i) => ({
                    exam_id: existingExamId, question_id: String(qid), sort_order: maxSortOrder + i + 1, assigned_score: 0
                }));
                await supabaseAdmin.from('exam_item').insert(itemsToInsert);

                const newTotal = maxSortOrder + newQIds.length;
                await supabaseAdmin.from('exam_master').update({ total_questions: newTotal }).eq('exam_id', existingExamId);
                const newScore = Math.round((100 / newTotal) * 100) / 100;
                await supabaseAdmin.from('exam_item').update({ assigned_score: newScore }).eq('exam_id', existingExamId);
            }
            merged = true;
        }

        if (!merged) {
            const { data: clsRows } = await supabaseAdmin.from('enrollment').select('class_id, status, end_date, class(instructor_id, tenant_id)').eq('student_id', studentId);
            const cls = (clsRows || []).find((e: any) => !isEndedEnrollment(e)) || clsRows?.[0];
            const classData: any = Array.isArray(cls?.class) ? cls?.class[0] : cls?.class;
            let instId = classData?.instructor_id;
            const tenantId = classData?.tenant_id || null;
            const classId = cls?.class_id || null;

            if (!instId) {
                instId = await getFallbackInstructorId(supabaseAdmin);
            }
            if (!instId) return { success: false, error: '강사 정보를 찾을 수 없습니다.' };

            const { data: ex, error: exErr } = await supabaseAdmin.from('exam_master').insert({
                title,
                exam_type: '오답프린트',
                instructor_id: instId,
                total_questions: uIds.length,
                tenant_id: tenantId
            }).select().single();

            if (exErr || !ex) {
                throw new Error(exErr?.message || '오답프린트 exam_master 생성 실패');
            }

            const items = uIds.map((qid, i) => ({
                exam_id: ex.exam_id,
                question_id: String(qid),
                sort_order: i + 1,
                assigned_score: Math.round((100 / uIds.length) * 100) / 100
            }));
            await supabaseAdmin.from('exam_item').insert(items);
            await supabaseAdmin.from('exam_assignment').insert({
                exam_id: ex.exam_id,
                student_id: studentId,
                class_id: classId,
                status: '미응시',
                tenant_id: tenantId
            });
        }

        return { success: true };
    } catch (e: any) {
        console.error('generateIncorrectPrintServerAction 오류:', e);
        return { success: false, error: e?.message };
    }
}

// 🌟 [신규] 클리닉 뷰어(학생 화면)에서 미완료 프린트 생성/병합 (Service Role Key로 exam_master RLS 위반 원천 차단)
export async function generateOverduePrintServerAction(params: {
    studentId: string;
    studentName: string;
    uIds: (number | string)[];
    sourceTitle: string;
}) {
    const supabaseAdmin = getAdminClient();
    const { studentId, studentName, uIds: rawIds, sourceTitle } = params;
    const uIds = Array.from(new Set((rawIds || []).filter(Boolean).map(String)));
    if (uIds.length === 0) return { success: true };

    try {
        const cleanSourceTitle = (sourceTitle || '클리닉').replace(new RegExp(`^\\[${studentName}\\]\\s*`), '').trim();
        const title = `[${studentName}] ${cleanSourceTitle} 미완료 프린트`;

        const { data: exMasters } = await supabaseAdmin.from('exam_master')
            .select('exam_id, created_at')
            .eq('title', title)
            .eq('exam_type', '미완료과제')
            .order('created_at', { ascending: false })
            .limit(10);

        let existingExamId: string | null = null;
        let merged = false;

        if (exMasters && exMasters.length > 0) {
            const todayStr = getKSTDateString();
            const validMasters = exMasters.filter((m: any) => {
                const createdAtKST = new Date(new Date(m.created_at).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
                return createdAtKST === todayStr;
            });

            if (validMasters.length > 0) {
                const examIds = validMasters.map((m: any) => m.exam_id);
                const { data: assignments } = await supabaseAdmin.from('exam_assignment')
                    .select('assignment_id, exam_id')
                    .eq('student_id', studentId)
                    .in('exam_id', examIds)
                    .eq('status', '미응시')
                    .limit(1);

                if (assignments && assignments.length > 0) {
                    existingExamId = assignments[0].exam_id;
                }
            }
        }

        if (existingExamId) {
            const { data: existingItems } = await supabaseAdmin.from('exam_item').select('question_id').eq('exam_id', existingExamId);
            const existingQIds = new Set((existingItems || []).map((item: any) => String(item.question_id)));
            const newQIds = uIds.filter(id => !existingQIds.has(String(id)));

            if (newQIds.length > 0) {
                const maxSortOrder = existingItems?.length || 0;
                const itemsToInsert = newQIds.map((qid, i) => ({
                    exam_id: existingExamId, question_id: String(qid), sort_order: maxSortOrder + i + 1, assigned_score: 0
                }));
                await supabaseAdmin.from('exam_item').insert(itemsToInsert);

                const newTotal = maxSortOrder + newQIds.length;
                await supabaseAdmin.from('exam_master').update({ total_questions: newTotal }).eq('exam_id', existingExamId);
                const newScore = Math.round((100 / newTotal) * 100) / 100;
                await supabaseAdmin.from('exam_item').update({ assigned_score: newScore }).eq('exam_id', existingExamId);
            }
            merged = true;
        }

        if (!merged) {
            const { data: clsRows } = await supabaseAdmin.from('enrollment').select('class_id, status, end_date, class(instructor_id, tenant_id)').eq('student_id', studentId);
            const cls = (clsRows || []).find((e: any) => !isEndedEnrollment(e)) || clsRows?.[0];
            const classData: any = Array.isArray(cls?.class) ? cls?.class[0] : cls?.class;
            let instId = classData?.instructor_id;
            const tenantId = classData?.tenant_id || null;
            const classId = cls?.class_id || null;

            if (!instId) {
                instId = await getFallbackInstructorId(supabaseAdmin);
            }
            if (!instId) return { success: false, error: '강사 정보를 찾을 수 없습니다.' };

            const { data: ex, error: exErr } = await supabaseAdmin.from('exam_master').insert({
                title,
                exam_type: '미완료과제',
                instructor_id: instId,
                total_questions: uIds.length,
                tenant_id: tenantId
            }).select().single();

            if (exErr || !ex) {
                throw new Error(exErr?.message || '미완료과제 exam_master 생성 실패');
            }

            const items = uIds.map((qid, i) => ({
                exam_id: ex.exam_id,
                question_id: String(qid),
                sort_order: i + 1,
                assigned_score: Math.round((100 / uIds.length) * 100) / 100
            }));
            await supabaseAdmin.from('exam_item').insert(items);
            await supabaseAdmin.from('exam_assignment').insert({
                exam_id: ex.exam_id,
                student_id: studentId,
                status: '미응시',
                class_id: classId,
                tenant_id: tenantId
            });
        }

        return { success: true };
    } catch (e: any) {
        console.error('generateOverduePrintServerAction 오류:', e);
        return { success: false, error: e?.message };
    }
}

// 🌟 [신규] 클리닉 뷰어에서 기존 오답 프린트에 문항 추가 시 Service Role Key 사용
export async function appendToExistingIncorrectPrintAction(studentId: string, questionId: string | number) {
    if (!studentId || !questionId) return { success: false };
    const supabaseAdmin = getAdminClient();

    try {
        const { data: assignments } = await supabaseAdmin.from('exam_assignment')
            .select('assignment_id, exam_id, status, exam_master!inner(exam_type, total_questions)')
            .eq('student_id', studentId)
            .eq('exam_master.exam_type', '오답프린트')
            .not('status', 'in', '("제출완료", "채점완료", "완료")')
            .order('created_at', { ascending: false })
            .limit(1);

        if (assignments && assignments.length > 0) {
            const assign = assignments[0];
            const examId = assign.exam_id;
            const { data: existingItem } = await supabaseAdmin.from('exam_item')
                .select('question_id')
                .eq('exam_id', examId)
                .eq('question_id', String(questionId))
                .maybeSingle();

            if (!existingItem) {
                const { count } = await supabaseAdmin.from('exam_item')
                    .select('*', { count: 'exact', head: true })
                    .eq('exam_id', examId);
                const nextSortOrder = (count || 0) + 1;
                await supabaseAdmin.from('exam_item').insert({
                    exam_id: examId,
                    question_id: String(questionId),
                    sort_order: nextSortOrder
                });
                await supabaseAdmin.from('exam_master')
                    .update({ total_questions: nextSortOrder })
                    .eq('exam_id', examId);
            }
        }
        return { success: true };
    } catch (err: any) {
        console.error('appendToExistingIncorrectPrintAction 실패:', err);
        return { success: false, error: err?.message };
    }
}

// 🌟 [신규] 학습관리(/learning) 및 타임라인에서 오답유사 클리닉 문제지 생성 및 배부 (RLS 우회 보장)
export async function createClinicExamBundleAction(params: {
    title: string;
    subTitle: string;
    examType: string;
    instructorId?: string | null;
    tenantId?: string | null;
    layoutSettings?: any;
    questionIds: (string | number)[];
    studentId: string;
    classId?: string | null;
    createClinicTasks?: boolean;
}) {
    const supabaseAdmin = getAdminClient();
    const {
        title,
        subTitle,
        examType,
        instructorId,
        tenantId,
        layoutSettings,
        questionIds,
        studentId,
        classId,
        createClinicTasks = true
    } = params;

    try {
        let finalInstId = instructorId || null;
        if (!finalInstId) {
            finalInstId = await getFallbackInstructorId(supabaseAdmin);
        }

        const { data: masterData, error: mstErr } = await supabaseAdmin.from('exam_master').insert({
            title,
            sub_title: subTitle,
            exam_type: examType,
            total_questions: questionIds.length,
            instructor_id: finalInstId,
            tenant_id: tenantId || null,
            layout_settings: layoutSettings || {
                column: 2,
                split: 4,
                titleMode: 'all',
                template: 'basic1',
                numberColor: '#175b6a',
                titleColor: '#002864',
                lineColor: '#94a3b8'
            }
        }).select().single();

        if (mstErr || !masterData) {
            throw new Error(mstErr?.message || '시험지 마스터 생성 실패');
        }

        const newExamId = masterData.exam_id;
        const examItems = questionIds.map((qId, idx) => ({
            exam_id: newExamId,
            question_id: String(qId),
            sort_order: idx + 1
        }));

        for (let i = 0; i < examItems.length; i += 100) {
            const { error: itemsErr } = await supabaseAdmin.from('exam_item').insert(examItems.slice(i, i + 100));
            if (itemsErr) throw new Error(`문항 저장 실패: ${itemsErr.message}`);
        }

        const { error: assignErr } = await supabaseAdmin.from('exam_assignment').insert({
            exam_id: newExamId,
            student_id: studentId,
            class_id: classId || null,
            status: '미응시',
            tenant_id: tenantId || null
        });
        if (assignErr) throw new Error(`학생 배부 실패: ${assignErr.message}`);

        if (createClinicTasks) {
            const tasks = questionIds.map(qId => ({
                student_id: studentId,
                task_type: '유형오답클리닉',
                question_id: String(qId),
                status: '대기'
            }));
            for (let i = 0; i < tasks.length; i += 100) {
                await supabaseAdmin.from('clinic_task').insert(tasks.slice(i, i + 100));
            }
        }

        return { success: true, examId: newExamId };
    } catch (err: any) {
        console.error('createClinicExamBundleAction 실패:', err);
        return { success: false, error: err?.message };
    }
}

// 🌟 [신규] exam_master 필드 업데이트 서버 액션 (RLS 우회 보장)
export async function updateExamMasterFieldsAction(examId: string, fields: Record<string, any>) {
    if (!examId) return { success: false, error: 'examId가 없습니다.' };
    const supabaseAdmin = getAdminClient();
    try {
        const { error } = await supabaseAdmin.from('exam_master').update(fields).eq('exam_id', examId);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error('updateExamMasterFieldsAction 실패:', err);
        return { success: false, error: err?.message };
    }
}
// 🌟 [신규] 시험지 뷰어(/exam/viewer)에서 exam_master 생성/갱신 및 문항 저장 (RLS 우회 보장)
export async function saveExamViewerMasterAction(params: {
    targetExamIdToRebuild?: string | null;
    examId?: string | null;
    isRebuildOrNew: boolean;
    masterPayload: Record<string, any>;
    preItems?: { question_id: any; sort_order: number; assigned_score: number | null }[];
}) {
    const supabaseAdmin = getAdminClient();
    const { targetExamIdToRebuild, examId, isRebuildOrNew, masterPayload, preItems = [] } = params;

    try {
        let finalExamId = examId || null;

        if (isRebuildOrNew) {
            if (targetExamIdToRebuild) {
                const { error: rebuildErr } = await supabaseAdmin
                    .from("exam_master")
                    .update(masterPayload)
                    .eq("exam_id", targetExamIdToRebuild);
                if (rebuildErr) throw new Error(`문제지 갱신 실패: ${rebuildErr.message}`);
                finalExamId = targetExamIdToRebuild;
                await supabaseAdmin.from("exam_item").delete().eq("exam_id", finalExamId);
            } else {
                const { data, error: insertErr } = await supabaseAdmin
                    .from("exam_master")
                    .insert(masterPayload)
                    .select()
                    .single();
                if (insertErr || !data) throw new Error(`새 문제지 생성 실패: ${insertErr?.message || "알 수 없는 오류"}`);
                finalExamId = data.exam_id;
            }

            if (preItems.length > 0 && finalExamId) {
                const items = preItems.map((it) => ({ ...it, exam_id: finalExamId }));
                for (let i = 0; i < items.length; i += 100) {
                    const { error: itemsErr } = await supabaseAdmin.from("exam_item").insert(items.slice(i, i + 100));
                    if (itemsErr) throw new Error(`문항 저장 실패: ${itemsErr.message}`);
                }
            }
        } else {
            if (!finalExamId) throw new Error("저장할 문제지 ID가 없습니다.");
            const { error: updateErr } = await supabaseAdmin
                .from("exam_master")
                .update(masterPayload)
                .eq("exam_id", finalExamId);
            if (updateErr) throw new Error(`레이아웃 설정 저장 실패: ${updateErr.message}`);
        }

        return { success: true, examId: finalExamId };
    } catch (err: any) {
        console.error("saveExamViewerMasterAction 실패:", err);
        return { success: false, error: err?.message };
    }
}
