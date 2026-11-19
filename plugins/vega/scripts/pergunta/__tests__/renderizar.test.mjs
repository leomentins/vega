/**
 * renderizar.test.mjs — o renderizador do bloco (VEGA-19 T9; AC-VEGA19-1,
 * AC-VEGA19-2): a forma do contrato e a degradação acima dos limites do host.
 * Peça do corpo da fábrica, sem biblioteca de projeto (D-VEGA19-37): a ida e
 * volta pela coleta da Sistoli (`bloco-de-decisao.mjs`) e o gate de coerência
 * sobre fixture de canonico moram em `.vega/__tests__/sistoli.test.mjs`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderizar, reciboDeVega, cortar, TETO_CELULA, MAX_ITENS_NATIVO } from "../renderizar.mjs";
import { ErroForma } from "../forma.mjs";
import { carregar } from "../destinatarios.mjs";

const item = (over = {}) => ({
  titulo: "A recuperação depois de queda não tem como ser testada no servidor",
  contexto: "O teste precisa derrubar a rede, e o servidor de CI não deixa.",
  opcoes: [{ texto: "testar na estação, à mão" }, { texto: "adiar o teste para a fase de portabilidade" }],
  recomendada: "a",
  motivo: "a prova sai nesta fase",
  ...over,
});

const base = (over = {}) => ({
  sessao: "sessao-teste",
  numero: 3,
  assunto: "teste de recuperação da condução",
  papel: "operador",
  has_patient_data: false,
  itens: [item()],
  ...over,
});

const comTabela = () =>
  item({
    titulo: "O prazo da entrega troca por cobertura de teste",
    opcoes: [
      { texto: "entregar sexta sem o teste de rede", pro: "prazo mantido", contra: "recuperação sem prova" },
      { texto: "entregar segunda com o teste", pro: "prova completa", contra: "um dia útil a mais" },
    ],
    recomendada: "b",
    motivo: "a prova vale o dia",
  });

describe("renderizar — forma do contrato", () => {
  test("um item: cabeçalho singular, Dk., lista, recomendo, fecho e chave", () => {
    const { texto, degradado, nativo } = renderizar(base(), { chave: { ciclo: "ABC-12", fase: "F4", task: "T29", origem: "condutora" } });
    const linhas = texto.split("\n");
    assert.equal(linhas[0], "**Decisão de engenharia — teste de recuperação da condução**");
    assert.equal(linhas[1], "");
    assert.match(texto, /^D3\. A recuperação/m);
    assert.match(texto, /^- \(a\) testar na estação, à mão$/m);
    assert.match(texto, /^→ Recomendo \(a\) — a prova sai nesta fase$/m);
    assert.match(texto, /^Diz D3 e a letra, ou texto livre, para eu seguir\.$/m);
    assert.equal(linhas.at(-1), "<!-- decisao D3 = ABC-12/F4/T29/3 · origem condutora -->");
    assert.ok(!/\d/.test(linhas[0]), "cabeçalho sem número");
    assert.equal(degradado, false);
    assert.equal(nativo.questions.length, 1);
    // título seguido de linha em branco (D3. não é lista numerada)
    const i = linhas.findIndex((l) => l.startsWith("D3."));
    assert.equal(linhas[i + 1], "");
  });

  test("vários itens: plural, numeração corrida, fecho com a faixa, uma chave por item", () => {
    const { texto } = renderizar(base({ itens: [item(), comTabela()] }));
    assert.match(texto, /^\*\*Decisões de engenharia — /);
    assert.match(texto, /^D3\. /m);
    assert.match(texto, /^D4\. /m);
    assert.match(texto, /Diz D3-D4 e a letra, ou texto livre, para eu seguir\./);
    assert.match(texto, /<!-- decisao D3 = -\/-\/-\/3 · origem avulsa -->/);
    assert.match(texto, /<!-- decisao D4 = -\/-\/-\/4 · origem avulsa -->/);
  });

  test("tabela só no item com pró e contra, com linha em branco antes e depois", () => {
    const { texto } = renderizar(base({ itens: [item(), comTabela()] }));
    const linhas = texto.split("\n");
    const cab = linhas.indexOf("| Opção | Pró | Contra |");
    assert.ok(cab > 0);
    assert.equal(linhas.filter((l) => l === "| Opção | Pró | Contra |").length, 1, "item sem pró/contra fica em lista");
    assert.equal(linhas[cab - 1], "");
    assert.equal(linhas[cab + 1], "|---|---|---|");
    assert.equal(linhas[cab + 2], "| (a) entregar sexta sem o teste de rede | prazo mantido | recuperação sem prova |");
    assert.equal(linhas[cab + 4], "");
    assert.equal(linhas[cab + 5], "→ Recomendo (b) — a prova vale o dia");
  });

  test("teto corta o rótulo do nativo com reticência; a tabela escapa a barra", () => {
    assert.equal(TETO_CELULA > 0, true);
    const longo = "x".repeat(TETO_CELULA + 20);
    assert.equal(cortar(longo).length, TETO_CELULA);
    assert.ok(cortar(longo).endsWith("…"));
    const it = comTabela();
    const { texto } = renderizar(base({ itens: [{ ...it, opcoes: [{ ...it.opcoes[0], pro: `a | b ${longo}` }, it.opcoes[1]] }] }), { teto: 20 });
    const linha = texto.split("\n").find((l) => l.startsWith("| (a)"));
    assert.match(linha, new RegExp(`a \\\\\\| b ${longo} \\|`));
  });

  test("opcao longa sai inteira na tabela", () => {
    const op = "opção que explica com todas as letras o que muda para o operador ".repeat(3).trim();
    const pro = "pró longo que o operador precisa ler inteiro sem corte nenhum na tabela ".repeat(3).trim();
    const contra = "contra longo que também precisa sair inteiro na linha da tabela do bloco ".repeat(3).trim();
    assert.ok(op.length > 120 && pro.length > 120 && contra.length > 120);
    const r = renderizar(base({ itens: [item({ opcoes: [{ texto: op, pro, contra }, { texto: "adiar para a fase seguinte", pro: "p", contra: "c" }], recomendada: "a" })] }));
    const linha = r.texto.split("\n").find((l) => l.startsWith("| (a)"));
    assert.ok(linha.includes(op) && linha.includes(pro) && linha.includes(contra));
    assert.ok(!linha.includes("…"));
    assert.ok(r.nativo.questions[0].options[0].label.endsWith("…"));
  });

  test("_Decide:_ no item que foge do papel; sem recomendação declarada; julgamento de tela sem recomendo", () => {
    const tabela = carregar();
    const { texto } = renderizar(
      base({
        itens: [
          item({ destinatario: "responsavel-clinico" }),
          item({ titulo: "Conferência da task", recomendada: null, motivo: null, semRecomendacao: "só quem decide viu a tela" }),
          item({ titulo: "O botão some no celular", recomendada: null, motivo: null, julgamentoDeTela: true, opcoes: [{ texto: "conserta agora" }, { texto: "vira dívida" }, { texto: "aceita como está" }] }),
        ],
      }),
      { tabela },
    );
    // O titular vem da tabela de destinatários (nunca escrito aqui: o canário do corpo recusa o nome);
    // com titular declarado, a linha não pode cair no id do papel.
    const nomes = (tabela.porPapel?.["responsavel-clinico"]?.quem ?? []).map((q) => q.nome ?? q.id);
    const linhaDecide = texto.split("\n").find((l) => l.startsWith("_Decide:_ "));
    assert.ok(linhaDecide, "o item fora do papel leva a linha _Decide:_");
    if (nomes.length > 0) {
      assert.notEqual(linhaDecide, "_Decide:_ responsavel-clinico", "com titular na tabela, a linha não cai no id do papel");
      for (const n of nomes) assert.ok(linhaDecide.includes(n), `a linha _Decide:_ cita o titular da tabela (${nomes.length} declarados)`);
    } else assert.equal(linhaDecide, "_Decide:_ responsavel-clinico");
    assert.match(texto, /^Sem recomendação — só quem decide viu a tela$/m);
    const bloco5 = texto.slice(texto.indexOf("D5."));
    assert.ok(!/Recomendo/.test(bloco5.split("Diz")[0]));
  });

  test("o cabeçalho diz o mandato da rota: engenharia, societário e clínico-regulatório", () => {
    const casos = [
      ["operador", undefined, "**Decisão de engenharia — "],
      ["responsavel-clinico", undefined, "**Decisão clínico-regulatória — "],
      ["socio", "societario", "**Decisão societária — "],
      ["operador", "clinico-regulatorio", "**Decisão clínico-regulatória — "],
    ];
    for (const [papel, mandato, esperado] of casos) {
      const rota = mandato ? { para: { papel, mandato } } : undefined;
      const { texto } = renderizar(base({ papel, ...(rota ? { rota } : {}) }), { destinatarios: ["operador", "responsavel-clinico", "socio"] });
      assert.ok(texto.startsWith(esperado), `${papel}/${mandato}: ${texto.split("\n")[0]}`);
    }
    assert.ok(!/_Decide:_/.test(renderizar(base({ papel: "responsavel-clinico" })).texto));
  });

  test("o plural de cada mandato", () => {
    const itens = [item(), item({ titulo: "Outro ponto" })];
    assert.match(renderizar(base({ itens })).texto, /^\*\*Decisões de engenharia — /);
    assert.match(renderizar(base({ itens, papel: "responsavel-clinico" })).texto, /^\*\*Decisões clínico-regulatórias — /);
    assert.match(renderizar(base({ itens, papel: "socio", rota: { para: { papel: "socio", mandato: "societario" } } }), { destinatarios: ["operador", "socio"] }).texto, /^\*\*Decisões societárias — /);
  });

  test("nenhum cabeçalho velho sai: nem operador, nem responsável clínico, nem pessoa física ou jurídica", () => {
    for (const papel of ["operador", "responsavel-clinico"]) {
      const { texto } = renderizar(base({ papel, itens: [item(), item({ titulo: "Outro ponto" })] }));
      assert.ok(!/Decisões? (de operador|do responsável clínico|de pessoa)/.test(texto));
    }
  });

  test("a decisão de Vega sai no recibo, nunca como bloco de pergunta", () => {
    const linha = reciboDeVega({ titular: "Leo", regra: "ordem digitada de 18/11" });
    assert.equal(linha, "Decidido por Vega, por delegação de Leo (ordem digitada de 18/11)");
    assert.ok(!linha.includes("\n") && !/Diz D\d/.test(linha));
    assert.throws(() => reciboDeVega({ titular: "Leo", regra: "a\nb" }), ErroForma);
    assert.throws(() => reciboDeVega({ titular: "", regra: "x" }), ErroForma);
  });

  test("ponteiro e visual aparecem como referência, sem o dado", () => {
    const { texto } = renderizar(base({ has_patient_data: true, ponteiro: "harness:debito/abc-1", visual: { obrigatorio: true, caminho: "notes/visual/opcoes.png" } }));
    assert.match(texto, /^Referência: `harness:debito\/abc-1`$/m);
    assert.match(texto, /^Visual: `notes\/visual\/opcoes.png`$/m);
  });

  test("recusa: pergunta fora da forma, origem fora do vocabulário, plano na conversa", () => {
    assert.throws(() => renderizar(base({ itens: [item({ opcoes: [{ texto: "a" }, { texto: "outro caminho" }] })] })), ErroForma);
    assert.throws(() => renderizar(base(), { chave: { origem: "qualquer" } }), ErroForma);
    assert.throws(() => renderizar(base(), { chave: { ciclo: "a/b" } }), ErroForma);
    assert.throws(() => renderizar(base(), { plano: { 3: {} } }), ErroForma);
    assert.throws(() => renderizar(base(), { superficie: "slack" }), ErroForma);
  });

  test("repasse: o código da filha vai só na chave", () => {
    const { texto } = renderizar(base({ numero: 45 }), { chave: { ciclo: "ABC-12", fase: "F4", task: "T29", origem: "condutora", codigos: { 45: 3 } } });
    assert.match(texto, /Diz D45 e a letra/);
    assert.match(texto, /<!-- decisao D45 = ABC-12\/F4\/T29\/3 · origem condutora -->/);
  });

  test("a pergunta já normalizada renderiza igual à crua", () => {
    const a = renderizar(base()).texto;
    assert.equal(renderizar(base()).texto, a);
  });
});

describe("renderizar — degradação acima dos limites do host", () => {
  test("5 itens: texto sai, nativo cai, motivo dito", () => {
    const itens = Array.from({ length: MAX_ITENS_NATIVO + 1 }, (_, i) => item({ titulo: `Item ${i + 1} da decisão` }));
    const r = renderizar(base({ itens }));
    assert.equal(r.degradado, true);
    assert.equal(r.nativo, null);
    assert.match(r.motivo, /itens: 5 > 4/);
    assert.match(r.texto, /Diz D3-D4-D5-D6-D7 e a letra/);
  });

  test("5 opções num item: degrada", () => {
    const opcoes = ["um", "dois", "três", "quatro", "cinco"].map((t) => ({ texto: `caminho ${t}` }));
    const r = renderizar(base({ itens: [item({ opcoes })] }));
    assert.equal(r.degradado, true);
    assert.match(r.motivo, /D3: 5 opções > 4/);
  });

  test("4 itens de 4 opções cabem no nativo", () => {
    const opcoes = ["um", "dois", "três", "quatro"].map((t) => ({ texto: `caminho ${t}` }));
    const r = renderizar(base({ itens: Array.from({ length: 4 }, (_, i) => item({ titulo: `Item ${i}`, opcoes })) }));
    assert.equal(r.degradado, false);
    assert.equal(r.nativo.questions.length, 4);
    assert.ok(r.nativo.questions.every((q) => q.header.length <= 12 && q.options.length === 4));
    assert.match(r.nativo.questions[0].options[0].description, /recomendada/);
  });
});
