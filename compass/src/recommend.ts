import type { ActivitySummary } from "./activity.js";
import type { CatalogSnapshot } from "./catalog.js";
import { CDP_DISCOVERY_RESOURCES_URL } from "./constants.js";
import { isBaseUsdcAccept, priceUsd, scoreService, type RecommendFilters, type ScoredService } from "./rank.js";

export type RecommendQuery = RecommendFilters & { limit: number };

export async function buildRecommendation(
  query: RecommendQuery,
  snapshot: CatalogSnapshot,
  options: {
    now: number;
    enrichLimit: number;
    loadActivity: (payTo: string) => Promise<ActivitySummary | null>;
  }
) {
  const preliminary = snapshot.services
    .map(service =>
      scoreService(service, query, {
        now: options.now,
        activity: null,
        activityStatus: "skipped"
      })
    )
    .filter((item): item is ScoredService => item !== null);
  preliminary.sort(compareScored);

  const enrichTargets = preliminary.filter(item => isBaseUsdcAccept(item.accept)).slice(0, options.enrichLimit);
  const enrichKeys = new Set(enrichTargets.map(enrichKey));
  const pending = new Map<string, Promise<ActivitySummary | null>>();
  const load = (payTo: string) => {
    const key = payTo.toLowerCase();
    const existing = pending.get(key);
    if (existing) return existing;
    const task = options.loadActivity(payTo).catch(() => null);
    pending.set(key, task);
    return task;
  };
  await Promise.all(enrichTargets.map(item => load(item.accept.payTo)));

  const rescored: ScoredService[] = [];
  for (const item of preliminary) {
    if (!enrichKeys.has(enrichKey(item))) {
      rescored.push(item);
      continue;
    }
    const activity = await load(item.accept.payTo);
    const scored = scoreService(item.service, query, {
      now: options.now,
      activity,
      activityStatus: activity ? "ok" : "unavailable"
    });
    if (scored) rescored.push(scored);
  }
  rescored.sort(compareScored);

  const notes: string[] = [];
  if (snapshot.stale) notes.push("Catalog is older than the refresh interval. Results use the last successful copy.");
  if (!snapshot.complete) {
    notes.push(`Catalog sync is partial. Results cover the newest ${snapshot.services.length} indexed resources fetched so far.`);
  }
  if (rescored.length === 0) notes.push("No Bazaar listings matched this query and filters.");

  return {
    query: {
      q: query.q,
      maxPrice: query.maxPrice ?? null,
      network: query.network ?? null,
      asset: query.asset ?? null,
      limit: query.limit
    },
    matchCount: rescored.length,
    recommendations: rescored.slice(0, query.limit).map(toRecommendation),
    catalog: {
      source: CDP_DISCOVERY_RESOURCES_URL,
      fetchedAt: snapshot.fetchedAt,
      resourceCount: snapshot.services.length,
      indexedTotal: snapshot.total,
      complete: snapshot.complete,
      stale: snapshot.stale
    },
    notes
  };
}

function toRecommendation(item: ScoredService) {
  return {
    url: item.service.resource,
    method: item.service.method,
    price: priceUsd(item.accept),
    network: item.accept.network,
    asset: item.accept.asset,
    description: item.service.description,
    qualityScore: item.qualityScore,
    reasons: item.reasons,
    signals: {
      flags: item.flags,
      matchedTerms: item.matchedTerms,
      relevance: Number(item.relevance.toFixed(3)),
      payTo: item.accept.payTo,
      amount: item.accept.amount,
      assetName: item.accept.assetName,
      scheme: item.accept.scheme,
      curated: item.service.curated,
      lastUpdated: item.service.lastUpdated,
      cdpQuality: item.service.quality,
      activityStatus: item.activityStatus,
      activity: item.activity
    }
  };
}

function compareScored(left: ScoredService, right: ScoredService) {
  if (right.qualityScore !== left.qualityScore) return right.qualityScore - left.qualityScore;
  if (right.relevance !== left.relevance) return right.relevance - left.relevance;
  const leftAmount = amountNumber(left);
  const rightAmount = amountNumber(right);
  if (leftAmount !== rightAmount) return leftAmount - rightAmount;
  return left.service.resource.localeCompare(right.service.resource);
}

function amountNumber(item: ScoredService) {
  return /^\d+$/.test(item.accept.amount) ? Number(item.accept.amount) : Number.MAX_SAFE_INTEGER;
}

function enrichKey(item: ScoredService) {
  return `${item.service.resource} ${item.accept.payTo.toLowerCase()}`;
}
