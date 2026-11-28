// Memória por processo do executor git da condução (hotfix vega-conducao-git-memoizado, D4a).
// Prova: (1) só resposta imutável é guardada; (2) a resposta guardada é a mesma da primeira e não
// chama o git de novo; (3) HEAD e ref nunca vêm da memória, mesmo depois de um commit no meio;
// (4) falha não é guardada; (5) o interruptor de desligar funciona.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";
import path from "node:path";

// Git falso no PATH que conta as chamadas e delega ao git real: prova que a memória não chama.
function gitContador() {
  const dir = pastaTemporaria("git-exec-contador-");
  const conta = path.join(dir, "conta.txt");
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const falso = path.join(dir, "git");
  writeFileSync(falso, `#!/bin/sh\necho "$*" >> "${conta}"\nexec "${real}" "$@"\n`);
  chmodSync(falso, 0o755);
  return { dir, n: () => (existsSync(conta) ? readFileSync(conta, "utf8").split("\n").filter(Boolean).length : 0) };
}

// O executor copia o ambiente (e o PATH) no import: o contador entra no PATH antes dele.
const contador = gitContador();
process.env.PATH = `${contador.dir}${path.delimiter}${process.env.PATH}`;
const { git, tentarGit, respostaImutavel, esquecerMemoriaGit, _memoriaGit } = await import("../git-exec.mjs");
process.on("exit", () => rmSync(contador.dir, { recursive: true, force: true }));

test("respostaImutavel: so SHA completo e raiz do repositorio", () => {
  const sha = "a".repeat(40);
  const sim = [
    ["rev-parse", "--show-toplevel"],
    ["rev-parse", "--git-dir", "--git-common-dir"],
    ["show", `${sha}:x/y.md`],
    ["log", "-1", "--format=%b", sha],
    ["log", "--reverse", "--format=%H%x1f%s", sha],
    ["ls-tree", "-r", "--name-only", sha, "--", "x"],
    ["rev-parse", "--verify", "-q", `${sha}^{commit}`],
    ["rev-parse", `${sha}:x.md`],
    ["cat-file", "-p", sha],
    ["rev-parse", `${sha}^`],
    ["merge-base", "--is-ancestor", sha, "b".repeat(40)],
    ["rev-list", "--reverse", `${sha}..${"b".repeat(40)}`],
    ["rev-list", "--extended-regexp", "--grep=^Conducao: ", `${sha}..${"b".repeat(40)}`],
    ["diff", "--name-only", "-z", "--no-renames", sha, "b".repeat(40)],
    ["diff", "--name-only", `${sha}..${"b".repeat(40)}`, "--", "x"],
    ["diff-tree", "-z", "--no-commit-id", "--name-only", "-r", "--root", sha],
    ["log", "-1", "--format=%H%x1f%s%x1f%(trailers:only=true,unfold=true)%x1e", sha],
  ];
  const nao = [
    ["rev-parse", "HEAD"],
    ["rev-parse", "--verify", "-q", "refs/conducao-local/X/T1/1^{commit}"],
    ["log", "-1", "HEAD"],
    ["log", "--all", sha],
    ["log", "-1", "--format=%cr", sha],
    ["log", "--since=1.day", sha],
    ["log", "--date=relative", sha],
    ["ls-tree", "-r", "HEAD"],
    ["show", "main:x.md"],
    ["show", sha.slice(0, 12)],
    ["status", "--porcelain"],
    ["diff", sha],
    ["for-each-ref", sha],
    ["rev-parse", "--show-toplevel", "HEAD"],
    ["rev-parse"],
    [],
    // Achados dos revisores: ref, nota, mailmap, tag, relogio e chaveiro nunca entram.
    ["log", "-1", sha],
    ["log", "-1", "--format=%D", sha],
    ["log", "-1", "--format=%d", sha],
    ["log", "--decorate", "--format=%s", sha],
    ["log", "--source", "--format=%s", sha],
    ["log", "-1", "--format=%N", sha],
    ["log", "-1", "--format=%aN", sha],
    ["log", "-1", "--format=%(describe)", sha],
    ["log", "-1", "--format=%ah", sha],
    ["log", "-1", "--format=%G?", sha],
    ["log", "-1", "--format=%h", sha],
    ["log", "--merge", "--format=%s", sha],
    ["show", sha],
    ["show", "--notes", `${sha}:x.md`],
    ["rev-parse", "--short", sha],
    ["merge-base", "--is-ancestor", sha, "HEAD"],
    ["diff", sha],
    ["diff", "--stat", sha, "b".repeat(40)],
    ["log", "--opcao-que-o-git-ganhe-amanha", "--format=%s", sha],
    // `..` depois do `--` e caminho, nunca intervalo: o diff segue contra a arvore de trabalho.
    ["diff", sha, "--", "../a"],
    ["diff", sha, "--", "x..y"],
  ];
  for (const a of sim) assert.equal(respostaImutavel(a), true, a.join(" "));
  for (const a of nao) assert.equal(respostaImutavel(a), false, a.join(" "));
});

function repoComUmCommit(conteudo = "um\n") {
  const d = pastaTemporaria("git-exec-memoria-");
  const g = (...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  writeFileSync(path.join(d, "a.md"), conteudo);
  g("add", ".");
  g("commit", "-qm", "um");
  return { d, g };
}

test("memoria: SHA completo responde igual e nao chama o git de novo; HEAD sempre chama", () => {
  const { d, g } = repoComUmCommit();
  try {
    esquecerMemoriaGit();
    const sha = g("rev-parse", "HEAD");
    const n0 = contador.n();
    const a = git(d, ["show", `${sha}:a.md`]);
    const b = git(d, ["show", `${sha}:a.md`]);
    const c = tentarGit(d, ["show", `${sha}:a.md`]);
    assert.equal(a, "um");
    assert.equal(b, a);
    assert.deepEqual({ status: c.status, saida: c.saida }, { status: 0, saida: "um" });
    assert.equal(contador.n() - n0, 1, "a segunda e a terceira leitura do mesmo objeto vem da memoria");
    // `cru` devolve o byte a byte guardado, com a quebra de linha.
    assert.equal(git(d, ["show", `${sha}:a.md`], { cru: true }), "um\n");
    assert.equal(contador.n() - n0, 1);

    // HEAD muda no meio do processo (o proprio comando commita): nunca vem da memoria.
    const n1 = contador.n();
    const h1 = git(d, ["rev-parse", "HEAD"]);
    writeFileSync(path.join(d, "a.md"), "dois\n");
    g("commit", "-qam", "dois");
    const h2 = git(d, ["rev-parse", "HEAD"]);
    assert.notEqual(h2, h1, "HEAD depois do commit e outro");
    assert.equal(git(d, ["show", "HEAD:a.md"]), "dois");
    assert.equal(git(d, ["show", `${sha}:a.md`]), "um", "o objeto velho segue o mesmo");
    assert.ok(contador.n() - n1 >= 4, "HEAD e o commit foram ao git");
    assert.ok(![..._memoriaGit.keys()].some((k) => k.includes("HEAD")), "nada com HEAD na memoria");
  } finally {
    esquecerMemoriaGit();
    rmSync(d, { recursive: true, force: true });
  }
});

test("memoria: falha nao e guardada (tentarGit e git que falham deixam a memoria vazia)", () => {
  const { d, g } = repoComUmCommit();
  try {
    esquecerMemoriaGit();
    const sha = g("rev-parse", "HEAD");
    const r1 = tentarGit(d, ["show", `${sha}:nao-existe.md`]);
    assert.notEqual(r1.status, 0);
    assert.throws(() => git(d, ["show", `${sha}:nao-existe.md`]));
    assert.equal(_memoriaGit.size, 0, "falha nao entra na memoria");
  } finally {
    esquecerMemoriaGit();
    rmSync(d, { recursive: true, force: true });
  }
});

test("memoria: ALTAIR_CONDUCAO_GIT_SEM_MEMORIA=1 desliga", () => {
  const { d, g } = repoComUmCommit();
  const antes = process.env.ALTAIR_CONDUCAO_GIT_SEM_MEMORIA;
  process.env.ALTAIR_CONDUCAO_GIT_SEM_MEMORIA = "1";
  try {
    esquecerMemoriaGit();
    const sha = g("rev-parse", "HEAD");
    git(d, ["show", `${sha}:a.md`]);
    git(d, ["rev-parse", "--show-toplevel"]);
    assert.equal(_memoriaGit.size, 0);
  } finally {
    if (antes === undefined) delete process.env.ALTAIR_CONDUCAO_GIT_SEM_MEMORIA;
    else process.env.ALTAIR_CONDUCAO_GIT_SEM_MEMORIA = antes;
    esquecerMemoriaGit();
    rmSync(d, { recursive: true, force: true });
  }
});

test("memoria: raiz do repositorio vem da memoria, por repositorio (sem colisao entre dois)", () => {
  const um = repoComUmCommit();
  const dois = repoComUmCommit("outro\n"); // conteudo diferente: SHA diferente
  try {
    esquecerMemoriaGit();
    const n0 = contador.n();
    const r1 = git(um.d, ["rev-parse", "--show-toplevel"]);
    const r1b = tentarGit(um.d, ["rev-parse", "--show-toplevel"]);
    const r2 = git(dois.d, ["rev-parse", "--show-toplevel"]);
    assert.equal(contador.n() - n0, 2, "uma chamada por repositorio; a repeticao vem da memoria");
    assert.equal(r1b.saida, r1);
    assert.equal(r1b.status, 0);
    assert.notEqual(r1, r2, "dois repositorios nao dividem a resposta");
    // Mesmos args em repositorios diferentes: o SHA do commit difere, mas a chave tem o repo.
    const s1 = um.g("rev-parse", "HEAD");
    assert.equal(git(um.d, ["log", "-1", "--format=%s", s1]), "um");
    assert.throws(() => git(dois.d, ["log", "-1", "--format=%s", s1]), "o objeto do outro repo nao responde por este");
  } finally {
    esquecerMemoriaGit();
    rmSync(um.d, { recursive: true, force: true });
    rmSync(dois.d, { recursive: true, force: true });
  }
});

test("memoria: tentarGit le a entrada que git() guardou, e git() le a de tentarGit", () => {
  const { d, g } = repoComUmCommit();
  try {
    esquecerMemoriaGit();
    const sha = g("rev-parse", "HEAD");
    const n0 = contador.n();
    assert.equal(git(d, ["ls-tree", "-r", "--name-only", sha]), "a.md");
    const t = tentarGit(d, ["ls-tree", "-r", "--name-only", sha]);
    assert.deepEqual({ status: t.status, saida: t.saida }, { status: 0, saida: "a.md" });
    const t2 = tentarGit(d, ["cat-file", "-t", sha]);
    assert.equal(git(d, ["cat-file", "-t", sha]), t2.saida);
    assert.equal(contador.n() - n0, 2);
  } finally {
    esquecerMemoriaGit();
    rmSync(d, { recursive: true, force: true });
  }
});
