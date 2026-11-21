import { defineChain } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  testnet: true,
});

export const CONTRACT = (process.env.NEXT_PUBLIC_CONTRACT || "0x0000000000000000000000000000000000000000") as `0x${string}`;
export const NATIVE = "0x0000000000000000000000000000000000000000" as `0x${string}`;
export const EXPLORER = "https://testnet.monadexplorer.com";

export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;

export const short = (s?: string | null, a = 6, b = 4) => (s ? `${s.slice(0, a)}…${s.slice(-b)}` : "");

/** 用钱包地址生成好记的昵称，例如 Nad#0412 */
export const nick = (addr: string) => `Nad#${(parseInt(addr.slice(-4), 16) % 10000).toString().padStart(4, "0")}`;

export function fmtAmount(wei: string | bigint, decimals = 18, digits = 2) {
  const v = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, digits);
  return digits > 0 ? `${whole}.${fracStr}` : whole.toString();
}
