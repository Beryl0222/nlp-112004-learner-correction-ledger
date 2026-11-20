// 句式检测与题目事实核对。
// 事实核对区分四种状态：hit（学生自己的表达命中）、quoted（只在引语里出现）、
// contradict（出现与事实冲突的说法）、missing（没有表达）。
import { splitSegments } from './segments.mjs';

// 把字句允许否定词前置于“把”（没把/不把），核心仍是“把+宾语+动作结果”。
const BA_RE = /(把|没把|不把)[^，。！？；：、…]{1,12}?[一-龥]/;
const BEI_RE = /被[^，。！？；：、…]{0,12}?(拿|取|带)/;
// 目的连动：显式目的标记，或句尾“空出/腾出/留出+处所”式目的分句。
const PURPOSE_RE = /(为了|好让|以便)[^，。！？；：、…]{1,12}|(空出|腾出|留出)[^，。！？；：、…]{0,6}(过道|地方|角落|门口)/;
const INDIRECT_RE = /说(她|他|它)/;

/** 去掉引语后的“学生自己的话”，用于句式与事实核对。 */
export function outsideQuotes(text) {
  const { quotes } = splitSegments(text);
  let result = text;
  for (let i = quotes.length - 1; i >= 0; i -= 1) {
    result = `${result.slice(0, quotes[i].start)}${result.slice(quotes[i].end)}`;
  }
  return result;
}

export function hasBa(text) {
  return BA_RE.test(outsideQuotes(text));
}

export function hasBei(text) {
  return BEI_RE.test(outsideQuotes(text));
}

export function hasDirectSpeech(text) {
  return splitSegments(text).quotes.length > 0;
}

export function hasIndirectSpeech(text) {
  return INDIRECT_RE.test(outsideQuotes(text));
}

export function hasScopeNegative(text) {
  const own = outsideQuotes(text);
  // 先肯定后否定是范围否定的允许说法（e4 的 forms 明确允许）。
  if (/只|就/.test(own) && /没|不/.test(own)) return true;
  // 否定词不直接辖制全称量项，而是落在“带走/留下”这类谓词上。
  return /(没|不)(把)?[^，。！？；：、…]{0,6}(带|留|拿)/.test(own) && !/没(有)?把[^，。！？；：、…]{0,4}都/.test(own);
}

export function hasPurposeSerial(text) {
  return PURPOSE_RE.test(outsideQuotes(text));
}

/** 允许语境省略第一人称：顶层分句省主语且题面是第一人称活动。 */
export function acceptableFirstPersonEllipsis(text, exercise) {
  const own = outsideQuotes(text);
  if (!/你|我/.test(exercise.question)) return false;
  return splitSegments(own).clauses.length > 0
    && splitSegments(own).clauses.some(clause => !/^我|^我们/.test(clause.text));
}

const FORM_DETECTORS = {
  把字句: hasBa,
  被字句: hasBei,
  直接引语: hasDirectSpeech,
  间接引语: hasIndirectSpeech,
  范围否定: hasScopeNegative,
  先肯定后否定: hasScopeNegative,
  连动: hasPurposeSerial,
};

// 直接在给定原文上检测句式（不剥离引语），供引语内部句式识别使用。
const RAW_FORM_PATTERNS = {
  把字句: BA_RE,
  被字句: BEI_RE,
  间接引语: INDIRECT_RE,
};

/** 引语内部出现了哪些题目允许的句式。 */
export function formsInText(text, forms) {
  const present = new Set();
  for (const form of forms) {
    const pattern = RAW_FORM_PATTERNS[form];
    if (pattern && pattern.test(text)) present.add(form);
  }
  return [...present];
}

/**
 * 题目允许的每种表达是否在学生自己的话里出现（引语内的句式不算）。
 */
export function detectForms(text, exercise) {
  return exercise.forms.map(form => {
    const detector = FORM_DETECTORS[form];
    const present = detector
      ? detector(text, exercise)
      : outsideQuotes(text).includes(form);
    return { form, present };
  });
}

// 题目事实登记。contains 为命中写法，contradictions 为与该事实冲突的写法。
// 每条矛盾都带 reason，供建议与教师视图直接引用。
export const FACT_REGISTRY = {
  红伞: [
    { contains: '红伞' },
  ],
  楼下柜子: [
    { contains: '楼下柜子' },
    { re: /(放|搁|收)[^，。！？；：、…]{0,6}(楼上|桌上|柜子外)/, reason: '伞的落点不是楼下柜子' },
  ],
  '姐姐说关门': [
    { re: /关门/ },
    { re: /说[^，。！？；：、…]{0,6}关窗/, reason: '姐姐的原话是关门，不是关窗' },
  ],
  我关窗: [
    { re: /我关(了|过)?窗/ },
    { re: /我[^，。！？；：、…]{0,4}关门/, reason: '学生自己做的是关窗，不是关门' },
  ],
  老师取走彩灯: [
    { contains: '彩灯' },
    { re: /彩灯被(?!老师)/, reason: '取走彩灯的是老师' },
  ],
  彩灯原在门边: [
    { contains: '门边' },
    { re: /原(先|本)?在正门/, reason: '彩灯原先在门边，正门是后来挂的位置' },
  ],
  蓝本带走: [
    { re: /蓝本|蓝的/ },
  ],
  绿本留下: [
    { re: /绿本|绿的/ },
  ],
  灰椅搬到角落: [
    { contains: '角落' },
    { re: /(搬|拖)[^，。！？；：、…]{0,6}(走廊|过道|门口)/, reason: '灰椅要搬到角落，不是走廊' },
  ],
  目的是腾过道: [
    { contains: '过道' },
    { contains: '门口', reason: '腾出的是过道，不是门口' },
  ],
};

function locate(text, needle) {
  const index = text.indexOf(needle);
  if (index < 0) return null;
  const start = index;
  return { start, end: start + [...needle].length };
}

function matchPattern(text, pattern) {
  if (pattern.contains) return locate(text, pattern.contains);
  const match = text.match(pattern.re);
  if (!match) return null;
  const start = match.index;
  return { start, end: start + [...match[0]].length };
}

/**
 * 核对单条 requiredFact。
 */
export function evaluateFact(fact, text) {
  const registry = FACT_REGISTRY[fact] ?? [{ contains: fact }];
  const { quotes } = splitSegments(text);
  const inQuote = span => quotes.some(q => span.start >= q.start && span.end <= q.end);

  // 矛盾优先：引语里保留的是题面正确事实，冲突出现在学生自己的话里。
  let onlyQuoted = true;
  let hitSpan = null;
  for (const pattern of registry) {
    if ('reason' in pattern) continue;
    const span = matchPattern(text, pattern);
    if (span) {
      hitSpan = span;
      if (!inQuote(span)) onlyQuoted = false;
    }
  }
  for (const pattern of registry) {
    if (!('reason' in pattern)) continue;
    const span = matchPattern(text, pattern);
    if (span && !inQuote(span)) {
      return { fact, status: 'contradict', span, reason: pattern.reason };
    }
  }
  if (hitSpan) {
    return { fact, status: onlyQuoted ? 'quoted' : 'hit', span: hitSpan };
  }
  return { fact, status: 'missing', span: null };
}

/** 核对一次练习的全部事实与允许表达。 */
export function evaluateWriting(text, exercise) {
  const facts = exercise.requiredFacts.map(fact => evaluateFact(fact, text));
  const forms = detectForms(text, exercise);
  const ownText = outsideQuotes(text);
  return {
    facts,
    forms,
    ownText,
    factErrors: facts.filter(item => item.status === 'missing' || item.status === 'contradict'),
    missingRequiredForms: forms.filter(item => !item.present).map(item => item.form),
  };
}
