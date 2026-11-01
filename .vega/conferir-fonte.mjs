#!/usr/bin/env node
// .claude/scripts/vega/vitrine/conferir-fonte.mjs — a vitrine confere que é a fonte filtrada (HN-29 T18).
//
// Sai da fonte para `.vega/conferir-fonte.mjs` de cada vitrine (`exportar.mjs`) e roda no CI dela
// (`.github/workflows/conferir-fonte.yml`), sem credencial nenhuma (D-HN29-13). Lê o
// `.vega/manifesto.json` que a exportação gravou e compara a árvore inteira da vitrine, por
// caminho e blob, nos dois sentidos: arquivo editado, a mais ou a menos reprova. Isenta só o
// próprio manifesto e `.git/`. Exige que o commit-fonte do manifesto seja o do trailer
// `Fonte-Sistoli:` do HEAD.
//
// Limites, declarados: o manifesto da T17 guarda blob, não modo, então trocar só o bit de
// execução passa aqui. E quem forja arquivo, manifesto, trailer e este próprio script de uma vez
// passa na vitrine: que o manifesto é a re-exportação daquele commit é conferido do lado da fonte
// (`exportar.mjs` antes de preparar e `__tests__/conferir-fonte.test.mjs`), onde a fonte está.
//
// Zero dependência: só `node:` e o `git` do runner.
// Uso: node .vega/conferir-fonte.mjs [raiz]   (raiz: a do repositório do diretório corrente)
// Saída: 0 intacta · 1 divergiu (cada caminho com o motivo) · 2 uso ou erro interno (fail-closed).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANIFESTO = ".vega/manifesto.json";
const TRAILER = "Fonte-Sistoli";
const SHA = /^[0-9a-f]{40}$/;

const blobDe = (buf) => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
const torto = (c) => !c || c.startsWith("/") || c.includes("\\") || c.split("/").some((s) => s === "" || s === "." || s === "..");

/** Cada arquivo sob `raiz`, fora de `.git` na raiz: `Map<caminho, blob | "link" | "especial">`. Diretório ilegível lança. */
function arvoreDe(raiz) {
  const out = new Map();
  const andar = (rel) => {
    for (const d of fs.readdirSync(path.join(raiz, ...rel.split("/").filter(Boolean)), { withFileTypes: true })) {
      const c = rel ? `${rel}/${d.name}` : d.name;
      if (!rel && d.name === ".git") continue;
      if (d.isSymbolicLink()) out.set(c, "link");
      else if (d.isDirectory()) andar(c);
      else if (d.isFile()) out.set(c, blobDe(fs.readFileSync(path.join(raiz, ...c.split("/")))));
      else out.set(c, "especial");
    }
  };
  andar("");
  return out;
}

/**
 * `{ divergencias: [caminho — motivo], erros: [linha] }`; os dois vazios = vitrine intacta.
 * Manifesto ausente ou torto vai para `erros` (reprova, exit 1); falha de leitura que não é
 * ausência lança (exit 2).
 */
export function conferir(raiz) {
  const erros = [];
  let bruto;
  try {
    bruto = fs.readFileSync(path.join(raiz, ...MANIFESTO.split("/")), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { divergencias: [], erros: [`${MANIFESTO} ausente: a vitrine não veio da exportação`] };
    throw e;
  }
  let m;
  try {
    m = JSON.parse(bruto);
  } catch {
    return { divergencias: [], erros: [`${MANIFESTO} ilegível (JSON inválido)`] };
  }
  if (m?.esquema !== 1) erros.push(`${MANIFESTO}: esquema ${JSON.stringify(m?.esquema)} desconhecido`);
  if (!SHA.test(String(m?.fonte))) erros.push(`${MANIFESTO}: commit-fonte ilegível`);
  const blobs = m?.arquivos && typeof m.arquivos === "object" && !Array.isArray(m.arquivos) ? new Map(Object.entries(m.arquivos)) : null;
  if (!blobs) erros.push(`${MANIFESTO}: sem arquivos`);
  else for (const [c, b] of blobs) if (torto(c) || c === MANIFESTO || typeof b !== "string" || !SHA.test(b)) erros.push(`${MANIFESTO}: caminho ou blob torto: ${c}`);
  if (erros.length) return { divergencias: [], erros };

  let doHead;
  try {
    // O bloco de trailers do git, não qualquer linha do corpo que comece com o nome.
    doHead = execFileSync("git", ["log", "-1", `--format=%(trailers:key=${TRAILER},valueonly)`, "HEAD"], { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return { divergencias: [], erros: ["sem HEAD legível no git da vitrine"] };
  }
  if (doHead.length === 0) erros.push(`o HEAD não traz o trailer ${TRAILER}: — é commit fora da exportação, e a mudança nasce na fonte`);
  else if (doHead.length > 1) erros.push(`o HEAD traz ${doHead.length} trailers ${TRAILER}:; a exportação grava exatamente 1`);
  else if (doHead[0] !== m.fonte) erros.push(`o ${TRAILER}: do HEAD (${doHead[0]}) não é o commit-fonte do manifesto (${m.fonte})`);

  const divergencias = [];
  const naArvore = arvoreDe(raiz);
  naArvore.delete(MANIFESTO);
  for (const [c, b] of naArvore) {
    if (!blobs.has(c)) divergencias.push(`${c} — a mais (fora da exportação)`);
    else if (b === "link") divergencias.push(`${c} — link simbólico`);
    else if (b === "especial") divergencias.push(`${c} — arquivo especial (não é arquivo comum)`);
    else if (b !== blobs.get(c)) divergencias.push(`${c} — editado depois da exportação`);
  }
  for (const c of blobs.keys()) if (!naArvore.has(c)) divergencias.push(`${c} — a menos (a exportação gravou, a vitrine não tem)`);
  return { divergencias: divergencias.sort(), erros };
}

/** Rodado como programa? Compara pelo caminho real, para um link simbólico não pular a conferência. */
function eOPrograma() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (eOPrograma()) {
  try {
    const arg = process.argv.slice(2);
    if (arg.length > 1 || arg[0]?.startsWith("-")) throw new Error("uso: node .vega/conferir-fonte.mjs [raiz]");
    const raiz = arg[0] ? path.resolve(arg[0]) : execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const { divergencias, erros } = conferir(raiz);
    if (erros.length || divergencias.length) {
      process.stderr.write(`conferir-fonte: REPROVADA — a vitrine não é a fonte filtrada\n${[...erros, ...divergencias].map((l) => `  ${l}\n`).join("")}`);
      process.exit(1);
    }
    process.stdout.write("conferir-fonte: vitrine intacta — a árvore é a do manifesto, e o manifesto é o do commit-fonte do HEAD\n");
    process.exit(0);
  } catch (e) {
    process.stderr.write(`conferir-fonte: ERRO — fail-closed: ${String(e && e.message ? e.message : e).split("\n")[0]}\n`);
    process.exit(2);
  }
}
