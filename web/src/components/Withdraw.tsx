"use client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { getBurner } from "@/lib/burner";
import { fmtAmount, short, txUrl } from "@/lib/chain";
import { addressProblem, quoteWithdraw, withdrawAll } from "@/lib/withdraw";

type Step = "idle" | "form" | "confirm" | "sending" | "done";

/** 提现到自己的钱包：余额、地址输入、二次确认、结果 */
export function Withdraw({ compact = false }: { compact?: boolean }) {
  const [addr, setAddr] = useState<`0x${string}` | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [amount, setAmount] = useState<bigint>(0n);
  const [step, setStep] = useState<Step>(compact ? "idle" : "form");
  const [to, setTo] = useState("");
  const [err, setErr] = useState("");
  const [tx, setTx] = useState<{ hash: string; amount: bigint } | null>(null);

  const refresh = useCallback(async (a: `0x${string}`) => {
    try {
      const q = await quoteWithdraw(a);
      setBalance(q.balance);
      setAmount(q.amount);
    } catch {
      setErr("读取余额失败，请检查网络后重试");
    }
  }, []);

  useEffect(() => {
    const b = getBurner();
    setAddr(b.address);
    refresh(b.address);
  }, [refresh]);

  const problem = to ? addressProblem(to, addr || undefined) : null;

  async function send() {
    setErr("");
    setStep("sending");
    try {
      const r = await withdrawAll(getBurner().pk, to);
      setTx(r);
      setStep("done");
      if (addr) refresh(addr);
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : "提现失败，请重试");
      setStep("form");
    }
  }

  const bal = balance === null ? "…" : fmtAmount(balance, 18, 4);

  if (step === "done" && tx)
    return (
      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><Icon name="check" />已提现 <span className="num">{fmtAmount(tx.amount, 18, 4)}</span> MON</div>
        <div className="fine" style={{ textAlign: "left" }}>到账钱包 <span className="num">{short(to.trim(), 6, 4)}</span></div>
        <a className="txline" href={txUrl(tx.hash)} target="_blank" rel="noreferrer"><Icon name="ext" />链上记录 <span className="num">{short(tx.hash, 8, 6)}</span></a>
      </div>
    );

  if (step === "idle")
    return (
      <button className="btn btn-ghost" style={{ marginTop: 10 }} disabled={!amount} onClick={() => setStep("form")}>
        <Icon name="wallet" />提现到我的钱包（余额 <span className="num">{bal}</span> MON）
      </button>
    );

  return (
    <div className="card" style={{ padding: 16, marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <b style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon name="wallet" />提现到我的钱包</b>
        <span className="fine" style={{ margin: 0 }}>余额 <span className="num">{bal}</span> MON</span>
      </div>

      {step === "confirm" ? (
        <>
          <p className="p-sub" style={{ marginBottom: 8 }}>确认转到这个地址？转错了无法找回。</p>
          <div className="card" style={{ padding: 12, fontFamily: "var(--mono)", fontSize: 13, wordBreak: "break-all", marginBottom: 6 }}>
            <b style={{ fontSize: 16 }}>{to.trim().slice(0, 6)}</b>{to.trim().slice(6, -4)}<b style={{ fontSize: 16 }}>{to.trim().slice(-4)}</b>
          </div>
          <div className="fine" style={{ textAlign: "left", marginBottom: 10 }}>
            到账约 <span className="num">{fmtAmount(amount, 18, 4)}</span> MON（手续费从余额里扣，约 <span className="num">{balance !== null ? fmtAmount(balance - amount, 18, 4) : "…"}</span>）
          </div>
          <div className="two">
            <button className="btn btn-ghost" onClick={() => setStep("form")}>返回修改</button>
            <button className="btn btn-red" onClick={send}>确认提现</button>
          </div>
        </>
      ) : (
        <>
          <div className="inp">
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="粘贴你的钱包地址 0x…" autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={step === "sending"} />
          </div>
          {problem && <div className="err">{problem}</div>}
          {err && <div className="err">{err}</div>}
          <button className="btn btn-red" style={{ marginTop: 10 }} disabled={!to || !!problem || !amount || step === "sending"} onClick={() => setStep("confirm")}>
            {step === "sending" ? (<><span className="spinner" />提现中…</>) : !amount && balance !== null ? "余额不足以支付手续费" : "下一步"}
          </button>
          <div className="fine">从 MetaMask 等钱包里复制你的地址，选 Monad 测试网就能看到到账</div>
        </>
      )}
    </div>
  );
}
