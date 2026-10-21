const DIMENSIONS = Object.freeze(['D', 'C', 'E', 'P', 'R', 'S']);
const VERSION = 'v03';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRaw(raw, maximum = 15) {
  if (!isRecord(raw) || Object.keys(raw).length !== DIMENSIONS.length ||
      DIMENSIONS.some(d => !Object.hasOwn(raw, d) || !Number.isInteger(raw[d]) || raw[d] < 0 || raw[d] > maximum)) {
    throw new TypeError('Expected all six integer dimension scores in range.');
  }
}

export function calculateProfile(questions, answers) {
  if (!Array.isArray(questions) || !questions.length || !isRecord(answers)) {
    throw new TypeError('Questions and a complete answer map are required.');
  }
  const raw = Object.fromEntries(DIMENSIONS.map(d => [d, 0]));
  const counts = Object.fromEntries(DIMENSIONS.map(d => [d, 0]));
  const ids = new Set();
  for (const question of questions) {
    if (!question || typeof question.id !== 'string' || ids.has(question.id) ||
        !DIMENSIONS.includes(question.dimension) || !Array.isArray(question.options) || question.options.length !== 4) {
      throw new TypeError('Invalid question definition.');
    }
    ids.add(question.id);
    const optionIds = question.options.map(option => option.id);
    if (new Set(optionIds).size !== 4 || question.options.some(option =>
      typeof option.id !== 'string' || !Number.isInteger(option.value) || option.value < 0 || option.value > 3)) {
      throw new TypeError('Invalid option definition.');
    }
    const selected = Object.hasOwn(answers, question.id)
      ? question.options.find(option => option.id === answers[question.id])
      : undefined;
    if (!selected) throw new TypeError(`Missing or invalid answer: ${question.id}`);
    raw[question.dimension] += selected.value;
    counts[question.dimension]++;
  }
  if (Object.keys(answers).length !== questions.length || Object.keys(answers).some(id => !ids.has(id))) {
    throw new TypeError('Answer map contains unexpected questions.');
  }
  if (DIMENSIONS.some(d => counts[d] === 0)) throw new TypeError('All six dimensions require questions.');
  return {
    raw,
    normalized: Object.fromEntries(DIMENSIONS.map(d => [d, 100 * raw[d] / (3 * counts[d])]))
  };
}

export function rankOperators(operators, raw, questionsPerDimension = 5) {
  if (!Number.isInteger(questionsPerDimension) || questionsPerDimension < 1) {
    throw new TypeError('Questions per dimension must be a positive integer.');
  }
  const maximum = questionsPerDimension * 3;
  validateRaw(raw, maximum);
  if (!Array.isArray(operators)) throw new TypeError('Operators must be an array.');
  const ids = new Set();
  const ranked = operators.map(operator => {
    if (!operator || typeof operator.id !== 'string' || ids.has(operator.id) ||
        DIMENSIONS.some(d => !Number.isFinite(operator.scores?.[d]) || operator.scores[d] < 0 || operator.scores[d] > 100)) {
      throw new TypeError('Invalid operator definition.');
    }
    ids.add(operator.id);
    const distance = DIMENSIONS.reduce((sum, d) =>
      sum + (100 * raw[d] - maximum * operator.scores[d]) ** 2, 0);
    return { operator, distance };
  }).sort((a, b) => a.distance - b.distance || a.operator.id.localeCompare(b.operator.id));
  let rank = 0;
  return ranked.map((entry, index) => {
    if (index === 0 || entry.distance !== ranked[index - 1].distance) rank = index + 1;
    return { ...entry, rank };
  });
}

function validEvidence(evidence, dimension) {
  if (!evidence || !Array.isArray(evidence.dimensions) || !evidence.dimensions.includes(dimension) ||
      typeof evidence.section !== 'string' || !evidence.section.trim() ||
      typeof evidence.paraphrase !== 'string' || !evidence.paraphrase.trim()) return false;
  try {
    return new URL(evidence.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildExplanations({ questions, operators, answers, raw, operator, dimensions } = {}) {
  let profile;
  try {
    profile = calculateProfile(questions, answers);
    validateRaw(raw);
    if (DIMENSIONS.some(d => raw[d] !== profile.raw[d])) return [];
  } catch {
    // Shared score vectors do not contain individual answers and cannot support answer-based explanations.
    return [];
  }
  const selected = Array.isArray(operators) ? operators.find(item => item.id === operator?.id) : undefined;
  const uncertain = new Set(Array.isArray(selected?.uncertain_dimensions)
    ? selected.uncertain_dimensions : DIMENSIONS);
  const nameFor = dimension => dimensions?.[dimension]?.name || dimension;
  const representative = dimension => questions.filter(question => question.dimension === dimension)
    .map(question => ({ question, option: question.options.find(option => option.id === answers[question.id]) }))
    .filter(item => typeof item.option?.interpretation === 'string' && item.option.interpretation.trim())
    .sort((a, b) => {
      const center = profile.normalized[dimension];
      return Math.abs(a.option.value * 100 / 3 - center) - Math.abs(b.option.value * 100 / 3 - center) ||
        a.question.id.localeCompare(b.question.id);
    })[0];

  const candidates = DIMENSIONS.flatMap(dimension => {
    const score = profile.normalized[dimension];
    const difference = Math.abs(score - selected?.scores?.[dimension]);
    const evidence = Array.isArray(selected?.evidence)
      ? selected.evidence.find(item => validEvidence(item, dimension)) : undefined;
    if (!selected || uncertain.has(dimension) || !evidence || !Number.isFinite(difference) || difference > 20 ||
        (score > 40 && score < 60)) return [];
    const answer = representative(dimension);
    if (!answer) return [];
    // A mixed pattern cannot borrow a single answer that points in the opposite direction.
    if ((score <= 40 && answer.option.value > 1) || (score >= 60 && answer.option.value < 2)) return [];
    return [{ dimension, difference, evidence, answer, tendency: Math.abs(score - 50) }];
  }).sort((a, b) => a.difference - b.difference || b.tendency - a.tendency ||
    DIMENSIONS.indexOf(a.dimension) - DIMENSIONS.indexOf(b.dimension));

  if (candidates.length) return candidates.slice(0, 3).map(({ dimension, evidence, answer }) => ({
    dimension,
    title: `一个接近点 · ${nameFor(dimension)}`,
    text: `${answer.option.interpretation} ${selected.name}的对应资料记录：${evidence.paraphrase} 这里只比较这一情境中的选择与当前角色画像。`,
    questionId: answer.question.id,
    optionId: answer.option.id
  }));

  const fallback = DIMENSIONS.map(dimension => ({ dimension, answer: representative(dimension) }))
    .filter(item => item.answer)
    .sort((a, b) => Math.abs(profile.normalized[b.dimension] - 50) - Math.abs(profile.normalized[a.dimension] - 50) ||
      DIMENSIONS.indexOf(a.dimension) - DIMENSIONS.indexOf(b.dimension))[0];
  return fallback ? [{
    dimension: fallback.dimension,
    title: `一次具体选择 · ${nameFor(fallback.dimension)}`,
    text: fallback.answer.option.interpretation,
    questionId: fallback.answer.question.id,
    optionId: fallback.answer.option.id
  }] : [];
}

export function encodeProfile(raw) {
  validateRaw(raw);
  return `${VERSION}.${DIMENSIONS.map(d => raw[d].toString(16)).join('')}`;
}

export function decodeProfile(value) {
  if (typeof value !== 'string' || value.length !== 10 || !/^v03\.[0-9a-f]{6}$/.test(value)) return null;
  return Object.fromEntries(DIMENSIONS.map((d, index) => [d, Number.parseInt(value[index + 4], 16)]));
}
