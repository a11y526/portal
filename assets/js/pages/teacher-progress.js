// 관리 '진도 관리'(#progress): 노션 '2학기 진도관리'를 옮김.
// 오늘 수업 · 반별 진도(다음 차시, 남은 차시, 마감까지 남은 수업, 여유) · 주간 수업일 · 기본 시간표 · 차시 순서
// 칸을 바꾸면 바로 저장한다. 수업 모드를 열면 그날 수업 줄에 차시가 적히고 다음 차시가 넘어간다(db.js recordLessonTaught)
import { CLASSES } from '../config.js';
import { toast, esc } from '../ui.js';
import {
  kstDay, listProgressClasses, updateClassProgress, getProgressRules, saveProgressRules,
  listTimetable, saveTimetableCell, listClassDays, updateClassDay, setDayKind, makeClassDays,
  useWeekdayTimetable, listLessons, saveLesson, listProgressBoards,
  getCalendarSettings, saveCalendarSettings, calendarFeedUrl, listTaughtRows,
} from '../db.js';
import { errMsg } from '../gate.js';

const $ = (id) => document.getElementById(id);
const KINDS = ['수업', '휴강', '자습', '수행평가', '미정'];
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const PERIODS = 7;
const DEFAULT_DEADLINE = '2026-12-04';

let classes = [];
let lessons = [];   // 모든 차시 (순서·차시 번호 순)
let tt = [];
let boards = [];  // 진도 계산용 보드
let cal = { token: '', periods: [] };
let taught = [];   // 차시를 적은 수업 줄 (class_id, lesson_code)
let days = [];      // 오늘 ~ 마감, 보는 주를 모두 덮는 수업일
let deadline = DEFAULT_DEADLINE;
let weekStart = monday(kstDay());
const panel = document.querySelector('[data-panel="progress"]');

// 'YYYY-MM-DD' 날짜 계산 (시간대와 상관없이 날짜만)
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function wdOf(day) { return new Date(`${day}T00:00:00Z`).getUTCDay(); }
function monday(day) { const w = wdOf(day); return addDays(day, w === 0 ? -6 : 1 - w); }
const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

const plan = () => lessons.filter((l) => l.unit);
const lessonName = (code) => {
  const l = lessons.find((x) => x.code === code);
  return l ? `${l.code} ${l.title}` : code;
};

export async function refreshProgress() {
  const today = kstDay();
  const [c, l, t, rules, b, k, tr] = await Promise.all([listProgressClasses(), listLessons(), listTimetable(), getProgressRules(), listProgressBoards(), getCalendarSettings(), listTaughtRows()]);
  taught = tr;
  boards = b;
  cal = { token: k?.token || '', periods: Array.isArray(k?.periods) ? k.periods : [] };
  classes = c.filter((x) => CLASSES.includes(x.id));
  lessons = l;
  tt = t;
  deadline = rules?.deadline || DEFAULT_DEADLINE;
  const from = [today, weekStart].sort()[0];
  const to = [deadline, addDays(weekStart, 4), today].sort().pop();
  days = await listClassDays(from, to);
  render();
}
const reload = () => refreshProgress().catch((err) => toast(errMsg(err), 'error'));

async function run(fn, done) {
  try {
    await fn();
    if (done) toast(done);
  } catch (err) {
    console.error(err);
    toast(errMsg(err), 'error');
  }
  await reload();
}

/* ---------- 계산 ---------- */

// 반 하나의 지금 진도(자동): 진도 계획에서 수업 모드로 가장 뒤까지 간 차시.
// 그 차시 보드에서 간 가장 뒤 쪽(slide_max)이 마지막 쪽이면 그 차시는 끝, 다음 차시로 넘어간다.
// 보드 기록이 없는 반은 손으로 고른 다음 차시(classes.next_lesson)
function autoOf(c) {
  const p = plan();
  let cur = null;
  p.forEach((l, i) => {
    const bs = boards.filter((b) => b.class_id === c.id && b.lesson_code === l.code);
    const slide = Math.max(0, ...bs.map((b) => b.slide_max ?? 0));
    const revealed = bs.some((b) => b.status === 'revealed');
    if (slide > 0 || revealed) cur = { i, lesson: l, slide, total: l.slide_count ?? null, revealed };
  });
  if (!cur) {
    const i = p.findIndex((x) => x.code === c.next_lesson);
    return { auto: false, cur: null, nextIdx: c.next_lesson == null ? p.length : (i < 0 ? 0 : i) };
  }
  cur.done = !!cur.total && cur.slide >= cur.total;
  return { auto: true, cur, nextIdx: cur.done ? cur.i + 1 : cur.i };
}

// 남은 차시(시간): 다음 차시부터 끝까지 각 차시의 시간 수 합. 지금 차시를 덜 끝냈으면 그 차시를 이미 한 시간만큼 뺀다(적어도 1)
const hours = (l) => l?.periods || 1;
function needOf(c, a) {
  const p = plan();
  let need = 0;
  for (let i = a.nextIdx; i < p.length; i++) need += hours(p[i]);
  if (a.cur && !a.cur.done && a.nextIdx === a.cur.i) {
    const did = taught.filter((r) => r.class_id === c.id && r.lesson_code === a.cur.lesson.code).length;
    need -= Math.min(did, hours(a.cur.lesson) - 1);
  }
  return need;
}

// 남은 수업은 오늘(이미 차시를 적은 오늘 수업은 빼고) ~ 마감의 '수업' 줄 수. 남은 차시는 지금 차시(덜 끝났으면)부터 끝까지
function progressOf(c) {
  const today = kstDay();
  const left = days.filter((r) => r.class_id === c.id && r.kind === '수업' && r.day >= today && r.day <= deadline
    && !(r.day === today && r.lesson_code)).length;
  const a = autoOf(c);
  const need = needOf(c, a);
  return { left, need, spare: left - need, a, next: plan()[a.nextIdx]?.code ?? null };
}

/* ---------- 그리기 (노션식: 칸은 글자처럼 보이고 누르면 고친다) ---------- */

let view = (() => { try { return localStorage.getItem('pgView') || 'today'; } catch { return 'today'; } })();

const kindSelect = (attr, value) => `<select class="nd-ghost nd-tag" data-kind-v="${esc(value)}" ${attr} aria-label="구분">${
  KINDS.map((k) => `<option${k === value ? ' selected' : ''}>${k}</option>`).join('')}</select>`;

function lessonSelect(attr, value, empty) {
  return `<select class="nd-ghost${value ? '' : ' dim'}" ${attr} aria-label="차시"><option value="">${empty}</option>${
    lessons.map((l) => `<option value="${esc(l.code)}"${l.code === value ? ' selected' : ''}>${esc(l.code)} ${esc(l.title)}</option>`).join('')}</select>`;
}

const memoInput = (attr, value) => `<input class="nd-ghost" ${attr} value="${esc(value)}" maxlength="60" placeholder="메모" aria-label="메모" autocomplete="off">`;

function dayRowsHTML(rows) {
  const today = kstDay();
  return rows.map((r) => {
    const c = classes.find((x) => x.id === r.class_id);
    const next = c && progressOf(c).next;
    const planned = !r.lesson_code && r.kind === '수업' && r.day >= today && next;
    return `<tr class="${r.day === today ? 'nd-now' : ''}">
      <td class="n">${r.period}교시</td>
      <td>${r.class_id}반</td>
      <td>${kindSelect(`data-day-kind="${r.id}"`, r.kind)}</td>
      <td>${lessonSelect(`data-day-lesson="${r.id}"`, r.lesson_code, planned ? `${esc(lessonName(next))} · 예정` : '—')}</td>
      <td>${memoInput(`data-day-memo="${r.id}"`, r.memo)}</td>
    </tr>`;
  }).join('');
}

const DAY_HEAD = '<thead><tr><th>교시</th><th>반</th><th>구분</th><th>차시</th><th>메모</th></tr></thead>';

function todayHTML() {
  const rows = days.filter((r) => r.day === kstDay());
  return rows.length
    ? `<table class="nd-table">${DAY_HEAD}<tbody>${dayRowsHTML(rows)}</tbody></table>`
    : '<div class="nd-empty">오늘은 수업이 없어요</div>';
}

function nowHTML(a) {
  if (!a.cur) return '<span class="muted">기록 없음</span>';
  const { lesson, slide, total, revealed, done } = a.cur;
  const pct = total ? Math.min(100, Math.round((slide / total) * 100)) : 0;
  const pages = total ? `${Math.min(slide, total)}/${total}쪽` : (slide ? `${slide}쪽까지` : '');
  return `${total ? `<span class="nd-bar-in${done ? ' done' : ''}" title="${done ? '이 차시 끝' : ''}"><i style="width:${pct}%"></i></span>` : ''}${esc(lesson.code)} ${pages}${
    revealed ? ' <span class="nd-tag purple">모둠활동 완료</span>' : ''}`;
}

function classesHTML() {
  const p = plan();
  return `<table class="nd-table"><thead><tr>
      <th>반</th><th>지금 진도</th><th>다음 차시</th><th>남은 차시</th><th>남은 수업</th><th>여유</th><th>메모</th>
    </tr></thead><tbody>${classes.map((c) => {
      const g = progressOf(c);
      const tone = g.spare < 0 ? 'bad' : g.spare <= 1 ? 'warn' : 'good';
      return `<tr>
        <td>${c.id}반</td>
        <td>${nowHTML(g.a)}</td>
        <td class="clip">${g.a.auto ? (g.next ? esc(lessonName(g.next)) : '진도 끝') : lessonSelect(`data-next="${c.id}"`, c.next_lesson, p.length ? '진도 끝' : '—')}</td>
        <td>${g.need}</td>
        <td>${g.left}</td>
        <td class="nd-${tone}">${g.spare > 0 ? '+' : ''}${g.spare}</td>
        <td>${memoInput(`data-cmemo="${c.id}"`, c.progress_memo)}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

// 날마다 ⋯ 메뉴: 그날 모두 같은 구분으로 · 다른 요일 시간표로
function dayMenu(day, has) {
  const kinds = has ? KINDS.map((k) => `<button type="button" class="nd-btn" data-all-kind="${day}" data-kind="${k}">모두 ${k}</button>`).join('') : '';
  const wds = [1, 2, 3, 4, 5].map((w) => `<button type="button" class="nd-btn" data-use-wd="${day}" data-wd="${w}">${WD[w]}요일 시간표로${has ? ' 바꾸기' : ' 만들기'}</button>`).join('');
  return `<details class="nd-menu"><summary aria-label="${md(day)} 바꾸기">⋯</summary><div class="nd-menu-list">${kinds}${wds}</div></details>`;
}

function weekHTML() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const day = addDays(weekStart, i);
    const rows = days.filter((r) => r.day === day);
    const count = KINDS.map((k) => [k, rows.filter((r) => r.kind === k).length]).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ');
    parts.push(`<tr class="nd-day"><td colspan="4"><b>${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일 ${WD[wdOf(day)]}</b>${count || '수업 없음'}</td>
      <td><div class="nd-row-acts">${dayMenu(day, rows.length > 0)}</div></td></tr>${dayRowsHTML(rows)}`);
  }
  return `<table class="nd-table">${DAY_HEAD}<tbody>${parts.join('')}</tbody></table>`;
}

function renderView() {
  panel.querySelectorAll('[data-pg-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pgView === view)));
  $('pg-week-bar').classList.toggle('hidden', view !== 'week');
  $('pg-this').textContent = `${md(weekStart)} ~ ${md(addDays(weekStart, 4))}`;
  $('pg-view').innerHTML = view === 'classes' ? classesHTML() : view === 'week' ? weekHTML() : todayHTML();
}

function renderTimetable() {
  const cell = (w, p) => tt.find((t) => t.weekday === w && t.period === p)?.class_id ?? '';
  let rows = '';
  for (let p = 1; p <= PERIODS; p++) {
    rows += `<tr><td class="n">${p}교시</td>${[1, 2, 3, 4, 5].map((w) => {
      const v = cell(w, p);
      return `<td><select class="nd-ghost${v ? ' on' : ' dim'}" data-tt="${w}-${p}" aria-label="${WD[w]} ${p}교시">
        <option value="">·</option>${CLASSES.map((n) => `<option value="${n}"${n === v ? ' selected' : ''}>${n}반</option>`).join('')}</select></td>`;
    }).join('')}</tr>`;
  }
  $('pg-tt').innerHTML = `<table class="nd-table nd-tt"><thead><tr><th></th>${
    [1, 2, 3, 4, 5].map((w) => `<th style="text-align:center">${WD[w]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  if (!$('pg-from').value) $('pg-from').value = kstDay();
  if (!$('pg-to').value) $('pg-to').value = deadline;
}

function renderLessons() {
  $('pg-lessons').innerHTML = lessons.length
    ? `<table class="nd-table"><thead><tr><th>순서</th><th>차시</th><th>제목</th><th>단원</th><th>차시 수</th><th>쪽 수</th></tr></thead><tbody>${
      lessons.map((l) => `<tr>
        <td style="width:90px"><input class="nd-ghost" type="number" min="0" max="999" value="${l.sort}" data-lsort="${esc(l.code)}" aria-label="순서" style="min-width:0;width:70px"></td>
        <td>${esc(l.code)}</td>
        <td>${esc(l.title)}</td>
        <td><input class="nd-ghost" value="${esc(l.unit)}" maxlength="40" placeholder="단원" data-lunit="${esc(l.code)}" aria-label="단원" autocomplete="off"></td>
        <td style="width:80px"><input class="nd-ghost" type="number" min="1" max="9" value="${l.periods || 1}" data-lperiods="${esc(l.code)}" aria-label="${esc(l.code)} 차시 수" style="min-width:0;width:56px"></td>
        <td class="muted">${l.slide_count ?? '—'}</td>
      </tr>`).join('')}</tbody></table>`
    : '<div class="nd-empty">관리 \'수업 시작\'에서 차시를 추가해 주세요</div>';
}

function renderCalendar() {
  const on = !!cal.token;
  for (const id of ['pg-cal-url', 'pg-cal-copy', 'pg-cal-open']) $(id).classList.toggle('hidden', !on);
  $('pg-cal-new').textContent = on ? '새 주소로 바꾸기' : '구독 주소 만들기';
  if (on) {
    const url = calendarFeedUrl(cal.token);
    $('pg-cal-url').textContent = url;
    $('pg-cal-open').href = url.replace(/^https?:/, 'webcal:');
  }
  let rows = '';
  for (let p = 1; p <= PERIODS; p++) {
    const [a = '', b = ''] = cal.periods[p - 1] ?? [];
    rows += `<tr><td class="n">${p}교시</td>
      <td><input class="nd-ghost" type="time" value="${esc(a)}" data-per="${p}-0" aria-label="${p}교시 시작"></td>
      <td><input class="nd-ghost" type="time" value="${esc(b)}" data-per="${p}-1" aria-label="${p}교시 끝"></td></tr>`;
  }
  $('pg-periods').innerHTML = `<table class="nd-table" style="max-width:360px"><thead><tr><th>교시 시간</th><th>시작</th><th>끝</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function render() {
  const today = kstDay();
  $('pg-deadline').value = deadline;
  $('pg-today-date').textContent = `${Number(today.slice(5, 7))}월 ${Number(today.slice(8, 10))}일 ${WD[wdOf(today)]}요일 · 수업 ${days.filter((r) => r.day === today && r.kind === '수업').length}개`;
  renderView();
  renderCalendar();
  renderTimetable();
  renderLessons();
}

/* ---------- 바꾸기 ---------- */

panel.addEventListener('change', (e) => {
  const el = e.target;
  const d = el.dataset;
  if (d.dayKind) run(() => updateClassDay(d.dayKind, { kind: el.value }));
  else if (d.dayLesson) run(() => updateClassDay(d.dayLesson, { lesson_code: el.value || null }));
  else if (d.dayMemo) run(() => updateClassDay(d.dayMemo, { memo: el.value.trim().slice(0, 60) }));
  else if (d.next) run(() => updateClassProgress(Number(d.next), { next_lesson: el.value || null }));
  else if (d.cmemo) run(() => updateClassProgress(Number(d.cmemo), { progress_memo: el.value.trim().slice(0, 60) }));
  else if (d.tt) {
    const [w, p] = d.tt.split('-').map(Number);
    run(() => saveTimetableCell(w, p, Number(el.value) || null));
  } else if (d.lsort) {
    const v = Math.max(0, Math.min(999, Math.round(Number(el.value) || 0)));
    const l = lessons.find((x) => x.code === d.lsort);
    if (l) run(() => saveLesson({ code: l.code, sort: v }));
  } else if (d.lperiods) {
    const v = Math.max(1, Math.min(9, Math.round(Number(el.value) || 1)));
    const l = lessons.find((x) => x.code === d.lperiods);
    if (l) run(() => saveLesson({ code: l.code, periods: v }));
  } else if (d.lunit) {
    const l = lessons.find((x) => x.code === d.lunit);
    if (l) run(() => saveLesson({ code: l.code, unit: el.value.trim().slice(0, 40) }));
  } else if (d.per) {
    const [p, k] = d.per.split('-').map(Number);
    if (!/^\d{2}:\d{2}$/.test(el.value)) return;
    const periods = Array.from({ length: PERIODS }, (_, i) => [...(cal.periods[i] ?? ['', ''])]);
    periods[p - 1][k] = el.value;
    run(() => saveCalendarSettings({ ...cal, periods }));
  } else if (el.id === 'pg-deadline') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
    run(() => saveProgressRules({ deadline: el.value }), '마감일을 바꿨어요');
  }
});

$('pg-prev').addEventListener('click', () => { weekStart = addDays(weekStart, -7); reload(); });
$('pg-next').addEventListener('click', () => { weekStart = addDays(weekStart, 7); reload(); });
$('pg-this').addEventListener('click', () => { weekStart = monday(kstDay()); reload(); });

$('pg-make').addEventListener('click', () => {
  const from = $('pg-from').value;
  const to = $('pg-to').value;
  if (!from || !to || from > to) { toast('날짜를 확인해 주세요', 'error'); return; }
  run(async () => {
    const n = await makeClassDays(from, to);
    toast(n ? `수업 ${n}개를 만들었어요` : '새로 만들 수업이 없어요');
  });
});

// 구독 주소: 무작위 48자. 바꾸면 예전 주소로 구독한 캘린더는 더 안 새로 고쳐진다
$('pg-cal-new').addEventListener('click', () => {
  if (cal.token && !confirm('새 주소로 바꿀까요?\n예전 주소로 구독한 캘린더는 더 이상 바뀌지 않아요.')) return;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
  run(() => saveCalendarSettings({ ...cal, token }), '구독 주소를 만들었어요');
});

$('pg-cal-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('pg-cal-url').textContent);
    toast('주소를 복사했어요');
  } catch {
    getSelection().selectAllChildren($('pg-cal-url'));
  }
});

panel.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.pgView) {
    view = d.pgView;
    try { localStorage.setItem('pgView', view); } catch {}
    renderView();
  } else if (d.allKind) {
    b.closest('details')?.removeAttribute('open');
    const day = d.allKind;
    const kind = d.kind;
    const now = days.find((r) => r.day === day)?.memo ?? '';
    const memo = prompt(`${md(day)} 수업을 모두 '${kind}'(으)로 바꿔요. 메모 (예: 한글날)`, now);
    if (memo === null) return;
    run(() => setDayKind(day, kind, memo.trim().slice(0, 60)), `${md(day)}을(를) 바꿨어요`);
  } else if (d.useWd) {
    b.closest('details')?.removeAttribute('open');
    const w = Number(d.wd);
    const day = d.useWd;
    const has = days.some((r) => r.day === day);
    if (has && !confirm(`${md(day)} 수업을 ${WD[w]}요일 시간표로 바꿀까요?\n그날 적은 구분·차시·메모는 지워져요.`)) return;
    const memo = w === wdOf(day) ? '' : `${WD[w]}요일 시간표`;
    run(() => useWeekdayTimetable(day, w, memo), `${md(day)}을(를) ${WD[w]}요일 시간표로 만들었어요`);
  }
});

// 메뉴 밖을 누르면 닫기
document.addEventListener('click', (e) => {
  for (const m of panel.querySelectorAll('.nd-menu[open]')) if (!m.contains(e.target)) m.removeAttribute('open');
});
