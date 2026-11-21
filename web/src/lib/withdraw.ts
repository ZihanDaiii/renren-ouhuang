import { createPublicClient, createWalletClient, getAddress, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACT, monadTestnet } from "./chain";

/**
 * 提现：把临时钱包里的 MON 全部转到用户自己的钱包。
 * 只在浏览器里运行，用临时钱包自己的私钥签名，手续费从余额里扣，不经过服务器。
 * Monad 按 gas limit 收费，普通转账固定 21000 gas，所以预留 21000 × maxFeePerGas，其余全部转出。
 */
const GAS = 21000n;
const transport = () => http("https://testnet-rpc.monad.xyz");
const pub = () => createPublicClient({ chain: monadTestnet, transport: transport() });

export async function getBalance(address: Hex) {
  return pub().getBalance({ address });
}

/** 返回地址的问题；没问题返回 null */
export function addressProblem(to: string, self?: string): string | null {
  const v = to.trim();
  if (!v) return "请粘贴你的钱包地址";
  if (!isAddress(v, { strict: false })) return "地址格式不对：应该是 0x 开头、共 42 位";
  const a = v.toLowerCase();
  if (/^0x0{40}$/.test(a)) return "不能提现到空地址";
  if (self && a === self.toLowerCase()) return "这是当前的临时钱包，请填你自己的钱包地址";
  if (a === CONTRACT.toLowerCase()) return "这是红包合约地址，请填你自己的钱包地址";
  return null;
}

async function maxFee() {
  const f = await pub().estimateFeesPerGas();
  return { maxFeePerGas: (f.maxFeePerGas * 12n) / 10n, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
}

/** 预估：余额、手续费、实际能转出的金额 */
export async function quoteWithdraw(address: Hex) {
  const [balance, fee] = await Promise.all([getBalance(address), maxFee()]);
  const gasCost = GAS * fee.maxFeePerGas;
  const amount = balance > gasCost ? balance - gasCost : 0n;
  return { balance, gasCost, amount, fee };
}

/** 全部转出，等链上确认后返回交易哈希 */
export async function withdrawAll(pk: Hex, to: string) {
  const account = privateKeyToAccount(pk);
  const problem = addressProblem(to, account.address);
  if (problem) throw new Error(problem);
  const { amount, fee } = await quoteWithdraw(account.address);
  if (amount <= 0n) throw new Error("余额太少，不够付手续费");
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: transport() });
  const hash = await wallet.sendTransaction({ to: getAddress(to.trim()), value: amount, gas: GAS, ...fee, chain: monadTestnet });
  const receipt = await pub().waitForTransactionReceipt({ hash, pollingInterval: 300, timeout: 30_000 });
  if (receipt.status !== "success") throw new Error("提现交易执行失败");
  return { hash, amount };
}
