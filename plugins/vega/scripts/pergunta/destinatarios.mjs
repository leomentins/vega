/**
 * destinatarios.mjs — quem responde a pergunta da fábrica (VEGA-19 T8, D-VEGA19-17).
 *
 * O destinatário deixa de ser lista fixa do corpo: os papéis vêm da camada da
 * empresa (`destinatarios.json`, ao lado desta peça na vitrine da empresa; na
 * fonte, em `.vega/camadas/empresa/<caminho desta peça>.json`), e o corpo só
 * acrescenta o nível da condução, `condutora` — o `trazer` e o re-plano
 * técnico sobem à sessão que conduz, não ao operador (D-VEGA37-29/31). Sem
 * camada (a vitrine do corpo, um projeto sem empresa), valem os papéis da
 * forma (`DESTINATARIOS_PADRAO`) mais a `condutora`.
 *
 * O que sempre sobe ao operador nunca desce à condutora (D-VEGA37-40/41/45):
 * o que liga, desliga ou registra guard (`alcance-dos-hooks`, e todo caminho
 * de `SEGUEM_PERGUNTANDO`), as instruções de sessão (`superficie-de-instrucao`),
 * o `canonico-do-ciclo` e o `caminho-clinico-fora-dos-outputs`.
 * `destinatarioEfetivo` devolve `operador` nesses casos, qualquer que seja o
 * papel pedido.
 *
 * A camada declara, por papel, `paridade` (qualquer um de `quem` responde
 * pelo papel inteiro) e, à parte, `sessoes_de_hub`: as sessões cujo repasse
 * vale como `repasse-hub` (D-VEGA19-27; quem lê é o pareador da T12). O corpo
 * não carrega nome nem registro de quem responde: isso mora só na camada.
 *
 * Quem decide cada mandato (T42, D-VEGA19-55/60): cada papel da camada carrega um `mandato`
 * (`engenharia` · `societario` · `clinico-regulatorio`; ausente = o padrão do papel na forma) e, se
 * quiser, `alcadas` que restringem o titular (hoje só `arquitetura`); `fronteiras` traz uma entrada
 * por linha da §Escalation (`id`, `linha`, `mandato`, `alcada`). `conferirMandato` confere quem
 * decidiu contra essa matriz: Vega só por delegação digitada por um titular, e a pessoa fora da
 * lista de titulares vira dívida de ambiente (em nome do papel do mandato), sem bloquear.
 *
 * Leitura recusa alto: JSON ilegível, esquema alheio, campo desconhecido,
 * papel sem nome válido, paridade com menos de duas pessoas, papel `condutora`
 * declarado pela camada (o nível é do corpo). A saída é congelada.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { casaAlgum } from "../conducao/ler-plano.mjs";
import { MOTIVOS_QUE_NUNCA_REPETEM, SEGUEM_PERGUNTANDO } from "../conducao/consentimento.mjs";
import { DESTINATARIOS_PADRAO, ErroForma, MANDATOS, QUEM, mandatoDoPapel } from "./forma.mjs";

/** Esquema do `destinatarios.json` da camada. */
export const ESQUEMA_CAMADA = 1;

/** O nível da condução: a sessão que conduz a fase. Acrescentado pelo corpo, nunca pela camada. */
export const NIVEL_DA_CONDUCAO = "condutora";

/** Papel para onde sobe o que nunca desce. */
export const OPERADOR = "operador";

/**
 * Motivos que sempre sobem ao operador (D-VEGA37-40/41/45): guard
 * (`alcance-dos-hooks`), instruções de sessão (`superficie-de-instrucao`) e os
 * dois que a pergunta repetida nunca dispensa.
 */
export const SEMPRE_AO_OPERADOR = Object.freeze(["alcance-dos-hooks", "superficie-de-instrucao", ...MOTIVOS_QUE_NUNCA_REPETEM]);

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NOME = "destinatarios.json";
/** O caminho desta peça na fonte, relativo à raiz (`.claude/skills/vega/scripts/pergunta`). */
const PECA_NA_FONTE = path.join(".claude", "skills", "vega", "scripts", "pergunta");
const RAIZ_DA_FONTE = path.resolve(AQUI, "..", "..", "..", "..", "..");

const PAPEL = /^[a-z][a-z0-9-]{0,39}$/;
const ID_DE_PESSOA = /^[a-z][a-z0-9_-]{0,39}$/;
const SESSAO = /^[A-Za-z0-9_-]{1,120}$/;
const CAMPOS_DA_CAMADA = new Set(["esquema", "papeis", "fronteiras", "sessoes_de_hub"]);
const CAMPOS_DO_PAPEL = new Set(["descricao", "quem", "paridade", "mandato", "alcadas"]);
const CAMPOS_DA_FRONTEIRA = new Set(["id", "linha", "mandato", "alcada"]);
/** Alçadas que restringem o titular dentro de um mandato (D-VEGA19-55): hoje só a de arquitetura. */
export const ALCADAS = Object.freeze(["arquitetura"]);
const CAMPOS_DA_PESSOA = new Set(["id", "nome"]);

export class ErroDestinatarios extends ErroForma {
  constructor(message) {
    super(message);
    this.name = "ErroDestinatarios";
  }
}

function texto(valor, campo, max = 400) {
  if (typeof valor !== "string" || !valor.trim()) throw new ErroDestinatarios(`${campo}: esperado texto`);
  if (/[\r\n]/.test(valor) || valor.length > max) throw new ErroDestinatarios(`${campo}: esperada uma linha de até ${max} caracteres`);
  return valor.trim();
}

function semDesconhecidos(obj, permitidos, campo) {
  for (const k of Object.keys(obj)) if (!permitidos.has(k)) throw new ErroDestinatarios(`${campo}: campo desconhecido ${k.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`);
}

function objeto(valor, campo) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new ErroDestinatarios(`${campo}: esperado objeto`);
  return valor;
}

function conferirPapel(nome, p) {
  const c = `papeis.${nome}`;
  objeto(p, c);
  semDesconhecidos(p, CAMPOS_DO_PAPEL, c);
  if (typeof p.paridade !== "boolean") throw new ErroDestinatarios(`${c}.paridade: esperado booleano`);
  const descricao = p.descricao === undefined ? null : texto(p.descricao, `${c}.descricao`, 600);
  let quem = [];
  if (p.quem !== undefined) {
    if (!Array.isArray(p.quem)) throw new ErroDestinatarios(`${c}.quem: esperada lista`);
    const ids = new Set();
    quem = p.quem.map((q, i) => {
      const cq = `${c}.quem[${i}]`;
      objeto(q, cq);
      semDesconhecidos(q, CAMPOS_DA_PESSOA, cq);
      if (typeof q.id !== "string" || !ID_DE_PESSOA.test(q.id)) throw new ErroDestinatarios(`${cq}.id: esperado token minúsculo`);
      if (ids.has(q.id)) throw new ErroDestinatarios(`${c}.quem: id repetido ${q.id}`);
      ids.add(q.id);
      return { id: q.id, nome: texto(q.nome, `${cq}.nome`, 120) };
    });
  }
  if (p.paridade && quem.length < 2) throw new ErroDestinatarios(`${c}: paridade pede ao menos duas pessoas em quem`);
  const mandato = p.mandato === undefined ? mandatoDoPapel(nome) : p.mandato;
  if (!MANDATOS.includes(mandato)) throw new ErroDestinatarios(`${c}.mandato: esperado ${MANDATOS.join(" | ")}`);
  const alcadas = {};
  if (p.alcadas !== undefined) {
    objeto(p.alcadas, `${c}.alcadas`);
    const ids = new Set(quem.map((q) => q.id));
    for (const [a, lista] of Object.entries(p.alcadas)) {
      if (!ALCADAS.includes(a)) throw new ErroDestinatarios(`${c}.alcadas: alçada desconhecida ${a.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`);
      if (!Array.isArray(lista) || lista.length === 0) throw new ErroDestinatarios(`${c}.alcadas.${a}: esperada lista não vazia`);
      for (const id of lista) if (!ids.has(id)) throw new ErroDestinatarios(`${c}.alcadas.${a}: ${String(id).replace(/[^a-z0-9_-]/g, "").slice(0, 40)} não está em quem`);
      alcadas[a] = [...lista];
    }
  }
  return { papel: nome, descricao, quem, paridade: p.paridade, mandato, alcadas };
}

function conferirFronteiras(lista, porPapel) {
  if (lista === undefined) return [];
  if (!Array.isArray(lista)) throw new ErroDestinatarios("fronteiras: esperada lista");
  const ids = new Set();
  const mandatosDosPapeis = new Set(Object.values(porPapel).map((p) => p.mandato));
  return lista.map((f, i) => {
    const c = `fronteiras[${i}]`;
    objeto(f, c);
    semDesconhecidos(f, CAMPOS_DA_FRONTEIRA, c);
    if (typeof f.id !== "string" || !PAPEL.test(f.id)) throw new ErroDestinatarios(`${c}.id: esperado token minúsculo`);
    if (ids.has(f.id)) throw new ErroDestinatarios(`fronteiras: id repetido ${f.id}`);
    ids.add(f.id);
    if (!MANDATOS.includes(f.mandato)) throw new ErroDestinatarios(`${c}.mandato: esperado ${MANDATOS.join(" | ")}`);
    if (!mandatosDosPapeis.has(f.mandato)) throw new ErroDestinatarios(`${c}.mandato: nenhum papel da camada tem ${f.mandato}`);
    const alcada = f.alcada === undefined ? null : f.alcada;
    if (alcada !== null && !ALCADAS.includes(alcada)) throw new ErroDestinatarios(`${c}.alcada: esperado ${ALCADAS.join(" | ")}`);
    return { id: f.id, linha: texto(f.linha, `${c}.linha`, 120), mandato: f.mandato, alcada };
  });
}

/**
 * Valida a camada (o objeto já lido do JSON) e devolve a tabela de
 * destinatários: `papeis` (os da camada, na ordem, mais `condutora`), `porPapel`
 * (`{ papel, descricao, quem, paridade }`), `sessoesDeHub` e `origem`.
 */
export function conferirCamada(camada, { origem = "camada" } = {}) {
  objeto(camada, "destinatarios");
  semDesconhecidos(camada, CAMPOS_DA_CAMADA, "destinatarios");
  if (camada.esquema !== ESQUEMA_CAMADA) throw new ErroDestinatarios(`esquema: ${JSON.stringify(camada.esquema ?? null)} desconhecido (atual ${ESQUEMA_CAMADA})`);
  objeto(camada.papeis, "papeis");
  const nomes = Object.keys(camada.papeis);
  if (!nomes.includes(OPERADOR)) throw new ErroDestinatarios(`papeis: ${OPERADOR} é obrigatório (para onde sobe o que nunca desce)`);
  const porPapel = {};
  for (const nome of nomes) {
    if (!PAPEL.test(nome)) throw new ErroDestinatarios(`papeis: nome de papel inválido ${nome.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`);
    if (nome === NIVEL_DA_CONDUCAO) throw new ErroDestinatarios(`papeis: ${NIVEL_DA_CONDUCAO} é o nível da condução, do corpo; a camada não o declara`);
    porPapel[nome] = conferirPapel(nome, camada.papeis[nome]);
  }
  const fronteiras = conferirFronteiras(camada.fronteiras, porPapel);
  porPapel[NIVEL_DA_CONDUCAO] = { papel: NIVEL_DA_CONDUCAO, descricao: "a sessão que conduz a fase: o trazer e o re-plano técnico", quem: [], paridade: false, mandato: "engenharia", alcadas: {} };
  const hub = camada.sessoes_de_hub ?? [];
  if (!Array.isArray(hub)) throw new ErroDestinatarios("sessoes_de_hub: esperada lista");
  const sessoesDeHub = hub.map((s, i) => {
    if (typeof s !== "string" || !SESSAO.test(s)) throw new ErroDestinatarios(`sessoes_de_hub[${i}]: esperado id de sessão`);
    return s;
  });
  if (new Set(sessoesDeHub).size !== sessoesDeHub.length) throw new ErroDestinatarios("sessoes_de_hub: sessão repetida");
  return congelar({ papeis: [...nomes, NIVEL_DA_CONDUCAO], porPapel, fronteiras, sessoesDeHub, origem });
}

/** A tabela sem camada: os papéis da forma, mais a condutora; nenhuma sessão de hub. */
export function tabelaPadrao() {
  const papeis = {};
  for (const p of DESTINATARIOS_PADRAO) papeis[p] = { paridade: false };
  return conferirCamada({ esquema: ESQUEMA_CAMADA, papeis, sessoes_de_hub: [] }, { origem: "padrao" });
}

/**
 * Onde a camada mora: ao lado da peça (vitrine da empresa) ou, na fonte, sob
 * `.vega/camadas/empresa/` no mesmo caminho da peça. O primeiro que existir.
 */
export function caminhosDaCamada({ aqui = AQUI, raiz = RAIZ_DA_FONTE } = {}) {
  return [path.join(aqui, NOME), path.join(raiz, ".vega", "camadas", "empresa", PECA_NA_FONTE, NOME)];
}

/**
 * Carrega a tabela de destinatários. `caminho` explícito lê só ele (ausente
 * recusa); sem ele, o primeiro de `caminhosDaCamada` que existir, senão a
 * tabela padrão. Camada presente e ilegível recusa — nunca cai no padrão.
 */
export function carregar({ caminho = null, aqui, raiz } = {}) {
  const alvo = caminho ?? caminhosDaCamada({ aqui, raiz }).find((c) => existsSync(c)) ?? null;
  if (alvo === null) return tabelaPadrao();
  let bruto;
  try {
    bruto = readFileSync(alvo, "utf8");
  } catch (e) {
    throw new ErroDestinatarios(`camada ${path.basename(alvo)}: não lida (${e.code ?? "erro"})`);
  }
  let camada;
  try {
    camada = JSON.parse(bruto);
  } catch {
    throw new ErroDestinatarios(`camada ${path.basename(alvo)}: JSON ilegível`);
  }
  return conferirCamada(camada);
}

/** O caso sobe sempre ao operador? Pelo motivo (`SEMPRE_AO_OPERADOR`) ou por caminho de `SEGUEM_PERGUNTANDO`. */
export function sempreAoOperador({ motivo = null, motivos = [], caminhos = [] } = {}) {
  const todos = [motivo, ...motivos].filter((m) => typeof m === "string");
  if (todos.some((m) => SEMPRE_AO_OPERADOR.includes(m))) return true;
  return caminhos.some((c) => typeof c === "string" && casaAlgum(c, SEGUEM_PERGUNTANDO));
}

/**
 * O papel que recebe a pergunta: o pedido (default `operador`), conferido
 * contra a tabela; o que sempre sobe ao operador nunca desce — pedido abaixo
 * do operador (a condutora) volta a `operador`.
 */
export function destinatarioEfetivo({ papel = OPERADOR, motivo = null, motivos = [], caminhos = [] } = {}, tabela = carregar()) {
  if (typeof papel !== "string" || !tabela.papeis.includes(papel)) throw new ErroDestinatarios(`destinatario: esperado ${tabela.papeis.join(" | ")}`);
  if (papel === NIVEL_DA_CONDUCAO && sempreAoOperador({ motivo, motivos, caminhos })) return OPERADOR;
  return papel;
}

/** A sessão é de hub declarado na camada? */
export function eSessaoDeHub(sessao, tabela = carregar()) {
  return typeof sessao === "string" && tabela.sessoesDeHub.includes(sessao);
}

function congelar(o) {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) congelar(v);
    Object.freeze(o);
  }
  return o;
}

// ── quem decide cada mandato (VEGA-19 T42, D-VEGA19-55/60) ──────────────────

const QUEM_DECIDE = new Set(QUEM);

/** O papel da camada que carrega o mandato (o primeiro, na ordem da camada; nunca a condutora). */
export function papelDoMandato(mandato, tabela = carregar()) {
  if (!MANDATOS.includes(mandato)) throw new ErroDestinatarios(`mandato: esperado ${MANDATOS.join(" | ")}`);
  const papel = tabela.papeis.find((p) => p !== NIVEL_DA_CONDUCAO && tabela.porPapel[p].mandato === mandato);
  if (!papel) throw new ErroDestinatarios(`mandato ${mandato}: nenhum papel da camada o carrega`);
  return papel;
}

/**
 * Os titulares do mandato (os `quem` do papel dele) e, com `alcada`, só os da alçada. `null` quando o
 * papel não declara ninguém (a tabela padrão, sem camada): aí a camada não restringe o titular.
 */
export function titularesDe({ mandato, alcada = null }, tabela = carregar()) {
  const p = tabela.porPapel[papelDoMandato(mandato, tabela)];
  if (alcada !== null) {
    if (!ALCADAS.includes(alcada)) throw new ErroDestinatarios(`alcada: esperado ${ALCADAS.join(" | ")}`);
    const da = p.alcadas?.[alcada];
    if (!da) throw new ErroDestinatarios(`alcada ${alcada}: o papel ${p.papel} (mandato ${mandato}) não a declara`);
    return [...da];
  }
  return p.quem.length > 0 ? p.quem.map((q) => q.id) : null;
}

/** A linha da §Escalation pela id (`fronteiras` da camada): `{ id, linha, mandato, alcada }`. */
export function fronteiraDe(id, tabela = carregar()) {
  const f = tabela.fronteiras.find((x) => x.id === id);
  if (!f) throw new ErroDestinatarios(`fronteira: ${String(id).replace(/[^a-z0-9-]/g, "").slice(0, 40)} não está na camada`);
  return f;
}

function delegacaoDoRegistro(d) {
  const out = {};
  if (typeof d.pergunta_id === "string") out.pergunta_id = d.pergunta_id;
  if (typeof d.recibo === "string") out.recibo = d.recibo;
  return out;
}

/**
 * Confere quem decidiu contra o mandato (D-VEGA19-55, emendada pela D-VEGA19-60) e devolve o que o
 * registro grava: `{ quem, mandato, papel, em_nome_de, divida, delegacao }`.
 *
 * - `papel` (opcional) dá o mandato; `mandato` que não é o do papel recusa (mandato fora do papel).
 * - `alcada` (`arquitetura`, da linha da §Escalation citada) restringe o titular aos da alçada.
 * - `quem` `pessoa`: `em_nome_de` é o handle de quem respondeu. Titular ⇒ o handle; fora da lista
 *   ⇒ o id do papel do mandato e `divida` ligada (dívida de ambiente: não bloqueia, a T44 conta).
 * - `quem` `vega`: nunca tem mandato próprio. Recusa sem `delegacao`; recusa delegação que não
 *   aponta resposta humana (`delegacao.humana`, a conferência de quem chama: pergunta com autoria de
 *   origem humana no registro, ou recibo conferido); recusa delegação de quem não é titular do
 *   mandato (ou da alçada). `em_nome_de` = o delegante (`delegacao.de`).
 */
export function conferirMandato({ papel = null, quem, mandato = null, alcada = null, em_nome_de = null, delegacao = null } = {}, tabela = carregar()) {
  if (!QUEM_DECIDE.has(quem)) throw new ErroDestinatarios(`quem: esperado ${QUEM.join(" | ")}`);
  if (papel !== null && !tabela.papeis.includes(papel)) throw new ErroDestinatarios(`papel: esperado ${tabela.papeis.join(" | ")}`);
  const doPapel = papel === null ? null : tabela.porPapel[papel].mandato;
  const m = mandato ?? doPapel;
  if (!MANDATOS.includes(m)) throw new ErroDestinatarios(`mandato: esperado ${MANDATOS.join(" | ")}`);
  if (doPapel !== null && m !== doPapel) throw new ErroDestinatarios(`mandato ${m} fora do papel ${papel} (o papel decide ${doPapel})`);
  const papelDoTitular = papelDoMandato(m, tabela);
  const titulares = titularesDe({ mandato: m, alcada }, tabela);
  const eTitular = (h) => typeof h === "string" && ID_DE_PESSOA.test(h) && (titulares === null || titulares.includes(h));
  if (quem === "pessoa") {
    if (typeof em_nome_de !== "string" || !ID_DE_PESSOA.test(em_nome_de)) throw new ErroDestinatarios("em_nome_de: esperado o handle de quem respondeu");
    const titular = eTitular(em_nome_de);
    return Object.freeze({ quem, mandato: m, papel: papelDoTitular, em_nome_de: titular ? em_nome_de : papelDoTitular, divida: !titular, delegacao: null });
  }
  if (!delegacao || typeof delegacao !== "object") throw new ErroDestinatarios("vega sem delegacao: Vega nunca tem mandato próprio, decide só por delegação que um titular digitou");
  const reg = delegacaoDoRegistro(delegacao);
  if (!reg.pergunta_id && !reg.recibo) throw new ErroDestinatarios("vega sem delegacao: a delegação aponta a pergunta com autoria humana ou o recibo conferido");
  if (delegacao.humana !== true) throw new ErroDestinatarios("delegação não aponta resposta humana (pergunta com autoria de origem humana no registro, ou recibo conferido)");
  if (!eTitular(delegacao.de)) throw new ErroDestinatarios(`delegação de quem não é titular do mandato ${m}${alcada ? ` (alçada ${alcada})` : ""}`);
  if (em_nome_de !== null && em_nome_de !== delegacao.de) throw new ErroDestinatarios("em_nome_de da decisão de Vega é o delegante");
  return Object.freeze({ quem, mandato: m, papel: papelDoTitular, em_nome_de: delegacao.de, divida: false, delegacao: Object.freeze(reg) });
}
