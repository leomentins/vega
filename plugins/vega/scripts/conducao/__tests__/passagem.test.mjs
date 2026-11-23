/**
 * passagem.test.mjs — a nota de passagem, o estado "em passagem" e a cerca do
 * par da posse (VEGA-37 T15).
 *
 * Cada teste monta um origin bare numa pasta temporária e a árvore da
 * condutora no ramo do ciclo, com o canonico de fixture e hooks desligados
 * (core.hooksPath=/dev/null). O estado em passagem passa pela CLI, como a
 * condutora o chama (a fixture não declara leitor de posse: a cerca pula, com
 * o pulo na saída). A cerca do par entra pelos verbos chamados direto, com o
 * leitor da posse trocado por `trocarLeitorDaPosse`, como a declaração e o
 * banco o dariam.
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALVO_NOTA_TOKENS,
  SECOES_DA_NOTA,
  autorizarCiclo,
  conferirMoldeDaNota,
  desistirDaPassagem,
  exigirPosse,
  passagemAberta,
  passar,
  trocarLeitorDaPosse,
} from "../git-conducao.mjs";
import { posseDoProjeto } from "../adaptador.mjs";
import { ErroPlano } from "../ler-plano.mjs";
import { lerMarcas } from "../marcas.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-15-passagem";
const PASTA = `.agents/ciclo/teste/${CICLO}`;
const CAMINHO = `${PASTA}/canonico.md`;

function task(id) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE15-1]",
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

/** Corpo no molde, com `extra` caracteres de enchimento no Estado. */
function corpoNoMolde(extra = 0) {
  return SECOES_DA_NOTA.map((s) => `## ${s}\n\n${s === "Estado" ? `T1 e T2 por abrir. ${"x".repeat(extra)}` : `texto de ${s}`}\n`).join("\n");
}

function ambiente(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "passagem-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const arvore = path.join(raiz, "arvore");
  mkdirSync(arvore);
  const g = (...a) => execFileSync("git", ["-C", arvore, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "ciclo-teste");
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g("config", k, v);
  g("remote", "add", "origin", origin);
  mkdirSync(path.join(arvore, PASTA), { recursive: true });
  writeFileSync(path.join(arvore, "README.md"), "fixture\n");
  writeFileSync(path.join(arvore, CAMINHO), canonico());
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  // Ciclo de 2 níveis declarado: sem a marca, o núcleo roda em 3 (D10c do L4).
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 2", "-m", "Conducao-Niveis: 2");
  g("push", "-q", "origin", "ciclo-teste");
  const nota = path.join(raiz, "nota.md");
  writeFileSync(nota, corpoNoMolde());
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", arvore, "--ciclo", CICLO], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const linhas = r.stdout.split("\n").filter(Boolean);
    return { status: r.status, stderr: r.stderr, saida: linhas.length === 1 ? JSON.parse(linhas[0]) : null };
  };
  const ok = (...args) => {
    const r = cli(...args);
    assert.equal(r.status, 0, `${args.join(" ")} → ${r.status}\n${r.stderr}`);
    return r.saida;
  };
  return { raiz, arvore, g, cli, ok, nota };
}

/** Troca o leitor da posse só no teste; devolve o anterior no fim. */
function comPosse(t, posse) {
  const antes = trocarLeitorDaPosse(typeof posse === "function" ? posse : () => posse);
  t.after(() => trocarLeitorDaPosse(antes));
}

function recusa(fn, codigo) {
  assert.throws(fn, (e) => e instanceof ErroPlano && e.codigo === codigo, `esperada recusa ${codigo}`);
}

const DONA = Object.freeze({ estado: "dona", ciclo: CICLO, lock_id: "11111111-2222-3333-4444-555555555555", epoca: 2, epoca_gravada: 2 });

// ── em passagem ──────────────────────────────────────────────────────────────

test("em passagem o abrir e a publicação recusam", (t) => {
  const a = ambiente(t);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1", "--pergunta", "p-00000000000000a1");
  const p = a.ok("passar", "F1", "--nota", a.nota);
  assert.equal(p.acao, "em-passagem");
  assert.equal(p.nota, `${PASTA}/notes/passagem-F1-1.md`);
  assert.deepEqual(p.pulos, [{ passo: "posse", motivo: "projeto-sem-leitor-de-posse" }]);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: F1 em passagem");
  assert.equal(a.g("show", "--name-only", "--format=", "HEAD"), p.nota, "a nota e a marca saem num commit só");

  const abrir = a.cli("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto");
  assert.equal(abrir.status, 1);
  assert.match(abrir.stderr, /em-passagem/);
  assert.equal(a.g("ls-remote", "origin", `refs/conducao/${CICLO}/T1/1`), "", "nada foi aberto no origin");
  const publicar = a.cli("registrar-conferencia", "T1", "--manual", "--sim", "sim, publica", "--publicacao", "feita");
  assert.equal(publicar.status, 1);
  assert.match(publicar.stderr, /em-passagem/);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: F1 em passagem", "nada gravado em passagem");

  // Fora dela, segue como antes.
  assert.equal(a.ok("desistir-da-passagem", "F1", "--motivo", "herdeira não partiu").acao, "passagem-desistida");
  assert.equal(passagemAberta(lerMarcas(a.arvore)), null);
  assert.equal(a.ok("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto").acao, "aberta");
});

test("passar só em fronteira limpa: tentativa em voo e filha viva recusam", (t) => {
  const a = ambiente(t);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim", "--pergunta", "p-00000000000000a1");
  const viva = a.cli("passar", "F1", "--nota", a.nota, "--entrada", JSON.stringify({ filhas: [{ sessao: "session_x", task: "T2", estado: "RUNNING" }] }));
  assert.equal(viva.status, 1);
  assert.match(viva.stderr, /fronteira-suja.*session_x/);
  a.ok("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto");
  const voo = a.cli("passar", "F1", "--nota", a.nota);
  assert.equal(voo.status, 1);
  assert.match(voo.stderr, /fronteira-suja.*T1\/1 em voo/);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: F1 autorizada", "nada gravado fora da fronteira");
});

test("nota fora do molde ou acima do alvo é recusada", () => {
  recusa(() => conferirMoldeDaNota(corpoNoMolde().replace("## Tentado e descartado", "## Outra coisa")), "nota-fora-do-molde");
  recusa(() => conferirMoldeDaNota(corpoNoMolde().replace(/## Próximo passo[\s\S]*$/, "")), "nota-fora-do-molde");
  recusa(() => conferirMoldeDaNota(`---\nid: x\n---\n${corpoNoMolde()}`), "nota-fora-do-molde");
  recusa(() => conferirMoldeDaNota(corpoNoMolde(ALVO_NOTA_TOKENS * 4)), "nota-acima-do-alvo");
  assert.ok(conferirMoldeDaNota(corpoNoMolde()) <= ALVO_NOTA_TOKENS);
});

test("a nota leva na cabeça a época, o lock_id e a ponta, e a seguinte numera k+1", (t) => {
  const a = ambiente(t);
  comPosse(t, DONA);
  autorizarCiclo({ repo: a.arvore, ciclo: CICLO, fase: "F1", sim: "sim", pergunta: "p-00000000000000a1" });
  const ponta = a.g("rev-parse", "HEAD");
  const p = passar({ repo: a.arvore, ciclo: CICLO, fase: "F1", corpo: corpoNoMolde() });
  assert.equal(p.epoca, 2);
  assert.equal(p.lock_id, DONA.lock_id);
  const texto = readFileSync(path.join(a.arvore, p.nota), "utf8");
  assert.match(texto, /^---\nid: ciclo\/TESTE-15-passagem\/notes\/passagem-F1-1\n/);
  assert.match(texto, /\nepoca: 2\n/);
  assert.match(texto, new RegExp(`\\nlock_id: ${DONA.lock_id}\\n`));
  assert.match(texto, new RegExp(`\\nponta: ${ponta}\\n`));
  assert.match(texto, /# Passagem de F1 — TESTE-15-passagem, época 2\n\n## Objetivo/);
  const marca = passagemAberta(lerMarcas(a.arvore));
  assert.equal(marca.epoca, "2");
  assert.equal(marca.lock, DONA.lock_id);
  assert.equal(marca.ponta, ponta);
  recusa(() => passar({ repo: a.arvore, ciclo: CICLO, fase: "F1", corpo: corpoNoMolde() }), "em-passagem");
  desistirDaPassagem({ repo: a.arvore, ciclo: CICLO, fase: "F1" });
  const segunda = passar({ repo: a.arvore, ciclo: CICLO, fase: "F1", corpo: corpoNoMolde() });
  assert.equal(segunda.nota, `${PASTA}/notes/passagem-F1-2.md`);
  assert.ok(existsSync(path.join(a.arvore, segunda.nota)));
});

// ── cerca do par da posse ────────────────────────────────────────────────────

test("marca com época velha é recusada", (t) => {
  const a = ambiente(t);
  const antes = a.g("rev-parse", "HEAD");
  // A árvore gravou a época 2; a posse está na 3 com o mesmo lock_id: a sessão não é a da posse.
  comPosse(t, { ...DONA, epoca: 3, epoca_gravada: 2 });
  recusa(() => autorizarCiclo({ repo: a.arvore, ciclo: CICLO, fase: "F1", sim: "sim", pergunta: "p-00000000000000a1" }), "epoca-velha");
  assert.equal(a.g("rev-parse", "HEAD"), antes, "nada gravado com a época velha");
  assert.equal(a.g("ls-remote", "origin", `refs/conducao/${CICLO}/copia`), "", "a cópia não subiu");
  // Igualdade, nunca "menor": a posse nova que recomeça em 1 também recusa a sessão da época 2.
  comPosse(t, { ...DONA, epoca: 1, epoca_gravada: 2 });
  recusa(() => autorizarCiclo({ repo: a.arvore, ciclo: CICLO, fase: "F1", sim: "sim", pergunta: "p-00000000000000a1" }), "epoca-velha");
  // Sem a chave gravada, a época da árvore é 1 (como no leitor da posse).
  const { epoca_gravada: _, ...semGravada } = DONA;
  comPosse(t, semGravada);
  recusa(() => autorizarCiclo({ repo: a.arvore, ciclo: CICLO, fase: "F1", sim: "sim", pergunta: "p-00000000000000a1" }), "epoca-velha");
  // O par igual passa: marca e cópia.
  comPosse(t, DONA);
  const ok = autorizarCiclo({ repo: a.arvore, ciclo: CICLO, fase: "F1", sim: "sim", pergunta: "p-00000000000000a1" });
  assert.equal(ok.acao, "autorizada");
  assert.equal(ok.copia.empurrada, true);
});

test("marca com banco fora é recusada", (t) => {
  const a = ambiente(t);
  const antes = a.g("rev-parse", "HEAD");
  for (const [posse, codigo] of [
    [{ estado: "nao-li", motivo: "banco inalcancavel" }, "posse-ilegivel"],
    [{ estado: "dona", ciclo: CICLO }, "posse-sem-epoca"],
    [{ estado: "dona", ciclo: CICLO, lock_id: DONA.lock_id, epoca: "2" }, "posse-sem-epoca"],
    [{ estado: "outra", motivo: "posse de outra em host-b" }, "posse-alheia"],
    [{}, "posse-ilegivel"],
  ]) {
    comPosse(t, posse);
    recusa(() => autorizarCiclo({ repo: a.arvore, ciclo: CICLO, fase: "F1", sim: "sim", pergunta: "p-00000000000000a1" }), codigo);
  }
  assert.equal(a.g("rev-parse", "HEAD"), antes, "nada gravado sem a posse lida");
  // Sem posse no banco (D-VEGA26-18), passa.
  comPosse(t, { estado: "sem-posse", ciclo: CICLO });
  assert.equal(autorizarCiclo({ repo: a.arvore, ciclo: CICLO, fase: "F1", sim: "sim", pergunta: "p-00000000000000a1" }).acao, "autorizada");
});

test("a cópia não sobe com a posse passada: a marca fica e o desfecho diz o remédio", (t) => {
  const a = ambiente(t);
  let chamada = 0;
  // A posse passa entre a marca e a cópia: a primeira leitura é a da dona, a segunda já não.
  comPosse(t, () => (++chamada === 1 ? DONA : { estado: "outra", motivo: "posse de outra árvore" }));
  const s = autorizarCiclo({ repo: a.arvore, ciclo: CICLO, fase: "F1", sim: "sim", pergunta: "p-00000000000000a1" });
  assert.equal(s.acao, "registrado-sem-copia");
  assert.equal(s.motivo, "posse-alheia");
  assert.equal(a.g("ls-remote", "origin", `refs/conducao/${CICLO}/copia`), "");
});

test("o leitor declarado que sai ≠ 0 vira posse ilegível, e o par da dona chega à cerca", (t) => {
  const raiz = mkdtempSync(path.join(tmpdir(), "passagem-leitor-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  mkdirSync(path.join(raiz, ".vega"));
  const declarar = (leitor) =>
    writeFileSync(
      path.join(raiz, ".vega", "declaracao.json"),
      JSON.stringify({ esquema: 1, papel: "consumidor", versao: { corpo: "1.0.0" }, decisoes: { destino: "banco" }, posse: { comando: ["node", leitor] } }),
    );
  // O banco fora, visto pelo processo do leitor: sai 3.
  const fora = path.join(raiz, "posse-fora.mjs");
  writeFileSync(fora, "process.exit(3);\n");
  declarar(fora);
  const ilegivel = posseDoProjeto(raiz);
  assert.equal(ilegivel.estado, "nao-li");
  recusa(() => exigirPosse({ repo: raiz, ciclo: CICLO, posse: ilegivel }), "posse-ilegivel");
  // A dona com o par: o adaptador passa `lock_id`, `epoca` e `epoca_gravada` como vieram.
  const dona = path.join(raiz, "posse-dona.mjs");
  writeFileSync(dona, `process.stdout.write(${JSON.stringify(JSON.stringify(DONA))} + "\\n");\n`);
  declarar(dona);
  const lida = posseDoProjeto(raiz);
  assert.deepEqual({ ...lida }, { ...DONA });
  assert.deepEqual(exigirPosse({ repo: raiz, ciclo: CICLO, posse: lida }), { estado: "dona", lock_id: DONA.lock_id, epoca: 2 });
});
