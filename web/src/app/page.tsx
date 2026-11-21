import Link from "next/link";
import { Icon } from "@/components/Icon";

export default function Home() {
  return (
    <main className="app">
      <div className="topbar">
        <span className="brand"><span className="logo" />人人都是欧皇</span>
        <span className="chip"><span className="dot" />Monad 测试网</span>
      </div>
      <div className="hero" style={{ marginTop: 34, paddingTop: 26, paddingBottom: 24 }}>
        <div className="lab"><Icon name="zap" style={{ width: 14, height: 14 }} />问卷 + 拼手气红包</div>
        <h1 style={{ fontSize: 34, lineHeight: 1.15, letterSpacing: "-.03em", margin: "14px 0 10px", paddingRight: 96 }}>认真填，<br />一秒到账</h1>
        <div className="sub">不填抢不到，乱填领不到。奖金锁在链上，质检规则公开。</div>
        <div className="packet"><span className="seal">開</span></div>
      </div>
      <div className="card split" style={{ marginTop: 6 }}>
        <div className="row"><span><Icon name="lock" style={{ color: "var(--blue)" }} />发布者先把奖金锁进合约</span></div>
        <div className="row"><span><Icon name="shield" style={{ color: "var(--blue)" }} />填写者通过公开的质检规则</span></div>
        <div className="row"><span><Icon name="spark" />当场拆「保底 + 拼手气」，约 1 秒到账</span></div>
        <div className="row"><span><Icon name="undo" style={{ color: "var(--blue)" }} />没发完的奖金全额退回</span></div>
      </div>
      <div className="grow" />
      <Link className="btn btn-blue" href="/create">发一份问卷红包<Icon name="arrow" /></Link>
      <div className="fine" style={{ marginTop: 12 }}><Link href="/rules">平台规则</Link></div>
    </main>
  );
}
