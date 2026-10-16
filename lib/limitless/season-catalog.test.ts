import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEventDates, seasonEventFromLabs } from "./season-catalog";
import { mainEventCandidates, parseMainEvents } from "./main-event-link";
import type { LabsEvent } from "./types";

const labsEvent = (name: string, dateLabel: string, country = "US"): LabsEvent => ({
  id: "0099", name, dateLabel, country, logoUrl: null,
  standingsUrl: "https://labs.limitlesstcg.com/0099/standings",
});

test("parses single, multi-day, and cross-month event dates", () => {
  assert.deepEqual(parseEventDates("October 9–11, 2026"), { date: "2026-10-09", endDate: "2026-10-11" });
  assert.deepEqual(parseEventDates("February 27–March 1, 2027"), { date: "2027-02-27", endDate: "2027-03-01" });
  assert.deepEqual(parseEventDates("December 31–January 2, 2027"), { date: "2026-12-31", endDate: "2027-01-02" });
  assert.equal(parseEventDates("February 30, 2027"), null);
});

test("includes only season Regionals and Special Events", () => {
  assert.equal(seasonEventFromLabs(labsEvent("Regional Championship Baltimore", "September 18–20, 2026"))?.kind, "regional");
  assert.equal(seasonEventFromLabs(labsEvent("Special Event Lima", "May 23–24, 2027", "PE"))?.geography, "south-america");
  assert.equal(seasonEventFromLabs(labsEvent("Special Event Toronto", "May 23–24, 2027", "CA"))?.geography, "other");
  assert.equal(seasonEventFromLabs(labsEvent("World Championship London", "May 23–24, 2027", "GB")), null);
  assert.equal(seasonEventFromLabs(labsEvent("Special Event Turin", "June 6–7, 2026", "IT")), null);
});

test("matches main-site candidates by type, city, country, and nearby date", () => {
  const html = `<table><tr data-date="2026-10-10" data-country="US" data-name="Regional Louisville, KY"><td><a href="/tournaments/581">Regional Louisville</a></td></tr>
    <tr data-date="2026-10-10" data-country="CA" data-name="Regional Louisville"><td><a href="/tournaments/999">Wrong country</a></td></tr></table>`;
  const events = parseMainEvents(html);
  assert.equal(events.length, 2);
  const labs = seasonEventFromLabs(labsEvent("Regional Championship Louisville", "October 9–11, 2026"))!;
  assert.deepEqual(mainEventCandidates(events, labs).map((event) => event.id), ["581"]);
});
