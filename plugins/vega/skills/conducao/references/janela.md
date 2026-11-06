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
| **Maestra** | a sessão rodou `proximo --nivel maestra` | fase: condutora encerrada e arquivada, nenhuma filha viva, nenhuma decisão aberta, tudo no git ou no banco | pede `/clear` ao operador nessa fronteira, com a nota de passagem commitada; o id fica, e as filhas seguem usando-o como `@parent` |
| **Condutora** | o pedido de nascimento é o texto da próxima sessão (`Conduzir <ciclo> — F<n>, pela skill …`) | task conferida e trazida, nenhuma neta viva | nota de passagem em `notes/` (commit só de prosa, `empurrar-copia`) e sobe à maestra `janela <usados>/<janela> faixa <f> — parada limpa após T<k>` |
| **Operária** | o contrato no pedido de nascimento | a própria task fechada (commit; carimbo só em gatilho crítico ou publicação; aviso) | fecha a task pelo menor caminho, sem varredura nova; se a projeção passa o teto antes de fechar, para no próximo commit limpo e avisa `T<k>-FALHA janela <nonce>` |
| **Comum** | o resto | fim de task ou de etapa do pedido | fecha com o texto da próxima sessão e `/clear`; `/compact` se há racional só na conversa (`write-plan/references/checkpoints.md`) |

## A janela das condutoras

A maestra vigia a própria janela pelo sensor e a de cada condutora pelo `get_session` que ela já lê para montar `filhas`: `external_metadata.context_usage` (`used_tokens`, `max_tokens`), classificado pelas mesmas faixas (o comando está na página do projeto). A condutora que cruza uma faixa já foi avisada pelo sensor dela e põe a linha `janela …` na próxima mensagem à maestra — o segundo caminho, para quando o `get_session` não traz o uso.

Condutora na faixa em que a próxima task não cabe: a maestra espera a parada limpa, arquiva a sessão dela, e o `proximo --nivel maestra` emite `criar-condutora` da mesma fase com tentativa nova (condutora arquivada sem `Conducao-Encerrada` é recriada); a nova retoma pelo git.

As decisões do operador que deram esta forma estão na página do projeto (campo `pagina` da declaração).
