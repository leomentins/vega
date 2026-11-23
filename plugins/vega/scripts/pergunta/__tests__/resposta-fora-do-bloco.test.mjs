// resposta-fora-do-bloco.test.mjs — VEGA-20 T8 (AC-VEGA20-5, AC-VEGA20-6; D-VEGA20-6). A resposta
// que traz numero de decisao que a pergunta nao tem, ou letra fora das opcoes do item, nao vale como
// escolhida nem e recusada: sai `a-confirmar`, grava o evento com o literal e a leitura, nao fecha a
// pergunta e devolve a frase que a sessao mostra ao operador. Peça do corpo da fábrica: as peças e os
// registros sao os dublês de `dubles.mjs` (a gravacao real no banco e no git da Sistoli mora em
// `.claude/scripts/estado/__tests__/decisao-eventos.test.mjs`).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { A_CONFIRMAR, abrir, gravarDestino, interpretarResposta, ler, principal, registroGit, responder } from "../comando.mjs";
import { tabelaPadrao } from "../destinatarios.mjs";
import { pecasDuble, registroBancoDuble } from "./dubles.mjs";

const destinatarios = tabelaPadrao();

function entrada({ numero = 1, paciente = false, achado = false } = {}) {
  const opcoes = achado
    ? [{ texto: "corrigir-agora — conserta nesta task" }, { texto: "descartar — nao vale o custo" }]
    : [{ texto: "evoluir a tela existente" }, { texto: "criar a nova e aposentar a velha" }];
  return {
    sessao: "zz-test-sessao",
    ciclo: "VEGA-20-dieta-da-fabrica",
    ...(achado ? { achado: true } : {}),
    pergunta: {
      numero,
      assunto: achado ? "achado da revisao" : "tela de repasse",
      papel: "operador",
      has_patient_data: paciente,
      ...(paciente ? { ponteiro: "sensivel/caso-17" } : {}),
      itens: [{ titulo: `decisao ${numero}`, contexto: "o plano pede tela nova; o app ja tem uma", opcoes, recomendada: "a", motivo: "mesmo resultado" }],
    },
  };
}

function banco() {
  const { pecas } = pecasDuble();
  return registroBancoDuble(pecas);
}

describe("interpretarResposta — os dois casos saem a-confirmar com a leitura", () => {
  const itens = [{ numero: 1, opcoes: [{ letra: "a" }, { letra: "b" }, { letra: "c" }] }];
  test("numero que o bloco nao tem", () => {
    const r = interpretarResposta("D7a", itens);
    assert.equal(r.tipo, A_CONFIRMAR);
    assert.equal(r.leitura, "D7a não existe neste bloco");
    assert.deepEqual(r.escolhas, []);
    assert.equal(r.alternativa_livre, false);
  });
  test("letra fora das opcoes do item", () => {
    const r = interpretarResposta("D1d", itens);
    assert.equal(r.tipo, A_CONFIRMAR);
    assert.equal(r.leitura, "D1d: d não é opção de D1");
  });
  test("uma valida e uma fora: nenhuma vale como escolhida", () => {
    const r = interpretarResposta("D1a e D7b", itens);
    assert.equal(r.tipo, A_CONFIRMAR);
    assert.deepEqual(r.escolhas, []);
    assert.equal(r.leitura, "D7b não existe neste bloco");
  });
  test("numero sem D no meio do texto livre segue texto; so tokens sem D volta", () => {
    for (const livre of ["faz em 5h, com 2x o lote", "espera 10m e segue"]) assert.equal(interpretarResposta(livre, itens).tipo, "alternativa-livre", livre);
    assert.equal(interpretarResposta("7a", itens).tipo, A_CONFIRMAR);
    assert.equal(interpretarResposta("7a e 8b", itens).leitura, "D7a não existe neste bloco; D8b não existe neste bloco");
    assert.equal(interpretarResposta("faz D7a depois", itens).tipo, A_CONFIRMAR);
  });
  test("letra valida segue opcao; duas letras no mesmo item seguem recusando", () => {
    assert.equal(interpretarResposta("D1b", itens).tipo, "opcao");
    assert.throws(() => interpretarResposta("1a 1b", itens), /duas letras/);
  });
});

describe("responder — grava a-confirmar e nao fecha a pergunta", () => {
  test("os dois casos: evento a-confirmar com o literal, a pergunta segue aberta, sem erro", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(entrada(), { registro: b.registro, destinatarios });
    for (const [literal, leitura] of [["D7a", "D7a não existe neste bloco"], ["D1d", "D1d: d não é opção de D1"]]) {
      const r = await responder({ pergunta_id, literal }, { registro: b.registro });
      assert.equal(r.tipo, A_CONFIRMAR);
      assert.equal(r.leitura, leitura);
      assert.match(r.confirmar, new RegExp(leitura));
      assert.equal(r.ja_respondida, false);
    }
    const voltas = b.linhas.filter((l) => l.evento === A_CONFIRMAR);
    assert.equal(voltas.length, 2);
    assert.deepEqual(voltas.map((v) => v.resposta_literal), ["D7a", "D1d"]);
    assert.ok(voltas.every((v) => v.has_patient_data === false && v.origem_resposta === "agente"));
    assert.deepEqual(b.chamadas.filter((c) => c[0] === "responder"), [["responder", A_CONFIRMAR], ["responder", A_CONFIRMAR]]);
    const l = await ler({ pergunta_id }, { registro: b.registro });
    assert.equal(l.perguntas[0].estado, "aberta");
  });

  test("depois da volta, a resposta valida fecha na primeira vez (AC-VEGA20-5)", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(entrada(), { registro: b.registro, destinatarios });
    await responder({ pergunta_id, literal: "D7a" }, { registro: b.registro });
    const r = await responder({ pergunta_id, literal: "D1b" }, { registro: b.registro });
    assert.equal(r.tipo, "opcao");
    assert.equal(r.confirmar, undefined);
    const l = await ler({ pergunta_id }, { registro: b.registro });
    assert.equal(l.perguntas[0].estado, "respondida");
    assert.equal(l.perguntas[0].resposta_literal, "D1b");
  });

  test("resposta repassada pelo hub (--por hub:) tambem volta, com a rota gravada", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(entrada(), { registro: b.registro, destinatarios });
    const r = await responder({ pergunta_id, literal: "D1z", por: "hub:leomentins-hub" }, { registro: b.registro });
    assert.equal(r.tipo, A_CONFIRMAR);
    const [volta] = b.linhas.filter((x) => x.evento === A_CONFIRMAR);
    assert.deepEqual(volta.rota, { por: "hub:leomentins-hub" });
  });

  test("pergunta restrita: o literal nao grava, a marca de paciente vem da abertura", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(entrada({ paciente: true }), { registro: b.registro, destinatarios });
    const r = await responder({ pergunta_id, literal: "D7a, o paciente da sala 2" }, { registro: b.registro });
    assert.equal(r.tipo, A_CONFIRMAR);
    const [volta] = b.linhas.filter((x) => x.evento === A_CONFIRMAR);
    assert.equal(volta.has_patient_data, true);
    assert.equal(volta.resposta_literal, "(texto livre retido: pergunta com dado de paciente)");
    assert.doesNotMatch(JSON.stringify(volta), /sala 2/);
  });

  test("ja respondida: o mesmo literal e a resposta gravada; outro literal recusa", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(entrada(), { registro: b.registro, destinatarios });
    await responder({ pergunta_id, literal: "D1a" }, { registro: b.registro });
    await assert.rejects(responder({ pergunta_id, literal: "D7a" }, { registro: b.registro }), /ja respondida com outro texto/);
    assert.equal(b.linhas.filter((x) => x.evento === A_CONFIRMAR).length, 0);
  });

  test("resposta antiga gravada como texto com o mesmo literal: ja respondida, alternativa livre", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(entrada(), { registro: b.registro, destinatarios });
    const abertura = b.linhas.find((x) => x.evento === "abertura");
    b.linhas.push({ evento: "resposta", pergunta_id, sessao: abertura.sessao, carimbo: new Date(Date.parse(abertura.carimbo) + 1000).toISOString(), versao_esquema: abertura.versao_esquema, has_patient_data: false, item: abertura.item, titulo: abertura.titulo, resposta_literal: "D7a", origem_resposta: "agente" });
    const r = await responder({ pergunta_id, literal: "D7a" }, { registro: b.registro });
    assert.equal(r.ja_respondida, true);
    assert.equal(r.tipo, "alternativa-livre");
    assert.equal(r.confirmar, undefined);
    assert.equal(b.linhas.filter((x) => x.evento === A_CONFIRMAR).length, 0);
  });

  test("gravacao pelo registroGit: o evento a-confirmar entra no destino git", async () => {
    const { pecas, arquivos } = pecasDuble();
    const arquivo = "decisoes/decisoes.jsonl";
    const reg = registroGit({ arquivo, pecas });
    const { pergunta_id } = await abrir(entrada(), { registro: reg, destinatarios });
    const r = await responder({ pergunta_id, literal: "D7a" }, { registro: reg });
    assert.equal(r.tipo, A_CONFIRMAR);
    assert.equal(r.gravados, 1);
    assert.deepEqual(arquivos.get(arquivo).map((e) => e.evento), ["abertura", A_CONFIRMAR]);
    const l = await ler({ pergunta_id }, { registro: reg });
    assert.equal(l.perguntas[0].estado, "aberta");
  });

  test("a saida da CLI traz a frase de confirmacao", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(entrada(), { registro: b.registro, destinatarios });
    const out = [];
    const c = await principal(["responder", "--pergunta", pergunta_id, "--literal", "D7a"], { registro: b.registro, stdout: { write: (s) => out.push(s) }, stderr: { write() {} } });
    assert.equal(c, 0);
    assert.match(out.join(""), /a-confirmar/);
    assert.match(out.join(""), /D7a não existe neste bloco\. Ela não vale como escolha/);
  });
});

describe("gravarDestino — resposta antiga que hoje se le a-confirmar", () => {
  test("sem escolha: destino nulo e a recusa de sempre, nunca erro da leitura", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(entrada({ achado: true }), { registro: b.registro, destinatarios });
    const abertura = b.linhas.find((x) => x.evento === "abertura");
    // A resposta gravada pelo gancho antes da T17, sem destino, com um literal que hoje volta.
    b.linhas.push({ evento: "resposta", pergunta_id, sessao: abertura.sessao, carimbo: new Date(Date.parse(abertura.carimbo) + 1000).toISOString(), versao_esquema: abertura.versao_esquema, has_patient_data: false, item: abertura.item, titulo: abertura.titulo, resposta_literal: "D9a", origem_resposta: "agente" });
    await assert.rejects(gravarDestino({ pergunta_id, ponteiro: "T8" }, { registro: b.registro }), /respondida sem destino; nada a apontar/);
  });
  test("controle: a resposta antiga que casa segue apontando o destino da opcao", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(entrada({ achado: true }), { registro: b.registro, destinatarios });
    const abertura = b.linhas.find((x) => x.evento === "abertura");
    b.linhas.push({ evento: "resposta", pergunta_id, sessao: abertura.sessao, carimbo: new Date(Date.parse(abertura.carimbo) + 1000).toISOString(), versao_esquema: abertura.versao_esquema, has_patient_data: false, item: abertura.item, titulo: abertura.titulo, resposta_literal: "D1a", origem_resposta: "agente" });
    const r = await gravarDestino({ pergunta_id, ponteiro: "T8" }, { registro: b.registro });
    assert.equal(r.destino, "corrigir-agora");
  });
});
