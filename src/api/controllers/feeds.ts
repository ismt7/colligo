import { Request, Response, NextFunction } from "express";
import prisma from "../../lib/prisma";
import { HttpError } from "../middleware/errorHandler";

/** GET /feeds */
export async function listFeeds(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const feeds = await prisma.feed.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(feeds);
  } catch (err) {
    next(err);
  }
}

/** GET /feeds/:id */
export async function getFeed(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = parseId(req.params.id);
    const feed = await prisma.feed.findUnique({ where: { id } });
    if (!feed) throw new HttpError(404, "Feed not found");
    res.json(feed);
  } catch (err) {
    next(err);
  }
}

/** POST /feeds */
export async function createFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { url, name, active } = req.body as {
      url?: unknown;
      name?: unknown;
      active?: unknown;
    };
    if (typeof url !== "string" || !url.trim()) {
      throw new HttpError(400, "url is required");
    }
    if (typeof name !== "string" || !name.trim()) {
      throw new HttpError(400, "name is required");
    }
    const feed = await prisma.feed.create({
      data: {
        url: url.trim(),
        name: name.trim(),
        active: typeof active === "boolean" ? active : true,
      },
    });
    res.status(201).json(feed);
  } catch (err) {
    next(err);
  }
}

/** PATCH /feeds/:id */
export async function patchFeed(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = parseId(req.params.id);
    const { url, name, active } = req.body as {
      url?: unknown;
      name?: unknown;
      active?: unknown;
    };
    const data: { url?: string; name?: string; active?: boolean } = {};
    if (typeof url === "string" && url.trim()) data.url = url.trim();
    if (typeof name === "string" && name.trim()) data.name = name.trim();
    if (typeof active === "boolean") data.active = active;

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "At least one of url, name, or active is required");
    }

    const feed = await prisma.feed
      .update({ where: { id }, data })
      .catch(notFound("Feed not found"));
    res.json(feed);
  } catch (err) {
    next(err);
  }
}

/** DELETE /feeds/:id */
export async function deleteFeed(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = parseId(req.params.id);
    await prisma.feed.delete({ where: { id } }).catch(notFound("Feed not found"));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (isNaN(id)) throw new HttpError(400, "id must be a number");
  return id;
}

function notFound(message: string) {
  return (e: { code?: string }) => {
    if (e.code === "P2025") throw new HttpError(404, message);
    throw e;
  };
}
