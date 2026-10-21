import { readFile, mkdir, writeFile } from 'node:fs/promises';

const pack = new URL('./content/', import.meta.url);
const read = async name => JSON.parse((await readFile(new URL(name, pack), 'utf8')).replace(/^\uFEFF/, ''));
const [manifest, sourceQuestions] = await Promise.all([read('content-manifest.json'), read('questions.json')]);
const sourceOperators = (await Promise.all(manifest.operator_files.map(read))).flat();

function conciseEvidence(text) {
  // Remove repeated source/scoring prefixes while retaining the authored source paraphrase and its qualifications.
  return text.trim().replace(/^(?:PRTS转载游戏文本|游戏(?:档案|语音|模组文本)转载)：\s*/u, '')
    .split(/(?<=[。；])\s*(?=(?:据此|暂以|暂推|暂定|[DCEPRS](?:\d{2}|维|暂|记|据|对应)))/u)[0].trim();
}

const data = {
  version: 'v03',
  questions: sourceQuestions.map(({ id, dimension, prompt, context_hint, options }) => ({
    id, dimension, prompt, ...(context_hint ? { context_hint } : {}),
    options: options.map(({ id: optionId, text, value, interpretation }) => ({ id: optionId, text, value, interpretation }))
  })),
  operators: sourceOperators.map(({ id, name, phase, title, role_summary, scores, uncertain_dimensions, evidence }) => ({
    id, name, phase, title, role_summary, scores, uncertain_dimensions,
    evidence: evidence.map(({ url, section, paraphrase, dimensions }) => ({
      url, section, paraphrase: conciseEvidence(paraphrase), dimensions
    }))
  })),
  dimensions: manifest.dimensions
};

if (data.questions.length !== manifest.question_count || data.operators.length !== manifest.candidate_count ||
    data.operators.some(operator => !operator.phase || !operator.role_summary || operator.evidence.some(item => !item.paraphrase))) {
  throw new Error('Content pack is incomplete; data.json was not rebuilt.');
}
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await writeFile(new URL('./dist/data.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
console.log(`Prepared ${data.questions.length} questions and ${data.operators.length} operators (${data.version}).`);
