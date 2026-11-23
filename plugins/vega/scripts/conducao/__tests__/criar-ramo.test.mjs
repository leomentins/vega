/**
 * criar-ramo.test.mjs — a maestra cria o ramo do ciclo sem checkout (D11b do L4;
 * hotfix conducao-pedido-da-etapa, 23/11/2026).
 *
 * Repositório com origin bare em pasta temporária e hooks desligados: o verbo
 * cria um commit vazio sobre origin/main, grava a referência sem mexer no HEAD
 * da árvore, empurra só a referência e recusa um segundo ramo do mesmo ciclo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assuntoDoRamo, criarRamo, nomeDoRamo } from "../criar-ramo.mjs";
import { lerMarcas } from "../marcas.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const RAIZ = path.resolve(AQUI, "fixtures", "projeto-de-teste");

function novoRepo(t) {
  const base = mkdtempSync(path.join(tmpdir(), "criar-ramo-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const origin = path.join(base, "origin.git");
  const repo = path.join(base, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const g = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...a], { encoding: "utf8" }).trim();
  writeFileSync(path.join(repo, "README.md"), "x\n");
  g("add", ".");
  g("commit", "-q", "-m", "base");
  g("remote", "add", "origin", origin);
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "t");
  g("config", "user.email", "t@t");
  g("push", "-q", "origin", "main");
  return { repo, origin, g };
}

test("nome e assunto: plano leva o slug fixo; o assunto não vira marca nem commit de fase", () => {
  assert.equal(nomeDoRamo("L4-x", "plano"), "ciclo-L4-x-plano");
  assert.equal(nomeDoRamo("L4-x", "execucao"), "ciclo-L4-x");
  assert.throws(() => nomeDoRamo("L4-x", "outro"), /--tipo plano\|execucao/);
  assert.equal(assuntoDoRamo("ciclo-L4-x-plano"), "Abre ciclo-L4-x-plano sobre main");
  assert.throws(() => assuntoDoRamo("ciclo-X-F2-plano"), (e) => e.codigo === "assunto-ambiguo");
});

test("cria o ramo sem checkout: commit vazio sobre origin/main, no origin, HEAD intocado, sem marca", (t) => {
  const { repo, origin, g } = novoRepo(t);
  const headAntes = g("rev-parse", "--abbrev-ref", "HEAD");
  const r = criarRamo({ repo, ciclo: "C-1", tipo: "plano" });
  assert.equal(r.acao, "ramo-criado");
  assert.equal(r.ramo, "ciclo-C-1-plano");
  assert.equal(g("rev-parse", "--abbrev-ref", "HEAD"), headAntes);
  assert.equal(g("rev-parse", `${r.sha}^`), g("rev-parse", "origin/main"));
  assert.equal(g("rev-parse", `${r.sha}^{tree}`), g("rev-parse", "origin/main^{tree}"));
  assert.equal(execFileSync("git", ["-C", origin, "rev-parse", "refs/heads/ciclo-C-1-plano"], { encoding: "utf8" }).trim(), r.sha);
  assert.deepEqual(lerMarcas(repo, "refs/heads/ciclo-C-1-plano").filter((m) => m.sha === r.sha), []);
  assert.match(r.depois[0], /gh pr create --draft --base main --head ciclo-C-1-plano/);
});

test("um ramo por vez: com o de planejamento vivo, o de execução recusa; apagado, nasce", (t) => {
  const { repo, g } = novoRepo(t);
  criarRamo({ repo, ciclo: "C-2", tipo: "plano" });
  assert.throws(() => criarRamo({ repo, ciclo: "C-2", tipo: "execucao" }), (e) => e.codigo === "ramo-do-ciclo-vivo");
  // Só local apagado não basta: o origin ainda tem o ramo.
  g("branch", "-D", "ciclo-C-2-plano");
  assert.throws(() => criarRamo({ repo, ciclo: "C-2", tipo: "execucao" }), (e) => e.codigo === "ramo-do-ciclo-vivo");
  g("push", "-q", "origin", "--delete", "ciclo-C-2-plano");
  assert.equal(criarRamo({ repo, ciclo: "C-2", tipo: "execucao" }).ramo, "ciclo-C-2");
});

test("push recusado desfaz a referência local", (t) => {
  const { repo, g } = novoRepo(t);
  const falso = (r, args, o) => (args[0] === "push" ? { status: 1, saida: "", erro: "recusado pelo teste" } : spawnGit(r, args, o));
  assert.throws(() => criarRamo({ repo, ciclo: "C-3", tipo: "plano", git: falso }), (e) => e.codigo === "push-recusado" && /não chegou ao origin/.test(e.message) && /foi desfeita/.test(e.message));
  assert.equal(g("for-each-ref", "refs/heads/ciclo-C-3-plano"), "");
});

test("push que estoura o prazo depois do aceite diz que o ramo chegou ao origin; rollback que falha diz que não se desfez", (t) => {
  const { repo, g } = novoRepo(t);
  // O push real acontece, mas volta como prazo estourado; o update-ref -d falha.
  const falso = (r, args, o) => {
    if (args[0] === "push") {
      spawnGit(r, args, o);
      return { status: null, saida: "", erro: "" };
    }
    if (args[0] === "update-ref" && args[1] === "-d") return { status: 1, saida: "", erro: "lock em refs/heads" };
    return spawnGit(r, args, o);
  };
  assert.throws(
    () => criarRamo({ repo, ciclo: "C-4", tipo: "plano", git: falso }),
    (e) => e.codigo === "push-recusado" && /prazo de rede estourado/.test(e.message) && /chegou ao origin assim mesmo/.test(e.message) && /NÃO se desfez/.test(e.message),
  );
  assert.notEqual(g("for-each-ref", "refs/heads/ciclo-C-4-plano"), "");
});

function spawnGit(repo, args) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return { status: r.status, saida: (r.stdout ?? "").trim(), erro: (r.stderr ?? "").trim() };
}

test("pela CLI: --tipo é obrigatório", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "criar-ramo", "--ciclo", "C-4", "--repo", RAIZ], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--tipo plano\|execucao/);
});
