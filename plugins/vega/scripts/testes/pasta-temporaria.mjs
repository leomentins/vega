/**
 * pasta-temporaria.mjs — pasta de teste no tmpdir que se apaga sozinha (hotfix tmp-sem-vazamento,
 * 23/11/2026).
 *
 * Em 23/11/2026 o /tmp do home-server (tmpfs) chegou a 1.048.576 de 1.048.576 inodes: dezenas de
 * milhares de pastas `mkdtempSync(join(tmpdir(), "<prefixo>-"))` largadas por testes que nunca as
 * apagavam. Sem inode livre, nenhum comando da ponte roda.
 *
 * `pastaTemporaria(prefixo)` é o `mkdtempSync` de sempre, mais o registro: no `exit` do processo
 * (cada arquivo do `node --test` roda no próprio), toda pasta registrada sai com `rm -rf`. Serve
 * também a helper de teste sem acesso ao `t`. Quem quer apagar antes segue livre para o `rmSync`.
 * `MANTER_PASTA_DE_TESTE=1` no ambiente deixa as pastas para depurar.
 *
 * Limite: o `exit` dispara no fim normal, no `process.exit` e na exceção não capturada; NÃO dispara
 * na morte por sinal (SIGTERM/SIGINT do `node --test` que estoura o prazo ou é cancelado, SIGKILL).
 * O que sobrar assim, a passada de hora em hora (`.claude/scripts/estacao/linux/limpar-tmp.sh`) leva
 * depois de 2 h: toda pasta daqui nasce com o nome `sistoli-teste-<prefixo>XXXXXX` (hotfix
 * tmp-inodes-teto, 24/11/2026), e é por esse nome que a passada a reconhece como resto de teste — as
 * outras pastas do /tmp esperam 24 h.
 *
 * Cópia idêntica fora do plugin (o plugin não importa nada de fora dele):
 * `.claude/scripts/testes/pasta-temporaria.mjs`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** O nome que marca a pasta como resto de teste para `limpar-tmp.sh` (que a leva depois de 2 h). */
export const PREFIXO_DE_TESTE = "sistoli-teste-";

const registradas = new Set();
let ligado = false;

function apagarTodas() {
  if (process.env.MANTER_PASTA_DE_TESTE === "1") return;
  for (const p of registradas) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // A limpeza nunca derruba o teste; o que sobrar, a limpeza agendada do /tmp leva.
    }
  }
  registradas.clear();
}

/** Cria `<tmpdir>/sistoli-teste-<prefixo>XXXXXX` e a apaga no fim do processo. */
export function pastaTemporaria(prefixo = "") {
  const p = mkdtempSync(path.join(tmpdir(), PREFIXO_DE_TESTE + prefixo));
  registradas.add(p);
  if (!ligado) {
    ligado = true;
    process.on("exit", apagarTodas);
  }
  return p;
}
