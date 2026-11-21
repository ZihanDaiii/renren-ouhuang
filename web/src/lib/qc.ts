import type { AnyQuestion, CheckQuestion, Question, QcReason } from "./types";

/**
 * 平台统一质检规则 qc-v1（详见 docs/07-质检规则与填写体验设计.md）
 * 每条规则都是确定的计算：同样的答卷，谁来算结果都一样。
 */
export const QC_VERSION = "qc-v1";
export const READ_CHARS_PER_SEC = 15;
export const TAP_SEC = 1;
export const TEXT_SEC_PER_CHAR = 0.5;

const COLORS = ["红色", "蓝色", "绿色", "黄色"];

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** R3：每 10 题插 1 道检测题，至少 1 道，放在问卷 40%–70% 的位置。按设备 ID 确定，刷新不会变。 */
export function buildFlow(questions: Question[], seedKey: string): AnyQuestion[] {
  const k = Math.max(1, Math.floor(questions.length / 10));
  const flow: AnyQuestion[] = [...questions];
  for (let i = 0; i < k; i++) {
    const h = hashStr(`${seedKey}:${i}`);
    const target = h % 4;
    const check: CheckQuestion = {
      id: `check-${i}`,
      type: "check",
      title: `这题不考知识，请直接选「${COLORS[target]}」`,
      options: COLORS,
      target,
    };
    const lo = Math.ceil(flow.length * 0.4);
    const hi = Math.max(lo, Math.floor(flow.length * 0.7));
    const pos = Math.min(flow.length, Math.max(1, lo + (h % (hi - lo + 1))));
    flow.splice(pos, 0, check);
  }
  return flow;
}

const len = (s: string) => Array.from(s).length;

/** R4：最少用时（秒） */
export function minSeconds(flow: AnyQuestion[]) {
  let t = 0;
  for (const q of flow) {
    const chars = len(q.title) + (q.type === "text" ? 0 : q.options.reduce((a, o) => a + len(o), 0));
    t += TAP_SEC + chars / READ_CHARS_PER_SEC;
    if (q.type === "text") t += (q.minChars ?? 2) * TEXT_SEC_PER_CHAR;
  }
  return Math.round(t * 10) / 10;
}

/** 每题的最少用时，用来在填写时做"慢一点"提醒（只提醒，不扣分） */
export function minSecondsFor(q: AnyQuestion) {
  return minSeconds([q]);
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];
function isKeyboardMash(s: string) {
  const runs = s.toLowerCase().match(/[a-z0-9]{5,}/g) || [];
  return runs.some((run) => {
    for (let i = 0; i + 4 <= run.length; i++) {
      const sub = run.slice(i, i + 4);
      if (KEY_ROWS.some((row) => row.includes(sub) || row.split("").reverse().join("").includes(sub))) return true;
    }
    return false;
  });
}

/** R5：填空有效性 */
export function textProblem(raw: string, minChars: number): string | null {
  const clean = (raw || "").replace(/[\s\p{P}\p{S}]/gu, "");
  if (len(clean) < minChars) return `去掉空格和标点后只有 ${len(clean)} 个字，至少需要 ${minChars} 个`;
  if (new Set(Array.from(clean)).size < 2) return "回答只有一种字符";
  if (isKeyboardMash(raw)) return "看起来像是键盘乱按";
  return null;
}

export type Answers = Record<string, number | string>;

export type QcOutcome = {
  pass: boolean;
  screened: boolean;
  reasons: QcReason[];
  flags: string[];
  minSec: number;
  durationSec: number;
  retryable: boolean;
};

export function runQc(flow: AnyQuestion[], answers: Answers, durationSec: number): QcOutcome {
  const reasons: QcReason[] = [];
  const flags: string[] = [];

  // R7 甄别
  for (const q of flow) {
    if (q.type === "single" && q.screenAccept?.length) {
      const a = answers[q.id];
      if (typeof a === "number" && !q.screenAccept.includes(a)) {
        return { pass: false, screened: true, reasons: [], flags, minSec: 0, durationSec, retryable: false };
      }
    }
  }

  // R3 检测题
  const checks = flow.filter((q): q is CheckQuestion => q.type === "check");
  const wrong = checks.filter((q) => answers[q.id] !== q.target).length;
  if ((checks.length === 1 && wrong >= 1) || (checks.length >= 2 && wrong >= 2)) {
    reasons.push({ rule: "R3", title: "认真度小测试没答对", detail: "检测题的题干里写明了该选哪一项。", actual: `答错 ${wrong} 道`, threshold: checks.length === 1 ? "不能答错" : "最多答错 1 道" });
  } else if (wrong === 1) flags.push("R3_warn");

  // R4 用时
  const minSec = minSeconds(flow);
  if (durationSec < minSec) {
    reasons.push({
      rule: "R4",
      title: "作答时间太短",
      detail: `最少用时按每秒读 ${READ_CHARS_PER_SEC} 个字计算，大约是正常阅读速度的 2 到 3 倍。`,
      actual: `${Math.round(durationSec)} 秒`,
      threshold: `${Math.ceil(minSec)} 秒`,
    });
  }

  // R5 填空
  for (const q of flow) {
    if (q.type !== "text") continue;
    const v = String(answers[q.id] ?? "");
    if (!v && q.required === false) continue;
    const p = textProblem(v, q.minChars ?? 2);
    if (p) reasons.push({ rule: "R5", title: `「${q.title.slice(0, 14)}」的回答不符合要求`, detail: p, questionId: q.id });
  }

  // R6 直线作答（只标记）
  let run = 0;
  let last = -1;
  for (const q of flow) {
    if (q.type !== "single") {
      run = 0;
      last = -1;
      continue;
    }
    const a = answers[q.id];
    if (typeof a === "number" && a === last) run++;
    else run = 1;
    last = typeof a === "number" ? a : -1;
    if (run >= 5 && !flags.includes("R6")) flags.push("R6");
  }

  const retryable = reasons.length > 0 && reasons.every((r) => r.rule === "R5");
  return { pass: reasons.length === 0, screened: false, reasons, flags, minSec, durationSec, retryable };
}
