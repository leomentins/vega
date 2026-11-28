/**
 * dois-papeis.test.mjs — o motor sem o papel maestra (VEGA-37 T8).
 *
 * O `proximo` não tem mais nível: `--nivel maestra` (e qualquer `--nivel`) sai
 * 2 com o motivo do papel aposentado, sem decidir nada. A condutora que fecha
 * a fase com CI verde recebe, no `encerrar-sessao`, o `criar-condutora` da
 * fase seguinte — nome pela fase (D-VEGA37-2, D-VEGA37-18), `modelo` do
 * heading e o texto da próxima sessão como prompt —, sem nível acima. CI
 * vermelho ou pendente não cria. A marca `Conducao-Encerrada` segue a mesma
 * do modelo antigo: o laço pede o sim da fase seguinte sobre ela.
 *
 * Origin bare em pasta temporária (o verbo empurra a cópia do ciclo), hooks
 * desligados no repo de teste (core.hooksPath=/dev/null).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOTIVO_SEM_NIVEL, proximo } from "../conducao.mjs";
import { nomeDaCondutora, nomeDaOperaria } from "../regras.mjs";
import { ErroPlano } from "../ler-plano.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const FECHA = "[—] (fechamento-de-fase)";

function task(id, { inputs = "`README.md`", satisfies = "[AC-TESTE1-1]", fase = "F1" } = {}) {
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
  "opened: 2026-11-13",
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
  "### F1 — fase F1 (**Modelo:** sonnet)",
  "",
  task("T1"),
  task("T2", { inputs: "T1", satisfies: FECHA }),
  "### F2 — fase F2 (**Modelo:** opus)",
  "",
  task("T3", { inputs: "T2", fase: "F2" }),
  task("T4", { inputs: "T3", satisfies: FECHA, fase: "F2" }),
  "## 4. Pronto",
  "",
].join("\n");

/** Origin bare + árvore da condutora no ramo do ciclo, com a F1 conduzida até o fechamento conferido. */
function ambiente(t) {
  const raiz = pastaTemporaria("dois-papeis-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const dir = path.join(raiz, "condutora");
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  mkdirSync(dir);
  g("init", "-q", "-b", "ciclo-teste");
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]])
    g("config", k, v);
  g("remote", "add", "origin", origin);
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  writeFileSync(path.join(dir, CAMINHO), CANONICO);
  g("add", CAMINHO);
  g("commit", "-q", "-m", "plano");
  g("push", "-q", "origin", "ciclo-teste");
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  vazio("Conducao: F1 autorizada", "sim do Rita, no turno dele", `Conducao-Plano: ${g("rev-parse", `HEAD:${CAMINHO}`)}`);
  for (const id of ["T1", "T2"])
    vazio(
      `Conducao: ${id} conferida`,
      `Conducao-Task: ${id}\nConducao-Sha-Filha: 0000000\nConducao-Sessao-Filha: s\nConducao-Nonce: n-${id}\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica`,
    );
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  // Os passos do ramo no fechamento (VEGA-37 T9) já dados: o ramo no origin no HEAD e a
  // condutora inscrita na proposta — o que estes testes provam é o estado do CI depois deles.
  const proximoCli = (entrada) => {
    g("push", "-q", "origin", "HEAD:refs/heads/ciclo-teste");
    const r = cli("proximo", "--entrada", JSON.stringify({ inscrita: true, ...(entrada ?? {}) }));
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  const head = () => g("rev-parse", "HEAD");
  return { dir, g, cli, proximo: proximoCli, head };
}

test("proximo não aceita nível maestra", (t) => {
  const a = ambiente(t);
  const antes = a.head();
  for (const args of [["--nivel", "maestra"], ["--nivel", "condutora"], ["--nivel"]]) {
    const r = a.cli("proximo", ...args);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout.trim(), "", "recusa não decide: nada no stdout");
    assert.match(r.stderr, /papel maestra foi aposentado/);
  }
  // A função também recusa, antes de ler o git: nenhuma ação sai de um nível.
  assert.throws(
    () => proximo({ repo: a.dir, ciclo: CICLO, nivel: "maestra" }),
    (e) => e instanceof ErroPlano && e.codigo === "uso" && e.message === MOTIVO_SEM_NIVEL,
  );
  assert.equal(a.head(), antes, "a recusa não grava nada no ramo");
  // Sem a flag, o laço da condutora segue: a F1 fechada pede o CI.
  assert.equal(a.proximo().motivo, "ci-pendente");
});

test("fechamento verde encerra a fase e a criação da seguinte entra na ordem da troca", (t) => {
  const a = ambiente(t);
  const head = a.head();
  const e = a.proximo({ ci: { sha: head, veredito: "verde", run: 101 }, sessaoMaestra: "session_condutora_f1" });
  assert.equal(e.acao, "encerrar-sessao");
  assert.equal(e.fase, "F1");
  assert.equal(e.faseSeguinte, "F2");
  assert.equal(e.nivel, undefined, "sem nível acima");
  // VEGA-37 T16: o encerrar-sessao não cria mais a seguinte direto; a criação vem da ordem da troca
  // (nota, posse, época), na mesma condutora — passagem-ordem.test.mjs a percorre.
  assert.equal(e.criar, undefined);
  assert.equal(e.depois, "passar");
  assert.match(e.texto, new RegExp(`Conduzir ${CICLO} — F2`));
  assert.ok(!e.texto.includes("maestra"));
  // Mesmo estado, mesma ação (a condutora desduplica pelo nonce).
  assert.equal(a.proximo({ ci: { sha: head, veredito: "verde", run: 101 }, sessaoMaestra: "session_condutora_f1" }).nonce, e.nonce);

  // Encerrada a F1, a própria condutora passa: a nota da F1, com a F2 como seguinte — sem nível acima.
  assert.equal(a.cli("encerrar-sessao", "--fase", "F1", "--nonce", e.nonce).status, 0);
  const p = a.proximo();
  assert.equal(p.acao, "passar");
  assert.equal(p.fase, "F1");
  assert.equal(p.faseSeguinte, "F2");
  assert.equal(p.tentativa, 1);
});

test("fechamento vermelho ou sem veredito não cria condutora", (t) => {
  const a = ambiente(t);
  const head = a.head();
  const v = a.proximo({ ci: { sha: head, veredito: "vermelho", run: 9 } });
  assert.equal(v.acao, "perguntar");
  assert.equal(v.motivo, "ci-vermelho");
  assert.equal(v.criar, undefined);
  for (const entrada of [undefined, { ci: { sha: head, veredito: "em-curso", run: 9 } }, { ci: { sha: "0".repeat(40), veredito: "verde", run: 9 } }]) {
    const p = a.proximo(entrada);
    assert.equal(p.acao, "esperar", JSON.stringify(entrada));
    assert.equal(p.motivo, "ci-pendente");
    assert.equal(p.criar, undefined);
  }
});

test("nome da condutora segue a fase e o ordinal da herdeira", () => {
  assert.equal(nomeDaCondutora("C-1", "F1"), "C-1 · F1");
  assert.equal(nomeDaCondutora("C-1", "F3", 1), "C-1 · F3");
  assert.equal(nomeDaCondutora("C-1", "F3", 2), "C-1 · F3 · h2");
  assert.equal(nomeDaCondutora("C-1", "fechamento"), "C-1 · fechamento");
  assert.equal(nomeDaOperaria("C-1", "F3", "T39", 1), "C-1 · F3 · T39 · t1");
  assert.equal(nomeDaOperaria("C-1", "F3", "T39", 2), "C-1 · F3 · T39 · t2");
  assert.equal(nomeDaOperaria("C-1", null, "T39", 1), "C-1 · T39 · t1");
});
