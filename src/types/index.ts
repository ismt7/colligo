/**
 * Shared domain types used across the API and worker layers.
 *
 * Keep this file free of framework-specific imports so it can be consumed
 * by both the Express application and the background worker without pulling
 * in unwanted dependencies.
 *
 * Model-specific types derived from Prisma are co-located with their modules.
 */

// ── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationQuery {
  /** 1-based page number (default: 1). */
  page?: number;
  /** Number of items per page (default: 20, max: 100). */
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// ── HTTP / API ────────────────────────────────────────────────────────────────

/** Standard JSON envelope for successful API responses. */
export interface ApiSuccess<T = unknown> {
  data: T;
}

/** Standard JSON envelope for error API responses. */
export interface ApiError {
  error: string;
}

// ── Worker ────────────────────────────────────────────────────────────────────

/** Summary emitted after each feed-fetch cycle. */
export interface FetchCycleResult {
  feedId: number;
  feedUrl: string;
  /** Articles inserted in this cycle. */
  inserted: number;
  /** Articles already present (skipped). */
  skipped: number;
  /** Whether this feed errored during the cycle. */
  error?: string;
}
