import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(readFileSync(join(root, name), 'utf8').replace(/^\uFEFF/, ''));
const manifest = read('content-manifest.json');
const questions = read('questions.json');
const operators = manifest.operator_files.flatMap(read);
const dimensions = Object.keys(manifest.dimensions);
const perDimension = manifest.questions_per_dimension;
const rawMax = perDimension * 3;
const unique = values => new Set(values).size === values.length;
assert.equal(dimensions.length, 6);
assert.equal(questions.length, manifest.question_count);
assert.equal(operators.length, manifest.candidate_count);
assert(unique(questions.map(q => q.id)) && unique(operators.map(o => o.id)));
for (const d of dimensions) assert.equal(questions.filter(q => q.dimension === d).length, perDimension);
for (const q of questions) {
  assert(q.prompt && q.design_note && dimensions.includes(q.dimension));
  assert.equal(q.options.length, 4);
  assert(unique(q.options.map(o => o.id)));
  assert.deepEqual(q.options.map(o => o.value).sort(), [0, 1, 2, 3]);
  for (const o of q.options) assert(o.text && o.interpretation);
}
for (const o of operators) {
  assert(o.name && o.phase && o.title && o.role_summary && o.evidence.length >= 2);
  assert(Array.isArray(o.uncertain_dimensions));
  for (const d of dimensions) {
    assert([20, 40, 60, 80].includes(o.scores[d]), `${o.id}: invalid ${d} score`);
    assert(o.score_basis?.[d], `${o.id}: missing ${d} basis`);
  }
  for (const e of o.evidence) {
    assert(new URL(e.url).protocol === 'https:' && e.section && e.paraphrase);
    assert(e.dimensions.length && e.dimensions.every(d => dimensions.includes(d)));
  }
  assert(o.uncertain_dimensions.every(d => dimensions.includes(d)));
}

function score(answers, items = questions) {
  assert.equal(Object.keys(answers).length, items.length);
  const raw = Object.fromEntries(dimensions.map(d => [d, 0]));
  for (const q of items) {
    const option = q.options.find(o => o.id === answers[q.id]);
    assert(option, `Invalid answer: ${q.id}`);
    raw[q.dimension] += option.value;
  }
  return raw;
}
function distance(raw, operator) {
  return dimensions.reduce((sum, d) => sum + (100 * raw[d] - rawMax * operator.scores[d]) ** 2, 0);
}
function rank(raw) {
  return operators.map(o => ({ id: o.id, name: o.name, distance: distance(raw, o) }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}
function answersForRaw(target) {
  const remaining = { ...target };
  return Object.fromEntries(questions.map(q => {
    const value = Math.min(3, remaining[q.dimension]);
    remaining[q.dimension] -= value;
    return [q.id, q.options.find(o => o.value === value).id];
  }));
}
function groupsFor(dims) {
  const groups = new Map();
  for (const o of operators) {
    const key = dims.map(d => o.scores[d]).join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o.id);
  }
  return [...groups.values()].filter(group => group.length > 1);
}
const checks = ['content_structure'];
for (const value of [0, 3]) {
  const answers = Object.fromEntries(questions.map(q => [q.id, q.options.find(o => o.value === value).id]));
  const raw = score(answers);
  assert(dimensions.every(d => raw[d] === value * perDimension));
  assert.deepEqual(rank(raw), rank(score(answers)));
  const reordered = [...questions].reverse().map(q => ({ ...q, options: [...q.options].reverse() }));
  assert.deepEqual(score(answers), score(answers, reordered));
  assert.deepEqual(score(answers), score(JSON.parse(JSON.stringify(answers))));
}
checks.push('boundary_scores', 'determinism', 'display_order_invariance', 'answer_roundtrip');
const invalid = Object.fromEntries(questions.map(q => [q.id, q.options[0].id]));
invalid[questions[0].id] = 'invalid';
assert.throws(() => score(invalid));
assert.throws(() => score({}));
checks.push('invalid_and_incomplete_answers_rejected');
const witnesses = operators.map(o => {
  const raw = Object.fromEntries(dimensions.map(d => [d, o.scores[d] * rawMax / 100]));
  assert(dimensions.every(d => Number.isInteger(raw[d])));
  assert.deepEqual(score(answersForRaw(raw)), raw);
  const ranked = rank(raw);
  const nearest = ranked.filter(x => x.distance === 0);
  assert(nearest.some(x => x.id === o.id));
  return { id: o.id, name: o.name, raw, nearest_ids: nearest.map(x => x.id), uniquely_reachable: nearest.length === 1 };
});
checks.push('exact_reachable_witnesses');

let state = manifest.sample_seed >>> 0;
function nextChoice() {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return (state >>> 0) & 3;
}
const counts = Object.fromEntries(operators.map(o => [o.id, 0]));
let tiedSamples = 0;
for (let n = 0; n < manifest.sample_count; n++) {
  const raw = Object.fromEntries(dimensions.map(d => [d, 0]));
  for (const q of questions) raw[q.dimension] += nextChoice();
  let best = Infinity;
  let nearest = [];
  for (const o of operators) {
    const current = distance(raw, o);
    if (current < best) { best = current; nearest = [o.id]; }
    else if (current === best) nearest.push(o.id);
  }
  if (nearest.length > 1) tiedSamples++;
  for (const id of nearest) counts[id] += 1 / nearest.length;
}
assert(Math.abs(Object.values(counts).reduce((a, b) => a + b, 0) - manifest.sample_count) < 0.01);
checks.push('sample_tie_weight_conservation');
const oldPairs = [['mountain', 'blue_poison'], ['silverash', 'suzuran']].map(ids => {
  const [a, b] = ids.map(id => operators.find(o => o.id === id));
  const differences = dimensions.filter(d => a.scores[d] !== b.scores[d]);
  return { ids, differences, provisional_differences: differences.filter(d => a.uncertain_dimensions.includes(d) || b.uncertain_dimensions.includes(d)) };
});
const patterns = [
  { name: '分析、独立、克制、按序、稳妥、先给方案', raw: { D: 3, C: 3, E: 3, P: 12, R: 3, S: 12 } },
  { name: '先行、协作、外显、弹性、愿意试探、先陪伴', raw: { D: 12, C: 12, E: 12, P: 3, R: 12, S: 3 } },
  { name: '先行与协作，但风险稳妥、先做具体支持', raw: { D: 12, C: 12, E: 9, P: 6, R: 3, S: 12 } },
  { name: '谨慎自主，但表达直接、过程保留弹性', raw: { D: 3, C: 3, E: 12, P: 3, R: 6, S: 6 } },
  { name: '各维度居中，部分情境略有变化', raw: { D: 7, C: 8, E: 7, P: 8, R: 7, S: 8 } }
].map(p => {
  const answers = answersForRaw(p.raw);
  assert.deepEqual(score(answers), p.raw);
  const ranked = rank(p.raw);
  return { ...p, answers, nearest: ranked.filter(o => o.distance === ranked[0].distance), top: ranked.filter(o => o.distance <= ranked[2].distance) };
});
const inputFiles = ['content-manifest.json', 'questions.json', ...manifest.operator_files];
const report = {
  version: manifest.version, checks_passed: checks,
  input_hashes: Object.fromEntries(inputFiles.map(name => [name, createHash('sha256').update(readFileSync(join(root, name))).digest('hex')])),
  questions: questions.length, operators: operators.length, dimensions: dimensions.length,
  questions_per_dimension: perDimension,
  theoretical_answer_combinations: (4n ** BigInt(questions.length)).toString(),
  possible_score_vectors: (rawMax + 1) ** dimensions.length,
  duplicate_groups_4d: groupsFor(['D', 'C', 'E', 'P']), duplicate_groups_6d: groupsFor(dimensions),
  old_pair_comparison: oldPairs, reachable_witnesses: witnesses,
  sample: { count: manifest.sample_count, seed: manifest.sample_seed, method: 'xorshift32 fixed-seed option simulation', tied_samples: tiedSamples,
    distribution: operators.map(o => ({ id: o.id, name: o.name, fractional_count: counts[o.id], share_percent: counts[o.id] / manifest.sample_count * 100 })) },
  scenarios: patterns,
  uncertain_dimensions: operators.map(o => ({ id: o.id, name: o.name, dimensions: o.uncertain_dimensions })),
  interpretation: '构造样本和固定种子的随机选项模拟；不是全答案穷举、真实玩家统计或心理测量准确率。'
};
writeFileSync(join(root, 'audit-results.json'), JSON.stringify(report, null, 2) + '\n');
const quiz = ['# 罗德岛干员性格匹配：30题试玩稿 v0.3', '', '这是一版娱乐性角色比较题本。请选择通常更接近自己的反应；所有选项都可以成立。遇到都不像自己或难以区分的选项，请记下来。完成时长仍待实际试玩。', ''];
for (const [i, q] of questions.entries()) {
  quiz.push(`## ${i + 1}. ${q.prompt}`, '');
  for (const o of q.options) quiz.push(`- ${o.id}. ${o.text}`);
  quiz.push('');
}
writeFileSync(join(root, '问卷试玩稿.md'), quiz.join('\n'));
const review = ['# 角色与计分评审稿 v0.3', '', '角色坐标是内容编辑假设；来源、逐维推断和不确定项见 JSON。用户解释必须来自实际答案，以下第三人称摘要只描述角色。', '',
  '| 角色 | D | C | E | P | R | S | 待复核维度 |', '|---|---:|---:|---:|---:|---:|---:|---|'];
for (const o of operators) review.push(`| ${o.name} | ${dimensions.map(d => o.scores[d]).join(' | ')} | ${o.uncertain_dimensions.join('、') || '仍需独立审阅'} |`);
review.push('', '## 题目结构', '', '| 题目 | 主维度 | 选项计分 | 设计说明 |', '|---|---|---|---|');
for (const q of questions) review.push(`| ${q.id} | ${q.dimension} | ${q.options.map(o => `${o.id}=${o.value}`).join('，')} | ${q.design_note} |`);
review.push('', '## 角色简介与来源', '');
for (const o of operators) {
  review.push(`### ${o.name}：${o.title}`, '', o.role_summary, '', `阶段：${o.phase}`, '',
    `资料定位：${o.evidence.map(e => `[${e.section}](${e.url})`).join('；')}。`, '');
  if (o.review_notes) review.push(`审阅提示：${Array.isArray(o.review_notes) ? o.review_notes.join('；') : o.review_notes}`, '');
}
review.push('## 扩容检查', '', `通过 ${checks.length} 组检查；${witnesses.filter(w => w.uniquely_reachable).length}/${operators.length} 位角色在自身坐标处可以独立成为最近结果，其余按并列处理。`, '',
  `六维重复画像：${report.duplicate_groups_6d.length ? report.duplicate_groups_6d.map(g => g.map(id => operators.find(o => o.id === id).name).join(' / ')).join('；') : '未发现'}。`, '',
  `另做 ${manifest.sample_count.toLocaleString('en-US')} 组固定种子的随机选项模拟；不是全答案穷举，也不是实际玩家数据。`, '',
  '| 角色 | 模拟最近结果占比（并列平分） |', '|---|---:|');
for (const item of report.sample.distribution) review.push(`| ${item.name} | ${item.share_percent.toFixed(2)}% |`);
review.push('', '## 旧同分角色对检查', '');
for (const pair of oldPairs) review.push(`- ${pair.ids.map(id => operators.find(o => o.id === id).name).join(' / ')}：差异维度 ${pair.differences.join('、') || '无，继续并列'}；其中待复核 ${pair.provisional_differences.join('、') || '仍需独立剧情审阅'}。`);
review.push('', '## 构造答案试算', '');
for (const p of patterns) review.push(`- ${p.name} → 最近：${p.nearest.map(o => o.name).join(' / ')}；前三位置含并列：${p.top.map(o => o.name).join('、')}。`);
review.push('', '以上试算验证模型行为，不等于已验证玩家人格或角色的客观性格。', '');
writeFileSync(join(root, '角色与计分评审稿.md'), review.join('\n'));
console.log(JSON.stringify({ checks: checks.length, questions: questions.length, operators: operators.length, dimensions: dimensions.length,
  sample_count: manifest.sample_count, duplicate_groups_6d: report.duplicate_groups_6d,
  uniquely_reachable: witnesses.filter(w => w.uniquely_reachable).length, old_pair_comparison: oldPairs }));
