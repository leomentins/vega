/**
 * criar-ramo.mjs — a maestra cria o ramo do ciclo sem checkout (D11b do L4,
 * pergunta p-2fe3674c014f0735; hotfix conducao-pedido-da-etapa, 23/11/2026).
 *
 * A maestra nunca tira ramo em árvore nenhuma, nem na dela (D10c/D16a): o ramo
 * vive na árvore da condutora da fase. Para a proposta nascer já com o ramo,
 * a maestra cria um commit vazio sobre `origin/main` (`git commit-tree` da
 * árvore de `origin/main`, pai `origin/main`), grava a referência local sem
 * checkout e empurra só a referência. Depois, fora do script: a proposta em
 * rascunho (`gh pr create --draft`, nasce com 0 arquivos e o CI dispara) e a
 * inscrição (`subscribe_pr_activity`), que são da maestra.
 *
 * Dois ramos por ciclo, um de cada vez: o de planejamento (`ciclo-<id>-plano`,
 * mesclado por squash depois do `/plan-review` executável) e o de execução
 * (`ciclo-<id>`, que nasce de `main` depois). Outro ramo do mesmo ciclo vivo
 * (local ou no origin) recusa: a maestra apaga o anterior depois de mesclá-lo.
 *
 * O assunto do commit que abre é neutro: não abre com `Conducao:` (não vira marca)
 * nem traz `-F<n>` (não vira commit de fase); o Step 7 do `/close-cycle` o projeta
 * como `nao reconhecido`, causa conhecida. O ramo de execução leva, por cima dele,
 * um segundo commit vazio: a marca `Conducao: ciclo niveis 3` (`MARCA_DE_NIVEIS`).
 */
import { tentarGit } from "./git-exec.mjs";
import { ErroPlano } from "./ler-plano.mjs";

export const TIPOS_DE_RAMO = Object.freeze(["plano", "execucao"]);

/** O nome do ramo de cada tipo: o de planejamento leva o slug fixo `plano`. */
export function nomeDoRamo(ciclo, tipo) {
  if (!TIPOS_DE_RAMO.includes(tipo)) throw new ErroPlano("uso", `criar-ramo exige --tipo ${TIPOS_DE_RAMO.join("|")}, veio ${JSON.stringify(tipo ?? null)}`);
  return tipo === "plano" ? `ciclo-${ciclo}-plano` : `ciclo-${ciclo}`;
}

/** O assunto neutro do commit que abre o ramo: nem marca da condução, nem commit de fase. */
export function assuntoDoRamo(ramo) {
  const assunto = `Abre ${ramo} sobre main`;
  if (/^Conducao:/.test(assunto) || /-F\d{1,2}\b/.test(assunto))
    throw new ErroPlano("assunto-ambiguo", `o assunto ${JSON.stringify(assunto)} casaria marca ou commit de fase: o id do ciclo não pode ter -F<n>`);
  return assunto;
}

/**
 * A marca `Conducao: ciclo niveis 3` que o ramo de execução leva desde o nascimento (hotfix
 * conducao-niveis-e-replano, 23/11/2026). Desde a D10c do L4 (p-2fe3674c014f0735) a condução é
 * sempre em 3 níveis; a leitura (`niveisDasMarcas`) segue inferindo 2 de um ramo autorizado sem
 * marca, que é o ciclo legado de verdade, e por isso quem marca é o nascimento, não a leitura.
 * O corpo é prosa da máquina, não resposta do operador: `Conducao-Origem: criar-ramo` o diz.
 */
export const MARCA_DE_NIVEIS = Object.freeze([
  "Conducao: ciclo niveis 3",
  "Ramo de execução criado pelo criar-ramo: a condução é em 3 níveis (D10c do L4, p-2fe3674c014f0735).",
  "Conducao-Niveis: 3\nConducao-Origem: criar-ramo",
]);

const ehDoCiclo = (ramo, ciclo) => ramo === `ciclo-${ciclo}` || ramo.startsWith(`ciclo-${ciclo}-`);

function exigirGit(r, oQue) {
  if (r.status !== 0) throw new ErroPlano("git-falhou", `${oQue}: ${(r.erro || "sem saída").split("\n")[0]}`);
  return r.saida;
}

/**
 * Cria e empurra o ramo. `{ acao: "ramo-criado", ramo, sha, depois }`, ou
 * `ErroPlano` com o motivo: `ramo-do-ciclo-vivo` (outro ramo do ciclo, local
 * ou no origin), `git-falhou`, `push-recusado` (a referência local é desfeita:
 * repetir o verbo depois de remover a causa).
 */
export function criarRamo({ repo, ciclo, tipo, git = tentarGit }) {
  if (!ciclo) throw new ErroPlano("uso", "criar-ramo exige --ciclo <id>");
  const ramo = nomeDoRamo(ciclo, tipo);
  const assunto = assuntoDoRamo(ramo);
  exigirGit(git(repo, ["fetch", "--quiet", "origin", "main"], { rede: true }), "fetch de origin/main");
  const locais = exigirGit(git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]), "ramos locais")
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x && ehDoCiclo(x, ciclo));
  const remotos = exigirGit(git(repo, ["ls-remote", "--heads", "origin"], { rede: true }), "ramos do origin")
    .split("\n")
    .map((l) => l.split("\t")[1]?.replace(/^refs\/heads\//, "") ?? "")
    .filter((x) => x && ehDoCiclo(x, ciclo));
  const vivos = [...new Set([...locais, ...remotos])];
  if (vivos.length)
    throw new ErroPlano(
      "ramo-do-ciclo-vivo",
      `o ciclo ${ciclo} já tem ramo: ${vivos.join(", ")} — um ramo por vez; mesclar e apagar o anterior (local e no origin) antes de criar ${ramo}`,
    );
  const arvoreDoMain = exigirGit(git(repo, ["rev-parse", "origin/main^{tree}"]), "árvore de origin/main");
  const abre = exigirGit(git(repo, ["commit-tree", arvoreDoMain, "-p", "origin/main", "-m", assunto]), "commit-tree").trim();
  // O de execução ganha por cima a marca de 3 níveis (`marcaDeNiveis`): sem ela, a `Conducao: F0
  // autorizada` faria `niveisDasMarcas` ler o ramo como legado de 2 (percalço do L4, D13).
  const sha = tipo === "execucao"
    ? exigirGit(git(repo, ["commit-tree", arvoreDoMain, "-p", abre, ...MARCA_DE_NIVEIS.flatMap((m) => ["-m", m])]), "commit-tree da marca de níveis").trim()
    : abre;
  exigirGit(git(repo, ["update-ref", `refs/heads/${ramo}`, sha, ""]), `referência ${ramo}`);
  const push = git(repo, ["push", "--quiet", "origin", `${sha}:refs/heads/${ramo}`], { rede: true });
  if (push.status !== 0) {
    const causa = (push.erro || (push.status === null ? "prazo de rede estourado" : "sem saída")).split("\n")[0];
    // O push pode ter chegado ao origin sem status 0 (prazo estourado depois do aceite): conferir.
    const la = git(repo, ["ls-remote", "--heads", "origin", `refs/heads/${ramo}`], { rede: true });
    const noOrigin =
      la.status !== 0 ? "não se sabe se chegou ao origin (ls-remote falhou)"
      : (la.saida ?? "").includes(sha) ? `chegou ao origin assim mesmo: git push origin --delete ${ramo} antes de repetir`
      : "não chegou ao origin";
    const desfeita = git(repo, ["update-ref", "-d", `refs/heads/${ramo}`, sha]);
    const local = desfeita.status === 0 ? "a referência local foi desfeita" : `a referência local NÃO se desfez (${(desfeita.erro || "sem saída").split("\n")[0]}): git update-ref -d refs/heads/${ramo}`;
    throw new ErroPlano("push-recusado", `o push de ${ramo} falhou (${causa}); ${noOrigin}; ${local} — remover a causa e repetir`);
  }
  const titulo = tipo === "plano" ? `${ciclo} — planejamento` : `${ciclo} — execução`;
  return {
    acao: "ramo-criado",
    ciclo,
    tipo,
    ramo,
    sha,
    depois: [
      `gh pr create --draft --base main --head ${ramo} --title "${titulo}" --body "<corpo>"`,
      "subscribe_pr_activity na proposta criada (a inscrição é da maestra, do nascimento à mesclagem)",
      tipo === "plano" ? "maestra --ciclo <id> … ⇒ criar-condutora de planejamento" : "maestra --ciclo <id> … ⇒ criar-condutora da F0",
    ],
  };
}
