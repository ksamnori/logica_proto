// src/app/(dashboard)/learning/types.ts
export interface StudentInfo {
  id: string;
  name: string;
  className: string;
  classId: string;
  allClassIds?: string[];
}

export interface ClassInfo {
  class_id: string;
  name: string;
  level_name: string;
  students: StudentInfo[];
}

export interface ViewState {
  type: 'ALL' | 'CLASS' | 'STUDENT';
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
}

// 🌟 'SIMILAR' 탭 추가
export type TabType = 'DASHBOARD' | 'EXAM' | 'HOMEWORK' | 'INCORRECT' | 'SIMILAR';