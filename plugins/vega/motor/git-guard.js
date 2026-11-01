"use strict";
// FONTE UNICA (HN-38 T15, 09/09/2026): este arquivo e o hook, sem espelho nem copia.
// Quem o alcanca e o motor da arvore (`hooks-do-motor.mjs
// --executar git-guard.js`); o que e do projeto -- as saidas geradas que a excecao de
// conteudo preservado libera -- vem da declaracao do projeto a fabrica (HN-29 T42), nunca
// deste codigo.
// PreToolUse guard: comandos git destrutivos via Bash/PowerShell tool.
// Bloqueia o conjunto catastrófico (perda IRRECUPERÁVEL de trabalho ou histórico)
// e libera o resto — merge, cherry-pick, checkout/switch de branch, worktree add
// passam direto (fricção desnecessária no loop se bloqueados por padrão).
//
// Modo: .claude/state/git-guard-mode (default HARD).
//   hard: exit 2 + stderr explicativo · soft: log-only · off: silente.
// Escape one-shot: adicionar substring do comando em .claude/state/git-guard-allow
// (uma linha = uma execução autorizada; o hook consome a linha). Linha vazia e linha
// iniciada por `#` são ignoradas — o arquivo carrega o próprio cabeçalho de formato.
// Sempre passa: git read-only (log/show/diff/status), commit, push não-force.
//
// TIER SUBAGENT: contexto subagent é detectável pelo campo `agent_id`/`agent_type`
// no input do hook. Subagent tem superfície git MENOR que a sessão principal:
// permitido add/commit + read-only (log/show/diff/status e `stash list|show`); TUDO
// que muda HEAD/branch/histórico (reset qualquer forma, checkout, switch, merge,
// rebase, cherry-pick, push, worktree, branch -d/-D/-m) E TUDO que engaveta árvore
// de trabalho (stash em qualquer forma que não seja list|show) bloqueia com
// instrução de reportar ao controller. O escape one-shot NÃO vale no tier subagent:
// o subagent tem Bash e escreveria a própria autorização.
//
// stash foi REVOGADO do tier subagent (era permitido push|apply|list): commit-isolado
// é padrão da sessão MAIN sobre trabalho próprio, nunca de um subagent sobre trabalho
// de terceiro — sem poder criar a entry, `apply` só alcança a de outrem. A metade
// destrutiva (pop/drop/clear) já era coberta pela lista global.
//
// Residuais conhecidos (aceitos — threat model é agente confuso, não adversário):
//   (a) comando git envelopado em string quoted COM espaço (`pwsh -c "git reset
//       --hard"`) escapa do scan porque literais quoted multi-palavra são removidos
//       p/ não falso-positivar em commit messages (quoted de palavra única, como
//       `git 'stash'`, é normalizado e NÃO escapa);
//   (b) detecção de subagent é fail-open: se o harness que invoca o hook omitir
//       `agent_id`/`agent_type`, o tier subagent degrada silenciosamente para a
//       lista global (o conjunto catastrófico continua coberto);
//   (c) o scan é textual, não execução: prosa que contenha os tokens `git stash`
//       soltos (`echo git stash >> notas`) bloqueia. Falso-positivo fail-closed,
//       resolvível pelo escape one-shot na sessão main;
//   (d) alias JÁ GRAVADO no ~/.gitconfig (`st = stash`) é invisível ao scan — `git st`
//       lê como subcomando `st`. Detectar exigiria rodar `git config --get` a cada
//       invocação; o que dá p/ pegar é a GRAVAÇÃO do alias, bloqueada no tier subagent;
//   (e) [RESOLVIDO em 2026-08-18] as 9 regras do tier subagent casavam o verbo em
//       QUALQUER posição, então navegação read-only (`git log --grep=...push`,
//       `git log -- .../read-reuse-reset.js`, `git merge-base`) bloqueava e era
//       rotulada com um verbo não digitado. Migradas para leitura por posição de
//       subcomando, como stash e restore já haviam feito.
//
// Input (stdin JSON): { tool_name: "Bash"|"PowerShell", tool_input: { command }, cwd,
//   agent_id?, agent_type? (presentes só em contexto subagent) }
// NUNCA crash. Fallback: exit 0.
//
// 2026-08-23 (0.1.4): `branch -D` numa branch ciclo-* cuja tree já está no histórico de main
// libera automático (branchDeleteContentPreserved, definida perto de restoreDiscardsWorktree)
// — motivado por medição do log real (git branch -D era o único padrão deste hook com volume
// repetido de escape manual). Sessão main apenas; fail-closed em qualquer erro do verificador.

// 2026-08-26: excecao de CONTEUDO PRESERVADO na sessao main para `worktree remove
// --force` de arvore limpa e para descarte por path cujo blob ja vive numa ponta de ref ou
// cujo path e artefato gerado (ruling 1b de Leo, medido sobre 130 bloqueios de sessao main
// em 30 dias). Ver `contentPreserved` adiante. Tier subagent INTACTO -- a excecao recusa de
// cara se `isSubagent`.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// TIER PRINCIPAL POR POSICAO DE SUBCOMANDO (HN-38 T15, 09/09/2026 -- fecha
// AE-MH-GITGUARD-TIER-MAIN-AINDA-FROUXO). Ate aqui estas regras eram regex de PREFIXO
// FROUXO (`\bgit\b[^\n;|&]*\breset\b[^\n;|&]*--hard`): bastava `git` e o verbo cairem no
// MESMO SEGMENTO, em qualquer posicao e com qualquer coisa entre eles. O tier subagent
// migrou para posicao de subcomando em 18/08/2026 e este ficou para tras; o residual (c)
// do cabecalho -- "prosa que contenha os tokens bloqueia" -- ganhou caso concreto medido:
// um `cat >> arquivo.md` cujo CONTEUDO citava o verbo e a flag na mesma linha foi negado,
// e a doc teve de ser escrita por outro caminho.
//
// `mainSub` exige que o verbo seja o SUBCOMANDO de fato -- primeiro token nao-opcao depois
// de um token que E o executavel git (`git`, `git.exe`, `/usr/bin/git`) -- e que a flag
// destrutiva esteja nos ARGUMENTOS daquele subcomando. Deixam de casar: `git-guard`,
// `regit`, "use git para dar reset --hard", `node scripts/reset.mjs --hard`.
//
// RESIDUAL DECLARADO, para nao virar promessa maior que o fato: heredoc CRU
// (`cat > f <<FIM` / `git reset --hard` / `FIM`) ainda tokeniza como comando -- o hook nao
// parseia shell e nunca vai parsear. O que sai do falso-positivo e a citacao inline e o
// texto quoted, que `normalizeTokens` colapsa.
//
// UMA superficie ALARGA, e vai declarada: `git clean --force` (forma longa) passava, porque
// a regex antiga so casava cluster curto (`\s-[a-z]*f`). Comando irrecuperavel que escapava
// por grafia nao e superficie a preservar.
const mainSub = (name, argPred) => (cmd) =>
  gitInvocations(cmd).some(({ sub, args }) => sub === name && argPred(args));

// flag longa por nome EXATO -- `--force` nao casa `--force-with-lease`.
const hasLong = (args, ...names) => args.some((a) => names.includes(a));
// cluster curto contendo a letra: `-f`, `-fd`, `-xdf`. Nunca casa forma longa.
const hasShort = (args, letter) =>
  args.some((a) => /^-[a-zA-Z]+$/.test(a) && a.slice(1).includes(letter));
const forced = (args) => hasLong(args, "--force") || hasShort(args, "f");

const BLOCKED = [
  [
    mainSub("reset", (args) => hasLong(args, "--hard", "--merge", "--keep")),
    "git reset --hard/--merge/--keep",
  ],
  // `--force-with-lease` liberado na sessão MAIN por ruling de Leo (26/08/2026):
  // custo de pedir autorização one-shot toda vez > risco, dado que ele sempre aprova e o
  // resto do harness (review, gates) já cobre a consequência de um push malfeito. Escopo
  // é SÓ a sessão main — `--force` bare e `-f` seguem bloqueados (sem o safety-check de
  // lease), e `subagentSub("push")` abaixo bloqueia QUALQUER push de subagent, forçado
  // ou não, sem exceção — não tocado por este ruling. `hasLong` preserva o recorte por
  // construcao: `--force-with-lease` e `--force-if-includes` nao sao `--force`.
  [mainSub("push", forced), "git push --force"],
  [mainSub("clean", forced), "git clean -f"],
  // `git branch -D` liberado na sessão MAIN por ruling de Leo (26/08/2026), mesmo
  // rationale do push acima. A trava de SUBAGENT (`subagentBranchFlag`, linha ~406) é
  // camada estrutural separada — nasceu do incidente HN-10 (subagent apagando branch
  // sozinho) e o próprio design da linha de allow-file a torna impossível de contornar
  // por autoautorização (linha "queimada mesmo quando recusada"). NÃO tocada aqui.
  [() => false, "git branch -D (liberado na sessão main — ver ruling acima)"],
  // o subcomando de stash e SEMPRE o primeiro argumento (o git exige) -- mesma leitura que
  // `subagentStash` ja fazia do outro lado.
  [
    mainSub("stash", (args) =>
      ["pop", "drop", "clear"].includes((args[0] || "").toLowerCase()),
    ),
    "git stash pop/drop/clear",
  ],
  // checkout/switch para troca de branch são LIVRES (sem overguard); bloqueiam só
  // as formas que DESCARTAM mudanças locais.
  [
    mainSub(
      "checkout",
      (args) => args.includes("--") || args.includes(".") || forced(args),
    ),
    "git checkout com descarte de mudanças locais (-- <path> / . / -f)",
  ],
  [
    mainSub(
      "switch",
      (args) => hasLong(args, "--discard-changes") || forced(args),
    ),
    "git switch com descarte de mudanças locais",
  ],
  // LIBERADOS (não-destrutivos): git merge, git cherry-pick, git worktree add cru.
  // Passam direto — só a remoção forçada de worktree é destrutiva o bastante p/ bloquear.
  [
    mainSub(
      "worktree",
      (args) => (args[0] || "").toLowerCase() === "remove" && forced(args),
    ),
    "git worktree remove --force",
  ],
  // precisa de exceção read-only, que prefixo frouxo não expressava — `restore --staged`
  // é inofensivo, `restore .` é irrecuperável. Ja nasceu por posicao de subcomando.
  [restoreDiscardsWorktree, "git restore com descarte da árvore de trabalho"],
];

// --- leitura por POSIÇÃO DE SUBCOMANDO (usada só pelas regras que precisam de exceção
// read-only; as regras de prefixo frouxo abaixo seguem intactas). Um prefixo frouxo
// (`[^\n;|&]*stash`) não serve aqui: o argumento `stash@{0}` de `stash show -p stash@{0}`
// re-casa por backtracking e derruba a exceção.

// `git`, `git.exe`, `/usr/bin/git` — o sufixo de executável não pode virar escape.
const GIT_TOKEN = /^(?:.*[/\\])?git(?:\.exe)?$/i;
// opções ANTES do subcomando que consomem o token seguinte como VALOR — sem isto,
// `git --work-tree /tmp/x stash` esconde o subcomando atrás do valor da opção.
const VALUE_OPTS = new Set([
  "-c",
  "-C",
  "--work-tree",
  "--git-dir",
  "--namespace",
  "--exec-path",
  "--config-env",
  "--super-prefix",
  "--attr-source",
]);
// subcomando que não é palavra (`git $(echo stash)`) é ILEGÍVEL, não inofensivo.
const OPAQUE_SUB = /[^a-z0-9-]/i;

// quoted multi-palavra vira placeholder (pode ser prosa de commit message); quoted de
// palavra única perde só as aspas — `git 'stash'` é `git stash`, não um token opaco.
function normalizeTokens(cmd) {
  return cmd
    .replace(/'([^']*)'/g, (_m, g) => (/\s/.test(g) ? '""' : g))
    .replace(/"((?:[^"\\]|\\.)*)"/g, (_m, g) => (/\s/.test(g) ? '""' : g));
}

function gitSubcommands(cmd) {
  const out = [];
  for (const seg of normalizeTokens(cmd).split(/[\n;|&]+/)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < toks.length; i++) {
      if (!GIT_TOKEN.test(toks[i])) continue;
      let j = i + 1;
      while (j < toks.length && toks[j].startsWith("-")) {
        if (VALUE_OPTS.has(toks[j])) j++;
        j++;
      }
      if (j < toks.length)
        out.push({ sub: toks[j].toLowerCase(), args: toks.slice(j + 1) });
      i = j;
    }
  }
  return out;
}

// --- INVOCACAO x MENCAO (tier PRINCIPAL apenas; o subagent segue com `gitSubcommands`) ---
//
// `gitSubcommands` responde "o token git aparece em algum lugar deste segmento, seguido de
// um subcomando?". Isso basta no tier subagent, onde falso-positivo custa uma linha de
// report ao controller. No tier principal custa a sessao do operador: o caso medido em
// AE-MH-GITGUARD-TIER-MAIN-AINDA-FROUXO e uma DOC sendo escrita com um `cat >> arquivo.md`
// cujo texto dizia o verbo e a flag -- "Nunca rodar git reset --hard" tem `git` seguido de
// `reset` seguido de `--hard`, e nao e comando nenhum.
//
// `gitInvocations` acrescenta UMA pergunta: o token git esta em POSICAO DE COMANDO? Comeco
// de segmento, ou depois so de coisas que nao consomem a posicao -- atribuicao de ambiente
// (`VAR=x git ...`), um envelope (`sudo`, `env`, `time`, `xargs`, `find -exec`) ou as
// opcoes dele. Qualquer outra palavra antes derruba a posicao, e o que vem depois e MENCAO.
//
// Segmentacao mais larga que a de `gitSubcommands`, de proposito: `$(`, crase e chaves
// ABREM comando novo, entao `$(git reset --hard)` continua sendo invocacao -- sem isso a
// pergunta de posicao viraria escape.
//
// O que isto NAO promete: heredoc cujo CONTEUDO comeca por `git`. `cat > f <<FIM` seguido
// de uma linha `git reset --hard` e, token a token, indistinguivel do comando -- separar os
// dois exige parsear shell, e este hook nao parseia. Residual declarado, nao coberto.
const ABRE_COMANDO = /[\n;|&]+|\$\(|`|\{|\}|\(|\)/;
const ENVELOPES = new Set([
  "sudo",
  "doas",
  "env",
  "time",
  "nohup",
  "command",
  "exec",
  "xargs",
  "-exec",
  "-execdir",
  "then",
  "else",
  "do",
]);
const ATRIBUICAO = /^[A-Za-z_][A-Za-z0-9_]*=/;

function gitInvocations(cmd) {
  const out = [];
  for (const seg of normalizeTokens(cmd).split(ABRE_COMANDO)) {
    if (!seg) continue;
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    let atCmd = true;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (atCmd && GIT_TOKEN.test(t)) {
        let j = i + 1;
        while (j < toks.length && toks[j].startsWith("-")) {
          if (VALUE_OPTS.has(toks[j])) j++;
          j++;
        }
        if (j < toks.length)
          out.push({ sub: toks[j].toLowerCase(), args: toks.slice(j + 1) });
        i = j;
        atCmd = false;
        continue;
      }
      if (ENVELOPES.has(t)) atCmd = true;
      else if (atCmd && (ATRIBUICAO.test(t) || t.startsWith("-"))) continue;
      else atCmd = false;
    }
  }
  return out;
}

// stash em posição de subcomando, exceto as formas read-only (`list`/`show`) — que são
// justamente como o subagent INSPECIONA e REPORTA a necessidade ao controller.
// O subcomando de stash é SEMPRE o primeiro argumento (git exige): procurar o primeiro
// token não-opção varre fundo demais e deixa passar `git stash -m list`, `git stash --
// list` e `git stash -u -- show`, que engavetam a árvore igual.
function subagentStash(cmd) {
  return gitSubcommands(cmd).some(({ sub, args }) => {
    if (sub !== "stash") return false;
    const first = (args[0] || "").toLowerCase();
    return first !== "list" && first !== "show";
  });
}

// subcomando ilegível: não dá para julgar, então não passa.
function subagentOpaque(cmd) {
  return gitSubcommands(cmd).some(({ sub }) => OPAQUE_SUB.test(sub));
}

// `git -c alias.z=stash z` — o subcomando real vira `z`. ANCORADO em `-c`/`--config-env`
// de propósito: sem a âncora, `git commit -m "doc: alias.z=stash"` (esta própria linha)
// bloquearia o subagent numa superfície permitida, e o escape one-shot não vale no tier.
// Casa no cmd CRU porque o valor do alias pode vir quoted (`-c alias.z="!git stash"`).
const ALIAS_TO_BLOCKED =
  /(?:\s-c\b|--config-env)\s+['"]?alias\.[\w.-]+\s*=\s*['"]?\s*!?\s*['"]?\s*(?:git\s+)?(?:stash|reset|restore|checkout|switch|merge|rebase|cherry-pick|push|worktree|clean)\b/i;
const subagentAlias = (cmd) => ALIAS_TO_BLOCKED.test(cmd);

// gravar o alias no config é a versão persistente do mesmo escape.
function subagentConfigAlias(cmd) {
  return gitSubcommands(cmd).some(
    ({ sub, args }) => sub === "config" && args.some((a) => /^alias\./i.test(a)),
  );
}

// `git restore <path>` descarta a árvore SEM reflog — é o sinônimo moderno exato de
// `git checkout -- <path>`, que já era bloqueado, e faltava nas duas listas. `--staged`
// sozinho mexe só no index (não destrutivo); `--worktree`, ou a ausência de modo, toca
// o arquivo em disco.
function restoreDiscardsWorktree(cmd) {
  return gitSubcommands(cmd).some(({ sub, args }) => {
    if (sub !== "restore") return false;
    const staged = args.includes("--staged") || args.includes("-S");
    const worktree = args.includes("--worktree") || args.includes("-W");
    return worktree || !staged;
  });
}

// A exceção fina de "branch -D com conteúdo preservado em main" (0.1.4, medida contra 526
// eventos reais e endurecida por review adversarial em 23/08) morreu em 26/08/2026: o
// ruling de Leo tornou `branch -D` incondicional na sessão main (ver BLOCKED acima), então
// provar preservação por tree deixou de ter chamador. O código (isForceDeleteArgs,
// branchForceDelete, branchContentIsInMain, branchDeleteContentPreserved, gitOut, o hash
// EMPTY_TREE) e a análise que o sustentava — inclusive o achado central de que casar por
// ASSUNTO de commit era fabricável e liberava 11 de 11 branches reais — ficam recuperáveis
// no histórico do git (`git log -p -- .claude/hooks/git-guard.js`), não repetidos aqui. A
// mesma lógica NUNCA cobria o tier subagent (recusa de cara se `isSubagent`) — essa camada
// segue exatamente como estava, ver `subagentBranchFlag` abaixo.

// --- EXCECAO DE CONTEUDO PRESERVADO (ruling de Leo 26/08/2026 -- opcao 1b) ---
//
// Mesma forma do extinto `branchDeleteContentPreserved`: nao afrouxa a regra, PROVA que
// aquela invocacao nao perde nada. Sessao MAIN apenas -- `isSubagent` recusa de cara, e e
// por isso que o tier subagent do HN-10 continua intacto. Fail-closed em QUALQUER erro:
// se o verificador nao conseguir provar, bloqueia.
//
// Medida que a motivou (`.claude/state/git-guard.log`, 130 bloqueios de sessao main em 30
// dias): 16 dos 38 descartes por path eram o `next-env.d.ts` do app -- arquivo que o
// `next build` REESCREVE sozinho -- e 2 eram `types.ts`, que o `gen-types` regenera. Os
// 5 `worktree remove --force` tinham alvo sob `/tmp` nos 5 casos, sem excecao: worktree
// efemera de verificacao, cujo conteudo e um checkout.
//
// As duas metades provam coisas DIFERENTES, e a distincao importa:
//   . artefato GERADO e seguro por ser REPRODUZIVEL (o conteudo descartado nao existe em
//     ref nenhuma -- e a reescrita do build; o que o restaura e o comando que o gera);
//   . o resto e seguro por ser PRESERVADO (o blob que sai ja esta numa ponta de ref).
// Confundir as duas liberaria descarte de trabalho autorado sob o rotulo errado.

const { execFileSync: _efs } = require("child_process");

function gitProbe(args, cwd) {
  return _efs("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 4000,
    windowsHide: true,
  });
}

// Artefato gerado: caminho EXATO (nunca glob) + o comando que o reproduz, para a mensagem
// nao virar folclore. A lista e do PROJETO: o campo `saidas_geradas` da declaracao
// (`<raiz>/.vega/declaracao.json`), lido pela mesma `saidasGeradas` que a conducao usa.
// Lista fechada: entrada nova exige medicao no log. Declaracao AUSENTE = lista vazia, e o
// guard decide sobre todo o resto como antes; presente e ilegivel, ou com forma errada,
// lanca -- e quem chama recusa alto (exit 2), nunca cai calado na lista vazia.
//
// A raiz e o `CLAUDE_PROJECT_DIR` ou, sem ele, a arvore onde o motor mora (D-HN29-22a). Na
// fonte, essa arvore E o projeto; no consumidor o motor mora no cache do plugin, que nao tem
// `.vega/`, e a lista sai vazia -- nenhuma saida liberada, falha fechado. Difere do
// `lean-entry-check` so nesse recuo: o cwd do comando nunca escolhe a declaracao.
const ARVORE_DO_MOTOR = path.resolve(__dirname, "..", "..", "..", "..");

function raizDoProjeto() {
  return process.env.CLAUDE_PROJECT_DIR || ARVORE_DO_MOTOR;
}

// O leitor e ESM; `require` dele exige Node >= 22.12. Sem isso a falha nao e da declaracao,
// e a mensagem nao pode dizer que e.
function motivoDaDeclaracao(hook, e) {
  if (e && e.code === "ERR_REQUIRE_ESM")
    return hook + ": leitor da declaracao nao carregou -- Node >= 22.12 exigido (" + process.version + ")\n";
  return hook + ": declaracao do projeto ilegivel -- " + String((e && e.message) || e) + "\n";
}

function saidasGeradasDoProjeto() {
  const { saidasGeradas } = require("../scripts/vega/declaracao.mjs");
  return new Map(saidasGeradas(raizDoProjeto()).map((s) => [s.caminho, s.comando]));
}

function normPath(p) {
  return String(p)
    .replace(/\\/g, "/")
    .replace(/^"|"$/g, "")
    .replace(/^'|'$/g, "")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

// O MESMO diretorio chega em tres grafias nesta maquina -- `/d/tmp/x` (MSYS, o que o tool
// Bash produz), `D:/tmp/x` (o que `git worktree list` devolve) e `D:\tmp\x`. Comparar sem
// canonicalizar faz o verificador dizer "nao e worktree registrada" para uma que e, e o
// bloqueio vira permanente por diferenca de grafia. Medido na primeira sonda deste patch.
// Token de REDIRECIONAMENTO nao e path. `2>&1`, `>saida.txt`, `&>log` sobrevivem ao filtro
// de `-` e entravam na lista de alvos: o verificador procurava uma worktree chamada `2>&1`,
// nao achava, e bloqueava. Efeito medido: o comando limpo passava e o MESMO comando com
// `2>&1 | tail -3` bloqueava -- a forma que qualquer um digita de verdade.
function isRedirect(tok) {
  return /^\d*[<>&]/.test(tok) || /[<>]/.test(tok);
}

function canonDir(p) {
  let v = normPath(p);
  const msys = v.match(/^\/([a-zA-Z])\/(.*)$/);
  if (msys) v = msys[1] + ":/" + msys[2];
  return v.toLowerCase().replace(/\/+$/, "");
}

// O blob que esta no disco AGORA existe na ponta de alguma ref? Se sim, descarta-lo nao
// perde nada -- e recuperavel por `git show <ref>:<path>`. Varre so as PONTAS (barato e
// suficiente para o caso real: trabalho movido para uma branch antes de limpar a arvore).
// Nao achar e resposta valida e BLOQUEIA -- falso-negativo aqui e seguro, o inverso nao.
function blobLivesOnSomeRef(rel, cwd) {
  let atual;
  try {
    atual = gitProbe(["hash-object", "--", rel], cwd).trim();
  } catch {
    return false;
  }
  if (!/^[0-9a-f]{40}$/.test(atual)) return false;
  let refs;
  try {
    refs = gitProbe(["for-each-ref", "--format=%(refname)"], cwd)
      .split("\n")
      .filter(Boolean);
  } catch {
    return false;
  }
  for (const ref of refs) {
    try {
      if (gitProbe(["rev-parse", ref + ":" + rel], cwd).trim() === atual)
        return true;
    } catch {
      /* path inexistente naquela ref -- segue */
    }
  }
  return false;
}

// Descarte por path: TODOS os paths nomeados tem de se qualificar. Path nao-enumeravel
// (`.`, `-f`, `$(cat lista)`) reprova por construcao -- sem saber o que sai, nao ha como
// provar que nada se perde.
function discardPathsPreserved(cmd, cwd, geradas) {
  const motivos = [];
  const subs = gitSubcommands(cmd).filter(
    ({ sub }) => sub === "checkout" || sub === "restore",
  );
  if (!subs.length) return null;
  for (const { args } of subs) {
    const i = args.indexOf("--");
    const paths = (i >= 0 ? args.slice(i + 1) : args).filter(
      (a) => !a.startsWith("-") && !isRedirect(a),
    );
    if (!paths.length) return null;
    for (const bruto of paths) {
      const rel = normPath(bruto);
      if (/[*?$`()[\]]/.test(rel)) return null; // glob ou substituicao -- inenumeravel
      if (geradas.has(rel)) {
        motivos.push(rel + " (gerado por `" + geradas.get(rel) + "`)");
        continue;
      }
      if (blobLivesOnSomeRef(rel, cwd)) {
        motivos.push(rel + " (blob vivo numa ponta de ref)");
        continue;
      }
      return null;
    }
  }
  return motivos.length ? motivos.join(" . ") : null;
}

// `worktree remove --force`: preservado quando a arvore alvo NAO tem mudanca pendente --
// o `--force` so e necessario por untracked/submodulo, e o que sai e um checkout.
// Diretorio ausente (registro orfao) tambem qualifica: nao ha conteudo para perder.
function worktreeRemoveClean(cmd, cwd) {
  const alvos = [];
  for (const { sub, args } of gitSubcommands(cmd)) {
    if (sub !== "worktree") continue;
    if (!args.includes("remove")) continue;
    const p = args.filter(
      (a) => !a.startsWith("-") && a !== "remove" && !isRedirect(a),
    );
    if (!p.length) return null;
    alvos.push(...p.map(normPath));
  }
  if (!alvos.length) return null;
  // Chave de comparacao (canonDir, lowercased) so serve p/ casar grafia entre `alvo`
  // (o que o comando digitou) e o que `git worktree list` devolve -- NUNCA p/ tocar
  // filesystem/git. Path real de cada worktree (case original) vem do proprio git:
  // e o unico que `fs.existsSync`/`git -C` podem confiar em FS case-sensitive (Linux
  // CI). Usar a chave minuscula ali fazia `existsSync` falhar toda vez que o path
  // tivesse maiuscula (mkdtemp gera; medido 5/5) -- "orfao" por engano, sempre
  // liberando o remove mesmo com arvore suja. Medido: 6 runs de CI vermelhas seguidas.
  let vivasPorChave;
  try {
    vivasPorChave = new Map(
      gitProbe(["worktree", "list", "--porcelain"], cwd)
        .split("\n")
        .filter((l) => l.startsWith("worktree "))
        .map((l) => l.slice(9))
        .map((p) => [canonDir(p), p]),
    );
  } catch {
    return null;
  }
  const motivos = [];
  for (const alvo of alvos) {
    const registrado = vivasPorChave.get(canonDir(alvo));
    if (registrado === undefined) return null; // nao e worktree registrada
    // registro orfao (diretorio sumiu) qualifica -- nao ha conteudo para perder. Mas
    // SO isso: `git -C` que falha por outro motivo (permissao, grafia, repo corrompido)
    // volta a bloquear. A primeira versao deste bloco tratava QUALQUER excecao como
    // "orfao" e liberava -- fail-OPEN, o defeito exato que este guard existe p/ nao ter.
    if (!fs.existsSync(registrado)) {
      motivos.push(alvo + " (diretorio ausente -- registro orfao)");
      continue;
    }
    let sujo;
    try {
      sujo = gitProbe(["-C", registrado, "status", "--porcelain"], cwd).trim();
    } catch {
      return null;
    }
    if (sujo) return null; // tem mudanca pendente: NAO e conteudo preservado
    motivos.push(alvo + " (arvore limpa)");
  }
  return motivos.length ? motivos.join(" . ") : null;
}

function isDiscardOp(op) {
  return op.startsWith("git checkout com descarte") || op.startsWith("git restore");
}

function contentPreserved(op, cmd, cwd, geradas) {
  if (op.startsWith("git worktree remove")) return worktreeRemoveClean(cmd, cwd);
  if (isDiscardOp(op)) return discardPathsPreserved(cmd, cwd, geradas);
  return null;
}

// Tier subagent — bloqueia tudo que muda HEAD/branch/histórico ou engaveta a árvore.
// Superfície permitida ao subagent: add/commit + read-only. Regexes com \b para não
// falso-positivar em `--merges`/`--branches` (sufixo quebra o word boundary).
// Entradas com função recebem o comando CRU e fazem a própria normalização.
// verbo em POSIÇÃO DE SUBCOMANDO — o caminho que `stash` e `restore` já faziam, agora
// estendido às 9 regras que casavam o verbo em qualquer ponto do segmento. A forma frouxa
// (`/\bgit\b[^\n;|&]*\breset\b/`) negava NAVEGAÇÃO comum e rotulava o bloqueio com um verbo
// que o agente não digitou: `git log -- .claude/hooks/read-reuse-reset.js` saía como "git
// reset (qualquer forma)", e `git merge-base --is-ancestor` como "git merge" (o hífen fecha
// o word boundary). Medido em `.claude/state/git-guard.log` (391 linhas, 45 dias): 28 de 349
// bloqueios (8,0%) tinham subcomando read-only. Por que passa de ruído: falha FECHADO
// exatamente sobre os comandos de VERIFICAR estado, empurrando a concluir sem conferir
// (§Não Especular), e o contorno medido (glob `rese[t].mjs`) ensina a driblar o guard.
// Débitos AE-HNHF-GITGUARD-VERBO-EM-PATHSPEC (média) e AE-HN31-F1-LOW-8 (baixa).
// A superfície BLOQUEADA não muda: quem digita o verbo continua barrado (probes abaixo).
const subagentSub = (name) => (cmd) =>
  gitSubcommands(cmd).some(({ sub }) => sub === name);

// `-d/-D/-m/-M` em posição de ARGUMENTO de `git branch`, em QUALQUER grafia. As formas
// longas (`--delete`, `--move`, `--force`) e os clusters (`-fD`, `-Df`) estavam fora e
// registradas como débito por um fix anterior de falso-positivo — "alargar a lista dentro
// de um fix é mudança de escopo". Débito fechado em 23/08/2026: o review adversarial
// mostrou que essas mesmas grafias escapavam TAMBÉM da lista global, então o buraco não
// era de escopo do tier, era do reconhecedor.
const subagentBranchFlag = (cmd) =>
  gitSubcommands(cmd).some(
    ({ sub, args }) =>
      sub === "branch" &&
      args.some(
        (a) =>
          /^-[a-zA-Z]*[dDmM][a-zA-Z]*$/.test(a) ||
          /^--(delete|move|force)$/.test(a),
      ),
  );

const SUBAGENT_BLOCKED = [
  [
    subagentStash,
    "git stash (`stash list|show` read-only seguem liberados)",
  ],
  [subagentAlias, "git alias apontando para operação bloqueada"],
  [subagentConfigAlias, "git config de alias (escape persistente)"],
  [subagentOpaque, "subcomando git ilegível (substituição de comando)"],
  [subagentSub("reset"), "git reset (qualquer forma)"],
  [subagentSub("checkout"), "git checkout"],
  [subagentSub("switch"), "git switch"],
  [subagentSub("merge"), "git merge"],
  [subagentSub("rebase"), "git rebase"],
  [subagentSub("cherry-pick"), "git cherry-pick"],
  [subagentSub("push"), "git push"],
  [subagentSub("worktree"), "git worktree"],
  [subagentBranchFlag, "git branch -d/-D/-m"],
];

// remove literais quoted — `git commit -m "remove git reset --hard do doc"` não dispara.
function stripQuoted(cmd) {
  return cmd.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function readMode(cwd) {
  try {
    const p = path.join(cwd, ".claude", "state", "git-guard-mode");
    if (fs.existsSync(p)) {
      const s = fs.readFileSync(p, "utf8").trim().toLowerCase();
      if (s === "hard" || s === "soft" || s === "off") return s;
    }
  } catch {}
  return "hard";
}

// separado do consumo para que uma autorização VÁLIDA porém RECUSADA (tier subagent)
// ainda apareça no log — tentativa de auto-autorização é sinal, não silêncio.
function findAllow(cwd, cmd) {
  try {
    const p = path.join(cwd, ".claude", "state", "git-guard-allow");
    if (!fs.existsSync(p)) return null;
    // `#` é comentário (0.1.4). Sem isto o arquivo não consegue se documentar: TODA linha
    // não-vazia é candidata a substring de autorização, então um cabeçalho explicando o
    // formato seria ele próprio um padrão armado. Comentário nunca é consumido, então
    // também não vira resíduo — que é a doença medida deste arquivo (14 linhas, 0 consumidas).
    const line = fs
      .readFileSync(p, "utf8")
      .split("\n")
      .find((l) => {
        const t = l.trim();
        return t.length > 0 && !t.startsWith("#") && cmd.includes(t);
      });
    return line === undefined ? null : { p, line: line.trim() };
  } catch {
    return null;
  }
}

// mkdir é atômico em todo FS relevante — serve de mutex entre invocações concorrentes do
// hook. Sem isto, "uma linha = uma execução" é falso: duas invocações paralelas leem o
// mesmo arquivo e as duas saem com exit 0 (medido: 2 em 10 rodadas).
function withAllowLock(p, fn) {
  const lock = p + ".lock";
  const sleep = () => {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    } catch {}
  };
  for (let i = 0; i < 20; i++) {
    try {
      fs.mkdirSync(lock);
    } catch {
      // lock órfão (crash entre mkdir e rmdir) não pode travar o escape p/ sempre.
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 5000) fs.rmdirSync(lock);
      } catch {}
      sleep();
      continue;
    }
    try {
      return fn();
    } finally {
      try {
        fs.rmdirSync(lock);
      } catch {}
    }
  }
  return false; // não conseguiu o lock → fail-closed (bloqueia)
}

// relê DENTRO do lock: quem achou a linha pode não ser quem a consome.
function consumeAllow(allow) {
  return withAllowLock(allow.p, () => {
    try {
      const lines = fs.readFileSync(allow.p, "utf8").split("\n");
      const idx = lines.findIndex((l) => l.trim() === allow.line);
      if (idx === -1) return false;
      lines.splice(idx, 1);
      fs.writeFileSync(allow.p, lines.join("\n"));
      return true;
    } catch {
      return false;
    }
  });
}

function logEvent(cwd, payload) {
  try {
    const dir = path.join(cwd, ".claude", "state");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "git-guard.log"),
      JSON.stringify(payload) + "\n",
    );
  } catch (e) {
    // em mode=soft o log é a ÚNICA saída do guard: engolir a falha aqui deixa o guard
    // 100% inerte E 100% silencioso.
    try {
      process.stderr.write("git-guard: falha ao gravar log — " + String(e) + "\n");
    } catch {}
  }
}

let raw = "";
// sem encoding explícito um chunk pode partir um caractere UTF-8 no meio: o comando
// chega corrompido e tanto o scan quanto o log passam a mentir.
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("error", () => process.exit(0));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    try {
      process.stderr.write(
        "git-guard: stdin ilegível — comando liberado por fallback.\n",
      );
    } catch {}
    process.exit(0);
  }
  try {
    if (input.tool_name !== "Bash" && input.tool_name !== "PowerShell")
      process.exit(0);
    const cmd = (input.tool_input && input.tool_input.command) || "";
    if (typeof cmd !== "string") process.exit(0);
    if (!cmd.includes("git")) process.exit(0);

    const isSubagent = Boolean(input.agent_id || input.agent_type);
    const cwd = input.cwd || process.cwd();
    const mode = readMode(cwd);
    if (mode === "off") process.exit(0);

    const scan = stripQuoted(cmd);
    // regex casa no scan (quoted removido); função recebe o comando cru e normaliza sozinha.
    const match = ([m]) => (typeof m === "function" ? m(cmd) : m.test(scan));
    let hit = null;
    let tier = "global";
    if (isSubagent) {
      // subagent-first: superset mais restritivo vence — log/mensagem com tier correto.
      hit = SUBAGENT_BLOCKED.find(match);
      if (hit) tier = "subagent";
      else hit = BLOCKED.find(match);
    } else {
      hit = BLOCKED.find(match);
    }
    if (!hit) process.exit(0);

    // excecao de conteudo preservado -- ANTES do escape one-shot, para nao queimar uma
    // linha de allow num comando que passaria sozinho. Sessao main apenas; qualquer
    // excecao do verificador cai em `null` e o bloqueio segue.
    if (!isSubagent) {
      // A declaracao e lida FORA do try do verificador: declaracao presente e quebrada nao
      // pode virar "nao preservado" calado -- sai com o motivo no stderr e exit 2.
      let geradas = new Map();
      if (isDiscardOp(hit[1])) {
        try {
          geradas = saidasGeradasDoProjeto();
        } catch (e) {
          logEvent(cwd, {
            ts: new Date().toISOString(),
            action: "declaracao-ilegivel",
            op: hit[1],
            err: String((e && e.message) || e),
            cmd,
          });
          process.stderr.write(motivoDaDeclaracao("git-guard", e));
          // soft e log-only por contrato: o aviso sai, o comando passa.
          if (mode === "soft") process.exit(0);
          process.stderr.write(
            "Conserte a declaracao (.vega/declaracao.json); ate la o descarte segue bloqueado.\n",
          );
          process.exit(2);
        }
      }
      let preservado = null;
      try {
        preservado = contentPreserved(hit[1], cmd, cwd, geradas);
      } catch {
        preservado = null;
      }
      if (preservado) {
        logEvent(cwd, {
          ts: new Date().toISOString(),
          action: "auto-allowed-content-preserved",
          op: hit[1],
          tier,
          motivo: preservado,
          cmd,
        });
        process.exit(0);
      }
    }

    // escape one-shot é da SESSÃO MAIN. Subagent tem Bash: se pudesse consumir a linha,
    // escreveria a própria autorização e o tier viraria decoração.
    // A linha casada é QUEIMADA mesmo quando recusada: deixá-la viva armaria uma
    // autorização que a sessão main consumiria depois, sem quem a escreveu saber.
    let allowNote;
    const allow = findAllow(cwd, cmd);
    if (allow) {
      const burned = consumeAllow(allow);
      if (!burned) allowNote = "allow-consume-failed";
      else if (isSubagent) allowNote = "allow-burned-subagent";
      else {
        logEvent(cwd, {
          ts: new Date().toISOString(),
          action: "allowed-one-shot",
          op: hit[1],
          tier,
          cmd,
        });
        process.exit(0);
      }
    }

    logEvent(cwd, {
      ts: new Date().toISOString(),
      action: mode === "hard" ? "blocked" : "logged",
      op: hit[1],
      tier,
      agent_type: input.agent_type,
      allow: allowNote,
      cmd,
    });
    if (mode === "soft") process.exit(0);

    const msg =
      tier === "subagent"
        ? [
            "GIT-GUARD block — TIER SUBAGENT (contexto subagent detectado):",
            "  operação: " + hit[1],
            "",
            "Subagents não mudam HEAD/branch/histórico nem engavetam a árvore de trabalho",
            "(o working tree pode ser do controller, não seu).",
            "Superfície permitida: git add/commit + read-only (log/show/diff/status, stash list|show).",
            "O escape one-shot NÃO vale aqui — autorização é da sessão principal.",
            "NÃO tente alternativa nem workaround — PARE e retorne ao controller",
            "relatando a necessidade como BLOCKED (o controller executa se couber).",
          ]
        : [
            "GIT-GUARD block (camada ENFORCED para comandos git destrutivos):",
            "  operação: " + hit[1],
            "",
            "Comandos git destrutivos exigem autorização explícita do humano.",
            "Subagents: NUNCA executar — retorne ao controller relatando a necessidade.",
            "Autorização one-shot: echo '<substring do comando>' >> .claude/state/git-guard-allow",
            "git read-only (log/show/diff/status) passa direto.",
          ];
    if (allowNote === "allow-consume-failed")
      msg.push(
        "",
        "AVISO: havia autorização one-shot casando este comando, mas não foi possível",
        "consumi-la (.claude/state gravável?). Bloqueado para não quebrar o uso único.",
      );
    if (allowNote === "allow-burned-subagent")
      msg.push(
        "",
        "AVISO: havia uma linha de autorização casando este comando — foi QUEIMADA e o",
        "comando segue bloqueado. Autorização é consumida pela sessão principal.",
      );
    process.stderr.write(msg.join("\n") + "\n");
    process.exit(2);
  } catch (e) {
    // o fallback é ABERTO por contrato (bug do guard não pode travar o loop), mas nunca
    // SILENCIOSO: sem isto, um TypeError no tokenizador desliga TODAS as regras — a lista
    // catastrófica inclusive — com exit 0 e zero rastro.
    try {
      logEvent((input && input.cwd) || process.cwd(), {
        ts: new Date().toISOString(),
        action: "guard-error",
        err: String((e && e.stack) || e),
      });
      process.stderr.write(
        "git-guard: erro interno — comando liberado por fallback. " + String(e) + "\n",
      );
    } catch {}
    process.exit(0);
  }
});
