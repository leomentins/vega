/**
 * passagem-ordem.test.mjs — a ordem da troca de condutora, as duas saídas sem
 * confirmação e o desmonte da árvore da anterior pela herdeira (VEGA-37 T16,
 * D-VEGA37-18, D-VEGA37-19).
 *
 * Dois níveis. As regras puras (`regraPassagem`, `regraPassarNaFronteira`) são
 * percorridas passo a passo sobre um contexto montado à mão, como o `proximo`
 * o monta. Os verbos de git correm num repositório de verdade numa pasta
 * temporária — origin bare, a árvore da anterior e a da herdeira como worktrees
 * do mesmo repositório, hooks desligados — com o leitor da posse trocado por
 * `trocarLeitorDaPosse`, por árvore, como a declaração e o banco o dariam: o
 * `passar-posse` do projeto (T14) é a troca desse leitor.
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BOTOES } from "../botoes.mjs";
import {
  confirmarPassagem,
  desanexarRamo,
  desmontarAnterior,
  nonce,
  proximo,
  resumoDaPassagem,
  retomarDaPassagem,
  textoDaHerdeira,
  trazerRamo,
} from "../conducao.mjs";
import { SECOES_DA_NOTA, autorizarCiclo, passagemAberta, passar, trocarLeitorDaPosse } from "../git-conducao.mjs";
import { ErroPlano } from "../ler-plano.mjs";
import { lerMarcas } from "../marcas.mjs";
import { nomeDaCondutora, papelNaPassagem, regraPassagem, regraPassarNaFronteira } from "../regras.mjs";

const CICLO = "TESTE-16-ordem";
const PASTA = `.agents/ciclo/teste/${CICLO}`;
const CAMINHO = `${PASTA}/canonico.md`;
const RAMO = "ciclo-teste";
const PRAZO = BOTOES.prazoConfirmacaoPassagemMin;
const AGORA = Date.parse("2026-11-14T20:00:00Z") / 1000;
const ISO = (s) => new Date(s * 1000).toISOString();

// ── nível 1: as regras puras ─────────────────────────────────────────────────

const PLANO = { fases: [{ id: "F1", modelo: "opus", tasks: [] }, { id: "F2", modelo: "sonnet", tasks: [] }] };
const MARCA = Object.freeze({ tipo: "passagem", sha: "a".repeat(40), fase: "F1", epoca: "1", lock: "lock-da-anterior", ramo: RAMO, nota: `${PASTA}/notes/passagem-F1-1.md` });

/** O contexto que a `regraPassagem` lê, como o `proximo` o monta (`contextoDoProximo`). */
function ctxDe({ passagem, entrada = {}, encerradas = [], temCi = true, fase = null, autorizadas = [] }) {
  const fabrica = (tipo, alvo, tentativa, campos) => ({ acao: tipo, nonce: nonce(CICLO, alvo, tentativa, "h".repeat(40)), alvo, ...campos });
  return {
    ciclo: CICLO,
    acao: fabrica,
    nonce,
    plano: PLANO,
    encerradas: new Set(encerradas),
    entrada,
    temCi,
    agora: AGORA,
    epoch: (v) => (typeof v === "number" ? v : Date.parse(v) / 1000),
    estadoDaFilha: (e) => String(e).toUpperCase(),
    prazoConfirmacaoMin: PRAZO,
    textoDaHerdeira,
    fase,
    autorizadas: new Set(autorizadas),
    iPrimeira: 0,
    passagem: { falhas: new Map(), noMeio: new Map(), confirmadas: new Set(), passarDepoisDe: new Set(), ...passagem },
  };
}

const DONA1 = { estado: "dona", epoca: 1 };
const DONA2 = { estado: "dona", epoca: 2 };
const OUTRA = { estado: "outra" };

test("a ordem completa da troca segue o esboço, na fronteira e no meio da fase", () => {
  // 1. Fronteira: encerrada a F1 com `Conducao-Depois: passar`, a F2 sem autorização ⇒ passar.
  const fronteira = regraPassarNaFronteira(
    ctxDe({ passagem: { passarDepoisDe: new Set(["F1"]) }, encerradas: ["F1"], fase: PLANO.fases[1], autorizadas: ["F1"] }),
  );
  assert.equal(fronteira.acao, "passar");
  assert.deepEqual([fronteira.fase, fronteira.faseSeguinte, fronteira.tentativa], ["F1", "F2", 1]);
  // Marca antiga, sem o trailer: o laço segue como antes (a sessão seguinte autoriza).
  assert.equal(regraPassarNaFronteira(ctxDe({ passagem: {}, encerradas: ["F1"], fase: PLANO.fases[1], autorizadas: ["F1"] })), null);
  // Passagem da F1 já confirmada: a herdeira autoriza a F2, sem passar de novo.
  assert.equal(regraPassarNaFronteira(ctxDe({ passagem: { passarDepoisDe: new Set(["F1"]), confirmadas: new Set(["F1"]) }, encerradas: ["F1"], fase: PLANO.fases[1], autorizadas: ["F1"] })), null);

  const base = { aberta: MARCA, ultima: MARCA, arvoreDaAnterior: null, confirmadaNoRamo: false };
  const passo = (passagem, entrada, extra = {}) => regraPassagem(ctxDe({ passagem: { ...base, ...passagem }, entrada, encerradas: ["F1"], ...extra }));

  // 1b. Anterior dona com o ramo ainda anexado: desanexa, sem soltar a posse.
  assert.equal(passo({ posse: DONA1, anexado: true }, {}).acao, "desanexar-ramo");
  // 2. Destacada e sem herdeira: cria a herdeira, a primeira condutora da F2 (D-VEGA37-18).
  const criar = passo({ posse: DONA1, anexado: false }, { sessaoMaestra: "session_anterior" });
  assert.equal(criar.acao, "criar-condutora");
  assert.equal(criar.nome, `${CICLO} · F2`);
  assert.deepEqual([criar.fase, criar.faseDaPassagem, criar.ordinal, criar.modelo, criar.tentativa], ["F2", "F1", 1, "sonnet", 1]);
  assert.equal(criar.prazoMin, PRAZO);
  assert.deepEqual(criar.trazer, { ramo: RAMO, passagem: MARCA.sha, tentativa: 1, nonce: nonce(CICLO, `herdeira:${MARCA.sha}`, 1, MARCA.sha) });
  assert.match(criar.texto, /trazer-ramo .*--ramo ciclo-teste --passagem a{40} --tentativa 1 --nonce [0-9a-f]{16}/);
  assert.match(criar.texto, /herdeira da condutora session_anterior/);
  assert.match(criar.texto, /arquivar-anterior \(archive_session de session_anterior/);
  // Herdeira criada, dentro do prazo: a anterior espera.
  const viva = { sessao: "session_h", estado: "idle", criadaEm: ISO(AGORA - 60) };
  assert.equal(passo({ posse: DONA1, anexado: false }, { herdeira: viva }).motivo, "passagem-em-curso");
  // 3–4. A herdeira trouxe o ramo, a posse ainda é da anterior: passar-posse com o par da nota.
  const posse = passo({ posse: OUTRA, anexado: true }, {});
  assert.equal(posse.acao, "passar-posse");
  assert.deepEqual([posse.lock_id, posse.epoca], ["lock-da-anterior", 1]);
  // A época subiu: a anterior não grava mais; solta a inscrição.
  assert.equal(passo({ posse: OUTRA, anexado: false }, { inscrita: true, herdeira: viva }).acao, "soltar-inscricao");
  // 5. A herdeira dona se inscreve, relê o CI e confirma.
  const inscrever = passo({ posse: DONA2, anexado: true }, {});
  assert.equal(inscrever.acao, "inscrever-na-proposta");
  assert.equal(inscrever.depois, "confirmar-passagem");
  const ci = { sha: MARCA.sha, veredito: "verde", run: 7 };
  const confirmar = passo({ posse: DONA2, anexado: true }, { inscrita: true, ci });
  assert.equal(confirmar.acao, "confirmar-passagem");
  assert.deepEqual([confirmar.epocaNova, confirmar.ci], [2, ci]);
  // 6. A anterior destituída, inscrição solta, para sem esperar a confirmação (D19a), confirmada ou não.
  const entregue = passo({ posse: OUTRA, anexado: false }, { herdeira: viva, sessaoMaestra: "session_anterior" });
  assert.deepEqual([entregue.acao, entregue.motivo, entregue.prazoMin], ["parar", "passagem-entregue-sem-confirmacao", PRAZO]);
  const entregueConfirmada = passo({ posse: OUTRA, anexado: false, confirmadaNoRamo: true }, { herdeira: viva, sessaoMaestra: "session_anterior" });
  assert.deepEqual([entregueConfirmada.acao, entregueConfirmada.motivo], ["parar", "passagem-entregue"]);
  // Época subida e prazo vencido sem confirmação: a dona é a herdeira; a anterior não retoma, para e avisa.
  const parada = passo({ posse: OUTRA, anexado: false }, { herdeira: { ...viva, criadaEm: ISO(AGORA - (PRAZO + 1) * 60) } });
  assert.deepEqual([parada.acao, parada.motivo], ["parar", "passagem-epoca-subiu"]);

  // Último passo: depois da confirmação, com a anterior arquivada e a árvore limpa, a herdeira desmonta.
  const confirmada = { tipo: "confirmada", sha: "c".repeat(40), fase: "F1", confirma: MARCA.sha, arvoreSuja: null };
  const arvore = { caminho: "/tmp/bridge-cse_anterior", nome: "bridge-cse_anterior", suja: false, motivo: null };
  const depois = (entrada, a = arvore, c = confirmada) => regraPassagem(ctxDe({ passagem: { aberta: null, ultima: c, posse: DONA2, anexado: true, arvoreDaAnterior: a }, entrada }));
  // D19a: anterior viva depois da confirmação ⇒ a herdeira a arquiva, antes do desmonte.
  const arquivar = depois({ anterior: { sessao: "session_anterior", estado: "idle" } });
  assert.deepEqual([arquivar.acao, arquivar.sessao, arquivar.ferramenta], ["arquivar-anterior", "session_anterior", "archive_session"]);
  assert.equal(depois({}), null, "sem a anterior na entrada, nada");
  assert.equal(depois({ anterior: { sessao: "session_anterior" } }).acao, "arquivar-anterior", "sem estado, conta como viva");
  const duas = { sessao: "session_anterior", estado: "idle", arquivamentos: [arquivar.nonceArquivar, arquivar.nonceArquivar] };
  assert.deepEqual([depois({ anterior: duas }).acao, depois({ anterior: duas }).motivo], ["perguntar", "falha-de-arquivamento"]);
  const desmontar = depois({ anterior: { sessao: "session_anterior", estado: "archived" } });
  assert.deepEqual([desmontar.acao, desmontar.caminho, desmontar.nome], ["desmontar-anterior", arvore.caminho, arvore.nome]);
  assert.equal(depois({ anterior: { estado: "ARCHIVED" } }, { ...arvore, suja: true, motivo: "1 caminho(s) no status" }).motivo, "arvore-da-anterior-suja");
  assert.equal(depois({ anterior: { estado: "ARCHIVED" } }, arvore, { ...confirmada, arvoreSuja: arvore.caminho }), null, "suja na confirmação: o operador decide");
  assert.equal(depois({ anterior: { estado: "ARCHIVED" } }, null), null, "árvore já fora");

  // No meio da fase: a herdeira leva o ordinal dentro dela, nunca a época.
  const meio = regraPassagem(ctxDe({ passagem: { ...base, aberta: { ...MARCA, fase: "F2" }, posse: DONA1, anexado: false, noMeio: new Map([["F2", 1]]) }, encerradas: ["F1"] }));
  assert.deepEqual([meio.acao, meio.nome, meio.ordinal, meio.fase], ["criar-condutora", nomeDaCondutora(CICLO, "F2", 3), 3, "F2"]);
  assert.equal(meio.nome, `${CICLO} · F2 · 3`);

  // Sem época legível a ordem não anda: pergunta.
  assert.equal(passo({ posse: { estado: "nao-li", motivo: "banco fora" }, anexado: false }, {}).motivo, "passagem-sem-posse");
  assert.equal(papelNaPassagem({ posse: null, anexado: true, aberta: MARCA }), null);
});

// ── nível 2: os verbos de git ────────────────────────────────────────────────

function task(id) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE16-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    "- **Steps:** faz",
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

function canonico() {
  return [
    "---",
    `id: ciclo/teste/${CICLO}/canonico`,
    `cycle: ${CICLO}`,
    "opened: 2026-11-14",
    "---",
    "",
    "## 1. Goal",
    "",
    "### 1.5 Modo de Execução",
    "",
    "**Largura do ciclo:** 3",
    "",
    "## 3. Tasks",
    "",
    "### F1 — fase F1 (**Modelo:** sonnet)",
    "",
    task("T1"),
    task("T2"),
    "## 4. Pronto",
    "",
  ].join("\n");
}

const CORPO = SECOES_DA_NOTA.map((s) => `## ${s}\n\ntexto de ${s}\n`).join("\n");
const LOCK1 = "11111111-2222-3333-4444-555555555555";
const LOCK2 = "66666666-7777-8888-9999-000000000000";

function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Origin bare e um repositório com três árvores: a principal (destacada no
 * plano, fora da troca), a da anterior (no ramo do ciclo) e a da herdeira
 * (destacada, limpa, como a sessão nova nasce). A posse é lida por árvore em
 * `posse` — o `passar-posse` do projeto é a troca dela.
 */
function ambiente(t) {
  const raiz = real(mkdtempSync(path.join(tmpdir(), "passagem-ordem-")));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const principal = path.join(raiz, "principal");
  mkdirSync(principal);
  const g = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g(principal, "init", "-q", "-b", RAMO);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g(principal, "config", k, v);
  g(principal, "remote", "add", "origin", origin);
  mkdirSync(path.join(principal, PASTA), { recursive: true });
  writeFileSync(path.join(principal, "README.md"), "fixture\n");
  writeFileSync(path.join(principal, ".gitignore"), "**/notes/sensivel/\n");
  writeFileSync(path.join(principal, CAMINHO), canonico());
  g(principal, "add", "-A");
  g(principal, "commit", "-q", "-m", "plano");
  // Ciclo de 2 níveis declarado: sem a marca, o núcleo roda em 3 (D10c do L4).
  g(principal, "commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 2", "-m", "Conducao-Niveis: 2");
  g(principal, "push", "-q", "origin", RAMO);
  g(principal, "switch", "-q", "--detach");
  const anterior = path.join(raiz, "bridge-cse_anterior");
  g(principal, "worktree", "add", "-q", anterior, RAMO);
  const herdeira = path.join(raiz, "bridge-cse_herdeira");
  g(principal, "worktree", "add", "-q", "--detach", herdeira, "HEAD");
  const posse = new Map([
    [anterior, { estado: "dona", ciclo: CICLO, lock_id: LOCK1, epoca: 1, epoca_gravada: 1 }],
    [herdeira, { estado: "outra", ciclo: CICLO, motivo: "outra árvore" }],
  ]);
  const antes = trocarLeitorDaPosse((repo) => posse.get(real(repo)) ?? { estado: "outra", motivo: "fora da troca" });
  t.after(() => trocarLeitorDaPosse(antes));
  autorizarCiclo({ repo: anterior, ciclo: CICLO, fase: "F1", sim: "sim, pode tocar a F1", pergunta: "p-00000000000000a1" });
  /** A anterior entra em passagem como o verbo `passar` faz: nota, marca e o ramo desanexado. */
  const entrarEmPassagem = () => {
    const r = passar({ repo: anterior, ciclo: CICLO, fase: "F1", corpo: CORPO });
    g(anterior, "switch", "-q", "--detach");
    return r;
  };
  /** O `passar-posse` do projeto (T14): a época sobe e a posse muda de árvore numa escrita. */
  const passarPosse = () => {
    posse.set(herdeira, { estado: "dona", ciclo: CICLO, lock_id: LOCK2, epoca: 2, epoca_gravada: 2 });
    posse.set(anterior, { estado: "outra", ciclo: CICLO, motivo: "outra árvore" });
  };
  const px = (repo, entrada = {}) => proximo({ repo, ciclo: CICLO, entrada: { agora: ISO(AGORA), ...entrada } });
  return { raiz, principal, anterior, herdeira, g, posse, entrarEmPassagem, passarPosse, px };
}

function recusa(fn, codigo) {
  assert.throws(fn, (e) => e instanceof ErroPlano && e.codigo === codigo, `esperada recusa ${codigo}`);
}

test("sem confirmação e época parada a anterior segue dona", (t) => {
  const a = ambiente(t);
  const em = a.entrarEmPassagem();
  assert.equal(em.acao, "em-passagem");
  assert.equal(lerMarcas(a.anterior).at(-1).ramo, RAMO, "a marca de passagem leva o ramo");

  // A anterior cria a herdeira, que traz o ramo e não chega a tomar a posse.
  const criar = a.px(a.anterior, { sessaoMaestra: "session_anterior" });
  assert.equal(criar.acao, "criar-condutora", JSON.stringify(criar));
  assert.equal(criar.nome, `${CICLO} · F1 · 2`);
  recusa(() => trazerRamo({ repo: a.herdeira, ciclo: CICLO, ...criar.trazer, nonce: "0".repeat(16) }), "trazer-ramo-recusado");
  const trazido = trazerRamo({ repo: a.herdeira, ciclo: CICLO, ...criar.trazer });
  assert.equal(trazido.ponta, em.sha, "a herdeira confere a árvore na ponta do ramo");
  assert.equal(a.px(a.herdeira).acao, "passar-posse");

  // Prazo vencido com a época parada: a posse nunca saiu da anterior, que retoma.
  const herdeira = { sessao: "session_h1", estado: "idle", criadaEm: ISO(AGORA - (PRAZO + 5) * 60) };
  const r = a.px(a.anterior, { herdeira });
  assert.equal(r.acao, "retomar-da-passagem", JSON.stringify(r));
  assert.equal(r.arquivar, "session_h1");
  const feito = retomarDaPassagem({ repo: a.anterior, ciclo: CICLO, nonce: r.nonce, entrada: { agora: ISO(AGORA), herdeira } });
  assert.equal(feito.acao, "passagem-retomada");
  assert.equal(feito.arquivar, "session_h1", "a anterior arquiva a herdeira; nunca a reabre");
  assert.equal(a.g(a.anterior, "symbolic-ref", "--short", "HEAD"), RAMO, "a anterior reanexou o ramo");
  assert.throws(() => a.g(a.herdeira, "symbolic-ref", "-q", "HEAD"), "a árvore da herdeira ficou destacada");
  assert.equal(a.g(a.anterior, "log", "-1", "--format=%s"), "Conducao: F1 passagem desistida");
  assert.equal(passagemAberta(lerMarcas(a.anterior)), null, "fora de \"em passagem\"");
  assert.equal(a.posse.get(a.anterior).epoca, 1, "a posse e a época não se mexeram");

  // Tenta uma vez mais: nova nota, nova herdeira (tentativa 2).
  const em2 = a.entrarEmPassagem();
  assert.match(em2.nota, /passagem-F1-2\.md$/);
  const criar2 = a.px(a.anterior);
  assert.deepEqual([criar2.acao, criar2.tentativa], ["criar-condutora", 2]);
  // Segunda falha (a herdeira arquivada antes de confirmar): pergunta ao operador.
  const p = a.px(a.anterior, { herdeira: { sessao: "session_h2", estado: "archived", criadaEm: ISO(AGORA - 60) } });
  assert.deepEqual([p.acao, p.motivo, p.tentativas], ["perguntar", "passagem-sem-confirmacao", 2]);
});

/** A anterior em passagem com a herdeira vencida: o `proximo` dela emite `retomar-da-passagem` (achado 4 da T28). */
function herdeiraVencida(t) {
  const a = ambiente(t);
  a.entrarEmPassagem();
  const criar = a.px(a.anterior, { sessaoMaestra: "session_anterior" });
  trazerRamo({ repo: a.herdeira, ciclo: CICLO, ...criar.trazer });
  const herdeira = { sessao: "session_h1", estado: "idle", criadaEm: ISO(AGORA - (PRAZO + 5) * 60) };
  const entrada = { agora: ISO(AGORA), herdeira };
  const r = a.px(a.anterior, { herdeira });
  assert.equal(r.acao, "retomar-da-passagem", JSON.stringify(r));
  return { a, criar, entrada, r };
}

test("retomar-da-passagem com a entrada do proximo grava a desistência", (t) => {
  const { a, criar, entrada, r } = herdeiraVencida(t);
  // A ação emitida diz que o verbo leva a mesma entrada do proximo, e qual campo muda a ação.
  assert.match(r.comando, /^retomar-da-passagem --nonce [0-9a-f]{16} --entrada <a mesma deste proximo>/);
  assert.match(r.comando, /herdeira/);
  // A condutora da T28 chamou o verbo com uma entrada sem `herdeira`: o proximo interno devolvia
  // `criar-condutora` com o nonce da primeira tentativa. A recusa diz isso e nomeia o campo.
  assert.throws(
    () => retomarDaPassagem({ repo: a.anterior, ciclo: CICLO, nonce: r.nonce, entrada: { agora: entrada.agora } }),
    (e) =>
      e instanceof ErroPlano &&
      e.codigo === "retomar-da-passagem-recusado" &&
      e.message.includes(`criar-condutora`) &&
      e.message.includes(criar.nonce) &&
      /a mesma --entrada do proximo/.test(e.message) &&
      /herdeira/.test(e.message),
  );
  assert.equal(passagemAberta(lerMarcas(a.anterior))?.fase, "F1", "a recusa não grava nada");
  // Com a mesma entrada do proximo, o verbo aceita a própria ação e grava a desistência.
  const feito = retomarDaPassagem({ repo: a.anterior, ciclo: CICLO, nonce: r.nonce, entrada });
  assert.deepEqual([feito.acao, feito.arquivar], ["passagem-retomada", "session_h1"]);
  assert.equal(a.g(a.anterior, "log", "-1", "--format=%s"), "Conducao: F1 passagem desistida");
  assert.equal(passagemAberta(lerMarcas(a.anterior)), null);
});

test("verbo da passagem sem a entrada do proximo recusa nomeando a entrada", (t) => {
  const { a, r } = herdeiraVencida(t);
  const semEntrada = (e) => e instanceof ErroPlano && e.codigo === "sem-entrada" && /--entrada/.test(e.message) && /a mesma do proximo/.test(e.message);
  assert.throws(() => retomarDaPassagem({ repo: a.anterior, ciclo: CICLO, nonce: r.nonce }), (e) => semEntrada(e) && /herdeira/.test(e.message));
  assert.throws(() => confirmarPassagem({ repo: a.herdeira, ciclo: CICLO, nonce: r.nonce }), (e) => semEntrada(e) && /inscrita/.test(e.message));
  assert.throws(() => desmontarAnterior({ repo: a.herdeira, ciclo: CICLO, nonce: r.nonce, arquivadas: path.join(a.raiz, "lista.txt") }), (e) => semEntrada(e) && /anterior/.test(e.message));
  assert.throws(() => desanexarRamo({ repo: a.anterior, ciclo: CICLO, nonce: r.nonce }), semEntrada);
  // Nada andou: a anterior segue em passagem, destacada.
  assert.equal(passagemAberta(lerMarcas(a.anterior))?.fase, "F1");
  assert.throws(() => a.g(a.anterior, "symbolic-ref", "-q", "HEAD"));
});

/**
 * A corrida do achado ALTO da T29 (D-VEGA37-58): a posse muda de árvore entre o
 * `proximo` que o verbo refaz e o `switch` do ramo. O leitor responde como antes
 * pelas leituras do `proximo` e, a partir da seguinte, devolve `depois`.
 */
function posseMudaDepoisDoProximo(a, entrada, depois) {
  let leituras = 0;
  const contar = trocarLeitorDaPosse((repo) => {
    leituras += 1;
    return a.posse.get(real(repo)) ?? { estado: "outra", motivo: "fora da troca" };
  });
  a.px(a.anterior, entrada);
  const doProximo = leituras;
  trocarLeitorDaPosse(contar);
  let n = 0;
  const antes = trocarLeitorDaPosse((repo) => {
    n += 1;
    if (n > doProximo && real(repo) === a.anterior) return depois;
    return a.posse.get(real(repo)) ?? { estado: "outra", motivo: "fora da troca" };
  });
  return () => trocarLeitorDaPosse(antes);
}

test("retomar-da-passagem confere a posse antes de trocar o ramo", (t) => {
  for (const [depois, codigo] of [
    [{ estado: "outra", ciclo: CICLO, motivo: "outra árvore" }, "posse-alheia"],
    [{ estado: "nao-li", motivo: "banco fora" }, "posse-ilegivel"],
  ]) {
    const { a, entrada, r } = herdeiraVencida(t);
    const pontaAntes = a.g(a.anterior, "rev-parse", `refs/heads/${RAMO}`);
    const voltar = posseMudaDepoisDoProximo(a, entrada, depois);
    try {
      assert.throws(
        () => retomarDaPassagem({ repo: a.anterior, ciclo: CICLO, nonce: r.nonce, entrada }),
        (e) => e instanceof ErroPlano && e.codigo === codigo,
        `esperada recusa ${codigo}`,
      );
    } finally {
      voltar();
    }
    // Nenhum ramo trocou de árvore: segue anexado na herdeira, e a anterior segue destacada.
    assert.equal(a.g(a.herdeira, "symbolic-ref", "--short", "HEAD"), RAMO, `${codigo}: o ramo segue na árvore da herdeira`);
    assert.throws(() => a.g(a.anterior, "symbolic-ref", "-q", "HEAD"), `${codigo}: a anterior segue destacada`);
    assert.equal(a.g(a.anterior, "rev-parse", `refs/heads/${RAMO}`), pontaAntes, `${codigo}: o ramo não andou`);
    assert.equal(passagemAberta(lerMarcas(a.anterior))?.fase, "F1", `${codigo}: nada se gravou`);
  }
});

test("herdeira desmonta a árvore limpa da anterior arquivada", (t) => {
  const a = ambiente(t);
  const em = a.entrarEmPassagem();
  const criar = a.px(a.anterior, { sessaoMaestra: "session_anterior" });
  trazerRamo({ repo: a.herdeira, ciclo: CICLO, ...criar.trazer });
  const pp = a.px(a.herdeira);
  assert.deepEqual([pp.acao, pp.lock_id, pp.epoca], ["passar-posse", LOCK1, 1]);
  a.passarPosse();

  // A anterior destituída solta a inscrição; a herdeira se inscreve e confirma.
  const viva = { sessao: "session_herdeira", estado: "idle", criadaEm: ISO(AGORA - 60) };
  assert.equal(a.px(a.anterior, { inscrita: true, herdeira: viva }).acao, "soltar-inscricao");
  assert.equal(a.px(a.herdeira).acao, "inscrever-na-proposta");
  const c = a.px(a.herdeira, { inscrita: true });
  assert.equal(c.acao, "confirmar-passagem", JSON.stringify(c));
  assert.equal(c.arvoreDaAnterior, a.anterior, "o caminho sai de git worktree list, nunca da nota");
  const conf = confirmarPassagem({ repo: a.herdeira, ciclo: CICLO, nonce: c.nonce, entrada: { agora: ISO(AGORA), inscrita: true } });
  assert.equal(conf.acao, "passagem-confirmada");
  assert.equal(conf.arvoreSuja, undefined);
  const marca = lerMarcas(a.herdeira).at(-1);
  assert.deepEqual([marca.tipo, marca.confirma, marca.epoca], ["confirmada", em.sha, "2"]);

  // A anterior não espera a confirmação: para (D19a).
  assert.equal(a.px(a.anterior, { herdeira: viva, sessaoMaestra: "session_anterior" }).motivo, "passagem-entregue");

  // Anterior ainda viva: a herdeira a arquiva antes de desmontar (D19a).
  const segue = a.px(a.herdeira, { inscrita: true, anterior: { sessao: "session_anterior", estado: "idle" } });
  assert.deepEqual([segue.acao, segue.sessao], ["arquivar-anterior", "session_anterior"]);
  assert.ok(existsSync(a.anterior));

  // Arquivada, mas com nota sensível ignorada (o `worktree remove` a apagaria calado): pergunta.
  const arquivada = { inscrita: true, anterior: { sessao: "session_anterior", estado: "ARCHIVED" } };
  const sensivel = path.join(a.anterior, PASTA, "notes", "sensivel", "captura.md");
  mkdirSync(path.dirname(sensivel), { recursive: true });
  writeFileSync(sensivel, "captura\n");
  assert.equal(a.g(a.anterior, "status", "--porcelain"), "", "a nota sensível é ignorada pelo status comum");
  assert.equal(a.px(a.herdeira, arquivada).motivo, "arvore-da-anterior-suja");
  rmSync(path.dirname(sensivel), { recursive: true });
  // Arquivo solto também suja.
  writeFileSync(path.join(a.anterior, "solto.txt"), "x\n");
  assert.equal(a.px(a.herdeira, arquivada).motivo, "arvore-da-anterior-suja");
  rmSync(path.join(a.anterior, "solto.txt"));

  // Limpa e arquivada: o último passo da ordem.
  const d = a.px(a.herdeira, arquivada);
  assert.deepEqual([d.acao, d.caminho, d.nome], ["desmontar-anterior", a.anterior, "bridge-cse_anterior"], JSON.stringify(d));
  const lista = path.join(a.raiz, "state", "limpeza-arquivadas.txt");
  recusa(() => desmontarAnterior({ repo: a.herdeira, ciclo: CICLO, nonce: d.nonce, entrada: { agora: ISO(AGORA), ...arquivada } }), "uso");
  const feito = desmontarAnterior({ repo: a.herdeira, ciclo: CICLO, nonce: d.nonce, entrada: { agora: ISO(AGORA), ...arquivada }, arquivadas: lista });
  assert.equal(feito.acao, "anterior-desmontada");
  assert.equal(existsSync(a.anterior), false, "a árvore da anterior saiu");
  assert.ok(!a.g(a.principal, "worktree", "list", "--porcelain").includes(a.anterior), "e saiu do registro de worktrees");
  assert.deepEqual(readFileSync(lista, "utf8").split("\n").filter(Boolean), ["bridge-cse_anterior"], "o nome entra na lista de arquivadas da limpeza");
  // Desmontada, nada mais a desmontar: o resumo não acha a árvore.
  assert.equal(resumoDaPassagem(a.herdeira, CICLO, lerMarcas(a.herdeira)).arvoreDaAnterior, null);
  assert.notEqual(a.px(a.herdeira, arquivada).acao, "desmontar-anterior");
});

test("árvore da anterior suja na confirmação fica registrada e nunca se apaga", (t) => {
  const a = ambiente(t);
  a.entrarEmPassagem();
  const criar = a.px(a.anterior);
  trazerRamo({ repo: a.herdeira, ciclo: CICLO, ...criar.trazer });
  a.passarPosse();
  writeFileSync(path.join(a.anterior, "rascunho.txt"), "em curso\n");
  const c = a.px(a.herdeira, { inscrita: true });
  assert.equal(c.arvoreSuja, true);
  const conf = confirmarPassagem({ repo: a.herdeira, ciclo: CICLO, nonce: c.nonce, entrada: { agora: ISO(AGORA), inscrita: true } });
  assert.deepEqual([conf.arvoreSuja, conf.avisar], [a.anterior, "operador"]);
  assert.equal(lerMarcas(a.herdeira).at(-1).arvoreSuja, a.anterior, "a pasta vai no commit de confirmação");
  // Mesmo arquivada e depois limpa, o desmonte não volta sozinho: o operador decide.
  rmSync(path.join(a.anterior, "rascunho.txt"));
  const p = a.px(a.herdeira, { inscrita: true, anterior: { estado: "ARCHIVED" } });
  assert.notEqual(p.acao, "desmontar-anterior");
  assert.ok(existsSync(a.anterior));
});
