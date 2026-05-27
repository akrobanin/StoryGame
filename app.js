// ================= CONFIG & STATE =================
const CONFIG = { PASS: '1234', SAVE_KEY: 'storyEngine', DATA_KEY: 'storyData' };
const state = {
  mode: 'menu', theme: 'light', isPreview: false,
  data: { variables: [], characters: [], audioTracks: [], randomEvents: [], stories: [] },
  currentStory: null, currentBlock: null, vars: {},
  visitedRandom: new Set(), randomQueue: [], isProcessing: false,
  _pendingNextId: '',
  audio: null, timer: null, selectedBlock: null, drag: { active: false }
};

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const uid = () => Math.random().toString(36).substr(2,9);
const toNum = v => isNaN(v) ? 0 : Number(v);

// ================= UTILS & PARSERS =================
function ensureCT(b) {
  if (!b.conditionalTransition) b.conditionalTransition = {};
  const ct = b.conditionalTransition;
  if (ct.enabled === undefined) ct.enabled = false;
  if (ct.compound === undefined) ct.compound = false;
  if (!ct.cond1) ct.cond1 = {var:'',op:'>',val2:'',valIsVar:false};
  if (!ct.cond2) ct.cond2 = {var:'',op:'>',val2:'',valIsVar:false};
  if (!ct.logic) ct.logic = 'AND';
  return ct;
}

function safeEval(expr, vars) {
  if (!expr || expr.trim() === '') return 0;
  let safe = expr.trim().replace(/\bmin\b/g, 'Math.min').replace(/\bmax\b/g, 'Math.max');
  const sortedVars = Object.keys(vars).sort((a,b) => b.length - a.length);
  for (const k of sortedVars) safe = safe.replace(new RegExp(`\\b${k}\\b`, 'g'), toNum(vars[k]));
  if (!/^[\d\.\+\-\*\/\(\)\s,]+$/.test(safe)) return 0;
  try { return new Function(`"use strict"; return (${safe})`)() || 0; } catch { return 0; }
}

function isConditionMet(cond) {
  if (!cond || !cond.trim()) return true;
  const m = cond.trim().match(/^([a-zA-Zа-яА-ЯёЁ_]\w*)\s*([><=!]+)\s*(-?\d+)$/);
  if (!m) return true; // Не распознано -> показываем выбор по умолчанию
  const val = toNum(state.vars[m[1]]);
  const target = parseFloat(m[3]);
  const op = m[2];
  switch(op) {
    case '>': return val > target;
    case '<': return val < target;
    case '>=': return val >= target;
    case '<=': return val <= target;
    case '==': case '=': return val === target;
    case '!=': case '<>': return val !== target;
    default: return true;
  }
}

function checkConditional(blockId, fallbackId) {
  const b = state.currentStory.blocks.find(x=>x.id===blockId);
  const ct = ensureCT(b);
  if (!ct.enabled) return fallbackId;
  
  const evalCond = (c) => {
    const v1 = c.var ? (state.vars[c.var] || 0) : toNum(c.val2);
    const v2 = c.valIsVar ? (state.vars[c.val2] || 0) : toNum(c.val2);
    switch(c.op) {
      case '>': return v1 > v2; case '<': return v1 < v2;
      case '>=': return v1 >= v2; case '<=': return v1 <= v2;
      case '==': case '=': return v1 === v2; case '!=': return v1 !== v2;
      default: return false;
    }
  };
  
  const r1 = evalCond(ct.cond1);
  if (ct.compound) {
    const r2 = evalCond(ct.cond2);
    return (ct.logic === 'AND') ? (r1 && r2) : (r1 || r2) ? ct.nextTrue : ct.nextFalse;
  }
  return r1 ? ct.nextTrue : ct.nextFalse;
}

function formatText(t) {
  return t.replace(/\[b\](.*?)\[\/b\]/g, '<b>$1</b>')
          .replace(/\[i\](.*?)\[\/i\]/g, '<i>$1</i>')
          .replace(/\[color=(.*?)\](.*?)\[\/color\]/g, '<span style="color:$1">$2</span>');
}

function copyToClipboard(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => alert(`📋 Скопировано: ${text}`));
  else {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t);
    t.select(); document.execCommand('copy'); t.remove(); alert(`📋 Скопировано: ${text}`);
  }
}

// ================= DATA MANAGER =================
function loadData() {
  const l = localStorage.getItem(CONFIG.DATA_KEY);
  if (l) state.data = JSON.parse(l);
  state.data.variables ||= []; state.data.audioTracks ||= [];
  state.data.randomEvents ||= []; state.data.stories ||= []; state.data.characters ||= [];
}
function saveData() { localStorage.setItem(CONFIG.DATA_KEY, JSON.stringify(state.data)); }
function exportJSON() {
  const b = new Blob([JSON.stringify(state.data, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download='story_data.json'; a.click();
}
function importJSON(file) {
  const r = new FileReader();
  r.onload = e => { state.data = JSON.parse(e.target.result); loadData(); saveData(); renderSidebar(); };
  r.readAsText(file);
}

// ================= UI & NAVIGATION =================
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.add('hidden'));
  $(`#${id}`).classList.remove('hidden');
}

function init() {
  loadData(); showScreen('main-menu');
  
  $('#btn-play').onclick = () => { renderStoryList(); showScreen('story-list-screen'); };
  $('#btn-create').onclick = () => { $('#pass-modal').classList.add('open'); $('#admin-pass-input').value = ''; $('#admin-pass-input').focus(); };
  $('#btn-back-menu').onclick = () => showScreen('main-menu');
  $('#g-exit-btn').onclick = () => { stopAudio(); state.mode='menu'; showScreen('main-menu'); };
  $('#g-back-admin-btn').onclick = () => { stopAudio(); state.mode='admin'; $('#game-screen').classList.add('hidden'); $('#admin-panel').classList.remove('hidden'); drawBlocks(); };
  $('#g-save-btn').onclick = saveGame;
  $('#g-load-btn').onclick = loadGame;
  
  $('#cancel-pass').onclick = () => $('#pass-modal').classList.remove('open');
  $('#submit-pass').onclick = () => {
    if ($('#admin-pass-input').value === CONFIG.PASS) { $('#pass-modal').classList.remove('open'); enterAdmin(); }
    else alert('❌ Неверный код');
  };
  $('#toggle-theme').onclick = () => { state.theme = state.theme==='light'?'dark':'light'; document.documentElement.dataset.theme = state.theme; };
  $('#export-btn').onclick = exportJSON;
  $('#import-btn').onclick = () => $('#import-input').click();
  $('#import-input').onchange = e => importJSON(e.target.files[0]);
  $('#logout-btn').onclick = () => location.reload();
  
  setupTabs(); setupCanvas(); setupProps();
}

function renderStoryList() {
  const c = $('#stories-container'); c.innerHTML = '';
  if (!state.data.stories.length) { c.innerHTML = '<p style="color:#666;margin:20px 0">Сюжетов пока нет. Создайте первый в редакторе.</p>'; return; }
  state.data.stories.forEach(s => {
    const d = document.createElement('div'); d.className = 'story-item';
    d.innerHTML = `<span>📖 ${s.title} <small style="color:#888">(${s.blocks.length} блоков)</small></span>`;
    d.onclick = () => startGame(s.id, false); c.appendChild(d);
  });
}

// ================= GAME ENGINE =================
function startGame(storyId, isPreview = false) {
  state.currentStory = state.data.stories.find(s=>s.id===storyId);
  if (!state.currentStory) return alert('Сюжет не найден');
  state.isPreview = isPreview; state.vars = {};
  state.data.variables.forEach(v => state.vars[v.name] = toNum(v.defaultValue));
  state.visitedRandom = new Set(); state.randomQueue = []; state.isProcessing = false; state._pendingNextId = '';
  state.mode = isPreview ? 'preview' : 'game';
  $('#g-back-admin-btn').classList.toggle('hidden', !isPreview);
  $('#g-save-btn, #g-load-btn, #g-exit-btn').style.display = isPreview ? 'none' : 'flex';
  showScreen('game-screen');
  renderBlock(state.currentStory.blocks.find(b=>b.isStart)?.id);
}

function renderBlock(blockId) {
  if (!blockId) return;
  const b = state.currentStory.blocks.find(x=>x.id===blockId);
  if (!b) return;
  state.currentBlock = b; const fade = $('#fade-overlay'); fade.classList.add('active');
  
  setTimeout(() => {
    $('#bg-layer').style.backgroundImage = b.background ? `url('${b.background}')` : '';
    $('#bg-layer').classList.toggle('active', !!b.background);
    $('#char-layer').innerHTML = '';
    if (b.charId) {
      const ch = state.data.characters.find(c=>c.id===b.charId);
      if (ch) {
        const d = document.createElement('div'); d.className = `character ${ch.isMain?'right':'left'}`;
        d.innerHTML = `<img src="${ch.photo}" alt="${ch.name}">`;
        $('#char-layer').appendChild(d); requestAnimationFrame(()=>d.classList.add('show'));
      }
    }
    
    const dlg = $('#dialogue-box');
    $('#g-char-name').textContent = b.charId ? state.data.characters.find(c=>c.id===b.charId).name : '';
    $('#g-text').innerHTML = formatText(b.text || ''); dlg.classList.remove('active');
    
    const chC = $('#choices-container'), nxt = $('#g-next-btn'), tmr = $('#timer-bar');
    chC.innerHTML = ''; nxt.classList.add('hidden'); tmr.classList.add('hidden');
    if (state.timer) clearTimeout(state.timer);
    dlg.classList.add('active');
    
    const ct = ensureCT(b);
    const hasAuto = b.autoTransition > 0;
    const hasDelay = b.delay > 0;
    const hasChoices = b.choices?.length && !ct.enabled; // Скрываем выборы если включён условный переход
    
    if (hasChoices) {
      b.choices.forEach(ch => {
        if (ch.condition && !isConditionMet(ch.condition)) return;
        const btn = document.createElement('button'); btn.className = 'choice-btn'; btn.textContent = ch.text;
        btn.onclick = () => handleChoice(ch); chC.appendChild(btn);
      });
      if (b.choiceTimeout) {
        tmr.classList.remove('hidden'); let t = b.choiceTimeout; const fill = $('#timer-fill'); fill.style.width='100%';
        const iv = setInterval(()=>{ t-=0.1; fill.style.width=`${(t/b.choiceTimeout)*100}%`; if(t<=0){clearInterval(iv); chC.firstChild?.click();}}, 100);
      }
    } else if (hasAuto) {
      tmr.classList.remove('hidden'); let t = b.autoTransition; const fill = $('#timer-fill'); fill.style.width='100%';
      state.timer = setInterval(()=>{ t-=0.1; fill.style.width=`${(t/b.autoTransition)*100}%`; if(t<=0){clearInterval(state.timer); tmr.classList.add('hidden'); goToNext();}}, 100);
    } else {
      if (hasDelay) {
        tmr.classList.remove('hidden'); let t = b.delay; const fill = $('#timer-fill'); fill.style.width='100%';
        state.timer = setInterval(()=>{ t-=0.1; fill.style.width=`${(t/b.delay)*100}%`; if(t<=0){clearInterval(state.timer); tmr.classList.add('hidden'); nxt.classList.remove('hidden');}}, 100);
      } else { nxt.classList.remove('hidden'); }
      nxt.onclick = () => { nxt.classList.add('hidden'); goToNext(); };
    }
    
    playAudio(b.id); applyEffect(b.effect); fade.classList.remove('active');
    checkRandom(b);
  }, 500);
}

function handleChoice(ch) {
  if (ch.vars) {
    for (const vMod of ch.vars) {
      const calcVal = safeEval(vMod.formula || '0', state.vars);
      if (!state.vars[vMod.name]) state.vars[vMod.name] = 0;
      switch(vMod.op) {
        case '=': state.vars[vMod.name] = calcVal; break;
        case '+': state.vars[vMod.name] += calcVal; break;
        case '-': state.vars[vMod.name] -= calcVal; break;
        case '*': state.vars[vMod.name] *= calcVal; break;
        case '/': state.vars[vMod.name] = calcVal !== 0 ? state.vars[vMod.name] / calcVal : 0; break;
      }
    }
  }
  state._pendingNextId = ch.nextId;
  state.isProcessing = true;
  const triggers = state.data.randomEvents.filter(e => e.triggerIds.includes(state.currentBlock.id) && !state.visitedRandom.has(e.id));
  if (!triggers.length) { state.isProcessing = false; processQueue(); return; }
  
  triggers.forEach(e => {
    const chance = toNum(state.vars[e.chanceVar] || 0);
    if (Math.random() * 100 <= chance) state.randomQueue.push(e);
  });
  processQueue();
}

function goToNext() {
  if (state.currentBlock.vars) {
    for (const vMod of state.currentBlock.vars) {
      const calcVal = safeEval(vMod.formula || '0', state.vars);
      if (!state.vars[vMod.name]) state.vars[vMod.name] = 0;
      switch(vMod.op) {
        case '=': state.vars[vMod.name] = calcVal; break;
        case '+': state.vars[vMod.name] += calcVal; break;
        case '-': state.vars[vMod.name] -= calcVal; break;
        case '*': state.vars[vMod.name] *= calcVal; break;
        case '/': state.vars[vMod.name] = calcVal !== 0 ? state.vars[vMod.name] / calcVal : 0; break;
      }
    }
  }
  state._pendingNextId = state.currentBlock.nextId;
  state.isProcessing = true;
  const triggers = state.data.randomEvents.filter(e => e.triggerIds.includes(state.currentBlock.id) && !state.visitedRandom.has(e.id));
  if (!triggers.length) { state.isProcessing = false; processQueue(); return; }
  
  triggers.forEach(e => {
    const chance = toNum(state.vars[e.chanceVar] || 0);
    if (Math.random() * 100 <= chance) state.randomQueue.push(e);
  });
  processQueue();
}

function checkRandom(b) { /* Логика перенесена в handleChoice/goToNext для точности */ }

function processQueue() {
  if (state.randomQueue.length === 0) {
    state.isProcessing = false;
    const next = checkConditional(state.currentBlock.id, state._pendingNextId);
    if(next) renderBlock(next);
    return;
  }
  const ev = state.randomQueue.shift();
  state.visitedRandom.add(ev.id);
  renderBlock(ev.startId);
}

function applyEffect(type) {
  const g = $('#game-screen'); g.classList.remove('shake','flash');
  if(!type) return; void g.offsetWidth; g.classList.add(type);
}
function playAudio(bId) {
  let target = state.data.audioTracks.find(t => t.ranges && t.ranges.includes(bId));
  if (target) {
    if (!state.audio || state.audio.src !== target.src) {
      if (state.audio) { state.audio.pause(); state.audio.src = ''; }
      state.audio = new Audio(target.src); state.audio.loop = true; state.audio.volume = toNum(target.volume);
      state.audio.play().catch(()=>{});
    }
  } else if (state.audio && !state.audio.paused) { state.audio.pause(); state.audio.src = ''; state.audio = null; }
}
function stopAudio() { if(state.audio){state.audio.pause(); state.audio=null;} }

function saveGame() {
  localStorage.setItem(`${CONFIG.SAVE_KEY}_${state.currentStory.id}`, JSON.stringify({
    blockId: state.currentBlock.id, vars: state.vars, visited: [...state.visitedRandom], queue: state.randomQueue.map(e=>e.id)
  })); alert('💾 Сохранено!');
}
function loadGame() {
  const d = JSON.parse(localStorage.getItem(`${CONFIG.SAVE_KEY}_${state.currentStory.id}`)||'null');
  if(d) { state.vars=d.vars; state.visitedRandom=new Set(d.visited); renderBlock(d.blockId); }
  else alert('📂 Нет сохранений');
}

// ================= ADMIN / EDITOR =================
function enterAdmin() { state.mode = 'admin'; showScreen('admin-panel'); renderSidebar(); }
function setupTabs() {
  $$('.tab').forEach(t => t.onclick = () => { $$('.tab').forEach(x=>x.classList.remove('active')); t.classList.add('active'); renderSidebar(); });
}
function renderSidebar() {
  const tab = $('.tab.active').dataset.tab, list = $('#sidebar-list'); list.innerHTML='';
  const addItem = (text, onClick, count=0) => {
    const d = document.createElement('div'); d.className='list-item'; d.innerHTML = `<span>${text} ${count?`<small style="color:#888">(${count})</small>`:''}</span>`;
    d.onclick = onClick; list.appendChild(d);
  };
  const addBtn = text => { const b = document.createElement('button'); b.textContent=text; b.className='btn-success'; b.style.margin='10px 0'; list.appendChild(b); return b; };

  if(tab==='vars') { state.data.variables.forEach(v => addItem(`${v.name} <small style="color:#666">=${v.defaultValue}</small>`, ()=>renderVarForm(v))); addBtn('+ Переменная').onclick = () => renderVarForm(null);
  } else if(tab==='chars') { state.data.characters.forEach(c => addItem(`${c.name} ${c.isMain?'⭐':''}`, ()=>renderCharForm(c))); addBtn('+ Персонаж').onclick = () => renderCharForm(null);
  } else if(tab==='audio') { state.data.audioTracks.forEach(a => addItem(`🎵 ${a.name}`, ()=>renderAudioForm(a), a.ranges.length)); addBtn('+ Музыка/Звук').onclick = () => renderAudioForm(null);
  } else if(tab==='events') { state.data.randomEvents.forEach(e => addItem(`🎲 ${e.name}`, ()=>renderEventForm(e), e.triggerIds.length)); addBtn('+ Ранд. событие').onclick = () => renderEventForm(null);
  } else if(tab==='stories') { state.data.stories.forEach(s => addItem(s.title, ()=>{ state.currentStory=s; drawBlocks(); })); addBtn('+ Создать историю').onclick = () => createStory(); }
}

function renderVarForm(v) {
  v ||= { id:uid(), name:'', defaultValue:0 };
  $('#prop-form').classList.remove('hidden'); $('#block-actions').classList.add('hidden');
  $('#prop-form').innerHTML = `
    <input id="vf-name" placeholder="Имя (без пробелов)" value="${v.name}">
    <input type="number" id="vf-def" placeholder="Начальное значение" value="${v.defaultValue}">
    <button onclick="saveVar('${v.id}')">Сохранить</button>
    ${state.data.variables.find(x=>x.id===v.id)?`<button class="btn-danger" onclick="deleteVar('${v.id}')">Удалить</button>`:''}
  `;
}
window.saveVar = id => {
  const d = state.data.variables.find(x=>x.id===id); const name = $('#vf-name').value.replace(/\s/g,'_');
  if(!name) return alert('Введите имя');
  if(d) { d.name=name; d.defaultValue=toNum($('#vf-def').value); } else state.data.variables.push({id, name, defaultValue:toNum($('#vf-def').value)});
  saveData(); renderSidebar();
};
window.deleteVar = id => { state.data.variables=state.data.variables.filter(x=>x.id!==id); saveData(); renderSidebar(); };

function renderCharForm(c) {
  c ||= { id:uid(), name:'', photo:'', isMain:false };
  $('#prop-form').classList.remove('hidden'); $('#block-actions').classList.add('hidden');
  $('#prop-form').innerHTML = `
    <input id="cf-name" placeholder="Имя" value="${c.name}">
    <input id="cf-photo" placeholder="Путь к фото" value="${c.photo}">
    <label><input type="checkbox" id="cf-main" ${c.isMain?'checked':''}> Главный (справа)</label>
    <button onclick="saveChar('${c.id}')">Сохранить</button>
    ${state.data.characters.find(x=>x.id===c.id)?`<button class="btn-danger" onclick="deleteChar('${c.id}')">Удалить</button>`:''}
  `;
}
window.saveChar = id => {
  const d = state.data.characters.find(x=>x.id===id);
  if(d) { d.name=$('#cf-name').value; d.photo=$('#cf-photo').value; d.isMain=$('#cf-main').checked; } else state.data.characters.push({id, name:$('#cf-name').value, photo:$('#cf-photo').value, isMain:$('#cf-main').checked});
  saveData(); renderSidebar();
};
window.deleteChar = id => { state.data.characters=state.data.characters.filter(x=>x.id!==id); saveData(); renderSidebar(); };

function renderAudioForm(a) {
  a ||= { id:uid(), name:'', src:'', volume:0.5, ranges:[] };
  $('#prop-form').classList.remove('hidden'); $('#block-actions').classList.add('hidden');
  $('#prop-form').innerHTML = `
    <input id="af-name" placeholder="Название трека" value="${a.name}">
    <input id="af-src" placeholder="Путь (assets/audio/...)" value="${a.src}">
    <input type="number" id="af-vol" placeholder="Громкость (0.0 - 1.0)" value="${a.volume}" step="0.1">
    <small style="color:#666">0.5 = 50% громкости</small>
    <input id="af-blocks" placeholder="ID блоков через запятую" value="${a.ranges.join(', ')}">
    <button onclick="saveAudio('${a.id}')" style="margin-top:8px">Сохранить</button>
    ${state.data.audioTracks.find(x=>x.id===a.id)?`<button class="btn-danger" onclick="deleteAudio('${a.id}')">Удалить</button>`:''}
  `;
}
window.saveAudio = id => {
  const d = state.data.audioTracks.find(x=>x.id===id); const ranges = $('#af-blocks').value.split(',').map(s=>s.trim()).filter(s=>s);
  if(d) { d.name=$('#af-name').value; d.src=$('#af-src').value; d.volume=toNum($('#af-vol').value); d.ranges=ranges; } else state.data.audioTracks.push({id, name:$('#af-name').value, src:$('#af-src').value, volume:toNum($('#af-vol').value), ranges});
  saveData(); renderSidebar();
};
window.deleteAudio = id => { state.data.audioTracks=state.data.audioTracks.filter(x=>x.id!==id); saveData(); renderSidebar(); };

function renderEventForm(e) {
  e ||= { id:uid(), name:'', chanceVar:'', triggerIds:[], startId:'' };
  $('#prop-form').classList.remove('hidden'); $('#block-actions').classList.add('hidden');
  const varOpts = state.data.variables.map(v => `<option value="${v.name}" ${e.chanceVar===v.name?'selected':''}>${v.name}</option>`).join('');
  const blocksOpt = state.currentStory?.blocks.map(bl=>`<option value="${bl.id}" ${e.startId===bl.id?'selected':''}>#${bl.id.substr(0,6)}</option>`).join('') || '<option>Сначала откройте историю</option>';
  $('#prop-form').innerHTML = `
    <input id="ef-name" placeholder="Название события" value="${e.name}">
    <label>Переменная для шанса: <select id="ef-chance-var"><option value="">Выбери...</option>${varOpts}</select></label>
    <textarea id="ef-triggers" placeholder="ID блоков-триггеров (через запятую)">${e.triggerIds.join(', ')}</textarea>
    <select id="ef-start"><option value="">Куда ведёт событие...</option>${blocksOpt}</select>
    <button onclick="saveEvent('${e.id}')" style="margin-top:8px">Сохранить</button>
    ${state.data.randomEvents.find(x=>x.id===e.id)?`<button class="btn-danger" onclick="deleteEvent('${e.id}')">Удалить</button>`:''}
  `;
}
window.saveEvent = id => {
  const d = state.data.randomEvents.find(x=>x.id===id); const triggers = $('#ef-triggers').value.split(',').map(s=>s.trim()).filter(s=>s);
  if(d) { d.name=$('#ef-name').value; d.chanceVar=$('#ef-chance-var').value; d.triggerIds=triggers; d.startId=$('#ef-start').value; } else state.data.randomEvents.push({id, name:$('#ef-name').value, chanceVar:$('#ef-chance-var').value, triggerIds:triggers, startId:$('#ef-start').value});
  saveData(); renderSidebar();
};
window.deleteEvent = id => { state.data.randomEvents=state.data.randomEvents.filter(x=>x.id!==id); saveData(); renderSidebar(); };

function createStory() {
  const title = prompt('Название истории:'); if(!title) return;
  const s = { id:uid(), title, blocks:[{id:uid(), isStart:true, x:300, y:300, text:'Начало...', choices:[], vars:[], autoTransition:0}], defaultVars:{} };
  ensureCT(s.blocks[0]); // Гарантируем структуру
  state.data.stories.push(s); state.currentStory=s; saveData(); renderSidebar(); drawBlocks();
}

// Canvas & Blocks (Touch + Mouse)
function setupCanvas() {
  const cv = $('#editor-canvas'); const getPos = (e) => e.touches ? e.touches[0] : e;
  const handleStart = (e) => {
    const target = e.target.closest('.block'); if (!target) return;
    if (e.target.classList.contains('conn-point') || e.target.classList.contains('block-id')) return;
    e.preventDefault(); const id = target.dataset.id; selectBlock(id);
    const pos = getPos(e); state.drag.active = true; state.drag.offX = pos.clientX - target.offsetLeft; state.drag.offY = pos.clientY - target.offsetTop;
  };
  const handleMove = (e) => {
    if (!state.drag.active || !$('.block.selected')) return; e.preventDefault(); const pos = getPos(e);
    const b = $('.block.selected'); b.style.left = (pos.clientX - state.drag.offX) + 'px'; b.style.top = (pos.clientY - state.drag.offY) + 'px';
    const blk = state.currentStory.blocks.find(x => x.id === b.dataset.id);
    if (blk) { blk.x = pos.clientX - state.drag.offX; blk.y = pos.clientY - state.drag.offY; drawLines(); }
  };
  const handleEnd = () => { state.drag.active = false; };
  cv.addEventListener('mousedown', handleStart); document.addEventListener('mousemove', handleMove); document.addEventListener('mouseup', handleEnd);
  cv.addEventListener('touchstart', handleStart, { passive: false }); document.addEventListener('touchmove', handleMove, { passive: false }); document.addEventListener('touchend', handleEnd);
}

function drawBlocks() {
  const cv = $('#editor-canvas'); cv.querySelectorAll('.block').forEach(b=>b.remove());
  state.currentStory.blocks.forEach(b => {
    const el = document.createElement('div'); el.className='block'; el.dataset.id=b.id;
    el.style.left=b.x+'px'; el.style.top=b.y+'px';
    el.innerHTML = `<span class="block-id" onclick="copyToClipboard('${b.id}')">#${b.id.substr(0,6)}</span><div class="type-badge">${b.isStart?'СТАРТ':'БЛОК'}</div>${b.text?.substr(0,35)}...`;
    const p = document.createElement('div'); p.className='conn-point';
    p.onclick = (e) => { e.stopPropagation(); createChoice(b.id); }; p.ontouchend = (e) => { e.stopPropagation(); e.preventDefault(); createChoice(b.id); };
    el.appendChild(p); el.onclick = (e)=>{ if(!e.target.classList.contains('conn-point') && !e.target.classList.contains('block-id')) selectBlock(b.id); };
    cv.appendChild(el);
  }); drawLines();
}

function drawLines() {
  const svg = $('#connections'); svg.querySelectorAll('path').forEach(p=>p.remove());
  state.currentStory.blocks.forEach(b => {
    (b.choices||[]).forEach((ch, i) => {
      const from = document.querySelector(`.block[data-id="${b.id}"]`); const to = document.querySelector(`.block[data-id="${ch.nextId}"]`);
      if(!from || !to) return;
      const x1=from.offsetLeft+from.offsetWidth, y1=from.offsetTop+from.offsetHeight/2;
      const x2=to.offsetLeft, y2=to.offsetTop+to.offsetHeight/2;
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d',`M${x1} ${y1} C${x1+50} ${y1}, ${x2-50} ${y2}, ${x2} ${y2}`);
      svg.appendChild(path);
    });
  });
}

function selectBlock(id) {
  $$('.block').forEach(b=>b.classList.remove('selected'));
  document.querySelector(`.block[data-id="${id}"]`)?.classList.add('selected');
  state.selectedBlock = state.currentStory.blocks.find(x=>x.id===id);
  $('#prop-form').classList.remove('hidden'); $('#block-actions').classList.remove('hidden'); renderBlockProps();
}

function renderBlockProps() {
  const b = state.selectedBlock; if(!b) return;
  const f = $('#prop-form');
  const charsOpt = state.data.characters.map(c=>`<option value="${c.id}" ${b.charId===c.id?'selected':''}>${c.name}</option>`).join('');
  const blocksOpt = state.currentStory.blocks.map(bl=>`<option value="${bl.id}" ${b.nextId===bl.id?'selected':''}>#${bl.id.substr(0,6)} (${bl.text?.substr(0,10)}...)</option>`).join('');
  const varsOpt = state.data.variables.map(v=>`<option value="${v.name}">${v.name}</option>`).join('');
  
  let choicesHtml = (b.choices||[]).map((ch,i)=>{
    const varRows = (ch.vars||[]).map((vm,j)=>`
      <div class="var-row">
        <select onchange="updateChoiceVar('${b.id}',${i},${j},'name',this.value)"><option value="">Переменная...</option>${varsOpt}</select>
        <select onchange="updateChoiceVar('${b.id}',${i},${j},'op',this.value)">
          <option value="=" ${vm.op==='='?'selected':''}>=</option><option value="+" ${vm.op==='+'?'selected':''}>+</option>
          <option value="-" ${vm.op==='-'?'selected':''}>-</option><option value="*" ${vm.op==='*'?'selected':''}>*</option>
          <option value="/" ${vm.op==='/'?'selected':''}>/</option>
        </select>
        <input type="text" placeholder="Формула (напр. gold+5 или min(100,hp))" value="${vm.formula||vm.val||0}" onchange="updateChoiceVar('${b.id}',${i},${j},'formula',this.value)">
        <button class="btn-small btn-danger" onclick="removeChoiceVar('${b.id}',${i},${j})">✕</button>
      </div>
    `).join('');
    return `<div class="choice-row">
      <input placeholder="Текст выбора" value="${ch.text}" onchange="updateChoice('${b.id}',${i},'text',this.value)">
      <select onchange="updateChoice('${b.id}',${i},'nextId',this.value)"><option value="">Куда ведёт...</option>${blocksOpt}</select>
      <input placeholder="Условие (напр. Ку>0)" value="${ch.condition||''}" onchange="updateChoice('${b.id}',${i},'condition',this.value)">
      <div style="margin:4px 0"><small>Переменные (формулы):</small></div>
      ${varRows}
      <button class="btn-small btn-success" style="margin:4px 0" onclick="addChoiceVar('${b.id}',${i})">+ Переменная</button>
      <button class="btn-small btn-danger" style="margin:4px 0" onclick="removeChoice('${b.id}',${i})">Удалить выбор</button>
    </div>`;
  }).join('');

  const ct = ensureCT(b);
  const logicRow = ct.compound ? `<div class="cond-row"><select onchange="updateCT('${b.id}','logic',this.value)"><option value="AND" ${ct.logic==='AND'?'selected':''}>И</option><option value="OR" ${ct.logic==='OR'?'selected':''}>ИЛИ</option></select></div>` : '';
  const cond2Row = ct.compound ? `
    <div class="cond-row">
      <select onchange="updateCTCond2('${b.id}','var',this.value)"><option value="">Переменная...</option>${varsOpt}</select>
      <select onchange="updateCTCond2('${b.id}','op',this.value)"><option value=">" ${ct.cond2.op==='>'?'selected':''}>></option><option value="<" ${ct.cond2.op==='<'?'selected':''}><</option><option value="=" ${ct.cond2.op==='='?'selected':''}>=</option><option value=">=" ${ct.cond2.op==='>='?'selected':''}>=</option><option value="<=" ${ct.cond2.op==='<='?'selected':''}<=</option><option value="!=" ${ct.cond2.op==='!='?'selected':''}≠</option></select>
      <input type="text" placeholder="Число или переменная" value="${ct.cond2.val2}" onchange="updateCTCond2('${b.id}','val2',this.value)">
      <label style="font-size:0.8em;cursor:pointer"><input type="checkbox" ${ct.cond2.valIsVar?'checked':''} onchange="updateCTCond2('${b.id}','valIsVar',this.checked)">= Переменная</label>
    </div>` : '';

  f.innerHTML = `
    <div class="row"><span style="font-family:monospace;color:var(--accent);cursor:pointer" onclick="copyToClipboard('${b.id}')">#${b.id} 📋</span></div>
    <label>Персонаж: <select id="bp-char"><option value="">Нет</option>${charsOpt}</select></label>
    <textarea id="bp-text" placeholder="Текст блока...">${b.text||''}</textarea>
    <input id="bp-bg" placeholder="Путь к фону" value="${b.background||''}">
    
    <div class="section-title">⏱ Автопереход (кат-сцены)</div>
    <input type="number" id="bp-auto" placeholder="Секунды (0 = вручную)" min="0" max="60" value="${b.autoTransition||0}">
    <small style="color:#666">Если >0, кнопка Далее не появится, переход автоматический.</small>

    <div class="section-title">🔀 Условный переход (без выборов)</div>
    <label><input type="checkbox" id="bp-ct-en" ${ct.enabled?'checked':''} onchange="toggleCT('${b.id}', this.checked)"> Включить условный переход</label>
    <div class="cond-row" style="${ct.enabled ? '' : 'display:none'}">
      <select onchange="updateCTCond1('${b.id}','var',this.value)"><option value="">Переменная...</option>${varsOpt}</select>
      <select onchange="updateCTCond1('${b.id}','op',this.value)"><option value=">" ${ct.cond1.op==='>'?'selected':''}>></option><option value="<" ${ct.cond1.op==='<'?'selected':''}><</option><option value="=" ${ct.cond1.op==='='?'selected':''}>=</option><option value=">=" ${ct.cond1.op==='>='?'selected':''}>=</option><option value="<=" ${ct.cond1.op==='<='?'selected':''}<=</option><option value="!=" ${ct.cond1.op==='!='?'selected':''}≠</option></select>
      <input type="text" placeholder="Число/Перем." value="${ct.cond1.val2}" onchange="updateCTCond1('${b.id}','val2',this.value)">
      <label style="font-size:0.8em;cursor:pointer"><input type="checkbox" ${ct.cond1.valIsVar?'checked':''} onchange="updateCTCond1('${b.id}','valIsVar',this.checked)">= Переменная</label>
    </div>
    <label style="${ct.enabled?'':'display:none'}"><input type="checkbox" id="bp-ct-comp" ${ct.compound?'checked':''} onchange="toggleCTComp('${b.id}', this.checked)"> Составное условие (И/ИЛИ)</label>
    ${logicRow}${cond2Row}
    <div class="cond-row" style="${ct.enabled?'':'display:none'}">
      <span style="font-size:0.8em">Если Истина:</span>
      <select onchange="updateCT('${b.id}','nextTrue',this.value)"><option value="">Блок...</option>${blocksOpt}</select>
      <span style="font-size:0.8em">Если Ложь:</span>
      <select onchange="updateCT('${b.id}','nextFalse',this.value)"><option value="">Блок...</option>${blocksOpt}</select>
    </div>

    <div class="section-title">⚙️ Стандартные параметры</div>
    <div class="row">
      <input type="number" id="bp-delay" placeholder="Задержка кнопки (с)" value="${b.delay||0}">
      <input type="number" id="bp-timeout" placeholder="Таймер выбора (с)" value="${b.choiceTimeout||''}">
    </div>
    <select id="bp-effect"><option value="">Без эффекта</option><option value="shake" ${b.effect==='shake'?'selected':''}>Тряска</option><option value="flash" ${b.effect==='flash'?'selected':''}>Вспышка</option></select>
    <label>Следующий блок (стандартный): <select id="bp-next"><option value="">Нет</option>${blocksOpt}</select></label>
    
    <hr><div class="section-title">📊 Переменные блока (формулы)</div>
    ${(b.vars||[]).map((vm,j)=>`
      <div class="var-row">
        <select onchange="updateBlockVar(${j},'name',this.value)"><option value="">Переменная...</option>${varsOpt}</select>
        <select onchange="updateBlockVar(${j},'op',this.value)"><option value="=" ${vm.op==='='?'selected':''}>=</option><option value="+" ${vm.op==='+'?'selected':''}>+</option><option value="-" ${vm.op==='-'?'selected':''}>-</option><option value="*" ${vm.op==='*'?'selected':''}>*</option><option value="/" ${vm.op==='/'?'selected':''}>/</option></select>
        <input type="text" placeholder="Формула" value="${vm.formula||vm.val||0}" onchange="updateBlockVar(${j},'formula',this.value)">
        <button class="btn-small btn-danger" onclick="removeBlockVar(${j})">✕</button>
      </div>
    `).join('')}
    <button class="btn-small btn-success" onclick="addBlockVar()">+ Переменная</button>
    
    <hr><div class="row"><span>Выборы:</span> <button class="btn-small btn-success" onclick="addChoice()">+</button></div>
    <div id="choices-list">${choicesHtml}</div>
  `;
  
  f.onchange = () => {
    b.charId=$('#bp-char').value; b.text=$('#bp-text').value; b.background=$('#bp-bg').value;
    b.delay=toNum($('#bp-delay').value); b.choiceTimeout=toNum($('#bp-timeout').value);
    b.effect=$('#bp-effect').value; b.nextId=$('#bp-next').value;
    b.autoTransition = toNum($('#bp-auto').value);
    drawLines();
  };
}

// CT Helpers
window.toggleCT = (id, val) => { ensureCT(state.currentStory.blocks.find(x=>x.id===id)).enabled = !!val; renderBlockProps(); };
window.toggleCTComp = (id, val) => { ensureCT(state.currentStory.blocks.find(x=>x.id===id)).compound = !!val; renderBlockProps(); };
window.updateCT = (id, k, v) => { ensureCT(state.currentStory.blocks.find(x=>x.id===id))[k] = v; renderBlockProps(); };
window.updateCTCond1 = (id, k, v) => { const ct = ensureCT(state.currentStory.blocks.find(x=>x.id===id)); ct.cond1[k] = v; renderBlockProps(); };
window.updateCTCond2 = (id, k, v) => { const ct = ensureCT(state.currentStory.blocks.find(x=>x.id===id)); ct.cond2[k] = v; renderBlockProps(); };

// Var/Choice Helpers
window.addBlockVar = () => { if(!state.selectedBlock.vars) state.selectedBlock.vars=[]; state.selectedBlock.vars.push({name:'',op:'+',formula:'0'}); renderBlockProps(); };
window.updateBlockVar = (i, k, v) => { state.selectedBlock.vars[i][k]= v; };
window.removeBlockVar = i => { state.selectedBlock.vars.splice(i,1); renderBlockProps(); };

window.addChoice = () => { if(!state.selectedBlock.choices) state.selectedBlock.choices=[]; state.selectedBlock.choices.push({text:'Выбор', nextId:'', condition:'', vars:[]}); renderBlockProps(); drawLines(); };
window.updateChoice = (bId, i, k, v) => { const b=state.currentStory.blocks.find(x=>x.id===bId); b.choices[i][k]=v; drawLines(); };
window.addChoiceVar = (bId, i) => { const b=state.currentStory.blocks.find(x=>x.id===bId); if(!b.choices[i].vars) b.choices[i].vars=[]; b.choices[i].vars.push({name:'',op:'+',formula:'0'}); renderBlockProps(); };
window.updateChoiceVar = (bId, i, j, k, v) => { const b=state.currentStory.blocks.find(x=>x.id===bId); b.choices[i].vars[j][k]=v; };
window.removeChoiceVar = (bId, i, j) => { const b=state.currentStory.blocks.find(x=>x.id===bId); b.choices[i].vars.splice(j,1); renderBlockProps(); };
window.removeChoice = (bId, i) => { state.currentStory.blocks.find(x=>x.id===bId).choices.splice(i,1); renderBlockProps(); drawLines(); };
window.createChoice = bId => { alert('Кликни на блок, выбери "+" в свойствах справа и укажи следующий блок из списка.'); };

window.deleteBlock = () => { if(!state.selectedBlock)return; state.currentStory.blocks=state.currentStory.blocks.filter(x=>x.id!==state.selectedBlock.id); state.selectedBlock=null; drawBlocks(); $('#prop-form').innerHTML='<h3>Выбери блок</h3>'; $('#block-actions').classList.add('hidden'); saveData(); };
$('#delete-block-btn').onclick = window.deleteBlock;
$('#add-block-btn').onclick = () => {
  const id = uid();
  const b = {id, x:400+Math.random()*50, y:200+Math.random()*50, text:'Новый блок', choices:[], vars:[], autoTransition:0};
  ensureCT(b);
  state.currentStory.blocks.push(b); drawBlocks(); selectBlock(id); saveData();
};
$('#preview-btn').onclick = () => { saveData(); startGame(state.currentStory.id, true); };

// ================= INIT =================
init();
