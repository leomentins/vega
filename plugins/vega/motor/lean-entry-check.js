"use strict";
// PreToolUse(Edit|Write|MultiEdit) gate: peso de entrada nova contra a vizinhanca dela.
//
// O ESCOPO E DECLARADO PELO PROJETO, nunca digitado aqui: vem da declaracao do projeto a
// fabrica, `<root>/.vega/declaracao.json` (root = $CLAUDE_PROJECT_DIR || cwd), lida pelo
// leitor da declaracao (`../scripts/vega/declaracao.mjs`, HN-29 T12), que confere a forma:
//
//   "lean_scope_docs": [
//     { "path": ".agents/blueprint/x.md", "entry": "^### |^#### ", "unit": "lines" }
//   ],
//   "lean_record_scopes": [
//     { "dir": "registros/", "contract": "contratos/registro.schema.json",
//       "fields": ["titulo", "corpo"], "unit": "chars" }
//   ]
//
// Dois ramos de medida:
//   (a) DOCUMENTO -- entrada nova contra a vizinhanca dela, na unidade do escopo (`lines`
//       e o default; `chars` onde a linha e unidade mentirosa).
//   (b) REGISTRO -- um `.json` por entrada, medido contra o TETO DO TIPO, lido do contrato
//       que o escopo nomeia (dentro de um arquivo unico nao ha vizinhanca). O que atravessa
//       a fronteira e DADO, nunca modulo do projeto.
//
// Protocolo de saida (bloqueio real = exit 2, nunca exit 1):
//   - exit 0 silente: edicao ok, segue.
//   - exit 2 + stderr: BLOQUEIO (a instrucao vai no stderr) OU fail-loud de declaracao.
//
// Fail-loud: declaracao AUSENTE, ilegivel ou com forma errada = exit 2 em toda edicao, nunca
// lista vazia (D-HN29-5a) — menos na edicao da propria `.vega/declaracao.json`, que e o
// reparo. Chave ausente na declaracao = o projeto nao declara esse escopo = exit 0.
// Escopo de registro sem contrato legivel = exit 2. Gate que nao acha o proprio teto nao
// pode passar calado.
//
// NUNCA crash por causa da ENTRADA (payload malformado, arquivo ilegivel): fallback exit 0.

const fs = require("fs");
const path = require("path");

const MAX_RATIO = 2.0;
const NEIGHBORHOOD_SIZE = 5;
// Filtro de typo-fix, por unidade. 400 chars ~= as 8 linhas do filtro original a
// ~50 chars/linha; abaixo disso a edicao e correcao pontual, nao entrada nova.
const MIN_DELTA_BY_UNIT = { lines: 8, chars: 400 };

const SCOPE_PATTERNS = [];
const ENTRY_PATTERNS = {};
const UNIT_BY_SCOPE = {};
let RECORD_SCOPES = [];

/** Fail-loud de declaracao: a mensagem vai para stderr e o processo sai 2. */
function morre(msg) {
  process.stderr.write(`lean-entry-check: ${msg}\n`);
  process.exit(2);
}

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Declaracao que nao carregou: guardada aqui e cobrada por edicao, nao no load, para que a
// edicao que CONSERTA a propria declaracao passe — sem isso, declaracao quebrada trancaria
// todo Edit/Write/MultiEdit, inclusive o de reparo.
let ERRO_DA_DECLARACAO = null;

(function carregarDeclaracao() {
  let declaracao;
  try {
    const { lerDeclaracao } = require("../scripts/vega/declaracao.mjs");
    declaracao = lerDeclaracao(ROOT).declaracao;
  } catch (e) {
    ERRO_DA_DECLARACAO = e.message;
    return;
  }

  for (const d of declaracao.lean_scope_docs) {
    if (!SCOPE_PATTERNS.includes(d.path)) SCOPE_PATTERNS.push(d.path);
    const base = d.path.split("/").pop();
    if (d.entry) ENTRY_PATTERNS[base] = new RegExp(d.entry);
    if (d.unit) UNIT_BY_SCOPE[base] = d.unit;
  }

  RECORD_SCOPES = declaracao.lean_record_scopes.map((s) => ({
    dir: s.dir,
    contract: s.contract,
    campos: s.fields,
    unit: s.unit,
  }));
})();

/**
 * Tetos do escopo de registro, DERIVADOS do contrato do projeto -- nunca digitados aqui.
 * Numero repetido a mao e a forma classica de o codigo e o contrato divergirem sem nada
 * acusar. Contrato ausente ou sem `maxLength` para um campo cobrado = fail-loud: um gate
 * que nao sabe o proprio teto passando calado e pior que gate nenhum.
 */
function tetosDoContrato(escopo) {
  const abs = path.join(ROOT, escopo.contract);
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    morre(`contrato de \`${escopo.dir}\` ilegivel (${abs}): ${e.message}`);
  }
  const props = (schema && schema.properties) || {};
  const tetos = {};
  for (const campo of escopo.campos) {
    const teto = props[campo] && props[campo].maxLength;
    if (typeof teto !== "number")
      morre(
        `contrato ${escopo.contract} nao declara \`properties.${campo}.maxLength\``,
      );
    tetos[campo] = teto;
  }
  return tetos;
}

function normalize(p) {
  if (typeof p !== "string") return "";
  return p.replace(/\\/g, "/");
}

function inScope(filePath) {
  const norm = normalize(filePath);
  if (!norm) return null;
  for (const pat of SCOPE_PATTERNS) {
    if (norm.includes(pat)) return pat.split("/").pop();
  }
  return null;
}

function countLines(s) {
  if (typeof s !== "string" || s.length === 0) return 0;
  return s.split("\n").length;
}

function measure(s, unit) {
  return unit === "chars" ? String(s || "").length : countLines(s);
}

function computeDelta(toolName, toolInput, unit) {
  if (toolName === "Write") return measure(toolInput.content || "", unit);
  if (toolName === "Edit") {
    const before = measure(toolInput.old_string || "", unit);
    const after = measure(toolInput.new_string || "", unit);
    return Math.max(0, after - before);
  }
  if (toolName === "MultiEdit") {
    let total = 0;
    for (const e of toolInput.edits || []) {
      const o = measure(e.old_string || "", unit);
      const n = measure(e.new_string || "", unit);
      total += Math.max(0, n - o);
    }
    return total;
  }
  return 0;
}

function measureNeighborhood(fileContent, scopeKey, unit) {
  const pattern = ENTRY_PATTERNS[scopeKey] || /^### /;
  const lines = fileContent.split("\n");
  const entryStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) entryStarts.push(i);
  }
  if (entryStarts.length < 2) return null;
  const tail = entryStarts.slice(-NEIGHBORHOOD_SIZE - 1);
  const sizes = [];
  for (let i = 0; i < tail.length - 1; i++) {
    const span = lines.slice(tail[i], tail[i + 1]);
    sizes.push(unit === "chars" ? span.join("\n").length : span.length);
  }
  if (sizes.length === 0) return null;
  sizes.sort((a, b) => a - b);
  return { median: sizes[Math.floor(sizes.length / 2)], sampleCount: sizes.length };
}

// ───────────────────────────────────────────────────────────────── ramo de REGISTRO

/** Arquivo dentro de um escopo de registro. `_*.json` e derivado, nunca escrito a mao. */
function escopoDeRegistro(filePath) {
  const norm = normalize(filePath);
  if (!norm.endsWith(".json")) return null;
  if (path.basename(norm).startsWith("_")) return null;
  return RECORD_SCOPES.find((s) => norm.includes(s.dir)) || null;
}

/** Uma substituicao de Edit/MultiEdit, aplicada em memoria. */
function aplicarEdicao(texto, e) {
  const velho = String((e && e.old_string) || "");
  const novo = String((e && e.new_string) || "");
  if (velho === "") return texto;
  if (e && e.replace_all) return texto.split(velho).join(novo);
  const i = texto.indexOf(velho);
  return i < 0 ? texto : texto.slice(0, i) + novo + texto.slice(i + velho.length);
}

/**
 * O conteudo que o registro TERIA depois desta chamada.
 *
 * Edit e MultiEdit chegam como fragmento, e fragmento de JSON nao parseia -- entao a base e
 * o arquivo do disco e a edicao e aplicada em memoria. Write nao le disco nenhum: registro
 * novo e o caso NORMAL, e exigir arquivo pre-existente faria o gate calar justamente onde o
 * corpo nasce.
 */
function conteudoResultante(toolName, toolInput, absPath) {
  if (toolName === "Write") return String(toolInput.content || "");
  let base;
  try {
    base = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  if (toolName === "Edit") return aplicarEdicao(base, toolInput);
  if (toolName === "MultiEdit") {
    let texto = base;
    for (const e of toolInput.edits || []) texto = aplicarEdicao(texto, e);
    return texto;
  }
  return null;
}

/**
 * Campos de prosa acima do teto. `null` = nao ha o que medir (JSON invalido, objeto que nao
 * e registro) e o hook segue fail-open: quem RECUSA forma e o gate de forma, nunca este.
 */
function medirRegistro(texto, escopo) {
  let registro;
  try {
    registro = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!registro || typeof registro !== "object" || Array.isArray(registro))
    return null;
  const tetos = tetosDoContrato(escopo);
  const excessos = [];
  for (const campo of escopo.campos) {
    const valor = typeof registro[campo] === "string" ? registro[campo] : "";
    const medido = measure(valor, escopo.unit);
    if (medido > tetos[campo]) excessos.push({ campo, medido, teto: tetos[campo] });
  }
  return { id: registro.id || null, tipo: registro.tipo || null, excessos };
}

function mensagemDeRegistro(medida, filePath, escopo) {
  const linhas = [
    "LEAN-ENTRY-CHECK violation:",
    `  registro: ${medida.id || path.basename(normalize(filePath))}`,
    `  tipo: ${medida.tipo || "(ausente)"}`,
  ];
  for (const x of medida.excessos)
    linhas.push(`  ${x.campo}: ${x.medido} ${escopo.unit} (teto do tipo: ${x.teto})`);
  linhas.push(
    "",
    `O teto vem do contrato ${escopo.contract}, nao deste hook. Corpo acima do teto e`,
    "recusado tambem pelo gate de forma — este e o aviso barato, antes da escrita.",
    "",
    "Trim antes de re-submeter: um registro e uma entrada, nao um relatorio. O detalhamento",
    "vai para as notas do ciclo, com ponteiro no corpo.",
  );
  return linhas.join("\n");
}

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }

  try {
    const toolName = input.tool_name || "";
    const toolInput = input.tool_input || {};
    if (!["Edit", "Write", "MultiEdit"].includes(toolName)) process.exit(0);

    const filePath = toolInput.file_path || toolInput.path || "";
    const cwd = input.cwd || process.cwd();
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);

    if (ERRO_DA_DECLARACAO !== null) {
      // A unica edicao que passa com a declaracao quebrada e a da propria declaracao.
      if (path.resolve(absPath) === path.resolve(ROOT, ".vega", "declaracao.json"))
        process.exit(0);
      morre(ERRO_DA_DECLARACAO);
    }

    // Registro primeiro: e um arquivo so, medido contra o teto do tipo — nunca contra
    // vizinhanca, que dentro de um arquivo unico nao existe.
    const escopo = escopoDeRegistro(filePath);
    if (escopo) {
      const texto = conteudoResultante(toolName, toolInput, absPath);
      if (texto === null) process.exit(0);
      const medida = medirRegistro(texto, escopo);
      if (!medida || medida.excessos.length === 0) process.exit(0);
      process.stderr.write(mensagemDeRegistro(medida, filePath, escopo) + "\n");
      process.exit(2);
    }

    const scopeKey = inScope(filePath);
    if (!scopeKey) process.exit(0);

    const unit = UNIT_BY_SCOPE[scopeKey] || "lines";
    const delta = computeDelta(toolName, toolInput, unit);
    if (delta < MIN_DELTA_BY_UNIT[unit]) process.exit(0);

    let fileContent = "";
    try {
      fileContent = fs.readFileSync(absPath, "utf8");
    } catch {
      process.exit(0);
    }
    if (toolName === "Write" && fileContent.length === 0) process.exit(0);

    const neighborhood = measureNeighborhood(fileContent, scopeKey, unit);
    if (!neighborhood || neighborhood.sampleCount < 2) process.exit(0);
    if (!neighborhood.median) process.exit(0);

    const ratio = delta / neighborhood.median;
    if (ratio <= MAX_RATIO) process.exit(0);

    const msg = [
      "LEAN-ENTRY-CHECK violation:",
      `  arquivo: ${scopeKey}`,
      `  entry novo: ${delta} ${unit}`,
      `  vizinhanca mediana: ${neighborhood.median} ${unit} (${neighborhood.sampleCount} entries adjacentes)`,
      `  razao: ${ratio.toFixed(1)}x (limite: ${MAX_RATIO}x)`,
      "",
      "Regra: peso de entry novo <= 2x vizinhanca.",
      "Format paridade: Regra + Validacao (2-3 linhas) + pointer pra memory/reporte.",
      "Cravamento defensivo (How to apply + Por que + Validacao detalhada) e anti-pattern.",
      "",
      "Trim antes de re-submeter.",
    ].join("\n");
    process.stderr.write(msg + "\n");
    process.exit(2);
  } catch {
    process.exit(0);
  }
});
