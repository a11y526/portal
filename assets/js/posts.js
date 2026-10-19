// 모둠 칸 게시판(패들렛 대체) 그리기: 반 페이지·수업 모드·검사 화면이 같이 쓴다
// 칸 = 그날 모둠. 카드 = 쓴 사람(닉네임·캐릭터), 시각, 제목, 사진, 본문, 링크
import { esc } from './ui.js';
import { avatarSVG } from './avatar.js';
import { postPhotoUrl } from './db.js';

const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
};

const linkLabel = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

// p: { id, title, body, link, photo, nickname, avatar, teacher, at }
// opts.edit: 고치기·지우기 버튼(우리 모둠, 쓸 수 있을 때) · opts.remove: 지우기만(교사)
export function postCardHTML(p, { edit = false, remove = false } = {}) {
  const who = p.teacher ? '선생님' : (p.nickname || '닉네임 미정');
  const photo = p.photo ? `
    <a class="post-photo" href="${esc(postPhotoUrl(p.photo))}" target="_blank" rel="noopener">
      <img src="${esc(postPhotoUrl(p.photo))}" alt="${esc(p.title || '사진')}" loading="lazy" decoding="async">
    </a>` : '';
  const link = /^https?:\/\//i.test(p.link || '') ? `
    <a class="post-link" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>
      <span>${esc(linkLabel(p.link))}</span>
    </a>` : '';
  const actions = edit
    ? `<div class="post-acts">
         <button type="button" class="post-act press" data-post-edit="${esc(p.id)}">고치기</button>
         <button type="button" class="post-act is-del press" data-post-del="${esc(p.id)}">지우기</button>
       </div>`
    : remove ? `<div class="post-acts"><button type="button" class="post-act is-del press" data-post-del="${esc(p.id)}">지우기</button></div>` : '';
  return `
    <article class="post" data-post="${esc(p.id)}">
      <header class="post-head">
        <span class="post-av">${avatarSVG(p.avatar, 40, { label: who })}</span>
        <span class="post-who">${esc(who)}</span>
        <time class="post-at num">${hhmm(p.at)}</time>
      </header>
      ${p.title ? `<h4 class="post-title">${esc(p.title)}</h4>` : ''}
      ${photo}
      ${p.body ? `<p class="post-body">${esc(p.body)}</p>` : ''}
      ${link}
      ${actions}
    </article>`;
}

// groups: [{ no, posts: [...] | null }]
// opts.myGroup: 우리 모둠(앞에 + 버튼) · opts.canWrite · opts.hiddenText: 가린 칸 글(문자열 또는 g => 문자열) · opts.colExtra(g): 칸 머리 오른쪽에 붙일 html
// opts.remove: 교사가 모든 글 지우기
export function boardHTML(groups, { myGroup = null, canWrite = false, hiddenText = '발표 뒤에 보여요', colExtra = null, remove = false } = {}) {
  return groups.map((g) => {
    const mine = g.no === myGroup;
    const posts = g.posts;
    const hidden = posts === null || posts === undefined;
    let body;
    if (hidden) body = `<div class="col-hidden">${esc(typeof hiddenText === 'function' ? hiddenText(g) : hiddenText)}</div>`;
    else if (!posts.length) body = mine && canWrite ? '' : '<div class="col-empty">아직 글이 없어요</div>';
    else body = posts.map((p) => postCardHTML(p, { edit: mine && canWrite, remove })).join('');
    return `
      <section class="post-col${mine ? ' is-mine' : ''}${hidden ? ' is-hidden' : ''}" data-col="${g.no}" aria-label="${g.no}모둠">
        <header class="col-head">
          <h3>${g.no}모둠${mine ? '<span class="chip">우리</span>' : ''}</h3>
          ${colExtra ? colExtra(g) : ''}
        </header>
        ${mine && canWrite ? `
          <button type="button" class="col-add press" data-post-new aria-label="${g.no}모둠 칸에 글 쓰기">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>` : ''}
        <div class="col-posts">${body}</div>
      </section>`;
  }).join('');
}

// 사진은 긴 변 1600px jpeg로 줄여서 올린다(학생은 고르기만. 약한 와이파이 대비)
export async function shrinkPhoto(file, max = 1600, quality = 0.82) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('BAD_IMAGE')); };
      img.src = url;
    });
  }
  const w0 = src.width, h0 = src.height;
  if (!w0 || !h0) throw new Error('BAD_IMAGE');
  const k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // 투명한 png는 흰 바탕으로
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  src.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('BAD_IMAGE');
  return blob;
}
