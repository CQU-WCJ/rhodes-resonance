import { calculateProfile, rankOperators, buildExplanations, encodeProfile, decodeProfile } from './core.mjs';

const app = document.querySelector('#app');
const storageKey = 'rhodes-resonance:v03';
const keys = ['D', 'C', 'E', 'P', 'R', 'S'];
let data, assets = {}, answers = {}, index = 0, route = 'home', resultRaw = null;
let nickname = '', modalUrl = null, toastTimer;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const answered = () => data.questions.filter(q => answers[q.id] !== undefined).length;
const complete = () => answered() === data.questions.length;
const imageFor = (operator, type = 'portrait') => {
  const item = assets.operators?.[operator.id];
  return item?.[type] || item?.avatar || item?.portrait || '';
};
function image(operator, type = 'portrait', className = '', eager = false) {
  const src = imageFor(operator, type);
  return src ? `<img src="${escape(src)}" alt="${escape(operator.name)}" class="${className}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : `<span class="portrait-placeholder" aria-label="${escape(operator.name)}">${escape(operator.name.slice(0, 2))}</span>`;
}
function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 3300);
}
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify({ version: data.version, answers, index })); }
  catch { toast('浏览器暂时无法保存进度，请保持本页打开。'); }
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!saved || saved.version !== data.version || !saved.answers || typeof saved.answers !== 'object') return;
    for (const q of data.questions) if (q.options.some(o => o.id === saved.answers[q.id])) answers[q.id] = saved.answers[q.id];
    index = Number.isInteger(saved.index) ? Math.min(Math.max(saved.index, 0), data.questions.length - 1) : 0;
  } catch { /* A damaged local save does not prevent a new test. */ }
}
function go(hash) {
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}
function focusMain() { app.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
function heroPeople() {
  return ['texas', 'amiya', 'exusiai'].map((id, i) => {
    const operator = data.operators.find(o => o.id === id);
    return operator ? `<div class="hero-person hero-person-${i}" data-name="${escape(operator.name)}">${image(operator, 'portrait', '', true)}</div>` : '';
  }).join('');
}
function renderHome() {
  route = 'home';
  document.title = '罗德岛共鸣｜你的性格像哪位干员';
  app.innerHTML = `<section class="hero shell">
    <div class="hero-copy"><p class="eyebrow">RHODES ISLAND · PERSONALITY ARCHIVE</p>
    <h1 class="hero-title">在另一段故事里，<br>你会是谁<span>？</span></h1>
    <p class="hero-description">从日常的小小选择出发，<br>寻找与你相近的那位罗德岛同行者。</p>
    <div class="hero-actions"><button class="button button-primary" data-action="${answered() ? 'resume' : 'start'}">${answered() ? (complete() ? '查看我的结果' : '继续我的测评') : '开启干员共鸣测试'} <span aria-hidden="true">↗</span></button>
    ${answered() ? '<button class="button button-text" data-action="restart-confirm">重新开始</button>' : ''}</div>
    ${answered() ? `<p class="resume-note">${complete() ? '已完成' : `已保存 ${answered()} / ${data.questions.length} 题`} · 进度只保存在当前浏览器</p>` : '<p class="fine-print">无需登录 · 答案保存在本机 · 约 6–8 分钟</p>'}
    <div class="hero-stats"><div><strong>30</strong><span>日常情境</span></div><div><strong>32</strong><span>干员画像</span></div><div><strong>06</strong><span>行为维度</span></div></div></div>
    <div class="hero-art" aria-label="阿米娅、德克萨斯与能天使"><div class="art-orbit"></div><span class="art-stamp">R.I.<br>RESONANCE</span>${heroPeople()}<span class="art-caption">每一种选择，都有自己的回响。</span></div>
    </section><section class="shell home-details"><div class="section-heading"><p class="eyebrow">A SMALL JOURNEY</p><h2>你的答案，比标签更重要。</h2></div>
    <div class="feature-row"><div class="feature"><span>01 / 选择</span><h3>没有标准答案</h3><p>计划被打乱、朋友需要帮助、一次小小尝试——选更接近你的反应。</p></div><div class="feature"><span>02 / 共鸣</span><h3>看见相似，也看见不同</h3><p>从六个行为角度比较，结果会回到你做过的具体选择。</p></div><div class="feature"><span>03 / 留念</span><h3>带走你的干员卡</h3><p>保存一张属于你的共鸣档案，也邀请朋友来看看自己的结果。</p></div></div>
    <div class="section-heading roster-intro"><h2>这次，可能遇见他们。</h2><button class="button button-text" data-action="roster">查看 32 位干员 ↗</button></div>
    <div class="mini-roster">${data.operators.slice(0, 8).map(o => `<button class="operator-thumb" data-action="operator" data-id="${o.id}">${image(o, 'avatar')}<span>${escape(o.name)}</span></button>`).join('')}</div>
    <p class="fine-print">本测试为非官方同人娱乐作品，结果是当前角色池中的相对比较，不是心理诊断。</p></section>`;
}
function renderQuiz(focus = true) {
  route = 'quiz';
  const q = data.questions[index], selected = answers[q.id], count = answered();
  document.title = `第 ${index + 1} 题｜罗德岛共鸣`;
  app.innerHTML = `<section class="quiz-shell shell"><div class="quiz-topline"><button class="button button-text" data-action="home">← 暂时休息</button><span>进度已自动保存 · ${count} / ${data.questions.length}</span></div>
    <div class="progress-track" role="progressbar" aria-label="答题进度" aria-valuemin="0" aria-valuemax="30" aria-valuenow="${count}"><div class="progress-fill" style="width:${count / data.questions.length * 100}%"></div></div>
    <p class="question-number">QUESTION ${String(index + 1).padStart(2, '0')} <span>/ ${data.questions.length}</span></p><h1 class="question-title">${escape(q.prompt)}</h1><p class="context-hint">${escape(q.context_hint || '选通常更接近你的反应，每个选项都可以成立。')}</p>
    <div class="options" role="group" aria-label="答案">${q.options.map(o => `<button class="option ${selected === o.id ? 'selected' : ''}" data-action="answer" data-id="${escape(o.id)}" aria-pressed="${selected === o.id}"><span class="option-key">${escape(o.id)}</span><span class="option-text">${escape(o.text)}</span><span class="option-check" aria-hidden="true">${selected === o.id ? '✓' : '↗'}</span></button>`).join('')}</div>
    <div class="quiz-nav"><button class="button button-secondary" data-action="previous" ${index === 0 ? 'disabled' : ''}>← 上一题</button><span class="keyboard-hint">可按 1–4 选择</span><button class="button button-primary" data-action="next" ${!selected ? 'disabled' : ''}>${index === data.questions.length - 1 ? '生成我的共鸣档案' : '下一题'} →</button></div>
    <div class="question-dots" aria-label="跳转题目">${data.questions.map((item, i) => `<button class="question-dot ${answers[item.id] ? 'answered' : ''} ${i === index ? 'current' : ''}" data-action="jump" data-index="${i}" aria-label="第${i + 1}题${answers[item.id] ? '，已答' : '，未答'}" ${i === index ? 'aria-current="step"' : ''}>${i + 1}</button>`).join('')}</div></section>`;
  if (focus) focusMain();
}
function radar(raw, operator) {
  const cx = 170, cy = 155, radius = 105;
  const point = (i, scale) => [cx + Math.cos(-Math.PI / 2 + i * Math.PI / 3) * radius * scale, cy + Math.sin(-Math.PI / 2 + i * Math.PI / 3) * radius * scale];
  const poly = values => values.map((value, i) => point(i, value / 100).join(',')).join(' ');
  return `<svg class="radar-chart" viewBox="0 0 340 310" role="img" aria-label="你与${escape(operator.name)}的六维比较">${[.25, .5, .75, 1].map(scale => `<polygon points="${keys.map((_, i) => point(i, scale).join(',')).join(' ')}" fill="none" stroke="#ffffff18"/>`).join('')}${keys.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${point(i, 1)[0]}" y2="${point(i, 1)[1]}" stroke="#ffffff18"/>`).join('')}<polygon points="${poly(keys.map(d => operator.scores[d]))}" fill="#8eaea51c" stroke="#9bbdb1" stroke-dasharray="5 4"/><polygon points="${poly(keys.map(d => raw[d] / 15 * 100))}" fill="#ffad6530" stroke="#ffad65" stroke-width="2"/>${keys.map((d, i) => { const p = point(i, 1.27); return `<text x="${p[0]}" y="${p[1]}" text-anchor="middle" dominant-baseline="middle" fill="#c7d0d4" font-size="12">${escape(data.dimensions[d].name)}</text>`; }).join('')}</svg>`;
}
function dimensionRows(raw, operator) {
  return keys.map(d => `<div class="dimension-row"><div class="dimension-label"><strong>${escape(data.dimensions[d].name)}</strong><span>${escape(data.dimensions[d].low)} <i>↔</i> ${escape(data.dimensions[d].high)}</span></div><div class="dimension-track"><span class="dimension-dot person-dot" style="left:${raw[d] / 15 * 100}%" aria-label="你的倾向${Math.round(raw[d] / 15 * 100)}"></span><span class="dimension-dot operator-dot" style="left:${operator.scores[d]}%" aria-label="干员画像${operator.scores[d]}"></span></div></div>`).join('');
}
function renderResult(raw) {
  route = 'result'; resultRaw = raw;
  const ranking = rankOperators(data.operators, raw);
  const primary = ranking[0].operator;
  const nearest = ranking.filter(x => x.distance === ranking[0].distance);
  const top = ranking.filter(x => x.distance <= ranking[Math.min(2, ranking.length - 1)].distance);
  const isMine = complete() && keys.every(d => calculateProfile(data.questions, answers).raw[d] === raw[d]);
  const reasons = isMine ? buildExplanations({ questions: data.questions, operators: data.operators, answers, raw, operator: primary, dimensions: data.dimensions }) : [];
  const gap = keys.map(d => ({ d, value: raw[d] / 15 * 100 - primary.scores[d] })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  const resultName = nearest.map(x => x.operator.name).join(' / ');
  document.title = `${resultName}｜我的罗德岛共鸣`;
  app.innerHTML = `<section class="result-shell shell"><div class="result-hero"><div class="result-copy"><p class="eyebrow">${isMine ? 'YOUR RESONANCE ARCHIVE' : 'A SHARED RESONANCE ARCHIVE'}</p><p class="result-kicker">${nearest.length > 1 ? '你呈现了几种相近的风格' : '本次选择中，你与这位干员更相近'}</p><h1 class="result-title">${escape(resultName)}</h1><p class="result-subtitle">${escape(primary.title)}</p><p class="result-summary">${escape(primary.role_summary)}</p>${nearest.length > 1 ? '<p class="tie-note">这些干员在本次比较中并列，展示顺序不代表更相似。</p>' : ''}<div class="tags">${keys.filter(d => Math.abs(raw[d] / 15 * 100 - 50) >= 15).slice(0, 3).map(d => `<span class="tag">${escape(raw[d] > 7.5 ? data.dimensions[d].high : data.dimensions[d].low)}</span>`).join('') || '<span class="tag">选择会随情境变化</span>'}</div><div class="result-actions"><button class="button button-primary" data-action="export">保存共鸣卡 ↗</button><button class="button button-secondary" data-action="share">复制结果链接</button></div><p class="fine-print">${isMine ? '这是你本次选择的相对比较。' : '这是朋友分享的六维结果，不包含完整回答。'} 当前收录 32 位干员。</p></div><div class="result-art">${image(primary, 'portrait', '', true)}<span class="result-art-mark">R.I. / ${escape(primary.id.toUpperCase())}</span></div></div>
    <div class="result-grid"><section class="panel"><p class="eyebrow">SIX DIMENSIONS</p><h2>你们相近的轮廓</h2>${radar(raw, primary)}<div class="chart-legend"><span class="person-legend">你的选择</span><span class="operator-legend">干员画像</span></div>${dimensionRows(raw, primary)}<p class="fine-print">坐标是本测试的风格描述，不是能力高低或准确率。</p></section>
    <section class="panel"><p class="eyebrow">BEHIND YOUR CHOICES</p><h2>${isMine ? '从你的选择说起' : '读懂这份共鸣'}</h2>${reasons.length ? reasons.map(r => `<article class="reason"><span>${escape(data.dimensions[r.dimension]?.name || '本次选择')}</span><h3>${escape(r.title)}</h3><p>${escape(r.text)}</p></article>`).join('') : `<article class="reason"><h3>${isMine ? '你的选择保留了不少情境差异' : '这份链接只分享六维轮廓'}</h3><p>${isMine ? '目前没有足够明确且有角色资料支持的维度，可以组织出更强的相似解释。你仍可以查看相近干员和具体差异。' : '具体答题理由留在答题者自己的浏览器里。你也可以完成测评，得到属于自己的说明。'}</p></article>`}
    <article class="reason difference"><span>也有不同</span><p>${Math.abs(gap.value) >= 10 ? `在${escape(data.dimensions[gap.d].name)}上，你的选择比当前角色画像更偏向“${escape(gap.value > 0 ? data.dimensions[gap.d].high : data.dimensions[gap.d].low)}”。${primary.uncertain_dimensions.includes(gap.d) ? '这一角色维度的资料仍有不确定性，差异只供参考。' : '相近的轮廓，并不意味着每个选择都相同。'}` : '这份简短问卷暂未呈现明显差异；相近也不代表你与角色完全相同。'}</p></article><button class="button button-text" data-action="operator" data-id="${primary.id}">查看 ${escape(primary.name)} 的画像依据 ↗</button></section></div>
    <section class="matches-section"><div class="section-heading"><div><p class="eyebrow">OTHER CONNECTIONS</p><h2>也与你相近的干员</h2></div></div><div class="matches-grid">${top.map((match, i) => `<button class="match-card" data-action="operator" data-id="${match.operator.id}"><span class="match-order">${String(match.rank || i + 1).padStart(2, '0')}</span>${image(match.operator, 'avatar')}<div><h3>${escape(match.operator.name)}</h3><p>${escape(match.operator.title)}</p></div><span>↗</span></button>`).join('')}</div></section>
    <section class="result-bottom"><label for="nickname">分享卡上的代号 <span>（可选）</span></label><input class="search" id="nickname" data-input="nickname" maxlength="20" placeholder="一位罗德岛同行者" value="${escape(nickname)}"><div class="hero-actions"><button class="button button-secondary" data-action="${isMine ? 'review-answers' : (answered() ? 'resume' : 'start')}">${isMine ? '回看与修改答案' : '我也来测一测'} →</button><button class="button button-text" data-action="roster">看看全部干员</button></div><p class="fine-print">非官方同人娱乐测试。角色画像是对选定档案阶段的解读，部分维度仍有不确定性。</p></section></section>`;
  focusMain();
}
function rosterCards(term = '') {
  const visible = data.operators.filter(o => `${o.name}${o.title}${o.id}`.toLowerCase().includes(term.toLowerCase()));
  return visible.map(o => `<button class="roster-card" data-action="operator" data-id="${o.id}"><div class="roster-image">${image(o, 'avatar')}</div><p class="eyebrow">${escape(o.id.replaceAll('_', ' '))}</p><h2>${escape(o.name)}</h2><p>${escape(o.title)}</p><span class="roster-arrow">↗</span></button>`).join('') || '<p class="empty-state">没有找到这位干员，试试其他名字。</p>';
}
function renderRoster() {
  route = 'roster'; document.title = '32位干员档案｜罗德岛共鸣';
  app.innerHTML = `<section class="shell roster-page"><div class="section-heading"><div><p class="eyebrow">THE ARCHIVE / 32 OPERATORS</p><h1>每个人，都有自己的回响。</h1><p>看看本次可以遇见的干员，以及画像背后的资料。</p></div></div><div class="roster-controls"><label class="sr-only" for="operator-search">搜索干员</label><input id="operator-search" class="search" data-input="search" placeholder="搜索干员名字或风格…" type="search"><span id="roster-count">32 位干员</span></div><div class="roster-grid" id="roster-grid">${rosterCards()}</div></section>`;
  focusMain();
}
function modal(html) {
  const dialog = document.querySelector('#modal');
  document.querySelector('#modal-body').innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
function operatorModal(id) {
  const o = data.operators.find(item => item.id === id);
  if (!o) return;
  modal(`<div class="operator-modal"><div class="operator-modal-heading">${image(o, 'avatar')}<div><p class="eyebrow">OPERATOR ARCHIVE</p><h2>${escape(o.name)}</h2><p>${escape(o.title)}</p></div></div><p>${escape(o.role_summary)}</p><details><summary>采用阶段与画像依据</summary><p class="fine-print">${escape(o.phase || '采用原版干员的档案与常规语音。')}</p><ul class="source-list">${o.evidence.map(e => `<li><a href="${escape(e.url)}" target="_blank" rel="noopener noreferrer">${escape(e.section)} ↗</a><p>${escape(e.paraphrase)}</p></li>`).join('')}</ul></details><p class="fine-print">这是同人内容解读。${o.uncertain_dimensions.length ? `其中${o.uncertain_dimensions.map(d => data.dimensions[d].name).join('、')}等维度仍有待复核。` : '角色坐标仍需结合不同情境理解。'}</p></div>`);
}
function about() {
  modal(`<div class="about-copy"><p class="eyebrow">ABOUT THIS JOURNEY</p><h2>让选择，遇见角色。</h2><p>罗德岛共鸣是一份非官方的明日方舟角色匹配娱乐测试。30 道日常情境题，会从六个角度比较你与 32 位干员的行为风格。</p><h3>结果从哪里来？</h3><p>选项形成六维轮廓，再与基于档案、语音等资料编辑的角色画像比较。同样的答案与内容版本会得到同样的结果，并列不会被强行分出先后。</p><h3>我的答案会被保存在哪里？</h3><p>答案仅保存在当前浏览器。无需登录，也不会上传完整回答。主动分享的结果链接只包含六个维度的总分，不包含逐题选择或代号。</p><h3>怎样理解结果？</h3><p>这是当前角色池中的相对比较，不是心理诊断、官方人格设定或经过验证的心理量表。画像有阶段与解释边界，资料可以在干员档案中查看。</p><p class="fine-print">内容版本 v0.3 · 明日方舟角色与游戏美术资源归原权利人所有。本项目与游戏官方无隶属或授权关系。</p></div>`);
}
function restartConfirm() {
  modal('<div class="about-copy"><p class="eyebrow">START AGAIN</p><h2>重新开启这段旅程？</h2><p>这会清除当前浏览器里的答题进度。你可以先保存已有的共鸣卡。</p><button class="button button-primary" data-action="restart">确认重新开始 →</button></div>');
}
function startFresh() {
  answers = {}; index = 0; resultRaw = null; persist();
  document.querySelector('#modal').close();
  go('#quiz');
}
function resume() {
  if (complete()) go(`#result=${encodeProfile(calculateProfile(data.questions, answers).raw)}`);
  else { index = Math.min(index, data.questions.length - 1); go('#quiz'); }
}
function resultLink() { return `${location.origin}${location.pathname}#result=${encodeProfile(resultRaw)}`; }
async function share() {
  try { await navigator.clipboard.writeText(resultLink()); toast('结果链接已复制，发给朋友一起看看吧。'); }
  catch { modal(`<div class="about-copy"><h2>分享你的共鸣</h2><p>复制下面的链接，朋友打开后就能看到这份六维结果。</p><input class="search" readonly aria-label="结果链接" value="${escape(resultLink())}"></div>`); document.querySelector('#modal input')?.select(); }
}
function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const lines = []; let line = '';
  for (const char of String(text)) {
    if (ctx.measureText(line + char).width > maxWidth && line) { lines.push(line); line = char; }
    else line += char;
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((part, i) => ctx.fillText(part + (i === maxLines - 1 && lines.length > maxLines ? '…' : ''), x, y + i * lineHeight));
  return Math.min(lines.length, maxLines) * lineHeight;
}
async function loadImage(src) {
  if (!src) return null;
  return new Promise(resolve => { const img = new Image(); const timer = setTimeout(() => resolve(null), 5000); img.onload = () => { clearTimeout(timer); resolve(img); }; img.onerror = () => { clearTimeout(timer); resolve(null); }; img.src = src; });
}
async function exportCard() {
  if (!resultRaw) return;
  const raw = { ...resultRaw }, cardNickname = nickname.trim();
  const button = app.querySelector('[data-action="export"]'); button.disabled = true; button.textContent = '正在绘制共鸣卡…';
  try {
    const ranked = rankOperators(data.operators, raw), o = ranked[0].operator;
    const same = ranked.filter(item => item.distance === ranked[0].distance).map(item => item.operator.name).join(' / ');
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1440;
    const ctx = canvas.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 1080, 1440); bg.addColorStop(0, '#182b35'); bg.addColorStop(1, '#0a121a'); ctx.fillStyle = bg; ctx.fillRect(0, 0, 1080, 1440);
    ctx.strokeStyle = '#ffffff0c'; for (let i = 0; i < 1080; i += 72) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 1440); ctx.stroke(); }
    const picture = await loadImage(imageFor(o));
    if (picture) { const scale = Math.min(790 / picture.width, 880 / picture.height); ctx.globalAlpha = .88; ctx.drawImage(picture, 1080 - picture.width * scale + 65, 160, picture.width * scale, picture.height * scale); ctx.globalAlpha = 1; }
    const veil = ctx.createLinearGradient(0, 0, 850, 0); veil.addColorStop(0, '#10202be8'); veil.addColorStop(1, '#10202b00'); ctx.fillStyle = veil; ctx.fillRect(0, 0, 1080, 1050);
    ctx.fillStyle = '#ffad65'; ctx.font = '22px sans-serif'; ctx.fillText('RHODES ISLAND / RESONANCE ARCHIVE', 72, 88);
    ctx.fillStyle = '#e9ebe4'; ctx.font = '30px sans-serif'; ctx.fillText(`${cardNickname || '一位罗德岛同行者'}的共鸣档案`, 72, 166, 930);
    ctx.fillStyle = '#b8c6ca'; ctx.font = '24px sans-serif'; ctx.fillText('本次选择中，与我更相近的干员是', 72, 228);
    ctx.fillStyle = '#fff2df'; ctx.font = 'bold 84px serif'; const titleHeight = wrapText(ctx, same, 66, 342, 900, 100, 2);
    ctx.fillStyle = '#ffad65'; ctx.font = '30px sans-serif'; wrapText(ctx, o.title, 72, 355 + titleHeight, 640, 44, 2);
    ctx.fillStyle = '#b9c9cd'; ctx.font = '25px sans-serif'; wrapText(ctx, o.role_summary, 72, 490 + titleHeight, 440, 40, 5);
    ctx.fillStyle = '#0b151eeb'; ctx.fillRect(0, 950, 1080, 490);
    keys.forEach((d, i) => { const row = i % 3, col = Math.floor(i / 3), x = 72 + col * 500, y = 1024 + row * 95; ctx.fillStyle = '#dbe3df'; ctx.font = '24px sans-serif'; ctx.fillText(data.dimensions[d].name, x, y); ctx.fillStyle = '#ffffff20'; ctx.fillRect(x, y + 20, 390, 5); ctx.fillStyle = '#ffad65'; ctx.beginPath(); ctx.arc(x + raw[d] / 15 * 390, y + 22.5, 7, 0, Math.PI * 2); ctx.fill(); });
    ctx.strokeStyle = '#ffffff26'; ctx.beginPath(); ctx.moveTo(72, 1300); ctx.lineTo(1008, 1300); ctx.stroke();
    ctx.fillStyle = '#ffad65'; ctx.font = '29px serif'; ctx.fillText('在另一段故事里，你会是谁？', 72, 1350);
    ctx.fillStyle = '#8ca1aa'; ctx.font = '18px sans-serif'; ctx.fillText(`${location.host} · 非官方娱乐测试 · v0.3`, 72, 1397);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw Error('图片生成失败');
    if (modalUrl) URL.revokeObjectURL(modalUrl);
    modalUrl = URL.createObjectURL(blob);
    modal(`<div class="card-preview"><h2>你的共鸣档案已生成</h2><p>手机可长按图片保存，也可以点击下方下载。</p><img src="${modalUrl}" alt="${escape(same)}共鸣卡预览"><a class="button button-primary" href="${modalUrl}" download="罗德岛共鸣-${escape(o.name)}.png">下载共鸣卡 ↓</a></div>`);
  } catch { toast('图片暂时没能生成，请稍后再试；你仍可以复制结果链接。'); }
  finally { button.disabled = false; button.innerHTML = '保存共鸣卡 ↗'; }
}
function renderRoute() {
  const hash = location.hash;
  if (hash.startsWith('#result=')) {
    const raw = decodeProfile(hash.slice(8));
    if (raw) return renderResult(raw);
    toast('这个结果链接无法识别，可以重新完成一次测试。');
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (hash === '#quiz') return renderQuiz();
  if (hash === '#roster') return renderRoster();
  renderHome(); focusMain();
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || !data) return;
  switch (button.dataset.action) {
    case 'home': go('#home'); break;
    case 'start': startFresh(); break;
    case 'resume': resume(); break;
    case 'restart-confirm': restartConfirm(); break;
    case 'restart': startFresh(); break;
    case 'roster': go('#roster'); break;
    case 'about': about(); break;
    case 'operator': operatorModal(button.dataset.id); break;
    case 'close-modal': document.querySelector('#modal').close(); break;
    case 'answer': {
      const q = data.questions[index]; answers[q.id] = button.dataset.id; persist(); renderQuiz(false);
      app.querySelector(`[data-action="answer"][data-id="${button.dataset.id}"]`)?.focus({ preventScroll: true }); break;
    }
    case 'previous': index = Math.max(0, index - 1); persist(); renderQuiz(); break;
    case 'next':
      if (!answers[data.questions[index].id]) return;
      if (index < data.questions.length - 1) { index++; persist(); renderQuiz(); }
      else if (complete()) go(`#result=${encodeProfile(calculateProfile(data.questions, answers).raw)}`);
      else { index = data.questions.findIndex(q => !answers[q.id]); persist(); renderQuiz(); toast('还有未完成的题目，先把它补上吧。'); }
      break;
    case 'jump': index = Number(button.dataset.index); persist(); renderQuiz(); break;
    case 'review-answers': index = 0; go('#quiz'); break;
    case 'share': await share(); break;
    case 'export': await exportCard(); break;
  }
});
document.addEventListener('input', event => {
  if (event.target.dataset.input === 'nickname') nickname = event.target.value;
  if (event.target.dataset.input === 'search') {
    const term = event.target.value;
    document.querySelector('#roster-grid').innerHTML = rosterCards(term);
    document.querySelector('#roster-count').textContent = `${data.operators.filter(o => `${o.name}${o.title}${o.id}`.toLowerCase().includes(term.toLowerCase())).length} 位干员`;
  }
});
document.addEventListener('keydown', event => {
  if (route !== 'quiz' || document.querySelector('#modal').open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (/^[1-4]$/.test(event.key)) { event.preventDefault(); app.querySelectorAll('[data-action="answer"]')[Number(event.key) - 1]?.click(); }
});
document.querySelector('#modal').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
app.addEventListener('error', event => { if (event.target.tagName === 'IMG') { event.target.hidden = true; event.target.parentElement.classList.add('image-missing'); } }, true);
window.addEventListener('hashchange', () => { if (data) renderRoute(); });
try {
  const [response, assetResponse] = await Promise.all([fetch('./data.json'), fetch('./assets-manifest.json').catch(() => null)]);
  if (!response.ok) throw Error('内容加载失败');
  data = await response.json();
  if (assetResponse?.ok) assets = await assetResponse.json();
  restore(); renderRoute();
} catch {
  app.innerHTML = '<section class="shell error-state"><p class="eyebrow">A SHORT PAUSE</p><h1>档案暂时没有送达。</h1><p>请检查网络，刷新后再试一次。已经保存的答题进度会留在本机。</p><button class="button button-primary" onclick="location.reload()">重新加载 →</button></section>';
}
