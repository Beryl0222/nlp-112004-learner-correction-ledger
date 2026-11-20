// 命令行入口：
//   node tools/review.mjs review <writingId>           教师批阅视图
//   node tools/review.mjs trial <writingId> <s1,s2>    试改建议组合
//   node tools/review.mjs plan <student>               学生复习计划
//   node tools/review.mjs rule <writingId> <skill> <确认|撤回|调查> [note]
import { readBundle } from './materials.mjs';
import { buildSuggestions, trialCombination } from '../src/suggest.mjs';
import { analyzeWriting } from '../src/analyze.mjs';
import { collectEvidence, applyRuling } from '../src/evidence.mjs';
import { masteryForStudent } from '../src/mastery.mjs';
import { planSchedule } from '../src/schedule.mjs';
import { teacherReviewView, studentPlanView } from '../src/views.mjs';

function load() {
  return readBundle();
}

function analysisOf(bundle, writingId) {
  const writing = bundle.writing.find(item => item.id === writingId);
  if (!writing) throw new Error(`找不到写作记录 ${writingId}`);
  const exercise = bundle.exercises.find(item => item.id === writing.exercise);
  const chain = bundle.writing
    .filter(item => item.student === writing.student && item.exercise === writing.exercise)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { writing, exercise, analysis: analyzeWriting(writing, exercise, chain) };
}

function review(bundle, writingId) {
  const { writing, exercise, analysis } = analysisOf(bundle, writingId);
  const suggestions = buildSuggestions(analysis, exercise);
  const evidenceRows = collectEvidence(bundle, writing.student);
  console.log(teacherReviewView(writing, exercise, analysis, suggestions, evidenceRows));
}

function trial(bundle, writingId, idList) {
  const { exercise, analysis } = analysisOf(bundle, writingId);
  const suggestions = buildSuggestions(analysis, exercise);
  const result = trialCombination(analysis, exercise, suggestions, idList.split(','));
  console.log(`原句：${result.originalText}`);
  console.log(`试改：${result.finalText}`);
  if (result.relationErrors.length) {
    result.relationErrors.forEach(item => console.log(`组合问题：${item}`));
  }
  result.hardErrors.forEach(item => console.log(`守卫拦截：${item}`));
  result.warnings.forEach(item => console.log(`提示：${item}`));
  console.log(result.acceptable ? '结论：组合可接受。' : '结论：组合不可接受，不能作为纠错建议提交。');
}

function plan(bundle, student) {
  const rows = collectEvidence(bundle, student);
  const mastery = masteryForStudent(rows, bundle.skills);
  const schedule = planSchedule(bundle, rows, mastery);
  console.log(studentPlanView(student, mastery, schedule));
}

function rule(bundle, writingId, skill, action, note) {
  const writing = bundle.writing.find(item => item.id === writingId);
  let rows = collectEvidence(bundle, writing.student);
  rows = applyRuling(rows, {
    id: `cli-${Date.now()}`,
    writing: writingId,
    skill,
    action,
    note: note ?? '命令行临时裁决',
  });
  const mastery = masteryForStudent(rows, bundle.skills);
  const schedule = planSchedule(bundle, rows, mastery);
  console.log(studentPlanView(writing.student, mastery, schedule));
}

const [command, ...args] = process.argv.slice(2);
try {
  const bundle = load();
  if (command === 'review') review(bundle, args[0]);
  else if (command === 'trial') trial(bundle, args[0], args[1] ?? '');
  else if (command === 'plan') plan(bundle, args[0]);
  else if (command === 'rule') rule(bundle, args[0], args[1], args[2], args[3]);
  else {
    console.error('用法：review <writingId> | trial <writingId> <s1,s2> | plan <student> | rule <writingId> <skill> <action> [note]');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
