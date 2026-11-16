#!/usr/bin/env node
/**
 * vigia.mjs — vigia por estado da condução (VEGA-37 T21, D-VEGA37-5, D-VEGA37-10).
 *
 * A condutora grava **sinal de vida** (`vida`) no log do ciclo com o estado em
 * que está; a vigia lê o log e decide se o ciclo está vivo, em queda, esperando
 * o operador ou desconhecido. Neutro de projeto: os números vêm de `botoes.mjs`
 * e a pasta do log, da declaração do adaptador.
 *
 * Estados da vigia (o que a condutora declara no `vida`):
 *   - `operaria` — operária em curso;
 *   - `ci`       — CI em curso;
 *   - `livre`    — condutora trabalhando sem nada aberto;
 *   - `pergunta` — pergunta aberta ao operador: sem prazo, nunca queda.
 *
 * Decisão (`decidir`):
 *   - `desconhecido` — o ciclo não tem nenhum `vida` (o motor de `main` não os
 *     grava até a mescla): nunca queda, e cada checagem deixa uma linha no log
 *     da vigia (`registrarChecagem`);
 *   - `esperando-operador` — último `vida` em `pergunta`, ou um `perguntar`
 *     depois do último `vida`;
 *   - `vivo` — dentro do prazo do estado;
 *   - `queda` — o prazo do estado venceu sem `vida` novo. O primeiro aviso sai
 *     no vencimento; cada aviso seguinte da mesma queda espera o intervalo
 *     anterior vezes `dobraDoAviso`; e nenhum sai se o dia `America/Sao_Paulo`
 *     já tem `tetoAvisosPorDia` avisos (timestamps do log seguem UTC).
 *
 * Eventos que este módulo grava: `vida`, `queda` e `aviso-da-vigia`. O nome
 * `aviso` sozinho já é o do aviso da filha no log (T3 o usa como fim da
 * operária em curso), e a vigia não o conta.
 *
 * O sinal de vida guarda o id do despertador armado (`despertador`), para o
 * seguinte cancelar o anterior (`despertadorAnterior`, T25).
 *
 * CLI (uma linha JSON no stdout):
 *   vigia.mjs vida   --repo R --ciclo C --estado E --intervalo MIN [--despertador ID] [--fase F] [--agora ISO]
 *   vigia.mjs checar --repo R --ciclo C [--agora ISO] [--avisar]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOTOES } from "./botoes.mjs";
import * as logEventos from "./log-eventos.mjs";

export const ESTADOS = Object.freeze(["operaria", "ci", "livre", "pergunta"]);
export const ACAO_VIDA = "vida";
export const ACAO_QUEDA = "queda";
export const ACAO_AVISO = "aviso-da-vigia";
export const ACAO_CHECAGEM = "checagem";
/** Ação do log que abre pergunta ao operador (intenção do `proximo`). */
const ABRE_PERGUNTA = new Set(["perguntar"]);
export const FUSO_DO_DIA = "America/Sao_Paulo";

/** Prazo (min) do estado; `null` para `pergunta` (esperar o operador não é queda). */
export function prazoDoEstado(estado, botoes = BOTOES) {
  if (!ESTADOS.includes(estado)) throw new Error(`estado da vigia desconhecido: ${estado}`);
  return {
    operaria: botoes.prazoOperariaEmCursoMin,
    ci: botoes.prazoCiEmCursoMin,
    livre: botoes.prazoCondutoraLivreMin,
    pergunta: null,
  }[estado];
}

/** Janela (min) em que o próximo sinal de vida deve sair: [0,5 · prazo, 0,8 · prazo]. */
export function janelaDoSinal(estado, botoes = BOTOES) {
  const prazo = prazoDoEstado(estado, botoes);
  if (prazo === null) return null;
  return { de: prazo * botoes.fracaoSinalDeVidaMin, ate: prazo * botoes.fracaoSinalDeVidaMax, prazoMin: prazo };
}

/** Dia `America/Sao_Paulo` (`AAAA-MM-DD`) de um instante UTC. */
export function diaBrt(instante) {
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) throw new Error(`instante ilegível: ${instante}`);
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_DO_DIA, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const ms = (iso) => Date.parse(iso);

/**
 * Saída do evento `vida`, pronta para `logEventos.registrar`. `intervaloMin` é
 * o atraso do despertador armado: fora da janela do estado, recusa. Em
 * `pergunta` não há janela, e o intervalo é livre.
 */
export function sinalDeVida({ ciclo, estado, intervaloMin, despertador, fase, agora }, botoes = BOTOES) {
  const prazoMin = prazoDoEstado(estado, botoes);
  if (typeof intervaloMin !== "number" || !Number.isFinite(intervaloMin) || intervaloMin <= 0) throw new Error("sinal de vida exige --intervalo em minutos (> 0)");
  const janela = janelaDoSinal(estado, botoes);
  if (janela && (intervaloMin < janela.de || intervaloMin > janela.ate))
    throw new Error(`intervalo ${intervaloMin} min fora da janela do estado ${estado}: entre ${janela.de} e ${janela.ate} min (prazo ${prazoMin})`);
  const instante = new Date(agora ?? Date.now()).toISOString();
  return {
    acao: ACAO_VIDA,
    ciclo,
    ...(fase ? { fase } : {}),
    estado,
    intervaloMin,
    ...(prazoMin !== null ? { prazoMin } : {}),
    ...(despertador ? { despertador } : {}),
    instante,
  };
}

const eventos = (linhas) => linhas.filter((l) => l?.linha === "evento" && typeof l.quando === "string" && !Number.isNaN(ms(l.quando)));

/** Último `vida` do log (linha inteira), ou `null`. */
export function ultimaVida(linhas) {
  const vidas = eventos(linhas).filter((l) => l.acao === ACAO_VIDA && ESTADOS.includes(l.atributos?.estado));
  return vidas.reduce((a, b) => (a === null || ms(b.quando) >= ms(a.quando) ? b : a), null);
}

/** Id do despertador do último sinal de vida — o que o próximo cancela (T25). */
export function despertadorAnterior(linhas) {
  return ultimaVida(linhas)?.atributos?.despertador ?? null;
}

/** Avisos da vigia no dia `America/Sao_Paulo` de `agora`, somados todos os logs passados. */
export function avisosNoDia(linhas, agora) {
  const dia = diaBrt(agora);
  return eventos(linhas).filter((l) => l.acao === ACAO_AVISO && diaBrt(l.quando) === dia).length;
}

/**
 * Decide o estado do ciclo a partir das linhas do log dele. `todasAsLinhas`
 * (padrão: as do ciclo) é onde o teto do dia conta — a vigia de fora passa as
 * de todos os ciclos, porque o teto é do operador, não do ciclo.
 */
export function decidir({ linhas, agora, todasAsLinhas = linhas }, botoes = BOTOES) {
  const t = ms(agora);
  if (Number.isNaN(t)) throw new Error(`agora ilegível: ${agora}`);
  const vida = ultimaVida(linhas);
  if (!vida) return { situacao: "desconhecido", avisar: false, motivo: "sem-sinal-de-vida" };
  const estado = vida.atributos.estado;
  const desde = ms(vida.quando);
  const base = { estado, vida: vida.chave, vidaEm: vida.quando, despertador: vida.atributos.despertador ?? null };
  const depois = eventos(linhas).filter((l) => ms(l.quando) > desde);
  if (estado === "pergunta" || depois.some((l) => ABRE_PERGUNTA.has(l.acao)))
    return { ...base, situacao: "esperando-operador", avisar: false, motivo: "pergunta-aberta" };

  const prazoMin = prazoDoEstado(estado, botoes);
  const silencioMin = (t - desde) / 60_000;
  if (silencioMin <= prazoMin) return { ...base, situacao: "vivo", avisar: false, prazoMin, silencioMin, venceEm: new Date(desde + prazoMin * 60_000).toISOString() };

  // Queda: avisos desta queda são os `aviso-da-vigia` que citam este `vida`.
  const avisos = depois.filter((l) => l.acao === ACAO_AVISO && l.atributos?.ref === vida.chave).sort((a, b) => ms(a.quando) - ms(b.quando));
  const vezes = avisos.length;
  const intervaloMin = prazoMin * botoes.dobraDoAviso ** vezes;
  const desdeUltimo = vezes ? ms(avisos[vezes - 1].quando) : desde;
  const proximoEm = new Date(desdeUltimo + intervaloMin * 60_000).toISOString();
  const queda = { ...base, situacao: "queda", prazoMin, silencioMin, vezes, intervaloMin, proximoAvisoEm: proximoEm };
  if (t < ms(proximoEm)) return { ...queda, avisar: false, motivo: "dobra-do-aviso" };
  const noDia = avisosNoDia(todasAsLinhas, agora);
  if (noDia >= botoes.tetoAvisosPorDia) return { ...queda, avisar: false, motivo: "teto-do-dia", avisosNoDia: noDia, teto: botoes.tetoAvisosPorDia };
  return { ...queda, avisar: true, avisosNoDia: noDia, teto: botoes.tetoAvisosPorDia };
}

/** Saídas de log (`queda` e, se `avisar`, `aviso-da-vigia`) para uma decisão de queda. */
export function eventosDaQueda(ciclo, d, agora) {
  if (d.situacao !== "queda") return [];
  const saidas = [{ acao: ACAO_QUEDA, ciclo, estado: d.estado, prazoMin: d.prazoMin, ref: d.vida }];
  if (d.avisar)
    saidas.push({ acao: ACAO_AVISO, ciclo, estado: d.estado, ref: d.vida, vezes: d.vezes + 1, intervaloMin: d.intervaloMin, dia: diaBrt(agora) });
  return saidas;
}

/** Pasta do log da vigia: `vigia/` dentro da pasta do log do projeto. */
export function pastaDaVigia(pastaDoLog) {
  return path.join(pastaDoLog, "vigia");
}

/**
 * Uma linha por checagem no log da vigia (separado do log do ciclo, que só
 * guarda fatos da condução). O `instante` faz cada checagem ser linha nova.
 */
export function registrarChecagem({ ciclo, decisao, agora, pastaDoLog }) {
  const saida = { acao: ACAO_CHECAGEM, ciclo, estado: decisao.situacao, motivo: decisao.motivo ?? decisao.situacao, instante: new Date(agora).toISOString() };
  return logEventos.registrar(saida, { procedencia: "observado", quando: agora, pasta: pastaDaVigia(pastaDoLog) });
}

/**
 * Checagem de um ciclo: decide, grava `queda`/`aviso-da-vigia` no log do
 * ciclo (o `aviso-da-vigia` só com `avisar`, que é quem manda o aviso de
 * fato — T22) e uma linha de checagem no log da vigia.
 */
export function checar({ ciclo, agora, pastaDoLog, avisar = false, todasAsLinhas }, botoes = BOTOES) {
  const linhas = logEventos.lerLog(logEventos.arquivoDoLog(ciclo, pastaDoLog));
  const d = decidir({ linhas, agora, todasAsLinhas: todasAsLinhas ?? linhas }, botoes);
  const decisao = avisar ? d : { ...d, avisar: false, ...(d.avisar ? { motivo: "sem-avisar" } : {}) };
  for (const s of eventosDaQueda(ciclo, decisao, agora)) logEventos.registrar(s, { procedencia: "observado", quando: agora, pasta: pastaDoLog });
  registrarChecagem({ ciclo, decisao, agora, pastaDoLog });
  return { acao: "vigia", ciclo, ...decisao };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function flag(args, nome) {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv) {
  const [verbo, ...resto] = argv;
  const repo = flag(resto, "--repo") ?? process.cwd();
  const ciclo = flag(resto, "--ciclo");
  if (!ciclo) throw new Error("uso: vigia.mjs <vida|checar> --ciclo C [--repo R]");
  const agora = flag(resto, "--agora") ?? new Date().toISOString();
  const { lerAdaptador } = await import("./adaptador.mjs");
  const { pastaDoLog } = lerAdaptador(repo);
  if (verbo === "vida") {
    const saida = sinalDeVida({
      ciclo,
      estado: flag(resto, "--estado"),
      intervaloMin: Number(flag(resto, "--intervalo")),
      despertador: flag(resto, "--despertador"),
      fase: flag(resto, "--fase"),
      agora,
    });
    const r = logEventos.registrar(saida, { procedencia: "observado", quando: agora, pasta: pastaDoLog });
    return { ...saida, chave: r.chave, novo: r.novo };
  }
  if (verbo === "checar") return checar({ ciclo, agora, pastaDoLog, avisar: resto.includes("--avisar") });
  throw new Error(`verbo desconhecido: ${verbo}`);
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
