"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Withdraw } from "@/components/Withdraw";
import { getBurner } from "@/lib/burner";
import { addrUrl, nick, short } from "@/lib/chain";

/** 我的钱包：这台手机浏览器里的临时钱包，可以提现到自己的钱包 */
export default function MePage() {
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => setAddr(getBurner().address), []);
  return (
    <main className="app">
      <div className="topbar">
        <Link className="iconbtn" href="/" aria-label="返回首页"><Icon name="back" /></Link>
        <b>我的钱包</b>
        <span style={{ width: 36 }} />
      </div>
      <h1 className="h-big">{addr ? nick(addr) : "…"}</h1>
      <p className="p-sub">
        拆到的红包都在这个临时钱包里，它只保存在这台手机的这个浏览器里。换浏览器、用无痕模式或者清除缓存就找不回来了，建议提现到你自己的钱包。
      </p>
      {addr && (
        <a className="txline" href={addrUrl(addr)} target="_blank" rel="noreferrer"><Icon name="ext" />临时钱包 <span className="num">{short(addr)}</span> 的链上记录</a>
      )}
      <Withdraw />
    </main>
  );
}
