import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBundle, readCollection } from '../tools/materials.mjs';

test('接件资料包含原文和原始记录', () => {
  const bundle = readBundle();
  const excerpts = [["writing", "w1", "姐姐喊"], ["writing", "w2", "楼下柜子"], ["teacher", "j2", "口头逐词提示"], ["schedule", "v1", "二选一"]];
  for (const [group, id, phrase] of excerpts) {
    const entry = bundle[group].find(row => row.id === id);
    assert.ok(entry, `${group}/${id} 缺少来件`);
    if (phrase) assert.ok(Object.values(entry).some(value => typeof value === 'string' && value.includes(phrase)), `${group}/${id} 的源文字缺少约定片段`);
  }
});

test('拒绝缺少正式字段的接件', t => {
  const directory = mkdtempSync(join(tmpdir(), 'learner-correction-ledger-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'skills.json'), JSON.stringify([{ id: 'bad' }]));
  assert.throws(() => readCollection('skills', pathToFileURL(directory + sep)), TypeError);
});

test('草稿和提示索引均在同一学生练习链中有效', () => {
  const { exercises, writing } = readBundle();
  for (const entry of writing) {
    if (entry.prev) {
      const parent = writing.find(row => row.id === entry.prev);
      assert.equal(parent.exercise, entry.exercise);
      assert.equal(parent.student, entry.student);
      assert.ok(Date.parse(parent.at) < Date.parse(entry.at));
    }
    const exercise = exercises.find(row => row.id === entry.exercise);
    for (const index of entry.helpSeen) {
      assert.ok(Number.isInteger(index) && exercise.hints[index]);
    }
  }
});
