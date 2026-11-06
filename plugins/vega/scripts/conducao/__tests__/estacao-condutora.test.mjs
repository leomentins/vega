/**
 * estacao-condutora.test.mjs — a estação `condutora` e o nome antigo `maestra`
 * (VEGA-26 T40, D-VEGA26-21).
 *
 * `maestra` segue lido como `condutora`: a mesma ação (`fazer-condutora`), o
 * plano congelado com o nome antigo e relido com o novo sem `plano-mudou`, e o
 * commit de conferência antigo, com `Conducao-Executor: maestra`, conferido.
 * A data do `plan-check` (erro a partir de 2026-11-05, aviso antes) mora em
 * `.claude/scripts/__tests__/planning-pipeline-check.test.mjs`: o núcleo não
 * importa script do projeto (D-VEGA26-15), e a Verificação da T40 roda os dois.
 *
 * Repos git temporários com hooks desligados (core.hooksPath=/dev/null), o
 * script chamado como CLI, como em `conducao-proximo.test.mjs`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerPlano, normalizarEstacao } from "../ler-plano.mjs";
import { politicaDaConferencia } from "../verbos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-40-condutora";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

function task(id, { estacao = "servidor", inputs = "`README.md`" } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE40-1]",
    `- **Inputs:** ${inputs}`,
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    `- **Estação:** ${estacao}`,
    "- **Steps:** faz",
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

/** Plano de uma fase: T1 na estação dada, T2 de servidor que depende dela. */
function canonico(estacao) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-10-15",
    "---",
    "",
    "## 1. Goal",
    "",
    "### 1.5 Modo de Execução",
    "",
    "**Largura do ciclo:** 1",
    "",
    "## 3. Tasks",
    "",
    "### F1 — fase F1 (**Modelo:** sonnet)",
    "",
    task("T1", { estacao }),
    task("T2", { inputs: "T1" }),
    "## 4. Pronto",
    "",
  ].join("\n");
}

function novoRepo(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "conducao-condutora-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "ciclo-teste");
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
  const escrever = (texto, msg = "plano") => {
    mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
    writeFileSync(path.join(dir, CAMINHO), texto);
    g("add", CAMINHO);
    g("commit", "-q", "-m", msg);
  };
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  const autorizar = (fase) => vazio(`Conducao: ${fase} autorizada`, "sim do Rita, no turno dele", `Conducao-Plano: ${g("rev-parse", `HEAD:${CAMINHO}`)}`);
  const rodar = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
    return { ...r, linhas: r.stdout.split("\n").filter(Boolean) };
  };
  const proximo = () => {
    const r = rodar("proximo");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.linhas.length, 1, r.stdout);
    return JSON.parse(r.linhas[0]);
  };
  return { dir, g, escrever, vazio, autorizar, rodar, proximo };
}

/** Commit de conferência de task feita por quem conduz, com o executor dado. */
const conferidaPor = (r, id, executor) =>
  r.vazio(
    `Conducao: ${id} conferida`,
    `Conducao-Task: ${id}\nConducao-Executor: ${executor}\nConducao-Sessao-Maestra: m\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica`,
  );

test("normalizarEstacao: maestra vira condutora; o resto passa igual", () => {
  assert.equal(normalizarEstacao("maestra"), "condutora");
  for (const v of ["condutora", "servidor", "workstation", null]) assert.equal(normalizarEstacao(v), v);
});

test("maestra e condutora leem-se a mesma estacao e a mesma classe no plano", () => {
  const [antigo, novo] = ["maestra", "condutora"].map((e) => lerPlano(canonico(e)).porId.get("T1"));
  assert.equal(antigo.estacao, "condutora");
  assert.equal(antigo.classe, "condutora");
  assert.deepEqual(antigo, novo);
});

test("maestra e condutora dao a mesma acao: fazer-condutora da T1", (t) => {
  const acoes = ["maestra", "condutora"].map((estacao) => {
    const r = novoRepo(t);
    r.escrever(canonico(estacao));
    r.autorizar("F1");
    return r.proximo();
  });
  for (const a of acoes) {
    assert.equal(a.acao, "fazer-condutora", JSON.stringify(a));
    assert.equal(a.task, "T1");
  }
});

test("plano congelado com maestra e relido com condutora nao sai plano-mudou", (t) => {
  const r = novoRepo(t);
  r.escrever(canonico("maestra"));
  r.autorizar("F1");
  r.escrever(canonico("condutora"), "plano: maestra vira condutora");
  const a = r.proximo();
  assert.notEqual(a.motivo, "plano-mudou", JSON.stringify(a));
  assert.equal(a.acao, "fazer-condutora", JSON.stringify(a));
  assert.equal(a.task, "T1");
});

test("a conferencia de task de estacao maestra grava Conducao-Executor: condutora", () => {
  const t = lerPlano(canonico("maestra")).porId.get("T1");
  const p = politicaDaConferencia({ task: "T1", t, verificacao: "verde", publicacao: "nao-se-aplica", maestra: true, sessao: "m1", approval: () => assert.fail("approval") });
  assert.equal(p.trailers["Conducao-Executor"], "condutora");
  assert.equal(p.saida.executor, "condutora");
  assert.equal(p.trailers["Conducao-Sessao-Maestra"], "m1");
});

test("commit antigo com Conducao-Executor: maestra segue conferido no proximo e no auditar", (t) => {
  for (const estacao of ["maestra", "condutora"]) {
    const r = novoRepo(t);
    r.escrever(canonico(estacao));
    r.autorizar("F1");
    conferidaPor(r, "T1", "maestra");
    const a = r.proximo();
    assert.equal(a.acao, "abrir", JSON.stringify(a));
    assert.deepEqual(a.tarefas.map((x) => x.task), ["T2"]);
    const au = r.rodar("auditar", "--ref", "refs/heads/ciclo-teste");
    const saida = au.linhas.map((l) => JSON.parse(l)).find((o) => o.acao === "auditar");
    assert.ok(saida, au.stdout + au.stderr);
    assert.deepEqual(saida.violacoes.filter((v) => v.task === "T1"), [], JSON.stringify(saida.violacoes));
  }
});

test("contraprova: conferencia de filha em task de estacao maestra segue acusada", (t) => {
  const r = novoRepo(t);
  r.escrever(canonico("maestra"));
  r.autorizar("F1");
  r.vazio(
    "Conducao: T1 conferida",
    "Conducao-Task: T1\nConducao-Sha-Filha: 0000000\nConducao-Sessao-Filha: s1\nConducao-Nonce: x\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica",
  );
  const au = r.rodar("auditar", "--ref", "refs/heads/ciclo-teste");
  const saida = au.linhas.map((l) => JSON.parse(l)).find((o) => o.acao === "auditar");
  assert.ok(saida.violacoes.some((v) => v.task === "T1" && v.regra === "maestra-sem-executor"), JSON.stringify(saida.violacoes));
});
