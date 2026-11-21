"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { createPublicClient, createWalletClient, custom, http, keccak256, parseEther, toBytes, type EIP1193Provider } from "viem";
import { Icon } from "@/components/Icon";
import { abi } from "@/lib/abi";
import { CONTRACT, NATIVE, addrUrl, monadTestnet, short } from "@/lib/chain";
import type { Question, SurveyContent } from "@/lib/types";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);
const DEFAULT_Q: Question[] = [
  { id: uid(), type: "single", title: "今天你最喜欢哪类项目？", options: ["DeFi", "游戏", "AI Agent", "社交", "工具"] },
  { id: uid(), type: "single", title: "如果填一份 3 分钟的问卷，你觉得给多少合适？", options: ["0.1 MON", "0.5 MON", "1 MON", "3 MON"] },
  { id: uid(), type: "text", title: "一句话评价今天的 Monad Blitz", minChars: 2 },
];
const DEADLINES = [
  { label: "1 小时", sec: 3600 },
  { label: "1 天", sec: 86400 },
  { label: "7 天", sec: 604800 },
];

/** 和合约同样的二倍均值法，用来在发布前预览每个人大概能拿到多少 */
function simulate(pool: number, n: number) {
  const base = (pool * 0.5) / n;
  let left = pool - base * n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const remain = n - i;
    const lucky = remain === 1 ? left : Math.random() * ((left * 2) / remain);
    left -= lucky;
    out.push((base + lucky) * 0.95);
  }
  return out;
}

export default function CreatePage() {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("Monad Blitz 广州现场小调研");
  const [author, setAuthor] = useState("");
  const [intro, setIntro] = useState("3 道题，帮我们了解今天大家的感受，认真填就能拆红包。");
  const [questions, setQuestions] = useState<Question[]>(DEFAULT_Q);
  const [pool, setPool] = useState("5");
  const [slots, setSlots] = useState("20");
  const [dl, setDl] = useState(0);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [done, setDone] = useState<{ id: number; adminToken: string; tx: string } | null>(null);
  const [qr, setQr] = useState("");

  const poolNum = parseFloat(pool) || 0;
  const slotNum = parseInt(slots) || 0;
  const sim = useMemo(() => (poolNum > 0 && slotNum > 0 && slotNum <= 200 ? simulate(poolNum, slotNum) : []), [poolNum, slotNum]);
  const maxSim = sim.length ? Math.max(...sim) : 0;
  const avgOk = slotNum > 0 && poolNum / slotNum >= 0.01;

  useEffect(() => {
    if (done) QRCode.toDataURL(`${location.origin}/s/${done.id}`, { margin: 1, width: 320, color: { dark: "#0A1640" } }).then(setQr);
  }, [done]);

  function updateQ(i: number, patch: Partial<Question>) {
    setQuestions((qs) => qs.map((q, j) => (j === i ? ({ ...q, ...patch } as Question) : q)));
  }

  async function connect() {
    if (!window.ethereum) throw new Error("没有检测到钱包，请在装了 MetaMask 的浏览器里打开");
    const wallet = createWalletClient({ chain: monadTestnet, transport: custom(window.ethereum) });
    const [addr] = await wallet.requestAddresses();
    try {
      await wallet.switchChain({ id: monadTestnet.id });
    } catch {
      await wallet.addChain({ chain: monadTestnet });
      await wallet.switchChain({ id: monadTestnet.id });
    }
    setAccount(addr);
    return { wallet, addr };
  }

  async function publish() {
    setErr("");
    try {
      setBusy("连接钱包…");
      const { wallet, addr } = await connect();
      const content: SurveyContent = {
        title: title.trim(),
        intro: intro.trim(),
        author: author.trim(),
        questions: questions.map((q) => (q.type === "single" ? { ...q, options: q.options.map((o) => o.trim()).filter(Boolean) } : q)),
      };
      const contentJson = JSON.stringify(content);
      const metaHash = keccak256(toBytes(contentJson));
      const value = parseEther(pool);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINES[dl].sec);
      setBusy("请在钱包里确认，锁定奖池…");
      const hash = await wallet.writeContract({
        account: addr,
        address: CONTRACT,
        abi,
        functionName: "createSurvey",
        args: [NATIVE, value, slotNum, deadline, metaHash],
        value,
      });
      setBusy("等待链上确认…");
      const pc = createPublicClient({ chain: monadTestnet, transport: http() });
      await pc.waitForTransactionReceipt({ hash, pollingInterval: 300 });
      setBusy("保存问卷…");
      const adminToken = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      const r = await fetch("/api/surveys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentJson, txHash: hash, adminToken }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "保存失败");
      try {
        localStorage.setItem(`wj_admin_${j.id}`, adminToken);
      } catch {}
      setDone({ id: j.id, adminToken, tx: hash });
    } catch (e) {
      const m = (e as Error).message || String(e);
      setErr(/User rejected|denied/i.test(m) ? "你取消了钱包确认" : m.split("\n")[0]);
    } finally {
      setBusy("");
    }
  }

  const valid1 = title.trim() && questions.length > 0 && questions.every((q) => q.title.trim() && (q.type === "text" || q.options.filter((o) => o.trim()).length >= 2));
  const valid2 = poolNum > 0 && slotNum >= 1 && slotNum <= 1000 && avgOk;

  /* ───────── 发布成功 ───────── */
  if (done) {
    const link = typeof window !== "undefined" ? `${location.origin}/s/${done.id}` : "";
    return (
      <main className="app">
        <div className="topbar"><Link href="/" className="iconbtn"><Icon name="x" /></Link><span className="chip"><span className="dot" />已上链</span></div>
        <div className="fail-ic ok"><Icon name="check" /></div>
        <h1 className="h-big">奖池已锁定，<br />可以发出去了</h1>
        <p className="p-sub">{pool} MON 已锁进合约，{slots} 个名额，{DEADLINES[dl].label}后截止</p>
        <div className="card" style={{ padding: 16, display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
          {qr ? <img src={qr} alt="问卷二维码" width={112} height={112} style={{ borderRadius: 12, border: "1px solid var(--line)" }} /> : <div style={{ width: 112, height: 112 }} />}
          <div style={{ minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 12 }}>问卷链接</div>
            <div className="num" style={{ fontSize: 13, margin: "4px 0 10px", wordBreak: "break-all" }}>{link}</div>
            <button className="chip" style={{ cursor: "pointer", background: "var(--blue-50)", color: "var(--blue-600)", borderColor: "var(--blue-100)" }} onClick={() => navigator.clipboard?.writeText(link)}><Icon name="copy" style={{ width: 13, height: 13 }} />复制链接</button>
          </div>
        </div>
        <div className="card split" style={{ marginTop: 0 }}>
          <Link className="row" href={`/live/${done.id}`} style={{ textDecoration: "none" }}><span><Icon name="monitor" style={{ color: "var(--blue)" }} />开奖大屏</span><Icon name="arrow" className="muted" /></Link>
          <Link className="row" href={`/admin/${done.id}?token=${done.adminToken}`} style={{ textDecoration: "none" }}><span><Icon name="dash" style={{ color: "var(--blue)" }} />管理后台</span><Icon name="arrow" className="muted" /></Link>
          <a className="row" href={addrUrl(CONTRACT)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><span><Icon name="ext" style={{ color: "var(--blue)" }} />合约上的这笔奖池</span><span className="num" style={{ fontSize: 12 }}>{short(CONTRACT)}</span></a>
        </div>
        <div className="same"><Icon name="lock" />管理后台的链接里带着管理密钥，请收藏好，不要发到群里。</div>
        <Link className="btn btn-blue" href={`/s/${done.id}`}><Icon name="share" />打开问卷</Link>
      </main>
    );
  }

  return (
    <main className="app">
      <div className="topbar">
        {step > 1 ? <button className="iconbtn" onClick={() => setStep(step - 1)}><Icon name="back" /></button> : <Link className="iconbtn" href="/"><Icon name="back" /></Link>}
        <b style={{ fontSize: 15 }}>发一份问卷红包</b>
        <span style={{ width: 36 }} />
      </div>
      <div className="steps">
        <div className={step > 1 ? "done" : "cur"}>编辑问卷</div>
        <div className={step > 2 ? "done" : step === 2 ? "cur" : ""}>设置红包</div>
        <div className={step === 3 ? "cur" : ""}>锁定并发布</div>
      </div>

      {step === 1 && (
        <>
          <div className="field"><label>问卷标题</label><div className="inp"><input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} /></div></div>
          <div className="two field">
            <div><label>你的称呼</label><div className="inp"><input value={author} maxLength={20} placeholder="林同学" onChange={(e) => setAuthor(e.target.value)} /></div></div>
            <div><label>题目数量</label><div className="inp"><span className="num" style={{ fontSize: 18, fontWeight: 600 }}>{questions.length}</span><span className="u">建议 3–8 道</span></div></div>
          </div>
          <div className="field"><label>一句话说明（会显示在封面）</label><div className="inp"><input value={intro} maxLength={120} onChange={(e) => setIntro(e.target.value)} /></div></div>
          {questions.map((q, i) => (
            <div className="card qedit" key={q.id}>
              <div className="qh"><span><span className="num" style={{ color: "var(--blue)", fontWeight: 600 }}>{String(i + 1).padStart(2, "0")}</span> · {q.type === "single" ? "单选" : "填空"}</span>
                <button className="xbtn" aria-label="删除这题" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}><Icon name="trash" style={{ width: 16, height: 16 }} /></button></div>
              <input className="line" value={q.title} placeholder="题目" onChange={(e) => updateQ(i, { title: e.target.value })} />
              {q.type === "single" ? (
                <>
                  {q.options.map((o, k) => (
                    <div className="optline" key={k}>
                      <span className="key">{String.fromCharCode(65 + k)}</span>
                      <input className="line" value={o} placeholder={`选项 ${k + 1}`} onChange={(e) => updateQ(i, { options: q.options.map((x, m) => (m === k ? e.target.value : x)) })} />
                      {q.options.length > 2 && <button className="xbtn" aria-label="删除选项" onClick={() => updateQ(i, { options: q.options.filter((_, m) => m !== k) })}><Icon name="x" style={{ width: 14, height: 14 }} /></button>}
                    </div>
                  ))}
                  {q.options.length < 6 && <button className="linkbtn" onClick={() => updateQ(i, { options: [...q.options, ""] })}>+ 加一个选项</button>}
                </>
              ) : (
                <div className="optline" style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>最少字数
                  <input className="line num" style={{ width: 60 }} type="number" min={1} max={50} value={q.minChars ?? 2} onChange={(e) => updateQ(i, { minChars: Math.max(1, Math.min(50, parseInt(e.target.value) || 1)) })} />
                </div>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            <button className="linkbtn" onClick={() => setQuestions((qs) => [...qs, { id: uid(), type: "single", title: "", options: ["", ""] }])}>+ 单选题</button>
            <button className="linkbtn" onClick={() => setQuestions((qs) => [...qs, { id: uid(), type: "text", title: "", minChars: 2 }])}>+ 填空题</button>
          </div>
          <div className="rulefix"><Icon name="shield" />系统会自动插入一道认真度小测试，质检规则由平台统一规定</div>
          <div className="grow" />
          <button className="btn btn-blue" disabled={!valid1} onClick={() => setStep(2)}>下一步：设置红包<Icon name="arrow" /></button>
        </>
      )}

      {step === 2 && (
        <>
          <div className="field"><label>总奖金</label><div className="inp"><input className="big" inputMode="decimal" value={pool} onChange={(e) => setPool(e.target.value.replace(/[^\d.]/g, ""))} /><span className="u">MON</span></div></div>
          <div className="two field">
            <div><label>名额</label><div className="inp"><input className="big" inputMode="numeric" value={slots} onChange={(e) => setSlots(e.target.value.replace(/\D/g, ""))} /><span className="u">个</span></div></div>
            <div><label>截止时间</label><div className="seg">{DEADLINES.map((d, i) => (<button key={i} className={dl === i ? "on" : ""} onClick={() => setDl(i)}>{d.label}</button>))}</div></div>
          </div>
          {sim.length > 0 && (
            <div className="card preview">
              <div className="ph"><span>预览：{slotNum} 个人大概能拿到</span><span>随机模拟</span></div>
              <div className="pv">
                <div>每人保底<b className="num">{((poolNum * 0.5 / slotNum) * 0.95).toFixed(3)}</b></div>
                <div>平均<b className="num">{((poolNum / slotNum) * 0.95).toFixed(3)}</b></div>
                <div>手气最佳<b className="num r">{maxSim.toFixed(3)}</b></div>
              </div>
              <div className="bars">{sim.map((v, i) => (<i key={i} className={v === maxSim ? "best" : ""} style={{ height: `${(v / maxSim) * 100}%` }} />))}</div>
            </div>
          )}
          {!avgOk && <div className="err">每个名额平均至少 0.01 MON</div>}
          <div className="rulefix"><Icon name="lock" />保底 + 拼手气是平台的固定规则，不能修改</div>
          <div className="grow" />
          <button className="btn btn-blue" disabled={!valid2} onClick={() => setStep(3)}>下一步：锁定奖池<Icon name="arrow" /></button>
        </>
      )}

      {step === 3 && (
        <>
          <div className="card split" style={{ marginTop: 0 }}>
            <div className="row"><span>问卷</span><b>{title}</b></div>
            <div className="row"><span>题目</span><b className="num">{questions.length} 道 + 1 道检测题</b></div>
            <div className="row"><span>奖池</span><b className="num">{pool} MON</b></div>
            <div className="row"><span>名额</span><b className="num">{slots} 个</b></div>
            <div className="row"><span>截止</span><b>{DEADLINES[dl].label}后</b></div>
          </div>
          <div className="same"><Icon name="wallet" />点下面的按钮后，钱包会请你确认一次，把奖金锁进 Monad 测试网上的合约。没发完的奖金随时可以在后台全额退回。</div>
          {account && <div className="fine">已连接 {short(account)}</div>}
          {err && <div className="err">{err}</div>}
          <div className="grow" />
          <button className="btn btn-blue" disabled={!!busy} onClick={publish}>{busy ? (<><span className="spinner" />{busy}</>) : (<><Icon name="lock" />连接钱包并锁定奖池</>)}</button>
          <div className="fine"><Link href="/rules">平台规则</Link></div>
        </>
      )}
    </main>
  );
}
