// 관리 '반 게시판'(#mats): 반을 골라 섹션을 짜고(추가·이름·옮기기·지우기) 자료(글·사진·PDF·링크·유튜브)를 올린다.
// 바꿀 때마다 그 반에 새로고침 신호 → 학생 [게시판] 탭이 바로 바뀐다
import { CLASSES } from '../config.js';
import { toast } from '../ui.js';
import {
  listSections, addSection, updateSection, deleteSection, uploadMaterialFile, removeMaterialFiles,
  saveMaterial, updateMaterialSort, deleteMaterial, copySections, materialUrl, sendClassRefresh,
} from '../db.js';
import { materialsHTML, bindVideos, closeVideos } from '../materials.js';
import { shrinkPhoto } from '../posts.js';
import { errMsg } from '../gate.js';

const $ = (id) => document.getElementById(id);
const PDF_MAX = 20 * 1024 * 1024;

let classId = (() => { try { const n = Number(localStorage.getItem('matClass')); return CLASSES.includes(n) ? n : CLASSES[0]; } catch { return CLASSES[0]; } })();
let sections = [];
let busy = false;

// 고치는 중인 자료: { id, section_id, sort, file, file_type, file_name } + 새로 고른 파일
let editing = null;
let picked = null;      // { blob, type: 'image'|'pdf', name, preview }
let dropFile = false;   // 지금 파일 빼기

$('mat-class').innerHTML = CLASSES.map((n) => `<option value="${n}">${n}반</option>`).join('');
$('mat-class').value = String(classId);
$('mat-class').addEventListener('change', () => {
  classId = Number($('mat-class').value);
  try { localStorage.setItem('matClass', String(classId)); } catch {}
  reload();
});

// 관리 화면이 항목을 열 때(로그인 전이면 조용히 실패) · 바꾼 뒤
export async function refreshMats() {
  sections = await listSections(classId);
  render();
}
const reload = () => refreshMats().catch((err) => toast(errMsg(err), 'error'));

function render() {
  closeVideos($('mat-board'));
  const n = sections.reduce((a, s) => a + s.items.length, 0);
  $('mat-count').textContent = `섹션 ${sections.length}개 · 자료 ${n}개`;
  $('mat-board').innerHTML = sections.length
    ? materialsHTML(sections, { admin: true })
    : '<div class="col-empty">[+ 섹션]으로 칸을 만들어 주세요</div>';
}

// 바꾼 뒤: 다시 읽고 학생 화면에 신호
async function run(fn, done) {
  if (busy) return;
  busy = true;
  try {
    await fn();
    if (done) toast(done);
    sendClassRefresh(classId);
  } catch (err) {
    console.error(err);
    toast(errMsg(err), 'error');
  } finally {
    busy = false;
    await reload();
  }
}

const askName = (now = '') => {
  const v = prompt('섹션 이름 (30자까지)', now);
  if (v === null) return null;
  const name = v.trim().slice(0, 30);
  if (!name) { toast('이름을 넣어 주세요', 'error'); return null; }
  return name;
};

$('mat-add-sec').addEventListener('click', () => {
  const name = askName();
  if (name) run(() => addSection(classId, name, sections.length), '섹션을 만들었어요');
});

$('mat-copy').addEventListener('click', () => {
  const others = CLASSES.filter((n) => n !== classId);
  const v = prompt(`어느 반의 섹션과 자료를 ${classId}반 뒤에 붙일까요? (${others.join(', ')})`);
  if (v === null) return;
  const from = Number(v.replace(/[^0-9]/g, ''));
  if (!others.includes(from)) { toast('반 번호를 확인해 주세요', 'error'); return; }
  run(async () => {
    const n = await copySections(from, classId);
    if (!n) throw new Error(`${from}반에는 섹션이 없어요`);
  }, `${from}반 게시판을 가져왔어요`);
});

// 순서 바꾸기: 두 줄의 sort를 서로 바꾸지 않고 목록 전체를 0,1,2…로 다시 매긴다(같은 sort가 있어도 맞게)
async function reorder(list, i, j, save) {
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  await Promise.all(next.map((x, k) => (x.sort === k ? null : save(x.id, k))));
}

const findMat = (id) => {
  for (const s of sections) {
    const i = s.items.findIndex((m) => m.id === id);
    if (i >= 0) return { s, i, m: s.items[i] };
  }
  return null;
};

$('mat-board').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  const si = (id) => sections.findIndex((s) => s.id === id);

  if (d.secLeft || d.secRight) {
    const i = si(d.secLeft || d.secRight);
    const j = d.secLeft ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= sections.length) return;
    run(() => reorder(sections, i, j, (id, sort) => updateSection(id, { sort })));
  } else if (d.secRename) {
    const s = sections[si(d.secRename)];
    const name = s && askName(s.name);
    if (name && name !== s.name) run(() => updateSection(s.id, { name }), '이름을 바꿨어요');
  } else if (d.secDel) {
    const s = sections[si(d.secDel)];
    if (!s || !confirm(`'${s.name}' 섹션을 지울까요?${s.items.length ? `\n안에 있는 자료 ${s.items.length}개도 함께 지워져요.` : ''}`)) return;
    run(() => deleteSection(s), '섹션을 지웠어요');
  } else if (d.matNew) {
    const s = sections[si(d.matNew)];
    if (s) openDlg(null, s);
  } else if (d.matEdit) {
    const f = findMat(d.matEdit);
    if (f) openDlg(f.m, f.s);
  } else if (d.matDel) {
    const f = findMat(d.matDel);
    if (!f || !confirm(`'${f.m.title || '제목 없는 자료'}'을(를) 지울까요?`)) return;
    run(() => deleteMaterial(f.m), '지웠어요');
  } else if (d.matUp || d.matDown) {
    const f = findMat(d.matUp || d.matDown);
    if (!f) return;
    const j = d.matUp ? f.i - 1 : f.i + 1;
    if (j < 0 || j >= f.s.items.length) return;
    run(() => reorder(f.s.items, f.i, j, updateMaterialSort));
  }
});
bindVideos($('mat-board'));

/* ---------- 자료 올리기·고치기 창 ---------- */
function showFileNow() {
  const box = $('mat-file-now');
  let html = '';
  if (picked) {
    html = picked.type === 'image'
      ? `<img src="${picked.preview}" alt="고른 사진">`
      : `<b>PDF</b><span>${escText(picked.name)}</span>`;
  } else if (editing?.file && !dropFile) {
    html = editing.file_type === 'image'
      ? `<img src="${materialUrl(editing.file)}" alt="지금 사진">`
      : `<b>PDF</b><span>${escText(editing.file_name || '')}</span>`;
  }
  box.innerHTML = html ? `${html}<button type="button" class="btn btn-line btn-small" id="mat-unfile">파일 빼기</button>` : '';
  box.classList.toggle('hidden', !html);
}
const escText = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

$('mat-file-now').addEventListener('click', (e) => {
  if (!e.target.closest('#mat-unfile')) return;
  if (picked?.preview) URL.revokeObjectURL(picked.preview);
  picked = null;
  dropFile = true;
  showFileNow();
});

function openDlg(m, section) {
  editing = m ? { ...m } : { id: null, section_id: section.id, sort: section.items.length };
  picked = null;
  dropFile = false;
  const f = $('mat-form');
  f.title.value = m?.title ?? '';
  f.body.value = m?.body ?? '';
  f.link.value = m?.link ?? '';
  $('mat-file').value = '';
  $('mat-dlg-h').textContent = m ? '자료 고치기' : `${section.name}에 자료 올리기`;
  $('mat-save').disabled = false;
  $('mat-save').textContent = '저장';
  showFileNow();
  $('mat-dlg').showModal();
}

function closeDlg() {
  if (picked?.preview) URL.revokeObjectURL(picked.preview);
  picked = null;
  editing = null;
  $('mat-dlg').close();
}
$('mat-cancel').addEventListener('click', closeDlg);

$('mat-file').addEventListener('change', async () => {
  const file = $('mat-file').files[0];
  if (!file) return;
  if (picked?.preview) URL.revokeObjectURL(picked.preview);
  picked = null;
  // 사진을 줄이는 동안(1초 안팎)은 저장을 막는다(파일이 빠진 채 저장되지 않게)
  $('mat-save').disabled = true;
  $('mat-save').textContent = '사진 준비 중';
  try {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      if (file.size > PDF_MAX) throw new Error('PDF는 20MB까지 올릴 수 있어요');
      picked = { blob: file, type: 'pdf', name: file.name.slice(0, 120) };
    } else if (/^image\//.test(file.type)) {
      const blob = await shrinkPhoto(file, 2000, 0.85); // 학생 기기·와이파이 부담: 긴 변 2000px jpeg
      picked = { blob, type: 'image', name: file.name.slice(0, 120), preview: URL.createObjectURL(blob) };
    } else {
      throw new Error('사진(jpg·png)이나 PDF만 올릴 수 있어요');
    }
    dropFile = false;
  } catch (err) {
    toast(err.message === 'BAD_IMAGE' ? '사진을 읽지 못했어요' : err.message, 'error');
  }
  $('mat-file').value = '';
  $('mat-save').disabled = false;
  $('mat-save').textContent = '저장';
  showFileNow();
});

$('mat-save').addEventListener('click', async () => {
  if (!editing || busy || $('mat-save').disabled) return;
  const f = $('mat-form');
  const title = f.title.value.trim();
  const body = f.body.value.trim();
  let link = f.link.value.trim();
  if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  if (link) {
    try { new URL(link); } catch { toast('링크 주소를 확인해 주세요', 'error'); return; }
  }
  const keepFile = editing.file && !dropFile && !picked;
  if (!title && !body && !link && !picked && !keepFile) { toast('제목, 내용, 링크, 파일 중 하나는 넣어 주세요', 'error'); return; }

  const btn = $('mat-save');
  btn.disabled = true;
  btn.textContent = picked ? '올리는 중' : '저장하는 중';
  busy = true;
  let uploaded = null;
  try {
    let file = keepFile ? editing.file : null;
    let fileType = keepFile ? editing.file_type : null;
    let fileName = keepFile ? editing.file_name : null;
    if (picked) {
      uploaded = await uploadMaterialFile(classId, picked.blob, picked.type);
      file = uploaded;
      fileType = picked.type;
      fileName = picked.name;
    }
    await saveMaterial(editing.id, {
      section_id: editing.section_id, title, body, link: link || null,
      file, file_type: fileType, file_name: fileName, sort: editing.sort ?? 0,
    });
    // 바꾸거나 뺀 예전 파일은 지운다
    if (editing.file && editing.file !== file) await removeMaterialFiles([editing.file]);
    uploaded = null;
    sendClassRefresh(classId);
    toast('저장했어요');
    closeDlg();
  } catch (err) {
    console.error(err);
    if (uploaded) await removeMaterialFiles([uploaded]);
    toast(errMsg(err), 'error');
    btn.disabled = false;
    btn.textContent = '저장';
  } finally {
    busy = false;
    reload();
  }
});
