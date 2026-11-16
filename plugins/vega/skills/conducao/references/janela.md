# Janela de contexto

Toda sessão da condução corta o contexto antes de degradar, e corta numa fronteira limpa. O teto é onde a sessão já deveria ter cortado, nunca onde ela começa a pensar no corte: os avisos chegam antes, em faixas, e em cada um a sessão decide onde cortar com o que mediu.

## Faixas e teto

| Janela | Faixas de aviso | Teto |
| --- | --- | --- |
| 1M | 250k · 300k · 400k | 500k |
| 200k | 50k · 60k · 80k (proporcional) | 100k |

Os números são do projeto, num arquivo só (na Sistoli, `.claude/state/janela-de-contexto.json`): faixas em fração da janela, teto, tamanho da janela por modelo e o texto de cada papel. Tamanho da janela: o do modelo declarado no arquivo, senão o padrão; contexto observado acima dele sobe ao tamanho seguinte.

## O sensor

Um hook do projeto lê, no transcript da própria sessão, o uso da última resposta do modelo (entrada + cache lido + cache criado) e avisa **uma vez por faixa**, por `additionalContext`. Abaixo da primeira faixa, silêncio. Nunca bloqueia; transcript ausente ou ilegível sai calado. O contexto que desce (compactação) rearma as faixas que ficaram acima dele.

O aviso traz: janela atual e faixa, papel, crescimento por unidade fechada e por chamada, a projeção de onde a unidade atual fecha e quantas cabem até o teto, e o corte do papel.

## Corte limpo e variável

A unidade é o que o papel fecha sem deixar nada aberto. Com o crescimento médio por unidade (`g`) e o contexto em que a unidade atual começou, a projeção dá onde ela fecha (`fim`):

- `fim` acima do teto ⇒ cortar no próximo ponto limpo da unidade atual;
- `fim + g` acima do teto ⇒ cortar ao fechar a unidade atual;
- senão ⇒ cabem `⌊(teto − fim) / g⌋` unidades depois dela: cortar na fronteira em que a seguinte já não caberia.

Sem unidade medida na sessão, decidir na faixa seguinte, com a medida; na última faixa, cortar ao fechar a unidade atual. Passou do teto: não abrir unidade nova.

## Papéis

| Papel | Como o sensor sabe | Unidade e fronteira limpa | Corte |
| --- | --- | --- | --- |
| **Condutora de execução** (`F<n>`) e **de fechamento** | o pedido de nascimento (`Conduzir <ciclo> — F<n>, pela skill …`, ou o da herdeira) | task conferida e trazida, nenhuma operária viva, nenhuma pergunta aberta | não compacta nem pede `/clear`: passa o comando à herdeira (`proximo` até a ação `passar`, nota no molde de `nota-de-passagem.md`) |
| **Condutora de shaping e de planejamento** | o pedido de nascimento da fase | fim de etapa do desenho ou do plano | compacta como a sessão comum; na fronteira, cria a seguinte (a de shaping cria a de planejamento) |
| **Operária** | o contrato no pedido de nascimento | a própria task fechada (commit; carimbo só em gatilho crítico ou publicação; aviso) | fecha a task pelo menor caminho, sem varredura nova; se a projeção passa o teto antes de fechar, para no próximo commit limpo e avisa `T<k>-FALHA janela <nonce>` |
| **Comum** | o resto | fim de task ou de etapa do pedido | fecha com o texto da próxima sessão e `/clear`; `/compact` se há racional só na conversa (`write-plan/references/checkpoints.md`) |

## A régua da condutora

A régua conta tokens **acima da carga inicial** da sessão (o contexto da primeira resposta), nunca fração da janela: o sensor lê a carga do começo do transcript a cada leitura e classifica o uso pelas faixas e pelo teto acima dela (`regua` no config do projeto, com a medição citada). Na faixa em que a próxima task não cabe, a condutora de execução fecha as operárias abertas e passa o comando na fronteira limpa seguinte; não há nível acima vigiando a janela dela. "Maestra", o nível que vigiava a janela das condutoras, é termo aposentado.

As decisões do operador que deram esta forma estão na página do projeto (campo `pagina` da declaração).
