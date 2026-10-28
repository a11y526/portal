// 이번 달 순위표: 전체 TOP 40 + 우리 반 TOP 10 (시상대 1~3위 + 나머지, 캐릭터)
import { CLASSES, GRADE } from '../config.js';
import { initUI, esc, countUp, isLite } from '../ui.js';
import { getMonthTop20 } from '../db.js';
import { readLogin } from '../login.js';
import { avatarSVG, react, setDance, bindReactions } from '../avatar.js';

initUI({
  orbs: [
    { color: 'blue',  size: 600, left: '-200px', top: '-220px' },
    { color: 'peach', size: 520, right: '-180px', top: '80px' },
    { color: 'violet', size: 480, left: '25%', top: '640px' },
  ],
});
bindReactions();

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const RING = { 1: 'var(--gold)', 2: 'var(--silver)', 3: 'var(--bronze)' };
const CROWN = `<svg class="crown-ic" width="40" height="30" viewBox="0 0 40 30" fill="#F2B705" stroke="#B88600" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 26 L6 7 L14 15 L20 3 L26 15 L34 7 L37 26 Z"/></svg>`;

const login = readLogin();
let data = null;
let mode = 'all';   // 'all' (전체 TOP 40) | 'class' (우리 반 TOP 10)
let waveTimer = null;

$('scope').textContent = `${GRADE}학년 ${CLASSES[0]}~${CLASSES[CLASSES.length - 1]}반 · 이번 달 XP`;
if (login?.class_id) $('tab-class').textContent = `${login.class_id}반 TOP 10`;

let mark = null;
try { mark = JSON.parse(sessionStorage.getItem('me-mark') || 'null'); } catch {}
const isMine = (r) => r.me != null
  ? Boolean(r.me)
  : (mode === 'all' && !!mark && r.class_id === mark.c && r.rank === mark.r && r.xp === mark.xp);

const nameOf = (r) => r.nickname ? esc(r.nickname) : '<span class="muted">닉네임 미정</span>';

function moveHtml(m) {
  if (m === 'new') return '<span class="rr-move mv-new">NEW</span>';
  if (typeof m !== 'number') return '<span class="rr-move"></span>';
  if (m > 0) return `<span class="rr-move mv-up">▲${m}</span>`;
  if (m < 0) return `<span class="rr-move mv-down">▼${-m}</span>`;
  return '<span class="rr-move">–</span>';
}

function podiumSlot(r) {
  if (!r) return '<div class="pod empty" aria-hidden="true"></div>';
  const top = Math.min(r.rank, 3);
  const mine = isMine(r);
  return `
    <div class="pod" data-rank="${top}" style="--ring:${RING[top]}">
      <div class="pod-top">
        ${top === 1 ? CROWN : ''}
        <span class="pod-av">${avatarSVG(r.avatar, top === 1 ? 96 : 80, { label: r.nickname || '캐릭터', live: true })}</span>
        <span class="pod-name">${nameOf(r)}</span>
        <span class="rr-tags"><span class="chip">${r.class_id}반</span>${mine ? '<span class="me-chip">나</span>' : ''}</span>
        <span class="pod-xp"><span class="num" data-xp="${r.xp}">0</span><small> XP</small></span>
      </div>
      <div class="pod-block glass-strong${top === 1 ? ' shine' : ''}"><span class="num">${r.rank}</span></div>
    </div>`;
}

function rowHtml(r) {
  const mine = isMine(r);
  return `
    <li class="rank-row${mine ? ' is-mine' : ''}">
      <span class="rr-rank num">${r.rank}</span>
      ${avatarSVG(r.avatar, 40, { label: r.nickname || '캐릭터' })}
      <span class="rr-who">
        <span class="rr-name">${nameOf(r)}</span>
        <span class="rr-tags"><span class="chip">${r.class_id}반</span>${mine ? '<span class="me-chip">나</span>' : ''}</span>
      </span>
      ${moveHtml(r.move)}
      <span class="rr-xp"><span class="num">${r.xp}</span><small> XP</small></span>
    </li>`;
}

function render() {
  if (waveTimer) {
    clearInterval(waveTimer);
    waveTimer = null;
  }

  const m = Number(String(data?.month || '').split('-')[1]);
  const hasServerClass = data && 'my_class' in data;
  const myClass = hasServerClass ? data.my_class : (login?.class_id ?? null);
  $('tab-class').textContent = myClass ? `${myClass}반 TOP 10` : '우리 반 TOP 10';

  document.querySelectorAll('#rank-tabs [data-mode]').forEach((btn) => {
    const on = btn.dataset.mode === mode;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-selected', on);
  });

  if (mode === 'class') {
    const clsText = myClass ? `${myClass}반` : '우리 반';
    $('scope').textContent = `${GRADE}학년 ${clsText} · 이번 달 XP`;
    $('month-title').textContent = m ? `${m}월 ${clsText} TOP 10` : `${clsText} TOP 10`;
    if (m) document.title = `${m}월 ${clsText} TOP 10`;
    $('rows').setAttribute('aria-label', '4~10위');
  } else {
    $('scope').textContent = `${GRADE}학년 ${CLASSES[0]}~${CLASSES[CLASSES.length - 1]}반 · 이번 달 XP`;
    $('month-title').textContent = m ? `${m}월 TOP 40` : 'TOP 40';
    if (m) document.title = `${m}월 TOP 40`;
    $('rows').setAttribute('aria-label', '4~40위');
  }

  if (m) {
    $('reset-note').textContent = `${m === 12 ? 1 : m + 1}월 1일에 새로 시작해요`;
  }

  if (mode === 'class' && !myClass) {
    $('podium').innerHTML = '';
    $('rows').classList.add('hidden');
    $('empty').innerHTML = '<strong>로그인하면 우리 반 순위를 볼 수 있어요</strong><a class="btn btn-primary press" href="index.html">로그인</a>';
    $('empty').classList.remove('hidden');
    return;
  }

  let rows = data?.rows ?? [];
  if (mode === 'class') {
    if (hasServerClass) {
      rows = data?.class_rows ?? [];
    } else {
      let prevXp = null, rnk = 0;
      rows = rows
        .filter((r) => r.class_id === myClass)
        .map((r, i) => {
          if (r.xp !== prevXp) { rnk = i + 1; prevXp = r.xp; }
          return { ...r, rank: rnk };
        })
        .filter((r) => r.rank <= 10);
    }
  }
  if (!rows.length) {
    $('podium').innerHTML = '';
    $('rows').classList.add('hidden');
    $('empty').innerHTML = '<strong>아직 이번 달 기록이 없어요</strong>';
    $('empty').classList.remove('hidden');
    return;
  }

  $('empty').classList.add('hidden');
  const [first, second, third] = rows;
  $('podium').innerHTML = podiumSlot(second) + podiumSlot(first) + podiumSlot(third);
  const rest = rows.slice(3);
  $('rows').innerHTML = rest.map(rowHtml).join('');
  $('rows').classList.toggle('hidden', !rest.length);

  animate();
}

function animate() {
  const pods = [...document.querySelectorAll('.pod:not(.empty)')]
    .sort((a, b) => b.dataset.rank - a.dataset.rank);   // 3위 → 2위 → 1위 차례로
  const rowsEl = [...document.querySelectorAll('.rank-row')];
  document.querySelectorAll('[data-xp]').forEach((el) => countUp(el, Number(el.dataset.xp)));

  const G = window.gsap;
  if (G && !isLite && !reduceMotion) {
    const tl = G.timeline();
    pods.forEach((p, i) => {
      const t = i * 0.18;
      tl.from(p.querySelector('.pod-block'), { scaleY: 0, transformOrigin: '50% 100%', duration: 0.9, ease: 'power3.out' }, t);
      tl.from(p.querySelector('.pod-top'), { y: 50, opacity: 0, duration: 0.7, ease: 'back.out(1.7)' }, t + 0.3);
    });
    const crown = document.querySelector('.crown-ic');
    if (crown) tl.from(crown, { y: -90, opacity: 0, rotation: -25, duration: 0.8, ease: 'bounce.out' }, '-=0.25');
    if (rowsEl.length) tl.from(rowsEl, { y: -18, opacity: 0, duration: 0.45, ease: 'power2.out', stagger: 0.04 }, 0.7);
    tl.add(startMotions);
  } else {
    pods.forEach((p, i) => {
      p.querySelector('.pod-block').classList.add('grow');
      p.querySelector('.pod-block').style.setProperty('--d', `${i * 0.15}s`);
      p.querySelector('.pod-top').classList.add('pop');
      p.querySelector('.pod-top').style.setProperty('--d', `${i * 0.15 + 0.25}s`);
    });
    rowsEl.forEach((r, i) => { r.classList.add('rise'); r.style.setProperty('--d', `${(0.6 + i * 0.04).toFixed(2)}s`); });
    setTimeout(startMotions, 900);
  }
}

// 1위는 춤(반복), 2·3위는 가끔 손 흔들기
function startMotions() {
  document.querySelectorAll('.pod[data-rank="1"] svg.av').forEach((s) => setDance(s, true));
  const others = [...document.querySelectorAll('.pod[data-rank="2"] svg.av, .pod[data-rank="3"] svg.av')];
  if (!others.length || reduceMotion) return;
  waveTimer = setInterval(() => {
    if (document.hidden) return;
    react(others[Math.floor(Math.random() * others.length)], 'wave');
  }, 5000);
}

$('rank-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn || btn.dataset.mode === mode) return;
  mode = btn.dataset.mode;
  if (data) render();
});

async function load() {
  try {
    data = await getMonthTop20(login?.token ?? null);
    render();
  } catch (err) {
    console.error(err);
    $('empty').innerHTML = `<strong>${
      err.message === 'NOT_CONFIGURED' ? 'config.js에 Supabase 주소와 키를 넣어야 해요' : '불러오지 못했어요'
    }</strong>`;
    $('empty').classList.remove('hidden');
  }
}

load();
