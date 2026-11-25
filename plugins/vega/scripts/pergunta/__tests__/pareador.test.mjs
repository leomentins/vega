/**
 * pareador.test.mjs — o pareador de autoria do plugin num consumidor (hotfix vega-pareador-no-plugin,
 * 25/11/2026; decisão 27a do operador; débito ae-vega-autoria-sem-pareador-no-consumidor).
 *
 * O projeto é o `exemplo/` do plugin copiado para um repositório de tmp: adaptador embutido
 * `superpowers`, `decisoes.destino` `git`, e NENHUM gancho de projeto da Sistoli. O gancho que roda
 * é o do plugin (`hooks/pergunta-pareador.mjs`), em processo próprio, com o payload do `Stop`. O
 * transcript é um dublê na pasta de configuração do tmp (`CLAUDE_CONFIG_DIR`).
 *
 * O que se prova: o turno digitado pelo operador passa (`digitado` em 2 níveis; o recibo conferido
 * pelo `get_event` da mensagem dele na maestra, em 3); o texto que só chegou por `send_message` não
 * passa (remetente sem recibo ⇒ `agente`; recibo sem `get_event` ⇒ `repasse-hub`, que a condutora
 * recusa; `get_event` de evento sintético ou de outro `send_message` ⇒ não confere); mensagem
 * sintética nunca vale; o `resposta-da-maestra` no mesmo turno não espera o Stop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErroPlano } from "../../conducao/ler-plano.mjs";
import { autorizarCiclo, respostaDaMaestra } from "../../conducao/git-conducao.mjs";
import { consentimentoDoProjeto } from "../../conducao/adaptadores/superpowers.mjs";
import { passosDeAdotar, projetoDeclaraPosse } from "../../conducao/conducao.mjs";
import { raizPadrao } from "../comando.mjs";
import { aberturasDoTurno, parearTranscript } from "../pareador.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(AQUI, "..", "..", "..");
const EXEMPLO = path.join(PLUGIN, "exemplo");
const GANCHO = path.join(PLUGIN, "hooks", "pergunta-pareador.mjs");
const CICLO = "EXEMPLO-1-despedida";
const SIM = "sim, pode conduzir a F1";
const MAESTRA = "session_01MaestraDoTeste0000000";
const ABERTA = "2026-11-25T18:35:04.190Z";
const MOSTRADA = "2026-11-25T18:35:04.226Z";
const DIGITADA = "2026-11-25T18:43:47.501Z";
const chave = (...partes) => createHash("sha256").update(partes.join("|")).digest("hex");
const recusa = (codigo) => (e) => e instanceof ErroPlano && e.codigo === codigo;

let seq = 0;
const novoId = () => `p-${(0xd00 + ++seq).toString(16).padStart(16, "0")}`;
const novaSessao = () => `0e40409a-5b19-5152-bf40-${String(++seq).padStart(12, "0")}`;

/** O exemplo num git de tmp, em 2 ou 3 níveis, com a pasta de configuração do transcript. */
function consumidor(t, { niveis = 2, declaracao = null } = {}) {
  const raiz = pastaTemporaria("pareador-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const dir = path.join(raiz, "projeto");
  const config = path.join(raiz, "claude-config");
  cpSync(EXEMPLO, dir, { recursive: true });
  if (declaracao) {
    const p = path.join(dir, ".vega", "declaracao.json");
    writeFileSync(p, JSON.stringify(declaracao(JSON.parse(readFileSync(p, "utf8"))), null, 2));
  }
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", `ciclo-${CICLO}`);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g("config", k, v);
  g("add", "-A");
  g("commit", "-q", "-m", "projeto de exemplo");
  g("commit", "-q", "--allow-empty", "-m", `Conducao: ciclo niveis ${niveis}`, "-m", `Conducao-Niveis: ${niveis}`);
  const antes = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  t.after(() => (antes === undefined ? delete process.env.CLAUDE_CONFIG_DIR : (process.env.CLAUDE_CONFIG_DIR = antes)));
  return { dir, config, g, head: () => g("rev-parse", "HEAD") };
}

/**
 * A pergunta do autorizar aberta pela condutora (`sessao`), gravada no registro como o
 * `comando.mjs abrir` grava (esquema 2, rota para o operador), e o transcript dela com o bloco e a
 * marca na saída do `abrir`. `depois` = as entradas do transcript que seguem o bloco.
 */
function perguntaAberta(e, { id = novoId(), sessao = novaSessao(), depois = [] } = {}) {
  const abertura = {
    chave: chave("abertura", id), versao_esquema: 2, evento: "abertura", pergunta_id: id, carimbo: ABERTA, sessao, ciclo: CICLO,
    ponteiro: "autorizar-ciclo:F1", item: "D1", titulo: "sim do ciclo", papel: "operador",
    rota: { de: null, por: "direto", para: { papel: "operador", mandato: "engenharia", quem: "pessoa" } },
    itens: [{ numero: 1, titulo: "sim do ciclo", opcoes: [{ letra: "a", texto: SIM }, { letra: "b", texto: "não, espera" }], recomendada: "a" }],
  };
  mkdirSync(path.join(e.dir, ".vega"), { recursive: true });
  writeFileSync(path.join(e.dir, ".vega", `sessao-${sessao}.jsonl`), `${JSON.stringify(abertura)}\n`);
  const transcript = path.join(e.config, "projects", "exemplo", `${sessao}.jsonl`);
  mkdirSync(path.dirname(transcript), { recursive: true });
  const bloco = { uuid: `bloco-${id}`, sessionId: sessao, type: "user", timestamp: MOSTRADA, message: { content: [{ type: "tool_result", tool_use_id: `abrir-${id}`, content: `**Decisão de engenharia — sim do ciclo**\n\nD1. sim do ciclo\n- (a) ${SIM}\n- (b) não, espera\n\n<!-- pergunta ${id} -->` }] } };
  const entradas = [bloco, ...depois.map((x) => ({ sessionId: sessao, ...x }))];
  writeFileSync(transcript, entradas.map((x) => JSON.stringify(x)).join("\n") + "\n");
  return { id, sessao, transcript };
}

const digitada = (texto, extra = {}) => ({ uuid: "op-1", type: "user", origin: { kind: "human" }, timestamp: DIGITADA, message: { content: texto }, ...extra });
const doSendMessage = (texto, { de = MAESTRA, uuid = "rep-1", quando = "2026-11-25T18:44:00.000Z" } = {}) => ({ uuid, type: "user", timestamp: quando, message: { content: `<cross-session-message from-session="${de}">\n${texto}\n</cross-session-message>` } });
const repasse = (id, { recibo = `${MAESTRA} ev-op` } = {}) => `RESPOSTA ${id}\nDecisão D1: a · operador${recibo ? `\nRecibo: ${recibo}` : ""}`;
/** A chamada do `get_event` sobre o recibo e o resultado dela, com o evento `ev` (ou erro). */
function getEvent(ev, { sessao = MAESTRA, evento = "ev-op", erro = false } = {}) {
  return [
    { uuid: "ge-chamada", type: "assistant", timestamp: "2026-11-25T18:44:05.000Z", message: { content: [{ type: "tool_use", id: "tu-ge", name: "mcp__claude-code-remote__get_event", input: { session_id: sessao, event_uuid: evento } }] } },
    { uuid: "ge-resultado", type: "user", timestamp: "2026-11-25T18:44:06.000Z", message: { content: [{ type: "tool_result", tool_use_id: "tu-ge", is_error: erro, content: JSON.stringify(ev) }] } },
  ];
}
/** O evento do operador digitando na maestra, na forma do `get_event` real. */
const eventoDoOperador = (texto = "1a", extra = {}) => ({ created_at: DIGITADA, user: { uuid: "ev-op", internal_anthropic_catchall: { client_platform: "android", message: { role: "user", content: texto, ...extra } } } });

/** O gancho do plugin em processo próprio, com o payload do Stop. */
function stop(e, p, { env = {} } = {}) {
  const r = spawnSync(process.execPath, [GANCHO], { input: JSON.stringify({ session_id: p.sessao, transcript_path: p.transcript, cwd: e.dir, hook_event_name: "Stop" }), encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: e.config, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return { stdout: r.stdout, linhas: readFileSync(path.join(e.dir, ".vega", `sessao-${p.sessao}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)) };
}
const origem = (e, id) => consentimentoDoProjeto({ repo: e.dir }).perguntas.origemEfetiva(id);
const autorizar = (e, id) => autorizarCiclo({ repo: e.dir, ciclo: CICLO, fase: "F1", sim: SIM, pergunta: id });

test("2 níveis: o turno digitado pelo operador na sessão da abertura grava autoria digitado, e o sim passa", (t) => {
  const e = consumidor(t);
  const p = perguntaAberta(e, { depois: [digitada("1a")] });
  const { linhas } = stop(e, p);
  const autoria = linhas.find((l) => l.evento === "autoria");
  assert.equal(autoria.origem_resposta, "digitado");
  assert.equal(autoria.prova, `transcript:${p.transcript}#op-1`);
  assert.equal(autoria.chave, chave("autoria", p.id, "digitado", autoria.prova));
  assert.equal(autoria.mandato, "engenharia");
  // Sem `responder` do agente, o pareador grava a resposta com as letras ecoadas, origem agente.
  const resposta = linhas.find((l) => l.evento === "resposta");
  assert.equal(resposta.origem_resposta, "agente");
  assert.deepEqual(resposta.escolhas, [{ numero: 1, letra: "a" }]);
  assert.equal(origem(e, p.id).origem, "digitado");
  const r = autorizar(e, p.id);
  assert.ok(["autorizada", "registrado-sem-copia"].includes(r.acao), JSON.stringify(r));
  assert.equal(e.g("log", "-1", "--format=%s"), "Conducao: F1 autorizada");
});

test("o mesmo Stop duas vezes não duplica, e a letra sozinha logo depois do bloco casa", (t) => {
  const e = consumidor(t);
  const p = perguntaAberta(e, { depois: [digitada("a")] });
  const primeiro = stop(e, p).linhas.length;
  const segundo = stop(e, p).linhas.length;
  assert.equal(primeiro, 3, "abertura, autoria e resposta");
  assert.equal(segundo, primeiro);
  assert.equal(origem(e, p.id).origem, "digitado");
});

test("mensagem marcada sintética, ou sem origem humana, nunca vira digitado", (t) => {
  const e = consumidor(t);
  for (const extra of [{ isSynthetic: true }, { origin: { kind: "agent" } }, { isMeta: true }]) {
    const p = perguntaAberta(e, { depois: [digitada("1a", extra)] });
    const { linhas } = stop(e, p);
    assert.equal(linhas.filter((l) => l.evento === "autoria").length, 0, JSON.stringify(extra));
    assert.throws(() => autorizar(e, p.id), (x) => x instanceof ErroPlano && ["origem-sem-prova", "resposta-ausente"].includes(x.codigo));
  }
});

test("texto por send_message de remetente sem recibo grava autoria agente, e o sim recusa origem-sem-prova", (t) => {
  const e = consumidor(t);
  const antes = e.head();
  // O repasse nomeia a pergunta (sem o id nada casa), mas não traz o recibo do remetente.
  const q = perguntaAberta(e, { depois: [doSendMessage(repasse("PID", { recibo: null }))] });
  writeFileSync(q.transcript, readFileSync(q.transcript, "utf8").replaceAll("PID", q.id));
  const { linhas } = stop(e, q);
  const autoria = linhas.find((l) => l.evento === "autoria");
  assert.equal(autoria.origem_resposta, "agente");
  assert.match(autoria.prova, new RegExp(`^entre-sessoes:${MAESTRA}#`));
  // O pareador não grava a resposta de um texto que não é do operador: a pergunta segue sem origem humana.
  assert.ok(!["digitado", "digitado-no-hub-conferido", "repasse-hub"].includes(origem(e, q.id).origem));
  assert.throws(() => autorizar(e, q.id), (x) => x instanceof ErroPlano && ["origem-sem-prova", "resposta-ausente"].includes(x.codigo));
  assert.equal(e.head(), antes, "0 commit");
});

test("3 níveis: o repasse com recibo mas sem get_event fica repasse-hub, e a condutora recusa recibo-nao-conferido", (t) => {
  const e = consumidor(t, { niveis: 3 });
  const p = perguntaAberta(e, { depois: [] });
  writeFileSync(p.transcript, readFileSync(p.transcript, "utf8") + JSON.stringify({ sessionId: p.sessao, ...doSendMessage(repasse(p.id)) }) + "\n");
  const { linhas } = stop(e, p);
  const autoria = linhas.find((l) => l.evento === "autoria");
  assert.equal(autoria.origem_resposta, "repasse-hub");
  assert.equal(autoria.detalhe?.motivo, "sem-chamada");
  assert.throws(() => respostaDaMaestra({ repo: e.dir, pergunta: p.id, maestra: MAESTRA }), recusa("recibo-nao-conferido"));
});

test("3 níveis: o recibo conferido pelo get_event da mensagem digitada na maestra passa, já no mesmo turno", (t) => {
  const e = consumidor(t, { niveis: 3 });
  const p = perguntaAberta(e, { depois: [doSendMessage(repasse(`PID`)), ...getEvent(eventoDoOperador("1a"))] });
  writeFileSync(p.transcript, readFileSync(p.transcript, "utf8").replaceAll("PID", p.id));
  // Antes do Stop: a autoria do turno sai do transcript, e o resposta-da-maestra não espera o gancho.
  // (A resposta é a que a condutora grava pelo `responder`; aqui, a do registro.)
  const resposta = { chave: chave("resposta", p.id), versao_esquema: 2, evento: "resposta", pergunta_id: p.id, carimbo: "2026-11-25T18:44:10.000Z", sessao: p.sessao, ciclo: CICLO, perguntado_em: ABERTA, ponteiro: "autorizar-ciclo:F1", item: "D1", titulo: "sim do ciclo", resposta_literal: "1a", escolha: "a", escolhas: [{ numero: 1, letra: "a" }], origem_resposta: "agente", recibo: `${MAESTRA} ev-op`, mandato: "engenharia" };
  writeFileSync(path.join(e.dir, ".vega", `sessao-${p.sessao}.jsonl`), readFileSync(path.join(e.dir, ".vega", `sessao-${p.sessao}.jsonl`), "utf8") + JSON.stringify(resposta) + "\n");
  const antes = respostaDaMaestra({ repo: e.dir, pergunta: p.id, maestra: MAESTRA });
  assert.equal(antes.acao, "aplicar");
  assert.equal(antes.origem, "digitado-no-hub-conferido");
  // Depois do Stop: gravada, a mesma origem; a resposta da condutora não se regrava.
  const { linhas } = stop(e, p);
  const autoria = linhas.find((l) => l.evento === "autoria");
  assert.equal(autoria.origem_resposta, "digitado-no-hub-conferido");
  assert.equal(autoria.prova, `get_event:${MAESTRA}#ge-resultado`);
  assert.equal(autoria.recibo, `${MAESTRA} ev-op`);
  assert.equal(linhas.filter((l) => l.evento === "resposta").length, 1);
  assert.equal(respostaDaMaestra({ repo: e.dir, pergunta: p.id, maestra: MAESTRA }).origem, "digitado-no-hub-conferido");
  // De outra maestra, a mesma resposta não vale.
  assert.throws(() => respostaDaMaestra({ repo: e.dir, pergunta: p.id, maestra: "session_01OutraMaestra000000000" }), recusa("resposta-de-outra-sessao"));
});

test("3 níveis: get_event de evento sintético, de outro send_message, com erro ou com outra letra não confere", (t) => {
  const e = consumidor(t, { niveis: 3 });
  const casos = [
    ["sintetico", getEvent(eventoDoOperador("1a", { isSynthetic: true }))],
    ["send_message", getEvent(eventoDoOperador(`<cross-session-message from-session="session_01Outra">\n1a\n</cross-session-message>`))],
    ["erro", getEvent({}, { erro: true })],
    ["outra letra", getEvent(eventoDoOperador("1b"))],
    ["outro evento", getEvent(eventoDoOperador("1a"), { evento: "ev-outro" })],
    // A forma viva da mensagem de par: prosa antes do embrulho, `isMeta` e origem de par.
    ["par com prosa", getEvent(eventoDoOperador(`Another Claude session sent a message:\n<cross-session-message from="bridge:x">\n1a\n</cross-session-message>`))],
    ["isMeta", getEvent(eventoDoOperador("1a", { isMeta: true }))],
    ["origem de par", getEvent(eventoDoOperador("1a", { origin: { kind: "peer" } }))],
  ];
  for (const [nome, ge] of casos) {
    const p = perguntaAberta(e, { depois: [doSendMessage(repasse("PID")), ...ge] });
    writeFileSync(p.transcript, readFileSync(p.transcript, "utf8").replaceAll("PID", p.id));
    const { linhas } = stop(e, p);
    const autoria = linhas.find((l) => l.evento === "autoria");
    assert.equal(autoria.origem_resposta, "repasse-hub", nome);
    assert.throws(() => respostaDaMaestra({ repo: e.dir, pergunta: p.id, maestra: MAESTRA }), recusa("recibo-nao-conferido"), nome);
  }
});

test("destino banco (a Sistoli) e o modo off: o gancho do plugin não grava nada", (t) => {
  const e = consumidor(t, { declaracao: (d) => ({ ...d, decisoes: { destino: "banco" } }) });
  const p = perguntaAberta(e, { depois: [digitada("1a")] });
  assert.equal(stop(e, p).linhas.length, 1, "só a abertura");
  const f = consumidor(t);
  const q = perguntaAberta(f, { depois: [digitada("1a")] });
  assert.equal(stop(f, q, { env: { VEGA_PERGUNTA_PAREADOR: "off" } }).linhas.length, 1);
});

test("a pergunta só do registro (sem a marca aqui) casa só por D<n><letra>, nunca por 1a", (t) => {
  const e = consumidor(t);
  const p = perguntaAberta(e, { depois: [] });
  const registro = readFileSync(path.join(e.dir, ".vega", `sessao-${p.sessao}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const semMarca = [digitada("1a", { gitBranch: `ciclo-${CICLO}` })];
  const ab = aberturasDoTurno(semMarca, registro);
  assert.equal(ab.get(p.id)?.doRegistro, true);
  assert.equal(parearTranscript(semMarca, { sessao: p.sessao, transcript: p.transcript, aberturas: ab }).eventos.length, 0);
  assert.equal(parearTranscript([digitada("D1a", { gitBranch: `ciclo-${CICLO}` })], { sessao: p.sessao, transcript: p.transcript, aberturas: ab }).eventos.filter((x) => x.evento === "autoria").length, 1);
  // De outro ciclo (o ramo não é o dela), a pergunta só do registro nem entra.
  assert.equal(aberturasDoTurno([digitada("D1a", { gitBranch: "ciclo-OUTRO-9" })], registro).size, 0);
  // Aberta nesta mesma sessão sem o bloco mostrado aqui: fora.
  assert.equal(aberturasDoTurno(semMarca, registro, { sessao: p.sessao }).size, 0);
});

test("comando.mjs sem --repo acha a declaração pela árvore do cwd (débito do ENSAIO-1)", (t) => {
  const e = consumidor(t);
  const sub = path.join(e.dir, "src");
  mkdirSync(sub, { recursive: true });
  assert.equal(raizPadrao(sub), execFileSync("git", ["-C", sub, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  // Fora de projeto declarado, a reserva (a raiz do corpo).
  assert.equal(raizPadrao(path.dirname(e.dir), { corpo: "/reserva" }), "/reserva");
  const r = spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "pergunta", "comando.mjs"), "ler", "--pergunta", novoId()], { cwd: sub, encoding: "utf8" });
  // O exemplo (embutido `superpowers`) não traz `pecasDaPergunta`: a recusa agora é essa, do
  // adaptador da declaração achada no cwd — antes era a declaração não achada na pasta do plugin.
  assert.doesNotMatch(r.stderr, /ilegivel/, r.stderr);
  assert.match(r.stderr, /superpowers\.mjs nao exporta pecasDaPergunta/, r.stderr);
});

test("o consumidor sem posse declarada não recebe os verbos; sem declaração, o texto de antes", (t) => {
  const e = consumidor(t);
  assert.equal(projetoDeclaraPosse(e.dir), false);
  const f = consumidor(t, { declaracao: (d) => ({ ...d, posse: { comando: ["node", "posse.mjs", "dona"] } }) });
  assert.equal(projetoDeclaraPosse(f.dir), true);
  assert.equal(projetoDeclaraPosse(path.dirname(e.dir)), true);
});

test("criar-condutora só cita os verbos de posse e de lane quando o projeto declara posse (débito do ENSAIO-1)", () => {
  const com = passosDeAdotar("X-1", { conferirReservas: true, migracao: true }).join("\n");
  assert.match(com, /troca\.mjs tomar-posse --ciclo X-1/);
  assert.match(com, /estado\.mjs lane ler/);
  const sem = passosDeAdotar("X-1", { conferirReservas: true, migracao: true, posse: false, principal: "main", ramoLocal: "conducao/X-1" }).join("\n");
  assert.doesNotMatch(sem, /tomar-posse|estado\.mjs|troca\.mjs|lane/);
  assert.match(sem, /git switch conducao\/X-1/);
});

test("achados da revisão: linha torta no registro avisa; resposta do agente sem autoria ainda pareia por D<n>", (t) => {
  const e = consumidor(t);
  const p = perguntaAberta(e, { depois: [digitada("1a")] });
  const arq = path.join(e.dir, ".vega", `sessao-${p.sessao}.jsonl`);
  writeFileSync(arq, readFileSync(arq, "utf8") + "{torta\n");
  const r = spawnSync(process.execPath, [GANCHO], { input: JSON.stringify({ session_id: p.sessao, transcript_path: p.transcript, cwd: e.dir }), encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: e.config } });
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).systemMessage, /linha\(s\) ilegivel/);
  // A pergunta aberta em outra sessão, já respondida pelo agente (`responder`), sem autoria: o D1a do operador aqui ainda grava a autoria.
  const f = consumidor(t);
  const q = perguntaAberta(f, { depois: [] });
  const resp = { chave: chave("resposta", q.id), versao_esquema: 2, evento: "resposta", pergunta_id: q.id, carimbo: DIGITADA, sessao: q.sessao, ciclo: CICLO, perguntado_em: ABERTA, item: "D1", titulo: "sim do ciclo", resposta_literal: "D1a", escolha: "a", escolhas: [{ numero: 1, letra: "a" }], origem_resposta: "agente" };
  const arq2 = path.join(f.dir, ".vega", `sessao-${q.sessao}.jsonl`);
  writeFileSync(arq2, readFileSync(arq2, "utf8") + JSON.stringify(resp) + "\n");
  const registro = readFileSync(arq2, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ab = aberturasDoTurno([digitada("D1a", { gitBranch: `ciclo-${CICLO}` })], registro);
  assert.equal(ab.get(q.id)?.doRegistro, true);
});

test("achado da revisão: projeto numa subpasta do repositório (monorepo) grava na declaração da subpasta", (t) => {
  const raiz = pastaTemporaria("pareador-mono-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const dir = path.join(raiz, "projeto");
  cpSync(EXEMPLO, path.join(dir, "app"), { recursive: true });
  execFileSync("git", ["init", "-q", dir]);
  const sub = path.join(dir, "app");
  const config = path.join(raiz, "claude-config");
  const e = { dir: sub, config };
  const antes = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  t.after(() => (antes === undefined ? delete process.env.CLAUDE_CONFIG_DIR : (process.env.CLAUDE_CONFIG_DIR = antes)));
  const p = perguntaAberta(e, { depois: [digitada("1a")] });
  assert.equal(stop(e, p).linhas.filter((l) => l.evento === "autoria").length, 1);
});

test("achado da releitura: o ramo casa o ciclo mais longo, nunca um prefixo dele", () => {
  const ab = (ciclo, id) => ({ evento: "abertura", pergunta_id: id, ciclo, sessao: "s", carimbo: ABERTA, itens: [{ numero: 3, opcoes: [{ letra: "a" }] }] });
  const reg = [ab("VEGA", "p-00000000000000aa"), ab("VEGA-19", "p-00000000000000bb")];
  const ids = [...aberturasDoTurno([digitada("D3a", { gitBranch: "ciclo-VEGA-19-x" })], reg).keys()];
  assert.deepEqual(ids, ["p-00000000000000bb"]);
});
