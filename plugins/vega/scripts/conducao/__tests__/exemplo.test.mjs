/**
 * exemplo.test.mjs — o projeto de exemplo do plugin (`exemplo/`) conduzido de
 * ponta a ponta, sem rede.
 *
 * Copia o projeto para um tmp, faz dele um repositório git com um origin bare local
 * e conduz o ciclo do plano público (`docs/planos/EXEMPLO-1-despedida.md`, lido pelo
 * embutido `superpowers`) como a condutora conduz: `proximo` → `abrir` (a filha
 * busca a tentativa, trabalha e empurra) → `trazer` → `conferir` (a Verificação
 * embrulhada roda) → `registrar-conferencia`, até o `fechar-ciclo` e a marca de
 * encerramento do ciclo. A declaração não tem CI (`"ci": false`): a fase e o ciclo fecham
 * pela Verificação da última tarefa, depois de o ramo subir (`empurrar-ramo`, VEGA-37 T9,
 * com a inscrição e o CI pulados). Ao fim, o `auditar` confere o rastro.
 * O `autorizar-ciclo --pergunta` cita uma pergunta do registro do destino `git` do exemplo
 * (`.vega/sessao-<id>.jsonl`), com abertura, resposta e `autoria` provada contra um transcript
 * dublê (`CLAUDE_CONFIG_DIR` do tmp): sem atalho, a pergunta se confere (VEGA-19 T33, D-VEGA19-57).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { caminhoDoContrato } from "../git-conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const EXEMPLO = path.resolve(AQUI, "..", "..", "..", "exemplo");
const CICLO = "EXEMPLO-1-despedida";
const RAMO = `ciclo-${CICLO}`;

function gitEm(dir) {
  return (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function configurar(g) {
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g("config", k, v);
}

const SIM_DA_F1 = "sim, pode conduzir a F1";
const ABERTA = "2026-11-18T10:00:00.000Z";
const RESPONDIDA = "2026-11-18T10:05:00.000Z";
const chave = (...partes) => createHash("sha256").update(partes.join("|")).digest("hex");

/**
 * A pergunta do `autorizar-ciclo` no registro git do exemplo, na convenção da D-VEGA19-44, com
 * a resposta `a` e a `autoria` `digitado` cuja prova aponta a mensagem do operador no transcript
 * dublê da sessão da abertura (em `<config>/projects/exemplo/<sessao>.jsonl`). Devolve o id.
 */
function perguntaProvada(dir, config, { id = "p-00000000000000a1", fase = "F1", sim = SIM_DA_F1 } = {}) {
  const sessao = `operador-${id}`;
  const transcript = path.join(config, "projects", "exemplo", `${sessao}.jsonl`);
  const prova = `transcript:${transcript}#u-${id}`;
  const comum = { pergunta_id: id, sessao, ciclo: CICLO, item: "D1", titulo: "sim do ciclo" };
  const linhas = [
    { chave: chave("abertura", id), versao_esquema: 1, evento: "abertura", carimbo: ABERTA, ...comum, ponteiro: `autorizar-ciclo:${fase}`, itens: [{ numero: 1, titulo: "sim do ciclo", opcoes: [{ letra: "a", texto: sim }, { letra: "b", texto: "não, espera" }] }] },
    { chave: chave("resposta", id), versao_esquema: 1, evento: "resposta", carimbo: RESPONDIDA, ...comum, perguntado_em: ABERTA, resposta_literal: "a", escolha: "a", origem_resposta: "agente" },
    { chave: chave("autoria", id, "digitado", prova), versao_esquema: 1, evento: "autoria", carimbo: RESPONDIDA, ...comum, origem_resposta: "digitado", prova },
  ];
  mkdirSync(path.join(dir, ".vega"), { recursive: true });
  writeFileSync(path.join(dir, ".vega", `sessao-${sessao}.jsonl`), linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
  mkdirSync(path.dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${JSON.stringify({ uuid: `u-${id}`, sessionId: sessao, type: "user", origin: { kind: "human" }, timestamp: RESPONDIDA, message: { content: "a" } })}\n`);
  return id;
}

function ambiente(t, { preparar = null } = {}) {
  const raiz = mkdtempSync(path.join(tmpdir(), "altair-conducao-exemplo-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const config = path.join(raiz, "claude-config");

  const maestra = path.join(raiz, "maestra");
  cpSync(EXEMPLO, maestra, { recursive: true });
  const g = gitEm(maestra);
  g("init", "-q", "-b", "main");
  configurar(g);
  g("remote", "add", "origin", origin);
  const pergunta = perguntaProvada(maestra, config);
  if (preparar) preparar(maestra);
  g("add", "-A");
  g("commit", "-q", "-m", "projeto de exemplo");
  g("push", "-q", "origin", "main");
  g("checkout", "-q", "-b", RAMO);
  // Ciclo de 2 níveis declarado: sem a marca, o núcleo roda em 3 (D10c do L4).
  g("commit", "-q", "--allow-empty", "-m", "Conducao: ciclo niveis 2", "-m", "Conducao-Niveis: 2");
  g("push", "-q", "origin", RAMO);

  const filha = path.join(raiz, "filha");
  execFileSync("git", ["clone", "-q", origin, filha]);
  const f = gitEm(filha);
  configurar(f);

  const cli = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", maestra, "--ciclo", CICLO], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", CLAUDE_CONFIG_DIR: config },
    });
    const linhas = r.stdout.split("\n").filter(Boolean);
    return { status: r.status, stderr: r.stderr, saida: linhas.length === 1 ? JSON.parse(linhas[0]) : null, linhas };
  };
  const ok = (...args) => {
    const r = cli(...args);
    assert.equal(r.status, 0, `${args.join(" ")} → ${r.status}\n${r.stderr}\n${r.linhas.join("\n")}`);
    return r.saida;
  };

  /** A filha busca a tentativa, escreve os arquivos, commita com o subject da tarefa e empurra de volta. */
  const filhaTrabalha = (ref, arquivos, subject) => {
    f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
    f("checkout", "-q", "--detach", "refs/remotes/tentativa");
    for (const [rel, conteudo] of Object.entries(arquivos)) {
      mkdirSync(path.dirname(path.join(filha, rel)), { recursive: true });
      writeFileSync(path.join(filha, rel), conteudo);
    }
    f("add", "-A");
    f("commit", "-q", "-m", subject);
    f("push", "-q", "origin", `HEAD:${ref}`);
  };

  return { maestra, g, cli, ok, filhaTrabalha, pergunta };
}

/** O trabalho que a filha faz em cada tarefa do plano de exemplo. */
const TRABALHO = {
  T1: [{ "src/despedida.mjs": "/** A despedida do projeto de exemplo. */\nexport function despedida(nome) {\n  return `até logo, ${nome}`;\n}\n" }, "EXEMPLO-1-despedida-F1/T1 — despedida"],
  T2: [{ "README.md": "# Projeto de exemplo\n\nSaudação em `src/saudacao.mjs`, despedida em `src/despedida.mjs`.\n" }, "EXEMPLO-1-despedida-F1/T2 — fechamento de F1"],
};

test("o projeto de exemplo é conduzido de ponta a ponta: proximo, abrir, trazer, conferir, encerrar", (t) => {
  const a = ambiente(t);

  // Sem sim, o proximo pede o sim do ciclo ao operador declarado.
  const p0 = a.ok("proximo", "--entrada", "{}");
  assert.equal(p0.acao, "perguntar", JSON.stringify(p0));
  assert.equal(p0.motivo, "autorizar-ciclo");
  a.ok("autorizar-ciclo", "F1", "--sim", SIM_DA_F1, "--pergunta", a.pergunta);

  const feitas = [];
  let encerrou = false;
  let empurrou = false;
  for (let passo = 0; passo < 40; passo++) {
    const p = a.ok("proximo", "--entrada", JSON.stringify({ sessaoMaestra: "session_maestra_f1" }));
    if (p.acao === "empurrar-ramo") {
      // VEGA-37 T9: antes de fechar, a condutora empurra o ramo; sem proposta e sem CI, os dois pulos ficam registrados.
      assert.deepEqual(p.pulos.map((x) => x.passo), ["inscrever-na-proposta", "ci"]);
      const r = a.ok("empurrar-ramo", "--nonce", p.nonce);
      assert.equal(r.acao, "ramo-empurrado", JSON.stringify(r));
      assert.equal(r.sha, a.g("rev-parse", "HEAD"));
      empurrou = true;
      continue;
    }
    if (p.acao === "fechar-ciclo") {
      assert.ok(empurrou, "o ramo subiu antes do fechar-ciclo");
      // A última fase fecha com o ciclo: a marca é `Conducao-Encerrada: ciclo`.
      assert.deepEqual(p.conduzidas, ["F1"]);
      a.ok("encerrar-sessao", "--fase", "ciclo", "--nonce", p.nonce);
      encerrou = true;
      break;
    }
    // `abrir` (tarefa comum) e `fechar-fase` (a tarefa que fecha a fase) abrem uma tentativa.
    assert.ok(["abrir", "fechar-fase"].includes(p.acao), JSON.stringify(p));
    const tarefa = p.acao === "abrir" ? p.tarefas[0] : { task: p.task, tentativa: p.tentativa ?? 1, nonce: p.nonce };
    assert.equal(p.acao === "abrir" ? p.tarefas.length : 1, 1, "largura 1 abre uma tarefa por vez");
    const s = a.ok("abrir", tarefa.task, "--tentativa", String(tarefa.tentativa), "--nonce", tarefa.nonce, "--modo-maestra", "auto");
    assert.match(s.partida, new RegExp(`contrato da operária — ${tarefa.task} · nonce \`${tarefa.nonce}\``));
    const [arquivos, subject] = TRABALHO[tarefa.task];
    a.filhaTrabalha(s.ref, arquivos, subject);
    a.ok("trazer", tarefa.task, "--tentativa", String(tarefa.tentativa), "--sessao", `s-${tarefa.task}`);
    const c = a.ok("conferir", tarefa.task);
    assert.match(c.verificacao, /^env ALTAIR_SEM_COFRE_PRODUCAO=1 bash -c /, "sem campo verificacao: só a marca padrão");
    execFileSync("bash", ["-c", c.verificacao], { cwd: a.maestra, stdio: "pipe" });
    a.ok("registrar-conferencia", tarefa.task, "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--sessao", `s-${tarefa.task}`);
    feitas.push(tarefa.task);
  }
  assert.deepEqual(feitas, ["T1", "T2"]);
  assert.ok(encerrou, "o ciclo chegou ao fechar-ciclo");
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Encerrada,valueonly)"), "ciclo");
  const depois = a.ok("proximo", "--entrada", "{}");
  assert.equal(depois.motivo, "fechamento-em-sessao-limpa", JSON.stringify(depois));

  // O rastro da condução passa pelo auditar.
  const aud = a.cli("auditar", "--ref", "HEAD", "--exigir-fases", "F1", "--exigir-encerramentos", "ciclo");
  assert.equal(aud.status, 0, aud.stderr + aud.linhas.join("\n"));
  assert.deepEqual(aud.saida.violacoes, []);
  assert.deepEqual(aud.saida.tasks.map((x) => x.task), ["T1", "T2"]);
});

// D-VEGA20-26 (T43): no exemplo do plugin (adaptador `superpowers`, sem filtro de PHI próprio), a
// superfície de instrução não para o trazer, com contrato no HEAD ou sem: a declarada nos Outputs segue
// calada, e a de fora vai ao relato e ao registro `trazida`, sem caso de consentimento a gravar.
const SKILL = ".claude/skills/despedida/SKILL.md";

for (const declarada of [true, false]) {
  test(`no exemplo do plugin, a superfície de instrução ${declarada ? "declarada" : "fora dos Outputs"} é trazida sem perguntar`, (t) => {
    // O contrato da condução tem caminho no repositório do plugin; no corpo instalado sem `.git`
    // (seed dir, D-VEGA19-38) é null por desenho, e o trazer não depende mais dele (D-VEGA20-26).
    const contrato = caminhoDoContrato();
    const comGit = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: AQUI, encoding: "utf8" }).status === 0;
    if (comGit) assert.ok(contrato, "o contrato da condução tem caminho no repositório do plugin");
    else assert.equal(contrato, null, "fora de um repositório git o contrato não tem caminho");
    const a = ambiente(t, {
      preparar: (dir) => {
        if (!declarada) return;
        const plano = path.join(dir, "docs", "planos", `${CICLO}.md`);
        const texto = readFileSync(plano, "utf8");
        const antes = "- Criar: `src/despedida.mjs`\n";
        assert.ok(texto.includes(antes), "o plano de exemplo declara src/despedida.mjs");
        writeFileSync(plano, texto.replace(antes, `${antes}- Criar: \`${SKILL}\`\n`));
      },
    });
    a.ok("autorizar-ciclo", "F1", "--sim", SIM_DA_F1, "--pergunta", a.pergunta);
    const p = a.ok("proximo", "--entrada", JSON.stringify({ sessaoMaestra: "session_maestra_f1" }));
    assert.equal(p.acao, "abrir", JSON.stringify(p));
    const tarefa = p.tarefas[0];
    assert.equal(tarefa.task, "T1");
    const s = a.ok("abrir", tarefa.task, "--tentativa", String(tarefa.tentativa), "--nonce", tarefa.nonce, "--modo-maestra", "auto");
    const [arquivos, subject] = TRABALHO.T1;
    a.filhaTrabalha(s.ref, { ...arquivos, [SKILL]: "# despedida\n\nDiz até logo.\n" }, subject);
    const tr = a.ok("trazer", tarefa.task, "--tentativa", String(tarefa.tentativa), "--sessao", "s-T1");
    assert.equal(tr?.acao, "trazida", JSON.stringify(tr));
    assert.deepEqual(tr.foraDosOutputs, declarada ? [] : [SKILL]);
    assert.equal(tr.canonicoAlterado, false);
    assert.equal(a.g("show", `HEAD:${SKILL}`), "# despedida\n\nDiz até logo.", "o trabalho da filha foi trazido");
    // Nenhum caso a gravar: a superfície de instrução deixou de ser motivo, e não volta como consentido.
    const casos = a.g("log", "--format=%(trailers:key=Conducao-Consentimento,valueonly)", "-n", "20").split("\n").filter(Boolean);
    assert.deepEqual(casos, []);
  });
}
