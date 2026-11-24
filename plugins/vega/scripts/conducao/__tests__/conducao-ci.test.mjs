/**
 * conducao-ci.test.mjs — leitura de CI da condução (VEGA-22 T14).
 *
 * `conducao.mjs ci` decide sobre runs e proposta que a maestra coleta pelo
 * `gh` — aqui em JSON de fixture, com `--agora` fixo: nenhum caso depende do
 * relógio da máquina. `conferir-workflows` roda sobre pastas temporárias de
 * workflow e sobre um repositório temporário. O mesmo verbo sobre o CI da Sistoli é
 * caso do lado da fonte (`.vega/__tests__/declaracao-da-fonte.test.mjs`, D-HN29-31): o
 * corpo passa fora dela.
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOTOES } from "../botoes.mjs";
import { comPassosDoRamo, decidirCi, gatilhoDePush } from "../conducao.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const PUSH = "2026-10-15T10:00:00.000Z";
const depois = (min) => new Date(Date.parse(PUSH) + min * 60_000).toISOString();
const PR_OK = { number: 502, state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", headRefOid: SHA };
const run = (extra) => ({ databaseId: 9001, headSha: SHA, status: "completed", conclusion: "success", createdAt: depois(1), workflowName: "CI", ...extra });

function cli(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status, saida: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null, erro: r.stderr };
}

// ── ci ──────────────────────────────────────────────────────────────────────

test("sem run depois do prazo do push emite aviso com o estado de mesclagem da proposta", () => {
  const pr = { ...PR_OK, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" };
  const r = cli(["ci", "--push-em", PUSH, "--agora", depois(BOTOES.prazoRunCiMin + 1), "--runs", "[]", "--pr", JSON.stringify(pr), "--sha", SHA]);
  assert.equal(r.status, 0, r.erro);
  assert.equal(r.saida.acao, "avisar");
  assert.equal(r.saida.veredito, "sem-run");
  assert.deepEqual(r.saida.mesclagem, { proposta: 502, state: "OPEN", mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", headRefOid: SHA });
  assert.match(r.saida.aviso, /CONFLICTING/);
  assert.match(r.saida.aviso, /não gera run/);
  assert.equal(r.saida.minutosDesdePush, BOTOES.prazoRunCiMin + 1);
});

test("sem run de proposta mesclavel tambem avisa, com o estado lido", () => {
  const r = decidirCi({ pushEm: PUSH, agora: depois(BOTOES.prazoRunCiMin), runs: [], pr: PR_OK });
  assert.equal(r.acao, "avisar");
  assert.equal(r.veredito, "sem-run");
  assert.match(r.aviso, /mergeable=MERGEABLE, mergeStateStatus=BLOCKED/);
});

test("sem run dentro do prazo espera ate o prazo", () => {
  const r = decidirCi({ pushEm: PUSH, agora: depois(BOTOES.prazoRunCiMin - 1), runs: [], pr: PR_OK });
  assert.equal(r.acao, "esperar");
  assert.equal(r.motivo, "run-nao-nasceu");
  assert.equal(r.ate, depois(BOTOES.prazoRunCiMin));
});

test("run de outro sha ou anterior ao push nao conta como run do push", () => {
  const runs = [run({ headSha: "ffffffffffffffffffffffffffffffffffffffff" }), run({ createdAt: depois(-30) })];
  const r = decidirCi({ pushEm: PUSH, agora: depois(60), runs, pr: PR_OK });
  assert.equal(r.acao, "avisar");
  assert.equal(r.veredito, "sem-run");
});

test("run em curso espera", () => {
  const r = decidirCi({ pushEm: PUSH, agora: depois(5), runs: [run({ status: "in_progress", conclusion: null })], pr: PR_OK });
  assert.equal(r.acao, "esperar");
  assert.equal(r.motivo, "run-em-curso");
  assert.deepEqual(r.runs, [9001]);
});

test("run terminado manda ler por dentro, porque conclusion nao e veredito", () => {
  const r = decidirCi({ pushEm: PUSH, agora: depois(20), runs: [run({})], pr: PR_OK });
  assert.equal(r.acao, "ler-run");
  assert.deepEqual(r.runs, [{ id: 9001, workflow: "CI", conclusion: "success" }]);
  assert.deepEqual(r.lerPorDentro, ["gh run view 9001 --log"]);
  assert.match(r.aviso, /desfecho \| nome/);
});

test("proposta que nao aponta para o sha empurrado avisa desalinhada", () => {
  const r = decidirCi({ pushEm: PUSH, agora: depois(20), runs: [run({})], pr: { ...PR_OK, headRefOid: "0".repeat(40) }, sha: SHA });
  assert.equal(r.acao, "avisar");
  assert.equal(r.veredito, "proposta-desalinhada");
});

test("ci sem --pr sai 2 e push-em invalido sai 1", () => {
  assert.equal(cli(["ci", "--push-em", PUSH]).status, 2);
  assert.equal(cli(["ci", "--push-em", "ontem", "--pr", JSON.stringify(PR_OK)]).status, 1);
});

// ── conferir-workflows ──────────────────────────────────────────────────────

function repoDeWorkflows(arquivos) {
  const dir = pastaTemporaria("conducao-ci-");
  mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  for (const [nome, texto] of Object.entries(arquivos)) writeFileSync(path.join(dir, ".github", "workflows", nome), texto);
  return dir;
}

const SO_MAIN = ["on:", "  pull_request:", "    branches: [main]", "  push:", "    branches:", "      - main", "jobs:", "  a:", "    env:", "      T: ${{ secrets.TOKEN }}", ""].join("\n");

test("conferir-workflows sai 1 com push fora de main que le secrets", () => {
  const dir = repoDeWorkflows({
    "ci.yml": SO_MAIN,
    "ramo.yml": ["on:", "  push:", "    branches: [\"ciclo-*\"]", "jobs:", "  a:", "    env:", "      T: ${{ secrets.TOKEN }}", ""].join("\n"),
  });
  try {
    const r = cli(["conferir-workflows", "--repo", dir]);
    assert.equal(r.status, 1);
    assert.equal(r.saida.ok, false);
    assert.deepEqual(r.saida.violacoes, [{ arquivo: ".github/workflows/ramo.yml", branches: ["ciclo-*"], linhasSecrets: [7] }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("conferir-workflows sai 0 com push so em main, push fora de main sem secrets e secrets em comentario", () => {
  const dir = repoDeWorkflows({
    "ci.yml": SO_MAIN,
    "prova.yml": ["on:", "  push:", "    branches: [ciclo-X]", "  # le secrets.env.bak so em comentario", "jobs: {}", ""].join("\n"),
  });
  try {
    const r = cli(["conferir-workflows", "--repo", dir]);
    assert.equal(r.status, 0, JSON.stringify(r.saida));
    assert.equal(r.saida.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gatilho push inline, com tags ou branches-ignore conta como fora de main", () => {
  assert.equal(gatilhoDePush("on: push\n").soMain, false);
  assert.equal(gatilhoDePush("on: [pull_request, push]\n").soMain, false);
  assert.equal(gatilhoDePush("on: [pull_request]\n"), null);
  assert.equal(gatilhoDePush("on:\n  push:\n    branches: [main]\n    tags: ['v*']\n").soMain, false);
  assert.equal(gatilhoDePush("on:\n  push:\n    branches-ignore: [main]\n").soMain, false);
  assert.equal(gatilhoDePush("on:\n  push:\n").soMain, false);
  assert.equal(gatilhoDePush("on:\n  push:\n    branches: [main]\n    paths: ['x/**']\n").soMain, true);
});

test("conferir-workflows sai 0 sobre um repositorio com ci.yml de gatilho so main", () => {
  const dir = repoDeWorkflows({ "ci.yml": SO_MAIN });
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    const r = cli(["conferir-workflows", "--repo", dir]);
    assert.equal(r.status, 0, JSON.stringify(r.saida?.violacoes));
    assert.ok(r.saida.conferidos.some((c) => c.arquivo === ".github/workflows/ci.yml" && c.push === "main"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── os passos do ramo no fechamento (VEGA-37 T9) ────────────────────────────

const HEAD = "f00dfeed00112233445566778899aabbccddeeff";
const esperarCi = { acao: "esperar", nonce: "x", ciclo: "TESTE-9", head: HEAD, plano: "b", motivo: "ci-pendente", fase: "F1", faseSeguinte: "F2", task: "T3", ci: null };
const ramo = (noOrigin) => ({ nome: "ciclo-TESTE-9", noOrigin });

test("o fechamento emite empurrar-ramo, inscrever-na-proposta e o ci, nesta ordem", () => {
  const a = comPassosDoRamo(esperarCi, { ramo: ramo(null), temCi: true, entrada: { proposta: { numero: 77, state: "OPEN" } } });
  assert.equal(a.acao, "empurrar-ramo");
  assert.equal(a.sha, HEAD);
  assert.equal(a.ramo, "ciclo-TESTE-9");
  assert.equal(a.depois, "esperar");
  assert.match(a.nonce, /^[0-9a-f]{16}$/);
  const b = comPassosDoRamo(esperarCi, { ramo: ramo(HEAD), temCi: true, entrada: { proposta: { numero: 77, state: "OPEN" } } });
  assert.equal(b.acao, "inscrever-na-proposta");
  assert.equal(b.ferramenta, "subscribe_pr_activity");
  assert.equal(b.proposta, 77);
  assert.equal(b.depois, "ci");
  const c = comPassosDoRamo(esperarCi, { ramo: ramo(HEAD), temCi: true, entrada: { inscrita: true } });
  assert.equal(c.acao, "esperar");
  assert.equal(c.motivo, "ci-pendente");
  assert.equal(c.passo, "ci");
  // Ponta antiga no origin: o HEAD ainda não subiu, volta ao primeiro passo.
  assert.equal(comPassosDoRamo(esperarCi, { ramo: ramo("0".repeat(40)), temCi: true, entrada: { inscrita: true } }).acao, "empurrar-ramo");
});

test("CI com veredito no HEAD, ação fora do fechamento ou árvore sem origin passam como vieram", () => {
  const encerrar = { ...esperarCi, acao: "encerrar-sessao", motivo: undefined };
  assert.equal(comPassosDoRamo(encerrar, { ramo: ramo(null), temCi: true }), encerrar);
  const abrir = { acao: "abrir", ciclo: "TESTE-9", head: HEAD, fase: "F1" };
  assert.equal(comPassosDoRamo(abrir, { ramo: ramo(null), temCi: true }), abrir);
  assert.equal(comPassosDoRamo(esperarCi, { ramo: null, temCi: true }), esperarCi);
});

test("projeto sem CI empurra com os pulos registrados e depois encerra sem inscrição", () => {
  const encerrar = { ...esperarCi, acao: "encerrar-sessao", motivo: undefined };
  const a = comPassosDoRamo(encerrar, { ramo: ramo(null), temCi: false });
  assert.equal(a.acao, "empurrar-ramo");
  assert.deepEqual(a.pulos, [
    { passo: "inscrever-na-proposta", motivo: "projeto-sem-proposta" },
    { passo: "ci", motivo: "projeto-sem-ci" },
  ]);
  assert.equal(a.motivo, "pulou:inscrever-na-proposta+ci");
  assert.equal(comPassosDoRamo(encerrar, { ramo: ramo(HEAD), temCi: false }), encerrar);
  const fecharCiclo = { acao: "fechar-ciclo", ciclo: "TESTE-9", head: HEAD, fase: "ciclo" };
  assert.equal(comPassosDoRamo(fecharCiclo, { ramo: ramo(null), temCi: false }).acao, "empurrar-ramo");
});
