// 端到端测试：用中继钱包当发布者在链上创建问卷 → 登记到后端 → 模拟填写者答题、质检、领取
// 用法：node scripts/e2e.mjs [baseUrl] [池子 MON] [名额] [认真填写人数]
// 读取 app/.env.local 里的 RELAYER_PRIVATE_KEY 和 NEXT_PUBLIC_CONTRACT
import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { createPublicClient, createWalletClient, http, keccak256, toBytes, parseEther, formatEther } = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = process.argv[2] || "http://localhost:3100";
const POOL = process.argv[3] || "0.5";
const SLOTS = Number(process.argv[4] || 5);
const GOOD = Number(process.argv[5] || 2);
const CONTRACT = env.NEXT_PUBLIC_CONTRACT;
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } } };
const abi = [
  { type: "function", name: "createSurvey", stateMutability: "payable", inputs: [{ name: "token", type: "address" }, { name: "totalPool", type: "uint128" }, { name: "maxSlots", type: "uint32" }, { name: "deadline", type: "uint64" }, { name: "metaHash", type: "bytes32" }], outputs: [{ type: "uint256" }] },
];
const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY);
const pc = createPublicClient({ chain, transport: http() });
const wc = createWalletClient({ account, chain, transport: http() });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 网络不稳定时自动重试（登记问卷是幂等的；提交重试时服务端会返回已有结果）
const post = async (path, body) => {
  let err;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, ...(await r.json()) };
    } catch (e) {
      err = e;
      await sleep(1500);
    }
  }
  throw err;
};

const content = {
  title: "端到端测试问卷",
  intro: "脚本自动测试",
  author: "测试",
  questions: [
    { id: "q1", type: "single", title: "今天你最喜欢哪类项目？", options: ["DeFi", "游戏", "AI Agent", "社交"] },
    { id: "q2", type: "text", title: "一句话评价今天的活动", minChars: 2 },
  ],
};
const contentJson = JSON.stringify(content);
const value = parseEther(POOL);
console.log("发布者", account.address, "余额", formatEther(await pc.getBalance({ address: account.address })), "MON");
const hash = await wc.writeContract({
  address: CONTRACT,
  abi,
  functionName: "createSurvey",
  args: ["0x0000000000000000000000000000000000000000", value, SLOTS, BigInt(Math.floor(Date.now() / 1000) + 3600), keccak256(toBytes(contentJson))],
  value,
});
await pc.waitForTransactionReceipt({ hash });
const adminToken = "e2e" + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
const created = await post("/api/surveys", { contentJson, txHash: hash, adminToken });
console.log("登记问卷", created);
const id = created.id;

async function respondent(label, { delayMs, text, checkRight }) {
  const deviceId = crypto.randomUUID();
  const addr = privateKeyToAccount(generatePrivateKey()).address;
  const s = await post(`/api/surveys/${id}/start`, { deviceId, respondent: addr });
  const answers = {};
  for (const q of s.flow) {
    if (q.type === "single") answers[q.id] = 2;
    else if (q.type === "text") answers[q.id] = text;
    else if (q.type === "check") answers[q.id] = checkRight ? q.target : (q.target + 1) % 4;
  }
  await sleep(delayMs);
  const t0 = Date.now();
  const r = await post(`/api/surveys/${id}/submit`, { deviceId, answers });
  const ms = Date.now() - t0;
  if (r.status === "claimed") {
    const bal = await pc.getBalance({ address: addr });
    console.log(`✅ ${label}: 领到 ${formatEther(BigInt(r.result.net))} MON（第 ${r.result.index} 个，链上确认 ${r.result.confirmMs}ms，接口总耗时 ${ms}ms），钱包余额 ${formatEther(bal)}`);
  } else console.log(`⛔ ${label}: ${r.status}`, JSON.stringify(r.qc?.reasons?.map((x) => `${x.rule} ${x.actual ?? ""}/${x.threshold ?? ""}`) || r.error));
}

await respondent("乱填（2 秒交卷）", { delayMs: 2000, text: "好的不错", checkRight: true });
await respondent("检测题答错", { delayMs: 12000, text: "活动组织得很好", checkRight: false });
await respondent("填空乱写", { delayMs: 12000, text: "asdfgh", checkRight: true });
const goods = [];
for (let i = 0; i < GOOD; i++) goods.push(respondent(`认真填写者 ${i + 1}`, { delayMs: 12000 + i * 300, text: "现场氛围很好，学到了很多", checkRight: true }));
await Promise.all(goods);

let live;
for (let i = 0; i < 5; i++) { try { live = await (await fetch(`${BASE}/api/surveys/${id}`)).json(); break; } catch { await sleep(1500); } }
console.log("大屏统计", { claimed: live.stats.claimed, rejected: live.stats.rejected, remaining: formatEther(BigInt(live.stats.remaining)), best: live.stats.best?.nick });
console.log(`问卷页 ${BASE}/s/${id}\n大屏 ${BASE}/live/${id}\n后台 ${BASE}/admin/${id}?token=${adminToken}`);
