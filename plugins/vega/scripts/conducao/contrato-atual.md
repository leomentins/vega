# Contrato atual da condução — o que o código faz hoje

> Escrito na T2 do VEGA-29 (F0, contrato escrito do que existe), lido de `conducao.mjs` e `git-conducao.mjs`.
> **Conferido contra o código** por `__tests__/contrato-atual.test.mjs`: o teste extrai cada conjunto do código-fonte e exige igualdade com as tabelas abaixo. Ação, motivo, código de saída, marca ou trailer novo no código sem linha aqui ⇒ o teste falha nomeando o item; linha aqui sem par no código ⇒ falha também.
> O teste lê só a **primeira coluna** de cada tabela (e a segunda onde o par é a chave: motivo, expressão, regex, leitora). As outras colunas são prosa, sem conferência.
> Este arquivo descreve; não decide. Quando a reconstrução do núcleo (F1) mudar o código, o texto muda junto, na mesma task.

Alcance de cada conjunto:

- **Ações e motivos** — o caminho do `proximo`: as funções `decidir`, `proximo` e `erroComoPergunta` de `conducao.mjs` (o antigo nível acima da condutora, `decidirMaestra` e `--nivel maestra`, saiu na VEGA-37 T8: o `--nivel` sai 2 com o motivo do papel aposentado), e as regras de `regras.mjs`. Os verbos de git (`autorizar-ciclo`, `abrir`, `trazer`, …) também respondem `perguntar` com motivo próprio, mas ficam fora desta tabela.
- **Códigos de saída** — a função `main` de `conducao.mjs` (o CLI inteiro).
- **Marcas e trailers** — `lerMarcas` (`conducao.mjs`) e `ultimaAutorizacao` (`git-conducao.mjs`). A marca `trazida` vive em referência local fora do ramo e é lida por `lerTrazidas`, não por estas duas.

## Ações do proximo

| ação | `o que a maestra faz` (cabeçalho antigo; hoje, o que a condutora faz) |
| --- | --- |
| `arquivar` | arquiva a sessão da filha cujo aviso já foi decidido; vem antes de toda outra ação e o nonce não depende do HEAD |
| `abrir` | grava o marcador de cada task da leva (`abrir T<k>`) e cria a filha com a `partida` |
| `trazer` | traz a tentativa avisada `OK` para o ramo do ciclo e confere |
| `esperar` | não faz nada agora; o `motivo` diz pelo quê |
| `perguntar` | leva a pergunta ao operador; o `motivo` diz qual |
| `cutucar` | manda a `mensagem` à filha caída (`sessao`) e passa `cutucadaEm` nessa filha da entrada seguinte (T18). O `cutucadaEm` vale só para a queda em curso (T40): com `caidaEm` na filha (o instante em que quem conduz a leu `FAILED` pela primeira vez nesta queda, gravado uma vez e não regravado enquanto ela seguir `FAILED`; posterior a `agora` é `entrada-invalida`), `cutucadaEm` anterior a ele é de queda velha e não conta, e a sessão que voltou e caiu de novo recebe o seu `cutucar`; sem `caidaEm`, vale o `cutucadaEm` como veio |
| `herdar-autorizacao` | grava a autorização herdada da fase (re-plano de ruling ou sim do ciclo), sem perguntar ao operador |
| `autorizar-pela-resposta` | no lugar do `perguntar plano-mudou`, quando todo commit do re-plano desde a autorização da fase traz o trailer `Replano-Pergunta` com o mesmo id (`pergunta`): a resposta do operador que pediu o re-plano é o sim da fase sob o plano novo. Quem conduz roda o `comando` (`autorizar-ciclo F<n> --pergunta <p-…> --sim "<texto da opção escolhida>"`), que confere a resposta humana, o ciclo, a opção e o uso único, e aceita o ponteiro `conducao:` só de parada que replaneja (`PARADAS_QUE_REPLANEJAM`) e só quando todo commit do canonico desde a autorização a cita; a marca leva `Conducao-Pergunta-Parada: sim`, que a herança relê; passa o `aviso` ao operador, com as tasks mudadas e as sensíveis cobertas pelo nome (`sensiveis`). Fase reaberta sem fechamento segue perguntando (hotfix conducao-corta-paradas-de-regra) |
| `aposentada` | no lugar do `perguntar` de task cuja calibração (`calibracao.mjs`, T6) está no degrau `aposentado` e cuja instância passa os vetos (publicação, caminho protegido ou clínico, estação `condutora`, exclusões de `consentimento.mjs`, salvo `canonico-do-ciclo`) (VEGA-20 T19): quem conduz roda o `comando` (`aposentar --nonce <nonce>`, que refaz o `proximo` e grava o commit `Conducao: T<k> aposentada <motivo>` com o trailer `Conducao-Aposentada`), aplica a `opcao` da resposta constante como aplicaria a do operador, com `textoDeQuemResponde` onde a opção pede o texto do operador, e põe o `relato` (`seguiu sozinha: <motivo> (<n> iguais)`) no relato que já entrega; nunca mensagem própria. A instância leva os Outputs, os caminhos dos Steps e o que a trazida trouxe de fora dos Outputs; task sem Outputs para. Uma aposentadoria por task e motivo: a mesma de volta depois do commit sai `perguntar` com `aposentadaAplicada` |
| `reentregar` | tentativa aberta sem operária na entrada, dentro do `prazoMin` da task e fora do reinício da ponte: quem conduz roda o `comando` (`abrir T<k> --tentativa <n> --nonce <nonce da tentativa>`, que devolve a mesma partida com `jaAberta: true`), confere por `list_sessions` que a operária dessa tentativa não existe e só então a cria; existindo, só a põe na entrada. Passado o prazo, `perguntar tentativa-sem-filha` (hotfix conducao-corta-paradas-de-regra) |
| `fazer-condutora` | executa ela mesma a task de estação `condutora` (`maestra`, o nome antigo, lido igual) e registra com `--condutora` (`--maestra` aceito), trailer `Conducao-Executor: condutora` |
| `fechar-fase` | conduz a task de fechamento da fase |
| `encerrar-sessao` | grava o encerramento da fase anterior e, em `criar`, leva o `criar-condutora` da fase seguinte, que a própria condutora executa (VEGA-37 T8); `texto` é o prompt da sessão nova |
| `fechar-ciclo` | entrega o texto do `/close-cycle` em sessão limpa |
| `parar` | para a condução; o `motivo` diz por quê |
| `criar-condutora` | só dentro do `encerrar-sessao` (campo `criar`), com CI verde: a condutora que encerra cria a da fase seguinte, com `fase`, `nome` pela fase (`<ciclo> · F<n>`, D-VEGA37-2, D-VEGA37-18), `modelo` do heading da fase, `tentativa` e `texto` da sessão como prompt; CI vermelho ou pendente não cria |
| `criar-fechamento` | `maestraCriarFechamento` (nome antigo), sem chamador no `proximo` desde a VEGA-37 T8 (a T10 a troca pelo `criar-condutora` de fase `fechamento`): depois de `Conducao-Encerrada: ciclo`, a sessão de fechamento com o `texto` do `/close-cycle` |
| `passar` | ordem da troca (VEGA-37 T16), na fronteira: depois do encerramento gravado com `Conducao-Depois: passar`, a fase seguinte sem autorização e nenhuma passagem confirmada da fase anterior, a condutora escreve a nota no `molde` e roda `passar F<n> --nota`; `faseSeguinte` é a da herdeira, `tentativa` conta as desistências |
| `desanexar-ramo` | a anterior em passagem com o ramo ainda anexado roda `desanexar-ramo --nonce` (`git switch --detach`) e fica com a posse |
| `passar-posse` | a herdeira com o ramo trazido e a posse ainda alheia roda o verbo `passar-posse` do projeto com o `lock_id` e a `epoca` da nota: a época sobe nessa escrita |
| `soltar-inscricao` | a anterior destituída (a época subiu) solta a inscrição na proposta (`unsubscribe_pr_activity`) |
| `inscrever-na-proposta` | a condutora chama `subscribe_pr_activity` na proposta: no fechamento (`comPassosDoRamo`, T9) e, na ordem da troca, a herdeira dona antes de confirmar (`depois: "confirmar-passagem"`) |
| `confirmar-passagem` | a herdeira dona e inscrita roda `confirmar-passagem --nonce`: marca `passagem confirmada`, com a árvore suja da anterior registrada (`arvoreSuja`) |
| `retomar-da-passagem` | sem confirmação no prazo e época parada, na primeira falha: a anterior roda `retomar-da-passagem --nonce` (reanexa o ramo, grava a desistência) e arquiva a herdeira (`arquivar`), sem reabri-la |
| `arquivar-anterior` | a herdeira dona, logo depois da confirmação, com a anterior (`entrada.anterior`) não arquivada ou sem estado: `archive_session` da `sessao` dela (D19a); o `nonceArquivar` executado entra em `anterior.arquivamentos`, e duas vezes sem `ARCHIVED` sai `perguntar falha-de-arquivamento`. A anterior destituída não espera: solta a inscrição e para |
| `desmontar-anterior` | a herdeira dona, depois da confirmação, com a anterior `ARCHIVED` e a árvore dela limpa, roda `desmontar-anterior --nonce --arquivadas <lista>`: o nome na lista da limpeza e `git worktree remove` sem `--force` |

A lista de ações do cabeçalho de `conducao.mjs` não cita `fazer-condutora`; o código a emite (task de estação `condutora`). `fazer-maestra` é o nome antigo da mesma ação (D-VEGA26-21) e o código não o emite mais. Esta tabela segue o código.

## Motivos por ação

| ação | motivo | quando |
| --- | --- | --- |
| `perguntar` | `autorizar-ciclo` | fase seguinte sem autorização (ou nenhuma autorização ainda, com `sugestao`) e sem sim do ciclo que a cubra — inclusive task que mudou de classe ou de sensibilidade desde o sim; pede o sim do ciclo, porque o `autorizar-fase` foi aposentado (T13); o sim entra com `--pergunta <p-…>`, a pergunta registrada de origem humana (VEGA-19 T16) |
| `perguntar` | `entrada-invalida` | a entrada de quem conduz (`--entrada`) não se lê ou tem forma errada (`problemasDaEntrada`: campo de cima desconhecido, lista que não é lista, tipo errado); vem antes de toda decisão, com `problemas` (T17). Objeto vazio no lugar de lista vale como lista vazia, e `statusBucket` e `nonce` a mais na herdeira ou na anterior passam (outro campo a mais segue parando) (hotfix conducao-corta-paradas-de-regra) |
| `perguntar` | `consentimento-nao-gravado` | tentativa trazida com caso que seguiu sem pergunta ainda sem registro no git (o `trazer` não o gravou); vem antes de toda decisão, com `remedio: regravar-consentimentos` — a task não segue enquanto faltar (D-VEGA37-36, VEGA-37 T34) |
| `perguntar` | `trazida-ilegivel` | registro `trazida` cujos casos não se leem (trailer `Conducao-Consentidos` ilegível, ou sem `Conducao-Base` no regravar); vem antes de toda decisão, com `remedio: operador` e sem o comando do regravar, que releria o mesmo trailer (VEGA-19 T16) |
| `perguntar` | `plano-mudou` | o canonico no HEAD difere do plano congelado na autorização, sem herança possível e sem a resposta que pediu o re-plano citada em `Replano-Pergunta` (com ela, `autorizar-pela-resposta`) |
| `perguntar` | `replano-repetido` | o re-plano com `Replano-Motivo` caberia na regra do re-plano sozinho, mas a chave dele já apareceu num re-plano anterior do ciclo: seguir, consertar o molde, ou os dois |
| `perguntar` | `fase-autorizada-fora-do-plano` | nenhuma fase autorizada existe no plano congelado |
| `perguntar` | `fase-reaberta-sem-fechamento` | fase reaberta cujas tasks novas não terminam em fechamento, ou reautorizada com o fechamento velho já conferido |
| `perguntar` | `falha-de-arquivamento` | o mesmo `arquivar` executado 2 vezes sem a filha chegar a `ARCHIVED` |
| `perguntar` | `ci-vermelho` | CI vermelho no HEAD antes do `encerrar-sessao` ou do `fechar-ciclo` |
| `perguntar` | `trazida-sem-conferencia` | tentativa trazida sem conferência gravada (interrupção no meio do trazer); na task de conferência do operador por arquivo, traz `conferenciaDoOperador` (e `liveUxGate: true`, o nome antigo, mantido no caso por arquivo) |
| `perguntar` | `conferencia-do-operador` | tentativa trazida de task de conferência do operador por pergunta (T14, 7-a): o resultado é do operador — opções `sim` (conferência com `--operador`) e `nao` (`--rodada nao --operador`, rodada nova) |
| `perguntar` | `task-sensivel` | fora do sim dado à fase, task que toca caminho clínico (`caminhosQuePerguntam`) ou publica alterando o existente (`porque`: `caminho-clinico` · `publicacao-que-altera`), sem aprovação dela em `aprovacoes` (por task, toda tentativa); publicação só de acréscimo sai coberta pelo sim do ciclo (D18a). Uma pergunta por fase: `tasks` lista pelo nome toda sensível pendente da fase, e o sim vale para todas (uma aprovação por task listada); `task` e `porque` são os da primeira (hotfix conducao-corta-paradas-de-regra) |
| `perguntar` | `sem-saida` | nenhuma regra decide: tasks pendentes com dependências não feitas |
| `perguntar` | `marcador-invalido` | tentativa em voo sem nonce legível no marcador |
| `perguntar` | `pergunta-da-filha` | a filha avisou `T<k>-FALHA pergunta <nonce>`; resposta com re-plano encerra a tentativa por `registrar-falha --coberta pergunta --motivo`, fora de todo teto |
| `perguntar` | `segunda-falha` | falha avisada, ou Verificação vermelha revertida, numa task que já tem 1 falha contada |
| `perguntar` | `filha-sumiu` | as filhas da tentativa estão `ARCHIVED` sem aviso, fora do reinício da ponte |
| `perguntar` | `tentativa-sem-filha` | tentativa em voo sem filha nenhuma na entrada, fora do reinício da ponte e passado o `prazoMin` da task (dentro dele, `reentregar`) |
| `perguntar` | `filha-esperando-clique` | filha viva da tentativa com `statusBucket` `BLOCKED` (ou estado `REQUIRES_ACTION`), sem aviso: no primeiro ciclo da vigia, sem falha a gravar (T18) |
| `perguntar` | `prazo-vencido` | tentativa aberta há mais que o `prazoMin` da task |
| `perguntar` | `teto-de-falhas` | task com 2 falhas contadas |
| `perguntar` | `teto-de-falhas-ambiente` | task no teto próprio de falhas de ambiente (`BOTOES.tetoFalhasAmbiente`) |
| `reentregar` | `operaria-nao-nasceu` | tentativa em voo sem filha nenhuma na entrada, dentro do `prazoMin` da task e fora do reinício da ponte: o `abrir` com o mesmo nonce devolve a mesma partida |
| `cutucar` | `filha-caida` | todas as filhas vivas da tentativa com `statusBucket` `FAILED`, sem aviso e sem `cutucadaEm` desta queda (T40): a mensagem vem antes de contar falha de ambiente (T18) |
| `esperar` | `mesclado` | a proposta do ciclo está `MERGED`: depois do merge o `proximo` não emite nada |
| `esperar` | `ci-pendente` | sem veredito de CI no HEAD antes do `encerrar-sessao` ou do `fechar-ciclo` |
| `esperar` | `filhas-em-voo` | nada a abrir agora e há filhas em voo na fase |
| `esperar` | `condutora-viva` | `maestraCriarFechamento` (nome antigo, sem chamador desde a T8): a sessão de fechamento ainda vive |
| `esperar` | `sem-vaga` | há task pronta no servidor e nenhuma vaga (largura do ciclo ou teto da ponte) |
| `parar` | `publicacao-recusada` | a fase tem task com `Conducao: T<k> publicacao recusada` |
| `parar` | `workstation` | só resta task de estação `workstation` |
| `parar` | `passagem-epoca-subiu` | anterior destituída sem confirmação da herdeira no prazo: a dona é a herdeira; a anterior não retoma e avisa o operador |
| `parar` | `passagem-entregue` | anterior destituída, inscrição solta, com a confirmação já na ponta do ramo: para; a herdeira a arquiva (`arquivar-anterior`, D19a) |
| `parar` | `passagem-entregue-sem-confirmacao` | anterior destituída, inscrição solta, sem confirmação ainda nem prazo vencido: para sem esperar (D19a) e leva ao operador a herdeira e o prazo (`prazoMin`, `minutos`) — se ela cair antes de confirmar, quem decide é ele |
| `perguntar` | `passagem-sem-posse` | passagem aberta sem a época para decidir o papel (posse ilegível, sem posse, época torta) ou nota sem `Conducao-Lock` para a herdeira |
| `perguntar` | `passagem-sem-fase-seguinte` | passagem de fronteira da última fase do plano: a fronteira dela é o fechamento do ciclo |
| `perguntar` | `passagem-sem-confirmacao` | segunda falha de confirmação com a época parada na mesma fase |
| `perguntar` | `arvore-da-anterior-suja` | a árvore da anterior arquivada ficou suja depois da confirmação: nada se apaga |
| `esperar` | `passagem-em-curso` | a herdeira criada ainda dentro do prazo de confirmação (`prazoMin`) |

## Motivos não literais

| ação | expressão | de onde vem |
| --- | --- | --- |
| `perguntar` | `e.codigo` | `erroComoPergunta`: o plano no HEAD ou o congelado não se lê; o motivo é o código do `ErroPlano` de `ler-plano.mjs` |
| `perguntar` | `motivo` | `{ motivo, … }` abreviado em `decidir`: o 1º elemento da tupla de `perguntasDaVigia` (os literais estão em §Motivos por ação; o teste exige que a vigia só cresça por `push([…])` com motivo literal) |
| `aposentada` | `parada.motivo` | `acaoDaAposentadoria` (regras.mjs, VEGA-20 T19): o motivo da parada que a calibração aposentou — o de uma `perguntar` de §Motivos por ação |
| `esperar` | `motivoDoCtx(ctx)` | `regraFecharCiclo` e `maestraCriarFechamento` (nome antigo), com o ciclo já marcado encerrado: o fechamento roda em outra sessão. `motivoDoFechamento` do `fechamentoDoCiclo` do adaptador — `<comando sem a barra>-em-sessao-limpa`; sem o campo, `fechamento-em-sessao-limpa` |

## Motivos da falha anterior

Não são motivos de ação: vão no campo `falhaAnterior` de cada tarefa do `abrir`, que grava a falha da tentativa que caiu antes do marcador novo.

| motivo | quando |
| --- | --- |
| `falha-avisada` | a filha avisou `FALHA` (que não é pergunta) e a task não tinha falha contada |
| `reinicio-da-ponte` | a filha sumiu numa tentativa aberta antes do reinício confirmado da ponte; `coberta: sim`, não conta falha |
| `filha-caida-em-silencio` | a filha caída seguiu `FAILED` por `BOTOES.silencioFilhaCaidaMin` depois do `cutucadaEm` desta queda (T40); `coberta: ambiente`, conta no teto de ambiente (T18) |
| `verificacao-vermelha` | a tentativa trazida foi revertida pela Verificação vermelha e a task não tinha falha contada |

## Códigos de saída

| código | quando |
| --- | --- |
| `0` | saída normal de qualquer verbo, inclusive `perguntar` do `proximo` (`entrada-invalida` também); `ci` com entrada legível sai sempre 0, e `registrar-evento` também, salvo a recusa do log v0 |
| `1` | resposta `perguntar` de verbo de git, do `conferir` ou do `ci` (entrada ilegível); `registrado-sem-copia` de verbo de git; `perguntar git-prazo-estourado` de qualquer verbo; `auditar` com violação; `conferir-workflows` com workflow reprovado; `reinicio-valido` não confirmado; `ErroPlano` com código diferente de `teto-do-chamador`; `perguntar` do `ErroAdaptador` (`adaptador-invalido`, ou `entrada-invalida` no campo `codigo`) ou do `ErroLogV0` (`log-v0-so-leitura`) |
| `2` | uso: flag obrigatória ausente, `--ciclo` ausente, verbo desconhecido; `ErroPlano` `teto-do-chamador` (o `esperar-filha` sem teto de quem chama ou acima dele); exceção inesperada |

## Desfechos da fronteira (T17)

Fora do caminho do `proximo`, por isso fora das tabelas que o teste lê; o teste deles é `__tests__/fronteira.test.mjs`.

- **`perguntar entrada-invalida` do `ci`** — `--pr` ou `--runs` que não se lê (arquivo ausente, JSON ilegível): JSON com `problemas` no stdout, exit 1. Antes saía exit 2 com a pilha.
- **`perguntar git-prazo-estourado`** — um `git` do executor único (`git-exec.mjs`, também o `git` de `ler-plano.mjs`) passou do prazo (`PRAZO_GIT_MS` local, `PRAZO_REDE_MS` rede) e foi morto com `SIGKILL`: JSON com `comando`, `prazoMs` e `locks` (os `*.lock` sob o git-dir) no stdout, linha no stderr, exit 1. O `tentarGit` não lança: devolve `status: null`, `prazoEstourado: true` e os `locks`.
- **`perguntar` do adaptador e do log v0** (T36) — `ErroAdaptador` (declaração ou código do adaptador inválido) e `ErroLogV0` (`registrar-evento` sobre pasta do log que já tem log v0: o arquivo, quantas linhas sem versão, e que o v0 é só leitura) saem como `perguntar` com `motivo` = o código do erro e a mensagem no `detalhe`, JSON no stdout, a mesma linha de antes no stderr, exit 1, sem ir ao log. Antes saíam exit 1 só com stderr (o adaptador) ou exit 2 com a pilha (o log v0). O `brief-indisponivel` do `abrir` leva o código do erro quando ele tem um (`entrada-invalida` do adaptador, o do `ErroPlano`, o `nao-ilegivel` da marca `rodada` cujo corpo não traz o prefixo do não), a página declarada (`pagina`) fora do HEAD sai `pagina-inexistente` (T38), e o `ci.veredito` ilegível escreve o erro no stderr antes de voltar ao padrão.
- **`registrado-sem-copia`** — o verbo de git gravou a marca no ramo e o push da cópia foi recusado (`copia-push-falhou`, `copia-sem-proposta`): a saída do verbo com `acao: registrado-sem-copia`, `desfecho` = a ação que gravou, `motivo` = o código da recusa, `remedio: empurrar-copia` e `copia: null`, exit 1. Antes subia como `ErroPlano` e o chamador recebia só stderr para algo que estava feito.

## Campo `codigo` da declaração

Fora do caminho do `proximo`, por isso fora das tabelas que o teste deste arquivo lê; o teste dele é `__tests__/adaptador.test.mjs`. Lido de `adaptador.mjs` (`validar`, `codigoDoAdaptador`). O `codigo` existe só na versão 2 do esquema.

| valor de `codigo` | o núcleo carrega |
| --- | --- |
| terminado em `.mjs` | o arquivo em `<repo>/.altair/`, por `realpath` (segmento `..`, caminho absoluto ou link que salte para fora ⇒ `adaptador-invalido`); por exemplo `projeto.mjs` |
| nome embutido (minúsculas, dígitos e hífen, `NOME_EMBUTIDO`, ex. `superpowers`; a mesma régua no esquema) | o adaptador embutido no núcleo, `adaptadores/<nome>.mjs`: o nome só resolve contra a lista fechada dos arquivos de `adaptadores/`, e o caminho sai da entrada da lista, nunca do texto declarado; nome fora da lista ⇒ `entrada-invalida` |
| ausente | o código da árvore do núcleo, como hoje |
| outro valor (`../x`, `x.js`, `a/b`, `Foo`, `a\b`, `-x`) | nada: a declaração recusa com `entrada-invalida` (exit 1 no CLI, pelo `ErroAdaptador`) |

## Marcas pelo subject

O subject inteiro casa a regex; o corpo não conta (o `--grep` do git só filtra candidatos). `lerMarcas` lê o histórico do HEAD em ordem cronológica (`--reverse --topo-order`); `ultimaAutorizacao` pega a mais recente.

| tipo | subject (regex) | lida por |
| --- | --- | --- |
| `autorizada` | `^Conducao: (F\d{1,2}) autorizada$` | lerMarcas, ultimaAutorizacao |
| `conferida` | `^Conducao: (T\d{1,3}) conferida$` | lerMarcas |
| `falhou` | `^Conducao: (T\d{1,3}) tentativa (\d+) falhou$` | lerMarcas |
| `revertida` | `^Conducao: (T\d{1,3}) tentativa (\d+) revertida$` | lerMarcas |
| `rodada` | `^Conducao: (T\d{1,3}) tentativa (\d+) rodada$` | lerMarcas |
| `carimbo` | `^Conducao: (T\d{1,3}) tentativa (\d+) carimbo$` | lerMarcas |
| `recusada` | `^Conducao: (T\d{1,3}) publicacao recusada$` | lerMarcas |
| `marcador` | `^Conducao: abrir (T\d{1,3}) tentativa (\d+) nonce (\S+)$` | lerMarcas |
| `encerrada` | `^Conducao: (F\d{1,2}\|ciclo) sessao encerrada$` | lerMarcas |
| `passagem` | `^Conducao: (F\d{1,2}) em passagem$` | lerMarcas |
| `confirmada` | `^Conducao: (F\d{1,2}) passagem confirmada$` | lerMarcas |
| `desistida` | `^Conducao: (F\d{1,2}) passagem desistida$` | lerMarcas |
| `niveis` | `^Conducao: ciclo niveis ([23])$` | lerMarcas |
| `aposentada` | `^Conducao: (T\d{1,3}) aposentada ([a-z0-9][a-z0-9-]{0,63})$` | lerMarcas |

A marca `encerrada` só conta com o trailer `Conducao-Encerrada` igual à fase do subject. As três de passagem (VEGA-37 T15) só contam com o trailer `Conducao-Passagem` igual à fase do subject; a última das três ser `passagem` é o estado "em passagem", em que `abrir` e `registrar-conferencia --publicacao feita` recusam.

A marca `niveis` (hotfix vega-conducao-niveis) só conta com o trailer `Conducao-Niveis` igual ao número do subject; a última vence. Sem ela, ciclo já autorizado roda em 2 níveis (legado) e ciclo sem autorização pergunta (`conducao.mjs niveis`).

## Trailers lidos

| trailer | lido por | efeito |
| --- | --- | --- |
| `Conducao-Plano` | lerMarcas, ultimaAutorizacao | blob do canonico congelado na autorização |
| `Conducao-Herdada` | lerMarcas | autorização herdada: aponta a marca com o sim do operador |
| `Conducao-Ciclo` | lerMarcas | `sim` ⇒ a autorização é o sim do ciclo (`autorizar-ciclo`) |
| `Conducao-Pergunta` | consentimento.mjs (`perguntaCitadaDaMarca`) | na marca autorizada: a pergunta registrada do sim; na de consentimento: o `pergunta_id` dela, com `Conducao-Pergunta-Citada` no caso herdado (VEGA-19 T16) |
| `Conducao-Origem` | lerMarcas | origem da herança (`ciclo`, `replano` ou `sozinho`, o re-plano que seguiu sem perguntar), legível igual na marca gravada no modelo antigo de três papéis |
| `coberta-por-reinicio` | lerMarcas | `sim` ⇒ a falha caiu no reinício da ponte e não conta no teto |
| `Conducao-Falha-Ambiente` | lerMarcas | `sim` ⇒ falha de ambiente: não conta no teto de falhas, conta no próprio |
| `Conducao-Falha-Pergunta` | lerMarcas | `sim` ⇒ tentativa encerrada por pergunta da filha respondida com re-plano: não conta em teto nenhum |
| `Conducao-Rodada` | lerMarcas | o não do operador gravado na marca `rodada` (`nao`, ou `needs-rework` no caso `(live-ux-gate)`) |
| `Conducao-Encerrada` | lerMarcas | precisa igualar a fase do subject para a marca `encerrada` valer |
| `Conducao-Passagem` | lerMarcas | precisa igualar a fase do subject para as marcas `passagem`, `confirmada` e `desistida` valerem |
| `Conducao-Nota` | lerMarcas | caminho da nota de passagem gravada com a marca `passagem` |
| `Conducao-Epoca` | lerMarcas | a época da posse lida pela cerca no `passar`; na `confirmada`, a época nova da herdeira |
| `Conducao-Lock` | lerMarcas | o `lock_id` da posse no `passar`, que a herdeira usa no `passar-posse` |
| `Conducao-Ponta` | lerMarcas | o HEAD do ramo no momento da passagem |
| `Conducao-Desistida` | lerMarcas | o sha da marca `passagem` desistida |
| `Conducao-Ramo` | lerMarcas | o ramo da marca `passagem`, que a anterior desanexa e a herdeira traz (T16) |
| `Conducao-Confirma` | lerMarcas | o sha da marca `passagem` que a marca `confirmada` fecha (T16) |
| `Conducao-Arvore-Suja` | lerMarcas | na marca `confirmada`: a árvore da anterior estava suja e não se desmonta (T16) |
| `Conducao-Depois` | lerMarcas | na marca `encerrada`: `passar` pede a passagem na fronteira; sem ele, a marca antiga segue lida como antes (T16) |
| `Conducao-Nonce` | lerMarcas | nonce da ação `encerrar-sessao` que gravou a marca `encerrada`; na `aposentada`, o da ação `aposentada` |
| `Conducao-Aposentada` | lerMarcas | precisa igualar o motivo do subject para a marca `aposentada` valer (VEGA-20 T19) |
| `Conducao-Resposta` | lerMarcas | a resposta constante que a marca `aposentada` aplicou |
| `Conducao-Iguais` | lerMarcas | o `n` da calibração na marca `aposentada`: a linha `seguiu sozinha: <motivo> (<n> iguais)` do relato |
| `Conducao-Tentativa` | lerMarcas | a tentativa da task na marca `aposentada`: a mesma parada de volta para |
| `Conducao-Niveis` | lerMarcas | precisa igualar o número do subject para a marca `niveis` valer |

`lerMarcas` guarda também o bloco inteiro de trailers em `conferida`, `falhou`, `revertida`, `rodada` e `carimbo`, para o `auditar` ler (`Conducao-Task`, `Conducao-Verificacao`, `Conducao-Publicacao`, `Conducao-Executor`, e `Conducao-Publicacao-Dispensada: operador` — a dispensa de publicação de task `nao-se-aplica` que o plano liga a publicação, T16; commit antigo sem ele vale pela frase que o adaptador lista em `publicacao.frasesLegadas`); a `conferida` leva também `Conducao-Fora-Dos-Outputs` e `Conducao-Canonico-Alterado`, copiados do registro `trazida`, de onde o `retomar` devolve o relato em `conferidas` e o ilegível em `avisosDoRelato` (D-VEGA20-26); a tabela lista só o que `lerMarcas` e `ultimaAutorizacao` consultam por nome.
