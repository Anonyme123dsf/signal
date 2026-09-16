import type { Metadata } from "next";
import Link from "next/link";
import "./arbitrage.css";

export const metadata: Metadata = {
  title: "Signal Arbitrage",
  description: "Preisunterschiede über Märkte hinweg erkennen, bewerten und als Paper-Trade abwickeln.",
};

const NAV = [
  { href: "/arbitrage", label: "Übersicht" },
  { href: "/arbitrage/deals", label: "Deals" },
  { href: "/arbitrage/history", label: "Verlauf" },
  { href: "/arbitrage/messages", label: "Nachrichten" },
  { href: "/arbitrage/listings", label: "Inserate" },
];

export default function ArbitrageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="arb">
      <header className="border-b border-[#1e1e34] px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href="/" className="text-xs tracking-[0.3em] uppercase text-[#6a6a8a]">Signal</Link>
        <span className="text-sm font-medium">Arbitrage</span>
        <nav className="flex gap-4 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-[#9c9cba] hover:text-white">{n.label}</Link>
          ))}
        </nav>
        <span className="ml-auto badge">Paper-Trading</span>
      </header>
      <main className="px-4 py-6 max-w-7xl mx-auto flex flex-col gap-6">{children}</main>
    </div>
  );
}
