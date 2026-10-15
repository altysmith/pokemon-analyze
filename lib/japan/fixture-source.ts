import { parseCityLeagueEvent, parseCityLeagueIndex } from "./parse";
import type { JapanListingEvent, JapanSource } from "./source";

export class FixtureJapanSource implements JapanSource {
  constructor(private readonly indexHtml: string, private readonly eventHtml: ReadonlyMap<string, string>) {}

  async listEvents() {
    return parseCityLeagueIndex(this.indexHtml);
  }

  async getEvent(event: JapanListingEvent) {
    const html = this.eventHtml.get(event.id);
    if (!html) throw new Error("Missing event fixture: " + event.id);
    return parseCityLeagueEvent(html, event);
  }
}
