#!/usr/bin/env node
/**
 * conducao.mjs — verbos da condução de ciclo por sessão.
 *
 * Sem estado próprio: cada chamada relê o plano congelado (ler-plano.mjs), as
 * marcas no git local da worktree conduzida e a entrada que a maestra
 * observou, e devolve UMA linha JSON. O script nunca chama ferramenta de
 * sessão — quem abre, avisa e arquiva é a maestra (D-VEGA22-2).
 *
 *   proximo  [--repo <worktree>] --ciclo <id> [--entrada <arquivo|json>] [--reinicio <arquivo>] [--ponte-ativa-desde <iso>]
 *      o laço da condutora. `--nivel` (o nível da maestra) saiu na VEGA-37 T8: sai 2 com o motivo do
 *      papel aposentado; a condutora que fecha a fase cria a seguinte (`criar` do `encerrar-sessao`).
 *      o `--reinicio` só vale confirmado pela ponte (`reinicioConfirmado`): sem confirmação é
 *      ignorado, com uma linha de aviso no stderr
 *   maestra --ciclo <id> --sessao <id desta> --linhagem <depth>/<limit> --contexto <usados>/<max>
 *           [--nonce <x>] [--anterior <id>] [--ordinal <k>] [--registro <json|arquivo>] [--herdeira <p-…>]
 *      só em 3 níveis (niveis.mjs, hotfix vega-conducao-niveis): sem `--nonce`, a primeira condutora
 *      (a de planejamento no ramo `ciclo-<id>-plano`); com ele, o pedido de herdeira que a condutora
 *      gravou no origin ⇒ `criar-condutora` (com o `responder` à pedinte), `passar-maestra` (contexto
 *      no corte, cadeia com lugar e o sim do operador lido no registro pela `--herdeira`: D13a/D17b do
 *      L4) ou `perguntar` (`herdeira-da-maestra`, `teto-de-linhagem`, `linhagem-ausente`,
 *      `niveis-nao-tres`, `pedido-*`); de qualquer árvore
 *   maestra-atendeu --ciclo <id> --nonce <x> --sessao-criada <id>
 *      a maestra grava no origin (`refs/conducao-brief/<ciclo>/atendido/<nonce>`) a condutora que criou
 *      para o pedido; o `maestra` com o mesmo nonce passa a sair `responder-de-novo`, nunca outra condutora
 *   reinicio-valido --arquivo <ponte-reinicio.json> [--ponte-ativa-desde <iso>]
 *      exit 0 confirmado · 1 não confirmado (o `proximo` o ignoraria) · 2 uso
 *   conferir T<k> [--repo <worktree>] --ciclo <id>
 *      exit 1 com `perguntar binario-ausente` quando o primeiro executável de algum
 *      segmento da Verificação não está no PATH (achado T10 da T18); palavra-chave de shell não conta.
 *      `saidaForaDoGit` + `avisoSaida` quando a tentativa trazida acrescentou padrão a um `.gitignore`
 *   retomar  [--repo <worktree>] --ciclo <id>
 *      também `nota` (a nota de passagem mais recente), `avisos` (os das operárias, por referência
 *      do origin) e `ci` (o último run da proposta, pelo gh): a partida da herdeira (VEGA-37 T17)
 *      `conduzir`: a fase que a condutora que retoma conduz, só pelas marcas (`faseAConduzir`, VEGA-37 T11):
 *      ciclo do modelo antigo encerrado à espera da maestra segue na fase seguinte, sem maestra
 *   auditar  --nota <arquivo> [--repo <repo>]
 *   auditar  --ciclo <id> --ref <ref> [--repo <repo>] [--exigir-fases F1,F2] [--exigir-encerramentos F1,ciclo]
 *      exit 1 com violação, fase pedida sem condução ou encerramento pedido ausente (T22)
 *
 * Pré-voo (T30, D-VEGA29-15) — `--ciclo` opcional:
 *   pre-voo --repo <projeto> [--ciclo <id>] [--herdeira --entrada <json>]
 *      `--herdeira` (VEGA-37 T17): soma as conferências da partida da herdeira —
 *      árvore na ponta do ramo, época da posse = a da nota + 1, inscrição feita (ou projeto sem proposta)
 *      confere plugin carregado, instalação única, ponte com Restart e tráfego não essencial pelo
 *      contrato do host que a declaração dá (v5); falha ⇒ `perguntar pre-voo` com `falhas`
 *      ({ conferencia, encontrado, remedio }), exit 1, e nenhuma filha abre. Com `--ciclo`, avisa
 *      (sem parar) a tarefa de julgamento em tier `mecanico`. O `abrir` não o roda: quem conduz roda
 *      no começo da sessão
 *
 * CI da proposta (T14) — sem --ciclo:
 *   ci --push-em <iso> --runs <arquivo|json> --pr <arquivo|json> [--sha <sha>] [--agora <iso>] [--prazo-min <n>]
 *      esperar · avisar (sem-run | proposta-desalinhada) · ler-run; sempre exit 0
 *   conferir-workflows [--repo <repo>]
 *      exit 1 com workflow de gatilho `push` fora de `main` que lê `secrets.`
 *
 * Verbos de git (git-conducao.mjs, T10) — todos com --ciclo (e --repo, ou a árvore pelo ramo); saem 1
 * quando a resposta é `perguntar`:
 *   niveis [--linhagem <depth>/<limit>]
 *      em quantos níveis o ciclo roda: a marca `Conducao: ciclo niveis <n>`, `legado` (2) com
 *      autorização sem marca, ou `padrao` (3); nunca pergunta (D10c do L4: sempre 3 níveis)
 *   niveis <2|3> --sim <texto> [--pergunta <p-…>]
 *      grava a marca com a resposta do operador; a última vence
 *   resposta-da-maestra --pergunta <p-…> --maestra <id>
 *      3 níveis: antes de aplicar a resposta que a maestra levou, confere pelo registro que ela é do
 *      operador nesta sessão (`digitado`) ou na da maestra (`digitado-no-hub-conferido` com o recibo
 *      nela); sai `aplicar`, ou `perguntar` com o motivo (`resposta-ausente`, `resposta-de-outra-sessao`,
 *      `recibo-nao-conferido`, `origem-sem-prova`, `registro-fora`). Nada grava
 *   pedir-herdeira --nonce <x> --entrada <a mesma do proximo>
 *      3 níveis: refaz o `proximo`, exige `pedir-herdeira` (ou o `criar` do `fechar-ciclo`) com o nonce
 *      e grava o pedido em `refs/conducao-brief/<ciclo>/pedido/<nonce>` no origin; sai com `mensagem`
 *      (`PASSAR <fase> <nonce>`) e `para` (a maestra)
 *   autorizar-fase F<n> --sim <texto>
 *      aposentado (D-VEGA29-14): recusa, exit 1, e aponta o `autorizar-ciclo`
 *   autorizar-ciclo F<n> --sim <texto> --pergunta <p-…> [--maestra <id>]
 *      `--maestra` (3 níveis): a resposta tem de ser do operador nesta sessão ou na da maestra (recibo conferido)
 *      o sim do operador à fase de partida e às seguintes (ruling de 27/10/2026): cada fase nova, e re-plano
 *      sem ruling, sai `herdar-autorizacao` (origem `ciclo`) enquanto nenhuma task mudar de classe ou
 *      sensibilidade desde o sim; task sensível de fase herdada pelo ciclo pergunta por nonce
 *   herdar-autorizacao F<n> --nonce <x>
 *      autorização herdada pelo re-plano de ruling do `/intra-plan` (F4.17): refaz o `proximo` e só
 *      grava `Conducao: F<n> autorizada` (trailers `Conducao-Herdada`, `Conducao-Replano`) quando ele
 *      devolve `herdar-autorizacao` da mesma fase e do mesmo nonce
 *   abrir T<k> --tentativa <n> --nonce <x> --modo-maestra <modo> [--falhou <n-1> --coberta sim|nao|ambiente|pergunta [--motivo <texto>]]
 *      `--modo-maestra` = o `session_context.permission_mode` do `get_session` da maestra; fora de `auto`
 *      sai `perguntar modo-da-maestra` sem gravar nada (P19 do ATRM-51)
 *      grava também o brief da filha em `refs/conducao-brief/<ciclo>/T<k>/<n>` e devolve `partida`,
 *      o prompt curto do `create_session` (ruling F3.2a)
 *   criar-ramo --ciclo <id> --tipo plano|execucao
 *      a maestra cria o ramo do ciclo sem checkout (D11b do L4): commit vazio sobre origin/main
 *      (`commit-tree`), referência local e push só dela; sai `ramo-criado` com o ramo, o sha e o
 *      `depois` (proposta em rascunho e inscrição, da maestra). Outro ramo do ciclo vivo recusa
 *   etapa <id> --ciclo <id> [--rodada <n>] [--arvore <árvore do ciclo>]
 *      o pedido de nascimento de uma etapa do planejamento (`/draft-review` · `/write-plan` ·
 *      `/plan-review` na Sistoli: `etapasDoPlanejamento` do código do adaptador), que nasce na sua
 *      sessão: sai `criar-etapa` com `pedido` (curto, em palavras, nunca abrindo com `/`, que o
 *      `create_session` recusa), `modelo` (o do tier da etapa na declaração), `nome` e `contrato`
 *      (primeira linha `<ETAPA> <saída> <sha8>` a @parent; gate humano `PERGUNTA <p-…>` com o bloco do
 *      `comando.mjs abrir`). `--rodada` só na etapa com teto de rodadas (default 1; acima do teto, exit 1).
 *      A árvore do ciclo (sem `--arvore`, a que tem o ramo `ciclo-<id>` aberto) vai no pedido: a etapa
 *      trabalha nela, commita e não empurra, salvo a declarada `empurra`, que empurra e abre a proposta
 *      Nada grava (hotfix conducao-pedido-da-etapa, 23/11/2026)
 *   trazer T<k> --tentativa <n> [--sha <sha8>] [--sessao <id>] [--aprovado <sha>]
 *      aceita merge de origin/main na faixa (só por fast-forward; o que veio do main não pergunta) e
 *      caminho clínico de tela no segmento que os Steps nomeiam (C24 do VEGA-28, P21/P24 do ATRM-51)
 *      conflito do cherry-pick só em saída gerada declarada (`saidas_geradas` do `.vega/`) é regerado
 *      pelo comando dela e entra no commit, sem perguntar (`regeneradas`; HN-29 T23)
 *      `--aprovado` aceita o SHA inteiro ou prefixo único de 7+ caracteres da ponta;
 *      o que não confere sai `perguntar` com motivo `aprovado-nao-confere` (P24 do ATRM-51)
 *      registro de caso consentido que não se grava depois da trazida sai `perguntar consentimento-nao-gravado`
 *      com o trabalho trazido e `remedio: regravar-consentimentos` (D-VEGA37-36); o `proximo` repete a
 *      pergunta enquanto faltar registro
 *   regravar-consentimentos T<k> --tentativa <n>
 *      relê os casos do registro `trazida`, grava só os que faltam no git (idempotente) e sai `regravados`
 *      com os SHAs, ou a mesma pergunta
 *   conferir-carimbo T<k>
 *   registrar-conferencia T<k> --verificacao verde|declarada-pos-merge --publicacao feita|nao-se-aplica [--sessao <id>] [--sim <texto>] [--operador <texto>]
 *      `--publicacao feita` exige `--sim` = o texto do operador autorizando a publicação só na primeira
 *      publicação do ciclo (F4.17); ela grava o caso `publicacao-do-ciclo`, e as seguintes do ciclo fecham sem
 *      `--sim`, citando o sim e a marca de origem (D-VEGA37-52)
 *      task de conferência do operador por pergunta (`(conferencia-do-operador)`, T14): sem `--operador <texto
 *      do operador dizendo sim>` não grava e sai `perguntar conferencia-do-operador` (opções sim · nao)
 *   registrar-conferencia T<k> --manual --sim <texto> --publicacao feita|nao-se-aplica
 *   registrar-conferencia T<k> --fora <sha> --verificacao verde|vencida|declarada-pos-merge --publicacao nao-se-aplica|feita [--sim <texto>] [--sessao <id>]
 *     (ciclo sem ramo: a task feita fora da condução, que o proximo emite como reconhecer-feita)
 *   registrar-conferencia T<k> --condutora --verificacao verde|declarada-pos-merge --publicacao feita|nao-se-aplica --sessao <id da condutora>
 *      task de estação condutora feita por quem conduz; `--maestra` é o nome antigo da flag, aceito igual (D-VEGA26-21)
 *   registrar-conferencia T<k> --rodada nao|needs-rework [--operador <texto>] [--sessao <id>]
 *      só task de conferência do operador (T14, 7-a): o não dele grava `Conducao: T<k> tentativa <n> rodada`,
 *      que encerra a tentativa sem ser feita nem falha, e o `proximo` abre a n+1. Por pergunta, `--operador`
 *      = o texto do operador dizendo não (obrigatório). Por arquivo (caso declarado no adaptador, por exemplo
 *      um gate de UX por arquivo; `needs-rework` é o mesmo não): o approval do HEAD diz não
 *      (`verdict: NEEDS_REWORK`) com `rodada` que não recua abaixo da última registrada (recuou ⇒
 *      `perguntar approval-fora-do-rito`), e o brief entrega a rodada B ou C. Sem teto de rodadas
 *      (25/11/2026): o gate segue até o operador aprovar
 *   registrar-conferencia T<k> --rodada carimbo [--sessao <id>]
 *      mesma task, caso por arquivo, approval em NEEDS_REWORK, tentativa trazida que só acrescenta carimbo (o carimbo que o
 *      adaptador declara; outro arquivo ⇒ `rodada-carimbo-fora-do-carimbo`):
 *      grava `Conducao: T<k> tentativa <n> carimbo`, que não conta como rodada
 *   recusar-publicacao T<k> [--motivo <texto>]
 *   reverter-trazido T<k> [--motivo <texto>]
 *   registrar-falha T<k> --tentativa <n> --coberta sim|nao|ambiente|pergunta [--motivo <texto>]
 *      `ambiente` e `pergunta` exigem `--motivo` e não contam no teto de 2 do trabalho; `ambiente` tem
 *      teto próprio (`BOTOES.tetoFalhasAmbiente`), `pergunta` — tentativa encerrada porque o operador
 *      respondeu a `pergunta-da-filha` com re-plano (ATRM-54 F4) — não conta em teto nenhum
 *      (trailer `Conducao-Falha-Pergunta`; o `retomar` mostra `falhasPergunta`). `pergunta` exige no git o
 *      aviso atual `T<k>-FALHA pergunta <nonce>` da tentativa (o do origin; o visto pela espera só com o origin ilegível; sha no trailer
 *      `Conducao-Aviso`); sem ele sai `perguntar pergunta-sem-aviso` sem gravar. Tentativa já marcada com
 *      outra coberta sai `perguntar coberta-diverge-da-marca`: a marca não se reclassifica
 *   empurrar-copia
 *   esperar-filha T<k> --tentativa <n> --teto-chamador-min <n> [--max-min 4] [--intervalo-s 30] [--desde <sha>] [--aviso-tratado <linha>]
 *      `--desde`: a ponta já vista não conta como `andou`; `--aviso-tratado`: o aviso com essa linha
 *      (já tratado por mensagem) é marcado visto e a espera segue (P25/P27 do ATRM-51)
 *      sai quando a referência da tentativa anda no origin, some, no prazo ou com a rede falhando
 *      (ruling 18.4a, T18), ou `avisou` quando a referência irmã `refs/conducao-aviso/…` anda,
 *      com a `linha` do aviso (P22 do ATRM-51) — a maestra roda em segundo plano; exit 0, ou 2 sem o teto de
 *      quem chama ou com --max-min acima dele (achado T13 da T18)
 *   limpar
 *   empurrar-ramo --nonce <x>
 *      o push do ramo do ciclo no fechamento (VEGA-37 T9): refaz o `proximo` e só empurra quando
 *      ele devolve `empurrar-ramo` com o mesmo nonce; só da árvore dona da posse (o `posse.comando` da
 *      declaração; sem ele, sem cerca e o pulo na saída), só com a proposta aberta
 *      (projeto `ci: false`: sem proposta, pula inscrição e CI), nunca forçado
 *   passar F<n> --nota <arquivo> [--entrada <json|arquivo com filhas>]
 *      a nota de passagem no molde (`references/nota-de-passagem.md`, até `ALVO_NOTA_TOKENS`) vai a
 *      `<pasta do canonico>/notes/passagem-F<n>-<k>.md` com época, lock_id e ponta na cabeça, e a marca
 *      `Conducao: F<n> em passagem` sai no mesmo commit (VEGA-37 T15); só em fronteira limpa (nenhuma
 *      tentativa em voo, trazida sem conferência nem filha viva da entrada). Em passagem, `abrir` e
 *      `registrar-conferencia --publicacao feita` recusam (`em-passagem`) até a herdeira confirmar
 *      (`Conducao: F<n> passagem confirmada`, VEGA-37 T16) ou a anterior desistir
 *   desistir-da-passagem F<n> [--motivo <texto>]
 *      `Conducao: F<n> passagem desistida`: a anterior sai de "em passagem" e segue dona
 *   desanexar-ramo | confirmar-passagem | retomar-da-passagem --nonce <x> --entrada <json|arquivo>
 *   desmontar-anterior --nonce <x> --entrada <json|arquivo> --arquivadas <arquivo>
 *      os verbos da ordem da troca refazem o `proximo` e levam a MESMA `--entrada` do `proximo` que
 *      emitiu a ação (o `comando` da ação o diz, com o campo que muda a ação: `herdeira` no
 *      `retomar-da-passagem`, `inscrita` no `confirmar-passagem`, `anterior` no `desmontar-anterior`);
 *      sem `--entrada` recusam (`sem-entrada`), e ação diferente recusa nomeando a entrada (VEGA-37 T51)
 *   Cerca do par da posse (D-VEGA37-17): todo verbo que grava marca ou empurra a cópia lê a posse
 *      (`posse.comando` da declaração) e recusa, exit 1 e o motivo no stderr, posse alheia, leitura que
 *      falha, dona sem `lock_id` ou época, e par (`lock_id`, época) da sessão diferente do da posse
 *   encerrar-sessao --fase F<n>|ciclo --nonce <x>
 *      marca `Conducao: F<n> sessao encerrada` (trailer `Conducao-Encerrada`) e empurra a cópia (T21);
 *      `--fase ciclo` é a do `fechar-ciclo`: a sessão que a grava para (T22); com o nonce já na
 *      cópia remota, não grava nem empurra e sai 0; origin inalcançável ⇒ sai 1 sem marcador (VEGA-26 T10) —
 *      o verbo exige rede sempre, mesmo com a marca já no ramo local
 *
 * Sem `--repo`, os verbos do ciclo (proximo · conferir · retomar · os de git) acham a árvore
 * pelo ramo `ciclo-<id>[-<slug>]` aberto em `git worktree list` (VEGA-26 T10); com `--repo`, ela.
 *
 * Log de eventos (log-eventos.mjs, T13): toda saída do `proximo` vira evento
 * `intencao`; a dos verbos de git, `registrado` (`intencao` quando pergunta).
 * O que a maestra observou entra por
 *   registrar-evento --acao <a> [--fase F<n>] [--task T<k>] [--tentativa <n>] [--sessao <id>]
 *                    [--estado <e>] [--sha <sha>] [--nonce <x>] [--quando <ISO>]
 * com procedência `observado`. Falha ao gravar o log avisa no stderr e não
 * muda a saída nem o exit do verbo.
 *
 * A volta da parada aposentada (VEGA-20 T20): quando o operador diz na conversa que quer voltar a
 * ser perguntado, a sessão grava a frase dele por
 *   voltar-a-perguntar --motivo <m> --recibo "<sessao> <evento>"
 * (evento `volta`, procedência `observado`, sem comando para o operador). O revert da marca
 * `aposentada` e o não da conferência do que ela trouxe gravam o mesmo evento, pelo `proximo`.
 *
 * Ações do `proximo`: arquivar · abrir · trazer · esperar · perguntar · herdar-autorizacao ·
 * fechar-fase · empurrar-ramo · inscrever-na-proposta (os passos do ramo no fechamento, VEGA-37 T9:
 * `comPassosDoRamo`) · encerrar-sessao (VEGA-37 T8; desde a T16 sem `criar`: a seguinte nasce
 * pela ordem da troca) · fechar-ciclo · parar · e a ordem da troca (VEGA-37 T16, `regraPassagem`
 * de regras.mjs): passar · desanexar-ramo · criar-condutora (a herdeira) · passar-posse ·
 * soltar-inscricao · confirmar-passagem · retomar-da-passagem · arquivar-anterior · desmontar-anterior. Toda ação leva nonce determinístico por ciclo, alvo,
 * tentativa e HEAD: o mesmo estado repetido emite a mesma ação com o mesmo
 * nonce. `arquivar <sessão>` (D-VEGA22-25) não depende do HEAD e vem antes de
 * toda outra ação.
 *
 * Entrada (JSON):
 *   { "filhas": [{ "sessao", "task", "tentativa", "nonce", "estado", "aviso", "arquivamentos", "vez" }],
 *     (`vez` ausente ⇒ o `esperandoAVez()` do adaptador, se o código o tiver, marca `"esperando"`)
 *     "agora": "<ISO>",
 *     "tetoPonte": 16,           (ausente ⇒ o `capacidade()` do adaptador, se declarado; senão o padrão)
 *     "ci": { "sha": "…", "veredito": "verde|vermelho", "run": <id> },
 *     "sessaoMaestra": "<id da sessão que chama>",
 *     "proposta": { "numero": <N>, "state": "OPEN|MERGED|CLOSED" },
 *     "inscrita": true,          (a condutora já chamou `subscribe_pr_activity` na proposta, T9)
 *     "aprovacoes": [{ "task": "T<k>", "nonce": "…" }] }
 * `ci` é o veredito que a maestra leu por dentro do run (`ler-run`); o
 * `proximo` não lê run nenhum (limite declarado, T21). `sessaoMaestra` só
 * entra no texto da próxima sessão, nunca na decisão. `proposta` é o
 * `gh pr view --json number,state` da proposta do ciclo: só o `MERGED` decide
 * (T22 — depois do merge o `proximo` não emite nada).
 * `aprovacoes` é o "sim" do operador, num turno dele, a uma pergunta de task
 * (`task-sensivel`): vale para a task em toda tentativa (D18a do operador,
 * 16/11/2026; antes, só para o nonce perguntado, D-VEGA22-21). O sim do ciclo
 * cobre toda task sensível do plano congelado, inclusive nas fases herdadas; a
 * pergunta só sai, fora do sim dado à fase, para a task que toca caminho
 * clínico ou publica alterando o existente (`simProprio`, `ler-plano.mjs`).
 * A publicação em si segue pedindo o sim por task (skill §Publicar).
 *
 * `arquivamentos` são os nonces de `arquivar` que a maestra já executou na
 * filha: o mesmo nonce 2 vezes sem `ARCHIVED` vira `perguntar`.
 *
 * Vigia de filha (T12): regra de falha única em `regraVigia` (regras.mjs); as falhas contadas
 * são só os commits `Conducao: T<k> tentativa <n> falhou` com
 * `coberta-por-reinicio: nao`, então a contagem sobrevive à troca de maestra.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, appendFileSync, constants as fsConstants, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as adaptador from "./adaptador.mjs";
import * as calibracao from "./calibracao.mjs";
import { BOTOES } from "./botoes.mjs";
import * as gitConducao from "./git-conducao.mjs";
import { definemAParadaDe, escreverCasosHerdados, lerConsentimentos, ORIGENS_HUMANAS, pecasDoConsentimento, prepararCasosHerdados } from "./consentimento.mjs";
import * as logEventos from "./log-eventos.mjs";
import * as pergunta from "./pergunta.mjs";
import { preVoo } from "./pre-voo.mjs";
import { pedidoDaEtapa } from "./etapa.mjs";
import { criarRamo } from "./criar-ramo.mjs";
import { existe as existeDeclaracao, posseDoProjeto, saidasGeradas } from "../vega/declaracao.mjs";
import { ErroGitPrazo, tentarGit } from "./git-exec.mjs";
import { RE, lerMarcas, niveisDasMarcas } from "./marcas.mjs";
import * as niveis from "./niveis.mjs";
import {
  contextoDaDecisao,
  regraAbrir,
  regraArquivar,
  regraAutorizarFase,
  regraEncerrarSessao,
  regraEsperar,
  regraFaseForaDoPlano,
  regraFazerCondutora,
  regraFecharCiclo,
  regraFecharFase,
  regraPassagem,
  regraPassarNaFronteira,
  regraPublicacaoRecusada,
  regraReabertaSemFechamento,
  regraReplano,
  regraSemSaida,
  regraTrazer,
  regraTrazidaSemConferencia,
  regraVigia,
  regraWorkstation,
  nomeDaCondutora,
  vagasDoTeto,
  TRAILER_DA_APOSENTADA,
  TEXTO_DA_CALIBRACAO,
  acaoDaAposentadoria,
  instanciaDaParada,
} from "./regras.mjs";
import {
  TRAILER_REPLANO_MOTIVO,
  TRAILER_REPLANO_PERGUNTA,
  casoDeConferencia,
  eventoDaVoltaAMando,
  eventosDaVolta,
  exigirVoltaAMando,
  opcoesDaConferencia,
  replanoSozinho,
  rulingDoReplano,
  voltasDoRamo,
} from "./verbos.mjs";
import { reciboDeVega } from "../pergunta/renderizar.mjs";
import {
  ErroPlano,
  codigoDoPlano,
  git,
  lerPlanoCongelado,
  lerPlanoNoCommit,
  tasksQueMudaramDeClasse,
} from "./ler-plano.mjs";

const { parsePhaseCommit } = createRequire(import.meta.url)("../../hooks/lib/phase-commit-regex.js");

/**
 * A Verificação roda embrulhada: sem as variáveis de produção que a declaração
 * do adaptador lista (`verificacao.variaveisDeProducao`, `env -u`) e com a
 * marca que ela nomeia (`verificacao.marcaSemCofre`, ligada em `=1`), que o
 * guard de cofre do projeto lê. Sem o campo, nenhuma variável sai e a marca é
 * `MARCA_SEM_COFRE_PADRAO`. O `env -u` não alcança credencial em arquivo
 * (token de CLI, cofre): limite declarado. `GH_TOKEN` fica — a Verificação lê CI por `gh`.
 */
export const SEM_COFRE = `${adaptador.MARCA_SEM_COFRE_PADRAO}=1`;

// ── nonce ────────────────────────────────────────────────────────────────────

export function nonce(ciclo, alvo, tentativa, head) {
  return createHash("sha256")
    .update([ciclo, alvo, String(tentativa), head].join("\0"))
    .digest("hex")
    .slice(0, 16);
}

// ── marcas no git ────────────────────────────────────────────────────────────

// A gramática e a leitura moram em `marcas.mjs` (VEGA-29 T5); `lerMarcas` segue exportada daqui.
export { lerMarcas };

/** Referências locais de tentativa: `refs/conducao-local/<ciclo>/T<k>/<n>`. */
export function lerRefsLocais(repo, ciclo) {
  const prefixo = `refs/conducao-local/${ciclo}/`;
  const bruto = git(repo, ["for-each-ref", "--format=%(refname)%1f%(objectname)%1f%(subject)%1f%(committerdate:unix)", prefixo]);
  const refs = [];
  for (const l of bruto.split("\n")) {
    if (!l) continue;
    const [nome, sha, subject, quando] = l.split("\x1f");
    // Só `T<k>/<n>` logo abaixo do prefixo: `copia` e `trazida/…` são outra coisa.
    const m = /^(T\d{1,3})\/(\d+)$/.exec(nome.slice(prefixo.length));
    if (!m) continue;
    const mk = RE.marcador.exec(subject ?? "");
    const valido = mk && mk[1] === m[1] && Number(mk[2]) === Number(m[2]);
    // `abertaEm` (epoch s) é a data do marcador: a vigia mede o prazo a partir dela.
    refs.push({ ref: nome, sha, task: m[1], tentativa: Number(m[2]), nonce: valido ? mk[3] : null, abertaEm: Number(quando) || null });
  }
  return refs;
}

/**
 * Estado por task derivado só das marcas e das referências locais. `trazidas`
 * são os registros do `trazer` ainda sem conferência nem revert (T10): a task
 * fica fora do conjunto pronto até um dos dois.
 */
export function estadoDasTasks(marcas, refs, trazidas = []) {
  const feitas = new Set();
  const recusadas = new Set();
  const encerradas = new Map(); // task → Set(tentativa) falhou|revertida
  const maxTent = new Map();
  const subir = (t, n) => maxTent.set(t, Math.max(maxTent.get(t) ?? 0, n));
  const encerrar = (t, n) => {
    if (!encerradas.has(t)) encerradas.set(t, new Set());
    encerradas.get(t).add(n);
  };
  for (const m of marcas) {
    if (m.tipo === "conferida") feitas.add(m.task);
    else if (m.tipo === "recusada") recusadas.add(m.task);
    // Rodada da conferência por arquivo dizendo não: encerra a tentativa sem ser
    // feita nem falha — a seguinte é a próxima rodada da mesma task. A de
    // carimbo também encerra, e o brief da seguinte acha a rodada pelo git.
    else if (m.tipo === "falhou" || m.tipo === "revertida" || m.tipo === "rodada" || m.tipo === "carimbo") {
      encerrar(m.task, m.tentativa);
      subir(m.task, m.tentativa);
    } else if (m.tipo === "marcador") subir(m.task, m.tentativa);
  }
  // Falhas contadas = commits `falhou` com `coberta-por-reinicio: nao` (ou sem
  // o trailer): queda coberta pelo registro de reinício não conta (T12).
  const falhas = new Map();
  // Falha de ambiente (P7 do ATRM-51) não conta no teto de trabalho, mas tem teto
  // próprio (`TETO_FALHAS_AMBIENTE`): sem ele, quem classifica reabriria para sempre.
  const falhasAmbiente = new Map();
  // Tentativa encerrada por pergunta respondida com re-plano (ATRM-54 F4): não conta
  // em teto nenhum; contada só para o `retomar` mostrar.
  const falhasPergunta = new Map();
  const falhadas = new Set(); // `T<k>/<n>` com commit `falhou`
  const decididos = new Set(); // nonces de tentativa já decididas: conferida, falhou, revertida, rodada, carimbo
  for (const m of marcas) {
    if (m.tipo === "falhou") {
      falhadas.add(`${m.task}/${m.tentativa}`);
      if (!m.coberta) falhas.set(m.task, (falhas.get(m.task) ?? 0) + 1);
      if (m.ambiente) falhasAmbiente.set(m.task, (falhasAmbiente.get(m.task) ?? 0) + 1);
      if (m.pergunta) falhasPergunta.set(m.task, (falhasPergunta.get(m.task) ?? 0) + 1);
    }
    const n = m.trailers?.["Conducao-Nonce"];
    if (n && (m.tipo === "conferida" || m.tipo === "falhou" || m.tipo === "revertida" || m.tipo === "rodada" || m.tipo === "carimbo")) decididos.add(n);
  }
  // Verificação vermelha: revertida sem o commit `falhou` da mesma tentativa é
  // falha decidida ainda por gravar (a gravação sai no `abrir` seguinte).
  const revertidasSemFalha = new Map();
  for (const m of marcas)
    if (m.tipo === "revertida" && !feitas.has(m.task) && !falhadas.has(`${m.task}/${m.tentativa}`))
      revertidasSemFalha.set(m.task, { tentativa: m.tentativa, nonce: m.trailers?.["Conducao-Nonce"] ?? null });

  const emVoo = new Map();
  for (const r of refs) {
    subir(r.task, r.tentativa);
    if (feitas.has(r.task) || encerradas.get(r.task)?.has(r.tentativa)) continue;
    const atual = emVoo.get(r.task);
    if (!atual || r.tentativa > atual.tentativa) emVoo.set(r.task, r);
  }
  for (const t of recusadas) if (feitas.has(t)) recusadas.delete(t);
  const pendentes = new Map();
  for (const r of trazidas) {
    subir(r.task, r.tentativa);
    if (feitas.has(r.task) || encerradas.get(r.task)?.has(r.tentativa)) continue;
    pendentes.set(r.task, r);
  }
  return { feitas, recusadas, emVoo, falhas, falhasAmbiente, falhasPergunta, maxTent, trazidas: pendentes, decididos, revertidasSemFalha };
}

// ── decisão (pura) ───────────────────────────────────────────────────────────

const AVISO_RE = /^(T\d{1,3})-(OK|FALHA)\s+(\S+)(?:\s+.*)?\s+(\S+)$/;

/** Aviso da filha: `T<k>-OK <sha8> <nonce>` ou `T<k>-FALHA <motivo…> <nonce>`. */
export function lerAviso(aviso) {
  const m = AVISO_RE.exec(String(aviso ?? "").trim());
  if (!m) return null;
  return { task: m[1], tipo: m[2], arg: m[3], nonce: m[4] };
}

/**
 * Estado da filha como a entrada o traz, sem depender de caixa nem do prefixo
 * da API (P16 do ATRM-51, C24 do VEGA-28): `archived`, ` Archived ` e
 * `SESSION_STATUS_ARCHIVED` são `ARCHIVED`. Antes, só a forma exata contava, e
 * a filha arquivada voltava a ser arquivada e ocupava vaga do teto.
 */
export function estadoDaFilha(estado) {
  if (typeof estado !== "string") return estado;
  return estado.trim().toUpperCase().replace(/^SESSION_STATUS_/, "");
}

/**
 * Mudança de plano que o sim do operador não cobre (F4.17, review de segurança):
 * task que muda de classe, task que ganha ou perde publicação ou caminho
 * clínico, e task já sensível que troca o que publica, o caminho clínico que
 * toca ou a fase. Task nova comum (classe `null` → `comum`) não conta (C24 do
 * VEGA-28: o re-plano da T10–T12 do ATRM-52 evitou task nova só para não
 * derrubar a herança). `ids` restringe às tasks dadas; sem ele, todas.
 */
export function mudancasQuePerguntam(de, para, ids = null) {
  const todos = ids ?? [...new Set([...de.porId.keys(), ...para.porId.keys()])];
  const sensivel = (t) => Boolean(t && (t.publicacao.length || t.protegida.length));
  const out = [];
  for (const id of todos) {
    const a = de.porId.get(id);
    const b = para.porId.get(id);
    const classeDe = a?.classe ?? null;
    const classePara = b?.classe ?? null;
    if (classeDe !== classePara && !(classeDe === null && classePara === "comum")) {
      out.push({ task: id, de: classeDe, para: classePara });
      continue;
    }
    // Segmento de tela clínica dos Steps libera o `trazer` (P21/P24): mudá-lo é mudar sensibilidade.
    // As telas são do adaptador que leu cada plano (`codigoDoPlano`).
    const segA = JSON.stringify(gitConducao.segmentosDosSteps(a?.passos ?? [], codigoDoPlano(de)));
    const segB = JSON.stringify(gitConducao.segmentosDosSteps(b?.passos ?? [], codigoDoPlano(para)));
    // `simProprio` (D18a) mudado — a task passou a alterar o existente, ou a tocar caminho clínico — é
    // mudar sensibilidade: o sim antigo, do ciclo ou da task, não a cobre.
    const simDe = a?.simProprio ?? null;
    const simPara = b?.simProprio ?? null;
    if (sensivel(a) !== sensivel(b) || (a && b && segA !== segB) || (!a && segB !== "[]") || (a && b && simDe !== simPara)) out.push({ task: id, sensibilidade: true });
    else if (
      sensivel(a) &&
      (JSON.stringify(a.publicacao) !== JSON.stringify(b.publicacao) ||
        JSON.stringify(a.protegida) !== JSON.stringify(b.protegida) ||
        a.fase !== b.fase)
    )
      out.push({ task: id, sensibilidade: true });
  }
  return out;
}

/**
 * Mudança de alcance que só o ruling do operador (`/intra-plan`) carrega: task que
 * nasce ou some, ou que troca `**Outputs:**` (Output declarado libera o
 * `trazer`), Verificação (a maestra a executa) ou estação. A herança pelo sim
 * do ciclo sem ruling exige lista vazia (review do hotfix pós-ATRM-52).
 */
export function mudancasDeAlcance(de, para) {
  const ids = [...new Set([...de.porId.keys(), ...para.porId.keys()])];
  return ids.filter((id) => {
    const a = de.porId.get(id);
    const b = para.porId.get(id);
    if (!a || !b) return true;
    return (
      JSON.stringify(a.outputs) !== JSON.stringify(b.outputs) ||
      a.verificacao !== b.verificacao ||
      // Pós-merge muda o que a conferência exige (`verde` ⇒ `declarada-pos-merge`): é alcance.
      Boolean(a.posMerge) !== Boolean(b.posMerge) ||
      a.estacao !== b.estacao ||
      a.fase !== b.fase
    );
  });
}

/** Campos do plano parseado que decidem a condução de uma task (T22 passo 1). */
// `verificacao` e `posMerge` entram porque o `conferir` os lê do plano congelado: trocá-los sem
// mudar a lista deixava a condução sob o plano velho (percalço 1 da F0 do L4, hotfix
// conducao-niveis-e-replano).
const CAMPOS_DO_PLANO = ["fase", "deps", "classe", "outputs", "publicacao", "estacao", "verificacao", "posMerge", "empurraNoMeio", "verificacaoVence"];

/**
 * Tasks cujo plano parseado mudou entre dois planos: as que nasceram, sumiram
 * ou mudaram algum de `CAMPOS_DO_PLANO`. Blob diferente com lista vazia é
 * mudança que não toca a condução (§13, nota, typo).
 */
export function diferencaDoPlano(antigo, novo) {
  const ids = [...new Set([...antigo.porId.keys(), ...novo.porId.keys()])];
  const out = [];
  for (const id of ids) {
    const de = antigo.porId.get(id);
    const para = novo.porId.get(id);
    if (!de || !para) {
      out.push({ task: id, mudou: de ? "sumiu" : "nasceu" });
      continue;
    }
    const campos = CAMPOS_DO_PLANO.filter((c) => JSON.stringify(de[c]) !== JSON.stringify(para[c]));
    if (campos.length)
      out.push({ task: id, mudou: "campos", campos: Object.fromEntries(campos.map((c) => [c, { de: de[c], para: para[c] }])) });
  }
  return out;
}

/** Re-plano de ruling do `/intra-plan` (F4.17): a política mora em `verbos.mjs`, que o rito de rodadas também lê. */
export { rulingDoReplano };

/**
 * A ordem das regras do `proximo` (VEGA-29 T7): a primeira que devolve ação
 * decide. É o contrato da decisão — a rede de arquivamento antes de tudo, o
 * fechamento e a autorização antes da fase, e dentro dela trazer antes da
 * vigia, a vigia antes do fazer-condutora e do abrir (ela preenche `reabrir`), e a
 * pergunta `sem-saida` por último, sempre decidindo.
 */
export const ORDEM_DAS_REGRAS = Object.freeze([
  regraArquivar,
  regraPassagem,
  regraFaseForaDoPlano,
  regraFecharCiclo,
  regraEncerrarSessao,
  regraPassarNaFronteira,
  regraAutorizarFase,
  regraReplano,
  regraReabertaSemFechamento,
  regraPublicacaoRecusada,
  regraTrazidaSemConferencia,
  regraTrazer,
  regraVigia,
  regraFazerCondutora,
  regraAbrir,
  regraEsperar,
  regraWorkstation,
  regraFecharFase,
  regraSemSaida,
]);

/**
 * Saída gerada declarada (`saidas_geradas` do `.vega/`, a mesma lista do
 * `git-guard`; HN-29 T23) não ocupa vaga: as tasks em voo e as prontas de
 * servidor chegam à `regraAbrir` sem ela nos Outputs, e duas tasks que só
 * dividem saída gerada abrem juntas — o conflito nela, no `trazer`, vira
 * regeneração. O plano não muda: só a leitura da vaga.
 */
export function semSaidasGeradasNaVaga(ctx, geradas) {
  if (!geradas.length) return ctx;
  const gerada = new Set(geradas);
  const sem = (t) => ({ ...t, outputs: t.outputs.filter((o) => !gerada.has(o)) });
  const voo = Object.getOwnPropertyDescriptor(ctx, "vooAtivo").get;
  const servidor = Object.getOwnPropertyDescriptor(ctx, "servidor").get;
  return Object.defineProperties(ctx, {
    vooAtivo: { get: () => voo.call(ctx).map((v) => ({ ...v, t: sem(v.t) })), enumerable: true, configurable: true },
    servidor: { get: () => servidor.call(ctx).map(sem), enumerable: true, configurable: true },
  });
}

/**
 * O contexto da decisão (regras.mjs `contextoDaDecisao`), com a fábrica de
 * ações `acao` e os auxiliares desta casa injetados. Os campos estão descritos lá;
 * `geradas` são os caminhos das saídas geradas declaradas (`semSaidasGeradasNaVaga`);
 * `consentimentos` são os casos do ciclo no git (`lerConsentimentos`).
 */
export function contextoDoProximo({ ciclo, head, plano, planoBlob, planoHead, planoHeadBlob, diffPlano, autorizacoes, estado, entrada = {}, agora = null, reinicioEm = null, encerradas = new Set(), repo = null, replanos = null, anteriores = [], planoHeadTexto = null, planoTexto = null, reconhecer = parsePhaseCommit, autorizacaoDoCiclo = null, conferencia = [], temCi = true, geradas = [], tiers = {}, passagem = null, consentimentos = [], niveis: arranjo = 2, emEspera = new Set() }, acao) {
  const ctx = contextoDaDecisao(
    { ciclo, head, plano, planoBlob, planoHead, planoHeadBlob, diffPlano, autorizacoes, estado, entrada, agora, reinicioEm, encerradas, repo, replanos, anteriores, planoHeadTexto, planoTexto, reconhecer, autorizacaoDoCiclo, conferencia, temCi, tiers, passagem, consentimentos, niveis: arranjo, emEspera },
    {
      acao,
      nonce,
      lerAviso,
      estadoDaFilha,
      diferencaDoPlano,
      mudancasQuePerguntam,
      mudancasDeAlcance,
      rulingDoReplano,
      replanoSozinho,
      reciboDeVega,
      nomeDoOperador: () => (repo ? adaptador.nomeDoOperador(repo) : "o operador"),
      tasksQueMudaramDeClasse,
      textoDaProximaSessao,
      textoDoFechamento,
      textoDaHerdeira,
      prazoConfirmacaoMin: BOTOES.prazoConfirmacaoPassagemMin,
      fechamentoDoCiclo: () => fechamentoDoProjeto(repo),
      casoDeConferencia,
      opcoesDaConferencia,
      tetoPadrao: BOTOES.tetoFilhasPadrao,
      tetoFalhasAmbiente: BOTOES.tetoFalhasAmbiente,
      silencioFilhaCaidaMin: BOTOES.silencioFilhaCaidaMin,
      epoch,
    },
  );
  return semSaidasGeradasNaVaga(ctx, geradas);
}

/**
 * A ação do `proximo`, decidida sem I/O: a primeira das `ORDEM_DAS_REGRAS`
 * que decide, sobre o contexto de `contextoDoProximo` (parâmetros lá). A
 * fábrica `acao` põe em toda ação o nonce do HEAD, o ciclo e o blob do plano.
 */
export function decidir(params) {
  const { ciclo, head, planoBlob } = params;
  const fabrica = (tipo, alvo, tentativa, campos) => ({
    acao: tipo,
    nonce: nonce(ciclo, alvo, tentativa, head),
    ciclo,
    head,
    plano: planoBlob,
    ...campos,
  });
  // A pergunta das regras sai pelo construtor único (pergunta.mjs, T12).
  const pelasRegras = (emEspera) => {
    const ctx = contextoDoProximo({ ...params, emEspera }, pergunta.comPergunta(fabrica));
    for (const regra of ORDEM_DAS_REGRAS) {
      const decidida = regra(ctx);
      if (decidida) return decidida;
    }
    throw new Error("decidir: nenhuma regra decidiu — regraSemSaida, a última, sempre decide");
  };
  return comPerguntasAbertas(pelasRegras, params.entrada?.perguntasAbertas);
}

/**
 * Os motivos de pergunta que param só uma task e esperam o operador (hotfix
 * conducao-pergunta-aberta-nao-trava, D37 do LABS-23): enquanto a pergunta está com
 * ele, a task fica parada e as outras seguem.
 */
export const PERGUNTAS_QUE_ESPERAM_O_OPERADOR = Object.freeze(["conferencia-do-operador", "pergunta-da-filha", "task-sensivel"]);

/**
 * A pergunta aberta não trava o que não depende dela (hotfix conducao-pergunta-aberta-nao-trava,
 * 28/11/2026). `abertas` é o `perguntasAbertas` da entrada: as perguntas que a condutora já levou
 * ao operador (`task`, `tentativa`, `motivo`; com `respondidaEm`, já respondida, só conta na pausa
 * do prazo). Quando as regras decidem uma pergunta de `PERGUNTAS_QUE_ESPERAM_O_OPERADOR` que casa
 * com uma aberta, a task dela entra em `emEspera` (na `task-sensivel`, toda task que ela lista) e
 * as regras decidem de novo: a task parada não é trazida, conferida nem vigiada, quem depende dela
 * não abre (não está feita), e a vaga e os Outputs dela seguem ocupados (segue em voo). A ação que
 * sai leva `perguntasAbertas`, as que seguem com o operador. Sem outra coisa a fazer — só esperar
 * filhas paradas, sem vaga, ou `sem-saida` —, a primeira pergunta volta como hoje. A ordem não muda:
 * a pergunta que ainda não foi levada sai primeiro, e nenhuma resposta é dada aqui.
 */
export function comPerguntasAbertas(pelasRegras, abertas) {
  const vivas = (Array.isArray(abertas) ? abertas : []).filter((p) => p && typeof p.task === "string" && typeof p.motivo === "string" && p.respondidaEm == null);
  const emEspera = new Set();
  const congeladas = [];
  // `esgotou`: as regras não tinham mais nada a fazer (só esperar, ou a pergunta repetida). Aí a
  // aberta que elas não perguntaram (respondida sem `respondidaEm`, ou superada) sai em
  // `perguntasSemEco`, para a condutora consertar a lista; e também quando a ação é sobre a task
  // dela (a vigia acusou o prazo, por exemplo). Fora disso, outra ação pode só ter vindo na frente.
  const com = (d, esgotou) => {
    const semEco = vivas.filter(
      (p) => (esgotou || p.task === d.task) && !congeladas.some((c) => c.task === p.task && c.motivo === p.motivo && c.tentativa === p.tentativa),
    );
    return {
      ...d,
      ...(congeladas.length ? { perguntasAbertas: congeladas } : {}),
      ...(semEco.length ? { perguntasSemEco: semEco.map(({ task, tentativa, motivo }) => ({ task, tentativa, motivo })) } : {}),
    };
  };
  const soEspera = (d) =>
    d.motivo === "sem-saida" ||
    (d.acao === "esperar" && (d.motivo === "sem-vaga" || (d.motivo === "filhas-em-voo" && (d.emVoo ?? []).every((id) => emEspera.has(id)))));
  let primeira = null;
  for (;;) {
    const d = pelasRegras(emEspera);
    // A `task-sensivel` é uma por fase e lista as pendentes: casa pela listada em qualquer posição,
    // porque a primeira (a `task` da ação) muda com a ordem das prontas.
    const listadas = d.motivo === "task-sensivel" && Array.isArray(d.tasks) ? d.tasks.map((x) => x.task) : [d.task];
    const item =
      d.acao === "perguntar" && PERGUNTAS_QUE_ESPERAM_O_OPERADOR.includes(d.motivo)
        ? vivas.find((p) => p.motivo === d.motivo && (d.motivo === "task-sensivel" ? listadas.includes(p.task) : p.task === d.task && p.tentativa === d.tentativa))
        : null;
    if (!item) {
      if (!primeira) return vivas.length ? com(d, d.acao === "esperar") : d;
      return soEspera(d) ? com(primeira, true) : com(d, d.acao === "esperar");
    }
    primeira ??= d;
    const novas = listadas.filter((id) => !emEspera.has(id));
    // Rede: a regra que devolve a pergunta de uma task já parada não pode girar o laço.
    if (!novas.length) return com(primeira, true);
    for (const id of novas) emEspera.add(id);
    // Os itens da entrada que casaram: na `task-sensivel`, todo item dela cuja task a pergunta lista
    // (a condutora pode gravar um por task, e nenhum deles é lista velha).
    const casados = d.motivo === "task-sensivel" ? vivas.filter((p) => p.motivo === "task-sensivel" && listadas.includes(p.task)) : [item];
    for (const p of casados) if (!congeladas.some((c) => c.task === p.task && c.motivo === p.motivo && c.tentativa === p.tentativa)) congeladas.push({ task: p.task, tentativa: p.tentativa, motivo: p.motivo });
  }
}

/**
 * Os passos do ramo no fechamento da fase e do ciclo (VEGA-37 T9, §2.2#3): a
 * condutora empurra o ramo, se inscreve na proposta e lê o CI pelo próprio
 * laço, sem pedir a uma sessão acima. Sobre a ação que as regras decidiram
 * para o fechamento (`esperar ci-pendente`, `encerrar-sessao`, `fechar-ciclo`),
 * em ordem:
 *   1. `empurrar-ramo` — a ponta do ramo no origin (`ramo.noOrigin`, pela
 *      referência de rastreio) não é o HEAD;
 *   2. `inscrever-na-proposta` — empurrado e a entrada sem `inscrita: true`
 *      (a condutora chama `subscribe_pr_activity`; o script só emite);
 *   3. `esperar ci-pendente` com `passo: "ci"` — o verbo `ci` que já existe,
 *      cujo veredito a condutora põe na entrada (`ci`).
 * CI verde ou vermelho no HEAD já pressupõe o ramo no origin: a ação passa
 * como veio. Projeto sem CI (`temCi: false`, que é também sem proposta) só
 * empurra, e os dois pulos saem na ação. Sem `ramo` (árvore sem `origin`, ou
 * HEAD destacado) não há para onde empurrar e a ação passa como veio.
 *
 * Em 3 níveis (VEGA-20 T37, D10a do operador, 21/11/2026) a inscrição na
 * proposta é da maestra, do começo ao fim do ciclo: a condutora empurra e lê
 * o CI, sem `inscrever-na-proposta` e sem cobrar `inscrita` da entrada.
 */
export function comPassosDoRamo(decidida, { ramo, temCi, entrada = {}, niveis = 2 }) {
  const { ciclo, head, plano } = decidida;
  const fabrica = (tipo, alvo, tentativa, campos) => ({ acao: tipo, nonce: nonce(ciclo, alvo, tentativa, head), ciclo, head, plano, ...campos });
  const doFechamento =
    (decidida.faseSeguinte !== undefined || decidida.fase === "ciclo") &&
    (decidida.acao === "encerrar-sessao" || decidida.acao === "fechar-ciclo" || (decidida.acao === "esperar" && decidida.motivo === "ci-pendente"));
  if (!doFechamento || !ramo) return decidida;
  if (temCi && decidida.acao !== "esperar") return decidida;
  const alvo = decidida.fase;
  if (ramo.noOrigin !== head) {
    const pulos = temCi ? [] : [{ passo: "inscrever-na-proposta", motivo: "projeto-sem-proposta" }, { passo: "ci", motivo: "projeto-sem-ci" }];
    return fabrica("empurrar-ramo", `ramo:${alvo}`, 0, { fase: alvo, ramo: ramo.nome, sha: head, depois: decidida.acao, ...(pulos.length ? { pulos, motivo: gitConducao.motivoDosPulos(pulos) } : {}) });
  }
  if (!temCi) return decidida;
  if (niveis !== 3 && entrada.inscrita !== true)
    return fabrica("inscrever-na-proposta", `inscricao:${alvo}`, 0, { fase: alvo, ramo: ramo.nome, proposta: entrada.proposta?.numero ?? null, ferramenta: "subscribe_pr_activity", depois: "ci" });
  return { ...decidida, passo: "ci" };
}

/**
 * `empurrar-ramo --nonce <x>` (VEGA-37 T9): não confia em quem chama — refaz o
 * `proximo` e só empurra quando ele devolve `empurrar-ramo` com o mesmo nonce
 * (o nonce leva o HEAD: o HEAD conferido é o que o `proximo` viu). As cercas
 * de posse e de proposta e o push sem força são de `gitConducao.empurrarRamo`.
 */
export function empurrarRamo({ repo, ciclo, nonce: n, ...opcoes }) {
  if (!/^[0-9a-f]{16}$/.test(n ?? "")) throw new ErroPlano("uso", `empurrar-ramo exige --nonce, veio ${JSON.stringify(n ?? null)}`);
  const p = proximo({ repo, ciclo });
  if (p.acao !== "empurrar-ramo" || p.nonce !== n)
    throw new ErroPlano("empurrar-recusado", `o proximo devolve ${p.acao}${p.motivo ? ` ${p.motivo}` : ""} (nonce ${p.nonce}), não empurrar-ramo ${n}`);
  // Ciclo sem ramo: o principal sobe sem proposta (o `semRamo` da declaração é a exceção declarada).
  const semProposta = adaptador.modoDoCiclo(repo, ciclo).semRamo ? { temProposta: false } : {};
  return { ...gitConducao.empurrarRamo({ repo, ciclo, head: p.head, ...semProposta, ...opcoes }), fase: p.fase, nonce: n };
}

/** Raiz do plugin que carrega a skill e os verbos da condução (`<raiz>/scripts/conducao/`). */
const RAIZ_DOS_VERBOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── a ordem da troca (VEGA-37 T16, D-VEGA37-18, D-VEGA37-19) ────────────────
//
// As regras puras moram em regras.mjs (`regraPassagem`, `regraPassarNaFronteira`);
// aqui ficam o resumo que elas leem e os verbos que executam cada passo. Todo
// verbo da ordem refaz o `proximo` e só age quando ele devolve a mesma ação
// com o mesmo nonce — menos o `trazer-ramo`, que roda antes do ramo existir na
// árvore da herdeira e confere o nonce que o `criar-condutora` lhe deu.

const TIPOS_DA_PASSAGEM = new Set(["passagem", "confirmada", "desistida"]);

/** As árvores do repositório por `git worktree list --porcelain`: `{ caminho, head, ramo, destacada }`. */
export function arvoresDoRepo(repo) {
  const out = [];
  let atual = null;
  for (const l of git(repo, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (l.startsWith("worktree ")) {
      atual = { caminho: l.slice("worktree ".length), head: null, ramo: null, destacada: false };
      out.push(atual);
    } else if (!atual) continue;
    else if (l.startsWith("HEAD ")) atual.head = l.slice(5);
    else if (l.startsWith("branch ")) atual.ramo = l.slice(7).replace(/^refs\/heads\//, "");
    else if (l === "detached") atual.destacada = true;
  }
  return out;
}

function mesmoCaminho(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/**
 * O que impede de desmontar a árvore (`null` = limpa): mudança no `status`, ou
 * arquivo ignorado sob `notes/sensivel/`, que o `git worktree remove` apagaria
 * sem perguntar. Status que não se lê conta como sujo (fail-closed).
 */
export function sujeiraDaArvore(caminho) {
  const st = tentarGit(caminho, ["status", "--porcelain"]);
  if (st.status !== 0) return `status ilegível (${st.erro || `exit ${st.status}`})`;
  if (st.saida) return `${st.saida.split("\n").length} caminho(s) no status`;
  const sens = tentarGit(caminho, ["status", "--porcelain", "--ignored", "--", ":(glob)**/notes/sensivel/**"]);
  if (sens.status !== 0) return `status das notas sensíveis ilegível (${sens.erro || `exit ${sens.status}`})`;
  if (sens.saida) return `${sens.saida.split("\n").length} nota(s) sensível(is) ignorada(s)`;
  return null;
}

/**
 * A árvore da anterior (D-VEGA37-19): a única, fora esta, destacada na marca de
 * passagem — o caminho sai de `git worktree list --porcelain`, nunca da nota.
 * Nenhuma ⇒ `null` (já saiu); mais de uma ⇒ sem caminho, e nada se desmonta.
 */
export function arvoreDaAnterior(repo, passagem) {
  if (!passagem) return null;
  const propria = git(repo, ["rev-parse", "--show-toplevel"]).trim();
  const achadas = arvoresDoRepo(repo).filter((a) => a.destacada && a.head === passagem && !mesmoCaminho(a.caminho, propria));
  if (!achadas.length) return null;
  if (achadas.length > 1)
    return { caminho: null, nome: null, suja: true, motivo: `${achadas.length} árvores destacadas em ${passagem.slice(0, 8)} (${achadas.map((a) => a.caminho).join(", ")}): nenhuma se desmonta` };
  const caminho = achadas[0].caminho;
  const sujeira = sujeiraDaArvore(caminho);
  return { caminho, nome: path.basename(caminho), suja: sujeira !== null, motivo: sujeira };
}

/**
 * O resumo da passagem que as regras leem (`ctx.passagem`, comentário em
 * regras.mjs): das marcas, sem I/O; com passagem aberta ou confirmada por
 * último, também a posse (pelo leitor da cerca), o ramo anexado ou não, a
 * confirmação na ponta do ramo (a anterior destacada não a vê no HEAD) e a
 * árvore da anterior.
 */
export function resumoDaPassagem(repo, ciclo, marcas, { lerPosse = gitConducao.lerPosseDaCerca } = {}) {
  const encerradas = new Set();
  const passarDepoisDe = new Set();
  const falhas = new Map();
  const noMeio = new Map();
  const confirmadas = new Set();
  let aberta = null;
  let ultima = null;
  for (const m of marcas) {
    if (m.tipo === "encerrada") {
      encerradas.add(m.fase);
      if (m.depois === "passar") passarDepoisDe.add(m.fase);
    }
    if (!TIPOS_DA_PASSAGEM.has(m.tipo)) continue;
    ultima = m;
    if (m.tipo === "passagem") aberta = { ...m, fronteira: encerradas.has(m.fase) };
    else if (m.tipo === "desistida") {
      falhas.set(m.fase, (falhas.get(m.fase) ?? 0) + 1);
      aberta = null;
    } else {
      if (encerradas.has(m.fase)) confirmadas.add(m.fase);
      else noMeio.set(m.fase, (noMeio.get(m.fase) ?? 0) + 1);
      falhas.clear();
      aberta = null;
    }
  }
  const resumo = { aberta, ultima, falhas, noMeio, confirmadas, passarDepoisDe };
  if (!aberta && ultima?.tipo !== "confirmada") return resumo;
  let posse;
  try {
    posse = lerPosse(repo, ciclo);
  } catch (e) {
    posse = { estado: "nao-li", motivo: e.message };
  }
  const anexado = Boolean(tentarGit(repo, ["symbolic-ref", "-q", "HEAD"]).saida);
  let confirmadaNoRamo = false;
  if (aberta && !anexado && aberta.ramo) {
    const ref = `refs/heads/${aberta.ramo}`;
    if (tentarGit(repo, ["rev-parse", "--verify", "-q", ref]).status === 0)
      confirmadaNoRamo = lerMarcas(repo, ref, ciclo).some((m) => m.tipo === "confirmada" && m.confirma === aberta.sha);
  }
  // A árvore da anterior só importa a quem tem o ramo: a herdeira, para a confirmação e o desmonte.
  const sha = aberta ? (anexado ? aberta.sha : null) : posse?.estado === "dona" ? ultima.confirma : null;
  return { ...resumo, posse, anexado, confirmadaNoRamo, arvoreDaAnterior: sha ? arvoreDaAnterior(repo, sha) : null };
}

/**
 * O prompt da herdeira (VEGA-37 T16): o `trazer-ramo` com o nonce que o
 * `criar-condutora` deu, a nota, e o `proximo` na própria árvore, que segue a
 * ordem (passar-posse, inscrição, confirmação). O passar-posse vai pelo verbo
 * de posse da página do projeto, e o pré-voo da herdeira vem depois dele, que
 * é quem sobe a época conferida (VEGA-37 T49). Depois da confirmação, a
 * herdeira segue o laço da fase herdada — o desmonte da anterior, depois as
 * ações da fase até o fim (VEGA-37 T53, D-VEGA37-56). Quem arquiva a anterior é a
 * herdeira, logo depois da confirmação (`arquivar-anterior`, D19a).
 * Em 3 níveis (VEGA-20 T37) a inscrição é da maestra: o texto não manda a
 * herdeira se inscrever, nem diz que a anterior soltou.
 */
export function textoDaHerdeira({ ciclo, fase, sessao, nota, trazer, niveis: arranjo = 2 }) {
  const verbos = `node ${RAIZ_DOS_VERBOS}/scripts/conducao/conducao.mjs`;
  const anterior = sessao ?? "<id da condutora anterior>";
  if (arranjo === 3)
    return [
      `Conduzir ${ciclo} — ${fase}, como herdeira da condutora ${anterior}, pela skill ${RAIZ_DOS_VERBOS}/skills/conducao/SKILL.md. <árvore> é o diretório de trabalho desta sessão.`,
      `1. ${verbos} trazer-ramo --repo <árvore> --ciclo ${ciclo} --ramo ${trazer.ramo ?? "<ramo do ciclo>"} --passagem ${trazer.passagem} --tentativa ${trazer.tentativa} --nonce ${trazer.nonce}`,
      `2. ${verbos} proximo --repo <árvore> --ciclo ${ciclo} e seguir passar-posse. O passar-posse vai pelo verbo de posse que a página do projeto nomeia (campo pagina da declaração), com o lock_id e a época da ação; a época sobe nessa escrita. A inscrição na proposta é da maestra o ciclo inteiro: nunca subscribe_pr_activity nem unsubscribe_pr_activity aqui; a linha CI <sha8> <estado> que ela manda só acorda, e o veredito é o do gh pelo ci do proximo.`,
      `Canal e contador: fale com o operador pelo "Canal do operador" que a nota de passagem diz em Ponteiros (relé por send_message, com recibo, quando é o caso; nunca só nesta sessão se ele não a vê), e numere a próxima decisão pela "Próxima decisão" dela, sem recomeçar.`,
      `3. Depois do passar-posse, rotina de partida, nesta ordem e só com o git, o estado do harness e a nota (nunca a conversa da anterior): pré-voo (${verbos} pre-voo --repo <árvore> --ciclo ${ciclo} --herdeira; exit 1 ⇒ cada falha ao operador e parar) · estado pelo git (${verbos} retomar --repo <árvore> --ciclo ${ciclo}: tasks, avisos das operárias, CI da proposta) · a nota de passagem ${nota ?? "(campo nota do retomar)"} · a lista de tasks da fase no canonico.`,
      `4. ${verbos} proximo --repo <árvore> --ciclo ${ciclo} --entrada '{"anterior":{"sessao":"${anterior}","estado":"<estado no get_session>"}}' e seguir a ação: confirmar-passagem.`,
      `5. Depois do confirmar-passagem, seguir o laço do proximo da skill na fase herdada (${fase}), chamando ${verbos} proximo --repo <árvore> --ciclo ${ciclo} --entrada <arquivo> a cada ação, com a entrada montada pela §2 da skill (filhas, agora, ci, proposta, aprovacoes, sessaoMaestra), somando anterior (sessao ${anterior}, estado no get_session) enquanto a anterior não for desmontada: primeiro o arquivar-anterior (archive_session de ${anterior}, que já parou; somar o nonceArquivar executado em anterior.arquivamentos), depois o desmontar-anterior, que o proximo emite quando o get_session dá a anterior arquivada; depois as ações da fase, até o encerrar-sessao ou o fechar-ciclo, ou até uma pergunta ao operador.`,
    ].join("\n");
  return [
    `Conduzir ${ciclo} — ${fase}, como herdeira da condutora ${anterior}, pela skill ${RAIZ_DOS_VERBOS}/skills/conducao/SKILL.md. <árvore> é o diretório de trabalho desta sessão.`,
    `1. ${verbos} trazer-ramo --repo <árvore> --ciclo ${ciclo} --ramo ${trazer.ramo ?? "<ramo do ciclo>"} --passagem ${trazer.passagem} --tentativa ${trazer.tentativa} --nonce ${trazer.nonce}`,
    `2. ${verbos} proximo --repo <árvore> --ciclo ${ciclo} e seguir passar-posse e inscrever-na-proposta. O passar-posse vai pelo verbo de posse que a página do projeto nomeia (campo pagina da declaração), com o lock_id e a época da ação; a época sobe nessa escrita.`,
    `Canal e contador: fale com o operador pelo "Canal do operador" que a nota de passagem diz em Ponteiros (relé por send_message, com recibo, quando é o caso; nunca só nesta sessão se ele não a vê), e numere a próxima decisão pela "Próxima decisão" dela, sem recomeçar.`,
    `3. Depois do passar-posse, rotina de partida, nesta ordem e só com o git, o estado do harness e a nota (nunca a conversa da anterior): pré-voo (${verbos} pre-voo --repo <árvore> --ciclo ${ciclo} --herdeira --entrada '{"inscrita":true}'; exit 1 ⇒ cada falha ao operador e parar) · estado pelo git (${verbos} retomar --repo <árvore> --ciclo ${ciclo}: tasks, avisos das operárias, CI da proposta) · a nota de passagem ${nota ?? "(campo nota do retomar)"} · a lista de tasks da fase no canonico.`,
    `4. ${verbos} proximo --repo <árvore> --ciclo ${ciclo} --entrada '{"inscrita":true,"anterior":{"sessao":"${anterior}","estado":"<estado no get_session>"}}' e seguir a ação: inscrever-na-proposta, depois confirmar-passagem.`,
    `5. Depois do confirmar-passagem, seguir o laço do proximo da skill na fase herdada (${fase}), chamando ${verbos} proximo --repo <árvore> --ciclo ${ciclo} --entrada <arquivo> a cada ação, com a entrada montada pela §2 da skill (filhas, agora, ci, proposta, aprovacoes, sessaoMaestra), somando inscrita: true e anterior (sessao ${anterior}, estado no get_session) enquanto a anterior não for desmontada: primeiro o arquivar-anterior (archive_session de ${anterior}, que já soltou a inscrição e parou; somar o nonceArquivar executado em anterior.arquivamentos), depois o desmontar-anterior, que o proximo emite quando o get_session dá a anterior arquivada; depois as ações da fase, até o encerrar-sessao ou o fechar-ciclo, ou até uma pergunta ao operador.`,
  ].join("\n");
}

// ── níveis da condução (hotfix vega-conducao-niveis; lógica pura em niveis.mjs) ──

/**
 * O ramo do ciclo pelas referências (`refs/heads/ciclo-<id>[-<slug>]`), sem
 * depender de árvore: na passagem o ramo fica destacado, e a maestra roda de
 * qualquer árvore do mesmo repositório. Nenhum ou dois ⇒ erro, nunca escolha.
 */
export function ramoDoCiclo(repo, ciclo) {
  const r = tentarGit(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
  if (r.status !== 0) throw new ErroPlano("ramo-ilegivel", `as referências de ${repo} não se leram: ${(r.erro || "sem saída").split(String.fromCharCode(10))[0]}`);
  // Ciclo sem ramo (declarado em `semRamo`): o ramo do ciclo é o local da condução (`conducao/<id>`),
  // que acompanha o principal; ciclo-<id> não conta. A maestra o cria (`garantirRamoDaConducao`).
  const modo = adaptador.modoDoCiclo(raizDaArvore(repo), ciclo);
  if (modo.semRamo) {
    const tem = (r.saida ?? "").split("\n").some((x) => x.trim() === modo.ramo);
    if (!tem)
      throw new ErroPlano(
        "ramo-da-conducao-ausente",
        `${ciclo} é conduzido sem ramo de ciclo, no ramo local ${modo.ramo} que sobe ao ${modo.principal}, e ${repo} não tem refs/heads/${modo.ramo}: a maestra o cria; à mão, git branch --no-track ${modo.ramo} origin/${modo.principal}`,
      );
    return modo.ramo;
  }
  const achados = (r.saida ?? "").split("\n").map((x) => x.trim()).filter((x) => x && ehRamoDoCiclo(x, ciclo));
  if (achados.length !== 1)
    throw new ErroPlano(achados.length ? "ramo-do-ciclo-ambiguo" : "ramo-do-ciclo-ausente", `${achados.length} ramo(s) ciclo-${ciclo} em ${repo}${achados.length ? `: ${achados.join(", ")}` : ""} — passe --repo <árvore do ciclo>`);
  return achados[0];
}

/**
 * `niveis --ciclo <id>` sem número: em quantos níveis o ciclo roda, pelas marcas
 * (`niveisDasMarcas`): a marca antiga, o legado (2) ou o padrão (3). Nunca
 * pergunta: a condução é sempre em 3 níveis (D10c do L4, p-2fe3674c014f0735).
 * `--linhagem` segue aceito e não muda nada.
 */
export function lerNiveis({ repo, ciclo }) {
  const lido = niveisDasMarcas(lerMarcas(repo, "HEAD", ciclo));
  return { acao: "niveis", ciclo, niveis: lido.niveis, origem: lido.origem, sha: lido.sha };
}

/**
 * `pedir-herdeira --nonce <x> --entrada <a mesma do proximo>` (3 níveis): refaz
 * o `proximo` com a entrada recebida e exige `pedir-herdeira` com o nonce — o
 * da passagem, ou o `criar` do `fechar-ciclo` —, e grava o pedido no origin
 * (`gitConducao.gravarPedido`). Sai com a `mensagem` e o `para` que a condutora
 * manda à maestra por `send_message`.
 */
export function pedirHerdeira({ repo, ciclo, nonce: n, entrada }) {
  if (!/^[0-9a-f]{16}$/.test(n ?? "")) throw new ErroPlano("uso", `pedir-herdeira exige --nonce, veio ${JSON.stringify(n ?? null)}`);
  if (entrada == null || typeof entrada !== "object")
    throw new ErroPlano("sem-entrada", "pedir-herdeira exige --entrada, a mesma do proximo que emitiu a ação: o verbo refaz o proximo com ela");
  const p = proximo({ repo, ciclo, entrada });
  const acao = p.acao === "pedir-herdeira" ? p : p.acao === "fechar-ciclo" && p.criar?.acao === "pedir-herdeira" ? p.criar : null;
  if (!acao || acao.nonce !== n)
    throw new ErroPlano(
      "pedir-herdeira-recusado",
      `o pedir-herdeira refaz o proximo com a entrada recebida, e ele devolve ${p.acao}${p.motivo ? ` ${p.motivo}` : ""} (nonce ${p.nonce}), não pedir-herdeira ${n}: passe a mesma --entrada do proximo que emitiu a ação`,
    );
  gitConducao.exigirPosse({ repo, ciclo });
  const r = gitConducao.gravarPedido({ repo, ciclo, nonce: n, pedido: acao });
  if (r.acao === "perguntar") return r;
  return { ...r, fase: acao.fase, tipo: acao.tipo, para: acao.maestra, mensagem: acao.mensagem, depois: acao.depois };
}

/**
 * `maestra --ciclo <id> --sessao <id desta> --linhagem d/l --contexto usados/max
 * [--nonce <x>] [--anterior <id>] [--ordinal <k>] [--registro <json>]`: a
 * decisão da maestra (`niveis.decidirMaestra`). Com `--nonce`, o pedido que a
 * condutora gravou no origin; sem ele, a primeira condutora do ciclo, pela fase
 * que as marcas do ramo dão a conduzir. Só em ciclo de 3 níveis. A primeira
 * nasce com o texto de adotar o ramo na árvore dela (`passosDeAdotar`), e o
 * verbo solta o ramo da árvore da maestra antes de devolver a ação
 * (`soltarParaAPrimeira`; D9c do L4).
 */
export function maestra({ repo, ciclo, sessao, linhagem, contexto, nonce: n = null, anterior = null, ordinal = 1, registro = null, herdeira = null, lerPergunta = null }) {
  if (!sessao || !String(sessao).trim()) throw new ErroPlano("uso", "maestra exige --sessao <id desta sessão>");
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new ErroPlano("uso", `maestra: --ordinal deve ser inteiro ≥ 1, veio ${JSON.stringify(ordinal)}`);
  const lin = niveis.parDeInteiros(linhagem);
  const ctxt = niveis.parDeInteiros(contexto);
  let lista = [];
  if (registro) {
    try {
      lista = JSON.parse(existsSync(registro) ? readFileSync(registro, "utf8") : registro);
    } catch (e) {
      throw new ErroPlano("uso", `--registro: ${e.message}`);
    }
    if (!Array.isArray(lista)) throw new ErroPlano("uso", "--registro deve ser uma lista JSON");
  }
  let criar;
  let marcas;
  let head;
  let atendido = null;
  let propria = null;
  let anexada = null;
  let ramoDaPrimeira = null;
  let ramoDaConducao = null;
  if (n) {
    const lido = gitConducao.lerPedido({ repo, ciclo, nonce: n });
    if (lido.acao === "perguntar") return lido;
    criar = lido.pedido;
    head = lido.base;
    atendido = gitConducao.lerAtendido({ repo, ciclo, nonce: n });
    // Reservado e não atendido: a condutora pode ter nascido sem registro. Gate, nunca outra.
    if (!atendido && gitConducao.temReserva({ repo, ciclo, nonce: n }))
      return pergunta.perguntar({
        acao: "perguntar",
        nonce: n,
        ciclo,
        head,
        motivo: "pedido-em-atendimento",
        nome: criar.nome ?? null,
        detalhe: `o pedido ${n} foi reservado por uma maestra e não tem atendimento: procure por list_sessions a sessão ${criar.nome ?? "da herdeira"}; achada, maestra-atendeu --nonce ${n} --sessao-criada <id>; não achada, o operador decide`,
      });
    marcas = lerMarcas(repo, lido.base, ciclo);
  } else {
    // Ciclo sem ramo: o ramo local da condução nasce aqui, na ponta do principal do origin, sem abrir árvore.
    ramoDaConducao = gitConducao.garantirRamoDaConducao({ repo, ciclo });
    const ramo = ramoDoCiclo(repo, ciclo);
    const ref = `refs/heads/${ramo}`;
    head = git(repo, ["rev-parse", ref]).trim();
    marcas = lerMarcas(repo, ref, ciclo);
    // O ramo de planejamento (`ciclo-<id>-plano`, D11b do L4) ainda não tem plano a ler:
    // a primeira condutora dele é a de planejamento, que roda as etapas (planejar.md §3).
    const doPlano = ramo === ramoDePlanejamento(ciclo);
    let plano = null;
    if (!doPlano) {
      try {
        plano = lerPlanoNoCommit(repo, ref, ciclo).plano;
      } catch (e) {
        if (!(e instanceof ErroPlano)) throw e;
      }
    }
    const alvo = doPlano ? { fase: "planejamento", situacao: "planejamento" } : faseAConduzir(marcas, plano ? plano.fases.map((f) => f.id) : null);
    if (!alvo.fase) throw new ErroPlano("fase-ausente", `nenhuma fase a conduzir em ${ramo}: o plano não se lê nem há marca`);
    // O ramo é da condutora (D9c do L4): ela o adota na árvore dela, com as reservas
    // que a árvore que o abriu gravou — a anexada agora ou, já solto, esta (a maestra).
    propria = git(repo, ["rev-parse", "--show-toplevel"]).trim();
    anexada = arvoresDoRepo(repo).find((a) => a.ramo === ramo) ?? null;
    const reservas = reservasDaArvore(anexada?.caminho ?? propria, ciclo);
    const slug = ramo.startsWith(`ciclo-${ciclo}-`) ? ramo.slice(`ciclo-${ciclo}-`.length) : null;
    const fase = alvo.situacao === "fechamento" ? "fechamento" : alvo.fase;
    const modelo = plano?.fases.find((f) => f.id === fase)?.modelo ?? null;
    criar = {
      primeira: true,
      tipo: "primeira",
      fase,
      nome: nomeDaCondutora(ciclo, fase),
      modelo,
      texto: textoDaProximaSessao({
        ciclo,
        fase,
        repo,
        sessao: null,
        primeira: true,
        autorizada: alvo.situacao === "fase-aberta",
        adotar: {
          slug,
          migracao: Boolean(reservas?.banda),
          lane: Boolean(reservas?.lane),
          conferirReservas: reservas === null,
          posse: projetoDeclaraPosse(repo),
          ...(adaptador.modoDoCiclo(repo, ciclo).semRamo ? { principal: adaptador.modoDoCiclo(repo, ciclo).principal, ramoLocal: ramo } : {}),
        },
      }),
    };
    ramoDaPrimeira = ramo;
    n = nonce(ciclo, "maestra:primeira", 0, head);
  }
  const lidos = niveisDasMarcas(marcas);
  // Ciclo sem ramo: como o ramo local ficou (nasceu, avançou, ou a busca falhou e ele ficou como estava) sai em toda saída.
  const comRamo = (o) => (ramoDaConducao ? { ...o, ramoDaConducao } : o);
  if (lidos.niveis !== 3)
    return comRamo(pergunta.perguntar({
      acao: "perguntar",
      nonce: n,
      ciclo,
      head,
      motivo: "niveis-nao-tres",
      niveis: lidos.niveis,
      origem: lidos.origem,
      detalhe: `o ciclo roda em ${lidos.niveis ?? "nível nenhum escolhido"} (${lidos.origem}): a maestra só existe em 3 níveis — niveis 3 --sim "<texto do operador>" antes`,
    }));
  const decidida = niveis.decidirMaestra({
    ciclo,
    sessao: String(sessao).trim(),
    linhagem: lin ? { depth: lin[0], limit: lin[1] } : null,
    contexto: ctxt ? { usados: ctxt[0], max: ctxt[1] } : null,
    criar,
    nonce: n,
    ordinal,
    anterior,
    registro: lista,
    atendido,
    raiz: RAIZ_DOS_VERBOS,
    perguntar: (o) => pergunta.perguntar({ head, ...o }),
    herdeira: herdeira ? escolhaDaHerdeira({ repo, ciclo, pergunta_id: herdeira, ordinal, ler: lerPergunta }) : null,
  });
  // A reserva antes do create_session: só a maestra que a grava cria a condutora deste pedido.
  if (decidida.acao === "criar-condutora" && !criar.primeira) {
    const r = gitConducao.reservarAtendimento({ repo, ciclo, nonce: n, maestra: String(sessao).trim(), base: head });
    if (!r.reservado)
      return pergunta.perguntar({ acao: "perguntar", nonce: n, ciclo, head, motivo: "pedido-em-atendimento", nome: criar.nome ?? null, detalhe: `outra maestra reservou o pedido ${n} agora: não criar; ler o atendimento de novo`, ...(r.detalhe ? { origem: r.detalhe } : {}) });
    return { ...decidida, reserva: r.ref };
  }
  if (decidida.acao === "criar-condutora" && criar.primeira) {
    return comRamo(soltarParaAPrimeira({ repo, ciclo, head, nonce: n, decidida, ramo: ramoDaPrimeira, propria, anexada }));
  }
  return comRamo(decidida);
}

/**
 * A resposta do operador à herdeira da maestra (D13a do L4), lida no registro de perguntas pela
 * peça que já existe (`perguntas.perguntaDoAutorizar`; D17b, p-317f0e4be5157d84). Devolve
 * `{ pergunta, escolha }` com `sim` (a, só para a passagem desta maestra: o texto da opção nomeia a
 * maestra seguinte), `sempre` (b) ou `nao` (c); qualquer coisa que não se confere — registro fora
 * do ar, origem sem prova humana, pergunta de outro ciclo, escolha que não casa — sai
 * `{ escolha: null, aviso }`, e a maestra pergunta de novo: nunca passa sem o sim lido.
 */
export function escolhaDaHerdeira({ repo, ciclo, pergunta_id, ordinal, ler = null }) {
  const nada = (aviso) => ({ pergunta: pergunta_id, escolha: null, aviso });
  if (!/^p-[0-9a-f]{16}$/.test(pergunta_id ?? "")) return nada(`--herdeira fora da forma (${JSON.stringify(pergunta_id ?? null)}): perguntar de novo`);
  let r;
  try {
    const registro = ler ? null : pecasDoConsentimento(repo).perguntas;
    const leitor = ler ?? registro?.perguntaDoAutorizar?.bind(registro);
    if (typeof leitor !== "function") return nada("o projeto não declara o registro de perguntas: perguntar de novo");
    r = leitor(pergunta_id);
  } catch (e) {
    return nada(`o registro de perguntas não respondeu (${String(e?.message ?? e).split("\n")[0]}): perguntar de novo`);
  }
  if (!r || r.sem_registro === true) return nada("o registro de perguntas está fora do ar: perguntar de novo");
  if (!ORIGENS_HUMANAS.includes(r.origem)) return nada(`a resposta de ${pergunta_id} não tem prova de origem humana (${r.origem ?? "sem resposta"}): perguntar de novo`);
  // A pergunta tem de ser a da herdeira deste ciclo, como a do autorizar (exigirPerguntaDoAutorizar):
  // abertura lida, mesmo id, mesmo ciclo, o ponteiro dela e um item só. Outra pergunta do ciclo
  // respondida "b" não vira "não pergunte mais".
  const ab = r.abertura ?? null;
  if (!ab) return nada(`${pergunta_id} sem abertura no registro: perguntar de novo`);
  if (ab.pergunta_id !== undefined && ab.pergunta_id !== pergunta_id) return nada(`a abertura lida é de ${ab.pergunta_id}, não de ${pergunta_id}: perguntar de novo`);
  if (ab.ciclo !== ciclo) return nada(`${pergunta_id} é do ciclo ${JSON.stringify(ab.ciclo ?? null)}, não de ${ciclo}: perguntar de novo`);
  if (ab.ponteiro !== niveis.PONTEIRO_DA_HERDEIRA) return nada(`${pergunta_id} aponta ${JSON.stringify(ab.ponteiro ?? null)}, não ${niveis.PONTEIRO_DA_HERDEIRA}: não é a pergunta da herdeira, perguntar de novo`);
  const itens = Array.isArray(ab.itens) ? ab.itens : [];
  if (itens.length !== 1) return nada(`${pergunta_id} tem ${itens.length} itens; a da herdeira tem um só: perguntar de novo`);
  const numero = itens[0]?.numero ?? null;
  const letras = [...new Set((r.escolhas ?? []).filter((e) => numero === null || e?.numero === undefined || e.numero === numero).map((e) => e?.letra))];
  if (letras.length !== 1) return nada(`${pergunta_id} sem uma escolha só (${JSON.stringify(letras)}): perguntar de novo`);
  const letra = letras[0];
  const opcao = (itens[0].opcoes ?? []).find((o) => o?.letra === letra);
  const esperadas = Object.fromEntries(niveis.opcoesDaHerdeira(ordinal).map((o) => [o.id, o.texto]));
  if (letra === "a" && opcao?.texto !== esperadas.a) return nada(`o "só desta vez" de ${pergunta_id} foi para outra passagem: perguntar de novo`);
  if (!(letra in esperadas) || opcao?.texto !== esperadas[letra]) return nada(`a opção ${letra} de ${pergunta_id} não é a da herdeira, byte a byte: perguntar de novo`);
  return { pergunta: pergunta_id, escolha: { a: "sim", b: "sempre", c: "nao" }[letra] };
}

/**
 * A maestra solta o ramo do ciclo antes do `create_session` da primeira
 * condutora (D9c do L4), para ela o abrir na árvore dela. Só a árvore desta
 * maestra se solta, limpa e sem a posse do ciclo; ramo em outra árvore, árvore
 * suja ou posse aqui ⇒ pergunta, sem mexer em nada. Já solto ⇒ segue (o verbo
 * se repete se o `create_session` falhar).
 */
function soltarParaAPrimeira({ repo, ciclo, head, nonce: n, decidida, ramo, propria, anexada }) {
  const preso = (motivo, detalhe) => pergunta.perguntar({ acao: "perguntar", nonce: n, ciclo, head, motivo, ramo, detalhe });
  if (!anexada) return { ...decidida, ramoSolto: { ramo, de: null } };
  if (!mesmoCaminho(anexada.caminho, propria))
    return preso("ramo-preso", `o ramo ${ramo} está anexado em ${anexada.caminho}, não na árvore desta maestra: a primeira condutora não o abriria; soltar lá (git switch --detach, árvore limpa) ou o operador decide`);
  const sujeira = sujeiraDaArvore(propria);
  if (sujeira) return preso("ramo-preso", `a árvore desta maestra (${propria}) tem o ramo ${ramo} e não está limpa (${sujeira}): commitar antes de soltar`);
  let posse;
  try {
    posse = gitConducao.lerPosseDaCerca(propria, ciclo);
  } catch (e) {
    return preso("posse-ilegivel", `a posse de ${ciclo} nesta árvore não se lê (${String(e?.message ?? e).split("\n")[0]}): sem saber se a maestra a segura, o ramo não se solta`);
  }
  // null: o projeto não declara leitor da posse (a cerca pula). Fora disso só sem-posse, outra ou dona se leem.
  if (posse !== null && !["sem-posse", "outra", "dona"].includes(posse?.estado))
    return preso("posse-ilegivel", `a posse de ${ciclo} nesta árvore não se lê (${posse?.motivo ?? "sem leitura"}): sem saber se a maestra a segura, o ramo não se solta`);
  if (posse?.estado === "dona")
    return preso("posse-na-maestra", `a árvore desta maestra segura a posse de ${ciclo}: soltá-la (estado.mjs lane liberar --eixo estacao --ciclo ${ciclo}) antes, para a primeira condutora tomá-la na árvore dela`);
  git(propria, ["switch", "--quiet", "--detach"]);
  return { ...decidida, ramoSolto: { ramo, de: propria } };
}

/**
 * Os verbos da passagem que refazem o `proximo` (`acaoConferida`) e o campo da
 * entrada que muda a ação de cada um (VEGA-37 T51, achado 4 da T28): sem a
 * mesma entrada do `proximo` que os emitiu, o `proximo` interno devolve outra
 * ação (sem `herdeira`, a anterior volta ao `criar-condutora` da primeira
 * tentativa).
 */
const VERBOS_COM_A_ENTRADA = Object.freeze({
  "desanexar-ramo": null,
  "confirmar-passagem": "inscrita", // em 2 níveis; em 3 a inscrição é da maestra (T37) e o campo não muda a ação
  "retomar-da-passagem": "herdeira",
  "desmontar-anterior": "anterior",
});

/** O campo da entrada que muda a ação do verbo, no arranjo: em 3 níveis a inscrição é da maestra e `inscrita` não muda nada (T37). */
function campoDoVerbo(verbo, arranjo) {
  const campo = VERBOS_COM_A_ENTRADA[verbo] ?? null;
  return arranjo === 3 && campo === "inscrita" ? null : campo;
}

/** A ação de um verbo da passagem leva o `comando`: o verbo, o nonce e a mesma `--entrada` deste `proximo`. */
function comAEntradaDoVerbo(acao, arranjo = 2) {
  if (!Object.hasOwn(VERBOS_COM_A_ENTRADA, acao?.acao)) return acao;
  const campo = campoDoVerbo(acao.acao, arranjo);
  const extra = acao.acao === "desmontar-anterior" ? " --arquivadas <arquivo>" : "";
  return { ...acao, comando: `${acao.acao} --nonce ${acao.nonce} --entrada <a mesma deste proximo>${extra}${campo ? ` (o campo ${campo} muda a ação)` : ""}` };
}

/**
 * Refaz o `proximo` com a entrada recebida e exige a ação `tipo` com o nonce
 * `n`; devolve a ação. Sem entrada recusa (`sem-entrada`); ação diferente
 * recusa dizendo que o verbo refaz o `proximo` e pede a mesma entrada dele,
 * nomeando o campo que muda a ação — nunca outra ação calada.
 */
function acaoConferida({ repo, ciclo, entrada, tipo, nonce: n, verbo }) {
  if (!/^[0-9a-f]{16}$/.test(n ?? "")) throw new ErroPlano("uso", `${verbo} exige --nonce, veio ${JSON.stringify(n ?? null)}`);
  const campo = campoDoVerbo(verbo, niveisDasMarcas(lerMarcas(repo, "HEAD", ciclo)).niveis ?? 2);
  const doCampo = campo ? ` (o campo ${campo} muda a ação)` : "";
  if (entrada == null || typeof entrada !== "object")
    throw new ErroPlano("sem-entrada", `${verbo} exige --entrada, a mesma do proximo que emitiu ${tipo}: o verbo refaz o proximo com ela${doCampo}`);
  const p = proximo({ repo, ciclo, entrada });
  if (p.acao !== tipo || p.nonce !== n) {
    const faltou = campo && entrada[campo] === undefined ? `; a entrada recebida veio sem ${campo}` : "";
    throw new ErroPlano(
      `${verbo}-recusado`,
      `o ${verbo} refaz o proximo com a entrada recebida, e ele devolve ${p.acao}${p.motivo ? ` ${p.motivo}` : ""} (nonce ${p.nonce}), não ${tipo} ${n}: passe a mesma --entrada do proximo que emitiu a ação${doCampo}${faltou}`,
    );
  }
  return p;
}

/** `desanexar-ramo --nonce`: a anterior em passagem solta o ramo (`git switch --detach`) e fica com a posse. */
export function desanexarRamo({ repo, ciclo, nonce: n, entrada }) {
  const p = acaoConferida({ repo, ciclo, entrada, tipo: "desanexar-ramo", nonce: n, verbo: "desanexar-ramo" });
  git(repo, ["switch", "--quiet", "--detach"]);
  return { acao: "ramo-desanexado", ciclo, fase: p.fase, ramo: p.ramo, sha: p.passagem, nonce: n };
}

/**
 * `trazer-ramo --ramo <r> --passagem <sha> --tentativa <k> --nonce <x>`, na
 * árvore da herdeira (passo 3): a árvore limpa, a ponta do ramo é a marca de
 * passagem aberta, o nonce é o do `criar-condutora`; abre o ramo (`git switch`,
 * que recusa enquanto a anterior o tiver anexado) e confere o HEAD na ponta.
 */
export function trazerRamo({ repo, ciclo, ramo, passagem, tentativa, nonce: n }) {
  if (!ramo || !/^[0-9a-f]{40}$/.test(passagem ?? "") || !Number.isInteger(tentativa) || tentativa < 1 || !/^[0-9a-f]{16}$/.test(n ?? ""))
    throw new ErroPlano("uso", "trazer-ramo exige --ramo <r> --passagem <sha inteiro> --tentativa <k> --nonce <x>");
  if (n !== nonce(ciclo, `herdeira:${passagem}`, tentativa, passagem))
    throw new ErroPlano("trazer-ramo-recusado", `o nonce ${n} não é o do criar-condutora da passagem ${passagem.slice(0, 8)}, tentativa ${tentativa}`);
  const sujeira = sujeiraDaArvore(repo);
  if (sujeira) throw new ErroPlano("arvore-suja", `a árvore da herdeira não está limpa (${sujeira}): o ramo só se traz para árvore limpa`);
  const ref = `refs/heads/${ramo}`;
  const ponta = tentarGit(repo, ["rev-parse", "--verify", "-q", ref]).saida;
  if (ponta !== passagem) throw new ErroPlano("ponta-diferente", `a ponta de ${ramo} é ${ponta ? ponta.slice(0, 8) : "(ramo ausente)"}, não a passagem ${passagem.slice(0, 8)}`);
  const aberta = gitConducao.passagemAberta(lerMarcas(repo, ref, ciclo));
  if (aberta?.sha !== passagem) throw new ErroPlano("sem-passagem", `a ponta de ${ramo} não é uma passagem aberta de ${ciclo}`);
  const sw = tentarGit(repo, ["switch", "--quiet", ramo]);
  if (sw.status !== 0) throw new ErroPlano("ramo-preso", `o ramo ${ramo} não abriu aqui (${sw.erro}) — a anterior ainda o tem anexado?`);
  const head = git(repo, ["rev-parse", "HEAD"]).trim();
  if (head !== passagem) throw new ErroPlano("ponta-diferente", `o HEAD trazido é ${head.slice(0, 8)}, não a passagem ${passagem.slice(0, 8)}`);
  return { acao: "ramo-trazido", ciclo, fase: aberta.fase, ramo, ponta: head, tentativa, nonce: n };
}

/** `confirmar-passagem --nonce`: a herdeira dona fecha a passagem, com a árvore suja da anterior registrada. */
export function confirmarPassagem({ repo, ciclo, nonce: n, entrada }) {
  const p = acaoConferida({ repo, ciclo, entrada, tipo: "confirmar-passagem", nonce: n, verbo: "confirmar-passagem" });
  const arvore = arvoreDaAnterior(repo, p.passagem);
  const suja = arvore?.suja ? arvore.caminho ?? arvore.motivo : null;
  return { ...gitConducao.confirmarPassagem({ repo, ciclo, passagem: p.passagem, epoca: p.epocaNova, arvoreSuja: suja }), nonce: n };
}

/**
 * `retomar-da-passagem --nonce` (época parada, sem confirmação no prazo): a
 * anterior, que nunca deixou de ser dona, solta o ramo da árvore da herdeira
 * (limpa; suja recusa), reanexa o ramo na ponta da passagem e grava a
 * desistência. A herdeira se arquiva por quem chama (`arquivar`), nunca se reabre.
 * A posse se confere antes de mexer em ramo: alheia ou ilegível, o verbo recusa
 * sem tocar em ramo nem em árvore.
 */
export function retomarDaPassagem({ repo, ciclo, nonce: n, entrada }) {
  const p = acaoConferida({ repo, ciclo, entrada, tipo: "retomar-da-passagem", nonce: n, verbo: "retomar-da-passagem" });
  if (!p.ramo) throw new ErroPlano("sem-ramo", `a marca de passagem ${p.passagem.slice(0, 8)} não traz o ramo (Conducao-Ramo): reanexar à mão`);
  // A cerca antes de qualquer `switch` (D-VEGA37-58): com a posse de outra árvore,
  // ou ilegível, nenhum ramo troca de árvore. Sem leitor e `sem-posse` passam.
  gitConducao.exigirPosse({ repo, ciclo });
  const ponta = tentarGit(repo, ["rev-parse", "--verify", "-q", `refs/heads/${p.ramo}`]).saida;
  if (ponta !== p.passagem) throw new ErroPlano("ramo-andou", `a ponta de ${p.ramo} é ${ponta ? ponta.slice(0, 8) : "(ausente)"}, não a passagem ${p.passagem.slice(0, 8)} — alguém gravou depois dela`);
  const propria = git(repo, ["rev-parse", "--show-toplevel"]).trim();
  const presa = arvoresDoRepo(repo).find((a) => a.ramo === p.ramo && !mesmoCaminho(a.caminho, propria));
  if (presa) {
    const sujeira = sujeiraDaArvore(presa.caminho);
    if (sujeira) throw new ErroPlano("ramo-preso", `o ramo ${p.ramo} está anexado em ${presa.caminho}, que não está limpa (${sujeira}): o operador decide`);
    git(presa.caminho, ["switch", "--quiet", "--detach"]);
  }
  git(repo, ["switch", "--quiet", p.ramo]);
  const motivo = `sem confirmação da herdeira ${p.arquivar ?? "?"} em ${p.prazoMin} min; época parada: a anterior segue dona e tenta de novo`;
  return { ...gitConducao.desistirDaPassagem({ repo, ciclo, fase: p.fase, motivo }), acao: "passagem-retomada", arquivar: p.arquivar ?? null, nonce: n };
}

/**
 * `desmontar-anterior --nonce --arquivadas <arquivo>` (D-VEGA37-19): a herdeira
 * grava o nome da anterior na lista de arquivadas da limpeza (T12) e remove a
 * árvore dela por `git worktree remove`, sem `--force` — só com a anterior
 * arquivada e a árvore limpa, reconferidas aqui.
 */
export function desmontarAnterior({ repo, ciclo, nonce: n, entrada, arquivadas }) {
  if (!arquivadas) throw new ErroPlano("uso", "desmontar-anterior exige --arquivadas <arquivo da lista de arquivadas da limpeza>");
  const p = acaoConferida({ repo, ciclo, entrada, tipo: "desmontar-anterior", nonce: n, verbo: "desmontar-anterior" });
  const arvore = arvoreDaAnterior(repo, p.passagem);
  if (!arvore?.caminho || !mesmoCaminho(arvore.caminho, p.caminho)) throw new ErroPlano("arvore-trocada", `a árvore da anterior não é mais ${p.caminho}`);
  if (arvore.suja) throw new ErroPlano("arvore-da-anterior-suja", `${p.caminho}: ${arvore.motivo} — nada se apaga; o operador decide`);
  const lista = existsSync(arquivadas) ? readFileSync(arquivadas, "utf8") : "";
  if (!lista.split("\n").includes(arvore.nome)) {
    mkdirSync(path.dirname(arquivadas), { recursive: true });
    appendFileSync(arquivadas, `${lista && !lista.endsWith("\n") ? "\n" : ""}${arvore.nome}\n`);
  }
  const rm = tentarGit(repo, ["worktree", "remove", arvore.caminho]);
  if (rm.status !== 0) throw new ErroPlano("desmonte-recusado", `git worktree remove ${arvore.caminho}: ${rm.erro} — o nome ficou na lista de arquivadas, a limpeza a solta`);
  return { acao: "anterior-desmontada", ciclo, fase: p.fase, caminho: arvore.caminho, nome: arvore.nome, arquivadas, nonce: n };
}

/**
 * Texto da próxima sessão (T21), na forma de `/write-plan` §Granularidade de
 * sessão: o comando da sessão nova e o pré-voo da skill, com o arquivamento
 * da sessão que encerra antes do `retomar`. Desde a VEGA-37 T8 é o prompt do
 * `criar-condutora` que a condutora que encerra a fase executa (`anterior`:
 * "condutora anterior"); o padrão "maestra anterior" fica para quem chama
 * sem dizer.
 */
export function textoDaProximaSessao({ ciclo, fase, repo, sessao, peloCiclo = false, anterior = "maestra anterior", primeira = false, autorizada = false, adotar = null }) {
  // A primeira condutora de 3 níveis (adotar): a árvore é a da própria sessão,
  // nunca a da maestra, que solta o ramo antes do create_session.
  const arvore = adotar ? "<árvore>" : repo ?? "<worktree do ciclo conduzido>";
  const operador = adaptador.nomeDoOperador(repo);
  const verbos = `node ${RAIZ_DOS_VERBOS}/scripts/conducao/conducao.mjs`;
  return [
    adotar
      ? `Conduzir ${ciclo} — ${fase}, pela skill ${RAIZ_DOS_VERBOS}/skills/conducao/SKILL.md. <árvore> é o diretório de trabalho desta sessão: o ramo do ciclo abre nela, nunca na árvore da maestra.`
      : `Conduzir ${ciclo} — ${fase}, pela skill ${RAIZ_DOS_VERBOS}/skills/conducao/SKILL.md (worktree conduzida: ${arvore}).`,
    ...(adotar ? passosDeAdotar(ciclo, adotar) : []),
    ...(fase === "planejamento" ? textoDoPlanejamento(ciclo, verbos) : []),
  ]
    .concat(fase === "planejamento" ? [] : linhasDoLaco({ ciclo, fase, arvore, sessao, peloCiclo, anterior, primeira, autorizada, verbos, operador }))
    .join("\n");
}

/** As linhas do laço do `proximo` no texto da próxima condutora de fase (pré-voo, retomar, proximo). */
function linhasDoLaco({ ciclo, fase, arvore, sessao, peloCiclo, anterior, primeira, autorizada, verbos, operador }) {
  return [
    primeira
      ? `Pré-voo da skill §1; no passo 2, sem ${anterior} a arquivar.`
      : `Pré-voo da skill §1; no passo 2, archive_session da ${anterior} ${sessao ?? "<id da sessão que encerrou>"} antes do retomar.`,
    `${verbos} retomar --repo ${arvore} --ciclo ${ciclo}`,
    autorizada
      ? `${verbos} proximo --repo ${arvore} --ciclo ${ciclo} → ${fase} já autorizada: executar a ação emitida.`
      : peloCiclo
      ? `${verbos} proximo --repo ${arvore} --ciclo ${ciclo} → herdar-autorizacao ${fase} pelo sim do ciclo: gravar com herdar-autorizacao, sem pedir a ${operador}.`
      : `${verbos} proximo --repo ${arvore} --ciclo ${ciclo} → perguntar autorizar-ciclo ${fase}: pedir o sim do ciclo a ${operador}.`,
  ];
}

/** O nome do ramo de planejamento do ciclo (D11b do L4): slug fixo `plano`. */
export function ramoDePlanejamento(ciclo) {
  return `ciclo-${ciclo}-plano`;
}

/**
 * O que a condutora de planejamento faz depois de adotar o ramo (D5b e D16a do L4): o laço das
 * etapas de `references/planejar.md` §3 na árvore dela, sem `proximo` (não há plano ainda), e o
 * aviso à maestra para mesclar quando o `/plan-review` sai executável com CI verde (D12b).
 */
function textoDoPlanejamento(ciclo, verbos) {
  return [
    `Pré-voo da skill §1 só nos passos de repositório e inscrição (add_repo; a inscrição na proposta é da maestra); não há plano conduzível ainda, então nem retomar nem proximo.`,
    `Seguir o laço de references/planejar.md §3: cada etapa nasce do pedido de ${verbos} etapa <id> --ciclo ${ciclo} (que acha esta árvore pelo ramo), uma sessão por etapa e por rodada do /plan-review; quem empurra é a sessão do /plan-review, desta árvore.`,
    `Com o /plan-review em exit executable e o CI da proposta verde no sha empurrado: MESCLAR <número da proposta> <sha> à maestra e parar; a maestra mescla, apaga o ramo e arquiva esta sessão.`,
  ];
}

/**
 * Os passos com que a primeira condutora de 3 níveis abre o ramo na própria
 * árvore (D9c do L4): `adotar` com o slug do ramo e as reservas que a árvore
 * da maestra gravou (banda e lane são do ciclo no registro, por estação: o
 * `adotar` as relê, não reserva outras), depois a posse ali e as reservas
 * atrás dela. O lock da árvore é de cada árvore: nada passa da maestra.
 */
/**
 * O projeto declara posse (`posse` em `.vega/declaracao.json`)? Só então o texto da primeira
 * condutora cita os verbos de posse e de lane, que são do projeto (débito do ENSAIO-1 do hub,
 * 25/11/2026: o texto mandava rodar `estado.mjs lane ler` e `troca.mjs tomar-posse`, que só existem
 * na fonte). Sem declaração (a árvore do núcleo, os testes do núcleo) ou com ela ilegível ⇒ `true`:
 * na dúvida, o passo segue escrito (a condutora o lê na página do projeto), nunca some calado. Só a
 * declaração legível sem `posse` (o consumidor) tira os verbos.
 */
export function projetoDeclaraPosse(repo) {
  try {
    if (!repo || !existeDeclaracao(repo)) return true;
    return Boolean(posseDoProjeto(repo));
  } catch {
    return true;
  }
}

export function passosDeAdotar(ciclo, { slug = null, migracao = false, lane = false, conferirReservas = false, principal = null, ramoLocal = null, posse = true } = {}) {
  const flags = [slug ? ` --slug ${slug}` : "", migracao ? " --migracao" : "", lane ? " --lane" : ""].join("");
  // Ciclo sem ramo (`semRamo`): não há ramo de ciclo a adotar; a árvore abre o ramo local da
  // condução (a maestra o criou na ponta do principal do origin), e cada marca sobe ao principal.
  const abrir = principal
    ? `a. git switch ${ramoLocal} — ${ciclo} é conduzido sem ramo de ciclo: o ramo local ${ramoLocal} acompanha o ${principal}, e cada marca e cada tarefa conferida sobem por push origin HEAD:${principal}, sem força; o ${principal} aberto em outra árvore (o clone principal) não importa e não se mexe nele. ${ramoLocal} aberto em outra árvore: PARADA ramo-preso.`
    : `a. arvore.mjs adotar --ciclo ${ciclo}${flags} — abre o ramo do ciclo aqui${migracao || lane ? "; a banda e a lane do ciclo voltam as mesmas" : ""}. Ramo preso em outra árvore: PARADA ramo-preso.`;
  return [
    posse
      ? `Antes do pré-voo, na <árvore> (cwd), nesta ordem, pelos verbos de árvore e de posse que a página do projeto nomeia com o caminho (campo pagina da declaração); saída ≠ 0 em qualquer passo ⇒ PARADA <motivo> à maestra e parar:`
      : `Antes do pré-voo, na <árvore> (cwd), nesta ordem; saída ≠ 0 em qualquer passo ⇒ PARADA <motivo> à maestra e parar:`,
    ...(conferirReservas && posse
      ? [`Antes do a: estado.mjs lane ler --eixo migration e --eixo substrato; o ciclo ${ciclo} com banda ⇒ --migracao no adotar, com lane ⇒ --lane (o adotar relê a reserva do ciclo, não cria outra).`]
      : []),
    abrir,
    ...(posse ? [`b. troca.mjs tomar-posse --ciclo ${ciclo} — a posse do ciclo nesta árvore (exit 4 = posse ocupada por outra árvore: PARADA posse-ocupada, nunca --forcar).`] : []),
    ...(posse && (migracao || lane) ? [`c. estado.mjs lane transferir --ciclo ${ciclo} — as reservas seguem a posse até esta árvore.`] : []),
  ];
}

/**
 * O que a árvore que teve o ramo do ciclo gravou ao adotá-lo (`<git-dir>/sistoli-arvore.json`
 * do `arvore.mjs adotar`): banda e lane, para a primeira condutora pedir as mesmas.
 * Ausente, ilegível ou de outro ciclo ⇒ `null`.
 */
export function reservasDaArvore(caminho, ciclo) {
  const gd = tentarGit(caminho, ["rev-parse", "--absolute-git-dir"]);
  if (gd.status !== 0 || !gd.saida) return null;
  try {
    const m = JSON.parse(readFileSync(path.join(gd.saida, "sistoli-arvore.json"), "utf8"));
    if (m?.ciclo !== ciclo) return null;
    return { banda: m.banda ?? null, lane: m.lane ?? null };
  } catch {
    return null;
  }
}

/**
 * O comando que abre o fechamento do ciclo no projeto (`fechamentoDoCiclo` do
 * código do adaptador de `repo`; sem `repo`, o da árvore do núcleo; HN-29
 * T39), ou `null` se o projeto não o declara. Ilegível ⇒ `null`, com o erro
 * no stderr (o texto sai neutro, mas a falha do adaptador não some).
 */
export function fechamentoDoProjeto(repo = null) {
  try {
    return (repo ? adaptador.codigoDoAdaptador(repo) : adaptador.codigoDoNucleo()).fechamentoDoCiclo ?? null;
  } catch (e) {
    process.stderr.write(`conducao: fechamentoDoCiclo ilegível, vale o texto neutro — ${e.codigo ?? e.name}: ${e.message}\n`);
    return null;
  }
}

/**
 * Texto da sessão limpa do fechamento do ciclo (T22; HN-29 T39). O comando
 * vem do adaptador (`fechamento`, o `fechamentoDoCiclo`): com ele, a sessão
 * abre por esse comando e lê o fechamento do projeto; sem ele, a primeira
 * linha é o pedido neutro. Os verbos da condução vêm desta árvore, por
 * caminho absoluto: a auditoria e a limpeza.
 */
export function textoDoFechamento({ ciclo, repo, sessao, conduzidas, exigirEncerramentos, anterior = "maestra anterior", fechamento = fechamentoDoProjeto(repo) }) {
  const arvore = repo ?? "<worktree do ciclo conduzido>";
  const verbos = `node ${RAIZ_DOS_VERBOS}/scripts/conducao/conducao.mjs`;
  const auditar = `${verbos} auditar --repo ${arvore} --ciclo ${ciclo} --ref HEAD --exigir-fases ${conduzidas.join(",")} --exigir-encerramentos ${exigirEncerramentos.join(",")} — diferente de 0 ⇒ parar.`;
  const limpar = `${verbos} limpar --repo ${arvore} --ciclo ${ciclo}`;
  const arquivar = `archive_session da ${anterior} ${sessao ?? "<id da sessão que encerrou>"}`;
  if (!fechamento)
    return [
      `feche o ciclo ${ciclo} numa sessão limpa`,
      `Ciclo conduzido (worktree: ${arvore}); ${arquivar} antes da auditoria.`,
      `Rodar os verbos da condução por esta árvore (${RAIZ_DOS_VERBOS}):`,
      `- auditoria: ${auditar}`,
      `- limpeza: ${limpar}`,
    ].join("\n");
  return [
    // O `create_session` recusa pedido que abre com `/`: o comando vai numa frase (hotfix conducao-pedido-da-etapa).
    `Rode o ${fechamento} do ${ciclo}.`,
    `Ciclo conduzido (worktree: ${arvore}); ${arquivar} antes do Ato A.`,
    `Ler o ${fechamento} do projeto e rodar os verbos da condução por esta árvore (${RAIZ_DOS_VERBOS}):`,
    `- Ato A §8.9: ${auditar}`,
    `- Step 10.0: ${limpar}`,
  ].join("\n");
}

/**
 * `encerrar-sessao`: commit vazio `Conducao: F<n> sessao encerrada` no ramo
 * conduzido, com `Conducao-Encerrada: F<n>` e o nonce nos trailers, e a cópia
 * empurrada. O id da sessão não entra: `/clear` o mantém, e compará-lo
 * prenderia o laço. A marca já presente não grava outra; o nonce já na
 * cópia remota não grava nem empurra (VEGA-26 T10).
 */
export function encerrarSessao({ repo, ciclo, fase, nonce: n }) {
  if (!/^(F\d{1,2}|ciclo)$/.test(fase ?? "")) throw new ErroPlano("uso", `encerrar-sessao exige --fase F<n>|ciclo, veio ${JSON.stringify(fase ?? null)}`);
  if (!/^[0-9A-Za-z_-]{4,64}$/.test(n ?? "")) throw new ErroPlano("uso", `encerrar-sessao exige --nonce, veio ${JSON.stringify(n ?? null)}`);
  const remota = encerradaNaCopiaRemota(repo, ciclo, fase, n);
  if (remota)
    return {
      acao: "encerrada",
      ciclo,
      fase,
      nonce: n,
      sha: remota.sha,
      jaEstava: true,
      copia: { copia: remota.copia, empurrada: false },
      detalhe: `a sessão já estava encerrada: o marcador ${remota.sha.slice(0, 8)} com o nonce ${n} está na cópia remota; nada gravado nem empurrado, e o ramo local não recebeu o marcador (trazer a cópia para cá antes do proximo)`,
    };
  const ja = lerMarcas(repo, "HEAD", ciclo).find((m) => m.tipo === "encerrada" && m.fase === fase);
  // A marca passa pela cerca da posse (VEGA-37 T15); a cópia, no `comCopia`, também.
  if (!ja) gitConducao.exigirPosse({ repo, ciclo });
  if (!ja)
    // `Conducao-Depois: passar` (VEGA-37 T16): a fase seguinte nasce pela ordem da troca. Marca antiga, sem o
    // trailer, segue lida como antes — a sessão seguinte já criada autoriza a fase.
    git(repo, ["commit", "-q", "--allow-empty", "-m", `Conducao: ${fase} sessao encerrada`, "-m", `Conducao-Encerrada: ${fase}\nConducao-Nonce: ${n}${fase === "ciclo" ? "" : "\nConducao-Depois: passar"}${Object.entries(gitConducao.trailerDoCiclo(repo, ciclo)).map(([k, v]) => `\n${k}: ${v}`).join("")}`]);
  const sha = ja?.sha ?? git(repo, ["rev-parse", "HEAD"]).trim();
  return gitConducao.comCopia(repo, ciclo, { acao: "encerrada", ciclo, fase, nonce: n, sha, jaEstava: !!ja });
}

/**
 * O marcador de encerramento com este nonce na cópia remota, lida por
 * `ls-remote` — nunca pela referência local de rastreio, que outra estação
 * não atualizou (VEGA-26 T10, 15-a: o marcador vazio duplicado e o
 * `copia-push-falhou` da volta desktop → servidor). `null` quando a cópia
 * não existe ou não o tem; origin inalcançável lança, antes de gravar nada.
 */
function encerradaNaCopiaRemota(repo, ciclo, fase, n) {
  const ref = gitConducao.refs.copia(ciclo);
  const falhou = (r) =>
    new ErroPlano(
      "copia-remota-inalcancavel",
      `não consegui conferir a cópia remota ${ref}: ${(r.erro || "sem saída").split("\n").slice(-2).join(" | ")} — nenhum marcador gravado; conserte o acesso ao origin e rode encerrar-sessao de novo`,
    );
  const ls = tentarGit(repo, ["ls-remote", "origin", ref], { rede: true });
  if (ls.status !== 0) throw falhou(ls);
  const copia = ls.saida.split("\n").map((l) => l.split("\t")).find(([, nome]) => nome === ref)?.[0] ?? null;
  if (!copia) return null;
  if (tentarGit(repo, ["cat-file", "-e", `${copia}^{commit}`]).status !== 0) {
    // Só o FETCH_HEAD: a referência de rastreio da cópia fica como está.
    const busca = tentarGit(repo, ["fetch", "-q", "--no-tags", "origin", ref], { rede: true });
    if (busca.status !== 0) throw falhou(busca);
  }
  const log = tentarGit(repo, [
    "log",
    "-F",
    `--grep=Conducao-Nonce: ${n}`,
    "--format=%H%x1f%(trailers:key=Conducao-Encerrada,valueonly)%x1f%(trailers:key=Conducao-Nonce,valueonly)%x1e",
    copia,
  ]);
  if (log.status !== 0) throw falhou(log);
  for (const reg of log.saida.split("\x1e")) {
    const [sha, enc, non] = reg.trim().split("\x1f");
    if (sha && enc?.trim() === fase && non?.trim() === n) return { sha, copia };
  }
  return null;
}

/** Ramo do ciclo, com ou sem slug — a mesma regra do `adotar` (VEGA-26 T7). */
const ehRamoDoCiclo = (ramo, ciclo) => ramo === `ciclo-${ciclo}` || ramo.startsWith(`ciclo-${ciclo}-`);

/** A raiz da árvore que contém `de` (a declaração mora nela); sem git, o próprio `de`. */
function raizDaArvore(de) {
  const r = tentarGit(de, ["rev-parse", "--show-toplevel"]);
  return r.status === 0 && r.saida ? r.saida.trim() : de;
}

/**
 * O ramo que a árvore do ciclo tem aberto: `ciclo-<id>[-<slug>]`, ou, no ciclo declarado sem
 * ramo (`semRamo`), o ramo local da condução (`conducao/<id>`) — e aí ciclo-<id> não conta, nem o
 * principal, que fica aberto no clone principal sem ser a árvore de ninguém.
 */
export function ramoAceitoDoCiclo(repo, ciclo, ramo) {
  if (!ramo) return false;
  const modo = adaptador.modoDoCiclo(raizDaArvore(repo), ciclo);
  return modo.semRamo ? ramo === modo.ramo : ehRamoDoCiclo(ramo, ciclo);
}

/**
 * A árvore que tem o ramo do ciclo aberto, por `git worktree list --porcelain`
 * a partir de `de` (VEGA-26 T10). Só git: o núcleo da condução não importa
 * script do projeto (D-VEGA26-15). Nenhuma ⇒ manda adotar; duas ⇒ o git não
 * deixaria (sem `--force`), e é erro, nunca escolha.
 */
export function arvoreDoCiclo(ciclo, de = process.cwd()) {
  const r = tentarGit(de, ["worktree", "list", "--porcelain"]);
  if (r.status !== 0)
    throw new ErroPlano("arvore-ilegivel", `não consegui listar as árvores a partir de ${de}: ${(r.erro || "sem saída").split("\n")[0]} — passe --repo <árvore do ciclo>`);
  const blocos = [];
  for (const linha of r.saida.split("\n")) {
    if (linha.startsWith("worktree ")) blocos.push({ arvore: linha.slice("worktree ".length), ramo: null, morta: false });
    else if (blocos.length && linha.startsWith("branch refs/heads/")) blocos.at(-1).ramo = linha.slice("branch refs/heads/".length);
    // `prunable`: a pasta sumiu e o registro ficou; não é árvore de pé.
    else if (blocos.length && linha.startsWith("prunable")) blocos.at(-1).morta = true;
  }
  const modo = adaptador.modoDoCiclo(raizDaArvore(de), ciclo);
  const achadas = blocos.filter((b) => b.ramo && !b.morta && ramoAceitoDoCiclo(de, ciclo, b.ramo));
  if (!achadas.length)
    throw new ErroPlano(
      "arvore-do-ciclo-ausente",
      modo.semRamo
        ? `nenhuma árvore tem o ramo local ${modo.ramo} aberto, e ${ciclo} é conduzido sem ramo de ciclo, nele (sobe ao ${modo.principal}) — abra a árvore da condutora nele (git switch ${modo.ramo}; sem ele, git switch --no-track -c ${modo.ramo} origin/${modo.principal}) ou passe --repo <árvore>`
        : `nenhuma árvore tem o ramo ciclo-${ciclo} aberto — adote a árvore da sessão para o ciclo pelo verbo do projeto (arvore.mjs adotar --ciclo ${ciclo}) ou passe --repo <árvore>`,
    );
  if (achadas.length > 1)
    throw new ErroPlano(
      "arvore-do-ciclo-ambigua",
      `${achadas.length} árvores com ramo do ciclo ${ciclo} aberto (${achadas.map((a) => `${a.ramo} em ${a.arvore}`).join("; ")}) — passe --repo <árvore>`,
    );
  return path.resolve(achadas[0].arvore);
}

/** Verbos que leem a árvore do ciclo: sem `--repo`, ela é achada pelo ramo. */
const VERBOS_DA_ARVORE = new Set(["proximo", "conferir", "retomar"]);

// ── verbos ───────────────────────────────────────────────────────────────────

const CICLO_TASK_RE = (ciclo) =>
  new RegExp(`^${ciclo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(F\\d{1,2})[/.](T\\d{1,3}) — `);

/** Antes da primeira autorização: a fase sugerida é a primeira com task sem commit dela (sugestão, nunca prova). */
function faseSugerida(repo, ciclo, plano) {
  const re = CICLO_TASK_RE(ciclo);
  const comCommit = new Set();
  for (const s of git(repo, ["log", "--format=%s", "HEAD"]).split("\n")) {
    const m = re.exec(s);
    if (m) comCommit.add(m[2]);
  }
  return plano.fases.find((f) => f.tasks.some((t) => !comCommit.has(t)))?.id ?? null;
}

function erroComoPergunta(ciclo, head, e) {
  return pergunta.perguntar({
    acao: "perguntar",
    nonce: nonce(ciclo, "plano", 0, head),
    ciclo,
    head,
    motivo: e.codigo,
    detalhe: e.message,
  });
}

/** Epoch em segundos de um instante ISO ou de um número (já em segundos); null se ilegível. */
function epoch(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const ms = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * A unidade de usuário da ponte, da declaração (`sessao.ponte.unidade`, v5):
 * o núcleo não nomeia host nem ponte (T30, D-VEGA29-15). Declaração ilegível
 * ou sem o campo ⇒ `null`.
 */
function unidadeDaPonte(repo) {
  try {
    return adaptador.lerAdaptador(repo).sessao.ponte?.unidade ?? null;
  } catch {
    return null;
  }
}

/**
 * Hora (epoch s) em que a ponte entrou em `active` pela última vez — o
 * `ActiveEnterTimestamp` da unidade de usuário. `null` quando não se lê
 * (sem systemd de usuário, unidade ausente ou não declarada, nunca ativa).
 */
export function ponteAtivaDesde(unidade) {
  if (!unidade) return null;
  try {
    const v = execFileSync("systemctl", ["--user", "show", unidade, "-p", "ActiveEnterTimestamp", "--value", "--timestamp=unix"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
    const m = /^@(\d+)$/.exec(v);
    return m && Number(m[1]) > 0 ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * O registro do `reiniciar-ponte.sh` só cobre queda se a ponte de fato
 * (re)subiu depois dele: o verbo pede o restart com `--no-block` e grava o
 * registro ANTES (a sessão que chamou morre com o restart), então o arquivo
 * pode existir sem reinício nenhum. Confirmado = `ativaDesde` (epoch s, o
 * `ActiveEnterTimestamp`) ≥ `quando`. Registro velho confirmado por uma subida
 * posterior não estende a cobertura: o `proximo` só cobre tentativa ABERTA
 * antes de `quando` (`cobertaPorReinicio`).
 */
export function reinicioConfirmado(reinicio, ativaDesde) {
  if (!reinicio || typeof reinicio !== "object") return { valido: false, motivo: "sem-registro" };
  const quando = epoch(reinicio.quando);
  if (quando === null) return { valido: false, motivo: "registro-sem-hora" };
  if (ativaDesde === null || ativaDesde === undefined) return { valido: false, motivo: "ponte-sem-hora-de-subida", quando: reinicio.quando };
  const subida = new Date(ativaDesde * 1000).toISOString();
  if (ativaDesde < quando) return { valido: false, motivo: "ponte-nao-subiu-depois-do-registro", quando: reinicio.quando, ativaDesde: subida };
  return { valido: true, quando: reinicio.quando, ativaDesde: subida };
}

/** Lê o arquivo do `--reinicio` e o confirma pela ponte; devolve `{ reinicio, confirmacao }`. */
function carregarReinicio(arquivo, ativaDesdeFlag, repo) {
  if (!arquivo || !existsSync(arquivo)) return { reinicio: null, confirmacao: null };
  let reg;
  try {
    reg = JSON.parse(readFileSync(arquivo, "utf8"));
  } catch {
    return { reinicio: null, confirmacao: { valido: false, motivo: "registro-ilegivel" } };
  }
  const ativaDesde = ativaDesdeFlag !== undefined ? epoch(ativaDesdeFlag) : ponteAtivaDesde(unidadeDaPonte(repo));
  const confirmacao = reinicioConfirmado(reg, ativaDesde);
  return { reinicio: confirmacao.valido ? reg : null, confirmacao };
}

/**
 * Problemas de forma da entrada da maestra (T17, 20-a): lista vazia = entrada
 * legível. Confere o que o `proximo` lê (SKILL §2 passo 1) — campo de cima
 * desconhecido (typo como `filha`), lista que não é lista, campo de filha ou
 * de aprovação com tipo errado, `ci` que não é objeto, `tetoPonte` não
 * inteiro, `agora` ilegível. Campo a mais dentro de uma filha
 * passa: a sessão traz o que a API der.
 */
export function problemasDaEntrada(entrada) {
  const objeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!objeto(entrada)) return [`a entrada é ${Array.isArray(entrada) ? "lista" : typeof entrada}, esperado objeto`];
  const out = [];
  const tipo = (onde, v, ok, esperado) => {
    if (v !== undefined && v !== null && !ok(v)) out.push(`${onde}: ${JSON.stringify(v)?.slice(0, 60)}, esperado ${esperado}`);
  };
  const texto = (v) => typeof v === "string";
  const inteiro = (v) => Number.isInteger(v) && v >= 0;
  for (const k of Object.keys(entrada)) if (!CAMPOS_DA_ENTRADA.includes(k)) out.push(`campo desconhecido: ${k}`);
  const lista = (nome, item) => {
    const v = entrada[nome];
    if (v === undefined || v === null) return;
    // Objeto vazio é a lista vazia escrita à mão (`"aprovacoes": {}`, 8 paradas `entrada-invalida`
    // medidas em 20/11/2026): nada a decidir de diferente, então não para. Objeto com chave segue recusado.
    if (objeto(v) && !Object.keys(v).length) return;
    if (!Array.isArray(v)) return out.push(`${nome}: esperado lista`);
    v.forEach((x, i) => (objeto(x) ? item(x, `${nome}[${i}]`) : out.push(`${nome}[${i}]: esperado objeto`)));
  };
  lista("filhas", (f, onde) => {
    for (const k of ["sessao", "task", "nonce", "estado", "statusBucket", "aviso", "fase"]) tipo(`${onde}.${k}`, f[k], texto, "texto");
    // Último estado na fila de builds (HN-29 T52): `vez: 1` não pode passar como "não espera" calado.
    tipo(`${onde}.vez`, f.vez, texto, "texto");
    // Quando a maestra mandou a mensagem do `cutucar` à filha caída (T18).
    tipo(`${onde}.cutucadaEm`, f.cutucadaEm, (v) => epoch(v) !== null, "instante ISO ou epoch em segundos");
    // Quando quem conduz viu a queda em curso pela primeira vez (T40): `cutucadaEm` anterior não conta.
    tipo(`${onde}.caidaEm`, f.caidaEm, (v) => epoch(v) !== null, "instante ISO ou epoch em segundos");
    // `caidaEm` no futuro (relógio, ms no lugar de s) faria todo `cutucadaEm` contar como de queda velha: `cutucar` sem fim.
    if (f.caidaEm != null && epoch(f.caidaEm) !== null && epoch(f.caidaEm) > (epoch(entrada.agora) ?? Date.now() / 1000) + 60)
      out.push(`${onde}.caidaEm: ${JSON.stringify(f.caidaEm)}, depois de agora`);
    tipo(`${onde}.tentativa`, f.tentativa, inteiro, "inteiro >= 0");
    tipo(`${onde}.arquivamentos`, f.arquivamentos, (a) => Array.isArray(a) && a.every(texto), "lista de textos");
  });
  lista("aprovacoes", (a, onde) => {
    for (const k of ["task", "nonce"]) tipo(`${onde}.${k}`, a[k], texto, "texto");
  });
  // A pergunta que a condutora já levou ao operador (hotfix conducao-pergunta-aberta-nao-trava): sem
  // `task` ou `motivo` ela não congela nada, e um instante ilegível desligaria a pausa do prazo calado.
  lista("perguntasAbertas", (p, onde) => {
    // Todo campo, menos `respondidaEm`, é exigido: um motivo digitado errado nunca casaria, e a trava voltaria calada.
    for (const k of ["task", "tentativa", "motivo", "abertaEm"]) if (p[k] === undefined || p[k] === null) out.push(`${onde}.${k}: ausente`);
    tipo(`${onde}.task`, p.task, (v) => typeof v === "string" && /^T\d{1,3}$/.test(v), "T<k>");
    tipo(`${onde}.motivo`, p.motivo, (v) => PERGUNTAS_QUE_ESPERAM_O_OPERADOR.includes(v), PERGUNTAS_QUE_ESPERAM_O_OPERADOR.join(" | "));
    // A `task-sensivel` da estação condutora sai com tentativa 0.
    tipo(`${onde}.tentativa`, p.tentativa, inteiro, "inteiro >= 0");
    for (const k of ["abertaEm", "respondidaEm"]) tipo(`${onde}.${k}`, p[k], (v) => epoch(v) !== null, "instante ISO ou epoch em segundos");
    if (p.respondidaEm != null && epoch(p.respondidaEm) !== null && epoch(p.abertaEm) !== null && epoch(p.respondidaEm) < epoch(p.abertaEm))
      out.push(`${onde}.respondidaEm: antes de abertaEm`);
  });
  tipo("ci", entrada.ci, objeto, "objeto");
  if (objeto(entrada.ci)) {
    tipo("ci.sha", entrada.ci.sha, texto, "texto");
    // Veredito fora de `verde|vermelho` (`em-curso`) é CI sem veredito: `ci-pendente`, não forma errada.
    tipo("ci.veredito", entrada.ci.veredito, texto, "texto");
  }
  tipo("proposta", entrada.proposta, objeto, "objeto");
  if (objeto(entrada.proposta)) tipo("proposta.state", entrada.proposta.state, texto, "texto");
  // A condutora já chamou `subscribe_pr_activity` na proposta (T9): `"sim"` não pode passar como não inscrita calado.
  tipo("inscrita", entrada.inscrita, (v) => typeof v === "boolean", "true ou false");
  tipo("tetoPonte", entrada.tetoPonte, inteiro, "inteiro >= 0");
  tipo("agora", entrada.agora, (v) => epoch(v) !== null, "instante ISO ou epoch em segundos");
  tipo("sessaoMaestra", entrada.sessaoMaestra, texto, "texto");
  // Três níveis (hotfix vega-conducao-niveis): a maestra é a mãe desta condutora; a linhagem é a do get_session.
  tipo("maestra", entrada.maestra, texto, "texto");
  tipo("linhagem", entrada.linhagem, (v) => niveis.linhagemValida(v) !== null, "objeto { depth, limit } de inteiros");
  // A ordem da troca (VEGA-37 T16): a anterior lê a herdeira que criou (`get_session`), e a herdeira, a anterior.
  for (const lado of ["herdeira", "anterior"]) {
    tipo(lado, entrada[lado], objeto, "objeto");
    if (!objeto(entrada[lado])) continue;
    // `arquivamentos` (só a anterior): os `nonceArquivar` do `arquivar-anterior` já executados (D19a).
    // `statusBucket` (do `get_session`) e `nonce` (da ação de criar) passam calados: 2 paradas
    // `entrada-invalida` em 20/11/2026 eram só eles. Outro campo segue parando — um erro de digitação
    // (`arquivamento`, `criadaEM`) sumiria com o teto do arquivar ou o prazo da herdeira.
    const campos = [...(lado === "anterior" ? ["sessao", "estado", "criadaEm", "arquivamentos"] : ["sessao", "estado", "criadaEm"]), "statusBucket", "nonce"];
    for (const k of Object.keys(entrada[lado])) if (!campos.includes(k)) out.push(`${lado}: campo desconhecido: ${k}`);
    for (const k of ["sessao", "estado"]) tipo(`${lado}.${k}`, entrada[lado][k], texto, "texto");
    tipo(`${lado}.arquivamentos`, entrada[lado].arquivamentos, (a) => Array.isArray(a) && a.every(texto), "lista de textos");
    tipo(`${lado}.criadaEm`, entrada[lado].criadaEm, (v) => epoch(v) !== null, "instante ISO ou epoch em segundos");
  }
  return out;
}

/**
 * Motivo da recusa do `--nivel` (VEGA-37 T8): o papel maestra foi aposentado.
 * A condutora que fecha a fase cria a seguinte, e a decisão do operador chega
 * pela própria condutora, sem sessão intermediária (AC-VEGA37-1).
 */
export const MOTIVO_SEM_NIVEL =
  "proximo não tem mais nível: o papel maestra foi aposentado (VEGA-37) — a condutora que fecha a fase cria a seguinte pelo `criar` do encerrar-sessao; rode o proximo sem --nivel";

/** Campos de cima que o `proximo` lê da entrada (SKILL §2 passo 1). */
const CAMPOS_DA_ENTRADA = Object.freeze(["filhas", "aprovacoes", "ci", "proposta", "inscrita", "tetoPonte", "agora", "sessaoMaestra", "herdeira", "anterior", "maestra", "linhagem", "perguntasAbertas"]);

/**
 * A entrada com `vez: "esperando"` nas filhas cuja sessão o adaptador diz ter
 * build esperando a vez (HN-29 T52, `esperandoAVez()` do código do adaptador):
 * é o sinal que a regra da vaga lê (T25). `vez` que a entrada traga vence
 * (`null` conta como ausente, como em `problemasDaEntrada`); sem
 * a função, ou sem ninguém esperando, a entrada volta como está. A função que
 * falha não marca ninguém — todas contam como vivas, o lado seguro — e o
 * motivo sai numa linha de stderr.
 */
export function comVezDoAdaptador(repo, entrada) {
  if (!Array.isArray(entrada.filhas)) return entrada;
  let esperando;
  try {
    esperando = adaptador.esperandoAVezDoProjeto(repo);
  } catch (e) {
    if (!(e instanceof adaptador.ErroAdaptador) || e.codigo !== "vez-ilegivel") throw e;
    process.stderr.write(`conducao: vez não lida pelo adaptador (${e.message}) — nenhuma filha marcada, todas contam como vivas\n`);
    return entrada;
  }
  if (!esperando?.length) return entrada;
  const lista = new Set(esperando);
  let marcadas = 0;
  const filhas = entrada.filhas.map((f) => {
    if (f === null || typeof f !== "object" || f.vez != null || !lista.has(f.sessao)) return f;
    marcadas++;
    return { ...f, vez: "esperando" };
  });
  if (!marcadas) return entrada;
  process.stderr.write(`conducao: ${marcadas} filha(s) esperando a vez de build, lido pelo adaptador\n`);
  return { ...entrada, filhas };
}

/**
 * A entrada com o teto da ponte medido pelo adaptador (HN-29 T24): sem
 * `tetoPonte` na entrada e com a declaração `capacidade: "codigo"`, o teto é
 * filhas vivas (a mesma conta de `vagasDoTeto`) + `filhasNovas` do
 * `capacidade()` do adaptador. `tetoPonte` na entrada vence; medição `null`
 * (ou declaração sem o campo) deixa a entrada como está, e vale o teto padrão.
 */
export function comTetoDoAdaptador(repo, entrada) {
  if (Number.isInteger(entrada.tetoPonte)) return entrada;
  const cap = adaptador.capacidadeDoProjeto(repo);
  if (!cap) return entrada;
  const { vivas } = vagasDoTeto({ filhas: Array.isArray(entrada.filhas) ? entrada.filhas : [], tetoPonte: 0, tetoPadrao: 0, largura: 0, vooAtivo: [] });
  const tetoPonte = vivas + cap.filhasNovas;
  process.stderr.write(`conducao: tetoPonte ${tetoPonte} = ${vivas} viva(s) + ${cap.filhasNovas} nova(s), medido pelo adaptador${cap.texto ? ` (${cap.texto})` : ""}\n`);
  return { ...entrada, tetoPonte };
}

/**
 * `reinicio` é o registro que `reiniciar-ponte.sh` grava em todo reinício da
 * ponte (`ponte-reinicio.json`; vale o `quando`), já confirmado pela CLI
 * (`reinicioConfirmado`); a maestra o passa com `--reinicio <arquivo>`.
 * `entrada.agora` fixa o relógio da vigia (testes, replay); sem ele vale o
 * relógio da máquina.
 */
export function proximo({ repo, ciclo, entrada = {}, entradaErro = null, reinicio = null, nivel = null, historico = undefined }) {
  if (nivel !== null) throw new ErroPlano("uso", MOTIVO_SEM_NIVEL);
  voltasEmTodoProximo(repo, ciclo);
  const head = git(repo, ["rev-parse", "HEAD"]).trim();
  // Fronteira (T17, 20-a): entrada que não se lê, ou de forma errada, vira
  // pergunta; nunca decisão calada (filhas não-lista lidas como nenhuma filha).
  const problemas = entradaErro ? [entradaErro] : problemasDaEntrada(entrada);
  if (problemas.length)
    return pergunta.perguntar({
      acao: "perguntar",
      nonce: nonce(ciclo, "entrada", 0, head),
      ciclo,
      head,
      motivo: "entrada-invalida",
      problemas,
      detalhe: `a entrada do proximo não se lê: ${problemas.join("; ")} — nada foi decidido; refazer a entrada (SKILL §2 passo 1)`,
    });
  const marcas = lerMarcas(repo, "HEAD", ciclo);
  const autorizacoes = marcas.filter((m) => m.tipo === "autorizada");
  let noHead;
  try {
    noHead = lerPlanoNoCommit(repo, "HEAD", ciclo);
  } catch (e) {
    if (e instanceof ErroPlano) return erroComoPergunta(ciclo, head, e);
    throw e;
  }
  const encerradas = new Set(marcas.filter((m) => m.tipo === "encerrada").map((m) => m.fase));
  const ultima = autorizacoes.at(-1);
  if (!ultima) {
    const fase = faseSugerida(repo, ciclo, noHead.plano);
    return pergunta.perguntar({
      acao: "perguntar",
      nonce: nonce(ciclo, fase ?? "ciclo", 0, head),
      ciclo,
      head,
      plano: null,
      motivo: "autorizar-ciclo",
      fase,
      sugestao: true,
      planoNovo: noHead.blob,
      planoAnterior: null,
      mudaramDeClasse: [],
      ci: entrada.ci ?? null,
    });
  }
  let congelado;
  try {
    congelado = lerPlanoCongelado(repo, ciclo, ultima);
  } catch (e) {
    if (e instanceof ErroPlano) return erroComoPergunta(ciclo, head, e);
    throw e;
  }
  const diffPlano =
    noHead.blob !== congelado.blob ? git(repo, ["diff", congelado.blob, noHead.blob]) : null;
  // Commits que mexeram no canonico desde a autorização (F4.17), pela linha do
  // ciclo (`--first-parent`): merge entra só quando muda o canonico em relação
  // ao primeiro pai, e aí o subject dele nunca é de ruling e a herança cai na
  // pergunta. Merge de origin/main que não muda o canonico do ciclo fica de
  // fora (C24 do VEGA-28: o `--full-history` o listava porque o main tem outra
  // versão do canonico). Canonico em outro caminho ⇒ null, sem herança.
  // T43 (D-VEGA19-53): junto do subject, o trailer `Replano-Motivo` de cada re-plano, e os
  // re-planos anteriores do ciclo que o levam — a regra do re-plano sozinho recusa o motivo repetido.
  const replanos =
    diffPlano && noHead.caminho === congelado.caminho ? commitsDoCanonico(repo, `${ultima.sha}..HEAD`, noHead.caminho) : null;
  const doReplano = new Set((replanos ?? []).map((c) => c.sha));
  // Os anteriores pela história inteira, não só a linha do ciclo: re-plano que entrou por merge conta.
  const anteriores = replanos?.length
    ? commitsDoCanonico(repo, "HEAD", noHead.caminho, { linhaDoCiclo: false }).filter((c) => c.motivo && !doReplano.has(c.sha))
    : [];
  const planoHeadTexto = replanos?.length ? git(repo, ["cat-file", "-p", noHead.blob]) : null;
  // O canonico congelado na autorização: a restrição `replano` → pergunta vale pelo que o sim viu,
  // não só pelo que o re-plano escreveu (o re-plano não apaga a própria restrição).
  const planoTexto = replanos?.length ? git(repo, ["cat-file", "-p", congelado.blob]) : null;
  // O último sim do operador ao ciclo (`autorizar-ciclo`), com o plano congelado
  // nele: a régua do que o sim cobre. Marca ilegível não cobre nada.
  const marcaDoCiclo = autorizacoes.findLast((m) => m.ciclo) ?? null;
  let autorizacaoDoCiclo = null;
  if (marcaDoCiclo) {
    try {
      autorizacaoDoCiclo = { sha: marcaDoCiclo.sha, plano: lerPlanoCongelado(repo, ciclo, marcaDoCiclo).plano };
    } catch (e) {
      if (!(e instanceof ErroPlano)) throw e;
      process.stderr.write(`conducao: sim do ciclo ${marcaDoCiclo.sha.slice(0, 8)} ignorado (${e.codigo}) — cada fase pede o sim de ${adaptador.nomeDoOperador(repo)}\n`);
    }
  }
  const estado = estadoDasTasks(marcas, lerRefsLocais(repo, ciclo), gitConducao.lerTrazidas(repo, ciclo));
  // Trazida com caso consentido sem registro: a task não segue enquanto a pergunta estiver aberta (D-VEGA37-36).
  for (const r of estado.trazidas.values()) {
    const falta = gitConducao.faltaDaTrazida(repo, ciclo, r);
    if (falta !== null && !falta.length) continue;
    // Registro ilegível: o regravar não tem o que reler — sobe ao operador, sem laço (VEGA-19 T16).
    if (falta === null)
      return pergunta.perguntar({
        acao: "perguntar",
        nonce: nonce(ciclo, r.task, r.tentativa, head),
        ciclo,
        head,
        motivo: "trazida-ilegivel",
        ...gitConducao.camposDaTrazidaIlegivel({ task: r.task, tentativa: r.tentativa, registro: r.ref }),
      });
    return pergunta.perguntar({
      acao: "perguntar",
      nonce: nonce(ciclo, r.task, r.tentativa, head),
      ciclo,
      head,
      task: r.task,
      tentativa: r.tentativa,
      motivo: "consentimento-nao-gravado",
      trazido: true,
      registro: r.ref,
      faltam: falta === null ? null : falta.length,
      remedio: "regravar-consentimentos",
      comando: `regravar-consentimentos ${r.task} --tentativa ${r.tentativa}`,
      detalhe: `o trabalho da ${r.task} foi trazido; ${falta === null ? "os casos do registro trazida não se leem" : `${falta.length} caso(s) que seguiram sem pergunta estão sem registro`}. Rodar o regravar-consentimentos antes de conferir a task.`,
    });
  }
  const decl = adaptador.lerAdaptador(repo);
  // Ciclo sem ramo (`semRamo`): sem proposta, sem CI da proposta — o fechamento da fase empurra o principal e segue.
  const modo = adaptador.modoDoCiclo(repo, ciclo);
  const temCi = modo.semRamo ? false : decl.ci;
  // Ciclo sem ramo: a task feita fora da condução, com o commit dela já no principal, sai como feita
  // antes de o laço a abrir — só com o plano do HEAD igual ao congelado (plano mudado pergunta antes).
  if (modo.semRamo && !diffPlano) {
    const fora = feitaForaDaConducao({ repo, ciclo, head, plano: congelado.plano, marcas, estado, conferencia: decl.conferencia });
    if (fora) return fora;
  }
  // O arranjo gravado (`conducao.mjs niveis`); sem a marca, 2 (legado). Em 3, a inscrição na proposta é da maestra (T37).
  const arranjo = niveisDasMarcas(marcas).niveis ?? 2;
  const decidida = decidir({
    ciclo,
    head,
    niveis: arranjo,
    autorizacaoDoCiclo,
    plano: congelado.plano,
    planoBlob: congelado.blob,
    planoHead: noHead.plano,
    planoHeadBlob: noHead.blob,
    diffPlano,
    autorizacoes,
    estado,
    // A vez antes do teto: o teto medido conta as vivas, e a filha esperando a vez não é viva (T25).
    // Com o teto medido a vez é neutra (as vagas são `filhasNovas`, medido sobre a memória que já
    // inclui quem espera); só o `tetoPonte` fixado à mão a faz valer (ruling do operador 02/11/2026, 8a).
    entrada: comTetoDoAdaptador(repo, comVezDoAdaptador(repo, entrada)),
    agora: entrada.agora !== undefined ? epoch(entrada.agora) : Math.floor(Date.now() / 1000),
    reinicioEm: reinicio ? epoch(reinicio.quando) : null,
    encerradas,
    repo,
    replanos,
    anteriores,
    planoHeadTexto,
    planoTexto,
    // Casos de conferência do operador que o adaptador declara (T14) e se o
    // projeto tem CI da proposta (T15, 5-a).
    conferencia: decl.conferencia,
    temCi,
    // Saídas geradas declaradas não serializam tasks (HN-29 T23).
    geradas: saidasGeradas(repo).map((s) => s.caminho),
    // O mapa tier → modelo: a filha nasce com o do tier da task, senão o da fase.
    tiers: decl.tiers,
    // A ordem da troca (VEGA-37 T16): o resumo das marcas de passagem e, com passagem em curso, a posse e as árvores.
    passagem: resumoDaPassagem(repo, ciclo, marcas),
    // Os casos do ciclo no git: o sim da primeira publicação cobre as seguintes (D-VEGA37-52).
    consentimentos: lerConsentimentos(repo, { ciclo }),
  });
  // Os passos do ramo no fechamento (T9) vêm depois da ordem das regras, sobre a ação que ela decidiu.
  const comRamo = comAEntradaDoVerbo(comPassosDoRamo(decidida, { ramo: gitConducao.ramoNoOrigin(repo, ciclo), temCi: temCi !== false, entrada, niveis: arranjo }), arranjo);
  // Os níveis por último: em 3, quem cria a herdeira é a maestra (pedir-herdeira); em 2, a conta da cadeia.
  const comNiveis = niveis.comNiveis(comRamo, { niveis: arranjo, entrada, perguntar: pergunta.perguntar });
  // A aposentadoria depois de tudo (VEGA-20 T19): a parada que sobrou, com a instância da task do plano.
  return comAposentadoria(comNiveis, { repo, plano: congelado.plano, historico, decl });
}

/**
 * Ciclo sem ramo (hotfix vega-conducao-sem-ramo): a primeira task do plano, na ordem dele, sem
 * marca nenhuma da condução, sem tentativa e com commit no subject dela no HEAD sai como
 * `reconhecer-feita` — a condutora roda a Verificação (`verificacao: rodar`), salvo quando a task
 * declara que ela vence (`vencida`) ou é pós-merge, e grava pelo `registrar-conferencia --fora`.
 * Nenhuma ⇒ `null`, e o laço segue.
 */
export function feitaForaDaConducao({ repo, ciclo, head, plano, marcas, estado, conferencia = [] }) {
  const comMarca = new Set(marcas.filter((m) => m.task).map((m) => m.task));
  // Só a fase autorizada agora: a de depois espera o sim dela; a conferência do operador e as rodadas seguem pelo laço.
  const fase = marcas.findLast((m) => m.tipo === "autorizada")?.fase ?? null;
  let commits = null;
  for (const t of plano.tasks) {
    if (t.fase !== fase || t.rodadas || casoDeConferencia(t, conferencia)) continue;
    if (estado.feitas.has(t.id) || comMarca.has(t.id) || (estado.maxTent.get(t.id) ?? 0) > 0 || estado.emVoo.has(t.id) || estado.trazidas.has(t.id)) continue;
    commits ??= gitConducao.commitsDesdeOPlano(repo, ciclo);
    const achados = gitConducao.commitsDaTask(repo, ciclo, t, commits);
    if (!achados.length) continue;
    const verificacao = t.verificacaoVence ? "vencida" : t.posMerge ? "declarada-pos-merge" : "rodar";
    const sha = achados[0].sha;
    const registrar = `registrar-conferencia ${t.id} --fora ${sha} --verificacao ${verificacao === "rodar" ? "verde" : verificacao} --publicacao ${t.publicacao.length ? "<feita|nao-se-aplica> --sim <texto do operador>" : "nao-se-aplica"}`;
    return {
      acao: "reconhecer-feita",
      nonce: nonce(ciclo, `fora:${t.id}`, 0, head),
      ciclo,
      head,
      fase: t.fase,
      task: t.id,
      sha,
      subject: achados[0].subject,
      commits: achados.length,
      verificacao,
      passos: verificacao === "rodar" ? [`conferir ${t.id}`, registrar] : [registrar],
      detalhe:
        verificacao === "rodar"
          ? `${t.id} foi feita fora da condução (${sha.slice(0, 8)} no principal): rodar a Verificação como o conferir a devolve e, verde, gravar pelo registrar-conferencia --fora; vermelha, ao operador`
          : `${t.id} foi feita fora da condução (${sha.slice(0, 8)} no principal) e ${verificacao === "vencida" ? "declara que a Verificação vence" : "declara a Verificação pós-merge"}: gravar pelo registrar-conferencia --fora, sem rodá-la`,
    };
  }
  return null;
}

/**
 * A parada de resposta constante se aposenta (VEGA-20 T19, AC-VEGA20-1/3, D5a): a pergunta que
 * o `proximo` emitiria passa, com a instância da task do plano que ela nomeia
 * (`instanciaDaParada`), a `calibracao.consulta` (T6), que veta pela marca da instância —
 * publicação, caminho protegido ou clínico, as exclusões de `consentimento.mjs`, salvo
 * `canonico-do-ciclo` (D-VEGA20-18) — antes de olhar o histórico. Veredito `aposentado` ⇒ a ação
 * `aposentada` (`acaoDaAposentadoria`), com a resposta constante, a linha do relato e o comando
 * `aposentar --nonce`, que grava o commit com o trailer `Conducao-Aposentada`. Qualquer outra
 * coisa ⇒ a parada como veio. A aposentadoria já gravada para a mesma task e motivo, e a parada
 * de volta, para: a resposta aplicada não a fechou, e quem decide é o operador.
 *
 * `historico`: o histórico da calibração (teste); sem ele, o do log e do adaptador
 * (`historicoDaParada`), lido só quando a instância passa os vetos. Erro na leitura ⇒ a parada.
 */
export function comAposentadoria(saida, { repo, plano, historico = undefined, decl = null }) {
  if (saida?.acao !== "perguntar" || !pergunta.foiConstruida(saida)) return saida;
  // Os caminhos que a trazida mudou de fora dos Outputs e os protegidos do adaptador entram na instância:
  // a tela clínica dos Steps, que o trazer libera, para aqui (registro ilegível ⇒ a parada segue).
  let extras = [];
  let protegidos = [];
  let definemAParada = null;
  try {
    const r = gitConducao.lerTrazidas(repo, saida.ciclo).find((x) => x.task === saida.task && (!Number.isInteger(saida.tentativa) || x.tentativa === saida.tentativa));
    if (r && !Array.isArray(r.foraDosOutputs)) return saida;
    extras = r?.foraDosOutputs ?? [];
    const codigo = adaptador.codigoDoAdaptador(repo);
    protegidos = [...(codigo.caminhosProtegidos ?? []), ...(codigo.caminhosQuePerguntam ?? [])];
    // Adaptador sem a lista do que define a parada: fica `null` e o veto sai `define-a-parada`.
    try {
      definemAParada = definemAParadaDe(codigo);
    } catch (e) {
      process.stderr.write(`conducao: ${e.message} — a parada segue\n`);
      definemAParada = null;
    }
  } catch (e) {
    process.stderr.write(`conducao: instância da parada não lida (${e.message}) — a parada segue\n`);
    return saida;
  }
  const instancia = instanciaDaParada(saida, plano, { extras, protegidos });
  if (!instancia) return saida;
  const instrucoes = decl?.sessao?.instrucoes ?? [];
  if (calibracao.vetoDaInstancia(saida.motivo, instancia, { instrucoes, definemAParada })) return saida;
  // Motivo que não vira o sujeito da marca: o commit não seria lido e a mesma parada se reaplicaria sem fim.
  if (!RE.aposentada.test(`Conducao: ${saida.task} aposentada ${saida.motivo}`)) return saida;
  // O desfazer de uma aposentadoria (VEGA-20 T20) entra no log antes do histórico: o motivo desfeito
  // volta a `observacao`. Sem ler ou gravar a volta, a parada segue (nunca reaplicar o desfeito).
  try {
    registrarVoltasDoRamo(repo, saida.ciclo, decl);
  } catch (e) {
    if (e instanceof ErroGitPrazo) throw e;
    process.stderr.write(`conducao: a volta da aposentadoria não foi lida (${e.message}) — a parada ${saida.motivo} segue\n`);
    return saida;
  }
  try {
    const h = historico === undefined ? historicoDaParada(repo, saida.motivo) : historico;
    const c = calibracao.consulta(saida.motivo, h, instancia);
    // Histórico ilegível desliga a aposentadoria: a parada segue, e o porquê sai no stderr, nunca calado.
    if (c.erro) process.stderr.write(`conducao: calibração sem histórico (${c.erro}) — a parada ${saida.motivo} segue\n`);
    if (c.veredito !== "aposentado") return saida;
    // Uma aposentadoria por task e motivo: o nonce muda com o HEAD (o próprio commit a muda), e a
    // resposta que abre tentativa nova (o não da conferência) se reaplicaria a cada rodada.
    if (lerAposentadas(repo, "HEAD", saida.ciclo ?? null).some((x) => x.task === saida.task && x.motivo === saida.motivo))
      return { ...saida, aposentadaAplicada: true, detalhe: `a resposta constante de ${saida.motivo} já foi aplicada nesta task e a parada voltou: decide o operador` };
    const decisoes = (h?.porMotivo?.get(saida.motivo)?.entradas ?? []).map((e) => e.decisao);
    const a = acaoDaAposentadoria(saida, c, { decisoes });
    return a ? { ...a, decisao: pergunta.decisaoDe(saida).id } : saida;
  } catch (e) {
    process.stderr.write(`conducao: calibração não lida (${e.message}) — a parada segue\n`);
    return saida;
  }
}

/**
 * O histórico da calibração para a parada `motivo`: o log do adaptador; só com perguntas
 * registradas do motivo bastantes para o degrau `aposentado` (`SEQUENCIAS_PARA_APOSENTAR` + 1
 * decisões distintas: com menos, nenhuma série chega lá) ele pede as respostas ao adaptador
 * (`calibracao.carregarHistorico`), que é uma consulta ao registro do projeto. Com menos, o
 * histórico sem respostas: a parada segue, sem a consulta.
 */
function historicoDaParada(repo, motivo) {
  const decl = adaptador.lerAdaptador(repo);
  const lido = calibracao.lerLinhasDoLog([decl.pastaDoLog, decl.pastaDaPergunta]);
  if (lido.erro) return calibracao.historicoComErro(lido.erro);
  const decisoes = new Set();
  for (const l of lido.linhas)
    if (l.linha === "evento" && l.acao === calibracao.ACAO_DA_PERGUNTA && l.atributos?.motivo === motivo && typeof l.atributos.decisao === "string") decisoes.add(l.atributos.decisao);
  if (decisoes.size <= calibracao.SEQUENCIAS_PARA_APOSENTAR) {
    // O histórico curto leva a mesma lista do que define a parada que `carregarHistorico` leva.
    let definemAParada;
    try {
      definemAParada = definemAParadaDe(adaptador.codigoDoAdaptador(repo));
    } catch {
      return calibracao.historicoComErro("adaptador-sem-definem-a-parada");
    }
    return calibracao.historicoDe({ linhas: lido.linhas, respostas: [], instrucoes: decl.sessao?.instrucoes ?? [], definemAParada });
  }
  return calibracao.carregarHistorico(repo);
}

/**
 * Os commits da aposentadoria do ramo (`aposentar --nonce`, marca `aposentada` de `marcas.mjs`),
 * do mais velho ao mais novo: `{ sha, task, motivo, nonce, resposta, iguais, tentativa }`.
 */
export function lerAposentadas(repo, ref = "HEAD", ciclo = null) {
  return lerMarcas(repo, ref, ciclo)
    .filter((m) => m.tipo === "aposentada")
    .map(({ sha, task, motivo, nonce, resposta, iguais, tentativa }) => ({ sha, task, motivo, nonce, resposta, iguais, tentativa }));
}

/**
 * O desfazer entra no log em todo `proximo` (VEGA-20 T20), não só na parada do motivo: o histórico
 * da calibração é de todos os ciclos. Falha aqui só avisa (a parada do motivo a cobra de novo, e
 * para); o prazo do git sobe como em todo verbo.
 */
function voltasEmTodoProximo(repo, ciclo) {
  // Sem HEAD não há marca a desfazer; o erro do ramo vazio é o do proximo, que vem logo depois.
  if (tentarGit(repo, ["rev-parse", "--verify", "-q", "HEAD"]).status !== 0) return;
  try {
    registrarVoltasDoRamo(repo, ciclo);
  } catch (e) {
    if (e instanceof ErroGitPrazo) throw e;
    process.stderr.write(`conducao: a volta da aposentadoria não foi gravada (${e.message})\n`);
  }
}

/**
 * Os commits do ramo que dizem do desfazer (VEGA-20 T20), do mais velho ao mais novo: as marcas
 * `aposentada` e `rodada`, e os que trazem `This reverts commit` no corpo.
 * `{ sha, subject, corpo, quando }`, `quando` = a data do commit.
 */
function commitsDoDesfazer(repo, ref = "HEAD", ciclo = null) {
  const bruto = git(repo, [
    "log",
    "--reverse",
    "--topo-order",
    "--extended-regexp",
    "--grep=^Conducao: T[0-9]{1,3} (aposentada |tentativa [0-9]+ rodada$)",
    "--grep=^This reverts commit [0-9a-f]{7,40}",
    "--format=%H%x1f%s%x1f%cI%x1f%b%x1e",
    ref,
  ]);
  return bruto
    .split("\x1e")
    .map((r) => r.replace(/^\n/, ""))
    .filter(Boolean)
    .map((r) => {
      const [sha, subject, quando, corpo = ""] = r.split("\x1f");
      return { sha, subject, quando, corpo };
    })
    // A marca de outro ciclo (ciclo sem ramo, no principal) não volta neste.
    .filter((c) => !gitConducao.deOutroCiclo(c.corpo, ciclo));
}

/**
 * Grava no log o evento `volta` de cada aposentadoria desfeita no ramo (VEGA-20 T20): o revert da
 * marca `aposentada`, ou o não da conferência do que ela trouxe (`verbos.voltasDoRamo`).
 * Procedência `registrado` (o fato está no git), horário do commit que desfez: repetir não duplica
 * (a chave do log é o conteúdo). Devolve as voltas; erro sobe para quem chama.
 */
export function registrarVoltasDoRamo(repo, ciclo, decl = null) {
  const aposentadas = lerAposentadas(repo, "HEAD", ciclo);
  if (!aposentadas.length) return [];
  const voltas = voltasDoRamo({ aposentadas, commits: commitsDoDesfazer(repo, "HEAD", ciclo), textoDaCalibracao: TEXTO_DA_CALIBRACAO });
  if (!voltas.length) return [];
  const pasta = (decl ?? adaptador.lerAdaptador(repo)).pastaDoLog;
  for (const ev of eventosDaVolta({ ciclo, voltas })) {
    const { quando, ...saida } = ev;
    logEventos.registrar(saida, { procedencia: "registrado", quando: quando ?? undefined, pasta });
  }
  return voltas;
}

/**
 * `voltar-a-perguntar --motivo <m> --recibo "<sessao> <evento>"` (VEGA-20 T20, AC-VEGA20-2): a
 * frase do operador na conversa, gravada pela sessão — o operador não ganha comando. Grava no log o
 * evento `volta` (procedência `observado`), que a calibração lê como recomeço do histórico do
 * motivo: ele volta ao degrau `observacao` e para na próxima vez.
 */
export function voltarAPerguntar({ ciclo, motivo, recibo, decl, quando = undefined }) {
  const v = exigirVoltaAMando({ motivo, recibo });
  // O motivo tem de ter parado alguma vez: o erro de digitação gravaria a volta de um fantasma, e o real seguiria aposentado.
  const lido = calibracao.lerLinhasDoLog([decl.pastaDoLog, decl.pastaDaPergunta]);
  if (lido.erro) throw new ErroPlano("log-ilegivel", `voltar-a-perguntar não leu o log (${lido.erro}): nada gravado`);
  const conhecido = lido.linhas.some((l) => l.linha === "evento" && l.acao === calibracao.ACAO_DA_PERGUNTA && l.atributos?.motivo === v.motivo);
  if (!conhecido) throw new ErroPlano("motivo-desconhecido", `nenhuma parada ${v.motivo} no log: confira o motivo — nada gravado`);
  const saida = eventoDaVoltaAMando({ ciclo, ...v });
  const r = logEventos.registrar(saida, { procedencia: "observado", quando, pasta: decl.pastaDoLog });
  // O mesmo recibo de novo não grava (a chave é o conteúdo): a volta já está, com o horário da primeira.
  return { acao: r.novo ? "volta-registrada" : "volta-ja-registrada", ciclo, motivo: v.motivo, desfecho: saida.desfecho, recibo: v.recibo, ...r };
}

/** A linha do relato de uma aposentadoria gravada. */
export function linhaDaAposentada(a) {
  return `seguiu sozinha: ${a.motivo} (${a.iguais ?? "?"} iguais)`;
}

/**
 * `aposentar --nonce <x> [--entrada <json>]` (VEGA-20 T19): grava o commit que a aposentadoria produz. Não confia em
 * quem chama: refaz o `proximo` e só grava quando ele devolve `aposentada` com o mesmo nonce. O
 * commit é vazio, `Conducao: <task> aposentada <motivo>`, com os trailers `Conducao-Aposentada`,
 * `Conducao-Nonce`, `Conducao-Resposta` e `Conducao-Iguais`. Depois dele a condutora aplica a
 * opção da resposta constante (`opcao`) como aplicaria a resposta do operador.
 */
export function aposentar({ repo, ciclo, nonce: n, entrada = {}, historico = undefined }) {
  if (!/^[0-9a-f]{16}$/.test(n ?? "")) throw new ErroPlano("uso", `aposentar exige --nonce, veio ${JSON.stringify(n ?? null)}`);
  const p = proximo({ repo, ciclo, entrada, historico });
  if (p.acao !== "aposentada" || p.nonce !== n)
    throw new ErroPlano("aposentadoria-recusada", `o proximo devolve ${p.acao}${p.motivo ? ` ${p.motivo}` : ""} (nonce ${p.nonce}), não aposentada ${n}`);
  const subject = `Conducao: ${p.task} aposentada ${p.motivo}`;
  if (!RE.aposentada.test(subject)) throw new ErroPlano("aposentadoria-recusada", `o sujeito ${JSON.stringify(subject)} não é a marca aposentada`);
  gitConducao.exigirPosse({ repo, ciclo });
  const corpo = [`Seguiu sozinha, pela calibração: ${p.motivo} com a resposta ${p.resposta} (${p.n} iguais, ${p.sequencias} sequências).`];
  const trailers = [`${TRAILER_DA_APOSENTADA}: ${p.motivo}`, `Conducao-Nonce: ${n}`, `Conducao-Resposta: ${p.resposta}`, `Conducao-Iguais: ${p.n}`, `Conducao-Task: ${p.task}`, ...(Number.isInteger(p.tentativa) ? [`Conducao-Tentativa: ${p.tentativa}`] : []), ...Object.entries(gitConducao.trailerDoCiclo(repo, ciclo)).map(([k, v]) => `${k}: ${v}`)];
  git(repo, ["commit", "-q", "--allow-empty", "-m", subject, "-m", corpo.join("\n"), "-m", trailers.join("\n")]);
  const sha = git(repo, ["rev-parse", "HEAD"]).trim();
  return gitConducao.comCopia(repo, ciclo, {
    acao: "aposentada-registrada",
    ciclo,
    task: p.task,
    ...(p.fase !== undefined ? { fase: p.fase } : {}),
    motivo: p.motivo,
    resposta: p.resposta,
    n: p.n,
    sequencias: p.sequencias,
    ...(p.decisoes ? { decisoes: p.decisoes } : {}),
    decisao: p.decisao,
    por: p.por,
    nonce: n,
    sha,
    opcao: p.opcao,
    relato: p.relato,
    textoDeQuemResponde: p.textoDeQuemResponde,
  });
}

/**
 * Os commits da linha do ciclo (`--first-parent`) que mexeram em `caminho` no intervalo `faixa`,
 * com o subject e os trailers `Replano-Motivo` (T43) e `Replano-Pergunta`: `{ sha, subject, motivo,
 * pergunta }`, null no que faltar. Registro por `%x1e`: o trailer vem depois do subject e pode faltar.
 */
function commitsDoCanonico(repo, faixa, caminho, { linhaDoCiclo = true } = {}) {
  const fmt = `--format=%H%x1f%s%x1f%(trailers:key=${TRAILER_REPLANO_MOTIVO},valueonly=true,separator=%x2c)%x1f%(trailers:key=${TRAILER_REPLANO_PERGUNTA},valueonly=true,separator=%x2c)%x1f%P%x1e`;
  return git(repo, ["log", ...(linhaDoCiclo ? ["--first-parent"] : []), fmt, faixa, "--", caminho])
    .split("\x1e")
    .map((r) => r.replace(/^\n+/, ""))
    .filter(Boolean)
    .map((r) => {
      const [sha, subject = "", motivo = "", pergunta = "", pais = ""] = r.split("\x1f");
      // `merge`: o commit tem mais de um pai — o canonico chegou de fora do ciclo (merge de main).
      return { sha: sha.trim(), subject, motivo: motivo.trim() || null, pergunta: pergunta.trim() || null, merge: pais.trim().split(/\s+/).filter(Boolean).length > 1 };
    });
}

/**
 * `herdar-autorizacao F<n> --nonce <x>` (F4.17): grava a autorização herdada
 * pelo re-plano de ruling ou pelo sim do ciclo (`autorizar-ciclo`, origem
 * `ciclo`). Não confia em quem chama: refaz o `proximo` e só
 * grava quando ele devolve `herdar-autorizacao` da mesma fase e do mesmo nonce.
 * O sim que a herança segue é o que está no git (a marca `autorizada` de
 * origem): a herdeira não pede o sim de novo nem o recebe por mensagem
 * (T20); os casos da ação ficam registrados por `consentimento.mjs`.
 */
export function herdarAutorizacao({ repo, ciclo, fase, nonce: n }) {
  if (!/^F\d{1,2}$/.test(fase ?? "")) throw new ErroPlano("uso", `herdar-autorizacao exige F<n>, veio ${JSON.stringify(fase ?? null)}`);
  if (!/^[0-9a-f]{16}$/.test(n ?? "")) throw new ErroPlano("uso", `herdar-autorizacao exige --nonce, veio ${JSON.stringify(n ?? null)}`);
  const p = proximo({ repo, ciclo });
  if (p.acao !== "herdar-autorizacao" || p.fase !== fase || p.nonce !== n)
    throw new ErroPlano(
      "heranca-recusada",
      `o proximo devolve ${p.acao}${p.motivo ? ` ${p.motivo}` : ""}${p.fase ? ` ${p.fase}` : ""} (nonce ${p.nonce}), não herdar-autorizacao ${fase} ${n}`,
    );
  // VEGA-37 T20 (D-VEGA37-35), VEGA-19 T16: os casos que a ação traz ficam registrados antes da
  // marca herdada, com o sim lido da marca de origem, o gate irmão que só aceita esse corpo, byte a
  // byte, o de PHI do projeto e — com a pergunta citada pelo sim do ciclo — a origem humana dela
  // (D-VEGA19-39). Ordem: conferir os casos e a herança sem escrever; só então gravar os casos e a
  // herança (débito `conducao-gravar-casos-herdados-antes-da-heranca`). Falha ao conferir ⇒ nada
  // gravado: o próximo `herdar-autorizacao` refaz.
  // D-VEGA19-41: a pergunta citada pela marca de origem se confere aqui, mesmo sem casos a gravar —
  // o ciclo, a fase e o sim da marca que a usou, a opção escolhida e o uso único. Peças carregadas
  // uma vez para as duas conferências; falha de carga recusa (nunca vira consentimento).
  const pecas = pecasDoConsentimento(repo);
  gitConducao.conferirPerguntaDaHeranca({ repo, ciclo, autorizacao: p.autorizacao, pecas });
  const preparados = prepararCasosHerdados({
    repo,
    ciclo,
    pedidos: [p.consentimento, ...(p.consentimentos ?? [])],
    quem: adaptador.nomeDoOperador(repo),
    pecas,
  });
  gitConducao.conferirHeranca({ repo, ciclo, fase, autorizacao: p.autorizacao, replanos: p.replanos, planoNovo: p.planoNovo, origem: p.origem ?? "replano", replanoMotivo: p.replanoMotivo ?? null });
  const consentimentos = escreverCasosHerdados({
    repo,
    preparados,
    cerca: () => gitConducao.exigirPosse({ repo, ciclo }),
  }).map((c) => ({ sha: c.sha, caso: c.registro.caso, ...(c.registro.task ? { task: c.registro.task } : {}), ...(c.pergunta ? { pergunta: c.pergunta } : {}) }));
  const r = gitConducao.registrarHeranca({ repo, ciclo, fase, autorizacao: p.autorizacao, replanos: p.replanos, planoNovo: p.planoNovo, origem: p.origem ?? "replano", replanoMotivo: p.replanoMotivo ?? null });
  process.stderr.write(`conducao: ${p.aviso}\n`);
  // T43: o re-plano que seguiu sozinho passa o aviso ao operador com o motivo e o `replano:<sha8>`;
  // o pré-autorizado (ruling de 23/11/2026), o aviso e o `replano:<sha8>`.
  return { ...r, aviso: p.aviso, consentimentos, ...(p.origem === "sozinho" ? { avisarOperador: true, replanoMotivo: p.replanoMotivo, ponteiro: p.ponteiro, recibo: p.recibo ?? null } : {}), ...(p.origem === "preautorizado" ? { avisarOperador: true, ponteiro: p.ponteiro } : {}) };
}

/** Aspas simples de shell. */
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function embrulharSemProducao(comando, { marcaSemCofre = adaptador.MARCA_SEM_COFRE_PADRAO, variaveisDeProducao = [] } = {}) {
  const partes = ["env", ...variaveisDeProducao.flatMap((v) => ["-u", v]), `${marcaSemCofre}=1`, "bash", "-c", shq(comando)];
  return partes.join(" ");
}

const BUILTINS = new Set([
  "cd", "test", "[", "[[", "export", "echo", "true", "false", ":", "exit", "return", "printf",
  "set", "unset", "shift", "read", "local", "source", ".", "pwd", "eval", "exec", "wait",
]);
/**
 * Palavras-chave de shell (C24 do VEGA-28: `for`/`do`/`done` da T10 do ATRM-52
 * saíam `binario-ausente`). As de PREFIXO vêm antes de um comando: pula-se a
 * palavra e o comando seguinte conta. As de SEGMENTO abrem cabeçalho sem
 * comando (`for x in …`, `case … in`): o segmento inteiro fica de fora. As de
 * FECHO não carregam comando.
 */
const PALAVRAS_DE_PREFIXO = new Set(["if", "then", "else", "elif", "do", "while", "until", "{", "!", "time"]);
const PALAVRAS_DE_SEGMENTO = new Set(["for", "case", "select", "function"]);
const PALAVRAS_DE_FECHO = new Set(["fi", "done", "esac", "}"]);

/**
 * Primeiro executável de cada segmento (`&&`, `||`, `;`, `|`, fim de linha),
 * fora de aspas e de parênteses, pulando atribuição `VAR=…`, palavra-chave de
 * shell e builtin. Palavra com `$` não se resolve sem rodar: fica de fora,
 * nunca acusada.
 */
export function executaveisDaVerificacao(comando) {
  const segmentos = [];
  let atual = "", aspa = null, prof = 0;
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i];
    if (aspa) {
      if (c === "\\" && aspa === '"') { atual += c + (comando[++i] ?? ""); continue; }
      if (c === aspa) aspa = null;
      atual += c;
      continue;
    }
    if (c === "\\") { atual += c + (comando[++i] ?? ""); continue; }
    if (c === "'" || c === '"') { aspa = c; atual += c; continue; }
    if (c === "(") prof++;
    if (c === ")" && prof > 0) prof--;
    if (prof === 0 && (c === ";" || c === "|" || c === "\n" || (c === "&" && comando[i + 1] === "&"))) {
      if (c === "&" || (c === "|" && comando[i + 1] === "|")) i++;
      segmentos.push(atual);
      atual = "";
      continue;
    }
    atual += c;
  }
  segmentos.push(atual);
  const nomes = [];
  for (const seg of segmentos) {
    // Braço de `case` (`a) cmd`, `*) cmd`): o padrão antes do `)` não é comando.
    const palavras = palavrasDoSegmento(seg.trim().replace(/^[^\s()]+\)(?:\s+(?=\S)|\s*$)/, ""));
    let p = 0;
    while (
      p < palavras.length &&
      (PALAVRAS_DE_PREFIXO.has(palavras[p]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(palavras[p]) || (p > 0 && palavras[p].startsWith("-") && PALAVRAS_DE_PREFIXO.has(palavras[p - 1])))
    )
      p++;
    // `time -p -v x`: opções seguidas de um prefixo também ficam para trás.
    while (p > 0 && p < palavras.length && palavras[p].startsWith("-") && palavras.slice(0, p).some((w) => PALAVRAS_DE_PREFIXO.has(w))) p++;
    if (PALAVRAS_DE_SEGMENTO.has(palavras[p])) continue;
    // Subshell `( … )` é uma palavra só: conta a primeira de dentro.
    const primeira = palavras[p]?.replace(/^[({]+/, "").split(/\s+/)[0]?.replace(/^(['"])(.*)\1$/, "$2");
    // Opção (`-n`, `-v`) nunca é comando: é sobra de leitura, não binário.
    if (!primeira || primeira.startsWith("-") || primeira.includes("$") || BUILTINS.has(primeira) || PALAVRAS_DE_FECHO.has(primeira)) continue;
    nomes.push(primeira);
  }
  return [...new Set(nomes)];
}

/**
 * As palavras de um segmento, cortadas em espaço só fora de aspas e de
 * parênteses (hotfix conducao-corta-paradas-de-regra): `S=$(gh api …)`,
 * `G=$(mktemp -d)/x` e `V="$(command -v y)"` são uma atribuição só. Cortar em
 * todo espaço fazia `api`, `rev-parse`, `-n`, `-v` e `-d)/x` saírem como
 * binário ausente.
 */
function palavrasDoSegmento(seg) {
  const out = [];
  let atual = "", aspa = null, prof = 0;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (aspa) {
      if (c === "\\" && aspa !== "'") { atual += c + (seg[++i] ?? ""); continue; }
      if (c === aspa) aspa = null;
      atual += c;
      continue;
    }
    if (c === "\\") { atual += c + (seg[++i] ?? ""); continue; }
    if (c === "'" || c === '"' || c === "`") { aspa = c; atual += c; continue; }
    if (c === "(") prof++;
    if (c === ")" && prof > 0) prof--;
    if (prof === 0 && /\s/.test(c)) {
      if (atual) out.push(atual);
      atual = "";
      continue;
    }
    atual += c;
  }
  if (atual) out.push(atual);
  return out;
}

function noPath(nome, repo, PATH = process.env.PATH ?? "") {
  const executavel = (f) => {
    try { accessSync(f, fsConstants.X_OK); return true; } catch { return false; }
  };
  if (nome.includes("/")) return executavel(path.resolve(repo, nome));
  return PATH.split(path.delimiter).filter(Boolean).some((d) => executavel(path.join(d, nome)));
}

/**
 * Verificação da task no plano congelado na última autorização, sem as variáveis de produção.
 * Binário ausente no PATH da maestra (achado T10 da T18: `npx --no-install deno`
 * sem deno na estação) vira `perguntar binario-ausente` com os nomes — a
 * Verificação crua nunca sai, para não ser trocada à mão em silêncio.
 */
export function conferir({ repo, ciclo, task }) {
  const autorizacoes = lerMarcas(repo, "HEAD", ciclo).filter((m) => m.tipo === "autorizada");
  const ultima = autorizacoes.at(-1);
  if (!ultima) throw new ErroPlano("sem-autorizacao", `nenhuma fase de ${ciclo} autorizada — conferir lê só plano congelado`);
  const { blob, plano } = lerPlanoCongelado(repo, ciclo, ultima);
  const t = plano.porId.get(task);
  if (!t) throw new ErroPlano("task-ausente", `${task} não está no plano congelado ${blob}`);
  if (!t.verificacao) throw new ErroPlano("verificacao-ausente", `${task} sem comando de Verificação no plano`);
  const ausentes = executaveisDaVerificacao(t.verificacao).filter((n) => !noPath(n, repo));
  if (ausentes.length) return pergunta.perguntar({ acao: "perguntar", motivo: "binario-ausente", ciclo, task, plano: blob, binarios: ausentes });
  // Só aviso: erro ao medir não derruba o conferir, e sai dito como indeterminado.
  let saida;
  try {
    saida = saidaForaDoGit(repo, ciclo, task);
  } catch (e) {
    saida = [{ indeterminado: String(e?.stderr ?? e?.message ?? e).trim().split("\n")[0] }];
  }
  return {
    acao: "conferir",
    ciclo,
    task,
    plano: blob,
    posMerge: t.posMerge,
    comando: t.verificacao,
    verificacao: embrulharSemProducao(t.verificacao, adaptador.verificacaoDoProjeto(repo)),
    ...(saida.length
      ? {
          saidaForaDoGit: saida,
          avisoSaida:
            `a tentativa trazida acrescentou estes padrões a um .gitignore: o que a task gerou sob eles ficou na worktree da filha e não veio pelo trazer. Verificação vermelha por arquivo ausente aqui não é falha de trabalho — ler a filha antes de reverter, e perguntar a ${adaptador.nomeDoOperador(repo)} onde a Verificação roda.`,
        }
      : {}),
  };
}

/**
 * Padrões que a tentativa trazida da task acrescentou a um `.gitignore` (C24
 * do VEGA-28: a T11 do ATRM-52 gitignorou `demonstracao/saida/`, e a
 * Verificação, rodada na worktree do ciclo, leu um manifesto que só existia
 * na da filha). Sem trazida pendente da task, lista vazia.
 */
export function saidaForaDoGit(repo, ciclo, task) {
  const r = gitConducao.lerTrazidas(repo, ciclo).filter((x) => x.task === task).at(-1);
  if (!r?.base || !r?.ate) return [];
  const diff = git(repo, ["-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-renames", r.base, r.ate, "--", ".gitignore", ":(glob)**/.gitignore"]);
  const out = [];
  let arquivo = null;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) arquivo = l === "+++ /dev/null" ? null : l.slice(4).replace(/^b\//, "");
    else if (arquivo && l.startsWith("+")) {
      const padrao = l.slice(1).trim();
      if (padrao && !padrao.startsWith("#") && !padrao.startsWith("!")) out.push({ arquivo, padrao });
    }
  }
  return out;
}

// ── retomar ──────────────────────────────────────────────────────────────────

function revParse(repo, ref) {
  try {
    return git(repo, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]).trim() || null;
  } catch {
    return null;
  }
}

function ancestral(repo, a, b) {
  const r = tentarGit(repo, ["merge-base", "--is-ancestor", a, b]);
  if (r.status === 0) return true;
  return r.status === 1 ? false : null; // 128: objeto ausente localmente
}

/** Referências da condução no origin (`refs/conducao/<ciclo>/…`), sem buscar objeto nenhum. */
function lerRefsOrigin(repo, ciclo) {
  const prefixo = `refs/conducao/${ciclo}/`;
  const bruto = git(repo, ["ls-remote", "origin", `${prefixo}*`]);
  const refs = new Map();
  for (const l of bruto.split("\n")) {
    const [sha, nome] = l.split("\t");
    if (sha && nome?.startsWith(prefixo)) refs.set(nome, sha);
  }
  return refs;
}

/**
 * A nota de passagem mais recente do ramo (VEGA-37 T17): a da última marca
 * `passagem`, lida no commit da própria marca (`git show <sha>:<nota>`), com o
 * par que ela leva. `null` sem passagem; nota que não se lê vem com `erro`.
 */
export function notaMaisRecente(repo, marcas) {
  const m = marcas.findLast((x) => x.tipo === "passagem");
  if (!m) return null;
  const base = { passagem: m.sha, fase: m.fase, epoca: m.epoca ?? null, lock_id: m.lock ?? null, ramo: m.ramo ?? null, caminho: m.nota ?? null };
  if (!m.nota) return { ...base, corpo: null, erro: "a marca não traz a nota (Conducao-Nota)" };
  const r = tentarGit(repo, ["show", `${m.sha}:${m.nota}`]);
  return r.status === 0 ? { ...base, corpo: r.saida } : { ...base, corpo: null, erro: r.erro.split("\n").at(-1) || `git show saiu ${r.status}` };
}

/**
 * Os avisos das operárias do ciclo pelas referências do origin
 * (`refs/conducao-aviso/<ciclo>/T<k>/<n>`, VEGA-37 T17): por referência, o sha e
 * a linha (o subject do commit de aviso). Objeto que não está aqui é buscado
 * para uma referência temporária, apagada em seguida — lido, nunca adotado.
 * Nunca lança: origin mudo sai `{ erro }`, aviso ilegível sai com `erro` na linha.
 */
export function avisosDasOperarias(repo, ciclo) {
  const prefixo = `refs/conducao-aviso/${ciclo}/`;
  const ls = tentarGit(repo, ["ls-remote", "origin", `${prefixo}*`]);
  if (ls.status !== 0) return { erro: ls.erro.split("\n").at(-1) || `git ls-remote saiu ${ls.status}`, avisos: [] };
  const avisos = [];
  for (const l of ls.saida.split("\n")) {
    const [sha, ref] = l.split("\t");
    const m = /^([^/]+)\/(\d+)$/.exec(ref?.startsWith(prefixo) ? ref.slice(prefixo.length) : "");
    if (!sha || !m) continue;
    let local = tentarGit(repo, ["cat-file", "-e", `${sha}^{commit}`]).status === 0;
    if (!local) {
      const temp = `refs/conducao-retomar/${ciclo}/aviso/${m[1]}/${m[2]}`;
      const f = tentarGit(repo, ["fetch", "--no-tags", "--quiet", "origin", `+${ref}:${temp}`]);
      tentarGit(repo, ["update-ref", "-d", temp]);
      local = f.status === 0 && tentarGit(repo, ["cat-file", "-e", `${sha}^{commit}`]).status === 0;
    }
    const linha = local ? tentarGit(repo, ["log", "-1", "--format=%s", sha]) : null;
    avisos.push({ task: m[1], tentativa: Number(m[2]), ref, sha, ...(linha?.status === 0 ? { linha: linha.saida } : { linha: null, erro: "aviso não buscado do origin" }) });
  }
  avisos.sort((a, b) => Number(a.task.slice(1)) - Number(b.task.slice(1)) || a.tentativa - b.tentativa);
  return { avisos };
}

/** Roda o `gh` sem shell, com prazo; JSON ou `{ erro }`. */
function ghJson(repo, args) {
  try {
    return { valor: JSON.parse(execFileSync("gh", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 })) };
  } catch (e) {
    return { erro: String(e.stderr ?? e.message).trim().split("\n").at(-1) || e.code || "gh falhou" };
  }
}

/**
 * O último CI da proposta do ramo (VEGA-37 T17), pelo `gh`: a proposta e o run
 * mais recente do sha para que ela aponta. Não decide veredito — `conclusion`
 * sozinho não é veredito; quem lê o run por dentro é o `ci` do laço. Projeto
 * sem CI (`ci: false`, o mesmo modo da T9) sai com o pulo. Nunca lança.
 */
export function ciDaProposta({ repo, ramo, ciclo = null }) {
  let temCi = true;
  try {
    temCi = adaptador.lerAdaptador(repo).ci !== false;
  } catch {
    // declaração ilegível: segue como projeto com CI, e o gh diz o resto.
  }
  if (!temCi) return { pulo: "projeto-sem-ci" };
  // Ciclo sem ramo (`semRamo`): não há proposta de onde ler CI.
  if (ciclo && adaptador.modoDoCiclo(repo, ciclo).semRamo) return { pulo: "ciclo-sem-ramo" };
  if (!ramo) return { erro: "HEAD destacado: sem ramo, sem proposta" };
  const pr = ghJson(repo, ["pr", "view", ramo, "--json", "number,state,headRefOid,mergeStateStatus"]);
  if (pr.erro) return { erro: `gh pr view ${ramo}: ${pr.erro}` };
  const proposta = { numero: pr.valor.number ?? null, state: pr.valor.state ?? null, headRefOid: pr.valor.headRefOid ?? null, mergeStateStatus: pr.valor.mergeStateStatus ?? null };
  if (!proposta.headRefOid) return { proposta, run: null };
  const runs = ghJson(repo, ["run", "list", "--commit", proposta.headRefOid, "--limit", "20", "--json", "databaseId,headSha,status,conclusion,createdAt,workflowName"]);
  if (runs.erro) return { proposta, erro: `gh run list: ${runs.erro}` };
  const run = (Array.isArray(runs.valor) ? runs.valor : []).toSorted((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))[0] ?? null;
  return { proposta, run, leitura: "conclusion não é veredito: o ci do laço lê o run por dentro" };
}

/**
 * Estado da condução reconstruído só do git local (marcas no ramo e
 * referências `refs/conducao-local/…`), conferido contra o origin. O origin
 * nunca é fonte: referência dele que diverge da local é relatada, nunca
 * buscada nem adotada (§5 do plano de origem da condução).
 *
 * Partida da herdeira (VEGA-37 T17, AC-VEGA37-8): o `retomar` também devolve a
 * nota de passagem mais recente (`nota`), os avisos das operárias pelas
 * referências (`avisos`) e o último CI da proposta (`ci`, pelo `lerCi`) — o que
 * a herdeira precisa para seguir sem ler a conversa da anterior.
 */
export function retomar({ repo, ciclo, lerCi = ciDaProposta }) {
  const head = git(repo, ["rev-parse", "HEAD"]).trim();
  let ramo = null;
  try {
    ramo = git(repo, ["symbolic-ref", "--short", "-q", "HEAD"]).trim() || null;
  } catch {
    ramo = null;
  }
  const marcas = lerMarcas(repo, "HEAD", ciclo);
  const locais = lerRefsLocais(repo, ciclo);
  const trazidas = gitConducao.lerTrazidas(repo, ciclo);
  const estado = estadoDasTasks(marcas, locais, trazidas);
  const autorizadas = [...new Set(marcas.filter((m) => m.tipo === "autorizada").map((m) => m.fase))];
  const porNum = (a, b) => Number(a.slice(1)) - Number(b.slice(1));

  const divergencias = [];
  let origin;
  try {
    origin = lerRefsOrigin(repo, ciclo);
  } catch (e) {
    divergencias.push({ tipo: "origin-inacessivel", detalhe: String(e.stderr ?? e.message).trim().split("\n")[0] });
  }
  if (origin) {
    const copiaRef = `refs/conducao/${ciclo}/copia`;
    const copia = origin.get(copiaRef) ?? null;
    if (!copia && autorizadas.length) divergencias.push({ tipo: "copia-ausente", ref: copiaRef, local: head });
    else if (copia && copia !== head)
      divergencias.push({
        tipo: "copia-diverge",
        ref: copiaRef,
        origin: copia,
        local: head,
        // true: o origin tem commit da condução que o ramo local não tem.
        originAFrente: ancestral(repo, head, copia),
      });
    const prefixoLocal = `refs/conducao-local/${ciclo}/`;
    const vistos = new Set();
    for (const r of locais) {
      const nomeOrigin = `refs/conducao/${ciclo}/${r.ref.slice(prefixoLocal.length)}`;
      vistos.add(nomeOrigin);
      const sha = origin.get(nomeOrigin);
      if (!sha) divergencias.push({ tipo: "so-local", ref: r.ref, local: r.sha });
      else if (sha !== r.sha) divergencias.push({ tipo: "tentativa-diverge", ref: r.ref, origin: sha, local: r.sha });
    }
    for (const [nome, sha] of origin)
      if (nome !== copiaRef && !vistos.has(nome)) divergencias.push({ tipo: "so-no-origin", ref: nome, origin: sha });
  }

  return {
    acao: "retomar",
    ciclo,
    head,
    ramo,
    autorizadas,
    feitas: [...estado.feitas].sort(porNum),
    recusadas: [...estado.recusadas].sort(porNum),
    emVoo: [...estado.emVoo.values()]
      .sort((a, b) => porNum(a.task, b.task))
      .map((r) => ({ task: r.task, tentativa: r.tentativa, ref: r.ref, sha: r.sha, nonce: r.nonce })),
    trazidas: [...estado.trazidas.values()]
      .sort((a, b) => porNum(a.task, b.task))
      // D-VEGA20-26: o que a trazida trouxe de fora dos Outputs e se alterou o canonico, lidos do registro.
      .map((r) => ({
        task: r.task,
        tentativa: r.tentativa,
        ref: r.ref,
        ponta: r.ponta,
        nonce: r.nonce,
        ...(r.foraDosOutputs !== undefined ? { foraDosOutputs: r.foraDosOutputs } : {}),
        ...(r.canonicoAlterado !== undefined ? { canonicoAlterado: r.canonicoAlterado } : {}),
      })),
    // D-VEGA20-26: o relato das tasks já conferidas, lido da marca `conferida` (o registro `trazida` foi apagado).
    conferidas: relatosConferidos(marcas).sort((a, b) => porNum(a.task, b.task)),
    // Relato ilegível nunca vira null calado: cada um nomeia a trazida ou a marca de onde veio.
    avisosDoRelato: avisosDoRelato([...estado.trazidas.values()], relatosConferidos(marcas)),
    // VEGA-20 T19: as paradas que seguiram sozinhas pela calibração, com a linha do relato.
    aposentadas: lerAposentadas(repo, "HEAD", ciclo).map((a) => ({ ...a, relato: linhaDaAposentada(a) })),
    falhas: Object.fromEntries([...estado.falhas].sort(([a], [b]) => porNum(a, b))),
    falhasAmbiente: Object.fromEntries([...estado.falhasAmbiente].sort(([a], [b]) => porNum(a, b))),
    falhasPergunta: Object.fromEntries([...estado.falhasPergunta].sort(([a], [b]) => porNum(a, b))),
    conduzir: faseAConduzir(marcas, fasesDoPlano(repo, ciclo)),
    divergencias,
    nota: notaMaisRecente(repo, marcas),
    avisos: avisosDasOperarias(repo, ciclo),
    ci: (() => {
      try {
        return lerCi({ repo, ramo, ciclo });
      } catch (e) {
        return { erro: e.message };
      }
    })(),
  };
}

/** As marcas `conferida` que levam o relato da trazida (D-VEGA20-26): `{ task, sha, foraDosOutputs, canonicoAlterado }`. */
function relatosConferidos(marcas) {
  return marcas
    .filter((m) => m.tipo === "conferida" && gitConducao.TRAILERS_DO_RELATO.some((k) => m.trailers?.[k] !== undefined))
    .map((m) => {
      const r = gitConducao.relatoDosTrailers(m.trailers);
      return {
        task: m.task,
        sha: m.sha,
        ...(r.foraDosOutputs !== undefined ? { foraDosOutputs: r.foraDosOutputs } : {}),
        ...(r.canonicoAlterado !== undefined ? { canonicoAlterado: r.canonicoAlterado } : {}),
      };
    });
}

/** Um aviso por relato ilegível (`null`), nomeando a trazida pela referência ou a marca `conferida` pelo sha. */
function avisosDoRelato(trazidas, conferidas) {
  const out = [];
  const campos = [["foraDosOutputs", "Conducao-Fora-Dos-Outputs"], ["canonicoAlterado", "Conducao-Canonico-Alterado"]];
  for (const r of trazidas)
    for (const [campo, trailer] of campos)
      if (r[campo] === null) out.push({ task: r.task, tentativa: r.tentativa, trazida: r.ref, trailer, detalhe: `${trailer} ilegível na trazida ${r.ref}: o relato dela não se lê` });
  for (const c of conferidas)
    for (const [campo, trailer] of campos)
      if (c[campo] === null) out.push({ task: c.task, conferida: c.sha, trailer, detalhe: `${trailer} ilegível na marca conferida ${c.sha.slice(0, 8)} da ${c.task}` });
  return out;
}

/** Ids das fases do plano no HEAD, ou `null` quando o plano (ou o adaptador) não se lê aqui. */
function fasesDoPlano(repo, ciclo) {
  try {
    return lerPlanoNoCommit(repo, "HEAD", ciclo).plano.fases.map((f) => f.id);
  } catch {
    return null;
  }
}

/**
 * A fase que a condutora que retoma conduz, só pelas marcas (VEGA-37 T11,
 * D-VEGA37-7, AC-VEGA37-9). A marca `Conducao-Encerrada` e a autorização são
 * as mesmas nos dois modelos: um ciclo que a condutora do modelo antigo
 * encerrou esperando a maestra criar a seguinte segue aqui na fase seguinte,
 * sem maestra — quem roda o `retomar` é a condutora nova, e o `proximo` dela
 * pede (ou herda) a autorização da fase. A autorização herdada que a maestra
 * gravou (`Conducao-Origem: ciclo`) conta como qualquer autorização.
 *
 * `fases` é a ordem do plano; `null` (plano ou adaptador ilegível, como o do
 * ramo sob o motor de `main`, D-VEGA37-26) cai na ordem numérica das marcas,
 * com `fonte: "marcas"`. Devolve `{ fase, situacao, fonte, depoisDe }`:
 * `situacao` `fase-aberta` (autorizada e não encerrada) · `fase-seguinte`
 * (ainda sem autorização) · `fechamento` (todas encerradas, ou o ciclo) ·
 * `sem-marca` (nenhuma fase autorizada nem encerrada: `fase` é a primeira do
 * plano, ou `null` sem ele).
 */
export function faseAConduzir(marcas, fases = null) {
  const encerradas = new Set(marcas.filter((m) => m.tipo === "encerrada").map((m) => m.fase));
  const autorizadas = new Set(marcas.filter((m) => m.tipo === "autorizada").map((m) => m.fase));
  const fonte = fases ? "plano" : "marcas";
  const num = (f) => Number(f.slice(1));
  const encerradasDeFase = [...encerradas].filter((f) => f !== "ciclo").sort((a, b) => num(a) - num(b));
  const depoisDe = encerradasDeFase.at(-1) ?? null;
  if (encerradas.has("ciclo")) return { fase: "fechamento", situacao: "fechamento", fonte, depoisDe };
  const ordem = fases ?? [...new Set([...autorizadas, ...encerradas])].sort((a, b) => num(a) - num(b));
  // Fases antes da primeira com marca ficaram fora da condução (feitas à mão), como o `iPrimeira` de regras.mjs.
  const iPrimeira = ordem.findIndex((f) => autorizadas.has(f) || encerradas.has(f));
  const aberta = ordem.slice(Math.max(iPrimeira, 0)).find((f) => !encerradas.has(f));
  if (!autorizadas.size && !encerradas.size) return { fase: fases?.[0] ?? null, situacao: "sem-marca", fonte, depoisDe };
  if (aberta) return { fase: aberta, situacao: autorizadas.has(aberta) ? "fase-aberta" : "fase-seguinte", fonte, depoisDe };
  // Sem plano, a fase depois da última encerrada é a seguinte pelo número; com plano, não há outra.
  if (!fases) return { fase: `F${num(depoisDe) + 1}`, situacao: "fase-seguinte", fonte, depoisDe };
  return { fase: "fechamento", situacao: "fechamento", fonte, depoisDe };
}

// ── auditar ──────────────────────────────────────────────────────────────────

const VERIFICACOES = new Set(["verde", "declarada-pos-merge", "manual"]);
/** `Conducao-Executor` de task feita por quem conduz: `condutora`, e `maestra` de commit antigo (D-VEGA26-21). */
const EXECUTORES_CONDUTORA = new Set(["condutora", "maestra"]);
const PUBLICACOES = new Set(["feita", "nao-se-aplica"]);

/** Nota de pré-condições da T17: `ciclo_conduzido: <id>` e `ramo: <ramo>`, uma por linha. */
export function lerNota(texto) {
  const campo = (nome) => new RegExp(`^${nome}:[ \\t]*(\\S+)[ \\t]*$`, "m").exec(texto)?.[1] ?? null;
  return { ciclo: campo("ciclo_conduzido"), ramo: campo("ramo") };
}

/**
 * Confere o rastro de um ciclo conduzido nos commits do ramo — nunca na
 * referência de abertura, que a T10 apaga. Conduzidas são as fases com marca
 * de autorização; as anteriores (a F0 feita à mão) ficam fora e a saída o
 * declara. Regras por task conduzida: um commit `Conducao: T<k> conferida`
 * com os trailers da T10 (`manual` em task de estação workstation, sem sha
 * nem sessão de filha; `Conducao-Executor: condutora` com a sessão de quem
 * conduz em task de estação condutora — `maestra`, o valor antigo do trailer,
 * segue aceito em commit antigo), depois das conferências das tasks de `**Inputs:**` e
 * depois da marca da própria fase.
 *
 * Sem a nota (T22): `ciclo` e `ref` direto — a nota da T17 mora só na worktree
 * do ciclo de origem da condução e o ramo do conduzido some no fechamento (`refs/pull/<N>/head`
 * fica). `exigirFases` e `exigirEncerramentos` viram violação quando falta a
 * marca de autorização da fase ou a `Conducao-Encerrada` pedida.
 */
export function auditar({ repo, nota = null, ciclo: cicloPedido = null, ref: refPedida = null, exigirFases = [], exigirEncerramentos = [] }) {
  let ciclo = cicloPedido;
  let ramo = null;
  let ref = refPedida;
  if (nota) {
    ({ ciclo, ramo } = lerNota(readFileSync(nota, "utf8")));
    if (!ciclo || !ramo)
      throw new ErroPlano("nota-incompleta", `${nota} sem ${!ciclo ? "ciclo_conduzido:" : "ramo:"} — a nota é a da T17`);
    ref = `refs/heads/${ramo}`;
  } else if (!ciclo || !ref) throw new ErroPlano("uso", "auditar exige --nota <arquivo> ou --ciclo <id> --ref <ref>");
  for (const f of exigirFases) if (!/^F\d{1,2}$/.test(f)) throw new ErroPlano("uso", `--exigir-fases: ${JSON.stringify(f)} não é F<n>`);
  for (const f of exigirEncerramentos)
    if (!/^(F\d{1,2}|ciclo)$/.test(f)) throw new ErroPlano("uso", `--exigir-encerramentos: ${JSON.stringify(f)} não é F<n> nem ciclo`);
  const ponta = revParse(repo, ref);
  if (!ponta) throw new ErroPlano("ramo-ausente", `${ref} não existe em ${repo}`);

  const marcas = lerMarcas(repo, ref, ciclo);
  const autorizacoes = marcas.filter((m) => m.tipo === "autorizada");
  const conferidas = marcas.filter((m) => m.tipo === "conferida");
  const encerramentos = [...new Set(marcas.filter((m) => m.tipo === "encerrada").map((m) => m.fase))];
  // Exigências da chamada (T22): fase pedida sem marca de autorização e
  // encerramento pedido sem a marca `Conducao-Encerrada` saem como violação.
  const fasesAutorizadas = new Set(autorizacoes.map((m) => m.fase));
  const exigidas = [
    ...exigirFases.filter((f) => !fasesAutorizadas.has(f)).map((f) => ({ fase: f, regra: "fase-nao-conduzida" })),
    ...exigirEncerramentos.filter((f) => !encerramentos.includes(f)).map((f) => ({ fase: f, regra: "encerramento-ausente" })),
  ];
  const base = { acao: "auditar", ciclo, ramo, ref, ponta, encerramentos };
  if (!conferidas.length)
    return { ...base, plano: null, violacoes: [{ regra: "sem-conferencia", detalhe: `${ref} não tem nenhum commit de conferência` }, ...exigidas] };
  if (!autorizacoes.length)
    return { ...base, plano: null, violacoes: [{ regra: "sem-autorizacao", detalhe: `${ref} tem conferência sem marca de fase autorizada` }, ...exigidas] };

  const { blob, plano } = lerPlanoCongelado(repo, ciclo, autorizacoes.at(-1));
  const pos = (m) => marcas.indexOf(m);
  const autorizadaEm = new Map();
  for (const m of autorizacoes) if (!autorizadaEm.has(m.fase)) autorizadaEm.set(m.fase, pos(m));
  const conferidaDe = new Map();
  for (const m of conferidas) if (!conferidaDe.has(m.task)) conferidaDe.set(m.task, m);

  const conduzidas = plano.fases.filter((f) => autorizadaEm.has(f.id));
  const conduzidasIds = new Set(conduzidas.map((f) => f.id));
  const tasksConduzidas = new Set(conduzidas.flatMap((f) => f.tasks));
  // A declaração do adaptador só é lida se alguma conferência dispensou publicação.
  let decl = null;
  const declaracao = () => (decl ??= adaptador.lerAdaptador(repo));
  const violacoes = [];
  const tasks = [];
  for (const f of conduzidas)
    for (const id of f.tasks) {
      const t = plano.porId.get(id);
      const c = conferidaDe.get(id);
      if (!c) {
        violacoes.push({ task: id, fase: f.id, regra: "sem-conferencia" });
        continue;
      }
      const tr = c.trailers;
      const verif = tr["Conducao-Verificacao"] ?? null;
      tasks.push({ task: id, fase: f.id, conferida: c.sha, verificacao: verif });
      const faltando = ["Conducao-Task", "Conducao-Verificacao", "Conducao-Publicacao"];
      const pelaCondutora = EXECUTORES_CONDUTORA.has(tr["Conducao-Executor"]);
      if (pelaCondutora) faltando.push("Conducao-Sessao-Maestra");
      else if (verif !== "manual") faltando.push("Conducao-Sha-Filha", "Conducao-Sessao-Filha", "Conducao-Nonce");
      const ausentes = faltando.filter((k) => !tr[k]);
      if (ausentes.length) violacoes.push({ task: id, regra: "trailers-ausentes", trailers: ausentes, sha: c.sha });
      if (tr["Conducao-Task"] && tr["Conducao-Task"] !== id)
        violacoes.push({ task: id, regra: "trailer-task-diverge", valor: tr["Conducao-Task"], sha: c.sha });
      if (verif && !VERIFICACOES.has(verif)) violacoes.push({ task: id, regra: "verificacao-invalida", valor: verif, sha: c.sha });
      const publ = tr["Conducao-Publicacao"];
      if (publ && !PUBLICACOES.has(publ)) violacoes.push({ task: id, regra: "publicacao-invalida", valor: publ, sha: c.sha });
      // Task que o plano liga a publicação só fecha `nao-se-aplica` com a
      // dispensa do operador (ruling 18.7, T18): o trailer com o papel (T16),
      // ou, em commit antigo, a frase legada que o adaptador declara.
      if (
        publ === "nao-se-aplica" &&
        t.publicacao.length &&
        !adaptador.dispensouPublicacao(declaracao(), { trailers: tr, corpo: git(repo, ["log", "-1", "--format=%B", c.sha]) })
      )
        violacoes.push({ task: id, regra: "nao-se-aplica-sem-sim", publicacao: t.publicacao, sha: c.sha });
      if (t.estacao === "workstation" && verif !== "manual")
        violacoes.push({ task: id, regra: "workstation-sem-manual", valor: verif, sha: c.sha });
      if ((t.estacao === "condutora") !== pelaCondutora)
        violacoes.push({ task: id, regra: pelaCondutora ? "maestra-fora-da-estacao" : "maestra-sem-executor", estacao: t.estacao, sha: c.sha });
      if (pos(c) < autorizadaEm.get(f.id))
        violacoes.push({ task: id, regra: "conferencia-antes-da-autorizacao", fase: f.id, sha: c.sha });
      for (const d of t.deps) {
        if (!tasksConduzidas.has(d)) continue;
        const cd = conferidaDe.get(d);
        if (cd && pos(cd) > pos(c)) violacoes.push({ task: id, regra: "conferida-antes-da-dependencia", dependencia: d, sha: c.sha });
      }
    }

  return {
    ...base,
    plano: blob,
    conduzidas: [...conduzidasIds],
    foraDaConducao: {
      fases: plano.fases.filter((f) => !conduzidasIds.has(f.id)).map((f) => f.id),
      motivo: "sem marca de fase autorizada — feitas à mão, fora da auditoria",
    },
    tasks,
    violacoes: [...violacoes, ...exigidas],
  };
}

// ── CI da proposta (T14) ─────────────────────────────────────────────────────

/** Folga de relógio entre a hora anotada do push e o `createdAt` do run. */
const FOLGA_RELOGIO_MS = 60_000;

/**
 * Decide o que o CI da proposta diz depois do push de fim de fase. Puro: os
 * runs (`gh run list --json databaseId,headSha,status,conclusion,createdAt,workflowName`)
 * e a proposta (`gh pr view --json number,state,mergeable,mergeStateStatus,headRefOid`)
 * vêm da maestra.
 *
 * - proposta que não aponta para o sha empurrado ⇒ `avisar`, `proposta-desalinhada`;
 * - nenhum run do sha nascido depois do push, dentro do prazo ⇒ `esperar`;
 * - nenhum run depois do prazo ⇒ `avisar`, `sem-run`, com o estado de
 *   mesclagem — proposta `CONFLICTING` não gera run e o required check fica
 *   pendente para sempre, sem vermelho (`veredito-de-ci.md` item 1);
 * - run em curso ⇒ `esperar`;
 * - todos terminados ⇒ `ler-run`: `conclusion` não é veredito (item 5, step com
 *   `continue-on-error` sai `success`), então a saída manda ler por dentro.
 */
export function decidirCi({ pushEm, runs, pr, agora = null, sha = null, prazoMin = BOTOES.prazoRunCiMin, veredito = vereditoDoCi() }) {
  const tPush = Date.parse(pushEm ?? "");
  if (Number.isNaN(tPush)) throw new ErroPlano("uso", `ci: --push-em inválido: ${pushEm}`);
  const tAgora = agora === null ? Date.now() : Date.parse(agora);
  if (Number.isNaN(tAgora)) throw new ErroPlano("uso", `ci: --agora inválido: ${agora}`);
  if (!Array.isArray(runs)) throw new ErroPlano("uso", "ci: --runs deve ser uma lista JSON");
  if (!pr || typeof pr !== "object" || Array.isArray(pr)) throw new ErroPlano("uso", "ci: --pr deve ser um objeto JSON");

  const alvo = sha ?? pr.headRefOid ?? null;
  const mesclagem = {
    proposta: pr.number ?? null,
    state: pr.state ?? null,
    mergeable: pr.mergeable ?? null,
    mergeStateStatus: pr.mergeStateStatus ?? null,
    headRefOid: pr.headRefOid ?? null,
  };
  const base = { pushEm: new Date(tPush).toISOString(), sha: alvo, prazoMin, mesclagem };
  const casaSha = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

  if (sha && pr.headRefOid && !casaSha(sha, pr.headRefOid))
    return {
      acao: "avisar",
      veredito: "proposta-desalinhada",
      ...base,
      aviso: `a proposta aponta para ${pr.headRefOid.slice(0, 8)}, não para o ${sha.slice(0, 8)} empurrado — empurrar antes de ler veredito`,
    };

  const dePush = runs.filter(
    (r) => (!alvo || casaSha(r.headSha ?? "", alvo)) && Date.parse(r.createdAt ?? "") >= tPush - FOLGA_RELOGIO_MS,
  );
  if (!dePush.length) {
    const prazoEm = tPush + prazoMin * 60_000;
    if (tAgora < prazoEm) return { acao: "esperar", motivo: "run-nao-nasceu", ...base, ate: new Date(prazoEm).toISOString() };
    const minutos = Math.floor((tAgora - tPush) / 60_000);
    const porque =
      pr.mergeable === "CONFLICTING"
        ? "a proposta está CONFLICTING, e proposta em conflito não gera run (§Veredito de CI item 1) — resolver o conflito e empurrar"
        : pr.state && pr.state !== "OPEN"
          ? `a proposta está ${pr.state}, não OPEN`
          : `mergeable=${pr.mergeable ?? "?"}, mergeStateStatus=${pr.mergeStateStatus ?? "?"}`;
    return {
      acao: "avisar",
      veredito: "sem-run",
      ...base,
      minutosDesdePush: minutos,
      aviso: `nenhum run do CI ${minutos} min depois do push (prazo ${prazoMin} min): ${porque}`,
    };
  }
  const emCurso = dePush.filter((r) => r.status !== "completed");
  if (emCurso.length) return { acao: "esperar", motivo: "run-em-curso", ...base, runs: emCurso.map((r) => r.databaseId ?? null) };
  return {
    acao: "ler-run",
    ...base,
    runs: dePush.map((r) => ({ id: r.databaseId ?? null, workflow: r.workflowName ?? null, conclusion: r.conclusion ?? null })),
    lerPorDentro: dePush.map((r) => `gh run view ${r.databaseId} --log`),
    aviso: veredito,
  };
}

/** Aviso do `ler-run` sem adaptador que diga onde mora o veredito do CI. */
const VEREDITO_PADRAO = "`conclusion` não é veredito: ler o run por dentro antes de avisar o operador";

/**
 * Onde mora o veredito do CI do projeto (`ci.veredito` do código do adaptador
 * de `repo`; sem `repo`, o da árvore do núcleo); ilegível ⇒ o padrão, com o
 * erro no stderr (o veredito sai igual, mas a falha do adaptador não some).
 */
function vereditoDoCi(repo = null) {
  try {
    return (repo ? adaptador.codigoDoAdaptador(repo) : adaptador.codigoDoNucleo()).ci?.veredito ?? VEREDITO_PADRAO;
  } catch (e) {
    process.stderr.write(`conducao: ci.veredito ilegível, vale o padrão — ${e.codigo ?? e.name}: ${e.message}\n`);
    return VEREDITO_PADRAO;
  }
}

const COMENTARIO_YAML = /(^|\s)#.*$/;

/** Lista YAML inline `[a, "b"]`, escalar, ou bloco `- a` logo abaixo da chave. */
function listaYaml(linhas, i, valorInline) {
  const limpa = (x) => x.trim().replace(/^["']|["']$/g, "");
  const v = valorInline.trim();
  if (v.startsWith("[")) return v.replace(/^\[|\]$/g, "").split(",").map(limpa).filter(Boolean);
  if (v) return [limpa(v)];
  const out = [];
  for (let j = i + 1; j < linhas.length; j++) {
    const m = linhas[j].match(/^\s*-\s+(.*)$/);
    if (m) out.push(limpa(m[1]));
    else if (linhas[j].trim()) break;
  }
  return out;
}

/**
 * O gatilho `push` de um workflow: `null` sem push; `{ soMain, branches }` com
 * push. `soMain` só quando `branches` é exatamente `[main]`, sem `tags` nem
 * `branches-ignore` — qualquer outra forma dispara em push fora de `main`.
 */
export function gatilhoDePush(texto) {
  const linhas = texto.split(/\r?\n/).map((l) => l.replace(COMENTARIO_YAML, "").replace(/\s+$/, ""));
  const reOn = /^["']?(on|true)["']?:/;
  const iOn = linhas.findIndex((l) => reOn.test(l));
  if (iOn < 0) return null;
  const inline = linhas[iOn].replace(/^["']?(on|true)["']?:\s*/, "");
  if (inline) return listaYaml(linhas, iOn, inline).includes("push") ? { soMain: false, branches: null } : null;
  let iPush = -1;
  let indPush = 0;
  for (let j = iOn + 1; j < linhas.length; j++) {
    const l = linhas[j];
    if (!l.trim()) continue;
    if (/^\S/.test(l)) break;
    const m = l.match(/^(\s+)(?:-\s+)?push:?\s*$/) ?? l.match(/^(\s+)push:(.*)$/);
    if (m) {
      iPush = j;
      indPush = m[1].length;
      break;
    }
  }
  if (iPush < 0) return null;
  const chaves = {};
  for (let j = iPush + 1; j < linhas.length; j++) {
    const l = linhas[j];
    if (!l.trim()) continue;
    if (l.match(/^(\s*)/)[1].length <= indPush) break;
    const m = l.match(/^\s*([\w-]+):\s*(.*)$/);
    if (m) chaves[m[1]] = listaYaml(linhas, j, m[2]);
  }
  const branches = chaves.branches ?? null;
  const soMain = !!branches?.length && branches.every((b) => b === "main") && !chaves.tags && !chaves["branches-ignore"];
  return {
    soMain,
    branches,
    ...(chaves.tags ? { tags: chaves.tags } : {}),
    ...(chaves["branches-ignore"] ? { branchesIgnore: chaves["branches-ignore"] } : {}),
  };
}

/** Linhas (1-based), fora de comentário, que leem `secrets.X` ou `secrets[…]`. */
function linhasComSecrets(texto) {
  const out = [];
  texto.split(/\r?\n/).forEach((l, i) => {
    if (/\bsecrets\s*(\.|\[)/.test(l.replace(COMENTARIO_YAML, ""))) out.push(i + 1);
  });
  return out;
}

/**
 * `conferir-workflows`: workflow com gatilho `push` que dispara fora de `main`
 * e lê `secrets.` deixa o push da filha (ramo ou `refs/conducao/*`) rodar
 * código com segredo do repositório. Sai 1 com qualquer um (§2.2#16 do
 * plano de origem da condução).
 */
export function conferirWorkflows({ repo }) {
  const pasta = path.join(repo, ".github", "workflows");
  if (!existsSync(pasta)) return { acao: "workflows", ok: true, conferidos: [], violacoes: [] };
  const conferidos = [];
  const violacoes = [];
  for (const nome of readdirSync(pasta).filter((n) => /\.ya?ml$/.test(n)).sort()) {
    const arquivo = `.github/workflows/${nome}`;
    const texto = readFileSync(path.join(pasta, nome), "utf8");
    const push = gatilhoDePush(texto);
    const secrets = linhasComSecrets(texto);
    conferidos.push({ arquivo, push: push ? (push.soMain ? "main" : "fora-de-main") : "sem-push", secrets: secrets.length });
    if (push && !push.soMain && secrets.length)
      violacoes.push({ arquivo, branches: push.branches, ...(push.tags ? { tags: push.tags } : {}), linhasSecrets: secrets });
  }
  return { acao: "workflows", ok: violacoes.length === 0, conferidos, violacoes };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function flag(argv, nome) {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * `{ valor }` ou `{ erro }` — nunca lança (T17, 20-a): arquivo ausente ou JSON
 * ilegível é problema da entrada, que vira `perguntar entrada-invalida`, não
 * exceção com pilha (exit 2).
 */
function lerEntrada(valor, nome) {
  if (valor === undefined) return { valor: {} };
  let txt;
  try {
    txt = /^\s*[[{]/.test(valor) ? valor : readFileSync(valor, "utf8");
  } catch (e) {
    return { erro: `${nome}: arquivo ilegível (${e.code ?? e.message}): ${valor}` };
  }
  try {
    return { valor: JSON.parse(txt) };
  } catch (e) {
    return { erro: `${nome}: JSON ilegível (${e.message})` };
  }
}

const VERBOS_GIT = new Set([
  "autorizar-fase",
  "autorizar-ciclo",
  "abrir",
  "trazer",
  "regravar-consentimentos",
  "conferir-carimbo",
  "registrar-conferencia",
  "recusar-publicacao",
  "reverter-trazido",
  "registrar-falha",
  "empurrar-copia",
  "limpar",
  "esperar-filha",
  "encerrar-sessao",
  "herdar-autorizacao",
  "empurrar-ramo",
  "passar",
  "desistir-da-passagem",
  "desanexar-ramo",
  "trazer-ramo",
  "confirmar-passagem",
  "retomar-da-passagem",
  "desmontar-anterior",
  "niveis",
  "pedir-herdeira",
  "resposta-da-maestra",
  "aposentar",
]);

function inteiro(v) {
  return v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined;
}

/** Despacho dos verbos de git (T10). Uso errado vira `ErroPlano("uso")`, exit 1. */
function verboDeGit(verbo, resto, { repo, ciclo }) {
  const task = resto.find((a) => /^T\d{1,3}$/.test(a));
  const exigirTask = () => {
    if (!task) throw new ErroPlano("uso", `${verbo} exige T<k>`);
    return task;
  };
  switch (verbo) {
    case "autorizar-fase":
      // Aposentado (D-VEGA29-14, ruling 23-a do `/draft-review`): o sim vale
      // para o ciclo inteiro. Recusa antes de gravar qualquer marca.
      throw new ErroPlano(
        "verbo-aposentado",
        "autorizar-fase foi aposentado: o sim vale para o ciclo inteiro — autorizar-ciclo F<n> --sim <texto> --pergunta <p-…>; mudança de classe ou de sensibilidade e publicação seguem perguntando",
      );
    case "autorizar-ciclo":
      return gitConducao.autorizarCiclo({ repo, ciclo, fase: resto.find((a) => /^F\d{1,2}$/.test(a)), sim: flag(resto, "--sim"), pergunta: flag(resto, "--pergunta") ?? null, maestra: flag(resto, "--maestra") ?? null });
    case "resposta-da-maestra":
      return gitConducao.respostaDaMaestra({ repo, pergunta: flag(resto, "--pergunta"), maestra: flag(resto, "--maestra") });
    case "abrir": {
      // P19 do ATRM-51: a filha nasce no modo de permissão da maestra, e o
      // `create_session` recusa modo mais permissivo que o de quem chama. Fora
      // de um modo sem clique, a filha pararia a cada comando sem ninguém para
      // clicar. A maestra passa o `session_context.permission_mode` do próprio
      // `get_session`; sem ele o verbo não abre. Os modos sem clique vêm do
      // adaptador (`sessao.modosSemClique`, default `["auto"]`; T15,
      // D-VEGA29-29) — o da sessão criadora, nunca o `--permission-mode` da ponte.
      const modoBruto = flag(resto, "--modo-maestra");
      if (modoBruto === undefined || !modoBruto.trim())
        throw new ErroPlano("uso", "abrir exige --modo-maestra <session_context.permission_mode do get_session da maestra>");
      const modo = modoBruto.trim().toLowerCase().replace(/^permission_mode_/, "");
      const decl = adaptador.lerAdaptador(repo);
      if (!adaptador.modoSemClique(decl, modo))
        return pergunta.perguntar({
          acao: "perguntar",
          motivo: "modo-da-maestra",
          ciclo,
          task: exigirTask(),
          modo,
          modosSemClique: [...decl.sessao.modosSemClique],
          detalhe: `a maestra está em ${modo}: a filha herdaria esse modo e pararia a cada comando. Pedir a ${decl.operador.nome} que volte a maestra a um modo sem clique (${decl.sessao.modosSemClique.join(", ")}); nada foi gravado.`,
        });
      const falhou = flag(resto, "--falhou");
      return gitConducao.abrir({
        repo,
        ciclo,
        task: exigirTask(),
        tentativa: inteiro(flag(resto, "--tentativa")),
        nonce: flag(resto, "--nonce"),
        falhou: falhou === undefined ? null : { tentativa: inteiro(falhou), coberta: flag(resto, "--coberta"), motivo: flag(resto, "--motivo") ?? null },
      });
    }
    case "registrar-falha":
      return gitConducao.registrarFalha({
        repo,
        ciclo,
        task: exigirTask(),
        tentativa: inteiro(flag(resto, "--tentativa")),
        coberta: flag(resto, "--coberta"),
        motivo: flag(resto, "--motivo") ?? null,
      });
    case "trazer":
      return gitConducao.trazer({
        repo,
        ciclo,
        task: exigirTask(),
        tentativa: inteiro(flag(resto, "--tentativa")),
        shaAvisado: flag(resto, "--sha") ?? null,
        sessao: flag(resto, "--sessao") ?? null,
        aprovado: flag(resto, "--aprovado") ?? null,
      });
    case "regravar-consentimentos":
      return gitConducao.regravarConsentimentos({ repo, ciclo, task: exigirTask(), tentativa: inteiro(flag(resto, "--tentativa")) });
    case "conferir-carimbo":
      return gitConducao.conferirCarimbo({ repo, ciclo, task: exigirTask() });
    case "registrar-conferencia":
      if (resto.includes("--rodada")) {
        // Allowlist: flag da conferência (ou qualquer outra) não passa calada pela rodada.
        const aceitas = new Set(["--rodada", "--operador", "--sessao", "--repo", "--ciclo"]);
        const alheias = resto.filter((a) => a.startsWith("--") && !aceitas.has(a));
        if (alheias.length) throw new ErroPlano("uso", `--rodada não combina com ${alheias.join(", ")}`);
        return gitConducao.registrarRodada({
          repo,
          ciclo,
          task: exigirTask(),
          rodada: flag(resto, "--rodada"),
          sessao: flag(resto, "--sessao") ?? null,
          operador: flag(resto, "--operador") ?? null,
        });
      }
      return gitConducao.registrarConferencia({
        repo,
        ciclo,
        task: exigirTask(),
        verificacao: flag(resto, "--verificacao"),
        publicacao: flag(resto, "--publicacao"),
        manual: resto.includes("--manual"),
        maestra: resto.includes("--condutora") || resto.includes("--maestra"),
        sim: flag(resto, "--sim") ?? null,
        sessao: flag(resto, "--sessao") ?? null,
        operador: flag(resto, "--operador") ?? null,
        fora: flag(resto, "--fora") ?? null,
      });
    case "recusar-publicacao":
      return gitConducao.recusarPublicacao({ repo, ciclo, task: exigirTask(), motivo: flag(resto, "--motivo") });
    case "reverter-trazido":
      return gitConducao.reverterTrazido({ repo, ciclo, task: exigirTask(), motivo: flag(resto, "--motivo") });
    case "empurrar-copia":
    {
      const c = gitConducao.empurrarCopia({ repo, ciclo });
      const aviso = gitConducao.avisoDoPrincipal(c.principal);
      return { acao: "copia", ciclo, ...c, ...(aviso ? { avisoOperador: [aviso] } : {}) };
    }
    case "esperar-filha": {
      const numero = (nome) => {
        if (!resto.includes(nome)) return undefined;
        const v = flag(resto, nome);
        if (v === undefined || !/^\d+$/.test(v)) throw new ErroPlano("uso", `${nome} exige inteiro >= 0, veio ${JSON.stringify(v ?? null)}`);
        return Number(v);
      };
      const maxMin = numero("--max-min");
      const intervaloS = numero("--intervalo-s");
      return gitConducao.esperarFilha({
        repo,
        ciclo,
        task: exigirTask(),
        tentativa: inteiro(flag(resto, "--tentativa")),
        tetoChamadorMin: numero("--teto-chamador-min"),
        desde: resto.includes("--desde") ? flag(resto, "--desde") ?? "" : null,
        avisoTratado: resto.includes("--aviso-tratado") ? flag(resto, "--aviso-tratado") ?? "" : null,
        ...(maxMin === undefined ? {} : { maxMin }),
        ...(intervaloS === undefined ? {} : { intervaloS }),
      });
    }
    case "herdar-autorizacao":
      return herdarAutorizacao({ repo, ciclo, fase: resto.find((a) => /^F\d{1,2}$/.test(a)), nonce: flag(resto, "--nonce") });
    case "empurrar-ramo":
      return empurrarRamo({ repo, ciclo, nonce: flag(resto, "--nonce") });
    case "encerrar-sessao":
      return encerrarSessao({ repo, ciclo, fase: flag(resto, "--fase"), nonce: flag(resto, "--nonce") });
    case "passar": {
      const fase = resto.find((a) => /^F\d{1,2}$/.test(a));
      const arquivo = flag(resto, "--nota");
      if (!arquivo) throw new ErroPlano("uso", "passar exige --nota <arquivo com o corpo da nota, no molde de references/nota-de-passagem.md>");
      let corpo;
      try {
        corpo = readFileSync(arquivo, "utf8");
      } catch (e) {
        throw new ErroPlano("nota-ilegivel", `--nota ${arquivo}: ${e.code ?? e.message}`);
      }
      const entrada = lerEntrada(flag(resto, "--entrada"), "--entrada");
      if (entrada.erro) throw new ErroPlano("entrada-invalida", entrada.erro);
      // Filha viva = a mesma conta do teto da ponte (`vagasDoTeto`): toda que não está arquivada.
      const filhas = Array.isArray(entrada.valor.filhas) ? entrada.valor.filhas : [];
      // Caixa normalizada como no `proximo` (`estadoDaFilha`): `archived` do get_session é arquivada.
      const vivas = filhas.filter((f) => estadoDaFilha(f.estado) !== "ARCHIVED").map((f) => f.sessao ?? f.task ?? "?");
      const estado = estadoDasTasks(lerMarcas(repo, "HEAD", ciclo), lerRefsLocais(repo, ciclo), gitConducao.lerTrazidas(repo, ciclo));
      const r = gitConducao.passar({ repo, ciclo, fase, corpo, emVoo: [...estado.emVoo.values()], trazidas: [...estado.trazidas.values()], vivas });
      // Ao entrar em passagem a anterior desanexa o ramo e fica com a posse (VEGA-37 T16): a herdeira o traz.
      // Falhou o switch ⇒ o proximo emite `desanexar-ramo`; a passagem já está gravada.
      const sw = tentarGit(repo, ["switch", "--quiet", "--detach"]);
      return { ...r, desanexado: sw.status === 0, ...(sw.status !== 0 ? { detalheDesanexar: sw.erro } : {}) };
    }
    case "desanexar-ramo":
    case "confirmar-passagem":
    case "retomar-da-passagem":
    case "desmontar-anterior": {
      // Sem `--entrada` o verbo recusa (`sem-entrada`): ele refaz o proximo e só a mesma entrada devolve a mesma ação (T51).
      const bruta = flag(resto, "--entrada");
      const entrada = bruta === undefined ? { valor: undefined } : lerEntrada(bruta, "--entrada");
      if (entrada.erro) throw new ErroPlano("entrada-invalida", entrada.erro);
      const args = { repo, ciclo, nonce: flag(resto, "--nonce"), entrada: entrada.valor };
      if (verbo === "desanexar-ramo") return desanexarRamo(args);
      if (verbo === "confirmar-passagem") return confirmarPassagem(args);
      if (verbo === "retomar-da-passagem") return retomarDaPassagem(args);
      return desmontarAnterior({ ...args, arquivadas: flag(resto, "--arquivadas") });
    }
    case "niveis": {
      const n = resto.find((a) => /^[0-9]+$/.test(a));
      if (n === undefined) return lerNiveis({ repo, ciclo, linhagem: flag(resto, "--linhagem") });
      return gitConducao.registrarNiveis({ repo, ciclo, niveis: Number(n), sim: flag(resto, "--sim"), pergunta: flag(resto, "--pergunta") ?? null });
    }
    case "pedir-herdeira": {
      const bruta = flag(resto, "--entrada");
      const entrada = bruta === undefined ? { valor: undefined } : lerEntrada(bruta, "--entrada");
      if (entrada.erro) throw new ErroPlano("entrada-invalida", entrada.erro);
      return pedirHerdeira({ repo, ciclo, nonce: flag(resto, "--nonce"), entrada: entrada.valor });
    }
    case "aposentar": {
      const bruta = flag(resto, "--entrada");
      const entrada = bruta === undefined ? { valor: {} } : lerEntrada(bruta, "--entrada");
      if (entrada.erro) throw new ErroPlano("entrada-invalida", entrada.erro);
      return aposentar({ repo, ciclo, nonce: flag(resto, "--nonce"), entrada: entrada.valor ?? {} });
    }
    case "trazer-ramo":
      return trazerRamo({ repo, ciclo, ramo: flag(resto, "--ramo"), passagem: flag(resto, "--passagem"), tentativa: inteiro(flag(resto, "--tentativa")), nonce: flag(resto, "--nonce") });
    case "desistir-da-passagem":
      return gitConducao.desistirDaPassagem({ repo, ciclo, fase: resto.find((a) => /^F\d{1,2}$/.test(a)), motivo: flag(resto, "--motivo") ?? null });
    case "limpar": {
      const estado = estadoDasTasks(lerMarcas(repo, "HEAD", ciclo), lerRefsLocais(repo, ciclo), gitConducao.lerTrazidas(repo, ciclo));
      return gitConducao.limpar({ repo, ciclo, emVoo: [...estado.emVoo.values()], trazidas: [...estado.trazidas.values()] });
    }
  }
  throw new ErroPlano("uso", `verbo de git desconhecido: ${verbo}`);
}

/**
 * A parada sai com o `ponteiro` da pergunta registrada (`pergunta.ponteiroDa`,
 * SKILL §3.1) e a `chave` escondida (`pergunta.chaveDa`: ciclo, fase, task,
 * origem `condutora`), o mesmo id que o evento do log grava; ponteiro que o verbo já
 * pôs fica. Pura: chamada em todo lugar onde uma parada vira JSON, antes do
 * log, para o ponteiro não depender do adaptador se ler. Parada que não passou
 * pelo construtor sai sem ponteiro, com aviso no stderr.
 */
function comPonteiro(saida) {
  if (saida?.acao !== "perguntar") return saida;
  // A chave escondida da parada (hotfix chave-da-pergunta, 23/11/2026): a condutora a passa ao `abrir`.
  if (saida.chave === undefined) saida.chave = pergunta.chaveDa(saida);
  if (saida.ponteiro !== undefined) return saida;
  if (pergunta.foiConstruida(saida)) saida.ponteiro = pergunta.ponteiroDa(saida);
  else process.stderr.write(`conducao: pergunta ${JSON.stringify(saida.motivo ?? null)} fora do construtor: sai sem ponteiro e sem evento tipado\n`);
  return saida;
}

/**
 * Grava a saída no log de eventos do ciclo, na pasta que o adaptador declara;
 * a pergunta vai para onde o adaptador diz que ela grava (D-VEGA29-4), e com
 * ela o evento `pergunta` da decisão tipada (T12, só tokens). O log nunca
 * derruba o verbo. A parada ganha aqui o `ponteiro` (`comPonteiro`).
 */
function logar(saida, procedencia, quando, decl) {
  const ehPergunta = saida?.acao === "perguntar";
  comPonteiro(saida);
  try {
    logEventos.registrar(saida, { procedencia, quando, pasta: ehPergunta ? decl.pastaDaPergunta : decl.pastaDoLog });
    if (ehPergunta) pergunta.gravar(saida, decl, { quando });
  } catch (e) {
    process.stderr.write(`conducao: log de eventos nao gravado: ${e.message}\n`);
  }
}

/** `registrar-evento`: o que a maestra observou, procedência `observado`. */
function registrarEvento(resto, ciclo, decl) {
  const acao = flag(resto, "--acao");
  if (!acao) throw new ErroPlano("uso", "registrar-evento exige --acao <a>");
  const saida = { acao, ciclo };
  for (const k of ["fase", "task", "sessao", "estado", "sha", "nonce"]) {
    const v = flag(resto, `--${k}`);
    if (v !== undefined) saida[k] = v;
  }
  const n = inteiro(flag(resto, "--tentativa"));
  if (n !== undefined) saida.tentativa = n;
  const r = logEventos.registrar(saida, { procedencia: "observado", quando: flag(resto, "--quando"), pasta: decl.pastaDoLog });
  return { acao: "evento-registrado", ciclo, ...r };
}

/**
 * Git que passou do prazo (T17, 20-a): desfecho nomeado `git-prazo-estourado`
 * como pergunta, com o comando e os `*.lock` achados sob o git-dir — o lock
 * que sobra é o que a próxima chamada encontraria. JSON no stdout (o `main`
 * sai 1); vai ao log quando há ciclo e o adaptador se lê.
 */
function gitPrazoEstourado(e, { verbo, repo, ciclo }) {
  const saida = pergunta.perguntar({
    acao: "perguntar",
    motivo: e.codigo,
    ...(ciclo ? { ciclo } : {}),
    verbo: verbo ?? null,
    comando: e.comando,
    prazoMs: e.prazoMs,
    locks: e.locks,
    detalhe: `${e.message} — nada além do que o git já tinha feito foi gravado; ver o lock antes de repetir`,
  });
  comPonteiro(saida);
  process.stderr.write(`conducao: ${e.codigo}: ${e.message}\n`);
  if (ciclo) {
    try {
      logar(saida, "intencao", undefined, adaptador.lerAdaptador(repo));
    } catch {
      // O adaptador ilegível não esconde o desfecho: o JSON sai igual.
    }
  }
  process.stdout.write(`${JSON.stringify(saida)}\n`);
}

/**
 * Recusa tipada do adaptador (`ErroAdaptador`: declaração ou código inválido)
 * ou do log (`ErroLogV0`: pasta do log com log v0, D-VEGA29-21) como pergunta,
 * com `motivo: e.codigo` — os verbos emitem JSON, e a recusa sai no mesmo
 * canal. A linha do stderr segue a de antes. Não vai ao log: o adaptador que
 * diz onde ele mora é o que não se leu, ou o log é o recusado. O `main` sai 1.
 */
function recusaComoPergunta(e, { verbo, ciclo }) {
  process.stderr.write(`conducao: ${e.codigo}: ${e.message}\n`);
  let saida;
  try {
    saida = pergunta.perguntar({
      acao: "perguntar",
      motivo: e.codigo,
      ...(ciclo ? { ciclo } : {}),
      verbo: verbo ?? null,
      detalhe: e.message,
    });
  } catch (p) {
    // Código fora da forma de motivo: a recusa já está no stderr; o JSON não sai, e o exit segue 1.
    process.stderr.write(`conducao: recusa sem pergunta (${p.message})\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(comPonteiro(saida))}\n`);
}

export function main(argv) {
  const [verbo, ...resto] = argv;
  const repoFlag = flag(resto, "--repo");
  let repo = path.resolve(repoFlag ?? process.cwd());
  const ciclo = flag(resto, "--ciclo");
  const sair = (codigo, msg) => {
    process.stderr.write(`conducao: ${msg}\n`);
    return codigo;
  };
  try {
    if (verbo === "auditar") {
      const nota = flag(resto, "--nota");
      const ref = flag(resto, "--ref");
      if (!nota && !(ciclo && ref)) return sair(2, "auditar exige --nota <arquivo> ou --ciclo <id> --ref <ref>");
      const lista = (nome) => (flag(resto, nome) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const saida = auditar({
        repo,
        ...(nota ? { nota: path.resolve(nota) } : { ciclo, ref }),
        exigirFases: lista("--exigir-fases"),
        exigirEncerramentos: lista("--exigir-encerramentos"),
      });
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return saida.violacoes.length ? 1 : 0;
    }
    if (verbo === "conferir-workflows") {
      const saida = conferirWorkflows({ repo });
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return saida.ok ? 0 : 1;
    }
    if (verbo === "ci") {
      const pr = flag(resto, "--pr");
      if (!pr) return sair(2, "ci exige --push-em <iso> --runs <json> --pr <json>");
      const prazo = inteiro(flag(resto, "--prazo-min"));
      const runs = lerEntrada(flag(resto, "--runs") ?? "[]", "--runs");
      const prLido = lerEntrada(pr, "--pr");
      const problemas = [runs.erro, prLido.erro].filter(Boolean);
      if (problemas.length) {
        const p = pergunta.perguntar({ acao: "perguntar", motivo: "entrada-invalida", ...(ciclo ? { ciclo } : {}), problemas, detalhe: `o ci não lê a entrada: ${problemas.join("; ")}` });
        process.stdout.write(`${JSON.stringify(comPonteiro(p))}\n`);
        return 1;
      }
      const saida = decidirCi({
        pushEm: flag(resto, "--push-em"),
        runs: runs.valor,
        pr: prLido.valor,
        agora: flag(resto, "--agora") ?? null,
        sha: flag(resto, "--sha") ?? null,
        ...(prazo !== undefined ? { prazoMin: prazo } : {}),
        veredito: vereditoDoCi(repo),
      });
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return 0;
    }
    if (verbo === "reinicio-valido") {
      const arquivo = flag(resto, "--arquivo");
      if (!arquivo) return sair(2, "reinicio-valido exige --arquivo <ponte-reinicio.json>");
      const { confirmacao } = carregarReinicio(arquivo, flag(resto, "--ponte-ativa-desde"), repo);
      const saida = confirmacao ?? { valido: false, motivo: "sem-registro" };
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return saida.valido ? 0 : 1;
    }
    if (verbo === "pre-voo") {
      const herdeira = resto.includes("--herdeira");
      if (herdeira && !ciclo) return sair(2, "pre-voo --herdeira exige --ciclo <id>");
      const entrada = lerEntrada(flag(resto, "--entrada"), "--entrada");
      if (entrada.erro) return sair(2, `pre-voo: ${entrada.erro}`);
      const saida = preVoo({ repo, ciclo: ciclo ?? null, herdeira, entrada: entrada.valor ?? {} });
      comPonteiro(saida);
      if (ciclo && saida.acao === "perguntar") logar(saida, "intencao", undefined, adaptador.lerAdaptador(repo));
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return saida.acao === "perguntar" ? 1 : 0;
    }
    if (!ciclo) return sair(2, "--ciclo é obrigatório");
    if (verbo === "criar-ramo") {
      process.stdout.write(`${JSON.stringify(criarRamo({ repo, ciclo, tipo: flag(resto, "--tipo") }))}\n`);
      return 0;
    }
    if (verbo === "etapa") {
      const rodadaBruta = flag(resto, "--rodada");
      const rodada = rodadaBruta === undefined ? undefined : (inteiro(rodadaBruta) ?? NaN);
      const arvore = path.resolve(flag(resto, "--arvore") ?? arvoreDoCiclo(ciclo, repo));
      const lido = tentarGit(arvore, ["rev-parse", "--abbrev-ref", "HEAD"]);
      // Árvore que o git não lê é outro defeito que "fora do ramo": diz o erro real.
      if (lido.status !== 0) throw new ErroPlano("arvore-ilegivel", `o git não lê o ramo de ${arvore}: ${(lido.erro || "sem saída").split("\n")[0]}`);
      const ramo = lido.saida === "HEAD" ? null : lido.saida;
      const saida = pedidoDaEtapa({ repo, ciclo, etapa: resto[0]?.startsWith("--") ? undefined : resto[0], rodada, arvore, ramo });
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return 0;
    }
    if (verbo === "conferir" && !resto.some((a) => /^T\d{1,3}$/.test(a))) return sair(2, "conferir exige T<k>");
    if (repoFlag === undefined && (VERBOS_DA_ARVORE.has(verbo) || VERBOS_GIT.has(verbo))) repo = arvoreDoCiclo(ciclo);
    const decl = adaptador.lerAdaptador(repo);
    if (verbo === "registrar-evento") {
      process.stdout.write(`${JSON.stringify(registrarEvento(resto, ciclo, decl))}\n`);
      return 0;
    }
    if (verbo === "voltar-a-perguntar") {
      process.stdout.write(`${JSON.stringify(voltarAPerguntar({ ciclo, motivo: flag(resto, "--motivo"), recibo: flag(resto, "--recibo"), decl }))}\n`);
      return 0;
    }
    if (VERBOS_GIT.has(verbo)) {
      const saida = verboDeGit(verbo, resto, { repo, ciclo });
      logar(saida, saida.acao === "perguntar" ? "intencao" : "registrado", undefined, decl);
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      // Escrita parcial (T17): a marca está no ramo, a cópia não — sai 1 com o JSON, para a maestra rodar o remédio.
      return saida.acao === "perguntar" || saida.acao === gitConducao.DESFECHO_SEM_COPIA ? 1 : 0;
    }
    let saida;
    if (verbo === "proximo") {
      const { reinicio, confirmacao } = carregarReinicio(flag(resto, "--reinicio"), flag(resto, "--ponte-ativa-desde"), repo);
      if (confirmacao && !confirmacao.valido)
        process.stderr.write(`conducao: registro de reinício ignorado (${confirmacao.motivo}) — a queda não fica coberta\n`);
      if (resto.includes("--nivel")) return sair(2, MOTIVO_SEM_NIVEL);
      const entrada = lerEntrada(flag(resto, "--entrada"), "--entrada");
      saida = proximo({
        repo,
        ciclo,
        entrada: entrada.valor ?? {},
        entradaErro: entrada.erro ?? null,
        reinicio,
      });
      logar(saida, "intencao", undefined, decl);
    }
    else if (verbo === "retomar") saida = retomar({ repo, ciclo });
    else if (verbo === "maestra-atendeu") {
      saida = gitConducao.gravarAtendido({ repo, ciclo, nonce: flag(resto, "--nonce"), sessao: flag(resto, "--sessao-criada") });
      logar(saida, saida.acao === "perguntar" ? "intencao" : "registrado", undefined, decl);
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return saida.acao === "perguntar" ? 1 : 0;
    } else if (verbo === "maestra") {
      saida = maestra({
        repo,
        ciclo,
        sessao: flag(resto, "--sessao"),
        linhagem: flag(resto, "--linhagem"),
        contexto: flag(resto, "--contexto"),
        nonce: flag(resto, "--nonce") ?? null,
        anterior: flag(resto, "--anterior") ?? null,
        ordinal: flag(resto, "--ordinal") === undefined ? 1 : (inteiro(flag(resto, "--ordinal")) ?? NaN),
        registro: flag(resto, "--registro") ?? null,
        herdeira: flag(resto, "--herdeira") ?? null,
      });
      logar(saida, "intencao", undefined, decl);
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return saida.acao === "perguntar" ? 1 : 0;
    }
    else if (verbo === "conferir") {
      const task = resto.find((a) => /^T\d{1,3}$/.test(a));
      saida = conferir({ repo, ciclo, task });
      if (saida.acao === "perguntar") {
        logar(saida, "intencao", undefined, decl);
        process.stdout.write(`${JSON.stringify(saida)}\n`);
        return 1;
      }
    } else
      return sair(2, `verbo desconhecido: ${verbo ?? "(nenhum)"} — proximo | conferir | retomar | auditar | pre-voo | etapa | criar-ramo | registrar-evento | ${[...VERBOS_GIT].join(" | ")} | voltar-a-perguntar`);
    process.stdout.write(`${JSON.stringify(saida)}\n`);
    return 0;
  } catch (e) {
    if (e instanceof ErroGitPrazo) {
      gitPrazoEstourado(e, { verbo, repo, ciclo });
      return 1;
    }
    if (e instanceof ErroPlano) return sair(e.codigo === "teto-do-chamador" ? 2 : 1, `${e.codigo}: ${e.message}`);
    if (e instanceof adaptador.ErroAdaptador || e instanceof logEventos.ErroLogV0) {
      recusaComoPergunta(e, { verbo, ciclo });
      return 1;
    }
    return sair(2, e.stack ?? String(e));
  }
}

const direto = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direto) process.exitCode = main(process.argv.slice(2));

export const SCRIPT = fileURLToPath(import.meta.url);
