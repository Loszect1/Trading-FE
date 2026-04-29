import axios, { AxiosError } from "axios";
import type { AppError } from "@/types/api";

function resolveApiBaseUrl(): string {
  const isServerRuntime = typeof window === "undefined";
  if (isServerRuntime) {
    const serverBaseUrl = process.env.API_BASE_URL?.trim();
    if (serverBaseUrl) {
      return serverBaseUrl;
    }
  }
  return process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://127.0.0.1:8000";
}

const baseURL = resolveApiBaseUrl();

export const httpClient = axios.create({
  baseURL,
  timeout: 900_000,
  headers: {
    "Content-Type": "application/json",
  },
});

interface RetryCacheOptions {
  retries?: number;
  retryDelayMs?: number;
  cacheTtlMs?: number;
  timeoutMs?: number;
  /** Bỏ qua đọc/ghi cache in-memory (ví dụ làm mới có chủ đích). */
  skipCache?: boolean;
}

interface CacheEntry {
  expiresAt: number;
  data: unknown;
}

const responseCache = new Map<string, CacheEntry>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildCacheKey(path: string, payload: unknown): string {
  return `${path}:${JSON.stringify(payload)}`;
}

function shouldRetry(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  if (!error.response) {
    return true;
  }

  return error.response.status >= 500;
}

export async function postWithRetryCache<TResponse>(
  path: string,
  payload: unknown,
  options?: RetryCacheOptions,
): Promise<TResponse> {
  const retries = options?.retries ?? 1;
  const retryDelayMs = options?.retryDelayMs ?? 500;
  const cacheTtlMs = options?.cacheTtlMs ?? 10000;
  const timeoutMs = options?.timeoutMs;
  const skipCache = options?.skipCache ?? false;
  const cacheKey = buildCacheKey(path, payload);
  const now = Date.now();

  if (!skipCache) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data as TResponse;
    }
  }

  let attempt = 0;
  while (attempt <= retries) {
    try {
      const response = await httpClient.post<TResponse>(path, payload, {
        timeout: timeoutMs,
      });
      if (!skipCache) {
        responseCache.set(cacheKey, {
          expiresAt: Date.now() + cacheTtlMs,
          data: response.data,
        });
      }
      return response.data;
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) {
        throw error;
      }
      await sleep(retryDelayMs);
      attempt += 1;
    }
  }

  throw new Error("Request retry failed");
}

export async function getWithRetryCache<TResponse>(
  path: string,
  options?: RetryCacheOptions,
): Promise<TResponse> {
  const retries = options?.retries ?? 1;
  const retryDelayMs = options?.retryDelayMs ?? 500;
  const cacheTtlMs = options?.cacheTtlMs ?? 10000;
  const timeoutMs = options?.timeoutMs;
  const skipCache = options?.skipCache ?? false;
  const cacheKey = buildCacheKey(path, null);
  const now = Date.now();

  if (!skipCache) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data as TResponse;
    }
  }

  let attempt = 0;
  while (attempt <= retries) {
    try {
      const response = await httpClient.get<TResponse>(path, {
        timeout: timeoutMs,
      });
      if (!skipCache) {
        responseCache.set(cacheKey, {
          expiresAt: Date.now() + cacheTtlMs,
          data: response.data,
        });
      }
      return response.data;
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) {
        throw error;
      }
      await sleep(retryDelayMs);
      attempt += 1;
    }
  }

  throw new Error("Request retry failed");
}

export function normalizeError(error: unknown): AppError {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ detail?: string; message?: string }>;
    return {
      message:
        axiosError.response?.data?.message ||
        axiosError.response?.data?.detail ||
        axiosError.message ||
        "Request failed",
      status: axiosError.response?.status,
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: "Unknown error" };
}
