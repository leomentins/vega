// .claude/scripts/decisoes/destino.mjs
// HN-29 T27 (AC-HN29-9, D-HN29-5a) — onde o coletor grava cada decisao: o que o `.vega/` do
// projeto de origem diz. Os tres extratores e o Stop hook `decisao-do-operador.mjs` leem daqui.
//
//   banco — o caminho de hoje: o extrator escreve o `decisoes.jsonl` para `estado.mjs decisao
//           gravar --arquivo`, e o hook chama o verbo em processo separado. O PHI-gate e o do verbo.
//   git   — o arquivo de decisoes do projeto (`decisoes.arquivo`, relativo a raiz dele), em JSON
//           Lines, so crescendo e idempotente pela `chave` (sha256 de fonte|item, a mesma do
//           banco). Esse caminho NAO passa pelo verbo, entao o PHI-gate de CPF/CNS roda aqui, na
//           escrita: cada folha da linha (texto, numero e nome de chave, como `folhasString` de
//           `estado/lib/phi.mjs`) pela primitiva de `../lib/varredura-phi-segredo.mjs` — nunca
//           `estado/lib/decisao.mjs` nem `estado/lib/phi.mjs`, que puxam o banco. Fail-closed:
//           primitiva que lanca descarta a linha e conta em `descartadas_phi`.
//
// Declaracao AUSENTE (so ENOENT) cai no comportamento de hoje (`banco`), e quem chama avisa.
// Presente e ilegivel, ou com destino desconhecido (`"Git"`, `"gti"`), lanca `ErroDestino`, e
// quem chama recusa com exit diferente de 0. Le o `.vega/declaracao.json` como JSON, sem o
// leitor do corpo (`skills/vega/scripts/vega/declaracao.mjs`): o extrator de conversas sai no
// corpo so com `decisoes/` e `lib/` (T44). As duas leituras aplicam a mesma regra aos campos
// que este modulo le — `decisoes` e `worktrees_de_ciclo`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { scanContent } from "../lib/varredura-phi-segredo.mjs";

export const DECLARACAO = path.join(".vega", "declaracao.json");
export const DESTINOS = Object.freeze(["banco", "git"]);

export class ErroDestino extends Error {
  constructor(message) {
    super(message);
    this.name = "ErroDestino";
  }
}

/** A primitiva de CPF/CNS sobre qualquer valor (`null` e numero inclusive): `{ line, kind }[]`. */
export function varrerPhi(texto) {
  return scanContent(String(texto ?? ""));
}

/** As folhas varriveis de um valor: string, numero e o NOME de cada chave (como `folhasString`). */
export function folhas(valor) {
  if (typeof valor === "string") return [valor];
  if (typeof valor === "number" || typeof valor === "bigint") return [String(valor)];
  if (Array.isArray(valor)) return valor.flatMap((v) => folhas(v));
  if (valor && typeof valor === "object") return Object.entries(valor).flatMap(([k, v]) => [k, ...folhas(v)]);
  return [];
}

/**
 * `true` = a linha tem CPF/CNS, ou a primitiva lancou (fail-closed). A `chave` fica de fora: e
 * hash hexadecimal derivado da fonte, que ja e varrida, e um trecho de 11 digitos dela casaria
 * CPF por acaso; `gravarNoGit` a recalcula, nunca grava a de quem chama.
 */
export function linhaComPhi(linha, varrer = varrerPhi) {
  const { chave: _chave, ...resto } = linha ?? {};
  for (const texto of folhas(resto)) {
    try {
      if (varrer(texto).length > 0) return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function chaveDe(fonte, item) {
  return createHash("sha256").update(`${fonte}|${item}`).digest("hex");
}

function caminhoRelativo(v, onde) {
  if (typeof v !== "string" || !v.trim()) throw new ErroDestino(`${onde}: esperado caminho relativo`);
  if (path.isAbsolute(v) || /^[A-Za-z]:/.test(v) || /^[\\/]/.test(v) || v.split(/[\\/]/).includes(".."))
    throw new ErroDestino(`${onde}: caminho fora da raiz (${v})`);
  return v;
}

function worktreesDe(v, onde) {
  if (v === undefined) return null;
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new ErroDestino(`${onde}: esperado objeto`);
  for (const k of Object.keys(v)) if (k !== "ramo" && k !== "pasta") throw new ErroDestino(`${onde}: campo desconhecido ${k}`);
  if (typeof v.ramo !== "string" || !v.ramo.trim()) throw new ErroDestino(`${onde}.ramo: esperado o prefixo do ramo de ciclo`);
  if (typeof v.pasta !== "string" || !v.pasta.trim() || /[\\/]/.test(v.pasta) || v.pasta === "." || v.pasta === "..")
    throw new ErroDestino(`${onde}.pasta: esperado o nome da pasta das worktrees de ciclo, sem barra`);
  return Object.freeze({ ramo: v.ramo, pasta: v.pasta });
}

/**
 * O destino que o projeto em `repo` declara:
 * `{ ausente, repo, declaracao, destino, arquivo, worktrees }` — `arquivo` absoluto so com `git`;
 * `worktrees` = `worktrees_de_ciclo` (`{ ramo, pasta }`) ou `null`.
 */
export function lerDestino(repo) {
  const raiz = path.resolve(repo);
  const declaracao = path.join(raiz, DECLARACAO);
  try {
    lstatSync(declaracao);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") {
      return Object.freeze({ ausente: true, repo: raiz, declaracao, destino: "banco", arquivo: null, worktrees: null });
    }
  }
  let bruto;
  try {
    bruto = JSON.parse(readFileSync(declaracao, "utf8"));
  } catch (e) {
    throw new ErroDestino(`${declaracao}: declaracao ilegivel (${e.code ?? e.message})`);
  }
  if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto)) throw new ErroDestino(`${declaracao}: esperado objeto`);
  const k = bruto.decisoes;
  if (k === null || typeof k !== "object" || Array.isArray(k)) throw new ErroDestino(`${declaracao}: decisoes: esperado objeto`);
  for (const c of Object.keys(k)) if (c !== "destino" && c !== "arquivo") throw new ErroDestino(`${declaracao}: decisoes: campo desconhecido ${c}`);
  if (!DESTINOS.includes(k.destino))
    throw new ErroDestino(`${declaracao}: decisoes.destino: esperado ${DESTINOS.join(" ou ")} (veio ${JSON.stringify(k.destino)})`);
  let arquivo = null;
  if (k.destino === "git") {
    if (k.arquivo === undefined) throw new ErroDestino(`${declaracao}: decisoes.arquivo: obrigatorio com destino git`);
    arquivo = path.join(raiz, caminhoRelativo(k.arquivo, `${declaracao}: decisoes.arquivo`));
  } else if (k.arquivo !== undefined) {
    throw new ErroDestino(`${declaracao}: decisoes.arquivo: so com destino git`);
  }
  const worktrees = worktreesDe(bruto.worktrees_de_ciclo, `${declaracao}: worktrees_de_ciclo`);
  return Object.freeze({ ausente: false, repo: raiz, declaracao, destino: k.destino, arquivo, worktrees });
}

/** A raiz do projeto de uma pasta: a primeira acima dela com `.git`. Pasta que nao existe ⇒ `null`. */
export function raizDoProjeto(pasta) {
  if (typeof pasta !== "string" || !pasta) return null;
  let d = path.resolve(pasta);
  try {
    if (!statSync(d).isDirectory()) return null;
  } catch {
    return null;
  }
  for (;;) {
    if (existsSync(path.join(d, ".git"))) return d;
    const acima = path.dirname(d);
    if (acima === d) return null;
    d = acima;
  }
}

/** A arvore principal de `repo` (a dona do `.git` comum, quando `repo` e worktree); sem git, `repo`. */
export function raizPrincipal(repo) {
  try {
    const comum = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return path.basename(comum) === ".git" ? path.dirname(comum) : path.resolve(repo);
  } catch {
    return path.resolve(repo);
  }
}

/**
 * Grava `linhas` no arquivo de decisoes do projeto (destino `git`). Devolve
 * `{ lidas, gravadas, ja_existiam, descartadas_phi }`; falha de escrita LANCA (quem chama avisa).
 * Nunca reescreve: le as chaves que o arquivo ja tem e acrescenta so as novas.
 */
export function gravarNoGit({ arquivo, linhas, varrer = varrerPhi }) {
  const existentes = new Set();
  let semFimDeLinha = false;
  if (existsSync(arquivo)) {
    const texto = readFileSync(arquivo, "utf8");
    semFimDeLinha = texto.length > 0 && !texto.endsWith("\n");
    let tortas = 0;
    for (const l of texto.split("\n")) {
      if (!l.trim()) continue;
      try {
        const o = JSON.parse(l);
        if (typeof o?.chave === "string") existentes.add(o.chave);
        else tortas++;
      } catch {
        tortas++;
      }
    }
    // Arquivo danificado (conflito de merge, linha cortada): a idempotencia nao vale sobre ele.
    if (tortas > 0) throw new Error(`${arquivo}: ${tortas} linha(s) ilegivel(is) — conserte o arquivo antes de gravar`);
  }
  const novas = [];
  let descartadas_phi = 0;
  let ja_existiam = 0;
  for (const bruta of linhas) {
    if (linhaComPhi(bruta, varrer)) {
      descartadas_phi++;
      continue;
    }
    // A chave sempre recalculada: a de quem chama nao passou pelo gate (e e a mesma conta).
    const { chave: _dada, ...resto } = bruta;
    const linha = { chave: chaveDe(bruta.fonte, bruta.item), ...resto };
    if (existentes.has(linha.chave)) {
      ja_existiam++;
      continue;
    }
    existentes.add(linha.chave);
    novas.push(linha);
  }
  if (novas.length > 0) {
    mkdirSync(path.dirname(arquivo), { recursive: true });
    appendFileSync(arquivo, (semFimDeLinha ? "\n" : "") + novas.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  return { lidas: linhas.length, gravadas: novas.length, ja_existiam, descartadas_phi };
}

/** Escapa texto para dentro de `RegExp`. */
export function escaparRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------------------------
// VEGA-19 T13 (AC-VEGA19-1, D-VEGA19-2 pelo gate D2a) — o destino `git` em eventos.
//
// Cada evento da pergunta e uma linha propria, num arquivo POR SESSAO na mesma pasta do
// `decisoes.arquivo` declarado (`sessao-<id>.jsonl`): `abertura`, `resposta`, `autoria`,
// `dispensa`, `previsao`, `destino` — os seis da T10, com a chave de cada um calculada como no
// banco (`estado/lib/decisao.mjs`). A linha leva `chave`, `versao_esquema` e `carimbo`, e nunca e
// reescrita: o estado (aberta, respondida) e calculado na leitura, que junta os eventos e tolera
// duplicata. Por isso o item pendente nao congela mais (heranca do coletor, item 9): a resposta
// que chega depois e um evento novo, de chave propria, e entra na rodada seguinte.
//
// Pergunta com `has_patient_data` ligado grava so `pergunta_id`, `evento`, `carimbo` e
// `ponteiro` (mais `chave` e `versao_esquema`): sem titulo, opcoes nem resposta literal. A marca
// vale para todo evento da mesma pergunta, inclusive o que chega sem ela depois da abertura.
//
// O arquivo unico antigo (`decisoes.arquivo`, uma linha por item, `gravarNoGit`) segue lido pelo
// leitor, convertido nos mesmos eventos; o gancho Stop ainda grava nele ate a T14.
// ---------------------------------------------------------------------------------------------

/**
 * Versao do esquema do evento; a mesma `ESQUEMA_VERSAO` de `skills/vega/scripts/pergunta/forma.mjs`.
 * A v2 (VEGA-19 T45) poe o conteudo no id da pergunta; a linha da v1 segue lida.
 */
export const VERSAO_ESQUEMA = 2;
export const EVENTOS = Object.freeze(["abertura", "resposta", "autoria", "dispensa", "previsao", "destino"]);
/** Origens da resposta (T10); `hook` nunca: quem sobe a origem e o pareador, por `autoria`. */
export const ORIGENS_RESPOSTA = Object.freeze(["digitado", "digitado-no-hub-conferido", "repasse-hub", "agente", "padrao-da-fabrica"]);

const PERGUNTA_ID = /^p-[0-9a-f]{16}$/;
const SESSAO = /^[A-Za-z0-9_-]{1,128}$/;
const PONTEIRO = /^[A-Za-z0-9_.:/@#-]{1,400}$/;
/** Prova da autoria: ponteiro de estacao, nunca texto (`transcript:` · `get_event:` · `entre-sessoes:`). */
const PROVA = /^(?:transcript|get_event|entre-sessoes):[^\s#]{1,400}#[A-Za-z0-9_-]{1,128}$/;
const CHAVE = /^[0-9a-f]{64}$/;
const PREFIXO_SESSAO = "sessao-";
/**
 * Os unicos campos da linha de pergunta com dado de paciente. `supersedes` (id) da abertura nao e
 * texto: segue, para a superada sair das abertas tambem aqui (T45). O `conteudo` (hash sem chave do
 * titulo e das opcoes) NAO vai a linha restrita: ela e versionada, e o hash confirmaria um palpite
 * de texto offline (revisao de saude da T45); com paciente, ele fica so no banco.
 */
const CAMPOS_RESTRITOS = Object.freeze(["chave", "versao_esquema", "evento", "pergunta_id", "carimbo", "ponteiro", "supersedes"]);

const sha = (...partes) => createHash("sha256").update(partes.join("|")).digest("hex");

/** O arquivo da sessao `sessao`, na pasta do `decisoes.arquivo` declarado. */
export function arquivoDaSessao(arquivo, sessao) {
  if (typeof sessao !== "string" || !SESSAO.test(sessao)) throw new ErroDestino("evento.sessao: esperado id de sessao [A-Za-z0-9_-]");
  return path.join(path.dirname(arquivo), `${PREFIXO_SESSAO}${sessao}.jsonl`);
}

/** A sessao de um arquivo `sessao-<id>.jsonl`; `undefined` fora dessa forma. */
function sessaoDoArquivo(arquivo) {
  const nome = path.basename(arquivo);
  if (!nome.startsWith(PREFIXO_SESSAO) || !nome.endsWith(".jsonl")) return undefined;
  const sessao = nome.slice(PREFIXO_SESSAO.length, -".jsonl".length);
  return SESSAO.test(sessao) ? sessao : undefined;
}

/**
 * JSON com as chaves dos objetos em ordem, em todo nivel; a ordem das listas fica. (Um replacer em
 * lista no `JSON.stringify` filtraria as chaves aninhadas e apagaria a divergencia de `opcoes`.)
 */
function canonico(v) {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonico(x))).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const partes = Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`);
    return `{${partes.join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Id da pergunta extraida de conversa: o par `fonte|item` de sempre, no formato do id da forma. */
export function perguntaIdDe(fonte, item) {
  return `p-${sha("conversa", fonte, item).slice(0, 16)}`;
}

/** A chave do evento, a mesma conta do banco (T10). */
export function chaveDoEvento(ev) {
  const p = ev.pergunta_id;
  switch (ev.evento) {
    case "abertura":
      return sha("abertura", p);
    case "resposta":
      return sha("resposta", p);
    case "dispensa":
      return sha("dispensa", p, ev.carimbo);
    case "autoria":
      return sha("autoria", p, ev.origem_resposta, ev.prova);
    case "previsao":
      return sha("previsao", p, ev.modelo, ev.versao_esquema ?? VERSAO_ESQUEMA);
    case "destino":
      return sha("destino", p, ev.ponteiro);
    default:
      throw new ErroDestino("evento.evento: desconhecido");
  }
}

function carimboValido(v) {
  return typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
}

/** Confere o evento; erro cita o campo, nunca o valor (o valor pode ser dado de paciente). */
function conferirEvento(ev) {
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) throw new ErroDestino("evento: esperado objeto");
  if (!EVENTOS.includes(ev.evento)) throw new ErroDestino(`evento.evento: esperado ${EVENTOS.join(" | ")}`);
  if (typeof ev.pergunta_id !== "string" || !PERGUNTA_ID.test(ev.pergunta_id)) throw new ErroDestino("evento.pergunta_id: esperado p-<16 hex>");
  if (!carimboValido(ev.carimbo)) throw new ErroDestino("evento.carimbo: esperado data ISO");
  if (ev.evento === "abertura" && typeof ev.has_patient_data !== "boolean") throw new ErroDestino("evento.has_patient_data: obrigatorio e booleano na abertura");
  if (ev.has_patient_data !== undefined && typeof ev.has_patient_data !== "boolean") throw new ErroDestino("evento.has_patient_data: esperado booleano");
  if (ev.ponteiro !== undefined && ev.ponteiro !== null && (typeof ev.ponteiro !== "string" || !PONTEIRO.test(ev.ponteiro)))
    throw new ErroDestino("evento.ponteiro: esperado referencia opaca, sem espaco");
  if (ev.origem_resposta !== undefined && ev.origem_resposta !== null && !ORIGENS_RESPOSTA.includes(ev.origem_resposta))
    throw new ErroDestino(`evento.origem_resposta: esperado ${ORIGENS_RESPOSTA.join(" | ")}`);
  if (ev.origem_resposta === "repasse-hub" && !ev.ponteiro) throw new ErroDestino("evento.ponteiro: obrigatorio com repasse-hub");
  if (ev.origem_resposta === "digitado-no-hub-conferido" && !(typeof ev.recibo === "string" && ev.recibo.trim()))
    throw new ErroDestino("evento.recibo: obrigatorio com digitado-no-hub-conferido");
  if (ev.evento === "autoria") {
    if (!ev.origem_resposta) throw new ErroDestino("evento.origem_resposta: obrigatorio na autoria");
    if (typeof ev.prova !== "string" || !PROVA.test(ev.prova)) throw new ErroDestino("evento.prova: esperado transcript:|get_event:|entre-sessoes:<onde>#<uuid>");
  } else if (ev.prova !== undefined) throw new ErroDestino("evento.prova: so na autoria");
  if (ev.evento === "destino" && !ev.ponteiro) throw new ErroDestino("evento.ponteiro: obrigatorio no destino");
  if (ev.evento === "previsao" && !(typeof ev.modelo === "string" && ev.modelo.trim())) throw new ErroDestino("evento.modelo: obrigatorio na previsao");
}

/** Linha restrita (pergunta com dado de paciente): so os campos de `CAMPOS_RESTRITOS`. */
function ehRestrita(linha) {
  // `sessao` chega do nome do arquivo na leitura (`lerEventosDoGit`), nunca da linha gravada.
  return Object.keys(linha).every((k) => CAMPOS_RESTRITOS.includes(k) || k === "sessao");
}

/**
 * A versao gravada na linha: a do evento, quando e uma que este leitor conhece (a linha da v1 segue
 * v1, e um leitor que ainda esta na v1 nao a descarta); sem versao no evento, a atual.
 */
function versaoDoEvento(ev) {
  const v = ev.versao_esquema;
  return Number.isInteger(v) && v >= 1 && v <= VERSAO_ESQUEMA ? v : VERSAO_ESQUEMA;
}

/** Monta a linha do evento: restrita so com os campos minimos; aberta com o resto, menos a marca. */
function linhaDoEvento(ev, { restrita, ponteiroHerdado }) {
  const chave = chaveDoEvento(ev);
  if (restrita) {
    const ponteiro = ev.ponteiro || ponteiroHerdado;
    if (!ponteiro) throw new ErroDestino("evento.ponteiro: obrigatorio em pergunta com dado de paciente");
    return {
      chave,
      versao_esquema: versaoDoEvento(ev),
      evento: ev.evento,
      pergunta_id: ev.pergunta_id,
      carimbo: ev.carimbo,
      ponteiro,
      ...(ev.evento === "abertura" && PERGUNTA_ID.test(String(ev.supersedes ?? "")) ? { supersedes: ev.supersedes } : {}),
    };
  }
  const { chave: _c, versao_esquema: _v, has_patient_data: _h, evento, pergunta_id, carimbo, ...resto } = ev;
  return { chave, versao_esquema: versaoDoEvento(ev), evento, pergunta_id, carimbo, ...resto };
}

/** As linhas de um arquivo JSONL: `{ objetos, tortas }`, cada objeto com o numero da linha. */
function lerJsonl(arquivo) {
  const objetos = [];
  const tortas = [];
  if (!existsSync(arquivo)) return { objetos, tortas, semFimDeLinha: false };
  const texto = readFileSync(arquivo, "utf8");
  texto.split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    try {
      const o = JSON.parse(l);
      if (o && typeof o === "object" && !Array.isArray(o)) objetos.push({ o, linha: i + 1 });
      else tortas.push(i + 1);
    } catch {
      tortas.push(i + 1);
    }
  });
  return { objetos, tortas, semFimDeLinha: texto.length > 0 && !texto.endsWith("\n") };
}

/**
 * Grava `eventos` no destino `git`, cada um no arquivo da sua sessao (`arquivoDaSessao`).
 * Devolve `{ lidos, gravados, ja_existiam, descartadas_phi, arquivos }` (`descartadas_phi` em
 * perguntas). Evento torto LANCA
 * `ErroDestino` antes de qualquer escrita; arquivo de sessao danificado LANCA (a idempotencia nao
 * vale sobre ele). Nunca reescreve: acrescenta so as chaves que o arquivo ainda nao tem.
 */
export function gravarEventosNoGit({ arquivo, eventos, varrer = varrerPhi }) {
  if (!Array.isArray(eventos)) throw new ErroDestino("eventos: esperada lista");
  for (const ev of eventos) conferirEvento(ev);
  const porArquivo = new Map();
  for (const ev of eventos) {
    const destino = arquivoDaSessao(arquivo, ev.sessao);
    if (!porArquivo.has(destino)) porArquivo.set(destino, []);
    porArquivo.get(destino).push(ev);
  }
  let gravados = 0;
  let ja_existiam = 0;
  let descartadas_phi = 0;
  const arquivos = [];
  // Primeiro decide tudo, depois escreve: um arquivo torto nao deixa outro pela metade.
  const plano = [];
  for (const [destino, lista] of porArquivo) {
    const { objetos, tortas, semFimDeLinha } = lerJsonl(destino);
    if (tortas.length > 0) throw new Error(`${destino}: ${tortas.length} linha(s) ilegivel(is) — conserte o arquivo antes de gravar`);
    const existentes = new Set();
    const restritas = new Map(); // pergunta_id -> ponteiro da abertura restrita
    for (const { o } of objetos) {
      if (typeof o.chave === "string") existentes.add(o.chave);
      if (o.evento === "abertura" && ehRestrita(o)) restritas.set(o.pergunta_id, o.ponteiro);
    }
    for (const ev of lista) if (ev.evento === "abertura" && ev.has_patient_data === true) restritas.set(ev.pergunta_id, ev.ponteiro ?? null);
    const montadas = lista.map((ev) => {
      const restrita = ev.has_patient_data === true || restritas.has(ev.pergunta_id);
      return linhaDoEvento(ev, { restrita, ponteiroHerdado: restritas.get(ev.pergunta_id) });
    });
    // CPF/CNS em qualquer evento descarta a pergunta inteira no lote: abertura sem a resposta, ou
    // resposta sem a abertura, ficaria orfa. `descartadas_phi` conta perguntas, como contava itens.
    const comPhi = new Set(montadas.filter((l) => linhaComPhi(l, varrer)).map((l) => l.pergunta_id));
    descartadas_phi += comPhi.size;
    const novas = [];
    for (const linha of montadas) {
      if (comPhi.has(linha.pergunta_id)) continue;
      if (existentes.has(linha.chave)) {
        ja_existiam++;
        continue;
      }
      existentes.add(linha.chave);
      novas.push(linha);
    }
    plano.push({ destino, novas, semFimDeLinha });
  }
  for (const { destino, novas, semFimDeLinha } of plano) {
    if (novas.length > 0) {
      mkdirSync(path.dirname(destino), { recursive: true });
      appendFileSync(destino, (semFimDeLinha ? "\n" : "") + novas.map((l) => JSON.stringify(l)).join("\n") + "\n");
      gravados += novas.length;
    }
    arquivos.push({ arquivo: destino, gravados: novas.length });
  }
  return { lidos: eventos.length, gravados, ja_existiam, descartadas_phi, arquivos };
}

/**
 * Os eventos de uma linha do formato antigo (uma linha por item, a do extrator e do arquivo unico
 * do hub): a `abertura` e, se houve resposta, a `resposta`. Sem `has_patient_data`: o formato
 * antigo so chega aqui depois do PHI-gate, e a pergunta extraida da conversa nao tem ponteiro.
 */
export function eventosDeLinha(linha) {
  const pergunta_id = perguntaIdDe(linha.fonte, linha.item);
  const comum = { pergunta_id, sessao: linha.sessao, origem: linha.origem, fonte: linha.fonte, item: linha.item };
  const abertura = {
    evento: "abertura",
    ...comum,
    carimbo: linha.perguntado_em,
    has_patient_data: false,
    ciclo: linha.ciclo ?? null,
    titulo: linha.titulo,
    contexto: linha.contexto ?? null,
    opcoes: linha.opcoes ?? [],
    recomendada: linha.recomendada ?? null,
    motivo_recomendacao: linha.motivo_recomendacao ?? null,
    recomendado_por: linha.recomendado_por ?? null,
    dominio: linha.dominio ?? null,
  };
  const eventos = [abertura];
  if (linha.resposta_literal !== null && linha.resposta_literal !== undefined) {
    eventos.push({
      evento: "resposta",
      ...comum,
      carimbo: linha.respondido_em ?? linha.perguntado_em,
      perguntado_em: linha.perguntado_em,
      respondido_em: linha.respondido_em ?? null,
      resposta_literal: linha.resposta_literal,
      escolha: linha.escolha ?? null,
      alternativa_livre: linha.alternativa_livre ?? null,
      comentario: linha.comentario ?? null,
      seguiu_recomendacao: linha.seguiu_recomendacao ?? null,
      confianca: linha.confianca ?? null,
    });
  }
  return eventos;
}

/** Os arquivos que o leitor le: o unico antigo (se existir) e os de sessao, em ordem de nome. */
export function arquivosDoDestino(arquivo) {
  const pasta = path.dirname(arquivo);
  let nomes = [];
  try {
    nomes = readdirSync(pasta).filter((n) => n.startsWith(PREFIXO_SESSAO) && n.endsWith(".jsonl")).sort();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return [...(existsSync(arquivo) ? [arquivo] : []), ...nomes.map((n) => path.join(pasta, n))];
}

/**
 * Le o destino `git` inteiro: `{ eventos, descartadas }`. Linha ilegivel, evento torto e duplicata
 * de chave com conteudo diferente viram `descartadas` (`{ arquivo, linha, motivo }`, sem o
 * conteudo); duplicata identica e tolerada em silencio. O arquivo unico antigo entra convertido
 * pelos mesmos eventos (`eventosDeLinha`).
 */
export function lerEventosDoGit({ arquivo }) {
  const eventos = [];
  const descartadas = [];
  const porChave = new Map();
  const aceitar = (ev, onde) => {
    // Conteudo comparado com as chaves em ordem, em todo nivel: o antigo convertido e a linha de sessao montam as
    // mesmas chaves em ordens diferentes, e a mesma decisao nos dois nao e divergente (T15).
    const json = canonico(ev);
    const visto = porChave.get(ev.chave);
    if (visto === undefined) {
      porChave.set(ev.chave, json);
      eventos.push(ev);
    } else if (visto !== json) descartadas.push({ ...onde, motivo: "duplicata-divergente" });
  };
  for (const a of arquivosDoDestino(arquivo)) {
    const antigo = a === arquivo;
    const { objetos, tortas } = lerJsonl(a);
    for (const linha of tortas) descartadas.push({ arquivo: a, linha, motivo: "ilegivel" });
    for (const { o, linha } of objetos) {
      const onde = { arquivo: a, linha };
      if (antigo && o.evento === undefined) {
        if (typeof o.fonte !== "string" || o.item === undefined || !carimboValido(o.perguntado_em)) {
          descartadas.push({ ...onde, motivo: "linha-antiga-incompleta" });
          continue;
        }
        for (const ev of eventosDeLinha(o)) {
          const { has_patient_data: _h, ...resto } = ev;
          aceitar({ chave: chaveDoEvento(ev), versao_esquema: VERSAO_ESQUEMA, ...resto }, onde);
        }
        continue;
      }
      const valido =
        EVENTOS.includes(o.evento) &&
        typeof o.pergunta_id === "string" &&
        PERGUNTA_ID.test(o.pergunta_id) &&
        typeof o.chave === "string" &&
        CHAVE.test(o.chave) &&
        carimboValido(o.carimbo) &&
        Number.isInteger(o.versao_esquema);
      if (!valido) {
        descartadas.push({ ...onde, motivo: "evento-invalido" });
        continue;
      }
      if (o.versao_esquema > VERSAO_ESQUEMA) {
        descartadas.push({ ...onde, motivo: "versao-desconhecida" });
        continue;
      }
      // A linha restrita (pergunta com paciente) nao leva a sessao: ela vem do nome do arquivo, que
      // e o que o gravador usa para achar o arquivo da resposta e da dispensa (T15).
      aceitar(o.sessao === undefined && !antigo ? { ...o, sessao: sessaoDoArquivo(a) } : o, onde);
    }
  }
  return { eventos, descartadas };
}

/** Mostra as descartadas em `saida` (stderr): contagem e onde, nunca o conteudo da linha. */
export function mostrarDescartadas(descartadas, saida = process.stderr) {
  if (!descartadas.length) return;
  saida.write(`aviso: ${descartadas.length} linha(s) descartada(s) na leitura do destino git\n`);
  for (const d of descartadas) saida.write(`  ${d.arquivo}:${d.linha} — ${d.motivo}\n`);
}

/**
 * O estado calculado de cada pergunta, juntando abertura e resposta: um objeto por `pergunta_id`
 * com os campos da abertura e os da resposta por cima, mais `estado` (`aberta` · `respondida` ·
 * `sem-abertura`), `restrita` (abertura so com os campos minimos), `dispensas`, `autorias`,
 * `previsoes` e `destinos`. A dispensa mantem a pergunta aberta (D-VEGA19-19).
 */
export function estadoDasPerguntas(eventos) {
  const porId = new Map();
  const de = (id) => {
    if (!porId.has(id)) porId.set(id, { pergunta_id: id, abertura: null, resposta: null, dispensas: [], autorias: [], previsoes: [], destinos: [] });
    return porId.get(id);
  };
  const ordenados = [...eventos].sort((a, b) => Date.parse(a.carimbo) - Date.parse(b.carimbo));
  for (const ev of ordenados) {
    const p = de(ev.pergunta_id);
    if (ev.evento === "abertura") p.abertura ??= ev;
    else if (ev.evento === "resposta") p.resposta ??= ev;
    else if (ev.evento === "dispensa") p.dispensas.push(ev);
    else if (ev.evento === "autoria") p.autorias.push(ev);
    else if (ev.evento === "previsao") p.previsoes.push(ev);
    else if (ev.evento === "destino") p.destinos.push(ev);
  }
  return [...porId.values()].map((p) => {
    const limpar = (ev) => {
      if (!ev) return {};
      const { chave: _c, evento: _e, carimbo: _t, versao_esquema: _v, ...resto } = ev;
      return resto;
    };
    return {
      ...limpar(p.abertura),
      ...limpar(p.resposta),
      pergunta_id: p.pergunta_id,
      estado: p.resposta ? "respondida" : p.abertura ? "aberta" : "sem-abertura",
      restrita: p.abertura ? ehRestrita(p.abertura) : false,
      aberta_em: p.abertura?.carimbo ?? null,
      respondida_em: p.resposta?.carimbo ?? null,
      dispensas: p.dispensas.length,
      autorias: p.autorias.map((a) => ({ origem_resposta: a.origem_resposta ?? null, prova: a.prova ?? null, carimbo: a.carimbo })),
      previsoes: p.previsoes.length,
      destinos: p.destinos.map((d) => d.ponteiro),
    };
  });
}
