// src/lib/hq/editorialTypes.ts

export type DifficultyKey = "최하" | "하" | "중" | "상" | "최상" | "미지정";

export type CompetencyName = "문제해결" | "추론" | "의사소통" | "연결" | "정보처리";

export interface EditorialCountFilter {
  includeDerived: boolean;
  includeSubTaxonomy: boolean;
  curriculum: "all" | "2022" | "2015";
}

export interface CategoryCompetencyInfo {
  primary: CompetencyName | null;
  secondary: CompetencyName | null;
  confidence: number | null;
  status: string | null;
  reason: string | null;
}

export interface CategoryNodeSummary {
  category_id: string;
  curriculum_version: string;
  depth1: string;
  depth2: string;
  depth3: string;
  depth4: string;
  depth5: string;
  depth6: string;
  depth7: string;
  count: number;
  directCount: number;
  itemCount: number;
  coveredItemCount: number;
  emptyItemCount: number;
  diff: Record<DifficultyKey, number>;
  competency: CategoryCompetencyInfo | null;
  prereqCount: number;
  followupCount: number;
}

export interface ThinkingNodeSummary {
  category_id: string;
  depth1: string;
  depth2: string;
  depth3: string;
  full_path: string;
  sort_order: number;
  count: number;
  diff: Record<DifficultyKey, number>;
}

export interface Depth8ItemSummary {
  item_id: string;
  category_id: string;
  depth8: string;
  depth6: string | null;
  type: string | null;
  count: number;
  diff: Record<DifficultyKey, number>;
}

export interface PrerequisiteEdgeDetail {
  mapping_id: number;
  source_category_id: string;
  linked_category_id: string;
  curriculum_version: string;
  depth1: string;
  depth2: string;
  depth3: string;
  depth4: string;
  depth5: string;
  depth6: string;
  depth7: string;
  reason: string;
  questionCount: number;
}

export interface EditorialGlobalStats {
  totalActiveQuestions: number;
  originalQuestions: number;
  derivedQuestions: number;
  thinkingMappedQuestions: number;
  totalCategories: number;
  coveredCategories: number;
  emptyCategories: number;
  totalItems: number;
  coveredItems: number;
  emptyItems: number;
  totalThinking: number;
  coveredThinking: number;
  topBooks: { name: string; count: number }[];
  cachedAt: number;
}

export interface EditorialBootstrapPayload {
  globalStats: EditorialGlobalStats;
  categories: CategoryNodeSummary[];
  thinkingCategories: ThinkingNodeSummary[];
}

export interface EditorialUnitDetailPayload {
  items: Depth8ItemSummary[];
  prerequisites: PrerequisiteEdgeDetail[];
  followups: PrerequisiteEdgeDetail[];
}

export interface EditorialQuestionCard {
  question_id: string;
  item_id: string | null;
  parent_question_id: string | null;
  book_name: string | null;
  source_book_name: string | null;
  pdf_source: string | null;
  final_printed_page: string | null;
  question_number: string | null;
  sub_num: number | null;
  sub_sub_num: number | null;
  problem_type: string | null;
  difficulty: string | null;
  solving_probability: number | null;
  cognitive_level: string | null;
  derivation_type: string | null;
  taxonomy_id: string | null;
  taxonomy_name: string | null;
  resolved_full_path: string | null;
  resolved_depth8: string | null;
  sub_taxonomy_id: string | null;
  sub_taxonomy_name: string | null;
  thk_taxonomy_id: string | null;
  thk_taxonomy_name: string | null;
  question: string | null;
  question_2: string | null;
  options: unknown;
  answer: string | null;
  step_1_concept: string | null;
  step_2_approach: string | null;
  step_3_process: string | null;
  step_4_conclusion: string | null;
  explanation: string | null;
  solution: string | null;
  image_url: string | null;
  image_2_url: string | null;
  answer_image_url: string | null;
  answer_image_2_url: string | null;
  is_human_verified: boolean | null;
  created_at: string | null;
}

export interface EditorialQuestionsPayload {
  total: number;
  page: number;
  pageSize: number;
  diffBreakdown: Record<DifficultyKey, number>;
  cogBreakdown: Record<string, number>;
  bookBreakdown: { name: string; count: number }[];
  questions: EditorialQuestionCard[];
}

export interface TargetHierarchyStep {
  depth: number;
  stageLabel: string;
  name: string;
  code?: string;
  questionCount: number;
}

export interface TargetSiblingItem {
  item_id: string;
  depth8: string;
  count: number;
  isTarget: boolean;
}

export interface TargetContextInfo {
  found: boolean;
  category_id: string | null;
  item_id: string | null;
  curriculum_version: string | null;
  full_path: string;
  hierarchy: TargetHierarchyStep[];
  siblingItems: TargetSiblingItem[];
  competency: CategoryCompetencyInfo | null;
  prerequisites: {
    category_id: string;
    label: string;
    reason: string;
    questionCount: number;
  }[];
  followups: {
    category_id: string;
    label: string;
    reason: string;
    questionCount: number;
  }[];
  thinkingInfo: {
    category_id: string;
    depth1: string;
    depth2: string;
    depth3: string;
    full_path: string;
    questionCount: number;
  } | null;
}

export interface AnalyzedCaptureProblem {
  temp_id: string;
  selectedForSave: boolean;
  question_number: string;
  sub_num: number;
  sub_sub_num: number;
  final_printed_page: string;
  question: string;
  taxonomy_id: string;
  taxonomy_name: string;
  category_id: string;
  candidate_2_id: string | null;
  candidate_2_name: string | null;
  thk_taxonomy_id: string | null;
  thk_taxonomy_name: string | null;
  difficulty: string;
  cognitive_level: string;
  problem_type: string;
  solving_probability: number;
  ai_reason: string;
  answer?: string;
  step_1_concept?: string;
  step_2_approach?: string;
  step_3_process?: string;
  step_4_conclusion?: string;
  targetContext: TargetContextInfo;
}
