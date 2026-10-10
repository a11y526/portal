// 반 페이지: 오늘 보드(패들렛 + 시뮬레이션)
import { CLASSES, GRADE } from '../config.js';
import { initUI, esc } from '../ui.js';
import { getClassPage } from '../db.js';

initUI();

const REFRESH_MS = 15000;
const classId = Number(new URLSearchParams(location.search).get('c'));
if (!CLASSES.includes(classId)) location.replace('index.html');

const $ = (id) => document.getElementById(id);
const titleText = `${GRADE}학년 ${classId}반`;
$('title').textContent = titleText;
document.title = titleText;
try { localStorage.setItem('lastClass', String(classId)); } catch {}

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

const ICON_BOARD = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>`;

let shown = { padlet: undefined, sims: undefined, lesson: undefined };

function showEmpty(message, withRetry = false) {
  const key = 'empty:' + message;
  if (key === shown.padlet && !withRetry) return;
  shown.padlet = key;
  $('padlet-actions').classList.add('hidden');
  $('padlet-slot').innerHTML = `
    <div class="empty padlet-empty">
      ${ICON_BOARD}
      <strong>${esc(message)}</strong>
      ${withRetry ? '<button type="button" class="btn btn-line" id="retry">다시 불러오기</button>' : ''}
    </div>`;
  if (withRetry) $('retry').addEventListener('click', load);
}

function renderPadlet(src) {
  if (!isHttp(src)) {
    showEmpty('패들렛이 아직 연결되지 않았어요');
    return;
  }
  if (src === shown.padlet) return;
  shown.padlet = src;
  const frame = document.createElement('iframe');
  frame.className = 'padlet-frame';
  frame.src = src;
  frame.title = '오늘의 패들렛';
  frame.allow = 'camera;microphone;geolocation;display-capture;clipboard-write';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  $('padlet-slot').replaceChildren(frame);
  $('padlet-open').href = src;
  $('padlet-actions').classList.remove('hidden');
  fitFrame();
}

function renderSims(list) {
  const sims = (Array.isArray(list) ? list : []).filter((s) => s && isHttp(s.url));
  const key = JSON.stringify(sims);
  if (key === shown.sims) return;
  shown.sims = key;
  $('sim-list').innerHTML = sims.map((s) => `
    <a class="sim-link lift" href="${esc(s.url)}" target="_blank" rel="noopener">
      ${esc(s.name || s.url)}<span aria-hidden="true">↗</span>
    </a>`).join('');
  $('sims').classList.toggle('hidden', sims.length === 0);
  // 오른쪽에 보여 줄 것이 없으면 패들렛을 넓게
  $('side').classList.toggle('hidden', !$('side').querySelector('section:not(.hidden)'));
}

function renderLesson(board) {
  const text = board ? [board.lesson_code && `${board.lesson_code}차시`, board.title].filter(Boolean).join(' · ') : '';
  if (text === shown.lesson) return;
  shown.lesson = text;
  $('lesson').textContent = text;
  $('lesson').classList.toggle('hidden', !text);
}

// 패들렛 창이 화면 아래로 잘리지 않게 남은 높이에 맞춘다
// (창 위에서 휠을 굴리면 페이지가 아니라 패들렛이 움직여서, 잘린 부분으로 내려갈 수 없기 때문)
const BOTTOM_SPACE = 46; // 카드 아래 안쪽 여백 + 페이지 아래 여백
function fitFrame() {
  const frame = document.querySelector('.padlet-frame');
  if (!frame || maxed) return;
  const top = frame.getBoundingClientRect().top + scrollY;
  frame.style.height = Math.max(360, innerHeight - top - BOTTOM_SPACE) + 'px';
}
addEventListener('resize', fitFrame);
document.querySelector('.padlet-card').addEventListener('animationend', fitFrame);

// 크게 보기: 전체 화면, 막혀 있으면 브라우저 창 안에서 꽉 채우기
const card = document.querySelector('.padlet-card');
const fullBtn = $('padlet-full');
let maxed = false;
function setMax(on) {
  maxed = on;
  card.classList.toggle('is-max', on);
  document.body.style.overflow = on ? 'hidden' : '';
  fullBtn.querySelector('span').textContent = on ? '작게 보기' : '크게 보기';
  const frame = document.querySelector('.padlet-frame');
  if (frame) frame.style.height = '';
  if (!on) fitFrame();
}
fullBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (maxed) setMax(false);
  else if (card.requestFullscreen) card.requestFullscreen().catch(() => setMax(true));
  else setMax(true);
});
document.addEventListener('fullscreenchange', () => setMax(!!document.fullscreenElement));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && maxed && !document.fullscreenElement) setMax(false); });

let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  try {
    const data = await getClassPage(classId);
    const board = data?.board ?? null;
    renderLesson(board);
    renderSims(board?.sim_links);
    if (!board) showEmpty('오늘 수업이 아직 없어요');
    else renderPadlet(board.padlet_src);
  } catch (err) {
    console.error(err);
    if (err.message === 'NOT_CONFIGURED') showEmpty('config.js에 Supabase 주소와 키를 넣어야 해요');
    else if (shown.padlet === undefined) showEmpty('불러오지 못했어요', true);
    // 이미 보이는 패들렛이 있으면 그대로 둔다
  } finally {
    loading = false;
  }
}

load();

// 오늘 보드가 바뀌면 자동으로 반영 (화면이 숨겨져 있으면 멈춤)
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
