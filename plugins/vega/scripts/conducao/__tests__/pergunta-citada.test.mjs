/**
 * pergunta-citada.test.mjs — a pergunta citada prova o sim deste ciclo e desta fase (VEGA-19 T30;
 * AC-VEGA19-1, AC-VEGA19-7; D-VEGA19-41, D-VEGA19-42, D-VEGA19-44, D-VEGA19-45).
 *
 * O `autorizar-ciclo --pergunta` e a herança só aceitam o sim que o operador deu numa pergunta
 * registrada DESTE ciclo e DESTA fase (convenção da D-VEGA19-44: `ponteiro` `autorizar-ciclo:F<n>`,
 * um item, a opção com o texto do `--sim`), respondida escolhendo essa opção, usada uma vez só.
 * Falha de carga do adaptador e banco fora nunca viram consentimento. O registro é o da Sistoli
 * (`estado/lib/pergunta.mjs`), com os eventos em memória; fora da fonte, os casos que pedem o
 * projeto pulam, com o motivo.
 * Sem código próprio de adaptador, a pergunta também se confere (T33, D-VEGA19-57): o embutido a lê
 * do registro do destino `git` (`pergunta-citada-git.test.mjs`); sem registro, recusa.
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as c from "../consentimento.mjs";
import { ErroPlano } from "../ler-plano.mjs";
import { autorizarCiclo, conferirPerguntaDaHeranca } from "../git-conducao.mjs";
import { ehDadoDeFixture, motivosParaPerguntar } from "../verbos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..", "..", "..", "..", "..");
const FIXTURE = path.join(AQUI, "fixtures", "projeto-de-teste", ".altair");
const LIB_PERGUNTA = path.join(RAIZ, ".claude", "scripts", "estado", "lib", "pergunta.mjs");
const NA_FONTE = existsSync(LIB_PERGUNTA);
const FORA = "fora da fonte: sem o registro de perguntas do projeto";
/**
 * Os testes que só valem na fonte entram numa suíte só, pulada inteira fora dela: `test(…, { skip })`
 * conta como teste não passado na bateria do corpo fora da fonte (`# pass` ≠ `# tests`), e a suíte
 * pulada não conta teste nenhum — a forma dos outros testes do corpo (`describe(…, { skip: fora })`).
 */
const NA_FONTE_TESTES = [];
const testeNaFonte = (nome, fn) => NA_FONTE_TESTES.push([nome, fn]);
const lib = NA_FONTE ? await import(pathToFileURL(LIB_PERGUNTA).href) : null;
const decisao = NA_FONTE ? await import(pathToFileURL(path.join(RAIZ, ".claude", "scripts", "estado", "lib", "decisao.mjs")).href) : null;

const CICLO = "X-1";
const SIM = "sim, pode tocar o ciclo inteiro";
const ABERTA = "2026-11-17T10:00:00.000Z";
const RESPONDIDA = "2026-11-17T10:05:00.000Z";

let seq = 0;
const novoId = () => `p-${(++seq).toString(16).padStart(16, "0")}`;

/**
 * Os eventos de uma pergunta do autorizar, na convenção (D-VEGA19-44), com a resposta `literal`
 * (`escolha`, a letra) e a autoria `digitado` cuja prova aponta a mensagem do operador no
 * transcript da sessão da abertura. `extra` muda a abertura (ciclo, ponteiro, itens).
 */
function perguntaDoAutorizar({ id = novoId(), fase = "F1", sim = SIM, literal = "a", escolha = "a", extra = {} } = {}) {
  const sessao = `sessao-${id}`;
  const comum = { pergunta_id: id, sessao, ciclo: CICLO, versao_esquema: 1, has_patient_data: false, item: "D1", titulo: "sim do ciclo" };
  const eventos = [
    {
      ...comum,
      evento: "abertura",
      carimbo: ABERTA,
      ponteiro: `autorizar-ciclo:${fase}`,
      assunto: "autorizar o ciclo",
      itens: [{ numero: 1, titulo: "sim do ciclo", opcoes: [{ letra: "a", texto: sim }, { letra: "b", texto: "não, espera" }] }],
      ...extra,
    },
    { ...comum, evento: "resposta", carimbo: RESPONDIDA, perguntado_em: ABERTA, resposta_literal: literal, escolha, origem_resposta: "agente" },
    { ...comum, evento: "autoria", carimbo: RESPONDIDA, origem_resposta: "digitado", prova: `transcript:/tmp/${sessao}.jsonl#u-${id}` },
  ];
  const transcript = [{ uuid: `u-${id}`, sessionId: sessao, type: "user", origin: { kind: "human" }, timestamp: RESPONDIDA, message: { content: literal } }];
  return { id, sessao, eventos, transcript };
}

/** O registro de teste sobre o `perguntaDoAutorizar` real do registro; `sem_registro` simula banco fora. */
function registro(perguntas, { sem_registro = false } = {}) {
  const eventos = perguntas.flatMap((p) => p.eventos);
  const transcripts = new Map(perguntas.map((p) => [`/tmp/${p.sessao}.jsonl`, p.transcript]));
  const ler = { eventos, achar: (s) => `/tmp/${s}.jsonl`, lerEntradas: (a) => transcripts.get(a) ?? null };
  return {
    origemEfetiva: (id) => ({ ...lib.origemEfetiva(id, ler), sem_registro }),
    perguntaDoAutorizar: (id) => ({ ...lib.perguntaDoAutorizar(id, ler), sem_registro }),
  };
}

function novoRepo(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "pergunta-citada-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  g("init", "-q", "-b", "main");
  g("commit", "-q", "--allow-empty", "-m", "raiz");
  /** A marca `autorizada` de `fase` com o sim no corpo e a pergunta no trailer. */
  const autorizada = (fase, sim, pergunta, herdada = null) => {
    const tr = ["Conducao-Plano: abc", "Conducao-Ciclo: sim", `Conducao-Pergunta: ${pergunta}`, ...(herdada ? [`Conducao-Herdada: ${herdada}`] : [])];
    g("commit", "-q", "--allow-empty", "-m", `Conducao: ${fase} autorizada`, "-m", sim, "-m", tr.join("\n"));
    return g("rev-parse", "HEAD");
  };
  return { dir, g, autorizada, head: () => g("rev-parse", "HEAD") };
}

const conferir = (r, reg, id, { fase = "F1", sim = SIM, ciclo = CICLO, marca = null } = {}) =>
  c.exigirPerguntaDoAutorizar({ repo: r.dir, perguntas: reg, pergunta_id: id, ciclo, fase, sim, marca });
const recusa = (codigo) => (e) => e instanceof ErroPlano && e.codigo === codigo;

// ── a pergunta do autorizar ─────────────────────────────────────────────────

testeNaFonte("pergunta deste ciclo e desta fase, respondida com a opção do sim, autoriza", (t) => {
  const r = novoRepo(t);
  const p = perguntaDoAutorizar();
  assert.equal(conferir(r, registro([p]), p.id), "digitado");
});

testeNaFonte("pergunta de outro ciclo ou de outra fase recusa", (t) => {
  const r = novoRepo(t);
  const outroCiclo = perguntaDoAutorizar({ extra: { ciclo: "Y-2" } });
  const outraFase = perguntaDoAutorizar({ fase: "F2" });
  const semPonteiro = perguntaDoAutorizar({ extra: { ponteiro: null } });
  const reg = registro([outroCiclo, outraFase, semPonteiro]);
  assert.throws(() => conferir(r, reg, outroCiclo.id), recusa("pergunta-de-outro-ciclo"));
  assert.throws(() => conferir(r, reg, outraFase.id, { fase: "F1" }), recusa("pergunta-de-outra-fase"));
  assert.throws(() => conferir(r, reg, semPonteiro.id), recusa("pergunta-de-outra-fase"));
  // Contraprova: a da F2 autoriza a F2.
  assert.equal(conferir(r, reg, outraFase.id, { fase: "F2" }), "digitado");
});

testeNaFonte("resposta não, outra letra ou sim diferente do texto da opção recusa", (t) => {
  const r = novoRepo(t);
  const letraB = perguntaDoAutorizar({ literal: "b", escolha: "b" });
  const nao = perguntaDoAutorizar({ literal: "não", escolha: null });
  const doisItens = perguntaDoAutorizar({ extra: { itens: [{ numero: 1, opcoes: [{ letra: "a", texto: SIM }] }, { numero: 2, opcoes: [{ letra: "a", texto: SIM }] }] } });
  const reg = registro([letraB, nao, doisItens]);
  assert.throws(() => conferir(r, reg, letraB.id), recusa("resposta-nao-autoriza"));
  // "não" sem letra não casa prova nenhuma: sai sem origem humana, e nunca autoriza.
  assert.throws(() => conferir(r, reg, nao.id), (e) => e instanceof ErroPlano && ["origem-sem-prova", "resposta-nao-autoriza"].includes(e.codigo));
  // Mesmo com a origem provada, resposta sem a letra do sim recusa.
  const provada = { perguntaDoAutorizar: (id) => ({ ...reg.perguntaDoAutorizar(id), origem: "digitado", motivo: null, escolhas: [] }) };
  assert.throws(() => conferir(r, provada, nao.id), recusa("resposta-nao-autoriza"));
  assert.throws(() => conferir(r, provada, doisItens.id), recusa("pergunta-fora-da-convencao"));
  const boa = perguntaDoAutorizar();
  // D-VEGA19-48: o `--sim` e a opção se comparam no mesmo aparo (o da marca relida pelo `simDoCorpo`);
  // espaço nas pontas não muda o texto, outra palavra muda.
  assert.equal(conferir(r, registro([boa]), boa.id, { sim: `${SIM} ` }), "digitado");
  assert.throws(() => conferir(r, registro([boa]), boa.id, { sim: `${SIM}!` }), recusa("sim-diferente-da-pergunta"));
});

testeNaFonte("a mesma pergunta não autoriza duas marcas", (t) => {
  const r = novoRepo(t);
  const p = perguntaDoAutorizar();
  const reg = registro([p]);
  const marca = r.autorizada("F1", SIM, p.id);
  assert.throws(() => conferir(r, reg, p.id), recusa("pergunta-reusada"));
  // A própria marca de origem, conferida na herança, não conta como reuso; a herdada também não.
  assert.equal(conferir(r, reg, p.id, { marca }), "digitado");
  r.autorizada("F2", SIM, p.id, marca);
  assert.equal(conferir(r, reg, p.id, { marca }), "digitado");
  // `Conducao-Herdada` fora da forma de SHA inteiro não esconde o uso.
  r.autorizada("F3", SIM, p.id, "torto");
  assert.throws(() => conferir(r, reg, p.id, { marca }), recusa("pergunta-reusada"));
});

testeNaFonte("banco fora sai registro-fora, distinto de sem prova de origem humana", (t) => {
  const r = novoRepo(t);
  const p = perguntaDoAutorizar();
  assert.throws(() => conferir(r, registro([p], { sem_registro: true }), p.id), recusa("registro-fora"));
  assert.throws(() => c.exigirOrigemHumana(registro([p], { sem_registro: true }), p.id), recusa("registro-fora"));
  const semProva = { origemEfetiva: () => ({ origem: "agente", motivo: "sem-autoria", sem_registro: false }) };
  assert.throws(() => c.exigirOrigemHumana(semProva, p.id), recusa("origem-sem-prova"));
});

testeNaFonte("a herança confere a pergunta da marca de origem mesmo sem casos a gravar", (t) => {
  const r = novoRepo(t);
  const boa = perguntaDoAutorizar();
  const origem = r.autorizada("F1", SIM, boa.id);
  const pecas = { phi: () => ({ recusar: false }), perguntas: registro([boa]), falha: null };
  assert.equal(conferirPerguntaDaHeranca({ repo: r.dir, ciclo: CICLO, autorizacao: origem, pecas }), boa.id);
  // A herdada cita a mesma pergunta: a conferência sobe à marca do sim.
  const herdada = r.autorizada("F2", SIM, boa.id, origem);
  assert.equal(conferirPerguntaDaHeranca({ repo: r.dir, ciclo: CICLO, autorizacao: herdada, pecas }), boa.id);
  // Pergunta de outra fase na marca de origem recusa, mesmo sem caso nenhum a gravar.
  const r2 = novoRepo(t);
  const daF2 = perguntaDoAutorizar({ fase: "F2" });
  const errada = r2.autorizada("F1", SIM, daF2.id);
  assert.throws(
    () => conferirPerguntaDaHeranca({ repo: r2.dir, ciclo: CICLO, autorizacao: errada, pecas: { ...pecas, perguntas: registro([daF2]) } }),
    recusa("pergunta-de-outra-fase"),
  );
  // Sem registro (falha de carga) recusa pelo motivo da carga.
  const falha = { phi: null, perguntas: null, falha: { codigo: "adaptador-nao-carrega", mensagem: "quebrado" } };
  assert.throws(() => conferirPerguntaDaHeranca({ repo: r.dir, ciclo: CICLO, autorizacao: origem, pecas: falha }), recusa("adaptador-nao-carrega"));
});

// ── a carga do adaptador ────────────────────────────────────────────────────

/** Um repo com a declaração do projeto de teste e o código dele, mexido por `mexer`. */
function repoComAdaptador(t, mexer = (s) => s) {
  const r = novoRepo(t);
  cpSync(FIXTURE, path.join(r.dir, ".altair"), { recursive: true });
  const codigo = path.join(r.dir, ".altair", "canonico.mjs");
  writeFileSync(codigo, mexer(readFileSync(codigo, "utf8")));
  return r;
}

test("autorizar com adaptador que não carrega recusa, nada gravado", (t) => {
  const r = repoComAdaptador(t, (s) => `throw new Error("adaptador quebrado de teste");\n${s}`);
  const antes = r.head();
  assert.equal(c.pecasDoConsentimento(r.dir).falha?.codigo, "adaptador-nao-carrega");
  assert.throws(() => autorizarCiclo({ repo: r.dir, ciclo: CICLO, fase: "F1", sim: SIM, pergunta: "p-00000000000000a1" }), recusa("adaptador-nao-carrega"));
  assert.equal(r.head(), antes, "0 commit");
});

test("autorizar com o export do consentimento ausente recusa", (t) => {
  const r = repoComAdaptador(t, (s) => s.replace("export function consentimentoDoProjeto(", "function consentimentoForaDoExport("));
  const antes = r.head();
  const pc = c.pecasDoConsentimento(r.dir);
  assert.equal(pc.falha?.codigo, "consentimento-sem-export");
  assert.equal(pc.semCodigoProprio, false);
  assert.throws(() => autorizarCiclo({ repo: r.dir, ciclo: CICLO, fase: "F1", sim: SIM, pergunta: "p-00000000000000a1" }), recusa("consentimento-sem-export"));
  assert.equal(r.head(), antes);
});

test("projeto sem código próprio de adaptador e sem registro git recusa a pergunta citada", (t) => {
  // Embutido (`superpowers`) sem destino `git` declarado: o export existe, o registro não (D-VEGA19-57).
  const embutido = novoRepo(t);
  cpSync(FIXTURE, path.join(embutido.dir, ".altair"), { recursive: true });
  const decl = path.join(embutido.dir, ".altair", "adaptador.json");
  writeFileSync(decl, JSON.stringify({ ...JSON.parse(readFileSync(decl, "utf8")), codigo: "superpowers" }));
  const pc = c.pecasDoConsentimento(embutido.dir);
  assert.equal(pc.semCodigoProprio, true);
  assert.equal(pc.phiPeloCaso, true, "o embutido declara phi = gate do caso (D-VEGA19-46)");
  assert.equal(pc.falha?.codigo, "registro-nao-declarado", JSON.stringify(pc.falha));
  const antes = embutido.head();
  assert.throws(() => autorizarCiclo({ repo: embutido.dir, ciclo: CICLO, fase: "F1", sim: SIM, pergunta: "p-00000000000000a1" }), recusa("registro-nao-declarado"));
  assert.equal(embutido.head(), antes, "0 commit");
  // Projeto sem adaptador nenhum (declaração sem código): sem registro de perguntas, recusa.
  const semCodigo = novoRepo(t);
  cpSync(FIXTURE, path.join(semCodigo.dir, ".altair"), { recursive: true });
  const d2 = path.join(semCodigo.dir, ".altair", "adaptador.json");
  const { codigo: _fora, ...semCampo } = JSON.parse(readFileSync(d2, "utf8"));
  writeFileSync(d2, JSON.stringify(semCampo));
  assert.equal(c.pecasDoConsentimento(semCodigo.dir).falha?.codigo, "registro-nao-declarado");
  assert.throws(() => autorizarCiclo({ repo: semCodigo.dir, ciclo: CICLO, fase: "F1", sim: SIM, pergunta: "p-00000000000000a1" }), recusa("registro-nao-declarado"));
  // A herança também confere: sem registro, a marca de origem com pergunta recusa.
  const origem = embutido.autorizada("F1", SIM, "p-00000000000000a1");
  assert.throws(() => conferirPerguntaDaHeranca({ repo: embutido.dir, ciclo: CICLO, autorizacao: origem }), recusa("registro-nao-declarado"));
});

test("pergunta sem registro que a confira nunca vira consentimento", () => {
  assert.throws(() => c.registroDoConsentimento({ phi: null, perguntas: null, falha: null }, "p-00000000000000a1"), recusa("registro-nao-declarado"));
  assert.throws(() => c.registroDoConsentimento({ phi: null, perguntas: null, falha: { codigo: "consentimento-sem-export", mensagem: "x" } }, "p-00000000000000a1"), recusa("consentimento-sem-export"));
  assert.throws(() => c.exigirPerguntaDoAutorizar({ repo: ".", perguntas: { origemEfetiva: () => ({}) }, pergunta_id: "p-00000000000000a1", ciclo: CICLO, fase: "F1", sim: SIM }), recusa("registro-nao-declarado"));
});

// ── padrao-da-fabrica pela abertura ─────────────────────────────────────────

/** Banco em memória: as linhas passam pelo `normalizarDecisao` real, como na tabela. */
function bancoEmMemoria(t) {
  // A delegação da fábrica (T42) aponta uma pergunta com autoria humana no registro: o banco em
  // memória a traz, como o banco do harness traz a da D73.
  const linhas = [
    {
      chave: "0".repeat(64),
      evento: "autoria",
      pergunta_id: lib.DELEGACAO_DA_FABRICA.pergunta_id,
      origem: "pergunta",
      origem_resposta: "digitado",
      prova: `transcript:/tmp/delegacao.jsonl#${"a".repeat(8)}`,
      quem: "pessoa",
      mandato: "engenharia",
      em_nome_de: lib.DELEGACAO_DA_FABRICA.de,
      has_patient_data: false,
      sessao: "zz-test-sessao-da-delegacao",
      item: "D73",
      titulo: "delegação da fábrica",
      detalhe: {},
      gravado_em: new Date().toISOString(),
    },
  ];
  const pasta = mkdtempSync(path.join(tmpdir(), "pergunta-citada-fila-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const deps = {
    pasta,
    operadorFn: () => ({ handle: "zz-test-operador" }),
    gravarFn: async (brutas) => {
      let gravadas = 0;
      let ja_existiam = 0;
      for (const b of brutas) {
        const n = decisao.normalizarDecisao(b, { operador: "zz-test-operador" });
        assert.equal(n.erro, undefined, n.erro);
        if (linhas.some((l) => l.chave === n.linha.chave)) ja_existiam++;
        else (linhas.push({ ...n.linha, gravado_em: new Date().toISOString() }), gravadas++);
      }
      return { exit: 0, gravadas, ja_existiam, recusadas: 0, descartadas_phi: 0 };
    },
    lerFn: async ({ pergunta_id = null } = {}) => linhas.filter((l) => !pergunta_id || l.pergunta_id === pergunta_id),
    registrarFn: async () => ({ exit: 0 }),
    stderr: { write: () => true },
  };
  return { linhas, deps };
}

const DO_CONSENTIMENTO = { ciclo: CICLO, fase: "F1", caso: "tela-dos-steps", quando: ABERTA, sim: "sim" };

testeNaFonte("padrao-da-fabrica com título forjado na resposta recusa: a abertura é que libera", async (t) => {
  const { linhas, deps } = bancoEmMemoria(t);
  // Uma pergunta humana comum, aberta por outra sessão.
  const humana = perguntaDoAutorizar().eventos[0];
  await lib.gravarEventos({ eventos: [humana], subverbo: "abrir", ...deps });
  const [, respostaDoPadrao] = c.eventosDoConsentimento(DO_CONSENTIMENTO, { pergunta_id: humana.pergunta_id, origem_resposta: "padrao-da-fabrica", ponteiro: `${lib.PONTEIRO_DO_CONSENTIMENTO}padrao-da-fabrica` });
  const n = linhas.length;
  await assert.rejects(
    lib.gravarEventos({ eventos: [respostaDoPadrao], subverbo: "responder", ...deps }),
    (e) => e instanceof lib.ErroPergunta && /abertura de p-[0-9a-f]{16} nao e a do consentimento/.test(e.message),
  );
  assert.equal(linhas.length, n, "0 linha gravada");
  // Abertura forjada do consentimento no mesmo lote não esconde a abertura gravada no banco.
  const [aberturaForjada] = c.eventosDoConsentimento(DO_CONSENTIMENTO, { pergunta_id: humana.pergunta_id, origem_resposta: "padrao-da-fabrica", ponteiro: `${lib.PONTEIRO_DO_CONSENTIMENTO}padrao-da-fabrica` });
  await assert.rejects(lib.gravarEventos({ eventos: [aberturaForjada, respostaDoPadrao], ...deps }), (e) => e instanceof lib.ErroPergunta && /nao e a do consentimento/.test(e.message));
  assert.equal(linhas.length, n, "0 linha gravada com a abertura forjada");
  // Pergunta sem abertura nenhuma também recusa.
  await assert.rejects(lib.gravarEventos({ eventos: [{ ...respostaDoPadrao, pergunta_id: "p-00000000000000ee" }], subverbo: "responder", ...deps }), lib.ErroPergunta);
});

testeNaFonte("padrao-da-fabrica que entrou na fila com o banco fora confere a abertura do banco ao drenar", async (t) => {
  const { linhas, deps } = bancoEmMemoria(t);
  const banco = await import(pathToFileURL(path.join(RAIZ, ".claude", "scripts", "estado", "lib", "banco.mjs")).href);
  const humana = perguntaDoAutorizar().eventos[0];
  await lib.gravarEventos({ eventos: [humana], subverbo: "abrir", ...deps });
  // Banco fora: uma abertura qualquer vai à fila, e o lote forjado entra atrás dela.
  let fora = true;
  const depsFora = {
    ...deps,
    gravarFn: async (b) => (fora ? { exit: banco.EXIT.SEM_REDE, mensagem: "fora" } : deps.gravarFn(b)),
    lerFn: async (f) => {
      if (fora) throw new banco.BancoError("fora", { codigo: banco.EXIT.SEM_REDE });
      return deps.lerFn(f);
    },
  };
  await lib.gravarEventos({ eventos: [perguntaDoAutorizar().eventos[0]], subverbo: "abrir", ...depsFora });
  const ponteiro = `${lib.PONTEIRO_DO_CONSENTIMENTO}padrao-da-fabrica`;
  const lote = c.eventosDoConsentimento(DO_CONSENTIMENTO, { pergunta_id: humana.pergunta_id, origem_resposta: "padrao-da-fabrica", ponteiro });
  const naFila = await lib.gravarEventos({ eventos: lote, ...depsFora });
  assert.equal(naFila.sem_registro, true);
  assert.ok(naFila.enfileirados > 0);
  // O banco volta: a drenagem não grava a resposta, porque o banco tem a abertura humana.
  fora = false;
  const r = await lib.gravarEventos({ eventos: [perguntaDoAutorizar().eventos[0]], subverbo: "abrir", ...deps });
  assert.equal(r.exit, 0);
  assert.equal(linhas.filter((l) => l.pergunta_id === humana.pergunta_id && l.evento === "resposta").length, 0, "resposta forjada não gravada");
  const presa = lib.lerFila({ pasta: deps.pasta }).find((e) => e.evento.evento === "resposta");
  assert.equal(presa?.falhas, 1, "fica na fila com a falha contada");
  assert.match(presa.ultima_falha, /nao e a do consentimento/);
});

testeNaFonte("padrao-da-fabrica na pergunta aberta pelo consentimento grava, em lote ou com a abertura no banco", async (t) => {
  const { linhas, deps } = bancoEmMemoria(t);
  assert.equal(lib.SESSAO_DO_CONSENTIMENTO, c.SESSAO_DO_CONSENTIMENTO, "paridade da sessão do consentimento");
  const ponteiro = `${lib.PONTEIRO_DO_CONSENTIMENTO}padrao-da-fabrica`;
  const id = c.perguntaDoConsentimento(DO_CONSENTIMENTO);
  const [ab, resp] = c.eventosDoConsentimento(DO_CONSENTIMENTO, { pergunta_id: id, origem_resposta: "padrao-da-fabrica", ponteiro });
  await lib.gravarEventos({ eventos: [ab], subverbo: "abrir", ...deps });
  const r = await lib.gravarEventos({ eventos: [resp], subverbo: "responder", ...deps });
  assert.equal(r.exit, 0);
  assert.equal(linhas.filter((l) => l.pergunta_id === id).length, 2);
  // No lote, sem o banco: a abertura do mesmo lote basta.
  const outro = c.perguntaDoConsentimento({ ...DO_CONSENTIMENTO, fase: "F2" });
  const lote = c.eventosDoConsentimento({ ...DO_CONSENTIMENTO, fase: "F2" }, { pergunta_id: outro, origem_resposta: "padrao-da-fabrica", ponteiro });
  assert.equal((await lib.gravarEventos({ eventos: lote, ...deps })).exit, 0);
});

// ── o trazer e o dado de teste (D-VEGA19-42) ─────────────────────────────────

test("fixture .json não pergunta no trazer e fixture .mjs pergunta", () => {
  const base = ".claude/skills/vega/scripts/conducao/__tests__/fixtures/projeto-de-teste";
  const json = `${base}/plano.json`;
  const md = `${base}/docs/pagina.md`;
  const mjs = `${base}/.altair/canonico.mjs`;
  assert.equal(ehDadoDeFixture(json), true);
  assert.equal(ehDadoDeFixture(md), true);
  assert.equal(ehDadoDeFixture(mjs), false);
  // A declaração de adaptador do dublê escolhe o código que roda: segue como superfície.
  assert.equal(ehDadoDeFixture(`${base}/.altair/adaptador.json`), false);
  assert.equal(ehDadoDeFixture(`${base}/.vega/declaracao.json`), false);
  assert.equal(ehDadoDeFixture(".claude/skills/vega/skills/conducao/SKILL.md"), false);
  // Pasta que o host carrega inteira lê a fixture como instrução: segue perguntando.
  for (const c of [
    ".claude/rules/x/__tests__/fixtures/a.md",
    ".claude/commands/__tests__/fixtures/a.md",
    ".claude/agents/y/__tests__/fixtures/b.json",
    ".github/workflows/__tests__/fixtures/c.json",
    `${base}/skill/SKILL.md`,
  ]) assert.equal(ehDadoDeFixture(c), false, c);
  assert.deepEqual(
    motivosParaPerguntar({ caminhos: [".claude/rules/x/__tests__/fixtures/a.md"], canonico: "x/canonico.md", outputs: [], alcance: () => [] })
      .filter((m) => m.motivo === "superficie-de-instrucao").flatMap((m) => m.caminhos),
    [".claude/rules/x/__tests__/fixtures/a.md"],
  );
  const motivos = (caminhos, outputs = []) =>
    motivosParaPerguntar({ caminhos, canonico: "x/canonico.md", outputs, alcance: () => [] }).filter((m) => m.motivo === "superficie-de-instrucao");
  assert.deepEqual(motivos([json, md]), []);
  assert.deepEqual(motivos([mjs]).flatMap((m) => m.caminhos), [mjs]);
  // Declarado nos Outputs, o dublê executável segue sem perguntar (instrucao-declarada-em-outputs).
  assert.deepEqual(motivos([mjs], [mjs]), []);
  // Contraprova: a skill fora de fixture segue perguntando.
  const skill = ".claude/skills/vega/skills/conducao/SKILL.md";
  assert.deepEqual(motivos([skill]).flatMap((m) => m.caminhos), [skill]);
});

describe("na fonte: o registro de perguntas do projeto", { skip: !NA_FONTE && FORA }, () => {
  for (const [nome, fn] of NA_FONTE_TESTES) test(nome, fn);
});
