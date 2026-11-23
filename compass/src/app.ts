import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createActivityCache, fetchInboundUsdcTransfers } from "./activity.js";
import { createCatalogCache, fetchDiscoveryPage, fileCatalogStorage } from "./catalog.js";
import { config } from "./config.js";
import { SERVICE_VERSION } from "./constants.js";
import { formatZodError, toHttpError } from "./http-errors.js";
import { buildRecommendation } from "./recommend.js";
import { signalCatalog } from "./rank.js";
import { parseRecommendQuery, recommendRouteDescription, type ParsedRecommendQuery } from "./schemas.js";
import { createPaymentMiddleware, paymentRouteConfig } from "./x402.js";

const RECOMMEND_PATH = "/v1/x402/recommend";

export function createApp() {
  const app = express();
  const catalog = createCatalogCache({
    fetchPage: (offset, limit) => fetchDiscoveryPage(offset, limit),
    ttlMs: config.catalogTtlSeconds * 1000,
    maxResources: config.catalogMaxResources,
    budgetMs: config.catalogBudgetMs,
    storage: fileCatalogStorage(config.catalogCachePath)
  });
  const activity = createActivityCache({
    ttlMs: config.catalogTtlSeconds * 1000,
    load: payTo =>
      fetchInboundUsdcTransfers(payTo, {
        rpcUrl: config.baseRpcUrl,
        lookbackBlocks: config.activityLookbackBlocks,
        timeoutMs: config.activityTimeoutMs
      })
  });

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, HEAD, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, payment-signature, x-payment");
    res.setHeader("access-control-expose-headers", "payment-required, payment-response, x-payment-required, x-payment-response");
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      name: "x402 Compass",
      version: SERVICE_VERSION,
      description: recommendRouteDescription(config.x402PriceUsd),
      status: `${config.publicBaseUrl}/status`,
      recommend: `${config.publicBaseUrl}${RECOMMEND_PATH}?q=wallet%20portfolio%20on%20Base`,
      priceUsd: config.x402PriceUsd
    });
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "x402-compass",
      name: "x402 Compass",
      x402DevBypass: config.x402DevBypass,
      payment: buildPaymentStatus()
    });
  });

  app.get("/status", (_req, res) => {
    res.json({
      ok: true,
      name: "x402 Compass",
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      baseUrl: config.publicBaseUrl,
      x402DevBypass: config.x402DevBypass,
      payment: buildPaymentStatus(),
      catalog: catalog.stats(),
      signals: signalCatalog,
      paidResources: [
        {
          method: "GET",
          path: RECOMMEND_PATH,
          url: `${config.publicBaseUrl}${RECOMMEND_PATH}`,
          priceUsd: config.x402PriceUsd,
          network: config.x402Network,
          description: recommendRouteDescription(config.x402PriceUsd)
        }
      ],
      freeResources: ["/", "/health", "/status"]
    });
  });

  app.head(RECOMMEND_PATH, (_req, res) => {
    res.setHeader("allow", "GET, HEAD");
    res.setHeader("x-compass-required-parameter", "q");
    res.status(200).end();
  });

  app.post(RECOMMEND_PATH, (_req, res) => {
    res.setHeader("allow", "GET, HEAD");
    res.status(405).json({
      error: "Method not allowed",
      message: "x402 Compass recommendations use GET query parameters so the paid URL is deterministic.",
      code: "method_not_allowed",
      supportedMethod: "GET",
      endpoint: RECOMMEND_PATH,
      example: `${config.publicBaseUrl}${RECOMMEND_PATH}?q=wallet%20portfolio%20on%20Base&network=eip155:8453&maxPrice=0.02`
    });
  });

  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path !== RECOMMEND_PATH) {
      next();
      return;
    }
    const parsed = parseRecommendQuery(req.query as Record<string, unknown>);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        message: "The request is invalid.",
        code: "invalid_request",
        details: formatZodError(parsed.error)
      });
      return;
    }
    res.locals.recommendQuery = parsed.data;
    next();
  });

  const payments = createPaymentMiddleware();
  if (payments) app.use(payments);

  app.get(RECOMMEND_PATH, async (_req, res, next) => {
    try {
      const query = res.locals.recommendQuery as ParsedRecommendQuery | undefined;
      if (!query) {
        res.status(400).json({
          error: "Invalid request",
          message: "The request is invalid.",
          code: "invalid_request"
        });
        return;
      }
      const snapshot = await catalog.get();
      const body = await buildRecommendation(query, snapshot, {
        now: Date.now(),
        enrichLimit: config.activityEnrichLimit,
        loadActivity: payTo => activity.get(payTo)
      });
      res.json(body);
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, res) => {
    res.status(404).json({
      error: "Not found",
      message: "No x402 Compass route matched this request.",
      code: "not_found",
      status: `${config.publicBaseUrl}/status`
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const httpError = toHttpError(error);
    if (httpError.status >= 500) console.error(error);
    res.status(httpError.status).json(httpError.body);
  });

  return app;
}

function buildPaymentStatus() {
  const route = paymentRouteConfig["GET /v1/x402/recommend"];
  return {
    protocol: "x402",
    scheme: "exact",
    network: config.x402Network,
    asset: "USDC",
    payTo: config.payTo ?? null,
    price: route.accepts.price,
    priceUsd: config.x402PriceUsd,
    facilitatorUrl: config.x402FacilitatorUrl,
    facilitator: config.usesCdpFacilitator ? "coinbase-cdp" : "custom",
    cdpAuthConfigured: config.cdpAuthConfigured,
    bazaarEligible: config.bazaarEligible,
    pricesUsd: {
      recommend: config.x402PriceUsd
    }
  };
}
