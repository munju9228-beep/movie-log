import { createStore } from './store.js';

const CFG = window.APP_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');

const LS_NAME = 'movielog:name';
const LS_ROOM = 'movielog:room';
const LS_SORT = 'movielog:sort';
const MAX_PHOTOS = 3;

const state = {
  store: null,
  items: [],
  itemsLoaded: false,
  me: lsGet(LS_NAME),
  sort: lsGet(LS_SORT) || 'recent',
  currentId: null,
  posts: [],
  unsubPosts: null,
  pendingPhotos: []
};

// ───────────── 공통 도우미 ─────────────
function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 무시 */ } }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const fmtDate = ms => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
const fmtDateTime = ms => { if (!ms) return ''; const d = new Date(ms); return `${fmtDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const avgOf = r => { const v = Object.values(r || {}); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const fmtScore = n => n == null ? '-' : n.toFixed(1);
const itemHref = id => `#/item/${encodeURIComponent(id)}`;
const findItem = id => state.items.find(x => x.id === id);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

// 이미지 파일을 줄여서 JPEG 데이터 URL로 변환 (Firestore 문서 용량 절약)
async function shrinkImage(file, maxSide, quality) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('이미지를 읽을 수 없습니다.')); i.src = url;
    });
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}

// ───────────── 모달 ─────────────
function openModal(html, { dismissible = true, className = '' } = {}) {
  const root = $('#modalRoot');
  const ov = document.createElement('div');
  ov.className = `overlay ${className}`;
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  root.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && dismissible) close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', e => {
    if ((e.target === ov && dismissible) || e.target.closest('[data-close]')) close();
  });
  setTimeout(() => { const f = ov.querySelector('input:not([type=file]), textarea'); if (f) f.focus(); });
  return { el: ov, close };
}

// 이름(및 방 코드) 입력
function askIdentity({ needRoom, cancellable }) {
  return new Promise(resolve => {
    const m = openModal(`
      <h2>${cancellable ? '이름 변경' : '반갑습니다'}</h2>
      <p>${cancellable ? '이전 이름으로 남긴 별점과 글은 그대로 남습니다.' : '별점과 글에 표시될 이름을 정해 주세요.'}</p>
      <form class="form" id="idForm">
        <label>이름 <input name="name" required maxlength="12" value="${esc(state.me)}" placeholder="예: 주영"></label>
        ${needRoom ? `<label>방 코드 <input name="room" required maxlength="40" value="${esc(lsGet(LS_ROOM))}" placeholder="친구들과 정한 코드"></label>
          <span class="hint">같은 방 코드를 입력한 사람끼리 목록을 함께 봅니다.</span>` : ''}
        <div class="modal-actions">
          ${cancellable ? '<button type="button" class="btn" data-close>취소</button>' : ''}
          <button class="btn primary" type="submit">확인</button>
        </div>
      </form>`, { dismissible: cancellable });
    $('#idForm', m.el).addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get('name') || '').trim();
      const room = needRoom ? String(fd.get('room') || '').trim().replace(/\//g, '-') : '';
      if (!name || (needRoom && !room)) return;
      lsSet(LS_NAME, name);
      if (needRoom) lsSet(LS_ROOM, room);
      m.close();
      resolve({ name, room });
    });
  });
}

// ───────────── 별점 위젯 ─────────────
function starsHtml(value, editableId) {
  const v = value || 0;
  let s = '';
  for (let i = 1; i <= 5; i++) {
    const pct = Math.max(0, Math.min(1, v - (i - 1))) * 100;
    s += `<span class="star" data-i="${i}"><span class="fill" style="width:${pct}%">★</span>★</span>`;
  }
  if (!editableId) return `<span class="stars" aria-label="별점 ${v}점">${s}</span>`;
  return `<span class="stars editable" data-id="${esc(editableId)}" data-value="${v}" tabindex="0"
    role="slider" aria-label="내 별점" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${v}"
    title="왼쪽 절반을 누르면 0.5점 단위">${s}</span>`;
}

function paintStars(el, v) {
  el.querySelectorAll('.fill').forEach((f, idx) => {
    f.style.width = Math.max(0, Math.min(1, v - idx)) * 100 + '%';
  });
}

function valueFromPointer(e) {
  const star = e.target.closest('.star');
  if (!star) return null;
  const r = star.getBoundingClientRect();
  const i = Number(star.dataset.i);
  return (e.clientX - r.left) < r.width / 2 ? i - 0.5 : i;
}

function members(extra = []) {
  const set = new Set();
  state.items.forEach(it => {
    Object.keys(it.ratings || {}).forEach(n => set.add(n));
    if (it.addedBy) set.add(it.addedBy);
  });
  extra.forEach(n => n && set.add(n));
  if (state.me) set.add(state.me);
  return [...set].sort((a, b) => (a === state.me ? -1 : b === state.me ? 1 : a.localeCompare(b, 'ko')));
}

function ratingRows(it) {
  return `<ul class="ratings">${members().map(name => {
    const v = it.ratings?.[name];
    const mine = name === state.me;
    return `<li class="rating-row ${mine ? 'mine' : ''}">
      <span class="who" title="${esc(name)}">${esc(name)}${mine ? ' (나)' : ''}</span>
      ${starsHtml(v, mine ? it.id : null)}
      <span class="score">${v != null ? v.toFixed(1) : '-'}</span>
    </li>`;
  }).join('')}</ul>`;
}

async function rate(id, value) {
  const it = findItem(id);
  if (!it) return;
  const wasTodo = !it.watchedAt;
  try {
    await state.store.setRating(id, state.me, value);
    if (wasTodo && value != null) toast(`'${it.title}'을(를) 함께 본 콘텐츠로 옮겼습니다.`);
    else if (value == null && Object.keys(it.ratings || {}).length <= 1) toast('별점이 모두 지워져 같이 볼 콘텐츠로 돌아갔습니다.');
  } catch (e) { toast('저장하지 못했습니다. ' + e.message); }
}

// ───────────── 목록 화면 ─────────────
function posterHtml(it) {
  if (it.posterUrl) return `<img class="poster-img" src="${esc(it.posterUrl)}" alt="${esc(it.title)} 포스터" loading="lazy" referrerpolicy="no-referrer">`;
  return `<div class="poster-none" aria-hidden="true">${esc((it.title || '?').trim().charAt(0))}</div>`;
}

function cardHtml(it) {
  const a = avgOf(it.ratings);
  const meta = [it.type, it.year].filter(Boolean).map(esc).join(' · ');
  const sub = it.watchedAt
    ? `${fmtDate(it.watchedAt)} 평가`
    : `${esc(it.addedBy || '')} 님이 추가 · ${fmtDate(it.createdAt)}`;
  return `<article class="card ${it.watchedAt ? '' : 'is-todo'}">
    <a class="poster" href="${itemHref(it.id)}">${posterHtml(it)}</a>
    <div class="card-body">
      <a class="title" href="${itemHref(it.id)}">${esc(it.title)}</a>
      <div class="meta">${meta}${meta ? ' · ' : ''}${sub}</div>
      ${it.watchedAt ? `<div class="avg">평균 <b>${fmtScore(a)}</b> / 5 · ${Object.keys(it.ratings).length}명</div>` : ''}
      ${ratingRows(it)}
      ${it.watchedAt ? '' : '<div class="todo-hint">보고 나서 별점을 남기면 함께 본 콘텐츠로 옮겨집니다.</div>'}
    </div>
  </article>`;
}

function renderList() {
  document.title = CFG.siteTitle || '같이 본 영화';
  if (!state.itemsLoaded) { view.innerHTML = '<p class="empty">불러오는 중…</p>'; return; }

  const watched = state.items.filter(i => i.watchedAt);
  const toWatch = state.items.filter(i => !i.watchedAt).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (state.sort === 'rating') {
    watched.sort((a, b) => (avgOf(b.ratings) - avgOf(a.ratings)) || (b.watchedAt - a.watchedAt));
  } else {
    watched.sort((a, b) => b.watchedAt - a.watchedAt);
  }

  view.innerHTML = `
    <section class="section">
      <div class="section-head">
        <h2>함께 본 콘텐츠<span class="count">${watched.length}</span></h2>
        <div class="sort" role="group" aria-label="정렬">
          <button type="button" data-sort="recent" class="${state.sort === 'recent' ? 'on' : ''}">최신순</button>
          <button type="button" data-sort="rating" class="${state.sort === 'rating' ? 'on' : ''}">별점순</button>
        </div>
      </div>
      ${watched.length
        ? `<div class="card-grid">${watched.map(cardHtml).join('')}</div>`
        : '<p class="empty">아직 함께 본 콘텐츠가 없습니다. 아래 목록에서 별점을 남기면 이곳으로 옮겨집니다.</p>'}
    </section>
    <section class="section">
      <div class="section-head">
        <h2>같이 볼 콘텐츠<span class="count">${toWatch.length}</span></h2>
        <button type="button" class="btn primary" data-act="add">+ 콘텐츠 추가</button>
      </div>
      ${toWatch.length
        ? `<div class="card-grid">${toWatch.map(cardHtml).join('')}</div>`
        : '<p class="empty">같이 보고 싶은 영화나 드라마를 추가해 보세요.</p>'}
    </section>`;
}

// ───────────── 상세 화면 ─────────────
function renderDetailShell() {
  state.pendingPhotos = [];
  view.innerHTML = `
    <a href="#/" class="back">← 목록으로</a>
    <div id="detailHead"></div>
    <section class="section" id="postSection">
      <div class="section-head"><h2>기록</h2><span class="hint">줄거리, 감상, 좋았던 장면 등을 자유롭게 남겨 주세요.</span></div>
      <form id="postForm" class="post-form">
        <textarea name="text" rows="4" maxlength="5000" placeholder="${esc(state.me)} 님의 생각을 남겨 주세요."></textarea>
        <div class="post-form-row">
          <label class="btn">사진 첨부<input type="file" accept="image/*" multiple hidden id="photoInput"></label>
          <span class="hint">최대 ${MAX_PHOTOS}장</span>
          <div class="thumbs" id="pendingThumbs"></div>
          <span class="spacer"></span>
          <button class="btn primary" type="submit">남기기</button>
        </div>
      </form>
      <div id="postList"></div>
    </section>`;
  renderDetailHead();
  renderPosts();
}

function renderDetailHead() {
  const el = $('#detailHead');
  if (!el) return;
  const it = findItem(state.currentId);
  $('#postSection').hidden = !it;
  if (!it) {
    el.innerHTML = state.itemsLoaded ? '<p class="empty">삭제되었거나 찾을 수 없는 콘텐츠입니다.</p>' : '<p class="empty">불러오는 중…</p>';
    return;
  }
  document.title = `${it.title} - ${CFG.siteTitle || '같이 본 영화'}`;
  const a = avgOf(it.ratings);
  const n = Object.keys(it.ratings || {}).length;
  const meta = [it.type, it.year].filter(Boolean).map(esc).join(' · ');
  el.innerHTML = `
    <div class="detail">
      <div class="detail-poster">${posterHtml(it)}</div>
      <div class="detail-info">
        <span class="badge ${it.watchedAt ? 'done' : ''}">${it.watchedAt ? '함께 본 콘텐츠' : '같이 볼 콘텐츠'}</span>
        <h1>${esc(it.title)}</h1>
        <div class="meta">${meta}${meta ? ' · ' : ''}${esc(it.addedBy || '')} 님이 추가 (${fmtDate(it.createdAt)})${it.watchedAt ? ` · ${fmtDate(it.watchedAt)} 첫 평가` : ''}</div>
        <div class="avg-big">평균 별점 <b>${fmtScore(a)}</b> / 5 <span>(${n}명 참여)</span></div>
        ${ratingRows(it)}
        ${it.ratings?.[state.me] != null ? '<button type="button" class="btn-link clear-rating" data-act="clear-rating">내 별점 지우기</button>' : ''}
        <h3>줄거리 · 소개</h3>
        <p class="synopsis">${it.synopsis ? esc(it.synopsis) : '<span class="muted">아직 작성된 소개가 없습니다. 정보 수정에서 추가할 수 있습니다.</span>'}</p>
        <div class="detail-actions">
          <button type="button" class="btn" data-act="edit">정보 수정</button>
          <button type="button" class="btn danger" data-act="delete">삭제</button>
        </div>
      </div>
    </div>`;
}

function renderPosts() {
  const el = $('#postList');
  if (!el) return;
  const posts = [...state.posts].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  el.innerHTML = posts.length ? posts.map(p => `
    <article class="post">
      <div class="post-head">
        <span class="author">${esc(p.author)}</span>
        <span class="date">${fmtDateTime(p.createdAt)}</span>
        ${p.author === state.me ? `<button type="button" class="btn-link" data-act="del-post" data-post="${esc(p.id)}">삭제</button>` : ''}
      </div>
      ${p.text ? `<p class="post-text">${esc(p.text)}</p>` : ''}
      ${p.photos?.length ? `<div class="post-photos">${p.photos.map((src, i) =>
        `<img src="${esc(src)}" alt="${esc(p.author)} 님의 사진 ${i + 1}" data-act="zoom" loading="lazy">`).join('')}</div>` : ''}
    </article>`).join('') : '<p class="empty">아직 남긴 기록이 없습니다. 첫 기록을 남겨 보세요.</p>';
}

function renderPendingThumbs() {
  const el = $('#pendingThumbs');
  if (!el) return;
  el.innerHTML = state.pendingPhotos.map((src, i) =>
    `<div class="thumb"><img src="${src}" alt="첨부 예정 사진 ${i + 1}"><button type="button" data-act="unpend" data-i="${i}" aria-label="사진 빼기">×</button></div>`).join('');
}

// ───────────── 콘텐츠 추가·수정 ─────────────
function openItemModal(existing) {
  let poster = existing?.posterUrl || '';
  const isUrl = poster && !poster.startsWith('data:');
  const types = ['영화', '드라마', '기타'];
  const m = openModal(`
    <h2>${existing ? '정보 수정' : '같이 볼 콘텐츠 추가'}</h2>
    <form class="form" id="itemForm">
      <label>제목 <input name="title" required maxlength="100" value="${esc(existing?.title)}"></label>
      <div class="row2">
        <label>구분
          <select name="type">${types.map(t => `<option ${(existing?.type || '영화') === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>
        <label>연도 <input name="year" inputmode="numeric" maxlength="4" value="${esc(existing?.year)}" placeholder="예: 2024"></label>
      </div>
      <div class="field">포스터 이미지
        <div class="poster-pick">
          <div class="poster-preview" id="posterPreview"></div>
          <div class="poster-pick-ctrl">
            <label class="btn">파일 선택<input type="file" accept="image/*" hidden id="posterFile"></label>
            <input name="posterUrl" type="url" placeholder="또는 이미지 주소(URL) 붙여넣기" value="${isUrl ? esc(poster) : ''}">
            <button type="button" class="btn-link" id="posterClear">이미지 빼기</button>
          </div>
        </div>
      </div>
      <label>줄거리 · 소개 <textarea name="synopsis" rows="5" maxlength="5000">${esc(existing?.synopsis)}</textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn" data-close>취소</button>
        <button type="submit" class="btn primary">${existing ? '저장' : '추가'}</button>
      </div>
    </form>`);

  const form = $('#itemForm', m.el);
  const preview = $('#posterPreview', m.el);
  const urlInput = form.elements.posterUrl;
  const paint = () => {
    preview.innerHTML = posterHtml({ posterUrl: poster, title: form.elements.title.value || '?' });
  };
  paint();

  $('#posterFile', m.el).addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { poster = await shrinkImage(f, 600, 0.82); urlInput.value = ''; paint(); }
    catch (err) { toast(err.message); }
  });
  urlInput.addEventListener('input', () => { poster = urlInput.value.trim(); paint(); });
  form.elements.title.addEventListener('input', () => { if (!poster) paint(); });
  $('#posterClear', m.el).addEventListener('click', () => { poster = ''; urlInput.value = ''; paint(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = {
      title: String(fd.get('title')).trim(),
      type: String(fd.get('type')),
      year: String(fd.get('year') || '').trim(),
      synopsis: String(fd.get('synopsis') || '').trim(),
      posterUrl: poster
    };
    if (!data.title) return;
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      if (existing) {
        await state.store.updateItem(existing.id, data);
        toast('저장했습니다.');
      } else {
        await state.store.addItem({ ...data, addedBy: state.me });
        toast(`'${data.title}'을(를) 같이 볼 콘텐츠에 추가했습니다.`);
      }
      m.close();
    } catch (err) { toast('저장하지 못했습니다. ' + err.message); btn.disabled = false; }
  });
}

// ───────────── 이벤트 ─────────────
function bindEvents() {
  view.addEventListener('click', async e => {
    const stars = e.target.closest('.stars.editable');
    if (stars) {
      const v = valueFromPointer(e);
      if (v != null && v !== Number(stars.dataset.value)) {
        stars.dataset.value = v; paintStars(stars, v);
        rate(stars.dataset.id, v);
      }
      return;
    }

    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) { state.sort = sortBtn.dataset.sort; lsSet(LS_SORT, state.sort); renderList(); return; }

    const act = e.target.closest('[data-act]');
    if (!act) return;
    const it = findItem(state.currentId);
    switch (act.dataset.act) {
      case 'add': openItemModal(); break;
      case 'edit': if (it) openItemModal(it); break;
      case 'delete':
        if (it && confirm(`'${it.title}'과(와) 남긴 별점·기록을 모두 삭제할까요? 되돌릴 수 없습니다.`)) {
          try { await state.store.deleteItem(it.id); toast('삭제했습니다.'); location.hash = '#/'; }
          catch (err) { toast('삭제하지 못했습니다. ' + err.message); }
        }
        break;
      case 'clear-rating': if (it) rate(it.id, null); break;
      case 'del-post':
        if (confirm('이 기록을 삭제할까요?')) {
          try { await state.store.deletePost(state.currentId, act.dataset.post); }
          catch (err) { toast('삭제하지 못했습니다. ' + err.message); }
        }
        break;
      case 'zoom':
        openModal(`<img src="${esc(act.getAttribute('src'))}" alt="">`, { className: 'lightbox' })
          .el.querySelector('.modal').setAttribute('data-close', '');
        break;
      case 'unpend':
        state.pendingPhotos.splice(Number(act.dataset.i), 1); renderPendingThumbs(); break;
    }
  });

  // 별점 미리보기(마우스를 올리면 칠해짐)
  view.addEventListener('pointermove', e => {
    const stars = e.target.closest('.stars.editable');
    if (!stars || e.pointerType === 'touch') return;
    const v = valueFromPointer(e); if (v != null) paintStars(stars, v);
  });
  view.addEventListener('pointerout', e => {
    const stars = e.target.closest('.stars.editable');
    if (stars && !stars.contains(e.relatedTarget)) paintStars(stars, Number(stars.dataset.value));
  });
  // 키보드: 좌우 화살표로 0.5점씩
  view.addEventListener('keydown', e => {
    const stars = e.target.closest('.stars.editable');
    if (!stars || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const cur = Number(stars.dataset.value);
    const v = Math.max(0.5, Math.min(5, cur + (e.key === 'ArrowRight' ? 0.5 : -0.5)));
    if (v !== cur) { stars.dataset.value = v; paintStars(stars, v); rate(stars.dataset.id, v); }
  });

  view.addEventListener('change', async e => {
    if (e.target.id !== 'photoInput') return;
    const files = [...e.target.files];
    e.target.value = '';
    const room = MAX_PHOTOS - state.pendingPhotos.length;
    if (files.length > room) toast(`사진은 최대 ${MAX_PHOTOS}장까지 첨부할 수 있습니다.`);
    for (const f of files.slice(0, Math.max(0, room))) {
      try { state.pendingPhotos.push(await shrinkImage(f, 1200, 0.75)); }
      catch (err) { toast(err.message); }
    }
    renderPendingThumbs();
  });

  view.addEventListener('submit', async e => {
    if (e.target.id !== 'postForm') return;
    e.preventDefault();
    const form = e.target;
    const text = form.elements.text.value.trim();
    if (!text && !state.pendingPhotos.length) { toast('글이나 사진을 넣어 주세요.'); return; }
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await state.store.addPost(state.currentId, { author: state.me, text, photos: [...state.pendingPhotos] });
      form.reset(); state.pendingPhotos = []; renderPendingThumbs();
    } catch (err) { toast('저장하지 못했습니다. ' + err.message); }
    btn.disabled = false;
  });

  $('#btnChangeName').addEventListener('click', async () => {
    const r = await askIdentity({ needRoom: false, cancellable: true });
    state.me = r.name; updateMe(); onItemsChanged();
    if (state.currentId) renderPosts();
  });
}

// ───────────── 라우팅 ─────────────
function parseHash() {
  const m = location.hash.match(/^#\/item\/([^/?#]+)/);
  return m ? { name: 'item', id: decodeURIComponent(m[1]) } : { name: 'list' };
}

function route() {
  const r = parseHash();
  if (state.unsubPosts) { state.unsubPosts(); state.unsubPosts = null; }
  state.posts = [];
  state.currentId = null;
  if (r.name === 'item') {
    state.currentId = r.id;
    renderDetailShell();
    state.unsubPosts = state.store.subscribePosts(r.id,
      posts => { state.posts = posts; renderPosts(); },
      err => toast('기록을 불러오지 못했습니다. ' + err.message));
  } else {
    renderList();
  }
  window.scrollTo(0, 0);
}

function onItemsChanged() {
  if (parseHash().name === 'item') renderDetailHead();
  else renderList();
}

function updateMe() {
  $('#meLabel').textContent = state.me ? `${state.me} 님` : '';
}

// ───────────── 시작 ─────────────
async function boot() {
  const title = CFG.siteTitle || '같이 본 영화';
  $('#brand').textContent = title;
  document.title = title;
  bindEvents();

  const firebaseMode = !!CFG.firebase;
  const needRoom = firebaseMode && !CFG.roomCode;
  let room = CFG.roomCode || lsGet(LS_ROOM);
  if (!state.me || (needRoom && !room)) {
    const r = await askIdentity({ needRoom, cancellable: false });
    state.me = r.name;
    if (needRoom) room = r.room;
  }
  updateMe();

  try {
    state.store = await createStore(CFG, room || 'default');
  } catch (e) {
    view.innerHTML = `<div class="error-box">데이터베이스에 연결하지 못했습니다. config.js 의 Firebase 설정과 익명 로그인 사용 여부를 확인해 주세요.<br><small>${esc(e.message)}</small></div>`;
    return;
  }

  const banner = $('#modeBanner');
  if (state.store.mode === 'local') {
    banner.textContent = '미리보기 모드: 이 브라우저에만 저장됩니다. 친구와 함께 쓰려면 README의 Firebase 연결 방법을 참고해 주세요.';
    banner.hidden = false;
  } else if (needRoom) {
    banner.innerHTML = `방 코드: ${esc(room)} <button type="button" class="btn-link" id="btnRoom">방 바꾸기</button>`;
    banner.hidden = false;
    $('#btnRoom').addEventListener('click', () => {
      if (confirm('다른 방 코드로 들어갈까요?')) { lsSet(LS_ROOM, ''); location.reload(); }
    });
  }

  state.store.subscribeItems(
    items => { state.items = items; state.itemsLoaded = true; onItemsChanged(); },
    err => toast('목록을 불러오지 못했습니다. ' + err.message)
  );
  window.addEventListener('hashchange', route);
  route();
}

boot();
