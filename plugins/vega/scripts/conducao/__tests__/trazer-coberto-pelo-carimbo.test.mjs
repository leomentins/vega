/**
 * trazer-coberto-pelo-carimbo.test.mjs — o que a revisão aprovada cobria no
 * trazer (VEGA-19 T46, D-VEGA19-58) deixou de parar, com carimbo ou sem
 * (VEGA-20 T43, D-VEGA20-26): arquivo fora dos Outputs no alcance dos hooks
 * ou nas superfícies de instrução, CI, `.husky/`, registro de hook, guard,
 * `*-mode`, dependência e o canonico do ciclo são trazidos sem pergunta e vão
 * ao relato (`foraDosOutputs`, `canonicoAlterado`). Seguem parando, com
 * carimbo ou sem, o caminho clínico fora dos Outputs e o que define a parada
 * de publicação (`define-a-parada`), mesmo declarado.
 *
 * A cadeia pura é a do `trazer` (`decidirNoTrazer`); o fim, o `trazer` de
 * `git-conducao.mjs` num repositório temporário com o carimbo gravado pela filha.
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
  definemAParada: ["**/hooks/gate-de-publicacao.js", "**/liberacao-da-publicacao.mjs", "db/scripts/**"],
  caminhosProtegidos: ["apps/app/src/labs/**"],
  telasProtegidasDosSteps: ["apps/app/src/labs/**"],
  foraDasTelasDosSteps: [],
  alcanceDosHooks: [],
};
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
  return decidirNoTrazer({ caminhos, canonico: CANONICO, outputs, codigo: CODIGO, ...extra });
}

const perguntados = (d) => d.motivos.flatMap((m) => m.caminhos);
const doCarimbo = (d) => d.consentidos.filter((x) => x.caso === c.CASOS.cobertoPeloCarimbo);

test("fora dos Outputs com carimbo APPROVED não pergunta e grava o consentimento", () => {
  // D-VEGA20-26: com carimbo ou sem, o fora dos Outputs não pergunta; vai ao relato, sem caso a gravar.
  for (const extra of [{ carimbo: carimbo() }, {}]) {
    const d = decidir([HOOK, FORA, REGRA], [HOOK], extra);
    assert.deepEqual(d.motivos, []);
    assert.deepEqual(d.foraDosOutputs, [FORA, REGRA]);
    assert.deepEqual(doCarimbo(d), []);
  }
  // O caso `coberto-pelo-carimbo` segue existindo para quem já o gravou: o registro dele lê o padrão do contrato.
  const r = c.registrosDoTrazer({ consentidos: [{ caso: c.CASOS.cobertoPeloCarimbo, motivo: "alcance-dos-hooks", caminhos: [FORA] }], canonico: CANONICO_TEXTO, contrato: CONTRATO, ciclo: "X-1", fase: "F3", task: "T46", quem: "operador", quando: "2026-11-18T00:00:00Z" });
  assert.equal(r.voltam.length, 0, JSON.stringify(r.voltam));
  assert.equal(r.registros[0].registro.sim, c.padraoDaFabrica(CONTRATO), "o texto exato do padrão da fábrica");
  assert.equal(r.registros[0].registro.origem, c.ORIGEM_DO_PADRAO);
});

test("carimbo órfão cujo para é a ponta cobre como o carimbo do último commit", () => {
  // O trazer não lê mais o carimbo (D-VEGA20-26): órfão, de outro commit ou ausente dão o mesmo resultado.
  const de = "c".repeat(40);
  for (const para of [ULTIMO, PONTA, "d".repeat(40)]) {
    const d = decidir([FORA], [HOOK], { carimbo: carimbo({ sha: de.slice(0, 8), orfao: { de, para } }) });
    assert.deepEqual([d.motivos, d.foraDosOutputs], [[], [FORA]], para);
  }
});

test("sem carimbo, carimbo leve, CHANGES_REQUESTED ou de outro sha perguntam como hoje", () => {
  // D-VEGA20-26: o carimbo deixou de decidir o trazer; nenhum deles pergunta pelo hook ou pela regra.
  const casos = {
    "sem carimbo": null,
    leve: carimbo({ reviewers: "gerado (blast-radius.mjs)" }),
    "reviewers vazio": carimbo({ reviewers: "" }),
    "CHANGES_REQUESTED": carimbo({ veredito: "CHANGES_REQUESTED" }),
    "outro sha": carimbo({ sha: "deadbeef" }),
  };
  for (const [nome, k] of Object.entries(casos)) {
    const d = decidir([HOOK, FORA, REGRA], [HOOK], { carimbo: k });
    assert.deepEqual(perguntados(d), [], nome);
    assert.deepEqual(d.foraDosOutputs, [FORA, REGRA], nome);
  }
});

test("CI e .vega declarados com carimbo passam; .husky segue perguntando (D1a); sem carimbo, CI e .husky perguntam", () => {
  // D-VEGA20-26: CI e `.husky` declarados seguem sem pergunta; `.vega` declarado para, por definir a parada.
  const outputs = [CI, VEGA, HUSKY];
  for (const extra of [{ carimbo: carimbo() }, {}]) {
    const d = decidir(outputs, outputs, extra);
    assert.deepEqual(d.motivos, [{ motivo: "define-a-parada", caminhos: [VEGA] }]);
    assert.deepEqual(d.foraDosOutputs, []);
  }
});

test("registro de hook, guard e modo, dependência, caminho clínico e publicação perguntam mesmo com carimbo", () => {
  // D-VEGA20-26: registro de hook, guard, modo, estado e dependência deixam de parar, dentro ou fora dos Outputs.
  const seguem = [
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".claude/hooks/hooks.json",
    ".codex/hooks/registro.json",
    ".claude/hooks/um-guard.js",
    ".claude/hooks/lib/modo-do-guarda.js",
    ".claude/state/guard-mode-registry.json",
    ".claude/state/vigia-de-fora-mode",
    "package.json",
    "apps/app/package.json",
    "pnpm-lock.yaml",
    ".npmrc",
    ".mcp.json",
    HUSKY,
    ".claude/scripts/review-carimbo-ci.mjs",
  ];
  for (const x of seguem)
    for (const outputs of [[HOOK], [HOOK, x]]) {
      const d = decidir([x], outputs, { carimbo: carimbo() });
      assert.deepEqual(d.motivos, [], `${x} com outputs ${JSON.stringify(outputs)}`);
      assert.deepEqual(d.foraDosOutputs, outputs.includes(x) ? [] : [x], x);
    }
  // Param, com carimbo ou sem: o que define a parada (mesmo declarado) e o caminho clínico fora dos Outputs.
  for (const x of [".claude/hooks/gate-de-publicacao.js", ".vega/algum-mode", ".claude/hooks/lib/liberacao-da-publicacao.mjs"])
    for (const outputs of [[HOOK], [HOOK, x]]) assert.deepEqual(decidir([x], outputs, { carimbo: carimbo() }).motivos, [{ motivo: "define-a-parada", caminhos: [x] }], x);
  const clinico = "apps/app/src/labs/laudo/acao.ts";
  const comClinico = decidir([clinico], [HOOK], { carimbo: carimbo() });
  assert.deepEqual(comClinico.motivos.map((m) => m.motivo), ["caminho-clinico-fora-dos-outputs"]);
  // A task com publicação para na conferência, não no trazer: o carimbo com publicação não muda o trazer.
  assert.deepEqual(decidir([FORA], [HOOK], { carimbo: carimbo({ publicacao: true }) }).motivos, []);
});

test("instrução de sessão e canonico do ciclo seguem pelo carimbo, com o caso registrado; sem carimbo perguntam (D1a)", () => {
  // D-VEGA20-26: com carimbo ou sem, seguem sem pergunta e sem caso; o canonico vai ao relato à parte.
  for (const extra of [{ carimbo: carimbo() }, {}, { carimbo: carimbo({ veredito: "CHANGES-REQUESTED" }) }]) {
    const d = decidir([INSTRUCAO, CANONICO], [HOOK], extra);
    assert.deepEqual(d.motivos, [], JSON.stringify(extra));
    assert.deepEqual(d.consentidos, []);
    assert.deepEqual(d.foraDosOutputs, [INSTRUCAO]);
    assert.equal(d.canonicoAlterado, true);
  }
});

test("guard com o papel no meio do nome e a lib da publicação perguntam fora dos Outputs mesmo com carimbo", () => {
  // D-VEGA20-26: o corpo de guard segue sem pergunta; a lib da liberação da publicação define a parada.
  for (const x of [".claude/hooks/gap3-sql-guard-dml-extension.js", ".claude/hooks/frontmatter-guard-serena.js", ".claude/hooks/guarda-chuva.js"]) {
    const d = decidir([x], [HOOK], { carimbo: carimbo() });
    assert.deepEqual([d.motivos, d.foraDosOutputs], [[], [x]], x);
  }
  const lib = ".claude/hooks/lib/liberacao-da-publicacao.mjs";
  assert.deepEqual(perguntados(decidir([lib], [HOOK], { carimbo: carimbo() })), [lib]);
});

// D-VEGA19-61 (T48): em `.claude/state/`, só a configuração dos guards segue perguntando com carimbo.
test("operadores declarado passa com carimbo", () => {
  // D-VEGA20-26: estado e configuração dos guards seguem sem pergunta, com carimbo ou sem.
  const estado = [
    ".claude/state/operators.json",
    ".claude/state/guard-mode-registry.json",
    ".claude/state/scratch-path-guard-mode",
    ".claude/state/context-frontier-advisory-threshold",
    ".claude/state/git-guard-allow.example",
    ".claude/state/memory-shard-schema.json",
  ];
  for (const x of estado)
    for (const outputs of [[HOOK], [x]])
      for (const extra of [{ carimbo: carimbo() }, {}]) {
        const d = decidir([x], outputs, extra);
        assert.deepEqual(d.motivos, [], `${x} com outputs ${JSON.stringify(outputs)}`);
        assert.deepEqual(d.foraDosOutputs, outputs.includes(x) ? [] : [x]);
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
  // Ciclo de 2 níveis declarado: sem a marca, o núcleo roda em 3 (D10c do L4).
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 2", "-m", "Conducao-Niveis: 2");
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
  // D-VEGA20-26: o hook fora dos Outputs é trazido sem pergunta e vai ao relato; nenhum caso a gravar.
  const a = ambienteGit(t);
  a.abrir();
  a.filhaTrabalha({ veredito: "APPROVED" });
  const s = trazer({ repo: a.maestra, ciclo: CICLO_GIT, task: "T1", tentativa: 1 });
  assert.equal(s.acao, "trazida", JSON.stringify(s));
  assert.deepEqual(s.foraDosOutputs.filter((x) => !x.includes("/revisoes/")), [FORA]);
  assert.ok(s.avisoOperador.some((l) => l.includes(FORA)), JSON.stringify(s.avisoOperador));
  assert.equal(a.g("show", `HEAD:${FORA}`), "export const outro = 2;");
  assert.equal(c.lerConsentimentos(a.maestra, { ciclo: CICLO_GIT }).filter((l) => l.caso === c.CASOS.cobertoPeloCarimbo).length, 0);
});

test("o trazer sem carimbo, ou com carimbo que não aprova, pergunta pelo fora dos Outputs", (t) => {
  // D-VEGA20-26: sem carimbo, ou com o que não aprova, o trazer segue igual: o carimbo é cobrado no push, pelo CI.
  for (const veredito of [null, "CHANGES_REQUESTED"]) {
    const a = ambienteGit(t);
    a.abrir();
    a.filhaTrabalha({ veredito });
    const s = trazer({ repo: a.maestra, ciclo: CICLO_GIT, task: "T1", tentativa: 1 });
    assert.equal(s.acao, "trazida", `${veredito}: ${JSON.stringify(s)}`);
    assert.ok(s.foraDosOutputs.includes(FORA), `${veredito}: o relato cita o hook fora dos Outputs`);
    assert.equal(c.lerConsentimentos(a.maestra, { ciclo: CICLO_GIT }).filter((l) => l.caso === c.CASOS.cobertoPeloCarimbo).length, 0);
  }
});
