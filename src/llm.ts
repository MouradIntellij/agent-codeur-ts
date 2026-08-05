/**
 * Client HTTP minimal vers un serveur LLM "compatible OpenAI".
 *
 * On utilise `fetch` (intégré à Node 18+) : aucun SDK ni aucune dépendance.
 * Un simple POST JSON vers /v1/chat/completions, comme avec l'API ChatGPT.
 */

import { apiUrl, config } from "./config.js";

/** Un message de conversation (format API). `tool_calls` est optionnel. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
}

/** Un appel d'outil normalisé, exploitable par notre code. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Schéma JSON d'un outil (ce que le modèle "voit"). */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Envoie la conversation et retourne LE MESSAGE de l'assistant, tel que
 * reçu du serveur (format filaire), pour pouvoir le ré-injecter tel quel
 * dans l'historique au tour suivant.
 */
export async function chat(
  messages: ChatMessage[],
  tools?: ToolSchema[],
): Promise<ChatMessage> {
  const payload = {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: config.maxTokens, // borne la réponse = borne l'attente
    options: {
      // extensions Ollama (acceptées par /v1/chat/completions)
      num_ctx: config.numCtx, // fenêtre de contexte (RAM)
      keep_alive: config.keepAlive, // modèle gardé chargé entre demandes
    },
    ...(tools ? { tools } : {}),
  };

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(300_000),
    });
  } catch {
    console.error(
      `\nImpossible de joindre Ollama sur ${config.ollamaUrl}.\n` +
        "Lancez 'ollama serve' (ou ouvrez l'app Ollama) puis réessayez.\n",
    );
    process.exit(1);
  }

  if (!response.ok) {
    throw new Error(`Erreur HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { choices: { message: ChatMessage }[] };
  return data.choices[0]!.message;
}

/**
 * Transforme les `tool_calls` du message en liste normalisée.
 * Selon le serveur, `arguments` est une chaîne JSON ou déjà un objet :
 * on normalise vers un vrai objet.
 */
export function parseToolCalls(message: ChatMessage): ToolCall[] {
  const result: ToolCall[] = [];
  for (const call of (message.tool_calls as {
    id?: string;
    function?: { name?: string; arguments?: unknown };
  }[]) ?? []) {
    const fn = call.function ?? {};
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === "string") {
      try {
        args = fn.arguments.trim() ? JSON.parse(fn.arguments) : {};
      } catch {
        args = { _raw: fn.arguments };
      }
    } else if (typeof fn.arguments === "object" && fn.arguments !== null) {
      args = fn.arguments as Record<string, unknown>;
    }
    result.push({
      id: call.id ?? "",
      name: fn.name ?? "",
      arguments: args,
    });
  }
  return result;
}
