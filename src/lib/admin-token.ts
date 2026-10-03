// Browser-side holder for the admin unlock token (per tab).
const KEY = "ea-admin-token";
export function getAdminToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.sessionStorage.getItem(KEY) ?? undefined;
}
export function setAdminToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.sessionStorage.setItem(KEY, token);
  else window.sessionStorage.removeItem(KEY);
}
