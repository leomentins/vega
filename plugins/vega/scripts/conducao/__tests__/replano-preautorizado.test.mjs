/**
 * replano-preautorizado.test.mjs — re-plano commitado dentro de ciclo autorizado reautoriza a fase
 * sozinho (ruling do operador, 23/11/2026, verbatim: "pra replanos sempre vale preautorização").
 *
 * O re-plano que muda a classe de uma task, acrescenta task, troca a Verificação ou chega numa fase
 * nova do ciclo autorizado deixa de sair `perguntar plano-mudou` / `autorizar-ciclo`: o `proximo`
 * devolve `herdar-autorizacao` com origem `preautorizado`, o verbo grava a marca
 * `Conducao: <fase> consentimento replano` e a autorização herdada, e devolve o aviso ao operador
 * (`avisarOperador`, `ponteiro` `replano:<sha8>`). Seguem perguntando: o primeiro sim do ciclo, a
 * publicação (`simParaPublicar`), a task com sim próprio (caminho clínico ou publicação que altera,
 * D18a) e a restrição `` `replano` → pergunta `` da linha `**Consentimentos:**`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CASOS, lerConsentimentos } from "../consentimento.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

function task(id, { steps = "faz", fase = "F1", verificacao = `echo verificacao-${id}` } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    `- **Steps:** ${steps}`,
    `- **Verificação:** \`${verificacao}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

function canonico(fases, consentimentos = null) {
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
    "**Largura do ciclo:** 1",
    ...(consentimentos ? ["", `**Consentimentos:** ${consentimentos}`] : []),
    "",
    "## 3. Tasks",
    "",
    ...fases.map(({ id, tasks }) => [`### ${id} — fase ${id} (**Modelo:** sonnet)`, "", ...tasks].join("\n")),
    "## 4. Pronto",
    "",
  ].join("\n");
}

const PADRAO = (consentimentos = null) =>
  canonico(
    [
      { id: "F1", tasks: [task("T1"), task("T2"), task("T3")] },
      { id: "F2", tasks: [task("T4", { fase: "F2" })] },
    ],
    consentimentos,
  );

function novoRepo(t, texto = PADRAO()) {
  const raiz = pastaTemporaria("replano-preautorizado-");
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
  /** A marca do sim do ciclo (`autorizar-ciclo`) na fase `fase`. */
  const autorizarCiclo = (fase) => {
    vazio(`Conducao: ${fase} autorizada`, "sim, pode tocar o ciclo inteiro", `Conducao-Plano: ${blob()}\nConducao-Ciclo: sim`);
    return g("rev-parse", "HEAD");
  };
  const replanejar = (de, para, subject = `${CICLO}-F1/T3 — ajusta a T3`) => {
    const atual = readFileSync(path.join(dir, CAMINHO), "utf8");
    assert.ok(atual.includes(de), de);
    writeFileSync(path.join(dir, CAMINHO), atual.replace(de, para));
    g("commit", "-q", "-am", subject);
    return g("rev-parse", "HEAD");
  };
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  const proximo = () => {
    const r = cli("proximo");
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  return { dir, g, vazio, autorizarCiclo, replanejar, cli, proximo };
}

const T3_PUBLICA = ["- **Steps:** faz\n- **Verificação:** `echo verificacao-T3`", "- **Steps:** publica com `vercel --prod`\n- **Verificação:** `echo verificacao-T3`"];

/** Confere a herança preautorizada e a grava pelo verbo; devolve a saída do verbo. */
function herdarPreautorizado(r, fase, sha) {
  const h = r.proximo();
  assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));
  assert.equal(h.origem, "preautorizado", JSON.stringify(h));
  assert.equal(h.fase, fase);
  assert.equal(h.ponteiro, `replano:${sha.slice(0, 8)}`);
  assert.match(h.aviso, /pré-autoriza/);
  const v = r.cli("herdar-autorizacao", fase, "--nonce", h.nonce);
  assert.equal(v.status, 0, v.stderr);
  const out = JSON.parse(v.stdout.trim());
  assert.equal(out.avisarOperador, true);
  assert.equal(out.ponteiro, `replano:${sha.slice(0, 8)}`);
  assert.equal(r.g("log", "-1", "--format=%s"), `Conducao: ${fase} autorizada`);
  assert.match(r.g("log", "-1", "--format=%B"), /^Conducao-Origem: preautorizado$/m);
  const casos = lerConsentimentos(r.dir, { ciclo: CICLO });
  assert.ok(casos.some((c) => c.fase === fase && c.caso === CASOS.replanoPreautorizado), JSON.stringify(casos));
  assert.equal(CASOS.replanoPreautorizado, "replano");
  assert.ok(r.g("log", "--format=%s").split("\n").includes(`Conducao: ${fase} consentimento replano`));
  return out;
}

test("re-plano que muda a classe de uma task na fase em curso reautoriza sozinho e só avisa", (t) => {
  const r = novoRepo(t);
  r.autorizarCiclo("F1");
  const sha = r.replanejar(...T3_PUBLICA);
  herdarPreautorizado(r, "F1", sha);
  const a = r.proximo();
  assert.notEqual(a.motivo, "plano-mudou", JSON.stringify(a));
  assert.equal(a.acao, "abrir", JSON.stringify(a));
});

test("re-plano que acrescenta task na fase em curso reautoriza sozinho", (t) => {
  const r = novoRepo(t);
  r.autorizarCiclo("F1");
  const sha = r.replanejar(task("T3"), task("T3") + task("T5"));
  herdarPreautorizado(r, "F1", sha);
});

test("re-plano que só troca a Verificação reautoriza sozinho, sem Replano-Pergunta", (t) => {
  const r = novoRepo(t);
  r.autorizarCiclo("F1");
  const sha = r.replanejar("`echo verificacao-T2`", "`echo verificacao-T2-nova`");
  herdarPreautorizado(r, "F1", sha);
});

test("fase nova depois de re-plano que muda classe herda pela pré-autorização, sem autorizar-ciclo", (t) => {
  const r = novoRepo(t);
  r.autorizarCiclo("F1");
  for (const id of ["T1", "T2", "T3"]) r.vazio(`Conducao: ${id} conferida`, `Conducao-Task: ${id}`);
  const sha = r.replanejar("- **Steps:** faz\n- **Verificação:** `echo verificacao-T4`", "- **Steps:** publica com `vercel --prod`\n- **Verificação:** `echo verificacao-T4`", `${CICLO}-F2/T4 — ajusta a T4`);
  r.vazio("Conducao: F1 encerrada");
  herdarPreautorizado(r, "F2", sha);
});

test("sem sim do ciclo nenhum, a primeira pergunta autorizar-ciclo segue", (t) => {
  const r = novoRepo(t);
  r.replanejar(...T3_PUBLICA);
  const p = r.proximo();
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "autorizar-ciclo");
});

test("a restrição `replano` → pergunta do canonico devolve o re-plano à pergunta plano-mudou", (t) => {
  const r = novoRepo(t, PADRAO("`replano` → pergunta"));
  r.autorizarCiclo("F1");
  r.replanejar(...T3_PUBLICA);
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "plano-mudou");
});

test("depois da pré-autorização a task que passou a publicar alterando o existente pede o sim dela (D18a)", (t) => {
  const r = novoRepo(t, canonico([{ id: "F1", tasks: [task("T1")] }]));
  r.autorizarCiclo("F1");
  const sha = r.replanejar("- **Steps:** faz\n- **Verificação:** `echo verificacao-T1`", "- **Steps:** publica com `vercel --prod`\n- **Verificação:** `echo verificacao-T1`", `${CICLO}-F1/T1 — ajusta a T1`);
  herdarPreautorizado(r, "F1", sha);
  // A herança pré-autorizada cobre como o sim do ciclo, não como o da fase: a task com sim próprio
  // (publicação que altera) segue pedindo o dela, uma vez por task.
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "task-sensivel");
  assert.equal(p.porque, "publicacao-que-altera");
});

test("depois da pré-autorização a task sensível sem sim próprio abre coberta pelo sim do ciclo", (t) => {
  const r = novoRepo(t, canonico([{ id: "F1", tasks: [task("T1")] }]));
  r.autorizarCiclo("F1");
  const sha = r.replanejar("- **Steps:** faz\n- **Verificação:** `echo verificacao-T1`", "- **Steps:** aplica a migration com `db-publish.mjs … db push`\n- **Publicação:** sim, aditiva\n- **Verificação:** `echo verificacao-T1`", `${CICLO}-F1/T1 — ajusta a T1`);
  herdarPreautorizado(r, "F1", sha);
  const a = r.proximo();
  assert.equal(a.acao, "abrir", JSON.stringify(a));
  assert.deepEqual(a.tarefas.map((x) => [x.task, x.classe]), [["T1", "sensivel"]]);
  assert.equal(a.cobertasPelaFase, undefined, JSON.stringify(a));
  assert.deepEqual(a.cobertasPeloCiclo?.tasks, ["T1"]);
});

// ── achados da revisão (silent-failure-hunter, typescript-reviewer) ─────────

test("o re-plano que apaga a própria restrição `replano` → pergunta segue perguntando", (t) => {
  const r = novoRepo(t, PADRAO("`replano` → pergunta"));
  r.autorizarCiclo("F1");
  r.replanejar("**Consentimentos:** `replano` → pergunta", "**Consentimentos:** `replano-sozinho` → pergunta");
  const atual = readFileSync(path.join(r.dir, CAMINHO), "utf8");
  writeFileSync(path.join(r.dir, CAMINHO), atual.replace(T3_PUBLICA[0], T3_PUBLICA[1]));
  r.g("commit", "-q", "-am", `${CICLO}-F1/T3 — ajusta a T3`);
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "plano-mudou");
});

test("tentativa trazida e não conferida na fase: o re-plano segue perguntando, com a trazida listada", (t) => {
  const r = novoRepo(t);
  r.autorizarCiclo("F1");
  const reg = r.g("commit-tree", r.g("rev-parse", "HEAD^{tree}"), "-p", r.g("rev-parse", "HEAD"), "-m", "Conducao: T2 tentativa 1 trazida", "-m", "Conducao-Nonce: n-traz\nConducao-Sha-Filha: 1234567");
  r.g("update-ref", `refs/conducao-local/${CICLO}/trazida/T2/1`, reg);
  r.replanejar(...T3_PUBLICA);
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "plano-mudou");
  assert.deepEqual(p.trazidas.map((x) => x.task), ["T2"]);
});

test("herança sozinha ou de ruling gravada depois da pré-autorizada não devolve a cobertura da fase", (t) => {
  const r = novoRepo(t, canonico([{ id: "F1", tasks: [task("T1"), task("T2")] }]));
  r.autorizarCiclo("F1");
  const sha = r.replanejar("- **Steps:** faz\n- **Verificação:** `echo verificacao-T1`", "- **Steps:** publica com `vercel --prod`\n- **Verificação:** `echo verificacao-T1`", `${CICLO}-F1/T1 — ajusta a T1`);
  herdarPreautorizado(r, "F1", sha);
  // Re-plano de ruling que não muda classe: herda pelo ruling, apontando o mesmo sim do ciclo.
  r.replanejar("- **Inputs:** `README.md`\n- **Outputs:** `src/t2.mjs`", "- **Inputs:** T1\n- **Outputs:** `src/t2.mjs`", `${CICLO}-F1/D-TESTE1-7 — re-plano de T2: depende da T1`);
  const h = r.proximo();
  assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));
  assert.equal(h.origem, "replano", "a segunda herança é a do ruling, apontando o mesmo sim");
  const v = r.cli("herdar-autorizacao", "F1", "--nonce", h.nonce);
  assert.equal(v.status, 0, v.stderr);
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "task-sensivel", "a T1 de sim próprio, nascida no re-plano pré-autorizado, segue pedindo o dela");
});
