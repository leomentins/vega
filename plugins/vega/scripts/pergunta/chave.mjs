/**
 * chave.mjs — o que o contexto diz da chave escondida da pergunta (hotfix chave-da-pergunta,
 * 23/11/2026).
 *
 * A chave escondida (`<!-- decisao Dk = <ciclo>/<fase>/<task>/<código> · origem <papel> -->`, regra 5
 * do contrato de formato) saía `-/-/-/N · origem avulsa` em 66% das chaves medidas de 16 a 23/11:
 * quem abre a pergunta quase nunca a passava. Aqui mora a dedução pelo ramo, que o `comando.mjs
 * abrir` usa para completar a chave e o gancho `pergunta-sem-registro.mjs` usa para saber se o
 * turno estava dentro de um ciclo conhecido. Sem dependência além do `git`: o gancho Stop a importa.
 */
import { spawnSync } from "node:child_process";

/** `ciclo-<id>` (a branch do ciclo) e `ciclo-<id>-plano` (a do planejamento, em condução). */
const RAMO_DE_CICLO = /^ciclo-([A-Za-z][A-Za-z0-9._-]*?)(-plano)?$/;
/** `hotfix/<slug>-AAAAMMDD` e `docs/<slug>-AAAAMMDD`: o ciclo da chave é o slug, sem a modalidade nem a data. */
const RAMO_FORA_DE_CICLO = /^(hotfix|docs)\/([A-Za-z0-9._-]+?)(?:-\d{8})?$/;

/** Quantas posições a chave tem antes da origem: ciclo, fase, task e código. */
export const POSICOES_DA_CHAVE = 4;

/**
 * O que o ramo diz da chave: `ciclo-<id>` dá o ciclo, `ciclo-<id>-plano` também a origem
 * `planejamento`, `hotfix/*` e `docs/*` dão o slug e a origem da modalidade. Ramo de sessão da ponte
 * (`worktree-…`), `main` ou nenhum: `{}`. Puro.
 */
export function chaveDoRamo(ramo) {
  if (typeof ramo !== "string") return {};
  const r = ramo.trim();
  const c = RAMO_DE_CICLO.exec(r);
  if (c) return { ciclo: c[1], ...(c[2] ? { origem: "planejamento" } : {}) };
  const f = RAMO_FORA_DE_CICLO.exec(r);
  if (f) return { ciclo: f[2], origem: f[1] };
  return {};
}

/**
 * O ciclo de verdade que o ramo diz: só `ciclo-<id>` e `ciclo-<id>-plano`. O slug de `hotfix/*` e
 * `docs/*` entra na chave, mas não faz o turno estar "dentro de um ciclo" (fase e task não existem ali).
 */
export function cicloDoRamo(ramo) {
  const c = chaveDoRamo(ramo);
  return c.ciclo && c.origem !== "hotfix" && c.origem !== "docs" ? c.ciclo : null;
}

/** O ramo de `cwd` (`git rev-parse --abbrev-ref HEAD`); fora de repositório, HEAD solto ou erro, `null`. */
export function ramoAtual(cwd = process.cwd(), executar = spawnSync, { prazoMs = 5000 } = {}) {
  try {
    const r = executar("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: prazoMs });
    const ramo = r?.status === 0 ? String(r.stdout ?? "").trim() : "";
    return ramo && ramo !== "HEAD" ? ramo : null;
  } catch {
    return null;
  }
}
