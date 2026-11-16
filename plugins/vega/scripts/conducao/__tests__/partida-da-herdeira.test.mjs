/**
 * partida-da-herdeira.test.mjs — a herdeira parte pela rotina fixa (pré-voo,
 * estado pelo git, nota, lista de tasks) e retoma só com o git, o estado do
 * harness e a nota (VEGA-37 T17, AC-VEGA37-8).
 *
 * Sem banco e sem arquivo de projeto (D-VEGA37-28): o repositório é real, numa
 * pasta temporária — origin bare, a árvore da anterior no ramo do ciclo e a da
 * herdeira destacada, como a sessão nova nasce —, e a posse vem de um leitor de
 * teste por árvore (`trocarLeitorDaPosse`) que se porta como o do projeto: com o
 * HEAD destacado e sem o ciclo, não lê (D-VEGA37-30). A troca inteira contra o
 * banco do harness é de `.claude/scripts/estado/__tests__/partida-da-herdeira-banco.test.mjs`.
 *
 * CONTRAPROVA: tirar `epocaDaPosse` das conferências da herdeira faz "o
 * pré-voo recusa herdeira com época divergente" sair ok; tirar `nota` ou
 * `avisos` do `retomar` faz o caso principal achar `undefined`; o leitor da
 * cerca sem o ciclo faz a anterior desanexada parar em `passagem-sem-posse`.
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { confirmarPassagem, proximo, retomar, textoDaHerdeira, trazerRamo } from "../conducao.mjs";
import { SECOES_DA_NOTA, autorizarCiclo, passar, trocarLeitorDaPosse } from "../git-conducao.mjs";
import { CONFERENCIAS_DA_HERDEIRA, conferenciasDaHerdeira } from "../pre-voo.mjs";

const CICLO = "TESTE-17-partida";
const PASTA = `.agents/ciclo/teste/${CICLO}`;
const RAMO = "ciclo-teste";
const AGORA = new Date("2026-11-14T20:00:00Z").toISOString();
const CORPO = SECOES_DA_NOTA.map((s) => `## ${s}\n\ntexto de ${s}\n`).join("\n");

function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function task(id) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE17-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
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

const CANONICO = [
  "---",
  `id: ciclo/teste/${CICLO}/canonico`,
  `cycle: ${CICLO}`,
  "opened: 2026-11-14",
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
  task("T1"),
  task("T2"),
  "## 4. Pronto",
  "",
].join("\n");

/**
 * Origin bare e três árvores do mesmo repositório: principal (destacada), anterior
 * (no ramo) e herdeira (destacada). `posse` é a posse por árvore; o leitor de
 * teste, como o do projeto, não lê árvore destacada sem o ciclo.
 */
function ambiente(t) {
  const raiz = real(mkdtempSync(path.join(tmpdir(), "partida-herdeira-")));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const principal = path.join(raiz, "principal");
  mkdirSync(principal);
  const g = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g(principal, "init", "-q", "-b", RAMO);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g(principal, "config", k, v);
  g(principal, "remote", "add", "origin", origin);
  mkdirSync(path.join(principal, PASTA), { recursive: true });
  writeFileSync(path.join(principal, "README.md"), "fixture\n");
  writeFileSync(path.join(principal, ".gitignore"), "**/notes/sensivel/\n");
  writeFileSync(path.join(principal, PASTA, "canonico.md"), CANONICO);
  g(principal, "add", "-A");
  g(principal, "commit", "-q", "-m", "plano");
  g(principal, "push", "-q", "origin", RAMO);
  g(principal, "switch", "-q", "--detach");
  const anterior = path.join(raiz, "bridge-cse_anterior");
  g(principal, "worktree", "add", "-q", anterior, RAMO);
  const herdeira = path.join(raiz, "bridge-cse_herdeira");
  g(principal, "worktree", "add", "-q", "--detach", herdeira, "HEAD");
  const posse = new Map([
    [anterior, { estado: "dona", ciclo: CICLO, lock_id: randomUUID(), epoca: 1, epoca_gravada: 1 }],
    [herdeira, { estado: "outra", ciclo: CICLO, motivo: "outra árvore" }],
  ]);
  const ciclosLidos = [];
  const leitor = (repo, ciclo = null) => {
    ciclosLidos.push(ciclo);
    const destacada = !g(repo, "branch", "--show-current");
    if (destacada && !ciclo) return { estado: "nao-li", motivo: "HEAD destacado: sem ramo, sem ciclo" };
    return posse.get(real(repo)) ?? { estado: "outra", motivo: "fora da troca" };
  };
  const antes = trocarLeitorDaPosse(leitor);
  t.after(() => trocarLeitorDaPosse(antes));
  /** O `passar-posse` do projeto (T14): lock_id novo, época + 1, a dona muda de árvore numa escrita. */
  const passarPosse = ({ lock_id, epoca }) => {
    const atual = posse.get(anterior);
    assert.deepEqual([atual.lock_id, atual.epoca], [lock_id, epoca], "o passar-posse leva o par da nota");
    posse.set(herdeira, { estado: "dona", ciclo: CICLO, lock_id: randomUUID(), epoca: epoca + 1, epoca_gravada: epoca + 1 });
    posse.set(anterior, { estado: "outra", ciclo: CICLO, motivo: "outra árvore" });
  };
  const px = (repo, entrada = {}) => proximo({ repo, ciclo: CICLO, entrada: { agora: AGORA, ...entrada } });
  return { anterior, herdeira, g, leitor, ciclosLidos, passarPosse, px };
}

/** O que a herdeira compara com a anterior: a ação e o alvo, sem o nonce (o HEAD andou com as marcas). */
const essencia = (p) => ({ acao: p.acao, task: p.task ?? null, fase: p.fase ?? null, tasks: p.tasks ?? null });
const ciFalso = (ci) => () => ci;

test("herdeira retoma sem ler a conversa da anterior", (t) => {
  const a = ambiente(t);
  autorizarCiclo({ repo: a.anterior, ciclo: CICLO, fase: "F1", sim: "sim, pode tocar a F1" });
  const ci = { proposta: { numero: 7, headRefOid: null }, run: { databaseId: 70, conclusion: "success" } };
  // O que a anterior teria feito a seguir, e o estado dela pelo git.
  const daAnterior = a.px(a.anterior);
  assert.notEqual(daAnterior.acao, "perguntar", JSON.stringify(daAnterior));
  const estadoDaAnterior = retomar({ repo: a.anterior, ciclo: CICLO, lerCi: ciFalso(ci) });

  // Uma operária avisou pela referência irmã, no origin.
  const avisoSha = a.g(a.anterior, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "T1-FALHA pergunta 0123456789abcdef");
  a.g(a.anterior, "push", "-q", "origin", `${avisoSha}:refs/conducao-aviso/${CICLO}/T1/1`);

  // A anterior entra em passagem e desanexa o ramo; destacada, segue lendo a própria posse pelo ciclo.
  const em = passar({ repo: a.anterior, ciclo: CICLO, fase: "F1", corpo: CORPO });
  a.g(a.anterior, "switch", "-q", "--detach");
  const criar = a.px(a.anterior, { sessaoMaestra: "session_anterior" });
  assert.equal(criar.acao, "criar-condutora", JSON.stringify(criar));
  assert.ok(a.ciclosLidos.length && a.ciclosLidos.every((c) => c === CICLO), `o leitor da cerca recebe o ciclo (${JSON.stringify(a.ciclosLidos)})`);
  assert.match(criar.texto, /pre-voo .*--herdeira/, "o prompt da herdeira leva a rotina de partida");
  assert.match(criar.texto, /retomar --repo/);

  // ── a herdeira: só o repositório e a posse ──
  trazerRamo({ repo: a.herdeira, ciclo: CICLO, ...criar.trazer });
  const cedo = conferenciasDaHerdeira({ repo: a.herdeira, ciclo: CICLO, entrada: { inscrita: true }, lerPosse: a.leitor });
  assert.equal(cedo.conferencias.find((c) => c.conferencia === "epoca-da-posse").estado, "falha", "antes do passar-posse a época não é a da nota + 1");

  const pp = a.px(a.herdeira);
  assert.equal(pp.acao, "passar-posse", JSON.stringify(pp));
  a.passarPosse({ lock_id: pp.lock_id, epoca: pp.epoca });

  // Pré-voo de herdeira, depois do passar-posse e da inscrição: as três conferências verdes.
  const pv = conferenciasDaHerdeira({ repo: a.herdeira, ciclo: CICLO, entrada: { inscrita: true }, lerPosse: a.leitor });
  assert.deepEqual(pv.conferencias.map((c) => c.conferencia), [...CONFERENCIAS_DA_HERDEIRA]);
  for (const c of pv.conferencias) assert.equal(c.estado, "ok", `${c.conferencia}: ${c.encontrado}`);
  assert.equal(pv.passagem.sha, em.sha);

  assert.equal(a.px(a.herdeira).acao, "inscrever-na-proposta");
  const c = a.px(a.herdeira, { inscrita: true });
  assert.equal(c.acao, "confirmar-passagem", JSON.stringify(c));
  confirmarPassagem({ repo: a.herdeira, ciclo: CICLO, nonce: c.nonce, entrada: { agora: AGORA, inscrita: true } });

  // Estado pelo git: a nota, os avisos, o CI e as tasks — sem a conversa da anterior.
  const estado = retomar({ repo: a.herdeira, ciclo: CICLO, lerCi: ciFalso(ci) });
  assert.equal(estado.ramo, RAMO);
  assert.equal(estado.nota.passagem, em.sha);
  assert.ok(estado.nota.corpo.trimEnd().endsWith(CORPO.trim()), "a nota de passagem inteira, lida do commit da marca");
  assert.match(estado.nota.corpo, /^epoca: 1$/m, "com a época na cabeça");
  assert.deepEqual([estado.nota.epoca, estado.nota.lock_id], [String(pp.epoca), pp.lock_id]);
  assert.deepEqual(
    estado.avisos.avisos.map((x) => [x.task, x.tentativa, x.sha, x.linha]),
    [["T1", 1, avisoSha, "T1-FALHA pergunta 0123456789abcdef"]],
    "os avisos das operárias, por referência",
  );
  assert.deepEqual(estado.ci, ci, "o último CI da proposta");
  for (const k of ["autorizadas", "feitas", "recusadas", "emVoo", "trazidas", "conduzir"]) assert.deepEqual(estado[k], estadoDaAnterior[k], k);

  // E chega ao mesmo `proximo` que a anterior teria.
  assert.deepEqual(essencia(a.px(a.herdeira, { inscrita: true })), essencia(daAnterior));
});

test("o pré-voo recusa herdeira com época divergente", (t) => {
  const a = ambiente(t);
  autorizarCiclo({ repo: a.anterior, ciclo: CICLO, fase: "F1", sim: "sim" });
  passar({ repo: a.anterior, ciclo: CICLO, fase: "F1", corpo: CORPO });
  a.g(a.anterior, "switch", "-q", "--detach");
  a.g(a.herdeira, "switch", "-q", RAMO);
  const lock = randomUUID();
  const conferir = (posse, entrada = { inscrita: true }, temCi = true) =>
    Object.fromEntries(conferenciasDaHerdeira({ repo: a.herdeira, ciclo: CICLO, entrada, temCi, lerPosse: () => posse }).conferencias.map((c) => [c.conferencia, c]));

  assert.equal(conferir({ estado: "dona", lock_id: lock, epoca: 2, epoca_gravada: 2 })["epoca-da-posse"].estado, "ok");
  // Época parada (sem passar-posse), época que passou de novo, gravada diferente, posse alheia e banco fora.
  const parada = conferir({ estado: "dona", lock_id: lock, epoca: 1 })["epoca-da-posse"];
  assert.equal(parada.estado, "falha");
  assert.match(parada.remedio, /passar-posse/);
  const passouDeNovo = conferir({ estado: "dona", lock_id: lock, epoca: 3 })["epoca-da-posse"];
  assert.equal(passouDeNovo.estado, "falha");
  assert.match(passouDeNovo.remedio, /parar/);
  assert.equal(conferir({ estado: "dona", lock_id: lock, epoca: 2, epoca_gravada: 1 })["epoca-da-posse"].estado, "falha");
  assert.equal(conferir({ estado: "outra", motivo: "outra árvore" })["epoca-da-posse"].estado, "falha");
  assert.equal(conferir({ estado: "nao-li", motivo: "banco fora" })["epoca-da-posse"].estado, "falha");

  // Inscrição: sem ela recusa; projeto sem proposta pula, como na T9.
  const dona2 = { estado: "dona", lock_id: lock, epoca: 2 };
  assert.equal(conferir(dona2, {})["inscricao-feita"].estado, "falha");
  assert.match(conferir(dona2, {}, false)["inscricao-feita"].encontrado, /projeto-sem-proposta/);
  // Árvore fora da ponta: o HEAD destacado.
  a.g(a.herdeira, "switch", "-q", "--detach");
  assert.equal(conferir(dona2)["arvore-na-ponta"].estado, "falha");
});

// T49 (achados 1 e 2 da prova da T28): o pré-voo da herdeira confere a época,
// que só o passar-posse sobe; a ordem escrita tem de pôr o passar-posse antes.
test("a skill põe o pré-voo da herdeira depois do passar-posse", () => {
  const skill = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "skills", "conducao", "SKILL.md"), "utf8");
  const inicio = skill.indexOf("\n## 6.");
  assert.ok(inicio >= 0, "SKILL.md sem o §6");
  const fim = skill.indexOf("\n## ", inicio + 1);
  const s6 = skill.slice(inicio, fim < 0 ? undefined : fim);
  const posse = s6.indexOf("passar-posse");
  const preVoo = s6.indexOf("--herdeira");
  assert.ok(posse >= 0 && preVoo >= 0, "o §6 não cita o passar-posse e o pré-voo --herdeira");
  assert.ok(posse < preVoo, "no §6 o pré-voo --herdeira vem antes do passar-posse");
});

test("o prompt da herdeira aponta o verbo de posse da página do projeto", () => {
  const texto = textoDaHerdeira({ ciclo: CICLO, fase: "F2", sessao: "session_x", nota: null, trazer: { ramo: RAMO, passagem: "a".repeat(40), tentativa: 1, nonce: "0".repeat(16) } });
  const linhas = texto.split("\n");
  const passo2 = linhas.find((l) => l.startsWith("2. "));
  assert.match(passo2, /passar-posse vai pelo verbo de posse que a página do projeto nomeia \(campo pagina da declaração\)/);
  const iPosse = texto.indexOf("passar-posse");
  const iPreVoo = texto.indexOf("--herdeira");
  assert.ok(iPosse >= 0 && iPosse < iPreVoo, "o prompt põe o pré-voo antes do passar-posse");
  assert.match(linhas.find((l) => l.startsWith("3. ")), /^3\. Depois do passar-posse/);
});

// T53 (D-VEGA37-56, achado da prova da T52): a herdeira parava no
// confirmar-passagem; depois dele o prompt manda seguir o laço do `proximo`
// na fase herdada — desmontar a anterior, depois as ações da fase até o fim.
test("o prompt da herdeira segue o laço da fase depois de confirmar a passagem", () => {
  const texto = textoDaHerdeira({ ciclo: CICLO, fase: "F2", sessao: "session_x", nota: null, trazer: { ramo: RAMO, passagem: "a".repeat(40), tentativa: 1, nonce: "0".repeat(16) } });
  const linhas = texto.split("\n");
  const iConfirma = linhas.findIndex((l) => l.includes("confirmar-passagem"));
  assert.ok(iConfirma >= 0, "o prompt não cita o confirmar-passagem");
  assert.doesNotMatch(linhas[iConfirma], /até confirmar-passagem/, "o passo da confirmação não pode ser o fim do prompt");
  const depois = linhas.slice(iConfirma + 1).join("\n");
  assert.ok(depois.length > 0, "nenhum passo depois do confirmar-passagem");
  assert.match(depois, /proximo --repo <árvore> --ciclo/, "depois da confirmação, seguir o proximo");
  const iDesmontar = depois.indexOf("desmontar-anterior");
  const iFim = depois.search(/encerrar-sessao|fechar-ciclo/);
  assert.ok(iDesmontar >= 0, "depois da confirmação, desmontar a anterior");
  assert.ok(iFim > iDesmontar, "o desmonte vem antes de conduzir a fase até o fim");
  assert.match(depois, /encerrar-sessao/);
  assert.match(depois, /fechar-ciclo/);
  assert.match(depois, /F2/, "a fase herdada é nomeada");
  assert.match(depois, /pergunta/, "a pergunta ao operador também para o laço");
  assert.match(depois, /entrada montada pela §2 da skill/, "a entrada do laço vem da §2 da skill");
  for (const campo of ["filhas", "agora", "ci", "proposta", "aprovacoes", "sessaoMaestra"]) {
    assert.ok(depois.includes(campo), `a entrada do laço nomeia ${campo}`);
  }
  assert.doesNotMatch(depois, /--entrada '\{/, "o laço não fixa a entrada do proximo");
  assert.match(texto, /Não arquivar a anterior/, "o prompt segue sem mandar a herdeira arquivar a anterior");
  assert.doesNotMatch(texto, /archive_session/, "o prompt não manda a herdeira arquivar a anterior");
});
