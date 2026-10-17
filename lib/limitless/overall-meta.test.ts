import assert from "node:assert/strict";
import test from "node:test";
import { matchMainDeckUrl, parseOverallMetagame } from "./overall-meta";

test("published deck rows retain exact base and variant links", () => {
  const html = `<table>
    <tr><td>1</td><td><img alt="starmie-mega"></td><td><a href="/decks/362">Mega Starmie</a></td><td>10</td><td>1%</td></tr>
    <tr><td>2</td><td><img alt="starmie-mega"><img alt="froslass"></td><td><a href="/decks/362?variant=2">Starmie Froslass</a></td><td>8</td><td>0.8%</td></tr>
  </table>`;
  const rows = parseOverallMetagame(html);
  assert.equal(rows[0].url, "https://www.limitlesstcg.com/decks/362");
  assert.equal(rows[1].url, "https://www.limitlesstcg.com/decks/362?variant=2");
  assert.equal(matchMainDeckUrl({ name: "Starmie Froslass", icons: ["starmie-mega", "froslass"] }, rows), rows[1].url);
  assert.equal(matchMainDeckUrl({ name: "Mega Starmie", icons: ["starmie-mega"] }, rows), rows[0].url);
  assert.equal(matchMainDeckUrl({ name: "Unknown", icons: [] }, rows), null);
});
