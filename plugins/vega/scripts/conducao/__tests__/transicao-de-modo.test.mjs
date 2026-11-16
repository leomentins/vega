/**
 * transicao-de-modo.test.mjs — um ciclo no meio do modelo de três papéis entra
 * no de dois na fronteira de fase, e os hooks aceitam os dois modos (VEGA-37
 * T11, AC-VEGA37-9, D-VEGA37-7, D-VEGA37-21, D-VEGA37-23).
 *
 * Fixture: as marcas do NEXS-27 (ramo `ciclo-NEXS-27-assinatura-icp-brasil`)
 * até a F1 encerrada, quando a condutora do modelo antigo parava esperando a
 * maestra criar a seguinte — só os subjects e os trailers, com os SHAs e o
 * blob do plano trocados pelos do repo de teste. O plano é sintético (três
 * fases, duas tasks cada).
 *
 * Origin bare em pasta temporária, hooks desligados no repo de teste
 * (core.hooksPath=/dev/null).
 *
 * O que carrega os hooks de janela da raiz da Sistoli mora em
 * `.claude/hooks/__tests__/janela-de-contexto-transicao.test.mjs` (D-VEGA37-28).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { faseAConduzir, retomar, textoDaProximaSessao, textoDoFechamento } from "../conducao.mjs";
import { lerMarcas } from "../marcas.mjs";
import { registrar } from "../log-eventos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const NONCE_GUARD = path.resolve(AQUI, "..", "..", "..", "hooks", "conducao-nonce-guard.js");
const require = createRequire(import.meta.url);
const sessaoOperaria = require("../../../hooks/lib/sessao-operaria.js");

const CICLO = "NEXS-27-assinatura-icp-brasil";
const CAMINHO = `.agents/ciclo/nexus/${CICLO}/canonico.md`;
const FECHA = "[—] (fechamento-de-fase)";

function task(id, fase, { inputs = "`README.md`", satisfies = "[AC-NEXS27-1]" } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    `- **satisfies:** ${satisfies}`,
    `- **Inputs:** ${inputs}`,
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    "- **Estação:** servidor",
    "- **Steps:** faz",
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

const CANONICO = [
  "---",
  `cycle: ${CICLO}`,
  "opened: 2026-11-01",
  "---",
  "",
  "## 1. Goal",
  "",
  "### 1.5 Modo de Execução",
  "",
  "**Largura do ciclo:** 2",
  "",
  "## 3. Tasks",
  "",
  "### F0 — fase F0 (**Modelo:** opus)",
  "",
  task("T1", "F0"),
  task("T2", "F0", { inputs: "T1", satisfies: FECHA }),
  "### F1 — fase F1 (**Modelo:** opus)",
  "",
  task("T3", "F1", { inputs: "T2" }),
  task("T4", "F1", { inputs: "T3", satisfies: FECHA }),
  "### F2 — fase F2 (**Modelo:** sonnet)",
  "",
  task("T5", "F2", { inputs: "T4" }),
  task("T6", "F2", { inputs: "T5", satisfies: FECHA }),
  "## 4. Pronto",
  "",
].join("\n");

/**
 * As marcas do NEXS-27, na ordem do ramo, até a F1 encerrada (ab147c30d). Os
 * valores entre chaves são trocados pelos do repo de teste: `{plano}` o blob
 * do canonico, `{simDoCiclo}` o sha da F0 autorizada com `Conducao-Ciclo: sim`.
 */
const MARCAS_NEXS27 = [
  ["Conducao: F0 autorizada", "Conducao-Plano: {plano}\nConducao-Ciclo: sim"],
  ...["T1", "T2"].map((t, i) => [
    `Conducao: ${t} conferida`,
    `Conducao-Task: ${t}\nConducao-Sha-Filha: ${"ca83fdbf".padEnd(40, String(i))}\nConducao-Sessao-Filha: session_01filha${t}\nConducao-Nonce: ec1d9b01c20b1b5${i}\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica`,
  ]),
  ["Conducao: F0 sessao encerrada", "Conducao-Encerrada: F0\nConducao-Nonce: 36b2d52dee6b5131"],
  // A herança que a maestra gravava pelo sim do ciclo (origem `ciclo`).
  ["Conducao: F1 autorizada", "Conducao-Plano: {plano}\nConducao-Herdada: {simDoCiclo}\nConducao-Origem: ciclo"],
  ...["T3", "T4"].map((t, i) => [
    `Conducao: ${t} conferida`,
    `Conducao-Task: ${t}\nConducao-Sha-Filha: ${"ca83fdbf".padEnd(40, String(i + 2))}\nConducao-Sessao-Filha: session_01filha${t}\nConducao-Nonce: ec1d9b01c20b1b6${i}\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica`,
  ]),
  ["Conducao: F1 sessao encerrada", "Conducao-Encerrada: F1\nConducao-Nonce: 1f30786e784e31ef"],
];

/** Origin bare + árvore do ciclo no ramo, com as marcas do NEXS-27 até a F1 encerrada. */
function ambiente(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "transicao-de-modo-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const dir = path.join(raiz, "ciclo");
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  mkdirSync(dir);
  g("init", "-q", "-b", `ciclo-${CICLO}`);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]])
    g("config", k, v);
  g("remote", "add", "origin", origin);
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  writeFileSync(path.join(dir, CAMINHO), CANONICO);
  g("add", CAMINHO);
  g("commit", "-q", "-m", "plano");
  const plano = g("rev-parse", `HEAD:${CAMINHO}`);
  let simDoCiclo = null;
  for (const [subject, corpo] of MARCAS_NEXS27) {
    g("commit", "-q", "--allow-empty", "-m", subject, "-m", corpo.replaceAll("{plano}", plano).replaceAll("{simDoCiclo}", simDoCiclo ?? ""));
    if (subject === "Conducao: F0 autorizada") simDoCiclo = g("rev-parse", "HEAD");
  }
  g("push", "-q", "origin", `HEAD:refs/heads/ciclo-${CICLO}`);
  g("push", "-q", "origin", `HEAD:refs/conducao/${CICLO}/copia`);
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  const proximo = (entrada = {}) => {
    const r = cli("proximo", "--entrada", JSON.stringify(entrada));
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  return { raiz, dir, g, cli, proximo, simDoCiclo };
}

test("ciclo com marcas da maestra segue na fase seguinte sem maestra", (t) => {
  const a = ambiente(t);
  const marcas = lerMarcas(a.dir);
  const heranca = marcas.find((m) => m.tipo === "autorizada" && m.fase === "F1");
  assert.equal(heranca.origem, "ciclo", "a herança gravada pela maestra fica legível");
  assert.equal(heranca.herdada, a.simDoCiclo);

  // A condutora nova retoma: a fase dela é a F2, sem maestra que a crie.
  const r = retomar({ repo: a.dir, ciclo: CICLO });
  assert.deepEqual(r.autorizadas, ["F0", "F1"]);
  assert.deepEqual(r.feitas, ["T1", "T2", "T3", "T4"]);
  assert.deepEqual(r.conduzir, { fase: "F2", situacao: "fase-seguinte", fonte: "plano", depoisDe: "F1" });
  assert.deepEqual(r.divergencias, []);

  // O `proximo` dela herda a F2 pelo sim do ciclo da F0, sem nível acima e sem pedir ao operador.
  const p = a.proximo();
  assert.equal(p.acao, "herdar-autorizacao", JSON.stringify(p));
  assert.equal(p.fase, "F2");
  assert.equal(p.origem, "ciclo");
  assert.equal(p.autorizacao, a.simDoCiclo);
  assert.equal(p.nivel, undefined);
  assert.doesNotMatch(JSON.stringify(p), /maestra/);
});

test("sem plano legível a fase seguinte sai pela ordem das marcas", () => {
  const m = (tipo, fase) => ({ tipo, fase, sha: "x" });
  const nexs = [m("autorizada", "F0"), m("encerrada", "F0"), m("autorizada", "F1"), m("encerrada", "F1")];
  assert.deepEqual(faseAConduzir(nexs, null), { fase: "F2", situacao: "fase-seguinte", fonte: "marcas", depoisDe: "F1" });
  // Fase autorizada e não encerrada: a condutora que caiu no meio dela é herdeira da mesma fase.
  assert.deepEqual(faseAConduzir(nexs.slice(0, 3), null), { fase: "F1", situacao: "fase-aberta", fonte: "marcas", depoisDe: "F0" });
  assert.deepEqual(faseAConduzir(nexs, ["F0", "F1"]), { fase: "fechamento", situacao: "fechamento", fonte: "plano", depoisDe: "F1" });
  assert.deepEqual(faseAConduzir([...nexs, m("encerrada", "ciclo")], null).situacao, "fechamento");
  assert.deepEqual(faseAConduzir([], ["F0", "F1"]), { fase: "F0", situacao: "sem-marca", fonte: "plano", depoisDe: null });
});

test("fase antes da primeira conduzida fica fora da condução", () => {
  // Plano com F0 feita à mão (sem marca): a condução começa na primeira fase com marca, como o `iPrimeira` de regras.mjs.
  const m = (tipo, fase) => ({ tipo, fase, sha: "x" });
  const plano = ["F0", "F1", "F2"];
  assert.deepEqual(faseAConduzir([m("autorizada", "F1"), m("encerrada", "F1")], plano), { fase: "F2", situacao: "fase-seguinte", fonte: "plano", depoisDe: "F1" });
  assert.deepEqual(faseAConduzir([m("autorizada", "F1")], plano), { fase: "F1", situacao: "fase-aberta", fonte: "plano", depoisDe: null });
});

test("o pedido de nascimento antigo e o novo dão o mesmo papel", () => {
  const repo = "/srv/arvore-do-ciclo";
  const conduzir = textoDaProximaSessao({ ciclo: CICLO, fase: "F2", repo: null, sessao: "session_x", anterior: "condutora anterior" });
  const conduzirAntigo = textoDaProximaSessao({ ciclo: CICLO, fase: "F2", repo: null, sessao: "session_x" });
  const fechamento = textoDoFechamento({ ciclo: CICLO, repo, sessao: "session_x", conduzidas: ["F0"], exigirEncerramentos: ["F0", "ciclo"], anterior: "condutora anterior", fechamento: "/close-cycle" });
  const fechamentoNeutro = textoDoFechamento({ ciclo: CICLO, repo, sessao: "session_x", conduzidas: ["F0"], exigirEncerramentos: ["F0", "ciclo"], fechamento: null });
  const brief = "## contrato da operária — T5 · nonce `0123456789abcdef`\n…";
  for (const [pedido, papel] of [
    [conduzir, "condutora"],
    [conduzirAntigo, "condutora"],
    [fechamento, "condutora"],
    [fechamentoNeutro, "condutora"],
    [brief, "operaria"],
    ["oi, me ajuda com um teste", "comum"],
    [null, "comum"],
  ]) {
    assert.equal(sessaoOperaria.papelDoPedido(pedido), papel, `plugin: ${pedido}`);
  }
  assert.equal(sessaoOperaria.CONDUTORA_RE.source, /^\s*Conduzir \S+ — F\d{1,2}, pela skill \S*conducao\/SKILL\.md/.source);
});

test("nonce emitido pelo motor de main é aceito pelo guard do ramo", (t) => {
  // Depois da mescla o motor de `main` é este; o guard de nonce que roda na árvore de um ciclo
  // antigo é o do ramo dele (D-VEGA37-21), e o nonce e o log v1 não mudaram de forma.
  const a = ambiente(t);
  const log = path.join(a.raiz, "log");
  const projeto = path.join(a.raiz, "projeto");
  mkdirSync(path.join(projeto, ".claude", "state"), { recursive: true });
  const p = a.proximo();
  assert.match(p.nonce, /^[0-9a-f]{16}$/);
  registrar(p, { procedencia: "intencao", pasta: log });
  const rodar = (tool_name, tool_input) =>
    spawnSync(process.execPath, [NONCE_GUARD], {
      input: JSON.stringify({ tool_name, tool_input }),
      encoding: "utf8",
      env: { ...process.env, ALTAIR_CONDUCAO_LOG_DIR: log, CLAUDE_PROJECT_DIR: projeto },
    });
  const ok = rodar("mcp__claude-code-remote__send_message", { session_id: "session_y", message: `F2 herdada · ${p.nonce}` });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stderr, "", "nonce certo passa calado");
  const errado = rodar("mcp__claude-code-remote__send_message", { session_id: "session_y", message: "F2 · 0123456789abcdef" });
  assert.match(errado.stderr, /nonce-diferente/, "a contraprova: nonce que o motor não emitiu diverge");
});
