// 纠错建议引擎。
// 每条建议带原句位置、依赖（requires）与互斥（exclusiveWith）。
// 不提供逐项接受的冲突清单：试改以“组合”为单位，渲染组合后的整句，
// 再用与分析相同的事实/句式检查守卫，保证语法建议不抹掉题目指定事实和强制表达。
import { evaluateFact, detectForms, outsideQuotes } from './grammar.mjs';

function makeSuggestion(id, writingId, title, edits, rest = {}) {
  return {
    id,
    writingId,
    title,
    rationale: rest.rationale ?? '',
    edits,
    requires: rest.requires ?? [],
    exclusiveWith: rest.exclusiveWith ?? [],
    reading: rest.reading ?? null,
    guardNote: rest.guardNote ?? null,
  };
}

function replaceSpan(start, end, replacement, kind = 'replace') {
  return { start, end, replacement, kind };
}

function locate(text, needle) {
  const start = text.indexOf(needle);
  if (start < 0) return null;
  return { start, end: start + [...needle].length };
}

/** 按偏移倒序应用一组编辑。 */
export function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let result = text;
  for (const edit of sorted) {
    result = `${result.slice(0, edit.start)}${edit.replacement}${result.slice(edit.end)}`;
  }
  return result;
}

/** 两条编辑落在同一字符区间（含交叉）即互斥。 */
function overlaps(one, another) {
  return one.start < another.end && another.start < one.end;
}

/**
 * 守卫：改后的整句必须仍表达全部 requiredFacts、且包含至少一种强制表达。
 * 返回 hardErrors（不允许接受）与 warnings（可试改，但会标明这次不再支持进阶）。
 */
export function guardResult(finalText, exercise) {
  const hardErrors = [];
  const warnings = [];
  const quoteIsAllowed = exercise.forms.some(form => form === '直接引语' || form === '间接引语');
  for (const fact of exercise.requiredFacts) {
    const result = evaluateFact(fact, finalText);
    if (result.status === 'missing') hardErrors.push(`丢掉了题目事实“${fact}”`);
    if (result.status === 'contradict') hardErrors.push(`仍与题目事实“${fact}”冲突：${result.reason}`);
    if (result.status === 'quoted' && !quoteIsAllowed) {
      warnings.push(`事实“${fact}”只在引语里，这次不能算独立表达`);
    }
  }
  const forms = detectForms(finalText, exercise);
  if (forms.every(item => !item.present)) {
    hardErrors.push(`整句不再包含本题强制练习的表达：${exercise.forms.join('、')}`);
  }
  return { hardErrors, warnings };
}

function quoteSpan(text) {
  const match = text.match(/[‘“][^’”]*[’”]/);
  if (!match) return null;
  return { start: match.index, end: match.index + [...match[0]].length };
}

/** 针对 w1 型：把字句只出现在引语里。 */
function quoteFormSuggestions(analysis, exercise) {
  const dispute = analysis.disputes.find(item => item.type === 'quote-form');
  if (!dispute) return [];
  const text = analysis.text;
  const quote = quoteSpan(text);
  const tail = locate(text, '我就去收伞了。');
  const suggestions = [];

  if (quote) {
    suggestions.push(makeSuggestion(
      `${analysis.writingId}-s1`, analysis.writingId,
      '严格改法：去掉转述框架，自己用把字句说清事实',
      [replaceSpan(quote.start, quote.end, '我把红伞放进楼下柜子里。')],
      {
        rationale: '引语里的“把”不表明学生会用把字句；把指定事实放到学生自己的话里。',
        reading: 'strict',
        guardNote: '保留红伞与楼下柜子两个事实，并在引语外使用把字句。',
      },
    ));
    if (tail) {
      suggestions.push(makeSuggestion(
        `${analysis.writingId}-s2`, analysis.writingId,
        '从宽改法：保留姐姐的话，再补一句自己的把字句',
        [replaceSpan(tail.start, tail.end, '我把红伞放进楼下柜子里。')],
        {
          rationale: '承认引语价值，但学生自己的话仍须出现强制句式与事实。',
          reading: 'lenient',
          guardNote: '与 s1 互斥：一个去转述框架，一个保留转述框架。',
        },
      ));
    }
  }
  // 互斥关系成对登记，教师与学生端都不能同时接受。
  if (suggestions.length === 2) {
    suggestions[0].exclusiveWith = [suggestions[1].id];
    suggestions[1].exclusiveWith = [suggestions[0].id];
  }
  return suggestions;
}

/** 针对 w6 型：引语要求未完成 + 末分句施事不明。 */
function ambiguousEllipsisSuggestions(analysis, exercise) {
  const dispute = analysis.disputes.find(item => item.type === 'ambiguous-ellipsis');
  if (!dispute) return [];
  const text = analysis.text;
  const suggestions = [];
  const finding = analysis.findings.find(item => item.code === 'AMBIGUOUS_SUBJECT');
  const windowClause = locate(text, '关了窗');

  if (windowClause) {
    suggestions.push(makeSuggestion(
      `${analysis.writingId}-s1`, analysis.writingId,
      '给末分句补上第一人称主语，明确是“我”关窗',
      [replaceSpan(windowClause.start, windowClause.end, '我关了窗')],
      { rationale: '消除施事不明；与姐姐的“关门”区分开。' },
    ));
    suggestions.push(makeSuggestion(
      `${analysis.writingId}-s2`, analysis.writingId,
      '把姐姐的话改成直接引语，满足本题引语练习',
      [replaceSpan(0, windowClause.start, '姐姐说：“你去关门。”')],
      {
        rationale: '本题允许直接引语或间接引语；间接转述保留，但必须让引语形式真正出现。',
        requires: [`${analysis.writingId}-s1`],
        guardNote: 's2 单独接受会丢掉“关窗”事实，必须与 s1 组合。',
      },
    ));
  }
  if (finding) {
    // 守卫演示项：把末分句主语改成第三人称，会与“我关窗”事实冲突。
    suggestions.push(makeSuggestion(
      `${analysis.writingId}-s3`, analysis.writingId,
      '把末分句主语判为姐姐（与 s1 互斥，试改会触发事实守卫）',
      [replaceSpan(windowClause.start, windowClause.end, '她关了窗')],
      {
        rationale: '对应从宽阅读；但与题面“我关窗”冲突，守卫会拦下。',
        exclusiveWith: [`${analysis.writingId}-s1`],
      },
    ));
  }
  return suggestions;
}

/** 针对 w5 型：事实被改写，但句式本身正确。 */
function factDriftSuggestions(analysis) {
  const suggestions = [];
  const text = analysis.text;
  const corridor = locate(text, '走廊');
  const doorway = locate(text, '门口');
  if (corridor) {
    suggestions.push(makeSuggestion(
      `${analysis.writingId}-s1`, analysis.writingId,
      '把落点“走廊”改回题目指定的“角落”',
      [replaceSpan(corridor.start, corridor.end, '角落')],
      { rationale: '语法读得顺，但落点改错即事实答错，不能支持进阶。' },
    ));
  }
  if (doorway) {
    suggestions.push(makeSuggestion(
      `${analysis.writingId}-s2`, analysis.writingId,
      '把目的处所“门口”改回“过道”，保留“空出”目的框架',
      [replaceSpan(doorway.start, doorway.end, '过道')],
      { rationale: '目的事实必须与题面一致：空出的是过道。' },
    ));
  }
  return suggestions;
}

/**
 * 为一篇分析生成建议集。
 */
export function buildSuggestions(analysis, exercise) {
  const has = code => analysis.findings.some(item => item.code === code);
  const suggestions = [];
  if (analysis.disputes.some(item => item.type === 'quote-form')) {
    suggestions.push(...quoteFormSuggestions(analysis, exercise));
  }
  if (analysis.disputes.some(item => item.type === 'ambiguous-ellipsis')) {
    suggestions.push(...ambiguousEllipsisSuggestions(analysis, exercise));
  }
  if (has('FACT_CONTRADICTION') && !analysis.disputes.length) {
    suggestions.push(...factDriftSuggestions(analysis));
  }
  return suggestions;
}

/**
 * 试改：以组合为单位应用建议，报告依赖/互斥问题与守卫结果。
 * @param {string[]} suggestionIds 想同时试改的建议编号
 */
export function trialCombination(analysis, exercise, suggestions, suggestionIds) {
  const byId = new Map(suggestions.map(item => [item.id, item]));
  const chosen = suggestionIds.map(id => byId.get(id));
  const relationErrors = [];
  for (const item of chosen) {
    if (!item) continue;
    for (const required of item.requires) {
      if (!suggestionIds.includes(required)) relationErrors.push(`“${item.title}”依赖建议 ${required}，需一起试改`);
    }
    for (const other of item.exclusiveWith) {
      if (suggestionIds.includes(other)) relationErrors.push(`“${item.title}”与建议 ${other} 互斥，不能组合`);
    }
  }
  const edits = chosen.flatMap(item => item?.edits ?? []);
  for (let i = 0; i < edits.length; i += 1) {
    for (let j = i + 1; j < edits.length; j += 1) {
      if (overlaps(edits[i], edits[j])) {
        relationErrors.push('两条编辑落在同一原句区间，组合不成立');
      }
    }
  }
  const finalText = edits.length ? applyEdits(analysis.text, edits) : analysis.text;
  const guard = relationErrors.length
    ? { hardErrors: relationErrors, warnings: [] }
    : guardResult(finalText, exercise);
  return {
    originalText: analysis.text,
    chosenSuggestions: suggestionIds,
    finalText,
    relationErrors,
    hardErrors: guard.hardErrors,
    warnings: guard.warnings,
    acceptable: guard.hardErrors.length === 0,
    outsideQuotesAfter: outsideQuotes(finalText),
  };
}
