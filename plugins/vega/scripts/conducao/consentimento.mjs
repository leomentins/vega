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
 *     `replano-sozinho`               (`regraReplano`, fase reaberta; D-VEGA19-53): decisão de Vega
 *                                     por delegação, que o operador recebe como aviso;
 *     `tela-dos-steps`                (`motivosParaPerguntar`, segmento dos Steps);
 *     `replano`                       (`regraReplano`, fase reaberta, fase nova; ruling do operador de
 *                                     23/11/2026): todo re-plano commitado dentro de ciclo autorizado
 *                                     reautoriza a fase pelo sim que já valia, e o operador recebe o aviso;
 *   novos —
 *     `sensivel-aditiva-na-ordem`      task sensível nova, na ordem do plano, dentro da fase autorizada;
 *     `pergunta-repetida`              mesmo tipo e mesmo motivo já respondidos na fase;
 *     `instrucao-declarada-em-outputs` superfície de instrução (ou hook) que é arquivo declarado em Outputs;
 *     `teste-que-acompanha-o-codigo`   teste ou contrato do motor fora dos Outputs que acompanha o código declarado;
 *     `publicacao-do-ciclo`            o sim da primeira publicação do ciclo, que cobre as seguintes dele;
 *     `decisao-registrada-da-task`     decisão do canonico que cita a task e o caminho trazido (D-VEGA19-33).
 * Os três primeiros casos do `trazer` (`instrucao-declarada-em-outputs`,
 * `teste-que-acompanha-o-codigo`, `tela-dos-steps`) valem em todo ciclo pelo
 * padrão da fábrica (D-VEGA19-29): o texto exato mora no `contrato.md` da
 * condução, e a linha `**Consentimentos:**` do canonico só restringe.
 * Mais o registro de origem, `resposta-do-operador`: o sim que a pergunta
 * repetida reaproveita. Tipo novo sobe uma vez; publicação nunca entra na
 * repetição: tem o caso próprio.
 *
 * PHI: o texto literal do sim passa pelo gate do projeto antes do commit
 * (`phi` injetado — na Sistoli, `recusarPhiDoConsentimento` do gate de PHI do
 * projeto, pelo adaptador, `consentimentoDoProjeto()` de `.vega/sistoli.mjs`).
 * Sem gate, a escrita recusa (fail-closed): o núcleo é neutro de projeto e não
 * sabe varrer PHI sozinho. O gate de igualdade do caso (`gate`: byte a byte
 * com a marca de origem, o plano ou a conferência) e o de PHI valem JUNTOS —
 * os dois aceitam, ou nada grava (VEGA-19 T16, veredito da T4).
 *
 * O registro de perguntas (VEGA-19 T16, D-VEGA19-27/39/40): o projeto que o
 * declara (`perguntas` das peças do adaptador) recebe cada caso como pergunta
 * registrada — abertura + resposta `sim` — ANTES da marca no git, e a marca
 * leva o `pergunta_id` no trailer `Conducao-Pergunta`. A resposta grava:
 *   — caso herdado do sim do ciclo: `agente`, com `ponteiro` = a pergunta em
 *     que o operador deu o sim (o `--pergunta` do `autorizar-ciclo`), só
 *     depois de a `origemEfetiva()` dela dar `digitado`,
 *     `digitado-no-hub-conferido` ou `repasse-hub`; sem prova que resolva,
 *     recusa, nada gravado;
 *   — padrão da fábrica, decisão do mapa `**Consentimentos:**` e
 *     `decisao-registrada-da-task`: `padrao-da-fabrica`, com a marca de
 *     consentimento da condução (título e ponteiro próprios), fora das medidas;
 *   — `publicacao-do-ciclo`: `agente`, ponteiro = a marca `conferida`.
 * Marca `autorizada` antiga, sem o trailer, segue o caminho legado (git, gate
 * byte a byte + PHI), só para ciclos já fechados e para a F2 do VEGA-19.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJETO_DE_TESTE, RAIZ_DO_PLUGIN, caminhoDeCodigo, caminhoDoEmbutido, codigoDoAdaptador, ehNomeEmbutido, lerAdaptador } from "./adaptador.mjs";
import { git as rodarGit } from "./git-exec.mjs";
import { casaAlgum, ErroPlano } from "./ler-plano.mjs";
import { trailers as lerTrailers } from "./marcas.mjs";

/** Os casos que seguem sem pergunta, mais o registro de origem do sim (`resposta-do-operador`). */
export const CASOS = Object.freeze({
  herancaEntreFases: "heranca-entre-fases",
  replanoSemMudancaDeClasse: "replano-sem-mudanca-de-classe",
  replanoSozinho: "replano-sozinho",
  // Ruling do operador, 23/11/2026 ("pra replanos sempre vale preautorização"): o re-plano
  // commitado dentro de ciclo autorizado reautoriza a fase sem perguntar; a marca é
  // `Conducao: <fase> consentimento replano`.
  replanoPreautorizado: "replano",
  telaDosSteps: "tela-dos-steps",
  sensivelAditivaNaOrdem: "sensivel-aditiva-na-ordem",
  perguntaRepetida: "pergunta-repetida",
  instrucaoDeclaradaEmOutputs: "instrucao-declarada-em-outputs",
  testeQueAcompanhaOCodigo: "teste-que-acompanha-o-codigo",
  publicacaoDoCiclo: "publicacao-do-ciclo",
  decisaoRegistradaDaTask: "decisao-registrada-da-task",
  cobertoPeloCarimbo: "coberto-pelo-carimbo",
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

/** Dependência, lockfile e instalação: o que roda na máquina de quem instala (D-VEGA37-29, D-VEGA37-40). */
export const DEPENDENCIA_E_INSTALACAO = Object.freeze([
  "**/package.json",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-workspace.yaml",
  "**/instalar-*.sh",
  "**/install*.sh",
  "**/.npmrc",
  "**/.pnpmfile.cjs",
  // Ferramenta, no mesmo grupo da D-VEGA37-40.
  "**/.mcp.json",
  "**/mcp.json",
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
 * `SEGUEM_PERGUNTANDO` para caminho que é ARQUIVO declarado nos Outputs da
 * task (D-VEGA19-32): `.vega/**` sai da lista nesse caso; o resto fica, e
 * `.vega/<x>-mode` segue perguntando por `**\/*-mode`. Fora dos Outputs vale
 * a lista inteira.
 */
export const SEGUEM_PERGUNTANDO_DECLARADO = Object.freeze(SEGUEM_PERGUNTANDO.filter((g) => g !== ".vega/**"));

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
export const MOTIVOS_QUE_NUNCA_REPETEM = Object.freeze(["canonico-do-ciclo", "caminho-clinico-fora-dos-outputs", "define-a-parada"]);

/**
 * O que define as paradas que ficam no `trazer` (D-VEGA20-26): conta como
 * publicação e para mesmo declarado nos Outputs (`define-a-parada`). O motor
 * guarda só o que é de todo projeto — a declaração e o código do adaptador
 * (`.vega/**`, `.altair/**`); o resto (o gate de publicação, a liberação da
 * publicação do ciclo, os scripts de publicação do banco, o `db push` do
 * estado) o projeto declara em `definemAParada` no `codigo` do adaptador, e
 * quem lê usa a união (`definemAParadaDe`). Sem ela, a operária que esvazia
 * `caminhosProtegidos` ou os verbos de publicação seria trazida calada e
 * desligaria o freio do trazer seguinte.
 * O registro do gate num `settings*.json` também conta, pelo conteúdo dos
 * dois lados (`settingsMudaAParada`), nunca pelo caminho: o `settings*.json`
 * que não mexe no gate segue sem pergunta.
 */
export const DEFINEM_A_PARADA = Object.freeze([".vega/**", ".altair/**"]);

/**
 * A lista efetiva do que define a parada: a do motor e a que o `codigo` do
 * adaptador declara em `definemAParada`. Campo ausente nunca vale lista
 * vazia: sem a lista do projeto, lança, e quem lê veta `define-a-parada`
 * (falha fechada).
 */
export function definemAParadaDe(codigo) {
  const doProjeto = codigo?.definemAParada;
  if (!Array.isArray(doProjeto) || !doProjeto.every((g) => typeof g === "string" && g.trim()))
    throw new Error("o código do adaptador não declara `definemAParada` — o que define a parada fica sem a lista do projeto");
  return Object.freeze([...new Set([...DEFINEM_A_PARADA, ...doProjeto])]);
}

/** O `settings*.json` que mexe no registro do gate de publicação define a parada (D-VEGA20-26). */
export const SETTINGS_DO_HOST = Object.freeze(["**/settings*.json"]);
const GATE_DE_PUBLICACAO_RE = /publicacao-gate/;

/**
 * O que, num `settings*.json`, liga o gate de publicação: `disableAllHooks` e
 * cada objeto que tem um texto que cita o gate, em qualquer profundidade,
 * inteiro (chaves em ordem: `timeout`, `async`, `type` contam), com o caminho
 * dele no JSON e o `matcher` mais próximo acima — trocar o matcher, mexer no
 * objeto do gate, apagar o registro ou repetir a chave `hooks` (o JSON fica com
 * a última) mudam essa leitura sem citar o gate na linha. `undefined` =
 * arquivo ausente; `null` = ilegível.
 */
function registroDaParada(texto) {
  if (texto === null || texto === undefined) return undefined;
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const registros = new Set();
  const ordenado = (v) =>
    Array.isArray(v) ? v.map(ordenado) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenado(v[k])])) : v;
  (function andar(v, caminho, matcher, pai) {
    if (typeof v === "string") {
      if (GATE_DE_PUBLICACAO_RE.test(v)) registros.add(JSON.stringify([caminho.slice(0, -1), matcher, ordenado(pai ?? v)]));
    } else if (Array.isArray(v)) v.forEach((x, i) => andar(x, [...caminho, i], matcher, v));
    else if (v && typeof v === "object") {
      const m = Object.hasOwn(v, "matcher") ? v.matcher : matcher;
      for (const [k, x] of Object.entries(v)) andar(x, [...caminho, k], m, v);
    }
  })(json, [], null, null);
  return JSON.stringify({ desligado: json.disableAllHooks ?? null, registros: [...registros].sort() });
}

/**
 * O `settings*.json` muda a parada de publicação entre `antes` e `depois` (o
 * texto do arquivo em cada lado; `null`/`undefined` = ausente): o registro do
 * gate ou o `disableAllHooks` mudam, ou um dos lados é ilegível. Fail-closed:
 * o ilegível para (D-VEGA20-26).
 */
export function settingsMudaAParada(antes, depois) {
  const a = registroDaParada(antes);
  const d = registroDaParada(depois);
  if (a === null || d === null) return true;
  const vazio = JSON.stringify({ desligado: null, registros: [] });
  return (a ?? vazio) !== (d ?? vazio);
}

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
  tentativa: "Conducao-Tentativa",
  pergunta: "Conducao-Pergunta",
  citada: "Conducao-Pergunta-Citada",
});

/** O trailer da marca `autorizada` com a pergunta em que o operador deu o sim (D-VEGA19-39). */
export const TRAILER_DA_PERGUNTA = TRAILER.pergunta;
/** O id opaco de pergunta registrada (`p-` + 16 hex). */
export const PERGUNTA_ID_RE = /^p-[0-9a-f]{16}$/;
/** As origens que valem como resposta do operador (D-VEGA19-27); `agente` nunca. */
export const ORIGENS_HUMANAS = Object.freeze(["digitado", "digitado-no-hub-conferido", "repasse-hub"]);
/**
 * A marca de pergunta de consentimento da condução (D-VEGA19-40): título e
 * ponteiro próprios. O registro da Sistoli (`estado/lib/pergunta.mjs`) aceita
 * a resposta `padrao-da-fabrica` só com as duas; a paridade é testada.
 */
export const TITULO_DO_CONSENTIMENTO = "Consentimento da condução";
export const PONTEIRO_DO_CONSENTIMENTO = "consentimento-da-conducao:";
/** A sessão fixa do registro do consentimento: o id não muda com a sessão que grava (regravar é idempotente). */
export const SESSAO_DO_CONSENTIMENTO = "conducao-consentimento";

function texto(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * O registro de um caso, conferido: `ciclo`, `fase`, `caso`, `quem`, `quando`
 * (ISO 8601 UTC) e `sim` (texto literal do sim de origem) obrigatórios;
 * `task`, `tipo`, `motivo`, `origem` (sha da marca com o sim) e `caminhos`
 * opcionais. Puro: as regras o devolvem junto com a ação.
 */
export function casoResolvido({ ciclo, fase, caso, quem, quando, sim, task = null, tipo = null, motivo = null, origem = null, caminhos = [], tentativa = null, pergunta = null, citada = null }) {
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
  const t = tentativa === null || tentativa === undefined ? null : Number(tentativa);
  if (t !== null && !(Number.isInteger(t) && t > 0)) throw new ErroPlano("uso", `consentimento com tentativa inválida: ${JSON.stringify(tentativa)}`);
  for (const [k, v] of Object.entries({ pergunta, citada }))
    if (v !== null && v !== undefined && !PERGUNTA_ID_RE.test(v)) throw new ErroPlano("uso", `consentimento com ${k} fora da forma p-<16 hex>: ${JSON.stringify(v)}`);
  return Object.freeze({
    ciclo: ciclo.trim(),
    fase,
    caso,
    quem: quem.trim(),
    quando: new Date(quando).toISOString(),
    sim: sim.trim(),
    task,
    tipo,
    motivo,
    origem,
    caminhos: Object.freeze([...caminhos]),
    tentativa: t,
    pergunta: pergunta ?? null,
    citada: citada ?? null,
  });
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
    [TRAILER.tentativa, r.tentativa ?? null],
    [TRAILER.pergunta, r.pergunta ?? null],
    [TRAILER.citada, r.citada ?? null],
  ].filter(([, v]) => v !== null && v !== undefined);
  return { subject: `Conducao: ${r.fase} consentimento ${r.caso}`, corpo: r.sim, trailers: tr.map(([k, v]) => `${k}: ${v}`).join("\n") };
}

/**
 * O id da pergunta registrada de um caso (`p-` + 16 hex): o `sha256` de
 * sessão fixa, número 1, assunto e tentativa, na regra do `idDaPergunta` da
 * fábrica. O assunto leva ciclo, fase, caso, task, tipo, motivo, caminhos e
 * origem; a TENTATIVA vai à parte, e a 2ª tentativa é outra pergunta. O mesmo
 * caso dá o mesmo id: regravar não duplica (o registro devolve `ja_existiam`).
 */
export function perguntaDoConsentimento(r) {
  const assunto = JSON.stringify([r.ciclo, r.fase, r.caso, r.task ?? null, r.tipo ?? null, r.motivo ?? null, [...(r.caminhos ?? [])].sort(), r.origem ?? null]);
  const chave = JSON.stringify([SESSAO_DO_CONSENTIMENTO, 1, assunto, r.tentativa ?? null]);
  return `p-${createHash("sha256").update(chave).digest("hex").slice(0, 16)}`;
}

/** A versão do esquema da pergunta da fábrica (`pergunta/forma.mjs`, `ESQUEMA_VERSAO`): a pergunta do consentimento grava na mesma. */
const VERSAO_DO_ESQUEMA = 1;

/**
 * Os dois eventos do registro de um caso: a abertura (título e ponteiro de
 * consentimento da condução, o texto exato do sim no contexto, opção única
 * `sim`) e a resposta `sim` com a origem e o ponteiro dados. Puro.
 */
export function eventosDoConsentimento(r, { pergunta_id, origem_resposta, ponteiro }) {
  const titulo = `${TITULO_DO_CONSENTIMENTO}: ${r.caso}`;
  // D-VEGA20-29 (VEGA-20 T44): o re-plano sozinho herda com o ponteiro da pergunta citada, e o registro
  // só reconhece a resposta de Vega ao `replano-sozinho` (e a delegação D58 dela) pelo ponteiro do
  // consentimento. A citada segue no ponteiro, depois do prefixo, e no trailer `Conducao-Pergunta-Citada`.
  const doReplano = r.caso === CASOS.replanoSozinho && typeof ponteiro === "string" && !ponteiro.startsWith(PONTEIRO_DO_CONSENTIMENTO);
  const comum = { pergunta_id, sessao: SESSAO_DO_CONSENTIMENTO, ciclo: r.ciclo, versao_esquema: VERSAO_DO_ESQUEMA, has_patient_data: false, item: "D1", titulo, ponteiro: doReplano ? `${PONTEIRO_DO_CONSENTIMENTO}${ponteiro}` : ponteiro };
  return [
    {
      ...comum,
      evento: "abertura",
      carimbo: r.quando,
      assunto: `${r.caso} ${r.fase}${r.task ? ` ${r.task}` : ""}${r.tentativa ? ` tentativa ${r.tentativa}` : ""}`,
      itens: [{ numero: 1, titulo, contexto: r.sim, opcoes: [{ letra: "a", texto: "sim" }], recomendada: "a" }],
    },
    {
      ...comum,
      evento: "resposta",
      carimbo: r.quando,
      perguntado_em: r.quando,
      resposta_literal: "sim",
      origem_resposta,
      // T43 (D-VEGA19-53): o re-plano que segue sozinho é decisão de Vega por delegação — o registro
      // do projeto grava a delegação que o operador digitou e confere a autoria humana dela.
      // D-VEGA20-29 (VEGA-20 T44): a delegação de Vega é sempre do mandato engenharia (D-VEGA19-55);
      // sem ele o registro recusava a resposta (`mandato: esperado …`) e o re-plano sozinho parava.
      ...(r.caso === CASOS.replanoSozinho ? { quem: "vega", mandato: "engenharia" } : {}),
    },
  ];
}

/**
 * Confere um caso sem gravar nada: o registro (`casoResolvido`), o gate de
 * igualdade do caso (`gate`, opcional) e o de PHI do projeto (`phi`), os dois
 * sobre o mesmo texto — ambos aceitam, ou recusa. Com `perguntas`, devolve
 * também os eventos do registro de perguntas.
 * Sem `phi`: projeto sem filtro de PHI próprio (`semFiltroDoProjeto`, o
 * `phiPeloCaso` das peças — sem código, ou o embutido que declara `phi` =
 * `PHI_DO_CASO`) usa o gate do caso no lugar dele, como antes da T16
 * (D-VEGA19-46, critério da D-VEGA19-57); projeto com
 * código próprio que não exporta o filtro, ou caso sem gate, recusa por
 * `phi-sem-gate` (fail-closed: a Sistoli segue com o filtro obrigatório).
 */
export function conferirConsentimento({ registro, gate = null, phi, semFiltroDoProjeto = false, perguntas = null, origem_resposta = "agente", ponteiro = null }) {
  const r0 = casoResolvido(registro);
  const peloCaso = typeof phi !== "function" && semFiltroDoProjeto === true && typeof gate === "function";
  if (typeof phi !== "function" && !peloCaso) throw new ErroPlano("phi-sem-gate", "consentimento sem gate de PHI do projeto: nada gravado (fail-closed)");
  const entrada = { ciclo: r0.ciclo, fase: r0.fase, task: r0.task, motivo: r0.motivo ?? r0.caso, corpo: r0.sim };
  for (const [nome, g] of peloCaso ? [["do caso", gate]] : [["do caso", gate], ["de PHI", phi]]) {
    if (g === null) continue;
    if (typeof g !== "function") throw new ErroPlano("phi-recusado", `gate ${nome} não é função · fail-closed`);
    let veredito;
    try {
      veredito = g(entrada);
    } catch {
      veredito = { recusar: true, mensagem: `gate ${nome} falhou · fail-closed` };
    }
    if (!veredito || typeof veredito.recusar !== "boolean") throw new ErroPlano("phi-recusado", `gate ${nome} devolveu forma desconhecida · fail-closed`);
    if (veredito.recusar) throw new ErroPlano("phi-recusado", `sim recusado pelo gate ${nome}: ${veredito.mensagem ?? "sem detalhe"}`);
  }
  // Os outros campos que viram trailer no git (quem, caminhos) passam pelo gate de PHI também;
  // sem filtro do projeto, o gate do caso é o único, como antes da T16 (D-VEGA19-46).
  if (peloCaso) return comEventos(r0, { perguntas, origem_resposta, ponteiro });
  let dosTrailers;
  try {
    dosTrailers = phi({ ...entrada, corpo: [r0.quem, ...r0.caminhos].join("\n") });
  } catch {
    dosTrailers = { recusar: true, mensagem: "gate de PHI falhou · fail-closed" };
  }
  if (!dosTrailers || dosTrailers.recusar !== false) throw new ErroPlano("phi-recusado", `trailers recusados pelo gate de PHI: ${dosTrailers?.mensagem ?? "forma desconhecida"}`);
  return comEventos(r0, { perguntas, origem_resposta, ponteiro });
}

/** O caso conferido e, com `perguntas`, os eventos do registro de perguntas. */
function comEventos(r0, { perguntas, origem_resposta, ponteiro }) {
  if (!perguntas) return { registro: r0, eventos: null };
  if (typeof perguntas.gravar !== "function") throw new ErroPlano("registro-sem-gravador", "registro de perguntas sem gravar(): nada gravado (fail-closed)");
  const pergunta_id = perguntaDoConsentimento(r0);
  const r = casoResolvido({ ...r0, pergunta: pergunta_id });
  return { registro: r, eventos: eventosDoConsentimento(r, { pergunta_id, origem_resposta, ponteiro }) };
}

/**
 * Grava o caso. `phi(entrada)` é o gate do projeto, com a forma
 * `{ recusar, mensagem }` de `recusarPhi`; recebe `{ ciclo, fase, task,
 * motivo, corpo }` (a escrita `consentimento` de `CAMPOS_POR_ESCRITA`).
 * `gate`, o de igualdade do caso, na mesma forma. `cerca()` é a cerca da posse
 * da casca de I/O (`exigirPosse`). Sem `phi` (salvo `semFiltroDoProjeto`,
 * pelo gate do caso: `conferirConsentimento`) ou sem `cerca` ⇒ recusa, nada
 * gravado. Com `perguntas` (o registro do projeto), a abertura e a resposta
 * vão a ele antes do commit; registro que recusa ⇒ nada no git. Devolve
 * `{ sha, registro, pergunta }`.
 */
export function gravarConsentimento({ repo, registro, gate = null, phi, semFiltroDoProjeto = false, cerca, perguntas = null, origem_resposta = "agente", ponteiro = null, rodar = rodarGit, avisar = AVISO_PADRAO }) {
  const c = conferirConsentimento({ registro, gate, phi, semFiltroDoProjeto, perguntas, origem_resposta, ponteiro });
  if (typeof cerca !== "function") throw new ErroPlano("sem-cerca", "consentimento sem a cerca da posse: nada gravado");
  const g = escreverConsentimento({ repo, conferido: c, perguntas, cerca, rodar });
  avisarSemRegistro({ phi, perguntas, casos: 1, avisar });
  return g;
}

/**
 * O que a saída do `gravar` prova (D-VEGA19-48): `null` quando o registro confirmou a gravação,
 * senão o motivo — `na-fila` (algum evento só na fila local: `enfileirados` > 0, ou
 * `sem_registro`, que cobre o evento que já estava na fila de uma tentativa anterior) ou
 * `sem-prova` (forma que não se lê: nada, `Promise` de adaptador assíncrono, saída sem `gravados`
 * nem `ja_existiam` numéricos). "Não sei" nunca vira "registrado".
 */
function provaDaGravacao(saida) {
  // `gravar` assíncrono: sem prova, e a rejeição tratada aqui não derruba o processo.
  if (saida && typeof saida.then === "function") {
    Promise.resolve(saida).catch(() => {});
    return "sem-prova";
  }
  const lista = Array.isArray(saida) ? saida : saida && typeof saida === "object" && typeof saida.then !== "function" ? [saida] : null;
  if (!lista || lista.length === 0 || lista.some((x) => !x || typeof x !== "object")) return "sem-prova";
  if (lista.some((x) => x.sem_registro === true || (Number(x.enfileirados) || 0) > 0)) return "na-fila";
  if (lista.some((x) => typeof x.gravados !== "number" && typeof x.ja_existiam !== "number")) return "sem-prova";
  return null;
}

/**
 * A marca do mesmo caso no git do HEAD (mesma pergunta do consentimento: mesmo caso, mesma
 * tentativa), ou null. Havendo mais de uma, a que afirma a pergunta vence: a marca que completa
 * uma marca rebaixada (gravada com o registro fora) é a que vale daí em diante.
 */
function marcaDoMesmoCaso(repo, r, rodar) {
  const id = perguntaDoConsentimento(r);
  const mesmas = lerConsentimentos(repo, { ciclo: r.ciclo, rodar }).filter((c) => c.fase === r.fase && c.caso === r.caso && perguntaDoConsentimento(c) === id);
  return mesmas.find((c) => c.pergunta) ?? mesmas[0] ?? null;
}

/**
 * A escrita de um caso já conferido: cerca, registro de perguntas (se há), marca no git
 * (D-VEGA19-48):
 *   — a repetição é idempotente: caso já marcado no HEAD (mesma pergunta do consentimento) não
 *     ganha segunda marca; o registro é chamado de novo (o mesmo id dá `ja_existiam`, e o que
 *     ficou na fila drena), e a saída traz `repetida: true` com o sha da marca existente. A
 *     exceção é a marca rebaixada (sem `Conducao-Pergunta`) cuja pergunta agora se provou: ganha
 *     a marca que a completa, uma vez só (`completa: <sha da rebaixada>`);
 *   — sem prova da gravação (`provaDaGravacao`: evento na fila local, ou saída que não se lê), a
 *     marca sai SEM `Conducao-Pergunta`: a pergunta não está provada no registro, e a marca não a
 *     afirma (`na_fila` ou `sem_prova` = o id);
 *   — depois do commit, a marca é relida do HEAD e conferida (subject, caso e pergunta) antes de
 *     dar o caso por gravado; HEAD que não é a marca ⇒ `marca-nao-confere`.
 */
function escreverConsentimento({ repo, conferido, perguntas, cerca, rodar }) {
  cerca();
  let r = conferido.registro;
  let naFila = null;
  if (conferido.eventos) {
    let saida;
    try {
      saida = perguntas.gravar(conferido.eventos);
    } catch (e) {
      throw new ErroPlano("registro-recusado", `registro de perguntas recusou ${r.caso} (${String(e?.message ?? e).split("\n")[0]}): nada gravado no git`);
    }
    const semProva = provaDaGravacao(saida);
    if (semProva) {
      naFila = { [semProva === "na-fila" ? "na_fila" : "sem_prova"]: r.pergunta };
      r = casoResolvido({ ...r, pergunta: null });
    }
  }
  const ja = marcaDoMesmoCaso(repo, r, rodar);
  // A rebaixada cuja pergunta agora se provou segue para a marca que a completa; o resto repete.
  const completa = ja && !ja.pergunta && r.pergunta ? ja.sha : null;
  // O registro devolvido é o da marca existente, nunca o desta chamada (`sim`/`quem` podem diferir).
  if (ja && !completa) return { sha: ja.sha, registro: casoResolvido(ja), pergunta: ja.pergunta ?? null, repetida: true, ...(naFila ?? {}) };
  // A marca que completa a rebaixada repete os campos dela; só a pergunta, agora provada, entra.
  if (completa) r = casoResolvido({ ...ja, pergunta: r.pergunta });
  const m = mensagemDoCaso(r);
  rodar(repo, ["commit", "-q", "--allow-empty", "-m", m.subject, "-m", m.corpo, "-m", m.trailers]);
  const sha = rodar(repo, ["rev-parse", "HEAD"]);
  const [lida] = consentimentosDoLog(rodar(repo, ["log", "-1", `--format=%H${SEP_CAMPO}%s${SEP_CAMPO}%b${SEP_REG}`, sha]));
  if (!lida || lida.caso !== r.caso || lida.fase !== r.fase || (lida.pergunta ?? null) !== (r.pergunta ?? null))
    throw new ErroPlano("marca-nao-confere", `a marca de ${r.caso} relida do HEAD (${String(sha).slice(0, 8)}) não confere com o caso gravado: o consentimento não está dado por gravado`);
  return { sha, registro: r, pergunta: r.pergunta, ...(completa ? { completa } : {}), ...(naFila ?? {}) };
}

/**
 * O aviso de peças com filtro de PHI e sem registro de perguntas (D-VEGA19-48): o caso grava só
 * no git, e isso não passa calado. `avisar` recebe a linha (padrão: stderr).
 */
function avisarSemRegistro({ phi, perguntas, falha = null, casos, avisar }) {
  if (typeof phi !== "function" || perguntas || casos === 0) return;
  avisar(`consentimento: ${casos} caso(s) gravado(s) só no git, sem pergunta registrada — o projeto tem filtro de PHI e não declara registro de perguntas${falha?.mensagem ? ` (${falha.mensagem})` : ""}\n`);
}
const AVISO_PADRAO = (linha) => process.stderr.write(linha);

// ── as peças do projeto (VEGA-19 T16) ──────────────────────────────────────

/** O nome da função que o código do adaptador exporta, fora do `default`, com as peças do consentimento. */
export const EXPORT_DO_CONSENTIMENTO = "consentimentoDoProjeto";
/**
 * O `phi` que o embutido sem filtro de PHI próprio declara (D-VEGA19-57): o
 * gate do caso faz as vezes do filtro (D-VEGA19-46). Só vale de embutido; de
 * código próprio, o mesmo valor não é filtro e a escrita recusa por
 * `phi-sem-gate` (a Sistoli segue com o filtro obrigatório).
 */
export const PHI_DO_CASO = "gate-do-caso";
const requerer = createRequire(import.meta.url);

/**
 * As peças do consentimento pelo adaptador do projeto em `repo`: `{ phi,
 * perguntas, falha }`, de `consentimentoDoProjeto()` exportada (fora do
 * `default`) pelo código que a declaração aponta. Síncrona: a condução grava
 * em série. Peça que falta sai nula, e `falha` diz por quê — `{ codigo,
 * mensagem }`, nunca engolida (D-VEGA19-41): `adaptador-nao-carrega` (a
 * declaração ou o código não carregam, ou a função lança),
 * `consentimento-sem-export` (o código não exporta a função) ou
 * `registro-nao-declarado` (sem código, ou as peças sem `perguntas`). Quem
 * escreve sem pergunta citada e sem `phi` recusa por `phi-sem-gate`
 * (fail-closed), salvo o projeto sem código próprio, que confere pelo gate do
 * caso (D-VEGA19-46); quem cita pergunta passa por `registroDoConsentimento`,
 * que recusa pela `falha`.
 * `semCodigoProprio` (D-VEGA19-45): o projeto não declara código, ou declara
 * um embutido (`superpowers`). `phiPeloCaso` (D-VEGA19-57): sem filtro de PHI
 * próprio — sem código, ou embutido cujo `phi` é `PHI_DO_CASO` —, o gate do
 * caso faz as vezes do `phi`. A pergunta citada se confere igual em todo
 * projeto (T33): o embutido a lê do registro do destino `git`; sem registro,
 * recusa por `registro-nao-declarado`.
 */
export function pecasDoConsentimento(repo) {
  let semCodigoProprio = false;
  let semCodigo = false;
  // Falha de carga do embutido não vira "sem filtro": só o projeto sem código nenhum cai no gate do caso.
  const falhou = (codigo, mensagem) => ({ phi: null, perguntas: null, semCodigoProprio, phiPeloCaso: semCodigo, falha: Object.freeze({ codigo, mensagem }) });
  const curto = (e) => String(e?.message ?? e).split("\n")[0];
  let caminho = null;
  try {
    codigoDoAdaptador(repo);
    const { codigo } = lerAdaptador(repo);
    semCodigoProprio = !codigo || ehNomeEmbutido(codigo);
    semCodigo = !codigo;
    if (codigo) caminho = ehNomeEmbutido(codigo) ? caminhoDoEmbutido(codigo) : caminhoDoCodigoDeclarado(repo, codigo);
  } catch (e) {
    return falhou("adaptador-nao-carrega", `o adaptador do projeto não carrega (${curto(e)})`);
  }
  if (!caminho) return falhou("registro-nao-declarado", "o projeto não declara código de adaptador com o registro de perguntas");
  let fn;
  try {
    fn = requerer(caminho)?.[EXPORT_DO_CONSENTIMENTO];
  } catch (e) {
    return falhou("adaptador-nao-carrega", `o código do adaptador não carrega (${curto(e)})`);
  }
  if (typeof fn !== "function") return falhou("consentimento-sem-export", `o código do adaptador não exporta ${EXPORT_DO_CONSENTIMENTO}()`);
  let p;
  try {
    p = fn({ repo }) ?? {};
  } catch (e) {
    return falhou("adaptador-nao-carrega", `${EXPORT_DO_CONSENTIMENTO}() lançou (${curto(e)})`);
  }
  const phi = typeof p.phi === "function" ? p.phi : null;
  const phiPeloCaso = semCodigoProprio && p.phi === PHI_DO_CASO;
  const perguntas = p.perguntas ?? null;
  return { phi, perguntas, semCodigoProprio, phiPeloCaso, falha: perguntas ? null : Object.freeze({ codigo: "registro-nao-declarado", mensagem: `${EXPORT_DO_CONSENTIMENTO}() sem o registro de perguntas` }) };
}

/**
 * O projeto sem filtro de PHI próprio, pelas peças: `phiPeloCaso` (D-VEGA19-57);
 * peças montadas à mão sem ele (testes, chamador antigo) caem no
 * `semCodigoProprio` de antes.
 */
function semFiltroDe(pc) {
  return typeof pc?.phiPeloCaso === "boolean" ? pc.phiPeloCaso : pc?.semCodigoProprio === true;
}

/**
 * O registro de perguntas das peças, para quem cita uma pergunta: a `falha`
 * das peças recusa com o motivo dela, registro ausente recusa por
 * `registro-nao-declarado`. Nunca devolve nulo: pergunta citada sem quem a
 * confira não vira consentimento (D-VEGA19-41).
 */
export function registroDoConsentimento(pecas, pergunta_id) {
  if (pecas?.falha) throw new ErroPlano(pecas.falha.codigo, `${pecas.falha.mensagem}: a pergunta ${pergunta_id} não se confere, nada gravado (fail-closed)`);
  if (!pecas?.perguntas) throw new ErroPlano("registro-nao-declarado", `o projeto não declara registro de perguntas: a pergunta ${pergunta_id} não se confere, nada gravado (fail-closed)`);
  return pecas.perguntas;
}

/**
 * O caminho do código declarado, na regra de `codigoDoAdaptador`: na pasta do
 * adaptador do repo; senão — a declaração da árvore do núcleo copiada para
 * outro repositório, como as suítes fazem — na árvore do núcleo, só com o
 * mesmo nome declarado.
 */
function caminhoDoCodigoDeclarado(repo, rel) {
  try {
    return caminhoDeCodigo(repo, rel, "codigo");
  } catch (e) {
    const nucleo = process.env.NODE_TEST_CONTEXT ? PROJETO_DE_TESTE : RAIZ_DO_PLUGIN;
    if (path.resolve(repo) === path.resolve(nucleo) || lerAdaptador(nucleo).codigo !== rel) throw e;
    return caminhoDeCodigo(nucleo, rel, "codigo");
  }
}

/**
 * A pergunta em que o operador deu o sim, citada pela marca `sha`: o trailer
 * `Conducao-Pergunta` da marca `autorizada` (D-VEGA19-39) ou o
 * `Conducao-Pergunta-Citada` de uma marca de consentimento herdada. null ⇒
 * marca legada.
 */
export function perguntaCitadaDaMarca(repo, sha, { rodar = rodarGit } = {}) {
  const tr = lerTrailers(rodar(repo, ["log", "-1", "--format=%b", sha]));
  const autorizada = /^Conducao: F\d{1,2} autorizada$/.test(rodar(repo, ["log", "-1", "--format=%s", sha]).trim());
  // Trailer da pergunta em marca de outra forma: recusa, nunca cai no caminho legado (fail-closed).
  if (tr[TRAILER.pergunta] && !autorizada && !tr[TRAILER.citada])
    throw new ErroPlano("pergunta-ilegivel", `${sha.slice(0, 8)} cita pergunta (${TRAILER.pergunta}) sem ser marca autorizada nem consentimento herdado`);
  const v = autorizada ? (tr[TRAILER.pergunta] ?? null) : (tr[TRAILER.citada] ?? null);
  if (v === null || v === undefined) return null;
  if (!PERGUNTA_ID_RE.test(v)) throw new ErroPlano("pergunta-ilegivel", `${sha.slice(0, 8)} cita pergunta fora da forma: ${JSON.stringify(v)}`);
  return v;
}

/**
 * Confere que a pergunta citada tem resposta do operador pela `origemEfetiva()`
 * do registro: `digitado`, `digitado-no-hub-conferido` ou `repasse-hub`.
 * `agente`, sem resposta, prova que não resolve ou registro ausente ⇒ recusa.
 * Registro fora do ar (`sem_registro`: só a fila local se leu) ⇒
 * `registro-fora`, distinto de "sem prova de origem humana" (D-VEGA19-41).
 */
export function exigirOrigemHumana(perguntas, pergunta_id) {
  if (!perguntas || typeof perguntas.origemEfetiva !== "function")
    throw new ErroPlano("origem-sem-prova", `sem registro de perguntas para conferir a origem de ${pergunta_id}: nada gravado (fail-closed)`);
  let o;
  try {
    o = perguntas.origemEfetiva(pergunta_id);
  } catch (e) {
    throw new ErroPlano("origem-sem-prova", `origem de ${pergunta_id} não se lê (${String(e?.message ?? e).split("\n")[0]}): nada gravado`);
  }
  return origemHumanaOuRecusa(o, pergunta_id);
}

/** A origem lida, ou a recusa: `registro-fora` antes de tudo, depois `origem-sem-prova`. */
function origemHumanaOuRecusa(o, pergunta_id) {
  if (o?.sem_registro === true)
    throw new ErroPlano("registro-fora", `o registro de perguntas está fora do ar: a origem de ${pergunta_id} não se confere agora (nada gravado; repita com o registro de pé)`);
  if (!ORIGENS_HUMANAS.includes(o?.origem))
    throw new ErroPlano("origem-sem-prova", `a resposta de ${pergunta_id} não tem prova de origem humana (${o?.origem ?? "sem resposta"}${o?.motivo ? `, ${o.motivo}` : ""}): o sim herdado não vale${typeof o?.conserto === "string" && o.conserto ? ` — ${o.conserto}` : ""}`);
  return o.origem;
}

/** O id de uma sessão (a forma do `session_id` do host). */
const SESSAO_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Em 3 níveis o operador responde à pergunta da condutora na sessão da maestra
 * (hotfix vega-maestra-leva-pergunta). A condutora só aplica a decisão depois
 * de conferir, pela `origemEfetiva()` do registro, que a resposta é um turno
 * do operador nesta sessão (`digitado`) ou na sessão da SUA maestra
 * (`digitado-no-hub-conferido`, com o recibo nessa sessão e o `get_event`
 * dela já conferido pelo gancho). O texto da mensagem da maestra nunca conta:
 * a prova é o evento do operador, relido pela plataforma.
 *   — sem resposta ⇒ `resposta-ausente` (a pergunta segue aberta: esperar);
 *   — registro fora ⇒ `registro-fora`; sem registro ⇒ `registro-nao-declarado`;
 *   — `digitado-no-hub-conferido` de outra sessão ⇒ `resposta-de-outra-sessao`;
 *   — `repasse-hub` (recibo não conferido) ⇒ `recibo-nao-conferido`;
 *   — `agente` ou prova que não resolve ⇒ `origem-sem-prova`.
 * Devolve `{ origem, recibo }`.
 */
export function exigirRespostaDaMaestra({ perguntas, pergunta_id, maestra }) {
  if (!PERGUNTA_ID_RE.test(pergunta_id ?? "")) throw new ErroPlano("pergunta-ausente", `exige --pergunta <p-…>, veio ${JSON.stringify(pergunta_id ?? null)}`);
  if (!SESSAO_RE.test(maestra ?? "")) throw new ErroPlano("maestra-ausente", `exige --maestra <id da maestra da entrada>, veio ${JSON.stringify(maestra ?? null)}`);
  if (!perguntas || typeof perguntas.origemEfetiva !== "function")
    throw new ErroPlano("registro-nao-declarado", `sem registro de perguntas para conferir quem respondeu ${pergunta_id}: nada aplicado (fail-closed)`);
  let o;
  try {
    o = perguntas.origemEfetiva(pergunta_id);
  } catch (e) {
    throw new ErroPlano("origem-sem-prova", `a origem de ${pergunta_id} não se lê (${String(e?.message ?? e).split("\n")[0]}): nada aplicado`);
  }
  if (o?.sem_registro === true)
    throw new ErroPlano("registro-fora", `o registro de perguntas está fora do ar: quem respondeu ${pergunta_id} não se confere agora (repita com o registro de pé)`);
  if (o?.origem == null) throw new ErroPlano("resposta-ausente", `${pergunta_id} ainda não tem resposta no registro: rodar comando.mjs responder com o texto do evento do recibo, ou esperar`);
  if (o.origem === "digitado") return { origem: o.origem, recibo: null };
  const sessaoDoRecibo = String(o.recibo ?? "").trim().split(/\s+/)[0] || null;
  if (o.origem === "digitado-no-hub-conferido") {
    if (sessaoDoRecibo !== maestra)
      throw new ErroPlano("resposta-de-outra-sessao", `a resposta de ${pergunta_id} veio da sessão ${JSON.stringify(sessaoDoRecibo)}, não da maestra ${maestra}: em 3 níveis só a maestra do ciclo leva a resposta do operador`);
    return { origem: o.origem, recibo: o.recibo };
  }
  if (o.origem === "repasse-hub")
    throw new ErroPlano("recibo-nao-conferido", `a resposta de ${pergunta_id} chegou por repasse sem o get_event do recibo conferido (${o.motivo ?? "sem motivo"}): chamar get_event com a sessão e o evento do Recibo no mesmo turno, e conferir de novo`);
  throw new ErroPlano("origem-sem-prova", `a resposta de ${pergunta_id} não tem prova de origem humana (${o.origem}${o.motivo ? `, ${o.motivo}` : ""}): nada aplicado`);
}

/**
 * A convenção da pergunta do `autorizar-ciclo` (D-VEGA19-44): a abertura
 * grava `ciclo` = o ciclo e `ponteiro` = este prefixo + a fase (`F<n>`), com
 * um item só; a opção que autoriza é a de texto byte a byte igual ao `--sim`.
 */
export const PONTEIRO_DO_AUTORIZAR = "autorizar-ciclo:";

/**
 * As paradas da condução cuja resposta pode pedir re-plano da fase (a vigia, o CI, a pergunta da
 * operária, o trazer que pede aprovação): só a pergunta delas, citada em `Replano-Pergunta`, vale como o sim da fase
 * (hotfix conducao-corta-paradas-de-regra). Ponteiro `conducao:<motivo>:<id>` de outro motivo recusa.
 */
export const PARADAS_QUE_REPLANEJAM = Object.freeze([
  "ci-vermelho",
  "pergunta-da-filha",
  "segunda-falha",
  "teto-de-falhas",
  "teto-de-falhas-ambiente",
  "filha-sumiu",
  "tentativa-sem-filha",
  "prazo-vencido",
  "replano-repetido",
  "trazer-exige-aprovacao",
]);

/** Trailer da marca autorizada pela resposta de uma parada: as conferências da herança o releem. */
export const TRAILER_PERGUNTA_DA_PARADA = "Conducao-Pergunta-Parada";

/**
 * Confere que a pergunta citada pelo `autorizar-ciclo --pergunta` (ou pela
 * marca de origem de uma herança) prova o sim DESTE ciclo e DESTA fase
 * (D-VEGA19-41, D-VEGA19-44). O registro devolve, por
 * `perguntas.perguntaDoAutorizar(id, pedido)`, `{ origem, motivo,
 * sem_registro, abertura, escolhas }` — `pedido` (`{ ciclo, fase, sim }`) só
 * o dublê do projeto de teste usa; o registro real o ignora e a conferência é
 * toda daqui:
 *   — registro fora ⇒ `registro-fora`; origem não humana ⇒ `origem-sem-prova`;
 *   — sem abertura ⇒ `pergunta-sem-abertura`; abertura de outro ciclo ⇒
 *     `pergunta-de-outro-ciclo`; ponteiro diferente de `autorizar-ciclo:<fase>`
 *     ⇒ `pergunta-de-outra-fase` — salvo, com `aceitaParada`, o `conducao:<motivo>:<id>` da
 *     parada cuja resposta pediu o re-plano desta fase (trailer `Replano-Pergunta`), ou a pergunta
 *     registrada deste ciclo de ponteiro livre (nem `autorizar-ciclo:` nem `conducao:`), aberta fora de task;
 *     mais de um item ⇒ `pergunta-fora-da-convencao`;
 *   — nenhuma opção (ou mais de uma) com o texto do `sim` ⇒ `sim-diferente-da-pergunta`
 *     (os dois lados no mesmo aparo, `trim()`: o `--sim` cru e a opção, como o `simDoCorpo` da
 *     marca relida; D-VEGA19-48);
 *   — a resposta não escolhe só essa letra ("não", outra letra) ⇒ `resposta-nao-autoriza`;
 *     resposta literal "sim" sem `escolhas` também: ela vira a escolha `sim`, não a letra da
 *     opção, e "sim" casaria qualquer sim do operador na sessão (D-VEGA19-44, D-VEGA19-48) — a
 *     resposta do autorizar escolhe a letra (`D1a`, `a`);
 *   — outra marca `autorizada` não herdada já cita a pergunta ⇒ `pergunta-reusada`
 *     (`marca`: a própria marca de origem, na herança, não conta).
 */
export function exigirPerguntaDoAutorizar({ repo, perguntas, pergunta_id, ciclo, fase, sim, marca = null, aceitaParada = false, paradaAbertaDesde = null, aoAceitarParada = null, rodar = rodarGit }) {
  if (!perguntas || typeof perguntas.perguntaDoAutorizar !== "function")
    throw new ErroPlano("registro-nao-declarado", `o registro de perguntas não lê a pergunta do autorizar (perguntaDoAutorizar): ${pergunta_id} não se confere, nada gravado (fail-closed)`);
  let r;
  try {
    r = perguntas.perguntaDoAutorizar(pergunta_id, Object.freeze({ ciclo, fase, sim }));
  } catch (e) {
    throw new ErroPlano("origem-sem-prova", `a pergunta ${pergunta_id} não se lê (${String(e?.message ?? e).split("\n")[0]}): nada gravado`);
  }
  const origem = origemHumanaOuRecusa(r, pergunta_id);
  const ab = r?.abertura ?? null;
  if (!ab || ab.pergunta_id !== pergunta_id) throw new ErroPlano("pergunta-sem-abertura", `a pergunta ${pergunta_id} não tem abertura no registro: o sim não se confere`);
  if (ab.ciclo !== ciclo) throw new ErroPlano("pergunta-de-outro-ciclo", `a pergunta ${pergunta_id} é do ciclo ${JSON.stringify(ab.ciclo ?? null)}, não de ${ciclo}: não autoriza este ciclo`);
  // A pergunta de uma parada da condução (`conducao:<motivo>:<id>`) cuja resposta pediu o re-plano
  // desta fase vale como o sim dela, quando quem chama provou a ligação pelo trailer
  // `Replano-Pergunta` (`aceitaParada`; hotfix conducao-corta-paradas-de-regra). O resto da conferência é o mesmo.
  // A parada é desta fase: aberta depois da autorização que o re-plano mudou (`paradaAbertaDesde`, epoch s).
  // Sem carimbo na abertura, ou sem a hora, não liga: recusa (a releitura da herança não passa a hora:
  // a ligação foi conferida ao gravar a marca).
  const abertaEm = Date.parse(ab.carimbo ?? "") / 1000;
  const nestaFase = paradaAbertaDesde === null ? marca !== null : Number.isFinite(abertaEm) && abertaEm >= paradaAbertaDesde;
  // A pergunta registrada deste ciclo aberta fora de task (ponteiro livre: nem `autorizar-ciclo:` nem
  // `conducao:`) também liga, pelas mesmas conferências (T38 do VEGA-20, AC-VEGA20-17).
  const ponteiroLivre = ab.ponteiro == null || (typeof ab.ponteiro === "string" && !ab.ponteiro.startsWith(PONTEIRO_DO_AUTORIZAR) && !ab.ponteiro.startsWith("conducao:"));
  const daParadaDaConducao = typeof ab.ponteiro === "string" && ab.ponteiro.startsWith("conducao:") && PARADAS_QUE_REPLANEJAM.includes(ab.ponteiro.split(":")[1] ?? "");
  const daParada = aceitaParada === true && nestaFase && (daParadaDaConducao || ponteiroLivre);
  if (ab.ponteiro !== `${PONTEIRO_DO_AUTORIZAR}${fase}` && !daParada)
    throw new ErroPlano("pergunta-de-outra-fase", `a pergunta ${pergunta_id} aponta ${JSON.stringify(ab.ponteiro ?? null)}, não ${PONTEIRO_DO_AUTORIZAR}${fase}: não autoriza esta fase`);
  const itens = Array.isArray(ab.itens) ? ab.itens : [];
  if (itens.length !== 1) throw new ErroPlano("pergunta-fora-da-convencao", `a pergunta ${pergunta_id} tem ${itens.length} itens: a do autorizar tem um só (D-VEGA19-44)`);
  const aparado = String(sim ?? "").trim();
  const autorizam = (itens[0].opcoes ?? []).filter((o) => typeof o?.texto === "string" && o.texto.trim() === aparado);
  if (autorizam.length !== 1)
    throw new ErroPlano("sim-diferente-da-pergunta", `nenhuma opção da pergunta ${pergunta_id} tem, byte a byte, o texto do --sim${autorizam.length > 1 ? " (mais de uma tem)" : ""}: o sim gravado é o texto da opção que autoriza`);
  // A opção que autoriza é uma letra (D-VEGA19-44): `sim` casaria qualquer "sim" do operador na sessão.
  const letra = /^[a-z]$/i.test(String(autorizam[0].letra ?? "")) ? String(autorizam[0].letra).toLowerCase() : "";
  const escolhas = Array.isArray(r.escolhas) ? r.escolhas : [];
  const numero = itens[0].numero ?? null;
  const escolheu =
    escolhas.length === 1 &&
    String(escolhas[0]?.letra ?? "").toLowerCase() === letra &&
    (escolhas[0].numero == null || numero == null || Number(escolhas[0].numero) === Number(numero));
  if (!letra || !escolheu)
    throw new ErroPlano("resposta-nao-autoriza", `a resposta de ${pergunta_id} não escolhe a opção que autoriza (${letra || "?"}): ${JSON.stringify(escolhas.map((e) => `${e?.numero ?? ""}${e?.letra ?? ""}`))}`);
  const usos = marcasQueCitamAPergunta(repo, pergunta_id, { rodar }).filter((sha) => !marca || !sha.startsWith(marca));
  if (usos.length > 0)
    throw new ErroPlano("pergunta-reusada", `a pergunta ${pergunta_id} já autorizou ${usos[0].slice(0, 8)}: uma pergunta autoriza uma marca só`);
  // O sim veio da pergunta de uma parada: quem grava a marca é avisado (`Conducao-Pergunta-Parada`).
  if (daParada && ab.ponteiro !== `${PONTEIRO_DO_AUTORIZAR}${fase}` && typeof aoAceitarParada === "function") aoAceitarParada();
  return origem;
}

/**
 * As conferências da pergunta citada por uma marca de origem (`sha`) — a do caso herdado e a do
 * `pergunta-repetida` —, as mesmas do `autorizar-ciclo` (D-VEGA19-48): sobe da marca até a
 * `autorizada` não herdada em que o operador deu o sim (pela `Conducao-Herdada` da autorizada, ou
 * pela `Conducao-Origem-Sim` de um consentimento herdado) e confere, por
 * `exigirPerguntaDoAutorizar`, o ciclo, a fase e o sim DELA, com a própria marca do sim fora da
 * contagem de reuso. A cadeia que não chega a uma `autorizada` que cite a pergunta ⇒
 * `pergunta-ilegivel`. Devolve a origem humana.
 */
export function exigirPerguntaCitadaDaMarca({ repo, perguntas, pergunta_id, ciclo, sha, rodar = rodarGit }) {
  let raiz = sha;
  for (let i = 0; ; i++) {
    if (i >= 64) throw new ErroPlano("pergunta-ilegivel", `a cadeia de ${String(sha).slice(0, 8)} não chega à marca do sim`);
    if (!/^[0-9a-f]{40}$/.test(raiz ?? "")) throw new ErroPlano("pergunta-ilegivel", `a cadeia de ${String(sha).slice(0, 8)} passa por ${JSON.stringify(raiz ?? null)}, fora da forma de sha`);
    const subject = rodar(repo, ["log", "-1", "--format=%s", raiz]).trim();
    const tr = lerTrailers(rodar(repo, ["log", "-1", "--format=%b", raiz]));
    if (/^Conducao: F\d{1,2} autorizada$/.test(subject)) {
      if (!tr["Conducao-Herdada"]) break;
      raiz = tr["Conducao-Herdada"];
    } else if (SUBJECT_RE.test(subject) && tr[TRAILER.citada]) raiz = tr[TRAILER.origem];
    else throw new ErroPlano("pergunta-ilegivel", `${raiz.slice(0, 8)} não é marca autorizada nem consentimento herdado: ${JSON.stringify(subject)}`);
  }
  const fase = /^Conducao: (F\d{1,2}) autorizada$/.exec(rodar(repo, ["log", "-1", "--format=%s", raiz]).trim())[1];
  const tr = lerTrailers(rodar(repo, ["log", "-1", "--format=%b", raiz]));
  if (tr[TRAILER.pergunta] !== pergunta_id)
    throw new ErroPlano("pergunta-ilegivel", `${String(sha).slice(0, 8)} cita ${pergunta_id}, a marca do sim ${raiz.slice(0, 8)} não`);
  const sim = simDoCorpo(rodar(repo, ["log", "-1", "--format=%b", raiz]));
  // A marca autorizada pela resposta de uma parada (a citação foi conferida ao gravá-la) relê igual.
  const aceitaParada = tr[TRAILER_PERGUNTA_DA_PARADA] === "sim";
  return exigirPerguntaDoAutorizar({ repo, perguntas, pergunta_id, ciclo, fase, sim, marca: raiz, aceitaParada, rodar });
}

/**
 * As marcas `Conducao: F<n> autorizada` do HEAD que citam `pergunta_id` pelo
 * trailer `Conducao-Pergunta` e não são herdadas (sem `Conducao-Herdada` na
 * forma de SHA inteiro: a herança leva a pergunta da origem, não a usa de
 * novo; trailer torto conta como uso).
 */
export function marcasQueCitamAPergunta(repo, pergunta_id, { rodar = rodarGit } = {}) {
  const bruto = rodar(repo, ["log", "-F", `--grep=${pergunta_id}`, `--format=%H${SEP_CAMPO}%s${SEP_CAMPO}%b${SEP_REG}`, "HEAD"]);
  const out = [];
  for (const reg of bruto.split(SEP_REG)) {
    const [sha, subject, corpo = ""] = reg.replace(/^\n/, "").split(SEP_CAMPO);
    if (!sha || !/^Conducao: F\d{1,2} autorizada$/.test(String(subject).trim())) continue;
    const tr = lerTrailers(corpo);
    if (tr[TRAILER.pergunta] === pergunta_id && !/^[0-9a-f]{40}$/.test(tr["Conducao-Herdada"] ?? "")) out.push(sha.trim());
  }
  return out;
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
        tentativa: tr[TRAILER.tentativa] ?? null,
        pergunta: tr[TRAILER.pergunta] ?? null,
        citada: tr[TRAILER.citada] ?? null,
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
  if (!/(^|\/)__tests__$/.test(dir)) {
    // `contrato-atual.md`: algum Output de código no mesmo diretório.
    return codigo.some((o) => diretorio(o) === dir);
  }
  // Teste: só o que leva o nome de um Output de código do diretório pai
  // (`<raiz>/__tests__/<nome>[-<sufixo>].test.mjs` para `<raiz>/<nome>.<ext>`);
  // teste qualquer no diretório não acompanha (débito `consentimento-acompanha-o-codigo-teste-irrestrito`).
  const raiz = dir === "__tests__" ? "" : dir.slice(0, -"/__tests__".length);
  const nome = caminho.slice(dir.length + 1).replace(/\.test\.mjs$/, "");
  return codigo.some((o) => {
    if (diretorio(o) !== raiz) return false;
    const base = o.slice(raiz.length ? raiz.length + 1 : 0).replace(/\.[^./]+$/, "");
    return nome === base || nome.startsWith(`${base}-`);
  });
}

/**
 * O que o `trazer` deixa de perguntar por consentimento, dado um motivo
 * (`alcance-dos-hooks` ou `superficie-de-instrucao`) e seus caminhos:
 *   — caminho que é ARQUIVO declarado em Outputs e não está em
 *     `SEGUEM_PERGUNTANDO_DECLARADO` ⇒ `instrucao-declarada-em-outputs`
 *     (D-VEGA37-22; `.vega/**` declarado entra, D-VEGA19-32);
 *   — teste ou contrato do motor que acompanha o código declarado ⇒
 *     `teste-que-acompanha-o-codigo` (D-VEGA37-27).
 * Caminho que casa as instruções de sessão que o adaptador declara
 * (`instrucoes`, `sessao.instrucoes`) nunca é consentido por declaração nem por repetição,
 * mesmo declarado (D-VEGA37-45) — só pelo carimbo que aprova a ponta (D1a, hotfix conducao-corta-paradas-de-regra). A regra lê o campo, nunca uma lista de nomes.
 * Com `carimbo` que cobre a ponta (`carimboCobreAPonta`), o que sobrou — fora
 * dos Outputs, ou declarado e em `SEGUEM_PERGUNTANDO_DECLARADO` — vira
 * `coberto-pelo-carimbo`, menos `NUNCA_PELO_CARIMBO` (D-VEGA19-58).
 * Devolve `{ restantes, consentidos: [{ caso, motivo, caminhos }] }`.
 */
export function consentidoNoTrazer({ motivo, caminhos, outputs, instrucoes = [], carimbo = null }) {
  const declarados = [];
  const acompanham = [];
  const restantes = [];
  const sessao = [];
  for (const c of caminhos) {
    if (casaAlgum(c, instrucoes)) sessao.push(c);
    else if (outputs.includes(c) && !casaAlgum(c, SEGUEM_PERGUNTANDO_DECLARADO)) declarados.push(c);
    else if (acompanhaOCodigo(c, outputs)) acompanham.push(c);
    else restantes.push(c);
  }
  // D-VEGA19-58: o que sobrou, a revisão aprovada da tentativa cobre — menos o que muda a regra que ela seguiu.
  // D1a (hotfix conducao-corta-paradas-de-regra): as instruções de sessão do adaptador também.
  const cobre = carimboCobreAPonta(carimbo);
  const pelaRevisao = cobre ? [...sessao, ...restantes].filter((c) => !casaAlgum(c, NUNCA_PELO_CARIMBO)) : [];
  const consentidos = [];
  if (declarados.length) consentidos.push({ caso: CASOS.instrucaoDeclaradaEmOutputs, motivo, caminhos: declarados });
  if (acompanham.length) consentidos.push({ caso: CASOS.testeQueAcompanhaOCodigo, motivo, caminhos: acompanham });
  if (pelaRevisao.length) consentidos.push({ caso: CASOS.cobertoPeloCarimbo, motivo, caminhos: pelaRevisao, carimbo: carimbo.caminho ?? null });
  const ficam = new Set([...sessao, ...restantes].filter((c) => !pelaRevisao.includes(c)));
  return { restantes: caminhos.filter((c) => ficam.has(c)), consentidos };
}

// ── o que a revisão aprovada cobre no trazer (T46, D-VEGA19-58) ─────────────

/**
 * O que segue perguntando no `trazer` mesmo com carimbo `APPROVED` cobrindo a
 * ponta: registro de hook (`settings*.json`, `hooks.json`, o registro com nome
 * próprio do host e os despachantes de guard), os guards (`*-guard.*`,
 * `*-gate.*`, as libs que lhes dão modo) e todo arquivo de modo (`*-mode`) —
 * mudam a regra que a própria revisão seguiu. Em `state/` segue perguntando só
 * a configuração dos guards (D-VEGA19-61): os arquivos de modo (`*-mode`) e de
 * limiar (`*-threshold`), o registro de modos (`guard-mode-registry.json`), a
 * lista de liberação do git-guard (`git-guard-allow*`) e os esquemas que um
 * guard valida (`*-schema.json`); o resto de `state/` — `operators.json`, os
 * carimbos, os contratos — o carimbo cobre. Desde a D1a do hotfix
 * conducao-corta-paradas-de-regra (20/11/2026), também dependência e instalação
 * seguem parando, e as instruções de sessão do adaptador e o canonico do ciclo
 * passam a seguir pelo carimbo, com aviso; o caminho clínico fora dos Outputs
 * segue parando (outro motivo).
 */
export const NUNCA_PELO_CARIMBO = Object.freeze([
  // D1a do hotfix conducao-corta-paradas-de-regra (20/11/2026): dependência e instalação seguem
  // parando com carimbo — decidem o que roda na máquina (D-VEGA37-29, D-VEGA37-40) —, e o hook do git
  // e o passo do CI que cobra o carimbo: são registro de hook e guard, e mudam a regra da revisão.
  ...DEPENDENCIA_E_INSTALACAO,
  ".husky/**",
  ".*/scripts/review-carimbo-ci.mjs",
  "**/settings*.json",
  "**/hooks.json",
  ".*/hooks/*.json",
  ...DESPACHANTES_DE_GUARD,
  "**/*-guard.js",
  "**/*-guard.mjs",
  "**/*-guard.cjs",
  "**/*-gate.js",
  "**/*-gate.mjs",
  "**/*-gate.cjs",
  // Fechamento de F3: o guard com o papel no meio do nome (`gap3-sql-guard-dml-extension.js`,
  // `frontmatter-guard-serena.js`; casa também teste de guard, do lado seguro) e a lib que o
  // `publicacao-gate.js` usa para liberar a publicação — publicação segue perguntando (D-VEGA19-58).
  "**/*-guard-*.js",
  "**/*-guard-*.mjs",
  "**/*-guard-*.cjs",
  "**/hooks/lib/publicacao-liberacao-ciclo.mjs",
  "**/hooks/lib/read-mode-file.js",
  "**/hooks/lib/modo-do-guarda.js",
  ".*/state/**/*-threshold",
  ".*/state/guard-mode-registry.json",
  ".*/state/git-guard-allow*",
  ".*/state/**/*-schema.json",
  "**/*-mode",
]);

const REVIEWERS_LEVE_RE = /^\[?\s*gerado\b/i;
const APPROVED_RE = /^["']?\s*APPROVED\b/i;
const SHA_DO_CARIMBO_RE = /^[0-9a-f]{8,40}$/;

/**
 * Os campos do carimbo de revisão (`sha:` · `reviewers:` · `veredito:`), aparados;
 * campo ausente ⇒ "". Puro.
 */
export function camposDoCarimbo(texto) {
  const t = String(texto ?? "");
  const campo = (n) => new RegExp(`^${n}:[ \\t]*(.*)$`, "m").exec(t)?.[1]?.trim() ?? "";
  return { sha: campo("sha"), reviewers: campo("reviewers"), veredito: campo("veredito") };
}

/**
 * O carimbo da tentativa cobre a ponta trazida (D-VEGA19-58): `veredito:
 * APPROVED`, `reviewers:` de revisor real (não vazio, não `gerado`/leve) e
 * `sha:` que é o último commit não-prosa da faixa (`ultimo`) ou o `de` de um
 * carimbo órfão (`orfao`) cujo `para` é esse commit ou a ponta. `carimbo` =
 * `{ sha, reviewers, veredito, ultimo, ponta, orfao, publicacao }`; task com
 * publicação nunca é coberta. Falta qualquer peça ⇒ false. Puro.
 */
export function carimboCobreAPonta(carimbo) {
  if (!carimbo || carimbo.publicacao) return false;
  const sha = String(carimbo.sha ?? "").toLowerCase();
  const reviewers = String(carimbo.reviewers ?? "").trim();
  if (!SHA_DO_CARIMBO_RE.test(sha) || !APPROVED_RE.test(String(carimbo.veredito ?? "").trim())) return false;
  if (!reviewers || /^\[\s*\]$/.test(reviewers) || REVIEWERS_LEVE_RE.test(reviewers)) return false;
  const ultimo = String(carimbo.ultimo ?? "");
  if (/^[0-9a-f]{40}$/.test(ultimo) && ultimo.startsWith(sha)) return true;
  const o = carimbo.orfao;
  if (!o || !/^[0-9a-f]{40}$/.test(o.de ?? "") || !o.de.startsWith(sha)) return false;
  return Boolean(o.para) && (o.para === ultimo || o.para === carimbo.ponta);
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
  return { sim, quando: quando.trim(), pergunta: perguntaCitadaDaMarca(repo, origem, { rodar }) };
}

/**
 * O gate irmão do de PHI para os casos herdados (`heranca-entre-fases`,
 * `replano-sem-mudanca-de-classe`, `replano-sozinho`, `sensivel-aditiva-na-ordem`,
 * `pergunta-repetida`): o texto que o caso grava já está no git, no corpo da
 * marca de origem, e o gate só aceita texto idêntico, byte a byte, a esse
 * corpo. Mesma forma `{ recusar, mensagem }` do gate de PHI, para entrar como
 * `gate` de `conferirConsentimento` (o gate do caso), ao lado do `phi` do
 * projeto — os dois sobre o mesmo texto, desde a T16 (D-VEGA19-46).
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
 * pela conferência com `gateDaMarcaDeOrigem` como gate do caso, junto do de PHI.
 * `sim` explícito (só os testes e a prova o dão) passa pelo mesmo gate e é
 * recusado se não for o corpo da origem. Devolve os `{ sha, registro }`.
 */
export function gravarCasosHerdados({ repo, ciclo, pedidos = [], quem, cerca, sim = null, pecas = null, rodar = rodarGit }) {
  const preparados = prepararCasosHerdados({ repo, ciclo, pedidos, quem, sim, pecas, rodar });
  return escreverCasosHerdados({ repo, preparados, cerca, rodar });
}

/**
 * A primeira metade de `gravarCasosHerdados`, sem escrever nada: para cada
 * pedido, lê o sim da marca de origem, confere o gate byte a byte, o de PHI do
 * projeto (`recusarPhiDoConsentimento` na Sistoli, veredito da T4) e — com a
 * pergunta citada pela marca (`Conducao-Pergunta`, D-VEGA19-39) — as mesmas
 * conferências da pergunta citada pelo `autorizar-ciclo`
 * (`exigirPerguntaCitadaDaMarca`: ciclo, fase, opção do sim, resposta que a
 * escolhe, uso único; D-VEGA19-48). Marca legada, sem a pergunta, segue o
 * caminho antigo (só git). Qualquer recusa lança antes da primeira escrita:
 * quem chama confere a herança e só então escreve
 * (débito `conducao-gravar-casos-herdados-antes-da-heranca`).
 */
export function prepararCasosHerdados({ repo, ciclo, pedidos = [], quem, sim = null, pecas = null, rodar = rodarGit }) {
  const pc = pecas ?? pecasDoConsentimento(repo);
  const { phi, perguntas } = pc;
  const semFiltroDoProjeto = semFiltroDe(pc);
  const out = [];
  for (const p of pedidos.filter(Boolean)) {
    const origem = simDaMarcaDeOrigem(repo, p.origem, { rodar });
    const citada = origem.pergunta;
    // Pergunta citada sem registro que a confira recusa pelo motivo da carga (D-VEGA19-41).
    if (citada) exigirPerguntaCitadaDaMarca({ repo, perguntas: registroDoConsentimento(pc, citada), pergunta_id: citada, ciclo, sha: p.origem, rodar });
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
      citada,
    };
    const registroDePerguntas = citada ? perguntas : null;
    const conferido = conferirConsentimento({ registro, gate: gateDaMarcaDeOrigem(origem.sim), phi, semFiltroDoProjeto, perguntas: registroDePerguntas, origem_resposta: "agente", ponteiro: citada });
    out.push({ conferido, perguntas: registroDePerguntas });
  }
  return out;
}

/** A segunda metade: escreve os casos já conferidos por `prepararCasosHerdados`. Devolve os `{ sha, registro, pergunta }`. */
export function escreverCasosHerdados({ repo, preparados = [], cerca, rodar = rodarGit }) {
  if (typeof cerca !== "function") throw new ErroPlano("sem-cerca", "consentimento sem a cerca da posse: nada gravado");
  return preparados.map(({ conferido, perguntas }) => escreverConsentimento({ repo, conferido, perguntas, cerca, rodar }));
}

// ── o registro do trazer e o gate do plano (T33, D-VEGA37-34, D-VEGA37-35) ──

const SECAO_15_RE = /^###\s+1\.5\b/;
const TITULO_RE = /^#{1,3}\s/;
const MAPA_RE = /^\*\*Consentimentos:\*\*(.*)$/;
const PAR_RE = /`([a-z][a-z0-9-]*)`\s*→\s*(D-[A-Za-z0-9]+-\d+|pergunta)(?![\w-])/g;
/** O valor da linha `**Consentimentos:**` que devolve o caso à pergunta (D-VEGA19-29). */
export const RESTRICAO_PERGUNTA = "pergunta";

/** As linhas do canonico, sem `\r`. */
function linhasDoCanonico(canonico) {
  return typeof canonico === "string" ? canonico.split("\n").map((l) => l.replace(/\r$/, "")) : [];
}

/**
 * A linha `**Consentimentos:**` do §1.5 do canonico, lida: `estado` é
 * `ausente` (sem a linha em lugar nenhum), `uma`, `varias` (mais de uma linha
 * no §1.5, ambíguo) ou `ilegivel` (linha fora do §1.5, caso desconhecido, ou
 * seta que nenhum par consumiu); `pares` é caso → id de decisão ou `pergunta`; `repetidos`,
 * os casos que aparecem duas vezes na linha (ambíguos, fora de `pares`).
 */
export function linhaDeConsentimentos(canonico) {
  const vazia = { estado: "ausente", pares: new Map(), repetidos: new Set() };
  const ilegivel = { ...vazia, estado: "ilegivel" };
  const linhas = linhasDoCanonico(canonico);
  const todas = linhas.flatMap((l, i) => (MAPA_RE.test(l) ? [i] : []));
  const inicio = linhas.findIndex((l) => SECAO_15_RE.test(l));
  if (inicio < 0) return todas.length ? ilegivel : vazia;
  const fimRel = linhas.slice(inicio + 1).findIndex((l) => TITULO_RE.test(l));
  const fim = fimRel < 0 ? linhas.length : inicio + 1 + fimRel;
  // A linha fora do §1.5 (heading renomeado, linha no lugar errado) não some: o caso pergunta.
  if (todas.some((i) => i <= inicio || i >= fim)) return ilegivel;
  const doMapa = linhas.slice(inicio + 1, fim).map((l) => MAPA_RE.exec(l)).filter(Boolean);
  if (!doMapa.length) return vazia;
  if (doMapa.length > 1) return { ...vazia, estado: "varias" };
  const pares = new Map();
  const repetidos = new Set();
  for (const [, caso, alvo] of doMapa[0][1].matchAll(PAR_RE)) {
    if (!NOMES_DOS_CASOS.has(caso)) return ilegivel;
    if (pares.has(caso)) repetidos.add(caso);
    pares.set(caso, alvo);
  }
  // Seta que nenhum par consumiu (`→ Pergunta`, `->`, `⇒`) ou caso citado fora de um par (`` `x`: pergunta ``,
  // caso sem crase) é restrição que não se lê: o caso pergunta, nunca cai no padrão.
  const resto = doMapa[0][1].replace(PAR_RE, "");
  if (/→|⇒|⟶|->|=>/.test(resto) || [...NOMES_DOS_CASOS].some((n) => resto.includes(n))) return ilegivel;
  for (const caso of repetidos) pares.delete(caso);
  return { estado: "uma", pares, repetidos };
}

/**
 * O mapa caso → id de decisão da linha `**Consentimentos:**` do §1.5 do
 * canonico (D-VEGA37-35). Fail-closed: sem §1.5, sem a linha, ou com mais de
 * uma linha no §1.5 ⇒ mapa vazio; caso que aparece duas vezes na linha sai do
 * mapa (ambíguo); caso apontado a `pergunta` não entra (D-VEGA19-29).
 */
export function mapaDeConsentimentos(canonico) {
  const { pares } = linhaDeConsentimentos(canonico);
  return new Map([...pares].filter(([, alvo]) => alvo !== RESTRICAO_PERGUNTA));
}

// ── o padrão da fábrica (T27, D-VEGA19-29) ──────────────────────────────────

/** Os casos do `trazer` que valem em todo ciclo pelo padrão da fábrica (D-VEGA19-29). */
export const CASOS_DO_PADRAO = Object.freeze([CASOS.instrucaoDeclaradaEmOutputs, CASOS.testeQueAcompanhaOCodigo, CASOS.telaDosSteps]);
/** O que o padrão da fábrica grava: os três casos e o que a revisão aprovada cobre (D-VEGA19-58). */
export const CASOS_QUE_O_PADRAO_GRAVA = Object.freeze([...CASOS_DO_PADRAO, CASOS.cobertoPeloCarimbo]);
/** A origem gravada no registro do caso consentido pelo padrão da fábrica. */
export const ORIGEM_DO_PADRAO = "padrao-da-fabrica";
const SECAO_PADRAO_RE = /^##\s+Padrão da fábrica\s*$/;
const ROTULO_PADRAO = "**Padrão da fábrica:** ";

/**
 * O corpo exato do padrão da fábrica no `contrato.md` da condução: a única
 * linha que começa com `**Padrão da fábrica:** `, dentro da única seção
 * `## Padrão da fábrica`. Fail-closed: contrato sem a seção, com ela
 * duplicada, sem a linha ou com mais de uma ⇒ null, e o caso pergunta.
 */
export function padraoDaFabrica(contrato) {
  const linhas = linhasDoCanonico(contrato);
  const secoes = linhas.flatMap((l, i) => (SECAO_PADRAO_RE.test(l) ? [i] : []));
  if (secoes.length !== 1) return null;
  const rotuladas = linhas.flatMap((l, i) => (l.startsWith(ROTULO_PADRAO) ? [i] : []));
  if (rotuladas.length !== 1) return null;
  const fimRel = linhas.slice(secoes[0] + 1).findIndex((l) => /^#{1,2}\s/.test(l));
  const fim = fimRel < 0 ? linhas.length : secoes[0] + 1 + fimRel;
  if (rotuladas[0] <= secoes[0] || rotuladas[0] >= fim) return null;
  return texto(linhas[rotuladas[0]].slice(ROTULO_PADRAO.length));
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

function gateDoCorpo(corpo, fonte, caso) {
  return (entrada) =>
    entrada?.corpo === corpo
      ? { recusar: false }
      : { recusar: true, mensagem: `texto fora do plano: só o corpo exato de ${fonte} vale para ${caso}` };
}

/**
 * O gate do plano para um caso do `trazer` (D-VEGA37-34, D-VEGA19-29): o
 * corpo que o caso grava e o gate que aceita só esse corpo, byte a byte —
 * substring, normalização e texto vindo de mensagem são recusados. Mesma forma
 * `{ recusar, mensagem }` do gate de PHI, para entrar como `phi` de
 * `gravarConsentimento`. Em ordem:
 *   — linha `**Consentimentos:**` duplicada no §1.5, ilegível ou fora dele, ou o caso repetido nela ⇒ null;
 *   — `` `<caso>` → pergunta `` ⇒ null: a linha devolve o caso à pergunta;
 *   — `` `<caso>` → D-… `` ⇒ o corpo daquela decisão no canonico (null se ausente);
 *   — sem par: caso de `CASOS_DO_PADRAO` com o canonico lido e o `contrato`
 *     com a seção do padrão ⇒ o corpo do padrão, `origem` `padrao-da-fabrica`;
 *     qualquer outro ⇒ null, o caso pergunta.
 * Devolve `{ decisao, origem, corpo, gate }` ou null.
 */
export function gateDoPlano(canonico, caso, { contrato = null } = {}) {
  const linha = linhaDeConsentimentos(canonico);
  if (linha.estado === "varias" || linha.estado === "ilegivel" || linha.repetidos.has(caso)) return null;
  const alvo = linha.pares.get(caso);
  if (alvo === RESTRICAO_PERGUNTA) return null;
  if (alvo) {
    const corpo = corpoDaDecisao(canonico, alvo);
    if (!corpo) return null;
    return Object.freeze({ decisao: alvo, origem: null, corpo, gate: gateDoCorpo(corpo, `${alvo} no canonico do HEAD`, caso) });
  }
  if (!CASOS_QUE_O_PADRAO_GRAVA.includes(caso) || !texto(canonico)) return null;
  const corpo = padraoDaFabrica(contrato);
  if (!corpo) return null;
  return Object.freeze({ decisao: null, origem: ORIGEM_DO_PADRAO, corpo, gate: gateDoCorpo(corpo, "padrão da fábrica no contrato da condução do HEAD", caso) });
}

// ── a decisão registrada da task (T27, D-VEGA19-33) ─────────────────────────

const DECISAO_RE = /^- \*\*(D-[A-Za-z0-9]+-\d+):\*\* /;
const TASK_RE = /^T\d+$/;

function escapar(t) {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Negação na oração: "a T27 não toca X" nunca consente X.
const NEGACAO_RE = /(?<![\p{L}])(?:não|nao|nunca|nem|jamais|sem|proíb\p{L}*|proib\p{L}*|exceto|exceç\p{L}*|excec\p{L}*|salvo|menos|fora|retir\p{L}*|deixa)(?![\p{L}])/iu;

/**
 * Uma oração do `corpo` (corte em `.`, `;`, `:` ou `,` seguidos de espaço, ou fim de
 * linha) cita a task `task` (`T<k>`, sem pegar `T<k>0` nem `T<k>.1`) e o caminho
 * `caminho` inteiro, sem negação? Menção solta em orações diferentes não
 * consente; oração com negação também não (fail-closed).
 */
function citaTaskECaminho(corpo, task, caminho) {
  const daTask = new RegExp(`(?<![A-Za-z0-9_-])${task}(?![0-9]|\\.\\d)`);
  const doCaminho = new RegExp(`(?<![\\w./-])${escapar(caminho)}(?![\\w/-]|\\.\\w)`);
  return corpo
    .split(/[.;:,](?=\s|$)/)
    .some((oracao) => daTask.test(oracao) && doCaminho.test(oracao) && !NEGACAO_RE.test(oracao));
}

/**
 * A primeira decisão do canonico, na ordem do texto, cujo corpo cita a task e
 * o caminho (D-VEGA19-33), ou null. Só decisão de rótulo único
 * (`corpoDaDecisao`). Puro.
 */
export function decisaoQueCita(canonico, task, caminho) {
  if (!TASK_RE.test(task ?? "") || !texto(caminho)) return null;
  for (const l of linhasDoCanonico(canonico)) {
    const m = DECISAO_RE.exec(l);
    if (!m) continue;
    const corpo = corpoDaDecisao(canonico, m[1]);
    if (corpo && citaTaskECaminho(corpo, task, caminho)) return m[1];
  }
  return null;
}

/**
 * O que o `trazer` deixa de perguntar porque uma decisão do operador já
 * registrada no canonico do HEAD nomeia a task e o caminho (D-VEGA19-33),
 * mesmo em `SEGUEM_PERGUNTANDO`: dos motivos que sobraram, cada caminho que
 * uma decisão cita junto com a task sai do motivo e vira
 * `decisao-registrada-da-task`, agrupado pela decisão. Nunca sai: motivo de
 * integridade, `canonico-do-ciclo`, `caminho-clinico-fora-dos-outputs`
 * (D-VEGA37-40) e caminho das instruções de sessão (`instrucoes`,
 * D-VEGA37-45). Puro. Devolve `{ motivos, consentidos }`.
 */
export function consentidoPorDecisaoDaTask({ motivos = [], canonico, task, instrucoes = [] }) {
  const ficam = [];
  const consentidos = [];
  for (const m of motivos) {
    if (MOTIVOS_DE_INTEGRIDADE.includes(m.motivo) || MOTIVOS_QUE_NUNCA_REPETEM.includes(m.motivo)) {
      ficam.push(m);
      continue;
    }
    const restantes = [];
    const porDecisao = new Map();
    for (const c of m.caminhos) {
      const id = casaAlgum(c, instrucoes) ? null : decisaoQueCita(canonico, task, c);
      if (!id) restantes.push(c);
      else porDecisao.set(id, [...(porDecisao.get(id) ?? []), c]);
    }
    for (const [decisao, caminhos] of porDecisao) consentidos.push({ caso: CASOS.decisaoRegistradaDaTask, motivo: m.motivo, caminhos, decisao });
    if (restantes.length) ficam.push({ ...m, caminhos: restantes });
  }
  return { motivos: ficam, consentidos };
}

/**
 * Os registros que o `trazer` grava, um por item de `consentidos` de
 * `decidirNoTrazer` (mais os de `consentidoPorDecisaoDaTask`), e os que voltam
 * a perguntar. `canonico` é o TEXTO do canonico do HEAD; `contrato`, o TEXTO do
 * `contrato.md` da condução no HEAD. Casos do plano
 * (`instrucao-declarada-em-outputs`, `teste-que-acompanha-o-codigo`,
 * `tela-dos-steps`, e todo caso futuro) gravam pelo `gateDoPlano`: o corpo da
 * decisão que a linha `**Consentimentos:**` aponta ou, sem par, o padrão da
 * fábrica do `contrato` (origem `padrao-da-fabrica`); sem nenhum, voltam.
 * `decisao-registrada-da-task` grava o corpo exato da decisão que cita a task
 * e todos os caminhos dela (origem = o id da decisão); sem isso, volta.
 * `pergunta-repetida` grava o corpo da marca de origem (`origem`), que a casca
 * relê do git e confere pelo `gateDaMarcaDeOrigem`; sem origem, volta. Registro
 * que não confere (`casoResolvido`) também volta. Puro.
 * Devolve `{ registros: [{ registro, decisao?, gate? }], voltam: [{ motivo, caminhos }] }`.
 */
export function registrosDoTrazer({ consentidos = [], canonico, contrato = null, ciclo, fase, task = null, tentativa = null, quem, quando }) {
  const registros = [];
  const voltam = [];
  for (const c of consentidos) {
    const volta = () => voltam.push({ motivo: c.motivo, caminhos: [...(c.caminhos ?? [])] });
    const comum = { ciclo, fase, caso: c.caso, quando, task, tipo: "trazer", motivo: c.motivo ?? null, caminhos: c.caminhos ?? [], tentativa: c.tentativa ?? tentativa };
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
      if (c.caso === CASOS.decisaoRegistradaDaTask) {
        const decisao = c.decisao ?? c.origem ?? null;
        const corpo = corpoDaDecisao(canonico, decisao);
        const caminhos = c.caminhos ?? [];
        if (!corpo || !caminhos.length || !caminhos.every((x) => citaTaskECaminho(corpo, task ?? "", x)) || !TASK_RE.test(task ?? "")) {
          volta();
          continue;
        }
        const gate = gateDoCorpo(corpo, `${decisao} no canonico do HEAD`, c.caso);
        registros.push({ registro: casoResolvido({ ...comum, quem, sim: corpo, origem: decisao }), decisao, gate });
        continue;
      }
      const plano = gateDoPlano(canonico, c.caso, { contrato });
      if (!plano) {
        volta();
        continue;
      }
      // D-VEGA19-39: o caso mapeado a uma decisão grava a origem = o id dela; o padrão, `padrao-da-fabrica`.
      registros.push({ registro: casoResolvido({ ...comum, quem, sim: plano.corpo, origem: plano.origem ?? plano.decisao }), decisao: plano.decisao, gate: plano.gate });
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
export function gravarRegistrosDoTrazer({ repo, registros = [], cerca, pecas = null, rodar = rodarGit, avisar = AVISO_PADRAO }) {
  const pc = pecas ?? pecasDoConsentimento(repo);
  const { phi, perguntas } = pc;
  const semFiltroDoProjeto = semFiltroDe(pc);
  // Confere todos antes de escrever o primeiro: recusa de um não deixa os outros pela metade.
  const preparados = registros.map(({ registro, gate, decisao = null }) => {
    if (registro.caso === CASOS.perguntaRepetida) {
      const corpo = simDoCorpo(rodar(repo, ["log", "-1", "--format=%b", registro.origem]));
      if (!corpo) throw new ErroPlano("origem-sem-sim", `${registro.origem.slice(0, 8)} sem corpo: sem sim de origem`);
      // A repetição herda a pergunta citada pela marca de origem; marca legada, o caminho antigo.
      const citada = perguntaCitadaDaMarca(repo, registro.origem, { rodar });
      if (citada) exigirPerguntaCitadaDaMarca({ repo, perguntas: registroDoConsentimento(pc, citada), pergunta_id: citada, ciclo: registro.ciclo, sha: registro.origem, rodar });
      const reg = citada ? { ...registro, citada } : registro;
      const conferido = conferirConsentimento({ registro: reg, gate: gateDaMarcaDeOrigem(corpo), phi, semFiltroDoProjeto, perguntas: citada ? perguntas : null, origem_resposta: "agente", ponteiro: citada });
      return { conferido, perguntas: citada ? perguntas : null };
    }
    if (typeof gate !== "function") throw new ErroPlano("sem-gate-do-plano", `${registro.caso} sem o gate do plano: nada gravado (fail-closed)`);
    // Padrão da fábrica, decisão do mapa e decisão registrada da task: não é resposta do operador (D-VEGA19-29/39/40).
    const conferido = conferirConsentimento({
      registro,
      gate,
      phi,
      semFiltroDoProjeto,
      perguntas,
      origem_resposta: ORIGEM_DO_PADRAO,
      ponteiro: `${PONTEIRO_DO_CONSENTIMENTO}${registro.origem ?? decisao ?? ORIGEM_DO_PADRAO}`,
    });
    return { conferido, perguntas };
  });
  if (typeof cerca !== "function") throw new ErroPlano("sem-cerca", "consentimento sem a cerca da posse: nada gravado");
  const gravados = preparados.map(({ conferido, perguntas: p }) => escreverConsentimento({ repo, conferido, perguntas: p, cerca, rodar }));
  // Peças com `phi` e sem `perguntas`: os casos do plano gravam só no git — avisa, nunca calado (D-VEGA19-48).
  avisarSemRegistro({ phi, perguntas, falha: pc.falha, casos: preparados.filter((x) => !x.perguntas).length, avisar });
  return gravados;
}
