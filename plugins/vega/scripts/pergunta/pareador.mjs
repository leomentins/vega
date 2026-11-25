// .claude/skills/vega/scripts/pergunta/pareador.mjs
// Hotfix vega-pareador-no-plugin (25/11/2026; decisão 27a do operador) — o pareador de autoria do
// plugin: lê o transcript da sessão e grava a `autoria` de cada resposta a uma pergunta registrada
// no registro git do projeto (`.vega/sessao-<id>.jsonl`, a pasta do `decisoes.arquivo`).
//
// Por que existe: até a 0.1.16 o plugin só LIA a autoria (`prova.mjs`); quem a gravava era o
// gancho de projeto da Sistoli (`.claude/hooks/decisao-do-operador.mjs`), que não sai na vitrine.
// Num consumidor, a resposta ficava `agente` e todo sim de ciclo recusava `origem-sem-prova`
// (débito ae-vega-autoria-sem-pareador-no-consumidor, ENSAIO-1 do hub).
//
// O contrato é o do pareador da fonte (secção PAREADOR do gancho da Sistoli), sem importá-lo
// (fronteira do plugin, D-VEGA19-37), com as mesmas recusas:
//   - mensagem DIGITADA pelo operador (`ehMensagemHumana`: `user`, `origin.kind` humano, sem
//     `isMeta` nem `isSynthetic`) que casa pelo número do item ⇒ `autoria` `digitado`, prova
//     `transcript:<transcript>#<uuid>`;
//   - mensagem entre sessões (`send_message`) que nomeia o `pergunta_id` e casa pelo número, de
//     remetente aceito (a sessão do `Recibo:`): recibo conferido pelo `get_event` chamado nesta
//     sessão ⇒ `digitado-no-hub-conferido`, prova `get_event:<sessão>#<uuid do resultado>`; senão
//     `repasse-hub`, prova `entre-sessoes:<origem>#<uuid>`, com o motivo no `detalhe`;
//   - outro remetente ⇒ `autoria` `agente`, que não vale; o relato que cita a mesma escolha já
//     casada não grava nada.
// O texto de uma mensagem entre sessões NUNCA vira `digitado`: só a releitura do evento do operador
// pela plataforma (`get_event`) sobe a origem, e o evento sintético não confere (`eventoDoHubConfere`).
// Quem reconfere tudo é `prova.mjs` (`origemEfetiva`), a cada leitura: o pareador só aponta.
//
// Fora deste corte (seguem só na fonte): a alternativa livre sem número e "recomendadas", a
// pergunta sobre achado (destino da opção), as decisões da maestra e o destino banco. A mensagem
// que não casa não grava nada.
//
// As aberturas vêm do registro (itens e opções, a fonte de verdade) e da marca
// `<!-- pergunta p-… -->` no transcript, que diz que o bloco foi mostrado aqui e quando: só a
// pergunta mostrada aqui casa pela forma curta (`1a`, a letra sozinha logo depois do bloco); a do
// registro sem marca aqui casa só por `D<n><letra>` ou pelo id nomeado.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { escolhasCitadas, escolhasDoTexto } from "./escolhas.mjs";
import { MANDATOS, mandatoDoPapel } from "./forma.mjs";
import {
  acharTranscript,
  chamadasDeGetEvent,
  ehMensagemHumana,
  escolhasDaResposta,
  eventoDoHubConfere,
  FORCA_DAS_ORIGENS,
  lerTranscript,
  mensagemEntreSessoes,
  reciboDoTexto,
  resultadoDoGetEvent,
  SESSAO_DE_NUVEM,
  textoHumanoDe,
} from "./prova.mjs";

export const VERSAO_DO_ESQUEMA = 1;
const PERGUNTA_ID_RE = /^p-[0-9a-f]{16}$/;
const SESSAO_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PREFIXO_DA_SESSAO = "sessao-";
const MARCA = /<!--\s*pergunta\s+(p-[0-9a-f]{16})(?:\s*·\s*sem registro)?\s*-->/g;
const PERGUNTA_ID_NO_TEXTO = /\bp-[0-9a-f]{16}\b/g;
const LETRA_SOZINHA = /^\s*\(?([a-z])\)?\s*(?:$|[,.;:!—–-])/i;
const ITEM_COM_D = /(?<![A-Za-z0-9])D(\d{1,4})[a-z](?![A-Za-z0-9])/g;
const RESPOSTA_NOMEADA = /\bRESPOSTA\s+(p-[0-9a-f]{16})\b\s*[:—–-]?\s*\(?([a-z])\)?(?![A-Za-z0-9])/i;
const RESPONDER_DO_COMANDO = /comando\.mjs["']?\s+responder\b/;
/** A sessão das perguntas de consentimento da condução: não é do operador, não pareia. */
const SESSAO_DO_CONSENTIMENTO = "conducao-consentimento";
/** Os eventos que o pareador grava. */
export const EVENTOS_DO_PAREADOR = Object.freeze(["autoria", "resposta"]);
/** CPF e CNS, fora de palavra: a forma, nunca o valor, vai à mensagem. */
const FORMAS_DE_PACIENTE = Object.freeze([/(?<![\d.])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/, /(?<!\d)\d{3}[ .]?\d{4}[ .]?\d{4}[ .]?\d{4}(?!\d)/]);

/** Texto bruto de uma entrada, com o de `tool_result` (a saída do `comando.mjs abrir`). */
export function textoBrutoDe(e) {
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

/** O mandato da abertura: o da rota `para`; sem ele, o padrão do papel; sem papel, `null` (não se adivinha). */
export function mandatoDaAbertura(ev) {
  const m = ev?.rota?.para?.mandato;
  if (MANDATOS.includes(m)) return m;
  const papel = ev?.rota?.para?.papel ?? ev?.papel ?? null;
  if (typeof papel !== "string" || !papel) return null;
  try {
    return mandatoDoPapel(papel);
  } catch {
    return null;
  }
}

/**
 * A abertura do registro na forma do pareador, ou `null` sem item com opções. O registro git só
 * guarda pergunta sem dado de paciente (o gravador recusa a outra), então nada aqui é restrito.
 */
export function aberturaDoRegistro(ev, { carimbo = ev?.carimbo ?? null, doRegistro = true } = {}) {
  if (ev?.evento !== "abertura" || !PERGUNTA_ID_RE.test(ev.pergunta_id ?? "")) return null;
  const unico = Array.isArray(ev.itens) && ev.itens.length === 1;
  const itens = (Array.isArray(ev.itens) ? ev.itens : [])
    .map((it) => ({
      numero: Number.isInteger(it?.numero) ? it.numero : null,
      letras: (Array.isArray(it?.opcoes) ? it.opcoes : []).map((o) => String(o?.letra ?? "").toLowerCase()).filter(Boolean),
      titulo: it?.titulo ?? (unico ? ev.titulo : null),
    }))
    .filter((it) => it.numero !== null && it.letras.length > 0);
  if (itens.length === 0) return null;
  return {
    pergunta_id: ev.pergunta_id,
    carimbo,
    itens,
    ciclo: ev.ciclo ?? null,
    ponteiro: ev.ponteiro ?? null,
    item: ev.item,
    titulo: ev.titulo,
    mandato: mandatoDaAbertura(ev),
    doRegistro,
  };
}

/**
 * As aberturas que o pareador lê: `Map(pergunta_id → abertura)`. A pergunta cuja marca saiu neste
 * transcript entra ancorada no carimbo dessa entrada (`doRegistro: false`), respondida ou não; a
 * pergunta só do registro, aberta (sem resposta nem abertura que a supere), entra `doRegistro`.
 * A pergunta de consentimento da condução fica fora.
 */
/**
 * Os ciclos do turno: o do ramo que o transcript grava (`gitBranch` `ciclo-<id>[-…]` ou
 * `conducao/<id>`) e o das perguntas mostradas aqui. A pergunta só do registro entra só destes
 * ciclos (a regra da fonte, `abertasDoRegistroDosCiclos`): o `D3a` de um ciclo nunca casa com o D3
 * aberto de outro.
 */
export function ciclosDoTurno(entradas, porId) {
  const out = new Set();
  const ids = [...(porId?.values() ?? [])].map((e) => e.ciclo).filter((c) => typeof c === "string" && c);
  for (const e of entradas ?? []) {
    const ramo = typeof e?.gitBranch === "string" ? e.gitBranch : "";
    const m = /^(?:ciclo-|conducao\/)(.+)$/.exec(ramo);
    // O id exato, ou o mais longo que o ramo traz seguido de `-<slug>` (`VEGA-19-x` é do VEGA-19, nunca do VEGA).
    if (m) {
      const dono = ids.filter((c) => m[1] === c || m[1].startsWith(`${c}-`)).sort((x, y) => y.length - x.length)[0];
      if (dono) out.add(dono);
    }
    const t = textoBrutoDe(e);
    if (t.includes("<!--")) for (const x of t.matchAll(MARCA)) { const c = porId?.get(x[1])?.ciclo; if (c) out.add(c); }
  }
  return out;
}

export function aberturasDoTurno(entradas, eventos, { sessao = null } = {}) {
  const evs = (eventos ?? []).filter((e) => e && typeof e === "object");
  const porId = new Map();
  for (const e of evs) if (e.evento === "abertura" && !porId.has(e.pergunta_id) && e.sessao !== SESSAO_DO_CONSENTIMENTO) porId.set(e.pergunta_id, e);
  const out = new Map();
  for (const e of entradas ?? []) {
    const t = textoBrutoDe(e);
    if (!t.includes("<!--") || !e?.timestamp) continue;
    for (const m of t.matchAll(MARCA)) {
      const ev = porId.get(m[1]);
      if (!ev || out.has(m[1])) continue;
      const a = aberturaDoRegistro(ev, { carimbo: e.timestamp, doRegistro: false });
      if (a) out.set(m[1], a);
    }
  }
  // Respondida conta como fechada só com autoria de origem humana: a resposta gravada pelo agente
  // (`responder`) no mesmo turno da mensagem do operador ainda espera a autoria dela.
  const provadas = new Set(evs.filter((e) => e.evento === "autoria" && FORCA_DAS_ORIGENS.includes(e.origem_resposta)).map((e) => e.pergunta_id));
  const respondidas = new Set(evs.filter((e) => e.evento === "resposta" && provadas.has(e.pergunta_id)).map((e) => e.pergunta_id));
  const superadas = new Set(evs.filter((e) => e.evento === "abertura" && e.supersedes).map((e) => e.supersedes));
  const ciclos = ciclosDoTurno(entradas, porId);
  for (const [pid, ev] of porId) {
    if (out.has(pid) || respondidas.has(pid) || superadas.has(pid)) continue;
    // Só do ciclo do turno, e nunca a aberta nesta sessão sem o bloco mostrado aqui.
    if (!ciclos.has(ev.ciclo) || (sessao && ev.sessao === sessao)) continue;
    const a = aberturaDoRegistro(ev);
    if (a) out.set(pid, a);
  }
  return out;
}

/**
 * Casa um texto com as aberturas anteriores a `quando`: `Map(pergunta_id → [{ numero, letra }])`.
 * A regra do pareador da fonte: cada número vai à abertura mais nova que o tem; letra fora das
 * opções não casa; a abertura só do registro casa só por `D<n><letra>` ou pelo id nomeado; a letra
 * sozinha só com `letraSozinha`, contra o bloco mostrado aqui mais novo, de um item.
 */
export function parearPorNumero(texto, aberturas, quando, { letraSozinha = false, citadas = false } = {}) {
  const antes = [...aberturas.values()]
    .filter((a) => a.carimbo && Date.parse(a.carimbo) <= Date.parse(quando))
    .sort((x, y) => Date.parse(y.carimbo) - Date.parse(x.carimbo));
  const pares = new Map();
  const s = String(texto ?? "");
  const { escolhas } = (citadas ? escolhasCitadas : escolhasDoTexto)(s);
  const comD = new Set([...s.matchAll(ITEM_COM_D)].map((m) => Number(m[1])));
  const nomeados = new Set(s.match(PERGUNTA_ID_NO_TEXTO) ?? []);
  const alcanca = (a, numero) => !a.doRegistro || comD.has(numero) || nomeados.has(a.pergunta_id);
  for (const { numero, letra } of escolhas) {
    const dona = antes.find((a) => a.itens.some((it) => it.numero === numero) && alcanca(a, numero));
    if (!dona) continue;
    const it = dona.itens.find((x) => x.numero === numero);
    if (letra !== "sim" && !it.letras.includes(letra)) continue;
    if (!pares.has(dona.pergunta_id)) pares.set(dona.pergunta_id, []);
    pares.get(dona.pergunta_id).push({ numero, letra });
  }
  const nomeada = pares.size === 0 ? RESPOSTA_NOMEADA.exec(s) : null;
  if (nomeada) {
    const a = antes.find((x) => x.pergunta_id === nomeada[1]);
    const letra = nomeada[2].toLowerCase();
    if (a?.itens.length === 1 && a.itens[0].letras.includes(letra)) pares.set(a.pergunta_id, [{ numero: a.itens[0].numero, letra }]);
  }
  const ultima = antes.find((a) => !a.doRegistro);
  if (pares.size === 0 && letraSozinha && ultima?.itens.length === 1) {
    const m = LETRA_SOZINHA.exec(s);
    const [it] = ultima.itens;
    if (m && it.letras.includes(m[1].toLowerCase())) pares.set(ultima.pergunta_id, [{ numero: it.numero, letra: m[1].toLowerCase() }]);
  }
  return pares;
}

/** As perguntas que o agente respondeu pelo comando (`comando.mjs responder … p-…`) neste transcript. */
export function respondidasPeloComando(entradas) {
  const ids = new Set();
  for (const e of entradas ?? []) {
    if (e?.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      const cmd = b?.type === "tool_use" && typeof b.input?.command === "string" ? b.input.command : "";
      if (RESPONDER_DO_COMANDO.test(cmd)) for (const m of cmd.matchAll(PERGUNTA_ID_NO_TEXTO)) ids.add(m[0]);
    }
  }
  return ids;
}

function mesmasEscolhas(a, b) {
  const chave = (xs) => [...new Set((xs ?? []).map((x) => `${x.numero ?? ""}${x.letra}`))].sort().join(" ");
  return chave(a) === chave(b);
}

function autoriaDe({ abertura, sessao, carimbo, origem_resposta, prova, recibo = null, ponteiro = null, motivo = null }) {
  const humana = FORCA_DAS_ORIGENS.includes(origem_resposta) && abertura.mandato != null;
  return {
    evento: "autoria",
    pergunta_id: abertura.pergunta_id,
    sessao,
    ciclo: abertura.ciclo,
    carimbo,
    versao_esquema: VERSAO_DO_ESQUEMA,
    ...((ponteiro ?? abertura.ponteiro) ? { ponteiro: ponteiro ?? abertura.ponteiro } : {}),
    item: abertura.item,
    titulo: abertura.titulo,
    origem_resposta,
    prova,
    ...(humana ? { quem: "pessoa", mandato: abertura.mandato } : {}),
    ...(recibo ? { recibo } : {}),
    ...(motivo ? { detalhe: { motivo } } : {}),
  };
}

/** A `resposta` que o pareador grava quando o agente não chamou `responder`: só as letras ecoadas, nunca o texto. */
function respostaDoPareador({ abertura, escolhas, sessao, carimbo }) {
  const ecoada = escolhas.map((e) => (e.numero == null ? e.letra : `D${e.numero}${e.letra}`)).join(" ");
  return {
    evento: "resposta",
    pergunta_id: abertura.pergunta_id,
    sessao,
    ciclo: abertura.ciclo,
    carimbo,
    perguntado_em: abertura.carimbo,
    versao_esquema: VERSAO_DO_ESQUEMA,
    ...(abertura.ponteiro ? { ponteiro: abertura.ponteiro } : {}),
    item: abertura.item,
    titulo: abertura.titulo,
    resposta_literal: ecoada,
    escolha: escolhas.length === 1 && abertura.itens.length === 1 ? escolhas[0].letra : null,
    escolhas,
    alternativa_livre: false,
    origem_resposta: "agente",
    ...(abertura.mandato ? { mandato: abertura.mandato } : {}),
  };
}

/**
 * O pareador sobre o transcript: `{ eventos, registros }`. `eventos` são as `autoria` (e, se o
 * agente não gravou a resposta, a `resposta` com as letras) das mensagens a partir de `desde`;
 * `registros` dizem o desfecho de cada mensagem, sem texto. `respondidas` = os ids que já têm
 * resposta no registro (a resposta nunca se grava duas vezes).
 */
export function parearTranscript(entradas, { sessao, transcript, desde = 0, aberturas, respondidas = new Set() } = {}) {
  const eventos = [];
  const registros = [];
  if (!aberturas || aberturas.size === 0) return { eventos, registros };
  const peloComando = respondidasPeloComando(entradas);
  const chamadas = chamadasDeGetEvent(entradas);
  const casadas = new Map();
  const comResposta = new Set();
  const emitidas = new Set();
  const carimbosDeBloco = new Set([...aberturas.values()].filter((a) => !a.doRegistro).map((a) => a.carimbo));
  let humanoDesdeOBloco = true;
  const respostaFalta = (pid) => !peloComando.has(pid) && !comResposta.has(pid) && !respondidas.has(pid);
  for (let i = 0; i < entradas.length; i++) {
    const e = entradas[i];
    if (e?.timestamp && carimbosDeBloco.has(e.timestamp)) humanoDesdeOBloco = false;
    const doTurno = i >= desde;
    const quando = e?.timestamp;
    if (!quando || !e.uuid) continue;
    if (ehMensagemHumana(e)) {
      const texto = textoHumanoDe(e);
      const letraSozinha = !humanoDesdeOBloco;
      humanoDesdeOBloco = true;
      const pares = parearPorNumero(texto, aberturas, quando, { letraSozinha });
      if (pares.size === 0) {
        if (doTurno && escolhasCitadas(texto).escolhas.length > 0) registros.push({ evento: "nao-pareada", uuid: e.uuid, de: "operador" });
        continue;
      }
      for (const [pid, escolhas] of pares) {
        casadas.set(pid, escolhas);
        if (!doTurno || emitidas.has(`${e.uuid}|${pid}`)) continue;
        emitidas.add(`${e.uuid}|${pid}`);
        const abertura = aberturas.get(pid);
        eventos.push(autoriaDe({ abertura, sessao, carimbo: quando, origem_resposta: "digitado", prova: `transcript:${transcript}#${e.uuid}` }));
        registros.push({ evento: "autoria", uuid: e.uuid, pergunta_id: pid, origem_resposta: "digitado" });
        if (respostaFalta(pid)) {
          comResposta.add(pid);
          eventos.push(respostaDoPareador({ abertura, escolhas, sessao, carimbo: quando }));
        }
      }
      continue;
    }
    const msg = mensagemEntreSessoes(e);
    if (!msg) continue;
    const pares = parearPorNumero(msg.texto, aberturas, quando, { citadas: true });
    if (pares.size === 0) continue;
    const nomeados = new Set(msg.texto.match(PERGUNTA_ID_NO_TEXTO) ?? []);
    const recibo = reciboDoTexto(msg.texto);
    const aceito = recibo !== null && recibo.sessao === msg.de;
    const reciboTexto = recibo ? `${recibo.sessao} ${recibo.evento}` : null;
    for (const [pid, escolhas] of pares) {
      // Repasse que não nomeia a pergunta não resolve a linha dela: não grava (o relato também não).
      if (!nomeados.has(pid)) continue;
      const conhecida = casadas.get(pid) ?? null;
      casadas.set(pid, escolhas);
      if (!doTurno || emitidas.has(`${e.uuid}|${pid}`)) continue;
      emitidas.add(`${e.uuid}|${pid}`);
      const abertura = aberturas.get(pid);
      const deRepasse = `entre-sessoes:${msg.de}#${e.uuid}`;
      if (!aceito) {
        if (conhecida && mesmasEscolhas(conhecida, escolhas)) {
          registros.push({ evento: "relato", uuid: e.uuid, pergunta_id: pid });
          continue;
        }
        eventos.push(autoriaDe({ abertura, sessao, carimbo: quando, origem_resposta: "agente", prova: deRepasse, recibo: reciboTexto }));
        registros.push({ evento: "autoria", uuid: e.uuid, pergunta_id: pid, origem_resposta: "agente" });
        continue;
      }
      let origem_resposta = "repasse-hub";
      let prova = deRepasse;
      let motivo = "sem-chamada";
      let r = null;
      for (let k = i + 1; k < entradas.length && !r; k++) {
        const achado = resultadoDoGetEvent(entradas[k], chamadas);
        if (achado && achado.chamada.sessao === recibo.sessao && achado.chamada.evento === recibo.evento) r = achado;
      }
      if (r?.erro) motivo = "erro-ferramenta";
      else if (r && eventoDoHubConfere(r.evento, { escolhas, abertaEm: abertura.carimbo }) !== null) motivo = "nao-confere";
      else if (r) {
        origem_resposta = "digitado-no-hub-conferido";
        prova = `get_event:${recibo.sessao}#${r.entrada.uuid}`;
        motivo = null;
      }
      const ponteiro = origem_resposta === "repasse-hub" ? `hub:${msg.de}#${pid}` : null;
      eventos.push(autoriaDe({ abertura, sessao, carimbo: quando, origem_resposta, prova, recibo: reciboTexto, ponteiro, motivo }));
      registros.push({ evento: "autoria", uuid: e.uuid, pergunta_id: pid, origem_resposta, ...(motivo ? { motivo } : {}) });
      if (respostaFalta(pid)) {
        comResposta.add(pid);
        eventos.push(respostaDoPareador({ abertura, escolhas, sessao, carimbo: quando }));
      }
    }
  }
  return { eventos, registros };
}

/** O início do turno corrente: logo depois do resumo do Stop anterior (`stop_hook_summary`). */
export function inicioDoTurno(entradas) {
  for (let i = entradas.length - 1; i >= 0; i--) {
    if (entradas[i]?.type === "system" && entradas[i]?.subtype === "stop_hook_summary") return i + 1;
  }
  return 0;
}

// ── o registro git ──────────────────────────────────────────────────────────

/** A chave do evento: a mesma conta do destino git da fonte e do adaptador `superpowers`. */
export function chaveDoEvento(ev) {
  const sha = (...partes) => createHash("sha256").update(partes.join("|")).digest("hex");
  const p = ev.pergunta_id;
  switch (ev.evento) {
    case "abertura":
    case "resposta":
      return sha(ev.evento, p);
    case "dispensa":
      return sha("dispensa", p, ev.carimbo);
    case "autoria":
      return sha("autoria", p, ev.origem_resposta, ev.prova);
    case "previsao":
      return sha("previsao", p, ev.modelo, ev.versao_esquema ?? VERSAO_DO_ESQUEMA);
    case "destino":
      return sha("destino", p, ev.ponteiro);
    default:
      return null;
  }
}

function folhasDe(v) {
  if (typeof v === "string") return [v];
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(folhasDe);
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...folhasDe(x)]);
  return [];
}

/**
 * Os eventos do registro (`sessao-<id>.jsonl` da pasta), sem conferir chave: o pareador só precisa
 * das aberturas e das respostas para casar; quem reconfere é o leitor (`lerEventosDoRegistro` do
 * adaptador, `prova.mjs`). Linha ilegível pula.
 */
export function eventosDaPasta(pasta, { contar = false } = {}) {
  let descartadas = 0;
  let nomes = [];
  try {
    nomes = readdirSync(pasta).filter((n) => n.startsWith(PREFIXO_DA_SESSAO) && n.endsWith(".jsonl")).sort();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const out = [];
  for (const nome of nomes) {
    const sessao = nome.slice(PREFIXO_DA_SESSAO.length, -".jsonl".length);
    for (const l of readFileSync(path.join(pasta, nome), "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        const o = JSON.parse(l);
        if (o && typeof o === "object" && !Array.isArray(o)) out.push(o.sessao === undefined && SESSAO_RE.test(sessao) ? { ...o, sessao } : o);
      } catch {
        descartadas++;
      }
    }
  }
  return contar ? { eventos: out, descartadas } : out;
}

/**
 * Grava os eventos do pareador no arquivo da sessão de cada um, só acrescentando a chave que o
 * arquivo ainda não tem (o mesmo Stop duas vezes, ou a fonte e o plugin no mesmo registro, não
 * duplicam). Confere tudo antes de escrever: evento fora da forma ou folha com a forma de CPF/CNS
 * lança, nada gravado. `{ gravados, ja_existiam }`.
 */
export function gravarNoRegistro(pasta, eventos) {
  if (!Array.isArray(eventos)) throw new Error("eventos: esperada lista");
  const porArquivo = new Map();
  for (const e of eventos) {
    if (!EVENTOS_DO_PAREADOR.includes(e?.evento)) throw new Error("evento fora do pareador (autoria, resposta)");
    if (!PERGUNTA_ID_RE.test(e.pergunta_id ?? "")) throw new Error("evento.pergunta_id: esperado p-<16 hex>");
    if (!SESSAO_RE.test(e.sessao ?? "")) throw new Error("evento.sessao: esperado id de sessão [A-Za-z0-9_-]");
    if (Number.isNaN(Date.parse(e.carimbo ?? ""))) throw new Error("evento.carimbo: esperado data ISO");
    const { chave: _c, versao_esquema: _v, has_patient_data: _h, evento, pergunta_id, carimbo, ...resto } = e;
    const linha = { chave: chaveDoEvento(e), versao_esquema: VERSAO_DO_ESQUEMA, evento, pergunta_id, carimbo, ...resto };
    const { chave: _k, ...varrido } = linha;
    if (folhasDe(varrido).some((t) => FORMAS_DE_PACIENTE.some((re) => re.test(t)))) throw new Error(`a pergunta ${pergunta_id} tem dado com a forma de CPF/CNS: nada gravado`);
    const arquivo = path.join(pasta, `${PREFIXO_DA_SESSAO}${e.sessao}.jsonl`);
    porArquivo.set(arquivo, [...(porArquivo.get(arquivo) ?? []), linha]);
  }
  let gravados = 0;
  let ja_existiam = 0;
  const plano = [];
  for (const [arquivo, linhas] of porArquivo) {
    const texto = existsSync(arquivo) ? readFileSync(arquivo, "utf8") : "";
    const existentes = new Set();
    for (const l of texto.split("\n")) {
      if (!l.trim()) continue;
      try {
        existentes.add(JSON.parse(l)?.chave);
      } catch {
        throw new Error(`${arquivo}: linha ilegível — conserte o arquivo antes de gravar`);
      }
    }
    const novas = linhas.filter((l) => {
      if (existentes.has(l.chave)) return (ja_existiam++, false);
      existentes.add(l.chave);
      return true;
    });
    plano.push({ arquivo, novas, semFim: texto.length > 0 && !texto.endsWith("\n") });
  }
  for (const { arquivo, novas, semFim } of plano) {
    if (novas.length === 0) continue;
    mkdirSync(path.dirname(arquivo), { recursive: true });
    appendFileSync(arquivo, (semFim ? "\n" : "") + novas.map((l) => JSON.stringify(l)).join("\n") + "\n");
    gravados += novas.length;
  }
  return { gravados, ja_existiam };
}

// ── o turno inteiro, sem o Stop ─────────────────────────────────────────────

/**
 * As `autoria` que o pareador gravaria para `pergunta_id` tiradas agora do transcript (o turno
 * inteiro), para o `autorizar-ciclo` chamado no MESMO turno da resposta não recusar `sem-autoria`
 * à espera do Stop. Nada grava: só soma aos eventos lidos, e `origemEfetiva` reconfere a prova como
 * reconfere a gravada. O transcript é o da sessão da abertura; aberta com id de nuvem, o desta
 * sessão (`sessaoLocal`), e a prova exige o bloco nele. Sem par ⇒ `[]` (fail-closed).
 */
export function autoriasDoTurno(pergunta_id, { eventos = [], achar = acharTranscript, lerEntradas = lerTranscript, sessaoLocal = process.env.CLAUDE_CODE_SESSION_ID } = {}) {
  const abertura = eventos.find((e) => e?.pergunta_id === pergunta_id && e.evento === "abertura");
  if (!abertura?.sessao || abertura.sessao === SESSAO_DO_CONSENTIMENTO) return [];
  const daNuvem = SESSAO_DE_NUVEM.test(abertura.sessao);
  const sessao = daNuvem ? sessaoLocal : abertura.sessao;
  if (typeof sessao !== "string" || !SESSAO_RE.test(sessao) || SESSAO_DE_NUVEM.test(sessao)) return [];
  const arquivo = achar(sessao);
  if (!arquivo) return [];
  const entradas = lerEntradas(arquivo);
  if (!Array.isArray(entradas) || entradas.length === 0) return [];
  const daPergunta = eventos.filter((e) => e?.pergunta_id === pergunta_id);
  const aberturas = aberturasDoTurno(entradas, daPergunta, { sessao });
  const respondidas = new Set(daPergunta.some((e) => e.evento === "resposta") ? [pergunta_id] : []);
  const { eventos: doTranscript } = parearTranscript(entradas, { sessao, transcript: arquivo, desde: 0, aberturas, respondidas });
  const jaLidas = new Set(daPergunta.filter((e) => e.evento === "autoria").map((e) => e.prova));
  return doTranscript.filter((e) => e.evento === "autoria" && e.pergunta_id === pergunta_id && !jaLidas.has(e.prova)).map((e) => ({ ...e, do_turno: true }));
}

/** As escolhas da resposta gravada (reexportada para o gancho e os testes). */
export { escolhasDaResposta };
