import { parseCityLeagueEvent, parseCityLeagueIndex } from "./parse";
import type { JapanEventSnapshot, JapanListingEvent, JapanSource } from "./source";

const BASE = "https://www.limitlesstcg.com";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class LiveJapanSource implements JapanSource {
  private lastRequest = 0;

  constructor(private readonly options: { pages?: number; minIntervalMs?: number } = {}) {
    if (!Number.isInteger(options.pages ?? 1) || (options.pages ?? 1) < 1 || (options.pages ?? 1) > 10) {
      throw new Error("City League listing pages must be between 1 and 10.");
    }
  }

  private async html(path: string) {
    if (!/^\/tournaments\/jp(?:\?page=\d+|\/\d+)?$/.test(path)) throw new Error("Unexpected City League URL.");
    for (let attempt = 0; attempt < 3; attempt++) {
      await wait(Math.max(0, this.lastRequest + (this.options.minIntervalMs ?? 1500) - Date.now()));
      this.lastRequest = Date.now();
      const response = await fetch(BASE + path, {
        headers: { "User-Agent": "LoMeta/0.1 (personal City League research)", Accept: "text/html" },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 2) throw new Error(`City League request failed: HTTP ${response.status}`);
        const retryAfter = Number(response.headers.get("retry-after"));
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 3000 * (attempt + 1));
        continue;
      }
      if (!response.ok) throw new Error(`City League request failed: HTTP ${response.status}`);
      if (!(response.headers.get("content-type") ?? "").includes("text/html")) throw new Error("City League response was not HTML.");
      const body = await response.text();
      if (body.length > 5_000_000) throw new Error("City League response exceeded size limit.");
      return body;
    }
    throw new Error("City League request failed.");
  }

  async listEvents(): Promise<JapanListingEvent[]> {
    const events = new Map<string, JapanListingEvent>();
    for (let page = 1; page <= (this.options.pages ?? 1); page++) {
      const html = await this.html(`/tournaments/jp${page === 1 ? "" : `?page=${page}`}`);
      const current = html.match(/<ul class="pagination" data-current="(\d+)" data-max="(\d+)"/);
      if (!current || Number(current[1]) !== page) throw new Error(`City League listing pagination changed on page ${page}.`);
      const parsed = parseCityLeagueIndex(html);
      if (!parsed.length) throw new Error(`No City League events found on page ${page}.`);
      for (const event of parsed) events.set(event.id, event);
      if (page >= Number(current[2])) break;
    }
    return [...events.values()];
  }

  async getEvent(event: JapanListingEvent): Promise<JapanEventSnapshot> {
    if (!/^\d+$/.test(event.id) || event.sourceUrl !== `${BASE}/tournaments/jp/${event.id}`) throw new Error("Unexpected City League event identity.");
    return parseCityLeagueEvent(await this.html(`/tournaments/jp/${event.id}`), event);
  }
}
