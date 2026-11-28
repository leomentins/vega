/**
 * conducao-rodadas.test.mjs — rodadas da conferência do operador, no caso por
 * arquivo: o `/gate-de-ux` do projeto de teste.
 *
 * Desde a T14 (7-a) a task `(gate-de-ux)` é um caso de conferência do
 * operador declarado no adaptador do projeto de teste (`.altair/adaptador.json`,
 * `conferencia`): a resposta do operador é o `verdict:` do approval, e o não
 * (`NEEDS_REWORK`) abre rodada nova por `--rodada nao` (ou `needs-rework`, o
 * mesmo não no nome do gate). O caso por pergunta, e este passando pelo mesmo
 * caminho, ficam em `conferencia-operador.test.mjs`. O repositório do teste
 * não tem `.altair/`, então lê a declaração da árvore do núcleo.
 *
 * O rito da task `(gate-de-ux)` (task-brief.mjs `contratoDeRodadas`) roda uma
 * rodada por sessão fresca: A (gate + approval), B (conserto + carimbo), C
 * (gate de novo, `rodada: n+1`), sem teto (25/11/2026). Cada rodada é uma
 * tentativa da mesma task. Antes do verbo `registrar-conferencia --rodada`, a
 * rodada com `verdict: NEEDS_REWORK` deixava a trazida sem saída: a
 * Verificação (`grep SHIP|SHIP_WITH_DEBT`) sai 1, a conferência só aceita
 * `verde`, e o `proximo` parava em `trazida-sem-conferencia` (contraprova:
 * o primeiro teste falha no `registrar-conferencia --rodada` sem o verbo).
 *
 * Mesmo arranjo de conducao-git.test.mjs: origin bare, árvore da maestra,
 * clone da filha, hooks desligados, verbos chamados como CLI. A ponta a ponta
 * (A → B → C) parte do zero; os outros casos partem de uma cópia de um prefixo
 * fotografado (§prefixos fotografados), rodado pelo CLI uma vez por arquivo
 * (D3a, 25/11/2026: o mesmo prefixo refeito por caso era a parede do passo).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerApproval } from "../git-conducao.mjs";
import { conferirRodada } from "../verbos.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-2-rodadas";
const PASTA = `.agents/ciclo/teste/${CICLO}`;
const CAMINHO = `${PASTA}/canonico.md`;
const APPROVAL = `${PASTA}/gate-de-ux-approval.md`;

function task(id, { satisfies = "[AC-TESTE2-1]", outputs = `\`src/${id.toLowerCase()}.mjs\` (create)`, verificacao = `echo verificacao-${id}` } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    `- **satisfies:** ${satisfies}`,
    "- **Inputs:** `README.md`",
    `- **Outputs:** ${outputs}`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    "- **Steps:** faz",
    `- **Verificação:** \`${verificacao}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

const GATE = task("T1", {
  satisfies: "[AC-TESTE2-1] (gate-de-ux)",
  outputs: `\`${APPROVAL}\` (create) · \`src/t1.mjs\` (create)`,
  verificacao: `grep -qE '^verdict: (SHIP|SHIP_WITH_DEBT)$' ${APPROVAL}`,
});

function canonico(tasks) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-10-23",
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

const approval = (verdict, rodada) =>
  ["---", `id: ciclo/${CICLO}/gate-de-ux-approval`, `verdict: ${verdict}`, ...(rodada === undefined ? [] : [`rodada: ${rodada}`]), "dois_tempos:", "  verdict_provisorio: SHIP", "---", "", "corpo", ""].join("\n");

function gitEm(dir) {
  return (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

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

/** Origin bare, árvore da maestra no plano e clone da filha, em `raiz`. */
function montar(raiz, tasks) {
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const maestra = path.join(raiz, "maestra");
  mkdirSync(maestra);
  const g = gitEm(maestra);
  g("init", "-q", "-b", "ciclo-teste");
  configurar(g);
  g("remote", "add", "origin", origin);
  escreverEm(maestra, { "README.md": "fixture\n", [CAMINHO]: canonico(tasks) });
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  // Ciclo de 2 níveis declarado: sem a marca, o núcleo roda em 3 (D10c do L4).
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 2", "-m", "Conducao-Niveis: 2");
  g("push", "-q", "origin", "ciclo-teste");
  const filha = path.join(raiz, "filha");
  execFileSync("git", ["clone", "-q", origin, filha]);
  configurar(gitEm(filha));
}

/** Os verbos da maestra e os passos da filha sobre um `raiz` já montado. */
function amarrar(raiz) {
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
  const recusa = (codigo, ...args) => {
    const r = cli(...args);
    assert.equal(r.status, 1, `${args.join(" ")} deveria recusar\n${r.linhas.join("\n")}`);
    assert.match(r.stderr, new RegExp(`^conducao: ${codigo}:`, "m"), r.stderr);
    return r;
  };
  const proximo = () => {
    const r = cli("proximo", "--entrada", "{}");
    assert.equal(r.status, 0, r.stderr);
    return r.saida;
  };
  /** O `proximo` abre a tentativa que ele mesmo emite; devolve a tarefa aberta. */
  const abrirPeloProximo = (tk, tentativa) => {
    const p = proximo();
    assert.equal(p.acao, "abrir", JSON.stringify(p));
    const x = p.tarefas.find((y) => y.task === tk);
    assert.ok(x, JSON.stringify(p));
    assert.equal(x.tentativa, tentativa, JSON.stringify(p));
    ok("abrir", tk, "--tentativa", String(tentativa), "--nonce", x.nonce, "--modo-maestra", "auto");
    return x;
  };
  /** A filha empurra a tentativa; a maestra a traz. */
  const rodada = (tk, n, arquivos) => {
    const ref = `refs/conducao/${CICLO}/${tk}/${n}`;
    f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
    f("checkout", "-q", "--detach", "refs/remotes/tentativa");
    escreverEm(filha, arquivos);
    f("add", "-A");
    f("commit", "-q", "-m", `${CICLO}-F1/${tk} — rodada ${n}`);
    f("push", "-q", "origin", `HEAD:${ref}`);
    ok("trazer", tk, "--tentativa", String(n), "--sessao", `filha-${tk}-${n}`);
  };
  const marcas = () => g("log", "--format=%s", "--grep=^Conducao: ").split("\n");
  return { g, f, maestra, filha, cli, ok, recusa, proximo, abrirPeloProximo, rodada, marcas };
}

function ambiente(t, tasks = [GATE, task("T2")]) {
  const raiz = pastaTemporaria("conducao-rodadas-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  montar(raiz, tasks);
  return amarrar(raiz);
}

const autorizar = (a) => a.ok("autorizar-ciclo", "F1", "--sim", "sim", "--pergunta", "p-00000000000000a1");

// ── carimbo (F4 do ATRM-51, T25/3 → T25/4) ─────────────────────────────────────
//
// A B da T25/3 trouxe conserto + carimbo por cherry-pick (a maestra commitou
// nota entre o `abrir` e o `trazer`): o conserto mudou de sha e o carimbo ficou
// órfão. A T25/4 refez a B só com o carimbo do sha novo; `--rodada needs-rework`
// recusava (`approval-fora-do-rito`: 2 marcas pedem `rodada: 2`, o approval segue
// em 1), e o `proximo` repetia `trazida-sem-conferencia` para sempre.

const carimbo = (sha) => `---\nsha: ${sha}\nreviewers: typescript-reviewer\nveredito: aprovado\n---\n`;
const carimboDoCiclo = (sha) => `${PASTA}/revisoes/${sha.slice(0, 8)}.md`;
const SHA_QUALQUER = "0123456789abcdef0123456789abcdef01234567";

/** A filha empurra commits arbitrários na tentativa `<n>` (cada item: arquivos a escrever, `{ rm }`, ou `{ vazio }`). */
function empurrarFilha(a, n, commits) {
  const ref = `refs/conducao/${CICLO}/T1/${n}`;
  a.f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
  a.f("checkout", "-q", "--detach", "refs/remotes/tentativa");
  const shas = [];
  for (const [i, c] of commits.entries()) {
    if (c.rm) a.f("rm", "-q", c.rm);
    else if (!c.vazio) escreverEm(a.filha, typeof c === "function" ? c(shas) : c);
    a.f("add", "-A");
    a.f("commit", "-q", ...(c.vazio ? ["--allow-empty"] : []), "-m", `${CICLO}-F1/T1 — commit ${i + 1}`);
    shas.push(a.f("rev-parse", "HEAD"));
  }
  a.f("push", "-q", "origin", `HEAD:${ref}`);
  return shas;
}

/** A maestra commita uma nota no ramo entre o abrir e o trazer ⇒ o trazer sai por cherry-pick. */
function notaDaMaestra(a) {
  escreverEm(a.maestra, { [`${PASTA}/notes/nota.md`]: `nota ${Date.now()}\n` });
  a.g("add", "-A");
  a.g("commit", "-q", "-m", "nota da maestra");
}

// ── prefixos fotografados ───────────────────────────────────────────────────
//
// Os casos partem de poucos prefixos: `aberta` (autorizar + abrir a T1/1),
// `rodadaA` (a A trazida com approval NEEDS_REWORK sem `rodada:`, que conta 1; sem registro) e
// `bRefeita` (A registrada; a B com conserto e carimbo trazida por cherry-pick,
// o carimbo órfão; registrada; a T1/3 aberta). Cada prefixo roda pelo CLI uma
// vez; cada caso recebe uma cópia (`cp -a`, e o origin religado, porque a
// config guarda o caminho absoluto).

const PREFIXOS = {
  aberta: {
    passos: (a) => {
      autorizar(a);
      a.abrirPeloProximo("T1", 1);
    },
  },
  rodadaA: {
    base: "aberta",
    passos: (a) => a.rodada("T1", 1, { [APPROVAL]: approval("NEEDS_REWORK") }),
  },
  bRefeita: {
    base: "rodadaA",
    passos: (a) => {
      a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
      a.abrirPeloProximo("T1", 2);
      const [conserto] = empurrarFilha(a, 2, [{ "src/t1.mjs": "export const conserto = 1;\n" }, ([c]) => ({ [carimboDoCiclo(c)]: carimbo(c) })]);
      notaDaMaestra(a);
      const trazido = a.ok("trazer", "T1", "--tentativa", "2", "--sessao", "filha-T1-2");
      const novo = a.g("log", "-1", "--format=%H", "HEAD", "--", "src/t1.mjs");
      a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
      a.abrirPeloProximo("T1", 3);
      return { conserto, novo, trazido };
    },
  },
};

const fotos = new Map();

function copiar(de, para) {
  execFileSync("cp", ["-a", `${de}/.`, para]);
  const origin = path.join(para, "origin.git");
  gitEm(path.join(para, "maestra"))("remote", "set-url", "origin", origin);
  gitEm(path.join(para, "filha"))("remote", "set-url", "origin", origin);
}

/** O prefixo `nome`, rodado uma vez: a base (outro prefixo, ou o plano [GATE]) e os passos por cima. */
function foto(nome) {
  if (!fotos.has(nome)) {
    const { base, passos } = PREFIXOS[nome];
    const raiz = pastaTemporaria(`conducao-rodadas-${nome}-`);
    if (base) copiar(foto(base).raiz, raiz);
    else montar(raiz, [GATE]);
    fotos.set(nome, { raiz, extra: passos(amarrar(raiz)) ?? {} });
  }
  return fotos.get(nome);
}

/** Uma cópia do prefixo `nome` para o caso; devolve o ambiente (`a`) e o que o prefixo guardou. */
function deFoto(t, nome) {
  const { raiz: de, extra } = foto(nome);
  const raiz = pastaTemporaria("conducao-rodadas-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  copiar(de, raiz);
  return { a: amarrar(raiz), ...extra };
}

// ── a ponta a ponta ──────────────────────────────────────────────────────────

test("rodada NEEDS_REWORK abre a tentativa n+1 da mesma task, sem contar falha", (t) => {
  const a = ambiente(t, [GATE]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1", "--pergunta", "p-00000000000000a1");

  // Rodada A: gate, approval NEEDS_REWORK rodada 1.
  a.abrirPeloProximo("T1", 1);
  a.rodada("T1", 1, { [APPROVAL]: approval("NEEDS_REWORK", 1) });
  // Contraprova do estado antigo: sem registro, a trazida para o laço.
  const parado = a.proximo();
  assert.equal(parado.acao, "perguntar");
  assert.equal(parado.motivo, "trazida-sem-conferencia");
  assert.equal(parado.liveUxGate, true);
  assert.equal(parado.conferenciaDoOperador, "gate-de-ux");

  const s = a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.equal(s.acao, "rodada-registrada");
  assert.equal(s.tentativa, 1);
  assert.equal(s.rodadaDoApproval, 1);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: T1 tentativa 1 rodada");
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Rodada,valueonly=true)"), "needs-rework");
  // O trabalho trazido fica: a rodada B parte do approval.
  assert.match(a.g("show", `HEAD:${APPROVAL}`), /^verdict: NEEDS_REWORK$/m);

  // Rodada B: conserto (o approval não muda) — também NEEDS_REWORK, também registrável.
  const b = a.abrirPeloProximo("T1", 2);
  assert.equal(b.falhaAnterior, undefined, "rodada não é falha: a tentativa nova não grava falha anterior");
  a.rodada("T1", 2, { "src/t1.mjs": "export const conserto = 1;\n" });
  // `nao` é o nome geral do não do operador; `needs-rework`, o mesmo no nome do gate.
  assert.equal(a.ok("registrar-conferencia", "T1", "--rodada", "nao").rodada, "nao");

  // Rodada C na 3ª tentativa: o teto de 2 falhas não alcança rodadas.
  a.abrirPeloProximo("T1", 3);
  a.rodada("T1", 3, { [APPROVAL]: approval("SHIP", 2) });
  assert.ok(!a.marcas().some((m) => /falhou$/.test(m)), a.marcas().join("\n"));

  // SHIP fecha pela conferência verde de sempre.
  a.recusa("approval-nao-pede-rodada", "registrar-conferencia", "T1", "--rodada", "needs-rework");
  const c = a.ok("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  assert.equal(c.acao, "conferida");
  assert.equal(c.tentativa, 3);
});

// ── recusas do --rodada ──────────────────────────────────────────────────────

test("verdict SHIP_WITH_DEBT recusa --rodada needs-rework e carimbo; a trazida segue pendente e fecha pela conferência verde", (t) => {
  // SHIP, o outro sim, recusa --rodada na ponta a ponta.
  const { a } = deFoto(t, "aberta");
  a.rodada("T1", 1, { [APPROVAL]: approval("SHIP_WITH_DEBT", 1), [carimboDoCiclo(SHA_QUALQUER)]: carimbo(SHA_QUALQUER) });
  a.recusa("approval-nao-pede-rodada", "registrar-conferencia", "T1", "--rodada", "needs-rework");
  a.recusa("approval-nao-pede-rodada", "registrar-conferencia", "T1", "--rodada", "carimbo");
  assert.ok(!a.marcas().some((m) => /(rodada|carimbo)$/.test(m)), a.marcas().join("\n"));
  assert.equal(a.proximo().motivo, "trazida-sem-conferencia");
  assert.equal(a.ok("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica").acao, "conferida");
});

test("task que não é conferência do operador recusa --rodada needs-rework e carimbo, mesmo com approval NEEDS_REWORK e carimbo no HEAD", (t) => {
  const a = ambiente(t, [task("T2", { outputs: `\`${APPROVAL}\` (create)` })]);
  autorizar(a);
  a.abrirPeloProximo("T2", 1);
  a.rodada("T2", 1, { [APPROVAL]: approval("NEEDS_REWORK", 1), [carimboDoCiclo(SHA_QUALQUER)]: carimbo(SHA_QUALQUER) });
  a.recusa("rodada-fora-da-conferencia", "registrar-conferencia", "T2", "--rodada", "needs-rework");
  a.recusa("rodada-fora-da-conferencia", "registrar-conferencia", "T2", "--rodada", "carimbo");
  assert.ok(!a.marcas().some((m) => /(rodada|carimbo)$/.test(m)), a.marcas().join("\n"));
  const p = a.proximo();
  assert.equal(p.motivo, "trazida-sem-conferencia");
  assert.equal(p.liveUxGate, undefined);
  assert.equal(p.conferenciaDoOperador, undefined);
});

test("approval ausente no HEAD recusa --rodada", (t) => {
  const { a } = deFoto(t, "aberta");
  a.rodada("T1", 1, { "src/t1.mjs": "export const t1 = 1;\n" });
  a.recusa("approval-ausente", "registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.ok(!a.marcas().some((m) => /rodada$/.test(m)));
});

test("approval NEEDS_REWORK: --rodada recusa valor desconhecido e mistura com flags da conferência, e a conferência verde recusa", (t) => {
  const { a } = deFoto(t, "rodadaA");
  a.recusa("uso", "registrar-conferencia", "T1", "--rodada", "ship");
  a.recusa("uso", "registrar-conferencia", "T1", "--rodada", "needs-rework", "--verificacao", "verde");
  a.recusa("uso", "registrar-conferencia", "T1", "--rodada", "needs-rework", "--motivo", "x");
  a.recusa("approval-pede-rodada", "registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  assert.ok(!a.marcas().some((m) => /(rodada|conferida)$/.test(m)), a.marcas().join("\n"));
});

// ── o número do approval: sem teto, não recua ────────────────────────────────
//
// No ATRM-54 a B saiu por re-plano (tasks novas de que o gate dependia) e o laço
// passou a aceitar esse re-plano como a B. No L4 a 2ª passada só de máquina fez o
// conserto dentro da própria tentativa e gravou o approval já na rodada seguinte;
// o laço recusou (`approval-fora-do-rito`) e pediu re-plano (D53). Sem teto e sem
// exigir a B por re-plano, approval que sobe ou repete grava; o que recua pergunta.

test("lerApproval lê verdict e rodada só do frontmatter; rodada ausente conta 1", () => {
  assert.deepEqual(lerApproval(approval("NEEDS_REWORK", 2)), { verdict: "NEEDS_REWORK", rodada: 2 });
  assert.deepEqual(lerApproval(approval("NEEDS_REWORK")), { verdict: "NEEDS_REWORK", rodada: 1 });
  assert.deepEqual(lerApproval(approval("SHIP")), { verdict: "SHIP", rodada: 1 });
  assert.ok(Number.isNaN(lerApproval(approval("NEEDS_REWORK", "dois")).rodada));
  assert.deepEqual(lerApproval("sem frontmatter\nverdict: NEEDS_REWORK\n"), { verdict: null, rodada: null });
  // `verdict_provisorio` indentado no dois_tempos não é o verdict.
  assert.equal(lerApproval("---\ndois_tempos:\n  verdict: NEEDS_REWORK\n---\n").verdict, null);
});

test("conferirRodada: sem marca grava qualquer número; repetir (a B) e subir (a C, ou a B dentro da tentativa) gravam; recuar pergunta", () => {
  const casos = [
    // [approval da vez, último registrado, rodadaMinima da pergunta | null = grava]
    [1, null, null], // a A
    [3, null, null], // a primeira já em 3: sem teto
    [1, 1, null], // a B que não regrava o approval
    [2, 1, null], // a C
    [4, 2, null], // a B feita dentro da tentativa
    [1, 2, 2], // approval velho no HEAD
    [3, 4, 4],
  ];
  for (const [rodadaDoApproval, ultimaRodadaDoApproval, minima] of casos) {
    const r = conferirRodada({ base: { task: "T1" }, rodadaDoApproval, ultimaRodadaDoApproval, ref: "refs/x" });
    const rotulo = `approval ${rodadaDoApproval} depois de ${ultimaRodadaDoApproval}`;
    if (minima === null) assert.equal(r, null, rotulo);
    else {
      assert.equal(r?.motivo, "approval-fora-do-rito", rotulo);
      assert.equal(r.rodadaMinima, minima, rotulo);
    }
  }
});

test("rito sem teto pelo CLI: approval que sobe ou repete grava, quatro marcas abrem a 5ª, e o approval que recua pergunta sem abrir rodada", (t) => {
  const { a } = deFoto(t, "rodadaA");
  const s1 = a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.equal(s1.rodadaDoApproval, 1);
  assert.equal(s1.rodadasRegistradas, 0);
  const passos = [
    // [tentativa, o que a filha traz, rodadaDoApproval, rodadasRegistradas antes]
    [2, { [APPROVAL]: approval("NEEDS_REWORK", 2) }, 2, 1], // conserto e approval novo na mesma tentativa
    [3, { "src/t1.mjs": "export const conserto = 1;\n" }, 2, 2], // passada de máquina sem approval novo: repete
    [4, { [APPROVAL]: approval("NEEDS_REWORK", 4) }, 4, 3], // sobe mais de um
  ];
  for (const [n, arquivos, rodadaDoApproval, rodadasRegistradas] of passos) {
    a.abrirPeloProximo("T1", n);
    a.rodada("T1", n, arquivos);
    const s = a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
    assert.equal(s.acao, "rodada-registrada", `tentativa ${n}`);
    assert.equal(s.rodadaDoApproval, rodadaDoApproval, `tentativa ${n}`);
    assert.equal(s.rodadasRegistradas, rodadasRegistradas, `tentativa ${n}`);
    assert.equal(s.rodadaBPorReplano, undefined, `tentativa ${n}`);
  }
  // Sem teto: a 5ª abre depois de quatro marcas; a C dela mente (approval velho).
  a.abrirPeloProximo("T1", 5);
  a.rodada("T1", 5, { [APPROVAL]: approval("NEEDS_REWORK", 3) });
  const r = a.cli("registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.equal(r.status, 1, r.linhas.join("\n"));
  assert.equal(r.saida.motivo, "approval-fora-do-rito");
  assert.equal(r.saida.rodadaMinima, 4);
  assert.equal(r.saida.rodadasRegistradas, 4);
  assert.equal(a.marcas().filter((m) => /rodada$/.test(m)).length, 4);
  assert.ok(!a.marcas().some((m) => /falhou$/.test(m)), a.marcas().join("\n"));
  assert.equal(a.proximo().motivo, "trazida-sem-conferencia");
});

// ── a rodada de carimbo ──────────────────────────────────────────────────────

test("trazer por cherry-pick avisa carimboOrfao quando o carimbo da filha cobre um sha que mudou", (t) => {
  const { conserto, novo, trazido } = deFoto(t, "bRefeita");
  assert.equal(trazido.modo, "cherry-pick");
  assert.notEqual(novo, conserto);
  assert.deepEqual(trazido.carimboOrfao, { de: conserto, para: novo, carimbo: carimboDoCiclo(conserto) });
});

test("trazer sem carimbo órfão não avisa: fast-forward com carimbo, e cherry-pick sem carimbo na ponta", (t) => {
  const { a: ff } = deFoto(t, "aberta");
  empurrarFilha(ff, 1, [{ "src/t1.mjs": "export const t1 = 1;\n" }, ([c]) => ({ [carimboDoCiclo(c)]: carimbo(c) })]);
  const sff = ff.ok("trazer", "T1", "--tentativa", "1", "--sessao", "filha");
  assert.equal(sff.modo, "fast-forward");
  assert.equal(sff.carimboOrfao, undefined);

  const { a } = deFoto(t, "aberta");
  empurrarFilha(a, 1, [{ "src/t1.mjs": "export const t1 = 1;\n" }]);
  notaDaMaestra(a);
  const s = a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "filha");
  assert.equal(s.modo, "cherry-pick");
  assert.equal(s.carimboOrfao, undefined);
});

test("cenário medido: B só de carimbo fecha por --rodada carimbo, sem consumir rodada, e a C seguinte registra", (t) => {
  const { a, novo } = deFoto(t, "bRefeita"); // A e B (carimbo órfão) registradas, T1/3 aberta

  // A filha da tentativa 3 refaz a B só com o carimbo do sha novo (fast-forward).
  a.rodada("T1", 3, { [carimboDoCiclo(novo)]: carimbo(novo) });

  // A tentativa só de carimbo fecha por --rodada carimbo (sem teto, um needs-rework aqui também gravaria).
  const s = a.ok("registrar-conferencia", "T1", "--rodada", "carimbo");
  assert.equal(s.acao, "carimbo-registrado");
  assert.equal(s.tentativa, 3);
  assert.deepEqual(s.carimbos, [carimboDoCiclo(novo)]);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: T1 tentativa 3 carimbo");
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Rodada,valueonly=true)"), "carimbo");
  // O carimbo do conserto está no HEAD: é a condição da rodada C no rito do brief.
  assert.ok(a.g("ls-tree", "-r", "--name-only", "HEAD").split("\n").includes(carimboDoCiclo(novo)));

  // O proximo abre a 4, sem falha anterior; a C (approval rodada 2) registra: a marca carimbo não conta.
  const c = a.abrirPeloProximo("T1", 4);
  assert.equal(c.falhaAnterior, undefined);
  a.rodada("T1", 4, { [APPROVAL]: approval("NEEDS_REWORK", 2) });
  const rc = a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.equal(rc.rodadasRegistradas, 2);
  assert.equal(rc.rodadaDoApproval, 2);
  assert.ok(!a.marcas().some((m) => /falhou$/.test(m)), a.marcas().join("\n"));
});

test("--rodada carimbo aceita o destino avulso (.projeto/state/revisoes/<sha8>.md)", (t) => {
  const { a, novo } = deFoto(t, "bRefeita");
  const p = `.projeto/state/revisoes/${novo.slice(0, 8)}.md`;
  const [ponta] = empurrarFilha(a, 3, [{ [p]: carimbo(novo) }]);
  // `.claude/` está no alcance dos hooks: o trazer pergunta, e Rita aprova a ponta.
  a.ok("trazer", "T1", "--tentativa", "3", "--sessao", "filha", "--aprovado", ponta);
  assert.deepEqual(a.ok("registrar-conferencia", "T1", "--rodada", "carimbo").carimbos, [p]);
});

test("--rodada carimbo recusa o que não é só carimbo do conserto, e a trazida segue pendente", (t) => {
  const SRC = "src/t1.mjs";
  const casos = [
    // [nome, commits da filha na T1/3 (sobre a B refeita) ⇒ (conserto) => commits, recusa, trecho do stderr]
    ["código além do carimbo", () => [{ [SRC]: "export const conserto = 2;\n", [carimboDoCiclo(SHA_QUALQUER)]: carimbo(SHA_QUALQUER) }], "rodada-carimbo-fora-do-carimbo", /src\/t1\.mjs/],
    ["carimbo fora dos destinos", () => [{ [`docs/reviews/${SHA_QUALQUER.slice(0, 8)}.md`]: carimbo(SHA_QUALQUER) }], "rodada-carimbo-fora-do-carimbo", /docs\/reviews\//],
    ["carimbo apagado", (conserto) => [{ rm: carimboDoCiclo(conserto) }], "rodada-carimbo-fora-do-carimbo", /^conducao: .*\bD \.agents\//m],
    ["carimbo que não cobre o conserto do HEAD", () => [{ [carimboDoCiclo(SHA_QUALQUER)]: carimbo(SHA_QUALQUER) }], "rodada-carimbo-nao-cobre-o-conserto", null],
    ["tentativa sem arquivo", () => [{ vazio: true }], "rodada-carimbo-sem-carimbo", null],
  ];
  for (const [nome, commits, codigo, trecho] of casos) {
    const { a, conserto } = deFoto(t, "bRefeita");
    empurrarFilha(a, 3, commits(conserto));
    a.ok("trazer", "T1", "--tentativa", "3", "--sessao", "filha");
    const r = a.recusa(codigo, "registrar-conferencia", "T1", "--rodada", "carimbo");
    if (trecho) assert.match(r.stderr, trecho, nome);
    assert.ok(!a.marcas().some((m) => /carimbo$/.test(m)), `${nome}\n${a.marcas().join("\n")}`);
    assert.equal(a.proximo().motivo, "trazida-sem-conferencia", nome);
  }
});
