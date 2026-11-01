#!/usr/bin/env node
/**
 * versao-instalada.mjs — a abertura da sessão confere a fábrica instalada contra a declarada
 * (HN-29 T13, AC-HN29-7, AC-HN29-8).
 *
 * Lê `<repo>/.vega/declaracao.json` (`declaracao.mjs`) e o registro de instalações do host, e:
 *
 *   consumidor   para o corpo e, quando declarada, a camada da empresa: acha no registro a
 *                instalação DESTE projeto (`doProjeto`/`raizesDoProjeto` do pré-voo: o registro
 *                é da máquina e guarda os vizinhos) e lê a versão no `plugin.json` do
 *                `installPath`, nunca só no registro — o registro segue dizendo a versão velha
 *                depois que o cache dela some (medida de 30/10/2026, §2.2#16). Sem instalação,
 *                `plugin.json` ilegível ou versão diferente da declarada ⇒ recusa, citando a
 *                declarada e a instalada.
 *   fonte        roda a fábrica da própria árvore: recusa quando há instalação ativa da fábrica
 *                no projeto (o plugin do corpo ou o da camada da empresa; outro plugin, como o
 *                `harness-core` que segue instalado até o pós-merge, não conta). Ativa = no
 *                registro para este projeto e não desligada em `enabledPlugins` dos settings
 *                do projeto.
 *
 * Projeto sem `.vega/declaracao.json` não declarou a fábrica: sai 0 calado. Declaração ilegível
 * recusa. Cada projeto lê a própria declaração e a própria instalação: dois projetos no mesmo
 * registro, em versões diferentes, passam os dois (AC-HN29-8).
 *
 * Limites declarados: o gancho mora no `hooks.json` do corpo (decisão 19a), logo só roda com o
 * plugin carregado — consumidor sem a fábrica instalada não tem o que avisar, e o ramo "nenhuma
 * instalação deste projeto" serve a quem roda o check à mão. No `SessionStart` a saída 2 avisa e não
 * bloqueia: a sessão abre, com o motivo à vista. Instalação desligada em `enabledPlugins` dos settings
 * do projeto não conta, na fonte nem no consumidor.
 *
 * Uso (gancho `SessionStart`): `node versao-instalada.mjs [--repo <dir>] [--registro <arquivo>] [--json]`.
 * `--repo` default `CLAUDE_PROJECT_DIR` ou o cwd; `--registro` default
 * `<CLAUDE_CONFIG_DIR ou ~/.claude>/plugins/installed_plugins.json`.
 * Saída: 0 conferido (ou sem declaração); 2 recusa, com o motivo no stderr — falha alta, a sessão
 * abre avisada; `--json` imprime o resultado no stdout.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doProjeto, raizesDoProjeto } from "../conducao/pre-voo.mjs";
import { ErroDeclaracao, existe, lerDeclaracao } from "./declaracao.mjs";

/** O plugin de cada camada, como o registro o nomeia (`<nome>@<marketplace>`). */
export const PLUGINS = Object.freeze({ corpo: "vega", empresa: "sistoli-vega" });
export const SETTINGS = Object.freeze([".claude/settings.json", ".claude/settings.local.json"]);

export function registroPadrao(env = process.env) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"), "plugins", "installed_plugins.json");
}

/** `{ plugins: { "<nome>@<mkt>": [entrada] } }`; ausente ⇒ `null`; ilegível ⇒ erro com o arquivo. */
export function lerRegistro(arquivo) {
  let texto;
  try {
    texto = readFileSync(arquivo, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw new Error(`${arquivo}: registro do host ilegível (${e.code ?? e.message})`);
  }
  let j;
  try {
    j = JSON.parse(texto);
  } catch (e) {
    throw new Error(`${arquivo}: registro do host não é JSON (${e.message})`);
  }
  if (!j || typeof j !== "object" || !j.plugins || typeof j.plugins !== "object" || Array.isArray(j.plugins))
    throw new Error(`${arquivo}: registro do host sem o mapa plugins`);
  return j;
}

/** As entradas do registro do plugin `nome`, separadas em deste projeto e sem prova. */
function instalacoes(registro, nome, raizes, repo) {
  const deste = [];
  const duvidosas = [];
  for (const [id, lista] of Object.entries(registro?.plugins ?? {})) {
    if (id.split("@")[0] !== nome || !Array.isArray(lista)) continue;
    for (const e of lista) {
      if (!e || typeof e !== "object") continue;
      const quem = doProjeto(e, raizes, repo);
      if (quem.de === "deste") deste.push({ id, ...e });
      else if (quem.de === "duvidosa") duvidosas.push({ id, ...e, motivo: quem.motivo });
    }
  }
  return { deste, duvidosas };
}

/** A versão no `plugin.json` do `installPath`: `{ versao }` ou `{ erro }`. */
export function versaoNoInstallPath(installPath, repo = process.cwd()) {
  if (typeof installPath !== "string" || !installPath) return { erro: "entrada sem installPath" };
  const arquivo = path.resolve(repo, installPath, ".claude-plugin", "plugin.json");
  try {
    const v = JSON.parse(readFileSync(arquivo, "utf8"))?.version;
    if (typeof v !== "string" || !v) return { erro: `${arquivo} sem version` };
    return { versao: v };
  } catch (e) {
    return { erro: `${arquivo} ilegível (${e.code ?? e.message})` };
  }
}

/**
 * O `enabledPlugins` dos settings do projeto, o local por cima do compartilhado: `{ mapa, erros }`.
 * Settings ausente não desliga nada; ilegível vira erro, nunca mapa vazio calado.
 */
function ligadosNosSettings(repo) {
  const mapa = {};
  const erros = [];
  for (const rel of SETTINGS) {
    let texto;
    try {
      texto = readFileSync(path.join(repo, rel), "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") erros.push(`${rel} ilegível (${e.code ?? e.message})`);
      continue;
    }
    try {
      const j = JSON.parse(texto);
      if (j?.enabledPlugins && typeof j.enabledPlugins === "object") Object.assign(mapa, j.enabledPlugins);
    } catch (e) {
      erros.push(`${rel} não é JSON (${e.message})`);
    }
  }
  return { mapa, erros };
}

function conferirConsumidor(declaracao, registro, arquivoRegistro, raizes, repo) {
  const { mapa: ligados, erros } = ligadosNosSettings(repo);
  const problemas = [...erros];
  const conferidas = [];
  const camadas = [["corpo", declaracao.versao.corpo], ...(declaracao.versao.empresa ? [["empresa", declaracao.versao.empresa]] : [])];
  for (const [camada, declarada] of camadas) {
    const nome = PLUGINS[camada];
    const todas = instalacoes(registro, nome, raizes, repo);
    const deste = todas.deste.filter((e) => ligados[e.id] !== false);
    const { duvidosas } = todas;
    if (!deste.length) {
      const sem = duvidosas.length ? `; ${duvidosas.length} sem prova de serem deste projeto: ${[...new Set(duvidosas.map((d) => d.motivo))].join("; ")}` : "";
      problemas.push(`${nome} (${camada}): declarada ${declarada}, nenhuma instalação deste projeto em ${registro ? arquivoRegistro : `${arquivoRegistro} (ausente)`}${sem}`);
      continue;
    }
    for (const e of deste) {
      const lida = versaoNoInstallPath(e.installPath, repo);
      const doRegistro = e.version ? ` (o registro diz ${e.version})` : "";
      if (lida.erro) problemas.push(`${e.id} (${camada}): declarada ${declarada}, instalada ilegível: ${lida.erro}${doRegistro}`);
      else if (lida.versao !== declarada) problemas.push(`${e.id} (${camada}): declarada ${declarada}, instalada ${lida.versao} em ${e.installPath}${doRegistro}`);
      else conferidas.push({ id: e.id, camada, versao: lida.versao, installPath: e.installPath });
    }
  }
  return { problemas, conferidas };
}

function conferirFonte(registro, raizes, repo) {
  const { mapa: ligados, erros } = ligadosNosSettings(repo);
  const problemas = [...erros];
  for (const camada of Object.keys(PLUGINS)) {
    const { deste, duvidosas } = instalacoes(registro, PLUGINS[camada], raizes, repo);
    for (const e of [...deste, ...duvidosas]) {
      if (ligados[e.id] === false) continue;
      const sem = e.motivo ? ` — sem prova de ser deste projeto: ${e.motivo}` : "";
      problemas.push(`${e.id} (${camada}) instalado e ativo no projeto, em ${e.installPath ?? "?"}${sem}`);
    }
  }
  return { problemas, conferidas: [] };
}

/**
 * A conferência. `{ ok, papel, conferidas, problemas }`; `{ ok: true, papel: null }` sem declaração.
 * Lança só em registro ilegível; declaração ilegível sai como problema.
 */
export function conferir({ repo, registro: arquivoRegistro, env = process.env } = {}) {
  const raiz = path.resolve(repo ?? env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (!existe(raiz)) return { ok: true, papel: null, conferidas: [], problemas: [] };
  let declaracao;
  try {
    ({ declaracao } = lerDeclaracao(raiz));
  } catch (e) {
    if (!(e instanceof ErroDeclaracao)) throw e;
    return { ok: false, papel: null, conferidas: [], problemas: [e.message] };
  }
  const arquivo = arquivoRegistro ?? registroPadrao(env);
  const registro = lerRegistro(arquivo);
  const raizes = raizesDoProjeto(raiz, { env });
  const r = declaracao.papel === "fonte" ? conferirFonte(registro, raizes, raiz) : conferirConsumidor(declaracao, registro, arquivo, raizes, raiz);
  return { ok: r.problemas.length === 0, papel: declaracao.papel, ...r };
}

function main(argv) {
  const arg = (nome) => {
    const i = argv.indexOf(nome);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  let r;
  try {
    r = conferir({ repo: arg("--repo"), registro: arg("--registro") });
  } catch (e) {
    r = { ok: false, papel: null, conferidas: [], problemas: [e.message] };
  }
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(r)}\n`);
  if (r.ok) return 0;
  const cabeca =
    r.papel === "fonte"
      ? "versao-instalada: este projeto é a fonte da fábrica e roda da própria árvore, mas tem a fábrica instalada:"
      : "versao-instalada: a fábrica instalada não é a declarada em .vega/declaracao.json:";
  process.stderr.write(`${[cabeca, ...r.problemas.map((p) => `  - ${p}`)].join("\n")}\n`);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
