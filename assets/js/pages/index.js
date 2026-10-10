// 입구: 반 선택, 지난번 반 기억
import { CLASSES } from '../config.js';
import { initUI } from '../ui.js';

initUI();

const LAST_KEY = 'lastClass';
const grid = document.getElementById('grid');
const last = document.getElementById('last');

let lastClass = null;
try { lastClass = Number(localStorage.getItem(LAST_KEY)) || null; } catch {}
if (!CLASSES.includes(lastClass)) lastClass = null;

grid.innerHTML = CLASSES.map((n, i) => `
  <a class="class-btn glass glass-live lift rise" style="--d:${(0.14 + i * 0.05).toFixed(2)}s"
     href="class.html?c=${n}" data-class="${n}" aria-label="${n}반">
    <span class="n num">${n}</span><span class="u">반</span>
  </a>`).join('');

if (lastClass) {
  last.href = `class.html?c=${lastClass}`;
  last.dataset.class = lastClass;
  document.getElementById('last-text').textContent = `${lastClass}반 · 오늘 수업 바로 가기`;
  last.classList.remove('hidden');
  // 반 페이지에서 돌아올 때 제목이 이 버튼으로 이어지게
  const btn = grid.querySelector(`[data-class="${lastClass}"]`);
  if (btn) btn.style.viewTransitionName = 'class-title';
}

// 누른 버튼이 반 페이지 제목으로 이어지게
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-class]');
  if (!a) return;
  document.querySelectorAll('[data-class]').forEach((el) => { el.style.viewTransitionName = ''; });
  a.style.viewTransitionName = 'class-title';
  try { localStorage.setItem(LAST_KEY, a.dataset.class); } catch {}
});
