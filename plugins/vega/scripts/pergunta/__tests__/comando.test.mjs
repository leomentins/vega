// comando.test.mjs — VEGA-19 T11, T28 (AC-VEGA19-1, AC-VEGA19-2, AC-VEGA19-7; D-VEGA19-24,
// D-VEGA19-27, D-VEGA19-37). Peça do corpo da fábrica: o teste não importa biblioteca de projeto.
// As peças (registro de decisões, gravador do destino git, regras de achado e lista do dono) e o
// registro do destino banco são os dublês de `dubles.mjs`. O comando com as peças reais da Sistoli
// (banco falso sobre a lib, fila local e drenagem, gravador git de verdade) mora em
// `.vega/__tests__/sistoli.test.mjs`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";

import {
  abrir,
  conferirPecas,
  dispensar,
  ErroComando,
  EXPORT_DAS_PECAS,
  formatarLeitura,
  gravarDestino,
  interpretarResposta,
  ler,
  pecasDoProjeto,
  principal,
  registroBanco,
  registroGit,
  responder,
} from "../comando.mjs";
import { tabelaPadrao } from "../destinatarios.mjs";
import { pecasDuble, registroBancoDuble } from "./dubles.mjs";

const destinatarios = tabelaPadrao();
const silencio = { write() {} };
const pastas = [];
const pastaTemp = () => {
  const p = mkdtempSync(path.join(tmpdir(), "pergunta-comando-"));
  pastas.push(p);
  return p;
};
afterEach(() => {
  while (pastas.length) rmSync(pastas.pop(), { recursive: true, force: true });
});

/** CPF sintético montado na hora: a varredura do corpo não acha literal com formato de CPF. */
const CPF_SINTETICO = ["529", "982", "247"].join(".") + "-" + "25";

function perguntaDe({ sessao = "zz-test-sessao", numero = 6, assunto = "tela de repasse", itens = 1, paciente = false } = {}) {
  const item = (i) => ({
    titulo: `decisao ${numero + i}`,
    contexto: "o plano pede tela nova; o app ja tem uma",
    opcoes: [{ texto: "evoluir a tela existente" }, { texto: "criar a nova e aposentar a velha" }],
    recomendada: "a",
    motivo: "mesmo resultado, sem tela duplicada",
  });
  return {
    sessao,
    ciclo: "VEGA-19-pergunta-tipada",
    pergunta: {
      numero,
      assunto,
      papel: "operador",
      has_patient_data: paciente,
      ...(paciente ? { ponteiro: "sensivel/caso-17" } : {}),
      itens: Array.from({ length: itens }, (_, i) => item(i)),
    },
  };
}

function banco() {
  const { pecas } = pecasDuble();
  return registroBancoDuble(pecas);
}

describe("interpretarResposta — a letra, o numero e o texto livre (AC-VEGA19-2)", () => {
  const itens = [{ numero: 6, opcoes: [{ letra: "a" }, { letra: "b" }] }];
  test("D6a e 6a casam a mesma decisao", () => {
    assert.deepEqual(interpretarResposta("D6a", itens).escolhas, [{ numero: 6, letra: "a" }]);
    assert.deepEqual(interpretarResposta("6a", itens).escolhas, [{ numero: 6, letra: "a" }]);
    assert.equal(interpretarResposta("6a", itens).tipo, "opcao");
    assert.deepEqual(interpretarResposta("6a", itens).ecoada, ["D6a"]);
  });
  test("letra unica do bloco de um item e ecoada com o numero", () => {
    const r = interpretarResposta("b", itens);
    assert.deepEqual(r.ecoada, ["D6b"]);
    assert.equal(r.tipo, "opcao");
  });
  test("opcao com comentario", () => {
    const r = interpretarResposta("a — mas so depois do deploy", itens);
    assert.equal(r.tipo, "opcao-com-comentario");
    assert.equal(r.comentario, "mas so depois do deploy");
    assert.equal(r.alternativa_livre, false);
  });
  test("texto sem letra e alternativa livre (inclusive 'a' como artigo)", () => {
    const r = interpretarResposta("a gente faz as duas, em fases", itens);
    assert.equal(r.tipo, "alternativa-livre");
    assert.equal(r.alternativa_livre, true);
    assert.deepEqual(r.escolhas, []);
  });
  test("letra que nao e opcao recusa alto; sem literal recusa", () => {
    assert.throws(() => interpretarResposta("D6z", itens), /z nao e opcao de D6/);
    assert.throws(() => interpretarResposta("   ", itens), /literal/);
  });
  test("varios itens: cada numero com a sua letra", () => {
    const dois = [...itens, { numero: 7, opcoes: [{ letra: "a" }, { letra: "b" }] }];
    const r = interpretarResposta("D6a D7b", dois);
    assert.deepEqual(r.ecoada, ["D6a", "D7b"]);
    assert.throws(() => interpretarResposta("6a 6b", dois), /duas letras/);
  });
});

describe("as peças do projeto — sem elas o comando recusa (D-VEGA19-37)", () => {
  test("peças incompletas recusam com o nome do que falta", () => {
    const { pecas } = pecasDuble();
    assert.equal(conferirPecas(pecas), pecas);
    const { estadoDasPerguntas: _e, ...sem } = pecas;
    assert.throws(() => conferirPecas(sem), (e) => e instanceof ErroComando && /faltam estadoDasPerguntas/.test(e.message));
    assert.throws(() => conferirPecas({ ...pecas, PORQUES_DE_DEBITO: [] }), /faltam PORQUES_DE_DEBITO/);
    assert.throws(() => conferirPecas(null), ErroComando);
    assert.throws(() => registroGit({ arquivo: "x.jsonl" }), /registro git: peças da pergunta/);
    assert.throws(() => registroBanco({ repo: pastaTemp() }), /registro banco: peças da pergunta/);
  });

  test("registro sem peças recusa antes de gravar", async () => {
    const b = banco();
    const { pecas: _p, ...semPecas } = b.registro;
    await assert.rejects(abrir(perguntaDe(), { registro: semPecas, destinatarios }), /peças da pergunta/);
    await assert.rejects(ler({}, { registro: semPecas }), /peças da pergunta/);
    assert.equal(b.linhas.length, 0);
    assert.equal(b.chamadas.length, 0);
  });

  test("repositório sem adaptador que exporte as peças recusa com mensagem clara", async () => {
    // Repositório vazio: sem declaração própria, o código declarado não existe nele.
    await assert.rejects(pecasDoProjeto(pastaTemp()), (e) => e instanceof ErroComando && /sem as peças da pergunta/.test(e.message));
    // O projeto de teste do núcleo tem adaptador, mas o código dele não exporta as peças.
    const projetoDeTeste = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "conducao", "__tests__", "fixtures", "projeto-de-teste");
    await assert.rejects(pecasDoProjeto(projetoDeTeste), (e) => e instanceof ErroComando && new RegExp(`nao exporta ${EXPORT_DAS_PECAS}`).test(e.message));
    // Peças que o adaptador entrega pela metade recusam também.
    const { pecas } = pecasDuble();
    const { lerDestino: _l, ...metade } = pecas;
    const importar = async () => ({ [EXPORT_DAS_PECAS]: async () => metade });
    const comCodigo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "conducao", "__tests__", "fixtures", "projeto-de-teste");
    await assert.rejects(pecasDoProjeto(comCodigo, { importar }), /faltam lerDestino/);
    const certo = await pecasDoProjeto(comCodigo, { importar: async () => ({ [EXPORT_DAS_PECAS]: async () => pecas }) });
    assert.equal(certo, pecas);
  });

  test("CLI sem registro injetado, num repositório sem as peças, sai recusa e nao grava", async () => {
    const err = [];
    const c = await principal(["ler", "--repo", pastaTemp()], { stdout: silencio, stderr: { write: (s) => err.push(s) } });
    assert.equal(c, 2);
    assert.match(err.join(""), /sem as peças da pergunta/);
  });
});

describe("destino banco (dublê) — abrir, responder, dispensar, ler (AC-VEGA19-1, AC-VEGA19-7)", () => {
  test("abrir grava a abertura antes de devolver o bloco; idempotente", async () => {
    const b = banco();
    const r = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    assert.match(r.pergunta_id, /^p-[0-9a-f]{16}$/);
    assert.equal(b.linhas.length, 1);
    assert.equal(b.linhas[0].evento, "abertura");
    assert.equal(b.linhas[0].pergunta_id, r.pergunta_id);
    assert.equal(b.linhas[0].versao_esquema, 2);
    assert.equal(b.linhas[0].item, "D6");
    assert.equal(r.sem_registro, false);
    assert.match(r.texto, /\*\*Decisão de engenharia — tela de repasse\*\*/);
    assert.match(r.texto, new RegExp(`<!-- pergunta ${r.pergunta_id} -->`));
    const de_novo = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    assert.equal(de_novo.pergunta_id, r.pergunta_id);
    assert.equal(de_novo.ja_existiam, 1);
    assert.equal(b.linhas.length, 1);
  });

  test("responder grava linha propria com o literal, origem agente, amarrada a versao", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    const r = await responder({ pergunta_id, literal: "a — ok, mas sem pressa" }, { registro: b.registro });
    assert.equal(r.tipo, "opcao-com-comentario");
    assert.deepEqual(r.ecoada, ["D6a"]);
    const resp = b.linhas.find((l) => l.evento === "resposta");
    assert.ok(resp, "linha resposta gravada");
    assert.equal(resp.origem_resposta, "agente");
    assert.equal(resp.resposta_literal, "a — ok, mas sem pressa");
    assert.equal(resp.escolha, "a");
    assert.equal(resp.recomendada, "a");
    assert.equal(resp.comentario, "ok, mas sem pressa");
    assert.equal(resp.versao_esquema, 2);
    assert.equal(resp.perguntado_em, b.linhas[0].carimbo);
    const l = await ler({ pergunta_id }, { registro: b.registro });
    assert.equal(l.perguntas.length, 1);
    assert.equal(l.perguntas[0].estado, "respondida");
    assert.match(formatarLeitura(l), /respondida/);
    assert.match(formatarLeitura(l), /fila: 0 pendentes/);
  });

  test("responder sem literal, com origem hook ou outra recusa; sem abertura recusa", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    await assert.rejects(responder({ pergunta_id, literal: "" }, { registro: b.registro }), /literal/);
    await assert.rejects(responder({ pergunta_id, literal: "a", origem: "hook" }, { registro: b.registro }), /origem hook recusada/);
    await assert.rejects(responder({ pergunta_id, literal: "a", origem: "digitado" }, { registro: b.registro }), /o gancho sobe a origem/);
    await assert.rejects(responder({ pergunta_id: "p-0000000000000000", literal: "a" }, { registro: b.registro }), /sem abertura/);
    assert.equal(b.linhas.filter((l) => l.evento === "resposta").length, 0);
  });

  test("resposta repetida com o mesmo texto e idempotente; com outro texto recusa", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    await responder({ pergunta_id, literal: "D6b" }, { registro: b.registro });
    const de_novo = await responder({ pergunta_id, literal: "D6b" }, { registro: b.registro });
    assert.equal(de_novo.ja_respondida, true);
    await assert.rejects(responder({ pergunta_id, literal: "D6a" }, { registro: b.registro }), /ja respondida/);
    assert.equal(b.linhas.filter((l) => l.evento === "resposta").length, 1);
  });

  test("dispensar grava a dispensa e a pergunta segue aberta; alternativa livre grava sem escolha", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    await dispensar({ pergunta_id, motivo: "volto nisso amanha" }, { registro: b.registro });
    let l = await ler({ pergunta_id }, { registro: b.registro });
    assert.equal(l.perguntas[0].estado, "aberta");
    assert.equal(l.perguntas[0].dispensas, 1);
    const r = await responder({ pergunta_id, literal: "faz as duas em fases" }, { registro: b.registro });
    assert.equal(r.tipo, "alternativa-livre");
    const resp = b.linhas.find((l2) => l2.evento === "resposta");
    assert.equal(resp.alternativa_livre, true);
    assert.equal(resp.escolha, null);
    l = await ler({ pergunta_id }, { registro: b.registro });
    assert.equal(l.perguntas[0].estado, "respondida");
    await assert.rejects(dispensar({ pergunta_id }, { registro: b.registro }), /ja respondida/);
  });

  test("abertura de outra versao do esquema recusa a resposta", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    b.linhas[0].versao_esquema = 3;
    await assert.rejects(responder({ pergunta_id, literal: "a" }, { registro: b.registro }), /esquema 3/);
  });

  test("pergunta com paciente: a resposta vai so com as letras, sem comentario", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe({ paciente: true }), { registro: b.registro, destinatarios });
    assert.equal(b.linhas[0].has_patient_data, true);
    assert.equal(b.linhas[0].ponteiro, "sensivel/caso-17");
    const r = await responder({ pergunta_id, literal: "a, liga para a familia antes" }, { registro: b.registro });
    assert.equal(r.comentario, null);
    const resp = b.linhas.find((l) => l.evento === "resposta");
    assert.equal(resp.resposta_literal, "D6a");
    assert.equal(resp.comentario, null);
    assert.equal(resp.has_patient_data, true);
    assert.ok(!JSON.stringify(resp).includes("familia"));
  });

  test("registro fora do ar: o bloco sai marcado sem registro, e a resposta que so esta na fila nao se diz registrada", async () => {
    const b = banco();
    b.fora = true;
    const r = await abrir(perguntaDe(), { registro: b.registro, destinatarios, carimbo: "2026-11-17T10:00:00.000Z" });
    assert.equal(r.sem_registro, true);
    assert.match(r.texto, /sem registro/);
    assert.match(r.texto, new RegExp(`<!-- pergunta ${r.pergunta_id} · sem registro -->`));
    const resp = await responder({ pergunta_id: r.pergunta_id, literal: "D6a", carimbo: "2026-11-17T10:02:00.000Z" }, { registro: b.registro });
    assert.equal(resp.sem_registro, true);
    const de_novo = await responder({ pergunta_id: r.pergunta_id, literal: "D6a" }, { registro: b.registro });
    assert.equal(de_novo.ja_respondida, true);
    assert.equal(de_novo.sem_registro, true, "resposta so na fila nao se diz registrada");
    const l = await ler({}, { registro: b.registro });
    assert.equal(l.sem_registro, true);
    assert.match(formatarLeitura(l), /fila: 2 pendentes, a mais antiga de 2026-11-17T10:00:00.000Z/);
    b.fora = false;
    const depois = await ler({ pergunta_id: r.pergunta_id }, { registro: b.registro });
    assert.equal(depois.sem_registro, false);
    assert.equal(depois.perguntas[0].estado, "respondida");
    assert.equal(b.linhas.length, 2);
  });

  test("lista do dono vem das peças; --dono so com --abertas e so no banco", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    const l = await ler({ abertas: true }, { registro: b.registro });
    assert.deepEqual(l.abertas.map((a) => a.pergunta_id), [pergunta_id]);
    assert.equal(l.lembrete, null);
    assert.match(formatarLeitura(l, b.registro.pecas), new RegExp(`${pergunta_id} · D6 · aberta`));
    assert.throws(() => formatarLeitura(l), /formatarAbertas/);
    await assert.rejects(ler({ dono: "zz" }, { registro: b.registro }), /--dono so com --abertas/);
  });
});

describe("achado e divida pelas peças do projeto (AC-VEGA19-3, AC-VEGA19-4)", () => {
  const achadoDe = () => {
    const e = perguntaDe();
    e.achado = true;
    e.pergunta.itens[0].opcoes = [{ texto: "corrigir-agora nesta task" }, { texto: "debito para o proximo ciclo" }];
    return e;
  };

  test("opcao fora dos destinos recusa a abertura; a resposta leva o destino da opcao", async () => {
    const b = banco();
    const torta = perguntaDe();
    torta.achado = true;
    await assert.rejects(abrir(torta, { registro: b.registro, destinatarios }), /so destinos do contrato/);
    assert.equal(b.linhas.length, 0);
    const { pergunta_id } = await abrir(achadoDe(), { registro: b.registro, destinatarios });
    const r = await responder({ pergunta_id, literal: "D6a" }, { registro: b.registro });
    assert.equal(r.destino, "corrigir-agora");
    await assert.rejects(responder({ pergunta_id, literal: "D6a", destino: "xis" }, { registro: b.registro }), /destino xis/);
  });

  test("destino debito sem a divida recusa antes de gravar; com ela, grava a divida", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(achadoDe(), { registro: b.registro, destinatarios });
    await assert.rejects(responder({ pergunta_id, literal: "D6b" }, { registro: b.registro }), /divida do dublê/);
    assert.equal(b.linhas.filter((l) => l.evento === "resposta").length, 0);
    const r = await responder({ pergunta_id, literal: "D6b", debito: { porque: "sem-tempo", severidade: "baixa", gatilho: "proximo ciclo" } }, { registro: b.registro });
    assert.equal(r.destino, "debito");
    assert.equal(b.linhas.find((l) => l.evento === "resposta").debito.porque, "sem-tempo");
  });

  // T32 (D-VEGA19-43): a pergunta `achado-sem-destino` que o gancho de antes da T17 gravou — a
  // resposta sem destino — fecha pelo `responder` com o destino da opcao e pelo `destino`, que grava
  // a linha de ponteiro (a lista do dono tira a pergunta quando ha linha `destino`, D-VEGA19-36).
  const achadoLegado = async (literal, opcoes = null) => {
    const b = banco();
    const entrada = achadoDe();
    if (opcoes) entrada.pergunta.itens[0].opcoes = opcoes;
    const { pergunta_id } = await abrir(entrada, { registro: b.registro, destinatarios });
    const ab = b.linhas.find((l) => l.evento === "abertura");
    b.linhas.push({ evento: "resposta", pergunta_id, sessao: ab.sessao, ciclo: ab.ciclo, carimbo: "2026-11-17T12:00:00.000Z", item: ab.item, titulo: ab.titulo, resposta_literal: literal, origem_resposta: "agente" });
    return { b, pergunta_id };
  };

  test("achado-sem-destino: responder aceita com o destino da opcao, e o destino fecha a pergunta", async () => {
    const { b, pergunta_id } = await achadoLegado("D6a");
    const r = await responder({ pergunta_id, literal: "D6a" }, { registro: b.registro });
    assert.equal(r.destino, "corrigir-agora");
    assert.equal(r.legada, true);
    assert.equal(r.gravados, 0);
    assert.match(r.proximo, /^destino --pergunta p-[0-9a-f]{16} --ponteiro/);
    assert.equal(b.linhas.filter((l) => l.evento === "resposta").length, 1, "a resposta segue uma so");
    // `--destino` igual ao da opcao tambem passa; diferente recusa.
    assert.equal((await responder({ pergunta_id, literal: "D6a", destino: "corrigir-agora" }, { registro: b.registro })).destino, "corrigir-agora");
    await assert.rejects(responder({ pergunta_id, literal: "D6a", destino: "descartar" }, { registro: b.registro }), /diverge da opcao/);
    const d = await gravarDestino({ pergunta_id, ponteiro: "T32" }, { registro: b.registro });
    assert.equal(d.destino, "corrigir-agora");
    assert.equal(d.gravados, 1);
    const linhasDestino = b.linhas.filter((l) => l.evento === "destino");
    assert.equal(linhasDestino.length, 1);
    assert.equal(linhasDestino[0].ponteiro, "T32");
    const [estado] = (await ler({ pergunta_id }, { registro: b.registro })).perguntas;
    assert.deepEqual(estado.destinos, ["T32"]);
    // Fechada: repetir a resposta nao pede mais o ponteiro.
    assert.equal((await responder({ pergunta_id, literal: "D6a" }, { registro: b.registro })).proximo, null);
  });

  test("achado-sem-destino: com debito, sem destino ou com dois destinos segue recusando", async () => {
    const comDebito = await achadoLegado("D6b");
    await assert.rejects(responder({ pergunta_id: comDebito.pergunta_id, literal: "D6b" }, { registro: comDebito.b.registro }), /divida do dublê/);
    await assert.rejects(
      responder({ pergunta_id: comDebito.pergunta_id, literal: "D6b", debito: { porque: "sem-tempo", severidade: "baixa", gatilho: "proximo ciclo" } }, { registro: comDebito.b.registro }),
      /debito pede a divida ligada/,
    );
    await assert.rejects(gravarDestino({ pergunta_id: comDebito.pergunta_id, ponteiro: "T32" }, { registro: comDebito.b.registro }), /debito pede a divida ligada/);

    // Sem destino: texto livre, sem letra; `--destino` sem opcao que o nomeie nao basta.
    const semDestino = await achadoLegado("nenhuma das duas, depois vejo");
    await assert.rejects(responder({ pergunta_id: semDestino.pergunta_id, literal: "nenhuma das duas, depois vejo" }, { registro: semDestino.b.registro }), /destino do contrato/);
    await assert.rejects(
      responder({ pergunta_id: semDestino.pergunta_id, literal: "nenhuma das duas, depois vejo", destino: "descartar" }, { registro: semDestino.b.registro }),
      /ja respondida sem destino \(pelo gancho\).*destino do contrato/,
    );
    await assert.rejects(gravarDestino({ pergunta_id: semDestino.pergunta_id, ponteiro: "T32" }, { registro: semDestino.b.registro }), /ja respondida sem destino \(pelo gancho\)/);

    // Dois destinos: dois itens, cada letra num destino diferente.
    const b = banco();
    const entrada = achadoDe();
    entrada.pergunta.itens = [entrada.pergunta.itens[0], { ...entrada.pergunta.itens[0], titulo: "decisao 7", opcoes: [{ texto: "descartar o achado" }, { texto: "debito para o proximo ciclo" }] }];
    const { pergunta_id } = await abrir(entrada, { registro: b.registro, destinatarios });
    const ab = b.linhas.find((l) => l.evento === "abertura");
    b.linhas.push({ evento: "resposta", pergunta_id, sessao: ab.sessao, ciclo: ab.ciclo, carimbo: "2026-11-17T12:00:00.000Z", item: ab.item, titulo: ab.titulo, resposta_literal: "D6a D7a", origem_resposta: "agente" });
    await assert.rejects(responder({ pergunta_id, literal: "D6a D7a" }, { registro: b.registro }), /um destino por pergunta/);
    await assert.rejects(gravarDestino({ pergunta_id, ponteiro: "T32" }, { registro: b.registro }), /um destino por pergunta/);

    for (const caso of [comDebito, semDestino, { b }]) assert.equal(caso.b.linhas.filter((l) => l.evento === "destino").length, 0, "recusa nao grava linha destino");
  });

  test("fora de achado, a resposta sem destino segue sem nada a apontar", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    await responder({ pergunta_id, literal: "D6a" }, { registro: b.registro });
    await assert.rejects(gravarDestino({ pergunta_id, ponteiro: "T32" }, { registro: b.registro }), /respondida sem destino; nada a apontar/);
  });
});

describe("destino git — pelo gravador que as peças entregam", () => {
  test("abrir, responder, dispensar e ler; abrir de novo nao duplica", async () => {
    const { pecas, arquivos } = pecasDuble();
    const arquivo = "decisoes/decisoes.jsonl";
    const reg = registroGit({ arquivo, pecas });
    const { pergunta_id, texto } = await abrir(perguntaDe(), { registro: reg, destinatarios });
    assert.match(texto, /Decisão de engenharia/);
    assert.equal(arquivos.get(arquivo).length, 1);
    await abrir(perguntaDe(), { registro: reg, destinatarios });
    assert.equal(arquivos.get(arquivo).length, 1, "abrir de novo nao duplica");
    let l = await ler({ pergunta_id }, { registro: reg });
    assert.equal(l.perguntas[0].estado, "aberta");
    await dispensar({ pergunta_id }, { registro: reg });
    await responder({ pergunta_id, literal: "6b" }, { registro: reg });
    l = await ler({ sessao: "zz-test-sessao" }, { registro: reg });
    assert.equal(l.perguntas[0].estado, "respondida");
    assert.equal(l.perguntas[0].origem_resposta, "agente");
    assert.equal(l.perguntas[0].resposta_literal, "6b");
    assert.equal(l.perguntas[0].dispensas, 1);
    await assert.rejects(responder({ pergunta_id, literal: "a", origem: "hook" }, { registro: reg }), /origem hook recusada/);
    await assert.rejects(ler({ abertas: true, dono: "zz" }, { registro: reg }), /destino git nao guarda o dono/);
  });

  test("CPF no destino git recusa alto (PHI) e nao grava", async () => {
    const { pecas, arquivos } = pecasDuble();
    const reg = registroGit({ arquivo: "decisoes.jsonl", pecas });
    const e = perguntaDe({ assunto: `paciente ${CPF_SINTETICO}` });
    await assert.rejects(abrir(e, { registro: reg, destinatarios }), (err) => err instanceof ErroComando && err.codigo === 8);
    assert.equal(arquivos.size, 0);
  });

  test("gravador que devolve conta torta sai erro, nunca sucesso", async () => {
    const { pecas } = pecasDuble();
    const torto = { ...pecas, gravarEventosNoGit: () => ({ gravados: 0, ja_existiam: 0, descartadas_phi: 0 }) };
    const reg = registroGit({ arquivo: "decisoes.jsonl", pecas: torto });
    await assert.rejects(abrir(perguntaDe(), { registro: reg, destinatarios }), /conta torta/);
  });
});

describe("CLI", () => {
  test("uso torto sai 1; responder sem --literal sai 1", async () => {
    const err = [];
    assert.equal(await principal(["voar"], { stderr: { write: (s) => err.push(s) } }), 1);
    assert.equal(await principal(["responder", "--pergunta", "p-0000000000000000"], { stderr: silencio }), 1);
  });
  test("ler pelo registro injetado imprime o estado e a fila", async () => {
    const b = banco();
    await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    const out = [];
    const c = await principal(["ler"], { registro: b.registro, stdout: { write: (s) => out.push(s) }, stderr: silencio });
    assert.equal(c, 0);
    assert.match(out.join(""), /D6 · aberta/);
    assert.match(out.join(""), /fila: 0 pendentes/);
  });
  test("ler --abertas pelo registro injetado formata pela lista do dono das peças", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    const out = [];
    const c = await principal(["ler", "--abertas"], { registro: b.registro, stdout: { write: (s) => out.push(s) }, stderr: silencio });
    assert.equal(c, 0);
    assert.match(out.join(""), new RegExp(`${pergunta_id} · D6 · aberta`));
  });
});

describe("rota e recibo (T40, D-VEGA19-54)", () => {
  test("a abertura leva a rota e o papel; sem rota, o padrao", async () => {
    const b = banco();
    const e = perguntaDe();
    e.pergunta.rota = { de: { nivel: "filha" }, por: "hub:sessao-hub" };
    await abrir(e, { registro: b.registro, destinatarios });
    const ab = b.linhas.find((l) => l.evento === "abertura");
    assert.equal(ab.papel, "operador");
    assert.deepEqual(ab.rota, { de: { sessao: "zz-test-sessao", nivel: "filha" }, por: "hub:sessao-hub", para: { papel: "operador", mandato: "engenharia", quem: "pessoa" } });
    const b2 = banco();
    await abrir(perguntaDe(), { registro: b2.registro, destinatarios });
    assert.deepEqual(b2.linhas[0].rota, { de: null, por: "direto", para: { papel: "operador", mandato: "engenharia", quem: "pessoa" } });
  });

  test("responder com --recibo e --por grava recibo, mandato e rota.por; quem fica de fora", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    await responder({ pergunta_id, literal: "a", recibo: "sessao-hub evento-1", por: "pessoa:leomentins" }, { registro: b.registro });
    const resp = b.linhas.find((l) => l.evento === "resposta");
    assert.equal(resp.recibo, "sessao-hub evento-1");
    assert.equal(resp.mandato, "engenharia");
    assert.deepEqual(resp.rota, { por: "pessoa:leomentins" });
    assert.equal("quem" in resp, false);
  });

  test("abertura legada sem rota: o mandato sai do papel", async () => {
    const b = banco();
    const e = perguntaDe();
    e.pergunta.papel = "responsavel-clinico";
    const { pergunta_id } = await abrir(e, { registro: b.registro, destinatarios });
    delete b.linhas[0].rota;
    await responder({ pergunta_id, literal: "a" }, { registro: b.registro });
    const resp = b.linhas.find((l) => l.evento === "resposta");
    assert.equal(resp.mandato, "clinico-regulatorio");
    assert.equal("recibo" in resp, false);
    assert.equal("rota" in resp, false);
  });

  test("recibo ou --por fora da forma recusa antes de gravar; a CLI tambem", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    await assert.rejects(responder({ pergunta_id, literal: "a", recibo: "sem-evento" }, { registro: b.registro }), /--recibo/);
    await assert.rejects(responder({ pergunta_id, literal: "a", por: "hub" }, { registro: b.registro }), /--por/);
    assert.equal(b.linhas.some((l) => l.evento === "resposta"), false);
    const err = [];
    const c = await principal(["responder", "--pergunta", pergunta_id, "--literal", "a", "--recibo", "a b c"], { registro: b.registro, stdout: silencio, stderr: { write: (s) => err.push(s) } });
    assert.equal(c, 1);
    assert.match(err.join(""), /--recibo/);
    const ok = await principal(["responder", "--pergunta", pergunta_id, "--literal", "a", "--recibo", "s1 e1", "--por", "hub:s1"], { registro: b.registro, stdout: silencio, stderr: silencio });
    assert.equal(ok, 0);
    assert.equal(b.linhas.find((l) => l.evento === "resposta").recibo, "s1 e1");
  });
});

describe("rota e recibo — o que a revisao da T40 cobrou", () => {
  test("abertura sem rota nem papel (antes da T40): o mandato fica nulo, nunca engenharia por padrao", async () => {
    const b = banco();
    const e = perguntaDe();
    e.pergunta.papel = "responsavel-clinico";
    const { pergunta_id } = await abrir(e, { registro: b.registro, destinatarios });
    delete b.linhas[0].rota;
    delete b.linhas[0].papel;
    await responder({ pergunta_id, literal: "a" }, { registro: b.registro });
    assert.equal(b.linhas.find((l) => l.evento === "resposta").mandato, null);
  });

  test("resposta repetida: o mesmo recibo passa; outro recibo, recibo depois ou outro --por recusa alto", async () => {
    const b = banco();
    const { pergunta_id } = await abrir(perguntaDe(), { registro: b.registro, destinatarios });
    await responder({ pergunta_id, literal: "a", recibo: "s1 e1", por: "hub:s1" }, { registro: b.registro });
    const de_novo = await responder({ pergunta_id, literal: "a", recibo: "s1 e1", por: "hub:s1" }, { registro: b.registro });
    assert.equal(de_novo.ja_respondida, true);
    await assert.rejects(responder({ pergunta_id, literal: "a", recibo: "s2 e2" }, { registro: b.registro }), /com outro recibo/);
    await assert.rejects(responder({ pergunta_id, literal: "a", por: "direto" }, { registro: b.registro }), /por outro caminho/);
    const b2 = banco();
    const p2 = (await abrir(perguntaDe({ numero: 7 }), { registro: b2.registro, destinatarios })).pergunta_id;
    await responder({ pergunta_id: p2, literal: "a" }, { registro: b2.registro });
    await assert.rejects(responder({ pergunta_id: p2, literal: "a", recibo: "s1 e1" }, { registro: b2.registro }), /sem recibo: o --recibo nao se grava depois/);
  });
});
