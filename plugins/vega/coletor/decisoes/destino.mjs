// .claude/scripts/decisoes/destino.mjs
// HN-29 T27 (AC-HN29-9, D-HN29-5a) — onde o coletor grava cada decisao: o que o `.vega/` do
// projeto de origem diz. Os tres extratores e o Stop hook `decisao-do-operador.mjs` leem daqui.
//
//   banco — o caminho de hoje: o extrator escreve o `decisoes.jsonl` para `estado.mjs decisao
//           gravar --arquivo`, e o hook chama o verbo em processo separado. O PHI-gate e o do verbo.
//   git   — o arquivo de decisoes do projeto (`decisoes.arquivo`, relativo a raiz dele), em JSON
//           Lines, so crescendo e idempotente pela `chave` (sha256 de fonte|item, a mesma do
//           banco). Esse caminho NAO passa pelo verbo, entao o PHI-gate de CPF/CNS roda aqui, na
//           escrita: cada folha da linha (texto, numero e nome de chave, como `folhasString` de
//           `estado/lib/phi.mjs`) pela primitiva de `../lib/varredura-phi-segredo.mjs` — nunca
//           `estado/lib/decisao.mjs` nem `estado/lib/phi.mjs`, que puxam o banco. Fail-closed:
//           primitiva que lanca descarta a linha e conta em `descartadas_phi`.
//
// Declaracao AUSENTE (so ENOENT) cai no comportamento de hoje (`banco`), e quem chama avisa.
// Presente e ilegivel, ou com destino desconhecido (`"Git"`, `"gti"`), lanca `ErroDestino`, e
// quem chama recusa com exit diferente de 0. Le o `.vega/declaracao.json` como JSON, sem o
// leitor do corpo (`skills/vega/scripts/vega/declaracao.mjs`): o extrator de conversas sai no
// corpo so com `decisoes/` e `lib/` (T44). As duas leituras aplicam a mesma regra aos campos
// que este modulo le — `decisoes` e `worktrees_de_ciclo`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { scanContent } from "../lib/varredura-phi-segredo.mjs";

export const DECLARACAO = path.join(".vega", "declaracao.json");
export const DESTINOS = Object.freeze(["banco", "git"]);

export class ErroDestino extends Error {
  constructor(message) {
    super(message);
    this.name = "ErroDestino";
  }
}

/** A primitiva de CPF/CNS sobre qualquer valor (`null` e numero inclusive): `{ line, kind }[]`. */
export function varrerPhi(texto) {
  return scanContent(String(texto ?? ""));
}

/** As folhas varriveis de um valor: string, numero e o NOME de cada chave (como `folhasString`). */
export function folhas(valor) {
  if (typeof valor === "string") return [valor];
  if (typeof valor === "number" || typeof valor === "bigint") return [String(valor)];
  if (Array.isArray(valor)) return valor.flatMap((v) => folhas(v));
  if (valor && typeof valor === "object") return Object.entries(valor).flatMap(([k, v]) => [k, ...folhas(v)]);
  return [];
}

/**
 * `true` = a linha tem CPF/CNS, ou a primitiva lancou (fail-closed). A `chave` fica de fora: e
 * hash hexadecimal derivado da fonte, que ja e varrida, e um trecho de 11 digitos dela casaria
 * CPF por acaso; `gravarNoGit` a recalcula, nunca grava a de quem chama.
 */
export function linhaComPhi(linha, varrer = varrerPhi) {
  const { chave: _chave, ...resto } = linha ?? {};
  for (const texto of folhas(resto)) {
    try {
      if (varrer(texto).length > 0) return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function chaveDe(fonte, item) {
  return createHash("sha256").update(`${fonte}|${item}`).digest("hex");
}

function caminhoRelativo(v, onde) {
  if (typeof v !== "string" || !v.trim()) throw new ErroDestino(`${onde}: esperado caminho relativo`);
  if (path.isAbsolute(v) || /^[A-Za-z]:/.test(v) || /^[\\/]/.test(v) || v.split(/[\\/]/).includes(".."))
    throw new ErroDestino(`${onde}: caminho fora da raiz (${v})`);
  return v;
}

function worktreesDe(v, onde) {
  if (v === undefined) return null;
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new ErroDestino(`${onde}: esperado objeto`);
  for (const k of Object.keys(v)) if (k !== "ramo" && k !== "pasta") throw new ErroDestino(`${onde}: campo desconhecido ${k}`);
  if (typeof v.ramo !== "string" || !v.ramo.trim()) throw new ErroDestino(`${onde}.ramo: esperado o prefixo do ramo de ciclo`);
  if (typeof v.pasta !== "string" || !v.pasta.trim() || /[\\/]/.test(v.pasta) || v.pasta === "." || v.pasta === "..")
    throw new ErroDestino(`${onde}.pasta: esperado o nome da pasta das worktrees de ciclo, sem barra`);
  return Object.freeze({ ramo: v.ramo, pasta: v.pasta });
}

/**
 * O destino que o projeto em `repo` declara:
 * `{ ausente, repo, declaracao, destino, arquivo, worktrees }` — `arquivo` absoluto so com `git`;
 * `worktrees` = `worktrees_de_ciclo` (`{ ramo, pasta }`) ou `null`.
 */
export function lerDestino(repo) {
  const raiz = path.resolve(repo);
  const declaracao = path.join(raiz, DECLARACAO);
  try {
    lstatSync(declaracao);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") {
      return Object.freeze({ ausente: true, repo: raiz, declaracao, destino: "banco", arquivo: null, worktrees: null });
    }
  }
  let bruto;
  try {
    bruto = JSON.parse(readFileSync(declaracao, "utf8"));
  } catch (e) {
    throw new ErroDestino(`${declaracao}: declaracao ilegivel (${e.code ?? e.message})`);
  }
  if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto)) throw new ErroDestino(`${declaracao}: esperado objeto`);
  const k = bruto.decisoes;
  if (k === null || typeof k !== "object" || Array.isArray(k)) throw new ErroDestino(`${declaracao}: decisoes: esperado objeto`);
  for (const c of Object.keys(k)) if (c !== "destino" && c !== "arquivo") throw new ErroDestino(`${declaracao}: decisoes: campo desconhecido ${c}`);
  if (!DESTINOS.includes(k.destino))
    throw new ErroDestino(`${declaracao}: decisoes.destino: esperado ${DESTINOS.join(" ou ")} (veio ${JSON.stringify(k.destino)})`);
  let arquivo = null;
  if (k.destino === "git") {
    if (k.arquivo === undefined) throw new ErroDestino(`${declaracao}: decisoes.arquivo: obrigatorio com destino git`);
    arquivo = path.join(raiz, caminhoRelativo(k.arquivo, `${declaracao}: decisoes.arquivo`));
  } else if (k.arquivo !== undefined) {
    throw new ErroDestino(`${declaracao}: decisoes.arquivo: so com destino git`);
  }
  const worktrees = worktreesDe(bruto.worktrees_de_ciclo, `${declaracao}: worktrees_de_ciclo`);
  return Object.freeze({ ausente: false, repo: raiz, declaracao, destino: k.destino, arquivo, worktrees });
}

/** A raiz do projeto de uma pasta: a primeira acima dela com `.git`. Pasta que nao existe ⇒ `null`. */
export function raizDoProjeto(pasta) {
  if (typeof pasta !== "string" || !pasta) return null;
  let d = path.resolve(pasta);
  try {
    if (!statSync(d).isDirectory()) return null;
  } catch {
    return null;
  }
  for (;;) {
    if (existsSync(path.join(d, ".git"))) return d;
    const acima = path.dirname(d);
    if (acima === d) return null;
    d = acima;
  }
}

/** A arvore principal de `repo` (a dona do `.git` comum, quando `repo` e worktree); sem git, `repo`. */
export function raizPrincipal(repo) {
  try {
    const comum = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return path.basename(comum) === ".git" ? path.dirname(comum) : path.resolve(repo);
  } catch {
    return path.resolve(repo);
  }
}

/**
 * Grava `linhas` no arquivo de decisoes do projeto (destino `git`). Devolve
 * `{ lidas, gravadas, ja_existiam, descartadas_phi }`; falha de escrita LANCA (quem chama avisa).
 * Nunca reescreve: le as chaves que o arquivo ja tem e acrescenta so as novas.
 */
export function gravarNoGit({ arquivo, linhas, varrer = varrerPhi }) {
  const existentes = new Set();
  let semFimDeLinha = false;
  if (existsSync(arquivo)) {
    const texto = readFileSync(arquivo, "utf8");
    semFimDeLinha = texto.length > 0 && !texto.endsWith("\n");
    let tortas = 0;
    for (const l of texto.split("\n")) {
      if (!l.trim()) continue;
      try {
        const o = JSON.parse(l);
        if (typeof o?.chave === "string") existentes.add(o.chave);
        else tortas++;
      } catch {
        tortas++;
      }
    }
    // Arquivo danificado (conflito de merge, linha cortada): a idempotencia nao vale sobre ele.
    if (tortas > 0) throw new Error(`${arquivo}: ${tortas} linha(s) ilegivel(is) — conserte o arquivo antes de gravar`);
  }
  const novas = [];
  let descartadas_phi = 0;
  let ja_existiam = 0;
  for (const bruta of linhas) {
    if (linhaComPhi(bruta, varrer)) {
      descartadas_phi++;
      continue;
    }
    // A chave sempre recalculada: a de quem chama nao passou pelo gate (e e a mesma conta).
    const { chave: _dada, ...resto } = bruta;
    const linha = { chave: chaveDe(bruta.fonte, bruta.item), ...resto };
    if (existentes.has(linha.chave)) {
      ja_existiam++;
      continue;
    }
    existentes.add(linha.chave);
    novas.push(linha);
  }
  if (novas.length > 0) {
    mkdirSync(path.dirname(arquivo), { recursive: true });
    appendFileSync(arquivo, (semFimDeLinha ? "\n" : "") + novas.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  return { lidas: linhas.length, gravadas: novas.length, ja_existiam, descartadas_phi };
}

/** Escapa texto para dentro de `RegExp`. */
export function escaparRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
