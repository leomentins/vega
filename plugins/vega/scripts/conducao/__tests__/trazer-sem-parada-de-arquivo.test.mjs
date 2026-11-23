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
 * Cada teste monta um origin bare, a árvore da maestra no ramo do ciclo e um
 * clone da filha, com hooks desligados (como em `conducao-git.test.mjs`).
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

/** Origin bare + maestra no ramo do ciclo (com `extra` no primeiro commit) + clone da filha. */
function ambiente(t, { extra = {} } = {}) {
  const raiz = mkdtempSync(path.join(tmpdir(), "trazer-sem-parada-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
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
  const f = gitEm(filha);
  configurar(f);

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
  const autorizar = () => ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1", "--pergunta", "p-00000000000000a1");
  const abrir = (tk) => ok("abrir", tk, "--tentativa", "1", "--nonce", `nonce${tk}1`, "--modo-maestra", "auto");
  return { maestra, g, f, filha, ok, pergunta, cli, ref, filhaTrabalha, autorizar, abrir, escreverEm };
}

/** O trailer `Conducao-Fora-Dos-Outputs` do registro `trazida`, lido do git cru. */
function foraDoRegistro(a, tk) {
  const bruto = a.g("log", "-1", "--format=%(trailers:key=Conducao-Fora-Dos-Outputs,valueonly)", `refs/conducao-local/${CICLO}/trazida/${tk}/1`);
  return JSON.parse(Buffer.from(bruto, "base64url").toString("utf8"));
}

test("D14: o canonico do ciclo na faixa da T5 traz sem pergunta e sai com canonicoAlterado", (t) => {
  const a = ambiente(t);
  a.autorizar();
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
});

// D-VEGA20-26: o padrão da fábrica deixou de ser condição do trazer — com o contrato do HEAD
// sem a seção do padrão, ou sem contrato, a D32 traz do mesmo jeito.
const CONTRATO_SEM_PADRAO = CONTRATO.replace(/^## Padrão da fábrica$/m, "## Outra seção");
for (const [nome, extra] of [
  ["sem contrato no HEAD", {}],
  ["com contrato do HEAD sem o padrão da fábrica", caminhoDoContrato() ? { [caminhoDoContrato()]: CONTRATO_SEM_PADRAO } : null],
]) {
  test(`D32: settings.json e hook do motor fora dos Outputs da T41 trazem sem pergunta, ${nome}, e o retomar lê a lista`, (t) => {
    if (!extra) return t.skip("fora de um repositório git o contrato não tem caminho");
    const a = ambiente(t, { extra });
    a.autorizar();
    a.abrir("T41");
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
  });
}

test("depois de conferir, o retomar ainda devolve a lista e o canonicoAlterado, lidos da marca conferida", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T41");
  a.filhaTrabalha("T41", { [SAIDA_DA_T41]: "test\n", [HOOK_DO_MOTOR]: "module.exports = { serena: true };\n", [CAMINHO]: canonico(4) });
  a.ok("trazer", "T41", "--tentativa", "1", "--sessao", "s41");
  assert.equal(a.ok("registrar-conferencia", "T41", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--sessao", "session_01TesteDaFilha").acao, "conferida");
  assert.equal(a.g("for-each-ref", `refs/conducao-local/${CICLO}/trazida/`), "", "a conferência apaga o registro trazida");
  const r = a.ok("retomar");
  assert.deepEqual(r.trazidas, []);
  const c = r.conferidas.find((x) => x.task === "T41");
  assert.deepEqual([c.foraDosOutputs, c.canonicoAlterado], [[HOOK_DO_MOTOR], true]);
  assert.deepEqual(r.avisosDoRelato, []);
});

test("relato ilegivel nao vira null calado: o retomar devolve um aviso nomeando a trazida", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T41");
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
});

test("caminho clinico fora dos Outputs segue em trazer-exige-aprovacao", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T44");
  const ponta = a.filhaTrabalha("T44", { "src/t44.mjs": "x\n", [CLINICO]: "select 1;\n" });
  const p = a.pergunta("trazer-exige-aprovacao", "trazer", "T44", "--tentativa", "1");
  assert.equal(p.sha, ponta);
  assert.deepEqual(p.motivos, [{ motivo: "caminho-clinico-fora-dos-outputs", caminhos: [CLINICO] }]);
});

test("o que define a parada de publicacao segue em trazer-exige-aprovacao, mesmo declarado", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T42");
  a.filhaTrabalha("T42", { [ADAPTADOR]: "export default {};\n", [GATE]: "process.exit(0);\n" });
  const p = a.pergunta("trazer-exige-aprovacao", "trazer", "T42", "--tentativa", "1");
  assert.deepEqual(p.motivos, [{ motivo: "define-a-parada", caminhos: [GATE, ADAPTADOR] }]);
});

test("settings.json cujo diff registra o gate de publicacao define a parada; o que nao registra segue", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T41");
  a.filhaTrabalha("T41", { [SAIDA_DA_T41]: "test\n", [SETTINGS]: '{\n  "hooks": { "PreToolUse": [{ "command": "node .claude/hooks/publicacao-gate.js" }] }\n}\n' });
  const p = a.pergunta("trazer-exige-aprovacao", "trazer", "T41", "--tentativa", "1");
  assert.deepEqual(p.motivos, [{ motivo: "define-a-parada", caminhos: [SETTINGS] }]);
});

// Achados da revisão da T43: desligar o gate sem citar o nome dele na linha também define a parada.
const COM_GATE = '{\n  "hooks": { "PreToolUse": [{ "matcher": "Bash|PowerShell", "hooks": [{ "command": "node .claude/hooks/publicacao-gate.js" }] }] }\n}\n';
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

test("settings.json que ja registra o gate na maestra: trocar o matcher para; mexer em outro hook segue", (t) => {
  const a = ambiente(t, { extra: { [SETTINGS]: COM_GATE } });
  a.autorizar();
  a.abrir("T41");
  a.filhaTrabalha("T41", { [SAIDA_DA_T41]: "test\n", [SETTINGS]: COM_GATE.replace('"Bash|PowerShell"', '"Nada"') });
  assert.deepEqual(a.pergunta("trazer-exige-aprovacao", "trazer", "T41", "--tentativa", "1").motivos, [{ motivo: "define-a-parada", caminhos: [SETTINGS] }]);
  const b = ambiente(t, { extra: { [SETTINGS]: COM_GATE } });
  b.autorizar();
  b.abrir("T41");
  b.filhaTrabalha("T41", { [SAIDA_DA_T41]: "test\n", [SETTINGS]: COM_GATE.replace('"PreToolUse"', '"Stop": [], "PreToolUse"') });
  assert.deepEqual(b.ok("trazer", "T41", "--tentativa", "1", "--sessao", "s41").foraDosOutputs, [SETTINGS]);
});

test("settings.local.json novo com disableAllHooks define a parada", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T41");
  const local = ".claude/settings.local.json";
  a.filhaTrabalha("T41", { [SAIDA_DA_T41]: "test\n", [local]: '{ "disableAllHooks": true }\n' });
  assert.deepEqual(a.pergunta("trazer-exige-aprovacao", "trazer", "T41", "--tentativa", "1").motivos, [{ motivo: "define-a-parada", caminhos: [local] }]);
});

test("a faixa fora do marcador segue em faixa-fora-do-marcador", (t) => {
  const a = ambiente(t);
  a.autorizar();
  const s = a.abrir("T44");
  a.f("fetch", "-q", "origin", `+${a.ref("T44")}:refs/remotes/tentativa`);
  a.f("checkout", "-q", "--orphan", "fora");
  a.escreverEm(a.filha, { "fora.txt": "historia de fora\n" });
  a.f("add", "-A");
  a.f("commit", "-q", "-m", "historia de fora");
  a.f("checkout", "-q", "--detach", s.marcador);
  a.escreverEm(a.filha, { "src/t44.mjs": "trabalho\n" });
  a.f("add", "-A");
  a.f("commit", "-q", "-m", "trabalho");
  a.f("merge", "-q", "--allow-unrelated-histories", "-s", "ours", "-m", "merge de fora", "fora");
  a.f("push", "-q", "--force", "origin", `HEAD:${a.ref("T44")}`);
  a.pergunta("faixa-fora-do-marcador", "trazer", "T44", "--tentativa", "1");
});

test("a task com publicacao segue parando na conferencia", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T45");
  a.filhaTrabalha("T45", { "src/t45.mjs": "x\n" });
  assert.equal(a.ok("trazer", "T45", "--tentativa", "1", "--sessao", "s45").acao, "trazida");
  const r = a.cli("registrar-conferencia", "T45", "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /publicacao-pendente/);
});
