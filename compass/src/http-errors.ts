import { z } from "zod";

export function isTimeoutError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const name = "name" in cause ? String((cause as { name?: unknown }).name) : "";
  if (name === "TimeoutError" || name === "AbortError" || name === "ProviderTimeoutError") return true;
  const message = "message" in cause ? String((cause as { message?: unknown }).message) : "";
  return /the operation was aborted due to timeout|timed out|timeout/i.test(message);
}

export function providerError(message: string, options?: { timeout?: boolean }) {
  const error = new Error(message);
  error.name = options?.timeout ? "ProviderTimeoutError" : "ProviderError";
  return error;
}

export function formatZodError(error: z.ZodError) {
  if (typeof error.flatten === "function") return error.flatten();
  return {
    issues: error.issues.map(issue => ({
      path: issue.path.join("."),
      message: issue.message
    }))
  };
}

export function toHttpError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (isJsonParseError(error)) {
    return {
      status: 400,
      body: {
        error: "Invalid request",
        message: "Request body must be valid JSON.",
        code: "invalid_json"
      }
    };
  }

  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        error: "Invalid request",
        message: "The request is invalid.",
        code: "invalid_request",
        details: formatZodError(error)
      }
    };
  }

  if (isTimeoutError(error) || (error instanceof Error && error.name === "ProviderTimeoutError")) {
    return {
      status: 504,
      body: {
        error: "Timeout",
        message: error instanceof Error ? error.message : "The catalog request timed out.",
        code: "provider_timeout"
      }
    };
  }

  if (error instanceof Error && error.name === "ProviderError") {
    return {
      status: 502,
      body: {
        error: "Provider error",
        message: error.message,
        code: "provider_error"
      }
    };
  }

  if (error instanceof Error && /facilitator/i.test(error.message)) {
    return {
      status: 502,
      body: {
        error: "Payment facilitator unavailable",
        message: "x402 Compass could not reach the Coinbase CDP x402 facilitator. Retry shortly.",
        code: "facilitator_unavailable"
      }
    };
  }

  return {
    status: 500,
    body: {
      error: "Internal error",
      message: "x402 Compass could not complete the request.",
      code: "internal_error"
    }
  };
}

function isJsonParseError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "type" in error &&
      (error as { type?: unknown }).type === "entity.parse.failed"
  );
}
