"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { Icon } from "@/components/Icon";
import { abi } from "@/lib/abi";
import { CONTRACT, fmtAmount, monadTestnet, short, txUrl } from "@/lib/chain";
import type { PublicSurvey, QcReason } from "@/lib/types";
import "./admin.css";

type Resp = {
  id: string;
  nick: string;
  respondent: string;
  status: string;
  submittedAt: string | null;
  durationSec: number | null;
  qc: { reasons?: QcReason[]; flags?: string[]; error?: string } | null;
  answers: Record<string, number | string> | null;
  net: string | null;
  txHash: string | null;
};
type Data = { survey: PublicSurvey; onchain: { claimed: number; closed: boolean; remaining: string } | null; responses: Resp[]; started: number };

function statusTag(r: Resp) {
  if (r.status === "claimed") return r.qc?.flags?.includes("R6") ? <span className="st flag">R6 标记</span> : <span className="st ok">通过</span>;
  if (r.status === "rejected" || r.status === "retry") {
    const rule = r.qc?.reasons?.[0];
    const label: Record<string, string> = { R3: "检测题", R4: "太快", R5: "填空无效", R1: "重复" };
    return <span className="st no">{rule ? `${rule.rule} ${label[rule.rule] || ""}` : "未通过"}{r.status === "retry" ? " · 可重交" : ""}</span>;
  }
  if (r.status === "screened") return <span className="st mid">甄别结束</span>;
  if (r.status === "claim_failed") return <span className="st no">领取失败</span>;
  return <span className="st mid">领取中</span>;
}

export default function AdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sp = useSearchParams();
  const [token, setToken] = useState("");
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let t = sp.get("token") || "";
    if (!t) {
      try {
        t = localStorage.getItem(`wj_admin_${id}`) || "";
      } catch {}
    }
    setToken(t);
  }, [sp, id]);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/surveys/${id}/admin?token=${token}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) setErr(j.error || "加载失败");
    else setD(j);
  }, [id, token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  async function refund() {
    if (!window.ethereum) return setErr("请在装了 MetaMask 的浏览器里操作");
    if (!confirm("结束问卷并把没发完的奖金全部退回你的钱包？结束后其他人就不能再领了。")) return;
    try {
      setBusy("请在钱包里确认…");
      const wallet = createWalletClient({ chain: monadTestnet, transport: custom(window.ethereum) });
      const [addr] = await wallet.requestAddresses();
      await wallet.switchChain({ id: monadTestnet.id }).catch(() => {});
      const hash = await wallet.writeContract({ account: addr, address: CONTRACT, abi, functionName: "refund", args: [BigInt(id)] });
      setBusy("等待链上确认…");
      await createPublicClient({ chain: monadTestnet, transport: http() }).waitForTransactionReceipt({ hash });
      await load();
    } catch (e) {
      const m = (e as Error).message || "";
      setErr(/NotPublisher/.test(m) ? "只有发布这份问卷的钱包才能退款" : /User rejected|denied/i.test(m) ? "你取消了确认" : m.split("\n")[0]);
    } finally {
      setBusy("");
    }
  }

  function exportCsv() {
    if (!d) return;
    const qs = d.survey.questions;
    const head = ["时间", "钱包", "状态", "用时(秒)", ...qs.map((q) => q.title), "到手", "交易"];
    const rows = d.responses.map((r) => [
      r.submittedAt || "",
      r.respondent,
      r.status,
      r.durationSec ?? "",
      ...qs.map((q) => {
        const a = r.answers?.[q.id];
        return q.type === "single" && typeof a === "number" ? q.options[a] : a ?? "";
      }),
      r.net ? fmtAmount(r.net, d.survey.tokenDecimals, 4) : "",
      r.txHash || "",
    ]);
    const csv = [head, ...rows].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `问卷-${id}.csv`;
    a.click();
  }

  if (!token) return <div className="center">缺少管理密钥：请用发布成功页给的「管理后台」链接打开</div>;
  if (err && !d) return <div className="center">{err}</div>;
  if (!d) return <div className="center"><div className="spinner dark" /></div>;

  const s = d.survey;
  const dec = s.tokenDecimals;
  const claimed = d.responses.filter((r) => r.status === "claimed");
  const rejected = d.responses.filter((r) => r.status === "rejected" || r.status === "retry");
  const paid = claimed.reduce((a, r) => a + BigInt(r.net || "0"), 0n);
  const closed = d.onchain?.closed || new Date(s.deadline).getTime() < Date.now();
  const minsLeft = Math.max(0, Math.round((new Date(s.deadline).getTime() - Date.now()) / 60000));
  const byRule: Record<string, number> = {};
  rejected.forEach((r) => {
    const k = r.qc?.reasons?.[0]?.rule || "其他";
    byRule[k] = (byRule[k] || 0) + 1;
  });
  const total = claimed.length + rejected.length;

  return (
    <div className="admin">
      <aside className="side">
        <Link href="/" className="brand"><span className="logo" />人人都是欧皇</Link>
        <a className="on" href="#"><Icon name="dash" />总览</a>
        <Link href={`/live/${id}`} target="_blank"><Icon name="monitor" />开奖大屏</Link>
        <Link href={`/s/${id}`} target="_blank"><Icon name="file" />问卷页面</Link>
        <Link href="/rules"><Icon name="book" />平台规则</Link>
        <div className="wallet">发布者钱包<b>{short(s.publisher)}</b></div>
      </aside>
      <section className="amain">
        <div className="mhead">
          <div>
            <span className={`pill-live ${closed ? "off" : ""}`}>{d.onchain?.closed ? "已结束 · 奖金已退回" : closed ? "已截止" : `进行中 · 还剩 ${minsLeft} 分钟`}</span>
            <h2>{s.title}</h2>
          </div>
          <div className="acts">
            <button className="btn btn-ghost btn-sm" onClick={exportCsv}><Icon name="download" />导出 CSV</button>
            <button className="btn btn-ghost btn-sm" disabled={!!busy || d.onchain?.closed} onClick={refund}><Icon name="undo" />{busy || "结束并退回剩余奖金"}</button>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="kpis">
          <div className="card kpi hero-k"><div className="k">有效答卷</div><div className="v num">{claimed.length}<small>/ {s.maxSlots}</small></div></div>
          <div className="card kpi"><div className="k">质检拦截</div><div className="v num">{rejected.length}<small>份</small></div></div>
          <div className="card kpi"><div className="k">已发放（到手）</div><div className="v num">{fmtAmount(paid, dec, 3)}<small>{s.tokenSymbol}</small></div></div>
          <div className="card kpi"><div className="k">奖池剩余</div><div className="v num">{d.onchain ? fmtAmount(d.onchain.remaining, dec, 3) : "…"}<small>{s.tokenSymbol}</small></div></div>
        </div>
        <div className="grid2">
          <div className="card panel">
            <h4>答案统计</h4>
            <p className="ps">只统计通过质检的 {claimed.length} 份</p>
            {s.questions.map((q) => (
              <div className="qblock" key={q.id}>
                <div className="qt">{q.title}</div>
                {q.type === "single" ? (
                  (() => {
                    const counts = q.options.map((_, i) => claimed.filter((r) => r.answers?.[q.id] === i).length);
                    const max = Math.max(1, ...counts);
                    return q.options.map((o, i) => (
                      <div className={`hbar ${counts[i] === max && counts[i] > 0 ? "top" : ""}`} key={i}>
                        <span>{o}</span>
                        <div className="t"><span style={{ width: `${(counts[i] / max) * 100}%` }} /></div>
                        <span className="num">{counts[i]}</span>
                      </div>
                    ));
                  })()
                ) : (
                  <div className="texts">
                    {claimed.slice(0, 5).map((r) => (<div key={r.id}>{String(r.answers?.[q.id] ?? "")}</div>))}
                    {claimed.length === 0 && <div className="muted">还没有回答</div>}
                  </div>
                )}
              </div>
            ))}
            <div className="qblock">
              <div className="qt">质检结果（共 {total} 份提交，规则 qc-v1）</div>
              <div className="qcbar">
                {total > 0 && <span style={{ flex: claimed.length, background: "var(--green)" }} />}
                {Object.entries(byRule).map(([k, v], i) => (<span key={k} style={{ flex: v, background: ["#C77A0A", "#E9A23B", "#F3C77A"][i % 3] }} />))}
              </div>
              <div className="legend">
                <span><i style={{ background: "var(--green)" }} />通过 {claimed.length}</span>
                {Object.entries(byRule).map(([k, v], i) => (<span key={k}><i style={{ background: ["#C77A0A", "#E9A23B", "#F3C77A"][i % 3] }} />{k} {v}</span>))}
              </div>
            </div>
          </div>
          <div className="card panel">
            <h4>答卷</h4>
            <p className="ps">每一份的质检结果和到账记录都可以核对</p>
            <table className="t">
              <thead><tr><th>时间</th><th>钱包</th><th>用时</th><th>质检</th><th>到手</th><th>交易</th></tr></thead>
              <tbody>
                {d.responses.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{r.submittedAt ? new Date(r.submittedAt).toLocaleTimeString("zh-CN", { hour12: false }) : "—"}</td>
                    <td className="num">{r.nick}</td>
                    <td className="num">{r.durationSec ?? "—"}s</td>
                    <td>{statusTag(r)}</td>
                    <td className="num">{r.net ? fmtAmount(r.net, dec, 3) : "—"}</td>
                    <td>{r.txHash ? <a className="tx" href={txUrl(r.txHash)} target="_blank" rel="noreferrer">{short(r.txHash, 5, 3)}</a> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
                {d.responses.length === 0 && <tr><td colSpan={6} className="muted">还没有人提交</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
