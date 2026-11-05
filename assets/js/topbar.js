// 학생 화면 공통 위 메뉴(떠 있는 유리 알약) + 좁은 화면의 아래 탭 바.
// 서버를 따로 부르지 않는다: 금화·은화·캐릭터·게임 켜짐은 입구·마이페이지·상점이 받은 값을 기기에 적어 두고(setTop) 그걸 보여 준다.
import { readLogin, clearLogin } from './login.js';
import { TEST_CLASS } from './config.js';
import { avatarSVG } from './avatar.js';
import { liquid } from './glass.js';

const KEY = 'top-cache';
const IC = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cls: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shop: '<path d="M4 9h16l-1.2 10.2A2 2 0 0 1 16.8 21H7.2a2 2 0 0 1-2-1.8z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/>',
  games: '<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7.5 10.5v4M5.5 12.5h4"/>',
  rank: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M12 14v7M8 21h8"/>',
};
const PAGE = location.pathname.split('/').pop() || 'index.html';
const CUR = /^(index|test)\.html$/.test(PAGE) ? 'home'
  : /^(class|quiz|quizshow)\.html$/.test(PAGE) ? 'cls'
  : PAGE === 'me.html' ? 'me' : PAGE === 'shop.html' ? 'shop' : PAGE === 'rank.html' ? 'rank'
  : /^(games|omok|omok-online|omok-rank|othello|quoridor|yut|rummikub)\.html$/.test(PAGE) ? 'games' // nogame
  : '';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let top = null;
let dock = null;

function readCache(login) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && login && v.k === login.token.slice(0, 12) ? v : {};
  } catch { return {}; }
}

// 입구·마이페이지·상점이 받은 값을 적는다: { coins, silver, avatar, games }
export function setTop(patch) {
  const login = readLogin();
  if (!login) return;
  const v = { ...readCache(login), ...patch, k: login.token.slice(0, 12) };
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
  if (top) render();
}

function links(login, c) {
  const home = login?.class_id === TEST_CLASS || PAGE === 'test.html' ? 'test.html' : 'index.html';
  let cls = null;
  if (login) cls = `class.html?c=${login.class_id}`;
  else {
    const last = Number(localStorage.getItem('lastClass'));
    if (CUR === 'cls' && PAGE === 'class.html') cls = location.search ? `class.html${location.search}` : null;
    else if (last) cls = `class.html?c=${last}`;
  }
  return [
    ['home', '홈', home],
    ['cls', '수업', cls],
    ['me', '마이페이지', login ? 'me.html' : null],
    ['shop', '상점', login ? 'shop.html' : null],
    ['games', '게임', login && (c.games || CUR === 'games') ? 'games.html' : null], // nogame
    ['rank', '순위', 'rank.html'],
  ].filter(([, , href]) => href);
}

function render() {
  const login = readLogin();
  const c = readCache(login);
  const items = links(login, c);
  const home = items[0][2];
  const coin = (cls, n) => (n == null ? '' : `<span class="stu-coin lg"><i class="${cls}" aria-hidden="true"></i><b>${Number(n)}</b><span class="sr">${cls === 'g' ? '금화' : '은화'}</span></span>`);
  top.innerHTML = `
    <a class="stu-brand" href="${home}">1학년 과학</a>
    <nav class="stu-nav" aria-label="메뉴">${items.map(([k, t, h]) =>
      `<a href="${esc(h)}"${k === CUR ? ' class="cur" aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <div class="stu-right">${login
      ? `${coin('g', c.coins)}${coin('s', c.silver)}
         <a class="stu-me" href="me.html" aria-label="마이페이지">${c.avatar ? avatarSVG(c.avatar, 38, { label: '내 캐릭터' }) : ''}</a>
         <button type="button" class="stu-out" id="stu-out">로그아웃</button>`
      : CUR === 'home' ? '' : `<a class="stu-login" href="${home}">로그인</a>`}</div>`;
  dock.innerHTML = items.map(([k, t, h]) =>
    `<a href="${esc(h)}"${k === CUR ? ' class="cur" aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>${k === 'me' ? '마이' : t}</a>`).join('');
  top.querySelector('#stu-out')?.addEventListener('click', logout);
  liquid(top, dock, [...top.querySelectorAll('.stu-coin')]);
}

async function logout() {
  const login = readLogin();
  clearLogin();
  try { localStorage.removeItem(KEY); } catch {}
  const home = login?.class_id === TEST_CLASS ? 'test.html' : 'index.html';
  if (login) {
    try {
      const { studentLogout } = await import('./db.js');
      await Promise.race([studentLogout(login.token), new Promise((r) => setTimeout(r, 1500))]);
    } catch {}
  }
  location.href = home;
}

// 로그인·로그아웃이 같은 화면 안에서 바뀔 때(입구) 다시 그린다
export function refreshTop() { if (top) render(); }

export function mountTop() {
  if (top || !document.body) return;
  top = document.createElement('header');
  top.className = 'stu-top lg';
  dock = document.createElement('nav');
  dock.className = 'stu-dock lg';
  dock.setAttribute('aria-label', '메뉴');
  document.body.prepend(top);
  document.body.append(dock);
  document.documentElement.classList.add('has-stu-top');
  render();
  addEventListener('storage', (e) => { if (e.key === KEY || e.key === 'student') render(); });
}
