// adaptador-superpowers.test.mjs — o adaptador embutido do formato público (VEGA-29 T21).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validarCodigo } from "../adaptador.mjs";
import SUPERPOWERS, { A_PERGUNTAR, MARCA_PUBLICACAO, MARCA_SENSIVEL, lerPlanoPublico } from "../adaptadores/superpowers.mjs";
import { ErroPlano, lerPlano, lerPlanoNoCommit } from "../ler-plano.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ADAPTADOR = path.resolve(AQUI, "..", "adaptadores", "superpowers.mjs");
const EXEMPLO = readFileSync(path.join(AQUI, "fixtures", "exemplo-superpowers.md"), "utf8");
const CODIGO = validarCodigo(SUPERPOWERS, "superpowers");

const tmps = [];
function tmp(prefixo) {
  const d = mkdtempSync(path.join(tmpdir(), prefixo));
  tmps.push(d);
  return d;
}
after(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** O exemplo com a linha `**<campo>:** …` da tarefa `n` trocada por `nova` (`null` apaga). */
function semAnotacao(n, campo, nova = null) {
  const L = EXEMPLO.split("\n");
  const ini = L.findIndex((l) => l.startsWith(`### Tarefa ${n}:`));
  const i = L.findIndex((l, k) => k > ini && l.startsWith(`**${campo}:**`));
  assert.ok(ini >= 0 && i > ini, `fixture sem ${campo} na tarefa ${n}`);
  if (nova === null) L.splice(i, 1);
  else L[i] = nova;
  return L.join("\n");
}

describe("o plano de exemplo", () => {
  const lido = lerPlanoPublico(EXEMPLO);

  test("a forma do código passa no validarCodigo do núcleo", () => {
    assert.equal(CODIGO.plano.raiz, "docs");
    assert.equal(CODIGO.carimbo, null);
    assert.equal(CODIGO.ci, null);
  });

  test("devolve as anotações de cada tarefa, e o bloco de código não vira tarefa nem anotação", () => {
    assert.deepEqual(lido.tasks.map((t) => t.id), ["T1", "T2", "T3", "T4", "T5"]);
    assert.deepEqual(Object.fromEntries(lido.declaracoes.anotacoes), {
      T1: { estacao: "servidor", publicacao: false, sensivel: false },
      T2: { estacao: "servidor", publicacao: false, sensivel: true },
      T3: { estacao: "workstation", publicacao: true, sensivel: false },
      T4: { estacao: "servidor", publicacao: false, sensivel: false },
      T5: { estacao: "servidor", publicacao: false, sensivel: false },
    });
    assert.deepEqual(lido.declaracoes.invalidas, []);
    assert.deepEqual(lido.declaracoes.aPerguntar, []);
    assert.deepEqual(lido.fases, [{ id: "F2", model: null, tier: null }]);
    assert.equal(lido.declaracoes.largura, 1);
  });

  test("o núcleo lê o plano pelo código: classe, Outputs, Verificação, marcas e prazo", () => {
    const plano = lerPlano(EXEMPLO, CODIGO);
    const t = (id) => plano.porId.get(id);
    assert.deepEqual(plano.tasks.map((x) => [x.id, x.classe]), [
      ["T1", "comum"],
      ["T2", "sensivel"],
      ["T3", "workstation"],
      ["T4", "comum"],
      ["T5", "fechamento"],
    ]);
    // A faixa de linhas do `Modificar:` sai do caminho.
    assert.deepEqual(t("T1").outputs, ["src/lembretes.ts", "src/app.ts", "tests/lembretes.test.ts"]);
    assert.deepEqual(t("T2").protegida, [MARCA_SENSIVEL]);
    assert.deepEqual(t("T3").publicacao, [MARCA_PUBLICACAO]);
    assert.equal(t("T1").verificacao, "npm test");
    assert.equal(t("T2").verificacao, "npm test && npm run typecheck");
    assert.deepEqual(t("T4").marcas, ["conferencia-do-operador"]);
    assert.equal(t("T2").independente, true);
    assert.deepEqual(t("T2").deps, []);
    assert.deepEqual(t("T3").deps, ["T2"]);
    assert.equal(t("T2").prazoMin, 45);
    assert.deepEqual(plano.fases, [{ id: "F2", modelo: null, tier: "inherit", tasks: ["T1", "T2", "T3", "T4", "T5"] }]);
  });

  test("nada é adivinhado do texto: `db push`, `vercel --prod` e a Rita na prosa não mudam a tarefa", () => {
    const plano = lerPlano(EXEMPLO, CODIGO);
    assert.match(EXEMPLO, /`db push` e `vercel --prod`/);
    assert.deepEqual(plano.porId.get("T1").publicacao, []);
    assert.deepEqual(plano.porId.get("T1").protegida, []);
    assert.equal(plano.porId.get("T1").estacao, "servidor");
  });

  test("o plano mora em docs/planos/<ciclo>.md ou docs/superpowers/plans/<ciclo>.md", () => {
    assert.ok(CODIGO.plano.casa("docs/planos/fase-2.md", "fase-2"));
    assert.ok(CODIGO.plano.casa("docs/superpowers/plans/fase-2.md", "fase-2"));
    assert.ok(!CODIGO.plano.casa("docs/planos/fase-2.md", "fase-3"));
    assert.ok(!CODIGO.plano.casa("docs/specs/fase-2.md", "fase-2"));
    assert.ok(!CODIGO.plano.casa("outro/docs/planos/fase-2.md", "fase-2"));
  });
});

describe("tarefa sem anotação", () => {
  test("sai sem estação e marcada como a perguntar", () => {
    const lido = lerPlanoPublico(semAnotacao(3, "Estação"));
    assert.equal(lido.declaracoes.anotacoes.get("T3").estacao, null);
    assert.equal(lido.declaracoes.porTask.get("T3").estacao, null);
    assert.deepEqual(lido.declaracoes.aPerguntar, ["T3"]);
    assert.deepEqual(lido.declaracoes.invalidas, [{ campo: "Estação", valor: A_PERGUNTAR, task: "T3" }]);
  });

  test("publicação e sensibilidade também: sem a anotação, nulo e a perguntar, nunca `não`", () => {
    const lido = lerPlanoPublico(semAnotacao(1, "Sensível", ""));
    assert.equal(lido.declaracoes.anotacoes.get("T1").sensivel, null);
    assert.deepEqual(lido.declaracoes.aPerguntar, ["T1"]);
    const sem = lerPlanoPublico(semAnotacao(4, "Publicação"));
    assert.equal(sem.declaracoes.anotacoes.get("T4").publicacao, null);
    assert.deepEqual(sem.declaracoes.invalidas, [{ campo: "Publicação", valor: A_PERGUNTAR, task: "T4" }]);
  });

  test("valor fora do vocabulário vai a perguntar com o valor lido", () => {
    const lido = lerPlanoPublico(semAnotacao(1, "Estação", "**Estação:** Workstation"));
    assert.equal(lido.declaracoes.anotacoes.get("T1").estacao, null);
    assert.deepEqual(lido.declaracoes.invalidas, [{ campo: "Estação", valor: "Workstation", task: "T1" }]);
    const talvez = lerPlanoPublico(semAnotacao(2, "Publicação", "**Publicação:** talvez"));
    assert.deepEqual(talvez.declaracoes.invalidas, [{ campo: "Publicação", valor: "talvez", task: "T2" }]);
  });

  test("fase sem tarefa de fechamento vai a perguntar", () => {
    const lido = lerPlanoPublico(semAnotacao(5, "Marcas"));
    assert.equal(lido.declaracoes.invalidas.length, 1);
    assert.match(lido.declaracoes.invalidas[0].valor, /nenhuma tarefa de F2 com fechamento-de-fase/);
  });

  test("plano torto não some em silêncio: sem tarefa, heading fora do formato, cerca aberta", () => {
    const campos = (texto) => lerPlanoPublico(texto).declaracoes.invalidas.map((d) => `${d.campo}: ${d.valor}`);
    assert.deepEqual(campos("# Plano\n\n**Fase:** F1\n"), ["Tarefa: nenhuma tarefa no plano — a perguntar"]);
    assert.match(campos(EXEMPLO.replace("### Tarefa 2: rota", "## Tarefa 2: rota")).join("\n"), /Tarefa: linha \d+ fora do formato: ## Tarefa 2: rota/);
    assert.match(campos(EXEMPLO.replace("### Tarefa 2: rota", "### Task 2.1: rota")).join("\n"), /fora do formato: ### Task 2\.1: rota/);
    // Cerca a mais engole a tarefa seguinte: o buraco na numeração vai a perguntar.
    assert.match(campos(EXEMPLO.replace("### Tarefa 2: rota", "```\n### Tarefa 2: rota")).join("\n"), /Tarefa: esperada T2, veio T3/);
    assert.match(campos(`${EXEMPLO}\n\`\`\`\nresto\n`).join("\n"), /Bloco de código: cerca aberta/);
    // Cerca de quatro crases não fecha com três: o exemplo de dentro segue sendo código.
    const quatro = EXEMPLO.replace("```ts\n### isto", "````ts\n```\n### Tarefa 9: falsa\n```\n### isto").replace("test('lista vazia sem arquivo', () => {})\n```", "test('lista vazia sem arquivo', () => {})\n````");
    assert.deepEqual(lerPlanoPublico(quatro).tasks.map((t) => t.id), ["T1", "T2", "T3", "T4", "T5"]);
  });

  test("anotação depois do primeiro passo ou repetida vai a perguntar; chave sem acento vale", () => {
    const depois = lerPlanoPublico(EXEMPLO.replace("- [ ] **Passo 1: a rota devolve a lista**", "- [ ] **Passo 1: a rota devolve a lista**\n\n**Prazo:** 5 min"));
    assert.deepEqual(depois.declaracoes.invalidas, [{ campo: "Prazo", valor: "depois do primeiro passo", task: "T2" }]);
    const repetida = lerPlanoPublico(semAnotacao(1, "Estação", "**Estação:** servidor\n**Estação:** workstation"));
    assert.deepEqual(repetida.declaracoes.invalidas, [{ campo: "Estação", valor: "repetida", task: "T1" }]);
    const semAcento = lerPlanoPublico(semAnotacao(3, "Estação", "**Estacao:** workstation"));
    assert.equal(semAcento.declaracoes.anotacoes.get("T3").estacao, "workstation");
    assert.deepEqual(semAcento.declaracoes.invalidas, []);
  });

  test("Verificação e commit ausentes vão a perguntar no parse, não só no conferir", () => {
    const semVerificacao = lerPlanoPublico(semAnotacao(1, "Verificação"));
    assert.deepEqual(semVerificacao.declaracoes.invalidas, [{ campo: "Verificação", valor: A_PERGUNTAR, task: "T1" }]);
    const semCommit = lerPlanoPublico(semAnotacao(4, "Commit"));
    assert.equal(semCommit.declaracoes.invalidas.length, 1);
    assert.deepEqual([semCommit.declaracoes.invalidas[0].campo, semCommit.declaracoes.invalidas[0].task], ["Commit", "T4"]);
    const duasCrases = lerPlanoPublico(semAnotacao(1, "Verificação", "**Verificação:** `npm test` e `npm run lint`"));
    assert.deepEqual(duasCrases.declaracoes.invalidas.map((d) => d.campo), ["Verificação"]);
  });

  test("topo sob `## Contexto`, commit com travessão e `- **Criar:**` em negrito", () => {
    const lido = lerPlanoPublico(EXEMPLO.replace("**Fase:** F2\n", "## Contexto\n\n**Fase:** F3\n"));
    assert.equal(lido.fases[0].id, "F3");
    const plano = lerPlano(
      semAnotacao(4, "Commit", "**Commit:** Conferência — página de lembretes.").replace("- Criar: `docs/conferencia-lembretes.md`", "- **Criar:** `docs/conferencia-lembretes.md`"),
      CODIGO,
    );
    assert.deepEqual(plano.porId.get("T4").outputs, ["docs/conferencia-lembretes.md"]);
    assert.equal(lerPlanoPublico(semAnotacao(4, "Commit", "**Commit:** Conferência — página de lembretes.")).tasks[3].bullets.get("Commit"), "Conferência — página de lembretes.");
  });

  test("o núcleo, ao ler o plano para pedir o sim, pergunta em vez de abrir filha", () => {
    const repo = tmp("superpowers-repo-");
    const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    mkdirSync(path.join(repo, ".altair"));
    mkdirSync(path.join(repo, "docs", "planos"), { recursive: true });
    // O embutido declarado por nome (D-VEGA29-34): nada de código em `.altair/`.
    writeFileSync(
      path.join(repo, ".altair", "adaptador.json"),
      JSON.stringify({
        versao: 2,
        codigo: "superpowers",
        projeto: "mentira",
        operadores: [{ handle: "op", nome: "Operador" }],
        estado: { pasta: "mentira/conducao" },
        log: { pasta: "." },
        pergunta: { destino: "log" },
        ci: false,
      }),
    );
    writeFileSync(path.join(repo, "docs", "planos", "fase-2.md"), EXEMPLO);
    git("add", "-A");
    git("commit", "-q", "-m", "plano anotado");
    const ok = lerPlanoNoCommit(repo, "HEAD", "fase-2");
    assert.equal(ok.caminho, "docs/planos/fase-2.md");
    assert.equal(ok.plano.porId.get("T3").classe, "workstation");

    writeFileSync(path.join(repo, "docs", "planos", "fase-2.md"), semAnotacao(3, "Estação"));
    git("commit", "-q", "-am", "plano sem a estação da T3");
    assert.throws(
      () => lerPlanoNoCommit(repo, "HEAD", "fase-2"),
      (e) => e instanceof ErroPlano && e.codigo === "declaracao-invalida" && e.message === `T3 Estação: ${A_PERGUNTAR}`,
    );
  });
});

/** Plano de duas fases num arquivo (D-VEGA37-54): `## Fase F<n>` com modelo e tier próprios. */
function tarefa(n, titulo, marcas = "") {
  return [
    `### Tarefa ${n}: ${titulo}`,
    "",
    "**Estação:** servidor",
    "**Publicação:** não",
    "**Sensível:** não",
    ...(marcas ? [`**Marcas:** ${marcas}`] : []),
    "**Verificação:** `npm test`",
    `**Commit:** EXEMPLO/T${n} — ${titulo}`,
    "",
    "**Arquivos:**",
    `- Modificar: \`src/t${n}.mjs\``,
    "",
    "- [ ] **Passo 1: fazer**",
    "",
  ].join("\n");
}
const DUAS_FASES = [
  "# Passagem: plano",
  "",
  "**Modelo:** haiku",
  "",
  "**Largura do ciclo:** 1",
  "",
  "## Fase F1 — a saudação",
  "",
  "**Modelo:** sonnet",
  "**Tier:** parecer",
  "",
  tarefa(1, "saudação"),
  tarefa(2, "fechamento de F1", "fechamento-de-fase"),
  "## Fase F2",
  "",
  "**Tier:** critico",
  "",
  tarefa(3, "despedida"),
  tarefa(4, "fechamento de F2", "fechamento-de-fase"),
].join("\n");

describe("plano de várias fases", () => {
  test("plano de duas fases num arquivo lê as duas fases", () => {
    const lido = lerPlanoPublico(DUAS_FASES);
    assert.deepEqual(lido.declaracoes.invalidas, []);
    assert.deepEqual(lido.fases, [
      { id: "F1", model: "sonnet", tier: "parecer" },
      // Sem `**Modelo:**` sob o cabeçalho, o do topo.
      { id: "F2", model: "haiku", tier: "critico" },
    ]);
    assert.deepEqual(lido.tasks.map((t) => [t.id, t.phase]), [
      ["T1", "F1"],
      ["T2", "F1"],
      ["T3", "F2"],
      ["T4", "F2"],
    ]);
    // O núcleo lê as duas fases, cada fechamento na sua.
    const plano = lerPlano(DUAS_FASES, CODIGO);
    assert.deepEqual(plano.tasks.map((x) => [x.id, x.fase, x.classe]), [
      ["T1", "F1", "comum"],
      ["T2", "F1", "fechamento"],
      ["T3", "F2", "comum"],
      ["T4", "F2", "fechamento"],
    ]);
    // O brief da tarefa acaba no cabeçalho da fase seguinte.
    const dir = tmp("superpowers-fases-");
    const arquivo = path.join(dir, "EXEMPLO-2-passagem.md");
    writeFileSync(arquivo, DUAS_FASES);
    const brief = execFileSync("node", [ADAPTADOR, "brief", "--plano", arquivo, "T2", "--nonce", "n1", "--ref", "refs/conducao/EXEMPLO-2-passagem/T2/1"], { encoding: "utf8" });
    assert.match(brief, /### Tarefa 2: fechamento de F1/);
    assert.doesNotMatch(brief, /## Fase F2/);
  });

  test("fase sem fechamento num plano de várias fases vai a perguntar", () => {
    const campos = (texto) => lerPlanoPublico(texto).declaracoes.invalidas.map((d) => `${d.campo}: ${d.valor}`);
    const semFechamento = DUAS_FASES.replace("**Marcas:** fechamento-de-fase\n**Verificação:** `npm test`\n**Commit:** EXEMPLO/T2", "**Verificação:** `npm test`\n**Commit:** EXEMPLO/T2");
    assert.deepEqual(campos(semFechamento), ["Marcas: nenhuma tarefa de F1 com fechamento-de-fase — a perguntar"]);
    // Fase repetida, fora da forma, `**Fase:**` no topo e heading de fase fora do formato.
    assert.match(campos(DUAS_FASES.replace("## Fase F2", "## Fase F1")).join("\n"), /Fase: F1 repetida/);
    assert.match(campos(DUAS_FASES.replace("## Fase F2", "## Fase dois")).join("\n"), /Fase: dois fora da forma F<n>/);
    assert.match(campos(DUAS_FASES.replace("**Largura do ciclo:** 1", "**Largura do ciclo:** 1\n\n**Fase:** F1")).join("\n"), /Fase: \*\*Fase:\*\* F1 no topo junto com cabeçalho de fase/);
    assert.match(campos(DUAS_FASES.replace("## Fase F2", "### Fase F2")).join("\n"), /Fase: linha \d+ fora do formato: ### Fase F2/);
    // A numeração segue corrida: recomeçar em T1 na F2 deixa o buraco à vista.
    assert.match(campos(DUAS_FASES.replace("### Tarefa 3:", "### Tarefa 1:")).join("\n"), /Tarefa: esperada T3, veio T1/);
    // Tarefa antes do primeiro cabeçalho de fase não é de fase nenhuma.
    const antes = DUAS_FASES.replace("## Fase F1 — a saudação", `${tarefa(1, "solta")}\n## Fase F1 — a saudação`).replace("### Tarefa 1: saudação", "### Tarefa 2: saudação").replace("### Tarefa 2: fechamento de F1", "### Tarefa 3: fechamento de F1").replace("### Tarefa 3: despedida", "### Tarefa 4: despedida").replace("### Tarefa 4: fechamento de F2", "### Tarefa 5: fechamento de F2");
    assert.deepEqual(lerPlanoPublico(antes).declaracoes.invalidas, [{ campo: "Fase", valor: "tarefa antes do primeiro cabeçalho de fase — a perguntar", task: "T1" }]);
  });
});

describe("brief da operária", () => {
  const arquivo = () => {
    const d = tmp("superpowers-brief-");
    const f = path.join(d, "fase-2.md");
    writeFileSync(f, EXEMPLO);
    return f;
  };

  test("contrato à frente do bloco verbatim e das seções globais; subject do `git commit -m`", () => {
    const f = arquivo();
    const args = CODIGO.plano.brief({ canonico: f, task: "T2", nonce: "abc123", ref: "refs/conducao/fase-2/T2/1" });
    const r = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^## contrato da operária — T2 · nonce `abc123`$/m);
    assert.match(r.stdout, /Commitar\*\* com o subject da task: `Rota e página dos lembretes`/);
    assert.match(r.stdout, /refs\/conducao-aviso\/fase-2\/T2\/1/);
    assert.match(r.stdout, /^### Tarefa 2: rota e página dos lembretes$/m);
    assert.match(r.stdout, /^\*\*Prazo:\*\* 45 min$/m);
    assert.doesNotMatch(r.stdout, /^### Tarefa 3:/m);
    assert.match(r.stdout, /^## Restrições globais$/m);
    assert.match(r.stdout, /^## Foco de revisão$/m);
    assert.doesNotMatch(r.stdout, /\{\{[^}]*\}\}/);
    // A `publicacao` deste adaptador é a marca, não verbo: o "Nunca" sai genérico (D-HN29-24a).
    assert.match(r.stdout, /que só a maestra grava; qualquer publicação — quem publica é a maestra/);
    assert.ok(!r.stdout.includes(MARCA_PUBLICACAO), "a marca da anotação não vira texto do contrato");
  });

  test("`**Commit:**` explícito vale sobre o bloco de commit", () => {
    const r = spawnSync(process.execPath, CODIGO.plano.brief({ canonico: arquivo(), task: "T4", nonce: "abc123", ref: "refs/conducao/fase-2/T4/1" }), { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /subject da task: `Conferência da página de lembretes`/);
  });

  test("subject com `$&` chega intacto ao contrato; seção global por prefixo, inteira até o próximo `##`", () => {
    const d = tmp("superpowers-brief-");
    const f = path.join(d, "fase-2.md");
    writeFileSync(
      f,
      semAnotacao(4, "Commit", "**Commit:** Custo $& e $$ da página").replace("## Restrições globais", "## Restrições globais (do ciclo)\n\n### Ambiente\n\n- Node 24."),
    );
    const r = spawnSync(process.execPath, CODIGO.plano.brief({ canonico: f, task: "T4", nonce: "abc123", ref: "refs/conducao/fase-2/T4/1" }), { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes("subject da task: `Custo $& e $$ da página`"));
    assert.match(r.stdout, /^## Restrições globais \(do ciclo\)\n\n### Ambiente\n\n- Node 24\.\n\n- Textos/m);
  });

  test("importar o módulo com argv[1] que não é arquivo não quebra", () => {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(ADAPTADOR).href)})`, "nao-existe.txt"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  });

  test("tarefa inexistente ou ref de outra tarefa sai 2, sem brief", () => {
    const f = arquivo();
    for (const [task, ref] of [
      ["T9", "refs/conducao/fase-2/T9/1"],
      ["T2", "refs/conducao/fase-2/T3/1"],
    ]) {
      const r = spawnSync(process.execPath, CODIGO.plano.brief({ canonico: f, task, nonce: "abc123", ref }), { encoding: "utf8" });
      assert.equal(r.status, 2);
      assert.equal(r.stdout, "");
    }
    assert.equal(spawnSync(process.execPath, [ADAPTADOR, "brief"], { encoding: "utf8" }).status, 2);
  });
});
