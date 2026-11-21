import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** 只在服务端使用：用 Supabase 的 service key 访问开启了 RLS 的表 */
export function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error("缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

export type SurveyRow = {
  id: number;
  chain_id: number;
  contract: string;
  publisher: string;
  token: string;
  token_symbol: string;
  token_decimals: number;
  title: string;
  intro: string | null;
  author: string | null;
  questions: unknown;
  total_pool: string;
  max_slots: number;
  deadline: string;
  meta_hash: string | null;
  admin_hash: string;
  create_tx: string | null;
  created_at: string;
};

export type ResponseRow = {
  id: string;
  survey_id: number;
  device_id: string;
  respondent: string;
  status: "started" | "rejected" | "retry" | "screened" | "claiming" | "claimed" | "claim_failed";
  started_at: string;
  submitted_at: string | null;
  duration_ms: number | null;
  answers: Record<string, number | string> | null;
  qc: { reasons?: unknown[]; flags?: string[]; minSec?: number; error?: string } | null;
  retry_count: number;
  answer_hash: string | null;
  seed: string | null;
  base: string | null;
  lucky: string | null;
  net: string | null;
  claim_index: number | null;
  tx_hash: string | null;
  confirm_ms: number | null;
  updated_at: string;
};
