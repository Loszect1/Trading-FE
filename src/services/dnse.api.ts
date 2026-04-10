import axios from "axios";
import { clearDnseSession, getDnseAccessToken, setDnseSession } from "@/lib/dnse-session";
import { httpClient, normalizeError } from "@/services/http-client";

/** DNSE calls can exceed default API timeout (login, OTP, place order). */
const DNSE_REQUEST_TIMEOUT_MS = 60000;

function applyDnseSessionAuth<T extends Record<string, unknown>>(payload: T): T {
  const token = getDnseAccessToken()?.trim();
  if (!token) {
    return payload;
  }
  return {
    ...payload,
    access_token: token,
    username: undefined,
    password: undefined,
  } as T;
}

export interface DnseEmailOtpPayload {
  username?: string;
  password?: string;
  access_token?: string;
}

export async function dnseAuthLogin(username?: string, password?: string): Promise<string> {
  try {
    const payload: Record<string, string> = {};
    const u = (username ?? "").trim();
    const p = password ?? "";
    if (u) payload.username = u;
    if (p) payload.password = p;

    const response = await httpClient.post<{ success?: boolean; token?: string }>(
      "/dnse/auth/login",
      payload,
      { timeout: DNSE_REQUEST_TIMEOUT_MS },
    );
    const token = response.data?.token;
    if (typeof token !== "string" || !token.trim()) {
      throw new Error("DNSE login response missing token");
    }
    const trimmed = token.trim();
    setDnseSession(trimmed);
    return trimmed;
  } catch (error) {
    throw normalizeError(error);
  }
}

export function dnseAuthLogout(): void {
  clearDnseSession();
}

export interface DnseDefaultsData {
  default_sub_account?: string | null;
}

export async function fetchDnseDefaults(): Promise<DnseDefaultsData> {
  try {
    const response = await httpClient.get<{ success?: boolean; data?: DnseDefaultsData }>("/dnse/defaults");
    return response.data?.data ?? {};
  } catch {
    return {};
  }
}

/** Parse `{ success, data }` from /dnse/account or /dnse/sub-accounts (data = records or single row). */
export function extractDnseRecords(responseBody: unknown): Record<string, unknown>[] {
  if (!responseBody || typeof responseBody !== "object") {
    return [];
  }
  const raw = (responseBody as Record<string, unknown>).data;
  if (raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.filter(
      (x): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x),
    );
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return [raw as Record<string, unknown>];
  }
  return [];
}

const SUB_ACCOUNT_KEYS = [
  "accountNo",
  "account_no",
  "subAccount",
  "sub_account",
  "accountNumber",
  "account_number",
  "id",
] as const;

export function pickSubAccountNumbers(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    for (const key of SUB_ACCOUNT_KEYS) {
      const v = row[key];
      if (typeof v === "string" && v.trim().length > 0) {
        const s = v.trim();
        if (!seen.has(s)) {
          seen.add(s);
          out.push(s);
        }
        break;
      }
      if (typeof v === "number" && Number.isFinite(v)) {
        const s = String(Math.trunc(v));
        if (!seen.has(s)) {
          seen.add(s);
          out.push(s);
        }
        break;
      }
    }
  }
  return out;
}

export async function fetchDnseAccount(payload: DnseEmailOtpPayload): Promise<Record<string, unknown>> {
  try {
    const body = applyDnseSessionAuth({ ...payload } as Record<string, unknown>);
    const response = await httpClient.post<Record<string, unknown>>("/dnse/account", body, {
      timeout: DNSE_REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchDnseSubAccounts(payload: DnseEmailOtpPayload): Promise<Record<string, unknown>> {
  try {
    const body = applyDnseSessionAuth({ ...payload } as Record<string, unknown>);
    const response = await httpClient.post<Record<string, unknown>>("/dnse/sub-accounts", body, {
      timeout: DNSE_REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchDnseAccountBalance(
  payload: DnseEmailOtpPayload & { sub_account: string },
): Promise<Record<string, unknown>> {
  try {
    const body = applyDnseSessionAuth({ ...payload } as Record<string, unknown>);
    const response = await httpClient.post<Record<string, unknown>>("/dnse/account-balance", body, {
      timeout: DNSE_REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export interface DnsePlaceOrderPayload {
  access_token?: string;
  username?: string;
  password?: string;
  otp: string;
  smart_otp?: boolean;
  sub_account: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  order_type: string;
  loan_package_id?: number | null;
  asset_type?: "stock" | "derivative";
}

export async function requestDnseEmailOtp(payload: DnseEmailOtpPayload): Promise<Record<string, unknown>> {
  try {
    const body = applyDnseSessionAuth({ ...payload } as Record<string, unknown>);
    const response = await httpClient.post<Record<string, unknown>>("/dnse/auth/email-otp", body, {
      timeout: DNSE_REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function placeDnseOrder(payload: DnsePlaceOrderPayload): Promise<Record<string, unknown>> {
  try {
    const merged = applyDnseSessionAuth({
      ...payload,
      smart_otp: payload.smart_otp ?? true,
      asset_type: payload.asset_type ?? "stock",
    } as Record<string, unknown>);
    const response = await httpClient.post<Record<string, unknown>>("/dnse/orders/place", merged, {
      timeout: DNSE_REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const err = normalizeError(error);
      throw err;
    }
    throw normalizeError(error);
  }
}

export function isAppError(error: unknown): error is { message: string } {
  return Boolean(error && typeof error === "object" && "message" in error);
}
