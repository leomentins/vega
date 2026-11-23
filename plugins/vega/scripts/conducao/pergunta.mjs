/**
 * pergunta.mjs — a pergunta tipada da condução, numa forma só (VEGA-29 T12, AC-VEGA29-3).
 *
 * Toda parada da condução é uma decisão no molde do esboço do VEGA-19
 * (D-VEGA19-3, um tipo só): id, número da sessão, opções, recomendação e
 * destinatário. `perguntar` é o único construtor — as cinco formas que havia
 * (`acao("perguntar")` do `decidir`, `perguntar()` dos verbos, o objeto do
 * `conferir`, `erroComoPergunta` e o do modo da maestra no CLI; revisão
 * `3-codigo.md` §2) passam por ele. A saída do construtor mantém a forma que
 * a maestra já lê (`acao: "perguntar"`, `motivo`, os campos do chamador);
 * a decisão se deriva dela por `decisaoDe`, sem campo novo no JSON.
 *
 * Gravação (`gravar`) no destino que o adaptador declara (`pastaDaPergunta`,
 * D-VEGA29-4), como evento `acao: "pergunta"` do log v1. Só tokens passam
 * (D-VEGA29-20): id da decisão, número da sessão, ids das opções, id da
 * recomendada, papel destinatário e o `sha256` do texto. O texto das opções
 * e da recomendação nunca entra no log; segue onde a maestra o escreve, na
 * conversa. O banco do harness não ganha tipo nem verbo (ruling 26-a do
 * plan-review v1); o registro em catálogo fica com o VEGA-19.
 *
 * Desde a T7 do VEGA-19 a forma da pergunta é peça do corpo
 * (`../pergunta/forma.mjs`): destinatário e número se conferem por ela, e
 * `formaDe` constrói a pergunta da forma a partir da saída da condução. O que
 * a maestra lê (`perguntar`, `decisaoDe`, o evento do log) não muda.
 *
 * Desde a T8 do VEGA-19 quem responde vem da camada da empresa
 * (`../pergunta/destinatarios.mjs`), com o nível da condução (`condutora`):
 * `perguntar` confere o destinatário contra essa tabela e devolve ao
 * `operador` o que nunca desce (guard, instruções de sessão,
 * `canonico-do-ciclo`, `caminho-clinico-fora-dos-outputs`).
 *
 * Desde a T22 do VEGA-20 a `pergunta-da-filha` chega aqui já com destinatário:
 * a vigia (`regras.mjs`) lê a classe do aviso da operária
 * (`destinatarioDaPerguntaDaFilha`) — técnica fica na `condutora`; classe que
 * sobe, ausente ou não reconhecida vai ao `operador` — e o construtor ainda a
 * confere pelo `destinatarioEfetivo`, então o que nunca desce não desce por
 * esta porta. O `destinatario` do evento no log mostra para onde ela foi.
 *
 * `ponteiroDa` dá o `ponteiro` com que a condutora abre a parada como
 * pergunta registrada (`../pergunta/comando.mjs abrir`): o CLI o põe na saída
 * da parada, e a `metrica prova` junta a resposta ao log pelo id da decisão.
 */
import { createHash } from "node:crypto";
import { PONTEIRO_DO_AUTORIZAR } from "./consentimento.mjs";
import * as logEventos from "./log-eventos.mjs";
import { DESTINATARIOS_PADRAO, ErroForma, conferirDestinatario, conferirNumero, criarPergunta } from "../pergunta/forma.mjs";
import { carregar as carregarDestinatarios, destinatarioEfetivo } from "../pergunta/destinatarios.mjs";

export const ACAO = "perguntar";
/** Ação do evento que a gravação deixa no log (≠ a intenção `perguntar`). */
export const EVENTO = "pergunta";
/** Papéis da forma do corpo (`dev-discipline.md` §Escalation), sem camada nem condução. */
export const DESTINATARIOS = DESTINATARIOS_PADRAO;
/**
 * A tabela de quem responde: a camada da empresa mais a `condutora`
 * (T8). Camada presente e ilegível recusa na carga — nunca cai no padrão.
 */
export const TABELA_DE_DESTINATARIOS = carregarDestinatarios();
/** Papéis que a condução aceita como destinatário: os da tabela. */
export const DESTINATARIOS_DA_CONDUCAO = TABELA_DE_DESTINATARIOS.papeis;

const MOTIVO = /^[A-Za-z0-9._:/+@-]{1,200}$/;
const ID_DE_OPCAO = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Saídas que nasceram do construtor; `gravar` só aceita estas. */
const CONSTRUIDAS = new WeakSet();

export class ErroPergunta extends ErroForma {
  constructor(message) {
    super(message);
    this.name = "ErroPergunta";
  }
}

function conferirDecisao(saida) {
  if (saida.opcoes !== undefined) {
    if (!Array.isArray(saida.opcoes)) throw new ErroPergunta("opcoes: esperada lista");
    const ids = new Set();
    for (const [i, o] of saida.opcoes.entries()) {
      if (!o || typeof o !== "object" || !ID_DE_OPCAO.test(o.id ?? "")) throw new ErroPergunta(`opcoes[${i}].id: esperado token minúsculo`);
      if (o.texto !== undefined && typeof o.texto !== "string") throw new ErroPergunta(`opcoes[${i}].texto: esperado texto`);
      if (ids.has(o.id)) throw new ErroPergunta(`opcoes: id repetido ${o.id}`);
      ids.add(o.id);
    }
    if (saida.recomendada !== undefined && !ids.has(saida.recomendada)) throw new ErroPergunta(`recomendada: ${saida.recomendada} não é opção`);
  } else if (saida.recomendada !== undefined) throw new ErroPergunta("recomendada sem opcoes");
  if (saida.recomendacao !== undefined && typeof saida.recomendacao !== "string") throw new ErroPergunta("recomendacao: esperado texto");
  if (saida.destinatario !== undefined) conferirDestinatario(saida.destinatario, "destinatario", ErroPergunta, DESTINATARIOS_DA_CONDUCAO);
  if (saida.caminhos !== undefined && !(Array.isArray(saida.caminhos) && saida.caminhos.every((c) => typeof c === "string"))) throw new ErroPergunta("caminhos: esperada lista de texto");
  if (saida.numero !== undefined) conferirNumero(saida.numero, "numero", ErroPergunta);
}

/**
 * O construtor único. Recebe a saída com `motivo` e os campos do chamador;
 * `acao` vira `perguntar` (campo `acao` do chamador nunca mascara a pergunta).
 * Campos da decisão, todos opcionais: `opcoes` ([{ id, texto }]),
 * `recomendada` (id de uma opção), `recomendacao` (texto), `destinatario`
 * (papel da tabela, default `operador`) e `numero` (o da sessão, que a maestra
 * dá). Destinatário `condutora` em caso que nunca desce (pelo `motivo` ou
 * pelos `caminhos`) sai `operador`.
 */
export function perguntar(saida) {
  if (!saida || typeof saida !== "object" || Array.isArray(saida)) throw new ErroPergunta("pergunta: esperado objeto");
  if (typeof saida.motivo !== "string" || !MOTIVO.test(saida.motivo)) throw new ErroPergunta(`pergunta sem motivo legível: ${JSON.stringify(saida.motivo ?? null)}`);
  conferirDecisao(saida);
  const p = { ...saida, acao: ACAO, motivo: saida.motivo };
  if (saida.destinatario !== undefined) {
    p.destinatario = destinatarioEfetivo({ papel: saida.destinatario, motivo: saida.motivo, caminhos: saida.caminhos ?? [] }, TABELA_DE_DESTINATARIOS);
  }
  CONSTRUIDAS.add(p);
  return p;
}

/**
 * Embrulha uma fábrica de ações `(tipo, …) => ação` (a do `decidir`): a de
 * tipo `perguntar` sai pelo construtor; as demais, como vieram.
 */
export function comPergunta(fabrica) {
  return (tipo, ...resto) => {
    const a = fabrica(tipo, ...resto);
    return tipo === ACAO ? perguntar(a) : a;
  };
}

/** A saída nasceu do construtor? */
export function foiConstruida(saida) {
  return Boolean(saida && typeof saida === "object" && CONSTRUIDAS.has(saida));
}

function sha256(texto) {
  return createHash("sha256").update(texto).digest("hex");
}

/**
 * A decisão da pergunta: id determinístico (o mesmo estado dá o mesmo id —
 * nonce, quando a ação tem, senão ciclo, task, tentativa e motivo), número da
 * sessão, ids das opções, recomendada, destinatário e o `sha256` do texto
 * (opções e recomendação, nessa ordem). O texto fica só aqui, nunca no log.
 */
export function decisaoDe(saida) {
  if (!foiConstruida(saida)) throw new ErroPergunta("decisão de saída que não passou pelo construtor");
  const opcoes = (saida.opcoes ?? []).map((o) => ({ id: o.id, texto: o.texto ?? null }));
  const chave = { ciclo: saida.ciclo ?? null, motivo: saida.motivo, nonce: saida.nonce ?? null, fase: saida.fase ?? null, task: saida.task ?? null, tentativa: saida.tentativa ?? null };
  return {
    id: `d-${sha256(JSON.stringify(chave)).slice(0, 16)}`,
    numero: saida.numero ?? null,
    opcoes,
    recomendada: saida.recomendada ?? null,
    destinatario: saida.destinatario ?? "operador",
    texto: sha256(JSON.stringify({ opcoes: opcoes.map((o) => [o.id, o.texto]), recomendacao: saida.recomendacao ?? null })),
  };
}

/** Token que cabe numa posição da chave escondida (a forma de `posicao` do renderizador). */
const POSICAO_DA_CHAVE = /^[A-Za-z0-9_.-]{1,80}$/;

/**
 * A `chave` com que a condutora abre a parada como pergunta registrada (hotfix chave-da-pergunta,
 * 23/11/2026): ciclo, fase e task da saída e a origem `condutora` (`filha` na `pergunta-da-filha`). Posição fora da forma fica de
 * fora (sai `-`), nunca derruba a parada. A maestra que repassa troca a origem e põe `codigos`.
 */
export function chaveDa(saida) {
  // A pergunta que a filha levantou leva a origem dela (regra 5: o papel de quem levantou).
  const chave = { origem: saida?.motivo === "pergunta-da-filha" ? "filha" : "condutora" };
  for (const k of ["ciclo", "fase", "task"]) if (typeof saida?.[k] === "string" && POSICAO_DA_CHAVE.test(saida[k])) chave[k] = saida[k];
  return chave;
}

/** Prefixo do `ponteiro` da parada registrada: `conducao:<motivo>:<id da decisão>`. */
export const PONTEIRO_DA_PARADA = "conducao:";
/** As paradas cujo "sim" entra pelo `autorizar-ciclo F<n> --pergunta` (SKILL §3), que confere o ponteiro. */
export const MOTIVOS_DO_SIM_DO_CICLO = Object.freeze(["autorizar-ciclo", "plano-mudou"]);

/**
 * O `ponteiro` da pergunta registrada da parada. Nas paradas cujo "sim" entra
 * pelo `autorizar-ciclo` (`MOTIVOS_DO_SIM_DO_CICLO`), o que ele confere
 * (`autorizar-ciclo:F<n>`); nas demais, `conducao:<motivo>:<id da decisão>`,
 * o mesmo id que o evento do log grava.
 * O `+` que o motivo aceita e a forma do ponteiro recusa vira `.`.
 */
export function ponteiroDa(saida) {
  const d = decisaoDe(saida);
  if (MOTIVOS_DO_SIM_DO_CICLO.includes(saida.motivo) && /^F\d{1,2}$/.test(saida.fase ?? "")) return `${PONTEIRO_DO_AUTORIZAR}${saida.fase}`;
  return `${PONTEIRO_DA_PARADA}${saida.motivo.replace(/\+/g, ".")}:${d.id}`;
}

/**
 * Os nomes dos motivos que a parada junta (`motivos: [{ motivo, caminhos }]`, o do `trazer`), em
 * `a+b`, na ordem e sem repetir; null sem nenhum nome legível. Os caminhos nunca vão ao log.
 */
function motivosDa(saida) {
  if (!Array.isArray(saida.motivos)) return null;
  // Nome fora da forma vira `ilegivel`: a parada que juntava motivos nunca some calada do log.
  const nomes = [...new Set(saida.motivos.map((m) => (typeof m === "string" ? m : m?.motivo)).map((m) => (typeof m === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(m) ? m : "ilegivel")))];
  return nomes.length ? nomes.join("+") : null;
}

/** O evento `pergunta` do log: só tokens, nenhum texto. */
export function eventoDa(saida) {
  const d = decisaoDe(saida);
  const evento = {
    acao: EVENTO,
    ciclo: saida.ciclo,
    motivo: saida.motivo,
    decisao: d.id,
    destinatario: d.destinatario,
    textoSha256: d.texto,
  };
  for (const k of ["fase", "task", "tentativa", "nonce"]) if (saida[k] !== undefined && saida[k] !== null) evento[k] = saida[k];
  if (d.numero !== null) evento.numero = d.numero;
  if (d.opcoes.length) evento.opcoes = d.opcoes.map((o) => o.id).join("+");
  if (d.recomendada !== null) evento.recomendada = d.recomendada;
  const motivos = motivosDa(saida);
  if (motivos) evento.motivos = motivos;
  return evento;
}

/**
 * Grava a pergunta no destino do adaptador (`decl.pastaDaPergunta`). Saída
 * que não passou pelo construtor é recusada: a forma é uma só.
 */
export function gravar(saida, decl, { quando } = {}) {
  if (!decl?.pastaDaPergunta) throw new ErroPergunta("adaptador sem pastaDaPergunta");
  return logEventos.registrar(eventoDa(saida), { procedencia: "intencao", quando, pasta: decl.pastaDaPergunta });
}

/**
 * A pergunta na forma do corpo (`../pergunta/forma.mjs`) a partir da saída
 * construída: um item, o `motivo` como assunto e título, o destinatário como
 * papel, as opções na ordem, em letras (`a`, `b`, …), com o texto ou, sem
 * ele, o id da opção. Exige número e ao menos duas opções — a forma não aceita
 * decisão sem menu. Sem `recomendada` (a conferência: só o operador sabe), o
 * item sai com `semRecomendacao`. A marca de paciente é do chamador, explícita:
 * o texto das opções e da recomendação é livre, e a forma não presume que ele
 * venha limpo. `sessao` (e `tentativa`, ignorada quando não é inteiro
 * positivo) derivam o id opaco.
 */
export function formaDe(saida, { sessao, tentativa = null, has_patient_data } = {}) {
  if (!foiConstruida(saida)) throw new ErroPergunta("forma de saída que não passou pelo construtor");
  if (saida.numero === undefined) throw new ErroPergunta("forma: pergunta sem número da sessão");
  if (typeof has_patient_data !== "boolean") throw new ErroPergunta("forma: marca de paciente obrigatória (has_patient_data)");
  const t = tentativa ?? saida.tentativa ?? null;
  const umaLinha = (x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim() : "");
  const opcoes = saida.opcoes ?? [];
  const recomendada = saida.recomendada === undefined ? null : "abcdefghijklmnopqrstuvwxyz"[opcoes.findIndex((o) => o.id === saida.recomendada)];
  return criarPergunta(
    {
      sessao,
      tentativa: Number.isInteger(t) && t > 0 ? t : null,
      numero: saida.numero,
      assunto: saida.motivo,
      papel: saida.destinatario ?? "operador",
      has_patient_data,
      itens: [
        {
          titulo: saida.motivo,
          opcoes: opcoes.map((o) => ({ texto: o.texto ?? o.id })),
          ...(recomendada ? { recomendada, motivo: umaLinha(saida.recomendacao) || saida.recomendada } : { semRecomendacao: "só quem decide sabe" }),
        },
      ],
    },
    { destinatarios: DESTINATARIOS_DA_CONDUCAO, Erro: ErroPergunta },
  );
}
