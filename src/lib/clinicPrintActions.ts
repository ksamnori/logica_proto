import { SupabaseClient } from '@supabase/supabase-js';
import {
    generateIncorrectPrintServerAction,
    generateOverduePrintServerAction
} from '@/app/actions/clinicActions';

export const generateIncorrectPrint = async (
    _supabaseClient: SupabaseClient,
    studentInfo: { id: string; name: string },
    incQIds: number[],
    sourceTitle: string,
    syncIncorrectRecord: boolean = true,
    statusMap?: Record<number, string>
) => {
    const uIds = [...new Set(incQIds)];
    if (uIds.length === 0 || !studentInfo?.id) return;

    await generateIncorrectPrintServerAction({
        studentId: studentInfo.id,
        studentName: studentInfo.name,
        incQIds: uIds,
        sourceTitle,
        syncIncorrectRecord,
        statusMap
    });
};

export const generateOverduePrint = async (
    _supabaseClient: SupabaseClient,
    studentInfo: { id: string; name: string },
    uIds: number[],
    sourceTitle: string
) => {
    const uniqueIds = [...new Set(uIds)];
    if (uniqueIds.length === 0 || !studentInfo?.id) return;

    await generateOverduePrintServerAction({
        studentId: studentInfo.id,
        studentName: studentInfo.name,
        uIds: uniqueIds,
        sourceTitle
    });
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
    if (incorrectQIds.length > 0 && !(params.round === 2 && params.overdue)) {
        await generateIncorrectPrint(supabaseClient, studentInfo, incorrectQIds, globalExamTitle, isTimedRound, statusMap);
    }

    if (unansweredQIds.length > 0) {
        await generateOverduePrint(supabaseClient, studentInfo, unansweredQIds, globalExamTitle);
    }

    if (params.round === 2 || unansweredQIds.length > 0) {
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