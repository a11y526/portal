// 순위 발표 (프로젝터)
// 화면 어두워짐 → 3위·2위·1위 순서로 카드가 뒤집히며 공개(클릭/스페이스) → 1위에서 빛줄기 + 폭죽 → 4위부터 목록
import { CLASSES, GRADE } from '../config.js';
import { initUI, toast, countUp, isLite } from '../ui.js';
import { listClasses, getBoard, listSubmissions, revealBoard, unrevealBoard, onSubmissionsChange, sendClassRefresh } from '../db.js';
import { teacherGate, errMsg } from '../gate.js';

initUI({
  orbs: [
    { color: 'blue',   size: 600, left: '-200px', top: '-220px' },
    { color: 'peach',  size: 520, right: '-180px', top: '80px' },
    { color: 'violet', size: 480, left: '25%', bottom: '-260px' },
  ],
});

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const G = window.gsap;
const fancy = !!G && !isLite && !reduceMotion;

const RING = { 1: 'var(--gold)', 2: 'var(--silver)', 3: 'var(--bronze)' };
const CROWN = `<svg class="crown" width="72" height="54" viewBox="0 0 40 30" fill="#F2B705" stroke="#B88600" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 26 L6 7 L14 15 L20 3 L26 15 L34 7 L37 26 Z"/></svg>`;

const classId = Number(new URLSearchParams(location.search).get('c'));
// embed=1: 수업 모드(live.html) 덮개 안. 뒤로 가기를 숨기고, 전체 화면은 바깥(live.html)이 맡는다
const embed = new URLSearchParams(location.search).get('embed') === '1';
if (embed) document.documentElement.classList.add('embed');
const tellParent = (type) => { if (embed) parent.postMessage({ type, classId }, location.origin); };
let board = null;
let queue = [];

/* ---------- 준비 화면 ---------- */
async function loadReady() {
  $('ready-class').textContent = `${GRADE}학년 ${classId}반`;
  const classes = await listClasses();
  const c = classes.find((x) => x.id === classId);
  board = c?.today_board_id ? await getBoard(c.today_board_id) : null;
  if (!board) {
    $('ready-title').textContent = '순위 발표';
    $('ready-info').textContent = '오늘 보드가 없어요';
    $('start').classList.add('hidden');
    $('unreveal').classList.add('hidden');
    $('ready-warn').classList.add('hidden');
    return;
  }
  const subs = await listSubmissions(board.id);
  const passed = subs.filter((s) => s.status === 'passed').length;
  const pending = subs.filter((s) => s.status === 'pending').length;
  const revealed = board.status === 'revealed';

  $('ready-title').textContent = `${board.lesson_code}차시 순위 발표`;
  $('ready-info').textContent = `통과 ${passed}모둠`;
  const warn = revealed
    ? '이미 발표했어요. 다시 보기에서는 포인트를 주지 않아요'
    : pending ? `검사 안 한 제출 ${pending}개는 순위에 들어가지 않아요` : '';
  $('ready-warn').textContent = warn;
  $('ready-warn').classList.toggle('hidden', !warn);
  $('start').textContent = revealed ? '다시 보기' : '순위 발표';
  $('start').classList.remove('hidden');
  $('start').disabled = false;
  $('unreveal').classList.toggle('hidden', !revealed);
  $('unreveal').disabled = false;
}

/* ---------- 발표 취소: 그 발표로 준 포인트를 거둬들이고 보드를 다시 연다 ---------- */
$('unreveal').addEventListener('click', async () => {
  if (!board || board.status !== 'revealed') return;
  if (!confirm(`${classId}반 ${board.lesson_code}차시 발표를 취소할까요?\n이 발표로 준 포인트를 거둬들이고, 제출과 검사를 다시 할 수 있게 돼요.`)) return;
  $('unreveal').disabled = true;
  try {
    const res = await unrevealBoard(board.id);
    sendClassRefresh(classId);
    tellParent('unrevealed');
    toast(res?.removed ? `발표를 취소하고 포인트 ${res.removed}건을 거둬들였어요` : '발표를 취소했어요', 'ok');
    await loadReady();
  } catch (err) {
    toast(errMsg(err), 'error');
    $('unreveal').disabled = false;
  }
});

let readyTimer;
const scheduleReady = () => {
  if ($('ready').classList.contains('hidden')) return;
  clearTimeout(readyTimer);
  readyTimer = setTimeout(() => loadReady().catch((err) => toast(errMsg(err), 'error')), 300);
};

function showClassPicker() {
  $('ready-class').classList.add('hidden');
  $('ready-info').textContent = '반을 골라 주세요';
  $('ready-classes').innerHTML = CLASSES.map((n) => `<a class="glass lift ready-cls" href="?c=${n}">${n}반</a>`).join('');
  $('ready-classes').classList.remove('hidden');
}

/* ---------- 시작: 포인트 지급(처음 한 번만) + 무대 ---------- */
$('start').addEventListener('click', async () => {
  if (!board) return;
  $('start').disabled = true;
  let result;
  try {
    result = await revealBoard(board.id);
  } catch (err) {
    toast(errMsg(err), 'error');
    $('start').disabled = false;
    return;
  }
  sendClassRefresh(classId);
  tellParent('revealed');
  if (!embed) document.documentElement.requestFullscreen?.().catch(() => {});
  buildStage(result.ranking || []);
  $('ready').classList.add('hidden');
  $('stage').classList.remove('hidden');
  intro();
});

function buildStage(ranking) {
  $('stage-label').textContent = `${GRADE}학년 ${classId}반 · ${board.lesson_code}차시`;
  const byRank = new Map(ranking.map((r) => [r.rank, r]));
  const top = [2, 1, 3].map((rank) => {
    const r = byRank.get(rank);
    if (!r) return `<div class="slot empty" data-rank="${rank}" aria-hidden="true"></div>`;
    return `
      <div class="slot" data-rank="${rank}" style="--ring:${RING[rank]}">
        <div class="slot-top">
          ${rank === 1 ? '<div class="rays-bg" aria-hidden="true"><div class="rays-spin rays"></div></div>' : ''}
          <div class="pts num">+<span data-to="${r.xp}">0</span> XP · +<span data-to="${r.coins}">0</span> 코인</div>
          ${rank === 1 ? CROWN : ''}
          <div class="flip">
            <div class="flip-inner">
              <div class="face back"><span>?</span></div>
              <div class="face front">
                <b>${r.group_no}모둠</b>
                <span class="num">${r.members}명</span>
              </div>
            </div>
          </div>
        </div>
        <div class="block"><span>${rank}</span></div>
      </div>`;
  }).join('');
  $('podium').innerHTML = top;
  $('podium').classList.toggle('hidden', !ranking.length);
  $('stage-empty').classList.toggle('hidden', ranking.length > 0);

  const rest = ranking.filter((r) => r.rank > 3);
  $('rest').innerHTML = rest.map((r, i) => `
    <li style="--d:${(i * 0.05).toFixed(2)}s">
      <span class="r num">${r.rank}</span>
      <b>${r.group_no}모둠</b>
      <span class="num muted-d">${r.members}명</span>
      <span class="p num">+${r.xp} XP · +${r.coins} 코인</span>
    </li>`).join('');
  $('rest').classList.add('hidden');

  queue = [3, 2, 1].filter((rank) => byRank.has(rank));
  if (rest.length) queue.push('rest');
  $('next').classList.toggle('hidden', !queue.length);
}

/* ---------- 연출 ---------- */
function intro() {
  if (fancy) {
    G.timeline()
      .fromTo('.stage-dim', { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' })
      .from('.stage-label', { y: -20, opacity: 0, duration: 0.5 }, '-=0.2')
      .from('.slot:not(.empty) .block', { scaleY: 0, transformOrigin: '50% 100%', duration: 0.8, ease: 'power3.out', stagger: 0.12 }, '-=0.2')
      .from('.slot:not(.empty) .flip', { y: 40, opacity: 0, duration: 0.5, ease: 'back.out(1.6)', stagger: 0.1 }, '-=0.5');
  } else {
    $('stage').classList.add('plain');
  }
}

function countPts(slot) {
  slot.querySelectorAll('.pts [data-to]').forEach((el) => countUp(el, Number(el.dataset.to), 900));
}

function revealRank(rank) {
  const slot = $('podium').querySelector(`.slot[data-rank="${rank}"]`);
  if (!slot) return;
  if (fancy) {
    const flip = slot.querySelector('.flip');
    const tl = G.timeline({ onComplete: () => slot.classList.add('is-open') });
    tl.to(flip, { y: -24, duration: 0.2, ease: 'power2.out' })
      .to(slot.querySelector('.flip-inner'), { rotateY: 180, duration: 0.8, ease: 'back.out(1.4)' }, '<')
      .to(flip, { y: 0, duration: 0.5, ease: 'bounce.out' }, '-=0.3')
      .fromTo(slot.querySelector('.pts'), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power2.out', onStart: () => countPts(slot) }, '-=0.4');
    if (rank === 1) {
      tl.fromTo(slot.querySelector('.rays-bg'), { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'power2.out' }, 0.2)
        .fromTo(slot.querySelector('.crown'), { y: -220, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: 'bounce.out' }, 0.5)
        .call(burst, null, 0.6);
    }
  } else {
    slot.classList.add('is-open');
    countPts(slot);
    if (rank === 1) burst();
  }
}

function showRest() {
  $('rest').classList.remove('hidden');
  $('rest').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'end' });
  if (fancy) G.from('#rest li', { y: -16, opacity: 0, duration: 0.45, stagger: 0.06, ease: 'power2.out' });
}

function burst() {
  const C = window.confetti;
  if (!C || reduceMotion) return;
  const n = isLite ? 50 : 150;
  const colors = ['#2457E6', '#F2B705', '#22C582', '#B79CFF', '#FF7A45', '#FFFFFF'];
  C({ particleCount: n, spread: 70, angle: 60, origin: { x: 0, y: 0.8 }, colors });
  C({ particleCount: n, spread: 70, angle: 120, origin: { x: 1, y: 0.8 }, colors });
  setTimeout(() => C({ particleCount: n, spread: 110, startVelocity: 45, origin: { x: 0.5, y: 0.35 }, colors }), 450);
}

function next() {
  const step = queue.shift();
  if (step === undefined) return;
  if (step === 'rest') showRest();
  else revealRank(step);
  $('next').classList.toggle('hidden', !queue.length);
}

$('next').addEventListener('click', (e) => { e.stopPropagation(); next(); });
$('home').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!embed && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  location.reload();
});
$('stage').addEventListener('click', (e) => { if (!e.target.closest('a, button')) next(); });
addEventListener('keydown', (e) => {
  if ($('stage').classList.contains('hidden')) return;
  if ([' ', 'Enter', 'ArrowRight', 'PageDown'].includes(e.key)) {
    e.preventDefault();
    next();
  }
});

/* ---------- 시작 ---------- */
teacherGate($('app'), async () => {
  if (!CLASSES.includes(classId)) return showClassPicker();
  await loadReady();
  onSubmissionsChange(scheduleReady);
});
