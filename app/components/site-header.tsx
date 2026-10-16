import Link from "next/link";

export function SiteHeader({ active }: { active: "trends" | "overall" | "rankings" | "japan" }) {
  return (
    <header className="border-b border-[#d6d4cb] bg-[#fbfaf6]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-black tracking-[-0.04em] text-[#19252d]">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e85245] text-base text-white">L</span>
          LoMeta
        </Link>
        <nav aria-label="Main navigation" className="flex w-full flex-wrap gap-1 rounded-xl bg-[#eeede7] p-1 text-sm font-semibold sm:w-auto">
          <Link href="/" aria-current={active === "overall" ? "page" : undefined} className={active === "overall" ? "whitespace-nowrap rounded-lg bg-white px-4 py-2 text-[#1d343f] shadow-sm" : "whitespace-nowrap rounded-lg px-4 py-2 text-[#69767b] hover:text-[#1d343f]"}>Overall meta</Link>
          <Link href="/trends" aria-current={active === "trends" ? "page" : undefined} className={active === "trends" ? "whitespace-nowrap rounded-lg bg-white px-4 py-2 text-[#1d343f] shadow-sm" : "whitespace-nowrap rounded-lg px-4 py-2 text-[#69767b] hover:text-[#1d343f]"}>Regional trends</Link>
          <Link href="/japan" aria-current={active === "japan" ? "page" : undefined} className={active === "japan" ? "whitespace-nowrap rounded-lg bg-white px-4 py-2 text-[#1d343f] shadow-sm" : "whitespace-nowrap rounded-lg px-4 py-2 text-[#69767b] hover:text-[#1d343f]"}>Japan City League</Link>
        </nav>
      </div>
    </header>
  );
}
