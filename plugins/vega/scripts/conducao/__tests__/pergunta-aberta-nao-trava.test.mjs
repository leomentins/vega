/**
 * pergunta-aberta-nao-trava.test.mjs — a pergunta aberta ao operador numa task não para as
 * outras (hotfix conducao-pergunta-aberta-nao-trava, D37 "a+c" do operador no LABS-23, 28/11/2026).
 *
 * Medido no LABS-23 na madrugada de 28/11: a T45 (conferência do operador) estava trazida e
 * esperava a resposta da D35; a T37, sem relação com ela, avisou OK às 04:18 UTC e ficou cinco
 * horas sem ser trazida, porque o `proximo` só repetia a conferência da T45 — e as seis tasks que
 * dependem da T37 não abriram.
 *
 * O conserto: a condutora põe na entrada (`perguntasAbertas`) a pergunta que já levou ao operador
 * (`task`, `tentativa`, `motivo`, `abertaEm`). Enquanto ela está aberta, a task dela fica parada
 * — nada dela é aplicado, a vaga e os Outputs dela seguem ocupados, e quem depende dela não
 * abre —, e o `proximo` segue com as outras: trazer, conferir, abrir, na ordem de sempre. Sem
 * outra coisa a fazer, volta a mesma pergunta. O tempo de pergunta aberta não conta no prazo da
 * tentativa (achado da condutora do LABS-23: a T44, parada só pela D36, saiu `prazo-vencido`).
 *
 * Contraprova: sem o conserto, a entrada com `perguntasAbertas` é recusada (`entrada-invalida`,
 * campo desconhecido), e sem o campo o `proximo` repete a conferência da T1 para sempre.
 *
 * Mesmo arranjo de conferencia-operador.test.mjs: origin bare, árvore da condutora, clone da
 * filha, hooks desligados, verbos chamados como CLI, projeto de teste das suítes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";
import { comPerguntasAbertas, decidir } from "../conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-9-pergunta-aberta";
const PASTA = `.agents/ciclo/teste/${CICLO}`;
const CAMINHO = `${PASTA}/canonico.md`;

function task(id, { satisfies = "[AC-TESTE9-1]", inputs = "`README.md`", independente = true, outputs = `src/${id.toLowerCase()}.mjs` } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    `- **satisfies:** ${satisfies}`,
    `- **Inputs:** ${inputs}`,
    `- **Outputs:** \`${outputs}\` (create)`,
    "- **Estação:** servidor",
    ...(independente ? ["- **Independente:** sim"] : []),
    "- **Steps:** faz",
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

/**
 * T1 só o operador confere; T2 é independente dela; T3 depende da T2 e T4 depende da T1; T5 é
 * independente, mas escreve o mesmo arquivo da T1. Largura 2: T1 e T2 abrem juntas.
 */
const PLANO = [
  task("T1", { satisfies: "[AC-TESTE9-1] (conferencia-do-operador)" }),
  task("T2"),
  task("T3", { inputs: "`README.md` · saída da T2", independente: false }),
  task("T4", { inputs: "`README.md` · saída da T1", independente: false }),
  task("T5", { outputs: "src/t1.mjs" }),
];

function canonico(tasks) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-11-28",
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
    ...tasks,
    "## 4. Pronto",
    "",
  ].join("\n");
}

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

function ambiente(t) {
  const raiz = pastaTemporaria("conducao-pergunta-aberta-");
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const maestra = path.join(raiz, "maestra");
  mkdirSync(maestra);
  const g = gitEm(maestra);
  g("init", "-q", "-b", "ciclo-teste");
  configurar(g);
  g("remote", "add", "origin", origin);
  escreverEm(maestra, { "README.md": "fixture\n", [CAMINHO]: canonico(PLANO) });
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 2", "-m", "Conducao-Niveis: 2");
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
  const proximo = (entrada = {}) => ok("proximo", "--entrada", JSON.stringify(entrada));
  /** A filha faz o trabalho e empurra a referência da tentativa; devolve o sha8 avisado. */
  const trabalho = (tk, n) => {
    const ref = `refs/conducao/${CICLO}/${tk}/${n}`;
    f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
    f("checkout", "-q", "--detach", "refs/remotes/tentativa");
    escreverEm(filha, { [`src/${tk.toLowerCase()}.mjs`]: `export const ${tk.toLowerCase()} = ${n};\n` });
    f("add", "-A");
    f("commit", "-q", "-m", `${CICLO}-F1/${tk} — trabalho ${n}`);
    f("push", "-q", "origin", `HEAD:${ref}`);
    return f("rev-parse", "--short=8", "HEAD");
  };
  return { g, ok, cli, proximo, trabalho };
}

const CONFERENCIA_T1 = { task: "T1", tentativa: 1, motivo: "conferencia-do-operador", abertaEm: "2026-11-28T04:00:00Z" };

test("conferência do operador aberta na T1: a T2 independente é trazida e conferida, a T3 abre, a T4 (dependente da T1) espera", (t) => {
  const a = ambiente(t);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1", "--pergunta", "p-00000000000000a9");

  const abre = a.proximo();
  assert.equal(abre.acao, "abrir", JSON.stringify(abre));
  assert.deepEqual(abre.tarefas.map((x) => x.task), ["T1", "T2"]);
  const [t1, t2] = abre.tarefas;
  for (const x of abre.tarefas) a.ok("abrir", x.task, "--tentativa", "1", "--nonce", x.nonce, "--modo-maestra", "auto");

  // T1: a parte da máquina chega e é trazida; o resultado é do operador.
  a.trabalho("T1", 1);
  a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "filha-T1");
  // T2: a filha avisa OK logo depois.
  const sha2 = a.trabalho("T2", 1);
  const filhas = [
    { sessao: "filha-T1", task: "T1", tentativa: 1, nonce: t1.nonce, estado: "IDLE", aviso: `T1-OK deadbeef ${t1.nonce}` },
    { sessao: "filha-T2", task: "T2", tentativa: 1, nonce: t2.nonce, estado: "IDLE", aviso: `T2-OK ${sha2} ${t2.nonce}` },
  ];

  // Antes de a pergunta estar com o operador: a ordem de sempre, a conferência da T1 primeiro.
  const pergunta = a.proximo({ filhas });
  assert.equal(pergunta.acao, "perguntar", JSON.stringify(pergunta));
  assert.equal(pergunta.motivo, "conferencia-do-operador");
  assert.equal(pergunta.task, "T1");

  // A condutora levou a pergunta ao operador: a T2 é trazida, sem esperar a resposta.
  const traz = a.proximo({ filhas, perguntasAbertas: [CONFERENCIA_T1] });
  assert.equal(traz.acao, "trazer", JSON.stringify(traz));
  assert.equal(traz.task, "T2");
  assert.deepEqual(traz.perguntasAbertas, [{ task: "T1", tentativa: 1, motivo: "conferencia-do-operador" }]);
  a.ok("trazer", "T2", "--tentativa", "1", "--sha", sha2, "--sessao", "filha-T2");
  a.ok("registrar-conferencia", "T2", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--sessao", "filha-T2");

  // A filha da T2 conferida é arquivada (a rede de arquivamento vem antes de tudo, como sempre).
  const arquiva = a.proximo({ filhas, perguntasAbertas: [CONFERENCIA_T1] });
  assert.equal(arquiva.acao, "arquivar", JSON.stringify(arquiva));
  assert.equal(arquiva.sessao, "filha-T2");
  filhas[1] = { ...filhas[1], estado: "ARCHIVED", arquivamentos: [arquiva.nonce] };

  // A T3 (dependente da T2) abre; a T4 (dependente da T1) não, nem a T5: a T1 trazida já saiu do
  // voo, mas o trabalho dela espera o operador, e um não o tira — o arquivo dela segue ocupado.
  const abreT3 = a.proximo({ filhas, perguntasAbertas: [CONFERENCIA_T1] });
  assert.equal(abreT3.acao, "abrir", JSON.stringify(abreT3));
  assert.deepEqual(abreT3.tarefas.map((x) => x.task), ["T3"]);
  a.ok("abrir", "T3", "--tentativa", "1", "--nonce", abreT3.tarefas[0].nonce, "--modo-maestra", "auto");

  // Nada da T1 foi aplicado: nenhuma conferência dela, nem trazer de novo.
  const marcas = a.g("log", "--format=%s", "--grep=^Conducao: ");
  assert.doesNotMatch(marcas, /T1 conferida/);
  // A T1 segue trazida, esperando a resposta: o registro da trazida não foi tocado.
  assert.equal(a.g("for-each-ref", "--format=%(refname)", `refs/conducao-local/${CICLO}/trazida/T1/`), `refs/conducao-local/${CICLO}/trazida/T1/1`);

  // Com a T3 em voo e nada mais a fazer, espera — lembrando a pergunta aberta.
  const filhasT3 = [...filhas, { sessao: "filha-T3", task: "T3", tentativa: 1, nonce: abreT3.tarefas[0].nonce, estado: "RUNNING" }];
  const espera = a.proximo({ filhas: filhasT3, perguntasAbertas: [CONFERENCIA_T1], agora: "2026-11-28T04:30:00Z" });
  assert.equal(espera.acao, "esperar", JSON.stringify(espera));
  assert.deepEqual(espera.emVoo, ["T3"]);
  assert.deepEqual(espera.perguntasAbertas, [{ task: "T1", tentativa: 1, motivo: "conferencia-do-operador" }]);
  assert.equal(espera.perguntasSemEco, undefined);
  // Item que as regras não perguntam (a T2 já foi conferida): lista velha, apontada, sem congelar nada.
  const velha = { task: "T2", tentativa: 1, motivo: "conferencia-do-operador", abertaEm: "2026-11-28T04:10:00Z" };
  const comVelha = a.proximo({ filhas: filhasT3, perguntasAbertas: [CONFERENCIA_T1, velha], agora: "2026-11-28T04:30:00Z" });
  assert.equal(comVelha.acao, "esperar", JSON.stringify(comVelha));
  assert.deepEqual(comVelha.perguntasSemEco, [{ task: "T2", tentativa: 1, motivo: "conferencia-do-operador" }]);

  // Sem a pergunta na entrada (o operador respondeu, ou ela nunca foi levada), a conferência da T1 volta.
  const volta = a.proximo({ filhas: filhasT3 });
  assert.equal(volta.motivo, "conferencia-do-operador");
  assert.equal(volta.task, "T1");

  // O sim do operador pela conferência fecha a T1, e a T4 abre.
  a.ok("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--operador", "abriu e funcionou");
  const arquivaT1 = a.proximo({ filhas: filhasT3 });
  assert.equal(arquivaT1.acao, "arquivar", JSON.stringify(arquivaT1));
  filhasT3[0] = { ...filhasT3[0], estado: "ARCHIVED", arquivamentos: [arquivaT1.nonce] };
  const abreT4 = a.proximo({ filhas: filhasT3 });
  assert.equal(abreT4.acao, "abrir", JSON.stringify(abreT4));
  assert.deepEqual(abreT4.tarefas.map((x) => x.task), ["T4"]);
});

test("só a task da pergunta aberta resta: a mesma pergunta volta, nunca `esperar` nem `sem-saida`", (t) => {
  const a = ambiente(t);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim", "--pergunta", "p-00000000000000a9");
  const abre = a.proximo();
  const [t1] = abre.tarefas;
  a.ok("abrir", "T1", "--tentativa", "1", "--nonce", t1.nonce, "--modo-maestra", "auto");
  a.trabalho("T1", 1);
  a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "filha-T1");
  const filhas = [{ sessao: "filha-T1", task: "T1", tentativa: 1, nonce: t1.nonce, estado: "IDLE", aviso: `T1-OK deadbeef ${t1.nonce}` }];
  // Ponte sem vaga: nada além da T1 parada ⇒ a conferência dela volta (com o lembrete), não `esperar`.
  const pergunta = a.proximo({ filhas, perguntasAbertas: [CONFERENCIA_T1], tetoPonte: 0 });
  assert.equal(pergunta.acao, "perguntar", JSON.stringify(pergunta));
  assert.equal(pergunta.motivo, "conferencia-do-operador");
  assert.equal(pergunta.task, "T1");
  assert.equal(pergunta.nonce, a.proximo({ filhas, tetoPonte: 0 }).nonce, "a mesma pergunta, com o mesmo nonce");
  // A T2 abre (independente); a pergunta da T1 não a segura.
  const abreT2 = a.proximo({ filhas, perguntasAbertas: [CONFERENCIA_T1] });
  assert.equal(abreT2.acao, "abrir", JSON.stringify(abreT2));
  assert.deepEqual(abreT2.tarefas.map((x) => x.task), ["T2"]);
  // Pergunta de outra tentativa não congela a de agora.
  const outra = a.proximo({ filhas, perguntasAbertas: [{ ...CONFERENCIA_T1, tentativa: 2 }] });
  assert.equal(outra.motivo, "conferencia-do-operador");
});

test("entrada: `perguntasAbertas` com forma errada para (`entrada-invalida`)", (t) => {
  const a = ambiente(t);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim", "--pergunta", "p-00000000000000a9");
  const certa = { task: "T1", tentativa: 1, motivo: "conferencia-do-operador", abertaEm: "2026-11-28T04:00:00Z" };
  const sem = (k) => Object.fromEntries(Object.entries(certa).filter(([c]) => c !== k));
  for (const ruim of [
    { perguntasAbertas: "T1" },
    ...["task", "tentativa", "motivo", "abertaEm"].map((k) => ({ perguntasAbertas: [sem(k)] })),
    { perguntasAbertas: [{ ...certa, motivo: "conferencia-operador" }] },
    { perguntasAbertas: [{ ...certa, motivo: "prazo-vencido" }] },
    { perguntasAbertas: [{ ...certa, abertaEm: "ontem" }] },
    { perguntasAbertas: [{ ...certa, respondidaEm: "2026-11-28T03:00:00Z" }] },
  ]) {
    const p = a.proximo(ruim);
    assert.equal(p.motivo, "entrada-invalida", JSON.stringify(p));
  }
  // A `task-sensivel` da estação condutora sai com tentativa 0: vale.
  assert.notEqual(a.proximo({ perguntasAbertas: [{ ...certa, tentativa: 0, motivo: "task-sensivel" }] }).motivo, "entrada-invalida");
});

// ── prazo da tentativa (achado da condutora do LABS-23, T44/D36) ─────────────────────

/** O `decidir` puro sobre um plano de uma task com a T1 em voo há 3 h (prazo 120 min). */
function emVooHaTresHoras(perguntasAbertas, aviso = undefined) {
  const t1 = { id: "T1", fase: "F1", deps: [], outputs: ["src/t1.mjs"], estacao: "servidor", prazoMin: 120, publicacao: [], protegida: [], classe: "comum" };
  const plano = { fases: [{ id: "F1", tasks: ["T1"], modelo: "sonnet" }], porId: new Map([["T1", t1]]), largura: 1 };
  const abertaEm = Date.parse("2026-11-28T01:00:00Z") / 1000;
  return decidir({
    ciclo: CICLO,
    head: "a".repeat(40),
    plano,
    planoBlob: "b".repeat(40),
    autorizacoes: [{ fase: "F1", sha: "c".repeat(40) }],
    estado: {
      feitas: new Set(),
      recusadas: new Set(),
      emVoo: new Map([["T1", { task: "T1", tentativa: 1, nonce: "n1", ref: "refs/conducao/x/T1/1", abertaEm }]]),
      falhas: new Map(),
      falhasAmbiente: new Map(),
      maxTent: new Map([["T1", 1]]),
      trazidas: new Map(),
      decididos: new Set(),
    },
    entrada: { filhas: [{ sessao: "s1", task: "T1", tentativa: 1, nonce: "n1", estado: "RUNNING", ...(aviso ? { aviso } : {}) }], perguntasAbertas },
    agora: Date.parse("2026-11-28T04:00:00Z") / 1000,
  });
}

test("prazo: o tempo de pergunta aberta (ou já respondida) da tentativa não conta", () => {
  // Sem pergunta: 180 min > 120 ⇒ prazo-vencido.
  assert.equal(emVooHaTresHoras(undefined).motivo, "prazo-vencido");
  // A pergunta da filha ficou 90 min com o operador e já foi respondida: 180 − 90 = 90 < 120 ⇒ espera.
  const respondida = [{ task: "T1", tentativa: 1, motivo: "pergunta-da-filha", abertaEm: "2026-11-28T01:30:00Z", respondidaEm: "2026-11-28T03:00:00Z" }];
  const r = emVooHaTresHoras(respondida);
  assert.equal(r.acao, "esperar", JSON.stringify(r));
  // Respondida não congela a task: o `perguntasAbertas` da saída não a lista.
  assert.equal(r.perguntasAbertas, undefined);
  // Pergunta da filha ainda aberta e ainda perguntada: a task fica parada, a vigia não a olha.
  const aberta = [{ task: "T1", tentativa: 1, motivo: "pergunta-da-filha", abertaEm: "2026-11-28T01:10:00Z" }];
  const parada = emVooHaTresHoras(aberta, "T1-FALHA pergunta n1");
  assert.equal(parada.motivo, "pergunta-da-filha", JSON.stringify(parada));
  assert.deepEqual(parada.perguntasAbertas, [{ task: "T1", tentativa: 1, motivo: "pergunta-da-filha" }]);
  // Aberta na lista, mas a filha não pergunta mais (resposta dada sem `respondidaEm`): não cala o
  // prazo para sempre — vence, e a lista velha é apontada.
  const esquecida = emVooHaTresHoras(aberta);
  assert.equal(esquecida.motivo, "prazo-vencido", JSON.stringify(esquecida));
  assert.deepEqual(esquecida.perguntasSemEco, [{ task: "T1", tentativa: 1, motivo: "pergunta-da-filha" }]);
  // Pausa de outra tentativa não desconta desta.
  assert.equal(emVooHaTresHoras([{ ...respondida[0], tentativa: 2 }]).motivo, "prazo-vencido");
});

test("task-sensivel: um item por task listada congela todas, sem lista velha, e casa fora da primeira posição", () => {
  // As regras de mentira: a pergunta lista T2 e T1 (a T2 veio para a frente); com as duas paradas, só esperar.
  const regras = (emEspera) =>
    emEspera.has("T1") && emEspera.has("T2")
      ? { acao: "esperar", motivo: "filhas-em-voo", emVoo: [] }
      : { acao: "perguntar", motivo: "task-sensivel", task: "T2", tentativa: 1, tasks: [{ task: "T2" }, { task: "T1" }] };
  const item = (task) => ({ task, tentativa: 1, motivo: "task-sensivel", abertaEm: "2026-11-28T04:00:00Z" });
  const d = comPerguntasAbertas(regras, [item("T1"), item("T2")]);
  assert.equal(d.motivo, "task-sensivel");
  assert.deepEqual(d.perguntasAbertas.map((p) => p.task).sort(), ["T1", "T2"]);
  assert.equal(d.perguntasSemEco, undefined);
  // Um item só, gravado com a task que era a primeira quando a pergunta saiu: ainda casa.
  const so = comPerguntasAbertas(regras, [item("T1")]);
  assert.deepEqual(so.perguntasAbertas, [{ task: "T1", tentativa: 1, motivo: "task-sensivel" }]);
});
