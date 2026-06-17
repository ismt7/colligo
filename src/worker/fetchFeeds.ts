/**
 * Core worker logic: fetch every active feed and persist new articles.
 *
 * De-duplication strategy
 * ──────────────────────
 * 1. URL-level  – `Article.url` carries a global `@unique` constraint.
 * 2. GUID-level – `@@unique([feedId, guid])` prevents the same RSS item from
 *                 being saved twice for the same feed even when its URL changes.
 *
 * Both constraints are enforced via `createMany({ skipDuplicates: true })`,
 * which silently ignores rows that would violate any unique index.
 */

import prisma from "../lib/prisma";
import { checkRobotsAndWait } from "./robots";
import { parseFeed } from "./rssParser";

interface FeedResult {
  feedId: number;
  feedUrl: string;
  inserted: number;
  skipped: number;
  error: string | null;
  blockedReason: string | null;
}

/**
 * Process a single feed: parse remote URL → upsert articles.
 * Never throws; errors are captured in the returned result.
 */
async function processFeed(feedId: number, feedUrl: string, feedName: string): Promise<FeedResult> {
  try {
    const robots = await checkRobotsAndWait(feedUrl);
    if (!robots.allowed) {
      return {
        feedId,
        feedUrl,
        inserted: 0,
        skipped: 0,
        error: null,
        blockedReason: robots.reason,
      };
    }

    const parsed = await parseFeed(feedUrl);

    // Back-fill the feed name from the RSS <title> if it was never set.
    if (parsed.title && (!feedName || feedName === feedUrl)) {
      await prisma.feed.update({
        where: { id: feedId },
        data: { name: parsed.title },
      });
    }

    if (parsed.items.length === 0) {
      await prisma.feed.update({
        where: { id: feedId },
        data: { lastFetchedAt: new Date() },
      });
      return { feedId, feedUrl, inserted: 0, skipped: 0, error: null, blockedReason: null };
    }

    // Filter out items without a usable URL (they would fail the NOT NULL / unique check).
    const validItems = parsed.items.filter((item) => item.url.length > 0);
    const skippedMissing = parsed.items.length - validItems.length;

    const result = await prisma.article.createMany({
      data: validItems.map((item) => ({
        feedId,
        title: item.title,
        url: item.url,
        guid: item.guid,
        content: item.content,
        publishedAt: item.publishedAt,
      })),
      skipDuplicates: true, // silently ignores url and (feedId, guid) conflicts
    });

    await prisma.feed.update({
      where: { id: feedId },
      data: { lastFetchedAt: new Date() },
    });

    return {
      feedId,
      feedUrl,
      inserted: result.count,
      skipped: skippedMissing + (validItems.length - result.count),
      error: null,
      blockedReason: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { feedId, feedUrl, inserted: 0, skipped: 0, error: message, blockedReason: null };
  }
}

/**
 * One full fetch cycle:
 *   1. Load every active feed.
 *   2. Process all feeds concurrently (bounded at `WORKER_CONCURRENCY`).
 *   3. Log per-feed results and aggregate totals.
 */
export async function fetchAllFeeds(): Promise<void> {
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? "5", 10);

  const feeds = await prisma.feed.findMany({ where: { active: true } });
  if (feeds.length === 0) {
    console.log("[worker] No active feeds found — nothing to do.");
    return;
  }

  console.log(`[worker] Starting fetch cycle for ${feeds.length} active feed(s).`);

  // Process in batches to limit outbound concurrency.
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalBlocked = 0;

  for (let i = 0; i < feeds.length; i += concurrency) {
    const batch = feeds.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((f) => processFeed(f.id, f.url, f.name)));

    for (const r of results) {
      if (r.blockedReason) {
        console.log(
          `[worker] - feed ${r.feedId} (${r.feedUrl}): blocked by robots.txt (${r.blockedReason})`
        );
        totalBlocked += 1;
      } else if (r.error) {
        console.error(`[worker] ✗ feed ${r.feedId} (${r.feedUrl}): ${r.error}`);
        totalErrors += 1;
      } else {
        console.log(
          `[worker] ✓ feed ${r.feedId} (${r.feedUrl}): ` +
            `+${r.inserted} new, ${r.skipped} skipped`
        );
        totalInserted += r.inserted;
        totalSkipped += r.skipped;
      }
    }
  }

  console.log(
    `[worker] Cycle complete — inserted: ${totalInserted}, skipped: ${totalSkipped}, blocked: ${totalBlocked}, errors: ${totalErrors}`
  );
}
