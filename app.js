// ================= CONFIG & STATE =================
const CONFIG = { PASS: '1234', SAVE_KEY: 'storyEngine', DATA_KEY: 'storyData' };
const state = {
  mode: 'menu', theme: 'light', isPreview: false,
  data: { variables: [], characters: [], audioTracks: [], randomEvents: [], stories: [] },
  currentStory: null, currentBlock: null, vars: {},
  visitedRandom: new Set(), randomQueue: [], isProcessing: false,
  audio: null, timer: null, selectedBlock: null, drag: { active: false }
};

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const uid = () => Math.random().toString(36).substr(2,9);
const toNum = v => isNaN(v) ? 0 : Number(v);

// ================= UTILS =================
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
  if (!state.data.variables) state.data.variables = [];
  if (!state.data.audioTracks) state.data.audioTracks = [];
  if (!state.data.randomEvents) state.data.randomEvents = [];
  if (!state.data.stories) state.data.stories = [];
  if (!state.data.characters) state.data.characters = [];
}
function saveData() { localStorage.setItem(CONFIG.DATA_KEY, JSON.stringify(state.data)); }

function exportJSON() {
  const b = new Blob([JSON.stringify(state.data, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download='story_data.json'; a.click();
}
function importJSON(file) {
  const r = new FileReader();
  r.onload = e => { 
    state.data = JSON.parse(e.target.result); 
    // Гарантируем наличие всех массивов после импорта
    if(!state.data.variables) state.data.variables = [];
    if(!state.data.audioTracks) state.data.audioTracks = [];
    if(!state.data.randomEvents) state.data.randomEvents = [];
    saveData(); renderSidebar(); 
  };
  r.readAsText(file);
}

// ================= UI & NAVIGATION =================
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.add('hidden'));
  $(`#${id}`).classList.remove('hidden');
}

function init() {
  loadData();
  showScreen('main-menu');
  
  $('#btn-play').onclick = () => { renderStoryList(); showScreen('story-list-screen'); };
  $('#btn-create').onclick = () => { $('#pass-modal').classList.add('open'); $('#admin-pass-input').value = ''; $('#admin-pass-input').focus(); };
  $('#btn-back-menu').onclick = () => showScreen('main-menu');
  
  $('#g-exit-btn').onclick = () => { stopAudio(); state.mode='menu'; showScreen('main-menu'); };
  $('#g-back-admin-btn').onclick = () => { stopAudio(); state.mode='admin'; $('#game-screen').classList.add('hidden'); $('#admin-panel').classList.remove('hidden'); drawBlocks(); };
  $('#g-save-btn').onclick = saveGame;
  $('#g-load-btn').onclick = loadGame;
  
  $('#cancel-pass').onclick = () => $('#pass-modal').classList.remove('open');
  $('#submit-pass').onclick = () => {
    if ($('#admin-pass-input').value === CONFIG.PASS) {
      $('#pass-modal').classList.remove('open');
      enterAdmin();
    } else alert('❌ Неверный код');
  };
  
  $('#toggle-theme').onclick = () => {
    state.theme = state.theme==='light'?'dark':'light';
    document.documentElement.dataset.theme = state.theme;
  };
  $('#export-btn').onclick = exportJSON;
  $('#import-btn').onclick = () => $('#import-input').click();
  $('#import-input').onchange = e => importJSON(e.target.files[0]);
  $('#logout-btn').onclick = () => location.reload();
  
  setupTabs();
  setupCanvas();
  setupProps();
}

function renderStoryList() {
  const c = $('#stories-container'); c.innerHTML = '';
  if (state.data.stories.length === 0) {
    c.innerHTML = '<p style="color:#666;margin:20px 0">Сюжетов пока нет. Создайте первый в редакторе.</p>';
    return;
  }
  state.data.stories.forEach(s => {
    const d = document.createElement('div');
    d.className = 'story-item';
    d.innerHTML = `<span>📖 ${s.title} <small style="color:#888">(${s.blocks.length} блоков)</small></span>`;
    d.onclick = () => startGame(s.id, false);
    c.appendChild(d);
  });
}

// ================= GAME ENGINE =================
function startGame(storyId, isPreview = false) {
  state.currentStory = state.data.stories.find(s=>s.id===storyId);
  if (!state.currentStory) return alert('Сюжет не найден');
  state.isPreview = isPreview;
  state.vars = {};
  state.data.variables.forEach(v => state.vars[v.name] = toNum(v.defaultValue));
  state.visitedRandom = new Set(); state.randomQueue = []; state.isProcessing = false;
  state.mode = isPreview ? 'preview' : 'game';
  
  $('#g-back-admin-btn').classList.toggle('hidden', !isPreview);
  $('#g-save-btn, #g-load-btn, #g-exit-btn').style.display = isPreview ? 'none' : 'flex';
  
  showScreen('game-screen');
  const first = state.currentStory.blocks.find(b=>b.isStart);
  renderBlock(first?.id);
}

function renderBlock(blockId) {
  if (!blockId) return;
  const b = state.currentStory.blocks.find(x=>x.id===blockId);
  if (!b) return;
  state.currentBlock = b;
  const fade = $('#fade-overlay'); fade.classList.add('active');
  
  setTimeout(() => {
    $('#bg-layer').style.backgroundImage = b.background ? `url('${b.background}')` : '';
    $('#bg-layer').classList.toggle('active', !!b.background);
    const cl = $('#char-layer'); cl.innerHTML = '';
    if (b.charId) {
      const ch = state.data.characters.find(c=>c.id===b.charId);
      if (ch) {
        const d = document.createElement('div');
        d.className = `character ${ch.isMain?'right':'left'}`;
        d.innerHTML = `<img src="${ch.photo}" alt="${ch.name}">`;
        cl.appendChild(d); requestAnimationFrame(()=>d.classList.add('show'));
      }
    }
    
    const dlg = $('#dialogue-box');
    $('#g-char-name').textContent = b.charId ? state.data.characters.find(c=>c.id===b.charId).name : '';
    $('#g-text').innerHTML = formatText(b.text || '');
    dlg.classList.remove('active');
    
    const chC = $('#choices-container'), nxt = $('#g-next-btn'), tmr = $('#timer-bar');
    chC.innerHTML = ''; nxt.classList.add('hidden'); tmr.classList.add('hidden');
    if (state.timer) clearTimeout(state.timer);
    
    dlg.classList.add('active');
    
    if (b.choices?.length) {
      b.choices.forEach((ch, i) => {
        if (ch.condition && !isConditionMet(ch.condition)) return;
        const btn = document.createElement('button');
        btn.className = 'choice-btn'; btn.textContent = ch.text;
        btn.onclick = () => handleChoice(ch);
        chC.appendChild(btn);
      });
      if (b.choiceTimeout) {
        tmr.classList.remove('hidden');
        let t = b.choiceTimeout; const fill = $('#timer-fill'); fill.style.width='100%';
        const iv = setInterval(()=>{ 
          t-=0.1; fill.style.width=`${(t/b.choiceTimeout)*100}%`; 
          if(t<=0){clearInterval(iv); if(chC.firstChild) chC.firstChild.click();}
        }, 100);
      }
    } else {
      if (b.delay > 0) {
        tmr.classList.remove('hidden');
        let t = b.delay; const fill = $('#timer-fill'); fill.style.width='100%';
        const iv = setInterval(()=>{ 
          t-=0.1; fill.style.width=`${(t/b.delay)*100}%`; 
          if(t<=0){clearInterval(iv); tmr.classList.add('hidden'); nxt.classList.remove('hidden');}
        }, 100);
      } else {
        nxt.classList.remove('hidden');
      }
      nxt.onclick = () => { nxt.classList.add('hidden'); goToNext(); };
    }
    
    playAudio(b.id); applyEffect(b.effect);
    fade.classList.remove('active');
    checkRandom(b);
  }, 500);
}

function isConditionMet(cond) { 
  // Простая проверка условий: если в строке есть >, <, =, проверяем значение
  const match = cond.match(/([a-zA-Z_]\w*)\s*([><=!]+)\s*(-?\d+)/);
  if (!match) return false;
  const val = state.vars[match[1]] || 0;
  const target = parseFloat(match[3]);
  const op = match[2];
  if (op.includes('>')) return val > target;
  if (op.includes('<')) return val < target;
  if (op.includes('=')) return val === target;
  return false;
}

function handleChoice(ch) {
  if (ch.vars) {
    for (const vMod of ch.vars) {
      const val = toNum(vMod.val); // Теперь просто число
      if (!state.vars[vMod.name]) state.vars[vMod.name] = 0;
      if (vMod.op === '=') state.vars[vMod.name] = val;
      else if (vMod.op === '+') state.vars[vMod.name] += val;
      else if (vMod.op === '-') state.vars[vMod.name] -= val;
      else if (vMod.op === '*') state.vars[vMod.name] *= val;
      else if (vMod.op === '/') state.vars[vMod.name] = val !== 0 ? state.vars[vMod.name] / val : 0;
    }
  }
  renderBlock(ch.nextId);
}

function goToNext() {
  if (state.currentBlock.vars) {
    for (const vMod of state.currentBlock.vars) {
      const val = toNum(vMod.val);
      if (!state.vars[vMod.name]) state.vars[vMod.name] = 0;
      if (vMod.op === '=') state.vars[vMod.name] = val;
      else if (vMod.op === '+') state.vars[vMod.name] += val;
      else if (vMod.op === '-') state.vars[vMod.name] -= val;
      else if (vMod.op === '*') state.vars[vMod.name] *= val;
      else if (vMod.op === '/') state.vars[vMod.name] = val !== 0 ? state.vars[vMod.name] / val : 0;
    }
  }
  if (state.currentBlock.nextId) renderBlock(state.currentBlock.nextId);
}

function applyEffect(type) {
  const g = $('#game-screen'); g.classList.remove('shake','flash');
  if(!type) return; void g.offsetWidth; g.classList.add(type);
}

function playAudio(bId) {
  // Ищем трек, чьи диапазоны включают текущий блок
  let target = state.data.audioTracks.find(t => t.ranges && t.ranges.includes(bId));
  if (target) {
    // Если трек ещё не загружен или это другой файл - меняем
    if (!state.audio || state.audio.src !== target.src) {
      if (state.audio) { state.audio.pause(); state.audio.src = ''; }
      state.audio = new Audio(target.src);
      state.audio.loop = true; // Зацикливается только когда файл заканчивается
      state.audio.volume = toNum(target.volume);
      state.audio.play().catch(()=>{});
    }
  } else if (state.audio && !state.audio.paused) {
    state.audio.pause(); state.audio.src = ''; state.audio = null;
  }
}
function stopAudio() { if(state.audio){state.audio.pause(); state.audio=null;} }

function checkRandom(b) {
  if (state.isProcessing) return;
  state.isProcessing = true;
  const triggers = state.data.randomEvents.filter(e => e.triggerIds.includes(b.id) && !state.visitedRandom.has(e.id));
  if (!triggers.length) { state.isProcessing = false; return; }
  
  triggers.forEach(e => {
    // Шанс берётся из значения выбранной переменной
    const chanceVal = state.vars[e.chanceVar] || 0;
    const chance = Math.max(0, Math.min(100, toNum(chanceVal)));
    if (Math.random() * 100 < chance) {
      state.randomQueue.push(e);
    }
  });
  processQueue();
}

function processQueue() {
  if (state.randomQueue.length===0) { state.isProcessing = false; return; }
  const ev = state.randomQueue.shift();
  state.visitedRandom.add(ev.id);
  renderBlock(ev.startId);
}

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
function enterAdmin() {
  state.mode = 'admin'; showScreen('admin-panel'); renderSidebar();
}
function setupTabs() {
  $$('.tab').forEach(t => t.onclick = () => {
    $$('.tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
    renderSidebar();
  });
}
function renderSidebar() {
  const tab = $('.tab.active').dataset.tab, list = $('#sidebar-list'); list.innerHTML='';
  if(tab==='vars') {
    state.data.variables.forEach(v => {
      const d = document.createElement('div'); d.className='list-item';
      d.innerHTML = `<span>${v.name} <small style="color:#666">=${v.defaultValue}</small></span>`;
      d.onclick = () => renderVarForm(v); list.appendChild(d);
    });
    const add = document.createElement('button'); add.textContent='+ Переменная'; add.className='btn-success'; add.style.margin='10px 0';
    add.onclick = () => renderVarForm(null); list.appendChild(add);
  } else if(tab==='chars') {
    state.data.characters.forEach(c => {
      const d = document.createElement('div'); d.className='list-item';
      d.innerHTML = `<span>${c.name} ${c.isMain?'⭐':''}</span>`;
      d.onclick = () => renderCharForm(c); list.appendChild(d);
    });
    const add = document.createElement('button'); add.textContent='+ Персонаж'; add.className='btn-success'; add.style.margin='10px 0';
    add.onclick = () => renderCharForm(null); list.appendChild(add);
  } else if(tab==='audio') {
    state.data.audioTracks.forEach(a => {
      const d = document.createElement('div'); d.className='list-item';
      d.innerHTML = `<span>🎵 ${a.name} <small style="color:#888">(${a.ranges.length} блоков)</small></span>`;
      d.onclick = () => renderAudioForm(a); list.appendChild(d);
    });
    const add = document.createElement('button'); add.textContent='+ Музыка/Звук'; add.className='btn-success'; add.style.margin='10px 0';
    add.onclick = () => renderAudioForm(null); list.appendChild(add);
  } else if(tab==='events') {
    state.data.randomEvents.forEach(e => {
      const d = document.createElement('div'); d.className='list-item';
      d.innerHTML = `<span>🎲 ${e.name} <small style="color:#888">(${e.triggerIds.length} триггеров)</small></span>`;
      d.onclick = () => renderEventForm(e); list.appendChild(d);
    });
    const add = document.createElement('button'); add.textContent='+ Ранд. событие'; add.className='btn-success'; add.style.margin='10px 0';
    add.onclick = () => renderEventForm(null); list.appendChild(add);
  } else if(tab==='stories') {
    state.data.stories.forEach(s => {
      const d = document.createElement('div'); d.className='list-item';
      d.textContent = s.title; d.onclick = () => { state.currentStory=s; drawBlocks(); };
      list.appendChild(d);
    });
    const add = document.createElement('button'); add.textContent='+ Создать историю'; add.className='btn-success'; add.style.margin='10px 0';
    add.onclick = () => createStory(); list.appendChild(add);
  }
}

// --- VARIABLES ---
function renderVarForm(v) {
  v = v || { id:uid(), name:'', defaultValue:0 };
  const f = $('#prop-form'); f.classList.remove('hidden'); $('#block-actions').classList.add('hidden');
  f.innerHTML = `
    <input id="vf-name" placeholder="Имя (лат/рус, без пробелов)" value="${v.name}">
    <input type="number" id="vf-def" placeholder="Начальное значение" value="${v.defaultValue}">
    <button onclick="saveVar('${v.id}')">Сохранить</button>
    ${state.data.variables.find(x=>x.id===v.id)?`<button class="btn-danger" onclick="deleteVar('${v.id}')">Удалить</button>`:''}
  `;
}
window.saveVar = id => {
  const d = state.data.variables.find(x=>x.id===id);
  const name = $('#vf-name').value.replace(/\s/g,'_');
  if(!name) return alert('Введите имя');
  if(d) { d.name=name; d.defaultValue=toNum($('#vf-def').value); }
  else state.data.variables.push({id, name, defaultValue:toNum($('#vf-def').value)});
  saveData(); renderSidebar();
};
window.deleteVar = id => { state.data.variables=state.data.variables.filter(x=>x.id!==id); saveData(); renderSidebar(); };

// --- CHARACTERS ---
function renderCharForm(c) {
  c = c || { id:uid(), name:'', photo:'', isMain:false };
  const f = $('#prop-form'); f.classList.remove('hidden'); $('#block-actions').classList.add('hidden');
  f.innerHTML = `
    <input id="cf-name" placeholder="Имя" value="${c.name}">
    <input id="cf-photo" placeholder="Путь к фото (assets/...)" value="${c.photo}">
    <label><input type="checkbox" id="cf-main" ${c.isMain?'checked':''}> Главный (справа)</label>
    <button onclick="saveChar('${c.id}')">Сохранить</button>
    ${state.data.characters.find(x=>x.id===c.id)?`<button class="btn-danger" onclick="deleteChar('${c.id}')">Удалить</button>`:''}
  `;
}
window.saveChar = id => {
  const d = state.data.characters.find(x=>x.id===id);
  if(d) { d.name=$('#cf-name').value; d.photo=$('#cf-photo').value; d.isMain=$('#cf-main').checked; }
  else state.data.characters.push({id, name:$('#cf-name').value, photo:$('#cf-photo').value, isMain:$('#cf-main').checked});
  saveData(); renderSidebar();
};
window.deleteChar = id => { state.data.characters=state.data.characters.filter(x=>x.id!==id); saveData(); renderSidebar(); };

// --- AUDIO ---
function renderAudioForm(a) {
  a = a || { id:uid(), name:'', src:'', volume:0.5, ranges:[] };
  const f = $('#prop-form'); f.classList.remove('hidden'); $('#block-actions').classList.add('hidden');
  
  f.innerHTML = `
    <input id="af-name" placeholder="Название трека" value="${a.name}">
    <input id="af-src" placeholder="Путь (assets/audio/...)" value="${a.src}">
    <input type="number" id="af-vol" placeholder="Громкость (0.0 - 1.0)" value="${a.volume}" step="0.1">
    <small style="color:#666">0.5 = 50% громкости</small>
    <input id="af-blocks" placeholder="ID блоков через запятую" value="${a.ranges.join(', ')}">
    <small style="color:#666">Музыка будет играть непрерывно в указанных блоках</small>
    <button onclick="saveAudio('${a.id}')" style="margin-top:8px">Сохранить</button>
    ${state.data.audioTracks.find(x=>x.id===a.id)?`<button class="btn-danger" onclick="deleteAudio('${a.id}')">Удалить</button>`:''}
  `;
}
window.saveAudio = id => {
  const d = state.data.audioTracks.find(x=>x.id===id);
  const ranges = $('#af-blocks').value.split(',').map(s=>s.trim()).filter(s=>s);
  if(d) { d.name=$('#af-name').value; d.src=$('#af-src').value; d.volume=toNum($('#af-vol').value); d.ranges=ranges; }
  else state.data.audioTracks.push({id, name:$('#af-name').value, src:$('#af-src').value, volume:toNum($('#af-vol').value), ranges});
  saveData(); renderSidebar();
};
window.deleteAudio = id => { state.data.audioTracks=state.data.audioTracks.filter(x=>x.id!==id); saveData(); renderSidebar(); };

// --- RANDOM EVENTS ---
function renderEventForm(e) {
  e = e || { id:uid(), name:'', chanceVar:'', triggerIds:[], startId:'' };
  const f = $('#prop-form'); f.classList.remove('hidden'); $('#block-actions').classList.add('hidden');
  const varOpts = state.data.variables.map(v => `<option value="${v.name}" ${e.chanceVar===v.name?'selected':''}>${v.name}</option>`).join('');
  const blocksOpt = state.currentStory?.blocks.map(bl=>`<option value="${bl.id}" ${e.startId===bl.id?'selected':''}>#${bl.id.substr(0,6)}</option>`).join('') || '<option>Сначала откройте историю</option>';

  f.innerHTML = `
    <input id="ef-name" placeholder="Название события" value="${e.name}">
    <label>Переменная для шанса:
      <select id="ef-chance-var"><option value="">Выбери переменную...</option>${varOpts}</select>
    </label>
    <small style="color:#666">Значение этой переменной = % вероятность срабатывания</small>
    <textarea id="ef-triggers" placeholder="ID блоков-триггеров (через запятую)">${e.triggerIds.join(', ')}</textarea>
    <select id="ef-start">
      <option value="">Куда ведёт событие...</option>
      ${blocksOpt}
    </select>
    <button onclick="saveEvent('${e.id}')" style="margin-top:8px">Сохранить</button>
    ${state.data.randomEvents.find(x=>x.id===e.id)?`<button class="btn-danger" onclick="deleteEvent('${e.id}')">Удалить</button>`:''}
  `;
}
window.saveEvent = id => {
  const d = state.data.randomEvents.find(x=>x.id===id);
  const triggers = $('#ef-triggers').value.split(',').map(s=>s.trim()).filter(s=>s);
  const chanceVar = $('#ef-chance-var').value;
  if(d) { d.name=$('#ef-name').value; d.chanceVar=chanceVar; d.triggerIds=triggers; d.startId=$('#ef-start').value; }
  else state.data.randomEvents.push({id, name:$('#ef-name').value, chanceVar, triggerIds:triggers, startId:$('#ef-start').value});
  saveData(); renderSidebar();
};
window.deleteEvent = id => { state.data.randomEvents=state.data.randomEvents.filter(x=>x.id!==id); saveData(); renderSidebar(); };

// --- STORIES ---
function createStory() {
  const title = prompt('Название истории:'); if(!title) return;
  const s = { id:uid(), title, blocks:[{id:uid(), isStart:true, x:300, y:300, text:'Начало...', choices:[], vars:[]}], defaultVars:{} };
  state.data.stories.push(s); state.currentStory=s; saveData(); renderSidebar(); drawBlocks();
}

// Canvas & Blocks (Touch + Mouse)
function setupCanvas() {
  const cv = $('#editor-canvas');
  const getPos = (e) => e.touches ? e.touches[0] : e;
  
  const handleStart = (e) => {
    const target = e.target.closest('.block');
    if (!target) return;
    if (e.target.classList.contains('conn-point') || e.target.classList.contains('block-id')) return;
    e.preventDefault(); 
    const id = target.dataset.id; selectBlock(id);
    const pos = getPos(e);
    state.drag.active = true; state.drag.offX = pos.clientX - target.offsetLeft; state.drag.offY = pos.clientY - target.offsetTop;
  };
  const handleMove = (e) => {
    if (!state.drag.active || !$('.block.selected')) return;
    e.preventDefault(); const pos = getPos(e);
    const b = $('.block.selected'); b.style.left = (pos.clientX - state.drag.offX) + 'px'; b.style.top = (pos.clientY - state.drag.offY) + 'px';
    const blk = state.currentStory.blocks.find(x => x.id === b.dataset.id);
    if (blk) { blk.x = pos.clientX - state.drag.offX; blk.y = pos.clientY - state.drag.offY; drawLines(); }
  };
  const handleEnd = () => { state.drag.active = false; };

  cv.addEventListener('mousedown', handleStart);
  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleEnd);
  cv.addEventListener('touchstart', handleStart, { passive: false });
  document.addEventListener('touchmove', handleMove, { passive: false });
  document.addEventListener('touchend', handleEnd);
}

function drawBlocks() {
  const cv = $('#editor-canvas');
  cv.querySelectorAll('.block').forEach(b=>b.remove());
  state.currentStory.blocks.forEach(b => {
    const el = document.createElement('div'); el.className='block'; el.dataset.id=b.id;
    el.style.left=b.x+'px'; el.style.top=b.y+'px';
    el.innerHTML = `
      <span class="block-id" onclick="copyToClipboard('${b.id}')" title="Кликни, чтобы скопировать">#${b.id.substr(0,6)}</span>
      <div class="type-badge">${b.isStart?'СТАРТ':'БЛОК'}</div>
      ${b.text?.substr(0,35)}...
    `;
    const p = document.createElement('div'); p.className='conn-point';
    p.onclick = (e) => { e.stopPropagation(); createChoice(b.id); };
    p.ontouchend = (e) => { e.stopPropagation(); e.preventDefault(); createChoice(b.id); };
    el.appendChild(p); 
    el.onclick = (e)=>{ if(!e.target.classList.contains('conn-point') && !e.target.classList.contains('block-id')) selectBlock(b.id); };
    cv.appendChild(el);
  });
  drawLines();
}

function drawLines() {
  const svg = $('#connections'); svg.querySelectorAll('path').forEach(p=>p.remove());
  state.currentStory.blocks.forEach(b => {
    (b.choices||[]).forEach((ch, i) => {
      const from = document.querySelector(`.block[data-id="${b.id}"]`);
      const to = document.querySelector(`.block[data-id="${ch.nextId}"]`);
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
  $('#prop-form').classList.remove('hidden'); $('#block-actions').classList.remove('hidden');
  renderBlockProps();
}

function renderBlockProps() {
  const b = state.selectedBlock, f = $('#prop-form');
  const charsOpt = state.data.characters.map(c=>`<option value="${c.id}" ${b.charId===c.id?'selected':''}>${c.name}</option>`).join('');
  const blocksOpt = state.currentStory.blocks.map(bl=>`<option value="${bl.id}" ${b.nextId===bl.id?'selected':''}>#${bl.id.substr(0,6)} (${bl.text?.substr(0,10)}...)</option>`).join('');
  
  let choicesHtml = (b.choices||[]).map((ch,i)=>{
    const varRows = (ch.vars||[]).map((vm,j)=>`
      <div class="var-row">
        <select onchange="updateChoiceVar('${b.id}',${i},${j},'name',this.value)">
          <option value="">Переменная...</option>
          ${state.data.variables.map(v=>`<option value="${v.name}" ${vm.name===v.name?'selected':''}>${v.name}</option>`).join('')}
        </select>
        <select onchange="updateChoiceVar('${b.id}',${i},${j},'op',this.value)">
          <option value="=" ${vm.op==='='?'selected':''}>=</option>
          <option value="+" ${vm.op==='+'?'selected':''}>+</option>
          <option value="-" ${vm.op==='-'?'selected':''}>-</option>
          <option value="*" ${vm.op==='*'?'selected':''}>*</option>
          <option value="/" ${vm.op==='/'?'selected':''}>/</option>
        </select>
        <input type="number" placeholder="Значение" value="${vm.val||0}" onchange="updateChoiceVar('${b.id}',${i},${j},'val',this.value)">
        <button class="btn-small btn-danger" onclick="removeChoiceVar('${b.id}',${i},${j})">✕</button>
      </div>
    `).join('');

    return `<div class="choice-row">
      <input placeholder="Текст выбора" value="${ch.text}" onchange="updateChoice('${b.id}',${i},'text',this.value)">
      <select onchange="updateChoice('${b.id}',${i},'nextId',this.value)">
        <option value="">Куда ведёт...</option>${blocksOpt}
      </select>
      <input placeholder="Условие (напр. gold>50)" value="${ch.condition||''}" onchange="updateChoice('${b.id}',${i},'condition',this.value)">
      <div style="margin:4px 0"><small>Переменные:</small></div>
      ${varRows}
      <button class="btn-small btn-success" style="margin:4px 0" onclick="addChoiceVar('${b.id}',${i})">+ Переменная</button>
      <button class="btn-small btn-danger" style="margin:4px 0" onclick="removeChoice('${b.id}',${i})">Удалить выбор</button>
    </div>`;
  }).join('');

  const blockVarRows = (b.vars||[]).map((vm,j)=>`
      <div class="var-row">
        <select onchange="updateBlockVar(${j},'name',this.value)">
          <option value="">Переменная...</option>
          ${state.data.variables.map(v=>`<option value="${v.name}" ${vm.name===v.name?'selected':''}>${v.name}</option>`).join('')}
        </select>
        <select onchange="updateBlockVar(${j},'op',this.value)">
          <option value="=" ${vm.op==='='?'selected':''}>=</option>
          <option value="+" ${vm.op==='+'?'selected':''}>+</option>
          <option value="-" ${vm.op==='-'?'selected':''}>-</option>
          <option value="*" ${vm.op==='*'?'selected':''}>*</option>
          <option value="/" ${vm.op==='/'?'selected':''}>/</option>
        </select>
        <input type="number" placeholder="Значение" value="${vm.val||0}" onchange="updateBlockVar(${j},'val',this.value)">
        <button class="btn-small btn-danger" onclick="removeBlockVar(${j})">✕</button>
      </div>
    `).join('');

  f.innerHTML = `
    <div class="row"><span style="font-family:monospace;color:var(--accent);cursor:pointer" onclick="copyToClipboard('${b.id}')">#${b.id} 📋</span></div>
    <label>Персонаж: <select id="bp-char"><option value="">Нет</option>${charsOpt}</select></label>
    <textarea id="bp-text" placeholder="Текст блока...">${b.text||''}</textarea>
    <input id="bp-bg" placeholder="Путь к фону (assets/...)" value="${b.background||''}">
    <div class="row">
      <input type="number" id="bp-delay" placeholder="Задержка (с)" value="${b.delay||0}">
      <input type="number" id="bp-timeout" placeholder="Таймер выбора (с)" value="${b.choiceTimeout||''}">
    </div>
    <select id="bp-effect"><option value="">Без эффекта</option><option value="shake" ${b.effect==='shake'?'selected':''}>Тряска</option><option value="flash" ${b.effect==='flash'?'selected':''}>Вспышка</option></select>
    <label>Следующий блок: <select id="bp-next"><option value="">Нет</option>${blocksOpt}</select></label>
    <hr><label>Переменные блока:</label>
    ${blockVarRows}
    <button class="btn-small btn-success" onclick="addBlockVar()">+ Переменная</button>
    <hr><div class="row"><span>Выборы:</span> <button class="btn-small btn-success" onclick="addChoice()">+</button></div>
    <div id="choices-list">${choicesHtml}</div>
  `;
  
  f.onchange = () => {
    b.charId=$('#bp-char').value; b.text=$('#bp-text').value; b.background=$('#bp-bg').value;
    b.delay=toNum($('#bp-delay').value); b.choiceTimeout=toNum($('#bp-timeout').value);
    b.effect=$('#bp-effect').value; b.nextId=$('#bp-next').value;
    drawLines();
  };
}

window.addBlockVar = () => { if(!state.selectedBlock.vars) state.selectedBlock.vars=[]; state.selectedBlock.vars.push({name:'',op:'+',val:0}); renderBlockProps(); };
window.updateBlockVar = (i, k, v) => { state.selectedBlock.vars[i][k]= k==='val' ? toNum(v) : v; };
window.removeBlockVar = i => { state.selectedBlock.vars.splice(i,1); renderBlockProps(); };

window.addChoice = () => { if(!state.selectedBlock.choices) state.selectedBlock.choices=[]; state.selectedBlock.choices.push({text:'Выбор', nextId:'', condition:'', vars:[]}); renderBlockProps(); drawLines(); };
window.updateChoice = (bId, i, k, v) => { const b=state.currentStory.blocks.find(x=>x.id===bId); b.choices[i][k]= k==='val' ? toNum(v) : v; drawLines(); };
window.addChoiceVar = (bId, i) => { const b=state.currentStory.blocks.find(x=>x.id===bId); if(!b.choices[i].vars) b.choices[i].vars=[]; b.choices[i].vars.push({name:'',op:'+',val:0}); renderBlockProps(); };
window.updateChoiceVar = (bId, i, j, k, v) => { const b=state.currentStory.blocks.find(x=>x.id===bId); b.choices[i].vars[j][k]= k==='val' ? toNum(v) : v; };
window.removeChoiceVar = (bId, i, j) => { const b=state.currentStory.blocks.find(x=>x.id===bId); b.choices[i].vars.splice(j,1); renderBlockProps(); };
window.removeChoice = (bId, i) => { state.currentStory.blocks.find(x=>x.id===bId).choices.splice(i,1); renderBlockProps(); drawLines(); };
window.createChoice = bId => { alert('Кликни на блок, выбери "+" в свойствах справа и укажи следующий блок из списка.'); };

window.deleteBlock = () => { if(!state.selectedBlock)return; state.currentStory.blocks=state.currentStory.blocks.filter(x=>x.id!==state.selectedBlock.id); state.selectedBlock=null; drawBlocks(); $('#prop-form').innerHTML='<h3>Выбери блок</h3>'; $('#block-actions').classList.add('hidden'); saveData(); };
$('#delete-block-btn').onclick = window.deleteBlock;
$('#add-block-btn').onclick = () => {
  const id = uid();
  state.currentStory.blocks.push({id, x:400+Math.random()*50, y:200+Math.random()*50, text:'Новый блок', choices:[], vars:[]});
  drawBlocks(); selectBlock(id); saveData();
};
$('#preview-btn').onclick = () => { saveData(); startGame(state.currentStory.id, true); };

// ================= INIT =================
init();