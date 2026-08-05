# Agent de codage pédagogique — version TypeScript/Node.js

Même agent que la version Python, réécrit en **TypeScript** pour les
étudiants qui maîtrisent le développement full-stack (Node.js).

**Architecture identique** : un LLM local (Ollama) + des outils + une boucle
« raisonner → agir → observer → réessayer ». Zéro dépendance d'exécution :
on utilise `fetch` natif de Node 18+, `node:fs`, `node:child_process`,
`node:readline`, `node:zlib` — tout est dans Node.

---

## Démarrage rapide

```bash
# 1. Prérequis : Ollama + un modèle (une seule fois)
ollama pull qwen2.5:latest
ollama serve

# 2. Installer les dépendances de DÉVELOPPEMENT (typescript + tsx)
npm install

# 3. Lancer l'agent
npm start
```

## Interface web (local)

Même agent, mais accessible depuis un **navigateur** : une personne qui n'a
pas accès à l'éditeur peut poser ses questions au Codeur sans toucher au code.

```bash
npm run web        # démarre le serveur sur http://127.0.0.1:3000
```

Ouvrez `http://127.0.0.1:3000` : page de chat avec historique, trace des
outils utilisés (🔧) et bouton « Nouvelle session ».

- **Chaque navigateur a sa propre session** (cookie + mémoire serveur).
- **Fichiers hors du dossier** : fonctionne — donnez simplement le chemin
  absolu, ex. « Résume `C:\Cours\plan.pdf` ».
- **Réseau local (salle de classe)** : pour que d'autres postes se connectent,
  lancez `AGENT_HOST=0.0.0.0 npm run web` et ouvrez `http://IP-du-poste:3000`.
  ⚠️ Cela expose aussi les outils (dont `bash`) — à réserver à une classe de
  confiance, jamais sur Internet public.
- Réglages : `AGENT_PORT` (défaut `3000`), `AGENT_HOST` (défaut `127.0.0.1`).

### Lancement sans éditeur (pour l'enseignant en classe)

**Double-cliquez sur `demarrer-agent.bat`** : le script vérifie Node, démarre
Ollama s'il ne tourne pas, lance `npm run web` et ouvre automatiquement
`http://127.0.0.1:3000` dans le navigateur. Aucun éditeur, aucune commande,
**aucun Internet nécessaire** au moment de la démo (le modèle et les documents
sont sur la machine ; les dépendances `node_modules` ne sont installées
qu'une seule fois).

> GitHub ne peut pas héberger cet agent : son « cerveau » (Ollama) et ses
> outils travaillent sur le **disque local** de la machine qui le fait tourner.
> GitHub sert à **distribuer** le code source ; pour la démo, on copie le
> dossier sur le poste (Node + Ollama installés) et on double-clique.

### Installer sur un autre ordinateur (poste étudiant, salle de classe)

Pour faire tourner l'agent sur un autre PC, il faut y mettre le code **une
fois**, puis lancer l'installation **une fois** ; ensuite l'agent tourne
**sans Internet**.

**Option A — via GitHub** (après avoir mis le code sur votre compte GitHub) :
```bash
git clone https://github.com/votre-compte/agent-codeur-ts.git
cd agent-codeur-ts
installer.bat        # une seule fois : Node, Ollama, modèle, npm install
demarrer-agent.bat   # à chaque fois : serveur + navigateur
```

**Option B — via un fichier ZIP** (Teams, clé USB, courriel) :
1. Compressez le dossier `agent-codeur-ts` en `.zip` (sans `node_modules`).
2. Transférez-le, décompressez-le sur l'autre poste.
3. Double-cliquez sur `installer.bat` (une seule fois), puis `demarrer-agent.bat`.

> ℹ️ L'installation demande Internet **une seule fois** (téléchargement du
> modèle, ~2 Go). L'**utilisation** ensuite est 100 % hors ligne.

Puis tapez, par exemple :

```
Crée un script hello.js qui affiche "Bonjour le monde !" puis exécute-le.
```

Exemples de questions que vous pouvez poser :

| Demande | Outil utilisé |
|---|---|
| « Crée un fichier `tri.js` qui trie une liste, puis exécute-le » | `write_file` + `bash` |
| « Explique ce que fait `src/agent.ts` » | `read_file` |
| « Résume ce document `...\Chapitre1.docx` » | `read_document` |
| « Lis le plan de cours `...\plan.pdf` » | `read_document` |
| « Quelles lignes de `src/` mentionnent `bash` ? » | `search_in_files` |
| « Liste le contenu du dossier `src` » | `list_dir` |

Autres commandes utiles :

| Commande | Rôle |
|---|---|
| `npm start` | Lance l'agent (CLI interactive) |
| `npm run web` | Lance l'interface web (local) sur http://127.0.0.1:3000 |
| `npm run typecheck` | Vérifie les types (`tsc --noEmit`) |
| `npm test` | Lance les tests unitaires (sans Ollama) |

---

## Structure du projet

```
agent-codeur-ts/
├── package.json        # scripts + dépendances de dev (typescript, tsx)
├── tsconfig.json       # TypeScript strict, modules ESM (NodeNext)
├── src/
│   ├── main.ts         # INTERFACE : le terminal où l'on parle à l'agent
│   ├── server.ts       # INTERFACE : le serveur HTTP (interface web) 🆕
│   ├── agent.ts        # BOUCLE    : raisonner → agir → observer → réessayer
│   ├── llm.ts          # RÉSEAU    : client fetch compatible OpenAI
│   ├── tools.ts        # OUTILS    : schémas JSON + implémentations
│   ├── prompt.ts       # PERSONNALITÉ : le system prompt
│   └── config.ts       # RÉGLAGES  : modèle, URL, limites
├── public/
│   └── index.html      # page de chat servie par server.ts 🆕
└── tests/
    └── tools.test.ts   # 16 tests unitaires (node:test)
```

### Les 6 outils fournis

| Outil | Rôle |
|---|---|
| `list_dir` | Explorer un dossier |
| `read_file` | Lire un fichier texte/code (lignes numérotées) |
| `read_document` | Extraire le texte de **Word (.docx), PowerPoint (.pptx), Excel (.xlsx), PDF (.pdf)** et fichiers texte |
| `search_in_files` | Rechercher un mot/expression dans un dossier → `fichier:n°ligne: contenu` |
| `write_file` | Créer / écraser un fichier |
| `bash` | Exécuter une commande (node, npm, git…) |

> Les formats Office sont des ZIP, les PDF des flux compressés : on les
> décode avec `node:zlib` (natif), **sans aucune dépendance**. Limite connue :
> un PDF **numérisé** (image) n'a pas de texte à extraire.

### Correspondance Python ↔ TypeScript (pour les étudiants qui connaissent les deux)

| Concept | Python | TypeScript |
|---|---|---|
| Client réseau | `requests.post(...)` | `fetch(url, {...})` (natif) |
| I/O fichiers | `open()` / `os` | `node:fs/promises` |
| Commandes | `subprocess.run` | `node:child_process` + `promisify(exec)` |
| Tests | `unittest` | `node:test` |
| Exécution | `python main.py` | `npx tsx src/main.ts` |

### Points TypeScript à remarquer

- **`strict: true`** : les types sont vérifiés partout (`npm run typecheck`).
- **ESM** (`"type": "module"`) : imports avec extensions `./agent.js`
  (le `.js` pointe en réalité vers le `.ts` — convention NodeNext).
- **`as Executor`** : les fonctions d'outils reçoivent un *unique objet
  d'arguments* (dicté par le schéma JSON) — jamais de `args` à plat.
- **Top-level `await`** dans `main.ts` : possible grâce aux modules ESM.

---

## Testé

- `npm run typecheck` ✔ | `npm test` (16/16) ✔
- Test réel sur Ollama (qwen2.5) : l'agent a créé `hello.js` puis l'a
  exécuté avec `node` ✔
- `read_document` validé sur un vrai `.docx` et un vrai `.pdf` de cours,
  `search_in_files` validé en session réelle ✔

---

## Pour les étudiants : exercices

**Consigne** : vous avez reçu le dossier complet de l'agent. Avant de le
personnaliser, faites-le tourner, puis lisez chaque fichier dans l'ordre
`config → llm → tools → prompt → agent → main`. Comprenez le trajet d'une
demande : `main → agent → llm → Ollama → (tool_calls) → tools → agent → main`.

Ensuite, réalisez **au moins 3 exigences** du document
[`EXIGENCES_AMELIORATIONS.md`](EXIGENCES_AMELIORATIONS.md) et prouvez chacune
par un test (capture d'écran de la session).
