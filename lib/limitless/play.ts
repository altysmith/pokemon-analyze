import { fetchJson } from "./http";
import type {
  LimitlessGame,
  Pairing,
  Standing,
  TournamentDetails,
  TournamentSummary,
} from "./types";

export const PLAY_API_BASE = "https://play.limitlesstcg.com/api";

type TournamentFilters = {
  game?: string;
  format?: string;
  organizerId?: number;
  limit?: number;
  page?: number;
};

function playUrl(path: string, query?: Record<string, string | number | undefined>) {
  const url = new URL(`${PLAY_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function authenticatedHeaders() {
  const apiKey = process.env.LIMITLESS_API_KEY;
  return apiKey ? { "X-Access-Key": apiKey } : undefined;
}

function assertTournamentId(id: string) {
  if (!/^[a-zA-Z0-9_-]{4,80}$/.test(id)) {
    throw new Error("Invalid tournament ID.");
  }
}

export function listGames() {
  return fetchJson<LimitlessGame[]>(playUrl("/games"));
}

export function listTournaments(filters: TournamentFilters = {}) {
  return fetchJson<TournamentSummary[]>(playUrl("/tournaments", filters));
}

export function getTournamentDetails(id: string) {
  assertTournamentId(id);
  return fetchJson<TournamentDetails>(playUrl(`/tournaments/${id}/details`));
}

export function getTournamentStandings(id: string) {
  assertTournamentId(id);
  return fetchJson<Standing[]>(playUrl(`/tournaments/${id}/standings`));
}

export function getTournamentPairings(id: string) {
  assertTournamentId(id);
  return fetchJson<Pairing[]>(playUrl(`/tournaments/${id}/pairings`));
}

export function getDeckClassificationRules(game = "PTCG") {
  if (!/^[A-Z0-9_-]{2,20}$/.test(game)) throw new Error("Invalid game ID.");
  return fetchJson<unknown[]>(playUrl(`/games/${game}/decks`), {
    headers: authenticatedHeaders(),
  });
}
