# vega

A fábrica de condução de ciclo por sessão: uma maestra, uma condutora por fase e uma operária
por tarefa, com cada ação emitida por script com nonce e conferida por comando.

Esta vitrine é só de saída. A mudança nasce na fonte, `SISTOLI/sistoli`, e chega aqui por
exportação: a árvore inteira vem da lista fechada do que sai, e o CI desta vitrine confere que
ela bate com o manifesto da exportação. Proposta aberta aqui não é aceita — veja
`CONTRIBUTING.md`.

## Instalar

No projeto, em escopo de projeto:

```bash
claude plugin marketplace add leomentins/vega
claude plugin install vega@vega --scope project
```

Depois, a declaração do projeto (`.vega/declaracao.json`) e os hooks:
`plugins/vega/INSTALL.md`. A atualização automática fica desligada; o projeto declara a versão
que instala.

## Camadas

O que está aqui é o corpo: fala em papéis, sem nada de empresa nem de projeto. Onde cada camada
mora: `plugins/vega/references/camadas.md`.
