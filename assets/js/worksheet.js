// 개인 학습지(웹판): 관리 화면에서 올린 HTML 읽기 + 반 페이지에서 쪽 그리기
// 웹판 규칙은 ../학습지_웹판_규칙.md (section.page[data-slide][data-title], .bl .ox .ineq .box .fill)
// 정답은 key에만 담아 서버에 저장하고, 화면용 html에서는 칸 자리를 <span data-ws="f1"></span>으로 바꿔 정답을 뺀다
// 시뮬레이션 칸 <div class="sim" data-src="sims/…html">은 칸(field)이 아니다. <div class="w-sim" data-sim="sims/…">으로만 남기고,
// 반 페이지에서 [시뮬레이션 열기]를 누를 때 sandbox iframe으로 연다(학습지 안의 script·iframe은 계속 지운다)
// 점 찍기 칸 <div class="plot" data-x… data-points="x,y|x,y">: 축 정보는 fields에, 정답 점·허용 오차는 key에만.
// 학생 답은 "x,y|x,y"(x 오름차순) 문자열. 채점은 서버(_ws_plot)가 정답 점마다 오차 안의 학생 점을 하나씩 짝짓는다

const FIELD = '.bl, .ox, .ineq .box, .fill, .plot';
const SYMS = { '<': '<', '＜': '<', '〈': '<', '=': '=', '＝': '=', '>': '>', '＞': '>', '〉': '>' };
export const SYM_OPTIONS = ['<', '=', '>'];
export const TYPE_NAME = { blank: '빈칸', choice: '고르기', sym: '부등호', text: '서술', plot: '점 찍기' };
const PLOT_MAX = 300; // 서버가 한 칸 답을 300자까지 저장한다(_ws_clean)

// 화면에 남길 태그 (그 밖의 태그는 글자만 남기고, 아래 태그는 통째로 뺀다)
const KEEP = new Set(['DIV', 'SPAN', 'P', 'H2', 'H3', 'H4', 'B', 'STRONG', 'I', 'EM', 'SMALL', 'BR', 'U', 'SUB', 'SUP',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'COLGROUP', 'COL', 'UL', 'OL', 'LI', 'IMG', 'FIGURE', 'FIGCAPTION', 'SECTION']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TITLE', 'TEMPLATE', 'FORM', 'INPUT', 'BUTTON',
  'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'CANVAS', 'NOSCRIPT', 'BASE', 'FRAME', 'FRAMESET', 'HEAD']);
const ATTRS = new Set(['class', 'colspan', 'rowspan', 'alt', 'data-ws']);
export const SIM_SRC = /^sims\/[A-Za-z0-9_-]+\.html$/;
const PORTAL_ROOT = new URL('../../', import.meta.url); // assets/js/ → 포털 맨 위
export const simHref = (src) => new URL(src, PORTAL_ROOT).href;
const DATA_IMG = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i;

const squash = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

// 남겨도 되는 태그·속성만. 학습지의 class는 앞에 'w-'를 붙여 사이트 CSS(.hidden, .btn 등)와 섞이지 않게
// (반 페이지에서 저장된 html을 다시 거를 때는 prefix: false — 이미 붙어 있다)
export function sanitize(root, { prefix = true } = {}) {
  [...root.querySelectorAll('*')].forEach((el) => {
    if (!root.contains(el)) return; // 앞에서 통째로 뺀 태그 안에 있던 것
    const tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) { el.remove(); return; }
    if (!KEEP.has(tag)) { el.replaceWith(...el.childNodes); return; }
    [...el.attributes].forEach((a) => {
      const name = a.name.toLowerCase();
      if (tag === 'IMG' && name === 'src' && DATA_IMG.test(a.value)) return;
      if (tag === 'DIV' && name === 'data-sim' && SIM_SRC.test(a.value)) return;
      if (!ATTRS.has(name)) el.removeAttribute(a.name);
    });
    if (tag === 'IMG' && !el.hasAttribute('src')) { el.remove(); return; }
    if (el.hasAttribute('data-sim')) { el.setAttribute('class', 'w-sim'); el.replaceChildren(); return; }
    if (el.hasAttribute('class') && !el.hasAttribute('data-ws')) {
      const cls = el.getAttribute('class').split(/\s+/).filter((c) => /^[a-z0-9_-]+$/i.test(c))
        .map((c) => (prefix ? 'w-' + c : c)).filter((c) => c.startsWith('w-')).join(' ');
      if (cls) el.setAttribute('class', cls); else el.removeAttribute('class');
    }
  });
  // 주석도 뺀다
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.remove());
  return root;
}

/* =========================================================
   관리 화면: 웹판 HTML → { title, pages, key, report }
   pages: [{ slide, title, html, fields: [{ key, type, options }] }]
   key:   { f1: { type, answers, options } }
   report: 쪽마다 칸 종류별 개수, 시뮬레이션 수와 경고(정답 빠진 칸 등)
   sims: 학습지에 든 시뮬레이션 주소(sims/…, 겹치지 않게)
   읽을 수 없으면 Error(이유)
   ========================================================= */
export function parseWorksheet(text) {
  const doc = new DOMParser().parseFromString(String(text || ''), 'text/html');
  const sections = [...doc.querySelectorAll('section.page')];
  if (!sections.length) throw new Error('section class="page"가 없어요. 학습지 웹판 규칙대로 만든 파일인지 확인해 주세요');

  const title = squash(doc.querySelector('title')?.textContent) || squash(doc.querySelector('h1')?.textContent);
  const pages = [];
  const key = {};
  const report = [];
  let n = 0;
  const seen = new Set();
  const sims = new Set();

  sections.forEach((sec, si) => {
    const slide = parseInt(sec.dataset.slide, 10);
    const pageTitle = squash(sec.dataset.title) || squash(sec.querySelector('h3, h2')?.textContent);
    const warn = [];
    if (!Number.isFinite(slide)) warn.push('data-slide(수업자료 쪽 번호)가 없어요');
    else if (seen.has(slide)) warn.push(`${slide}쪽이 두 번 나와요`);
    if (Number.isFinite(slide)) seen.add(slide);

    // 정답판에만 있는 표시(정답 글, '정답' 꼬리표)는 뺀다
    const extra = sec.querySelectorAll('.ans, .key-tag');
    if (extra.length) warn.push(`정답 표시(.ans, .key-tag) ${extra.length}개는 학생 화면에서 뺐어요`);
    extra.forEach((x) => x.remove());

    // 시뮬레이션: sims/ 폴더의 영어 이름 파일만. 칸 키(f1…) 매기기 전에 바꿔 두지만 칸이 아니므로 키는 그대로
    let simCount = 0;
    sec.querySelectorAll('[data-sim]').forEach((el) => el.removeAttribute('data-sim')); // .sim 칸으로만 만든다
    sec.querySelectorAll('.sim').forEach((el) => {
      const src = String(el.getAttribute('data-src') || '').trim();
      if (el.tagName !== 'DIV' || !SIM_SRC.test(src)) {
        warn.push(`시뮬레이션 주소가 규칙에 맞지 않아 뺐어요: ${src || '(주소 없음)'} (sims/영어이름.html만 됨)`);
        el.remove();
        return;
      }
      const box = doc.createElement('div');
      box.setAttribute('class', 'sim');
      box.setAttribute('data-sim', src);
      el.replaceWith(box);
      sims.add(src);
      simCount++;
    });

    const fields = [];
    const count = { blank: 0, choice: 0, sym: 0, text: 0, plot: 0 };
    let missing = 0;
    let plotPoints = 0;
    [...sec.querySelectorAll(FIELD)]
      .filter((el) => !el.parentElement.closest(FIELD))
      .forEach((el) => {
        const k = 'f' + (++n);
        const mark = doc.createElement('span');
        mark.setAttribute('data-ws', k);
        let spec;
        if (el.matches('.bl')) {
          const answers = [squash(el.textContent), ...String(el.dataset.alt || '').split('|').map(squash)].filter(Boolean);
          spec = { type: 'blank', answers: [...new Set(answers)] };
          if (!spec.answers.length) missing++;
          if (el.classList.contains('s')) mark.setAttribute('class', 's');
          if (el.classList.contains('l')) mark.setAttribute('class', 'l');
        } else if (el.matches('.ox')) {
          const opts = [...el.querySelectorAll('i')];
          const options = opts.map((i) => squash(i.textContent)).filter(Boolean);
          spec = { type: 'choice', options, answers: opts.filter((i) => i.classList.contains('ok')).map((i) => squash(i.textContent)).filter(Boolean) };
          if (options.length < 2) warn.push(`보기가 ${options.length}개인 고르기가 있어요`);
        } else if (el.matches('.fill')) {
          spec = { type: 'text', answers: [squash(el.textContent)].filter(Boolean) };
        } else if (el.matches('.plot')) {
          const p = parsePlot(el);
          spec = { type: 'plot', points: p.points, tol: p.tol, axis: p.axis };
          warn.push(...p.warn);
          if (!p.points.length) missing++;
          plotPoints += p.points.length;
        } else {
          const s = SYMS[squash(el.textContent)];
          spec = { type: 'sym', options: SYM_OPTIONS, answers: s ? [s] : [] };
          if (!s) missing++;
        }
        count[spec.type]++;
        key[k] = spec;
        fields.push({ key: k, type: spec.type, ...(spec.options ? { options: spec.options } : {}), ...(spec.axis ? { axis: spec.axis } : {}) });
        el.replaceWith(mark);
      });
    if (missing) warn.push(`정답이 빠진 칸 ${missing}개 (채우기만 하면 맞음으로 처리돼요)`);
    if (!fields.length && !simCount) warn.push('칸이 없는 쪽이에요');

    const box = doc.createElement('div');
    box.append(...sec.childNodes);
    sanitize(box);
    pages.push({ slide: Number.isFinite(slide) ? slide : si + 1, title: pageTitle, html: box.innerHTML.trim(), fields });
    report.push({ slide: Number.isFinite(slide) ? slide : null, title: pageTitle, count, sims: simCount, warn, plotPoints,
      open: fields.filter((f) => f.type === 'choice' && !key[f.key].answers.length).length });
  });

  return { title, pages, key, report, fieldCount: n, sims: [...sims] };
}

/* ---------- 점 찍기 칸 읽기 ----------
   축: data-x(제목) data-x-min/max/step, data-snap-x(찍을 때 반올림 단위, 없으면 눈금의 1/10), y도 같게
   data-tol-x/y: 허용 오차(없으면 눈금의 1/4). data-points: 정답 점 "x,y|x,y" */
const decimals = (v) => { const s = String(v); return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0; };
const roundTo = (v, unit) => Number((Math.round(v / unit) * unit).toFixed(Math.min(6, decimals(unit))));

function parsePlot(el) {
  const warn = [];
  const num = (name) => {
    const raw = el.getAttribute(name);
    const v = raw == null || raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  const axisOf = (a) => {
    const min = num(`data-${a}-min`);
    const max = num(`data-${a}-max`);
    const step = num(`data-${a}-step`);
    if (min == null || max == null || step == null || max <= min || step <= 0 || (max - min) / step > 50) {
      warn.push(`점 찍기 칸의 ${a}축 범위(data-${a}-min, data-${a}-max, data-${a}-step)가 없거나 잘못됐어요`);
      return { label: squash(el.getAttribute(`data-${a}`)), min: 0, max: 10, step: 1, snap: 0.1 };
    }
    const snap = num(`data-snap-${a}`);
    return { label: squash(el.getAttribute(`data-${a}`)), min, max, step, snap: snap > 0 ? snap : step / 10 };
  };
  if (el.tagName !== 'DIV') warn.push('점 찍기 칸(.plot)은 <div>로 써야 해요');
  const axis = { x: axisOf('x'), y: axisOf('y') };
  if (!axis.x.label || !axis.y.label) warn.push('점 찍기 칸의 축 제목(data-x, data-y)이 비었어요');
  const tx = num('data-tol-x');
  const ty = num('data-tol-y');
  const tol = { x: tx >= 0 ? tx : axis.x.step / 4, y: ty >= 0 ? ty : axis.y.step / 4 };

  const raw = String(el.getAttribute('data-points') || '').trim();
  const points = [];
  let bad = 0;
  raw.split('|').map((s) => s.trim()).filter(Boolean).forEach((s) => {
    const m = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    const x = m ? Number(m[1]) : NaN;
    const y = m ? Number(m[2]) : NaN;
    if (!m || x < axis.x.min || x > axis.x.max || y < axis.y.min || y > axis.y.max) bad++;
    else points.push([x, y]);
  });
  if (!raw) warn.push('점 찍기 칸의 정답 점(data-points)이 비었어요');
  else if (bad) warn.push(`점 찍기 칸의 정답 점 ${bad}개를 읽지 못했거나 축 범위 밖이에요 (data-points="x,y|x,y")`);
  return { axis, tol, points, warn };
}

// "x,y|x,y" → [[x, y], …] (읽을 수 없는 조각은 뺀다)
export function plotPoints(v) {
  return String(v || '').split('|').map((s) => s.split(',').map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite));
}
const plotValue = (pts) => [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((p) => `${p[0]},${p[1]}`).join('|');

/* =========================================================
   반 페이지: 한 쪽 그리기
   칸 자리(<span data-ws>)를 입력칸·보기 버튼으로 바꾼다
   ========================================================= */
export function renderPage(box, page, answers, { locked = false } = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = page?.html || '';
  const frag = tpl.content;
  const wrap = document.createElement('div');
  wrap.append(frag);
  sanitize(wrap, { prefix: false });
  const byKey = new Map((page?.fields ?? []).map((f) => [f.key, f]));
  let no = 0;
  wrap.querySelectorAll('[data-ws]').forEach((mark) => {
    const f = byKey.get(mark.dataset.ws);
    if (!f) { mark.remove(); return; }
    no++;
    const v = answers?.[f.key] ?? '';
    let el;
    if (f.type === 'choice' || f.type === 'sym') {
      el = document.createElement('span');
      el.className = `ws-ox${f.type === 'sym' ? ' ws-sym' : ''}`;
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', `${no}번 칸`);
      (f.options ?? []).forEach((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ws-opt press';
        b.dataset.k = f.key;
        b.dataset.v = o;
        b.textContent = o;
        b.setAttribute('aria-pressed', String(v === o));
        b.disabled = locked;
        el.append(b);
      });
    } else if (f.type === 'plot') {
      el = buildPlot(f, v, locked, no);
    } else if (f.type === 'text') {
      el = document.createElement('textarea');
      el.className = 'input ws-in ws-fill';
      el.rows = 2;
      el.maxLength = 300;
    } else {
      el = document.createElement('input');
      el.type = 'text';
      el.className = `input ws-in ws-bl${/\bs\b/.test(mark.className) ? ' ws-s' : ''}${/\bl\b/.test(mark.className) ? ' ws-l' : ''}`;
      el.maxLength = 40;
      el.autocomplete = 'off';
      el.spellcheck = false;
    }
    el.dataset.k = f.key;
    if (el.tagName !== 'SPAN' && f.type !== 'plot') {
      el.value = v;
      el.disabled = locked;
      el.setAttribute('aria-label', `${no}번 칸`);
    }
    mark.replaceWith(el);
  });
  // 시뮬레이션 자리: 카드 + [시뮬레이션 열기]. iframe은 누를 때만 만든다
  const pg = String(page?.slide ?? '');
  wrap.querySelectorAll('.w-sim[data-sim]').forEach((el, i) => {
    const card = document.createElement('div');
    card.className = 'ws-sim';
    card.dataset.sim = el.dataset.sim;
    card.dataset.id = `${pg}-${i}`;
    card.innerHTML = SIM_BAR;
    el.replaceWith(card);
  });
  // 같은 쪽을 다시 그릴 때(제출 결과 등)는 열어 둔 시뮬레이션 칸을 열린 채로 옮긴다(옮기면 처음부터 다시 시작). 다른 쪽이면 replaceChildren으로 사라진다
  const open = box.querySelector('.ws-sim.is-open');
  if (open) {
    const same = wrap.querySelector(`.ws-sim[data-id="${CSS.escape(open.dataset.id)}"]`);
    if (same && same.dataset.sim === open.dataset.sim) same.replaceWith(open);
  }
  if (!box.dataset.simBound) {
    box.dataset.simBound = '1';
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sim-act]');
      if (!b || !box.contains(b)) return;
      const card = b.closest('.ws-sim');
      if (b.dataset.simAct === 'open') openSim(card);
      else closeSims(box);
    });
  }
  box.replaceChildren(...wrap.childNodes);
}

/* ---------- 점 찍기 칸 ----------
   SVG 한 장(격자·눈금·축 제목)에 점을 찍는다. 빈 곳을 누르면 찍고(snap 단위로 반올림), 찍은 점 가까이(14px)를 누르면 지운다.
   바뀌면 el.value("x,y|x,y", x 오름차순)를 바꾸고 input 이벤트를 낸다(반 페이지가 다른 칸과 똑같이 저장).
   글자가 14px 밑으로 작아지지 않게 viewBox를 좁게(320, 휴대폰 375px에서 칸 너비 약 290px) 잡고, 화면에서는 최대 480px까지만 늘린다 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const PW = 320;
const PH = 300;
const PAD = { l: 62, r: 14, t: 14, b: 54 };
const HIT_PX = 14;
const fmt = (v) => String(Number(v.toFixed(6)));

function svgEl(tag, attrs, parent) {
  const n = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  if (parent) parent.append(n);
  return n;
}

function buildPlot(f, value, locked, no) {
  const { x: ax, y: ay } = f.axis;
  const sx = (v) => PAD.l + ((v - ax.min) / (ax.max - ax.min)) * (PW - PAD.l - PAD.r);
  const sy = (v) => PH - PAD.b - ((v - ay.min) / (ay.max - ay.min)) * (PH - PAD.t - PAD.b);
  const wrap = document.createElement('div');
  wrap.className = 'ws-in ws-plot';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', `${no}번 칸: ${ax.label}–${ay.label} 그래프`);
  wrap.value = String(value || '');
  if (locked) wrap.dataset.locked = '1';

  const svg = svgEl('svg', { viewBox: `0 0 ${PW} ${PH}`, class: 'ws-plot-svg', 'aria-hidden': 'true' }, wrap);
  const grid = svgEl('g', { class: 'ws-plot-grid' }, svg);
  const ticks = svgEl('g', { class: 'ws-plot-tick' }, svg);
  const nx = Math.round((ax.max - ax.min) / ax.step);
  const ny = Math.round((ay.max - ay.min) / ay.step);
  for (let i = 0; i <= nx; i++) {
    const v = ax.min + i * ax.step;
    const x = sx(v);
    if (i) svgEl('line', { x1: x, y1: PAD.t, x2: x, y2: PH - PAD.b }, grid);
    svgEl('text', { x, y: PH - PAD.b + 20, 'text-anchor': 'middle' }, ticks).textContent = fmt(v);
  }
  for (let i = 0; i <= ny; i++) {
    const v = ay.min + i * ay.step;
    const y = sy(v);
    if (i) svgEl('line', { x1: PAD.l, y1: y, x2: PW - PAD.r, y2: y }, grid);
    svgEl('text', { x: PAD.l - 6, y: y + 5, 'text-anchor': 'end' }, ticks).textContent = fmt(v);
  }
  svgEl('path', { class: 'ws-plot-axis', d: `M${PAD.l} ${PAD.t - 6}V${PH - PAD.b}H${PW - PAD.r + 6}` }, svg);
  svgEl('text', { class: 'ws-plot-label', x: (PAD.l + PW - PAD.r) / 2, y: PH - 6, 'text-anchor': 'middle' }, svg).textContent = ax.label;
  const cy = (PAD.t + PH - PAD.b) / 2;
  svgEl('text', { class: 'ws-plot-label', x: 16, y: cy, 'text-anchor': 'middle', transform: `rotate(-90 16 ${cy})` }, svg).textContent = ay.label;
  const layer = svgEl('g', { class: 'ws-plot-pts' }, svg);

  const bar = document.createElement('div');
  bar.className = 'ws-plot-bar';
  bar.innerHTML = `
    <span class="ws-plot-n num" aria-live="polite"></span>
    <button type="button" class="btn btn-line press ws-plot-btn" data-plot-act="undo">되돌리기</button>
    <button type="button" class="btn btn-line press ws-plot-btn" data-plot-act="clear">모두 지우기</button>`;
  wrap.append(bar);

  let pts = plotPoints(wrap.value);
  let order = pts.map((p) => p.join(',')); // 찍은 순서(되돌리기용). 저장된 값에서 시작하면 x 순서

  const draw = () => {
    layer.replaceChildren();
    pts.forEach((p, i) => {
      const g = svgEl('g', { class: 'ws-pt', 'data-i': i, transform: `translate(${sx(p[0])} ${sy(p[1])})` }, layer);
      svgEl('circle', { class: 'ws-pt-dot', r: 6 }, g);
      svgEl('path', { class: 'ws-pt-x', d: 'M-6 -6L6 6M6 -6L-6 6' }, g);
    });
    bar.querySelector('.ws-plot-n').textContent = `점 ${pts.length}개`;
    bar.querySelectorAll('button').forEach((b) => { b.disabled = locked || !pts.length; });
  };
  const commit = (next) => {
    pts = next;
    const v = plotValue(pts);
    pts = plotPoints(v);
    wrap.value = v;
    draw();
    wrap.dispatchEvent(new Event('input', { bubbles: true }));
  };

  svg.addEventListener('click', (e) => {
    if (locked) return;
    const m = svg.getScreenCTM();
    if (!m) return;
    const scale = m.a || 1; // 화면 px / viewBox 단위
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    // 가까운 점이 있으면 지운다
    let near = -1;
    let best = HIT_PX / scale;
    pts.forEach((p, i) => {
      const d = Math.hypot(sx(p[0]) - pt.x, sy(p[1]) - pt.y);
      if (d <= best) { best = d; near = i; }
    });
    if (near >= 0) {
      const id = pts[near].join(',');
      order = order.filter((o) => o !== id);
      commit(pts.filter((_, i) => i !== near));
      return;
    }
    const slack = HIT_PX / scale;
    if (pt.x < PAD.l - slack || pt.x > PW - PAD.r + slack || pt.y < PAD.t - slack || pt.y > PH - PAD.b + slack) return;
    const clamp = (v, a) => Math.min(a.max, Math.max(a.min, v));
    const x = clamp(roundTo(ax.min + ((pt.x - PAD.l) / (PW - PAD.l - PAD.r)) * (ax.max - ax.min), ax.snap), ax);
    const y = clamp(roundTo(ay.min + ((PH - PAD.b - pt.y) / (PH - PAD.t - PAD.b)) * (ay.max - ay.min), ay.snap), ay);
    const id = `${x},${y}`;
    if (order.includes(id) || pts.some((p) => p.join(',') === id)) return;
    const next = [...pts, [x, y]];
    if (plotValue(next).length > PLOT_MAX) return;
    order.push(id);
    commit(next);
  });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-plot-act]');
    if (!b || locked) return;
    if (b.dataset.plotAct === 'clear') { order = []; commit([]); return; }
    const last = order.pop() ?? (pts.length ? pts[pts.length - 1].join(',') : null);
    commit(pts.filter((p) => p.join(',') !== last));
  });
  draw();
  return wrap;
}

const SIM_BAR = `
  <div class="ws-sim-bar">
    <span class="ws-sim-t">시뮬레이션</span>
    <button type="button" class="btn btn-line press ws-sim-btn" data-sim-act="open">시뮬레이션 열기</button>
  </div>`;

// 한 번에 하나만: 다른 데 열린 것은 닫고 연다. allow-same-origin을 주지 않아 포털의 출입증·저장소에 손대지 못한다
function openSim(card) {
  closeSims(document);
  const frame = document.createElement('iframe');
  frame.className = 'ws-sim-frame';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', '시뮬레이션');
  frame.src = simHref(card.dataset.sim);
  card.classList.add('is-open');
  card.innerHTML = `
    <div class="ws-sim-bar">
      <span class="ws-sim-t">시뮬레이션</span>
      <button type="button" class="btn btn-line press ws-sim-btn" data-sim-act="close">닫기</button>
    </div>`;
  card.append(frame);
}

// root 안에서 열린 시뮬레이션을 모두 닫는다(iframe을 없애 멈춘다)
export function closeSims(root = document) {
  root.querySelectorAll('.ws-sim.is-open').forEach((card) => {
    card.classList.remove('is-open');
    card.innerHTML = SIM_BAR;
  });
}

// 틀리거나 빈 칸 표시 (bad: { f1: 'wrong' | 'empty' })
// 점 찍기 칸: points { f9: [틀린 점 순서] }가 있으면 그 점은 ×, 나머지는 ○. passed(맞은 칸 Set)에 든 칸은 모두 ○.
// 정답 점은 그리지 않는다
export function markFields(box, bad, { points = {}, passed = null } = {}) {
  box.querySelectorAll('[data-k]').forEach((el) => {
    if (el.classList.contains('ws-opt')) return;
    const k = el.dataset.k;
    const st = bad?.[k];
    el.classList.toggle('is-wrong', st === 'wrong');
    el.classList.toggle('is-empty', st === 'empty');
    if (!el.classList.contains('ws-plot')) return;
    const ok = !!passed?.has?.(k);
    const wrong = st === 'wrong' && Array.isArray(points[k]) ? new Set(points[k].map(Number)) : null;
    el.querySelectorAll('.ws-pt').forEach((p) => {
      const isBad = !ok && !!wrong?.has(Number(p.dataset.i));
      p.classList.toggle('is-bad', isBad);
      p.classList.toggle('is-ok', ok || (!!wrong && !isBad));
    });
  });
}
