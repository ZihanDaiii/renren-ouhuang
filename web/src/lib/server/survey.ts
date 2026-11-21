import "server-only";
import { createHash } from "crypto";
import { db, type SurveyRow, type ResponseRow } from "./db";
import type { PublicSurvey, Question } from "../types";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function getSurveyRow(id: number) {
  const { data, error } = await db().from("wj_surveys").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as SurveyRow | null;
}

export function toPublic(r: SurveyRow): PublicSurvey {
  return {
    id: Number(r.id),
    title: r.title,
    intro: r.intro || "",
    author: r.author || "",
    questions: r.questions as Question[],
    publisher: r.publisher,
    token: r.token,
    tokenSymbol: r.token_symbol,
    tokenDecimals: r.token_decimals,
    totalPool: r.total_pool,
    maxSlots: r.max_slots,
    deadline: r.deadline,
    contract: r.contract,
    createTx: r.create_tx,
  };
}

export async function claimedRows(surveyId: number) {
  const { data, error } = await db()
    .from("wj_responses")
    .select("respondent,net,base,lucky,claim_index,tx_hash,confirm_ms,updated_at,duration_ms")
    .eq("survey_id", surveyId)
    .eq("status", "claimed")
    .order("claim_index", { ascending: false });
  if (error) throw error;
  return (data || []) as Pick<ResponseRow, "respondent" | "net" | "base" | "lucky" | "claim_index" | "tx_hash" | "confirm_ms" | "updated_at" | "duration_ms">[];
}

export async function rejectedCount(surveyId: number) {
  const { count, error } = await db()
    .from("wj_responses")
    .select("id", { count: "exact", head: true })
    .eq("survey_id", surveyId)
    .in("status", ["rejected", "retry"]);
  if (error) throw error;
  return count || 0;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const fail = (message: string, status = 400) => json({ error: message }, status);
