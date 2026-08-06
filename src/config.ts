/**
 * Configuration de l'agent.
 * Surchargeable par variables d'environnement (pratique pour les CI et
 * pour tester différents modèles sans toucher au code).
 */

export const config = {
  /** Modèle local utilisé (doit être capable de "tool calling").
   *  llama3.2:latest = fiable pour le tool-calling calcul (SymPy : intégrales,
   *  dérivées, équations) et 2x plus rapide ; qwen2.5:latest = plus éloquent
   *  mais saute les appels d'outil de calcul. */
  model: process.env.AGENT_MODEL ?? "llama3.2:latest",

  /** Adresse du serveur Ollama. */
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",

  /** Température : 0 = déterministe, 1 = créatif. */
  temperature: 0.2,

  /** Nombre max de tokens générés par réponse (0 = illimité).
   *  C'est LE levier anti-lenteur : réponse bornée = attente bornée. */
  maxTokens: Number(process.env.AGENT_MAX_TOKENS ?? 1200),

  /** Fenêtre de contexte demandée. 4096 suffit pour une session ;
   *  les modèles par défaut montent à 32k/128k et occupent la RAM. */
  numCtx: Number(process.env.AGENT_NUM_CTX ?? 8192),

  /** Durée (s) pendant laquelle Ollama garde le modèle chargé en mémoire. */
  keepAlive: Number(process.env.AGENT_KEEP_ALIVE ?? 1800),

  /** Anti-boucle-infinie : nombre max de tours "agent -> outil -> agent". */
  maxIterations: 25,

  /** Durée max d'une commande bash, en millisecondes. */
  bashTimeout: 30_000,

  /** Nombre max de lignes renvoyées par readFile. */
  maxReadLines: 400,

  /** Dossier sur lequel l'agent travaille (tous les outils y sont relatifs). */
  workspace: process.env.AGENT_WORKSPACE ?? ".",
};

/** URL de l'endpoint "chat completions" compatible OpenAI. */
export const apiUrl = `${config.ollamaUrl}/v1/chat/completions`;
