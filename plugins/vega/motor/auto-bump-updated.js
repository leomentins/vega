"use strict";
// hooks/auto-bump-updated.js
//
// FONTE UNICA (HN-38 T15, 09/09/2026): este arquivo e o hook, sem copia. Quem o alcanca e
// o motor da arvore (`hooks-do-motor.mjs --executar auto-bump-updated.js`).
//
// PostToolUse hook: carimba `updated:` no frontmatter de todo `.md` editado sob a raiz do
// grafo do projeto. A raiz e do PROJETO, nunca deste codigo: o campo `raiz_do_grafo` da
// declaracao (`<raiz>/.vega/declaracao.json`, HN-29 T42). Declaracao ausente ou sem o campo
// = o projeto nao tem grafo, e o hook sai 0 sem tocar arquivo; declaracao presente e
// ilegivel, ou com forma errada, sai 2 com o motivo no stderr. Pula frontmatter incompleto
// (sem id + opened).

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0); // No stdin payload — exit silent
}

const toolName = (payload && payload.tool_name) || "";
if (!["Edit", "Write", "MultiEdit"].includes(toolName)) process.exit(0);

const filePath =
  (payload && payload.tool_input && payload.tool_input.file_path) || "";
if (!filePath.endsWith(".md")) process.exit(0);
if (!fs.existsSync(filePath)) process.exit(0);

// Cross-ROOT containment via path.relative — handles Windows case + sep variance
// (e.g., "d:/sistoli/..." vs "D:\\sistoli\\...").
const abs = path.resolve(filePath);
const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
if (rel.startsWith("..") || rel.startsWith("/")) process.exit(0); // outside ROOT

let raizDoGrafo;
try {
  raizDoGrafo = require("../scripts/vega/declaracao.mjs").raizDoGrafo(ROOT);
} catch (e) {
  // O leitor e ESM; `require` dele exige Node >= 22.12 -- falha que nao e da declaracao.
  process.stderr.write(
    e && e.code === "ERR_REQUIRE_ESM"
      ? "auto-bump-updated: leitor da declaracao nao carregou -- Node >= 22.12 exigido (" +
          process.version +
          ")\n"
      : "auto-bump-updated: declaracao do projeto ilegivel -- " +
          String((e && e.message) || e) +
          "\n",
  );
  process.exit(2);
}
if (!raizDoGrafo) process.exit(0); // o projeto nao declara grafo
if (!rel.startsWith(raizDoGrafo + "/")) process.exit(0);

// CRLF normalize — Windows-safe regex match
const raw = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
if (!fmMatch) process.exit(0); // No frontmatter

const fm = fmMatch[1];
// Skip incomplete frontmatter (mid-write): require id + opened
if (!/^id:\s/m.test(fm) || !/^opened:\s/m.test(fm)) process.exit(0);

let newFm;
if (/^updated:\s/m.test(fm)) {
  newFm = fm.replace(/^updated:\s.*$/m, `updated: ${today}`);
} else if (/^opened:\s/m.test(fm)) {
  newFm = fm.replace(/(^opened:.*$)/m, `$1\nupdated: ${today}`);
} else {
  newFm = `${fm}\nupdated: ${today}`;
}

// `referenced_by_count` e DERIVADO da lista que vive no MESMO frontmatter — nunca digitado.
// Medido 07/09/2026: 54 nos declaravam o campo e 8 contradiziam a propria lista, quase todos
// dizendo `0` com lista populada. No que se diz orfao tendo referencia e candidato a poda por
// engano. Derivar aqui e o conserto DURAVEL que o detector contador-de-referencia-mentiroso
// prescreve ("preferir derivar a apagar"): a lista esta a duas linhas de distancia, entao o
// numero nao tem como divergir dela. Vem ANTES da guarda de idempotencia de proposito — no ja
// bumpado hoje com contador errado ainda precisa ser corrigido.
if (/^referenced_by_count:\s*\d+/m.test(newFm)) {
  const bloco = newFm.match(
    /^referenced_by:[ \t]*\n((?:[ \t]+-[ \t]+.*\n?)*)/m,
  );
  const inline = newFm.match(/^referenced_by:[ \t]*\[(.*?)\]/m);
  const n = !/^referenced_by:/m.test(newFm)
    ? 0
    : bloco
      ? bloco[1].split("\n").filter((x) => x.trim().startsWith("-")).length
      : inline
        ? inline[1].trim() === ""
          ? 0
          : inline[1].split(",").length
        : 0;
  newFm = newFm.replace(
    /^referenced_by_count:\s*\d+.*$/m,
    `referenced_by_count: ${n}`,
  );
}

if (newFm === fm) process.exit(0); // Idempotent — already today

fs.writeFileSync(
  filePath,
  raw.replace(fmMatch[0], `---\n${newFm}\n---\n`),
  "utf8",
);
process.exit(0);
