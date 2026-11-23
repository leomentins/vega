# Janela de contexto

Toda sessão da condução corta o contexto antes de degradar, e corta numa fronteira limpa. O teto é onde a sessão já deveria ter cortado, nunca onde ela começa a pensar no corte: os avisos chegam antes, em faixas. **Abaixo da última faixa (400k numa janela de 1M) não se corta por janela.** A partir dela a sessão avalia o corte limpo: procura a próxima fronteira limpa e corta nela.

## Faixas e teto

| Janela | Faixas de aviso | Avalia o corte a partir de | Teto |
| --- | --- | --- | --- |
| 1M | 250k · 300k · 400k | 400k | 500k |
| 200k | 50k · 60k · 80k (proporcional) | 80k | 100k |

Valem para todo papel da condução (condutora e operária), contados do zero da janela. Decisão do operador (D17a, 16/11/2026), que trocou a régua do VEGA-37 T23 (teto a 100k acima da carga inicial, ~187k numa janela de 1M): cada passagem custou caro no VEGA-19 (canal e numeração de decisão perdidos, a anterior ociosa), e a diferença de erro medida na T2 do VEGA-37 é de 0,7% para 1,9%.

Os números são do projeto, num arquivo só (na Sistoli, `.claude/state/janela-de-contexto.json`): faixas em fração da janela, teto, tamanho da janela por modelo e o texto de cada papel. Tamanho da janela: o do modelo declarado no arquivo, senão o padrão; contexto observado acima dele sobe ao tamanho seguinte.

## O sensor

Um hook do projeto lê, no transcript da própria sessão, o uso da última resposta do modelo (entrada + cache lido + cache criado) e avisa **uma vez por faixa**, por `additionalContext`. Abaixo da primeira faixa, silêncio. Nunca bloqueia; transcript ausente ou ilegível sai calado. O contexto que desce (compactação) rearma as faixas que ficaram acima dele.

O aviso traz: janela atual e faixa, papel, crescimento por unidade fechada e por chamada, a projeção de onde a unidade atual fecha e quantas cabem até o teto, e o corte do papel.

## Corte limpo

A unidade é o que o papel fecha sem deixar nada aberto. Com o crescimento médio por unidade (`g`) e o contexto em que a unidade atual começou, a projeção dá onde ela fecha (`fim`) e quantas cabem depois dela até o teto (`⌊(teto − fim) / g⌋`).

- **Faixas abaixo de 400k** (250k, 300k): aviso só informativo, com a projeção. Seguir; não cortar por janela.
- **A partir de 400k**: avaliar o corte limpo — procurar a próxima fronteira limpa e cortar nela, sem abrir unidade nova. Se `fim` passa do teto, a fronteira é o próximo ponto limpo dentro da unidade atual; senão, o fechamento dela.
- **Passou do teto**: cortar na próxima fronteira, sem abrir unidade nova.

## Papéis

| Papel | Como o sensor sabe | Unidade e fronteira limpa | Corte |
| --- | --- | --- | --- |
| **Condutora de execução** (`F<n>`) e **de fechamento** | o pedido de nascimento (`Conduzir <ciclo> — F<n>, pela skill …`, ou o da herdeira) | task conferida e trazida, nenhuma operária viva, nenhuma pergunta aberta | não compacta nem pede `/clear`: passa o comando à herdeira (`proximo` até a ação `passar`, nota no molde de `nota-de-passagem.md`) |
| **Condutora de shaping e de planejamento** | o pedido de nascimento da fase | fim de etapa do desenho ou do plano | compacta na fronteira (`/compact`, `write-plan/references/checkpoints.md`); a fase seguinte é a maestra de 3 níveis quem cria (a de planejamento manda `MESCLAR` e para) |
| **Maestra** (só em 3 níveis) | rodou `conducao.mjs maestra` | uma condutora criada; fronteira limpa é um `PASSAR` recebido, com a condutora que pediu parada | não compacta nem pede `/clear`: no `PASSAR` seguinte ao corte, o verbo `maestra` sai `passar-maestra`, e ela cria a própria herdeira e para ([`maestra.md`](maestra.md)) |
| **Operária** | o contrato no pedido de nascimento | a própria task fechada (commit; carimbo só em gatilho crítico ou publicação; aviso) | fecha a task pelo menor caminho, sem varredura nova; se a projeção passa o teto antes de fechar, para no próximo commit limpo e avisa `T<k>-FALHA janela <nonce>` |
| **Comum** | o resto | fim de task ou de etapa do pedido | **não recebe aviso** (ruling do operador, 16/11/2026): a sessão fora de condução não é mandada cortar, e quem decide `/compact` ou `/clear` é o operador. No config, `papeis.comum.enabled: false`; apagar a chave volta a avisar |

## A régua da condutora

Desde a D17a a régua é a da tabela acima, em fração da janela (`regua: null` no config do projeto). A partir de 400k, a condutora de execução fecha as operárias abertas e passa o comando na fronteira limpa seguinte; não há nível acima vigiando a janela dela. A maestra antiga, que vigiava a janela das condutoras, está aposentada; a maestra de 3 níveis só cria condutoras e vigia a própria janela.

O sensor guarda a régua anterior como mecanismo: preencher `regua` (`faixasAcima`, `tetoAcima`, `cargaPadrao`) no config volta a contar faixas e teto em tokens **acima da carga inicial** da sessão (o contexto da primeira resposta, relido do começo do transcript a cada leitura).

As decisões do operador que deram esta forma estão na página do projeto (campo `pagina` da declaração).
