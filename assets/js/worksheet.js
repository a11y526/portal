// 개인 학습지(웹판): 관리 화면에서 올린 HTML 읽기 + 반 페이지에서 쪽 그리기
// 웹판 규칙은 ../학습지_웹판_규칙.md (section.page[data-slide][data-title], .bl .ox .ineq .box .fill)
// 정답은 key에만 담아 서버에 저장하고, 화면용 html에서는 칸 자리를 <span data-ws="f1"></span>으로 바꿔 정답을 뺀다

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
      if (!ATTRS.has(name)) el.removeAttribute(a.name);
    });
    if (tag === 'IMG' && !el.hasAttribute('src')) { el.remove(); return; }
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
   report: 쪽마다 칸 종류별 개수와 경고(정답 빠진 칸 등)
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
    if (!fields.length) warn.push('칸이 없는 쪽이에요');

    const box = doc.createElement('div');
    box.append(...sec.childNodes);
    sanitize(box);
    pages.push({ slide: Number.isFinite(slide) ? slide : si + 1, title: pageTitle, html: box.innerHTML.trim(), fields });
    report.push({ slide: Number.isFinite(slide) ? slide : null, title: pageTitle, count, warn, open: fields.filter((f) => f.type === 'choice' && !key[f.key].answers.length).length });
  });

  return { title, pages, key, report, fieldCount: n };
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
  box.replaceChildren(...wrap.childNodes);
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
