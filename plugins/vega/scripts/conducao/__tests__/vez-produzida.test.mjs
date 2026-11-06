/**
 * vez-produzida.test.mjs — o núcleo preenche `vez` das filhas pelo adaptador
 * (HN-29 T52, débito de peso da F4: a regra da T25 lia `vez`, e ninguém o
 * preenchia).
 *
 * O código do adaptador pode ter a função opcional `esperandoAVez()`, que
 * devolve as sessões com build esperando a vez na fila do projeto; no
 * `proximo`, o núcleo marca `vez: "esperando"` nas filhas da entrada cuja
 * `sessao` está na lista, sem sobrescrever `vez` que a entrada traga. Sem a
 * função nada muda; a função que lança não marca ninguém (todas contam como
 * vivas) e diz o motivo no stderr. `vez` de tipo errado na entrada é problema
 * de entrada. Só adaptador de mentira, num repositório temporário: a suíte do
 * corpo não lê a fila de builds de projeto nenhum (T47).
 */
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ErroAdaptador, PROJETO_DE_TESTE, esperandoAVezDoProjeto, validarCodigo } from "../adaptador.mjs";
import { comVezDoAdaptador, problemasDaEntrada, proximo } from "../conducao.mjs";

const CICLO = "TESTE-1-vez";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const CODIGO_DO_TESTE = path.join(PROJETO_DE_TESTE, ".altair", "canonico.mjs");

const repos = [];
afterEach(() => {
  while (repos.length) rmSync(repos.pop(), { recursive: true, force: true });
  delete globalThis.__esperandoAVez;
  delete globalThis.__chamadasDaVez;
});

function task(id) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
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

const CANONICO = ["---", `cycle: ${CICLO}`, "opened: 2026-11-02", "---", "", "## 1. Goal", "", "### 1.5 Modo de Execução", "", "**Largura do ciclo:** 3", "", "## 3. Tasks", "", "### F1 — fase F1 (**Modelo:** sonnet)", "", task("T1"), task("T2"), "## 4. Pronto", ""].join("\n");

/**
 * Repositório de mentira com o plano autorizado e o adaptador do projeto de
 * teste das suítes; `comVez` acrescenta a `esperandoAVez()`, que faz o que
 * `globalThis.__esperandoAVez` mandar; `mede` declara `capacidade: "codigo"`
 * com a `capacidade()` que diz caber esse número de filhas novas (T24).
 */
function repo({ comVez, mede = null }) {
  const dir = mkdtempSync(path.join(tmpdir(), "vez-produzida-"));
  repos.push(dir);
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "ciclo-teste");
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
  mkdirSync(path.join(dir, ".altair"));
  const declaracao = JSON.parse(readFileSync(path.join(PROJETO_DE_TESTE, ".altair", "adaptador.json"), "utf8"));
  writeFileSync(
    path.join(dir, ".altair", "adaptador.json"),
    JSON.stringify({ ...declaracao, codigo: "mentira.mjs", ...(mede === null ? {} : { versao: 6, capacidade: "codigo" }) }),
  );
  let vez = comVez
    ? `  esperandoAVez() {
    globalThis.__chamadasDaVez = (globalThis.__chamadasDaVez ?? 0) + 1;
    return globalThis.__esperandoAVez();
  },
`
    : "";
  if (mede !== null) vez += `  capacidade() { return { filhasNovas: ${mede} }; },\n`;
  writeFileSync(path.join(dir, ".altair", "mentira.mjs"), `import base from ${JSON.stringify(pathToFileURL(CODIGO_DO_TESTE).href)};\nexport default { ...base,\n${vez}};\n`);
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  writeFileSync(path.join(dir, CAMINHO), CANONICO);
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  const blob = g("rev-parse", `HEAD:${CAMINHO}`);
  g("commit", "-q", "--allow-empty", "-m", "Conducao: F1 autorizada", "-m", "sim da Rita, no turno dela", "-m", `Conducao-Plano: ${blob}`);
  return dir;
}

/** Duas filhas vivas de outro ciclo, teto 2: sem vaga, a não ser que uma espere a vez. */
const FILHAS = Object.freeze([
  Object.freeze({ sessao: "session_a", task: "T9", tentativa: 1, nonce: "outro-ciclo-a", estado: "RUNNING" }),
  Object.freeze({ sessao: "session_b", task: "T8", tentativa: 1, nonce: "outro-ciclo-b", estado: "RUNNING" }),
]);
const abertas = (a) => (a.acao === "abrir" ? a.tarefas.length : 0);

describe("o código do adaptador: esperandoAVez é função opcional", () => {
  const MINIMO = { plano: { raiz: "planos", casa: () => false, ler: () => ({}), brief: () => [] }, publicacao: [], caminhosProtegidos: [], telasProtegidasDosSteps: [], foraDasTelasDosSteps: [], carimbo: null, ci: null };
  test("ausente é null; função passa; outro tipo recusa", () => {
    assert.equal(validarCodigo(MINIMO).esperandoAVez, null);
    const f = () => [];
    assert.equal(validarCodigo({ ...MINIMO, esperandoAVez: f }).esperandoAVez, f);
    assert.throws(() => validarCodigo({ ...MINIMO, esperandoAVez: ["s"] }), /esperandoAVez: esperada função/);
  });
});

describe("o proximo marca vez pelas sessões que o adaptador diz esperar", () => {
  test("filha viva esperando a vez, sem vez na entrada: abre uma filha a mais do que sem a função", () => {
    globalThis.__esperandoAVez = () => ["session_b"];
    const entrada = { filhas: FILHAS.map((f) => ({ ...f })), tetoPonte: 2 };
    const sem = proximo({ repo: repo({ comVez: false }), ciclo: CICLO, entrada: structuredClone(entrada) });
    const com = proximo({ repo: repo({ comVez: true }), ciclo: CICLO, entrada: structuredClone(entrada) });
    assert.equal(sem.acao, "esperar", JSON.stringify(sem));
    assert.equal(sem.motivo, "sem-vaga");
    assert.equal(abertas(com), abertas(sem) + 1, JSON.stringify(com));
    assert.equal(globalThis.__chamadasDaVez, 1);
  });

  test("com o teto medido a memória manda: a vez marcada não abre vaga além de filhasNovas (ruling de Leo 02/11/2026, 8a)", () => {
    // filhasNovas é medido sobre a memória que já inclui as filhas esperando: abrir além dele arrisca o OOM do slice.
    // A vez marca antes do teto, e o teto medido (vivas + filhasNovas) não conta quem espera: as vagas são filhasNovas.
    globalThis.__esperandoAVez = () => ["session_b"];
    const entrada = { filhas: FILHAS.map((f) => ({ ...f })) };
    const sem = proximo({ repo: repo({ comVez: false, mede: 1 }), ciclo: CICLO, entrada: structuredClone(entrada) });
    const com = proximo({ repo: repo({ comVez: true, mede: 1 }), ciclo: CICLO, entrada: structuredClone(entrada) });
    assert.equal(abertas(sem), 1, JSON.stringify(sem));
    assert.equal(abertas(com), abertas(sem), JSON.stringify(com));
    assert.equal(globalThis.__chamadasDaVez, 1, "a vez foi lida: neutra pela conta, não por faltar");
    // O teto fixado à mão vence a medição, e aí a vez vale: uma a mais.
    const fixado = proximo({ repo: repo({ comVez: true, mede: 1 }), ciclo: CICLO, entrada: { ...structuredClone(entrada), tetoPonte: 2 } });
    assert.equal(abertas(fixado), 1, JSON.stringify(fixado));
    const fixadoSem = proximo({ repo: repo({ comVez: false, mede: 1 }), ciclo: CICLO, entrada: { ...structuredClone(entrada), tetoPonte: 2 } });
    assert.equal(abertas(fixado), abertas(fixadoSem) + 1);
  });

  test("comVezDoAdaptador: marca só a sessão listada, não sobrescreve vez da entrada, não muda a entrada de quem chama", () => {
    const dir = repo({ comVez: true });
    globalThis.__esperandoAVez = () => ["session_a", "session_b", "session_fora"];
    const filhas = [{ ...FILHAS[0] }, { ...FILHAS[1], vez: "admitida" }, { sessao: "session_c", estado: "RUNNING" }];
    const entrada = { filhas };
    const saida = comVezDoAdaptador(dir, entrada);
    assert.deepEqual(
      saida.filhas.map((f) => f.vez),
      ["esperando", "admitida", undefined],
    );
    assert.equal(filhas[0].vez, undefined, "a filha de quem chama não muda");
    assert.equal(entrada.filhas, filhas);
  });

  test("sem a função, ou lista vazia, a entrada volta como está", () => {
    const entrada = { filhas: FILHAS };
    assert.equal(comVezDoAdaptador(repo({ comVez: false }), entrada), entrada);
    globalThis.__esperandoAVez = () => [];
    assert.equal(comVezDoAdaptador(repo({ comVez: true }), entrada), entrada);
    assert.equal(comVezDoAdaptador(repo({ comVez: true }), {}).filhas, undefined, "sem filhas, nada a marcar");
  });

  test("a função que lança ou responde de forma errada não marca ninguém e diz o motivo no stderr", (t) => {
    const linhas = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s, ...r) => (String(s).startsWith("conducao: vez") ? (linhas.push(String(s)), true) : original(s, ...r));
    t.after(() => (process.stderr.write = original));
    for (const [f, re] of [
      [() => { throw new Error("fila ilegível"); }, /fila ilegível/],
      [() => "session_a", /esperado lista de textos/],
      [() => [1], /esperado lista de textos/],
    ]) {
      globalThis.__esperandoAVez = f;
      const dir = repo({ comVez: true });
      assert.throws(() => esperandoAVezDoProjeto(dir), (e) => e instanceof ErroAdaptador && e.codigo === "vez-ilegivel" && re.test(e.message));
      const entrada = { filhas: FILHAS };
      assert.equal(comVezDoAdaptador(dir, entrada), entrada);
      assert.match(linhas.at(-1) ?? "", re);
      assert.match(linhas.at(-1), /todas contam como vivas/);
    }
  });
});

describe("a entrada recusa vez de tipo errado", () => {
  test("vez: 1 é problema de entrada; texto passa", () => {
    assert.deepEqual(problemasDaEntrada({ filhas: [{ sessao: "s", vez: 1 }] }), ["filhas[0].vez: 1, esperado texto"]);
    assert.deepEqual(problemasDaEntrada({ filhas: [{ sessao: "s", vez: "esperando" }] }), []);
    assert.deepEqual(problemasDaEntrada({ filhas: [{ sessao: "s" }] }), []);
  });
});
