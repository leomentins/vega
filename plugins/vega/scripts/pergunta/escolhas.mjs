// .claude/skills/vega/scripts/pergunta/escolhas.mjs
// A regra única de "o que, num texto, é escolha de item" — peça do corpo da fábrica. Quem lê
// escolha importa daqui: o `responder` (`comando.mjs interpretarResposta`), o leitor de prova
// (`prova.mjs`), a lib da Sistoli (`.claude/scripts/estado/lib/pergunta.mjs`, que reexporta) e o
// pareador (`.claude/hooks/decisao-do-operador.mjs`). Antes eram três cópias da mesma regex solta.
//
// ESCOLHA × CITAÇÃO (hotfix vega-escolha-nao-e-citacao, 24/11/2026). A resposta do Leo à
// p-c78a7f8480020a2c foi "1a 2-precisa de uma solução mais inteligente que 2a": D1 = a e D2 em texto
// livre, recusando a (a). A leitura solta achava todo `Na` do texto e gravava D1a D2a — o contrário
// da resposta. A regra ancorada:
//   - uma letra só é escolha quando é o próprio token da resposta àquele item: no começo da linha
//     (depois de marcador de lista, se houver) ou numa sequência de tokens que começa nele —
//     `4a`, `D4a`, `4 - a`, `16-a, mas …`, `D1a D2b`, `1a, 2b e 3c`. A letra separada do número
//     só vale fechando a linha ou antes de pontuação: "16 a 23", "10-o que você…" e "4-a solução"
//     são texto. Antes da primeira sequência da linha cabe UMA palavra de abertura que não é
//     negação ("L4 D3a", "combo 10c 11b", "ok, 1a"): medido em 338 respostas gravadas até
//     24/11/2026, sem ela duas respostas reais perdiam as escolhas; "não quero 2b" e "gosto mais de
//     1c" seguem citação;
//   - o primeiro texto que não é token encerra a sequência: o resto da linha é comentário, e a
//     letra citada nele (`…mais inteligente que 4a`, `não quero a 2b`) não vale;
//   - `N-<texto>` (o número seguido de texto, sem letra solta logo depois) é o texto livre do item N
//     (`LIVRE_NUMERADO`, a mesma forma que o pareador usa desde a #814) e também encerra a linha;
//   - a linha `Decisão 6: a` segue valendo (`DECISAO_FIXA`).
// A leitura solta (`escolhasCitadas`) fica só para o texto que CITA decisões por definição — a
// mensagem entre sessões ("T3-OK … conforme D12a", "RESPOSTA p-… D1a"), onde o pareador precisa
// reconhecer o relato e o repasse. A resposta do operador (mensagem humana, literal do `responder`,
// resposta gravada, texto do evento do hub) se lê pela ancorada.

/** `Decisão 6: a` (ou `: sim`), no começo da linha (a leitura solta). */
export const DECISAO_FIXA = /^\s*(?:[-*•>]\s*)?(?:\*\*)?\s*Decis(?:ão|ao)\s+D?(\d{1,4})\s*:\s*\(?(sim|[a-z])\)?(?![A-Za-z])/gim;
/** A leitura solta: todo `6a`/`D6a` do texto, citado ou não. */
const TOKEN_SOLTO = /(?<![A-Za-z0-9])D?(\d{1,4})([a-z])(?![A-Za-z0-9])/gi;

/**
 * "2-dispara um subagent…", "10 aprofundar…": o número do item e o texto livre dele (nunca a letra
 * sozinha `2 a`). O grupo 2 diz o separador: explícito (`-`, `:`, `)`) ou só espaço ("2 coisas: …"
 * colide com a numeração corrida, então o pareador pede o sinal do agente). Ancorada no começo do
 * texto: a forma do pareador, que lê a mensagem inteira (a mesma da #814, sem o `D`).
 */
const NUCLEO_LIVRE = String.raw`(\d{1,4})(\s*[-–—:)]\s*|\s+)(?!\(?[a-z]\)?(?:$|[\s,.;:!—–-]))(?=\p{L})`;
export const LIVRE_NUMERADO = new RegExp(String.raw`^\s*${NUCLEO_LIVRE}`, "iu");
const LIVRE_AQUI = new RegExp(NUCLEO_LIVRE, "iuy");

/**
 * O token de escolha num ponto exato da linha. Colado ao número (`4a`, `D4a`, `4(a)`): a letra não
 * pode vir colada a outra letra ou dígito (`4-precisa` não é `4p`). Separado por `-`, `:` ou `)`
 * (`4 - a`, `4: (a)`, `16-a, mas …`, `1-a 2-b`): a letra fecha a linha, vem antes de pontuação ou
 * de outro token. Separado só por espaço (`4 a`): fecha a linha ou vem antes de pontuação — "16 a
 * 23" é texto. "10-o que você…" e "4-a solução" são texto. Ponto (`1. A solução…`) não separa: é a
 * numeração de lista. A linha `Decisão 6: a` entra como token (`DECISAO_AQUI`).
 */
const TOKEN_AQUI =
  /D?(\d{1,4})(?:\(?([a-z])\)?(?![\p{L}\p{N}])|\s*[-–—:)]\s*\(?([a-z])\)?(?=\s*$|\s*[,.;:!/—–-]|\s+D?\d)|\s+\(?([a-z])\)?(?=\s*$|\s*[,.;:!/—–]))/iuy;
/** `Decisão 6: a` (ou `: sim`) num ponto exato da linha. */
const DECISAO_AQUI = /(?:\*\*)?\s*Decis(?:ão|ao)\s+D?(\d{1,4})\s*:\s*\(?(sim|[a-z])\)?(?![A-Za-z])/iuy;
/** Entre dois tokens da mesma sequência: espaço, vírgula, ponto, barra, `e`, ênfase de markdown. */
const ENTRE_TOKENS = /(?:[\s,;.:/+&|*_—–-]|\be\b)*/iuy;
/** Marcador de lista no começo da linha (com espaço depois: `- 1a`, `* 2b`, `> 3c`). */
const MARCADOR = /\s*(?:[-*•>]\s+)?[*_]*/uy;
/**
 * Uma palavra de abertura antes da sequência ("L4", "combo", "ok,"), só na PRIMEIRA linha com texto:
 * a linha quebrada no meio de uma frase ("…mais inteligente\nque 2a") é continuação, não resposta.
 * Não começa por dígito (`2-texto` é texto livre do item, `1a` é token) e não é negação nem recusa.
 */
const ABERTURA =
  /(?!(?:n[ãa]o|nem|sem|menos|exceto|salvo|nunca|jamais|fora|nada|tirando|tira|evito|evitar|descarto|descarta|desconsidera|recuso)(?![\p{L}\p{N}]))[^\s\d][^\s]*\s+/iuy;
const MAX_ABERTURA = 1;

function aqui(re, s, i) {
  re.lastIndex = i;
  return re.exec(s);
}

/** O token num ponto: `{ numero, letra, tamanho }` ou `null`. */
function tokenAqui(linha, i) {
  const t = aqui(TOKEN_AQUI, linha, i);
  if (t) return { numero: Number(t[1]), letra: (t[2] ?? t[3] ?? t[4]).toLowerCase(), tamanho: t[0].length };
  const d = aqui(DECISAO_AQUI, linha, i);
  return d ? { numero: Number(d[1]), letra: d[2].toLowerCase(), tamanho: d[0].length } : null;
}

/**
 * A leitura ancorada de um texto: `{ tokens, livres }`, com posição absoluta.
 * `tokens` — `[{ numero, letra, ini, fim }]`, cada token de escolha na ordem do texto (repetidos e
 * conflitantes inclusos: quem lê decide; a linha `Decisão N: x` também); `livres` —
 * `[{ numero, ini, explicito }]`, o `N-<texto>` de cada linha (`explicito`: separador `-`, `:`, `)`).
 */
export function lerTokens(texto) {
  const s = String(texto ?? "");
  const tokens = [];
  const livres = [];
  let base = 0;
  let primeiraLinha = true;
  for (const linha of s.split("\n")) {
    let i = aqui(MARCADOR, linha, 0)?.[0].length ?? 0;
    // A abertura só vale na primeira linha com texto, e só se depois dela vem um token.
    for (let k = 0, j = i; primeiraLinha && k < MAX_ABERTURA && !tokenAqui(linha, i) && !aqui(LIVRE_AQUI, linha, i); k++) {
      const w = aqui(ABERTURA, linha, j);
      if (!w) break;
      j += w[0].length;
      if (tokenAqui(linha, j)) i = j;
    }
    if (linha.trim()) primeiraLinha = false;
    for (let primeiro = true; i < linha.length; primeiro = false) {
      if (!primeiro) i += aqui(ENTRE_TOKENS, linha, i)?.[0].length ?? 0;
      const t = tokenAqui(linha, i);
      if (t) {
        tokens.push({ numero: t.numero, letra: t.letra, ini: base + i, fim: base + i + t.tamanho });
        i += t.tamanho;
        continue;
      }
      const l = aqui(LIVRE_AQUI, linha, i);
      if (l) livres.push({ numero: Number(l[1]), ini: base + i, explicito: /[-–—:)]/.test(l[2]) });
      break;
    }
    base += linha.length + 1;
  }
  return { tokens, livres };
}

function juntar(pares) {
  const vistas = new Map();
  const conflito = new Set();
  for (const { numero, letra } of pares) {
    const ja = vistas.get(numero);
    if (ja && ja !== letra) conflito.add(numero);
    if (!ja) vistas.set(numero, letra);
  }
  return { escolhas: [...vistas].map(([numero, letra]) => ({ numero, letra })), conflito: [...conflito] };
}

/**
 * As escolhas que a resposta do operador declara, pela regra ancorada: `{ escolhas, conflito,
 * livres }`. Uma por número (a primeira); número com duas letras diferentes sai em `conflito`;
 * `livres` são os números com `N-<texto>` que não têm escolha.
 */
export function escolhasDoTexto(texto) {
  const { tokens, livres } = lerTokens(texto);
  const r = juntar(tokens);
  const comEscolha = new Set(r.escolhas.map((e) => e.numero));
  return {
    ...r,
    livres: [...new Set(livres.map((l) => l.numero))].filter((n) => !comEscolha.has(n)),
    livresExplicitos: [...new Set(livres.filter((l) => l.explicito).map((l) => l.numero))].filter((n) => !comEscolha.has(n)),
  };
}

/**
 * A leitura solta, para o texto que cita decisões (mensagem entre sessões): todo `6a`/`D6a` e a linha
 * `Decisão 6: a`. Nunca para a resposta do operador.
 */
export function escolhasCitadas(texto) {
  const s = String(texto ?? "");
  const pares = [];
  for (const m of s.matchAll(DECISAO_FIXA)) pares.push({ numero: Number(m[1]), letra: m[2].toLowerCase() });
  for (const m of s.matchAll(TOKEN_SOLTO)) pares.push({ numero: Number(m[1]), letra: m[2].toLowerCase() });
  return { ...juntar(pares), livres: [], livresExplicitos: [] };
}
