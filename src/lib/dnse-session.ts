const STORAGE_KEY = "vnstock.dnse.session";

export interface DnseStoredSession {
  access_token: string;
  saved_at: number;
}

export function getDnseAccessToken(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<DnseStoredSession>;
    if (typeof parsed.access_token !== "string" || !parsed.access_token.trim()) {
      return undefined;
    }
    return parsed.access_token.trim();
  } catch {
    return undefined;
  }
}

export function setDnseSession(accessToken: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const trimmed = accessToken.trim();
  if (!trimmed) {
    return;
  }
  const payload: DnseStoredSession = {
    access_token: trimmed,
    saved_at: Date.now(),
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearDnseSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  sessionStorage.removeItem(STORAGE_KEY);
}

export function hasDnseSession(): boolean {
  return Boolean(getDnseAccessToken());
}
