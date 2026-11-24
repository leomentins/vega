/**
 * conducao-sim-da-fase.test.mjs — o sim de Rita preso à fase (F4.17 do
 * ATRM-51, ruling de 23/10/2026).
 *
 * O sim gravado na fase cobre as tasks sensíveis dela em toda tentativa,
 * enquanto o plano congelado nele valer. O verbo `autorizar-fase` foi
 * aposentado (D-VEGA29-14): recusa e aponta o `autorizar-ciclo`, que é a
 * única forma de dar o sim; as marcas de fase do histórico seguem lidas. Re-plano de ruling do `/intra-plan`
 * sem task mudando de classe e sem trazida pendente herda a autorização
 * (`herdar-autorizacao`); qualquer outra mudança de plano pergunta. A
 * primeira publicação do ciclo pede o sim (`simParaPublicar`); ele grava o
 * caso `publicacao-do-ciclo`, que cobre as seguintes do mesmo ciclo
 * (D-VEGA37-52).
 *
 * Hooks desligados no repo de teste (core.hooksPath=/dev/null); origin bare
 * em pasta temporária, porque o verbo da herança empurra a cópia do ciclo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decidir, estadoDasTasks, rulingDoReplano } from "../conducao.mjs";
import { lerPlano } from "../ler-plano.mjs";
import { CASOS, gateDaMarcaDeOrigem, gravarCasosHerdados, lerConsentimentos, pedidoDeCaso, seguePorRepeticao } from "../consentimento.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const RULING = `${CICLO}-F1/D-TESTE1-7 — re-plano de T3: depende da T1`;

function task(id, { inputs = "`README.md`", steps = "faz", estacao = "servidor", fase = "F1" } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
    `- **Inputs:** ${inputs}`,
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    `- **Estação:** ${estacao}`,
    "- **Independente:** sim",
    `- **Steps:** ${steps}`,
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

function canonico(fases, largura = 1) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-10-23",
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
    ...fases.map(({ id, tasks }) => [`### ${id} — fase ${id} (**Modelo:** sonnet)`, "", ...tasks].join("\n")),
    "## 4. Pronto",
    "",
  ].join("\n");
}

/** F1 com a T1 sensível (publica por `db push`) e T2/T3 comuns; F2 com a T4. */
const PADRAO = () =>
  canonico([
    { id: "F1", tasks: [task("T1", { steps: "aplica a migration com `db-publish.mjs … db push`\n- **Publicação:** sim, aditiva" }), task("T2"), task("T3")] },
    { id: "F2", tasks: [task("T4", { fase: "F2" })] },
  ]);

function novoRepo(t, texto = PADRAO()) {
  const raiz = pastaTemporaria("conducao-sim-fase-");
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
  writeFileSync(path.join(dir, CAMINHO), texto);
  g("add", CAMINHO);
  g("commit", "-q", "-m", "plano");
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  const blob = () => g("rev-parse", `HEAD:${CAMINHO}`);
  const autorizar = (fase) => {
    vazio(`Conducao: ${fase} autorizada`, "sim do Rita, no turno dele", `Conducao-Plano: ${blob()}`);
    return g("rev-parse", "HEAD");
  };
  /** Re-plano: o canonico com `de` trocado por `para`, num commit com `subject`. */
  const replanejar = (de, para, subject) => {
    const atual = readFileSync(path.join(dir, CAMINHO), "utf8");
    assert.ok(atual.includes(de), de);
    writeFileSync(path.join(dir, CAMINHO), atual.replace(de, para));
    g("commit", "-q", "-am", subject);
    return g("rev-parse", "HEAD");
  };
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  const proximo = (entrada) => {
    const r = cli("proximo", ...(entrada ? ["--entrada", JSON.stringify(entrada)] : []));
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  /** Tentativa em voo: marcador fora do ramo + referência local, como o `abrir` grava. */
  const emVoo = (id, n, nonceX) => {
    const marcador = g("commit-tree", g("rev-parse", "HEAD^{tree}"), "-p", g("rev-parse", "HEAD"), "-m", `Conducao: abrir ${id} tentativa ${n} nonce ${nonceX}`);
    g("update-ref", `refs/conducao-local/${CICLO}/${id}/${n}`, marcador);
  };
  return { dir, g, vazio, blob, autorizar, replanejar, cli, proximo, emVoo };
}


/**
 * O canonico com a restrição `` `replano` → pergunta `` no §1.5: devolve o re-plano à pergunta
 * `plano-mudou`, que o ruling de 23/11/2026 tirou do caminho padrão (pré-autorização,
 * `replano-preautorizado.test.mjs`). Os testes de forma da pergunta rodam sob ela.
 */
const RESTRITO = (txt) => txt.replace("### 1.5 Modo de Execução\n", "### 1.5 Modo de Execução\n\n**Consentimentos:** `replano` → pergunta\n");
const DEP_T3 = ["- **Inputs:** `README.md`\n- **Outputs:** `src/t3.mjs`", "- **Inputs:** T1\n- **Outputs:** `src/t3.mjs`"];

// ── 1. o sim da fase cobre a task sensível em toda tentativa ─────────────────

test("fase autorizada com task sensivel abre sem pergunta na tentativa 1 e na tentativa 3", (t) => {
  const r = novoRepo(t);
  const aut = r.autorizar("F1");
  const a1 = r.proximo();
  assert.equal(a1.acao, "abrir", JSON.stringify(a1));
  assert.deepEqual(a1.tarefas.map((x) => [x.task, x.tentativa, x.classe]), [["T1", 1, "sensivel"]]);
  assert.deepEqual(a1.cobertasPelaFase, { autorizacao: aut, tasks: ["T1"] });

  // Tentativas 1 e 2 caíram sem contar falha (reinício da ponte): a 3ª é nonce novo, e não pergunta.
  for (const n of [1, 2])
    r.vazio(`Conducao: T1 tentativa ${n} falhou`, `Conducao-Task: T1\ncoberta-por-reinicio: sim\nConducao-Nonce: n-${n}`);
  const a3 = r.proximo();
  assert.equal(a3.acao, "abrir", JSON.stringify(a3));
  assert.deepEqual(a3.tarefas.map((x) => [x.task, x.tentativa]), [["T1", 3]]);
  assert.notEqual(a3.tarefas[0].nonce, a1.tarefas[0].nonce);
  assert.deepEqual(a3.cobertasPelaFase.tasks, ["T1"]);
});

// ── 2. sem autorização da fase, pergunta ──────────────────────────────────────

test("fase nao autorizada pede o sim do ciclo, e task que só acrescenta fora da fase da ultima autorizacao sai coberta (D18a)", (t) => {
  const r = novoRepo(t);
  const p = r.proximo();
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "autorizar-ciclo");

  // F1 autorizada e, depois, F2: a última autorização não é da fase em curso. A T1 só
  // acrescenta (migration sem DROP nem RENAME): o sim em vigor a cobre, sem perguntar.
  r.autorizar("F1");
  r.autorizar("F2");
  const a = r.proximo();
  assert.equal(a.acao, "abrir", JSON.stringify(a));
  assert.equal(a.cobertasPelaFase, undefined);
  assert.deepEqual(a.cobertasPeloCiclo?.tasks, ["T1"]);
});

// ── 2-bis. o verbo do sim por fase foi aposentado (D-VEGA29-14) ──────────────

test("autorizar-fase recusa, aponta o autorizar-ciclo e nao grava marca nenhuma", (t) => {
  const r = novoRepo(t);
  const antes = r.g("rev-parse", "HEAD");
  const x = r.cli("autorizar-fase", "F1", "--sim", "sim, pode tocar a F1");
  assert.equal(x.status, 1, x.stderr);
  assert.match(x.stderr, /verbo-aposentado: autorizar-fase foi aposentado: o sim vale para o ciclo inteiro/);
  assert.match(x.stderr, /autorizar-ciclo F<n> --sim <texto>/);
  assert.doesNotMatch(x.stderr, /D-[A-Z]+[0-9]+-[0-9]+/, "a mensagem diz a regra, sem id de decisão");
  assert.equal(r.g("rev-parse", "HEAD"), antes, "nada gravado");
  assert.equal(r.g("for-each-ref", "refs/"), r.g("for-each-ref", "refs/heads/", "refs/remotes/"), "nem cópia nem referência nova");
  // Quem pergunta pede o sim do ciclo, nunca o da fase.
  assert.equal(r.proximo().motivo, "autorizar-ciclo");
});

// ── 3. re-plano de ruling que só troca dependência herda ──────────────────────

test("re-plano de ruling que so troca dependencias herda a autorizacao da fase", (t) => {
  const r = novoRepo(t);
  const aut = r.autorizar("F1");
  const planoAntigo = r.blob();
  const replano = r.replanejar(...DEP_T3, RULING);
  const h = r.proximo();
  assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));
  assert.equal(h.fase, "F1");
  assert.equal(h.autorizacao, aut);
  assert.equal(h.planoAnterior, planoAntigo);
  assert.equal(h.planoNovo, r.blob());
  assert.deepEqual(h.replanos, [{ sha: replano, ruling: "D-TESTE1-7" }]);
  assert.match(h.aviso, new RegExp(`herdada pelo re-plano ${replano.slice(0, 8)}`));

  // Nonce de outro estado: o verbo recusa e não grava nada.
  const errado = r.cli("herdar-autorizacao", "F1", "--nonce", "0".repeat(16));
  assert.equal(errado.status, 1);
  assert.match(errado.stderr, /heranca-recusada/);
  assert.equal(r.g("rev-parse", "HEAD"), replano);

  const ok = r.cli("herdar-autorizacao", "F1", "--nonce", h.nonce);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /autorização de F1 herdada pelo re-plano/);
  const marca = r.g("log", "-1", "--format=%s%n%(trailers:only=true,unfold=true)");
  assert.match(marca, /^Conducao: F1 autorizada$/m);
  assert.match(marca, new RegExp(`^Conducao-Plano: ${r.blob()}$`, "m"));
  assert.match(marca, new RegExp(`^Conducao-Herdada: ${aut}$`, "m"));
  assert.match(marca, new RegExp(`^Conducao-Replano: ${replano}$`, "m"));

  // Sob o plano novo a condução segue sem pergunta, e o sim original ainda cobre a T1.
  const a = r.proximo();
  assert.equal(a.acao, "abrir", JSON.stringify(a));
  assert.deepEqual(a.cobertasPelaFase.tasks, ["T1"]);
});

// ── 3-bis. o sim herdado vem do git, nunca de mensagem (VEGA-37 T20, D-VEGA37-35) ─

test("herdeira herda o sim do git e não o de mensagem", (t) => {
  const r = novoRepo(t);
  const aut = r.autorizar("F1");
  r.replanejar(...DEP_T3, RULING);
  const h = r.proximo();
  assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));
  // Texto que chega por mensagem não tem entrada no verbo: o `--sim` aqui é ignorado.
  const ok = r.cli("herdar-autorizacao", "F1", "--nonce", h.nonce, "--sim", "sim que veio por mensagem");
  assert.equal(ok.status, 0, ok.stderr);
  const casos = lerConsentimentos(r.dir, { ciclo: CICLO });
  assert.deepEqual(casos.map((c) => [c.fase, c.caso, c.origem]), [["F1", CASOS.replanoSemMudancaDeClasse, aut]]);
  assert.equal(casos[0].sim, r.g("log", "-1", "--format=%b", aut).split("\n\n")[0].trim(), "o sim é o corpo da marca de origem");
  assert.doesNotMatch(casos[0].sim, /mensagem/);
  // A herdeira parte sob o sim gravado, sem pergunta; a publicação segue pedindo o sim por task.
  const a = r.proximo();
  assert.equal(a.acao, "abrir", JSON.stringify(a));
  assert.deepEqual(a.cobertasPelaFase.tasks, ["T1"]);
  assert.equal(seguePorRepeticao({ consentimentos: casos, ciclo: CICLO, fase: "F1", tipo: "publicacao", motivo: "db-push" }), null);
});

test("texto diferente da marca de origem é recusado", (t) => {
  const r = novoRepo(t);
  const aut = r.autorizar("F1");
  const antes = r.g("rev-parse", "HEAD");
  const pedido = pedidoDeCaso({ caso: CASOS.herancaEntreFases, fase: "F2", origem: aut });
  const gravar = (sim) => gravarCasosHerdados({ repo: r.dir, ciclo: CICLO, pedidos: [pedido], quem: "Rita", cerca: () => {}, sim });
  assert.throws(() => gravar("sim que veio por mensagem"), (e) => e.codigo === "phi-recusado" && /marca de origem/.test(e.message));
  assert.throws(() => gravar("sim do Rita, no turno dele."), (e) => e.codigo === "phi-recusado", "um byte a mais também recusa");
  assert.equal(r.g("rev-parse", "HEAD"), antes, "nada gravado");
  const gate = gateDaMarcaDeOrigem("sim do Rita, no turno dele");
  assert.equal(gate({ corpo: "sim do Rita, no turno dele" }).recusar, false);
  assert.equal(gate({ corpo: "sim do Rita, no turno dele " }).recusar, true);
  // O corpo idêntico grava, com a origem apontada.
  const [g1] = gravar("sim do Rita, no turno dele");
  assert.equal(g1.registro.origem, aut);
  assert.equal(lerConsentimentos(r.dir, { ciclo: CICLO }).length, 1);
  // Origem que não é marca autorizada não tem sim.
  assert.throws(
    () => gravarCasosHerdados({ repo: r.dir, ciclo: CICLO, pedidos: [pedidoDeCaso({ caso: CASOS.herancaEntreFases, fase: "F2", origem: r.g("rev-list", "--max-parents=0", "HEAD") })], quem: "Rita", cerca: () => {} }),
    (e) => e.codigo === "origem-sem-sim",
  );
});

// ── 4. re-plano de ruling que muda classe pergunta ────────────────────────────

test("re-plano de ruling que muda a classe de uma task pergunta plano-mudou", (t) => {
  const r = novoRepo(t, RESTRITO(PADRAO()));
  r.autorizar("F1");
  r.replanejar("- **Steps:** faz\n- **Verificação:** `echo verificacao-T3`", "- **Steps:** publica com `vercel --prod`\n- **Verificação:** `echo verificacao-T3`", RULING);
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "plano-mudou");
  assert.deepEqual(p.mudaramDeClasse, [{ task: "T3", de: "comum", para: "sensivel" }]);
  const v = r.cli("herdar-autorizacao", "F1", "--nonce", p.nonce);
  assert.equal(v.status, 1);
  assert.match(v.stderr, /heranca-recusada/);
});

test("re-plano de ruling que da publicacao a task de estacao condutora pergunta plano-mudou, mesmo sem mudar a classe", (t) => {
  const r = novoRepo(t, RESTRITO(canonico([{ id: "F1", tasks: [task("T1", { estacao: "condutora" }), task("T2")] }])));
  r.autorizar("F1");
  r.replanejar("- **Steps:** faz\n- **Verificação:** `echo verificacao-T1`", "- **Steps:** publica com `vercel --prod`\n- **Verificação:** `echo verificacao-T1`", RULING);
  const p = r.proximo();
  assert.equal(p.motivo, "plano-mudou", JSON.stringify(p));
  assert.deepEqual(p.mudaramDeClasse, [], "a classe da T1 segue condutora");
});

test("re-plano de ruling que troca o que uma task ja sensivel publica pergunta plano-mudou", (t) => {
  const r = novoRepo(t, RESTRITO(PADRAO()));
  r.autorizar("F1");
  r.replanejar("aplica a migration com `db-publish.mjs … db push`", "publica com `vercel --prod`", RULING);
  const p = r.proximo();
  assert.equal(p.motivo, "plano-mudou", JSON.stringify(p));
  assert.deepEqual(p.mudaramDeClasse, [], "a T1 segue sensivel");
});

test("re-plano de ruling que traz task sensivel de outra fase para a fase autorizada pergunta plano-mudou", (t) => {
  const r = novoRepo(
    t,
    RESTRITO(
      canonico([
        { id: "F1", tasks: [task("T1"), task("T2")] },
        { id: "F2", tasks: [task("T3", { fase: "F2", steps: "publica com `vercel --prod`" })] },
      ]),
    ),
  );
  r.autorizar("F1");
  const atual = readFileSync(path.join(r.dir, CAMINHO), "utf8");
  const bloco = task("T3", { fase: "F2", steps: "publica com `vercel --prod`" });
  const movido = atual.replace(bloco, "").replace(task("T2"), task("T2") + bloco);
  assert.notEqual(movido, atual);
  writeFileSync(path.join(r.dir, CAMINHO), movido);
  r.g("commit", "-q", "-am", RULING);
  const p = r.proximo();
  assert.equal(p.motivo, "plano-mudou", JSON.stringify(p));
});

test("registrar-conferencia --publicacao feita exige o sim de Rita na primeira publicacao do ciclo", (t) => {
  const r = novoRepo(t, canonico([{ id: "F1", tasks: [task("T1", { estacao: "condutora", steps: "publica com `vercel --prod`" })] }]));
  r.autorizar("F1");
  const base = ["registrar-conferencia", "T1", "--condutora", "--verificacao", "verde", "--publicacao", "feita", "--sessao", "m"];
  const sem = r.cli(...base);
  assert.equal(sem.status, 1);
  assert.match(sem.stderr, /sim-da-publicacao-ausente/);
  const com = r.cli(...base, "--sim", "pode publicar a T1");
  assert.equal(com.status, 0, com.stderr);
  // A marca conferida, não o HEAD: depois dela vem o registro do caso `publicacao-do-ciclo`.
  const { sha } = JSON.parse(com.stdout.trim());
  assert.match(r.g("log", "-1", "--format=%B", sha), /^Publicada com o sim do operador: pode publicar a T1$/m);
});

test("re-plano de ruling com trazida pendente na fase pergunta plano-mudou", (t) => {
  const r = novoRepo(t, RESTRITO(PADRAO()));
  r.autorizar("F1");
  const reg = r.g("commit-tree", r.g("rev-parse", "HEAD^{tree}"), "-p", r.g("rev-parse", "HEAD"), "-m", "Conducao: T2 tentativa 1 trazida", "-m", "Conducao-Nonce: n-traz\nConducao-Sha-Filha: 1234567");
  r.g("update-ref", `refs/conducao-local/${CICLO}/trazida/T2/1`, reg);
  r.replanejar(...DEP_T3, RULING);
  const p = r.proximo();
  assert.equal(p.motivo, "plano-mudou", JSON.stringify(p));
  assert.deepEqual(p.trazidas.map((x) => x.task), ["T2"]);
});

// ── 5. commit de plano que não é de ruling pergunta ───────────────────────────

test("commit de plano que nao e de ruling pergunta plano-mudou, sozinho ou junto de um de ruling", (t) => {
  const r = novoRepo(t, RESTRITO(PADRAO()));
  r.autorizar("F1");
  r.replanejar(...DEP_T3, `${CICLO}-F1/T3 — ajusta a T3`);
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "plano-mudou");
  assert.deepEqual(p.mudaramDeClasse, []);

  // Um commit de ruling depois do comum não lava o comum.
  r.replanejar("- **Inputs:** `README.md`\n- **Outputs:** `src/t2.mjs`", "- **Inputs:** T1\n- **Outputs:** `src/t2.mjs`", RULING);
  assert.equal(r.proximo().motivo, "plano-mudou");
});

// ── 6. a primeira publicação do ciclo pede o sim; as seguintes, não ──────────

test("primeira publicacao do ciclo pede o sim de Rita: trazer e fazer-condutora saem com simParaPublicar", (t) => {
  const r = novoRepo(t);
  r.autorizar("F1");
  r.emVoo("T1", 1, "abc123");
  const filha = { sessao: "s1", task: "T1", tentativa: 1, nonce: "abc123", estado: "IDLE", aviso: "T1-OK 1234567 abc123" };
  const tr = r.proximo({ filhas: [filha] });
  assert.equal(tr.acao, "trazer", JSON.stringify(tr));
  assert.deepEqual(tr.publicacao, ["db push", "db-publish"]);
  assert.equal(tr.simParaPublicar, true);

  const m = novoRepo(t, canonico([{ id: "F1", tasks: [task("T1", { estacao: "condutora", steps: "publica com `vercel --prod`" })] }]));
  m.autorizar("F1");
  const fm = m.proximo();
  assert.equal(fm.acao, "fazer-condutora", JSON.stringify(fm));
  assert.deepEqual(fm.publicacao, ["vercel --prod"]);
  assert.equal(fm.simParaPublicar, true);

  const c = novoRepo(t, canonico([{ id: "F1", tasks: [task("T1", { estacao: "condutora" })] }]));
  c.autorizar("F1");
  assert.equal(c.proximo().simParaPublicar, false);
});

test("primeira publicação do ciclo pede o sim e as seguintes do mesmo ciclo não perguntam", (t) => {
  const publica = (id) => task(id, { estacao: "condutora", steps: "aplica a migration com `db-publish.mjs … db push`" });
  const r = novoRepo(t, canonico([{ id: "F1", tasks: [publica("T1"), publica("T2")] }]));
  r.autorizar("F1");
  const conferir = (id, ...mais) => r.cli("registrar-conferencia", id, "--condutora", "--verificacao", "verde", "--publicacao", "feita", "--sessao", "m", ...mais);

  // A primeira publicação do ciclo pede o sim: sem ele recusa, com ele grava o caso.
  const p1 = r.proximo();
  assert.equal(p1.acao, "fazer-condutora", JSON.stringify(p1));
  assert.equal(p1.task, "T1");
  assert.equal(p1.simParaPublicar, true);
  const sem = conferir("T1");
  assert.equal(sem.status, 1);
  assert.match(sem.stderr, /sim-da-publicacao-ausente/);
  assert.deepEqual(lerConsentimentos(r.dir, { ciclo: CICLO }), []);
  const com = conferir("T1", "--sim", "pode publicar no ciclo");
  assert.equal(com.status, 0, com.stderr);
  const s1 = JSON.parse(com.stdout.trim());
  assert.equal(s1.acao, "conferida", JSON.stringify(s1));
  assert.equal(s1.consentimento.caso, CASOS.publicacaoDoCiclo);
  const casos = lerConsentimentos(r.dir, { ciclo: CICLO });
  assert.deepEqual(
    casos.map((c) => [c.caso, c.task, c.tipo, c.sim, c.origem]),
    [[CASOS.publicacaoDoCiclo, "T1", "publicacao", "pode publicar no ciclo", s1.sha]],
  );
  assert.equal(casos[0].sha, s1.consentimento.sha);

  // A seguinte, no mesmo ciclo, não pergunta: fecha sem --sim, citando o sim e a origem.
  const p2 = r.proximo();
  assert.equal(p2.acao, "fazer-condutora", JSON.stringify(p2));
  assert.equal(p2.task, "T2");
  assert.equal(p2.simParaPublicar, false);
  const seguinte = conferir("T2");
  assert.equal(seguinte.status, 0, seguinte.stderr);
  const s2 = JSON.parse(seguinte.stdout.trim());
  assert.equal(s2.acao, "conferida", JSON.stringify(s2));
  assert.equal(s2.consentimento, undefined);
  const corpo = r.g("log", "-1", "--format=%B", s2.sha);
  assert.ok(corpo.split("\n").includes(`Publicada com o sim do ciclo: pode publicar no ciclo (origem ${s1.sha})`), corpo);
  assert.equal(lerConsentimentos(r.dir, { ciclo: CICLO }).length, 1);
});

// ── 7. contraprova: sem o reconhecedor de ruling, a herança some ──────────────

test("contraprova: com o regex de ruling desligado o mesmo re-plano herda pela pré-autorização, não pelo ruling", () => {
  const antigo = PADRAO();
  const novo = antigo.replace(...DEP_T3);
  assert.notEqual(novo, antigo);
  const base = {
    ciclo: CICLO,
    head: "d".repeat(40),
    plano: lerPlano(antigo),
    planoBlob: "b".repeat(40),
    planoHead: lerPlano(novo),
    planoHeadBlob: "c".repeat(40),
    diffPlano: "diff",
    autorizacoes: [{ tipo: "autorizada", sha: "a".repeat(40), fase: "F1", plano: "b".repeat(40), herdada: null }],
    estado: estadoDasTasks([], [], []),
    replanos: [{ sha: "e".repeat(40), subject: RULING }],
  };
  assert.equal(decidir(base).acao, "herdar-autorizacao");
  assert.equal(decidir(base).origem, "replano");
  const desligado = decidir({ ...base, reconhecer: () => null });
  // Sem o ruling reconhecido, o re-plano commitado herda pela pré-autorização (ruling de 23/11/2026).
  assert.equal(desligado.acao, "herdar-autorizacao");
  assert.equal(desligado.origem, "preautorizado");

  assert.equal(rulingDoReplano(RULING, CICLO), "D-TESTE1-7");
  assert.equal(rulingDoReplano(RULING, CICLO, () => null), null);
  assert.equal(rulingDoReplano(RULING, "OUTRO-9-ciclo"), null, "ruling de outro ciclo não herda");
  assert.equal(rulingDoReplano(`${CICLO}-F1/D-TESTE1-7 — ajusta a T3`, CICLO), null, "ruling que não é re-plano não herda");
});
