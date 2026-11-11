// ノート本文の表示（Android はアプリ内のWebView、Web版は同じオリジンの iframe で動く。ネットワークは使わない）
// Flutter → window.kbRender(payload)、JS → KB.postMessage(JSON)
(function () {
  'use strict';

  // Web版：iframe の中では、親のページと postMessage でやりとりする（同じオリジンだけ）
  if (window.parent !== window && !window.KB) {
    var origin = window.location.origin;
    window.KB = { postMessage: function (m) { window.parent.postMessage('kb:' + m, origin); } };
    window.addEventListener('message', function (e) {
      if (e.source !== window.parent || e.origin !== origin || typeof e.data !== 'string') return;
      var d;
      try { d = JSON.parse(e.data); } catch (err) { return; }
      if (d && /^kb[A-Z]\w*$/.test(d.kbCall) && typeof window[d.kbCall] === 'function') window[d.kbCall](d.arg);
    });
  }

  function post(msg) {
    if (window.KB && window.KB.postMessage) window.KB.postMessage(JSON.stringify(msg));
  }

  // 全画面の図：2本の指で拡大・縮小、1本の指で移動（iframe の中ではブラウザの拡大が効かないため）
  function enablePanZoom(box) {
    var svg = box.querySelector('svg');
    if (!svg) return;
    var scale = 1, x = 0, y = 0, pointers = {}, start = null;
    box.style.touchAction = 'none';
    box.style.overflow = 'hidden';
    svg.style.transformOrigin = '0 0';
    function apply() { svg.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')'; }
    function snapshot() {
      var ps = Object.keys(pointers).map(function (k) { return pointers[k]; });
      if (ps.length >= 2) {
        var dx = ps[0].x - ps[1].x, dy = ps[0].y - ps[1].y;
        return { n: 2, cx: (ps[0].x + ps[1].x) / 2, cy: (ps[0].y + ps[1].y) / 2, d: Math.hypot(dx, dy) || 1, scale: scale, x: x, y: y };
      }
      if (ps.length === 1) return { n: 1, cx: ps[0].x, cy: ps[0].y, scale: scale, x: x, y: y };
      return null;
    }
    box.addEventListener('pointerdown', function (e) { pointers[e.pointerId] = { x: e.clientX, y: e.clientY }; box.setPointerCapture(e.pointerId); start = snapshot(); });
    box.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId] || !start) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var now = snapshot();
      if (!now || now.n !== start.n) { start = now; return; }
      if (now.n === 2) {
        scale = Math.min(8, Math.max(0.5, start.scale * now.d / start.d));
        var k = scale / start.scale;
        x = now.cx - (start.cx - start.x) * k;
        y = now.cy - (start.cy - start.y) * k;
      } else {
        x = start.x + now.cx - start.cx;
        y = start.y + now.cy - start.cy;
      }
      apply();
    });
    function up(e) { delete pointers[e.pointerId]; start = snapshot(); }
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
    box.addEventListener('wheel', function (e) {
      e.preventDefault();
      var k = Math.exp(-e.deltaY / 300), ns = Math.min(8, Math.max(0.5, scale * k));
      k = ns / scale; scale = ns;
      var r = box.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
      x = cx - (cx - x) * k; y = cy - (cy - y) * k;
      apply();
    }, { passive: false });
    box.addEventListener('dblclick', function () { scale = 1; x = 0; y = 0; apply(); });
  }

  // 日本語の中の太字（例：**細胞外液（晶質液）**を）が Obsidian と同じく太字になるよう、markdown-it-cjk-friendly を使う
  var md = window.markdownit({ html: false, linkify: true, breaks: false, typographer: false })
    .use(window.markdownItCjkFriendly);

  // 表は横スクロールの枠に入れる
  md.renderer.rules.table_open = function () { return '<div class="table-wrap"><table>\n'; };
  md.renderer.rules.table_close = function () { return '</table></div>\n'; };

  // kb-missing:// は押せない灰色の文字にする
  var defaultLinkOpen = md.renderer.rules.link_open || function (t, i, o, e, self) { return self.renderToken(t, i, o); };
  var defaultLinkClose = md.renderer.rules.link_close || function (t, i, o, e, self) { return self.renderToken(t, i, o); };
  md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    var href = tokens[idx].attrGet('href') || '';
    if (href.indexOf('kb-missing:') === 0) {
      tokens[idx].meta = { missing: true };
      env.missingStack = (env.missingStack || 0) + 1;
      return '<span class="missing">';
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };
  md.renderer.rules.link_close = function (tokens, idx, options, env, self) {
    // 対応する link_open を探す
    var depth = 0;
    for (var i = idx - 1; i >= 0; i--) {
      if (tokens[i].type === 'link_close') depth++;
      else if (tokens[i].type === 'link_open') {
        if (depth === 0) {
          if (tokens[i].meta && tokens[i].meta.missing) return '</span>';
          break;
        }
        depth--;
      }
    }
    return defaultLinkClose(tokens, idx, options, env, self);
  };

  // mermaid のコードは、あとで図にする
  var defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = function (tokens, idx, options, env, self) {
    var info = (tokens[idx].info || '').trim();
    if (info === 'mermaid') {
      env.mermaid = env.mermaid || [];
      env.mermaid.push(tokens[idx].content);
      return '<div class="mermaid-wrap" data-mermaid="' + (env.mermaid.length - 1) + '"></div>\n';
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  // 行頭の K:（Kazukiのコメント）を囲みに変える。コードブロックの中は触らない
  function preprocess(src) {
    var lines = src.split('\n'), out = [], inFence = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      var m = !inFence && line.match(/^(\s*)K[:：]\s?(.*)$/);
      if (m) {
        out.push('', m[1] + '> [!kcomment] Kazukiのコメント', m[1] + '> ' + m[2], '');
      } else {
        out.push(line);
      }
    }
    return out.join('\n');
  }

  var CALLOUT = {
    warning: { cls: 'callout-warning', title: '使用前に確認' },
    local: { cls: 'callout-local', title: '施設・上級医に確認' },
    question: { cls: 'callout-question', title: 'Kazukiの判断' },
    info: { cls: 'callout-info', title: '' },
    kcomment: { cls: 'callout-kcomment', title: 'Kazukiのコメント' }
  };

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  // > [!type] タイトル の囲み
  function transformCallouts(root) {
    var quotes = root.querySelectorAll('blockquote');
    for (var i = 0; i < quotes.length; i++) {
      var q = quotes[i], first = q.firstElementChild;
      if (!first || first.tagName !== 'P') continue;
      var html = first.innerHTML;
      var m = html.match(/^\[!([A-Za-z0-9_-]+)\]([-+]?)([^\n]*)(\n([\s\S]*))?$/);
      if (!m) continue;
      var kind = m[1].toLowerCase(), title = m[3].trim(), rest = m[5];
      var def = CALLOUT[kind];
      var box = document.createElement('div');
      box.className = 'callout ' + (def ? def.cls : 'callout-other');
      var t = document.createElement('div');
      t.className = 'callout-title';
      if (def) {
        t.innerHTML = title || escapeHtml(def.title || kind);
      } else {
        t.innerHTML = '<span class="callout-kind">[' + escapeHtml(kind) + ']</span>' + title;
      }
      box.appendChild(t);
      if (rest && rest.trim()) {
        var p = document.createElement('p');
        p.innerHTML = rest;
        box.appendChild(p);
      }
      for (var c = first.nextSibling; c; ) {
        var next = c.nextSibling;
        box.appendChild(c);
        c = next;
      }
      q.parentNode.replaceChild(box, q);
    }
  }

  // ⚠️要確認 に印をつける
  function markNeedsCheck(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [];
    while (walker.nextNode()) {
      if (/⚠️?要確認/.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    }
    nodes.forEach(function (node) {
      if (node.parentNode.closest && node.parentNode.closest('pre, .mermaid-wrap')) return;
      var parts = node.nodeValue.split(/(⚠️?要確認)/), frag = document.createDocumentFragment();
      parts.forEach(function (s) {
        if (/^⚠️?要確認$/.test(s)) {
          var span = document.createElement('span');
          span.className = 'needs-check';
          span.textContent = '⚠️要確認';
          frag.appendChild(span);
        } else if (s) {
          frag.appendChild(document.createTextNode(s));
        }
      });
      node.parentNode.replaceChild(frag, node);
    });
  }

  // 見出しに書き出し時のアンカーをつける（順番で対応させる）
  function assignAnchors(root, headings) {
    var hs = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (var i = 0; i < hs.length; i++) {
      if (headings && headings[i]) hs[i].id = 'h-' + headings[i].anchor;
    }
  }

  var mermaidState = { loaded: false, loading: false, queue: [] };
  function withMermaid(cb, dark) {
    if (mermaidState.loaded) return cb(window.mermaid);
    mermaidState.queue.push(cb);
    if (mermaidState.loading) return;
    mermaidState.loading = true;
    var s = document.createElement('script');
    s.src = 'vendor/mermaid.min.js';
    s.onload = function () {
      window.mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default',
        themeVariables: { fontSize: '14px' },
        flowchart: { htmlLabels: true, useMaxWidth: false }
      });
      mermaidState.loaded = true;
      mermaidState.queue.splice(0).forEach(function (f) { f(window.mermaid); });
    };
    document.head.appendChild(s);
  }

  function renderMermaid(root, codes, dark, tappable) {
    var boxes = root.querySelectorAll('.mermaid-wrap');
    if (!boxes.length) return;
    withMermaid(function (mermaid) {
      Array.prototype.forEach.call(boxes, function (box, n) {
        var i = Number(box.getAttribute('data-mermaid'));
        mermaid.render('mmd-' + Date.now() + '-' + n, codes[i]).then(function (r) {
          box.innerHTML = r.svg;
          if (tappable) {
            var hint = document.createElement('div');
            hint.className = 'mermaid-hint';
            hint.textContent = '図を押すと全画面で開きます';
            box.appendChild(hint);
            box.addEventListener('click', function () { post({ type: 'mermaid', index: i }); });
          } else {
            enablePanZoom(box);
          }
          post({ type: 'mermaidDone', index: i });
        }).catch(function (e) {
          box.innerHTML = '<div class="mermaid-error">図を描けませんでした：' + escapeHtml(String(e && e.message || e)) + '</div><pre><code></code></pre>';
          box.querySelector('code').textContent = codes[i];
        });
      });
    }, dark);
  }

  function listHtml(title, items) {
    if (!items || !items.length) return '';
    var h = '<h2>' + escapeHtml(title) + '</h2><ul>';
    items.forEach(function (it) {
      var kind = it.type ? '<span class="kind">' + escapeHtml(it.type) + '</span>' : '';
      if (it.id) h += '<li><a href="kb://' + encodeURI(it.id) + '">' + kind + escapeHtml(it.title) + '</a></li>';
      else h += '<li><span class="missing">' + kind + escapeHtml(it.title) + '（まだないノート）</span></li>';
    });
    return h + '</ul>';
  }

  function metaHtml(p) {
    if (!p.meta) return '';
    var m = p.meta, h = '';
    if (m.type) h += '<span class="chip">' + escapeHtml(m.type) + '</span>';
    if (m.statusLabel) h += '<span class="chip status-' + escapeHtml(m.status || '') + '">' + escapeHtml(m.statusLabel) + '</span>';
    if (m.needsCheck) h += '<span class="chip needs">⚠️要確認 ' + m.needsCheck + '</span>';
    if (m.target) h += '<div class="target">対象：' + escapeHtml(m.target) + '</div>';
    return h;
  }

  function applyTheme(p) {
    document.documentElement.classList.toggle('dark', !!p.dark);
    document.documentElement.style.setProperty('--base', (16 * (p.fontScale || 1)) + 'px');
  }

  window.kbSetStyle = function (p) { applyTheme(p); };

  window.kbRender = function (p) {
    applyTheme(p);
    var env = {};
    var html = md.render(preprocess(p.markdown || ''), env);
    // 表の中などの <br> は改行にする（html は無効のまま、<br> だけ戻す）
    html = html.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    var content = document.getElementById('content');
    content.innerHTML = html;
    document.getElementById('meta').innerHTML = metaHtml(p);
    transformCallouts(content);
    markNeedsCheck(content);
    assignAnchors(content, p.headings);
    document.body.classList.toggle('mermaid-only', !!p.mermaidOnly);
    var lists = '';
    (p.lists || []).forEach(function (l) { lists += listHtml(l.title, l.items); });
    document.getElementById('lists').innerHTML = lists;
    renderMermaid(content, env.mermaid || [], !!p.dark, !p.mermaidOnly);
    if (p.anchor) setTimeout(function () { window.kbScrollTo(p.anchor); }, 50);
    post({ type: 'rendered' });
  };

  window.kbScrollTo = function (anchor) {
    var el = document.getElementById('h-' + anchor);
    if (el) el.scrollIntoView({ block: 'start' });
  };

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    e.preventDefault();
    if (href.indexOf('kb://') === 0) {
      var rest = decodeURI(href.slice(5)), hash = rest.indexOf('#');
      post({ type: 'open', id: hash < 0 ? rest : rest.slice(0, hash), anchor: hash < 0 ? '' : rest.slice(hash + 1) });
    } else if (/^https?:\/\//i.test(href)) {
      post({ type: 'external', url: href });
    } else if (href.charAt(0) === '#') {
      window.kbScrollTo(href.slice(1));
    }
  });

  document.addEventListener('DOMContentLoaded', function () { post({ type: 'ready' }); });
})();
