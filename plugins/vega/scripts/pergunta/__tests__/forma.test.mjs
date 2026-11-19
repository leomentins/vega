/**
 * forma.test.mjs — a forma da pergunta do corpo (VEGA-19 T7; AC-VEGA19-1,
 * AC-VEGA19-11): casos válidos, normalização e recusas; e a condução
 * construindo por ela sem mudar o que a maestra lê.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DESTINATARIOS_PADRAO, ESQUEMA_VERSAO, ErroForma, conferirPor, conteudoDaPergunta, criarPergunta, estadoComLigacoes, idDaPergunta, ligacoesDasPerguntas, mandatoDoPapel, numerosDoItem, validar } from "../forma.mjs";
import { DESTINATARIOS, ErroPergunta, decisaoDe, formaDe, perguntar } from "../../conducao/pergunta.mjs";

const base = () => ({
  sessao: "sessao-teste",
  numero: 3,
  assunto: "prazo da entrega",
  papel: "operador",
  has_patient_data: false,
  itens: [
    {
      titulo: "A entrega da semana atrasa um dia",
      contexto: "O teste de recuperação não roda no servidor.",
      opcoes: [{ texto: "testar na estação, à mão" }, { texto: "adiar o teste" }],
      recomendada: "a",
      motivo: "a prova sai nesta fase",
    },
  ],
});

describe("forma — casos válidos", () => {
  test("normaliza: versão, id opaco, letras, destinatário herdado do papel", () => {
    const p = criarPergunta(base());
    assert.equal(p.versao, ESQUEMA_VERSAO);
    assert.match(p.id, /^p-[0-9a-f]{16}$/);
    assert.equal(p.id, idDaPergunta({ sessao: "sessao-teste", numero: 3, assunto: "prazo da entrega", conteudo: p.conteudo }));
    assert.deepEqual(p.itens[0].opcoes.map((o) => o.letra), ["a", "b"]);
    assert.equal(p.itens[0].numero, 3);
    assert.equal(p.itens[0].destinatario, "operador");
    assert.deepEqual(p.visual, { obrigatorio: false, caminho: null });
    assert.equal(p.has_patient_data, false);
    assert.equal(p.ponteiro, null);
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.itens[0].opcoes[0]), "a saída é congelada");
  });

  test("o mesmo estado dá o mesmo id; outro número ou tentativa, outro id", () => {
    const a = criarPergunta(base()).id;
    assert.equal(criarPergunta(base()).id, a);
    assert.notEqual(criarPergunta({ ...base(), numero: 4 }).id, a);
    assert.notEqual(criarPergunta({ ...base(), tentativa: 2 }).id, a);
    assert.equal(criarPergunta({ ...base(), sessao: undefined, id: a }).id, a, "id explícito vale sem sessão");
  });

  test("vários itens numerados em sequência; _Decide:_ por item; pró e contra em todas as opções", () => {
    const e = base();
    e.itens.push({
      titulo: "Laudo antigo segue visível",
      destinatario: "responsavel-clinico",
      opcoes: [
        { texto: "esconder", pro: "menos confusão", contra: "perde histórico" },
        { texto: "manter", pro: "histórico", contra: "confusão" },
      ],
      recomendada: "b",
      motivo: "regulatório",
    });
    const p = criarPergunta(e);
    assert.deepEqual(p.itens.map((i) => i.numero), [3, 4]);
    assert.equal(p.itens[1].destinatario, "responsavel-clinico");
    assert.equal(p.itens[1].opcoes[0].contra, "perde histórico");
    assert.equal(p.itens[0].opcoes[0].pro, null);
  });

  test("julgamento de tela: sem recomendação; visual com caminho; paciente por ponteiro", () => {
    const e = base();
    e.itens = [{ titulo: "O botão some no celular", julgamentoDeTela: true, opcoes: [{ texto: "conserta agora" }, { texto: "vira dívida" }, { texto: "aceita como está" }] }];
    e.visual = { obrigatorio: true, caminho: ".agents/ciclo/x/visual/botao.html" };
    e.has_patient_data = true;
    e.ponteiro = "harness.decisoes#123";
    const p = criarPergunta(e);
    assert.equal(p.itens[0].recomendada, null);
    assert.equal(p.visual.caminho, ".agents/ciclo/x/visual/botao.html");
    assert.equal(p.ponteiro, "harness.decisoes#123");
  });

  test("lista de destinatários da camada da empresa substitui a padrão", () => {
    const p = criarPergunta({ ...base(), papel: "condutora" }, { destinatarios: [...DESTINATARIOS_PADRAO, "condutora"] });
    assert.equal(p.papel, "condutora");
    assert.equal(validar({ ...base(), papel: "condutora" }), "papel: esperado operador | responsavel-clinico");
  });
});

describe("forma — recusas", () => {
  const recusa = (mut, re) => {
    const e = base();
    mut(e);
    assert.throws(() => criarPergunta(e), (err) => err instanceof ErroForma && re.test(err.message));
  };

  test("visual obrigatório sem caminho em visual/ é recusado (AC-VEGA19-11)", () => {
    recusa((e) => (e.visual = { obrigatorio: true }), /visual: obrigatório sem caminho/);
    recusa((e) => (e.visual = { obrigatorio: true, caminho: "docs/tela.png" }), /visual\//);
    recusa((e) => (e.visual = { obrigatorio: true, caminho: "a/visual/" }), /visual/);
    recusa((e) => (e.visual = { caminho: "../visual/x.png" }), /segmento inválido/);
    recusa((e) => (e.visual = { caminho: "/abs/visual/x.png" }), /relativo/);
  });

  test("alternativa livre nunca listada (D-VEGA19-5)", () => {
    for (const t of ["outra", "(c) outro caminho", "Outra opção", "texto livre", "alternativa livre…", "Outro?", "Outra: diga", "Outras opções", "outros caminhos", "Outro caminho (descreva)", "Outro — texto livre", "Outra sugestão", "b) outro"]) {
      recusa((e) => e.itens[0].opcoes.push({ texto: t }), /alternativa livre não se lista/);
    }
    for (const t of ["outro prazo para a entrega", "adiar para outra fase"]) {
      const e = base();
      e.itens[0].opcoes.push({ texto: t });
      assert.ok(criarPergunta(e), `${t} é opção de verdade`);
    }
  });

  test("recomendação: obrigatória com motivo, letra existente; ausente no julgamento de tela", () => {
    recusa((e) => delete e.itens[0].recomendada, /recomendada: obrigatória/);
    recusa((e) => (e.itens[0].recomendada = "c"), /não é letra de opção/);
    recusa((e) => delete e.itens[0].motivo, /motivo: obrigatório/);
    recusa((e) => (e.itens[0].julgamentoDeTela = true), /julgamento de tela não leva recomendação/);
    recusa((e) => (e.itens[0].semRecomendacao = "x"), /juntas/);
    recusa((e) => {
      delete e.itens[0].recomendada;
      e.itens[0].semRecomendacao = "só o operador sabe";
    }, /sem recomendação não há motivo/);
  });

  test("opções: duas ou mais, letras corridas, pró com contra, todas ou nenhuma", () => {
    recusa((e) => (e.itens[0].opcoes = [{ texto: "só uma" }]), /ao menos duas opções/);
    recusa((e) => (e.itens[0].opcoes[1].letra = "c"), /esperada b/);
    recusa((e) => (e.itens[0].opcoes[0].pro = "ganho"), /pró e contra vêm juntos/);
    recusa((e) => Object.assign(e.itens[0].opcoes[0], { pro: "x", contra: "y" }), /todas as opções do item, ou em nenhuma/);
    recusa((e) => (e.itens[0].opcoes[0].texto = "duas\nlinhas"), /uma linha/);
    recusa((e) => (e.itens[0].opcoes[0].texto = "   "), /vazio/);
  });

  test("cabeçalho e numeração: papel conhecido, número positivo, itens corridos", () => {
    recusa((e) => (e.papel = "leo"), /papel: esperado/);
    recusa((e) => (e.numero = 0), /numero: esperado inteiro positivo/);
    recusa((e) => (e.itens[0].numero = 7), /numeração corrida/);
    recusa((e) => (e.itens = []), /ao menos uma decisão/);
    recusa((e) => (e.assunto = ""), /assunto: vazio/);
    recusa((e) => (e.itens[0].destinatario = "dr-fulano"), /destinatario: esperado/);
  });

  test("marca de paciente explícita; ligada exige ponteiro", () => {
    recusa((e) => delete e.has_patient_data, /marca de paciente obrigatória/);
    recusa((e) => (e.has_patient_data = "nao"), /marca de paciente obrigatória/);
    recusa((e) => (e.has_patient_data = true), /vai por ponteiro/);
    recusa((e) => Object.assign(e, { has_patient_data: true, ponteiro: "laudo de Fulano de Tal" }), /referência opaca/);
  });

  test("esquema fechado: campo desconhecido, versão alheia, id malformado, sem sessão nem id", () => {
    recusa((e) => (e.extra = 1), /campo desconhecido extra/);
    recusa((e) => (e.itens[0].peso = 1), /campo desconhecido peso/);
    recusa((e) => (e.itens[0].opcoes[0].id = "a"), /campo desconhecido id/);
    recusa((e) => (e.versao = 3), /esquema 3 desconhecido/);
    recusa((e) => (e.id = "d-123"), /id: esperado/);
    recusa((e) => delete e.sessao, /sessão é obrigatória/);
    assert.throws(() => criarPergunta(null), ErroForma);
    assert.throws(() => criarPergunta([]), ErroForma);
  });
});

describe("condução constrói pela forma, sem mudar o que lê", () => {
  test("destinatários da condução são os da forma; erro da condução é da família da forma", () => {
    assert.equal(DESTINATARIOS, DESTINATARIOS_PADRAO);
    assert.throws(() => perguntar({ motivo: "m", destinatario: "leo" }), (e) => e instanceof ErroPergunta && e instanceof ErroForma && e.name === "ErroPergunta");
    assert.throws(() => perguntar({ motivo: "m", numero: 0 }), ErroPergunta);
  });

  test("a saída e a decisão seguem com a forma de antes", () => {
    const s = perguntar({ ciclo: "ABC-1", motivo: "fase-sem-ci", numero: 5, opcoes: [{ id: "esperar", texto: "esperar o CI" }, { id: "seguir" }], recomendada: "esperar", recomendacao: "o CI decide" });
    assert.equal(s.acao, "perguntar");
    const d = decisaoDe(s);
    assert.deepEqual(Object.keys(d).sort(), ["destinatario", "id", "numero", "opcoes", "recomendada", "texto"]);
    assert.equal(d.recomendada, "esperar");
  });

  test("formaDe: a pergunta da condução vira a forma do corpo", () => {
    const s = perguntar({ ciclo: "ABC-1", motivo: "fase-sem-ci", numero: 5, destinatario: "responsavel-clinico", opcoes: [{ id: "esperar", texto: "esperar o CI" }, { id: "seguir" }], recomendada: "seguir", recomendacao: "sem CI no ramo" });
    const f = formaDe(s, { sessao: "s1", has_patient_data: false });
    assert.equal(f.versao, ESQUEMA_VERSAO);
    assert.equal(f.papel, "responsavel-clinico");
    assert.equal(f.assunto, "fase-sem-ci");
    assert.deepEqual(f.itens[0].opcoes.map((o) => [o.letra, o.texto]), [["a", "esperar o CI"], ["b", "seguir"]]);
    assert.equal(f.itens[0].recomendada, "b");
    assert.equal(f.itens[0].motivo, "sem CI no ramo");
    assert.equal(f.has_patient_data, false);
    assert.equal(f.id, formaDe(s, { sessao: "s1", has_patient_data: false }).id);
  });

  test("formaDe recusa saída sem número, sem menu ou fora do construtor", () => {
    const so = { sessao: "s", has_patient_data: false };
    assert.throws(() => formaDe(perguntar({ motivo: "m", opcoes: [{ id: "a" }, { id: "b" }] }), so), /sem número/);
    assert.throws(() => formaDe(perguntar({ motivo: "m", numero: 1 }), so), (e) => e instanceof ErroPergunta && /duas opções/.test(e.message));
    assert.throws(() => formaDe({ acao: "perguntar", motivo: "m" }, so), /construtor/);
    assert.throws(() => formaDe(perguntar({ motivo: "m", numero: 1, opcoes: [{ id: "a" }, { id: "b" }] }), { sessao: "s" }), /marca de paciente obrigatória/);
  });

  test("formaDe: sem recomendada sai semRecomendacao; motivo longo, recomendação vazia ou em linhas, tentativa ruim", () => {
    const so = { sessao: "s", has_patient_data: false };
    const conf = formaDe(perguntar({ motivo: "conferencia-do-operador", numero: 2, opcoes: [{ id: "sim" }, { id: "nao" }] }), so);
    assert.equal(conf.itens[0].recomendada, null);
    assert.equal(conf.itens[0].semRecomendacao, "só quem decide sabe");
    const longo = "m".repeat(200);
    assert.equal(formaDe(perguntar({ motivo: longo, numero: 1, opcoes: [{ id: "a" }, { id: "b" }] }), so).assunto, longo);
    const op = { numero: 1, opcoes: [{ id: "a" }, { id: "b" }], recomendada: "a" };
    assert.equal(formaDe(perguntar({ motivo: "m", ...op, recomendacao: "" }), so).itens[0].motivo, "a");
    assert.equal(formaDe(perguntar({ motivo: "m", ...op, recomendacao: "duas\nlinhas" }), so).itens[0].motivo, "duas linhas");
    const base1 = formaDe(perguntar({ motivo: "m", ...op }), so).id;
    assert.equal(formaDe(perguntar({ motivo: "m", ...op, tentativa: 0 }), so).id, base1);
    assert.equal(formaDe(perguntar({ motivo: "m", ...op, tentativa: "1" }), so).id, base1);
  });
});

describe("forma — a rota De/Por/Para (T40, D-VEGA19-54)", () => {
  const papeis = [...DESTINATARIOS_PADRAO, "condutora"];
  test("sem rota: para do papel do cabeçalho com o mandato padrão, por direto, de nulo", () => {
    assert.deepEqual(criarPergunta(base()).rota, { de: null, por: "direto", para: { papel: "operador", mandato: "engenharia", quem: "pessoa" } });
    assert.deepEqual(criarPergunta({ ...base(), papel: "responsavel-clinico" }).rota.para, { papel: "responsavel-clinico", mandato: "clinico-regulatorio", quem: "pessoa" });
    assert.equal(mandatoDoPapel("socio"), "societario");
    assert.equal(mandatoDoPapel("papel-da-camada"), "engenharia");
  });

  test("com rota: de leva a sessão da pergunta quando não traz a sua; por hub e pessoa", () => {
    const p = criarPergunta({ ...base(), rota: { de: { nivel: "neta" }, por: "hub:sessao-hub", para: { papel: "operador", mandato: "societario" } } });
    assert.deepEqual(p.rota, { de: { sessao: "sessao-teste", nivel: "neta" }, por: "hub:sessao-hub", para: { papel: "operador", mandato: "societario", quem: "pessoa" } });
    assert.equal(criarPergunta({ ...base(), rota: { por: "pessoa:leomentins" } }).rota.por, "pessoa:leomentins");
    assert.ok(Object.isFrozen(p.rota.para));
  });

  test("condutora: quem vega e mandato engenharia; pessoa ou outro mandato recusa", () => {
    const p = criarPergunta({ ...base(), papel: "condutora" }, { destinatarios: papeis });
    assert.deepEqual(p.rota.para, { papel: "condutora", mandato: "engenharia", quem: "vega" });
    assert.match(validar({ ...base(), papel: "condutora", rota: { para: { quem: "pessoa" } } }, { destinatarios: papeis }), /como vega, por delegação/);
    assert.match(validar({ ...base(), papel: "condutora", rota: { para: { mandato: "societario" } } }, { destinatarios: papeis }), /só com o mandato engenharia/);
  });

  test("recusas: vega fora da condução, nível, por, mandato, papel divergente, campo desconhecido", () => {
    assert.match(validar({ ...base(), rota: { para: { quem: "vega" } } }), /vega só no nível da condução/);
    assert.match(validar({ ...base(), rota: { de: { nivel: "outro" } } }), /rota\.de\.nivel/);
    assert.match(validar({ ...base(), rota: { por: "pelo hub" } }), /rota\.por/);
    assert.match(validar({ ...base(), rota: { por: "hub:" } }), /rota\.por/);
    assert.match(validar({ ...base(), rota: { para: { mandato: "financeiro" } } }), /rota\.para\.mandato/);
    assert.match(validar({ ...base(), rota: { para: { papel: "responsavel-clinico" } } }), /papel do cabeçalho/);
    assert.match(validar({ ...base(), rota: { via: "x" } }), /rota: campo desconhecido via/);
    assert.match(validar({ ...base(), sessao: undefined, id: "p-0123456789abcdef", rota: { de: { nivel: "neta" } } }), /rota\.de\.sessao/);
  });

  test("conferirMandato, quando vem, é chamado com a rota para e pode recusar", () => {
    const vistos = [];
    criarPergunta(base(), { conferirMandato: (para) => vistos.push(para) });
    assert.deepEqual(vistos, [{ papel: "operador", mandato: "engenharia", quem: "pessoa" }]);
    const recusa = (_p, Erro) => {
      throw new Erro("rota.para.mandato: sem titular");
    };
    assert.match(validar(base(), { conferirMandato: recusa }), /sem titular/);
    assert.equal(conferirPor(undefined), "direto");
  });
});

describe("forma — o conteúdo no id e as ligações (T45, D-VEGA19-56)", () => {
  test("v2: outro conteúdo, outro id; mesmo conteúdo com espaço ou caixa diferente, mesmo id", () => {
    const a = criarPergunta(base());
    assert.equal(a.versao, 2);
    assert.match(a.conteudo, /^[0-9a-f]{16}$/);
    const curta = base();
    curta.itens[0].opcoes[0].texto = "testar na estação";
    assert.notEqual(criarPergunta(curta).id, a.id, "opção encurtada é outro conteúdo");
    const espacada = base();
    espacada.itens[0].titulo = "  A ENTREGA da semana   atrasa um dia ";
    assert.equal(criarPergunta(espacada).id, a.id);
    const outroContexto = base();
    outroContexto.itens[0].contexto = "outro contexto";
    assert.equal(criarPergunta(outroContexto).id, a.id, "contexto fica fora do conteúdo");
  });

  test("id antigo intacto: a v1 calcula o id de antes, sem o conteúdo", () => {
    const v1 = criarPergunta({ ...base(), versao: 1 });
    assert.equal(v1.versao, 1);
    assert.equal(v1.id, idDaPergunta({ sessao: "sessao-teste", numero: 3, assunto: "prazo da entrega", versao: 1 }));
    const curta = base();
    curta.itens[0].opcoes[0].texto = "outra coisa curta";
    assert.equal(criarPergunta({ ...curta, versao: 1 }).id, v1.id, "na v1 o conteúdo não entra no id");
    assert.throws(() => idDaPergunta({ sessao: "s", numero: 1, assunto: "a" }), /conteudo: esperado/);
    assert.throws(() => criarPergunta({ ...base(), conteudo: "0000000000000000" }), /conteudo: não bate/);
    assert.equal(criarPergunta({ ...base(), conteudo: conteudoDaPergunta(base().itens) }).conteudo, conteudoDaPergunta(base().itens));
  });

  test("numerosDoItem lê D3 e D3-D5; fora da forma, vazio", () => {
    assert.deepEqual(numerosDoItem("D3"), [3]);
    assert.deepEqual(numerosDoItem("D3-D5"), [3, 4, 5]);
    assert.deepEqual(numerosDoItem("x"), []);
  });

  const ab = (id, extra = {}) => ({ evento: "abertura", pergunta_id: id, carimbo: "2026-11-18T10:00:00Z", sessao: "s1", ciclo: "ABC-1", item: "D7", ...extra });
  const resp = (id, carimbo = "2026-11-18T12:00:00Z") => ({ evento: "resposta", pergunta_id: id, carimbo });
  const P = "p-1111111111111111";
  const Q = "p-2222222222222222";
  const R = "p-3333333333333333";

  test("superada: a citada em supersedes aponta para a que a supera, mesmo respondida", () => {
    const l = ligacoesDasPerguntas([ab(P), resp(P), ab(Q, { supersedes: P, carimbo: "2026-11-18T13:00:00Z" })]);
    assert.equal(l.get(P).superada_por, Q);
    assert.equal(estadoComLigacoes("respondida", l.get(P)).estado, "superada");
    assert.equal(l.has(Q), false, "a nova sem irmã não tem ligação");
  });

  test("bifurcação por supersedes: duas com o mesmo pai; a resposta a uma faz a outra duplicada", () => {
    const evs = [ab(P), ab(Q, { supersedes: P, sessao: "s2" }), ab(R, { supersedes: P, sessao: "s3", carimbo: "2026-11-18T11:00:00Z" })];
    const sem = ligacoesDasPerguntas(evs);
    assert.deepEqual(sem.get(Q).bifurcacao, [R]);
    assert.equal(sem.get(Q).duplicada_de, null);
    const com = ligacoesDasPerguntas([...evs, resp(R)]);
    assert.equal(com.get(Q).duplicada_de, R);
    assert.equal(estadoComLigacoes("aberta", com.get(Q)).estado, "duplicada");
    assert.equal(com.get(R).duplicada_de, null, "a respondida não é duplicada");
  });

  test("bifurcação por conteúdo: mesmo conteúdo, ciclo e número de sessões diferentes; a mesma sessão não bifurca", () => {
    const c = "abcdef0123456789";
    const fork = ligacoesDasPerguntas([ab(P, { conteudo: c }), ab(Q, { conteudo: c, sessao: "s2" }), resp(P)]);
    assert.deepEqual(fork.get(Q).bifurcacao, [P]);
    assert.equal(fork.get(Q).duplicada_de, P);
    const mesma = ligacoesDasPerguntas([ab(P, { conteudo: c }), ab(Q, { conteudo: c })]);
    assert.equal(mesma.size, 0);
    const foraDeCiclo = ligacoesDasPerguntas([ab(P, { conteudo: c, ciclo: null }), ab(Q, { conteudo: c, ciclo: null, sessao: "s2" })]);
    assert.equal(foraDeCiclo.size, 0, "fora de ciclo o número é da sessão");
  });
});
