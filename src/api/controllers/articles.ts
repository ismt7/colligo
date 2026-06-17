import { Prisma } from "@prisma/client";
import { Request, Response, NextFunction } from "express";
import prisma from "../../lib/prisma";
import { HttpError } from "../middleware/errorHandler";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const BALANCE_MODE_WEIGHTED = "weighted";

type ArticleSortOrder = "asc" | "desc";

type BalancedArticleIdRow = {
  id: number;
};

function buildBalancedArticlesQuery(
  sortOrder: ArticleSortOrder,
  limit: number,
  skip: number,
  feedId?: number,
  sinceDate?: Date
): Prisma.Sql {
  const sortDirection = Prisma.raw(sortOrder.toUpperCase());
  const idDirection = Prisma.raw(sortOrder === "asc" ? "ASC" : "DESC");

  return Prisma.sql`
    WITH filtered_articles AS (
      SELECT a.id, a.feed_id, a.published_at
      FROM articles a
      WHERE 1 = 1
      ${feedId !== undefined ? Prisma.sql`AND a.feed_id = ${feedId}` : Prisma.empty}
      ${sinceDate !== undefined ? Prisma.sql`AND a.published_at > ${sinceDate}` : Prisma.empty}
    ),
    ranked_articles AS (
      SELECT
        fa.id,
        fa.published_at,
        ROW_NUMBER() OVER (
          PARTITION BY fa.feed_id
          ORDER BY fa.published_at ${sortDirection} NULLS LAST, fa.id ${idDirection}
        ) AS feed_rank
      FROM filtered_articles fa
    )
    SELECT ra.id
    FROM ranked_articles ra
    ORDER BY ra.feed_rank ASC, ra.published_at ${sortDirection} NULLS LAST, ra.id ${idDirection}
    OFFSET ${skip}
    LIMIT ${limit}
  `;
}

/**
 * GET /articles
 * GET /feeds/:feedId/articles
 *
 * Query params:
 *   feedId  – filter by feed (only for /articles; ignored on /feeds/:feedId/articles)
 *   page    – 1-based page number (default 1)
 *   limit   – page size (default 20, max 100)
 *   since   – ISO 8601 timestamp; return only articles published after this date
 *   sort    – sort order for publishedAt: "desc" (default) or "asc"
 *   balance – optional mode for reducing feed skew across /articles results
 */
export async function listArticles(
  req: Request<{ feedId?: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Feed ID can come from the route param (nested route) or query string
    const rawFeedId = req.params.feedId ?? (req.query.feedId as string | undefined);
    const feedId = rawFeedId !== undefined ? parseInt(rawFeedId, 10) : undefined;
    if (feedId !== undefined && isNaN(feedId)) {
      throw new HttpError(400, "feedId must be a number");
    }
    // Verify the feed exists when scoped by ID
    if (feedId !== undefined) {
      const feed = await prisma.feed.findUnique({ where: { id: feedId } });
      if (!feed) throw new HttpError(404, "Feed not found");
    }

    const page = Math.max(1, parseInt((req.query.page as string | undefined) ?? "1", 10) || 1);
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(
        1,
        parseInt((req.query.limit as string | undefined) ?? String(DEFAULT_PAGE_SIZE), 10) ||
          DEFAULT_PAGE_SIZE
      )
    );
    const skip = (page - 1) * limit;

    const since = req.query.since as string | undefined;
    const sinceDate = since ? new Date(since) : undefined;
    if (sinceDate !== undefined && isNaN(sinceDate.getTime())) {
      throw new HttpError(400, "since must be a valid ISO 8601 date");
    }

    const sortParam = (req.query.sort as string | undefined) ?? "desc";
    if (sortParam !== "asc" && sortParam !== "desc") {
      throw new HttpError(400, 'sort must be "asc" or "desc"');
    }
    const sortOrder: ArticleSortOrder = sortParam;

    const balanceParam = req.query.balance as string | undefined;
    if (balanceParam !== undefined && balanceParam !== BALANCE_MODE_WEIGHTED) {
      throw new HttpError(400, 'balance must be "weighted"');
    }
    const useBalancedOrdering = balanceParam === BALANCE_MODE_WEIGHTED && feedId === undefined;

    const where = {
      ...(feedId !== undefined ? { feedId } : {}),
      ...(sinceDate !== undefined ? { publishedAt: { gt: sinceDate } } : {}),
    };

    const [total, articles] = useBalancedOrdering
      ? await prisma.$transaction(async (tx) => {
          const totalCount = await tx.article.count({ where });
          const articleIds = await tx.$queryRaw<BalancedArticleIdRow[]>(
            buildBalancedArticlesQuery(sortOrder, limit, skip, undefined, sinceDate)
          );

          if (articleIds.length === 0) {
            return [totalCount, []] as const;
          }

          const articlesById = await tx.article.findMany({
            where: { id: { in: articleIds.map((article) => article.id) } },
            include: {
              feed: { select: { id: true, name: true, url: true } },
            },
          });

          const orderedArticles = articleIds
            .map((article) => articlesById.find((candidate) => candidate.id === article.id))
            .filter((article): article is (typeof articlesById)[number] => article !== undefined);

          return [totalCount, orderedArticles] as const;
        })
      : await prisma.$transaction([
          prisma.article.count({ where }),
          prisma.article.findMany({
            where,
            orderBy: [{ publishedAt: sortOrder }, { id: sortOrder }],
            skip,
            take: limit,
            include: {
              feed: { select: { id: true, name: true, url: true } },
            },
          }),
        ]);

    res.json({
      data: articles,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /articles/:id */
export async function getArticle(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new HttpError(400, "id must be a number");

    const article = await prisma.article.findUnique({
      where: { id },
      include: { feed: { select: { id: true, name: true, url: true } } },
    });
    if (!article) throw new HttpError(404, "Article not found");
    res.json(article);
  } catch (err) {
    next(err);
  }
}
