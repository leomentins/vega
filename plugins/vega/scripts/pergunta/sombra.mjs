#!/usr/bin/env node
/**
 * sombra.mjs — o Sistema 1 prevê a resposta de cada pergunta em sombra (VEGA-19 T21; AC-VEGA19-6;
 * D-VEGA19-11, D-VEGA19-12, D-VEGA19-65, D-VEGA19-67).
 *
 * Depois de gravar a abertura, o `comando.mjs abrir` chama `sombrear`: ela relê a abertura do
 * registro (a que já passou pela varredura de PHI), monta o prompt pelo template congelado, pede ao
 * modelo local a primeira letra com a saída restrita às letras das opções, e grava a linha
 * `previsao` com o vetor de probabilidades, a latência, a carga fria e onde rodou. O operador nunca
 * vê a previsão: nada dela entra no bloco.
 *
 * Nunca trava:
 * - marca de paciente na abertura ⇒ o modelo nem é chamado, e nada se grava (D-VEGA19-12);
 * - a pergunta já tem linha `previsao` ⇒ não chama de novo (a reabertura idempotente, D-VEGA19-67);
 * - passou do teto de 5 s ⇒ `sem previsão` motivo `lento` (D-VEGA19-65); servidor fora ou
 *   carregando ⇒ `fora`; o modelo não está na GPU ⇒ `fora-da-gpu`; qualquer outra falha ⇒ `erro`.
 * - um `finally` sempre grava a linha (`previsao` ou `sem previsão` com o motivo, vetor vazio);
 *   a falha dessa gravação vai a stderr e a um contador (`falhasDeGravacao` + arquivo de estado).
 *
 * Achados da T20 (`notes/medidas-maquina-T20.md` §Para a T21): o template vai com
 * `chat_template_kwargs: {"enable_thinking": false}` (sem ele a previsão é ruído); a probabilidade
 * por opção soma as variantes de caixa e forma da mesma letra (`c`, `C`, `(c`) antes de normalizar;
 * a primeira previsão depois da carga leva ~69 s, por isso a unidade faz um pedido de aquecimento
 * na subida (`vega-sistema1.service`, `ExecStartPost`).
 *
 * A chave da API vem do ambiente (variável `VEGA_SISTEMA1_API_KEY`) ou da linha da chave `LLAMA_API_KEY` do arquivo
 * `VEGA_SISTEMA1_CHAVE_ARQUIVO` (padrão `${XDG_CONFIG_HOME:-~/.config}/vega-sistema1/api.env`).
 * Sem chave, o servidor recusa e a linha sai `sem previsão` motivo `erro`. `VEGA_SISTEMA1=off`
 * desliga a sombra (nada chamado, nada gravado).
 *
 * ── WIRING (script-created-without-invoker) ──
 *   1. PRODUCAO — `.claude/skills/vega/scripts/pergunta/comando.mjs` `principal` → `abrir(…, { sombra:
 *      sombrear })`, depois de gravar a abertura; espera com o teto duro de 5 s.
 *   2. `.claude/skills/vega/scripts/pergunta/__tests__/sombra.test.mjs` — servidor falso (6 s ⇒
 *      `lento`, fora, fora da GPU, paciente, reabertura, processo que sai logo depois de abrir).
 */
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** A configuração pinada do serviço (T19, T51): endereço, modelo e revisão. */
export const SERVICO = path.resolve(AQUI, "..", "..", "..", "..", "scripts", "decisoes", "sistema1", "servico.json");

/** Teto duro da previsão inteira (D-VEGA19-65): passar disso é `lento`. */
export const TETO_MS = 5_000;
/** O vocabulário fechado do `sem previsão` (o mesmo `MOTIVOS_DA_PREVISAO` de `estado/lib/decisao.mjs`). */
export const MOTIVOS = Object.freeze(["lento", "fora", "fora-da-gpu", "erro"]);
/** Versão do template congelado: muda o template, muda a versão (e a chave da linha). */
export const VERSAO_DO_TEMPLATE = 1;
/** Quantas alternativas do topo o servidor devolve por token. */
export const TOPO_N = 10;
/**
 * Carga fria: avaliação do prompt acima disto por token. A T20 mediu ~7,7 ms/token quente (130
 * tokens/s) e ~940 ms/token no primeiro pedido depois da carga (21,7 s para 23 tokens).
 */
export const MS_POR_TOKEN_FRIO = 100;
/** Tetos do texto que entra no prompt (o prompt fica perto de 250–400 tokens). */
const TETO_TITULO = 300;
const TETO_OPCAO = 200;

/** O template congelado: instrução de sistema e corpo; as chaves são só as letras das opções. */
export const TEMPLATE_SISTEMA =
  "Você prevê qual opção o operador vai escolher numa pergunta de engenharia de software. Responda só com a letra da opção, sem mais nada.";

let falhas = 0;
/** Quantas gravações da linha da sombra falharam neste processo. */
export function falhasDeGravacao() {
  return falhas;
}

/** O arquivo do contador de falhas de gravação (estado da estação, fora do repositório). */
export function arquivoDoContador(env = process.env) {
  const base = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(base, "sistoli", "sistema1", "falhas-de-gravacao.log");
}

function contarFalha(stderr, arquivo, motivo) {
  falhas++;
  try {
    mkdirSync(path.dirname(arquivo), { recursive: true });
    appendFileSync(arquivo, `${new Date().toISOString()} ${motivo}\n`, { mode: 0o600 });
  } catch (e) {
    stderr.write(`aviso: sombra: contador de falhas nao gravou (${e.code ?? "erro"})\n`);
  }
}

const cortar = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

/** A configuração do serviço: endereço, modelo e versão (revisão do modelo + versão do template). */
export function configDoServico(arquivo = SERVICO) {
  const c = JSON.parse(readFileSync(arquivo, "utf8"));
  // A chave vai em HTTP puro: só loopback (D-VEGA19-12; a tailnet chega por `tailscale serve`).
  if (!["127.0.0.1", "localhost"].includes(c.execucao.host)) throw new Error(`servico.json: host fora de loopback`);
  return {
    endereco: `http://${c.execucao.host}:${c.execucao.porta}`,
    modelo: c.modelo.arquivo,
    versao: `${String(c.modelo.revisao).slice(0, 12)}-t${VERSAO_DO_TEMPLATE}`,
  };
}

/** A chave da API, do ambiente ou do arquivo do operador; `null` sem nenhuma. Nunca é logada. */
export function chaveDaApi(env = process.env) {
  if (env.VEGA_SISTEMA1_API_KEY) return env.VEGA_SISTEMA1_API_KEY;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const arquivo = env.VEGA_SISTEMA1_CHAVE_ARQUIVO || path.join(base, "vega-sistema1", "api.env");
  try {
    const m = /^\s*(?:export\s+)?LLAMA_API_KEY\s*=\s*"?([^"\n\r]+)"?\s*$/m.exec(readFileSync(arquivo, "utf8"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * O modelo está na GPU? Lê os processos de cômputo do `nvidia-smi` e procura o `llama-server`.
 * `true` / `false` só com a consulta feita; sem `nvidia-smi`, timeout ou erro ⇒ `null` (não deu
 * para medir: a linha sai `erro`, nunca `fora-da-gpu` com `onde: cpu` que não se mediu).
 */
export function naGpuPadrao({ signal } = {}) {
  return new Promise((resolver) => {
    execFile("nvidia-smi", ["--query-compute-apps=process_name", "--format=csv,noheader"], { timeout: 1_500, signal }, (erro, saida) => {
      if (erro) return resolver(null);
      resolver(/llama-server/.test(String(saida)));
    });
  });
}

/** Os itens da abertura relida, na forma que o prompt usa: número, título, opções, recomendada. */
export function itensDaAbertura(abertura) {
  const itens = Array.isArray(abertura?.itens) ? abertura.itens : [];
  return itens
    .map((it) => ({
      numero: it.numero,
      titulo: it.titulo ?? abertura.titulo ?? "",
      // Só letras válidas, cada uma uma vez (letra repetida dobraria a gramática e o vetor).
      opcoes: (it.opcoes ?? []).filter((o, i, todas) => typeof o?.letra === "string" && /^[a-z]$/.test(o.letra) && todas.findIndex((x) => x?.letra === o.letra) === i),
      recomendada: it.recomendada ?? (itens.length === 1 ? (abertura.recomendada ?? null) : null),
    }))
    .filter((it) => Number.isInteger(it.numero) && it.opcoes.length > 0);
}

/** As mensagens do template congelado para um item. */
export function mensagensDoItem(abertura, item) {
  const linhas = [`Pergunta: ${cortar(item.titulo || abertura.titulo, TETO_TITULO)}`, "Opções:"];
  for (const o of item.opcoes) linhas.push(`${o.letra}) ${cortar(o.texto, TETO_OPCAO)}`);
  if (item.recomendada) linhas.push(`Recomendação do agente: ${item.recomendada}`);
  linhas.push("Letra escolhida:");
  return [
    { role: "system", content: TEMPLATE_SISTEMA },
    { role: "user", content: linhas.join("\n") },
  ];
}

/** A letra de um token do topo, juntando caixa e forma (`c`, `C`, `(c`, ` c`, `c)`); `null` se não é letra. */
export function letraDoToken(token) {
  const m = /^\s*\(?\s*([A-Za-z])\s*\)?\s*$/.exec(String(token ?? ""));
  return m ? m[1].toLowerCase() : null;
}

/**
 * O vetor de um item: soma as variantes da mesma letra, normaliza entre as letras das opções que
 * apareceram no topo, e marca `ausente` a opção fora do topo.
 */
export function vetorDoItem(topo, item) {
  const soma = new Map();
  for (const t of topo ?? []) {
    const letra = letraDoToken(t?.token);
    if (!letra || !item.opcoes.some((o) => o.letra === letra)) continue;
    const p = typeof t.logprob === "number" ? Math.exp(t.logprob) : typeof t.prob === "number" ? t.prob : null;
    if (p === null || !Number.isFinite(p)) continue;
    soma.set(letra, (soma.get(letra) ?? 0) + p);
  }
  const total = [...soma.values()].reduce((a, b) => a + b, 0);
  return item.opcoes.map((o) =>
    soma.has(o.letra) && total > 0
      ? { numero: item.numero, letra: o.letra, p: Math.round((soma.get(o.letra) / total) * 10_000) / 10_000 }
      : { numero: item.numero, letra: o.letra, ausente: true },
  );
}

/** O topo do primeiro token, nas duas formas do llama-server (`top_logprobs` novo, `top_probs` antigo). */
function topoDaResposta(corpo) {
  const primeiro = corpo?.completion_probabilities?.[0] ?? null;
  if (!primeiro) return null;
  return primeiro.top_logprobs ?? primeiro.top_probs ?? null;
}

class Falha extends Error {
  constructor(motivo, detalhe) {
    super(detalhe ?? motivo);
    this.motivo = motivo;
  }
}

function motivoDoErro(e, sinal) {
  if (e instanceof Falha) return e.motivo;
  if (sinal?.aborted || e?.name === "TimeoutError" || e?.name === "AbortError") return "lento";
  const codigo = e?.cause?.code ?? e?.code;
  if (["ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"].includes(codigo)) return "fora";
  return "erro";
}

/** A promessa ou o aborto do sinal, o que vier antes; o ouvinte sai quando a promessa assenta. */
function comAborto(promessa, sinal) {
  if (sinal.aborted) return Promise.reject(sinal.reason);
  let ouvinte;
  const aborto = new Promise((_, nao) => {
    ouvinte = () => nao(sinal.reason);
    sinal.addEventListener("abort", ouvinte, { once: true });
  });
  return Promise.race([promessa, aborto]).finally(() => sinal.removeEventListener("abort", ouvinte));
}

async function postar(fetchFn, url, corpo, { chave, signal }) {
  const r = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(chave ? { authorization: `Bearer ${chave}` } : {}) },
    body: JSON.stringify(corpo),
    signal,
  });
  // 503 é o servidor carregando o modelo: para a sombra, fora.
  if (r.status === 503) throw new Falha("fora", "servidor carregando (503)");
  if (!r.ok) throw new Falha("erro", `servidor respondeu ${r.status}`);
  return r.json();
}

/**
 * Prevê a abertura relida. Devolve `{ vetor, latencia_ms, carga_fria, onde, motivo }`; nunca lança.
 * `fetchFn`, `naGpu` e `teto` são injetáveis (teste com servidor falso).
 */
export async function prever(abertura, { endereco, chave = null, fetchFn = fetch, naGpu = naGpuPadrao, teto = TETO_MS, relogio = () => performance.now() } = {}) {
  const inicio = relogio();
  const sinal = AbortSignal.timeout(teto);
  const decorrido = () => Math.max(0, Math.round(relogio() - inicio));
  let onde = null;
  let carga_fria = null;
  try {
    const itens = itensDaAbertura(abertura);
    if (itens.length === 0) throw new Falha("erro", "abertura sem itens com opcoes");
    const gpu = await comAborto(naGpu({ signal: sinal }), sinal);
    // `null` = não deu para medir (sem `nvidia-smi`, timeout): `erro`, sem afirmar onde rodou.
    if (gpu === null || gpu === undefined) throw new Falha("erro", "nvidia-smi nao respondeu");
    onde = gpu ? "gpu" : "cpu";
    if (!gpu) throw new Falha("fora-da-gpu");
    const vetor = [];
    let frio = false;
    for (const item of itens) {
      const { prompt } = await postar(fetchFn, `${endereco}/apply-template`, { messages: mensagensDoItem(abertura, item), chat_template_kwargs: { enable_thinking: false } }, { chave, signal: sinal });
      if (typeof prompt !== "string" || !prompt) throw new Falha("erro", "apply-template sem prompt");
      const letras = item.opcoes.map((o) => o.letra).join("");
      const corpo = await postar(
        fetchFn,
        `${endereco}/completion`,
        { prompt, n_predict: 1, temperature: 0, n_probs: TOPO_N, grammar: `root ::= [${letras}]`, cache_prompt: true },
        { chave, signal: sinal },
      );
      const topo = topoDaResposta(corpo);
      if (!Array.isArray(topo)) throw new Falha("erro", "resposta sem completion_probabilities");
      const t = corpo.timings;
      if (t && t.prompt_n > 0 && t.prompt_ms / t.prompt_n > MS_POR_TOKEN_FRIO) frio = true;
      vetor.push(...vetorDoItem(topo, item));
    }
    if (sinal.aborted) throw new Falha("lento");
    carga_fria = frio;
    return { vetor, latencia_ms: decorrido(), carga_fria, onde, motivo: null };
  } catch (e) {
    return { vetor: [], latencia_ms: decorrido(), carga_fria, onde, motivo: motivoDoErro(e, sinal) };
  }
}

/** O evento `previsao` da pergunta, sem texto: id, sessão, ciclo, item e título vêm da abertura. */
export function eventoDePrevisao(abertura, resultado, { modelo, versao, carimbo = new Date().toISOString() }) {
  return {
    evento: "previsao",
    pergunta_id: abertura.pergunta_id,
    sessao: abertura.sessao,
    ciclo: abertura.ciclo ?? null,
    carimbo,
    versao_esquema: abertura.versao_esquema ?? null,
    has_patient_data: false,
    item: abertura.item,
    titulo: abertura.titulo,
    modelo,
    versao,
    vetor: resultado.motivo ? [] : resultado.vetor,
    latencia_ms: resultado.latencia_ms,
    carga_fria: resultado.carga_fria,
    onde: resultado.onde,
    motivo: resultado.motivo,
  };
}

/**
 * A sombra da pergunta `pergunta_id`: relê a abertura, confere paciente e previsão já gravada,
 * prevê e grava. Devolve `{ chamou, gravou, motivo, pulou? }`; nunca lança (falha vai a stderr e
 * ao contador). Chamada pelo `comando.mjs abrir` depois de gravar a abertura.
 */
export async function sombrear(
  { pergunta_id },
  { registro, leitura: lida = null, env = process.env, config = null, chave, fetchFn, naGpu, teto = TETO_MS, stderr = process.stderr, contador = arquivoDoContador(env) } = {},
) {
  if (env.VEGA_SISTEMA1 === "off") return { chamou: false, gravou: false, pulou: "desligada" };
  let abertura;
  let cfg;
  try {
    // A leitura que o comando ja fez (uma so ida ao registro), ou a propria.
    const leitura = lida ?? (await registro.ler({ pergunta_id }));
    const eventos = (leitura?.eventos ?? []).filter((e) => e.pergunta_id === pergunta_id);
    abertura = eventos.find((e) => e.evento === "abertura") ?? null;
    if (!abertura) {
      // A pergunta acabou de ser aberta: sem a abertura na releitura, não há prompt nem linha.
      stderr.write(`aviso: sombra: abertura de ${pergunta_id} nao achada na releitura; sem previsao\n`);
      contarFalha(stderr, contador, "sem-abertura");
      return { chamou: false, gravou: false, pulou: "sem-abertura" };
    }
    // Marca de paciente ⇒ o modelo nem é chamado (D-VEGA19-12), e nada se grava.
    if (abertura.has_patient_data !== false) return { chamou: false, gravou: false, pulou: "paciente" };
    // A reabertura idempotente não roda a sombra de novo (D-VEGA19-67).
    if (eventos.some((e) => e.evento === "previsao")) return { chamou: false, gravou: false, pulou: "ja-prevista" };
    cfg = config ?? configDoServico();
  } catch (e) {
    // Antes da chamada (leitura do registro, configuração): não há o que prever nem onde gravar.
    stderr.write(`aviso: sombra: ${e instanceof Error ? e.message : String(e)}\n`);
    contarFalha(stderr, contador, "antes-da-chamada");
    return { chamou: false, gravou: false, motivo: "erro" };
  }
  // `prever` nunca lança: devolve a previsão ou o `sem previsão` com o motivo.
  let resultado = { vetor: [], latencia_ms: null, carga_fria: null, onde: null, motivo: "erro" };
  try {
    resultado = await prever(abertura, {
      endereco: cfg.endereco,
      chave: chave === undefined ? chaveDaApi(env) : chave,
      ...(fetchFn ? { fetchFn } : {}),
      ...(naGpu ? { naGpu } : {}),
      teto,
    });
  } finally {
    // Sempre grava a linha (`previsao` ou `sem previsão` com o motivo); a falha vai a stderr e ao contador.
    try {
      const ev = eventoDePrevisao(abertura, resultado, { modelo: cfg.modelo, versao: cfg.versao });
      const r = await registro.gravar("prever", [ev]);
      if (r?.sem_registro) stderr.write("aviso: sombra: previsao na fila local (registro fora do ar)\n");
      resultado = { ...resultado, gravou: true };
    } catch (e) {
      stderr.write(`aviso: sombra: a linha da previsao nao gravou (${e instanceof Error ? e.message : String(e)})\n`);
      contarFalha(stderr, contador, "gravacao");
      resultado = { ...resultado, gravou: false };
    }
  }
  return { chamou: true, gravou: resultado.gravou, motivo: resultado.motivo };
}
