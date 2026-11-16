# Condução no projeto de exemplo

O que é deste projeto e não do núcleo da condução.

- **Plano:** formato público, lido pelo adaptador embutido `superpowers`, em `docs/planos/<ciclo>.md`.
- **CI da proposta:** nenhum (`"ci": false`): a fase e o ciclo fecham pela Verificação da última tarefa.
- **Carimbo de revisão:** o projeto não exige.
- **Publicação:** nenhuma; tarefa que publicasse traria `**Publicação:** sim`.
- **Sonda do push do ramo:** `node --test` na raiz do projeto.
- **Posse na passagem:** este projeto não declara `posse`, e sem posse declarada não há passagem de posse a fazer. Numa cópia cuja declaração traz `posse.comando`, o verbo que passa a posse é o que a página do projeto dessa cópia nomeia (na Sistoli, `estado.mjs lane passar-posse`), rodado pela herdeira depois do `trazer-ramo` e antes do pré-voo `--herdeira`.
