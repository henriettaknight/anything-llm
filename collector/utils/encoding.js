/**
 * 文本文件的编码自动识别与解码。
 *
 * 背景：
 *   collector 原先对所有文本类文件（.txt/.md/.csv/.json/.html...）一律按 UTF-8 读取，
 *   而中文 Windows 记事本默认的「ANSI」保存出来是 GBK/GB18030。这类文件按 UTF-8 解码
 *   会得到满篇 U+FFFD 乱码，最终以 [CONTEXT n] 的形式喂给模型，导致模型直接报
 *   「Encoding Error 无法阅读」。
 *
 * 识别顺序（先强信号、后启发式）：
 *   1. BOM：UTF-8 / UTF-16LE / UTF-16BE / UTF-32LE / UTF-32BE
 *   2. 严格 UTF-8 解码成功 → UTF-8（GBK 中文恰好构成合法 UTF-8 序列的概率极低）
 *   3. UTF-16 无 BOM 的启发式：NUL 字节占比与奇偶位置
 *   4. 候选编码评分：GB18030 / Big5 / Windows-1252，取「合法字符占比最高、替换字符最少」
 *   5. 兜底：非严格 UTF-8（保持修复前的行为，绝不因为识别失败而丢文件）
 *
 * 全部使用 Node 内建 TextDecoder（Node 18+ full-icu 支持 gb18030/big5/windows-1252），
 * 不引入任何新依赖；万一运行环境的 ICU 被裁剪，不支持的编码会自动跳过。
 */

/**
 * BOM 表。顺序敏感：UTF-32LE 的 BOM 以 UTF-16LE 的 BOM 开头，必须排在前面。
 */
const BOMS = [
  { encoding: "utf-32le", bytes: [0xff, 0xfe, 0x00, 0x00] },
  { encoding: "utf-32be", bytes: [0x00, 0x00, 0xfe, 0xff] },
  { encoding: "utf-8", bytes: [0xef, 0xbb, 0xbf] },
  { encoding: "utf-16le", bytes: [0xff, 0xfe] },
  { encoding: "utf-16be", bytes: [0xfe, 0xff] },
];

/** 严格 UTF-8 失败后，参与评分的候选编码（顺序即同分时的优先级）。 */
const CANDIDATE_ENCODINGS = ["gb18030", "big5", "windows-1252"];

/**
 * 运行环境是否支持某个编码（small-icu 的 Node 只支持 utf-8）。
 * @param {string} encoding
 * @returns {boolean}
 */
function isEncodingSupported(encoding) {
  try {
    new TextDecoder(encoding);
    return true;
  } catch {
    return false;
  }
}

/**
 * 匹配 BOM。
 * @param {Buffer} buffer
 * @returns {{encoding: string, length: number}|null}
 */
function matchBom(buffer) {
  for (const bom of BOMS) {
    if (buffer.length < bom.bytes.length) continue;
    let matched = true;
    for (let i = 0; i < bom.bytes.length; i++) {
      if (buffer[i] !== bom.bytes[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { encoding: bom.encoding, length: bom.bytes.length };
  }
  return null;
}

/**
 * 无 BOM 的 UTF-16 启发式：ASCII 文本存成 UTF-16 时，约一半的字节是 0x00。
 * 0x00 落在奇数下标说明是小端（高字节在后字节在前 → UTF-16LE）。
 * @param {Buffer} buffer
 * @returns {string|null} 'utf-16le' | 'utf-16be' | null
 */
function guessUtf16(buffer) {
  if (buffer.length < 4 || buffer.length % 2 !== 0) return null;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  const pairs = Math.floor(sample.length / 2);
  let evenNull = 0; // 下标为偶数（高位字节）为 0 → 大端
  let oddNull = 0; // 下标为奇数（高位字节）为 0 → 小端
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] !== 0) continue;
    if (i % 2 === 0) evenNull++;
    else oddNull++;
  }
  if (evenNull / pairs > 0.3) return "utf-16be";
  if (oddNull / pairs > 0.3) return "utf-16le";
  return null;
}

/**
 * 给解码结果打分：合法可读字符占比越高、替换字符/控制字符越少，分越高。
 * @param {string} text
 * @returns {number}
 */
function scoreDecoded(text) {
  if (!text.length) return -Infinity;

  let replacement = 0;
  let control = 0;
  let cjk = 0;
  let cjkPunct = 0;
  let ascii = 0;
  let latin = 0;

  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === 0xfffd) {
      replacement++;
    } else if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0x7f
    ) {
      control++;
    } else if (code >= 0x4e00 && code <= 0x9fff) {
      cjk++;
    } else if (
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjkPunct++;
    } else if (code >= 0x20 && code <= 0x7e) {
      ascii++;
    } else if (
      (code >= 0xa0 && code <= 0xff) ||
      (code >= 0x100 && code <= 0x24f)
    ) {
      latin++;
    }
  }

  const len = text.length;
  const good = (cjk + cjkPunct * 0.8 + ascii * 0.6 + latin * 0.6) / len;
  const bad = (replacement * 3 + control * 3) / len;
  return good - bad;
}

/**
 * 把 buffer 按指定编码解码（失败返回 null）。
 * @param {Buffer} buffer
 * @param {string} encoding
 * @param {boolean} [fatal=false]
 * @returns {string|null}
 */
function tryDecode(buffer, encoding, fatal = false) {
  try {
    return new TextDecoder(encoding, { fatal, ignoreBOM: true }).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * 自动识别编码并解码。
 *
 * @param {Buffer} buffer - 文件的原始字节
 * @returns {{text: string, encoding: string, via: 'bom'|'utf8'|'utf16'|'guess'|'fallback'}}
 *          encoding 为实际使用的编码；via 说明命中了哪一级识别（便于排障日志）。
 */
function decodeTextBuffer(buffer) {
  const empty = { text: "", encoding: "utf-8", via: "fallback" };
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return empty;

  // 1. BOM 优先
  const bom = matchBom(buffer);
  if (bom) {
    const text = tryDecode(buffer.subarray(bom.length), bom.encoding);
    if (text !== null) {
      return { text, encoding: bom.encoding, via: "bom" };
    }
  }

  // 2. 严格 UTF-8：能过就一定是 UTF-8
  const strictUtf8 = tryDecode(buffer, "utf-8", true);
  if (strictUtf8 !== null) {
    return { text: strictUtf8, encoding: "utf-8", via: "utf8" };
  }

  // 3. 无 BOM 的 UTF-16
  const utf16 = guessUtf16(buffer);
  if (utf16) {
    const text = tryDecode(buffer, utf16);
    if (text !== null) return { text, encoding: utf16, via: "utf16" };
  }

  // 4. 候选编码评分
  let best = null;
  for (const encoding of CANDIDATE_ENCODINGS) {
    if (!isEncodingSupported(encoding)) continue;
    const text = tryDecode(buffer, encoding);
    if (text === null) continue;
    const score = scoreDecoded(text);
    if (!best || score > best.score) best = { text, encoding, score };
  }
  if (best) {
    return { text: best.text, encoding: best.encoding, via: "guess" };
  }

  // 5. 兜底：非严格 UTF-8，与修复前行为一致
  return {
    text: buffer.toString("utf8"),
    encoding: "utf-8",
    via: "fallback",
  };
}

module.exports = {
  decodeTextBuffer,
  isEncodingSupported,
  scoreDecoded,
};
