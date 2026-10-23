// 게임 모음: 오목(AI)·오목 1대1·루미큐브·쿼리도·오목 랭킹. 모두 오목 스위치(classes.omok_open) 하나로 켜고 끈다.
// 칸마다 오늘 한 판 수 또는 하는 중인 판을 보여 준다.
import { initUI, prepareDraw } from '../ui.js';
import { getOmok, omState, rkState, qdState } from '../db.js';
import { readLogin, clearLogin } from '../login.js';

initUI();

const $ = (id) => document.getElementById(id);
const login = readLogin();

// 하는 중인 판이 있으면 그것을, 없으면 오늘 판 수
const online = (r) => (r.game?.status === 'playing' ? '하는 중' : r.game?.status === 'waiting' ? '기다리는 중'
  : `오늘 ${Math.min(r.today, r.daily)} / ${r.daily}판`);

async function load() {
  const o = await getOmok(login.token);
  if (!o?.ok) {
    clearLogin();
    location.replace('index.html');
    return;
  }
  if (!o.open) {
    $('v-closed').classList.remove('hidden');
    return;
  }
  $('v-games').classList.remove('hidden');
  prepareDraw($('v-games'));
  $('go-omok-sub').textContent = `AI 대전 · 오늘 ${Math.min(o.today, o.daily)} / ${o.daily}판`;
  $('go-omr-sub').textContent = '이번 달 AI 대전';
  const fill = (id, job) => job.then((r) => { if (r?.ok) $(id).textContent = online(r); }).catch(() => {});
  fill('go-omp-sub', omState(login.token));
  fill('go-rk-sub', rkState(login.token));
  qdState(login.token).then((r) => {
    if (r?.ok) $('go-qd-sub').textContent = r.game ? online(r) : `2명 · 4명 · ${online(r)}`;
  }).catch(() => {});
}

if (!login) $('v-login').classList.remove('hidden');
else load().catch((err) => console.error(err));
