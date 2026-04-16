(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────
  let currentDate   = new Date();
  let dayData       = {};
  let config        = {};
  let pendingCfg    = {};
  let calOpen       = false;
  let calMonth      = new Date();
  let datesWithData = new Set();
  let suppressBlur  = false;

  // ─── DOM ────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const dateText    = $('date-text');
  const calArrow    = $('cal-arrow');
  const calendar    = $('calendar');
  const calGrid     = $('cal-grid');
  const calLabel    = $('cal-label');
  const content     = $('content');
  const todosList   = $('todos-list');
  const followupsList = $('followups-list');
  const notesBlocks = $('notes-blocks');
  const overlay     = $('settings-overlay');
  const btnToday    = $('btn-today');
  const todosBody   = $('todos-body');
  const followupsBody = $('followups-body');
  const notesBody   = $('notes-body');
  const todosChev   = $('todos-chev');
  const followupsChev = $('followups-chev');
  const notesChev   = $('notes-chev');

  const sectionEls = {
    todos:     document.querySelector('.todos-section'),
    followups: document.querySelector('.followups-section'),
    notes:     document.querySelector('.notes-section'),
  };

  // ─── Helpers ────────────────────────────────────────────────────
  const fmtKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const fmtDisplay = (d) =>
    d.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,10);
  const isToday = (d) => {
    const t = new Date();
    return d.getFullYear()===t.getFullYear() && d.getMonth()===t.getMonth() && d.getDate()===t.getDate();
  };
  const escAttr = (s) => s.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const escHtml = (s) => { const d=document.createElement('span'); d.textContent=s; return d.innerHTML; };

  // ─── ContentEditable cursor helpers ─────────────────────────────
  function isCursorAtStart(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) return true;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) return false;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(r.startContainer, r.startOffset);
    return pre.cloneContents().textContent.length === 0;
  }

  function isCursorAtEnd(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) return true;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) return false;
    const post = document.createRange();
    post.selectNodeContents(el);
    post.setStart(r.endContainer, r.endOffset);
    return post.cloneContents().textContent.length === 0;
  }

  function focusAtStart(el) {
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
  }

  function focusAtEnd(el) {
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
  }

  // ─── Cross-section navigation ──────────────────────────────────
  function getAllEditableElements() {
    const order = config.sectionOrder || ['todos', 'followups', 'notes'];
    const elements = [];
    for (const name of order) {
      const section = sectionEls[name];
      if (!section) continue;
      const body = section.querySelector('.section-body');
      if (body && body.classList.contains('closed')) continue;

      if (name === 'todos') {
        elements.push(...section.querySelectorAll('.todo-text'));
      } else if (name === 'followups') {
        elements.push(...section.querySelectorAll('.followup-text'));
      } else if (name === 'notes') {
        const noteEls = [...section.querySelectorAll('.notes-text, .callout-title, .callout-detail')];
        elements.push(...noteEls.filter(el => {
          if (el.classList.contains('callout-detail')) {
            const cbody = el.closest('.callout-body');
            return cbody && cbody.classList.contains('open');
          }
          return true;
        }));
      }
    }
    return elements;
  }

  function focusPrevElement(current) {
    const els = getAllEditableElements();
    const idx = els.indexOf(current);
    if (idx > 0) {
      const prev = els[idx - 1];
      if (prev.tagName === 'INPUT') {
        prev.focus();
        prev.setSelectionRange(prev.value.length, prev.value.length);
      } else {
        focusAtEnd(prev);
      }
    }
  }

  function focusNextElement(current) {
    const els = getAllEditableElements();
    const idx = els.indexOf(current);
    if (idx < els.length - 1) {
      const next = els[idx + 1];
      if (next.tagName === 'INPUT') {
        next.focus();
        next.setSelectionRange(0, 0);
      } else {
        focusAtStart(next);
      }
    }
  }

  // ─── Section order ─────────────────────────────────────────────
  function applySectionOrder() {
    const order = config.sectionOrder || ['todos', 'followups', 'notes'];
    while (content.firstChild) content.removeChild(content.firstChild);
    order.forEach((name, i) => {
      if (i > 0) {
        const hr = document.createElement('hr');
        hr.className = 'divider';
        content.appendChild(hr);
      }
      if (sectionEls[name]) content.appendChild(sectionEls[name]);
    });
  }

  // ─── Data ───────────────────────────────────────────────────────
  async function loadDay() {
    const raw = await window.api.loadDay(fmtKey(currentDate));
    dayData = raw || {};
    if (!dayData.todos) dayData.todos = [];
    if (!dayData.followups) dayData.followups = [];
    migrateNotes();
    render();
  }

  function migrateNotes() {
    if (typeof dayData.notesText === 'string') {
      const t = dayData.notesText.trim();
      dayData.notes = t ? [{ id: uid(), type: 'text', html: escHtml(t).replace(/\n/g, '<br>') }] : [];
      delete dayData.notesText;
      return;
    }
    if (Array.isArray(dayData.notes)) {
      dayData.notes = dayData.notes.map(n => {
        if (n.type === 'text'    && n.html !== undefined) return n;
        if (n.type === 'callout' && n.html !== undefined) return n;
        if (n.type === 'text')
          return { id: n.id, type: 'text', html: escHtml(n.text||'').replace(/\n/g,'<br>') };
        if (n.type === 'callout')
          return { id: n.id, type: 'callout', title: n.title||'', html: n.body ? escHtml(n.body).replace(/\n/g,'<br>') : '', collapsed: n.collapsed ?? true };
        if (n.content)
          return { id: n.id, type: 'text', html: escHtml(n.content).replace(/\n/g,'<br>') };
        return { id: n.id||uid(), type: 'text', html: '' };
      });
      return;
    }
    dayData.notes = [];
  }

  function saveDay() {
    window.api.saveDay(fmtKey(currentDate), {
      todos: dayData.todos || [],
      followups: dayData.followups || [],
      notes: dayData.notes || [],
    });
  }

  function mergeAdjacentText() {
    for (let i = dayData.notes.length - 1; i > 0; i--) {
      if (dayData.notes[i].type === 'text' && dayData.notes[i-1].type === 'text') {
        const a = dayData.notes[i-1].html || '';
        const b = dayData.notes[i].html || '';
        dayData.notes[i-1].html = a + (a && b ? '<br>' : '') + b;
        dayData.notes.splice(i, 1);
      }
    }
  }

  // ─── Render ─────────────────────────────────────────────────────
  function render() {
    dateText.textContent = fmtDisplay(currentDate);
    btnToday.classList.toggle('is-today', isToday(currentDate));
    renderTodos();
    renderFollowups();
    renderNotes();
  }

  // ── Todos ──
  function renderTodos() {
    todosList.innerHTML = dayData.todos.map((t,i) => `
      <div class="todo-row" data-i="${i}">
        <input type="checkbox" class="todo-cb" data-i="${i}" ${t.done?'checked':''}/>
        <input type="text" class="todo-text ${t.done?'done':''}" data-i="${i}"
               value="${escAttr(t.text||'')}"/>
        <button class="todo-del" data-i="${i}">&#10005;</button>
      </div>`).join('');

    todosList.querySelectorAll('.todo-cb').forEach(cb =>
      cb.addEventListener('change', () => { dayData.todos[+cb.dataset.i].done=cb.checked; saveDay(); renderTodos(); }));

    todosList.querySelectorAll('.todo-text').forEach(inp => {
      inp.addEventListener('input', () => { dayData.todos[+inp.dataset.i].text=inp.value; saveDay(); });
      inp.addEventListener('keydown', e => {
        const i = +inp.dataset.i;
        if (e.key==='Enter') { e.preventDefault(); dayData.todos.splice(i+1,0,{id:uid(),text:'',done:false}); saveDay(); renderTodos(); focusTodo(i+1); return; }
        if (e.key==='Backspace' && !inp.value) { e.preventDefault(); dayData.todos.splice(i,1); saveDay(); renderTodos(); if(i>0) focusTodo(i-1); return; }
        if (e.key==='ArrowUp') { e.preventDefault(); focusPrevElement(inp); return; }
        if (e.key==='ArrowDown') { e.preventDefault(); focusNextElement(inp); return; }
      });
      inp.addEventListener('blur', () => {
        const item = dayData.todos[+inp.dataset.i]; if(!item) return;
        const id = item.id;
        setTimeout(() => { const p=dayData.todos.findIndex(x=>x.id===id); if(p!==-1 && !dayData.todos[p].text.trim()) { dayData.todos.splice(p,1); saveDay(); renderTodos(); } }, 180);
      });
    });

    todosList.querySelectorAll('.todo-del').forEach(b =>
      b.addEventListener('click', () => { dayData.todos.splice(+b.dataset.i,1); saveDay(); renderTodos(); }));
  }

  function focusTodo(i) { setTimeout(()=>{ const el=todosList.querySelectorAll('.todo-text')[i]; if(el) el.focus(); },20); }

  // ── Follow-ups ──
  function renderFollowups() {
    followupsList.innerHTML = dayData.followups.map((f,i) => `
      <div class="followup-row" data-i="${i}">
        <button class="followup-icon ${f.resolved?'resolved':''}" data-i="${i}" title="Toggle resolved">!</button>
        <input type="text" class="followup-text ${f.resolved?'resolved':''}" data-i="${i}"
               value="${escAttr(f.text||'')}"/>
        <button class="followup-del" data-i="${i}">&#10005;</button>
      </div>`).join('');

    followupsList.querySelectorAll('.followup-icon').forEach(btn =>
      btn.addEventListener('click', () => { dayData.followups[+btn.dataset.i].resolved=!dayData.followups[+btn.dataset.i].resolved; saveDay(); renderFollowups(); }));

    followupsList.querySelectorAll('.followup-text').forEach(inp => {
      inp.addEventListener('input', () => { dayData.followups[+inp.dataset.i].text=inp.value; saveDay(); });
      inp.addEventListener('keydown', e => {
        const i = +inp.dataset.i;
        if (e.key==='Enter') { e.preventDefault(); dayData.followups.splice(i+1,0,{id:uid(),text:'',resolved:false}); saveDay(); renderFollowups(); focusFollowup(i+1); return; }
        if (e.key==='Backspace' && !inp.value) { e.preventDefault(); dayData.followups.splice(i,1); saveDay(); renderFollowups(); if(i>0) focusFollowup(i-1); return; }
        if (e.key==='ArrowUp') { e.preventDefault(); focusPrevElement(inp); return; }
        if (e.key==='ArrowDown') { e.preventDefault(); focusNextElement(inp); return; }
      });
      inp.addEventListener('blur', () => {
        const item = dayData.followups[+inp.dataset.i]; if(!item) return;
        const id = item.id;
        setTimeout(() => { const p=dayData.followups.findIndex(x=>x.id===id); if(p!==-1 && !dayData.followups[p].text.trim()) { dayData.followups.splice(p,1); saveDay(); renderFollowups(); } }, 180);
      });
    });

    followupsList.querySelectorAll('.followup-del').forEach(b =>
      b.addEventListener('click', () => { dayData.followups.splice(+b.dataset.i,1); saveDay(); renderFollowups(); }));
  }

  function focusFollowup(i) { setTimeout(()=>{ const el=followupsList.querySelectorAll('.followup-text')[i]; if(el) el.focus(); },20); }

  // ── Notes (contenteditable text blocks + callouts) ──
  function renderNotes(focusInfo) {
    notesBlocks.innerHTML = dayData.notes.map((block, i) => {
      if (block.type === 'callout') {
        return `<div class="callout" data-i="${i}">
          <div class="callout-head">
            <span class="callout-chev ${block.collapsed?'':'open'}" data-i="${i}">&#9654;</span>
            <input type="text" class="callout-title" data-i="${i}"
                   value="${escAttr(block.title||'')}" placeholder="Callout\u2026"/>
          </div>
          <div class="callout-body ${block.collapsed?'':'open'}">
            <div class="callout-detail" contenteditable="true" data-i="${i}">${block.html||''}</div>
          </div>
        </div>`;
      }
      return `<div class="notes-text" contenteditable="true" data-i="${i}">${block.html||''}</div>`;
    }).join('');

    wireNoteTextBlocks();
    wireCalloutBlocks();
    if (focusInfo) applyFocus(focusInfo);
  }

  function wireNoteTextBlocks() {
    notesBlocks.querySelectorAll('.notes-text').forEach(el => {
      el.addEventListener('input', () => {
        dayData.notes[+el.dataset.i].html = el.innerHTML;
        saveDay();
      });

      el.addEventListener('paste', e => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      });

      el.addEventListener('keydown', e => {
        const i = +el.dataset.i;
        const sc = config.shortcuts || {};

        if (matchSC(keyCombo(e), sc.callout || 'CmdOrCtrl+/')) {
          e.preventDefault();
          convertToCallout(i, el);
          return;
        }

        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          if (i > 0 && dayData.notes[i-1].type === 'callout') {
            absorbIntoCallout(i, el);
          } else {
            document.execCommand('insertText', false, '  ');
          }
          return;
        }

        if (e.key === 'Backspace' && isCursorAtStart(el)) {
          if (!el.textContent.trim() && dayData.notes.length > 1) {
            e.preventDefault();
            suppressBlur = true;
            dayData.notes.splice(i, 1);
            mergeAdjacentText();
            saveDay();
            if (i > 0) {
              const prev = dayData.notes[i-1];
              if (prev.type === 'text') renderNotes({ type:'text', index:i-1, pos:'end' });
              else if (!prev.collapsed) renderNotes({ type:'callout-body', index:i-1, pos:'end' });
              else renderNotes({ type:'callout-title', index:i-1 });
            } else { renderNotes(); }
            setTimeout(() => { suppressBlur = false; }, 400);
            return;
          }
          if (i > 0 && el.textContent.length > 0) {
            e.preventDefault();
            mergeWithPrevious(i, el);
            return;
          }
          if (i > 0) {
            e.preventDefault();
            focusPrevElement(el);
            return;
          }
          if (i === 0) {
            e.preventDefault();
            focusPrevElement(el);
            return;
          }
          return;
        }

        handleContentEditableArrows(el, e);
      });

      el.addEventListener('blur', () => {
        if (suppressBlur) return;
        const item = dayData.notes[+el.dataset.i];
        if (!item || item.type !== 'text') return;
        const id = item.id;
        setTimeout(() => {
          if (suppressBlur) return;
          const p = dayData.notes.findIndex(x => x.id === id);
          if (p !== -1 && !(dayData.notes[p].html||'').replace(/<[^>]*>/g,'').trim() && dayData.notes.length > 1) {
            dayData.notes.splice(p, 1);
            mergeAdjacentText();
            saveDay();
            renderNotes();
          }
        }, 250);
      });
    });
  }

  function wireCalloutBlocks() {
    notesBlocks.querySelectorAll('.callout-chev').forEach(chev =>
      chev.addEventListener('click', () => {
        const i = +chev.dataset.i;
        dayData.notes[i].collapsed = !dayData.notes[i].collapsed;
        saveDay(); renderNotes();
      }));

    notesBlocks.querySelectorAll('.callout-title').forEach(inp => {
      inp.addEventListener('input', () => { dayData.notes[+inp.dataset.i].title = inp.value; saveDay(); });

      inp.addEventListener('keydown', e => {
        const i = +inp.dataset.i;
        const sc = config.shortcuts || {};

        if (matchSC(keyCombo(e), sc.callout || 'CmdOrCtrl+/')) {
          e.preventDefault();
          convertCalloutToText(i);
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          dayData.notes[i].collapsed = false;
          saveDay();
          renderNotes({ type:'callout-body', index:i, pos:'start' });
          return;
        }

        if (e.key === 'Backspace' && !inp.value) {
          e.preventDefault();
          convertCalloutToText(i);
          return;
        }

        if (e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && inp.selectionStart === 0)) {
          e.preventDefault();
          focusPrevElement(inp);
          return;
        }
        if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && inp.selectionStart === inp.value.length)) {
          e.preventDefault();
          focusNextElement(inp);
          return;
        }
      });
    });

    notesBlocks.querySelectorAll('.callout-detail').forEach(el => {
      el.addEventListener('input', () => {
        dayData.notes[+el.dataset.i].html = el.innerHTML;
        saveDay();
      });

      el.addEventListener('paste', e => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      });

      el.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && isCursorAtStart(el) && !el.textContent.trim()) {
          e.preventDefault();
          const i = +el.dataset.i;
          dayData.notes[i].collapsed = true;
          dayData.notes[i].html = '';
          saveDay();
          renderNotes({ type:'callout-title', index:i });
          return;
        }

        handleContentEditableArrows(el, e);
      });
    });
  }

  function handleContentEditableArrows(el, e) {
    if (e.key === 'ArrowLeft' && isCursorAtStart(el)) {
      e.preventDefault(); focusPrevElement(el); return;
    }
    if (e.key === 'ArrowRight' && isCursorAtEnd(el)) {
      e.preventDefault(); focusNextElement(el); return;
    }
    if (e.key === 'ArrowUp') {
      if (isCursorAtStart(el)) {
        e.preventDefault(); focusPrevElement(el); return;
      }
      const sel = window.getSelection();
      const node = sel.anchorNode, off = sel.anchorOffset;
      setTimeout(() => {
        const s = window.getSelection();
        if (s.anchorNode === node && s.anchorOffset === off) focusPrevElement(el);
      }, 0);
      return;
    }
    if (e.key === 'ArrowDown') {
      if (isCursorAtEnd(el)) {
        e.preventDefault(); focusNextElement(el); return;
      }
      const sel = window.getSelection();
      const node = sel.anchorNode, off = sel.anchorOffset;
      setTimeout(() => {
        const s = window.getSelection();
        if (s.anchorNode === node && s.anchorOffset === off) focusNextElement(el);
      }, 0);
      return;
    }
  }

  function applyFocus(info) {
    setTimeout(() => {
      if (info.type === 'text') {
        for (const el of notesBlocks.querySelectorAll('.notes-text')) {
          if (+el.dataset.i === info.index) {
            if (info.pos === 'end') focusAtEnd(el); else focusAtStart(el);
            return;
          }
        }
      }
      if (info.type === 'text-at-marker') {
        for (const el of notesBlocks.querySelectorAll('.notes-text')) {
          if (+el.dataset.i === info.index) {
            el.focus();
            const marker = el.querySelector('#merge-cursor');
            if (marker) {
              const r = document.createRange();
              r.setStartAfter(marker);
              r.collapse(true);
              const sel = window.getSelection();
              sel.removeAllRanges(); sel.addRange(r);
              marker.remove();
              dayData.notes[+el.dataset.i].html = el.innerHTML;
              saveDay();
            } else { focusAtEnd(el); }
            return;
          }
        }
      }
      if (info.type === 'callout-title') {
        for (const t of notesBlocks.querySelectorAll('.callout-title')) {
          if (+t.dataset.i === info.index) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); return; }
        }
      }
      if (info.type === 'callout-body') {
        for (const t of notesBlocks.querySelectorAll('.callout-detail')) {
          if (+t.dataset.i === info.index) {
            if (info.pos === 'end') focusAtEnd(t); else focusAtStart(t);
            return;
          }
        }
      }
    }, 25);
  }

  // ── Callout operations ──
  function convertToCallout(blockIdx, el) {
    suppressBlur = true;
    const text = el.innerText || '';
    const lines = text.split('\n');
    const title = (lines[0] || '').trim();
    const bodyText = lines.slice(1).join('\n').trim();
    const bodyHtml = bodyText ? escHtml(bodyText).replace(/\n/g, '<br>') : '';

    dayData.notes.splice(blockIdx, 1, {
      id: uid(), type: 'callout', title, html: bodyHtml, collapsed: false
    });
    saveDay();
    renderNotes({ type: 'callout-title', index: blockIdx });
    setTimeout(() => { suppressBlur = false; }, 400);
  }

  function convertCalloutToText(blockIdx) {
    suppressBlur = true;
    const c = dayData.notes[blockIdx];
    let html = escHtml(c.title || '');
    const bodyClean = (c.html||'').replace(/<[^>]*>/g,'').trim();
    if (bodyClean) html += '<br>' + c.html;

    dayData.notes[blockIdx] = { id: c.id, type: 'text', html };
    mergeAdjacentText();
    saveDay();
    const idx = dayData.notes.findIndex(n => n.id === c.id);
    renderNotes({ type: 'text', index: idx >= 0 ? idx : Math.min(blockIdx, dayData.notes.length-1), pos: 'end' });
    setTimeout(() => { suppressBlur = false; }, 400);
  }

  function absorbIntoCallout(blockIdx, el) {
    suppressBlur = true;
    const callout = dayData.notes[blockIdx - 1];
    const bodyContent = el.innerHTML || '';
    callout.html = (callout.html ? callout.html + '<br>' : '') + bodyContent;
    callout.collapsed = false;

    dayData.notes.splice(blockIdx, 1);
    mergeAdjacentText();
    saveDay();
    renderNotes({ type: 'callout-body', index: blockIdx - 1, pos: 'end' });
    setTimeout(() => { suppressBlur = false; }, 400);
  }

  function mergeWithPrevious(blockIdx, el) {
    if (blockIdx === 0) return;
    const prev = dayData.notes[blockIdx - 1];

    if (prev.type === 'text') {
      suppressBlur = true;
      const marker = '<span id="merge-cursor"></span>';
      prev.html = (prev.html || '') + marker + (el.innerHTML || '');
      dayData.notes.splice(blockIdx, 1);
      saveDay();
      renderNotes({ type: 'text-at-marker', index: blockIdx - 1 });
      setTimeout(() => { suppressBlur = false; }, 400);
    } else if (prev.type === 'callout') {
      if (!prev.collapsed) {
        focusPrevElement(el);
      } else {
        const titles = notesBlocks.querySelectorAll('.callout-title');
        for (const t of titles) {
          if (+t.dataset.i === blockIdx - 1) {
            t.focus(); t.setSelectionRange(t.value.length, t.value.length);
            return;
          }
        }
      }
    }
  }

  // ─── Click-to-add ─────────────────────────────────────────────
  $('notes-click').addEventListener('click', () => {
    ensureSectionOpen('notes');
    if (!dayData.notes.length || dayData.notes[dayData.notes.length-1].type !== 'text') {
      dayData.notes.push({ id: uid(), type: 'text', html: '' });
      saveDay();
    }
    renderNotes({ type: 'text', index: dayData.notes.length - 1, pos: 'end' });
  });

  $('todos-click').addEventListener('click', () => {
    ensureSectionOpen('todos');
    dayData.todos.push({ id: uid(), text: '', done: false });
    saveDay(); renderTodos();
    focusTodo(dayData.todos.length - 1);
  });

  $('followups-click').addEventListener('click', () => {
    ensureSectionOpen('followups');
    dayData.followups.push({ id: uid(), text: '', resolved: false });
    saveDay(); renderFollowups();
    focusFollowup(dayData.followups.length - 1);
  });

  // ─── Section collapse ─────────────────────────────────────────
  $('todos-hdr').addEventListener('click', () => toggleSection('todos'));
  $('followups-hdr').addEventListener('click', () => toggleSection('followups'));
  $('notes-hdr').addEventListener('click', () => toggleSection('notes'));

  function sectionRefs(name) {
    if (name === 'todos')     return { body: todosBody,     chev: todosChev };
    if (name === 'followups') return { body: followupsBody, chev: followupsChev };
    return { body: notesBody, chev: notesChev };
  }

  function toggleSection(name) {
    const { body, chev } = sectionRefs(name);
    body.classList.toggle('closed'); chev.classList.toggle('open');
  }
  function ensureSectionOpen(name) {
    const { body, chev } = sectionRefs(name);
    if (body.classList.contains('closed')) { body.classList.remove('closed'); chev.classList.add('open'); }
  }

  // ─── Calendar ──────────────────────────────────────────────────
  $('date-center').addEventListener('click', toggleCalendar);
  function toggleCalendar() {
    calOpen = !calOpen;
    calendar.classList.toggle('open', calOpen);
    calArrow.classList.toggle('open', calOpen);
    if (calOpen) { calMonth = new Date(currentDate); refreshCalendar(); }
  }
  function closeCalendar() { calOpen=false; calendar.classList.remove('open'); calArrow.classList.remove('open'); }
  $('cal-prev').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth()-1); renderCalendar(); });
  $('cal-next').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth()+1); renderCalendar(); });

  async function refreshCalendar() { datesWithData = new Set(await window.api.getAllDates()); renderCalendar(); }

  function renderCalendar() {
    const year=calMonth.getFullYear(), month=calMonth.getMonth();
    calLabel.textContent = calMonth.toLocaleDateString('en-US',{month:'long',year:'numeric'});
    const startOff = (new Date(year,month,1).getDay()+6)%7;
    const totalDays = new Date(year,month+1,0).getDate();
    const todayStr = fmtKey(new Date()), selStr = fmtKey(currentDate);
    let html = ['Mo','Tu','We','Th','Fr','Sa','Su'].map(d=>`<span class="cal-dow">${d}</span>`).join('');
    for (let i=0;i<startOff;i++) html += '<span class="cal-day empty"></span>';
    for (let d=1;d<=totalDays;d++) {
      const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cls = ['cal-day',ds===todayStr?'today':'',ds===selStr?'selected':'',datesWithData.has(ds)?'has-data':''].filter(Boolean).join(' ');
      html += `<span class="${cls}" data-date="${ds}">${d}</span>`;
    }
    calGrid.innerHTML = html;
    calGrid.querySelectorAll('.cal-day:not(.empty)').forEach(el =>
      el.addEventListener('click', () => { currentDate = new Date(el.dataset.date+'T12:00:00'); closeCalendar(); loadDay(); }));
  }

  // ─── Date nav ──────────────────────────────────────────────────
  function navDay(off) { currentDate = new Date(currentDate.getTime()+off*864e5); loadDay(); }
  $('btn-prev').addEventListener('click', () => navDay(-1));
  $('btn-next').addEventListener('click', () => navDay(1));
  btnToday.addEventListener('click', () => { currentDate = new Date(); loadDay(); });

  // ─── Title bar ─────────────────────────────────────────────────
  $('btn-close').addEventListener('click', () => window.api.closeWindow());
  $('btn-minimize').addEventListener('click', () => window.api.minimizeWindow());
  $('btn-pin').addEventListener('click', async () => {
    const on = await window.api.toggleAlwaysOnTop();
    $('btn-pin').classList.toggle('pinned', on);
  });

  // ─── Keyboard shortcuts ────────────────────────────────────────
  function keyCombo(e) {
    const p = [];
    if (e.ctrlKey||e.metaKey) p.push('CmdOrCtrl');
    if (e.altKey) p.push('Alt');
    if (e.shiftKey) p.push('Shift');
    const k = e.key;
    if (!['Control','Alt','Shift','Meta'].includes(k)) p.push(k.length===1? k.toUpperCase() : k);
    return p.join('+');
  }
  const matchSC = (a,b) => a.toLowerCase() === (b||'').toLowerCase();

  function isEditing() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
  }

  document.addEventListener('keydown', e => {
    if (overlay.classList.contains('open')) return;
    const combo = keyCombo(e), sc = config.shortcuts || {};

    if (matchSC(combo, sc.newTodo || 'CmdOrCtrl+T')) {
      e.preventDefault();
      ensureSectionOpen('todos');
      dayData.todos.push({id:uid(),text:'',done:false}); saveDay(); renderTodos(); focusTodo(dayData.todos.length-1);
      return;
    }
    if (matchSC(combo, sc.newFollowup || 'CmdOrCtrl+U')) {
      e.preventDefault();
      ensureSectionOpen('followups');
      dayData.followups.push({id:uid(),text:'',resolved:false}); saveDay(); renderFollowups(); focusFollowup(dayData.followups.length-1);
      return;
    }
    if (matchSC(combo, sc.newNote || 'CmdOrCtrl+N')) {
      e.preventDefault();
      ensureSectionOpen('notes');
      if (!dayData.notes.length || dayData.notes[dayData.notes.length-1].type !== 'text') {
        dayData.notes.push({id:uid(),type:'text',html:''});
        saveDay();
      }
      renderNotes({type:'text', index:dayData.notes.length-1, pos:'end'});
      return;
    }
    if (matchSC(combo, sc.pinWindow || 'CmdOrCtrl+Shift+P')) { e.preventDefault(); $('btn-pin').click(); return; }
    if (e.key==='Escape') {
      if (calOpen) { closeCalendar(); return; }
      if (isEditing()) { document.activeElement.blur(); return; }
      window.api.minimizeWindow(); return;
    }
    if (!isEditing()) {
      if (e.key==='ArrowLeft') navDay(-1);
      if (e.key==='ArrowRight') navDay(1);
    }
  });

  // ─── Settings ──────────────────────────────────────────────────
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-close-settings').addEventListener('click', closeSettings);
  overlay.addEventListener('click', e => { if(e.target===overlay) closeSettings(); });

  const SECTION_LABELS = { todos: 'TODOS', followups: 'FOLLOW-UPS', notes: 'NOTES' };

  function renderSectionOrderUI() {
    const list = $('section-order-list');
    const order = pendingCfg.sectionOrder || ['todos', 'followups', 'notes'];
    list.innerHTML = order.map((name, i) => `
      <div class="section-order-row" data-idx="${i}">
        <button class="section-order-btn" data-dir="up" data-idx="${i}" ${i===0?'disabled':''}>\u25B2</button>
        <button class="section-order-btn" data-dir="down" data-idx="${i}" ${i===order.length-1?'disabled':''}>\u25BC</button>
        <span class="section-order-label">${SECTION_LABELS[name] || name}</span>
      </div>`).join('');

    list.querySelectorAll('.section-order-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.idx;
        const dir = btn.dataset.dir;
        const arr = pendingCfg.sectionOrder || ['todos', 'followups', 'notes'];
        if (dir === 'up' && idx > 0) { [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]]; }
        if (dir === 'down' && idx < arr.length - 1) { [arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]]; }
        pendingCfg.sectionOrder = arr;
        renderSectionOrderUI();
      });
    });
  }

  async function openSettings() {
    config = await window.api.getConfig();
    pendingCfg = JSON.parse(JSON.stringify(config));
    if (!pendingCfg.sectionOrder) pendingCfg.sectionOrder = ['todos', 'followups', 'notes'];
    $('sc-global').textContent    = prettySC(config.globalShortcut);
    $('sc-note').textContent      = prettySC(config.shortcuts?.newNote);
    $('sc-callout').textContent   = prettySC(config.shortcuts?.callout);
    $('sc-todo').textContent      = prettySC(config.shortcuts?.newTodo);
    $('sc-followup').textContent  = prettySC(config.shortcuts?.newFollowup);
    $('sc-pin').textContent       = prettySC(config.shortcuts?.pinWindow);
    $('cfg-color-picker').value   = config.accentColor || '#5D100A';
    $('cfg-color-text').value     = config.accentColor || '#5D100A';
    $('cfg-tray-only').checked    = !!config.trayOnly;
    renderSectionOrderUI();
    overlay.classList.add('open');
  }
  function closeSettings() { overlay.classList.remove('open'); }
  const prettySC = s => (s||'').replace(/CmdOrCtrl/g,'Ctrl');

  document.querySelectorAll('.shortcut-capture').forEach(el => {
    el.addEventListener('focus', () => { el.textContent = 'Press shortcut\u2026'; });
    el.addEventListener('blur', () => {
      const key = el.dataset.key;
      const val = key.startsWith('shortcuts.') ? pendingCfg.shortcuts?.[key.split('.')[1]] : pendingCfg[key];
      el.textContent = prettySC(val || '');
    });
    el.addEventListener('keydown', e => {
      e.preventDefault(); e.stopPropagation();
      if (e.key==='Escape') { el.blur(); return; }
      const parts = [];
      if (e.ctrlKey||e.metaKey) parts.push('CmdOrCtrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      const k = e.key;
      if (['Control','Alt','Shift','Meta'].includes(k)) return;
      parts.push(k.length===1? k.toUpperCase() : k);
      const str = parts.join('+');
      const key = el.dataset.key;
      if (key.startsWith('shortcuts.')) { if(!pendingCfg.shortcuts) pendingCfg.shortcuts={}; pendingCfg.shortcuts[key.split('.')[1]]=str; }
      else { pendingCfg[key]=str; }
      el.textContent = prettySC(str);
      el.blur();
    });
  });

  $('cfg-color-picker').addEventListener('input', e => { $('cfg-color-text').value=e.target.value; pendingCfg.accentColor=e.target.value; });
  $('cfg-color-text').addEventListener('input', e => {
    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { $('cfg-color-picker').value=e.target.value; pendingCfg.accentColor=e.target.value; }
  });
  $('cfg-tray-only').addEventListener('change', e => { pendingCfg.trayOnly = e.target.checked; });
  $('btn-save-settings').addEventListener('click', async () => {
    config = await window.api.saveConfig(pendingCfg);
    applyAccent(config.accentColor);
    applySectionOrder();
    updateHints();
    closeSettings();
  });

  // ─── Accent ────────────────────────────────────────────────────
  function applyAccent(hex) {
    if (!hex) return;
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    const hov = '#'+[r,g,b].map(c=>Math.min(255,c+35).toString(16).padStart(2,'0')).join('');
    document.documentElement.style.setProperty('--accent',hex);
    document.documentElement.style.setProperty('--accent-hover',hov);
    document.documentElement.style.setProperty('--accent-muted',hex+'40');
  }
  function updateHints() {
    const s = config.shortcuts || {};
    $('hint-todo').textContent     = prettySC(s.newTodo     || 'CmdOrCtrl+T')       + '  Todo';
    $('hint-followup').textContent = prettySC(s.newFollowup || 'CmdOrCtrl+U')       + '  Follow-up';
    $('hint-note').textContent     = prettySC(s.newNote     || 'CmdOrCtrl+N')       + '  Notes';
    $('hint-callout').textContent  = prettySC(s.callout     || 'CmdOrCtrl+/')       + '  Callout';
    $('hint-pin').textContent      = prettySC(s.pinWindow   || 'CmdOrCtrl+Shift+P') + '  Pin';
  }

  // ─── Init ──────────────────────────────────────────────────────
  async function init() {
    config = await window.api.getConfig();
    applyAccent(config.accentColor);
    applySectionOrder();
    updateHints();
    $('btn-pin').classList.toggle('pinned', !!config.alwaysOnTop);
    await loadDay();
  }
  window.api.onConfigLoaded(c => {
    config = c;
    applyAccent(c.accentColor);
    applySectionOrder();
    $('btn-pin').classList.toggle('pinned', !!c.alwaysOnTop);
  });
  init();
})();
