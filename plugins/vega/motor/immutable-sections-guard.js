"use strict";
// .claude/hooks/immutable-sections-guard.js
//
// LOCAL-IS-LIVE, POR RULING (D-HN38-12, 09/09/2026). Este guard NAO foi colapsado no motor
// junto com os outros tres do nucleo: ele fica no GATE DE COMMIT, e nao no canal dos hosts.
// Mover para o canal trocaria um gate host-agnostico por construcao (o `.husky/pre-commit`
// roda igual nos quatro) por um gate de ferramenta — ponto de enforcement diferente, nao
// consolidacao. O homonimo que `harness-core` embarca continua REGISTRADO, nao apagado: ele
// e a generalizacao config-driven deste, e nenhum host o alcanca (o `hooks.json` do plugin
// deixou de registrar hook nenhum na T15 — os hooks do motor rodam da arvore, por
// `.claude/skills/vega/motor/hooks-do-motor.mjs`, desde a HN-29 T8).
//
// O QUE MUDOU NA T15 (fecha AE-HN20-IMMUTABLE-GUARD-HARDCODE-PERSISTS): o caminho do
// documento protegido saiu do codigo. Desde a HN-29 T12 ele vem da declaracao do projeto a
// fabrica, `.vega/declaracao.json` (`immutable_docs`), lida pelo leitor dela
// (`.claude/skills/vega/scripts/vega/declaracao.mjs`). So o CAMINHO saiu — as secoes
// travadas seguem declaradas no frontmatter do proprio documento, que e onde a decisao
// mora. Declaracao ausente, ilegivel ou sem a chave = fail-loud, nunca pass silencioso:
// este gate protege secao imutavel de blueprint, e desligar por omissao seria o silencio
// indistinguivel de verde (`dev-discipline.md` §Veredito de CI; D-HN29-5a).
//
// Pre-commit guard: parse immutable_sections from frontmatter of each declared doc,
// scan staged diff for changes inside listed sections, exit 1 if intersect.
//
// WIRED em .husky/pre-commit pós-HN-7 F7 — gate runtime das immutable_sections
// declaradas em F4 Step 5.3.2. Override só com `git commit --no-verify` + aprovação
// Leo explícita (ver CLAUDE.md §O que NUNCA Fazer).
//
// Strategy: section tracking via line numbers (file-side). Diff hunks NÃO incluem
// headers de seção como context quando edit está distante do header (default
// unified=3). Por isso, parsa o arquivo para mapear "linha → seção" e cruza com
// line numbers extraídos dos hunk headers (@@ -A,B +C,D @@).

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// --- caminho do documento protegido: DECLARACAO, nao codigo (D-HN38-12 / HN-29 T12) ---
// Fail-loud nas formas de "declaracao que nao declara nada": ausente, ilegivel, forma
// errada, sem a chave. Chave ausente sai do leitor como lista vazia, e lista vazia aqui
// reprova: o guard existe porque ESTE repo tem secao imutavel de blueprint, e sair 0 por
// omissao seria apagar o gate calado.
const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function morre(msg) {
  console.error(`immutable-sections-guard: ${msg}`);
  process.exit(1);
}

// O leitor mora em lugar diferente conforme onde o guard mora (HN-29 T46): na fonte, o guard
// fica em `.claude/hooks/` e o leitor em `.claude/skills/vega/scripts/vega/`; no plugin
// exportado, a `lista-corpo.txt` poe o guard em `plugins/vega/motor/` e o leitor em
// `plugins/vega/scripts/vega/`. Carrega o primeiro que existe; nenhum = fail-loud.
const READER_PATHS = [
  path.join(__dirname, "../skills/vega/scripts/vega/declaracao.mjs"),
  path.join(__dirname, "../scripts/vega/declaracao.mjs"),
];

let declaracao;
let arquivoDaDeclaracao;
try {
  const reader = READER_PATHS.find((p) => fs.existsSync(p));
  if (!reader)
    morre(
      `leitor da declaracao nao encontrado em nenhum dos dois lugares: ${READER_PATHS.join(" · ")}.`,
    );
  const { lerDeclaracao } = require(reader);
  ({ declaracao, arquivo: arquivoDaDeclaracao } = lerDeclaracao(ROOT));
} catch (e) {
  morre(`${e.message} — nao ha o que proteger declarado.`);
}

const IMMUTABLE_DOCS = declaracao.immutable_docs;
if (IMMUTABLE_DOCS.length === 0)
  morre(`\`immutable_docs\` ausente ou vazio em ${arquivoDaDeclaracao}.`);

const stagedFiles = execSync("git diff --cached --name-only", {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

/** Violacoes de UM documento protegido. `[]` = nada a acusar neste doc. */
function conferirDoc(BLUEPRINT_PATH) {
  if (!fs.existsSync(BLUEPRINT_PATH)) return []; // rollback / doc ainda nao existe — pass
  if (!stagedFiles.includes(BLUEPRINT_PATH)) return []; // nao staged — pass

  // CRLF normalize — Windows-safe regex match
  const blueprint = fs
    .readFileSync(BLUEPRINT_PATH, "utf8")
    .replace(/\r\n/g, "\n");
  const fmMatch = blueprint.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    morre(`${BLUEPRINT_PATH}: frontmatter ausente — refusing.`);
  }
  const fm = fmMatch[1];

  // Parse `immutable_sections:` — block list form (F4 YAML emit pattern)
  let sections = [];
  const blockMatch = fm.match(/^immutable_sections:\s*\n((?:\s+-\s.*\n?)+)/m);
  if (blockMatch) {
    sections = blockMatch[1]
      .split("\n")
      .map((line) => line.match(/^\s+-\s+(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => m[1].replace(/^['"]|['"]$/g, ""));
  } else {
    // Inline fallback: `immutable_sections: [a, b]`
    const inlineMatch = fm.match(/^immutable_sections:\s*\[(.*?)\]\s*$/m);
    if (inlineMatch) {
      sections = inlineMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
  }

  if (sections.length === 0) return []; // No locked sections declared — pass

  // Extract section anchor prefix (e.g., "§A.3 Hierarquia" → "A.3")
  const anchors = sections
    .map((s) => {
      const m = s.match(/^§?([A-Z](?:\.\d+)*)/);
      return m ? m[1] : null;
    })
    .filter(Boolean);

  // Build line→section map from file content (HEAD version, not staged blob).
  // For each blueprint line, determine which section anchor (if any) it belongs to.
  // A section starts at its header line and continues until the next header at same/higher level.
  const blueprintLines = blueprint.split("\n");
  const lineSection = new Array(blueprintLines.length + 1).fill(null); // 1-indexed
  let curAnchor = null;
  let curDepth = 0;
  for (let i = 0; i < blueprintLines.length; i++) {
    const line = blueprintLines[i];
    const headerMatch = line.match(/^(#{1,4})\s+§?([A-Z](?:\.\d+)*)\b/);
    if (headerMatch) {
      const depth = headerMatch[1].length;
      const newAnchor = headerMatch[2];
      // If a new header is at depth equal to or shallower than the current section,
      // the old section ends. If it's deeper, the old section continues (it's a subsection).
      if (curAnchor === null || depth <= curDepth) {
        curAnchor = newAnchor;
        curDepth = depth;
      } else {
        // deeper subsection — keep parent section context but track subsection anchor too
        curAnchor = newAnchor;
        curDepth = depth;
      }
    }
    lineSection[i + 1] = curAnchor; // 1-indexed
  }

  const isImmutable = (anchor) =>
    anchor && anchors.some((a) => anchor === a || anchor.startsWith(a + "."));

  // Parse diff hunks. For each +/- line, derive its file-side line number and
  // look up which section it falls in via lineSection map.
  const diff = execSync(`git diff --cached -- "${BLUEPRINT_PATH}"`, {
    encoding: "utf8",
  });
  const diffLines = diff.split("\n");

  let oldLine = 0;
  let newLine = 0;
  const violations = [];

  for (const line of diffLines) {
    const hunkHeader = line.match(
      /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/,
    );
    if (hunkHeader) {
      oldLine = parseInt(hunkHeader[1], 10);
      newLine = parseInt(hunkHeader[2], 10);
      continue;
    }
    if (!oldLine && !newLine) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;

    if (line.startsWith("+")) {
      // added line — check section on NEW side (post-edit blob).
      // Approximation: use HEAD's lineSection map (we already loaded HEAD blueprint above).
      // For pre-commit on staged INSERT, the added line in NEW file is at newLine in NEW blob,
      // which corresponds to between (oldLine-1) and (oldLine) in OLD blob. We probe lineSection
      // at (oldLine - 1) since that's the line immediately preceding the insertion in HEAD.
      const probeLine = Math.max(1, oldLine - 1);
      const anchor = lineSection[probeLine];
      if (isImmutable(anchor)) {
        violations.push({
          section: `§${anchor}`,
          line: `+${line.slice(1, 100)} (near HEAD line ${probeLine})`,
        });
      }
      newLine++;
    } else if (line.startsWith("-")) {
      // removed line — exists at oldLine in HEAD
      const anchor = lineSection[oldLine];
      if (isImmutable(anchor)) {
        violations.push({
          section: `§${anchor}`,
          line: `-${line.slice(1, 100)} (HEAD line ${oldLine})`,
        });
      }
      oldLine++;
    } else if (line.startsWith(" ")) {
      oldLine++;
      newLine++;
    }
  }

  return violations.map((v) => ({ ...v, doc: BLUEPRINT_PATH, sections }));
}

const todas = IMMUTABLE_DOCS.flatMap((doc) => conferirDoc(doc));

if (todas.length > 0) {
  console.error(
    "immutable-sections-guard: BLOCKED — diff touches immutable sections:",
  );
  for (const v of todas.slice(0, 5)) {
    console.error(`  ${v.doc} ${v.section}: ${v.line}`);
  }
  const travadas = [...new Set(todas.flatMap((v) => v.sections))];
  console.error(
    `Total violations: ${todas.length}. Locked sections: ${travadas.join(", ")}.`,
  );
  console.error(
    "Override (Leo only): git commit --no-verify (REQUIRES explicit approval — see CLAUDE.md §O que NUNCA Fazer).",
  );
  process.exit(1);
}
process.exit(0);
