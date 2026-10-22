// 퀴즈 쇼 만들기 (관리): 세트 목록 → 세트 편집(왼쪽 문제 목록, 가운데 문제, 오른쪽 속성). 바꾸면 잠시 뒤 저장.
// quizshow-edit.html?id=<세트>
import { CLASSES } from '../config.js';
import { toast, esc } from '../ui.js';
import {
  listQsSets, getQsSet, saveQsSet, deleteQsSet, qsImages, uploadQsImage, removeQsImages,
  listWorksheets, getWorksheetFull,
} from '../db.js';
import {
  TYPES, TYPE_ORDER, TIMES, timeLabel, POINTS, MAX_OPTIONS, shapeSVG, SHAPE_NAMES,
  newQuestion, changeType, problemOf, imageURL, imageRatio, questionsFromWorksheet, questionsFromTable,
} from '../quizshow.js';
import { shrinkPhoto } from '../posts.js';
import { teacherGate, errMsg } from '../gate.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const setId = params.get('id');
const SAVE_MS = 900;
const MAX_QUESTIONS = 100;

let set = null;          // { id, title, description, questions }
let cur = 0;             // 고르고 있는 문제
let saveTimer = null;
let saving = null;       // 저장 중인 Promise
let dirty = false;
let otherImages = [];    // 다른 세트가 쓰는 그림(지우지 않음)

const icon = {
  copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  del: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  img: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/></svg>',
  up: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

/* =========================================================
   세트 목록
   ========================================================= */
async function showList() {
  $('v-list').classList.remove('hidden');
  const sets = await listQsSets();
  const fmt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('sets').innerHTML = sets.length ? sets.map((s) => {
    const n = (s.questions ?? []).length;
    const bad = (s.questions ?? []).filter((q) => problemOf(q)).length;
    return `
      <article class="qse-set" data-id="${s.id}">
        <a class="qse-set-main" href="quizshow-edit.html?id=${s.id}">
          <b>${esc(s.title || '제목 없음')}</b>
          <span class="muted num">${n}문제${bad ? ` · <em class="qse-warn">고칠 문제 ${bad}</em>` : ''} · ${esc(fmt.format(new Date(s.updated_at)))}</span>
        </a>
        <div class="qse-set-btns">
          <button type="button" class="btn btn-line btn-small" data-act="copy">복사</button>
          <button type="button" class="btn btn-danger btn-small" data-act="del">삭제</button>
        </div>
      </article>`;
  }).join('') : '<div class="empty"><strong>아직 만든 퀴즈가 없어요</strong></div>';
  $('sets').onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const card = b.closest('[data-id]');
    const s = sets.find((x) => x.id === card.dataset.id);
    b.disabled = true;
    try {
      if (b.dataset.act === 'copy') {
        await saveQsSet(null, { title: `${s.title || '제목 없음'} (복사)`.slice(0, 80), description: s.description, questions: s.questions });
        toast('복사했어요', 'ok');
      } else {
        if (!confirm(`'${s.title || '제목 없음'}'을(를) 지울까요? 문제와 그림이 모두 지워져요.`)) return;
        const keep = sets.filter((x) => x.id !== s.id).flatMap((x) => qsImages(x.questions));
        await deleteQsSet(s, keep);
        toast('지웠어요', 'ok');
      }
      await showList();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      b.disabled = false;
    }
  };
}

$('new-set').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  try {
    const id = await saveQsSet(null, { title: '', description: '', questions: [newQuestion('quiz')] });
    location.href = `quizshow-edit.html?id=${id}`;
  } catch (err) {
    toast(errMsg(err), 'error');
    e.currentTarget.disabled = false;
  }
});

/* =========================================================
   저장 (바꾸고 잠시 뒤)
   ========================================================= */
function setSaveState(text, kind = '') {
  const el = $('save-state');
  el.textContent = text;
  el.dataset.kind = kind;
}

function touch() {
  dirty = true;
  setSaveState('저장 전');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_MS);
}

async function save() {
  clearTimeout(saveTimer);
  if (saving) { await saving; }
  if (!dirty) return;
  dirty = false;
  setSaveState('저장 중…');
  saving = saveQsSet(set.id, { title: set.title.slice(0, 80), description: set.description.slice(0, 500), questions: set.questions })
    .then(() => setSaveState('저장됨', 'ok'))
    .catch((err) => {
      dirty = true;
      setSaveState('저장 못 함', 'error');
      toast(errMsg(err), 'error');
      saveTimer = setTimeout(save, 5000);
    })
    .finally(() => { saving = null; });
  await saving;
}

addEventListener('beforeunload', (e) => {
  if (dirty || saving) { save(); e.preventDefault(); }
});

/* =========================================================
   편집 화면
   ========================================================= */
async function showEditor() {
  const s = await getQsSet(setId);
  if (!s) {
    toast('퀴즈를 찾지 못했어요', 'error');
    location.replace('quizshow-edit.html');
    return;
  }
  set = { id: s.id, title: s.title ?? '', description: s.description ?? '', questions: Array.isArray(s.questions) ? s.questions : [] };
  if (!set.questions.length) set.questions.push(newQuestion('quiz'));
  document.title = `${set.title || '제목 없음'} · 퀴즈 쇼`;
  $('v-edit').classList.remove('hidden');
  $('set-title').value = set.title;
  setSaveState('저장됨', 'ok');
  listQsSets().then((all) => { otherImages = all.filter((x) => x.id !== set.id).flatMap((x) => qsImages(x.questions)); }).catch(() => {});
  renderAll();
}

$('set-title').addEventListener('input', (e) => {
  set.title = e.target.value;
  document.title = `${set.title || '제목 없음'} · 퀴즈 쇼`;
  touch();
});

const q = () => set.questions[cur];

function renderAll() {
  renderItems();
  renderMain();
  renderProps();
}

/* ---------- 왼쪽: 문제 목록 ---------- */
function renderItems() {
  $('items').innerHTML = set.questions.map((x, i) => {
    const bad = problemOf(x);
    return `
      <li class="qse-item${i === cur ? ' on' : ''}" data-i="${i}" draggable="true">
        <button type="button" class="qse-item-main" data-pick="${i}" aria-current="${i === cur}">
          <span class="qse-item-no num">${i + 1}</span>
          <span class="qse-item-body">
            <small>${esc(TYPES[x.type]?.name ?? '')}${x.type !== 'slide' ? ` · ${timeLabel(x.time ?? 20)}` : ''}</small>
            <span class="qse-item-text">${esc(x.text || (x.type === 'slide' ? '제목 없음' : '문제 없음'))}</span>
          </span>
          ${x.image ? `<img class="qse-item-img" src="${esc(imageURL(x.image))}" alt="" loading="lazy">` : ''}
          ${bad ? `<span class="qse-item-bad" title="${esc(bad)}" aria-label="${esc(bad)}">!</span>` : ''}
        </button>
        <span class="qse-item-btns">
          <button type="button" class="qse-mini" data-dup="${i}" aria-label="${i + 1}번 복사">${icon.copy}</button>
          <button type="button" class="qse-mini" data-del="${i}" aria-label="${i + 1}번 삭제">${icon.del}</button>
        </span>
      </li>`;
  }).join('');
  $('add').disabled = set.questions.length >= MAX_QUESTIONS;
}

$('items').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-pick]');
  const dup = e.target.closest('[data-dup]');
  const del = e.target.closest('[data-del]');
  if (dup) {
    if (set.questions.length >= MAX_QUESTIONS) return;
    const i = Number(dup.dataset.dup);
    set.questions.splice(i + 1, 0, structuredClone(set.questions[i]));
    cur = i + 1;
    touch(); renderAll();
  } else if (del) {
    const i = Number(del.dataset.del);
    if (set.questions.length === 1) { toast('문제가 하나는 있어야 해요'); return; }
    if (!confirm(`${i + 1}번 문제를 지울까요?`)) return;
    const [gone] = set.questions.splice(i, 1);
    dropImages(qsImages([gone]));
    cur = Math.min(cur, set.questions.length - 1);
    touch(); renderAll();
  } else if (pick) {
    cur = Number(pick.dataset.pick);
    renderAll();
  }
});

// 끌어서 순서 바꾸기
let dragFrom = null;
$('items').addEventListener('dragstart', (e) => {
  const li = e.target.closest('.qse-item');
  if (!li) return;
  dragFrom = Number(li.dataset.i);
  e.dataTransfer.effectAllowed = 'move';
  li.classList.add('is-drag');
});
$('items').addEventListener('dragover', (e) => {
  if (dragFrom == null) return;
  e.preventDefault();
  const li = e.target.closest('.qse-item');
  $('items').querySelectorAll('.is-over').forEach((x) => x.classList.remove('is-over'));
  if (li) li.classList.add('is-over');
});
$('items').addEventListener('drop', (e) => {
  e.preventDefault();
  const li = e.target.closest('.qse-item');
  if (dragFrom == null || !li) return;
  move(dragFrom, Number(li.dataset.i));
});
$('items').addEventListener('dragend', () => {
  dragFrom = null;
  $('items').querySelectorAll('.is-drag, .is-over').forEach((x) => x.classList.remove('is-drag', 'is-over'));
});

function move(from, to) {
  if (from === to || to < 0 || to >= set.questions.length) return;
  const [it] = set.questions.splice(from, 1);
  set.questions.splice(to, 0, it);
  cur = to;
  touch(); renderAll();
}

/* ---------- 문제 종류 고르기 ---------- */
let typeMode = 'add'; // add | change
$('type-list').innerHTML = TYPE_ORDER.map((t) => `
  <button type="button" class="qse-type press" data-type="${t}">
    <b>${TYPES[t].name}</b><span class="muted">${TYPES[t].desc}</span>
  </button>`).join('');
$('type-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-type]');
  if (!b) return;
  if (typeMode === 'add') {
    const n = newQuestion(b.dataset.type);
    const prev = q();
    if (prev && prev.type !== 'slide' && n.type !== 'slide') n.time = prev.time;
    set.questions.splice(cur + 1, 0, n);
    cur += 1;
  } else {
    set.questions[cur] = changeType(q(), b.dataset.type);
  }
  $('type-dlg').close();
  touch(); renderAll();
  $('main').querySelector('.qse-q')?.focus();
});
$('add').addEventListener('click', () => { typeMode = 'add'; $('type-h').textContent = '문제 추가'; $('type-dlg').showModal(); });
document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

/* ---------- 가운데: 문제 ---------- */
function renderMain() {
  const x = q();
  const bad = problemOf(x);
  const isSlide = x.type === 'slide';
  $('main').innerHTML = `
    <div class="qse-card">
      <textarea class="input qse-q" data-f="text" rows="2" maxlength="200" placeholder="${isSlide ? '제목' : '질문을 입력하세요'}" aria-label="${isSlide ? '제목' : '질문'}">${esc(x.text ?? '')}</textarea>
      ${mediaHTML(x)}
      ${bodyHTML(x)}
      <p class="qse-problem${bad ? '' : ' hidden'}" role="status">${esc(bad)}</p>
    </div>`;
}

function mediaHTML(x) {
  if (!x.image) {
    return `
      <div class="qse-media qse-drop" data-drop="q">
        <button type="button" class="btn btn-line" data-upload="q">${icon.img}<span>그림 넣기</span></button>
        <span class="muted">${x.type === 'pin' ? '핀 고정은 그림이 있어야 해요' : '끌어다 놓거나 붙여 넣어도 돼요'}</span>
      </div>`;
  }
  const pin = x.type === 'pin' ? x.pin ?? { x: 50, y: 50, r: 10 } : null;
  return `
    <div class="qse-media has-img${pin ? ' is-pin' : ''}" data-drop="q">
      <div class="qse-img-box" ${pin ? 'data-pin-area' : ''}>
        <img src="${esc(imageURL(x.image))}" alt="">
        ${pin ? `<span class="qse-pin-zone" style="left:${pin.x}%;top:${pin.y}%;width:${pin.r * 2}%;"></span><span class="qse-pin-dot" style="left:${pin.x}%;top:${pin.y}%"></span>` : ''}
      </div>
      <div class="qse-img-btns">
        ${pin ? '<span class="muted">그림에서 정답 위치를 누르세요</span>' : ''}
        <button type="button" class="btn btn-line btn-small" data-upload="q">바꾸기</button>
        <button type="button" class="btn btn-line btn-small" data-unimg="q">빼기</button>
      </div>
    </div>`;
}

function bodyHTML(x) {
  switch (x.type) {
    case 'quiz': {
      const opts = x.options ?? [];
      return `
        <div class="qse-opts">
          ${opts.map((o, i) => `
            <div class="qse-opt qs-c${i % 6}${(x.correct ?? []).includes(i) ? ' is-ok' : ''}">
              <span class="qse-opt-shape" aria-hidden="true">${shapeSVG(i, 26)}</span>
              ${o.image ? `<img class="qse-opt-img" src="${esc(imageURL(o.image))}" alt="">` : ''}
              <input class="qse-opt-in" data-opt="${i}" maxlength="120" value="${esc(o.text ?? '')}" placeholder="${i + 1}번 보기${i >= 2 ? ' (선택)' : ''}" aria-label="${SHAPE_NAMES[i % 6]} ${i + 1}번 보기">
              <button type="button" class="qse-mini" data-upload="o${i}" aria-label="${i + 1}번 보기 그림">${icon.img}</button>
              ${o.image ? `<button type="button" class="qse-mini" data-unimg="o${i}" aria-label="${i + 1}번 보기 그림 빼기">${icon.x}</button>` : ''}
              <button type="button" class="qse-ok" data-ok="${i}" aria-pressed="${(x.correct ?? []).includes(i)}" aria-label="${i + 1}번을 정답으로">${icon.check}</button>
              ${opts.length > 2 ? `<button type="button" class="qse-mini" data-rmopt="${i}" aria-label="${i + 1}번 보기 지우기">${icon.del}</button>` : ''}
            </div>`).join('')}
        </div>
        ${opts.length < MAX_OPTIONS ? '<div><button type="button" class="btn btn-line btn-small" data-addopt>+ 보기 추가</button></div>' : ''}`;
    }
    case 'tf':
      return `
        <div class="qse-opts">
          ${['참', '거짓'].map((t, i) => `
            <div class="qse-opt qs-c${i}${(x.correct ?? []).includes(i) ? ' is-ok' : ''}">
              <span class="qse-opt-shape" aria-hidden="true">${shapeSVG(i, 26)}</span>
              <span class="qse-opt-in">${t}</span>
              <button type="button" class="qse-ok" data-ok="${i}" aria-pressed="${(x.correct ?? []).includes(i)}" aria-label="${t}을 정답으로">${icon.check}</button>
            </div>`).join('')}
        </div>`;
    case 'type': {
      const a = x.answers?.length ? x.answers : [''];
      return `
        <div class="qse-answers">
          <b>정답</b>
          ${a.map((v, i) => `
            <div class="qse-ans-row">
              <input class="input" data-ans="${i}" maxlength="100" value="${esc(v)}" placeholder="${i ? '다른 정답(선택)' : '정답'}" aria-label="정답 ${i + 1}">
              ${a.length > 1 ? `<button type="button" class="qse-mini" data-rmans="${i}" aria-label="정답 ${i + 1} 지우기">${icon.del}</button>` : ''}
            </div>`).join('')}
          ${a.length < 4 ? '<div><button type="button" class="btn btn-line btn-small" data-addans>+ 다른 정답</button></div>' : ''}
          <span class="muted">띄어쓰기와 영문 대소문자는 무시하고 채점해요</span>
        </div>`;
    }
    case 'slider': {
      const s = x.slider ?? {};
      const f = (k, label) => `<label class="field"><span>${label}</span><input class="input num" type="number" step="any" data-sl="${k}" value="${Number.isFinite(s[k]) ? s[k] : ''}"></label>`;
      return `
        <div class="qse-slider">
          <div class="qse-slider-grid">
            ${f('min', '최솟값')}${f('max', '최댓값')}${f('step', '눈금')}${f('answer', '정답')}${f('tol', '허용 오차(±)')}
            <label class="field"><span>단위</span><input class="input" data-sl="unit" maxlength="10" value="${esc(s.unit ?? '')}"></label>
          </div>
          <div class="qse-slider-prev">
            <input type="range" disabled min="${s.min ?? 0}" max="${s.max ?? 100}" step="${s.step || 1}" value="${s.answer ?? 0}" aria-hidden="true">
            <span class="num">정답 ${esc(String(s.answer ?? ''))}${esc(s.unit ? ' ' + s.unit : '')}${s.tol ? ` (±${esc(String(s.tol))})` : ''}</span>
          </div>
        </div>`;
    }
    case 'puzzle': {
      const opts = x.options ?? [];
      return `
        <div class="qse-puzzle">
          <b>맞는 순서대로 쓰세요 (학생 화면에서는 섞여 나와요)</b>
          ${opts.map((o, i) => `
            <div class="qse-pz-row qs-c${i % 6}">
              <span class="qse-pz-no num">${i + 1}</span>
              <input class="qse-opt-in" data-opt="${i}" maxlength="120" value="${esc(o.text ?? '')}" placeholder="${i + 1}번째" aria-label="${i + 1}번째">
              <button type="button" class="qse-mini" data-pzup="${i}" ${i ? '' : 'disabled'} aria-label="위로">${icon.up}</button>
              <button type="button" class="qse-mini" data-pzdown="${i}" ${i < opts.length - 1 ? '' : 'disabled'} aria-label="아래로">${icon.down}</button>
              ${opts.length > 2 ? `<button type="button" class="qse-mini" data-rmopt="${i}" aria-label="지우기">${icon.del}</button>` : ''}
            </div>`).join('')}
          ${opts.length < MAX_OPTIONS ? '<div><button type="button" class="btn btn-line btn-small" data-addopt>+ 보기 추가</button></div>' : ''}
        </div>`;
    }
    case 'pin': {
      const p = x.pin ?? { x: 50, y: 50, r: 10 };
      return `
        <label class="field qse-pin-r"><span>정답 범위(그림 너비의 %)</span>
          <span class="qse-range-row"><input type="range" min="3" max="40" step="1" data-pinr value="${p.r}"><b class="num" id="pin-r">${p.r}%</b></span>
        </label>`;
    }
    case 'slide':
      return `<textarea class="input qse-slide-body" data-f="body" rows="6" maxlength="1000" placeholder="내용(선택)" aria-label="내용">${esc(x.body ?? '')}</textarea>`;
  }
  return '';
}

// 고친 뒤 목록·경고만 다시 그린다(입력칸은 그대로 두어 커서가 튀지 않게)
function soft() {
  touch();
  renderItems();
  const bad = problemOf(q());
  const el = $('main').querySelector('.qse-problem');
  if (el) { el.textContent = bad; el.classList.toggle('hidden', !bad); }
}

$('main').addEventListener('input', (e) => {
  const x = q();
  const t = e.target;
  if (t.dataset.f) {
    x[t.dataset.f] = t.value;
    soft();
  } else if (t.dataset.opt != null) {
    x.options[Number(t.dataset.opt)].text = t.value;
    soft();
  } else if (t.dataset.ans != null) {
    x.answers = x.answers?.length ? x.answers : [''];
    x.answers[Number(t.dataset.ans)] = t.value;
    soft();
  } else if (t.dataset.sl) {
    x.slider = x.slider ?? {};
    const k = t.dataset.sl;
    x.slider[k] = k === 'unit' ? t.value : (t.value === '' ? null : Number(t.value));
    soft();
    const prev = $('main').querySelector('.qse-slider-prev span');
    const s = x.slider;
    if (prev) prev.textContent = `정답 ${s.answer ?? ''}${s.unit ? ' ' + s.unit : ''}${s.tol ? ` (±${s.tol})` : ''}`;
  } else if (t.dataset.pinr != null) {
    x.pin = { ...(x.pin ?? { x: 50, y: 50 }), r: Number(t.value) };
    $('pin-r').textContent = `${x.pin.r}%`;
    const z = $('main').querySelector('.qse-pin-zone');
    if (z) z.style.width = `${x.pin.r * 2}%`;
    touch();
  }
});

$('main').addEventListener('click', (e) => {
  const x = q();
  const b = (sel) => e.target.closest(sel);
  let el;
  if ((el = b('[data-ok]'))) {
    const i = Number(el.dataset.ok);
    const c = new Set(x.correct ?? []);
    if (x.type === 'quiz' && x.multi) { if (c.has(i)) c.delete(i); else c.add(i); }
    else { const had = c.has(i); c.clear(); if (!had) c.add(i); }
    x.correct = [...c].sort((a, z) => a - z);
    touch(); renderItems(); renderMain();
  } else if ((el = b('[data-addopt]'))) {
    x.options.push({ text: '' });
    touch(); renderAll();
    $('main').querySelector(`[data-opt="${x.options.length - 1}"]`)?.focus();
  } else if ((el = b('[data-rmopt]'))) {
    const i = Number(el.dataset.rmopt);
    const [gone] = x.options.splice(i, 1);
    if (gone?.image) dropImages([gone.image]);
    if (x.correct) x.correct = x.correct.filter((n) => n !== i).map((n) => (n > i ? n - 1 : n));
    touch(); renderAll();
  } else if ((el = b('[data-pzup]')) || (el = b('[data-pzdown]'))) {
    const i = Number(el.dataset.pzup ?? el.dataset.pzdown);
    const j = el.dataset.pzup != null ? i - 1 : i + 1;
    [x.options[i], x.options[j]] = [x.options[j], x.options[i]];
    touch(); renderMain(); renderItems();
  } else if ((el = b('[data-addans]'))) {
    x.answers = [...(x.answers ?? ['']), ''];
    touch(); renderMain();
    $('main').querySelector(`[data-ans="${x.answers.length - 1}"]`)?.focus();
  } else if ((el = b('[data-rmans]'))) {
    x.answers.splice(Number(el.dataset.rmans), 1);
    touch(); renderAll();
  } else if ((el = b('[data-upload]'))) {
    pickImage(el.dataset.upload);
  } else if ((el = b('[data-unimg]'))) {
    const where = el.dataset.unimg;
    if (where === 'q') { dropImages([x.image]); x.image = null; x.ratio = null; }
    else { const o = x.options[Number(where.slice(1))]; dropImages([o.image]); delete o.image; }
    touch(); renderAll();
  } else if ((el = b('[data-pin-area]'))) {
    const r = el.getBoundingClientRect();
    x.pin = { ...(x.pin ?? { r: 10 }), x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10 };
    touch(); renderMain(); renderItems();
  }
});

/* ---------- 그림 ---------- */
const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
document.body.append(fileInput);
let pickWhere = 'q';
function pickImage(where) {
  pickWhere = where;
  fileInput.value = '';
  fileInput.click();
}
fileInput.addEventListener('change', () => { if (fileInput.files[0]) putImage(fileInput.files[0], pickWhere); });

$('main').addEventListener('dragover', (e) => { if (e.target.closest('[data-drop]')) { e.preventDefault(); e.target.closest('[data-drop]').classList.add('is-over'); } });
$('main').addEventListener('dragleave', (e) => e.target.closest('[data-drop]')?.classList.remove('is-over'));
$('main').addEventListener('drop', (e) => {
  const z = e.target.closest('[data-drop]');
  if (!z) return;
  e.preventDefault();
  z.classList.remove('is-over');
  const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) putImage(f, 'q');
});
addEventListener('paste', (e) => {
  if (!set || e.target.closest?.('input, textarea')) return;
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); putImage(f, 'q'); }
});

let uploading = 0;
async function putImage(file, where) {
  if (!file.type.startsWith('image/')) { toast('그림 파일만 넣을 수 있어요', 'error'); return; }
  const qi = cur;
  const x = set.questions[qi];
  uploading++;
  setSaveState('그림 올리는 중…');
  try {
    const blob = await shrinkPhoto(file, where === 'q' ? 1600 : 800);
    const ratio = await imageRatio(blob);
    const path = await uploadQsImage(blob);
    if (where === 'q') {
      if (x.image) dropImages([x.image]);
      x.image = path;
      x.ratio = ratio;
    } else {
      const o = x.options?.[Number(where.slice(1))];
      if (!o) { dropImages([path]); return; }
      if (o.image) dropImages([o.image]);
      o.image = path;
    }
    touch();
    if (qi === cur) renderAll(); else renderItems();
  } catch (err) {
    toast(err?.message === 'BAD_IMAGE' ? '그림을 읽지 못했어요' : errMsg(err), 'error');
    setSaveState(dirty ? '저장 전' : '저장됨');
  } finally {
    uploading--;
  }
}

// 이 세트·다른 세트 어디에도 안 쓰는 그림만 지운다(저장한 뒤)
function dropImages(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  setTimeout(async () => {
    await save();
    const used = new Set([...qsImages(set.questions), ...otherImages]);
    removeQsImages(list.filter((p) => !used.has(p)));
  }, 0);
}

/* ---------- 오른쪽: 속성 ---------- */
function renderProps() {
  const x = q();
  const isSlide = x.type === 'slide';
  $('props').innerHTML = `
    <h2 class="qse-props-h">문항 속성</h2>
    <label class="field"><span>문제 종류</span>
      <button type="button" class="btn btn-line qse-type-btn" data-change-type>${esc(TYPES[x.type].name)}<small class="muted">바꾸기</small></button></label>
    ${isSlide ? '' : `
    <label class="field"><span>시간 제한</span>
      <select class="input" data-p="time">${TIMES.map((t) => `<option value="${t}"${t === x.time ? ' selected' : ''}>${timeLabel(t)}</option>`).join('')}</select></label>
    <button type="button" class="btn btn-line btn-small" data-all-time>모든 문제에 이 시간</button>
    <label class="field"><span>점수</span>
      <select class="input" data-p="points">${Object.entries(POINTS).map(([k, v]) => `<option value="${k}"${k === x.points ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <p class="muted qse-hint">${x.points === 'double' ? '맞히면 점수 2배' : x.points === 'none' ? '맞혀도 점수 없음(연속 정답에도 안 셈)' : '빨리 맞힐수록 높은 점수(최대 1000)'}</p>`}
    ${x.type === 'quiz' ? `
    <label class="field"><span>답 고르기</span>
      <select class="input" data-p="multi">
        <option value="0"${x.multi ? '' : ' selected'}>하나만 고르기</option>
        <option value="1"${x.multi ? ' selected' : ''}>여러 개 고르기(정답을 모두 골라야 맞음)</option>
      </select></label>` : ''}
    <div class="field"><span>순서</span>
      <div class="row-actions">
        <button type="button" class="btn btn-line btn-small" data-mv="-1" ${cur ? '' : 'disabled'}>${icon.up} 위로</button>
        <button type="button" class="btn btn-line btn-small" data-mv="1" ${cur < set.questions.length - 1 ? '' : 'disabled'}>${icon.down} 아래로</button>
      </div>
    </div>
    <div class="row-actions qse-props-end">
      <button type="button" class="btn btn-line btn-small" data-dup="${cur}">복사</button>
      <button type="button" class="btn btn-danger btn-small" data-del="${cur}">삭제</button>
    </div>`;
}

$('props').addEventListener('change', (e) => {
  const x = q();
  const k = e.target.dataset.p;
  if (!k) return;
  if (k === 'time') x.time = Number(e.target.value);
  if (k === 'points') x.points = e.target.value;
  if (k === 'multi') {
    x.multi = e.target.value === '1';
    if (!x.multi && (x.correct ?? []).length > 1) x.correct = x.correct.slice(0, 1);
    renderMain();
  }
  touch(); renderItems(); renderProps();
});
$('props').addEventListener('click', (e) => {
  const x = q();
  if (e.target.closest('[data-change-type]')) {
    typeMode = 'change';
    $('type-h').textContent = '문제 종류 바꾸기';
    $('type-dlg').showModal();
  } else if (e.target.closest('[data-all-time]')) {
    set.questions.forEach((y) => { if (y.type !== 'slide') y.time = x.time; });
    touch(); renderItems();
    toast(`모든 문제를 ${timeLabel(x.time)}로 바꿨어요`, 'ok');
  } else if (e.target.closest('[data-mv]')) {
    move(cur, cur + Number(e.target.closest('[data-mv]').dataset.mv));
  } else {
    // 복사·삭제는 왼쪽 목록과 같은 처리
    const b = e.target.closest('[data-dup], [data-del]');
    if (b) $('items').querySelector(`[data-${b.dataset.dup != null ? 'dup' : 'del'}="${cur}"]`)?.click();
  }
});

/* ---------- 설명 ---------- */
$('set-info').addEventListener('click', () => {
  $('info-form').elements.description.value = set.description;
  $('info-dlg').showModal();
});
$('info-dlg').addEventListener('close', () => {
  const v = $('info-form').elements.description.value;
  if (v !== set.description) { set.description = v; touch(); }
});

/* ---------- 가져오기 ---------- */
let impTab = 'ws';
let wsCache = new Map();
$('import').addEventListener('click', async () => {
  $('import-dlg').showModal();
  setImpTab(impTab);
  if (!$('imp-ws').options.length) {
    try {
      const list = (await listWorksheets()).sort((a, b) => String(a.lesson_code).localeCompare(String(b.lesson_code), 'ko', { numeric: true }));
      $('imp-ws').innerHTML = list.length
        ? list.map((w) => `<option value="${esc(w.lesson_code)}">${esc(w.lesson_code)} ${esc(w.title || '')}</option>`).join('')
        : '<option value="">올린 학습지가 없어요</option>';
      previewWs();
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  }
});
function setImpTab(t) {
  impTab = t;
  document.querySelectorAll('[data-imp]').forEach((b) => {
    b.classList.toggle('on', b.dataset.imp === t);
    b.setAttribute('aria-selected', String(b.dataset.imp === t));
  });
  document.querySelectorAll('[data-imp-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.impPane !== t));
}
document.querySelectorAll('[data-imp]').forEach((b) => b.addEventListener('click', () => setImpTab(b.dataset.imp)));

async function wsQuestions() {
  const code = $('imp-ws').value;
  if (!code) return [];
  if (!wsCache.has(code)) wsCache.set(code, questionsFromWorksheet(await getWorksheetFull(code)));
  return wsCache.get(code);
}
async function previewWs() {
  try {
    const list = await wsQuestions();
    const n = (t) => list.filter((x) => x.type === t).length;
    $('imp-ws-note').textContent = $('imp-ws').value
      ? `정답이 있는 빈칸 ${n('type')}개는 답 입력, 고르기·부등호 ${n('quiz')}개는 퀴즈로 들어가요. 서술·점 찍기 칸은 빠져요.`
      : '';
  } catch (err) {
    $('imp-ws-note').textContent = '';
    toast(errMsg(err), 'error');
  }
}
$('imp-ws').addEventListener('change', previewWs);
$('imp-table').addEventListener('input', () => {
  const list = questionsFromTable($('imp-table').value);
  $('imp-table-note').textContent = $('imp-table').value.trim() ? `${list.length}문제를 읽었어요` : '';
});
$('imp-go').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  try {
    const list = impTab === 'ws' ? structuredClone(await wsQuestions()) : questionsFromTable($('imp-table').value);
    if (!list.length) { toast('가져올 문제가 없어요'); return; }
    const room = MAX_QUESTIONS - set.questions.length;
    const add = list.slice(0, room);
    // 비어 있는 첫 문제 하나뿐이면 바꿔 넣는다
    const blank = set.questions.length === 1 && !String(set.questions[0].text ?? '').trim() && !set.questions[0].image;
    if (blank) set.questions = [];
    const at = blank ? 0 : cur + 1;
    set.questions.splice(at, 0, ...add);
    cur = at;
    touch(); renderAll();
    $('import-dlg').close();
    if (impTab === 'table') $('imp-table').value = '';
    toast(`${add.length}문제를 넣었어요${add.length < list.length ? ` (최대 ${MAX_QUESTIONS}문제)` : ''}`, 'ok');
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    e.currentTarget.disabled = false;
  }
});

/* ---------- 시작 ---------- */
let startMode = 'solo';
$('start-classes').innerHTML = CLASSES.map((c) => `<button type="button" class="btn btn-line qse-class press" data-c="${c}">${c}반</button>`).join('');
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  startMode = b.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
}));
$('start').addEventListener('click', async () => {
  if (uploading) { toast('그림을 올리는 중이에요. 잠시 뒤에 눌러 주세요'); return; }
  await save();
  const bad = set.questions.filter((x) => problemOf(x)).length;
  const ok = set.questions.length - bad;
  if (!ok) { toast('낼 수 있는 문제가 없어요. 빨간 ! 문제를 고쳐 주세요', 'error'); return; }
  $('start-note').textContent = `${ok}문제${bad ? ` · 고칠 문제 ${bad}개는 빠져요` : ''}. 반을 누르면 프로젝터 화면이 새 탭으로 열려요(이 반에 열린 퀴즈 쇼가 있으면 그만두고 새로 열어요).`;
  $('start-dlg').showModal();
});
$('start-classes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-c]');
  if (!b) return;
  $('start-dlg').close();
  window.open(`quizshow.html?c=${b.dataset.c}&set=${set.id}&mode=${startMode}`, '_blank', 'noopener');
});

/* ---------- 키 ---------- */
addEventListener('keydown', (e) => {
  if (!set || document.querySelector('dialog[open]') || e.target.closest?.('input, textarea, select')) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const n = cur + (e.key === 'ArrowDown' ? 1 : -1);
    if (n >= 0 && n < set.questions.length) { e.preventDefault(); cur = n; renderAll(); }
  }
});

teacherGate($('app'), async () => {
  if (setId) await showEditor();
  else await showList();
});
