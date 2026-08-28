import { SupabaseClient } from '@supabase/supabase-js';

const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

export const generateIncorrectPrint = async (
    supabaseClient: SupabaseClient,
    studentInfo: { id: string; name: string },
    incQIds: number[],
    sourceTitle: string,
    syncIncorrectRecord: boolean = true,
    statusMap?: Record<number, string>
) => {
    const uIds = [...new Set(incQIds)];
    if (uIds.length === 0) return;

    if (syncIncorrectRecord) {
        const incUpserts = uIds.map(qid => ({ student_id: studentInfo.id, question_id: qid, source_type: '시험지', status: statusMap?.[qid] || 'X', resolved_at: null }));
        await supabaseClient.from('student_incorrect_record').upsert(incUpserts, { onConflict: 'student_id, question_id' });
    }

    try {
        const cleanSourceTitle = sourceTitle.replace(new RegExp(`^\\[${studentInfo.name}\\]\\s*`), '').trim();
        const title = `[${studentInfo.name}] ${cleanSourceTitle} 오답 프린트`;

        const { data: exMasters } = await supabaseClient.from('exam_master')
            .select('exam_id, created_at')
            .eq('title', title)
            .eq('exam_type', '오답프린트')
            .order('created_at', { ascending: false })
            .limit(10);

        let existingExamId = null;
        let merged = false;

        if (exMasters && exMasters.length > 0) {
            const todayStr = getKSTDateString();
            const validMasters = exMasters.filter((m: any) => {
                const createdAtKST = new Date(new Date(m.created_at).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
                return createdAtKST === todayStr;
            });

            if (validMasters.length > 0) {
                const examIds = validMasters.map((m: any) => m.exam_id);
                const { data: assignments } = await supabaseClient.from('exam_assignment')
                    .select('assignment_id, exam_id')
                    .eq('student_id', studentInfo.id)
                    .in('exam_id', examIds)
                    .eq('status', '미응시')
                    .limit(1);

                if (assignments && assignments.length > 0) {
                    existingExamId = assignments[0].exam_id;
                }
            }
        }

        if (existingExamId) {
            const { data: existingItems } = await supabaseClient.from('exam_item').select('question_id').eq('exam_id', existingExamId);
            const existingQIds = new Set((existingItems || []).map((item: any) => item.question_id));
            const newQIds = uIds.filter(id => !existingQIds.has(id));

            if (newQIds.length > 0) {
                const maxSortOrder = existingItems?.length || 0;
                const itemsToInsert = newQIds.map((qid, i) => ({
                    exam_id: existingExamId, question_id: qid, sort_order: maxSortOrder + i + 1, assigned_score: 0
                }));
                await supabaseClient.from('exam_item').insert(itemsToInsert);

                const newTotal = maxSortOrder + newQIds.length;
                await supabaseClient.from('exam_master').update({ total_questions: newTotal }).eq('exam_id', existingExamId);
                const newScore = Math.round(100 / newTotal);
                await supabaseClient.from('exam_item').update({ assigned_score: newScore }).eq('exam_id', existingExamId);
            }
            merged = true;
        }

        if (!merged) {
            const { data: cls } = await supabaseClient.from('enrollment').select('class(instructor_id)').eq('student_id', studentInfo.id).limit(1).maybeSingle();
            let instId = cls?.class?.instructor_id;
            if (!instId) { const { data: fb } = await supabaseClient.from('instructor').select('instructor_id').limit(1).maybeSingle(); instId = fb?.instructor_id; }
            if (!instId) return;

            const { data: ex } = await supabaseClient.from('exam_master').insert({ title, exam_type: '오답프린트', instructor_id: instId, total_questions: uIds.length }).select().single();
            const items = uIds.map((qid, i) => ({ exam_id: ex.exam_id, question_id: qid, sort_order: i + 1, assigned_score: Math.round(100 / uIds.length) }));
            await supabaseClient.from('exam_item').insert(items);
            await supabaseClient.from('exam_assignment').insert({ exam_id: ex.exam_id, student_id: studentInfo.id, status: '미응시' });
        }
    } catch (e) {
        console.error('generateIncorrectPrint 오류:', e);
    }
};

export const generateOverduePrint = async (
    supabaseClient: SupabaseClient,
    studentInfo: { id: string; name: string },
    uIds: number[],
    sourceTitle: string
) => {
    if (uIds.length === 0) return;
    try {
        const cleanSourceTitle = sourceTitle.replace(new RegExp(`^\\[${studentInfo.name}\\]\\s*`), '').trim();
        const title = `[${studentInfo.name}] ${cleanSourceTitle} 미완료 프린트`;
        const { data: exMasters } = await supabaseClient.from('exam_master')
            .select('exam_id, created_at')
            .eq('title', title)
            .eq('exam_type', '미완료과제')
            .order('created_at', { ascending: false })
            .limit(10);

        let existingExamId = null;
        let merged = false;

        if (exMasters && exMasters.length > 0) {
            const todayStr = getKSTDateString();
            const validMasters = exMasters.filter((m: any) => {
                const createdAtKST = new Date(new Date(m.created_at).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
                return createdAtKST === todayStr;
            });

            if (validMasters.length > 0) {
                const examIds = validMasters.map((m: any) => m.exam_id);
                const { data: assignments } = await supabaseClient.from('exam_assignment')
                    .select('assignment_id, exam_id')
                    .eq('student_id', studentInfo.id)
                    .in('exam_id', examIds)
                    .eq('status', '미응시')
                    .limit(1);

                if (assignments && assignments.length > 0) {
                    existingExamId = assignments[0].exam_id;
                }
            }
        }

        if (existingExamId) {
            const { data: existingItems } = await supabaseClient.from('exam_item').select('question_id').eq('exam_id', existingExamId);
            const existingQIds = new Set((existingItems || []).map((item: any) => item.question_id));
            const newQIds = uIds.filter(id => !existingQIds.has(id));

            if (newQIds.length > 0) {
                const maxSortOrder = existingItems?.length || 0;
                const itemsToInsert = newQIds.map((qid, i) => ({
                    exam_id: existingExamId, question_id: qid, sort_order: maxSortOrder + i + 1, assigned_score: 0
                }));
                await supabaseClient.from('exam_item').insert(itemsToInsert);

                const newTotal = maxSortOrder + newQIds.length;
                await supabaseClient.from('exam_master').update({ total_questions: newTotal }).eq('exam_id', existingExamId);
                const newScore = Math.round(100 / newTotal);
                await supabaseClient.from('exam_item').update({ assigned_score: newScore }).eq('exam_id', existingExamId);
            }
            merged = true;
        }

        if (!merged) {
            const { data: cls } = await supabaseClient.from('enrollment').select('class(instructor_id)').eq('student_id', studentInfo.id).limit(1).maybeSingle();
            let instId = cls?.class?.instructor_id;
            if (!instId) { const { data: fb } = await supabaseClient.from('instructor').select('instructor_id').limit(1).maybeSingle(); instId = fb?.instructor_id; }
            if (!instId) return;

            const { data: ex } = await supabaseClient.from('exam_master').insert({ title, exam_type: '미완료과제', instructor_id: instId, total_questions: uIds.length }).select().single();
            const items = uIds.map((qid, i) => ({ exam_id: ex.exam_id, question_id: qid, sort_order: i + 1, assigned_score: Math.round(100 / uIds.length) }));
            await supabaseClient.from('exam_item').insert(items);
            await supabaseClient.from('exam_assignment').insert({ exam_id: ex.exam_id, student_id: studentInfo.id, status: '미응시' });
        }
    } catch (e) {
        console.error('generateOverduePrint 오류:', e);
    }
};

export const finalizeSessionData = async (
    supabaseClient: SupabaseClient,
    studentInfo: { id: string; name: string },
    params: { round: number; overdue: boolean },
    globalExamTitle: string,
    isTimedRound: boolean,
    incorrectQIds: number[],
    unansweredQIds: number[],
    statusMap: Record<number, string>,
    questions: any[]
) => {
    // 1) 틀린 문제는 오답 프린트로 병합
    if (incorrectQIds.length > 0 && !(params.round === 2 && params.overdue)) {
        await generateIncorrectPrint(supabaseClient, studentInfo, incorrectQIds, globalExamTitle, isTimedRound, statusMap);
    }

    // 2) 안 푼 문제는 신규 미완료 프린트로 생성
    if (unansweredQIds.length > 0 && params.round === 2) {
        await generateOverduePrint(supabaseClient, studentInfo, unansweredQIds, globalExamTitle);
    }

    // 3) 기존 과제는 '제출완료' 처리하여 털어냄
    if (params.round === 2) {
        const hwIdsProcessed = new Set<number>();
        const examAssignIdsProcessed = new Set<string>();
        questions.forEach(q => {
            if (q.homework_id) hwIdsProcessed.add(q.homework_id);
            if (q.examAssignmentId) examAssignIdsProcessed.add(q.examAssignmentId);
        });

        if (hwIdsProcessed.size > 0) {
            await supabaseClient.from('student_homework_result')
                .update({ status: '제출완료' })
                .eq('student_id', studentInfo.id)
                .in('homework_id', Array.from(hwIdsProcessed));
        }
        if (examAssignIdsProcessed.size > 0) {
            await supabaseClient.from('exam_assignment')
                .update({ status: '제출완료' })
                .eq('student_id', studentInfo.id)
                .in('assignment_id', Array.from(examAssignIdsProcessed));
        }
    }
};