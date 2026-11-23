/**
 * canonico.mjs — o código do adaptador do projeto de teste das suítes.
 *
 * O projeto de teste é um projeto de mentira com formato de plano próprio (o
 * "canonico", lido por `leitor-canonico.mjs`), brief próprio
 * (`brief-canonico.mjs`), carimbo de revisão em dois destinos, CI da proposta,
 * verbos de publicação, caminhos sensíveis e telas que os Steps liberam: tudo o
 * que o núcleo recebe de um adaptador com código, para as suítes exercerem cada
 * ramo. Nada daqui é do núcleo: o núcleo o carrega pelo `codigo` da declaração.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerDeclaracoesConducao, parseHeadings, parseTasks } from "./leitor-canonico.mjs";

const BRIEF = path.join(path.dirname(fileURLToPath(import.meta.url)), "brief-canonico.mjs");

/**
 * As peças do consentimento do projeto de teste (VEGA-19 T16): um gate de PHI
 * de mentira (recusa CPF formatado) e um registro de perguntas que só aceita
 * a forma e devolve `digitado` para toda pergunta citada — as suítes que
 * medem a recusa por origem injetam peças próprias (`consentimento-no-registro`,
 * `pergunta-citada`). Dublê declarado (D-VEGA19-42): o projeto de teste não
 * tem registro, então `perguntaDoAutorizar` responde a pergunta do autorizar
 * que o núcleo pede (`pedido`: ciclo, fase e sim), na convenção da
 * D-VEGA19-44, com a opção `a` escolhida. Quem confere é o núcleo
 * (`exigirPerguntaDoAutorizar`); o uso único ele lê do git, não daqui.
 */
export function consentimentoDoProjeto() {
  return Object.freeze({
    phi: (entrada) => (/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(String(entrada?.corpo ?? "")) ? { recusar: true, mensagem: "corpo · cpf-formatted" } : { recusar: false }),
    perguntas: Object.freeze({
      gravar(eventos) {
        if (!Array.isArray(eventos) || !eventos.every((e) => /^p-[0-9a-f]{16}$/.test(e?.pergunta_id ?? ""))) throw new Error("evento fora da forma");
        return [{ exit: 0, gravados: eventos.length }];
      },
      origemEfetiva: (id) => ({ origem: /^p-[0-9a-f]{16}$/.test(id ?? "") ? "digitado" : null }),
      perguntaDoAutorizar(id, pedido) {
        if (!/^p-[0-9a-f]{16}$/.test(id ?? "")) return { origem: null, motivo: "sem-resposta", sem_registro: false, abertura: null, escolhas: [] };
        return {
          origem: "digitado",
          motivo: null,
          sem_registro: false,
          abertura: { evento: "abertura", pergunta_id: id, ciclo: pedido?.ciclo ?? null, ponteiro: `autorizar-ciclo:${pedido?.fase ?? ""}`, itens: [{ numero: 1, opcoes: [{ letra: "a", texto: pedido?.sim ?? "" }] }] },
          escolhas: [{ numero: 1, letra: "a" }],
        };
      },
    }),
  });
}

/** Frontmatter `cycle:` do plano. */
function cicloDoFrontmatter(texto) {
  return /^cycle:\s*(\S+)/m.exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(texto)?.[1] ?? "")?.[1] ?? null;
}

/** Prosa: o commit que só toca isto não exige carimbo. */
const PROSA_RE = /\.(md|mdc)$/;
/** Artefato gerado de planejamento: carimbo leve basta. */
const GERADO_RE = /^\.agents\/ciclo\/[^/]+\/[^/]+\/blast-(computed|manifest)\.json$/;
const REVIEWERS_LEVE_RE = /^\[?\s*gerado\b/i;
const CARIMBO_AVULSO_RE = /^\.projeto\/state\/revisoes\/[0-9a-f]{8}\.md$/;
const NOME_DE_CARIMBO_RE = /^[0-9a-f]{8}\.md$/;

/** `"prosa" | "gerado" | "codigo"` — pelo que o commit toca fora da prosa. */
export function classeDoCommit(arquivos) {
  const naoProsa = arquivos.filter((a) => !PROSA_RE.test(a));
  if (naoProsa.length === 0) return "prosa";
  return naoProsa.every((a) => GERADO_RE.test(a)) ? "gerado" : "codigo";
}

/**
 * Carimbo válido = `<sha8>.md` num dos dois destinos, cujo corpo declara o
 * mesmo sha e pelo menos um reviewer (`aceitaLeve`: só então o leve conta).
 */
export function acharCarimbo({ sha, arquivosDoHead, lerArquivo, aceitaLeve = false }) {
  const sha8 = sha.slice(0, 8);
  const candidatos = arquivosDoHead.filter(
    (p) => p === `.projeto/state/revisoes/${sha8}.md` || (/(^|\/)revisoes\/[0-9a-f]{8}\.md$/.test(p) && p.endsWith(`/${sha8}.md`)),
  );
  for (const p of candidatos) {
    let corpo = "";
    try {
      corpo = String(lerArquivo(p));
    } catch {
      continue;
    }
    const m = corpo.match(/^sha:[ \t]*([0-9a-f]{8,40})[ \t]*$/m);
    if (!m || !sha.startsWith(m[1])) continue;
    const r = corpo.match(/^reviewers:[ \t]*(.*)$/m);
    if (!r || !r[1].trim() || /^\[\s*\]$/.test(r[1].trim())) continue;
    if (!aceitaLeve && REVIEWERS_LEVE_RE.test(r[1].trim())) continue;
    return p;
  }
  return null;
}

export default Object.freeze({
  plano: Object.freeze({
    /** Onde o núcleo procura o plano (`git ls-tree` a partir daqui). */
    raiz: ".agents/ciclo",
    /** O plano vivo do ciclo; o arquivado (`closed/`) nunca. */
    casa: (caminho, ciclo) => caminho.endsWith(`/${ciclo}/canonico.md`) && !caminho.includes("/closed/"),
    ler(texto) {
      const parsed = parseHeadings(texto);
      const { phases, tasks } = parseTasks(parsed);
      return { ciclo: cicloDoFrontmatter(texto), fases: phases, tasks, declaracoes: lerDeclaracoesConducao(parsed, tasks) };
    },
    /** Comando do brief da operária (`node <args>`). */
    brief: ({ canonico, task, nonce, ref }) => [BRIEF, "--canonico", canonico, task, "--operaria", "--nonce", nonce, "--ref", ref],
  }),

  /** Trechos de texto de task que contam como publicação. */
  publicacao: Object.freeze(["db push", "db-publish", "functions deploy", "vercel --prod", "estado.mjs db push"]),

  /** Caminhos sensíveis: task com Outputs neles pergunta antes de abrir. */
  caminhosProtegidos: Object.freeze([
    "app/telas/fichas/**",
    "app/telas/agenda/**",
    "db/migrations/**",
    "db/funcoes/**",
  ]),

  /** O que define a parada de publicação no projeto, somado ao que o motor guarda (`.vega/**`, `.altair/**`). */
  definemAParada: Object.freeze(["**/hooks/gate-de-publicacao.js", "**/liberacao-da-publicacao.mjs", "db/scripts/**"]),

  /** Telas sensíveis que os Steps da task liberam no `trazer`; migração e função nunca. */
  telasProtegidasDosSteps: Object.freeze(["app/telas/fichas/**", "app/telas/agenda/**"]),

  /** Dentro do segmento dos Steps, o que não é tela e segue perguntando. */
  foraDasTelasDosSteps: Object.freeze([
    "**/actions.ts",
    "**/actions.tsx",
    "**/*.actions.ts",
    "**/*.actions.tsx",
    "**/*-actions.ts",
    "**/*-actions.tsx",
    "**/actions/**",
    "**/route.ts",
    "**/route.tsx",
    "**/*.server.ts",
    "**/*.server.tsx",
  ]),

  /** Carimbo de revisão: `revisoes/<sha8>.md` ao lado do plano ou `.projeto/state/revisoes/<sha8>.md`. */
  carimbo: Object.freeze({
    achar: acharCarimbo,
    classeDoCommit,
    notas: (pastaDoPlano) => `${pastaDoPlano}/revisoes/`,
    ehCarimbo: (caminho, notas) =>
      CARIMBO_AVULSO_RE.test(caminho) || (caminho.startsWith(notas) && NOME_DE_CARIMBO_RE.test(caminho.slice(notas.length))),
    destinos: "`revisoes/<sha8>.md` do ciclo ou `.projeto/state/revisoes/<sha8>.md`",
  }),

  /** CI da proposta: o ramo base e onde mora o veredito. */
  ci: Object.freeze({
    ramoBase: "main",
    veredito: "`conclusion` não é veredito: ler o agregador (`desfecho | nome`) por dentro do run antes de avisar o operador",
  }),

  /** Marcas cuja task roda em rodadas e só fecha pelo caso de conferência por arquivo. */
  marcasDeRodadas: Object.freeze(["gate-de-ux"]),
});
