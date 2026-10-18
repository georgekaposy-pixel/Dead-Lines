// Shared helpers for Dead-Lines accounts. Everything is kept in one Netlify Blobs store.
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

export const store = () => getStore({ name: "deadlines", consistency: "strong" });
export const sha = s => createHash("sha256").update(s).digest("hex");
export const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

// Sessions last a year and renew themselves whenever they're used, so you stay logged in.
export const SESSION_DAYS = 365;
export const COOKIE = "dl_s";
export const sessionCookie = token => `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export function tokenOf(req) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9_-]{30,80})$/);
  if (m) return m[1];
  const c = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([A-Za-z0-9_-]{30,80})"));
  return c ? c[1] : "";
}

// Returns {uid, name} for a valid session (header or cookie), or null.
export async function who(req) {
  const token = tokenOf(req);
  if (!token) return null;
  const st = store(), key = "sess/" + sha(token);
  const s = await st.get(key, { type: "json" });
  if (!s || s.exp < Date.now()) return null;
  if (s.exp - Date.now() < (SESSION_DAYS - 7) * 864e5) await st.setJSON(key, { ...s, exp: Date.now() + SESSION_DAYS * 864e5 });
  return { uid: s.uid, name: s.name };
}
