// Dead-Lines saved data for a logged-in account.
//   ?op=state              GET (optionally &since=rev) / PUT {data, baseRev, at, force}
//   ?op=files              GET the index of saved files
//   ?op=file&id=…          GET / PUT (JSON record) / DELETE
//   ?op=blob&id=…          GET / PUT (raw bytes, up to ~5.5 MB)
import { store, json, who } from "../lib/auth.mjs";

const MAX_BLOB = 5.5 * 1024 * 1024;

async function updateIndex(st, key, fn) {
  for (let i = 0; i < 8; i++) {
    const cur = await st.getWithMetadata(key, { type: "json" });
    const next = fn(cur ? cur.data : {});
    const res = cur ? await st.setJSON(key, next, { onlyIfMatch: cur.etag }) : await st.setJSON(key, next, { onlyIfNew: true });
    if (!res || res.modified !== false) return next;
    await new Promise(r => setTimeout(r, 40 + Math.random() * 120));
  }
  throw new Error("busy");
}

export default async (req) => {
  const u = await who(req);
  if (!u) return json({ error: "Not logged in" }, 401);
  const st = store();
  const url = new URL(req.url);
  const op = url.searchParams.get("op");
  const id = url.searchParams.get("id") || "";
  const base = "data/" + u.uid + "/";
  if (id && !/^[\w.-]{1,120}$/.test(id)) return json({ error: "Bad id" }, 400);

  if (op === "state") {
    if (req.method === "GET") {
      const cur = await st.get(base + "state", { type: "json" });
      if (!cur) return json({ rev: 0 });
      if (url.searchParams.get("since") === String(cur.rev)) return new Response(null, { status: 204 });
      return json(cur);
    }
    if (req.method === "PUT") {
      let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
      if (!b || typeof b.data !== "object") return json({ error: "Bad request" }, 400);
      const cur = await st.get(base + "state", { type: "json" });
      const rev = cur ? cur.rev : 0;
      if (!b.force && cur && b.baseRev !== rev) return json({ conflict: true, rev, at: cur.at }, 409);
      const next = { rev: rev + 1, at: Number(b.at) || Date.now(), data: b.data };
      await st.setJSON(base + "state", next);
      return json({ rev: next.rev, at: next.at });
    }
  }

  if (op === "files" && req.method === "GET") {
    return json((await st.get(base + "files-index", { type: "json" })) || {});
  }

  if (op === "file" && id) {
    if (req.method === "GET") {
      const rec = await st.get(base + "file/" + id, { type: "json" });
      return rec ? json(rec) : json({ error: "Not found" }, 404);
    }
    if (req.method === "PUT") {
      let rec; try { rec = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
      if (!rec || rec.id !== id) return json({ error: "Bad request" }, 400);
      await st.setJSON(base + "file/" + id, rec);
      const { text, blob, ...meta } = rec;
      await updateIndex(st, base + "files-index", idx => ({ ...idx, [id]: meta }));
      return json({ ok: true });
    }
    if (req.method === "DELETE") {
      await st.delete(base + "file/" + id);
      await st.delete(base + "blob/" + id);
      await updateIndex(st, base + "files-index", idx => { const n = { ...idx }; delete n[id]; return n; });
      return json({ ok: true });
    }
  }

  if (op === "blob" && id) {
    if (req.method === "GET") {
      const buf = await st.get(base + "blob/" + id, { type: "arrayBuffer" });
      return buf ? new Response(buf, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } }) : json({ error: "Not found" }, 404);
    }
    if (req.method === "PUT") {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_BLOB) return json({ error: "Too large" }, 413);
      await st.set(base + "blob/" + id, buf);
      return json({ ok: true });
    }
  }

  return json({ error: "Unknown request" }, 400);
};
