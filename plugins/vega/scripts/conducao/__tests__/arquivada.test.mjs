/**
 * arquivada.test.mjs — a filha arquivada entra no `proximo` como `archived` e a
 * maestra não repete o arquivamento (débito
 * `ae-vega-29-conducao-portatil-arquivar-estado-archived`, ruling 23-a do
 * HN-29; texto na skill da condução §2).
 *
 * O caso é o da maestra que já executou o `arquivar` uma vez: a filha volta na
 * leitura seguinte com o estado que o `get_session` devolve, nas formas da API.
 * Nenhuma delas pode render outro `arquivar`; a contraprova é a mesma filha
 * ainda viva, que a rede arquiva.
 *
 * Hooks desligados no repo de teste (core.hooksPath=/dev/null).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

function task(id) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    "- **Steps:** faz",
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

const CANONICO = [
  "---",
  `cycle: ${CICLO}`,
  "opened: 2026-10-31",
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
  task("T1"),
  task("T2"),
  "## 4. Pronto",
  "",
].join("\n");

function novoRepo(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-arquivada-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const dir = path.join(raiz, "maestra");
  mkdirSync(dir);
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "ciclo-teste");
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]])
    g("config", k, v);
  g("remote", "add", "origin", origin);
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  writeFileSync(path.join(dir, CAMINHO), CANONICO);
  writeFileSync(path.join(dir, "README.md"), "fixture\n");
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  vazio("Conducao: F1 autorizada", "sim do operador, no turno dele", `Conducao-Plano: ${g("rev-parse", `HEAD:${CAMINHO}`)}`);
  // T1 aberta na tentativa 1 e conferida: a tentativa está decidida.
  const marcador = g("commit-tree", g("rev-parse", "HEAD^{tree}"), "-p", g("rev-parse", "HEAD"), "-m", "Conducao: abrir T1 tentativa 1 nonce nonceT1a");
  g("update-ref", `refs/conducao-local/${CICLO}/T1/1`, marcador);
  vazio("Conducao: T1 conferida", "Conducao-Task: T1\nConducao-Nonce: nonceT1a");
  const proximo = (entrada) => {
    const r = spawnSync(process.execPath, [SCRIPT, "proximo", "--entrada", JSON.stringify(entrada), "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  return { proximo };
}

const filha = (estado, arquivamentos = []) => ({
  sessao: "s1",
  task: "T1",
  tentativa: 1,
  nonce: "nonceT1a",
  estado,
  aviso: "T1-OK abcdef12 nonceT1a",
  arquivamentos,
});

test("filha arquivada entra como archived e o proximo nao pede arquivar de novo", (t) => {
  const r = novoRepo(t);
  // Primeira leitura: viva e decidida ⇒ a rede arquiva.
  const primeira = r.proximo({ filhas: [filha("idle")], tetoPonte: 1 });
  assert.equal(primeira.acao, "arquivar", JSON.stringify(primeira));
  // Leituras seguintes: a maestra já arquivou uma vez, e o get_session diz archived.
  for (const estado of ["archived", "ARCHIVED", "SESSION_STATUS_ARCHIVED", " Archived "]) {
    const p = r.proximo({ filhas: [filha(estado, [primeira.nonce])], tetoPonte: 1 });
    assert.notEqual(p.acao, "arquivar", `${estado}: ${JSON.stringify(p)}`);
    assert.notEqual(p.motivo, "falha-de-arquivamento", `${estado}: ${JSON.stringify(p)}`);
  }
});

test("contraprova: a mesma filha ainda viva segue arquivada pela rede", (t) => {
  const r = novoRepo(t);
  const p = r.proximo({ filhas: [filha("idle")], tetoPonte: 1 });
  assert.equal(p.acao, "arquivar", JSON.stringify(p));
  // Repetida duas vezes sem efeito, sobe como pergunta — nunca um terceiro arquivar.
  const q = r.proximo({ filhas: [filha("idle", [p.nonce, p.nonce])], tetoPonte: 1 });
  assert.equal(q.acao, "perguntar", JSON.stringify(q));
  assert.equal(q.motivo, "falha-de-arquivamento");
});
