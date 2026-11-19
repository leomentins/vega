/**
 * trazer-coberto-pelo-carimbo.test.mjs — o trazer não pergunta pelo que a
 * revisão aprovada da tentativa já cobriu (VEGA-19 T46, D-VEGA19-58,
 * AC-VEGA19-12): arquivo fora dos Outputs no alcance dos hooks ou nas
 * superfícies de instrução, e CI, `.vega/` e `.husky/` declarados, passam
 * como `coberto-pelo-carimbo` quando o carimbo é `APPROVED`, de revisor real,
 * e cobre a ponta. Registro de hook, guard e `*-mode`, instrução de sessão,
 * canonico, caminho clínico e task com publicação seguem perguntando.
 *
 * A cadeia pura é a do `trazer` (`decidirNoTrazer` → `registrosDoTrazer` com o
 * `contrato.md` real); o fim, o `trazer` de `git-conducao.mjs` num repositório
 * temporário com o carimbo gravado pela filha.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as c from "../consentimento.mjs";
import { decidirNoTrazer } from "../verbos.mjs";
import { caminhoDoContrato, trazer } from "../git-conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CONTRATO_REL = "../../../skills/conducao/references/contrato.md";
const CONTRATO = readFileSync(path.resolve(AQUI, CONTRATO_REL), "utf8");
const CANONICO = ".agents/ciclo/vega/X-1/canonico.md";
const ULTIMO = "a".repeat(40);
const PONTA = "b".repeat(40);
const CODIGO = {
  caminhosProtegidos: ["apps/app/src/labs/**"],
  telasProtegidasDosSteps: ["apps/app/src/labs/**"],
  foraDasTelasDosSteps: [],
  alcanceDosHooks: [],
};
// Os hooks alcançam todo caminho do harness; o app fica fora do alcance.
const alcance = (caminhos) => caminhos.filter((x) => !x.startsWith("apps/"));
const HOOK = ".claude/hooks/um-hook.js";
const FORA = ".claude/hooks/outro-hook.js";
const CONTRATO_NA_FONTE = ".claude/skills/vega/skills/conducao/references/contrato.md";
const COM_GIT = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: AQUI, encoding: "utf8" }).status === 0;
const REGRA = ".claude/rules/uma-regra.md";
const VEGA = ".vega/sistoli.mjs";
const CI = ".github/workflows/ci.yml";
const HUSKY = ".husky/pre-commit";
const INSTRUCAO = "CLAUDE.md";

const CANONICO_TEXTO = ["# X-1", "", "### 1.5 Modo de Execução", "", "## 3. Tasks", ""].join("\n");

/** O carimbo que cobre a ponta: o `sha:` é o último commit não-prosa da faixa. */
function carimbo(extra = {}) {
  return { sha: ULTIMO.slice(0, 8), reviewers: "code-reviewer, silent-failure-hunter", veredito: "APPROVED", ultimo: ULTIMO, ponta: PONTA, orfao: null, publicacao: false, caminho: "notes/reviews/aaaaaaaa.md", ...extra };
}

function decidir(caminhos, outputs, extra = {}) {
  return decidirNoTrazer({ caminhos, canonico: CANONICO, outputs, alcance, codigo: CODIGO, instrucoes: [INSTRUCAO], ...extra });
}

function registros(consentidos) {
  return c.registrosDoTrazer({ consentidos, canonico: CANONICO_TEXTO, contrato: CONTRATO, ciclo: "X-1", fase: "F3", task: "T46", quem: "operador", quando: "2026-11-18T00:00:00Z" });
}

const pelaRevisao = (d) => d.consentidos.filter((x) => x.caso === c.CASOS.cobertoPeloCarimbo).flatMap((x) => x.caminhos);
const perguntados = (d) => d.motivos.flatMap((m) => m.caminhos);

test("fora dos Outputs com carimbo APPROVED não pergunta e grava o consentimento", () => {
  const d = decidir([HOOK, FORA, REGRA], [HOOK], { carimbo: carimbo() });
  assert.deepEqual(d.motivos, []);
  assert.deepEqual(new Set(pelaRevisao(d)), new Set([FORA, REGRA]));
  const r = registros(d.consentidos);
  assert.equal(r.voltam.length, 0, JSON.stringify(r.voltam));
  const doCarimbo = r.registros.filter((x) => x.registro.caso === c.CASOS.cobertoPeloCarimbo);
  assert.ok(doCarimbo.length > 0, "o caso novo grava registro");
  for (const { registro, gate } of doCarimbo) {
    assert.equal(registro.sim, c.padraoDaFabrica(CONTRATO), "o texto exato do padrão da fábrica");
    assert.equal(registro.origem, c.ORIGEM_DO_PADRAO);
    assert.equal(gate({ corpo: registro.sim }).recusar, false);
  }
  assert.ok(c.padraoDaFabrica(CONTRATO).includes(`\`${c.CASOS.cobertoPeloCarimbo}\``), "o contrato nomeia o caso");
});

test("carimbo órfão cujo para é a ponta cobre como o carimbo do último commit", () => {
  const de = "c".repeat(40);
  for (const para of [ULTIMO, PONTA]) {
    const d = decidir([FORA], [HOOK], { carimbo: carimbo({ sha: de.slice(0, 8), orfao: { de, para } }) });
    assert.deepEqual(d.motivos, [], para);
    assert.deepEqual(pelaRevisao(d), [FORA]);
  }
  // órfão que aponta para outro commit não cobre
  const outro = decidir([FORA], [HOOK], { carimbo: carimbo({ sha: de.slice(0, 8), orfao: { de, para: "d".repeat(40) } }) });
  assert.deepEqual(perguntados(outro), [FORA]);
});

test("sem carimbo, carimbo leve, CHANGES_REQUESTED ou de outro sha perguntam como hoje", () => {
  const casos = {
    "sem carimbo": null,
    leve: carimbo({ reviewers: "gerado (blast-radius.mjs)" }),
    "reviewers vazio": carimbo({ reviewers: "" }),
    "reviewers lista vazia": carimbo({ reviewers: "[]" }),
    "CHANGES_REQUESTED": carimbo({ veredito: "CHANGES_REQUESTED" }),
    "aprovado com outra palavra": carimbo({ veredito: "pass-with-warnings" }),
    "outro sha": carimbo({ sha: "deadbeef" }),
  };
  for (const [nome, k] of Object.entries(casos)) {
    const d = decidir([HOOK, FORA, REGRA], [HOOK], { carimbo: k });
    assert.deepEqual(new Set(perguntados(d)), new Set([FORA, REGRA]), nome);
    assert.deepEqual(pelaRevisao(d), [], nome);
  }
});

test("CI, .vega e .husky declarados com carimbo passam; sem carimbo, CI e .husky perguntam", () => {
  const outputs = [CI, VEGA, HUSKY];
  const com = decidir(outputs, outputs, { carimbo: carimbo() });
  assert.deepEqual(com.motivos, []);
  assert.deepEqual(new Set(pelaRevisao(com)), new Set([CI, HUSKY]), ".vega declarado já passa pelo padrão");
  const sem = decidir(outputs, outputs);
  assert.deepEqual(new Set(perguntados(sem)), new Set([CI, HUSKY]));
});

test("registro de hook, canonico, instrução de sessão, guard e modo, caminho clínico e publicação perguntam mesmo com carimbo", () => {
  const sempre = [
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".claude/hooks/hooks.json",
    ".codex/hooks/registro.json",
    ".claude/hooks/um-guard.js",
    ".claude/hooks/publicacao-gate.js",
    ".claude/hooks/lib/modo-do-guarda.js",
    ".claude/state/guard-mode-registry.json",
    ".claude/state/vigia-de-fora-mode",
    ".vega/algum-mode",
    INSTRUCAO,
  ];
  // O corpo de guard DECLARADO já passava pelo padrão (quem conduz confere o diff); o carimbo nunca o cobre fora dos Outputs.
  const corpoDeGuard = new Set([".claude/hooks/um-guard.js", ".claude/hooks/publicacao-gate.js"]);
  for (const x of sempre) {
    for (const outputs of [[HOOK], [HOOK, x]]) {
      const d = decidir([x], outputs, { carimbo: carimbo() });
      if (!(corpoDeGuard.has(x) && outputs.includes(x))) assert.deepEqual([...new Set(perguntados(d))], [x], `${x} com outputs ${JSON.stringify(outputs)}`);
      assert.deepEqual(pelaRevisao(d), [], x);
    }
  }
  const comCanonico = decidir([CANONICO], [HOOK], { carimbo: carimbo() });
  assert.deepEqual(comCanonico.motivos.map((m) => m.motivo), ["canonico-do-ciclo"]);
  const clinico = "apps/app/src/labs/laudo/acao.ts";
  const comClinico = decidir([clinico], [HOOK], { carimbo: carimbo() });
  assert.deepEqual(comClinico.motivos.map((m) => m.motivo), ["caminho-clinico-fora-dos-outputs"]);
  const comPublicacao = decidir([FORA], [HOOK], { carimbo: carimbo({ publicacao: true }) });
  assert.deepEqual(perguntados(comPublicacao), [FORA]);
});

test("guard com o papel no meio do nome e a lib da publicação perguntam fora dos Outputs mesmo com carimbo", () => {
  for (const x of [".claude/hooks/gap3-sql-guard-dml-extension.js", ".claude/hooks/frontmatter-guard-serena.js", ".claude/hooks/lib/publicacao-liberacao-ciclo.mjs"]) {
    const d = decidir([x], [HOOK], { carimbo: carimbo() });
    assert.deepEqual([...new Set(perguntados(d))], [x], x);
    assert.deepEqual(pelaRevisao(d), [], x);
  }
  // O vizinho que não é guard segue coberto pelo carimbo.
  assert.deepEqual(pelaRevisao(decidir([".claude/hooks/guarda-chuva.js"], [HOOK], { carimbo: carimbo() })), [".claude/hooks/guarda-chuva.js"]);
});

// D-VEGA19-61 (T48): em `.claude/state/`, só a configuração dos guards segue perguntando com carimbo.
test("operadores declarado passa com carimbo", () => {
  const OPERADORES = ".claude/state/operators.json";
  const com = decidir([OPERADORES], [OPERADORES], { carimbo: carimbo() });
  assert.deepEqual(com.motivos, []);
  assert.deepEqual(pelaRevisao(com), [OPERADORES]);
  const r = registros(com.consentidos);
  assert.equal(r.voltam.length, 0, JSON.stringify(r.voltam));
  assert.ok(r.registros.some((x) => x.registro.caso === c.CASOS.cobertoPeloCarimbo), "grava coberto-pelo-carimbo");
  const sem = decidir([OPERADORES], [OPERADORES]);
  assert.deepEqual(perguntados(sem), [OPERADORES]);
  assert.deepEqual(pelaRevisao(sem), []);
  const configuracaoDosGuards = [
    ".claude/state/guard-mode-registry.json",
    ".claude/state/scratch-path-guard-mode",
    ".claude/state/context-frontier-advisory-threshold",
    ".claude/state/git-guard-allow.example",
    ".claude/state/memory-shard-schema.json",
  ];
  assert.ok(configuracaoDosGuards.length > 0);
  for (const x of configuracaoDosGuards) {
    for (const outputs of [[HOOK], [x]]) {
      const d = decidir([x], outputs, { carimbo: carimbo() });
      assert.deepEqual([...new Set(perguntados(d))], [x], `${x} com outputs ${JSON.stringify(outputs)}`);
      assert.deepEqual(pelaRevisao(d), [], x);
    }
  }
});

// ── o trazer de verdade: o carimbo que a filha grava na ponta ───────────────

const CICLO_GIT = "TESTE-46-conducao";
const CAMINHO_GIT = `.agents/ciclo/teste/${CICLO_GIT}/canonico.md`;
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");

function canonicoGit() {
  return [
    "---",
    `cycle: ${CICLO_GIT}`,
    "opened: 2026-11-18",
    "---",
    "",
    "## 1. Goal",
    "",
    "### 1.5 Modo de Execução",
    "",
    "**Largura do ciclo:** 3",
    "",
    "## 3. Tasks",
    "",
    "### F1 — fase F1 (**Modelo:** sonnet)",
    "",
    "#### T1 — tarefa T1",
    "",
    "- **Objetivo:** tarefa T1",
    "- **satisfies:** [AC-TESTE1-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** \`${HOOK}\` (create)`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    "- **Steps:** faz",
    "- **Verificação:** `echo verificacao-T1`.",
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO_GIT}-F1/T1 — tarefa T1\``,
    "",
    "## 4. Pronto",
    "",
  ].join("\n");
}

/** Origin bare + árvore da maestra no ramo do ciclo, com o contrato real no lugar dele, + clone da filha. */
function ambienteGit(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "trazer-coberto-pelo-carimbo-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const em = (dir) => (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const configurar = (g) => {
    g("config", "core.hooksPath", "/dev/null");
    g("config", "user.name", "teste");
    g("config", "user.email", "teste@example.invalid");
    g("config", "commit.gpgsign", "false");
  };
  const escrever = (dir, arquivos) => {
    for (const [p, conteudo] of Object.entries(arquivos)) {
      mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
      writeFileSync(path.join(dir, p), conteudo);
    }
  };
  // No corpo instalado sem `.git` (seed dir, D-VEGA19-38) o caminho do contrato é null por desenho e o
  // trazer pergunta (fail-closed, D-VEGA19-29); dentro de um repositório git o caminho tem de sair.
  // O fixture grava o contrato no caminho da fonte quando o plugin não tem raiz.
  const achado = caminhoDoContrato();
  if (COM_GIT) assert.ok(achado, "o contrato da condução tem caminho no repositório");
  else assert.equal(achado, null, "fora de um repositório git o contrato não tem caminho");
  const contrato = achado ?? CONTRATO_NA_FONTE;
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const maestra = path.join(raiz, "maestra");
  mkdirSync(maestra);
  const g = em(maestra);
  g("init", "-q", "-b", "ciclo-teste");
  configurar(g);
  g("remote", "add", "origin", origin);
  escrever(maestra, { "README.md": "fixture\n", [CAMINHO_GIT]: canonicoGit(), [contrato]: CONTRATO });
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  g("push", "-q", "origin", "ciclo-teste");
  const filha = path.join(raiz, "filha");
  execFileSync("git", ["clone", "-q", origin, filha]);
  const f = em(filha);
  configurar(f);
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", maestra, "--ciclo", CICLO_GIT], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    const linhas = r.stdout.split("\n").filter(Boolean);
    return { status: r.status, stderr: r.stderr, saida: linhas.length === 1 ? JSON.parse(linhas[0]) : null, linhas };
  };
  /** A filha toca o Output e um hook fora dele; com `veredito`, grava o carimbo do commit de código. */
  const filhaTrabalha = ({ veredito = null } = {}) => {
    const ref = `refs/conducao/${CICLO_GIT}/T1/1`;
    f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
    f("checkout", "-q", "--detach", "refs/remotes/tentativa");
    escrever(filha, { [HOOK]: "export const um = 1;\n", [FORA]: "export const outro = 2;\n" });
    f("add", "-A");
    f("commit", "-q", "-m", `${CICLO_GIT}-F1/T1 — trabalho`);
    const sha = f("rev-parse", "HEAD");
    if (veredito) {
      escrever(filha, { [`.agents/ciclo/teste/${CICLO_GIT}/revisoes/${sha.slice(0, 8)}.md`]: `sha: ${sha}\nreviewers: code-reviewer\nveredito: ${veredito}\n` });
      f("add", "-A");
      f("commit", "-q", "-m", "carimbo");
    }
    f("push", "-q", "origin", `HEAD:${ref}`);
  };
  const abrir = () => {
    assert.equal(cli("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1", "--pergunta", "p-00000000000000a1").status, 0);
    const aberta = cli("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT46", "--modo-maestra", "auto");
    assert.equal(aberta.status, 0, aberta.stderr + aberta.linhas.join("\n"));
  };
  return { maestra, g, abrir, filhaTrabalha };
}

test("o trazer lê o carimbo APPROVED da ponta e grava o consentimento sem pergunta", (t) => {
  const a = ambienteGit(t);
  a.abrir();
  a.filhaTrabalha({ veredito: "APPROVED" });
  const s = trazer({ repo: a.maestra, ciclo: CICLO_GIT, task: "T1", tentativa: 1 });
  if (!COM_GIT) {
    // Sem caminho do contrato não há padrão da fábrica: o carimbo aprovado não basta e o trazer pergunta.
    assert.equal(s.acao, "perguntar", JSON.stringify(s));
    assert.equal(c.lerConsentimentos(a.maestra, { ciclo: CICLO_GIT }).filter((l) => l.caso === c.CASOS.cobertoPeloCarimbo).length, 0);
    return;
  }
  assert.notEqual(s.acao, "perguntar", JSON.stringify(s));
  assert.equal(a.g("show", `HEAD:${FORA}`), "export const outro = 2;");
  const lidos = c.lerConsentimentos(a.maestra, { ciclo: CICLO_GIT });
  const doCarimbo = lidos.filter((l) => l.caso === c.CASOS.cobertoPeloCarimbo);
  assert.equal(doCarimbo.length, 1, JSON.stringify(lidos.map((l) => [l.caso, l.caminhos])));
  assert.deepEqual(doCarimbo[0].caminhos, [FORA]);
  assert.equal(doCarimbo[0].sim, c.padraoDaFabrica(CONTRATO));
});

test("o trazer sem carimbo, ou com carimbo que não aprova, pergunta pelo fora dos Outputs", (t) => {
  for (const veredito of [null, "CHANGES_REQUESTED"]) {
    const a = ambienteGit(t);
    a.abrir();
    a.filhaTrabalha({ veredito });
    const s = trazer({ repo: a.maestra, ciclo: CICLO_GIT, task: "T1", tentativa: 1 });
    assert.equal(s.acao, "perguntar", `${veredito}: ${JSON.stringify(s)}`);
    assert.ok(JSON.stringify(s).includes(FORA), `${veredito}: a pergunta cita o hook fora dos Outputs`);
    assert.equal(c.lerConsentimentos(a.maestra, { ciclo: CICLO_GIT }).filter((l) => l.caso === c.CASOS.cobertoPeloCarimbo).length, 0);
  }
});
