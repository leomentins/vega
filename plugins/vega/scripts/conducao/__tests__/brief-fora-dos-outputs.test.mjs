/**
 * brief-fora-dos-outputs.test.mjs — o contrato da operária manda carimbar a
 * tentativa cujo diff sai dos Outputs da task (VEGA-19 T50, AC-VEGA19-12).
 *
 * O brief é o que o `abrir` monta para uma task qualquer: o contrato de
 * `brief-operaria.md` com os campos trocados, pelos dois compositores que a
 * suíte conhece — o `task-brief.mjs` do projeto e o `brief-canonico.mjs` do
 * projeto de teste. No passo 3 dele devem estar o caso fora dos Outputs (com a
 * exceção do teste que acompanha o código, os revisores sobre a faixa da
 * tentativa e a pergunta do trazer sem carimbo) e, ainda, o caso do gatilho
 * crítico e o da publicação.
 *
 * Contraprova: com o `brief-operaria.md` de antes da T50, o passo 3 não traz a
 * frase do caso fora dos Outputs e o teste cai.
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MODELO = path.resolve(AQUI, "..", "..", "..", "skills", "conducao", "references", "brief-operaria.md");
const FIXTURE = path.resolve(AQUI, "fixtures", "projeto-de-teste", ".altair", "brief-canonico.mjs");
const DO_PROJETO = path.resolve(AQUI, "..", "..", "..", "..", "..", "scripts", "planning-pipeline", "task-brief.mjs");

const CAMPOS = {
  task: "T7",
  nonce: "0123456789abcdef",
  ref: "refs/conducao/TESTE-50-fora/T7/1",
  commit: "TESTE-50-fora-F1/T7 — uma task qualquer",
  ciclo: "TESTE-50-fora",
  publicacao: [],
};

/** O passo 3 do contrato montado: da linha `3. ` até a linha `4. `. */
function passo3(texto) {
  const m = /^3\. [\s\S]*?(?=^4\. )/m.exec(texto);
  assert.ok(m, "o contrato montado não tem o passo 3");
  return m[0];
}

async function compositores() {
  const lista = [["projeto de teste", (await import(pathToFileURL(FIXTURE).href)).contratoDaOperaria]];
  if (existsSync(DO_PROJETO)) lista.push(["task-brief do projeto", (await import(pathToFileURL(DO_PROJETO).href)).contratoDaOperaria]);
  return lista;
}

test("fora dos outputs pede carimbo", async () => {
  const modelo = readFileSync(MODELO, "utf8");
  const lista = await compositores();
  assert.ok(lista.length >= 1, "nenhum compositor de brief");
  for (const [nome, compor] of lista) {
    const r = compor(modelo, CAMPOS);
    assert.equal(r.ok, true, `${nome}: ${r.erro}`);
    const p3 = passo3(r.texto);
    // O caso novo: tentativa que sai dos Outputs, salvo o teste que acompanha o código.
    assert.match(p3, /tentativa cujo diff toca arquivo fora dos Outputs da task que não seja o teste que acompanha o código/, `${nome}: falta o caso fora dos Outputs`);
    assert.match(p3, /rodar os revisores pela `\/matriz-canonica` sobre a faixa da tentativa/, `${nome}: falta a revisão sobre a faixa da tentativa`);
    assert.match(p3, /gravar o carimbo de revisão do último commit não-prosa no destino que a página do projeto nomeia/, `${nome}: falta o destino do carimbo`);
    assert.match(p3, /sem esse carimbo, o trazer da tentativa que saiu dos Outputs pergunta ao operador/, `${nome}: falta a pergunta do trazer sem carimbo`);
    // Os casos de antes seguem.
    assert.match(p3, /task bate um gatilho crítico que a página do projeto nomeia/, `${nome}: sumiu o caso do gatilho crítico`);
    assert.match(p3, /leva verbo de publicação/, `${nome}: sumiu o caso da publicação`);
    // Fora dos três casos, a revisão segue sendo da fase.
    assert.match(p3, /Fora deles, a revisão é da task de fechamento de fase/, `${nome}: sumiu a revisão por fase`);
  }
});
