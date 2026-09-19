import { serveStatic } from "hono/bun";
import type { Context } from "hono";
import type { ViteDevServer } from "vite";
import { createServer as createViteServer } from "vite";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { basename, join, resolve } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";

type Mode = "development" | "production";
const app = new Hono();

const mode: Mode =
  process.env.NODE_ENV === "production" ? "production" : "development";

const LOCAL_PORT = 5892;

// ── The upload queue ──────────────────────────────────────────────────────────
//
// Bun's job here is orchestration and UI only: every route below shells out to
// `pipeline.webqueue`, which imports the same stages the laptop path uses. The server
// makes no pipeline decision and holds no pipeline state.
//
// Access model (UPLOAD_BUILD_SPEC.md):
//   /add     — secret link. The token in the URL is the whole credential; a request
//              without it gets a 404, not a login page, because the route's existence
//              is part of what the token protects.
//   /review  — admin password, entered once per session, held as an in-memory cookie
//              session. A restart forgets sessions; Katey types the password again.
//
// Secrets live in console/.env (gitignored), loaded automatically by Bun at startup.

const REPO = resolve(import.meta.dir, "..");
const PYTHON = join(REPO, ".venv", "bin", "python");
const QUEUE_DATA = join(REPO, "pipeline", "webqueue", "data");
const UPLOAD_TOKEN = (process.env.UPLOAD_TOKEN || "").trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;

const adminSessions = new Map<string, number>();

// ANTHROPIC_API_KEY is stripped from every spawn except `extract`. This is the
// structural guarantee the spec asks for: the upload route's spawns cannot reach the
// paid API because the process they start never holds the key — the only spawn that
// does sits behind the admin gate in /api/admin/batches/:id/approve.
function envFor(cmd: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (cmd !== "extract") delete env.ANTHROPIC_API_KEY;
  return env;
}

type QueueResult =
  | { ok: true; data: any }
  | { ok: false; error: string };

async function webqueue(cmd: string, args: string[] = [], stdin?: string): Promise<QueueResult> {
  const proc = Bun.spawn([PYTHON, "-m", "pipeline.webqueue", cmd, ...args], {
    cwd: REPO,
    env: envFor(cmd),
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    return { ok: false, error: (err.trim() || out.trim() || `exit ${code}`).slice(-2000) };
  }
  try {
    return { ok: true, data: JSON.parse(out) };
  } catch {
    return { ok: false, error: `webqueue ${cmd} returned non-JSON: ${out.slice(0, 400)}` };
  }
}

// Extraction runs detached — it is minutes long and the approve request should return
// immediately. Progress lands in the batch's extract.log and batch.json state, which
// the review page polls.
function startExtract(batchId: string): void {
  const log = join(QUEUE_DATA, batchId, "extract.log");
  Bun.spawn(
    ["bash", "-c", 'exec "$PY" -u -m pipeline.webqueue extract --batch "$B" >> "$LOG" 2>&1'],
    {
      cwd: REPO,
      env: { ...envFor("extract"), PY: PYTHON, B: batchId, LOG: log },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  ).unref();
}

function yashOk(c: Context): boolean {
  const k = c.req.query("k") || c.req.header("x-upload-token") || "";
  return UPLOAD_TOKEN.length > 0 && k === UPLOAD_TOKEN;
}

function adminOk(c: Context): boolean {
  const t = getCookie(c, "snz_admin");
  if (!t) return false;
  const exp = adminSessions.get(t);
  if (!exp || exp < Date.now()) {
    adminSessions.delete(t);
    return false;
  }
  return true;
}

function safeBatchId(raw: string): string | null {
  return /^[\w][\w.-]*$/.test(raw) ? raw : null;
}

function configureQueueApi(app: Hono) {
  const denied = (c: Context) => c.json({ error: "unauthorized" }, 401);

  // ── Yash's side: free stages only ──────────────────────────────────────────
  app.post("/api/upload", async (c) => {
    if (!yashOk(c)) return denied(c);
    const body = await c.req.parseBody({ all: true });
    const note = typeof body.note === "string" ? body.note : "";
    let pasted: unknown[] = [];
    if (typeof body.pasted === "string" && body.pasted.trim()) {
      try {
        pasted = JSON.parse(body.pasted);
      } catch {
        return c.json({ error: "pasted field is not valid JSON" }, 400);
      }
    }
    const files = [body["files"]]
      .flat()
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length && !pasted.length) {
      return c.json({ error: "nothing to add — attach files or paste article text" }, 400);
    }

    const created = await webqueue("create", [], JSON.stringify({ note, pasted }));
    if (!created.ok) return c.json({ error: created.error }, 500);
    const id: string = created.data.id;

    const incoming = join(QUEUE_DATA, id, "incoming", "files");
    for (const f of files) {
      const name = basename(f.name || "upload").replace(/[^\w.\- ()]+/g, "_").slice(0, 180);
      if (name) await Bun.write(join(incoming, name), f);
    }

    const ingested = await webqueue("ingest", ["--batch", id]);
    if (!ingested.ok) return c.json({ error: ingested.error, batch: id }, 500);
    return c.json(ingested.data);
  });

  app.get("/api/upload/:id", async (c) => {
    if (!yashOk(c)) return denied(c);
    const id = safeBatchId(c.req.param("id"));
    if (!id) return c.json({ error: "bad batch id" }, 400);
    const r = await webqueue("detail", ["--batch", id]);
    return r.ok ? c.json(r.data) : c.json({ error: r.error }, 500);
  });

  app.post("/api/upload/:id/map", async (c) => {
    if (!yashOk(c)) return denied(c);
    const id = safeBatchId(c.req.param("id"));
    if (!id) return c.json({ error: "bad batch id" }, 400);
    const { file, mapping } = await c.req.json().catch(() => ({}) as any);
    if (typeof file !== "string" || !mapping) {
      return c.json({ error: "need { file, mapping }" }, 400);
    }
    const r = await webqueue(
      "map-table",
      ["--batch", id, "--file", basename(file)],
      JSON.stringify(mapping),
    );
    return r.ok ? c.json(r.data) : c.json({ error: r.error }, 500);
  });

  // ── Katey's side: both gates ───────────────────────────────────────────────
  app.post("/api/admin/login", async (c) => {
    const { password } = await c.req.json().catch(() => ({}) as any);
    if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
      return c.json({ error: "wrong password" }, 401);
    }
    const token = crypto.randomUUID();
    adminSessions.set(token, Date.now() + ADMIN_TTL_MS);
    for (const [t, exp] of adminSessions) if (exp < Date.now()) adminSessions.delete(t);
    setCookie(c, "snz_admin", token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: mode === "production",
      path: "/",
      maxAge: ADMIN_TTL_MS / 1000,
    });
    return c.json({ ok: true });
  });

  app.get("/api/admin/session", (c) => c.json({ ok: adminOk(c) }));

  const admin =
    (handler: (c: Context) => Promise<Response> | Response) => async (c: Context) =>
      adminOk(c) ? handler(c) : denied(c);

  app.get("/api/admin/batches", admin(async (c) => {
    const r = await webqueue("list");
    return r.ok ? c.json(r.data) : c.json({ error: r.error }, 500);
  }));

  // Yash's tokened link, so Katey can re-send it without asking Zo. Served only from
  // behind the admin gate — the token must never appear in any public page or bundle,
  // which is why this is an API response and not something the /review HTML ships with.
  app.get("/api/admin/upload-link", admin(async (c) => {
    if (!UPLOAD_TOKEN) return c.json({ error: "no upload token configured" }, 500);
    const host = c.req.header("x-forwarded-host") || c.req.header("host")
      || `localhost:${LOCAL_PORT}`;
    // Scheme from the host, not from x-forwarded-proto: the tunnel terminates TLS and
    // reports its inside leg (http), which would hand Katey a link that redirects at
    // best. Anything that is not localhost is only reachable over https.
    const proto = /^(localhost|127\.)/.test(host) ? "http" : "https";
    return c.json({ url: `${proto}://${host}/add?k=${encodeURIComponent(UPLOAD_TOKEN)}` });
  }));

  // The data browser: everything the store holds, read-only. The webqueue spawn never
  // receives the API key (envFor strips it for every command except extract).
  app.get("/api/admin/browse", admin(async (c) => {
    const r = await webqueue("browse");
    return r.ok ? c.json(r.data) : c.json({ error: r.error }, 500);
  }));

  app.get("/api/admin/batches/:id", admin(async (c) => {
    const id = safeBatchId(c.req.param("id"));
    if (!id) return c.json({ error: "bad batch id" }, 400);
    const r = await webqueue("detail", ["--batch", id]);
    return r.ok ? c.json(r.data) : c.json({ error: r.error }, 500);
  }));

  // Gate 1 — spend. The only route in the server that starts a key-holding process.
  app.post("/api/admin/batches/:id/approve", admin(async (c) => {
    const id = safeBatchId(c.req.param("id"));
    if (!id) return c.json({ error: "bad batch id" }, 400);
    const d = await webqueue("detail", ["--batch", id]);
    if (!d.ok) return c.json({ error: d.error }, 500);
    const state = d.data.batch?.state;
    if (state !== "quoted" && state !== "failed") {
      return c.json({ error: `batch is ${state} — approve applies to a quoted batch` }, 409);
    }
    startExtract(id);
    return c.json({ started: true });
  }));

  app.get("/api/admin/batches/:id/log", admin(async (c) => {
    const id = safeBatchId(c.req.param("id"));
    if (!id) return c.json({ error: "bad batch id" }, 400);
    const log = join(QUEUE_DATA, id, "extract.log");
    if (!existsSync(log)) return c.json({ log: "" });
    const size = statSync(log).size;
    const text = readFileSync(log, "utf-8");
    return c.json({ log: size > 4000 ? "…" + text.slice(-4000) : text });
  }));

  // Gate 2 — content. Exclusions are tagged and kept; nothing is deleted.
  app.post("/api/admin/batches/:id/exclude", admin(async (c) => {
    const id = safeBatchId(c.req.param("id"));
    if (!id) return c.json({ error: "bad batch id" }, 400);
    const { event_id, reason, undo } = await c.req.json().catch(() => ({}) as any);
    if (typeof event_id !== "string" || !event_id) {
      return c.json({ error: "need { event_id, reason }" }, 400);
    }
    const args = ["--batch", id, "--event", event_id, "--reason", String(reason || "")];
    if (undo) args.push("--undo");
    const r = await webqueue("exclude", args);
    return r.ok ? c.json(r.data) : c.json({ error: r.error }, 500);
  }));

  app.post("/api/admin/batches/:id/publish", admin(async (c) => {
    const id = safeBatchId(c.req.param("id"));
    if (!id) return c.json({ error: "bad batch id" }, 400);
    const r = await webqueue("publish", ["--batch", id]);
    return r.ok ? c.json(r.data) : c.json({ error: r.error }, 500);
  }));

  app.post("/api/admin/batches/:id/discard", admin(async (c) => {
    const id = safeBatchId(c.req.param("id"));
    if (!id) return c.json({ error: "bad batch id" }, 400);
    const r = await webqueue("discard", ["--batch", id]);
    return r.ok ? c.json(r.data) : c.json({ error: r.error }, 500);
  }));
}

configureQueueApi(app);

if (mode === "production") {
  configureProduction(app);
} else {
  await configureDevelopment(app);
}

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : LOCAL_PORT;

export default {
  fetch: app.fetch,
  port,
  idleTimeout: 255,
  // Uploads: ProQuest RTF exports run to hundreds of MB.
  maxRequestBodySize: 512 * 1024 * 1024,
};

function configureProduction(app: Hono) {
  app.get("/console", serveStatic({ path: "./dist/index.html" }));
  app.get("/console/", serveStatic({ path: "./dist/index.html" }));
  // The token is checked before the page is served, not just before the API answers:
  // without it the route 404s rather than presenting an upload form that cannot work.
  app.get("/add", (c, next) =>
    yashOk(c) ? serveStatic({ path: "./dist/add.html" })(c, next) : c.notFound(),
  );
  app.get("/review", serveStatic({ path: "./dist/review.html" }));
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  app.use("/data/*", serveStatic({ root: "./dist" }));
  app.get("/", (c) => c.redirect("/console"));
}

async function configureDevelopment(app: Hono): Promise<ViteDevServer> {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });

  // `hmr: false` above turns off more than live reloading. Vite invalidates its module graph
  // as part of the HMR path, so with HMR off `transformRequest` keeps returning the transform
  // it produced the first time and the browser is served the pre-edit module forever — while
  // `no-store` makes every fetch look fresh. That is worse than having no reloading at all:
  // an edit appears to have been made and verified when what was actually tested was the code
  // from before it. Dropping the graph on any source change restores "a reload shows what is
  // on disk" without bringing back the websocket this server deliberately does not run.
  vite.watcher.on("change", (file) => {
    if (file.includes("/node_modules/")) return;
    vite.moduleGraph.invalidateAll();
  });

  const noStore = { "Cache-Control": "no-store, must-revalidate" };

  app.use("*", async (c, next) => {
    const url = c.req.path;
    try {
      if (url === "/" || url === "/console" || url === "/console/") {
        let template = await Bun.file("./index.html").text();
        template = await vite.transformIndexHtml(url, template);
        return c.html(template, { headers: noStore });
      }
      if (url === "/add") {
        if (!yashOk(c)) return c.notFound();
        let template = await Bun.file("./add.html").text();
        template = await vite.transformIndexHtml(url, template);
        return c.html(template, { headers: noStore });
      }
      if (url === "/review") {
        let template = await Bun.file("./review.html").text();
        template = await vite.transformIndexHtml(url, template);
        return c.html(template, { headers: noStore });
      }

      // venues.geojson and the other layer files live in ./public/data.
      const publicFile = Bun.file(`./public${url}`);
      if (await publicFile.exists()) {
        const stat = await publicFile.stat();
        if (stat && !stat.isDirectory()) {
          return new Response(publicFile, { headers: noStore });
        }
      }

      let result;
      try {
        result = await vite.transformRequest(url);
      } catch (err) {
        // A module under /src/ that fails to transform must not fall through to the SPA
        // template. Answering it with index.html gives the browser a 200 and HTML where it
        // asked for JavaScript, so the import fails silently, React never mounts, and the
        // page goes blank with nothing in the console to say why.
        if (url.startsWith("/src/")) {
          vite.ssrFixStacktrace(err as Error);
          console.error(`[vite] transform failed for ${url}\n`, err);
          return c.text(`Transform failed for ${url}: ${(err as Error).message}`, 500);
        }
        result = null;
      }
      if (result) {
        return new Response(result.code, {
          headers: { "Content-Type": "application/javascript", ...noStore },
        });
      }

      let template = await Bun.file("./index.html").text();
      template = await vite.transformIndexHtml("/console", template);
      return c.html(template, { headers: noStore });
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      console.error(error);
      return c.text("Internal Server Error", 500);
    }
  });

  return vite;
}
