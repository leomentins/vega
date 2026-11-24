/**
 * condutora-empurra-ramo.test.mjs — a condutora empurra o ramo do ciclo no
 * fechamento da fase (VEGA-37 T9).
 *
 * `empurrarRamo` (git-conducao.mjs) sobre repos git temporários com um origin
 * nu ao lado e hooks desligados (core.hooksPath=/dev/null); a posse e a
 * proposta entram por injeção, como a declaração e o `gh` as dariam. O leitor
 * da posse pelo `posse.comando` da declaração (`posseDoProjeto`, processo
 * trocado) e a recusa de campo `posse` no código (D-VEGA37-26) fecham a fiação.
 * O caso que lê a declaração da Sistoli mora em
 * `.claude/scripts/vega/__tests__/posse-da-declaracao.test.mjs` (D-VEGA37-28).
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ESTADOS_DA_POSSE, posseDoProjeto, validarCodigo } from "../adaptador.mjs";
import { empurrarRamo, ramoNoOrigin } from "../git-conducao.mjs";
import { ErroPlano } from "../ler-plano.mjs";
import { linhasDoEvento } from "../log-eventos.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const RAMO = "ciclo-TESTE-9-ramo";
const ABERTA = () => ({ number: 77, state: "OPEN" });

function novoRepo(t) {
  const dir = pastaTemporaria("condutora-empurra-ramo-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const origin = path.join(dir, "origin.git");
  const arvore = path.join(dir, "arvore");
  const g = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["init", "-q", "-b", RAMO, arvore]);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g(arvore, "config", k, v);
  g(arvore, "remote", "add", "origin", origin);
  writeFileSync(path.join(arvore, "README.md"), "um\n");
  g(arvore, "add", "README.md");
  g(arvore, "commit", "-q", "-m", "base");
  const head = () => g(arvore, "rev-parse", "HEAD");
  const noOrigin = () => {
    try {
      return g(origin, "rev-parse", `refs/heads/${RAMO}`);
    } catch {
      return null;
    }
  };
  return { arvore, origin, g, head, noOrigin };
}

function recusa(fn, codigo) {
  assert.throws(fn, (e) => e instanceof ErroPlano && e.codigo === codigo, `esperada recusa ${codigo}`);
}

test("empurrar-ramo recusa árvore que não é a dona", (t) => {
  const r = novoRepo(t);
  const head = r.head();
  recusa(() => empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head, posse: { estado: "outra", motivo: "posse de outra em host-b" }, lerProposta: ABERTA }), "posse-alheia");
  assert.equal(r.noOrigin(), null, "a árvore alheia não empurrou nada");
  const ok = empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head, posse: { estado: "dona", ciclo: "TESTE-9" }, lerProposta: ABERTA });
  assert.equal(ok.acao, "ramo-empurrado");
  assert.equal(ok.sha, head);
  assert.equal(ok.posse, "dona");
  assert.equal(ok.proposta, 77);
  assert.deepEqual(ok.pulos, []);
  assert.equal(ok.motivo, null, "sem pulo, sem motivo");
  assert.equal(r.noOrigin(), head, "a dona empurrou o HEAD para o ramo no origin");
  assert.deepEqual(ramoNoOrigin(r.arvore), { nome: RAMO, noOrigin: head }, "a referência de rastreio acompanha o push");
});

test("empurrar-ramo recusa posse que não se leu e passa sem posse no banco", (t) => {
  const r = novoRepo(t);
  const head = r.head();
  recusa(() => empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head, posse: { estado: "nao-li", motivo: "banco inalcancavel" }, lerProposta: ABERTA }), "posse-ilegivel");
  assert.equal(r.noOrigin(), null);
  const ok = empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head, posse: { estado: "sem-posse" }, lerProposta: ABERTA });
  assert.equal(ok.posse, "sem-posse");
  assert.equal(r.noOrigin(), head);
});

test("projeto sem leitor de posse empurra sem cerca, com o pulo registrado", (t) => {
  const r = novoRepo(t);
  const ok = empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head: r.head(), posse: null, lerProposta: ABERTA });
  assert.equal(ok.posse, null);
  assert.deepEqual(ok.pulos, [{ passo: "posse", motivo: "projeto-sem-leitor-de-posse" }]);
  assert.equal(r.noOrigin(), r.head());
});

test("empurrar-ramo exige o HEAD que o proximo emitiu e a proposta aberta", (t) => {
  const r = novoRepo(t);
  const dona = { estado: "dona" };
  recusa(() => empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head: "0123456789abcdef", posse: dona, lerProposta: ABERTA }), "head-nao-conferido");
  recusa(() => empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head: r.head(), posse: dona, lerProposta: () => null }), "sem-proposta");
  recusa(() => empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head: r.head(), posse: dona, lerProposta: () => ({ number: 77, state: "MERGED" }) }), "sem-proposta");
  assert.equal(r.noOrigin(), null, "nenhuma recusa empurrou");
  r.g(r.arvore, "checkout", "-q", "--detach");
  recusa(() => empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head: r.head(), posse: dona, lerProposta: ABERTA }), "ramo-destacado");
});

test("projeto sem proposta e sem CI empurra e pula inscrição e leitura de CI", (t) => {
  const r = novoRepo(t);
  let perguntou = false;
  const ok = empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head: r.head(), posse: null, temProposta: false, lerProposta: () => ((perguntou = true), null) });
  assert.equal(perguntou, false, "sem proposta declarada, o gh não é consultado");
  assert.equal(ok.proposta, null);
  assert.deepEqual(
    ok.pulos.map((p) => p.passo),
    ["posse", "inscrever-na-proposta", "ci"],
  );
  assert.equal(ok.motivo, "pulou:posse+inscrever-na-proposta+ci");
  // O pulo chega à linha do log de eventos pelo `motivo`, atributo da allowlist.
  const { linhas } = linhasDoEvento(ok, { procedencia: "registrado", quando: "2026-11-14T12:00:00Z" });
  assert.ok(linhas.some((l) => l.linha === "evento" && l.atributos?.motivo === ok.motivo), JSON.stringify(linhas));
  assert.equal(r.noOrigin(), r.head());
});

test("empurrar-ramo nunca força: origin à frente recusa e fica como estava", (t) => {
  const r = novoRepo(t);
  const dona = { estado: "dona" };
  empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head: r.head(), posse: dona, lerProposta: ABERTA });
  // Outro clone avança o ramo no origin.
  const outro = path.join(path.dirname(r.arvore), "outro");
  execFileSync("git", ["clone", "-q", "-b", RAMO, r.origin, outro]);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "outro"], ["user.email", "outro@example.invalid"], ["commit.gpgsign", "false"]]) r.g(outro, "config", k, v);
  r.g(outro, "commit", "-q", "--allow-empty", "-m", "do outro");
  r.g(outro, "push", "-q", "origin", RAMO);
  const doOutro = r.g(outro, "rev-parse", "HEAD");
  r.g(r.arvore, "commit", "-q", "--allow-empty", "-m", "daqui");
  recusa(() => empurrarRamo({ repo: r.arvore, ciclo: "TESTE-9", head: r.head(), posse: dona, lerProposta: ABERTA }), "ramo-push-recusado");
  assert.equal(r.noOrigin(), doOutro, "o commit do outro segue no origin");
});

test("o código do adaptador não ganha campo de posse: o adaptador do ramo segue válido sob main", () => {
  const base = {
    plano: { raiz: "docs", casa: () => true, ler: () => ({}), brief: () => [] },
    publicacao: [],
    caminhosProtegidos: [],
    telasProtegidasDosSteps: [],
    foraDasTelasDosSteps: [],
    carimbo: null,
    ci: null,
  };
  assert.equal("posse" in validarCodigo(base), false, "a posse não é campo do código (D-VEGA37-26)");
  assert.throws(() => validarCodigo({ ...base, posse: () => ({ estado: "dona" }) }), /campo desconhecido posse/);
  assert.deepEqual(ESTADOS_DA_POSSE, ["dona", "sem-posse", "outra", "nao-li"]);
});

/** Projeto mínimo com `.vega/declaracao.json`; `posse` entra só quando dado. */
function projeto(t, posse) {
  const dir = pastaTemporaria("condutora-posse-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, ".vega"));
  const d = { esquema: 1, papel: "consumidor", versao: { corpo: "1.0.0" }, decisoes: { destino: "banco" }, ...(posse ? { posse } : {}) };
  writeFileSync(path.join(dir, ".vega", "declaracao.json"), JSON.stringify(d));
  return dir;
}

test("posseDoProjeto sem posse.comando na declaração devolve null", (t) => {
  assert.equal(posseDoProjeto(projeto(t)), null, "sem o campo: sem cerca de posse");
  assert.equal(posseDoProjeto(path.join(tmpdir(), "sem-declaracao-nenhuma")), null, "sem declaração: sem cerca de posse");
});

test("posseDoProjeto roda o posse.comando da declaração e trata falha como nao-li", (t) => {
  const raiz = projeto(t, { comando: ["node", ".claude/scripts/estado/lib/posse.mjs", "dona"] });
  const rodou = [];
  const linha = (stdout, status = 0) => (cmd, args, op) => (rodou.push([cmd, args, op.cwd]), { status, stdout });
  assert.deepEqual(posseDoProjeto(raiz, { rodar: linha('log\n{"estado":"dona","ciclo":"VEGA-37"}\n') }), { estado: "dona", ciclo: "VEGA-37" });
  assert.equal(rodou[0][0], process.execPath, "`node` vira o executável corrente");
  assert.deepEqual(rodou[0][1], [".claude/scripts/estado/lib/posse.mjs", "dona", "--arvore", raiz]);
  assert.equal(rodou[0][2], raiz);
  assert.equal(posseDoProjeto(raiz, { rodar: linha("", 1) }).estado, "nao-li");
  assert.equal(posseDoProjeto(raiz, { rodar: linha("não é json") }).estado, "nao-li");
  assert.equal(posseDoProjeto(raiz, { rodar: linha('{"estado":"talvez"}') }).estado, "nao-li", "estado fora da lista não abre a cerca");
  assert.equal(posseDoProjeto(raiz, { rodar: () => ({ error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }) }) }).estado, "nao-li");
});
