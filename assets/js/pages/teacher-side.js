// 관리 사이드바: 첫 화면 항목(#hub)을 그대로 읽어 왼쪽 목록으로 만든다
// 넓은 화면은 늘 펼침(접으면 기기에 기억 'adminSide'='closed'), 좁은 화면은 ☰로 여는 서랍
const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const WIDE = matchMedia('(min-width: 961px)');
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';
const HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>';

const store = {
  get: () => { try { return localStorage.getItem('adminSide'); } catch { return null; } },
  set: (v) => { try { localStorage.setItem('adminSide', v); } catch { /* 저장 안 돼도 화면은 그대로 */ } },
};

function link(a, cls) {
  const out = document.createElement('a');
  out.className = 'side-link';
  out.href = a.getAttribute('href');
  if (a.target) { out.target = a.target; out.rel = a.rel; }
  const ic = a.querySelector('.hub-ic svg');
  out.innerHTML = `<i class="side-ic ${cls}" aria-hidden="true">${ic ? ic.outerHTML : ''}</i><span></span>`;
  out.querySelector('span').textContent = a.querySelector('b').textContent;
  const badge = a.querySelector('.hub-badge');
  if (badge) out.insertAdjacentHTML('beforeend', `<em class="side-badge hidden" data-for="${badge.id}"></em>`);
  // 다른 화면으로 가는 항목(검사·발표·모둠 편성·학생 화면)은 작은 화살표
  if (!out.getAttribute('href').startsWith('#')) out.insertAdjacentHTML('beforeend', `<i class="side-ext" aria-hidden="true">${ARROW}</i>`);
  return out;
}

export function initSide() {
  const side = $('side');
  side.innerHTML = `
    <div class="side-top"><b>관리</b>
      <button type="button" class="side-x" id="side-close" aria-label="사이드바 접기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15M15.5 10l-2 2 2 2"/></svg></button>
    </div>
    <nav class="side-nav" aria-label="관리 메뉴"></nav>
    <button class="side-link side-out" type="button" data-logout><i class="side-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h10"/></svg></i><span>로그아웃</span></button>`;
  const nav = side.querySelector('.side-nav');
  const home = document.createElement('a');
  home.className = 'side-link';
  home.href = '#';
  home.innerHTML = `<i class="side-ic" aria-hidden="true">${HOME}</i><span>첫 화면</span>`;
  nav.append(home);
  document.querySelectorAll('#hub .hub-group').forEach((g) => {
    const cls = [...g.classList].find((c) => c.startsWith('g-')) || '';
    const sec = document.createElement('div');
    sec.className = `side-group ${cls}`;
    sec.innerHTML = '<h2 class="side-label"></h2>';
    sec.firstChild.textContent = g.querySelector('.hub-label').textContent;
    g.querySelectorAll('.hub-item').forEach((a) => sec.append(link(a, cls)));
    nav.append(sec);
  });

  const closeDrawer = () => root.classList.remove('side-drawer');
  $('side-open').addEventListener('click', () => {
    if (WIDE.matches) { root.classList.remove('side-closed'); store.set('open'); }
    else root.classList.add('side-drawer');
  });
  $('side-close').addEventListener('click', () => {
    if (WIDE.matches) { root.classList.add('side-closed'); store.set('closed'); }
    else closeDrawer();
  });
  $('side-scrim').addEventListener('click', closeDrawer);
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) closeDrawer(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('side-drawer')) closeDrawer(); });
  WIDE.addEventListener('change', closeDrawer);
  if (store.get() === 'closed') root.classList.add('side-closed');
  syncSideBadges();
}

// 지금 연 항목 표시 (key: 주소의 # 뒤, 첫 화면은 '')
export function markSide(key) {
  document.querySelectorAll('#side .side-link[href]').forEach((a) => {
    const h = a.getAttribute('href');
    const on = h.startsWith('#') && h.slice(1) === key;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

// 첫 화면 카드의 숫자 배지(닉네임·구매 신청)를 사이드바에도
export function syncSideBadges() {
  document.querySelectorAll('#side .side-badge').forEach((b) => {
    const src = $(b.dataset.for);
    b.textContent = src?.textContent || '';
    b.classList.toggle('hidden', !src || src.classList.contains('hidden'));
  });
}
