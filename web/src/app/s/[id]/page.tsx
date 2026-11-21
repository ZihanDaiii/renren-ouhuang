"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getBurner } from "@/lib/burner";
import { fmtAmount, nick, short, txUrl } from "@/lib/chain";
import { minSecondsFor, textProblem } from "@/lib/qc";
import type { AnyQuestion, PublicSurvey, QcReason } from "@/lib/types";

type Stats = {
  claimed: number;
  basePerSlot: string;
  luckyMaxFirst: string;
  avgNet: string;
  best: { nick: string; respondent: string; net: string; index: number } | null;
  recent: { nick: string; respondent: string; net: string; index: number }[];
};
type Result = { net: string; base: string; lucky: string; index: number; txHash: string; confirmMs: number; durationSec?: number };
type Qc = { reasons?: QcReason[]; minSec?: number; durationSec?: number; error?: string };
type Phase = "loading" | "cover" | "quiz" | "submitting" | "open" | "result" | "fail" | "retry" | "screened" | "error";

const NET = (x: bigint) => (x * 95n) / 100n; // 前端只展示到手净额
const REPLIES = ["收到", "好的，记下了", "了解", "收到，继续", "明白"];
const SWATCH = ["#E8323C", "#2350FF", "#0E9F6E", "#F4C46A"];

export default function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [phase, setPhase] = useState<Phase>("loading");
  const [survey, setSurvey] = useState<PublicSurvey | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [flow, setFlow] = useState<AnyQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [nudge, setNudge] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [qc, setQc] = useState<Qc | null>(null);
  const [err, setErr] = useState("");
  const [opened, setOpened] = useState(false);
  const shownAt = useRef(Date.now());
  const burner = useRef<ReturnType<typeof getBurner> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/surveys/${id}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "加载失败");
    setSurvey(j.survey);
    setStats(j.stats);
    return j;
  }, [id]);

  useEffect(() => {
    burner.current = getBurner();
    load()
      .then(() => setPhase("cover"))
      .catch((e) => {
        setErr(e.message);
        setPhase("error");
      });
  }, [load]);

  const dec = survey?.tokenDecimals ?? 18;
  const sym = survey?.tokenSymbol ?? "MON";
  const baseNet = stats ? NET(BigInt(stats.basePerSlot)) : 0n;
  const maxNet = stats ? NET(BigInt(stats.basePerSlot) + BigInt(stats.luckyMaxFirst)) : 0n;
  const left = survey && stats ? survey.maxSlots - stats.claimed : 0;
  const expired = survey ? new Date(survey.deadline).getTime() < Date.now() : false;

  async function start() {
    setErr("");
    const b = burner.current!;
    const r = await fetch(`/api/surveys/${id}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: b.deviceId, respondent: b.address }),
    });
    const j = await r.json();
    if (!r.ok) return setErr(j.error || "开始失败");
    setFlow(j.flow);
    if (j.status === "claimed") {
      const x = j.response;
      setResult({ net: x.net, base: x.base, lucky: x.lucky, index: x.claim_index, txHash: x.tx_hash, confirmMs: x.confirm_ms });
      setOpened(true);
      return setPhase("result");
    }
    if (j.status === "rejected") {
      setQc(j.response.qc);
      return setPhase("fail");
    }
    if (j.status === "screened") return setPhase("screened");
    if (j.status === "retry") {
      setQc(j.response.qc);
      setAnswers(j.response.answers || {});
      return setPhase("retry");
    }
    setIdx(0);
    shownAt.current = Date.now();
    setPhase("quiz");
  }

  const q = flow[idx];
  const isLast = idx === flow.length - 1;

  function next() {
    // 过快提醒：这一题用时低于这题的最少用时，下一屏顶部提示（只提醒，不扣分）
    const spent = (Date.now() - shownAt.current) / 1000;
    setNudge(q ? spent < minSecondsFor(q) : false);
    setToast(null);
    shownAt.current = Date.now();
    setIdx((i) => Math.min(i + 1, flow.length - 1));
  }

  function choose(qid: string, v: number) {
    setAnswers((a) => ({ ...a, [qid]: v }));
    if (isLast) return;
    setToast(q?.type === "check" ? "稳了，继续" : REPLIES[(idx + v) % REPLIES.length]);
    setTimeout(next, 650);
  }

  async function submit() {
    setPhase("submitting");
    setErr("");
    try {
      const r = await fetch(`/api/surveys/${id}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: burner.current!.deviceId, answers }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "提交失败");
      if (j.status === "claimed") {
        setResult(j.result);
        setPhase("open");
        load().catch(() => {});
      } else if (j.status === "rejected") {
        setQc(j.qc);
        setPhase("fail");
      } else if (j.status === "retry") {
        setQc(j.qc);
        setPhase("retry");
      } else if (j.status === "screened") setPhase("screened");
      else if (j.status === "claim_failed") {
        setErr(j.error);
        setPhase("quiz");
      }
    } catch (e) {
      setErr((e as Error).message);
      setPhase("quiz");
    }
  }

  async function openPacket() {
    setOpened(true);
    try {
      const confetti = (await import("canvas-confetti")).default;
      setTimeout(() => confetti({ particleCount: 120, spread: 80, origin: { y: 0.45 }, colors: ["#F4C46A", "#FFE7B3", "#ffffff", "#E8323C"] }), 450);
    } catch {}
    setTimeout(() => setPhase("result"), 1900);
  }

  const answeredOk = useMemo(() => {
    if (!q) return false;
    const a = answers[q.id];
    if (q.type === "text") return typeof a === "string" && a.trim().length > 0;
    return typeof a === "number";
  }, [q, answers]);

  if (phase === "loading") return <div className="center"><div className="spinner dark" /></div>;
  if (phase === "error" || !survey || !stats)
    return (
      <div className="app">
        <div className="center">
          <Icon name="alert" style={{ width: 28, height: 28 }} />
          <div>{err || "问卷不存在"}</div>
          <Link className="btn btn-ghost btn-sm" href="/">返回首页</Link>
        </div>
      </div>
    );

  /* ───────── 封面 ───────── */
  if (phase === "cover") {
    const pct = Math.round((stats.claimed / survey.maxSlots) * 100);
    return (
      <main className="app">
        <div className="topbar">
          <Link href="/" className="brand"><span className="logo" />问卷拼手气</Link>
          <span className="chip"><span className="dot" />Monad 测试网</span>
        </div>
        <div className="pub">
          <div className="avatar">{(survey.author || "问").slice(0, 1)}</div>
          <div className="bubble"><b>{survey.author ? `${survey.author} · ` : ""}{survey.title}</b>{survey.intro || "认真填完，就能拆一个红包。"}</div>
        </div>
        <div className="hero">
          <div className="lab"><Icon name="zap" style={{ width: 14, height: 14 }} />填完拆红包 · 保底起</div>
          <div className="big"><span className="num">{fmtAmount(baseNet, dec, 3)}</span><small>{sym}</small></div>
          <div className="sub">再加拼手气，最高约 <b className="num">{fmtAmount(maxNet, dec, 2)}</b></div>
          <div className="packet"><span className="seal">開</span></div>
          <div className="meter"><span style={{ width: `${Math.max(3, pct)}%` }} /></div>
          <div className="mrow"><span>已拆 {stats.claimed} 个</span><span>共 {survey.maxSlots} 个</span></div>
        </div>
        <div className="facts">
          <div><div className="k"><Icon name="clock" />用时</div><div className="v num">{Math.max(20, survey.questions.length * 12)}<small>秒</small></div></div>
          <div><div className="k"><Icon name="file" />题目</div><div className="v num">{survey.questions.length}<small>道</small></div></div>
          <div><div className="k"><Icon name="users" />剩余</div><div className="v num">{left}<small>个</small></div></div>
        </div>
        {stats.claimed > 0 && (
          <div className="stackrow">
            <span className="faces">
              {stats.recent.slice(0, 4).map((r, i) => (<i key={i} style={{ background: ["#9DB1FF", "#FFB4A8", "#8FD9C0", "#F7D58B"][i] }} />))}
            </span>
            {stats.claimed} 人已拆 · 平均到手 <b className="num">{fmtAmount(stats.avgNet, dec, 3)}</b> {sym}
          </div>
        )}
        <div className="grow" />
        <div className="trust"><Icon name="lock" />奖金已锁进链上合约<Link href="/rules">规则公开</Link></div>
        {err && <div className="err">{err}</div>}
        {expired ? (
          <button className="btn btn-ghost" disabled>这份问卷已经截止</button>
        ) : left <= 0 ? (
          <button className="btn btn-ghost" disabled>红包已经被拆完了</button>
        ) : (
          <button className="btn btn-blue" onClick={start}>开始答题<Icon name="arrow" /></button>
        )}
        <div className="fine">不用注册，也不用钱包</div>
      </main>
    );
  }

  /* ───────── 答题 ───────── */
  if (phase === "quiz" || phase === "submitting") {
    const segs = flow.length + 1; // 第一格「扫码」一打开就是满的（赠送进度）
    return (
      <main className="app">
        <div className="qtop">
          <button className="iconbtn" aria-label="上一题" onClick={() => (idx > 0 ? setIdx(idx - 1) : setPhase("cover"))}><Icon name={idx > 0 ? "back" : "x"} /></button>
          <div className="prog">{Array.from({ length: segs }).map((_, i) => (<span key={i} className={i <= idx ? "on" : ""} />))}</div>
          <span className={`mini ${isLast ? "glow" : ""}`} />
        </div>
        {nudge && !isLast && <div className="nudge"><Icon name="alert" />慢一点哦，认真看题，红包才稳</div>}
        {isLast && (
          <div className="goal">
            <span className="mini glow" style={{ width: 28, height: 34 }} />
            <div><div className="t">答完这题就能拆红包</div><div className="s">最后一步，认真写</div></div>
          </div>
        )}
        {q && (
          <>
            {q.type === "check" ? (
              <span className="checktag"><Icon name="target" />认真度小测试</span>
            ) : (
              <div className="qmeta"><span><span className="num">{String(idx + 1).padStart(2, "0")}</span> · {q.type === "text" ? "填空" : "单选"}</span><span>{isLast ? "最后一题" : `还剩 ${flow.length - idx - 1} 题`}</span></div>
            )}
            <h1 className="qtitle">{q.title}</h1>
            {q.type === "text" ? (
              <TextAnswer value={String(answers[q.id] ?? "")} min={q.minChars ?? 2} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
            ) : (
              <div className="opts" key={q.id}>
                {q.options.map((o, i) => (
                  <button key={i} className={`opt ${answers[q.id] === i ? "sel" : ""}`} onClick={() => choose(q.id, i)}>
                    {q.type === "check" ? <i className="sw" style={{ background: SWATCH[i] }} /> : <span className="key">{String.fromCharCode(65 + i)}</span>}
                    {o}
                  </button>
                ))}
              </div>
            )}
            {q.type === "check" && <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>每份问卷都有一道这样的题，规则对所有人都一样。</p>}
          </>
        )}
        {toast && !isLast && <div className="toast"><span className="ok"><Icon name="check" /></span><span>{toast}</span></div>}
        <div className="grow" />
        {err && <div className="err">{err}</div>}
        {isLast ? (
          <button className="btn btn-red" disabled={!answeredOk || phase === "submitting"} onClick={submit}>
            {phase === "submitting" ? (<><span className="spinner" />质检中，马上发红包…</>) : (<>提交并拆红包<Icon name="arrow" /></>)}
          </button>
        ) : q?.type === "text" ? (
          <button className="btn btn-blue" disabled={!answeredOk} onClick={next}>下一题<Icon name="arrow" /></button>
        ) : (
          <div className="navrow"><span>选完自动下一题</span><span className="num">{idx + 1} / {flow.length}</span></div>
        )}
      </main>
    );
  }

  /* ───────── 拆红包 ───────── */
  if (phase === "open" && result) {
    return (
      <div className="redscreen">
        <div className="red-top">
          <span className="from"><span className="avatar">{(survey.author || "问").slice(0, 1)}</span>{survey.author || "发布者"}的问卷红包</span>
          <h3>认真的你，值得这个红包</h3>
          <p>保底 + 拼手气，点「開」看看手气</p>
        </div>
        <div className="stage-pk">
          <div className={`envelope ${opened ? "open" : ""}`}>
            <div className="face front">
              <button className="bigseal" onClick={openPacket} aria-label="拆开红包">開</button>
              <div className="hint">点一下</div>
            </div>
            <div className="face back"><small>手气不错</small><span className="num">{fmtAmount(result.net, dec, 3)}</span><small>{sym} 已到账</small></div>
          </div>
        </div>
        <div className="qcpass">
          <span><Icon name="shield" />质检通过</span>
          {result.durationSec && <span><Icon name="clock" />用时 <b className="num">{Math.round(result.durationSec)}</b> 秒</span>}
          <span><Icon name="zap" />链上确认 <b className="num">{(result.confirmMs / 1000).toFixed(2)}</b> 秒</span>
        </div>
      </div>
    );
  }

  /* ───────── 结果 ───────── */
  if (phase === "result" && result) {
    const me = burner.current?.address.toLowerCase();
    const board = [...stats.recent].sort((a, b) => (BigInt(b.net) > BigInt(a.net) ? 1 : -1)).slice(0, 3);
    if (me && !board.find((b) => b.respondent === me)) board.push({ nick: "你", respondent: me, net: result.net, index: result.index });
    return (
      <main className="app">
        <div className="res-head">
          <div className="from">{survey.author || "发布者"}的问卷红包</div>
          <div className="res-amt"><span className="num">{fmtAmount(result.net, dec, 3)}</span><small>{sym}</small></div>
          <a className="arrive" href={txUrl(result.txHash)} target="_blank" rel="noreferrer"><Icon name="check" />已到账 · {(result.confirmMs / 1000).toFixed(2)} 秒确认</a>
        </div>
        <div className="card split">
          <div className="row"><span>保底</span><b className="num">{fmtAmount(NET(BigInt(result.base)), dec, 3)}</b></div>
          <div className="row"><span><Icon name="spark" />拼手气</span><b className="num luck">+{fmtAmount(NET(BigInt(result.lucky)), dec, 3)}</b></div>
          <div className="row"><span>你是第几个拆开的</span><b className="num">第 {result.index} 个</b></div>
        </div>
        <div className="board">
          <div className="h"><span>这份问卷的手气榜</span><span className="num">{stats.claimed} / {survey.maxSlots}</span></div>
          {board.map((b, i) => (
            <div key={b.respondent} className={`lrow ${i === 0 ? "best" : ""} ${b.respondent === me ? "me" : ""}`}>
              <span className="r">{i + 1}</span>
              <span className="w">{i === 0 && <Icon name="crown" />}{b.respondent === me ? "你" : b.nick}</span>
              <b className="num">{fmtAmount(b.net, dec, 3)}</b>
            </div>
          ))}
        </div>
        <div className="grow" style={{ minHeight: 16 }} />
        <button className="btn btn-red" onClick={() => {
          const text = `我在「${survey.title}」拆到 ${fmtAmount(result.net, dec, 3)} ${sym}，你也来试试手气`;
          if (navigator.share) navigator.share({ title: "问卷拼手气", text, url: location.href }).catch(() => {});
          else navigator.clipboard?.writeText(`${text} ${location.href}`);
        }}><Icon name="share" />分享给朋友</button>
        <a className="txline" href={txUrl(result.txHash)} target="_blank" rel="noreferrer"><Icon name="ext" />链上记录 <span className="num">{short(result.txHash, 8, 6)}</span></a>
        <div className="fine">收款钱包 {short(burner.current?.address)}（{nick(burner.current?.address || "0x0000")}），私钥只保存在这台手机的浏览器里</div>
      </main>
    );
  }

  /* ───────── 没通过 / 可以重交 / 甄别 ───────── */
  if (phase === "screened")
    return (
      <main className="app">
        <div className="fail-ic"><Icon name="users" /></div>
        <h1 className="h-big">这份问卷在找特定的人群</h1>
        <p className="p-sub">谢谢你愿意帮忙，这次就不打扰你了。</p>
        <Link className="btn btn-ghost" href="/">返回首页</Link>
      </main>
    );

  const reasons = qc?.reasons || [];
  return (
    <main className="app">
      <div className="topbar"><button className="iconbtn" onClick={() => setPhase("cover")}><Icon name="x" /></button><span className="chip">质检规则 qc-v1</span></div>
      <div className="fail-ic"><Icon name="alert" /></div>
      <h1 className="h-big">{phase === "retry" ? "还差一点，改一下就好" : "这份答卷没有通过质检"}</h1>
      <p className="p-sub">{phase === "retry" ? "填空题的回答不太符合要求，可以修改后再交一次。" : "下面是具体原因。规则是固定的，你可以自己核对。"}</p>
      {reasons.map((r, i) => {
        const a = parseFloat(r.actual || "0"), t = parseFloat(r.threshold || "0");
        return (
          <div className="card rule" key={i}>
            <div className="rid"><span>没通过的规则</span><b>{r.rule}</b></div>
            <h4>{r.title}</h4>
            {r.rule === "R4" && t > 0 && (
              <>
                <div className="gauge"><div className="fill" style={{ width: `${Math.min(100, (a / (t * 1.5)) * 100)}%` }} /><div className="th" style={{ left: `${(1 / 1.5) * 100}%` }} /></div>
                <div className="gl"><span className="a">你的用时 <b className="num">{r.actual}</b></span><span>最少需要 <b className="num">{r.threshold}</b></span></div>
              </>
            )}
            {r.rule === "R3" && <div className="gl"><span className="a">结果 <b>{r.actual}</b></span><span>要求 <b>{r.threshold}</b></span></div>}
            <p className="exp">{r.detail}{r.rule !== "R5" ? " 这条规则不能重新提交。" : ""}</p>
          </div>
        );
      })}
      <div className="same"><Icon name="shield" />质检规则对所有人都一样，发布者也改不了。</div>
      <div className="grow" />
      {phase === "retry" ? (
        <button className="btn btn-blue" onClick={() => { const i = flow.findIndex((f) => f.id === reasons[0]?.questionId); setIdx(i >= 0 ? i : flow.length - 1); shownAt.current = Date.now(); setPhase("quiz"); }}>去修改<Icon name="arrow" /></button>
      ) : (
        <Link className="btn btn-ghost" href="/rules"><Icon name="book" />查看全部规则</Link>
      )}
    </main>
  );
}

function TextAnswer({ value, min, onChange }: { value: string; min: number; onChange: (v: string) => void }) {
  const problem = value ? textProblem(value, min) : null;
  return (
    <>
      <textarea className="ta" value={value} placeholder="写一句你的真实想法" onChange={(e) => onChange(e.target.value)} maxLength={300} />
      <div className="ta-foot">
        {value ? (problem ? <span className="bad">{problem}</span> : <span className="okc"><Icon name="check" style={{ width: 13, height: 13 }} />符合要求</span>) : <span>至少 {min} 个字</span>}
        <span className="num">{Array.from(value).length} 字</span>
      </div>
    </>
  );
}
