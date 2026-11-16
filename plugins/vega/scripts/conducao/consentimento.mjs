/**
 * consentimento.mjs — os casos que o operador já decidiu, num lugar só (VEGA-37 T19, D-VEGA37-20).
 *
 * Um caso resolvido é uma pergunta que a condução NÃO faz porque o operador já
 * mandou não fazê-la. Cada um vira uma marca no git — commit vazio no ramo com
 * subject `Conducao: <fase> consentimento <caso>` — com os campos que a
 * pergunta registrada do banco vai precisar (VEGA-19): ciclo, fase, caso, quem
 * respondeu, quando e o texto literal do sim de origem. Por começar com
 * `Conducao: `, o `conferirFaixa` do `trazer` recusa essa marca vinda de
 * operária, como recusa toda marca da condução.
 *
 * Dono único: este módulo é o único que grava (`gravarConsentimento`) e o único
 * que lê (`lerConsentimentos`, `consentimentosDoLog`) essas marcas; `marcas.mjs`
 * não as conhece de propósito. As regras (`regras.mjs`) e a política do
 * `trazer` (`verbos.mjs`) chamam só as funções puras daqui — `casoResolvido`,
 * `seguePorRepeticao`, `sensivelAditivaNaOrdem`, `consentidoNoTrazer`,
 * `simDaPublicacaoDoCiclo` — e
 * devolvem o registro do caso junto com a ação; quem grava é a casca de I/O.
 *
 * Os oito casos (D-VEGA37-20, D-VEGA37-22, D-VEGA37-27, D-VEGA37-52, §2.2#4 do canonico):
 *   já cobertos pelo script, que passam a registrar —
 *     `heranca-entre-fases`           (`regraAutorizarFase`, sim do ciclo);
 *     `replano-sem-mudanca-de-classe` (`regraReplano`);
 *     `tela-dos-steps`                (`motivosParaPerguntar`, segmento dos Steps);
 *   novos —
 *     `sensivel-aditiva-na-ordem`      task sensível nova, na ordem do plano, dentro da fase autorizada;
 *     `pergunta-repetida`              mesmo tipo e mesmo motivo já respondidos na fase;
 *     `instrucao-declarada-em-outputs` superfície de instrução (ou hook) que é arquivo declarado em Outputs;
 *     `teste-que-acompanha-o-codigo`   teste ou contrato do motor fora dos Outputs que acompanha o código declarado;
 *     `publicacao-do-ciclo`            o sim da primeira publicação do ciclo, que cobre as seguintes dele.
 * Mais o registro de origem, `resposta-do-operador`: o sim que a pergunta
 * repetida reaproveita. Tipo novo sobe uma vez; publicação nunca entra na
 * repetição: tem o caso próprio.
 *
 * PHI: o texto literal do sim passa pelo gate do projeto antes do commit
 * (`phi` injetado — na Sistoli, `recusarPhiDoConsentimento` do gate de PHI do
 * projeto, pelo adaptador). Sem gate, a
 * escrita recusa (fail-closed): o núcleo é neutro de projeto e não sabe varrer
 * PHI sozinho.
 */
import { git as rodarGit } from "./git-exec.mjs";
import { casaAlgum, ErroPlano } from "./ler-plano.mjs";
import { trailers as lerTrailers } from "./marcas.mjs";

/** Os casos que seguem sem pergunta, mais o registro de origem do sim (`resposta-do-operador`). */
export const CASOS = Object.freeze({
  herancaEntreFases: "heranca-entre-fases",
  replanoSemMudancaDeClasse: "replano-sem-mudanca-de-classe",
  telaDosSteps: "tela-dos-steps",
  sensivelAditivaNaOrdem: "sensivel-aditiva-na-ordem",
  perguntaRepetida: "pergunta-repetida",
  instrucaoDeclaradaEmOutputs: "instrucao-declarada-em-outputs",
  testeQueAcompanhaOCodigo: "teste-que-acompanha-o-codigo",
  publicacaoDoCiclo: "publicacao-do-ciclo",
  respostaDoOperador: "resposta-do-operador",
});
const NOMES_DOS_CASOS = new Set(Object.values(CASOS));

/**
 * Motivos de integridade do `trazer` (`verbos.conferirFaixa`, `registrarHeranca`):
 * nunca seguem por repetição — o sim de ontem a uma faixa adulterada não
 * aprova a de hoje (Steps da T19).
 */
export const MOTIVOS_DE_INTEGRIDADE = Object.freeze(["faixa-com-marca-da-conducao", "faixa-fora-do-marcador", "faixa-com-merge", "plano-divergente"]);

/**
 * Tipos de pergunta que nunca seguem por repetição: a publicação não segue
 * por repetição porque tem o caso próprio (`publicacao-do-ciclo`, D-VEGA37-52).
 */
export const TIPOS_QUE_NUNCA_REPETEM = Object.freeze(["publicacao", "publicar", "task-sensivel"]);

/**
 * O que, mesmo declarado em Outputs, segue perguntando no `trazer`
 * (D-VEGA37-22, D-VEGA37-27): o que, vivo no ramo, decide efeito fora do
 * repositório. Fonte: as exclusões escritas no ruling — `settings*.json`,
 * dependência nova, script de instalação, config de guard sob `state/`, e o
 * arquivo lido por hook que decide `archive_session`/`send_message`/
 * `create_session` (`sessao-operaria.js`, lido por `operaria-alcance-guard.js`,
 * `conducao-nonce-guard.js` e `operaria-stop-guard.js`). Muda quando o ruling
 * mudar a lista; o glob de `state/` cobre a pasta inteira (inclusive o
 * `vigia-de-fora-mode`, que o ruling só sobe com `ligado` — ler o valor pede
 * o blob, e a leitura conservadora pergunta sempre).
 */
/**
 * Despachantes de guard (D-VEGA37-42): comando registrado num `hooks.json` ou
 * `settings*.json` que roda outros guards pelo nome, sem ser ele mesmo um guard
 * — o do motor (`hooks-do-motor.mjs`, pelo qual o registro do host roda o guard
 * do git) e os executores dos outros hosts (`run-existing-hook.mjs`,
 * `run-post-hook.mjs` sob a pasta de hooks do host, que também decidem quais
 * guards fecham na falha). Fonte: os comandos dos registros; o caso "todo
 * registro de hook e todo despachante de guard seguem perguntando" reprova
 * quando um registro passa a despachar por um comando fora desta lista.
 */
export const DESPACHANTES_DE_GUARD = Object.freeze([
  "**/motor/hooks-do-motor.mjs",
  ".*/hooks/run-existing-hook.mjs",
  ".*/hooks/run-post-hook.mjs",
]);

export const SEGUEM_PERGUNTANDO = Object.freeze([
  "**/settings*.json",
  "**/package.json",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-workspace.yaml",
  "**/instalar-*.sh",
  "**/install*.sh",
  ".*/state/**",
  "**/hooks/lib/sessao-operaria.js",
  // D-VEGA37-40: o que decide dependência, instalação ou ferramenta sobe ao
  // operador (D-VEGA37-29) — `.npmrc` (`script-shell`) e `.pnpmfile.cjs`
  // executam código na instalação; `.mcp.json` decide ferramenta.
  "**/.npmrc",
  "**/.pnpmfile.cjs",
  "**/.mcp.json",
  // D-VEGA37-41: o que liga, desliga ou registra guard, por diretório e papel,
  // nunca por nome de guard — as libs que dão modo aos guards, o registro dos
  // hooks (`hooks.json`; `settings*.json` e `state/` já acima), o hook do git,
  // os workflows do CI e a declaração do projeto à fábrica. O corpo de cada
  // hook e guard (`*-guard.js`, `*-gate.js`, …) fica com quem conduz, que
  // confere o diff (decisão 16a de Leo).
  "**/hooks/lib/read-mode-file.js",
  "**/hooks/lib/modo-do-guarda.js",
  "**/hooks/lib/publicacao-liberacao-ciclo.mjs",
  ".husky/**",
  ".github/workflows/**",
  ".vega/**",
  // D-VEGA37-42: a 26b por papel até o fim — todo registro de hook do
  // repositório (`**/hooks.json`, de todo host e do plugin; o
  // `settings*.json` já acima), os despachantes de guard, o baseline do
  // gitleaks (`.github/scripts/`), o runner do CI, o dono do código, o passo
  // que cobra o carimbo de revisão, a declaração antiga do projeto (`.altair/`)
  // e todo arquivo de modo de guard (`*-mode`) em qualquer lugar. O motor de
  // consentimento (`conducao/*.mjs`) é corpo e fica com quem conduz (16a).
  "**/hooks.json",
  ...DESPACHANTES_DE_GUARD,
  ".github/scripts/**",
  ".github/runner/**",
  ".github/CODEOWNERS",
  ".*/scripts/review-carimbo-ci.mjs",
  ".altair/**",
  "**/*-mode",
  // D-VEGA37-44: a configuração e o registro de hook de cada host, por glob
  // neutro — a configuração do host (`.<host>/config.toml`), o registro com
  // nome próprio sob a pasta de hooks do host (`.<host>/hooks/<nome>.json`),
  // o `mcp.json` sem ponto (o `.mcp.json` já acima) e a lista do que o
  // gitleaks ignora. Até a T42 cada host declarar os seus no adaptador.
  ".*/config.toml",
  ".*/hooks/*.json",
  "**/mcp.json",
  "**/.gitleaksignore",
]);

/**
 * O que a pergunta repetida nunca dispensa (D-VEGA37-37): hoje é o próprio
 * `SEGUEM_PERGUNTANDO` — `.husky/` entrou nele por D-VEGA37-41 e `*-mode` fora
 * de `state/` por D-VEGA37-42. Fica um nome separado para a repetição poder
 * crescer sem mudar o que `acompanhaOCodigo` e `consentidoNoTrazer` liberam.
 */
export const NUNCA_REPETEM_POR_CAMINHO = Object.freeze([...SEGUEM_PERGUNTANDO]);

/**
 * Motivos do `trazer` que a pergunta repetida nunca dispensa (D-VEGA37-40),
 * como os de integridade: o canonico do ciclo é o estado vivo que só a
 * maestra grava, e caminho clínico nunca segue por repetição. Separado de
 * `MOTIVOS_DE_INTEGRIDADE` para não mudar quem o lê por outro critério.
 */
export const MOTIVOS_QUE_NUNCA_REPETEM = Object.freeze(["canonico-do-ciclo", "caminho-clinico-fora-dos-outputs"]);

/**
 * Teste e contrato do motor (D-VEGA37-27): `__tests__/*.test.mjs` do motor e
 * dos hooks e `contrato-atual.md`. Fonte: o texto do ruling, item 16 da
 * condução da F1 (percalços T8–T11).
 */
export const TESTES_E_CONTRATOS_DO_MOTOR = Object.freeze(["**/__tests__/*.test.mjs", "**/contrato-atual.md"]);

export const SUBJECT_RE = /^Conducao: (F\d{1,2}) consentimento ([a-z][a-z0-9-]*)$/;
const FASE_RE = /^F\d{1,2}$/;
const TRAILER = Object.freeze({
  caso: "Conducao-Consentimento",
  ciclo: "Conducao-Ciclo-Conduzido",
  quem: "Conducao-Quem",
  quando: "Conducao-Quando",
  task: "Conducao-Task",
  tipo: "Conducao-Tipo",
  motivo: "Conducao-Motivo",
  origem: "Conducao-Origem-Sim",
  caminhos: "Conducao-Caminhos",
});

function texto(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * O registro de um caso, conferido: `ciclo`, `fase`, `caso`, `quem`, `quando`
 * (ISO 8601 UTC) e `sim` (texto literal do sim de origem) obrigatórios;
 * `task`, `tipo`, `motivo`, `origem` (sha da marca com o sim) e `caminhos`
 * opcionais. Puro: as regras o devolvem junto com a ação.
 */
export function casoResolvido({ ciclo, fase, caso, quem, quando, sim, task = null, tipo = null, motivo = null, origem = null, caminhos = [] }) {
  if (!texto(ciclo)) throw new ErroPlano("uso", "consentimento sem ciclo");
  if (!FASE_RE.test(fase ?? "")) throw new ErroPlano("uso", `consentimento com fase inválida: ${JSON.stringify(fase ?? null)}`);
  if (!NOMES_DOS_CASOS.has(caso)) throw new ErroPlano("uso", `caso de consentimento desconhecido: ${JSON.stringify(caso ?? null)}`);
  if (!texto(quem)) throw new ErroPlano("uso", "consentimento sem quem respondeu");
  if (!texto(quando) || Number.isNaN(Date.parse(quando))) throw new ErroPlano("uso", `consentimento com quando inválido: ${JSON.stringify(quando ?? null)}`);
  if (!texto(sim)) throw new ErroPlano("sim-ausente", "consentimento sem o texto literal do sim de origem");
  for (const [k, v] of Object.entries({ task, tipo, motivo, origem }))
    if (v !== null && !/^[A-Za-z0-9._:/-]+$/.test(v)) throw new ErroPlano("uso", `consentimento com ${k} fora da forma de token: ${JSON.stringify(v)}`);
  if (!Array.isArray(caminhos) || caminhos.some((c) => typeof c !== "string" || /[\s,]/.test(c)))
    throw new ErroPlano("uso", "consentimento com caminhos fora da forma (lista de caminhos sem espaço nem vírgula)");
  return Object.freeze({ ciclo: ciclo.trim(), fase, caso, quem: quem.trim(), quando: new Date(quando).toISOString(), sim: sim.trim(), task, tipo, motivo, origem, caminhos: Object.freeze([...caminhos]) });
}

/** A mensagem do commit da marca: subject, o sim literal no corpo, os campos em trailers. */
export function mensagemDoCaso(r) {
  const tr = [
    [TRAILER.caso, r.caso],
    [TRAILER.ciclo, r.ciclo],
    [TRAILER.quem, r.quem],
    [TRAILER.quando, r.quando],
    [TRAILER.task, r.task],
    [TRAILER.tipo, r.tipo],
    [TRAILER.motivo, r.motivo],
    [TRAILER.origem, r.origem],
    [TRAILER.caminhos, r.caminhos.length ? r.caminhos.join(",") : null],
  ].filter(([, v]) => v !== null && v !== undefined);
  return { subject: `Conducao: ${r.fase} consentimento ${r.caso}`, corpo: r.sim, trailers: tr.map(([k, v]) => `${k}: ${v}`).join("\n") };
}

/**
 * Grava o caso como commit vazio no ramo. `phi(entrada)` é o gate do projeto,
 * com a forma `{ recusar, mensagem }` de `recusarPhi`; recebe
 * `{ ciclo, fase, task, motivo, corpo }` (a escrita `consentimento` de
 * `CAMPOS_POR_ESCRITA`). `cerca()` é a cerca da posse da casca de I/O
 * (`exigirPosse`). Sem um dos dois ⇒ recusa, nada gravado. Devolve
 * `{ sha, registro }`.
 */
export function gravarConsentimento({ repo, registro, phi, cerca, rodar = rodarGit }) {
  const r = casoResolvido(registro);
  if (typeof phi !== "function") throw new ErroPlano("phi-sem-gate", "consentimento sem gate de PHI do projeto: nada gravado (fail-closed)");
  if (typeof cerca !== "function") throw new ErroPlano("sem-cerca", "consentimento sem a cerca da posse: nada gravado");
  let veredito;
  try {
    veredito = phi({ ciclo: r.ciclo, fase: r.fase, task: r.task, motivo: r.motivo ?? r.caso, corpo: r.sim });
  } catch {
    veredito = { recusar: true, mensagem: "gate de PHI falhou · fail-closed" };
  }
  if (!veredito || typeof veredito.recusar !== "boolean")
    throw new ErroPlano("phi-recusado", "gate de PHI devolveu forma desconhecida · fail-closed");
  if (veredito.recusar) throw new ErroPlano("phi-recusado", `sim recusado pelo gate de PHI: ${veredito.mensagem ?? "sem detalhe"}`);
  cerca();
  const m = mensagemDoCaso(r);
  rodar(repo, ["commit", "-q", "--allow-empty", "-m", m.subject, "-m", m.corpo, "-m", m.trailers]);
  return { sha: rodar(repo, ["rev-parse", "HEAD"]), registro: r };
}

const SEP_CAMPO = "\x1f";
const SEP_REG = "\x1e";

/** O corpo sem o parágrafo final de trailers (o sim literal). */
export function simDoCorpo(corpo) {
  const paragrafos = corpo.replace(/\s+$/, "").split(/\n\s*\n/);
  if (paragrafos.length > 1 && paragrafos.at(-1).split("\n").every((l) => /^[A-Za-z0-9-]+:\s/.test(l.trim()))) paragrafos.pop();
  return paragrafos.join("\n\n").trim();
}

/**
 * Os casos de uma saída de `git log --format=%H%x1f%s%x1f%b%x1e`, na ordem da
 * saída. Só vale a marca cujo trailer `Conducao-Consentimento` repete o caso do
 * subject e cujos campos conferem (`casoResolvido`); o resto é ignorado.
 */
export function consentimentosDoLog(bruto) {
  const out = [];
  for (const reg of bruto.split(SEP_REG)) {
    const [sha, subject, corpo = ""] = reg.replace(/^\n/, "").split(SEP_CAMPO);
    if (!sha || !subject) continue;
    const m = SUBJECT_RE.exec(subject);
    if (!m) continue;
    const tr = lerTrailers(corpo);
    if (tr[TRAILER.caso] !== m[2]) continue;
    try {
      const r = casoResolvido({
        ciclo: tr[TRAILER.ciclo],
        fase: m[1],
        caso: m[2],
        quem: tr[TRAILER.quem],
        quando: tr[TRAILER.quando],
        sim: simDoCorpo(corpo),
        task: tr[TRAILER.task] ?? null,
        tipo: tr[TRAILER.tipo] ?? null,
        motivo: tr[TRAILER.motivo] ?? null,
        origem: tr[TRAILER.origem] ?? null,
        caminhos: tr[TRAILER.caminhos] ? tr[TRAILER.caminhos].split(",") : [],
      });
      out.push({ sha: sha.trim(), ...r });
    } catch {
      // marca malformada não vale como consentimento
    }
  }
  return out;
}

/** Os casos registrados no histórico de `ref`, em ordem cronológica, do ciclo `ciclo` (todos, sem ele). */
export function lerConsentimentos(repo, { ref = "HEAD", ciclo = null, rodar = rodarGit } = {}) {
  const bruto = rodar(repo, ["log", "--reverse", "--topo-order", "--extended-regexp", "--grep=^Conducao: F[0-9]{1,2} consentimento ", "--format=%H%x1f%s%x1f%b%x1e", ref]);
  const todos = consentimentosDoLog(bruto);
  return ciclo ? todos.filter((c) => c.ciclo === ciclo) : todos;
}

// ── os casos, puros ─────────────────────────────────────────────────────────

/**
 * A pergunta do mesmo tipo e mesmo motivo já respondida na fase: o registro
 * `resposta-do-operador` (ou um `pergunta-repetida` que já o reaproveitou)
 * que a cobre, ou null. Motivo de integridade, tipo de publicação e pergunta
 * de tipo novo (nenhuma resposta na fase) ⇒ null: sobe ao operador; o mesmo
 * para `canonico-do-ciclo` e `caminho-clinico-fora-dos-outputs`
 * (`MOTIVOS_QUE_NUNCA_REPETEM`, D-VEGA37-40).
 * Caminho da pergunta que segue perguntando (`NUNCA_REPETEM_POR_CAMINHO`) ⇒
 * null, mesmo com resposta anterior do mesmo tipo e motivo (D-VEGA37-37).
 * Sem `caminhos` (ausente ou não-lista) ⇒ null: sem a lista não há como
 * conferir o caminho, e a pergunta sobe em vez de repetir (D-VEGA37-38).
 * Caminho que casa as instruções de sessão que o adaptador declara
 * (`instrucoes`, `sessao.instrucoes`) ⇒ null: sempre pergunta (D-VEGA37-45).
 */
export function seguePorRepeticao({ consentimentos = [], ciclo, fase, tipo, motivo, caminhos, instrucoes = [] }) {
  if (!tipo || !motivo) return null;
  if (!Array.isArray(caminhos)) return null;
  if (MOTIVOS_DE_INTEGRIDADE.includes(motivo) || MOTIVOS_QUE_NUNCA_REPETEM.includes(motivo)) return null;
  if (caminhos.some((x) => casaAlgum(x, NUNCA_REPETEM_POR_CAMINHO))) return null;
  if (caminhos.some((x) => casaAlgum(x, instrucoes))) return null;
  if (TIPOS_QUE_NUNCA_REPETEM.includes(tipo) || /publica/.test(motivo)) return null;
  return (
    consentimentos.findLast(
      (c) => c.ciclo === ciclo && c.fase === fase && c.tipo === tipo && c.motivo === motivo && (c.caso === CASOS.respostaDoOperador || c.caso === CASOS.perguntaRepetida),
    ) ?? null
  );
}

/**
 * Task sensível nova adicionada na ordem do plano, dentro da fase autorizada:
 * nasceu no plano novo (não existia no congelado), é sensível só por caminho
 * clínico (publicação nunca entra), está na fase `faseId`, e as tasks que já
 * existiam na fase seguem na mesma ordem relativa. `de`/`para` são planos de
 * `lerPlano`; `mudanca` é uma entrada de `mudancasQuePerguntam`.
 */
export function sensivelAditivaNaOrdem({ de, para, faseId, mudanca }) {
  if (!mudanca || mudanca.de !== null || mudanca.para !== "sensivel") return false;
  const t = para?.porId?.get(mudanca.task);
  if (!t || de?.porId?.has(mudanca.task)) return false;
  if (t.fase !== faseId || (t.publicacao ?? []).length) return false;
  const faseDe = de?.fases?.find((f) => f.id === faseId);
  const fasePara = para?.fases?.find((f) => f.id === faseId);
  if (!faseDe || !fasePara || !fasePara.tasks.includes(mudanca.task)) return false;
  const antigasNaNova = fasePara.tasks.filter((id) => faseDe.tasks.includes(id));
  return JSON.stringify(antigasNaNova) === JSON.stringify(faseDe.tasks.filter((id) => fasePara.tasks.includes(id)));
}

function diretorio(c) {
  const i = c.lastIndexOf("/");
  return i < 0 ? "" : c.slice(0, i);
}

/**
 * Teste ou contrato do motor fora dos Outputs que acompanha código declarado
 * (D-VEGA37-27): `<dir>/__tests__/<x>.test.mjs` com algum Output de código
 * (não teste) em `<dir>/`; `contrato-atual.md` com algum Output de código no
 * mesmo diretório. O que segue perguntando (`SEGUEM_PERGUNTANDO`) nunca acompanha.
 */
export function acompanhaOCodigo(caminho, outputs) {
  if (outputs.includes(caminho) || casaAlgum(caminho, SEGUEM_PERGUNTANDO)) return false;
  if (!casaAlgum(caminho, TESTES_E_CONTRATOS_DO_MOTOR)) return false;
  const codigo = outputs.filter((o) => !casaAlgum(o, TESTES_E_CONTRATOS_DO_MOTOR) && !o.endsWith("/") && !casaAlgum(o, SEGUEM_PERGUNTANDO));
  const dir = diretorio(caminho);
  const raiz = /\/__tests__$/.test(dir) ? dir.slice(0, -"/__tests__".length) : dir;
  return codigo.some((o) => diretorio(o) === raiz || diretorio(o).startsWith(`${raiz}/`));
}

/**
 * O que o `trazer` deixa de perguntar por consentimento, dado um motivo
 * (`alcance-dos-hooks` ou `superficie-de-instrucao`) e seus caminhos:
 *   — caminho que é ARQUIVO declarado em Outputs e não está em
 *     `SEGUEM_PERGUNTANDO` ⇒ `instrucao-declarada-em-outputs` (D-VEGA37-22);
 *   — teste ou contrato do motor que acompanha o código declarado ⇒
 *     `teste-que-acompanha-o-codigo` (D-VEGA37-27).
 * Caminho que casa as instruções de sessão que o adaptador declara
 * (`instrucoes`, `sessao.instrucoes`) nunca é consentido: fica em `restantes`,
 * mesmo declarado (D-VEGA37-45). A regra lê o campo, nunca uma lista de nomes.
 * Devolve `{ restantes, consentidos: [{ caso, motivo, caminhos }] }`.
 */
export function consentidoNoTrazer({ motivo, caminhos, outputs, instrucoes = [] }) {
  const declarados = [];
  const acompanham = [];
  const restantes = [];
  for (const c of caminhos) {
    if (casaAlgum(c, instrucoes)) restantes.push(c);
    else if (outputs.includes(c) && !casaAlgum(c, SEGUEM_PERGUNTANDO)) declarados.push(c);
    else if (acompanhaOCodigo(c, outputs)) acompanham.push(c);
    else restantes.push(c);
  }
  const consentidos = [];
  if (declarados.length) consentidos.push({ caso: CASOS.instrucaoDeclaradaEmOutputs, motivo, caminhos: declarados });
  if (acompanham.length) consentidos.push({ caso: CASOS.testeQueAcompanhaOCodigo, motivo, caminhos: acompanham });
  return { restantes, consentidos };
}

/**
 * O pedido de registro que uma regra devolve junto com a ação (`consentimento`
 * da ação): o caso, a fase e o sha da marca com o sim de origem (`origem`).
 * A regra é pura e não lê o corpo do commit; quem grava completa `quem`,
 * `quando` e o `sim` literal lendo a marca `origem`, e passa por
 * `gravarConsentimento`.
 */
export function pedidoDeCaso({ caso, fase, origem, task = null, motivo = null, tasks = [] }) {
  if (!NOMES_DOS_CASOS.has(caso)) throw new ErroPlano("uso", `caso de consentimento desconhecido: ${JSON.stringify(caso ?? null)}`);
  if (!FASE_RE.test(fase ?? "")) throw new ErroPlano("uso", `pedido de consentimento com fase inválida: ${JSON.stringify(fase ?? null)}`);
  return Object.freeze({ caso, fase, origem: origem ?? null, task, motivo, tasks: Object.freeze([...tasks]) });
}

// ── o sim da publicação do ciclo (T47, D-VEGA37-52) ─────────────────────────

const PREFIXO_DA_PUBLICADA = "Publicada com o sim do operador: ";

/**
 * O registro `publicacao-do-ciclo` que cobre a publicação no ciclo `ciclo`: o
 * primeiro gravado nele, ou null. Vale só no ciclo em que foi gravado; nasce
 * só da conferência da primeira publicação, nunca de texto de mensagem. Puro.
 */
export function simDaPublicacaoDoCiclo({ consentimentos = [], ciclo }) {
  return consentimentos.find((c) => c.caso === CASOS.publicacaoDoCiclo && c.ciclo === ciclo) ?? null;
}

/**
 * O gate irmão do de PHI para `publicacao-do-ciclo`: o sim que o caso grava já
 * está no git, no corpo (sem trailers) da marca `conferida` da primeira
 * publicação, que começa por `Publicada com o sim do operador: <sim>`. Aceita
 * só esse texto, seguido do fim do corpo ou de outro parágrafo; texto de
 * mensagem nunca. Mesma forma `{ recusar, mensagem }` do gate de PHI.
 */
export function gateDaConferenciaPublicada(corpoDaConferida) {
  if (typeof corpoDaConferida !== "string" || !corpoDaConferida)
    throw new ErroPlano("origem-sem-sim", "gate da publicação do ciclo sem o corpo da conferência");
  return (entrada) => {
    const sim = typeof entrada?.corpo === "string" ? entrada.corpo : "";
    const linha = `${PREFIXO_DA_PUBLICADA}${sim}`;
    const resto = sim && corpoDaConferida.startsWith(linha) ? corpoDaConferida.slice(linha.length) : null;
    return resto === "" || resto?.startsWith("\n\n")
      ? { recusar: false }
      : { recusar: true, mensagem: "texto diferente do sim da conferência publicada: só o sim gravado no git vale, texto de mensagem nunca" };
  };
}

// ── o sim herdado (T20, D-VEGA37-35) ────────────────────────────────────────

/**
 * O sim de origem de um caso herdado: o corpo da marca `Conducao: F<n>
 * autorizada` de `origem`, lido do git (sem o parágrafo de trailers), e a
 * data do commit dela. É o texto que o operador deu num turno dele; nada que
 * chega por mensagem entra aqui. Marca que não é `autorizada`, ou sem corpo ⇒
 * recusa (`origem-sem-sim`), nada gravado.
 */
export function simDaMarcaDeOrigem(repo, origem, { rodar = rodarGit } = {}) {
  if (!/^[0-9a-f]{40}$/.test(origem ?? "")) throw new ErroPlano("uso", `marca de origem sem sha: ${JSON.stringify(origem ?? null)}`);
  const [quando = "", subject = "", ...corpo] = rodar(repo, ["log", "-1", "--format=%cI%x1f%s%x1f%b", origem]).split(SEP_CAMPO);
  if (!/^Conducao: F\d{1,2} autorizada$/.test(subject.trim()))
    throw new ErroPlano("origem-sem-sim", `${origem.slice(0, 8)} não é marca autorizada (${subject.trim()}): sem sim de origem`);
  const sim = simDoCorpo(corpo.join(SEP_CAMPO));
  if (!sim) throw new ErroPlano("origem-sem-sim", `${origem.slice(0, 8)} é marca autorizada sem corpo: sem sim de origem`);
  return { sim, quando: quando.trim() };
}

/**
 * O gate irmão do de PHI para os casos herdados (`heranca-entre-fases`,
 * `replano-sem-mudanca-de-classe`, `sensivel-aditiva-na-ordem`,
 * `pergunta-repetida`): o texto que o caso grava já está no git, no corpo da
 * marca de origem, e o gate só aceita texto idêntico, byte a byte, a esse
 * corpo. Mesma forma `{ recusar, mensagem }` do gate de PHI, para entrar como
 * `phi` de `gravarConsentimento`.
 */
export function gateDaMarcaDeOrigem(corpoDaOrigem) {
  if (typeof corpoDaOrigem !== "string" || !corpoDaOrigem) throw new ErroPlano("origem-sem-sim", "gate da marca de origem sem o corpo da marca");
  return (entrada) =>
    entrada?.corpo === corpoDaOrigem
      ? { recusar: false }
      : { recusar: true, mensagem: "texto diferente do corpo da marca de origem: só o sim gravado no git vale, texto de mensagem nunca" };
}

/**
 * Grava os pedidos de caso herdado que uma ação do `proximo` traz
 * (`consentimento`/`consentimentos`): para cada um, o sim é o corpo da marca
 * `origem` (`simDaMarcaDeOrigem`), `quando` é a data dela, e a escrita passa
 * por `gravarConsentimento` com `gateDaMarcaDeOrigem` no lugar do gate de PHI.
 * `sim` explícito (só os testes e a prova o dão) passa pelo mesmo gate e é
 * recusado se não for o corpo da origem. Devolve os `{ sha, registro }`.
 */
export function gravarCasosHerdados({ repo, ciclo, pedidos = [], quem, cerca, sim = null, rodar = rodarGit }) {
  const out = [];
  for (const p of pedidos.filter(Boolean)) {
    const origem = simDaMarcaDeOrigem(repo, p.origem, { rodar });
    const registro = {
      ciclo,
      fase: p.fase,
      caso: p.caso,
      quem,
      quando: origem.quando,
      sim: sim ?? origem.sim,
      task: p.task ?? null,
      motivo: p.motivo ?? null,
      origem: p.origem,
    };
    out.push(gravarConsentimento({ repo, registro, phi: gateDaMarcaDeOrigem(origem.sim), cerca, rodar }));
  }
  return out;
}

// ── o registro do trazer e o gate do plano (T33, D-VEGA37-34, D-VEGA37-35) ──

const SECAO_15_RE = /^###\s+1\.5\b/;
const TITULO_RE = /^#{1,3}\s/;
const MAPA_RE = /^\*\*Consentimentos:\*\*(.*)$/;
const PAR_RE = /`([a-z][a-z0-9-]*)`\s*→\s*(D-[A-Za-z0-9]+-\d+)(?![\w-])/g;

/** As linhas do canonico, sem `\r`. */
function linhasDoCanonico(canonico) {
  return typeof canonico === "string" ? canonico.split("\n").map((l) => l.replace(/\r$/, "")) : [];
}

/**
 * O mapa caso → id de decisão da linha `**Consentimentos:**` do §1.5 do
 * canonico (D-VEGA37-35). Fail-closed: sem §1.5, sem a linha, ou com mais de
 * uma linha no §1.5 ⇒ mapa vazio; caso que aparece duas vezes na linha sai do
 * mapa (ambíguo). Nunca linha padrão.
 */
export function mapaDeConsentimentos(canonico) {
  const linhas = linhasDoCanonico(canonico);
  const inicio = linhas.findIndex((l) => SECAO_15_RE.test(l));
  if (inicio < 0) return new Map();
  const fimRel = linhas.slice(inicio + 1).findIndex((l) => TITULO_RE.test(l));
  const secao = linhas.slice(inicio + 1, fimRel < 0 ? undefined : inicio + 1 + fimRel);
  const doMapa = secao.map((l) => MAPA_RE.exec(l)).filter(Boolean);
  if (doMapa.length !== 1) return new Map();
  const mapa = new Map();
  const repetidos = new Set();
  for (const [, caso, id] of doMapa[0][1].matchAll(PAR_RE)) {
    if (mapa.has(caso)) repetidos.add(caso);
    mapa.set(caso, id);
  }
  for (const caso of repetidos) mapa.delete(caso);
  return mapa;
}

/**
 * O corpo da linha `- **<id>:** …` do canonico: o texto depois do rótulo, até
 * o fim da linha, sem espaço nas pontas. Nenhuma linha, ou mais de uma com o
 * mesmo id ⇒ null (fail-closed).
 */
export function corpoDaDecisao(canonico, id) {
  if (!/^D-[A-Za-z0-9]+-\d+$/.test(id ?? "")) return null;
  const rotulo = `- **${id}:** `;
  const achadas = linhasDoCanonico(canonico).filter((l) => l.startsWith(rotulo));
  if (achadas.length !== 1) return null;
  return texto(achadas[0].slice(rotulo.length));
}

/**
 * O gate do plano para um caso do `trazer` (D-VEGA37-34): a decisão que o
 * mapa do §1.5 aponta para o caso, o corpo dela e o gate que aceita só esse
 * corpo, byte a byte — substring, normalização e texto vindo de mensagem são
 * recusados. Mesma forma `{ recusar, mensagem }` do gate de PHI, para entrar
 * como `phi` de `gravarConsentimento`. Caso sem linha no mapa, ou decisão
 * ausente do canonico ⇒ null: o caso pergunta.
 */
export function gateDoPlano(canonico, caso) {
  const decisao = mapaDeConsentimentos(canonico).get(caso);
  if (!decisao) return null;
  const corpo = corpoDaDecisao(canonico, decisao);
  if (!corpo) return null;
  const gate = (entrada) =>
    entrada?.corpo === corpo
      ? { recusar: false }
      : { recusar: true, mensagem: `texto fora do plano: só o corpo exato de ${decisao} no canonico do HEAD vale para ${caso}` };
  return Object.freeze({ decisao, corpo, gate });
}

/**
 * Os registros que o `trazer` grava, um por item de `consentidos` de
 * `decidirNoTrazer`, e os que voltam a perguntar. `canonico` é o TEXTO do
 * canonico do HEAD. Casos do plano (`instrucao-declarada-em-outputs`,
 * `teste-que-acompanha-o-codigo`, `tela-dos-steps`, e todo caso futuro) gravam
 * o corpo da decisão que o mapa aponta, pelo `gateDoPlano`; sem ela, voltam.
 * `pergunta-repetida` grava o corpo da marca de origem (`origem`), que a casca
 * relê do git e confere pelo `gateDaMarcaDeOrigem`; sem origem, volta. Registro
 * que não confere (`casoResolvido`) também volta. Puro.
 * Devolve `{ registros: [{ registro, decisao?, gate? }], voltam: [{ motivo, caminhos }] }`.
 */
export function registrosDoTrazer({ consentidos = [], canonico, ciclo, fase, task = null, quem, quando }) {
  const registros = [];
  const voltam = [];
  for (const c of consentidos) {
    const volta = () => voltam.push({ motivo: c.motivo, caminhos: [...(c.caminhos ?? [])] });
    const comum = { ciclo, fase, caso: c.caso, quando, task, tipo: "trazer", motivo: c.motivo ?? null, caminhos: c.caminhos ?? [] };
    try {
      if (c.caso === CASOS.perguntaRepetida) {
        if (!/^[0-9a-f]{40}$/.test(c.origem ?? "") || !texto(c.sim)) {
          volta();
          continue;
        }
        const registro = casoResolvido({ ...comum, quem: c.quem ?? quem, sim: c.sim, origem: c.origem });
        registros.push({ registro });
        continue;
      }
      const plano = gateDoPlano(canonico, c.caso);
      if (!plano) {
        volta();
        continue;
      }
      registros.push({ registro: casoResolvido({ ...comum, quem, sim: plano.corpo }), decisao: plano.decisao, gate: plano.gate });
    } catch {
      volta();
    }
  }
  return { registros, voltam };
}

/** Os motivos do `trazer` somados aos casos que voltaram a perguntar, por motivo, sem caminho repetido. */
export function devolverAosMotivos(motivos = [], voltam = []) {
  const out = motivos.map((m) => ({ ...m, caminhos: [...m.caminhos] }));
  for (const v of voltam) {
    const ja = out.find((m) => m.motivo === v.motivo);
    if (ja) ja.caminhos = [...new Set([...ja.caminhos, ...v.caminhos])];
    else out.push({ motivo: v.motivo, caminhos: [...new Set(v.caminhos)] });
  }
  return out;
}

/**
 * Grava os registros de `registrosDoTrazer` por `gravarConsentimento`, com a
 * cerca da posse injetada. Caso do plano: o gate do plano. `pergunta-repetida`:
 * o corpo da marca `origem` relido do git agora, e o `gateDaMarcaDeOrigem`
 * sobre ele — texto de mensagem nunca entra. Devolve os `{ sha, registro }`.
 */
export function gravarRegistrosDoTrazer({ repo, registros = [], cerca, rodar = rodarGit }) {
  return registros.map(({ registro, gate }) => {
    if (registro.caso === CASOS.perguntaRepetida) {
      const corpo = simDoCorpo(rodar(repo, ["log", "-1", "--format=%b", registro.origem]));
      if (!corpo) throw new ErroPlano("origem-sem-sim", `${registro.origem.slice(0, 8)} sem corpo: sem sim de origem`);
      return gravarConsentimento({ repo, registro, phi: gateDaMarcaDeOrigem(corpo), cerca, rodar });
    }
    if (typeof gate !== "function") throw new ErroPlano("sem-gate-do-plano", `${registro.caso} sem o gate do plano: nada gravado (fail-closed)`);
    return gravarConsentimento({ repo, registro, phi: gate, cerca, rodar });
  });
}
