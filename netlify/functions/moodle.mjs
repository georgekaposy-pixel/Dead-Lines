// Asks Bath's Moodle which deadlines still need action, using the student's own
// Moodle mobile web service key. Only Bath's Moodle and a short list of read-only
// functions are allowed. The key is passed through and never stored.
const MOODLE = "https://moodle.bath.ac.uk/webservice/rest/server.php";
const ALLOWED_FNS = new Set(["core_calendar_get_action_events_by_timesort", "core_webservice_get_site_info", "core_enrol_get_users_courses", "core_course_get_contents"]);
const FILE_PREFIX = "https://moodle.bath.ac.uk/webservice/pluginfile.php/";
const MAX_FILE = 20 * 1024 * 1024;

export default async (req) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  let body;
  try { body = await req.json(); } catch { return new Response('{"exception":"bad","errorcode":"badrequest"}', { status: 400 }); }
  const { token, fn, params, url } = body || {};
  // Lecture slide download: only Bath Moodle files, read-only, size-capped.
  if (fn === "__file" && /^[a-f0-9]{32}$/i.test(token || "") && typeof url === "string" && url.startsWith(FILE_PREFIX) && !url.includes("..")) {
    try {
      const u = new URL(url); u.search = ""; u.searchParams.set("token", token);
      const r = await fetch(u, { redirect: "follow" });
      const len = Number(r.headers.get("content-length") || 0);
      if (!r.ok || len > MAX_FILE) return new Response("File not available.", { status: 502 });
      const buf = await r.arrayBuffer();
      if (buf.byteLength > MAX_FILE) return new Response("File too large.", { status: 413 });
      return new Response(buf, { status: 200, headers: { "Content-Type": r.headers.get("content-type") || "application/pdf", "Cache-Control": "no-store" } });
    } catch { return new Response("Couldn't reach Moodle.", { status: 502 }); }
  }
  if (!/^[a-f0-9]{32}$/i.test(token || "") || !ALLOWED_FNS.has(fn)) {
    return new Response('{"exception":"bad","errorcode":"notallowed"}', { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const form = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: "json" });
  for (const [k, v] of Object.entries(params || {})) if (/^[a-z_]+$/.test(k) && /^[\w-]{0,40}$/.test(String(v))) form.set(k, String(v));
  try {
    const r = await fetch(MOODLE, { method: "POST", body: form });
    const text = await r.text();
    return new Response(text, { status: r.ok ? 200 : 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return new Response("Couldn't reach Moodle.", { status: 502 });
  }
};
