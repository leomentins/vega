/**
 * Botões do loop da condução — a ÚNICA fonte de botão que o código
 * da condução lê (D-VEGA22-24). Cada botão traz valor, origem e o sinal medido
 * que o faz mudar; o contrato vivo que os cita é `skills/conducao/references/contrato.md`
 * (bumpado na T18 com a medição da F3 em mãos).
 *
 * Ajustar aqui, nunca no ponto de uso: botão espalhado é botão que ninguém
 * acha quando a oferta (teto, capacidade da ponte) ou a demanda (o que pede
 * o operador) muda.
 */
export const BOTOES = Object.freeze({
  /**
   * Teto de filhas quando a entrada da maestra não traz o da ponte.
   * Origem: `--capacity 16` da ponte de filhas (`systemctl show` de 15/10,
   * §2.2#14 do plano de origem da condução), mantido quando ela foi aposentada
   * (decisao/filha-herdeira-da-maestra): a filha nasce na ponte do operador
   * (`instalar-ponte.sh`, `--capacity 64`), que divide a capacidade com a
   * maestra e as sessões do operador — 16 filhas + maestra cabem com folga.
   * Muda quando: a capacidade da ponte do operador baixar de teto + maestra +
   * sessões do operador, ou a condução pedir mais largura que isto.
   */
  tetoFilhasPadrao: 16,

  /**
   * Largura do ciclo quando o plano não a declara (plano anterior à T5).
   * Origem: leitura conservadora da T5 (`DECLARACOES_PADRAO.largura`) — o
   * plano velho nunca disse que suas tasks rodam juntas.
   * Muda quando: nunca para cima sem declaração do plano; é o piso seguro.
   */
  larguraPadrao: 1,

  /**
   * Falhas de ambiente (`--coberta ambiente`) de uma task antes de o `proximo`
   * parar e perguntar (`teto-de-falhas-ambiente`). A tentativa encerrada por
   * pergunta respondida com re-plano (`--coberta pergunta`) não entra aqui nem
   * no teto de trabalho (ATRM-54 F4). Não somam ao teto de 2 do
   * trabalho, mas ambiente que cai três vezes na mesma task não é acaso.
   * Origem: ATRM-51 F0 (22/10/2026) — a T3 caiu 2 vezes por ambiente antes de
   * passar; a 3ª no mesmo lugar pede o operador, não outra tentativa.
   * Muda quando: um ciclo conduzido medir ambiente legítimo caindo 3+ vezes.
   */
  tetoFalhasAmbiente: 3,

  /**
   * Minutos de silêncio da filha caída (`status_bucket` `FAILED`, sem aviso)
   * depois da mensagem da maestra (`cutucar`) antes de a vigia contar falha
   * de ambiente e reabrir a tentativa (T18 do VEGA-29, sota E2.B2: a sessão
   * servida pela ponte que cai volta com uma mensagem, sem reiniciar a ponte).
   * Origem: a queda passageira medida da ponte (VEGA-37 T3,
   * `notes/medicao-vigia-T3.md`: 2 reinícios no journal da unidade, 45 s e
   * 294 s, máximo arredondado a 5 min) — 10 min é o dobro do máximo medido;
   * a filha que volta responde no turno seguinte, em segundos.
   * Muda quando: um ciclo conduzido medir a filha cutucada voltando depois
   * disto, ou a série de quedas que a vigia grava (`queda`, T21) passar de 5 min.
   */
  silencioFilhaCaidaMin: 10,

  /**
   * Minutos de silêncio da condutora caída (`status_bucket` `FAILED`) depois
   * da mensagem da maestra (`cutucar`, `proximo --nivel maestra`) antes de a
   * maestra perguntar ao operador (`perguntar condutora-caida`, situação
   * `caida`) em vez de esperar sem prazo (T39 do VEGA-29, no molde da T18).
   * Origem: a mesma medição de `silencioFilhaCaidaMin` (queda passageira da
   * ponte, máximo 5 min, VEGA-37 T3) — a condutora é uma sessão servida pela
   * mesma ponte, e volta com a mensagem no turno seguinte.
   * Muda quando: um ciclo conduzido medir a condutora cutucada voltando depois
   * disto, ou a pergunta saindo com a condutora ainda a caminho de voltar.
   */
  silencioCondutoraCaidaMin: 10,

  /**
   * Prazo de uma task sem `**Prazo:**` declarado, em minutos.
   * Origem: nasceu chute do plano de origem da condução; a VEGA-37 T3 mediu a
   * duração da operária em curso (393 tentativas de 9 ciclos,
   * `notes/medicao-vigia-T3.md`): p95 36 min, p99 124 min — 120 fica entre
   * os dois (acima de mais de 95% das tentativas medidas, abaixo do p99).
   * Muda quando: a amostra crescer e o p95 da operária em curso passar de 120,
   * ou a vigia (T21) medir mais de 5% das tentativas estourando o prazo sem queda.
   */
  prazoPadraoMin: 120,

  /**
   * Minutos depois do push de fim de fase sem run do CI nascer para o
   * `conducao.mjs ci` decidir "sem run" e avisar o operador com o estado de
   * mesclagem da proposta (proposta `CONFLICTING` não gera run —
   * `veredito-de-ci.md` item 1).
   * Origem: a F0 do plano de origem da condução mediu o run nascendo no mesmo minuto do push
   * (`minutos_ate_o_run_nascer: 0`, `notes/premissas-f0.md`); 15 é folga
   * para fila do GitHub, não medição.
   * Muda quando: a T18 medir run nascendo depois disto em proposta saudável.
   * Não se aplica a projeto sem CI (`ci: false` no adaptador, T15): ali a
   * fase fecha pela Verificação da última tarefa e nenhum run é esperado.
   */
  prazoRunCiMin: 15,

  /**
   * Prazo, em minutos desde a criação da herdeira, para ela confirmar a
   * passagem (VEGA-37 T16, ordem da troca). Passado o prazo sem confirmação,
   * cada lado decide pela época: parada, a anterior retoma; subida, a anterior
   * para e avisa o operador.
   * Origem: p95 do tempo de partida de uma condutora, 59 min (44 partidas,
   * `notes/medicao-passagem-T4.md` do VEGA-37; p50 0,8 min, a cauda é de
   * sessão retomada depois de espera), com margem declarada de 50% sobre ele
   * (59 × 1,5 = 88,5, arredondado para cima): a herdeira que parte na cauda
   * ainda tem o trazer, a posse e a inscrição pela frente.
   * Muda quando: a amostra passar de 44 partidas e o p95 mudar, ou uma
   * passagem medida confirmar depois do prazo com a herdeira saudável.
   */
  prazoConfirmacaoPassagemMin: 89,

  // ── vigia por estado (VEGA-37 T21, D-VEGA37-5 e D-VEGA37-10) ──────────────
  // Lidos por `vigia.mjs`. O prazo de cada estado é o p99 medido na T3
  // (`notes/medicao-vigia-T3.md` do VEGA-37: 9 ciclos, 9.621 linhas de log,
  // 17 dias) mais a margem da queda passageira (máximo medido, 5 min), na
  // opção que o operador escolheu na T6 (decisão 6c, `notes/teto-de-avisos-T6.md`).
  // Pergunta aberta ao operador não tem prazo: esperar o operador não é queda.

  /**
   * Prazo de silêncio com operária em curso (da abertura da tentativa ao aviso).
   * Origem: p99 124 min (393 intervalos, T3) + 5 min de queda passageira = 129.
   * Muda quando: o p99 da série de `vida` com estado `operaria` sair de
   * 124 min, ou a queda passageira medida pelos eventos `queda` passar de 5 min.
   */
  prazoOperariaEmCursoMin: 129,

  /**
   * Prazo de silêncio com CI em curso (duração do run do workflow no GitHub).
   * Origem: p99 61 min (137 runs terminais, T3) + 5 min de queda passageira = 66.
   * Muda quando: o p99 da duração dos runs de `ciclo-*` sair de 61 min.
   */
  prazoCiEmCursoMin: 66,

  /**
   * Prazo de silêncio com a condutora trabalhando sem nada aberto.
   * Origem: p99 47 min (989 fatias de até 4 h, T3) + 5 min de queda passageira = 52.
   * Muda quando: o p99 da série de `vida` com estado `livre` sair de 47 min.
   */
  prazoCondutoraLivreMin: 52,

  /**
   * Fração do prazo do estado em que a condutora grava o próximo sinal de
   * vida: nem antes de `fracaoSinalDeVidaMin` (enche o log e o despertador),
   * nem depois de `fracaoSinalDeVidaMax` (o prazo vence antes do sinal).
   * Origem: fonte externa, validação SOTA do VEGA-37 (2.B2, duas fontes,
   * `notes/sota-validation-20261113.md`): Kubernetes renova a posse na metade
   * do prazo ("renewal every leaseDurationSeconds ÷ 2"); Temporal limita o
   * heartbeat a 0,8 do timeout ("heartbeatTimeout * 0.8").
   * Muda quando: a vigia medir aviso falso de sinal gravado dentro da janela
   * (o sinal chegou, mas depois do prazo).
   */
  fracaoSinalDeVidaMin: 0.5,
  fracaoSinalDeVidaMax: 0.8,

  /**
   * Fator do intervalo entre avisos repetidos da mesma queda: o primeiro sai
   * quando o prazo vence, e cada seguinte espera o intervalo anterior vezes este.
   * Origem: fonte externa, validação SOTA do VEGA-37 (2.B1, `[single-source]`):
   * RFC 6298 §5.5, "The host MUST set RTO <- RTO * 2 ("back off the timer")".
   * Muda quando: o operador disser que o aviso repetido chega espaçado demais
   * (ou cedo demais) para a queda que ele ainda não atendeu.
   */
  dobraDoAviso: 2,

  /**
   * Teto de avisos da vigia ao operador por dia `America/Sao_Paulo`, somados
   * todos os ciclos. Alcançado o teto, a queda segue no log e o aviso espera o
   * dia seguinte.
   * Origem: decisão 6c do operador na T6 do VEGA-37 (`teto-avisos-por-dia: 2`,
   * `notes/teto-de-avisos-T6.md`), sobre o pior caso de ~0,65 aviso falso por
   * dia que a T3 mediu com os prazos no p99 + 5 min.
   * Muda quando: o operador fixar outro teto, ou a contagem real de avisos por
   * dia (eventos `aviso-da-vigia`) bater o teto em dia sem queda real.
   */
  tetoAvisosPorDia: 2,

  // Publicação, caminhos clínicos e telas dos Steps são do projeto: vêm do
  // código do adaptador (`publicacao`, `caminhosProtegidos`,
  // `telasProtegidasDosSteps`, `foraDasTelasDosSteps`; T20).

  /**
   * Superfícies de instrução: o que a maestra (ou o harness dela) lê como
   * instrução ou permissão no turno seguinte — settings, skills, regras,
   * agentes, `AGENTS.md`, MCP e o que decide CI e revisão. Trabalho de filha
   * que toca isto pergunta antes de trazer, separado do alcance dos hooks.
   * Origem: MAJOR do security-reviewer no fechamento de F2, ruling 16.1a de
   * o operador (15/10/2026).
   * Muda quando: nasce arquivo que o harness lê como instrução fora daqui.
   * A pasta de configuração do host não tem nome no núcleo (T30, D-VEGA29-15):
   * vale qualquer pasta oculta da raiz (o glob começa por `.*`), que pergunta
   * a mais, nunca a menos; o arquivo de instrução que o host lê pelo nome vem
   * da declaração (`sessao.instrucoes`), somado a esta lista.
   */
  superficiesDeInstrucao: Object.freeze([
    ".*/settings*.json",
    ".*/skills/**",
    ".*/rules/**",
    ".*/agents/**",
    ".*/commands/**",
    ".*/workflows/**",
    ".*/launch.json",
    "**/AGENTS.md",
    ".mcp.json",
    // Código do adaptador do projeto (T20): o núcleo o carrega e executa na
    // maestra — filha que o muda pergunta antes de trazer. `.vega/` é a
    // declaração do projeto à fábrica (HN-29 T11); `.altair/`, a de antes.
    ".vega/**",
    ".altair/**",
    ".github/workflows/**",
    ".github/CODEOWNERS",
  ]),

  /**
   * Base fixa do alcance: o que os hooks de commit da maestra executam, mais
   * a pasta de estado do host (pasta oculta, glob `.*`) e os verbos de
   * publicação. Trabalho de filha que toca isto pergunta antes de trazer
   * (D-VEGA22-17). A T8 deriva e confere a lista contra os próprios hooks;
   * aqui mora só o valor.
   * Origem: esboço §Paradas para o operador, §2.2#8 e rulings 1a e PD-2 do
   * plan-review v1; `.squawk.toml` entrou na T8, achado pela extração (o
   * `pre-commit` roda o squawk com essa config) — a medição §2.2#8 só olhou
   * a pasta do host.
   * O que só um projeto executa (os scripts dele, o schema que o validador
   * dele lê, as configs de publicação) não mora aqui: vem do código do
   * adaptador (`alcanceDosHooks`, HN-29 T39), somado a esta base.
   * Muda quando: um hook de commit passa a chamar algo fora dela (o teste da
   * T8 falha).
   */
  baseAlcance: Object.freeze([
    ".husky/**",
    ".*/hooks/**",
    ".*/scripts/**",
    ".*/state/**",
    ".*/rules/financial.md",
    "**/package.json",
    "turbo.json",
    "pnpm-lock.yaml",
    // Review da execução (T19): o pnpm e o node leem estes ao rodar a
    // Verificação ou os hooks — `.npmrc` (`script-shell`) e `.pnpmfile.cjs`
    // executam código sem passar por package.json.
    "**/.npmrc",
    ".pnpmfile.cjs",
    "pnpm-workspace.yaml",
    ".nvmrc",
    ".envrc",
    ".gitattributes",
    "**/*.config.js",
    "**/*.config.mjs",
    "**/*.config.cjs",
    "**/*.config.ts",
    "**/eslint.config.*",
    "**/vitest.config.*",
    "**/.prettierrc*",
    "**/prettier.config.*",
    ".squawk.toml",
  ]),
});
