const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2;

export class LimitlessRequestError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LimitlessRequestError";
  }
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function limitlessFetch(
  url: URL | string,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: number } = {},
) {
  const target = url.toString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(target, {
        ...init,
        headers: {
          Accept: "application/json, text/html;q=0.9",
          "User-Agent": "LoMeta/0.1 (Pokemon TCG metagame research)",
          ...init.headers,
        },
        signal: controller.signal,
      });

      if (response.ok) return response;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === retries) {
        throw new LimitlessRequestError(
          `Limitless returned HTTP ${response.status}.`,
          target,
          response.status,
        );
      }

      const retryAfter = Number(response.headers.get("retry-after"));
      await delay(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1_000
          : 400 * 2 ** attempt,
      );
    } catch (error) {
      if (error instanceof LimitlessRequestError) throw error;
      if (attempt === retries) {
        const message =
          error instanceof Error ? error.message : "Unknown network error";
        throw new LimitlessRequestError(message, target);
      }
      await delay(400 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new LimitlessRequestError("Request retry loop exited.", target);
}

export async function fetchJson<T>(url: URL | string, init?: RequestInit) {
  const response = await limitlessFetch(url, init);
  return (await response.json()) as T;
}

export async function fetchHtml(url: URL | string) {
  const response = await limitlessFetch(url, {
    headers: { Accept: "text/html" },
  });
  return response.text();
}
