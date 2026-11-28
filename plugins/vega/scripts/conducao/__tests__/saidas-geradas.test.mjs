/**
 * saidas-geradas.test.mjs — saída gerada declarada não serializa tasks (HN-29 T23).
 *
 * A condução lê as `saidas_geradas` da declaração do projeto (`.vega/declaracao.json`,
 * pela mesma `saidasGeradas` do `git-guard`, HN-29 T42): Output em comum que é saída
 * gerada não ocupa vaga no `proximo`, e no `trazer` o conflito só nela vira
 * regeneração pelo comando declarado e commit. Plano e repositório de mentira: origin
 * bare, árvore da maestra no ramo do ciclo com a declaração do projeto de teste levada
 * para o `.vega/`, e o clone da filha; hooks desligados (core.hooksPath=/dev/null). Os casos
 * do `trazer` rodam cada um numa cópia de uma base já autorizada, com as duas abertas e a T1 trazida (D3a).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { conflitoSoEmGeradas } from "../git-conducao.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

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
const SAIDAS = [{ caminho: GERADA, comando: "node gerar.mjs" }];

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

/** Origin bare, maestra no ramo do ciclo com a declaração pedida, e o clone da filha, sob `raiz`. */
function montar(raiz, saidas) {
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
  // Ciclo de 2 níveis declarado: sem a marca, o núcleo roda em 3 (D10c do L4).
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 2", "-m", "Conducao-Niveis: 2");
  g("push", "-q", "origin", "ciclo-teste");
  const filha = path.join(raiz, "filha");
  execFileSync("git", ["clone", "-q", origin, filha]);
  configurar(gitEm(filha));
}

/** Os verbos sobre o repositório já montado em `raiz` (o original ou uma cópia). */
function operar(raiz) {
  const maestra = path.join(raiz, "maestra");
  const filha = path.join(raiz, "filha");
  const g = gitEm(maestra);
  const f = gitEm(filha);
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
  return { maestra, g, cli, ok, filhaTrabalha };
}

function ambiente(t, { saidas = SAIDAS } = {}) {
  const raiz = pastaTemporaria("conducao-geradas-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  montar(raiz, saidas);
  const a = operar(raiz);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1", "--pergunta", "p-00000000000000a1");
  return { ...a, raiz };
}

/**
 * Cópia do repositório da `base` (origin, maestra e filha) para um caso da tabela: o origin vai
 * com caminho absoluto na config da maestra e da filha, e é reapontado para o da cópia.
 */
function copiar(t, base) {
  const raiz = pastaTemporaria("conducao-geradas-caso-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  execFileSync("cp", ["-a", `${base.raiz}/.`, raiz]);
  const origin = path.join(raiz, "origin.git");
  for (const d of ["maestra", "filha"]) gitEm(path.join(raiz, d))("remote", "set-url", "origin", origin);
  return operar(raiz);
}

/** A maestra troca as `saidas_geradas` da declaração num commit seu (`null` tira o campo). */
function redeclarar(a, saidas) {
  const arq = path.join(a.maestra, ".vega", "declaracao.json");
  const decl = JSON.parse(readFileSync(arq, "utf8"));
  if (saidas) decl.saidas_geradas = saidas;
  else delete decl.saidas_geradas;
  writeFileSync(arq, `${JSON.stringify(decl, null, 2)}\n`);
  a.g("commit", "-q", "-am", "declaracao do caso");
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

test("contraprova: sem a saída declarada, o Output em comum serializa as tasks", (t) => {
  const a = ambiente(t, { saidas: null });
  const p = a.ok("proximo", "--entrada", "{}");
  assert.equal(p.acao, "abrir", JSON.stringify(p));
  assert.deepEqual(p.tarefas.map((x) => x.task), ["T1"]);
});

// ── trazer, por tabela de casos sobre uma base ─────────────────────────────

// A saída que a T1 deixa é a regerada das fontes depois dela: um commit da T2 que só mexa na
// saída regera igual ao HEAD e sai vazio. O README da T1 é o "outro caminho" de um caso.
const GERADA_DA_T1 = "gerado\nexport const t1 = 1;\nexport const t2 = 0;\n";

/**
 * Cada caso parte de uma cópia da base (as duas tasks abertas, a T1 trazida), troca as
 * `saidas_geradas` da maestra se pedir (`saidas`, `null` tira o campo), deixa a T2 trabalhar
 * (`t2`: um objeto por commit) e traz a T2. `espera(a, r, head)` recebe o retorno do `trazer` e o
 * HEAD de antes dele.
 */
const CASOS = [
  {
    nome: "conflito só na saída gerada é regerado pelo comando declarado e vira commit",
    t2: () => [{ "src/t2.mjs": "export const t2 = 2;\n", [GERADA]: "à mão pela T2\n" }],
    espera: (a, r, head) => {
      assert.equal(r.status, 0, r.linhas.join("\n"));
      const s = r.saida;
      assert.equal(s.acao, "trazida", JSON.stringify(s));
      assert.equal(s.modo, "cherry-pick");
      assert.deepEqual(s.regeneradas, [{ caminho: GERADA, comando: "node gerar.mjs" }]);
      assert.equal(a.g("rev-parse", "HEAD^"), head, "um commit, o da T2");
      assert.match(a.g("log", "-1", "--format=%s"), /T2 — trabalho/);
      assert.equal(a.g("show", `HEAD:${GERADA}`), "gerado\nexport const t1 = 1;\nexport const t2 = 2;");
      assert.equal(a.g("show", "HEAD:src/t2.mjs"), "export const t2 = 2;");
      assert.equal(a.g("status", "--porcelain"), "");
    },
  },
  {
    nome: "conflito na saída gerada e em outro caminho segue sendo pergunta",
    t2: () => [{ "src/t2.mjs": "export const t2 = 2;\n", [GERADA]: "T2\n", "README.md": "T2\n" }],
    espera: (a, r, head) => {
      assert.equal(r.status, 1, r.linhas.join("\n"));
      assert.equal(r.saida.motivo, "conflito");
      assert.deepEqual([...r.saida.conflitos].sort(), ["README.md", GERADA].sort());
      assert.equal(r.saida.abortado, true);
      assert.equal(a.g("rev-parse", "HEAD"), head);
      assert.equal(a.g("status", "--porcelain"), "");
    },
  },
  {
    nome: "comando de regeneração que falha aborta e pergunta",
    saidas: [{ caminho: GERADA, comando: "node -e 'process.exit(3)'" }],
    t2: () => [{ "src/t2.mjs": "export const t2 = 2;\n", [GERADA]: "à mão pela T2\n" }],
    espera: (a, r, head) => {
      assert.equal(r.status, 1, r.linhas.join("\n"));
      assert.equal(r.saida.motivo, "conflito");
      assert.match(r.saida.detalhe, /saiu 3/);
      assert.equal(a.g("rev-parse", "HEAD"), head);
      assert.equal(a.g("status", "--porcelain"), "");
    },
  },
  {
    nome: "faixa de dois commits em conflito na gerada regera cada um e segue o cherry-pick",
    t2: () => [
      { "src/t2.mjs": "export const t2 = 2;\n", [GERADA]: "T2 a\n" },
      { "src/t2.mjs": "export const t2 = 3;\n", [GERADA]: "T2 b\n" },
    ],
    espera: (a, r, head) => {
      assert.equal(r.status, 0, r.linhas.join("\n"));
      assert.deepEqual(r.saida.regeneradas, [{ caminho: GERADA, comando: "node gerar.mjs" }]);
      assert.equal(a.g("rev-parse", "HEAD~2"), head, "os dois commits da T2");
      assert.equal(a.g("show", `HEAD~1:${GERADA}`), "gerado\nexport const t1 = 1;\nexport const t2 = 2;");
      assert.equal(a.g("show", `HEAD:${GERADA}`), "gerado\nexport const t1 = 1;\nexport const t2 = 3;");
      assert.equal(a.g("status", "--porcelain"), "");
    },
  },
  {
    nome: "regeneração igual ao HEAD esvazia o commit, que sai da faixa (puladas)",
    t2: () => [{ [GERADA]: "à mão pela T2\n" }],
    espera: (a, r, head) => {
      assert.equal(r.status, 0, r.linhas.join("\n"));
      assert.deepEqual(r.saida.regeneradas, [{ caminho: GERADA, comando: "node gerar.mjs" }]);
      assert.equal(r.saida.puladas.length, 1, "o commit da T2 ficou vazio e saiu da faixa");
      assert.equal(a.g("rev-parse", "HEAD"), head);
      assert.equal(a.g("status", "--porcelain"), "");
    },
  },
  {
    nome: "gerador que suja outro arquivo aborta e pergunta, nomeando o arquivo",
    saidas: [{ caminho: GERADA, comando: "node gerar.mjs && echo sujo > README.md" }],
    t2: () => [{ "src/t2.mjs": "export const t2 = 2;\n", [GERADA]: "à mão pela T2\n" }],
    espera: (a, r, head) => {
      assert.equal(r.status, 1, r.linhas.join("\n"));
      assert.equal(r.saida.motivo, "conflito");
      assert.match(r.saida.detalhe, /fora do índice: README\.md/);
      assert.equal(a.g("rev-parse", "HEAD"), head);
    },
  },
  {
    nome: "o comando é o da declaração do HEAD da maestra, não o que a filha trouxe",
    // A filha tocou o `.vega/` (superfície de instrução): o trazer pede o sim pelo sha, e com ele traz.
    aprovar: true,
    t2: (a) => {
      const decl = JSON.parse(readFileSync(path.join(a.maestra, ".vega", "declaracao.json"), "utf8"));
      decl.saidas_geradas = [{ caminho: GERADA, comando: "node -e 'process.exit(7)'" }];
      return [{ ".vega/declaracao.json": JSON.stringify(decl), "src/t2.mjs": "export const t2 = 2;\n", [GERADA]: "T2\n" }];
    },
    espera: (a, r) => {
      assert.equal(r.status, 0, r.linhas.join("\n"));
      assert.deepEqual(r.saida.regeneradas, [{ caminho: GERADA, comando: "node gerar.mjs" }]);
    },
  },
  {
    nome: "contraprova: sem a saída declarada, o conflito nela é pergunta",
    saidas: null,
    t2: () => [{ "src/t2.mjs": "export const t2 = 2;\n", [GERADA]: "à mão pela T2\n" }],
    espera: (a, r) => {
      assert.equal(r.status, 1, r.linhas.join("\n"));
      assert.equal(r.saida.motivo, "conflito");
    },
  },
];

test("saída gerada: a vaga e o trazer, por tabela de casos sobre uma base", async (t) => {
  const base = ambiente(t);
  await t.test("vaga: proximo abre juntas as tasks que só dividem saída gerada declarada", () => {
    const p = base.ok("proximo", "--entrada", "{}");
    assert.equal(p.acao, "abrir", JSON.stringify(p));
    assert.deepEqual(p.tarefas.map((x) => x.task), ["T1", "T2"]);
  });
  base.ok("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "auto");
  await t.test("vaga: a saída gerada em voo não ocupa a vaga da pronta", () => {
    const p = base.ok("proximo", "--entrada", JSON.stringify({ filhas: [{ sessao: "s1", task: "T1", tentativa: 1, nonce: "nonceT11", estado: "RUNNING" }] }));
    assert.equal(p.acao, "abrir", JSON.stringify(p));
    assert.deepEqual(p.tarefas.map((x) => x.task), ["T2"]);
  });
  base.ok("abrir", "T2", "--tentativa", "1", "--nonce", "nonceT21", "--modo-maestra", "auto");
  base.filhaTrabalha("T1", { "src/t1.mjs": "export const t1 = 1;\n", [GERADA]: GERADA_DA_T1, "README.md": "T1\n" });
  base.ok("trazer", "T1", "--tentativa", "1", "--sessao", "s1");

  for (const caso of CASOS) {
    await t.test(`trazer: ${caso.nome}`, (tt) => {
      const a = copiar(tt, base);
      if (caso.saidas !== undefined) redeclarar(a, caso.saidas);
      const ponta = a.filhaTrabalha("T2", caso.t2(a));
      const head = a.g("rev-parse", "HEAD");
      const r = a.cli("trazer", "T2", "--tentativa", "1", "--sessao", "s2", ...(caso.aprovar ? ["--aprovado", ponta] : []));
      caso.espera(a, r, head);
    });
  }
});
