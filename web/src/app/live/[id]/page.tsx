"use client";
import { use, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { createPublicClient, http } from "viem";
import { Icon } from "@/components/Icon";
import { CONTRACT, fmtAmount, monadTestnet, short, txUrl } from "@/lib/chain";
import "./live.css";

type Row = { nick: string; respondent: string; net: string; index: number; txHash: string; confirmMs: number };
type Data = {
  survey: { title: string; maxSlots: number; tokenDecimals: number; tokenSymbol: string; totalPool: string; questions: unknown[] };
  stats: { claimed: number; rejected: number; basePerSlot: string; luckyMaxFirst: string; remaining: string; avgConfirmMs: number | null; best: { nick: string; net: string; index: number } | null; recent: Row[] };
};
const COLORS = ["#2350FF", "#7C5CFF", "#0E9F6E", "#C77A0A", "#E8323C", "#1491B8"];

export default function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Data | null>(null);
  const [qr, setQr] = useState("");
  const [block, setBlock] = useState<bigint | null>(null);
  const [newest, setNewest] = useState<number | null>(null);
  const lastTop = useRef<number | null>(null);

  useEffect(() => {
    QRCode.toDataURL(`${location.origin}/s/${id}`, { margin: 1, width: 600, color: { dark: "#0A1640" } }).then(setQr);
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/surveys/${id}`, { cache: "no-store" });
        if (r.ok && alive) {
          const j = (await r.json()) as Data;
          const top = j.stats.recent[0]?.index ?? null;
          if (top !== null && top !== lastTop.current) {
            if (lastTop.current !== null) setNewest(top);
            lastTop.current = top;
          }
          setD(j);
        }
      } catch {}
    };
    tick();
    const t = setInterval(tick, 1500);
    const pc = createPublicClient({ chain: monadTestnet, transport: http() });
    const unwatch = pc.watchBlockNumber({ onBlockNumber: (b) => setBlock(b), pollingInterval: 1000 });
    return () => {
      alive = false;
      clearInterval(t);
      unwatch();
    };
  }, [id]);

  if (!d) return <div className="live" style={{ placeItems: "center", display: "grid" }}><div className="spinner" /></div>;
  const { survey: s, stats } = d;
  const dec = s.tokenDecimals;
  const NET = (x: bigint) => (x * 95n) / 100n;
  const pct = (stats.claimed / s.maxSlots) * 100;

  return (
    <main className="live">
      <section className="live-l">
        <div className="brand"><span className="logo" />问卷拼手气</div>
        <h2>扫码答 {s.questions.length} 道题，<br />拆一个<em>红包</em></h2>
        <p className="lsub">{s.title} · 认真填就能领，钱直接到你手机里</p>
        <div className="qrbox">
          <div className="qr">{qr && <img src={qr} alt="扫码填问卷" />}</div>
          <div className="qrside">
            <div><div className="k">每人保底</div><div className="v num">{fmtAmount(NET(BigInt(stats.basePerSlot)), dec, 3)} <small>{s.tokenSymbol}</small></div></div>
            <div><div className="k">拼手气最高约</div><div className="v num">{fmtAmount(NET(BigInt(stats.basePerSlot) + BigInt(stats.luckyMaxFirst)), dec, 2)} <small>{s.tokenSymbol}</small></div></div>
          </div>
        </div>
        <div className="pool">
          <div className="ph"><span>已拆 <b className="num">{stats.claimed}</b> / {s.maxSlots}</span><span>奖池剩余 <b className="num">{fmtAmount(stats.remaining, dec, 2)}</b> {s.tokenSymbol}</span></div>
          <div className="track"><span style={{ width: `${pct}%` }} /></div>
        </div>
      </section>
      <section className="live-r">
        <div className={`bestcard ${stats.best ? "" : "empty"}`}>
          <div className="crown"><Icon name="crown" /></div>
          <div><div className="k">手气最佳</div><div className="n">{stats.best ? stats.best.nick : "虚位以待"}</div></div>
          <div className="amt">{stats.best && (<><span className="num">{fmtAmount(stats.best.net, dec, 3)}</span><small>{s.tokenSymbol} · 第 {stats.best.index} 个拆开</small></>)}</div>
        </div>
        <div className="feed-h"><span className="liveDot">实时领取</span><span>每一笔都是一笔 Monad 交易</span></div>
        <div className="feed">
          {stats.recent.length === 0 && <div className="emptyfeed">等第一个人拆开红包…</div>}
          {stats.recent.slice(0, 6).map((r, i) => (
            <a key={r.txHash} className={`frow ${r.index === newest && i === 0 ? "new" : ""}`} href={txUrl(r.txHash)} target="_blank" rel="noreferrer">
              <span className="fa" style={{ background: COLORS[r.index % COLORS.length] }}>{String(r.index).padStart(2, "0")}</span>
              <span className="who"><b>{r.nick}</b><small>{short(r.txHash, 8, 5)}</small></span>
              <span className="amt num">{fmtAmount(r.net, dec, 3)}</span>
              <span className="ms">确认 <b>{(r.confirmMs / 1000).toFixed(2)}s</b></span>
            </a>
          ))}
        </div>
      </section>
      <div className="ticker">
        <span>Monad Testnet</span>
        <span>区块 <b className="num">{block ? block.toLocaleString("en-US") : "…"}</b></span>
        {stats.avgConfirmMs && <span>平均确认 <b>{(stats.avgConfirmMs / 1000).toFixed(2)}s</b></span>}
        <span>合约 <b>{short(CONTRACT)}</b></span>
        <span style={{ marginLeft: "auto" }}>质检拦截 <b>{stats.rejected}</b> 份</span>
      </div>
    </main>
  );
}
