/**
 * pergunta-citada-git.test.mjs — o sim citado se confere também no destino git (VEGA-19 T33;
 * AC-VEGA19-7; D-VEGA19-45, D-VEGA19-46, D-VEGA19-57).
 *
 * No projeto de exemplo do plugin (`exemplo/`, adaptador embutido `superpowers`, `decisoes.destino`
 * `git`), o `autorizar-ciclo --pergunta` confere a pergunta citada como na Sistoli: o registro é o
 * arquivo por sessão do destino git (`.vega/sessao-<id>.jsonl`), lido pelo `consentimentoDoProjeto()`
 * do embutido, e a `autoria` se reconfere contra um transcript dublê (`CLAUDE_CONFIG_DIR` do tmp)
 * por `pergunta/prova.mjs`. Pergunta de outro ciclo ou fase, "não", reuso, `autoria` sem prova, prova
 * que não resolve e origem `agente` recusam, nada gravado; a pergunta certa, provada, autoriza.
 * Projeto sem adaptador nenhum recusa o `--pergunta` (`registro-nao-declarado`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as c from "../consentimento.mjs";
import { ErroPlano } from "../ler-plano.mjs";
import { autorizarCiclo, conferirPerguntaDaHeranca } from "../git-conducao.mjs";
import { consentimentoDoProjeto, gravarEventosNoRegistro, lerEventosDoRegistro, PHI_DO_CASO } from "../adaptadores/superpowers.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const EXEMPLO = path.resolve(AQUI, "..", "..", "..", "exemplo");
const CICLO = "EXEMPLO-1-despedida";
const SIM = "sim, pode conduzir a F1";
const ABERTA = "2026-11-18T10:00:00.000Z";
const RESPONDIDA = "2026-11-18T10:05:00.000Z";
const chave = (...partes) => createHash("sha256").update(partes.join("|")).digest("hex");
const recusa = (codigo) => (e) => e instanceof ErroPlano && e.codigo === codigo;

let seq = 0;
const novoId = () => `p-${(0xc00 + ++seq).toString(16).padStart(16, "0")}`;

/** O exemplo num repositório git de tmp, com o registro em `.vega/` e a pasta de configuração do transcript. */
function exemplo(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "pergunta-citada-git-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const dir = path.join(raiz, "projeto");
  const config = path.join(raiz, "claude-config");
  cpSync(EXEMPLO, dir, { recursive: true });
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", `ciclo-${CICLO}`);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g("config", k, v);
  g("add", "-A");
  g("commit", "-q", "-m", "projeto de exemplo");
  const antes = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  t.after(() => (antes === undefined ? delete process.env.CLAUDE_CONFIG_DIR : (process.env.CLAUDE_CONFIG_DIR = antes)));
  return { dir, config, g, head: () => g("rev-parse", "HEAD") };
}

/**
 * Grava no registro do exemplo uma pergunta do autorizar (convenção da D-VEGA19-44): abertura,
 * resposta `literal` e — salvo `autoria: null` — a `autoria`, com a mensagem do operador no
 * transcript dublê. `abertura`, `autoria` e `mensagem` mudam a linha correspondente.
 */
function perguntaNoRegistro(e, { id = novoId(), fase = "F1", sim = SIM, literal = "a", abertura = {}, autoria = {}, mensagem = {} } = {}) {
  const sessao = `operador-${id}`;
  const transcript = path.join(e.config, "projects", "exemplo", `${sessao}.jsonl`);
  const prova = `transcript:${transcript}#u-${id}`;
  const comum = { pergunta_id: id, sessao, ciclo: CICLO, item: "D1", titulo: "sim do ciclo" };
  const linhas = [
    { chave: chave("abertura", id), versao_esquema: 1, evento: "abertura", carimbo: ABERTA, ...comum, ponteiro: `autorizar-ciclo:${fase}`, itens: [{ numero: 1, titulo: "sim do ciclo", opcoes: [{ letra: "a", texto: sim }, { letra: "b", texto: "não, espera" }] }], ...abertura },
    { chave: chave("resposta", id), versao_esquema: 1, evento: "resposta", carimbo: RESPONDIDA, ...comum, perguntado_em: ABERTA, resposta_literal: literal, escolha: literal.length === 1 ? literal : null, origem_resposta: "agente" },
  ];
  if (autoria !== null) {
    const a = { origem_resposta: "digitado", prova, ...autoria };
    linhas.push({ chave: chave("autoria", id, a.origem_resposta, a.prova), versao_esquema: 1, evento: "autoria", carimbo: RESPONDIDA, ...comum, ...a });
  }
  mkdirSync(path.join(e.dir, ".vega"), { recursive: true });
  writeFileSync(path.join(e.dir, ".vega", `sessao-${sessao}.jsonl`), linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
  mkdirSync(path.dirname(transcript), { recursive: true });
  const entrada = { uuid: `u-${id}`, sessionId: sessao, type: "user", origin: { kind: "human" }, timestamp: RESPONDIDA, message: { content: literal }, ...mensagem };
  writeFileSync(transcript, `${JSON.stringify(entrada)}\n`);
  return id;
}

const autorizar = (e, pergunta, { fase = "F1", sim = SIM } = {}) => autorizarCiclo({ repo: e.dir, ciclo: CICLO, fase, sim, pergunta });

test("no exemplo, a pergunta certa e provada autoriza, e o registro é o do destino git", (t) => {
  const e = exemplo(t);
  const pc = c.pecasDoConsentimento(e.dir);
  assert.equal(pc.falha, null, JSON.stringify(pc.falha));
  assert.equal(pc.semCodigoProprio, true);
  assert.equal(pc.phiPeloCaso, true, "phi = gate do caso (D-VEGA19-46, critério da D-VEGA19-57)");
  assert.equal(pc.phi, null);
  assert.equal(pc.perguntas.destino, "git");
  const id = perguntaNoRegistro(e);
  const r = autorizar(e, id);
  assert.ok(["autorizada", "registrado-sem-copia"].includes(r.acao), JSON.stringify(r));
  assert.equal(e.g("log", "-1", "--format=%s"), "Conducao: F1 autorizada");
  assert.equal(e.g("log", "-1", "--format=%(trailers:key=Conducao-Pergunta,valueonly)"), id);
  // A herança confere a mesma pergunta pela marca de origem, no mesmo registro.
  assert.equal(conferirPerguntaDaHeranca({ repo: e.dir, ciclo: CICLO, autorizacao: e.head() }), id);
});

test("no exemplo, pergunta de outro ciclo ou de outra fase recusa, nada gravado", (t) => {
  const e = exemplo(t);
  const antes = e.head();
  assert.throws(() => autorizar(e, perguntaNoRegistro(e, { abertura: { ciclo: "OUTRO-2" } })), recusa("pergunta-de-outro-ciclo"));
  assert.throws(() => autorizar(e, perguntaNoRegistro(e, { fase: "F2" })), recusa("pergunta-de-outra-fase"));
  assert.throws(() => autorizar(e, perguntaNoRegistro(e, { sim: "sim, outra coisa" })), recusa("sim-diferente-da-pergunta"));
  assert.equal(e.head(), antes, "0 commit");
});

test("no exemplo, a resposta não e o reuso recusam", (t) => {
  const e = exemplo(t);
  const antes = e.head();
  // "b" (não): a prova casa a letra b, que não é a opção do sim.
  assert.throws(() => autorizar(e, perguntaNoRegistro(e, { literal: "b" })), recusa("resposta-nao-autoriza"));
  // "não" por extenso não casa letra nenhuma: sem origem humana, nunca autoriza.
  assert.throws(() => autorizar(e, perguntaNoRegistro(e, { literal: "não" })), (x) => x instanceof ErroPlano && ["origem-sem-prova", "resposta-nao-autoriza"].includes(x.codigo));
  assert.equal(e.head(), antes, "0 commit");
  const id = perguntaNoRegistro(e);
  autorizar(e, id);
  const depois = e.head();
  assert.throws(() => autorizar(e, id), recusa("pergunta-reusada"));
  assert.equal(e.head(), depois, "o reuso não grava");
});

test("no exemplo, autoria sem prova, prova que não resolve e origem agente recusam", (t) => {
  const e = exemplo(t);
  const antes = e.head();
  const casos = [
    ["sem autoria", perguntaNoRegistro(e, { autoria: null })],
    ["autoria sem prova", perguntaNoRegistro(e, { autoria: { prova: undefined } })],
    ["prova de outro arquivo", perguntaNoRegistro(e, { autoria: { prova: `transcript:${path.join(e.config, "forjado.jsonl")}#u-x` } })],
    ["mensagem que não é humana", perguntaNoRegistro(e, { mensagem: { origin: { kind: "agent" } } })],
    ["mensagem antes da abertura", perguntaNoRegistro(e, { mensagem: { timestamp: "2026-11-18T09:00:00.000Z" } })],
    ["origem agente", perguntaNoRegistro(e, { autoria: { origem_resposta: "agente" } })],
  ];
  for (const [nome, id] of casos) assert.throws(() => autorizar(e, id), recusa("origem-sem-prova"), nome);
  // Pergunta citada que não está no registro também não autoriza.
  assert.throws(() => autorizar(e, "p-0000000000000fff"), (x) => x instanceof ErroPlano && ["origem-sem-prova", "pergunta-sem-abertura"].includes(x.codigo));
  assert.equal(e.head(), antes, "0 commit");
});

test("projeto sem adaptador nenhum recusa o --pergunta, nada gravado", (t) => {
  const e = exemplo(t);
  const decl = path.join(e.dir, ".vega", "declaracao.json");
  const bruto = JSON.parse(readFileSync(decl, "utf8"));
  const { codigo: _fora, ...conducao } = bruto.conducao;
  writeFileSync(decl, JSON.stringify({ ...bruto, conducao }));
  const id = perguntaNoRegistro(e);
  const antes = e.head();
  assert.equal(c.pecasDoConsentimento(e.dir).falha?.codigo, "registro-nao-declarado");
  assert.throws(() => autorizar(e, id), recusa("registro-nao-declarado"));
  assert.equal(e.head(), antes, "0 commit");
});

test("o registro git do embutido: sem destino git não há registro; grava só abertura e resposta, sem CPF/CNS", (t) => {
  const e = exemplo(t);
  // Destino banco declarado: o embutido não tem registro, e a pergunta citada recusa.
  const decl = path.join(e.dir, ".vega", "declaracao.json");
  const bruto = JSON.parse(readFileSync(decl, "utf8"));
  writeFileSync(decl, JSON.stringify({ ...bruto, decisoes: { destino: "banco" } }));
  assert.deepEqual(consentimentoDoProjeto({ repo: e.dir }), { phi: PHI_DO_CASO, perguntas: null });
  // A gravação: idempotente pela chave, recusa evento fora do consentimento e dado com a forma de CPF.
  const pasta = path.join(e.dir, "registro");
  const caso = { ciclo: CICLO, fase: "F1", caso: "instrucao-declarada-em-outputs", quando: ABERTA, sim: "sim" };
  const id = c.perguntaDoConsentimento(caso);
  const eventos = c.eventosDoConsentimento(caso, { pergunta_id: id, origem_resposta: "padrao-da-fabrica", ponteiro: "consentimento:padrao-da-fabrica" });
  assert.deepEqual(gravarEventosNoRegistro(pasta, eventos), { gravados: 2, ja_existiam: 0, enfileirados: 0 });
  assert.deepEqual(gravarEventosNoRegistro(pasta, eventos), { gravados: 0, ja_existiam: 2, enfileirados: 0 });
  const lidos = lerEventosDoRegistro(pasta);
  assert.deepEqual(lidos.eventos.map((x) => x.evento), ["abertura", "resposta"]);
  assert.equal(lidos.descartadas, 0);
  assert.throws(() => gravarEventosNoRegistro(pasta, [{ ...eventos[0], evento: "autoria" }]), /fora do consentimento/);
  const comCpf = c.eventosDoConsentimento({ ...caso, sim: `paciente ${["123", "456", "789"].join(".")}-09` }, { pergunta_id: c.perguntaDoConsentimento({ ...caso, fase: "F2" }), origem_resposta: "padrao-da-fabrica", ponteiro: "consentimento:padrao-da-fabrica" });
  assert.throws(() => gravarEventosNoRegistro(pasta, comCpf), /CPF\/CNS/);
  assert.equal(lerEventosDoRegistro(pasta).eventos.length, 2, "nada gravado com o CPF");
  // Linha torta num arquivo de sessão: a leitura a descarta e conta, sem o conteúdo.
  writeFileSync(path.join(pasta, "sessao-torta.jsonl"), "{ torta\n");
  assert.equal(lerEventosDoRegistro(pasta).descartadas, 1);
});

test("no exemplo, linha de chave forjada não entra e linhas divergentes da mesma pergunta recusam", (t) => {
  const e = exemplo(t);
  const antes = e.head();
  // Uma abertura com chave que não é a do evento, num arquivo que vem antes na ordem: fica fora.
  const id = perguntaNoRegistro(e);
  const forjada = { chave: "f".repeat(64), versao_esquema: 1, evento: "abertura", pergunta_id: id, sessao: "0", carimbo: "2026-11-18T09:00:00.000Z", ciclo: CICLO, ponteiro: "autorizar-ciclo:F2", itens: [] };
  writeFileSync(path.join(e.dir, ".vega", "sessao-0.jsonl"), `${JSON.stringify(forjada)}\n`);
  assert.equal(lerEventosDoRegistro(path.join(e.dir, ".vega")).descartadas, 1);
  // A mesma chave (a da abertura) com conteúdo diferente: a pergunta recusa, nunca escolhe uma.
  const divergente = { ...forjada, chave: chave("abertura", id), ponteiro: "autorizar-ciclo:F1", itens: [{ numero: 1, opcoes: [{ letra: "a", texto: SIM }] }] };
  writeFileSync(path.join(e.dir, ".vega", "sessao-0.jsonl"), `${JSON.stringify(divergente)}\n`);
  assert.ok(lerEventosDoRegistro(path.join(e.dir, ".vega")).divergentes.has(id));
  assert.throws(() => autorizar(e, id), recusa("origem-sem-prova"));
  assert.equal(e.head(), antes, "0 commit");
  // A ordem das chaves e a sessão da linha não contam como divergência.
  const outra = perguntaNoRegistro(e);
  const arquivo = path.join(e.dir, ".vega", `sessao-operador-${outra}.jsonl`);
  const [ab] = readFileSync(arquivo, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const reordenada = Object.fromEntries(Object.entries({ ...ab, sessao: "outra-sessao" }).reverse());
  writeFileSync(path.join(e.dir, ".vega", "sessao-outra-sessao.jsonl"), `${JSON.stringify(reordenada)}\n`);
  assert.equal(lerEventosDoRegistro(path.join(e.dir, ".vega")).divergentes.has(outra), false);
});

test("no exemplo, a opção sim no lugar da letra não autoriza", (t) => {
  const e = exemplo(t);
  const id = perguntaNoRegistro(e, { literal: "sim", abertura: { itens: [{ numero: 1, opcoes: [{ letra: "sim", texto: SIM }] }] }, mensagem: { message: { content: "sim" } } });
  const antes = e.head();
  assert.throws(() => autorizar(e, id), (x) => x instanceof ErroPlano && ["resposta-nao-autoriza", "origem-sem-prova"].includes(x.codigo));
  assert.equal(e.head(), antes, "0 commit");
});

test("o PHI_DO_CASO do embutido é o do núcleo, e o registro recusa CPF e CNS colados em letra ou com ponto", () => {
  assert.equal(PHI_DO_CASO, c.PHI_DO_CASO);
  const pasta = mkdtempSync(path.join(tmpdir(), "registro-phi-"));
  try {
    for (const [i, sim] of [["cpf", "12345678", "909"].join(""), ["CNS:", "89800116", "0073035", "x"].join(""), ["cns ", "898", ".0011.", "6007.", "3035"].join("")].entries()) {
      const caso = { ciclo: CICLO, fase: `F${i + 1}`, caso: "instrucao-declarada-em-outputs", quando: ABERTA, sim };
      const ev = c.eventosDoConsentimento(caso, { pergunta_id: c.perguntaDoConsentimento(caso), origem_resposta: "padrao-da-fabrica", ponteiro: "consentimento:padrao-da-fabrica" });
      assert.throws(() => gravarEventosNoRegistro(pasta, ev), (x) => x.message.includes("forma de CPF"), sim);
    }
    assert.equal(lerEventosDoRegistro(pasta).eventos.length, 0);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
