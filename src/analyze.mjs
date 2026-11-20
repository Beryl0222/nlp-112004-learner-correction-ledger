// 单篇草稿分析：在分句、引语、并列、省略和前后文中找学生自己的表达。
// 同一句存在多个合法分析时输出 readings 与 dispute，默认挂起等待教师裁决，
// 不按单一答案预先登记掌握。
import { evaluateWriting, formsInText } from './grammar.mjs';
import { splitSegments, trackSubjects, parallelKey, hintOverlap } from './segments.mjs';

function formsInsideQuotes(text, exercise) {
  const { quotes } = splitSegments(text);
  const present = new Set();
  for (const quote of quotes) {
    for (const form of formsInText(quote.text, exercise.forms)) present.add(form);
  }
  return [...present];
}

function makeFinding(code, category, reason, span = null, extra = {}) {
  return { code, category, reason, span, ...extra };
}

/**
 * 找“省略主语且可能换主语”的分句：承前主语来自第三人称，且与前一分句动作同骨架。
 * 例如 “姐姐说她关门，关了窗。” 第二个“关”可能仍是姐姐，也可能是学生。
 */
function findAmbiguousEllipsis(text) {
  const { clauses } = splitSegments(text);
  const tracked = trackSubjects(clauses);
  const ambiguous = [];
  for (const [index, record] of tracked.entries()) {
    if (!record.omitted || !record.priorSubject || record.priorSubject.type !== 'third') continue;
    const previous = clauses[index - 1];
    if (previous && parallelKey(previous.text) === parallelKey(record.clause.text)) {
      ambiguous.push(record);
    }
  }
  return ambiguous;
}

/**
 * 分析一篇写作草稿。
 * @param {object} writing writing 记录（含 note/helpSeen）
 * @param {object} exercise 对应练习
 * @param {Array<object>} chain 同一学生同一练习的全部草稿（按时间），用于前后文
 */
export function analyzeWriting(writing, exercise, chain = [writing]) {
  const text = writing.note;
  const segments = splitSegments(text);
  const evaluation = evaluateWriting(text, exercise);
  const findings = [];
  const disputes = [];

  // 1. 事实层：答错与漏答分开。
  for (const fact of evaluation.facts) {
    if (fact.status === 'contradict') {
      findings.push(makeFinding('FACT_CONTRADICTION', 'fact', fact.reason, fact.span, { fact: fact.fact }));
    } else if (fact.status === 'missing') {
      findings.push(makeFinding('FACT_MISSING', 'fact', `题目要求的事实“${fact.fact}”没有表达`, null, { fact: fact.fact }));
    } else if (fact.status === 'quoted') {
      findings.push(makeFinding('FACT_IN_QUOTE', 'requirement',
        `事实“${fact.fact}”只出现在引语里，不能算学生自己的表达`, fact.span, { fact: fact.fact }));
    }
  }

  // 2. 练习要求层：允许的表达范围里没有任何一种出现在学生自己的话中。
  for (const item of evaluation.forms) {
    if (!item.present) {
      findings.push(makeFinding('REQUIRED_FORM_MISSING', 'requirement',
        `本题强制练习的“${item.form}”没有出现在学生自己的话里`, null, { form: item.form }));
    }
  }

  // 3. 影响意思的语法层：省略主语导致施事不明。
  const ambiguousRecords = findAmbiguousEllipsis(text);
  for (const record of ambiguousRecords) {
    const clause = record.clause;
    findings.push(makeFinding('AMBIGUOUS_SUBJECT', 'grammar',
      `分句“${clause.text}”省略主语，承前的“${record.priorSubject.text}”与学生本人都说得通，施事不明`,
      { start: clause.start, end: clause.end }));
  }

  // 4. 多分析之一：强制句式只出现在引语里。
  const quotedForms = formsInsideQuotes(text, exercise);
  if (quotedForms.length > 0 && evaluation.missingRequiredForms.length > 0) {
    const overlap = quotedForms.filter(form => evaluation.missingRequiredForms.includes(form));
    if (overlap.length > 0) {
      const quoteSpan = segments.quotes[0]
        ? { start: segments.quotes[0].start, end: segments.quotes[segments.quotes.length - 1].end }
        : null;
      disputes.push({
        type: 'quote-form',
        span: quoteSpan,
        options: {
          strict: {
            label: '严格：引语里的句式不算学生会用',
            presentForms: evaluation.forms.filter(item => item.present).map(item => item.form),
            factStatuses: Object.fromEntries(evaluation.facts.map(item => [item.fact, item.status === 'quoted' ? 'missing' : item.status])),
          },
          lenient: {
            label: '从宽：承认引语里出现的句式',
            presentForms: exercise.forms.filter(form =>
              evaluation.forms.some(item => item.form === form && item.present) || quotedForms.includes(form)),
            factStatuses: Object.fromEntries(evaluation.facts.map(item => [item.fact, item.status === 'quoted' ? 'hit' : item.status])),
          },
        },
        pending: true,
      });
    }
  }

  // 5. 多分析之二：省略主语施事不明。
  for (const record of ambiguousRecords) {
    const clause = record.clause;
    disputes.push({
      type: 'ambiguous-ellipsis',
      span: { start: clause.start, end: clause.end },
      options: {
        strict: {
          label: '严格：该分句施事不明，题目事实未完成',
          missingFacts: exercise.requiredFacts,
        },
        lenient: {
          label: `从宽：按承前主语“${record.priorSubject.text}”理解`,
          missingFacts: [],
        },
      },
      pending: true,
    });
  }

  // 6. 照抄/受助识别：部分重叠不认定照抄，只有近乎整句重合才登记。
  const copy = { copied: false, partial: false, hintIndex: null, ratio: 0 };
  writing.helpSeen.forEach(index => {
    const hint = exercise.hints[index];
    if (!hint) return;
    const overlap = hintOverlap(text, hint);
    if (overlap.copied) {
      copy.copied = true;
      copy.hintIndex = index;
      copy.ratio = overlap.ratio;
      findings.push(makeFinding('COPIED_HINT', 'requirement',
        `与提示 ${index} 整句重合度 ${overlap.ratio}，登记为照抄，留待教师审查`, null, { hintIndex: index }));
    } else if (overlap.partial) {
      copy.partial = true;
      copy.hintIndex = index;
      copy.ratio = overlap.ratio;
    }
  });

  const readings = disputes.map((dispute, index) => ({
    id: `r${writing.id}-${index + 1}`,
    disputeType: dispute.type,
    choices: Object.fromEntries(Object.entries(dispute.options).map(([key, option]) => [key, option.label])),
  }));

  return {
    writingId: writing.id,
    exerciseId: exercise.id,
    text,
    chain: chain.map(item => item.id),
    segments,
    evaluation,
    findings,
    disputes,
    readings,
    copy,
  };
}
