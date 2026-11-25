/**
 * sem-ramo.test.mjs — o ciclo conduzido sem ramo de ciclo (hotfix vega-conducao-sem-ramo, 25/11/2026).
 *
 * A declaração (v7) lista o ciclo em `semRamo`: a condução acha o ciclo e as marcas no ramo
 * principal, sem `ciclo-<id>` em `refs/heads/` e sem proposta; cada marca gravada sem trazida por
 * conferir vai ao principal do origin (`levarAoPrincipal`), e a tentativa chega lá depois da
 * conferência; a task que declara `**Empurra no meio:** sim` recebe a seção que libera o push ao
 * principal; a task feita fora da condução, com o commit no subject dela já no principal, sai como
 * `reconhecer-feita` e se grava por `registrar-conferencia --fora`. O mesmo repositório sem o modo
 * segue com a regra de antes: `ramo-do-ciclo-ausente`, `arvore-sem-ramo-do-ciclo`, e a task com
 * commit prévio abre como sempre.
 *
 * Origin bare em pasta temporária, hooks desligados no repo de teste (core.hooksPath=/dev/null);
 * a declaração vai em `<repo>/.altair/adaptador.json`, a do projeto de teste com os campos por cima.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modoDoCiclo, validar } from "../adaptador.mjs";
import { ramoDoCiclo } from "../conducao.mjs";
import { pedidoDaEtapa } from "../etapa.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "fixtures", "projeto-de-teste");
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-7-reorganiza";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const DECLARACAO = JSON.parse(readFileSync(path.join(RAIZ, ".altair", "adaptador.json"), "utf8"));

function task(id, { inputs = "`README.md`", satisfies = "[AC-TESTE7-1]", extra = [] } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    `- **satisfies:** ${satisfies}`,
    `- **Inputs:** ${inputs}`,
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    "- **Estação:** servidor",
    ...extra,
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
    "opened: 2026-11-25",
    "---",
    "",
    "## 1. Goal",
    "",
    "### 1.5 Modo de Execução",
    "",
    "**Largura do ciclo:** 1",
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

const PADRAO = [task("T1"), task("T2", { inputs: "T1", satisfies: "[—] (fechamento-de-fase)" })];

function declaracao(extra) {
  const d = { ...DECLARACAO, pagina: undefined, projeto: "mentira", ...extra };
  for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  return d;
}
const COM_O_MODO = declaracao({ versao: 7, semRamo: [{ ciclo: CICLO }] });
const SEM_O_MODO = declaracao({ versao: 7 });

function gitEm(dir) {
  return (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function configurar(g) {
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g("config", k, v);
}
function escreverEm(dir, arquivos) {
  for (const [p, conteudo] of Object.entries(arquivos)) {
    mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
    writeFileSync(path.join(dir, p), conteudo);
  }
}

/** Origin bare + árvore da condutora no `main` (nenhum `ciclo-*`), com o plano e a declaração; clone da operária e de um terceiro. */
function ambiente(t, { decl = COM_O_MODO, tasks = PADRAO, antes = null } = {}) {
  const raiz = pastaTemporaria("conducao-sem-ramo-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const dir = path.join(raiz, "condutora");
  mkdirSync(dir);
  const g = gitEm(dir);
  g("init", "-q", "-b", "main");
  configurar(g);
  g("remote", "add", "origin", origin);
  escreverEm(dir, { "README.md": "fixture\n", [CAMINHO]: canonico(tasks), ".altair/adaptador.json": `${JSON.stringify(decl, null, 2)}\n` });
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 2", "-m", "Conducao-Niveis: 2");
  if (antes) antes(g, dir);
  g("push", "-q", "origin", "main");
  const clone = (nome) => {
    const d = path.join(raiz, nome);
    execFileSync("git", ["clone", "-q", origin, d]);
    const c = gitEm(d);
    configurar(c);
    return { d, c };
  };
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    const linhas = r.stdout.split("\n").filter(Boolean);
    return { status: r.status, stderr: r.stderr, saida: linhas.length === 1 ? JSON.parse(linhas[0]) : null, linhas };
  };
  const ok = (...args) => {
    const r = cli(...args);
    assert.equal(r.status, 0, `${args.join(" ")} → ${r.status}\n${r.stderr}\n${r.linhas.join("\n")}`);
    return r.saida;
  };
  const noOrigin = (ref) => {
    const linha = g("ls-remote", "origin", ref);
    return linha ? linha.split("\t")[0] : null;
  };
  const autorizar = () => ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1", "--pergunta", "p-00000000000000a1");
  const proximo = (entrada = {}) => {
    const r = cli("proximo", "--entrada", JSON.stringify(entrada));
    assert.equal(r.status, 0, r.stderr);
    return r.saida;
  };
  return { raiz, dir, g, cli, ok, noOrigin, autorizar, proximo, clone, head: () => g("rev-parse", "HEAD") };
}

// ── declaração ──────────────────────────────────────────────────────────────

test("declaração: semRamo só na v7, sem ciclo repetido, principal default main e nunca ciclo-*", () => {
  assert.deepEqual(validar(COM_O_MODO).semRamo, [{ ciclo: CICLO, principal: "main" }]);
  assert.deepEqual(validar(declaracao({ versao: 7, semRamo: [{ ciclo: CICLO, principal: "trunk" }] })).semRamo, [{ ciclo: CICLO, principal: "trunk" }]);
  assert.deepEqual(validar(SEM_O_MODO).semRamo, []);
  assert.throws(() => validar(declaracao({ versao: 6, semRamo: [{ ciclo: CICLO }] })), /semRamo: só na versao 7/);
  assert.throws(() => validar(declaracao({ versao: 7, semRamo: [{ ciclo: CICLO }, { ciclo: CICLO }] })), /repetido/);
  assert.throws(() => validar(declaracao({ versao: 7, semRamo: [{ ciclo: CICLO, principal: "ciclo-x" }] })), /principal/);
  assert.throws(() => validar(declaracao({ versao: 7, semRamo: [{ ciclo: CICLO, ramo: "main" }] })), /campo desconhecido ramo/);
});

// ── achar o ciclo ───────────────────────────────────────────────────────────

test("sem nenhum ciclo-<id>: com o modo o ramo do ciclo é o main; sem ele, ramo-do-ciclo-ausente", (t) => {
  const com = ambiente(t);
  assert.equal(modoDoCiclo(com.dir, CICLO).semRamo, true);
  assert.equal(ramoDoCiclo(com.dir, CICLO), "main");
  const sem = ambiente(t, { decl: SEM_O_MODO });
  assert.throws(() => ramoDoCiclo(sem.dir, CICLO), (e) => e.codigo === "ramo-do-ciclo-ausente");
  // Outro ciclo do mesmo projeto, fora do semRamo, segue a regra de antes.
  assert.throws(() => ramoDoCiclo(com.dir, "OUTRO-1"), (e) => e.codigo === "ramo-do-ciclo-ausente");
});

test("proximo na árvore do main, sem --repo: acha a árvore pelo main e emite a primeira ação", (t) => {
  const a = ambiente(t);
  const r = spawnSync(process.execPath, [SCRIPT, "proximo", "--ciclo", CICLO], { cwd: a.dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "autorizar-ciclo");
  a.autorizar();
  const q = a.proximo();
  assert.equal(q.acao, "abrir", JSON.stringify(q));
  assert.deepEqual(q.tarefas.map((x) => x.task), ["T1"]);
});

test("etapa: a árvore no main vale com o modo, e a etapa que empurra sobe o main sem proposta", (t) => {
  const com = ambiente(t);
  const o = pedidoDaEtapa({ repo: com.dir, ciclo: CICLO, etapa: "revisar-plano", arvore: com.dir, ramo: "main" });
  assert.equal(o.ramo, "main");
  assert.match(o.pedido, /push origin main`, sem força e sem proposta/);
  assert.doesNotMatch(o.pedido, /gh pr create/);
  assert.throws(() => pedidoDaEtapa({ repo: com.dir, ciclo: CICLO, etapa: "revisar-plano", arvore: com.dir, ramo: `ciclo-${CICLO}` }), (e) => e.codigo === "arvore-sem-ramo-do-ciclo");
  const sem = ambiente(t, { decl: SEM_O_MODO });
  assert.throws(() => pedidoDaEtapa({ repo: sem.dir, ciclo: CICLO, etapa: "revisar-plano", arvore: sem.dir, ramo: "main" }), (e) => e.codigo === "arvore-sem-ramo-do-ciclo");
});

// ── o caminho da task ───────────────────────────────────────────────────────

test("a marca sobe ao main; a tentativa trazida só chega ao main depois da conferência, com as marcas", (t) => {
  const a = ambiente(t);
  const s = a.autorizar();
  assert.equal(s.copia.principal.levado, true);
  assert.equal(a.noOrigin("refs/heads/main"), a.head(), "a autorização está no main do origin");
  const p = a.proximo();
  const item = p.tarefas[0];
  const aberta = a.ok("abrir", "T1", "--tentativa", String(item.tentativa), "--nonce", item.nonce, "--modo-maestra", "auto");
  // A operária: busca a tentativa, commita e empurra só para a referência dela.
  const { d, c } = a.clone("operaria");
  c("fetch", "-q", "origin", `+${aberta.ref}:refs/remotes/tentativa`);
  c("checkout", "-q", "--detach", "refs/remotes/tentativa");
  escreverEm(d, { "src/t1.mjs": "export const t1 = 1;\n" });
  c("add", "-A");
  c("commit", "-q", "-m", `${CICLO}-F1/T1 — tarefa T1`);
  c("push", "-q", "origin", `HEAD:${aberta.ref}`);
  const ponta = c("rev-parse", "HEAD");
  const antes = a.noOrigin("refs/heads/main");
  const tr = a.ok("trazer", "T1", "--tentativa", "1", "--sha", ponta.slice(0, 8), "--sessao", "sessao-operaria");
  assert.equal(tr.acao, "trazida", JSON.stringify(tr));
  assert.equal(a.noOrigin("refs/heads/main"), antes, "trazida por conferir não sobe ao main");
  assert.equal(tr.copia.principal.porque, "trazida-sem-conferencia");
  const conf = a.ok("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--sessao", "sessao-operaria");
  assert.equal(conf.acao, "conferida");
  assert.equal(a.noOrigin("refs/heads/main"), a.head(), "conferida, a tentativa e as marcas estão no main do origin");
  assert.equal(a.g("merge-base", "--is-ancestor", ponta, "refs/heads/main") === "", true);
  assert.equal(a.g("log", "-1", "--format=%s", "refs/heads/main"), "Conducao: T1 conferida");
  // Nenhum ciclo-* nasceu no caminho.
  assert.equal(a.g("for-each-ref", "--format=%(refname)", "refs/heads/ciclo-*"), "");
});

test("o main do origin andou: a marca seguinte mescla e sobe, sem forçar", (t) => {
  const a = ambiente(t);
  a.autorizar();
  const { d, c } = a.clone("terceiro");
  escreverEm(d, { "outro.txt": "de outra sessão\n" });
  c("add", "-A");
  c("commit", "-q", "-m", "trabalho de outra sessão");
  c("push", "-q", "origin", "main");
  const deFora = c("rev-parse", "HEAD");
  // Uma nota da condutora depois: o push dela ao main é recusado, o verbo mescla o de fora e sobe.
  a.g("commit", "-q", "--allow-empty", "-m", "nota da condutora");
  const s = a.ok("empurrar-copia");
  assert.equal(s.principal.levado, true, JSON.stringify(s));
  assert.equal(s.principal.mesclado, deFora);
  assert.equal(s.copia, a.head(), "a cópia segue o HEAD de depois da mescla");
  assert.equal(a.noOrigin("refs/heads/main"), a.head());
  assert.equal(a.g("merge-base", "--is-ancestor", deFora, "HEAD"), "");
});

test("sem o modo, a mesma árvore no main não empurra o main a cada marca", (t) => {
  const a = ambiente(t, { decl: SEM_O_MODO });
  const antes = a.noOrigin("refs/heads/main");
  const s = a.autorizar();
  assert.equal(s.copia.principal, undefined);
  assert.equal(a.noOrigin("refs/heads/main"), antes);
});

// ── task que empurra no meio ────────────────────────────────────────────────

test("task com Empurra no meio: o brief libera o push ao main; sem a anotação, não", (t) => {
  const a = ambiente(t, { tasks: [task("T1", { extra: ["- **Empurra no meio:** sim"] }), task("T2", { inputs: "T1", satisfies: "[—] (fechamento-de-fase)" })] });
  a.autorizar();
  const p = a.proximo();
  const aberta = a.ok("abrir", "T1", "--tentativa", "1", "--nonce", p.tarefas[0].nonce, "--modo-maestra", "auto");
  const brief = a.g("log", "-1", "--format=%b", aberta.brief.commit);
  assert.match(brief, /## empurrar ao principal no meio da task/);
  assert.match(brief, /git push origin HEAD:refs\/heads\/main/);
  // A operária empurra ao main no meio e à tentativa no fim: o trazer vem por avanço rápido.
  const { d, c } = a.clone("operaria");
  c("fetch", "-q", "origin", `+${aberta.ref}:refs/remotes/tentativa`);
  c("checkout", "-q", "--detach", "refs/remotes/tentativa");
  escreverEm(d, { "src/t1.mjs": "export const t1 = 1;\n" });
  c("add", "-A");
  c("commit", "-q", "-m", `${CICLO}-F1/T1 — tarefa T1`);
  c("push", "-q", "origin", "HEAD:refs/heads/main");
  c("push", "-q", "origin", `HEAD:${aberta.ref}`);
  const ponta = c("rev-parse", "HEAD");
  const tr = a.ok("trazer", "T1", "--tentativa", "1", "--sha", ponta.slice(0, 8), "--sessao", "s");
  assert.equal(tr.modo, "fast-forward");
  a.ok("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--sessao", "s");
  assert.equal(a.noOrigin("refs/heads/main"), a.head());
  const sem = ambiente(t);
  sem.autorizar();
  const q = sem.proximo();
  const outra = sem.ok("abrir", "T1", "--tentativa", "1", "--nonce", q.tarefas[0].nonce, "--modo-maestra", "auto");
  assert.doesNotMatch(sem.g("log", "-1", "--format=%b", outra.brief.commit), /empurrar ao principal no meio/);
});

// ── task feita fora da condução ─────────────────────────────────────────────

const feitaAntes = (g, dir) => {
  escreverEm(dir, { "src/t1.mjs": "export const t1 = 1;\n" });
  g("add", "-A");
  g("commit", "-q", "-m", `${CICLO}-F1/T1 — tarefa T1`);
};

test("task com commit prévio no main sai como feita: reconhecer-feita e registrar-conferencia --fora", (t) => {
  const a = ambiente(t, { antes: feitaAntes });
  const commit = a.g("log", "-1", "--format=%H", "--grep", `^${CICLO}-F1/T1 — `);
  a.autorizar();
  const p = a.proximo();
  assert.equal(p.acao, "reconhecer-feita", JSON.stringify(p));
  assert.equal(p.task, "T1");
  assert.equal(p.sha, commit);
  assert.equal(p.verificacao, "rodar");
  assert.deepEqual(p.passos[0], "conferir T1");
  const c = a.ok("registrar-conferencia", "T1", "--fora", commit, "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--sessao", "condutora");
  assert.equal(c.acao, "conferida");
  assert.equal(c.fora, commit);
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Fora,valueonly)"), commit);
  assert.equal(a.noOrigin("refs/heads/main"), a.head());
  const q = a.proximo();
  assert.notEqual(q.acao, "reconhecer-feita");
  assert.equal(q.task ?? q.tarefas?.[0]?.task, "T2", JSON.stringify(q));
});

test("feita fora com Verificação vence: sai vencida e grava sem rodar; a vencida fora da anotação recusa", (t) => {
  const tasks = [task("T1", { extra: ["- **Verificação vence:** sim"] }), task("T2", { inputs: "T1", satisfies: "[—] (fechamento-de-fase)" })];
  const a = ambiente(t, { tasks, antes: feitaAntes });
  a.autorizar();
  const p = a.proximo();
  assert.equal(p.acao, "reconhecer-feita");
  assert.equal(p.verificacao, "vencida");
  assert.equal(p.passos.length, 1);
  a.ok("registrar-conferencia", "T1", "--fora", p.sha, "--verificacao", "vencida", "--publicacao", "nao-se-aplica");
  const b = ambiente(t, { antes: feitaAntes });
  b.autorizar();
  const q = b.proximo();
  const r = b.cli("registrar-conferencia", "T1", "--fora", q.sha, "--verificacao", "vencida", "--publicacao", "nao-se-aplica");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /verificacao-diverge-do-plano/);
});

test("--fora recusa commit de outra task, fora do HEAD e ciclo sem o modo", (t) => {
  const a = ambiente(t, { antes: feitaAntes });
  a.autorizar();
  const plano = a.g("log", "--format=%H", "--grep", "^plano$");
  const r = a.cli("registrar-conferencia", "T1", "--fora", plano, "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /fora-subject-de-outra/);
  const sem = ambiente(t, { decl: SEM_O_MODO, antes: feitaAntes });
  sem.autorizar();
  const commit = sem.g("log", "-1", "--format=%H", "--grep", `^${CICLO}-F1/T1 — `);
  const s = sem.cli("registrar-conferencia", "T1", "--fora", commit, "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  assert.equal(s.status, 1);
  assert.match(s.stderr, /fora-sem-modo/);
  // Sem o modo o commit prévio não é prova de feita (§2.2#24): a task abre como sempre.
  const p = sem.proximo();
  assert.equal(p.acao, "abrir", JSON.stringify(p));
  assert.deepEqual(p.tarefas.map((x) => x.task), ["T1"]);
});

// ── fechamento ──────────────────────────────────────────────────────────────

test("fechamento sem proposta nem CI: com as tasks feitas e o main no origin, o ciclo fecha sem esperar run", (t) => {
  const a = ambiente(t, {
    antes: (g, dir) => {
      feitaAntes(g, dir);
      escreverEm(dir, { "src/t2.mjs": "export const t2 = 2;\n" });
      g("add", "-A");
      g("commit", "-q", "-m", `${CICLO}-F1/T2 — tarefa T2`);
    },
  });
  a.autorizar();
  for (const tk of ["T1", "T2"]) {
    const p = a.proximo();
    assert.equal(p.acao, "reconhecer-feita", JSON.stringify(p));
    assert.equal(p.task, tk);
    a.ok("registrar-conferencia", tk, "--fora", p.sha, "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  }
  assert.equal(a.noOrigin("refs/heads/main"), a.head());
  const f = a.proximo({ sessaoMaestra: "session_condutora" });
  assert.equal(f.acao, "fechar-ciclo", JSON.stringify(f));
  assert.notEqual(f.motivo, "ci-pendente");
});

// ── o formato público de plano (adaptador embutido superpowers) ────────────

test("superpowers: Empurra no meio e Verificação vence se leem da anotação; valor fora de sim pergunta", async () => {
  const { default: SUPERPOWERS } = await import("../adaptadores/superpowers.mjs");
  const { validarCodigo } = await import("../adaptador.mjs");
  const { lerPlano } = await import("../ler-plano.mjs");
  const CODIGO = validarCodigo(SUPERPOWERS, "superpowers");
  const exemplo = readFileSync(path.join(AQUI, "fixtures", "exemplo-superpowers.md"), "utf8");
  const anotado = exemplo.replace(/(### Tarefa 1:[^\n]*\n\n)/, "$1**Empurra no meio:** sim\n**Verificação vence:** sim\n");
  assert.notEqual(anotado, exemplo, "a fixture tem a Tarefa 1");
  const plano = lerPlano(anotado, CODIGO);
  assert.equal(plano.porId.get("T1").empurraNoMeio, true);
  assert.equal(plano.porId.get("T1").verificacaoVence, true);
  assert.equal(plano.porId.get("T2").empurraNoMeio, false);
  const torto = lerPlano(exemplo.replace(/(### Tarefa 1:[^\n]*\n\n)/, "$1**Empurra no meio:** talvez\n"), CODIGO);
  assert.ok(torto.invalidas.some((d) => d.campo === "Empurra no meio"), JSON.stringify(torto.invalidas));
});

// ── escopo das marcas no principal (achado bloqueante da revisão) ───────────

test("as marcas do ciclo sem ramo levam o id do ciclo, e outro ciclo no mesmo main não as lê", async (t) => {
  const { lerMarcas } = await import("../marcas.mjs");
  const a = ambiente(t, { antes: feitaAntes });
  a.autorizar();
  const p = a.proximo();
  a.ok("registrar-conferencia", "T1", "--fora", p.sha, "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Ciclo-Id,valueonly)"), CICLO);
  assert.equal(a.g("log", "-2", "--format=%(trailers:key=Conducao-Ciclo-Id,valueonly)", "--grep=^Conducao: F1 autorizada").trim(), CICLO);
  // Lidas pelo ciclo: as dele; por outro: nenhuma das dele; sem ciclo pedido: a leitura de antes.
  assert.ok(lerMarcas(a.dir, "HEAD", CICLO).some((m) => m.tipo === "conferida" && m.task === "T1"));
  assert.deepEqual(lerMarcas(a.dir, "HEAD", "OUTRO-2").filter((m) => m.tipo === "conferida" || m.tipo === "autorizada"), []);
  // Um ciclo com ramo nascido deste main: a T1 dele não sai feita pela marca do outro.
  a.g("switch", "-q", "-c", "ciclo-OUTRO-2");
  const r = spawnSync(process.execPath, [SCRIPT, "proximo", "--repo", a.dir, "--ciclo", "OUTRO-2"], { encoding: "utf8" });
  assert.doesNotMatch(r.stdout, /"acao":"reconhecer-feita"/);
});

test("main recusado no origin: a cópia sobe assim mesmo e o operador recebe o aviso", (t) => {
  const a = ambiente(t);
  const hook = path.join(a.raiz, "origin.git", "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\nwhile read velho novo ref; do [ \"$ref\" = refs/heads/main ] && { echo main protegido >&2; exit 1; }; done; exit 0\n", { mode: 0o755 });
  const s = a.autorizar();
  assert.equal(s.acao, "autorizada", JSON.stringify(s));
  assert.equal(a.noOrigin(`refs/conducao/${CICLO}/copia`), a.head(), "a cópia subiu");
  assert.equal(s.copia.principal.levado, false);
  assert.equal(s.copia.principal.porque, "principal-push-recusado");
  assert.ok(s.avisoOperador?.some((l) => /o principal não subiu/.test(l)), JSON.stringify(s.avisoOperador));
});

test("feita fora só depois do plano: commit com o subject anterior a ele não é prova", (t) => {
  const duasFases = [
    task("T1"),
    task("T2", { inputs: "T1", satisfies: "[—] (fechamento-de-fase)" }),
  ];
  // Commit com o subject da T1 ANTES do plano: não é prova.
  const a = ambiente(t, {
    tasks: duasFases,
    antes: (g, dir) => {
      const plano = readFileSync(path.join(dir, CAMINHO), "utf8");
      g("rm", "-q", "--cached", CAMINHO);
      g("commit", "-q", "-m", "tira o plano");
      g("commit", "-q", "--allow-empty", "-m", `${CICLO}-F1/T1 — tarefa T1`);
      writeFileSync(path.join(dir, CAMINHO), plano);
      g("add", "-A");
      g("commit", "-q", "-m", "plano de novo");
    },
  });
  a.autorizar();
  const p = a.proximo();
  assert.equal(p.acao, "abrir", JSON.stringify(p));
  const velho = a.g("log", "-1", "--format=%H", "--grep", `^${CICLO}-F1/T1 — `);
  const r = a.cli("registrar-conferencia", "T1", "--fora", velho, "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /fora-antes-do-plano/);
});

test("plano editado depois do commit da task: o commit não prova mais a task (re-plano que renumera)", (t) => {
  const a = ambiente(t, {
    antes: (g, dir) => {
      feitaAntes(g, dir);
      writeFileSync(path.join(dir, CAMINHO), `${readFileSync(path.join(dir, CAMINHO), "utf8")}\nre-plano depois da task\n`);
      g("add", "-A");
      g("commit", "-q", "-m", "re-plano");
    },
  });
  a.autorizar();
  const p = a.proximo();
  assert.equal(p.acao, "abrir", JSON.stringify(p));
});

test("deOutroCiclo: só o trailer de outro ciclo descarta; sem trailer ou sem ciclo pedido, a marca vale", async () => {
  const { deOutroCiclo } = await import("../git-conducao.mjs");
  assert.equal(deOutroCiclo("Conducao-Task: T1\nConducao-Ciclo-Id: OUTRO-1", CICLO), true);
  assert.equal(deOutroCiclo(`Conducao-Ciclo-Id: ${CICLO}`, CICLO), false);
  assert.equal(deOutroCiclo("Conducao-Task: T1", CICLO), false);
  assert.equal(deOutroCiclo("Conducao-Ciclo-Id: OUTRO-1", null), false);
});
