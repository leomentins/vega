
# Contrato de condução

> **O que é.** O contrato do laço da condução em qualquer projeto: quem faz o quê, o que pede o "sim" do operador, onde uma sessão termina e quais botões o regulam. O procedimento de quem conduz é a skill `skills/conducao/SKILL.md`; o da operária, `references/brief-operaria.md`; o plano que o laço aceita, `references/conduzivel.md`.
>
> **Onde mora cada coisa.** O valor de cada botão mora num lugar só, `scripts/conducao/botoes.mjs`, e este texto o cita, nunca o redefine. O que é de um projeto — operador, caminhos sensíveis, verbos de publicação, conferências declaradas — vem da declaração (`conducao` em `.vega/declaracao.json`) e do código dele, e a página do projeto o explica (o campo `pagina` da declaração).

## Papéis

- **Condutora** — uma viva por ciclo e uma por fase (shaping, planejamento, cada fase de execução, fechamento), criada pelo operador ou, na passagem, pela condutora anterior. Aperta o botão, e quem decide é o script: chama `conducao.mjs proximo`, executa exatamente a ação emitida, citando o nonce, e registra o que observou. Abre, avisa e arquiva as operárias, faz as tasks de estação `condutora`, traz trabalho para o ramo do ciclo e publica; empurra o ramo, se inscreve na proposta (em 3 níveis, a maestra) e lê CI, só da árvore dona da posse. Leva a pergunta ao operador na própria sessão. Na fronteira, grava a nota de passagem e cria a herdeira. Nunca roda git em árvore de operária.
- **Operária** (a filha) — uma sessão por tentativa de task, nascida no ambiente de quem a cria: mesmo usuário, mesmas capacidades e guards. Faz a task, roda a Verificação, carimba o parecer e empurra só para a referência de tentativa. O aviso é a primeira linha da resposta final, repetida por mensagem e pela referência de aviso. Não publica, não empurra o ramo do ciclo, não se arquiva e não usa `--no-verify`.
- **Operador** — o papel que a declaração do adaptador nomeia em `operadores`. Dá o "sim" numa pergunta registrada, de origem `digitado`, `digitado-no-hub-conferido` ou `repasse-hub` (§A resposta que chega por outra sessão); `agente` nunca autoriza. O que ele já decidiu não volta como pergunta: os casos consentidos moram em `consentimento.mjs`, publicação nunca entre eles. Faz à mão a task `workstation`, a menos que entregue o passo a quem conduz.

## O que pede o "sim" do operador

1. **Ciclo e fase** — um "sim" na fase de partida, gravado pelo `autorizar-ciclo --pergunta`, vale para as fases seguintes e para o re-plano commitado depois dele (§Re-plano dentro da fase); fora disso, o re-plano pergunta (`plano-mudou`, `reaberta`). O que cita em `Replano-Pergunta` a resposta que o pediu vale como o sim. Herança só com origem humana nessa pergunta, aberta com `ponteiro` `autorizar-ciclo:F<n>` (ou a parada citada), um item, `--sim` = texto da opção escolhida, uso único.
2. **Task sensível** — publica ou toca caminho sensível do adaptador: o sim do ciclo a cobre em toda fase e tentativa. Fora do sim da própria fase, pergunta de novo (`task-sensivel`, uma vez por fase, com as pendentes pelo nome) só a de dado de paciente ou caminho clínico, ou a que publica alterando o existente — só a anotação `**Publicação:**` aditiva a dispensa.
3. **Trazer com alcance** — o trazer não pergunta por arquivo da faixa, dentro ou fora dos Outputs; cada arquivo de fora vira linha do relato e fica no registro `trazida`, com o canonico à parte. Pede o "sim" só o caminho clínico fora dos Outputs, o que define a parada de publicação, mesmo declarado (`define-a-parada`), e a integridade da faixa e da ponta.
4. **Conferência que só menciona publicação** — o `registrar-conferencia` recusa com `publicacao-pendente`, e o "sim" libera `nao-se-aplica`.
5. **Conferência do operador** — task que a declara pede o sim ou o não dele ao resultado, por pergunta ou pelo arquivo que o caso declara; o não abre a rodada seguinte, sem contar falha.
6. **Publicação** — o "sim" por task, sempre, e o gate do projeto pergunta em todo verbo de publicação, mesmo com ele. O squash do ciclo é perguntado no fechamento do ciclo, nunca por quem conduz.

## Parada aposentada

Parada calibrada (`calibracao.mjs`) segue sozinha: `aposentar --nonce`, a opção aplicada, uma linha no relato. Publicação, paciente e caminho clínico nunca. Volta a parar no primeiro desfazer (corpo `This reverts commit <sha>` da marca, ou o não na conferência do que ela trouxe) ou a pedido do operador na conversa: `voltar-a-perguntar --motivo <m> --recibo "<sessao> <evento>"`.

## Padrão da fábrica

O trazer grava cada caso abaixo com o texto da linha, byte a byte. A linha `**Consentimentos:**` do canonico só restringe: `` `<caso>` → pergunta `` devolve o caso; `` `<caso>` → D-… `` grava aquela decisão. Seção ausente ou repetida: os casos perguntam.

**Padrão da fábrica:** Em todo ciclo, o trazer não pergunta ao operador por `tela-dos-steps` nem por arquivo da faixa que não seja caminho clínico fora dos Outputs ou o que define a parada de publicação.

Caminho que uma decisão do canonico cita junto com a task, na mesma oração e sem negação, segue sem pergunta (`decisao-registrada-da-task`), gravando o corpo dela.

## Re-plano dentro da fase

**Re-plano pré-autorizado:** sob o sim do ciclo, todo re-plano commitado reautoriza a fase sozinho (`herdar-autorizacao`, origem `preautorizado`; caso `replano`) e avisa (`replano:<sha8>`). Perguntam: publicação, sim próprio, conferência, vigia, `` `replano` → pergunta ``, merge de fora, fase reaberta sem fechamento novo.

**Re-plano sozinho:** O re-plano da fase em curso, ou da fase reaberta, segue sem perguntar ao operador quando todo commit dele traz `Replano-Motivo: <tipo>:<chave>` (`tipo` ∈ `ci` · `revisao` · `operaria` · `escopo`), nenhuma task some, muda de fase ou troca Outputs, Verificação ou estação, nenhuma fase nasce, nascem no máximo duas tasks além do fechamento, nada toca caminho clínico, dado de paciente, publicação que altera o existente nem a proposta do ciclo (task nova de estação `condutora` ou `workstation`, ou Steps que mesclam, fecham ou reabrem a proposta), nada está trazido sem conferência, e a chave não apareceu em re-plano anterior do ciclo.

A herança (`herdar-autorizacao`, origem `sozinho`) grava o caso `replano-sozinho` como decisão de Vega por delegação do operador, e o aviso vai a ele com o motivo e `replano:<sha8>`. `` `replano-sozinho` → pergunta `` na linha `**Consentimentos:**` devolve o caso à pergunta. Chave repetida pergunta `replano-repetido`, com a opção de consertar o molde. Sem o trailer, ou fora da regra, vale §O que pede o "sim".

## A resposta que chega por outra sessão

Quem responde é sempre o operador; a sessão que transporta a resposta só a repassa, e a autoria fica com quem transporta. Quem sobe a origem é o gancho da coleta, nunca quem conduz: o comando `responder` grava `agente`, e a linha `autoria` diz o resto, com a prova.

- **Quem repassa** a resposta que o operador deu na sessão dele manda, numa mensagem só: o `pergunta_id` da pergunta (sem ele o repasse não grava), a linha `Decisão <item>: <letra|sim> · <operador|própria>` por item e a linha `Recibo: <sessão onde o operador digitou> <evento da mensagem dele>`, que aponta a mensagem do operador nessa sessão.
- **Quem recebe** um repasse com `Recibo:` chama `get_event` com essa sessão e esse evento, no mesmo turno, antes de seguir. Conferido (mensagem do operador, sem `isSynthetic`, com o número e a letra do item, depois da abertura), a resposta grava como `digitado-no-hub-conferido`; repasse sem recibo, sem a chamada ou que não confere grava como `repasse-hub`, com o motivo, se vier da sessão do recibo ou de sessão de hub declarada; de outra sessão grava como `agente`, que não é resposta do operador.
- A mensagem que o operador digita na própria sessão de quem pergunta grava como `digitado`. O que cada origem autoriza não muda aqui: vale §Papéis.

## Fronteira de sessão por fase

Uma fase por condutora. A sessão que fecha a fase com CI verde no HEAD grava a marca `Conducao-Encerrada` pelo `encerrar-sessao` e passa o comando: `passar` grava a nota de passagem, e a ordem da troca cria a herdeira, que toma a posse (a época sobe na mesma escrita) confirma a passagem e arquiva a anterior. A régua de janela pode mandar passar no meio da fase, sempre em fronteira limpa. Fechada a última fase, o `fechar-ciclo` grava `Conducao-Encerrada: ciclo` e a condutora cria a de `fechamento`, sessão limpa, com o texto do fechamento do projeto. O que separa as sessões é a marca no ramo e a época da posse, nunca o id da sessão.

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
