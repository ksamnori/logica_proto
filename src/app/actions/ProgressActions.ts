// src/app/actions/progressActions.ts
// 중복 코드 제거: 모든 진도·과제 서버 액션은 src/app/actions/auth.ts 에서 단일 관리하며 하위 호환을 위해 재노출합니다.
export {
  applyProgressBatchAction,
  getProgressStatusMapAction,
  saveStudentStartPageAction,
  renameHomeworkAssignmentAction,
  deleteHomeworkAssignmentAction,
  forceCompleteHomeworkBatchAction,
  processExamViewerHomeworkAndAssignAction,
} from "./auth";