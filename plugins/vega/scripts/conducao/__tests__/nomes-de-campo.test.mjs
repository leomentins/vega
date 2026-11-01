/**
 * nomes-de-campo.test.mjs — os campos da API da condução com nome de papel
 * (HN-29 T41, D-HN29-5a). O código do adaptador declara `caminhosProtegidos`
 * e `telasProtegidasDosSteps`; o nome antigo carrega igual, com aviso no
 * stderr, até a migração dos adaptadores (F5). As ações do `proximo` emitem só
 * os nomes novos: `caminhosProtegidos` no `perguntar` e `avisoOperador` no `abrir`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErroAdaptador, validarCodigo } from "../adaptador.mjs";
import { lerAviso, nonce } from "../conducao.mjs";
import { regraAbrir } from "../regras.mjs";

const ANTIGO = { caminhosProtegidos: "caminhosClinicos", telasProtegidasDosSteps: "telasClinicasDosSteps" };

/** Código mínimo com os nomes novos e sem os campos opcionais (`marcasDeRodadas`, `alcanceDosHooks`, `fechamentoDoCiclo`). */
const minimo = (campos = {}) => ({
  plano: { raiz: "proprio", casa: () => false, ler: () => ({}), brief: () => [] },
  publicacao: [],
  caminhosProtegidos: ["app/fichas/**"],
  telasProtegidasDosSteps: ["app/fichas/**"],
  foraDasTelasDosSteps: [],
  carimbo: null,
  ci: null,
  ...campos,
});

/** Troca o nome novo pelo antigo, mantendo o valor. */
function comNomeAntigo(c, novo) {
  const { [novo]: valor, ...resto } = c;
  return { ...resto, [ANTIGO[novo]]: valor };
}

/** Roda `fn` capturando o que vai para o stderr. */
function stderrDe(fn) {
  const escrito = [];
  const original = process.stderr.write;
  process.stderr.write = (pedaco, ...resto) => {
    escrito.push(String(pedaco));
    const cb = resto.find((x) => typeof x === "function");
    if (cb) cb();
    return true;
  };
  try {
    return { valor: fn(), stderr: escrito.join("") };
  } finally {
    process.stderr.write = original;
  }
}

test("o nome novo carrega, sem aviso", () => {
  const { valor, stderr } = stderrDe(() => validarCodigo(minimo(), "x.mjs"));
  assert.deepEqual([...valor.caminhosProtegidos], ["app/fichas/**"]);
  assert.deepEqual([...valor.telasProtegidasDosSteps], ["app/fichas/**"]);
  assert.equal(stderr, "");
});

for (const novo of Object.keys(ANTIGO)) {
  test(`${ANTIGO[novo]} carrega como ${novo} e avisa no stderr`, () => {
    const { valor, stderr } = stderrDe(() => validarCodigo(comNomeAntigo(minimo(), novo), "x.mjs"));
    assert.deepEqual([...valor[novo]], ["app/fichas/**"]);
    assert.equal(ANTIGO[novo] in valor, false);
    assert.ok(stderr.includes(ANTIGO[novo]) && stderr.includes(novo), stderr);
  });

  test(`${ANTIGO[novo]} com [] carrega [] e avisa (presença por in, nunca por valor)`, () => {
    const { valor, stderr } = stderrDe(() => validarCodigo(comNomeAntigo(minimo({ [novo]: [] }), novo), "x.mjs"));
    assert.deepEqual([...valor[novo]], []);
    assert.ok(stderr.includes(ANTIGO[novo]) && stderr.includes(novo), stderr);
  });

  test(`${ANTIGO[novo]} e ${novo} juntos recusam`, () => {
    const c = { ...minimo(), [ANTIGO[novo]]: [] };
    assert.throws(
      () => stderrDe(() => validarCodigo(c, "x.mjs")),
      (e) => e instanceof ErroAdaptador && e.message.includes(ANTIGO[novo]) && e.message.includes(novo),
    );
  });

  test(`sem ${novo} nem ${ANTIGO[novo]} recusa`, () => {
    const { [novo]: _fora, ...sem } = minimo();
    void _fora;
    assert.throws(() => validarCodigo(sem, "x.mjs"), (e) => e instanceof ErroAdaptador && e.message.includes(`falta o campo ${novo}`));
  });
}

test("o código congelado com os dois nomes antigos carrega, um aviso por campo", () => {
  const c = Object.freeze(comNomeAntigo(comNomeAntigo(minimo(), "caminhosProtegidos"), "telasProtegidasDosSteps"));
  const { valor, stderr } = stderrDe(() => validarCodigo(c, "x.mjs"));
  assert.deepEqual([...valor.caminhosProtegidos], ["app/fichas/**"]);
  assert.deepEqual([...valor.telasProtegidasDosSteps], ["app/fichas/**"]);
  assert.equal(stderr.trim().split("\n").length, 2, stderr);
});

test("sem os campos opcionais da T39 carrega com os defaults", () => {
  const valor = validarCodigo(minimo(), "x.mjs");
  assert.deepEqual([...valor.marcasDeRodadas], []);
  assert.deepEqual([...valor.alcanceDosHooks], []);
  assert.equal(valor.fechamentoDoCiclo, null);
});

// ── as ações do `proximo` emitem só os nomes novos ──────────────────────────

const CICLO = "TESTE-1-nomes";
const HEAD = "d".repeat(40);
const acao = (tipo, alvo, tentativa, campos) => ({ acao: tipo, nonce: nonce(CICLO, alvo, tentativa, HEAD), ciclo: CICLO, head: HEAD, plano: "b".repeat(40), ...campos });
const task = (id, extra = {}) => ({ id, fase: "F1", deps: [], outputs: [`a/${id}.mjs`], estacao: "servidor", fechamento: false, publicacao: [], protegida: [], classe: "comum", prazoMin: 120, posMerge: false, ...extra });
const ctx = (t, over = {}) => ({
  ciclo: CICLO,
  head: HEAD,
  planoBlob: "b".repeat(40),
  acao,
  nonce,
  lerAviso,
  plano: { largura: 1, fases: [{ id: "F1", modelo: "opus", tasks: [t.id] }], porId: new Map([[t.id, t]]) },
  fase: { id: "F1" },
  servidor: [t],
  vooAtivo: [],
  reabrir: new Map(),
  maxTent: new Map(),
  filhas: [],
  tetoPonte: null,
  tetoPadrao: 3,
  cobertaPelaFase: false,
  aprovacoes: [],
  ultimaAutorizacao: { sha: "a".repeat(40), fase: "F1" },
  ...over,
});

test("perguntar de task protegida: os caminhos saem em caminhosProtegidos", () => {
  const t = task("T1", { classe: "sensivel", outputs: ["app/fichas/laudo.tsx"], protegida: ["app/fichas/laudo.tsx"] });
  const r = regraAbrir(ctx(t));
  assert.equal(r.acao, "perguntar");
  assert.equal(r.motivo, "task-sensivel");
  assert.deepEqual(r.caminhosProtegidos, ["app/fichas/laudo.tsx"]);
  assert.deepEqual(Object.keys(r).sort(), ["acao", "caminhosProtegidos", "ciclo", "fase", "head", "motivo", "nonce", "plano", "publicacao", "task", "tentativa"]);
});

test("abrir com aviso do reinício: o aviso sai em avisoOperador", () => {
  const t = task("T1");
  const r = regraAbrir(ctx(t, { maxTent: new Map([["T1", 1]]), reabrir: new Map([["T1", { tentativa: 1, coberta: "sim", motivo: "reinicio-da-ponte" }]]) }));
  assert.equal(r.acao, "abrir");
  assert.deepEqual(r.avisoOperador, ["T1 tentativa 1 caiu no reinício da ponte; reaberta como 2, sem contar falha"]);
  assert.deepEqual(Object.keys(r).sort(), ["acao", "avisoOperador", "ciclo", "fase", "head", "largura", "nonce", "plano", "tarefas"]);
});
