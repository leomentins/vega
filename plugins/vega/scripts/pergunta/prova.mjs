// .claude/skills/vega/scripts/pergunta/prova.mjs
// VEGA-19 T33 (AC-VEGA19-7; D-VEGA19-45, D-VEGA19-57) — o leitor de prova do plugin: reconfere a
// `autoria` de uma resposta contra o transcript da sessão da abertura e devolve a origem efetiva.
//
// O contrato é o de `origemEfetiva`/`conferirProva`/`perguntaDoAutorizar` da lib da Sistoli
// (`.claude/scripts/estado/lib/pergunta.mjs`), sem importá-la: o corpo do plugin não puxa
// biblioteca de projeto nenhum (fronteira do plugin, D-VEGA19-37). Quem usa é o registro de
// perguntas do destino `git` do embutido `superpowers` (`consentimentoDoProjeto`), para o
// `autorizar-ciclo --pergunta` conferir a pergunta citada também em projeto sem código próprio de
// adaptador. As três formas de prova:
//   - `transcript:<caminho>#<uuid>` — a entrada `uuid` do transcript é mensagem humana, da sessão da
//     abertura, com carimbo posterior a ela e as escolhas no texto;
//   - `get_event:<sessão do hub>#<uuid>` — a entrada `uuid` é o resultado de um `get_event` sobre o
//     recibo da `autoria`, e o evento devolvido confere;
//   - `entre-sessoes:<sessão de origem>#<uuid>` — a entrada `uuid` é mensagem entre sessões daquela
//     origem, de remetente aceito, posterior à abertura e com as escolhas no texto.
// `autoria` sem prova, com prova que não resolve ou só com origem `agente` não sobe a origem: a
// resposta fica `agente`, e o núcleo recusa o sim (`origem-sem-prova`).
//
// Paridade: `__tests__/prova.test.mjs` roda os mesmos casos contra esta porta e, na fonte, contra
// a lib da Sistoli; divergência de veredito reprova.
import { escolhasCitadas, escolhasDoTexto } from "./escolhas.mjs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Força das origens, da mais forte (D-VEGA19-27; a mesma ordem da lib da Sistoli). */
export const FORCA_DAS_ORIGENS = Object.freeze(["digitado", "digitado-no-hub-conferido", "repasse-hub"]);

const CROSS_SESSION = /^\s*<cross-session-message from-session="([^"]+)">\s*([\s\S]*?)\s*(?:<\/cross-session-message>\s*)?$/;
const RECIBO = /^\s*(?:[-*•>]\s*)?Recibo:\s*([A-Za-z0-9_-]{1,128})\s+([A-Za-z0-9_-]{1,128})\s*$/m;
const SEM_TAGS_DO_SISTEMA = /<(system-reminder|command-[a-z]+|local-command-[a-z]+|pasted_content)\b[^>]*>[\s\S]*?<\/\1>/g;

/** Texto dos blocos `text` de uma entrada (sem `tool_result`), sem o que o sistema injeta. */
export function textoHumanoDe(entrada) {
  const c = entrada?.message?.content;
  const bruto = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n") : "";
  return bruto.replace(SEM_TAGS_DO_SISTEMA, "").trim();
}

/**
 * Mensagem digitada pelo operador: `user`, `origin.kind` humano, sem `isMeta`, com texto. Vale
 * tambem a que chega no meio do turno junto de um resultado de ferramenta (heranca do coletor,
 * item 8): o texto e o dos blocos `text`, o `tool_result` fica de fora.
 */
export function ehMensagemHumana(e) {
  return e?.type === "user" && e?.origin?.kind === "human" && !e.isMeta && !e.isSynthetic && textoHumanoDe(e) !== "";
}

/** Mensagem entre sessoes: `{ de, texto }` ou `null`. */
export function mensagemEntreSessoes(e) {
  if (e?.type !== "user") return null;
  const c = e.message?.content;
  const bruto = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n") : "";
  const m = CROSS_SESSION.exec(bruto);
  return m ? { de: m[1], texto: m[2] } : null;
}

/** A linha `Recibo: <sessao do hub> <evento>` do repasse: `{ sessao, evento }` ou `null`. */
export function reciboDoTexto(texto) {
  const m = RECIBO.exec(String(texto ?? ""));
  return m ? { sessao: m[1], evento: m[2] } : null;
}

/**
 * As escolhas que a resposta do operador declara: a regra ancorada de `escolhas.mjs` (hotfix
 * vega-escolha-nao-e-citacao, 24/11/2026) — `D6a`, `6a`, `6 - a` e a linha `Decisão 6: a`, no
 * começo da linha ou na sequência que começa nele; a letra citada num texto livre não vale.
 * `{ escolhas, conflito, livres }`. A leitura solta, para o texto que cita decisões (mensagem entre
 * sessões), é `escolhasCitadas`.
 */
export { escolhasCitadas, escolhasDoTexto, LIVRE_NUMERADO } from "./escolhas.mjs";

/**
 * O texto traz cada escolha (numero e letra do item, ou `sim`)? Escolha vazia nunca casa. Com
 * `itemUnico` (a abertura tem um item so), vale tambem a letra sozinha no inicio do texto (`b`,
 * `(b), mas …`) — a letra unica do bloco de um item (AC-VEGA19-2). A conferência le solto
 * (`escolhasCitadas`, unida à ancorada): a prova confere que as escolhas ja derivadas estao no texto, nao as deriva —
 * e a prova e relida a cada leitura, entao apertar aqui rebaixaria a origem de respostas antigas.
 */
export function textoCasaEscolhas(texto, escolhas, { itemUnico = false } = {}) {
  if (!Array.isArray(escolhas) || escolhas.length === 0) return false;
  // A uniao das duas leituras: a solta (a citacao segue provando) e a ancorada (as formas que so ela
  // le, `4 - a`, `16-a, mas`, que o `responder` ja grava como escolha).
  const achadas = [...escolhasCitadas(texto).escolhas, ...escolhasDoTexto(texto).escolhas];
  if (itemUnico && achadas.length === 0 && escolhas.length === 1 && escolhas[0].letra !== "sim") {
    const m = /^\s*\(?([a-z])\)?\s*(?:$|[,.;:!—–-])/i.exec(String(texto ?? ""));
    return Boolean(m) && m[1].toLowerCase() === escolhas[0].letra;
  }
  return escolhas.every((e) => {
    if (e.letra === "sim" && e.numero == null) return /(?<![A-Za-z])sim(?![A-Za-z])/i.test(String(texto ?? ""));
    return achadas.some((a) => a.numero === e.numero && a.letra === e.letra);
  });
}

/**
 * O resultado do `get_event` de uma entrada `user` com `tool_result`: `{ entrada, chamada, erro,
 * evento }`. `chamada` = `{ sessao, evento }` (a entrada da ferramenta); `evento` = o JSON devolvido,
 * ou `null` se ilegivel. `chamadas` mapeia `tool_use_id` → `{ sessao, evento }`.
 */
export function resultadoDoGetEvent(e, chamadas) {
  const c = e?.message?.content;
  if (e?.type !== "user" || !Array.isArray(c)) return null;
  for (const b of c) {
    if (b?.type !== "tool_result" || !chamadas.has(b.tool_use_id)) continue;
    const chamada = chamadas.get(b.tool_use_id);
    if (b.is_error === true) return { entrada: e, chamada, erro: true, evento: null };
    const texto = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.filter((x) => x?.type === "text").map((x) => x.text ?? "").join("\n") : "";
    return { entrada: e, chamada, erro: false, evento: eventoDoTextoDoGetEvent(texto) };
  }
  return null;
}

/** O embrulho de dado de outra sessao: `<other-session …>` + aviso + JSON + `</other-session…>`. */
const EMBRULHO_DE_OUTRA_SESSAO = /^\s*<other-session\b[^>]*>([\s\S]*)<\/other-session\b[^>]*>\s*$/;

function jsonOuNull(s) {
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/**
 * O evento que o texto do resultado do `get_event` traz, ou `null` (fail-closed, D-VEGA19-50). Aceita
 * o JSON cru do evento e o resultado real da ferramenta: embrulhado como dado de outra sessao (o JSON
 * e o trecho do embrulho da primeira linha que abre `{` ao ultimo `}`) e com o evento em
 * `ccr.data[0]` — exatamente um. Embrulho sem fecho, JSON torto ou `data` com zero ou mais de um
 * evento ⇒ `null`. Exportado para teste.
 */
export function eventoDoTextoDoGetEvent(texto) {
  const s = String(texto ?? "");
  let o = jsonOuNull(s);
  if (!o) {
    const m = EMBRULHO_DE_OUTRA_SESSAO.exec(s);
    if (!m) return null;
    const corpo = m[1];
    const ini = corpo.search(/^\s*\{/m);
    const fim = corpo.lastIndexOf("}");
    if (ini < 0 || fim < ini) return null;
    o = jsonOuNull(corpo.slice(ini, fim + 1));
    if (!o) return null;
  }
  if (o.ccr !== undefined) {
    const data = o.ccr?.data;
    if (!Array.isArray(data) || data.length !== 1) return null;
    const [ev] = data;
    return ev && typeof ev === "object" && !Array.isArray(ev) ? ev : null;
  }
  return o;
}

/** A mensagem do evento do hub na forma do `get_event` real: `user.internal_anthropic_catchall`. */
const catchallDoHub = (ev) => ev?.user?.internal_anthropic_catchall ?? null;
const mensagemDoHub = (ev) => catchallDoHub(ev)?.message ?? null;

/** As chamadas de `get_event` das entradas: `Map(tool_use_id → { sessao, evento })`. */
export function chamadasDeGetEvent(entradas) {
  const m = new Map();
  for (const e of entradas) {
    if (e?.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b?.type === "tool_use" && /(^|__)get_event$/.test(b.name ?? "")) m.set(b.id, { sessao: b.input?.session_id ?? null, evento: b.input?.event_uuid ?? null });
    }
  }
  return m;
}

/** Texto de um evento devolvido pelo `get_event` (`content` texto ou blocos). */
function textoDoEventoDoHub(ev) {
  const c = ev?.content ?? ev?.message?.content ?? mensagemDoHub(ev)?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n");
  return "";
}

/**
 * O evento do hub confere? `user`, sem `isSynthetic`, texto com as escolhas, recebido depois da
 * abertura. Devolve `null` (confere) ou o motivo curto. Le o evento cru e a forma do `get_event`
 * real (`user.internal_anthropic_catchall.message`, D-VEGA19-50); a marca de sintetico em qualquer
 * das camadas reprova.
 */
export function eventoDoHubConfere(ev, { escolhas, abertaEm, livre = null }) {
  if (!ev) return "nao-confere";
  const catchall = catchallDoHub(ev);
  const msg = mensagemDoHub(ev);
  // Na forma real, o papel e o da mensagem (`user` e a chave do lado, nao o papel).
  const papel = msg ? msg.role : (ev.role ?? ev.type ?? ev.message?.role);
  if (papel !== "user") return "nao-confere";
  const sintetico = [ev, ev.user, catchall, msg].some((x) => x?.isSynthetic === true || x?.is_synthetic === true);
  if (sintetico) return "nao-confere";
  const quando = Date.parse(ev.created_at ?? ev.timestamp ?? catchall?.created_at ?? catchall?.timestamp ?? msg?.created_at ?? "");
  if (!Number.isFinite(quando) || !(quando > Date.parse(abertaEm))) return "nao-confere";
  // Texto livre do operador no hub (hotfix resposta-livre-maestra, 24/11/2026): `livre === true`,
  // texto sem numero nem letra de item; `livre` string, o literal gravado. Paridade com a lib.
  if ((!Array.isArray(escolhas) || escolhas.length === 0) && livre !== null) {
    const texto = textoDoEventoDoHub(ev);
    return ehTextoLivre(texto) && (livre === true || textoLivreCasa(texto, livre)) ? null : "nao-confere";
  }
  return textoCasaEscolhas(textoDoEventoDoHub(ev), escolhas) ? null : "nao-confere";
}

/** O literal que o `responder` grava no lugar do texto livre de pergunta com dado de paciente (D-VEGA19-12). */
export const LITERAL_LIVRE_RETIDO = "(texto livre retido: pergunta com dado de paciente)";

/** O texto prova a alternativa livre de literal `livre` (sem numero e letra; espacos e caixa nao contam). Paridade com a lib. */
export function textoLivreCasa(texto, livre) {
  const t = String(texto ?? "");
  if (escolhasDoTexto(t).escolhas.length > 0 || livre === LITERAL_LIVRE_RETIDO) return false;
  const norm = (x) => String(x ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!norm(t)) return false;
  return norm(t) === norm(livre);
}

/** O texto e alternativa livre: tem conteudo, sem numero e letra de item, e nao e a letra sozinha. Paridade com a lib. */
export function ehTextoLivre(texto) {
  const t = String(texto ?? "").trim();
  if (!t || escolhasDoTexto(t).escolhas.length > 0) return false;
  // Pergunta de volta nao e resposta; numero de item sem letra (`3`, `D3`, `3-texto`) e do item, nao livre.
  if (/\?/.test(t) || /^\(?D?\d{1,4}(?![0-9])/i.test(t)) return false;
  return !/^\(?[a-z]\)?\s*(?:$|[,.;:!—–-])/i.test(t);
}
/** A 1a linha do repasse livre: `RESPOSTA <p-…>`, nada mais nela. */
const CABECALHO_DA_RESPOSTA_LIVRE = /^\s*RESPOSTA\s+(p-[0-9a-f]{16})\s*$/;

/** A pergunta que o repasse nomeia na 1a linha nao vazia, sem escolha no texto; ou `null`. Exportado. */
export function perguntaDoRepasseLivre(texto) {
  const s = String(texto ?? "");
  const primeira = s.split("\n").find((l) => l.trim() !== "") ?? "";
  const m = CABECALHO_DA_RESPOSTA_LIVRE.exec(primeira);
  if (!m || escolhasCitadas(s).escolhas.length > 0) return null;
  return m[1];
}

/**
 * O recibo `<sessao> <evento>` esta amarrado a `pergunta_id` no transcript: algum repasse livre
 * (`RESPOSTA <p-…>` com esse `Recibo:`) nomeia esta pergunta, e nenhum nomeia outra com o mesmo
 * recibo. Um evento e recibo de uma pergunta so (hotfix resposta-livre-maestra). Exportado.
 */
export function reciboAmarrado(entradas, { pergunta_id, recibo }) {
  const alvo = String(recibo ?? "").trim().split(/\s+/).join(" ");
  if (!alvo) return false;
  const donas = new Set();
  for (const x of entradas ?? []) {
    const msg = mensagemEntreSessoes(x);
    if (!msg) continue;
    const pid = perguntaDoRepasseLivre(msg.texto);
    const r = pid ? reciboDoTexto(msg.texto) : null;
    if (r && `${r.sessao} ${r.evento}` === alvo) donas.add(pid);
  }
  return donas.size === 1 && donas.has(pergunta_id);
}


/** Le um transcript inteiro como entradas (linha torta pula). `null` se nao existe. */
export function lerTranscript(arquivo) {
  let texto;
  try {
    texto = readFileSync(arquivo, "utf8");
  } catch {
    return null;
  }
  const out = [];
  for (const l of texto.split("\n")) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      /* linha torta */
    }
  }
  return out;
}

/**
 * O transcript de uma sessao, pelas pastas de projeto do Claude Code (`$CLAUDE_CONFIG_DIR` e as
 * `~/.claude*`): `<config>/projects/<qualquer>/<sessao>.jsonl`. `null` se nenhum.
 */
export function acharTranscript(sessao, { env = process.env, home = homedir() } = {}) {
  if (typeof sessao !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sessao)) return null;
  const configs = new Set();
  if (env.CLAUDE_CONFIG_DIR) configs.add(env.CLAUDE_CONFIG_DIR);
  try {
    for (const n of readdirSync(home)) if (/^\.claude(-[A-Za-z0-9_-]+)?$/.test(n)) configs.add(path.join(home, n));
  } catch {
    /* sem home legivel */
  }
  for (const c of configs) {
    let projetos;
    try {
      projetos = readdirSync(path.join(c, "projects"));
    } catch {
      continue;
    }
    for (const p of projetos) {
      const alvo = path.join(c, "projects", p, `${sessao}.jsonl`);
      if (existsSync(alvo)) return alvo;
    }
  }
  return null;
}

/** As escolhas que a prova tem de trazer: as da resposta, ou `sim` no consentimento. */
export function escolhasDaResposta(resposta) {
  if (!resposta) return [];
  if (Array.isArray(resposta.escolhas) && resposta.escolhas.length > 0) {
    return resposta.escolhas
      .filter((e) => e && typeof e === "object" && e.letra != null)
      .map((e) => ({ numero: e.numero == null ? null : Number(e.numero), letra: String(e.letra).toLowerCase() }));
  }
  const literal = String(resposta.resposta_literal ?? "").trim();
  if (/^sim\b/i.test(literal)) return [{ numero: null, letra: "sim" }];
  const lidas = escolhasDoTexto(literal).escolhas;
  if (lidas.length > 0) return lidas;
  // Resposta de letra unica (`escolha`) num item so: o numero vem do `item` (`D6`).
  const n = /^D(\d{1,4})$/.exec(String(resposta.item ?? ""));
  return n && resposta.escolha ? [{ numero: Number(n[1]), letra: String(resposta.escolha).toLowerCase() }] : [];
}

const PROVA_LIDA = /^(transcript|get_event|entre-sessoes):([^\s#]{1,400})#([A-Za-z0-9_-]{1,128})$/;

/**
 * O id de sessao da nuvem — `session_…` da sessao remota, `cse_…` da ponte do app. Nunca e o nome
 * de um transcript local: a prova nao se acha por ele (hotfix pergunta-nao-pede-resposta-duas-vezes,
 * 20/11/2026). O `comando.mjs abrir` recusa a mesma forma. Paridade com a lib da Sistoli.
 */
export const SESSAO_DE_NUVEM = /^(?:session|cse)_/;

/**
 * A sessao cujo transcript reconfere a prova: `{ sessao, daAutoria }` ou `null`. E a da abertura.
 * Aberta com id de nuvem, e a da `autoria` (o gancho grava a sessao do transcript em que pareou a
 * resposta), e a prova pede mais (`daAutoria`): o bloco da pergunta, com a marca dela, saiu nesse
 * transcript antes da mensagem. So a resposta digitada depois de ver o bloco conta (D-VEGA19-27).
 */
function sessaoDaProva(autoria, abertura) {
  if (!SESSAO_DE_NUVEM.test(abertura.sessao)) return { sessao: abertura.sessao, daAutoria: false };
  const s = autoria?.sessao;
  return typeof s === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(s) && !SESSAO_DE_NUVEM.test(s) ? { sessao: s, daAutoria: true } : null;
}

/** Texto bruto de uma entrada, com o de `tool_result` (a saida do `comando.mjs abrir`). */
function textoBrutoDe(e) {
  const c = e?.message?.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  const partes = [];
  for (const b of c) {
    if (b?.type === "text") partes.push(b.text ?? "");
    else if (b?.type === "tool_result") {
      if (typeof b.content === "string") partes.push(b.content);
      else if (Array.isArray(b.content)) for (const x of b.content) if (x?.type === "text") partes.push(x.text ?? "");
    }
  }
  return partes.join("\n");
}

/** A marca do bloco de `pergunta_id` saiu numa entrada da `sessao` ate `ate` (ms)? Id torto ⇒ nao. */
function blocoMostradoAntes(entradas, { sessao, pergunta_id, ate }) {
  if (!/^p-[0-9a-f]{16}$/.test(pergunta_id ?? "") || !Number.isFinite(ate)) return false;
  const marca = new RegExp(`<!--\\s*pergunta\\s+${pergunta_id}(?:\\s*·\\s*sem registro)?\\s*-->`);
  return entradas.some((x) => x?.sessionId === sessao && Date.parse(x?.timestamp ?? "") <= ate && marca.test(textoBrutoDe(x)));
}

/**
 * O conserto que o agente faz sozinho, sem pedir nada ao operador, quando a resposta citada pelo
 * `autorizar-ciclo` nao tem prova de origem humana: o nucleo o acrescenta a recusa
 * `origem-sem-prova`. `null` com origem humana ou sem resposta. Paridade com a lib da Sistoli.
 */
export function consertoDaOrigem({ abertura, motivo }) {
  if (motivo !== "sem-autoria" && motivo !== "prova-nao-resolve") return null;
  const id = abertura?.pergunta_id ?? "a pergunta";
  if (SESSAO_DE_NUVEM.test(abertura?.sessao ?? ""))
    return `conserto sem o operador: ${id} foi aberta com id de nuvem, e a prova se le pelo transcript da sessao que mostrou o bloco; nessa sessao, procure a resposta digitada depois do bloco, com o numero e a letra: achou, rode o autorizar de novo no turno seguinte, sem pedir a resposta outra vez (reabrir no mesmo ciclo com o mesmo conteudo e o mesmo destinatario devolve o mesmo id); nao achou, a pergunta segue aberta`;
  if (motivo === "sem-autoria")
    return `conserto sem o operador: procure no transcript a resposta digitada depois do bloco de ${id}, com o numero e a letra; achou, rode o autorizar de novo no turno seguinte (o gancho grava a autoria no fim do turno); so sem ela a pergunta segue aberta`;
  return `conserto sem o operador: a autoria de ${id} nao se reconfere no transcript da sessao da abertura; rode o autorizar nesta maquina, onde esse transcript existe`;
}

/**
 * Reconfere uma prova contra a pergunta. Devolve `null` (resolve) ou o motivo curto. A regra e a
 * mesma do gancho que a gravou e a que a T16 usa:
 *   - `transcript:<caminho>#<uuid>` — a entrada `uuid` do transcript e mensagem humana, da sessao da
 *     abertura, com carimbo posterior a ela e as escolhas no texto;
 *   - `get_event:<sessao do hub>#<uuid>` — no transcript da sessao da abertura, a entrada `uuid` e o
 *     resultado de um `get_event` sobre o recibo da linha (sessao e evento), e o evento devolvido
 *     confere (`eventoDoHubConfere`);
 *   - `entre-sessoes:<sessao de origem>#<uuid>` — no transcript da sessao da abertura, a entrada
 *     `uuid` e mensagem entre sessoes daquela origem, de remetente aceito (a do recibo ou hub
 *     declarado), posterior a abertura e com as escolhas no texto.
 */
export function conferirProva(autoria, { abertura, escolhas, livre = null, lerEntradas = lerTranscript, achar = acharTranscript, sessoesDeHub = [] }) {
  const m = PROVA_LIDA.exec(String(autoria?.prova ?? ""));
  if (!m || !abertura?.carimbo || !abertura?.sessao) return "prova-nao-resolve";
  const [, forma, onde, uuid] = m;
  const abertaEm = Date.parse(abertura.carimbo);
  const itemUnico = Array.isArray(abertura.itens) && abertura.itens.length === 1;
  const depois = (e) => Date.parse(e?.timestamp ?? "") > abertaEm;
  // As tres formas leem o transcript DA SESSAO DA ABERTURA, achado pela pasta do Claude Code; na
  // `transcript:` o caminho gravado tem de ser esse mesmo — arquivo fabricado em outro lugar nao prova.
  // Abertura gravada com id de nuvem: a sessao e a da autoria, com o bloco exigido (`sessaoDaProva`).
  const ancora = sessaoDaProva(autoria, abertura);
  if (!ancora) return "prova-nao-resolve";
  const arquivo = achar(ancora.sessao);
  if (!arquivo || (forma === "transcript" && path.resolve(onde) !== path.resolve(arquivo))) return "prova-nao-resolve";
  const entradas = lerEntradas(arquivo);
  if (!entradas) return "prova-nao-resolve";
  const e = entradas.find((x) => x?.uuid === uuid);
  if (!e || e.sessionId !== ancora.sessao) return "prova-nao-resolve";
  if (ancora.daAutoria && !blocoMostradoAntes(entradas, { sessao: ancora.sessao, pergunta_id: abertura.pergunta_id, ate: Date.parse(e.timestamp ?? "") })) return "prova-nao-resolve";
  const semEscolha = !Array.isArray(escolhas) || escolhas.length === 0;
  if (forma === "transcript") {
    if (semEscolha && livre !== null) return ehMensagemHumana(e) && depois(e) && textoLivreCasa(textoHumanoDe(e), livre) ? null : "prova-nao-resolve";
    return ehMensagemHumana(e) && depois(e) && textoCasaEscolhas(textoHumanoDe(e), escolhas, { itemUnico }) ? null : "prova-nao-resolve";
  }
  if (forma === "entre-sessoes") {
    const msg = mensagemEntreSessoes(e);
    if (!msg || msg.de !== onde || !depois(e)) return "prova-nao-resolve";
    const recibo = reciboDoTexto(msg.texto);
    const aceito = sessoesDeHub.includes(msg.de) || (recibo && recibo.sessao === msg.de);
    return aceito && textoCasaEscolhas(msg.texto, escolhas) ? null : "prova-nao-resolve";
  }
  // get_event
  const recibo = typeof autoria.recibo === "string" ? autoria.recibo.trim().split(/\s+/) : [];
  if (recibo.length !== 2 || recibo[0] !== onde) return "prova-nao-resolve";
  const r = resultadoDoGetEvent(e, chamadasDeGetEvent(entradas));
  if (!r || r.erro || r.chamada.sessao !== recibo[0] || r.chamada.evento !== recibo[1]) return "prova-nao-resolve";
  // O texto livre nao se amarra a pergunta pelo conteudo: amarra-se pelo repasse que a nomeia.
  if (semEscolha && livre !== null && !reciboAmarrado(entradas, { pergunta_id: abertura.pergunta_id, recibo: autoria.recibo })) return "prova-nao-resolve";
  return eventoDoHubConfere(r.evento, { escolhas, abertaEm: abertura.carimbo, livre: semEscolha ? livre : null }) === null ? null : "prova-nao-resolve";
}

/**
 * A origem efetiva da resposta de `pergunta_id`, o unico caminho de leitura da origem. Junta os
 * eventos da pergunta, tenta as `autoria` da mais forte para a mais fraca e devolve
 * `{ origem, quem, mandato, em_nome_de, recibo, prova, motivo, autorias }` (D-VEGA19-54, T41;
 * acompanhado pela T47, D-VEGA19-59): `origem` (como chegou) e a da primeira que resolve, com quem
 * respondeu, o mandato, em nome de quem e o recibo dela (o que falta nela vem da `resposta`);
 * nenhuma resolve ⇒ `agente`, `quem` nulo, com `motivo` `prova-nao-resolve` (havia autoria) ou
 * `sem-autoria`. Sem resposta, tudo `null`. `em_nome_de` so passa adiante o que a autoria grava —
 * hoje nada, ate a T42 trazer a matriz de titulares. `padrao-da-fabrica` (T27) nao passa por aqui:
 * nao e resposta do operador.
 */
export function origemEfetiva(pergunta_id, { eventos, lerEntradas = lerTranscript, achar = acharTranscript, sessoesDeHub = [] } = {}) {
  const daPergunta = (eventos ?? []).filter((e) => e?.pergunta_id === pergunta_id);
  const abertura = daPergunta.find((e) => e.evento === "abertura") ?? null;
  const resposta = daPergunta.find((e) => e.evento === "resposta") ?? null;
  const autorias = daPergunta.filter((e) => e.evento === "autoria" && FORCA_DAS_ORIGENS.includes(e.origem_resposta));
  const nulos = { quem: null, mandato: null, em_nome_de: null, recibo: null };
  if (!resposta) return { origem: null, ...nulos, prova: null, motivo: "sem-resposta", autorias: autorias.length };
  // Sem autoria que resolva, ninguem e dado como quem respondeu; mandato e recibo seguem os da resposta.
  const doAgente = (motivo) => ({ origem: "agente", ...nulos, mandato: resposta.mandato ?? null, recibo: resposta.recibo ?? null, prova: null, motivo, autorias: autorias.length });
  if (autorias.length === 0) return doAgente("sem-autoria");
  const escolhas = escolhasDaResposta(resposta);
  // A alternativa livre gravada pelo `responder` (sem escolha) prova pelo texto do operador.
  const livre = escolhas.length === 0 && resposta.alternativa_livre === true ? String(resposta.resposta_literal ?? "") : null;
  const ordenadas = [...autorias].sort((a, b) => FORCA_DAS_ORIGENS.indexOf(a.origem_resposta) - FORCA_DAS_ORIGENS.indexOf(b.origem_resposta));
  for (const a of ordenadas) {
    if (conferirProva(a, { abertura, escolhas, livre, lerEntradas, achar, sessoesDeHub }) === null) {
      return {
        origem: a.origem_resposta,
        quem: a.quem ?? null,
        mandato: a.mandato ?? resposta.mandato ?? null,
        em_nome_de: a.em_nome_de ?? null,
        recibo: a.recibo ?? resposta.recibo ?? null,
        prova: a.prova,
        motivo: null,
        autorias: autorias.length,
      };
    }
  }
  return doAgente("prova-nao-resolve");
}

/**
 * A pergunta que o `autorizar-ciclo --pergunta` cita, lida para o nucleo da conducao conferir
 * (D-VEGA19-41, D-VEGA19-44): a origem efetiva da resposta, a ABERTURA (ciclo, ponteiro e itens
 * com as opcoes) e as escolhas da resposta. Quem confere ciclo, fase, opcao e texto e o nucleo
 * (`exigirPerguntaDoAutorizar`); aqui so se le. Sem abertura, `abertura` sai `null`.
 */
export function perguntaDoAutorizar(pergunta_id, { eventos, lerEntradas = lerTranscript, achar = acharTranscript, sessoesDeHub = [] } = {}) {
  const daPergunta = (eventos ?? []).filter((e) => e?.pergunta_id === pergunta_id);
  const ab = daPergunta.find((e) => e.evento === "abertura") ?? null;
  const resposta = daPergunta.find((e) => e.evento === "resposta") ?? null;
  const o = origemEfetiva(pergunta_id, { eventos, lerEntradas, achar, sessoesDeHub });
  return {
    origem: o.origem,
    motivo: o.motivo,
    conserto: consertoDaOrigem({ abertura: ab, motivo: o.motivo }),
    abertura: ab ? { evento: "abertura", pergunta_id, ciclo: ab.ciclo ?? null, ponteiro: ab.ponteiro ?? null, itens: ab.itens ?? [], carimbo: ab.carimbo ?? null } : null,
    escolhas: escolhasDaResposta(resposta),
  };
}
