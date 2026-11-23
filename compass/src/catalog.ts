import fs from "node:fs";
import path from "node:path";
import { CDP_DISCOVERY_RESOURCES_URL, USER_AGENT } from "./constants.js";
import { isTimeoutError, providerError } from "./http-errors.js";

export type PaymentAccept = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  assetName: string | null;
  payTo: string;
};

export type ServiceQuality = {
  l30DaysTotalCalls: number | null;
  l30DaysUniquePayers: number | null;
  lastCalledAt: string | null;
};

export type CatalogService = {
  resource: string;
  description: string;
  method: string;
  serviceName: string | null;
  tags: string[];
  lastUpdated: string | null;
  curated: boolean;
  hasInputSchema: boolean;
  sharedHost: boolean;
  haystack: string;
  accepts: PaymentAccept[];
  quality: ServiceQuality;
};

export type CatalogSnapshot = {
  fetchedAt: string;
  fetchedAtMs: number;
  complete: boolean;
  stale: boolean;
  total: number | null;
  services: CatalogService[];
};

export type DiscoveryPage = {
  items: unknown[];
  pagination: { limit: number; offset: number; total: number | null };
};

type Storage = {
  read: () => CatalogSnapshot | null;
  write: (snapshot: CatalogSnapshot) => void;
};

const CACHE_VERSION = 1;
const PAGE_LIMIT = 1000;
const DESCRIPTION_CAP = 1000;
const SHARED_HOSTS = ["ngrok.io", "ngrok-free.app", "ngrok.app", "trycloudflare.com", "loca.lt", "localhost", "127.0.0.1"];

export function finalizeService(input: Omit<CatalogService, "haystack" | "sharedHost">): CatalogService {
  const haystack = [input.description, input.resource, input.serviceName ?? "", input.tags.join(" "), input.method]
    .join(" ")
    .toLowerCase();
  return {
    ...input,
    haystack,
    sharedHost: isSharedHost(input.resource)
  };
}

export function normalizeResource(raw: unknown): CatalogService | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.resource !== "string" || !item.resource.startsWith("http")) return null;
  const accepts = Array.isArray(item.accepts) ? item.accepts.map(normalizeAccept).filter(accept => accept !== null) : [];
  if (accepts.length === 0) return null;
  const extensions = objectRecord(item.extensions);
  const bazaar = objectRecord(extensions?.bazaar);
  const info = objectRecord(bazaar?.info);
  const input = objectRecord(info?.input);
  const method = typeof input?.method === "string" && input.method.trim() ? input.method.trim().toUpperCase() : "UNKNOWN";
  const description = typeof item.description === "string" ? item.description.trim().slice(0, DESCRIPTION_CAP) : "";
  const tags = Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 12) : [];
  return finalizeService({
    resource: item.resource,
    description,
    method,
    serviceName: typeof item.serviceName === "string" ? item.serviceName : null,
    tags,
    lastUpdated: typeof item.lastUpdated === "string" ? item.lastUpdated : null,
    curated: item.curated === true,
    hasInputSchema: hasInputSchema(input, bazaar),
    accepts,
    quality: normalizeQuality(item.quality)
  });
}

export async function fetchDiscoveryPage(
  offset: number,
  limit = PAGE_LIMIT,
  fetchImpl: typeof fetch = fetch
): Promise<DiscoveryPage> {
  const url = new URL(CDP_DISCOVERY_RESOURCES_URL);
  url.searchParams.set("type", "http");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      throw providerError(`CDP discovery list returned HTTP ${response.status}.`, { timeout: response.status === 504 });
    }
    const body = (await response.json()) as { items?: unknown; pagination?: { limit?: number; offset?: number; total?: number } };
    const items = Array.isArray(body.items) ? body.items : [];
    return {
      items,
      pagination: {
        limit: typeof body.pagination?.limit === "number" ? body.pagination.limit : limit,
        offset: typeof body.pagination?.offset === "number" ? body.pagination.offset : offset,
        total: typeof body.pagination?.total === "number" ? body.pagination.total : null
      }
    };
  } catch (error) {
    if (error instanceof Error && (error.name === "ProviderError" || error.name === "ProviderTimeoutError")) throw error;
    throw providerError(
      isTimeoutError(error) ? "CDP discovery list timed out." : "CDP discovery list request failed.",
      { timeout: isTimeoutError(error) }
    );
  }
}

export function createCatalogCache(options: {
  fetchPage: (offset: number, limit: number) => Promise<DiscoveryPage>;
  ttlMs: number;
  maxResources: number;
  budgetMs: number;
  now?: () => number;
  storage?: Storage;
}) {
  const now = options.now ?? (() => Date.now());
  let memory: CatalogSnapshot | null = null;
  let inflight: Promise<CatalogSnapshot> | null = null;

  function readStorage() {
    try {
      return options.storage?.read() ?? null;
    } catch {
      return null;
    }
  }

  function current() {
    if (memory) return memory;
    const disk = readStorage();
    if (disk) memory = disk;
    return memory;
  }

  function isFresh(snapshot: CatalogSnapshot) {
    return !snapshot.stale && now() - snapshot.fetchedAtMs < options.ttlMs;
  }

  async function refresh(): Promise<CatalogSnapshot> {
    const started = now();
    const first = await options.fetchPage(0, PAGE_LIMIT);
    const step = first.pagination.limit > 0 ? first.pagination.limit : PAGE_LIMIT;
    const total = first.pagination.total;
    const collected: Array<{ offset: number; page: DiscoveryPage }> = [{ offset: 0, page: first }];
    let hitBudget = false;

    if (first.items.length > 0 && total !== null && step < total && now() - started < options.budgetMs) {
      const offsets: number[] = [];
      const pageCap = Math.ceil(options.maxResources / Math.max(step, 1));
      for (let offset = step; offset < total && offsets.length < pageCap; offset += step) offsets.push(offset);
      let cursor = 0;
      const workers = Math.min(4, offsets.length);
      await Promise.all(
        Array.from({ length: workers }, async () => {
          while (cursor < offsets.length) {
            if (now() - started >= options.budgetMs) {
              hitBudget = true;
              return;
            }
            const offset = offsets[cursor];
            cursor += 1;
            if (offset === undefined) return;
            collected.push({ offset, page: await options.fetchPage(offset, PAGE_LIMIT) });
          }
        })
      );
    }

    collected.sort((left, right) => left.offset - right.offset);
    const services: CatalogService[] = [];
    const seen = new Set<string>();
    let hitMax = false;
    for (const entry of collected) {
      for (const item of entry.page.items) {
        const service = normalizeResource(item);
        if (!service || seen.has(service.resource)) continue;
        seen.add(service.resource);
        services.push(service);
        if (services.length >= options.maxResources) {
          hitMax = true;
          break;
        }
      }
      if (hitMax) break;
    }

    const coveredThrough = collected.reduce((max, entry) => Math.max(max, entry.offset + step), 0);
    const complete = !hitMax && !hitBudget && total !== null && first.items.length > 0 && coveredThrough >= total;

    if (services.length === 0) {
      throw providerError("CDP discovery list returned no usable resources.");
    }

    if (!process.env.NODE_TEST_CONTEXT) {
      console.log(
        `x402 Compass catalog refreshed: ${services.length} resources, complete=${complete}, ${Math.max(0, now() - started)}ms`
      );
    }

    return {
      fetchedAt: new Date(now()).toISOString(),
      fetchedAtMs: now(),
      complete,
      stale: false,
      total,
      services
    };
  }

  return {
    stats() {
      const snapshot = current();
      return {
        loaded: Boolean(snapshot),
        resourceCount: snapshot?.services.length ?? 0,
        complete: snapshot?.complete ?? false,
        stale: snapshot ? snapshot.stale || !isFresh(snapshot) : false,
        fetchedAt: snapshot?.fetchedAt ?? null,
        ageSeconds: snapshot ? Math.max(0, Math.round((now() - snapshot.fetchedAtMs) / 1000)) : null,
        ttlSeconds: Math.round(options.ttlMs / 1000),
        indexedTotal: snapshot?.total ?? null
      };
    },
    get(): Promise<CatalogSnapshot> {
      const snapshot = current();
      if (snapshot && isFresh(snapshot)) return Promise.resolve(snapshot);
      if (inflight) return inflight;
      inflight = refresh()
        .then(fresh => {
          memory = fresh;
          try {
            options.storage?.write(fresh);
          } catch {
            // A cache write failure still leaves the in-memory snapshot usable.
          }
          return fresh;
        })
        .catch(error => {
          const fallback = memory ?? readStorage();
          if (!fallback) throw error;
          const stale = { ...fallback, stale: true };
          memory = stale;
          return stale;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    }
  };
}

export function fileCatalogStorage(filePath: string): Storage {
  return {
    read() {
      if (!fs.existsSync(filePath)) return null;
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { version?: number; snapshot?: CatalogSnapshot };
      if (parsed.version !== CACHE_VERSION || !parsed.snapshot || !Array.isArray(parsed.snapshot.services)) return null;
      return parsed.snapshot;
    },
    write(snapshot) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ version: CACHE_VERSION, snapshot }));
      fs.renameSync(temporary, filePath);
    }
  };
}

function normalizeAccept(raw: unknown): PaymentAccept | null {
  if (!raw || typeof raw !== "object") return null;
  const accept = raw as Record<string, unknown>;
  if (typeof accept.scheme !== "string" || typeof accept.network !== "string") return null;
  if (typeof accept.amount !== "string" || typeof accept.asset !== "string" || typeof accept.payTo !== "string") return null;
  const extra = objectRecord(accept.extra);
  const assetName = typeof extra?.name === "string" ? extra.name : null;
  return {
    scheme: accept.scheme,
    network: accept.network,
    amount: accept.amount,
    asset: accept.asset,
    assetName,
    payTo: accept.payTo
  };
}

function normalizeQuality(raw: unknown): ServiceQuality {
  const quality = objectRecord(raw);
  return {
    l30DaysTotalCalls: numberOrNull(quality?.l30DaysTotalCalls),
    l30DaysUniquePayers: numberOrNull(quality?.l30DaysUniquePayers),
    lastCalledAt: typeof quality?.lastCalledAt === "string" ? quality.lastCalledAt : null
  };
}

function hasInputSchema(input: Record<string, unknown> | null, bazaar: Record<string, unknown> | null) {
  const schema = objectRecord(bazaar?.schema);
  const properties = objectRecord(schema?.properties);
  if (properties && "input" in properties) return true;
  if (!input) return false;
  return ["queryParams", "body", "bodyFields"].some(key => {
    const value = input[key];
    return Boolean(value && typeof value === "object" && Object.keys(value as object).length > 0);
  });
}

function isSharedHost(resourceUrl: string) {
  try {
    const host = new URL(resourceUrl).hostname.toLowerCase();
    return SHARED_HOSTS.some(item => host === item || host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
