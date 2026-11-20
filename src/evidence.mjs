// 技能证据登记、教师裁决与裁决传播。
// 证据分类与 README 的班级约定一致：
// independent 独立答对；helped 看过实质提示后改对；copied 整句照抄；
// manual 教师手动确认；disputed 多分析挂起；fact-error 事实答错；
// withdrawn 被教师撤回。只有 independent 与 manual 计入独立证据数。
import { analyzeWriting } from './analyze.mjs';
import { formsInText } from './grammar.mjs';

// 技能与本题强制练习表达的对应；未登记的技能按题目 forms 兜底。
const SKILL_FORMS = {
  'ba-complete': ['把字句'],
  'bei-focus': ['被字句'],
  reported: ['直接引语', '间接引语'],
  'scope-negative': ['范围否定', '先肯定后否定'],
  serial: ['连动'],
  'subject-ref': ['语境可省略第一人称'],
};

function teacherActionsFor(teacher, writingId) {
  return teacher
    .filter(item => item.writing === writingId)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** 依据键：同一学生、同一技能，事实与句式状态完全相同才算同一依据。 */
export function basisKey(writing, exercise, skill, analysis) {
  const factSig = analysis.evaluation.facts
    .map(item => `${item.fact}:${item.status}`)
    .sort()
    .join('|');
  const ownForms = analysis.evaluation.forms
    .filter(item => item.present)
    .map(item => item.form)
    .sort()
    .join('|');
  const chainRoot = analysis.chain[0] ?? writing.id;
  return [writing.student, skill, exercise.id, factSig, ownForms, `root:${chainRoot}`].join('||');
}

function classify(writing, exercise, skill, analysis, actions) {
  const last = actions.at(-1);
  if (last === '撤回') return { state: 'withdrawn', reason: '教师撤回该证据' };
  if (last === '调查') return { state: 'disputed', reason: '教师请求调查，等待裁决' };

  if (analysis.copy.copied) {
    return { state: 'copied', reason: `整句照抄提示 ${analysis.copy.hintIndex}` };
  }
  if (analysis.disputes.length > 0) {
    return { state: 'disputed', reason: analysis.disputes.map(item => item.type).join('、') };
  }

  const contradict = analysis.evaluation.facts.some(item => item.status === 'contradict');
  const missingFacts = analysis.evaluation.facts.filter(item => item.status === 'missing' || item.status === 'quoted');
  const requiredForms = SKILL_FORMS[skill] ?? exercise.forms;
  // 技能要求的句式优先在学生原话（引语外）直接检测；
  // 仅当该句式属于本题 forms 时，才采用题面允许表达的命中结果。
  const exerciseFormHit = form =>
    analysis.evaluation.forms.some(item => item.form === form && item.present);
  const ownTextHit = form => formsInText(analysis.evaluation.ownText, [form]).length > 0;
  const formOk = requiredForms.some(form =>
    exercise.forms.includes(form) ? exerciseFormHit(form) : ownTextHit(form));
  if (contradict) return { state: 'fact-error', reason: '事实与题面冲突' };
  if (missingFacts.length > 0) return { state: 'fact-error', reason: '题目指定事实未完成' };
  if (!formOk) return { state: 'fact-error', reason: '强制练习的表达没有出现在学生自己的话里' };

  if (last === '确认') return { state: 'manual', reason: '教师手动确认' };
  if (writing.helpSeen.length > 0) {
    return { state: 'helped', reason: `看过题内提示 ${writing.helpSeen.join('、')}` };
  }
  return { state: 'independent', reason: '学生独立答对' };
}

/**
 * 登记一次写作对其练习各技能的证据（一篇可覆盖多个技能）。
 */
export function evaluateEvidence(writing, exercise, chain, teacher) {
  const analysis = analyzeWriting(writing, exercise, chain);
  return exercise.skills.map(skill => {
    const actions = teacherActionsFor(teacher, writing.id);
    const verdict = classify(writing, exercise, skill, analysis, actions.map(item => item.action));
    return {
      writingId: writing.id,
      student: writing.student,
      exerciseId: exercise.id,
      skill,
      state: verdict.state,
      reason: verdict.reason,
      basisKey: basisKey(writing, exercise, skill, analysis),
      chainRoot: analysis.chain[0] ?? writing.id,
      helpSeen: [...writing.helpSeen],
      teacherActions: actions.map(item => ({ id: item.id, action: item.action, note: item.note, at: item.at })),
      analysis,
    };
  });
}

/**
 * 应用教师裁决，并把裁决传播到仍有同一依据的其他证据。
 * 传播边界：
 *  - 不覆盖被裁决草稿改写链上的后代（随后改写的不同语境）；
 *  - “撤回”可跨题传播到同依据证据；“确认”只在同一练习内生效；
 *  - 被传播的证据带 autoPropagated，仍可单独再裁决。
 */
export function applyRuling(evidenceRows, ruling) {
  const target = evidenceRows.find(row => row.writingId === ruling.writing && row.skill === ruling.skill);
  if (!target) throw new Error(`找不到证据 ${ruling.writing}/${ruling.skill}`);
  const descendants = new Set();
  const collect = rootId => {
    evidenceRows.forEach(row => {
      if (row.chainRoot === rootId && row.writingId !== rootId) {
        descendants.add(row.writingId);
      }
    });
  };
  collect(target.writingId);
  collect(target.chainRoot);

  return evidenceRows.map(row => {
    if (row === target || row.writingId === ruling.writing) {
      return {
        ...row,
        state: ruling.action === '确认' ? 'manual' : ruling.action === '撤回' ? 'withdrawn' : 'disputed',
        reason: ruling.note ?? row.reason,
        ruledBy: ruling.id ?? 'manual-ruling',
      };
    }
    const sameBasis = row.basisKey === target.basisKey;
    const sameExercise = row.exerciseId === target.exerciseId;
    const eligible = sameBasis
      && !descendants.has(row.writingId)
      && (ruling.action === '撤回' || (ruling.action === '确认' && sameExercise));
    if (!eligible) return row;
    return {
      ...row,
      state: ruling.action === '确认' ? 'manual' : 'withdrawn',
      reason: `按 ${ruling.writingId} 的同依据裁决${ruling.action}`,
      autoPropagated: true,
      ruledBy: ruling.id ?? 'manual-ruling',
    };
  });
}

/** 汇总一个学生的全部技能证据。 */
export function collectEvidence(bundle, student) {
  const { writing, exercises, teacher } = bundle;
  const rows = [];
  const mine = writing.filter(item => item.student === student);
  for (const entry of mine) {
    const exercise = exercises.find(item => item.id === entry.exercise);
    const chain = mine
      .filter(item => item.exercise === entry.exercise)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    rows.push(...evaluateEvidence(entry, exercise, chain, teacher));
  }
  return rows;
}
