// 复习计划重排。
// 已完成（state=已完成）的活动保留实际完成情况，只补证据现状说明，不改动历史；
// 待安排的活动逐条核对 basedOn 证据是否仍支持该技能：
// 证据撤回/挂起/照抄/事实答错即给出“需重排”，并按 schedule.window 给出可挪动时段。
const VALID_EVIDENCE = new Set(['independent', 'manual', 'helped']);

function basisEvidence(entry, evidenceRows, masteryEntries) {
  return entry.basedOn.map(writingId => {
    const row = evidenceRows.find(item => item.writingId === writingId && item.skill === entry.skill);
    return {
      writingId,
      found: Boolean(row),
      state: row?.state ?? 'missing',
      reason: row?.reason ?? '该草稿没有这项技能的证据',
      autoPropagated: row?.autoPropagated === true,
    };
  });
}

/**
 * 评估一条教务记录。
 */
export function evaluateScheduleEntry(entry, evidenceRows, masteryEntries) {
  const basis = basisEvidence(entry, evidenceRows, masteryEntries);
  const mastery = masteryEntries.find(item => item.skill === entry.skill);
  const prerequisitesMet = mastery?.prerequisitesMet ?? false;

  if (entry.state === '已完成') {
    return {
      scheduleId: entry.id,
      decision: 'keep-history',
      activity: entry.activity,
      window: entry.window,
      basis,
      note: '活动已完成，保留实际完成情况；证据事后撤回只影响后续安排，不改写历史。',
    };
  }

  const invalid = basis.filter(item => !VALID_EVIDENCE.has(item.state));
  const blockers = invalid.map(item => {
    const reasonMap = {
      withdrawn: '依据证据已被教师撤回',
      disputed: '依据证据存在待裁决的多分析',
      copied: '依据证据为整句照抄，不算独立掌握',
      'fact-error': item.reason,
      missing: '找不到依据证据',
    };
    return { writingId: item.writingId, state: item.state, reason: reasonMap[item.state] ?? item.reason };
  });

  if (blockers.length > 0) {
    return {
      scheduleId: entry.id,
      decision: 'reschedule',
      activity: entry.activity,
      window: entry.window,
      basis,
      blockers,
      rescheduleWindow: entry.window,
      note: `依据不再支持该技能，按班级约定在 ${entry.window} 重新安排，先补齐独立证据。`,
    };
  }

  const warnings = [];
  if (!prerequisitesMet) {
    warnings.push(`前置技能（${mastery.requires.join('、') || '无'}）尚未掌握，本活动先作为预备练习，不登记进阶。`);
  }
  return {
    scheduleId: entry.id,
    decision: 'schedule',
    activity: entry.activity,
    window: entry.window,
    basis,
    warnings,
    note: `依据仍有效，可在 ${entry.window} 安排。`,
  };
}

export function planSchedule(bundle, evidenceRows, masteryEntries) {
  return bundle.schedule
    .filter(entry => entry.student === evidenceRows[0]?.student)
    .map(entry => evaluateScheduleEntry(entry, evidenceRows, masteryEntries));
}
