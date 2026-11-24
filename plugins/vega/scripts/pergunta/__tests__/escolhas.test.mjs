// .claude/skills/vega/scripts/pergunta/__tests__/escolhas.test.mjs
// Escolha × citação (hotfix vega-escolha-nao-e-citacao, 24/11/2026): a regra única de `escolhas.mjs`
// que o `responder`, o leitor de prova, a lib da Sistoli e o pareador usam. O caso de origem é a
// resposta do Leo à p-c78a7f8480020a2c, que a leitura solta gravava como D1a D2a.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { escolhasCitadas, escolhasDoTexto, LIVRE_NUMERADO, lerTokens } from "../escolhas.mjs";
import { interpretarResposta } from "../comando.mjs";
import * as prova from "../prova.mjs";

// A lib da Sistoli so existe na fonte; na vitrine do corpo a paridade com ela pula (como em prova.test.mjs).
const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../scripts/estado/lib/pergunta.mjs");
const NA_FONTE = existsSync(LIB);
const lib = NA_FONTE ? await import(pathToFileURL(LIB).href) : null;

const letras = (r) => r.escolhas.map((e) => `${e.numero}${e.letra}`).join(" ");
const dois = (a, b) => [
  { numero: a, opcoes: [{ letra: "a" }, { letra: "b" }] },
  { numero: b, opcoes: [{ letra: "a" }, { letra: "b" }, { letra: "c" }] },
];

describe("escolhasDoTexto — a letra só é escolha quando é o token da resposta", () => {
  test("o literal da p-c78a7f8480020a2c, como chegou ao hub e como foi repassado", () => {
    const hub = escolhasDoTexto("3a\n4-precisa de uma solução mais inteligente que 4a");
    assert.equal(letras(hub), "3a");
    assert.deepEqual(hub.livres, [4]);
    const repassado = escolhasDoTexto("1a 2-precisa de uma solução mais inteligente que 2a");
    assert.equal(letras(repassado), "1a");
    assert.deepEqual(repassado.livres, [2]);
  });

  test("letra citada dentro de texto livre não vale", () => {
    assert.equal(letras(escolhasDoTexto("D4a, mas não quero a 2b")), "4a");
    assert.equal(letras(escolhasDoTexto("mais inteligente que 4a")), "");
    assert.equal(letras(escolhasDoTexto("não quero 2b")), "");
    assert.equal(letras(escolhasDoTexto("continuar, desconsidera 56a")), "");
    assert.equal(letras(escolhasDoTexto('16a 17b — verbatim do operador no canal: "27a 28b"')), "16a 17b");
  });

  test("as formas que já funcionavam seguem", () => {
    assert.equal(letras(escolhasDoTexto("D1a D2b")), "1a 2b");
    assert.equal(letras(escolhasDoTexto("1b")), "1b");
    assert.equal(letras(escolhasDoTexto("D6a, 7b")), "6a 7b");
    assert.equal(letras(escolhasDoTexto("1a, 2b e 3c")), "1a 2b 3c");
    assert.equal(letras(escolhasDoTexto("Decisão 6: a · ruling")), "6a");
    assert.equal(letras(escolhasDoTexto("recomendadas")), "");
    assert.deepEqual(escolhasDoTexto("recomendadas").livres, []);
    const livre = escolhasDoTexto("2-texto livre do item");
    assert.equal(letras(livre), "");
    assert.deepEqual(livre.livres, [2]);
  });

  test("o número com a letra separada: `4 - a`, `16-a, mas …`, uma linha por item", () => {
    assert.equal(letras(escolhasDoTexto("4 - a")), "4a");
    assert.equal(letras(escolhasDoTexto("4: (a)")), "4a");
    assert.equal(letras(escolhasDoTexto("15-a\n16-a, mas tecnicamente já foi superado\n17-a\n18a")), "15a 16a 17a 18a");
    assert.equal(letras(escolhasDoTexto("- 1a\n- 2b")), "1a 2b");
    // A letra separada que não fecha a linha nem vem antes de pontuação é texto.
    assert.equal(letras(escolhasDoTexto("16 a 23- seguir recomendação")), "");
    assert.equal(letras(escolhasDoTexto("10-o que você tá chamando de clínica central?")), "");
    assert.equal(letras(escolhasDoTexto("1. A solução")), "");
  });

  test("a revisão: quebra de linha antes da citação, `1-a 2-b`, `1a. 2b`, negações", () => {
    assert.equal(letras(escolhasDoTexto("1a 2-precisa de uma solução mais inteligente\nque 2a")), "1a");
    assert.equal(letras(escolhasDoTexto("1-a 2-b")), "1a 2b");
    assert.equal(letras(escolhasDoTexto("16 - a - porque sim")), "16a");
    assert.equal(letras(escolhasDoTexto("1a. 2b")), "1a 2b");
    assert.equal(letras(escolhasDoTexto("D1a: D2b")), "1a 2b");
    for (const t of ["fora 2b", "nada 2b", "tirando 2b", "evito 2b"]) assert.equal(letras(escolhasDoTexto(t)), "", t);
    // `4 dias depois` é numeração, não o texto livre explícito do item 4.
    assert.deepEqual(escolhasDoTexto("3a\n4 dias depois eu vejo").livresExplicitos, []);
    assert.deepEqual(escolhasDoTexto("3a\n4-dias depois eu vejo").livresExplicitos, [4]);
    assert.equal(LIVRE_NUMERADO.exec("D3 depois a gente vê"), null);
  });

  test("uma palavra de abertura antes dos tokens (medida no registro), nunca negação", () => {
    assert.equal(letras(escolhasDoTexto("L4 D3a")), "3a");
    assert.equal(letras(escolhasDoTexto("combo 10c 11b 12b 13a - se a maestra ficar com tudo, fica pesado?\n 14a")), "10c 11b 12b 13a 14a");
    assert.equal(letras(escolhasDoTexto("ok, D1a")), "1a");
    assert.equal(letras(escolhasDoTexto("gosto mais de 1c, porque fica completo")), "");
  });

  test("a leitura solta (mensagem entre sessões) segue achando a citação", () => {
    assert.equal(letras(escolhasCitadas("T3-OK feito conforme D6a")), "6a");
    assert.equal(letras(escolhasCitadas("1a 2-precisa de uma solução mais inteligente que 2a")), "1a 2a");
  });

  test("as posições dos tokens apontam o texto", () => {
    const s = "x\n1a 2b — ok";
    const { tokens } = lerTokens(s);
    assert.deepEqual(tokens.map((t) => s.slice(t.ini, t.fim)), ["1a", "2b"]);
  });
});

describe("uma regra só: a lib da Sistoli, o leitor de prova e o pareador leem pela mesma", { skip: !NA_FONTE && "fora da fonte: sem a lib da Sistoli" }, () => {
  test("mesmas funções e a mesma forma do N-texto", () => {
    assert.equal(lib.escolhasDoTexto, escolhasDoTexto);
    assert.equal(prova.escolhasDoTexto, escolhasDoTexto);
    assert.equal(lib.escolhasCitadas, escolhasCitadas);
    assert.equal(lib.LIVRE_NUMERADO, LIVRE_NUMERADO);
    assert.equal(LIVRE_NUMERADO.exec("2-dispara um subagent")?.[1], "2");
    assert.equal(LIVRE_NUMERADO.exec("2 a"), null);
  });

  test("a resposta gravada da p-c78a7f8480020a2c se relê D1a com o item 2 livre (correção sem tocar na linha)", () => {
    const gravada = { item: "D1-D2", resposta_literal: "1a 2-precisa de uma solução mais inteligente que 2a", escolha: null, alternativa_livre: false };
    assert.deepEqual(lib.escolhasDaResposta(gravada), [{ numero: 1, letra: "a" }]);
    assert.deepEqual(prova.escolhasDaResposta(gravada), [{ numero: 1, letra: "a" }]);
  });

  test("a prova reconhece as formas que só a leitura ancorada lê (`4 - a`, `D1: a`)", () => {
    const esc = [{ numero: 1, letra: "a" }, { numero: 2, letra: "b" }];
    for (const t of ["1 - a\n2 - b", "D1: a\nD2: b", "1a\n2-b, mas sem pressa"]) {
      assert.deepEqual(escolhasDoTexto(t).escolhas, esc, t);
      assert.equal(lib.textoCasaEscolhas(t, esc), true, t);
      assert.equal(prova.textoCasaEscolhas(t, esc), true, t);
    }
  });

  test("a prova confere a presença solta: a origem de resposta antiga não rebaixa", () => {
    assert.equal(lib.textoCasaEscolhas("vai de 3a e 4b", [{ numero: 3, letra: "a" }, { numero: 4, letra: "b" }]), true);
    assert.equal(prova.textoCasaEscolhas("vai de 3a e 4b", [{ numero: 3, letra: "a" }, { numero: 4, letra: "b" }]), true);
  });
});

describe("interpretarResposta — o `responder` separa escolha de citação", () => {
  test("3a ⏎ 4-…que 4a: D3a, o item 4 em texto livre, o literal no comentário", () => {
    const r = interpretarResposta("3a\n4-precisa de uma solução mais inteligente que 4a", dois(3, 4));
    assert.deepEqual(r.escolhas, [{ numero: 3, letra: "a" }]);
    assert.deepEqual(r.livres, [4]);
    assert.equal(r.tipo, "opcao-com-comentario");
    assert.equal(r.comentario, "4-precisa de uma solução mais inteligente que 4a");
  });

  test("o literal repassado (1a 2-…que 2a) não grava D2a", () => {
    const r = interpretarResposta("1a 2-precisa de uma solução mais inteligente que 2a", dois(1, 2));
    assert.deepEqual(r.ecoada, ["D1a"]);
    assert.deepEqual(r.livres, [2]);
    assert.match(r.comentario, /que 2a$/);
  });

  test("as respostas que já funcionavam", () => {
    assert.deepEqual(interpretarResposta("D1a D2b", dois(1, 2)).ecoada, ["D1a", "D2b"]);
    assert.deepEqual(interpretarResposta("1b", dois(1, 2)).ecoada, ["D1b"]);
    const rec = interpretarResposta("recomendadas", dois(1, 2));
    assert.equal(rec.tipo, "alternativa-livre");
    const livre = interpretarResposta("2-texto livre", dois(1, 2));
    assert.equal(livre.tipo, "alternativa-livre");
    assert.deepEqual(livre.livres, [2]);
    const unico = interpretarResposta("b, mas sem pressa", [{ numero: 6, opcoes: [{ letra: "a" }, { letra: "b" }] }]);
    assert.deepEqual(unico.ecoada, ["D6b"]);
    assert.equal(unico.comentario, "mas sem pressa");
  });

  test("só letra citada volta ao operador (a-confirmar), nunca alternativa livre calada", () => {
    const r = interpretarResposta("vamos de 1a e 2b", dois(1, 2));
    assert.equal(r.tipo, "a-confirmar");
    assert.equal(r.leitura, "D1a citado no texto; D2b citado no texto");
    assert.equal(interpretarResposta("fico com 2a", dois(1, 2)).tipo, "a-confirmar");
    // Texto livre sem letra de opção segue alternativa livre.
    assert.equal(interpretarResposta("precisa de algo mais inteligente", dois(1, 2)).tipo, "alternativa-livre");
    assert.equal(interpretarResposta("o de 200k não cabe", dois(1, 2)).tipo, "alternativa-livre");
  });

  test("`Decisão N: a` vale no `responder` e no texto, com os tokens da mesma linha", () => {
    assert.deepEqual(interpretarResposta("Decisão 1: a", dois(1, 2)).ecoada, ["D1a"]);
    assert.equal(letras(escolhasDoTexto("Decisão 6: a, 7b")), "6a 7b");
    assert.equal(interpretarResposta("Decisão 1: sim", dois(1, 2)).tipo, "alternativa-livre");
  });

  test("número fora do bloco e duas letras no item seguem como antes", () => {
    assert.equal(interpretarResposta("7a", dois(1, 2)).tipo, "a-confirmar");
    assert.throws(() => interpretarResposta("1a 1b", dois(1, 2)), /duas letras/);
    // Citação fora do bloco num texto livre não é número de decisão.
    assert.equal(interpretarResposta("1a, mas o 5h de espera pesa", dois(1, 2)).tipo, "opcao-com-comentario");
  });
});
