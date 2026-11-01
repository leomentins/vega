# Camadas — onde mora o corpo, a camada da empresa e a do OS

A fábrica sai da fonte em duas vitrines, cada uma por uma lista fechada do que sai. Exportar é
copiar arquivo inteiro, nunca editar texto no caminho: por isso cada peça é escrita em papéis
(o corpo) e o que uma empresa ou a própria fonte põe nela mora em arquivo separado, fora do
corpo.

| Camada | O que é | Onde mora na fonte | Quem recebe |
| --- | --- | --- | --- |
| Corpo | a peça em papéis: "o operador", "o verbo de publicação", "o carimbo" | o que a lista do corpo nomeia — esta árvore do plugin inteira e as peças avulsas que ela lista | todo projeto |
| Camada da empresa | o que a empresa põe ao lado da peça: papel regulatório ou clínico, exemplo do domínio, quem responde por ele | `.vega/camadas/empresa/<caminho da peça>` — o mesmo caminho da peça, sob esse prefixo | só os projetos da empresa, junto com o corpo na versão exata |
| Camada do OS | o que só a fonte usa: caminhos do repositório, infraestrutura, ids de ciclo e de decisão, a declaração e o código do adaptador | tudo sob `.vega/` fora de `.vega/vitrine/` e `.vega/camadas/empresa/`, e a página do projeto que a declaração aponta (`conducao.pagina`) | ninguém — não aparece em lista nenhuma |

## Regras

- **Camada fora dos diretórios listados.** A lista do corpo nomeia diretórios inteiros (esta
  árvore do plugin). Arquivo de camada dentro de um diretório listado sairia junto; por isso a
  camada mora sob `.vega/`, nunca ao lado da peça dentro do plugin. O teste das listas reprova
  caminho listado sob `.vega/` fora do que a camada pode levar, e qualquer caminho listado com
  segmento `camadas/os/`, ou, na lista do corpo, `camadas/empresa/`.
- **As duas listas não se cruzem.** Nenhum arquivo entra nas duas. O que a vitrine leva além das
  peças (`README.md`, `CONTRIBUTING.md`, `marketplace.json`) tem um modelo por vitrine, em
  `.vega/vitrine/corpo/` e `.vega/vitrine/empresa/`, com destino na raiz e em `.claude-plugin/`
  da vitrine.
- **Camada que nasce entra na lista da empresa** com o destino que a peça tem na vitrine dela.
  A da empresa não carrega o endereço de produção; o corpo não carrega também nome nem registro
  profissional de quem responde pelo domínio. Cada lista tem o seu vocabulário proibido,
  `.vega/vocabulario-proibido-corpo.txt` e `.vega/vocabulario-proibido-empresa.txt`, casado como
  palavra inteira e sem caixa em todo arquivo da lista expandida (o canário do teste das listas,
  e a mesma regra da varredura da exportação).
- **Nunca sai** caminho sob `.agents/ciclo/`, `.agents/estado/`, `.serena/memories/`, nem com
  segmento `notes/` ou `sensivel/`, nem imagem ou PDF — lugar possível de dado de paciente, que a
  lista fechada não alcança.

## Forma das listas

Uma entrada por linha: um arquivo, ou um diretório terminado em `/` que casa por prefixo;
`origem => destino` quando o caminho na vitrine é outro (diretório para diretório, os dois com
`/`). Linha vazia e linha começada por `#` não entram. Onde estão as duas: `listas` na
declaração da fonte (`.vega/declaracao.json`).
