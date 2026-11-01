# Pedido à fonte — como um projeto pede mudança na fábrica

A fábrica tem uma fonte só, `SISTOLI/sistoli`; as vitrines são só de saída e não recebem
proposta. Um projeto que instalou a fábrica e precisa de mudança nela não edita a cópia
instalada nem abre proposta na vitrine: a próxima versão apagaria a edição.

## O caminho

1. **O operador leva a necessidade a uma sessão da Sistoli** — uma sessão aberta na fonte, não no
   projeto. A sessão do projeto não escreve na fonte.
2. **A sessão da Sistoli a registra pela porta de entrada da fonte**, o mesmo registro de débito
   que qualquer necessidade dela usa. Não há verbo novo para isto: o pedido de um projeto é um
   débito como outro, com origem no projeto.
3. **Sem dado do projeto.** O registro descreve o comportamento que falta ou que erra, em
   papéis: o que a peça faz, o que deveria fazer, como se vê. Nada de código, caminho, nome,
   segredo ou dado de quem usa o projeto atravessa para a fonte — o pedido é reescrito em
   papéis antes de entrar.
4. **A mudança segue o caminho da fonte** — ciclo ou ramo fora de ciclo, com proposta e CI de
   lá — e chega ao projeto por exportação, numa versão nova que o projeto declara quando quiser
   instalar.

## O que não é

- Não é canal de suporte em tempo real: o projeto segue na versão que declarou até instalar a
  nova.
- Não é ajuste local: o que um projeto põe só para si mora na declaração dele (`.vega/`), não na
  fábrica.
