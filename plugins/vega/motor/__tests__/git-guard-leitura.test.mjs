// .claude/skills/vega/motor/__tests__/git-guard-leitura.test.mjs
//
// VEGA-20 T9 (AC-VEGA20-7, D9a do operador) — o `git-guard` do motor deixa passar comando só de
// leitura do subagent que cita `.claude/state/` ou `-mode` no texto.
//
// A lista de verbos de leitura é FECHADA: entram `cd`, `wc`, `sort`, `uniq`, `cut`, `diff`, `file`,
// `basename`, `dirname`, `realpath` e `git` com subcomando de leitura. O verbo da lista que grava ou
// executa por OPÇÃO segue barrado, e interpretador segue barrando (o falso-positivo de `node -e`
// só de leitura é resíduo declarado, contado à parte: `residuo_interpretador`, lido pela T26).
//
// O hook roda por PROCESSO FILHO sobre repositório temporário, pelo canal real
// (`hooks-do-motor.mjs --executar git-guard.js`): o estado do guard (modo, allow, log) mora na
// árvore, e rodar sobre a árvore real gravaria log de verdade.
//
// NOTA DE FORMA — verbos destrutivos do git vão CONCATENADOS, como em `git-guard-posse.test.mjs`:
// guards e classificadores leem o texto do comando que cria este arquivo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOTOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXECUTOR = path.join(MOTOR, "hooks-do-motor.mjs");

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
}

function repo(t) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "t9-leitura-")));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "core.hooksPath", "/dev/null-sem-hooks");
  mkdirSync(path.join(dir, ".claude", "state"), { recursive: true });
  for (const [n, c] of [
    ["git-guard-mode", "hard\n"],
    ["a-mode", "hard\n"],
    ["x-mode", "hard\n"],
    ["x-allow", "# formato\n"],
    ["qualquer.json", "{}\n"],
    ["git-guard.log", "{}\n"],
  ])
    writeFileSync(path.join(dir, ".claude", "state", n), c);
  writeFileSync(path.join(dir, "a.md"), "a\n");
  git(dir, "add", "a.md");
  git(dir, "commit", "-q", "--no-verify", "-m", "a");
  return dir;
}

function rodar(cwd, command, { subagent = true, preload } = {}) {
  // a sonda (`preload`) vai no processo do HOOK: o executor o roda em processo filho
  const argv = preload ? ["--require", preload, path.join(MOTOR, "git-guard.js")] : [EXECUTOR, "--executar", "git-guard.js"];
  const r = spawnSync(process.execPath, argv, {
    cwd,
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd,
      ...(subagent ? { agent_id: "sub-1", agent_type: "general-purpose" } : {}),
    }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, SHARED_INDEX_GUARD_LOG_DIR: path.join(cwd, ".claude", "state") },
    timeout: 20000,
  });
  return { status: r.status, stderr: r.stderr ?? "" };
}

function todos(d, cmds, esperado) {
  const errados = cmds.filter((c) => rodar(d, c).status !== esperado);
  assert.deepEqual(errados, [], `deveriam sair ${esperado}`);
}

// ── o gatilho medido: caminho protegido como ARGUMENTO de leitura ───────────────

test("leitura com o caminho protegido como argumento passa; a escrita segue barrada", (t) => {
  const d = repo(t);
  todos(d, ["grep -n x .claude/state/qualquer.json", "git grep -l x -- .claude/state"], 0);
  assert.equal(rodar(d, "echo x > .claude/state/a-mode").status, 2);
  assert.equal(readFileSync(path.join(d, ".claude", "state", "a-mode"), "utf8"), "hard\n");
});

test("os bloqueados da medida que não são interpretador passam (ls, grep, tail, git log)", (t) => {
  const d = repo(t);
  todos(
    d,
    [
      "ls -la .claude/state",
      "ls .claude/state/*-mode",
      "grep -c off .claude/state/git-guard-mode",
      "tail -5 .claude/state/git-guard.log",
      "git log --oneline -- .claude/state/git-guard-mode",
      "git log -1 --format=%H -- .claude/state",
    ],
    0,
  );
});

test("cada verbo novo da lista fechada passa em leitura", (t) => {
  const d = repo(t);
  todos(
    d,
    [
      "cd .claude/state && cat git-guard-mode",
      "cd .claude/state",
      "wc -l .claude/state/git-guard-mode",
      "sort .claude/state/a-mode",
      "sort -u -r .claude/state/a-mode",
      "uniq .claude/state/a-mode",
      "uniq -c .claude/state/a-mode",
      "uniq -f 1 .claude/state/a-mode",
      "cut -d: -f1 .claude/state/a-mode",
      "diff .claude/state/a-mode .claude/state/x-mode",
      "file .claude/state/x-mode",
      "basename .claude/state/x-mode",
      "dirname .claude/state/x-mode",
      "realpath .claude/state/x-mode",
      "git show HEAD:.claude/state/git-guard-mode",
      "git diff --stat -- .claude/state",
      "git diff --no-ext-diff -- .claude/state/x-mode",
      "git status --short -- .claude/state",
      "git rev-parse --show-toplevel && ls .claude/state",
      "git ls-files .claude/state",
      "git ls-tree HEAD .claude/state",
      "git merge-base HEAD HEAD && cat .claude/state/x-mode",
      "git -C . log -- .claude/state/x-mode",
      "git --no-pager log -- .claude/state/x-mode",
      "cat .claude/state/x-mode | sort | uniq -c | head -3",
      "wc -l .claude/state/git-guard-mode 2>/dev/null",
    ],
    0,
  );
});

test("atribuição cujo valor não menciona estado passa; a que menciona e prepara escrita barra", (t) => {
  const d = repo(t);
  todos(d, ["X=1; cat .claude/state/git-guard-mode", "N=3 tail -n 3 .claude/state/git-guard.log"], 0);
  todos(
    d,
    [
      `A=.claude/state/x; echo y > "$A"`,
      "f=$(echo > .claude/state/a-mode)",
      "A=.claude/state/x-mode; cat $A",
    ],
    2,
  );
});

// ── verbo da lista que grava ou executa por opção ─────────────────────────────

test("sort, uniq e file que gravam por opção seguem barrados, em toda grafia", (t) => {
  const d = repo(t);
  todos(
    d,
    [
      "sort -o .claude/state/a-mode .claude/state/x-mode",
      "sort --output .claude/state/a-mode .claude/state/x-mode",
      "sort --output=.claude/state/a-mode .claude/state/x-mode",
      "sort --out=.claude/state/a-mode .claude/state/x-mode",
      "sort -uo .claude/state/a-mode .claude/state/x-mode",
      "sort -o.claude/state/a-mode .claude/state/x-mode",
      "sort -ofile .claude/state/x-mode",
      "sort --compress-program=sh .claude/state/x-mode",
      "uniq .claude/state/x-mode .claude/state/a-mode",
      "uniq -c .claude/state/x-mode .claude/state/a-mode",
      "uniq -- .claude/state/x-mode .claude/state/a-mode",
      "file -C -m .claude/state/x-mode",
      "file --compile -m .claude/state/x-mode",
    ],
    2,
  );
  assert.equal(readFileSync(path.join(d, ".claude", "state", "a-mode"), "utf8"), "hard\n");
});

test("git que grava ou executa por opção, ou por ambiente, segue barrado", (t) => {
  const d = repo(t);
  todos(
    d,
    [
      "git diff --output=.claude/state/a-mode",
      "git diff --output .claude/state/a-mode",
      "git log --out=.claude/state/a-mode",
      "git show --output=.claude/state/a-mode HEAD",
      "git grep -O x -- .claude/state",
      "git grep -Ovim x -- .claude/state",
      "git grep -iO x -- .claude/state",
      "git grep --open-files-in-pager=vim x -- .claude/state",
      "git grep --open x -- .claude/state",
      "git -c core.pager=sh log -- .claude/state/x-mode",
      "git -ccore.pager=sh log -- .claude/state/x-mode",
      "git --config-env=core.pager=X log -- .claude/state/x-mode",
      "git --exec-path=/tmp log -- .claude/state/x-mode",
      "git diff --ext-diff -- .claude/state/x-mode",
      "git diff --ext -- .claude/state/x-mode",
      "GIT_EXTERNAL_DIFF='echo off >' git diff -- .claude/state/x-mode",
      "GIT_PAGER=sh git log -- .claude/state/x-mode",
      "PAGER=sh git log -- .claude/state/x-mode",
    ],
    2,
  );
});

test("git com subcomando fora da leitura segue barrado quando cita estado", (t) => {
  const d = repo(t);
  todos(
    d,
    [
      "git add .claude/state/x-mode",
      "git commit -m 'ajusta git-guard-mode'",
      "git " + "check" + "out -- .claude/state/x-mode",
      "git config --get x && cat .claude/state/x-mode",
    ],
    2,
  );
});

// ── interpretador segue barrando ─────────────────────────────────────────────

test("interpretador que grava estado segue barrado", (t) => {
  const d = repo(t);
  todos(
    d,
    [
      `node -e "require('fs').writeFileSync('.claude/state/git-guard-mode','off')"`,
      `python3 -c "open('.claude/state/x-allow','w')"`,
      `awk '{print > ".claude/state/x-mode"}' .claude/state/x-mode`,
      "sed -n 'w .claude/state/x-mode' .claude/state/a-mode",
      `perl -e 'open(F,">.claude/state/x-mode")'`,
      `ruby -e 'File.write(".claude/state/x-mode","off")'`,
      "find .claude/state -name x-mode -delete",
      "ls .claude/state | xargs rm",
      "env X=1 cat .claude/state/x-mode",
      `bash -c "echo off > .claude/state/x-mode"`,
      `sh -c 'cat .claude/state/x-mode'`,
    ],
    2,
  );
  assert.equal(readFileSync(path.join(d, ".claude", "state", "git-guard-mode"), "utf8"), "hard\n");
});

test("resíduo declarado: interpretador só de leitura segue barrado e é contado à parte", (t) => {
  const d = repo(t);
  const residuo_interpretador = [
    `node -e "console.log(require('fs').readFileSync('.claude/state/git-guard-mode','utf8'))"`,
    `python3 -c "print(open('.claude/state/x-mode').read())"`,
    "sed -n 1p .claude/state/git-guard-mode",
  ];
  let contados = 0;
  for (const cmd of residuo_interpretador) if (rodar(d, cmd).status === 2) contados++;
  assert.equal(contados, residuo_interpretador.length, "residuo_interpretador: " + contados);
});

// ── fail-closed e sessão ─────────────────────────────────────────────────────

test("erro dentro da classificação fecha (grava = true)", (t) => {
  const d = repo(t);
  const dir = mkdtempSync(path.join(os.tmpdir(), "t9-preload-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pre = path.join(dir, "preload.cjs");
  // quebra só o `shift` das atribuições, que roda dentro do `try` de `escritaDeEstadoPeloSubagent`
  writeFileSync(
    pre,
    `process.stdin.once("end", () => { Array.prototype.shift = function () { throw new Error("sonda"); }; });\n`,
  );
  const cmd = "X=1; cat .claude/state/git-guard-mode";
  assert.equal(rodar(d, cmd).status, 0, "sem a sonda, a leitura passa");
  assert.equal(rodar(d, cmd, { preload: pre }).status, 2, "com a sonda, fecha");
});

test("a sessão principal não muda: grava modo e lê como antes", (t) => {
  const d = repo(t);
  for (const cmd of [
    "echo off > .claude/state/x-mode",
    "sort -o .claude/state/a-mode .claude/state/x-mode",
    `node -e "require('fs').writeFileSync('.claude/state/x-mode','off')"`,
    "grep -n x .claude/state/qualquer.json",
  ])
    assert.equal(rodar(d, cmd, { subagent: false }).status, 0, cmd);
});

// ── fechamento de F1: a opção escondida em aspas e a palavra montada por fora ───

test("opção que grava, escondida em aspas ou escape, segue barrada", (t) => {
  const d = repo(t);
  todos(
    d,
    [
      'git log -1 "--format=off" "--output=.claude/state/a-mode"',
      'git log -1 --format=off --out""put=.claude/state/a-mode',
      "git log -1 --format=off '--output=.claude/state/a-mode'",
      "git log -1 --format=off \\-\\-output=.claude/state/a-mode",
      'sort "-o" .claude/state/a-mode .claude/state/x-mode',
      "sort '-uo' .claude/state/a-mode .claude/state/x-mode",
      "cat <(tee .claude/state/a-mode <<<off)",
      "cat .claude/state/x-mode >(cat)",
      "sort $'-o' .claude/state/a-mode .claude/state/x-mode",
      // continuação de linha: o bash apaga barra invertida + quebra e cola a opção
      "git log -1 \\\n--output=.claude/state/a-mode",
      "sort \\\n-o .claude/state/a-mode .claude/state/x-mode",
      'git log -1 "--out\\\nput=.claude/state/a-mode"',
      // expansão fora de aspas monta a opção depois da leitura
      "git log -1 {--output=.claude/state/a-mode,}",
      "sort {-o,} .claude/state/a-mode .claude/state/x-mode",
      "git log -1 ${O:---output=.claude/state/a-mode}",
      "O=--output=; git log -1 $O.claude/state/a-mode",
      // `$` expande entre aspas duplas
      'git log -1 "${O:---output=.claude/state/a-mode}"',
      'O=--output=; git log -1 "$O".claude/state/a-mode',
      'git log -1 --out"$X"put=.claude/state/a-mode',
      // barra + CR não é continuação: o LF seguinte separa, e a segunda linha grava
      "cat .claude/state/x-mode \\\r\nsort -o .claude/state/a-mode .claude/state/x-mode",
      // aspa simples dentro de aspas duplas não abre região: o meio é lido como o shell lê
      `cat "'" ; git log -1 \${O:---output=.claude/state/a-mode} ; cat "'"`,
      `cat "'" ; cat a.md > .claude/state/a-mode ; cat "'"`,
      `cat "'" ; sort {-o,} .claude/state/a-mode .claude/state/x-mode ; cat "'"`,
      // `>&arquivo` é `&>arquivo`: grava
      "cat a.md >&.claude/state/a-mode",
      "cat a.md >& .claude/state/a-mode",
      // curinga em posição de opção expande para a opção que casar arquivo do diretório
      "sort -? .claude/state/a-mode .claude/state/x-mode",
      "sort -* .claude/state/a-mode .claude/state/x-mode",
    ],
    2,
  );
  assert.equal(readFileSync(path.join(d, ".claude", "state", "a-mode"), "utf8"), "hard\n");
});

test("leitura com argumento entre aspas segue passando", (t) => {
  const d = repo(t);
  todos(
    d,
    [
      'grep -n "a; b" .claude/state/qualquer.json',
      'git log --format="%h %s" -- .claude/state/git-guard-mode',
      "grep -c 'x | y' .claude/state/git-guard-mode",
      "grep -c '$x {y} a>b' .claude/state/git-guard-mode",
      'grep -c "a\\$b" .claude/state/git-guard-mode 2>/dev/null',
      "grep -c x .claude/state/git-guard-mode 2>&1",
      "grep -c x .claude/state/git-guard-mode 2>&- | wc -l",
    ],
    0,
  );
});
