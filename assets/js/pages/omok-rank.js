// 오목 랭킹: 이번 달 AI 대전 이긴 판 TOP 10, 승률 TOP 10(min_games판 이상). 로그인하지 않아도 볼 수 있다
import { initUI, toast, esc } from '../ui.js';
import { getOmokRank } from '../db.js';
import { readLogin } from '../login.js';
import { avatarSVG, bindReactions } from '../avatar.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);
const login = readLogin();
const nameOf = (r) => `${r.class_id}반 ${r.nickname ?? '닉네임 미정'}`;

function rows(list, value) {
  if (!list.length) return '<li class="omr-empty">아직 기록이 없어요</li>';
  return list.map((r) => `
    <li class="rank-row${r.me ? ' is-mine' : ''}">
      <span class="rr-rank num">${r.rank}</span>
      <span class="rr-who">${avatarSVG(r.avatar, 40, { label: nameOf(r) })}<span class="rr-name">${esc(nameOf(r))}${r.me ? ' (나)' : ''}</span></span>
      <span class="rr-xp num">${value(r)}</span>
    </li>`).join('');
}

try {
  const res = await getOmokRank(login?.token ?? null);
  $('min').textContent = res.min_games;
  $('wins').innerHTML = rows(res.wins, (r) => `${r.wins}<small>승</small>`);
  $('rate').innerHTML = rows(res.rate, (r) => `${r.rate}<small>%</small>`);
  const me = res.me;
  if (me) {
    $('me').innerHTML = `<span>나 <b class="num">${me.wins}</b>승 / <b class="num">${me.games}</b>판</span>`
      + `<span>이긴 판 <b class="num">${me.wins_rank ? `${me.wins_rank}위` : '-'}</b></span>`
      + `<span>승률 <b class="num">${me.rate_rank ? `${me.rate_rank}위` : me.games < res.min_games ? `${res.min_games - me.games}판 더` : '-'}</b></span>`;
    $('me').classList.remove('hidden');
  }
} catch (err) {
  console.error(err);
  toast('불러오지 못했어요', 'error');
}
