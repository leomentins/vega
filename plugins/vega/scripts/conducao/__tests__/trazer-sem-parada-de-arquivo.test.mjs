/**
 * trazer-sem-parada-de-arquivo.test.mjs — o trazer não pergunta por arquivo da
 * faixa, dentro ou fora dos Outputs (VEGA-20 T43, D-VEGA20-26, AC-VEGA20-21).
 *
 * Os dois casos medidos que a T43 transforma em teste, montados só com ids,
 * motivos e caminhos das perguntas:
 *   — D14 (`p-0b99bcf46545da83`): o trazer da T5 parado por `canonico-do-ciclo`;
 *   — D32 (`p-d092a22e28f39502`, `p-a0969969d9cb0029`): o trazer da T41 parado
 *     por `alcance-dos-hooks` e pelo `.claude/settings.json`, fora dos Outputs.
 * Os dois trazem sem pergunta: a D14 sai com `canonicoAlterado`, a D32 com os
 * dois caminhos em `foraDosOutputs`, gravados no registro `trazida` e lidos
 * pelo `retomar`. Seguem parando o caminho clínico fora dos Outputs, o que
 * define a parada de publicação (mesmo declarado), a faixa fora do marcador e
 * a task com publicação, na conferência.
 *
 * Uma base monta um origin bare, a árvore da maestra no ramo do ciclo e um
 * clone da filha, com hooks desligados (como em `conducao-git.test.mjs`), e
 * autoriza e abre uma vez; cada caso da tabela roda numa cópia dela (D3a).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { caminhoDoContrato } from "../git-conducao.mjs";
import { settingsMudaAParada } from "../consentimento.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CONTRATO = readFileSync(path.resolve(AQUI, "../../../skills/conducao/references/contrato.md"), "utf8");
const CICLO = "TESTE-43-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

// Os caminhos das perguntas D14 e D32, e o que a T43 mantém parado.
const SETTINGS = ".claude/settings.json";
const HOOK_DO_MOTOR = ".claude/skills/vega/motor/git-guard.js";
const SAIDA_DA_T41 = ".claude/hooks/__tests__/settings-hooks-cwd-subpasta.test.mjs";
const NOTA_DA_T5 = `.agents/ciclo/teste/${CICLO}/notes/fechamento-F0.md`;
const CLINICO = "db/migrations/20261121000000_x.sql";
const ADAPTADOR = ".vega/sistoli.mjs";
const GATE = ".claude/hooks/gate-de-publicacao.js";

function task(id, { outputs, steps = "faz" } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE43-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** ${outputs ?? `\`src/${id.toLowerCase()}.mjs\` (create)`}`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    `- **Steps:** ${steps}`,
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

const TASKS = [
  task("T5", { outputs: `\`${NOTA_DA_T5}\` (create)` }),
  task("T41", { outputs: `\`${SAIDA_DA_T41}\` (modify)` }),
  task("T42", { outputs: `\`${ADAPTADOR}\` (modify) · \`${GATE}\` (modify)` }),
  task("T44"),
  task("T45", { steps: "publica com `db push` pelo verbo sancionado" }),
];

function canonico(largura = 3) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-11-21",
    "---",
    "",
    "## 1. Goal",
    "",
    "### 1.5 Modo de Execução",
    "",
    `**Largura do ciclo:** ${largura}`,
    "",
    "## 3. Tasks",
    "",
    "### F1 — fase F1 (**Modelo:** sonnet)",
    "",
    ...TASKS,
    "## 4. Pronto",
    "",
  ].join("\n");
}

const gitEm = (dir) => (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function configurar(g) {
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
}

function escreverEm(dir, arquivos) {
  for (const [p, conteudo] of Object.entries(arquivos)) {
    mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
    writeFileSync(path.join(dir, p), conteudo);
  }
}

/** Origin bare + maestra no ramo do ciclo (com `extra` no primeiro commit) + clone da filha, sob `raiz`. */
function montar(raiz, extra) {
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const maestra = path.join(raiz, "maestra");
  mkdirSync(maestra);
  const g = gitEm(maestra);
  g("init", "-q", "-b", "ciclo-teste");
  configurar(g);
  g("remote", "add", "origin", origin);
  escreverEm(maestra, {
    "README.md": "fixture\n",
    [SETTINGS]: '{\n  "hooks": {}\n}\n',
    [HOOK_DO_MOTOR]: "module.exports = {};\n",
    [CAMINHO]: canonico(),
    ...extra,
  });
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  // Ciclo de 2 níveis declarado: sem a marca, o núcleo roda em 3 (D10c do L4).
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 2", "-m", "Conducao-Niveis: 2");
  g("push", "-q", "origin", "ciclo-teste");
  const filha = path.join(raiz, "filha");
  execFileSync("git", ["clone", "-q", origin, filha]);
  configurar(gitEm(filha));
}

/** Os verbos sobre o repositório já montado em `raiz` (a base ou uma cópia dela). */
function operar(raiz) {
  const maestra = path.join(raiz, "maestra");
  const filha = path.join(raiz, "filha");
  const g = gitEm(maestra);
  const f = gitEm(filha);
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", maestra, "--ciclo", CICLO], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    const linhas = r.stdout.split("\n").filter(Boolean);
    return { status: r.status, stderr: r.stderr, saida: linhas.length === 1 ? JSON.parse(linhas[0]) : null, linhas };
  };
  const ok = (...args) => {
    const r = cli(...args);
    assert.equal(r.status, 0, `${args.join(" ")} → ${r.status}\n${r.stderr}\n${r.linhas.join("\n")}`);
    return r.saida;
  };
  const pergunta = (motivo, ...args) => {
    const r = cli(...args);
    assert.equal(r.status, 1, `${args.join(" ")} deveria perguntar\n${r.stderr}\n${r.linhas.join("\n")}`);
    assert.equal(r.saida?.acao, "perguntar", r.linhas.join("\n"));
    assert.equal(r.saida.motivo, motivo, r.linhas.join("\n"));
    return r.saida;
  };
  const ref = (tk) => `refs/conducao/${CICLO}/${tk}/1`;
  /** A filha busca a tentativa 1, commita os arquivos e empurra de volta à mesma referência. */
  const filhaTrabalha = (tk, arquivos) => {
    f("fetch", "-q", "origin", `+${ref(tk)}:refs/remotes/tentativa`);
    f("checkout", "-q", "--detach", "refs/remotes/tentativa");
    escreverEm(filha, arquivos);
    f("add", "-A");
    f("commit", "-q", "-m", `${CICLO}-F1/${tk} — trabalho`);
    f("push", "-q", "origin", `HEAD:${ref(tk)}`);
    return f("rev-parse", "HEAD");
  };
  const abrir = (tk) => ok("abrir", tk, "--tentativa", "1", "--nonce", `nonce${tk}1`, "--modo-maestra", "auto");
  return { raiz, maestra, g, f, filha, ok, pergunta, cli, ref, filhaTrabalha, abrir, escreverEm };
}

/** A base de uma tabela: montada, autorizada e com as tasks de `abertas` abertas (o retorno do `abrir` em `aberta`). */
function base(t, { extra = {}, abertas }) {
  const raiz = pastaTemporaria("trazer-sem-parada-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  montar(raiz, extra);
  const a = operar(raiz);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1", "--pergunta", "p-00000000000000a1");
  const aberta = Object.fromEntries(abertas.map((tk) => [tk, a.abrir(tk)]));
  return { ...a, aberta };
}

/**
 * Cópia da base (origin, maestra e filha) para um caso: o origin vai com caminho absoluto na
 * config da maestra e da filha, e é reapontado para o da cópia.
 */
function copiar(t, b) {
  const raiz = pastaTemporaria("trazer-sem-parada-caso-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  execFileSync("cp", ["-a", `${b.raiz}/.`, raiz]);
  const origin = path.join(raiz, "origin.git");
  for (const d of ["maestra", "filha"]) gitEm(path.join(raiz, d))("remote", "set-url", "origin", origin);
  return { ...operar(raiz), aberta: b.aberta };
}

/** O trailer `Conducao-Fora-Dos-Outputs` do registro `trazida`, lido do git cru. */
function foraDoRegistro(a, tk) {
  const bruto = a.g("log", "-1", "--format=%(trailers:key=Conducao-Fora-Dos-Outputs,valueonly)", `refs/conducao-local/${CICLO}/trazida/${tk}/1`);
  return JSON.parse(Buffer.from(bruto, "base64url").toString("utf8"));
}

// D-VEGA20-26: o padrão da fábrica deixou de ser condição do trazer — com o contrato do HEAD
// sem a seção do padrão, ou sem contrato, a D32 traz do mesmo jeito.
const CONTRATO_SEM_PADRAO = CONTRATO.replace(/^## Padrão da fábrica$/m, "## Outra seção");

/** D32: settings.json e hook do motor fora dos Outputs da T41 trazem sem pergunta, e o retomar lê a lista. */
function d32(a) {
  a.filhaTrabalha("T41", {
    [SAIDA_DA_T41]: "test\n",
    [SETTINGS]: '{\n  "hooks": { "PreToolUse": [] }\n}\n',
    [HOOK_DO_MOTOR]: "module.exports = { serena: true };\n",
  });
  const s = a.ok("trazer", "T41", "--tentativa", "1", "--sessao", "s41");
  assert.equal(s.acao, "trazida", JSON.stringify(s));
  assert.deepEqual([...s.foraDosOutputs].sort(), [SETTINGS, HOOK_DO_MOTOR].sort());
  assert.equal(s.canonicoAlterado, false);
  for (const c of [SETTINGS, HOOK_DO_MOTOR]) assert.ok(s.avisoOperador.some((l) => l.includes(c)), `${c} no relato: ${JSON.stringify(s.avisoOperador)}`);
  assert.deepEqual([...foraDoRegistro(a, "T41")].sort(), [SETTINGS, HOOK_DO_MOTOR].sort());
  const r = a.ok("retomar").trazidas.find((x) => x.task === "T41");
  assert.deepEqual([...r.foraDosOutputs].sort(), [SETTINGS, HOOK_DO_MOTOR].sort());
  assert.equal(r.canonicoAlterado, false);
}

/**
 * Os casos sobre a base padrão (T41 e T44 abertas; a T5, a T42 e a T45 o caso abre na cópia).
 * Cada um roda numa cópia da base; o que traz e o que para não se misturam.
 */
const CASOS = [
  {
    nome: "D14: o canonico do ciclo na faixa da T5 traz sem pergunta e sai com canonicoAlterado",
    rodar: (a) => {
      a.abrir("T5");
      a.filhaTrabalha("T5", { [NOTA_DA_T5]: "fechamento\n", [CAMINHO]: canonico(4) });
      const s = a.ok("trazer", "T5", "--tentativa", "1", "--sessao", "s5");
      assert.equal(s.acao, "trazida", JSON.stringify(s));
      assert.equal(s.canonicoAlterado, true);
      assert.deepEqual(s.foraDosOutputs, [], "o canonico vai ao relato à parte, nunca na lista de fora");
      assert.ok(s.avisoOperador.some((l) => l.includes(CAMINHO)), JSON.stringify(s.avisoOperador));
      assert.deepEqual(foraDoRegistro(a, "T5"), [], "o trailer é gravado mesmo vazio");
      const r = a.ok("retomar").trazidas.find((x) => x.task === "T5");
      assert.deepEqual([r.foraDosOutputs, r.canonicoAlterado], [[], true]);
    },
  },
  { nome: "D32, sem contrato no HEAD", rodar: d32 },
  {
    nome: "D32, com contrato do HEAD sem o padrão da fábrica",
    rodar: (a, tt) => {
      if (!caminhoDoContrato()) return tt.skip("fora de um repositório git o contrato não tem caminho");
      a.escreverEm(a.maestra, { [caminhoDoContrato()]: CONTRATO_SEM_PADRAO });
      a.g("add", "-A");
      a.g("commit", "-q", "-m", "contrato sem o padrão");
      d32(a);
    },
  },
  {
    nome: "depois de conferir, o retomar ainda devolve a lista e o canonicoAlterado, lidos da marca conferida",
    rodar: (a) => {
      a.filhaTrabalha("T41", { [SAIDA_DA_T41]: "test\n", [HOOK_DO_MOTOR]: "module.exports = { serena: true };\n", [CAMINHO]: canonico(4) });
      a.ok("trazer", "T41", "--tentativa", "1", "--sessao", "s41");
      assert.equal(a.ok("registrar-conferencia", "T41", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--sessao", "session_01TesteDaFilha").acao, "conferida");
      assert.equal(a.g("for-each-ref", `refs/conducao-local/${CICLO}/trazida/`), "", "a conferência apaga o registro trazida");
      const r = a.ok("retomar");
      assert.deepEqual(r.trazidas, []);
      const c = r.conferidas.find((x) => x.task === "T41");
      assert.deepEqual([c.foraDosOutputs, c.canonicoAlterado], [[HOOK_DO_MOTOR], true]);
      assert.deepEqual(r.avisosDoRelato, []);
    },
  },
  {
    nome: "relato ilegivel nao vira null calado: o retomar devolve um aviso nomeando a trazida",
    rodar: (a) => {
      a.filhaTrabalha("T41", { [SAIDA_DA_T41]: "test\n", [HOOK_DO_MOTOR]: "module.exports = { serena: true };\n" });
      a.ok("trazer", "T41", "--tentativa", "1", "--sessao", "s41");
      // Regrava o registro `trazida` com os dois trailers do relato ilegíveis.
      const ref = `refs/conducao-local/${CICLO}/trazida/T41/1`;
      const velho = a.g("rev-parse", ref);
      const corpo = a.g("log", "-1", "--format=%B", velho)
        .replace(/Conducao-Fora-Dos-Outputs: \S+/, `Conducao-Fora-Dos-Outputs: ${Buffer.from("nao e json").toString("base64url")}`)
        .replace(/Conducao-Canonico-Alterado: \S+/, "Conducao-Canonico-Alterado: talvez");
      const novo = execFileSync("git", ["commit-tree", a.g("rev-parse", `${velho}^{tree}`), "-p", a.g("rev-parse", `${velho}^`), "-m", corpo], { cwd: a.maestra, encoding: "utf8" }).trim();
      a.g("update-ref", ref, novo, velho);
      const r = a.ok("retomar");
      const tr = r.trazidas.find((x) => x.task === "T41");
      assert.deepEqual([tr.foraDosOutputs, tr.canonicoAlterado], [null, null]);
      assert.deepEqual(r.avisosDoRelato.map((x) => [x.task, x.trazida, x.trailer]), [
        ["T41", ref, "Conducao-Fora-Dos-Outputs"],
        ["T41", ref, "Conducao-Canonico-Alterado"],
      ]);
      // O ilegível segue até a marca conferida, e o aviso a nomeia pelo sha.
      a.ok("registrar-conferencia", "T41", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--sessao", "session_01TesteDaFilha");
      const depois = a.ok("retomar");
      const sha = a.g("log", "-1", "--format=%H", "--grep=^Conducao: T41 conferida$", "HEAD");
      assert.deepEqual(depois.avisosDoRelato.map((x) => [x.task, x.conferida, x.trailer]), [
        ["T41", sha, "Conducao-Fora-Dos-Outputs"],
        ["T41", sha, "Conducao-Canonico-Alterado"],
      ]);
    },
  },
  {
    nome: "caminho clinico fora dos Outputs segue em trazer-exige-aprovacao",
    rodar: (a) => {
      const ponta = a.filhaTrabalha("T44", { "src/t44.mjs": "x\n", [CLINICO]: "select 1;\n" });
      const p = a.pergunta("trazer-exige-aprovacao", "trazer", "T44", "--tentativa", "1");
      assert.equal(p.sha, ponta);
      assert.deepEqual(p.motivos, [{ motivo: "caminho-clinico-fora-dos-outputs", caminhos: [CLINICO] }]);
    },
  },
  {
    nome: "o que define a parada de publicacao segue em trazer-exige-aprovacao, mesmo declarado",
    rodar: (a) => {
      a.abrir("T42");
      a.filhaTrabalha("T42", { [ADAPTADOR]: "export default {};\n", [GATE]: "process.exit(0);\n" });
      const p = a.pergunta("trazer-exige-aprovacao", "trazer", "T42", "--tentativa", "1");
      assert.deepEqual(p.motivos, [{ motivo: "define-a-parada", caminhos: [GATE, ADAPTADOR] }]);
    },
  },
  {
    nome: "settings.json cujo diff registra o gate de publicacao define a parada",
    rodar: (a) => {
      a.filhaTrabalha("T41", { [SAIDA_DA_T41]: "test\n", [SETTINGS]: '{\n  "hooks": { "PreToolUse": [{ "command": "node .claude/hooks/publicacao-gate.js" }] }\n}\n' });
      const p = a.pergunta("trazer-exige-aprovacao", "trazer", "T41", "--tentativa", "1");
      assert.deepEqual(p.motivos, [{ motivo: "define-a-parada", caminhos: [SETTINGS] }]);
    },
  },
  {
    nome: "settings.local.json novo com disableAllHooks define a parada",
    rodar: (a) => {
      const local = ".claude/settings.local.json";
      a.filhaTrabalha("T41", { [SAIDA_DA_T41]: "test\n", [local]: '{ "disableAllHooks": true }\n' });
      assert.deepEqual(a.pergunta("trazer-exige-aprovacao", "trazer", "T41", "--tentativa", "1").motivos, [{ motivo: "define-a-parada", caminhos: [local] }]);
    },
  },
  {
    nome: "a faixa fora do marcador segue em faixa-fora-do-marcador",
    rodar: (a) => {
      a.f("fetch", "-q", "origin", `+${a.ref("T44")}:refs/remotes/tentativa`);
      a.f("checkout", "-q", "--orphan", "fora");
      a.escreverEm(a.filha, { "fora.txt": "historia de fora\n" });
      a.f("add", "-A");
      a.f("commit", "-q", "-m", "historia de fora");
      a.f("checkout", "-q", "--detach", a.aberta.T44.marcador);
      a.escreverEm(a.filha, { "src/t44.mjs": "trabalho\n" });
      a.f("add", "-A");
      a.f("commit", "-q", "-m", "trabalho");
      a.f("merge", "-q", "--allow-unrelated-histories", "-s", "ours", "-m", "merge de fora", "fora");
      a.f("push", "-q", "--force", "origin", `HEAD:${a.ref("T44")}`);
      a.pergunta("faixa-fora-do-marcador", "trazer", "T44", "--tentativa", "1");
    },
  },
  {
    nome: "a task com publicacao segue parando na conferencia",
    rodar: (a) => {
      a.abrir("T45");
      a.filhaTrabalha("T45", { "src/t45.mjs": "x\n" });
      assert.equal(a.ok("trazer", "T45", "--tentativa", "1", "--sessao", "s45").acao, "trazida");
      const r = a.cli("registrar-conferencia", "T45", "--verificacao", "verde", "--publicacao", "nao-se-aplica");
      assert.equal(r.status, 1);
      assert.match(r.stderr, /publicacao-pendente/);
    },
  },
];

// Achados da revisão da T43: desligar o gate sem citar o nome dele na linha também define a parada.
const COM_GATE = '{\n  "hooks": { "PreToolUse": [{ "matcher": "Bash|PowerShell", "hooks": [{ "command": "node .claude/hooks/publicacao-gate.js" }] }] }\n}\n';

/** Os casos sobre a base com o gate já registrado no settings.json da maestra (T41 aberta). */
const CASOS_COM_GATE = [
  {
    nome: "settings.json que ja registra o gate na maestra: trocar o matcher para",
    rodar: (a) => {
      a.filhaTrabalha("T41", { [SAIDA_DA_T41]: "test\n", [SETTINGS]: COM_GATE.replace('"Bash|PowerShell"', '"Nada"') });
      assert.deepEqual(a.pergunta("trazer-exige-aprovacao", "trazer", "T41", "--tentativa", "1").motivos, [{ motivo: "define-a-parada", caminhos: [SETTINGS] }]);
    },
  },
  {
    nome: "settings.json que ja registra o gate na maestra: mexer em outro hook segue",
    rodar: (a) => {
      a.filhaTrabalha("T41", { [SAIDA_DA_T41]: "test\n", [SETTINGS]: COM_GATE.replace('"PreToolUse"', '"Stop": [], "PreToolUse"') });
      assert.deepEqual(a.ok("trazer", "T41", "--tentativa", "1", "--sessao", "s41").foraDosOutputs, [SETTINGS]);
    },
  },
];

test("trazer sem parada de arquivo: o que traz e o que segue parando, por tabela de casos", async (t) => {
  for (const [rotulo, b, casos] of [
    ["", base(t, { abertas: ["T41", "T44"] }), CASOS],
    ["gate na maestra: ", base(t, { extra: { [SETTINGS]: COM_GATE }, abertas: ["T41"] }), CASOS_COM_GATE],
  ]) {
    for (const caso of casos) await t.test(`${rotulo}${caso.nome}`, (tt) => caso.rodar(copiar(tt, b), tt));
  }
});

test("settingsMudaAParada: matcher trocado, disableAllHooks, chave hooks repetida e ilegivel param; o resto segue", () => {
  assert.equal(settingsMudaAParada(COM_GATE, COM_GATE.replace('"Bash|PowerShell"', '"Nada"')), true);
  assert.equal(settingsMudaAParada(COM_GATE, COM_GATE.replace('{\n', '{\n  "disableAllHooks": true,\n')), true);
  assert.equal(settingsMudaAParada(COM_GATE, COM_GATE.replace(/\n}\n$/, ',\n  "hooks": {}\n}\n')), true);
  assert.equal(settingsMudaAParada(COM_GATE, "{ nao e json"), true);
  // Mexer no objeto do gate sem tocar a string do comando também para (segunda rodada da revisão).
  for (const extra of ['"timeout": 0.001, ', '"async": true, ', '"type": "prompt", '])
    assert.equal(settingsMudaAParada(COM_GATE, COM_GATE.replace('{ "command"', `{ ${extra}"command"`)), true, extra);
  assert.equal(settingsMudaAParada(undefined, '{ "disableAllHooks": true }'), true, "arquivo novo que desliga os hooks");
  assert.equal(settingsMudaAParada(COM_GATE, undefined), true, "apagar o settings que registra o gate");
  // Segue: o que não mexe no registro do gate nem desliga os hooks.
  assert.equal(settingsMudaAParada(COM_GATE, COM_GATE.replace('"PreToolUse"', '"PostToolUse": [], "PreToolUse"')), false);
  assert.equal(settingsMudaAParada(undefined, '{ "hooks": { "PreToolUse": [] } }'), false);
  assert.equal(settingsMudaAParada('{ "hooks": {} }', '{ "hooks": { "Stop": [] } }'), false);
});
