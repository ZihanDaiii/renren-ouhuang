import { keccak256, toBytes, toHex, type Hex } from "viem";
import { randomBytes } from "crypto";
import { db, type ResponseRow } from "@/lib/server/db";
import { fail, getSurveyRow, json } from "@/lib/server/survey";
import { relayClaim, signTicket } from "@/lib/server/chain";
import { buildFlow, runQc, QC_VERSION, type Answers } from "@/lib/qc";
import type { Question } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function friendlyChainError(e: unknown) {
  const m = String((e as Error)?.message || e);
  if (/Full/.test(m)) return "红包刚好被领完了，下次早点来";
  if (/Expired/.test(m)) return "问卷已经截止了";
  if (/SurveyClosed/.test(m)) return "发布者已经结束了这份问卷";
  if (/AlreadyClaimed/.test(m)) return "这个钱包已经领过了";
  if (/insufficient funds/i.test(m)) return "平台的 gas 钱包余额不足，请稍后再试";
  return "链上领取暂时失败，请稍后重试";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let respId: string | null = null;
  try {
    const { deviceId, answers } = (await req.json()) as { deviceId: string; answers: Answers };
    if (!deviceId || !answers || typeof answers !== "object") return fail("参数不完整");

    const survey = await getSurveyRow(Number(id));
    if (!survey) return fail("问卷不存在", 404);
    if (new Date(survey.deadline).getTime() < Date.now()) return fail("这份问卷已经截止了", 410);

    const { data } = await db().from("wj_responses").select("*").eq("survey_id", survey.id).eq("device_id", deviceId).maybeSingle();
    const resp = data as ResponseRow | null;
    if (!resp) return fail("请先点开始答题");
    respId = resp.id;
    if (resp.status === "claimed") return json({ status: "claimed", result: resp });
    if (resp.status === "claiming") return fail("正在领取中，请稍等", 409);
    if (resp.status === "rejected" || resp.status === "screened") return json({ status: resp.status, qc: resp.qc });

    // R1：同一个钱包在这份问卷里只能领一次（合约里也会再检查一次）
    const { count: dup } = await db()
      .from("wj_responses")
      .select("id", { count: "exact", head: true })
      .eq("survey_id", survey.id)
      .eq("respondent", resp.respondent)
      .eq("status", "claimed");
    if ((dup || 0) > 0) return fail("这个钱包已经领过了");

    const flow = buildFlow(survey.questions as Question[], deviceId);
    const now = new Date();
    const durationMs = now.getTime() - new Date(resp.started_at).getTime();
    const qc = runQc(flow, answers, durationMs / 1000);
    const qcRecord = { version: QC_VERSION, reasons: qc.reasons, flags: qc.flags, minSec: qc.minSec, durationSec: Math.round(durationMs / 100) / 10 };

    if (qc.screened) {
      await db().from("wj_responses").update({ status: "screened", answers, qc: qcRecord, submitted_at: now.toISOString(), duration_ms: durationMs, updated_at: now.toISOString() }).eq("id", resp.id);
      return json({ status: "screened" });
    }
    if (!qc.pass) {
      const canRetry = qc.retryable && resp.retry_count === 0;
      await db()
        .from("wj_responses")
        .update({
          status: canRetry ? "retry" : "rejected",
          retry_count: resp.status === "retry" ? resp.retry_count + 1 : resp.retry_count,
          answers,
          qc: qcRecord,
          submitted_at: now.toISOString(),
          duration_ms: durationMs,
          updated_at: now.toISOString(),
        })
        .eq("id", resp.id);
      return json({ status: canRetry ? "retry" : "rejected", qc: qcRecord });
    }

    // 质检通过 → 签发领取凭证 → 平台中继代付 gas 提交
    const answerHash = keccak256(toBytes(JSON.stringify({ surveyId: survey.id, deviceId, answers })));
    const seed = toHex(randomBytes(32));
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 600);
    const respondent = resp.respondent as Hex;
    await db()
      .from("wj_responses")
      .update({ status: "claiming", answers, qc: qcRecord, answer_hash: answerHash, seed, submitted_at: now.toISOString(), duration_ms: durationMs, updated_at: now.toISOString() })
      .eq("id", resp.id);

    const signature = await signTicket({ surveyId: BigInt(survey.id), respondent, answerHash, seed, expiry });
    try {
      const r = await relayClaim({ surveyId: BigInt(survey.id), respondent, answerHash, seed, expiry, signature });
      await db()
        .from("wj_responses")
        .update({ status: "claimed", base: r.base, lucky: r.lucky, net: r.net, claim_index: r.index, tx_hash: r.txHash, confirm_ms: r.confirmMs, updated_at: new Date().toISOString() })
        .eq("id", resp.id);
      return json({ status: "claimed", result: { ...r, durationSec: qcRecord.durationSec } });
    } catch (e) {
      console.error(e);
      const msg = friendlyChainError(e);
      await db()
        .from("wj_responses")
        .update({ status: "claim_failed", qc: { ...qcRecord, error: msg }, updated_at: new Date().toISOString() })
        .eq("id", resp.id);
      return json({ status: "claim_failed", error: msg });
    }
  } catch (e) {
    console.error(e);
    if (respId) await db().from("wj_responses").update({ status: "claim_failed", updated_at: new Date().toISOString() }).eq("id", respId).eq("status", "claiming");
    return fail(String((e as Error).message || e), 500);
  }
}
