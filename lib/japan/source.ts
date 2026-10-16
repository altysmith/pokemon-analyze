export type JapanListingEvent = {
  id: string;
  sourceUrl: string;
  eventDate: string;
  prefectureRaw: string;
  shopRaw: string;
};

export type JapanPlacement = {
  sourceRow: number;
  placing: number;
  playerNameRaw: string;
  playerUrl: string | null;
  archetypeRaw: string | null;
  decklistUrl: string | null;
};

export type JapanEventSnapshot = JapanListingEvent & {
  knownPlayerCount: number | null;
  placements: JapanPlacement[];
};

export interface JapanSource {
  listEvents(): Promise<JapanListingEvent[]>;
  getEvent(event: JapanListingEvent): Promise<JapanEventSnapshot>;
}
