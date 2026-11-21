import { claimedRows, fail, getSurveyRow, json, rejectedCount, toPublic } from "@/lib/server/survey";
import { nick } from "@/lib/chain";

export const runtime = "nodejs";

/** 公开信息 + 实时统计（封面页和开奖大屏共用） */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const row = await getSurveyRow(Number(id));
    if (!row) return fail("问卷不存在", 404);
    const claims = await claimedRows(row.id);
    const rejected = await rejectedCount(row.id);
    const pool = BigInt(row.total_pool);
    const base = (pool * 5000n) / 10000n / BigInt(row.max_slots);
    const paidGross = claims.reduce((a, c) => a + BigInt(c.base || "0") + BigInt(c.lucky || "0"), 0n);
    const best = claims.reduce<(typeof claims)[number] | null>(
      (b, c) => (!b || BigInt(c.base || "0") + BigInt(c.lucky || "0") > BigInt(b.base || "0") + BigInt(b.lucky || "0") ? c : b),
      null,
    );
    const avgNet = claims.length ? claims.reduce((a, c) => a + BigInt(c.net || "0"), 0n) / BigInt(claims.length) : 0n;
    const confirms = claims.map((c) => c.confirm_ms || 0).filter(Boolean);
    return json({
      survey: toPublic(row),
      stats: {
        claimed: claims.length,
        rejected,
        basePerSlot: base.toString(),
        // 拼手气部分上限：第一个人最多拿到 2 × 拼手气均值
        luckyMaxFirst: ((pool - base * BigInt(row.max_slots)) * 2n / BigInt(row.max_slots)).toString(),
        remaining: (pool - paidGross).toString(),
        avgNet: avgNet.toString(),
        avgConfirmMs: confirms.length ? Math.round(confirms.reduce((a, b) => a + b, 0) / confirms.length) : null,
        best: best ? { nick: nick(best.respondent), respondent: best.respondent, net: best.net, index: best.claim_index } : null,
        recent: claims.slice(0, 8).map((c) => ({
          nick: nick(c.respondent),
          respondent: c.respondent,
          net: c.net,
          index: c.claim_index,
          txHash: c.tx_hash,
          confirmMs: c.confirm_ms,
        })),
      },
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    console.error(e);
    return fail(String((e as Error).message || e), 500);
  }
}
