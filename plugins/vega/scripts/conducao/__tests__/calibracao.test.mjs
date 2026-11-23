/**
 * calibracao.test.mjs — a calibração da aposentadoria por motivo (VEGA-20 T6, AC-VEGA20-1/3).
 *
 * Histórico de fixture: eventos `pergunta` do log com a resposta registrada de cada decisão, na
 * forma que o adaptador entrega (`respostasDasParadasDoProjeto`).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validarCodigo } from "../adaptador.mjs";
import {
  aposentado,
  calibrar,
  consulta,
  historicoComErro,
  historicoDe as historicoPuro,
  lerLinhasDoLog,
  numeroDe,
  principal,
  SEQUENCIAS_PARA_APOSENTAR,
} from "../calibracao.mjs";
/** O que define a parada no adaptador de fixture: o histórico o carrega, como `carregarHistorico`. */
const DEFINEM_DA_FIXTURE = Object.freeze(["**/hooks/gate-de-publicacao.js", "**/liberacao-da-publicacao.mjs", "db/scripts/**"]);
const historicoDe = (h) => historicoPuro({ definemAParada: DEFINEM_DA_FIXTURE, ...h });

const CANONICO = ".agents/ciclo/vega/VEGA-20-dieta-da-fabrica/canonico.md";
const LIMPA = Object.freeze({ publicacao: [], protegida: [], simProprio: null, caminhos: [".claude/skills/vega/scripts/conducao/regras.mjs"], tipo: "trazer", estacao: "servidor" });

let relogio = Date.parse("2026-11-01T12:00:00Z");
let contador = 0;
const agora = () => new Date((relogio += 60_000)).toISOString();
const decisao = () => `d-${(++contador).toString(16).padStart(16, "0")}`;
const evento = (acao, atributos) => ({ v: 1, linha: "evento", procedencia: "intencao", acao, objetos: [], atributos, quando: agora() });

/** Uma série de paradas do `motivo`, cada uma respondida com o token da lista. */
function serie(motivo, respostas, alvo = { linhas: [], respostas: [] }) {
  for (const r of respostas) {
    const d = decisao();
    const e = evento("pergunta", { motivo, decisao: d });
    alvo.linhas.push(e);
    alvo.respostas.push({ decisao: d, resposta: r, quando: e.quando });
  }
  return alvo;
}
const vezes = (k, r = "a") => Array.from({ length: k }, () => r);
const doMotivo = (c, m) => c.find((x) => x.motivo === m);

test("a regra: o menor n com toda sequência seguida da mesma resposta e ao menos 3 sequências", () => {
  assert.deepEqual(numeroDe(vezes(4)), { n: 1, sequencias: 3, respostas: ["a"] });
  assert.equal(numeroDe(vezes(3)), null, "2 sequências não bastam");
  assert.equal(numeroDe(["a", "a", "b", "a", "a", "a"]), null, "a→b quebra n=1 e n=2");
  // n=1 quebra (a→b); n=2: (a,a)→a sempre, três vezes.
  assert.equal(numeroDe(["b", "a", "b", "a", "a", "a", "a", "a"])?.n, 2);
});

test("o motivo calibra só com o dobro: 3 sequências saem observacao, 6 saem aposentado", () => {
  const tres = historicoDe(serie("conferencia-do-operador", vezes(4)));
  assert.equal(doMotivo(calibrar(tres), "conferencia-do-operador").degrau, "observacao");
  assert.equal(aposentado("conferencia-do-operador", tres, LIMPA), "para");

  const seis = historicoDe(serie("conferencia-do-operador", vezes(SEQUENCIAS_PARA_APOSENTAR + 1)));
  const c = doMotivo(calibrar(seis), "conferencia-do-operador");
  assert.equal(c.degrau, "aposentado");
  assert.equal(c.resposta, "a");
  assert.equal(c.n, 1);
  assert.equal(c.sequencias, 6);
  assert.ok(c.desde, "a tabela diz quando entrou no degrau");
  assert.equal(aposentado("conferencia-do-operador", seis, LIMPA), "aposentado");
  assert.equal(consulta("conferencia-do-operador", seis, LIMPA).resposta, "a");
});

test("a resposta constante pode ser recusar", () => {
  const h = historicoDe(serie("fora-dos-outputs", vezes(7, "b")));
  assert.deepEqual([aposentado("fora-dos-outputs", h, LIMPA), consulta("fora-dos-outputs", h, LIMPA).resposta], ["aposentado", "b"]);
});

test("o histórico curto sai sem-calibracao e para", () => {
  const h = historicoDe(serie("curto", vezes(2)));
  assert.equal(doMotivo(calibrar(h), "curto").degrau, "sem-calibracao");
  assert.equal(aposentado("curto", h, LIMPA), "para");
  assert.equal(aposentado("nunca-visto", h, LIMPA), "para");
});

test("o motivo de publicação nunca se aposenta, com histórico que calibraria", () => {
  const h = historicoDe(serie("publicacao-do-ciclo", vezes(10)));
  assert.equal(doMotivo(calibrar(h), "publicacao-do-ciclo").degrau, "aposentado");
  assert.equal(aposentado("publicacao-do-ciclo", h, LIMPA), "nunca");
  const outro = historicoDe(serie("conferencia-do-operador", vezes(10)));
  assert.equal(aposentado("conferencia-do-operador", outro, { ...LIMPA, publicacao: ["db push"] }), "nunca");
  assert.equal(aposentado("conferencia-do-operador", outro, { ...LIMPA, tipo: "publicacao" }), "nunca");
  assert.equal(aposentado("conferencia-do-operador", outro, { ...LIMPA, simProprio: "publicacao-que-altera" }), "nunca");
});

test("o desfeito: volta no fim devolve à observação e zera o histórico", () => {
  const h = serie("conferencia-do-operador", vezes(10));
  h.linhas.push(evento("volta", { motivo: "conferencia-do-operador" }));
  const hist = historicoDe(h);
  const c = doMotivo(calibrar(hist), "conferencia-do-operador");
  assert.equal(c.degrau, "observacao");
  assert.equal(c.sequencias, 0);
  assert.equal(aposentado("conferencia-do-operador", hist, LIMPA), "para");
  // Conta só o que veio depois: 4 respostas depois do volta = 3 sequências, ainda observação.
  serie("conferencia-do-operador", vezes(4), h);
  assert.equal(doMotivo(calibrar(historicoDe(h)), "conferencia-do-operador").sequencias, 3);
});

test("conferencia-do-operador calibrado sobre instância clínica, settings, sem caminhos ou na condutora sai nunca", () => {
  const h = historicoDe(serie("conferencia-do-operador", vezes(10)));
  assert.equal(aposentado("conferencia-do-operador", h, LIMPA), "aposentado");
  assert.equal(aposentado("conferencia-do-operador", h, { ...LIMPA, protegida: ["apps/sistoli-os/src/app/(app)/labs/a.tsx"] }), "nunca");
  assert.equal(aposentado("conferencia-do-operador", h, { ...LIMPA, caminhos: [".claude/settings.json"] }), "nunca");
  const { caminhos: _, ...semCaminhos } = LIMPA;
  assert.equal(aposentado("conferencia-do-operador", h, semCaminhos), "nunca");
  assert.equal(aposentado("conferencia-do-operador", h, { ...LIMPA, estacao: "condutora" }), "nunca");
  assert.equal(aposentado("conferencia-do-operador", h, { ...LIMPA, simProprio: "caminho-clinico" }), "nunca");
  assert.equal(aposentado("conferencia-do-operador", h, { ...LIMPA, caminhos: ["CLAUDE.md"], instrucoes: ["CLAUDE.md"] }), "nunca");
  assert.equal(aposentado("conferencia-do-operador", h, null), "nunca");
});

test("os motivos de integridade e os que nunca repetem saem nunca; canonico-do-ciclo é a exceção", () => {
  const h = serie("faixa-com-merge", vezes(10));
  serie("canonico-do-ciclo", vezes(SEQUENCIAS_PARA_APOSENTAR + 1), h);
  serie("caminho-clinico-fora-dos-outputs", vezes(SEQUENCIAS_PARA_APOSENTAR + 1), h);
  const hist = historicoDe(h);
  assert.equal(aposentado("faixa-com-merge", hist, LIMPA), "nunca");
  const doCanonico = { ...LIMPA, caminhos: [CANONICO] };
  assert.equal(aposentado("canonico-do-ciclo", hist, doCanonico), "aposentado");
  assert.equal(aposentado("canonico-do-ciclo", hist, { ...doCanonico, estacao: "condutora" }), "nunca");
  assert.equal(aposentado("caminho-clinico-fora-dos-outputs", hist, doCanonico), "nunca");
});

test("a resposta aplicada pela aposentadoria nunca entra no histórico", () => {
  const h = serie("conferencia-do-operador", vezes(4));
  // Três paradas seguidas sozinhas: a decisão aparece no evento `aposentada`, ou a pergunta é de origem aposentadoria.
  for (let i = 0; i < 3; i++) {
    const d = decisao();
    const p = evento("pergunta", { motivo: "conferencia-do-operador", decisao: d, ...(i === 2 ? { origem: "aposentadoria" } : {}) });
    h.linhas.push(p);
    if (i < 2) h.linhas.push(evento("aposentada", { motivo: "conferencia-do-operador", decisao: d }));
    h.respostas.push({ decisao: d, resposta: "a", quando: p.quando });
  }
  const c = doMotivo(calibrar(historicoDe(h)), "conferencia-do-operador");
  assert.equal(c.sequencias, 3, "só as 4 respostas de pessoa contam");
  assert.equal(c.degrau, "observacao");
});

test("log corrompido ou adaptador com erro saem sem-calibracao, nunca histórico parcial", () => {
  const pasta = mkdtempSync(path.join(tmpdir(), "calibracao-"));
  try {
    const { linhas } = serie("conferencia-do-operador", vezes(10));
    writeFileSync(path.join(pasta, "ciclo-a.jsonl"), `${linhas.map((l) => JSON.stringify(l)).join("\n")}\n{"v":1,"linha":"ev`);
    const lido = lerLinhasDoLog([pasta]);
    assert.equal(lido.erro, "log-ilegivel");
    const h = historicoComErro(lido.erro);
    assert.equal(calibrar(h).erro, "log-ilegivel");
    assert.equal(aposentado("conferencia-do-operador", h, LIMPA), "para");
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
  assert.equal(historicoDe({ linhas: [], respostas: null }).erro, "sem-respostas");
  assert.equal(aposentado("conferencia-do-operador", historicoDe({ linhas: [], respostas: null }), LIMPA), "para");
});

test("consultar sem --instancia ou com JSON ilegível sai nunca, sem ler o histórico", () => {
  const saidas = [];
  const carregar = () => assert.fail("não devia carregar o histórico");
  const rodar = (argv) => principal(argv, { escrever: (s) => saidas.push(JSON.parse(s)), carregar });
  assert.equal(rodar(["consultar", "--motivo", "conferencia-do-operador"]), 0);
  const pasta = mkdtempSync(path.join(tmpdir(), "calibracao-"));
  try {
    const ruim = path.join(pasta, "i.json");
    writeFileSync(ruim, "{ não é json");
    rodar(["consultar", "--motivo", "conferencia-do-operador", "--instancia", ruim]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
  assert.deepEqual(saidas.map((s) => s.veredito), ["nunca", "nunca"]);
});

test("consultar e tabela pela linha de comando", () => {
  const h = historicoDe(serie("conferencia-do-operador", vezes(7)));
  const pasta = mkdtempSync(path.join(tmpdir(), "calibracao-"));
  try {
    const arq = path.join(pasta, "i.json");
    writeFileSync(arq, JSON.stringify(LIMPA));
    const saidas = [];
    principal(["consultar", "--motivo", "conferencia-do-operador", "--instancia", arq], { escrever: (s) => saidas.push(s), carregar: () => h });
    assert.equal(JSON.parse(saidas[0]).veredito, "aposentado");
    principal(["tabela"], { escrever: (s) => saidas.push(s), carregar: () => h });
    assert.match(saidas[1], /conferencia-do-operador\taposentado\ta\t1\t6\t/);
    assert.match(saidas[1], /piso: 3/);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test("o adaptador aceita respostasDasParadas como função opcional e recusa outro tipo", () => {
  const base = { plano: { raiz: "x", casa: () => true, ler: () => ({}), brief: () => [] }, publicacao: [], caminhosProtegidos: [], telasProtegidasDosSteps: [], foraDasTelasDosSteps: [], carimbo: null, ci: null };
  assert.equal(validarCodigo(base).respostasDasParadas, null);
  assert.equal(typeof validarCodigo({ ...base, respostasDasParadas: () => [] }).respostasDasParadas, "function");
  assert.throws(() => validarCodigo({ ...base, respostasDasParadas: [] }), /respostasDasParadas: esperada função/);
});
