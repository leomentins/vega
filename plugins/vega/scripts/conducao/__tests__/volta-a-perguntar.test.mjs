/**
 * volta-a-perguntar.test.mjs — a parada aposentada volta a parar no primeiro desfazer ou a mando
 * do operador (VEGA-20 T20, AC-VEGA20-2, D5a).
 *
 * Desfazer = o revert da marca `aposentada` (corpo com `This reverts commit <sha>`) ou o não da
 * conferência do que ela trouxe (marca `rodada` da mesma task e tentativa, cujo corpo não é o
 * texto da própria calibração). A frase do operador entra pelo verbo `voltar-a-perguntar --motivo
 * <m> --recibo "<sessao> <evento>"`. Os três gravam no log o evento `volta`, que a calibração
 * (`calibracao.mjs`, T6) lê como recomeço do histórico do motivo: ele volta a `observacao` e para.
 *
 * Contraprova: sem a T20, o revert da marca não grava evento nenhum, o histórico do log segue
 * inteiro e o motivo de fixture sai `aposentada` de novo — os três primeiros testes ficam vermelhos.
 *
 * Mesmo arranjo de aposentadoria.test.mjs: origin bare, árvore da condutora, clone da filha, hooks
 * desligados, verbos de git pela CLI; o `proximo` e o `aposentar` em processo. O log vai para uma
 * pasta do teste (`ALTAIR_CONDUCAO_LOG_DIR`); o histórico da calibração junta as perguntas de
 * fixture com o que o log do teste tem, pela mesma `historicoDe` que o `proximo` usa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACAO_DA_VOLTA as VOLTA_DA_CALIBRACAO, consulta, historicoDe as historicoPuro, SEQUENCIAS_PARA_APOSENTAR } from "../calibracao.mjs";
/** O que define a parada no adaptador de fixture: o histórico o carrega, como `carregarHistorico`. */
const DEFINEM_DA_FIXTURE = Object.freeze(["**/hooks/gate-de-publicacao.js", "**/liberacao-da-publicacao.mjs", "db/scripts/**"]);
const historicoDe = (h) => historicoPuro({ definemAParada: DEFINEM_DA_FIXTURE, ...h });
import { aposentar, comAposentadoria, proximo, registrarVoltasDoRamo, voltarAPerguntar } from "../conducao.mjs";
import * as pergunta from "../pergunta.mjs";
import { TEXTO_DA_CALIBRACAO } from "../regras.mjs";
import { ACAO_DA_VOLTA, exigirVoltaAMando, voltasDoRamo } from "../verbos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-20-volta";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const MOTIVO = "conferencia-do-operador";
const RECIBO = "session_01abcDEF 0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0";

function task(id) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE20-1] (conferencia-do-operador)",
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

function canonico(tasks) {
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
    "**Largura do ciclo:** 3",
    "",
    "## 3. Tasks",
    "",
    "### F1 — fase F1 (**Modelo:** sonnet)",
    "",
    ...tasks,
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

function logDoTeste(t) {
  const pasta = mkdtempSync(path.join(tmpdir(), "conducao-volta-log-"));
  const antes = process.env.ALTAIR_CONDUCAO_LOG_DIR;
  process.env.ALTAIR_CONDUCAO_LOG_DIR = pasta;
  t.after(() => {
    if (antes === undefined) delete process.env.ALTAIR_CONDUCAO_LOG_DIR;
    else process.env.ALTAIR_CONDUCAO_LOG_DIR = antes;
    rmSync(pasta, { recursive: true, force: true });
  });
  return pasta;
}

/** O ciclo com a T1 trazida e a conferência do operador pendente. */
function trazidaPendente(t) {
  const log = logDoTeste(t);
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-volta-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const repo = path.join(raiz, "condutora");
  mkdirSync(repo);
  const g = gitEm(repo);
  g("init", "-q", "-b", "ciclo-teste");
  configurar(g);
  g("remote", "add", "origin", origin);
  escreverEm(repo, { "README.md": "fixture\n", [CAMINHO]: canonico([task("T1")]) });
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  g("push", "-q", "origin", "ciclo-teste");
  const filha = path.join(raiz, "filha");
  execFileSync("git", ["clone", "-q", origin, filha]);
  const f = gitEm(filha);
  configurar(f);
  const cli = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args, "--repo", repo, "--ciclo", CICLO], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ALTAIR_CONDUCAO_LOG_DIR: log },
    });
  const ok = (...args) => {
    const r = cli(...args);
    assert.equal(r.status, 0, `${args.join(" ")} → ${r.status}\n${r.stderr}\n${r.stdout}`);
    return JSON.parse(r.stdout.trim().split("\n").at(-1));
  };
  ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1", "--pergunta", "p-00000000000000a1");
  const p = proximo({ repo, ciclo: CICLO, entrada: {}, historico: historicoDe({ linhas: [], respostas: [] }) });
  assert.equal(p.acao, "abrir", JSON.stringify(p));
  const x = p.tarefas.find((y) => y.task === "T1");
  ok("abrir", "T1", "--tentativa", "1", "--nonce", x.nonce, "--modo-maestra", "auto");
  const ref = `refs/conducao/${CICLO}/T1/1`;
  f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
  f("checkout", "-q", "--detach", "refs/remotes/tentativa");
  escreverEm(filha, { "src/t1.mjs": "export const t1 = 1;\n" });
  f("add", "-A");
  f("commit", "-q", "-m", `${CICLO}-F1/T1 — parte da máquina`);
  f("push", "-q", "origin", `HEAD:${ref}`);
  ok("trazer", "T1", "--tentativa", "1", "--sessao", "filha-T1-1");
  return { repo, g, log, cli, ok };
}

let relogio = Date.parse("2026-11-02T12:00:00Z");
let contador = 0;

/** `k` paradas de fixture do motivo, todas com a mesma resposta: as linhas e as respostas. */
function perguntas(motivo, k, resposta = "a") {
  const linhas = [];
  const respostas = [];
  for (let i = 0; i < k; i++) {
    const decisao = `d-${(++contador).toString(16).padStart(16, "0")}`;
    const quando = new Date((relogio += 60_000)).toISOString();
    linhas.push({ v: 1, linha: "evento", procedencia: "intencao", acao: "pergunta", objetos: [], atributos: { motivo, decisao }, quando });
    respostas.push({ decisao, resposta, quando });
  }
  return { linhas, respostas };
}

/** As linhas do log do teste. */
function linhasDoLog(pasta) {
  const out = [];
  for (const a of readdirSync(pasta).filter((x) => x.endsWith(".jsonl")))
    for (const l of readFileSync(path.join(pasta, a), "utf8").split("\n").filter(Boolean)) out.push(JSON.parse(l));
  return out;
}
const voltasDoLog = (pasta) => linhasDoLog(pasta).filter((l) => l.linha === "evento" && l.acao === ACAO_DA_VOLTA);

/** O histórico da calibração: as perguntas de fixture mais o que o log do teste tem (a volta). */
const historicoCom = (fixture, pasta) => historicoDe({ linhas: [...fixture.linhas, ...linhasDoLog(pasta)], respostas: fixture.respostas });

/** A parada pura do `proximo`, para a próxima vez do motivo (outra task, sem marca no ramo). */
const parada = (motivo, tk = "T2") =>
  pergunta.perguntar({ acao: "perguntar", nonce: "0123456789abcdef", ciclo: CICLO, head: "a".repeat(40), motivo, fase: "F1", task: tk, tentativa: 1, opcoes: [{ id: "sim" }, { id: "nao" }] });
const plano = { tasks: [{ id: "T2", outputs: ["src/t2.mjs"], publicacao: [], protegida: [], simProprio: null, estacao: "servidor" }] };
/**
 * O repositório da decisão pura: um git com um commit vazio, sem declaração, e o adaptador é o do núcleo (o de
 * fixture sob `node --test`). Pasta que não é repositório faz o `lerTrazidas` da parada falhar e a
 * parada seguir, e o corpo exportado roda de uma pasta assim (VEGA-20 T46).
 */
const REPO_DE_TESTE = (() => {
  const d = mkdtempSync(path.join(tmpdir(), "conducao-repo-de-teste-"));
  execFileSync("git", ["init", "-q"], { cwd: d, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@local", "-c", "core.hooksPath=/dev/null", "commit", "-q", "--allow-empty", "-m", "vazio"], { cwd: d, stdio: "ignore" });
  process.on("exit", () => rmSync(d, { recursive: true, force: true }));
  return d;
})();

/** Aposenta a parada da T1 com o histórico de fixture e grava a marca. */
function aposentarT1(a, fixture) {
  const h = historicoCom(fixture, a.log);
  const p = proximo({ repo: a.repo, ciclo: CICLO, entrada: {}, historico: h });
  assert.equal(p.acao, "aposentada", JSON.stringify(p));
  const r = aposentar({ repo: a.repo, ciclo: CICLO, nonce: p.nonce, historico: h });
  assert.equal(r.acao, "aposentada-registrada", JSON.stringify(r));
  return r.sha;
}

/** O motivo volta a parar: a calibração do histórico com o log o põe em `observacao`, e a próxima parada dele para. */
function voltouAParar(a, fixture) {
  const h = historicoCom(fixture, a.log);
  const c = consulta(MOTIVO, h, { publicacao: [], protegida: [], simProprio: null, caminhos: ["src/t2.mjs"], tipo: MOTIVO, estacao: "servidor" });
  assert.equal(c.veredito, "para", JSON.stringify(c));
  assert.equal(c.degrau, "observacao", "o motivo volta ao degrau observacao");
  const p = parada(MOTIVO);
  assert.equal(comAposentadoria(p, { repo: REPO_DE_TESTE, plano, historico: h }), p, "a próxima parada do motivo para");
}

test("o evento volta é o que a calibração lê", () => {
  assert.equal(ACAO_DA_VOLTA, VOLTA_DA_CALIBRACAO);
});

test("revert de fixture da marca aposentada rearma: grava a volta e o motivo para na próxima vez", (t) => {
  const a = trazidaPendente(t);
  const fixture = perguntas(MOTIVO, SEQUENCIAS_PARA_APOSENTAR + 1);
  // Antes do desfazer, a próxima parada do motivo seguiria sozinha (a contraprova da volta).
  assert.equal(comAposentadoria(parada(MOTIVO), { repo: REPO_DE_TESTE, plano, historico: historicoCom(fixture, a.log) }).acao, "aposentada");
  const marca = aposentarT1(a, fixture);
  assert.deepEqual(registrarVoltasDoRamo(a.repo, CICLO), [], "sem desfazer, nenhuma volta");

  // A marca é vazia: `git revert` não a desfaz sozinho; o commit leva a linha que o revert escreve,
  // aqui com o sha abreviado de `revert.reference` (o caminho real lê o git, não só a função pura).
  a.g("commit", "-q", "--allow-empty", "-m", `Revert "Conducao: T1 aposentada ${MOTIVO}"`, "-m", `This reverts commit ${marca.slice(0, 9)} (Conducao: T1 aposentada ${MOTIVO}, 2026-11-22).`);
  const revert = a.g("rev-parse", "HEAD");

  // O proximo grava a volta antes de olhar o histórico.
  proximo({ repo: a.repo, ciclo: CICLO, entrada: {}, historico: historicoCom(fixture, a.log) });
  const [v, ...resto] = voltasDoLog(a.log);
  assert.ok(v, "o evento volta está no log");
  assert.equal(resto.length, 0);
  assert.equal(v.procedencia, "registrado");
  assert.equal(v.atributos.motivo, MOTIVO);
  assert.equal(v.atributos.desfecho, "revert");
  assert.equal(v.atributos.sha, revert);
  // Repetir não duplica.
  registrarVoltasDoRamo(a.repo, CICLO);
  assert.equal(voltasDoLog(a.log).length, 1, "a volta repetida tem a mesma chave");

  voltouAParar(a, fixture);
});

test("o não da conferência do que a aposentadoria trouxe rearma; o não da própria calibração não", (t) => {
  const a = trazidaPendente(t);
  const fixture = perguntas(MOTIVO, SEQUENCIAS_PARA_APOSENTAR + 1);
  aposentarT1(a, fixture);
  // O não que a própria aposentadoria aplicaria: o texto é o da calibração, e não volta.
  const r = a.cli("registrar-conferencia", "T1", "--rodada", "nao", "--operador", `${TEXTO_DA_CALIBRACAO}: ${MOTIVO} (1 iguais)`);
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  assert.deepEqual(registrarVoltasDoRamo(a.repo, CICLO), []);
  assert.equal(voltasDoLog(a.log).length, 0);
  // Pura: a rodada do operador depois da marca é a rejeição.
  const voltas = voltasDoRamo({
    aposentadas: [{ sha: "a1", task: "T1", motivo: MOTIVO, tentativa: 1 }],
    commits: [
      { sha: "a1", subject: `Conducao: T1 aposentada ${MOTIVO}`, corpo: "", quando: "2026-11-22T01:00:00Z" },
      { sha: "r0", subject: "Conducao: T1 tentativa 2 rodada", corpo: "Não, pelo operador: outra tentativa", quando: "2026-11-22T01:01:00Z" },
      { sha: "r1", subject: "Conducao: T1 tentativa 1 rodada", corpo: "Não, pelo operador: não ficou bom", quando: "2026-11-22T01:02:00Z" },
    ],
    textoDaCalibracao: TEXTO_DA_CALIBRACAO,
  });
  assert.deepEqual(voltas, [{ motivo: MOTIVO, task: "T1", tentativa: 1, desfecho: "rejeicao", sha: "r1", desfeita: "a1", quando: "2026-11-22T01:02:00.000Z" }]);
  // O não do operador que só cita o texto da calibração no meio é rejeição.
  const citado = voltasDoRamo({
    aposentadas: [{ sha: "a1", task: "T1", motivo: MOTIVO, tentativa: 1 }],
    commits: [
      { sha: "a1", subject: `Conducao: T1 aposentada ${MOTIVO}`, corpo: "", quando: "2026-11-22T01:00:00Z" },
      { sha: "r1", subject: "Conducao: T1 tentativa 1 rodada", corpo: `Não, pelo operador: não gostei do "${TEXTO_DA_CALIBRACAO}"`, quando: "2026-11-22T01:02:00Z" },
    ],
    textoDaCalibracao: TEXTO_DA_CALIBRACAO,
  });
  assert.equal(citado.length, 1);
});

test("revert de sha abreviado, de várias marcas no mesmo commit, e de relógio atrasado: todos rearmam, nunca antes da marca", () => {
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const voltas = voltasDoRamo({
    aposentadas: [
      { sha: A, task: "T1", motivo: "m-um", tentativa: 1 },
      { sha: B, task: "T2", motivo: "m-dois", tentativa: 1 },
    ],
    commits: [
      { sha: A, subject: "Conducao: T1 aposentada m-um", corpo: "", quando: "2026-11-22T02:00:00Z" },
      { sha: B, subject: "Conducao: T2 aposentada m-dois", corpo: "", quando: "2026-11-22T02:01:00Z" },
      { sha: "c".repeat(40), subject: "Revert duas", corpo: `This reverts commit ${A.slice(0, 8)}.\nThis reverts commit ${B}.`, quando: "2026-11-21T00:00:00Z" },
    ],
    textoDaCalibracao: TEXTO_DA_CALIBRACAO,
  });
  assert.deepEqual(voltas.map((v) => [v.motivo, v.desfecho, v.quando]), [
    ["m-um", "revert", "2026-11-22T02:00:00.000Z"],
    ["m-dois", "revert", "2026-11-22T02:01:00.000Z"],
  ]);
});

test("a rejeição do operador na conferência grava a volta na próxima parada do motivo, e ele para", (t) => {
  const a = trazidaPendente(t);
  const fixture = perguntas(MOTIVO, SEQUENCIAS_PARA_APOSENTAR + 1);
  aposentarT1(a, fixture);
  a.ok("registrar-conferencia", "T1", "--rodada", "nao", "--operador", "não ficou bom, refaz");
  const rodada = a.g("rev-parse", "HEAD");
  // O não abre a tentativa 2 (o proximo sai `abrir`, sem parada): a volta entra quando o motivo
  // volta a parar, antes do histórico, com o horário da rodada.
  assert.notEqual(proximo({ repo: a.repo, ciclo: CICLO, entrada: {}, historico: historicoCom(fixture, a.log) }).acao, "aposentada");
  comAposentadoria(parada(MOTIVO), { repo: a.repo, plano, historico: historicoDe({ linhas: [], respostas: [] }) });
  const [v] = voltasDoLog(a.log);
  assert.ok(v, "o evento volta está no log");
  assert.equal(v.atributos.desfecho, "rejeicao");
  assert.equal(v.atributos.sha, rodada);
  voltouAParar(a, fixture);
});

test("o verbo voltar-a-perguntar rearma, pela CLI, sem comando para o operador", (t) => {
  const a = trazidaPendente(t);
  const fixture = perguntas(MOTIVO, SEQUENCIAS_PARA_APOSENTAR + 1);
  assert.equal(comAposentadoria(parada(MOTIVO), { repo: REPO_DE_TESTE, plano, historico: historicoCom(fixture, a.log) }).acao, "aposentada");
  // O motivo que nunca parou não tem volta: o erro de digitação recusa, sem gravar.
  const fantasma = a.cli("voltar-a-perguntar", "--motivo", "conferencia-do-operdor", "--recibo", RECIBO);
  assert.equal(fantasma.status, 1, fantasma.stdout);
  assert.match(fantasma.stderr, /motivo-desconhecido/);
  // A parada do motivo no log (o proximo pela CLI a grava), e então a volta.
  assert.equal(a.cli("proximo").status, 0);
  const s = a.ok("voltar-a-perguntar", "--motivo", MOTIVO, "--recibo", RECIBO);
  assert.equal(s.acao, "volta-registrada", JSON.stringify(s));
  assert.equal(s.desfecho, "a-mando");
  const [v] = voltasDoLog(a.log);
  assert.ok(v, "o evento volta está no log");
  assert.equal(v.procedencia, "observado");
  assert.equal(v.atributos.motivo, MOTIVO);
  assert.equal(v.atributos.desfecho, "a-mando");
  assert.equal(v.atributos.recibo, RECIBO.replace(" ", "/"));
  assert.equal(a.ok("voltar-a-perguntar", "--motivo", MOTIVO, "--recibo", RECIBO).acao, "volta-ja-registrada", "o mesmo recibo de novo não grava");
  assert.equal(voltasDoLog(a.log).length, 1);
  voltouAParar(a, fixture);
});

test("o motivo rearmado só volta a se aposentar com o dobro das sequências depois da volta", (t) => {
  logDoTeste(t);
  const antes = perguntas(MOTIVO, SEQUENCIAS_PARA_APOSENTAR + 1);
  const volta = { v: 1, linha: "evento", procedencia: "observado", acao: ACAO_DA_VOLTA, objetos: [], atributos: { motivo: MOTIVO, desfecho: "a-mando" }, quando: new Date((relogio += 60_000)).toISOString() };
  const poucas = perguntas(MOTIVO, 4);
  const h = historicoDe({ linhas: [...antes.linhas, volta, ...poucas.linhas], respostas: [...antes.respostas, ...poucas.respostas] });
  assert.equal(comAposentadoria(parada(MOTIVO), { repo: REPO_DE_TESTE, plano, historico: h }).acao, "perguntar", "4 depois da volta: para");
  const mais = perguntas(MOTIVO, 3);
  const h2 = historicoDe({ linhas: [...antes.linhas, volta, ...poucas.linhas, ...mais.linhas], respostas: [...antes.respostas, ...poucas.respostas, ...mais.respostas] });
  assert.equal(comAposentadoria(parada(MOTIVO), { repo: REPO_DE_TESTE, plano, historico: h2 }).acao, "aposentada", "7 depois da volta: o histórico novo calibra");
});

test("voltar-a-perguntar recusa sem motivo ou sem recibo", (t) => {
  const pasta = logDoTeste(t);
  assert.throws(() => exigirVoltaAMando({ motivo: undefined, recibo: RECIBO }), /--motivo/);
  assert.throws(() => exigirVoltaAMando({ motivo: MOTIVO, recibo: undefined }), (e) => e.codigo === "recibo-ausente");
  assert.throws(() => exigirVoltaAMando({ motivo: MOTIVO, recibo: "so-a-sessao" }), (e) => e.codigo === "recibo-ausente");
  assert.throws(() => exigirVoltaAMando({ motivo: "Motivo Livre", recibo: RECIBO }), /--motivo/);
  assert.throws(() => exigirVoltaAMando({ motivo: MOTIVO, recibo: `${"s".repeat(100)} e` }), (e) => e.codigo === "recibo-ausente", "recibo acima do token do log");
  assert.throws(() => voltarAPerguntar({ ciclo: CICLO, motivo: MOTIVO, recibo: "", decl: { pastaDoLog: pasta } }), (e) => e.codigo === "recibo-ausente");
  assert.equal(linhasDoLog(pasta).length, 0, "a recusa não grava nada");
});
