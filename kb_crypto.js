// Web版：暗号化したデータ（data/kb_bundle.enc）を、パスワードから作った鍵でブラウザの中で復号する。
// 形式・鍵の作り方は tools/encrypt_bundle.py と同じ。サーバーにパスワードを送ることはない。
(function () {
  'use strict';

  var MAGIC = 'KBENC1';
  var SALT = new TextEncoder().encode('adamay-ka/kb-viewer/web/v1');
  var STORE = 'kb_viewer_key_v1';
  var currentKey = null; // 開いたあとの鍵（掲示板の設定を読むのに使う。保存はしない）

  async function fetchBlob(path) {
    var r = await fetch(path || 'data/kb_bundle.enc');
    if (!r.ok) throw new Error('データを読めません（' + r.status + '）');
    var b = new Uint8Array(await r.arrayBuffer());
    if (new TextDecoder().decode(b.subarray(0, 6)) !== MAGIC) throw new Error('データの形式が違います');
    return b;
  }

  function iterationsOf(b) {
    return ((b[6] << 24) >>> 0) + (b[7] << 16) + (b[8] << 8) + b[9];
  }

  async function deriveKey(password, iterations) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: SALT, iterations: iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }

  function decryptRaw(key, b) {
    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b.subarray(10, 22), additionalData: new TextEncoder().encode(MAGIC) },
      key, b.subarray(22));
  }

  async function decryptText(key, b) {
    var plain = await decryptRaw(key, b);
    var stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }

  function b64(buf) {
    var s = '', a = new Uint8Array(buf);
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s);
  }

  function unb64(s) {
    var bin = atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  function store() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  // パスワードで開く。remember なら、この端末に鍵を保存する（パスワード自体は保存しない）
  window.kbUnlock = async function (password, remember) {
    var b = await fetchBlob();
    var key = await deriveKey(password, iterationsOf(b));
    var text;
    try {
      text = await decryptText(key, b);
    } catch (e) {
      throw new Error('パスワードが違います');
    }
    currentKey = key;
    var s = store();
    if (s) {
      if (remember) s.setItem(STORE, b64(await crypto.subtle.exportKey('raw', key)));
      else s.removeItem(STORE);
    }
    return text;
  };

  // 保存した鍵で開く。鍵がない・合わないときは null
  window.kbUnlockSaved = async function () {
    var s = store(), saved = s && s.getItem(STORE);
    if (!saved) return null;
    var b = await fetchBlob();
    try {
      var key = await crypto.subtle.importKey('raw', unb64(saved), { name: 'AES-GCM' }, false, ['decrypt']);
      var text = await decryptText(key, b);
      currentKey = key;
      return text;
    } catch (e) {
      s.removeItem(STORE);
      return null;
    }
  };

  // この端末の鍵を消す（次からパスワードが必要）
  window.kbLock = function () {
    currentKey = null;
    var s = store();
    if (s) s.removeItem(STORE);
  };

  // 掲示板の設定（GitHub のリポジトリとトークン）。データと同じ鍵で暗号化してある。ないときは null
  window.kbBoardConfig = async function () {
    if (!currentKey) return null;
    var r = await fetch('data/board.enc');
    if (!r.ok) return null;
    var b = new Uint8Array(await r.arrayBuffer());
    if (new TextDecoder().decode(b.subarray(0, 6)) !== MAGIC) return null;
    try {
      return new TextDecoder().decode(await decryptRaw(currentKey, b));
    } catch (e) {
      return null;
    }
  };

  // オフラインで使えるよう、ファイルを端末に保存する（sw.js）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js'); });
  }
})();
