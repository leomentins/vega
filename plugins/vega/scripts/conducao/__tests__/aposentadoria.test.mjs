/**
 * aposentadoria.test.mjs — a parada de resposta constante se aposenta na condução e avisa no
 * relato (VEGA-20 T19, AC-VEGA20-1, AC-VEGA20-3, D5a, D-VEGA20-18).
 *
 * O `proximo` passa a parada que emitiria, com a instância da task do plano, a `aposentado()` da
 * T6. Calibrado ⇒ a ação `aposentada`, com a resposta constante, a opção que ela escolhe e a linha
 * `seguiu sozinha: <motivo> (<n> iguais)`; o evento `aposentada` passa a allowlist do log com
 * `motivo`, `resposta`, `n`, `sequencias`, `decisoes` e `por: calibracao`; o `aposentar --nonce`
 * grava o commit com o trailer `Conducao-Aposentada`, e o `retomar` devolve a linha no relato.
 * Publicação, caminho clínico e o motivo de publicação param, qualquer que seja o histórico.
 *
 * O motivo de fixture é `conferencia-do-operador`, que o `proximo` ainda emite depois da T43; o
 * `canonico-do-ciclo` o trazer deixou de emitir (D-VEGA20-26) e não entra aqui.
 *
 * Contraprova: sem a T19, o `proximo` com o histórico que calibra sai `perguntar
 * conferencia-do-operador`, como hoje, e o primeiro teste fica vermelho.
 *
 * Mesmo arranjo de conferencia-operador.test.mjs: origin bare, árvore da maestra, clone da filha,
 * hooks desligados, verbos de git pela CLI; o `proximo` e o `aposentar` em processo, com o
 * histórico de fixture. O log vai para uma pasta do teste (`ALTAIR_CONDUCAO_LOG_DIR`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { historicoDe as historicoPuro, SEQUENCIAS_PARA_APOSENTAR, vetoDaInstancia } from "../calibracao.mjs";
/** O que define a parada no adaptador de fixture: o histórico o carrega, como `carregarHistorico`. */
const DEFINEM_DA_FIXTURE = Object.freeze(["**/hooks/gate-de-publicacao.js", "**/liberacao-da-publicacao.mjs", "db/scripts/**"]);
const historicoDe = (h) => historicoPuro({ definemAParada: DEFINEM_DA_FIXTURE, ...h });
import { aposentar, comAposentadoria, lerAposentadas, proximo, retomar } from "../conducao.mjs";
import * as logEventos from "../log-eventos.mjs";
import * as pergunta from "../pergunta.mjs";
import { acaoDaAposentadoria, instanciaDaParada, opcaoDaResposta } from "../regras.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
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
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-19-aposentadoria";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const MOTIVO = "conferencia-do-operador";
/** Caminho protegido do projeto de teste (`caminhosProtegidos` de fixtures/projeto-de-teste). */
const CLINICO = "app/telas/fichas/a.tsx";

function task(id, { satisfies = "[AC-TESTE19-1] (conferencia-do-operador)", outputs = `\`src/${id.toLowerCase()}.mjs\` (create)` } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    `- **satisfies:** ${satisfies}`,
    "- **Inputs:** `README.md`",
    `- **Outputs:** ${outputs}`,
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

function gitEm(dir) {
  return (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

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

/** O log do teste: a pasta final, fora do estado da estação e das outras suítes. */
function logDoTeste(t) {
  const pasta = mkdtempSync(path.join(tmpdir(), "conducao-aposentadoria-log-"));
  const antes = process.env.ALTAIR_CONDUCAO_LOG_DIR;
  process.env.ALTAIR_CONDUCAO_LOG_DIR = pasta;
  t.after(() => {
    if (antes === undefined) delete process.env.ALTAIR_CONDUCAO_LOG_DIR;
    else process.env.ALTAIR_CONDUCAO_LOG_DIR = antes;
    rmSync(pasta, { recursive: true, force: true });
  });
  return pasta;
}

/** O ciclo com a T1 trazida e a conferência do operador pendente: a parada que o `proximo` emite. */
function trazidaPendente(t, outputs) {
  const log = logDoTeste(t);
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-aposentadoria-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const maestra = path.join(raiz, "maestra");
  mkdirSync(maestra);
  const g = gitEm(maestra);
  g("init", "-q", "-b", "ciclo-teste");
  configurar(g);
  g("remote", "add", "origin", origin);
  escreverEm(maestra, { "README.md": "fixture\n", [CAMINHO]: canonico([task("T1", outputs ? { outputs } : {})]) });
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  g("push", "-q", "origin", "ciclo-teste");
  const filha = path.join(raiz, "filha");
  execFileSync("git", ["clone", "-q", origin, filha]);
  const f = gitEm(filha);
  configurar(f);
  const ok = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", maestra, "--ciclo", CICLO], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ALTAIR_CONDUCAO_LOG_DIR: log },
    });
    assert.equal(r.status, 0, `${args.join(" ")} → ${r.status}\n${r.stderr}\n${r.stdout}`);
    return JSON.parse(r.stdout.trim().split("\n").at(-1));
  };
  ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1", "--pergunta", "p-00000000000000a1");
  const p = proximo({ repo: maestra, ciclo: CICLO, entrada: {}, historico: semHistorico() });
  assert.equal(p.acao, "abrir", JSON.stringify(p));
  const x = p.tarefas.find((y) => y.task === "T1");
  ok("abrir", "T1", "--tentativa", "1", "--nonce", x.nonce, "--modo-maestra", "auto");
  const ref = `refs/conducao/${CICLO}/T1/1`;
  f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
  f("checkout", "-q", "--detach", "refs/remotes/tentativa");
  const caminho = outputs ? CLINICO : "src/t1.mjs";
  escreverEm(filha, { [caminho]: "export const t1 = 1;\n" });
  f("add", "-A");
  f("commit", "-q", "-m", `${CICLO}-F1/T1 — parte da máquina`);
  f("push", "-q", "origin", `HEAD:${ref}`);
  ok("trazer", "T1", "--tentativa", "1", "--sessao", "filha-T1-1");
  return { repo: maestra, g, log };
}

let relogio = Date.parse("2026-11-02T12:00:00Z");
let contador = 0;
const agora = () => new Date((relogio += 60_000)).toISOString();

/** Histórico de fixture: `k` paradas do motivo, todas com a mesma resposta. */
function historico(motivo, k, resposta = "a") {
  const linhas = [];
  const respostas = [];
  for (let i = 0; i < k; i++) {
    const decisao = `d-${(++contador).toString(16).padStart(16, "0")}`;
    const quando = agora();
    linhas.push({ v: 1, linha: "evento", procedencia: "intencao", acao: "pergunta", objetos: [], atributos: { motivo, decisao }, quando });
    respostas.push({ decisao, resposta, quando });
  }
  return historicoDe({ linhas, respostas });
}
const semHistorico = () => historicoDe({ linhas: [], respostas: [] });
const CALIBRADO = () => historico(MOTIVO, SEQUENCIAS_PARA_APOSENTAR + 1);

/** Os eventos de uma ação no log do teste. */
function eventosDoLog(pasta, acao) {
  const out = [];
  for (const a of readdirSync(pasta).filter((x) => x.endsWith(".jsonl")))
    for (const l of readFileSync(path.join(pasta, a), "utf8").split("\n").filter(Boolean)) {
      const o = JSON.parse(l);
      if (o.linha === "evento" && o.acao === acao) out.push(o);
    }
  return out;
}

test("o motivo calibrado segue sozinho pelo proximo, grava o evento aposentada e deixa a linha no relato", (t) => {
  const a = trazidaPendente(t);
  // Sem histórico, a parada de hoje.
  const parada = proximo({ repo: a.repo, ciclo: CICLO, entrada: {}, historico: semHistorico() });
  assert.equal(parada.acao, "perguntar", JSON.stringify(parada));
  assert.equal(parada.motivo, MOTIVO);

  const h = CALIBRADO();
  const p = proximo({ repo: a.repo, ciclo: CICLO, entrada: {}, historico: h });
  assert.equal(p.acao, "aposentada", JSON.stringify(p));
  assert.equal(p.motivo, MOTIVO);
  assert.equal(p.task, "T1");
  assert.equal(p.nonce, parada.nonce, "a aposentadoria fala da mesma parada");
  assert.equal(p.resposta, "a");
  assert.deepEqual(p.opcao.id, "sim", "a letra a é a primeira opção da parada");
  assert.equal(p.n, 1);
  assert.equal(p.sequencias, SEQUENCIAS_PARA_APOSENTAR);
  assert.equal(p.por, "calibracao");
  assert.equal(p.relato, `seguiu sozinha: ${MOTIVO} (1 iguais)`);
  assert.equal(p.trailer, `Conducao-Aposentada: ${MOTIVO}`);
  assert.equal(p.comando, `aposentar --nonce ${parada.nonce}`);
  assert.equal(p.decisoes.split("+").length, SEQUENCIAS_PARA_APOSENTAR + 1);
  assert.match(p.decisao, /^d-[0-9a-f]{16}$/);
  assert.equal(p.mensagem, undefined, "nunca uma mensagem própria");

  // O evento `aposentada` passa a allowlist do log com tudo o que a calibração diz.
  logEventos.registrar(p, { procedencia: "intencao", pasta: a.log });
  const [ev] = eventosDoLog(a.log, "aposentada");
  assert.ok(ev, "o evento aposentada está no log");
  for (const [k, v] of Object.entries({ motivo: MOTIVO, resposta: "a", n: 1, sequencias: SEQUENCIAS_PARA_APOSENTAR, decisoes: p.decisoes, por: "calibracao", decisao: p.decisao }))
    assert.equal(ev.atributos[k], v, `atributo ${k}`);
  assert.equal(eventosDoLog(a.log, "pergunta").length, 0, "a parada aposentada não vira pergunta");

  // O `aposentar` refaz o proximo e grava o commit com o trailer.
  const r = aposentar({ repo: a.repo, ciclo: CICLO, nonce: p.nonce, historico: h });
  assert.equal(r.acao, "aposentada-registrada", JSON.stringify(r));
  assert.equal(a.g("log", "-1", "--format=%s"), `Conducao: T1 aposentada ${MOTIVO}`);
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Aposentada,valueonly=true)"), MOTIVO);
  assert.deepEqual(
    lerAposentadas(a.repo).map((x) => [x.task, x.motivo, x.nonce, x.resposta, x.iguais, x.tentativa]),
    [["T1", MOTIVO, p.nonce, "a", 1, 1]],
  );
  // O relato que a condutora já entrega traz a linha.
  const rel = retomar({ repo: a.repo, ciclo: CICLO, lerCi: () => null });
  assert.deepEqual(rel.aposentadas.map((x) => x.relato), [`seguiu sozinha: ${MOTIVO} (1 iguais)`]);

  // Aposentadoria já gravada e a parada de volta: para, o operador decide.
  const de = proximo({ repo: a.repo, ciclo: CICLO, entrada: {}, historico: h });
  assert.equal(de.acao, "perguntar", JSON.stringify(de));
  assert.equal(de.aposentadaAplicada, true);
});

test("o motivo sem histórico suficiente para", (t) => {
  const a = trazidaPendente(t);
  const p = proximo({ repo: a.repo, ciclo: CICLO, entrada: {}, historico: historico(MOTIVO, 4) });
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, MOTIVO);
  // O aposentar não grava sem a ação.
  assert.throws(() => aposentar({ repo: a.repo, ciclo: CICLO, nonce: p.nonce, historico: historico(MOTIVO, 4) }), /aposentada/);
});

test("conferencia-do-operador calibrado sobre task de caminho clínico para pelo proximo, sem evento aposentada", (t) => {
  const a = trazidaPendente(t, `\`${CLINICO}\` (create)`);
  const p = proximo({ repo: a.repo, ciclo: CICLO, entrada: {}, historico: CALIBRADO() });
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, MOTIVO);
  logEventos.registrar(p, { procedencia: "intencao", pasta: a.log });
  assert.equal(eventosDoLog(a.log, "aposentada").length, 0);
});

// ── a decisão, pura ─────────────────────────────────────────────────────────

/** A parada do `proximo`, pelo construtor. */
const parada = (motivo, tk = "T1") =>
  pergunta.perguntar({ acao: "perguntar", nonce: "0123456789abcdef", ciclo: CICLO, head: "a".repeat(40), motivo, fase: "F1", task: tk, tentativa: 1, opcoes: [{ id: "sim" }, { id: "nao" }] });
const plano = (t) => ({ tasks: [{ id: "T1", outputs: ["src/t1.mjs"], publicacao: [], protegida: [], simProprio: null, estacao: "servidor", ...t }] });

test("conferencia-do-operador calibrado sobre a task de regras.test.mjs:130 (protegida, caminho-clinico) para", () => {
  const clinica = plano({ outputs: ["apps/x/labs/a.tsx"], protegida: ["apps/x/labs/a.tsx"], simProprio: "caminho-clinico" });
  const p = parada(MOTIVO);
  assert.equal(comAposentadoria(p, { repo: REPO_DE_TESTE, plano: clinica, historico: CALIBRADO() }), p);
});

test("o motivo de publicação para mesmo calibrado, e a task que publica também", () => {
  const motivo = "publicacao-pendente";
  const p = parada(motivo);
  assert.equal(comAposentadoria(p, { repo: REPO_DE_TESTE, plano: plano(), historico: historico(motivo, SEQUENCIAS_PARA_APOSENTAR + 1) }), p);
  const q = parada(MOTIVO);
  assert.equal(comAposentadoria(q, { repo: REPO_DE_TESTE, plano: plano({ publicacao: ["db push"] }), historico: CALIBRADO() }), q);
  assert.equal(comAposentadoria(q, { repo: REPO_DE_TESTE, plano: plano({ estacao: "condutora" }), historico: CALIBRADO() }), q, "estação condutora");
});

test("parada sem task do plano, ou resposta sem opção, segue parando", () => {
  const p = parada(MOTIVO, "T9");
  assert.equal(instanciaDaParada(p, plano()), null);
  assert.equal(comAposentadoria(p, { repo: REPO_DE_TESTE, plano: plano(), historico: CALIBRADO() }), p);
  assert.deepEqual(opcaoDaResposta(parada(MOTIVO), "b"), { id: "nao" });
  assert.equal(opcaoDaResposta(parada(MOTIVO), "c"), null);
  assert.equal(opcaoDaResposta(parada(MOTIVO), "a+b"), null);
  assert.equal(acaoDaAposentadoria(parada(MOTIVO), { veredito: "aposentado", resposta: "livre:p-1", n: 1, sequencias: 6 }), null);
  assert.equal(acaoDaAposentadoria(parada(MOTIVO), { veredito: "para", resposta: null }), null);
});

test("canonico-do-ciclo não é vetado pelo proximo antes de aposentado() (D-VEGA20-18)", () => {
  const motivo = "canonico-do-ciclo";
  const p = parada(motivo);
  const a = comAposentadoria(p, { repo: REPO_DE_TESTE, plano: plano(), historico: historico(motivo, SEQUENCIAS_PARA_APOSENTAR + 1) });
  assert.equal(a.acao, "aposentada");
  assert.equal(a.motivo, motivo);
});


test("o arquivo que define a parada para mesmo calibrado, declarado ou vindo de fora dos Outputs (D-VEGA20-26)", () => {
  const p = parada(MOTIVO);
  // Caminhos neutros: os do motor e os que o adaptador de fixture declara em `definemAParada`.
  for (const arquivo of [".claude/hooks/gate-de-publicacao.js", ".vega/projeto.mjs", ".claude/hooks/lib/liberacao-da-publicacao.mjs", "db/scripts/publicar.mjs"]) {
    assert.equal(comAposentadoria(p, { repo: REPO_DE_TESTE, plano: plano({ outputs: [arquivo] }), historico: CALIBRADO() }), p, arquivo);
  }
  const deFora = instanciaDaParada(p, plano(), { extras: [".claude/hooks/gate-de-publicacao.js"] });
  assert.ok(deFora.caminhos.includes(".claude/hooks/gate-de-publicacao.js"));
  assert.equal(vetoDaInstancia(MOTIVO, deFora, { definemAParada: DEFINEM_DA_FIXTURE }), "define-a-parada");
  // A mesma parada, sem o arquivo que define a parada, segue sozinha.
  assert.equal(comAposentadoria(p, { repo: REPO_DE_TESTE, plano: plano(), historico: CALIBRADO() }).acao, "aposentada");
});

test("task sem Outputs legíveis para: sem caminhos não há o que conferir", () => {
  const p = parada(MOTIVO);
  assert.equal(instanciaDaParada(p, plano({ outputs: [] })), null);
  assert.equal(comAposentadoria(p, { repo: REPO_DE_TESTE, plano: plano({ outputs: [] }), historico: CALIBRADO() }), p);
});

test("a opção que pede o texto do operador recebe o da calibração, nunca um texto inventado", () => {
  const a = comAposentadoria(parada(MOTIVO), { repo: REPO_DE_TESTE, plano: plano(), historico: CALIBRADO() });
  assert.equal(a.textoDeQuemResponde, `seguiu sozinha pela calibração: ${MOTIVO} (1 iguais)`);
});
