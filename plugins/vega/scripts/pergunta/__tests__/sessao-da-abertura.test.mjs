// sessao-da-abertura.test.mjs — hotfix pergunta-nao-pede-resposta-duas-vezes (20/11/2026).
//
// Queixa do operador: "os agentes não aceitam minhas respostas e tenho que repetir". Causa medida:
// a pergunta aberta com o id de nuvem da sessão (`session_…`, `cse_…`) no campo `sessao`; a prova
// da resposta se lê pelo transcript dessa sessão, que não existe com esse nome, e o `autorizar-ciclo`
// recusa `origem-sem-prova` — o agente reabre e pede a resposta de novo. A prova aqui:
//   1. abrir com id de nuvem recusa, dizendo qual id usar;
//   2. abrir sem `sessao` usa `CLAUDE_CODE_SESSION_ID`; sem os dois, recusa;
//   3. a pergunta já aberta com id de nuvem, reaberta com o id certo depois da resposta, mantém o id
//      e a resposta já digitada vale — e só ela: sem o bloco no transcript antes da resposta, ou com
//      a autoria também de nuvem, a origem segue `agente` (D-VEGA19-27 não afrouxa);
//   4. a recusa do `autorizar-ciclo` diz o conserto que o agente faz sozinho;
//   5. a autoria do mesmo turno (o gancho) lê o transcript desta sessão quando a abertura é de nuvem.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";

import { abrir, ErroComando, eventoDeAbertura, sessaoDoAbrir } from "../comando.mjs";
import { tabelaPadrao } from "../destinatarios.mjs";
import { renderizar } from "../renderizar.mjs";
import { criarPergunta } from "../forma.mjs";
import * as prova from "../prova.mjs";
import { exigirPerguntaDoAutorizar } from "../../conducao/consentimento.mjs";
import { pecasDuble, registroBancoDuble } from "./dubles.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..", "..", "..", "..", "..");
const GANCHO = path.join(RAIZ, ".claude", "hooks", "decisao-do-operador.mjs");
const LIB = path.join(RAIZ, ".claude", "scripts", "estado", "lib", "pergunta.mjs");
const NA_FONTE = existsSync(GANCHO) && existsSync(LIB);
const lib = NA_FONTE ? await import(pathToFileURL(LIB).href) : null;

const NUVEM = "cse_01AAAAAAAAAAAAAAAAAAAAAAAA";
const LOCAL = "0b1c2d3e-0000-4000-8000-00000000a1b2";
const ARQUIVO = `/tmp/transcripts/${LOCAL}.jsonl`;
const CICLO = "VEGA-20-dieta-da-fabrica";
const ABERTA = "2026-11-20T10:00:00.000Z";
const MOSTRADA = "2026-11-20T10:00:01.000Z";
const RESPONDIDA = "2026-11-20T10:02:00.000Z";
const REABERTA = "2026-11-20T10:05:00.000Z";
const destinatarios = tabelaPadrao();
const opcoes = { destinatarios: destinatarios.papeis, tabela: destinatarios };

const bruta = () => ({
  numero: 6,
  assunto: "tela de repasse",
  papel: "operador",
  has_patient_data: false,
  itens: [{ titulo: "decisao 6", contexto: "o plano pede tela nova; o app ja tem uma", opcoes: [{ texto: "evoluir a existente" }, { texto: "criar a nova" }], recomendada: "a", motivo: "sem tela duplicada" }],
});
const banco = () => registroBancoDuble(pecasDuble().pecas);

/** A pergunta como o agente a abriu antes do conserto: a sessão é o id de nuvem. */
function abertaComNuvem(b) {
  const p = criarPergunta({ ...bruta(), sessao: NUVEM }, opcoes);
  b.linhas.push(eventoDeAbertura(p, { sessao: NUVEM, ciclo: CICLO, carimbo: ABERTA }));
  return p;
}

/** O transcript local: o bloco da pergunta (a marca) e depois a resposta digitada pelo operador. */
const textoDoBloco = (id) => `${renderizar(criarPergunta({ ...bruta(), sessao: NUVEM }, opcoes), opcoes).texto}\n<!-- pergunta ${id} -->`;
const bloco = (id, extra = {}) => ({ uuid: "a-1", sessionId: LOCAL, type: "assistant", timestamp: MOSTRADA, message: { content: [{ type: "text", text: textoDoBloco(id) }] }, ...extra });
const humana = (extra = {}) => ({ uuid: "u-1", sessionId: LOCAL, type: "user", origin: { kind: "human" }, timestamp: RESPONDIDA, message: { content: "D6a" }, ...extra });
const resposta = (id) => ({ evento: "resposta", pergunta_id: id, sessao: NUVEM, ciclo: CICLO, carimbo: RESPONDIDA, item: "D6", resposta_literal: "D6a", escolha: "a", origem_resposta: "agente" });
const autoria = (id, extra = {}) => ({ evento: "autoria", pergunta_id: id, sessao: LOCAL, carimbo: RESPONDIDA, origem_resposta: "digitado", prova: `transcript:${ARQUIVO}#u-1`, ...extra });
const leitor = (entradas) => ({ achar: (s) => (s === LOCAL ? ARQUIVO : null), lerEntradas: (a) => (a === ARQUIVO ? entradas : null) });

describe("abrir: a sessão é o id do transcript local", () => {
  test("id de nuvem recusa sessao-de-nuvem, dizendo qual id usar", async () => {
    const b = banco();
    await assert.rejects(
      abrir({ sessao: NUVEM, ciclo: CICLO, pergunta: bruta() }, { registro: b.registro, destinatarios, env: { CLAUDE_CODE_SESSION_ID: LOCAL } }),
      (e) => e instanceof ErroComando && /^sessao-de-nuvem: /.test(e.message) && e.message.includes(`use ${LOCAL}`),
    );
    assert.throws(() => sessaoDoAbrir(`session_${"x".repeat(20)}`, {}), /sessao-de-nuvem: .*nome do \.jsonl/);
    assert.equal(b.linhas.length, 0, "nada gravado");
  });

  test("sem sessao na entrada, a abertura grava CLAUDE_CODE_SESSION_ID", async () => {
    const b = banco();
    const r = await abrir({ ciclo: CICLO, pergunta: bruta() }, { registro: b.registro, destinatarios, env: { CLAUDE_CODE_SESSION_ID: LOCAL } });
    const ab = b.linhas.find((e) => e.evento === "abertura" && e.pergunta_id === r.pergunta_id);
    assert.equal(ab.sessao, LOCAL);
  });

  test("sem sessao e sem a variável (estação sem ela), recusa pedindo o id do transcript", async () => {
    const b = banco();
    await assert.rejects(abrir({ ciclo: CICLO, pergunta: bruta() }, { registro: b.registro, destinatarios, env: {} }), /sem CLAUDE_CODE_SESSION_ID.*\.jsonl/);
    // A variável com id de nuvem não serve de padrão.
    await assert.rejects(abrir({ ciclo: CICLO, pergunta: bruta() }, { registro: b.registro, destinatarios, env: { CLAUDE_CODE_SESSION_ID: NUVEM } }), /sem CLAUDE_CODE_SESSION_ID/);
  });

  test("sessao explícita fora da nuvem segue valendo (testes, outra sessão local)", () => {
    assert.equal(sessaoDoAbrir("zz-test-sessao", { CLAUDE_CODE_SESSION_ID: LOCAL }), "zz-test-sessao");
  });
});

describe("a pergunta já aberta com id de nuvem: a resposta dada vale, sem pedir de novo", () => {
  test("antes do conserto (prova pela sessão da abertura) a resposta não valia", () => {
    const b = banco();
    const p = abertaComNuvem(b);
    // O leitor de antes: a sessão da prova era sempre a da abertura, e o transcript de NUVEM não existe.
    const comoAntes = { achar: (s) => (s === NUVEM ? null : null), lerEntradas: () => null };
    assert.equal(prova.origemEfetiva(p.id, { eventos: [...b.linhas, resposta(p.id), autoria(p.id)], ...comoAntes }).origem, "agente");
  });

  test("reaberta com o id certo depois da resposta: mesmo id, nada novo gravado, e a resposta vale", async () => {
    const b = banco();
    const p = abertaComNuvem(b);
    const r = await abrir({ ciclo: CICLO, pergunta: bruta() }, { registro: b.registro, destinatarios, carimbo: REABERTA, env: { CLAUDE_CODE_SESSION_ID: LOCAL } });
    assert.equal(r.pergunta_id, p.id, "a reabertura que só corrige o id devolve o id antigo");
    assert.equal(r.gravados, 0);
    assert.equal(r.ja_existiam, 1);
    const eventos = [...b.linhas, resposta(p.id), autoria(p.id)];
    const entradas = [bloco(p.id), humana()];
    assert.equal(prova.origemEfetiva(p.id, { eventos, ...leitor(entradas) }).origem, "digitado");
    if (lib) assert.equal(lib.origemEfetiva(p.id, { eventos, ...leitor(entradas) }).origem, "digitado", "paridade com a lib da Sistoli");
  });

  test("a prova não afrouxa: sem o bloco antes, com o bloco depois, mensagem do agente ou autoria de nuvem ⇒ agente", () => {
    const b = banco();
    const p = abertaComNuvem(b);
    const eventos = [...b.linhas, resposta(p.id), autoria(p.id)];
    const casos = [
      ["sem o bloco no transcript", eventos, [humana()]],
      ["bloco de outra pergunta", eventos, [bloco("p-00000000000000ff"), humana()]],
      ["bloco depois da resposta", eventos, [bloco(p.id, { timestamp: "2026-11-20T10:03:00.000Z" }), humana()]],
      ["mensagem que não é do operador", eventos, [bloco(p.id), humana({ origin: { kind: "agent" } })]],
      ["autoria também de nuvem", [...b.linhas, resposta(p.id), autoria(p.id, { sessao: NUVEM })], [bloco(p.id), humana()]],
      ["resposta anterior à abertura", eventos, [bloco(p.id, { timestamp: "2026-11-20T09:58:00.000Z" }), humana({ timestamp: "2026-11-20T09:59:00.000Z" })]],
    ];
    for (const [nome, evs, entradas] of casos) {
      assert.equal(prova.origemEfetiva(p.id, { eventos: evs, ...leitor(entradas) }).origem, "agente", nome);
      if (lib) assert.equal(lib.origemEfetiva(p.id, { eventos: evs, ...leitor(entradas) }).origem, "agente", `${nome} (lib)`);
    }
  });

  test("reabertura com outro conteúdo não herda o id da de nuvem", async () => {
    const b = banco();
    const p = abertaComNuvem(b);
    const outra = { ...bruta(), itens: [{ ...bruta().itens[0], opcoes: [{ texto: "manter as duas telas" }, { texto: "criar a nova" }] }] };
    await assert.rejects(abrir({ ciclo: CICLO, pergunta: outra }, { registro: b.registro, destinatarios, env: { CLAUDE_CODE_SESSION_ID: LOCAL } }), (e) => /numero-ja-usado/.test(e.message) && e.message.includes(p.id));
  });

  test("reabertura para outro destinatário não herda o id da de nuvem", async () => {
    const b = banco();
    const p = abertaComNuvem(b);
    const outroPapel = { ...bruta(), papel: "responsavel-clinico" };
    await assert.rejects(abrir({ ciclo: CICLO, pergunta: outroPapel }, { registro: b.registro, destinatarios, env: { CLAUDE_CODE_SESSION_ID: LOCAL } }), (e) => /numero-ja-usado/.test(e.message) && e.message.includes(p.id));
  });
});

describe("a recusa do autorizar-ciclo diz o conserto que o agente faz sozinho", () => {
  test("abertura de nuvem sem autoria: o conserto manda rodar na sessão do bloco e não pedir de novo", () => {
    const b = banco();
    const p = abertaComNuvem(b);
    const r = prova.perguntaDoAutorizar(p.id, { eventos: [...b.linhas, resposta(p.id)], ...leitor([]) });
    assert.equal(r.motivo, "sem-autoria");
    assert.match(r.conserto, /^conserto sem o operador: .*id de nuvem.*sem pedir a resposta outra vez.*nao achou, a pergunta segue aberta/);
    if (lib) assert.equal(lib.perguntaDoAutorizar(p.id, { eventos: [...b.linhas, resposta(p.id)], ...leitor([]) }).conserto, r.conserto, "paridade");
    const perguntas = { perguntaDoAutorizar: () => r };
    assert.throws(
      () => exigirPerguntaDoAutorizar({ repo: "/nao-usado", perguntas, pergunta_id: p.id, ciclo: CICLO, fase: "F1", sim: "evoluir a existente", rodar: () => "" }),
      (e) => e.codigo === "origem-sem-prova" && e.message.includes("conserto sem o operador"),
    );
  });

  test("origem humana não leva conserto", () => {
    const b = banco();
    const p = abertaComNuvem(b);
    const r = prova.perguntaDoAutorizar(p.id, { eventos: [...b.linhas, resposta(p.id), autoria(p.id)], ...leitor([bloco(p.id), humana()]) });
    assert.equal(r.origem, "digitado");
    assert.equal(r.conserto, null);
  });
});

describe("a autoria do mesmo turno, pelo gancho", { skip: !NA_FONTE && "fora da fonte: sem o gancho da Sistoli" }, () => {
  test("abertura de nuvem: o gancho lê o transcript desta sessão e a autoria resolve", async () => {
    const g = await import(pathToFileURL(GANCHO).href);
    const b = banco();
    const p = abertaComNuvem(b);
    const eventos = [...b.linhas, resposta(p.id)];
    const entradas = [bloco(p.id), humana()];
    const l = leitor(entradas);
    const semLocal = g.autoriasDoTurno(p.id, { eventos, ...l, sessaoLocal: null });
    assert.equal(semLocal.length, 0, "sem a sessão local, nada (fail-closed)");
    const doTurno = g.autoriasDoTurno(p.id, { eventos, ...l, sessaoLocal: LOCAL });
    assert.equal(doTurno.length, 1);
    assert.equal(doTurno[0].sessao, LOCAL);
    assert.equal(lib.origemEfetiva(p.id, { eventos: [...eventos, ...doTurno], ...l }).origem, "digitado");
  });
});
