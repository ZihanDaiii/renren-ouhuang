"use client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * 填写者的临时钱包：第一次打开时在浏览器里生成，只用来收奖励，不需要 MON 付 gas。
 * 私钥只存在这台手机的浏览器里。
 */
export function getBurner() {
  const KEY = "wj_burner_v1";
  let raw = localStorage.getItem(KEY);
  if (!raw) {
    const pk = generatePrivateKey();
    const deviceId = crypto.randomUUID();
    raw = JSON.stringify({ pk, deviceId });
    localStorage.setItem(KEY, raw);
  }
  const { pk, deviceId } = JSON.parse(raw) as { pk: `0x${string}`; deviceId: string };
  return { pk, deviceId, address: privateKeyToAccount(pk).address };
}
