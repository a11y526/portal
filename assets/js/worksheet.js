// 개인 학습지(웹판): 관리 화면에서 올린 HTML 읽기 + 반 페이지에서 쪽 그리기
// 웹판 규칙은 ../학습지_웹판_규칙.md (section.page[data-slide][data-title], .bl .ox .ineq .box .fill)
// 정답은 key에만 담아 서버에 저장하고, 화면용 html에서는 칸 자리를 <span data-ws="f1"></span>으로 바꿔 정답을 뺀다
// 시뮬레이션 칸 <div class="sim" data-src="sims/…html">은 칸(field)이 아니다. <div class="w-sim" data-sim="sims/…">으로만 남기고,
// 반 페이지에서 [시뮬레이션 열기]를 누를 때 sandbox iframe으로 연다(학습지 안의 script·iframe은 계속 지운다)

const FIELD = '.bl, .ox, .ineq .box, .fill';
const SYMS = { '<': '<', '＜': '<', '〈': '<', '=': '=', '＝': '=', '>': '>', '＞': '>', '〉': '>' };
export const SYM_OPTIONS = ['<', '=', '>'];
export const TYPE_NAME = { blank: '빈칸', choice: '고르기', sym: '부등호', text: '서술' };

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
    const count = { blank: 0, choice: 0, sym: 0, text: 0 };
    let missing = 0;
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
        } else {
          const s = SYMS[squash(el.textContent)];
          spec = { type: 'sym', options: SYM_OPTIONS, answers: s ? [s] : [] };
          if (!s) missing++;
        }
        count[spec.type]++;
        key[k] = spec;
        fields.push({ key: k, type: spec.type, ...(spec.options ? { options: spec.options } : {}) });
        el.replaceWith(mark);
      });
    if (missing) warn.push(`정답이 빠진 칸 ${missing}개 (채우기만 하면 맞음으로 처리돼요)`);
    if (!fields.length && !simCount) warn.push('칸이 없는 쪽이에요');

    const box = doc.createElement('div');
    box.append(...sec.childNodes);
    sanitize(box);
    pages.push({ slide: Number.isFinite(slide) ? slide : si + 1, title: pageTitle, html: box.innerHTML.trim(), fields });
    report.push({ slide: Number.isFinite(slide) ? slide : null, title: pageTitle, count, sims: simCount, warn, open: fields.filter((f) => f.type === 'choice' && !key[f.key].answers.length).length });
  });

  return { title, pages, key, report, fieldCount: n, sims: [...sims] };
}

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
    if (el.tagName !== 'SPAN') {
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
export function markFields(box, bad) {
  box.querySelectorAll('[data-k]').forEach((el) => {
    if (el.classList.contains('ws-opt')) return;
    const st = bad?.[el.dataset.k];
    el.classList.toggle('is-wrong', st === 'wrong');
    el.classList.toggle('is-empty', st === 'empty');
  });
}
