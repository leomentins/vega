/**
 * etapa.mjs — o pedido de nascimento de uma etapa do planejamento (hotfix
 * conducao-pedido-da-etapa, 23/11/2026).
 *
 * Os três caminhos de nascimento da condução: condutora → operária pelo
 * `abrir` (brief no git, `partida` curta); maestra → condutora pelo `texto` do
 * `criar-condutora`; condutora → etapa do planejamento por este verbo. As
 * etapas são skills que só rodam digitadas, e o `create_session` recusa pedido
 * que abre com `/`: o pedido é curto e em palavras ("Rode o /draft-review do
 * <ciclo>."), com o contrato de retorno embaixo. Quais etapas existem, em que
 * ordem, o tier e a saída que libera a seguinte são do projeto
 * (`etapasDoPlanejamento` do código do adaptador); o núcleo só monta o texto.
 *
 * Contrato de retorno (`references/planejar.md` §3): a primeira linha da
 * mensagem a `@parent` é `<ETAPA> <saída> <sha8>`; no gate humano, a etapa
 * abre a pergunta pelo `comando.mjs abrir`, manda `PERGUNTA <p-…>` com o bloco
 * devolvido, verbatim, e para.
 *
 * Árvore (ruling do operador, 23/11/2026): quem conduz cria o ramo e a árvore
 * do ciclo antes da primeira etapa (`arvore.mjs adotar` na própria árvore), e
 * as etapas trabalham nela por caminho absoluto, commitam e não empurram; só a
 * etapa declarada `empurra` (na Sistoli, o `/plan-review`) empurra o ramo e
 * abre a proposta em rascunho. Assim toda sessão de etapa se arquiva ao
 * terminar.
 */
import path from "node:path";
import * as adaptador from "./adaptador.mjs";
import { ErroPlano } from "./ler-plano.mjs";

/** O comando da pergunta registrada, que a etapa usa no gate humano. */
const COMANDO_DA_PERGUNTA = path.join(adaptador.RAIZ_DO_PLUGIN, "scripts", "pergunta", "comando.mjs");

/** Caminho do `comando.mjs` relativo à raiz do repositório, quando o plugin mora nele; senão absoluto. */
export function comandoDaPergunta(repo) {
  const rel = path.relative(repo, COMANDO_DA_PERGUNTA);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : COMANDO_DA_PERGUNTA;
}

/**
 * `{ acao: "criar-etapa", … }` com o `pedido` do `create_session`, o `modelo`
 * (o que a declaração mapeia para o tier da etapa; `null` com `inherit` ou sem
 * mapa) e o `contrato` estruturado. Etapa desconhecida, `--rodada` em etapa
 * sem rodadas, ou rodada fora de 1..teto ⇒ `ErroPlano`.
 */
export function pedidoDaEtapa({ repo, ciclo, etapa, rodada, arvore, ramo }) {
  if (!ciclo) throw new ErroPlano("uso", "etapa exige --ciclo <id>");
  if (!arvore || !path.isAbsolute(arvore)) throw new ErroPlano("uso", "etapa exige a árvore do ciclo (caminho absoluto)");
  // Ciclo declarado sem ramo (`semRamo`): a árvore é a do ramo local da condução, e ciclo-<id> não conta.
  const modo = adaptador.modoDoCiclo(repo, ciclo);
  if (modo.semRamo ? ramo !== modo.ramo : !ramo || !(ramo === `ciclo-${ciclo}` || ramo.startsWith(`ciclo-${ciclo}-`)))
    throw new ErroPlano(
      "arvore-sem-ramo-do-ciclo",
      modo.semRamo
        ? `a árvore ${arvore} está em ${ramo || "HEAD destacado"}, e ${ciclo} é conduzido sem ramo de ciclo, no ramo local ${modo.ramo} que sobe ao ${modo.principal}: abra a árvore nele antes da primeira etapa (git switch ${modo.ramo}; sem ele, git switch --no-track -c ${modo.ramo} origin/${modo.principal})`
        : `a árvore ${arvore} está em ${ramo || "HEAD destacado"}, não no ramo ciclo-${ciclo}: adote-a antes da primeira etapa (arvore.mjs adotar --ciclo ${ciclo})`,
    );
  const decl = adaptador.lerAdaptador(repo);
  const etapas = adaptador.codigoDoAdaptador(repo).etapasDoPlanejamento ?? [];
  if (!etapas.length) throw new ErroPlano("sem-etapas", "o código do adaptador não declara etapasDoPlanejamento");
  const e = etapas.find((x) => x.id === etapa);
  if (!e) throw new ErroPlano("uso", `etapa exige uma de ${etapas.map((x) => x.id).join(" | ")} (veio ${etapa ?? "nada"})`);
  let n = null;
  if (e.rodadas !== undefined) {
    n = rodada === undefined ? 1 : rodada;
    if (!Number.isInteger(n) || n < 1) throw new ErroPlano("uso", "--rodada exige inteiro >= 1");
    if (n > e.rodadas) throw new ErroPlano("teto-da-etapa", `${e.id} tem teto de ${e.rodadas} rodadas; a rodada ${n} sobe ao operador`);
  } else if (rodada !== undefined) throw new ErroPlano("uso", `${e.id} não roda em rodadas: sem --rodada`);

  const ETAPA = e.id.toUpperCase();
  const mapeado = e.tier === "inherit" ? null : (decl.tiers?.[e.tier] ?? null);
  const modelo = mapeado === "inherit" ? null : mapeado;
  // Absoluto dentro da árvore do ciclo: a etapa roda de outra pasta (a da sessão dela).
  const relativo = comandoDaPergunta(repo);
  const comando = path.isAbsolute(relativo) ? relativo : path.join(arvore, relativo);
  const aviso = `${ETAPA} <saída> <sha8>`;
  const abertura = `Rode o ${e.comando} do ${ciclo}${n === null ? "" : `, rodada ${n} de ${e.rodadas}`}.`;
  const pedido = [
    abertura,
    "",
    "Contrato de retorno (a sessão que te criou é @parent; fale com ela por send_message):",
    `- Ao terminar, a primeira linha da mensagem é \`${aviso}\`: a saída da etapa (\`${e.saida}\` libera a seguinte) e o sha8 do commit que a grava no ramo do ciclo.`,
    `- Gate humano: abra a pergunta pelo \`node ${comando} abrir\`, mande a @parent \`PERGUNTA <p-…>\` com o bloco devolvido, verbatim, e pare. A resposta do operador volta por send_message com \`Recibo:\`: confira-a por \`get_event\` e grave-a por \`node ${comando} responder --recibo\` antes de seguir.`,
    "- Não se arquive: quem arquiva é a sessão que te criou.",
  ].join("\n");
  const arvoreLinhas = [
    `Árvore do ciclo: \`${arvore}\` (ramo \`${ramo}\`), criada por quem te criou. Trabalhe nela por caminho absoluto (\`git -C "${arvore}"\`); não crie outra árvore nem outro ramo.`,
    e.empurra
      ? modo.semRamo
        ? `Você é a etapa que empurra: ao terminar, \`git -C "${arvore}" push origin HEAD:refs/heads/${modo.principal}\`, sem força e sem proposta (o ciclo é conduzido sem ramo de ciclo: o ramo local ${ramo} sobe ao ${modo.principal}; nunca empurre o ${ramo} como ramo). Recusado por não ser avanço rápido ⇒ \`git -C "${arvore}" fetch origin ${modo.principal}\` e \`git -C "${arvore}" merge origin/${modo.principal}\`, nunca rebase nem força, e empurre de novo; o sha8 do aviso é o empurrado.`
        : `Você é a etapa que empurra: ao terminar, \`git -C "${arvore}" push -u origin ${ramo}\` e, se o ramo ainda não tem proposta, \`gh pr create --draft --head ${ramo}\`; o sha8 do aviso é o empurrado.`
      : "Commite no ramo e não empurre: quem empurra é a última etapa do planejamento.",
  ].join("\n");
  const pedidoCompleto = `${pedido}\n\n${arvoreLinhas}`;
  // O `create_session` recusa pedido que abre com `/`; a forma acima nunca abre, e a guarda prova.
  if (/^\s*\//.test(pedidoCompleto)) throw new ErroPlano("pedido-com-barra", "o pedido da etapa abriria com /");
  return {
    acao: "criar-etapa",
    ciclo,
    etapa: e.id,
    comando: e.comando,
    ...(n === null ? {} : { rodada: n, teto: e.rodadas }),
    nome: `${ciclo} · plano · ${e.id}${n === null || n < 2 ? "" : ` · r${n}`}`,
    tier: e.tier,
    modelo,
    ...(e.tier !== "inherit" && !mapeado ? { aviso: `a declaração não mapeia o tier ${e.tier}; a etapa nasce com o modelo de quem a cria` } : {}),
    arvore,
    ramo,
    empurra: !!e.empurra,
    pedido: pedidoCompleto,
    contrato: { linha: aviso, saida: e.saida, pergunta: "PERGUNTA <p-…>", comandoDaPergunta: `node ${comando} abrir`, empurra: !!e.empurra },
  };
}
