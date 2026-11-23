/**
 * criar-condutora.test.mjs — a criação de sessão da condução depois da
 * VEGA-37 T8.
 *
 * O nível da maestra (`proximo --nivel maestra`, VEGA-29 T37) saiu: a
 * condutora que fecha a fase cria a seguinte (`dois-papeis.test.mjs`). Fica
 * aqui o fechamento do ciclo: desde a T10, o `fechar-ciclo` leva o
 * `criar-condutora` de fase `fechamento` (`regraFecharCiclo`); a
 * `maestraCriarFechamento`, sem chamador no `proximo`, segue enquanto o
 * contrato escrito a descreve. As duas chamadas direto sobre as marcas do
 * repo, e o laço da condutora sem a flag.
 *
 * Repos git temporários com hooks desligados (core.hooksPath=/dev/null), o
 * script chamado como CLI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textoDoFechamento } from "../conducao.mjs";
import { lerMarcas } from "../marcas.mjs";
import { maestraCriarFechamento, nomeDaCondutora, regraFecharCiclo } from "../regras.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

function task(id, fase) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    "- **Steps:** faz",
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

const CANONICO = [
  "---",
  `cycle: ${CICLO}`,
  "opened: 2026-10-15",
  "---",
  "",
  "## 1. Goal",
  "",
  "## 3. Tasks",
  "",
  "### F1 — fase um (**Modelo:** opus)",
  "",
  task("T1", "F1"),
  "### F2 — fase dois (**Modelo:** sonnet)",
  "",
  task("T2", "F2"),
  "## 4. Pronto",
  "",
].join("\n");

function novoRepo(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "criar-condutora-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "ciclo-teste");
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  writeFileSync(path.join(dir, CAMINHO), CANONICO);
  g("add", CAMINHO);
  g("commit", "-q", "-m", "plano");
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  const autorizar = (fase) => vazio(`Conducao: ${fase} autorizada`, "sim do operador", `Conducao-Plano: ${g("rev-parse", `HEAD:${CAMINHO}`)}\nConducao-Ciclo: sim`);
  const encerrar = (fase) => vazio(`Conducao: ${fase} sessao encerrada`, `Conducao-Encerrada: ${fase}\nConducao-Nonce: 0123456789abcdef`);
  return { dir, autorizar, encerrar };
}

function rodar(dir, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  return { ...r, linhas: r.stdout.split("\n").filter(Boolean) };
}

const condutora = (sessao, fase, estado = "RUNNING", extra = {}) => ({ sessao, fase, estado, ...extra });

/** `maestraCriarFechamento` sobre as marcas do repo, com a fábrica de ação mínima. */
function fechamento(dir, condutoras, entrada = {}) {
  const marcas = lerMarcas(dir);
  const plano = { fases: [{ id: "F1" }, { id: "F2" }] };
  return maestraCriarFechamento({
    ciclo: CICLO,
    repo: dir,
    acao: (tipo, alvo, tentativa, campos) => ({ acao: tipo, alvo, tentativa, ...campos }),
    plano,
    encerradas: new Set(marcas.filter((m) => m.tipo === "encerrada").map((m) => m.fase)),
    autorizadas: new Set(marcas.filter((m) => m.tipo === "autorizada").map((m) => m.fase)),
    condutoras,
    entrada,
    textoDoFechamento,
  });
}

test("ciclo encerrado: o fechamento nasce uma vez e espera enquanto ele vive", (t) => {
  const r = novoRepo(t);
  r.autorizar("F1");
  r.encerrar("F1");
  assert.equal(fechamento(r.dir, []), null, "sem Conducao-Encerrada: ciclo, nada");
  r.encerrar("ciclo");

  const filhas = [condutora("s1", "F1", "ARCHIVED"), condutora("s2", "F2", "ARCHIVED")];
  const f = fechamento(r.dir, filhas);
  assert.equal(f.acao, "criar-fechamento");
  assert.match(f.texto, /^feche o ciclo TESTE-1-conducao numa sessão limpa/);
  assert.match(f.texto, /archive_session da condutora anterior s2 antes da auditoria/);
  assert.match(f.texto, /--exigir-encerramentos F1,ciclo/);

  const viva = fechamento(r.dir, [...filhas, condutora("s3", "ciclo")]);
  assert.equal(viva.acao, "esperar");
  assert.equal(viva.motivo, "condutora-viva");

  const depois = fechamento(r.dir, [...filhas, condutora("s3", "ciclo", "ARCHIVED")]);
  assert.equal(depois.acao, "esperar");
  assert.equal(depois.motivo, "fechamento-em-sessao-limpa");

  assert.equal(fechamento(r.dir, filhas, { proposta: { state: "MERGED" } }).motivo, "mesclado");
});

test("sem a flag, o laço da condutora sai igual", (t) => {
  const r = novoRepo(t);
  const semSim = rodar(r.dir, ["proximo"]);
  assert.equal(semSim.status, 0, semSim.stderr);
  const p = JSON.parse(semSim.linhas[0]);
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "autorizar-ciclo");
  assert.equal(p.nivel, undefined);

  r.autorizar("F1");
  const a = JSON.parse(rodar(r.dir, ["proximo"]).linhas[0]);
  assert.equal(a.acao, "abrir");
  assert.equal(a.nivel, undefined);
  assert.deepEqual(a.tarefas.map((x) => x.task), ["T1"]);
});

/**
 * `regraFecharCiclo` com o contexto mínimo da última fase fechada (VEGA-37
 * T10): fábrica de ação com nonce por alvo, como a do `proximo`.
 */
function fecharCiclo(dir, entrada = {}, extra = {}) {
  const marcas = lerMarcas(dir);
  const plano = { fases: [{ id: "F1", tasks: [] }, { id: "F2", tasks: [] }], porId: new Map() };
  return regraFecharCiclo({
    ciclo: CICLO,
    repo: dir,
    head: "h".repeat(40),
    acao: (tipo, alvo, tentativa, campos) => ({ acao: tipo, alvo, tentativa, nonce: `${alvo}#${tentativa}`, ...campos }),
    plano,
    planoHead: null,
    estado: { feitas: new Set() },
    reautorizada: () => false,
    encerradas: new Set(marcas.filter((m) => m.tipo === "encerrada").map((m) => m.fase)),
    autorizadas: new Set(marcas.filter((m) => m.tipo === "autorizada").map((m) => m.fase)),
    iPrimeira: 0,
    fase: null,
    entrada,
    temCi: true,
    textoDoFechamento,
    fechamentoDoCiclo: () => null,
    ...extra,
  });
}

test("fechar-ciclo cria a condutora de fechamento", (t) => {
  const r = novoRepo(t);
  r.autorizar("F1");
  r.encerrar("F1");
  r.autorizar("F2");
  const verde = { ci: { sha: "h".repeat(40), veredito: "verde", run: 7 }, sessaoMaestra: "session_condutora_f2" };
  const f = fecharCiclo(r.dir, verde);
  assert.equal(f.acao, "fechar-ciclo");
  assert.equal(f.fase, "ciclo");
  assert.equal(f.nivel, undefined, "sem nível acima");
  const c = f.criar;
  assert.ok(c, "o fechar-ciclo leva o criar-condutora");
  assert.equal(c.acao, "criar-condutora");
  assert.equal(c.fase, "fechamento");
  assert.equal(c.nome, nomeDaCondutora(CICLO, "fechamento"));
  assert.equal(c.nome, `${CICLO} · fechamento`);
  assert.equal(c.modelo, null);
  assert.equal(c.tentativa, 1);
  assert.equal(c.sessaoLimpa, true);
  assert.notEqual(c.nonce, f.nonce, "criar e fechar têm nonce próprio");
  // O prompt é o texto do fechamento do projeto: auditoria, limpeza e o
  // arquivamento da condutora que fecha a última fase — nunca a maestra.
  assert.match(c.texto, /^feche o ciclo TESTE-1-conducao numa sessão limpa/);
  assert.match(c.texto, /da condutora anterior session_condutora_f2 antes da auditoria/);
  assert.match(c.texto, /--exigir-fases F1,F2 --exigir-encerramentos F1,ciclo/);
  assert.doesNotMatch(c.texto, /maestra/);
  // Mesmo estado, mesma criação (a condutora desduplica pelo nonce).
  assert.deepEqual(fecharCiclo(r.dir, verde).criar, c);

  // Com o `fechamentoDoCiclo` do adaptador, o prompt abre por ele.
  const comComando = fecharCiclo(r.dir, verde, {
    textoDoFechamento: (a) => textoDoFechamento({ ...a, fechamento: "/close-cycle" }),
    fechamentoDoCiclo: () => "/close-cycle",
  });
  assert.match(comComando.criar.texto, /^Rode o \/close-cycle do TESTE-1-conducao\.\n/);
  assert.doesNotMatch(comComando.criar.texto, /^\s*\//);

  // CI vermelho ou pendente não cria.
  const vermelho = fecharCiclo(r.dir, { ci: { sha: "h".repeat(40), veredito: "vermelho", run: 8 } });
  assert.equal(vermelho.acao, "perguntar");
  assert.equal(vermelho.criar, undefined);
  const pendente = fecharCiclo(r.dir, {});
  assert.equal(pendente.acao, "esperar");
  assert.equal(pendente.motivo, "ci-pendente");
  assert.equal(pendente.criar, undefined);

  // Encerrado o ciclo, a condutora de fechamento já nasceu: só esperar.
  r.encerrar("ciclo");
  const depois = fecharCiclo(r.dir, verde);
  assert.equal(depois.acao, "esperar");
  assert.equal(depois.motivo, "fechamento-em-sessao-limpa");
  assert.equal(depois.criar, undefined);
  assert.equal(fecharCiclo(r.dir, { proposta: { state: "MERGED" } }).motivo, "mesclado");
});
