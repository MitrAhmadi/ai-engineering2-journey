// server.ts — the mentor GUI backend.
//
// It imports mentor-agent/mentor.ts and tools.ts WITHOUT MODIFYING THEM. The
// browser and the terminal run the same agent, the same prompt and the same
// state.json — the only difference is what draws the output.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));   // mentor-gui/
const AGENT = path.resolve(ROOT, "../mentor-agent");
const CLIENT_DIST = path.join(ROOT, "client", "dist");
const PORT = Number(process.env.PORT ?? 3488);

// Load the API key from the agent's .env — the same file the CLI uses.
const envFile = path.join(AGENT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ---- the unmodified agent core ------------------------------------------
const { Mentor, MODEL } = await import(pathToFileURL(path.join(AGENT, "mentor.ts")).href);
const { readState } = await import(pathToFileURL(path.join(AGENT, "tools.ts")).href);
const { MODALITIES, DEFAULT_MODALITY, isModalityId } =
  await import(pathToFileURL(path.join(AGENT, "modalities.ts")).href);
const { Panel, BID_MODEL } = await import(pathToFileURL(path.join(AGENT, "panel.ts")).href);

type AnyMentor = InstanceType<typeof Mentor>;
let mentor: AnyMentor = new Mentor(DEFAULT_MODALITY);

// ---- the panel -----------------------------------------------------------
// The 1:1 mentor answers requests. The room does not: it keeps talking after
// your request has returned, so its events go out over one long-lived SSE
// stream that every open tab subscribes to, rather than over the POST that
// started it.
type AnyPanel = InstanceType<typeof Panel>;
let panel: AnyPanel = new Panel();

const listeners = new Set<http.ServerResponse>();

function broadcast(event: unknown): void {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) res.write(frame);
}

const panelHandlers = {
  onUser:         (turn: unknown) => broadcast({ type: "user", turn }),
  onBids:         (bids: unknown) => broadcast({ type: "bids", bids }),
  onSpeakerStart: (id: string, name: string) => broadcast({ type: "speaker", id, name }),
  onDelta:        (id: string, text: string) => broadcast({ type: "delta", id, text }),
  onTool:         (id: string, event: unknown) => broadcast({ type: "tool", id, event }),
  onSpeakerEnd:   (turn: unknown) => broadcast({ type: "end", turn, memory: readState() }),
  onFloor:        (reason: string) => broadcast({ type: "floor", reason }),
};

/** Start the room if it is idle. Never awaited — the response goes back now. */
function pump(): void {
  if (panel.busy) return;
  panel.run(panelHandlers)
    .catch((err: Error) => broadcast({ type: "error", message: err.message }))
    .finally(() => broadcast({ type: "idle" }));
}

function panelState() {
  return {
    model: MODEL,
    bidModel: BID_MODEL,
    busy: panel.busy,
    members: panel.members.map((id: string) => {
      const m = MODALITIES[id as keyof typeof MODALITIES];
      return { id: m.id, name: m.name, panelName: m.panelName, blurb: m.blurb };
    }),
    transcript: panel.transcript,
    bids: panel.lastBids,
    memory: readState(),
  };
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

function json(res: http.ServerResponse, body: unknown, code = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function state() {
  return {
    model: MODEL,
    busy: mentor.busy,
    modality: mentor.modality,
    flagLabel: MODALITIES[mentor.modality as keyof typeof MODALITIES].flagLabel,
    memory: readState(),
    // Skip the system prompt, the tool plumbing, and the injected lens-switch
    // notes — the UI shows the conversation, not the wiring.
    messages: mentor.messages.slice(1)
      .filter((m: any) => m.role !== "tool" && m.role !== "system"
                       && typeof m.content === "string" && m.content)
      .map((m: any) => ({ role: m.role, content: m.content })),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const route = url.pathname;

  try {
    if (route === "/api/state") return json(res, state());

    // ---- panel ----
    if (route === "/api/panel/state") return json(res, panelState());

    if (route === "/api/panel/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "hello", state: panelState() })}\n\n`);
      listeners.add(res);
      // A proxy that buffers will hold the whole conversation until it ends,
      // which for this UI is the same as it never arriving.
      const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
      req.on("close", () => { clearInterval(ping); listeners.delete(res); });
      return;
    }

    // Legal at any moment, including three words into somebody's sentence.
    if (route === "/api/panel/say" && req.method === "POST") {
      const { text } = await readBody(req);
      panel.interject(String(text ?? ""));
      pump();
      return json(res, { ok: true });
    }

    if (route === "/api/panel/stop" && req.method === "POST") {
      return json(res, { stopped: panel.interrupt() });
    }

    if (route === "/api/panel/reset" && req.method === "POST") {
      panel.interrupt();
      panel = new Panel();
      broadcast({ type: "reset", state: panelState() });
      return json(res, panelState());
    }

    if (route === "/api/modalities") {
      return json(res, Object.values(MODALITIES).map((m: any) => ({
        id: m.id, name: m.name, blurb: m.blurb, flagLabel: m.flagLabel,
      })));
    }

    // Switching lens keeps the conversation. The new stance inherits everything
    // already said and has to answer for it.
    if (route === "/api/modality" && req.method === "POST") {
      const { id } = await readBody(req);
      if (!isModalityId(id)) return json(res, { error: `unknown modality: ${id}` }, 400);
      if (mentor.busy) return json(res, { error: "a turn is already running" }, 409);
      mentor.setModality(id);
      return json(res, state());
    }

    if (route === "/api/reset" && req.method === "POST") {
      // Resets the CONVERSATION, not the memory. Goals and beliefs survive on
      // purpose — you don't get to escape a commitment by refreshing the page.
      mentor.interrupt();
      mentor = new Mentor(mentor.modality);   // keep the chosen lens
      return json(res, state());
    }

    if (route === "/api/interrupt" && req.method === "POST") {
      return json(res, { interrupted: mentor.interrupt() });
    }

    if (route === "/api/send" && req.method === "POST") {
      const { text } = await readBody(req);
      if (mentor.busy) return json(res, { error: "a turn is already running" }, 409);

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      send({ type: "start" });

      // Closing the tab must cancel the turn, or we keep paying for tokens
      // nobody will read. Same rule as Ctrl+C, different gesture.
      res.on("close", () => { if (mentor.busy) mentor.interrupt(); });

      try {
        const turn = await mentor.send(String(text ?? ""), {
          onFirstToken: (ms: number) => send({ type: "ttft", ms }),
          onDelta: (delta: string) => send({ type: "delta", text: delta }),
          onTool: (event: unknown) => send({ type: "tool", event }),
        });
        send({ type: "done", interrupted: turn.interrupted, ms: turn.ms, state: state() });
      } catch (err) {
        send({ type: "error", message: (err as Error).message, state: state() });
      }
      return res.end();
    }

    // ---- static client ----
    const file = route === "/" ? "/index.html" : route;
    const abs = path.join(CLIENT_DIST, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const types: Record<string, string> = {
        ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
        ".svg": "image/svg+xml", ".json": "application/json",
      };
      res.writeHead(200, { "content-type": types[path.extname(abs)] ?? "application/octet-stream" });
      return fs.createReadStream(abs).pipe(res);
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end(fs.existsSync(CLIENT_DIST) ? "not found" : "client not built — run: npm run build");
  } catch (err) {
    json(res, { error: (err as Error).message }, 500);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  mentor gui  ·  http://127.0.0.1:${PORT}`);
  console.log(`  model ${MODEL}  ·  floor bids ${BID_MODEL}  ·  core imported from mentor-agent/\n`);
});
