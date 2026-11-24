/**
 * consentimento-padrao-da-fabrica.test.mjs — o trazer consente os três casos
 * do VEGA-37 pelo padrão da fábrica em todo ciclo (VEGA-19 T27, D-VEGA19-29,
 * AC-VEGA19-12), `.vega/` declarado nos Outputs (D-VEGA19-32) e a decisão
 * registrada da task (D-VEGA19-33).
 *
 * A cadeia é a do `trazer` de `git-conducao.mjs`: `decidirNoTrazer`,
 * `consentidoPorDecisaoDaTask`, `registrosDoTrazer` (com o canonico e o
 * contrato do HEAD) e o gate de cada registro. O contrato usado aqui é o
 * `contrato.md` real da condução, lido do disco, e o do HEAD de um repositório
 * temporário, pelo `contratoDoHead`. Desde a VEGA-20 T43 (D-VEGA20-26) o
 * trazer só gera, dos três, a tela dos Steps; os outros dois chegam à cadeia
 * do registro explícitos, e hook, `settings*.json`, `.vega/` fora da parada e
 * workflow deixam de ser motivo.
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as c from "../consentimento.mjs";
import { decidirNoTrazer } from "../verbos.mjs";
import { caminhoDoContrato, contratoDoHead } from "../git-conducao.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CONTRATO = readFileSync(path.resolve(AQUI, "../../../skills/conducao/references/contrato.md"), "utf8");
const CICLO = "X-1";
const CANONICO = ".agents/ciclo/vega/X-1/canonico.md";
const TASK = "T27";
const HOOK = ".claude/hooks/um-hook.js";
const TESTE = ".claude/hooks/__tests__/um-hook.test.mjs";
const TELA = "apps/app/src/labs/exames/page.tsx";
const CODIGO = {
  definemAParada: ["**/hooks/gate-de-publicacao.js", "**/liberacao-da-publicacao.mjs", "db/scripts/**"],
  caminhosProtegidos: ["apps/app/src/labs/**"],
  telasProtegidasDosSteps: ["apps/app/src/labs/**"],
  foraDasTelasDosSteps: [],
  alcanceDosHooks: [],
};

function canonico({ linha = null, decisoes = [] } = {}) {
  return [
    "# X-1",
    "",
    "### 1.3 Decisões cravadas",
    "",
    "- **D-X1-28:** O trazer da condução não pergunta neste ciclo pelos três casos.",
    ...decisoes,
    "",
    "### 1.5 Modo de Execução",
    "",
    ...(linha ? [linha] : []),
    "",
    "## 3. Tasks",
    "",
  ].join("\n");
}

/**
 * Os três casos de uma vez: hook declarado, teste que o acompanha e a tela dos
 * Steps. O trazer gera só a tela (D-VEGA20-26); os outros dois chegam à cadeia
 * do registro como o caso que outro leitor grava.
 */
function decidirTres() {
  const d = decidirNoTrazer({
    caminhos: [HOOK, TESTE, TELA],
    canonico: CANONICO,
    outputs: [HOOK],
    passos: ["apps/app/src/labs/exames"],
    codigo: CODIGO,
  });
  assert.deepEqual(d.consentidos.map((x) => x.caso), [c.CASOS.telaDosSteps]);
  assert.deepEqual(d.foraDosOutputs, [TESTE, TELA]);
  return {
    ...d,
    consentidos: [
      { caso: c.CASOS.instrucaoDeclaradaEmOutputs, motivo: "alcance-dos-hooks", caminhos: [HOOK] },
      { caso: c.CASOS.testeQueAcompanhaOCodigo, motivo: "alcance-dos-hooks", caminhos: [TESTE] },
      ...d.consentidos,
    ],
  };
}

function registros({ consentidos, texto, contrato = CONTRATO }) {
  return c.registrosDoTrazer({ consentidos, canonico: texto, contrato, ciclo: CICLO, fase: "F1", task: TASK, quem: "operador", quando: "2026-11-17T00:00:00Z" });
}

test("canonico sem a linha consente os três casos pelo padrão da fábrica, sem pergunta", () => {
  const corpo = c.padraoDaFabrica(CONTRATO);
  // D-VEGA20-26: dos três, o trazer só gera a tela dos Steps, que é o caso que o padrão nomeia.
  assert.ok(corpo && corpo.includes(`\`${c.CASOS.telaDosSteps}\``), "o contrato da condução tem a seção do padrão com a tela dos Steps");
  const d = decidirTres();
  assert.deepEqual(new Set(d.consentidos.map((x) => x.caso)), new Set(c.CASOS_DO_PADRAO));
  const r = registros({ consentidos: d.consentidos, texto: canonico() });
  assert.equal(r.voltam.length, 0, "nenhum caso volta à pergunta");
  assert.equal(c.devolverAosMotivos(d.motivos, r.voltam).length, 0, "0 pergunta");
  assert.equal(r.registros.length, 3);
  for (const { registro, gate, decisao } of r.registros) {
    assert.equal(registro.sim, corpo, "grava o corpo exato do padrão");
    assert.equal(registro.origem, c.ORIGEM_DO_PADRAO);
    assert.equal(decisao, null);
    assert.deepEqual(gate({ corpo }), { recusar: false });
    assert.equal(gate({ corpo: `${corpo} ` }).recusar, true, "o gate é byte a byte");
  }
});

test("caso devolvido à pergunta pela linha pergunta", () => {
  const texto = canonico({ linha: "**Consentimentos:** `tela-dos-steps` → pergunta" });
  const d = decidirTres();
  const r = registros({ consentidos: d.consentidos, texto });
  assert.deepEqual(r.voltam.map((v) => v.caminhos).flat(), [TELA]);
  assert.deepEqual(new Set(r.registros.map((x) => x.registro.caso)), new Set([c.CASOS.instrucaoDeclaradaEmOutputs, c.CASOS.testeQueAcompanhaOCodigo]));
  const motivos = c.devolverAosMotivos(d.motivos, r.voltam);
  assert.deepEqual(motivos, [{ motivo: "caminho-clinico-fora-dos-outputs", caminhos: [TELA] }]);
});

test("settings declarado nos Outputs segue perguntando só quando registra o gate de publicação", () => {
  // D-VEGA20-26: o `settings.json` deixa de parar; só o diff que toca o registro do gate define a parada.
  const p = ".claude/settings.json";
  for (const outputs of [[p], []]) {
    const d = decidirNoTrazer({ caminhos: [p], canonico: CANONICO, outputs, codigo: CODIGO });
    assert.deepEqual([d.consentidos, d.motivos], [[], []], JSON.stringify(outputs));
    const gate = decidirNoTrazer({ caminhos: [p], canonico: CANONICO, outputs, codigo: CODIGO, registraAParada: () => true });
    assert.deepEqual(gate.motivos, [{ motivo: "define-a-parada", caminhos: [p] }]);
  }
});

test("contrato sem a seção do padrão, ou com ela duplicada, pergunta", () => {
  const semSecao = CONTRATO.replace(/^## Padrão da fábrica$/m, "## Outra seção");
  const duplicada = `${CONTRATO}\n## Padrão da fábrica\n\nnada\n`;
  const semLinha = CONTRATO.replace(/^\*\*Padrão da fábrica:\*\* /m, "Padrão: ");
  for (const contrato of [semSecao, duplicada, semLinha, "", null]) {
    assert.equal(c.padraoDaFabrica(contrato), null);
    const d = decidirTres();
    const r = registros({ consentidos: d.consentidos, texto: canonico(), contrato });
    assert.equal(r.registros.length, 0, "nenhum caso grava sem o padrão");
    assert.equal(r.voltam.length, 3, "os três casos perguntam");
  }
});

test("mapa do ciclo grava o corpo da decisão dele", () => {
  const texto = canonico({ linha: "**Consentimentos:** `instrucao-declarada-em-outputs` → D-X1-28 · `teste-que-acompanha-o-codigo` → D-X1-28 · `tela-dos-steps` → D-X1-28" });
  const r = registros({ consentidos: decidirTres().consentidos, texto });
  assert.equal(r.voltam.length, 0);
  for (const { registro, decisao } of r.registros) {
    assert.equal(decisao, "D-X1-28");
    assert.equal(registro.sim, "O trazer da condução não pergunta neste ciclo pelos três casos.");
    // D-VEGA19-39: o caso mapeado a uma decisão grava a origem = o id dela.
    assert.equal(registro.origem, "D-X1-28");
  }
  // decisão apontada que não está no canonico: o caso pergunta (D-VEGA37-34 intacto)
  const sem = registros({ consentidos: decidirTres().consentidos, texto: canonico({ linha: "**Consentimentos:** `tela-dos-steps` → D-X1-99" }) });
  assert.deepEqual(sem.voltam.map((v) => v.caminhos).flat(), [TELA]);
});

test("linha duplicada no §1.5 ou caso repetido pergunta", () => {
  const duas = canonico({ linha: "**Consentimentos:** `tela-dos-steps` → D-X1-28\n**Consentimentos:** `tela-dos-steps` → D-X1-28" });
  assert.equal(registros({ consentidos: decidirTres().consentidos, texto: duas }).voltam.length, 3);
  const repetido = canonico({ linha: "**Consentimentos:** `tela-dos-steps` → D-X1-28 · `tela-dos-steps` → pergunta" });
  const r = registros({ consentidos: decidirTres().consentidos, texto: repetido });
  assert.deepEqual(r.voltam.map((v) => v.caminhos).flat(), [TELA]);
});

test("canonico ilegível pergunta", () => {
  assert.equal(registros({ consentidos: decidirTres().consentidos, texto: "" }).voltam.length, 3);
});

test("vega declarado nos Outputs pergunta por definir a parada, dentro e fora deles", () => {
  // D-VEGA20-26: a declaração e o código do adaptador definem as paradas que ficam; contam como publicação.
  for (const p of [".vega/declaracao.json", ".vega/vigia-mode"])
    for (const outputs of [[p], []]) {
      const d = decidirNoTrazer({ caminhos: [p], canonico: CANONICO, outputs, codigo: CODIGO });
      assert.deepEqual(d.motivos, [{ motivo: "define-a-parada", caminhos: [p] }], `${p} ${JSON.stringify(outputs)}`);
      assert.deepEqual(d.consentidos, []);
    }
  assert.ok(c.SEGUEM_PERGUNTANDO.includes(".vega/**"), "a lista de quem lê fora do trazer não muda");
  assert.ok(c.DEFINEM_A_PARADA.includes(".vega/**"));
});

const CI = ".github/workflows/ci.yml";
const D30 = "- **D-X1-30:** A T27 põe o passo novo no `.github/workflows/ci.yml`.";

/**
 * A decisão registrada da task sobre motivos que já não nascem no trazer
 * (D-VEGA20-26): o workflow chega como motivo explícito, e o trazer de
 * verdade confere que não o pergunta mais.
 */
function porDecisao(caminhos, texto) {
  const d = decidirNoTrazer({ caminhos, canonico: CANONICO, outputs: caminhos, codigo: CODIGO });
  assert.deepEqual(d.motivos, [], "o workflow não pergunta mais no trazer");
  const motivos = [{ motivo: "superficie-de-instrucao", caminhos }];
  const p = c.consentidoPorDecisaoDaTask({ motivos, canonico: texto, task: TASK });
  const r = registros({ consentidos: [...d.consentidos, ...p.consentidos], texto });
  return { motivos: c.devolverAosMotivos(p.motivos, r.voltam), registros: r.registros };
}

test("decisão que cita a task e o workflow não pergunta", () => {
  const texto = canonico({ decisoes: [D30] });
  const { motivos, registros: regs } = porDecisao([CI], texto);
  assert.equal(motivos.length, 0, "0 pergunta");
  // o workflow sai por mais de um motivo (alcance e superfície de instrução): um registro por motivo, todos da mesma decisão
  assert.ok(regs.length >= 1);
  for (const { registro, gate, decisao } of regs) {
    assert.equal(registro.caso, c.CASOS.decisaoRegistradaDaTask);
    assert.equal(decisao, "D-X1-30");
    assert.equal(registro.origem, "D-X1-30");
    assert.equal(registro.sim, "A T27 põe o passo novo no `.github/workflows/ci.yml`.");
    assert.deepEqual(registro.caminhos, [CI]);
    assert.deepEqual(gate({ corpo: registro.sim }), { recusar: false });
    assert.equal(gate({ corpo: "A T27 põe o passo novo" }).recusar, true);
  }
});

test("outro workflow que a decisão não cita pergunta", () => {
  const outro = ".github/workflows/deploy.yml";
  const { motivos, registros: regs } = porDecisao([CI, outro], canonico({ decisoes: [D30] }));
  assert.deepEqual([...new Set(motivos.flatMap((m) => m.caminhos))], [outro]);
  assert.deepEqual([...new Set(regs.flatMap((r) => r.registro.caminhos))], [CI]);
});

test("decisão que não cita a task pergunta", () => {
  for (const d of ["- **D-X1-30:** A T2 põe o passo novo no `.github/workflows/ci.yml`.", "- **D-X1-30:** A T270 põe o passo novo no `.github/workflows/ci.yml`."]) {
    const { motivos, registros: regs } = porDecisao([CI], canonico({ decisoes: [d] }));
    assert.deepEqual([...new Set(motivos.flatMap((m) => m.caminhos))], [CI]);
    assert.equal(regs.length, 0);
  }
});

test("decisão da task nunca libera canonico, caminho clínico nem instrução de sessão", () => {
  const motivos = [
    { motivo: "canonico-do-ciclo", caminhos: [CANONICO] },
    { motivo: "caminho-clinico-fora-dos-outputs", caminhos: [TELA] },
    { motivo: "superficie-de-instrucao", caminhos: ["CLAUDE.md"] },
  ];
  const texto = canonico({ decisoes: [`- **D-X1-31:** A T27 muda o \`${CANONICO}\`, o \`${TELA}\` e o \`CLAUDE.md\`.`] });
  const p = c.consentidoPorDecisaoDaTask({ motivos, canonico: texto, task: TASK, instrucoes: ["CLAUDE.md"] });
  assert.equal(p.consentidos.length, 0);
  assert.deepEqual(p.motivos, motivos);
});

test("o trazer lê o contrato do HEAD", (t) => {
  const FONTE = ".claude/skills/vega/skills/conducao/references/contrato.md";
  // Na fonte, o caminho do contrato relativo à raiz do git. No corpo instalado sem `.git` (seed
  // dir, D-VEGA19-38) não há raiz: `caminhoDoContrato()` devolve null e o trazer cai no padrão
  // que pergunta. A asserção do caminho só vale quando ele existe; a leitura do HEAD segue provada
  // pelo caminho da fonte, passado explícito.
  const achado = caminhoDoContrato();
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const comGit = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: aqui, encoding: "utf8" }).status === 0;
  // null só no corpo sem `.git`; dentro de um repositório git o caminho tem de sair.
  if (comGit) assert.equal(achado, FONTE);
  else assert.equal(achado, null);
  const rel = achado ?? FONTE;
  const dir = pastaTemporaria("padrao-da-fabrica-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("config", "core.hooksPath", "/dev/null");
  writeFileSync(path.join(dir, "x.txt"), "x\n");
  g("add", "x.txt");
  g("commit", "-q", "-m", "inicio");
  assert.equal(contratoDoHead(dir, rel), "", "sem o contrato no HEAD, texto vazio: o padrão pergunta");
  mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), CONTRATO);
  assert.equal(contratoDoHead(dir, rel), "", "contrato só na árvore, fora do HEAD, não vale");
  g("add", rel);
  g("commit", "-q", "-m", "contrato");
  assert.equal(c.padraoDaFabrica(contratoDoHead(dir, rel)), c.padraoDaFabrica(CONTRATO));
  // Sem caminho (corpo sem `.git`), o padrão de fábrica não se lê: texto vazio, nunca o contrato.
  if (achado === null) assert.equal(contratoDoHead(dir), "");
});

test("restrição que não se lê pergunta em vez de cair no padrão", () => {
  for (const linha of [
    "**Consentimentos:** `tela-dos-steps` → Pergunta",
    "**Consentimentos:** `tela-dos-steps` -> pergunta",
    "**Consentimentos:** tela-dos-steps → pergunta",
    "**Consentimentos:** `tela-do-steps` → pergunta",
    "**Consentimentos:** `tela-dos-steps` ⇒ pergunta",
    "**Consentimentos:** `tela-dos-steps`: pergunta",
  ]) {
    assert.equal(c.linhaDeConsentimentos(canonico({ linha })).estado, "ilegivel", linha);
    assert.equal(registros({ consentidos: decidirTres().consentidos, texto: canonico({ linha }) }).voltam.length, 3, linha);
  }
});

test("linha de consentimentos fora do §1.5 pergunta", () => {
  const fora = canonico().replace("### 1.3 Decisões cravadas", "### 1.3 Decisões cravadas\n\n**Consentimentos:** `tela-dos-steps` → pergunta");
  assert.equal(c.linhaDeConsentimentos(fora).estado, "ilegivel");
  assert.equal(registros({ consentidos: decidirTres().consentidos, texto: fora }).voltam.length, 3);
  const semSecao = ["# X-1", "", "**Consentimentos:** `tela-dos-steps` → pergunta", ""].join("\n");
  assert.equal(c.linhaDeConsentimentos(semSecao).estado, "ilegivel");
});

test("decisão que nega, ou cita task e caminho em orações diferentes, pergunta", () => {
  for (const d of [
    "- **D-X1-30:** A T27 não pode tocar o `.github/workflows/ci.yml`.",
    "- **D-X1-30:** A T27 muda o `a.mjs`; o `.github/workflows/ci.yml` fica com a T30.",
    "- **D-X1-30:** A T27.1 põe o passo novo no `.github/workflows/ci.yml`.",
    "- **D-X1-30:** A T9 entrega o `.github/workflows/ci.yml`, e a T27 só lê o teste.",
    "- **D-X1-30:** A T27 toca tudo, exceto o `.github/workflows/ci.yml`.",
  ]) {
    const { motivos, registros: regs } = porDecisao([CI], canonico({ decisoes: [d] }));
    assert.deepEqual([...new Set(motivos.flatMap((m) => m.caminhos))], [CI], d);
    assert.equal(regs.length, 0, d);
  }
});
