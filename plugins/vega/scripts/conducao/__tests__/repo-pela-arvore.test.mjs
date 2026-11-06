/**
 * repo-pela-arvore.test.mjs — a condução acha a árvore do ciclo pelo ramo
 * (VEGA-26 T10, AC-VEGA26-8).
 *
 * Sem `--repo`, os verbos do ciclo leem `git worktree list --porcelain` e
 * usam a árvore com o ramo `ciclo-<id>[-<slug>]` aberto; nenhuma ⇒ a mensagem
 * manda `adotar`; duas (só com `--force`) ⇒ erro. Com `--repo`, segue igual.
 * O `encerrar-sessao` fica idempotente pela cópia remota (15-a): o nonce já em
 * `refs/conducao/<ciclo>/copia` no origin não grava nem empurra; origin
 * inalcançável sai 1 sem marcador.
 *
 * Origin bare em pasta temporária, árvore principal em `main` e a do ciclo
 * por `git worktree add`; hooks desligados (core.hooksPath=/dev/null).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const RAMO = `ciclo-${CICLO}`;
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

function task(id, { inputs = "`README.md`", satisfies = "[AC-TESTE1-1]", fase = "F1" } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    `- **satisfies:** ${satisfies}`,
    `- **Inputs:** ${inputs}`,
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    "- **Estação:** servidor",
    "- **Steps:** faz",
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

const FECHA = "[—] (fechamento-de-fase)";

const CANONICO = [
  "---",
  `cycle: ${CICLO}`,
  "opened: 2026-11-04",
  "---",
  "",
  "## 1. Goal",
  "",
  "### 1.5 Modo de Execução",
  "",
  "**Largura do ciclo:** 2",
  "",
  "## 3. Tasks",
  "",
  "### F1 — fase F1 (**Modelo:** sonnet)",
  "",
  task("T1"),
  task("T2", { inputs: "T1", satisfies: FECHA }),
  "### F2 — fase F2 (**Modelo:** opus)",
  "",
  task("T3", { inputs: "T2", fase: "F2" }),
  task("T4", { inputs: "T3", satisfies: FECHA, fase: "F2" }),
  "## 4. Pronto",
  "",
].join("\n");

/** Origin + árvore principal em `main` + (com `comCiclo`) a árvore do ciclo, F1 conduzida até o fechamento conferido. */
function ambiente(t, { comCiclo = true } = {}) {
  const raiz = realpathSync(mkdtempSync(path.join(tmpdir(), "repo-pela-arvore-")));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const principal = path.join(raiz, "principal");
  const arvore = path.join(raiz, "arvore-do-ciclo");
  const em = (dir) => (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const gp = em(principal);
  const g = em(arvore);
  mkdirSync(principal);
  gp("init", "-q", "-b", "main");
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]])
    gp("config", k, v);
  gp("remote", "add", "origin", origin);
  writeFileSync(path.join(principal, "README.md"), "teste\n");
  gp("add", "README.md");
  gp("commit", "-q", "-m", "raiz");
  gp("push", "-q", "origin", "main");
  if (comCiclo) {
    gp("worktree", "add", "-q", "-b", RAMO, arvore, "main");
    mkdirSync(path.join(arvore, path.dirname(CAMINHO)), { recursive: true });
    writeFileSync(path.join(arvore, CAMINHO), CANONICO);
    g("add", CAMINHO);
    g("commit", "-q", "-m", "plano");
    g("push", "-q", "origin", RAMO);
    const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
    vazio("Conducao: F1 autorizada", "sim do Rita, no turno dele", `Conducao-Plano: ${g("rev-parse", `HEAD:${CAMINHO}`)}`);
    for (const id of ["T1", "T2"])
      vazio(
        `Conducao: ${id} conferida`,
        `Conducao-Task: ${id}\nConducao-Sha-Filha: 0000000\nConducao-Sessao-Filha: s\nConducao-Nonce: n-${id}\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica`,
      );
  }
  /** O CLI rodado de `cwd`, sem `--repo` salvo se vier nos args. */
  const cli = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args, "--ciclo", CICLO], { encoding: "utf8", cwd });
  const json = (r) => {
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  const copiaRemota = () => gp("ls-remote", "origin", `refs/conducao/${CICLO}/copia`).split("\t")[0] || null;
  return { raiz, origin, principal, arvore, gp, g, cli, json, copiaRemota };
}

test("retomar sem --repo acha a árvore pelo ramo do ciclo, de qualquer árvore do repositório", (t) => {
  const a = ambiente(t);
  for (const cwd of [a.principal, a.arvore, path.join(a.arvore, ".agents")]) {
    const s = a.json(a.cli(cwd, "retomar"));
    assert.equal(s.acao, "retomar");
    assert.equal(s.ramo, RAMO, cwd);
    assert.equal(s.head, a.g("rev-parse", "HEAD"), cwd);
    assert.deepEqual(s.autorizadas, ["F1"]);
  }
});

test("com --repo explícito segue igual: usa a árvore dada, mesmo sem o ramo do ciclo", (t) => {
  const a = ambiente(t);
  const s = a.json(a.cli(a.arvore, "retomar", "--repo", a.principal));
  assert.equal(s.ramo, "main");
  assert.equal(s.head, a.gp("rev-parse", "HEAD"));
  assert.deepEqual(s.autorizadas, []);
});

test("ramo com slug também é do ciclo", (t) => {
  const a = ambiente(t, { comCiclo: false });
  const outra = path.join(a.raiz, "com-slug");
  a.gp("worktree", "add", "-q", "-b", `${RAMO}-s`, outra, "main");
  const s = a.json(a.cli(a.principal, "retomar"));
  assert.equal(s.ramo, `${RAMO}-s`);
});

test("nenhuma árvore com o ramo do ciclo aberto: sai 1 com a mensagem que manda adotar", (t) => {
  const a = ambiente(t, { comCiclo: false });
  // Ramo de outro ciclo cujo id só começa igual não conta.
  a.gp("worktree", "add", "-q", "-b", "ciclo-TESTE-10-outro", path.join(a.raiz, "outro"), "main");
  for (const verbo of [["retomar"], ["proximo"], ["encerrar-sessao", "--fase", "F1", "--nonce", "abcd1234"]]) {
    const r = a.cli(a.principal, ...verbo);
    assert.equal(r.status, 1, `${verbo[0]}: ${r.stderr}`);
    assert.match(r.stderr, /arvore-do-ciclo-ausente: nenhuma árvore tem o ramo ciclo-TESTE-1-conducao aberto/);
    assert.match(r.stderr, /pelo verbo do projeto \(arvore\.mjs adotar --ciclo TESTE-1-conducao\) ou passe --repo/);
  }
});

test("duas árvores com o ramo do ciclo (só com --force, ou ramo com e sem slug) é erro, nunca escolha", (t) => {
  const a = ambiente(t);
  const dupla = path.join(a.raiz, "dupla");
  a.gp("worktree", "add", "-q", "--force", dupla, RAMO);
  const r = a.cli(a.principal, "retomar");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /arvore-do-ciclo-ambigua: 2 árvores com ramo do ciclo/);
  assert.ok(r.stderr.includes(a.arvore) && r.stderr.includes(dupla), r.stderr);
  // Pasta apagada à mão: o registro fica `prunable` e não conta.
  rmSync(dupla, { recursive: true, force: true });
  assert.equal(a.json(a.cli(a.principal, "retomar")).ramo, RAMO);
  a.gp("worktree", "prune");

  a.gp("worktree", "add", "-q", "-b", `${RAMO}-s`, path.join(a.raiz, "com-slug"), "main");
  const r2 = a.cli(a.principal, "retomar");
  assert.equal(r2.status, 1, r2.stderr);
  assert.match(r2.stderr, /arvore-do-ciclo-ambigua/);
});

test("o texto do encerrar-sessao cita a árvore achada pelo ramo", (t) => {
  const a = ambiente(t);
  const head = a.g("rev-parse", "HEAD");
  const e = a.json(a.cli(a.principal, "proximo", "--entrada", JSON.stringify({ ci: { sha: head, veredito: "verde", run: 1 } })));
  assert.equal(e.acao, "encerrar-sessao");
  assert.ok(e.texto.includes(`worktree conduzida: ${a.arvore})`), e.texto);
  assert.ok(e.texto.includes(`retomar --repo ${a.arvore} --ciclo ${CICLO}`), e.texto);
  assert.ok(!e.texto.includes(a.principal), e.texto);

  // Sem --repo, o verbo grava na árvore achada (não no cwd) e empurra a cópia.
  const s = a.json(a.cli(a.principal, "encerrar-sessao", "--fase", "F1", "--nonce", e.nonce));
  assert.equal(s.acao, "encerrada");
  assert.equal(s.jaEstava, false);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: F1 sessao encerrada");
  assert.equal(a.gp("log", "-1", "--format=%s", "main"), "raiz");
  assert.equal(a.copiaRemota(), a.g("rev-parse", "HEAD"));
});

test("encerrar-sessao com o nonce já na cópia remota não cria commit nem push, e sai 0", (t) => {
  const a = ambiente(t);
  const head = a.g("rev-parse", "HEAD");
  const e = a.json(a.cli(a.arvore, "proximo", "--entrada", JSON.stringify({ ci: { sha: head, veredito: "verde", run: 2 } })));
  const s = a.json(a.cli(a.arvore, "encerrar-sessao", "--fase", "F1", "--nonce", e.nonce));
  const marcador = s.sha;
  assert.equal(a.copiaRemota(), marcador);

  // A volta de outra estação: o ramo local sem o marcador, a referência local da cópia velha.
  a.g("reset", "-q", "--hard", head);
  a.g("update-ref", `refs/conducao-local/${CICLO}/copia`, head);
  // O objeto do marcador some daqui: a conferência tem de buscá-lo no origin.
  a.gp("reflog", "expire", "--expire=now", "--all");
  a.gp("gc", "-q", "--prune=now");
  assert.notEqual(spawnSync("git", ["-C", a.arvore, "cat-file", "-e", `${marcador}^{commit}`]).status, 0);
  // Mesmo nonce, outra fase: não é o mesmo marcador.
  const outraFase = a.cli(a.principal, "encerrar-sessao", "--fase", "F2", "--nonce", e.nonce);
  assert.notEqual(a.g("rev-parse", "HEAD"), head, outraFase.stderr);
  a.g("reset", "-q", "--hard", head);
  a.g("update-ref", `refs/conducao-local/${CICLO}/copia`, head);
  const r =a.cli(a.principal, "encerrar-sessao", "--fase", "F1", "--nonce", e.nonce);
  const de2 = a.json(r);
  assert.equal(de2.acao, "encerrada");
  assert.equal(de2.jaEstava, true);
  assert.equal(de2.sha, marcador);
  assert.equal(de2.copia.empurrada, false);
  assert.match(de2.detalhe, /a sessão já estava encerrada/);
  assert.match(de2.detalhe, /o ramo local não recebeu o marcador/);
  // A busca trouxe o objeto do origin.
  assert.equal(spawnSync("git", ["-C", a.arvore, "cat-file", "-e", `${marcador}^{commit}`]).status, 0);
  // Nada gravado nem empurrado.
  assert.equal(a.g("rev-parse", "HEAD"), head);
  assert.equal(a.copiaRemota(), marcador);
  assert.equal(a.g("rev-parse", `refs/conducao-local/${CICLO}/copia`), head);

  // A mesma marca com outro nonce não é a mesma sessão: grava (fluxo de antes).
  const outro = a.cli(a.principal, "encerrar-sessao", "--fase", "F1", "--nonce", "outro-nonce-1");
  assert.notEqual(a.g("rev-parse", "HEAD"), head, outro.stderr);
});

test("encerrar-sessao com o origin inalcançável sai 1 sem marcador", (t) => {
  const a = ambiente(t);
  const head = a.g("rev-parse", "HEAD");
  a.g("remote", "set-url", "origin", path.join(a.raiz, "nao-existe.git"));
  const r = a.cli(a.principal, "encerrar-sessao", "--fase", "F1", "--nonce", "abcd1234");
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, /copia-remota-inalcancavel: não consegui conferir a cópia remota refs\/conducao\/TESTE-1-conducao\/copia/);
  assert.equal(a.g("rev-parse", "HEAD"), head);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: T2 conferida");
});
