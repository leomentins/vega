#!/usr/bin/env node
// Extrai, das conversas do Claude Code, as decisões de Leo diante de blocos de decisão do agente.
// Determinístico, sem dependências. Hotfix coleta-decisoes-do-operador (28/10/2026).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { ErroDestino, escaparRegex, gravarNoGit, lerDestino, raizDoProjeto, raizPrincipal, varrerPhi } from "./destino.mjs";

// Uso: node extrair-conversas.mjs --raiz <pasta projects do Claude Code> --saida <pasta de saida> [--projeto <regex>] [--repo <arvore>]
// Saida: <saida>/resumo.json e, para cada conversa, o destino que o `.vega/` do projeto dela diz
// (HN-29 T27, `destino.mjs`): `banco` (ou declaracao ausente, com aviso) vai para
// <saida>/decisoes.jsonl (contrato de `estado.mjs decisao gravar`); `git` vai para o arquivo de
// decisoes do projeto, com o PHI-gate de CPF/CNS na escrita. Declaracao ilegivel ou destino
// desconhecido: exit 2, nada escrito. O projeto da conversa e a raiz git do `cwd` dela; pasta que
// sumiu cai no `--repo` (padrao: esta arvore).
// O decisoes.jsonl pode conter fala de sessao clinica: fica fora do repositorio (o PHI-gate do verbo filtra CPF/CNS).
function arg(nome, padrao) {
  const i = process.argv.indexOf(nome);
  if (i < 0) return padrao;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`${nome} exige valor`);
    process.exit(1);
  }
  return v;
}
const RAIZ = path.resolve(arg("--raiz", path.join(process.env.HOME ?? "", ".claude", "projects")));
// --saida obrigatoria: o default "." escreveria fala de sessao dentro do repositorio.
if (!process.argv.includes("--saida")) {
  console.error("--saida <pasta fora do repositorio> e obrigatoria");
  process.exit(1);
}
const SAIDA = path.resolve(arg("--saida", "."));
const REPO = path.resolve(arg("--repo", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")));
// So pastas de projeto cujo nome casa: as conversas do projeto desta raiz (o nome da arvore
// principal), nao as da vida inteira. `--projeto ".*"` le tudo.
const PROJETO = new RegExp(arg("--projeto", escaparRegex(path.basename(raizPrincipal(REPO)))), "i");

// Destino por projeto, lido uma vez por raiz. Ilegivel/desconhecido: recusa antes de escrever.
const destinos = new Map();
const avisados = new Set();
function destinoDe(raiz) {
  if (!destinos.has(raiz)) {
    try {
      destinos.set(raiz, lerDestino(raiz));
    } catch (e) {
      if (!(e instanceof ErroDestino)) throw e;
      console.error(`recusado: ${e.message}`);
      process.exit(2);
    }
  }
  const d = destinos.get(raiz);
  if (d.ausente && !avisados.has(raiz)) {
    avisados.add(raiz);
    console.error(`aviso: ${raiz} sem ${path.join(".vega", "declaracao.json")} — decisoes vao para ${path.join(SAIDA, "decisoes.jsonl")} (destino banco, o de hoje)`);
  }
  return d;
}
// O layout das worktrees de ciclo (`worktrees_de_ciclo`) vem da declaracao desta raiz. Sem ele,
// o ciclo nao se infere do ramo nem da pasta (so do texto, se algum prefixo aparecer).
const WORKTREES = destinoDe(REPO).worktrees;
if (!WORKTREES) console.error(`aviso: ${REPO} nao declara worktrees_de_ciclo — ciclo nao se infere do ramo nem da pasta`);
fs.mkdirSync(SAIDA, { recursive: true });

// ---------- leitura ----------
function listarSessoes() {
  const out = [];
  for (const d of fs.readdirSync(RAIZ).sort()) {
    if (!PROJETO.test(d)) continue;
    const dd = path.join(RAIZ, d);
    let st;
    try { st = fs.statSync(dd); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const f of fs.readdirSync(dd).sort()) if (f.endsWith(".jsonl")) out.push(path.join(dd, f));
  }
  return out;
}

function lerLinhas(arq) {
  const objs = [];
  for (const l of fs.readFileSync(arq, "utf8").split("\n")) {
    if (!l) continue;
    try { objs.push(JSON.parse(l)); } catch { /* linha truncada */ }
  }
  return objs;
}

// O que o sistema injeta junto da mensagem (lembrete, comando, colagem) nao e fala de ninguem.
const INJETADO = /<(system-reminder|command-[a-z]+|local-command-[a-z]+|pasted_content)\b[^>]*>[\s\S]*?<\/\1>/g;
const textoDe = (c) =>
  (typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "")
    .replace(INJETADO, "")
    .trim();
const temToolResult = (c) => Array.isArray(c) && c.some((b) => b?.type === "tool_result");

function ehHumano(o) {
  if (o.type !== "user" || o.isSidechain || o.isMeta) return false;
  if (o.origin?.kind !== "human") return false;
  const c = o.message?.content;
  if (temToolResult(c)) return false;
  const t = textoDe(c).trim();
  if (!t) return false;
  if (/^<(command-|local-command|cross-session|task-notification|other-session|agent-message)/.test(t)) return false;
  if (/^(Base directory for this skill|This session is being continued|Another Claude session sent)/.test(t)) return false;
  if (/^\[Request interrupted/.test(t)) return false;
  return true;
}

// ---------- pré-passe: sessões criadas por outra sessão ----------
const sessoes = listarSessoes();
const idsSemente = new Set();
const prefixosCiclo = new Set();
const reRamoBruto = WORKTREES && new RegExp(`"gitBranch":"${escaparRegex(WORKTREES.ramo)}([A-Z]{2,6})-\\d+`, "g");
const rePastaBruta = WORKTREES && new RegExp(`${escaparRegex(WORKTREES.pasta)}\\/([A-Z]{2,6})-\\d+-[a-z]`, "g");
const reRamo = WORKTREES && new RegExp(`^${escaparRegex(WORKTREES.ramo)}(.+)$`);
const rePasta = WORKTREES && new RegExp(`${escaparRegex(WORKTREES.pasta)}\\/([A-Z]{2,6}-\\d+[^/]*)`);
for (const arq of sessoes) {
  const raw = fs.readFileSync(arq, "utf8");
  for (const m of raw.matchAll(/session_([A-Za-z0-9]{20,})\\?",\\?"title[\s\S]{0,600}?claude_code_mcp_seed/g)) idsSemente.add(m[1]);
  if (!WORKTREES) continue;
  for (const m of raw.matchAll(reRamoBruto)) prefixosCiclo.add(m[1]);
  for (const m of raw.matchAll(rePastaBruta)) prefixosCiclo.add(m[1]);
}
const reCicloTexto = prefixosCiclo.size
  ? new RegExp(`(?<![\\w-])((?:${[...prefixosCiclo].join("|")})-\\d{1,3}(?:-[a-z][a-z0-9]*(?:-[a-z0-9]+)*)?)(?![\\w])`)
  : null;

// ---------- parse do bloco ----------
const RE_FECHO = /Diz\s.{0,120}?e eu toco/i;
const RE_CABECALHO = /^\s*(?:#+\s*)?\*\*\s*(?:Decis(?:ão|ões)\b|\d+\s+decis)|Decisão de operador\s*—\s*divergência|^\s*\*\*\s*Decisão/i;
const RE_ITEM = /^\s*(?:\*\*)?\s*((?:D-[A-Z0-9]+-\d+)|(?:[A-Z]{1,2}\d+(?:\.\d+)*)|(?:\d+(?:\.\d+)*))[.)](?:\*\*)?\s+(.+?)\s*$/;
const RE_OPCAO = /^\s*(?:[-*•]\s*)?\(([a-z])\)\s*(.*)$/;
const RE_RECO = /^\s*(?:[-*]\s*)?(?:→|->)\s*(?:\*\*)?\s*(?:(?:A|O)\s+[a-zà-ú]+\s+)?Recomend[oa]\b(.*)$/i;

function limpaMd(s) {
  return s.replace(/^\*\*|\*\*$/g, "").replace(/^\*\*(.*)\*\*$/, "$1").trim();
}

function parseReco(resto) {
  // resto após "Recomendo": " (a) — motivo" | " (a): motivo" | " a e c, porque..."
  const m = resto.match(/^\s*(?:\*\*)?\s*\(?([a-z])\)?((?:\s*(?:\+|e|,|\/)\s*\(?[a-z]\)?(?![a-zà-ú]))*)(?:\*\*)?\s*(.*)$/s);
  if (!m) return { letra: null, motivo: resto.trim() || null };
  let letras = m[1] + (m[2] || "").replace(/[^a-z]|(?<=\s)e(?=\s)/g, "");
  letras = [...new Set((m[1] + (m[2] || "").replace(/\be\b/g, "").replace(/[^a-z]/g, "")).split(""))].sort().join("");
  const motivo = m[3].replace(/^[\s.]*[—–:-]+\s*/, "").replace(/^[.,;]\s*/, "").trim();
  return { letra: letras, motivo: motivo || null };
}

function parseBloco(texto) {
  const linhas = texto.split("\n");
  let fim = -1;
  for (let i = linhas.length - 1; i >= 0; i--) if (RE_FECHO.test(linhas[i])) { fim = i; break; }
  if (fim < 0) return null;
  let ini = -1;
  for (let i = 0; i <= fim; i++) if (RE_CABECALHO.test(linhas[i])) { ini = i; break; }
  const cabecalho = ini >= 0 ? limpaMd(linhas[ini]) : null;
  const corpo = linhas.slice(ini >= 0 ? ini + 1 : 0, fim + 1);
  const itens = [];
  let cur = null;
  let ultimaOpcao = null;
  const fecha = () => { if (cur) itens.push(cur); cur = null; ultimaOpcao = null; };
  for (const ln of corpo) {
    const mi = ln.match(RE_ITEM);
    if (mi && !RE_OPCAO.test(ln)) {
      fecha();
      let titulo = limpaMd(mi[2]);
      let dominio = null;
      const md = titulo.match(/^\[([^\]]{2,40})\]\s*(.*)$/);
      if (md) { dominio = md[1]; titulo = limpaMd(md[2]); }
      const mf = !md && titulo.match(/^(.*?)\s*`?\[([^\]]{2,40})\]`?\s*$/);
      if (mf) dominio = mf[2]; // tag no fim fica também no título (verbatim)
      cur = { item: mi[1], titulo, dominio, ctx: [], opcoes: [], recomendada: null, motivo: null };
      continue;
    }
    if (RE_FECHO.test(ln)) { continue; }
    const mo = ln.match(RE_OPCAO);
    if (mo) {
      if (!cur) cur = { item: null, titulo: cabecalho || "", dominio: null, ctx: [], opcoes: [], recomendada: null, motivo: null };
      ultimaOpcao = { letra: mo[1], texto: mo[2].trim() };
      cur.opcoes.push(ultimaOpcao);
      continue;
    }
    const mr = ln.match(RE_RECO);
    if (mr) {
      if (!cur) continue;
      const r = parseReco(mr[1]);
      cur.recomendada = r.letra;
      cur.motivo = r.motivo;
      ultimaOpcao = null;
      continue;
    }
    if (!cur) continue;
    if (ultimaOpcao && /^\s{2,}\S/.test(ln)) { ultimaOpcao.texto += "\n" + ln.trim(); continue; }
    if (cur.opcoes.length === 0 && cur.recomendada === null) cur.ctx.push(ln);
  }
  fecha();
  // só itens com menu ou recomendação contam (corta lista numerada de contexto)
  const filtrados = itens.filter((it) => it.opcoes.length > 0 || it.recomendada !== null);
  // item repetido no mesmo bloco: fica a última ocorrência
  const ultimoIdx = new Map();
  filtrados.forEach((it, i) => ultimoIdx.set(it.item ?? `#${i}`, i));
  const validos = filtrados.filter((it, i) => ultimoIdx.get(it.item ?? `#${i}`) === i);
  for (const it of validos) {
    if (it.item === null) it.item = "sem-numero";
    const ctx = it.ctx.join("\n").trim();
    it.contexto = ctx ? ctx.slice(0, 1000) : null;
    delete it.ctx;
  }
  return { cabecalho, itens: validos, linhaFecho: linhas[fim] };
}

// ---------- parse da resposta ----------
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE_ACEITE = /^\s*(ok|okay|sim|s|vai|pode|manda|segue|aprovo|aprovado|perfeito|fechado|beleza|bora|isso|concordo|de acordo|pode seguir|segue assim|todas?|todos?)(\s+(as\s+)?recomenda\w*)?\s*[.!]*\s*$/i;

function parseResposta(resp, itens) {
  // itens: [{item, opcoes, recomendada}] -> Map item -> {escolha, livre, comentario, conf}
  const res = new Map();
  const R = resp;
  const achados = [];
  const ids = new Set(itens.map((i) => i.item));
  for (const it of itens) {
    if (it.item === "sem-numero") continue;
    const letrasValidas = it.opcoes.length ? it.opcoes.map((o) => o.letra).join("") : "abcdef";
    // alias: Leo abrevia "F3.2"/"13.2" para "2" — só se nenhum outro item pendente tem esse id
    const alias = /\./.test(it.item) ? it.item.split(".").pop() : null;
    const formas = [it.item];
    if (alias && !ids.has(alias) && !itens.some((o) => o !== it && o.item.split(".").pop() === alias)) formas.push(alias);
    for (const forma of formas) {
      const re = new RegExp(
        `(?<![\\w.#/@-])${escRe(forma)}\\s*[-:.)=]?\\s*\\(?([${letrasValidas}](?:\\s*[+,]?\\s*[${letrasValidas}])*)\\)?(?![a-zà-úA-Z0-9])`,
        "gi",
      );
      const m = R.match(re);
      if (m) {
        const idx = R.search(re);
        achados.push({ it, ini: idx, fim: idx + m[0].length, escolha: [...new Set(m[0].slice(forma.length).toLowerCase().replace(/[^a-z]/g, "").split(""))].sort().join(""), alias: forma !== it.item });
        break;
      }
    }
  }
  achados.sort((a, b) => a.ini - b.ini);
  // descarta sobreposições
  const ok = [];
  for (const a of achados) if (!ok.length || a.ini >= ok[ok.length - 1].fim) ok.push(a);
  for (let k = 0; k < ok.length; k++) {
    const a = ok[k];
    const prox = k + 1 < ok.length ? ok[k + 1].ini : R.length;
    const com = R.slice(a.fim, prox).replace(/^[\s,;/|·-]+|[\s,;/|·-]+$/g, "").trim();
    res.set(a.it.item, { escolha: a.escolha, livre: false, comentario: com || null, conf: a.alias ? "media" : "alta", via: a.alias ? "item-abreviado+letra" : "item+letra" });
  }
  // itens citados sem letra (ex.: "7 que tal ...")
  for (const it of itens) {
    if (res.has(it.item) || it.item === "sem-numero") continue;
    const re = new RegExp(`(?:^|[\\s,;/|])${escRe(it.item)}(?:\\s*[-:.)]\\s*|\\s+)(?=\\S)`, "i");
    const m = R.match(re);
    if (m && (/\./.test(it.item) || /^[A-Z]/.test(it.item) || m.index === 0 || ok.length > 0)) {
      const ini = m.index + m[0].length;
      const depois = ok.filter((a) => a.ini >= ini).map((a) => a.ini);
      const fimSeg = depois.length ? Math.min(...depois) : R.length;
      const com = R.slice(ini, fimSeg).trim();
      res.set(it.item, { escolha: null, livre: true, comentario: com || null, conf: "media", via: "item-sem-letra" });
    }
  }
  if (res.size > 0) return res;

  // sem nenhum item citado
  const trim = R.trim();
  const unico = itens.length === 1;
  const mLetra = trim.match(/^\(?([a-f])\)?(?:\s*[,.;:!—–-]\s*|\s+|$)([\s\S]*)$/i);
  if (mLetra && (unico ? (itens[0].opcoes.length === 0 || itens[0].opcoes.some((o) => o.letra === mLetra[1].toLowerCase())) : false)) {
    const resto = mLetra[2].trim();
    res.set(itens[0].item, { escolha: mLetra[1].toLowerCase(), livre: false, comentario: resto || null, conf: resto ? "media" : "alta", via: "letra-solta" });
    return res;
  }
  if (mLetra && !unico && /^\(?[a-f]\)?\s*[.!]?$/i.test(trim)) {
    for (const it of itens) res.set(it.item, { escolha: null, livre: null, comentario: null, conf: "baixa", via: "letra-solta-multi" });
    return res;
  }
  if (RE_ACEITE.test(trim)) {
    for (const it of itens)
      res.set(it.item, { escolha: it.recomendada, livre: false, comentario: null, conf: "media", via: "aceite-generico" });
    return res;
  }
  // "sim uai, continua" / "pode, mas ..." — aceite curto com comentário, sem pergunta
  const mAc = trim.match(/^(ok|okay|sim|pode|vai|manda|segue|aprovo|aprovado|bora|beleza|fechado|perfeito|concordo)\b[\s,.!;:—-]*([\s\S]*)$/i);
  if (mAc && trim.length <= 80 && !/\?/.test(trim)) {
    for (const it of itens)
      res.set(it.item, { escolha: it.recomendada, livre: false, comentario: mAc[2].trim() || null, conf: unico ? "media" : "baixa", via: "aceite-com-comentario" });
    return res;
  }
  // prosa
  const pergunta = /\?\s*$/.test(trim) || /^(o que|por que|porque|quanto|como|qual|quais|quem|onde|quando)\b/i.test(trim);
  for (const it of itens)
    res.set(it.item, { escolha: null, livre: true, comentario: trim.slice(0, 2000), conf: pergunta || !unico ? "baixa" : "media", via: pergunta ? "prosa-pergunta" : "prosa" });
  return res;
}

// ---------- ciclo / papel ----------
function inferirCiclo(o, texto) {
  let m;
  if (WORKTREES) {
    m = (o.gitBranch || "").match(reRamo);
    if (m) return m[1];
    m = (o.cwd || "").match(rePasta);
    if (m) return m[1];
  }
  if (reCicloTexto) {
    m = texto.match(reCicloTexto);
    if (m) return m[1];
  }
  return null;
}

// ---------- principal ----------
const resumo = {
  sessoes_lidas: 0,
  sessoes_filhas_puladas_ou_baixa: 0,
  blocos_achados: 0,
  blocos_sem_item_valido: 0,
  itens_emitidos: 0,
  itens_com_resposta_pareada: 0,
  itens_com_escolha: 0,
  descartadas_phi: 0,
  por_confianca: { alta: 0, media: 0, baixa: 0 },
  por_via: {},
  exemplos_pareamento_ambiguo: [],
};
resumo.prefixos_de_ciclo = [...prefixosCiclo].sort();
const saida = [];
const paraGit = new Map(); // arquivo de decisoes do projeto -> linhas
const chavesEmitidas = new Set();

for (const arq of sessoes) {
  const vistosUuid = new Set();
  const objs = lerLinhas(arq).filter((o) => {
    if (o.isSidechain || (o.type !== "user" && o.type !== "assistant")) return false;
    if (o.uuid) { if (vistosUuid.has(o.uuid)) return false; vistosUuid.add(o.uuid); }
    return true;
  });
  if (!objs.length) continue;
  resumo.sessoes_lidas++;
  const doCwd = raizDoProjeto(objs.find((o) => o.cwd)?.cwd);
  if (!doCwd) resumo.sessoes_sem_raiz_no_cwd = (resumo.sessoes_sem_raiz_no_cwd || 0) + 1; // destino do --repo
  const destino = destinoDe(doCwd ?? REPO);
  const dirNome = path.basename(path.dirname(arq));
  const idDir = (dirNome.match(/bridge-cse-([A-Za-z0-9]+)$/) || [])[1];
  const primeiroUser = objs.find((o) => o.type === "user" && !temToolResult(o.message?.content) && !o.isMeta);
  const tPrim = primeiroUser ? textoDe(primeiroUser.message?.content) : "";
  const filha =
    (idDir && idsSemente.has(idDir)) ||
    (primeiroUser && primeiroUser.origin?.kind === "task-notification") ||
    /^(#+\s*brief\b|##\s*contrato da operária)/i.test(tPrim.trim()) ||
    /\bnonce\s*`?[0-9a-f]{16}/.test(tPrim.slice(0, 600));
  if (filha) resumo.sessoes_filhas_puladas_ou_baixa++;
  const ehMaestra = objs.some(
    (o) => o.type === "assistant" && Array.isArray(o.message?.content) && o.message.content.some((b) => b?.type === "tool_use" && /create_session/.test(b.name || "")),
  );
  const papel = filha ? "filha" : ehMaestra ? "maestra" : "sessao";

  // agrupa mensagens de assistant por message.id
  const eventos = []; // {tipo:'bloco', ...} | {tipo:'humano', o} | {tipo:'texto-assistente'}
  const vistos = new Map();
  for (const o of objs) {
    if (o.type === "assistant") {
      const mid = o.message?.id || o.uuid;
      const t = textoDe(o.message?.content);
      let ev = vistos.get(mid);
      if (!ev) { ev = { tipo: "assistente", textos: [], o, uuidFecho: null, tsFecho: null }; vistos.set(mid, ev); eventos.push(ev); }
      if (t && !ev.textos.includes(t)) {
        ev.textos.push(t);
        if (RE_FECHO.test(t)) { ev.uuidFecho = o.uuid; ev.tsFecho = o.timestamp; ev.oFecho = o; }
      }
    } else if (ehHumano(o)) {
      eventos.push({ tipo: "humano", o });
    }
  }

  let pendentes = []; // blocos aguardando resposta
  let textoDepois = false;
  const ORDEM = { alta: 2, media: 1, baixa: 0 };
  const emitir = (bl, resp, teto = null) => {
    const itensAlvo = bl.itens;
    const parse = resp ? parseResposta(textoDe(resp.o.message.content), itensAlvo) : null;
    for (const it of itensAlvo) {
      const fonte = `sessao:${bl.sessao}#${bl.uuid}`;
      const p = parse ? parse.get(it.item) : null;
      let conf = p ? p.conf : "baixa";
      if (resp && bl.textoDepois && conf === "alta") conf = "media";
      if (resp && bl.multiPendente && p && p.via !== "item+letra" && p.via !== "item-abreviado+letra") conf = "baixa";
      if (teto && ORDEM[conf] > ORDEM[teto]) conf = teto;
      if (filha) conf = "baixa";
      const respLit = resp ? textoDe(resp.o.message.content).slice(0, 2000) : null;
      const escolha = p ? p.escolha : null;
      const linha = {
        origem: "conversa",
        fonte,
        chave: crypto.createHash("sha256").update(fonte + "|" + it.item).digest("hex"),
        sessao: bl.sessao,
        ciclo: bl.ciclo,
        perguntado_em: bl.ts,
        respondido_em: resp ? resp.o.timestamp : null,
        item: it.item,
        titulo: it.titulo,
        contexto: it.contexto,
        opcoes: it.opcoes,
        recomendada: it.recomendada,
        resposta_literal: respLit,
        escolha: escolha || null,
        alternativa_livre: p ? p.livre : null,
        comentario: p ? p.comentario : null,
        seguiu_recomendacao: escolha && it.recomendada ? escolha === it.recomendada : null,
        motivo_recomendacao: it.motivo,
        recomendado_por: `${bl.modelo || "?"} · ${papel}`,
        dominio: it.dominio,
        confianca: conf,
      };
      const textoTodo = [linha.titulo, linha.contexto, linha.resposta_literal, linha.comentario, linha.motivo_recomendacao, linha.ciclo, ...linha.opcoes.map((x) => x.texto)].join("\n");
      let hits;
      try { hits = varrerPhi(textoTodo); } catch { hits = [1]; }
      if (hits.length) { resumo.descartadas_phi++; continue; }
      if (chavesEmitidas.has(linha.chave)) { resumo.duplicadas_por_chave = (resumo.duplicadas_por_chave || 0) + 1; continue; }
      chavesEmitidas.add(linha.chave);
      if (destino.destino === "git") {
        if (!paraGit.has(destino.arquivo)) paraGit.set(destino.arquivo, []);
        paraGit.get(destino.arquivo).push(linha);
      } else saida.push(linha);
      resumo.itens_emitidos++;
      resumo.por_confianca[conf]++;
      if (resp && p) resumo.itens_com_resposta_pareada++;
      if (linha.escolha) resumo.itens_com_escolha++;
      const via = p ? p.via : resp ? "nao-citado" : "sem-resposta";
      resumo.por_via[via] = (resumo.por_via[via] || 0) + 1;
      if (resp && (conf === "baixa" || via === "aceite-generico" || via === "item-sem-letra") && resumo.exemplos_pareamento_ambiguo.length < 5 && !filha &&
          !resumo.exemplos_pareamento_ambiguo.some((e) => e.motivo.startsWith(via))) {
        resumo.exemplos_pareamento_ambiguo.push({ fonte, item: it.item, motivo: `${via}${bl.multiPendente ? " · vários blocos pendentes" : ""}${bl.textoDepois ? " · agente falou depois do bloco" : ""}`, resposta: respLit.slice(0, 160) });
      }
    }
  };

  for (const ev of eventos) {
    if (ev.tipo === "assistente") {
      if (!ev.textos.length) continue;
      const texto = ev.textos.join("\n");
      if (ev.uuidFecho) {
        const bl = parseBloco(texto);
        if (bl) {
          resumo.blocos_achados++;
          if (!bl.itens.length) { resumo.blocos_sem_item_valido++; continue; }
          const reg = {
            sessao: ev.o.sessionId,
            uuid: ev.uuidFecho,
            ts: ev.tsFecho,
            modelo: ev.o.message?.model || null,
            ciclo: inferirCiclo(ev.oFecho || ev.o, texto),
            itens: bl.itens,
            textoDepois: false,
            multiPendente: false,
          };
          // item repetido em bloco anterior pendente: o novo vence; o velho perde o item
          const novos = new Set(reg.itens.map((i) => i.item));
          for (const p of pendentes) {
            const fora = p.itens.filter((i) => novos.has(i.item));
            if (fora.length) { emitir({ ...p, itens: fora }, p.reserva || null, p.reserva ? "baixa" : null); p.itens = p.itens.filter((i) => !novos.has(i.item)); }
          }
          pendentes = pendentes.filter((p) => p.itens.length);
          pendentes.push(reg);
          continue;
        }
      }
      for (const p of pendentes) p.textoDepois = true;
    } else if (ev.tipo === "humano") {
      if (!pendentes.length) continue;
      if (filha && ev.o.origin?.kind !== "human") continue;
      const texto = textoDe(ev.o.message.content);
      const multi = pendentes.length > 1;
      const maisNovo = pendentes[pendentes.length - 1];
      const restam = [];
      for (const p of pendentes) {
        const parse = parseResposta(texto, p.itens);
        const vias = [...parse.values()].map((v) => v.via);
        const explicito = vias.some((v) => v === "item+letra" || v === "item-abreviado+letra");
        if (explicito) {
          p.multiPendente = multi;
          emitir(p, ev, p.tentativas > 0 ? "media" : null);
        } else if (p === maisNovo) {
          const soPergunta = vias.length > 0 && vias.every((v) => v === "prosa-pergunta");
          if (soPergunta && (p.tentativas || 0) < 3) {
            // Leo perguntou antes de decidir: o bloco segue aberto; a 1ª resposta vira reserva
            p.reserva ??= ev;
            p.tentativas = (p.tentativas || 0) + 1;
            restam.push(p);
          } else {
            emitir(p, ev, p.tentativas > 0 ? "media" : null);
          }
        } else {
          // bloco mais velho, sem citação explícita: resposta genérica vai para o mais novo
          p.multiPendente = true;
          emitir(p, p.reserva || ev, "baixa");
        }
      }
      pendentes = restam;
    }
  }
  for (const p of pendentes) emitir(p, p.reserva || null, p.reserva ? "baixa" : null);
}

fs.writeFileSync(path.join(SAIDA, "decisoes.jsonl"), saida.map((l) => JSON.stringify(l)).join("\n") + (saida.length ? "\n" : ""));
// Destino git: o PHI-gate da escrita varre cada folha da linha (o filtro de cima so varre o texto).
resumo.destino_git = [];
let falhou = false;
for (const [arquivo, linhas] of paraGit) {
  try {
    const r = gravarNoGit({ arquivo, linhas });
    resumo.descartadas_phi += r.descartadas_phi;
    resumo.destino_git.push({ arquivo, ...r });
  } catch (e) {
    falhou = true;
    resumo.parcial = true;
    resumo.destino_git.push({ arquivo, erro: e.code ?? e.message });
    console.error(`falha ao gravar ${arquivo}: ${e.code ?? e.message}`);
  }
}
fs.writeFileSync(path.join(SAIDA, "resumo.json"), JSON.stringify(resumo, null, 2) + "\n");
console.log(JSON.stringify(resumo, null, 2));
if (falhou) process.exitCode = 1;
