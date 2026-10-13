export type LimitlessGame = {
  id: string;
  name: string;
  formats: Record<string, string>;
  platforms: Record<string, string>;
  metagame: boolean;
};

export type TournamentSummary = {
  id: string;
  game: string;
  format: string;
  name: string;
  date: string;
  players: number;
};

export type TournamentDetails = TournamentSummary & {
  organizer?: { id: number; name: string; logo?: string };
  platform?: string;
  decklists?: boolean;
  isPublic?: boolean;
  isOnline?: boolean;
  phases?: Array<{
    phase: number;
    type: string;
    rounds: number;
    mode: string;
  }>;
  bannedCards?: unknown[];
  specialRules?: string[];
};

export type Standing = {
  player: string;
  name: string;
  country?: string;
  placing: number;
  record?: { wins: number; losses: number; ties: number };
  decklist?: unknown;
  deck?: { id: string; name: string; icons?: string[] } | null;
  drop?: number | null;
};

export type Pairing = {
  round: number;
  phase: number;
  table?: number;
  match?: string;
  player1: string;
  player2: string;
  winner: string | number;
};

export type OverallMetaDeck = {
  rank: number;
  id: string | null;
  name: string;
  points: number;
  share: number;
  icons: string[];
};

export type LabsEvent = {
  id: string;
  name: string;
  dateLabel: string;
  country: string | null;
  logoUrl: string | null;
  standingsUrl: string;
};

export type SourceHealth = {
  id: "play-api" | "overall-meta" | "labs";
  label: string;
  status: "connected" | "degraded";
  kind: "official-json-api" | "public-html";
  url: string;
  detail: string;
  checkedAt: string;
  latencyMs: number;
};
