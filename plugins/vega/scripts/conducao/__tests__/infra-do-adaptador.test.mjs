/**
 * infra-do-adaptador.test.mjs — o alcance dos hooks, o brief da operária e o
 * fechamento do ciclo vêm do adaptador (HN-29 T39, AC-HN29-6).
 *
 * Com o adaptador de mentira sem os campos novos, nada que o núcleo emite
 * cita caminho, verbo ou skill de projeto. Os três testes com o adaptador da
 * Sistoli (alcance, brief e fechamento de hoje) moram na camada do OS,
 * `.vega/__tests__/sistoli.test.mjs` (HN-29 T14, D-HN29-28a).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErroAdaptador, codigoDoNucleo, validarCodigo } from "../adaptador.mjs";
import SUPERPOWERS from "../adaptadores/superpowers.mjs";
import { BOTOES } from "../botoes.mjs";
import { textoDoFechamento } from "../conducao.mjs";
import { motivoDoFechamento } from "../regras.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

const PROIBIDOS = [/packages\//, /vercel/, /estado\.mjs/, /\/close-cycle/];

function semProibido(texto, onde) {
  for (const re of PROIBIDOS) assert.ok(!re.test(texto), `${onde} cita ${re}: ${texto}`);
}

/** Adaptador de mentira mínimo: só os obrigatórios, sem `alcanceDosHooks` nem `fechamentoDoCiclo`. */
const MENTIRA = Object.freeze({
  plano: { raiz: "planos", casa: () => false, ler: () => ({}), brief: () => [] },
  publicacao: ["publicar"],
  caminhosProtegidos: [],
  telasProtegidasDosSteps: [],
  foraDasTelasDosSteps: [],
  carimbo: null,
  ci: null,
});

const FECHAMENTO = { ciclo: "X-1", repo: "/repo", sessao: "s1", conduzidas: ["F1", "F2"], exigirEncerramentos: ["F1", "ciclo"] };

test("adaptador de hoje, sem os campos novos, carrega com os defaults", () => {
  const c = validarCodigo(MENTIRA);
  assert.deepEqual([...c.alcanceDosHooks], []);
  assert.equal(c.fechamentoDoCiclo, null);
  // O do projeto de teste das suítes também não os declara.
  assert.deepEqual([...codigoDoNucleo().alcanceDosHooks], []);
  assert.equal(codigoDoNucleo().fechamentoDoCiclo, null);
});

test("campo novo presente com tipo errado recusa", () => {
  for (const [campo, valor, re] of [
    ["alcanceDosHooks", "ferramentas/**", /alcanceDosHooks: esperada lista/],
    ["alcanceDosHooks", ["ok/**", ""], /alcanceDosHooks: esperada lista/],
    ["fechamentoDoCiclo", ["/fechar"], /fechamentoDoCiclo: esperado o comando/],
    ["fechamentoDoCiclo", "fechar o ciclo", /fechamentoDoCiclo: esperado o comando/],
    ["fechamentoDoCiclo", null, /fechamentoDoCiclo: esperado o comando/],
  ])
    assert.throws(() => validarCodigo({ ...MENTIRA, [campo]: valor }), (e) => e instanceof ErroAdaptador && re.test(e.message), `${campo}=${JSON.stringify(valor)}`);
  const ok = validarCodigo({ ...MENTIRA, alcanceDosHooks: ["ferramentas/**"], fechamentoDoCiclo: "/fechar" });
  assert.deepEqual([...ok.alcanceDosHooks], ["ferramentas/**"]);
  assert.equal(ok.fechamentoDoCiclo, "/fechar");
});

test("sem os campos, nenhum glob do alcance nem texto do fechamento cita a Sistoli", () => {
  const c = validarCodigo(MENTIRA);
  for (const g of [...BOTOES.baseAlcance, ...c.alcanceDosHooks]) semProibido(g, "glob do alcance");
  const texto = textoDoFechamento({ ...FECHAMENTO, fechamento: c.fechamentoDoCiclo });
  semProibido(texto, "texto do fechamento");
  assert.equal(texto.split("\n")[0], "feche o ciclo X-1 numa sessão limpa");
  assert.equal(motivoDoFechamento(c.fechamentoDoCiclo), "fechamento-em-sessao-limpa");
  semProibido(motivoDoFechamento(c.fechamentoDoCiclo), "motivo do fechamento");
});

/** O contrato da operária do modelo do núcleo, pelo compositor do adaptador embutido (sem a árvore da Sistoli). */
function briefDoNucleo() {
  const d = mkdtempSync(path.join(tmpdir(), "infra-do-adaptador-"));
  try {
    const f = path.join(d, "fase-1.md");
    writeFileSync(f, readFileSync(path.join(AQUI, "fixtures", "exemplo-superpowers.md"), "utf8"));
    const r = spawnSync(process.execPath, validarCodigo(SUPERPOWERS).plano.brief({ canonico: f, task: "T2", nonce: "abc123", ref: "refs/conducao/fase-1/T2/1" }), { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.split("## tarefa")[0];
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

test("o modelo do contrato não nomeia publicação nem estado de projeto; o adaptador sem verbo dá o Nunca genérico", () => {
  const modelo = readFileSync(path.resolve(AQUI, "..", "..", "..", "skills", "conducao", "references", "brief-operaria.md"), "utf8");
  const contrato = modelo.split("<!-- contrato:inicio -->")[1].split("<!-- contrato:fim -->")[0];
  semProibido(contrato, "modelo do contrato");
  const nunca = contrato.split("\n").find((l) => l.startsWith("**Nunca:**"));
  assert.ok(nunca, "o modelo sem o parágrafo do Nunca");
  assert.ok(!/db push|§13/.test(nunca), `o Nunca cita verbo ou seção de projeto: ${nunca}`);
  assert.match(nunca, /\{\{PUBLICACAO\}\}/);
  const brief = briefDoNucleo();
  semProibido(brief, "brief do adaptador embutido");
  assert.match(brief, /qualquer publicação — quem publica é a maestra/);
  assert.doesNotMatch(brief, /\{\{[^}]*\}\}/);
});
