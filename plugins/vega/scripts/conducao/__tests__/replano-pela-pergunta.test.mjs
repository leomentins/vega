/**
 * replano-pela-pergunta.test.mjs — a resposta que pediu o re-plano vale como o sim da fase, também
 * no trazer e na pergunta registrada (VEGA-20 T38; AC-VEGA20-17).
 *
 * O re-plano que cita em `Replano-Pergunta` a resposta do operador à parada `trazer-exige-aprovacao`,
 * ou a uma pergunta registrada DESTE ciclo aberta fora de task (ponteiro livre: nem
 * `autorizar-ciclo:` nem `conducao:`), herda o sim da fase sem a pergunta da fase de novo — pelas
 * mesmas conferências da parada: origem humana, aberta depois da autorização que o re-plano mudou,
 * uso único, a opção do `--sim` escolhida e todo commit do canonico desde a autorização citando-a.
 * Pergunta de outro ciclo, sem origem humana, aberta antes da autorização, reusada ou citada por só
 * parte dos commits do canonico recusa como antes. Roda no projeto de exemplo do plugin (registro do
 * destino git), a mesma forma de `pergunta-citada-git.test.mjs`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PARADAS_QUE_REPLANEJAM } from "../consentimento.mjs";
import { ErroPlano } from "../ler-plano.mjs";
import { autorizarCiclo, conferirPerguntaDaHeranca } from "../git-conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const EXEMPLO = path.resolve(AQUI, "..", "..", "..", "exemplo");
const CICLO = "EXEMPLO-1-despedida";
const SIM = "sim, pode conduzir a F1";
const ANTIGA = "2026-11-18T10:00:00.000Z";
const RESPONDIDA_ANTIGA = "2026-11-18T10:05:00.000Z";
const chave = (...partes) => createHash("sha256").update(partes.join("|")).digest("hex");
const recusa = (codigo) => (e) => e instanceof ErroPlano && e.codigo === codigo;

let seq = 0;
const novoId = () => `p-${(0xd00 + ++seq).toString(16).padStart(16, "0")}`;

function exemplo(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "replano-pela-pergunta-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const dir = path.join(raiz, "projeto");
  const config = path.join(raiz, "claude-config");
  cpSync(EXEMPLO, dir, { recursive: true });
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", `ciclo-${CICLO}`);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g("config", k, v);
  g("add", "-A");
  g("commit", "-q", "-m", "projeto de exemplo");
  // Ciclo de 2 níveis declarado: sem a marca, o núcleo roda em 3 (D10c do L4).
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 2", "-m", "Conducao-Niveis: 2");
  const antes = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  t.after(() => (antes === undefined ? delete process.env.CLAUDE_CONFIG_DIR : (process.env.CLAUDE_CONFIG_DIR = antes)));
  const PLANO = path.join(dir, "docs", "planos", `${CICLO}.md`);
  /** Um commit no canonico; `trailer` é o corpo de trailers (ou null, sem citação). */
  const replano = (trailer) => {
    writeFileSync(PLANO, readFileSync(PLANO, "utf8") + `\n<!-- re-plano ${++seq} -->\n`);
    g("add", "-A");
    g("commit", "-q", "-m", `${CICLO}-F1 — re-plano`, ...(trailer ? ["-m", trailer] : []));
  };
  return { dir, config, g, replano, head: () => g("rev-parse", "HEAD") };
}

/**
 * Uma pergunta no registro do exemplo: abertura (um item, a opção `a` com o sim), resposta `a` e —
 * salvo `autoria: null` — a autoria `digitado` com a mensagem do operador no transcript dublê.
 * `quando` é a hora da abertura (a resposta vem um minuto depois); o padrão é depois da autorização.
 */
function pergunta(e, { abertura = {}, autoria = {}, quando = "depois" } = {}) {
  const id = novoId();
  const aberta = quando === "antes" ? ANTIGA : new Date(Date.now() + 60_000).toISOString();
  const respondida = quando === "antes" ? RESPONDIDA_ANTIGA : new Date(Date.now() + 120_000).toISOString();
  const sessao = `operador-${id}`;
  const transcript = path.join(e.config, "projects", "exemplo", `${sessao}.jsonl`);
  const comum = { pergunta_id: id, sessao, ciclo: CICLO, item: "D1", titulo: "o re-plano" };
  const linhas = [
    { chave: chave("abertura", id), versao_esquema: 1, evento: "abertura", carimbo: aberta, ...comum, ponteiro: null, itens: [{ numero: 1, titulo: "o re-plano", opcoes: [{ letra: "a", texto: SIM }, { letra: "b", texto: "não, espera" }] }], ...abertura },
    { chave: chave("resposta", id), versao_esquema: 1, evento: "resposta", carimbo: respondida, ...comum, perguntado_em: aberta, resposta_literal: "a", escolha: "a", origem_resposta: "agente" },
  ];
  if (autoria !== null) {
    const a = { origem_resposta: "digitado", prova: `transcript:${transcript}#u-${id}`, ...autoria };
    linhas.push({ chave: chave("autoria", id, a.origem_resposta, a.prova), versao_esquema: 1, evento: "autoria", carimbo: respondida, ...comum, ...a });
  }
  mkdirSync(path.join(e.dir, ".vega"), { recursive: true });
  writeFileSync(path.join(e.dir, ".vega", `sessao-${sessao}.jsonl`), linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
  mkdirSync(path.dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${JSON.stringify({ uuid: `u-${id}`, sessionId: sessao, type: "user", origin: { kind: "human" }, timestamp: respondida, message: { content: "a" } })}\n`);
  return id;
}

/** A pergunta do autorizar da fase, aberta antes: a primeira autorização, que o re-plano muda. */
const doAutorizar = (e) => pergunta(e, { abertura: { ponteiro: "autorizar-ciclo:F1" }, quando: "antes" });
const autorizar = (e, id) => autorizarCiclo({ repo: e.dir, ciclo: CICLO, fase: "F1", sim: SIM, pergunta: id });
const DO_TRAZER = { ponteiro: "conducao:trazer-exige-aprovacao:d-0123456789abcdef" };
const LIVRE = { ponteiro: "VEGA-20-o-plano-da-T7" };

function autorizou(e, id) {
  assert.equal(e.g("log", "-1", "--format=%s"), "Conducao: F1 autorizada");
  assert.equal(e.g("log", "-1", "--format=%(trailers:key=Conducao-Pergunta,valueonly)"), id);
  assert.equal(e.g("log", "-1", "--format=%(trailers:key=Conducao-Pergunta-Parada,valueonly)"), "sim");
  // A herança relê a mesma pergunta pela marca, sem tropeçar no ponteiro.
  assert.equal(conferirPerguntaDaHeranca({ repo: e.dir, ciclo: CICLO, autorizacao: e.head() }), id);
}

test("a parada trazer-exige-aprovacao é das que replanejam", () => {
  assert.ok(PARADAS_QUE_REPLANEJAM.includes("trazer-exige-aprovacao"));
});

test("a resposta do trazer-exige-aprovacao citada no re-plano autoriza a fase", (t) => {
  const e = exemplo(t);
  autorizar(e, doAutorizar(e));
  const id = pergunta(e, { abertura: DO_TRAZER });
  // Sem re-plano citando-a: segue recusando como antes.
  assert.throws(() => autorizar(e, id), recusa("pergunta-de-outra-fase"));
  e.replano(`Replano-Pergunta: ${id}`);
  const r = autorizar(e, id);
  assert.ok(["autorizada", "registrado-sem-copia"].includes(r.acao), JSON.stringify(r));
  autorizou(e, id);
});

test("a pergunta registrada do ciclo, de ponteiro livre, citada no re-plano autoriza a fase", (t) => {
  for (const abertura of [LIVRE, { ponteiro: null }]) {
    const e = exemplo(t);
    autorizar(e, doAutorizar(e));
    const id = pergunta(e, { abertura });
    e.replano(`Replano-Pergunta: ${id}`);
    const r = autorizar(e, id);
    assert.ok(["autorizada", "registrado-sem-copia"].includes(r.acao), JSON.stringify(r));
    autorizou(e, id);
  }
});

test("a pergunta de outro ciclo recusa", (t) => {
  const e = exemplo(t);
  autorizar(e, doAutorizar(e));
  const antes = e.head();
  const id = pergunta(e, { abertura: { ...LIVRE, ciclo: "OUTRO-2-ciclo" } });
  e.replano(`Replano-Pergunta: ${id}`);
  assert.throws(() => autorizar(e, id), recusa("pergunta-de-outro-ciclo"));
  assert.equal(e.g("log", "-1", "--format=%s"), `${CICLO}-F1 — re-plano`, "nada gravado");
  assert.notEqual(e.head(), antes);
});

test("a pergunta sem origem humana recusa", (t) => {
  for (const abertura of [LIVRE, DO_TRAZER]) {
    const e = exemplo(t);
    autorizar(e, doAutorizar(e));
    const id = pergunta(e, { abertura, autoria: null });
    e.replano(`Replano-Pergunta: ${id}`);
    assert.throws(() => autorizar(e, id), recusa("origem-sem-prova"));
  }
});

test("a pergunta aberta antes da autorização recusa", (t) => {
  for (const abertura of [LIVRE, DO_TRAZER]) {
    const e = exemplo(t);
    const id = pergunta(e, { abertura, quando: "antes" });
    autorizar(e, doAutorizar(e));
    e.replano(`Replano-Pergunta: ${id}`);
    assert.throws(() => autorizar(e, id), recusa("pergunta-de-outra-fase"));
  }
});

test("a pergunta reusada recusa", (t) => {
  for (const abertura of [LIVRE, DO_TRAZER]) {
    const e = exemplo(t);
    autorizar(e, doAutorizar(e));
    const id = pergunta(e, { abertura });
    e.replano(`Replano-Pergunta: ${id}`);
    autorizar(e, id);
    // Um segundo re-plano citando a mesma resposta: ela já autorizou uma marca.
    e.replano(`Replano-Pergunta: ${id}`);
    assert.throws(() => autorizar(e, id), recusa("pergunta-reusada"));
  }
});

test("a pergunta citada por só parte dos commits do canonico desde a autorização recusa", (t) => {
  for (const abertura of [LIVRE, DO_TRAZER]) {
    const e = exemplo(t);
    autorizar(e, doAutorizar(e));
    const id = pergunta(e, { abertura });
    e.replano(null);
    e.replano(`Replano-Pergunta: ${id}`);
    assert.throws(() => autorizar(e, id), recusa("pergunta-de-outra-fase"));
  }
});
