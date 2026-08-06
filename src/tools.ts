/**
 * Les outils de l'agent : la liste des SCHÉMAS (ce que le modèle voit)
 * + les FONCTIONS (ce qui s'exécute réellement).
 *
 * Ici : version de base avec 6 outils. Les exigences du TP consistent
 * précisément à en ajouter (voir EXIGENCES_AMELIORATIONS.md).
 */

import { exec } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { inflateRawSync, inflateSync } from "node:zlib";
import type { ToolSchema } from "./llm.js";
import { config } from "./config.js";

const run = promisify(exec);

/** Dossiers à ignorer lors d'une recherche récursive. */
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".next", "coverage"]);

// ---------------------------------------------------------------------------
// 1) Schémas JSON : la description des outils envoyée au modèle
// ---------------------------------------------------------------------------

export const TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description:
        "Liste le contenu d'un répertoire (fichiers + dossiers). " +
        "À utiliser pour explorer un projet avant de travailler.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin du dossier (défaut: .)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Lit un fichier TEXTE ou de CODE, lignes numérotées. " +
        "TOUJOURS lire un fichier avant de le modifier.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin du fichier" },
          offset: { type: "integer", description: "Ligne de départ (1 = début)" },
          limit: { type: "integer", description: "Nombre de lignes à lire" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_document",
      description:
        "Extrait le TEXTE lisible d'un document : Word (.docx), " +
        "PowerPoint (.pptx), Excel (.xlsx), PDF (.pdf) ou fichier texte. " +
        "À utiliser pour tout fichier qui n'est pas du code simple.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin du fichier document" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_in_files",
      description:
        "Recherche un mot ou une expression dans tous les fichiers texte " +
        "d'un dossier (récursif). Retourne les fichiers et les NUMÉROS DE " +
        "LIGNE contenant l'expression. Idéal pour 'où est utilisé X ?'.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Dossier à parcourir (défaut: .)" },
          term: { type: "string", description: "Mot ou expression à chercher" },
        },
        required: ["term"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_occurrences",
      description:
        "Compte EXACTEMENT combien de fois un mot ou une expression apparaît " +
        "dans un fichier (décompte précis par le code, pas à la main). " +
        "Compte les mots entiers, sans tenir compte des majuscules.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin du fichier à analyser" },
          term: { type: "string", description: "Mot ou expression à compter" },
        },
        required: ["path", "term"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Crée un fichier ou ÉCRASE son contenu complet. " +
        "À utiliser pour créer de nouveaux fichiers.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin du fichier" },
          content: { type: "string", description: "Contenu complet à écrire" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Exécute une commande dans le terminal (node, npm, git...). " +
        "Retourne la sortie, les erreurs et le code de sortie. " +
        "Pour un CALCUL Python, utilise EXACTEMENT ce modèle (guillemets " +
        "DOUBLES à l'extérieur, apostrophes simples à l'intérieur, et " +
        "définis toujours le symbole avec sympy.symbols) : " +
        "python -c \"import sympy; x=sympy.symbols('x'); print(sympy.integrate(sympy.ln(x),x))\".",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Commande shell à exécuter" },
          timeout: { type: "integer", description: "Délai max en secondes" },
        },
        required: ["command"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// 2) Implémentations : les fonctions qui font réellement le travail.
//    Chaque fonction reçoit un UNIQUE objet d'arguments (dicté par le
//    schéma JSON) et retourne toujours du texte.
// ---------------------------------------------------------------------------

async function listDir(args: { path?: string }): Promise<string> {
  const path = args.path ?? ".";
  const entries = await readdir(path).catch(() => null);
  if (!entries) return `ERREUR: '${path}' n'est pas un dossier.`;
  return entries.sort().join("\n") || "(dossier vide)";
}

async function readFileTool(args: {
  path: string;
  offset?: number;
  limit?: number;
}): Promise<string> {
  try {
    // Un .docx (ou tout binaire) contient des octets NUL : on les détecte
    // pour ne pas saturer le contexte du modèle avec du charabia.
    const stats = await stat(args.path);
    if (stats.size > 5 * 1024 * 1024) {
      return `ERREUR: fichier trop volumineux (${stats.size} octets).`;
    }
    const buffer = await readFile(args.path);
    if (buffer.subarray(0, 8192).includes(0)) {
      return `ERREUR: '${args.path}' est un fichier BINAIRE (non texte). ` +
             `Pour un document, utilisez l'outil read_document.`;
    }
    const lines = buffer.toString("utf8").split("\n");
    const from = Math.max((args.offset ?? 1) - 1, 0);
    const to = from + (args.limit ?? config.maxReadLines);
    return lines
      .slice(from, to)
      .map((line, i) => `${from + i + 1}: ${line}`)
      .join("\n");
  } catch {
    return `ERREUR: fichier introuvable: ${args.path}`;
  }
}

async function writeFileTool(args: { path: string; content: string }): Promise<string> {
  await mkdir(dirname(args.path) || ".", { recursive: true });
  await writeFile(args.path, args.content, "utf8");
  return `OK: ${args.path} écrit (${args.content.length} caractères).`;
}

async function bash(args: { command: string; timeout?: number }): Promise<string> {
  const ms = (args.timeout ?? Math.round(config.bashTimeout / 1000)) * 1000;
  try {
    const { stdout, stderr } = await run(args.command, {
      timeout: ms,
      encoding: "utf8",
      windowsHide: true,
    });
    const output = (stdout + stderr).trim();
    const truncated =
      output.length > 4000 ? output.slice(0, 4000) + "\n...[sortie tronquée]" : output;
    return `$ ${args.command}\n${truncated}`.trim();
  } catch (err) {
    const e = err as { killed?: boolean; stdout?: string; stderr?: string };
    if (e.killed) return `ERREUR: commande interrompue après ${ms / 1000} s.`;
    const detail = ((e.stdout ?? "") + (e.stderr ?? "")).trim();
    return `$ ${args.command}\n${detail || "ERREUR: échec de la commande."}`.trim();
  }
}

// ---------------------------------------------------------------------------
// Recherche d'un terme dans un dossier (type "grep").
// ---------------------------------------------------------------------------

async function searchInFiles(args: { folder?: string; term: string }): Promise<string> {
  const needle = args.term.toLowerCase();
  const hits: string[] = [];

  async function walk(dir: string): Promise<boolean> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (await walk(full)) return true;
      } else {
        try {
          const buffer = await readFile(full);
          if (buffer.subarray(0, 8192).includes(0)) continue; // binaire : on saute
          const lines = buffer.toString("utf8").split("\n");
          for (const [i, line] of lines.entries()) {
            if (line.toLowerCase().includes(needle)) {
              const extrait = line.trim().slice(0, 200);
              hits.push(`${full}:${i + 1}: ${extrait}`);
              if (hits.length >= 100) return true; // on protège le contexte
            }
          }
        } catch {
          /* fichier illisible : on ignore */
        }
      }
    }
    return false;
  }

  const folder = args.folder ?? ".";
  await walk(folder);
  if (hits.length === 0) {
    return `Aucune occurrence de '${args.term}' dans ${folder}.`;
  }
  return `${hits.length} occurrence(s) de '${args.term}' :\n` + hits.join("\n");
}

/** Compte les occurrences d'un mot (mots entiers, insensible à la casse). */
async function countOccurrences(args: { path: string; term: string }): Promise<string> {
  try {
    const stats = await stat(args.path);
    if (stats.size > 5 * 1024 * 1024) {
      return `ERREUR: fichier trop volumineux (${stats.size} octets).`;
    }
    const buffer = await readFile(args.path);
    const text = buffer.toString("utf8");
    const needle = args.term.trim();
    let count: number;
    if (needle.includes(" ")) {
      count = text.toLowerCase().split(needle.toLowerCase()).length - 1;
    } else {
      const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      count = (text.match(re) ?? []).length;
    }
    return `Le terme '${args.term}' apparaît ${count} fois dans ${args.path} ` +
           `(${text.split(/\s+/).filter(Boolean).length} mots dans le fichier).`;
  } catch {
    return `ERREUR: fichier introuvable: ${args.path}`;
  }
}

// ---------------------------------------------------------------------------
// Lecture de documents : un .docx/.xlsx/.pptx est un ZIP (avec zlib, natif).
// Un .pdf contient des flux texte compressés (déflate). On extrait sans aucune
// dépendance. Limite connue : PDF numérisés (images) = non lisibles.
// ---------------------------------------------------------------------------

/** Parcourt les en-têtes ZIP (PK\x03\x04) et retourne les entrées décompressées. */
function listZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1; // octet par octet jusqu'à retrouver une signature
      continue;
    }
    const method = buffer.readUInt16LE(offset + 8); // 8 = deflate, 0 = stocké
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer
      .subarray(offset + 30, offset + 30 + nameLen)
      .toString("utf8");
    const data = buffer.subarray(offset + 30 + nameLen + extraLen,
                                 offset + 30 + nameLen + extraLen + compSize);
    if (!entries.has(name)) {
      entries.set(name, method === 8 ? inflateRawSync(data) : data);
    }
    offset += 30 + nameLen + extraLen + compSize;
  }
  return entries;
}

/** Transforme du XML Word/PowerPoint en texte lisible. */
function xmlToText(xml: string): string {
  return xml
    .replace(/<\/w:p>|<\/a:p>/g, "\n") // fin de paragraphe -> saut de ligne
    .replace(/<w:tab[^>]*\/>|<a:br[^>]*\/>/g, "\t")
    .replace(/<[^>]+>/g, "") // toutes les autres balises sont retirées
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Décode les entités XML d'une chaîne. */
function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// --- PowerPoint (.pptx) -----------------------------------------------------

function pptxToText(entries: Map<string, Buffer>): string {
  const slideNames = [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) =>
      Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
  if (slideNames.length === 0) return "(aucune diapositive trouvée)";
  return slideNames
    .map((name) => {
      const num = Number(name.match(/\d+/)?.[0] ?? 0);
      return `Diapositive ${num}:\n` + xmlToText(entries.get(name)!.toString("utf8"));
    })
    .join("\n\n");
}

// --- Excel (.xlsx) -----------------------------------------------------------

function xlsxSharedStrings(entries: Map<string, Buffer>): string[] {
  const xml = entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const strings: string[] = [];
  const siRe = /<si\b[\s\S]*?<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    let text = "";
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(m[0])) !== null) text += t[1];
    strings.push(decodeXml(text));
  }
  return strings;
}

function xlsxSheet(xml: Buffer, shared: string[]): string {
  const s = xml.toString("utf8");
  const lines: string[] = [];
  const cellRe = /<c\b[^>]*>[\s\S]*?<\/c>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(s)) !== null) {
    const cell = m[0];
    const ref = /r="([A-Z]+\d+)"/.exec(cell)?.[1];
    if (!ref) continue;
    const type = /t="([^"]*)"/.exec(cell)?.[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
    const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cell)?.[1];
    let value = "";
    if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
    else if (inline !== undefined) value = inline;
    else if (v !== undefined) value = v;
    if (value.trim()) lines.push(`${ref}: ${decodeXml(value)}`);
  }
  return lines.join("\n");
}

function xlsxToText(entries: Map<string, Buffer>): string {
  const shared = xlsxSharedStrings(entries);
  const sheetNames = [...entries.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) =>
      Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
  if (sheetNames.length === 0) return "(aucune feuille trouvée)";
  return sheetNames
    .map((name, i) => {
      const rows = xlsxSheet(entries.get(name)!, shared);
      return `Feuille ${i + 1}:\n${rows}`;
    })
    .join("\n\n");
}

// --- PDF ---------------------------------------------------------------------

/** Extrait et décompresse les flux texte (FlateDecode) d'un PDF. */
function pdfStreams(buffer: Buffer): Buffer[] {
  const all = buffer.toString("latin1");
  const streams: Buffer[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(all)) !== null) {
    const raw = Buffer.from(m[1] ?? "", "latin1");
    for (const inflate of [inflateSync, inflateRawSync]) {
      try {
        streams.push(inflate(raw));
        break;
      } catch {
        /* flux non compressé ou autre codec : on l'ignore */
      }
    }
  }
  return streams;
}

/** Conversion CP1252 → Unicode pour la ponctuation française des PDF. */
const CP1252: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž",
  0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

/** Décode une chaîne texte PDF (échappements + encodage CP1252). */
function decodePdfString(s: string): string {
  return s
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/[\x80-\x9f]/g, (ch) => CP1252[ch.charCodeAt(0)] ?? ch);
}

function extractPdfText(buffer: Buffer): string {
  const pieces: string[] = [];
  for (const stream of pdfStreams(buffer)) {
    const chunk = stream.toString("latin1");
    // On découpe selon les opérateurs de changement de ligne, puis on prend
    // les segments texte affichés par Tj / TJ.
    for (const segment of chunk.split(/T\*|Td|TD/)) {
      const ops = [...segment.matchAll(
        /\((?:[^()\\]|\\.)*\)\s*Tj|\[(?:[^\[\]\\]|\\.)*\]\s*TJ/g)];
      const line = ops
        .map((op) => {
          const hit = op[0];
          if (hit.startsWith("(")) {
            return decodePdfString(hit.slice(0, hit.lastIndexOf(")") + 1));
          }
          const arr = hit.slice(1, hit.lastIndexOf("]"));
          // Un même mot est souvent découpé en plusieurs chaînes avec un
          // ajustement de crénage : on recolle sans espace pour reconstruire
          // les mots. Les espaces réels apparaissent comme chaîne vide " ".
          return [...arr.matchAll(/\(((?:[^()\\]|\\.)*)\)/g)]
            .map((p) => decodePdfString(p[1] ?? ""))
            .join("");
        })
        // idem : on ne met PAS d'espace entre deux Tj, les espaces réels
        // viennent du contenu (chaîne " ").
        .join("")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (line) pieces.push(line);
    }
  }
  return pieces.join("\n").trim();
}

// --- Le répartiteur de documents ---------------------------------------------

const DOC_TEXT_LIMIT = 8000;

async function readDocumentTool(args: { path: string }): Promise<string> {
  let buffer: Buffer;
  try {
    buffer = await readFile(args.path);
  } catch {
    return `ERREUR: fichier introuvable: ${args.path}`;
  }

  const ext = args.path.toLowerCase().split(".").pop() ?? "";
  let text = "";
  try {
    switch (ext) {
      case "docx": {
        const xml = listZipEntries(buffer).get("word/document.xml");
        if (!xml) throw new Error("word/document.xml introuvable");
        text = xmlToText(xml.toString("utf8"));
        break;
      }
      case "pptx":
        text = pptxToText(listZipEntries(buffer));
        break;
      case "xlsx":
        text = xlsxToText(listZipEntries(buffer));
        break;
      case "pdf":
        text = extractPdfText(buffer);
        break;
      default:
        if (buffer.subarray(0, 8192).includes(0)) {
          return `ERREUR: type de fichier '${ext}' non supporté par read_document, ` +
                 `et le fichier semble binaire.`;
        }
        text = buffer.toString("utf8");
    }
  } catch (err) {
    return `ERREUR: impossible d'extraire le texte: ${(err as Error).message}`;
  }

  if (!text.trim()) return "(document vide ou sans texte lisible)";
  return text.length > DOC_TEXT_LIMIT
    ? text.slice(0, DOC_TEXT_LIMIT) + "\n...[tronqué]"
    : text;
}

// ---------------------------------------------------------------------------
// 3) Le répartiteur : le seul point d'entrée des outils
// ---------------------------------------------------------------------------

type Executor = (args: Record<string, unknown>) => Promise<string>;

const EXECUTORS: Record<string, Executor> = {
  list_dir: listDir as Executor,
  read_file: readFileTool as Executor,
  read_document: readDocumentTool as Executor,
  search_in_files: searchInFiles as Executor,
  count_occurrences: countOccurrences as Executor,
  write_file: writeFileTool as Executor,
  bash: bash as Executor,
};

/**
 * Exécute un outil par son nom. Retourne TOUJOURS du texte (c'est ce texte
 * que le modèle lira). Les erreurs sont renvoyées au modèle, qui peut
 * alors corriger sa demande.
 */
export async function executeTool(
  name: string,
  arguments_: Record<string, unknown>,
): Promise<string> {
  const fn = EXECUTORS[name];
  if (!fn) return `ERREUR: outil inconnu '${name}'.`;
  try {
    return await fn(arguments_);
  } catch (err) {
    return `ERREUR inattendue dans ${name}: ${(err as Error).message}`;
  }
}
