/**
 * resposta-da-maestra.test.mjs — em 3 níveis o operador responde à pergunta da condutora na sessão
 * da maestra, e a condutora só aplica a decisão com a resposta provada pelo registro (hotfix
 * vega-maestra-leva-pergunta).
 *
 * A prova é a de sempre (`origemEfetiva`): `digitado` na sessão da condutora, ou
 * `digitado-no-hub-conferido` com o recibo na sessão da maestra da entrada, conferido pelo
 * `get_event` que o gancho reconfere. O texto da mensagem da maestra nunca entra na conta: um
 * `repasse-hub` (recibo sem `get_event` conferido) recusa, e um recibo de outra sessão também.
 * Corpo do plugin, sem o registro do projeto: o registro é um dublê de `origemEfetiva`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exigirRespostaDaMaestra } from "../consentimento.mjs";
import { autorizarCiclo, respostaDaMaestra } from "../git-conducao.mjs";
import { ErroPlano } from "../ler-plano.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const ID = "p-00000000000000c1";
const MAESTRA = "session_maestra";
const SIM = "sim, pode tocar o ciclo inteiro";

const recusa = (codigo) => (e) => e instanceof ErroPlano && e.codigo === codigo;
/** O registro dublê: `origemEfetiva` devolve `o` (ou lança, com `erro`). */
const registro = (o, { erro = null } = {}) => ({
  origemEfetiva: () => {
    if (erro) throw new Error(erro);
    return o;
  },
});
const conferir = (o, maestra = MAESTRA, opcoes) => exigirRespostaDaMaestra({ perguntas: registro(o, opcoes), pergunta_id: ID, maestra });

test("resposta digitada na sessão da condutora vale em 3 níveis", () => {
  assert.deepEqual(conferir({ origem: "digitado", recibo: null }), { origem: "digitado", recibo: null });
});

test("resposta do operador na sessão da maestra, com o recibo conferido nela, vale", () => {
  assert.deepEqual(conferir({ origem: "digitado-no-hub-conferido", recibo: `${MAESTRA} ev-1` }), { origem: "digitado-no-hub-conferido", recibo: `${MAESTRA} ev-1` });
});

test("recibo conferido de outra sessão que não a maestra da entrada recusa", () => {
  assert.throws(() => conferir({ origem: "digitado-no-hub-conferido", recibo: "session_outra ev-1" }), recusa("resposta-de-outra-sessao"));
  assert.throws(() => conferir({ origem: "digitado-no-hub-conferido", recibo: null }), recusa("resposta-de-outra-sessao"));
});

test("repasse sem o get_event do recibo conferido recusa, mesmo vindo da maestra", () => {
  assert.throws(() => conferir({ origem: "repasse-hub", recibo: `${MAESTRA} ev-1`, motivo: "sem-chamada" }), recusa("recibo-nao-conferido"));
});

test("resposta do agente, sem resposta, registro fora ou ilegível recusam", () => {
  assert.throws(() => conferir({ origem: "agente", motivo: "prova-nao-resolve" }), recusa("origem-sem-prova"));
  assert.throws(() => conferir({ origem: null, motivo: "sem-resposta" }), recusa("resposta-ausente"));
  assert.throws(() => conferir({ origem: "digitado", sem_registro: true }), recusa("registro-fora"));
  assert.throws(() => conferir(null, MAESTRA, { erro: "banco caiu" }), recusa("origem-sem-prova"));
  assert.throws(() => exigirRespostaDaMaestra({ perguntas: null, pergunta_id: ID, maestra: MAESTRA }), recusa("registro-nao-declarado"));
});

test("sem a maestra ou com pergunta fora da forma recusa antes de ler o registro", () => {
  let leu = false;
  const espia = { origemEfetiva: () => ((leu = true), { origem: "digitado" }) };
  assert.throws(() => exigirRespostaDaMaestra({ perguntas: espia, pergunta_id: ID, maestra: undefined }), recusa("maestra-ausente"));
  assert.throws(() => exigirRespostaDaMaestra({ perguntas: espia, pergunta_id: "p-xyz", maestra: MAESTRA }), recusa("pergunta-ausente"));
  assert.equal(leu, false);
});

test("o verbo resposta-da-maestra sai aplicar com a origem e o recibo, e nada grava", () => {
  const pecas = { perguntas: registro({ origem: "digitado-no-hub-conferido", recibo: `${MAESTRA} ev-1` }), falha: null };
  assert.deepEqual(respostaDaMaestra({ repo: "/nao-usado", pergunta: ID, maestra: MAESTRA, pecas }), {
    acao: "aplicar",
    pergunta: ID,
    maestra: MAESTRA,
    origem: "digitado-no-hub-conferido",
    recibo: `${MAESTRA} ev-1`,
  });
  assert.throws(() => respostaDaMaestra({ repo: "/nao-usado", pergunta: ID, maestra: "session_outra", pecas }), recusa("resposta-de-outra-sessao"));
});

test("autorizar-ciclo com --maestra recusa o sim que veio de outra sessão, sem commit", (t) => {
  const dir = pastaTemporaria("resposta-da-maestra-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  g("init", "-q", "-b", "main");
  g("commit", "-q", "--allow-empty", "-m", "raiz");
  const antes = g("rev-parse", "HEAD");
  const pergunta = (recibo) => ({
    origemEfetiva: () => ({ origem: "digitado-no-hub-conferido", recibo }),
    perguntaDoAutorizar: () => ({
      origem: "digitado-no-hub-conferido",
      abertura: { pergunta_id: ID, ciclo: "X-1", ponteiro: "autorizar-ciclo:F1", itens: [{ numero: 1, opcoes: [{ letra: "a", texto: SIM }, { letra: "b", texto: "não" }] }] },
      escolhas: [{ numero: 1, letra: "a" }],
    }),
  });
  const pecas = (recibo) => ({ perguntas: pergunta(recibo), falha: null });
  assert.throws(() => autorizarCiclo({ repo: dir, ciclo: "X-1", fase: "F1", sim: SIM, pergunta: ID, pecas: pecas("session_outra ev-1"), maestra: MAESTRA }), recusa("resposta-de-outra-sessao"));
  assert.throws(() => autorizarCiclo({ repo: dir, ciclo: "X-1", fase: "F1", sim: SIM, pecas: pecas(null), maestra: MAESTRA }), recusa("pergunta-ausente"));
  assert.equal(g("rev-parse", "HEAD"), antes, "0 commit");
  // Contraprova: a mesma pergunta, recibo na maestra, passa da conferência da resposta (e cai depois,
  // no plano que este repositório não tem).
  assert.throws(() => autorizarCiclo({ repo: dir, ciclo: "X-1", fase: "F1", sim: SIM, pergunta: ID, pecas: pecas(`${MAESTRA} ev-1`), maestra: MAESTRA }), (e) => e instanceof ErroPlano && e.codigo !== "resposta-de-outra-sessao");
  // Sem marca nenhuma o ciclo roda em 3 níveis: omitir --maestra recusa.
  assert.throws(() => autorizarCiclo({ repo: dir, ciclo: "X-1", fase: "F1", sim: SIM, pergunta: ID, pecas: pecas("session_outra ev-1") }), recusa("maestra-ausente"));
  // Com a marca antiga de 2 níveis, sem --maestra: a regra de 2 (passa da conferência e cai no plano).
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 2", "-m", "Conducao-Niveis: 2");
  assert.throws(() => autorizarCiclo({ repo: dir, ciclo: "X-1", fase: "F1", sim: SIM, pergunta: ID, pecas: pecas("session_outra ev-1") }), (e) => e instanceof ErroPlano && e.codigo !== "maestra-ausente");
  // Com a marca de 3 níveis no ramo, omitir --maestra recusa: pular a conferência não cai na regra de 2.
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 3", "-m", "3", "-m", "Conducao-Niveis: 3");
  const comMarca = g("rev-parse", "HEAD");
  assert.throws(() => autorizarCiclo({ repo: dir, ciclo: "X-1", fase: "F1", sim: SIM, pergunta: ID, pecas: pecas(`${MAESTRA} ev-1`) }), recusa("maestra-ausente"));
  assert.equal(g("rev-parse", "HEAD"), comMarca, "0 commit");
});

test("em 3 níveis o repasse de pé só pelo texto da mensagem nunca autoriza o ciclo", (t) => {
  const dir = pastaTemporaria("resposta-da-maestra-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  g("init", "-q", "-b", "main");
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 3", "-m", "3", "-m", "Conducao-Niveis: 3");
  const perguntas = {
    origemEfetiva: () => ({ origem: "repasse-hub", recibo: `${MAESTRA} ev-qualquer`, motivo: "sem-chamada" }),
    perguntaDoAutorizar: () => ({
      origem: "repasse-hub",
      abertura: { pergunta_id: ID, ciclo: "X-1", ponteiro: "autorizar-ciclo:F1", itens: [{ numero: 1, opcoes: [{ letra: "a", texto: SIM }] }] },
      escolhas: [{ numero: 1, letra: "a" }],
    }),
  };
  const pecas = { perguntas, falha: null };
  assert.throws(() => autorizarCiclo({ repo: dir, ciclo: "X-1", fase: "F1", sim: SIM, pergunta: ID, pecas }), recusa("maestra-ausente"));
  assert.throws(() => autorizarCiclo({ repo: dir, ciclo: "X-1", fase: "F1", sim: SIM, pergunta: ID, pecas, maestra: MAESTRA }), recusa("recibo-nao-conferido"));
});
