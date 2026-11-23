/**
 * inscricao-da-maestra.test.mjs — em 3 níveis a inscrição na proposta é da
 * maestra o ciclo inteiro (VEGA-20 T37, AC-VEGA20-16, D10a do operador,
 * 21/11/2026).
 *
 * O `proximo` da condutora, no fechamento de fase (`comPassosDoRamo`) e na
 * passagem (`regraPassagem`), não emite `inscrever-na-proposta` nem
 * `soltar-inscricao` em 3 níveis, e a passagem confirma sem `inscrita`; em 2
 * níveis os dois seguem emitidos (controle invertido). O arranjo chega às
 * regras pelo contexto (`contextoDoProximo`, campo `niveis`). A linha que a
 * maestra manda à condutora viva tem a forma `CI <sha8> <estado>`. E a
 * etapa do planejamento se arquiva no turno em que a entrega é lida, salvo a
 * que guarda o checkout do ramo do ciclo ainda não empurrado.
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOTOES } from "../botoes.mjs";
import { comPassosDoRamo, contextoDoProximo, nonce, textoDaHerdeira } from "../conducao.mjs";
import { eventoDaProposta, linhaDaMaestra, linhaDeCi, textoDaMaestra } from "../niveis.mjs";
import { conferenciasDaHerdeira } from "../pre-voo.mjs";
import { regraPassagem } from "../regras.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CICLO = "TESTE-37-inscricao";
const RAMO = "ciclo-teste";
const HEAD = "c".repeat(40);
const AGORA = Date.parse("2026-11-22T12:00:00Z") / 1000;
const PLANO = { fases: [{ id: "F1", modelo: "opus", tasks: [] }, { id: "F2", modelo: "sonnet", tasks: [] }] };
const MARCA = Object.freeze({ tipo: "passagem", sha: "a".repeat(40), fase: "F1", epoca: "1", lock: "lock-da-anterior", ramo: RAMO, nota: "nota.md" });

// ── o fechamento de fase ─────────────────────────────────────────────────────

/** A ação do fechamento que as regras decidiram, antes dos passos do ramo. */
const FECHAR = Object.freeze({ acao: "esperar", motivo: "ci-pendente", fase: "F1", faseSeguinte: "F2", ciclo: CICLO, head: HEAD, plano: "p".repeat(40) });
const EMPURRADO = Object.freeze({ nome: RAMO, noOrigin: HEAD });

test("fechamento de fase em 3 níveis não emite inscrever-na-proposta; em 2 segue emitindo", () => {
  const tres = comPassosDoRamo(FECHAR, { ramo: EMPURRADO, temCi: true, entrada: {}, niveis: 3 });
  assert.notEqual(tres.acao, "inscrever-na-proposta");
  // Sem a inscrição, a condutora segue direto para a leitura do CI pelo verbo `ci`.
  assert.deepEqual([tres.acao, tres.motivo, tres.passo], ["esperar", "ci-pendente", "ci"]);
  // Controle invertido: 2 níveis (e o padrão, sem o campo) seguem pedindo a inscrição.
  for (const opcoes of [{ niveis: 2 }, {}]) {
    const dois = comPassosDoRamo(FECHAR, { ramo: EMPURRADO, temCi: true, entrada: {}, ...opcoes });
    assert.equal(dois.acao, "inscrever-na-proposta");
    assert.equal(dois.ferramenta, "subscribe_pr_activity");
  }
  // Em 2 níveis, já inscrita: o CI, como antes.
  assert.equal(comPassosDoRamo(FECHAR, { ramo: EMPURRADO, temCi: true, entrada: { inscrita: true }, niveis: 2 }).passo, "ci");
  // O empurrar segue igual nos dois arranjos.
  const atras = { nome: RAMO, noOrigin: "d".repeat(40) };
  assert.equal(comPassosDoRamo(FECHAR, { ramo: atras, temCi: true, entrada: {}, niveis: 3 }).acao, "empurrar-ramo");
});

// ── a passagem ───────────────────────────────────────────────────────────────

/** O contexto que a `regraPassagem` lê, como o `proximo` o monta. */
function ctxDe({ passagem, entrada = {}, niveis }) {
  const fabrica = (tipo, alvo, tentativa, campos) => ({ acao: tipo, nonce: nonce(CICLO, alvo, tentativa, HEAD), alvo, ...campos });
  return {
    ciclo: CICLO,
    acao: fabrica,
    nonce,
    plano: PLANO,
    encerradas: new Set(["F1"]),
    entrada,
    temCi: true,
    agora: AGORA,
    epoch: (v) => (typeof v === "number" ? v : Date.parse(v) / 1000),
    estadoDaFilha: (e) => String(e).toUpperCase(),
    prazoConfirmacaoMin: BOTOES.prazoConfirmacaoPassagemMin,
    textoDaHerdeira,
    ...(niveis !== undefined ? { niveis } : {}),
    passagem: { falhas: new Map(), noMeio: new Map(), confirmadas: new Set(), passarDepoisDe: new Set(), aberta: MARCA, ultima: MARCA, arvoreDaAnterior: null, confirmadaNoRamo: false, ...passagem },
  };
}

const HERDEIRA_DONA = { posse: { estado: "dona", epoca: 2 }, anexado: true };
const ANTERIOR_DESTITUIDA = { posse: { estado: "outra" }, anexado: false };

test("passagem em 3 níveis: a herdeira confirma sem inscrita e a anterior não solta; em 2 segue como hoje", () => {
  // Herdeira dona, sem `inscrita`: em 3 níveis confirma direto.
  const confirma = regraPassagem(ctxDe({ passagem: HERDEIRA_DONA, niveis: 3 }));
  assert.equal(confirma.acao, "confirmar-passagem");
  assert.equal(confirma.epocaNova, 2);
  // Anterior destituída que se dizia inscrita: em 3 níveis nunca solta, para com a passagem entregue.
  const anterior = regraPassagem(ctxDe({ passagem: ANTERIOR_DESTITUIDA, entrada: { inscrita: true }, niveis: 3 }));
  assert.notEqual(anterior.acao, "soltar-inscricao");
  assert.equal(anterior.acao, "parar");
  // Controle invertido: 2 níveis (e o padrão, sem o campo) seguem pedindo inscrever e soltar.
  for (const niveis of [2, undefined]) {
    const inscreve = regraPassagem(ctxDe({ passagem: HERDEIRA_DONA, niveis }));
    assert.equal(inscreve.acao, "inscrever-na-proposta");
    assert.equal(inscreve.depois, "confirmar-passagem");
    assert.equal(regraPassagem(ctxDe({ passagem: HERDEIRA_DONA, entrada: { inscrita: true }, niveis })).acao, "confirmar-passagem");
    assert.equal(regraPassagem(ctxDe({ passagem: ANTERIOR_DESTITUIDA, entrada: { inscrita: true }, niveis })).acao, "soltar-inscricao");
  }
});

test("a herdeira criada em 3 níveis não é mandada se inscrever; em 2 é", () => {
  const anteriorDona = { posse: { estado: "dona", epoca: 1 }, anexado: false };
  const tres = regraPassagem(ctxDe({ passagem: anteriorDona, entrada: { sessaoMaestra: "session_anterior" }, niveis: 3 }));
  assert.equal(tres.acao, "criar-condutora");
  assert.doesNotMatch(tres.texto, /inscrever-na-proposta|"inscrita":true|soltou a inscrição/);
  assert.match(tres.texto, /inscrição na proposta é da maestra/);
  assert.match(tres.texto, /pre-voo .*--herdeira;/);
  const dois = regraPassagem(ctxDe({ passagem: anteriorDona, entrada: { sessaoMaestra: "session_anterior" }, niveis: 2 }));
  assert.match(dois.texto, /inscrever-na-proposta, depois confirmar-passagem/);
  assert.match(dois.texto, /--herdeira --entrada '\{"inscrita":true\}'/);
});

test("pré-voo da herdeira em 3 níveis não cobra inscrita; em 2 cobra", () => {
  const marca = (niveis) => ({ tipo: "niveis", sha: "n".repeat(40), niveis });
  const inscricao = (marcas) =>
    conferenciasDaHerdeira({ repo: AQUI, ciclo: CICLO, entrada: {}, temCi: true, lerPosse: () => null, marcas }).conferencias.find((c) => c.conferencia === "inscricao-feita");
  const tres = inscricao([marca(3)]);
  assert.equal(tres.estado, "ok");
  assert.match(tres.encontrado, /3 níveis/);
  assert.equal(inscricao([marca(2)]).estado, "falha");
  // Sem marca, 3 níveis (padrão, D10c do L4): a inscrição é da maestra, a herdeira não a cobra.
  assert.equal(inscricao([]).estado, "ok");
});

test("o arranjo chega às regras pelo contexto do proximo", () => {
  const params = { ciclo: CICLO, head: HEAD, plano: { fases: [], porId: new Map() }, estado: { feitas: new Set(), emVoo: new Map(), trazidas: new Map() }, autorizacoes: [], entrada: {} };
  const fabrica = (tipo, alvo, tentativa, campos) => ({ acao: tipo, ...campos });
  assert.equal(contextoDoProximo({ ...params, niveis: 3 }, fabrica).niveis, 3);
  assert.equal(contextoDoProximo(params, fabrica).niveis, 2);
});

// ── a linha da maestra ───────────────────────────────────────────────────────

test("a linha da maestra tem a forma CI <sha8> <estado> e só acorda", () => {
  assert.equal(linhaDeCi({ sha: "ABCDEF0123456789abcdef0123456789abcdef01", estado: "success" }), "CI abcdef01 success");
  assert.match(linhaDeCi({ sha: "1234567", estado: "em andamento" }), /^CI [0-9a-f]{7,8} \S+$/);
  assert.equal(linhaDeCi({ sha: "não-é-sha", estado: "success" }), null);
  assert.equal(linhaDeCi({ sha: "a".repeat(40), estado: " " }), null);
  // Condutora viva: a linha vai a ela por send_message.
  const viva = eventoDaProposta({ sha: "b".repeat(40), estado: "failure", condutoraViva: "session_condutora" });
  assert.deepEqual(viva, { acao: "acordar-condutora", para: "session_condutora", mensagem: `CI ${"b".repeat(8)} failure`, ferramenta: "send_message" });
  // Passagem em curso, sem condutora viva: guarda a última linha para a herdeira.
  const guardada = eventoDaProposta({ sha: "b".repeat(40), estado: "success" });
  assert.equal(guardada.acao, "guardar-linha");
  assert.equal(guardada.linha, `CI ${"b".repeat(8)} success`);
  assert.match(guardada.depois, /confirmar-passagem/);
  // O prompt da condutora nascida da maestra diz que ela não se inscreve e que a linha não é veredito.
  const prompt = linhaDaMaestra("session_maestra");
  assert.match(prompt, /nunca subscribe_pr_activity nem unsubscribe_pr_activity/);
  assert.match(prompt, /nunca vale como veredito/);
});

// ── o arquivamento da etapa do planejamento ──────────────────────────────────

test("planejar.md §3 manda quem conduz arquivar a etapa no turno em que lê a entrega, e a etapa não guarda o ramo", () => {
  const texto = readFileSync(path.join(AQUI, "..", "..", "..", "skills", "conducao", "references", "planejar.md"), "utf8");
  const secao = texto.split(/^## /m).find((s) => /^3\b/.test(s));
  assert.ok(secao, "planejar.md sem §3");
  assert.match(secao, /archive_session/);
  // Desde o hotfix conducao-pedido-da-etapa (ruling de 23/11/2026): o ramo vive na árvore de quem
  // conduz, a etapa só commita, e por isso nenhuma etapa fica viva para guardar o checkout.
  assert.match(secao, /Quem conduz arquiva a sessão da etapa/);
  assert.match(secao, /no turno em que lê a entrega dela/);
  assert.match(secao, /a etapa não guarda o ramo/);
});

// ── o repositório antes da inscrição (T48) ───────────────────────────────────

/** O passo 3 do texto da herdeira da maestra (recortado: a condutora também cita subscribe_pr_activity). */
function passo3DaHerdeira() {
  const texto = textoDaMaestra({ ciclo: CICLO, anterior: "session_anterior", ordinal: 2, raiz: "<raiz>" });
  const passo = texto.split("\n").find((l) => l.startsWith("3. "));
  assert.ok(passo, "texto da herdeira sem passo 3");
  return passo;
}

/** maestra.md §A proposta. */
function propostaDaMaestra() {
  const texto = readFileSync(path.join(AQUI, "..", "..", "..", "skills", "conducao", "references", "maestra.md"), "utf8");
  const secao = texto.split(/^## /m).find((s) => /^A proposta\b/.test(s));
  assert.ok(secao, "maestra.md sem §A proposta");
  return secao;
}

function antesDe(texto, primeiro, depois) {
  const a = texto.indexOf(primeiro);
  const b = texto.indexOf(depois);
  assert.ok(a >= 0, `sem ${primeiro}`);
  assert.ok(b >= 0, `sem ${depois}`);
  assert.ok(a < b, `${primeiro} depois de ${depois}`);
}

test("o passo 3 da herdeira da maestra anexa o repositório antes do subscribe_pr_activity", () => {
  antesDe(passo3DaHerdeira(), "add_repo", "subscribe_pr_activity");
});

test("maestra.md §A proposta traz add_repo antes de subscribe_pr_activity", () => {
  antesDe(propostaDaMaestra(), "add_repo", "subscribe_pr_activity");
});

/**
 * O nome do repositório só existe na fonte: a cópia do corpo num repositório
 * vazio (`corpo-fora-da-fonte`/`repo-limpo`) não tem `origin` nem nome de
 * projeto a procurar. O critério de fonte é o de `pergunta-citada.test.mjs`
 * (um arquivo que só a fonte tem), nunca a falta de `origin`: na fonte o git
 * é lido sem rede de proteção, e `origin` ausente ali lança. Suíte pulada
 * inteira fora da fonte, porque `test(…, { skip })` conta como não passado
 * na bateria do corpo (`# pass` ≠ `# tests`).
 */
const RAIZ = path.resolve(AQUI, "..", "..", "..", "..", "..", "..");
const NA_FONTE = existsSync(path.join(RAIZ, ".claude", "scripts", "estado", "lib", "pergunta.mjs"));

describe("na fonte: o nome do repositório", { skip: !NA_FONTE && "fora da fonte: sem o repositório do projeto" }, () => {
  test("nenhum dos dois textos cita o nome do repositório", () => {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: AQUI, encoding: "utf8" }).trim();
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    assert.ok(m, `origin sem dono/nome: ${url}`);
    const nome = `${m[1]}/${m[2]}`.toLowerCase();
    for (const texto of [passo3DaHerdeira(), propostaDaMaestra()]) assert.ok(!texto.toLowerCase().includes(nome), `texto cita ${nome}`);
  });
});
