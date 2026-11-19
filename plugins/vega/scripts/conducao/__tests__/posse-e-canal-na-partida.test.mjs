// Dois achados do VEGA-19, levados ao motor no hotfix da janela e da sensibilidade:
// o ciclo sem posse parava só na primeira passagem, e a herdeira de herdeira perdia o canal
// do operador e a contagem das decisões.
import { test } from "node:test";
import assert from "node:assert/strict";
import { posseDoCiclo } from "../pre-voo.mjs";
import { textoDaHerdeira } from "../conducao.mjs";

const ler = (posse) => () => posse;

test("partida: posse do ciclo desta árvore passa; sem posse falha com o remédio de tomá-la", () => {
  assert.equal(posseDoCiclo("/r", "X-1", ler({ estado: "dona", epoca: 1 })).estado, "ok");
  assert.equal(posseDoCiclo("/r", "X-1", ler(null)).estado, "ok", "projeto sem leitor passa com o pulo");
  const sem = posseDoCiclo("/r", "X-1", ler({ estado: "sem-posse" }));
  assert.equal(sem.estado, "falha");
  assert.match(sem.remedio, /tomar-posse/);
  assert.equal(posseDoCiclo("/r", "X-1", ler({ estado: "outra" })).estado, "falha");
  assert.equal(posseDoCiclo("/r", "X-1", ler({ estado: "dona" })).estado, "falha", "dona sem época cairia na cerca depois");
  const quebrado = posseDoCiclo("/r", "X-1", () => {
    throw new Error("banco fora");
  });
  assert.equal(quebrado.estado, "falha", "leitura que falha não passa calada");
});

test("herdeira: o texto manda usar o canal do operador e seguir a contagem da nota", () => {
  const texto = textoDaHerdeira({ ciclo: "X-1", fase: "F2", sessao: "s", nota: "n.md", trazer: { ramo: "r", passagem: "a".repeat(40), tentativa: 1, nonce: "0".repeat(16) } });
  assert.match(texto, /Canal do operador/);
  assert.match(texto, /Próxima decisão/);
});
