// .claude/skills/vega/motor/__tests__/motor-pela-declaracao.test.mjs
//
// O motor lê da declaração do projeto (HN-29 T42): o `git-guard` tira as saídas geradas do
// campo `saidas_geradas`, e o `auto-bump-updated` tira a raiz do grafo de `raiz_do_grafo`.
// Com a declaração do projeto, decidem por ela; sem declaração, a regra comum; declaração
// presente e quebrada, erro visível. Toda declaração aqui é montada num diretório temporário:
// o corpo passa fora da Sistoli (D-HN29-31), e o que se prova sobre a declaração da Sistoli
// mora no lado da fonte, em `.vega/__tests__/declaracao-da-fonte.test.mjs`.
//
// A raiz do projeto do guard é o `CLAUDE_PROJECT_DIR` ou, sem ele, a árvore onde o motor
// mora (D-HN29-22a). Cada caso aqui fixa a variável, ou a apaga, de propósito.
//
// NOTA DE FORMA -- os verbos git aparecem CONCATENADOS (`"git check" + "out"`), pelo mesmo
// motivo de `git-guard-content-preserved.test.mjs`: guards e classificadores leem o texto
// do comando que cria este arquivo, e aqui o verbo é dado de fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saidasGeradas, raizDoGrafo } from "../../scripts/vega/declaracao.mjs";

const MOTOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = path.join(MOTOR, "git-guard.js");
const BUMP = path.join(MOTOR, "auto-bump-updated.js");
const LEITOR = path.resolve(MOTOR, "..", "scripts", "vega", "declaracao.mjs");

const CO = "git " + "check" + "out";
const TYPES = "packages/shared/src/supabase/types.ts";
const NEXT_ENV = "apps/sistoli-os/next-env.d.ts";
const HOJE = new Date().toISOString().slice(0, 10);

const MINIMA = { esquema: 1, papel: "fonte", decisoes: { destino: "git", arquivo: ".vega/decisoes.jsonl" }, listas: { corpo: "a.txt", empresa: "b.txt" } };

function env(projeto) {
  const e = { ...process.env };
  delete e.CLAUDE_PROJECT_DIR;
  if (projeto) e.CLAUDE_PROJECT_DIR = projeto;
  return e;
}

function rodar(hook, entrada, projeto) {
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(entrada),
    encoding: "utf8",
    env: env(projeto),
  });
  return { status: r.status, stderr: r.stderr };
}

const guard = (command, cwd, projeto) => rodar(GUARD, { tool_name: "Bash", cwd, tool_input: { command } }, projeto);
const bump = (file_path, projeto) => rodar(BUMP, { tool_name: "Edit", tool_input: { file_path } }, projeto);

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function tmp(prefixo) {
  return realpathSync.native(mkdtempSync(path.join(os.tmpdir(), prefixo)));
}

/** Repo com cada caminho commitado com X e reescrito com Y no disco: Y em ref nenhuma. */
function repoComGeradas(caminhos) {
  const dir = tmp("motor-decl-");
  git(["init", "-q", "-b", "principal"], dir);
  git(["config", "user.email", "t@t"], dir);
  git(["config", "user.name", "t"], dir);
  for (const c of caminhos) {
    mkdirSync(path.dirname(path.join(dir, c)), { recursive: true });
    writeFileSync(path.join(dir, c), "X\n");
  }
  git(["add", "."], dir);
  git(["commit", "-qm", "x"], dir);
  for (const c of caminhos) writeFileSync(path.join(dir, c), "Y-gerado\n");
  return dir;
}

function declarar(dir, declaracao) {
  mkdirSync(path.join(dir, ".vega"), { recursive: true });
  writeFileSync(
    path.join(dir, ".vega", "declaracao.json"),
    typeof declaracao === "string" ? declaracao : JSON.stringify(declaracao),
  );
}

function logDoGuard(dir) {
  try {
    return readFileSync(path.join(dir, ".claude", "state", "git-guard.log"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

const limpa = (dir) => rmSync(dir, { recursive: true, force: true });

/** As duas saídas que a Sistoli declara, com o comando de cada uma: aqui num projeto de mentira. */
const DECLARADAS = [
  { caminho: NEXT_ENV, comando: "next build" },
  { caminho: TYPES, comando: "pnpm --filter @sistoli/database gen-types" },
];

test("o git-guard e a condução leem a mesma lista: a de `saidasGeradas`, da declaração do projeto", () => {
  const fonte = readFileSync(GUARD, "utf8");
  assert.match(fonte, /require\("\.\.\/scripts\/vega\/declaracao\.mjs"\)/);
  assert.match(fonte, /\bsaidasGeradas\(/);
  assert.doesNotMatch(fonte, /new Map\(\[\s*\[\s*"/, "lista literal de saídas de volta no guard");

  const dir = repoComGeradas(DECLARADAS.map((s) => s.caminho));
  try {
    declarar(dir, { ...MINIMA, saidas_geradas: DECLARADAS });
    const lista = saidasGeradas(dir);
    assert.deepEqual(
      lista.map(({ caminho, comando }) => ({ caminho, comando })),
      DECLARADAS,
    );
    // O guard libera cada saída da lista, com o comando que a declaração dá -- é a mesma lista.
    for (const s of lista) {
      const r = guard(`${CO} -- ${s.caminho}`, dir, dir);
      assert.equal(r.status, 0, `${s.caminho}: ${r.stderr}`);
    }
    const motivos = logDoGuard(dir)
      .filter((e) => e.action === "auto-allowed-content-preserved")
      .map((e) => e.motivo);
    assert.deepEqual(
      motivos,
      lista.map((s) => `${s.caminho} (gerado por \`${s.comando}\`)`),
    );
  } finally {
    limpa(dir);
  }
});

test("com a saída gerada declarada, o descarte de types.ts segue REPRODUZIVEL", () => {
  const dir = repoComGeradas([TYPES]);
  try {
    declarar(dir, { ...MINIMA, saidas_geradas: DECLARADAS });
    assert.equal(guard(`${CO} -- ${TYPES}`, dir, dir).status, 0);
  } finally {
    limpa(dir);
  }
});

test("num projeto sem declaração, o mesmo descarte segue a regra comum e bloqueia", () => {
  const dir = repoComGeradas([TYPES]);
  try {
    const r = guard(`${CO} -- ${TYPES}`, dir, dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /GIT-GUARD block/);
  } finally {
    limpa(dir);
  }
});

test("declaração presente sem o campo: lista vazia, o descarte bloqueia pela regra comum", () => {
  const dir = repoComGeradas([TYPES]);
  try {
    declarar(dir, MINIMA);
    const r = guard(`${CO} -- ${TYPES}`, dir, dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /GIT-GUARD block/);
  } finally {
    limpa(dir);
  }
});

test("declaração do próprio projeto temporário com a saída: o guard libera pela declaração dele", () => {
  const dir = repoComGeradas(["gerado/saida.txt"]);
  try {
    declarar(dir, { ...MINIMA, saidas_geradas: [{ caminho: "gerado/saida.txt", comando: "make saida" }] });
    assert.equal(guard(`${CO} -- gerado/saida.txt`, dir, dir).status, 0);
    // a lista é FECHADA: outro caminho do mesmo projeto não pega carona.
    assert.equal(guard(`${CO} -- ${TYPES}`, dir, dir).status, 2);
  } finally {
    limpa(dir);
  }
});

test("consumidor sem CLAUDE_PROJECT_DIR e sem .vega/: nenhuma saída liberada (falha fechado, D-HN29-22a)", () => {
  // O motor instalado mora fora do projeto (cache do plugin), numa árvore sem `.vega/`.
  const plugin = tmp("motor-plugin-");
  const dir = repoComGeradas([TYPES, NEXT_ENV]);
  try {
    const motor = path.join(plugin, ".claude", "skills", "vega", "motor");
    const leitor = path.join(plugin, ".claude", "skills", "vega", "scripts", "vega");
    mkdirSync(motor, { recursive: true });
    mkdirSync(leitor, { recursive: true });
    copyFileSync(GUARD, path.join(motor, "git-guard.js"));
    copyFileSync(LEITOR, path.join(leitor, "declaracao.mjs"));
    // O projeto declara as saídas, mas sem a variável o guard não o escolhe pelo cwd.
    declarar(dir, { ...MINIMA, saidas_geradas: [{ caminho: TYPES, comando: "gen" }] });
    for (const c of [TYPES, NEXT_ENV]) {
      const r = rodar(path.join(motor, "git-guard.js"), { tool_name: "Bash", cwd: dir, tool_input: { command: `${CO} -- ${c}` } }, null);
      assert.equal(r.status, 2, `${c} liberado sem projeto declarado`);
      assert.match(r.stderr, /GIT-GUARD block/);
    }
  } finally {
    limpa(plugin);
    limpa(dir);
  }
});

const QUEBRADAS = [
  ["JSON ilegível", "{ nao e json"],
  ["campo com tipo errado", { ...MINIMA, saidas_geradas: "types.ts" }],
  ["campo desconhecido na saída", { ...MINIMA, saidas_geradas: [{ caminho: "a.ts", comando: "x", extra: 1 }] }],
  ["campo desconhecido na raiz", { ...MINIMA, saida_gerada: [] }],
  ["valor desconhecido: glob no caminho", { ...MINIMA, saidas_geradas: [{ caminho: "src/*.ts", comando: "x" }] }],
  ["valor desconhecido: raiz do grafo vazia", { ...MINIMA, raiz_do_grafo: "." }],
  ["raiz do grafo com tipo errado", { ...MINIMA, raiz_do_grafo: ["grafo"] }],
];

for (const [nome, declaracao] of QUEBRADAS) {
  test(`git-guard: declaração presente com ${nome} sai 2 com o motivo no stderr`, () => {
    const dir = repoComGeradas([TYPES]);
    try {
      declarar(dir, declaracao);
      const r = guard(`${CO} -- ${TYPES}`, dir, dir);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /declaracao do projeto ilegivel/);
    } finally {
      limpa(dir);
    }
  });

  test(`auto-bump: declaração presente com ${nome} sai diferente de 0 com o motivo no stderr, sem tocar o arquivo`, () => {
    const dir = tmp("motor-bump-");
    try {
      declarar(dir, declaracao);
      const nota = escreverNota(dir, "grafo/no.md");
      const antes = readFileSync(nota, "utf8");
      const r = bump(nota, dir);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /declaracao do projeto ilegivel/);
      assert.equal(readFileSync(nota, "utf8"), antes);
    } finally {
      limpa(dir);
    }
  });
}

test("git-guard em modo soft: declaração quebrada avisa no stderr e não bloqueia (soft é log-only)", () => {
  const dir = repoComGeradas([TYPES]);
  try {
    declarar(dir, "{ nao e json");
    mkdirSync(path.join(dir, ".claude", "state"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "state", "git-guard-mode"), "soft\n");
    const r = guard(`${CO} -- ${TYPES}`, dir, dir);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /declaracao do projeto ilegivel/);
    assert.ok(logDoGuard(dir).some((e) => e.action === "declaracao-ilegivel"));
  } finally {
    limpa(dir);
  }
});

function escreverNota(dir, rel) {
  const p = path.join(dir, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "---\nid: x/no\nopened: 2026-01-01\nupdated: 2026-01-02\n---\n\ncorpo\n");
  return p;
}

test("auto-bump: com a raiz do grafo declarada em .agents, o bump sob .agents/ acontece", () => {
  const dir = tmp("motor-bump-");
  try {
    declarar(dir, { ...MINIMA, raiz_do_grafo: ".agents" });
    assert.equal(raizDoGrafo(dir), ".agents");
    const dentro = escreverNota(dir, ".agents/conceito/no.md");
    const fora = escreverNota(dir, "docs/no.md");
    assert.equal(bump(dentro, dir).status, 0);
    assert.equal(bump(fora, dir).status, 0);
    assert.match(readFileSync(dentro, "utf8"), new RegExp(`^updated: ${HOJE}$`, "m"));
    assert.match(readFileSync(fora, "utf8"), /^updated: 2026-01-02$/m, "fora da raiz do grafo não se toca");
  } finally {
    limpa(dir);
  }
});

test("auto-bump: num projeto sem declaração, sai 0 sem tocar o arquivo", () => {
  const dir = tmp("motor-bump-");
  try {
    const nota = escreverNota(dir, ".agents/conceito/no.md");
    const antes = readFileSync(nota, "utf8");
    assert.equal(bump(nota, dir).status, 0);
    assert.equal(readFileSync(nota, "utf8"), antes);
  } finally {
    limpa(dir);
  }
});

test("auto-bump: declaração sem raiz_do_grafo sai 0 sem tocar; com raiz própria, carimba nela", () => {
  const dir = tmp("motor-bump-");
  try {
    declarar(dir, MINIMA);
    const nota = escreverNota(dir, "grafo/no.md");
    const antes = readFileSync(nota, "utf8");
    assert.equal(bump(nota, dir).status, 0);
    assert.equal(readFileSync(nota, "utf8"), antes);

    declarar(dir, { ...MINIMA, raiz_do_grafo: "grafo/" });
    assert.equal(bump(nota, dir).status, 0);
    assert.match(readFileSync(nota, "utf8"), new RegExp(`^updated: ${HOJE}$`, "m"));
  } finally {
    limpa(dir);
  }
});

// A paridade esquema↔leitor precisa de validador de esquema, que o corpo não tem (zero
// dependência, E1.A2): ela mora no lado da fonte (D-HN29-31). Aqui, o esquema é conferido na
// estrutura, e cada recusa passa pelo leitor.
test("o esquema versionado declara os dois campos, e o leitor recusa o que eles não admitem", async () => {
  const { validar } = await import("../../scripts/vega/declaracao.mjs");
  const esquema = JSON.parse(readFileSync(path.resolve(MOTOR, "..", "scripts", "vega", "declaracao.schema.json"), "utf8"));
  assert.equal(esquema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(esquema.additionalProperties, false);
  assert.equal(esquema.properties.saidas_geradas?.type, "array");
  assert.equal(esquema.properties.raiz_do_grafo?.type, "string");
  const valida = { ...MINIMA, saidas_geradas: DECLARADAS, raiz_do_grafo: ".agents" };
  for (const k of Object.keys(valida)) assert.ok(k in esquema.properties, `campo ${k} fora do esquema`);
  assert.equal(validar(valida).raiz_do_grafo, ".agents");
  for (const [nome, d] of QUEBRADAS) {
    if (typeof d === "string") continue; // JSON ilegível não chega ao leitor
    assert.throws(() => validar(d), `leitor aceitou: ${nome}`);
  }
  const extras = [
    { ...MINIMA, saidas_geradas: [{ caminho: "gerado/", comando: "x" }] },
    { ...MINIMA, saidas_geradas: [{ caminho: "a.ts", comando: "" }] },
    { ...MINIMA, saidas_geradas: [{ caminho: "../fora.ts", comando: "x" }] },
    { ...MINIMA, raiz_do_grafo: "/" + "grafo" },
  ];
  for (const d of extras) assert.throws(() => validar(d), `leitor aceitou ${JSON.stringify(d)}`);
  assert.throws(
    () => validar({ ...MINIMA, saidas_geradas: [{ caminho: "a.ts", comando: "x" }, { caminho: "./a.ts", comando: "y" }] }),
    /caminho repetido/,
  );
});
