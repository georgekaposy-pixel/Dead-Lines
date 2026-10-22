// "Study with…": two accounts that name each other as study buddies can see
// whether the other is studying right now and send each other little cheers.
import { store, json, who } from "../lib/auth.mjs";

const NAME = /^[a-z0-9._-]{3,30}$/;
const CHEERS = ["🕯️", "💪", "❤️", "☕", "🦇", "⭐", "🔥", "😘"];

async function uidOf(st, name) {
  const u = await st.get("user/" + name, { type: "json" });
  return u ? u.uid : null;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const me = await who(req);
  if (!me) return json({ error: "Not logged in" }, 401);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const st = store();
  const mine = (await st.get("buddy/" + me.uid, { type: "json" })) || {};

  if (b.action === "set") {
    const name = String(b.buddy || "").trim().toLowerCase();
    if (name && (!NAME.test(name) || name === me.name)) return json({ error: "That isn't a valid username." }, 400);
    if (name && !(await uidOf(st, name))) return json({ error: "No account with that username yet. They need to make one first." }, 404);
    await st.setJSON("buddy/" + me.uid, { name });
    return json({ ok: true });
  }

  // Is the link mutual? (both people must name each other)
  let buddyUid = null, mutual = false;
  if (mine.name) {
    buddyUid = await uidOf(st, mine.name);
    if (buddyUid) {
      const theirs = (await st.get("buddy/" + buddyUid, { type: "json" })) || {};
      mutual = theirs.name === me.name;
    }
  }

  if (b.action === "presence") {
    const p = {
      studying: !!b.studying,
      until: Number(b.until) || 0,
      mode: Number(b.mode) || 0,
      what: String(b.what || "").slice(0, 60),
      today: Math.max(0, Math.min(1440, Number(b.today) || 0)),
      streak: Math.max(0, Math.min(3650, Number(b.streak) || 0)),
      at: Date.now()
    };
    await st.setJSON("presence/" + me.uid, p);
    return json({ ok: true });
  }

  if (b.action === "cheer") {
    if (!mutual) return json({ error: "You both need to add each other first." }, 403);
    const emoji = CHEERS.includes(b.emoji) ? b.emoji : "🕯️";
    const text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const key = "inbox/" + buddyUid;
    for (let i = 0; i < 6; i++) {
      const cur = await st.getWithMetadata(key, { type: "json" });
      const list = (cur && Array.isArray(cur.data) ? cur.data : []).slice(-19);
      list.push({ from: me.name, emoji, text, at: Date.now() });
      const res = cur ? await st.setJSON(key, list, { onlyIfMatch: cur.etag }) : await st.setJSON(key, list, { onlyIfNew: true });
      if (!res || res.modified !== false) return json({ ok: true });
    }
    return json({ error: "Busy, try again." }, 503);
  }

  if (b.action === "status") {
    let presence = null;
    if (mutual) {
      presence = await st.get("presence/" + buddyUid, { type: "json" });
      if (presence && presence.studying && presence.until && presence.until < Date.now()) presence.studying = false;
    }
    const inbox = (await st.get("inbox/" + me.uid, { type: "json" })) || [];
    if (inbox.length) await st.delete("inbox/" + me.uid);
    return json({ me: me.name, buddy: mine.name || "", mutual, presence, inbox });
  }

  return json({ error: "Unknown action" }, 400);
};
