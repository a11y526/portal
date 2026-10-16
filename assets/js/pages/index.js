// 입구: 로그인(반·번호·코드) → 왼쪽 내 캐릭터, 오른쪽 수업·마이페이지·이번 달 순위
// 로그인은 로그아웃할 때까지 유지된다(login.js). 코드 없이 수업(패들렛)만 볼 수도 있다.
import { CLASSES, GRADE } from '../config.js';
import { initUI, toast, prepareDraw } from '../ui.js';
import { studentLogin, studentLogout, getMyPage, getOmok, rkState, omState } from '../db.js';
import { readLogin, saveLogin, clearLogin } from '../login.js';
import { mountAvatar, react, bindReactions } from '../avatar.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const ERR = {
  CLASS_LOCKED: '지금은 잠겨 있어요',
  LOCKED: '여러 번 틀렸어요. 10분 뒤에 다시 해 주세요',
  BAD_CODE: '반, 번호 또는 코드가 맞지 않아요',
};

/* ---------- 로그인 ---------- */
let pickClass = Number(store.get('lastClass'));
if (!CLASSES.includes(pickClass)) pickClass = null;

const who = (n) => (n === 0 ? '선생님' : `${n}번`);

function savedNum(c) {
  const raw = store.get('num-' + c);
  const n = Number(raw);
  return /^\d{1,2}$/.test(String(raw ?? '')) && n <= 99 ? n : null;
}

function renderClassPick() {
  $('cls-pick').innerHTML = CLASSES.map((n) => `
    <button type="button" role="radio" class="login-cls press${n === pickClass ? ' on' : ''}" aria-checked="${n === pickClass}" data-c="${n}">
      <b class="num">${n}</b><span>반</span>
    </button>`).join('');
}

$('cls-pick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-c]');
  if (!b) return;
  pickClass = Number(b.dataset.c);
  renderClassPick();
  const n = savedNum(pickClass);
  $('num-in').value = n ?? '';
  (n != null ? $('code-in') : $('num-in')).focus();
});

$('guest').innerHTML = CLASSES.map((n) => `<a class="guest-link glass lift" href="class.html?c=${n}">${n}반</a>`).join('');

function showLogin() {
  $('v-home').classList.add('hidden');
  $('logout').classList.add('hidden');
  $('top-rank').classList.remove('hidden');
  $('v-login').classList.remove('hidden');
  renderClassPick();
  $('num-in').value = pickClass ? (savedNum(pickClass) ?? '') : '';
  $('code-in').value = '';
  prepareDraw($('v-login'));
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const number = Number($('num-in').value.trim());
  const code = $('code-in').value.replace(/\D/g, '');
  if (!pickClass) return toast('반을 골라 주세요', 'error');
  if (!$('num-in').value.trim() || !Number.isInteger(number) || number < 0 || number > 99) return toast('번호를 확인해 주세요', 'error');
  if (code.length !== 6) return toast('코드 6자리를 넣어 주세요', 'error');

  const btn = e.currentTarget.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    const res = await studentLogin(pickClass, number, code);
    if (!res?.ok) {
      toast(ERR[res?.error] || '로그인하지 못했어요', 'error');
      $('code-in').value = '';
      $('code-in').focus();
      return;
    }
    store.set('lastClass', String(pickClass));
    store.set('num-' + pickClass, String(number));
    saveLogin(res);
    showHome(readLogin());
  } catch (err) {
    console.error(err);
    toast('로그인하지 못했어요. 다시 눌러 주세요', 'error');
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 로그인 뒤 ---------- */
async function showHome(login) {
  $('v-login').classList.add('hidden');
  $('top-rank').classList.add('hidden');
  $('logout').classList.remove('hidden');
  $('v-home').classList.remove('hidden');
  $('go-class').href = `class.html?c=${login.class_id}`;
  $('go-class-sub').textContent = `${GRADE}학년 ${login.class_id}반`;
  $('home-cls').textContent = `${login.class_id}반 · ${who(login.number)}`;
  prepareDraw($('v-home'));

  try {
    const me = await getMyPage(login.token);
    if (!me?.ok) {
      clearLogin();
      toast('다시 로그인해 주세요', 'error');
      return showLogin();
    }
    const svg = mountAvatar($('home-av'), me.avatar, 240, { label: '내 캐릭터', live: true });
    react(svg, 'wave', { delay: 500 });
    $('home-nick').textContent = me.nickname || '닉네임 미정';
    $('home-nick').classList.toggle('muted', !me.nickname);
    $('home-cls').textContent = `${me.class_id}반 · ${who(me.number)} · Lv.${me.level.level}`;
    $('go-me-sub').textContent = `레벨 ${me.level.level}`;
    $('go-shop-sub').textContent = `코인 ${me.coins}`;
    $('go-rank-sub').textContent = me.month_rank ? `전체 ${me.month_rank}위` : '';
    getOmok(login.token).then((o) => {
      if (o?.ok) $('go-omok-sub').textContent = o.open ? `오늘 ${Math.min(o.today, o.daily)} / ${o.daily}판` : '지금은 닫혀 있어요';
    }).catch(() => {});
    omState(login.token).then((r) => {
      if (!r?.ok) return;
      $('go-omp-sub').textContent = !r.open ? '지금은 닫혀 있어요'
        : r.game?.status === 'playing' ? '하는 중' : r.game?.status === 'waiting' ? '기다리는 중'
        : `오늘 ${Math.min(r.today, r.daily)} / ${r.daily}판`;
    }).catch(() => {});
    rkState(login.token).then((r) => {
      if (!r?.ok) return;
      $('go-rk-sub').textContent = !r.open ? '지금은 닫혀 있어요'
        : r.game?.status === 'playing' ? '하는 중' : r.game?.status === 'waiting' ? '기다리는 중'
        : `오늘 ${Math.min(r.today, r.daily)} / ${r.daily}판`;
    }).catch(() => {});
    try {
      if (me.month_rank) sessionStorage.setItem('me-mark', JSON.stringify({ c: me.class_id, r: me.month_rank, xp: me.month_xp }));
    } catch {}
  } catch (err) {
    console.error(err);
    toast('불러오지 못했어요', 'error');
  }
}

$('logout').addEventListener('click', async () => {
  const login = readLogin();
  clearLogin();
  showLogin();
  if (login) studentLogout(login.token).catch(() => {});
});

/* ---------- 시작 ---------- */
const login = readLogin();
if (login) showHome(login);
else showLogin();
