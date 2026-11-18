export const groups = [
  "socketable",
  "lineage_supports",
  "crafting",
  "uniques",
  "boss_fragments",
] as const;
export type Group = (typeof groups)[number];
export const exchange = [
  "Currency",
  "Fragments",
  "Runes",
  "SoulCores",
  "Idols",
  "LineageSupportGems",
  "Essences",
  "Ritual",
  "Breach",
  "Delirium",
  "Abyss",
  "Verisium",
  "UncutGems",
  "Expedition",
] as const;
export const stash = [
  "UniqueWeapons",
  "UniqueArmours",
  "UniqueAccessories",
  "UniqueFlasks",
  "UniqueCharms",
  "UniqueJewels",
  "UniqueSanctumRelics",
  "UniqueTablets",
  "PrecursorTablets",
] as const;
export const sources: readonly string[] = [...exchange, ...stash];
export interface Observation {
  league: string;
  source: string;
  id: string;
  key: string;
  name: string;
  variant: string;
  corrupted: boolean;
  price: number;
  original: number;
  primary: string;
  rates: Record<string, number>;
  activity: number;
  at: number;
  evidence: string;
  group: Group | "currency" | null;
  epoch: string;
}
export interface SourceState {
  at: number;
  changed: number;
  fingerprint: string;
  etag: string;
  nextFetch: number;
  observations: Observation[];
  error?: string;
}
export interface History {
  version: 1;
  league: string;
  sources: Record<string, SourceState>;
  observations: Observation[];
}
export interface Card {
  color?: string | number;
  title?: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}
export interface Payload {
  text?: string;
  cards?: Card[];
}
export interface Part {
  payload: Payload;
  status: "pending" | "sending" | "sent" | "unknown" | "canceled" | "rejected";
  messageId?: string;
  retryAt?: number;
}
export interface Report {
  day: string;
  league: string;
  epoch: string;
  expires: number;
  parts: Part[];
}
export interface Pending {
  direction: number;
  count: number;
  evidence: string;
  at: number;
}
export interface AlertMemory {
  pending?: Pending;
  lastAt?: number;
  lastPrice?: number;
  armed?: boolean;
}
export interface Signal {
  key: string;
  group: Group;
  direction: number;
  price?: number;
  baseline?: number;
  percent: number;
  activity: number;
  source: string;
  name: string;
  evidence: string;
  count?: number;
  denominator?: number;
  interval: number;
  score: number;
}
export interface AlertDelivery {
  day: string;
  part: Part;
  signals: Signal[];
  expires: number;
}
export interface State {
  version: 1;
  league: string | null;
  epoch: string;
  reports: Report[];
  alerts: AlertDelivery[];
  memory: Record<string, AlertMemory>;
}
export const emptyState = (): State => ({
  version: 1,
  league: null,
  epoch: "",
  reports: [],
  alerts: [],
  memory: {},
});
export const emptyHistory = (league: string): History => ({
  version: 1,
  league,
  sources: {},
  observations: [],
});
export const HOUR = 3600000;
export function positive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}
export function record(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw Error("Expected object");
  return x as Record<string, unknown>;
}
