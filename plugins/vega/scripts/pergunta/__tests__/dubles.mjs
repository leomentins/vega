// dubles.mjs — VEGA-19 T28 (D-VEGA19-37): as peças do projeto e os registros que o teste do
// comando usa no lugar das bibliotecas de um projeto. O corpo da fábrica sai sem a Sistoli; os
// testes dele também. O comando com as peças reais da Sistoli mora em `.vega/__tests__/sistoli.test.mjs`.
//
// Os dublês reproduzem só o contrato que o comando lê: o estado calculado das perguntas, o gravador
// do destino git (idempotente pela chave, recusa de dado sensível pela conta `descartadas_phi`), as
// regras de achado e dívida e a lista do dono. A forma dos eventos é a que o comando grava; o dublê
// não normaliza nada, para o teste ver o evento exatamente como saiu do comando.

/** Os destinos de achado do dublê: um subconjunto, o bastante para o comando escolher e conferir. */
export const DESTINOS_DUBLE = Object.freeze(["corrigir-agora", "debito", "descartar"]);

/** CPF formatado (sem montar o literal aqui; o teste monta o dado na hora). */
const SENSIVEL = /\d{3}\.\d{3}\.\d{3}-\d{2}/;

/** A chave de um evento: abertura e resposta, uma por pergunta; o resto, uma por carimbo. */
export function chaveDuble(ev) {
  const unico = ev.evento === "abertura" || ev.evento === "resposta";
  return unico ? `${ev.evento}|${ev.pergunta_id}` : `${ev.evento}|${ev.pergunta_id}|${ev.carimbo}|${ev.ponteiro ?? ""}`;
}

function estadoDasPerguntas(eventos) {
  const porId = new Map();
  const ordenados = [...eventos].sort((a, b) => Date.parse(a.carimbo) - Date.parse(b.carimbo));
  for (const ev of ordenados) {
    if (!porId.has(ev.pergunta_id)) porId.set(ev.pergunta_id, { abertura: null, resposta: null, dispensas: 0, destinos: [] });
    const p = porId.get(ev.pergunta_id);
    if (ev.evento === "abertura") p.abertura ??= ev;
    else if (ev.evento === "resposta") p.resposta ??= ev;
    else if (ev.evento === "dispensa") p.dispensas++;
    else if (ev.evento === "destino") p.destinos.push(ev.ponteiro);
  }
  return [...porId].map(([pergunta_id, p]) => {
    const limpar = (ev) => {
      if (!ev) return {};
      const { evento: _e, carimbo: _c, versao_esquema: _v, ...resto } = ev;
      return resto;
    };
    return {
      ...limpar(p.abertura),
      ...limpar(p.resposta),
      pergunta_id,
      estado: p.resposta ? "respondida" : p.abertura ? "aberta" : "sem-abertura",
      dispensas: p.dispensas,
      destinos: p.destinos,
    };
  });
}

function destinoDoTexto(texto) {
  const m = /^\s*`?([a-z-]+)`?(?=$|[\s·—–:,.;(])/.exec(String(texto ?? ""));
  return m && DESTINOS_DUBLE.includes(m[1]) ? m[1] : null;
}

/**
 * As peças de um projeto de mentira. `arquivos` guarda o destino git em memória
 * (`Map<arquivo, evento[]>`); `chamadas` conta as chamadas ao gravador.
 */
export function pecasDuble() {
  const arquivos = new Map();
  const chamadas = [];
  const pecas = {
    estadoDasPerguntas,
    lerDestino: (repo) => ({ destino: "git", arquivo: `${repo}/decisoes.jsonl`, repo, ausente: false }),
    gravarEventosNoGit({ arquivo, eventos }) {
      chamadas.push(eventos.map((e) => e.evento));
      if (eventos.some((e) => SENSIVEL.test(JSON.stringify(e)))) return { gravados: 0, ja_existiam: 0, descartadas_phi: eventos.length };
      const lista = arquivos.get(arquivo) ?? [];
      let gravados = 0;
      let ja_existiam = 0;
      for (const ev of eventos) {
        if (lista.some((x) => chaveDuble(x) === chaveDuble(ev))) ja_existiam++;
        else {
          lista.push(structuredClone(ev));
          gravados++;
        }
      }
      arquivos.set(arquivo, lista);
      return { gravados, ja_existiam, descartadas_phi: 0 };
    },
    lerEventosDoGit: ({ arquivo }) => ({ eventos: structuredClone(arquivos.get(arquivo) ?? []), descartadas: [] }),
    mostrarDescartadas() {},
    PORQUES_DE_DEBITO: Object.freeze(["fora-do-escopo", "sem-tempo"]),
    conferirDebito(debito, Erro) {
      if (!debito || !pecas.PORQUES_DE_DEBITO.includes(debito.porque) || !debito.severidade || !debito.gatilho) throw new Erro("divida do dublê: porque, severidade e gatilho");
      return { porque: debito.porque, porque_texto: null, severidade: debito.severidade, gatilho: debito.gatilho };
    },
    conferirDestino(destino, Erro) {
      if (!DESTINOS_DUBLE.includes(destino)) throw new Erro(`destino ${destino}: esperado ${DESTINOS_DUBLE.join(" | ")}`);
      return destino;
    },
    conferirOpcoesDeAchado(itens, Erro) {
      for (const it of itens) for (const o of it.opcoes ?? []) if (!destinoDoTexto(o.texto)) throw new Erro(`D${it.numero}${o.letra}: so destinos do contrato`);
    },
    destinoDoTexto,
    perguntasAbertas: (eventos) =>
      estadoDasPerguntas(eventos)
        .filter((p) => p.estado === "aberta")
        .map((p) => ({ pergunta_id: p.pergunta_id, item: p.item ?? null, estado: p.estado, dono: null, idade_dias: 0, caducada: false })),
    lembreteDeCaducadas: () => null,
    formatarAbertas: (abertas) => (abertas.length === 0 ? "nenhuma pergunta aberta" : abertas.map((a) => `${a.pergunta_id} · ${a.item ?? "?"} · ${a.estado}`).join("\n")),
  };
  return { pecas: Object.freeze(pecas), arquivos, chamadas };
}

/**
 * Registro do destino banco de mentira, em memória, com a forma do verbo do projeto: `fora` põe o
 * evento numa fila (marcado `na_fila`) e devolve `sem_registro`; com o registro de pé, a fila drena
 * antes de gravar ou ler. `linhas` são os eventos como o comando os mandou.
 */
export function registroBancoDuble(pecas) {
  const b = { linhas: [], fila: [], fora: false, chamadas: [] };
  const filaDe = () => ({ pendentes: b.fila.length, falhas: 0, mais_antiga: b.fila[0]?.carimbo ?? null });
  const drenar = () => {
    for (const ev of b.fila.splice(0)) {
      const { na_fila: _n, ...limpo } = ev;
      if (!b.linhas.some((x) => chaveDuble(x) === chaveDuble(limpo))) b.linhas.push(limpo);
    }
  };
  b.registro = {
    destino: "banco",
    pecas,
    async gravar(subverbo, eventos) {
      b.chamadas.push([subverbo, ...eventos.map((e) => e.evento)]);
      if (b.fora) {
        let ja_existiam = 0;
        for (const ev of eventos) {
          if (b.fila.some((x) => chaveDuble(x) === chaveDuble(ev))) ja_existiam++;
          else b.fila.push({ ...structuredClone(ev), na_fila: true });
        }
        return { gravados: 0, ja_existiam, enfileirados: eventos.length - ja_existiam, sem_registro: true, motivo: "registro fora do ar (dublê)", fila: filaDe() };
      }
      drenar();
      let gravados = 0;
      let ja_existiam = 0;
      for (const ev of eventos) {
        if (b.linhas.some((x) => chaveDuble(x) === chaveDuble(ev))) ja_existiam++;
        else {
          b.linhas.push(structuredClone(ev));
          gravados++;
        }
      }
      return { gravados, ja_existiam, enfileirados: 0, sem_registro: false, motivo: null, fila: filaDe() };
    },
    async ler({ pergunta_id = null, sessao = null } = {}) {
      if (!b.fora) drenar();
      const todos = b.fora ? [...b.linhas, ...b.fila] : b.linhas;
      const casa = (ev) => (pergunta_id ? ev.pergunta_id === pergunta_id : sessao ? ev.sessao === sessao : true);
      return { eventos: structuredClone(todos.filter(casa)), sem_registro: b.fora, motivo: b.fora ? "registro fora do ar (dublê)" : null, fila: filaDe() };
    },
  };
  return b;
}
