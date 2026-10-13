import { Activity, Database, FlaskConical, Radio, Trophy } from "lucide-react";
import { checkLimitlessSources, getOverallMetagame, listLabsEvents } from "@/lib/limitless";

export const dynamic = "force-dynamic";

const sourceIcons = {
  "play-api": Trophy,
  "overall-meta": Database,
  labs: FlaskConical,
};

export default async function Home() {
  const [sources, overallMeta, labsEvents] = await Promise.all([
    checkLimitlessSources(),
    getOverallMetagame({ time: "1months", limit: 5 }).catch(() => []),
    listLabsEvents().catch(() => []),
  ]);
  const connected = sources.filter((source) => source.status === "connected").length;

  return (
    <main className="min-h-screen bg-[#f4f3ed] text-[#161d24]">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-16">
        <header className="flex flex-col gap-8 border-b border-[#c9c7bd] pb-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-5 flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.16em] text-[#53616b]">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#e8382f] text-white">L</span>
              LoMeta / data foundation
            </div>
            <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-6xl">
              Pokémon TCG data, connected at the source.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-[#53616b] sm:text-lg">
              A clean starting point for comparing tournament results with the broader metagame.
              The analysis interface comes next; this build verifies the data routes first.
            </p>
          </div>

          <div className="min-w-56 rounded-2xl border border-[#b9c6b6] bg-[#e7efe2] p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#36533a]">
              <Radio className="h-4 w-4" /> Connection status
            </div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-[#1f3924]">{connected}/{sources.length}</div>
            <div className="text-sm text-[#58705b]">sources responding</div>
          </div>
        </header>

        <section className="py-10" aria-labelledby="sources-title">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="section-kicker">Live checks</p>
              <h2 id="sources-title" className="section-title">Source connections</h2>
            </div>
            <a className="api-link" href="/api/sources/health">View health JSON</a>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {sources.map((source) => {
              const Icon = sourceIcons[source.id];
              return (
                <article key={source.id} className="source-card">
                  <div className="flex items-start justify-between gap-4">
                    <span className="icon-tile"><Icon className="h-5 w-5" /></span>
                    <span className={source.status === "connected" ? "status-ok" : "status-bad"}>
                      <span className="status-dot" /> {source.status}
                    </span>
                  </div>
                  <h3 className="mt-6 text-lg font-semibold">{source.label}</h3>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-[#63707a]">{source.detail}</p>
                  <div className="mt-5 flex items-center justify-between border-t border-[#deddd6] pt-4 text-xs text-[#78838a]">
                    <span>{source.kind === "official-json-api" ? "Supported API" : "HTML adapter"}</span>
                    <span>{source.latencyMs} ms</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="grid gap-6 border-t border-[#c9c7bd] py-10 lg:grid-cols-[1.15fr_0.85fr]">
          <article className="data-panel">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="section-kicker">Past month</p>
                <h2 className="section-title">Overall metagame sample</h2>
              </div>
              <a className="api-link" href="/api/meta/overall?time=1months&limit=50">JSON</a>
            </div>
            <div className="divide-y divide-[#e1e0d9]">
              {overallMeta.map((deck) => (
                <div key={`${deck.rank}-${deck.name}`} className="grid grid-cols-[2.25rem_1fr_auto] items-center gap-3 py-3">
                  <span className="rank-number">{deck.rank}</span>
                  <div>
                    <div className="font-medium">{deck.name}</div>
                    <div className="text-xs text-[#7a848b]">{deck.points.toLocaleString()} points</div>
                  </div>
                  <span className="font-mono text-sm font-semibold">{(deck.share * 100).toFixed(2)}%</span>
                </div>
              ))}
              {overallMeta.length === 0 && <p className="py-8 text-sm text-[#63707a]">The source did not return deck rows.</p>}
            </div>
          </article>

          <article className="data-panel">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="section-kicker">Event discovery</p>
                <h2 className="section-title">Limitless Labs</h2>
              </div>
              <a className="api-link" href="/api/labs/events">JSON</a>
            </div>
            <div className="rounded-xl bg-[#17212a] p-5 text-white">
              <Activity className="h-5 w-5 text-[#89d47d]" />
              <div className="mt-5 text-4xl font-semibold tracking-tight">{labsEvents.length}</div>
              <p className="mt-1 text-sm text-[#b8c2c9]">major-event data sets discovered</p>
              <p className="mt-7 border-t border-white/15 pt-4 text-xs leading-5 text-[#94a3ad]">
                Labs exposes richer standings, deck, conversion, and pairing pages. Those stay isolated behind a replaceable adapter because they are not a documented API.
              </p>
            </div>
          </article>
        </section>

        <footer className="flex flex-col gap-2 border-t border-[#c9c7bd] pt-6 text-xs text-[#6e797f] sm:flex-row sm:items-center sm:justify-between">
          <span>Independent project. Pokémon and related marks belong to their respective owners.</span>
          <span>Source adapters ready for the next build phase.</span>
        </footer>
      </div>
    </main>
  );
}
