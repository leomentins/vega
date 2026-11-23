// pergunta-da-filha-condutora.test.mjs — VEGA-20 T22 (AC-VEGA20-4): a pergunta da operária vai
// primeiro à condutora; só sobe ao operador o que a tabela de destinatários não deixa descer, ou a
// classe ausente ou desconhecida (fail-closed); o aviso diz se o trabalho parou ou está pronto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { regraVigia } from "../regras.mjs";
import { comPergunta } from "../pergunta.mjs";
import { CLASSES_DA_PERGUNTA, camposDaPergunta, destinatarioDaPerguntaDaFilha, tabelaPadrao } from "../../pergunta/destinatarios.mjs";

const NONCE = "abcdef0123456789";

function acaoBase(tipo, id, tentativa, extra = {}) {
  return { acao: tipo, chave: `${tipo}:${id}:${tentativa}`, ...extra };
}

function lerAviso(aviso) {
  const m = /^(T\d{1,3})-(OK|FALHA)\s+(\S+)(?:\s+.*)?\s+(\S+)$/.exec(String(aviso ?? "").trim());
  return m ? { task: m[1], tipo: m[2], arg: m[3], nonce: m[4] } : null;
}

/** A vigia com uma filha em voo cujo aviso é `aviso`. */
function vigiar(aviso) {
  const t = { id: "T1", prazoMin: 60 };
  const r = { tentativa: 1, nonce: NONCE, abertaEm: 1000, ref: "refs/conducao/C/T1/1" };
  const ctx = {
    acao: comPergunta(acaoBase),
    lerAviso,
    fase: { id: "F1", status: "em-curso" },
    autorizadas: new Set(["F1"]),
    tasks: [t],
    voo: [{ t, r }],
    filhas: [{ nonce: NONCE, aviso, sessao: "session_x", estado: "IDLE", statusBucket: "IDLE" }],
    estado: { falhas: new Map(), falhasAmbiente: new Map(), revertidasSemFalha: new Map(), emVoo: new Map([["T1", r]]), maxTent: new Map([["T1", 1]]) },
    agora: 1100,
    reinicioEm: null,
    feita: () => false,
    reabrir: new Map(),
    tetoFalhasAmbiente: 3,
    silencioFilhaCaidaMin: 30,
    epoch: 0,
  };
  return regraVigia(ctx);
}

test("pergunta técnica fica na condutora", () => {
  const a = vigiar(`T1-FALHA pergunta classe:tecnica trabalho:parado ${NONCE}`);
  assert.ok(a, "a vigia devolve a pergunta");
  assert.equal(a.acao, "perguntar");
  assert.equal(a.motivo, "pergunta-da-filha");
  assert.equal(a.destinatario, "condutora");
  assert.equal(a.classe, "tecnica");
  assert.equal(a.trabalho, "parado");
});

test("pergunta de caminho clínico sobe ao operador", () => {
  for (const classe of ["caminho-clinico", "caminho-clinico-fora-dos-outputs"]) {
    const a = vigiar(`T1-FALHA pergunta classe:${classe} trabalho:pronto ${NONCE}`);
    assert.equal(a.motivo, "pergunta-da-filha");
    assert.equal(a.destinatario, "operador", classe);
    assert.equal(a.trabalho, "pronto");
  }
});

test("pergunta de classe desconhecida ou ausente sobe ao operador", () => {
  const desconhecida = vigiar(`T1-FALHA pergunta classe:qualquer-coisa trabalho:parado ${NONCE}`);
  assert.equal(desconhecida.destinatario, "operador");
  assert.equal(desconhecida.classe, null);
  const ausente = vigiar(`T1-FALHA pergunta ${NONCE}`);
  assert.equal(ausente.destinatario, "operador");
  assert.equal(ausente.classe, null);
});

test("aviso sem o campo trabalho vale parado", () => {
  assert.equal(vigiar(`T1-FALHA pergunta ${NONCE}`).trabalho, "parado");
  assert.equal(vigiar(`T1-FALHA pergunta classe:tecnica ${NONCE}`).trabalho, "parado");
  assert.equal(camposDaPergunta(`T1-FALHA pergunta trabalho:talvez ${NONCE}`).trabalho, "parado");
});

test("só a técnica desce; toda outra classe reconhecida sobe", () => {
  const tabela = tabelaPadrao();
  for (const classe of CLASSES_DA_PERGUNTA) {
    const esperado = classe === "tecnica" ? "condutora" : "operador";
    assert.equal(destinatarioDaPerguntaDaFilha({ classe }, tabela), esperado, classe);
  }
  assert.equal(destinatarioDaPerguntaDaFilha({}, tabela), "operador");
});
