// Map an indicator to the macro event "type" (as emitted by /api/events) whose
// release dates anchor it. Used by Related News to surface previous + next
// release context.
export const INDICATOR_EVENT_TYPE: Record<string, string> = {
  // CPI series
  CPIAUCSL: "CPI",
  CPILFESL: "CPI",
  // PCE series
  PCEPI: "PCE",
  PCEPILFE: "PCE",
  // Employment
  PAYEMS: "NFP",
  UNRATE: "NFP",
  // GDP
  GDPC1: "GDP",
  // Retail sales
  RSAFS: "RETAIL",
  // PPI
  PPIACO: "PPI",
  // Fed funds tracks FOMC decisions
  DFF: "FOMC",
};

export function getEventTypeForIndicator(id: string): string | undefined {
  return INDICATOR_EVENT_TYPE[id];
}
