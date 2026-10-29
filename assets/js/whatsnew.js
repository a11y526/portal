// 새 기능 소식 (입구·관리 첫 화면 위 작은 칸). 새 항목은 맨 위에 추가
import { esc } from './ui.js';

const NEWS = [
  ['2026-10-29 11:30', 'Changing your nickname now costs 5 silver. Your first nickname is still free, and if the teacher declines the request the silver comes back.'],
  ['2026-10-29 10:40', 'New game: Online 1-on-1 Othello across all six classes, with an illustrated rules guide. Winning on disc count earns XP and silver (set by the teacher).'],
  ['2026-10-29 10:30', 'Game wins (Omok vs AI, Rummikub, Quoridor) now pay silver instead of gold, so game rewards go toward avatar items.'],
  ['2026-10-28 15:45', 'Two currencies in the shop: gold (the old coins) buys rewards, and silver, earned one-for-one with XP, buys avatar items. Coins spent on items before were returned as gold.'],
  ['2026-10-28 14:10', 'Cleaner look on slower computers: sharper card borders, easier-to-read gray text, and a six-box code input on the login screen.'],
  ['2026-10-28 13:55', 'Worksheet blanks can now accept answers in any order, so “Jupiter and Mars” counts the same as “Mars and Jupiter”.'],
  ['2026-10-28 11:18', 'The leaderboard now shows the top 40 across all classes, plus a new “My class top 10” tab.'],
  ['2026-10-27 10:46', 'First-answer picks are now drawn fairly: everyone who submits before the teacher looks is in the draw, and students already picked this lesson go to the back.'],
  ['2026-10-27 10:04', 'During class mode, the portal notes when a student leaves the page. Nothing is deducted; it is only a record.'],
  ['2026-10-27 09:49', 'On wide screens, worksheet simulations open right next to the page, large, with no extra click.'],
  ['2026-10-27 08:36', 'Phone remote for teachers: turn slides, open the cover, run the timer and handle first answers from a phone.'],
  ['2026-10-26 16:02', 'First answers are now a draw instead of first-come-first-served, with students picked less often this month going first.'],
  ['2026-10-26 08:49', 'Group worksheets: one device per group fills in the worksheet, and every member gets the record and the XP.'],
  ['2026-10-24 23:05', 'AI grading for worksheets: answers that mean the same thing as the key, like “expanded” for “got bigger”, are now marked correct.'],
  ['2026-10-23 13:26', 'Teachers can see every student’s coin balance, spending and level in one table.'],
  ['2026-10-23 12:25', 'New game: Quoridor for 2 or 4 players online. All games now live under one “Games” button.'],
  ['2026-10-23 11:58', 'Teachers can edit nicknames directly, and undo a skipped first answer.'],
  ['2026-10-22 14:13', 'Quiz Show now has its own tab on the class page and opens automatically when a quiz starts.'],
  ['2026-10-22 11:06', 'Quiz Show: a whole-class live quiz with seven question types, speed points, streak bonuses, solo or team mode, and XP for the top three.'],
  ['2026-10-20 15:30', 'The progress and board screens for teachers got a clean, document-style redesign.'],
  ['2026-10-20 15:12', 'The admin page now has a sidebar with every section grouped and request counts shown.'],
  ['2026-10-20 15:06', 'Lesson schedule can be subscribed to from iPhone and Mac Calendar.'],
  ['2026-10-20 14:58', 'Progress tracking: each class’s progress is calculated automatically from the slides shown in class.'],
  ['2026-10-20 12:32', 'New “Board” tab on the class page with materials from the teacher: notes, photos, PDFs, links and YouTube videos.'],
  ['2026-10-20 09:20', 'Worksheet pages stay locked until the teacher opens them, so everyone writes along with the lesson.'],
  ['2026-10-19 10:08', 'Group boards replace Padlet: each group posts text, photos and links right inside the portal.'],
  ['2026-10-19 08:39', 'Quiz Battle: groups race through 20 random questions from today’s worksheet, and the top scorer in each group earns XP and coins.'],
  ['2026-10-16 14:56', 'Gomoku leaderboard: most wins and best win rate this month.'],
  ['2026-10-16 14:46', 'Online 1-on-1 Gomoku with anyone from all six classes.'],
  ['2026-10-16 12:22', '38 new avatar items in the shop, starting at 5 coins, including six animal hats.'],
  ['2026-10-16 11:50', 'First answer per worksheet page: the teacher can show a student’s answer and award a bonus.'],
  ['2026-10-16 11:16', 'Online Rummikub for three players, with a rules guide.'],
];

const SEEN_KEY = 'whatsnew-seen';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(d) {
  const [y, m, day] = d.split('-').map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; }
}

function writeSeen(v) {
  try { localStorage.setItem(SEEN_KEY, v); } catch { /* 저장 못 해도 그대로 */ }
}

export function mountWhatsNew(slot) {
  if (!slot || !NEWS.length) return;
  const [latestAt, latestText] = NEWS[0];

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wn-pill glass lift';
  btn.innerHTML = `<span class="wn-tag">New</span><span class="wn-text">${esc(latestText)}</span>`;
  btn.setAttribute('aria-label', 'What’s new');
  if (readSeen() < latestAt) btn.classList.add('is-unseen');

  const days = [];
  for (const [at, text] of NEWS) {
    const [d, t] = at.split(' ');
    if (!days.length || days[days.length - 1].d !== d) days.push({ d, items: [] });
    days[days.length - 1].items.push({ t, text });
  }

  const dlg = document.createElement('dialog');
  dlg.className = 'sheet wn-sheet';
  dlg.innerHTML = `<div class="card glass-strong">
    <div class="wn-head"><h2>What’s new</h2><button type="button" class="btn btn-line wn-close">Close</button></div>
    ${days.map((g) => `<section class="wn-day"><h3>${dayLabel(g.d)}</h3>
      ${g.items.map((i) => `<p><time>${i.t}</time>${esc(i.text)}</p>`).join('')}
    </section>`).join('')}
  </div>`;

  btn.addEventListener('click', () => {
    dlg.showModal();
    writeSeen(latestAt);
    btn.classList.remove('is-unseen');
  });
  dlg.querySelector('.wn-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  slot.append(btn);
  document.body.append(dlg);
}
