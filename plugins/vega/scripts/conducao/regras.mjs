/**
 * regras.mjs — regras nomeadas da decisão do `proximo` (VEGA-29 T6, T7).
 *
 * Cada regra é `(ctx) => ação | null`: devolve a ação que decide ou null para
 * a seguinte falar. Puras, sem git nem fs. `decidir` (conducao.mjs) fica só
 * com a lista ordenada delas (`ORDEM_DAS_REGRAS`) e o laço: monta o contexto
 * por `contextoDaDecisao` e devolve a primeira ação. A ordem é o contrato —
 * as de mais adiante assumem que as anteriores calaram (a fase em curso já
 * autorizada, a vigia já preencheu `reabrir`).
 *
 * Campos do contexto (os de `contextoDaDecisao`):
 *   ciclo, head, planoBlob — o que toda ação carrega;
 *   acao(tipo, alvo, tentativa, campos) — monta a ação com o nonce do HEAD;
 *   nonce, lerAviso e os auxiliares do plano (`diferencaDoPlano`,
 *     `mudancasQuePerguntam`, `mudancasDeAlcance`, `rulingDoReplano`,
 *     `replanoSozinho`, `reciboDeVega`, `nomeDoOperador`,
 *     `tasksQueMudaramDeClasse`, `textoDaProximaSessao`, `textoDoFechamento`,
 *     `fechamentoDoCiclo`)
 *     — os de conducao.mjs e ler-plano.mjs, injetados para o núcleo não
 *     importar o CLI;
 *   e os campos próprios de cada regra, no comentário dela.
 */

import { CASOS, RESTRICAO_PERGUNTA, linhaDeConsentimentos, pedidoDeCaso, sensivelAditivaNaOrdem, simDaPublicacaoDoCiclo } from "./consentimento.mjs";
import { casaAlgum } from "./ler-plano.mjs";
import { TABELA_DE_DESTINATARIOS } from "./pergunta.mjs";
import { camposDaPergunta, destinatarioDaPerguntaDaFilha } from "../pergunta/destinatarios.mjs";
import { blocoDaTask } from "./verbos.mjs";

/**
 * Motivo da espera depois do encerramento do ciclo (HN-29 T39): o comando de
 * fechamento do projeto (`fechamentoDoCiclo` do adaptador, sem a barra) mais
 * `-em-sessao-limpa`; sem o comando, o neutro `fechamento-em-sessao-limpa`.
 */
export function motivoDoFechamento(comando) {
  const nome = String(comando ?? "").replace(/^\/+/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${nome || "fechamento"}-em-sessao-limpa`;
}

/** O motivo do fechamento pelo comando que o contexto injeta (`fechamentoDoCiclo`); sem injeção, o neutro. */
function motivoDoCtx(ctx) {
  return motivoDoFechamento(typeof ctx.fechamentoDoCiclo === "function" ? ctx.fechamentoDoCiclo() : null);
}

function intersecta(a, b) {
  return a.some((x) => b.includes(x));
}

/**
 * Rede de arquivamento (D-VEGA22-25), antes de toda outra ação — libera a
 * vaga do teto antes de abrir. Só filha que avisou e cuja tentativa já foi
 * decidida (conferida, falha gravada ou revertida): sem aviso ela pode estar
 * empurrando. O nonce não depende do HEAD, para a mesma sessão e tentativa
 * darem sempre o mesmo `arquivar`; `arquivamentos` é a lista de nonces de
 * `arquivar` que a maestra já executou nela.
 *
 * Lê: `filhas` (com `estado` já normalizado), `decididos` (Set de nonces).
 */
export function regraArquivar(ctx) {
  const { ciclo, head, planoBlob, acao, nonce, lerAviso, filhas, decididos } = ctx;
  for (const f of filhas) {
    if (f.estado === "ARCHIVED" || !f.sessao) continue;
    const a = lerAviso(f.aviso);
    if (!a || a.nonce !== f.nonce || !decididos.has(a.nonce)) continue;
    const n = nonce(ciclo, `arquivar:${f.sessao}`, a.nonce, "");
    const campos = { sessao: f.sessao, task: a.task, tentativa: f.tentativa ?? null, nonceTentativa: a.nonce, aviso: a.tipo };
    const vezes = (Array.isArray(f.arquivamentos) ? f.arquivamentos : []).filter((x) => x === n).length;
    if (vezes >= 2) return acao("perguntar", `arquivar:${f.sessao}`, a.nonce, { ...campos, motivo: "falha-de-arquivamento", nonceArquivar: n, vezes });
    return { acao: "arquivar", nonce: n, ciclo, head, plano: planoBlob, ...campos };
  }
  return null;
}

/**
 * A task publica e o ciclo ainda não tem o caso `publicacao-do-ciclo`: a
 * primeira publicação do ciclo pede o sim; as seguintes, não (D-VEGA37-52).
 */
function pedeSimParaPublicar(ctx, t) {
  return t.publicacao.length > 0 && !simDaPublicacaoDoCiclo({ consentimentos: ctx.consentimentos ?? [], ciclo: ctx.ciclo });
}

/**
 * Trazer vence as perguntas da vigia: a primeira tentativa em voo, na ordem
 * das tasks da fase, com marcador válido e aviso `T<k>-OK` da filha dela.
 *
 * Lê: `fase`, `voo` (`[{ t, r }]` — task do plano e tentativa em voo), `filhas`, `consentimentos`.
 */
export function regraTrazer(ctx) {
  const { acao, lerAviso, fase, voo, filhas } = ctx;
  for (const { t, r } of voo) {
    if (!r.nonce) continue;
    const ok = filhas
      .filter((f) => f.nonce === r.nonce)
      .map((f) => ({ f, a: lerAviso(f.aviso) }))
      .find(({ a }) => a && a.task === t.id && a.nonce === r.nonce && a.tipo === "OK");
    if (!ok) continue;
    return acao("trazer", t.id, r.tentativa, {
      fase: fase.id,
      task: t.id,
      tentativa: r.tentativa,
      nonceTentativa: r.nonce,
      sha: ok.a.arg,
      sessao: ok.f.sessao ?? null,
      ref: r.ref,
      // Subpasso Publicar: o sim da fase não cobre a publicação (F4.17); a primeira do
      // ciclo pede o sim, e o caso `publicacao-do-ciclo` cobre as seguintes (D-VEGA37-52).
      publicacao: t.publicacao,
      simParaPublicar: pedeSimParaPublicar(ctx, t),
    });
  }
  return null;
}

/** A filha está esperando a vez na fila de builds: `vez` é o último estado dela lá. */
function naEsperaDaVez(f) {
  return typeof f.vez === "string" && f.vez.trim().toLowerCase() === "esperando";
}

/**
 * Vagas para abrir: o menor entre a largura do ciclo menos as tentativas em
 * voo ativas e o teto da ponte menos as filhas vivas. Filha cujo último estado
 * é a espera da fila de builds (`vez: "esperando"`, de `vez-de-build.mjs`) não
 * conta como viva (HN-29 T25): o build dela só roda quando a máquina cabe, e
 * contá-la seguraria a vaga de uma task que não builda. A tentativa dela segue
 * em voo: a largura e os Outputs continuam ocupados.
 *
 * Lê: `filhas`, `tetoPonte` (da entrada, ou null), `tetoPadrao`, `largura`, `vooAtivo`.
 */
export function vagasDoTeto({ filhas, tetoPonte, tetoPadrao, largura, vooAtivo }) {
  const vivas = filhas.filter((f) => f.estado !== "ARCHIVED" && !naEsperaDaVez(f)).length;
  const teto = Number.isInteger(tetoPonte) ? tetoPonte : tetoPadrao;
  const vagas = Math.max(0, Math.min(largura - vooAtivo.length, teto - vivas));
  return { vivas, teto, vagas };
}

/**
 * O modelo da filha: o que a declaração mapeia para o tier da task (`tiers`
 * do adaptador), senão o `**Modelo:**` da fase. Task sem tier, em `inherit`
 * ou em tier que o mapa não traz fica com o da fase; o núcleo só repete o
 * texto declarado, nunca escolhe modelo. `semMapa` marca o tier declarado
 * que o mapa não traz: o `abrir` avisa o operador.
 */
export function modeloDaTask(t, modeloDaFase, tiers = {}) {
  const tier = t.tier;
  if (!tier || tier === "inherit") return { modelo: modeloDaFase, semMapa: false };
  const mapeado = typeof tiers?.[tier] === "string" && tiers[tier].trim() ? tiers[tier] : null;
  if (!mapeado || mapeado === "inherit") return { modelo: modeloDaFase, semMapa: !mapeado };
  return { modelo: mapeado, semMapa: false };
}

/**
 * Abrir as tasks de servidor prontas que cabem nas vagas, sem Outputs em
 * comum com as em voo nem entre si; as a reabrir vêm na frente de `servidor`.
 * Task sensível sai coberta pelo sim em vigor na fase (o dela ou o do ciclo,
 * herdado); só a que pede o sim de novo (`simProprio`: caminho clínico ou
 * publicação que altera, D18a) pergunta, uma vez por task, fora do sim dado à
 * fase — a aprovação vale para a task em toda tentativa.
 *
 * Lê: `plano` (`fases`, `porId`, `largura`), `fase`, `servidor`, `vooAtivo`,
 * `reabrir` (Map task → tentativa que caiu), `maxTent` (Map task → última
 * tentativa), `filhas`, `tetoPonte`, `tetoPadrao`, `cobertaPelaFase`,
 * `aprovacoes`, `ultimaAutorizacao`, `tiers` (o mapa tier → modelo da
 * declaração; ausente ⇒ toda filha nasce com o modelo da fase).
 */
export function regraAbrir(ctx) {
  const { ciclo, head, acao, nonce, plano, fase, servidor, vooAtivo, reabrir, maxTent, cobertaPelaFase, aprovacoes, ultimaAutorizacao, tiers = {} } = ctx;
  const { vivas, teto, vagas } = vagasDoTeto({ ...ctx, largura: plano.largura });

  const ocupados = vooAtivo.flatMap(({ t }) => t.outputs);
  const selecionadas = [];
  for (const t of servidor) {
    if (selecionadas.length >= vagas) break;
    if (intersecta(t.outputs, ocupados)) continue;
    selecionadas.push(t);
    ocupados.push(...t.outputs);
  }
  if (!selecionadas.length) return null;

  const fase0 = plano.fases.find((f) => f.id === fase.id);
  const semMapa = [];
  const tarefas = selecionadas.map((t) => {
    const tentativa = (maxTent.get(t.id) ?? 0) + 1;
    const anterior = reabrir.get(t.id);
    const m = modeloDaTask(t, fase0.modelo, tiers);
    if (m.semMapa) semMapa.push(t);
    return {
      task: t.id,
      tentativa,
      nonce: nonce(ciclo, t.id, tentativa, head),
      modelo: m.modelo,
      prazoMin: t.prazoMin,
      posMerge: t.posMerge,
      classe: t.classe,
      // `abrir --falhou <n> --coberta <sim|nao|ambiente|pergunta>` grava a falha antes do marcador.
      ...(anterior ? { falhaAnterior: anterior } : {}),
    };
  });
  const avisoOperador = tarefas
    .filter((x) => x.falhaAnterior?.coberta === "sim")
    .map((x) => `${x.task} tentativa ${x.falhaAnterior.tentativa} caiu no reinício da ponte; reaberta como ${x.tentativa}, sem contar falha`)
    .concat(semMapa.map((t) => `${t.id} declara o tier ${t.tier}, que a declaração não mapeia; abre com o modelo da fase`));
  const pendente = cobertaPelaFase
    ? null
    : tarefas.find((x) => x.classe === "sensivel" && pedeSimDeNovo(plano.porId.get(x.task), aprovacoes));
  if (pendente) return perguntaSensivelDaFase(ctx, plano.porId.get(pendente.task), pendente.tentativa);
  const alvo = tarefas.map((x) => x.task).join("+");
  const sensiveis = tarefas.filter((x) => x.classe === "sensivel").map((x) => x.task);
  return acao("abrir", alvo, tarefas.map((x) => x.tentativa).join("+"), {
    fase: fase.id,
    tarefas,
    ...(sensiveis.length && cobertaPelaFase ? { cobertasPelaFase: { autorizacao: ultimaAutorizacao.sha, tasks: sensiveis } } : {}),
    ...(sensiveis.length && !cobertaPelaFase && ultimaAutorizacao ? { cobertasPeloCiclo: { autorizacao: ultimaAutorizacao.sha, tasks: sensiveis } } : {}),
    largura: { prontas: servidor.length, ciclo: plano.largura, teto, vivas, emVoo: vooAtivo.length, abertas: tarefas.length },
    ...(avisoOperador.length ? { avisoOperador } : {}),
  });
}

/**
 * A pergunta `task-sensivel`, uma por fase (hotfix conducao-corta-paradas-de-regra, D3b do brainstorm
 * do VEGA-20): lista pelo nome toda task da fase que ainda pede o sim próprio (`tasks`), a que puxou a
 * pergunta primeiro, e o sim dado nela vale para todas — a condutora grava uma aprovação por task
 * listada. `task`, `porque`, `publicacao` e `caminhosProtegidos` seguem os da primeira, como antes.
 */
function perguntaSensivelDaFase(ctx, t, tentativa) {
  const { acao, plano, fase, aprovacoes, feita } = ctx;
  const outras = (fase.tasks ?? [])
    .map((id) => plano.porId.get(id))
    .filter((x) => x && x.id !== t.id && !(typeof feita === "function" && feita(x.id)) && pedeSimDeNovo(x, aprovacoes));
  const tasks = [t, ...outras].map((x) => ({ task: x.id, porque: x.simProprio, publicacao: x.publicacao, caminhosProtegidos: x.protegida }));
  // O nonce é o da tentativa da primeira (o `abrir` sai com ele); o sim dado nele vale para as listadas.
  return acao("perguntar", t.id, tentativa, {
    motivo: "task-sensivel",
    fase: fase.id,
    task: t.id,
    tentativa,
    porque: t.simProprio,
    publicacao: t.publicacao,
    caminhosProtegidos: t.protegida,
    tasks,
  });
}

/**
 * As tasks da fase `f` (do plano `p`) que pedem o sim próprio ao entrar por herança (`simProprio`):
 * vão pelo nome no sim e no aviso da fase, nunca caladas.
 */
function sensiveisDaFase(p, f) {
  return (p?.fases.find((x) => x.id === f.id)?.tasks ?? []).filter((id) => p.porId.get(id)?.simProprio);
}

/**
 * A task sensível fora do sim dado à fase pede o sim de novo só com
 * `simProprio` (D18a) e sem aprovação dela — por task, nunca pelo nonce da
 * tentativa: o sim dado na tentativa 1 cobre a 2 (caso da T10 do VEGA-19).
 */
function pedeSimDeNovo(t, aprovacoes) {
  return Boolean(t?.simProprio) && !aprovacoes.some((a) => a.task === t.id);
}

// ── o contexto ──────────────────────────────────────────────────────────────

/**
 * Veredito do CI lido pela maestra, só quando é do HEAD: `verde` · `vermelho`
 * · null (ausente, em curso, de outro sha ou fora da forma `{ sha, veredito, run }`).
 */
function ciDoHead(ci, head) {
  if (!ci || typeof ci !== "object") return null;
  if (typeof ci.sha !== "string" || ci.sha.length < 7 || !head.startsWith(ci.sha)) return null;
  return ci.veredito === "verde" || ci.veredito === "vermelho" ? ci.veredito : null;
}

/**
 * O veredito que fecha fase e ciclo (T15, 5-a). Projeto com CI (`temCi`, o
 * default do adaptador): o do CI no HEAD. Projeto sem CI (`ci: false` no
 * adaptador): a Verificação da última tarefa — quem chama só pergunta depois
 * do fechamento conferido, e a conferência só grava com a Verificação verde
 * (vermelha reverte o trazido), então o veredito é `verde` sem esperar run.
 */
function vereditoDoFechamento(ctx) {
  if (ctx.temCi === false) return "verde";
  return ciDoHead(ctx.entrada.ci, ctx.head);
}

/**
 * O fechamento que conta numa fase (T27 passo 5): o último dela no plano, e as
 * tasks que vêm depois dele — fase reaberta cujo re-plano não trouxe
 * fechamento novo deixa task depois do fechamento já conferido.
 */
function fechamentoDaFase(plano, fase) {
  const tasks = fase.tasks.map((id) => plano.porId.get(id));
  const i = tasks.findLastIndex((t) => t.fechamento);
  return i < 0 ? null : { task: tasks[i], depois: tasks.slice(i + 1).map((t) => t.id) };
}

/**
 * O contexto da decisão: os parâmetros do `decidir` com nome (`params`), os
 * auxiliares injetados (`injetados`) e o que se deriva deles sem decidir nada.
 * `plano` é o congelado na última autorização; `planoHead` é o do HEAD, usado
 * só para a pergunta de (re)autorização; `diffPlano` é o `git diff` entre os
 * dois blobs, quando diferem. `agora` e `reinicioEm` são epoch em segundos (ou
 * null): o relógio da vigia e a hora do último reinício da ponte (T12).
 * `replanos` são os commits (`{ sha, subject }`) que mexeram no canonico entre
 * a última autorização e o HEAD — null quando o canonico mudou de caminho;
 * decidem a herança da autorização pelo re-plano de ruling (F4.17).
 * `consentimentos` são os casos do ciclo no git (`lerConsentimentos`): o
 * `publicacao-do-ciclo` tira o `simParaPublicar` das publicações seguintes.
 *
 * `reabrir` (task → `{ tentativa, coberta, motivo }` da tentativa que caiu)
 * nasce vazio e é a `regraVigia` que o preenche; `vooAtivo`, `servidor`,
 * `workstation` e `daCondutora` são lidos depois dela.
 */
export function contextoDaDecisao(params, injetados) {
  const { estado, entrada, autorizacoes, plano, planoHead, planoHeadBlob, planoBlob, replanos, ciclo, reconhecer, autorizacaoDoCiclo, encerradas } = params;
  const { estadoDaFilha, mudancasQuePerguntam, mudancasDeAlcance, rulingDoReplano } = injetados;
  // `statusBucket` é o de `get_session` (`BLOCKED`, `FAILED`, …), normalizado como o estado.
  const filhas = (Array.isArray(entrada.filhas) ? entrada.filhas : []).map((f) => ({
    ...f,
    estado: estadoDaFilha(f?.estado),
    ...(f?.statusBucket !== undefined ? { statusBucket: estadoDaFilha(f.statusBucket) } : {}),
  }));
  const aprovacoes = Array.isArray(entrada.aprovacoes) ? entrada.aprovacoes : [];
  const trazidas = estado.trazidas ?? new Map();

  // O sim do operador ao ciclo (`autorizar-ciclo`, ruling de 27/10/2026): vale para
  // toda fase enquanto nenhuma task mudar de classe ou sensibilidade em relação
  // ao plano congelado nele, e cobre as tasks sensíveis dela (D18a, 16/11/2026). Os gates
  // seguem pedindo: a primeira publicação do ciclo, task de fase herdada que toca caminho
  // clínico ou publica alterando o existente (`simProprio`, uma vez por task), perguntas da vigia.
  const cicloCobre = Boolean(
    autorizacaoDoCiclo && planoHead && planoHeadBlob && !mudancasQuePerguntam(autorizacaoDoCiclo.plano, planoHead).length,
  );
  // Plano mudado desde a última autorização sem ser por ruling: o sim do ciclo
  // só o cobre sem mudança de alcance (`mudancasDeAlcance`).
  const replanoSoDeRuling =
    !planoHeadBlob || planoHeadBlob === planoBlob || (Array.isArray(replanos) && replanos.length > 0 && replanos.every((c) => rulingDoReplano(c.subject, ciclo, reconhecer)));
  const semMudarAlcance = !planoHead || !mudancasDeAlcance(plano, planoHead).length;

  const autorizadas = new Set(autorizacoes.map((a) => a.fase));
  // Fase autorizada mais de uma vez: só ela pode estar reaberta (T27). Plano
  // antigo com task depois do fechamento, autorizado uma vez, segue como antes.
  // A herdada (F4.17) não reabre fase: é a mesma autorização sob o plano novo.
  const vezesAutorizada = new Map();
  for (const a of autorizacoes) if (!a.herdada) vezesAutorizada.set(a.fase, (vezesAutorizada.get(a.fase) ?? 0) + 1);
  const reautorizada = (id) => (vezesAutorizada.get(id) ?? 0) > 1 && !encerradas.has(id);
  const iPrimeira = plano.fases.findIndex((f) => autorizadas.has(f.id));

  // Fases antes da primeira autorizada ficaram fora da condução (feitas à mão).
  const foraDaConducao = new Set(plano.fases.slice(0, Math.max(iPrimeira, 0)).flatMap((f) => f.tasks));
  const feita = (t) => estado.feitas.has(t) || foraDaConducao.has(t);
  const fase = iPrimeira < 0 ? null : plano.fases.slice(iPrimeira).find((f) => f.tasks.some((t) => !feita(t))) ?? null;
  const tasks = fase ? fase.tasks.map((id) => plano.porId.get(id)) : [];

  // O sim do operador à fase (F4.17, ruling de 23/10/2026): a última autorização é
  // a da fase em curso, e o plano congelado nela é o que a condução lê. Cobre
  // as tasks sensíveis da fase em toda tentativa; plano mudado nas tasks já
  // parou antes (`plano-mudou`) ou herdou (`herdar-autorizacao`).
  const ultimaAutorizacao = autorizacoes.at(-1) ?? null;
  const daFase = Boolean(fase) && ultimaAutorizacao?.fase === fase.id;
  // O sim dado a ESTA fase cobre toda task sensível dela: a autorização herdada
  // aponta (`Conducao-Herdada`) a marca com o sim, e a herdada pelo sim do
  // ciclo aponta a marca de outra fase — nela, só a task com `simProprio`
  // (caminho clínico ou publicação que altera, D18a) pergunta, uma vez por task.
  const autoridade = ultimaAutorizacao?.herdada
    ? autorizacoes.find((a) => a.sha === ultimaAutorizacao.herdada) ?? null
    : ultimaAutorizacao;
  // A herança pré-autorizada (ruling de 23/11/2026) cobre como o sim do ciclo: a task com
  // `simProprio` (caminho clínico ou publicação que altera, D18a) segue pedindo o sim dela.
  // Vale pela cadeia: herança `sozinho`/`replano` gravada depois de uma pré-autorizada sobre o mesmo sim não devolve a cobertura.
  const preautorizadaSobreOSim = Boolean(autoridade) && autorizacoes.some((a) => a.fase === fase?.id && a.origem === "preautorizado" && a.herdada === autoridade.sha);
  const cobertaPelaFase = daFase && autoridade?.fase === fase.id && !preautorizadaSobreOSim;

  const voo = tasks.filter((t) => estado.emVoo.has(t.id)).map((t) => ({ t, r: estado.emVoo.get(t.id) }));
  const reabrir = new Map();
  // Conjunto pronto (T6 passo 4), com as tasks a reabrir na frente. A tentativa
  // que caiu deixa de ocupar vaga e saídas: a nova toma o lugar dela.
  const prontas = () =>
    tasks.filter((t) => !feita(t.id) && (!estado.emVoo.has(t.id) || reabrir.has(t.id)) && !t.fechamento && t.deps.every(feita));

  return {
    ...params,
    ...injetados,
    filhas,
    aprovacoes,
    trazidas,
    decididos: estado.decididos ?? new Set(),
    cicloCobre,
    replanoSoDeRuling,
    semMudarAlcance,
    autorizadas,
    reautorizada,
    iPrimeira,
    feita,
    fase,
    tasks,
    ultimaAutorizacao,
    daFase,
    cobertaPelaFase,
    voo,
    reabrir,
    maxTent: estado.maxTent,
    tetoPonte: entrada.tetoPonte,
    get vooAtivo() {
      return voo.filter(({ t }) => !reabrir.has(t.id));
    },
    get servidor() {
      const p = prontas();
      return [...p.filter((t) => reabrir.has(t.id)), ...p.filter((t) => !reabrir.has(t.id))].filter((t) => t.estacao === "servidor");
    },
    get workstation() {
      return prontas().filter((t) => t.estacao === "workstation");
    },
    get daCondutora() {
      return prontas().filter((t) => t.estacao === "condutora");
    },
  };
}

/** Fase em curso já autorizada: as regras de dentro da fase só falam nela. */
function emCurso(ctx) {
  return Boolean(ctx.fase) && ctx.autorizadas.has(ctx.fase.id);
}

// ── perguntar pelo plano ────────────────────────────────────────────────────

/**
 * Pergunta de plano mudado, uma forma só para o re-plano no meio da fase
 * (T22) e a fase reaberta (T27); `ids` são as tasks da fase cujas trazidas
 * a pergunta lista.
 */
function perguntaDoPlano(ctx, faseId, ids, tasksMudadas, campos = {}) {
  const { acao, plano, planoHead, planoHeadBlob, planoBlob, diffPlano, trazidas, tasksQueMudaramDeClasse } = ctx;
  // A resposta foi sobre uma parada desta fase: re-plano que mexe em task de outra fase segue perguntando.
  // Nas duas versões do plano: task que veio de outra fase também mexe naquela fase.
  const soDestaFase = tasksMudadas.every((d) => {
    const versoes = [planoHead?.porId.get(d.task), plano.porId.get(d.task)].filter(Boolean);
    return versoes.length > 0 && versoes.every((x) => x.fase === faseId);
  });
  const pelaResposta = campos.motivo || !soDestaFase ? null : respostaQueReplanejou(ctx);
  if (pelaResposta) {
    const sensiveis = sensiveisDaFase(planoHead, { id: faseId });
    const mudaram = tasksQueMudaramDeClasse(plano, planoHead);
    return acao("autorizar-pela-resposta", `plano:${faseId}`, 0, {
      fase: faseId,
      pergunta: pelaResposta,
      planoNovo: planoHeadBlob,
      planoAnterior: planoBlob,
      tasksMudadas,
      mudaramDeClasse: mudaram,
      ...(sensiveis.length ? { sensiveis } : {}),
      trazidas: ids.filter((id) => trazidas.has(id)).map((id) => ({ task: id, tentativa: trazidas.get(id).tentativa })),
      comando: `autorizar-ciclo ${faseId} --pergunta ${pelaResposta} --sim "<texto da opção que o operador escolheu>"`,
      aviso: `${faseId} reautorizada pela resposta de ${pelaResposta}, que pediu o re-plano (${tasksMudadas.length} task(s) mudada(s)${
        mudaram.length ? `, ${mudaram.length} de classe` : ""
      }${sensiveis.length ? `; sensíveis cobertas: ${sensiveis.join(", ")}` : ""}): sem segunda pergunta`,
      ...campos,
    });
  }
  return acao("perguntar", `plano:${faseId}`, 0, {
    motivo: "plano-mudou",
    fase: faseId,
    planoNovo: planoHeadBlob,
    planoAnterior: planoBlob,
    ...(diffPlano ? { diffPlano } : {}),
    tasksMudadas,
    mudaramDeClasse: tasksQueMudaramDeClasse(plano, planoHead),
    // Tentativa trazida e ainda sem conferência: o passo da maestra e a
    // conferência dela vêm depois da reautorização (skill §3).
    trazidas: ids
      .filter((id) => trazidas.has(id))
      .map((id) => {
        const r = trazidas.get(id);
        return { task: id, tentativa: r.tentativa, nonceTentativa: r.nonce, ref: r.ref };
      }),
    ...campos,
  });
}

/**
 * A pergunta registrada cuja resposta pediu o re-plano (trailer `Replano-Pergunta`), quando todo
 * commit do re-plano desde a autorização a cita e todos citam a mesma; senão null (a pergunta
 * `plano-mudou` de sempre). O verbo `autorizar-ciclo` confere o resto: resposta humana, mesmo ciclo,
 * a opção escolhida e o uso único (`exigirPerguntaDoAutorizar`).
 */
function respostaQueReplanejou(ctx) {
  const { replanos } = ctx;
  if (!Array.isArray(replanos) || !replanos.length) return null;
  const ids = new Set(replanos.map((c) => c.pergunta ?? null));
  if (ids.size !== 1) return null;
  const [id] = ids;
  return typeof id === "string" && /^p-[0-9a-f]{16}$/.test(id) ? id : null;
}

/**
 * O re-plano que segue sozinho e só avisa (T43, D-VEGA19-53), para a fase `f` — a em curso ou a
 * reaberta: com todo commit do re-plano levando o trailer `Replano-Motivo` e a regra cumprida
 * (`replanoSozinho` de `verbos.mjs`, injetada), a autorização da fase é herdada (origem `sozinho`),
 * com o aviso ao operador, o `replano:<sha8>` e a linha de recibo de Vega, e o caso
 * `replano-sozinho` registrado como decisão de Vega por delegação; o motivo que se repete no ciclo
 * pergunta `replano-repetido` (consertar o molde ao lado de seguir). Sem o trailer, ou fora da
 * regra, null: a pergunta (ou a herança) de hoje.
 */
function replanoQueSegueSozinho(ctx, f, campos = {}) {
  const { acao, ciclo, plano, planoHead, planoHeadBlob, planoBlob, replanos, anteriores, reconhecer, autorizacoes, trazidas, planoHeadTexto } = ctx;
  const { replanoSozinho, diferencaDoPlano, mudancasQuePerguntam, mudancasDeAlcance, reciboDeVega, nomeDoOperador } = ctx;
  if (typeof replanoSozinho !== "function" || !Array.isArray(replanos) || !replanos.length || !replanos.every((c) => c.motivo)) return null;
  const restricao = linhaDeConsentimentos(planoHeadTexto ?? "");
  const restrita =
    restricao.estado === "varias" || restricao.estado === "ilegivel" || restricao.pares.get(CASOS.replanoSozinho) === RESTRICAO_PERGUNTA || restricao.repetidos.has(CASOS.replanoSozinho);
  const ids = planoHead.fases.find((x) => x.id === f.id)?.tasks ?? f.tasks;
  const r = replanoSozinho(
    { de: plano, para: planoHead, fase: f, replanos, anteriores: anteriores ?? [] },
    {
      ciclo,
      reconhecer,
      diferencaDoPlano,
      mudancasQuePerguntam,
      mudancasDeAlcance,
      aditiva: (m) => sensivelAditivaNaOrdem({ de: plano, para: planoHead, faseId: f.id, mudanca: m }),
      trazidas: ids.filter((id) => trazidas.has(id)),
      textoDaTask: (id) => blocoDaTask(planoHeadTexto ?? "", id),
      restrita,
    },
  );
  const sha8 = replanos.at(-1).sha.slice(0, 8);
  if (r.porque === "replano-repetido")
    return acao("perguntar", `replano:${f.id}`, 0, {
      motivo: "replano-repetido",
      fase: f.id,
      replanoMotivo: r.motivo,
      ponteiro: `replano:${sha8}`,
      replanos: replanos.map((c) => ({ sha: c.sha, replanoMotivo: c.motivo })),
      anteriores: (anteriores ?? []).map((a) => ({ sha: a.sha, replanoMotivo: a.motivo })),
      // O mesmo motivo duas vezes no ciclo é o molde que falha: o operador decide seguir, consertar
      // o molde (`/write-plan`, contrato) ou os dois.
      conserto: "molde",
      planoNovo: planoHeadBlob,
      planoAnterior: planoBlob,
      ...campos,
    });
  if (!r.sozinho) return null;
  const marca = autorizacoes.findLast((a) => a.fase === f.id);
  if (!marca) return null;
  const autorizacao = marca.herdada ?? marca.sha;
  const tasksMudadas = diferencaDoPlano(plano, planoHead);
  const aditivas = mudancasQuePerguntam(plano, planoHead).filter((m) => sensivelAditivaNaOrdem({ de: plano, para: planoHead, faseId: f.id, mudanca: m }));
  const titular = typeof nomeDoOperador === "function" ? nomeDoOperador() : "o operador";
  const recibo = typeof reciboDeVega === "function" ? reciboDeVega({ titular, regra: "re-plano dentro da fase, D-VEGA19-53" }) : null;
  return acao("herdar-autorizacao", `herdar:${f.id}`, 0, {
    fase: f.id,
    origem: "sozinho",
    autorizacao,
    planoNovo: planoHeadBlob,
    planoAnterior: planoBlob,
    tasksMudadas,
    replanos: replanos.map((c) => ({ sha: c.sha, ruling: ctx.rulingDoReplano(c.subject, ciclo, reconhecer) })),
    replanoMotivo: r.motivo,
    ponteiro: `replano:${sha8}`,
    aviso: `${f.id} segue pelo re-plano ${replanos.map((c) => c.sha.slice(0, 8)).join(", ")} sem perguntar (motivo ${r.motivo}, replano:${sha8})${recibo ? ` — ${recibo}` : ""}`,
    ...(recibo ? { recibo } : {}),
    consentimento: pedidoDeCaso({ caso: CASOS.replanoSozinho, fase: f.id, origem: autorizacao }),
    ...(aditivas.length
      ? { consentimentos: aditivas.map((m) => pedidoDeCaso({ caso: CASOS.sensivelAditivaNaOrdem, fase: f.id, origem: autorizacao, task: m.task })) }
      : {}),
    ...campos,
  });
}

/**
 * O re-plano pré-autorizado (ruling do operador, 23/11/2026, verbatim: "pra replanos sempre vale
 * preautorização"): dentro de ciclo autorizado, todo re-plano commitado desde a última autorização
 * reautoriza a fase `f` pelo sim que já valia (`autorizacao`, sha da marca com o sim), sem pergunta:
 * a ação é `herdar-autorizacao` com origem `preautorizado`, o caso `replano` registrado e o aviso ao
 * operador (`ponteiro` `replano:<sha8>`). Seguem perguntando, fora daqui: a publicação
 * (`simParaPublicar`), a task com sim próprio (a herança cobre como o sim do ciclo, D18a), a
 * conferência e a vigia. Sem commit de re-plano, com merge entre eles, sem autorização de origem, ou com a linha
 * `**Consentimentos:**` que devolve `replano` à pergunta (ou ilegível), null: a pergunta de antes.
 */
function replanoPreautorizado(ctx, f, autorizacao, campos = {}) {
  const { acao, ciclo, plano, planoHead, planoHeadBlob, planoBlob, replanos, reconhecer, planoHeadTexto, planoTexto, diferencaDoPlano, tasksQueMudaramDeClasse, trazidas } = ctx;
  if (!autorizacao || !planoHead || !planoHeadBlob || !Array.isArray(replanos) || !replanos.length) return null;
  // Merge que traz o canonico de fora (merge de main, C24) não é re-plano do ciclo: segue perguntando.
  if (replanos.some((c) => c.merge)) return null;
  // Tentativa trazida e não conferida na fase: a conferência dela é do operador, sob o plano que ele vê.
  const idsDaFase = new Set([...(plano.fases.find((x) => x.id === f.id)?.tasks ?? []), ...(planoHead.fases.find((x) => x.id === f.id)?.tasks ?? [])]);
  if (trazidas instanceof Map && [...trazidas.keys()].some((id) => idsDaFase.has(id))) return null;
  // A restrição vale no plano novo E no congelado na autorização; a linha mudada pelo re-plano também pergunta.
  const restrita = (texto) => {
    const r = linhaDeConsentimentos(texto ?? "");
    return r.estado === "varias" || r.estado === "ilegivel" || r.pares.get(CASOS.replanoPreautorizado) === RESTRICAO_PERGUNTA || r.repetidos.has(CASOS.replanoPreautorizado);
  };
  const linhaDoMapa = (texto) => String(texto ?? "").split("\n").filter((l) => /^\*\*Consentimentos:\*\*/.test(l.replace(/\r$/, ""))).map((l) => l.replace(/\r$/, "").trim()).join("\n");
  if (restrita(planoHeadTexto) || (planoTexto !== null && planoTexto !== undefined && (restrita(planoTexto) || linhaDoMapa(planoTexto) !== linhaDoMapa(planoHeadTexto)))) return null;
  const sha8 = replanos.at(-1).sha.slice(0, 8);
  const tasksMudadas = diferencaDoPlano(plano, planoHead);
  const mudaram = tasksQueMudaramDeClasse(plano, planoHead);
  const sensiveis = sensiveisDaFase(planoHead, f);
  return acao("herdar-autorizacao", `herdar:${f.id}`, 0, {
    fase: f.id,
    origem: "preautorizado",
    autorizacao,
    planoNovo: planoHeadBlob,
    planoAnterior: planoBlob,
    tasksMudadas,
    mudaramDeClasse: mudaram,
    replanos: replanos.map((c) => ({ sha: c.sha, ruling: ctx.rulingDoReplano(c.subject, ciclo, reconhecer) })),
    ponteiro: `replano:${sha8}`,
    aviso: `${f.id} reautorizada pelo re-plano ${replanos.map((c) => c.sha.slice(0, 8)).join(", ")} pela pré-autorização do operador (ruling de 23/11/2026, replano:${sha8}): ${tasksMudadas.length} task(s) mudada(s)${
      mudaram.length ? `, ${mudaram.length} de classe` : ""
    }${sensiveis.length ? `; com sim próprio, que seguem pedindo o delas: ${sensiveis.join(", ")}` : ""}`,
    ...(sensiveis.length ? { sensiveis } : {}),
    consentimento: pedidoDeCaso({ caso: CASOS.replanoPreautorizado, fase: f.id, origem: autorizacao }),
    ...campos,
  });
}

/**
 * Fase reaberta por task nova (T27, D-VEGA22-34): a fase autorizada com o
 * último fechamento conferido e sem `Conducao-Encerrada` que ganha, no plano
 * do HEAD, task nascida nela e não feita volta pela pergunta de plano —
 * antes do CI, do `encerrar-sessao` e do `fechar-ciclo`. Task removida,
 * dependência, classe ou Outputs mudados sem task nova não reabrem.
 */
function reabrirFase(ctx, cand) {
  const { autorizadas, encerradas, plano, planoHead, planoHeadBlob, planoBlob, estado, diferencaDoPlano } = ctx;
  if (!cand || !autorizadas.has(cand.id) || encerradas.has(cand.id)) return null;
  if (!planoHead || !planoHeadBlob || planoHeadBlob === planoBlob) return null;
  const fech = fechamentoDaFase(plano, cand);
  if (!fech || !estado.feitas.has(fech.task.id)) return null;
  const tasksMudadas = diferencaDoPlano(plano, planoHead);
  const nascidas = tasksMudadas
    .filter((d) => d.mudou === "nasceu" && !estado.feitas.has(d.task))
    .map((d) => planoHead.porId.get(d.task))
    .filter((t) => t.fase === cand.id);
  if (!nascidas.length) return null;
  const ids = planoHead.fases.find((f) => f.id === cand.id)?.tasks ?? [];
  // O `/intra-plan` exige que toda fase termine em fechamento.
  const semFechamento = !nascidas.some((t) => t.fechamento);
  // T43: com fechamento novo, o re-plano que cabe na regra herda a autorização e só avisa.
  const sozinho = semFechamento ? null : replanoQueSegueSozinho(ctx, cand, { reaberta: true });
  if (sozinho) return sozinho;
  const pergunta = perguntaDoPlano(ctx, cand.id, ids, tasksMudadas, {
    reaberta: true,
    ...(semFechamento ? { motivo: "fase-reaberta-sem-fechamento" } : {}),
  });
  // Ruling de 23/11/2026: o re-plano commitado reautoriza sozinho; a fase sem fechamento segue perguntando.
  const marca = (ctx.autorizacoes ?? []).findLast((a) => a.fase === cand.id);
  const pre = semFechamento || pergunta.acao !== "perguntar" ? null : replanoPreautorizado(ctx, cand, marca ? (marca.herdada ?? marca.sha) : null, { reaberta: true });
  return pre ?? pergunta;
}

/**
 * Fase reaberta e reautorizada cujas tasks novas ficaram depois do último
 * fechamento: o fechamento conferido é o velho, e não encerra a fase.
 */
function semFechamentoNovo(ctx, f, alvo, campos = {}) {
  const { acao, plano, estado, reautorizada } = ctx;
  const fech = fechamentoDaFase(plano, f);
  if (!reautorizada(f.id) || !fech || !estado.feitas.has(fech.task.id) || !fech.depois.length) return null;
  return acao("perguntar", alvo, 0, { motivo: "fase-reaberta-sem-fechamento", fase: f.id, task: fech.task.id, depois: fech.depois, ...campos });
}

// ── antes da fase ───────────────────────────────────────────────────────────

/** Nenhuma fase do plano autorizada: a autorização veio de fora dele. Lê: `iPrimeira`, `autorizadas`. */
export function regraFaseForaDoPlano(ctx) {
  const { acao, iPrimeira, autorizadas } = ctx;
  if (iPrimeira >= 0) return null;
  return acao("perguntar", "ciclo", 0, { motivo: "fase-autorizada-fora-do-plano", fases: [...autorizadas] });
}

/**
 * Sem fase restante (T22): o fechamento do ciclo sai numa sessão limpa,
 * aberta pelo texto que esta entrega (o comando de fechamento do projeto,
 * `fechamentoDoCiclo`) — nunca `perguntar squash` aqui; o squash é perguntado
 * dentro do fechamento do projeto (D-SC7-2). Desde a VEGA-37 T10 o
 * `fechar-ciclo` leva em `criar` o `criar-condutora` de fase `fechamento`,
 * que a própria condutora da última fase executa.
 *
 * Lê: `fase`, `iPrimeira`, `plano`, `autorizadas`, `encerradas`, `entrada`
 * (`proposta`, `ci`, `sessaoMaestra`), `repo`, `temCi`.
 */
export function regraFecharCiclo(ctx) {
  const { ciclo, acao, repo, plano, entrada, encerradas, autorizadas, iPrimeira, fase, textoDoFechamento } = ctx;
  if (iPrimeira < 0 || fase) return null;
  const conduzidas = plano.fases.slice(iPrimeira).filter((f) => autorizadas.has(f.id)).map((f) => f.id);
  const proposta = entrada.proposta && typeof entrada.proposta === "object" ? entrada.proposta : null;
  const campos = { fase: "ciclo", ultimaFase: plano.fases.at(-1).id, conduzidas, ci: entrada.ci ?? null, proposta };
  if (proposta?.state === "MERGED") return acao("esperar", "fechar:ciclo", 0, { ...campos, motivo: "mesclado" });
  if (encerradas.has("ciclo")) return acao("esperar", "fechar:ciclo", 0, { ...campos, motivo: motivoDoCtx(ctx) });
  const ultima = plano.fases.at(-1);
  const reaberta = reabrirFase(ctx, ultima) ?? semFechamentoNovo(ctx, ultima, "fechar:ciclo", { ultimaFase: ultima.id });
  if (reaberta) return reaberta;
  const veredito = vereditoDoFechamento(ctx);
  if (!veredito) return acao("esperar", "fechar:ciclo", 0, { ...campos, motivo: "ci-pendente" });
  if (veredito === "vermelho") return acao("perguntar", "fechar:ciclo", 0, { ...campos, motivo: "ci-vermelho" });
  // Encerramentos exigidos: os das fases já gravados no ramo e o do ciclo,
  // que a maestra grava ao executar esta ação — a auditoria do Ato A confere
  // que nenhum sumiu. Fase conduzida antes da T21 não tem marca: fica fora.
  const exigirEncerramentos = [...plano.fases.map((f) => f.id).filter((id) => encerradas.has(id)), "ciclo"];
  const sessao = entrada.sessaoMaestra ?? null;
  // Dois papéis (VEGA-37 T10): a condutora da última fase cria a condutora de
  // fechamento do ciclo, numa sessão limpa, com o texto do fechamento do
  // projeto (`fechamentoDoCiclo` do adaptador) como prompt — o que a
  // `maestraCriarFechamento` fazia, sem nível acima. Uma só: o nonce leva o
  // HEAD, e depois de `Conducao-Encerrada: ciclo` esta regra só espera.
  const prompt = textoDoFechamento({ ciclo, repo, sessao, conduzidas, exigirEncerramentos, anterior: "condutora anterior" });
  return acao("fechar-ciclo", "fechar:ciclo", 0, {
    ...campos,
    texto: textoDoFechamento({ ciclo, repo, sessao, conduzidas, exigirEncerramentos }),
    criar: acao("criar-condutora", "condutora:fechamento", 0, { fase: "fechamento", nome: nomeDaCondutora(ciclo, "fechamento"), modelo: null, tentativa: 1, sessaoLimpa: true, texto: prompt }),
  });
}

/**
 * Uma fase por condutora (D-VEGA22-31, T21): a fase anterior conduzida
 * com o fechamento conferido e sem a marca `Conducao-Encerrada` dela fecha a
 * sessão antes do pedido de autorização da fase seguinte — só com o CI verde
 * no HEAD. Verde ⇒ `encerrar-sessao` leva em `criar` o `criar-condutora` da
 * fase seguinte, que a própria condutora executa (VEGA-37 T8); vermelho ou
 * pendente não cria. O fechamento que conta é o último da fase (T27):
 * o de uma fase reaberta só encerra quando o fechamento novo for conferido.
 *
 * Lê: `fase` (ainda não autorizada), `iPrimeira`, `plano`, `autorizadas`,
 * `estado.feitas`, `encerradas`, `entrada` (`ci`, `sessaoMaestra`), `cicloCobre`, `temCi`.
 */
export function regraEncerrarSessao(ctx) {
  const { ciclo, acao, repo, plano, estado, entrada, encerradas, autorizadas, iPrimeira, fase, cicloCobre, textoDaProximaSessao } = ctx;
  if (!fase || autorizadas.has(fase.id)) return null;
  const iFase = plano.fases.indexOf(fase);
  const anterior = iFase > iPrimeira ? plano.fases[iFase - 1] : null;
  const ultimoAnterior = anterior && autorizadas.has(anterior.id) ? fechamentoDaFase(plano, anterior)?.task : null;
  const fechamentoAnterior = ultimoAnterior && estado.feitas.has(ultimoAnterior.id) ? ultimoAnterior : null;
  if (!fechamentoAnterior || encerradas.has(anterior.id)) return null;
  const reaberta = reabrirFase(ctx, anterior) ?? semFechamentoNovo(ctx, anterior, `encerrar:${anterior.id}`, { faseSeguinte: fase.id });
  if (reaberta) return reaberta;
  const ci = entrada.ci && typeof entrada.ci === "object" ? entrada.ci : null;
  const veredito = vereditoDoFechamento(ctx);
  const campos = { fase: anterior.id, faseSeguinte: fase.id, task: fechamentoAnterior.id, ci };
  if (!veredito) return acao("esperar", `encerrar:${anterior.id}`, 0, { ...campos, motivo: "ci-pendente" });
  if (veredito === "vermelho") return acao("perguntar", `encerrar:${anterior.id}`, 0, { ...campos, motivo: "ci-vermelho" });
  // Dois papéis (VEGA-37 T8): a própria condutora encerra a fase, sem nível
  // acima. A criação da seguinte entra na ordem da troca (VEGA-37 T16): depois
  // do encerramento vem o `passar` (`regraPassarNaFronteira`), e a herdeira
  // nasce do `criar-condutora` da `regraPassagem`, com nota, posse e época.
  // O `texto` fica como o resumo da sessão seguinte, sem ser prompt de ninguém.
  const texto = textoDaProximaSessao({ ciclo, fase: fase.id, repo, sessao: entrada.sessaoMaestra ?? null, peloCiclo: cicloCobre, anterior: "condutora anterior" });
  return acao("encerrar-sessao", `encerrar:${anterior.id}`, 0, { ...campos, texto, depois: "passar" });
}

// ── a ordem da troca (VEGA-37 T16, D-VEGA37-18, D-VEGA37-19) ────────────────
//
// A troca de condutora, na fronteira de fase ou no meio dela, segue a ordem do
// esboço, cada passo uma ação do `proximo` com nonce:
//   1. `passar` — nota de passagem e "em passagem"; o verbo desanexa o ramo
//      (`desanexar-ramo` se ficou anexado) e NÃO solta a posse;
//   2. `criar-condutora` — a herdeira, com o `trazer-ramo` dentro do prompt;
//   3. `trazer-ramo` (verbo, na árvore da herdeira) — o ramo aberto lá e
//      conferido na ponta, que é a marca de passagem;
//   4. `passar-posse` — a herdeira toma a posse com o `lock_id` e a época da
//      nota; a época sobe nessa escrita e a anterior para de gravar;
//   5. `soltar-inscricao` (anterior) · `inscrever-na-proposta` e
//      `confirmar-passagem` (herdeira); em 3 níveis (VEGA-20 T37, D10a) a
//      inscrição é da maestra o ciclo inteiro, e o passo 5 é só o
//      `confirmar-passagem`, sem `inscrita`;
//   6. `arquivar-anterior` (herdeira, logo depois da confirmação: a anterior
//      não espera a confirmação, para depois de soltar a inscrição) e, com
//      ela arquivada e a árvore limpa, `desmontar-anterior` (herdeira).
// Sem confirmação no prazo, cada lado sabe quem é a dona pela época: parada,
// a anterior segue dona (`retomar-da-passagem`, e na segunda falha a pergunta);
// subida, a dona é a herdeira e a anterior para (`parar passagem-epoca-subiu`).
//
// `ctx.passagem` é o resumo que o `proximo` monta (`resumoDaPassagem` de
// conducao.mjs): `aberta` (a marca `passagem` aberta, com `ramo`, `lock`,
// `epoca`, `nota`), `ultima` (a última marca de passagem, de qualquer tipo),
// `falhas` (fase → desistidas desde a última confirmada), `noMeio` (fase →
// passagens confirmadas no meio dela), e só quando há passagem aberta ou
// confirmada por último: `posse` (do leitor do projeto), `anexado`,
// `confirmadaNoRamo` (a anterior lê a ponta do ramo) e `arvoreDaAnterior`
// (`{ caminho, nome, suja, motivo }` da árvore destacada na marca, ou `null`).

/** O número da época como veio da marca (`Conducao-Epoca`), ou `null`. */
function epocaDaMarca(m) {
  const n = Number(m?.epoca);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * Quem esta sessão é na passagem aberta, pela posse e pelo ramo:
 * dona com a época da nota ⇒ `anterior`; dona com época maior ⇒ `herdeira`;
 * posse alheia com o ramo anexado ⇒ `herdeira-sem-posse` (trouxe o ramo, ainda
 * não passou a posse); posse alheia destacada ⇒ `anterior-destituida`. Outro
 * caso (posse ilegível, sem posse, época torta) ⇒ `null`: a ordem não anda sem época.
 */
export function papelNaPassagem({ posse, anexado, aberta }) {
  const daNota = epocaDaMarca(aberta);
  if (!daNota || !posse) return null;
  if (posse.estado === "dona") {
    if (posse.epoca === daNota) return "anterior";
    if (Number.isSafeInteger(posse.epoca) && posse.epoca > daNota) return "herdeira";
    return null;
  }
  if (posse.estado === "outra") return anexado ? "herdeira-sem-posse" : "anterior-destituida";
  return null;
}

/**
 * A fase e o nome da herdeira (D-VEGA37-18): passagem depois do encerramento da
 * fase é de fronteira, e a herdeira é a primeira condutora da fase seguinte
 * (`<ciclo> · F<n+1>`); no meio da fase, leva o ordinal dentro dela — a
 * primeira condutora é a 1, cada passagem confirmada no meio soma uma.
 */
export function herdeiraDaPassagem({ ciclo, plano, encerradas, aberta, noMeio }) {
  if (encerradas.has(aberta.fase)) {
    const i = plano.fases.findIndex((f) => f.id === aberta.fase);
    const seguinte = i >= 0 ? plano.fases[i + 1] ?? null : null;
    if (!seguinte) return null;
    return { fase: seguinte.id, ordinal: 1, nome: nomeDaCondutora(ciclo, seguinte.id), modelo: seguinte.modelo ?? null, fronteira: true };
  }
  const fase = plano.fases.find((f) => f.id === aberta.fase) ?? null;
  const ordinal = 2 + (noMeio?.get(aberta.fase) ?? 0);
  return { fase: aberta.fase, ordinal, nome: nomeDaCondutora(ciclo, aberta.fase, ordinal), modelo: fase?.modelo ?? null, fronteira: false };
}

/** O estado da outra sessão da troca (`entrada.herdeira`/`entrada.anterior`), normalizado como o da filha. */
function estadoDoLado(ctx, lado) {
  if (lado?.estado == null) return null;
  return typeof ctx.estadoDaFilha === "function" ? ctx.estadoDaFilha(lado.estado) : lado.estado;
}

/** Minutos desde a criação da herdeira (`entrada.herdeira.criadaEm`), ou `null` sem o instante. */
function minutosDaHerdeira(ctx, herdeira) {
  const criada = herdeira?.criadaEm != null ? ctx.epoch(herdeira.criadaEm) : null;
  if (criada === null || !Number.isFinite(ctx.agora)) return null;
  return (ctx.agora - criada) / 60;
}

/**
 * A troca em curso: lado da anterior e lado da herdeira, pela época
 * (comentário do bloco). Vem logo depois da rede de arquivamento: em passagem
 * nada da fase anda. Sem passagem aberta, só o desmonte da anterior fala.
 *
 * Lê: `passagem`, `plano`, `encerradas`, `entrada` (`herdeira`, `anterior`,
 * `inscrita`, `ci`, `sessaoMaestra`), `agora`, `temCi`, `niveis`,
 * `prazoConfirmacaoMin`, `textoDaHerdeira`. Em 3 níveis (`niveis === 3`) a
 * condutora nunca se inscreve nem solta: quem segura a inscrição é a maestra.
 */
export function regraPassagem(ctx) {
  const { ciclo, acao, nonce, passagem: p, entrada, plano, encerradas, temCi, prazoConfirmacaoMin, textoDaHerdeira } = ctx;
  // Em 3 níveis a inscrição na proposta é da maestra do começo ao fim (T37): a condutora não a toca.
  const inscreveSe = temCi && ctx.niveis !== 3;
  if (!p) return null;
  const a = p.aberta;
  if (!a) return regraDesmonte(ctx);
  const epoca = epocaDaMarca(a);
  const campos = { fase: a.fase, passagem: a.sha, epoca, ramo: a.ramo ?? null };
  const papel = papelNaPassagem({ posse: p.posse, anexado: p.anexado, aberta: a });
  if (!papel)
    return acao("perguntar", `passagem:${a.sha}`, 0, {
      ...campos,
      motivo: "passagem-sem-posse",
      posse: p.posse?.estado ?? null,
      detalhe: `a passagem ${a.sha.slice(0, 8)} não anda sem a época: posse ${p.posse?.estado ?? "não lida"}${p.posse?.motivo ? ` (${p.posse.motivo})` : ""}, época da nota ${a.epoca ?? "ausente"}`,
    });
  const herdeira = entrada.herdeira ?? null;
  const minutos = minutosDaHerdeira(ctx, herdeira);
  // Sem confirmação no prazo: o prazo corre da criação da herdeira; herdeira arquivada antes de confirmar é prazo vencido.
  const vencido = estadoDoLado(ctx, herdeira) === "ARCHIVED" || (minutos !== null && minutos > prazoConfirmacaoMin);
  const espera = { ...campos, herdeira: herdeira?.sessao ?? null, prazoMin: prazoConfirmacaoMin, minutos };

  if (papel === "anterior") {
    if (p.anexado) return acao("desanexar-ramo", `desanexar:${a.sha}`, 0, campos);
    const falhas = p.falhas?.get(a.fase) ?? 0;
    if (!herdeira?.sessao) {
      const h = herdeiraDaPassagem({ ciclo, plano, encerradas, aberta: a, noMeio: p.noMeio });
      if (!h)
        return acao("perguntar", `passagem:${a.sha}`, 0, { ...campos, motivo: "passagem-sem-fase-seguinte", detalhe: `${a.fase} é a última fase do plano: a fronteira dela é o fechamento do ciclo, não uma passagem` });
      const tentativa = falhas + 1;
      const trazer = { ramo: a.ramo ?? null, passagem: a.sha, tentativa, nonce: nonce(ciclo, `herdeira:${a.sha}`, tentativa, a.sha) };
      const texto = textoDaHerdeira({ ciclo, fase: h.fase, sessao: entrada.sessaoMaestra ?? null, nota: a.nota ?? null, trazer, niveis: ctx.niveis ?? 2 });
      return acao("criar-condutora", `herdeira:${a.sha}`, tentativa, { ...campos, fase: h.fase, faseDaPassagem: a.fase, nome: h.nome, ordinal: h.ordinal, modelo: h.modelo, tentativa, texto, trazer, prazoMin: prazoConfirmacaoMin });
    }
    if (!vencido) return acao("esperar", `passagem:${a.sha}`, 0, { ...espera, motivo: "passagem-em-curso" });
    // Época parada: a posse nunca saiu da anterior. Uma nova tentativa; na segunda falha, o operador.
    if (falhas >= 1)
      return acao("perguntar", `passagem:${a.sha}`, falhas + 1, { ...campos, motivo: "passagem-sem-confirmacao", herdeira: herdeira.sessao, tentativas: falhas + 1, prazoMin: prazoConfirmacaoMin });
    return acao("retomar-da-passagem", `retomar:${a.sha}`, falhas + 1, { ...campos, arquivar: herdeira.sessao, prazoMin: prazoConfirmacaoMin, minutos });
  }

  if (papel === "anterior-destituida") {
    // A época subiu: a dona é a herdeira. A anterior solta a inscrição e para; quem a arquiva é a
    // herdeira, logo depois de confirmar (`arquivar-anterior`). Sem esperar a confirmação: a espera
    // que cada condutora improvisava deixava a anterior ociosa (D19a do operador, 16/11/2026).
    if (ctx.niveis !== 3 && entrada.inscrita === true) return acao("soltar-inscricao", `soltar:${a.sha}`, 0, { ...campos, ferramenta: "unsubscribe_pr_activity", proposta: entrada.proposta?.numero ?? null });
    if (vencido && !p.confirmadaNoRamo) return acao("parar", `passagem:${a.sha}`, 0, { ...campos, motivo: "passagem-epoca-subiu", herdeira: herdeira?.sessao ?? null, prazoMin: prazoConfirmacaoMin });
    // Sem confirmação ainda, o motivo é outro: quem lê a parada leva ao operador o prazo da
    // herdeira, porque a anterior não fica de olho (se a herdeira cair antes de confirmar, é ele).
    if (!p.confirmadaNoRamo)
      return acao("parar", `passagem:${a.sha}`, 0, { ...campos, motivo: "passagem-entregue-sem-confirmacao", herdeira: herdeira?.sessao ?? null, prazoMin: prazoConfirmacaoMin, minutos });
    return acao("parar", `passagem:${a.sha}`, 0, { ...campos, motivo: "passagem-entregue", herdeira: herdeira?.sessao ?? null });
  }

  if (papel === "herdeira-sem-posse") {
    if (!a.lock)
      return acao("perguntar", `passagem:${a.sha}`, 0, { ...campos, motivo: "passagem-sem-posse", posse: p.posse?.estado ?? null, detalhe: `a nota de ${a.sha.slice(0, 8)} não traz o lock_id da anterior (trailer Conducao-Lock): sem ele o passar-posse não acha a posse` });
    return acao("passar-posse", `posse:${a.sha}`, 0, { ...campos, lock_id: a.lock, verbo: "passar-posse" });
  }

  // Herdeira dona: se inscreve (em 2 níveis), relê o CI e confirma.
  if (inscreveSe && entrada.inscrita !== true)
    return acao("inscrever-na-proposta", `inscricao:${a.sha}`, 0, { ...campos, ferramenta: "subscribe_pr_activity", proposta: entrada.proposta?.numero ?? null, depois: "confirmar-passagem" });
  return acao("confirmar-passagem", `confirmar:${a.sha}`, 0, {
    ...campos,
    epocaNova: p.posse.epoca,
    ci: entrada.ci ?? null,
    arvoreDaAnterior: p.arvoreDaAnterior?.caminho ?? null,
    arvoreSuja: Boolean(p.arvoreDaAnterior?.suja),
  });
}

/**
 * O último passo da ordem: a herdeira, dona, depois da confirmação, arquiva a
 * anterior (`arquivar-anterior`, D19a do operador, 16/11/2026: `archive_session`
 * da `entrada.anterior.sessao` ainda não arquivada) e desmonta a árvore dela
 * (D-VEGA37-19), só com a anterior arquivada, a árvore achada e limpa. Árvore
 * suja já registrada na confirmação ⇒ nada (o operador decide); suja depois
 * dela ⇒ a pergunta.
 */
function regraDesmonte(ctx) {
  const { acao, passagem: p, entrada } = ctx;
  const c = p.ultima;
  if (c?.tipo !== "confirmada" || p.posse?.estado !== "dona") return null;
  const estadoDaAnterior = estadoDoLado(ctx, entrada.anterior);
  // Estado ausente conta como viva: arquivar de novo é inofensivo, e calar deixaria a anterior
  // ocupando vaga. Duas vezes executado sem `ARCHIVED` ⇒ a pergunta, como no `arquivar` da filha.
  if (entrada.anterior?.sessao && estadoDaAnterior !== "ARCHIVED") {
    const campos = { fase: c.fase, passagem: c.confirma ?? null, sessao: entrada.anterior.sessao };
    const n = ctx.nonce(ctx.ciclo, `arquivar-anterior:${c.sha}`, 0, c.sha);
    const vezes = (Array.isArray(entrada.anterior.arquivamentos) ? entrada.anterior.arquivamentos : []).filter((x) => x === n).length;
    if (vezes >= 2) return acao("perguntar", `arquivar-anterior:${c.sha}`, 0, { ...campos, motivo: "falha-de-arquivamento", nonceArquivar: n, vezes });
    return acao("arquivar-anterior", `arquivar-anterior:${c.sha}`, 0, { ...campos, ferramenta: "archive_session", nonceArquivar: n });
  }
  const arvore = p.arvoreDaAnterior;
  if (!arvore?.caminho || c.arvoreSuja) return null;
  if (estadoDaAnterior !== "ARCHIVED") return null;
  const campos = { fase: c.fase, passagem: c.confirma ?? null, caminho: arvore.caminho, nome: arvore.nome };
  if (arvore.suja) return acao("perguntar", `desmontar:${c.sha}`, 0, { ...campos, motivo: "arvore-da-anterior-suja", detalhe: arvore.motivo ?? null });
  return acao("desmontar-anterior", `desmontar:${c.sha}`, 0, { ...campos, anterior: entrada.anterior.sessao ?? null });
}

/**
 * Fronteira de fase depois do encerramento (VEGA-37 T16): a fase anterior
 * encerrada, a seguinte ainda sem autorização e nenhuma passagem confirmada
 * desde o encerramento ⇒ `passar`, com a nota no molde. É a anterior que
 * passa; a herdeira, que confirma, autoriza a fase seguinte no seu `proximo`.
 * Vale também depois de `retomar-da-passagem`: a nova tentativa é outra nota.
 * Só vale sobre o encerramento com `Conducao-Depois: passar` (`passarDepoisDe`).
 *
 * Lê: `fase`, `autorizadas`, `plano`, `iPrimeira`, `encerradas`, `passagem`.
 */
export function regraPassarNaFronteira(ctx) {
  const { acao, fase, autorizadas, plano, iPrimeira, encerradas, passagem: p } = ctx;
  if (!fase || autorizadas.has(fase.id) || !p) return null;
  const iFase = plano.fases.indexOf(fase);
  const anterior = iFase > iPrimeira ? plano.fases[iFase - 1] : null;
  // Só o encerramento gravado com `Conducao-Depois: passar` pede a passagem: a marca antiga segue lida como antes.
  if (!anterior || !encerradas.has(anterior.id) || !p.passarDepoisDe?.has(anterior.id) || p.confirmadas?.has(anterior.id)) return null;
  const falhas = p.falhas?.get(anterior.id) ?? 0;
  return acao("passar", `passar:${anterior.id}`, falhas, { fase: anterior.id, faseSeguinte: fase.id, molde: "references/nota-de-passagem.md", tentativa: falhas + 1 });
}

/**
 * Nome da condutora pela fase (D-VEGA37-2, D-VEGA37-18): `<ciclo> · F<n>`, e
 * a herdeira que entra no meio da mesma fase leva o ordinal, `· 2`, `· 3`.
 */
export function nomeDaCondutora(ciclo, fase, ordinal = 1) {
  return ordinal > 1 ? `${ciclo} · ${fase} · ${ordinal}` : `${ciclo} · ${fase}`;
}

/**
 * Fase nova ainda não autorizada: sob o sim do ciclo, a maestra grava a
 * autorização herdada (`herdar-autorizacao`, origem `ciclo`) sem perguntar a
 * o operador; fora dele (nenhum sim do ciclo, ou task que mudou de classe ou de
 * sensibilidade desde o sim), pede o sim do ciclo de novo: o sim por fase
 * foi aposentado (D-VEGA29-14).
 *
 * Lê: `fase`, `autorizadas`, `cicloCobre`, `replanoSoDeRuling`,
 * `semMudarAlcance`, `autorizacaoDoCiclo`, `plano`, `planoHead`, `diffPlano`, `entrada.ci`.
 */
export function regraAutorizarFase(ctx) {
  const { acao, plano, planoHead, planoHeadBlob, planoBlob, diffPlano, entrada, autorizadas, fase, cicloCobre, replanoSoDeRuling, semMudarAlcance, autorizacaoDoCiclo, tasksQueMudaramDeClasse } = ctx;
  if (!fase || autorizadas.has(fase.id)) return null;
  const sensiveis = sensiveisDaFase(planoHead ?? plano, fase);
  if (cicloCobre && (replanoSoDeRuling || semMudarAlcance))
    return acao("herdar-autorizacao", `herdar:${fase.id}`, 0, {
      fase: fase.id,
      origem: "ciclo",
      autorizacao: autorizacaoDoCiclo.sha,
      planoNovo: planoHeadBlob,
      planoAnterior: planoBlob,
      tasksMudadas: [],
      replanos: [],
      aviso: `${fase.id} autorizada pelo sim do ciclo de ${autorizacaoDoCiclo.sha.slice(0, 8)} (ruling de 27/10/2026)${
        sensiveis.length ? `; tasks sensíveis desta fase, que pedem um sim só, na primeira: ${sensiveis.join(", ")}` : ""
      }`,
      ...(sensiveis.length ? { sensiveis } : {}),
      // VEGA-37 T19: o caso já coberto passa a ficar registrado (`consentimento.mjs`).
      consentimento: pedidoDeCaso({ caso: CASOS.herancaEntreFases, fase: fase.id, origem: autorizacaoDoCiclo.sha }),
    });
  // Ruling de 23/11/2026: com o sim do ciclo dado, o re-plano commitado desde a última autorização
  // reautoriza a fase nova sozinho; sem sim do ciclo nenhum, a pergunta `autorizar-ciclo` segue.
  const pre = autorizacaoDoCiclo ? replanoPreautorizado(ctx, fase, autorizacaoDoCiclo.sha) : null;
  if (pre) return pre;
  const mudaram = planoHead ? tasksQueMudaramDeClasse(plano, planoHead) : [];
  return acao("perguntar", fase.id, 0, {
    motivo: "autorizar-ciclo",
    fase: fase.id,
    planoNovo: planoHeadBlob,
    planoAnterior: planoBlob,
    ...(diffPlano ? { diffPlano } : {}),
    mudaramDeClasse: mudaram,
    // O sim desta fase cobre as tasks sensíveis dela: vão pelo nome na pergunta.
    ...(sensiveis.length ? { sensiveis } : {}),
    ci: entrada.ci ?? null,
  });
}

// ── dentro da fase ──────────────────────────────────────────────────────────

/**
 * Re-plano no meio da fase (T22): o plano do HEAD que mudou nas tasks em
 * relação ao congelado na autorização para a condução até o operador reautorizar a
 * fase sob o plano novo. Blob diferente com o plano parseado igual (§13,
 * nota, typo) segue calado.
 *
 * Herança (F4.17): re-plano que o operador invocou pelo `/intra-plan` — todo commit
 * que mexeu no canonico desde a autorização é de ruling —, sem task mudando
 * de classe e sem trazida pendente na fase, não reautoriza: a maestra grava a
 * autorização herdada e a condução segue. Qualquer outra mudança pergunta. A
 * classe não basta (review de segurança): task de estação condutora ou
 * workstation tem a estação por classe, e task já sensível pode trocar o que
 * publica ou o caminho clínico que toca, ou entrar na fase vinda de outra.
 * Para a herança, toda mudança de publicação ou caminho clínico, e toda task
 * sensível que muda de fase, contam como mudança de classe. Task nova comum
 * não conta (C24 do VEGA-28): `mudancasQuePerguntam`.
 *
 * Lê: `fase`, `plano`, `planoHead`, `planoHeadBlob`, `replanos`, `daFase`,
 * `cicloCobre`, `semMudarAlcance`, `ultimaAutorizacao`, `autorizacaoDoCiclo`.
 */
export function regraReplano(ctx) {
  const { ciclo, acao, plano, planoHead, planoHeadBlob, planoBlob, replanos, reconhecer, fase, daFase, cicloCobre, semMudarAlcance, ultimaAutorizacao, autorizacaoDoCiclo } = ctx;
  const { diferencaDoPlano, mudancasQuePerguntam, rulingDoReplano } = ctx;
  if (!emCurso(ctx) || !planoHead || !planoHeadBlob || planoHeadBlob === planoBlob) return null;
  const tasksMudadas = diferencaDoPlano(plano, planoHead);
  if (!tasksMudadas.length) return null;
  // T43: o re-plano com `Replano-Motivo` que cabe na regra segue sozinho e só avisa.
  const sozinho = daFase ? replanoQueSegueSozinho(ctx, fase) : null;
  if (sozinho) return sozinho;
  const pergunta = perguntaDoPlano(ctx, fase.id, fase.tasks, tasksMudadas);
  // Task sensível nova, na ordem do plano e dentro da fase autorizada, não pergunta (VEGA-37 T19).
  const todasMudancas = mudancasQuePerguntam(plano, planoHead);
  const aditivas = todasMudancas.filter((m) => sensivelAditivaNaOrdem({ de: plano, para: planoHead, faseId: fase.id, mudanca: m }));
  const mudou = todasMudancas.filter((m) => !aditivas.includes(m));
  const rulings = daFase && Array.isArray(replanos) && replanos.length
    ? replanos.map((c) => rulingDoReplano(c.subject, ciclo, reconhecer))
    : [];
  // Sob o sim do ciclo, o re-plano sem ruling (commit à mão, merge de main que
  // muda o canonico) também herda, desde que não mude classe nem sensibilidade.
  const porRuling = rulings.length > 0 && rulings.every(Boolean);
  const peloCiclo = daFase && cicloCobre && Array.isArray(replanos) && replanos.length > 0 && semMudarAlcance;
  if ((porRuling || peloCiclo) && !mudou.length && !pergunta.trazidas.length)
    return acao("herdar-autorizacao", `herdar:${fase.id}`, 0, {
      fase: fase.id,
      origem: porRuling ? "replano" : "ciclo",
      autorizacao: ultimaAutorizacao.herdada ?? ultimaAutorizacao.sha,
      planoNovo: planoHeadBlob,
      planoAnterior: planoBlob,
      tasksMudadas,
      replanos: replanos.map((c, i) => ({ sha: c.sha, ruling: rulings[i] ?? null })),
      aviso: `autorização de ${fase.id} herdada pelo re-plano ${replanos.map((c) => c.sha.slice(0, 8)).join(", ")} (${
        porRuling ? [...new Set(rulings)].join(", ") : `sim do ciclo de ${autorizacaoDoCiclo.sha.slice(0, 8)}`
      })`,
      // VEGA-37 T19: um registro por caso — o re-plano sem mudança de classe e cada task sensível aditiva.
      consentimento: pedidoDeCaso({
        caso: CASOS.replanoSemMudancaDeClasse,
        fase: fase.id,
        origem: ultimaAutorizacao.herdada ?? ultimaAutorizacao.sha,
      }),
      ...(aditivas.length
        ? {
            consentimentos: aditivas.map((m) =>
              pedidoDeCaso({ caso: CASOS.sensivelAditivaNaOrdem, fase: fase.id, origem: ultimaAutorizacao.herdada ?? ultimaAutorizacao.sha, task: m.task }),
            ),
          }
        : {}),
    });
  // Ruling de 23/11/2026: o re-plano commitado que ainda perguntaria reautoriza sozinho e só avisa.
  if (pergunta.acao === "perguntar") {
    const marca = (ctx.autorizacoes ?? []).findLast((a) => a.fase === fase.id);
    const pre = replanoPreautorizado(ctx, fase, marca ? (marca.herdada ?? marca.sha) : null);
    if (pre) return pre;
  }
  return pergunta;
}

/**
 * Fase reaberta e reautorizada sem fechamento novo: as tasks novas nunca
 * chegariam a um fechamento que encerre a fase.
 *
 * Lê: `fase`, `plano`, `reautorizada`, `feita`.
 */
export function regraReabertaSemFechamento(ctx) {
  const { acao, plano, fase, reautorizada, feita } = ctx;
  if (!emCurso(ctx)) return null;
  const fech = fechamentoDaFase(plano, fase);
  if (!reautorizada(fase.id) || !fech || !feita(fech.task.id)) return null;
  return acao("perguntar", `reaberta:${fase.id}`, 0, {
    motivo: "fase-reaberta-sem-fechamento",
    fase: fase.id,
    task: fech.task.id,
    pendentes: fase.tasks.filter((id) => !feita(id)),
  });
}

/** Publicação recusada pelo operador numa task da fase: a condução para. Lê: `tasks`, `estado.recusadas`. */
export function regraPublicacaoRecusada(ctx) {
  const { acao, fase, tasks, estado } = ctx;
  if (!emCurso(ctx)) return null;
  const recusada = tasks.find((t) => estado.recusadas.has(t.id));
  if (!recusada) return null;
  return acao("parar", recusada.id, 0, { motivo: "publicacao-recusada", fase: fase.id, task: recusada.id });
}

/**
 * Trazida sem conferência: o fluxo normal grava a conferência sob o nonce do
 * trazer, sem passar pelo `proximo` — vê-la aqui é interrupção no meio.
 *
 * Task de conferência do operador por pergunta (T14): a mesma parada é a
 * pergunta do resultado, `conferencia-do-operador`, com as opções sim · nao.
 *
 * Lê: `tasks`, `trazidas`, `conferencia` (casos do adaptador).
 */
export function regraTrazidaSemConferencia(ctx) {
  const { acao, fase, tasks, trazidas, conferencia, casoDeConferencia, opcoesDaConferencia } = ctx;
  if (!emCurso(ctx)) return null;
  const trazida = tasks.find((t) => trazidas.has(t.id));
  if (!trazida) return null;
  const r = trazidas.get(trazida.id);
  const base = { fase: fase.id, task: trazida.id, tentativa: r.tentativa, nonceTentativa: r.nonce, ref: r.ref };
  const caso = casoDeConferencia(trazida, conferencia);
  // Conferência do operador por pergunta (T14, 7-a): a parte da máquina
  // chegou; o resultado é do operador. Sim ⇒ conferência com `--operador`;
  // não ⇒ `--rodada nao`, e a tentativa seguinte é a rodada nova.
  if (caso && !caso.arquivo)
    return acao("perguntar", trazida.id, r.tentativa, { motivo: "conferencia-do-operador", ...base, marca: caso.marca, opcoes: opcoesDaConferencia(trazida.id) });
  return acao("perguntar", trazida.id, r.tentativa, {
    motivo: "trazida-sem-conferencia",
    ...base,
    // Caso por arquivo (por exemplo um gate de UX): o não do arquivo fecha a
    // rodada por `registrar-conferencia T<k> --rodada nao`, não pela conferência.
    // `liveUxGate` é o nome antigo, mantido no caso por arquivo.
    ...(caso ? { conferenciaDoOperador: caso.marca, liveUxGate: true } : {}),
  });
}

/**
 * O `cutucadaEm` da sessão caída, em epoch, só se for da queda em curso: com
 * `caidaEm` (o instante em que quem conduz viu esta queda pela primeira vez),
 * o `cutucadaEm` anterior a ele é de uma queda velha e não conta — a sessão
 * voltou e caiu de novo, e recebe o seu `cutucar`. Sem `caidaEm`, vale o
 * `cutucadaEm` como veio. `null` = sem cutucada desta queda.
 */
export function cutucadaDestaQueda(sessao, epoch) {
  const cutucadaEm = sessao.cutucadaEm == null ? null : epoch(sessao.cutucadaEm);
  if (cutucadaEm === null) return null;
  const caidaEm = sessao.caidaEm == null ? null : epoch(sessao.caidaEm);
  return caidaEm !== null && cutucadaEm < caidaEm ? null : cutucadaEm;
}

/**
 * Vigia das filhas em voo (depois do `trazer`). Regra de falha, uma só
 * (esboço §Vigia de filha; T12):
 *   (1) filha some sem aviso — arquivada, ausente ou prazo vencido ⇒ perguntar;
 *   (2) `T<k>-FALHA` ou Verificação vermelha ⇒ tentativa nova automática;
 *       a 2ª falha contada da mesma task ⇒ perguntar, nunca 3ª tentativa;
 *   (3) queda de tentativa aberta antes do último reinício da ponte
 *       ⇒ reabre sem contar falha, com aviso ao operador.
 *   (4) filha esperando clique (`status_bucket` `BLOCKED`, `REQUIRES_ACTION`)
 *       ⇒ perguntar já, no primeiro ciclo, nunca no fim do prazo (T18, sota
 *       E2.A2/A3: em `auto` o classificador volta a pedir clique, e o pedido
 *       encaminhado não expira);
 *   (5) filha caída (`status_bucket` `FAILED`, sem aviso) ⇒ `cutucar`: a
 *       maestra manda uma mensagem e grava `cutucadaEm` na filha da entrada
 *       (só o desta queda conta: `cutucadaDestaQueda`);
 *       só depois de `silencioFilhaCaidaMin` sem ela voltar a tentativa
 *       reabre como falha de ambiente (T18, sota E2.B2).
 * O estado `ARCHIVED` sozinho nunca decide término (§2.2#29): término é aviso.
 *
 * Preenche `reabrir` com as tentativas que caíram e reabrem (o `abrir` as
 * leva na frente); devolve a primeira pergunta, se houver.
 *
 * Lê: `tasks`, `voo`, `filhas`, `estado` (`falhas`, `falhasAmbiente`,
 * `revertidasSemFalha`, `emVoo`, `maxTent`), `agora`, `reinicioEm`,
 * `feita`, `tetoFalhasAmbiente`, `silencioFilhaCaidaMin`, `epoch`. Escreve: `reabrir`.
 */
export function regraVigia(ctx) {
  const { acao, lerAviso, fase, tasks, voo, filhas, estado, agora, reinicioEm, feita, reabrir, tetoFalhasAmbiente, silencioFilhaCaidaMin, epoch } = ctx;
  if (!emCurso(ctx)) return null;
  const falhasDe = (t) => estado.falhas.get(t) ?? 0;
  const cobertaPorReinicio = (r) => reinicioEm !== null && r.abertaEm != null && r.abertaEm <= reinicioEm;
  const perguntasDaVigia = [];
  const cutucar = [];
  const reentregar = [];
  const dentroDoPrazo = (t, r) => agora !== null && r.abertaEm != null && agora - r.abertaEm <= t.prazoMin * 60;
  const registrar = (t, r) => ({ registrarFalha: { task: t.id, tentativa: r.tentativa, coberta: "nao" } });
  for (const { t, r } of voo) {
    if (!r.nonce) {
      perguntasDaVigia.push(["marcador-invalido", t, r]);
      continue;
    }
    const delas = filhas.filter((f) => f.nonce === r.nonce);
    const avisos = delas.map((f) => ({ f, a: lerAviso(f.aviso) })).filter(({ a }) => a && a.task === t.id && a.nonce === r.nonce);
    // Pergunta da filha (P22 do ATRM-51): não é falha de trabalho. Sai sem
    // `registrarFalha` nem `abrir`; a tentativa segue aberta e a condutora
    // responde à filha por mensagem na mesma sessão (skill §3). Desde a T22 do
    // VEGA-20 vai primeiro à condutora: a classe técnica fica nela, e só o que
    // a tabela de destinatários não deixa descer — ou classe ausente ou não
    // reconhecida — sobe ao operador. O aviso diz se o trabalho parou ou está
    // pronto (`trabalho`; sem o campo, `parado`).
    const pergunta = avisos.find(({ a }) => a.tipo === "FALHA" && a.arg === "pergunta");
    if (pergunta) {
      const aviso = String(pergunta.f.aviso).trim();
      const { classe, trabalho } = camposDaPergunta(aviso);
      const destinatario = destinatarioDaPerguntaDaFilha({ classe }, TABELA_DE_DESTINATARIOS);
      perguntasDaVigia.push(["pergunta-da-filha", t, r, { sessao: pergunta.f.sessao ?? null, nonceTentativa: r.nonce, aviso, classe, trabalho, destinatario }]);
      continue;
    }
    if (avisos.some(({ a }) => a.tipo === "FALHA")) {
      if (falhasDe(t.id) >= 1) perguntasDaVigia.push(["segunda-falha", t, r, registrar(t, r)]);
      else reabrir.set(t.id, { tentativa: r.tentativa, coberta: "nao", motivo: "falha-avisada" });
      continue;
    }
    if (!delas.length || delas.every((f) => f.estado === "ARCHIVED")) {
      if (cobertaPorReinicio(r)) reabrir.set(t.id, { tentativa: r.tentativa, coberta: "sim", motivo: "reinicio-da-ponte" });
      // Tentativa aberta e nenhuma operária na entrada, dentro do prazo da task: a sessão não nasceu
      // (ou ficou fora da entrada). O `abrir` com o mesmo nonce devolve a mesma partida, então a
      // condução reentrega em vez de parar (hotfix conducao-corta-paradas-de-regra); passado o prazo, a pergunta.
      else if (!delas.length && dentroDoPrazo(t, r)) reentregar.push({ t, r });
      else perguntasDaVigia.push([delas.length ? "filha-sumiu" : "tentativa-sem-filha", t, r, registrar(t, r)]);
      continue;
    }
    const vivas = delas.filter((f) => f.estado !== "ARCHIVED");
    // Esperando clique (T18): ninguém clica na filha, e a referência não anda até o prazo.
    const bloqueada = vivas.find((f) => f.statusBucket === "BLOCKED" || f.estado === "REQUIRES_ACTION");
    if (bloqueada) {
      perguntasDaVigia.push(["filha-esperando-clique", t, r, { sessao: bloqueada.sessao ?? null, nonceTentativa: r.nonce }]);
      continue;
    }
    // Caída (T18): mensagem antes; falha de ambiente só depois do silêncio.
    if (vivas.every((f) => f.statusBucket === "FAILED")) {
      const caida = vivas[0];
      const cutucadaEm = cutucadaDestaQueda(caida, epoch);
      if (cutucadaEm === null) {
        cutucar.push({ t, r, f: caida });
        continue;
      }
      if (agora !== null && agora - cutucadaEm >= silencioFilhaCaidaMin * 60) {
        reabrir.set(t.id, { tentativa: r.tentativa, coberta: "ambiente", motivo: "filha-caida-em-silencio" });
        continue;
      }
    }
    if (agora !== null && r.abertaEm != null && agora - r.abertaEm > t.prazoMin * 60)
      perguntasDaVigia.push(["prazo-vencido", t, r, { prazoMin: t.prazoMin, abertaEm: r.abertaEm, ...registrar(t, r) }]);
  }
  // Verificação vermelha: o `reverter-trazido` já tirou o trabalho; falta a falha.
  for (const t of tasks) {
    const rv = estado.revertidasSemFalha?.get(t.id);
    if (!rv || estado.emVoo.has(t.id)) continue;
    if (falhasDe(t.id) >= 1) perguntasDaVigia.push(["segunda-falha", t, rv, registrar(t, rv)]);
    else reabrir.set(t.id, { tentativa: rv.tentativa, coberta: "nao", motivo: "verificacao-vermelha" });
  }
  // Teto de 2 tentativas contadas: a task fica parada até o operador decidir.
  for (const t of tasks)
    if (!feita(t.id) && !estado.emVoo.has(t.id) && falhasDe(t.id) >= 2)
      perguntasDaVigia.push(["teto-de-falhas", t, { tentativa: estado.maxTent.get(t.id) ?? 0 }, { falhas: falhasDe(t.id) }]);
  // Teto próprio da falha de ambiente (P7 do ATRM-51): não conta no de cima, mas não reabre sem fim.
  for (const t of tasks) {
    const amb = estado.falhasAmbiente?.get(t.id) ?? 0;
    if (!feita(t.id) && !estado.emVoo.has(t.id) && amb >= tetoFalhasAmbiente)
      perguntasDaVigia.push(["teto-de-falhas-ambiente", t, { tentativa: estado.maxTent.get(t.id) ?? 0 }, { falhasAmbiente: amb }]);
  }
  if (!perguntasDaVigia.length && !cutucar.length && reentregar.length) {
    const { t, r } = reentregar[0];
    return acao("reentregar", t.id, r.tentativa, {
      motivo: "operaria-nao-nasceu",
      fase: fase.id,
      task: t.id,
      tentativa: r.tentativa,
      nonceTentativa: r.nonce,
      ref: r.ref ?? null,
      comando: `abrir ${t.id} --tentativa ${r.tentativa} --nonce ${r.nonce}`,
      aviso: `${t.id} tentativa ${r.tentativa} está aberta sem operária na entrada: o abrir com o mesmo nonce devolve a mesma partida (jaAberta). Antes de criar, list_sessions: se a operária desta tentativa existe, só pô-la na entrada.`,
    });
  }
  if (!perguntasDaVigia.length) {
    if (!cutucar.length) return null;
    const { t, r, f } = cutucar[0];
    return acao("cutucar", t.id, r.tentativa, {
      motivo: "filha-caida",
      fase: fase.id,
      task: t.id,
      tentativa: r.tentativa,
      sessao: f.sessao ?? null,
      nonceTentativa: r.nonce,
      mensagem: `Sua sessão caiu antes do aviso de ${t.id} (nonce ${r.nonce}). Retome do ponto em que parou e avise pelo passo 6 do contrato.`,
    });
  }
  const [motivo, t, r, extra = {}] = perguntasDaVigia[0];
  return acao("perguntar", t.id, r.tentativa, { motivo, fase: fase.id, task: t.id, tentativa: r.tentativa, ref: r.ref ?? null, falhas: falhasDe(t.id), ...extra });
}

/**
 * Estação condutora (`maestra` é o nome antigo, D-VEGA26-21): a própria
 * condutora executa a task na worktree do ciclo, roda a Verificação e
 * registra com `--condutora` (`--maestra` aceito). Vem antes do `abrir`: é
 * ação curta de quem conduz, e as filhas abrem no turno seguinte.
 * `simParaPublicar`: o sim da fase não cobre a publicação (F4.17) — antes da
 * primeira publicação do ciclo, o sim do operador, num turno dele; as seguintes
 * do mesmo ciclo seguem cobertas pelo caso `publicacao-do-ciclo` (D-VEGA37-52).
 *
 * Lê: `daCondutora`, `cobertaPelaFase`, `aprovacoes`, `consentimentos`.
 */
export function regraFazerCondutora(ctx) {
  const { acao, fase, daCondutora, cobertaPelaFase, aprovacoes } = ctx;
  if (!emCurso(ctx) || !daCondutora.length) return null;
  const t = daCondutora[0];
  const sensivel = t.publicacao.length > 0 || t.protegida.length > 0;
  if (sensivel && !cobertaPelaFase && pedeSimDeNovo(t, aprovacoes)) return perguntaSensivelDaFase(ctx, t, 0);
  return acao("fazer-condutora", t.id, 0, {
    fase: fase.id,
    task: t.id,
    posMerge: t.posMerge,
    publicacao: t.publicacao,
    simParaPublicar: pedeSimParaPublicar(ctx, t),
  });
}

/**
 * Nada a abrir com a fase ainda andando: filhas em voo, ou prontas sem vaga
 * no teto da ponte.
 *
 * Lê: `vooAtivo`, `servidor`, `filhas`, `tetoPonte`, `tetoPadrao`, `plano.largura`.
 */
export function regraEsperar(ctx) {
  const { acao, fase, plano, filhas, tetoPonte, tetoPadrao, vooAtivo, servidor } = ctx;
  if (!emCurso(ctx)) return null;
  if (vooAtivo.length) return acao("esperar", fase.id, 0, { motivo: "filhas-em-voo", fase: fase.id, emVoo: vooAtivo.map(({ t }) => t.id) });
  if (!servidor.length) return null;
  const { vivas, teto } = vagasDoTeto({ filhas, tetoPonte, tetoPadrao, largura: plano.largura, vooAtivo });
  return acao("esperar", fase.id, 0, { motivo: "sem-vaga", fase: fase.id, teto, vivas });
}

/** Task de workstation pronta: a condução para e o operador a roda na estação dele. Lê: `workstation`. */
export function regraWorkstation(ctx) {
  const { acao, fase, workstation } = ctx;
  if (!emCurso(ctx) || !workstation.length) return null;
  return acao("parar", workstation[0].id, 0, { motivo: "workstation", fase: fase.id, task: workstation[0].id });
}

/** Só o fechamento resta na fase: a maestra o faz. Lê: `tasks`, `feita`, `entrada.ci`. */
export function regraFecharFase(ctx) {
  const { acao, fase, tasks, feita, entrada } = ctx;
  if (!emCurso(ctx)) return null;
  const fechamento = tasks.find((t) => t.fechamento && !feita(t.id));
  if (!fechamento || !tasks.every((t) => t.fechamento || feita(t.id))) return null;
  return acao("fechar-fase", fase.id, 0, { fase: fase.id, task: fechamento.id, ci: entrada.ci ?? null });
}

/** A última da lista, sempre decide: nenhuma outra regra achou saída. Lê: `tasks`, `feita`. */
export function regraSemSaida(ctx) {
  const { acao, fase, tasks, feita } = ctx;
  return acao("perguntar", fase.id, 0, {
    motivo: "sem-saida",
    fase: fase.id,
    pendentes: tasks.filter((t) => !feita(t.id)).map((t) => ({ task: t.id, deps: t.deps.filter((d) => !feita(d)) })),
  });
}

// ── fechamento do ciclo (resto do nível da maestra) ─────────────────────────
//
// O nível da maestra (`proximo --nivel maestra`) saiu na VEGA-37 T8: a
// condutora que fecha a fase cria a seguinte (`regraEncerrarSessao`), e desde
// a T10 a da última fase cria a de fechamento (`criar` do `fechar-ciclo`, em
// `regraFecharCiclo`). Fica `maestraCriarFechamento`, sem chamador no
// `proximo`, só porque o contrato escrito (`contrato-atual.md`, da T25) ainda
// a descreve; sai com ele. Contexto:
// `ciclo`, `repo`, `acao`, `plano`, `encerradas`, `autorizadas`,
// `condutoras` (as sessões criadas, cada uma com `fase` e `estado`),
// `entrada`, `textoDoFechamento`.

const viva = (c) => c.estado !== "ARCHIVED";

/**
 * Depois de `Conducao-Encerrada: ciclo`, a sessão de fechamento do ciclo, uma
 * só: criada com o `textoDoFechamento`; viva ⇒ esperar; já arquivada ⇒ o
 * fechamento do projeto correu nela.
 *
 * Lê: `encerradas`, `condutoras`, `plano`, `autorizadas`, `entrada.proposta`.
 */
export function maestraCriarFechamento(ctx) {
  const { ciclo, repo, acao, plano, encerradas, autorizadas, condutoras, entrada, textoDoFechamento } = ctx;
  if (!encerradas.has("ciclo")) return null;
  const campos = { fase: "ciclo", ultimaFase: plano.fases.at(-1)?.id ?? null };
  if (entrada.proposta?.state === "MERGED") return acao("esperar", "fechamento", 0, { ...campos, motivo: "mesclado" });
  const sessoes = condutoras.filter((c) => c.fase === "ciclo");
  const aberta = sessoes.find(viva);
  if (aberta) return acao("esperar", "fechamento", 0, { ...campos, motivo: "condutora-viva", sessao: aberta.sessao ?? null });
  if (sessoes.length) return acao("esperar", "fechamento", 0, { ...campos, motivo: motivoDoCtx(ctx) });
  const conduzidas = plano.fases.filter((f) => autorizadas.has(f.id)).map((f) => f.id);
  const exigirEncerramentos = [...plano.fases.map((f) => f.id).filter((id) => encerradas.has(id)), "ciclo"];
  const anterior = condutoras.filter((c) => c.fase !== "ciclo").at(-1)?.sessao ?? null;
  return acao("criar-fechamento", "fechamento", 0, {
    ...campos,
    conduzidas,
    texto: textoDoFechamento({ ciclo, repo, sessao: anterior, conduzidas, exigirEncerramentos, anterior: "condutora anterior" }),
  });
}

// ── aposentadoria da parada de resposta constante (VEGA-20 T19) ─────────────

/** O trailer do commit que a aposentadoria produz (`aposentar --nonce`). */
export const TRAILER_DA_APOSENTADA = "Conducao-Aposentada";
/**
 * O texto de quem responde quando a opção aplicada pede o do operador: diz que foi a calibração.
 * A volta (T20) o reconhece no corpo da marca `rodada`: o não que a própria aposentadoria aplicou
 * não é rejeição do operador.
 */
export const TEXTO_DA_CALIBRACAO = "seguiu sozinha pela calibração";
/** Quantos ids das respostas que calibraram vão no evento: o atributo do log é um token de até 200 caracteres. */
export const DECISOES_NO_EVENTO = 10;
const LETRAS = "abcdefghijklmnopqrstuvwxyz";

/**
 * A instância da parada que `aposentado()` (calibracao.mjs, T6) julga, com os campos da task do
 * plano que a parada nomeia: `publicacao`, `simProprio`, `estacao`, `tipo` = o motivo, e
 * `caminhos` = os Outputs, os caminhos dos Steps (`passos`: a tela clínica que o trazer libera
 * pelos Steps) e os `extras` (o que a trazida trouxe de fora dos Outputs). `protegida` junta a do
 * plano aos caminhos que casam os `protegidos` do adaptador. Parada sem task do plano, ou task sem
 * Outputs legíveis ⇒ null: sem a lista de caminhos não há o que conferir, e ela segue parando. O
 * `proximo` não veta motivo nenhum aqui — nem `canonico-do-ciclo` (D-VEGA20-18): os vetos são
 * todos de `aposentado()`.
 */
export function instanciaDaParada(parada, plano, { extras = [], protegidos = [] } = {}) {
  if (!parada || typeof parada.task !== "string") return null;
  const t = (plano?.tasks ?? []).find((x) => x.id === parada.task);
  if (!t || !Array.isArray(t.outputs) || !t.outputs.length) return null;
  const caminhos = [...new Set([...t.outputs, ...(t.passos ?? []), ...extras].filter((c) => typeof c === "string"))];
  const protegida = [...new Set([...(t.protegida ?? []), ...caminhos.filter((c) => casaAlgum(c, protegidos))])];
  return {
    publicacao: [...(t.publicacao ?? [])],
    protegida,
    simProprio: t.simProprio ?? null,
    caminhos,
    tipo: parada.motivo,
    estacao: t.estacao ?? null,
  };
}

/**
 * A opção da parada que a resposta constante escolhe: a letra `a`, `b`, … é a posição da opção,
 * como a pergunta registrada as mostra (`pergunta.formaDe`). Resposta que não é uma letra só
 * (`a+b`, alternativa livre, sem letra) ou letra sem opção ⇒ null: a parada segue parando.
 */
export function opcaoDaResposta(parada, resposta) {
  if (typeof resposta !== "string" || resposta.length !== 1) return null;
  const i = LETRAS.indexOf(resposta);
  const opcoes = Array.isArray(parada?.opcoes) ? parada.opcoes : [];
  if (i < 0 || i >= opcoes.length || typeof opcoes[i]?.id !== "string") return null;
  return { id: opcoes[i].id, ...(opcoes[i].texto ? { texto: opcoes[i].texto } : {}) };
}

/**
 * A ação que substitui a parada aposentada (D-VEGA20-1, D5a): segue com a resposta constante,
 * leva o que o evento `aposentada` grava — `motivo`, `task`, `resposta`, `n`, `sequencias`,
 * `decisoes` (os ids das respostas que calibraram, as mais recentes), `por: calibracao` — e a linha
 * do relato da condutora, `seguiu sozinha: <motivo> (<n> iguais)`. Nunca mensagem própria: a linha
 * vai no relato que a condutora já entrega. `consulta` é a saída de `calibracao.consulta`; sem
 * veredito `aposentado`, ou sem opção para a resposta, devolve null e a parada segue.
 */
export function acaoDaAposentadoria(parada, consulta, { decisoes = [] } = {}) {
  if (!parada || parada.acao !== "perguntar" || consulta?.veredito !== "aposentado") return null;
  const opcao = opcaoDaResposta(parada, consulta.resposta);
  if (!opcao) return null;
  const ids = decisoes.filter((d) => /^d-[0-9a-f]{16}$/.test(d)).slice(-DECISOES_NO_EVENTO);
  const resto = Object.fromEntries(Object.entries(parada).filter(([k]) => k !== "acao" && k !== "ponteiro"));
  return {
    acao: "aposentada",
    nonce: parada.nonce,
    ciclo: parada.ciclo,
    head: parada.head,
    ...(parada.plano !== undefined ? { plano: parada.plano } : {}),
    ...(parada.fase !== undefined ? { fase: parada.fase } : {}),
    task: parada.task,
    ...(parada.tentativa !== undefined ? { tentativa: parada.tentativa } : {}),
    motivo: parada.motivo,
    resposta: consulta.resposta,
    opcao,
    n: consulta.n,
    sequencias: consulta.sequencias,
    ...(ids.length ? { decisoes: ids.join("+") } : {}),
    por: "calibracao",
    relato: `seguiu sozinha: ${parada.motivo} (${consulta.n} iguais)`,
    // O texto que a opção pede de quem responde (`--operador`): diz que foi a calibração, nunca o operador.
    textoDeQuemResponde: `${TEXTO_DA_CALIBRACAO}: ${parada.motivo} (${consulta.n} iguais)`,
    trailer: `${TRAILER_DA_APOSENTADA}: ${parada.motivo}`,
    comando: `aposentar --nonce ${parada.nonce}`,
    parada: resto,
  };
}
