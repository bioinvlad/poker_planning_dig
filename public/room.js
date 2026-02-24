// ===== Constants =====
const CARDS = ['0', '1', '2', '3', '5', '8', '13', '21', '?', '☕'];

// ===== State =====
let ws          = null;
let roomState   = null;
let myPlayerId  = null;
let isModerator = false;
let myVote      = null;
let toastTimer  = null;

// ===== DOM helpers =====
const $  = id => document.getElementById(id);
const el = {
  connectingScreen: $('connectingScreen'),
  errorScreen:      $('errorScreen'),
  errorText:        $('errorText'),
  app:              $('app'),
  roomCodeBtn:      $('roomCodeBtn'),
  roomCodeVal:      $('roomCodeVal'),
  headerName:       $('headerName'),
  modBadge:         $('modBadge'),
  stateEmpty:       $('stateEmpty'),
  stateDone:        $('stateDone'),
  stateTask:        $('stateTask'),
  taskKey:          $('taskKey'),
  taskProgress:     $('taskProgress'),
  taskSummary:      $('taskSummary'),
  cardsPanel:       $('cardsPanel'),
  voteCards:        $('voteCards'),
  playersGrid:      $('playersGrid'),
  voteStats:        $('voteStats'),
  controlsPanel:    $('controlsPanel'),
  btnUpload:        $('btnUpload'),
  csvInput:         $('csvInput'),
  btnReveal:        $('btnReveal'),
  btnReset:         $('btnReset'),
  btnPrev:          $('btnPrev'),
  btnNext:          $('btnNext'),
  disconnectOverlay:$('disconnectOverlay'),
  toast:            $('toast'),
  btnLeave:         $('btnLeave'),
  taskListPanel:    $('taskListPanel'),
  taskList:         $('taskList'),
  taskListStats:    $('taskListStats'),
};

// ===== Init =====
function init() {
  const name   = sessionStorage.getItem('pp_name');
  const action = sessionStorage.getItem('pp_action');
  const roomId = sessionStorage.getItem('pp_room');

  if (!name || !action) {
    window.location.href = '/';
    return;
  }

  buildVoteCards();
  bindEvents();
  connectWS(name, action, roomId);
}

// ===== WebSocket =====
function connectWS(name, action, roomId) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    if (action === 'create') {
      wsSend({ type: 'create_room', name });
    } else {
      wsSend({ type: 'join_room', name, roomId });
    }
  };

  ws.onmessage = e => {
    try { handleMessage(JSON.parse(e.data)); } catch (_) {}
  };

  ws.onclose = () => {
    if (el.app.style.display !== 'none') {
      el.disconnectOverlay.style.display = 'flex';
    }
  };

  ws.onerror = () => {
    showError('Could not connect. Make sure the server is running.');
  };
}

function wsSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ===== Message handler =====
function handleMessage(msg) {
  switch (msg.type) {

    case 'joined':
      myPlayerId  = msg.playerId;
      isModerator = msg.isModerator;
      el.headerName.textContent = sessionStorage.getItem('pp_name');
      if (isModerator) {
        el.modBadge.style.display    = 'inline';
        el.controlsPanel.style.display = 'flex';
      }
      el.connectingScreen.style.display = 'none';
      el.app.style.display = 'flex';
      break;

    case 'room_state':
      roomState = msg;
      render();
      break;

    case 'error':
      showError(msg.message);
      break;
  }
}

// ===== Render =====
function render() {
  if (!roomState) return;
  const { roomId, tasks, currentTaskIndex, revealed, players } = roomState;

  // Header
  el.roomCodeVal.textContent = roomId;

  // Sync myVote: if server says I haven't voted, clear local vote
  const me = players.find(p => p.id === myPlayerId);
  if (me && !me.voted) myVote = null;

  // Task panel
  const isDone   = tasks.length > 0 && currentTaskIndex >= tasks.length;
  const hasTask  = tasks.length > 0 && currentTaskIndex < tasks.length;

  el.stateEmpty.style.display = tasks.length === 0       ? 'block' : 'none';
  el.stateDone.style.display  = isDone                   ? 'block' : 'none';
  el.stateTask.style.display  = hasTask                  ? 'block' : 'none';

  if (hasTask) {
    const task = tasks[currentTaskIndex];
    el.taskKey.textContent      = task.key;
    el.taskSummary.textContent  = task.summary;
    el.taskProgress.textContent = `${currentTaskIndex + 1} of ${tasks.length}`;
  }

  // Vote cards
  const votingAllowed = hasTask && !revealed;
  el.voteCards.querySelectorAll('.vote-card-btn').forEach(btn => {
    btn.disabled = !votingAllowed;
    btn.classList.toggle('selected', votingAllowed && btn.dataset.value === myVote);
  });

  // Players
  renderPlayers(players, revealed);

  // Task list
  renderTaskList(tasks, currentTaskIndex, roomState.taskAverages || []);

  // Vote stats
  if (revealed) {
    const nums = players
      .filter(p => p.voted && p.voteValue !== null && !isNaN(Number(p.voteValue)))
      .map(p => Number(p.voteValue));
    if (nums.length > 0) {
      const avg = (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1);
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      el.voteStats.innerHTML =
        `Average: <strong>${avg}</strong>&nbsp;&nbsp;·&nbsp;&nbsp;Range: ${min}–${max}`;
    } else {
      el.voteStats.textContent = '';
    }
  } else {
    const votedCount = players.filter(p => p.voted).length;
    el.voteStats.textContent =
      players.length > 0 ? `${votedCount} / ${players.length} voted` : '';
  }

  // Moderator controls
  if (isModerator) {
    const hasAnyVote = players.some(p => p.voted);
    el.btnReveal.disabled = !hasAnyVote || revealed || !hasTask;
    el.btnReset.disabled  = !hasTask && !isDone;
    el.btnPrev.disabled   = currentTaskIndex <= 0 || tasks.length === 0;
    el.btnNext.disabled   = isDone || tasks.length === 0;
  }
}

function renderPlayers(players, revealed) {
  // For consensus coloring after reveal
  const revealedNums = revealed
    ? players.filter(p => p.voted && !isNaN(Number(p.voteValue))).map(p => Number(p.voteValue))
    : [];
  const sorted = [...revealedNums].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;

  el.playersGrid.innerHTML = players.map(player => {
    const isMe = player.id === myPlayerId;
    let chipClass = 'empty';
    let chipContent = '–';
    let cardClass   = '';

    if (revealed && player.voted) {
      chipClass   = 'revealed';
      chipContent = player.voteValue ?? '?';
      if (median !== null && !isNaN(Number(player.voteValue))) {
        const diff = Math.abs(Number(player.voteValue) - median);
        cardClass = diff <= 2 ? 'agree' : 'spread';
      }
    } else if (player.voted) {
      chipClass   = 'back';
      chipContent = '';
      cardClass   = 'has-voted';
    }

    return `<div class="player-card ${cardClass}">
      <div class="player-vote-chip ${chipClass}">${escHtml(chipContent)}</div>
      <div class="player-name ${isMe ? 'me' : ''}">${escHtml(player.name)}</div>
      ${player.isModerator ? '<span class="player-mod-tag">Mod</span>' : ''}
    </div>`;
  }).join('');
}

// ===== Task list =====
function renderTaskList(tasks, currentIdx, averages) {
  if (tasks.length === 0) {
    el.taskListPanel.style.display = 'none';
    return;
  }
  el.taskListPanel.style.display = 'block';

  const estimated = averages.filter(a => a != null).length;
  el.taskListStats.textContent =
    estimated > 0 ? `${estimated} of ${tasks.length} estimated` : `${tasks.length} tasks`;

  el.taskList.innerHTML = tasks.map((task, i) => {
    const avg     = averages[i] != null ? averages[i] : null;
    const current = i === currentIdx;
    return `<div
      class="task-list-item${current ? ' current' : ''}"
      data-index="${i}"
    >
      <span class="tl-key">${escHtml(task.key)}</span>
      <span class="tl-summary" title="${escHtml(task.summary)}">${escHtml(task.summary)}</span>
      <span class="tl-avg${avg != null ? ' has-avg' : ''}">${avg != null ? avg : '—'}</span>
    </div>`;
  }).join('');

  // Scroll current task into view
  const cur = el.taskList.querySelector('.task-list-item.current');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

// ===== Vote cards =====
function buildVoteCards() {
  el.voteCards.innerHTML = CARDS.map(v =>
    `<button class="vote-card-btn" data-value="${v}">${v}</button>`
  ).join('');
}

// ===== Event bindings =====
function bindEvents() {
  // Vote
  el.voteCards.addEventListener('click', e => {
    const btn = e.target.closest('.vote-card-btn');
    if (!btn || btn.disabled) return;
    myVote = btn.dataset.value;
    // Optimistic UI
    el.voteCards.querySelectorAll('.vote-card-btn').forEach(b =>
      b.classList.toggle('selected', b.dataset.value === myVote)
    );
    wsSend({ type: 'vote', value: myVote });
  });

  // Copy room code
  el.roomCodeBtn.addEventListener('click', () => {
    const code = el.roomCodeVal.textContent;
    if (!code || code === '------') return;
    navigator.clipboard.writeText(code)
      .then(() => toast('Room code copied!', 'success'))
      .catch(() => {
        // Fallback for non-secure contexts
        const t = document.createElement('textarea');
        t.value = code;
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
        toast('Room code copied!', 'success');
      });
  });

  // Leave session
  el.btnLeave.addEventListener('click', () => {
    const msg = isModerator
      ? 'End the session for everyone and go to the home page?'
      : 'Leave the session and go to the home page?';
    if (confirm(msg)) {
      ws.close();
      window.location.href = '/';
    }
  });

  // Task list navigation (moderator only)
  if (isModerator) el.taskList.classList.add('can-navigate');
  el.taskList.addEventListener('click', e => {
    if (!isModerator) return;
    const item = e.target.closest('.task-list-item');
    if (!item) return;
    const idx = Number(item.dataset.index);
    if (!isNaN(idx)) wsSend({ type: 'goto_task', index: idx });
  });

  // Moderator buttons
  el.btnUpload.addEventListener('click',  () => el.csvInput.click());
  el.csvInput.addEventListener('change',  handleCSVUpload);
  el.btnReveal.addEventListener('click',  () => wsSend({ type: 'reveal' }));
  el.btnReset.addEventListener('click',   () => wsSend({ type: 'reset_votes' }));
  el.btnNext.addEventListener('click',    () => wsSend({ type: 'next_task' }));
  el.btnPrev.addEventListener('click',    () => wsSend({ type: 'prev_task' }));
}

// ===== CSV upload & parsing =====
function handleCSVUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const text = ev.target.result.replace(/^\uFEFF/, ''); // strip BOM
    const tasks = parseCSV(text);
    if (tasks.length === 0) {
      toast('No tasks found. Make sure the CSV has a "Summary" column.', 'error');
    } else {
      wsSend({ type: 'upload_tasks', tasks });
      toast(`Loaded ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`, 'success');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  const keyIdx  = headers.findIndex(h =>
    ['issue key', 'key', 'id', 'issue id', 'ticket'].includes(h));
  const sumIdx  = headers.findIndex(h =>
    ['summary', 'title', 'name', 'description', 'task'].includes(h));

  if (sumIdx === -1) return [];

  const tasks = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const summary = (cols[sumIdx] ?? '').trim();
    if (!summary) continue;
    const key = keyIdx >= 0 ? (cols[keyIdx] ?? '').trim() || `#${i}` : `#${i}`;
    tasks.push({ key, summary });
  }
  return tasks;
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

// ===== Helpers =====
function toast(msg, type = '') {
  el.toast.textContent  = msg;
  el.toast.className    = `toast ${type}`;
  el.toast.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.style.display = 'none'; }, 3000);
}

function showError(msg) {
  el.connectingScreen.style.display = 'none';
  el.app.style.display              = 'none';
  el.errorText.textContent          = msg;
  el.errorScreen.style.display      = 'flex';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== Start =====
init();
