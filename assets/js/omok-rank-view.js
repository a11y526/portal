// 오목 AI 랭킹 그리기(omok-rank.html, omok-online.html 공통)
// box 안의 [data-r="wins"] [data-r="rate"] [data-r="min"] [data-r="me"]를 채운다
import { esc } from './ui.js';
import { getOmokRank } from './db.js';
import { avatarSVG } from './avatar.js';

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

export async function loadOmokRank(box, token = null) {
  const q = (k) => box.querySelector(`[data-r="${k}"]`);
  const res = await getOmokRank(token);
  q('min').textContent = res.min_games;
  q('wins').innerHTML = rows(res.wins, (r) => `${r.wins}<small>승</small>`);
  q('rate').innerHTML = rows(res.rate, (r) => `${r.rate}<small>%</small>`);
  const me = res.me, el = q('me');
  if (me && el) {
    el.innerHTML = `<span>나 <b class="num">${me.wins}</b>승 / <b class="num">${me.games}</b>판</span>`
      + `<span>이긴 판 <b class="num">${me.wins_rank ? `${me.wins_rank}위` : '-'}</b></span>`
      + `<span>승률 <b class="num">${me.rate_rank ? `${me.rate_rank}위` : me.games < res.min_games ? `${res.min_games - me.games}판 더` : '-'}</b></span>`;
    el.classList.remove('hidden');
  }
  return res;
}
