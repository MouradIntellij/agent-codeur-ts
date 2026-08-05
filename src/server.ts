/**
 * Interface WEB de l'agent (en plus de la console).
 *
 *   npm run web
 *
 * Ouvre une page de chat sur http://127.0.0.1:3000 : une personne qui n'a
 * pas accès au code peut poser des questions au "Codeur" dans son navigateur.
 *
 * Sécurité : par défaut le serveur n'écoute QUE sur 127.0.0.1 (local).
 * Pour le partager sur le réseau local (ex. salle de classe), lancez :
 *   AGENT_HOST=0.0.0.0 npm run web
 * Attention : cela donne accès aux outils (bash inclus) à toute la classe.
 */

import { mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chdir } from "node:process";

import { runAgent } from "./agent.js";
import { config } from "./config.js";
import type { ChatMessage, ToolCall } from "./llm.js";

// L'agent travaille dans l'espace de travail déclaré (comme la console).
await mkdir(config.workspace, { recursive: true });
chdir(config.workspace);

const PORT = Number(process.env.AGENT_PORT ?? 3000);
const HOST = process.env.AGENT_HOST ?? "127.0.0.1";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, "..", "public", "index.html");

/** Mémoire de session : id de session -> historique de messages. */
const sessions = new Map<string, ChatMessage[]>();

// ---------------------------------------------------------------------------
// Petites aides HTTP
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function sessionId(req: IncomingMessage, res: ServerResponse): string {
  const cookie = req.headers.cookie ?? "";
  const match = /session=([^;]+)/.exec(cookie);
  if (match && sessions.has(match[1]!)) return match[1]!;
  // Nouvelle session : on génère un id et on le mémorise dans un cookie.
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessions.set(id, []);
  res.setHeader("Set-Cookie", `session=${id}; Path=/; HttpOnly; SameSite=Strict`);
  return id;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Les routes
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // Page web (chat)
  if (req.method === "GET" && url.pathname === "/") {
    try {
      let html = await readFile(HTML_PATH, "utf8");
      html = html.replaceAll("__MODEL__", config.model);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Erreur : page introuvable — " + (err as Error).message);
    }
    return;
  }

  // Nouvelle session (vide la mémoire)
  if (req.method === "POST" && url.pathname === "/api/reset") {
    const sid = sessionId(req, res);
    sessions.set(sid, []);
    sendJson(res, 200, { ok: true });
    return;
  }

  // Chat
  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readBody(req);
    const message = String(body.message ?? "").trim();
    if (!message) {
      sendJson(res, 400, { error: "Message vide." });
      return;
    }

    const sid = sessionId(req, res);
    const history = sessions.get(sid) ?? [];

    // On collecte la trace des outils pour l'afficher dans la page.
    const toolTrace: { name: string; arguments: Record<string, unknown>; result: string }[] = [];
    const onTool = (call: ToolCall, result: string) => {
      toolTrace.push({ name: call.name, arguments: call.arguments, result });
    };

    try {
      const { response, history: updated } = await runAgent(message, history, onTool);
      sessions.set(sid, updated);
      sendJson(res, 200, { response, tools: toolTrace });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
    return;
  }

  // Tout le reste : 404
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 — " + url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`🤖 Codeur (web) — modèle ${config.model}`);
  console.log(`   Page de chat : http://${HOST}:${PORT}`);
  console.log("   Ctrl+C pour arrêter.");
});
