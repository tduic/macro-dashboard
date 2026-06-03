// Mirrors the backend response shapes (backend/main.py + data/*).

export type Delta = {
  abs: number;
  pct: number | null;
} | null;

export type ChangeType = "pct" | "bps";

export type EquityView = "etf" | "index";

export interface Indicator {
  id: string;
  label: string;
  category: string;
  // Optional sub-group inside a category. For Equities: "etf" or "index" so
  // the UI can toggle which set to show. Null/undefined means "always show".
  group?: string | null;
  value: number;
  unit: string;
  asOf: string;
  changeType: ChangeType;
  source: string;
  change: {
    wow: Delta;
    mom: Delta;
    ytd: Delta;
  };
  // Last ~30 daily closes (or ~12 monthly prints for releases) — rendered as
  // an inline sparkline on each card.
  sparkline?: number[];
  meta?: {
    priorPrint?: number | null;
    changeLabels?: Partial<Record<"wow" | "mom" | "ytd", string>>;
  };
}

export interface IndicatorsResponse {
  asOf: string;
  fredEnabled: boolean;
  count: number;
  indicators: Indicator[];
}

export interface HistoryPoint {
  date: string;
  value: number;
}

export interface HistoryResponse {
  id: string;
  range: string;
  points: HistoryPoint[];
}

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string | null;
  category: string;
  topics: string[];
}

export interface NewsResponse {
  asOf: string;
  count: number;
  items: NewsItem[];
}

export interface CalendarItem {
  name: string;
  releaseDate: string;
  source: string;
}

export interface CalendarResponse {
  enabled: boolean;
  count?: number;
  items: CalendarItem[];
}

export interface MetaResponse {
  fredEnabled: boolean;
  categories: string[];
  lastRefreshed: string;
}

export type RangeKey = "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y";
export const RANGES: RangeKey[] = ["1W", "1M", "3M", "6M", "YTD", "1Y", "5Y"];
