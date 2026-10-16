// 오목 랭킹: 이번 달 AI 대전 이긴 판 TOP 10, 승률 TOP 10(min_games판 이상). 로그인하지 않아도 볼 수 있다
import { initUI, toast } from '../ui.js';
import { readLogin } from '../login.js';
import { bindReactions } from '../avatar.js';
import { loadOmokRank } from '../omok-rank-view.js';

initUI();
bindReactions();

try {
  await loadOmokRank(document.body, readLogin()?.token ?? null);
} catch (err) {
  console.error(err);
  toast('불러오지 못했어요', 'error');
}
