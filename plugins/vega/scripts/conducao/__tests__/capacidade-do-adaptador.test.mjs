/**
 * capacidade-do-adaptador.test.mjs — a capacidade da máquina vem do adaptador
 * (HN-29 T24, segunda parte do débito do núcleo).
 *
 * A declaração diz de onde vem a capacidade (`capacidade`, v6): `"codigo"` ⇒
 * a função `capacidade()` do código do adaptador mede quantas filhas novas
 * cabem, e o `proximo` sem `tetoPonte` na entrada usa vivas + essas; sem o
 * campo (ou `"padrao"`) vale o teto padrão do núcleo. Tudo com adaptador de
 * mentira, num repositório temporário.
 */
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CAPACIDADE_PADRAO, ErroAdaptador, capacidadeDoProjeto, validar, validarCodigo } from "../adaptador.mjs";
import { comTetoDoAdaptador } from "../conducao.mjs";

const BASE = Object.freeze({
  projeto: "mentira",
  operadores: [{ handle: "op", nome: "Operadora" }],
  estado: { pasta: "mentira/conducao" },
  log: { pasta: "." },
  pergunta: { destino: "log" },
});

const CODIGO_MINIMO = Object.freeze({
  plano: { raiz: "planos", casa: () => false, ler: () => ({}), brief: () => [] },
  publicacao: [],
  caminhosProtegidos: [],
  telasProtegidasDosSteps: [],
  foraDasTelasDosSteps: [],
  carimbo: null,
  ci: null,
});

const repos = [];
afterEach(() => {
  while (repos.length) rmSync(repos.pop(), { recursive: true, force: true });
  delete globalThis.__chamadasDaCapacidade;
});

/** Repositório de mentira: declaração em `.altair/adaptador.json` e o código `mentira.mjs` com o corpo dado de `capacidade`. */
function repoCom(declaracao, corpoDaCapacidade) {
  const repo = mkdtempSync(path.join(tmpdir(), "capacidade-do-adaptador-"));
  repos.push(repo);
  mkdirSync(path.join(repo, ".altair"));
  writeFileSync(path.join(repo, ".altair", "adaptador.json"), JSON.stringify(declaracao));
  const capacidade = corpoDaCapacidade === undefined ? "" : `  capacidade() { globalThis.__chamadasDaCapacidade = (globalThis.__chamadasDaCapacidade ?? 0) + 1; ${corpoDaCapacidade} },\n`;
  writeFileSync(
    path.join(repo, ".altair", "mentira.mjs"),
    `export default {
  plano: { raiz: "planos", casa: () => false, ler: () => ({}), brief: () => [] },
  publicacao: [],
  caminhosProtegidos: [],
  telasProtegidasDosSteps: [],
  foraDasTelasDosSteps: [],
  carimbo: null,
  ci: null,
${capacidade}};
`,
  );
  return repo;
}

const MEDE = { ...BASE, versao: 6, codigo: "mentira.mjs", capacidade: "codigo" };
const FILHAS = [
  { sessao: "a", task: "T1", estado: "RUNNING" },
  { sessao: "b", task: "T2", estado: "IDLE" },
  { sessao: "c", task: "T3", estado: "ARCHIVED" },
  { sessao: "d", task: "T4", estado: "RUNNING", vez: "esperando" },
];

describe("a declaração diz de onde vem a capacidade (v6)", () => {
  test("sem o campo vale o padrão do núcleo; v6 aceita codigo e padrao", () => {
    assert.equal(validar(BASE).capacidade, CAPACIDADE_PADRAO);
    assert.equal(validar({ ...BASE, versao: 5, codigo: "x.mjs" }).capacidade, "padrao");
    assert.equal(validar(MEDE).capacidade, "codigo");
    assert.equal(validar({ ...BASE, versao: 6, capacidade: "padrao" }).capacidade, "padrao");
  });

  test("o campo antes da v6, valor desconhecido ou codigo sem código recusam", () => {
    for (const [d, re] of [
      [{ ...MEDE, versao: 5 }, /capacidade: só na versao 6/],
      [{ ...MEDE, capacidade: "medir" }, /capacidade: esperado codigo ou padrao/],
      [{ ...BASE, versao: 6, capacidade: "codigo" }, /exige o campo codigo/],
    ])
      assert.throws(() => validar(d), (e) => e instanceof ErroAdaptador && re.test(e.message), JSON.stringify(d));
  });

  test("o código do adaptador: capacidade é função opcional", () => {
    assert.equal(validarCodigo(CODIGO_MINIMO).capacidade, null);
    const f = () => null;
    assert.equal(validarCodigo({ ...CODIGO_MINIMO, capacidade: f }).capacidade, f);
    assert.throws(() => validarCodigo({ ...CODIGO_MINIMO, capacidade: 3 }), /capacidade: esperada função/);
  });
});

describe("o proximo sem tetoPonte usa a medição do adaptador", () => {
  test("teto = filhas vivas (sem arquivada nem esperando a vez) + filhas novas medidas", () => {
    const repo = repoCom(MEDE, "return { filhasNovas: 3, texto: 'medido' };");
    assert.deepEqual(capacidadeDoProjeto(repo), { filhasNovas: 3, texto: "medido" });
    const entrada = { filhas: FILHAS };
    const saida = comTetoDoAdaptador(repo, entrada);
    assert.equal(saida.tetoPonte, 2 + 3);
    assert.equal(saida.filhas, FILHAS);
    assert.equal(entrada.tetoPonte, undefined, "a entrada de quem chama não muda");
  });

  test("filhasNovas 0 ⇒ o teto é o número de vivas: nada abre", () => {
    const repo = repoCom(MEDE, "return { filhasNovas: 0 };");
    assert.equal(comTetoDoAdaptador(repo, { filhas: FILHAS }).tetoPonte, 2);
    assert.equal(comTetoDoAdaptador(repo, {}).tetoPonte, 0);
  });

  test("tetoPonte na entrada vence e o adaptador nem mede", () => {
    const repo = repoCom(MEDE, "return { filhasNovas: 3 };");
    const entrada = { filhas: FILHAS, tetoPonte: 7 };
    assert.equal(comTetoDoAdaptador(repo, entrada), entrada);
    assert.equal(globalThis.__chamadasDaCapacidade, undefined);
  });

  test("medição null (fora da máquina do projeto) ⇒ entrada como está: vale o teto padrão", () => {
    const repo = repoCom(MEDE, "return null;");
    const entrada = { filhas: FILHAS };
    assert.equal(comTetoDoAdaptador(repo, entrada), entrada);
    assert.equal(globalThis.__chamadasDaCapacidade, 1);
  });

  test("projeto sem a declaração usa o padrão, mesmo com a função no código", () => {
    for (const d of [{ ...BASE, versao: 5, codigo: "mentira.mjs" }, { ...MEDE, capacidade: "padrao" }]) {
      const repo = repoCom(d, "return { filhasNovas: 3 };");
      const entrada = { filhas: FILHAS };
      assert.equal(capacidadeDoProjeto(repo), null);
      assert.equal(comTetoDoAdaptador(repo, entrada), entrada);
    }
    assert.equal(globalThis.__chamadasDaCapacidade, undefined, "a função não declarada não roda");
  });

  test("declarada e ilegível recusa com capacidade-ilegivel: sem medição o núcleo não inventa número", () => {
    for (const [corpo, re] of [
      [undefined, /não tem a função capacidade/],
      ["throw new Error('slice ilegível');", /a medição do adaptador falhou \(slice ilegível\)/],
      ["throw 'texto cru';", /a medição do adaptador falhou \(texto cru\)/],
      ["return { filhasNovas: -1 };", /esperado null ou \{ filhasNovas/],
      ["return { filhasNovas: 2.5 };", /esperado null ou \{ filhasNovas/],
      ["return 4;", /esperado null ou \{ filhasNovas/],
      ["return { filhasNovas: 1, texto: 9 };", /esperado null ou \{ filhasNovas/],
    ]) {
      const repo = repoCom(MEDE, corpo);
      assert.throws(
        () => comTetoDoAdaptador(repo, { filhas: FILHAS }),
        (e) => e instanceof ErroAdaptador && e.codigo === "capacidade-ilegivel" && re.test(e.message),
        String(corpo),
      );
    }
  });
});
