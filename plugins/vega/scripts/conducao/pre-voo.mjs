/**
 * pre-voo.mjs — o pré-voo da condução (VEGA-29 T30, D-VEGA29-15, AC-VEGA29-12).
 *
 * Antes de abrir filha, quem conduz confere o host em que a condução vai rodar:
 *
 *   plugin-carregado   a CLI do host (`sessao.cli`, argv sem shell, na raiz do projeto)
 *                      lista o plugin da condução ligado; ou, quando a lista não o
 *                      prova (a sessão fora da raiz do projeto, VEGA-37 T50), o
 *                      processo da sessão traz a raiz deste plugin no argv: o
 *                      primeiro ancestral cujo executável é o binário de
 *                      `sessao.cli[0]` no PATH, e nenhum acima dele (`pluginNaSessao`)
 *   instalacao-unica   o plugin aparece uma vez só na lista, e nenhum `settings` do
 *                      projeto (`sessao.settings`) registra um hook do plugin à mão;
 *                      entrada de escopo de projeto com `projectPath` de OUTRO projeto
 *                      não conta (nem aqui nem em `plugin-carregado`): a lista do host
 *                      é da máquina, e a instalação de um vizinho não é deste projeto,
 *                      e por isso sai citada no encontrado das duas; sem como provar
 *                      de quem é (git mudo, caminho que não resolve, entrada que não é
 *                      de usuário sem `projectPath` e fora da árvore), a entrada conta
 *                      como duplicata aqui e não prova o plugin ligado em
 *                      `plugin-carregado` — nos dois, o lado que recusa
 *   ponte-com-restart  `systemctl --user show <sessao.ponte.unidade>` dá `Restart` ≠ `no`;
 *                      sem a unidade declarada sai `nao-declarada`, como aviso
 *   trafego-ligado     a variável que desliga o tráfego não essencial
 *                      (`sessao.variavelDoTrafego`) não está definida no ambiente do
 *                      processo nem no `env` de um `settings`
 *
 * Alguma falha ⇒ pergunta tipada (`motivo: "pre-voo"`) com `{ conferencia,
 * encontrado, remedio }` por falha, e nenhuma filha abre. Tudo verde ⇒
 * `{ acao: "pre-voo", ok: true, conferencias, avisos }`.
 *
 * Aviso de tier, com `--ciclo`: o plano no HEAD diz o tier de cada tarefa
 * (`**Tier:**`, ou o da fase; default `inherit`). Tarefa que pede julgamento —
 * fechamento de fase ou review-gate, conferência do operador, ou classe
 * sensível — e resolve para `mecanico` sai em `avisos` com `{ task, tier,
 * modelo }`, sem parar. Tarefa comum em `mecanico` não avisa: o barato basta.
 *
 * Herdeira (VEGA-37 T17, AC-VEGA37-8), com `--herdeira` (exige `--ciclo`): a
 * sessão que herdou a condução por passagem confere, ao lado das quatro do host,
 * as três da partida (`CONFERENCIAS_DA_HERDEIRA`), depois do `passar-posse` e da
 * inscrição:
 *
 *   arvore-na-ponta    o HEAD está anexado ao ramo da marca de passagem
 *                      (`Conducao-Ramo`) e descende dela
 *   epoca-da-posse     a posse, pelo leitor da cerca, é desta árvore com a época
 *                      da nota + 1, e a época gravada no git-dir é a mesma
 *   inscricao-feita    `entrada.inscrita` é `true`, ou o projeto não tem proposta
 *                      (`ci: false` na declaração, o mesmo modo da T9), com o pulo
 *
 * A passagem lida é a aberta no HEAD, ou a que a última `confirmada` confirma.
 *
 * O núcleo não nomeia host, ponte, modelo nem fornecedor: o binário, os
 * arquivos de configuração, a variável, a unidade e o mapa tier → modelo vêm
 * da declaração (v5). Toda execução externa vai por `spawnSync` sem shell, com
 * prazo; comando ausente vira falha com remédio, nunca exceção crua.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants as FS, existsSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import * as adaptador from "./adaptador.mjs";
import { lerPosseDaCerca, passagemAberta } from "./git-conducao.mjs";
import { tentarGit } from "./git-exec.mjs";
import { ErroPlano, lerPlanoNoCommit } from "./ler-plano.mjs";
import { lerMarcas } from "./marcas.mjs";
import * as pergunta from "./pergunta.mjs";
import { casoDeConferencia } from "./verbos.mjs";

/** O nome do plugin da condução, como o host o lista (`<nome>@<marketplace>`). */
export const NOME_DO_PLUGIN = "vega";
export const PRAZO_MS = 15_000;
export const CONFERENCIAS = Object.freeze(["plugin-carregado", "instalacao-unica", "ponte-com-restart", "trafego-ligado"]);
/** As conferências da partida da herdeira (VEGA-37 T17), ao lado das quatro do host. */
export const CONFERENCIAS_DA_HERDEIRA = Object.freeze(["arvore-na-ponta", "epoca-da-posse", "inscricao-feita"]);
/** Marcas do `satisfies` que fazem da tarefa um fechamento ou um gate: pedem julgamento. */
const MARCAS_DE_JULGAMENTO = Object.freeze(["fechamento-de-fase", "review-gate"]);
const HOOKS_DO_PLUGIN = path.join(adaptador.RAIZ_DO_PLUGIN, "hooks", "hooks.json");
const SCRIPT_RE = /[\w.-]+\.(?:js|mjs|cjs)\b/g;

/** Roda `argv` sem shell, com prazo; `{ ok, stdout }` ou `{ ok: false, encontrado, ausente }`. */
export function rodar(argv, { cwd, env, prazoMs = PRAZO_MS }) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: "utf8", timeout: prazoMs, shell: false, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 });
  const linha = argv.join(" ");
  if (r.error?.code === "ENOENT") return { ok: false, ausente: true, encontrado: `comando ausente: ${argv[0]}` };
  if (r.error?.code === "ETIMEDOUT" || (r.signal && !r.error)) return { ok: false, encontrado: `sem resposta em ${prazoMs} ms: ${linha}` };
  if (r.error) return { ok: false, encontrado: `${linha}: ${r.error.code ?? r.error.message}` };
  if (r.status !== 0) return { ok: false, encontrado: `${linha} saiu ${r.status}${r.stderr?.trim() ? `: ${r.stderr.trim().slice(0, 200)}` : ""}` };
  return { ok: true, stdout: r.stdout };
}

const conferida = (conferencia, estado, encontrado, remedio = null) => ({ conferencia, estado, encontrado, ...(remedio ? { remedio } : {}) });
const naoDeclarado = (conferencia, campo) =>
  conferida(conferencia, "falha", `${campo} não declarado`, `declarar ${campo} (versão 5 do esquema) no adaptador do projeto (campo conducao de .vega/declaracao.json, ou .altair/adaptador.json)`);

/**
 * As raízes que contam como "este projeto" para o `projectPath` da lista: a árvore
 * conduzida e, quando ela é worktree, a árvore principal do mesmo repositório (o
 * host grava a instalação de projeto contra a principal). A principal é o
 * `core.worktree` do diretório comum do git quando ele o declara (submódulo, onde o
 * diretório comum é `.git/modules/<nome>` do repositório de cima e nem o pai dele nem
 * `git worktree list` dão a árvore), e o pai do `--git-common-dir` quando não. `inconclusivo`
 * traz o motivo quando o git não disse qual é a principal (ou um caminho não
 * resolveu): aí a entrada com `projectPath` fora da própria árvore conduzida fica
 * duvidosa (`doProjeto`).
 */
export function raizesDoProjeto(repo, { env, prazoMs } = {}) {
  const raizes = new Set([path.resolve(repo)]);
  try {
    raizes.add(realpathSync(repo));
  } catch (e) {
    return { raizes, inconclusivo: `a raiz do projeto não resolve (${e.code ?? e.message})` };
  }
  const r = rodar(["git", "-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"], { env, prazoMs });
  if (!r.ok) return { raizes, inconclusivo: `o git não disse a árvore principal (${r.encontrado})` };
  const comum = r.stdout.trim();
  if (!comum) return { raizes, inconclusivo: "o git não disse a árvore principal (resposta vazia)" };
  const w = rodar(["git", `--git-dir=${comum}`, "config", "--default", "", "--get", "core.worktree"], { env, prazoMs });
  if (!w.ok) return { raizes, inconclusivo: `o git não disse a árvore principal (${w.encontrado})` };
  const principal = w.stdout.trim() ? path.resolve(comum, w.stdout.trim()) : path.dirname(comum);
  raizes.add(principal);
  try {
    raizes.add(realpathSync(principal));
  } catch (e) {
    return { raizes, inconclusivo: `a árvore principal não resolve (${e.code ?? e.message})` };
  }
  return { raizes, inconclusivo: null };
}

/** `alvo` é uma das raízes ou fica dentro de uma delas. */
function dentroDe(raizes, alvo) {
  for (const r of raizes) if (alvo === r || alvo.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) return true;
  return false;
}

/**
 * De quem é a entrada: `{ de: "deste" }` com `projectPath` numa das raízes, ou sem
 * ele quando é de usuário (vale em todo projeto) ou quando o `installPath` fica
 * dentro da árvore (a pasta de skills do projeto); `{ de: "outro" }` com
 * `projectPath` resolvido fora das raízes; `{ de: "duvidosa", motivo }` quando não
 * dá para provar nem um nem outro: entrada de projeto sem `projectPath` e fora da
 * árvore, raízes inconclusivas, `projectPath` que não resolve no disco. Relativo
 * resolve contra `repo`.
 *
 * A duvidosa vai para o lado que recusa em cada conferência: conta como segunda
 * instalação em `instalacao-unica` e não prova o plugin ligado em `plugin-carregado`.
 */
export function doProjeto(entrada, { raizes, inconclusivo }, repo) {
  const p = entrada?.projectPath;
  if (p === undefined || p === null || p === "") {
    if (entrada?.scope === "user") return { de: "deste" };
    const instalado = typeof entrada?.installPath === "string" && entrada.installPath ? path.resolve(repo, entrada.installPath) : null;
    if (instalado) {
      if (dentroDe(raizes, instalado)) return { de: "deste" };
      try {
        if (dentroDe(raizes, realpathSync(instalado))) return { de: "deste" };
      } catch {
        // installPath que não resolve: segue para a duvidosa abaixo.
      }
    }
    return { de: "duvidosa", motivo: `entrada de escopo ${entrada?.scope ?? "?"} sem projectPath e fora da árvore do projeto${instalado ? ` (${entrada.installPath})` : ""}` };
  }
  if (typeof p !== "string") return { de: "duvidosa", motivo: `projectPath inválido (${JSON.stringify(p)})` };
  const absoluto = path.resolve(repo, p);
  if (raizes.has(absoluto)) return { de: "deste" };
  if (inconclusivo) return { de: "duvidosa", motivo: inconclusivo };
  try {
    return raizes.has(realpathSync(absoluto)) ? { de: "deste" } : { de: "outro", projectPath: absoluto };
  } catch (e) {
    return { de: "duvidosa", motivo: `projectPath ${p} não resolve (${e.code ?? e.message})` };
  }
}

/**
 * A lista de plugins do host: `{ entradas, duvidosas, outros }` (as do plugin da
 * condução: as provadas deste projeto, as que não deu para provar, com o motivo, e
 * os `projectPath` das descartadas por serem de outro projeto) ou `{ erro }`.
 */
function lerLista(decl, { repo, env, prazoMs }) {
  const r = rodar(decl.sessao.cli, { cwd: repo, env, prazoMs });
  if (!r.ok) return { erro: r.encontrado, ausente: r.ausente };
  let lista;
  try {
    lista = JSON.parse(r.stdout);
  } catch (e) {
    return { erro: `${decl.sessao.cli.join(" ")} não devolveu JSON (${e.message})` };
  }
  if (!Array.isArray(lista)) return { erro: `${decl.sessao.cli.join(" ")} não devolveu lista` };
  const nome = (e) => String(e?.name ?? e?.id ?? "").split("@")[0];
  const raizes = raizesDoProjeto(repo, { env, prazoMs });
  const entradas = [];
  const duvidosas = [];
  const outros = [];
  for (const e of lista) {
    if (!e || typeof e !== "object" || nome(e) !== NOME_DO_PLUGIN) continue;
    const quem = doProjeto(e, raizes, repo);
    if (quem.de === "deste") entradas.push(e);
    else if (quem.de === "duvidosa") duvidosas.push({ entrada: e, motivo: quem.motivo });
    else outros.push(quem.projectPath);
  }
  return { entradas, duvidosas, outros: [...new Set(outros)] };
}

const motivosDe = (duvidosas) => [...new Set(duvidosas.map((d) => d.motivo))].join("; ");
/** O sufixo que cita as instalações descartadas por serem de outro projeto. */
const descartadas = (lista) => (lista.outros?.length ? ` — descartada(s) por ser(em) de outro projeto: ${lista.outros.join(", ")}` : "");

/** `nome` resolvido pelo PATH de `env` até o arquivo real, ou `null`. */
function binarioNoPath(nome, env) {
  const candidatos = nome.includes("/") ? [nome] : String(env.PATH ?? "").split(path.delimiter).filter(Boolean).map((d) => path.join(d, nome));
  for (const c of candidatos) {
    try {
      accessSync(c, FS.X_OK);
      return realpathSync(c);
    } catch {
      // não executável aqui: tenta o próximo diretório do PATH.
    }
  }
  return null;
}

/**
 * Os ancestrais de `pid` pelo `/proc`, do pai para cima: `[{ pid, exe, argv, cwd }]`
 * (campo que não deu para ler sai `null`). Sem `/proc` (outro sistema), lista vazia.
 */
export function ancestrais(pid = process.ppid, { raizProc = "/proc", limite = 64 } = {}) {
  const out = [];
  let atual = pid;
  while (atual > 1 && out.length < limite) {
    const base = path.join(raizProc, String(atual));
    let stat;
    try {
      stat = readFileSync(path.join(base, "stat"), "utf8");
    } catch {
      break;
    }
    const ler = (f) => {
      try {
        return f();
      } catch {
        return null;
      }
    };
    const argv = ler(() => readFileSync(path.join(base, "cmdline"), "utf8").replace(/\0$/, "").split("\0"));
    out.push({ pid: atual, exe: ler(() => readlinkSync(path.join(base, "exe"))), argv: argv ?? [], cwd: ler(() => readlinkSync(path.join(base, "cwd"))) });
    const pai = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    if (!Number.isInteger(pai) || pai === atual) break;
    atual = pai;
  }
  return out;
}

/**
 * O plugin chegou à sessão em que o pré-voo roda? A sessão é o primeiro ancestral
 * cujo executável é o binário de `sessao.cli[0]` no PATH (o host que lista os
 * plugins é o mesmo que roda a sessão); um ancestral acima dele é OUTRA sessão e não
 * conta. O plugin chegou quando um argumento dela (inteiro, ou o valor depois de
 * `=`) resolve, contra o cwd dela, à raiz deste plugin. `{ pid, argumento }` ou
 * `{ motivo }`.
 */
export function pluginNaSessao(decl, { env = process.env, lerAncestrais = ancestrais, raizDoPlugin = adaptador.RAIZ_DO_PLUGIN } = {}) {
  const bin = decl.sessao.cli ? binarioNoPath(decl.sessao.cli[0], env) : null;
  if (!bin) return { motivo: "binário do host fora do PATH" };
  let raiz;
  try {
    raiz = realpathSync(raizDoPlugin);
  } catch {
    return { motivo: "a raiz do plugin não resolve" };
  }
  const sessao = lerAncestrais().find((p) => {
    try {
      return p.exe && realpathSync(p.exe) === bin;
    } catch {
      return false;
    }
  });
  if (!sessao) return { motivo: "nenhum processo ancestral é a sessão do host" };
  for (const a of sessao.argv.slice(1)) {
    for (const v of [a, a.includes("=") ? a.slice(a.indexOf("=") + 1) : null]) {
      if (!v) continue;
      try {
        if (realpathSync(path.resolve(sessao.cwd ?? "/", v)) === raiz) return { pid: sessao.pid, argumento: a };
      } catch {
        // argumento que não é caminho: segue.
      }
    }
  }
  return { motivo: `a sessão do host (pid ${sessao.pid}) não recebeu ${raiz}` };
}

function pluginCarregado(decl, lista, naSessao = () => ({ motivo: "não conferido" })) {
  const C = "plugin-carregado";
  if (!decl.sessao.cli) return naoDeclarado(C, "sessao.cli");
  const comando = decl.sessao.cli.join(" ");
  if (lista.erro)
    return conferida(C, "falha", lista.erro, lista.ausente ? `instalar a CLI do host, ou corrigir sessao.cli na declaração (${comando})` : `rodar ${comando} na raiz do projeto e corrigir o que ela diz`);
  const ligadas = lista.entradas.filter((e) => e.enabled !== false);
  if (ligadas.length) return conferida(C, "ok", `${NOME_DO_PLUGIN} ligado (${ligadas.map((e) => e.scope ?? "?").join(", ")})${descartadas(lista)}`);
  const duvidosasLigadas = lista.duvidosas.filter((d) => d.entrada.enabled !== false);
  if (duvidosasLigadas.length)
    return conferida(C, "falha", `${NOME_DO_PLUGIN} ligado só em instalação que não deu para provar deste projeto: ${motivosDe(duvidosasLigadas)}${descartadas(lista)}`, `corrigir o que impediu a prova (${motivosDe(duvidosasLigadas)}) e conferir com ${comando}`);
  const s = naSessao();
  if (s.pid) return conferida(C, "ok", `${NOME_DO_PLUGIN} chegou à sessão do host (pid ${s.pid}, argumento ${s.argumento}) e não à lista de ${comando}${descartadas(lista)}`);
  const foraDaRaiz = `; fora da raiz do projeto, passar a pasta do plugin (${adaptador.RAIZ_DO_PLUGIN}) à sessão na linha de comando de ${decl.sessao.cli[0]} (${s.motivo})`;
  if (lista.entradas.length)
    return conferida(C, "falha", `${NOME_DO_PLUGIN} instalado e desligado (${lista.entradas.map((e) => e.scope ?? "?").join(", ")})${descartadas(lista)}`, `ligar o plugin ${NOME_DO_PLUGIN} no projeto e conferir com ${comando}${foraDaRaiz}`);
  return conferida(C, "falha", `${NOME_DO_PLUGIN} fora da lista de ${comando}${descartadas(lista)}`, `instalar o plugin ${NOME_DO_PLUGIN} pelo marketplace, ligá-lo no projeto e conferir com ${comando}${foraDaRaiz}`);
}

/** Os `settings` declarados que existem: `[{ rel, json }]`, ou `{ erro }` no primeiro ilegível. */
function lerSettings(decl, repo) {
  const lidos = [];
  for (const rel of decl.sessao.settings) {
    const arquivo = path.join(repo, rel);
    if (!existsSync(arquivo)) continue;
    try {
      lidos.push({ rel, json: JSON.parse(readFileSync(arquivo, "utf8")) });
    } catch (e) {
      return { erro: `${rel} ilegível (${e.message})`, rel };
    }
  }
  return { lidos };
}

/** Todo `command` (texto) sob `hooks` de um settings, em qualquer profundidade. */
function comandosDeHook(no, out = []) {
  if (Array.isArray(no)) for (const x of no) comandosDeHook(x, out);
  else if (no && typeof no === "object")
    for (const [k, v] of Object.entries(no)) {
      if (k === "command" && typeof v === "string") out.push(v);
      else comandosDeHook(v, out);
    }
  return out;
}

/** Os `command` de `hooks/hooks.json` do plugin e os scripts que eles chamam. */
function hooksDoPlugin() {
  const comandos = comandosDeHook(JSON.parse(readFileSync(HOOKS_DO_PLUGIN, "utf8")).hooks);
  return { comandos, scripts: [...new Set(comandos.flatMap((c) => c.match(SCRIPT_RE) ?? []))] };
}

function instalacaoUnica(decl, lista, settings) {
  const C = "instalacao-unica";
  if (!decl.sessao.settings.length) return naoDeclarado(C, "sessao.settings");
  if (settings.erro) return conferida(C, "falha", settings.erro, `corrigir o JSON de ${settings.rel}`);
  const problemas = [];
  const todas = lista.erro ? [] : [...lista.entradas, ...lista.duvidosas.map((d) => d.entrada)];
  if (todas.length > 1)
    problemas.push(
      `${todas.length} instalações de ${NOME_DO_PLUGIN} (${todas.map((e) => e.scope ?? "?").join(", ")})${lista.duvidosas.length ? ` — ${lista.duvidosas.length} sem prova de serem deste projeto: ${motivosDe(lista.duvidosas)}` : ""}`,
    );
  const { comandos, scripts } = hooksDoPlugin();
  for (const { rel, json } of settings.lidos) {
    const doPlugin = comandosDeHook(json?.hooks).filter((c) => comandos.includes(c) || scripts.some((s) => (c.match(SCRIPT_RE) ?? []).includes(s)));
    if (doPlugin.length) problemas.push(`${rel} registra hook do plugin: ${[...new Set(doPlugin)].join(" · ")}`);
  }
  if (problemas.length)
    return conferida(C, "falha", `${problemas.join("; ")}${lista.erro ? "" : descartadas(lista)}`, `deixar uma instalação só do plugin e tirar dos settings do projeto os hooks que o plugin já registra`);
  if (lista.erro) return conferida(C, "ok", "settings sem hook do plugin (lista do host não lida)");
  const duvida = lista.duvidosas.length ? ` (${lista.duvidosas.length} sem prova de ser deste projeto: ${motivosDe(lista.duvidosas)})` : "";
  return conferida(C, "ok", `${lista.entradas.length + lista.duvidosas.length} instalação(ões) na lista${duvida}, settings sem hook do plugin${descartadas(lista)}`);
}

/** `systemctl --user show <unidade> -p Restart -p LoadState` → `Restart` ≠ `no`. */
function ponteComRestart(decl, { env, prazoMs }) {
  const C = "ponte-com-restart";
  const unidade = decl.sessao.ponte?.unidade;
  if (!unidade) return conferida(C, "nao-declarada", "sessao.ponte.unidade não declarada", "declarar sessao.ponte.unidade para conferir a ponte");
  const r = rodar(["systemctl", "--user", "show", unidade, "-p", "Restart", "-p", "LoadState"], { env, prazoMs });
  if (!r.ok) return conferida(C, "falha", r.encontrado, r.ausente ? "rodar a condução numa máquina com systemd de usuário, ou tirar sessao.ponte da declaração" : `conferir a unidade com systemctl --user status ${unidade}`);
  const props = Object.fromEntries(
    r.stdout
      .split("\n")
      .map((l) => /^([A-Za-z]+)=(.*)$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim()]),
  );
  if (props.LoadState === "not-found") return conferida(C, "falha", `${unidade} não existe (LoadState=not-found)`, `instalar a unidade ${unidade} ou corrigir sessao.ponte.unidade`);
  const restart = props.Restart ?? "";
  if (!restart || restart === "no")
    return conferida(C, "falha", `${unidade} com Restart=${restart || "(vazio)"}`, `systemctl --user edit ${unidade} com [Service] Restart=always, depois systemctl --user daemon-reload e restart da unidade`);
  return conferida(C, "ok", `${unidade} com Restart=${restart}`);
}

function trafegoLigado(decl, settings, env) {
  const C = "trafego-ligado";
  const v = decl.sessao.variavelDoTrafego;
  if (!v) return naoDeclarado(C, "sessao.variavelDoTrafego");
  if (!decl.sessao.settings.length) return naoDeclarado(C, "sessao.settings");
  if (settings.erro) return conferida(C, "falha", settings.erro, `corrigir o JSON de ${settings.rel}`);
  const onde = [];
  if (env[v] !== undefined) onde.push("no ambiente do processo");
  for (const { rel, json } of settings.lidos)
    if (json?.env && typeof json.env === "object" && Object.hasOwn(json.env, v)) onde.push(`no env de ${rel}`);
  if (onde.length)
    return conferida(C, "falha", `${v} definida ${onde.join(" e ")}`, `tirar ${v} do ambiente da sessão (perfil do shell, unidade da ponte) e do env dos settings do projeto`);
  return conferida(C, "ok", `${v} ausente`);
}

// ── partida da herdeira (VEGA-37 T17) ────────────────────────────────────────

/**
 * A passagem que esta árvore herdou, pelas marcas do HEAD: a aberta, ou a que a
 * última `confirmada` confirma. `null` sem nenhuma das duas.
 */
export function passagemDaHerdeira(marcas) {
  const aberta = passagemAberta(marcas);
  if (aberta) return aberta;
  const c = marcas.findLast((m) => m.tipo === "confirmada" || m.tipo === "desistida");
  if (c?.tipo !== "confirmada" || !c.confirma) return null;
  return marcas.find((m) => m.tipo === "passagem" && m.sha === c.confirma) ?? null;
}

const epocaDe = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
};

function arvoreNaPonta(repo, p) {
  const C = "arvore-na-ponta";
  if (!p) return conferida(C, "falha", "nenhuma passagem aberta nem confirmada no HEAD", "rodar o trazer-ramo do prompt da herdeira, na árvore desta sessão");
  if (!p.ramo) return conferida(C, "falha", `a marca de passagem ${p.sha.slice(0, 8)} não traz o ramo (Conducao-Ramo)`, "o operador confere o ramo do ciclo e o traz à mão");
  const ramo = tentarGit(repo, ["symbolic-ref", "--short", "-q", "HEAD"]).saida;
  if (ramo !== p.ramo)
    return conferida(C, "falha", `o HEAD está ${ramo ? `em ${ramo}` : "destacado"}, não em ${p.ramo}`, `rodar o trazer-ramo do prompt da herdeira (git switch ${p.ramo})`);
  const anc = tentarGit(repo, ["merge-base", "--is-ancestor", p.sha, "HEAD"]);
  if (anc.status !== 0) return conferida(C, "falha", `o HEAD de ${p.ramo} não descende da passagem ${p.sha.slice(0, 8)}`, "parar: o ramo não é o que a anterior passou — o operador decide");
  return conferida(C, "ok", `${p.ramo} anexado, descendendo da passagem ${p.sha.slice(0, 8)}`);
}

function epocaDaPosse(repo, p, lerPosse, ciclo) {
  const C = "epoca-da-posse";
  const daNota = epocaDe(p?.epoca);
  if (!daNota) return conferida(C, "falha", p ? `a marca de passagem ${p.sha.slice(0, 8)} não traz época legível (${JSON.stringify(p.epoca ?? null)})` : "sem passagem, sem época da nota", "o operador confere a nota de passagem");
  let posse;
  try {
    posse = lerPosse(repo, ciclo);
  } catch (e) {
    posse = { estado: "nao-li", motivo: e.message };
  }
  if (posse?.estado !== "dona")
    return conferida(C, "falha", `posse ${posse?.estado ?? "não declarada"}${posse?.motivo ? ` (${posse.motivo})` : ""}; época da nota ${daNota}`, `rodar o passar-posse que o proximo emite, com o lock_id e a época ${daNota} da nota`);
  const esperada = daNota + 1;
  if (posse.epoca !== esperada) {
    const remedio = Number.isSafeInteger(posse.epoca) && posse.epoca > esperada ? "parar: a posse passou de novo depois desta nota, e a dona é outra sessão — avisar o operador" : `rodar o passar-posse com a época ${daNota} da nota`;
    return conferida(C, "falha", `época da posse ${JSON.stringify(posse.epoca ?? null)}, esperada ${esperada} (a da nota, ${daNota}, + 1)`, remedio);
  }
  if (Object.hasOwn(posse, "epoca_gravada") && posse.epoca_gravada !== posse.epoca)
    return conferida(C, "falha", `época gravada no git-dir ${posse.epoca_gravada}, a da posse ${posse.epoca}`, "regravar o cache pelo passar-posse (o RETURNING dá o par)");
  return conferida(C, "ok", `dona na época ${posse.epoca} (a da nota, ${daNota}, + 1)`);
}

function inscricaoFeita(temCi, entrada) {
  const C = "inscricao-feita";
  if (!temCi) return conferida(C, "ok", "projeto sem proposta: inscrição pulada (projeto-sem-proposta)");
  if (entrada?.inscrita === true) return conferida(C, "ok", "inscrita na proposta do ramo");
  return conferida(C, "falha", "a herdeira não disse que se inscreveu na proposta", 'chamar subscribe_pr_activity na proposta do ramo e rodar o pré-voo com --entrada \'{"inscrita":true}\'');
}

/**
 * As três conferências da partida da herdeira, na ordem de
 * `CONFERENCIAS_DA_HERDEIRA`. `lerPosse` é o leitor da cerca (o da declaração,
 * ou o do teste); `temCi` é `ci !== false` da declaração.
 */
export function conferenciasDaHerdeira({ repo, ciclo = null, entrada = {}, temCi = true, lerPosse = lerPosseDaCerca, marcas = lerMarcas(repo) }) {
  const p = passagemDaHerdeira(marcas);
  return { passagem: p, conferencias: [arvoreNaPonta(repo, p), epocaDaPosse(repo, p, lerPosse, ciclo), inscricaoFeita(temCi, entrada)] };
}

/** A tarefa pede julgamento: fechamento ou review-gate, conferência do operador, ou classe sensível. */
export function pedeJulgamento(t, conferencia = []) {
  return Boolean(t.fechamento || (t.marcas ?? []).some((m) => MARCAS_DE_JULGAMENTO.includes(m)) || casoDeConferencia(t, conferencia) || t.classe === "sensivel");
}

/** Avisos de tier do plano: julgamento em `mecanico`, com o modelo que a declaração mapeia. */
export function avisosDeTier(plano, decl) {
  return plano.tasks
    .filter((t) => t.tier === "mecanico" && pedeJulgamento(t, decl.conferencia))
    .map((t) => ({ tipo: "tier", task: t.id, tier: t.tier, modelo: decl.tiers[t.tier] ?? null }));
}

/**
 * O pré-voo. `env` é o ambiente conferido e o das execuções (PATH incluso);
 * `ciclo` liga o aviso de tier. Devolve a saída do verbo, pronta para o JSON.
 */
export function preVoo({ repo, ciclo = null, env = process.env, prazoMs = PRAZO_MS, herdeira = false, entrada = {}, lerPosse = lerPosseDaCerca }) {
  const decl = adaptador.lerAdaptador(repo, { env });
  const lista = decl.sessao.cli ? lerLista(decl, { repo, env, prazoMs }) : { erro: "sessao.cli não declarado" };
  const settings = decl.sessao.settings.length ? lerSettings(decl, repo) : { lidos: [] };
  const conferencias = [pluginCarregado(decl, lista, () => pluginNaSessao(decl, { env })), instalacaoUnica(decl, lista, settings), ponteComRestart(decl, { env, prazoMs }), trafegoLigado(decl, settings, env)];
  let daHerdeira = null;
  if (herdeira) {
    const h = conferenciasDaHerdeira({ repo, ciclo, entrada, temCi: decl.ci !== false, lerPosse });
    conferencias.push(...h.conferencias);
    daHerdeira = { passagem: h.passagem?.sha ?? null, epocaDaNota: epocaDe(h.passagem?.epoca) };
  }
  const avisos = conferencias.filter((c) => c.estado === "nao-declarada").map((c) => ({ tipo: "nao-declarada", conferencia: c.conferencia, remedio: c.remedio }));
  if (ciclo) {
    try {
      avisos.push(...avisosDeTier(lerPlanoNoCommit(repo, "HEAD", ciclo).plano, decl));
    } catch (e) {
      if (!(e instanceof ErroPlano)) throw e;
      avisos.push({ tipo: "plano-ilegivel", motivo: e.codigo, detalhe: e.message });
    }
  }
  const falhas = conferencias.filter((c) => c.estado === "falha").map(({ conferencia, encontrado, remedio }) => ({ conferencia, encontrado, remedio }));
  const base = { ...(ciclo ? { ciclo } : {}), ...(daHerdeira ? { herdeira: daHerdeira } : {}), conferencias, avisos };
  if (!falhas.length) return { acao: "pre-voo", ok: true, ...base };
  return pergunta.perguntar({
    acao: "perguntar",
    motivo: "pre-voo",
    ...base,
    falhas,
    detalhe: `o pré-voo falhou (${falhas.map((f) => f.conferencia).join(", ")}): nenhuma filha abre. Dizer a ${decl.operador.nome} o que falhou e o remédio de cada falha, e rodar o pré-voo de novo depois.`,
  });
}
