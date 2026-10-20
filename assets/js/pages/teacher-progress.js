// 관리 '진도 관리'(#progress): 노션 '2학기 진도관리'를 옮김.
// 오늘 수업 · 반별 진도(다음 차시, 남은 차시, 마감까지 남은 수업, 여유) · 주간 수업일 · 기본 시간표 · 차시 순서
// 칸을 바꾸면 바로 저장한다. 수업 모드를 열면 그날 수업 줄에 차시가 적히고 다음 차시가 넘어간다(db.js recordLessonTaught)
import { CLASSES } from '../config.js';
import { toast, esc } from '../ui.js';
import {
  kstDay, listProgressClasses, updateClassProgress, getProgressRules, saveProgressRules,
  listTimetable, saveTimetableCell, listClassDays, updateClassDay, setDayKind, makeClassDays,
  useWeekdayTimetable, listLessons, saveLesson, listProgressBoards,
  getCalendarSettings, saveCalendarSettings, calendarFeedUrl,
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
let days = [];      // 오늘 ~ 마감, 보는 주를 모두 덮는 수업일
let deadline = DEFAULT_DEADLINE;
let weekStart = monday(kstDay());

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
  const [c, l, t, rules, b, k] = await Promise.all([listProgressClasses(), listLessons(), listTimetable(), getProgressRules(), listProgressBoards(), getCalendarSettings()]);
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

// 남은 수업은 오늘(이미 차시를 적은 오늘 수업은 빼고) ~ 마감의 '수업' 줄 수. 남은 차시는 지금 차시(덜 끝났으면)부터 끝까지
function progressOf(c) {
  const today = kstDay();
  const left = days.filter((r) => r.class_id === c.id && r.kind === '수업' && r.day >= today && r.day <= deadline
    && !(r.day === today && r.lesson_code)).length;
  const a = autoOf(c);
  const need = Math.max(0, plan().length - a.nextIdx);
  return { left, need, spare: left - need, a, next: plan()[a.nextIdx]?.code ?? null };
}

/* ---------- 그리기 ---------- */

const kindSelect = (attr, value) => `<select class="input pg-kind" data-kind-v="${esc(value)}" ${attr} aria-label="구분">${
  KINDS.map((k) => `<option${k === value ? ' selected' : ''}>${k}</option>`).join('')}</select>`;

function lessonSelect(attr, value, empty) {
  return `<select class="input" ${attr} aria-label="차시"><option value="">${empty}</option>${
    lessons.map((l) => `<option value="${esc(l.code)}"${l.code === value ? ' selected' : ''}>${esc(l.code)} ${esc(l.title)}</option>`).join('')}</select>`;
}

const memoInput = (attr, value) => `<input class="input pg-memo" ${attr} value="${esc(value)}" maxlength="60" aria-label="메모" autocomplete="off">`;

function dayRowsHTML(rows, { lead = false } = {}) {
  const today = kstDay();
  return rows.map((r) => {
    const c = classes.find((x) => x.id === r.class_id);
    const next = c && progressOf(c).next;
    const planned = !r.lesson_code && r.kind === '수업' && r.day >= today && next;
    return `<tr class="${r.day === today ? 'pg-now' : ''}">
      ${lead ? '<td></td>' : ''}
      <td class="num">${r.period}</td>
      <td><b>${r.class_id}반</b></td>
      <td>${kindSelect(`data-day-kind="${r.id}"`, r.kind)}</td>
      <td>${lessonSelect(`data-day-lesson="${r.id}"`, r.lesson_code, planned ? `예정: ${esc(lessonName(next))}` : '—')}</td>
      <td>${memoInput(`data-day-memo="${r.id}"`, r.memo)}</td>
    </tr>`;
  }).join('');
}

function renderToday() {
  const today = kstDay();
  $('pg-today-date').textContent = `${md(today)} (${WD[wdOf(today)]})`;
  const rows = days.filter((r) => r.day === today);
  $('pg-today').innerHTML = rows.length
    ? `<table class="pg-table"><thead><tr><th>교시</th><th>반</th><th>구분</th><th>차시</th><th>메모</th></tr></thead>
       <tbody>${dayRowsHTML(rows)}</tbody></table>`
    : '<p class="muted pg-empty">오늘은 수업이 없어요</p>';
}

function nowHTML(a) {
  if (!a.cur) return '<span class="muted">기록 없음</span>';
  const { lesson, slide, total, revealed, done } = a.cur;
  const pages = total ? `${Math.min(slide, total)}/${total}쪽` : (slide ? `${slide}쪽까지` : '');
  return `<b>${esc(lesson.code)}</b> ${pages}${done ? ' <span class="chip pg-chip-done">끝</span>' : ''}${
    revealed ? ' <span class="chip pg-chip-group">모둠활동 완료</span>' : ''}`;
}

function renderClasses() {
  $('pg-deadline').value = deadline;
  const p = plan();
  $('pg-classes').innerHTML = `<table class="pg-table"><thead><tr>
      <th>반</th><th>지금 진도</th><th>다음 차시</th><th>남은 차시</th><th>남은 수업 (${md(deadline)}까지)</th><th>여유</th><th>메모</th>
    </tr></thead><tbody>${classes.map((c) => {
      const g = progressOf(c);
      const tone = g.spare < 0 ? 'bad' : g.spare <= 1 ? 'warn' : 'good';
      return `<tr>
        <td><b>${c.id}반</b></td>
        <td>${nowHTML(g.a)}</td>
        <td>${g.a.auto ? (g.next ? esc(lessonName(g.next)) : '<b>진도 끝</b>') : lessonSelect(`data-next="${c.id}"`, c.next_lesson, p.length ? '진도 끝' : '—')}</td>
        <td class="num">${g.need}</td>
        <td class="num">${g.left}</td>
        <td class="num"><span class="pg-spare pg-${tone}">${g.spare > 0 ? '+' : ''}${g.spare}</span></td>
        <td>${memoInput(`data-cmemo="${c.id}"`, c.progress_memo)}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function renderWeek() {
  const end = addDays(weekStart, 4);
  $('pg-week-label').textContent = `${md(weekStart)} ~ ${md(end)}`;
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const day = addDays(weekStart, i);
    const rows = days.filter((r) => r.day === day);
    const head = `<tr class="pg-dayhead"><td colspan="6"><div class="pg-dayhead-in">
        <b>${md(day)} (${WD[wdOf(day)]})</b>
        ${rows.length ? `<select class="input" data-all-kind="${day}" aria-label="이 날 모두 바꾸기">
            <option value="">이 날 모두…</option>${KINDS.map((k) => `<option>${k}</option>`).join('')}</select>` : ''}
        <select class="input" data-use-wd="${day}" aria-label="다른 요일 시간표로">
          <option value="">${rows.length ? '다른 요일 시간표로…' : '시간표로 만들기…'}</option>
          ${[1, 2, 3, 4, 5].map((w) => `<option value="${w}">${WD[w]}요일 시간표</option>`).join('')}</select>
      </div></td></tr>`;
    parts.push(head + dayRowsHTML(rows, { lead: true }));
  }
  $('pg-week').innerHTML = `<table class="pg-table pg-week"><thead><tr>
      <th></th><th>교시</th><th>반</th><th>구분</th><th>차시</th><th>메모</th></tr></thead>
    <tbody>${parts.join('')}</tbody></table>`;
}

function renderTimetable() {
  const cell = (w, p) => tt.find((t) => t.weekday === w && t.period === p)?.class_id ?? '';
  let rows = '';
  for (let p = 1; p <= PERIODS; p++) {
    rows += `<tr><th class="num">${p}</th>${[1, 2, 3, 4, 5].map((w) => {
      const v = cell(w, p);
      return `<td><select class="input pg-tt${v ? ' on' : ''}" data-tt="${w}-${p}" aria-label="${WD[w]} ${p}교시">
        <option value="">—</option>${CLASSES.map((n) => `<option value="${n}"${n === v ? ' selected' : ''}>${n}</option>`).join('')}</select></td>`;
    }).join('')}</tr>`;
  }
  $('pg-tt').innerHTML = `<table class="pg-table pg-ttable"><thead><tr><th>교시</th>${
    [1, 2, 3, 4, 5].map((w) => `<th>${WD[w]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  if (!$('pg-from').value) $('pg-from').value = kstDay();
  if (!$('pg-to').value) $('pg-to').value = deadline;
}

function renderLessons() {
  $('pg-lessons').innerHTML = lessons.length
    ? `<table class="pg-table"><thead><tr><th>순서</th><th>차시</th><th>제목</th><th>단원</th></tr></thead><tbody>${
      lessons.map((l) => `<tr>
        <td><input class="input num pg-sort" type="number" min="0" max="999" value="${l.sort}" data-lsort="${esc(l.code)}" aria-label="순서"></td>
        <td class="num"><b>${esc(l.code)}</b></td>
        <td>${esc(l.title)}</td>
        <td><input class="input" value="${esc(l.unit)}" maxlength="40" data-lunit="${esc(l.code)}" aria-label="단원" autocomplete="off"></td>
      </tr>`).join('')}</tbody></table>`
    : '<p class="muted pg-empty">관리 \'수업 시작\'에서 차시를 추가해 주세요</p>';
}

function renderCalendar() {
  const on = !!cal.token;
  $('pg-cal-url').classList.toggle('hidden', !on);
  $('pg-cal-new').textContent = on ? '새 주소로 바꾸기' : '구독 주소 만들기';
  if (on) {
    const url = calendarFeedUrl(cal.token);
    $('pg-cal-link').value = url;
    $('pg-cal-open').href = url.replace(/^https?:/, 'webcal:');
  }
  let rows = '';
  for (let p = 1; p <= PERIODS; p++) {
    const [a = '', b = ''] = cal.periods[p - 1] ?? [];
    rows += `<tr><th class="num">${p}교시</th>
      <td><input class="input" type="time" value="${esc(a)}" data-per="${p}-0" aria-label="${p}교시 시작"></td>
      <td><input class="input" type="time" value="${esc(b)}" data-per="${p}-1" aria-label="${p}교시 끝"></td></tr>`;
  }
  $('pg-periods').innerHTML = `<table class="pg-table pg-ptable"><thead><tr><th>교시</th><th>시작</th><th>끝</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function render() {
  renderCalendar();
  renderToday();
  renderClasses();
  renderWeek();
  renderTimetable();
  renderLessons();
}

/* ---------- 바꾸기 ---------- */

const panel = document.querySelector('[data-panel="progress"]');

panel.addEventListener('change', (e) => {
  const el = e.target;
  const d = el.dataset;
  if (d.dayKind) run(() => updateClassDay(d.dayKind, { kind: el.value }));
  else if (d.dayLesson) run(() => updateClassDay(d.dayLesson, { lesson_code: el.value || null }));
  else if (d.dayMemo) run(() => updateClassDay(d.dayMemo, { memo: el.value.trim().slice(0, 60) }));
  else if (d.next) run(() => updateClassProgress(Number(d.next), { next_lesson: el.value || null }));
  else if (d.cmemo) run(() => updateClassProgress(Number(d.cmemo), { progress_memo: el.value.trim().slice(0, 60) }));
  else if (d.allKind) {
    const kind = el.value;
    if (!kind) return;
    const day = d.allKind;
    const now = days.find((r) => r.day === day)?.memo ?? '';
    const memo = prompt(`${md(day)} 수업을 모두 '${kind}'(으)로 바꿔요. 메모 (예: 한글날)`, now);
    if (memo === null) { el.value = ''; return; }
    run(() => setDayKind(day, kind, memo.trim().slice(0, 60)), `${md(day)}을(를) 바꿨어요`);
  } else if (d.useWd) {
    const w = Number(el.value);
    if (!w) return;
    const day = d.useWd;
    const has = days.some((r) => r.day === day);
    if (has && !confirm(`${md(day)} 수업을 ${WD[w]}요일 시간표로 바꿀까요?\n그날 적은 구분·차시·메모는 지워져요.`)) { el.value = ''; return; }
    const memo = w === wdOf(day) ? '' : `${WD[w]}요일 시간표`;
    run(() => useWeekdayTimetable(day, w, memo), `${md(day)}을(를) ${WD[w]}요일 시간표로 만들었어요`);
  } else if (d.tt) {
    const [w, p] = d.tt.split('-').map(Number);
    run(() => saveTimetableCell(w, p, Number(el.value) || null));
  } else if (d.lsort) {
    const v = Math.max(0, Math.min(999, Math.round(Number(el.value) || 0)));
    const l = lessons.find((x) => x.code === d.lsort);
    if (l) run(() => saveLesson({ code: l.code, sort: v }));
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
    await navigator.clipboard.writeText($('pg-cal-link').value);
    toast('주소를 복사했어요');
  } catch {
    $('pg-cal-link').select();
  }
});
