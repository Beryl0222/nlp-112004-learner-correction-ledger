# 中文学习者的语法纠错与掌握判定

汀湾周末中文班用课内短写作、复写及教师批阅记录排下一周的复习。练习题有可接受事实、目标技能及学生可见的提示。作答记录中的 note 是学生当次留下的原话，source 则记录该行文字由谁或哪个资料提交。

## 本地资料

全部为 UTF-8 编码的合成业务资料。`data/contract.json` 中的列类型带 `?` 时可以是 JSON null。每组记录的 `id` 在该组中唯一，跨组关系以字段说明和清单的 `links` 为准。文字字段保留来源原句，嵌套对象按表中现有格式记录。

- `data/skills.json`。班级当季能力标准，requires 为前置技能。minIndependent 为不同题目上的独立证据数。
- `data/exercises.json`。课内练习原题。requiredFacts 为该次练习需要确实表达的已知事实，forms 为允许的表达。
- `data/writing.json`。课内手稿与改写事实。prev 为上一稿；helpSeen 是学生打开过的题内提示索引，从零开始。
- `data/teacher.json`。实际批阅历史，有确认、撤回和请求调查。
- `data/schedule.json`。教务记录用于区分已完成与仍可安排的活动。window 决定可挪动时段。

## 使用约定

教师排课只根据该次课程给出的作答场景。技能证据按不同题目计数，同一题多次改写最多累积一次。题目打开后看过任何对该技能有实质提示的内容，该次技能证据登记为受助。原样套用提示整句是受助的一种，留下说明供教师审查。复习状态为已完成时保持历史，待安排时以仍有效的技能证据和可用周次解释。不能单凭提示文字与学生文本存在部分重叠认定照抄。

## 读取与检查

使用 Node.js 22.23.4，依赖仅用 Node.js 标准库。资料检查依次读入各组 JSON，检查列类型、组内编号及已登记的组间引用，并列出各组记录数。读取入口为 `tools/materials.mjs`，可单独读取一组记录，或读取整个已登记资料包。

```sh
npm run check-data
npm test
```

## 纠错与掌握判定（src/）

分析与判定全部为纯函数，数据仍以 `data/` 中的合成资料为唯一来源。

- `src/segments.mjs`。按字符偏移切分句与引语，追踪省略主语、并列动作骨架，并用最长公共子序列计算提示重合度；只有近乎整句重合（≥0.8）才认定照抄，部分重叠不认定。
- `src/grammar.mjs`。句式检测（把/被/引语/范围否定/连动）一律先剥离引语，引语内句式由 `formsInText` 单独识别。事实核对返回 `hit/quoted/contradict/missing` 四态，矛盾规则按题目登记在 `FACT_REGISTRY`。
- `src/analyze.mjs`。区分事实答错、练习要求未完成、影响意思的语法三类发现；同一句存在多个合法分析（引语句式、省略施事）时输出带原句位置的 `disputes` 与 `readings`，默认挂起，不按单一答案预登记掌握。
- `src/suggest.mjs`。建议带原句位置、依赖（requires）与互斥（exclusiveWith）。试改以组合为单位渲染整句，`guardResult` 守卫题目事实与强制表达：硬错误不可接受，引语内事实等只给警告。
- `src/evidence.mjs`。证据状态为 independent/helped/copied/manual/disputed/withdrawn/fact-error。教师裁决按依据键（basisKey）传播：撤回可跨题覆盖同依据证据，但改写链后代（不同语境）不自动覆盖；确认只在同一练习内生效，被传播证据带 `autoPropagated`。
- `src/mastery.mjs`。按 `minIndependent` 在不同题目上计独立证据，同题多稿最多一次；前置技能未掌握不登记进阶；受助、照抄、挂起、撤回、事实错误均逐条保留说明。
- `src/schedule.mjs`。已完成活动保留实际完成情况；待安排活动按仍有效证据重排，证据失效时在原 window 重新安排，前置未满足时降级为预备练习。
- `src/views.mjs`。教师批阅视图同屏呈现原说法、可接受分析与当前建议；学生计划视图说明练什么、哪次作答支持决定、哪些提示未算独立掌握。

## 命令行

```sh
npm run review -- review w1                 # 教师批阅单篇草稿
npm run review -- trial w1 w1-s1,w1-s2      # 试改建议组合（含依赖/互斥与守卫）
npm run review -- plan 阿洛                  # 学生复习计划
npm run review -- rule w4 ba-complete 撤回  # 教师临时裁决并查看重算结果
```

