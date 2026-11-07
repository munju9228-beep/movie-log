// ─────────────────────────────────────────────────────────────
// 데이터 저장소
//  - Firebase 설정이 있으면 Firestore(친구와 실시간 공유)
//  - 없으면 localStorage(이 브라우저에만 저장, 미리보기용)
// 두 저장소는 같은 함수 이름을 제공하므로 app.js 는 어느 쪽인지 신경 쓰지 않습니다.
//
// 데이터 구조
//  item : { id, title, type, year, posterUrl, synopsis, addedBy, createdAt,
//           ratings: { 이름: 별점 }, watchedAt }
//         watchedAt 이 있으면 "함께 본 콘텐츠", 없으면 "같이 볼 콘텐츠"
//  post : { id, author, text, photos: [이미지], createdAt }
//  meta : { renamed: { 이전이름: 새이름 } }  (items 컬렉션의 '_meta' 문서)
//         다른 기기에 남아 있는 예전 이름을 새 이름으로 자동 전환하는 데 사용
// ─────────────────────────────────────────────────────────────

const FIREBASE_VER = '10.12.2';
const DOC_LIMIT = 950 * 1024; // Firestore 문서 1건 최대 1MB → 여유를 둔 한도
const META_ID = '_meta';

export async function createStore(cfg, room) {
  if (cfg && cfg.firebase) return createFirebaseStore(cfg.firebase, room);
  return createLocalStore();
}

// 별점 변경 규칙: 첫 별점이 생기면 watchedAt 기록('함께 본 콘텐츠'로 이동).
// 한 번 함께 본 콘텐츠가 되면 별점을 지워도 그대로 유지
function applyRating(item, name, score) {
  const ratings = { ...(item.ratings || {}) };
  if (score == null) delete ratings[name];
  else ratings[name] = score;
  const has = Object.keys(ratings).length > 0;
  return { ratings, watchedAt: item.watchedAt || (has ? Date.now() : null) };
}

// 이름 변경: 예전 이름(olds)의 별점·추가자를 새 이름으로 옮김
// 새 이름으로 이미 남긴 별점이 있으면 그것을 유지, 없으면 olds 순서대로 첫 번째 별점 사용
function migrateItem(item, olds, newName) {
  const ratings = { ...(item.ratings || {}) };
  let changed = false;
  for (const o of olds) {
    if (Object.prototype.hasOwnProperty.call(ratings, o)) {
      if (!Object.prototype.hasOwnProperty.call(ratings, newName)) ratings[newName] = ratings[o];
      delete ratings[o];
      changed = true;
    }
  }
  const patch = {};
  if (changed) patch.ratings = ratings;
  if (olds.includes(item.addedBy)) patch.addedBy = newName;
  return Object.keys(patch).length ? patch : null;
}

function nextRenamed(prev, olds, newName) {
  const r = { ...(prev || {}) };
  delete r[newName]; // 예전에 쓰던 이름으로 되돌아온 경우
  for (const k of Object.keys(r)) if (olds.includes(r[k])) r[k] = newName;
  for (const o of olds) r[o] = newName;
  return r;
}

const cleanOlds = (oldNames, newName) => [...new Set(oldNames)].filter(n => n && n !== newName);

function checkSize(obj, what) {
  const size = JSON.stringify(obj).length;
  if (size > DOC_LIMIT) {
    throw new Error(`${what} 용량이 너무 큽니다. 사진 수를 줄이거나 더 작은 이미지를 사용해 주세요.`);
  }
}

// ───────────── 로컬(localStorage) 저장소 ─────────────
function createLocalStore() {
  const KEY = 'movielog:data:v1';
  const itemSubs = new Set();
  const postSubs = new Set(); // { itemId, cb }

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { items: {}, posts: {} }; }
    catch { return { items: {}, posts: {} }; }
  };
  let db = load();

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const itemList = () => Object.values(db.items).map(x => ({ ...x }));
  const postList = id => Object.values(db.posts[id] || {}).map(x => ({ ...x }));

  function emit() {
    itemSubs.forEach(cb => cb(itemList(), db.meta || {}));
    postSubs.forEach(s => s.cb(postList(s.itemId)));
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch {
      db = load();
      throw new Error('브라우저 저장 공간이 부족합니다. 사진을 줄이거나 Firebase 연결 후 사용해 주세요.');
    }
    emit();
  }
  // 다른 탭에서 바뀐 내용 반영
  window.addEventListener('storage', e => { if (e.key === KEY) { db = load(); emit(); } });

  return {
    mode: 'local',
    subscribeItems(cb) {
      itemSubs.add(cb); setTimeout(() => cb(itemList(), db.meta || {}));
      return () => itemSubs.delete(cb);
    },
    subscribePosts(itemId, cb) {
      const s = { itemId, cb }; postSubs.add(s); setTimeout(() => cb(postList(itemId)));
      return () => postSubs.delete(s);
    },
    async addItem(data) {
      const id = uid();
      db.items[id] = { ratings: {}, watchedAt: null, ...data, id, createdAt: Date.now() };
      save(); return id;
    },
    async updateItem(id, patch) {
      if (!db.items[id]) return;
      db.items[id] = { ...db.items[id], ...patch }; save();
    },
    async deleteItem(id) {
      delete db.items[id]; delete db.posts[id]; save();
    },
    async setRating(id, name, score) {
      const it = db.items[id]; if (!it) return;
      db.items[id] = { ...it, ...applyRating(it, name, score) }; save();
    },
    async addPost(itemId, post) {
      const id = uid();
      (db.posts[itemId] ||= {})[id] = { ...post, id, createdAt: Date.now() };
      save();
    },
    async deletePost(itemId, postId) {
      if (db.posts[itemId]) { delete db.posts[itemId][postId]; save(); }
    },
    async renameUser(oldNames, newName) {
      const olds = cleanOlds(oldNames, newName);
      if (!olds.length) return;
      for (const id of Object.keys(db.items)) {
        const patch = migrateItem(db.items[id], olds, newName);
        if (patch) db.items[id] = { ...db.items[id], ...patch };
      }
      for (const ps of Object.values(db.posts)) {
        for (const p of Object.values(ps)) if (olds.includes(p.author)) p.author = newName;
      }
      db.meta = { ...(db.meta || {}), renamed: nextRenamed(db.meta?.renamed, olds, newName) };
      save();
    }
  };
}

// ───────────── Firebase(Firestore) 저장소 ─────────────
async function createFirebaseStore(firebaseConfig, room) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VER}`;
  const [{ initializeApp }, fs, { getAuth, signInAnonymously }] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
    import(`${base}/firebase-auth.js`)
  ]);
  const {
    getFirestore, collection, doc, onSnapshot, addDoc, updateDoc,
    deleteDoc, runTransaction, getDocs, writeBatch, query, where
  } = fs;

  const app = initializeApp(firebaseConfig);
  await signInAnonymously(getAuth(app)); // 보안 규칙에서 로그인한 사용자만 허용
  const db = getFirestore(app);

  const itemsCol = collection(db, 'rooms', room, 'items');
  const postsCol = itemId => collection(db, 'rooms', room, 'items', itemId, 'posts');
  const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

  return {
    mode: 'firebase',
    subscribeItems(cb, onErr) {
      return onSnapshot(itemsCol, s => {
        const all = rows(s);
        const meta = all.find(r => r.id === META_ID) || {};
        cb(all.filter(r => r.id !== META_ID), meta);
      }, onErr);
    },
    subscribePosts(itemId, cb, onErr) {
      return onSnapshot(postsCol(itemId), s => cb(rows(s)), onErr);
    },
    async addItem(data) {
      const docData = { ratings: {}, watchedAt: null, ...data, createdAt: Date.now() };
      checkSize(docData, '포스터 이미지');
      const ref = await addDoc(itemsCol, docData);
      return ref.id;
    },
    async updateItem(id, patch) {
      checkSize(patch, '포스터 이미지');
      await updateDoc(doc(itemsCol, id), patch);
    },
    async deleteItem(id) {
      const posts = await getDocs(postsCol(id));
      const batch = writeBatch(db);
      posts.forEach(p => batch.delete(p.ref));
      batch.delete(doc(itemsCol, id));
      await batch.commit();
    },
    async setRating(id, name, score) {
      // 여러 명이 동시에 눌러도 서로 덮어쓰지 않도록 트랜잭션 사용
      await runTransaction(db, async tx => {
        const ref = doc(itemsCol, id);
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        tx.update(ref, applyRating(snap.data(), name, score));
      });
    },
    async addPost(itemId, post) {
      const docData = { ...post, createdAt: Date.now() };
      checkSize(docData, '사진');
      await addDoc(postsCol(itemId), docData);
    },
    async deletePost(itemId, postId) {
      await deleteDoc(doc(postsCol(itemId), postId));
    },
    async renameUser(oldNames, newName) {
      const olds = cleanOlds(oldNames, newName);
      if (!olds.length) return;
      const items = (await getDocs(itemsCol)).docs.filter(d => d.id !== META_ID);

      // 1) 각 콘텐츠의 별점·추가자 (동시에 다른 사람이 별점을 바꿔도 안전하도록 트랜잭션)
      await Promise.all(items
        .filter(d => migrateItem(d.data(), olds, newName))
        .map(d => runTransaction(db, async tx => {
          const snap = await tx.get(d.ref);
          if (!snap.exists()) return;
          const patch = migrateItem(snap.data(), olds, newName);
          if (patch) tx.update(d.ref, patch);
        })));

      // 2) 각 콘텐츠에 남긴 글의 작성자
      const chunks = [];
      for (let i = 0; i < olds.length; i += 10) chunks.push(olds.slice(i, i + 10));
      await Promise.all(items.flatMap(d => chunks.map(async names => {
        const posts = await getDocs(query(postsCol(d.id), where('author', 'in', names)));
        if (posts.empty) return;
        const batch = writeBatch(db);
        posts.forEach(p => batch.update(p.ref, { author: newName }));
        await batch.commit();
      })));

      // 3) 다른 기기에 남은 예전 이름도 자동으로 새 이름으로 바뀌도록 기록
      await runTransaction(db, async tx => {
        const ref = doc(itemsCol, META_ID);
        const snap = await tx.get(ref);
        tx.set(ref, { renamed: nextRenamed(snap.exists() ? snap.data().renamed : null, olds, newName) }, { merge: true });
      });
    }
  };
}
