/**
 * renderizar.mjs — o bloco que o operador lê, escrito a partir do registro
 * (VEGA-19 T9; AC-VEGA19-1, AC-VEGA19-2; D-VEGA19-19, D-VEGA19-22).
 *
 * Entrada: uma pergunta na forma de `forma.mjs` (crua ou já normalizada; a
 * forma é conferida de novo aqui, então ninguém renderiza pergunta fora dela).
 * Saída: `{ texto, nativo, degradado, motivo }`.
 *
 * - `texto` — o bloco no contrato de formato (`references/output-format.md`):
 *   cabeçalho `**Decisão de engenharia — <assunto>**` (o mandato da rota `para`:
 *   engenharia · societária · clínico-regulatória) (plural com mais de um
 *   item, nunca contagem), itens `Dk.`, opções em lista — tabela
 *   `Opção | Pró | Contra` só no item cujas opções levam pró e contra —,
 *   `→ Recomendo (x) — motivo`, `_Decide:_ <titular>` no item que foge do papel do
 *   cabeçalho, fecho `Diz Dk[-…-Dn] e a letra, ou texto livre, para eu
 *   seguir.` e uma chave escondida por item
 *   (`<!-- decisao Dk = <ciclo>/<fase>/<task>/<código> · origem <papel> -->`).
 * - `nativo` — a mesma pergunta no molde da ferramenta nativa de pergunta do
 *   host (1–4 itens, 2–4 opções, rótulo curto); `null` quando passa disso.
 * - `degradado` · `motivo` — acima de 4 itens ou de 4 opções num item, o
 *   render degrada para só texto (D-VEGA19-19; limites do host medidos na
 *   SOTA de 10/10, A4). O texto sai sempre; só o nativo cai.
 *
 * Duas superfícies (`opcoes.superficie`):
 * - `conversa` (padrão) — o bloco solto na conversa; é o que a coleta
 *   (`estado/lib/bloco-de-decisao.mjs`) relê, ida e volta.
 * - `plano` — o bloco de gate do canonico (entre `LEO_GATE_BEGIN/END`), que o
 *   `gate-coherence.mjs` lê: título do item em negrito (`**Dk. título**`) e,
 *   por item, a linha do plano (`` `D-<CICLO>-<N>` · §2.2#N ``) e
 *   `_Bloqueia:_`, vindos de `opcoes.plano[numero]`. A forma da pergunta não
 *   conhece plano; esses campos são da superfície, não do registro.
 *
 * A tabela de opções sai com o texto inteiro em cada célula — opção, pró e
 * contra (D-VEGA19-66). O teto (`TETO_CELULA`, parâmetro `teto`) corta só o
 * rótulo da ferramenta nativa de pergunta do host, que tem limite próprio.
 *
 * Puro: não grava, não lê arquivo, não chama modelo. A previsão do Sistema 1
 * nunca entra aqui (AC-VEGA19-6).
 */
import { criarPergunta, ErroForma } from "./forma.mjs";

/** Caracteres do rótulo de cada opção na ferramenta nativa do host (a tabela não corta: D-VEGA19-66). */
export const TETO_CELULA = 60;
/** Limites da ferramenta nativa de pergunta do host: itens por parada e opções por item. */
export const MAX_ITENS_NATIVO = 4;
export const MAX_OPCOES_NATIVO = 4;
/** Cabeçalho curto do item no nativo. */
const MAX_HEADER_NATIVO = 12;

/**
 * Mandato → como aparece no cabeçalho (D-VEGA19-52, emendada pela D-VEGA19-55): o cabeçalho diz o
 * mandato de quem decide, não o papel nem a natureza dele. O mandato sai da rota `para` da pergunta
 * (T40); sem rota, o mandato padrão do papel.
 */
export const ROTULOS_PADRAO = Object.freeze({
  engenharia: { singular: "Decisão de engenharia", plural: "Decisões de engenharia" },
  societario: { singular: "Decisão societária", plural: "Decisões societárias" },
  "clinico-regulatorio": { singular: "Decisão clínico-regulatória", plural: "Decisões clínico-regulatórias" },
});

/**
 * O recibo da decisão de Vega (D-VEGA19-55): Vega nunca pergunta ao operador o que decide por
 * delegação; a decisão sai numa linha, não num bloco. `titular` é quem delegou (nome ou handle),
 * `regra` a regra que cobre o caso.
 */
export function reciboDeVega({ titular, regra }) {
  for (const [campo, v] of [["titular", titular], ["regra", regra]]) {
    if (typeof v !== "string" || !v.trim() || /[\r\n]/.test(v)) throw new ErroForma(`recibo.${campo}: esperado texto de uma linha`);
  }
  return `Decidido por Vega, por delegação de ${titular.trim()} (${regra.trim()})`;
}

/**
 * A linha da pergunta sobre achado (D-VEGA19-36): a letra escolhe o destino, e sem destino a
 * pergunta não sai da lista do dono. O gancho da coleta lê esta linha para saber que o bloco é de
 * achado (`.claude/hooks/decisao-do-operador.mjs`); a coleta legada a ignora (é uma linha `_…_`).
 */
export const LINHA_DE_ACHADO = "_Achado:_ a letra escolhe o destino; sem destino, a pergunta segue aberta na lista do dono.";

/** Vocabulário fechado da origem da chave escondida (regra 5 do contrato). */
export const ORIGENS = Object.freeze(["maestra", "condutora", "filha", "neta", "hotfix", "docs", "shaping", "planejamento", "fechamento", "avulsa"]);

const SUPERFICIES = new Set(["conversa", "plano"]);

/** Corta no teto, com reticência; nunca quebra a linha. */
export function cortar(texto, teto = TETO_CELULA) {
  const t = String(texto).replace(/\s+/g, " ").trim();
  if (t.length <= teto) return t;
  return `${t.slice(0, Math.max(1, teto - 1)).trimEnd()}…`;
}

/** Célula de tabela: texto inteiro, espaço junto, barra literal escapada (D-VEGA19-66). */
function celula(texto) {
  return String(texto).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

/** Posição da chave escondida: valor sem `/`, `·` nem espaço, ou `-` quando vazia. */
function posicao(valor, campo) {
  if (valor === undefined || valor === null || valor === "" || valor === "-") return "-";
  const t = String(valor).trim();
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(t)) throw new ErroForma(`chave.${campo}: esperado identificador sem espaço, / ou ·`);
  return t;
}

function rotuloDe(mandato, rotulos) {
  const r = rotulos[mandato];
  if (!r) throw new ErroForma(`mandato ${mandato}: sem rótulo de cabeçalho (opcoes.rotulos)`);
  return r;
}

/** O titular do papel, pela matriz da camada (T42): os nomes, com "ou"; sem ninguém declarado, o id do papel. */
function titularDe(papel, tabela) {
  const quem = tabela?.porPapel?.[papel]?.quem ?? [];
  const nomes = quem.map((q) => q.nome ?? q.id);
  if (nomes.length === 0) return papel;
  return nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} ou ${nomes.at(-1)}`;
}

function linhaDoPlano(extra, numero) {
  if (!extra) return [];
  const out = [];
  const cita = [];
  if (extra.decisao) {
    if (!/^D-[A-Z0-9]+-\d+$/.test(extra.decisao)) throw new ErroForma(`plano[${numero}].decisao: esperado D-<CICLO>-<N>`);
    cita.push(`\`${extra.decisao}\``);
  }
  if (extra.ancora) {
    if (!/^§\s*2\.2\s*#\s*\d+$/.test(extra.ancora)) throw new ErroForma(`plano[${numero}].ancora: esperado §2.2#N`);
    cita.push(extra.ancora);
  }
  if (cita.length) out.push(cita.join(" · "));
  if (extra.bloqueia) out.push(`_Bloqueia:_ ${cortar(extra.bloqueia, 200)}`);
  return out;
}

function renderizarItem(item, papel, { superficie, teto, tabela, plano }) {
  const linhas = [];
  const titulo = `D${item.numero}. ${item.titulo}`;
  linhas.push(superficie === "plano" ? `**${titulo}**` : titulo, "");
  if (superficie === "plano") {
    const extra = linhaDoPlano(plano?.[item.numero], item.numero);
    if (extra.length) linhas.push(...extra, "");
  }
  if (item.contexto) linhas.push(item.contexto);
  const comTabela = item.opcoes.some((o) => o.pro !== null);
  if (comTabela) {
    if (item.contexto) linhas.push("");
    linhas.push("| Opção | Pró | Contra |", "|---|---|---|");
    for (const o of item.opcoes) linhas.push(`| (${o.letra}) ${celula(o.texto)} | ${celula(o.pro)} | ${celula(o.contra)} |`);
    linhas.push("");
  } else {
    for (const o of item.opcoes) linhas.push(`- (${o.letra}) ${o.texto}`);
  }
  if (item.recomendada) linhas.push(`→ Recomendo (${item.recomendada}) — ${item.motivo}`);
  else if (item.semRecomendacao) linhas.push(`Sem recomendação — ${item.semRecomendacao}`);
  if (item.destinatario !== papel) linhas.push(`_Decide:_ ${titularDe(item.destinatario, tabela)}`);
  return linhas;
}

function fecho(itens) {
  const nums = itens.map((it) => `D${it.numero}`);
  const lista = nums.length === 1 ? nums[0] : nums.join("-");
  return `Diz ${lista} e a letra, ou texto livre, para eu seguir.`;
}

function chaves(itens, chave) {
  const ciclo = posicao(chave?.ciclo, "ciclo");
  const fase = posicao(chave?.fase, "fase");
  const task = posicao(chave?.task, "task");
  const origem = chave?.origem ?? "avulsa";
  if (!ORIGENS.includes(origem)) throw new ErroForma(`chave.origem: esperado ${ORIGENS.join(" | ")}`);
  return itens.map((it) => {
    // O código é o inteiro de quem levantou: no repasse, o da filha (`chave.codigos`); senão, o próprio número.
    const codigo = chave?.codigos?.[it.numero] ?? it.numero;
    if (!(Number.isInteger(codigo) && codigo > 0)) throw new ErroForma(`chave.codigos[${it.numero}]: esperado inteiro positivo`);
    return `<!-- decisao D${it.numero} = ${ciclo}/${fase}/${task}/${codigo} · origem ${origem} -->`;
  });
}

/** O molde da ferramenta nativa do host, ou `null` com o motivo da degradação. */
function nativoDe(pergunta, teto) {
  if (pergunta.itens.length > MAX_ITENS_NATIVO) return { nativo: null, motivo: `itens: ${pergunta.itens.length} > ${MAX_ITENS_NATIVO}` };
  const largo = pergunta.itens.find((it) => it.opcoes.length > MAX_OPCOES_NATIVO);
  if (largo) return { nativo: null, motivo: `D${largo.numero}: ${largo.opcoes.length} opções > ${MAX_OPCOES_NATIVO}` };
  const questions = pergunta.itens.map((it) => ({
    question: it.titulo,
    header: `D${it.numero}`.slice(0, MAX_HEADER_NATIVO),
    multiSelect: false,
    options: it.opcoes.map((o) => ({
      label: `(${o.letra}) ${cortar(o.texto, teto)}`,
      description: [o.letra === it.recomendada ? "recomendada" : null, o.pro ? `pró: ${o.pro}` : null, o.contra ? `contra: ${o.contra}` : null].filter(Boolean).join(" · "),
    })),
  }));
  return { nativo: Object.freeze({ questions }), motivo: null };
}

/**
 * Renderiza a pergunta. `opcoes`:
 * - `superficie` — `conversa` (padrão) ou `plano`;
 * - `chave` — `{ ciclo, fase, task, origem, codigos }` da chave escondida (`-` no vazio; origem padrão `avulsa`);
 * - `plano` — `{ [numero]: { decisao, ancora, bloqueia } }`, só na superfície `plano`;
 * - `teto` — caracteres do rótulo da ferramenta nativa (padrão `TETO_CELULA`); a tabela não corta;
 * - `rotulos` · `destinatarios` · `tabela` — a camada da empresa (cabeçalhos por mandato, papéis, titulares); sem `tabela`, o `_Decide:_` cai no id do papel (a camada não é importada aqui: ciclo com a forma);
 * - `achado` — pergunta sobre achado: o bloco leva `LINHA_DE_ACHADO` antes do fecho.
 */
export function renderizar(entrada, { superficie = "conversa", chave = null, plano = null, teto = TETO_CELULA, rotulos = ROTULOS_PADRAO, destinatarios, tabela = null, achado = false } = {}) {
  if (!SUPERFICIES.has(superficie)) throw new ErroForma(`superficie: esperado ${[...SUPERFICIES].join(" | ")}`);
  if (typeof achado !== "boolean") throw new ErroForma("achado: esperado booleano");
  if (plano && superficie !== "plano") throw new ErroForma("plano: só na superfície plano");
  if (!(Number.isInteger(teto) && teto >= 8)) throw new ErroForma("teto: esperado inteiro >= 8");
  const pergunta = criarPergunta(entrada, destinatarios ? { destinatarios } : undefined);
  const r = rotuloDe(pergunta.rota.para.mandato, rotulos);
  const cab = `**${pergunta.itens.length === 1 ? r.singular : r.plural} — ${pergunta.assunto}**`;
  const linhas = [cab, ""];
  const anexos = [];
  if (pergunta.ponteiro) anexos.push(`Referência: \`${pergunta.ponteiro}\``);
  if (pergunta.visual.caminho) anexos.push(`Visual: \`${pergunta.visual.caminho}\``);
  if (anexos.length) linhas.push(...anexos, "");
  for (const it of pergunta.itens) linhas.push(...renderizarItem(it, pergunta.papel, { superficie, teto, tabela, plano }), "");
  while (linhas.at(-1) === "") linhas.pop();
  if (achado) linhas.push("", LINHA_DE_ACHADO);
  linhas.push("", fecho(pergunta.itens), ...chaves(pergunta.itens, chave));
  const { nativo, motivo } = nativoDe(pergunta, teto);
  return Object.freeze({ texto: linhas.join("\n"), nativo, degradado: nativo === null, motivo });
}
