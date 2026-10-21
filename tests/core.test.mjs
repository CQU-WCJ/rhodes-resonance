import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateProfile, rankOperators, buildExplanations, encodeProfile, decodeProfile } from '../dist/core.mjs';

const read = url => JSON.parse(readFileSync(url, 'utf8').replace(/^\uFEFF/, ''));
const data = read(new URL('../dist/data.json', import.meta.url));
const manifest = read(new URL('../content/content-manifest.json', import.meta.url));
const audit = read(new URL('../content/audit-results.json', import.meta.url));
const dimensions = ['D', 'C', 'E', 'P', 'R', 'S'];
const rawAt = value => Object.fromEntries(dimensions.map(d => [d, value]));
const answersAt = value => Object.fromEntries(data.questions.map(question =>
  [question.id, question.options.find(option => option.value === value).id]));
const answersFor = raw => {
  const remaining = { ...raw };
  return Object.fromEntries(data.questions.map(question => {
    const value = Math.min(3, remaining[question.dimension]);
    remaining[question.dimension] -= value;
    return [question.id, question.options.find(option => option.value === value).id];
  }));
};
const operatorAt = (id, score) => ({
  id, name: `角色-${id}`, scores: rawAt(score), uncertain_dimensions: [],
  evidence: dimensions.map(dimension => ({
    url: `https://prts.wiki/w/example#${dimension}`,
    section: `已给出的栏目-${dimension}`,
    paraphrase: `原稿证据-${dimension}。`,
    dimensions: [dimension]
  }))
});
const explain = (operator, raw = rawAt(12), overrides = {}) => buildExplanations({
  questions: data.questions, operators: [operator], answers: answersFor(raw), raw,
  operator, dimensions: data.dimensions, ...overrides
});

test('发布数据完整并保留原稿的六维坐标与答案分值', () => {
  assert.equal(data.version, 'v03');
  assert.equal(data.questions.length, manifest.question_count);
  assert.equal(data.operators.length, manifest.candidate_count);
  assert.deepEqual(Object.keys(data.dimensions), dimensions);
  const sourceOperators = manifest.operator_files.flatMap(file => read(new URL(
    `../content/${file}`, import.meta.url)));
  assert.deepEqual(data.operators.map(operator => [operator.id, operator.scores]),
    sourceOperators.map(operator => [operator.id, operator.scores]));
  assert.deepEqual(data.operators.map(operator => [operator.id, operator.phase]),
    sourceOperators.map(operator => [operator.id, operator.phase]));
  const sourceQuestions = read(new URL('../content/questions.json', import.meta.url));
  assert.deepEqual(data.questions.map(question => [question.id, question.dimension,
    question.options.map(option => [option.id, option.value])]),
  sourceQuestions.map(question => [question.id, question.dimension, question.options.map(option => [option.id, option.value])]));
  for (const operator of data.operators) {
    assert(operator.phase && operator.role_summary && operator.evidence.length >= 2);
    assert(!Object.hasOwn(operator, 'score_basis'));
    assert(!Object.hasOwn(operator, 'dimension_confidence'));
  }
});

test('零分、满分和未提前取整的归一化', () => {
  assert.deepEqual(calculateProfile(data.questions, answersAt(0)), { raw: rawAt(0), normalized: rawAt(0) });
  assert.deepEqual(calculateProfile(data.questions, answersAt(3)), { raw: rawAt(15), normalized: rawAt(100) });
  const profile = calculateProfile(data.questions, answersFor(rawAt(7)));
  assert.deepEqual(profile.raw, rawAt(7));
  assert.equal(profile.normalized.D, 700 / 15);
});

test('缺失、未知、类型错误和多余答案均被拒绝', () => {
  assert.throws(() => calculateProfile(data.questions, {}), TypeError);
  assert.throws(() => calculateProfile(data.questions, null), TypeError);
  assert.throws(() => calculateProfile(data.questions, []), TypeError);
  const valid = answersAt(1);
  const incomplete = { ...valid };
  delete incomplete[data.questions[0].id];
  assert.throws(() => calculateProfile(data.questions, incomplete), /Missing or invalid answer/);
  for (const invalid of ['invalid', '', null, 0, {}, ['A']]) {
    assert.throws(() => calculateProfile(data.questions, { ...valid, [data.questions[0].id]: invalid }), TypeError);
  }
  assert.throws(() => calculateProfile(data.questions, { ...valid, extra: 'A' }), TypeError);
});

test('题目、选项、答案对象及角色显示顺序不影响得分和排名', () => {
  const answers = answersFor({ D: 3, C: 12, E: 7, P: 8, R: 4, S: 11 });
  const shuffled = [...data.questions].reverse().map(question => ({ ...question, options: [...question.options].reverse() }));
  const reorderedAnswers = Object.fromEntries(Object.entries(answers).reverse());
  const expected = calculateProfile(data.questions, answers);
  assert.deepEqual(calculateProfile(shuffled, reorderedAnswers), expected);
  assert.deepEqual(rankOperators([...data.operators].reverse(), expected.raw), rankOperators(data.operators, expected.raw));
});

test('五组构造答案与原稿审计的原始分、整数距离和前三截止完全一致', () => {
  for (const scenario of audit.scenarios) {
    const { raw } = calculateProfile(data.questions, scenario.answers);
    assert.deepEqual(raw, scenario.raw);
    const actual = rankOperators(data.operators, raw).filter(item => item.rank <= 3)
      .map(({ operator, distance }) => ({ id: operator.id, name: operator.name, distance }));
    assert.deepEqual(actual, scenario.top);
  }
});

test('所有角色自身坐标可由合法答案达到且整数距离为零', () => {
  for (const operator of data.operators) {
    const target = Object.fromEntries(dimensions.map(d => [d, operator.scores[d] * 15 / 100]));
    assert.deepEqual(calculateProfile(data.questions, answersFor(target)).raw, target);
    assert(rankOperators(data.operators, target).some(item => item.operator.id === operator.id && item.distance === 0));
  }
});

test('并列使用相同名次，下一名次跳过占用位置，ID只决定显示顺序', () => {
  const operators = [operatorAt('beta', 20), operatorAt('delta', 60), operatorAt('alpha', 20), operatorAt('gamma', 40)];
  const ranked = rankOperators(operators, rawAt(3));
  assert.deepEqual(ranked.map(item => [item.operator.id, item.rank, item.distance]), [
    ['alpha', 1, 0], ['beta', 1, 0], ['gamma', 3, 540000], ['delta', 4, 2160000]
  ]);
  const cutoffTie = rankOperators([operatorAt('first', 20), operatorAt('b', 40), operatorAt('c', 40), operatorAt('d', 40)], rawAt(3));
  assert.equal(cutoffTie.filter(item => item.rank <= 3).length, 4);
});

test('排名拒绝不完整分数或非法计分参数', () => {
  assert.throws(() => rankOperators(data.operators, { D: 3 }), TypeError);
  assert.throws(() => rankOperators(data.operators, rawAt(16)), TypeError);
  assert.throws(() => rankOperators(data.operators, rawAt(1.5)), TypeError);
  assert.throws(() => rankOperators(data.operators, rawAt(3), 0), TypeError);
  assert.throws(() => rankOperators([operatorAt('same', 20), operatorAt('same', 40)], rawAt(3)), TypeError);
});

test('分享只编码固定顺序的六维总分，支持边界与混合值往返', () => {
  for (const raw of [rawAt(0), rawAt(15), { D: 0, C: 1, E: 2, P: 10, R: 14, S: 15 }]) {
    const encoded = encodeProfile(raw);
    assert.match(encoded, /^v03\.[0-9a-f]{6}$/);
    assert.equal(encoded.length, 10);
    assert.deepEqual(decodeProfile(encoded), raw);
  }
  assert.equal(encodeProfile({ D: 0, C: 1, E: 2, P: 10, R: 14, S: 15 }), 'v03.012aef');
});

test('分享解码严格拒绝错误版本、大小写、长度、空白和附加内容', () => {
  for (const invalid of [undefined, null, 123, {}, 'v02.012aef', 'V03.012aef', 'v03.012AEF', 'v03.012aeg',
    'v03.012ae', 'v03.012aeff', ' v03.012aef', 'v03.012aef ', 'v03.012aef\n', 'v03.012aef?name=foo', '012aef']) {
    assert.equal(decodeProfile(invalid), null);
  }
  for (const invalid of [{ D: 1 }, rawAt(-1), rawAt(16), rawAt(1.1), { ...rawAt(1), extra: 'name' }]) {
    assert.throws(() => encodeProfile(invalid), TypeError);
  }
});

test('解释最多三维，逐项来自实际答案与原稿中给出的对应维度证据', () => {
  const operator = operatorAt('known', 80);
  operator.uncertain_dimensions = ['E'];
  const raw = rawAt(12);
  const answers = answersFor(raw);
  const explanations = explain(operator, raw);
  assert.equal(explanations.length, 3);
  assert.equal(new Set(explanations.map(item => item.dimension)).size, 3);
  assert(!explanations.some(item => item.dimension === 'E'));
  for (const item of explanations) {
    const question = data.questions.find(question => question.id === item.questionId);
    const option = question.options.find(option => option.id === item.optionId);
    assert.equal(answers[item.questionId], item.optionId);
    assert.equal(question.dimension, item.dimension);
    assert(item.text.includes(option.interpretation));
    assert(item.text.includes(`原稿证据-${item.dimension}。`));
    assert(Math.abs(raw[item.dimension] * 100 / 15 - operator.scores[item.dimension]) <= 20);
  }
});

test('全部不确定、证据缺失、证据维度不符或来源不合法时不编造角色比较', () => {
  const uncertain = operatorAt('uncertain', 80);
  uncertain.uncertain_dimensions = [...dimensions];
  const noEvidence = { ...operatorAt('none', 80), evidence: [] };
  const wrongEvidence = { ...operatorAt('wrong', 80), evidence: [{ url: 'https://prts.wiki/w/a#b',
    section: '不可借用的资料', paraphrase: '不能借用的证据。', dimensions: ['unknown'] }] };
  const badSource = operatorAt('source', 80);
  badSource.evidence.forEach(evidence => { evidence.url = 'javascript:alert(1)'; });
  for (const operator of [uncertain, noEvidence, wrongEvidence, badSource]) {
    const result = explain(operator);
    assert.equal(result.length, 1);
    assert.match(result[0].title, /^一次具体选择/);
    const selected = data.questions.find(question => question.id === result[0].questionId).options
      .find(option => option.id === result[0].optionId);
    assert.equal(result[0].text, selected.interpretation);
    assert(!result[0].text.includes(operator.name));
  }
});

test('距离过远或居中模式只描述实际选择，有一个可靠接近点也不硬补三条', () => {
  const operator = operatorAt('partial', 80);
  assert.match(explain(operator, rawAt(0))[0].title, /^一次具体选择/);
  assert.match(explain(operator, rawAt(7))[0].title, /^一次具体选择/);
  operator.uncertain_dimensions = dimensions.filter(d => d !== 'C');
  const result = explain(operator);
  assert.equal(result.length, 1);
  assert.equal(result[0].dimension, 'C');
  assert.match(result[0].title, /^一个接近点/);
});

test('只有分享总分、答案不全或总分与答案不一致时没有答案解释', () => {
  const operator = operatorAt('shared', 80);
  assert.deepEqual(explain(operator, rawAt(12), { answers: undefined }), []);
  assert.deepEqual(explain(operator, rawAt(12), { answers: {} }), []);
  assert.deepEqual(explain(operator, rawAt(12), { raw: rawAt(0) }), []);
  assert.deepEqual(buildExplanations(), []);
});

test('所有纯函数均不修改输入对象', () => {
  const operator = operatorAt('immutable', 80);
  const answers = answersFor(rawAt(12));
  const snapshot = structuredClone({ questions: data.questions, answers, operator });
  const profile = calculateProfile(data.questions, answers);
  rankOperators([operator], profile.raw);
  explain(operator, profile.raw, { answers });
  decodeProfile(encodeProfile(profile.raw));
  assert.deepEqual({ questions: data.questions, answers, operator }, snapshot);
});
