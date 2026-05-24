/**
 * AI-Hydro Bridge — Editor Adapter v2 (UI Refinement Phase)
 *
 * Rewrite of the original adapter. Old version had three structural problems:
 *   1. Per-comment modal dialog interrupted user every time
 *   2. Each comment fired immediately to the agent — chatty, no batching
 *   3. No formatting toolbar (naked contenteditable)
 *   4. No way to comment on non-text components (cells, maps, figures)
 *
 * New behavior:
 *   - Floating bubble menu on text selection (B/I/U + 💬 Comment) — no modal
 *   - Click any .aihydro-cell / .aihydro-map / figure → cyan outline + 💬 pin
 *   - All comments accumulate in iframe batch state AND post incrementally
 *     to parent as `user.comment.draft` (NOT user.comment yet — drafts only)
 *   - Parent's EditContextRibbon shows the running count
 *   - User clicks "Send N changes" in the parent ribbon → parent posts back
 *     `aihydro-send-batch` → adapter emits ONE `user.batch_changes` event
 *     with the full payload (comments[] + text diffs[])
 *   - Formatting commands flow from parent ribbon via `aihydro-editor-command`
 *
 * Message protocol (parent ↔ iframe):
 *   parent → iframe:
 *     { type: "aihydro-edit-mode",       enabled: boolean }
 *     { type: "aihydro-editor-command",  command: string, value?: string }
 *     { type: "aihydro-send-batch" }
 *   iframe → parent (via reportPreviewEvent):
 *     kind="user.comment.draft"    — single comment added to batch
 *     kind="user.comment.removed"  — single comment removed from batch
 *     kind="user.batch_changes"    — full batch sent to agent
 *     kind="edit.toggled"          — mode on/off
 *     kind="text.changed"          — debounced prose edit (for diff tracking)
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
  var _currentSelection = null;     // captured TextAnchor for active composer
  var _selectedComponent = null;    // currently highlighted component element

  // ── CSS injection (idempotent) ──────────────────────────────────────────
  var _stylesInjected = false;
  function ensureStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var s = document.createElement('style');
    s.id = 'aihydro-editor-style-v2';
    s.textContent = [
      /* Editable prose regions */
      '[data-aihydro-editable="prose"].aihydro-edit-active {',
      '  outline: 1px dashed rgba(0,221,255,0.35);',
      '  outline-offset: 4px;',
      '  border-radius: 4px;',
      '  min-height: 1em;',
      '  transition: outline-color 0.15s;',
      '}',
      '[data-aihydro-editable="prose"].aihydro-edit-active:hover {',
      '  outline-color: rgba(0,221,255,0.55);',
      '}',
      '[data-aihydro-editable="prose"].aihydro-edit-active:focus {',
      '  outline: 2px solid rgba(0,221,255,0.8);',
      '  outline-offset: 4px;',
      '}',

      /* Component selection highlight (cells, maps, figures) */
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
      '  top: -10px;',
      '  right: -10px;',
      '  z-index: 1000;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 4px;',
      '  padding: 4px 10px;',
      '  background: linear-gradient(135deg, #00A3FF, #00DDFF);',
      '  border: none;',
      '  border-radius: 16px;',
      '  color: #0a0a15;',
      '  font-family: Poppins, system-ui, sans-serif;',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  cursor: pointer;',
      '  box-shadow: 0 4px 12px rgba(0,221,255,0.4);',
      '}',
      '.aihydro-component-pin.has-comment {',
      '  background: rgba(0,221,255,0.85);',
      '}',

      /* Floating selection bubble */
      '.aihydro-selection-bubble {',
      '  position: fixed;',
      '  z-index: 99998;',
      '  display: none;',
      '  align-items: center;',
      '  gap: 2px;',
      '  padding: 3px 5px;',
      '  background: rgba(15,15,30,0.97);',
      '  border: 1px solid rgba(0,221,255,0.6);',
      '  border-radius: 8px;',
      '  box-shadow: 0 6px 20px rgba(0,0,0,0.6);',
      '  font-family: Poppins, system-ui, sans-serif;',
      '  font-size: 12px;',
      '  user-select: none;',
      '  white-space: nowrap;',
      '}',
      '.aihydro-selection-bubble.visible { display: inline-flex; }',
      '.aihydro-selection-bubble button {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  width: 26px;',
      '  height: 22px;',
      '  border: none;',
      '  background: transparent;',
      '  color: #cbd5e1;',
      '  border-radius: 4px;',
      '  cursor: pointer;',
      '  font-family: inherit;',
      '  font-size: inherit;',
      '  font-weight: 700;',
      '}',
      '.aihydro-selection-bubble button:hover { background: rgba(0,221,255,0.18); color: #00DDFF; }',
      '.aihydro-selection-bubble .bb-comment {',
      '  width: auto;',
      '  padding: 0 10px 0 8px;',
      '  background: rgba(0,221,255,0.15);',
      '  color: #00DDFF;',
      '  font-weight: 700;',
      '  gap: 4px;',
      '}',
      '.aihydro-selection-bubble .bb-comment:hover { background: rgba(0,221,255,0.3); }',
      '.aihydro-selection-bubble .bb-divider {',
      '  width: 1px;',
      '  height: 14px;',
      '  background: rgba(125,211,252,0.2);',
      '  margin: 0 2px;',
      '}',

      /* Inline composer (drops below the selection or component) */
      '.aihydro-composer {',
      '  position: fixed;',
      '  z-index: 99999;',
      '  width: 320px;',
      '  background: rgba(15,15,30,0.98);',
      '  border: 1px solid rgba(0,221,255,0.5);',
      '  border-radius: 12px;',
      '  padding: 12px;',
      '  box-shadow: 0 12px 36px rgba(0,0,0,0.65);',
      '  font-family: Nunito, system-ui, sans-serif;',
      '}',
      '.aihydro-composer .cmp-target {',
      '  margin: 0 0 8px;',
      '  padding: 5px 9px;',
      '  border-left: 3px solid rgba(0,221,255,0.5);',
      '  font-size: 12px;',
      '  color: #94a3b8;',
      '  font-style: italic;',
      '  background: rgba(0,221,255,0.05);',
      '  border-radius: 4px;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '  max-width: 100%;',
      '}',
      '.aihydro-composer textarea {',
      '  width: 100%;',
      '  box-sizing: border-box;',
      '  background: rgba(10,10,21,0.8);',
      '  border: 1px solid rgba(125,211,252,0.3);',
      '  border-radius: 8px;',
      '  color: #e2e8f0;',
      '  font-size: 13px;',
      '  font-family: inherit;',
      '  padding: 8px 10px;',
      '  resize: vertical;',
      '  min-height: 64px;',
      '  outline: none;',
      '}',
      '.aihydro-composer textarea:focus { border-color: rgba(0,221,255,0.7); }',
      '.aihydro-composer .cmp-actions {',
      '  display: flex; gap: 6px; margin-top: 8px; justify-content: flex-end;',
      '}',
      '.aihydro-composer button {',
      '  font-family: Poppins, system-ui, sans-serif;',
      '  font-size: 12px;',
      '  font-weight: 600;',
      '  padding: 5px 12px;',
      '  border-radius: 7px;',
      '  border: none;',
      '  cursor: pointer;',
      '}',
      '.aihydro-composer .cmp-cancel {',
      '  background: rgba(125,211,252,0.1);',
      '  color: #7dd3fc;',
      '}',
      '.aihydro-composer .cmp-add {',
      '  background: linear-gradient(135deg, #00A3FF, #00DDFF);',
      '  color: #0a0a15;',
      '}',
      '.aihydro-composer .cmp-hint {',
      '  margin-top: 6px;',
      '  font-size: 10px;',
      '  color: #64748b;',
      '  text-align: right;',
      '}',
    ].join('\\n');
    document.head.appendChild(s);
  }

  // ── TextAnchor (Hypothesis-style) ───────────────────────────────────────
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
      e.preventDefault();   // keep selection alive
      var btn = e.target.closest('button');
      if (!btn) return;
      var cmd = btn.getAttribute('data-cmd');
      if (cmd === 'comment') {
        openComposerForSelection();
      } else if (cmd === 'formatBlock') {
        document.execCommand('formatBlock', false, btn.getAttribute('data-value') || 'p');
        emitTextChanged();
      } else {
        document.execCommand(cmd, false);
        emitTextChanged();
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

  // ── Inline composer (drop-in panel, not a modal) ────────────────────────
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        addBtn.click();
      } else if (e.key === 'Escape') {
        closeComposer();
      }
    });

    document.body.appendChild(c);
    _composer = c;

    // Position below the anchor rect, clamp to viewport
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
    openComposer(anchor, '“' + truncated + '”', rect, function(body) {
      addToBatch({
        type: 'comment',
        target: 'text',
        body: body,
        anchor: anchor,
      });
    });
  }

  function openComposerForComponent(el) {
    var rect = el.getBoundingClientRect();
    var kind = el.classList.contains('aihydro-cell')
      ? 'Python cell'
      : el.classList.contains('aihydro-map')
        ? 'Map'
        : (el.tagName === 'FIGURE' || el.classList.contains('aihydro-figure'))
          ? 'Figure'
          : 'Component';
    var ident = el.getAttribute('data-aihydro-cell-id')
              || el.getAttribute('data-aihydro-map-id')
              || el.id
              || el.tagName.toLowerCase();
    var desc = kind + ': ' + ident;
    openComposer(null, desc, rect, function(body) {
      addToBatch({
        type: 'comment',
        target: 'component',
        body: body,
        component: { kind: kind, id: ident, selector: kind === 'Python cell'
          ? '[data-aihydro-cell-id="' + ident + '"]'
          : kind === 'Map'
            ? '[data-aihydro-map-id="' + ident + '"]'
            : '#' + ident },
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

  function emitTextChanged() {
    // Debounce-track: this is best-effort; v1 just records that prose changed
    notifyParent('text.changed', { timestampMs: Date.now() });
  }

  function sendBatch() {
    if (_batch.length === 0) return;
    var payload = { changes: _batch.slice(), moduleId: window.__aihydroBridge && window.__aihydroBridge.getArtifactId() };
    notifyParent('user.batch_changes', payload);
    _batch = [];
    // Clear visual highlights
    document.querySelectorAll('.aihydro-component-pin').forEach(function(p) { p.remove(); });
    document.querySelectorAll('.aihydro-component-selected').forEach(function(e) { e.classList.remove('aihydro-component-selected'); });
    document.querySelectorAll('.aihydro-component-has-comment').forEach(function(e) { e.classList.remove('aihydro-component-has-comment'); });
  }

  // ── Component selection ─────────────────────────────────────────────────
  function ensurePin(el, hasComment) {
    if (getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
    }
    var pin = el.querySelector(':scope > .aihydro-component-pin');
    if (!pin) {
      pin = document.createElement('button');
      pin.className = 'aihydro-component-pin';
      pin.type = 'button';
      pin.innerHTML = '💬 Comment';
      pin.addEventListener('click', function(e) {
        e.stopPropagation();
        openComposerForComponent(el);
      });
      el.appendChild(pin);
    }
    if (hasComment) pin.classList.add('has-comment');
  }

  function clearPins() {
    document.querySelectorAll('.aihydro-component-pin').forEach(function(p) { p.remove(); });
    document.querySelectorAll('.aihydro-component-hover, .aihydro-component-selected').forEach(function(e) {
      e.classList.remove('aihydro-component-hover');
      e.classList.remove('aihydro-component-selected');
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
    // Only remove highlight if not actively selected with a pending comment
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
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      hideBubble();
      return;
    }
    // Only show bubble if selection is inside an editable prose region
    var node = sel.anchorNode;
    var el = node && (node.nodeType === 3 ? node.parentElement : node);
    var editable = el && el.closest('[data-aihydro-editable="prose"]');
    if (!editable) { hideBubble(); return; }
    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    positionBubble(rect);
  }

  // ── Activation / deactivation ───────────────────────────────────────────
  function setEditMode(enabled) {
    _editMode = enabled;
    ensureStyles();

    var proseEls = document.querySelectorAll('[data-aihydro-editable="prose"]');
    if (enabled) {
      proseEls.forEach(function(el) {
        el.classList.add('aihydro-edit-active');
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'true');
      });
      // Mark non-prose components as comment-only
      document.querySelectorAll(COMPONENT_SELECTOR).forEach(function(el) {
        el.setAttribute('data-aihydro-editable', 'comment-only');
      });
      document.addEventListener('selectionchange', onSelectionChange);
      document.addEventListener('mouseover', onComponentMouseOver);
      document.addEventListener('mouseout', onComponentMouseOut);
      notifyParent('edit.toggled', { enabled: true });
    } else {
      proseEls.forEach(function(el) {
        el.classList.remove('aihydro-edit-active');
        el.removeAttribute('contenteditable');
        el.removeAttribute('spellcheck');
      });
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mouseover', onComponentMouseOver);
      document.removeEventListener('mouseout', onComponentMouseOut);
      hideBubble();
      closeComposer();
      clearPins();
      notifyParent('edit.toggled', { enabled: false });
    }
  }

  // ── Parent → iframe message router ──────────────────────────────────────
  window.addEventListener('message', function(e) {
    var data = e.data;
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'aihydro-edit-mode':
        setEditMode(data.enabled === true);
        break;

      case 'aihydro-editor-command':
        // Format command from EditContextRibbon (B/I/U/H1-3/list/link)
        if (!_editMode) return;
        if (data.command === 'aihydro-link') {
          var url = prompt('Enter URL:');
          if (url) document.execCommand('createLink', false, url);
        } else {
          document.execCommand(data.command, false, data.value || null);
        }
        emitTextChanged();
        break;

      case 'aihydro-send-batch':
        sendBatch();
        break;

      case 'aihydro-clear-batch':
        _batch = [];
        clearPins();
        notifyParent('user.batch.cleared', {});
        break;

      // Legacy: revise_section / focus_cell from PreviewCommandWatcher
      case 'artifact/command':
        if (data.command === 'revise_section') {
          var el = document.getElementById(data.sectionId)
                || document.querySelector('[data-aihydro-section-id="' + data.sectionId + '"]');
          if (el && typeof data.newHtml === 'string') {
            var tmp = document.createElement('div');
            tmp.innerHTML = data.newHtml;
            el.innerHTML = tmp.innerHTML;
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
      // Don't hide if mousedown is inside an editable region (selection in progress)
      var inEditable = e.target.closest && e.target.closest('[data-aihydro-editable="prose"]');
      if (!inEditable) hideBubble();
    }
  });

})();
</script>
`
