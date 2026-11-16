/**
 * consentimento-trazer.test.mjs — o registro dos casos que o `trazer` deixa de
 * perguntar (VEGA-37 T33, D-VEGA37-34, D-VEGA37-35, AC-VEGA37-5).
 *
 * O `trazer` de `git-conducao.mjs` chama, nesta ordem, `decidirNoTrazer`,
 * `registrosDoTrazer` (gate do plano lido do canonico do HEAD) e, depois de
 * trazida, `gravarRegistrosDoTrazer`. Aqui a mesma cadeia roda num repositório
 * temporário com um canonico de teste; o fluxo inteiro do `trazer` é coberto
 * pelas suítes `conducao-git` e `conducao-consertos-git`. O caso da T34
 * (D-VEGA37-36) roda o `trazer` inteiro, com o gravador falhando por injeção.
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as c from "../consentimento.mjs";
import { ErroPlano } from "../ler-plano.mjs";
import { decidirNoTrazer } from "../verbos.mjs";
import { trazer } from "../git-conducao.mjs";

const CICLO = "X-1";
const CANONICO = ".agents/ciclo/vega/X-1/canonico.md";
const CODIGO = { caminhosProtegidos: [], telasProtegidasDosSteps: [], foraDasTelasDosSteps: [], alcanceDosHooks: [] };
// Todo caminho do diff conta como alcançado pelos hooks: o caso sai do Output declarado.
const alcance = (caminhos) => caminhos;
const HOOK = ".claude/hooks/um-hook.js";
const TESTE = ".claude/hooks/__tests__/um-hook.test.mjs";

const D22 = "instrução declarada em Outputs segue sem pergunta.";
const D27 = "teste que acompanha o código segue sem pergunta.";

function canonico({ mapa = true, comD27 = true } = {}) {
  return [
    "# X-1",
    "",
    "### 1.3 Decisões cravadas",
    "",
    `- **D-X1-22:** ${D22}`,
    ...(comD27 ? [`- **D-X1-27:** ${D27}`] : []),
    "",
    "### 1.5 Modo de Execução",
    "",
    ...(mapa ? ["**Consentimentos:** `instrucao-declarada-em-outputs` → D-X1-22 · `teste-que-acompanha-o-codigo` → D-X1-27 (caso sem linha segue perguntando)."] : []),
    "",
    "## 3. Tasks",
    "",
  ].join("\n");
}

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "consentimento-trazer-"));
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("config", "core.hooksPath", "/dev/null");
  g("commit", "-q", "--allow-empty", "-m", "raiz");
  return { dir, g };
}

const decidir = (caminhos, outputs, extra = {}) =>
  decidirNoTrazer({ caminhos, canonico: CANONICO, outputs, alcance, codigo: CODIGO, ciclo: CICLO, fase: "F3", ...extra });
const doTrazer = (consentidos, texto) =>
  c.registrosDoTrazer({ consentidos, canonico: texto, ciclo: CICLO, fase: "F3", task: "T33", quem: "operador", quando: "2026-11-14T12:00:00Z" });

test("trazer consentido grava o registro do caso", () => {
  const { dir, g } = repo();
  try {
    // o hook é Output declarado e o teste o acompanha: os dois seguem sem pergunta
    const decidido = decidir([HOOK, TESTE], [HOOK]);
    assert.deepEqual(decidido.motivos, []);
    assert.deepEqual(decidido.consentidos.map((x) => x.caso), [c.CASOS.instrucaoDeclaradaEmOutputs, c.CASOS.testeQueAcompanhaOCodigo]);
    const { registros, voltam } = doTrazer(decidido.consentidos, canonico());
    assert.deepEqual(voltam, []);
    assert.deepEqual(registros.map((r) => r.decisao), ["D-X1-22", "D-X1-27"]);
    const gravados = c.gravarRegistrosDoTrazer({ repo: dir, registros, cerca: () => {} });
    const lidos = c.lerConsentimentos(dir, { ciclo: CICLO });
    assert.deepEqual(lidos.map((l) => l.sha), gravados.map((x) => x.sha));
    assert.deepEqual(lidos.map((l) => [l.caso, l.sim, l.caminhos]), [
      [c.CASOS.instrucaoDeclaradaEmOutputs, D22, [HOOK]],
      [c.CASOS.testeQueAcompanhaOCodigo, D27, [TESTE]],
    ]);
    assert.equal(lidos[0].task, "T33");
    assert.equal(g("log", "-1", "--format=%s"), "Conducao: F3 consentimento teste-que-acompanha-o-codigo");

    // pergunta repetida: grava o corpo da marca de origem, relido do git
    c.gravarConsentimento({
      repo: dir,
      registro: { ciclo: CICLO, fase: "F3", caso: c.CASOS.respostaDoOperador, quem: "operador", quando: "2026-11-14T12:00:00Z", sim: "sim, pode trazer", tipo: "trazer", motivo: "alcance-dos-hooks" },
      phi: () => ({ recusar: false }),
      cerca: () => {},
    });
    // canonico do ciclo nunca repete (D-VEGA37-40): a repetição exerce o alcance dos hooks
    const repetida = decidir([".claude/hooks/outro-hook.js"], [], { consentimentos: c.lerConsentimentos(dir, { ciclo: CICLO }) });
    assert.deepEqual(repetida.motivos, []);
    const r2 = doTrazer(repetida.consentidos, canonico());
    assert.deepEqual(r2.voltam, []);
    const [rep] = c.gravarRegistrosDoTrazer({ repo: dir, registros: r2.registros, cerca: () => {} });
    assert.equal(rep.registro.caso, c.CASOS.perguntaRepetida);
    assert.equal(rep.registro.sim, "sim, pode trazer");
    assert.equal(c.lerConsentimentos(dir, { ciclo: CICLO }).at(-1).sha, rep.sha);

    // a cerca da posse barra antes do commit
    const antes = g("rev-parse", "HEAD");
    assert.throws(
      () => c.gravarRegistrosDoTrazer({ repo: dir, registros, cerca: () => { throw new ErroPlano("posse-alheia", "outra árvore"); } }),
      (e) => e.codigo === "posse-alheia" || /outra árvore/.test(e.message),
    );
    assert.equal(g("rev-parse", "HEAD"), antes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("texto fora do plano é recusado", () => {
  const { dir, g } = repo();
  try {
    const plano = c.gateDoPlano(canonico(), c.CASOS.instrucaoDeclaradaEmOutputs);
    assert.equal(plano.decisao, "D-X1-22");
    assert.equal(plano.corpo, D22);
    assert.equal(plano.gate({ corpo: D22 }).recusar, false);
    // substring, normalização e texto de mensagem: recusados
    for (const corpo of ["instrução declarada em Outputs", D22.toUpperCase(), `${D22} `, ` ${D22}`, D22.normalize("NFD"), "sim, pode seguir", "", undefined])
      assert.equal(plano.gate({ corpo }).recusar, true, JSON.stringify(corpo));
    // decisão de outro caso não vale para este
    assert.equal(plano.gate({ corpo: D27 }).recusar, true);

    const antes = g("rev-parse", "HEAD");
    const registro = { ciclo: CICLO, fase: "F3", caso: c.CASOS.instrucaoDeclaradaEmOutputs, quem: "operador", quando: "2026-11-14T12:00:00Z", sim: "sim, pode seguir", task: "T33" };
    assert.throws(() => c.gravarConsentimento({ repo: dir, registro, phi: plano.gate, cerca: () => {} }), (e) => e instanceof ErroPlano && /fora do plano/.test(e.message));
    // registro do plano sem gate: nada gravado
    assert.throws(() => c.gravarRegistrosDoTrazer({ repo: dir, registros: [{ registro: c.casoResolvido({ ...registro, sim: D22 }) }], cerca: () => {} }), ErroPlano);
    assert.equal(g("rev-parse", "HEAD"), antes);
    assert.deepEqual(c.lerConsentimentos(dir, { ciclo: CICLO }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("caso sem linha no mapa pergunta", () => {
  const decidido = decidir([HOOK, TESTE], [HOOK]);
  // sem a linha `**Consentimentos:**`: os dois voltam a perguntar, nunca linha padrão
  const semMapa = doTrazer(decidido.consentidos, canonico({ mapa: false }));
  assert.deepEqual(semMapa.registros, []);
  assert.deepEqual(c.devolverAosMotivos(decidido.motivos, semMapa.voltam), [{ motivo: "alcance-dos-hooks", caminhos: [HOOK, TESTE] }]);
  // mapa aponta decisão ausente do canonico: só esse caso volta
  const semDecisao = doTrazer(decidido.consentidos, canonico({ comD27: false }));
  assert.deepEqual(semDecisao.registros.map((r) => r.registro.caso), [c.CASOS.instrucaoDeclaradaEmOutputs]);
  assert.deepEqual(c.devolverAosMotivos([], semDecisao.voltam), [{ motivo: "alcance-dos-hooks", caminhos: [TESTE] }]);
  // caso que o mapa não nomeia (tela dos Steps): pergunta
  const tela = doTrazer([{ caso: c.CASOS.telaDosSteps, motivo: "caminho-clinico-fora-dos-outputs", caminhos: ["app/telas/x/y.tsx"] }], canonico());
  assert.deepEqual(tela.registros, []);
  assert.deepEqual(tela.voltam, [{ motivo: "caminho-clinico-fora-dos-outputs", caminhos: ["app/telas/x/y.tsx"] }]);
  // linha do mapa fora do §1.5, ou duas no §1.5: mapa vazio
  assert.equal(c.mapaDeConsentimentos(canonico().replace("### 1.5 Modo de Execução", "### 1.6 Outra")).size, 0);
  const duas = canonico().replace("**Consentimentos:**", "**Consentimentos:** `tela-dos-steps` → D-X1-22\n\n**Consentimentos:**");
  assert.equal(c.mapaDeConsentimentos(duas).size, 0);
  // pergunta repetida sem origem no git: pergunta
  const semOrigem = doTrazer([{ caso: c.CASOS.perguntaRepetida, motivo: "canonico-do-ciclo", caminhos: [CANONICO], origem: null, sim: "sim" }], canonico());
  assert.deepEqual(semOrigem.registros, []);
  assert.equal(semOrigem.voltam.length, 1);
});

// ── T34 (D-VEGA37-36): o registro que não se grava depois da trazida ────────

const CICLO_GIT = "TESTE-34-conducao";
const CAMINHO_GIT = `.agents/ciclo/teste/${CICLO_GIT}/canonico.md`;
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "conducao.mjs");
const D1 = "instrução declarada em Outputs segue sem pergunta.";

function canonicoGit() {
  return [
    "---",
    `cycle: ${CICLO_GIT}`,
    "opened: 2026-11-14",
    "---",
    "",
    "## 1. Goal",
    "",
    "### 1.3 Decisões cravadas",
    "",
    `- **D-TESTE-1:** ${D1}`,
    "",
    "### 1.5 Modo de Execução",
    "",
    "**Consentimentos:** `instrucao-declarada-em-outputs` → D-TESTE-1",
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

/** Origin bare + árvore da maestra no ramo do ciclo + clone da filha, hooks desligados (como em conducao-git). */
function ambienteGit(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "consentimento-trazer-git-"));
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
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const maestra = path.join(raiz, "maestra");
  mkdirSync(maestra);
  const g = em(maestra);
  g("init", "-q", "-b", "ciclo-teste");
  configurar(g);
  g("remote", "add", "origin", origin);
  escrever(maestra, { "README.md": "fixture\n", [CAMINHO_GIT]: canonicoGit() });
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
  const filhaTrabalha = () => {
    const ref = `refs/conducao/${CICLO_GIT}/T1/1`;
    f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
    f("checkout", "-q", "--detach", "refs/remotes/tentativa");
    escrever(filha, { [HOOK]: "export const um = 1;\n" });
    f("add", "-A");
    f("commit", "-q", "-m", `${CICLO_GIT}-F1/T1 — trabalho`);
    f("push", "-q", "origin", `HEAD:${ref}`);
  };
  return { maestra, g, cli, filhaTrabalha };
}

test("registro não gravado no trazer pergunta e mantém o trabalho", (t) => {
  const a = ambienteGit(t);
  assert.equal(a.cli("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1").status, 0);
  const aberta = a.cli("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto");
  assert.equal(aberta.status, 0, aberta.stderr + aberta.linhas.join("\n"));
  a.filhaTrabalha();

  // o gravador falha depois da trazida: a saída é pergunta com remédio, e o trabalho fica
  const s = trazer({
    repo: a.maestra,
    ciclo: CICLO_GIT,
    task: "T1",
    tentativa: 1,
    gravarRegistros: () => {
      throw new Error("disco cheio\nsegunda linha");
    },
  });
  assert.equal(s.acao, "perguntar", JSON.stringify(s));
  assert.equal(s.motivo, "consentimento-nao-gravado");
  assert.equal(s.remedio, "regravar-consentimentos");
  assert.equal(s.erro, "disco cheio");
  assert.equal(s.trazido, true);
  assert.ok(s.registro.endsWith(`${CICLO_GIT}/trazida/T1/1`), s.registro);
  assert.equal(a.g("show", `HEAD:${HOOK}`), "export const um = 1;");
  assert.deepEqual(c.lerConsentimentos(a.maestra, { ciclo: CICLO_GIT }), []);

  // o proximo não segue a task enquanto falta o registro
  const p1 = a.cli("proximo", "--entrada", "{}");
  assert.equal(p1.saida?.motivo, "consentimento-nao-gravado", p1.linhas.join("\n") + p1.stderr);
  assert.equal(p1.saida.task, "T1");
  assert.equal(p1.saida.remedio, "regravar-consentimentos");

  // o regravar fecha a falta, com o corpo da decisão do plano
  const r = a.cli("regravar-consentimentos", "T1", "--tentativa", "1");
  assert.equal(r.status, 0, r.stderr + r.linhas.join("\n"));
  assert.equal(r.saida.acao, "regravados");
  assert.equal(r.saida.consentimentos.length, 1);
  const lidos = c.lerConsentimentos(a.maestra, { ciclo: CICLO_GIT });
  assert.deepEqual(lidos.map((l) => [l.sha, l.caso, l.sim, l.caminhos, l.task]), [
    [r.saida.consentimentos[0].sha, c.CASOS.instrucaoDeclaradaEmOutputs, D1, [HOOK], "T1"],
  ]);

  // idempotente: a segunda vez não grava nada
  const antes = a.g("rev-parse", "HEAD");
  const r2 = a.cli("regravar-consentimentos", "T1", "--tentativa", "1");
  assert.equal(r2.status, 0, r2.stderr);
  assert.deepEqual(r2.saida.consentimentos, []);
  assert.equal(a.g("rev-parse", "HEAD"), antes);

  // fechada a falta, o proximo volta ao passo da conferência
  const p2 = a.cli("proximo", "--entrada", "{}");
  assert.notEqual(p2.saida?.motivo, "consentimento-nao-gravado", p2.linhas.join("\n"));
});

// ── T35 (D-VEGA37-37): conferir não conclui nem apaga a trazida com registro pendente ──

test("conferir com registro pendente pergunta e não apaga a trazida", (t) => {
  const a = ambienteGit(t);
  assert.equal(a.cli("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1").status, 0);
  const aberta = a.cli("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto");
  assert.equal(aberta.status, 0, aberta.stderr + aberta.linhas.join("\n"));
  a.filhaTrabalha();
  const s = trazer({
    repo: a.maestra,
    ciclo: CICLO_GIT,
    task: "T1",
    tentativa: 1,
    gravarRegistros: () => {
      throw new Error("disco cheio");
    },
  });
  assert.equal(s.motivo, "consentimento-nao-gravado", JSON.stringify(s));
  const trazida = s.registro;

  // conferir direto, pulando o regravar: pergunta, nada grava, a trazida fica
  const antes = a.g("rev-parse", "HEAD");
  const conferir = () => a.cli("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--sessao", "session_01TesteDaFilha");
  const r1 = conferir();
  assert.equal(r1.saida?.acao, "perguntar", r1.linhas.join("\n") + r1.stderr);
  assert.equal(r1.saida.motivo, "consentimento-nao-gravado");
  assert.equal(r1.saida.remedio, "regravar-consentimentos");
  assert.equal(r1.saida.task, "T1");
  assert.equal(r1.saida.faltam, 1);
  assert.equal(a.g("rev-parse", "HEAD"), antes);
  assert.equal(a.g("for-each-ref", "--format=%(refname)", trazida), trazida);
  assert.equal(a.g("log", "--format=%s", "--grep=^Conducao: T1 conferida", "HEAD"), "");

  // regravado o caso, a conferência grava e apaga a trazida
  assert.equal(a.cli("regravar-consentimentos", "T1", "--tentativa", "1").status, 0);
  const r2 = conferir();
  assert.equal(r2.saida?.acao, "conferida", r2.linhas.join("\n") + r2.stderr);
  assert.equal(a.g("for-each-ref", "--format=%(refname)", trazida), "");
});
