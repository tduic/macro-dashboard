// Mirrors the backend response shapes (backend/main.py + data/*).

export type Delta = {
  abs: number;
  pct: number | null;
} | null;

export type ChangeType = "pct" | "bps";

export interface Indicator {
  id: string;
  label: string;
  category: string;
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
