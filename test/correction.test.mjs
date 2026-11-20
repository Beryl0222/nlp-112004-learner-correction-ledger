import assert from 'node:assert/strict';
import test from 'node:test';
import { readBundle } from '../tools/materials.mjs';
import { splitSegments, trackSubjects, hintOverlap, parallelKey } from '../src/segments.mjs';
import { evaluateWriting, hasBa, hasScopeNegative, hasPurposeSerial, evaluateFact } from '../src/grammar.mjs';
import { analyzeWriting } from '../src/analyze.mjs';
import { buildSuggestions, trialCombination, applyEdits, guardResult } from '../src/suggest.mjs';
import { collectEvidence, applyRuling } from '../src/evidence.mjs';
import { masteryForStudent } from '../src/mastery.mjs';
import { planSchedule } from '../src/schedule.mjs';
import { teacherReviewView, studentPlanView } from '../src/views.mjs';

const bundle = readBundle();
const exerciseOf = id => bundle.exercises.find(item => item.id === id);
const writingOf = id => bundle.writing.find(item => item.id === id);
const chainOf = writing => bundle.writing
  .filter(item => item.student === writing.student && item.exercise === writing.exercise)
  .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
const analyze = id => {
  const writing = writingOf(id);
  return analyzeWriting(writing, exerciseOf(writing.exercise), chainOf(writing));
};

test('分句与引语：w1 的把字句位于引语内，顶层分句不含引语文字', () => {
  const segments = splitSegments(writingOf('w1').note);
  assert.equal(segments.quotes.length, 1);
  assert.match(segments.quotes[0].text, /把红伞/);
  assert.ok(segments.clauses.every(clause => !clause.text.includes('把红伞')));
  assert.ok(segments.clauses.some(clause => clause.text === '我就去收伞了'));
});

test('省略主语追踪：w6 末分句承前第三人称且与前分句同动作骨架，标记为歧义', () => {
  const { clauses } = splitSegments(writingOf('w6').note);
  const tracked = trackSubjects(clauses);
  const omitted = tracked.filter(item => item.omitted);
  assert.equal(omitted.length, 1);
  assert.equal(omitted[0].priorSubject.text, '姐姐');
  assert.equal(parallelKey('她关门'), parallelKey('关了窗'));
});

test('照抄识别：近乎整句重合才算照抄，部分重叠不认定', () => {
  const hint = exerciseOf('e1').hints[0];
  assert.equal(hintOverlap('我把红伞放进楼下柜子里。', hint).copied, true);
  const partial = hintOverlap('红伞我收了，柜子在楼下。', hint);
  assert.equal(partial.copied, false);
  assert.ok(partial.ratio < 0.8);
});

test('句式检测不把引语里的把字句算成学生自己的表达', () => {
  assert.equal(hasBa(writingOf('w1').note), false);
  assert.equal(hasBa(writingOf('w2').note), true);
});

test('事实核对区分 命中/只在引语/矛盾/缺失', () => {
  const w1 = evaluateWriting(writingOf('w1').note, exerciseOf('e1'));
  assert.deepEqual(w1.facts.map(item => item.status), ['quoted', 'quoted']);
  const w5 = evaluateWriting(writingOf('w5').note, exerciseOf('e5'));
  const corner = w5.facts.find(item => item.fact === '灰椅搬到角落');
  const purpose = w5.facts.find(item => item.fact === '目的是腾过道');
  assert.equal(corner.status, 'contradict');
  assert.match(corner.reason, /角落/);
  assert.equal(purpose.status, 'contradict');
});

test('w8 的先肯定后否定被识别为允许的范围否定', () => {
  assert.equal(hasScopeNegative(writingOf('w8').note), true);
  const result = evaluateWriting(writingOf('w8').note, exerciseOf('e4'));
  assert.deepEqual(result.factErrors, []);
});

test('w4 的连动目的句通过事实与句式检查，语境省略主语不报错', () => {
  assert.equal(hasPurposeSerial(writingOf('w4').note), true);
  const result = evaluateWriting(writingOf('w4').note, exerciseOf('e5'));
  assert.deepEqual(result.factErrors, []);
  assert.deepEqual(result.missingRequiredForms, []);
});

test('w1 产生引语句式的多分析并挂起，不预先登记掌握', () => {
  const analysis = analyze('w1');
  const dispute = analysis.disputes.find(item => item.type === 'quote-form');
  assert.ok(dispute);
  assert.equal(dispute.pending, true);
  assert.ok(dispute.span.start >= 0 && dispute.span.end > dispute.span.start);
  assert.match(dispute.options.strict.label, /严格/);
  assert.match(dispute.options.lenient.label, /从宽/);
  assert.ok(analysis.findings.some(item => item.code === 'FACT_IN_QUOTE'));
  assert.ok(analysis.findings.some(item => item.code === 'REQUIRED_FORM_MISSING'));
});

test('w6 产生省略主语歧义的多分析，含影响意思的语法发现', () => {
  const analysis = analyze('w6');
  assert.ok(analysis.disputes.some(item => item.type === 'ambiguous-ellipsis'));
  const grammarFinding = analysis.findings.find(item => item.code === 'AMBIGUOUS_SUBJECT');
  assert.equal(grammarFinding.category, 'grammar');
  assert.ok(grammarFinding.span.end > grammarFinding.span.start);
});

test('w5 是事实答错而非语法错误：无句式缺失发现，只有事实矛盾', () => {
  const analysis = analyze('w5');
  assert.equal(analysis.disputes.length, 0);
  assert.ok(analysis.findings.every(item => item.code !== 'REQUIRED_FORM_MISSING'));
  assert.ok(analysis.findings.filter(item => item.category === 'fact').length >= 2);
});

test('w2 与提示整句重合，登记照抄', () => {
  const analysis = analyze('w2');
  assert.equal(analysis.copy.copied, true);
  assert.ok(analysis.findings.some(item => item.code === 'COPIED_HINT'));
});

test('w3/w7/w8 单分析且无发现，可作独立证据', () => {
  for (const id of ['w3', 'w7', 'w8']) {
    const analysis = analyze(id);
    assert.equal(analysis.disputes.length, 0, `${id} 不应有分歧`);
    assert.equal(analysis.findings.length, 0, `${id} 不应有发现`);
  }
});

test('w1 建议成对互斥，且都保留题目事实与把字句', () => {
  const analysis = analyze('w1');
  const suggestions = buildSuggestions(analysis, exerciseOf('e1'));
  assert.equal(suggestions.length, 2);
  assert.deepEqual(suggestions[0].exclusiveWith, [suggestions[1].id]);
  for (const suggestion of suggestions) {
    const result = trialCombination(analysis, exerciseOf('e1'), suggestions, [suggestion.id]);
    assert.equal(result.acceptable, true);
    assert.equal(result.hardErrors.length, 0);
    for (const fact of exerciseOf('e1').requiredFacts) {
      assert.notEqual(evaluateFact(fact, result.finalText).status, 'missing');
    }
  }
});

test('互斥建议组合被拦截，不给出逐项接受的冲突清单', () => {
  const analysis = analyze('w1');
  const suggestions = buildSuggestions(analysis, exerciseOf('e1'));
  const result = trialCombination(analysis, exerciseOf('e1'), suggestions, suggestions.map(item => item.id));
  assert.equal(result.acceptable, false);
  assert.ok(result.relationErrors.some(item => item.includes('互斥')));
});

test('w6 的引语建议依赖补主语建议，单独接受会因丢事实被守卫拦下', () => {
  const analysis = analyze('w6');
  const suggestions = buildSuggestions(analysis, exerciseOf('e2'));
  const s2 = suggestions.find(item => item.id === 'w6-s2');
  const alone = trialCombination(analysis, exerciseOf('e2'), suggestions, [s2.id]);
  assert.equal(alone.acceptable, false);
  assert.ok(alone.hardErrors.some(item => item.includes('关窗')) || alone.relationErrors.length > 0);
  const s1 = suggestions.find(item => item.id === 'w6-s1');
  const combined = trialCombination(analysis, exerciseOf('e2'), suggestions, [s1.id, s2.id]);
  assert.equal(combined.acceptable, true);});

test('w5 两条事实修正彼此独立可组合，组合后整句恢复题面事实', () => {
  const analysis = analyze('w5');
  const suggestions = buildSuggestions(analysis, exerciseOf('e5'));
  assert.equal(suggestions.length, 2);
  const result = trialCombination(analysis, exerciseOf('e5'), suggestions, suggestions.map(item => item.id));
  assert.equal(result.acceptable, true);
  assert.match(result.finalText, /拖到角落/);
  assert.match(result.finalText, /空出过道/);
  assert.doesNotMatch(result.finalText, /走廊|门口/);
});

test('守卫会拦截丢掉强制句式的改写', () => {
  const exercise = exerciseOf('e1');
  const analysis = analyze('w1');
  const fakeSuggestion = {
    id: 'x1', edits: [{ start: 0, end: [...analysis.text].length, replacement: '红伞在柜子里。', kind: 'replace' }],
    requires: [], exclusiveWith: [],
  };
  const result = trialCombination(analysis, exercise, [fakeSuggestion], ['x1']);
  assert.equal(result.acceptable, false);
  assert.ok(result.hardErrors.some(item => item.includes('强制练习')));
});

test('编辑按偏移倒序应用，位置仍对应原句', () => {
  const text = 'abcdef';
  assert.equal(applyEdits(text, [
    { start: 4, end: 6, replacement: 'EF' },
    { start: 0, end: 2, replacement: 'AB' },
  ]), 'ABcdEF');
});

test('阿洛证据：w1 挂起、w2 照抄、w3 独立、w4 基线已被 j2 撤回、w5 事实答错', () => {
  const rows = collectEvidence(bundle, '阿洛');
  const stateOf = (writingId, skill) => rows.find(row => row.writingId === writingId && row.skill === skill)?.state;
  assert.equal(stateOf('w1', 'ba-complete'), 'disputed');
  assert.equal(stateOf('w2', 'ba-complete'), 'copied');
  assert.equal(stateOf('w3', 'ba-complete'), 'independent');
  assert.equal(stateOf('w3', 'scope-negative'), 'independent');
  // teacher.json 中 j1 确认后又有 j2 撤回，按最后动作登记撤回。
  assert.equal(stateOf('w4', 'ba-complete'), 'withdrawn');
  assert.equal(stateOf('w4', 'serial'), 'withdrawn');
  assert.equal(stateOf('w5', 'ba-complete'), 'fact-error');
  assert.equal(stateOf('w5', 'serial'), 'fact-error');
});

test('沐雨证据：w6 调查挂起，w7/w8 独立', () => {
  const rows = collectEvidence(bundle, '沐雨');
  const stateOf = (writingId, skill) => rows.find(row => row.writingId === writingId && row.skill === skill)?.state;
  assert.equal(stateOf('w6', 'reported'), 'disputed');
  assert.equal(stateOf('w6', 'subject-ref'), 'disputed');
  assert.equal(stateOf('w7', 'bei-focus'), 'independent');
  assert.equal(stateOf('w8', 'scope-negative'), 'independent');
  assert.equal(stateOf('w8', 'ba-complete'), 'independent');
});

test('j2 撤回 w4：独立证据变撤回，重算后 ba-complete 只剩一个独立证据', () => {
  const cleanBundle = { ...bundle, teacher: [] };
  let rows = collectEvidence(cleanBundle, '阿洛');
  assert.equal(rows.find(row => row.writingId === 'w4' && row.skill === 'ba-complete').state, 'independent');
  rows = applyRuling(rows, { id: 'j2', writing: 'w4', skill: 'ba-complete', action: '撤回', note: '口头逐词提示' });
  const mastery = masteryForStudent(rows, bundle.skills);
  const ba = mastery.find(item => item.skill === 'ba-complete');
  assert.equal(ba.state, 'not-mastered');
  assert.equal(ba.independentCount, 1);
  assert.ok(ba.withdrawnEvidence.some(item => item.writingId === 'w4'));
});

test('裁决不自动盖到改写链上的后代：撤回 w4 不改变 w5 的事实答错状态', () => {
  let rows = collectEvidence(bundle, '阿洛');
  rows = applyRuling(rows, { id: 'j2', writing: 'w4', skill: 'ba-complete', action: '撤回', note: 'x' });
  const w5 = rows.find(row => row.writingId === 'w5' && row.skill === 'ba-complete');
  assert.equal(w5.state, 'fact-error');
  assert.notEqual(w5.ruledBy, 'j2');
});

test('同依据裁决可跨题传播（合成证据验证边界）', () => {
  const rows = collectEvidence(bundle, '阿洛');
  const source = rows.find(row => row.writingId === 'w3');
  const synthetic = {
    ...source,
    writingId: 'w-synth',
    exerciseId: 'e9',
    chainRoot: 'w-synth',
    teacherActions: [],
  };
  const merged = [...rows, synthetic];
  const ruled = applyRuling(merged, { id: 'jr', writing: 'w3', skill: source.skill, action: '撤回', note: 'test' });
  const propagated = ruled.find(row => row.writingId === 'w-synth');
  assert.equal(propagated.state, 'withdrawn');
  assert.equal(propagated.autoPropagated, true);
});

test('掌握判定含前置依赖：前置 ba-complete 未达标时 serial 不登记进阶', () => {
  const rows = collectEvidence({ ...bundle, teacher: [] }, '阿洛');
  const mastery = masteryForStudent(rows, bundle.skills);
  const serial = mastery.find(item => item.skill === 'serial');
  // serial 自身有 1 条独立证据，但 minIndependent=1 只是数量线；
  // 其前置 ba-complete 在 e1 挂起、e5 末稿事实答错，独立证据不足。
  assert.equal(serial.independentCount, 1);
  assert.equal(serial.prerequisitesMet, false);
  assert.equal(serial.state, 'not-mastered');
  const ba = mastery.find(item => item.skill === 'ba-complete');
  assert.equal(ba.state, 'not-mastered');
});

test('复习计划：v1 已完成保留历史；v2 因 w4 撤回需重排', () => {
  let rows = collectEvidence({ ...bundle, teacher: [] }, '阿洛');
  rows = applyRuling(rows, { id: 'j2', writing: 'w4', skill: 'ba-complete', action: '撤回', note: 'x' });
  const mastery = masteryForStudent(rows, bundle.skills);
  const plan = planSchedule(bundle, rows, mastery);
  const v1 = plan.find(item => item.scheduleId === 'v1');
  const v2 = plan.find(item => item.scheduleId === 'v2');
  assert.equal(v1.decision, 'keep-history');
  assert.equal(v2.decision, 'reschedule');
  assert.match(v2.note, /第48周/);
});

test('沐雨 v3 依据仍有效但前置未满足，给预备练习警告而非重排', () => {
  const rows = collectEvidence(bundle, '沐雨');
  const mastery = masteryForStudent(rows, bundle.skills);
  const plan = planSchedule(bundle, rows, mastery);
  const v3 = plan.find(item => item.scheduleId === 'v3');
  assert.equal(v3.decision, 'schedule');
  assert.ok(v3.warnings.some(item => item.includes('前置')));
});

test('教师视图同时包含原说法、可接受分析与当前建议', () => {
  const writing = writingOf('w1');
  const analysis = analyze('w1');
  const suggestions = buildSuggestions(analysis, exerciseOf('e1'));
  const rows = collectEvidence(bundle, '阿洛');
  const view = teacherReviewView(writing, exerciseOf('e1'), analysis, suggestions, rows);
  assert.match(view, new RegExp(writing.note));
  assert.match(view, /可接受的分析/);
  assert.match(view, /当前建议/);
  assert.match(view, /互斥/);
});

test('学生计划视图说明练什么、支持作答与未算独立的提示', () => {
  const rows = collectEvidence(bundle, '阿洛');
  const mastery = masteryForStudent(rows, bundle.skills);
  const plan = planSchedule(bundle, rows, mastery);
  const view = studentPlanView('阿洛', mastery, plan);
  assert.match(view, /把字句与趋向结果/);
  assert.match(view, /w3/);
  assert.match(view, /未算独立/);
  assert.match(view, /w2/);
});

test('guardResult 对引语内事实给警告而非硬错误', () => {
  const guard = guardResult(writingOf('w1').note, exerciseOf('e1'));
  assert.ok(guard.warnings.some(item => item.includes('只在引语')));
  assert.ok(guard.hardErrors.some(item => item.includes('强制练习')));
});
