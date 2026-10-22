// 퀴즈 쇼 공통: 문제 종류·시간·점수 이름, 보기 모양, 새 문제 기본값, 문제 확인, 그림 그리기
// 크리에이터(teacher/quizshow-edit), 프로젝터(teacher/quizshow), 학생(quizshow.html)이 같이 쓴다
import { esc } from './ui.js';
import { qsImageUrl } from './db.js';

export const TYPES = {
  quiz:   { name: '퀴즈',     desc: '보기 2~6개 중 고르기(하나 또는 여럿)' },
  tf:     { name: '참/거짓',  desc: '참 또는 거짓' },
  type:   { name: '답 입력',  desc: '짧은 답을 직접 쓰기' },
  slider: { name: '슬라이더', desc: '숫자를 밀어서 맞히기' },
  puzzle: { name: '퍼즐',     desc: '보기를 올바른 순서로' },
  pin:    { name: '핀 고정',  desc: '그림에서 위치 누르기' },
  slide:  { name: '슬라이드', desc: '설명 화면(답 없음)' },
};
export const TYPE_ORDER = ['quiz', 'tf', 'type', 'slider', 'puzzle', 'pin', 'slide'];

export const TIMES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
export const timeLabel = (s) => (s < 60 ? `${s}초` : s % 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s / 60}분`);

export const POINTS = { standard: '표준', double: '2배', none: '점수 없음' };

export const MAX_OPTIONS = 6;

// 보기 모양 6가지(색 + 모양으로 같이 구분)
const SHAPE_PATHS = [
  '<circle cx="12" cy="12" r="8"/>',
  '<path d="M12 3.5l9 16h-18z"/>',
  '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  '<path d="M12 2.5l9.5 9.5-9.5 9.5-9.5-9.5z"/>',
  '<path d="M12 2.8l2.7 5.9 6.4.7-4.8 4.3 1.4 6.3L12 16.8 6.3 20l1.4-6.3-4.8-4.3 6.4-.7z"/>',
  '<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/>',
];
export const SHAPE_NAMES = ['동그라미', '세모', '네모', '마름모', '별', '육각형'];
export const shapeSVG = (i, size = 28) =>
  `<svg class="qs-shape" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SHAPE_PATHS[i % 6]}</svg>`;

export function newQuestion(type = 'quiz') {
  const base = { type, text: '', image: null, ratio: null, time: 20, points: 'standard' };
  switch (type) {
    case 'quiz':   return { ...base, multi: false, options: [{ text: '' }, { text: '' }, { text: '' }, { text: '' }], correct: [] };
    case 'tf':     return { ...base, correct: [] };
    case 'type':   return { ...base, answers: [''] };
    case 'slider': return { ...base, slider: { min: 0, max: 100, step: 1, answer: 50, tol: 0, unit: '' } };
    case 'puzzle': return { ...base, options: [{ text: '' }, { text: '' }, { text: '' }, { text: '' }] };
    case 'pin':    return { ...base, pin: { x: 50, y: 50, r: 10 } };
    case 'slide':  return { ...base, body: '', points: 'none' };
  }
  return base;
}

// 종류를 바꿀 때: 글·그림·시간·점수는 남기고, 보기는 옮길 수 있으면 옮긴다
export function changeType(q, type) {
  const n = newQuestion(type);
  n.text = q.text;
  n.image = q.image;
  n.ratio = q.ratio;
  if (type !== 'slide') {
    n.time = q.time;
    n.points = q.points === 'none' && q.type === 'slide' ? 'standard' : q.points;
  }
  if ((type === 'quiz' || type === 'puzzle') && Array.isArray(q.options) && q.type !== 'tf') {
    const opts = q.options.map((o) => ({ text: o?.text ?? '', ...(type === 'quiz' && o?.image ? { image: o.image } : {}) }));
    n.options = opts.length >= 2 ? opts : n.options;
  }
  if (type === 'slide') n.body = q.body ?? '';
  return n;
}

// 판에서 빠지는 문제면 그 까닭(서버 _qs_snapshot과 같은 기준). 문제 글이 비었으면 그것도 알린다
export function problemOf(q) {
  if (!q) return '문제가 없어요';
  if (q.type !== 'slide' && !String(q.text ?? '').trim()) return '문제를 써 주세요';
  if (q.type === 'slide' && !String(q.text ?? '').trim() && !String(q.body ?? '').trim()) return '제목이나 내용을 써 주세요';
  switch (q.type) {
    case 'quiz': {
      const filled = (q.options ?? []).filter((o) => String(o?.text ?? '').trim() || o?.image);
      if (filled.length < 2) return '보기를 2개 이상 써 주세요';
      if (!(q.correct ?? []).length) return '정답을 골라 주세요';
      if ((q.correct ?? []).some((i) => !(String(q.options[i]?.text ?? '').trim() || q.options[i]?.image))) return '빈 보기가 정답으로 골라져 있어요';
      return '';
    }
    case 'tf': return (q.correct ?? []).length ? '' : '참인지 거짓인지 골라 주세요';
    case 'type': return (q.answers ?? []).some((a) => String(a ?? '').trim()) ? '' : '정답을 써 주세요';
    case 'slider': {
      const s = q.slider ?? {};
      if (![s.min, s.max, s.answer].every(Number.isFinite)) return '숫자를 모두 넣어 주세요';
      if (s.min >= s.max) return '최솟값이 최댓값보다 작아야 해요';
      if (s.answer < s.min || s.answer > s.max) return '정답이 범위 밖이에요';
      return '';
    }
    case 'puzzle': return (q.options ?? []).filter((o) => String(o?.text ?? '').trim()).length >= 2 ? '' : '보기를 2개 이상 써 주세요';
    case 'pin': return q.image ? '' : '그림을 넣고 정답 위치를 눌러 주세요';
  }
  return '';
}

// 판에 보낼 모양: 빈 보기를 빼고(정답 번호도 다시 매김), 숫자를 정리한다
export function cleanQuestion(q) {
  const out = { ...q, text: String(q.text ?? '').trim().slice(0, 200) };
  if (q.type === 'quiz') {
    const keep = [];
    (q.options ?? []).forEach((o, i) => { if (String(o?.text ?? '').trim() || o?.image) keep.push(i); });
    out.options = keep.map((i) => ({ text: String(q.options[i].text ?? '').trim().slice(0, 120), ...(q.options[i].image ? { image: q.options[i].image } : {}) }));
    out.correct = keep.map((i, n) => ((q.correct ?? []).includes(i) ? n : -1)).filter((n) => n >= 0);
    if (!out.multi && out.correct.length > 1) out.correct = out.correct.slice(0, 1);
  }
  if (q.type === 'puzzle') out.options = (q.options ?? []).filter((o) => String(o?.text ?? '').trim()).map((o) => ({ text: String(o.text).trim().slice(0, 120) }));
  if (q.type === 'type') out.answers = (q.answers ?? []).map((a) => String(a ?? '').trim().slice(0, 100)).filter(Boolean);
  if (q.type === 'slide') out.body = String(q.body ?? '').slice(0, 1000);
  return out;
}

export const imageURL = (path) => qsImageUrl(path);

// 그림의 세로/가로 비율(핀 고정 거리 계산용)
export async function imageRatio(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const r = bmp.height / bmp.width;
    bmp.close?.();
    return Math.round(r * 1000) / 1000;
  } catch {
    return 1;
  }
}

// 보기 칸 하나(프로젝터·학생 공통). extra: 오른쪽에 붙일 html(답 수, 체크 등)
export function optionHTML(o, i, { extra = '', cls = '', tag = 'div', attrs = '' } = {}) {
  const img = o?.image ? `<img class="qs-opt-img" src="${esc(imageURL(o.image))}" alt="" loading="lazy">` : '';
  return `<${tag} class="qs-opt qs-c${i % 6} ${cls}" ${attrs}>
    ${shapeSVG(i)}
    <span class="qs-opt-text">${img}${esc(o?.text ?? '')}</span>${extra}
  </${tag}>`;
}

export const sliderValue = (v, unit) => `${Number(v).toLocaleString('ko-KR')}${unit ? ' ' + esc(unit) : ''}`;

// 학습지 웹판(worksheets 줄)에서 문제 만들기: 빈칸 → 답 입력, 고르기 → 퀴즈, 부등호 → 퀴즈(<, =, >)
// 문제 글은 그 칸이 든 문장(가까운 문항 상자·표 줄)에서 칸을 ( )로 바꾼 글. 정답이 없는 칸은 뺀다
const CTX = '.w-q, .w-item, .w-qline, .w-ineq, li, p, .w-box, tr';
export function questionsFromWorksheet(ws) {
  const out = [];
  for (const page of ws?.pages ?? []) {
    const tpl = document.createElement('template');
    tpl.innerHTML = page.html || '';
    const wrap = document.createElement('div');
    wrap.append(tpl.content);
    wrap.querySelectorAll('.w-sim, img, script, style').forEach((e) => e.remove());
    for (const f of page.fields ?? []) {
      const key = ws.key?.[f.key];
      if (!key || !['blank', 'choice', 'sym'].includes(key.type)) continue;
      const answers = (key.answers ?? []).map((a) => String(a ?? '').trim()).filter(Boolean);
      if (!answers.length) continue;
      const mark = wrap.querySelector(`[data-ws="${CSS.escape(f.key)}"]`);
      let text = page.title || '';
      if (mark) {
        const box = (mark.parentElement?.closest(CTX) && wrap.contains(mark.parentElement.closest(CTX))) ? mark.parentElement.closest(CTX) : wrap;
        const copy = box.cloneNode(true);
        copy.querySelectorAll('[data-ws]').forEach((m) => { m.replaceWith(m.dataset.ws === f.key ? ' (    ) ' : ' … '); });
        const t = copy.textContent.replace(/\s+/g, ' ').trim();
        if (t) text = t;
      }
      text = text.slice(0, 200);
      if (key.type === 'blank') {
        out.push({ ...newQuestion('type'), text, answers: answers.slice(0, 4), time: 30 });
      } else {
        const opts = key.type === 'sym' ? ['<', '=', '>'] : (key.options ?? f.options ?? []).map(String);
        const correct = opts.map((o, i) => (answers.includes(o) ? i : -1)).filter((i) => i >= 0);
        if (opts.length < 2 || !correct.length || opts.length > MAX_OPTIONS) continue;
        out.push({ ...newQuestion('quiz'), text, options: opts.map((t) => ({ text: t })), correct: correct.slice(0, 1), time: 20 });
      }
    }
  }
  return out;
}

// 표 붙여 넣기(엑셀·구글 시트에서 복사): 한 줄에 '문제 [탭] 보기1 [탭] 보기2 [탭] 보기3 [탭] 보기4 [탭] 정답 번호(1~4, 여럿이면 1,3) [탭] 시간(초)'
// 보기가 '참'·'거짓'뿐이면 참/거짓, 보기가 하나뿐이면 답 입력
export function questionsFromTable(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const cells = line.split('\t').map((c) => c.trim());
    if (!cells[0]) continue;
    const [qText, ...rest] = cells;
    let time = 20;
    let correct = [];
    let opts = rest;
    // 끝에서부터: 시간(5~240), 정답 번호
    if (opts.length && /^\d+$/.test(opts[opts.length - 1]) && opts.length >= 3) {
      const t = Number(opts[opts.length - 1]);
      if (TIMES.includes(t) && /^[\d,\s]+$/.test(opts[opts.length - 2] ?? '')) { time = t; opts = opts.slice(0, -1); }
    }
    if (opts.length && /^[\d,\s]+$/.test(opts[opts.length - 1])) {
      correct = opts[opts.length - 1].split(/[,\s]+/).map(Number).filter((n) => n >= 1).map((n) => n - 1);
      opts = opts.slice(0, -1);
    }
    opts = opts.filter(Boolean).slice(0, MAX_OPTIONS);
    if (/^(제목|문제|question)$/i.test(qText) && !correct.length) continue; // 머리 줄
    if (opts.length === 1) {
      out.push({ ...newQuestion('type'), text: qText.slice(0, 200), answers: [opts[0]], time });
    } else if (opts.length === 2 && opts.join() === '참,거짓') {
      out.push({ ...newQuestion('tf'), text: qText.slice(0, 200), correct: correct.slice(0, 1), time });
    } else if (opts.length >= 2) {
      const c = correct.filter((i) => i < opts.length);
      out.push({ ...newQuestion('quiz'), text: qText.slice(0, 200), options: opts.map((t) => ({ text: t.slice(0, 120) })), correct: c, multi: c.length > 1, time });
    }
  }
  return out;
}
