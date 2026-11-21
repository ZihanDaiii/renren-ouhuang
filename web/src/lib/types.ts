export type Question =
  | {
      id: string;
      type: "single";
      title: string;
      options: string[];
      required?: boolean;
      /** R7 甄别题：只有选了这些选项的人才能继续 */
      screenAccept?: number[];
    }
  | {
      id: string;
      type: "text";
      title: string;
      minChars?: number;
      required?: boolean;
    };

/** 系统自动插入的注意力检测题（R3） */
export type CheckQuestion = {
  id: string;
  type: "check";
  title: string;
  options: string[];
  target: number;
};

export type AnyQuestion = Question | CheckQuestion;

export type SurveyContent = {
  title: string;
  intro: string;
  author: string;
  questions: Question[];
};

export type PublicSurvey = SurveyContent & {
  id: number;
  publisher: string;
  token: string;
  tokenSymbol: string;
  tokenDecimals: number;
  totalPool: string;
  maxSlots: number;
  deadline: string;
  contract: string;
  createTx: string | null;
};

export type QcReason = {
  rule: "R1" | "R3" | "R4" | "R5" | "R7";
  title: string;
  detail: string;
  actual?: string;
  threshold?: string;
  questionId?: string;
};

export type ClaimResult = {
  net: string;
  base: string;
  lucky: string;
  index: number;
  txHash: string;
  confirmMs: number;
};
