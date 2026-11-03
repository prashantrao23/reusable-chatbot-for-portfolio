/*!
 * ============================================================================
 * PORTFOLIO CHATBOT - FRONTEND WIDGET (public/chatbot.js)
 * ============================================================================
 * An embeddable, zero-dependency, single-script AI chat widget for portfolio sites.
 *
 * HOW TO EMBED ON ANY WEBSITE:
 *   <script src="https://YOUR-SERVER/chatbot.js" defer></script>
 *
 * OPTIONAL ATTRIBUTES ON THE SCRIPT TAG:
 *   data-accent="#0f766e"     Custom brand accent color (hex, rgb, or css name)
 *   data-position="left"      Which side the button starts on, "left" or "right" (default: "right").
 *                             It starts 100px above the bottom of the screen.
 *                             Visitors can drag it up and down along either side of the screen;
 *                             it snaps to the left or right edge and remembers the spot.
 *   data-theme="dark"         Color theme ("auto", "light", or "dark", default: "auto")
 *   data-label="Ask about me" Custom button launcher text
 *   data-api="https://..."    Custom backend API URL (if hosted on a different domain)
 *
 * KEY ARCHITECTURAL FEATURES:
 * 1. Shadow DOM encapsulation: Styles and DOM are isolated inside an open Shadow Root,
 *    preventing the parent website's CSS from breaking the widget and vice versa.
 * 2. Accessibility (a11y): ARIA labels, roles, keyboard navigation (Escape to close),
 *    and focus management.
 * 3. Safe Markdown rendering: HTML is strictly escaped to prevent XSS vulnerabilities,
 *    then formatted with bolding, inline code, safe external links, and bullet lists.
 * 4. Session memory: Persists the active conversation in browser `sessionStorage`,
 *    allowing visitors to browse other pages on your portfolio without losing chat history.
 * ============================================================================
 */

(function () {
  'use strict';

  /* ==========================================================================
   * 1. INITIALIZATION & RE-ENTRANCY GUARD
   * ========================================================================== */

  // Prevent loading the chatbot multiple times if the script tag is duplicated
  if (window.__portfolioChatLoaded) return;
  window.__portfolioChatLoaded = true;

  // Locate the current <script> tag to read custom data attributes
  var script = document.currentScript || document.querySelector('script[src*="chatbot.js"]');
  var d = (script && script.dataset) || {};

  // Resolve backend API URL:
  // Defaults to the origin where chatbot.js was served from (e.g. http://localhost:3000)
  var api = (d.api || (script && script.src ? new URL(script.src, location.href).origin : '')).replace(/\/$/, '');

  // Customization options from data attributes
  var accent = d.accent || '#3b5bdb';                              // Accent color
  var side = d.position === 'left' ? 'left' : 'right';             // Screen side
  var themePref = d.theme || 'auto';                               // Theme preference: auto | light | dark
  var STORE = 'portfolio-chat:' + api;                             // sessionStorage storage key

  // Runtime configuration (populated dynamically from GET /api/config)
  var cfg = {
    name: 'this candidate',
    greeting: 'Hi, ask me anything about the experience, skills and projects in this resume.',
    suggestions: []
  };

  // Conversation history array: [{ role: 'user'|'assistant', content: string }]
  var history = [];

  // Busy lock flag (prevents sending multiple simultaneous requests)
  var busy = false;

  /* ==========================================================================
   * 2. SHADOW DOM CREATION & HTML TEMPLATE
   * ==========================================================================
   * We attach an open Shadow Root to a wrapper <div>. This guarantees that:
   * - Host website styles (e.g. Bootstrap, Tailwind) do not bleed into our chat.
   * - Chatbot styles do not affect the host website.
   * ========================================================================== */

  var host = document.createElement('div');
  var root = host.attachShadow({ mode: 'open' });

  root.innerHTML =
    '<style>' + css() + '</style>' +
    '<div class="root ' + side + '">' +
      // Dashed outline that previews where the button will snap while dragging
      '<div class="ghost" aria-hidden="true" hidden></div>' +

      // Floating launcher button (draggable, rests only on a screen edge)
      '<button class="launcher" type="button" aria-expanded="false" aria-controls="panel">' +
        '<span class="pulse" aria-hidden="true"></span><span class="launcher-label"></span>' +
      '</button>' +

      // Main chat dialogue panel (initially hidden)
      '<section class="panel" id="panel" role="dialog" aria-label="Resume assistant" hidden>' +
        '<header>' +
          '<div class="head-text">' +
            '<strong class="title"></strong>' +
            '<span class="sub">AI assistant. Answers come from the resume.</span>' +
          '</div>' +
          '<button class="close" type="button" aria-label="Close chat">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</header>' +

        // Scrollable message log
        '<div class="log" role="log" aria-live="polite"></div>' +

        // Quick starter question suggestion chips
        '<div class="chips"></div>' +

        // User input form
        '<form class="composer">' +
          '<textarea rows="1" maxlength="1000" placeholder="Ask about experience, skills, projects" aria-label="Your question"></textarea>' +
          '<button class="send" type="submit" aria-label="Send question">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
          '</button>' +
        '</form>' +
      '</section>' +
    '</div>';

  // Helper selector function scoped to the Shadow Root
  var $ = function (s) { return root.querySelector(s); };

  // Cache frequently accessed DOM nodes
  var rootEl   = $('.root'),
      launcher = $('.launcher'),
      panel    = $('.panel'),
      log      = $('.log'),
      chips    = $('.chips'),
      form     = $('.composer'),
      input    = $('textarea'),
      sendBtn  = $('.send');

  /* ==========================================================================
   * 3. THEME MANAGEMENT (LIGHT / DARK / AUTO)
   * ========================================================================== */

  // Apply user-defined brand accent color via CSS custom property
  rootEl.style.setProperty('--accent', accent);

  // Apply initial theme
  applyTheme();

  // Listen for operating system theme changes if theme is set to 'auto'
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(applyTheme);
  }

  function applyTheme() {
    var dark = themePref === 'dark' || (
      themePref === 'auto' &&
      window.matchMedia &&
      matchMedia('(prefers-color-scheme: dark)').matches
    );
    rootEl.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  /* ==========================================================================
   * 4. UI INTERACTIONS & EVENT LISTENERS
   * ========================================================================== */

  /**
   * Toggles visibility of the chat panel.
   * Manages ARIA accessibility attributes and focus control.
   */
  function setOpen(open) {
    if (open) updateAnchor();                       // open the panel on the side the button sits
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.classList.toggle('hidden', open);

    if (open) {
      input.focus();
      log.scrollTop = log.scrollHeight;
    } else {
      place(false);
      launcher.focus();
    }
  }

  // Open panel when clicking floating launcher button (ignored right after a drag)
  launcher.addEventListener('click', function () {
    if (suppressClick) return;
    setOpen(true);
  });

  /* ==========================================================================
   * DRAGGABLE LAUNCHER (rests only on a screen edge)
   * --------------------------------------------------------------------------
   * The button follows the pointer while dragging, a dashed outline previews
   * where it will land, and on release it snaps to the nearer SIDE edge (left or
   * right). It never docks on the top or bottom edge.
   * It is stored as { edge, pos }: which side it sits on, and how far down that
   * side (0 = top, 1 = bottom). Because it is a fraction, the button stays
   * on-screen when the window is resized or a phone is rotated.
   * ========================================================================== */

  var MARGIN = 16;            // gap between the button and the screen edge (px)
  var DRAG_THRESHOLD = 6;     // pointer must move this far before it counts as a drag (px)
  var POS_KEY = 'portfolio-chat-pos:' + api;
  var EDGES = ['left', 'right'];          // top/bottom are intentionally not allowed
  var ghost = $('.ghost');
  var START_BOTTOM = 100;                 // starting distance from the bottom of the screen (px)
  var dock = { edge: side, pos: null };   // pos null = starting spot (100px above the bottom); becomes a number once the visitor drags it
  var drag = null;
  var suppressClick = false;

  // Restore the visitor's last position
  try {
    var savedDock = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (savedDock && EDGES.indexOf(savedDock.edge) > -1 && savedDock.pos !== null && isFinite(savedDock.pos)) {
      dock = { edge: savedDock.edge, pos: Math.min(1, Math.max(0, +savedDock.pos)) };
    }
  } catch (e) {}

  function saveDock() { try { localStorage.setItem(POS_KEY, JSON.stringify(dock)); } catch (e) {} }

  function viewport() {
    return { w: document.documentElement.clientWidth || window.innerWidth, h: window.innerHeight };
  }

  /** Vertical position as a 0-1 fraction. Until the visitor drags the button, it sits START_BOTTOM px above the bottom edge. */
  function posOf(d, h) {
    if (d.pos !== null && isFinite(d.pos)) return d.pos;
    var v = viewport();
    var spanY = Math.max(1, v.h - h - 2 * MARGIN);
    return Math.min(1, Math.max(0, (v.h - h - START_BOTTOM - MARGIN) / spanY));
  }

  /** Converts an { edge, pos } dock into left/top pixel coordinates for a w x h button. */
  function dockToXY(d, w, h) {
    var v = viewport();
    var spanY = Math.max(0, v.h - h - 2 * MARGIN);
    return {
      x: d.edge === 'left' ? MARGIN : v.w - w - MARGIN,
      y: MARGIN + posOf(d, h) * spanY
    };
  }

  /** Picks the side (left or right) closest to a free-floating button at (x, y), keeping its height. */
  function nearestDock(x, y, w, h) {
    var v = viewport();
    var spanY = Math.max(1, v.h - h - 2 * MARGIN);
    return {
      edge: (x + w / 2) < v.w / 2 ? 'left' : 'right',
      pos: Math.min(1, Math.max(0, (y - MARGIN) / spanY))
    };
  }

  /** Moves the launcher to pixel coordinates (clears the CSS fallback right/bottom so it can't stretch). */
  function setXY(x, y) {
    launcher.style.right = 'auto';
    launcher.style.bottom = 'auto';
    launcher.style.left = x + 'px';
    launcher.style.top = y + 'px';
  }

  /** Puts the launcher at its docked position on the left or right edge. */
  function place(animate) {
    if (launcher.classList.contains('hidden')) return;
    var v = viewport();
    var h = 48;
    var spanY = Math.max(0, v.h - h - 2 * MARGIN);
    var y = MARGIN + posOf(dock, h) * spanY;

    if (animate) {
      var r = launcher.getBoundingClientRect();
      launcher.classList.remove('snap');
      launcher.style.top = r.top + 'px';
      if (dock.edge === 'right') {
        launcher.style.left = 'auto';
        launcher.style.right = Math.max(0, v.w - r.right) + 'px';
      } else {
        launcher.style.right = 'auto';
        launcher.style.left = r.left + 'px';
      }
      void launcher.offsetWidth; // Force reflow so snap transition animates from current spot
      launcher.classList.add('snap');
    } else {
      launcher.classList.remove('snap');
    }

    launcher.style.top = y + 'px';
    launcher.style.bottom = 'auto';
    if (dock.edge === 'right') {
      launcher.style.left = 'auto';
      launcher.style.right = MARGIN + 'px';
    } else {
      launcher.style.right = 'auto';
      launcher.style.left = MARGIN + 'px';
    }

    if (animate) {
      setTimeout(function () {
        launcher.classList.remove('snap');
      }, 260);
    }
  }

  /** Tells the CSS which side of the screen the chat panel should open on. */
  function updateAnchor() {
    rootEl.setAttribute('data-h', dock.edge);                       // left or right
    rootEl.setAttribute('data-v', posOf(dock, 48) < 0.5 ? 'top' : 'bottom');
  }

  launcher.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;       // left mouse button, touch or pen only
    var r = launcher.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, h: r.height, moving: false };
    try { launcher.setPointerCapture(e.pointerId); } catch (err) {}
  });

  launcher.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < DRAG_THRESHOLD) return;  // still a click
      drag.moving = true;
      launcher.classList.remove('snap');
      launcher.classList.add('dragging');
      drag.w = 48;
      drag.h = 48;
      drag.ox = 24;
      drag.oy = 24;
    }
    var v = viewport();
    var x = Math.min(Math.max(0, e.clientX - drag.ox), Math.max(0, v.w - drag.w));
    var y = Math.min(Math.max(0, e.clientY - drag.oy), Math.max(0, v.h - drag.h));
    setXY(x, y);

    // Preview the spot it will snap to
    var t = dockToXY(nearestDock(x, y, drag.w, drag.h), drag.w, drag.h);
    ghost.hidden = false;
    ghost.style.left = t.x + 'px';
    ghost.style.top = t.y + 'px';
    ghost.style.width = drag.w + 'px';
    ghost.style.height = drag.h + 'px';
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    try { launcher.releasePointerCapture(d.id); } catch (err) {}
    if (!d.moving) return;                         // a plain click: let the click handler open the chat

    launcher.classList.remove('dragging');
    ghost.hidden = true;
    var r = launcher.getBoundingClientRect();
    dock = nearestDock(r.left, r.top, 48, 48);   // snap to the nearest edge
    updateAnchor();
    place(true);
    saveDock();

    suppressClick = true;                          // the browser fires a click after the drop; ignore it
    setTimeout(function () { suppressClick = false; }, 0);
  }
  launcher.addEventListener('pointerup', endDrag);
  launcher.addEventListener('pointercancel', endDrag);

  // Keep the button on-screen when the window is resized or the phone rotates
  window.addEventListener('resize', function () { place(false); });

  // Close panel when clicking header 'X' button
  $('.close').addEventListener('click', function () { setOpen(false); });

  // Close panel when pressing Escape key
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  // Handle form submission (clicking send button)
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    send(input.value);
  });

  // Handle keyboard submission: Enter sends message, Shift+Enter inserts newline
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
  });

  // Auto-grow textarea height as the user types (up to max 96px)
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });

  /* ==========================================================================
   * 5. MESSAGE BUBBLES & TYPING INDICATOR
   * ========================================================================== */

  /**
   * Appends a message bubble to the chat log.
   * @param {'user'|'bot'} role - Who sent the message
   * @param {string} text - Message text
   * @param {boolean} [isError=false] - Whether this is an error notice
   */
  function addMsg(role, text, isError) {
    var el = document.createElement('div');
    el.className = 'msg ' + role + (isError ? ' error' : '');

    // Bot messages are safely rendered with markdown; user messages are pure text
    if (role === 'bot') {
      el.innerHTML = render(text);
    } else {
      el.textContent = text;
    }

    log.appendChild(el);
    log.scrollTop = log.scrollHeight; // Auto-scroll to latest message
    return el;
  }

  /**
   * Displays animated 3-dot typing indicator while awaiting AI response.
   */
  function addTyping() {
    var el = document.createElement('div');
    el.className = 'msg bot typing';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', 'Assistant is typing');
    el.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  /**
   * Toggles the input & send button busy state during network requests.
   */
  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b;
    input.disabled = b;
    if (!b && !panel.hidden) input.focus();
  }

  /* ==========================================================================
   * 6. SENDING MESSAGES & BACKEND COMMUNICATION
   * ========================================================================== */

  /**
   * Sends a user question to the backend POST /api/chat endpoint.
   * @param {string} text - User's prompt
   */
  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;

    // Reset textarea input
    input.value = '';
    input.style.height = 'auto';

    // Hide suggestion chips after the user asks their first question
    chips.hidden = true;

    // 1. Add user message to UI and history
    addMsg('user', text);
    history.push({ role: 'user', content: text });

    // 2. Lock UI & show typing indicator
    setBusy(true);
    var typing = addTyping();

    // 3. Make HTTP POST request to backend API
    fetch(api + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-12) }) // send last 12 turns
    })
      .then(function (r) {
        // If the server (or a proxy in front of it) returns non-JSON, show a friendly message
        return r.json().catch(function () { return {}; }).then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (res) {
        typing.remove();

        if (!res.ok || !res.j || !res.j.reply) {
          throw new Error((res.j && res.j.error) || 'Something went wrong. Please try again.');
        }

        // 4. Save response to history and render bot message
        history.push({ role: 'assistant', content: res.j.reply });
        addMsg('bot', res.j.reply);
        save(); // Save to sessionStorage
      })
      .catch(function (err) {
        typing.remove();
        // Remove failed user turn from history so visitor can retry cleanly
        history.pop();
        var errMsg = err instanceof TypeError
          ? 'Could not reach the assistant. Check your connection and try again.'
          : err.message;
        addMsg('bot', errMsg, true);
      })
      .then(function () {
        setBusy(false);
      });
  }

  /* ==========================================================================
   * 7. SAFE TEXT & MARKDOWN RENDERER (XSS SAFE)
   * ==========================================================================
   * Security measure:
   * First, strictly escapes all HTML special characters (&, <, >).
   * Then, selectively parses:
   *   - **bold** -> <strong>bold</strong>
   *   - `code`   -> <code>code</code>
   *   - [text](url) -> safe external link with target="_blank" rel="noopener noreferrer"
   *   - Bullet points (- or *) -> <ul><li>
   * ========================================================================== */

  function inline(s) {
    return s
      // Links run FIRST so the bold/code rules below can never rewrite characters inside a URL.
      // The URL pattern forbids quotes, whitespace, parentheses, '*' and backticks.
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s"'()*`]+)\)/g, function (match, label, url) {
        // render() has already turned quotes into &quot; / &#39;. Refuse any URL that contains one,
        // so a link can never break out of the href="..." attribute and inject its own attributes.
        if (/&(?:quot|#39);/.test(url)) return match;
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
      })
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }

  function render(text) {
    // 1. Strict HTML escaping prevents XSS injection
    var esc = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')     // quotes must be escaped too: text ends up inside href="..." attributes
      .replace(/'/g, '&#39;');

    // 2. Parse lines and list items
    var out = [], inList = false;
    esc.split('\n').forEach(function (line) {
      var m = line.match(/^\s*[-*\u2022]\s+(.*)/);
      if (m) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(m[1]) + '</li>');
      } else {
        if (inList) { out.push('</ul>'); inList = false; }
        if (line.trim()) out.push('<p>' + inline(line) + '</p>');
      }
    });

    if (inList) out.push('</ul>');
    return out.join('');
  }

  /* ==========================================================================
   * 8. SESSION MEMORY (PERSISTS ACROSS PAGE BROWSING IN SAME TAB)
   * ========================================================================== */

  function save() {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(history.slice(-12)));
    } catch (e) {}
  }

  function restore() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORE) || '[]');
      if (Array.isArray(saved)) {
        saved.forEach(function (m) {
          history.push(m);
          addMsg(m.role === 'user' ? 'user' : 'bot', m.content);
        });
      }
    } catch (e) {}
  }

  /* ==========================================================================
   * 9. BOOTSTRAP & INITIALIZATION
   * ========================================================================== */

  function start() {
    // Set dynamic button label and panel title
    var labelText = d.label || 'Ask about ' + (cfg.name === 'this candidate' ? 'me' : cfg.name.split(' ')[0]);
    $('.launcher-label').textContent = labelText;
    launcher.setAttribute('aria-label', labelText);
    launcher.setAttribute('title', labelText);
    $('.title').textContent = cfg.name === 'this candidate' ? 'Resume assistant' : cfg.name + "'s assistant";

    // Restore previous messages from this browsing session
    restore();

    // If no prior conversation, show greeting and suggestion chips
    if (!history.length) {
      addMsg('bot', cfg.greeting);
      cfg.suggestions.forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = s;
        b.addEventListener('click', function () { send(s); });
        chips.appendChild(b);
      });
    } else {
      chips.hidden = true;
    }
    if (!chips.children.length) chips.hidden = true;

    // Attach Shadow DOM container to document body
    document.body.appendChild(host);
    updateAnchor();
    place(false);
  }

  /**
   * Fetches metadata from GET /api/config, then mounts the widget.
   */
  function boot() {
    fetch(api + '/api/config')
      .then(function (r) { return r.json(); })
      .then(function (c) {
        cfg.name = c.name || cfg.name;
        cfg.greeting = c.greeting || cfg.greeting;
        cfg.suggestions = c.suggestions || [];
      })
      .catch(function () {})
      .then(start);
  }

  // Start initialization as soon as DOM is ready
  if (document.body) {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }

  /* ==========================================================================
   * 10. STYLES (EMBEDDED IN SHADOW DOM)
   * ========================================================================== */

  function css() {
    return [
      // Light Mode Color Palette & Variables
      '.root{--bg:#3837374a;--fg:#1b1f2a;--muted:#667085;--line:#e4e7ec;--bot:#b5d3ff94;--shadow:0px 4px 30px -4px var(--accent);',
      'font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg)}',

      // Dark Mode Color Palette Overrides
      '.root[data-theme=dark]{--bg:#15171c;--fg:#eceef2;--muted:#98a1b0;--line:#2a2e37;--bot:#21252d;--shadow:0px 4px 30px -4px rgba(0,0,0,.5)}',

      // Reset & Helpers
      '*{box-sizing:border-box}[hidden]{display:none!important}', 
      'button{font:inherit;cursor:pointer}',

      // Positioning: the launcher's left/top are set by JavaScript (draggable, docks to an edge).
      // The panel opens on the side of the screen where the launcher sits.
      '.launcher,.panel{position:fixed;z-index:2147483000}',
      '.launcher{left:auto;top:auto;right:16px;bottom:100px}',   // fallback until JS positions it
      '@media(min-width:481px){.root[data-h=left] .panel{left:16px}.root[data-h=right] .panel{right:16px}.root[data-v=top] .panel{top:16px}.root[data-v=bottom] .panel{bottom:16px}}',

      // Floating Launcher Button:
      // In mobile view: compact circle showing ONLY pulse, not text.
      '.launcher{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;min-width:48px;max-width:48px;padding:0;border:0;border-radius:999px;background:var(--accent);color:#fff;font-weight:600;font-size:15px;line-height:1;box-shadow:var(--shadow);box-sizing:border-box;overflow:hidden;white-space:nowrap;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;transition:width .3s cubic-bezier(.2,.8,.2,1),max-width .3s cubic-bezier(.2,.8,.2,1),padding .3s cubic-bezier(.2,.8,.2,1),transform .15s,box-shadow .2s}',
      '.launcher:hover{transform:translateY(-2px)}',
      '.launcher.hidden{display:none}',
      '.launcher-label{display:none}',

      // Dragging: grab cursor, no scroll-jacking on touch, smooth snap to the edge on drop
      '.launcher.snap{transition:left .24s cubic-bezier(.2,.8,.2,1),right .24s cubic-bezier(.2,.8,.2,1),top .24s cubic-bezier(.2,.8,.2,1),width .3s cubic-bezier(.2,.8,.2,1),max-width .3s cubic-bezier(.2,.8,.2,1),padding .3s cubic-bezier(.2,.8,.2,1),transform .15s}',
      '.launcher.dragging{cursor:grabbing;transition:none!important;transform:scale(1.05);box-shadow:0 16px 44px rgba(16,24,40,.28);width:48px!important;max-width:48px!important;padding:0!important;justify-content:center!important}',
      '.launcher.dragging .launcher-label{display:none!important}',
      '.ghost{position:fixed;z-index:2147482999;border:2px dashed var(--accent);border-radius:999px;opacity:.55;pointer-events:none}',

      // Pulse Animation on Launcher
      '.pulse{width:10px;height:10px;border-radius:50%;background:#fff;box-shadow:0 0 0 0 rgba(255,255,255,.7);animation:pulse 2s infinite;flex-shrink:0}',
      '@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.7)}70%{box-shadow:0 0 0 10px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}',

      // Laptop / Desktop Screens: Show pulse by default, expand width and reveal text when hovered
      '@media(min-width:769px){' +
        '.launcher{width:auto;min-width:48px;max-width:48px;padding:0 19px;justify-content:flex-start}' +
        '.launcher-label{display:inline-block;max-width:0;opacity:0;margin-left:0;overflow:hidden;white-space:nowrap;pointer-events:none;transition:max-width .3s cubic-bezier(.2,.8,.2,1),opacity .2s ease,margin-left .3s cubic-bezier(.2,.8,.2,1)}' +
        '.launcher:hover:not(.dragging),.launcher:focus-visible:not(.dragging){max-width:320px;padding:0 18px 0 16px}' +
        '.launcher:hover:not(.dragging) .launcher-label,.launcher:focus-visible:not(.dragging) .launcher-label{max-width:260px;opacity:1;margin-left:10px;pointer-events:auto}' +
      '}',

      // Chat Dialog Panel
      '.panel{display:flex;flex-direction:column;width:380px;height:min(580px,calc(100vh - 40px));background:var(--bg);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);overflow:hidden;animation:open .18s ease-out; backdrop-filter: blur(15.6px)}',
      '@keyframes open{from{opacity:0;transform:translateY(10px)}}',

      // Header
      'header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 14px 14px 18px;border-bottom:1px solid var(--line)}',
      '.head-text{display:flex;flex-direction:column;min-width:0}',
      '.title{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff}',
      '.sub{font-size:12px;color:#fff}',
      '.close{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--muted)}',
      '.close:hover{background:var(--bot);color:var(--fg)}',

      // Message Log & Bubbles
      '.log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}',
      '.msg{max-width:86%;padding:9px 13px;border-radius:14px;word-wrap:break-word;overflow-wrap:anywhere}',
      '.msg p{margin:0}.msg p+p,.msg p+ul,.msg ul+p{margin-top:6px}',
      '.msg ul{margin:0;padding-left:18px}.msg li{margin:2px 0}',
      '.msg code{font:13px ui-monospace,Menlo,monospace;background:rgba(127,127,127,.18);padding:1px 4px;border-radius:4px}',
      '.msg a{color:inherit;text-decoration:underline}',
      '.msg.user{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:4px;white-space:pre-wrap}',
      '.msg.bot{align-self:flex-start;background:var(--bot);border-bottom-left-radius:4px}',
      '.msg.error{border:1px solid #d92d20;color:#d92d20;background:transparent}',
      '.root[data-theme=dark] .msg.error{color:#f97066;border-color:#f97066}',

      // Typing Indicator Dots
      '.typing{display:flex;gap:4px;padding:13px 14px}',
      '.typing i{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:blink 1.1s infinite}',
      '.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}',
      '@keyframes blink{0%,60%,100%{opacity:.3}30%{opacity:1}}',

      // Starter Chips
      '.chips{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 12px}',
      '.chip{padding:7px 12px;border:1px solid var(--line);border-radius:999px;background:transparent;color:#fff;font-size:13.5px}',
      '.chip:hover{border-color:var(--accent);color:var(--accent)}',

      // Input Composer Form
      '.composer{display:flex;align-items:flex-end;gap:8px;padding:12px;border-top:1px solid var(--line)}',
      'textarea{flex:1;resize:none;max-height:96px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:#fff;font:inherit;outline:none}',
      'textarea:focus{border-color:var(--accent)}',
      '.send{display:grid;place-items:center;width:38px;height:38px;flex:none;border:0;border-radius:10px;background:var(--accent);color:#fff}',
      '.send:disabled{opacity:.5;cursor:default}',

      // Focus Outline for Accessibility
      'button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
      '.launcher:focus-visible{outline-color:var(--fg)}',

      // Mobile Responsive Viewport Support
      '@media(max-width:480px){.root .panel{inset:0;width:100%;height:100dvh;border-radius:0;border:0}textarea{font-size:16px}}',

      // Reduced Motion Accessibility
      '@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}'
    ].join('');
  }
})();