const fs = require("fs");
const path = require("path");

let cachedTerms = null;
let cachedMtime = null;
let warnedEmpty = false;

function isProbablyTermZh(term) {
  const t = String(term || "").trim();
  if (t.length < 2) return false;

  const maxLen = Number(process.env.TERM_MAX_LEN_ZH || 20);
  if (t.length > maxLen) return false;

  const blacklist = new Set([
    "小说","作品","电影","动画","作者","主角","故事","内容","名字","标题","书","书籍"
  ]);
  if (blacklist.has(t)) return false;

  const bad = [
    /(是一|是个|是一个|是一部|属于|叫做|名叫|名为)/,
    /(的|了|着|过|吗|吧|啊|呢|呀)/,
    /(很好看|好看|非常|特别|比较|不错|一般|推荐)/,
    /(经过|来到|去到|可以|需要|应该|怎么|如何)/,
    /(因为|所以|但是|如果|然后|因此)/,
  ];
  if (bad.some((r) => r.test(t))) return false;

  if (!/[\u4e00-\u9fff]/.test(t)) return false;

  return true;
}

function loadTermLibrary() {
  const inline = process.env.TERM_LIBRARY || "";
  const filePath = process.env.TERM_LIBRARY_PATH || "";
  const resolvedPath = filePath
    ? path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath)
    : "";

  if (resolvedPath) {
    try {
      const stat = fs.statSync(resolvedPath);
      if (cachedTerms && cachedMtime === stat.mtimeMs) return cachedTerms;
      const raw = fs.readFileSync(resolvedPath, "utf8");
      if (process.env.PGVECTOR_HYBRID_DEBUG === "true") {
        const preview = raw.split(/\r?\n/).filter(Boolean).slice(0, 2);
        console.log(
          "\x1b[36m[termExtractor]\x1b[0m",
          "TERM_LIBRARY_PATH",
          filePath,
          "resolved",
          resolvedPath
        );
        // console.log(
        //   "\x1b[36m[termExtractor]\x1b[0m",
        //   "TERM_LIBRARY_PATH preview",
        //   preview
        // );
      }
      cachedMtime = stat.mtimeMs;
      cachedTerms = parseTermList(raw, { strictJsonl: true });
      if (cachedTerms.length === 0 && !warnedEmpty) {
        console.warn(
          "[termExtractor] TERM_LIBRARY_PATH loaded but no terms were parsed. Check file format.",
          resolvedPath
        );
        warnedEmpty = true;
      }
      return cachedTerms;
    } catch {
      cachedTerms = parseTermList(inline, { strictJsonl: false });
      return cachedTerms;
    }
  }

  cachedTerms = parseTermList(inline, { strictJsonl: false });
  return cachedTerms;
}

function parseTermList(raw = "", options = {}) {
  const { strictJsonl = false } = options;
  const text = String(raw || "").trim();
  if (!text) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        const terms = [];
        for (const obj of data) {
          if (obj?.chinese && String(obj.chinese).trim().length >= 2)
            terms.push(String(obj.chinese).trim());
          if (obj?.english && String(obj.english).trim().length >= 2)
            terms.push(String(obj.english).trim());
        }
        return dedupeAndLimit(terms, terms.length);
      }
    } catch {
      // fallback to line parsing
    }
  }

  const lines = text.split(/\r?\n/);
  const terms = [];
  let parsedJsonLines = 0;

  let buffer = "";
  let braceBalance = 0;
  const flushBuffer = () => {
    const candidate = buffer.trim();
    buffer = "";
    braceBalance = 0;
    if (!candidate) return false;
    if (!(candidate.startsWith("{") && candidate.endsWith("}"))) return false;
    try {
      const obj = JSON.parse(candidate);
      const zhTerms = extractChineseTerms(obj?.chinese);
      const enTerms = extractEnglishTerms(obj?.english);
      zhTerms.forEach((t) => terms.push(t));
      if (process.env.TERM_INCLUDE_EN === "true")
        enTerms.forEach((t) => terms.push(t));
      parsedJsonLines += 1;
      return true;
    } catch {
      return false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (strictJsonl) {
      if (buffer.length === 0 && !trimmed.startsWith("{")) continue;
      buffer += (buffer.length ? "\n" : "") + trimmed;
      braceBalance += (trimmed.match(/{/g) || []).length;
      braceBalance -= (trimmed.match(/}/g) || []).length;
      if (braceBalance <= 0 && buffer.trim().endsWith("}")) {
        if (flushBuffer()) continue;
      }
      continue;
    }

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed);
        const zhTerms = extractChineseTerms(obj?.chinese);
        const enTerms = extractEnglishTerms(obj?.english);
        zhTerms.forEach((t) => terms.push(t));
        if (process.env.TERM_INCLUDE_EN === "true")
          enTerms.forEach((t) => terms.push(t));
        parsedJsonLines += 1;
        continue;
      } catch {
        // fall through to raw split
      }
    }

    // fallback: split this line into list items
    const parts = trimmed.split(/,|;|\|/);
    for (const part of parts) {
      const zhTerms = extractChineseTerms(part);
      zhTerms.forEach((t) => terms.push(t));
      if (process.env.TERM_INCLUDE_EN === "true") {
        const enTerms = extractEnglishTerms(part);
        enTerms.forEach((t) => terms.push(t));
      }
    }
  }

  if (parsedJsonLines > 0) return dedupeAndLimit(terms, terms.length);

  return dedupeAndLimit(terms, terms.length);
}

function cleanTerm(value, maxLen) {
  if (value === null || value === undefined) return null;
  let term = String(value).replace(/\*\*/g, "").trim();
  if (term.length < 2) return null;
  term = term.replace(/\s+/g, " ").trim();
  if (maxLen && term.length > maxLen) return null;
  return term;
}

function extractChineseTerms(value) {
  if (value === null || value === undefined) return [];
  const raw = String(value).replace(/\*\*/g, "");
  const parts = raw.split(/[\/、，,;；|]/);
  const results = [];
  const maxLen = Number(process.env.TERM_MAX_LEN_ZH || 20);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const matches = trimmed.match(/[\u4e00-\u9fff]{2,}/g) || [];
    for (const match of matches) {
      const term = cleanTerm(match, maxLen);
      if (term) results.push(term);
    }
  }
  return results;
}

function extractEnglishTerms(value) {
  if (value === null || value === undefined) return [];
  const raw = String(value).replace(/\*\*/g, "");
  const parts = raw.split(/[\/、，,;；|]/);
  const results = [];
  const maxLen = Number(process.env.TERM_MAX_LEN_EN || 60);
  for (const part of parts) {
    const term = cleanTerm(part, maxLen);
    if (!term) continue;
    if (!/[A-Za-z]/.test(term)) continue;
    results.push(term);
  }
  return results;
}

function extractQuotedTerms(input = "") {
  const terms = [];
  const text = String(input);
  const titleRegex = /[《<【]([^》>】]{2,30})[》>】]/g;
  let tmatch = null;
  while ((tmatch = titleRegex.exec(text)) !== null) {
    const term = tmatch[1].trim();
    if (term.length >= 2) terms.push(term);
  }
  const regex = /["“”'‘’]([^"“”'‘’]{2,20})["“”'‘’]/g;
  let match = null;
  while ((match = regex.exec(text)) !== null) {
    const term = match[1].trim();
    if (term.length >= 2) terms.push(term);
  }
  return terms;
}

function extractMarkedTerms(input = "") {
  const text = String(input);
  const patterns = [
    /(?:名字叫|名叫|名为|叫做|书名是|书名|标题|题为)[:：\\s]*([\u4e00-\u9fff]{2,20})/g,
    /(?:小说|作品|书)([\u4e00-\u9fff]{2,20})/g,
  ];
  const terms = [];
  for (const pattern of patterns) {
    let match = null;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1].trim();
      if (term.length >= 2) terms.push(term);
    }
  }
  return terms;
}

function extractCjkTerms(input = "") {
  const text = String(input);
  const results = [];

  // 仅做高精度的“书名/专名后缀”抽取（宁可空）
  const titleLike = /([\u4e00-\u9fff]{2,12}(?:传|记|录|书|篇|志|经|诀|典|集))/g;
  let m = null;
  while ((m = titleLike.exec(text)) !== null) {
    results.push(m[1]);
  }
  return results;
}


function extractTerms(input = "", options = {}) {
  const {
    maxTerms = Number(process.env.TERM_EXTRACT_MAX || 3),
  } = options;
  if (!input || typeof input !== "string") return [];

  const library = loadTermLibrary();
  // if (process.env.PGVECTOR_HYBRID_DEBUG === "true") {
  //   console.log(
  //     "\x1b[36m[termExtractor]\x1b[0m",
  //     "librarySize",
  //     library.length,
  //     library.length > 0 ? "sample" : "",
  //     library.slice(0, 3)
  //   );
  // }
  let hits = library.length > 0 ? matchByTrie(input, library) : [];
  if (library.length > 0 && hits.length === 0) {
    hits = matchByExactIncludes(input, library);
  }
  if (hits.length > 0) return dedupeAndLimit(hits, maxTerms);

  // NER fallback (heuristic): titles/quotes + marker-based + CJK spans
  const fallback = [
    ...extractQuotedTerms(input),
    ...extractMarkedTerms(input),
    ...extractCjkTerms(input),
  ].filter(isProbablyTermZh);
  
  return dedupeAndLimit(fallback, maxTerms);  
}

function dedupeAndLimit(terms, maxTerms) {
  const unique = Array.from(new Set(terms));
  unique.sort((a, b) => b.length - a.length);
  const filtered = removeSubterms(unique);
  return filtered.slice(0, Math.max(0, maxTerms));
}

function removeSubterms(terms) {
  const kept = [];
  for (const term of terms) {
    if (kept.some((t) => t.includes(term))) continue;
    kept.push(term);
  }
  return kept;
}

function buildTrie(terms = []) {
  const root = { next: new Map(), end: false };
  for (const term of terms) {
    const chars = Array.from(term);
    let node = root;
    for (const ch of chars) {
      if (!node.next.has(ch)) node.next.set(ch, { next: new Map(), end: false });
      node = node.next.get(ch);
    }
    node.end = true;
  }
  return root;
}

function matchByTrie(input, terms) {
  const matches = [];
  const inputText = String(input);

  const lowerTerms = terms
    .filter((t) => /[A-Za-z]/.test(t))
    .map((t) => t.toLowerCase());
  const cjkTerms = terms.filter((t) => !/[A-Za-z]/.test(t));

  if (cjkTerms.length > 0) {
    const trie = buildTrie(cjkTerms);
    for (let i = 0; i < inputText.length; i++) {
      let node = trie;
      let lastMatch = null;
      for (let j = i; j < inputText.length; j++) {
        const ch = inputText[j];
        if (!node.next.has(ch)) break;
        node = node.next.get(ch);
        if (node.end) lastMatch = inputText.slice(i, j + 1);
      }
      if (lastMatch) matches.push(lastMatch);
    }
  }

  if (lowerTerms.length > 0) {
    const lowerInput = inputText.toLowerCase();
    const trie = buildTrie(lowerTerms);
    for (let i = 0; i < lowerInput.length; i++) {
      let node = trie;
      let lastMatch = null;
      for (let j = i; j < lowerInput.length; j++) {
        const ch = lowerInput[j];
        if (!node.next.has(ch)) break;
        node = node.next.get(ch);
        if (node.end) lastMatch = lowerInput.slice(i, j + 1);
      }
      if (lastMatch) matches.push(lastMatch);
    }
  }

  return matches;
}

function matchByExactIncludes(input, terms) {
  const matches = [];
  const inputText = String(input);
  const lowerInput = inputText.toLowerCase();
  for (const term of terms) {
    if (!term) continue;
    if (/[A-Za-z]/.test(term)) {
      if (lowerInput.includes(term.toLowerCase())) matches.push(term);
    } else if (inputText.includes(term)) {
      matches.push(term);
    }
  }
  return matches;
}

module.exports = { extractTerms };
