// Fetches a calendar feed (Bath MyTimetable, Bath Moodle or Outlook) for Dead-Lines.
// Only those calendar hosts are allowed, so this can't be used as an open proxy.
const ALLOWED = new Set(["mytimetable.bath.ac.uk", "moodle.bath.ac.uk", "outlook.office365.com", "outlook.office.com", "outlook.live.com"]);

export default async (req) => {
  const raw = new URL(req.url).searchParams.get("url") || "";
  let target;
  try { target = new URL(raw.replace(/^webcals?:\/\//i, "https://")); }
  catch { return new Response("That isn't a valid link.", { status: 400 }); }
  if (target.protocol !== "https:" || !ALLOWED.has(target.hostname)) {
    return new Response("Only MyTimetable, Moodle and Outlook calendar links are allowed.", { status: 400 });
  }
  try {
    const r = await fetch(target, { headers: { "Accept": "text/calendar, */*" }, redirect: "follow" });
    if (!r.ok) return new Response("The calendar returned " + r.status, { status: 502 });
    const body = await r.text();
    if (!body.includes("BEGIN:VCALENDAR")) return new Response("That link didn't return a calendar.", { status: 502 });
    return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return new Response("Couldn't reach the calendar.", { status: 502 });
  }
};
