/**
 * forma.mjs — a forma da pergunta, peça do corpo da fábrica (VEGA-19 T7).
 *
 * Toda parada diante do operador que passa pela fábrica é uma pergunta nesta
 * forma, uma só (D-VEGA19-3: um tipo de parada, a decisão). O renderizador
 * (T9), o comando de abrir/responder/dispensar/ler (T11), o destino git (T13)
 * e a condução (`conducao/pergunta.mjs`) leem dela; ninguém monta pergunta à
 * mão.
 *
 * Campos (D-VEGA19-2/4/5/6/10/19):
 * - `versao` — versão do esquema (`ESQUEMA_VERSAO`); grava junto de todo evento.
 *   A entrada pode pedir a versão anterior (`ESQUEMAS_ACEITOS`): é o que a
 *   reabertura de pergunta gravada na v1 usa para manter o id dela.
 * - `id` — id global opaco (`p-<hex>`), derivado por `idDaPergunta`: na v2, de
 *   sessão, número, assunto, tentativa e `conteudo`; na v1, sem o conteúdo. O
 *   mesmo estado dá o mesmo id (abrir é idempotente); id já gravado não muda.
 * - `conteudo` — o hash do conteúdo (`conteudoDaPergunta`: título e texto das
 *   opções de cada item, normalizados), sempre derivado; vai a
 *   `detalhe.conteudo` (D-VEGA19-56, T45). Só hex, nunca texto: segue na
 *   pergunta com paciente.
 * - `numero` — o número da primeira decisão (o da sessão ou do ciclo); os
 *   itens seguem corridos a partir dele (regra 5 do contrato de formato).
 * - `assunto` · `papel` — o cabeçalho `Decisão de <papel> — <assunto>`
 *   (D-VEGA19-22); o papel é o destinatário do bloco inteiro, nunca nome civil.
 * - `itens` — as decisões: `numero`, `titulo`, `contexto`, `destinatario` (o
 *   `_Decide:_` do item que foge do papel do cabeçalho; ausente = o papel),
 *   `opcoes` (`letra`, `texto`, `pro`, `contra`), `recomendada` (letra) com o
 *   `motivo`; `julgamentoDeTela` (a exceção única do contrato: sem
 *   recomendação nem pró/contra); e `semRecomendacao`, o porquê declarado
 *   quando só quem decide sabe (a conferência da condução), no lugar da
 *   recomendação.
 * - `visual` — `{ obrigatorio, caminho }`: caminho durável sob `visual/`;
 *   obrigatório quando as opções diferem no que se vê (D-VEGA19-10).
 * - `has_patient_data` — a marca de paciente, sempre explícita; ligada, o
 *   assunto vai por `ponteiro` — referência opaca, sem espaço — (o registro
 *   recusa dado de paciente e o modelo nem é chamado, D-VEGA19-12). A forma
 *   confere a marca e o ponteiro; a varredura do texto é do comando que grava
 *   (`recusarPhi`, T11) e do destino git (T13).
 * - `rota` — De/Por/Para (D-VEGA19-54, T40), opcional na entrada e sempre na
 *   saída: `de` = `{ sessao, nivel }` (`nivel` do vocabulário `ORIGENS` do
 *   renderizador; ausente = `null`), `por` = `direto` · `hub:<sessão>` ·
 *   `pessoa:<id>` (ausente = `direto`), `para` = `{ papel, mandato, quem }`
 *   (ausente = o papel do cabeçalho com o mandato padrão dele,
 *   `MANDATO_DO_PAPEL`, e `quem` `pessoa`). `para` com a `condutora` (o nível
 *   da condução, D-VEGA19-17) leva `quem` `vega` e mandato `engenharia`: a
 *   condutora responde por delegação (D-VEGA19-55, T42); `vega` fora desse
 *   nível recusa. Só ids e vocabulário, nunca prosa: a rota vai inteira até a
 *   pergunta com paciente. `opcoes.conferirMandato` (a T42 o entrega), quando
 *   vem, confere o mandato contra o titular.
 *
 * Alternativa livre é sempre aceita e nunca listada (D-VEGA19-5): opção
 * "outra"/"outro caminho" é recusada. Degradação acima de 4 itens ou opções é
 * do renderizador, não recusa da forma.
 *
 * A forma não grava nada e não conhece destino: só valida e normaliza. A saída
 * é congelada.
 */
import { createHash } from "node:crypto";

// Ciclo de import com o renderizador (ele lê `criarPergunta`/`ErroForma` daqui): os dois lados só
// usam o que importam dentro de função, nunca no corpo do módulo.
import { ORIGENS } from "./renderizar.mjs";

/**
 * Versão do esquema da pergunta; sobe quando a forma muda de modo incompatível. A v2 (T45,
 * D-VEGA19-56) põe o conteúdo no id; a v1 segue lida e respondida, com o id de antes.
 */
export const ESQUEMA_VERSAO = 2;
/** As versões que a fábrica lê e responde: a atual e a anterior. */
export const ESQUEMAS_ACEITOS = Object.freeze([1, 2]);

/**
 * Papéis que recebem a pergunta por padrão (`dev-discipline.md` §Escalation).
 * A camada da empresa passa a lista dela em `opcoes.destinatarios` (T8).
 */
export const DESTINATARIOS_PADRAO = Object.freeze(["operador", "responsavel-clinico"]);

/** O nível da condução (`NIVEL_DA_CONDUCAO` de `destinatarios.mjs`): a condutora responde por delegação. */
const NIVEL_DA_CONDUCAO = "condutora";

/** Quem se espera que responda: uma pessoa, ou Vega no nível da condução (D-VEGA19-55). */
export const QUEM = Object.freeze(["pessoa", "vega"]);
/** O mandato da decisão — a linha da §Escalation; sem linha, `engenharia` (`MANDATOS` do registro). */
export const MANDATOS = Object.freeze(["engenharia", "societario", "clinico-regulatorio"]);
/** Mandato padrão do papel do cabeçalho; papel fora da lista (camada da empresa) ⇒ `engenharia`. */
export const MANDATO_DO_PAPEL = Object.freeze({ operador: "engenharia", "responsavel-clinico": "clinico-regulatorio", socio: "societario", [NIVEL_DA_CONDUCAO]: "engenharia" });
/** Por onde a pergunta chega a quem decide (e a resposta volta). */
export const POR_DIRETO = "direto";

const CAMPOS_DA_PERGUNTA = new Set(["versao", "id", "sessao", "tentativa", "numero", "assunto", "papel", "itens", "visual", "has_patient_data", "ponteiro", "rota", "conteudo"]);
const CAMPOS_DA_ROTA = new Set(["de", "por", "para"]);
const CAMPOS_DO_DE = new Set(["sessao", "nivel"]);
const CAMPOS_DO_PARA = new Set(["papel", "mandato", "quem"]);
const SESSAO_DA_ROTA = /^[A-Za-z0-9_-]{1,128}$/;
/** `hub:<sessão>` ou `pessoa:<id>` (id = handle ou id de papel, a forma de `em_nome_de`). */
// A sessao do hub cabe em 124: `hub:` + 124 = 128, o teto do valor de atributo do registro.
// `pessoa:<id>`: o registro aceita so handle de `operators.json` ou papel da camada.
const POR = /^(?:hub:[A-Za-z0-9_-]{1,124}|pessoa:[a-z0-9][a-z0-9-]{1,63})$/;
const CAMPOS_DO_ITEM = new Set(["numero", "titulo", "contexto", "destinatario", "opcoes", "recomendada", "motivo", "julgamentoDeTela", "semRecomendacao"]);
const CAMPOS_DA_OPCAO = new Set(["letra", "texto", "pro", "contra"]);
const CAMPOS_DO_VISUAL = new Set(["obrigatorio", "caminho"]);

const LETRAS = "abcdefghijklmnopqrstuvwxyz";
const ID = /^p-[0-9a-f]{16}$/;
/** O hash do conteúdo (`conteudoDaPergunta`): 16 hex. */
const CONTEUDO = /^[0-9a-f]{16}$/;
const LINHA_MAX = 300;
/** Opção que só convida a alternativa livre — o convite mora no fecho, nunca no menu. */
const OPCAO_LIVRE =
  /^\s*(?:\(?[a-z]\)\s*)?(?:outr[oa]s?|alternativas?(?:\s+livres?)?|texto\s+livre)(?:\s+(?:caminhos?|coisas?|op[cç](?:[aã]o|[oõ]es)|alternativas?|sugest(?:[aã]o|[oõ]es)))?\s*(?:[?:!…—–.(-].*)?$/i;
/** Ponteiro: referência opaca, sem espaço — nunca prosa que carregue o dado que substitui. */
const PONTEIRO = /^[A-Za-z0-9_.:/@#-]{1,400}$/;

export class ErroForma extends Error {
  constructor(message) {
    super(message);
    this.name = "ErroForma";
  }
}

function linha(valor, campo, Erro, { opcional = false, max = LINHA_MAX } = {}) {
  if (valor === undefined || valor === null) {
    if (opcional) return null;
    throw new Erro(`${campo}: obrigatório`);
  }
  if (typeof valor !== "string") throw new Erro(`${campo}: esperado texto`);
  const t = valor.trim();
  if (!t) throw new Erro(`${campo}: vazio`);
  if (/[\r\n]/.test(t)) throw new Erro(`${campo}: esperada uma linha`);
  if (t.length > max) throw new Erro(`${campo}: acima de ${max} caracteres`);
  return t;
}

function semCamposDesconhecidos(obj, permitidos, campo, Erro) {
  for (const k of Object.keys(obj)) if (!permitidos.has(k)) throw new Erro(`${campo}: campo desconhecido ${k.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40)}`);
}

function objeto(valor, campo, Erro) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new Erro(`${campo}: esperado objeto`);
  return valor;
}

/** Número de decisão: inteiro positivo. */
export function conferirNumero(valor, campo = "numero", Erro = ErroForma) {
  if (!(Number.isInteger(valor) && valor > 0)) throw new Erro(`${campo}: esperado inteiro positivo`);
  return valor;
}

/** Papel destinatário: um da lista declarada (padrão ou da camada da empresa). */
export function conferirDestinatario(valor, campo = "destinatario", Erro = ErroForma, destinatarios = DESTINATARIOS_PADRAO) {
  if (typeof valor !== "string" || !destinatarios.includes(valor)) throw new Erro(`${campo}: esperado ${destinatarios.join(" | ")}`);
  return valor;
}

/**
 * Id global opaco da pergunta: `p-` + 16 hex do `sha256` de sessão, número,
 * assunto, tentativa e, na v2, o `conteudo` (`conteudoDaPergunta`). Mostrada de
 * novo, a pergunta recebe outro número e, portanto, outro id (D-VEGA19-4);
 * reaberta com o mesmo número e outro conteúdo, também (D-VEGA19-56). `versao`
 * 1 calcula o id de antes, sem o conteúdo: id já gravado não muda.
 */
export function idDaPergunta({ sessao, numero, assunto, tentativa = null, conteudo = null, versao = ESQUEMA_VERSAO }) {
  const s = linha(sessao, "sessao", ErroForma);
  conferirNumero(numero);
  const a = linha(assunto, "assunto", ErroForma);
  if (tentativa !== null && !(Number.isInteger(tentativa) && tentativa > 0)) throw new ErroForma("tentativa: esperado inteiro positivo");
  if (!ESQUEMAS_ACEITOS.includes(versao)) throw new ErroForma(`versao: esquema ${JSON.stringify(versao)} desconhecido`);
  let chave;
  if (versao === 1) chave = JSON.stringify([s, numero, a, tentativa]);
  else {
    if (typeof conteudo !== "string" || !CONTEUDO.test(conteudo)) throw new ErroForma("conteudo: esperado o hash de conteudoDaPergunta (16 hex)");
    chave = JSON.stringify([s, numero, a, tentativa, conteudo]);
  }
  return `p-${createHash("sha256").update(chave).digest("hex").slice(0, 16)}`;
}

/** Texto normalizado para o hash: NFC, espaços colapsados, sem as pontas, minúsculo. */
function normalizado(t) {
  return String(t ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * O hash do conteúdo da pergunta (D-VEGA19-56): 16 hex do `sha256` do título e
 * do texto das opções de cada item, normalizados (`normalizado`). Contexto,
 * recomendação e pró/contra ficam fora: a pergunta é a mesma enquanto o que se
 * escolhe é o mesmo.
 */
export function conteudoDaPergunta(itens) {
  if (!Array.isArray(itens) || itens.length === 0) throw new ErroForma("itens: esperada lista com ao menos uma decisão");
  const base = itens.map((it) => [normalizado(it?.titulo), (Array.isArray(it?.opcoes) ? it.opcoes : []).map((o) => normalizado(o?.texto))]);
  return createHash("sha256").update(JSON.stringify(base)).digest("hex").slice(0, 16);
}

/** Os números de decisão de um `item` gravado (`D3` ou `D3-D5`); fora da forma, vazio. */
export function numerosDoItem(item) {
  const m = /^D(\d{1,6})(?:-D(\d{1,6}))?$/.exec(String(item ?? ""));
  if (!m) return [];
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  if (b < a || b - a > 100) return [a];
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/**
 * As ligações entre perguntas, derivadas dos eventos na leitura (D-VEGA19-56, T45): sem evento
 * novo, sem UPDATE. Devolve `Map<pergunta_id, { superada_por, duplicada_de, bifurcacao }>` só para
 * as perguntas que têm alguma ligação:
 * - `superada_por` — a primeira abertura (por carimbo) que cita a pergunta em `supersedes`, no
 *   mesmo escopo dela (`mesmoEscopo`: o mesmo ciclo; fora de ciclo, a mesma sessão); a resposta já
 *   gravada da superada segue gravada. O elo para fora do escopo, ou para pergunta sem abertura
 *   nos eventos, não liga nada.
 * - `bifurcacao` — as irmãs da bifurcação (fork): aberturas com o mesmo `supersedes`, ou com o
 *   mesmo `conteudo`, ciclo e `item` vindas de sessões diferentes (só dentro de ciclo: fora dele
 *   o número é da sessão e não se compara).
 * - `duplicada_de` — a irmã respondida (a primeira), quando esta pergunta segue sem resposta.
 */
export function mesmoEscopo(a, b) {
  if (!a || !b) return false;
  if (typeof a.ciclo === "string" && a.ciclo) return a.ciclo === b.ciclo;
  return !(typeof b.ciclo === "string" && b.ciclo) && typeof a.sessao === "string" && a.sessao === b.sessao;
}

export function ligacoesDasPerguntas(eventos) {
  const aberturas = new Map();
  const respondidas = new Map();
  const ordenados = [...(Array.isArray(eventos) ? eventos : [])].filter((e) => e && typeof e.pergunta_id === "string").sort((a, b) => Date.parse(a.carimbo) - Date.parse(b.carimbo));
  for (const ev of ordenados) {
    if (ev.evento === "abertura" && !aberturas.has(ev.pergunta_id)) aberturas.set(ev.pergunta_id, ev);
    else if (ev.evento === "resposta" && !respondidas.has(ev.pergunta_id)) respondidas.set(ev.pergunta_id, ev);
  }
  const out = new Map();
  const de = (id) => {
    if (!out.has(id)) out.set(id, { superada_por: null, duplicada_de: null, bifurcacao: [] });
    return out.get(id);
  };
  const grupos = new Map();
  const noGrupo = (chave, a) => {
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(a);
  };
  for (const a of aberturas.values()) {
    const pai = typeof a.supersedes === "string" && ID.test(a.supersedes) && a.supersedes !== a.pergunta_id ? a.supersedes : null;
    // O elo so vale no mesmo escopo do alvo (`mesmoEscopo`), e com a abertura do alvo nos eventos:
    // uma sessao de outro ciclo (ou, fora de ciclo, de outra sessao) nao some com pergunta alheia.
    if (pai && mesmoEscopo(a, aberturas.get(pai))) {
      const p = de(pai);
      p.superada_por ??= a.pergunta_id;
      noGrupo(`supersedes|${pai}`, a);
    }
    if (typeof a.conteudo === "string" && CONTEUDO.test(a.conteudo) && typeof a.ciclo === "string" && a.ciclo && a.item) noGrupo(`conteudo|${a.conteudo}|${a.ciclo}|${a.item}`, a);
  }
  for (const [chave, membros] of grupos) {
    if (membros.length < 2) continue;
    // Pelo conteudo, a irma e so a de outra sessao (a mesma sessao com outra tentativa nao e fork).
    const porConteudo = chave.startsWith("conteudo|");
    for (const m of membros) {
      const irmas = membros.filter((o) => o.pergunta_id !== m.pergunta_id && (!porConteudo || (o.sessao ?? null) !== (m.sessao ?? null)));
      if (irmas.length === 0) continue;
      const l = de(m.pergunta_id);
      for (const outra of irmas) if (!l.bifurcacao.includes(outra.pergunta_id)) l.bifurcacao.push(outra.pergunta_id);
    }
  }
  for (const [id, l] of out) {
    if (respondidas.has(id) || l.bifurcacao.length === 0) continue;
    const irma = l.bifurcacao.map((x) => respondidas.get(x)).filter(Boolean).sort((a, b) => Date.parse(a.carimbo) - Date.parse(b.carimbo))[0];
    if (irma) l.duplicada_de = irma.pergunta_id;
  }
  for (const [id, l] of out) if (!l.superada_por && !l.duplicada_de && l.bifurcacao.length === 0) out.delete(id);
  return out;
}

/**
 * O estado de uma pergunta com as ligações (`ligacoesDasPerguntas`): `superada` vence, depois
 * `duplicada`; sem ligação, o estado de base. Devolve os campos a somar à linha do estado.
 */
export function estadoComLigacoes(estado, ligacao) {
  if (!ligacao) return { estado };
  const extra = {
    ...(ligacao.superada_por ? { superada_por: ligacao.superada_por } : {}),
    ...(ligacao.duplicada_de ? { duplicada_de: ligacao.duplicada_de } : {}),
    ...(ligacao.bifurcacao.length ? { bifurcacao: [...ligacao.bifurcacao] } : {}),
  };
  if (ligacao.superada_por) return { estado: "superada", ...extra };
  if (ligacao.duplicada_de) return { estado: "duplicada", ...extra };
  return { estado, ...extra };
}

/** O mandato padrão do papel (`MANDATO_DO_PAPEL`; papel sem linha ⇒ `engenharia`). */
export function mandatoDoPapel(papel) {
  return Object.hasOwn(MANDATO_DO_PAPEL, papel) ? MANDATO_DO_PAPEL[papel] : "engenharia";
}

/** `por` da rota: `direto`, `hub:<sessão>` ou `pessoa:<id>`; ausente = `direto`. */
export function conferirPor(valor, campo = "rota.por", Erro = ErroForma) {
  if (valor === undefined || valor === null) return POR_DIRETO;
  if (typeof valor !== "string" || !(valor === POR_DIRETO || POR.test(valor))) throw new Erro(`${campo}: esperado direto | hub:<sessão> | pessoa:<id>`);
  return valor;
}

/**
 * A rota De/Por/Para normalizada (D-VEGA19-54). `papel` é o do cabeçalho: `para.papel`, quando vem,
 * tem de ser ele (o bloco inteiro vai a um destinatário). `conferirMandato({ papel, mandato, quem },
 * Erro)`, quando vem (T42), recusa o mandato que o titular do papel não tem.
 */
function conferirRota(valor, { papel, sessao, Erro, conferirMandato }) {
  const r = valor === undefined || valor === null ? {} : objeto(valor, "rota", Erro);
  semCamposDesconhecidos(r, CAMPOS_DA_ROTA, "rota", Erro);
  let de = null;
  if (r.de !== undefined && r.de !== null) {
    objeto(r.de, "rota.de", Erro);
    semCamposDesconhecidos(r.de, CAMPOS_DO_DE, "rota.de", Erro);
    if (typeof r.de.nivel !== "string" || !ORIGENS.includes(r.de.nivel)) throw new Erro(`rota.de.nivel: esperado ${ORIGENS.join(" | ")}`);
    const s = r.de.sessao ?? sessao ?? null;
    if (typeof s !== "string" || !SESSAO_DA_ROTA.test(s)) throw new Erro("rota.de.sessao: esperado id de sessão ([A-Za-z0-9_-])");
    de = { sessao: s, nivel: r.de.nivel };
  }
  const por = conferirPor(r.por, "rota.por", Erro);
  const p = r.para === undefined || r.para === null ? {} : objeto(r.para, "rota.para", Erro);
  semCamposDesconhecidos(p, CAMPOS_DO_PARA, "rota.para", Erro);
  if (p.papel !== undefined && p.papel !== null && p.papel !== papel) throw new Erro(`rota.para.papel: esperado ${papel} (o papel do cabeçalho)`);
  const condutora = papel === NIVEL_DA_CONDUCAO;
  const quem = p.quem === undefined || p.quem === null ? (condutora ? "vega" : "pessoa") : p.quem;
  if (!QUEM.includes(quem)) throw new Erro(`rota.para.quem: esperado ${QUEM.join(" | ")}`);
  if (quem === "vega" && !condutora) throw new Erro(`rota.para.quem: vega só no nível da condução (${NIVEL_DA_CONDUCAO}, D-VEGA19-17)`);
  if (quem !== "vega" && condutora) throw new Erro(`rota.para.quem: a ${NIVEL_DA_CONDUCAO} responde como vega, por delegação (D-VEGA19-55)`);
  const mandato = p.mandato === undefined || p.mandato === null ? mandatoDoPapel(papel) : p.mandato;
  if (!MANDATOS.includes(mandato)) throw new Erro(`rota.para.mandato: esperado ${MANDATOS.join(" | ")}`);
  if (condutora && mandato !== "engenharia") throw new Erro(`rota.para.mandato: a ${NIVEL_DA_CONDUCAO} decide só com o mandato engenharia`);
  const para = { papel, mandato, quem };
  if (typeof conferirMandato === "function") conferirMandato(para, Erro);
  return { de, por, para };
}

function caminhoVisual(valor, Erro) {
  const c = linha(valor, "visual.caminho", Erro, { max: 400 });
  if (c.startsWith("/") || /^[A-Za-z]:/.test(c) || c.includes("\\")) throw new Erro("visual.caminho: esperado caminho relativo com /");
  const partes = c.split("/");
  if (partes.some((p) => p === ".." || p === "." || p === "")) throw new Erro("visual.caminho: segmento inválido");
  const i = partes.indexOf("visual");
  if (i < 0 || i === partes.length - 1) throw new Erro("visual.caminho: esperado arquivo sob uma pasta visual/");
  return c;
}

function conferirVisual(valor, Erro) {
  if (valor === undefined || valor === null) return { obrigatorio: false, caminho: null };
  objeto(valor, "visual", Erro);
  semCamposDesconhecidos(valor, CAMPOS_DO_VISUAL, "visual", Erro);
  if (valor.obrigatorio !== undefined && typeof valor.obrigatorio !== "boolean") throw new Erro("visual.obrigatorio: esperado booleano");
  const obrigatorio = valor.obrigatorio === true;
  const caminho = valor.caminho === undefined || valor.caminho === null ? null : caminhoVisual(valor.caminho, Erro);
  if (obrigatorio && caminho === null) throw new Erro("visual: obrigatório sem caminho em visual/");
  return { obrigatorio, caminho };
}

function conferirOpcoes(lista, campo, Erro) {
  if (!Array.isArray(lista)) throw new Erro(`${campo}: esperada lista`);
  if (lista.length < 2) throw new Erro(`${campo}: decisão pede ao menos duas opções`);
  if (lista.length > LETRAS.length) throw new Erro(`${campo}: opções demais`);
  const opcoes = lista.map((o, i) => {
    const c = `${campo}[${i}]`;
    objeto(o, c, Erro);
    semCamposDesconhecidos(o, CAMPOS_DA_OPCAO, c, Erro);
    const esperada = LETRAS[i];
    if (o.letra !== undefined && o.letra !== esperada) throw new Erro(`${c}.letra: esperada ${esperada} (letras corridas a partir de a)`);
    const texto = linha(o.texto, `${c}.texto`, Erro);
    if (OPCAO_LIVRE.test(texto)) throw new Erro(`${c}.texto: alternativa livre não se lista; o convite mora no fecho`);
    const pro = linha(o.pro, `${c}.pro`, Erro, { opcional: true });
    const contra = linha(o.contra, `${c}.contra`, Erro, { opcional: true });
    if ((pro === null) !== (contra === null)) throw new Erro(`${c}: pró e contra vêm juntos`);
    return { letra: esperada, texto, pro, contra };
  });
  const comProContra = opcoes.filter((o) => o.pro !== null).length;
  if (comProContra && comProContra !== opcoes.length) throw new Erro(`${campo}: pró e contra em todas as opções do item, ou em nenhuma`);
  return opcoes;
}

function conferirItem(item, i, numero, papel, Erro, destinatarios) {
  const c = `itens[${i}]`;
  objeto(item, c, Erro);
  semCamposDesconhecidos(item, CAMPOS_DO_ITEM, c, Erro);
  if (item.numero !== undefined && item.numero !== numero) throw new Erro(`${c}.numero: esperado ${numero} (numeração corrida)`);
  const titulo = linha(item.titulo, `${c}.titulo`, Erro);
  const contexto = item.contexto === undefined || item.contexto === null ? null : linha(item.contexto, `${c}.contexto`, Erro, { max: 600 });
  const destinatario = item.destinatario === undefined || item.destinatario === null ? papel : conferirDestinatario(item.destinatario, `${c}.destinatario`, Erro, destinatarios);
  if (item.julgamentoDeTela !== undefined && typeof item.julgamentoDeTela !== "boolean") throw new Erro(`${c}.julgamentoDeTela: esperado booleano`);
  const julgamentoDeTela = item.julgamentoDeTela === true;
  const opcoes = conferirOpcoes(item.opcoes, `${c}.opcoes`, Erro);
  let recomendada = null;
  let motivo = null;
  let semRecomendacao = null;
  if (julgamentoDeTela) {
    if (item.semRecomendacao !== undefined && item.semRecomendacao !== null) throw new Erro(`${c}: julgamento de tela já dispensa a recomendação`);
    if (item.recomendada !== undefined && item.recomendada !== null) throw new Erro(`${c}: julgamento de tela não leva recomendação`);
    if (opcoes.some((o) => o.pro !== null)) throw new Erro(`${c}: julgamento de tela não leva pró e contra`);
  } else {
    if (item.recomendada === undefined || item.recomendada === null) {
      if (item.semRecomendacao === undefined || item.semRecomendacao === null) throw new Erro(`${c}.recomendada: obrigatória (ou semRecomendacao com o porquê)`);
      semRecomendacao = linha(item.semRecomendacao, `${c}.semRecomendacao`, Erro);
      if (item.motivo !== undefined && item.motivo !== null) throw new Erro(`${c}.motivo: sem recomendação não há motivo`);
      return { numero, titulo, contexto, destinatario, opcoes, recomendada, motivo, julgamentoDeTela, semRecomendacao };
    }
    if (item.semRecomendacao !== undefined && item.semRecomendacao !== null) throw new Erro(`${c}: recomendada e semRecomendacao juntas`);
    if (!opcoes.some((o) => o.letra === item.recomendada)) throw new Erro(`${c}.recomendada: não é letra de opção`);
    recomendada = item.recomendada;
    motivo = linha(item.motivo, `${c}.motivo`, Erro);
  }
  if (julgamentoDeTela && item.motivo !== undefined && item.motivo !== null) throw new Erro(`${c}.motivo: julgamento de tela não leva recomendação`);
  return { numero, titulo, contexto, destinatario, opcoes, recomendada, motivo, julgamentoDeTela, semRecomendacao };
}

function congelar(o) {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) congelar(v);
    Object.freeze(o);
  }
  return o;
}

/**
 * Valida e normaliza uma pergunta. `opcoes.destinatarios` troca a lista de
 * papéis (a camada da empresa, T8); `opcoes.Erro` troca a classe de erro (a
 * condução lança a dela). Recusa alto: campo desconhecido, item sem
 * recomendação, opção que é a alternativa livre, pró sem contra, visual
 * obrigatório sem caminho em `visual/`, marca de paciente ausente, rota fora do vocabulário.
 * `opcoes.conferirMandato` confere o mandato da rota contra o titular (T42).
 */
export function criarPergunta(entrada, { destinatarios = DESTINATARIOS_PADRAO, Erro = ErroForma, conferirMandato = null } = {}) {
  objeto(entrada, "pergunta", Erro);
  semCamposDesconhecidos(entrada, CAMPOS_DA_PERGUNTA, "pergunta", Erro);
  const versao = entrada.versao === undefined || entrada.versao === null ? ESQUEMA_VERSAO : entrada.versao;
  if (!ESQUEMAS_ACEITOS.includes(versao)) throw new Erro(`versao: esquema ${JSON.stringify(entrada.versao)} desconhecido (atual ${ESQUEMA_VERSAO})`);
  const numero = conferirNumero(entrada.numero, "numero", Erro);
  const assunto = linha(entrada.assunto, "assunto", Erro, { max: 200 });
  const papel = conferirDestinatario(entrada.papel, "papel", Erro, destinatarios);
  if (typeof entrada.has_patient_data !== "boolean") throw new Erro("has_patient_data: marca de paciente obrigatória (booleano)");
  const ponteiro = entrada.ponteiro === undefined || entrada.ponteiro === null ? null : linha(entrada.ponteiro, "ponteiro", Erro, { max: 400 });
  if (ponteiro !== null && !PONTEIRO.test(ponteiro)) throw new Erro("ponteiro: esperada referência opaca, sem espaço");
  if (entrada.has_patient_data && ponteiro === null) throw new Erro("ponteiro: pergunta com paciente vai por ponteiro");
  if (!Array.isArray(entrada.itens) || entrada.itens.length === 0) throw new Erro("itens: esperada lista com ao menos uma decisão");
  const itens = entrada.itens.map((it, i) => conferirItem(it, i, numero + i, papel, Erro, destinatarios));
  const visual = conferirVisual(entrada.visual, Erro);
  const rota = conferirRota(entrada.rota, { papel, sessao: typeof entrada.sessao === "string" ? entrada.sessao : null, Erro, conferirMandato });
  const conteudo = conteudoDaPergunta(itens);
  if (entrada.conteudo !== undefined && entrada.conteudo !== null && entrada.conteudo !== conteudo) throw new Erro("conteudo: não bate com o título e as opções dos itens (é derivado, nunca declarado)");
  let id;
  if (entrada.id !== undefined && entrada.id !== null) {
    if (typeof entrada.id !== "string" || !ID.test(entrada.id)) throw new Erro("id: esperado p-<16 hex>");
    id = entrada.id;
  } else {
    if (entrada.sessao === undefined) throw new Erro("id: sem id, a sessão é obrigatória para derivá-lo");
    try {
      id = idDaPergunta({ sessao: entrada.sessao, numero, assunto, tentativa: entrada.tentativa ?? null, conteudo, versao });
    } catch (e) {
      throw new Erro(e.message);
    }
  }
  return congelar({ versao, id, numero, assunto, papel, itens, visual, has_patient_data: entrada.has_patient_data, ponteiro, rota, conteudo });
}

/** A pergunta sai da forma? Devolve `true` ou a mensagem da recusa. */
export function validar(entrada, opcoes) {
  try {
    criarPergunta(entrada, opcoes);
    return true;
  } catch (e) {
    if (e instanceof Error) return e.message;
    throw e;
  }
}
