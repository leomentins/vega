/**
 * conducao-vigia.test.mjs — vigia de filha e regra de falha (VEGA-22 T12).
 *
 * Tabela de casos sobre `conducao.mjs proximo`, chamado como CLI em repos git
 * temporários (hooks desligados: core.hooksPath=/dev/null). A data de abertura
 * da tentativa é a do marcador (GIT_COMMITTER_DATE), e o relógio da vigia vem
 * de `entrada.agora` — nenhum caso depende do relógio da máquina.
 *
 * Vigia por estado (VEGA-37 T21): casos sobre `vigia.mjs` no fim do arquivo.
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nonce } from "../conducao.mjs";
import { BOTOES } from "../botoes.mjs";
import * as logEventos from "../log-eventos.mjs";
import * as vigia from "../vigia.mjs";
import { checarTodos, cicloEncerrado } from "../vigia-de-fora.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-vigia";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const ABERTA = 1_800_000_000; // epoch s do marcador de fixture
const ISO = (s) => new Date(s * 1000).toISOString();

// ── fixture ─────────────────────────────────────────────────────────────────

function task(id, extra = ["**Estação:** servidor", "**Independente:** sim"]) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    ...extra.map((e) => `- ${e}`),
    "- **Steps:** faz",
    `- **Verificação:** \`echo ${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

function canonico(tasks, largura = 2) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-10-15",
    "---",
    "",
    "### 1.5 Modo de Execução",
    "",
    `**Largura do ciclo:** ${largura}`,
    "",
    "## 3. Tasks",
    "",
    "### F1 — fase F1 (**Modelo:** opus)",
    "",
    ...tasks,
    "## 4. Pronto",
    "",
  ].join("\n");
}

function novoRepo(tasks = [task("T1"), task("T2")], largura = 2) {
  const dir = pastaTemporaria("conducao-vigia-");
  const g = (args, env = {}) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();
  g(["init", "-q", "-b", "ciclo-teste"]);
  g(["config", "core.hooksPath", "/dev/null"]);
  g(["config", "user.name", "teste"]);
  g(["config", "user.email", "teste@example.invalid"]);
  g(["config", "commit.gpgsign", "false"]);
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  writeFileSync(path.join(dir, CAMINHO), canonico(tasks, largura));
  g(["add", CAMINHO]);
  g(["commit", "-q", "-m", "plano"]);
  const vazio = (...linhas) => g(["commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l])]);
  vazio("Conducao: F1 autorizada", "sim do Rita", `Conducao-Plano: ${g(["rev-parse", `HEAD:${CAMINHO}`])}`);
  /** Tentativa em voo como o `abrir` grava: marcador fora do ramo, datado, + referência local. */
  const emVoo = (t, n, x, quando = ABERTA) => {
    const d = `@${quando} +0000`;
    const marcador = g(["commit-tree", g(["rev-parse", "HEAD^{tree}"]), "-p", g(["rev-parse", "HEAD"]), "-m", `Conducao: abrir ${t} tentativa ${n} nonce ${x}`], {
      GIT_COMMITTER_DATE: d,
      GIT_AUTHOR_DATE: d,
    });
    g(["update-ref", `refs/conducao-local/${CICLO}/${t}/${n}`, marcador]);
  };
  const falhou = (t, n, x, coberta = "nao") => vazio(`Conducao: ${t} tentativa ${n} falhou`, `Conducao-Task: ${t}\nConducao-Nonce: ${x}\ncoberta-por-reinicio: ${coberta}`);
  const conferida = (t, x) =>
    vazio(
      `Conducao: ${t} conferida`,
      `Conducao-Task: ${t}\nConducao-Sha-Filha: 0000000\nConducao-Sessao-Filha: s\nConducao-Nonce: ${x}\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica`,
    );
  const revertida = (t, n, x) => vazio(`Conducao: ${t} tentativa ${n} revertida`, `Conducao-Task: ${t}\nConducao-Nonce: ${x}`);
  return { dir, g, vazio, emVoo, falhou, conferida, revertida, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

function cli(dir, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  return { ...r, linhas: r.stdout.split("\n").filter(Boolean) };
}

/**
 * `ativaDesde` (epoch s) troca o `ActiveEnterTimestamp` da ponte; padrão: 1 s depois do `quando`
 * do registro (reinício confirmado). `stderr` recebe o stderr do verbo.
 */
function proximo(dir, entrada = {}, reinicio, { ativaDesde, stderr } = {}) {
  const args = ["proximo", "--entrada", JSON.stringify({ agora: ISO(ABERTA + 60), ...entrada })];
  if (reinicio) {
    const arq = path.join(dir, ".git", "reinicio.json");
    writeFileSync(arq, JSON.stringify(reinicio));
    args.push("--reinicio", arq, "--ponte-ativa-desde", ISO(ativaDesde ?? Math.floor(Date.parse(reinicio.quando) / 1000) + 1));
  }
  const r = cli(dir, args);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.linhas.length, 1, `uma linha JSON por chamada, veio:\n${r.stdout}`);
  if (stderr) stderr.push(r.stderr);
  return JSON.parse(r.linhas[0]);
}

const filha = (campos) => ({ sessao: "s1", task: "T1", tentativa: 1, nonce: "n1", estado: "RUNNING", ...campos });

// ── tabela da regra de falha ────────────────────────────────────────────────

test("regra de falha por tabela de casos", (t) => {
  const casos = [
    {
      nome: "falha avisada, primeira: tentativa nova automatica com a falha a gravar",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "IDLE", aviso: "T1-FALHA vitest n1" })] },
      espera: (a) => {
        assert.equal(a.acao, "abrir");
        const x = a.tarefas.find((y) => y.task === "T1");
        assert.equal(x.tentativa, 2);
        assert.deepEqual(x.falhaAnterior, { tentativa: 1, coberta: "nao", motivo: "falha-avisada" });
      },
    },
    {
      // P22 do ATRM-51: a pergunta virava `abrir` da tentativa seguinte e contava falha.
      nome: "pergunta da filha: vai a Rita, sem falha a gravar e sem abrir",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "IDLE", aviso: "T1-FALHA pergunta n1" })] },
      espera: (a) => {
        assert.equal(a.acao, "perguntar");
        assert.equal(a.motivo, "pergunta-da-filha");
        assert.equal(a.task, "T1");
        assert.equal(a.tentativa, 1);
        assert.equal(a.sessao, "s1");
        assert.equal(a.nonceTentativa, "n1");
        assert.equal(a.aviso, "T1-FALHA pergunta n1");
        assert.equal(a.registrarFalha, undefined);
        assert.equal(a.tarefas, undefined);
      },
    },
    {
      nome: "pergunta da filha depois de uma falha contada: segue pergunta, nunca segunda-falha",
      montar: (r) => {
        r.emVoo("T1", 1, "n1");
        r.falhou("T1", 1, "n1", "nao");
        r.emVoo("T1", 2, "n2");
      },
      entrada: { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "IDLE", aviso: "T1-FALHA pergunta n2" })] },
      espera: (a) => {
        assert.equal(a.acao, "perguntar");
        assert.equal(a.motivo, "pergunta-da-filha");
        assert.equal(a.tentativa, 2);
        assert.equal(a.registrarFalha, undefined);
      },
    },
    {
      nome: "ARCHIVED com status FAILED e aviso OK: o aviso decide, trazer",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "ARCHIVED", statusBucket: "FAILED", aviso: "T1-OK deadbeef n1" })] },
      espera: (a) => {
        assert.equal(a.acao, "trazer");
        assert.equal(a.sha, "deadbeef");
      },
    },
    {
      nome: "arquivada sem aviso: perguntar, nunca reabrir em silencio",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "ARCHIVED" })] },
      espera: (a) => {
        assert.equal(a.acao, "perguntar");
        assert.equal(a.motivo, "filha-sumiu");
        assert.deepEqual(a.registrarFalha, { task: "T1", tentativa: 1, coberta: "nao" });
      },
    },
    {
      nome: "tentativa sem filha na entrada: perguntar",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { agora: ISO(ABERTA + 121 * 60), filhas: [] },
      espera: (a) => {
        assert.equal(a.acao, "perguntar");
        assert.equal(a.motivo, "tentativa-sem-filha");
      },
    },
    {
      nome: "tentativa sem filha dentro do prazo: reentregar com o mesmo nonce, sem parar",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { agora: ISO(ABERTA + 5 * 60), filhas: [] },
      espera: (a) => {
        assert.equal(a.acao, "reentregar");
        assert.equal(a.motivo, "operaria-nao-nasceu");
        assert.equal(a.tentativa, 1);
        assert.equal(a.nonceTentativa, "n1");
        assert.equal(a.comando, "abrir T1 --tentativa 1 --nonce n1");
        assert.equal(a.registrarFalha, undefined);
      },
    },
    {
      nome: "prazo vencido sem aviso: perguntar",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { agora: ISO(ABERTA + 121 * 60), filhas: [filha()] },
      espera: (a) => {
        assert.equal(a.acao, "perguntar");
        assert.equal(a.motivo, "prazo-vencido");
        assert.equal(a.prazoMin, 120);
      },
    },
    {
      nome: "dentro do prazo, sem aviso: a filha segue em voo",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { agora: ISO(ABERTA + 119 * 60), filhas: [filha()] },
      espera: (a) => {
        assert.notEqual(a.acao, "perguntar");
        assert.ok(!a.tarefas?.some((x) => x.task === "T1"), "T1 em voo não reabre");
      },
    },
    {
      nome: "queda coberta pelo registro de reinicio: reabre sem contar falha, com aviso a Rita",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "ARCHIVED" })] },
      reinicio: { quando: ISO(ABERTA + 30) },
      espera: (a) => {
        assert.equal(a.acao, "abrir");
        const x = a.tarefas.find((y) => y.task === "T1");
        assert.equal(x.tentativa, 2);
        assert.deepEqual(x.falhaAnterior, { tentativa: 1, coberta: "sim", motivo: "reinicio-da-ponte" });
        assert.match(a.avisoOperador.join("\n"), /T1 tentativa 1 caiu no reinício da ponte;/);
      },
    },
    {
      nome: "reinicio anterior a abertura nao cobre a queda",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "ARCHIVED" })] },
      reinicio: { quando: ISO(ABERTA - 30) },
      espera: (a) => assert.equal(a.motivo, "filha-sumiu"),
    },
    {
      nome: "registro velho, confirmado por subida posterior, nao cobre tentativa aberta depois dele",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "ARCHIVED" })] },
      // reinício de 30 dias antes da abertura; a ponte subiu de novo depois (queda da máquina)
      reinicio: { quando: ISO(ABERTA - 30 * 24 * 3600) },
      ativaDesde: ABERTA + 30,
      espera: (a) => assert.equal(a.motivo, "filha-sumiu"),
    },
    {
      nome: "falha coberta por reinicio nao conta: falha avisada seguinte ainda reabre",
      montar: (r) => {
        r.emVoo("T1", 1, "n1");
        r.falhou("T1", 1, "n1", "sim");
        r.emVoo("T1", 2, "n2");
      },
      entrada: { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "IDLE", aviso: "T1-FALHA lint n2" })] },
      espera: (a) => {
        assert.equal(a.acao, "abrir");
        assert.equal(a.tarefas.find((y) => y.task === "T1").tentativa, 3);
      },
    },
    {
      nome: "verificacao vermelha (revertida sem falha): tentativa nova com a falha a gravar",
      montar: (r) => r.revertida("T1", 1, "n1"),
      entrada: { filhas: [] },
      espera: (a) => {
        assert.equal(a.acao, "abrir");
        assert.deepEqual(a.tarefas.find((y) => y.task === "T1").falhaAnterior, { tentativa: 1, coberta: "nao", motivo: "verificacao-vermelha" });
      },
    },
    {
      nome: "verificacao vermelha depois de uma falha contada: perguntar",
      montar: (r) => {
        r.falhou("T1", 1, "n1");
        r.revertida("T1", 2, "n2");
      },
      entrada: { filhas: [] },
      espera: (a) => {
        assert.equal(a.motivo, "segunda-falha");
        assert.deepEqual(a.registrarFalha, { task: "T1", tentativa: 2, coberta: "nao" });
      },
    },
  ];
  for (const c of casos) {
    const r = novoRepo();
    t.after(r.limpar);
    c.montar(r);
    c.espera(proximo(r.dir, c.entrada, c.reinicio, { ativaDesde: c.ativaDesde }));
  }
});

test("registro de reinicio sem subida da ponte depois dele e ignorado com aviso", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.emVoo("T1", 1, "n1");
  const stderr = [];
  // o restart --no-block não aconteceu: a ponte está ativa desde ANTES do registro
  const a = proximo(r.dir, { filhas: [filha({ estado: "ARCHIVED" })] }, { quando: ISO(ABERTA + 30) }, { ativaDesde: ABERTA + 10, stderr });
  assert.equal(a.motivo, "filha-sumiu", "queda não coberta por reinício não confirmado");
  assert.match(stderr.join(""), /registro de reinício ignorado \(ponte-nao-subiu-depois-do-registro\)/);
});

test("reinicio-valido confirma pela hora de subida da ponte", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  const arq = path.join(r.dir, ".git", "reinicio.json");
  writeFileSync(arq, JSON.stringify({ quando: ISO(ABERTA) }));
  const rodar = (...extra) => spawnSync(process.execPath, [SCRIPT, "reinicio-valido", "--arquivo", arq, ...extra], { encoding: "utf8" });
  const ok = rodar("--ponte-ativa-desde", ISO(ABERTA + 5));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).valido, true);
  const nao = rodar("--ponte-ativa-desde", ISO(ABERTA - 5));
  assert.equal(nao.status, 1);
  assert.equal(JSON.parse(nao.stdout).motivo, "ponte-nao-subiu-depois-do-registro");
  writeFileSync(arq, "{ilegivel");
  assert.equal(JSON.parse(rodar("--ponte-ativa-desde", ISO(ABERTA + 5)).stdout).motivo, "registro-ilegivel");
  assert.equal(spawnSync(process.execPath, [SCRIPT, "reinicio-valido"], { encoding: "utf8" }).status, 2);
});

test("segunda falha avisada da mesma task emite perguntar, nunca terceira tentativa", (t) => {
  const r = novoRepo([task("T1")], 1);
  t.after(r.limpar);
  r.emVoo("T1", 1, "n1");
  r.falhou("T1", 1, "n1");
  r.emVoo("T1", 2, "n2");
  const entrada = { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "IDLE", aviso: "T1-FALHA vitest n2" })] };
  const a = proximo(r.dir, entrada);
  assert.equal(a.acao, "perguntar");
  assert.equal(a.motivo, "segunda-falha");
  assert.equal(a.falhas, 1);
  assert.deepEqual(a.registrarFalha, { task: "T1", tentativa: 2, coberta: "nao" });
  // A maestra grava a 2ª falha e arquiva a filha: a task fica parada no teto.
  r.falhou("T1", 2, "n2");
  const b = proximo(r.dir, { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "ARCHIVED", aviso: "T1-FALHA vitest n2" })] });
  assert.equal(b.acao, "perguntar");
  assert.equal(b.motivo, "teto-de-falhas");
  assert.equal(b.falhas, 2);
  assert.notEqual(b.acao, "abrir");
});

test("retomar em sessao nova preserva a contagem de falhas e a segunda falha continua perguntando", (t) => {
  const r = novoRepo([task("T1"), task("T2")], 2);
  t.after(r.limpar);
  r.emVoo("T1", 1, "n1");
  r.falhou("T1", 1, "n1");
  r.emVoo("T2", 1, "m1");
  r.falhou("T2", 1, "m1", "sim");
  r.emVoo("T1", 2, "n2");
  // Sessão nova: nenhum estado além do git — o `retomar` relê as marcas.
  const ret = cli(r.dir, ["retomar"]);
  assert.equal(ret.status, 0, ret.stderr);
  const estado = JSON.parse(ret.linhas[0]);
  assert.deepEqual(estado.falhas, { T1: 1 }, "falha coberta por reinício não entra na contagem");
  assert.deepEqual(estado.emVoo.map((x) => [x.task, x.tentativa]), [["T1", 2]]);
  const a = proximo(r.dir, { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "IDLE", aviso: "T1-FALHA tsc n2" })] });
  assert.equal(a.acao, "perguntar");
  assert.equal(a.motivo, "segunda-falha");
});

// ── rede de arquivamento ────────────────────────────────────────────────────

test("filha com tentativa decidida e fora de ARCHIVED emite arquivar com nonce, uma vez", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.conferida("T1", "n1");
  const viva = filha({ estado: "IDLE", aviso: "T1-OK deadbeef n1" });
  const a = proximo(r.dir, { filhas: [viva] });
  assert.equal(a.acao, "arquivar", "precede o abrir da T2 pronta");
  assert.equal(a.sessao, "s1");
  assert.equal(a.nonceTentativa, "n1");
  assert.equal(a.nonce, nonce(CICLO, "arquivar:s1", "n1", ""));
  // Mesma entrada, mesma ação; HEAD novo não muda o nonce do arquivar.
  assert.deepEqual(proximo(r.dir, { filhas: [viva] }), a);
  r.vazio("outro commit");
  assert.equal(proximo(r.dir, { filhas: [viva] }).nonce, a.nonce);
  // Já arquivada: não emite nada para ela.
  const depois = proximo(r.dir, { filhas: [{ ...viva, estado: "ARCHIVED" }] });
  assert.equal(depois.acao, "abrir");
  assert.deepEqual(depois.tarefas.map((x) => x.task), ["T2"]);
  // Um arquivar executado e ainda viva: repete; dois sem ARCHIVED: falha de arquivamento.
  assert.equal(proximo(r.dir, { filhas: [{ ...viva, arquivamentos: [a.nonce] }] }).acao, "arquivar");
  const p = proximo(r.dir, { filhas: [{ ...viva, arquivamentos: [a.nonce, a.nonce] }] });
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "falha-de-arquivamento");
});

test("sem aviso ou com tentativa ainda nao decidida, nunca arquivar", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.emVoo("T1", 1, "n1");
  // Aviso OK com tentativa ainda em voo: a decisão é trazer, não arquivar.
  assert.equal(proximo(r.dir, { filhas: [filha({ estado: "IDLE", aviso: "T1-OK deadbeef n1" })] }).acao, "trazer");
  // Falha gravada, filha viva sem aviso: a rede não a toca.
  r.falhou("T1", 1, "n1");
  assert.notEqual(proximo(r.dir, { filhas: [filha({ estado: "IDLE" })] }).acao, "arquivar");
  // Falha gravada e aviso FALHA: decidida ⇒ arquivar.
  const a = proximo(r.dir, { filhas: [filha({ estado: "IDLE", aviso: "T1-FALHA vitest n1" })] });
  assert.equal(a.acao, "arquivar");
  assert.equal(a.aviso, "FALHA");
});

// ── verbo de git da falha ───────────────────────────────────────────────────

test("abrir com --falhou grava a falha antes do marcador; registrar-falha e idempotente", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  const origin = pastaTemporaria("conducao-vigia-origin-");
  t.after(() => rmSync(origin, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "--bare", origin]);
  r.g(["remote", "add", "origin", origin]);
  r.g(["config", "remote.origin.mirror", "false"]);
  // Cópia do ciclo nasce como no primeiro `autorizar-fase`.
  const head0 = r.g(["rev-parse", "HEAD"]);
  r.g(["push", "-q", "origin", `${head0}:refs/conducao/${CICLO}/copia`]);
  r.g(["update-ref", `refs/conducao-local/${CICLO}/copia`, head0]);
  r.emVoo("T1", 1, "n1");

  const ab = cli(r.dir, ["abrir", "T1", "--tentativa", "2", "--nonce", "nn22", "--falhou", "1", "--coberta", "nao", "--motivo", "vitest", "--modo-maestra", "auto"]);
  assert.equal(ab.status, 0, ab.stderr);
  const s = JSON.parse(ab.linhas[0]);
  assert.equal(s.acao, "aberta");
  assert.equal(s.falha.acao, "falha-registrada");
  assert.equal(s.falha.nonce, "n1");
  assert.equal(r.g(["log", "-1", "--format=%s", s.base]), "Conducao: T1 tentativa 1 falhou");
  assert.equal(r.g(["log", "-1", "--format=%(trailers:key=coberta-por-reinicio,valueonly=true)", s.base]), "nao");
  assert.equal(r.g(["ls-remote", "origin", `refs/conducao/${CICLO}/copia`]).split("\t")[0], s.base, "a cópia leva o commit da falha");

  const de = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "nao"]);
  assert.equal(de.status, 0, de.stderr);
  assert.equal(JSON.parse(de.linhas[0]).nova, false);
  assert.equal(r.g(["log", "--format=%s", "HEAD"]).split("\n").filter((l) => l === "Conducao: T1 tentativa 1 falhou").length, 1);
  const ruim = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "2", "--coberta", "talvez"]);
  assert.equal(ruim.status, 1);
  assert.match(ruim.stderr, /uso: --coberta sim\|nao/);
});

test("falha de ambiente nao conta no teto, leva trailer proprio e exige motivo (P7 do ATRM-51)", (t) => {
  const r = novoRepo([task("T1"), task("T2")], 2);
  t.after(r.limpar);
  const origin = pastaTemporaria("conducao-vigia-origin-");
  t.after(() => rmSync(origin, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "--bare", origin]);
  r.g(["remote", "add", "origin", origin]);
  const head0 = r.g(["rev-parse", "HEAD"]);
  r.g(["push", "-q", "origin", `${head0}:refs/conducao/${CICLO}/copia`]);
  r.g(["update-ref", `refs/conducao-local/${CICLO}/copia`, head0]);
  r.emVoo("T1", 1, "n1");

  const sem = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "ambiente"]);
  assert.equal(sem.status, 1);
  assert.match(sem.stderr, /motivo-ausente/);

  const ok = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "ambiente", "--motivo", "classificador recusou leitura de producao"]);
  assert.equal(ok.status, 0, ok.stderr);
  const sha = JSON.parse(ok.linhas[0]).sha;
  assert.equal(r.g(["log", "-1", "--format=%(trailers:key=Conducao-Falha-Ambiente,valueonly=true)", sha]), "sim");
  assert.equal(r.g(["log", "-1", "--format=%(trailers:key=coberta-por-reinicio,valueonly=true)", sha]), "nao");

  r.emVoo("T1", 2, "n2");
  const ret = cli(r.dir, ["retomar"]);
  assert.equal(ret.status, 0, ret.stderr);
  assert.deepEqual(JSON.parse(ret.linhas[0]).falhas, {}, "falha de ambiente não entra na contagem");
  // A falha seguinte, de trabalho, é a primeira contada: reabre em vez de parar no teto.
  const a = proximo(r.dir, { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "IDLE", aviso: "T1-FALHA tsc n2" })] });
  assert.equal(a.acao, "abrir", JSON.stringify(a));
});

test("falha de ambiente tem teto proprio e entra pelo abrir --falhou (P7 do ATRM-51)", (t) => {
  const r = novoRepo([task("T1"), task("T2")], 2);
  t.after(r.limpar);
  const origin = pastaTemporaria("conducao-vigia-origin-");
  t.after(() => rmSync(origin, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "--bare", origin]);
  r.g(["remote", "add", "origin", origin]);
  const head0 = r.g(["rev-parse", "HEAD"]);
  r.g(["push", "-q", "origin", `${head0}:refs/conducao/${CICLO}/copia`]);
  r.g(["update-ref", `refs/conducao-local/${CICLO}/copia`, head0]);
  r.emVoo("T1", 1, "n1");
  // 1ª e 2ª falhas de ambiente pelo caminho do `abrir --falhou`, com motivo.
  for (const [n, nonce] of [[2, "nn22"], [3, "nn33"]]) {
    const ab = cli(r.dir, ["abrir", "T1", "--tentativa", String(n), "--nonce", nonce, "--falhou", String(n - 1), "--coberta", "ambiente", "--motivo", "credencial da ponte ausente", "--modo-maestra", "auto"]);
    assert.equal(ab.status, 0, ab.stderr);
    const s = JSON.parse(ab.linhas[0]);
    assert.equal(r.g(["log", "-1", "--format=%(trailers:key=Conducao-Falha-Ambiente,valueonly=true)", s.base]), "sim");
  }
  // Sem motivo, o `abrir --falhou … ambiente` recusa e não abre.
  const semMotivo = cli(r.dir, ["abrir", "T1", "--tentativa", "4", "--nonce", "nn44", "--falhou", "3", "--coberta", "ambiente", "--modo-maestra", "auto"]);
  assert.equal(semMotivo.status, 1);
  assert.equal(r.g(["ls-remote", "origin", `refs/conducao/${CICLO}/T1/4`]), "");
  // 3ª falha de ambiente: não conta no teto de trabalho, mas para no teto próprio.
  const de = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "3", "--coberta", "ambiente", "--motivo", "classificador recusou de novo"]);
  assert.equal(de.status, 0, de.stderr);
  const ret = JSON.parse(cli(r.dir, ["retomar"]).linhas[0]);
  assert.deepEqual(ret.falhas, {});
  assert.deepEqual(ret.falhasAmbiente, { T1: 3 });
  const a = proximo(r.dir, { filhas: [] });
  assert.equal(a.acao, "perguntar", JSON.stringify(a));
  assert.equal(a.motivo, "teto-de-falhas-ambiente");
  assert.equal(a.falhasAmbiente, 3);
});

/**
 * Três tentativas da T1 encerradas com a mesma `coberta`, as duas primeiras pelo
 * `abrir --falhou` e a terceira pelo `registrar-falha`, como a condutora grava.
 */
function comOrigin(t) {
  const r = novoRepo([task("T1"), task("T2")], 2);
  t.after(r.limpar);
  const origin = pastaTemporaria("conducao-vigia-origin-");
  t.after(() => rmSync(origin, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "--bare", origin]);
  r.g(["remote", "add", "origin", origin]);
  const head0 = r.g(["rev-parse", "HEAD"]);
  r.g(["push", "-q", "origin", `${head0}:refs/conducao/${CICLO}/copia`]);
  r.g(["update-ref", `refs/conducao-local/${CICLO}/copia`, head0]);
  return r;
}

/** Aviso da filha como o `esperar-filha` o deixa: commit vazio com a linha, visto localmente ou só no origin. */
function aviso(r, n, linha, { onde = "visto" } = {}) {
  const sha = r.g(["commit-tree", r.g(["rev-parse", "HEAD^{tree}"]), "-m", linha]);
  if (onde === "visto") r.g(["update-ref", `refs/conducao-local/${CICLO}/aviso/T1/${n}`, sha]);
  else r.g(["push", "-q", "origin", `${sha}:refs/conducao-aviso/${CICLO}/T1/${n}`]);
  return sha;
}

function tresEncerradas(t, coberta, motivo) {
  const r = comOrigin(t);
  r.emVoo("T1", 1, "n1");
  const nonces = { 1: "n1", 2: "nn22", 3: "nn33" };
  // Com `pergunta`, cada tentativa encerrada leva o aviso de pergunta da filha.
  const perguntou = (n) => coberta === "pergunta" && aviso(r, n, `T1-FALHA pergunta ${nonces[n]}`);
  for (const n of [2, 3]) {
    perguntou(n - 1);
    const ab = cli(r.dir, ["abrir", "T1", "--tentativa", String(n), "--nonce", nonces[n], "--falhou", String(n - 1), "--coberta", coberta, "--motivo", motivo, "--modo-maestra", "auto"]);
    assert.equal(ab.status, 0, ab.stderr);
  }
  const avisoSha = perguntou(3);
  const de = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "3", "--coberta", coberta, "--motivo", motivo]);
  assert.equal(de.status, 0, de.stderr);
  return { r, sha: JSON.parse(de.linhas[0]).sha, avisoSha };
}

test("pergunta respondida com re-plano encerra a tentativa fora de todo teto (ATRM-54 F4)", (t) => {
  const motivo = "D-ATRM54-24: re-plano, T22 reabre depois das tasks novas";
  const { r, sha, avisoSha } = tresEncerradas(t, "pergunta", motivo);
  // Marca legível no git: subject de falha, trailer próprio, a prova (o aviso), motivo no corpo.
  assert.equal(r.g(["log", "-1", "--format=%s", sha]), "Conducao: T1 tentativa 3 falhou");
  assert.equal(r.g(["log", "-1", "--format=%(trailers:key=Conducao-Falha-Pergunta,valueonly=true)", sha]), "sim");
  assert.equal(r.g(["log", "-1", "--format=%(trailers:key=Conducao-Aviso,valueonly=true)", sha]), avisoSha);
  assert.equal(r.g(["log", "-1", "--format=%(trailers:key=Conducao-Falha-Ambiente,valueonly=true)", sha]), "");
  assert.equal(r.g(["log", "-1", "--format=%(trailers:key=coberta-por-reinicio,valueonly=true)", sha]), "nao");
  assert.match(r.g(["log", "-1", "--format=%b", sha]), /D-ATRM54-24/);
  // O `retomar` mostra as três, e nenhuma soma ao teto de trabalho nem ao de ambiente.
  const ret = JSON.parse(cli(r.dir, ["retomar"]).linhas[0]);
  assert.deepEqual(ret.falhas, {});
  assert.deepEqual(ret.falhasAmbiente, {});
  assert.deepEqual(ret.falhasPergunta, { T1: 3 });
  // O `proximo` aceita a marca e abre a tentativa seguinte, sem `teto-de-falhas-ambiente`.
  const a = proximo(r.dir, { filhas: [] });
  assert.equal(a.acao, "abrir", JSON.stringify(a));
  const x = a.tarefas.find((y) => y.task === "T1");
  assert.ok(x, JSON.stringify(a));
  assert.equal(x.tentativa, 4);
  assert.equal(x.falhaAnterior, undefined);
});

test("controle positivo: tres encerradas por ambiente ainda param no teto de ambiente (ATRM-54 F4)", (t) => {
  const { r } = tresEncerradas(t, "ambiente", "credencial da ponte ausente");
  const ret = JSON.parse(cli(r.dir, ["retomar"]).linhas[0]);
  assert.deepEqual(ret.falhasAmbiente, { T1: 3 });
  assert.deepEqual(ret.falhasPergunta, {});
  const a = proximo(r.dir, { filhas: [] });
  assert.equal(a.acao, "perguntar", JSON.stringify(a));
  assert.equal(a.motivo, "teto-de-falhas-ambiente");
});

test("coberta pergunta exige motivo, no registrar-falha e no abrir --falhou (ATRM-54 F4)", (t) => {
  const r = novoRepo([task("T1"), task("T2")], 2);
  t.after(r.limpar);
  r.emVoo("T1", 1, "n1");
  const sem = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "pergunta"]);
  assert.equal(sem.status, 1);
  assert.match(sem.stderr, /motivo-ausente/);
  const branco = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "pergunta", "--motivo", "   "]);
  assert.equal(branco.status, 1);
  assert.match(branco.stderr, /motivo-ausente/);
  const ab = cli(r.dir, ["abrir", "T1", "--tentativa", "2", "--nonce", "nn22", "--falhou", "1", "--coberta", "pergunta", "--modo-maestra", "auto"]);
  assert.equal(ab.status, 1);
  assert.match(ab.stderr, /motivo-ausente/);
  assert.equal(r.g(["log", "--format=%s", "--grep=falhou"]), "", "recusa sem gravar marca");
});

test("coberta pergunta exige o aviso de pergunta da propria tentativa no git (ATRM-54 F4)", (t) => {
  const r = comOrigin(t);
  r.emVoo("T1", 1, "n1");
  const registrar = () => cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "pergunta", "--motivo", "re-plano"]);
  // Sem aviso nenhum: pergunta, não grava — falha de trabalho não sai do teto por declaração.
  const sem = registrar();
  assert.equal(sem.status, 1);
  assert.equal(JSON.parse(sem.linhas[0]).motivo, "pergunta-sem-aviso");
  // Aviso de falha de trabalho, ou de pergunta de outra tentativa, não prova.
  aviso(r, 1, "T1-FALHA tsc n1");
  assert.equal(JSON.parse(registrar().linhas[0]).motivo, "pergunta-sem-aviso");
  aviso(r, 1, "T1-FALHA pergunta outro-nonce");
  assert.equal(JSON.parse(registrar().linhas[0]).motivo, "pergunta-sem-aviso");
  assert.equal(r.g(["log", "--format=%s", "--grep=falhou"]), "", "recusa sem gravar marca");
  // A pergunta só no origin (ainda não vista pela espera) prova.
  const noOrigin = aviso(r, 1, "T1-FALHA pergunta n1", { onde: "origin" });
  const ok = registrar();
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(r.g(["log", "-1", "--format=%(trailers:key=Conducao-Aviso,valueonly=true)", JSON.parse(ok.linhas[0]).sha]), noOrigin);
});

test("aviso posterior no origin derruba a pergunta ja vista (ATRM-54 F4)", (t) => {
  const r = comOrigin(t);
  r.emVoo("T1", 1, "n1");
  // A filha perguntou (a espera viu), depois falhou de verdade: o aviso atual é o do origin.
  aviso(r, 1, "T1-FALHA pergunta n1");
  aviso(r, 1, "T1-FALHA tsc n1", { onde: "origin" });
  const de = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "pergunta", "--motivo", "re-plano"]);
  assert.equal(de.status, 1);
  const s = JSON.parse(de.linhas[0]);
  assert.equal(s.motivo, "pergunta-sem-aviso");
  assert.match(s.encontrado, /T1-FALHA tsc n1/);
  assert.equal(r.g(["log", "--format=%s", "--grep=falhou"]), "", "recusa sem gravar marca");
});

test("registrar-falha nao reclassifica marca existente de outra coberta (ATRM-54 F4)", (t) => {
  const r = comOrigin(t);
  r.emVoo("T1", 1, "n1");
  const amb = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "ambiente", "--motivo", "  credencial ausente  "]);
  assert.equal(amb.status, 0, amb.stderr);
  assert.equal(r.g(["log", "-1", "--format=%b", JSON.parse(amb.linhas[0]).sha]).split("\n")[0], "credencial ausente", "motivo gravado sem as bordas");
  aviso(r, 1, "T1-FALHA pergunta n1");
  const diverge = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "pergunta", "--motivo", "re-plano"]);
  assert.equal(diverge.status, 1);
  const s = JSON.parse(diverge.linhas[0]);
  assert.equal(s.motivo, "coberta-diverge-da-marca");
  assert.equal(s.gravada, "ambiente");
  assert.equal(s.pedida, "pergunta");
  // A mesma coberta segue idempotente.
  const igual = JSON.parse(cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "ambiente", "--motivo", "x"]).linhas[0]);
  assert.equal(igual.nova, false);
  assert.equal(igual.coberta, "ambiente");
});

// ── vigia por estado (VEGA-37 T21) ──────────────────────────────────────────
// Funções de `vigia.mjs` sobre linhas montadas por `linhasDoEvento`; o
// relógio é o `agora` passado, nunca o da máquina.

const CV = "TESTE-1-vigia";
const T0 = Date.parse("2026-11-14T12:00:00.000Z");
const em = (min) => new Date(T0 + min * 60_000).toISOString();
const ev = (saida, min) => logEventos.linhasDoEvento({ ciclo: CV, ...saida }, { procedencia: "observado", quando: em(min) }).linhas;
const vida = (estado, min, extra = {}) => {
  const j = vigia.janelaDoSinal(estado);
  return ev(vigia.sinalDeVida({ ciclo: CV, estado, intervaloMin: j ? j.de : 30, agora: em(min), ...extra }), min);
};
const pastaTmp = (t) => {
  const p = pastaTemporaria("vigia-log-");
  t.after(() => rmSync(p, { recursive: true, force: true }));
  return p;
};

test("prazo por estado sai dos botões da T3 e o sinal de vida fica entre 0,5 e 0,8 do prazo", () => {
  assert.equal(vigia.prazoDoEstado("operaria"), BOTOES.prazoOperariaEmCursoMin);
  assert.equal(vigia.prazoDoEstado("ci"), BOTOES.prazoCiEmCursoMin);
  assert.equal(vigia.prazoDoEstado("livre"), BOTOES.prazoCondutoraLivreMin);
  assert.equal(vigia.prazoDoEstado("pergunta"), null);
  assert.deepEqual([BOTOES.prazoOperariaEmCursoMin, BOTOES.prazoCiEmCursoMin, BOTOES.prazoCondutoraLivreMin], [129, 66, 52], "p99 + 5 min da T3, opção 6c da T6");
  assert.deepEqual(vigia.janelaDoSinal("livre"), { de: 26, ate: 41.6, prazoMin: 52 });
  assert.doesNotThrow(() => vigia.sinalDeVida({ ciclo: CV, estado: "livre", intervaloMin: 26 }));
  assert.doesNotThrow(() => vigia.sinalDeVida({ ciclo: CV, estado: "livre", intervaloMin: 41.6 }));
  assert.throws(() => vigia.sinalDeVida({ ciclo: CV, estado: "livre", intervaloMin: 25 }), /fora da janela/);
  assert.throws(() => vigia.sinalDeVida({ ciclo: CV, estado: "livre", intervaloMin: 42 }), /fora da janela/);
  assert.throws(() => vigia.sinalDeVida({ ciclo: CV, estado: "dormindo", intervaloMin: 30 }), /estado da vigia desconhecido/);
  assert.throws(() => vigia.sinalDeVida({ ciclo: CV, estado: "livre" }), /--intervalo/);
});

test("pergunta aberta ao operador não conta como queda", () => {
  // Sinal de vida em `pergunta`: um dia de silêncio, nunca queda.
  const d1 = vigia.decidir({ linhas: vida("pergunta", 0), agora: em(24 * 60) });
  assert.equal(d1.situacao, "esperando-operador");
  assert.equal(d1.avisar, false);
  // `perguntar` gravado depois de um `vida` trabalhando também abre a espera.
  const perguntou = [...vida("livre", 0), ...ev({ acao: "perguntar", motivo: "teto-de-falhas" }, 5)];
  const d2 = vigia.decidir({ linhas: perguntou, agora: em(600) });
  assert.equal(d2.situacao, "esperando-operador");
  assert.equal(d2.avisar, false);
  // Controle: o mesmo silêncio sem pergunta é queda.
  const d3 = vigia.decidir({ linhas: vida("livre", 0), agora: em(600) });
  assert.equal(d3.situacao, "queda");
  assert.equal(d3.avisar, true);
  // A resposta chega com um `vida` novo trabalhando: o prazo volta a contar dele.
  const respondida = [...perguntou, ...vida("livre", 300)];
  assert.equal(vigia.decidir({ linhas: respondida, agora: em(320) }).situacao, "vivo");
  assert.equal(vigia.decidir({ linhas: respondida, agora: em(300 + 53) }).situacao, "queda");
});

test("sem sinal de vida o ciclo é desconhecido, nunca queda, e cada checagem grava uma linha", (t) => {
  const pasta = pastaTmp(t);
  // Log do motor de `main`: eventos da condução, nenhum `vida`.
  logEventos.registrar({ acao: "abrir", ciclo: CV, fase: "F1", task: "T1", tentativa: 1 }, { procedencia: "intencao", quando: em(0), pasta });
  for (const min of [600, 605, 610]) {
    const r = vigia.checar({ ciclo: CV, agora: em(min), pastaDoLog: pasta, avisar: true });
    assert.equal(r.situacao, "desconhecido");
    assert.equal(r.avisar, false);
  }
  const doCiclo = logEventos.lerLog(logEventos.arquivoDoLog(CV, pasta)).filter((l) => l.linha === "evento");
  assert.deepEqual(doCiclo.map((l) => l.acao), ["abrir"], "nenhuma queda nem aviso no log do ciclo");
  const checagens = logEventos.lerLog(logEventos.arquivoDoLog(CV, vigia.pastaDaVigia(pasta))).filter((l) => l.linha === "evento");
  assert.equal(checagens.length, 3, "uma linha por checagem");
  assert.ok(checagens.every((l) => l.acao === "checagem" && l.atributos.estado === "desconhecido"));
});

test("queda avisa no vencimento e o aviso repetido dobra o intervalo", (t) => {
  const pasta = pastaTmp(t);
  logEventos.registrar(vigia.sinalDeVida({ ciclo: CV, estado: "ci", intervaloMin: 33, agora: em(0) }), { procedencia: "observado", quando: em(0), pasta });
  const ck = (min) => vigia.checar({ ciclo: CV, agora: em(min), pastaDoLog: pasta, avisar: true });
  assert.equal(ck(66).situacao, "vivo", "no prazo exato ainda vivo");
  const a1 = ck(67);
  assert.equal(a1.situacao, "queda");
  assert.equal(a1.avisar, true);
  assert.equal(a1.intervaloMin, 66);
  // O segundo aviso espera 66 × 2 desde o primeiro.
  const espera = ck(67 + 131);
  assert.equal(espera.avisar, false);
  assert.equal(espera.motivo, "dobra-do-aviso");
  assert.equal(espera.intervaloMin, 132);
  const a2 = ck(67 + 132);
  assert.equal(a2.avisar, true);
  assert.equal(a2.vezes, 1);
  const a3 = ck(67 + 132 + 263);
  assert.equal(a3.avisar, false, "o terceiro espera 264");
  assert.equal(a3.intervaloMin, 264);
  const eventosDoCiclo = logEventos.lerLog(logEventos.arquivoDoLog(CV, pasta)).filter((l) => l.linha === "evento");
  assert.equal(eventosDoCiclo.filter((l) => l.acao === "queda").length, 1, "a queda grava uma vez por sinal de vida");
  const avisos = eventosDoCiclo.filter((l) => l.acao === "aviso-da-vigia");
  assert.deepEqual(avisos.map((l) => l.atributos.vezes), [1, 2]);
  const chaveVida = eventosDoCiclo.find((x) => x.acao === "vida").chave;
  assert.ok(avisos.every((l) => l.atributos.ref === chaveVida));
});

test("avisos por dia contam pelo dia America/Sao_Paulo e param no teto", () => {
  // 02:30Z do dia 15 ainda é 23:30 do dia 14 em São Paulo.
  assert.equal(vigia.diaBrt("2026-11-15T02:30:00.000Z"), "2026-11-14");
  assert.equal(vigia.diaBrt("2026-11-15T03:00:00.000Z"), "2026-11-15");
  const aviso = (quando) =>
    logEventos.linhasDoEvento({ acao: "aviso-da-vigia", ciclo: "OUTRO-1-x", ref: quando.replace(/\W/g, ""), vezes: 1 }, { procedencia: "observado", quando }).linhas;
  // Dois avisos de outro ciclo no dia BRT 14 (um já é dia 15 em UTC), mais o aviso da filha, que não conta.
  const outros = [...aviso("2026-11-14T15:00:00.000Z"), ...aviso("2026-11-15T02:00:00.000Z"), ...ev({ acao: "aviso", aviso: "T1-OK" }, 0)];
  assert.equal(vigia.avisosNoDia(outros, "2026-11-15T02:50:00.000Z"), 2);
  assert.equal(vigia.avisosNoDia(outros, "2026-11-15T03:10:00.000Z"), 0, "virou o dia em São Paulo");
  const inicio = "2026-11-15T00:00:00.000Z";
  const linhas = logEventos.linhasDoEvento(vigia.sinalDeVida({ ciclo: CV, estado: "livre", intervaloMin: 26, agora: inicio }), { procedencia: "observado", quando: inicio }).linhas;
  const todas = [...linhas, ...outros];
  const noTeto = vigia.decidir({ linhas, agora: "2026-11-15T02:50:00.000Z", todasAsLinhas: todas });
  assert.equal(noTeto.situacao, "queda");
  assert.equal(noTeto.avisar, false);
  assert.equal(noTeto.motivo, "teto-do-dia");
  assert.equal(noTeto.teto, BOTOES.tetoAvisosPorDia);
  const diaSeguinte = vigia.decidir({ linhas, agora: "2026-11-15T03:10:00.000Z", todasAsLinhas: todas });
  assert.equal(diaSeguinte.avisar, true);
  // O dia gravado no aviso é o de São Paulo; o `quando` segue UTC.
  const [, av] = vigia.eventosDaQueda(CV, diaSeguinte, "2026-11-15T03:10:00.000Z");
  assert.equal(av.dia, "2026-11-15");
});

test("sinal de vida guarda o despertador para o seguinte cancelar o anterior", () => {
  const linhas = [...vida("livre", 0, { despertador: "trig_aaa" }), ...vida("operaria", 20, { despertador: "trig_bbb" })];
  assert.equal(vigia.despertadorAnterior(linhas), "trig_bbb");
  assert.equal(vigia.decidir({ linhas, agora: em(30) }).despertador, "trig_bbb");
  assert.equal(vigia.despertadorAnterior([]), null);
});

test("eventos da vigia passam o esquema do log v1", () => {
  const d = vigia.decidir({ linhas: vida("operaria", 0, { despertador: "trig_x", fase: "F3" }), agora: em(200) });
  const saidas = [vigia.sinalDeVida({ ciclo: CV, estado: "ci", intervaloMin: 40, despertador: "trig_y", fase: "F3", agora: em(0) }), ...vigia.eventosDaQueda(CV, d, em(200))];
  assert.deepEqual(saidas.map((s) => s.acao), ["vida", "queda", "aviso-da-vigia"]);
  for (const s of saidas) {
    const { linhas, descartados } = logEventos.linhasDoEvento(s, { procedencia: "observado", quando: em(200) });
    assert.deepEqual(descartados, [], `${s.acao} sem chave descartada`);
    for (const l of linhas) assert.deepEqual(logEventos.conferirEsquema(l), [], `${s.acao}: ${JSON.stringify(l)}`);
  }
});

// ── checagem de fora e ciclo fechado (VEGA-37 T35, D-VEGA37-37) ─────────────

test("ciclo fechado não conta na checagem de fora", async (t) => {
  const pasta = pastaTmp(t);
  const FECHADO = "TESTE-2-fechado";
  const FASE = "TESTE-3-fase-encerrada";
  for (const c of [CV, FECHADO, FASE])
    logEventos.registrar(vigia.sinalDeVida({ ciclo: c, estado: "ci", intervaloMin: 33, agora: em(0) }), { procedencia: "observado", quando: em(0), pasta });
  // git da raiz: o ramo do fechado leva a marca do ciclo; o da fase só a de uma fase; o de CV, nada.
  const raiz = pastaTmp(t);
  const g = (...a) => execFileSync("git", ["-C", raiz, ...a], { encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.name", "t");
  g("config", "user.email", "t@t");
  g("config", "core.hooksPath", "/dev/null");
  g("commit", "-q", "--allow-empty", "-m", "raiz");
  const marca = (ramo, fase) => {
    g("checkout", "-q", "-b", ramo, "main");
    g("commit", "-q", "--allow-empty", "-m", `Conducao: ${fase} sessao encerrada`, "-m", `Conducao-Encerrada: ${fase}\nConducao-Nonce: abc`);
  };
  marca(`ciclo-${FECHADO}`, "ciclo");
  marca(`ciclo-${FASE}-slug`, "F1");
  g("checkout", "-q", "-b", `ciclo-${CV}`, "main");

  const checar = (repo) => checarTodos({ pastaDoLog: pasta, agora: em(200), arquivoModo: null, arquivoTopico: null, repo });
  const r = await checar(raiz);
  assert.deepEqual(r.encerrados, [FECHADO]);
  assert.deepEqual(r.ciclos.map((c) => c.ciclo).sort(), [CV, FASE].sort(), "fase encerrada não fecha o ciclo");
  assert.ok(r.ciclos.every((c) => c.situacao === "queda"));
  const doFechado = logEventos.lerLog(logEventos.arquivoDoLog(FECHADO, pasta)).filter((l) => l.linha === "evento");
  assert.deepEqual(doFechado.map((l) => l.acao), ["vida"], "nenhuma queda no log do fechado");
  const checagens = logEventos.lerLog(logEventos.arquivoDoLog(FECHADO, vigia.pastaDaVigia(pasta))).filter((l) => l.linha === "evento");
  assert.deepEqual(checagens, [], "nenhuma checagem do fechado");
  // sem critério legível (raiz sem git): o ciclo segue checado
  const semGit = await checar(pastaTmp(t));
  assert.deepEqual(semGit.encerrados, []);
  assert.ok(semGit.ciclos.some((c) => c.ciclo === FECHADO));
});

test("ciclo fechado com o ramo apagado depois da mescla segue fora da checagem", async (t) => {
  const pasta = pastaTmp(t);
  const MESCLADO = "TESTE-4-mesclado";
  const PREFIXO = "TESTE-4-mescla"; // id que é prefixo de outro: não herda o fechamento
  const SO_FASE = "TESTE-5-so-fase";
  for (const c of [CV, MESCLADO, PREFIXO, SO_FASE])
    logEventos.registrar(vigia.sinalDeVida({ ciclo: c, estado: "ci", intervaloMin: 33, agora: em(0) }), { procedencia: "observado", quando: em(0), pasta });
  const raiz = pastaTmp(t);
  const g = (...a) => execFileSync("git", ["-C", raiz, ...a], { encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.name", "t");
  g("config", "user.email", "t@t");
  g("config", "core.hooksPath", "/dev/null");
  g("commit", "-q", "--allow-empty", "-m", "raiz");
  // o squash do ciclo mesclado: a marca no meio do corpo, como em 1ef190a4b
  const corpo = (fase) =>
    ["* Conducao: abrir T2 tentativa 1 nonce abc", "", "Conducao-Task: T2", "", `* Conducao: ${fase} sessao encerrada`, "", `Conducao-Encerrada: ${fase}`, "", "* outro commit"].join("\n");
  g("commit", "-q", "--allow-empty", "-m", `${MESCLADO} — mesclado (#1)`, "-m", corpo("ciclo"));
  g("commit", "-q", "--allow-empty", "-m", `${SO_FASE} — só a fase (#2)`, "-m", corpo("F1"));
  // o ramo do ciclo nunca existiu aqui (apagado na mescla); só o principal do origin tem o squash
  g("update-ref", "refs/remotes/origin/main", "HEAD");
  g("checkout", "-q", "--detach");
  g("commit", "-q", "--allow-empty", "-m", `${CV} — local, fora do origin`, "-m", corpo("ciclo"));
  g("branch", "-q", "-D", "main");
  assert.equal(g("for-each-ref", "--format=%(refname)", `refs/heads/ciclo-${MESCLADO}`, `refs/remotes/*/ciclo-${MESCLADO}`), "");

  const checar = (repo) => checarTodos({ pastaDoLog: pasta, agora: em(200), arquivoModo: null, arquivoTopico: null, repo });
  const r = await checar(raiz);
  assert.deepEqual(r.encerrados, [MESCLADO]);
  assert.deepEqual(r.ciclos.map((c) => c.ciclo).sort(), [CV, PREFIXO, SO_FASE].sort(), "fase encerrada, prefixo e commit fora do origin não fecham");
  const doMesclado = logEventos.lerLog(logEventos.arquivoDoLog(MESCLADO, pasta)).filter((l) => l.linha === "evento");
  assert.deepEqual(doMesclado.map((l) => l.acao), ["vida"], "nenhuma queda no log do mesclado");
  // origin/HEAD apontando para o principal vale igual
  g("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  assert.equal(cicloEncerrado(raiz, MESCLADO), true);
  assert.equal(cicloEncerrado(raiz, PREFIXO), false);
});

test("três ciclos em queda na mesma passada param no teto do dia", async (t) => {
  const pasta = pastaTmp(t);
  const ciclos = ["TESTE-4-a", "TESTE-5-b", "TESTE-6-c"];
  for (const c of ciclos)
    logEventos.registrar(vigia.sinalDeVida({ ciclo: c, estado: "ci", intervaloMin: 33, agora: em(0) }), { procedencia: "observado", quando: em(0), pasta });
  const cfg = pastaTmp(t);
  const arquivoModo = path.join(cfg, "modo");
  const arquivoTopico = path.join(cfg, "topico");
  writeFileSync(arquivoModo, "ligado\n");
  writeFileSync(arquivoTopico, "topico-de-teste\n");
  const enviados = [];
  const enviar = async (a) => (enviados.push(a), { ok: true, motivo: null });
  const r = await checarTodos({ pastaDoLog: pasta, agora: em(200), arquivoModo, arquivoTopico, repo: null, enviar });
  assert.equal(enviados.length, BOTOES.tetoAvisosPorDia, "envios na passada param no teto");
  const barrado = r.ciclos.filter((c) => c.situacao === "queda" && !c.avisar);
  assert.equal(barrado.length, ciclos.length - BOTOES.tetoAvisosPorDia);
  assert.ok(barrado.every((c) => c.motivo === "teto-do-dia"));
});
