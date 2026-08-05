/**
 * Interface terminal de l'agent.
 *
 *   npm start
 *
 * Commandes : /quit, /exit  -> quitter   /new -> effacer la mémoire
 *             /model        -> afficher le modèle actif
 */

import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { chdir, cwd } from "node:process";
import { stdin, stdout } from "node:process";

import { runAgent } from "./agent.js";
import { config } from "./config.js";
import type { ToolCall } from "./llm.js";

const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

// L'agent travaille dans l'espace de travail déclaré.
await mkdir(config.workspace, { recursive: true });
chdir(config.workspace);

const history: Parameters<typeof runAgent>[1] = [];

function displayTool(call: ToolCall, result: string): void {
  const args = Object.entries(call.arguments)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  console.log(`${GRAY}  [outil] ${call.name}(${args})${RESET}`);
  for (const line of result.split("\n").slice(0, 8)) {
    console.log(`${GRAY}    ${line}${RESET}`);
  }
}

const rl = createInterface({ input: stdin, output: stdout });

console.log(`${CYAN}Codeur${RESET} — agent de codage local (${config.model})`);
console.log(`Espace de travail: ${cwd()}`);
console.log("Tapez une demande, ou /help pour les commandes.\n");

while (true) {
  let saisie: string;
  try {
    saisie = (await rl.question(`${GREEN}vous> ${RESET}`)).trim();
  } catch {
    break; // EOF / Ctrl+D : readline est fermée, on quitte proprement
  }

  if (!saisie) continue;
  if (["/quit", "/exit"].includes(saisie.toLowerCase())) break;
  if (saisie.toLowerCase() === "/new") {
    history.length = 0;
    console.log("Mémoire de session effacée.\n");
    continue;
  }
  if (saisie.toLowerCase() === "/model") {
    console.log(`Modèle actif: ${config.model} (Ollama: ${config.ollamaUrl})\n`);
    continue;
  }
  if (saisie.toLowerCase() === "/help") {
    console.log("Demandes en français, ou: /quit /exit /new /model /help\n");
    continue;
  }

  try {
    console.log(`${GRAY}...${RESET}`);
    const { response, history: updated } = await runAgent(saisie, history, displayTool);
    history.splice(0, history.length, ...updated);
    console.log(`${CYAN}codeur> ${RESET}${response}\n`);
  } catch (err) {
    console.log(`${GRAY}[erreur] ${(err as Error).message}${RESET}\n`);
  }
}

rl.close();
