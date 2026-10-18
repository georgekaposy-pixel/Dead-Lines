// Dead-Lines accounts: create account, log in, log out, check session.
// Passwords are stored only as salted scrypt hashes. You stay logged in (a year, renewed on every visit).
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { store, sha, json, who, tokenOf, sessionCookie, clearCookie, SESSION_DAYS } from "../lib/auth.mjs";

const scrypt = promisify(_scrypt);
const MAX_ACCOUNTS = 6;            // it's a personal site: stop strangers filling it up

async function newSession(st, uid, name) {
  const token = randomBytes(32).toString("base64url");
  await st.setJSON("sess/" + sha(token), { uid, name, exp: Date.now() + SESSION_DAYS * 864e5 });
  return token;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const st = store();
  const action = b && b.action;

  if (action === "me") {
    const u = await who(req);
    return u ? json({ name: u.name }) : json({ error: "Not logged in" }, 401);
  }
  if (action === "logout") {
    const t = tokenOf(req);
    if (t) await st.delete("sess/" + sha(t));
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
  }

  const name = String(b.username || "").trim().toLowerCase();
  const pw = String(b.password || "");
  if (!/^[a-z0-9._-]{3,30}$/.test(name)) return json({ error: "Usernames are 3 to 30 letters, numbers, dots, dashes or underscores." }, 400);
  if (pw.length < 8 || pw.length > 200) return json({ error: "Passwords need at least 8 characters." }, 400);

  if (action === "signup") {
    const { blobs } = await st.list({ prefix: "user/" });
    if (blobs.length >= MAX_ACCOUNTS) return json({ error: "Sign-ups are closed on this site." }, 403);
    const salt = randomBytes(16).toString("hex");
    const hash = (await scrypt(pw, salt, 64)).toString("hex");
    const uid = randomBytes(12).toString("hex");
    const res = await st.setJSON("user/" + name, { uid, salt, hash, created: Date.now() }, { onlyIfNew: true });
    if (res && res.modified === false) return json({ error: "That username is taken." }, 409);
    const token = await newSession(st, uid, name);
    return json({ token, name }, 200, { "Set-Cookie": sessionCookie(token) });
  }

  if (action === "login") {
    const failKey = "fail/" + name;
    const fail = (await st.get(failKey, { type: "json" })) || { n: 0, until: 0 };
    if (fail.until > Date.now()) return json({ error: "Too many wrong passwords. Try again in 15 minutes." }, 429);
    const u = await st.get("user/" + name, { type: "json" });
    const salt = u ? u.salt : "00000000000000000000000000000000";
    const got = await scrypt(pw, salt, 64);
    const ok = !!u && timingSafeEqual(got, Buffer.from(u.hash, "hex"));
    if (!ok) {
      const n = fail.n + 1;
      await st.setJSON(failKey, n >= 5 ? { n: 0, until: Date.now() + 15 * 6e4 } : { n, until: 0 });
      return json({ error: "Wrong username or password." }, 401);
    }
    if (fail.n) await st.delete(failKey);
    const token = await newSession(st, u.uid, name);
    return json({ token, name }, 200, { "Set-Cookie": sessionCookie(token) });
  }

  return json({ error: "Unknown action" }, 400);
};
