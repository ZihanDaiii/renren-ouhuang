import { keccak256, toBytes, type Hex } from "viem";
import { db } from "@/lib/server/db";
import { readCreated } from "@/lib/server/chain";
import { fail, json, sha256 } from "@/lib/server/survey";
import { CONTRACT, monadTestnet, NATIVE } from "@/lib/chain";
import type { SurveyContent } from "@/lib/types";

export const runtime = "nodejs";

/** 发布者在链上锁好奖池后，把问卷内容和交易哈希交上来；服务端核对链上事件后入库 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { contentJson: string; txHash: Hex; adminToken: string };
    if (!body.contentJson || !body.txHash || !body.adminToken || body.adminToken.length < 16) return fail("参数不完整");

    const content = JSON.parse(body.contentJson) as SurveyContent;
    if (!content.title?.trim() || !Array.isArray(content.questions) || content.questions.length === 0 || content.questions.length > 30)
      return fail("问卷内容不合法");

    const ev = await readCreated(body.txHash);
    const metaHash = keccak256(toBytes(body.contentJson));
    if (ev.metaHash.toLowerCase() !== metaHash.toLowerCase()) return fail("问卷内容和链上记录的哈希不一致");

    const id = Number(ev.surveyId);
    const { error } = await db().from("wj_surveys").upsert({
      id,
      chain_id: monadTestnet.id,
      contract: CONTRACT,
      publisher: ev.publisher,
      token: ev.token,
      token_symbol: ev.token === NATIVE ? "MON" : "USDC",
      token_decimals: ev.token === NATIVE ? 18 : 6,
      title: content.title.trim().slice(0, 60),
      intro: (content.intro || "").slice(0, 200),
      author: (content.author || "").slice(0, 20),
      questions: content.questions,
      total_pool: ev.totalPool.toString(),
      max_slots: Number(ev.maxSlots),
      deadline: new Date(Number(ev.deadline) * 1000).toISOString(),
      meta_hash: metaHash,
      admin_hash: sha256(body.adminToken),
      create_tx: body.txHash,
    });
    if (error) throw error;
    return json({ id });
  } catch (e) {
    console.error(e);
    return fail(String((e as Error).message || e), 500);
  }
}
