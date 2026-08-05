/**
 * La BOUCLE de l'agent (ReAct : Reason + Act).
 *
 *     ┌──────────────────────────────────────────────────┐
 *     │ 1. envoie les messages au modèle                  │
 *     │ 2. le modèle répond                               │
 *     │    ├─ texte final ──────────────► RETOURNE        │
 *     │    └─ appels d'outils                             │
 *     │       └─ exécute chaque outil (notre code)        │
 *     │          └─ renvoie le résultat au modèle         │
 *     │             └─ RETOUR au 1 (boucle)               │
 *     └──────────────────────────────────────────────────┘
 */

import { config } from "./config.js";
import { chat, parseToolCalls, type ChatMessage, type ToolCall } from "./llm.js";
import { buildMessages } from "./prompt.js";
import { TOOLS, executeTool } from "./tools.js";

/** Rappel optionnel appelé à chaque usage d'outil (affichage CLI). */
export type OnTool = (call: ToolCall, result: string) => void;

export interface RunResult {
  response: string;
  history: ChatMessage[];
}

// ---------------------------------------------------------------------------
// Porte de décision : certaines demandes n'ont besoin d'AUCUN outil.
// « Donne-moi le code / comment faire ... ? » → réponse DIRECTE.
// Si on n'annonce pas d'outils au modèle, il ne peut PAS chercher sur le
// disque : c'est la garantie anti « recherche infinie ».
// ---------------------------------------------------------------------------

const CODE_REQUEST_MARKERS = [
  "donne-moi le code", "donnez-moi le code", "donne moi le code", "donnez moi le code",
  "le code en", "du code en", "un code en", "le code typescript", "le code python",
  "le code javascript", "code en python", "code en typescript", "code en javascript",
  "code en ts", "code en js",
  "le code pour", "un code pour", "un exemple de code",
  "comment lire", "comment ecrire", "comment écrire", "comment creer", "comment créer",
  "comment ouvrir", "comment fonctionne", "comment ca marche", "comment ça marche",
  "c'est quoi", "c est quoi", "qu'est-ce que", "qu est ce que",
  "que veut dire", "que signifie", "différence entre",
  "explique-moi", "expliquez-moi", "explique moi", "expliquez moi",
  "explique", "expliquez", "expliquer", "explain",
  "que fait ce code", "que fait cette fonction", "que fait cette ligne",
  "à quoi sert", "a quoi sert", "pourquoi ce code", "pourquoi cette ligne",
];

// Suites d'une demande d'explication : « et ce code », « ce script »…
// MAIS si un verbe d'action est présent (« corrige ce code »), c'est une
// ACTION : la porte reste ouverte aux outils.
const CODE_PASTE_MARKERS = [
  "ce code", "ce script", "cette fonction", "cette classe",
  "ce programme", "cet extrait",
];

const ACTION_VERBS = [
  "crée", "cree", "crées", "crees", "creez", "corrige", "corriges",
  "corrigez", "exécute", "execute", "exécutez", "executez", "modifie",
  "modifies", "modifiez", "lance", "lances", "lancez", "lancer", "compile",
  "compilez", "teste", "testes", "testez", "supprime", "supprimes",
  "supprimez", "écris", "ecris", "écrivez", "ecrivez", "renomme",
  "renommez", "copie", "déplace", "deplace", "déplacez", "deplacez",
  "analyse", "analyses", "analysez", "analyser", "résume", "resume",
  "résumez", "installe", "installes", "installez", "enregistre",
  "enregistrez", "sauvegarde", "sauve", "fixe", "fixes", "fixez",
];

const CODE_REQUEST_DIRECTIVE =
  "[Demande de code ou d'explication] L'utilisateur veut du code ou une " +
  "explication, pas que tu agisses sur le disque. Réponds DIRECTEMENT. " +
  'Écris en texte normal en français : JAMAIS de JSON, ni de format ' +
  'd\'appel d\'outil comme {"name": ...}. ' +
  "Si c'est une demande d'EXPLICATION de code : explique de façon " +
  "pédagogique, étape par étape, le rôle de chaque partie, les termes " +
  "techniques et la syntaxe, avec un exemple simple si utile. " +
  "Ne cherche aucun fichier, n'exécute rien.";

function isCodeRequest(userInput: string): boolean {
  const text = userInput.toLowerCase();
  if (CODE_REQUEST_MARKERS.some((marker) => text.includes(marker))) {
    return true;
  }
  // Suite d'une explication (« et ce code ») : réponse directe, à condition
  // qu'aucun verbe d'action ne montre que l'utilisateur veut AGIR.
  if (CODE_PASTE_MARKERS.some((m) => text.includes(m)) &&
      !ACTION_VERBS.some((v) => text.includes(v))) {
    return true;
  }
  return false;
}

// Filet de sécurité : le modèle ne doit JAMAIS renvoyer de JSON d'appel
// d'outil en mode « explication ». Si c'est le cas, on redemande en texte.
function looksLikeToolJson(content: string | null | undefined): boolean {
  const t = (content ?? "").trim();
  return t.startsWith("{") && t.includes('"name"') &&
    (t.includes('"parameters"') || t.includes('"arguments"'));
}

/**
 * Exécute une demande utilisateur complète.
 * @param userInput la demande en langage naturel
 * @param history   messages précédents (mémoire de session)
 * @param onTool    callback d'affichage (traçabilité des outils)
 */
export async function runAgent(
  userInput: string,
  history: ChatMessage[] = [],
  onTool?: OnTool,
): Promise<RunResult> {
  const messages = buildMessages(userInput, history);

  if (isCodeRequest(userInput)) {
    // Demande de code / explication : on répond DIRECTEMENT. Sans `tools`,
    // le modèle ne peut pas appeler d'outil → pas de recherche infinie.
    const last = messages[messages.length - 1]!;
    last.content = CODE_REQUEST_DIRECTIVE + "\n\n" + last.content;
    let reply = await chat(messages); // tools absent
    if (looksLikeToolJson(reply.content)) {
      // Petit modèle qui imite le code collé : on redemande en texte normal.
      reply = await chat([...messages, reply, {
        role: "user",
        content: "Ta réponse précédente était un JSON d'appel d'outil, " +
          "interdit ici. Réponds maintenant en texte français normal : une " +
          "explication pédagogique, sans aucun JSON.",
      }]);
    }
    messages.push(reply);
    const content = reply.content?.trim();
    return {
      response: content || "(réponse vide — reformulez votre demande)",
      history: messages,
    };
  }

  for (let step = 0; step < config.maxIterations; step++) {
    const reply = await chat(messages, TOOLS);
    messages.push(reply); // on conserve le message de l'assistant (format filaire)

    const calls = parseToolCalls(reply);
    if (calls.length === 0) {
      // Le modèle a répondu en texte : c'est la réponse finale.
      const content = reply.content?.trim();
      return {
        response: content || "(réponse vide — reformulez votre demande)",
        history: messages,
      };
    }

    for (const call of calls) {
      const result = await executeTool(call.name, call.arguments);
      if (onTool) onTool(call, result);
      // Règle d'or : le résultat est renvoyé avec le MÊME tool_call_id.
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  return {
    response:
      "J'ai atteint la limite d'itérations. Décrivez votre besoin " +
      "plus précisément ou divisez la tâche.",
    history: messages,
  };
}
