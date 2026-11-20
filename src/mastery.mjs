// 按班级能力标准（skills.minIndependent）判定掌握情况。
// 计数约定（见 README）：技能证据按不同题目计数，同一题多次改写最多累积一次；
// independent 与教师手动确认 manual 计入独立证据数；
// helped/copied/disputed/withdrawn/fact-error 均不计入，但逐条保留说明，
// 让学生知道哪些提示没有被算成独立掌握。

const COUNTED_STATES = new Set(['independent', 'manual']);

/**
 * 每个练习取最后一篇草稿作为“当前状态”；
 * 独立/手动证据单独按练习去重收集，避免被后续的照抄/事实错误稿整体抹掉。
 */
function organizeByExercise(rows) {
  const byExercise = new Map();
  for (const row of rows) {
    const bucket = byExercise.get(row.exerciseId) ?? { rows: [] };
    bucket.rows.push(row);
    byExercise.set(row.exerciseId, bucket);
  }
  return [...byExercise.values()].map(bucket => {
    const ordered = [...bucket.rows].sort((a, b) => a.writingId.localeCompare(b.writingId));
    const latest = ordered.at(-1);
    const counted = ordered.find(row => COUNTED_STATES.has(row.state)) ?? null;
    return { latest, counted, all: ordered };
  });
}

const bucketOf = (groups, state) => groups
  .flatMap(group => group.all.filter(row => row.state === state))
  .map(row => ({ writingId: row.writingId, exerciseId: row.exerciseId, reason: row.reason }));

/**
 * 计算单个学生的技能掌握矩阵，含 requires 前置技能解析。
 * @param {Array} rows collectEvidence 产出的证据行
 * @param {Array} skills skills.json
 */
export function masteryForStudent(rows, skills) {
  const entries = skills.map(skill => {
    const skillRows = rows.filter(row => row.skill === skill.id);
    const groups = organizeByExercise(skillRows);
    // 同一练习最多累积一次独立证据。
    const independentEvidence = groups
      .filter(group => group.counted)
      .map(group => ({
        writingId: group.counted.writingId,
        exerciseId: group.counted.exerciseId,
        state: group.counted.state,
        reason: group.counted.reason,
      }));
    return {
      skill: skill.id,
      name: skill.name,
      minIndependent: skill.minIndependent,
      requires: skill.requires,
      independentCount: new Set(independentEvidence.map(item => item.exerciseId)).size,
      independentEvidence,
      helpedEvidence: bucketOf(groups, 'helped'),
      copiedEvidence: bucketOf(groups, 'copied'),
      disputedEvidence: bucketOf(groups, 'disputed'),
      withdrawnEvidence: bucketOf(groups, 'withdrawn'),
      factErrorEvidence: bucketOf(groups, 'fact-error'),
      perExercise: groups.map(group => ({
        exerciseId: group.latest.exerciseId,
        writingId: group.latest.writingId,
        state: group.latest.state,
        reason: group.latest.reason,
      })),
      prerequisitesMet: false,
      state: 'not-mastered',
    };
  });

  const cache = new Map(entries.map(entry => [entry.skill, entry]));
  for (const entry of entries) {
    entry.prerequisitesMet = entry.requires.every(id => cache.get(id)?.state === 'mastered');
    entry.state = entry.independentCount >= entry.minIndependent && entry.prerequisitesMet
      ? 'mastered'
      : 'not-mastered';
  }
  return entries;
}

// 向后保留具名导出，依赖解析已在上面的两遍扫描中完成。
export const masteryWithPrerequisites = masteryForStudent;
