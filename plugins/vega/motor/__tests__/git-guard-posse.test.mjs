// .claude/skills/vega/motor/__tests__/git-guard-posse.test.mjs
//
// VEGA-26 T34 — o `git-guard` do motor julga pela árvore dona, pela posse e pelo que se perde
// (matriz da T33, linha G1-troca), com o descarte da troca passando sem liberação à mão.
//
// O hook roda por PROCESSO FILHO sobre repositórios temporários: ele carrega da raiz da sessão
// (`CLAUDE_PROJECT_DIR`), então nada aqui toca a árvore que roda o teste. O projeto do guard
// (`CLAUDE_PROJECT_DIR`) é um diretório temporário com `.vega/declaracao.json` e uma posse falsa
// (`posse-falsa.mjs`), que devolve o estado pedido em `POSSE_FALSA`.
//
// NOTA DE FORMA — os verbos git vão CONCATENADOS (`"re" + "set"`), como em
// `motor-pela-declaracao.test.mjs`: guards e classificadores leem o texto do comando que cria
// este arquivo, e aqui o verbo é dado de fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOTOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = path.join(MOTOR, "git-guard.js");

const RESET = "re" + "set";
const RAMO = "ciclo-TESTE-1";
const TROCA = `git ${RESET} --keep origin/${RAMO}`;

function tmp(prefixo) {
  return realpathSync.native(mkdtempSync(path.join(os.tmpdir(), prefixo)));
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = (args, cwd) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    env: GIT_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function commitar(repo, arquivo, conteudo, msg) {
  if (arquivo) writeFileSync(path.join(repo, arquivo), conteudo);
  git(["add", "-A"], repo);
  git(["commit", "-q", "--allow-empty", "-m", msg], repo);
  return git(["rev-parse", "HEAD"], repo);
}

/** Remoto nu + clone no ramo do ciclo, com 1 commit publicado. */
function cenario() {
  const base = tmp("guard-posse-");
  const remoto = path.join(base, "remoto.git");
  const repo = path.join(base, "repo");
  git(["init", "-q", "--bare", remoto], base);
  git(["init", "-q", "-b", RAMO, repo], base);
  commitar(repo, "a.txt", "A\n", "base");
  git(["remote", "add", "origin", remoto], repo);
  git(["push", "-q", "-u", "origin", RAMO], repo);
  return { base, remoto, repo, publicado: git(["rev-parse", "HEAD"], repo) };
}

function projeto(posse) {
  const dir = tmp("guard-posse-proj-");
  mkdirSync(path.join(dir, ".vega"));
  const decl = {
    esquema: 1,
    papel: "fonte",
    decisoes: { destino: "git", arquivo: ".vega/decisoes.jsonl" },
    listas: { corpo: "a.txt", empresa: "b.txt" },
  };
  if (posse !== undefined) decl.posse = posse;
  writeFileSync(path.join(dir, ".vega", "declaracao.json"), JSON.stringify(decl));
  writeFileSync(
    path.join(dir, "posse-falsa.mjs"),
    [
      'const e = process.env.POSSE_FALSA ?? "dona";',
      'const i = process.argv.indexOf("--arvore");',
      'if (i < 0 || process.argv[i + 1] !== process.env.POSSE_ARVORE) { console.log(JSON.stringify({ estado: "outra" })); process.exit(0); }',
      'if (e === "crash") process.exit(1);',
      'if (e === "torto") { console.log("nao e json"); process.exit(0); }',
      'if (e === "lento") setTimeout(() => {}, 30000);',
      "else console.log(JSON.stringify({ estado: e }));",
    ].join("\n"),
  );
  return dir;
}

const POSSE_OK = { comando: ["node", "posse-falsa.mjs"] };

function guard(command, { cwd, proj, subagent = false, posse = "dona", arvore, preload } = {}) {
  const env = { ...process.env, POSSE_FALSA: posse, POSSE_ARVORE: arvore ?? cwd };
  delete env.CLAUDE_PROJECT_DIR;
  if (proj) env.CLAUDE_PROJECT_DIR = proj;
  const entrada = { tool_name: "Bash", cwd, tool_input: { command } };
  if (subagent) Object.assign(entrada, { agent_id: "a1", agent_type: "implementer" });
  const argv = preload ? ["--require", preload, GUARD] : [GUARD];
  const r = spawnSync(process.execPath, argv, { input: JSON.stringify(entrada), encoding: "utf8", env });
  return { status: r.status, stderr: r.stderr };
}

function log(repo) {
  const p = path.join(repo, ".claude", "state", "git-guard.log");
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}

function allow(repo, linha) {
  mkdirSync(path.join(repo, ".claude", "state"), { recursive: true });
  const p = path.join(repo, ".claude", "state", "git-guard-allow");
  writeFileSync(p, `# cabecalho\n${linha}\n`);
  return p;
}

// ── o caso de estudo e o que se perde ─────────────────────────────────────────────────────────

test("caso de estudo: reset --keep para o origin do ramo, descartando commit vazio, passa sem liberação", () => {
  const { repo } = cenario();
  commitar(repo, null, null, "vazio duplicado");
  const r = guard(TROCA, { cwd: repo, proj: projeto(POSSE_OK) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(log(repo).at(-1).action, "auto-allowed-descarte-da-troca");
});

test("posse sem-posse também libera o descarte da troca", () => {
  const { repo } = cenario();
  commitar(repo, null, null, "vazio");
  assert.equal(guard(TROCA, { cwd: repo, proj: projeto(POSSE_OK), posse: "sem-posse" }).status, 0);
});

test("reset --keep que descartaria commit com conteúdo fora do origin barra", () => {
  const { repo } = cenario();
  commitar(repo, "b.txt", "B\n", "conteudo novo");
  const r = guard(TROCA, { cwd: repo, proj: projeto(POSSE_OK) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /conteudo fora de origin/);
});

test("descarte acima do teto de commits barra, mesmo todos vazios (o caminho cabe no timeout do hook)", () => {
  const { repo } = cenario();
  for (let i = 0; i < 51; i++) git(["commit", "-q", "--allow-empty", "-m", "vazio " + i], repo);
  const r = guard(TROCA, { cwd: repo, proj: projeto(POSSE_OK) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /51 commits sairiam \(teto 50\)/);
});

test("reset --hard para o mesmo alvo segue barrado (só --keep é a forma da troca)", () => {
  const { repo } = cenario();
  commitar(repo, null, null, "vazio");
  assert.equal(guard(`git ${RESET} --hard origin/${RAMO}`, { cwd: repo, proj: projeto(POSSE_OK) }).status, 2);
});

test("forma encadeada ou com -C não é a forma da troca", () => {
  const { repo } = cenario();
  commitar(repo, null, null, "vazio");
  const proj = projeto(POSSE_OK);
  assert.equal(guard(`${TROCA} && git clean -fd`, { cwd: repo, proj }).status, 2);
  assert.equal(guard(`git -C ${repo} ${RESET} --keep origin/${RAMO}`, { cwd: repo, proj }).status, 2);
  assert.equal(guard(`cd ${repo} && ${TROCA}`, { cwd: repo, proj }).status, 2);
});

// ── o origin forjado ──────────────────────────────────────────────────────────────────────────

test("ref de rastreio forjada por update-ref barra", () => {
  const { repo } = cenario();
  const comConteudo = commitar(repo, "b.txt", "B\n", "conteudo fora do origin");
  commitar(repo, null, null, "vazio");
  git(["update-ref", `refs/remotes/origin/${RAMO}`, comConteudo], repo);
  const r = guard(TROCA, { cwd: repo, proj: projeto(POSSE_OK) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /nao e o origin\/ciclo-TESTE-1 do ls-remote/);
});

test("remote set-url para repositório falso barra", () => {
  const { base, repo } = cenario();
  commitar(repo, null, null, "vazio");
  const falso = path.join(base, "falso.git");
  const outro = path.join(base, "outro");
  git(["init", "-q", "--bare", falso], base);
  git(["init", "-q", "-b", RAMO, outro], base);
  commitar(outro, "z.txt", "Z\n", "historia alheia");
  git(["push", "-q", falso, RAMO], outro);
  git(["remote", "set-url", "origin", falso], repo);
  const r = guard(TROCA, { cwd: repo, proj: projeto(POSSE_OK) });
  assert.equal(r.status, 2);
  // e o remoto falso sem o ramo também barra
  const vazio = path.join(base, "vazio.git");
  git(["init", "-q", "--bare", vazio], base);
  git(["remote", "set-url", "origin", vazio], repo);
  const r2 = guard(TROCA, { cwd: repo, proj: projeto(POSSE_OK) });
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /ls-remote sem refs\/heads\/ciclo-TESTE-1/);
});

// ── o tier subagent e o one-shot ──────────────────────────────────────────────────────────────

test("subagent barra onde a sessão passa", () => {
  const { repo } = cenario();
  commitar(repo, null, null, "vazio");
  const proj = projeto(POSSE_OK);
  const r = guard(TROCA, { cwd: repo, proj, subagent: true });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /TIER SUBAGENT/);
  assert.equal(guard(TROCA, { cwd: repo, proj }).status, 0);
});

test("one-shot gravado não vale para subagent, e vale para a sessão", () => {
  const { repo } = cenario();
  const cmd = `git ${RESET} --hard HEAD`;
  const p = allow(repo, cmd);
  const r = guard(cmd, { cwd: repo, proj: projeto(POSSE_OK), subagent: true });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /QUEIMADA/);
  assert.ok(!readFileSync(p, "utf8").includes(cmd), "linha queimada mesmo recusada");
  allow(repo, cmd);
  assert.equal(guard(cmd, { cwd: repo, proj: projeto(POSSE_OK) }).status, 0);
});

// ── a declaração e a posse ────────────────────────────────────────────────────────────────────

test("declaração sem o campo posse mantém a regra de hoje: o descarte da troca barra", () => {
  const { repo } = cenario();
  commitar(repo, null, null, "vazio");
  const r = guard(TROCA, { cwd: repo, proj: projeto(undefined) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /projeto sem `posse` declarada/);
});

test("projeto sem declaração nenhuma barra o descarte da troca", () => {
  const { repo } = cenario();
  commitar(repo, null, null, "vazio");
  assert.equal(guard(TROCA, { cwd: repo, proj: tmp("guard-posse-nada-") }).status, 2);
});

test("declaração com posse malformada não libera", () => {
  const { repo } = cenario();
  commitar(repo, null, null, "vazio");
  for (const posse of [{ comando: [] }, { comando: "node x" }, { comando: ["node"], extra: 1 }]) {
    assert.equal(guard(TROCA, { cwd: repo, proj: projeto(posse) }).status, 2, JSON.stringify(posse));
  }
});

test("posse outra, nao-li, ilegível ou que falha não libera", () => {
  const { repo } = cenario();
  commitar(repo, null, null, "vazio");
  const proj = projeto(POSSE_OK);
  for (const posse of ["outra", "nao-li", "torto", "crash"]) {
    assert.equal(guard(TROCA, { cwd: repo, proj, posse }).status, 2, posse);
  }
});

test("posse que estoura o prazo não libera", { timeout: 20000 }, () => {
  const { repo } = cenario();
  commitar(repo, null, null, "vazio");
  const r = guard(TROCA, { cwd: repo, proj: projeto(POSSE_OK), posse: "lento" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /leitura da posse falhou/);
});

test("a posse recebe a raiz da árvore, também com o cwd numa subpasta", () => {
  const { repo } = cenario();
  commitar(repo, null, null, "vazio");
  mkdirSync(path.join(repo, "sub"));
  const r = guard(TROCA, { cwd: path.join(repo, "sub"), arvore: repo, proj: projeto(POSSE_OK) });
  assert.equal(r.status, 0, r.stderr);
});

// ── erro do próprio guard (19-a) ──────────────────────────────────────────────────────────────

test("erro no caminho que libera barra", () => {
  const { base, repo } = cenario();
  commitar(repo, null, null, "vazio");
  const preload = path.join(base, "quebra-ls-remote.cjs");
  writeFileSync(
    preload,
    [
      'const cp = require("child_process");',
      "const orig = cp.execFileSync;",
      'cp.execFileSync = function (f, a, o) { if (Array.isArray(a) && a.includes("ls-remote")) throw new Error("ls-remote quebrado"); return orig.call(this, f, a, o); };',
    ].join("\n"),
  );
  const r = guard(TROCA, { cwd: repo, proj: projeto(POSSE_OK), preload });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /erro do guard no descarte da troca/);
});

test("erro fora do caminho que libera segue aberto, com log", () => {
  const { base, repo } = cenario();
  const preload = path.join(base, "quebra-tokenizador.cjs");
  writeFileSync(
    preload,
    [
      "const orig = String.prototype.toLowerCase;",
      `String.prototype.toLowerCase = function () { if (String(this) === "${RESET}") throw new Error("tokenizador quebrado"); return orig.call(this); };`,
    ].join("\n"),
  );
  const r = guard(`git ${RESET} --hard HEAD`, { cwd: repo, proj: projeto(POSSE_OK), preload });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /erro interno/);
  assert.equal(log(repo).at(-1).action, "guard-error");
});

// ── a raiz: modo, one-shot e mensagem ─────────────────────────────────────────────────────────

test("--show-toplevel que falha dá modo hard, sem liberação", () => {
  const fora = tmp("guard-posse-fora-");
  mkdirSync(path.join(fora, ".claude", "state"), { recursive: true });
  writeFileSync(path.join(fora, ".claude", "state", "git-guard-mode"), "soft\n");
  const cmd = `git ${RESET} --hard HEAD`;
  const p = allow(fora, cmd);
  const r = guard(cmd, { cwd: fora, proj: projeto(POSSE_OK) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /show-toplevel/);
  assert.ok(readFileSync(p, "utf8").includes(cmd), "a linha de allow fora de repositório não é consumida");
});

test("modo e one-shot saem da raiz da árvore, não da subpasta do cwd", () => {
  const { repo } = cenario();
  mkdirSync(path.join(repo, "sub"));
  const cmd = `git ${RESET} --hard HEAD`;
  allow(repo, cmd);
  assert.equal(guard(cmd, { cwd: path.join(repo, "sub"), proj: projeto(POSSE_OK) }).status, 0);
  writeFileSync(path.join(repo, ".claude", "state", "git-guard-mode"), "off\n");
  assert.equal(guard(`git ${RESET} --merge HEAD`, { cwd: path.join(repo, "sub"), proj: projeto(POSSE_OK) }).status, 0);
});

test("a mensagem de bloqueio traz o caminho absoluto do allow e os dois comandos separados", () => {
  const { repo } = cenario();
  commitar(repo, "b.txt", "B\n", "conteudo");
  const r = guard(TROCA, { cwd: repo, proj: projeto(POSSE_OK) });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(path.join(repo, ".claude", "state", "git-guard-allow")), r.stderr);
  assert.match(r.stderr, /DOIS comandos separados/);
});
