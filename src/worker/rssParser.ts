/**
 * RSS/Atom parsing helpers.
 *
 * Wraps `rss-parser` and normalises each feed item into the shape that the
 * worker persists to the database.  All fields except `url` are optional so
 * that malformed feeds still produce usable records.
 */
import Parser from "rss-parser";

// rss-parser is a CommonJS module; the cast keeps TypeScript happy.
const parser = new Parser({
  timeout: 10_000, // 10 s per HTTP request
  headers: { "User-Agent": "Colligo RSS Worker/1.0" },
});

export interface ParsedItem {
  title: string;
  url: string;
  guid: string | null;
  content: string | null;
  publishedAt: Date | null;
}

export interface ParsedFeed {
  title: string | null;
  items: ParsedItem[];
}

/**
 * Fetches and parses the RSS/Atom feed at `feedUrl`.
 * Returns the feed title (if present) and its normalised items.
 *
 * @throws {Error} when the HTTP request fails or the response is not valid XML.
 */
export async function parseFeed(feedUrl: string): Promise<ParsedFeed> {
  const feed = await parser.parseURL(feedUrl);

  const items: ParsedItem[] = (feed.items ?? []).map((item) => {
    // Prefer the canonical link; fall back to the GUID if it looks like a URL.
    const rawUrl = item.link ?? item.guid ?? "";
    const url = rawUrl.startsWith("http") ? rawUrl : (item.guid ?? rawUrl);

    // Normalise the GUID: if the item doesn't have one, derive it from the URL
    // so that we still get per-feed deduplication.
    const guid = item.guid ?? item.id ?? item.link ?? null;

    const rawContent = item["content:encoded"] ?? item.content ?? item.summary ?? null;

    let publishedAt: Date | null = null;
    const rawDate = item.pubDate ?? item.isoDate ?? null;
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) publishedAt = d;
    }

    return {
      title: item.title?.trim() ?? "(no title)",
      url: url.trim(),
      guid: guid ? String(guid).trim() : null,
      content: rawContent ? String(rawContent).trim() : null,
      publishedAt,
    };
  });

  return {
    title: feed.title?.trim() ?? null,
    items,
  };
}
