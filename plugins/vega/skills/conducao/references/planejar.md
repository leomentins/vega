# Planejar — o mínimo para chegar a um plano conduzível

> Dois passos, em qualquer projeto: desenhar com quem decide (brainstorm) e escrever o plano no formato que a condução lê (`conduzivel.md`). É o piso: o projeto que tem processo próprio de desenho e plano segue o dele, desde que o plano final passe no contrato de `conduzivel.md`.

## 1. Brainstorm — desenhar antes de planejar

Objetivo: sair com um design aprovado por quem decide, uma decisão por vez.

1. **Entender o pedido.** Ler o que já existe (código, notas, o pedido escrito) antes de perguntar. Dizer em duas linhas o que se entendeu e o que ainda é pergunta.
2. **Uma pergunta por vez.** Cada pergunta traz as opções concretas e uma recomendação com o motivo em meia linha. Não empilhar perguntas: a resposta de uma muda a seguinte.
3. **Fronteira escrita.** O que entra, o que fica de fora, e o que é critério de pronto observável ("QUANDO … ENTÃO … DEVE …").
4. **Riscos cedo.** Para cada premissa que, se falsa, derruba o design: como medir, e quanto custa medir. Premissa barata de medir vira tarefa de sonda no plano (§2, passo 3).
5. **Design aprovado.** Resumir o design em poucas linhas e pedir o sim explícito. Sem sim, não há plano.

## 2. Escrever o plano conduzível

Objetivo: um arquivo por ciclo que o adaptador declarado lê sem adivinhar nada.

1. **Fases.** Agrupar as tarefas em fases que entregam algo conferível. Cada fase termina numa tarefa com a marca `fechamento-de-fase`.
2. **Tarefas pequenas e conferíveis.** Cada tarefa tem um resultado que um comando prova: a `Verificação` é esse comando, e ele precisa falhar antes da tarefa e passar depois. Tarefa sem comando que prove não é tarefa conduzível — é conversa.
3. **Procurar ativamente tarefas independentes.** Sempre há candidatas, mesmo pequenas; a disciplina de uma tarefa por sessão empurra o plano para a fila única, e é preciso resistir a isso de propósito. Para cada tarefa, perguntar: ela **lê** algo que outra escreve? Se não, é independente (`Independente: sim`). Procurar em especial:
   - **sondas e medições** que reduzem risco — confirmar uma premissa, medir um tempo, provar que uma ferramenta faz o que o design supõe. Elas quase nunca leem o trabalho das outras tarefas e valem mais quanto mais cedo rodam: põe-se no começo, independentes;
   - **documentação e testes** de algo já existente;
   - **peças em lugares diferentes** que só se encontram numa tarefa de integração depois.
   Dependência de ordem ("vem depois no texto") não é dependência: declarar só a de dado (`conduzivel.md` §Dependência de dado e dependência de ordem).
4. **Anotar cada tarefa.** `Estação`, `Publicação`, `Sensível`, `Verificação` e o subject do commit, explícitos — nunca deixar para o núcleo deduzir do texto (`conduzivel.md` §Anotações obrigatórias).
5. **Outputs pelo arquivo.** Listar cada arquivo que a tarefa cria ou muda, com o caminho onde ele mora; peça que a tarefa pode precisar tocar entra como `Modificar` (`conduzivel.md` §Outputs).
6. **Consentimentos, só para restringir.** A linha `**Consentimentos:**` do §1.5 é opcional: sem ela, os três casos do trazer (`instrucao-declarada-em-outputs`, `teste-que-acompanha-o-codigo`, `tela-dos-steps`) seguem sem pergunta pelo padrão da fábrica (`contrato.md` §Padrão da fábrica). Escrevê-la só para devolver um caso à pergunta (`` `<caso>` → pergunta ``) ou para gravar outra decisão do ciclo no lugar do padrão (`` `<caso>` → D-… ``).
7. **Conferir antes de entregar.** Ler o plano com o adaptador declarado: tarefa sem anotação obrigatória, fase sem fechamento, ou heading fora do formato voltam como pergunta — consertar no plano, não no núcleo.

## 3. De sessão a sessão

Cada fase tem a sua condutora, chamada pelo nome da fase, e quem cria todas é a maestra do ciclo (sempre 3 níveis; D10c e D5b do L4): com o design aprovado, a maestra cria o ramo de planejamento e a condutora de planejamento; com o planejamento mesclado, o ramo de execução e a condutora da F0. Antes de criar, tudo no git, nenhuma decisão aberta.

**A condutora de planejamento conduz o planejamento inteiro.** O pedido de conduzir um ciclo que ainda não tem plano conduzível **é** a fase de planejamento, não falha de pré-voo: a condutora não para por falta de plano e não pergunta ao operador se roda a etapa seguinte, nem onde. O laço:

0. **Ramo e árvore, antes da primeira etapa** — a maestra (3 níveis) cria o ramo de planejamento sem checkout, com a proposta em rascunho e a inscrição (`conducao.mjs criar-ramo --tipo plano`; D11b do L4), e a condutora de planejamento o adota na árvore dela, com a posse, pelos passos do texto que a maestra lhe deu (D16a). As etapas trabalham nessa árvore, commitam e não empurram; só a etapa declarada `empurra` (na Sistoli, o `/plan-review`) empurra, a cada rodada (D6b, D15a); a proposta já existe e ela só a cria se faltar. Assim nenhuma sessão de etapa guarda o ramo, e todas se arquivam ao terminar. A inscrição é da maestra, quem quer que empurre.
1. **Onde o planejamento está** — pelos arquivos do ciclo no ramo principal e no ramo do ciclo: a primeira etapa sem saída aprovada é a próxima (as etapas e as saídas de cada uma estão na página do projeto).
2. **Uma sessão por etapa** — o pedido sai do verbo `conducao.mjs etapa <id> --ciclo <id> [--rodada <n>]`, que acha a árvore do ciclo pelo ramo aberto (ou `--arvore <path>`) e a põe no pedido (as etapas são as que o código do adaptador declara em `etapasDoPlanejamento`); `create_session` sem `environment_id`, com `prompt` = o `pedido`, `model` = o `modelo` e `title` = o `nome` da saída. Nunca montar o pedido à mão: o `create_session` recusa pedido que abre com `/`, e o verbo devolve o pedido curto em palavras ("Rode o /<etapa> do <ciclo>.") com o contrato de retorno embaixo — a primeira linha da mensagem a `@parent` é `<ETAPA> <saída> <sha8>`; em gate humano, a etapa abre a pergunta pelo `comando.mjs abrir --ciclo <id> --origem planejamento` (no ramo `ciclo-<id>-plano` os dois saem do ramo), manda `PERGUNTA <p-…>` com o bloco verbatim e para. A etapa que só roda como comando digitado não se chama nem se imita na condutora: ela nasce na sessão dela.
3. **Esperar e seguir** — despertador de reserva (§2.1 da skill); com o aviso, ler a saída e criar a etapa seguinte **sem perguntar**. Quem conduz arquiva a sessão da etapa (`archive_session`) no turno em que lê a entrega dela: a etapa não guarda o ramo (o ramo vive na árvore de quem conduz), e a que empurra já empurrou. Rodada de revisão que reprova cria a rodada seguinte, até o teto do projeto.
4. **Pergunta sobe pela condutora** — o `PERGUNTA <p-…>` da etapa vai à maestra (3 níveis), que mostra ao operador o bloco que a etapa abriu, verbatim e com a marca, sem reabrir a pergunta (a abertura é da etapa); a `RESPOSTA` da maestra, com o `Recibo:` do turno do operador, volta à etapa por `send_message`, como em `maestra.md` §A pergunta.
5. **Plano conduzível** — com o `/plan-review` em exit `executable` e o CI verde no sha empurrado, `MESCLAR <N> <sha>` à maestra (3 níveis) e parar. A maestra pergunta ao operador, mescla por squash, apaga o ramo, arquiva esta sessão e cria o ramo de execução e a condutora da F0 (`maestra.md` §Mesclagem); o sim do operador à execução é o `autorizar-ciclo F0` que a F0 pede.
