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

Dk. <título em linguagem de comportamento/UX — nunca de schema, coluna, função ou diff>

<1-2 linhas do que está em jogo, em consequência observável>
- (a) <opção em 1 linha>
- (b) <opção em 1 linha>
→ Recomendo (a) — <motivo em meia linha>
_Decide:_ <papel — só quando ESTE item foge do papel do cabeçalho>

D<k+1>. <item cuja opção esconde custo — §Pró e contra: as opções vão em tabela>

<1-2 linhas do que está em jogo>

| Opção | Pró | Contra |
|---|---|---|
| (a) <opção em 1 linha> | <o que se ganha> | <o que se paga> |
| (b) <opção em 1 linha> | … | … |

→ Recomendo (b) — <motivo em meia linha>

Diz Dk-…-D<último k do bloco> e a letra, ou texto livre, para eu seguir.   (um item só: "Diz Dk e a letra, ou texto livre, para eu seguir.")
<!-- decisao Dk = <ciclo>/<fase>/<task>/<código> · origem <papel> -->   (posições fixas, `-` no vazio; regra 5)
<!-- decisao D<k+1> = … -->
```

O cercado acima é só a moldura do molde: o bloco sai como **markdown corrido na conversa, nunca
dentro de bloco de código** — em bloco de código ele vira cartão copiável e o negrito, a lista, a
tabela e o fecho somem. O título leva uma linha em branco depois, e a tabela uma antes e outra
depois: `D3.` não é lista numerada, e sem a linha em branco o markdown cola o título no contexto,
lê a tabela como texto do parágrafo de cima e engole o `→ Recomendo` como linha da tabela.

`Dk` segue a regra 5: a letra D e o inteiro, sem hífen — o do ciclo, reservado no contador, em
sessão de ciclo de projeto que o declara; fora disso, o próximo inteiro da sessão (`D1` no
primeiro bloco, `D3` no segundo se o primeiro teve 2 decisões) —, sem prefixo de ciclo, fase ou task.
`D<k+1>` é o inteiro seguinte. Esse número mora **só no item, no fecho e na chave escondida** —
nunca no cabeçalho (regra 7).

1. **Título e corpo em comportamento, não em implementação.** "Segredo do servidor transita pela
   sua máquina sem controle" — não "senha do banco e chave de serviço em variável de ambiente sem
   nome". Traduzir é trabalho do agente, não pedágio do operador.
2. **Recomendação sempre presente**, com o motivo em meia linha. Menu sem recomendação devolve o
   trabalho de decidir *e* de avaliar.
3. **Técnico a uma pergunta de distância.** Nunca no corpo do bloco; expandir só quando o operador
   pedir ("por quê a 2?").
4. **Fecho acionável** — `Diz D3 e a letra, ou texto livre, para eu seguir.` (vários itens:
   `Diz D3-D4 e a letra, ou texto livre, para eu seguir.`). A resposta esperada é uma sequência
   curta (`D1b / D2a`), e o texto livre vale como alternativa (regra 8). Com ou sem o D, com ou sem
   hífen entre número e letra, vale o mesmo (`D1-b` = `D1b` = `1b`). O fecho antigo
   (`Diz 3 e eu toco.`, até 16/11/2026) não se escreve mais, e a coleta segue lendo os blocos que
   o usaram.
5. **Ordem = gravidade; numeração do ciclo (ou da sessão, fora dele), com a chave tipada escondida.** Decisão que
   trava produção, segurança, dado pessoal ou obrigação legal vem **primeiro dentro do bloco**, e
   o título carrega o peso em linguagem de consequência ("isso trava a entrega da semana", não
   "SEV-HIGH"). Quando a origem agrupa por domínio (um revisor que agrupa os achados em produto ·
   segurança · UI-UX), o **domínio vira tag inline no título** e a numeração segue corrida — nunca
   reinicia por domínio, nunca vira sub-lista aninhada.
   **Visível: a letra D e um inteiro, sem hífen e sem outro prefixo** (`D3`). O D diz "decisão" a
   quem lê e a quem responde, e não muda a conta: o inteiro é o mesmo, e a resposta sem o D (`3a`)
   vale para o item `D3`. De onde o inteiro vem depende de a sessão trabalhar num ciclo:
   - **Sessão de ciclo** (planejamento, condução em qualquer nível, fechamento), **em projeto que
     declara contador por ciclo:** o número é do ciclo, reservado no contador **antes de escrever
     o bloco**, um por item (a página do projeto nomeia o verbo). Só sobe, do planejamento ao
     fechamento, e duas sessões do mesmo ciclo ao mesmo tempo nunca recebem o mesmo número. Buraco
     é aceito: número reservado de bloco que ninguém respondeu fica queimado, e o seguinte não o
     reaproveita. Limpar ou compactar a sessão não muda nada, porque o número mora no contador.
     Contador fora do ar ou ausente ⇒ o bloco **não** sai com número por sessão no lugar: o agente
     diz ao operador que o número do ciclo não saiu. Ciclo que numerava por sessão antes de o
     contador existir recomeça acima do que já usou (a página do projeto diz de quanto).
   - **Fora de ciclo** (shaping, hotfix, docs, sessão avulsa) **ou projeto sem contador por ciclo**
     (registro de decisões em arquivo no git, por exemplo): o inteiro corrido da sessão. Cada
     decisão continua a numeração da sessão, não a do bloco: o segundo bloco abre no inteiro
     seguinte ao último do primeiro (bloco 1 com 2 decisões ⇒ bloco 2 abre em 3). Limpar a sessão
     zera: a sessão seguinte abre em `1`. **Compactação não zera:** depois dela o agente recupera o
     último número da própria sessão — pelo registro de decisões que o projeto declara, que grava
     sessão e item, ou pelo próprio histórico — e continua dele, nunca reabre em `1` por cima de
     decisão já levantada.
   Nos dois casos o fecho cita os números (`Diz D3-D4 e a letra, ou texto livre, para eu
   seguir.`), e "a D3" nunca é ambíguo — no ciclo inteiro, ou na sessão.
   **Escondida: a chave tipada, num comentário HTML no fim do bloco**, uma linha por item:
   `<!-- decisao D<k> = <ciclo>/<fase>/<task>/<código> · origem <papel> -->`. As quatro posições são
   fixas, e a que não existe leva `-`:
   - `<ciclo>` — id do ciclo (`ABC-12`); fora de ciclo, o slug do ramo sem a modalidade nem a data
     (`exportar-relatorio` de `hotfix/exportar-relatorio-20260115`); sessão avulsa sem ramo, `-`.
   - `<fase>` · `<task>` — `F4` · `T29`, ou `-` quando a sessão não está numa fase ou task.
   - `<código>` — o inteiro que a decisão recebeu **de quem a levantou**. Quando quem emite é
     quem levantou, ou no ciclo com contador, é o próprio `<k>`; no repasse por sessão, é o número
     da filha (parágrafo seguinte).
   - `<papel>` — o tipo da sessão que levantou, de um vocabulário fechado: `maestra` · `condutora` ·
     `filha` · `neta` · `hotfix` · `docs` · `shaping` · `planejamento` · `fechamento` · `avulsa`.
     Papel novo entra aqui antes de ser usado.
   Exemplos: hotfix sem ciclo, `<!-- decisao D4 = exportar-relatorio/-/-/4 · origem hotfix -->`;
   brainstorm, `<!-- decisao D2 = ABC-13/-/-/2 · origem shaping -->`. O `<código>` é o inteiro,
   sem o D. O app não renderiza o
   comentário, então o operador lê só o número; a coleta lê o texto cru e tem nele o tipo da
   decisão. Exemplo de bloco, terceira decisão de uma condutora que executa a T29 da F4 do ABC-12 —
   em citação, com o comentário em crase só para aparecer aqui; na conversa o bloco sai solto e o
   comentário cru, sem crase:

   > **Decisão de operador — teste de recuperação da condução**
   >
   > D3. A recuperação depois de queda não tem como ser testada no servidor
   >
   > O teste precisa derrubar a rede, e o servidor de CI não deixa. Se seguir sem ele: a recuperação embarca sem prova.
   > - (a) testar na estação, à mão, e registrar o resultado na fase
   > - (b) adiar o teste para a fase de portabilidade
   > → Recomendo (a) — a prova sai nesta fase, e custa uma sessão
   >
   > Diz D3 e a letra, ou texto livre, para eu seguir.
   > `<!-- decisao D3 = ABC-12/F4/T29/3 · origem condutora -->`

   **Repasse de filha.** No ciclo com contador, o número da filha já é único no ciclo: a mãe repassa
   a decisão **com o mesmo número**, e `<k>` e `<código>` coincidem. Fora disso, a decisão que uma
   sessão filha levanta sobe pela sessão mãe com o **próximo inteiro da sessão da mãe**; o código
   que a filha usou vai só na chave escondida. A maestra que já levantou 44 decisões e recebe a
   decisão D3 da condutora acima a repassa como `D45`, fecha com `Diz D45 e a letra, ou texto
   livre, para eu seguir.` e escreve `<!-- decisao D45 = ABC-12/F4/T29/3 · origem condutora -->`.
   A resposta do operador (`D45a`, ou `45a`)
   volta à filha pela mãe, que a traduz para o código dela.
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
   "(c) outra" ou "outro caminho": decisão de sim/não tem duas opções, não três. O convite já vem
   no fecho ("ou texto livre", regra 4), para o bloco inteiro — nunca dentro de um item, e sem
   linha de rodapé a mais.
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

**Pró e contra — quando a opção esconde custo.** O padrão continua sendo a opção em 1 linha, em
lista. Pró e contra entram quando a opção troca um ganho por um custo que a própria linha não
mostra: o operador escolheria diferente se lesse o custo. Teste de quem escreve: *tirando o
contra, a escolha muda?* Não muda ⇒ não entra. Um item com pró e contra leva os dois em **todas**
as opções dele, para a comparação ficar de pé, e por isso as opções dele saem numa **tabela** de
colunas `Opção | Pró | Contra`, uma linha por opção, com a letra no começo da primeira célula
(`| (a) … | … | … |`) e cada célula em uma linha curta (decisão do operador de 16/11/2026; até
ali eram sub-linhas `Pró:` e `Contra:` sob a opção, que a coleta segue lendo).
- **Obrigatório** nos blocos de desenho (brainstorm e shaping, antes de existir design aprovado),
  onde cada opção é uma troca de custo: ali o teste não se aplica, e todo item leva pró e contra.
  A única exceção dentro do desenho é o item de aprovação do design (aprovo · ajustar), que
  não troca custo.
- **Nunca** nos itens de conserto do julgamento de tela (as três opções fixas acima). Fora do
  desenho, sim/não cuja opção já diz o custo não leva.
- Pró e contra não fazem opção nova nem a substituem: a opção segue legível sozinha, e a
  recomendação segue com o motivo dela.

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
- ❌ Prefixo visível no número além do D — task (`13.1`), fase (`F0.2`), ciclo ou código da filha
  na frente do inteiro; o tipo vai na chave escondida (regra 5). E o D com hífen (`D-3`), que a
  coleta não lê.
- ❌ Fecho antigo (`Diz 3 e eu toco.`) ou fecho sem o D; sem o fecho a coleta perde o bloco
  inteiro (regra 4).
- ❌ Pró e contra fora da tabela, ou tabela com a letra fora da primeira célula (§Pró e contra).
- ❌ Fora do ciclo com contador, repasse de filha com o número dela (`D3`, `4.1`) em vez do
  próximo inteiro da sessão mãe, ou sem a chave escondida que guarda o número da filha (regra 5).
  No ciclo com contador é o contrário: o número da filha passa igual.
- ❌ Chave tipada visível — fora de comentário HTML, ou dentro de bloco de código onde o
  comentário vira texto (regra 5).
- ❌ Opção que é outra renomeada — mesmo comportamento observável, palavras diferentes
  (§Invariante — opção tem de ser opção).
- ❌ Enterrar uma decisão como nota de rodapé, "ponto de veto" ou parágrafo no meio de um plano.
- ❌ Espelhar de volta para o operador o registro denso que o harness guarda para si.
