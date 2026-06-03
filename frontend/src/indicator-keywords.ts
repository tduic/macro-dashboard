// Per-indicator news-search keywords. The Chart modal's News tab filters the
// global news feed to items whose headline contains any of these substrings
// (case-insensitive). Edit to refine matches.

const KW: Record<string, string[]> = {
  // Equities — ETFs and their underlying indices share keywords
  SPY: ["s&p", "sp500", "sp 500"],
  GSPC: ["s&p", "sp500", "sp 500"],
  QQQ: ["nasdaq", "qqq"],
  IXIC: ["nasdaq"],
  DIA: ["dow", "djia"],
  DJI: ["dow", "djia"],
  IWM: ["russell", "small cap", "small-cap"],
  RUT: ["russell", "small cap", "small-cap"],
  VIX: ["vix", "volatility"],

  // Rates
  DGS2: ["2-year", "2 year treasur", "2yr treasur", "two-year"],
  DGS10: ["10-year", "10 year treasur", "10yr treasur", "ten-year"],
  DGS30: ["30-year", "30 year treasur", "thirty-year"],
  T10Y2Y: ["yield curve", "2s10s", "curve invert", "inverted curve"],
  DFF: ["fed funds", "fomc", "powell", "rate cut", "rate hike", "fed chair", "federal reserve"],
  ICSA: ["jobless claims", "initial claims", "unemployment claims"],

  // FX
  DXY: ["dollar index", "dxy", "us dollar"],
  EURUSD: ["euro", "eur/usd", "eurusd", "ecb"],
  USDJPY: ["yen", "usd/jpy", "boj", "bank of japan", "japanese"],
  GBPUSD: ["pound", "sterling", "boe", "bank of england", "gbp"],

  // Energy & metals
  WTI: ["oil", "crude", "wti", "opec"],
  BRENT: ["brent", "oil", "crude", "opec"],
  NATGAS: ["natural gas", "lng", "ngas"],
  GOLD: ["gold"],
  SILVER: ["silver"],
  COPPER: ["copper"],

  // Ags / softs
  CORN: ["corn"],
  WHEAT: ["wheat"],
  SOY: ["soybean", "soy"],
  SUGAR: ["sugar"],
  COFFEE: ["coffee"],
  COCOA: ["cocoa"],

  // Economic releases
  CPIAUCSL: ["cpi", "inflation"],
  CPILFESL: ["core cpi", "inflation"],
  PCEPI: ["pce", "personal consumption", "personal income"],
  PCEPILFE: ["core pce", "pce inflation"],
  PAYEMS: ["payroll", "nonfarm", "nfp", "jobs report", "jobs added", "jobs data"],
  UNRATE: ["unemployment rate", "unemployment", "jobless rate"],
  GDPC1: ["gdp"],
  RSAFS: ["retail sales"],
  PPIACO: ["ppi", "producer price"],

  // Crypto
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "ether ", "eth "],
};

export function getIndicatorKeywords(id: string): string[] {
  return KW[id] ?? [];
}

export function findRelatedNews<T extends { title: string }>(
  items: readonly T[],
  indicatorId: string,
): T[] {
  const kws = getIndicatorKeywords(indicatorId);
  if (!kws.length) return [];
  return items.filter((it) => {
    const t = it.title.toLowerCase();
    return kws.some((k) => t.includes(k));
  });
}
