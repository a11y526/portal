// 마이페이지(로그인 필요): 캐릭터, 레벨 고리, XP 바, 이번 달 순위, 코인, 받은 기록, 닉네임 신청, 꾸미기, 레벨업 연출
import { initUI, toast, esc, countUp, isLite } from '../ui.js';
import { getMyPage, requestNickname, saveAvatar } from '../db.js';
import { readLogin, clearLogin } from '../login.js';
import { avatarSVG, mountAvatar, react, bindReactions, normalize } from '../avatar.js';
import { PARTS, SLOTS, SLOT_NAMES } from '../avatar-parts.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const RING = 339.3;

const ERR = {
  BAD_NICK: '2~8자, 한글·영문·숫자만 쓸 수 있어요',
  SAME: '지금 닉네임과 같아요',
  TAKEN: '다른 친구가 쓰고 있는 닉네임이에요',
  BAD_ITEM: '입을 수 없는 부품이 있어요',
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const login = readLogin();
let me = null;        // get_my_page 결과
let wearing = null;   // 저장된 캐릭터
let draft = null;     // 고르는 중인 캐릭터
let slot = null;      // 꾸미기에서 보고 있는 칸
let heroSvg = null;

// 로그인이 풀렸으면(로그아웃, 반 잠금, 코드 다시 발급) 첫 화면으로
function goLogin() {
  clearLogin();
  location.replace('index.html');
}

/* ---------- 내 기록 ---------- */
function open(data) {
  me = data;
  wearing = normalize(data.avatar);
  draft = { ...wearing };
  $('me').classList.remove('hidden');
  // 순위표에서 내 줄을 표시하려고 (이 탭에서만)
  try {
    if (data.month_rank) sessionStorage.setItem('me-mark', JSON.stringify({ c: data.class_id, r: data.month_rank, xp: data.month_xp }));
    else sessionStorage.removeItem('me-mark');
  } catch {}

  renderHero();
  renderNick();
  renderLevel();
  renderStats();
  renderHistory();
  renderPurchases();
  slot = null;
  renderWardrobe();
  checkLevelUp();
}

function renderHero() {
  heroSvg = mountAvatar($('hero-av'), draft, 200, { label: '내 캐릭터', live: true });
}

function renderNick() {
  $('nick').textContent = me.nickname || '닉네임 미정';
  $('nick').classList.toggle('muted', !me.nickname);
  $('cls-chip').textContent = `${me.class_id}반` + (me.today_group ? ` · ${me.today_group}모둠` : '');
  const st = $('nick-state');
  const req = me.nickname_request;
  if (me.nickname_status === 'pending' && req) {
    st.className = 'tag tag-pending';
    st.textContent = `${req} · 승인 대기`;
  } else if (me.nickname_status === 'rejected' && req) {
    st.className = 'tag tag-warn';
    st.textContent = `${req} · 거절됨`;
  } else {
    st.className = 'tag hidden';
  }
  $('nick-open').textContent = me.nickname ? '닉네임 바꾸기' : '닉네임 정하기';
  $('nick-open').classList.remove('hidden');
  $('nick-form').classList.add('hidden');
}

$('nick-open').addEventListener('click', () => {
  $('nick-form').classList.remove('hidden');
  $('nick-open').classList.add('hidden');
  $('nick-in').value = '';
  $('nick-in').focus();
});
$('nick-cancel').addEventListener('click', renderNick);

$('nick-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nick = $('nick-in').value.trim();
  if (nick.length < 2 || nick.length > 8 || !/^[가-힣A-Za-z0-9]+$/.test(nick)) return toast(ERR.BAD_NICK, 'error');
  const btn = e.currentTarget.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    const res = await requestNickname(login.token, nick);
    if (!res?.ok) {
      if (res?.error === 'NO_SESSION') return goLogin();
      toast(ERR[res?.error] || '신청하지 못했어요', 'error');
      return;
    }
    me.nickname_request = res.nickname_request;
    me.nickname_status = res.nickname_status;
    renderNick();
    toast('신청했어요', 'ok');
  } catch (err) {
    console.error(err);
    toast('신청하지 못했어요. 다시 눌러 주세요', 'error');
  } finally {
    btn.disabled = false;
  }
});

function levelProgress(lv) {
  const span = Math.max(1, lv.next - lv.floor);
  return Math.min(1, Math.max(0, (me.total_xp - lv.floor) / span));
}

function renderLevel() {
  const lv = me.level;
  const p = levelProgress(lv);
  $('lv').textContent = lv.level;
  $('lv-next').textContent = `레벨 ${lv.level + 1}까지`;
  $('lv-left').textContent = `${Math.max(0, lv.next - me.total_xp)} XP 남음`;

  const arc = $('lv-arc');
  arc.style.transition = 'none';
  arc.style.strokeDashoffset = RING;
  void arc.getBoundingClientRect();
  arc.style.transition = '';
  requestAnimationFrame(() => { arc.style.strokeDashoffset = (RING * (1 - p)).toFixed(1); });

  const fill = $('xp-fill');
  fill.style.width = (p * 100).toFixed(1) + '%';
  fill.classList.remove('fill');
  void fill.offsetWidth;
  fill.classList.add('fill');
}

function moveText(m) {
  if (m === 'new') return '<b class="mv mv-new">NEW</b>';
  if (typeof m !== 'number') return '';
  if (m > 0) return `<b class="mv mv-up">▲${m}</b>`;
  if (m < 0) return `<b class="mv mv-down">▼${-m}</b>`;
  return '<b class="mv">–</b>';
}

function renderStats() {
  countUp($('month-xp'), me.month_xp);
  countUp($('total-xp'), me.total_xp);
  countUp($('coins'), me.coins);
  $('month-rank').innerHTML = me.month_rank ? `전체 ${me.month_rank}위 ${moveText(me.month_move)}` : '';
}

function fmtDay(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function amount(n, unit) {
  if (!n) return '';
  return `${n > 0 ? '+' : '−'}${Math.abs(n)} ${unit}`;
}

function renderHistory() {
  const list = me.history ?? [];
  $('hist').innerHTML = list.length ? list.map((h) => {
    const plus = h.xp > 0 || (h.xp === 0 && h.coins > 0);
    return `
      <div class="hist-row">
        <span class="hist-d num">${fmtDay(h.at)}</span>
        <span class="hist-w">${esc(h.reason)}</span>
        <span class="hist-a ${plus ? 'up' : 'down'}">
          <b class="num">${amount(h.xp, 'XP') || amount(h.coins, '코인')}</b>
          ${h.xp && h.coins ? `<small class="num">${amount(h.coins, '코인')}</small>` : ''}
        </span>
      </div>`;
  }).join('') : '<div class="empty"><strong>아직 받은 기록이 없어요</strong></div>';
}

const BUY_STATUS = {
  requested: ['tag-pending', '승인 대기'],
  approved: ['tag-done', '승인'],
  rejected: ['tag-warn', '거절 · 코인 돌려받음'],
};

function renderPurchases() {
  const list = me.purchases ?? [];
  $('buys').classList.toggle('hidden', !list.length);
  $('buy-list').innerHTML = list.map((p) => {
    const [cls, label] = BUY_STATUS[p.status] ?? ['tag-off', p.status];
    const extra = p.kind === 'pair' && p.partner_number ? ` · ${p.partner_number}번과 함께` : '';
    const used = p.status === 'approved' && p.kind === 'pair' && p.used ? ' · 사용함' : '';
    return `
      <div class="hist-row">
        <span class="hist-d num">${fmtDay(p.requested_at)}</span>
        <span class="hist-w">${esc(p.name)}${esc(extra)}</span>
        <span class="tag ${cls} buy-tag">${label}${used}</span>
      </div>`;
  }).join('');
}

/* ---------- 꾸미기 ---------- */
function optionsFor(s) {
  return (me.wardrobe ?? []).filter((it) => it.slot === s && PARTS[s]?.[it.id]).map((it) => it.id);
}

function renderWardrobe() {
  const slots = SLOTS.filter((s) => optionsFor(s).length > 1);
  if (!slots.includes(slot)) slot = slots.includes('hair') ? 'hair' : slots[0];
  $('slot-tabs').innerHTML = slots.map((s) => `
    <button type="button" role="tab" class="cls-tab press${s === slot ? ' on' : ''}" aria-selected="${s === slot}" data-slot="${s}">${SLOT_NAMES[s]}</button>`).join('');
  $('wear-grid').innerHTML = slot ? optionsFor(slot).map((id) => `
    <button type="button" role="radio" class="wear-opt press" aria-checked="${draft[slot] === id}" data-id="${id}">
      ${avatarSVG({ ...draft, [slot]: id }, 72, { label: PARTS[slot][id].name })}
      <span>${esc(PARTS[slot][id].name)}</span>
    </button>`).join('') : '';
  updateWearButtons();
}

function changed() {
  return SLOTS.some((s) => draft[s] !== wearing[s]);
}

function updateWearButtons() {
  $('wear-save').disabled = !changed();
  $('wear-undo').classList.toggle('hidden', !changed());
}

$('slot-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-slot]');
  if (!b) return;
  slot = b.dataset.slot;
  renderWardrobe();
});

$('wear-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b || draft[slot] === b.dataset.id) return;
  draft = { ...draft, [slot]: b.dataset.id };
  $('wear-grid').querySelectorAll('[data-id]').forEach((x) => x.setAttribute('aria-checked', x === b));
  renderHero();
  react(heroSvg, 'jump');
  updateWearButtons();
});

$('wear-undo').addEventListener('click', () => {
  draft = { ...wearing };
  renderHero();
  renderWardrobe();
});

$('wear-save').addEventListener('click', async () => {
  const btn = $('wear-save');
  btn.disabled = true;
  try {
    const res = await saveAvatar(login.token, draft);
    if (!res?.ok) {
      if (res?.error === 'NO_SESSION') return goLogin();
      toast(ERR[res?.error] || '저장하지 못했어요', 'error');
      updateWearButtons();
      return;
    }
    wearing = normalize(res.avatar);
    draft = { ...wearing };
    me.avatar = res.avatar;
    updateWearButtons();
    react(heroSvg, 'wave');
    toast('저장했어요', 'ok');
  } catch (err) {
    console.error(err);
    toast('저장하지 못했어요. 다시 눌러 주세요', 'error');
    updateWearButtons();
  }
});

/* ---------- 레벨업: 이 기기에서 지난번에 본 레벨보다 오르면 ---------- */
function checkLevelUp() {
  const key = `lv-${me.class_id}-${me.number}`;
  const seen = Number(store.get(key)) || 0;
  const lv = me.level.level;
  store.set(key, String(Math.max(seen, lv)));
  if (seen && lv > seen) showLevelUp(lv);
}

function showLevelUp(lv) {
  const box = $('lvup');
  $('lvup-n').textContent = lv;
  $('lvup-s').textContent = `누적 ${me.total_xp} XP 달성`;
  $('lvup-av').innerHTML =
    `<svg class="lvup-ring" viewBox="0 0 136 136" aria-hidden="true"><circle cx="68" cy="68" r="64" fill="none" stroke="rgba(36,87,230,.12)" stroke-width="6"/>` +
    `<circle id="lvup-arc" cx="68" cy="68" r="64" fill="none" stroke="#2457E6" stroke-width="6" stroke-linecap="round" stroke-dasharray="402.1" stroke-dashoffset="402.1" transform="rotate(-90 68 68)"/></svg>` +
    avatarSVG(me.avatar, 160, { label: '내 캐릭터' });
  const av = $('lvup-av').querySelector('svg.av');
  av.dataset.still = '';
  box.classList.remove('hidden');
  $('lvup-ok').focus();

  const G = window.gsap;
  const arc = $('lvup-arc');
  if (G && !isLite && !reduceMotion) {
    G.timeline()
      .from(box, { opacity: 0, duration: 0.3 })
      .from('.lvup-rays', { scale: 0.2, opacity: 0, duration: 0.7, ease: 'power2.out' }, '<')
      .from('.lvup-card', { scale: 0.4, opacity: 0, duration: 0.6, ease: 'back.out(1.6)' }, '-=0.4')
      .from('#lvup-n', { scale: 3, opacity: 0, duration: 0.6, ease: 'power3.out' }, '-=0.2')
      .to(arc, { strokeDashoffset: 0, duration: 1.2, ease: 'power2.inOut' }, '-=0.4')
      .add(() => { react(av, 'levelup'); burst(); }, '-=0.6');
  } else {
    box.classList.add('lvup-plain');
    arc.style.strokeDashoffset = 0;
    setTimeout(() => { react(av, 'levelup'); burst(); }, 300);
  }
}

function burst() {
  const C = window.confetti;
  if (!C || reduceMotion) return;
  C({ particleCount: isLite ? 40 : 110, spread: 80, startVelocity: 42, origin: { y: 0.45 }, zIndex: 60 });
}

$('lvup-ok').addEventListener('click', () => {
  $('lvup').classList.add('hidden');
  $('lvup').classList.remove('lvup-plain');
});

/* ---------- 시작 ---------- */
async function load() {
  if (!login) return goLogin();
  try {
    const res = await getMyPage(login.token);
    if (!res?.ok) return goLogin();
    open(res);
  } catch (err) {
    console.error(err);
    toast('불러오지 못했어요. 새로고침해 주세요', 'error');
  }
}

load();
