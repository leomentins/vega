
# Contrato de condução

> **O que é.** O contrato do laço da condução em qualquer projeto: quem faz o quê, o que pede o "sim" do operador, onde uma sessão termina e quais botões o regulam. O procedimento de quem conduz é a skill `skills/conducao/SKILL.md`; o da operária, `references/brief-operaria.md`; o plano que o laço aceita, `references/conduzivel.md`.
>
> **Onde mora cada coisa.** O valor de cada botão mora num lugar só, `scripts/conducao/botoes.mjs`, e este texto o cita, nunca o redefine. O que é de um projeto — operador, caminhos sensíveis, verbos de publicação, conferências declaradas — vem da declaração (`conducao` em `.vega/declaracao.json`) e do código dele, e a página do projeto o explica (o campo `pagina` da declaração). As medições que deram estes valores ficam com o projeto de origem; aqui mora só a regra viva.

## Papéis

- **Condutora** — uma viva por ciclo e uma por fase (shaping, planejamento, cada fase de execução, fechamento), criada pelo operador ou, na passagem, pela condutora anterior. Aperta o botão, e quem decide é o script: chama `conducao.mjs proximo`, executa exatamente a ação emitida, citando o nonce, e registra o que observou. Abre, avisa e arquiva as operárias, faz as tasks de estação `condutora`, traz trabalho para o ramo do ciclo e publica; empurra o ramo, se inscreve na proposta e lê o CI, só da árvore dona da posse. Leva a pergunta ao operador na própria sessão. Na fronteira, grava a nota de passagem e cria a herdeira. Nunca roda git em árvore de operária. "Maestra", o nível que ficava acima dela, é termo aposentado.
- **Operária** (a filha) — uma sessão por tentativa de task, nascida no ambiente de quem a cria: mesmo usuário, mesmas capacidades e guards. Faz a task, roda a Verificação, carimba o parecer e empurra só para a referência de tentativa. O aviso é a primeira linha da resposta final, repetida por mensagem e pela referência de aviso. Não publica, não empurra o ramo do ciclo, não se arquiva e não usa `--no-verify`.
- **Operador** — o papel que a declaração do adaptador nomeia em `operadores`. Dá o "sim", e só num turno dele. Texto que chega por `send_message` nunca autoriza: a decisão vale no turno dele na sessão da condutora, citada verbatim no verbo. O que ele já decidiu não volta como pergunta: os casos consentidos moram em `consentimento.mjs`, publicação nunca entre eles. Faz à mão a task `workstation`, a menos que entregue o passo a quem conduz.

## O que pede o "sim" do operador

1. **Ciclo e fase** — um "sim" na fase de partida, gravado pelo `autorizar-ciclo`, vale para as fases seguintes enquanto nenhuma task mudar de classe ou de sensibilidade em relação ao plano congelado nele. Re-plano que muda isso pede o "sim" de novo, sob o plano novo (`plano-mudou`); fase fechada e não encerrada que ganha task nova também (`reaberta`).
2. **Task sensível** — task cujo texto cita um verbo de publicação do adaptador, ou cujos `**Outputs:**` caem nos caminhos sensíveis dele, sai coberta pelo sim da fase; pergunta por nonce (`task-sensivel`) só quando a fase foi herdada ou outra autorização veio depois.
3. **Trazer com alcance** — trabalho de filha que toca `baseAlcance` ou caminho sensível fora dos Outputs da task, ou `superficiesDeInstrucao` e o canonico do ciclo mesmo dentro deles, pede o "sim" antes de trazer.
4. **Conferência que só menciona publicação** — o `registrar-conferencia` recusa com `publicacao-pendente`, e o "sim" libera `nao-se-aplica`.
5. **Conferência do operador** — task que a declara pede o sim ou o não dele ao resultado, por pergunta ou pelo arquivo que o caso declara; o não abre a rodada seguinte, sem contar falha.
6. **Publicação** — o "sim" por task, sempre, e o gate do projeto pergunta em todo verbo de publicação, mesmo com ele. O squash do ciclo é perguntado no fechamento do ciclo, nunca por quem conduz.

## Fronteira de sessão por fase

Uma fase por condutora. A sessão que fecha a fase com CI verde no HEAD grava a marca `Conducao-Encerrada` pelo `encerrar-sessao` e passa o comando: `passar` grava a nota de passagem, e a ordem da troca cria a herdeira, que toma a posse (a época sobe na mesma escrita) e confirma a passagem; a anterior se arquiva. A régua de janela pode mandar passar no meio da fase, sempre em fronteira limpa. Fechada a última fase, o `fechar-ciclo` grava `Conducao-Encerrada: ciclo` e a condutora cria a de `fechamento`, sessão limpa, com o texto do fechamento do projeto. Re-plano no meio da fase passa pelo `proximo`. O que separa as sessões é a marca no ramo e a época da posse, nunca o id da sessão.

## Botões

Todos são campos do único export de `botoes.mjs`, `BOTOES` (objeto congelado). Cada linha diz o que o botão regula e o que o faz mudar.

| Botão (`BOTOES.<nome>`) | Regula | Muda quando |
| --- | --- | --- |
| `tetoFilhasPadrao` | filhas vivas ao mesmo tempo | a capacidade da ponte baixar do teto mais a condutora e as sessões do operador |
| `larguraPadrao` | tasks abertas em paralelo sem declaração do plano | nunca por default; sobe só por declaração do plano |
| `tetoFalhasAmbiente` | falhas de ambiente da mesma task antes de perguntar | o conserto de ambiente passar a demorar mais de uma tentativa |
| `silencioFilhaCaidaMin` | espera depois do `cutucar` antes de reabrir como falha de ambiente | filha caída voltar depois do prazo |
| `prazoPadraoMin` | prazo de uma tentativa antes de `prazo-vencido` | o turno medido de filha ficar longe dele; o prazo é o que acusa filha travada sem `BLOCKED` lido |
| `prazoRunCiMin` | espera pelo nascimento do run de CI | proposta saudável passar dele |
| `superficiesDeInstrucao` | arquivos que instruem quem conduz (settings, skills, rules, agents, workflows) | instrução nova fora da lista |
| `baseAlcance` | hooks, scripts, estado e configs que perguntam fora dos Outputs | hook novo fora da lista; o derivador confere a lista contra os hooks |

Os caminhos sensíveis, as telas dos Steps, os verbos de publicação, as variáveis de produção que a Verificação tira do ambiente e a limpeza das pastas de filha não são botões: são do adaptador de cada projeto.
