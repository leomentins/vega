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
  // VEGA-26 T19 (D-VEGA26-23): os dois segredos reais do `.env` da raiz que nenhum detector pegava.
  // Chave do Resend: `re_<8+>_<16+>`, sem letra/dígito/`_` colado antes nem letra/dígito depois
  // (com `\b` no fim, `…_x` colado escapava).
  {
    name: "resend-key",
    re: /(?<![A-Za-z0-9_])(re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,})(?![A-Za-z0-9])/g,
    placeholder: (v) => PLACEHOLDER_ESTREITO.test(v),
  },
  // URL com senha embutida: `<esquema>://<usuário>:<senha de 8+>@<host>` (usuário e senha em
  // `[^:/@\s]`, que já aceita o `%XX`; sem alternância). O esquema começa onde não há caractere
  // de esquema antes e tem no máximo 32: com `\b` + `*`, uma linha `a.a.a.…` de 100 KB levava 6 s
  // (medido na revisão da T19). Host reservado (RFC 2606, `localhost`, `host`) é fixture e fica isento.
  {
    name: "url-com-senha",
    re: /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^:/@\s]+:([^:/@\s]{8,})@([^\s/:?#@]+)/g,
    placeholder: (v) => PLACEHOLDER_ESTREITO.test(v),
    isento: (m) => hostReservado(m[2]),
  },
  // VEGA-26, fechamento de F3: só no modo `estrito` (foto e exportação), que é a única barreira com a
  // proteção de push desligada; o gate de commit não muda. Prefixos de provedor que nenhum detector
  // pegava (Stripe, webhook, Google, Slack, SendGrid, npm, os outros tokens do GitHub).
  {
    name: "provider-token",
    soEstrito: true,
    re: /(?<![A-Za-z0-9_])((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{35}|xox[abpr]-[A-Za-z0-9-]{10,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{36}|gh[ousr]_[A-Za-z0-9]{36})/g,
    placeholder: (v) => PLACEHOLDER_ESTREITO.test(v),
  },
  // `<NOME>_KEY=<valor>`: valor de 20+ sem ponto, com letra e dígito (identificador longo não acusa).
  {
    name: "key-assignment",
    soEstrito: true,
    re: /\b\w+_KEY["']?\s*[=:]\s*["']?([A-Za-z0-9_\-+/=]{20,})/gi,
    placeholder: (v) => PLACEHOLDER_ESTREITO.test(v),
    isento: (m) => !(/[0-9]/.test(m[1]) && /[A-Za-z]/.test(m[1])),
  },
];

// O `PLACEHOLDER` largo isenta `$x` em qualquer caixa — uma senha real `pa$sword…` passaria. Os
// detectores da T19 julgam o valor por este, que só aceita o valor INTEIRO com cara de marcador.
// A variável (`$NOME`, `%NOME%`) é com caixa: `$ecretPass99` é senha, não variável.
const MARCADOR_DE_VARIAVEL = /^(<[^>]*>|\$\{[^}]*\}|\$[A-Z_][A-Z0-9_]*|%[A-Z_][A-Z0-9_]*%)$/;
const MARCADOR_DE_EXEMPLO = /^(?:REDACTED|PLACEHOLDER|CHANGE_?ME|EXAMPLE|x{3,}|\*{3,})\w*$/i;
const PLACEHOLDER_ESTREITO = { test: (v) => MARCADOR_DE_VARIAVEL.test(v) || MARCADOR_DE_EXEMPLO.test(v) };

const HOSTS_RESERVADOS = new Set(["localhost", "127.0.0.1", "host", "example.com"]);
const SUFIXOS_RESERVADOS = [".invalid", ".test", ".example"];

/** Host de documentação ou de laço local — URL com ele é fixture, nunca credencial alcançável. */
export function hostReservado(host) {
  const h = String(host ?? "").toLowerCase().replace(/\.$/, "");
  return HOSTS_RESERVADOS.has(h) || SUFIXOS_RESERVADOS.some((s) => h.endsWith(s));
}

/**
 * Nome do detector de segredo que casa a linha, ou `null`. Sem marcador de fixture nem allow.
 * O gate de commit isenta a linha inteira que tem cara de placeholder; `estrito` (a exportação)
 * isenta só pelo valor casado — `TOKEN=<valor real> # EXAMPLE` reprova. `detectores` restringe a
 * varredura a esses nomes (a medição de um detector só); ausente, todos.
 */
export function detectarSegredo(line, { estrito = false, detectores = null } = {}) {
  for (const d of DETECTORS) {
    if (detectores && !detectores.includes(d.name)) continue;
    if (d.soEstrito && !estrito) continue;
    // Detector global (`/g`) julga toda ocorrência da linha: a primeira isenta não esconde a segunda.
    const casos = d.re.global ? line.matchAll(d.re) : [d.re.exec(line)];
    for (const m of casos) {
      if (!m) continue;
      const value = m[1] || m[0];
      const ehMarcador = d.placeholder ? d.placeholder(value) : PLACEHOLDER.test(value);
      if (ehMarcador || (!estrito && PLACEHOLDER.test(line))) continue;
      if (d.isento?.(m)) continue;
      return d.name;
    }
  }
  return null;
}

// ───────────────────────────── nome de credencial ─────────────────────────────

// VEGA-26 T19: a lista única de nomes de credencial, medida nas duas estações pela T5
// (`notes/medicao-filtro-windows-T5.md`), com `.npmrc`, `.netrc` e `*.keystore`. Julga só o
// último segmento do caminho, cortado em `/` e em `\` (o Windows separa pasta pelos dois), sem caixa.
// A revisão da T19 somou os nomes de credencial comuns que a T5 não testou (`.envrc`,
// `.git-credentials`, `credentials`, `.pgpass`, `.htpasswd`, `*.p8`/`*.jks`/`*.ppk`/`*.kdbx`,
// `*.tfstate`, `service-account*.json`, chave privada com sufixo que não é `.pub`) e as pastas de
// credencial em qualquer altura (`.ssh`, `.aws`, `.gnupg`, `.docker`). O fechamento de F3 somou
// `<x>.env`, `.dev.vars`, `*.tfvars`, `.pypirc`, `.dockercfg`, `.vault-token`, `kubeconfig` e
// `secret(s).{yaml,yml,json,toml}`.
export const NOME_DE_CREDENCIAL =
  /^(\.env(\..*)?|.+\.env|\.dev\.vars|.*\.tfvars|\.pypirc|\.dockercfg|\.vault-token|kubeconfig|secrets?\.(ya?ml|json|toml)|\.envrc|credentials(\.json)?|\.git-credentials|\.pgpass|\.htpasswd|service-account.*\.json|id_(rsa|dsa|ecdsa|ed25519)(?!.*\.pub$).*|\.npmrc|\.netrc|.*\.(pem|key|p12|p8|pfx|jks|ppk|kdbx|keystore|tfstate))$/i;
const PASTA_DE_CREDENCIAL = new Set([".ssh", ".aws", ".gnupg", ".docker"]);

export function nomeDeCredencial(p) {
  const seg = String(p).split(/[/\\]/).filter(Boolean);
  const ultimo = seg.pop() ?? "";
  return NOME_DE_CREDENCIAL.test(ultimo) || seg.some((s) => PASTA_DE_CREDENCIAL.has(s.toLowerCase()));
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
