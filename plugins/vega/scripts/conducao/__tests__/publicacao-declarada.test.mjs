/**
 * publicacao-declarada.test.mjs — a task que só cita o verbo de publicação e
 * declara `**Publicação:** não` não publica (VEGA-20 T40, AC-VEGA20-20).
 *
 * Leitor do plano, pelo código do adaptador deste repositório: com `não` a
 * task sai `comum` e conferível com `--publicacao nao-se-aplica` sem `--sim`;
 * sem a linha, ou com `sim`, segue sensível e parando em `publicacao-pendente`;
 * com `não` e caminho protegido nos Outputs segue sensível (em `.vega/__tests__/`).
 *
 * Os casos que dependem dos caminhos da Sistoli e do `plan-check` dela
 * (caminho protegido nos Outputs, o verbo sem a linha, migration e função de
 * borda com `não`, o canonico do VEGA-20 aceito) moram em
 * `.vega/__tests__/conducao-na-sistoli.test.mjs` (VEGA-20 T46), fora do corpo exportado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codigoDoAdaptador } from "../adaptador.mjs";
import { ErroPlano, lerPlano } from "../ler-plano.mjs";
import { politicaDaConferencia } from "../verbos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, "..", "..", "..", "..", "..", "..");
const CODIGO = codigoDoAdaptador(REPO);
const CICLO = "TESTE-40-publicacao";

function task({ steps = "roda `db push` depois da conferência", publicacao, outputs = "`src/t1.mjs` (create)" } = {}) {
  return [
    "#### T1 — tarefa T1",
    "",
    "- **Objetivo:** tarefa T1",
    "- **satisfies:** [AC-TESTE40-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** ${outputs}`,
    "- **Estação:** servidor",
    ...(publicacao === undefined ? [] : [`- **Publicação:** ${publicacao}`]),
    `- **Steps:** ${steps}`,
    "- **Verificação:** `echo ok`.",
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/T1 — tarefa T1\``,
    "",
  ].join("\n");
}

function canonico(opcoes) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-11-21",
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
    task(opcoes),
    "## 4. Pronto",
    "",
  ].join("\n");
}

const lerT1 = (opcoes) => lerPlano(canonico(opcoes), CODIGO).porId.get("T1");
const conferir = (t, extra = {}) =>
  politicaDaConferencia({ task: "T1", t, verificacao: "verde", publicacao: "nao-se-aplica", sessao: "s1", approval: () => null, ...extra });
const recusa = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof ErroPlano, String(e));
    return e.codigo;
  }
  return null;
};

test("o verbo citado com `**Publicação:** não` sai comum e conferível sem --sim", () => {
  const t = lerT1({ publicacao: "não — só cita o verbo" });
  assert.deepEqual(t.publicacao, []);
  assert.equal(t.classe, "comum");
  assert.equal(t.simProprio, null);
  assert.doesNotThrow(() => conferir(t));
});

test("o verbo citado sem a linha segue sensível e parando em publicacao-pendente", () => {
  const t = lerT1({});
  assert.ok(t.publicacao.includes("db push"));
  assert.equal(t.classe, "sensivel");
  assert.equal(recusa(() => conferir(t)), "publicacao-pendente");
});

test("o verbo citado com `**Publicação:** sim` segue sensível e parando", () => {
  const t = lerT1({ publicacao: "sim — aditiva" });
  assert.ok(t.publicacao.length > 0);
  assert.equal(t.classe, "sensivel");
  assert.equal(recusa(() => conferir(t)), "publicacao-pendente");
});
