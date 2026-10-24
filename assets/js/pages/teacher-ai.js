// 관리 'AI 채점'(#ai, 2026-10-24): 켜기/끄기와 상태(오늘 Gemini 부른 횟수, 쉬는 중, 마지막 오류),
// 차시를 고르면 칸마다 정답(또는 예시 답안)·AI 켜기/끄기, 학생 답별 판정(누르면 맞음↔틀림, 선생님 판정은 AI가 바꾸지 않음)
import { toast, esc } from '../ui.js';
import { getAiAdmin, getAiGrades, setAiOn, setAiField, setAiGrade } from '../db.js';
import { errMsg } from '../gate.js';

const $ = (id) => document.getElementById(id);
let admin = null;
let lesson = (() => { try { return localStorage.getItem('aiLesson') || ''; } catch { return ''; } })();
let fields = [];

export async function refreshAi() {
  admin = await getAiAdmin();
  if (!admin.lessons.some((l) => l.code === lesson)) lesson = admin.lessons[0]?.code ?? '';
  renderHead();
  fields = lesson ? await getAiGrades(lesson) : [];
  renderFields();
}
const reload = () => refreshAi().catch((err) => toast(errMsg(err), 'error'));

const hm = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

function renderHead() {
  const on = !!admin.conf.on;
  $('ai-on').setAttribute('aria-checked', String(on));
  $('ai-ontag').textContent = on ? '켜짐' : '꺼짐';
  $('ai-ontag').className = `tag ${on ? 'tag-done' : 'tag-off'}`;
  $('ai-onrow').classList.toggle('is-open', on);
  const st = admin.state ?? {};
  const rest = st.cooldown_until ? Math.ceil((new Date(st.cooldown_until) - Date.now()) / 1000) : 0;
  $('ai-status').textContent = [
    !admin.cron ? '서버 준비 안 됨(pg_cron·pg_net)' : '',
    `오늘 Gemini ${st.day === admin.today ? st.calls ?? 0 : 0}번`,
    `기다리는 답 ${admin.waiting}개`,
    st.last_ok_at ? `마지막 판정 ${hm(st.last_ok_at)}` : '',
    rest > 0 ? `쉬는 중 ${rest}초` : '',
    st.last_error && (!st.last_ok_at || st.last_error_at > st.last_ok_at) ? `오류 ${hm(st.last_error_at)}: ${st.last_error}` : '',
  ].filter(Boolean).join(' · ');
  $('ai-lesson').innerHTML = admin.lessons.map((l) =>
    `<option value="${esc(l.code)}">${esc(l.code)} ${esc(l.title)} · AI 칸 ${l.fields}개 · 판정 ${l.cached}개</option>`).join('')
    || '<option value="">올린 학습지가 없어요</option>';
  $('ai-lesson').value = lesson;
}

const TYPE = { blank: '빈칸', text: '서술' };

function renderFields() {
  if (!fields.length) {
    $('ai-fields').innerHTML = '<p class="muted" style="margin:0">AI로 볼 칸이 없어요</p>';
    return;
  }
  $('ai-fields').innerHTML = fields.map((f) => {
    const can = !f.numeric;
    const on = can && !f.off;
    const right = f.type === 'blank' ? `정답: ${f.answers.join(', ')}` : `예시: ${f.answers[0] ?? ''}`;
    return `
    <div class="ai-field${on ? '' : ' is-off'}">
      <div class="ai-fhead">
        <b class="num">${f.slide}쪽</b>
        <span class="tag tag-off">${TYPE[f.type] ?? f.type}</span>
        <span class="ai-key">${esc(right)}</span>
        ${can
          ? `<span class="tag ${on ? 'tag-done' : 'tag-off'}">${on ? 'AI 켬' : 'AI 끔'}</span>
             <button type="button" class="switch switch-on" role="switch" aria-checked="${on}" data-field="${esc(f.key)}" aria-label="${f.slide}쪽 ${esc(f.key)} AI"><span></span></button>`
          : '<span class="tag tag-off">숫자 답 · AI 안 씀</span>'}
      </div>
      ${f.rows.length ? `<div class="coins-scroll"><table class="coins-table ai-table">
        <thead><tr><th class="l">학생 답</th><th>쓴 학생</th><th>판정</th><th>누가</th><th class="l">이유</th><th></th></tr></thead>
        <tbody>${f.rows.map((r) => `<tr>
          <td class="l ans">${esc(r.answer)}</td>
          <td>${r.n}명</td>
          <td><button type="button" class="ai-ok ${r.ok ? 'yes' : 'no'} press" data-k="${esc(f.key)}" data-norm="${esc(r.norm)}" data-ok="${r.ok}" aria-label="${esc(r.answer)} ${r.ok ? '맞음, 누르면 틀림으로' : '틀림, 누르면 맞음으로'}">${r.ok ? '맞음' : '틀림'}</button></td>
          <td>${r.source === 'teacher' ? '선생님' : 'AI'}</td>
          <td class="l why">${esc(r.reason ?? '')}</td>
          <td><button type="button" class="ai-del" data-k="${esc(f.key)}" data-norm="${esc(r.norm)}">지우기</button></td>
        </tr>`).join('')}</tbody></table></div>` : ''}
    </div>`;
  }).join('');
}

$('ai-on').addEventListener('click', async () => {
  const btn = $('ai-on');
  const on = btn.getAttribute('aria-checked') !== 'true';
  btn.disabled = true;
  try {
    await setAiOn(on);
    toast(on ? 'AI 채점을 켰어요' : 'AI 채점을 껐어요', 'ok');
    await refreshAi();
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

$('ai-lesson').addEventListener('change', () => {
  lesson = $('ai-lesson').value;
  try { localStorage.setItem('aiLesson', lesson); } catch {}
  reload();
});
$('ai-refresh').addEventListener('click', reload);

$('ai-fields').addEventListener('click', async (e) => {
  const sw = e.target.closest('[data-field]');
  const okb = e.target.closest('.ai-ok');
  const del = e.target.closest('.ai-del');
  const btn = sw || okb || del;
  if (!btn) return;
  btn.disabled = true;
  try {
    if (sw) await setAiField(lesson, sw.dataset.field, sw.getAttribute('aria-checked') !== 'true');
    if (okb) await setAiGrade(lesson, okb.dataset.k, okb.dataset.norm, okb.dataset.ok !== 'true');
    if (del) await setAiGrade(lesson, del.dataset.k, del.dataset.norm, null);
    fields = await getAiGrades(lesson);
    renderFields();
  } catch (err) {
    toast(errMsg(err), 'error');
    btn.disabled = false;
  }
});
