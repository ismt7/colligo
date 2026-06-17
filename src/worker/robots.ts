type RuleType = "allow" | "disallow";

interface RobotsRule {
  type: RuleType;
  pattern: string;
}

interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

interface ParsedRobots {
  groups: RobotsGroup[];
}

interface CachedRobots {
  parsed: ParsedRobots;
  fetchedAt: number;
}

interface RobotsAccess {
  allowed: boolean;
  crawlDelayMs: number;
}

const ROBOTS_CACHE_TTL_MS = 10 * 60 * 1000;
const ROBOTS_FETCH_TIMEOUT_MS = 5_000;

export const WORKER_USER_AGENT = "Colligo RSS Worker/1.0";

const robotsCache = new Map<string, CachedRobots>();
const nextAllowedAtByOrigin = new Map<string, number>();
const originLocks = new Map<string, Promise<void>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  const anchored = escaped.endsWith("$") ? escaped : `${escaped}.*`;
  return new RegExp(`^${anchored}`);
}

function lineWithoutComment(line: string): string {
  const i = line.indexOf("#");
  return i === -1 ? line : line.slice(0, i);
}

function parseDirectiveLine(line: string): { key: string; value: string } | null {
  const i = line.indexOf(":");
  if (i === -1) return null;

  const key = line.slice(0, i).trim().toLowerCase();
  const value = line.slice(i + 1).trim();
  if (!key) return null;
  return { key, value };
}

function parseRobotsTxt(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  let currentGroup: RobotsGroup | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = lineWithoutComment(raw).trim();
    if (!line) {
      currentGroup = null;
      continue;
    }

    const directive = parseDirectiveLine(line);
    if (!directive) continue;

    if (directive.key === "user-agent") {
      if (!currentGroup) {
        currentGroup = { userAgents: [], rules: [], crawlDelaySeconds: null };
        groups.push(currentGroup);
      }
      currentGroup.userAgents.push(directive.value.toLowerCase());
      continue;
    }

    if (!currentGroup) continue;

    if (directive.key === "allow" || directive.key === "disallow") {
      if (!directive.value && directive.key === "disallow") {
        // Empty disallow means "allow all".
        continue;
      }
      currentGroup.rules.push({
        type: directive.key,
        pattern: directive.value,
      });
      continue;
    }

    if (directive.key === "crawl-delay") {
      const delay = Number.parseFloat(directive.value);
      if (Number.isFinite(delay) && delay >= 0) {
        currentGroup.crawlDelaySeconds = delay;
      }
    }
  }

  return { groups };
}

function agentMatches(agentToken: string): boolean {
  const token = agentToken.toLowerCase();
  if (token === "*") return true;
  return WORKER_USER_AGENT.toLowerCase().includes(token);
}

function matchingGroups(parsed: ParsedRobots): RobotsGroup[] {
  const exact: RobotsGroup[] = [];
  const wildcard: RobotsGroup[] = [];

  for (const group of parsed.groups) {
    const hasExact = group.userAgents.some((ua) => ua !== "*" && agentMatches(ua));
    if (hasExact) {
      exact.push(group);
      continue;
    }

    const hasWildcard = group.userAgents.some((ua) => ua === "*");
    if (hasWildcard) {
      wildcard.push(group);
    }
  }

  return exact.length > 0 ? exact : wildcard;
}

function chooseRule(rules: RobotsRule[], targetPath: string): RobotsRule | null {
  let best: RobotsRule | null = null;
  let bestLength = -1;

  for (const rule of rules) {
    if (!rule.pattern) continue;
    const regex = wildcardToRegExp(rule.pattern);
    if (!regex.test(targetPath)) continue;

    const length = rule.pattern.replace(/\*|\$/g, "").length;
    if (length > bestLength) {
      best = rule;
      bestLength = length;
      continue;
    }

    if (length === bestLength && best && best.type === "disallow" && rule.type === "allow") {
      // On tie, Allow wins.
      best = rule;
    }
  }

  return best;
}

function evaluateRobots(parsed: ParsedRobots, feedUrl: URL): RobotsAccess {
  const groups = matchingGroups(parsed);
  if (groups.length === 0) {
    return { allowed: true, crawlDelayMs: 0 };
  }

  const allRules = groups.flatMap((g) => g.rules);
  const targetPath = `${feedUrl.pathname}${feedUrl.search}`;
  const matched = chooseRule(allRules, targetPath);

  const crawlDelaySeconds = groups
    .map((g) => g.crawlDelaySeconds)
    .filter((v): v is number => v !== null)
    .reduce<number | null>((max, current) => {
      if (max === null) return current;
      return Math.max(max, current);
    }, null);

  return {
    allowed: matched ? matched.type === "allow" : true,
    crawlDelayMs: crawlDelaySeconds ? Math.round(crawlDelaySeconds * 1000) : 0,
  };
}

async function loadRobotsForOrigin(origin: string): Promise<ParsedRobots> {
  const cached = robotsCache.get(origin);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < ROBOTS_CACHE_TTL_MS) {
    return cached.parsed;
  }

  try {
    const response = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": WORKER_USER_AGENT },
      signal: AbortSignal.timeout(ROBOTS_FETCH_TIMEOUT_MS),
    });

    // Missing or inaccessible robots.txt means unrestricted crawling.
    if (!response.ok) {
      const empty = { groups: [] };
      robotsCache.set(origin, { parsed: empty, fetchedAt: now });
      return empty;
    }

    const body = await response.text();
    const parsed = parseRobotsTxt(body);
    robotsCache.set(origin, { parsed, fetchedAt: now });
    return parsed;
  } catch {
    const empty = { groups: [] };
    robotsCache.set(origin, { parsed: empty, fetchedAt: now });
    return empty;
  }
}

async function runWithOriginLock<T>(origin: string, task: () => Promise<T>): Promise<T> {
  const previousTail = originLocks.get(origin) ?? Promise.resolve();

  let releaseLock!: () => void;
  const completion = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const tail = previousTail.then(() => completion);
  originLocks.set(origin, tail);

  await previousTail;
  try {
    return await task();
  } finally {
    releaseLock();
    if (originLocks.get(origin) === tail) {
      originLocks.delete(origin);
    }
  }
}

async function enforceCrawlDelay(origin: string, crawlDelayMs: number): Promise<void> {
  if (crawlDelayMs <= 0) return;

  await runWithOriginLock(origin, async () => {
    const now = Date.now();
    const nextAllowedAt = nextAllowedAtByOrigin.get(origin) ?? 0;
    if (nextAllowedAt > now) {
      await sleep(nextAllowedAt - now);
    }

    nextAllowedAtByOrigin.set(origin, Date.now() + crawlDelayMs);
  });
}

export interface RobotsDecision {
  allowed: boolean;
  reason: string | null;
}

/**
 * Checks robots.txt and applies Crawl-delay for the target feed URL.
 */
export async function checkRobotsAndWait(feedUrl: string): Promise<RobotsDecision> {
  let url: URL;
  try {
    url = new URL(feedUrl);
  } catch {
    return { allowed: false, reason: "invalid URL" };
  }

  const parsed = await loadRobotsForOrigin(url.origin);
  const access = evaluateRobots(parsed, url);

  if (!access.allowed) {
    return { allowed: false, reason: "disallowed by robots.txt" };
  }

  await enforceCrawlDelay(url.origin, access.crawlDelayMs);
  return { allowed: true, reason: null };
}
