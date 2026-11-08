import assert from "node:assert/strict";
import test from "node:test";
import { openJapanDb } from "../../db/japan";
import { importJapanEvent } from "./import";
import { japanDecklistCoverage, parseJapanDecklist, searchJapanDecklists, storeJapanDecklist, storedJapanDecklist } from "./decklist-content";

const url = "https://www.limitlesstcg.com/decks/list/jp/75520";
const html = `<div class="decklist-main"><div class="decklist-column-heading">Pokémon (4)</div>
  <div class="decklist-card" data-set="PFL" data-number="10"><span class="card-count">4</span><span class="card-name">Charizard ex</span></div>
  <div class="decklist-column-heading">Trainer (4)</div>
  <div class="decklist-card" data-set="PAL" data-number="1"><span class="card-count">4</span><span class="card-name">Boss&#039;s Orders</span></div>
  <div class="decklist-column-heading">Energy (52)</div>
  <div class="decklist-card" data-set="SVE" data-number="2"><span class="card-count">52</span><span class="card-name">Fire Energy</span></div>
  </div>`;

test("Japanese decklist cards parse by section and reject incomplete lists", () => {
  const cards = parseJapanDecklist(html);
  assert.deepEqual(cards[0], { section: "Pokémon", quantity: 4, name: "Charizard ex", setCode: "PFL", cardNumber: "10" });
  assert.equal(cards[1].name, "Boss's Orders");
  assert.equal(cards[2].section, "Energy");
  assert.throws(() => parseJapanDecklist(html.replace('<span class="card-count">52', '<span class="card-count">51')), /missing or incomplete/);
});

test("card search finds contained cards, respects dates, and retains indexed contents after event refresh", () => {
  const db = openJapanDb(":memory:");
  const event = {
    id: "5063", sourceUrl: "https://www.limitlesstcg.com/tournaments/jp/5063", eventDate: "2026-10-13",
    prefectureRaw: "Ōsaka", shopRaw: "City League", knownPlayerCount: null,
    placements: [{ sourceRow: 1, placing: 1, playerNameRaw: "Player", playerUrl: null, archetypeRaw: "charizard", decklistUrl: url }],
  };
  try {
    importJapanEvent(db, event);
    storeJapanDecklist(db, url, parseJapanDecklist(html));
    assert.equal(searchJapanDecklists(db, "charizard", { from: "2026-10-01", to: "2026-10-31" })[0].matchedCards, "Charizard ex");
    assert.equal(searchJapanDecklists(db, "Charizard", { from: "2026-11-01", to: null }).length, 0);
    assert.deepEqual(japanDecklistCoverage(db, { from: null, to: null }), { total: 1, indexed: 1 });
    importJapanEvent(db, { ...event, shopRaw: "Updated shop" });
    assert.equal(storedJapanDecklist(db, url)?.length, 3);
    assert.equal(searchJapanDecklists(db, "charizard", { from: null, to: null }).length, 1);
  } finally {
    db.close();
  }
});
