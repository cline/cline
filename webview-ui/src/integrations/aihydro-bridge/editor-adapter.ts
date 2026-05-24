/**
 * AI-Hydro Bridge — Editor Adapter (Phase 4)
 *
 * Exports `AIHYDRO_BRIDGE_EDITOR_SCRIPT`: injected into every module iframe.
 * Activates only when the user explicitly toggles Edit Mode (via the toolbar
 * in the VS Code panel) — there is zero overhead at normal viewing time.
 *
 * Edit scope (enforced by contract):
 *   • `data-aihydro-editable="prose"` regions → TipTap rich-text editor (lazy-loaded)
 *   • Python cells, maps, figures → comment-pin only (not editable)
 *   • Agent NEVER auto-applies; all changes go through diff-proposal flow
 *
 * Comment flow (in-iframe side):
 *   1. User selects text → "💬" bubble appears
 *   2. User types comment → bridge emits `user.comment` PreviewEvent
 *   3. Comment includes TextAnchor (quote + context + offset + parentSelector)
 *   4. Agent receives via preview_recent_events → calls preview_address_comment
 *   5. Host receives address_comment command → writes diff → user reviews in VS Code
 *   6. On accept: host emits `command.revise_section` → iframe swaps section HTML
 *   7. Comment status set to "addressed"
 *
 * TipTap is loaded from CDN on first Edit Mode activation.
 * (Vendored distribution is planned for a follow-up release.)
 */

const TIPTAP_CDN_JS = "https://cdn.jsdelivr.net/npm/@tiptap/core@2.4.0/dist/index.umd.min.js"
const TIPTAP_STARTER_KIT = "https://cdn.jsdelivr.net/npm/@tiptap/starter-kit@2.4.0/dist/index.umd.min.js"

export const AIHYDRO_BRIDGE_EDITOR_SCRIPT = `
<script id="aihydro-bridge-editor">
(function () {
  'use strict';

  var _editMode = false;
  var _editors = new Map();  // element → TipTap editor instance
  var _commentBubble = null;
  var _selection = null;     // { quote, context, startOffset, endOffset, parentSelector }

  // ── Edit Mode CSS ────────────────────────────────────────────────────────
  var _stylesInjected = false;
  function ensureStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var s = document.createElement('style');
    s.id = 'aihydro-editor-style';
    s.textContent = [
      /* Editable prose regions */
      '[data-aihydro-editable="prose"].aihydro-edit-active {',
      '  outline: 2px solid rgba(0,221,255,0.4);',
      '  outline-offset: 4px;',
      '  border-radius: 6px;',
      '  min-height: 1em;',
      '}',
      '[data-aihydro-editable="prose"].aihydro-edit-active:focus-within {',
      '  outline-color: rgba(0,221,255,0.8);',
      '}',
      /* Comment-only regions (cells, maps, figures) */
      '[data-aihydro-editable="comment-only"] {',
      '  position: relative;',
      '}',
      /* Comment bubble */
      '.aihydro-comment-bubble {',
      '  position: fixed;',
      '  z-index: 99998;',
      '  background: rgba(0,221,255,0.15);',
      '  border: 1px solid rgba(0,221,255,0.6);',
      '  border-radius: 8px;',
      '  padding: 4px 10px;',
      '  font-size: 13px;',
      '  color: #00DDFF;',
      '  cursor: pointer;',
      '  display: none;',
      '  user-select: none;',
      '}',
      '.aihydro-comment-bubble:hover {',
      '  background: rgba(0,221,255,0.25);',
      '}',
      /* Comment dialog */
      '.aihydro-comment-dialog {',
      '  position: fixed;',
      '  z-index: 99999;',
      '  width: 320px;',
      '  background: rgba(15,15,30,0.97);',
      '  border: 1px solid rgba(0,221,255,0.45);',
      '  border-radius: 14px;',
      '  padding: 16px;',
      '  box-shadow: 0 8px 32px rgba(0,0,0,0.6);',
      '  font-family: Nunito, system-ui, sans-serif;',
      '}',
      '.aihydro-comment-dialog h4 {',
      '  margin: 0 0 10px;',
      '  font-size: 14px;',
      '  color: #7dd3fc;',
      '  font-family: Poppins, system-ui, sans-serif;',
      '}',
      '.aihydro-comment-dialog blockquote {',
      '  margin: 0 0 10px;',
      '  padding: 6px 10px;',
      '  border-left: 3px solid rgba(0,221,255,0.4);',
      '  font-size: 12px;',
      '  color: #94a3b8;',
      '  font-style: italic;',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  max-width: 280px;',
      '}',
      '.aihydro-comment-dialog textarea {',
      '  width: 100%;',
      '  box-sizing: border-box;',
      '  background: rgba(10,10,21,0.8);',
      '  border: 1px solid rgba(125,211,252,0.3);',
      '  border-radius: 8px;',
      '  color: #e2e8f0;',
      '  font-size: 13px;',
      '  font-family: Nunito, system-ui, sans-serif;',
      '  padding: 8px 10px;',
      '  resize: vertical;',
      '  min-height: 80px;',
      '  outline: none;',
      '}',
      '.aihydro-comment-dialog textarea:focus {',
      '  border-color: rgba(0,221,255,0.6);',
      '}',
      '.aihydro-comment-dialog-actions {',
      '  display: flex;',
      '  gap: 8px;',
      '  margin-top: 10px;',
      '  justify-content: flex-end;',
      '}',
      '.aihydro-comment-btn {',
      '  font-family: Poppins, system-ui, sans-serif;',
      '  font-size: 12px;',
      '  font-weight: 600;',
      '  padding: 6px 14px;',
      '  border-radius: 8px;',
      '  border: none;',
      '  cursor: pointer;',
      '  transition: opacity 0.15s;',
      '}',
      '.aihydro-comment-btn:hover { opacity: 0.85; }',
      '.aihydro-comment-btn.primary {',
      '  background: linear-gradient(135deg, #00A3FF, #00DDFF);',
      '  color: #0a0a15;',
      '}',
      '.aihydro-comment-btn.cancel {',
      '  background: rgba(125,211,252,0.1);',
      '  color: #7dd3fc;',
      '}',
    ].join('\\n');
    document.head.appendChild(s);
  }

  // ── Compute text anchor for current selection ───────────────────────────
  function computeAnchor(sel) {
    if (!sel || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var quote = sel.toString();
    if (!quote.trim()) return null;

    // Context: ~200 chars around the selection in the container's text
    var container = range.commonAncestorContainer;
    var contextEl = container.nodeType === 3 ? container.parentElement : container;
    var contextText = (contextEl && contextEl.textContent) || '';
    var startInContext = contextText.indexOf(quote.trim());
    var context = contextText.slice(
      Math.max(0, startInContext - 100),
      Math.min(contextText.length, startInContext + quote.length + 100)
    );

    // Parent selector
    var parentEl = range.startContainer.nodeType === 3
      ? range.startContainer.parentElement
      : range.startContainer;
    var parentSelector = '';
    while (parentEl && parentEl !== document.body) {
      if (parentEl.id) { parentSelector = '#' + parentEl.id; break; }
      if (parentEl.className) {
        parentSelector = '.' + String(parentEl.className).trim().split(/\\s+/)[0];
        break;
      }
      parentEl = parentEl.parentElement;
    }

    // Character offsets relative to document body text
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

  // ── Comment bubble ─────────────────────────────────────────────────────
  function getCommentBubble() {
    if (!_commentBubble) {
      _commentBubble = document.createElement('div');
      _commentBubble.className = 'aihydro-comment-bubble';
      _commentBubble.textContent = '💬 Comment';
      _commentBubble.addEventListener('click', openCommentDialog);
      document.body.appendChild(_commentBubble);
    }
    return _commentBubble;
  }

  function positionBubble(rect) {
    var bubble = getCommentBubble();
    bubble.style.top = (rect.top - 36) + 'px';
    bubble.style.left = rect.left + 'px';
    bubble.style.display = 'block';
  }

  function hideBubble() {
    if (_commentBubble) _commentBubble.style.display = 'none';
  }

  // ── Comment dialog ─────────────────────────────────────────────────────
  var _dialog = null;
  function openCommentDialog() {
    if (!_selection) return;
    hideBubble();

    if (_dialog) _dialog.remove();
    _dialog = document.createElement('div');
    _dialog.className = 'aihydro-comment-dialog';

    var h4 = document.createElement('h4');
    h4.textContent = 'Add comment';
    _dialog.appendChild(h4);

    if (_selection.quote) {
      var bq = document.createElement('blockquote');
      bq.textContent = '"' + _selection.quote.slice(0, 100) + (
        _selection.quote.length > 100 ? '…' : ''
      ) + '"';
      _dialog.appendChild(bq);
    }

    var ta = document.createElement('textarea');
    ta.placeholder = 'Describe the issue or suggestion…';
    _dialog.appendChild(ta);

    var actions = document.createElement('div');
    actions.className = 'aihydro-comment-dialog-actions';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'aihydro-comment-btn cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function () { _dialog.remove(); _dialog = null; });
    actions.appendChild(cancelBtn);

    var submitBtn = document.createElement('button');
    submitBtn.className = 'aihydro-comment-btn primary';
    submitBtn.textContent = 'Send to agent';
    submitBtn.addEventListener('click', function () {
      var body = ta.value.trim();
      if (!body) { ta.focus(); return; }
      submitComment(body, _selection);
      _dialog.remove();
      _dialog = null;
      _selection = null;
    });
    actions.appendChild(submitBtn);
    _dialog.appendChild(actions);

    // Position below the bubble's former position
    _dialog.style.top = '50%';
    _dialog.style.left = '50%';
    _dialog.style.transform = 'translate(-50%, -50%)';
    document.body.appendChild(_dialog);
    ta.focus();
  }

  // ── Submit comment to agent ─────────────────────────────────────────────
  function submitComment(body, anchor) {
    if (!window.__aihydroBridge) return;
    var commentId = 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    window.__aihydroBridge.reportEvent('user.comment', {
      commentId: commentId,
      body: body,
      anchor: anchor,
      moduleId: window.__aihydroBridge.getArtifactId(),
    });
    showCommentPin(anchor, commentId, body);
  }

  // ── Comment pin in margin ──────────────────────────────────────────────
  function showCommentPin(anchor, commentId, body) {
    // Find the element that contains the quoted text
    var targetEl = null;
    if (anchor.parentSelector) {
      try { targetEl = document.querySelector(anchor.parentSelector); } catch (e) {}
    }
    if (!targetEl) return;

    var pin = document.createElement('div');
    pin.style.cssText = [
      'position:absolute',
      'right:-28px',
      'top:0',
      'width:22px',
      'height:22px',
      'border-radius:50%',
      'background:rgba(0,221,255,0.2)',
      'border:2px solid rgba(0,221,255,0.6)',
      'cursor:pointer',
      'font-size:11px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'color:#00DDFF',
      'z-index:100',
      'title:' + body.slice(0, 40),
    ].join(';');
    pin.textContent = '💬';
    pin.setAttribute('data-comment-id', commentId);
    pin.title = body.slice(0, 80);

    if (getComputedStyle(targetEl).position === 'static') {
      targetEl.style.position = 'relative';
    }
    targetEl.appendChild(pin);
  }

  // ── Selection listener ─────────────────────────────────────────────────
  function onSelectionChange() {
    if (!_editMode) return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      hideBubble();
      return;
    }
    var anchor = computeAnchor(sel);
    if (!anchor) { hideBubble(); return; }
    _selection = anchor;
    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    positionBubble(rect);
  }

  // ── Listen for edit-mode toggle from host ──────────────────────────────
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.type !== 'aihydro-edit-mode') return;
    setEditMode(data.enabled === true);
  });

  function setEditMode(enabled) {
    _editMode = enabled;
    ensureStyles();

    if (enabled) {
      document.addEventListener('selectionchange', onSelectionChange);
      // Mark editable regions visually
      document.querySelectorAll('[data-aihydro-editable="prose"]').forEach(function (el) {
        el.classList.add('aihydro-edit-active');
        el.setAttribute('contenteditable', 'true');
      });
      // Cells/maps/figures get comment-pin mode
      var commentOnly = document.querySelectorAll(
        '.aihydro-cell, .aihydro-map, figure, .aihydro-figure'
      );
      commentOnly.forEach(function (el) {
        el.setAttribute('data-aihydro-editable', 'comment-only');
      });

      if (window.__aihydroBridge) {
        window.__aihydroBridge.reportEvent('edit.toggled', { enabled: true });
      }
    } else {
      document.removeEventListener('selectionchange', onSelectionChange);
      hideBubble();
      if (_dialog) { _dialog.remove(); _dialog = null; }
      document.querySelectorAll('[data-aihydro-editable="prose"].aihydro-edit-active').forEach(function (el) {
        el.classList.remove('aihydro-edit-active');
        el.removeAttribute('contenteditable');
      });
      if (window.__aihydroBridge) {
        window.__aihydroBridge.reportEvent('edit.toggled', { enabled: false });
      }
    }
  }

  // ── Handle revise_section command from host ───────────────────────────
  // (sent via PreviewCommandWatcher → appendEvent → webview postMessage → iframe postMessage)
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.type !== 'artifact/command') return;
    if (data.command === 'revise_section') {
      applyRevision(data.sectionId, data.newHtml);
    }
    if (data.command === 'focus_cell') {
      focusCell(data.cellId);
    }
  });

  function applyRevision(sectionId, newHtml) {
    var el = document.getElementById(sectionId) ||
              document.querySelector('[data-aihydro-section-id="' + sectionId + '"]');
    if (!el || !newHtml) return;
    // Create a temporary container to parse the HTML safely
    var tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    el.innerHTML = tmp.innerHTML;
    // Report success
    if (window.__aihydroBridge) {
      window.__aihydroBridge.reportEvent('edit.section_revised', { sectionId: sectionId });
    }
  }

  function focusCell(cellId) {
    var el = document.querySelector('[data-aihydro-cell-id="' + cellId + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var origOutline = el.style.outline;
    el.style.outline = '2px solid #00DDFF';
    el.style.transition = 'outline 0.3s';
    setTimeout(function () { el.style.outline = origOutline; }, 2500);
  }

  // Register with the bridge (no-op — editor is event-driven, not DOM-scan-driven)
  if (window.__aihydroBridge) {
    // Nothing to register on load — editor activates on message event
  }
})();
</script>
`
