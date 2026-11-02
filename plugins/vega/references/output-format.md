# Formato de saída para o operador

> **O que é.** O contrato de como toda saída que para diante do operador sobe: bloco de decisão,
> relatório e aviso, de qualquer skill, agent ou sessão. As regras vivem só aqui, com exemplos
> neutros. O projeto que usa a fábrica põe ao lado, em arquivo próprio, os exemplos do domínio
> dele, os papéis que respondem por cada eixo e onde os registros moram; esse arquivo aponta para
> cá e não repete regra.

O par deste contrato é o critério de **o que** sobe ao operador (julgamento contra trabalho
mecânico); este decide **como** sobe. Decisão de julgamento sobe mastigada: o técnico fica a uma
pergunta de distância, e simplificar corta ruído, nunca corta opção.

## Regra — formato obrigatório

```
**Decisão de operador — <assunto — do que o bloco trata, em poucas palavras>**
(plural com mais de um item: **Decisões de operador — …**; outro papel: **Decisão de <outro papel> — …**)

k. <título em linguagem de comportamento/UX — nunca de schema, coluna, função ou diff>
   <1-2 linhas do que está em jogo, em consequência observável>
   - (a) <opção em 1 linha>
   - (b) <opção em 1 linha>
   → Recomendo (a) — <motivo em meia linha>
   _Decide:_ <papel — só quando ESTE item foge do papel do cabeçalho>

k+1. ...

Diz k-…-<último k do bloco> e eu toco.   (um item só: "Diz k e eu toco.")
<opcional, no máximo 1 linha: "Se nenhuma serve, me diz.">
<!-- decisao k = <ciclo>/<fase>/<task>/<código> · origem <papel> -->   (posições fixas, `-` no vazio; regra 5)
<!-- decisao k+1 = … -->
```

O cercado acima é só a moldura do molde: o bloco sai como **markdown corrido na conversa, nunca
dentro de bloco de código** — em bloco de código ele vira cartão copiável e o negrito, a lista e
o fecho somem.

`k` segue a regra 5: é o próximo inteiro da sessão — `1` no primeiro bloco, `3` no segundo se o
primeiro teve 2 decisões —, sem prefixo de ciclo, fase ou task. `k+1` é o inteiro seguinte. Esse
número mora **só no item, no fecho e na chave escondida** — nunca no cabeçalho (regra 7).

1. **Título e corpo em comportamento, não em implementação.** "Segredo do servidor transita pela
   sua máquina sem controle" — não "senha do banco e chave de serviço em variável de ambiente sem
   nome". Traduzir é trabalho do agente, não pedágio do operador.
2. **Recomendação sempre presente**, com o motivo em meia linha. Menu sem recomendação devolve o
   trabalho de decidir *e* de avaliar.
3. **Técnico a uma pergunta de distância.** Nunca no corpo do bloco; expandir só quando o operador
   pedir ("por quê a 2?").
4. **Fecho acionável** — a resposta esperada é uma sequência curta (`1-b / 2-a`), não prosa.
   Resposta com ou sem hífen entre número e letra vale o mesmo (`1-b` = `1b`).
5. **Ordem = gravidade; numeração corrida da sessão, com a chave tipada escondida.** Decisão que
   trava produção, segurança, dado pessoal ou obrigação legal vem **primeiro dentro do bloco**, e
   o título carrega o peso em linguagem de consequência ("isso trava a entrega da semana", não
   "SEV-HIGH"). Quando a origem agrupa por domínio (um revisor que agrupa os achados em produto ·
   segurança · UI-UX), o **domínio vira tag inline no título** e a numeração segue corrida — nunca
   reinicia por domínio, nunca vira sub-lista aninhada.
   **Visível: um inteiro corrido por sessão, sem prefixo, em todo tipo de sessão** — maestra,
   condutora, filha de task, hotfix, shaping, planejamento, sessão avulsa. Cada decisão continua a
   numeração da sessão, não a do bloco: o segundo bloco abre no inteiro seguinte ao último do
   primeiro (bloco 1 com 2 decisões ⇒ bloco 2 abre em 3), e o fecho cita esses números
   (`Diz 3-4 e eu toco.`). Assim "a 3" nunca é ambíguo numa sessão. Limpar a sessão zera: a sessão
   seguinte abre em `1`. **Compactação não zera:** depois dela o agente recupera o último número da
   própria sessão — pelo registro de decisões que o projeto declara, que grava sessão e item, ou
   pelo próprio histórico — e continua dele, nunca reabre em `1` por cima de decisão já levantada.
   **Escondida: a chave tipada, num comentário HTML no fim do bloco**, uma linha por item:
   `<!-- decisao <k> = <ciclo>/<fase>/<task>/<código> · origem <papel> -->`. As quatro posições são
   fixas, e a que não existe leva `-`:
   - `<ciclo>` — id do ciclo (`ABC-12`); fora de ciclo, o slug do ramo sem a modalidade nem a data
     (`exportar-relatorio` de `hotfix/exportar-relatorio-20260115`); sessão avulsa sem ramo, `-`.
   - `<fase>` · `<task>` — `F4` · `T29`, ou `-` quando a sessão não está numa fase ou task.
   - `<código>` — o inteiro que a decisão tem **na sessão que a levantou**. Quando quem emite é
     quem levantou, é o próprio `<k>`; no repasse, é o número da filha (parágrafo seguinte).
   - `<papel>` — o tipo da sessão que levantou, de um vocabulário fechado: `maestra` · `condutora` ·
     `filha` · `neta` · `hotfix` · `docs` · `shaping` · `planejamento` · `fechamento` · `avulsa`.
     Papel novo entra aqui antes de ser usado.
   Exemplos: hotfix sem ciclo, `<!-- decisao 4 = exportar-relatorio/-/-/4 · origem hotfix -->`;
   brainstorm, `<!-- decisao 2 = ABC-13/-/-/2 · origem shaping -->`. O app não renderiza o
   comentário, então o operador lê só o inteiro; a coleta lê o texto cru e tem nele o tipo da
   decisão. Exemplo de bloco, terceira decisão de uma condutora que executa a T29 da F4 do ABC-12 —
   em citação, com o comentário em crase só para aparecer aqui; na conversa o bloco sai solto e o
   comentário cru, sem crase:

   > **Decisão de operador — teste de recuperação da condução**
   >
   > 3\. A recuperação depois de queda não tem como ser testada no servidor
   > O teste precisa derrubar a rede, e o servidor de CI não deixa. Se seguir sem ele: a recuperação embarca sem prova.
   > - (a) testar na estação, à mão, e registrar o resultado na fase
   > - (b) adiar o teste para a fase de portabilidade
   > → Recomendo (a) — a prova sai nesta fase, e custa uma sessão
   >
   > Diz 3 e eu toco.
   > `<!-- decisao 3 = ABC-12/F4/T29/3 · origem condutora -->`

   **Repasse de filha.** Decisão que uma sessão filha levanta sobe pela sessão mãe com o **próximo
   inteiro da sessão da mãe**; o código que a filha usou vai só na chave escondida. A maestra que
   já levantou 44 decisões e recebe a decisão 3 da condutora acima a repassa como `45`, fecha com
   `Diz 45 e eu toco.` e escreve `<!-- decisao 45 = ABC-12/F4/T29/3 · origem condutora -->`. A
   resposta do operador (`45-a`) volta à filha pela mãe, que a traduz para o código dela.
6. **O fato técnico bruto é persistido ANTES de simplificar.** A tradução é camada de
   apresentação, nunca o único registro: o achado cru (severidade, regra de acesso, coluna, função,
   saída de comando) vive no artefato da origem — o relatório do revisor, a revisão do esboço, a
   nota do ciclo, o registro de débito que o projeto declara. Bloco simplificado sem o cru
   persistido em lugar nenhum = perda silenciosa do fato, não economia de contexto.
7. **Cabeçalho `Decisão de <papel> — <assunto>`, sem número.** O cabeçalho em negrito diz **para
   quem** o bloco sobe e, depois do travessão, **do que** trata, em poucas palavras:
   `**Decisão de operador — prazo da entrega**`; com mais de um item, `**Decisões de operador — …**`
   (o singular ou o plural concorda com o número de itens); fora do operador, o papel que o
   projeto nomeia para o eixo, com a preposição que concorda com ele (`de operador`,
   `do responsável técnico`). Papel, nunca nome civil — eixos diferentes têm donos diferentes (a
   tabela de escalonamento do projeto diz qual), e um bloco sem destinatário chega a quem o leu
   primeiro, não a quem pode cravar. O papel do cabeçalho cobre todos os itens; o item que foge
   dele declara o seu numa linha `_Decide:_ <papel>` dentro do item. **Número no cabeçalho,
   nenhum** — nem contagem, nem a sequência da sessão: os números vivem só nos itens (regra 5), no
   fecho e na chave escondida. Com dois números disputando o cabeçalho (contagem do bloco ×
   sequência da sessão), bloco de UMA decisão sai como "2 decisões", "3 decisões" — o N tomado
   pelo número da decisão.
8. **Alternativa livre é sempre aceita e nunca listada.** O operador pode responder fora do menu
   em qualquer item, sem que isso precise ser oferecido. Por isso nenhum item ganha opção
   "(c) outra" ou "outro caminho": decisão de sim/não tem duas opções, não três. O convite é
   **opcional e no máximo uma linha de rodapé** depois do fecho, para o bloco inteiro — nunca
   dentro de um item.
9. **A primeira linha diz o tipo da saída.** Toda saída que para diante do operador abre com uma
   linha em negrito no molde do cabeçalho de decisão, e o leitor sabe o que é antes de ler o resto:
   - **`Decisão de <papel> — <assunto>`** (plural `Decisões` com mais de um item) — depende de quem
     o papel nomeia; regras 1-8.
   - **`Relatório — <o que rodou>: <resultado em comportamento>`** — o que aconteceu; nada depende
     dele, salvo decisões pendentes, que vão no fim, em bloco de decisão próprio.
   - **`Aviso — <o quê>`** — informação que muda o que ele faz em seguida, sem pergunta.
   Sem banner, linha separadora (`────`, `════`, `____`) nem caixa alta de título; instrução de
   como responder fica fora do bloco de opções. Achado que aparece num relatório ou numa decisão
   diz o **destino** dele, no vocabulário de destinos que o projeto declara, nunca balde próprio
   da skill.

**Exceção única — o julgamento de tela.** Quando o operador julga uma interface rodando, o gate
não pede veredito: para o operador dizer o que não funcionou e decidir o conserto de **cada**
problema, com três opções fixas — *conserta agora* · *vira dívida (porquê)* · *aceita como está*
—, e o veredito do gate sai calculado das respostas. Nesses itens a regra 2 (`→ Recomendo`)
**não se aplica**: recomendar o conserto seria julgar a tela no lugar dele. Todo o resto do
formato vale, e decisão adicional levantada junto (escopo, retrabalho parcial) volta a exigir a
recomendação. Um rótulo único ("embarca" · "refaz" · "embarca com dívida") obrigaria a resumir N
problemas numa escolha só.

## Invariante — simplificar corta ruído, nunca opção

O número de decisões que sobem é determinado pelo eixo julgamento-vs-mecânico, **antes** da
renderização. A simplificação atua só na prosa. Omitir uma decisão de julgamento para encurtar o
bloco é o **corte calado** — entrega menor que o pedido se declara no ato, com o quê e o porquê —,
não economia de contexto.

Falha simétrica, igualmente proibida: inflar o bloco com item mecânico "para o operador
escolher" — isso é devolver trabalho.

## Invariante — opção tem de ser opção

**Duas opções que produzem o MESMO comportamento observável são uma opção só, e oferecer as duas
é inflar o menu com trabalho falso.** É a terceira falha do eixo, ao lado de "cortar opção" e
"inflar com item mecânico", e a única que passa por diligência: o bloco fica mais completo, o
autor parece ter varrido o espaço, e o operador gasta a decisão escolhendo entre sinônimos.

**Caso neutro:** um item de permissão oferece `(b) todo o time` e `(c) o time, e o líder enxerga
os membros`. Se o líder já é membro do time pela definição vigente, (c) é (b) renomeada — e a
recomendação para (c), com o motivo "senão o líder não veria ninguém", contradiz a própria
definição que o plano cita.

**Por que não vira regex:** distinção é semântica. Duas opções colapsam quando a **definição
vigente de um termo** as iguala — e a definição mora no documento de doutrina do projeto, não no
bloco. Por isso o enforcement é uma passada de refutação com o material mínimo (bloco + decisões
cravadas + documentos de doutrina citados), não um matcher; um verificador mecânico pode fazer só
a metade determinística (existência, contagem, referência cruzada).

**A regra operacional, para qualquer emissor:** antes de o bloco subir, cada item responde *"sob
a definição citada de \<termo\>, estas N opções levam a comportamentos diferentes?"*. Opção que
não sobrevive à pergunta sai — e sair **não** é o corte calado do invariante acima: o corte
proibido é sumir com uma DECISÃO, este é sumir com um SINÔNIMO.

## Onde se aplica

Toda superfície que renderiza decisão ao operador — e, pela regra 9, toda saída que para diante
do operador, inclusive relatório e aviso. Emissores típicos: o revisor de plano que para no gate
humano, a revisão de esboço com residual de escopo, a validação contra o mercado com gate
residual, o julgamento de tela (§Exceção única), a parada por divergência entre código e
documento, e todo controller ou subagent que escala sem molde próprio. O projeto lista os
emissores dele e o papel de cada um no arquivo que aponta para cá.

O bloco pode ser precedido de contexto — o que **não** pode é o contexto substituir o formato, nem
o formato ser abandonado porque a sessão está longa ou a skill tem template próprio.

O papel é o que o emissor escreve no cabeçalho, ou em `_Decide:_` no item que foge dele
(regra 7). Emissor que não sabe declará-lo está emitindo para quem ler primeiro — e há eixos que
o operador não pode cravar.

## Anti-patterns

- ❌ Saída sem a linha de tipo, ou aberta por banner, separador ou título em caixa alta (regra 9).
- ❌ Pedir veredito único sobre a tela em vez do conserto de cada problema (§Exceção única).
- ❌ Colar o achado cru do revisor (severidade + correção técnica) como se fosse o bloco de decisão.
- ❌ Bloco dentro de bloco de código (cartão copiável) — inclusive o de divergência.
- ❌ Bloco sem `→ Recomendo` — salvo os itens de conserto do julgamento de tela (§Exceção única).
- ❌ Cabeçalho sem papel — decisão sem destinatário declarado (regra 7).
- ❌ Número no cabeçalho — contagem (`2 decisões`) ou sequência (`Decisão de operador: 5`); o
  número da decisão vive no item (regra 7). E plural com um item só, ou singular com vários.
- ❌ Opção "(c) outra" / "outro caminho" num item — a alternativa livre é sempre aceita e não se
  lista (regra 8).
- ❌ Segundo bloco da sessão, ou a sessão depois de compactada, reabrindo a numeração em 1
  (regra 5).
- ❌ Prefixo visível no número — task (`13.1`), fase (`F0.2`), ciclo ou código da filha na frente
  do inteiro; o tipo vai na chave escondida (regra 5).
- ❌ Repasse de filha com o número dela (`3`, `4.1`) em vez do próximo inteiro da sessão mãe, ou
  sem a chave escondida que guarda o número da filha (regra 5).
- ❌ Chave tipada visível — fora de comentário HTML, ou dentro de bloco de código onde o
  comentário vira texto (regra 5).
- ❌ Opção que é outra renomeada — mesmo comportamento observável, palavras diferentes
  (§Invariante — opção tem de ser opção).
- ❌ Enterrar uma decisão como nota de rodapé, "ponto de veto" ou parágrafo no meio de um plano.
- ❌ Espelhar de volta para o operador o registro denso que o harness guarda para si.
