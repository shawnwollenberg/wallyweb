import type { ActivitySummary } from "./activity.js";
import type { CatalogService, PaymentAccept } from "./catalog.js";
import { BURST_MIN_TRANSFERS, STALE_AFTER_DAYS } from "./constants.js";
import { assetMatches, atomicToUsd, canonicalNetwork, isUsdcAsset, usdToAtomic } from "./money.js";

const STOPWORDS = new Set(["a", "an", "the", "for", "on", "of", "to", "and", "or", "with", "in", "via", "per"]);

export const signalCatalog = {
  real: [
    "CDP GET /platform/v2/x402/discovery/resources fields: resource URL, description, accepts (scheme, network, amount, asset, payTo), lastUpdated, extensions.bazaar method and input schema, serviceName, tags, and curated.",
    "CDP quality.l30DaysTotalCalls, quality.l30DaysUniquePayers, and quality.lastCalledAt. These are facilitator-reported paid-call counts, not inferred from descriptions.",
    "Base USDC Transfer logs to the listing payTo, read with eth_getLogs on a public Base JSON-RPC. Each log supplies the sender, atomic amount, and block timestamp when the node includes one."
  ],
  heuristic: [
    `Concentrated payers: 8 or more CDP calls from only 1-2 payers in 30 days, or 20 or more calls where the average is at least 40 calls per payer across 3 or fewer payers. Onchain, the same flag is used when one sender is at least 80% of recent Base USDC inflows and there are at least 5 transfers. A single real customer can look like this.`,
    "Self-paid: at least half of recent Base USDC inflows to payTo come from the payTo address itself, with at least 3 transfers. Ordinary USDC transfers are included; they are not proven x402 settlements.",
    `Burst: at least ${BURST_MIN_TRANSFERS} transfers of one identical atomic amount inside 10 minutes from at most 2 senders. Identical amounts by themselves are normal for exact-scheme x402 and are not penalized.`,
    `Stale: CDP quality.lastCalledAt, or lastUpdated when no call time is present, is older than ${STALE_AFTER_DAYS} days. CDP hides listings with no settlement for 30 days, so this is an earlier down-rank, not a removal.`,
    "Shared-host penalty for ngrok, trycloudflare, localtunnel, and localhost. This mirrors CDP's hosting de-weight and is not evidence of padded payments.",
    "A short RPC window with zero inflows is not treated as stale. The window is only a few hours of blocks.",
    "x402scan is not called. Its buyer and merchant endpoints are themselves x402-paid, and Compass does not send payments while ranking."
  ]
};

export type ActivityStatus = "ok" | "unavailable" | "skipped";

export type RecommendFilters = {
  q: string;
  maxPrice?: string;
  network?: string;
  asset?: string;
};

export type ScoredService = {
  service: CatalogService;
  accept: PaymentAccept;
  qualityScore: number;
  relevance: number;
  matchedTerms: string[];
  reasons: string[];
  flags: string[];
  activityStatus: ActivityStatus;
  activity: ActivitySummary | null;
};

export function scoreService(
  service: CatalogService,
  filters: RecommendFilters,
  options: { now: number; activity: ActivitySummary | null; activityStatus: ActivityStatus }
): ScoredService | null {
  const accept = selectAccept(service, filters);
  if (!accept) return null;
  const relevance = scoreRelevance(filters.q, service.haystack);
  if (relevance.total === 0 || relevance.matched.length === 0) return null;

  let score = Math.round(relevance.score * 55);
  const reasons = [
    `Matches ${relevance.matched.length} of ${relevance.total} query terms (${relevance.matched.join(", ")}).`
  ];
  const flags: string[] = [];
  const longDescription = service.description.length >= 40;
  if (longDescription || service.hasInputSchema) {
    if (longDescription) score += 4;
    if (service.hasInputSchema) score += 3;
    reasons.push("Listing has a usable description or Bazaar input schema.");
  }
  if (service.curated) {
    score += 4;
    reasons.push("Coinbase marks this listing curated.");
  }

  const calls = service.quality.l30DaysTotalCalls;
  const payers = service.quality.l30DaysUniquePayers;
  if (calls !== null && payers !== null && calls >= 8 && payers > 0 && payers <= 2) {
    score -= 24;
    flags.push("concentrated_payers");
    reasons.push(`Down-ranked: CDP quality shows ${calls} paid calls from only ${payers} payer(s) in 30 days.`);
  } else if (calls !== null && payers !== null && calls >= 20 && payers > 0 && payers <= 3 && calls / payers >= 40) {
    score -= 16;
    flags.push("concentrated_payers");
    reasons.push(`Down-ranked: CDP quality shows ${calls} paid calls across only ${payers} payers.`);
  } else if (calls !== null && payers !== null && payers >= 5 && calls >= 10) {
    score += 8;
    reasons.push(`CDP quality: ${payers} unique payers and ${calls} paid calls in 30 days.`);
  }

  const activityStamp = service.quality.lastCalledAt ?? service.lastUpdated;
  const age = activityStamp ? ageDays(activityStamp, options.now) : null;
  if (age !== null && age >= STALE_AFTER_DAYS) {
    score -= 14;
    flags.push("stale");
    reasons.push(`Down-ranked: last CDP activity at ${activityStamp} is over ${STALE_AFTER_DAYS} days old.`);
  }

  if (service.sharedHost) {
    score -= 6;
    flags.push("shared_host");
    reasons.push("Heuristic: the host looks like a shared tunnel, which CDP also de-weights.");
  }

  if (options.activityStatus === "ok" && options.activity) {
    const activity = options.activity;
    if (activity.transferCount >= 3 && activity.selfPaidShare >= 0.5) {
      score -= 28;
      flags.push("self_paid");
      reasons.push(
        `Down-ranked: ${Math.round(activity.selfPaidShare * 100)}% of recent Base USDC inflows to payTo came from the payTo address.`
      );
    }
    if (activity.burstChecked && activity.burstCount > 0) {
      score -= 18;
      flags.push("burst");
      reasons.push(
        `Down-ranked: ${activity.burstCount} burst(s) of identical USDC amounts from few wallets inside 10 minutes.`
      );
    }
    if (
      !flags.includes("concentrated_payers") &&
      activity.transferCount >= 5 &&
      activity.topPayerShare >= 0.8
    ) {
      score -= 18;
      flags.push("concentrated_payers");
      reasons.push(
        `Down-ranked: ${Math.round(activity.topPayerShare * 100)}% of recent Base USDC inflows came from one wallet.`
      );
    }
    if (activity.transferCount === 0) {
      reasons.push("No inbound Base USDC transfers to payTo in the recent block window. That alone is not treated as stale.");
    } else if (!flags.includes("self_paid") && !flags.includes("burst") && !flags.includes("concentrated_payers")) {
      reasons.push("Recent Base USDC inflows do not show self-payment, a single dominant payer, or a short-window burst.");
    }
    if (!activity.burstChecked) {
      reasons.push("Burst check skipped because the RPC logs had no block timestamps.");
    }
  } else if (options.activityStatus === "unavailable") {
    reasons.push("Base USDC activity lookup failed, so onchain padding signals were not applied.");
  }

  return {
    service,
    accept,
    qualityScore: clamp(score, 0, 100),
    relevance: relevance.score,
    matchedTerms: relevance.matched,
    reasons,
    flags,
    activityStatus: options.activityStatus,
    activity: options.activity
  };
}

export function selectAccept(service: CatalogService, filters: RecommendFilters): PaymentAccept | null {
  let matches = service.accepts.filter(accept => accept.scheme && accept.network && accept.amount && accept.asset && accept.payTo);
  if (filters.network) {
    const network = canonicalNetwork(filters.network);
    matches = matches.filter(accept => canonicalNetwork(accept.network) === network);
  }
  if (filters.asset) {
    matches = matches.filter(accept => assetMatches(accept.asset, accept.assetName, filters.asset ?? ""));
  }
  if (filters.maxPrice) {
    const cap = usdToAtomic(filters.maxPrice);
    if (cap === null) return null;
    matches = matches.filter(accept => {
      const amount = priceAtomic(accept);
      return amount !== null && amount <= cap;
    });
  }
  if (matches.length === 0) return null;
  return [...matches].sort(compareAccepts)[0] ?? null;
}

export function isBaseUsdcAccept(accept: PaymentAccept) {
  return canonicalNetwork(accept.network) === "eip155:8453" && isUsdcAsset(accept.asset, accept.assetName);
}

export function priceUsd(accept: PaymentAccept) {
  const atomic = priceAtomic(accept);
  return atomic === null ? null : atomicToUsd(atomic.toString());
}

function scoreRelevance(query: string, haystack: string) {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return { score: 0, matched: [] as string[], total: 0 };
  const matched = terms.filter(term => haystack.includes(term));
  let score = matched.length / terms.length;
  const phrase = query.trim().toLowerCase();
  if (phrase.length >= 6 && haystack.includes(phrase)) score = Math.min(1, score + 0.15);
  return { score: Math.min(1, score), matched, total: terms.length };
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length >= 2 && !STOPWORDS.has(term));
}

function compareAccepts(left: PaymentAccept, right: PaymentAccept) {
  return acceptRank(left) - acceptRank(right) || amountRank(left) - amountRank(right);
}

function acceptRank(accept: PaymentAccept) {
  let rank = 0;
  if (accept.scheme.toLowerCase() !== "exact") rank += 4;
  if (canonicalNetwork(accept.network) !== "eip155:8453") rank += 2;
  if (!isUsdcAsset(accept.asset, accept.assetName)) rank += 1;
  return rank;
}

function amountRank(accept: PaymentAccept) {
  const atomic = priceAtomic(accept);
  if (atomic === null) return Number.MAX_SAFE_INTEGER;
  return Number(atomic > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : atomic);
}

function priceAtomic(accept: PaymentAccept) {
  if (!isUsdcAsset(accept.asset, accept.assetName)) return null;
  if (!/^\d+$/.test(accept.amount)) return null;
  return BigInt(accept.amount);
}

function ageDays(iso: string, now: number) {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return (now - parsed) / 86_400_000;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
