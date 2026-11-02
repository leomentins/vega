/**
 * A declaração do projeto à fábrica (HN-29 T11): o leitor sem dependência recusa o que o
 * esquema versionado não admite; uma `fonte` e a do projeto de exemplo (`consumidor`) passam;
 * o adaptador da condução sai do `.vega/` e vence o `.altair/`.
 *
 * O corpo passa fora da Sistoli e sem dependência (D-HN29-31, E1.A2): aqui não se lê arquivo
 * da Sistoli nem se importa validador de esquema. O esquema é conferido na estrutura; a
 * paridade esquema↔leitor, que precisa de validador, e o que se prova sobre a declaração da
 * Sistoli moram no lado da fonte, em `.vega/__tests__/declaracao-da-fonte.test.mjs`.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as adaptador from "../../conducao/adaptador.mjs";
import { ARQUIVO, ErroDeclaracao, existe, lerDeclaracao, validar } from "../declaracao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(AQUI, "..", "..", "..");
const ler = (f) => JSON.parse(readFileSync(f, "utf8"));
const ESQUEMA = ler(path.join(PLUGIN, "scripts", "vega", "declaracao.schema.json"));

const DIR_EXEMPLO = path.join(PLUGIN, "exemplo");
const EXEMPLO = ler(path.join(DIR_EXEMPLO, ".vega", "declaracao.json"));
const ADAPTADOR_DE_TESTE = ler(path.join(PLUGIN, "scripts", "conducao", "__tests__", "fixtures", "projeto-de-teste", ".altair", "adaptador.json"));

const FONTE = { esquema: 1, papel: "fonte", decisoes: { destino: "banco" }, listas: { corpo: ".vega/lista-corpo.txt", empresa: ".vega/lista-empresa.txt" } };
const CONSUMIDOR = { esquema: 1, papel: "consumidor", versao: { corpo: "1.2.3" }, decisoes: { destino: "git", arquivo: ".vega/decisoes.jsonl" } };
const VALIDAS = [
  FONTE,
  CONSUMIDOR,
  { ...CONSUMIDOR, versao: { corpo: "1.2.3", empresa: "0.4.0" } },
  { ...FONTE, conducao: ADAPTADOR_DE_TESTE },
  {
    ...FONTE,
    immutable_docs: ["grafo/blueprint.md"],
    lean_scope_docs: [{ path: "grafo/blueprint.md", entry: "^### ", unit: "lines" }],
    lean_record_scopes: [{ dir: "r/", contract: "c.json" }],
    saidas_geradas: [{ caminho: "gerado/saida.ts", comando: "make saida" }],
    raiz_do_grafo: "grafo",
  },
];

function recusa(d, re) {
  assert.throws(() => validar(d), (e) => e instanceof ErroDeclaracao && re.test(e.message), JSON.stringify(d));
}

function repo(t, arquivos) {
  const r = mkdtempSync(path.join(tmpdir(), "vega-declaracao-"));
  t.after(() => rmSync(r, { recursive: true, force: true }));
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    mkdirSync(path.dirname(path.join(r, rel)), { recursive: true });
    writeFileSync(path.join(r, rel), typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo));
  }
  return r;
}

describe("as declarações passam no leitor", () => {
  test("uma fonte aponta as listas, grava decisões no banco e traz o adaptador da condução", () => {
    const d = validar({ ...FONTE, conducao: ADAPTADOR_DE_TESTE });
    assert.equal(d.papel, "fonte");
    assert.equal(d.versao, null);
    assert.deepEqual(d.listas, { corpo: ".vega/lista-corpo.txt", empresa: ".vega/lista-empresa.txt" });
    assert.equal(d.decisoes.destino, "banco");
    assert.equal(adaptador.validar(d.conducao).projeto, ADAPTADOR_DE_TESTE.projeto);
  });

  test("a do projeto de exemplo é consumidor, com a versão do corpo e o embutido por nome", () => {
    const d = validar(EXEMPLO);
    assert.equal(d.papel, "consumidor");
    assert.equal(d.listas, null);
    assert.match(d.versao.corpo, /^\d+\.\d+\.\d+$/);
    assert.equal(adaptador.validar(d.conducao).codigo, "superpowers");
  });

  test("as formas mínimas valem, e a camada da empresa é opcional no consumidor", () => {
    for (const d of VALIDAS) assert.equal(validar(d).papel, d.papel);
  });
});

describe("o esquema versionado, conferido sem validador", () => {
  test("é draft 2020-12, fecha a raiz e declara todo campo que as declarações válidas usam", () => {
    assert.equal(ESQUEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(ESQUEMA.additionalProperties, false);
    for (const d of [...VALIDAS, EXEMPLO]) {
      for (const k of Object.keys(d)) assert.ok(Object.hasOwn(ESQUEMA.properties, k), `campo ${k} fora do esquema`);
    }
  });
});

describe("o esquema e o leitor recusam o mesmo", () => {
  test("campo desconhecido, em qualquer nível", () => {
    recusa({ ...FONTE, extra: 1 }, /campo desconhecido extra/);
    recusa({ ...FONTE, decisoes: { destino: "banco", x: 1 } }, /decisoes: campo desconhecido x/);
    recusa({ ...CONSUMIDOR, versao: { corpo: "1.0.0", os: "1.0.0" } }, /versao: campo desconhecido os/);
    recusa({ ...FONTE, listas: { ...FONTE.listas, os: "x" } }, /listas: campo desconhecido os/);
  });

  test("esquema, papel e destino fora da lista fechada", () => {
    recusa({ ...FONTE, esquema: 2 }, /^esquema: /);
    recusa((({ esquema, ...r }) => r)(FONTE), /falta esquema/);
    recusa({ ...FONTE, papel: "Fonte" }, /^papel: /);
    for (const destino of ["Git", "gti", ""]) recusa({ ...FONTE, decisoes: { destino } }, /^decisoes\.destino: /);
    recusa((({ decisoes, ...r }) => r)(FONTE), /falta decisoes/);
  });

  test("o arquivo de decisões: obrigatório com git, recusado com banco; o layout das worktrees de ciclo (HN-29 T27)", () => {
    recusa({ ...FONTE, decisoes: { destino: "git" } }, /decisoes\.arquivo: obrigatório com destino git/);
    recusa({ ...FONTE, decisoes: { destino: "banco", arquivo: "d.jsonl" } }, /decisoes\.arquivo: só com destino git/);
    recusa({ ...FONTE, decisoes: { destino: "git", arquivo: "../fora.jsonl" } }, /decisoes\.arquivo: caminho fora da raiz/);
    recusa({ ...FONTE, worktrees_de_ciclo: { ramo: "ciclo-" } }, /worktrees_de_ciclo: falta pasta/);
    recusa({ ...FONTE, worktrees_de_ciclo: { ramo: "ciclo-", pasta: "a/b" } }, /worktrees_de_ciclo\.pasta: /);
    recusa({ ...FONTE, worktrees_de_ciclo: { ramo: " ", pasta: "wt" } }, /worktrees_de_ciclo\.ramo: /);
    const d = validar({ ...FONTE, decisoes: { destino: "git", arquivo: "decisoes.jsonl" }, worktrees_de_ciclo: { ramo: "ciclo-", pasta: "wt" } });
    assert.deepEqual(d.decisoes, { destino: "git", arquivo: "decisoes.jsonl" });
    assert.deepEqual(d.worktrees_de_ciclo, { ramo: "ciclo-", pasta: "wt" });
    assert.equal(validar(FONTE).worktrees_de_ciclo, null);
  });

  test("versão só no consumidor, listas só na fonte, cada um com a sua obrigatória", () => {
    recusa({ ...FONTE, versao: { corpo: "1.0.0" } }, /versao: só no consumidor/);
    recusa((({ listas, ...r }) => r)(FONTE), /listas: obrigatórias na fonte/);
    recusa({ ...CONSUMIDOR, listas: FONTE.listas }, /listas: só na fonte/);
    recusa((({ versao, ...r }) => r)(CONSUMIDOR), /versao: obrigatória no consumidor/);
  });

  test("versão que não é x.y.z, e lista fora da raiz", () => {
    for (const corpo of ["1.2", "v1.2.3", "01.2.3", "1.2.3-rc1", 123]) recusa({ ...CONSUMIDOR, versao: { corpo } }, /^versao\.corpo: /);
    recusa({ ...CONSUMIDOR, versao: { corpo: "1.0.0", empresa: "x" } }, /^versao\.empresa: /);
    for (const corpo of ["/etc/x", "../x", "a/../../x", "C:/x", "\\x", "", "  "]) recusa({ ...FONTE, listas: { ...FONTE.listas, corpo } }, /^listas\.corpo: /);
  });

  test("conducao que não é objeto", () => {
    recusa({ ...FONTE, conducao: [] }, /conducao: esperado objeto/);
    recusa({ ...FONTE, conducao: "x" }, /conducao: esperado objeto/);
  });

  test("os escopos dos guards (HN-29 T12): lista, caminho na raiz, unidade e campos fechados", () => {
    for (const k of ["immutable_docs", "lean_scope_docs", "lean_record_scopes"]) recusa({ ...FONTE, [k]: "x" }, new RegExp(`^${k}: esperada lista`));
    recusa({ ...FONTE, immutable_docs: ["../fora.md"] }, /^immutable_docs\[0\]: caminho fora da raiz/);
    recusa({ ...FONTE, immutable_docs: ["a.md", "a.md"] }, /^immutable_docs: documento repetido/);
    recusa({ ...FONTE, lean_scope_docs: [{ entry: "^### " }] }, /^lean_scope_docs\[0\]: falta path/);
    recusa({ ...FONTE, lean_scope_docs: [{ path: "a.md", unit: "linhas" }] }, /^lean_scope_docs\[0\]\.unit: /);
    recusa({ ...FONTE, lean_scope_docs: [{ path: "a.md", x: 1 }] }, /^lean_scope_docs\[0\]: campo desconhecido x/);
    recusa({ ...FONTE, lean_record_scopes: [{ dir: "r/" }] }, /^lean_record_scopes\[0\]: falta contract/);
    recusa({ ...FONTE, lean_record_scopes: [{ dir: "r/", contract: "/etc/c.json" }] }, /^lean_record_scopes\[0\]\.contract: caminho fora da raiz/);
    recusa({ ...FONTE, lean_record_scopes: [{ dir: "r/", contract: "c.json", fields: [] }] }, /^lean_record_scopes\[0\]\.fields: /);
    // Expressão que não compila: só o leitor enxerga (o esquema não compila regex).
    assert.throws(() => validar({ ...FONTE, lean_scope_docs: [{ path: "a.md", entry: "(" }] }), (e) => e instanceof ErroDeclaracao && /^lean_scope_docs\[0\]\.entry: expressão inválida/.test(e.message));
  });
});

describe("os escopos dos guards vieram do harness.config.json (HN-29 T12)", () => {
  test("os escopos declarados saem como vieram: documento protegido e entrada medida", () => {
    const d = validar({ ...FONTE, immutable_docs: ["grafo/blueprint.md"], lean_scope_docs: [{ path: "grafo/blueprint.md", entry: "^### |^#### ", unit: "lines" }] });
    assert.deepEqual(d.immutable_docs, ["grafo/blueprint.md"]);
    assert.deepEqual(d.lean_scope_docs, [{ path: "grafo/blueprint.md", entry: "^### |^#### ", unit: "lines" }]);
    assert.deepEqual(d.lean_record_scopes, []);
  });

  test("ausentes saem vazias; string vira objeto; registro ganha os padrões do motor", () => {
    const vazia = validar(FONTE);
    for (const k of ["immutable_docs", "lean_scope_docs", "lean_record_scopes"]) assert.deepEqual(vazia[k], [], k);
    const d = validar({ ...FONTE, lean_scope_docs: ["a.md"], lean_record_scopes: [{ dir: "r/", contract: "c.json" }] });
    assert.deepEqual(d.lean_scope_docs, [{ path: "a.md", entry: null, unit: null }]);
    assert.deepEqual(d.lean_record_scopes, [{ dir: "r/", contract: "c.json", fields: ["titulo", "corpo"], unit: "chars" }]);
  });
});

describe("leitura do repositório", () => {
  test("ausente, ilegível e inválida recusam citando o arquivo; presente devolve a validada", (t) => {
    const vazio = repo(t, {});
    assert.equal(existe(vazio), false);
    assert.throws(() => lerDeclaracao(vazio), (e) => e instanceof ErroDeclaracao && e.message.includes(path.join(vazio, ARQUIVO)) && /sem declaração/.test(e.message));
    const ilegivel = repo(t, { [ARQUIVO]: "{ nao e json" });
    assert.throws(() => lerDeclaracao(ilegivel), /JSON ilegível/);
    const invalida = repo(t, { [ARQUIVO]: { ...FONTE, papel: "x" } });
    assert.throws(() => lerDeclaracao(invalida), (e) => e.message.startsWith(path.join(invalida, ARQUIVO)) && /papel/.test(e.message));
    const boa = repo(t, { [ARQUIVO]: CONSUMIDOR });
    assert.equal(existe(boa), true);
    const lida = lerDeclaracao(boa);
    assert.equal(lida.arquivo, path.join(boa, ARQUIVO));
    assert.equal(lida.declaracao.versao.corpo, "1.2.3");
    assert.ok(Object.isFrozen(lida.declaracao));
  });
});

describe("o adaptador da condução lê o .vega/", () => {
  test("o projeto de exemplo: o adaptador vem do .vega/declaracao.json, com o código embutido", () => {
    const a = adaptador.lerAdaptador(DIR_EXEMPLO);
    assert.equal(a.origem, "repo");
    assert.equal(a.arquivo, path.join(DIR_EXEMPLO, ".vega", "declaracao.json"));
    assert.equal(a.projeto, "exemplo");
    assert.equal(adaptador.pastaDoAdaptador(DIR_EXEMPLO), ".vega");
    assert.equal(typeof adaptador.codigoDoAdaptador(DIR_EXEMPLO).plano.ler, "function");
  });

  test("o código próprio declarado carrega do .vega/ do projeto", (t) => {
    const r = repo(t, {
      [ARQUIVO]: { ...FONTE, conducao: { ...ADAPTADOR_DE_TESTE, codigo: "proprio.mjs" } },
      ".vega/proprio.mjs": readFileSync(adaptador.caminhoDoEmbutido("superpowers"), "utf8"),
    });
    assert.equal(adaptador.lerAdaptador(r).arquivo, path.join(r, ARQUIVO));
    assert.equal(typeof adaptador.codigoDoAdaptador(r).plano.ler, "function");
  });

  test(".vega/ vence o .altair/; sem .vega/ o .altair/ segue valendo", (t) => {
    const ambos = repo(t, {
      [ARQUIVO]: { ...CONSUMIDOR, conducao: { ...ADAPTADOR_DE_TESTE, projeto: "do-vega" } },
      ".altair/adaptador.json": { ...ADAPTADOR_DE_TESTE, projeto: "do-altair" },
    });
    assert.equal(adaptador.lerAdaptador(ambos).projeto, "do-vega");
    assert.equal(adaptador.pastaDoAdaptador(ambos), ".vega");
    const antigo = repo(t, { ".altair/adaptador.json": { ...ADAPTADOR_DE_TESTE, projeto: "do-altair" } });
    assert.equal(adaptador.lerAdaptador(antigo).projeto, "do-altair");
    assert.equal(adaptador.pastaDoAdaptador(antigo), ".altair");
  });

  test("o código declarado carrega do .vega/, não do .altair/", (t) => {
    const r = repo(t, { [ARQUIVO]: { ...CONSUMIDOR, conducao: { ...ADAPTADOR_DE_TESTE, codigo: "proprio.mjs" } }, ".vega/proprio.mjs": "export default 1;\n", ".altair/proprio.mjs": "export default 2;\n" });
    assert.equal(adaptador.caminhoDeCodigo(r, "proprio.mjs"), path.join(r, ".vega", "proprio.mjs"));
  });

  test(".vega/ ilegível, inválido ou sem conducao recusa, sem cair no .altair/ nem no núcleo", (t) => {
    const altair = { ".altair/adaptador.json": ADAPTADOR_DE_TESTE };
    for (const [vega, re] of [
      ["{ nao e json", /JSON ilegível/],
      [{ ...CONSUMIDOR, papel: "x" }, /papel/],
      [CONSUMIDOR, /sem `conducao`/],
      [{ ...CONSUMIDOR, conducao: { ...ADAPTADOR_DE_TESTE, extra: 1 } }, /campo desconhecido extra/],
    ]) {
      const r = repo(t, { [ARQUIVO]: vega, ...altair });
      assert.throws(() => adaptador.lerAdaptador(r), (e) => e instanceof adaptador.ErroAdaptador && re.test(e.message), String(re));
    }
    // Link quebrado no lugar da declaração conta como presente: recusa, não cai no `.altair/`.
    const quebrado = repo(t, altair);
    mkdirSync(path.join(quebrado, ".vega"));
    symlinkSync(path.join(quebrado, "nao-existe.json"), path.join(quebrado, ARQUIVO));
    assert.equal(existe(quebrado), true);
    assert.throws(() => adaptador.lerAdaptador(quebrado), (e) => e instanceof adaptador.ErroAdaptador && /sem declaração/.test(e.message));
  });
});
