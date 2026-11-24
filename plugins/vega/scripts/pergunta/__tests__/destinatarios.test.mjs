/**
 * Quem responde vem da camada da empresa, com o nível da condução (VEGA-19 T8, AC-VEGA19-1).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ErroDestinatarios,
  NIVEL_DA_CONDUCAO,
  SEMPRE_AO_OPERADOR,
  caminhosDaCamada,
  carregar,
  conferirCamada,
  conferirMandato,
  fronteiraDe,
  papelDoMandato,
  titularesDe,
  destinatarioEfetivo,
  eSessaoDeHub,
  sempreAoOperador,
  tabelaPadrao,
} from "../destinatarios.mjs";
import { DESTINATARIOS_PADRAO, ErroForma } from "../forma.mjs";
import { existe, lerDeclaracao } from "../../vega/declaracao.mjs";
import { DESTINATARIOS_DA_CONDUCAO, ErroPergunta, TABELA_DE_DESTINATARIOS, formaDe, perguntar } from "../../conducao/pergunta.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..", "..", "..", "..", "..");
const CAMADA = path.join(RAIZ, ".vega", "camadas", "empresa", ".claude", "skills", "vega", "scripts", "pergunta", "destinatarios.json");
/** Só a fonte tem a camada da empresa; fora dela (a vitrine do corpo, a cópia vazia) vale o padrão. */
const NA_FONTE = existe(RAIZ) && lerDeclaracao(RAIZ).declaracao?.papel === "fonte";
const fora = !NA_FONTE && "fora da fonte: sem camada da empresa";

const camada = (mut = () => {}) => {
  const c = {
    esquema: 1,
    papeis: {
      operador: { paridade: false },
      "responsavel-clinico": { quem: [{ id: "a", nome: "A" }, { id: "b", nome: "B" }], paridade: true },
    },
    sessoes_de_hub: ["session_hub1"],
  };
  mut(c);
  return c;
};
const recusa = (mut, re) => assert.throws(() => conferirCamada(camada(mut)), (e) => e instanceof ErroDestinatarios && re.test(e.message));

describe("a camada da empresa da fonte", { skip: fora }, () => {
  test("é a primeira candidata que existe e carrega: operador, responsável clínico com paridade, mais a condutora", () => {
    const [aoLado, naFonte] = caminhosDaCamada();
    assert.equal(naFonte, CAMADA);
    assert.ok(!aoLado.includes(`${path.sep}.vega${path.sep}`));
    const t = carregar();
    assert.equal(t.origem, "camada");
    assert.deepEqual(t.papeis, ["operador", "socio", "responsavel-clinico", NIVEL_DA_CONDUCAO]);
    assert.equal(t.porPapel.socio.paridade, true);
    assert.ok(t.fronteiras.length > 0, "a camada declara as fronteiras da §Escalation");
    const clinico = t.porPapel["responsavel-clinico"];
    assert.equal(clinico.paridade, true);
    assert.ok(clinico.quem.length >= 2, "paridade com ao menos duas pessoas");
    assert.equal(t.porPapel.operador.paridade, false);
    assert.ok(Array.isArray(t.sessoesDeHub));
    assert.ok(Object.isFrozen(t) && Object.isFrozen(t.porPapel) && Object.isFrozen(t.papeis));
  });

  test("a condução usa a tabela da camada", () => {
    assert.deepEqual(DESTINATARIOS_DA_CONDUCAO, carregar().papeis);
    assert.equal(TABELA_DE_DESTINATARIOS.origem, "camada");
  });
});

test("a condução usa a tabela carregada, com a condutora, dentro ou fora da fonte", () => {
  assert.deepEqual(DESTINATARIOS_DA_CONDUCAO, carregar().papeis);
  assert.ok(DESTINATARIOS_DA_CONDUCAO.includes(NIVEL_DA_CONDUCAO));
  assert.equal(TABELA_DE_DESTINATARIOS.origem, NA_FONTE ? "camada" : "padrao");
});

describe("leitura e conferência", () => {
  test("sem camada: os papéis da forma mais a condutora", () => {
    const dir = pastaTemporaria("dest-");
    try {
      const t = carregar({ aqui: dir, raiz: dir });
      assert.equal(t.origem, "padrao");
      assert.deepEqual(t.papeis, [...DESTINATARIOS_PADRAO, NIVEL_DA_CONDUCAO]);
      assert.deepEqual(t.sessoesDeHub, []);
      assert.deepEqual(tabelaPadrao().papeis, t.papeis);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("camada ao lado da peça vence; ilegível recusa, nunca cai no padrão; caminho explícito ausente recusa", () => {
    const dir = pastaTemporaria("dest-");
    try {
      writeFileSync(path.join(dir, "destinatarios.json"), JSON.stringify(camada((c) => (c.papeis.revisor = { paridade: false }))));
      assert.ok(carregar({ aqui: dir, raiz: dir }).papeis.includes("revisor"));
      writeFileSync(path.join(dir, "destinatarios.json"), "{ quebrado");
      assert.throws(() => carregar({ aqui: dir, raiz: dir }), (e) => e instanceof ErroDestinatarios && /JSON ilegível/.test(e.message));
      assert.throws(() => carregar({ caminho: path.join(dir, "nao-existe.json") }), (e) => e instanceof ErroDestinatarios && /não lida/.test(e.message));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("esquema fechado e recusas altas", () => {
    recusa((c) => (c.esquema = 2), /esquema: 2 desconhecido/);
    recusa((c) => (c.extra = 1), /campo desconhecido extra/);
    recusa((c) => delete c.papeis.operador, /operador é obrigatório/);
    recusa((c) => (c.papeis.condutora = { paridade: false }), /nível da condução/);
    recusa((c) => (c.papeis.Operador = { paridade: false }), /nome de papel inválido/);
    recusa((c) => (c.papeis["responsavel-clinico"].quem = [{ id: "a", nome: "A" }]), /paridade pede ao menos duas/);
    recusa((c) => (c.papeis["responsavel-clinico"].quem[1].id = "a"), /id repetido a/);
    recusa((c) => (c.papeis["responsavel-clinico"].quem[0].crm = "x"), /campo desconhecido crm/);
    recusa((c) => delete c.papeis.operador.paridade, /paridade: esperado booleano/);
    recusa((c) => (c.sessoes_de_hub = ["com espaço"]), /esperado id de sessão/);
    recusa((c) => (c.sessoes_de_hub = ["s1", "s1"]), /sessão repetida/);
    assert.ok(new ErroDestinatarios("x") instanceof ErroForma);
  });

  test("sessões de hub declaradas", () => {
    const t = conferirCamada(camada());
    assert.equal(eSessaoDeHub("session_hub1", t), true);
    assert.equal(eSessaoDeHub("session_outra", t), false);
    assert.equal(eSessaoDeHub(undefined, t), false);
  });
});

describe("o que sempre sobe ao operador nunca desce", () => {
  const t = conferirCamada(camada());

  test("os cinco motivos: guard, instruções de sessão, canonico do ciclo, caminho clínico e o que define a parada", () => {
    // D-VEGA20-26: `define-a-parada` conta como publicação e nunca desce da condutora.
    assert.deepEqual([...SEMPRE_AO_OPERADOR].sort(), ["alcance-dos-hooks", "caminho-clinico-fora-dos-outputs", "canonico-do-ciclo", "define-a-parada", "superficie-de-instrucao"]);
    for (const motivo of SEMPRE_AO_OPERADOR) {
      assert.equal(destinatarioEfetivo({ papel: NIVEL_DA_CONDUCAO, motivo }, t), "operador", motivo);
      assert.equal(destinatarioEfetivo({ papel: NIVEL_DA_CONDUCAO, motivos: ["faixa-com-merge", motivo] }, t), "operador", motivo);
    }
  });

  test("caminho que segue perguntando (settings, modo de guard, hook do git) também sobe", () => {
    for (const c of [".claude/settings.json", ".claude/state/x-guard-mode", ".husky/pre-push", "package.json"]) {
      assert.equal(sempreAoOperador({ caminhos: [c] }), true, c);
      assert.equal(destinatarioEfetivo({ papel: NIVEL_DA_CONDUCAO, motivo: "trazer", caminhos: ["a.mjs", c] }, t), "operador", c);
    }
  });

  test("o trazer e o re-plano técnico ficam com a condutora; os outros papéis não mudam", () => {
    assert.equal(destinatarioEfetivo({ papel: NIVEL_DA_CONDUCAO, motivo: "faixa-com-merge", caminhos: ["src/a.mjs"] }, t), NIVEL_DA_CONDUCAO);
    assert.equal(destinatarioEfetivo({ papel: "responsavel-clinico", motivo: "caminho-clinico-fora-dos-outputs" }, t), "responsavel-clinico");
    assert.equal(destinatarioEfetivo({}, t), "operador");
    assert.throws(() => destinatarioEfetivo({ papel: "leo" }, t), ErroDestinatarios);
  });
});

describe("a condução pela tabela", () => {
  test("perguntar aceita a condutora e devolve ao operador o que nunca desce", () => {
    assert.equal(perguntar({ motivo: "faixa-com-merge", destinatario: "condutora" }).destinatario, "condutora");
    assert.equal(perguntar({ motivo: "canonico-do-ciclo", destinatario: "condutora" }).destinatario, "operador");
    assert.equal(perguntar({ motivo: "faixa-com-merge", destinatario: "condutora", caminhos: [".claude/settings.json"] }).destinatario, "operador");
    assert.equal(perguntar({ motivo: "m" }).destinatario, undefined);
    assert.throws(() => perguntar({ motivo: "m", destinatario: "leo" }), ErroPergunta);
    assert.throws(() => perguntar({ motivo: "m", caminhos: "x" }), ErroPergunta);
  });

  test("a forma da pergunta da condução aceita a condutora como papel", () => {
    const s = perguntar({ motivo: "faixa-com-merge", destinatario: "condutora", numero: 3, opcoes: [{ id: "trazer" }, { id: "recusar" }], recomendada: "trazer" });
    const p = formaDe(s, { sessao: "s1", has_patient_data: false });
    assert.equal(p.papel, "condutora");
    assert.equal(p.itens.length, 1);
  });
});

// ── quem decide cada mandato (T42, D-VEGA19-55/60) ───────────────────────────

/** A matriz de mandatos de teste: a mesma forma da camada da fonte, com pessoas de fixture. */
const matriz = () =>
  conferirCamada({
    esquema: 1,
    papeis: {
      operador: { mandato: "engenharia", quem: [{ id: "pessoa-arq", nome: "L" }, { id: "pessoa-eng", nome: "E" }, { id: "pessoa-eng2", nome: "T" }], alcadas: { arquitetura: ["pessoa-arq"] }, paridade: false },
      socio: { mandato: "societario", quem: [{ id: "pessoa-arq", nome: "L" }, { id: "pessoa-med", nome: "Z" }, { id: "pessoa-med2", nome: "A" }], paridade: true },
      "responsavel-clinico": { mandato: "clinico-regulatorio", quem: [{ id: "pessoa-med", nome: "Z" }, { id: "pessoa-med2", nome: "A" }], paridade: true },
    },
    fronteiras: [
      { id: "cross-track", linha: "Cross-track", mandato: "engenharia", alcada: "arquitetura" },
      { id: "regulatorio", linha: "Regulatório", mandato: "clinico-regulatorio" },
      { id: "tudo-o-mais", linha: "Tudo o mais", mandato: "engenharia" },
    ],
    sessoes_de_hub: [],
  });
const delegacao = (o = {}) => ({ pergunta_id: "p-e4a5681f40f2c0f4", de: "pessoa-arq", humana: true, ...o });
const recusaMandato = (entrada, re) => assert.throws(() => conferirMandato(entrada, matriz()), (e) => e instanceof ErroDestinatarios && re.test(e.message));

describe("conferirMandato: o titular sai da matriz, e Vega só decide por delegação", () => {
  test("vega sem delegacao recusa", () => {
    recusaMandato({ quem: "vega", mandato: "engenharia" }, /vega sem delegacao/);
    recusaMandato({ quem: "vega", mandato: "engenharia", delegacao: { de: "pessoa-arq", humana: true } }, /vega sem delegacao/);
  });

  test("Vega com delegação que não aponta resposta humana recusa", () => {
    recusaMandato({ quem: "vega", mandato: "engenharia", delegacao: delegacao({ humana: false }) }, /não aponta resposta humana/);
    recusaMandato({ quem: "vega", mandato: "engenharia", delegacao: delegacao({ humana: undefined }) }, /não aponta resposta humana/);
  });

  test("Vega com delegação de quem não é titular do mandato, ou da alçada, recusa", () => {
    recusaMandato({ quem: "vega", mandato: "clinico-regulatorio", delegacao: delegacao() }, /não é titular do mandato clinico-regulatorio/);
    recusaMandato({ quem: "vega", mandato: "engenharia", alcada: "arquitetura", delegacao: delegacao({ de: "pessoa-eng" }) }, /alçada arquitetura/);
  });

  test("Vega com delegação digitada por titular grava em nome do delegante, com a delegação do registro", () => {
    const r = conferirMandato({ quem: "vega", mandato: "engenharia", delegacao: delegacao() }, matriz());
    assert.deepEqual({ ...r, delegacao: { ...r.delegacao } }, { quem: "vega", mandato: "engenharia", papel: "operador", em_nome_de: "pessoa-arq", divida: false, delegacao: { pergunta_id: "p-e4a5681f40f2c0f4" } });
    assert.throws(() => conferirMandato({ quem: "vega", mandato: "engenharia", em_nome_de: "pessoa-eng", delegacao: delegacao() }, matriz()), /delegante/);
  });

  test("mandato fora do papel recusa", () => {
    recusaMandato({ papel: "operador", quem: "pessoa", mandato: "societario", em_nome_de: "pessoa-arq" }, /fora do papel operador/);
    recusaMandato({ papel: NIVEL_DA_CONDUCAO, quem: "vega", mandato: "clinico-regulatorio", delegacao: delegacao() }, /fora do papel condutora/);
  });

  test("quem respondeu é titular: em_nome_de é o handle, sem dívida", () => {
    const r = conferirMandato({ quem: "pessoa", mandato: "clinico-regulatorio", em_nome_de: "pessoa-med" }, matriz());
    assert.equal(r.em_nome_de, "pessoa-med");
    assert.equal(r.divida, false);
    assert.equal(conferirMandato({ quem: "pessoa", mandato: "engenharia", em_nome_de: "pessoa-eng" }, matriz()).em_nome_de, "pessoa-eng");
  });

  test("quem respondeu não é titular: registrado como dívida, em nome do papel do mandato", () => {
    const casos = [
      // pessoa-arq não decide clínico-regulatório
      [{ quem: "pessoa", mandato: "clinico-regulatorio", em_nome_de: "pessoa-arq" }, "responsavel-clinico"],
      // pessoa-eng não é sócio
      [{ quem: "pessoa", mandato: "societario", em_nome_de: "pessoa-eng" }, "socio"],
      // pessoa-eng não tem a alçada de arquitetura
      [{ quem: "pessoa", mandato: "engenharia", alcada: "arquitetura", em_nome_de: "pessoa-eng" }, "operador"],
      // pessoa-med não decide engenharia
      [{ quem: "pessoa", mandato: "engenharia", em_nome_de: "pessoa-med" }, "operador"],
    ];
    assert.ok(casos.length > 0);
    for (const [entrada, papel] of casos) {
      const r = conferirMandato(entrada, matriz());
      assert.equal(r.divida, true, JSON.stringify(entrada));
      assert.equal(r.em_nome_de, papel, JSON.stringify(entrada));
      assert.equal(r.papel, papel);
    }
  });

  test("a alçada vem da linha da §Escalation e restringe o titular", () => {
    const f = fronteiraDe("cross-track", matriz());
    assert.equal(f.alcada, "arquitetura");
    assert.deepEqual(titularesDe(f, matriz()), ["pessoa-arq"]);
    assert.deepEqual(titularesDe(fronteiraDe("tudo-o-mais", matriz()), matriz()), ["pessoa-arq", "pessoa-eng", "pessoa-eng2"]);
    assert.equal(papelDoMandato("societario", matriz()), "socio");
    assert.throws(() => fronteiraDe("inexistente", matriz()), ErroDestinatarios);
  });

  test("a camada recusa mandato desconhecido, alçada fora do vocabulário e fronteira sem papel do mandato", () => {
    recusa((c) => (c.papeis.operador.mandato = "financeiro"), /mandato: esperado/);
    recusa((c) => (c.papeis.operador.alcadas = { clinica: ["a"] }), /alçada desconhecida/);
    recusa((c) => (c.papeis["responsavel-clinico"].alcadas = { arquitetura: ["zz"] }), /não está em quem/);
    recusa((c) => (c.fronteiras = [{ id: "x", linha: "X", mandato: "societario" }]), /nenhum papel da camada tem societario/);
    recusa((c) => (c.fronteiras = [{ id: "x", linha: "X", mandato: "engenharia", alcada: "clinica" }]), /alcada: esperado/);
  });
});
