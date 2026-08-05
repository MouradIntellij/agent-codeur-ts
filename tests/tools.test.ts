/**
 * Tests unitaires (ne nécessitent PAS Ollama).
 *   npm test
 */

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

import { parseToolCalls, type ChatMessage } from "../src/llm.js";
import { executeTool } from "../src/tools.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-ts-"));
}

/** Construit un ZIP minimal (une ou plusieurs entrées déflatées), sans dépendance. */
function makeZip(entries: { name: string; content: string }[]): Buffer {
  const parts: Buffer[] = [];
  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(Buffer.from(content, "utf8"));
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // signature PK\x03\x04
    header.writeUInt16LE(20, 4); // version
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(8, 8); // méthode = deflate
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(0, 14); // crc (non vérifié)
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    parts.push(header, nameBuf, compressed);
  }
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Outils de base
// ---------------------------------------------------------------------------

test("write_file puis read_file", async () => {
  const dir = await tempDir();
  const file = join(dir, "demo.js");
  await executeTool("write_file", { path: file, content: "ligne 1\nligne 2\n" });
  const content = await executeTool("read_file", { path: file });
  assert.match(content, /1: ligne 1/);
  assert.match(content, /2: ligne 2/);
});

test("read_file fichier manquant -> erreur", async () => {
  const result = await executeTool("read_file", { path: "n'existe/pas" });
  assert.match(result, /ERREUR/);
});

test("list_dir", async () => {
  const dir = await tempDir();
  await writeFile(join(dir, "a.txt"), "x");
  const listing = await executeTool("list_dir", { path: dir });
  assert.match(listing, /a\.txt/);
});

test("bash exécute une vraie commande", async () => {
  const result = await executeTool("bash", { command: "node --version" });
  assert.match(result, /v\d+/);
});

test("outil inconnu -> erreur explicite", async () => {
  const result = await executeTool("no_such_tool", {});
  assert.match(result, /inconnu/);
});

// ---------------------------------------------------------------------------
// Recherche dans les fichiers
// ---------------------------------------------------------------------------

test("search_in_files trouve les lignes contenant le terme", async () => {
  const dir = await tempDir();
  await writeFile(join(dir, "a.js"), "const x = 1;\n// hello\nconsole.log(x);\n");
  await writeFile(join(dir, "b.js"), "console.log('autre');\n");
  const result = await executeTool("search_in_files", { folder: dir, term: "hello" });
  assert.match(result, /a\.js:2:.*hello/);
  assert.doesNotMatch(result, /b\.js/);
});

test("search_in_files insensible à la casse et récursif", async () => {
  const dir = await tempDir();
  const sub = join(dir, "sous");
  await writeFile(join(dir, "root.txt"), "rien ici\n");
  await writeFile(join(sub, "deep.txt"), "RECHERCHE trouvée\n", { flag: undefined }).catch(() => {});
  // mkdir implicite :
  await executeTool("write_file", { path: join(sub, "deep.txt"), content: "RECHERCHE trouvée\n" });
  const result = await executeTool("search_in_files", { folder: dir, term: "recherche" });
  assert.match(result, /deep\.txt:1:/);
});

test("search_in_files sans résultat", async () => {
  const dir = await tempDir();
  await writeFile(join(dir, "a.txt"), "rien\n");
  const result = await executeTool("search_in_files", { folder: dir, term: "zizou" });
  assert.match(result, /Aucune occurrence/);
});

// ---------------------------------------------------------------------------
// Lecture de documents (Word, PowerPoint, Excel, PDF)
// ---------------------------------------------------------------------------

test("read_document .docx extrait le texte", async () => {
  const dir = await tempDir();
  const file = join(dir, "doc.docx");
  const xml =
    `<w:document><w:body>` +
    `<w:p><w:t>Bonjour les étudiants</w:t></w:p>` +
    `<w:p><w:t>Deuxième paragraphe.</w:t></w:p>` +
    `</w:body></w:document>`;
  await writeFile(file, makeZip([{ name: "word/document.xml", content: xml }]));
  const result = await executeTool("read_document", { path: file });
  assert.match(result, /Bonjour les étudiants/);
  assert.match(result, /Deuxième paragraphe/);
});

test("read_document .pptx extrait le texte des diapositives", async () => {
  const dir = await tempDir();
  const file = join(dir, "pres.pptx");
  const slide =
    `<a:sld><a:cSld><a:spTree>` +
    `<a:sp><a:txBody><a:p><a:r><a:t>Titre de la diapo</a:t></a:r></a:p></a:txBody></a:sp>` +
    `</a:spTree></a:cSld></a:sld>`;
  await writeFile(file, makeZip([{ name: "ppt/slides/slide1.xml", content: slide }]));
  const result = await executeTool("read_document", { path: file });
  assert.match(result, /Diapositive 1/);
  assert.match(result, /Titre de la diapo/);
});

test("read_document .xlsx extrait les cellules", async () => {
  const dir = await tempDir();
  const file = join(dir, "notes.xlsx");
  const shared = `<sst><si><t>Pierre</t></si><si><t>Note</t></si></sst>`;
  const sheet =
    `<worksheet><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
    `<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>92</v></c></row>` +
    `</sheetData></worksheet>`;
  await writeFile(file, makeZip([
    { name: "xl/sharedStrings.xml", content: shared },
    { name: "xl/worksheets/sheet1.xml", content: sheet },
  ]));
  const result = await executeTool("read_document", { path: file });
  assert.match(result, /Feuille 1/);
  assert.match(result, /A1: Pierre/);
  assert.match(result, /B2: 92/);
});

test("read_document .pdf extrait le texte (flux déflatés)", async () => {
  const dir = await tempDir();
  const file = join(dir, "cours.pdf");
  const content = "(%PDF-1.4 ...) pas utilisé ici";
  // Construit un "PDF" minimal : un flux déflaté contenant une opération Tj.
  const stream = "BT /F1 12 Tf (Bonjour PDF) Tj ET";
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    Buffer.from(`10 0 obj\n<< /Length ${Buffer.byteLength(stream)} /Filter /FlateDecode >>\nstream\n`),
    deflateRawSync(Buffer.from(stream, "latin1")),
    Buffer.from("\nendstream\nendobj\n%%EOF"),
  ]);
  await writeFile(file, pdf);
  void content;
  const result = await executeTool("read_document", { path: file });
  assert.match(result, /Bonjour PDF/);
});

test("read_file refuse un fichier binaire (.docx)", async () => {
  const dir = await tempDir();
  const file = join(dir, "binaire.docx");
  await writeFile(file, makeZip([{ name: "word/document.xml", content: "<x/>" }]));
  const result = await executeTool("read_file", { path: file });
  assert.match(result, /BINAIRE/);
});

// ---------------------------------------------------------------------------
// Normalisation des messages
// ---------------------------------------------------------------------------

test("parseToolCalls : arguments en chaîne JSON", () => {
  const message: ChatMessage = {
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "c1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
    ],
  };
  const calls = parseToolCalls(message);
  assert.equal(calls[0]!.name, "bash");
  assert.deepEqual(calls[0]!.arguments, { command: "ls" });
});

test("parseToolCalls : arguments déjà objet", () => {
  const message: ChatMessage = {
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "c2", type: "function", function: { name: "read_file", arguments: { path: "a.js" } } },
    ],
  };
  const calls = parseToolCalls(message);
  assert.deepEqual(calls[0]!.arguments, { path: "a.js" });
});

test("parseToolCalls : aucun appel", () => {
  const calls = parseToolCalls({ role: "assistant", content: "bonjour" });
  assert.deepEqual(calls, []);
});
