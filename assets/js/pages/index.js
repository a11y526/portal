// 입구: 로그인(반·번호·코드) → 왼쪽 내 캐릭터, 오른쪽 수업·마이페이지·이번 달 순위, 아래 우리 반 게시판
// 로그인은 로그아웃할 때까지 유지된다(login.js). 코드 없이 수업(게시판)만 볼 수도 있다.
// test.html은 같은 화면을 test반 하나로 쓴다(<main data-test>): 반 고르기·코드 없이 보기 없음
import { CLASSES, TEST_CLASS, GRADE, IS_MAIN, clsName } from '../config.js';
import { initUI, toast, prepareDraw, countUp } from '../ui.js';
import { studentLogin, studentSignup, studentLogout, getMyPage, getClassMaterials, onClassRefresh } from '../db.js';
import { getOmok } from '../db.js'; // nogame
import { setTop, refreshTop } from '../topbar.js';
import { readLogin, saveLogin, clearLogin } from '../login.js';
import { mountAvatar, react, bindReactions } from '../avatar.js';
import { materialsHTML, bindVideos, closeVideos } from '../materials.js';

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
const TEST = 'test' in document.querySelector('main').dataset;
const PICKS = TEST ? [TEST_CLASS] : CLASSES;
let pickClass = TEST ? TEST_CLASS : Number(store.get('lastClass'));
if (!PICKS.includes(pickClass)) pickClass = null;

const who = (n) => (n === 0 ? '선생님' : `${n}번`);

function savedNum(c) {
  const raw = store.get('num-' + c);
  const n = Number(raw);
  return /^\d{1,2}$/.test(String(raw ?? '')) && n <= 99 ? n : null;
}

function renderClassPick() {
  $('cls-pick').innerHTML = PICKS.map((n) => `
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

if (TEST) {
  $('cls-pick').closest('.field').classList.add('hidden');
  $('guest').closest('.guest').classList.add('hidden');
}
$('guest').innerHTML = CLASSES.map((n) => `<a class="guest-link glass lift" href="class.html?c=${n}">${clsName(n)}반</a>`).join('');

function showLogin() {
  hideMats();
  $('v-signup').classList.add('hidden');
  $('v-signed').classList.add('hidden');
  $('v-home').classList.add('hidden');
  $('logout').classList.add('hidden');
  $('top-rank').classList.remove('hidden');
  $('v-login').classList.remove('hidden');
  renderClassPick();
  $('num-in').value = pickClass ? (savedNum(pickClass) ?? '') : '';
  $('code-in').value = '';
  fillSlots();
  prepareDraw($('v-login'));
}

function fillSlots() {
  const n = $('code-in').value.replace(/\D/g, '').length;
  $('code-slots').querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < n));
}
$('code-in').addEventListener('input', () => {
  $('code-in').classList.remove('shake');
  fillSlots();
});

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
      const inp = $('code-in');
      inp.value = '';
      fillSlots();
      inp.classList.remove('shake');
      void inp.offsetWidth;
      inp.classList.add('shake');
      inp.focus();
      return;
    }
    if (!TEST) store.set('lastClass', String(pickClass));
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

/* ---------- 학번으로 첫 가입 (다른 선생님 사이트만) ----------
   학번 10701 = 1학년 7반 1번. 선생님이 [가입 열기]를 누른 반에서, 아직 코드가 없는 번호만 가입한다 */
const SU_ERR = {
  SIGNUP_CLOSED: '가입 닫힘. 선생님께 말하기',
  CLASS_LOCKED: '반이 잠겨 있음',
  NO_STUDENT: '명단에 없는 번호. 선생님께 말하기',
  TAKEN: '이미 가입한 번호. 코드를 잊었으면 선생님께',
  WEAK: '너무 쉬운 코드. 다른 숫자로',
  BAD_CODE: '코드는 숫자 6자리',
};

// '10701' → { cls: 7, num: 1 } · 맞지 않으면 null
function parseId(v) {
  const m = /^(\d)(\d{2})(\d{2})$/.exec(v);
  if (!m || Number(m[1]) !== GRADE) return null;
  const cls = Number(m[2]);
  const num = Number(m[3]);
  if (!CLASSES.includes(cls) || num < 1) return null;
  return { cls, num };
}

function showSignup() {
  $('v-login').classList.add('hidden');
  $('v-signed').classList.add('hidden');
  $('v-signup').classList.remove('hidden');
  for (const id of ['su-id', 'su-code', 'su-code2']) $(id).value = '';
  showWho();
  scrollTo(0, 0);
  prepareDraw($('v-signup'));
  $('su-id').focus();
}

function showWho() {
  const v = $('su-id').value.replace(/\D/g, '');
  const p = parseId(v);
  const el = $('su-who');
  el.classList.toggle('bad', v.length === 5 && !p);
  el.textContent = p ? `${GRADE}학년 ${p.cls}반 ${p.num}번` : v.length === 5 ? '학번 확인' : '';
}

if (!IS_MAIN && !TEST) {
  $('first-row').classList.remove('hidden');
  $('go-signup').addEventListener('click', showSignup);
  $('su-back').addEventListener('click', showLogin);
  $('su-id').addEventListener('input', showWho);
  $('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = parseId($('su-id').value.replace(/\D/g, ''));
    const code = $('su-code').value.replace(/\D/g, '');
    if (!p) { toast('학번 5자리 확인', 'error'); return $('su-id').focus(); }
    if (code.length !== 6) { toast('코드는 숫자 6자리', 'error'); return $('su-code').focus(); }
    if (code !== $('su-code2').value.replace(/\D/g, '')) {
      toast('두 코드가 다름', 'error');
      $('su-code2').value = '';
      return $('su-code2').focus();
    }
    const btn = e.currentTarget.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const res = await studentSignup(p.cls, p.num, code);
      if (!res?.ok) return toast(SU_ERR[res?.error] || '가입 실패', 'error');
      store.set('lastClass', String(p.cls));
      store.set('num-' + p.cls, String(p.num));
      saveLogin(res);
      pickClass = p.cls;
      $('v-signup').classList.add('hidden');
      $('sd-who').textContent = `${GRADE}학년 ${p.cls}반 ${p.num}번`;
      $('sd-code').textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
      $('v-signed').classList.remove('hidden');
      scrollTo(0, 0);
      prepareDraw($('v-signed'));
    } catch (err) {
      console.error(err);
      toast('가입 실패. 다시 누르기', 'error');
    } finally {
      btn.disabled = false;
    }
  });
  $('sd-go').addEventListener('click', () => {
    $('sd-code').textContent = '';
    $('v-signed').classList.add('hidden');
    const l = readLogin();
    if (l) showHome(l); else showLogin();
  });
}

/* ---------- 크롬 새 탭 바로가기 안내 (다른 선생님 사이트만) ---------- */
if (!IS_MAIN && !TEST) {
  $('install-app').addEventListener('click', () => {
    $('install-addr').textContent = (location.host + location.pathname.replace(/[^/]*$/, '')).replace(/\/$/, '');
    $('install-dlg').showModal();
  });
  $('install-close').addEventListener('click', () => $('install-dlg').close());
}

/* ---------- 로그인 뒤 ---------- */
async function showHome(login) {
  refreshTop();
  $('v-signup').classList.add('hidden');
  $('v-signed').classList.add('hidden');
  $('v-login').classList.add('hidden');
  $('top-rank').classList.add('hidden');
  $('logout').classList.remove('hidden');
  $('v-home').classList.remove('hidden');
  $('go-class').href = `class.html?c=${login.class_id}`;
  $('go-class-sub').textContent = `${GRADE}학년 ${clsName(login.class_id)}반`;
  $('home-cls').textContent = `${clsName(login.class_id)}반 · ${who(login.number)}`;
  prepareDraw($('v-home'));
  startMats(login);

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
    $('home-cls').textContent = `${clsName(me.class_id)}반 · ${who(me.number)} · Lv.${me.level.level}`;
    $('go-me-sub').textContent = `레벨 ${me.level.level}`;
    $('go-shop-sub').textContent = `금화 ${me.coins} · 은화 ${me.silver ?? 0}`;
    $('go-rank-sub').textContent = me.month_rank ? `전체 ${me.month_rank}위` : '';
    setTop({ coins: me.coins, silver: me.silver ?? 0, avatar: me.avatar });
    const lv = me.level || {};
    $('home-lv-n').textContent = `Lv.${lv.level ?? 1}`;
    $('home-lv-xp').textContent = lv.next ? `${me.total_xp} / ${lv.next} XP` : `${me.total_xp} XP`;
    const span = lv.next ? lv.next - (lv.floor ?? 0) : 0;
    $('home-bar').style.transform = `scaleX(${span ? Math.min(1, Math.max(0, (me.total_xp - (lv.floor ?? 0)) / span)) : 1})`;
    $('hs-rank').textContent = me.month_rank ?? '–';
    countUp($('hs-coins'), me.coins);
    countUp($('hs-silver'), me.silver ?? 0);
    $('home-lv').classList.remove('hidden');
    $('home-stats').classList.remove('hidden');
/* nogame:start */
    // 게임은 오목 스위치 하나로 모두 켜고 끈다(오목·루미큐브·쿼리도)
    getOmok(login.token).then((o) => {
      if (o?.ok) { $('go-games').hidden = !o.open; setTop({ games: !!o.open }); }
    }).catch(() => {});
/* nogame:end */
    try {
      if (me.month_rank) sessionStorage.setItem('me-mark', JSON.stringify({ c: me.class_id, r: me.month_rank, xp: me.month_xp }));
    } catch {}
  } catch (err) {
    console.error(err);
    toast('불러오지 못했어요', 'error');
  }
}

/* ---------- 우리 반 게시판 ----------
   반 페이지 [게시판] 탭과 같은 자료(get_class_materials). 버전이 같으면 다시 그리지 않는다.
   반 새로고침 신호와 15초마다(화면이 숨겨져 있으면 멈춤) 버전을 확인한다 */
const MATS_MS = 15000;
const mats = { login: null, v: null, busy: false, timer: 0, sub: 0 };
bindVideos($('home-mats-board'));

function hideMats() {
  mats.login = null;
  mats.v = null;
  clearInterval(mats.timer);
  closeVideos($('home-mats'));
  $('home-mats').classList.add('hidden');
  $('home-mats-board').innerHTML = '';
}

function startMats(login) {
  hideMats();
  mats.login = login;
  if (mats.sub !== login.class_id) {
    mats.sub = login.class_id;
    onClassRefresh(login.class_id, () => { if (mats.login?.class_id === mats.sub) loadMats(); });
  }
  loadMats();
  mats.timer = setInterval(() => { if (!document.hidden) loadMats(); }, MATS_MS);
}

async function loadMats() {
  const login = mats.login;
  if (!login || mats.busy) return;
  mats.busy = true;
  try {
    const res = await getClassMaterials(login.class_id, login.token, mats.v);
    if (login !== mats.login || !res?.ok || res.same) return;
    mats.v = res.v;
    closeVideos($('home-mats'));
    const has = res.sections.some((s) => s.items?.length);
    $('home-mats').classList.toggle('hidden', !has);
    $('home-mats-board').innerHTML = has ? materialsHTML(res.sections.filter((s) => s.items?.length)) : '';
  } catch (err) {
    console.error(err);
  } finally {
    mats.busy = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) closeVideos($('home-mats'));
  else loadMats();
});

$('logout').addEventListener('click', async () => {
  const login = readLogin();
  clearLogin();
  showLogin();
  refreshTop();
  if (login) studentLogout(login.token).catch(() => {});
});

/* ---------- 시작 ---------- */
// test반 출입증은 test.html에서, 다른 반 출입증은 index.html에서 연다
const login = readLogin();
if (login && !TEST && login.class_id === TEST_CLASS) location.replace('test.html');
else if (login && (!TEST || login.class_id === TEST_CLASS)) showHome(login);
else showLogin();
