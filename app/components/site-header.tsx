export function SiteHeader({ active }: { active: "trends" | "overall" | "rankings" }) {
  return (
    <header className="border-b border-[#d6d4cb] bg-[#fbfaf6]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <a href="/" className="flex items-center gap-2.5 text-lg font-black tracking-[-0.04em] text-[#19252d]">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e85245] text-base text-white">L</span>
          LoMeta
        </a>
        <nav aria-label="Main navigation" className="flex gap-1 rounded-xl bg-[#eeede7] p-1 text-sm font-semibold">
          <a href="/" aria-current={active === "trends" ? "page" : undefined} className={active === "trends" ? "rounded-lg bg-white px-4 py-2 text-[#1d343f] shadow-sm" : "rounded-lg px-4 py-2 text-[#69767b] hover:text-[#1d343f]"}>Regional trends</a>
          <a href="/overall" aria-current={active === "overall" ? "page" : undefined} className={active === "overall" ? "rounded-lg bg-white px-4 py-2 text-[#1d343f] shadow-sm" : "rounded-lg px-4 py-2 text-[#69767b] hover:text-[#1d343f]"}>Overall meta</a>
        </nav>
      </div>
    </header>
  );
}
