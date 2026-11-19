/**
 * consentimento-no-registro.test.mjs — o consentimento da condução no registro de perguntas
 * (VEGA-19 T16; AC-VEGA19-1, AC-VEGA19-7; D-VEGA19-27, D-VEGA19-29, D-VEGA19-39, D-VEGA19-40).
 *
 * Cada caso consentido grava abertura + resposta `sim` no registro do projeto antes da marca no
 * git; o sim herdado cita a pergunta em que o operador o deu e só grava com a origem humana dela
 * pela `origemEfetiva()`; o gate byte a byte e o de PHI valem juntos. O registro e o gate de PHI
 * são os da Sistoli (`estado/lib/pergunta.mjs`, `.vega/sistoli.mjs`), carregados da fonte: o
 * registro de teste guarda os eventos em memória, mas passa cada um pelo `prepararEventos` real.
 * Fora da fonte (plugin instalado), os casos que pedem o projeto pulam, com o motivo.
 * Os sete débitos endereçados (§8.5 do canonico) têm um caso cada; os médios e baixos do fechamento
 * da F2 (D-VEGA19-48, T35) também.
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as c from "../consentimento.mjs";
import { ErroPlano } from "../ler-plano.mjs";
import { autorizarCiclo, consentidosDoTrailer, consentimentosEmFalta } from "../git-conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..", "..", "..", "..", "..");
const LIB_PERGUNTA = path.join(RAIZ, ".claude", "scripts", "estado", "lib", "pergunta.mjs");
const ADAPTADOR = path.join(RAIZ, ".vega", "sistoli.mjs");
const NA_FONTE = existsSync(LIB_PERGUNTA) && existsSync(ADAPTADOR);
const FORA = "fora da fonte: sem o registro e o gate de PHI do projeto";
/**
 * Os testes que só valem na fonte entram numa suíte só, pulada inteira fora dela: `test(…, { skip })`
 * conta como teste não passado na bateria do corpo fora da fonte (`# pass` ≠ `# tests`), e a suíte
 * pulada não conta teste nenhum — a forma dos outros testes do corpo (`describe(…, { skip: fora })`).
 */
const NA_FONTE_TESTES = [];
const testeNaFonte = (nome, fn) => NA_FONTE_TESTES.push([nome, fn]);
const lib = NA_FONTE ? await import(pathToFileURL(LIB_PERGUNTA).href) : null;
const phiDoProjeto = NA_FONTE ? createRequire(import.meta.url)(ADAPTADOR).consentimentoDoProjeto().phi : null;

const CICLO = "X-1";
const ABERTA = "2026-11-17T10:00:00.000Z";
const RESPONDIDA = "2026-11-17T10:05:00.000Z";
const SESSAO_OP = "sessao-op";
const TRANSCRIPT = "/tmp/transcript-de-teste.jsonl";
const P_HUMANA = "p-00000000000000a1";
const P_AGENTE = "p-00000000000000b2";
const P_DIGITADO_SEM_PROVA = "p-00000000000000c3";

/** CPF sintético com os dígitos verificadores calculados (nunca de pessoa: base fixa de teste). */
function cpfSintetico(base = "123456789") {
  const d = base.split("").map(Number);
  const dv = (ns) => {
    const s = ns.reduce((acc, n, i) => acc + n * (ns.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(d);
  const d2 = dv([...d, d1]);
  const n = [...d, d1, d2].join("");
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
}

/**
 * Os eventos da pergunta em que o operador deu o sim do ciclo, com a autoria dada, na convenção do
 * `autorizar-ciclo` (D-VEGA19-44): ponteiro `autorizar-ciclo:F1`, a opção (a) com o texto do sim e a
 * resposta que a escolhe. Desde a T35 o herdado passa pelas mesmas conferências da pergunta citada
 * (D-VEGA19-48), e a fixture precisa ser uma pergunta do autorizar de verdade.
 */
function perguntaDoSim(pergunta_id, autoria = null, { sim = "sim", fase = "F1", literal = "a" } = {}) {
  const comum = { pergunta_id, sessao: SESSAO_OP, ciclo: CICLO, versao_esquema: 1, has_patient_data: false, item: "D1", titulo: "sim do ciclo" };
  return [
    {
      ...comum,
      evento: "abertura",
      carimbo: ABERTA,
      ponteiro: `autorizar-ciclo:${fase}`,
      assunto: "autorizar o ciclo",
      itens: [{ numero: 1, titulo: "sim do ciclo", opcoes: [{ letra: "a", texto: sim }, { letra: "b", texto: "não, espera" }] }],
    },
    { ...comum, evento: "resposta", carimbo: RESPONDIDA, perguntado_em: ABERTA, resposta_literal: literal, ...(literal === "a" ? { escolha: "a" } : {}), origem_resposta: "agente" },
    ...(autoria ? [{ ...comum, evento: "autoria", carimbo: RESPONDIDA, origem_resposta: autoria.origem, prova: autoria.prova }] : []),
  ];
}

/**
 * O registro de teste: eventos em memória, cada gravação pelo `prepararEventos` real (a recusa de
 * origem e a de PHI do registro valem aqui) e a origem pela `origemEfetiva()` real, com o
 * transcript da sessão do operador montado em memória (uma mensagem humana `sim`, depois da abertura).
 */
function registroDeTeste(iniciais = []) {
  const eventos = [...iniciais];
  const transcript = [{ uuid: "u-humana", sessionId: SESSAO_OP, type: "user", origin: { kind: "human" }, timestamp: RESPONDIDA, message: { content: "a" } }];
  let seq = 0;
  return {
    eventos,
    /** Uma pergunta nova do autorizar, de origem humana, com o `sim` dado como opção (a). */
    simHumano(sim, opcoes = {}) {
      const id = `p-${(0xd000 + ++seq).toString(16).padStart(16, "0")}`;
      eventos.push(...perguntaDoSim(id, { origem: "digitado", prova: `transcript:${TRANSCRIPT}#u-humana` }, { sim, ...opcoes }));
      return id;
    },
    gravar(evs) {
      lib.prepararEventos(evs, { operador: "operador" });
      eventos.push(...evs);
      return [{ exit: 0, gravados: evs.length }];
    },
    origemEfetiva: (id) =>
      lib.origemEfetiva(id, { eventos, achar: (s) => (s === SESSAO_OP ? TRANSCRIPT : null), lerEntradas: (a) => (a === TRANSCRIPT ? transcript : null) }),
    perguntaDoAutorizar: (id) =>
      lib.perguntaDoAutorizar(id, { eventos, achar: (s) => (s === SESSAO_OP ? TRANSCRIPT : null), lerEntradas: (a) => (a === TRANSCRIPT ? transcript : null) }),
  };
}

function registroComOsSins() {
  return registroDeTeste([
    ...perguntaDoSim(P_HUMANA, { origem: "digitado", prova: `transcript:${TRANSCRIPT}#u-humana` }),
    ...perguntaDoSim(P_AGENTE),
    // `digitado` inserido direto, com prova que não resolve (uuid que o transcript não tem).
    ...perguntaDoSim(P_DIGITADO_SEM_PROVA, { origem: "digitado", prova: `transcript:${TRANSCRIPT}#u-inventada` }),
  ]);
}

function novoRepo(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "consentimento-no-registro-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  g("init", "-q", "-b", "main");
  // Identidade própria do repositório de teste: o código sob teste commita com o git do sistema, sem o env do `g`,
  // e o runner do CI não tem identidade global (D-VEGA19-49).
  for (const [k, v] of [["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g("config", k, v);
  g("commit", "-q", "--allow-empty", "-m", "raiz");
  /** A marca `autorizada` com o sim no corpo; `pergunta` vira o trailer `Conducao-Pergunta`. */
  const autorizada = (sim, pergunta = null) => {
    g("commit", "-q", "--allow-empty", "-m", "Conducao: F1 autorizada", "-m", sim, "-m", ["Conducao-Plano: abc", "Conducao-Ciclo: sim", ...(pergunta ? [`Conducao-Pergunta: ${pergunta}`] : [])].join("\n"));
    return g("rev-parse", "HEAD");
  };
  return { dir, g, autorizada, head: () => g("rev-parse", "HEAD"), trailers: () => g("log", "-1", "--format=%(trailers:only=true,unfold=true)") };
}

const herdar = (r, origem, pecas, extra = {}) =>
  c.gravarCasosHerdados({ repo: r.dir, ciclo: CICLO, pedidos: [c.pedidoDeCaso({ caso: c.CASOS.herancaEntreFases, fase: "F2", origem })], quem: "operador", cerca: () => {}, pecas, ...extra });

// ── o sim herdado ───────────────────────────────────────────────────────────

testeNaFonte("sim herdado com CPF sintético (dígito verificador calculado) sai recusado, com 0 linha gravada e 0 trailer", (t) => {
  const r = novoRepo(t);
  const cpf = cpfSintetico();
  assert.match(cpf, /^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
  const reg = registroComOsSins();
  const comCpf = `sim, segue; paciente ${cpf}`;
  const origem = r.autorizada(comCpf, reg.simHumano(comCpf));
  const antesDoRegistro = reg.eventos.length;
  const antes = r.head();
  assert.throws(() => herdar(r, origem, { phi: phiDoProjeto, perguntas: reg }), (e) => e instanceof ErroPlano && e.codigo === "phi-recusado" && /PHI/.test(e.message));
  assert.equal(reg.eventos.length - antesDoRegistro, 0, "0 linha gravada no registro");
  assert.equal(r.head(), antes, "0 commit");
  assert.equal(c.lerConsentimentos(r.dir, { ciclo: CICLO }).length, 0, "0 trailer de consentimento");
  // Contraprova: o mesmo caminho, sem o CPF, grava.
  const limpa = r.autorizada("sim, segue", reg.simHumano("sim, segue"));
  assert.equal(herdar(r, limpa, { phi: phiDoProjeto, perguntas: reg }).length, 1);
});

testeNaFonte("sim herdado de pergunta com origem humana grava abertura e resposta agente com ponteiro = a pergunta citada", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  const citada = reg.simHumano("sim, pode tocar o ciclo");
  const origem = r.autorizada("sim, pode tocar o ciclo", citada);
  const [g] = herdar(r, origem, { phi: phiDoProjeto, perguntas: reg });
  assert.match(g.pergunta, c.PERGUNTA_ID_RE);
  const novos = reg.eventos.filter((e) => e.pergunta_id === g.pergunta);
  assert.deepEqual(novos.map((e) => e.evento), ["abertura", "resposta"]);
  const resposta = novos.find((e) => e.evento === "resposta");
  assert.equal(resposta.origem_resposta, "agente");
  assert.equal(resposta.ponteiro, citada);
  assert.equal(resposta.resposta_literal, "sim");
  assert.equal(novos[0].itens[0].contexto, "sim, pode tocar o ciclo", "o texto exato do sim vai à abertura");
  const tr = r.trailers();
  assert.match(tr, new RegExp(`Conducao-Pergunta: ${g.pergunta}`));
  assert.match(tr, new RegExp(`Conducao-Pergunta-Citada: ${citada}`));
  const [lido] = c.lerConsentimentos(r.dir, { ciclo: CICLO });
  assert.equal(lido.pergunta, g.pergunta);
  assert.equal(lido.citada, citada);
  // Regravar o mesmo caso dá o mesmo id: o registro não duplica a pergunta.
  assert.equal(c.perguntaDoConsentimento(lido), g.pergunta);
});

testeNaFonte("herdado com pergunta de origem agente recusa", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  const origem = r.autorizada("sim", P_AGENTE);
  const antes = r.head();
  const n = reg.eventos.length;
  assert.throws(() => herdar(r, origem, { phi: phiDoProjeto, perguntas: reg }), (e) => e.codigo === "origem-sem-prova" && /agente/.test(e.message));
  assert.equal(r.head(), antes);
  assert.equal(reg.eventos.length, n);
});

testeNaFonte("digitado inserido direto, sem prova que resolva, sai recusado", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  assert.equal(reg.origemEfetiva(P_DIGITADO_SEM_PROVA).origem, "agente");
  assert.equal(reg.origemEfetiva(P_DIGITADO_SEM_PROVA).motivo, "prova-nao-resolve");
  const origem = r.autorizada("sim", P_DIGITADO_SEM_PROVA);
  assert.throws(() => herdar(r, origem, { phi: phiDoProjeto, perguntas: reg }), (e) => e.codigo === "origem-sem-prova");
  // Sem registro para conferir: recusa também (fail-closed), com o motivo próprio (D-VEGA19-41).
  assert.throws(() => herdar(r, r.autorizada("sim", P_HUMANA), { phi: phiDoProjeto, perguntas: null }), (e) => e.codigo === "registro-nao-declarado");
});

testeNaFonte("marca legada sem trailer herda pelo caminho antigo", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  const n = reg.eventos.length;
  const origem = r.autorizada("sim, pode tocar a F1");
  const [g] = herdar(r, origem, { phi: phiDoProjeto, perguntas: reg });
  assert.equal(g.pergunta, null, "legado: nada no registro");
  assert.equal(reg.eventos.length, n);
  assert.doesNotMatch(r.trailers(), /Conducao-Pergunta/);
  // O gate byte a byte segue no caminho legado, e o de PHI também.
  assert.throws(() => herdar(r, origem, { phi: phiDoProjeto, perguntas: reg }, { sim: "sim, pode tocar a F2" }), (e) => e.codigo === "phi-recusado" && /marca de origem/.test(e.message));
  const comCpf = r.autorizada(`sim ${cpfSintetico()}`);
  assert.throws(() => herdar(r, comCpf, { phi: phiDoProjeto, perguntas: reg }), (e) => e.codigo === "phi-recusado");
  // Sem gate de PHI, com código próprio (a Sistoli): nada grava (fail-closed).
  const antesSemFiltro = r.head();
  assert.throws(() => herdar(r, origem, { phi: null, perguntas: reg }), (e) => e.codigo === "phi-sem-gate");
  assert.throws(() => herdar(r, origem, { phi: null, perguntas: reg, semCodigoProprio: false }), (e) => e.codigo === "phi-sem-gate");
  assert.equal(r.head(), antesSemFiltro);
});

testeNaFonte("projeto sem filtro de PHI próprio herda pelo gate do caso; com código próprio sem o filtro, recusa (D-VEGA19-46)", (t) => {
  const r = novoRepo(t);
  const origem = r.autorizada("sim, pode tocar a F1");
  const antes = r.head();
  // Código próprio que não exporta o filtro: recusa, nada no git.
  assert.throws(() => herdar(r, origem, { phi: null, perguntas: null, semCodigoProprio: false }), (e) => e.codigo === "phi-sem-gate");
  assert.equal(r.head(), antes);
  // Sem código próprio (exemplo do plugin, `superpowers`): o gate do caso confere byte a byte e grava.
  const semFiltro = { phi: null, perguntas: null, semCodigoProprio: true };
  assert.throws(() => herdar(r, origem, semFiltro, { sim: "sim, pode tocar a F2" }), (e) => e.codigo === "phi-recusado" && e.message.includes("marca de origem"));
  assert.equal(r.head(), antes);
  const [g] = herdar(r, origem, semFiltro);
  assert.notEqual(r.head(), antes);
  assert.equal(g.sha, r.head());
  assert.ok(r.trailers().includes(`Conducao-Consentimento: ${c.CASOS.herancaEntreFases}`), r.trailers());
  // Sem o gate do caso não há o que conferir: recusa mesmo sem código próprio.
  assert.throws(
    () => c.conferirConsentimento({ registro: { ciclo: CICLO, fase: "F2", caso: c.CASOS.herancaEntreFases, quem: "operador", quando: new Date().toISOString(), sim: "sim", origem }, phi: null, semFiltroDoProjeto: true }),
    (e) => e.codigo === "phi-sem-gate",
  );
});

testeNaFonte("registro que recusa não deixa marca no git", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  const origem = r.autorizada("sim", P_HUMANA);
  const antes = r.head();
  const quebrado = { ...reg, gravar: () => { throw new Error("banco recusou"); } };
  assert.throws(() => herdar(r, origem, { phi: phiDoProjeto, perguntas: quebrado }), (e) => e.codigo === "registro-recusado");
  assert.equal(r.head(), antes);
});

// ── o autorizar-ciclo ───────────────────────────────────────────────────────

test("autorizar sem --pergunta recusa", (t) => {
  const r = novoRepo(t);
  const antes = r.head();
  for (const pergunta of [undefined, null, "", "p-curto", "D7a"])
    assert.throws(() => autorizarCiclo({ repo: r.dir, ciclo: CICLO, fase: "F1", sim: "sim", pergunta }), (e) => e.codigo === "pergunta-ausente");
  assert.equal(r.head(), antes);
});

// ── o padrão da fábrica e a decisão do canonico ─────────────────────────────

const CONTRATO = "# c\n\n## Padrão da fábrica\n\n**Padrão da fábrica:** o trazer não pergunta pelos três casos.\n";
const CANONICO = "---\ncycle: X-1\n---\n\n### 1.5 Decisões\n\n- **D-X1-7:** A T3 toca `a/b.mjs` por decisão do operador.\n";

testeNaFonte("padrão da fábrica grava origem padrao-da-fabrica com a marca do consentimento, conferido pelo texto exato do contrato", (t) => {
  const r = novoRepo(t);
  const reg = registroDeTeste();
  const { registros } = c.registrosDoTrazer({
    consentidos: [{ caso: c.CASOS.instrucaoDeclaradaEmOutputs, motivo: "superficie-de-instrucao", caminhos: ["a/CLAUDE.md"] }],
    canonico: CANONICO,
    contrato: CONTRATO,
    ciclo: CICLO,
    fase: "F2",
    task: "T3",
    tentativa: 2,
    quem: "operador",
    quando: RESPONDIDA,
  });
  assert.equal(registros.length, 1);
  const [g] = c.gravarRegistrosDoTrazer({ repo: r.dir, registros, cerca: () => {}, pecas: { phi: phiDoProjeto, perguntas: reg } });
  const resposta = reg.eventos.find((e) => e.pergunta_id === g.pergunta && e.evento === "resposta");
  assert.equal(resposta.origem_resposta, "padrao-da-fabrica");
  assert.equal(resposta.ponteiro, `${c.PONTEIRO_DO_CONSENTIMENTO}padrao-da-fabrica`);
  assert.ok(resposta.titulo.startsWith(`${c.TITULO_DO_CONSENTIMENTO}: `));
  assert.equal(g.registro.sim, "o trazer não pergunta pelos três casos.");
  assert.equal(g.registro.tentativa, 2);
  // Texto que não é o exato do contrato: recusado pelo gate do plano, nada gravado.
  const n = reg.eventos.length;
  const torto = [{ ...registros[0], registro: c.casoResolvido({ ...registros[0].registro, sim: "sim, pode seguir" }) }];
  assert.throws(() => c.gravarRegistrosDoTrazer({ repo: r.dir, registros: torto, cerca: () => {}, pecas: { phi: phiDoProjeto, perguntas: reg } }), (e) => e.codigo === "phi-recusado");
  assert.equal(reg.eventos.length, n);
});

testeNaFonte("decisao-registrada-da-task grava como o padrão, com a origem = o id da decisão", (t) => {
  const r = novoRepo(t);
  const reg = registroDeTeste();
  const { registros, voltam } = c.registrosDoTrazer({
    consentidos: [{ caso: c.CASOS.decisaoRegistradaDaTask, motivo: "alcance-dos-hooks", caminhos: ["a/b.mjs"], decisao: "D-X1-7" }],
    canonico: CANONICO,
    contrato: CONTRATO,
    ciclo: CICLO,
    fase: "F2",
    task: "T3",
    tentativa: 1,
    quem: "operador",
    quando: RESPONDIDA,
  });
  assert.equal(voltam.length, 0);
  const [g] = c.gravarRegistrosDoTrazer({ repo: r.dir, registros, cerca: () => {}, pecas: { phi: phiDoProjeto, perguntas: reg } });
  assert.equal(g.registro.origem, "D-X1-7");
  const resposta = reg.eventos.find((e) => e.pergunta_id === g.pergunta && e.evento === "resposta");
  assert.equal(resposta.origem_resposta, "padrao-da-fabrica");
  assert.equal(resposta.ponteiro, `${c.PONTEIRO_DO_CONSENTIMENTO}D-X1-7`);
});

test("a tentativa entra no id da pergunta: a 2ª tentativa é outra pergunta", () => {
  const base = { ciclo: CICLO, fase: "F2", caso: c.CASOS.testeQueAcompanhaOCodigo, quem: "operador", quando: RESPONDIDA, sim: "x", task: "T3", tipo: "trazer", motivo: "alcance-dos-hooks", caminhos: ["a/__tests__/b.test.mjs"] };
  const p1 = c.perguntaDoConsentimento(c.casoResolvido({ ...base, tentativa: 1 }));
  const p2 = c.perguntaDoConsentimento(c.casoResolvido({ ...base, tentativa: 2 }));
  assert.match(p1, c.PERGUNTA_ID_RE);
  assert.notEqual(p1, p2);
  assert.equal(p1, c.perguntaDoConsentimento(c.casoResolvido({ ...base, tentativa: 1 })), "mesmo caso, mesmo id");
});

testeNaFonte("as constantes da marca do consentimento batem com as do registro do projeto", () => {
  assert.equal(c.TITULO_DO_CONSENTIMENTO, lib.TITULO_DO_CONSENTIMENTO);
  assert.equal(c.PONTEIRO_DO_CONSENTIMENTO, lib.PONTEIRO_DO_CONSENTIMENTO);
  assert.equal(c.ORIGEM_DO_PADRAO, lib.ORIGEM_DO_PADRAO);
  assert.deepEqual([...c.ORIGENS_HUMANAS], [...lib.FORCA_DAS_ORIGENS]);
});

// ── os débitos de §8.5 ──────────────────────────────────────────────────────

test("a chave da falta leva a tentativa: o registro de outra tentativa não cobre esta", () => {
  const caso = { fase: "F2", caso: c.CASOS.testeQueAcompanhaOCodigo, motivo: "alcance-dos-hooks", caminhos: ["a/__tests__/b.test.mjs"], origem: "padrao-da-fabrica" };
  const gravados = [{ ...caso, task: "T3", tipo: "trazer", tentativa: 1 }];
  assert.equal(consentimentosEmFalta({ consentidos: [{ ...caso, tentativa: 2 }], gravados, task: "T3" }).length, 1);
  assert.equal(consentimentosEmFalta({ consentidos: [{ ...caso, tentativa: 1 }], gravados, task: "T3" }).length, 0);
});

test("o trailer de consentidos distingue ausente de vazio e de ilegível", () => {
  assert.equal(consentidosDoTrailer(undefined), undefined);
  assert.deepEqual(consentidosDoTrailer(Buffer.from("[]").toString("base64url")), []);
  assert.equal(consentidosDoTrailer("!!nao-e-base64-json"), null);
});

test("teste que acompanha o código: só o que leva o nome de um Output de código", () => {
  const outputs = ["x/conducao/consentimento.mjs"];
  assert.equal(c.acompanhaOCodigo("x/conducao/__tests__/consentimento.test.mjs", outputs), true);
  assert.equal(c.acompanhaOCodigo("x/conducao/__tests__/consentimento-no-registro.test.mjs", outputs), true);
  assert.equal(c.acompanhaOCodigo("x/conducao/__tests__/passagem.test.mjs", outputs), false, "teste qualquer do diretório não acompanha");
  assert.equal(c.acompanhaOCodigo("x/conducao/__tests__/consentimentos.test.mjs", outputs), false, "prefixo sem hífen não acompanha");
  assert.equal(c.acompanhaOCodigo("x/outro/__tests__/consentimento.test.mjs", outputs), false);
  assert.equal(c.acompanhaOCodigo("x/conducao/contrato-atual.md", outputs), true);
});

testeNaFonte("gravar casos herdados não escreve nada se um dos casos recusa", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  const boa = r.autorizada("sim", P_HUMANA);
  const ma = r.autorizada("sim", P_AGENTE);
  const antes = r.head();
  const n = reg.eventos.length;
  const pedidos = [c.pedidoDeCaso({ caso: c.CASOS.herancaEntreFases, fase: "F2", origem: boa }), c.pedidoDeCaso({ caso: c.CASOS.replanoSemMudancaDeClasse, fase: "F2", origem: ma })];
  assert.throws(() => c.prepararCasosHerdados({ repo: r.dir, ciclo: CICLO, pedidos, quem: "operador", pecas: { phi: phiDoProjeto, perguntas: reg } }), (e) => e.codigo === "origem-sem-prova");
  assert.equal(r.head(), antes);
  assert.equal(reg.eventos.length, n);
});

testeNaFonte("autorizar com pergunta sem origem humana recusa antes de gravar", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  const antes = r.head();
  for (const pergunta of [P_AGENTE, P_DIGITADO_SEM_PROVA, "p-00000000000000ff"])
    assert.throws(() => autorizarCiclo({ repo: r.dir, ciclo: CICLO, fase: "F1", sim: "sim", pergunta, pecas: { phi: phiDoProjeto, perguntas: reg } }), (e) => e.codigo === "origem-sem-prova", pergunta);
  assert.equal(r.head(), antes);
});

testeNaFonte("dado de paciente nos campos que viram trailer também é recusado", () => {
  const registro = { ciclo: CICLO, fase: "F2", caso: c.CASOS.herancaEntreFases, quem: `operador ${cpfSintetico()}`, quando: RESPONDIDA, sim: "sim" };
  assert.throws(() => c.conferirConsentimento({ registro, phi: phiDoProjeto }), (e) => e.codigo === "phi-recusado" && e.message.includes("trailers"));
  assert.equal(c.conferirConsentimento({ registro: { ...registro, quem: "operador" }, phi: phiDoProjeto }).registro.quem, "operador");
});

// ── D-VEGA19-48: os médios e baixos do fechamento da F2 ─────────────────────

/** O `rodar` do git do repositório de teste, com `trocar(args)` para desviar uma chamada. */
const rodarCom = (trocar = () => undefined) => (repo, args) => {
  const t = trocar(args);
  if (t !== undefined) return t;
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
};

testeNaFonte("herdado passa pelas mesmas conferências da pergunta citada: outra fase e reuso recusam", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  const antes = r.head();
  const n = reg.eventos.length;
  const deOutraFase = r.autorizada("sim, a F1", reg.simHumano("sim, a F1", { fase: "F3" }));
  assert.throws(() => herdar(r, deOutraFase, { phi: phiDoProjeto, perguntas: reg }), (e) => e.codigo === "pergunta-de-outra-fase");
  const id = reg.simHumano("sim, uma vez");
  r.autorizada("sim, uma vez", id);
  const segunda = r.autorizada("sim, uma vez", id);
  assert.throws(() => herdar(r, segunda, { phi: phiDoProjeto, perguntas: reg }), (e) => e.codigo === "pergunta-reusada");
  assert.equal(c.lerConsentimentos(r.dir, { ciclo: CICLO }).length, 0, "nenhuma marca de consentimento");
  assert.notEqual(r.head(), antes);
  assert.equal(reg.eventos.length - n, 6, "só as duas perguntas da fixture; nada gravado pelo herdado");
});

// `Conducao-Pergunta-Citada` só nasce do caso herdado (`prepararCasosHerdados`); a `pergunta-repetida` a
// carrega quando a cadeia de origem chega a um herdado. Repetida de `resposta-do-operador` sem citada
// segue o caminho antigo, sem esta conferência.
testeNaFonte("pergunta-repetida passa pelas mesmas conferências da pergunta citada", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  const citada = reg.simHumano("sim, pode seguir");
  const [h] = herdar(r, r.autorizada("sim, pode seguir", citada), { phi: phiDoProjeto, perguntas: reg });
  const repetida = (origem) =>
    c.registrosDoTrazer({
      consentidos: [{ caso: c.CASOS.perguntaRepetida, motivo: "alcance-dos-hooks", caminhos: ["a/b.mjs"], origem, sim: "sim, pode seguir" }],
      canonico: "",
      ciclo: CICLO,
      fase: "F2",
      task: "T3",
      tentativa: 1,
      quem: "operador",
      quando: RESPONDIDA,
    }).registros;
  const [g] = c.gravarRegistrosDoTrazer({ repo: r.dir, registros: repetida(h.sha), cerca: () => {}, pecas: { phi: phiDoProjeto, perguntas: reg } });
  assert.equal(g.registro.citada, citada, "sobe do consentimento herdado até a marca do sim");
  // A abertura da pergunta citada passa a apontar outra fase: a repetição recusa, nada gravado.
  const ab = reg.eventos.find((e) => e.pergunta_id === citada && e.evento === "abertura");
  ab.ponteiro = "autorizar-ciclo:F9";
  const antes = r.head();
  assert.throws(() => c.gravarRegistrosDoTrazer({ repo: r.dir, registros: repetida(h.sha), cerca: () => {}, pecas: { phi: phiDoProjeto, perguntas: reg } }), (e) => e.codigo === "pergunta-de-outra-fase");
  assert.equal(r.head(), antes);
});

testeNaFonte("resposta sim sem escolhas não autoriza, e o motivo é resposta-nao-autoriza", (t) => {
  const r = novoRepo(t);
  const [abertura] = perguntaDoSim("p-00000000000000e1", null, { sim: "sim, toca" });
  assert.deepEqual(lib.escolhasDaResposta({ resposta_literal: "sim" }), [{ numero: null, letra: "sim" }], "'sim' vira a escolha sim, não a letra da opção");
  const perguntas = { perguntaDoAutorizar: () => ({ origem: "digitado", motivo: null, abertura, escolhas: lib.escolhasDaResposta({ resposta_literal: "sim" }) }) };
  assert.throws(() => c.exigirPerguntaDoAutorizar({ repo: r.dir, perguntas, pergunta_id: "p-00000000000000e1", ciclo: CICLO, fase: "F1", sim: "sim, toca" }), (e) => e.codigo === "resposta-nao-autoriza");
});

test("o --sim e a opção se comparam no mesmo aparo", (t) => {
  const r = novoRepo(t);
  const abertura = { evento: "abertura", pergunta_id: "p-00000000000000e2", ciclo: CICLO, ponteiro: "autorizar-ciclo:F1", itens: [{ numero: 1, opcoes: [{ letra: "a", texto: "sim, toca o ciclo " }] }] };
  const perguntas = { perguntaDoAutorizar: () => ({ origem: "digitado", motivo: null, abertura, escolhas: [{ numero: 1, letra: "a" }] }) };
  const conferir = (sim) => c.exigirPerguntaDoAutorizar({ repo: r.dir, perguntas, pergunta_id: "p-00000000000000e2", ciclo: CICLO, fase: "F1", sim });
  assert.equal(conferir("  sim, toca o ciclo\n"), "digitado", "o --sim cru com espaço e a opção com espaço casam aparados");
  assert.equal(conferir("sim, toca o ciclo"), "digitado", "o texto aparado da marca relida também");
  assert.throws(() => conferir("sim, toca a fase"), (e) => e.codigo === "sim-diferente-da-pergunta");
});

testeNaFonte("a escrita registro→git é idempotente e confere a marca antes de dar por gravado", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  const citada = reg.simHumano("sim, de novo");
  const origem = r.autorizada("sim, de novo", citada);
  const [g1] = herdar(r, origem, { phi: phiDoProjeto, perguntas: reg });
  const depois = r.head();
  assert.equal(g1.sha, depois);
  const [g2] = herdar(r, origem, { phi: phiDoProjeto, perguntas: reg });
  assert.equal(g2.repetida, true);
  assert.equal(g2.sha, g1.sha, "a repetição devolve a marca que já existe");
  assert.equal(g2.registro.quando, g1.registro.quando, "e o registro dela, não o desta chamada");
  assert.equal(r.head(), depois, "nenhuma segunda marca");
  assert.equal(c.lerConsentimentos(r.dir, { ciclo: CICLO }).length, 1);
  // HEAD que não é a marca depois do commit: o caso não é dado por gravado.
  const outra = r.autorizada("sim, outra", reg.simHumano("sim, outra"));
  const raiz = r.g("rev-list", "--max-parents=0", "HEAD");
  const rodar = rodarCom((args) => (args[0] === "rev-parse" && args[1] === "HEAD" ? raiz : undefined));
  assert.throws(() => herdar(r, outra, { phi: phiDoProjeto, perguntas: reg }, { rodar }), (e) => e.codigo === "marca-nao-confere");
});

testeNaFonte("com a pergunta só na fila local, a marca sai sem Conducao-Pergunta", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  const citada = reg.simHumano("sim, banco fora");
  const naFila = { ...reg, gravar: (evs) => (reg.gravar(evs), [{ exit: 0, gravados: 0, enfileirados: evs.length, sem_registro: true }]) };
  const [g] = herdar(r, r.autorizada("sim, banco fora", citada), { phi: phiDoProjeto, perguntas: naFila });
  assert.equal(g.pergunta, null);
  assert.match(g.na_fila, c.PERGUNTA_ID_RE);
  const tr = r.trailers();
  assert.doesNotMatch(tr, /^Conducao-Pergunta: /m, "a marca não afirma a pergunta que só está na fila");
  assert.match(tr, new RegExp(`^Conducao-Pergunta-Citada: ${citada}`, "m"));
});

testeNaFonte("peças com phi e sem perguntas avisam em vez de gravar caladas", (t) => {
  const r = novoRepo(t);
  const { registros } = c.registrosDoTrazer({
    consentidos: [{ caso: c.CASOS.instrucaoDeclaradaEmOutputs, motivo: "superficie-de-instrucao", caminhos: ["a/CLAUDE.md"] }],
    canonico: CANONICO,
    contrato: CONTRATO,
    ciclo: CICLO,
    fase: "F2",
    task: "T3",
    tentativa: 1,
    quem: "operador",
    quando: RESPONDIDA,
  });
  const avisos = [];
  const pecas = { phi: phiDoProjeto, perguntas: null, falha: { codigo: "registro-nao-declarado", mensagem: "consentimentoDoProjeto() sem o registro de perguntas" } };
  const [g] = c.gravarRegistrosDoTrazer({ repo: r.dir, registros, cerca: () => {}, pecas, avisar: (l) => avisos.push(l) });
  assert.equal(g.sha, r.head(), "o caso grava no git");
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /1 caso\(s\) gravado\(s\) só no git, sem pergunta registrada.*registro-nao-declarado|sem o registro de perguntas/);
  // Com o registro, nenhum aviso.
  const comRegistro = [];
  c.gravarRegistrosDoTrazer({ repo: r.dir, registros, cerca: () => {}, pecas: { phi: phiDoProjeto, perguntas: registroDeTeste() }, avisar: (l) => comRegistro.push(l) });
  assert.equal(comRegistro.length, 0);
});

testeNaFonte("abrir e responder do consentimento numa gravação só", () => {
  const chamadas = [];
  const rodar = (_bin, args, opts) => {
    chamadas.push({ sub: args[2], eventos: JSON.parse(opts.input) });
    return { status: 0, stdout: JSON.stringify({ exit: 0, gravados: JSON.parse(opts.input).length, enfileirados: 0 }), stderr: "" };
  };
  const { perguntas } = createRequire(import.meta.url)(ADAPTADOR).consentimentoDoProjeto({ rodar });
  const caso = c.casoResolvido({ ciclo: CICLO, fase: "F2", caso: c.CASOS.instrucaoDeclaradaEmOutputs, quem: "operador", quando: RESPONDIDA, sim: "x", task: "T3", tipo: "trazer", motivo: "m", caminhos: ["a/CLAUDE.md"], tentativa: 1 });
  const id = c.perguntaDoConsentimento(caso);
  const lote = c.eventosDoConsentimento(caso, { pergunta_id: id, origem_resposta: "padrao-da-fabrica", ponteiro: `${c.PONTEIRO_DO_CONSENTIMENTO}padrao-da-fabrica` });
  perguntas.gravar(lote);
  assert.deepEqual(chamadas.map((x) => [x.sub, x.eventos.map((e) => e.evento)]), [["abrir", ["abertura", "resposta"]]], "um processo só, abertura primeiro");
  // O registro aceita o lote no `abrir` só para o consentimento com a abertura junto.
  const [ab, resp] = lote;
  assert.equal(lib.respostaDoLoteDoConsentimento(resp, lote), true);
  assert.equal(lib.respostaDoLoteDoConsentimento(resp, [resp]), false, "resposta sem a abertura no lote segue pelo responder");
  assert.equal(lib.respostaDoLoteDoConsentimento({ ...resp, sessao: "outra" }, [{ ...ab, sessao: "outra" }, { ...resp, sessao: "outra" }]), false, "pergunta comum nunca");
});

testeNaFonte("sem prova da gravação a marca não afirma a pergunta, e a rebaixada se completa uma vez quando a pergunta se prova", (t) => {
  const r = novoRepo(t);
  const reg = registroComOsSins();
  const formas = [
    ["evento já na fila de antes (enfileirados 0, sem_registro)", [{ exit: 0, gravados: 0, enfileirados: 0, sem_registro: true }], "na_fila"],
    ["adaptador assíncrono", Promise.resolve([{ gravados: 2 }]), "sem_prova"],
    ["adaptador assíncrono que rejeita", Promise.reject(new Error("banco")), "sem_prova"],
    ["saída sem gravados nem ja_existiam", [{ exit: 0 }], "sem_prova"],
    ["nada", undefined, "sem_prova"],
  ];
  for (const [nome, saida, campo] of formas) {
    const sim = `sim, ${nome}`;
    const citada = reg.simHumano(sim);
    const [g] = herdar(r, r.autorizada(sim, citada), { phi: phiDoProjeto, perguntas: { ...reg, gravar: (evs) => (reg.gravar(evs), saida) } });
    assert.equal(g.pergunta, null, nome);
    assert.match(g[campo] ?? "", c.PERGUNTA_ID_RE, nome);
    assert.doesNotMatch(r.trailers(), /^Conducao-Pergunta: /m, nome);
  }
  // A repetição com o registro de pé completa a rebaixada, uma vez só.
  const sim = "sim, banco volta";
  const origem = r.autorizada(sim, reg.simHumano(sim));
  const [rebaixada] = herdar(r, origem, { phi: phiDoProjeto, perguntas: { ...reg, gravar: (evs) => (reg.gravar(evs), [{ enfileirados: evs.length, sem_registro: true }]) } });
  const [completa] = herdar(r, origem, { phi: phiDoProjeto, perguntas: reg });
  assert.equal(completa.completa, rebaixada.sha);
  assert.match(completa.pergunta, c.PERGUNTA_ID_RE);
  assert.match(r.trailers(), new RegExp(`^Conducao-Pergunta: ${completa.pergunta}`, "m"));
  const [depois] = herdar(r, origem, { phi: phiDoProjeto, perguntas: reg });
  assert.equal(depois.repetida, true);
  assert.equal(depois.sha, completa.sha, "a que afirma a pergunta vence: nenhuma terceira marca");
});

describe("na fonte: o registro e o gate de PHI do projeto", { skip: !NA_FONTE && FORA }, () => {
  for (const [nome, fn] of NA_FONTE_TESTES) test(nome, fn);
});
