#!/usr/bin/env node
/**
 * vigia-de-fora.mjs — a checagem de fora da condução (VEGA-37 T22, D-VEGA37-15, D-VEGA37-24).
 *
 * Roda fora de toda sessão, por um temporizador do servidor que o projeto instala. Lê os logs da
 * condução, chama `vigia.mjs` por ciclo e, para cada ciclo parado, manda o aviso direto ao celular
 * do operador por ntfy, sem abrir sessão, respeitando a dobra e o teto do dia que a vigia decide.
 * Neutro de projeto: a pasta do log vem da declaração (`lerAdaptador`); o tópico e o modo vêm de
 * arquivos que quem instala nomeia.
 *
 * Texto do aviso: molde fixo, só com campos validados — ciclo pelo padrão de id, fase `F\d{1,2}`
 * ou `fechamento`, estado do enum da vigia, minutos inteiros. Nenhum texto livre do log entra, e o
 * envio não lê transcript.
 *
 * Tópico: lido de arquivo fora do repositório (`--topico <arquivo>`), nunca do git. Arquivo
 * ausente, ilegível ou fora do padrão ⇒ `canal-indisponivel` no log da vigia e o aviso NÃO conta
 * como enviado (o `aviso-da-vigia` só se grava depois do envio aceito).
 *
 * Modo (`--modo <arquivo>`, lido a cada checagem): `ligado` avisa; `seco` decide e registra
 * (`queda`, checagem com motivo `seco`) sem avisar. Arquivo ausente ou valor desconhecido = `seco`,
 * com o motivo na linha da checagem.
 *
 * CLI (uma linha JSON no stdout):
 *   vigia-de-fora.mjs checar --repo R --topico ARQ --modo ARQ [--servidor URL] [--agora ISO]
 *   vigia-de-fora.mjs falha  --repo R [--agora ISO]   # ExecStopPost do serviço que caiu
 * Saída: 0 checagem feita (mesmo com canal indisponível) · 1 erro.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOTOES } from "./botoes.mjs";
import * as logEventos from "./log-eventos.mjs";
import * as vigia from "./vigia.mjs";

export const MODOS = Object.freeze(["seco", "ligado"]);
export const MODO_PADRAO = "seco";
export const SERVIDOR_PADRAO = "https://ntfy.sh";
/** "Ciclo" das linhas da vigia que não são de ciclo nenhum (falha do serviço). */
export const CICLO_DO_SERVICO = "vigia-de-fora";
const PADRAO_CICLO = /^[A-Z][A-Z0-9]*-\d{1,4}-[a-z0-9][a-z0-9-]{0,80}$/;
const PADRAO_FASE = /^(F\d{1,2}|fechamento)$/;
/** Tópico do ntfy: só o alfabeto que o ntfy aceita, sem barra nem espaço. */
const PADRAO_TOPICO = /^[A-Za-z0-9_-]{1,64}$/;
const PRAZO_ENVIO_MS = 10_000;

/** Modo lido do arquivo; ausente ou desconhecido cai em `seco`, com o motivo. */
export function lerModo(arquivo) {
  if (!arquivo || !existsSync(arquivo)) return { modo: MODO_PADRAO, motivo: "modo-ausente" };
  let bruto;
  try {
    bruto = readFileSync(arquivo, "utf8").trim();
  } catch {
    return { modo: MODO_PADRAO, motivo: "modo-ilegivel" };
  }
  return MODOS.includes(bruto) ? { modo: bruto, motivo: null } : { modo: MODO_PADRAO, motivo: "modo-desconhecido" };
}

/** Tópico lido do arquivo fora do repositório; `null` com o motivo quando não serve. */
export function lerTopico(arquivo) {
  if (!arquivo) return { topico: null, motivo: "topico-sem-arquivo" };
  let bruto;
  try {
    bruto = readFileSync(arquivo, "utf8").trim();
  } catch {
    return { topico: null, motivo: existsSync(arquivo) ? "topico-ilegivel" : "topico-ausente" };
  }
  return PADRAO_TOPICO.test(bruto) ? { topico: bruto, motivo: null } : { topico: null, motivo: "topico-fora-do-padrao" };
}

/** Fase do sinal de vida (objeto `fase` da linha), ou `null`. */
export function faseDaVida(linhaVida) {
  for (const o of linhaVida?.objetos ?? []) {
    if (o?.tipo !== "fase" || typeof o.id !== "string") continue;
    const m = /(F\d{1,2})$/.exec(o.id);
    if (m) return m[1];
  }
  return null;
}

/**
 * Título e corpo do aviso, no molde fixo. Campo que não casa o padrão recusa o aviso inteiro —
 * nunca vai texto do log ao celular.
 */
export function montarAviso({ ciclo, fase, estado, silencioMin, vezes }) {
  if (typeof ciclo !== "string" || !PADRAO_CICLO.test(ciclo)) throw new Error("aviso recusado: ciclo fora do padrão");
  if (fase !== null && fase !== undefined && (typeof fase !== "string" || !PADRAO_FASE.test(fase))) throw new Error("aviso recusado: fase fora do padrão");
  if (!vigia.ESTADOS.includes(estado)) throw new Error("aviso recusado: estado fora do enum");
  const min = Math.floor(Number(silencioMin));
  if (!Number.isFinite(min) || min < 0) throw new Error("aviso recusado: minutos ilegíveis");
  const n = Number.isInteger(vezes) && vezes > 0 ? vezes : 1;
  const onde = fase ? `${ciclo} ${fase}` : ciclo;
  return {
    titulo: `Condução parada: ${onde}`,
    corpo: `${onde} sem sinal de vida há ${min} min (estado ${estado}). Aviso ${n}.`,
  };
}

/** Envio pelo ntfy (POST no tópico). Devolve `{ ok, motivo }`, nunca lança. */
export async function enviarNtfy({ servidor = SERVIDOR_PADRAO, topico, titulo, corpo }, { fetch: f = globalThis.fetch } = {}) {
  try {
    const r = await f(`${servidor.replace(/\/+$/, "")}/${topico}`, {
      method: "POST",
      headers: { Title: titulo, Tags: "warning" },
      body: corpo,
      signal: AbortSignal.timeout(PRAZO_ENVIO_MS),
    });
    return r.ok ? { ok: true, motivo: null } : { ok: false, motivo: `http-${r.status}` };
  } catch (e) {
    return { ok: false, motivo: e?.name === "TimeoutError" ? "envio-prazo" : "envio-falhou" };
  }
}

/** Ciclos com log na pasta (`<ciclo>.jsonl`), fora a pasta da vigia. */
export function ciclosDoLog(pastaDoLog) {
  if (!existsSync(pastaDoLog)) return [];
  return readdirSync(pastaDoLog, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".jsonl"))
    .map((d) => d.name.slice(0, -".jsonl".length))
    .filter((c) => c !== CICLO_DO_SERVICO)
    .sort();
}

/**
 * O ciclo já fechou (D-VEGA37-37): algum ramo do ciclo no git de `repo` (`ciclo-<id>` ou
 * `ciclo-<id>-*`, local ou de remoto) traz a marca `Conducao: ciclo sessao encerrada` com o trailer
 * `Conducao-Encerrada: ciclo`; ou, depois da mescla, quando o ramo some (D-VEGA37-38), o ramo
 * principal do origin (`origin/HEAD`, senão `origin/main`) traz o squash do ciclo: subject que
 * começa por `<id> ` e corpo com a linha `* Conducao: ciclo sessao encerrada` e a linha
 * `Conducao-Encerrada: ciclo`. O log não tem estado terminal, e o critério é só este. Sem `repo`,
 * sem ramo nem squash, ou git que não responde ⇒ false: sem critério legível, o ciclo segue checado.
 */
export function cicloEncerrado(repo, ciclo) {
  if (!repo || !PADRAO_CICLO.test(ciclo ?? "")) return false;
  const git = (args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const padroes = [`refs/heads/ciclo-${ciclo}`, `refs/heads/ciclo-${ciclo}-*`, `refs/remotes/*/ciclo-${ciclo}`, `refs/remotes/*/ciclo-${ciclo}-*`];
  const refs = git(["for-each-ref", "--format=%(refname)", ...padroes]);
  if (refs.status !== 0) return false;
  for (const ref of refs.stdout.split("\n").filter(Boolean)) {
    const log = git(["log", "-F", "--grep=Conducao-Encerrada: ciclo", "--format=%s%x1f%(trailers:key=Conducao-Encerrada,valueonly)%x1e", ref]);
    if (log.status !== 0) continue;
    for (const reg of log.stdout.split("\x1e")) {
      const [subject, enc] = reg.trim().split("\x1f");
      if (subject === "Conducao: ciclo sessao encerrada" && enc?.trim() === "ciclo") return true;
    }
  }
  return squashEncerradoNoPrincipal(git, ciclo);
}

/** O ramo principal do origin: `origin/HEAD` resolvido, senão `refs/remotes/origin/main`; ou null. */
function principalDoOrigin(git) {
  const sym = git(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]);
  if (sym.status === 0 && sym.stdout.trim()) return sym.stdout.trim();
  const main = git(["rev-parse", "-q", "--verify", "refs/remotes/origin/main"]);
  return main.status === 0 ? "refs/remotes/origin/main" : null;
}

/**
 * O squash do ciclo no ramo principal do origin (D-VEGA37-38): subject `<id> …` com, no corpo,
 * a linha `* Conducao: ciclo sessao encerrada` e a linha `Conducao-Encerrada: ciclo`. No squash
 * a marca vem no meio do corpo, fora do bloco final de trailers, por isso a leitura é por linha.
 */
function squashEncerradoNoPrincipal(git, ciclo) {
  const ref = principalDoOrigin(git);
  if (!ref) return false;
  const log = git(["log", "-F", "--all-match", "--grep=* Conducao: ciclo sessao encerrada", "--grep=Conducao-Encerrada: ciclo", "--format=%s%x1f%B%x1e", ref]);
  if (log.status !== 0) return false;
  for (const reg of log.stdout.split("\x1e")) {
    const [subject, corpo] = reg.replace(/^\n+/, "").split("\x1f");
    if (!subject?.startsWith(`${ciclo} `) || corpo === undefined) continue;
    const linhas = corpo.split("\n").map((l) => l.trim());
    if (linhas.includes("* Conducao: ciclo sessao encerrada") && linhas.includes("Conducao-Encerrada: ciclo")) return true;
  }
  return false;
}

function linhaDaVigia(saida, agora, pastaDoLog) {
  return logEventos.registrar(saida, { procedencia: "observado", quando: agora, pasta: vigia.pastaDaVigia(pastaDoLog) });
}

/**
 * Uma passada: decide cada ciclo, grava `queda` (e, com o envio aceito, `aviso-da-vigia`) no log
 * do ciclo e uma checagem por ciclo no log da vigia. Ciclo fechado no git de `repo`
 * (`cicloEncerrado`) não conta: nem decisão, nem queda, nem checagem; sai em `encerrados`.
 * `enviar` e `encerrado` injetáveis para teste.
 */
export async function checarTodos({ pastaDoLog, agora, arquivoModo, arquivoTopico, servidor, repo = null, enviar = enviarNtfy, encerrado = cicloEncerrado }, botoes = BOTOES) {
  const { modo, motivo: motivoModo } = lerModo(arquivoModo);
  const doLog = ciclosDoLog(pastaDoLog);
  const porCiclo = new Map(doLog.map((c) => [c, logEventos.lerLog(logEventos.arquivoDoLog(c, pastaDoLog))]));
  const encerrados = doLog.filter((c) => encerrado(repo, c));
  const ciclos = doLog.filter((c) => !encerrados.includes(c));
  // O teto do dia conta o aviso enviado nesta mesma passada: depois de cada ciclo o log dele é
  // relido e `todas` recomposto, para o segundo ciclo em queda ver o aviso do primeiro.
  let todas = [...porCiclo.values()].flat();
  const resultado = [];

  for (const ciclo of ciclos) {
    const linhas = porCiclo.get(ciclo);
    const d = vigia.decidir({ linhas, agora, todasAsLinhas: todas }, botoes);
    let decisao = d;
    let enviado = false;
    if (d.avisar && modo !== "ligado") decisao = { ...d, avisar: false, motivo: motivoModo ?? "seco" };
    else if (d.avisar) {
      const { topico, motivo: motivoTopico } = lerTopico(arquivoTopico);
      if (!topico) {
        linhaDaVigia({ acao: "canal-indisponivel", ciclo, motivo: motivoTopico, instante: new Date(agora).toISOString() }, agora, pastaDoLog);
        decisao = { ...d, avisar: false, motivo: "canal-indisponivel" };
      } else {
        const vida = vigia.ultimaVida(linhas);
        let aviso;
        try {
          aviso = montarAviso({ ciclo, fase: faseDaVida(vida), estado: d.estado, silencioMin: d.silencioMin, vezes: d.vezes + 1 });
        } catch (e) {
          linhaDaVigia({ acao: "aviso-recusado", ciclo, motivo: "campo-fora-do-padrao", instante: new Date(agora).toISOString() }, agora, pastaDoLog);
          decisao = { ...d, avisar: false, motivo: "aviso-recusado", erro: e.message };
        }
        if (aviso) {
          const r = await enviar({ servidor: servidor ?? SERVIDOR_PADRAO, topico, ...aviso });
          if (r.ok) enviado = true;
          else {
            linhaDaVigia({ acao: "canal-indisponivel", ciclo, motivo: r.motivo, instante: new Date(agora).toISOString() }, agora, pastaDoLog);
            decisao = { ...d, avisar: false, motivo: "canal-indisponivel" };
          }
        }
      }
    }
    const saidas = vigia.eventosDaQueda(ciclo, decisao, agora);
    for (const s of saidas) logEventos.registrar(s, { procedencia: "observado", quando: agora, pasta: pastaDoLog });
    if (saidas.length) {
      porCiclo.set(ciclo, logEventos.lerLog(logEventos.arquivoDoLog(ciclo, pastaDoLog)));
      todas = [...porCiclo.values()].flat();
    }
    vigia.registrarChecagem({ ciclo, decisao, agora, pastaDoLog });
    resultado.push({ ciclo, situacao: decisao.situacao, avisar: decisao.avisar, enviado, motivo: decisao.motivo ?? null });
  }
  return { acao: "vigia-de-fora", modo, motivoModo, agora: new Date(agora).toISOString(), ciclos: resultado, encerrados };
}

/** `falha <timestamp>` no log da vigia: o serviço caiu (ExecStopPost). */
export function registrarFalha({ pastaDoLog, agora }) {
  const instante = new Date(agora).toISOString();
  const r = linhaDaVigia({ acao: "falha", ciclo: CICLO_DO_SERVICO, instante }, agora, pastaDoLog);
  return { acao: "falha", instante, arquivo: r.arquivo };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function flag(args, nome) {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv) {
  const [verbo, ...resto] = argv;
  const repo = flag(resto, "--repo") ?? process.cwd();
  const agora = flag(resto, "--agora") ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(agora))) throw new Error(`--agora ilegível: ${agora}`);
  const { lerAdaptador } = await import("./adaptador.mjs");
  const { pastaDoLog } = lerAdaptador(repo);
  if (verbo === "falha") return registrarFalha({ pastaDoLog, agora });
  if (verbo === "checar") {
    return checarTodos({
      pastaDoLog,
      agora,
      arquivoModo: flag(resto, "--modo"),
      arquivoTopico: flag(resto, "--topico"),
      servidor: flag(resto, "--servidor"),
      repo,
    });
  }
  throw new Error("uso: vigia-de-fora.mjs <checar|falha> --repo R [--topico ARQ] [--modo ARQ] [--servidor URL] [--agora ISO]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (r) => process.stdout.write(`${JSON.stringify(r)}\n`),
    (e) => {
      process.stdout.write(`${JSON.stringify({ acao: "erro", motivo: e.message })}\n`);
      process.exit(1);
    },
  );
}
