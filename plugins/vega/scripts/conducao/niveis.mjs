/**
 * niveis.mjs — em quantos níveis a condução roda, e o que muda em 3 (hotfix vega-conducao-niveis).
 *
 * Dois arranjos, escolhidos pelo operador no começo da condução (`conducao.mjs niveis`):
 *
 *   2 níveis  condutora → operária. A condutora cria a própria herdeira (`criar-condutora`),
 *             e cada passagem soma um elo à cadeia de sessões criadas uma pela outra.
 *   3 níveis  maestra → condutora → operária. A condutora não cria a herdeira: grava o pedido no
 *             origin (`pedir-herdeira`) e avisa a maestra (`PASSAR <fase> <nonce>`); a maestra, que
 *             é a mãe de toda condutora, a cria (`conducao.mjs maestra`). A cadeia só cresce quando a
 *             própria maestra passa o comando à herdeira dela (`passar-maestra`), na régua de janela.
 *
 * O teto da cadeia é o da plataforma: `get_session` devolve `lineage: { depth, limit }`, e
 * `create_session` recusa a sessão que já está em `depth = limit` (medido em 20/11/2026 no
 * RFCT-4: limite 8). Uma sessão em `d` cria filha em `d+1`; a operária de uma condutora em `c`
 * nasce em `c+1`, então a condutora só serve se `c+1 ≤ limit`.
 *
 * Puro: sem git e sem I/O. `nonce` e `perguntar` entram por parâmetro (os de `conducao.mjs` e
 * `pergunta.mjs`), para este módulo não importar quem o importa.
 */

/** O teto da cadeia quando a sessão não o mede (o `limit` medido em 20/11/2026). */
export const LIMITE_PADRAO = 8;

/** Fração da janela em que a maestra passa o comando (a faixa de corte de `references/janela.md`, D17a). */
export const CORTE_DA_MAESTRA = 0.4;

/** `{ depth, limit }` válido, ou `null`. */
export function linhagemValida(l) {
  const ok = (v) => Number.isSafeInteger(v) && v >= 0;
  return l && typeof l === "object" && ok(l.depth) && ok(l.limit) && l.limit >= 1 ? { depth: l.depth, limit: l.limit } : null;
}

/** `"<a>/<b>"` → `[a, b]` inteiros, ou `null`. Para `--linhagem 1/8` e `--contexto 141521/1000000`. */
export function parDeInteiros(v) {
  const m = /^(\d+)\/(\d+)$/.exec(String(v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Quantas sessões de condutora cabem a partir de uma sessão em `depth`, em 2 níveis: a
 * primeira condutora nasce dela (`depth+1`, ou é ela mesma quando `propria`), e cada
 * passagem desce um elo até a última condutora que ainda abre operária (`limit−1`).
 */
export function condutorasEmDoisNiveis({ depth, limit, propria = true }) {
  const primeira = propria ? depth : depth + 1;
  return Math.max(0, limit - 1 - primeira + 1);
}

/**
 * Quantas maestras cabem em 3 níveis a partir da primeira em `depth`: a maestra em `m` só
 * serve se a operária das condutoras dela couber (`m+2 ≤ limit`). Passagens = maestras − 1.
 */
export function maestrasEmTresNiveis({ depth, limit }) {
  return Math.max(0, limit - 2 - depth + 1);
}

/**
 * A recomendação da pergunta dos níveis (critério do operador, 20/11/2026: 3 níveis é
 * imprescindível para ciclo longo ou totalmente automático; 2 ficam para condução
 * semiautomática ou ciclo curto). Mede o ciclo pela estimativa de sessões de condutora: uma
 * por fase, mais o fechamento, mais um corte de janela por fase (a régua costuma cortar
 * fase longa uma vez) — e compara com o que 2 níveis comportam a partir desta sessão.
 */
export function recomendarNiveis({ fases, linhagem = null }) {
  const medida = linhagemValida(linhagem);
  const l = medida ?? { depth: 0, limit: LIMITE_PADRAO };
  const cabemEm2 = condutorasEmDoisNiveis({ depth: l.depth, limit: l.limit, propria: true });
  const maestras = maestrasEmTresNiveis(l);
  const conta = { cabemEm2, maestrasEm3: maestras, passagensDeMaestra: Math.max(0, maestras - 1), linhagem: l };
  // Sem o plano ou sem a cadeia medida, a conta não se faz: a pergunta sai sem recomendação,
  // com o motivo — nunca um 2 calado por falta de dado.
  if (!Number.isSafeInteger(fases) || fases < 1) return { ...conta, recomendada: null, estimadas: null, semRecomendacao: "plano-ilegivel" };
  if (!medida) return { ...conta, recomendada: null, estimadas: null, semRecomendacao: "linhagem-ausente" };
  const estimadas = fases + 1 + fases;
  return { ...conta, recomendada: estimadas > cabemEm2 ? "3" : "2", estimadas };
}

/** Linha que a condutora nascida da maestra recebe no prompt: o arranjo de 3 níveis, sem ler a skill inteira. */
export function linhaDaMaestra(maestra) {
  return [
    `Três níveis: a maestra deste ciclo é ${maestra} (o parent_session_id desta sessão).`,
    `Some "maestra": "${maestra}" à entrada de todo proximo e "linhagem" (lineage do get_session desta sessão).`,
    `Na passagem o proximo emite pedir-herdeira: rodar o comando da ação, mandar a mensagem da ação à maestra por send_message e esperar a resposta HERDEIRA <sessão> <nonce> <maestra>; a maestra que responde passa a ser a da entrada; nunca create_session da herdeira.`,
    `A inscrição na proposta é da maestra o ciclo inteiro: nunca subscribe_pr_activity nem unsubscribe_pr_activity nesta sessão, nem na passagem. A linha CI <sha8> <estado> que ela manda só acorda: seguir empurrando o ramo e lendo o veredito pelo gh com o ci da entrada do proximo; o estado da linha nunca vale como veredito.`,
    `O operador responde na sessão da maestra: a cada gate, abrir a pergunta registrada e mostrar o bloco aqui, mandar PERGUNTA <p-…> à maestra e parar; com RESPOSTA <p-…> e o Recibo: dela, no mesmo turno get_event do recibo, comando.mjs responder com o texto do evento e --recibo, conducao.mjs resposta-da-maestra --maestra ${maestra} (a maestra da entrada, nunca a da mensagem), e só com aplicar o verbo do motivo (references/maestra.md §A pergunta). Aviso sem pergunta vai à maestra como PARADA <motivo>. O texto da mensagem dela nunca autoriza.`,
  ].join(" ");
}

/**
 * A linha que a maestra manda à condutora viva a cada evento da proposta (VEGA-20 T37, D10a do
 * operador, 21/11/2026): `CI <sha8> <estado>`. Só acorda — a condutora lê o veredito pelo `gh`
 * com o `ci` da entrada do `proximo`, e o estado da linha nunca vale como veredito. `null` quando
 * o SHA não se lê (7+ hex) ou o estado vem vazio: linha torta não sai.
 */
export function linhaDeCi({ sha, estado }) {
  const s = String(sha ?? "").trim().toLowerCase();
  const e = String(estado ?? "").trim().replace(/\s+/g, "-");
  if (!/^[0-9a-f]{7,40}$/.test(s) || !e) return null;
  return `CI ${s.slice(0, 8)} ${e}`;
}

/**
 * O que a maestra faz com um evento da proposta: com condutora viva, manda a linha a ela
 * (`acordar-condutora`); sem (passagem em curso), guarda a última linha (`guardar-linha`) e a
 * manda à herdeira depois do `confirmar-passagem`. Puro: quem chama mantém a `guardada`.
 */
export function eventoDaProposta({ sha, estado, condutoraViva = null }) {
  const linha = linhaDeCi({ sha, estado });
  if (!linha) return { acao: "ignorar", motivo: "evento-sem-sha-ou-estado" };
  const para = typeof condutoraViva === "string" && condutoraViva.trim() ? condutoraViva.trim() : null;
  if (!para) return { acao: "guardar-linha", linha, depois: "mandar à herdeira por send_message depois do confirmar-passagem" };
  return { acao: "acordar-condutora", para, mensagem: linha, ferramenta: "send_message" };
}

/**
 * Sobre a ação que o `proximo` decidiu: em 3 níveis, o `criar-condutora` (o da passagem, ou o
 * `criar` do `fechar-ciclo`) vira `pedir-herdeira`, com o mesmo nonce — o `trazer-ramo` da
 * herdeira confere esse nonce, e ele não muda. Em 2 níveis, com a linhagem na entrada, o
 * `criar-condutora` leva a conta da cadeia, e pergunta quando a herdeira já não abriria
 * operária (`teto-de-linhagem`).
 */
export function comNiveis(decidida, { niveis, entrada = {}, perguntar }) {
  const criar = decidida?.acao === "criar-condutora" ? decidida : decidida?.acao === "fechar-ciclo" ? decidida.criar : null;
  if (!criar || criar.acao !== "criar-condutora") return decidida;
  const ajustada = niveis === 3 ? paraPedido(criar, entrada, perguntar) : comLinhagem(criar, entrada.linhagem, perguntar);
  if (ajustada.acao === "perguntar" || decidida.acao !== "fechar-ciclo") return ajustada;
  return { ...decidida, criar: ajustada };
}

function paraPedido(criar, entrada, perguntar) {
  const maestra = typeof entrada.maestra === "string" && entrada.maestra.trim() ? entrada.maestra.trim() : null;
  if (!maestra)
    return perguntar({
      acao: "perguntar",
      nonce: criar.nonce,
      ciclo: criar.ciclo,
      head: criar.head,
      motivo: "maestra-ausente",
      fase: criar.fase,
      detalhe:
        "o ciclo roda em 3 níveis e a entrada não diz quem é a maestra: some maestra (o parent_session_id desta sessão) e chame o proximo de novo; sessão sem mãe que roda o laço de um ciclo em 3 níveis é a própria maestra (references/maestra.md), não condutora",
    });
  const tipo = criar.sessaoLimpa ? "fechamento" : "herdeira";
  const de = typeof entrada.sessaoMaestra === "string" && entrada.sessaoMaestra.trim() ? entrada.sessaoMaestra.trim() : null;
  // Sem o id desta sessão no pedido, a maestra não teria a quem responder, e a condutora esperaria para sempre.
  if (tipo === "herdeira" && !de)
    return perguntar({
      acao: "perguntar",
      nonce: criar.nonce,
      ciclo: criar.ciclo,
      head: criar.head,
      motivo: "pedinte-ausente",
      fase: criar.fase,
      detalhe: "em 3 níveis a maestra responde à condutora que pediu: some sessaoMaestra (o id desta sessão) à entrada e chame o proximo de novo",
    });
  return {
    ...criar,
    acao: "pedir-herdeira",
    tipo,
    maestra,
    de,
    mensagem: `PASSAR ${criar.fase} ${criar.nonce}`,
    comando: `pedir-herdeira --nonce ${criar.nonce} --entrada <a mesma deste proximo>`,
    depois: tipo === "fechamento" ? "encerrar-sessao --fase ciclo, mandar a mensagem e parar" : "mandar a mensagem e esperar HERDEIRA <sessão> <nonce> <maestra>",
  };
}

function comLinhagem(criar, linhagem, perguntar) {
  const l = linhagemValida(linhagem);
  if (!l) return criar;
  // A herdeira nasce em depth+1 e abre operária em depth+2.
  if (l.depth + 2 > l.limit)
    return perguntar({
      acao: "perguntar",
      nonce: criar.nonce,
      ciclo: criar.ciclo,
      head: criar.head,
      motivo: "teto-de-linhagem",
      fase: criar.fase,
      linhagem: l,
      detalhe: `esta condutora está na profundidade ${l.depth} de ${l.limit}: a herdeira nasceria em ${l.depth + 1} e não poderia criar operária (${l.depth + 2} > ${l.limit}). Em 2 níveis cada passagem soma um elo; seguir pede abrir a condução de novo em 3 níveis (a maestra é a mãe de toda condutora) a partir de uma sessão nova do operador`,
    });
  return { ...criar, linhagem: { ...l, herdeiraEm: l.depth + 1, passagensDepois: Math.max(0, l.limit - 2 - l.depth) } };
}

/**
 * O prompt da herdeira de uma maestra: o mesmo pedido pendente (a maestra só passa ao receber um
 * `PASSAR`, então a única condutora viva é a que pediu e parou esperando), o registro das
 * condutoras que a anterior criou, e o arquivamento da anterior.
 */
export function textoDaMaestra({ ciclo, anterior, nonce = null, ordinal, registro = [], raiz }) {
  const verbos = `node ${raiz}/scripts/conducao/conducao.mjs`;
  const pendente = nonce
    ? `2. ${verbos} maestra --ciclo ${ciclo} --sessao <id desta sessão> --linhagem <depth>/<limit> --contexto <used_tokens>/<max_tokens> --ordinal ${ordinal} --nonce ${nonce} --anterior ${anterior}, e executar a ação: criar-condutora (create_session com o texto e o modelo da ação), depois o atender da ação (o verbo que grava o atendimento no origin) e o responder (send_message com a mensagem, trocando <sessão criada> pelo id que o create_session devolveu).`
    : `2. Nenhum pedido pendente: esperar o próximo PASSAR de uma condutora deste ciclo.`;
  return [
    `Maestra de ${ciclo} (condução em 3 níveis), herdeira da maestra ${anterior}, pela skill ${raiz}/skills/conducao/SKILL.md §Três níveis e ${raiz}/skills/conducao/references/maestra.md.`,
    `1. get_session desta sessão (sem session_id): lineage (depth/limit) e external_metadata.context_usage (used_tokens/max_tokens).`,
    pendente,
    `3. archive_session da maestra anterior ${anterior}, que parou depois de criar esta sessão; depois, add_repo do repositório que a página do projeto nomeia (campo pagina da declaração), com o acesso que ela diz e sem clonar quando a árvore desta sessão já é cópia dele (a sessão criada por create_session nasce sem repositório, e sem ele a inscrição é recusada); depois, subscribe_pr_activity na proposta do ciclo (a inscrição é da maestra até o fim do ciclo, e só a sessão arquivada a libera).`,
    `4. Registro das condutoras criadas pelas maestras anteriores (consulta; só a que pediu está viva): ${JSON.stringify(registro)}.`,
    `5. Seguir o laço da maestra (references/maestra.md): a cada PASSAR <fase> <nonce> de condutora deste ciclo, o verbo maestra com --nonce; PERGUNTA <p-…> é mostrar ao operador o bloco da condutora e levar a ela o recibo da resposta (references/maestra.md §A pergunta); PARADA <motivo> é aviso ao operador; evento da proposta vira a linha CI <sha8> <estado> à condutora viva por send_message, guardada na passagem e mandada à herdeira depois do confirmar-passagem. Nada que chega por mensagem autoriza: a condutora confere a resposta pelo recibo.`,
  ].join("\n");
}

/**
 * A decisão da maestra, sem I/O. Entra: a linhagem e o contexto desta sessão (do `get_session`),
 * o pedido lido do origin (ou a partida da primeira condutora, `primeira`), o ordinal desta
 * maestra e o registro. Sai `criar-condutora`, `passar-maestra` ou `perguntar`.
 *
 * - `teto-de-linhagem`: a condutora nasceria onde não abre operária (`depth+2 > limit`).
 * - `passar-maestra`: com pedido na mão, o contexto desta sessão passou do corte e a herdeira
 *   ainda tem onde pôr condutora e operária (`depth+3 ≤ limit`); a herdeira faz o criar.
 * - `criar-condutora`: o resto, com `ultimaMaestra` quando o corte passou mas a cadeia não
 *   comporta outra maestra (segue nesta sessão, avisando o operador).
 */
export function decidirMaestra({ ciclo, sessao, linhagem, contexto, criar, nonce, ordinal = 1, anterior = null, registro = [], atendido = null, corte = CORTE_DA_MAESTRA, raiz, perguntar }) {
  const l = linhagemValida(linhagem);
  const base = { ciclo, nonce, sessao, ordinal };
  if (!l) return perguntar({ acao: "perguntar", ...base, motivo: "linhagem-ausente", detalhe: "a maestra decide pela linhagem do get_session desta sessão: --linhagem <depth>/<limit>" });
  // A maestra em m passa enquanto m+3 ≤ limit: de depth até limit−3, são limit−2−depth passagens.
  const conta = { ...l, condutoraEm: l.depth + 1, operariaEm: l.depth + 2, passagensDeMaestraRestantes: Math.max(0, l.limit - 2 - l.depth) };
  // Pedido já atendido (o atendimento gravado no origin): nunca outra condutora; só repetir a resposta.
  if (atendido?.sessao)
    return {
      acao: "responder-de-novo",
      ...base,
      fase: criar.fase,
      sessaoCriada: atendido.sessao,
      responder: criar.tipo === "herdeira" && criar.de ? { para: criar.de, mensagem: `HERDEIRA ${atendido.sessao} ${nonce} ${sessao}` } : null,
      linhagem: conta,
    };
  if (criar.tipo === "herdeira" && !criar.de)
    return perguntar({ acao: "perguntar", ...base, motivo: "pedido-sem-pedinte", detalhe: "o pedido de herdeira não diz qual condutora pediu: sem ela não há a quem responder; a condutora refaz o pedido com sessaoMaestra" });
  if (l.depth + 2 > l.limit)
    return perguntar({
      acao: "perguntar",
      ...base,
      motivo: "teto-de-linhagem",
      linhagem: conta,
      detalhe: `a maestra está na profundidade ${l.depth} de ${l.limit}: a condutora nasceria em ${l.depth + 1} e a operária dela em ${l.depth + 2}, acima do teto`,
    });
  const usados = Number.isSafeInteger(contexto?.usados) ? contexto.usados : null;
  const max = Number.isSafeInteger(contexto?.max) && contexto.max > 0 ? contexto.max : null;
  // Sem o contexto a régua não se lê, e a maestra nunca passaria: pergunta, como a linhagem.
  if (!criar.primeira && (usados === null || max === null))
    return perguntar({ acao: "perguntar", ...base, motivo: "contexto-ausente", detalhe: "a maestra decide a passagem pelo context_usage do get_session desta sessão: --contexto <used_tokens>/<max_tokens>" });
  const passouDoCorte = usados !== null && max !== null && usados >= corte * max;
  const cabeOutra = l.depth + 3 <= l.limit;
  if (passouDoCorte && cabeOutra && !criar.primeira)
    return {
      acao: "passar-maestra",
      ...base,
      nome: `${ciclo} · maestra · ${ordinal + 1}`,
      modelo: null,
      linhagem: conta,
      contexto: { usados, max, corte },
      texto: textoDaMaestra({ ciclo, anterior: sessao, nonce, ordinal: ordinal + 1, registro, raiz }),
      depois: "create_session com o texto (model = o session_context.model desta sessão) e parar; a herdeira arquiva esta",
    };
  const responder = criar.tipo === "herdeira" && criar.de ? { para: criar.de, mensagem: `HERDEIRA <sessão criada> ${nonce} ${sessao}` } : null;
  // O atendimento vai ao origin antes da resposta: um PASSAR repetido não cria outra condutora.
  const atender = criar.primeira ? null : `maestra-atendeu --ciclo ${ciclo} --nonce ${nonce} --sessao-criada <sessão criada>`;
  return {
    acao: "criar-condutora",
    ...base,
    fase: criar.fase,
    nome: criar.nome,
    modelo: criar.modelo ?? null,
    tipo: criar.tipo,
    texto: `${criar.texto}\n${linhaDaMaestra(sessao)}`,
    atender,
    responder,
    ...(anterior ? { arquivarAnterior: anterior } : {}),
    linhagem: conta,
    ...(passouDoCorte && !cabeOutra
      ? { ultimaMaestra: true, aviso: `a janela desta maestra passou do corte, mas a cadeia não comporta outra maestra (${l.depth + 3} > ${l.limit}): ela segue até o fim, e o operador sabe` }
      : {}),
  };
}
