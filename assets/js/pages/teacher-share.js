// 관리 '다른 선생님 서버'(#share, 2026-11-10): 차시·웹 학습지를 받아 가겠다고 신청한 다른 선생님 서버 목록.
// [승인]한 서버만 매일 새벽 받아 감(그쪽 06_auto_update.sql의 _share_tick). 원래 사이트에만 있음(게임 없는 판에서는 빠짐)
import { toast, esc } from '../ui.js';
import { getSharePeers, decideSharePeer } from '../db.js';
import { errMsg } from '../gate.js';
import { syncSideBadges } from './teacher-side.js';

const $ = (id) => document.getElementById(id);
let peers = [];
let badgeAt = 0;

const when = (t) => (t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const STATUS = { pending: ['승인 기다림', 'tag-wait'], approved: ['받는 중', 'tag-done'], rejected: ['거절함', 'tag-off'] };

function setBadge() {
  const n = peers.filter((p) => p.status === 'pending').length;
  const b = $('hub-share-badge');
  if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
  const s = $('hub-share');
  if (s) s.textContent = n ? `승인 기다리는 서버 ${n}개` : `받아 가는 서버 ${peers.filter((p) => p.status === 'approved').length}개`;
  syncSideBadges();
}

// 첫 화면 요약이 바뀔 때마다 불려도 1분에 한 번만 서버에 물음
export function shareBadge() {
  if (Date.now() - badgeAt < 60000) return;
  badgeAt = Date.now();
  getSharePeers().then((p) => { peers = p || []; setBadge(); }).catch(() => {});
}

export async function refreshShare() {
  peers = (await getSharePeers()) || [];
  badgeAt = Date.now();
  setBadge();
  render();
}

function render() {
  const list = $('share-list');
  if (!peers.length) {
    list.innerHTML = '<p class="muted">아직 신청한 서버가 없어요. 다른 선생님이 설치를 마치면 여기에 떠요.</p>';
    return;
  }
  list.innerHTML = peers.map((p) => {
    const [label, cls] = STATUS[p.status] || [p.status, 'tag-off'];
    const ref = p.url.replace(/^https:\/\//, '').replace(/\.supabase\.co$/, '');
    const btns = [
      p.status !== 'approved' ? `<button class="btn btn-small" data-act="approved" data-id="${esc(p.id)}">승인</button>` : '',
      p.status !== 'rejected' ? `<button class="btn btn-line btn-small" data-act="rejected" data-id="${esc(p.id)}">${p.status === 'approved' ? '그만 주기' : '거절'}</button>` : '',
      `<button class="btn btn-line btn-small" data-act="delete" data-id="${esc(p.id)}">지우기</button>`,
    ].join('');
    return `<div class="share-row">
      <div class="share-main"><b>${esc(p.label || '담당 반 모름')}</b> <span class="tag ${cls}">${label}</span>
        <span class="muted">서버 ${esc(ref)} · 신청 ${when(p.requested_at)}${p.pulled_at ? ` · 마지막으로 받아 감 ${when(p.pulled_at)}` : ''}</span></div>
      <div class="row-actions">${btns}</div>
    </div>`;
  }).join('');
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('#share-list [data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'delete' && !confirm('이 서버를 목록에서 지울까요? 그쪽 서버가 다시 신청하면 다시 떠요.')) return;
  if (act === 'rejected' && !confirm('이 서버에 더는 차시·학습지를 주지 않을까요? 이미 받아 간 것은 그쪽에 남아요.')) return;
  b.disabled = true;
  try {
    const r = await decideSharePeer(b.dataset.id, act);
    if (r && r.ok === false) throw new Error(r.error);
    toast(act === 'approved' ? '승인했어요. 그쪽 서버가 10분 안에 받아 가요' : act === 'delete' ? '지웠어요' : '거절했어요');
    await refreshShare();
  } catch (err) {
    toast(errMsg(err), 'error');
    b.disabled = false;
  }
});
