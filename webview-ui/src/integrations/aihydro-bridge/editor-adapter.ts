/**
 * AI-Hydro Bridge — Editor Adapter v3 (Production Pass)
 *
 * Key improvements over v2:
 *   1. REAL change detection — uses `input` event on contenteditable regions
 *      + MutationObserver safety net. Format toolbar buttons (B/I/U etc.) no
 *      longer trigger false "unsaved changes" when they produce no content delta.
 *   2. Undo/redo — keyboard shortcuts (⌘Z / ⌘⇧Z / Ctrl+Y) wired to the browser's
 *      native execCommand undo stack. `edit.state` events push undo/redo
 *      availability upstream so the toolbar buttons stay in sync.
 *   3. Debounced change notification — 120 ms debounce collapses burst typing
 *      into a single `text.changed` event so the parent doesn't flicker.
 *
 * Message protocol (parent ↔ iframe):
 *   parent → iframe:
 *     { type: "aihydro-edit-mode",       enabled: boolean }
 *     { type: "aihydro-editor-command",  command: string, value?: string }
 *         ↳ command may be "undo" | "redo" | "bold" | "italic" | … | "aihydro-link"
 *     { type: "aihydro-send-batch" }
 *     { type: "aihydro-clear-batch" }
 *     { type: "aihydro-request-save" }      ← capture + return current HTML
 *   iframe → parent (via window.__aihydroBridge.reportEvent):
 *     kind="user.comment.draft"    — single comment added to batch
 *     kind="user.batch_changes"    — full batch sent; parent opens agent chat
 *     kind="user.batch.cleared"    — batch cleared
 *     kind="edit.toggled"          — mode on / off
 *     kind="text.changed"          — debounced: actual prose DOM mutation
 *     kind="edit.state"            — undo/redo availability update
 *   iframe → parent (plain postMessage, NOT via bridge):
 *     { type: "aihydro-save-document", html: string }  ← response to request-save
 */

export const AIHYDRO_BRIDGE_EDITOR_SCRIPT = `
<script id="aihydro-bridge-editor">
(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────────────────
  var _editMode = false;
  var _batch = [];                  // [{ id, type: 'comment'|'text', ... }]
  var _bubble = null;               // floating selection bubble
  var _composer = null;             // inline comment composer
  var _editableElements = [];       // elements we activated contenteditable on
  var _mutationObserver = null;     // watches editable regions for DOM changes
  var _changeDebounceTimer = null;  // 120ms debounce for text.changed events
  var _stateDebounceTimer = null;   // 50ms debounce for edit.state (undo/redo)

  // ── CSS injection (idempotent) ──────────────────────────────────────────
  var _stylesInjected = false;
  function ensureStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var s = document.createElement('style');
    s.id = 'aihydro-editor-style-v3';
    s.textContent = [
      /* Editable prose regions */
      '[data-aihydro-editable].aihydro-edit-active {',
      '  outline: 1px dashed rgba(0,221,255,0.35);',
      '  outline-offset: 4px;',
      '  border-radius: 4px;',
      '  min-height: 1em;',
      '  transition: outline-color 0.15s;',
      '}',
      '[data-aihydro-editable].aihydro-edit-active:hover {',
      '  outline-color: rgba(0,221,255,0.55);',
      '}',
      '[data-aihydro-editable].aihydro-edit-active:focus {',
      '  outline: 2px solid rgba(0,221,255,0.8);',
      '  outline-offset: 4px;',
      '}',

      /* Component selection highlight */
      '.aihydro-component-hover {',
      '  outline: 2px solid rgba(0,221,255,0.35) !important;',
      '  outline-offset: 4px !important;',
      '  cursor: pointer !important;',
      '  transition: outline-color 0.15s;',
      '}',
      '.aihydro-component-selected {',
      '  outline: 2px solid rgba(0,221,255,0.9) !important;',
      '  outline-offset: 4px !important;',
      '  box-shadow: 0 0 24px rgba(0,221,255,0.35) !important;',
      '}',

      /* 💬 Pin on selected component */
      '.aihydro-component-pin {',
      '  position: absolute;',
      '  top: -10px; right: -10px;',
      '  z-index: 1000;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 4px;',
      '  padding: 4px 10px;',
      '  background: linear-gradient(135deg, #00A3FF, #00DDFF);',
      '  border: none; border-radius: 16px;',
      '  color: #0a0a15;',
      '  font-family: Poppins, system-ui, sans-serif;',
      '  font-size: 11px; font-weight: 700;',
      '  cursor: pointer;',
      '  box-shadow: 0 4px 12px rgba(0,221,255,0.4);',
      '}',
      '.aihydro-component-pin.has-comment { background: rgba(0,221,255,0.85); }',

      /* Floating selection bubble */
      '.aihydro-selection-bubble {',
      '  position: fixed; z-index: 99998;',
      '  display: none;',
      '  align-items: center; gap: 2px;',
      '  padding: 3px 5px;',
      '  background: rgba(15,15,30,0.97);',
      '  border: 1px solid rgba(0,221,255,0.6);',
      '  border-radius: 8px;',
      '  box-shadow: 0 6px 20px rgba(0,0,0,0.6);',
      '  font-family: Poppins, system-ui, sans-serif;',
      '  font-size: 12px; user-select: none; white-space: nowrap;',
      '}',
      '.aihydro-selection-bubble.visible { display: inline-flex; }',
      '.aihydro-selection-bubble button {',
      '  display: inline-flex; align-items: center; justify-content: center;',
      '  width: 26px; height: 22px;',
      '  border: none; background: transparent;',
      '  color: #cbd5e1; border-radius: 4px; cursor: pointer;',
      '  font-family: inherit; font-size: inherit; font-weight: 700;',
      '}',
      '.aihydro-selection-bubble button:hover { background: rgba(0,221,255,0.18); color: #00DDFF; }',
      '.aihydro-selection-bubble .bb-comment {',
      '  width: auto; padding: 0 10px 0 8px;',
      '  background: rgba(0,221,255,0.15); color: #00DDFF;',
      '  font-weight: 700; gap: 4px;',
      '}',
      '.aihydro-selection-bubble .bb-comment:hover { background: rgba(0,221,255,0.3); }',
      '.aihydro-selection-bubble .bb-divider {',
      '  width: 1px; height: 14px;',
      '  background: rgba(125,211,252,0.2); margin: 0 2px;',
      '}',

      /* Inline composer */
      '.aihydro-composer {',
      '  position: fixed; z-index: 99999;',
      '  width: 320px;',
      '  background: rgba(15,15,30,0.98);',
      '  border: 1px solid rgba(0,221,255,0.5);',
      '  border-radius: 12px; padding: 12px;',
      '  box-shadow: 0 12px 36px rgba(0,0,0,0.65);',
      '  font-family: Nunito, system-ui, sans-serif;',
      '}',
      '.aihydro-composer .cmp-target {',
      '  margin: 0 0 8px; padding: 5px 9px;',
      '  border-left: 3px solid rgba(0,221,255,0.5);',
      '  font-size: 12px; color: #94a3b8; font-style: italic;',
      '  background: rgba(0,221,255,0.05); border-radius: 4px;',
      '  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
      '}',
      '.aihydro-composer textarea {',
      '  width: 100%; box-sizing: border-box;',
      '  background: rgba(10,10,21,0.8);',
      '  border: 1px solid rgba(125,211,252,0.3); border-radius: 8px;',
      '  color: #e2e8f0; font-size: 13px; font-family: inherit;',
      '  padding: 8px 10px; resize: vertical; min-height: 64px; outline: none;',
      '}',
      '.aihydro-composer textarea:focus { border-color: rgba(0,221,255,0.7); }',
      '.aihydro-composer .cmp-actions { display: flex; gap: 6px; margin-top: 8px; justify-content: flex-end; }',
      '.aihydro-composer button {',
      '  font-family: Poppins, system-ui, sans-serif; font-size: 12px; font-weight: 600;',
      '  padding: 5px 12px; border-radius: 7px; border: none; cursor: pointer;',
      '}',
      '.aihydro-composer .cmp-cancel { background: rgba(125,211,252,0.1); color: #7dd3fc; }',
      '.aihydro-composer .cmp-add { background: linear-gradient(135deg, #00A3FF, #00DDFF); color: #0a0a15; }',
      '.aihydro-composer .cmp-hint { margin-top: 6px; font-size: 10px; color: #64748b; text-align: right; }',
    ].join('\\n');
    document.head.appendChild(s);
  }

  // ── TextAnchor ──────────────────────────────────────────────────────────
  function computeTextAnchor(sel) {
    if (!sel || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var quote = sel.toString();
    if (!quote.trim()) return null;
    var container = range.commonAncestorContainer;
    var contextEl = container.nodeType === 3 ? container.parentElement : container;
    var contextText = (contextEl && contextEl.textContent) || '';
    var startInCtx = contextText.indexOf(quote.trim());
    var context = contextText.slice(
      Math.max(0, startInCtx - 100),
      Math.min(contextText.length, startInCtx + quote.length + 100)
    );
    var parentEl = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
    var parentSelector = '';
    while (parentEl && parentEl !== document.body) {
      if (parentEl.id) { parentSelector = '#' + parentEl.id; break; }
      if (parentEl.className && typeof parentEl.className === 'string') {
        var cls = parentEl.className.trim().split(/\\s+/)[0];
        if (cls) { parentSelector = '.' + cls; break; }
      }
      parentEl = parentEl.parentElement;
    }
    var bodyText = document.body ? document.body.innerText : '';
    var startOffset = bodyText.indexOf(quote.trim());
    return {
      quote: quote,
      context: context,
      startOffset: startOffset >= 0 ? startOffset : 0,
      endOffset: startOffset >= 0 ? startOffset + quote.length : quote.length,
      parentSelector: parentSelector,
    };
  }

  // ── Floating selection bubble ───────────────────────────────────────────
  function getBubble() {
    if (_bubble) return _bubble;
    _bubble = document.createElement('div');
    _bubble.className = 'aihydro-selection-bubble';
    _bubble.innerHTML = [
      '<button data-cmd="bold" title="Bold"><b>B</b></button>',
      '<button data-cmd="italic" title="Italic"><i>I</i></button>',
      '<button data-cmd="underline" title="Underline"><u>U</u></button>',
      '<span class="bb-divider"></span>',
      '<button data-cmd="formatBlock" data-value="h2" title="Heading 2">H2</button>',
      '<button data-cmd="formatBlock" data-value="h3" title="Heading 3">H3</button>',
      '<span class="bb-divider"></span>',
      '<button class="bb-comment" data-cmd="comment" title="Add comment">💬 Comment</button>',
    ].join('');
    _bubble.addEventListener('mousedown', function(e) {
      e.preventDefault(); // keep selection alive
      var btn = e.target.closest('button');
      if (!btn) return;
      var cmd = btn.getAttribute('data-cmd');
      if (cmd === 'comment') {
        openComposerForSelection();
      } else if (cmd === 'formatBlock') {
        document.execCommand('formatBlock', false, btn.getAttribute('data-value') || 'p');
        // NOTE: do NOT manually emit text.changed here.
        // The execCommand triggers a DOM mutation which fires the MutationObserver
        // and/or 'input' event — those are the single source of truth for changes.
      } else {
        document.execCommand(cmd, false);
        // Same — let MutationObserver/input detect the actual content delta.
      }
    });
    document.body.appendChild(_bubble);
    return _bubble;
  }

  function positionBubble(rect) {
    var b = getBubble();
    b.classList.add('visible');
    var top = rect.top - 38;
    if (top < 4) top = rect.bottom + 6;
    var left = rect.left + (rect.width / 2) - 100;
    if (left < 8) left = 8;
    if (left + 220 > window.innerWidth) left = window.innerWidth - 228;
    b.style.top = top + 'px';
    b.style.left = left + 'px';
  }

  function hideBubble() {
    if (_bubble) _bubble.classList.remove('visible');
  }

  // ── Inline composer ─────────────────────────────────────────────────────
  function openComposer(anchor, targetDescription, anchorRect, onSave) {
    closeComposer();
    var c = document.createElement('div');
    c.className = 'aihydro-composer';
    c.innerHTML = [
      '<div class="cmp-target"></div>',
      '<textarea placeholder="Describe what should change…"></textarea>',
      '<div class="cmp-hint">⌘/Ctrl+Enter to add</div>',
      '<div class="cmp-actions">',
      '  <button class="cmp-cancel" type="button">Cancel</button>',
      '  <button class="cmp-add" type="button">Add to batch</button>',
      '</div>',
    ].join('');
    c.querySelector('.cmp-target').textContent = targetDescription;
    var ta = c.querySelector('textarea');
    var addBtn = c.querySelector('.cmp-add');
    var cancelBtn = c.querySelector('.cmp-cancel');
    cancelBtn.addEventListener('click', closeComposer);
    addBtn.addEventListener('click', function() {
      var body = ta.value.trim();
      if (!body) { ta.focus(); return; }
      onSave(body);
      closeComposer();
    });
    ta.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { addBtn.click(); }
      else if (e.key === 'Escape') { closeComposer(); }
    });
    document.body.appendChild(c);
    _composer = c;
    var top = anchorRect.bottom + 8;
    var left = anchorRect.left;
    var W = 320;
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
    if (top + 200 > window.innerHeight - 8) top = Math.max(8, anchorRect.top - 200);
    c.style.top = top + 'px';
    c.style.left = left + 'px';
    setTimeout(function() { ta.focus(); }, 0);
  }

  function closeComposer() {
    if (_composer) { _composer.remove(); _composer = null; }
  }

  function openComposerForSelection() {
    var sel = window.getSelection();
    var anchor = computeTextAnchor(sel);
    if (!anchor) return;
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    hideBubble();
    var truncated = anchor.quote.length > 80 ? anchor.quote.slice(0, 80) + '…' : anchor.quote;
    openComposer(anchor, '"' + truncated + '"', rect, function(body) {
      addToBatch({ type: 'comment', target: 'text', body: body, anchor: anchor });
    });
  }

  function openComposerForComponent(el) {
    var rect = el.getBoundingClientRect();
    var kind = el.classList.contains('aihydro-cell') ? 'Python cell'
      : el.classList.contains('aihydro-map') ? 'Map'
      : (el.tagName === 'FIGURE' || el.classList.contains('aihydro-figure')) ? 'Figure'
      : 'Component';
    var ident = el.getAttribute('data-aihydro-cell-id')
      || el.getAttribute('data-aihydro-map-id')
      || el.id || el.tagName.toLowerCase();
    var desc = kind + ': ' + ident;
    openComposer(null, desc, rect, function(body) {
      addToBatch({
        type: 'comment', target: 'component', body: body,
        component: {
          kind: kind, id: ident,
          selector: kind === 'Python cell' ? '[data-aihydro-cell-id="' + ident + '"]'
            : kind === 'Map' ? '[data-aihydro-map-id="' + ident + '"]'
            : '#' + ident,
        },
      });
      el.classList.add('aihydro-component-has-comment');
      ensurePin(el, true);
    });
  }

  // ── Batch state ─────────────────────────────────────────────────────────
  function addToBatch(entry) {
    entry.id = 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    entry.createdAt = Date.now();
    _batch.push(entry);
    notifyParent('user.comment.draft', entry);
  }

  function notifyParent(kind, payload) {
    if (!window.__aihydroBridge) return;
    window.__aihydroBridge.reportEvent(kind, payload);
  }

  function sendBatch() {
    if (_batch.length === 0) return;
    var payload = {
      changes: _batch.slice(),
      moduleId: window.__aihydroBridge && window.__aihydroBridge.getArtifactId(),
    };
    notifyParent('user.batch_changes', payload);
    _batch = [];
    document.querySelectorAll('.aihydro-component-pin').forEach(function(p) { p.remove(); });
    document.querySelectorAll('.aihydro-component-selected').forEach(function(e) { e.classList.remove('aihydro-component-selected'); });
    document.querySelectorAll('.aihydro-component-has-comment').forEach(function(e) { e.classList.remove('aihydro-component-has-comment'); });
  }

  // ── Component selection ─────────────────────────────────────────────────
  function ensurePin(el, hasComment) {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var pin = el.querySelector(':scope > .aihydro-component-pin');
    if (!pin) {
      pin = document.createElement('button');
      pin.className = 'aihydro-component-pin';
      pin.type = 'button';
      pin.innerHTML = '💬 Comment';
      pin.addEventListener('click', function(e) { e.stopPropagation(); openComposerForComponent(el); });
      el.appendChild(pin);
    }
    if (hasComment) pin.classList.add('has-comment');
  }

  function clearPins() {
    document.querySelectorAll('.aihydro-component-pin').forEach(function(p) { p.remove(); });
    document.querySelectorAll('.aihydro-component-hover, .aihydro-component-selected').forEach(function(e) {
      e.classList.remove('aihydro-component-hover', 'aihydro-component-selected');
    });
  }

  var COMPONENT_SELECTOR = '.aihydro-cell, .aihydro-map, figure, .aihydro-figure';

  function onComponentMouseOver(e) {
    if (!_editMode) return;
    var el = e.target.closest(COMPONENT_SELECTOR);
    if (!el) return;
    el.classList.add('aihydro-component-hover');
    ensurePin(el, el.classList.contains('aihydro-component-has-comment'));
  }
  function onComponentMouseOut(e) {
    if (!_editMode) return;
    var el = e.target.closest(COMPONENT_SELECTOR);
    if (!el) return;
    if (!el.classList.contains('aihydro-component-has-comment')) {
      el.classList.remove('aihydro-component-hover');
      var pin = el.querySelector(':scope > .aihydro-component-pin');
      if (pin && !pin.classList.contains('has-comment')) pin.remove();
    }
  }

  // ── Selection listener ──────────────────────────────────────────────────
  function onSelectionChange() {
    if (!_editMode) return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) { hideBubble(); return; }
    var node = sel.anchorNode;
    var el = node && (node.nodeType === 3 ? node.parentElement : node);
    if (!el) { hideBubble(); return; }
    var editable = el.closest('[contenteditable="true"]');
    if (!editable) { hideBubble(); return; }
    var range = sel.getRangeAt(0);
    positionBubble(range.getBoundingClientRect());
  }

  // ── Smart prose detection ───────────────────────────────────────────────
  var EDITABLE_TAGS = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE'];

  function isInsideComponent(el) {
    return !!(el.closest && el.closest(COMPONENT_SELECTOR));
  }
  function isExplicitlyNonEditable(el) {
    var cur = el;
    while (cur && cur !== document.body) {
      if (cur.getAttribute && cur.getAttribute('data-aihydro-editable') === 'false') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function collectEditableElements() {
    var explicit = document.querySelectorAll('[data-aihydro-editable="prose"]');
    if (explicit.length > 0) return Array.from(explicit);
    var result = [];
    document.body.querySelectorAll(EDITABLE_TAGS.join(',').toLowerCase()).forEach(function(el) {
      if (isInsideComponent(el)) return;
      if (isExplicitlyNonEditable(el)) return;
      var style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      result.push(el);
    });
    return result;
  }

  // ── Real change detection ───────────────────────────────────────────────
  // Production requirement: only fire text.changed when the DOM actually mutates
  // (character data changes, node insertions/deletions). Format-only commands
  // that produce no content delta (e.g. clicking Bold on unselected text) MUST
  // NOT trigger text.changed, and therefore MUST NOT activate the Save button.
  //
  // Strategy:
  //   1. 'input' event on each contenteditable element — fires on typing, paste,
  //      cut, delete, and any execCommand that changes content.
  //   2. MutationObserver as a safety net for programmatic changes (e.g.
  //      revise_section from the agent) that may not dispatch 'input'.
  //
  // Both are debounced at 120ms to collapse burst typing into one notification.

  function scheduleChangeNotification() {
    if (_changeDebounceTimer) clearTimeout(_changeDebounceTimer);
    _changeDebounceTimer = setTimeout(function() {
      _changeDebounceTimer = null;
      notifyParent('text.changed', { timestampMs: Date.now() });
      scheduleEditStateReport();
    }, 120);
  }

  function onContentInput() {
    // 'input' fires on actual content changes inside contenteditable.
    // Format-only execCommands that don't change text do NOT fire 'input'.
    scheduleChangeNotification();
  }

  function startMutationObserver() {
    if (_mutationObserver) return; // already running
    _mutationObserver = new MutationObserver(function(mutations) {
      // Only care about characterData and childList changes inside editable areas.
      // Attribute mutations (e.g. class/style) are filtered out here.
      var relevant = mutations.some(function(m) {
        return m.type === 'characterData' || m.type === 'childList';
      });
      if (relevant) scheduleChangeNotification();
    });
    _editableElements.forEach(function(el) {
      _mutationObserver.observe(el, { characterData: true, childList: true, subtree: true });
    });
  }

  function stopMutationObserver() {
    if (_mutationObserver) { _mutationObserver.disconnect(); _mutationObserver = null; }
    if (_changeDebounceTimer) { clearTimeout(_changeDebounceTimer); _changeDebounceTimer = null; }
  }

  // ── Undo/redo state ─────────────────────────────────────────────────────
  // The browser tracks an undo stack per-document for contenteditable. We
  // query its availability and push the result upstream so the ribbon buttons
  // can show as enabled/disabled correctly.
  function scheduleEditStateReport() {
    if (_stateDebounceTimer) clearTimeout(_stateDebounceTimer);
    _stateDebounceTimer = setTimeout(reportEditState, 50);
  }

  function reportEditState() {
    _stateDebounceTimer = null;
    var undoEnabled = false;
    var redoEnabled = false;
    try {
      // queryCommandEnabled is deprecated but universally supported for undo/redo.
      undoEnabled = !!document.queryCommandEnabled('undo');
      redoEnabled = !!document.queryCommandEnabled('redo');
    } catch (_) {}
    notifyParent('edit.state', { undoEnabled: undoEnabled, redoEnabled: redoEnabled });
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  function onKeyDown(e) {
    if (!_editMode) return;
    var mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    if (e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        document.execCommand('redo', false);
      } else {
        document.execCommand('undo', false);
      }
      scheduleEditStateReport();
      return;
    }
    // Ctrl+Y = redo (Windows/Linux convention)
    if (e.key === 'y' && e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      document.execCommand('redo', false);
      scheduleEditStateReport();
    }
  }

  // ── Activation / deactivation ───────────────────────────────────────────
  function setEditMode(enabled) {
    _editMode = enabled;
    ensureStyles();

    if (enabled) {
      _editableElements = collectEditableElements();
      _editableElements.forEach(function(el) {
        el.classList.add('aihydro-edit-active');
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'true');
        if (!el.hasAttribute('data-aihydro-editable')) {
          el.setAttribute('data-aihydro-editable', 'prose-auto');
        }
        // 'input' event — fires on real content changes, NOT on no-op format commands.
        el.addEventListener('input', onContentInput);
      });
      // MutationObserver catches programmatic changes (agent revise_section, etc.)
      startMutationObserver();
      // Keyboard shortcuts
      document.addEventListener('keydown', onKeyDown);
      // Component hover/click
      document.querySelectorAll(COMPONENT_SELECTOR).forEach(function(el) {
        el.setAttribute('data-aihydro-editable', 'comment-only');
      });
      document.addEventListener('selectionchange', onSelectionChange);
      document.addEventListener('mouseover', onComponentMouseOver);
      document.addEventListener('mouseout', onComponentMouseOut);
      notifyParent('edit.toggled', { enabled: true, editableCount: _editableElements.length });
      // Immediately report initial undo/redo state (typically both false)
      reportEditState();
    } else {
      stopMutationObserver();
      _editableElements.forEach(function(el) {
        el.removeEventListener('input', onContentInput);
        el.classList.remove('aihydro-edit-active');
        el.removeAttribute('contenteditable');
        el.removeAttribute('spellcheck');
        if (el.getAttribute('data-aihydro-editable') === 'prose-auto') {
          el.removeAttribute('data-aihydro-editable');
        }
      });
      _editableElements = [];
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mouseover', onComponentMouseOver);
      document.removeEventListener('mouseout', onComponentMouseOut);
      hideBubble();
      closeComposer();
      clearPins();
      if (_stateDebounceTimer) { clearTimeout(_stateDebounceTimer); _stateDebounceTimer = null; }
      notifyParent('edit.toggled', { enabled: false });
    }
  }

  // ── Parent → iframe message router ─────────────────────────────────────
  window.addEventListener('message', function(e) {
    var data = e.data;
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'aihydro-edit-mode':
        setEditMode(data.enabled === true);
        break;

      case 'aihydro-editor-command':
        if (!_editMode) return;
        if (data.command === 'aihydro-link') {
          var url = prompt('Enter URL:');
          if (url) document.execCommand('createLink', false, url);
          // createLink changes DOM → 'input' event fires → real change detected
        } else if (data.command === 'undo') {
          document.execCommand('undo', false);
          scheduleEditStateReport();
        } else if (data.command === 'redo') {
          document.execCommand('redo', false);
          scheduleEditStateReport();
        } else {
          document.execCommand(data.command, false, data.value || null);
          // If the command produces a content delta, MutationObserver/input fires.
          // If it's a no-op (e.g. Bold with nothing selected), nothing fires.
          // Either way, the Save button correctly reflects actual document state.
        }
        break;

      case 'aihydro-send-batch':
        sendBatch();
        break;

      case 'aihydro-clear-batch':
        _batch = [];
        clearPins();
        notifyParent('user.batch.cleared', {});
        break;

      case 'aihydro-request-save':
        // Capture the live DOM and return it to the parent webview.
        // This is a plain postMessage back (not via bridge event system)
        // so the parent's promise resolver can receive it synchronously.
        try {
          var html = document.documentElement.outerHTML;
          window.parent.postMessage({ type: 'aihydro-save-document', html: html }, '*');
        } catch (saveErr) {
          window.parent.postMessage({ type: 'aihydro-save-document', html: '', error: String(saveErr) }, '*');
        }
        break;

      // Legacy: revise_section / focus_cell from PreviewCommandWatcher
      case 'artifact/command':
        if (data.command === 'revise_section') {
          var secEl = document.getElementById(data.sectionId)
            || document.querySelector('[data-aihydro-section-id="' + data.sectionId + '"]');
          if (secEl && typeof data.newHtml === 'string') {
            var tmp = document.createElement('div');
            tmp.innerHTML = data.newHtml;
            secEl.innerHTML = tmp.innerHTML;
            // MutationObserver will detect this programmatic change.
            notifyParent('edit.section_revised', { sectionId: data.sectionId });
          }
        } else if (data.command === 'focus_cell') {
          var fc = document.querySelector('[data-aihydro-cell-id="' + data.cellId + '"]');
          if (fc) {
            fc.scrollIntoView({ behavior: 'smooth', block: 'center' });
            var orig = fc.style.outline;
            fc.style.outline = '2px solid #00DDFF';
            fc.style.transition = 'outline 0.3s';
            setTimeout(function() { fc.style.outline = orig; }, 2500);
          }
        }
        break;
    }
  });

  // Hide bubble on scroll / outside click
  document.addEventListener('scroll', hideBubble, true);
  document.addEventListener('mousedown', function(e) {
    if (_bubble && !_bubble.contains(e.target)) {
      var inEditable = e.target.closest && e.target.closest('[contenteditable="true"]');
      if (!inEditable) hideBubble();
    }
  });

})();
</script>
`
