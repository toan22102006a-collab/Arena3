const TOKEN_KEY = "arena3.token";
const USER_KEY = "arena3.user";

export type Role = "manager" | "coach" | "receptionist" | "member";

export type SessionUser = {
  id: string;
  member_code: string | null;
  full_name: string;
  phone: string;
  email: string | null;
  role: Role;
  status: string;
  date_of_birth: string | null;
  health_notes: string | null;
  must_change_password: boolean;
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: SessionUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Refresh the cached user without touching the token.
 *
 * The shell reads the name and role out of local storage so it can paint the
 * header before `/me` comes back. After a profile edit that copy is stale —
 * the header would keep showing the old name until the next sign-in.
 */
export function setStoredUser(user: SessionUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function homeFor(role: Role): string {
  if (role === "manager") return "/manager";
  if (role === "receptionist") return "/desk";
  if (role === "coach") return "/coach";
  return "/app";
}

export type ApiErrorBody = {
  code: string;
  message: string;
  br?: string;
  requires_confirm?: boolean;
};

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

function newIdem(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random()}`;
}

export async function api<T>(
  path: string,
  init: RequestInit & { idempotent?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.idempotent) headers.set("idempotency-key", newIdem());
  const res = await fetch(`/v1${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/pdf")) {
    return (await res.blob()) as T;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiClientError(res.status, data);
  return data as T;
}

/**
 * GETs that are already in flight, keyed by path.
 *
 * Several components legitimately ask for the same thing at the same moment —
 * `Guard` and the page it wraps both want `/me`, and React's StrictMode mounts
 * each of them twice in dev. `/me` is the most expensive read in the app, so
 * firing it two or four times over is the single largest thing standing
 * between a sign-in and a rendered page; measured on the deployed app, the
 * duplicate alone added ~840ms to every load.
 *
 * Callers still each get their own promise result; only the network trip is
 * shared. The entry is dropped as soon as the request settles, so this is a
 * de-duplicator for concurrent calls, not a cache — a later `load()` after a
 * mutation always hits the server.
 */
const inflight = new Map<string, Promise<unknown>>();

export const apiGet = <T>(path: string): Promise<T> => {
  const running = inflight.get(path);
  if (running) return running as Promise<T>;
  const p = api<T>(path).finally(() => {
    inflight.delete(path);
  });
  inflight.set(path, p);
  return p;
};
export const apiPost = <T>(path: string, body?: unknown, idempotent = false) =>
  api<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined, idempotent });
export const apiPatch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });
export const apiPut = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined });
export const apiDelete = <T>(path: string) => api<T>(path, { method: "DELETE" });
/**
 * A binary GET that also surfaces the filename the server chose.
 *
 * `api()` throws the headers away, and the invoice code only exists in
 * `content-disposition` — without it a saved receipt lands in Downloads named
 * after a UUID.
 */
async function apiBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(`/v1${path}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiClientError(res.status, text ? JSON.parse(text) : { code: "ERROR", message: "Request failed" });
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  return { blob: await res.blob(), filename: name ?? null };
}

/**
 * Show a receipt, and actually show it.
 *
 * `window.open` after an `await` is no longer inside the click that caused it,
 * so every browser treats it as an unsolicited popup and blocks it. It does
 * not throw when that happens — it returns `null` — so the callers' `try/catch`
 * never fired and pressing "Receipt" did nothing at all, with no error, on any
 * of the eleven places that call this. The PDF had been fetched correctly the
 * whole time.
 *
 * A programmatic download is not subject to the popup blocker, so it is the
 * fallback: worst case the receipt lands in Downloads instead of a new tab,
 * which is a far better outcome than silence at the till.
 */
export async function openInvoice(id: string): Promise<"opened" | "downloaded"> {
  const { blob, filename } = await apiBlob(`/invoices/${id}.pdf`);
  const url = URL.createObjectURL(blob);
  try {
    const win = window.open(url, "_blank");
    if (win && !win.closed) return "opened";
    const a = document.createElement("a");
    a.href = url;
    a.download = filename ?? `receipt-${id}.pdf`;
    a.rel = "noopener";
    document.body.append(a);
    a.click();
    a.remove();
    return "downloaded";
  } finally {
    // The blob is held alive by the object URL until it is revoked, and a till
    // that prints all day would otherwise accumulate every receipt it issued.
    // Long enough for the new tab or the download to have read it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
