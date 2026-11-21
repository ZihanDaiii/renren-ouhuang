import Link from "next/link";
import { Icon } from "@/components/Icon";
import { CONTRACT, addrUrl, short } from "@/lib/chain";

const RULES: [string, string, string][] = [
  ["R1", "一人一次", "同一台设备、同一个钱包，在同一份问卷里只能领一次。合约里也会强制检查。"],
  ["R2", "必答题完整", "必答题没答完不能提交，这一条不算质检失败。"],
  ["R3", "认真度小测试", "系统每 10 题自动插入 1 道检测题（至少 1 道），题干会明确写出该选哪一项。只有 1 道时，答错就不发奖励；有 2 道及以上时，答错 2 道才不发。"],
  ["R4", "作答时间", "每题最少用时 = 1 秒 + 题干和选项字数 ÷ 15（字/秒），填空题再加最少字数 × 0.5 秒。整份问卷的实际用时低于各题之和，不发奖励。15 字/秒大约是正常阅读速度的 2 到 3 倍，只拦截快得离谱的提交。"],
  ["R5", "填空有效", "去掉空格和标点后，长度不少于最少字数，不同的字至少 2 个，不能是键盘乱按（例如 asdfgh）。没通过可以修改后再交一次。"],
  ["R6", "直线作答", "连续 5 道以上单选题都选同一个位置，只在后台标记，不影响奖励。"],
  ["R7", "甄别题", "发布者可以在第 1 题设置甄别条件，不符合条件的人会礼貌结束，不算质检失败。"],
];

export default function Rules() {
  return (
    <main className="app" style={{ maxWidth: 680 }}>
      <div className="topbar"><Link className="iconbtn" href="/"><Icon name="back" /></Link><b>平台规则</b><span className="chip">qc-v1</span></div>

      <h2 style={{ fontSize: 18, margin: "8px 2px 10px" }}>奖金怎么分</h2>
      <div className="card" style={{ padding: "14px 16px", fontSize: 14, lineHeight: 1.75, color: "var(--ink-2)", marginBottom: 18 }}>
        奖池的 50% 平均分给每个名额作为保底；另外 50% 用拼手气发放（二倍均值法：每次随机拿 0 到剩余均值的 2 倍，最后一个人拿走剩下的全部）。保底加拼手气是平台的固定规则，发布者不能修改。随机数由平台签发凭证时生成的种子和链上区块随机数共同决定。
      </div>

      <h2 style={{ fontSize: 18, margin: "8px 2px 10px" }}>质检规则（对所有问卷统一，发布者不能修改）</h2>
      {RULES.map(([k, t, d]) => (
        <div className="card rule" key={k}>
          <div className="rid"><span>{t}</span><b>{k}</b></div>
          <p className="exp" style={{ borderTop: 0, paddingTop: 0, marginTop: 8 }}>{d}</p>
        </div>
      ))}
      <div className="same"><Icon name="shield" />是否发奖励只由上面的规则决定，发布者不能事后手动拒付。</div>

      <h2 style={{ fontSize: 18, margin: "18px 2px 10px" }}>服务费和退款</h2>
      <div className="card" style={{ padding: "14px 16px", fontSize: 14, lineHeight: 1.75, color: "var(--ink-2)", marginBottom: 18 }}>
        平台从每一笔发放的奖励中收取 5% 服务费，填写者看到的金额是扣除服务费后的实际到账金额。领取交易的 gas 由平台代付，填写者不需要持有任何代币。问卷截止或名额领完后，发布者可以随时结束问卷，没发完的奖金（保底和拼手气剩余部分）全额退回，不收服务费。
      </div>

      <h2 style={{ fontSize: 18, margin: "18px 2px 10px" }}>隐私</h2>
      <div className="card" style={{ padding: "14px 16px", fontSize: 14, lineHeight: 1.75, color: "var(--ink-2)", marginBottom: 18 }}>
        答卷内容不上链，链上只记录答卷的哈希。填写者的收款钱包在手机浏览器里生成，私钥只保存在本机。
      </div>
      <a className="txline" href={addrUrl(CONTRACT)} target="_blank" rel="noreferrer"><Icon name="ext" />合约地址 <span className="num">{short(CONTRACT, 8, 6)}</span></a>
    </main>
  );
}
