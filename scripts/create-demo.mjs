// 一键创建 demo 用的问卷红包（发布者 = 平台中继钱包，不需要 MetaMask）
// 用法：node scripts/create-demo.mjs [baseUrl] [奖池 MON] [名额] [截止分钟] [称呼]
// 例：NODE_USE_ENV_PROXY=1 node scripts/create-demo.mjs https://wenjuan-hongbao.vercel.app 4 20 120 Zihan
import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { createPublicClient, createWalletClient, http, keccak256, toBytes, parseEther } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const [BASE = "https://wenjuan-hongbao.vercel.app", POOL = "4", SLOTS = "20", MINUTES = "120", AUTHOR = "Zihan"] = process.argv.slice(2);
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } } };
const abi = [{ type: "function", name: "createSurvey", stateMutability: "payable", inputs: [{ name: "token", type: "address" }, { name: "totalPool", type: "uint128" }, { name: "maxSlots", type: "uint32" }, { name: "deadline", type: "uint64" }, { name: "metaHash", type: "bytes32" }], outputs: [{ type: "uint256" }] }];

const content = {
  title: "Monad Blitz 广州现场小调研",
  intro: "3 道题，帮我了解今天大家的感受。认真填，当场拆红包。",
  author: AUTHOR,
  questions: [
    { id: "q1", type: "single", title: "今天你最喜欢哪类项目？", options: ["DeFi", "游戏", "AI Agent", "社交", "工具"] },
    { id: "q2", type: "single", title: "如果填一份 3 分钟的问卷，你觉得给多少合适？", options: ["0.1 MON", "0.5 MON", "1 MON", "3 MON"] },
    { id: "q3", type: "text", title: "一句话评价今天的 Monad Blitz", minChars: 2 },
  ],
};
const contentJson = JSON.stringify(content);
const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY);
const pc = createPublicClient({ chain, transport: http() });
const wc = createWalletClient({ account, chain, transport: http() });
const value = parseEther(POOL);
const hash = await wc.writeContract({
  address: env.NEXT_PUBLIC_CONTRACT,
  abi,
  functionName: "createSurvey",
  args: ["0x0000000000000000000000000000000000000000", value, Number(SLOTS), BigInt(Math.floor(Date.now() / 1000) + Number(MINUTES) * 60), keccak256(toBytes(contentJson))],
  value,
});
await pc.waitForTransactionReceipt({ hash });
const adminToken = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const r = await fetch(`${BASE}/api/surveys`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contentJson, txHash: hash, adminToken }) });
const j = await r.json();
if (!r.ok) throw new Error(j.error);
console.log(`创建交易 https://testnet.monadexplorer.com/tx/${hash}`);
console.log(`问卷页   ${BASE}/s/${j.id}`);
console.log(`开奖大屏 ${BASE}/live/${j.id}`);
console.log(`管理后台 ${BASE}/admin/${j.id}?token=${adminToken}`);
