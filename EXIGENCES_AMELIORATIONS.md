# Exigences — Ajoutez des fonctionnalités à votre agent IA

> Pour les étudiants. Vous avez reçu le dossier **complet** de l'agent
> (`agent-codeur-ts/`). Vous allez maintenant **le modifier** pour lui
> ajouter des capacités. La version fournie comporte 6 outils
> (`list_dir`, `read_file`, `read_document`, `search_in_files`,
> `write_file`, `bash`) — c'est une base volontairement minimaliste :
> **tout le reste, c'est vous qui le codez.**
>
> **Note** : la boucle de l'agent (`src/agent.ts`) inclut déjà une « porte de
> décision » : les demandes de code ou d'explication sont traitées **sans
> outils** (l'agent répond directement au lieu de chercher des fichiers). Les
> exigences ci-dessous portent sur les **outils** que vous allez ajouter.

---

## 1. Pourquoi cet exercice ?

Un agent IA n'a que les capacités que VOUS lui donnez. Ajouter un outil, c'est
ajouter une fonctionnalité. Cet exercice vous apprend la **démarche
d'extension** d'un agent, identique dans tous les frameworks (LangChain,
Vercel AI SDK, OpenAI…) :

> Écrire une fonction → la décrire en JSON → la déclarer → la tester.

## 2. La recette : ajouter un outil en 5 étapes

Tous les exercices reposent sur cette même recette.

### Étape A — Écrire la fonction Python->TS de l'outil

Dans `src/tools.ts`, une fonction qui **reçoit un objet d'arguments** et
**retourne toujours du texte** (c'est ce texte que le modèle lira) :

```ts
async function getDate(_args: { format?: string }): Promise<string> {
  return new Date().toLocaleString("fr-CA");
}
```

### Étape B — Décrire l'outil en JSON (schéma)

Ajoutez l'objet dans le tableau `TOOLS` de `src/tools.ts` :

```ts
{
  type: "function",
  function: {
    name: "get_date",
    description: "Retourne la date et l'heure actuelles.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
},
```

> Le **nom** doit correspondre exactement à celui de l'étape C. La
> **description** est ce que le modèle utilise pour décider QUEL outil choisir.
> Soignez-la.

### Étape C — Déclarer la fonction dans `EXECUTORS`

```ts
const EXECUTORS: Record<string, Executor> = {
  list_dir: listDir as Executor,
  // ... outils existants ...
  get_date: getDate as Executor,   // <-- votre ajout
};
```

### Étape D — (si besoin) informer le modèle dans `prompt.ts`

Si l'outil change la méthode de travail de l'agent (ex. : un outil de
sécurité), ajoutez une ligne dans `SYSTEM_PROMPT`.

### Étape E — Tester

1. Test manuel : lancez `npm start` et demandez « quelle est la date ? ».
2. Test unitaire : ajoutez un cas dans `tests/tools.test.ts` :

```ts
test("get_date retourne une date", async () => {
  const result = await executeTool("get_date", {});
  assert.match(result, /\d{4}/);   // l'année est présente
});
```

Puis `npm run typecheck && npm test`.

---

## 3. Les exigences

Réalisez **au moins 3 exigences** (choisissez dans au moins deux niveaux
différents). Chaque exigence précise son **niveau**, sa **description**, les
**fichiers à modifier** et les **critères d'acceptation** (ce qui doit être
démontré).

### Niveau ★ — Facile

#### EXIG-1 : Outil `edit_file`
- **But** : modifier une portion exacte d'un fichier sans le réécrire en entier.
- **Signature** : `edit_file(path, old_string, new_string)`.
- **Contraintes** :
  - Refuser (`ERREUR`) si `old_string` n'existe pas.
  - Refuser si `old_string` apparaît **plusieurs fois** (ambiguïté → ne pas deviner).
- **Fichiers** : `src/tools.ts`, `tests/tools.test.ts`.
- **Critères** : demandez « dans hello.js, remplace "Bonjour" par "Salut" » ;
  vérifiez que seul le texte visé a changé, avec `read_file` avant/après.
- **Indice** : `readFile` → `content.indexOf` / `split(old).length` →
  `writeFile`.

#### EXIG-2 : Outil `glob`
- **But** : trouver des fichiers par motif (`**/*.js`, `src/**`).
- **Signature** : `glob(pattern)`.
- **Fichiers** : `src/tools.ts` + `tests/tools.test.ts`.
- **Critères** : demandez « liste tous les fichiers .ts du projet » → l'agent
  doit répondre avec la liste réelle.
- **Indice** : parcourez récursivement avec `readdir({ withFileTypes: true })`
  (attention à `node_modules`), puis comparez à une expression régulière
  construite depuis le motif (`*` → `[^/]*`, `**` → `.*`).

#### EXIG-3 : Outil `delete_file` (avec garde-fou)
- **But** : supprimer un fichier, mais **jamais sans confirmation**.
- **Signature** : `delete_file(path)`.
- **Contraintes** : refusez de supprimer si `path` contient `..` ou si le
  fichier n'existe pas. Ajoutez au prompt : « ne supprime jamais sans accord
  de l'utilisateur ».
- **Fichiers** : `src/tools.ts`, `src/prompt.ts`, tests.
- **Critères** : demandez de supprimer un fichier du projet → l'agent doit
  D'ABORD demander votre accord, puis (une fois accord donné) supprimer.

### Niveau ★★ — Moyen

#### EXIG-4 : Outil `get_env_info`
- **But** : donner au modèle des informations système (date, dossier courant,
  version de Node, espace libre) pour de meilleures décisions.
- **Signature** : `get_env_info(what?: "date" | "cwd" | "node" | "all")`.
- **Fichiers** : `src/tools.ts` + tests.
- **Critères** : demandez « quel est mon dossier de travail ? » → l'agent
  utilise l'outil et répond correctement.

#### EXIG-5 : Mémoire persistante (`/save`, `/load`)
- **But** : sauvegarder l'historique de session dans `.session.json` pour
  reprendre une discussion après redémarrage.
- **Signature** : modifiez `src/main.ts` (commandes `/save` et `/load`) et
  `src/config.ts` (chemin du fichier).
- **Fichiers** : `src/main.ts`, `src/config.ts`.
- **Critères** : demandez à l'agent de mémoriser un fait (« mon projet s'appelle
  voyager ») → `/save` → quittez → relancez → `/load` → demandez « comment
  s'appelle mon projet ? » → réponse correcte.

#### EXIG-6 : Liste blanche de commandes bash (sécurité)
- **But** : refuser les commandes dangereuses **avant** exécution.
- **Signature** : dans `bash()` de `src/tools.ts`, vérifiez le premier mot de
  `command` contre une liste blanche (`node`, `npm`, `git`, `ls`, `python`,
  `pytest`…). Si inconnue → retournez une erreur explicite.
- **Fichiers** : `src/tools.ts`, `src/config.ts` (la liste), tests.
- **Critères** : demandez « exécute `rm -rf .` » → l'agent doit refuser et
  expliquer. Démonstration : 2 captures (commande permise ✔, commande refusée ✔).
- **Défi bonus** : ajoutez un message au modèle pour qu'il suggère une
  alternative sûre.

#### EXIG-7 : Outil `fetch_url`
- **But** : permettre à l'agent de lire le contenu d'une page web.
- **Signature** : `fetch_url(url)` → retourne les 4000 premiers caractères.
- **Fichiers** : `src/tools.ts` + tests (sur une URL locale, ex. votre propre
  serveur, pour ne pas dépendre d'Internet).
- **Critères** : demandez « affiche le titre de http://localhost:8000 ».
- **Attention sécurité** : limitez les protocoles (`http`/`https`) et le nombre
  de requêtes. À discuter en classe.

### Niveau ★★★ — Avancé

#### EXIG-8 : Streaming des réponses
- **But** : afficher la réponse du modèle **mot à mot** au lieu d'attendre la fin.
- **Signature** : modifiez `src/llm.ts` pour envoyer `stream: true` et parser
  les lignes `data: {...}` (format SSE). Faites afficher les delta de contenu
  dans `src/main.ts`.
- **Fichiers** : `src/llm.ts`, `src/main.ts`.
- **Critères** : la réponse « codeur> » apparaît en continu, caractère par
  caractère.
- **Indice** : `response.body.getReader()` + `TextDecoder`; chaque ligne
  commence par `data: ` et se termine par `[DONE]`.

#### EXIG-9 : Un deuxième agent « évaluateur »
- **But** : créer un agent **superviseur** qui reçoit le code écrit par l'agent
  principal et le **relit/corrige** (deux agents qui collaborent).
- **Signature** : nouveau fichier `src/evaluator.ts` : `runEvaluator(code)`
  appelle le même `llm.chat` avec un system prompt différent
  (« Tu es un réviseur strict »). L'agent principal appelle l'évaluateur par
  un outil `review_code(path)`.
- **Fichiers** : `src/evaluator.ts`, `src/tools.ts`, `src/prompt.ts`.
- **Critères** : l'agent produit un script avec une erreur volontaire → l'outil
  `review_code` signale l'erreur → l'agent corrige → le test passe.
- **C'est exactement** le schéma des « agents multiples » des outils pro.

#### EXIG-10 : Changer de fournisseur sans changer de code
- **But** : prouver que l'API « compatible OpenAI » fonctionne ailleurs.
- **Signature** : aucune modification de code nécessaire. Utilisez :
  ```bash
  $env:AGENT_MODEL = "gpt-4o-mini"
  $env:OLLAMA_URL   = "https://api.openai.com/v1"   # + clé API dans le code? NON
  ```
  → lisez la doc OpenAI : le SDK exige une clé. **Réflexion** : où ajouter la
  clé sans la « commit » ? → variables d'environnement / fichier `.env` ignoré
  par git.
- **Fichiers** : `src/config.ts` (gestion de la clé), `README.md`.
- **Critères** : démontrez en classe que l'agent fonctionne sur Ollama PUIS
  sur le cloud avec la même base de code. Comparez vitesse, coût, qualité.

#### EXIG-11 : Recherche par expression régulière (améliorer `search_in_files`)
- **But** : la recherche fournie (`search_in_files`) ne gère que du texte
  exact. Ajoutez le mode **regex** pour des recherches puissantes
  (ex. : `^function`, `\d{4}`, `import.*from`).
- **Signature** : `search_in_files(folder, term, regex?: boolean)`.
- **Contraintes** : si `regex` est vrai, validez la regex (try/catch) et
  retournez une erreur explicite si elle est invalide. Protégez le contexte
  (limite de résultats).
- **Fichiers** : `src/tools.ts` + `tests/tools.test.ts`.
- **Critères** : demandez « trouve toutes les lignes qui commencent par
  `import` dans `src/` » → résultats corrects. Testez aussi une regex
  invalide → l'agent doit signaler l'erreur, pas planter.
- **Indice** : `new RegExp(term, "i")` au lieu de `includes()`. Comparez
  ensuite avec les outils pro (`ripgrep`/`rg`).

---

## 4. Règles communes

1. **Ne cassez pas le projet** : `npm run typecheck` et `npm test` doivent
   rester verts après chaque ajout.
2. **Une exigence = une démonstration** : capture(s) d'écran de la session
   réelle + le code des fichiers modifiés.
3. **Tout nouveau comportement mérite un test unitaire.**
4. Documentez vos ajouts dans un `AJOUTS.md` : pour chaque fonctionnalité,
   le fichier modifié, la logique, les limites connues.

## 5. Grille de correction (sur 100)

| Exigence | Points |
|---|---|
| EXIG-1 à 3 (niveau ★) | 20 chacune |
| EXIG-4 à 7 (niveau ★★) | 30 chacune |
| EXIG-8 à 11 (niveau ★★★) | 40 chacune |
| Tests unitaires ajoutés | 10 (bonus) |
| Qualité : typecheck + code propre + `AJOUTS.md` | 10 |
| **Minimum requis** | **3 exigences**, dont au moins 1 de niveau ★★ ou plus |

Exemple de barème : EXIG-1 (20) + EXIG-5 (30) + EXIG-8 (40) = 90/100.

---

*Rappel : ajouter une fonctionnalité à un agent, c'est ajouter une fonction,
la décrire en JSON, la déclarer — et la tester. Vous venez de maîtriser la
démarche qui est au cœur de tous les assistants IA professionnels.*
