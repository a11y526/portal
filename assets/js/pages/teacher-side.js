// 관리 메뉴: 첫 화면 항목(#hub)을 그대로 읽어 만든다
// 넓은 화면(961px 이상)은 위 메뉴(#topnav, 묶음 이름에 마우스를 올리면 항목 창), 좁은 화면은 ☰로 여는 서랍(#side)
import { IS_MAIN } from '../config.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const WIDE = matchMedia('(min-width: 961px)');
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';

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

// 위 메뉴: 왼쪽 '관리', 가운데 묶음 이름(올리면 항목 창), 오른쪽 검사·로그아웃·[수업 시작]
function initTop() {
  const top = $('topnav');
  top.innerHTML = `<a class="tn-brand" href="#">관리</a><nav class="tn-nav" aria-label="관리 메뉴"></nav>
    <div class="tn-right">${IS_MAIN ? '' : '<a class="tn-ghost" href="guide.html" target="_blank" rel="noopener">안내 <span aria-hidden="true">↗</span></a>'}<a class="tn-ghost" href="check.html">검사 <span aria-hidden="true">↗</span></a>
      <button class="tn-ghost" type="button" data-logout>로그아웃</button>
      <a class="tn-pill" href="#lessons">수업 시작 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a></div>`;
  const nav = top.querySelector('.tn-nav');
  document.querySelectorAll('#hub .hub-group').forEach((g) => {
    const items = [...g.querySelectorAll('.hub-item')];
    const menu = document.createElement('div');
    menu.className = 'tn-menu';
    menu.innerHTML = '<button type="button" class="tn-btn" aria-haspopup="true"></button><div class="tn-drop"></div>';
    menu.firstChild.textContent = g.querySelector('.hub-label').textContent;
    const drop = menu.querySelector('.tn-drop');
    drop.style.setProperty('--rows', items.length > 6 ? Math.ceil(items.length / 2) : items.length);
    items.forEach((a) => {
      const l = link(a, '');
      l.className = 'tn-link';
      l.querySelector('.side-ic')?.remove();
      drop.append(l);
    });
    nav.append(menu);
  });
  // 맥 앱 '과학 관리'에서 열었을 때만: '기타' 옆 [배포] → 앱이 배포 창을 띄움
  const app = window.webkit?.messageHandlers?.scienceApp;
  if (app) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tn-btn tn-app';
    b.textContent = '배포';
    b.addEventListener('click', () => app.postMessage({ cmd: 'deploy' }));
    nav.append(b);
  }
  // 항목을 누르면 창을 닫는다(마우스가 메뉴를 벗어날 때까지)
  nav.addEventListener('click', (e) => {
    const m = e.target.closest('.tn-menu');
    if (!m) return;
    if (e.target.closest('.tn-btn')) { m.classList.toggle('open'); return; }
    if (e.target.closest('a')) {
      m.classList.remove('open');
      m.classList.add('shut');
      document.activeElement?.blur();
    }
  });
  nav.addEventListener('pointerleave', () => nav.querySelectorAll('.tn-menu').forEach((m) => m.classList.remove('shut', 'open')));
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    nav.querySelectorAll('.tn-menu').forEach((m) => { m.classList.remove('open'); m.classList.add('shut'); });
    document.activeElement?.closest?.('.tn-menu') && document.activeElement.blur();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.tn-menu')) nav.querySelectorAll('.tn-menu.open').forEach((m) => m.classList.remove('open')); });
}

export function initSide() {
  initTop();
  const side = $('side');
  side.innerHTML = `
    <div class="side-top"><a class="side-home" href="#">관리</a>
      <button type="button" class="side-x" id="side-close" aria-label="사이드바 접기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15M15.5 10l-2 2 2 2"/></svg></button>
    </div>
    <nav class="side-nav" aria-label="관리 메뉴"></nav>
    ${IS_MAIN ? '' : '<a class="side-link side-out" href="guide.html" target="_blank" rel="noopener"><i class="side-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg></i><span>안내</span></a>'}
    <button class="side-link side-out" type="button" data-logout><i class="side-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h10"/></svg></i><span>로그아웃</span></button>`;
  const nav = side.querySelector('.side-nav');
  side.querySelector('.side-home').addEventListener('click', () => root.classList.remove('side-drawer'));
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
  document.querySelectorAll('#side .side-link[href], #topnav .tn-link[href]').forEach((a) => {
    const h = a.getAttribute('href');
    const on = h.startsWith('#') && h.slice(1) === key;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('#topnav .tn-menu').forEach((m) => m.classList.toggle('cur', !!m.querySelector('[aria-current]')));
}

// 첫 화면 카드의 숫자 배지(닉네임·구매 신청)를 메뉴에도. 위 메뉴는 묶음 이름 옆에 작은 점
export function syncSideBadges() {
  document.querySelectorAll('#side .side-badge, #topnav .side-badge').forEach((b) => {
    const src = $(b.dataset.for);
    b.textContent = src?.textContent || '';
    b.classList.toggle('hidden', !src || src.classList.contains('hidden'));
  });
  document.querySelectorAll('#topnav .tn-menu').forEach((m) => m.classList.toggle('dot', !!m.querySelector('.side-badge:not(.hidden)')));
}
