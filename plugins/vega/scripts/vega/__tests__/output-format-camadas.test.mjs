/**
 * output-format-camadas.test.mjs — o contrato de formato em duas camadas (HN-29 T26, AC-HN29-6).
 *
 * As regras moram só no corpo (`references/output-format.md`), com exemplos neutros; o arquivo do
 * projeto aponta o corpo, traz os exemplos do domínio e não repete regra numerada. O corpo vai a
 * todo projeto, então não carrega termo clínico. Fora da fonte (a vitrine, um projeto que
 * instalou) não há arquivo do projeto a conferir: só o corpo.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { existe, lerDeclaracao } from "../declaracao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(AQUI, "..", "..", "..");
const RAIZ = path.resolve(PLUGIN, "..", "..", "..");
const NA_FONTE = existe(RAIZ) && lerDeclaracao(RAIZ).declaracao?.papel === "fonte";
const fora = !NA_FONTE && "fora da fonte: sem arquivo do projeto";

const CORPO = path.join(PLUGIN, "references", "output-format.md");
const DO_PROJETO = path.join(RAIZ, ".agents", "decisao", "output-format.md");
const CAMINHO_DO_CORPO = ".claude/skills/vega/references/output-format.md";

/** Termos do domínio clínico e regulatório, casados sem caixa no começo de palavra. */
const TERMO_CLINICO = [
  /\bcl[ií]nic/i,
  /\bpaciente/i,
  /\blaudo/i,
  /\bconv[eê]nio/i,
  /\bprontu[aá]rio/i,
  /\bm[eé]dic[oa]s?\b/i,
  /\bregulat[oó]ri/i,
  /\bLGPD\b/i,
  /\bCFM\b/,
  /\bANVISA\b/i,
  /\bCRM\b/,
  /\bsa[uú]de\b/i,
];

/** Regras numeradas do corpo: `N. **título**` no começo da linha. */
function regrasNumeradas(texto) {
  return [...texto.matchAll(/^(\d+)\. \*\*(.+?)\*\*/gm)].map((m) => ({ n: Number(m[1]), titulo: m[2] }));
}

describe("contrato de formato — corpo", () => {
  test("o corpo existe e tem as regras 1-9 numeradas", () => {
    assert.ok(existsSync(CORPO), `falta ${CORPO}`);
    const numeros = regrasNumeradas(readFileSync(CORPO, "utf8")).map((r) => r.n);
    assert.deepEqual(numeros, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("o corpo não tem termo clínico", () => {
    const linhas = readFileSync(CORPO, "utf8").split(/\r?\n/);
    const achados = [];
    linhas.forEach((linha, i) => {
      for (const re of TERMO_CLINICO) if (re.test(linha)) achados.push(`${i + 1}: ${re}`);
    });
    assert.deepEqual(achados, [], `termo clínico no corpo:\n${achados.join("\n")}`);
  });
});

describe("contrato de formato — arquivo do projeto", { skip: fora }, () => {
  test("aponta o corpo", () => {
    assert.ok(readFileSync(DO_PROJETO, "utf8").includes(CAMINHO_DO_CORPO), `não aponta ${CAMINHO_DO_CORPO}`);
  });

  test("não repete regra numerada do corpo", () => {
    const projeto = readFileSync(DO_PROJETO, "utf8");
    assert.deepEqual(regrasNumeradas(projeto), [], "regra numerada no arquivo do projeto");
    const repetidas = regrasNumeradas(readFileSync(CORPO, "utf8")).filter((r) => projeto.includes(r.titulo));
    assert.deepEqual(repetidas.map((r) => r.n), [], "título de regra do corpo repetido no arquivo do projeto");
  });

  test("traz os exemplos clínicos", () => {
    const projeto = readFileSync(DO_PROJETO, "utf8");
    assert.ok(TERMO_CLINICO.some((re) => re.test(projeto)), "arquivo do projeto sem exemplo clínico");
  });
});
