import "server-only";
import { createPublicClient, createWalletClient, http, fallback, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abi } from "../abi";
import { CONTRACT, monadTestnet } from "../chain";

const transport = fallback([
  http("https://testnet-rpc.monad.xyz"),
  http("https://rpc.ankr.com/monad_testnet"),
  http("https://rpc-testnet.monadinfra.com"),
]);

export const publicClient = createPublicClient({ chain: monadTestnet, transport, pollingInterval: 200 });

function pk(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v as Hex;
}

export const signerAccount = () => privateKeyToAccount(pk("SIGNER_PRIVATE_KEY"));
const relayerAccount = () => privateKeyToAccount(pk("RELAYER_PRIVATE_KEY"));

/** 质检通过后签发 EIP-712 领取凭证 */
export async function signTicket(t: { surveyId: bigint; respondent: Hex; answerHash: Hex; seed: Hex; expiry: bigint }) {
  return signerAccount().signTypedData({
    domain: { name: "SurveyRedPacket", version: "1", chainId: monadTestnet.id, verifyingContract: CONTRACT },
    types: {
      ClaimTicket: [
        { name: "surveyId", type: "uint256" },
        { name: "respondent", type: "address" },
        { name: "answerHash", type: "bytes32" },
        { name: "seed", type: "bytes32" },
        { name: "expiry", type: "uint64" },
      ],
    },
    primaryType: "ClaimTicket",
    message: t,
  });
}

// 同一个函数实例里串行发送，避免 nonce 冲突；跨实例冲突时按 nonce 错误重试
let queue: Promise<unknown> = Promise.resolve();
// 缓存 gas 上限、gas 价格和 nonce，减少每次领取前的 RPC 往返
let cachedGas: bigint | null = null;
let cachedFee: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; at: number } | null = null;
let nextNonce: number | null = null;

async function fees() {
  if (!cachedFee || Date.now() - cachedFee.at > 30_000) {
    const f = await publicClient.estimateFeesPerGas();
    cachedFee = { maxFeePerGas: (f.maxFeePerGas * 15n) / 10n, maxPriorityFeePerGas: f.maxPriorityFeePerGas, at: Date.now() };
  }
  return cachedFee;
}

/** 平台中继代付 gas，提交领取交易，等待确认后解析 Claimed 事件 */
export async function relayClaim(args: {
  surveyId: bigint;
  respondent: Hex;
  answerHash: Hex;
  seed: Hex;
  expiry: bigint;
  signature: Hex;
}) {
  const run = async () => {
    const account = relayerAccount();
    const wallet = createWalletClient({ account, chain: monadTestnet, transport });
    const callArgs = [args.surveyId, args.respondent, args.answerHash, args.seed, args.expiry, args.signature] as const;
    // Monad 按 gas limit 计费：第一次估算后加 30% 余量并缓存（领取的 gas 基本固定），不写一个很大的固定值。
    // 估算同时起到预检作用：凭证无效、名额已满时直接报错，不会发出失败交易。
    const est = await publicClient.estimateContractGas({ address: CONTRACT, abi, functionName: "claim", args: callArgs, account });
    if (!cachedGas || est > cachedGas) cachedGas = (est * 13n) / 10n;
    const gas = cachedGas;
    const fee = await fees();
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (nextNonce === null) nextNonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
        const nonce = nextNonce;
        const t0 = Date.now();
        const hash = await wallet.writeContract({ address: CONTRACT, abi, functionName: "claim", args: callArgs, gas, nonce, ...fee, chain: monadTestnet });
        nextNonce = nonce + 1;
        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 150, timeout: 30_000 });
        const confirmMs = Date.now() - t0;
        if (receipt.status !== "success") throw new Error("链上领取交易执行失败");
        const [ev] = parseEventLogs({ abi, logs: receipt.logs, eventName: "Claimed" });
        return {
          txHash: hash,
          confirmMs,
          index: Number(ev.args.index),
          base: ev.args.base.toString(),
          lucky: ev.args.lucky.toString(),
          net: ev.args.net.toString(),
          fee: ev.args.fee.toString(),
        };
      } catch (e) {
        lastErr = e;
        const msg = String((e as Error)?.message || e);
        if (/nonce|replacement|already known/i.test(msg)) {
          nextNonce = null;
          await new Promise((r) => setTimeout(r, 300 + attempt * 300));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

/** 读取并校验发布交易里的 SurveyCreated 事件 */
export async function readCreated(txHash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
  if (receipt.status !== "success") throw new Error("发布交易失败");
  if (receipt.to?.toLowerCase() !== CONTRACT.toLowerCase()) throw new Error("交易不是发给本合约的");
  const [ev] = parseEventLogs({ abi, logs: receipt.logs, eventName: "SurveyCreated" });
  if (!ev) throw new Error("交易里没有找到 SurveyCreated 事件");
  return ev.args;
}

export async function readSurvey(id: bigint) {
  const s = await publicClient.readContract({ address: CONTRACT, abi, functionName: "surveys", args: [id] });
  const [publisher, token, totalPool, basePerSlot, luckyRemaining, bestAmount, maxSlots, claimed, deadline, closed, best] = s;
  return { publisher, token, totalPool, basePerSlot, luckyRemaining, bestAmount, maxSlots, claimed, deadline, closed, best };
}
