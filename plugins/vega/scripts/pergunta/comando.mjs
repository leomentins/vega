#!/usr/bin/env node
/**
 * comando.mjs — abrir, responder, dispensar e ler a pergunta, peça do corpo da fábrica
 * (VEGA-19 T11; AC-VEGA19-1, AC-VEGA19-2, AC-VEGA19-7; D-VEGA19-24, D-VEGA19-27).
 *
 * Toda parada diante do operador passa por aqui: a pergunta é validada pela forma (`forma.mjs`),
 * registrada ANTES de ser mostrada, e o bloco sai do renderizador (`renderizar.mjs`). O lugar do
 * registro é o que o projeto declara em `.vega/declaracao.json` `decisoes.destino`:
 *
 * - `banco` — o verbo `estado.mjs pergunta <abrir|responder|dispensar|ler>` do projeto, em processo
 *   separado (`VERBO_DO_BANCO`); PHI, fila local do registro fora do ar e rowcount moram lá
 *   (na Sistoli, `.claude/scripts/estado/lib/pergunta.mjs`).
 * - `git` — o gravador da T13 (`gravarEventosNoGit`/`lerEventosDoGit`), sem gravador próprio; PHI
 *   achado lá recusa alto aqui.
 *
 * Peça do corpo da fábrica, sem import de biblioteca de projeto (D-VEGA19-37): o registro de
 * decisões, o gravador do destino git, as regras de achado e dívida e a lista do dono chegam pelo
 * adaptador do projeto — o código que a declaração aponta em `codigo` exporta `pecasDaPergunta()`
 * (na Sistoli, `.vega/sistoli.mjs`). Adaptador sem ela ⇒ o comando recusa (`pecasDoProjeto`).
 *
 * Os quatro verbos:
 * - `abrir` — entrada `{ sessao?, ciclo?, chave?, pergunta, supersedes? }`; grava o evento `abertura`
 *   (a sessão é o id do transcript local: sem ela, `CLAUDE_CODE_SESSION_ID`; id de nuvem recusa,
 *   `sessaoDoAbrir`; a reabertura que só corrige um id de nuvem gravado devolve o id antigo)
 *   (a chave escondida se completa do contexto, `completarChave`: chave dada > log da condução >
 *   ramo > `-` — o log dá ciclo, fase e task pela sessão da árvore `bridge-cse_<X>`, a origem vem do
 *   ramo; `--ciclo/--fase/--task/--origem` entram na chave — hotfixes chave-da-pergunta e
 *   vega-chave-do-log-da-conducao, 23/11/2026)
 *   (idempotente: o mesmo estado dá o mesmo `pergunta_id` e a mesma chave) e devolve o bloco. Registro
 *   fora do ar não trava: o bloco sai marcado `sem registro` e o evento fica na fila (D-VEGA19-24).
 *   Reabertura calada some (T45, D-VEGA19-56): a mesma sessão, número e assunto com outro conteúdo
 *   recusa `conteudo-diferente`, e o número de decisão que outra pergunta do mesmo ciclo (fora de
 *   ciclo, da mesma sessão) já usou recusa `numero-ja-usado`, as duas citando o id existente, salvo
 *   com `supersedes` (`--supersedes <p-id>`), que tem de existir no registro. A abertura grava
 *   `conteudo` e `supersedes`; a reabertura igual de pergunta gravada na v1 mantém o id dela.
 * - `responder` — `--pergunta <id> --literal <texto>`; exige o literal do operador, interpreta-o
 *   (`interpretarResposta`: `D6a`, `6a`, letra única do bloco de um item, opção com comentário,
 *   alternativa livre), grava `resposta` com `origem_resposta` `agente` — quem sobe a origem é o
 *   gancho, pela linha `autoria` (D-VEGA19-27) — e recusa a origem `hook`. Amarrada à versão do
 *   esquema da abertura. `--recibo "<sessao> <evento>"` (a forma de `RECIBO_GRAVADO`) grava o recibo
 *   do repasse na coluna; `--por` diz por onde a resposta chegou (`detalhe.rota.por`, que pode
 *   diferir do da abertura). A resposta grava o mandato da rota `para` da abertura; `quem` fica nulo
 *   (quem sobe quem respondeu é a autoria, T41) (D-VEGA19-54, T40). A resposta que não casa com o
 *   bloco (número que a pergunta não tem, letra fora das opções) grava `a-confirmar` com o literal e
 *   a leitura, não fecha a pergunta e sai com a frase de confirmação (D-VEGA20-6, VEGA-20 T8).
 * - `dispensar` — `--pergunta <id> [--motivo]`; grava `dispensa`, que mantém a pergunta aberta.
 * - `ler` — o estado calculado (`estadoDasPerguntas`) e, no banco, a linha `fila: N pendentes…`.
 *   As ligações (`ligacoesDasPerguntas` da forma) entram por cima: `superada` (com `superada_por`),
 *   `duplicada` (com `duplicada_de`) e a `bifurcacao` marcada; `--abertas` sai sem as duas.
 *   Com `--abertas [--dono <handle>]` (T12), a lista do dono: o que falta responder, com a idade,
 *   a marca `caducada` e o lembrete (`perguntasAbertas`/`lembreteDeCaducadas` das peças do
 *   projeto). O dono e o operador que gravou a abertura; o destino
 *   git nao guarda dono, entao recusa `--dono`.
 * - `destino` (T12) — `--pergunta <id> --ponteiro <p>`; grava a linha `destino` (o ponteiro de que o
 *   destino aconteceu) da pergunta ja respondida com destino. Ate ela, a pergunta segue na lista do
 *   dono como `destino-sem-ponteiro` (AC-VEGA19-4).
 *
 * Achado e divida (T12; AC-VEGA19-3, AC-VEGA19-4; D-VEGA19-6, D-VEGA19-23): `abrir` com `achado: true`
 * so aceita opcoes que nomeiam destinos de `.agents/decisao/destino-de-achado.md`; a resposta dela
 * leva o destino da opcao escolhida (ou `--destino`, que tem de bater). `--destino debito` exige
 * `--porque` da lista curta, `--severidade` e `--gatilho`: no destino banco o verbo registra o debito
 * ligado a decisao e grava o id dele na linha `destino`; no destino git nao ha registro de debito, e
 * o comando recusa.
 *
 * ── WIRING (script-created-without-invoker) ──
 *   1. PRODUCAO — o agente roda na parada: `node .claude/skills/vega/scripts/pergunta/comando.mjs
 *      abrir --arquivo -` (e `responder`/`dispensar`/`ler`); o contrato da condução passa a mandar
 *      isso na T14 (`skills/conducao/references/contrato.md`), e o pareador da T14 lê por `ler`.
 *   2. `.claude/skills/vega/scripts/pergunta/__tests__/comando.test.mjs` — teste do corpo, com as
 *      peças e os registros dublês de `__tests__/dubles.mjs`.
 *   3. `.vega/__tests__/sistoli.test.mjs` — o comando com as peças reais da Sistoli (banco falso
 *      sobre a lib, banco fora e drenagem, destino git).
 *   4. A sombra do Sistema 1 (T21): `principal abrir` passa `sombra: sombrear` (`./sombra.mjs`); o
 *      `abrir` chamado direto (testes, ganchos) só a roda com `sombra` explícito.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { conferirPor, conteudoDaPergunta, criarPergunta, ESQUEMAS_ACEITOS, estadoComLigacoes, idDaPergunta, ligacoesDasPerguntas, MANDATOS, mandatoDoPapel, mesmoEscopo, numerosDoItem } from "./forma.mjs";
import { SESSAO_DO_CONSENTIMENTO } from "../conducao/consentimento.mjs";
import { carregar as carregarDestinatarios } from "./destinatarios.mjs";
import { origemEfetiva as origemDaProva, SESSAO_DE_NUVEM } from "./prova.mjs";
import { renderizar } from "./renderizar.mjs";
import { chaveDoRamo, ramoAtual } from "./chave.mjs";
import { chaveDoLog, sessaoDaArvore } from "./chave-do-log.mjs";
import { sombrear } from "./sombra.mjs";
import { escolhasCitadas, lerTokens } from "./escolhas.mjs";
import { caminhoDeCodigo, caminhoDoEmbutido, codigoDoAdaptador, ehNomeEmbutido, lerAdaptador } from "../conducao/adaptador.mjs";

/** O verbo do destino banco, relativo à raiz do projeto. */
export const VERBO_DO_BANCO = path.join(".claude", "scripts", "estado", "estado.mjs");
/**
 * Prazo do processo do verbo: acima do prazo do registro (10 s) vezes a drenagem da fila. O trinco
 * da fila guarda o pid do dono, entao um verbo morto pelo prazo nao deixa a fila presa.
 */
const PRAZO_DO_VERBO_MS = 120_000;

export const EXIT = Object.freeze({ OK: 0, USO: 1, RECUSA: 2, PHI: 8 });

export class ErroComando extends Error {
  constructor(mensagem, codigo = EXIT.RECUSA) {
    super(mensagem);
    this.name = "ErroComando";
    this.codigo = codigo;
  }
}

const SESSAO = /^[A-Za-z0-9_-]{1,128}$/;
/** O id do ciclo (a forma de `ciclo` no registro, `decisao.mjs`). */
const CICLO = /^[A-Za-z][A-Za-z0-9._-]{1,127}$/;
const PERGUNTA_ID = /^p-[0-9a-f]{16}$/;
/** O recibo do repasse: `<sessao> <evento>` (mesma forma de `RECIBO_GRAVADO` do registro). */
const RECIBO = /^[A-Za-z0-9_-]{1,128} [A-Za-z0-9_-]{1,128}$/;
const CAMPOS_DO_ABRIR = new Set(["sessao", "ciclo", "chave", "pergunta", "achado", "supersedes"]);

// ── as peças do projeto ─────────────────────────────────────────────────────

/**
 * As peças que o comando recebe do projeto (D-VEGA19-37): o registro de decisões
 * (`estadoDasPerguntas`, `lerDestino`), o gravador do destino git (`gravarEventosNoGit`,
 * `lerEventosDoGit`, `mostrarDescartadas`), as regras de achado e dívida e a lista do dono. O corpo
 * da fábrica não importa biblioteca de projeto nenhum: o adaptador as entrega.
 */
export const PECAS = Object.freeze({
  funcoes: Object.freeze([
    "estadoDasPerguntas",
    "lerDestino",
    "gravarEventosNoGit",
    "lerEventosDoGit",
    "mostrarDescartadas",
    "conferirDebito",
    "conferirDestino",
    "conferirOpcoesDeAchado",
    "destinoDoTexto",
    "formatarAbertas",
    "lembreteDeCaducadas",
    "perguntasAbertas",
  ]),
  listas: Object.freeze(["PORQUES_DE_DEBITO"]),
});

/** O nome da função que o código do adaptador exporta (fora do `default`) para entregar as peças. */
export const EXPORT_DAS_PECAS = "pecasDaPergunta";

/** Confere as peças: toda função e toda lista presentes; falta alguma ⇒ recusa, nunca roda pela metade. */
export function conferirPecas(pecas, onde = "peças da pergunta") {
  if (!pecas || typeof pecas !== "object") throw new ErroComando(`${onde}: esperado objeto com ${PECAS.funcoes.join(", ")}`);
  const faltam = [
    ...PECAS.funcoes.filter((f) => typeof pecas[f] !== "function"),
    ...PECAS.listas.filter((l) => !Array.isArray(pecas[l]) || pecas[l].length === 0),
  ];
  if (faltam.length) throw new ErroComando(`${onde}: faltam ${faltam.join(", ")}`);
  return pecas;
}

function pecasDe(registro) {
  if (!registro || typeof registro !== "object") throw new ErroComando("sem registro: o comando grava e le pelo registro do projeto");
  return conferirPecas(registro.pecas, `registro ${registro.destino ?? "?"}: peças da pergunta`);
}

/**
 * As peças pelo adaptador do projeto em `repo`: o código que `.vega/declaracao.json` aponta em
 * `codigo`, conferido por `codigoDoAdaptador`, exporta `pecasDaPergunta()`. Sem código declarado,
 * adaptador inválido ou sem a função ⇒ recusa clara (fail-closed): sem as peças o comando não grava
 * nem lê. `importar` troca o carregador nos testes.
 */
export async function pecasDoProjeto(repo, { importar = (url) => import(url) } = {}) {
  const raiz = path.resolve(repo);
  let caminho;
  try {
    codigoDoAdaptador(raiz);
    const { codigo } = lerAdaptador(raiz);
    if (!codigo) throw new Error("a declaração não aponta código de adaptador (`codigo`)");
    caminho = ehNomeEmbutido(codigo) ? caminhoDoEmbutido(codigo) : caminhoDeCodigo(raiz, codigo, "codigo");
  } catch (e) {
    throw new ErroComando(`sem as peças da pergunta: adaptador do projeto em ${raiz} ilegivel (${e?.message ?? String(e)})`);
  }
  let mod;
  try {
    mod = await importar(pathToFileURL(caminho).href);
  } catch (e) {
    throw new ErroComando(`sem as peças da pergunta: ${caminho} nao carrega (${e?.message ?? String(e)})`);
  }
  if (typeof mod?.[EXPORT_DAS_PECAS] !== "function") {
    throw new ErroComando(`sem as peças da pergunta: o adaptador ${caminho} nao exporta ${EXPORT_DAS_PECAS}(); o comando nao grava nem le sem elas`);
  }
  let pecas;
  try {
    pecas = await mod[EXPORT_DAS_PECAS]();
  } catch (e) {
    throw new ErroComando(`sem as peças da pergunta: ${EXPORT_DAS_PECAS}() de ${caminho} falhou (${e?.message ?? String(e)})`);
  }
  return conferirPecas(pecas, `${EXPORT_DAS_PECAS}() de ${caminho}`);
}

// ── registros ───────────────────────────────────────────────────────────────

/** Registro do destino git: o gravador e o leitor da T13, pelas peças do projeto. */
export function registroGit({ arquivo, pecas }) {
  const { gravarEventosNoGit, lerEventosDoGit, mostrarDescartadas } = conferirPecas(pecas, "registro git: peças da pergunta");
  return {
    destino: "git",
    pecas,
    async gravar(_subverbo, eventos) {
      const r = gravarEventosNoGit({ arquivo, eventos });
      if (r.descartadas_phi > 0) throw new ErroComando("dado sensivel (CPF/CNS) recusado no registro git; nada gravado", EXIT.PHI);
      if (r.gravados + r.ja_existiam !== eventos.length) throw new ErroComando(`registro git devolveu conta torta: ${r.gravados} + ${r.ja_existiam} de ${eventos.length}`);
      return { gravados: r.gravados, ja_existiam: r.ja_existiam, enfileirados: 0, sem_registro: false, motivo: null, fila: null };
    },
    async ler({ pergunta_id = null, sessao = null, ciclo = null } = {}) {
      const { eventos, descartadas } = lerEventosDoGit({ arquivo });
      mostrarDescartadas(descartadas);
      const casa = (ev) => (pergunta_id ? ev.pergunta_id === pergunta_id : sessao ? ev.sessao === sessao : ciclo ? ev.ciclo === ciclo : true);
      return { eventos: eventos.filter(casa), sem_registro: false, motivo: null, fila: null, descartadas: descartadas.length };
    },
  };
}

/** Registro do destino banco: o verbo `estado.mjs pergunta` do projeto, em processo separado. */
export function registroBanco({ repo, pecas, executar = spawnSync } = {}) {
  conferirPecas(pecas, "registro banco: peças da pergunta");
  const verbo = path.join(repo, VERBO_DO_BANCO);
  const chamar = (args, entrada) => {
    const r = executar(process.execPath, [verbo, "pergunta", ...args, "--json"], {
      cwd: repo,
      input: entrada === undefined ? undefined : JSON.stringify(entrada),
      encoding: "utf8",
      timeout: PRAZO_DO_VERBO_MS,
    });
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.error) throw new ErroComando(`verbo do banco nao rodou: ${r.error.code ?? r.error.message}`);
    let saida;
    try {
      saida = JSON.parse(r.stdout);
    } catch {
      throw new ErroComando(`verbo do banco saiu ${r.status} sem JSON legivel`, r.status || EXIT.RECUSA);
    }
    if (r.status !== 0 || saida.exit !== 0) throw new ErroComando(saida.mensagem ?? `verbo do banco saiu ${r.status}`, saida.exit || r.status || EXIT.RECUSA);
    return saida;
  };
  return {
    destino: "banco",
    pecas,
    async gravar(subverbo, eventos) {
      return chamar([subverbo, "--arquivo", "-"], eventos);
    },
    async ler({ pergunta_id = null, sessao = null, ciclo = null, abertas = false, dono = null } = {}) {
      const args = ["ler"];
      if (pergunta_id) args.push("--pergunta", pergunta_id);
      else if (sessao) args.push("--sessao", sessao);
      else if (ciclo) args.push("--ciclo", ciclo);
      if (abertas) args.push("--abertas");
      if (dono) args.push("--dono", dono);
      return chamar(args);
    },
  };
}

/** O registro que o projeto em `repo` declara, com as peças que o adaptador dele entrega. */
export async function registroDoProjeto(repo, { pecas = null } = {}) {
  const p = pecas ? conferirPecas(pecas) : await pecasDoProjeto(repo);
  const d = p.lerDestino(repo);
  if (d.ausente) process.stderr.write(`aviso: ${d.declaracao} ausente; destino banco por padrao\n`);
  return d.destino === "git" ? registroGit({ arquivo: d.arquivo, pecas: p }) : registroBanco({ repo: d.repo, pecas: p });
}

// ── interpretação da resposta ───────────────────────────────────────────────

/** O tipo (e o evento) da resposta que não casa com o bloco: volta ao operador (D-VEGA20-6). */
export const A_CONFIRMAR = "a-confirmar";

/** A frase que a sessão mostra ao operador quando a resposta sai `a-confirmar`. */
export function fraseDeConfirmacao(leitura) {
  return `Li a resposta assim: ${leitura}. Ela não vale como escolha: confirme a opção que quis, ou responda de novo.`;
}

const LETRA_UNICA = /^\(?([a-z])\)?\s*(?:$|[—–\-:,.;!]\s*([\s\S]*)$)/i;

/**
 * Lê o literal do operador contra os itens da abertura (`[{ numero, opcoes: [{ letra }] }]`;
 * `null` quando a abertura é restrita e não guarda as letras: confere só a sintaxe).
 * Devolve `{ tipo, escolhas: [{ numero, letra }], ecoada, comentario, alternativa_livre }`:
 * `tipo` ∈ `opcao` · `opcao-com-comentario` · `alternativa-livre` · `a-confirmar`. Número de
 * decisão que o bloco não tem, ou letra fora das opções do item, não vale como escolhida nem recusa
 * (D-VEGA20-6, VEGA-20 T8): sai `a-confirmar`, sem escolhas, com a `leitura` da sessão
 * (`D7a não existe neste bloco` · `D1d: d não é opção de D1`), e volta ao operador. Duas letras no
 * mesmo item seguem recusando. Abertura restrita sem as letras (`itens` nulo): só a sintaxe.
 * Escolha × citação (hotfix vega-escolha-nao-e-citacao, 24/11/2026): os tokens saem de `lerTokens`
 * (`escolhas.mjs`, a regra única com o pareador) — só o token no começo da linha, ou na sequência
 * que começa nele, é escolha; a letra citada num texto livre ("…mais inteligente que 2a") fica no
 * comentário. `N-<texto>` é o texto livre do item N e sai em `livres` (números sem escolha). A
 * resposta que só traz letra citada (nenhum token, nenhum `N-texto`, e a leitura solta acha uma opção
 * do bloco) sai `a-confirmar` com a leitura `D2a citado no texto`.
 */
export function interpretarResposta(literal, itens) {
  if (typeof literal !== "string" || !literal.trim()) throw new ErroComando("responder exige o texto literal do operador");
  const texto = literal.trim();
  const conhecidos = Array.isArray(itens) && itens.length > 0 ? new Map(itens.map((it) => [it.numero, new Set((it.opcoes ?? []).map((o) => o.letra))])) : null;
  const escolhas = [];
  const foraDoBloco = [];
  const { tokens, livres } = lerTokens(texto);
  // Número que o bloco não tem só é número de decisão com o `D` escrito, ou quando a resposta é só
  // tokens (`7a`, `7a 8b`): sem isso, `5h`, `10m` e `2x` do texto livre seguem como texto.
  let soTokens = "";
  let ultimo = 0;
  for (const t of tokens) {
    soTokens += texto.slice(ultimo, t.ini);
    ultimo = t.fim;
  }
  soTokens = (soTokens + texto.slice(ultimo)).replace(/[\s,;.:/+&e*_|—–-]+/gi, "") === "";
  const usados = [];
  for (const t of tokens) {
    const { numero, letra } = t;
    // `Decisão 6: sim` é o sim do consentimento, não letra de opção: segue texto, como antes.
    if (letra.length > 1) continue;
    const bruto = texto.slice(t.ini, t.fim);
    if (conhecidos && !conhecidos.has(numero)) {
      if (/^d/i.test(bruto) || soTokens) foraDoBloco.push(`D${numero}${letra} não existe neste bloco`);
      continue;
    }
    if (conhecidos && !conhecidos.get(numero).has(letra)) {
      foraDoBloco.push(`D${numero}${letra}: ${letra} não é opção de D${numero}`);
      continue;
    }
    const ja = escolhas.find((e) => e.numero === numero);
    if (ja && ja.letra !== letra) throw new ErroComando(`D${numero}: duas letras na mesma resposta (${ja.letra} e ${letra})`);
    if (!ja) escolhas.push({ numero, letra });
    usados.push(t);
  }
  let resto = texto;
  for (const t of [...usados].reverse()) resto = `${resto.slice(0, t.ini)} ${resto.slice(t.fim)}`;
  if (foraDoBloco.length > 0) {
    return { tipo: A_CONFIRMAR, escolhas: [], ecoada: [], comentario: null, alternativa_livre: false, livres: [], leitura: [...new Set(foraDoBloco)].join("; ") };
  }
  if (escolhas.length === 0 && conhecidos && conhecidos.size === 1) {
    const m = LETRA_UNICA.exec(texto);
    const [[numero, letras]] = [...conhecidos];
    if (m && letras.has(m[1].toLowerCase())) {
      escolhas.push({ numero, letra: m[1].toLowerCase() });
      resto = m[2] ?? "";
    }
  }
  // Só letra citada num texto livre ("fico com 2a", "vamos de 2a e 3b"), sem escolha nem `N-texto`:
  // volta ao operador em vez de virar alternativa livre calada (revisão do hotfix
  // vega-escolha-nao-e-citacao) — antes a leitura solta gravava essas letras como escolha.
  if (escolhas.length === 0 && livres.length === 0 && conhecidos) {
    const citadas = escolhasCitadas(texto).escolhas.filter((e) => conhecidos.get(e.numero)?.has(e.letra));
    if (citadas.length > 0) {
      const leitura = citadas.map((e) => `D${e.numero}${e.letra} citado no texto`).join("; ");
      return { tipo: A_CONFIRMAR, escolhas: [], ecoada: [], comentario: null, alternativa_livre: false, livres: [], leitura };
    }
  }
  const comentario = resto.replace(/^[\s—–\-:,.;!]+|[\s—–\-:,.;]+$/g, "").replace(/\s{2,}/g, " ").trim() || null;
  const alternativa_livre = escolhas.length === 0;
  const tipo = alternativa_livre ? "alternativa-livre" : comentario ? "opcao-com-comentario" : "opcao";
  escolhas.sort((a, b) => a.numero - b.numero);
  // `N-<texto>` do item que não tem escolha (e que o bloco tem): a alternativa livre daquele item.
  const comEscolha = new Set(escolhas.map((e) => e.numero));
  const livresDoBloco = [...new Set(livres.map((l) => l.numero))].filter((n) => !comEscolha.has(n) && (!conhecidos || conhecidos.has(n))).sort((a, b) => a - b);
  return { tipo, escolhas, ecoada: escolhas.map((e) => `D${e.numero}${e.letra}`), comentario: alternativa_livre ? null : comentario, alternativa_livre, livres: livresDoBloco };
}

// ── os verbos ───────────────────────────────────────────────────────────────

const agora = () => new Date().toISOString();

function itemDe(itens) {
  const a = itens[0].numero;
  const b = itens.at(-1).numero;
  return a === b ? `D${a}` : `D${a}-D${b}`;
}

/** O evento `abertura` da pergunta já normalizada. */
export function eventoDeAbertura(p, { sessao, ciclo = null, carimbo = agora(), achado = false, supersedes = null }) {
  return {
    evento: "abertura",
    ...(achado ? { achado: true } : {}),
    pergunta_id: p.id,
    sessao,
    ciclo,
    carimbo,
    versao_esquema: p.versao,
    has_patient_data: p.has_patient_data,
    ...(p.ponteiro ? { ponteiro: p.ponteiro } : {}),
    // O hash do conteúdo e o elo da superação (D-VEGA19-56): só hex e id, seguem com paciente.
    ...(p.conteudo ? { conteudo: p.conteudo } : {}),
    ...(supersedes ? { supersedes } : {}),
    item: itemDe(p.itens),
    titulo: p.itens.length === 1 ? p.itens[0].titulo : p.assunto,
    assunto: p.assunto,
    papel: p.papel,
    rota: p.rota,
    itens: p.itens.map((it) => ({
      numero: it.numero,
      titulo: it.titulo,
      contexto: it.contexto,
      opcoes: it.opcoes.map((o) => ({ letra: o.letra, texto: o.texto })),
      recomendada: it.recomendada,
      motivo: it.motivo,
    })),
  };
}

/**
 * A abertura gravada na v1 tem o mesmo conteúdo da pergunta nova? Pelos itens que o registro
 * guardou: o destino git guarda título e opções; o banco, as opções de cada item e o título só da
 * pergunta de um item (os títulos que faltam saem da pergunta nova, e só as opções se comparam).
 * Pergunta com paciente não guarda texto: não se compara, e a reabertura mantém o id (como antes).
 */
function mesmoConteudoDaV1(gravada, p) {
  if (gravada.has_patient_data === true || !Array.isArray(gravada.itens) || gravada.itens.length === 0) return true;
  if (gravada.itens.length !== p.itens.length) return false;
  const itens = p.itens.map((it, i) => {
    const g = gravada.itens[i] ?? {};
    const titulo = typeof g.titulo === "string" && g.titulo ? g.titulo : p.itens.length === 1 && typeof gravada.titulo === "string" && gravada.titulo ? gravada.titulo : it.titulo;
    return { titulo, opcoes: Array.isArray(g.opcoes) ? g.opcoes : [] };
  });
  return conteudoDaPergunta(itens) === p.conteudo;
}

/** Recusa da reabertura calada (D-VEGA19-56): o código vem primeiro, o id existente citado. */
function recusaDeReabertura(codigo, existente, detalhe) {
  return new ErroComando(`${codigo}: ${detalhe} (${existente}); para ligar a nova à anterior, abra com --supersedes <p-id>`);
}

/**
 * Confere a reabertura contra o registro antes de gravar (T45, D-VEGA19-56). Lê o ciclo (fora de
 * ciclo, a sessão) e devolve a pergunta a gravar — a mesma, ou, quando a abertura igual já está
 * gravada na v1, a pergunta na v1, para o id não mudar. Recusa:
 * - `conteudo-diferente` — a mesma sessão, número e assunto (e tentativa) já abertos com outro
 *   conteúdo: na v1, pelo id de antes; na v2, pelo id refeito com o conteúdo gravado;
 * - `numero-ja-usado` — algum número de decisão da pergunta já usado por outra do mesmo ciclo (fora
 *   de ciclo, da mesma sessão). A pergunta de consentimento da condução (número 1 fixo) não conta;
 * - `supersedes` que não existe no registro, ou que cita a própria pergunta.
 * Com `supersedes` válido, as duas primeiras recusas não valem: a nova cita a que supera.
 */
/**
 * A abertura gravada e a mesma pergunta que se abre agora: o mesmo conteudo, os mesmos numeros, o
 * mesmo ponteiro, a mesma marca de paciente e o mesmo destinatario (papel e mandato).
 */
function mesmaAbertura(a, p) {
  return (
    typeof p.conteudo === "string" &&
    a.conteudo === p.conteudo &&
    numerosDoItem(a.item).join(",") === p.itens.map((it) => it.numero).join(",") &&
    (a.ponteiro ?? null) === (p.ponteiro ?? null) &&
    a.has_patient_data === p.has_patient_data &&
    // O mesmo destinatário: outro papel ou mandato é outra pergunta, nunca a de antes com rota nova.
    (a.rota?.para?.papel ?? a.papel ?? null) === (p.rota?.para?.papel ?? p.papel ?? null) &&
    (a.rota?.para?.mandato ?? null) === (p.rota?.para?.mandato ?? null)
  );
}

/**
 * Confere a reabertura e devolve `{ pergunta, existente }`: a pergunta a gravar e, quando ela já está
 * aberta no registro, a abertura gravada — cujo carimbo a reabertura mantém (T44, D-VEGA20-27 item 3:
 * o `abrir` repetido não move o `aberta_em` que o pareador mede).
 */
async function conferirReabertura(registro, args) {
  const r = await conferirReaberturaNoRegistro(registro, args);
  return r && typeof r === "object" && "pergunta" in r ? r : { pergunta: r, existente: null };
}

async function conferirReaberturaNoRegistro(registro, { p, bruta, sessao, ciclo, supersedes: pedido, opcoes }) {
  const aqui = { sessao, ciclo };
  let supersedes = pedido;
  if (supersedes !== null && supersedes === p.id) {
    // T44 (D-VEGA20-27 item 3): o mesmo conteudo da o mesmo id; superar a si mesma e reabrir a mesma
    // pergunta, que so vale enquanto ela esta aberta (sem resposta). Respondida, a recusa de antes.
    const l = await registro.ler({ pergunta_id: p.id });
    const aberta = l.eventos.some((e) => e.pergunta_id === p.id && e.evento === "abertura") && !l.eventos.some((e) => e.pergunta_id === p.id && e.evento === "resposta");
    if (!aberta) throw new ErroComando("supersedes: a pergunta nao supera a si mesma");
    supersedes = null;
  }
  if (supersedes !== null) {
    const l = await registro.ler({ pergunta_id: supersedes });
    const alvo = l.eventos.find((e) => e.pergunta_id === supersedes && e.evento === "abertura");
    if (!alvo && l.sem_registro) {
      // Registro fora do ar (D-VEGA19-24): o elo nao se confere agora e nao trava a abertura; a
      // leitura so o liga se o alvo existir no mesmo escopo (`ligacoesDasPerguntas`).
      process.stderr.write(`aviso: conferencia-sem-registro: supersedes ${supersedes} nao conferido (registro fora do ar)\n`);
    } else if (!alvo) throw new ErroComando(`supersedes-inexistente: ${supersedes} sem abertura no registro nem na fila`);
    else if (!mesmoEscopo(aqui, alvo)) throw new ErroComando(`supersedes-fora-do-escopo: ${supersedes} e de ${ciclo ? "outro ciclo" : "outra sessao ou de um ciclo"}; o elo vale so no mesmo ciclo (fora de ciclo, na mesma sessao)`);
    // T44 (D-VEGA20-27 item 3): superar uma pergunta AINDA ABERTA com o mesmo conteudo e o mesmo
    // destinatario so para mostrar o bloco de novo nao abre outra: devolve a mesma, com o mesmo
    // `aberta_em`. Conteudo diferente (ou a pergunta ja respondida) segue abrindo outra.
    const respondida = l.eventos.some((e) => e.pergunta_id === supersedes && e.evento === "resposta");
    // So a da mesma sessao e do mesmo assunto: outra sessao (ou outro assunto) que supera e outra pergunta.
    const mesmaSessao = alvo?.sessao === sessao && (alvo?.assunto == null || alvo.assunto === p.assunto);
    if (alvo && !respondida && mesmaSessao && mesmaAbertura(alvo, p)) return { pergunta: criarPergunta({ ...bruta, id: supersedes }, opcoes), existente: alvo };
  }
  const leitura = await registro.ler(ciclo ? { ciclo } : { sessao });
  // A conferencia que nao viu o registro inteiro avisa e segue: abrir nunca trava por registro fora
  // do ar (D-VEGA19-24), mas o passe calado vira aviso.
  if (leitura.sem_registro) process.stderr.write("aviso: conferencia-sem-registro: reabertura conferida so contra a fila local (registro fora do ar)\n");
  if (leitura.truncado) process.stderr.write("aviso: conferencia-truncada: a leitura do registro foi cortada no teto; numero ja usado mais antigo pode nao ter sido visto\n");
  const noEscopo = (e) => (ciclo ? e.ciclo === ciclo : e.sessao === sessao && (e.ciclo ?? null) === null);
  const aberturas = leitura.eventos.filter((e) => e.evento === "abertura" && typeof e.pergunta_id === "string" && noEscopo(e) && e.sessao !== SESSAO_DO_CONSENTIMENTO);
  const ja = aberturas.find((a) => a.pergunta_id === p.id);
  if (ja) return { pergunta: p, existente: ja };
  // Reabertura que só corrige o id de nuvem (hotfix pergunta-nao-pede-resposta-duas-vezes): a
  // abertura do mesmo ciclo gravada com id de nuvem, com o mesmo conteúdo, os mesmos números e o
  // mesmo ponteiro, segue sendo a pergunta. O id dela volta, e a resposta que o operador já digitou
  // depois daquele bloco vale (a prova se lê pelo transcript em que o bloco saiu, `prova.mjs`).
  if (ciclo !== null && supersedes === null && typeof p.conteudo === "string") {
    const daNuvem = aberturas.find((a) => SESSAO_DE_NUVEM.test(a.sessao ?? "") && mesmaAbertura(a, p));
    if (daNuvem) return { pergunta: criarPergunta({ ...bruta, id: daNuvem.pergunta_id }, opcoes), existente: daNuvem };
  }
  let escolhida = p;
  if (bruta.id == null) {
    const base = { sessao, numero: p.numero, assunto: p.assunto, tentativa: bruta.tentativa ?? null };
    const idDaV1 = idDaPergunta({ ...base, versao: 1 });
    // O id da v1 nao leva o ciclo: a abertura igual pode estar fora do escopo lido, e e lida pelo id.
    const v1 =
      aberturas.find((a) => a.pergunta_id === idDaV1) ??
      (await registro.ler({ pergunta_id: idDaV1 })).eventos.find((e) => e.pergunta_id === idDaV1 && e.evento === "abertura") ??
      null;
    if (v1) {
      if (mesmoConteudoDaV1(v1, p)) return { pergunta: criarPergunta({ ...bruta, versao: 1 }, opcoes), existente: v1 };
      if (supersedes === null) throw recusaDeReabertura("conteudo-diferente", idDaV1, `D${p.numero} com o mesmo assunto ja aberta nesta sessao com outro conteudo`);
    }
    const v2 = aberturas.find(
      (a) => a.sessao === sessao && typeof a.conteudo === "string" && a.conteudo !== p.conteudo && /^[0-9a-f]{16}$/.test(a.conteudo) && idDaPergunta({ ...base, conteudo: a.conteudo }) === a.pergunta_id,
    );
    if (v2 && supersedes === null) throw recusaDeReabertura("conteudo-diferente", v2.pergunta_id, `D${p.numero} com o mesmo assunto ja aberta nesta sessao com outro conteudo`);
  }
  const meus = new Set(p.itens.map((it) => it.numero));
  const usada = aberturas.find((a) => a.pergunta_id !== escolhida.id && numerosDoItem(a.item).some((n) => meus.has(n)));
  if (usada && supersedes === null) {
    throw recusaDeReabertura("numero-ja-usado", usada.pergunta_id, `${usada.item} ja usado por outra pergunta ${ciclo ? `do ciclo ${ciclo}` : "desta sessao"}`);
  }
  return escolhida;
}

/** As posições da chave escondida que o chamador dá (regra 5 do contrato de formato). */
const CAMPOS_DA_CHAVE = new Set(["ciclo", "fase", "task", "origem", "codigos"]);
export { chaveDoRamo, ramoAtual };

/**
 * A chave escondida completa (hotfix chave-da-pergunta, 23/11/2026; log da condução no hotfix
 * vega-chave-do-log-da-conducao, mesmo dia). Precedência de cada posição: **chave dada > log da
 * condução > ramo > `-`**. O `ciclo` da entrada conta como dado. Do log (`log` = `{ ciclo, fase?, task? }`,
 * o ciclo do log lido) vêm o ciclo (quando o ramo não o diz: HEAD solto), a fase e a task; fase e task
 * só entram se o ciclo do log é o ciclo final da chave. A origem segue a mesma precedência (hotfix
 * vega-pareador-texto-livre, 24/11/2026): o ramo, quando diz uma; senão o papel da sessão no log
 * (`chaveDoLog`, só quando ela casou e no ciclo final da chave). Sem nada a dizer, `null` (a chave sai `-/-/-` · `avulsa`,
 * como antes). Exportada para teste.
 */
export function completarChave(chave, { ciclo = null, ramo = null, log = null } = {}) {
  if (chave !== null && chave !== undefined && (typeof chave !== "object" || Array.isArray(chave))) throw new ErroComando("abrir: chave esperada objeto { ciclo?, fase?, task?, origem?, codigos? }");
  const dada = chave ?? {};
  for (const k of Object.keys(dada)) if (!CAMPOS_DA_CHAVE.has(k)) throw new ErroComando(`abrir: chave.${k.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40)} desconhecida`);
  const vazia = (v) => v === undefined || v === null || v === "" || v === "-";
  // O deduzido que não cabe numa posição (slug longo, caractere fora) cai calado e a posição sai `-`:
  // quem não pediu a chave não passa a ter o `abrir` recusado por ela. A chave dada segue recusando.
  const cabe = (v) => typeof v === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(v);
  const doRamo = chaveDoRamo(ramo);
  const out = { ...dada };
  const doLog = log && typeof log === "object" ? log : {};
  const cicloDeduzido = [ciclo, doLog.ciclo, doRamo.ciclo].find(cabe);
  if (vazia(out.ciclo) && cicloDeduzido) out.ciclo = cicloDeduzido;
  // O log fala de um ciclo (o dele, ou o lido pelo ciclo conhecido): fase e task só valem nesse ciclo.
  if (cabe(doLog.ciclo) && out.ciclo === doLog.ciclo) {
    if (vazia(out.fase) && cabe(doLog.fase)) out.fase = doLog.fase;
    if (vazia(out.task) && cabe(doLog.task)) out.task = doLog.task;
  }
  // A origem do ramo (`-plano`, `hotfix`, `docs`) diz o papel com mais certeza que o log, que grava o
  // mesmo `filha` para toda sessao: o log so preenche quando o ramo nao diz nenhuma (HEAD solto).
  if (vazia(out.origem) && doRamo.origem) out.origem = doRamo.origem;
  if (vazia(out.origem) && cabe(doLog.ciclo) && out.ciclo === doLog.ciclo && cabe(doLog.origem)) out.origem = doLog.origem;
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === null) delete out[k];
  return Object.keys(out).length ? out : null;
}

/**
 * O que o log da condução diz da chave, para o `abrir`: `conducao` = `{ pasta, sessao }` (a pasta do
 * log e a sessão da nuvem da árvore, `sessaoDaArvore`). Sem `conducao`, `null` (o `abrir` chamado
 * direto segue como antes). O ciclo a ler: o da chave dada, o da entrada, o do ramo; nenhum, procura
 * a sessão nos logs. Nunca lança: log ausente ou ilegível cai no que o ramo diz.
 */
function logDaConducao(entrada, ramo, conducao) {
  if (!conducao || typeof conducao !== "object") return null;
  const dado = entrada.chave && typeof entrada.chave === "object" ? entrada.chave.ciclo : null;
  const ciclo = [dado, entrada.ciclo, chaveDoRamo(ramo).ciclo].find((v) => typeof v === "string" && v !== "" && v !== "-") ?? null;
  const lido = chaveDoLog({ pasta: conducao.pasta ?? null, ciclo, sessao: conducao.sessao ?? null });
  // Lido pelo ciclo conhecido, o log fala dele: o ciclo vai junto para a fase e a task valerem nele.
  return lido.ciclo || !ciclo || !(lido.fase || lido.task || lido.origem) ? lido : { ciclo, ...lido };
}

/** A pasta do log e a sessão da árvore em `cwd`, para o `abrir` da linha de comando; erro vira `null`. */
export function conducaoDoCwd(raiz, cwd) {
  let pasta = null;
  try {
    pasta = lerAdaptador(raiz).pastaDoLog ?? null;
  } catch {
    pasta = null;
  }
  return { pasta, sessao: sessaoDaArvore(cwd) };
}

/**
 * A sessão da abertura (hotfix pergunta-nao-pede-resposta-duas-vezes, 20/11/2026): é o id do
 * transcript local, onde o operador lê o bloco e responde — a prova da resposta se lê por ele. Sem
 * `sessao` na entrada, sai de `CLAUDE_CODE_SESSION_ID`; id de nuvem (`session_…`, `cse_…`) recusa
 * `sessao-de-nuvem`, dizendo qual usar; sem a entrada e sem a variável (estação sem ela), recusa
 * pedindo o id do transcript.
 */
export function sessaoDoAbrir(daEntrada, env = process.env) {
  const local = env?.CLAUDE_CODE_SESSION_ID;
  const localValida = typeof local === "string" && SESSAO.test(local) && !SESSAO_DE_NUVEM.test(local);
  const qual = localValida
    ? `use ${local} (CLAUDE_CODE_SESSION_ID) ou tire o campo sessao da entrada`
    : `use o id do transcript local: o nome do .jsonl desta conversa, na pasta projects do Claude Code${typeof local === "string" && SESSAO_DE_NUVEM.test(local) ? " (CLAUDE_CODE_SESSION_ID aqui tambem e de nuvem e nao serve)" : ""}`;
  if (daEntrada === undefined || daEntrada === null) {
    if (!localValida) throw new ErroComando(`abrir: sem sessao na entrada e sem CLAUDE_CODE_SESSION_ID no ambiente: ${qual}`);
    return local;
  }
  if (typeof daEntrada !== "string" || !SESSAO.test(daEntrada)) throw new ErroComando("abrir: sessao fora da forma ([A-Za-z0-9_-])");
  if (SESSAO_DE_NUVEM.test(daEntrada)) throw new ErroComando(`sessao-de-nuvem: ${daEntrada} e o id da nuvem, nao o do transcript em que o operador responde; ${qual}`);
  return daEntrada;
}

/**
 * Abre a pergunta: valida pela forma, grava a abertura e só então devolve o bloco.
 * Devolve `{ pergunta_id, texto, nativo, sem_registro, motivo, gravados, ja_existiam, fila }`.
 */
export async function abrir(entrada, { registro, destinatarios = carregarDestinatarios(), carimbo, sombra = null, env = process.env, ramo = null, conducao = null } = {}) {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) throw new ErroComando("abrir: esperado objeto { sessao?, ciclo?, chave?, pergunta }");
  for (const k of Object.keys(entrada)) if (!CAMPOS_DO_ABRIR.has(k)) throw new ErroComando(`abrir: campo desconhecido ${k.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40)}`);
  const { ciclo = null, achado = false, supersedes = null } = entrada;
  const sessao = sessaoDoAbrir(entrada.sessao, env);
  const chave = completarChave(entrada.chave ?? null, { ciclo, ramo, log: logDaConducao(entrada, ramo, conducao) });
  if (typeof achado !== "boolean") throw new ErroComando("abrir: achado e booleano");
  if (supersedes !== null && !(typeof supersedes === "string" && PERGUNTA_ID.test(supersedes))) throw new ErroComando("abrir: supersedes esperado p-<16 hex>");
  if (ciclo !== null && !(typeof ciclo === "string" && CICLO.test(ciclo))) throw new ErroComando("abrir: ciclo fora da forma ([A-Za-z][A-Za-z0-9._-])");
  const bruta = entrada.pergunta && typeof entrada.pergunta === "object" ? { ...entrada.pergunta } : entrada.pergunta;
  if (bruta && typeof bruta === "object" && bruta.id == null && bruta.sessao === undefined) bruta.sessao = sessao;
  pecasDe(registro);
  const opcoes = { destinatarios: destinatarios.papeis, tabela: destinatarios };
  let p;
  try {
    p = criarPergunta(bruta, opcoes);
  } catch (e) {
    throw new ErroComando(`pergunta fora da forma: ${e.message}`);
  }
  // Pergunta sobre achado: as opcoes sao os destinos do contrato, e so eles (AC-VEGA19-4).
  if (achado) pecasDe(registro).conferirOpcoesDeAchado(p.itens, ErroComando);
  // A reabertura calada some (D-VEGA19-56): conferida contra o registro antes de gravar.
  const reaberta = await conferirReabertura(registro, { p, bruta, sessao, ciclo, supersedes, opcoes });
  p = reaberta.pergunta;
  // A reabertura da mesma pergunta mantém o carimbo gravado (T44, D-VEGA20-27 item 3) e não cita a
  // si mesma como superada: o `aberta_em` que o pareador mede não anda.
  const existente = reaberta.existente?.pergunta_id === p.id ? reaberta.existente : null;
  const aberta_em = existente?.carimbo ?? carimbo ?? null;
  const ev = eventoDeAbertura(p, { sessao, ciclo, ...(aberta_em ? { carimbo: aberta_em } : {}), achado, supersedes: supersedes === p.id ? (existente?.supersedes ?? null) : supersedes });
  // O bloco se renderiza ANTES de gravar: chave fora da forma recusa sem deixar abertura sem bloco.
  let render;
  try {
    render = renderizar(p, { ...opcoes, ...(chave ? { chave } : {}), ...(achado ? { achado } : {}) });
  } catch (e) {
    throw new ErroComando(`chave fora da forma: ${e.message}`);
  }
  const r = await registro.gravar("abrir", [ev]);
  // A sombra do Sistema 1 (T21, AC-VEGA19-6): depois de gravar a abertura, espera a previsão com o
  // teto duro de 5 s na espera do modelo (D-VEGA19-65); a releitura e a gravação da linha têm o
  // prazo do próprio registro, o mesmo da abertura: no banco, `TIMEOUT_REGISTRO_MS` (10 s) de
  // `.claude/scripts/estado/lib/pergunta.mjs`, com a fila local depois dele; `PRAZO_DO_VERBO_MS` é
  // só o envelope do processo. Uma leitura só (a do comando vai à sombra). Nada dela entra no bloco.
  if (sombra) await chamarSombra(sombra, { p, registro });
  const marca = r.sem_registro ? `<!-- pergunta ${p.id} · sem registro -->` : `<!-- pergunta ${p.id} -->`;
  const texto = r.sem_registro ? `${render.texto}\n\n_sem registro: a pergunta ficou na fila local da estacao_\n${marca}` : `${render.texto}\n${marca}`;
  return { pergunta_id: p.id, aberta_em: ev.carimbo, texto, nativo: render.nativo, sem_registro: r.sem_registro, motivo: r.motivo ?? null, gravados: r.gravados, ja_existiam: r.ja_existiam, fila: r.fila ?? null };
}

/**
 * Chama a sombra da pergunta recém-aberta. Pergunta com paciente não chama (D-VEGA19-12); a que já
 * tem linha `previsao` também não (a reabertura idempotente, D-VEGA19-67). Lê a pergunta uma vez e
 * passa a leitura à sombra, que monta o prompt da abertura relida. Nunca lança: falha vai a stderr.
 */
async function chamarSombra(sombra, { p, registro }) {
  if (p.has_patient_data !== false) return null;
  try {
    const leitura = await registro.ler({ pergunta_id: p.id });
    if ((leitura?.eventos ?? []).some((e) => e.pergunta_id === p.id && e.evento === "previsao")) return { chamou: false, pulou: "ja-prevista" };
    return await sombra({ pergunta_id: p.id }, { registro, leitura });
  } catch (e) {
    process.stderr.write(`aviso: sombra nao rodou (${e instanceof Error ? e.message : String(e)})\n`);
    return null;
  }
}

/** O estado de uma pergunta no registro: `{ estado, abertura, resposta, dispensas, leitura }`. */
async function estadoDe(registro, pergunta_id) {
  if (typeof pergunta_id !== "string" || !PERGUNTA_ID.test(pergunta_id)) throw new ErroComando("--pergunta: esperado p-<16 hex>");
  const leitura = await registro.ler({ pergunta_id });
  const eventos = leitura.eventos.filter((e) => e.pergunta_id === pergunta_id);
  const abertura = eventos.find((e) => e.evento === "abertura") ?? null;
  const achada = eventos.find((e) => e.evento === "resposta") ?? null;
  const resposta = achada ? { ...achada, destinos: eventos.filter((e) => e.evento === "destino").map((e) => e.ponteiro) } : null;
  const [estado] = pecasDe(registro).estadoDasPerguntas(eventos);
  return { estado: estado ?? null, abertura, resposta, leitura };
}

function amarrarVersao(abertura) {
  const v = abertura.versao_esquema ?? null;
  if (v !== null && !ESQUEMAS_ACEITOS.includes(v)) throw new ErroComando(`pergunta aberta no esquema ${v}; esta fabrica responde no ${ESQUEMAS_ACEITOS.join(" e ")}`);
  // Abertura sem versao gravada e de antes da v2: responde na v1, a versao que ela tinha.
  return v ?? ESQUEMAS_ACEITOS[0];
}

function restrita(abertura) {
  return abertura.has_patient_data === true || !abertura.titulo;
}

/**
 * Responde a pergunta com o literal do operador. Recusa sem literal, com origem diferente de
 * `agente` (a `hook` com o motivo próprio), sem abertura, ou já respondida com outro texto.
 * Devolve `{ pergunta_id, tipo, ecoada, escolhas, alternativa_livre, comentario, sem_registro, … }`.
 */
/**
 * O destino da resposta: o da opcao escolhida em pergunta sobre achado (e o `pedido`, se vier, tem
 * de bater), ou o `pedido`. Pergunta sobre achado sem destino recusa; um destino por pergunta.
 */
export function destinoDaResposta(abertura, escolhas, pedido = null, pecas = null) {
  const { conferirDestino, destinoDoTexto } = conferirPecas(pecas, "destinoDaResposta: peças da pergunta");
  if (pedido != null) conferirDestino(pedido, ErroComando);
  if (abertura.achado !== true) return pedido ?? null;
  const porNumero = new Map((abertura.itens ?? []).map((it) => [it.numero, it]));
  const daEscolha = [...new Set(escolhas.map((e) => destinoDoTexto(porNumero.get(e.numero)?.opcoes?.find((o) => o.letra === e.letra)?.texto)).filter(Boolean))];
  if (daEscolha.length > 1) throw new ErroComando(`pergunta sobre achado: um destino por pergunta, vieram ${daEscolha.join(" e ")}`);
  const [escolhido = null] = daEscolha;
  if (pedido != null && escolhido !== null && pedido !== escolhido) throw new ErroComando(`--destino ${pedido} diverge da opcao escolhida (${escolhido})`);
  const destino = pedido ?? escolhido;
  if (!destino) throw new ErroComando("pergunta sobre achado: a resposta escolhe um destino do contrato (opcao ou --destino)");
  return destino;
}

/**
 * O destino da pergunta legada `achado-sem-destino` (D-VEGA19-43): so o da opcao escolhida (o
 * `--destino` sem opcao que o nomeie nao basta), um so, e nunca `debito`. Recusa nos outros casos.
 */
function destinoLegado(abertura, escolhas, pecas, pergunta_id) {
  const legada = `pergunta ${pergunta_id} sobre achado ja respondida sem destino (pelo gancho)`;
  let daOpcao;
  try {
    daOpcao = destinoDaResposta(abertura, escolhas, null, pecas);
  } catch (e) {
    if (e instanceof ErroComando) throw new ErroComando(`${legada}: ${e.message}`);
    throw e;
  }
  if (daOpcao === "debito") throw new ErroComando(`${legada}: o destino debito pede a divida ligada, que a resposta ja gravada nao tem; feche por outro destino`);
  return daOpcao;
}

/**
 * O mandato que a resposta grava: o da rota `para` da abertura; abertura sem rota, o padrao do
 * papel. Abertura sem rota nem papel (gravada antes da T40) ⇒ `null`: o mandato nao se adivinha
 * (`engenharia` por padrao contaria a decisao clinica como de engenharia).
 */
function mandatoDaAbertura(abertura) {
  const m = abertura.rota?.para?.mandato;
  if (MANDATOS.includes(m)) return m;
  const papel = abertura.rota?.para?.papel ?? abertura.papel ?? null;
  return typeof papel === "string" && papel ? mandatoDoPapel(papel) : null;
}

/**
 * A resposta ja gravada e o `--recibo`/`--por` pedidos agora: pedido que diverge do gravado recusa
 * alto (uma resposta por pergunta; o recibo nao se anexa depois em silencio).
 */
function conferirReciboEPor(resposta, recibo, por, pergunta_id) {
  if (!resposta) return;
  if (recibo !== null && recibo.trim() !== (resposta.recibo ?? null)) throw new ErroComando(`pergunta ${pergunta_id} ja respondida ${resposta.recibo ? "com outro recibo" : "sem recibo"}: o --recibo nao se grava depois`);
  if (por !== null && por !== (resposta.rota?.por ?? null)) throw new ErroComando(`pergunta ${pergunta_id} ja respondida ${resposta.rota?.por ? "por outro caminho" : "sem --por"}: o --por nao se grava depois`);
}

/** As origens que provam a resposta (as mesmas de `ORIGENS_QUE_PROVAM` da lib do projeto): `repasse-hub` não prova. */
const ORIGENS_QUE_PROVAM = Object.freeze(["digitado", "digitado-no-hub-conferido"]);

/** As escolhas de um literal de letras ecoadas (`D32a D33b`): `[{ numero, letra }]`. */
function escolhasEcoadas(literal) {
  return [...String(literal ?? "").matchAll(/(?<![A-Za-z0-9])D(\d{1,4})([a-z])(?![A-Za-z0-9])/g)].map((m) => ({ numero: Number(m[1]), letra: m[2] }));
}

const mesmasLetras = (a, b) => {
  const chave = (xs) => [...new Set(xs.map((x) => `${x.numero ?? ""}${x.letra}`))].sort().join(" ");
  return chave(a) === chave(b);
};

/**
 * A resposta já gravada, com outro texto, cede à que chega agora (VEGA-20 T44, D-VEGA20-27 item 4)?
 * Devolve o motivo curto de não recusar, ou `null` (recusa: uma resposta por pergunta):
 * - `resposta-sem-prova-cede` — a gravada não se prova (`origemEfetiva` sai `agente` ou `repasse-hub`)
 *   e não há resposta provada: a provada que chega vale pela `autoria` com as letras, que o gancho grava;
 * - `resposta-provada-ja-gravada` — a resposta provada com estas escolhas já está no registro.
 * Entre duas respostas provadas, escolha diferente recusa. `origemFn` injetável para teste. Exportado.
 */
export function cedeAProvada(pergunta_id, eventos, escolhas, { origemFn = origemDaProva } = {}) {
  const daPergunta = (eventos ?? []).filter((e) => e?.pergunta_id === pergunta_id);
  const provadas = daPergunta.filter((e) => e.evento === "autoria" && ORIGENS_QUE_PROVAM.includes(e.origem_resposta) && escolhasEcoadas(e.resposta_literal).length > 0);
  if (provadas.length > 0) return provadas.some((e) => mesmasLetras(escolhasEcoadas(e.resposta_literal), escolhas)) ? "resposta-provada-ja-gravada" : null;
  let o;
  try {
    o = origemFn(pergunta_id, { eventos: daPergunta });
  } catch (e) {
    // A prova que nao se le nao vira "outro texto": a recusa diz a causa.
    throw new ErroComando(`pergunta ${pergunta_id} ja respondida com outro texto, e a origem da gravada nao se leu (${String(e?.message ?? e).split("\n")[0].slice(0, 160)}): nada gravado`);
  }
  return o && o.origem !== null && !ORIGENS_QUE_PROVAM.includes(o.origem) ? "resposta-sem-prova-cede" : null;
}

export async function responder({ pergunta_id, literal, origem = "agente", carimbo = agora(), destino: pedido = null, debito = null, recibo = null, por = null } = {}, { registro, origemFn } = {}) {
  if (recibo !== null && !(typeof recibo === "string" && RECIBO.test(recibo.trim()))) throw new ErroComando('--recibo: esperado "<sessao> <evento>"');
  let porDaResposta = null;
  if (por !== null) {
    try {
      porDaResposta = conferirPor(por, "--por");
    } catch (e) {
      throw new ErroComando(e.message);
    }
  }
  if (origem === "hook") throw new ErroComando("origem hook recusada: quem sobe a origem e o gancho, pela linha autoria (D-VEGA19-27)");
  if (origem !== "agente") throw new ErroComando(`origem ${JSON.stringify(origem)} recusada: o comando grava agente; o gancho sobe a origem (D-VEGA19-27)`);
  if (typeof literal !== "string" || !literal.trim()) throw new ErroComando("responder exige o texto literal do operador");
  const pecas = pecasDe(registro);
  const { abertura, resposta, leitura: doRegistro } = await estadoDe(registro, pergunta_id);
  if (!abertura) throw new ErroComando(`pergunta ${pergunta_id} sem abertura no registro nem na fila: abra antes de responder`);
  const versao = amarrarVersao(abertura);
  const semTexto = restrita(abertura);
  const itens = Array.isArray(abertura.itens) && abertura.itens.length > 0 ? abertura.itens : null;
  const lida = interpretarResposta(literal, itens);
  if (lida.tipo === A_CONFIRMAR) return voltarAoOperador({ pergunta_id, literal, carimbo, recibo, porDaResposta, abertura, resposta, versao, semTexto, lida }, registro);
  const destino = destinoDaResposta(abertura, lida.escolhas, pedido, pecas);
  if (destino !== "debito" && debito != null) throw new ErroComando(`divida declarada com destino ${destino ?? "nenhum"}: a divida e so do destino debito`);
  // Pergunta com paciente: o comentario do operador nao sai nem na resposta do comando.
  const leitura = semTexto ? { ...lida, comentario: null } : lida;
  // Pergunta com paciente: o literal nao vai ao registro — so as letras ecoadas (D-VEGA19-12).
  const resposta_literal = semTexto ? (leitura.ecoada.join(" ") || "(texto livre retido: pergunta com dado de paciente)") : literal.trim();
  // T44 (D-VEGA20-27 item 4): a resposta gravada sem prova cede a resposta provada que chega depois.
  // O comando nao a regrava (uma `resposta` por pergunta) nem sobe a origem: quem grava a provada e o
  // gancho, pela `autoria` com as letras, e a `origemEfetiva` a le. Aqui so nao se recusa.
  const difere = resposta && (resposta.resposta_literal !== resposta_literal || (recibo !== null && recibo.trim() !== (resposta.recibo ?? null)) || (porDaResposta !== null && porDaResposta !== (resposta.rota?.por ?? null)));
  if (difere && !leitura.alternativa_livre && leitura.escolhas.length > 0) {
    const cede = cedeAProvada(pergunta_id, doRegistro?.eventos ?? [], leitura.escolhas, origemFn ? { origemFn } : {});
    if (cede) return { pergunta_id, ...leitura, destino, ja_respondida: true, cede, sem_registro: false, gravados: 0, ja_existiam: 0, fila: null };
  }
  if (resposta && resposta.resposta_literal !== resposta_literal) {
    throw new ErroComando(`pergunta ${pergunta_id} ja respondida com outro texto; uma resposta por pergunta`);
  }
  conferirReciboEPor(resposta, recibo, porDaResposta, pergunta_id);
  // Sem porque da lista curta, sem severidade ou sem gatilho: recusa antes de gravar (AC-VEGA19-3).
  // Repetir a resposta cuja divida ja esta ligada (linha `destino` gravada) nao pede a divida de novo.
  const jaLigada = Boolean(resposta) && (resposta.destinos?.length ?? 0) > 0;
  const divida = destino === "debito" && !(jaLigada && debito == null) ? pecas.conferirDebito(debito, ErroComando) : null;
  if (divida && registro.destino !== "banco") throw new ErroComando("divida ligada so no destino banco (o registro de debito e do estado.mjs); grave o ponteiro depois por `destino`");
  // Pergunta sobre achado que o gancho de antes da T17 respondeu sem destino (`achado-sem-destino`,
  // D-VEGA19-43): a resposta e uma so por pergunta, entao nada se grava aqui. A mesma resposta
  // aceita quando a opcao escolhida nomeia UM destino que nao e `debito` (a divida pede a ligacao
  // da resposta, que a legada nao tem); o fecho e o `destino`, que tira o destino dessa resposta.
  if (resposta && abertura.achado === true && !resposta.destino) {
    const daOpcao = destinoLegado(abertura, lida.escolhas, pecas, pergunta_id);
    return {
      pergunta_id,
      ...leitura,
      destino: daOpcao,
      legada: true,
      ja_respondida: true,
      sem_registro: resposta.na_fila === true,
      gravados: 0,
      ja_existiam: 1,
      fila: null,
      proximo: (resposta.destinos?.length ?? 0) > 0 ? null : `destino --pergunta ${pergunta_id} --ponteiro <ref>`,
    };
  }
  const semLigacao = resposta && resposta.destino === "debito" && (resposta.destinos?.length ?? 0) === 0 && !resposta.na_fila;
  if (semLigacao && !divida) {
    throw new ErroComando(
      `pergunta ${pergunta_id} respondida com destino debito e a divida ainda sem ligar: repita com --destino debito --porque <${pecas.PORQUES_DE_DEBITO.join("|")}> --severidade <alta|media|baixa> --gatilho <texto>`,
    );
  }
  if (resposta && !(divida && semLigacao)) {
    // A resposta igual que so esta na fila nao foi registrada ainda: diz `sem_registro`.
    return { pergunta_id, ...leitura, destino, ja_respondida: true, sem_registro: resposta.na_fila === true, gravados: 0, ja_existiam: 1, fila: null };
  }
  // Ja respondida com divida ainda sem a linha `destino`: grava de novo (a resposta e idempotente) e
  // o verbo liga a divida que faltou.
  const unica = leitura.escolhas.length === 1 && (itens?.length ?? 1) === 1 ? leitura.escolhas[0].letra : null;
  const recomendada = itens && itens.length === 1 ? (itens[0].recomendada ?? abertura.recomendada ?? null) : null;
  const ev = {
    evento: "resposta",
    pergunta_id,
    sessao: abertura.sessao,
    ciclo: abertura.ciclo ?? null,
    carimbo,
    perguntado_em: abertura.carimbo,
    versao_esquema: versao,
    has_patient_data: semTexto,
    ...(abertura.ponteiro ? { ponteiro: abertura.ponteiro } : {}),
    item: abertura.item,
    titulo: abertura.titulo,
    resposta_literal,
    escolha: unica,
    escolhas: leitura.escolhas,
    recomendada,
    alternativa_livre: leitura.alternativa_livre,
    comentario: semTexto ? null : leitura.comentario,
    origem_resposta: "agente",
    // Regravacao (divida que faltou ligar): recibo, mandato e rota sao os da resposta ja gravada,
    // senao o registro a recusa como outro conteudo. Quem respondeu fica nulo: o sobe a autoria (T41).
    ...(resposta
      ? { ...(resposta.recibo ? { recibo: resposta.recibo } : {}), mandato: resposta.mandato ?? null, ...(resposta.rota ? { rota: resposta.rota } : {}) }
      : { ...(recibo !== null ? { recibo: recibo.trim() } : {}), mandato: mandatoDaAbertura(abertura), ...(porDaResposta ? { rota: { por: porDaResposta } } : {}) }),
    ...(destino ? { destino } : {}),
    ...(divida ? { debito: divida } : {}),
  };
  const r = await registro.gravar("responder", [ev]);
  return {
    pergunta_id,
    ...leitura,
    destino,
    ja_respondida: Boolean(resposta),
    sem_registro: r.sem_registro,
    motivo: r.motivo ?? null,
    gravados: r.gravados,
    ja_existiam: r.ja_existiam,
    dividas: r.dividas ?? [],
    fila: r.fila ?? null,
  };
}

/**
 * A resposta que não casa com o bloco (D-VEGA20-6, VEGA-20 T8): grava o evento `a-confirmar` com o
 * literal e a leitura, não fecha a pergunta e devolve a frase que a sessão mostra ao operador. A
 * marca de paciente é a da abertura; pergunta restrita grava o literal retido (as letras ecoadas
 * são nenhuma: nada casou). Pergunta já respondida: o mesmo literal é a resposta gravada; outro
 * literal recusa, como na resposta (uma resposta por pergunta).
 */
async function voltarAoOperador({ pergunta_id, literal, carimbo, recibo, porDaResposta, abertura, resposta, versao, semTexto, lida }, registro) {
  const resposta_literal = semTexto ? "(texto livre retido: pergunta com dado de paciente)" : literal.trim();
  if (resposta) {
    if (resposta.resposta_literal !== resposta_literal) throw new ErroComando(`pergunta ${pergunta_id} ja respondida com outro texto; uma resposta por pergunta`);
    // A resposta gravada antes da D-VEGA20-6 leu esse literal como texto (o número fora do bloco era
    // texto; a letra fora das opções recusava e nunca gravou): ela vale como a alternativa livre que é.
    return { pergunta_id, tipo: "alternativa-livre", escolhas: [], ecoada: [], comentario: null, alternativa_livre: true, destino: resposta.destino ?? null, ja_respondida: true, sem_registro: resposta.na_fila === true, gravados: 0, ja_existiam: 1, fila: null };
  }
  const ev = {
    evento: A_CONFIRMAR,
    pergunta_id,
    sessao: abertura.sessao,
    ciclo: abertura.ciclo ?? null,
    carimbo,
    versao_esquema: versao,
    has_patient_data: semTexto,
    ...(abertura.ponteiro ? { ponteiro: abertura.ponteiro } : {}),
    item: abertura.item,
    titulo: abertura.titulo,
    resposta_literal,
    leitura: lida.leitura,
    origem_resposta: "agente",
    ...(recibo !== null ? { recibo: recibo.trim() } : {}),
    ...(porDaResposta ? { rota: { por: porDaResposta } } : {}),
  };
  const r = await registro.gravar("responder", [ev]);
  return {
    pergunta_id,
    ...lida,
    destino: null,
    confirmar: fraseDeConfirmacao(lida.leitura),
    ja_respondida: false,
    sem_registro: r.sem_registro,
    motivo: r.motivo ?? null,
    gravados: r.gravados,
    ja_existiam: r.ja_existiam,
    fila: r.fila ?? null,
  };
}

/** Dispensa a pergunta: grava `dispensa`; ela continua aberta (D-VEGA19-19). */
export async function dispensar({ pergunta_id, motivo = null, carimbo = agora() } = {}, { registro } = {}) {
  const { abertura, resposta } = await estadoDe(registro, pergunta_id);
  if (!abertura) throw new ErroComando(`pergunta ${pergunta_id} sem abertura no registro nem na fila`);
  if (resposta) throw new ErroComando(`pergunta ${pergunta_id} ja respondida; nada a dispensar`);
  const versao = amarrarVersao(abertura);
  const semTexto = restrita(abertura);
  const ev = {
    evento: "dispensa",
    pergunta_id,
    sessao: abertura.sessao,
    ciclo: abertura.ciclo ?? null,
    carimbo,
    versao_esquema: versao,
    has_patient_data: semTexto,
    ...(abertura.ponteiro ? { ponteiro: abertura.ponteiro } : {}),
    item: abertura.item,
    titulo: abertura.titulo,
    ...(motivo && !semTexto ? { motivo: String(motivo).slice(0, 2000) } : {}),
  };
  const r = await registro.gravar("dispensar", [ev]);
  return { pergunta_id, sem_registro: r.sem_registro, motivo: r.motivo ?? null, gravados: r.gravados, ja_existiam: r.ja_existiam, fila: r.fila ?? null };
}

const PONTEIRO = /^[A-Za-z0-9_.:/@#-]{1,400}$/;

/**
 * Grava o ponteiro do destino (linha `destino`, nunca UPDATE) da pergunta ja respondida com destino.
 * Recusa sem resposta, resposta sem destino, ou ponteiro que nao e referencia opaca.
 */
export async function gravarDestino({ pergunta_id, ponteiro, carimbo = agora() } = {}, { registro } = {}) {
  if (typeof ponteiro !== "string" || !PONTEIRO.test(ponteiro.trim())) throw new ErroComando("--ponteiro: esperada referencia opaca, sem espaco (sha, id do registro, ramo, T<k>)");
  const { abertura, resposta } = await estadoDe(registro, pergunta_id);
  if (!abertura) throw new ErroComando(`pergunta ${pergunta_id} sem abertura no registro nem na fila`);
  if (!resposta) throw new ErroComando(`pergunta ${pergunta_id} ainda sem resposta: o destino vem da resposta`);
  // Pergunta sobre achado respondida sem destino pelo gancho (D-VEGA19-43): o destino sai da propria
  // resposta gravada, pela opcao escolhida; fora de achado, sem destino nao ha o que apontar.
  let destino = resposta.destino ?? null;
  if (!destino && abertura.achado === true) {
    const itens = Array.isArray(abertura.itens) && abertura.itens.length > 0 ? abertura.itens : null;
    // A resposta antiga que hoje se lê `a-confirmar` (D-VEGA20-6) não tem escolha: destino nulo,
    // e a recusa é a de sempre (sem destino, nada a apontar), nunca erro da leitura.
    const relida = interpretarResposta(resposta.resposta_literal, itens);
    destino = relida.tipo === A_CONFIRMAR ? null : destinoLegado(abertura, relida.escolhas, pecasDe(registro), pergunta_id);
  }
  if (!destino) throw new ErroComando(`pergunta ${pergunta_id} respondida sem destino; nada a apontar`);
  const ev = {
    evento: "destino",
    pergunta_id,
    sessao: abertura.sessao,
    ciclo: abertura.ciclo ?? null,
    carimbo,
    versao_esquema: amarrarVersao(abertura),
    has_patient_data: restrita(abertura),
    item: abertura.item,
    titulo: abertura.titulo,
    ponteiro: ponteiro.trim(),
  };
  const r = await registro.gravar("destino", [ev]);
  return { pergunta_id, destino, ponteiro: ev.ponteiro, sem_registro: r.sem_registro, motivo: r.motivo ?? null, gravados: r.gravados, ja_existiam: r.ja_existiam, fila: r.fila ?? null };
}

/**
 * Lê o estado calculado das perguntas (por `pergunta_id`, por `sessao` ou todas). Com `abertas`, a
 * lista do dono (`abertas`, `lembrete`); `dono` so com `abertas`, e so no destino banco.
 */
export async function ler({ pergunta_id = null, sessao = null, abertas = false, dono = null } = {}, { registro } = {}) {
  if (dono !== null && !abertas) throw new ErroComando("--dono so com --abertas");
  if (dono !== null && registro.destino !== "banco") throw new ErroComando("--dono: o destino git nao guarda o dono da pergunta");
  const { estadoDasPerguntas, perguntasAbertas, lembreteDeCaducadas } = pecasDe(registro);
  const leitura = await registro.ler({ pergunta_id, sessao, abertas, dono });
  // As ligações (superada, duplicada, bifurcação) são derivadas na leitura, por cima do estado. A
  // leitura por pergunta ou por sessão vê só um recorte: as ligações saem dos ciclos das perguntas
  // lidas, para a que supera (ou a irmã) de outra sessão entrar na conta.
  let contexto = leitura.eventos;
  if (!abertas && (pergunta_id || sessao)) {
    const ciclos = [...new Set(leitura.eventos.filter((e) => e.evento === "abertura" && typeof e.ciclo === "string" && e.ciclo).map((e) => e.ciclo))];
    for (const c of ciclos) contexto = contexto.concat((await registro.ler({ ciclo: c })).eventos);
  }
  const ligacoes = ligacoesDasPerguntas(contexto);
  const perguntas = estadoDasPerguntas(leitura.eventos).map((p) => ({ ...p, ...estadoComLigacoes(p.estado, ligacoes.get(p.pergunta_id)) }));
  const r = { perguntas, fila: leitura.fila ?? null, sem_registro: Boolean(leitura.sem_registro), motivo: leitura.motivo ?? null };
  if (!abertas) return r;
  // A lista do dono sai sem superada nem duplicada, venha do verbo do projeto ou das peças.
  const fora = new Set(perguntas.filter((p) => p.estado === "superada" || p.estado === "duplicada").map((p) => p.pergunta_id));
  const lista = (leitura.abertas ?? perguntasAbertas(leitura.eventos, { dono })).filter((a) => !fora.has(a.pergunta_id));
  return { ...r, abertas: lista, lembrete: leitura.lembrete !== undefined ? leitura.lembrete : lembreteDeCaducadas(lista) };
}

export function formatarLeitura(r, { formatarAbertas } = {}) {
  if (r.abertas && typeof formatarAbertas !== "function") throw new ErroComando("formatarLeitura: a lista do dono pede formatarAbertas das peças do projeto");
  const linhas = r.abertas
    ? [formatarAbertas(r.abertas)]
    : r.perguntas.map(
    (p) =>
      `${p.pergunta_id} · ${p.item ?? "?"} · ${p.estado}${p.superada_por ? ` por ${p.superada_por}` : ""}${p.duplicada_de ? ` de ${p.duplicada_de}` : ""}` +
      `${p.bifurcacao?.length ? ` · bifurcacao com ${p.bifurcacao.join(", ")}` : ""}${p.dispensas ? ` · ${p.dispensas} dispensa(s)` : ""}${p.na_fila ? " · na fila" : ""}`,
  );
  if (linhas.length === 0) linhas.push("nenhuma pergunta");
  if (r.lembrete) linhas.push(r.lembrete);
  if (r.fila) {
    const f = r.fila;
    linhas.push(`fila: ${f.pendentes} pendente${f.pendentes === 1 ? "" : "s"}${f.pendentes > 0 && f.mais_antiga ? `, a mais antiga de ${f.mais_antiga}` : ""}${f.falhas > 0 ? ` (${f.falhas} com drenagem falhada)` : ""}`);
  }
  if (r.sem_registro) linhas.push(`sem registro: ${r.motivo ?? "registro fora do ar"}`);
  return linhas.join("\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USO =
  "uso: comando.mjs abrir --arquivo <json|-> [--supersedes <p-id>] [--ciclo <id>] [--fase F<n>] [--task T<k>] [--origem <papel>] [--json]\n" +
  "     comando.mjs responder --pergunta <p-id> --literal <texto> [--origem agente] [--recibo \"<sessao> <evento>\"] [--por <direto|hub:<sessao>|pessoa:<id>>]\n" +
  "                 [--destino <destino> [--porque <da lista curta> --severidade <s> --gatilho <texto> [--porque-livre <linha>]]] [--json]\n" +
  "     comando.mjs dispensar --pergunta <p-id> [--motivo <texto>] [--json]\n" +
  "     comando.mjs destino --pergunta <p-id> --ponteiro <ref> [--json]\n" +
  "     comando.mjs ler [--pergunta <p-id> | --sessao <id>] [--abertas [--dono <handle>]] [--json]\n" +
  "     (--repo <raiz> em todos; padrao: a raiz do repositorio)";

const FLAGS = {
  abrir: ["arquivo", "supersedes", "ciclo", "fase", "task", "origem", "repo"],
  responder: ["pergunta", "literal", "origem", "recibo", "por", "destino", "porque", "porque-livre", "severidade", "gatilho", "repo"],
  dispensar: ["pergunta", "motivo", "repo"],
  destino: ["pergunta", "ponteiro", "repo"],
  ler: ["pergunta", "sessao", "dono", "repo"],
};
/** Flags sem valor, por verbo. */
const BOOLEANAS = { ler: ["abertas"] };

export function parsear(argv) {
  const [verbo, ...resto] = argv;
  if (!FLAGS[verbo]) return { erro: `verbo ${JSON.stringify(verbo ?? "(ausente)")}; validos: ${Object.keys(FLAGS).join(", ")}` };
  const o = { verbo, json: false };
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (a === "--json") {
      o.json = true;
      continue;
    }
    if (a.startsWith("--") && (BOOLEANAS[verbo] ?? []).includes(a.slice(2))) {
      o[a.slice(2)] = true;
      continue;
    }
    const nome = a.startsWith("--") ? a.slice(2) : null;
    if (!nome || !FLAGS[verbo].includes(nome)) return { erro: `argumento desconhecido em ${verbo}: ${a}` };
    if (o[nome] !== undefined) return { erro: `--${nome} repetido` };
    const v = resto[++i];
    if (v === undefined || (v.startsWith("--") && nome !== "literal")) return { erro: `--${nome} exige valor` };
    o[nome] = v;
  }
  if (verbo === "abrir" && !o.arquivo) return { erro: "abrir exige --arquivo" };
  if ((verbo === "responder" || verbo === "dispensar" || verbo === "destino") && !o.pergunta) return { erro: `${verbo} exige --pergunta` };
  if (verbo === "destino" && !o.ponteiro) return { erro: "destino exige --ponteiro" };
  if (verbo === "ler" && o.dono && !o.abertas) return { erro: "--dono so com --abertas" };
  if (verbo === "responder" && o.literal === undefined) return { erro: "responder exige --literal com o texto do operador" };
  if (verbo === "responder" && o.recibo !== undefined && !RECIBO.test(o.recibo.trim())) return { erro: '--recibo: esperado "<sessao> <evento>"' };
  return { opcoes: o };
}

/**
 * `--ciclo/--fase/--task/--origem` do `abrir` entram na `chave` da entrada; o mesmo campo com outro
 * valor na entrada recusa (nunca se escolhe calado). Exportada para teste.
 */
export function chaveDosFlags(entrada, o) {
  const dos = Object.fromEntries(["ciclo", "fase", "task", "origem"].filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  if (Object.keys(dos).length === 0) return entrada;
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) throw new ErroComando("abrir: esperado objeto { sessao, ciclo?, chave?, pergunta }");
  const dada = entrada.chave && typeof entrada.chave === "object" ? entrada.chave : {};
  for (const [k, v] of Object.entries(dos)) if (dada[k] != null && dada[k] !== v) throw new ErroComando(`--${k} diverge da chave.${k} da entrada`);
  return { ...entrada, chave: { ...dada, ...dos } };
}

const RAIZ_PADRAO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

export async function principal(argv, { registro = null, stdout = process.stdout, stderr = process.stderr } = {}) {
  const { erro, opcoes: o } = parsear(argv);
  if (erro) {
    stderr.write(`${erro}\n${USO}\n`);
    return EXIT.USO;
  }
  try {
    const reg = registro ?? (await registroDoProjeto(o.repo ? path.resolve(o.repo) : RAIZ_PADRAO));
    let r;
    if (o.verbo === "abrir") {
      let entrada;
      try {
        entrada = JSON.parse((o.arquivo === "-" ? readFileSync(0) : readFileSync(path.resolve(o.arquivo))).toString("utf8"));
      } catch (e) {
        throw new ErroComando(`--arquivo: JSON ilegivel (${e.code ?? "parse"})`, EXIT.USO);
      }
      if (o.supersedes !== undefined) {
        if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) throw new ErroComando("abrir: esperado objeto { sessao, ciclo?, chave?, pergunta }");
        if (entrada.supersedes != null && entrada.supersedes !== o.supersedes) throw new ErroComando("--supersedes diverge do supersedes da entrada");
        entrada = { ...entrada, supersedes: o.supersedes };
      }
      entrada = chaveDosFlags(entrada, o);
      const ondeAbre = o.repo ? path.resolve(o.repo) : process.cwd();
      r = await abrir(entrada, { registro: reg, sombra: sombrear, ramo: ramoAtual(ondeAbre), conducao: conducaoDoCwd(o.repo ? path.resolve(o.repo) : RAIZ_PADRAO, ondeAbre) });
      stdout.write(o.json ? `${JSON.stringify(r, null, 2)}\n` : `${r.texto}\n`);
    } else if (o.verbo === "responder") {
      const temDivida = ["porque", "porque-livre", "severidade", "gatilho"].some((k) => o[k] !== undefined);
      const debito = temDivida ? { porque: o.porque, porque_texto: o["porque-livre"] ?? null, severidade: o.severidade, gatilho: o.gatilho } : null;
      r = await responder({ pergunta_id: o.pergunta, literal: o.literal, origem: o.origem ?? "agente", destino: o.destino ?? null, debito, recibo: o.recibo ?? null, por: o.por ?? null }, { registro: reg });
      stdout.write(o.json ? `${JSON.stringify(r, null, 2)}\n` : `${r.pergunta_id} · ${r.tipo}${r.ecoada.length ? ` · ${r.ecoada.join(" ")}` : ""}${r.legada ? ` · destino ${r.destino}${r.proximo ? ` · falta: ${r.proximo}` : ""}` : ""}${r.sem_registro ? " · sem registro" : ""}${r.confirmar ? `\n${r.confirmar}` : ""}\n`);
    } else if (o.verbo === "dispensar") {
      r = await dispensar({ pergunta_id: o.pergunta, motivo: o.motivo ?? null }, { registro: reg });
      stdout.write(o.json ? `${JSON.stringify(r, null, 2)}\n` : `${r.pergunta_id} · dispensada (segue aberta)${r.sem_registro ? " · sem registro" : ""}\n`);
    } else if (o.verbo === "destino") {
      r = await gravarDestino({ pergunta_id: o.pergunta, ponteiro: o.ponteiro }, { registro: reg });
      stdout.write(o.json ? `${JSON.stringify(r, null, 2)}\n` : `${r.pergunta_id} · ${r.destino} · ${r.ponteiro}${r.sem_registro ? " · sem registro" : ""}\n`);
    } else {
      r = await ler({ pergunta_id: o.pergunta ?? null, sessao: o.sessao ?? null, abertas: o.abertas === true, dono: o.dono ?? null }, { registro: reg });
      stdout.write(o.json ? `${JSON.stringify(r, null, 2)}\n` : `${formatarLeitura(r, pecasDe(reg))}\n`);
    }
    return EXIT.OK;
  } catch (e) {
    stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return e?.codigo ?? EXIT.RECUSA;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal(process.argv.slice(2)).then((c) => {
    process.exitCode = c;
  });
}
