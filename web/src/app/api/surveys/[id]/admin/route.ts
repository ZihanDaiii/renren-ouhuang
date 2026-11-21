import { db, type ResponseRow } from "@/lib/server/db";
import { fail, getSurveyRow, json, sha256, toPublic } from "@/lib/server/survey";
import { readSurvey } from "@/lib/server/chain";
import { nick } from "@/lib/chain";

export const runtime = "nodejs";

/** 发布者后台：凭创建时生成的管理密钥查看全部答卷 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const token = new URL(req.url).searchParams.get("token") || "";
    const row = await getSurveyRow(Number(id));
    if (!row) return fail("问卷不存在", 404);
    if (sha256(token) !== row.admin_hash) return fail("管理密钥不对", 403);

    const { data, error } = await db().from("wj_responses").select("*").eq("survey_id", row.id).order("updated_at", { ascending: false });
    if (error) throw error;
    const rows = (data || []) as ResponseRow[];
    const onchain = await readSurvey(BigInt(row.id)).catch(() => null);

    return json({
      survey: toPublic(row),
      onchain: onchain && {
        claimed: Number(onchain.claimed),
        closed: onchain.closed,
        remaining: (BigInt(onchain.basePerSlot) * BigInt(onchain.maxSlots - onchain.claimed) + BigInt(onchain.luckyRemaining)).toString(),
      },
      responses: rows
        .filter((r) => r.status !== "started")
        .map((r) => ({
          id: r.id,
          nick: nick(r.respondent),
          respondent: r.respondent,
          status: r.status,
          submittedAt: r.submitted_at,
          durationSec: r.duration_ms ? Math.round(r.duration_ms / 100) / 10 : null,
          qc: r.qc,
          answers: r.answers,
          net: r.net,
          txHash: r.tx_hash,
        })),
      started: rows.length,
    });
  } catch (e) {
    console.error(e);
    return fail(String((e as Error).message || e), 500);
  }
}
