// .claude/skills/vega/motor/__tests__/git-guard-escrita-de-estado.test.mjs
//
// VEGA-20 T9 (AC-VEGA20-7, D8b do operador) — duas travas passam ao motor:
//   1. a escrita de arquivo de modo/allow pelo subagent (regra inteira do
//      `subagent-state-write-guard.js`): Write/Edit/MultiEdit/NotebookEdit e as ferramentas de
//      escrita do Serena, alvo resolvido por `realpath`, fail-closed para o subagent;
//   2. o índice compartilhado (regra inteira do `shared-index-guard.js`): R1–R4, o OWNED que todo
//      `git add` escopado grava, a queima do allow do subagent e o limite à árvore principal, com
//      `hard` no subagent e, na sessão, o mode-file e o allow PRÓPRIOS do guard de origem.
//
// Os casos são os dos testes dos dois guards de origem (`subagent-nao-desliga-guard.test.mjs` §3 e
// `shared-index-guard.test.mjs`), rodados pelo canal real: `hooks-do-motor.mjs --executar
// git-guard.js`, por processo filho sobre repositório temporário. O registro no `settings.json`
// não muda nesta task (T11).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pastaTemporaria } from "../../scripts/testes/pasta-temporaria.mjs";

const MOTOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXECUTOR = path.join(MOTOR, "hooks-do-motor.mjs");
const GUARD = path.join(MOTOR, "git-guard.js");
const SUB = { agent_id: "sub-1", agent_type: "general-purpose" };

// ── fixtures ────────────────────────────────────────────────────────────────

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function repo(t) {
  const dir = realpathSync(pastaTemporaria("t9-escrita-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "core.hooksPath", "/dev/null-sem-hooks");
  writeFileSync(path.join(dir, "a.md"), "a\n");
  writeFileSync(path.join(dir, "b.md"), "b\n");
  git(dir, "add", "a.md", "b.md");
  git(dir, "commit", "-q", "--no-verify", "-m", "a");
  mkdirSync(path.join(dir, ".claude", "state"), { recursive: true });
  return dir;
}

/** Sandbox sem git real: `.git` diretório = árvore principal · `.git` arquivo = worktree linkada. */
function sandbox(t, tipo) {
  const dir = realpathSync(pastaTemporaria(`t9-sig-${tipo}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  if (tipo === "main") mkdirSync(path.join(dir, ".git"));
  else writeFileSync(path.join(dir, ".git"), "gitdir: /em-outro-lugar/.git\n");
  mkdirSync(path.join(dir, ".claude", "state"), { recursive: true });
  return dir;
}

function estado(dir, nome, conteudo) {
  const p = path.join(dir, ".claude", "state", nome);
  writeFileSync(p, conteudo);
  return p;
}

const logDir = (d) => path.join(d, ".claude", "state");

function rodar(payload, { cwd, bruto, preload } = {}) {
  const argv = preload ? ["--require", preload, GUARD] : [EXECUTOR, "--executar", "git-guard.js"];
  const r = spawnSync(process.execPath, argv, {
    cwd,
    input: bruto ?? JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, SHARED_INDEX_GUARD_LOG_DIR: logDir(cwd) },
    timeout: 20000,
  });
  return { status: r.status, stderr: r.stderr ?? "" };
}

const write = (cwd, file_path, subagent, tool_name = "Write") => ({
  tool_name,
  tool_input: { file_path, content: "off" },
  cwd,
  ...(subagent ? SUB : {}),
});

const bash = (cwd, command, extra = {}) => ({ tool_name: "Bash", tool_input: { command }, cwd, ...extra });

function acoes(d) {
  const p = path.join(logDir(d), "shared-index-guard.log");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l).action);
}

function preload(t, corpo) {
  const dir = pastaTemporaria("t9-preload-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = path.join(dir, "preload.cjs");
  writeFileSync(p, corpo);
  return p;
}

const ARQUIVOS_DE_MODO = [
  "git-guard-mode",
  "git-gaps-guard-mode",
  "main-tree-branch-guard-mode",
  "cycle-write-tree-guard-mode",
  "shared-index-guard-mode",
];

// ── 1. escrita de arquivo pelo subagent ──────────────────────────────────────

test("Write/Edit/MultiEdit/NotebookEdit do subagent em modo e allow saem 2; sem agent_id saem 0", (t) => {
  const d = repo(t);
  const alvos = [
    ...ARQUIVOS_DE_MODO.map((n) => path.join(d, ".claude", "state", n)),
    path.join(d, ".claude", "state", "git-guard-allow"),
    ".claude/state/main-tree-branch-guard-allow",
    // qualquer raiz: o nome decide, não a pasta
    path.join(d, "outra-pasta", "x-mode"),
  ];
  for (const alvo of alvos) {
    for (const tool of ["Write", "Edit", "MultiEdit"]) {
      assert.equal(rodar(write(d, alvo, true, tool), { cwd: d }).status, 2, `${tool} ${alvo}`);
      assert.equal(rodar(write(d, alvo, false, tool), { cwd: d }).status, 0, `sessão ${tool} ${alvo}`);
    }
    const nb = { tool_name: "NotebookEdit", tool_input: { notebook_path: alvo, new_source: "off" }, cwd: d };
    assert.equal(rodar({ ...nb, ...SUB }, { cwd: d }).status, 2, `NotebookEdit ${alvo}`);
    assert.equal(rodar(nb, { cwd: d }).status, 0);
  }
  assert.equal(rodar(write(d, path.join(d, "a.md"), true), { cwd: d }).status, 0, "escrita comum do subagent passa");
});

test("ferramentas de escrita do Serena do subagent em modo/allow saem 2", (t) => {
  const d = repo(t);
  for (const tool of [
    "mcp__serena__create_text_file",
    "mcp__serena__replace_content",
    "mcp__serena__replace_symbol_body",
    "mcp__serena__insert_after_symbol",
  ]) {
    const p = { tool_name: tool, tool_input: { relative_path: ".claude/state/git-guard-mode" }, cwd: d };
    assert.equal(rodar({ ...p, ...SUB }, { cwd: d }).status, 2, tool);
    assert.equal(rodar(p, { cwd: d }).status, 0, `sessão ${tool}`);
    const comum = { tool_name: tool, tool_input: { relative_path: "src/a.ts" }, cwd: d, ...SUB };
    assert.equal(rodar(comum, { cwd: d }).status, 0, `${tool} comum`);
  }
});

test("Write do subagent com `..` ou link para o state sai 2", (t) => {
  const d = repo(t);
  estado(d, "git-guard-mode", "hard\n");
  mkdirSync(path.join(d, "sub"));
  const comPontos = path.join(d, "sub", "..", ".claude", "state", "git-guard-mode");
  assert.equal(rodar(write(d, comPontos, true), { cwd: d }).status, 2);
  symlinkSync(path.join(d, ".claude", "state"), path.join(d, "atalho"));
  assert.equal(rodar(write(d, path.join(d, "atalho", "git-guard-mode"), true), { cwd: d }).status, 2);
  symlinkSync(path.join(d, ".claude", "state", "git-guard-mode"), path.join(d, "inocente.txt"));
  assert.equal(rodar(write(d, path.join(d, "inocente.txt"), true), { cwd: d }).status, 2);
  assert.equal(rodar(write(d, path.join(d, "inocente.txt"), false), { cwd: d }).status, 0);
});

test("payload de subagent sem nenhum campo de path fecha; o da sessão passa", (t) => {
  const d = repo(t);
  const p = { tool_name: "Write", tool_input: { content: "off" }, cwd: d, ...SUB };
  assert.equal(rodar(p, { cwd: d }).status, 2);
  assert.equal(rodar({ ...p, agent_id: undefined, agent_type: undefined }, { cwd: d }).status, 0);
});

test("JSON ilegível: fecha para subagent (pelo texto cru), abre para a sessão", (t) => {
  const d = repo(t);
  assert.equal(rodar(null, { cwd: d, bruto: '{"agent_id":"s", quebrado' }).status, 2);
  assert.equal(rodar(null, { cwd: d, bruto: '{"agent_type":"x" ' }).status, 2);
  assert.equal(rodar(null, { cwd: d, bruto: "{nao e json" }).status, 0);
});

test("erro interno do ramo de escrita fecha para o subagent e abre para a sessão", (t) => {
  const d = repo(t);
  const pre = preload(
    t,
    `process.stdin.once("end", () => { require("node:path").basename = () => { throw new Error("quebrado"); }; });\n`,
  );
  const sub = rodar(write(d, path.join(d, "a.md"), true), { cwd: d, preload: pre });
  assert.equal(sub.status, 2, sub.stderr);
  assert.match(sub.stderr, /erro interno/);
  assert.equal(rodar(write(d, path.join(d, "a.md"), false), { cwd: d, preload: pre }).status, 0);
});

test("o ramo de escrita não depende do git-guard-mode: com `off`, o subagent segue barrado", (t) => {
  const d = repo(t);
  estado(d, "git-guard-mode", "off\n");
  assert.equal(rodar(write(d, ".claude/state/git-guard-mode", true), { cwd: d }).status, 2);
});

// ── 2. índice compartilhado ──────────────────────────────────────────────────

test("R1 `git add .` na árvore principal: subagent hard; sessão sem mode-file é soft (loga, passa)", (t) => {
  const d = sandbox(t, "main");
  assert.equal(rodar(bash(d, "git add .", SUB), { cwd: d }).status, 2);
  assert.ok(acoes(d).includes("blocked"));
  const s = rodar(bash(d, "git add -A"), { cwd: d });
  assert.equal(s.status, 0);
  assert.match(s.stderr, /SHARED-INDEX \[soft\] R1/);
  assert.ok(acoes(d).includes("logged"));
});

test("sessão com o mode-file `off` e `git add .` na árvore principal sai 0, sem log; subagent segue hard", (t) => {
  const d = sandbox(t, "main");
  estado(d, "shared-index-guard-mode", "off\n");
  assert.equal(rodar(bash(d, "git add ."), { cwd: d }).status, 0);
  assert.deepEqual(acoes(d), []);
  assert.equal(rodar(bash(d, "git add .", SUB), { cwd: d }).status, 2);
});

test("sessão com o mode-file `hard`: R1, R2 e R4 barram; formas escopadas passam", (t) => {
  const d = sandbox(t, "main");
  estado(d, "shared-index-guard-mode", "hard\n");
  for (const cmd of ["git add .", "git add -u", "git add :/", 'git commit -am "x"', "git commit --all -m x", "git stash", "git stash push -u", "git add $FILES"])
    assert.equal(rodar(bash(d, cmd), { cwd: d }).status, 2, cmd);
  for (const cmd of ["git add -- a.md", 'git commit -m "x" -- a.md', "git stash push -- a.md", "git stash list", "git log --stat", 'git commit -m "proibe git add ." -- a.md'])
    assert.equal(rodar(bash(d, cmd), { cwd: d }).status, 0, cmd);
});

test("modo e allow são PRÓPRIOS: `off` de um não desliga o outro", (t) => {
  const d = repo(t);
  // shared-index off não desliga o git-guard
  estado(d, "shared-index-guard-mode", "off\n");
  assert.equal(rodar(bash(d, "git " + "re" + "set --hard HEAD"), { cwd: d }).status, 2);
  // git-guard off não desliga o shared-index em hard
  estado(d, "git-guard-mode", "off\n");
  estado(d, "shared-index-guard-mode", "hard\n");
  assert.equal(rodar(bash(d, "git add ."), { cwd: d }).status, 2);
  // `git-guard-allow` não libera o shared-index, e não é consumido por ele
  const gg = estado(d, "git-guard-allow", "git add .\n");
  assert.equal(rodar(bash(d, "git add ."), { cwd: d }).status, 2);
  assert.equal(readFileSync(gg, "utf8"), "git add .\n");
  // `shared-index-guard-allow` libera uma vez na sessão
  const sa = estado(d, "shared-index-guard-allow", "git add .\n");
  assert.equal(rodar(bash(d, "git add ."), { cwd: d }).status, 0);
  assert.equal(readFileSync(sa, "utf8").trim(), "");
  assert.equal(rodar(bash(d, "git add ."), { cwd: d }).status, 2, "uma vez só");
});

test("allow do subagent é QUEIMADO e o bloqueio segue", (t) => {
  const d = sandbox(t, "main");
  const sa = estado(d, "shared-index-guard-allow", "git add .\n");
  const r = rodar(bash(d, "git add .", SUB), { cwd: d });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /QUEIMADA/);
  assert.equal(readFileSync(sa, "utf8").trim(), "");
});

test("R3: commit bare com índice alheio barra; só com o próprio passa; sem dono é fail-open com log", (t) => {
  const d = repo(t);
  estado(d, "shared-index-guard-mode", "hard\n");
  writeFileSync(path.join(d, "a.md"), "a2\n");
  writeFileSync(path.join(d, "b.md"), "b2\n");
  // a sessão estagia a.md pelo tool: o OWNED nasce
  assert.equal(rodar(bash(d, "git add -- a.md", { session_id: "s1" }), { cwd: d }).status, 0);
  assert.equal(readFileSync(path.join(d, ".claude", "state", "session-index", "s1"), "utf8").trim(), "a.md");
  git(d, "add", "a.md");
  assert.equal(rodar(bash(d, 'git commit -m "x"', { session_id: "s1" }), { cwd: d }).status, 0, "só o próprio");
  // outra janela estagia b.md por fora
  git(d, "add", "b.md");
  const r = rodar(bash(d, 'git commit -m "x"', { session_id: "s1" }), { cwd: d });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /b\.md/);
  // sessão sem dono gravado: fail-open declarado, e nunca mudo
  assert.equal(rodar(bash(d, 'git commit -m "x"', { session_id: "sem-dono" }), { cwd: d }).status, 0);
  assert.ok(acoes(d).includes("skipped-no-ownership"));
});

test("o OWNED é gravado por todo `git add` escopado, em qualquer tier, e também em worktree", (t) => {
  const main = sandbox(t, "main");
  // Caminho fora do `PADRAO` do gate de corte e do `MENCAO_DE_ESTADO` (VEGA-20 T41): prova o mesmo
  // OWNED escopado pelo subagent sem citar arquivo de estado que o corte procura.
  assert.equal(rodar(bash(main, "git add -- docs/a.md", { ...SUB, session_id: "sub-s" }), { cwd: main }).status, 0);
  assert.equal(
    readFileSync(path.join(main, ".claude", "state", "session-index", "sub-s"), "utf8").trim(),
    "docs/a.md",
  );
  const wt = sandbox(t, "wt");
  assert.equal(rodar(bash(wt, "git add -- a.md", { session_id: "wt-s" }), { cwd: wt }).status, 0);
  assert.equal(readFileSync(path.join(wt, ".claude", "state", "session-index", "wt-s"), "utf8").trim(), "a.md");
});

test("limite à árvore principal: worktree linkada sai sem julgar, com log", (t) => {
  const d = sandbox(t, "wt");
  assert.equal(rodar(bash(d, `cd ${d} && git add .`, SUB), { cwd: d }).status, 0);
  assert.ok(acoes(d).includes("skipped-worktree"));
  assert.ok(!acoes(d).includes("skipped-undetermined"));
});

test("`cd` para a árvore principal é avaliado, não liberado", (t) => {
  const d = sandbox(t, "main");
  assert.equal(rodar(bash(d, `cd ${d} && git add .`), { cwd: d }).status, 0);
  assert.ok(acoes(d).includes("logged"));
});
