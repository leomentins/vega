/**
 * vaga-na-espera.test.mjs — filha esperando a vez de build não ocupa vaga de
 * abertura (HN-29 T25, terceira parte do débito do núcleo). Filha cujo último
 * estado é a espera da fila de builds (`vez: "esperando"`) sai da conta das
 * filhas vivas no teto da ponte; a tentativa dela segue em voo, e a largura e
 * os Outputs continuam ocupados.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerAviso, nonce } from "../conducao.mjs";
import { regraAbrir, regraEsperar, vagasDoTeto } from "../regras.mjs";

const CICLO = "TESTE-1-vaga";
const HEAD = "d".repeat(40);
const BLOB = "b".repeat(40);

const acao = (tipo, alvo, tentativa, campos) => ({ acao: tipo, nonce: nonce(CICLO, alvo, tentativa, HEAD), ciclo: CICLO, head: HEAD, plano: BLOB, ...campos });

function task(id, extra = {}) {
  return { id, fase: "F1", deps: [], outputs: [`a/${id}.mjs`], estacao: "servidor", fechamento: false, publicacao: [], protegida: [], classe: "comum", prazoMin: 120, posMerge: false, ...extra };
}

/** Filha viva com o último estado na fila de builds (`vez`); sem `vez`, nunca passou pela fila. */
const filha = (i, vez, estado = "RUNNING") => ({ sessao: `s${i}`, estado, ...(vez === undefined ? {} : { vez }) });

const ctx = ({ filhas, tasks = [task("T1"), task("T2")], largura = 3, vooAtivo = [], tetoPonte = null }) => ({
  ciclo: CICLO,
  head: HEAD,
  planoBlob: BLOB,
  acao,
  nonce,
  lerAviso,
  plano: { largura, fases: [{ id: "F1", modelo: "opus", tasks: tasks.map((t) => t.id) }], porId: new Map(tasks.map((t) => [t.id, t])) },
  fase: { id: "F1" },
  servidor: tasks,
  workstation: [],
  daMaestra: [],
  vooAtivo,
  reabrir: new Map(),
  maxTent: new Map(),
  filhas,
  tetoPonte,
  tetoPadrao: 3,
  cobertaPelaFase: false,
  aprovacoes: [],
  ultimaAutorizacao: { sha: "a".repeat(40), fase: "F1" },
});

const abriu = (r) => (r ? (r.acao === "abrir" ? `abrir:${r.tarefas.map((x) => x.task).join("+")}` : `${r.acao}:${r.motivo}`) : null);

// Teto padrão 3, largura 3, sem tentativa em voo: só o teto limita.
const TABELA = [
  { caso: "três vivas trabalhando enchem o teto", filhas: [filha(0), filha(1), filha(2)], vivas: 3, espera: null },
  { caso: "uma das três esperando a vez libera uma vaga", filhas: [filha(0), filha(1), filha(2, "esperando")], vivas: 2, espera: "abrir:T1" },
  { caso: "duas esperando a vez liberam duas vagas", filhas: [filha(0), filha(1, "esperando"), filha(2, "esperando")], vivas: 1, espera: "abrir:T1+T2" },
  { caso: "todas esperando a vez: o teto inteiro livre", filhas: [filha(0, "esperando"), filha(1, "esperando"), filha(2, "esperando")], vivas: 0, espera: "abrir:T1+T2" },
  { caso: "estado da vez normalizado (caixa e espaço)", filhas: [filha(0), filha(1), filha(2, " Esperando ")], vivas: 2, espera: "abrir:T1" },
  { caso: "admitida na vez está buildando: ocupa", filhas: [filha(0), filha(1), filha(2, "admitida")], vivas: 3, espera: null },
  { caso: "vez vazia ou de outro tipo ocupa", filhas: [filha(0), filha(1, ""), filha(2, true)], vivas: 3, espera: null },
  { caso: "arquivada segue fora, com ou sem vez", filhas: [filha(0), filha(1), filha(2, "esperando", "ARCHIVED")], vivas: 2, espera: "abrir:T1" },
];

for (const c of TABELA)
  test(`vaga na espera — ${c.caso} ⇒ ${c.espera ?? "null"}`, () => {
    const x = ctx({ filhas: c.filhas });
    assert.equal(vagasDoTeto({ ...x, largura: x.plano.largura }).vivas, c.vivas);
    assert.equal(abriu(regraAbrir(x)), c.espera);
  });

test("vaga na espera — a tentativa em voo segue ocupando a largura", () => {
  // Largura 2 com duas em voo, as duas filhas esperando a vez: teto livre, largura cheia.
  const voo = [{ t: task("T8") }, { t: task("T9") }];
  const x = ctx({ filhas: [filha(0, "esperando"), filha(1, "esperando")], largura: 2, vooAtivo: voo });
  assert.deepEqual(vagasDoTeto({ ...x, largura: 2 }), { vivas: 0, teto: 3, vagas: 0 });
  assert.equal(regraAbrir(x), null);
});

test("vaga na espera — os Outputs da tentativa em voo seguem ocupados", () => {
  const x = ctx({
    filhas: [filha(0, "esperando")],
    tasks: [task("T1", { outputs: ["x"] }), task("T2")],
    vooAtivo: [{ t: task("T9", { outputs: ["x"] }) }],
  });
  assert.equal(abriu(regraAbrir(x)), "abrir:T2");
});

test("vaga na espera — o esperar sem vaga conta só as que trabalham", () => {
  const x = ctx({ filhas: [filha(0), filha(1), filha(2), filha(3, "esperando")], tasks: [] });
  const r = regraEsperar({ ...x, autorizadas: new Set(["F1"]), servidor: [task("T1")] });
  assert.equal(r.motivo, "sem-vaga");
  assert.equal(r.vivas, 3);
});

test("vaga na espera — dentro do ciclo, largura acima do teto: a filha da tentativa em voo que espera a vez libera uma vaga", () => {
  // Largura 5, teto 3, três tentativas em voo deste ciclo; uma das filhas delas espera a vez.
  const voo = [{ t: task("T7") }, { t: task("T8") }, { t: task("T9") }];
  const comEspera = ctx({ filhas: [filha(0), filha(1), filha(2, "esperando")], largura: 5, vooAtivo: voo });
  assert.deepEqual(vagasDoTeto({ ...comEspera, largura: 5 }), { vivas: 2, teto: 3, vagas: 1 });
  assert.equal(abriu(regraAbrir(comEspera)), "abrir:T1");
  const semEspera = ctx({ filhas: [filha(0), filha(1), filha(2)], largura: 5, vooAtivo: voo });
  assert.equal(regraAbrir(semEspera), null);
});
