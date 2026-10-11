// 포인트 상점(로그인 필요): 꾸미기 아이템(미리 입어 보기 → 바로 구매·착용) / 보상(구매 신청 → 교사 승인)
import { initUI, toast, esc, countUp } from '../ui.js';
import { getShop, buyAvatarItem, requestPurchase, saveAvatar } from '../db.js';
import { readLogin, clearLogin } from '../login.js';
import { avatarSVG, mountAvatar, react, bindReactions, normalize } from '../avatar.js';
import { PARTS, SLOTS, SLOT_NAMES } from '../avatar-parts.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);

const ERR = {
  NOT_FOR_SALE: '지금은 팔지 않아요',
  OWNED: '이미 가지고 있어요',
  NO_COINS: '코인이 모자라요',
  BAD_PARTNER: '친구 번호를 다시 골라 주세요',
};
const RARITY = { common: '일반', rare: '희귀', legend: '전설' };
const STATUS = {
  requested: ['tag-pending', '승인 대기'],
  approved: ['tag-done', '승인'],
  rejected: ['tag-warn', '거절 · 코인 돌려받음'],
};

const COIN = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#F2B705"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="#B88600" stroke-width="1.6"/></svg>';
const LOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const ICON = {
  pair: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M15 20a4.5 4.5 0 0 1 6-4.2"/></svg>',
  plain: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
};

const login = readLogin();
let shop = null;     // get_shop 결과
let wearing = null;  // 저장된 캐릭터
let trying = null;   // 입어 보는 아이템 { id, slot, ... } 또는 null
let slot = null;     // 꾸미기에서 보고 있는 칸
let tab = 'deco';
let pairOpen = null; // 친구 고르기를 연 보상 id
let busy = false;
let heroSvg = null;

function goLogin() {
  clearLogin();
  location.replace('index.html');
}

const level = () => shop.level.level;
const items = () => (shop.items ?? []).filter((it) => PARTS[it.slot]?.[it.id]);
const lockedOf = (it) => !it.owned && it.min_level > level();

/* ---------- 위쪽: 내 캐릭터 + 코인 + 입어 보기 ---------- */
function renderHero(fresh = null) {
  const look = trying ? { ...wearing, [trying.slot]: trying.id } : wearing;
  heroSvg = mountAvatar($('hero-av'), look, 200, { label: '내 캐릭터', fresh, live: true });
}

function renderTryBar() {
  const bar = $('try-bar');
  if (!trying) { bar.classList.add('hidden'); return; }
  const it = trying;
  bar.classList.remove('hidden');
  $('try-name').textContent = it.name;
  const btn = $('try-buy');
  btn.disabled = false;
  if (it.owned) {
    $('try-price').innerHTML = '<span class="tag tag-done">가지고 있음</span>';
    btn.textContent = '입기';
  } else {
    $('try-price').innerHTML = `${COIN}<b class="num">${it.price}</b>` +
      (lockedOf(it) ? ` <span class="tag tag-off">Lv.${it.min_level}부터</span>` : '');
    if (lockedOf(it)) { btn.textContent = `Lv.${it.min_level}부터`; btn.disabled = true; }
    else if (shop.coins < it.price) { btn.textContent = '코인 부족'; btn.disabled = true; }
    else btn.textContent = '구매';
  }
}

function renderCoins(animate = true) {
  if (animate) countUp($('coins'), shop.coins);
  else $('coins').textContent = shop.coins;
  $('lv-chip').textContent = `레벨 ${level()}`;
}

/* ---------- 꾸미기 ---------- */
function renderDeco() {
  const all = items();
  const slots = SLOTS.filter((s) => all.some((it) => it.slot === s));
  if (!slots.includes(slot)) slot = slots[0] ?? null;
  $('slot-tabs').innerHTML = slots.map((s) => `
    <button type="button" role="tab" class="cls-tab press${s === slot ? ' on' : ''}" aria-selected="${s === slot}" data-slot="${s}">${SLOT_NAMES[s]}</button>`).join('');

  const list = all.filter((it) => it.slot === slot);
  $('deco-grid').innerHTML = list.length ? list.map((it) => {
    const worn = wearing[it.slot] === it.id;
    const locked = lockedOf(it);
    let foot;
    if (worn) foot = '<span class="tag tag-today">착용 중</span>';
    else if (it.owned) foot = '<span class="tag tag-done">가지고 있음</span>';
    else if (locked) foot = `<span class="shop-lock">${LOCK}Lv.${it.min_level}부터</span>`;
    else foot = `<span class="shop-price${shop.coins < it.price ? ' short' : ''}">${COIN}<b class="num">${it.price}</b></span>`;
    return `
      <button type="button" class="shop-item r-${esc(it.rarity)}${locked ? ' is-locked' : ''} press" aria-pressed="${trying?.id === it.id}" data-id="${esc(it.id)}">
        ${it.rarity !== 'common' ? `<span class="shop-rarity">${RARITY[it.rarity] ?? ''}</span>` : ''}
        ${avatarSVG({ ...wearing, [it.slot]: it.id }, 88, { label: it.name })}
        <span class="shop-name">${esc(it.name)}</span>
        ${foot}
      </button>`;
  }).join('') : '<div class="empty"><strong>지금 파는 아이템이 없어요</strong></div>';
}

$('slot-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-slot]');
  if (!b) return;
  slot = b.dataset.slot;
  renderDeco();
});

$('deco-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  const it = items().find((x) => x.id === b.dataset.id);
  if (!it) return;
  trying = trying?.id === it.id || wearing[it.slot] === it.id ? null : it;
  $('deco-grid').querySelectorAll('[data-id]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.id === trying?.id));
  renderHero();
  if (trying) react(heroSvg, 'jump');
  renderTryBar();
});

$('try-undo').addEventListener('click', () => {
  trying = null;
  renderHero();
  renderTryBar();
  renderDeco();
});

// 착용 저장 (산 뒤, 또는 가진 아이템 입기)
async function wear(it) {
  const next = { ...wearing, [it.slot]: it.id };
  const res = await saveAvatar(login.token, next);
  if (!res?.ok) {
    if (res?.error === 'NO_SESSION') { goLogin(); return false; }
    toast('입지 못했어요. 마이페이지에서 다시 입어 주세요', 'error');
    return false;
  }
  wearing = normalize(res.avatar);
  return true;
}

$('try-buy').addEventListener('click', async () => {
  if (!trying || busy) return;
  const it = trying;
  const btn = $('try-buy');
  busy = true;
  btn.disabled = true;
  try {
    if (!it.owned) {
      const res = await buyAvatarItem(login.token, it.id);
      if (!res?.ok) {
        if (res?.error === 'NO_SESSION') return goLogin();
        if (res?.error === 'LEVEL') toast(`Lv.${res.min_level ?? it.min_level}부터 살 수 있어요`, 'error');
        else toast(ERR[res?.error] || '사지 못했어요', 'error');
        if (res?.error === 'OWNED') it.owned = true;
        renderTryBar();
        return;
      }
      it.owned = true;
      shop.coins = res.coins;
      shop.wardrobe = [...(shop.wardrobe ?? []), { id: it.id, slot: it.slot }];
      renderCoins();
    }
    const ok = await wear(it);
    trying = null;
    renderHero(ok ? it.slot : null);
    if (ok) react(heroSvg, 'sparkle', { delay: 350 });
    renderTryBar();
    renderDeco();
    toast(ok ? `${it.name} 착용` : '샀어요', 'ok');
  } catch (err) {
    console.error(err);
    toast('사지 못했어요. 다시 눌러 주세요', 'error');
    renderTryBar();
  } finally {
    busy = false;
  }
});

/* ---------- 보상 ---------- */
function renderRewards() {
  const pend = (id) => (shop.purchases ?? []).some((p) => p.item_id === id && p.status === 'requested');
  const rewards = shop.rewards ?? [];
  $('reward-grid').innerHTML = rewards.length ? rewards.map((r) => {
    const kind = r.kind === 'pair' ? 'pair' : 'plain';
    const short = shop.coins < r.cost;
    const picking = pairOpen === r.id;
    return `
      <div class="reward glass-live">
        <div class="reward-row">
          <span class="reward-ic ic-${kind}">${ICON[kind]}</span>
          <div class="reward-txt">
            <b>${esc(r.name)}</b>
            <span>${r.cost} 코인</span>
          </div>
          ${pend(r.id)
            ? '<span class="tag tag-pending reward-tag">승인 대기</span>'
            : `<button type="button" class="btn btn-primary btn-small press reward-btn" data-req="${esc(r.id)}"${short || picking ? ' disabled' : ''}>${short ? '코인 부족' : '구매 신청'}</button>`}
        </div>
        ${picking ? `
        <form class="pair-form" data-pair="${esc(r.id)}">
          <label class="pair-label" for="pair-sel">같이 할 친구</label>
          <select class="input pair-sel" id="pair-sel" required>
            <option value="">번호</option>
            ${(shop.classmates ?? []).map((n) => `<option value="${n}">${n}번</option>`).join('')}
          </select>
          <button type="submit" class="btn btn-primary btn-small press">신청</button>
          <button type="button" class="btn btn-line btn-small" data-pair-cancel>취소</button>
        </form>` : ''}
      </div>`;
  }).join('') : '<div class="empty"><strong>지금 신청할 수 있는 보상이 없어요</strong></div>';

  const buys = shop.purchases ?? [];
  $('buy-list').innerHTML = buys.length ? buys.map((p) => {
    const [cls, label] = STATUS[p.status] ?? ['tag-off', p.status];
    const extra = p.kind === 'pair' && p.partner_number ? ` · ${p.partner_number}번과 함께` : '';
    const used = p.status === 'approved' && p.kind === 'pair' && p.used ? ' · 사용함' : '';
    return `
      <div class="hist-row">
        <span class="hist-d num">${fmtDay(p.requested_at)}</span>
        <span class="hist-w">${esc(p.name)}${esc(extra)}</span>
        <span class="tag ${cls} buy-tag">${label}${used}</span>
      </div>`;
  }).join('') : '<div class="empty"><strong>아직 신청한 보상이 없어요</strong></div>';
}

function fmtDay(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

async function sendRequest(id, partner, btn) {
  if (busy) return;
  busy = true;
  if (btn) btn.disabled = true;
  try {
    const res = await requestPurchase(login.token, id, partner);
    if (!res?.ok) {
      if (res?.error === 'NO_SESSION') return goLogin();
      toast(ERR[res?.error] || '신청하지 못했어요', 'error');
      if (btn) btn.disabled = false;
      return;
    }
    shop.coins = res.coins;
    shop.purchases = res.purchases;
    pairOpen = null;
    renderCoins();
    renderRewards();
    renderDeco();
    toast('신청했어요', 'ok');
  } catch (err) {
    console.error(err);
    toast('신청하지 못했어요. 다시 눌러 주세요', 'error');
    if (btn) btn.disabled = false;
  } finally {
    busy = false;
  }
}

$('reward-grid').addEventListener('click', (e) => {
  if (e.target.closest('[data-pair-cancel]')) {
    pairOpen = null;
    renderRewards();
    return;
  }
  const b = e.target.closest('[data-req]');
  if (!b) return;
  const r = (shop.rewards ?? []).find((x) => x.id === b.dataset.req);
  if (!r) return;
  if (r.kind === 'pair') {
    pairOpen = r.id;
    renderRewards();
    $('pair-sel')?.focus();
    return;
  }
  sendRequest(r.id, null, b);
});

$('reward-grid').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.closest('[data-pair]');
  const n = Number(f?.querySelector('select')?.value);
  if (!n) return toast('친구 번호를 골라 주세요', 'error');
  sendRequest(f.dataset.pair, n, f.querySelector('[type="submit"]'));
});

/* ---------- 탭 ---------- */
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b || b.dataset.tab === tab) return;
  tab = b.dataset.tab;
  if (trying) { trying = null; renderHero(); renderTryBar(); renderDeco(); }
  $('tabs').querySelectorAll('[data-tab]').forEach((x) => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-selected', x === b);
  });
  $('p-deco').classList.toggle('hidden', tab !== 'deco');
  $('p-reward').classList.toggle('hidden', tab !== 'reward');
});

/* ---------- 시작 ---------- */
async function load(first = true) {
  if (!login) return goLogin();
  try {
    const res = await getShop(login.token);
    if (!res?.ok) return goLogin();
    shop = res;
    wearing = normalize(res.avatar);
    if (trying) trying = items().find((x) => x.id === trying.id) ?? null;
    $('shop').classList.remove('hidden');
    renderCoins(first);
    renderHero();
    renderTryBar();
    renderDeco();
    renderRewards();
  } catch (err) {
    console.error(err);
    if (first) toast('불러오지 못했어요. 새로고침해 주세요', 'error');
  }
}

// 다른 화면에 다녀오면 승인 결과·코인을 다시 읽는다
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && shop && !busy) load(false);
});

load();
