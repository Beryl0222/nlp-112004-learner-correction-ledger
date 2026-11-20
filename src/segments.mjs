// 分句、引语、省略主语与并列结构分析。
// 所有位置均使用字符偏移（按 code point 计），与原句 note 严格对应。

const QUOTE_RE = /[‘“][^’”]*[’”]/gd;
const CLAUSE_PUNCT = new Set(['，', '。', '！', '？', '；', '：', '、', '…']);

// 课内短写作出现的动作字，用于判断两个分句是否共用同一动作骨架（并列/承前）。
const VERB_CHARS = new Set([
  '说', '喊', '叫', '关', '放', '带', '拿', '捎', '搬', '拖',
  '挂', '收', '留', '腾', '空', '去', '走', '进', '出',
]);

/**
 * 把原句切成引语与分句。
 * @returns {{quotes: Array<{text:string,start:number,end:number}>,
 *           clauses: Array<{text:string,start:number,end:number,quoted:boolean}>}}
 */
export function splitSegments(text) {
  const chars = [...text];
  const quotes = [];
  for (const match of text.matchAll(QUOTE_RE)) {
    const start = match.index;
    const end = start + [...match[0]].length;
    quotes.push({ text: match[0], start, end });
  }
  const insideQuote = index => quotes.some(q => index >= q.start && index < q.end);

  const clauses = [];
  let buffer = '';
  let bufferStart = 0;
  const flush = end => {
    if (buffer.length > 0) {
      const start = bufferStart;
      clauses.push({
        text: buffer,
        start,
        end,
        quoted: quotes.some(q => start >= q.start && end <= q.end),
      });
      buffer = '';
    }
  };
  chars.forEach((char, index) => {
    if (insideQuote(index)) return; // 引语内部不做顶层分句
    if (CLAUSE_PUNCT.has(char)) {
      flush(index);
    } else {
      if (buffer.length === 0) bufferStart = index;
      buffer += char;
    }
  });
  flush(chars.length);
  return { quotes, clauses };
}

const FIRST_RE = /^(我们|我)/;
const THIRD_RE = /^(她们|他们|它们|她|他|它|你|你们)/;
const NAMED_RE = /^([一-龥]{1,3}?)(说|喊|告诉|叫)/;

/**
 * 判断分句主语：first 第一人称显性主语；third 第三人称显性主语；omitted 省略。
 */
export function clauseSubject(clause) {
  const text = clause.text;
  const first = text.match(FIRST_RE);
  if (first) return { type: 'first', text: first[0] };
  const third = text.match(THIRD_RE);
  if (third) return { type: 'third', text: third[0] };
  const named = text.match(NAMED_RE);
  if (named) return { type: 'third', text: named[1] };
  return { type: 'omitted', text: null };
}

function lastVerb(text) {
  for (let i = [...text].length - 1; i >= 0; i -= 1) {
    if (VERB_CHARS.has([...text][i])) return [...text][i];
  }
  return null;
}

/**
 * 并列/承前骨架键：两个分句最后一个动作字相同则视为同骨架。
 * 例如 “她关门” 与 “关了窗” 的动作字都是 “关”。
 */
export function parallelKey(clauseText) {
  return lastVerb(clauseText);
}

/**
 * 沿顶层分句追踪省略主语。
 * @returns {Array<{clause:object, priorSubject:object|null, omitted:boolean}>}
 */
export function trackSubjects(clauses) {
  let priorSubject = null;
  return clauses.map(clause => {
    const subject = clauseSubject(clause);
    const record = { clause, omitted: subject.type === 'omitted', priorSubject };
    if (subject.type !== 'omitted') priorSubject = subject;
    return record;
  });
}

/** 去掉标点与空白，用于照抄比对。 */
export function normalizeText(text) {
  return [...text].filter(ch => /[一-龥a-zA-Z0-9]/.test(ch)).join('');
}

/** 最长公共子序列长度。 */
function lcsLength(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i][j] = a[i - 1] === b[j - 1]
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table[a.length][b.length];
}

/**
 * 学生文本与提示整句的重合度。
 * 只有近乎整句重合才算照抄；部分重叠只报告比例，绝不据此认定照抄。
 */
export function hintOverlap(note, hint) {
  const left = normalizeText(note);
  const right = normalizeText(hint);
  if (left.length === 0 || right.length === 0) return { ratio: 0, copied: false, partial: false };
  const shared = lcsLength(left, right);
  const ratio = shared / Math.max(left.length, right.length);
  return {
    ratio: Number(ratio.toFixed(3)),
    copied: ratio >= 0.8 && Math.min(left.length, right.length) >= 6,
    partial: ratio >= 0.3 && ratio < 0.8,
  };
}
