// World-topic display order for the news feed tabs. Mirrors the keys of
// TOPIC_KEYWORDS in backend/data/news.py — edit there to add a topic, then
// add the name here to control where it shows up.
export const TOPICS = [
  "Fed",
  "Markets",
  "Economy",
  "Energy",
  "Tech",
  "Crypto",
  "China",
  "Geopolitics",
  "Earnings",
] as const;

export type Topic = (typeof TOPICS)[number];
