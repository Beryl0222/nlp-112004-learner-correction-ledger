// 教师批阅视图与学生复习计划视图（纯文本，供 CLI 与测试共用）。
import { buildSuggestions } from './suggest.mjs';

function line(char = '─', width = 64) {
  return char.repeat(width);
}

function spanLabel(span) {
  if (!span) return '整句';
  return `原句[${span.start},${span.end})`;
}

/**
 * 教师批阅视图：同屏呈现原说法、可接受分析与当前建议。
 */
export function teacherReviewView(writing, exercise, analysis, suggestions, evidenceRows) {
  const out = [];
  out.push(line('═'));
  out.push(`批阅 ${writing.id}｜学生 ${writing.student}｜练习 ${exercise.id}`);
  out.push(`题面：${exercise.question}`);
  out.push(line());
  out.push(`原说法：${writing.note}`);
  out.push(`来源：${writing.source}｜看过提示：${writing.helpSeen.length ? writing.helpSeen.join('、') : '无'}`);
  out.push('');
  out.push('【可接受的分析】');
  if (analysis.readings.length === 0) {
    out.push('  本题只有一种成立分析，无待裁决分歧。');
  } else {
    analysis.readings.forEach(reading => {
      out.push(`  ${reading.id}（${reading.disputeType}）`);
      Object.entries(reading.choices).forEach(([key, label]) => {
        out.push(`    - ${key}：${label}`);
      });
    });
    analysis.disputes.forEach(dispute => {
      out.push(`  分歧位置：${spanLabel(dispute.span)} —— 裁决前不登记掌握。`);
    });
  }
  out.push('');
  out.push('【发现】');
  const categoryName = { fact: '事实', requirement: '练习要求', grammar: '影响意思的语法' };
  if (analysis.findings.length === 0) {
    out.push('  未发现需要纠错的地方。');
  } else {
    analysis.findings.forEach(item => {
      out.push(`  [${categoryName[item.category]}] ${spanLabel(item.span)} ${item.reason}`);
    });
  }
  out.push('');
  out.push('【当前建议】（不预设已接受，组合冲突以试改守卫为准）');
  if (suggestions.length === 0) {
    out.push('  没有可自动给出的改写建议，按发现项人工处理。');
  } else {
    suggestions.forEach(item => {
      const tags = [];
      if (item.requires.length) tags.push(`依赖 ${item.requires.join('、')}`);
      if (item.exclusiveWith.length) tags.push(`互斥 ${item.exclusiveWith.join('、')}`);
      if (item.reading) tags.push(`对应分析 ${item.reading}`);
      out.push(`  ${item.id}｜${item.title}${tags.length ? `（${tags.join('；')}）` : ''}`);
      out.push(`      理由：${item.rationale}`);
      item.edits.forEach(edit => {
        out.push(`      ${spanLabel(edit)} 改为“${edit.replacement}”`);
      });
      if (item.guardNote) out.push(`      守卫：${item.guardNote}`);
    });
  }
  out.push('');
  out.push('【证据登记（裁决前）】');
  evidenceRows
    .filter(row => row.writingId === writing.id)
    .forEach(row => {
      out.push(`  技能 ${row.skill}：${row.state}（${row.reason}）`);
    });
  return out.join('\n');
}

/**
 * 学生复习计划视图：练什么、哪次作答支持决定、哪些提示未被算成独立掌握。
 */
export function studentPlanView(student, masteryEntries, plan) {
  const out = [];
  out.push(line('═'));
  out.push(`${student} 的复习计划`);
  out.push(line());
  masteryEntries.forEach(entry => {
    const status = entry.state === 'mastered'
      ? `已掌握（独立证据 ${entry.independentCount}/${entry.minIndependent}）`
      : `未掌握（独立证据 ${entry.independentCount}/${entry.minIndependent}）`;
    out.push(`◆ ${entry.name}（${entry.skill}）：${status}`);
    if (entry.requires.length) {
      out.push(`  前置：${entry.requires.join('、')}（${entry.prerequisitesMet ? '已满足' : '未满足'}）`);
    }
    entry.independentEvidence.forEach(item => {
      const label = item.state === 'manual' ? '教师手动确认' : '支持作答';
      out.push(`  ${label}：${item.writingId}（练习 ${item.exerciseId}，${item.reason}）`);
    });
    entry.helpedEvidence.forEach(item => {
      out.push(`  未算独立：${item.writingId}（练习 ${item.exerciseId}，${item.reason}）`);
    });
    entry.copiedEvidence.forEach(item => {
      out.push(`  未算独立：${item.writingId}（练习 ${item.exerciseId}，${item.reason}）`);
    });
    entry.disputedEvidence.forEach(item => {
      out.push(`  待教师裁决：${item.writingId}（练习 ${item.exerciseId}，${item.reason}）`);
    });
    entry.withdrawnEvidence.forEach(item => {
      out.push(`  已撤回：${item.writingId}（练习 ${item.exerciseId}，${item.reason}）`);
    });
    entry.factErrorEvidence.forEach(item => {
      out.push(`  暂不支持进阶：${item.writingId}（练习 ${item.exerciseId}，${item.reason}）`);
    });
  });
  out.push('');
  out.push('【复习安排】');
  plan.forEach(item => {
    const label = {
      'keep-history': '保留历史',
      schedule: '可安排',
      reschedule: '需重排',
    }[item.decision];
    out.push(`  [${label}] ${item.activity}（${item.window}）`);
    out.push(`      依据作答：${item.basis.map(b => `${b.writingId}=${b.state}`).join('，')}`);
    (item.blockers ?? []).forEach(blocker => {
      out.push(`      重排原因：${blocker.writingId} ${blocker.reason}`);
    });
    (item.warnings ?? []).forEach(warning => out.push(`      注意：${warning}`));
  });
  return out.join('\n');
}
