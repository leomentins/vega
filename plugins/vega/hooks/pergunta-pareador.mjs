#!/usr/bin/env node
// pergunta-pareador — `Stop` do plugin: grava a `autoria` das respostas do turno às perguntas
// registradas (hotfix vega-pareador-no-plugin, 25/11/2026; decisão 27a do operador).
//
// No fim de cada turno, lê o transcript da sessão e casa as respostas com as perguntas abertas
// pelo `comando.mjs abrir` (o registro git do projeto, `.vega/sessao-<id>.jsonl`). A regra mora em
// `scripts/pergunta/pareador.mjs` (cabeçalho dele): digitado pelo operador ⇒ `digitado`; repasse
// com `Recibo:` conferido pelo `get_event` ⇒ `digitado-no-hub-conferido`; texto que só chegou por
// `send_message` nunca sobe a `digitado`. Quem reconfere a prova a cada leitura é `prova.mjs`.
//
// ONDE AGE: só no projeto cuja declaração (`.vega/declaracao.json` na raiz git do `cwd`) diz
// `decisoes.destino: "git"`. Destino `banco` (a Sistoli, cujo gancho de projeto grava a autoria no
// banco), declaração ausente ou ilegível: sai 0 sem tocar em nada. O mesmo evento tem a mesma
// chave nos dois gravadores, então a fonte e o plugin no mesmo registro não duplicam.
//
// NUNCA BLOQUEIA: sai 0 sempre. Autoria que havia para gravar e não se gravou sai como
// `systemMessage` com a contagem e o motivo curto (nunca o texto do operador).
// Desligar: `<guardas.pastaDoModo>/pergunta-pareador-mode` com `off`, ou `VEGA_PERGUNTA_PAREADOR=off`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function ler(stdin) {
  try {
    return JSON.parse(stdin || "{}");
  } catch {
    return {};
  }
}

/**
 * A raiz do projeto do `cwd`, a mesma regra do `comando.mjs` (`raizPadrao`), que é onde a abertura
 * foi gravada: a raiz git, se ela tem `.vega/declaracao.json`; senão a pasta mais próxima, subindo
 * do `cwd`, que a tem (projeto dentro de um monorepo). Nenhuma ⇒ `null`.
 */
export function raizDoCwd(cwd) {
  if (!cwd || !existsSync(cwd)) return null;
  const declarada = (d) => existsSync(path.join(d, ".vega", "declaracao.json"));
  try {
    const topo = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
    if (topo && declarada(topo)) return topo;
  } catch {
    /* sem git (ou lento): sobe pelas pastas */
  }
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    if (declarada(d)) return d;
    if (path.dirname(d) === d) return null;
  }
}

function desligado(raiz, declaracao, env) {
  if (String(env.VEGA_PERGUNTA_PAREADOR ?? "").trim() === "off") return true;
  const pasta = declaracao?.conducao?.guardas?.pastaDoModo;
  if (typeof pasta !== "string" || !pasta) return false;
  try {
    return readFileSync(path.join(raiz, pasta, "pergunta-pareador-mode"), "utf8").trim() === "off";
  } catch {
    return false;
  }
}

/**
 * Um Stop: `{ gravados, ja_existiam, pulado?, aviso? }`. `entrada` é o payload do Stop
 * (`session_id`, `transcript_path`, `cwd`). Exportado para teste.
 */
export async function rodar(entrada, { env = process.env } = {}) {
  const raiz = raizDoCwd(entrada?.cwd);
  if (!raiz) return { pulado: "sem-projeto" };
  const declaracaoMod = await import("../scripts/vega/declaracao.mjs");
  if (!declaracaoMod.existe(raiz)) return { pulado: "sem-declaracao" };
  let declaracao;
  try {
    declaracao = declaracaoMod.lerDeclaracao(raiz).declaracao;
  } catch (e) {
    // A declaração existe e não se lê: o pareador fica fora em todo turno, então diz.
    return { pulado: "declaracao-ilegivel", aviso: `pergunta-pareador: a declaracao de ${raiz} nao se le (${curto(e)}); a autoria das respostas nao e gravada, e o sim do ciclo recusa origem-sem-prova` };
  }
  const { destino, arquivo } = declaracao.decisoes ?? {};
  if (destino !== "git" || !arquivo) return { pulado: "destino-nao-git" };
  if (desligado(raiz, declaracao, env)) return { pulado: "off" };
  const transcript = typeof entrada?.transcript_path === "string" ? entrada.transcript_path : null;
  if (!transcript || !existsSync(transcript)) return { pulado: "sem-transcript" };
  const sessao = path.basename(transcript, ".jsonl");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessao)) return { pulado: "sessao-ilegivel" };
  const P = await import("../scripts/pergunta/pareador.mjs");
  const { acharTranscript, lerTranscript } = await import("../scripts/pergunta/prova.mjs");
  const pasta = path.dirname(path.join(raiz, arquivo));
  const entradas = lerTranscript(transcript);
  if (!entradas) return { gravados: 0, ja_existiam: 0, aviso: `pergunta-pareador: o transcript da sessao nao se le; a autoria deste turno nao foi gravada` };
  // A prova `transcript:` só resolve com o caminho que o leitor acha pela sessão (`acharTranscript`):
  // grava esse; sem ele, o do payload.
  const ondeProva = acharTranscript(sessao, { env }) ?? path.resolve(transcript);
  const { eventos: registro, descartadas } = P.eventosDaPasta(pasta, { contar: true });
  const avisos = descartadas > 0 ? [`${descartadas} linha(s) ilegivel(is) no registro de perguntas (${path.relative(raiz, pasta) || "."}); pergunta dessas linhas nao pareia`] : [];
  const aberturas = P.aberturasDoTurno(entradas, registro, { sessao });
  const respondidas = new Set(registro.filter((e) => e?.evento === "resposta").map((e) => e.pergunta_id));
  // O transcript inteiro (`desde` 0): o turno cujo Stop falhou se regrava no seguinte; a chave deduplica.
  const { eventos, registros } = aberturas.size === 0 ? { eventos: [], registros: [] } : P.parearTranscript(entradas, { sessao, transcript: ondeProva, desde: 0, aberturas, respondidas });
  const inicio = P.inicioDoTurno(entradas);
  const doTurno = new Set(entradas.slice(inicio).map((e) => e?.uuid).filter(Boolean));
  const semPar = registros.filter((r) => r.evento === "nao-pareada" && doTurno.has(r.uuid)).length;
  if (semPar > 0) avisos.push(`${semPar} resposta(s) com numero e letra sem par com pergunta aberta; responda pelo numero do item (D<k> e a letra) ou grave com comando.mjs responder`);
  let r = { gravados: 0, ja_existiam: 0 };
  if (eventos.length > 0) {
    try {
      r = P.gravarNoRegistro(pasta, eventos);
    } catch (e) {
      avisos.push(`${eventos.length} evento(s) de autoria nao gravado(s) (${curto(e)}); sem eles o sim desta resposta recusa origem-sem-prova`);
    }
  }
  return avisos.length ? { ...r, aviso: avisos.map((x) => `pergunta-pareador: ${x}`).join(" · ") } : r;
}

function curto(e) {
  return String(e?.code ?? e?.message ?? e).split("\n")[0].slice(0, 160);
}

const ESTE = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ESTE) {
  let stdin = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (stdin += c));
  process.stdin.on("end", async () => {
    try {
      const r = await rodar(ler(stdin));
      if (r.aviso) process.stdout.write(`${JSON.stringify({ systemMessage: r.aviso })}\n`);
    } catch (e) {
      const motivo = String(e?.message ?? e).split("\n")[0].slice(0, 160);
      process.stdout.write(`${JSON.stringify({ systemMessage: `pergunta-pareador: falhou (${motivo}); a autoria deste turno pode nao ter sido gravada` })}\n`);
    }
    process.exitCode = 0;
  });
}
