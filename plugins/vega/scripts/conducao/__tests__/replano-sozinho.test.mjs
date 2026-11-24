/**
 * replano-sozinho.test.mjs — o re-plano dentro da fase segue sozinho e só avisa (VEGA-19 T43,
 * D-VEGA19-53, AC-VEGA19-13).
 *
 * O commit do `/intra-plan` que leva `Replano-Motivo: <tipo>:<chave>` e cabe na regra — dentro da
 * fase, no máximo 2 tasks novas além do fechamento, sem caminho clínico, publicação que altera nem
 * a proposta do ciclo, nada trazido sem conferência, motivo que não se repete — herda a
 * autorização (origem `sozinho`), também na fase reaberta, e passa o aviso ao operador; o motivo
 * repetido pergunta `replano-repetido`; qualquer outra condição, e o commit sem o trailer, seguem
 * o comportamento de antes. Parte pura (`replanoSozinho`) e parte pelo CLI num repo temporário
 * (hooks desligados, origin bare: o verbo da herança empurra a cópia do ciclo).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diferencaDoPlano, mudancasDeAlcance, mudancasQuePerguntam } from "../conducao.mjs";
import { CASOS, eventosDoConsentimento, lerConsentimentos } from "../consentimento.mjs";
import { blocoDaTask, motivoDoReplano, replanoSozinho } from "../verbos.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const FECHA = "[—] (fechamento-de-fase)";
const RULING = (n, alvo) => `${CICLO}-F1/D-TESTE1-${n} — re-plano de ${alvo}: o CI pediu`;

function task(id, { inputs = "`README.md`", satisfies = "[AC-TESTE1-1]", fase = "F1", estacao = "servidor", steps = "faz", extra = [] } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    `- **satisfies:** ${satisfies}`,
    `- **Inputs:** ${inputs}`,
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    `- **Estação:** ${estacao}`,
    `- **Steps:** ${steps}`,
    ...extra,
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

const LINHA_15 = "**Largura do ciclo:** 2";
const CANONICO = [
  "---",
  `cycle: ${CICLO}`,
  "opened: 2026-11-18",
  "---",
  "",
  "## 1. Goal",
  "",
  "### 1.5 Modo de Execução",
  "",
  LINHA_15,
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
const ANTES_DA_F2 = "### F2 — fase F2";

/**
 * Origin bare + árvore no ramo do ciclo. `antes(a)` roda antes da autorização da F1 (o re-plano
 * anterior do ciclo); `conferidas` as tasks da F1 já conferidas (as duas ⇒ fase fechada).
 */
function ambiente(t, { antes = null, conferidas = ["T1", "T2"] } = {}) {
  const raiz = pastaTemporaria("replano-sozinho-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const dir = path.join(raiz, "maestra");
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
  const blob = () => g("rev-parse", `HEAD:${CAMINHO}`);
  /** Re-plano: o canonico com `de` trocado por `para`, num commit com `subject` e, se dado, o trailer. */
  const replanejar = (de, para, subject, motivo = null) => {
    const texto = readFileSync(path.join(dir, CAMINHO), "utf8");
    assert.ok(texto.includes(de), de);
    writeFileSync(path.join(dir, CAMINHO), texto.replace(de, para));
    g("commit", "-q", "-am", subject, ...(motivo ? ["-m", `Replano-Motivo: ${motivo}`] : []));
    return g("rev-parse", "HEAD");
  };
  const a = { dir, g, blob, vazio, replanejar };
  if (antes) antes(a);
  vazio("Conducao: F1 autorizada", "sim do operador, no turno dele", `Conducao-Plano: ${blob()}`);
  const autorizacao = g("rev-parse", "HEAD");
  for (const id of conferidas)
    vazio(
      `Conducao: ${id} conferida`,
      `Conducao-Task: ${id}\nConducao-Sha-Filha: 0000000\nConducao-Sessao-Filha: s\nConducao-Nonce: n-${id}\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica`,
    );
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  const proximo = (entrada) => {
    g("push", "-q", "origin", "HEAD:refs/heads/ciclo-teste");
    const r = cli("proximo", "--entrada", JSON.stringify({ inscrita: true, ...(entrada ?? {}) }));
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  const head = () => g("rev-parse", "HEAD");
  const verde = (run) => ({ ci: { sha: head(), veredito: "verde", run } });
  return { ...a, autorizacao, cli, proximo, head, verde };
}

const T5 = task("T5", { inputs: "T2" });
const T6 = task("T6", { inputs: "T5", satisfies: FECHA });

// ── a regra pura ────────────────────────────────────────────────────────────

function tk(id, extra = {}) {
  const t = { id, fase: "F1", deps: [], outputs: [`a/${id}.mjs`], estacao: "servidor", fechamento: false, publicacao: [], protegida: [], classe: "comum", simProprio: null, passos: [], ...extra };
  return t.fechamento && !("classe" in extra) ? { ...t, classe: "fechamento" } : t;
}
function pl(tasks, fases = ["F1"]) {
  return { fases: fases.map((id) => ({ id, tasks: tasks.filter((t) => t.fase === id).map((t) => t.id) })), porId: new Map(tasks.map((t) => [t.id, t])) };
}
const DE = pl([tk("T1"), tk("T2", { fechamento: true }), tk("T3", { fase: "F2" })], ["F1", "F2"]);
const NOVA = (extra = {}) => pl([tk("T1"), tk("T2", { fechamento: true }), tk("T5", extra), tk("T6", { fechamento: true }), tk("T3", { fase: "F2" })], ["F1", "F2"]);
const F1 = { id: "F1", tasks: ["T1", "T2"] };
const RP = [{ sha: "a".repeat(40), subject: RULING(9, "T5"), motivo: "ci:lint-vermelho" }];
const OPCOES = { ciclo: CICLO, diferencaDoPlano, mudancasQuePerguntam, mudancasDeAlcance, textoDaTask: (id) => `#### ${id} — x\n- **Steps:** faz` };
const sozinho = (para, o = {}, entrada = {}) => replanoSozinho({ de: DE, para, fase: F1, replanos: RP, anteriores: [], ...entrada }, { ...OPCOES, ...o });

test("o motivo do re-plano é <tipo>:<chave>, com os quatro tipos", () => {
  const casos = [
    ["ci:lint-vermelho", { tipo: "ci", chave: "lint-vermelho" }],
    ["revisao:t43.alto", { tipo: "revisao", chave: "t43.alto" }],
    ["operaria:t9-falhou", { tipo: "operaria", chave: "t9-falhou" }],
    ["escopo:teste-a-mais", { tipo: "escopo", chave: "teste-a-mais" }],
    ["deploy:x", null],
    ["ci:", null],
    ["ci:Com Espaco", null],
    ["", null],
  ];
  assert.ok(casos.length > 0);
  for (const [v, esperado] of casos) assert.deepEqual(motivoDoReplano(v), esperado, v);
});

test("o bloco da task vai do heading dela até o seguinte", () => {
  const texto = ["## 3", "#### T1 — a", "- **Steps:** mescla a proposta", "#### T10 — b", "- x", "### F2"].join("\n");
  assert.equal(blocoDaTask(texto, "T1"), "#### T1 — a\n- **Steps:** mescla a proposta");
  assert.equal(blocoDaTask(texto, "T10"), "#### T10 — b\n- x");
  assert.equal(blocoDaTask(texto, "T9"), "");
});

test("replanoSozinho — cada condição da D-VEGA19-53", () => {
  const casos = [
    { caso: "1 task e fechamento novo na fase, por CI", r: sozinho(NOVA()), porque: null },
    { caso: "commit sem o trailer", r: sozinho(NOVA(), {}, { replanos: [{ ...RP[0], motivo: null }] }), porque: "sem-motivo" },
    { caso: "trailer fora da forma", r: sozinho(NOVA(), {}, { replanos: [{ ...RP[0], motivo: "deploy:x" }] }), porque: "sem-motivo" },
    { caso: "commit que não é re-plano de ruling", r: sozinho(NOVA(), {}, { replanos: [{ ...RP[0], subject: "re-plano à mão" }] }), porque: "sem-ruling" },
    { caso: "caminho clínico", r: sozinho(NOVA({ simProprio: "caminho-clinico" })), porque: "sim-proprio" },
    { caso: "publicação que altera", r: sozinho(NOVA({ simProprio: "publicacao-que-altera" })), porque: "sim-proprio" },
    {
      caso: "task em outra fase",
      r: sozinho(pl([tk("T1"), tk("T2", { fechamento: true }), tk("T5"), tk("T6", { fechamento: true }), tk("T3", { fase: "F2" }), tk("T7", { fase: "F2" })], ["F1", "F2"])),
      porque: "fora-da-fase",
    },
    {
      caso: "task que muda de fase",
      r: sozinho(pl([tk("T1"), tk("T2", { fechamento: true }), tk("T3", { fase: "F1" })], ["F1", "F2"])),
      porque: "fora-da-fase",
    },
    { caso: "task que some", r: sozinho(pl([tk("T1"), tk("T2", { fechamento: true })], ["F1", "F2"])), porque: "task-sumiu" },
    { caso: "fase nova", r: sozinho(pl([tk("T1"), tk("T2", { fechamento: true }), tk("T3", { fase: "F2" })], ["F1", "F2", "F3"])), porque: "fase-nova" },
    {
      caso: "3 tasks novas além do fechamento",
      r: sozinho(pl([tk("T1"), tk("T2", { fechamento: true }), tk("T5"), tk("T7"), tk("T8"), tk("T6", { fechamento: true }), tk("T3", { fase: "F2" })], ["F1", "F2"])),
      porque: "tasks-demais",
    },
    {
      caso: "2 tasks novas além do fechamento",
      r: sozinho(pl([tk("T1"), tk("T2", { fechamento: true }), tk("T5"), tk("T7"), tk("T6", { fechamento: true }), tk("T3", { fase: "F2" })], ["F1", "F2"])),
      porque: null,
    },
    { caso: "task nova de estação condutora", r: sozinho(NOVA({ estacao: "condutora" })), porque: "proposta" },
    { caso: "task nova de workstation", r: sozinho(NOVA({ estacao: "workstation" })), porque: "proposta" },
    { caso: "Steps que mesclam a proposta", r: sozinho(NOVA(), { textoDaTask: (id) => (id === "T5" ? "- **Steps:** roda `gh pr merge` no fim" : "") }), porque: "proposta" },
    { caso: "Steps que reabrem a proposta", r: sozinho(NOVA(), { textoDaTask: (id) => (id === "T5" ? "- **Steps:** reabre a proposta" : "") }), porque: "proposta" },
    { caso: "bloco da task que não se lê", r: sozinho(NOVA(), { textoDaTask: () => "" }), porque: "proposta" },
    { caso: "sem o leitor de alcance injetado", r: sozinho(NOVA(), { mudancasDeAlcance: null }), porque: "alcance" },
    {
      caso: "task existente que troca os Outputs",
      r: sozinho(pl([tk("T1", { outputs: ["a/outro.mjs"] }), tk("T2", { fechamento: true }), tk("T5"), tk("T6", { fechamento: true }), tk("T3", { fase: "F2" })], ["F1", "F2"])),
      porque: "alcance",
    },
    { caso: "task nova que muda de classe", r: sozinho(NOVA({ classe: "sensivel" })), porque: "mudanca-de-classe" },
    { caso: "trazida sem conferência", r: sozinho(NOVA(), { trazidas: ["T1"] }), porque: "trazida-pendente" },
    { caso: "restrição na linha de consentimentos", r: sozinho(NOVA(), { restrita: true }), porque: "restricao" },
    { caso: "chave repetida no ciclo", r: sozinho(NOVA(), {}, { anteriores: [{ sha: "b".repeat(40), motivo: "revisao:lint-vermelho" }] }), porque: "replano-repetido" },
    { caso: "chave diferente no ciclo", r: sozinho(NOVA(), {}, { anteriores: [{ sha: "b".repeat(40), motivo: "ci:outro" }] }), porque: null },
  ];
  assert.ok(casos.length > 0);
  for (const c of casos) {
    assert.equal(c.r.porque, c.porque, `${c.caso}: ${JSON.stringify(c.r)}`);
    assert.equal(c.r.sozinho, c.porque === null, c.caso);
  }
  assert.equal(sozinho(NOVA()).motivo, "ci:lint-vermelho");
});

test("a resposta do caso replano-sozinho é de Vega; os outros casos seguem sem quem", () => {
  const r = { ciclo: CICLO, fase: "F1", caso: CASOS.replanoSozinho, quando: "2026-11-18T20:00:00.000Z", sim: "sim" };
  const [, resp] = eventosDoConsentimento(r, { pergunta_id: "p-00000000000000aa", origem_resposta: "agente", ponteiro: null });
  assert.equal(resp.quem, "vega");
  const [, outra] = eventosDoConsentimento({ ...r, caso: CASOS.replanoSemMudancaDeClasse }, { pergunta_id: "p-00000000000000ab", origem_resposta: "agente", ponteiro: null });
  assert.equal(outra.quem, undefined);
});

// ── pelo CLI ────────────────────────────────────────────────────────────────

test("fase reaberta por CI com 1 task e fechamento novo herda com aviso, grava o caso e segue", (t) => {
  const a = ambiente(t);
  const replano = a.replanejar(ANTES_DA_F2, T5 + T6 + ANTES_DA_F2, RULING(9, "T5-T6"), "ci:lint-vermelho");
  const h = a.proximo(a.verde(90));
  assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));
  assert.equal(h.origem, "sozinho");
  assert.equal(h.fase, "F1");
  assert.equal(h.reaberta, true);
  assert.equal(h.autorizacao, a.autorizacao);
  assert.equal(h.replanoMotivo, "ci:lint-vermelho");
  assert.equal(h.ponteiro, `replano:${replano.slice(0, 8)}`);
  assert.match(h.aviso, /motivo ci:lint-vermelho/);
  assert.match(h.aviso, new RegExp(`replano:${replano.slice(0, 8)}`));
  assert.match(h.recibo, /^Decidido por Vega, por delegação de /);
  assert.equal(h.consentimento.caso, CASOS.replanoSozinho);
  // Sem a fase reaberta seguir sozinha, sairia `plano-mudou` com `reaberta: true`.
  assert.notEqual(h.motivo, "plano-mudou");

  const ok = a.cli("herdar-autorizacao", "F1", "--nonce", h.nonce);
  assert.equal(ok.status, 0, ok.stderr);
  const saida = JSON.parse(ok.stdout.trim());
  assert.equal(saida.avisarOperador, true);
  assert.equal(saida.ponteiro, `replano:${replano.slice(0, 8)}`);
  const marca = a.g("log", "-1", "--format=%s%n%b");
  assert.match(marca, /^Conducao: F1 autorizada$/m);
  assert.match(marca, /^Conducao-Origem: sozinho$/m);
  assert.match(marca, /^Conducao-Replano-Motivo: ci:lint-vermelho$/m);
  assert.match(marca, new RegExp(`^Conducao-Herdada: ${a.autorizacao}$`, "m"));
  const casos = lerConsentimentos(a.dir, { ciclo: CICLO }).filter((c) => c.caso === CASOS.replanoSozinho);
  assert.equal(casos.length, 1);
  assert.equal(casos[0].fase, "F1");

  // Sob o plano novo, a fase reaberta segue pela task nova.
  const ab = a.proximo(a.verde(91));
  assert.equal(ab.acao, "abrir", JSON.stringify(ab));
  assert.deepEqual(ab.tarefas.map((x) => x.task), ["T5"]);
});

test("re-plano no meio da fase com o trailer segue sozinho; sem o trailer, a herança de antes", (t) => {
  for (const [motivo, origem] of [["revisao:t1-medio", "sozinho"], [null, "replano"]]) {
    const a = ambiente(t, { conferidas: ["T1"] });
    a.replanejar("#### T2 — tarefa T2", `${task("T5", { inputs: "T1" })}#### T2 — tarefa T2`, RULING(9, "T5"), motivo);
    const h = a.proximo();
    assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));
    assert.equal(h.origem, origem, String(motivo));
  }
});

test("fase reaberta fora da regra do re-plano sozinho herda pela pré-autorização (ruling de 23/11/2026)", (t) => {
  const publica = task("T5", { inputs: "T2", steps: "aplica com `db push`", extra: ["- **Publicação:** sim, altera a coluna"] });
  const merge = task("T5", { inputs: "T2", steps: "roda `gh pr merge` da proposta" });
  const tres = task("T5", { inputs: "T2" }) + task("T7", { inputs: "T5" }) + task("T8", { inputs: "T7" });
  const casos = [
    { caso: "commit sem o trailer", de: ANTES_DA_F2, para: T5 + T6 + ANTES_DA_F2, motivo: null },
    { caso: "publicação que altera", de: ANTES_DA_F2, para: publica + T6 + ANTES_DA_F2, motivo: "ci:a" },
    { caso: "Steps que mesclam a proposta", de: ANTES_DA_F2, para: merge + T6 + ANTES_DA_F2, motivo: "ci:a" },
    { caso: "3 tasks novas além do fechamento", de: ANTES_DA_F2, para: tres + task("T6", { inputs: "T8", satisfies: FECHA }) + ANTES_DA_F2, motivo: "ci:a" },
    { caso: "task em outra fase", de: "## 4. Pronto", para: `${task("T7", { inputs: "T4", fase: "F2" })}## 4. Pronto`, motivo: "ci:a", tambem: [ANTES_DA_F2, T5 + T6 + ANTES_DA_F2] },
    { caso: "linha de restrição", de: LINHA_15, para: `${LINHA_15}\n\n**Consentimentos:** \`replano-sozinho\` → pergunta`, motivo: "ci:a", tambem: [ANTES_DA_F2, T5 + T6 + ANTES_DA_F2] },
  ];
  assert.ok(casos.length > 0);
  for (const c of casos) {
    const a = ambiente(t);
    if (c.tambem) {
      const texto = readFileSync(path.join(a.dir, CAMINHO), "utf8").replace(c.tambem[0], c.tambem[1]);
      writeFileSync(path.join(a.dir, CAMINHO), texto);
    }
    a.replanejar(c.de, c.para, RULING(9, "T5"), c.motivo);
    const p = a.proximo(a.verde(92));
    // O re-plano que mexe na linha `**Consentimentos:**` não se pré-autoriza: a restrição vale pelo que o sim viu.
    if (c.caso === "linha de restrição") {
      assert.equal(p.acao, "perguntar", `${c.caso}: ${JSON.stringify(p)}`);
      assert.equal(p.motivo, "plano-mudou", c.caso);
    } else {
      assert.equal(p.acao, "herdar-autorizacao", `${c.caso}: ${JSON.stringify(p)}`);
      assert.equal(p.origem, "preautorizado", c.caso);
    }
    assert.equal(p.reaberta, true, c.caso);
  }
});

test("fase reaberta pelo CI com republicação aditiva da função (o caso T42 do L4) herda sem pergunta e abre a task", (t) => {
  // Hotfix nodus-mapa-uma-vez-por-ciclo, 24/11/2026: a T42 do L4 (mapa de telas vencido, republica
  // a `nodus-chat`) parou em D24 pedindo o sim do plano novo; o motor da árvore do ciclo ainda não
  // tinha a pré-autorização. Com e sem o trailer do motivo, o re-plano que acrescenta publicação
  // aditiva reautoriza sozinho, e a task abre coberta pelo sim do ciclo: só o `publicacao-gate.js`
  // pergunta, no ato do deploy.
  const republica = task("T5", {
    inputs: "T2",
    steps: "regenera o mapa e republica com `db-publish.mjs functions deploy nodus-chat`",
    extra: ["- **Publicação:** sim, aditiva"],
  });
  for (const motivo of ["ci:mapa-vencido", null]) {
    const a = ambiente(t);
    a.replanejar(ANTES_DA_F2, republica + T6 + ANTES_DA_F2, RULING(9, "T5-T6"), motivo);
    const h = a.proximo(a.verde(94));
    assert.equal(h.acao, "herdar-autorizacao", `${motivo}: ${JSON.stringify(h)}`);
    assert.ok(["sozinho", "preautorizado"].includes(h.origem), `${motivo}: ${h.origem}`);
    const ok = a.cli("herdar-autorizacao", "F1", "--nonce", h.nonce);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout.trim()).avisarOperador, true);
    const ab = a.proximo(a.verde(95));
    assert.equal(ab.acao, "abrir", `${motivo}: ${JSON.stringify(ab)}`);
    assert.deepEqual(ab.tarefas.map((x) => x.task), ["T5"]);
  }
});

test("o mesmo motivo duas vezes no ciclo pergunta replano-repetido, com o conserto do molde", (t) => {
  const T9 = task("T9", { inputs: "`README.md`" });
  const a = ambiente(t, {
    antes: (x) => x.replanejar("#### T1 — tarefa T1", `${T9}#### T1 — tarefa T1`, RULING(8, "T9"), "ci:lint-vermelho"),
    conferidas: ["T9", "T1", "T2"],
  });
  a.replanejar(ANTES_DA_F2, T5 + T6 + ANTES_DA_F2, RULING(9, "T5-T6"), "operaria:lint-vermelho");
  const p = a.proximo(a.verde(93));
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "replano-repetido");
  assert.equal(p.fase, "F1");
  assert.equal(p.conserto, "molde");
  assert.equal(p.anteriores.length, 1);
  assert.match(p.ponteiro, /^replano:[0-9a-f]{8}$/);
});
