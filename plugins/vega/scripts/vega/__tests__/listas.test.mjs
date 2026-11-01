/**
 * As duas listas do que sai (HN-29 T14, AC-HN29-6): a do corpo e a da camada da empresa, que a
 * declaração da fonte aponta. Expandidas, todo caminho existe, os destinos não colidem, as
 * listas não se cruzam, nenhuma leva camada do OS nem lugar possível de dado de paciente
 * (D-HN29-16, D-HN29-21), e nenhum arquivo de cada uma contém termo do vocabulário proibido
 * dela, casado como palavra inteira e sem caixa (canário grep-zero, D-HN29-15). Fora da fonte
 * (a vitrine, um projeto que instalou) não há lista a conferir.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { existe, lerDeclaracao } from "../declaracao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(AQUI, "..", "..", "..");
const RAIZ = path.resolve(PLUGIN, "..", "..", "..");
const DECLARACAO = existe(RAIZ) ? lerDeclaracao(RAIZ).declaracao : null;
const NA_FONTE = DECLARACAO?.papel === "fonte";
const fora = !NA_FONTE && "fora da fonte: sem lista do que sai";

const VOCABULARIO = { corpo: ".vega/vocabulario-proibido-corpo.txt", empresa: ".vega/vocabulario-proibido-empresa.txt" };
const PREFIXO_DA_CAMADA_DA_EMPRESA = ".vega/camadas/empresa/";
const PROIBIDO_PREFIXO = [".agents/ciclo/", ".agents/estado/", ".serena/memories/"];
const PROIBIDO_SEGMENTO = ["notes", "sensivel"];
const EXTENSAO_PROIBIDA = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|svg|ico|pdf)$/i;

/** Linhas que contam: sem vazias e sem `#`. */
function linhasUteis(texto) {
  return texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

/** Entradas `{ origem, destino }`; diretório termina em `/` dos dois lados. */
export function lerLista(texto) {
  return linhasUteis(texto).map((linha) => {
    const partes = linha.split(" => ");
    if (partes.length > 2) throw new Error(`entrada com mais de um "=>": ${linha}`);
    const [origem, destino = origem] = partes.map((p) => p.trim());
    if (!origem || !destino) throw new Error(`entrada sem origem ou destino: ${linha}`);
    for (const p of [origem, destino]) {
      if (path.isAbsolute(p) || p.split("/").includes("..")) throw new Error(`caminho fora da raiz: ${linha}`);
    }
    if (origem.endsWith("/") !== destino.endsWith("/")) throw new Error(`diretório só de um lado: ${linha}`);
    return { origem, destino };
  });
}

/** Arquivos que o git vê (rastreados e novos não ignorados), relativos à raiz. */
function arquivosDaArvore(raiz) {
  const saida = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: raiz, encoding: "utf8" });
  return saida.split("\0").filter(Boolean).filter((f) => existsSync(path.join(raiz, f)));
}

/** Expande as entradas em pares `{ origem, destino }` de arquivo. Entrada sem arquivo lança. */
export function expandir(entradas, arquivos) {
  const pares = [];
  for (const { origem, destino } of entradas) {
    const casados = origem.endsWith("/")
      ? arquivos.filter((f) => f.startsWith(origem)).map((f) => ({ origem: f, destino: destino + f.slice(origem.length) }))
      : arquivos.includes(origem) ? [{ origem, destino }] : [];
    if (casados.length === 0) throw new Error(`entrada sem arquivo na árvore: ${origem}`);
    pares.push(...casados);
  }
  return pares;
}

/** O termo como palavra inteira, sem caixa: letra, dígito ou `_` nas bordas não deixam casar. */
export function casaTermo(termo) {
  const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapado}(?![\\p{L}\\p{N}_])`, "iu");
}

/** `arquivo:linha — termo` para cada achado; vazio = canário limpo. */
export function varrer(raiz, arquivos, termos) {
  const res = termos.map((t) => [t, casaTermo(t)]);
  const achados = [];
  for (const f of arquivos) {
    readFileSync(path.join(raiz, f), "utf8").split(/\r?\n/).forEach((linha, i) => {
      for (const [t, re] of res) if (re.test(linha)) achados.push(`${f}:${i + 1} — ${t}`);
    });
  }
  return achados;
}

/** Por que o caminho não pode sair, ou `null`. */
export function recusaDeCaminho(caminho, lista) {
  if (PROIBIDO_PREFIXO.some((p) => caminho.startsWith(p))) return "lugar de dado de paciente";
  const segmentos = caminho.split("/").slice(0, -1);
  if (PROIBIDO_SEGMENTO.some((s) => segmentos.includes(s))) return "lugar de dado de paciente";
  if (EXTENSAO_PROIBIDA.test(caminho)) return "imagem ou PDF";
  const dirs = `/${segmentos.join("/")}/`;
  if (dirs.includes("/camadas/os/")) return "camada do OS";
  if (lista === "corpo" && dirs.includes("/camadas/empresa/")) return "camada da empresa no corpo";
  if (caminho.startsWith(".vega/")) {
    const pode = [`.vega/vitrine/${lista}/`, ...(lista === "empresa" ? [PREFIXO_DA_CAMADA_DA_EMPRESA] : [])];
    if (!pode.some((p) => caminho.startsWith(p))) return "camada do OS";
  }
  return null;
}

function carregar(lista) {
  const arquivos = arquivosDaArvore(RAIZ);
  const entradas = lerLista(readFileSync(path.join(RAIZ, DECLARACAO.listas[lista]), "utf8"));
  return { entradas, pares: expandir(entradas, arquivos) };
}

describe("as listas do que sai, na fonte", { skip: fora }, () => {
  const LISTAS = ["corpo", "empresa"];
  const dados = NA_FONTE ? Object.fromEntries(LISTAS.map((l) => [l, carregar(l)])) : {};

  test("a declaração aponta as duas listas e elas existem", () => {
    for (const l of LISTAS) assert.ok(statSync(path.join(RAIZ, DECLARACAO.listas[l])).isFile(), `lista ${l} ausente`);
  });

  test("a lista do corpo leva o plugin inteiro e os modelos da vitrine", () => {
    const origens = dados.corpo.entradas.map((e) => e.origem);
    assert.ok(origens.includes(".claude/skills/vega/"), "o plugin inteiro não está na lista do corpo");
    for (const l of LISTAS) {
      const destinos = new Set(dados[l].pares.map((p) => p.destino));
      for (const d of ["README.md", "CONTRIBUTING.md", ".claude-plugin/marketplace.json"]) assert.ok(destinos.has(d), `${l} sem ${d}`);
    }
  });

  for (const l of LISTAS) {
    test(`${l}: os destinos não colidem`, () => {
      const vistos = new Map();
      for (const { origem, destino } of dados[l].pares) {
        assert.ok(!vistos.has(destino), `${destino}: ${vistos.get(destino)} e ${origem}`);
        vistos.set(destino, origem);
      }
    });

    test(`${l}: nenhum caminho é camada do OS nem lugar de dado de paciente`, () => {
      const caminhos = [...dados[l].entradas.map((e) => e.origem), ...dados[l].pares.map((p) => p.origem)];
      const recusados = caminhos.map((c) => [c, recusaDeCaminho(c, l)]).filter(([, r]) => r);
      assert.deepEqual(recusados, []);
      const pagina = DECLARACAO.conducao?.pagina;
      if (pagina) assert.ok(!caminhos.includes(pagina), `${pagina}: a página do projeto é camada do OS`);
    });

    test(`${l}: canário — nenhum arquivo contém termo do vocabulário proibido`, () => {
      const termos = linhasUteis(readFileSync(path.join(RAIZ, VOCABULARIO[l]), "utf8"));
      assert.ok(termos.length > 0, `vocabulário ${l} vazio`);
      assert.deepEqual(varrer(RAIZ, dados[l].pares.map((p) => p.origem), termos), []);
    });
  }

  test("as duas listas não se cruzam", () => {
    const corpo = new Set(dados.corpo.pares.map((p) => p.origem));
    assert.deepEqual(dados.empresa.pares.map((p) => p.origem).filter((o) => corpo.has(o)), []);
  });

  test("o vocabulário do corpo contém o da empresa", () => {
    const ler = (l) => linhasUteis(readFileSync(path.join(RAIZ, VOCABULARIO[l]), "utf8")).map((t) => t.toLowerCase());
    const corpo = new Set(ler("corpo"));
    assert.deepEqual(ler("empresa").filter((t) => !corpo.has(t)), []);
  });

  test("contraprova: o canário acusa um termo real do vocabulário plantado num arquivo", (t) => {
    const termo = linhasUteis(readFileSync(path.join(RAIZ, VOCABULARIO.corpo), "utf8"))[0];
    const dir = mkdtempSync(path.join(tmpdir(), "vega-listas-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(path.join(dir, "a.md"), `limpo\nantes ${termo.toUpperCase()} depois\n`);
    assert.deepEqual(varrer(dir, ["a.md"], [termo]), [`a.md:2 — ${termo}`]);
  });
});

describe("as regras das listas, sem a fonte", () => {
  test("a entrada lê arquivo, diretório e destino; recusa forma torta", () => {
    assert.deepEqual(lerLista("# x\n\na/b.md\nc/ => d/e/\nf.json => g/h.json\n"), [
      { origem: "a/b.md", destino: "a/b.md" },
      { origem: "c/", destino: "d/e/" },
      { origem: "f.json", destino: "g/h.json" },
    ]);
    assert.throws(() => lerLista("c/ => d.md"), /diretório só de um lado/);
    assert.throws(() => lerLista("../x"), /fora da raiz/);
    assert.throws(() => lerLista("a => b => c"), /mais de um/);
  });

  test("a expansão casa diretório por prefixo e recusa entrada sem arquivo", () => {
    const arv = ["p/a.mjs", "p/q/b.md", "pq/c.md", "r.md"];
    assert.deepEqual(expandir(lerLista("p/ => x/\nr.md => s.md"), arv), [
      { origem: "p/a.mjs", destino: "x/a.mjs" },
      { origem: "p/q/b.md", destino: "x/q/b.md" },
      { origem: "r.md", destino: "s.md" },
    ]);
    assert.throws(() => expandir(lerLista("z/"), arv), /sem arquivo/);
  });

  test("o termo casa como palavra inteira e sem caixa", () => {
    const re = casaTermo("termo-x.y");
    assert.ok(re.test("o TERMO-X.Y aqui"));
    assert.ok(re.test("`termo-x.y`"));
    assert.ok(!re.test("termo-x.yz"));
    assert.ok(!re.test("atermo-x.y"));
    assert.ok(!re.test("termo-xay"), "ponto é literal");
  });

  test("a recusa de caminho cobre dado de paciente, imagem, PDF e camadas", () => {
    for (const [c, l] of [
      [".agents/ciclo/x/y.md", "corpo"], ["a/notes/b.md", "corpo"], ["a/sensivel/b.md", "empresa"],
      [".serena/memories/m.md", "corpo"], [".agents/estado/e.json", "corpo"], ["a/b.PNG", "corpo"], ["a/b.pdf", "empresa"],
      [".vega/sistoli.mjs", "corpo"], [".vega/vitrine/empresa/README.md", "corpo"], [".vega/camadas/empresa/a.md", "corpo"],
      ["x/camadas/os/a.md", "empresa"],
    ]) assert.ok(recusaDeCaminho(c, l), `${c} (${l}) passou`);
    for (const [c, l] of [
      [".claude/skills/vega/references/camadas.md", "corpo"], [".vega/vitrine/corpo/README.md", "corpo"],
      [".vega/camadas/empresa/a.md", "empresa"], [".claude/skills/vega/exemplo/.vega/declaracao.json", "corpo"],
    ]) assert.equal(recusaDeCaminho(c, l), null, `${c} (${l}) recusado`);
  });
});
