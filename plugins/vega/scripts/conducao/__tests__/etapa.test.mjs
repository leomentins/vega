/**
 * etapa.test.mjs — o pedido de nascimento de uma etapa do planejamento
 * (hotfix conducao-pedido-da-etapa, 23/11/2026).
 *
 * O verbo `etapa` devolve o pedido curto, em palavras, que o `create_session`
 * aceita (nunca abre com `/`), o `modelo` do tier da etapa na declaração e o
 * contrato de retorno (`<ETAPA> <saída> <sha8>` e `PERGUNTA <p-…>` com o
 * `comando.mjs abrir`). As etapas vêm do código do adaptador do projeto de
 * teste (`etapasDoPlanejamento`); a forma delas é conferida por `validarCodigo`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validarCodigo } from "../adaptador.mjs";
import { pedidoDaEtapa } from "../etapa.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "fixtures", "projeto-de-teste");
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");

/** Uma árvore git de mentira no ramo pedido (a árvore do ciclo que quem conduz adotou). */
const ARVORES = new Map();
function arvoreNoRamo(ramo) {
  if (!ARVORES.has(ramo)) {
    const d = pastaTemporaria("etapa-arvore-");
    const g = (...a) => execFileSync("git", ["-C", d, ...a], { stdio: "pipe" });
    g("init", "-q", "-b", ramo);
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base");
    ARVORES.set(ramo, d);
  }
  return ARVORES.get(ramo);
}

function rodar(...args) {
  const ciclo = args[args.indexOf("--ciclo") + 1];
  const comArvore = args.includes("--ciclo") && !args.includes("--arvore") ? [...args, "--arvore", arvoreNoRamo(`ciclo-${ciclo}`)] : args;
  const r = spawnSync(process.execPath, [SCRIPT, "etapa", ...comArvore, "--repo", RAIZ], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: r.status === 0 ? JSON.parse(r.stdout) : null };
}

test("etapa: pedido em palavras, sem abrir com barra, com o contrato de retorno", () => {
  const r = rodar("revisar-esboco", "--ciclo", "TESTE-9-algo");
  assert.equal(r.status, 0, r.stderr);
  const o = r.json;
  assert.equal(o.acao, "criar-etapa");
  assert.equal(o.etapa, "revisar-esboco");
  assert.doesNotMatch(o.pedido, /^\s*\//);
  assert.match(o.pedido.split("\n")[0], /^Rode o \/revisar-esboco do TESTE-9-algo\.$/);
  assert.match(o.pedido, /`REVISAR-ESBOCO <saída> <sha8>`/);
  assert.match(o.pedido, /`PERGUNTA <p-…>`/);
  assert.match(o.pedido, /comando\.mjs abrir/);
  assert.match(o.pedido, /Não se arquive/);
  assert.match(o.pedido, /Recibo:.*get_event.*responder --recibo/);
  assert.equal(o.contrato.linha, "REVISAR-ESBOCO <saída> <sha8>");
  assert.equal(o.contrato.saida, "PRONTO");
  assert.match(o.contrato.comandoDaPergunta, /^node \S*scripts\/pergunta\/comando\.mjs abrir$/);
  assert.equal(o.rodada, undefined);
  assert.equal(o.ramo, "ciclo-TESTE-9-algo");
  assert.equal(o.empurra, false);
  assert.ok(o.pedido.includes(`Árvore do ciclo: \`${o.arvore}\``), o.pedido);
  assert.match(o.pedido, /Commite no ramo e não empurre/);
  assert.doesNotMatch(o.pedido, /push -u origin/);
});

test("etapa que empurra: o pedido manda empurrar o ramo e abrir a proposta em rascunho", () => {
  const o = rodar("revisar-plano", "--ciclo", "C").json;
  assert.equal(o.empurra, true);
  assert.equal(o.contrato.empurra, true);
  assert.match(o.pedido, /push -u origin ciclo-C/);
  assert.match(o.pedido, /gh pr create --draft --head ciclo-C/);
  assert.doesNotMatch(o.pedido, /não empurre/);
});

test("etapa: árvore fora do ramo do ciclo recusa", () => {
  const r = rodar("revisar-esboco", "--ciclo", "C", "--arvore", arvoreNoRamo("main"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /arvore-sem-ramo-do-ciclo/);
});

test("etapa: árvore que o git não lê recusa com o erro real, não como fora do ramo", () => {
  const r = rodar("revisar-esboco", "--ciclo", "C", "--arvore", pastaTemporaria("etapa-sem-git-"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /arvore-ilegivel/);
  assert.doesNotMatch(r.stderr, /arvore-sem-ramo-do-ciclo/);
});

test("etapa sem id (o primeiro argumento é flag) recusa nomeando as etapas", () => {
  const r = rodar("--ciclo", "C");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /etapa exige uma de revisar-esboco/);
});

test("etapa: modelo é o do tier na declaração; inherit sai null", () => {
  assert.equal(rodar("revisar-esboco", "--ciclo", "C").json.modelo, "modelo-forte");
  const herda = rodar("escrever-plano", "--ciclo", "C").json;
  assert.equal(herda.tier, "inherit");
  assert.equal(herda.modelo, null);
  assert.equal(herda.aviso, undefined);
});

test("etapa em rodadas: default 1, nomeia a rodada, recusa acima do teto", () => {
  const um = rodar("revisar-plano", "--ciclo", "C").json;
  assert.equal(um.rodada, 1);
  assert.equal(um.teto, 2);
  assert.equal(um.modelo, "modelo-medio");
  assert.match(um.pedido.split("\n")[0], /^Rode o \/revisar-plano do C, rodada 1 de 2\.$/);
  assert.equal(um.nome, "C · plano · revisar-plano");
  assert.equal(rodar("revisar-plano", "--ciclo", "C", "--rodada", "2").json.nome, "C · plano · revisar-plano · r2");
  const acima = rodar("revisar-plano", "--ciclo", "C", "--rodada", "3");
  assert.equal(acima.status, 1);
  assert.match(acima.stderr, /teto-da-etapa/);
  const torta = rodar("revisar-plano", "--ciclo", "C", "--rodada", "x");
  assert.equal(torta.status, 1);
});

test("etapa: recusa etapa desconhecida, --rodada sem rodadas e falta de --ciclo", () => {
  const nada = rodar("outra", "--ciclo", "C");
  assert.equal(nada.status, 1);
  assert.match(nada.stderr, /revisar-esboco \| escrever-plano \| revisar-plano/);
  assert.equal(rodar("revisar-esboco", "--ciclo", "C", "--rodada", "2").status, 1);
  const semCiclo = spawnSync(process.execPath, [SCRIPT, "etapa", "revisar-esboco", "--repo", RAIZ], { encoding: "utf8" });
  assert.equal(semCiclo.status, 2);
});

test("etapa: sem o campo, a lista é vazia; sem id de etapa, recusa", () => {
  const base = {
    plano: { raiz: "p", casa: () => false, ler: () => ({}), brief: () => [] },
    publicacao: [],
    caminhosProtegidos: [],
    telasProtegidasDosSteps: [],
    foraDasTelasDosSteps: [],
    carimbo: null,
    ci: null,
  };
  assert.deepEqual([...validarCodigo(base).etapasDoPlanejamento], []);
  assert.throws(() => pedidoDaEtapa({ repo: RAIZ, ciclo: "C", etapa: undefined, arvore: arvoreNoRamo("ciclo-C"), ramo: "ciclo-C" }), /etapa exige uma de/);
});

test("validarCodigo: forma das etapas", () => {
  const base = {
    plano: { raiz: "p", casa: () => false, ler: () => ({}), brief: () => [] },
    publicacao: [],
    caminhosProtegidos: [],
    telasProtegidasDosSteps: [],
    foraDasTelasDosSteps: [],
    carimbo: null,
    ci: null,
  };
  const boa = { id: "a", comando: "/a", tier: "critico", saida: "OK" };
  assert.equal(validarCodigo({ ...base, etapasDoPlanejamento: [boa, { ...boa, id: "b", rodadas: 3 }] }).etapasDoPlanejamento[1].rodadas, 3);
  for (const torta of [
    { ...boa, comando: "a" },
    { ...boa, tier: "forte" },
    { ...boa, saida: "com espaço" },
    { ...boa, rodadas: 0 },
    { ...boa, extra: 1 },
  ])
    assert.throws(() => validarCodigo({ ...base, etapasDoPlanejamento: [torta] }), /etapasDoPlanejamento/);
  assert.throws(() => validarCodigo({ ...base, etapasDoPlanejamento: [boa, boa] }), /repetido/);
  assert.throws(() => validarCodigo({ ...base, etapasDoPlanejamento: [{ ...boa, empurra: "sim" }] }), /empurra/);
  assert.throws(
    () => validarCodigo({ ...base, etapasDoPlanejamento: [{ ...boa, empurra: true }, { ...boa, id: "b", empurra: true }] }),
    /só uma etapa empurra/,
  );
});
