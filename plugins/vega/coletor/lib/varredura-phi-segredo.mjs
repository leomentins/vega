// .claude/scripts/lib/varredura-phi-segredo.mjs
// HN-29 T17 — as primitivas dos detectores de dado de paciente (CPF/CNS) e de segredo, extraídas
// de `phi-scan-staged.mjs` e `gap5-secrets-scan-precommit.js` para que a exportação das vitrines
// varra a árvore exportada com os mesmos detectores. Os dois gates importam daqui sem mudar a
// decisão deles: território (prefixo), mode-file, allow e marcador de fixture continuam no gate.
// A exportação usa as primitivas puras, sem nada disso (D-HN29-16, D-HN29-21, D-HN29-23).
//
// Achado sai como `{ line, kind }` — NUNCA o valor casado (logar o CPF recriaria o vazamento).

// ───────────────────────────── dado de paciente ─────────────────────────────

// Dígito verificador de CPF. Rejeita all-same-digit (inválidos por construção — os
// placeholders/fixtures usam essa faixa justamente por serem seguros).
export function computeCpfDv(base9) {
  const dv = (slice) => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) sum += Number(slice[i]) * (slice.length + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base9);
  const d2 = dv(base9 + String(d1));
  return `${d1}${d2}`;
}

export function isValidCpf(digits) {
  if (!/^\d{11}$/.test(digits)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // 000.., 111.. — inválidos conhecidos
  return computeCpfDv(digits.slice(0, 9)) === digits.slice(9);
}

// CNS (Cartão Nacional de Saúde) — 15 dígitos, checksum mod 11, prefixo [1,2,7,8,9].
export function isValidCns(digits) {
  if (!/^\d{15}$/.test(digits)) return false;
  if (!/^[12789]/.test(digits)) return false;
  if (/^(\d)\1{14}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += Number(digits[i]) * (15 - i);
  return sum % 11 === 0;
}

// Varre texto → lista de { line, kind }. NUNCA carrega o valor casado.
export function scanContent(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((ln, idx) => {
    const line = idx + 1;
    // 1) CPF formatado (ddd.ddd.ddd-dd) — o formato é o sinal de alta confiança; flag por padrão.
    for (const _m of ln.matchAll(/(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d])/g)) {
      hits.push({ line, kind: "cpf-formatted" });
    }
    // 2) CNS formatado espaçado (ddd dddd dddd dddd) — valida checksum p/ reduzir FP.
    for (const m of ln.matchAll(/\b\d{3}[ .]\d{4}[ .]\d{4}[ .]\d{4}\b/g)) {
      if (isValidCns(m[0].replace(/\D/g, ""))) hits.push({ line, kind: "cns-formatted" });
    }
    // 3) Runs nus de 11 (CPF) ou 15 (CNS) dígitos com check-digit válido —
    //    a validação evita false-positive em timestamps de migration (14 dígitos) e IDs.
    for (const m of ln.matchAll(/(?<!\d)\d{11}(?!\d)|(?<!\d)\d{15}(?!\d)/g)) {
      const d = m[0];
      if (d.length === 11 && isValidCpf(d)) hits.push({ line, kind: "cpf-bare" });
      else if (d.length === 15 && isValidCns(d)) hits.push({ line, kind: "cns-bare" });
    }
  });
  return hits;
}

// ───────────────────────────── segredo ─────────────────────────────

export const PLACEHOLDER =
  /(REDACTED|PLACEHOLDER|EXAMPLE|CHANGE_?ME|YOUR|<[^>]*>|\$\{|\$[A-Z_]|process\.env|os\.environ|import\.meta\.env)/i;

// Detectores de VALOR (não menção): prefixos literais de token · JWT · cabeçalho PEM de chave
// privada · token Supabase · chave de acesso AWS · atribuição nome-sensível = valor real ≥20
// chars (chave com ou sem aspas, como em JSON) · Bearer <token>. D-HN29-32 acrescentou os
// três do meio e as aspas na chave; a decisão dos gates só muda por detectar mais.
export const DETECTORS = [
  { name: "token-prefix", re: /\b(sk-[A-Za-z0-9_-]{20,})/ },
  {
    name: "github-token",
    re: /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/,
  },
  { name: "jwt", re: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,})/ },
  // `BEGIN PRIVATE KEY`, `BEGIN RSA PRIVATE KEY`, `BEGIN OPENSSH PRIVATE KEY`…; nunca PUBLIC/CERTIFICATE.
  { name: "private-key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
  {
    name: "supabase-token",
    re: /\b(sbp_[0-9a-f]{40}(?![A-Za-z0-9_])|sb_secret_[A-Za-z0-9_-]{20,})/,
  },
  { name: "aws-access-key", re: /\b(AKIA[0-9A-Z]{16})\b/ },
  {
    name: "sensitive-assignment",
    re: /\b(?:SUPABASE_\w*KEY|\w+_TOKEN|\w+_SECRET|\w*PASSWORD)["']?\s*[=:]\s*["']?([A-Za-z0-9_\-./+=]{20,})/i,
  },
  { name: "bearer", re: /\bBearer\s+([A-Za-z0-9_\-.]{20,})/ },
];

/**
 * Nome do detector de segredo que casa a linha, ou `null`. Sem marcador de fixture nem allow.
 * O gate de commit isenta a linha inteira que tem cara de placeholder; `estrito` (a exportação)
 * isenta só pelo valor casado — `TOKEN=<valor real> # EXAMPLE` reprova.
 */
export function detectarSegredo(line, { estrito = false } = {}) {
  for (const d of DETECTORS) {
    const m = d.re.exec(line);
    if (!m) continue;
    const value = m[1] || m[0];
    if (PLACEHOLDER.test(value) || (!estrito && PLACEHOLDER.test(line))) continue;
    return d.name;
  }
  return null;
}

/** `{ line, kind }` de cada linha com segredo (`opts` = os de `detectarSegredo`). */
export function scanSegredo(text, opts) {
  const hits = [];
  text.split("\n").forEach((ln, i) => {
    const kind = detectarSegredo(ln, opts);
    if (kind) hits.push({ line: i + 1, kind });
  });
  return hits;
}

// ───────────────────────────── predicados da exportação ─────────────────────────────

/** Conteúdo que não é texto UTF-8 válido: byte nulo ou sequência inválida (D-HN29-23). */
export function naoETexto(buf) {
  if (buf.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return false;
  } catch {
    return true;
  }
}

const PREFIXOS_SENSIVEIS = [[".agents", "ciclo"], [".agents", "estado"], [".serena", "memories"]];
const SEGMENTOS_SENSIVEIS = new Set(["notes", "sensivel"]);

/**
 * Lugar possível de dado de paciente (D-HN29-16, D-HN29-21): sob `.agents/ciclo/`,
 * `.agents/estado/`, `.serena/memories/`, ou com segmento de diretório `notes`/`sensivel` em
 * qualquer altura. Por segmento e sem caixa. Separado do `classifyPath` do gate de commit,
 * que não recusa `.agents/ciclo/` e cuja decisão não muda.
 */
export function caminhoSensivel(p) {
  const seg = String(p).replace(/\\/g, "/").split("/").filter(Boolean).map((s) => s.toLowerCase());
  const dirs = seg.slice(0, -1);
  for (let i = 0; i + 1 < dirs.length; i++) {
    if (PREFIXOS_SENSIVEIS.some(([a, b]) => dirs[i] === a && dirs[i + 1] === b)) return true;
  }
  return dirs.some((s) => SEGMENTOS_SENSIVEIS.has(s));
}
