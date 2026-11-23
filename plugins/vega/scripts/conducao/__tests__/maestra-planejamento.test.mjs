/**
 * maestra-planejamento.test.mjs — a maestra cria o ramo de planejamento sem
 * checkout e a primeira condutora dele é a de planejamento (D5b, D11b e D16a
 * do L4; hotfix conducao-pedido-da-etapa, 23/11/2026).
 *
 * Origin bare em pasta temporária e hooks desligados: `criar-ramo --tipo plano`
 * e depois `maestra` sem `--nonce`, da árvore da maestra, que fica em `main`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { criarRamo } from "../criar-ramo.mjs";
import { maestra, ramoDePlanejamento } from "../conducao.mjs";

const CICLO = "TESTE-7-planejar";

function novoRepo(t) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "maestra-plano-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const origin = path.join(base, "origin.git");
  const repo = path.join(base, "maestra");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "t");
  g("config", "user.email", "t@t");
  writeFileSync(path.join(repo, "README.md"), "x\n");
  g("add", ".");
  g("commit", "-q", "-m", "base");
  g("remote", "add", "origin", origin);
  g("push", "-q", "origin", "main");
  return { repo, g };
}

test("ramo de planejamento: a primeira condutora é a de planejamento, que roda as etapas e pede MESCLAR", (t) => {
  const { repo, g } = novoRepo(t);
  assert.equal(criarRamo({ repo, ciclo: CICLO, tipo: "plano" }).ramo, ramoDePlanejamento(CICLO));
  const r = maestra({ repo, ciclo: CICLO, sessao: "session_maestra", linhagem: "0/8", contexto: "1/1000000" });
  assert.equal(r.acao, "criar-condutora");
  assert.equal(r.fase, "planejamento");
  assert.match(r.texto, new RegExp(`^Conduzir ${CICLO} — planejamento, pela skill`));
  assert.match(r.texto, /arvore\.mjs adotar --ciclo TESTE-7-planejar --slug plano/);
  assert.match(r.texto, /lane ler --eixo migration/);
  assert.match(r.texto, /etapa <id> --ciclo TESTE-7-planejar/);
  assert.match(r.texto, /MESCLAR <número da proposta> <sha>/);
  assert.doesNotMatch(r.texto, /proximo --repo/);
  // A maestra nunca tirou o ramo: segue em main, e nada a soltar.
  assert.equal(g("rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.deepEqual(r.ramoSolto, { ramo: ramoDePlanejamento(CICLO), de: null });
});
