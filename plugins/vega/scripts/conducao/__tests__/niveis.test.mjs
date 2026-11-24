/**
 * niveis.test.mjs — a condução em 2 ou 3 níveis (hotfix vega-conducao-niveis).
 *
 * Nível 1, puro: a conta da cadeia de sessões (o `lineage` do `get_session`), a
 * recomendação da pergunta dos níveis, o `criar-condutora` que vira
 * `pedir-herdeira` em 3 níveis (o da passagem e o `criar` do `fechar-ciclo`), o
 * teto da linhagem em 2 níveis, e a decisão da maestra (criar, passar a si mesma,
 * última maestra, teto).
 *
 * Nível 2, git de verdade numa pasta temporária (origin bare, hooks desligados,
 * leitor da posse trocado por `sem-posse`): a marca `niveis` e a leitura dela, a
 * pergunta dos níveis antes de começar, e o pedido de herdeira ida e volta pelo
 * origin, idempotente no mesmo nonce.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BOTOES } from "../botoes.mjs";
import { escolhaDaHerdeira, lerNiveis, maestra, nonce, proximo, textoDaHerdeira } from "../conducao.mjs";
import { gravarAtendido, gravarPedido, lerAtendido, lerPedido, registrarNiveis, trocarLeitorDaPosse } from "../git-conducao.mjs";
import { lerMarcas, niveisDasMarcas } from "../marcas.mjs";
import {
  comNiveis,
  condutorasEmDoisNiveis,
  decidirMaestra,
  maestrasEmTresNiveis,
  parDeInteiros,
  opcoesDaHerdeira,
  PONTEIRO_DA_HERDEIRA,
} from "../niveis.mjs";
import { perguntar } from "../pergunta.mjs";
import { regraPassagem } from "../regras.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const CICLO = "TESTE-90-niveis";
const RAMO = "ciclo-teste";
const HEAD = "h".repeat(40);
const RAIZ = "/plugin";

// ── nível 1: a conta da cadeia ───────────────────────────────────────────────

test("a cadeia: 2 níveis gasta um elo por passagem, 3 níveis só por passagem de maestra", () => {
  // Limite 8 medido em 20/11/2026. Sessão do operador em 0.
  assert.equal(condutorasEmDoisNiveis({ depth: 0, limit: 8 }), 8);
  // A condutora da maestra-mãe nasce em 1: a mesma conta de 2 níveis a partir de 1.
  assert.equal(condutorasEmDoisNiveis({ depth: 1, limit: 8 }), 7);
  assert.equal(condutorasEmDoisNiveis({ depth: 0, limit: 8, propria: false }), 7);
  // Maestra em m serve se a operária couber: m+2 ≤ 8 ⇒ m ∈ 0..6, 7 maestras, 6 passagens.
  assert.equal(maestrasEmTresNiveis({ depth: 0, limit: 8 }), 7);
  assert.equal(maestrasEmTresNiveis({ depth: 6, limit: 8 }), 1);
  assert.equal(maestrasEmTresNiveis({ depth: 7, limit: 8 }), 0);
  assert.deepEqual(parDeInteiros("1/8"), [1, 8]);
  assert.equal(parDeInteiros("1/x"), null);
});


// ── nível 1: o criar-condutora em 3 níveis e em 2 ───────────────────────────

const PLANO = { fases: [{ id: "F1", modelo: "opus", tasks: [] }, { id: "F2", modelo: "sonnet", tasks: [] }] };
const MARCA = Object.freeze({ tipo: "passagem", sha: "a".repeat(40), fase: "F1", epoca: "1", lock: "lock", ramo: RAMO, nota: "n.md" });

function criarDaPassagem(entrada = {}) {
  const fabrica = (tipo, alvo, tentativa, campos) => ({ acao: tipo, nonce: nonce(CICLO, alvo, tentativa, MARCA.sha), ciclo: CICLO, head: MARCA.sha, ...campos });
  return regraPassagem({
    ciclo: CICLO,
    acao: fabrica,
    nonce,
    plano: PLANO,
    encerradas: new Set(["F1"]),
    entrada,
    temCi: true,
    agora: 0,
    epoch: (v) => v,
    estadoDaFilha: (e) => e,
    prazoConfirmacaoMin: BOTOES.prazoConfirmacaoPassagemMin,
    textoDaHerdeira,
    passagem: { aberta: MARCA, ultima: MARCA, posse: { estado: "dona", epoca: 1 }, anexado: false, falhas: new Map(), noMeio: new Map(), confirmadas: new Set() },
  });
}

test("3 níveis: o criar-condutora da passagem vira pedir-herdeira com o mesmo nonce", () => {
  const entrada = { sessaoMaestra: "session_condutora", maestra: "session_maestra" };
  const criar = criarDaPassagem(entrada);
  assert.equal(criar.acao, "criar-condutora");
  const pedir = comNiveis(criar, { niveis: 3, entrada, perguntar });
  assert.equal(pedir.acao, "pedir-herdeira");
  // O trazer-ramo da herdeira confere este nonce: ele não muda.
  assert.equal(pedir.nonce, criar.nonce);
  assert.equal(pedir.trazer.nonce, criar.trazer.nonce);
  assert.deepEqual([pedir.tipo, pedir.maestra, pedir.de, pedir.fase], ["herdeira", "session_maestra", "session_condutora", "F2"]);
  assert.equal(pedir.mensagem, `PASSAR F2 ${criar.nonce}`);
  assert.match(pedir.comando, new RegExp(`^pedir-herdeira --nonce ${criar.nonce} --entrada`));
  // 2 níveis: passa como veio.
  assert.deepEqual(comNiveis(criar, { niveis: 2, entrada, perguntar }), criar);
});

test("3 níveis sem a maestra na entrada: a pergunta maestra-ausente, sem pedido", () => {
  const criar = criarDaPassagem({ sessaoMaestra: "session_condutora" });
  const p = comNiveis(criar, { niveis: 3, entrada: { sessaoMaestra: "session_condutora" }, perguntar });
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "maestra-ausente");
});

test("3 níveis: o criar do fechar-ciclo vira pedido de fechamento", () => {
  const fechar = {
    acao: "fechar-ciclo",
    nonce: "1".repeat(16),
    ciclo: CICLO,
    head: HEAD,
    fase: "ciclo",
    criar: { acao: "criar-condutora", nonce: "2".repeat(16), ciclo: CICLO, head: HEAD, fase: "fechamento", nome: `${CICLO} · fechamento`, modelo: null, sessaoLimpa: true, texto: "x" },
  };
  const r = comNiveis(fechar, { niveis: 3, entrada: { maestra: "session_maestra" }, perguntar });
  assert.equal(r.acao, "fechar-ciclo");
  assert.equal(r.criar.acao, "pedir-herdeira");
  assert.equal(r.criar.tipo, "fechamento");
  assert.equal(r.criar.mensagem, `PASSAR fechamento ${"2".repeat(16)}`);
});

test("2 níveis com a linhagem: a herdeira que não abriria operária vira teto-de-linhagem", () => {
  const criar = criarDaPassagem({});
  const ok = comNiveis(criar, { niveis: 2, entrada: { linhagem: { depth: 5, limit: 8 } }, perguntar });
  assert.equal(ok.acao, "criar-condutora");
  assert.deepEqual([ok.linhagem.herdeiraEm, ok.linhagem.passagensDepois], [6, 1]);
  const ultima = comNiveis(criar, { niveis: 2, entrada: { linhagem: { depth: 6, limit: 8 } }, perguntar });
  assert.equal(ultima.acao, "criar-condutora");
  assert.equal(ultima.linhagem.passagensDepois, 0);
  const teto = comNiveis(criar, { niveis: 2, entrada: { linhagem: { depth: 7, limit: 8 } }, perguntar });
  assert.equal(teto.acao, "perguntar");
  assert.equal(teto.motivo, "teto-de-linhagem");
});

// ── nível 1: a maestra ───────────────────────────────────────────────────────

const PEDIDO = { tipo: "herdeira", fase: "F2", nome: `${CICLO} · F2`, modelo: "sonnet", texto: "Conduzir…", de: "session_condutora" };
const maestraCom = (extra) => decidirMaestra({ ciclo: CICLO, sessao: "session_maestra", criar: PEDIDO, nonce: "3".repeat(16), raiz: RAIZ, perguntar: (o) => perguntar({ head: HEAD, ...o }), ...extra });

test("maestra: cria a condutora pedida e responde à pedinte", () => {
  const r = maestraCom({ linhagem: { depth: 0, limit: 8 }, contexto: { usados: 100_000, max: 1_000_000 } });
  assert.equal(r.acao, "criar-condutora");
  assert.deepEqual([r.nome, r.modelo, r.fase], [PEDIDO.nome, "sonnet", "F2"]);
  assert.deepEqual(r.responder, { para: "session_condutora", mensagem: `HERDEIRA <sessão criada> ${"3".repeat(16)} session_maestra` });
  assert.equal(r.atender, `maestra-atendeu --ciclo ${CICLO} --nonce ${"3".repeat(16)} --sessao-criada <sessão criada>`);
  assert.match(r.texto, /a maestra deste ciclo é session_maestra/);
  assert.deepEqual([r.linhagem.condutoraEm, r.linhagem.operariaEm, r.linhagem.passagensDeMaestraRestantes], [1, 2, 6]);
});

test("maestra: passada do corte com cadeia livre, pergunta a herdeira ao operador; com o sim, passa o comando (D13a)", () => {
  const corte = { linhagem: { depth: 2, limit: 8 }, contexto: { usados: 400_000, max: 1_000_000 }, ordinal: 3, registro: [{ sessao: "session_c1", fase: "F1" }] };
  const p = maestraCom(corte);
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "herdeira-da-maestra");
  assert.deepEqual(p.opcoes.map((o) => o.id), ["a", "b", "c"]);
  assert.match(p.opcoes[0].texto, /maestra 4 /);
  assert.equal(maestraCom({ ...corte, herdeira: { pergunta: "p-0000000000000001", escolha: null, aviso: "registro fora" } }).motivo, "herdeira-da-maestra");
  const nao = maestraCom({ ...corte, herdeira: { pergunta: "p-0000000000000001", escolha: "nao" } });
  assert.equal(nao.acao, "criar-condutora");
  assert.match(nao.aviso, /disse não/);
  const sempre = maestraCom({ ...corte, herdeira: { pergunta: "p-00000000000000aa", escolha: "sempre" } });
  assert.match(sempre.texto, /--herdeira p-00000000000000aa/);
  const r = maestraCom({ ...corte, herdeira: { pergunta: "p-0000000000000001", escolha: "sim" } });
  assert.doesNotMatch(r.texto, /--herdeira/);
  assert.equal(r.acao, "passar-maestra");
  assert.equal(r.nome, `${CICLO} · maestra · 4`);
  assert.match(r.texto, new RegExp(`--ordinal 4 --nonce ${"3".repeat(16)} --anterior session_maestra`));
  assert.match(r.texto, /archive_session da maestra anterior session_maestra/);
  assert.match(r.texto, /session_c1/);
});

test("maestra: passada do corte sem lugar para outra maestra, segue como a última", () => {
  const r = maestraCom({ linhagem: { depth: 6, limit: 8 }, contexto: { usados: 450_000, max: 1_000_000 } });
  assert.equal(r.acao, "criar-condutora");
  assert.equal(r.ultimaMaestra, true);
  assert.match(r.aviso, /não comporta outra maestra/);
});

test("maestra: no teto da cadeia, e sem linhagem, pergunta", () => {
  assert.equal(maestraCom({ linhagem: { depth: 7, limit: 8 }, contexto: { usados: 1, max: 10 } }).motivo, "teto-de-linhagem");
  assert.equal(maestraCom({ linhagem: null, contexto: null }).motivo, "linhagem-ausente");
});

test("maestra: a primeira condutora nunca dispara a passagem da maestra", () => {
  const r = decidirMaestra({ ciclo: CICLO, sessao: "s", criar: { ...PEDIDO, primeira: true, tipo: "primeira", de: undefined }, nonce: "4".repeat(16), linhagem: { depth: 0, limit: 8 }, contexto: { usados: 900, max: 1000 }, raiz: RAIZ, perguntar });
  assert.equal(r.acao, "criar-condutora");
  assert.equal(r.responder, null);
});

// ── nível 2: git ─────────────────────────────────────────────────────────────

function task(id, fase) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE90-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    "- **Steps:** faz",
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

const CANONICO = [
  "---",
  `cycle: ${CICLO}`,
  "opened: 2026-11-20",
  "---",
  "",
  "## 3. Tasks",
  "",
  "### F1 — fase um (**Modelo:** opus)",
  "",
  task("T1", "F1"),
  "### F2 — fase dois (**Modelo:** sonnet)",
  "",
  task("T2", "F2"),
  "## 4. Pronto",
  "",
].join("\n");

function novoRepo(t) {
  const dir = pastaTemporaria("niveis-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const origin = path.join(dir, "origin.git");
  const repo = path.join(dir, "arvore");
  const g = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["init", "-q", "-b", RAMO, repo]);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g(repo, "config", k, v);
  g(repo, "remote", "add", "origin", origin);
  const caminho = path.join(repo, `.agents/ciclo/teste/${CICLO}`);
  mkdirSync(caminho, { recursive: true });
  writeFileSync(path.join(caminho, "canonico.md"), CANONICO);
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", "base");
  g(repo, "push", "-q", "origin", RAMO);
  const antes = trocarLeitorDaPosse(() => ({ estado: "sem-posse" }));
  t.after(() => trocarLeitorDaPosse(antes));
  return { repo, g: (...a) => g(repo, ...a) };
}

test("a marca niveis: sem ela e sem autorização, 3 (padrão, D10c do L4); gravada, vale a última", (t) => {
  const { repo } = novoRepo(t);
  assert.deepEqual(niveisDasMarcas(lerMarcas(repo)), { niveis: 3, origem: "padrao", sha: null });
  const r = registrarNiveis({ repo, ciclo: CICLO, niveis: 3, sim: "três níveis, ciclo longo" });
  assert.equal(r.niveis, 3);
  assert.deepEqual([niveisDasMarcas(lerMarcas(repo)).niveis, niveisDasMarcas(lerMarcas(repo)).origem], [3, "marca"]);
  registrarNiveis({ repo, ciclo: CICLO, niveis: 2, sim: "volta a dois" });
  assert.equal(niveisDasMarcas(lerMarcas(repo)).niveis, 2);
  assert.throws(() => registrarNiveis({ repo, ciclo: CICLO, niveis: 4, sim: "x" }), /2 ou 3/);
  assert.throws(() => registrarNiveis({ repo, ciclo: CICLO, niveis: 3, sim: "  " }), /--sim/);
});

test("ciclo já autorizado sem a marca roda em 2 níveis (legado), sem perguntar", () => {
  assert.deepEqual(niveisDasMarcas([{ tipo: "autorizada", sha: "x", fase: "F1" }]), { niveis: 2, origem: "legado", sha: null });
});

test("lerNiveis: nunca pergunta; sem marca, 3 (padrão); a marca antiga ainda vale", (t) => {
  const { repo } = novoRepo(t);
  assert.deepEqual(lerNiveis({ repo, ciclo: CICLO, linhagem: "0/8" }), { acao: "niveis", ciclo: CICLO, niveis: 3, origem: "padrao", sha: null });
  registrarNiveis({ repo, ciclo: CICLO, niveis: 2, sim: "dois" });
  assert.deepEqual([lerNiveis({ repo, ciclo: CICLO }).niveis, lerNiveis({ repo, ciclo: CICLO }).origem], [2, "marca"]);
});

test("o pedido de herdeira vai e volta pelo origin, preso ao HEAD, idempotente no mesmo nonce", (t) => {
  const { repo, g } = novoRepo(t);
  const n = "5".repeat(16);
  const pedido = { acao: "pedir-herdeira", tipo: "herdeira", fase: "F2", nome: `${CICLO} · F2`, modelo: "sonnet", texto: "Conduzir…", de: "session_condutora", mensagem: "não viaja" };
  const r = gravarPedido({ repo, ciclo: CICLO, nonce: n, pedido });
  assert.equal(r.acao, "pedido-gravado");
  assert.equal(r.base, g("rev-parse", "HEAD"));
  const lido = lerPedido({ repo, ciclo: CICLO, nonce: n });
  assert.equal(lido.acao, "pedido");
  assert.equal(lido.base, r.base);
  assert.deepEqual([lido.pedido.texto, lido.pedido.modelo, lido.pedido.de, lido.pedido.mensagem], ["Conduzir…", "sonnet", "session_condutora", undefined]);
  // A busca local não fica.
  assert.equal(g("for-each-ref", "refs/conducao-busca/"), "");
  // O mesmo pedido de novo: repetição inofensiva.
  assert.equal(gravarPedido({ repo, ciclo: CICLO, nonce: n, pedido }).acao, "ja-pedido");
  // Outro pedido com o mesmo nonce: gate.
  assert.equal(gravarPedido({ repo, ciclo: CICLO, nonce: n, pedido: { ...pedido, texto: "outro" } }).motivo, "pedido-recusado-no-origin");
  // Nonce sem pedido.
  assert.equal(lerPedido({ repo, ciclo: CICLO, nonce: "6".repeat(16) }).motivo, "pedido-ausente");
});

// ── os casos que a revisão do hotfix levantou ────────────────────────────────

test("3 níveis sem o id da condutora no pedido: pedinte-ausente, porque a maestra não teria a quem responder", () => {
  const criar = criarDaPassagem({});
  const p = comNiveis(criar, { niveis: 3, entrada: { maestra: "session_maestra" }, perguntar });
  assert.equal(p.motivo, "pedinte-ausente");
  // O de fechamento não responde a ninguém: segue sem o id.
  const fechar = { acao: "fechar-ciclo", nonce: "1".repeat(16), ciclo: CICLO, head: HEAD, criar: { acao: "criar-condutora", nonce: "2".repeat(16), ciclo: CICLO, head: HEAD, fase: "fechamento", sessaoLimpa: true, texto: "x" } };
  assert.equal(comNiveis(fechar, { niveis: 3, entrada: { maestra: "m" }, perguntar }).criar.acao, "pedir-herdeira");
});

test("2 níveis: o teto da linhagem vale também no criar do fechar-ciclo", () => {
  const fechar = { acao: "fechar-ciclo", nonce: "1".repeat(16), ciclo: CICLO, head: HEAD, criar: { acao: "criar-condutora", nonce: "2".repeat(16), ciclo: CICLO, head: HEAD, fase: "fechamento", sessaoLimpa: true, texto: "x" } };
  assert.equal(comNiveis(fechar, { niveis: 2, entrada: { linhagem: { depth: 7, limit: 8 } }, perguntar }).motivo, "teto-de-linhagem");
});

test("maestra: contexto ilegível pergunta, e a borda depth+3 = limit ainda passa", () => {
  assert.equal(maestraCom({ linhagem: { depth: 0, limit: 8 }, contexto: null }).motivo, "contexto-ausente");
  assert.equal(maestraCom({ linhagem: { depth: 5, limit: 8 }, contexto: { usados: 400_000, max: 1_000_000 }, herdeira: { escolha: "sim" } }).acao, "passar-maestra");
  assert.equal(maestraCom({ linhagem: { depth: 6, limit: 8 }, contexto: { usados: 400_000, max: 1_000_000 } }).ultimaMaestra, true);
});

test("maestra: pedido sem pedinte pergunta; pedido já atendido só responde de novo, sem outra condutora", () => {
  assert.equal(maestraCom({ criar: { ...PEDIDO, de: undefined }, linhagem: { depth: 0, limit: 8 }, contexto: { usados: 1, max: 10 } }).motivo, "pedido-sem-pedinte");
  const r = maestraCom({ linhagem: { depth: 0, limit: 8 }, contexto: { usados: 1, max: 10 }, atendido: { sessao: "session_criada" } });
  assert.equal(r.acao, "responder-de-novo");
  assert.deepEqual(r.responder, { para: "session_condutora", mensagem: `HERDEIRA session_criada ${"3".repeat(16)} session_maestra` });
});

test("proximo: sem a marca, com ou sem a linhagem, não pergunta os níveis: segue para a autorização", (t) => {
  const { repo } = novoRepo(t);
  assert.equal(proximo({ repo, ciclo: CICLO, entrada: { linhagem: { depth: 0, limit: 8 } } }).motivo, "autorizar-ciclo");
  assert.equal(proximo({ repo, ciclo: CICLO, entrada: {} }).motivo, "autorizar-ciclo");
});

test("o verbo maestra: só em 3 níveis; a primeira condutora pela fase do ramo; o pedido atendido não cria outra", (t) => {
  const { repo, g } = novoRepo(t);
  // A maestra acha o ramo pelo nome do ciclo, sem árvore.
  assert.throws(() => maestra({ repo, ciclo: CICLO, sessao: "s", linhagem: "0/8", contexto: "1/10" }), (e) => e.codigo === "ramo-do-ciclo-ausente");
  g("branch", "-m", `ciclo-${CICLO}`);
  const args = { repo, ciclo: CICLO, sessao: "session_maestra", linhagem: "0/8", contexto: "1/1000000" };
  // Sem marca vale 3; a marca antiga de 2 ainda tira a maestra.
  registrarNiveis({ repo, ciclo: CICLO, niveis: 2, sim: "dois" });
  assert.equal(maestra(args).motivo, "niveis-nao-tres");
  registrarNiveis({ repo, ciclo: CICLO, niveis: 3, sim: "três" });
  const primeira = maestra(args);
  assert.equal(primeira.acao, "criar-condutora");
  assert.deepEqual([primeira.fase, primeira.nome, primeira.modelo, primeira.responder, primeira.atender], ["F1", `${CICLO} · F1`, "opus", null, null]);
  assert.match(primeira.texto, /Conduzir TESTE-90-niveis — F1/);
  assert.throws(() => maestra({ ...args, ordinal: Number.NaN }), /--ordinal/);
  // O pedido de uma herdeira, gravado pela condutora, atendido uma vez.
  const n = "7".repeat(16);
  gravarPedido({ repo, ciclo: CICLO, nonce: n, pedido: PEDIDO });
  const criar = maestra({ ...args, nonce: n });
  assert.equal(criar.acao, "criar-condutora");
  assert.equal(lerAtendido({ repo, ciclo: CICLO, nonce: n }), null);
  assert.equal(gravarAtendido({ repo, ciclo: CICLO, nonce: n, sessao: "session_criada" }).acao, "atendido");
  assert.equal(gravarAtendido({ repo, ciclo: CICLO, nonce: n, sessao: "session_criada" }).acao, "ja-atendido");
  assert.equal(gravarAtendido({ repo, ciclo: CICLO, nonce: n, sessao: "session_outra" }).motivo, "atendido-por-outra");
  assert.throws(() => gravarAtendido({ repo, ciclo: CICLO, nonce: n, sessao: "<sessão criada>" }), /--sessao-criada/);
  assert.equal(maestra({ ...args, nonce: n }).acao, "responder-de-novo");
  assert.equal(maestra({ ...args, nonce: "8".repeat(16) }).motivo, "pedido-ausente");
  // Reservado e não atendido (a maestra caiu entre o create_session e o maestra-atendeu): gate, nunca outra.
  const m = "a".repeat(16);
  gravarPedido({ repo, ciclo: CICLO, nonce: m, pedido: PEDIDO });
  const reservada = maestra({ ...args, nonce: m });
  assert.equal(reservada.acao, "criar-condutora");
  assert.equal(reservada.reserva, `refs/conducao-brief/${CICLO}/reserva/${m}`);
  assert.equal(maestra({ ...args, nonce: m }).motivo, "pedido-em-atendimento");
  gravarAtendido({ repo, ciclo: CICLO, nonce: m, sessao: "session_achada" });
  assert.equal(maestra({ ...args, nonce: m }).acao, "responder-de-novo");
});

test("origin inalcançável não se lê como pedido ausente", (t) => {
  const { repo, g } = novoRepo(t);
  g("remote", "set-url", "origin", "/caminho/que/nao/existe.git");
  assert.equal(lerPedido({ repo, ciclo: CICLO, nonce: "9".repeat(16) }).motivo, "pedido-inalcancavel");
  assert.throws(() => lerAtendido({ repo, ciclo: CICLO, nonce: "9".repeat(16) }), (e) => e.codigo === "pedido-inalcancavel");
});

test("escolhaDaHerdeira: só o sim lido no registro passa; fora do ar, sem prova ou de outra passagem, pergunta de novo (D17b)", () => {
  const P = "p-00000000000000b1";
  const opcoes = (ordinal) => opcoesDaHerdeira(ordinal).map((o) => ({ letra: o.id, texto: o.texto }));
  const ab = (o = opcoes(3), extra = {}) => ({ pergunta_id: P, ciclo: CICLO, ponteiro: PONTEIRO_DA_HERDEIRA, itens: [{ numero: 1, opcoes: o }], ...extra });
  const ler = (r) => () => r;
  const com = (r, ordinal = 3) => escolhaDaHerdeira({ repo: RAIZ, ciclo: CICLO, pergunta_id: P, ordinal, ler: ler(r) });
  const humana = { origem: "digitado", abertura: ab() };
  assert.equal(com({ ...humana, escolhas: [{ numero: 1, letra: "a" }] }).escolha, "sim");
  assert.equal(com({ ...humana, escolhas: [{ numero: 1, letra: "a" }] }, 4).escolha, null);
  assert.equal(com({ ...humana, escolhas: [{ numero: 1, letra: "b" }] }, 9).escolha, "sempre");
  assert.equal(com({ ...humana, escolhas: [{ numero: 1, letra: "c" }] }).escolha, "nao");
  // Outra pergunta do ciclo respondida "b" (o "não, espera" de um autorizar) nunca vira "não pergunte mais".
  const autorizar = ab([{ letra: "a", texto: "sim, pode tocar" }, { letra: "b", texto: "não, espera" }], { ponteiro: "autorizar-ciclo:F1" });
  assert.equal(com({ origem: "digitado", abertura: autorizar, escolhas: [{ numero: 1, letra: "b" }] }).escolha, null);
  // Sem ponteiro, sem ciclo, sem abertura, com dois itens, ou o texto do b trocado: pergunta de novo.
  assert.equal(com({ ...humana, abertura: ab(opcoes(3), { ponteiro: null }), escolhas: [{ numero: 1, letra: "b" }] }).escolha, null);
  assert.equal(com({ ...humana, abertura: ab(opcoes(3), { ciclo: null }), escolhas: [{ numero: 1, letra: "b" }] }).escolha, null);
  assert.equal(com({ ...humana, abertura: null, escolhas: [{ numero: 1, letra: "b" }] }).escolha, null);
  assert.equal(com({ ...humana, abertura: { ...ab(), itens: [{ numero: 1, opcoes: opcoes(3) }, { numero: 2, opcoes: opcoes(3) }] }, escolhas: [{ numero: 1, letra: "b" }] }).escolha, null);
  assert.equal(com({ ...humana, abertura: ab(opcoes(3).map((o) => (o.letra === "b" ? { ...o, texto: "não" } : o))), escolhas: [{ numero: 1, letra: "b" }] }).escolha, null);
  assert.equal(com({ ...humana, escolhas: [{ numero: 1, letra: "a" }, { numero: 1, letra: "c" }] }).escolha, null);
  assert.equal(com({ sem_registro: true }).escolha, null);
  assert.match(com({ sem_registro: true }).aviso, /fora do ar/);
  assert.equal(com({ ...humana, origem: "agente", escolhas: [{ letra: "b" }] }).escolha, null);
  assert.equal(com({ ...humana, abertura: { ...ab(), ciclo: "OUTRO-1" }, escolhas: [{ letra: "b" }] }).escolha, null);
  assert.equal(escolhaDaHerdeira({ repo: RAIZ, ciclo: CICLO, pergunta_id: P, ordinal: 3, ler: () => { throw new Error("caiu"); } }).escolha, null);
  assert.equal(escolhaDaHerdeira({ repo: RAIZ, ciclo: CICLO, pergunta_id: "x", ordinal: 3, ler: ler(humana) }).escolha, null);
});
