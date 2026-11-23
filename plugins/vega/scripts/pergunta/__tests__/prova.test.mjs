/**
 * prova.test.mjs — o leitor de prova do plugin (VEGA-19 T33; AC-VEGA19-7; D-VEGA19-57).
 *
 * `pergunta/prova.mjs` reconfere a `autoria` de uma resposta contra o transcript da sessão da
 * abertura, com o mesmo contrato de `origemEfetiva`/`conferirProva`/`perguntaDoAutorizar` da lib da
 * Sistoli, sem importá-la. Os casos rodam contra a porta com transcript dublê; na fonte, os mesmos
 * casos rodam também contra a lib da Sistoli, e o veredito tem de ser o mesmo (paridade).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as prova from "../prova.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..", "..", "..", "..", "..");
const LIB = path.join(RAIZ, ".claude", "scripts", "estado", "lib", "pergunta.mjs");
const NA_FONTE = existsSync(LIB);
const lib = NA_FONTE ? await import(pathToFileURL(LIB).href) : null;

const ID = "p-00000000000000b1";
const SESSAO = "sessao-da-abertura";
const ARQUIVO = `/tmp/transcripts/${SESSAO}.jsonl`;
const ABERTA = "2026-11-18T10:00:00.000Z";
const DEPOIS = "2026-11-18T10:05:00.000Z";
const ANTES = "2026-11-18T09:55:00.000Z";

const abertura = (extra = {}) => ({
  evento: "abertura",
  pergunta_id: ID,
  sessao: SESSAO,
  carimbo: ABERTA,
  ciclo: "X-1",
  ponteiro: "autorizar-ciclo:F1",
  itens: [{ numero: 1, opcoes: [{ letra: "a", texto: "sim" }, { letra: "b", texto: "não" }] }],
  ...extra,
});
const resposta = (literal = "a", extra = {}) => ({ evento: "resposta", pergunta_id: ID, sessao: SESSAO, carimbo: DEPOIS, item: "D1", resposta_literal: literal, escolha: literal.length === 1 ? literal : null, origem_resposta: "agente", ...extra });
const autoria = (extra = {}) => ({ evento: "autoria", pergunta_id: ID, sessao: SESSAO, carimbo: DEPOIS, origem_resposta: "digitado", prova: `transcript:${ARQUIVO}#u-1`, ...extra });
const humana = (extra = {}) => ({ uuid: "u-1", sessionId: SESSAO, type: "user", origin: { kind: "human" }, timestamp: DEPOIS, message: { content: "a" }, ...extra });

/** O leitor dublê: o transcript da sessão em memória; `achar` devolve o caminho dele. */
const leitor = (entradas, { arquivo = ARQUIVO } = {}) => ({ achar: (s) => (s === SESSAO ? arquivo : null), lerEntradas: (a) => (a === arquivo ? entradas : null) });

/** Os casos: nome, eventos, entradas do transcript e a origem esperada. */
const CASOS = [
  ["mensagem humana posterior com a letra prova digitado", [abertura(), resposta(), autoria()], [humana()], "digitado"],
  ["autoria sem prova não sobe a origem", [abertura(), resposta(), autoria({ prova: undefined })], [humana()], "agente"],
  ["prova de outro arquivo não resolve", [abertura(), resposta(), autoria({ prova: "transcript:/tmp/forjado.jsonl#u-1" })], [humana()], "agente"],
  ["prova que aponta uuid ausente não resolve", [abertura(), resposta(), autoria({ prova: `transcript:${ARQUIVO}#u-9` })], [humana()], "agente"],
  ["mensagem do agente não é humana", [abertura(), resposta(), autoria()], [humana({ origin: { kind: "agent" } })], "agente"],
  ["mensagem anterior à abertura não prova", [abertura(), resposta(), autoria()], [humana({ timestamp: ANTES })], "agente"],
  ["mensagem de outra sessão não prova", [abertura(), resposta(), autoria()], [humana({ sessionId: "outra" })], "agente"],
  ["texto sem a letra escolhida não prova", [abertura(), resposta(), autoria()], [humana({ message: { content: "b" } })], "agente"],
  ["autoria com origem agente não conta", [abertura(), resposta(), autoria({ origem_resposta: "agente" })], [humana()], "agente"],
  ["sem autoria a origem é agente", [abertura(), resposta()], [humana()], "agente"],
  ["sem resposta a origem é nula", [abertura(), autoria()], [humana()], null],
  [
    "repasse entre sessões com recibo prova repasse-hub",
    [abertura(), resposta(), autoria({ origem_resposta: "repasse-hub", prova: "entre-sessoes:hub-1#u-1", ponteiro: "hub" })],
    [humana({ origin: undefined, message: { content: '<cross-session-message from-session="hub-1">D1a\nRecibo: hub-1 ev-1</cross-session-message>' } })],
    "repasse-hub",
  ],
];

/**
 * A autoria nova (T41, D-VEGA19-54; acompanhada pela T47, D-VEGA19-59): em cada origem, quem
 * respondeu, o mandato, em nome de quem e o recibo. Nome, eventos, entradas e a forma esperada
 * (só os campos da autoria; `em_nome_de` nulo até a T42 trazer a matriz de titulares).
 */
const getEvent = (evento) => [
  { uuid: "a-1", sessionId: SESSAO, type: "assistant", timestamp: DEPOIS, message: { content: [{ type: "tool_use", id: "tu-1", name: "mcp__hub__get_event", input: { session_id: "hub-1", event_uuid: "ev-1" } }] } },
  { uuid: "u-1", sessionId: SESSAO, type: "user", timestamp: DEPOIS, message: { content: [{ type: "tool_result", tool_use_id: "tu-1", content: JSON.stringify(evento) }] } },
];
const CASOS_DA_AUTORIA = [
  [
    "digitado leva quem e mandato da autoria",
    [abertura(), resposta(), autoria({ quem: "pessoa", mandato: "engenharia" })],
    [humana()],
    { origem: "digitado", quem: "pessoa", mandato: "engenharia", em_nome_de: null, recibo: null },
  ],
  [
    "digitado sem mandato na autoria herda o da resposta",
    [abertura(), resposta("a", { mandato: "societario" }), autoria({ quem: "pessoa" })],
    [humana()],
    { origem: "digitado", quem: "pessoa", mandato: "societario", em_nome_de: null, recibo: null },
  ],
  [
    "digitado-no-hub-conferido leva o recibo da autoria",
    [abertura(), resposta(), autoria({ origem_resposta: "digitado-no-hub-conferido", prova: "get_event:hub-1#u-1", recibo: "hub-1 ev-1", quem: "pessoa", mandato: "clinico-regulatorio" })],
    getEvent({ role: "user", created_at: DEPOIS, content: "D1a" }),
    { origem: "digitado-no-hub-conferido", quem: "pessoa", mandato: "clinico-regulatorio", em_nome_de: null, recibo: "hub-1 ev-1" },
  ],
  [
    "3 níveis: a letra sozinha digitada no hub não prova nem na pergunta de um item (o evento do hub não diz a que pergunta responde)",
    [abertura(), resposta(), autoria({ origem_resposta: "digitado-no-hub-conferido", prova: "get_event:hub-1#u-1", recibo: "hub-1 ev-1" })],
    getEvent({ role: "user", created_at: DEPOIS, content: "a" }),
    { origem: "agente", quem: null, mandato: null, em_nome_de: null, recibo: null },
  ],
  [
    "3 níveis: a letra sozinha digitada no hub não prova na pergunta de dois itens",
    [
      abertura({ itens: [{ numero: 1, opcoes: [{ letra: "a", texto: "sim" }, { letra: "b", texto: "não" }] }, { numero: 2, opcoes: [{ letra: "a", texto: "x" }, { letra: "b", texto: "y" }] }] }),
      resposta(),
      autoria({ origem_resposta: "digitado-no-hub-conferido", prova: "get_event:hub-1#u-1", recibo: "hub-1 ev-1" }),
    ],
    getEvent({ role: "user", created_at: DEPOIS, content: "a" }),
    { origem: "agente", quem: null, mandato: null, em_nome_de: null, recibo: null },
  ],
  [
    "repasse-hub sem recibo na autoria herda o da resposta",
    [abertura(), resposta("a", { recibo: "hub-1 ev-1" }), autoria({ origem_resposta: "repasse-hub", prova: "entre-sessoes:hub-1#u-1", quem: "pessoa", mandato: "engenharia" })],
    [humana({ origin: undefined, message: { content: '<cross-session-message from-session="hub-1">D1a\nRecibo: hub-1 ev-1</cross-session-message>' } })],
    { origem: "repasse-hub", quem: "pessoa", mandato: "engenharia", em_nome_de: null, recibo: "hub-1 ev-1" },
  ],
  [
    "sem prova ninguém é quem respondeu; mandato e recibo seguem os da resposta",
    [abertura(), resposta("a", { mandato: "engenharia", recibo: "hub-1 ev-1" }), autoria({ prova: undefined, quem: "pessoa", mandato: "societario" })],
    [humana()],
    { origem: "agente", quem: null, mandato: "engenharia", em_nome_de: null, recibo: "hub-1 ev-1" },
  ],
  [
    "sem resposta a autoria sai toda nula",
    [abertura(), autoria({ quem: "pessoa", mandato: "engenharia" })],
    [humana()],
    { origem: null, quem: null, mandato: null, em_nome_de: null, recibo: null },
  ],
];
const daAutoria = ({ origem, quem, mandato, em_nome_de, recibo }) => ({ origem, quem, mandato, em_nome_de, recibo });

describe("a porta do plugin", () => {
  for (const [nome, eventos, entradas, origem] of CASOS) {
    test(nome, () => {
      assert.equal(prova.origemEfetiva(ID, { eventos, ...leitor(entradas) }).origem, origem);
    });
  }

  for (const [nome, eventos, entradas, esperado] of CASOS_DA_AUTORIA) {
    test(`autoria: ${nome}`, () => {
      const r = prova.origemEfetiva(ID, { eventos, ...leitor(entradas) });
      assert.deepEqual(Object.keys(r).sort(), ["autorias", "em_nome_de", "mandato", "motivo", "origem", "prova", "quem", "recibo"]);
      assert.deepEqual(daAutoria(r), esperado);
    });
  }

  test("a pergunta do autorizar devolve a abertura, as escolhas e a origem", () => {
    const r = prova.perguntaDoAutorizar(ID, { eventos: [abertura(), resposta(), autoria()], ...leitor([humana()]) });
    assert.equal(r.origem, "digitado");
    assert.deepEqual(r.escolhas, [{ numero: 1, letra: "a" }]);
    assert.equal(r.abertura.ponteiro, "autorizar-ciclo:F1");
    assert.equal(r.abertura.ciclo, "X-1");
    assert.equal(prova.perguntaDoAutorizar(ID, { eventos: [resposta()], ...leitor([]) }).abertura, null);
  });

  test("o transcript real se acha pela pasta de configuração", (t) => {
    const config = mkdtempSync(path.join(tmpdir(), "prova-config-"));
    t.after(() => rmSync(config, { recursive: true, force: true }));
    const alvo = path.join(config, "projects", "qualquer", `${SESSAO}.jsonl`);
    mkdirSync(path.dirname(alvo), { recursive: true });
    writeFileSync(alvo, `${JSON.stringify(humana())}\nlinha torta\n`);
    assert.equal(prova.acharTranscript(SESSAO, { env: { CLAUDE_CONFIG_DIR: config }, home: config }), alvo);
    assert.equal(prova.acharTranscript("../fora", { env: { CLAUDE_CONFIG_DIR: config }, home: config }), null);
    assert.equal(prova.lerTranscript(alvo).length, 1, "linha torta pula");
    const eventos = [abertura(), resposta(), autoria({ prova: `transcript:${alvo}#u-1` })];
    assert.equal(prova.origemEfetiva(ID, { eventos, achar: (s) => prova.acharTranscript(s, { env: { CLAUDE_CONFIG_DIR: config }, home: config }) }).origem, "digitado");
  });
});

describe("paridade com a lib da Sistoli", { skip: !NA_FONTE && "fora da fonte: sem a lib da Sistoli" }, () => {
  for (const [nome, eventos, entradas] of [...CASOS, ...CASOS_DA_AUTORIA]) {
    test(`mesmo veredito: ${nome}`, () => {
      const l = leitor(entradas);
      assert.deepEqual(prova.origemEfetiva(ID, { eventos, ...l }), lib.origemEfetiva(ID, { eventos, ...l }));
      assert.deepEqual(prova.perguntaDoAutorizar(ID, { eventos, ...l }), lib.perguntaDoAutorizar(ID, { eventos, ...l }));
    });
  }

  test("a força das origens é a mesma", () => {
    assert.deepEqual([...prova.FORCA_DAS_ORIGENS], [...lib.FORCA_DAS_ORIGENS]);
  });
});
