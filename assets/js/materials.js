// 반 게시판(교사가 올리는 자료) 그리기: 반 페이지 [게시판] 탭과 관리 '반 게시판'이 같이 쓴다
// 칸 = 교사가 짠 섹션. 카드 = 제목, 사진·PDF, 유튜브, 본문, 링크
import { esc } from './ui.js';
import { materialUrl } from './db.js';

const linkLabel = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

// 유튜브 주소 → 영상 id (아니면 null)
export function youtubeId(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^(www|m)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

const ICON_LINK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>`;
const ICON_PDF = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>`;
const ICON_PLAY = `<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>`;

// m: { id, title, body, link, file, file_type, file_name }
// opts.admin: 고치기·지우기·위아래 버튼
export function materialCardHTML(m, { admin = false, first = false, last = false } = {}) {
  let media = '';
  if (m.file && m.file_type === 'image') {
    const src = esc(materialUrl(m.file));
    media = `<a class="post-photo" href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${esc(m.title || '사진')}" loading="lazy" decoding="async"></a>`;
  } else if (m.file && m.file_type === 'pdf') {
    media = `<a class="mat-pdf press" href="${esc(materialUrl(m.file))}" target="_blank" rel="noopener">
        ${ICON_PDF}<span class="mat-pdf-name">${esc(m.file_name || 'PDF')}</span><span class="mat-pdf-open">열기</span>
      </a>`;
  }
  const yt = m.link ? youtubeId(m.link) : null;
  // 영상은 누를 때만 불러온다(학생 기기·와이파이 부담)
  const video = yt ? `
    <button type="button" class="mat-yt press" data-yt="${esc(yt)}" aria-label="영상 재생">
      <img src="https://i.ytimg.com/vi/${esc(yt)}/hqdefault.jpg" alt="" loading="lazy" decoding="async">
      <span class="mat-yt-play">${ICON_PLAY}</span>
    </button>` : '';
  const link = !yt && /^https?:\/\//i.test(m.link || '') ? `
    <a class="post-link" href="${esc(m.link)}" target="_blank" rel="noopener noreferrer">${ICON_LINK}<span>${esc(linkLabel(m.link))}</span></a>` : '';
  const acts = admin ? `
    <div class="post-acts">
      <button type="button" class="post-act press" data-mat-up="${esc(m.id)}" aria-label="위로"${first ? ' disabled' : ''}>▲</button>
      <button type="button" class="post-act press" data-mat-down="${esc(m.id)}" aria-label="아래로"${last ? ' disabled' : ''}>▼</button>
      <button type="button" class="post-act press" data-mat-edit="${esc(m.id)}">고치기</button>
      <button type="button" class="post-act is-del press" data-mat-del="${esc(m.id)}">지우기</button>
    </div>` : '';
  return `
    <article class="post mat" data-mat="${esc(m.id)}">
      ${m.title ? `<h4 class="post-title">${esc(m.title)}</h4>` : ''}
      ${media}${video}
      ${m.body ? `<p class="post-body">${esc(m.body)}</p>` : ''}
      ${link}${acts}
    </article>`;
}

// sections: [{ id, name, items }]. opts.admin: 섹션 이름 바꾸기·옮기기·지우기, 자료 + 버튼
export function materialsHTML(sections, { admin = false } = {}) {
  return sections.map((s, i) => {
    const items = s.items ?? [];
    const head = admin ? `
      <div class="mat-col-acts">
        <button type="button" class="post-act press" data-sec-left="${esc(s.id)}" aria-label="왼쪽으로"${i === 0 ? ' disabled' : ''}>◀</button>
        <button type="button" class="post-act press" data-sec-right="${esc(s.id)}" aria-label="오른쪽으로"${i === sections.length - 1 ? ' disabled' : ''}>▶</button>
        <button type="button" class="post-act press" data-sec-rename="${esc(s.id)}">이름</button>
        <button type="button" class="post-act is-del press" data-sec-del="${esc(s.id)}">지우기</button>
      </div>` : '';
    return `
      <section class="post-col mat-col" data-sec="${esc(s.id)}" aria-label="${esc(s.name)}">
        <header class="col-head"><h3>${esc(s.name)}</h3></header>
        ${head}
        ${admin ? `
          <button type="button" class="col-add press" data-mat-new="${esc(s.id)}" aria-label="${esc(s.name)}에 자료 올리기">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>` : ''}
        <div class="col-posts">${items.length
          ? items.map((m, j) => materialCardHTML(m, { admin, first: j === 0, last: j === items.length - 1 })).join('')
          : '<div class="col-empty">아직 자료가 없어요</div>'}</div>
      </section>`;
  }).join('');
}

// 영상 썸네일을 누르면 그 자리에 플레이어. 한 번에 하나만
export function bindVideos(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-yt]');
    if (!b) return;
    closeVideos(root);
    const f = document.createElement('iframe');
    f.className = 'mat-yt-frame';
    f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(b.dataset.yt)}?autoplay=1&rel=0`;
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    f.title = '영상';
    f.dataset.ytFrom = b.dataset.yt;
    b.replaceWith(f);
  });
}

// 재생 중인 영상을 다시 썸네일로 (탭을 바꾸거나 화면이 숨겨질 때)
export function closeVideos(root = document) {
  root.querySelectorAll('iframe.mat-yt-frame').forEach((f) => {
    const id = f.dataset.ytFrom;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mat-yt press';
    b.dataset.yt = id;
    b.setAttribute('aria-label', '영상 재생');
    b.innerHTML = `<img src="https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg" alt="" loading="lazy" decoding="async"><span class="mat-yt-play">${ICON_PLAY}</span>`;
    f.replaceWith(b);
  });
}
