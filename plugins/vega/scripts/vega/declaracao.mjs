/**
 * declaracao.mjs — a declaração do projeto à fábrica, lida do repositório (HN-29 T11).
 *
 * Um lugar só para o que o projeto declara à fábrica (D-HN29-3): `<repo>/.vega/declaracao.json`.
 * A forma está no esquema versionado `declaracao.schema.json`; este leitor é a mesma regra sem
 * dependência npm (o corpo não carrega `ajv`):
 *
 *   esquema   1                          — a versão do esquema
 *   papel     "fonte" | "consumidor"     — a fonte roda a fábrica da própria árvore; o consumidor
 *                                          a instala pelas vitrines
 *   versao    { corpo, empresa? }        — só no consumidor, obrigatório: a versão que ele instala,
 *                                          do corpo e, quando há, da camada da empresa (`x.y.z`)
 *   decisoes  { destino }                — onde o coletor grava as decisões: `banco` | `git`
 *   listas    { corpo, empresa }         — só na fonte, obrigatório: onde estão as listas do que
 *                                          sai, relativas à raiz do repositório
 *   conducao  { … }                      — OPCIONAL: o adaptador da condução, conferido por
 *                                          `conducao/adaptador.mjs`; aqui só se exige objeto
 *   immutable_docs      [caminho]        — OPCIONAL: documentos com seções imutáveis, que
 *                                          `immutable-sections-guard.js` protege no commit
 *   lean_scope_docs     [caminho | { path, entry?, unit? }]
 *                                        — OPCIONAL: documentos cuja entrada nova o
 *                                          `lean-entry-check.js` mede contra a vizinhança
 *   lean_record_scopes  [{ dir, contract, fields?, unit? }]
 *                                        — OPCIONAL: pastas de registro medidas contra o teto
 *                                          do tipo, lido de `contract` (`properties.<campo>.maxLength`)
 *   saidas_geradas      [{ caminho, comando }]
 *                                        — OPCIONAL: arquivos que um comando do projeto regera
 *                                          (caminho exato, nunca glob nem pasta); o `git-guard`
 *                                          libera o descarte deles por serem reproduziveis, e a
 *                                          conducao os le pela mesma `saidasGeradas` (HN-29 T42)
 *   raiz_do_grafo       caminho          — OPCIONAL: a pasta do grafo do projeto, onde o
 *                                          `auto-bump-updated.js` carimba `updated:` (HN-29 T42)
 *
 * As três últimas vieram do `harness.config.json` (HN-29 T12) com o mesmo nome e a mesma
 * forma: mover antes de mudar. Ausentes saem como lista vazia; quem precisa de uma não vazia
 * (o guard de seções imutáveis) recusa sozinho.
 *
 * Campo desconhecido, em qualquer nível, é recusado: declaração que o leitor não entende não é
 * lida pela metade. Declaração ausente não tem default aqui: quem chama decide (`existe`).
 */
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

export const PASTA = ".vega";
export const ARQUIVO = path.join(PASTA, "declaracao.json");
export const ESQUEMAS = Object.freeze([1]);
export const PAPEIS = Object.freeze(["fonte", "consumidor"]);
export const DESTINOS = Object.freeze(["banco", "git"]);
export const UNIDADES = Object.freeze(["lines", "chars"]);
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export class ErroDeclaracao extends Error {
  constructor(message) {
    super(message);
    this.name = "ErroDeclaracao";
  }
}

function objeto(v, onde) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new ErroDeclaracao(`${onde}: esperado objeto`);
  return v;
}

function soCampos(o, obrigatorios, onde, opcionais = []) {
  for (const k of Object.keys(o)) if (!obrigatorios.includes(k) && !opcionais.includes(k)) throw new ErroDeclaracao(`${onde}: campo desconhecido ${k}`);
  for (const k of obrigatorios) if (!(k in o)) throw new ErroDeclaracao(`${onde}: falta ${k}`);
}

function semver(v, onde) {
  if (typeof v !== "string" || !SEMVER.test(v)) throw new ErroDeclaracao(`${onde}: esperada versão x.y.z (veio ${JSON.stringify(v)})`);
  return v;
}

function caminho(v, onde) {
  if (typeof v !== "string" || !v.trim()) throw new ErroDeclaracao(`${onde}: esperado caminho relativo`);
  if (path.isAbsolute(v) || /^[A-Za-z]:/.test(v) || /^[\\/]/.test(v) || v.split(/[\\/]/).includes(".."))
    throw new ErroDeclaracao(`${onde}: caminho fora da raiz (${v})`);
  return v;
}

function lista(v, onde) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ErroDeclaracao(`${onde}: esperada lista`);
  return v;
}

function unidade(v, onde) {
  if (v === undefined) return null;
  if (!UNIDADES.includes(v)) throw new ErroDeclaracao(`${onde}: esperado ${UNIDADES.join(" ou ")} (veio ${JSON.stringify(v)})`);
  return v;
}

function documentosImutaveis(v) {
  const docs = lista(v, "immutable_docs").map((p, i) => caminho(p, `immutable_docs[${i}]`));
  const repetido = docs.find((p, i) => docs.indexOf(p) !== i);
  if (repetido !== undefined) throw new ErroDeclaracao(`immutable_docs: documento repetido (${repetido})`);
  return Object.freeze(docs);
}

function escoposDeDocumento(v) {
  return Object.freeze(
    lista(v, "lean_scope_docs").map((d, i) => {
      const onde = `lean_scope_docs[${i}]`;
      if (typeof d === "string") return Object.freeze({ path: caminho(d, onde), entry: null, unit: null });
      objeto(d, onde);
      soCampos(d, ["path"], onde, ["entry", "unit"]);
      let entry = null;
      if (d.entry !== undefined) {
        if (typeof d.entry !== "string" || !d.entry) throw new ErroDeclaracao(`${onde}.entry: esperada expressão regular`);
        try {
          new RegExp(d.entry);
        } catch (e) {
          throw new ErroDeclaracao(`${onde}.entry: expressão inválida (${e.message})`);
        }
        entry = d.entry;
      }
      return Object.freeze({ path: caminho(d.path, `${onde}.path`), entry, unit: unidade(d.unit, `${onde}.unit`) });
    }),
  );
}

function escoposDeRegistro(v) {
  return Object.freeze(
    lista(v, "lean_record_scopes").map((s, i) => {
      const onde = `lean_record_scopes[${i}]`;
      objeto(s, onde);
      soCampos(s, ["dir", "contract"], onde, ["fields", "unit"]);
      let fields = ["titulo", "corpo"];
      if (s.fields !== undefined) {
        if (!Array.isArray(s.fields) || s.fields.length === 0 || s.fields.some((f) => typeof f !== "string" || !f))
          throw new ErroDeclaracao(`${onde}.fields: esperada lista de nomes de campo`);
        fields = s.fields;
      }
      return Object.freeze({
        dir: caminho(s.dir, `${onde}.dir`),
        contract: caminho(s.contract, `${onde}.contract`),
        fields: Object.freeze([...fields]),
        unit: unidade(s.unit, `${onde}.unit`) ?? "chars",
      });
    }),
  );
}

const GLOB = /[*?[\]{}]/;

function normal(c) {
  return c.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

function saidasDeclaradas(v) {
  const saidas = lista(v, "saidas_geradas").map((s, i) => {
    const onde = `saidas_geradas[${i}]`;
    objeto(s, onde);
    soCampos(s, ["caminho", "comando"], onde);
    const bruto = caminho(s.caminho, `${onde}.caminho`);
    if (GLOB.test(bruto) || /[\\/]$/.test(bruto) || normal(bruto) === "" || normal(bruto) === ".")
      throw new ErroDeclaracao(`${onde}.caminho: esperado caminho exato de arquivo, nunca glob nem pasta (${bruto})`);
    if (typeof s.comando !== "string" || !s.comando.trim())
      throw new ErroDeclaracao(`${onde}.comando: esperado o comando que regera o arquivo`);
    return Object.freeze({ caminho: normal(bruto), comando: s.comando });
  });
  const repetida = saidas.find((s, i) => saidas.findIndex((o) => o.caminho === s.caminho) !== i);
  if (repetida) throw new ErroDeclaracao(`saidas_geradas: caminho repetido (${repetida.caminho})`);
  return Object.freeze(saidas);
}

function raizDeclarada(v) {
  if (v === undefined) return null;
  const bruto = caminho(v, "raiz_do_grafo");
  const r = normal(bruto);
  if (GLOB.test(r) || r === "" || r === ".") throw new ErroDeclaracao(`raiz_do_grafo: esperada uma pasta sob a raiz do repositório (${bruto})`);
  return r;
}

/** Valida a declaração já parseada; devolve a forma normalizada, congelada. */
export function validar(bruto) {
  const d = objeto(bruto, "declaração");
  soCampos(d, ["esquema", "papel", "decisoes"], "declaração", ["versao", "listas", "conducao", "immutable_docs", "lean_scope_docs", "lean_record_scopes", "saidas_geradas", "raiz_do_grafo"]);
  if (!ESQUEMAS.includes(d.esquema)) throw new ErroDeclaracao(`esquema: esperado ${ESQUEMAS.join(" ou ")} (veio ${JSON.stringify(d.esquema)})`);
  if (!PAPEIS.includes(d.papel)) throw new ErroDeclaracao(`papel: esperado ${PAPEIS.join(" ou ")} (veio ${JSON.stringify(d.papel)})`);

  const k = objeto(d.decisoes, "decisoes");
  soCampos(k, ["destino"], "decisoes");
  if (!DESTINOS.includes(k.destino)) throw new ErroDeclaracao(`decisoes.destino: esperado ${DESTINOS.join(" ou ")} (veio ${JSON.stringify(k.destino)})`);
  const decisoes = Object.freeze({ destino: k.destino });

  let versao = null;
  let listas = null;
  if (d.papel === "consumidor") {
    if (d.listas !== undefined) throw new ErroDeclaracao("listas: só na fonte");
    if (d.versao === undefined) throw new ErroDeclaracao("versao: obrigatória no consumidor");
    const v = objeto(d.versao, "versao");
    soCampos(v, ["corpo"], "versao", ["empresa"]);
    versao = Object.freeze({ corpo: semver(v.corpo, "versao.corpo"), ...(v.empresa !== undefined ? { empresa: semver(v.empresa, "versao.empresa") } : {}) });
  } else {
    if (d.versao !== undefined) throw new ErroDeclaracao("versao: só no consumidor (a fonte roda da árvore)");
    if (d.listas === undefined) throw new ErroDeclaracao("listas: obrigatórias na fonte");
    const l = objeto(d.listas, "listas");
    soCampos(l, ["corpo", "empresa"], "listas");
    listas = Object.freeze({ corpo: caminho(l.corpo, "listas.corpo"), empresa: caminho(l.empresa, "listas.empresa") });
  }

  const conducao = d.conducao === undefined ? null : objeto(d.conducao, "conducao");
  return Object.freeze({
    esquema: d.esquema,
    papel: d.papel,
    versao,
    decisoes,
    listas,
    conducao,
    immutable_docs: documentosImutaveis(d.immutable_docs),
    lean_scope_docs: escoposDeDocumento(d.lean_scope_docs),
    lean_record_scopes: escoposDeRegistro(d.lean_record_scopes),
    saidas_geradas: saidasDeclaradas(d.saidas_geradas),
    raiz_do_grafo: raizDeclarada(d.raiz_do_grafo),
  });
}

/**
 * O repositório tem `.vega/declaracao.json`. Só ENOENT conta como ausente: link quebrado ou
 * arquivo sem permissão de leitura conta como presente, e a leitura recusa alto, em vez de
 * quem chama cair calado noutra declaração.
 */
export function existe(repo) {
  try {
    lstatSync(path.join(path.resolve(repo ?? process.cwd()), ARQUIVO));
    return true;
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return false;
    return true;
  }
}

/**
 * Lê e valida `<repo>/.vega/declaracao.json`. Ausente, JSON ilegível ou forma errada ⇒
 * `ErroDeclaracao` citando o arquivo; nunca devolve declaração vazia.
 */
export function lerDeclaracao(repo) {
  const arquivo = path.join(path.resolve(repo ?? process.cwd()), ARQUIVO);
  let texto;
  try {
    texto = readFileSync(arquivo, "utf8");
  } catch (e) {
    throw new ErroDeclaracao(`${arquivo}: sem declaração (${e.code ?? e.message})`);
  }
  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch (e) {
    throw new ErroDeclaracao(`${arquivo}: JSON ilegível (${e.message})`);
  }
  try {
    return Object.freeze({ arquivo, declaracao: validar(bruto) });
  } catch (e) {
    if (e instanceof ErroDeclaracao) throw new ErroDeclaracao(`${arquivo}: ${e.message}`);
    throw e;
  }
}

/**
 * As saídas geradas que o projeto declara — a lista que o `git-guard` e a condução leem, pela
 * mesma função. Só a declaração AUSENTE dá lista vazia; presente e ilegível, ou com forma
 * errada, lança `ErroDeclaracao`, e quem chama recusa alto.
 */
export function saidasGeradas(repo) {
  if (!existe(repo)) return Object.freeze([]);
  return lerDeclaracao(repo).declaracao.saidas_geradas;
}

/**
 * A raiz do grafo que o projeto declara, sem barra no fim, ou `null` quando a declaração está
 * ausente ou não traz o campo. Declaração presente e ilegível lança `ErroDeclaracao`.
 */
export function raizDoGrafo(repo) {
  if (!existe(repo)) return null;
  return lerDeclaracao(repo).declaracao.raiz_do_grafo;
}
