/**
 * fase-sem-publicacao.test.mjs — fase sem verbo de publicação começa pelo sim do ciclo e só avisa
 * (ruling do operador, 24/11/2026, D29 do L4).
 *
 * Caso medido: no L4, o re-plano pré-autorizado da F1 fez uma task nascer `fechamento`. A classe
 * divergiu do plano congelado no sim do ciclo (`cicloCobre` falso), e a F2 — sem publicação, sem
 * re-plano novo desde a última autorização — voltava a pedir `autorizar-ciclo`. Agora a F2 herda
 * pelo sim do ciclo (`herdar-autorizacao`, origem `ciclo`) e a condutora só avisa. Fase com verbo de
 * publicação, na mesma situação, segue perguntando como antes; o `publicacao-gate.js` não muda.
 *
 * Hooks desligados no repo de teste (core.hooksPath=/dev/null); origin bare em pasta temporária.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

function task(id, { steps = "faz", fase = "F1" } = {}) {
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
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

function canonico(fases) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-11-24",
    "---",
    "",
    "## 1. Goal",
    "",
    "### 1.5 Modo de Execução",
    "",
    "**Largura do ciclo:** 1",
    "",
    "## 3. Tasks",
    "",
    ...fases.map(({ id, tasks }) => [`### ${id} — fase ${id} (**Modelo:** sonnet)`, "", ...tasks].join("\n")),
    "## 4. Pronto",
    "",
  ].join("\n");
}

function novoRepo(t, texto) {
  const raiz = pastaTemporaria("fase-sem-publicacao-");
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
  const replanejar = (de, para, subject) => {
    const atual = readFileSync(path.join(dir, CAMINHO), "utf8");
    assert.ok(atual.includes(de), de);
    writeFileSync(path.join(dir, CAMINHO), atual.replace(de, para));
    g("commit", "-q", "-am", subject);
    return g("rev-parse", "HEAD");
  };
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  // O push de fim de fase (`empurrar-ramo`) vem antes da fase nova.
  const proximo = () => {
    for (let i = 0; i < 3; i++) {
      const r = cli("proximo");
      assert.equal(r.status, 0, r.stderr);
      const p = JSON.parse(r.stdout.trim());
      if (p.acao !== "empurrar-ramo") return p;
      // Sem proposta no repo de teste: a ponta vai ao origin pelo git, como o verbo a deixaria.
      g("push", "-q", "origin", `HEAD:refs/heads/${p.ramo}`);
    }
    assert.fail("empurrar-ramo em laço");
  };
  const herdar = (fase, origem) => {
    const h = proximo();
    assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));
    assert.equal(h.fase, fase);
    assert.equal(h.origem, origem, JSON.stringify(h));
    const v = cli("herdar-autorizacao", fase, "--nonce", h.nonce);
    assert.equal(v.status, 0, v.stderr);
    assert.equal(g("log", "-1", "--format=%s"), `Conducao: ${fase} autorizada`);
    return { h, v };
  };
  /**
   * O percurso da F1 do L4: o sim do ciclo na F1, o re-plano pré-autorizado que muda a classe da T3
   * (no L4, a T47 nasceu `fechamento`; aqui a T3 vai de `comum` a `condutora`, que muda a classe do
   * mesmo jeito sem pôr o CI no fechamento da F1), a F1 inteira conferida e encerrada. Com
   * `tambemNaF2`, o mesmo re-plano muda também a classe da T4, da F2. Devolve o sha do sim do ciclo.
   */
  const percursoDaF1 = ({ tambemNaF2 = false } = {}) => {
    vazio("Conducao: F1 autorizada", "sim, pode tocar o ciclo inteiro", `Conducao-Plano: ${blob()}\nConducao-Ciclo: sim`);
    const sim = g("rev-parse", "HEAD");
    replanejar("`src/t3.mjs` (create)\n- **Estação:** servidor", "`src/t3.mjs` (create)\n- **Estação:** condutora", `${CICLO}-F1/T3 — a T3 roda na condutora`);
    if (tambemNaF2) replanejar("`src/t4.mjs` (create)\n- **Estação:** servidor", "`src/t4.mjs` (create)\n- **Estação:** condutora", `${CICLO}-F1/T3 — a T4 roda na condutora`);
    herdar("F1", "preautorizado");
    for (const id of ["T1", "T2", "T3"]) vazio(`Conducao: ${id} conferida`, `Conducao-Task: ${id}`);
    vazio("Conducao: F1 encerrada");
    return sim;
  };
  return { dir, g, proximo, herdar, percursoDaF1 };
}

const F1 = { id: "F1", tasks: [task("T1"), task("T2"), task("T3")] };

test("caso F2 do L4: fase sem publicação, depois de re-plano pré-autorizado que mudou classe, herda pelo sim do ciclo e só avisa", (t) => {
  const r = novoRepo(t, canonico([F1, { id: "F2", tasks: [task("T4", { fase: "F2" }), task("T5", { fase: "F2" })] }]));
  const sim = r.percursoDaF1();
  const { h, v } = r.herdar("F2", "ciclo");
  assert.equal(h.autorizacao, sim, "a herança aponta o sim do ciclo");
  assert.match(h.aviso, /sem publicação/);
  assert.match(h.aviso, /divergem do plano do sim, em fase anterior: T3/, "o aviso diz o que divergiu do sim");
  assert.match(v.stderr, /F2 começa pelo sim do ciclo/);
  assert.match(r.g("log", "-1", "--format=%B"), /^Conducao-Origem: ciclo$/m);
  assert.match(r.g("log", "-1", "--format=%B"), new RegExp(`^Conducao-Herdada: ${sim}$`, "m"));
  const a = r.proximo();
  assert.equal(a.acao, "abrir", JSON.stringify(a));
});

test("fase com verbo de publicação, na mesma situação, segue pedindo o sim do ciclo", (t) => {
  const r = novoRepo(t, canonico([F1, { id: "F2", tasks: [task("T4", { fase: "F2", steps: "publica com `vercel --prod`" }), task("T5", { fase: "F2" })] }]));
  r.percursoDaF1();
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "autorizar-ciclo");
  assert.equal(p.fase, "F2");
});

test("fase sem publicação com plano mudado desde a última autorização não herda por esta regra", (t) => {
  const r = novoRepo(t, canonico([F1, { id: "F2", tasks: [task("T4", { fase: "F2" })] }]));
  r.percursoDaF1();
  // Merge de fora que traz o canonico: re-plano que não é do ciclo, e a pré-autorização não o cobre.
  const atual = readFileSync(path.join(r.dir, CAMINHO), "utf8");
  r.g("checkout", "-q", "-b", "fora");
  writeFileSync(path.join(r.dir, CAMINHO), atual.replace("`echo verificacao-T4`", "`echo verificacao-T4-nova`"));
  r.g("commit", "-q", "-am", "outro ramo mexe no canonico");
  r.g("checkout", "-q", "ciclo-teste");
  r.g("merge", "-q", "--no-ff", "-m", "merge de fora", "fora");
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "autorizar-ciclo");
});

test("fase sem publicação com task que mudou de classe desde o sim do ciclo segue pedindo o sim do ciclo", (t) => {
  const r = novoRepo(t, canonico([F1, { id: "F2", tasks: [task("T4", { fase: "F2" }), task("T5", { fase: "F2" })] }]));
  r.percursoDaF1({ tambemNaF2: true });
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "autorizar-ciclo");
  assert.equal(p.fase, "F2");
});
