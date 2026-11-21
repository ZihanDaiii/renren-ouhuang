import { isAddress } from "viem";
import { db, type ResponseRow } from "@/lib/server/db";
import { fail, getSurveyRow, json } from "@/lib/server/survey";
import { buildFlow } from "@/lib/qc";
import type { Question } from "@/lib/types";

export const runtime = "nodejs";

/** 填写者点「开始」：服务端记录开始时间（用时以服务端为准，不信任前端），返回带检测题的完整题目顺序 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { deviceId, respondent } = (await req.json()) as { deviceId: string; respondent: string };
    if (!deviceId || deviceId.length < 8 || !isAddress(respondent)) return fail("参数不完整");

    const row = await getSurveyRow(Number(id));
    if (!row) return fail("问卷不存在", 404);
    if (new Date(row.deadline).getTime() < Date.now()) return fail("这份问卷已经截止了", 410);

    const flow = buildFlow(row.questions as Question[], deviceId);

    const { data: existing } = await db()
      .from("wj_responses")
      .select("*")
      .eq("survey_id", row.id)
      .eq("device_id", deviceId)
      .maybeSingle();
    const ex = existing as ResponseRow | null;

    if (ex && ["claimed", "rejected", "screened", "claiming"].includes(ex.status)) {
      return json({ status: ex.status, response: ex, flow });
    }
    if (ex && ex.status === "retry") {
      return json({ status: "retry", response: ex, flow });
    }
    if (ex) {
      // 已经开始过：重新开始计时
      await db().from("wj_responses").update({ started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", ex.id);
      return json({ status: "started", flow });
    }

    const { error } = await db().from("wj_responses").insert({ survey_id: row.id, device_id: deviceId, respondent: respondent.toLowerCase() });
    if (error) throw error;
    return json({ status: "started", flow });
  } catch (e) {
    console.error(e);
    return fail(String((e as Error).message || e), 500);
  }
}
