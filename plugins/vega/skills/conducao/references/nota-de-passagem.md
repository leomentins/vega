# Nota de passagem — o molde

> A nota que a condutora grava ao passar o comando à herdeira, pelo verbo `passar F<n> --nota <arquivo>` de `conducao.mjs`. O verbo confere o molde, escreve a cabeça e grava a nota e a marca `Conducao: F<n> em passagem` num commit só. Neutro de projeto: números e caminhos do projeto vêm da declaração e da página do projeto.

## Quando

Só em **fronteira limpa**: nenhuma tentativa em voo, nenhuma trazida sem conferência, nenhuma filha viva (o `--entrada` leva as filhas, na forma do `proximo`). Com operária viva, a condutora primeiro fecha as abertas — traz e confere, ou registra a falha — e só então passa. Fora da fronteira o verbo recusa (`fronteira-suja`), sem gravar nada.

## Em passagem

Da marca até a herdeira confirmar (`Conducao: F<n> passagem confirmada`) ou a anterior desistir (`desistir-da-passagem F<n>`, marca `Conducao: F<n> passagem desistida`), a condutora está **em passagem**: `abrir` recusa (não abre operária) e `registrar-conferencia --publicacao feita` recusa (não publica), as duas com `em-passagem`. Fora dela, os dois seguem como antes.

A posse **não muda** no `passar`: muda uma vez, no `passar-posse` que a herdeira roda com o `lock_id` e a época que a nota leva, na mesma escrita que sobe a época.

## A cabeça (escrita pelo verbo)

O corpo que a condutora entrega vem **sem frontmatter**; o verbo escreve:

- `epoca` — a época da posse lida pela cerca (`sem-posse` ou `sem-leitor` quando o projeto não tem posse para ler);
- `lock_id` — o da posse (`nenhum` sem posse);
- `ponta` — o HEAD do ramo no momento da passagem;
- `cycle`, `phase`, `opened` e, quando o canonico tem `id:`, o endereço da nota.

Caminho: `<pasta do canonico>/notes/passagem-<fase>-<k>.md`, com `<k>` = a próxima da fase.

## O corpo — seis seções `## `, nesta ordem

Objetivo e próximo passo nas pontas, porque é o que a herdeira lê primeiro e por último; o meio é o que ela não acha sozinha no git.

1. `## Objetivo` — o que a fase entrega, numa frase ou duas.
2. `## Estado` — onde a fase está: feitas, a que falta, a que pergunta. Só o que o `retomar` não diz.
3. `## Decisões da fase` — cada decisão tomada nesta sessão, com o porquê.
4. `## Tentado e descartado` — o que se tentou, por que não serviu. É o que mais se perde entre sessões.
5. `## Ponteiros` — caminho, sha, número de proposta, id de decisão. **Ponteiro no lugar do conteúdo**: a herdeira lê o arquivo, a nota não o copia.
6. `## Próximo passo` — o primeiro comando da herdeira depois da rotina de partida.

Outra seção de nível 2, seção faltando ou fora da ordem ⇒ o verbo recusa (`nota-fora-do-molde`).

## Tamanho

**Alvo: até 2000 tokens** (`ALVO_NOTA_TOKENS`, contados a 4 caracteres por token), sem piso. Acima, o verbo recusa (`nota-acima-do-alvo`): corte trocando conteúdo por ponteiro.

De onde vem: a validação do desenho pediu 1 a 2 mil tokens (D-VEGA37-10). A medição das notas já escritas (`notes/medicao-passagem-T4.md` do VEGA-37) deu mediana de 593 tokens nas de condutora e p95 de 2130, com uma só acima de 2000; o teto ficou em 2000 e o piso caiu, porque a mediana abaixo de 1000 funciona. Somada à carga inicial medida (~82 mil na condutora), a nota no teto pesa ~2% da primeira resposta da herdeira. **Muda quando** uma nova medição das notas no molde mostrar p95 acima do alvo com a herdeira precisando do excesso, ou a carga inicial mudar de ordem.

## Cerca do par da posse

Todo verbo do motor que grava marca ou empurra a cópia — o `passar` incluso — lê a posse pelo `posse.comando` da declaração e recusa quando o par (`lock_id`, época) da sessão difere do da posse (D-VEGA37-17), por igualdade. Leitura que falha (banco fora), dona sem época e posse alheia também recusam: exit ≠ 0 com o motivo no stderr, e nada se grava. Projeto sem leitor de posse roda sem a cerca, com o pulo na saída.
