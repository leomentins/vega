// D18a do operador (16/11/2026): o sim do ciclo cobre toda task sensível; pede o sim de novo só a
// que toca caminho clínico ou publica apagando ou alterando algo existente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { simProprio } from "../ler-plano.mjs";

const pub = ["db push"];

test("caminho clínico pede o sim de novo, publique ou não", () => {
  assert.equal(simProprio({ clinica: ["apps/x/labs/a.tsx"], publicacao: [], declarada: undefined, texto: "" }), "caminho-clinico");
});

test("sem publicação nem caminho clínico, o sim do ciclo cobre", () => {
  assert.equal(simProprio({ clinica: [], publicacao: [], declarada: "sim, altera tudo", texto: "DROP TABLE x" }), null);
});

test("a T10 do VEGA-19: declarada aditiva, não pergunta; calada, o DROP IF EXISTS do CHECK pergunta uma vez", () => {
  const texto = [
    "O banco do harness guarda a pergunta antes da resposta",
    "migration aditiva (timestamp acima de §2.2#9, re-derivado ao criar). Colunas: `evento text NOT NULL DEFAULT 'resposta'`, `pergunta_id text`",
    "e `decisoes_origem_check` recriado (DROP IF EXISTS + ADD) com `pergunta` além dos quatro de hoje",
  ].join("\n");
  assert.equal(simProprio({ clinica: [], publicacao: pub, declarada: "sim, aditiva (`estado.mjs db push`, banco do harness)", texto }), null);
  assert.equal(simProprio({ clinica: [], publicacao: pub, declarada: "sim (`estado.mjs db push`, banco do harness — pela condutora, D-VEGA19-30)", texto }), "publicacao-que-altera");
});

test("a anotação Publicação decide quando diz", () => {
  assert.equal(simProprio({ clinica: [], publicacao: pub, declarada: "sim, aditiva", texto: "DROP COLUMN velha" }), null, "aditiva declarada vence o texto");
  assert.equal(simProprio({ clinica: [], publicacao: pub, declarada: "sim, altera a coluna status", texto: "" }), "publicacao-que-altera");
  assert.equal(simProprio({ clinica: [], publicacao: pub, declarada: "sim, destrutiva", texto: "" }), "publicacao-que-altera");
});

test("publicação com a anotação calada ou genérica pergunta: só a aditiva declarada dispensa", () => {
  for (const declarada of [undefined, "sim", "sim (`db push`)"])
    assert.equal(simProprio({ clinica: [], publicacao: pub, declarada, texto: "CREATE TABLE t (a int)" }), "publicacao-que-altera", String(declarada));
  assert.equal(simProprio({ clinica: [], publicacao: pub, declarada: "aditiva; remove a coluna antiga", texto: "" }), "publicacao-que-altera", "alteração declarada vence");
});

test("Publicação: não com o verbo citado no texto não pergunta; não aditiva pergunta", () => {
  assert.equal(simProprio({ clinica: [], publicacao: pub, declarada: "não", texto: "não rodar db push aqui" }), null);
  assert.equal(simProprio({ clinica: [], publicacao: pub, declarada: "sim, não aditiva", texto: "" }), "publicacao-que-altera");
});

test("caminho protegido não clínico sem publicar: o texto decide, pelo lado conservador", () => {
  const protegida = ["db/migrations/x.sql"];
  for (const texto of ["ALTER TABLE x DROP COLUMN y", "RENAME COLUMN a TO b", "TRUNCATE t", "DELETE FROM t WHERE", "UPDATE t SET a = 1", "ALTER COLUMN a TYPE int", "ALTER POLICY p ON t", "REVOKE ALL", "migration destrutiva"])
    assert.equal(simProprio({ clinica: [], publicacao: [], protegida, declarada: "não", texto }), "publicacao-que-altera", texto);
  for (const texto of ["CREATE TABLE t (a int)", "ALTER TABLE t ADD COLUMN IF NOT EXISTS a int"])
    assert.equal(simProprio({ clinica: [], publicacao: [], protegida, declarada: "não", texto }), null, texto);
});
