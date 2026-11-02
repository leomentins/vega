/**
 * saidas-geradas.test.mjs — saída gerada declarada não serializa tasks (HN-29 T23).
 *
 * A condução lê as `saidas_geradas` da declaração do projeto (`.vega/declaracao.json`,
 * pela mesma `saidasGeradas` do `git-guard`, HN-29 T42): Output em comum que é saída
 * gerada não ocupa vaga no `proximo`, e no `trazer` o conflito só nela vira
 * regeneração pelo comando declarado e commit. Plano e repositório de mentira: origin
 * bare, árvore da maestra no ramo do ciclo com a declaração do projeto de teste levada
 * para o `.vega/`, e o clone da filha; hooks desligados (core.hooksPath=/dev/null).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { conflitoSoEmGeradas } from "../git-conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const PROJETO = path.join(AQUI, "fixtures", "projeto-de-teste");
const RAIZ_DO_PLUGIN = path.resolve(AQUI, "..", "..", "..");
const RAIZ_RELATIVA = 'path.resolve(path.dirname(ESTE), "..", "..", "..", "..", "..", "..")';
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const GERADA = "gerado/saida.txt";
// Regera a saída a partir das fontes: o conteúdo depende só de `src/`, nunca de quem escreveu por último.
const GERADOR = [
  'import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";',
  'const fontes = readdirSync("src").sort().map((f) => readFileSync(`src/${f}`, "utf8"));',
  'mkdirSync("gerado", { recursive: true });',
  `writeFileSync(${JSON.stringify(GERADA)}, "gerado\\n" + fontes.join(""));`,
  "",
].join("\n");

// ── fixture ─────────────────────────────────────────────────────────────────

function task(id, outputs) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** ${outputs.map((o) => `\`${o}\` (modify)`).join(" · ")}`,
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

function canonico(tasks) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-10-15",
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
    ...tasks,
    "## 4. Pronto",
    "",
  ].join("\n");
}

const TASKS = [task("T1", ["src/t1.mjs", GERADA]), task("T2", ["src/t2.mjs", GERADA])];

/** A declaração do projeto de teste no `.vega/` do repositório, com as saídas geradas pedidas. */
function declarar(dir, saidas) {
  const vega = path.join(dir, ".vega");
  mkdirSync(vega, { recursive: true });
  // O código do projeto de teste vai junto; o brief acha o contrato da operária pela raiz do
  // plugin, que de dentro do tmp não fica seis pastas acima: ela vai escrita.
  for (const f of readdirSync(path.join(PROJETO, ".altair")).filter((f) => f.endsWith(".mjs"))) {
    const fonte = readFileSync(path.join(PROJETO, ".altair", f), "utf8");
    if (f === "brief-canonico.mjs") assert.ok(fonte.includes(RAIZ_RELATIVA), "o brief do projeto de teste mudou o cálculo da raiz do plugin");
    writeFileSync(path.join(vega, f), fonte.replace(RAIZ_RELATIVA, JSON.stringify(RAIZ_DO_PLUGIN)));
  }
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  copyFileSync(path.join(PROJETO, "docs", "conducao-no-projeto.md"), path.join(dir, "docs", "conducao-no-projeto.md"));
  const conducao = JSON.parse(readFileSync(path.join(PROJETO, ".altair", "adaptador.json"), "utf8"));
  const declaracao = { esquema: 1, papel: "consumidor", versao: { corpo: "1.0.0" }, decisoes: { destino: "git", arquivo: ".vega/decisoes.jsonl" }, conducao };
  if (saidas) declaracao.saidas_geradas = saidas;
  writeFileSync(path.join(vega, "declaracao.json"), `${JSON.stringify(declaracao, null, 2)}\n`);
}

const gitEm = (dir) => (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function configurar(g) {
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
}

function escreverEm(dir, arquivos) {
  for (const [p, conteudo] of Object.entries(arquivos)) {
    mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
    writeFileSync(path.join(dir, p), conteudo);
  }
}

function ambiente(t, { saidas = [{ caminho: GERADA, comando: "node gerar.mjs" }] } = {}) {
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-geradas-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);

  const maestra = path.join(raiz, "maestra");
  mkdirSync(maestra);
  const g = gitEm(maestra);
  g("init", "-q", "-b", "ciclo-teste");
  configurar(g);
  g("remote", "add", "origin", origin);
  declarar(maestra, saidas);
  escreverEm(maestra, {
    "README.md": "fixture\n",
    "gerar.mjs": GERADOR,
    "src/t1.mjs": "export const t1 = 0;\n",
    "src/t2.mjs": "export const t2 = 0;\n",
    [GERADA]: "base\n",
    [CAMINHO]: canonico(TASKS),
  });
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  g("push", "-q", "origin", "ciclo-teste");

  const filha = path.join(raiz, "filha");
  execFileSync("git", ["clone", "-q", origin, filha]);
  const f = gitEm(filha);
  configurar(f);

  const cli = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", maestra, "--ciclo", CICLO], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const linhas = r.stdout.split("\n").filter(Boolean);
    return { status: r.status, stderr: r.stderr, saida: linhas.length === 1 ? JSON.parse(linhas[0]) : null, linhas };
  };
  const ok = (...args) => {
    const r = cli(...args);
    assert.equal(r.status, 0, `${args.join(" ")} → ${r.status}\n${r.stderr}\n${r.linhas.join("\n")}`);
    return r.saida;
  };

  /** A filha busca a tentativa, commita os arquivos (um commit por item) e empurra de volta à mesma referência. */
  const filhaTrabalha = (tk, commits) => {
    const ref = `refs/conducao/${CICLO}/${tk}/1`;
    f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
    f("checkout", "-q", "--detach", "refs/remotes/tentativa");
    for (const arquivos of Array.isArray(commits) ? commits : [commits]) {
      escreverEm(filha, arquivos);
      f("add", "-A");
      f("commit", "-q", "-m", `${CICLO}-F1/${tk} — trabalho`);
    }
    f("push", "-q", "origin", `HEAD:${ref}`);
    return f("rev-parse", "HEAD");
  };

  ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1");
  return { maestra, g, cli, ok, filhaTrabalha };
}

/** As duas tasks abertas, cada filha mexendo na própria fonte e na saída gerada. */
function duasEmConflitoNaGerada(a, { extraT2 = {} } = {}) {
  a.ok("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto");
  a.ok("abrir", "T2", "--tentativa", "1", "--nonce", "nonceT21", "--modo-maestra", "auto");
  a.filhaTrabalha("T1", { "src/t1.mjs": "export const t1 = 1;\n", [GERADA]: "à mão pela T1\n" });
  a.filhaTrabalha("T2", { "src/t2.mjs": "export const t2 = 2;\n", [GERADA]: "à mão pela T2\n", ...extraT2 });
  a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "s1");
}

// ── a decisão pura ──────────────────────────────────────────────────────────

test("conflitoSoEmGeradas: só quando todo caminho em conflito é saída gerada declarada", () => {
  const geradas = [
    { caminho: "a/types.ts", comando: "gen a" },
    { caminho: "b/env.d.ts", comando: "gen b" },
  ];
  assert.deepEqual(conflitoSoEmGeradas(["b/env.d.ts"], geradas), [geradas[1]]);
  assert.deepEqual(conflitoSoEmGeradas(["b/env.d.ts", "a/types.ts"], geradas), geradas);
  assert.equal(conflitoSoEmGeradas(["a/types.ts", "src/x.ts"], geradas), null);
  assert.equal(conflitoSoEmGeradas([], geradas), null);
  assert.equal(conflitoSoEmGeradas(["a/types.ts"], []), null);
});

// ── vaga ────────────────────────────────────────────────────────────────────

test("proximo abre juntas as tasks que só dividem saída gerada declarada", (t) => {
  const a = ambiente(t);
  const p = a.ok("proximo", "--entrada", "{}");
  assert.equal(p.acao, "abrir", JSON.stringify(p));
  assert.deepEqual(p.tarefas.map((x) => x.task), ["T1", "T2"]);
});

test("contraprova: sem a saída declarada, o Output em comum serializa as tasks", (t) => {
  const a = ambiente(t, { saidas: null });
  const p = a.ok("proximo", "--entrada", "{}");
  assert.equal(p.acao, "abrir", JSON.stringify(p));
  assert.deepEqual(p.tarefas.map((x) => x.task), ["T1"]);
});

test("a saída gerada em voo não ocupa a vaga da pronta", (t) => {
  const a = ambiente(t);
  a.ok("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto");
  const p = a.ok("proximo", "--entrada", JSON.stringify({ filhas: [{ sessao: "s1", task: "T1", tentativa: 1, nonce: "nonceT11", estado: "RUNNING" }] }));
  assert.equal(p.acao, "abrir", JSON.stringify(p));
  assert.deepEqual(p.tarefas.map((x) => x.task), ["T2"]);
});

// ── trazer ──────────────────────────────────────────────────────────────────

test("trazer: conflito só na saída gerada é regerado pelo comando declarado e vira commit", (t) => {
  const a = ambiente(t);
  duasEmConflitoNaGerada(a);
  const antes = a.g("rev-parse", "HEAD");
  const s = a.ok("trazer", "T2", "--tentativa", "1", "--sessao", "s2");
  assert.equal(s.acao, "trazida", JSON.stringify(s));
  assert.equal(s.modo, "cherry-pick");
  assert.deepEqual(s.regeneradas, [{ caminho: GERADA, comando: "node gerar.mjs" }]);
  assert.equal(a.g("rev-parse", "HEAD^"), antes, "um commit, o da T2");
  assert.match(a.g("log", "-1", "--format=%s"), /T2 — trabalho/);
  assert.equal(a.g("show", `HEAD:${GERADA}`), "gerado\nexport const t1 = 1;\nexport const t2 = 2;");
  assert.equal(a.g("show", "HEAD:src/t2.mjs"), "export const t2 = 2;");
  assert.equal(a.g("status", "--porcelain"), "");
});

test("trazer: conflito na saída gerada e em outro caminho segue sendo pergunta", (t) => {
  const a = ambiente(t);
  a.ok("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto");
  a.ok("abrir", "T2", "--tentativa", "1", "--nonce", "nonceT21", "--modo-maestra", "auto");
  a.filhaTrabalha("T1", { "src/t1.mjs": "export const t1 = 1;\n", [GERADA]: "T1\n", "README.md": "T1\n" });
  a.filhaTrabalha("T2", { "src/t2.mjs": "export const t2 = 2;\n", [GERADA]: "T2\n", "README.md": "T2\n" });
  a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "s1");
  const head = a.g("rev-parse", "HEAD");
  const r = a.cli("trazer", "T2", "--tentativa", "1", "--sessao", "s2");
  assert.equal(r.status, 1, r.linhas.join("\n"));
  assert.equal(r.saida.motivo, "conflito");
  assert.deepEqual([...r.saida.conflitos].sort(), ["README.md", GERADA].sort());
  assert.equal(r.saida.abortado, true);
  assert.equal(a.g("rev-parse", "HEAD"), head);
  assert.equal(a.g("status", "--porcelain"), "");
});

test("trazer: comando de regeneração que falha aborta e pergunta", (t) => {
  const a = ambiente(t, { saidas: [{ caminho: GERADA, comando: "node -e 'process.exit(3)'" }] });
  duasEmConflitoNaGerada(a);
  const head = a.g("rev-parse", "HEAD");
  const r = a.cli("trazer", "T2", "--tentativa", "1", "--sessao", "s2");
  assert.equal(r.status, 1, r.linhas.join("\n"));
  assert.equal(r.saida.motivo, "conflito");
  assert.match(r.saida.detalhe, /saiu 3/);
  assert.equal(a.g("rev-parse", "HEAD"), head);
  assert.equal(a.g("status", "--porcelain"), "");
});

test("trazer: faixa de dois commits em conflito na gerada regera cada um e segue o cherry-pick", (t) => {
  const a = ambiente(t);
  a.ok("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto");
  a.ok("abrir", "T2", "--tentativa", "1", "--nonce", "nonceT21", "--modo-maestra", "auto");
  a.filhaTrabalha("T1", [{ "src/t1.mjs": "export const t1 = 1;\n", [GERADA]: "T1\n" }]);
  a.filhaTrabalha("T2", [
    { "src/t2.mjs": "export const t2 = 2;\n", [GERADA]: "T2 a\n" },
    { "src/t2.mjs": "export const t2 = 3;\n", [GERADA]: "T2 b\n" },
  ]);
  a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "s1");
  const antes = a.g("rev-parse", "HEAD");
  const s = a.ok("trazer", "T2", "--tentativa", "1", "--sessao", "s2");
  assert.deepEqual(s.regeneradas, [{ caminho: GERADA, comando: "node gerar.mjs" }]);
  assert.equal(a.g("rev-parse", "HEAD~2"), antes, "os dois commits da T2");
  assert.equal(a.g("show", `HEAD~1:${GERADA}`), "gerado\nexport const t1 = 1;\nexport const t2 = 2;");
  assert.equal(a.g("show", `HEAD:${GERADA}`), "gerado\nexport const t1 = 1;\nexport const t2 = 3;");
  assert.equal(a.g("status", "--porcelain"), "");
});

test("trazer: regeneração igual ao HEAD esvazia o commit, que sai da faixa (puladas)", (t) => {
  const a = ambiente(t);
  a.ok("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto");
  a.ok("abrir", "T2", "--tentativa", "1", "--nonce", "nonceT21", "--modo-maestra", "auto");
  a.filhaTrabalha("T1", [{ [GERADA]: "gerado\nexport const t1 = 0;\nexport const t2 = 0;\n" }]);
  a.filhaTrabalha("T2", [{ [GERADA]: "à mão pela T2\n" }]);
  a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "s1");
  const antes = a.g("rev-parse", "HEAD");
  const s = a.ok("trazer", "T2", "--tentativa", "1", "--sessao", "s2");
  assert.deepEqual(s.regeneradas, [{ caminho: GERADA, comando: "node gerar.mjs" }]);
  assert.equal(s.puladas.length, 1, "o commit da T2 ficou vazio e saiu da faixa");
  assert.equal(a.g("rev-parse", "HEAD"), antes);
  assert.equal(a.g("status", "--porcelain"), "");
});

test("trazer: gerador que suja outro arquivo aborta e pergunta, nomeando o arquivo", (t) => {
  const a = ambiente(t, { saidas: [{ caminho: GERADA, comando: "node gerar.mjs && echo sujo > README.md" }] });
  duasEmConflitoNaGerada(a);
  const head = a.g("rev-parse", "HEAD");
  const r = a.cli("trazer", "T2", "--tentativa", "1", "--sessao", "s2");
  assert.equal(r.status, 1, r.linhas.join("\n"));
  assert.equal(r.saida.motivo, "conflito");
  assert.match(r.saida.detalhe, /fora do índice: README\.md/);
  assert.equal(a.g("rev-parse", "HEAD"), head);
});

test("trazer: o comando é o da declaração do HEAD da maestra, não o que a filha trouxe", (t) => {
  const a = ambiente(t);
  a.ok("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto");
  a.ok("abrir", "T2", "--tentativa", "1", "--nonce", "nonceT21", "--modo-maestra", "auto");
  a.filhaTrabalha("T1", [{ "src/t1.mjs": "export const t1 = 1;\n", [GERADA]: "T1\n" }]);
  const decl = JSON.parse(readFileSync(path.join(a.maestra, ".vega", "declaracao.json"), "utf8"));
  decl.saidas_geradas = [{ caminho: GERADA, comando: "node -e 'process.exit(7)'" }];
  const ponta = a.filhaTrabalha("T2", [{ ".vega/declaracao.json": JSON.stringify(decl), "src/t2.mjs": "export const t2 = 2;\n", [GERADA]: "T2\n" }]);
  a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "s1");
  // A filha tocou o `.vega/` (superfície de instrução): o trazer pede o sim pelo sha, e com ele traz.
  const s = a.ok("trazer", "T2", "--tentativa", "1", "--sessao", "s2", "--aprovado", ponta);
  assert.deepEqual(s.regeneradas, [{ caminho: GERADA, comando: "node gerar.mjs" }]);
});

test("contraprova: sem a saída declarada, o conflito nela é pergunta", (t) => {
  const a = ambiente(t, { saidas: null });
  duasEmConflitoNaGerada(a);
  const r = a.cli("trazer", "T2", "--tentativa", "1", "--sessao", "s2");
  assert.equal(r.status, 1, r.linhas.join("\n"));
  assert.equal(r.saida.motivo, "conflito");
});
