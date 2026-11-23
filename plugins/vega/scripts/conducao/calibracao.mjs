#!/usr/bin/env node
/**
 * calibracao.mjs — a calibração da aposentadoria das paradas de regra da condução (VEGA-20 T6).
 *
 * Cada motivo de parada ganha, do próprio histórico, a resposta constante e quantas respostas
 * iguais seguidas bastam para aposentá-lo (D-VEGA20-1). O histórico de um motivo junta os eventos
 * `acao: pergunta` do log da condução (`pastaDoLog`, e `pastaDaPergunta` quando o adaptador a põe
 * noutro lugar) à resposta registrada de cada parada, que o adaptador do projeto entrega
 * (`respostasDasParadasDoProjeto`, a junção da `metrica prova` pelo id da decisão — o mesmo id que
 * `ponteiroDa` põe no ponteiro). Só a resposta que fecha a pergunta conta: a leitura `a-confirmar`
 * (T8) fica do lado do adaptador e nunca chega aqui. O núcleo não importa biblioteca do projeto.
 *
 * A regra (D-VEGA20-1): o número de um motivo é o menor `n` tal que toda sequência de `n`
 * respostas iguais no histórico dele foi seguida da mesma resposta, com pelo menos
 * `PISO_DE_SEQUENCIAS` (3) sequências observadas. O piso vem da regra de três: zero divergência
 * em `k` tentativas dá limite superior de cerca de 3/`k` a 95%. Sem esse `n`, `sem-calibracao`.
 *
 * Degraus (D-VEGA20-3; D5a do operador, 21/11, `p-380a62948374fe20`): o motivo calibrado nasce
 * `observacao` e só passa a `aposentado` com o dobro das sequências da regra (6); o evento `volta`
 * (desfazer ou a mando, gravado pela T20) devolve o motivo a `observacao` e zera o histórico — conta
 * só o que veio depois dele; a resposta aplicada pela aposentadoria (evento `aposentada`, ou
 * pergunta de origem `aposentadoria`) nunca entra no histórico. Log ilegível, linha truncada ou
 * adaptador com erro ⇒ `sem-calibracao` para todos (para), nunca histórico parcial.
 *
 * Vetos (D-VEGA20-3), por código e antes de olhar o histórico: `aposentado()` devolve `nunca` para
 * a instância com `publicacao` ou `protegida` não vazios, `simProprio` clínico ou de publicação,
 * caminho em `NUNCA_REPETEM_POR_CAMINHO`, no que define a parada (`DEFINEM_A_PARADA` do motor somado ao
 * `definemAParada` do adaptador, que o histórico carrega; sem a do adaptador, veta — conta como
 * publicação, D-VEGA20-26)
 * ou nas `instrucoes` do adaptador, `caminhos` ausentes,
 * estação `condutora`, `tipo` em `TIPOS_QUE_NUNCA_REPETEM`, `/publica/` no motivo, ou motivo em
 * `MOTIVOS_DE_INTEGRIDADE` ou `MOTIVOS_QUE_NUNCA_REPETEM` — a lista de `seguePorRepeticao`, com os
 * nomes importados de `consentimento.mjs`. A única exceção é `canonico-do-ciclo`
 * (`MOTIVO_QUE_CALIBRA`, D-VEGA20-18): não sai `nunca` pela lista e segue para o histórico, com os
 * outros vetos da instância valendo antes dele. A lista de `consentimento.mjs` não muda.
 *
 * Verbos:
 *   calibracao.mjs tabela [--repo <árvore>] [--json]
 *       motivo, degrau, resposta constante, `n`, sequências vistas e a data em que entrou no degrau.
 *   calibracao.mjs consultar --motivo <m> --instancia <arquivo.json> [--repo <árvore>]
 *       `{ veredito: aposentado|para|nunca, … }`; sem `--instancia` ou JSON ilegível ⇒ `nunca`.
 *
 * Só ids, tokens de resposta, contagens e horários: nenhum texto de pergunta ou resposta.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codigoDoAdaptador, lerAdaptador, respostasDasParadasDoProjeto } from "./adaptador.mjs";
import {
  DEFINEM_A_PARADA,
  definemAParadaDe,
  MOTIVOS_DE_INTEGRIDADE,
  MOTIVOS_QUE_NUNCA_REPETEM,
  NUNCA_REPETEM_POR_CAMINHO,
  TIPOS_QUE_NUNCA_REPETEM,
} from "./consentimento.mjs";
import { casaAlgum } from "./ler-plano.mjs";

/** Sequências mínimas para o motivo ter número (regra de três, D-VEGA20-1). */
export const PISO_DE_SEQUENCIAS = 3;
/** O degrau `aposentado` pede o dobro das sequências da regra (D5a do operador). */
export const FATOR_DA_APOSENTADORIA = 2;
export const SEQUENCIAS_PARA_APOSENTAR = PISO_DE_SEQUENCIAS * FATOR_DA_APOSENTADORIA;

export const DEGRAUS = Object.freeze(["sem-calibracao", "observacao", "aposentado"]);
export const VEREDITOS = Object.freeze(["aposentado", "para", "nunca"]);

/** A exceção da lista `MOTIVOS_QUE_NUNCA_REPETEM` (D-VEGA20-18). */
export const MOTIVO_QUE_CALIBRA = "canonico-do-ciclo";
/** `simProprio` que nunca se aposenta: o sim próprio de caminho clínico e de publicação que altera. */
export const SIM_PROPRIO_QUE_NUNCA_SE_APOSENTA = Object.freeze(["caminho-clinico", "publicacao-que-altera"]);
export const ESTACAO_QUE_NUNCA_SE_APOSENTA = "condutora";

export const ACAO_DA_PERGUNTA = "pergunta";
export const ACAO_DA_VOLTA = "volta";
export const ACAO_DA_APOSENTADA = "aposentada";
export const ORIGEM_DA_APOSENTADORIA = "aposentadoria";

/** Os motivos que nunca se aposentam pela lista: integridade e os que nunca repetem, menos a exceção. */
const MOTIVOS_VETADOS = Object.freeze([...MOTIVOS_DE_INTEGRIDADE, ...MOTIVOS_QUE_NUNCA_REPETEM.filter((m) => m !== MOTIVO_QUE_CALIBRA)]);

const naoVazio = (v) => {
  if (v === undefined || v === null || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
};

/**
 * O veto da instância, por código, antes do histórico: o nome do veto, ou null. Instância que não
 * é objeto veta (`instancia-ilegivel`). `definemAParada`: a lista efetiva do que define a parada
 * (`definemAParadaDe` do `codigo` do adaptador); ausente ⇒ `define-a-parada`, nunca lista vazia.
 */
export function vetoDaInstancia(motivo, instancia, { instrucoes = [], definemAParada = null } = {}) {
  if (typeof motivo !== "string" || !motivo) return "motivo-ilegivel";
  if (!instancia || typeof instancia !== "object" || Array.isArray(instancia)) return "instancia-ilegivel";
  if (naoVazio(instancia.publicacao)) return "publicacao";
  if (naoVazio(instancia.protegida)) return "protegida";
  if (SIM_PROPRIO_QUE_NUNCA_SE_APOSENTA.includes(instancia.simProprio)) return "sim-proprio";
  if (instancia.estacao === ESTACAO_QUE_NUNCA_SE_APOSENTA) return "estacao-condutora";
  if (!Array.isArray(instancia.caminhos) || !instancia.caminhos.every((c) => typeof c === "string")) return "sem-caminhos";
  // O arquivo que define as paradas que ficam conta como publicação (D-VEGA20-26), declarado ou não,
  // e parada que guarda publicação não se aposenta (D-VEGA20-3). Vem antes de `caminho-que-nunca-repete`:
  // `.vega/**` está nas duas listas, e o nome do veto diz que é publicação.
  // A lista é a do motor somada à do projeto (`definemAParadaDe`); sem a do projeto, veta (falha fechada).
  if (!Array.isArray(definemAParada)) return "define-a-parada";
  if (instancia.caminhos.some((c) => casaAlgum(c, DEFINEM_A_PARADA) || casaAlgum(c, definemAParada))) return "define-a-parada";
  if (instancia.caminhos.some((c) => casaAlgum(c, NUNCA_REPETEM_POR_CAMINHO))) return "caminho-que-nunca-repete";
  const daSessao = [...(Array.isArray(instrucoes) ? instrucoes : []), ...(Array.isArray(instancia.instrucoes) ? instancia.instrucoes : [])];
  if (instancia.caminhos.some((c) => casaAlgum(c, daSessao))) return "instrucoes-de-sessao";
  if (TIPOS_QUE_NUNCA_REPETEM.includes(instancia.tipo)) return "tipo-que-nunca-repete";
  if (/publica/.test(motivo)) return "motivo-de-publicacao";
  if (MOTIVOS_VETADOS.includes(motivo)) return "motivo-que-nunca-repete";
  return null;
}

// ── histórico ────────────────────────────────────────────────────────────────

/** Histórico que para tudo: `sem-calibracao` para todo motivo. */
export function historicoComErro(erro) {
  return Object.freeze({ erro: String(erro), instrucoes: Object.freeze([]), definemAParada: null, porMotivo: new Map() });
}

const instanteDe = (l) => {
  const t = Date.parse(l?.quando ?? "");
  return Number.isFinite(t) ? t : null;
};

/**
 * O histórico por motivo, puro. `linhas`: as linhas do log (objetos já lidos; só `linha: evento`
 * conta); `respostas`: as do adaptador (`[{ decisao, resposta, quando }]`), ou `null` quando o
 * adaptador não as entrega — histórico sem respostas é erro, nunca vazio calado.
 * Devolve `{ erro, instrucoes, porMotivo: Map(motivo → { entradas, volta }) }`, `entradas` na ordem
 * das paradas, cada uma `{ decisao, resposta, quando }` (a parada sem resposta ainda fica fora).
 */
export function historicoDe({ linhas, respostas, instrucoes = [], definemAParada = null }) {
  if (!Array.isArray(linhas)) return historicoComErro("log-ilegivel");
  if (!Array.isArray(respostas)) return historicoComErro("sem-respostas");
  const resposta = new Map();
  for (const r of respostas) {
    if (!r || typeof r.decisao !== "string" || typeof r.resposta !== "string") return historicoComErro("respostas-ilegiveis");
    if (!resposta.has(r.decisao)) resposta.set(r.decisao, r);
  }
  const eventos = [];
  for (const l of linhas) {
    if (!l || typeof l !== "object") return historicoComErro("log-ilegivel");
    if (l.linha !== "evento") continue;
    const t = instanteDe(l);
    if (t === null) return historicoComErro("log-ilegivel");
    eventos.push({ t, acao: l.acao, a: l.atributos && typeof l.atributos === "object" ? l.atributos : {} });
  }
  eventos.sort((x, y) => x.t - y.t);

  const fora = new Set();
  const volta = new Map();
  for (const e of eventos) {
    if (e.acao === ACAO_DA_APOSENTADA && typeof e.a.decisao === "string") fora.add(e.a.decisao);
    if (e.acao === ACAO_DA_PERGUNTA && e.a.origem === ORIGEM_DA_APOSENTADORIA && typeof e.a.decisao === "string") fora.add(e.a.decisao);
    if (e.acao === ACAO_DA_VOLTA && typeof e.a.motivo === "string") volta.set(e.a.motivo, Math.max(volta.get(e.a.motivo) ?? -Infinity, e.t));
  }

  const porMotivo = new Map();
  const de = (m) => {
    if (!porMotivo.has(m)) porMotivo.set(m, { entradas: [], volta: volta.has(m) ? new Date(volta.get(m)).toISOString() : null });
    return porMotivo.get(m);
  };
  for (const m of volta.keys()) de(m);
  const vistas = new Set();
  for (const e of eventos) {
    if (e.acao !== ACAO_DA_PERGUNTA) continue;
    const { motivo, decisao } = e.a;
    if (typeof motivo !== "string" || !motivo || typeof decisao !== "string" || !decisao) continue;
    if (vistas.has(decisao)) continue;
    vistas.add(decisao);
    if (fora.has(decisao)) continue;
    if (volta.has(motivo) && e.t <= volta.get(motivo)) continue;
    const r = resposta.get(decisao);
    if (!r) continue;
    de(motivo).entradas.push({ decisao, resposta: r.resposta, quando: new Date(e.t).toISOString() });
  }
  return Object.freeze({
    erro: null,
    instrucoes: Object.freeze([...instrucoes]),
    definemAParada: Array.isArray(definemAParada) ? Object.freeze([...definemAParada]) : null,
    porMotivo,
  });
}

// ── a regra ──────────────────────────────────────────────────────────────────

/**
 * O número de uma sequência de respostas (D-VEGA20-1): o menor `n` tal que toda janela de `n`
 * respostas iguais com sucessora foi seguida da mesma resposta, com ao menos `PISO_DE_SEQUENCIAS`
 * janelas. Devolve `{ n, sequencias, respostas }` (respostas = os valores das janelas) ou `null`.
 */
export function numeroDe(valores) {
  for (let n = 1; n < valores.length; n++) {
    let sequencias = 0;
    let quebrou = false;
    const vistos = new Set();
    for (let i = 0; i + n < valores.length; i++) {
      let iguais = true;
      for (let j = i + 1; j < i + n; j++) if (valores[j] !== valores[i]) iguais = false;
      if (!iguais) continue;
      if (valores[i + n] !== valores[i]) {
        quebrou = true;
        break;
      }
      sequencias++;
      vistos.add(valores[i]);
    }
    if (!quebrou && sequencias >= PISO_DE_SEQUENCIAS) return { n, sequencias, respostas: [...vistos] };
  }
  return null;
}

/** O degrau de uma série; `voltou` (o motivo teve `volta`) põe a série sem número em `observacao`. */
function degrauDe(valores, voltou = false) {
  const c = numeroDe(valores);
  if (!c) return { degrau: voltou ? "observacao" : "sem-calibracao", n: null, sequencias: 0, resposta: null };
  let cauda = 1;
  while (cauda < valores.length && valores[valores.length - 1 - cauda] === valores[valores.length - 1]) cauda++;
  // A resposta constante é a da série corrente, se ela já tem o tamanho do número; senão nenhuma.
  const resposta = cauda >= c.n ? valores[valores.length - 1] : null;
  return { degrau: c.sequencias >= SEQUENCIAS_PARA_APOSENTAR ? "aposentado" : "observacao", n: c.n, sequencias: c.sequencias, resposta };
}

/**
 * A calibração de cada motivo do histórico: `[{ motivo, degrau, resposta, n, sequencias, desde }]`,
 * `desde` = o horário em que o motivo entrou no degrau (a parada que o pôs nele, ou o último `volta`).
 * Histórico com erro ⇒ lista vazia e `erro` (todo motivo é `sem-calibracao`).
 */
export function calibrar(historico) {
  if (!historico || historico.erro || !(historico.porMotivo instanceof Map)) return Object.assign([], { erro: historico?.erro ?? "historico-ilegivel" });
  const out = [];
  for (const [motivo, { entradas, volta }] of historico.porMotivo) {
    const valores = entradas.map((e) => e.resposta);
    const voltou = volta !== null;
    const atual = degrauDe(valores, voltou);
    let k = valores.length;
    while (k > 0 && degrauDe(valores.slice(0, k - 1), voltou).degrau === atual.degrau) k--;
    const desde = k > 0 ? entradas[k - 1].quando : (volta ?? entradas[0]?.quando ?? null);
    out.push(Object.freeze({ motivo, ...atual, desde }));
  }
  out.sort((a, b) => DEGRAUS.indexOf(b.degrau) - DEGRAUS.indexOf(a.degrau) || a.motivo.localeCompare(b.motivo));
  return Object.assign(out, { erro: null });
}

/**
 * A consulta inteira: `{ veredito, motivo, degrau, resposta, n, sequencias, veto }`. `nunca` sai por
 * código, antes do histórico; `aposentado` só no degrau `aposentado` com a série corrente do tamanho
 * do número; o resto, `para`.
 */
export function consulta(motivo, historico, instancia) {
  // O histórico carrega a lista do adaptador (`carregarHistorico`); sem ela, veta. O histórico com
  // erro já para tudo (`calibrar` devolve o erro): ali os vetos seguem com a lista do motor.
  const definemAParada = historico?.definemAParada ?? (historico?.erro ? DEFINEM_A_PARADA : null);
  const veto = vetoDaInstancia(motivo, instancia, { instrucoes: historico?.instrucoes ?? [], definemAParada });
  if (veto) return { veredito: "nunca", motivo, veto, degrau: null, resposta: null, n: null, sequencias: 0 };
  const c = calibrar(historico);
  const m = c.find((x) => x.motivo === motivo) ?? { degrau: "sem-calibracao", resposta: null, n: null, sequencias: 0 };
  const veredito = m.degrau === "aposentado" && m.resposta !== null ? "aposentado" : "para";
  return { veredito, motivo, veto: null, degrau: m.degrau, resposta: veredito === "aposentado" ? m.resposta : null, n: m.n, sequencias: m.sequencias, ...(c.erro ? { erro: c.erro } : {}) };
}

/** `aposentado`, `para` ou `nunca` para a parada `motivo` nesta instância. */
export function aposentado(motivo, historico, instancia) {
  return consulta(motivo, historico, instancia).veredito;
}

// ── leitura do log e do adaptador ────────────────────────────────────────────

/**
 * As linhas de todos os logs `*.jsonl` das pastas, sem pular nada: linha que não é JSON (truncada
 * por queda) ⇒ `{ erro: "log-ilegivel" }`, nunca histórico parcial. Pasta ausente é vazia.
 */
export function lerLinhasDoLog(pastas) {
  const linhas = [];
  for (const pasta of [...new Set(pastas.filter(Boolean))]) {
    if (!existsSync(pasta)) continue;
    let arquivos;
    try {
      arquivos = readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith(".jsonl"));
    } catch {
      return { erro: "log-ilegivel" };
    }
    for (const a of arquivos) {
      let texto;
      try {
        texto = readFileSync(path.join(pasta, a.name), "utf8");
      } catch {
        return { erro: "log-ilegivel" };
      }
      for (const l of texto.split("\n")) {
        if (!l.trim()) continue;
        try {
          const o = JSON.parse(l);
          if (!o || typeof o !== "object" || Array.isArray(o)) return { erro: "log-ilegivel" };
          linhas.push(o);
        } catch {
          return { erro: "log-ilegivel" };
        }
      }
    }
  }
  return { linhas };
}

/** O histórico do projeto de `repo`: o log do adaptador e as respostas que o código dele entrega. */
export function carregarHistorico(repo, { env = process.env, respostas: respostasFn = respostasDasParadasDoProjeto } = {}) {
  let decl;
  try {
    decl = lerAdaptador(repo, { env });
  } catch {
    return historicoComErro("adaptador-com-erro");
  }
  const lido = lerLinhasDoLog([decl.pastaDoLog, decl.pastaDaPergunta]);
  if (lido.erro) return historicoComErro(lido.erro);
  let respostas;
  try {
    respostas = respostasFn(repo);
  } catch {
    return historicoComErro("adaptador-com-erro");
  }
  // O que define a parada vem do `codigo` do adaptador, carregado junto; falha ⇒ histórico com erro.
  let definemAParada;
  try {
    definemAParada = definemAParadaDe(codigoDoAdaptador(repo));
  } catch {
    return historicoComErro("adaptador-sem-definem-a-parada");
  }
  return historicoDe({ linhas: lido.linhas, respostas, instrucoes: decl.sessao?.instrucoes ?? [], definemAParada });
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function argumentos(argv) {
  const [verbo, ...resto] = argv;
  const o = { verbo };
  for (let i = 0; i < resto.length; i++) {
    const k = resto[i];
    if (k === "--json") o.json = true;
    else if (k.startsWith("--")) o[k.slice(2)] = resto[++i];
  }
  return o;
}

export function textoDaTabela(c) {
  const l = [
    `piso: ${PISO_DE_SEQUENCIAS} sequências por motivo (regra de três: zero divergência em k dá cerca de 3/k a 95%); aposentar pede ${SEQUENCIAS_PARA_APOSENTAR} (o dobro)`,
  ];
  if (c.erro) l.push(`sem calibração: ${c.erro} — toda parada segue parando`);
  l.push(["motivo", "degrau", "resposta", "n", "sequencias", "desde"].join("\t"));
  for (const m of c) l.push([m.motivo, m.degrau, m.resposta ?? "-", m.n ?? "-", m.sequencias, m.desde ?? "-"].join("\t"));
  return l.join("\n");
}

export function principal(argv = process.argv.slice(2), { env = process.env, escrever = (s) => process.stdout.write(s), carregar = carregarHistorico } = {}) {
  const a = argumentos(argv);
  const repo = path.resolve(a.repo ?? process.cwd());
  if (a.verbo === "tabela") {
    const c = calibrar(carregar(repo, { env }));
    escrever(`${a.json ? JSON.stringify({ erro: c.erro, motivos: [...c] }) : textoDaTabela(c)}\n`);
    return 0;
  }
  if (a.verbo === "consultar") {
    if (!a.motivo) {
      escrever(`${JSON.stringify({ veredito: "nunca", motivo: null, veto: "motivo-ilegivel" })}\n`);
      return 0;
    }
    let instancia = null;
    if (a.instancia) {
      try {
        instancia = JSON.parse(readFileSync(path.resolve(a.instancia), "utf8"));
      } catch {
        instancia = null;
      }
    }
    if (!instancia || typeof instancia !== "object" || Array.isArray(instancia)) {
      escrever(`${JSON.stringify({ veredito: "nunca", motivo: a.motivo, veto: a.instancia ? "instancia-ilegivel" : "sem-instancia" })}\n`);
      return 0;
    }
    escrever(`${JSON.stringify(consulta(a.motivo, carregar(repo, { env }), instancia))}\n`);
    return 0;
  }
  process.stderr.write("uso: calibracao.mjs tabela [--repo <árvore>] [--json] | consultar --motivo <m> --instancia <arquivo.json> [--repo <árvore>]\n");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = principal();
