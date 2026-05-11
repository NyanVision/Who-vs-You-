/* ═══════════════════════════════════════════
   WHO VS YOU? — TOURNAMENT ENGINE v3.0
   script.js
   Password: zayyarkyaw35
═══════════════════════════════════════════ */
const ADMIN_PASS = 'zayyarkyaw35';
const GROUP_LETTERS = 'ABCDEFGHIJKLMNOP'.split('');
const KO_ROUNDS = ['R32','R16','QF','SF','F'];
const KO_LABELS = {R32:'Round of 32',R16:'Round of 16',QF:'Quarter Final',SF:'Semi Final',F:'Final'};
const TOURNAMENT_LOGO = 'assets/logos/tournament-logo.png';
const PB_DEFAULT_URL = 'http://127.0.0.1:8090';

let state = {
  tournament: null,
  players: [],
  groups: [],
  fixtures: [],
  standings: {},
  knockout: [],
  matchLog: [],
  seasons: [],
  currentStage: 'group',
  currentKoRound: 'R16',
  pocketbase: null,
  pocketbaseUrl: PB_DEFAULT_URL,
  supabase: null,
  localMode: false,
  adminLoggedIn: false,
  koLegs: 1,
  advancePlayers: 2
};

/* ─── PARTICLES ─── */
function spawnParticles() {
  const container = document.getElementById('particles');
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `
      left:${Math.random()*100}%;
      animation-duration:${8+Math.random()*12}s;
      animation-delay:${Math.random()*8}s;
      opacity:${0.3+Math.random()*0.5};
      width:${1+Math.random()*2}px;height:${1+Math.random()*2}px;
      background:${Math.random()>.6?'rgba(196,154,48,0.5)':'rgba(204,0,0,0.5)'};
    `;
    container.appendChild(p);
  }
}

/* ─── LOADING ─── */
function hideLoading() {
  setTimeout(() => {
    const ls = document.getElementById('loading-screen');
    ls.classList.add('fade-out');
    setTimeout(() => ls.style.display = 'none', 500);
  }, 1200);
}

/* ─── SIDEBAR ─── */
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}
function switchSection(id) {
  document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-section="${id}"]`)?.classList.add('active');
  document.querySelectorAll('.admin-panel-section').forEach(el => el.classList.remove('active'));
  document.getElementById('section-' + id)?.classList.add('active');
  if (window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('open');
  if (id === 'results') renderResultsSection();
  if (id === 'groups') renderGroupSettings();
  if (id === 'fixtures') renderFixturesPreview();
  if (id === 'knockout') renderKoAdminSection();
  if (id === 'seasons') renderSeasonsAdmin();
  if (id === 'log') renderMatchLog();
  if (id === 'dashboard') updateDashboard();
  if (id === 'tournament') renderTournamentInfo();
}

/* ─── DATA LAYER — POCKETBASE + LOCAL FALLBACK ─── */
const PB_COLLECTIONS = {
  players: 'players',
  groups: 'groups',
  fixtures: 'fixtures',
  knockout_matches: 'knockout'
};

function getPB() {
  if (!state.pocketbase && typeof PocketBase !== 'undefined') {
    state.pocketbase = new PocketBase(state.pocketbaseUrl || PB_DEFAULT_URL);
  }
  return state.pocketbase;
}

async function clearPocketBaseCollection(collection) {
  const pb = getPB();
  try {
    const records = await pb.collection(collection).getFullList({ fields: 'id', perPage: 2000 });
    for (const r of records) {
      try { await pb.collection(collection).delete(r.id); }
      catch(e) { console.warn('Could not delete record', r.id, e.message); }
    }
  } catch(e) {
    console.error('clearPocketBaseCollection failed for', collection, e);
    throw e;
  }
}

function normalizePlayerRecord(record) {
  let photoUrl = '';
  if (record.photo) {
    try {
      // getPB().baseURL is always the correct base, even during init
      const pb = getPB();
      const base = (pb && pb.baseURL ? pb.baseURL : state.pocketbaseUrl || PB_DEFAULT_URL).replace(/\/$/, '');
      photoUrl = base + '/api/files/' + record.collectionId + '/' + record.id + '/' + record.photo;
    } catch(e) { photoUrl = ''; }
  }
  return {
    id: record.id,
    name: record.name || record.username || '?',
    photo: photoUrl,
    photoFile: record.photo || ''
  };
}

function toPocketFixture(f) {
  return {
    group: String(f.group_id || f.group || ''),
    round: Number(f.round || 1),
    home: f.home || null,
    away: f.away || null,
    home_score: f.home_score === null || f.home_score === undefined ? null : Number(f.home_score),
    away_score: f.away_score === null || f.away_score === undefined ? null : Number(f.away_score),
    played: !!f.played
  };
}

function fromPocketFixture(r) {
  return {
    id: r.id,
    group_id: r.group,
    stage: 'group',
    round: r.round || 1,
    home: r.home,
    away: r.away,
    home_score: r.home_score ?? null,
    away_score: r.away_score ?? null,
    played: !!r.played
  };
}

function toPocketKnockout(f) {
  return {
    round: f.round,
    home: f.home || null,
    away: f.away || null,
    home_score: f.home_score === null || f.home_score === undefined ? null : Number(f.home_score),
    away_score: f.away_score === null || f.away_score === undefined ? null : Number(f.away_score),
    played: !!f.played
  };
}

function saveLocal(key, value) {
  localStorage.setItem('wvy_' + key, JSON.stringify(value));
  return { data: value, error: null };
}

async function saveData(key, value) {
  // Always keep a local backup so advanced fields like legs, winners, logs, and seasons are safe.
  saveLocal(key, value);

  if (state.localMode || !state.pocketbase) return { data: value, error: null };

  try {
    if (key === 'players') {
      // Sync players that were added locally (their id is a number, not a 15-char PocketBase id)
      const pbIdPattern = /^[a-z0-9]{15}$/i;
      let syncCount = 0;
      for (const p of value) {
        if (!pbIdPattern.test(String(p.id))) {
          try {
            const fd = new FormData();
            fd.append('name', p.name);
            const created = await getPB().collection('players').create(fd);
            p.id = created.id; // update local id to PocketBase id
            syncCount++;
            console.log('Synced player to PB:', p.name, created.id);
          } catch(e) {
            console.error('Player sync to PB failed:', p.name, e);
            toast('Failed to sync player "' + p.name + '": ' + (e.message || e), 'warning');
          }
        }
      }
      saveLocal('players', value); // keep local copy updated with new PB ids
      console.log('saveData players: synced', syncCount, 'new players to PocketBase');
      return { data: value, error: null };
    }

    if (key === 'groups') {
      await clearPocketBaseCollection('groups');
      for (const g of value) {
        await getPB().collection('groups').create({
          name: g.name,
          players: (g.players || []).map(String)
        });
      }
      return { data: value, error: null };
    }

    if (key === 'fixtures') {
      await clearPocketBaseCollection('fixtures');
      for (const f of value.filter(x => x.stage === 'group')) {
        await getPB().collection('fixtures').create(toPocketFixture(f));
      }
      return { data: value, error: null };
    }

    if (key === 'knockout_matches') {
      await clearPocketBaseCollection('knockout');
      for (const f of value) {
        await getPB().collection('knockout').create(toPocketKnockout(f));
      }
      return { data: value, error: null };
    }

    // tournaments, seasons, match_log stay in localStorage unless you create collections for them.
    return { data: value, error: null };
  } catch (error) {
    console.error('PocketBase save failed:', key, error);
    toast('PocketBase save failed. Local backup saved.', 'warning');
    return { data: value, error };
  }
}

async function loadData(key) {
  if (state.localMode || !state.pocketbase) {
    const d = localStorage.getItem('wvy_' + key);
    return d ? JSON.parse(d) : null;
  }

  try {
    if (key === 'players') {
      // sort:'+created' is safer; some PB versions need the + prefix
      // perPage:500 ensures we get all records even with large collections
      const records = await getPB().collection('players').getFullList({ sort: '+created', perPage: 500 });
      console.log('PB players loaded:', records.length, records);
      const normalized = records.map(normalizePlayerRecord);
      console.log('Normalized players:', normalized);
      // Also save to local backup so offline fallback works
      saveLocal('players', normalized);
      return normalized;
    }

    if (key === 'groups') {
      const records = await getPB().collection('groups').getFullList({ sort: '+created', perPage: 100 });
      console.log('PB groups loaded:', records.length, records);
      return records.map(r => ({
        id: r.name,
        name: r.name,
        players: Array.isArray(r.players) ? r.players : []
      }));
    }

    if (key === 'fixtures') {
      const records = await getPB().collection('fixtures').getFullList({ sort: '+created', perPage: 2000 });
      console.log('PB fixtures loaded:', records.length);
      return records.map(fromPocketFixture);
    }

    // Keep advanced knockout state from localStorage so match_num, legs, winners, and leg_results stay complete.
    const d = localStorage.getItem('wvy_' + key);
    return d ? JSON.parse(d) : null;
  } catch (error) {
    console.error('PocketBase load failed:', key, error);
    const d = localStorage.getItem('wvy_' + key);
    return d ? JSON.parse(d) : null;
  }
}

async function connectPocketBase() {
  const url = (document.getElementById('pb-url')?.value || PB_DEFAULT_URL).trim().replace(/\/$/, '');
  if (!url) { toast('Enter PocketBase URL', 'warning'); return; }
  try {
    state.pocketbaseUrl = url;
    state.pocketbase = new PocketBase(url);
    toast('Connecting to PocketBase…', 'info');
    await Promise.race([
      state.pocketbase.health.check(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Connection timed out after 8s')), 8000))
    ]);
    state.localMode = false;
    localStorage.setItem('wvy_pb_url', url);
    document.getElementById('pocketbase-config-card').style.display = 'none';
    setAdminStatus('green', 'Connected: ' + url);
    toast('Connected to PocketBase!', 'success');
    await loadAll();
  } catch(e) {
    console.error('PocketBase connect error:', e);
    state.pocketbase = null;
    state.localMode = true;
    setAdminStatus('red', 'Connection failed — using Local Mode');
    let msg = 'PocketBase connection failed: ' + (e.message || 'unknown error');
    if (e.message === 'Failed to fetch' || e.message?.includes('fetch')) {
      msg += '. Check: Is PocketBase running? Is CORS enabled in PocketBase → Settings → Application?';
    }
    toast(msg, 'warning');
    await loadAll();
  }
}

// Backward-compatible alias if any old button still exists.
async function connectSupabase() { return connectPocketBase(); }

function useLocalMode() {
  state.localMode = true;
  state.pocketbase = null;
  const card = document.getElementById('pocketbase-config-card');
  if (card) card.style.display = 'none';
  setAdminStatus('gold', 'Local Mode (browser storage)');
  toast('Using local mode', 'warning');
  loadAll();
}

/* ─── LOAD ALL ─── */
async function loadAll() {
  try {
    console.log('loadAll() — mode:', state.localMode ? 'LOCAL' : 'POCKETBASE', state.pocketbaseUrl);

    const t = await loadData('tournaments');
    state.tournament = t ? (Array.isArray(t) ? t[0] : t) : null;
    console.log('tournament:', state.tournament);

    const p = await loadData('players');
    state.players = p ? (Array.isArray(p) ? p : [p]) : [];
    console.log('players loaded:', state.players.length, state.players);

    const g = await loadData('groups');
    state.groups = g ? (Array.isArray(g) ? g : [g]) : [];
    console.log('groups loaded:', state.groups.length);

    const f = await loadData('fixtures');
    state.fixtures = f ? (Array.isArray(f) ? f : [f]) : [];
    console.log('fixtures loaded:', state.fixtures.length);

    const ko = await loadData('knockout_matches');
    state.knockout = ko ? (Array.isArray(ko) ? ko : [ko]) : [];

    const log = await loadData('match_log');
    state.matchLog = log ? (Array.isArray(log) ? log : [log]) : [];

    const sv = await loadData('seasons');
    state.seasons = sv ? (Array.isArray(sv) ? sv : [sv]) : [];

    recalcAllStandings();
    renderAll();
    hideLoading();
  } catch(e) {
    console.error('loadAll error:', e);
    setStatus('red', 'Error loading data: ' + e.message);
    hideLoading();
  }
}
function renderAll() {
  updateStatusBar();
  renderPublicView();
  updateDashboard();
  renderMatchLog();
  renderSeasonDropdown();
  updatePendingBadge();
}

/* ─── STATUS ─── */
function setStatus(c, t) {
  document.getElementById('status-dot').className = 'status-dot ' + c;
  document.getElementById('status-text').textContent = t;
}
function setAdminStatus(c, t) {
  document.getElementById('admin-status-dot').className = 'status-dot ' + c;
  document.getElementById('admin-status-text').textContent = t;
}
function updateStatusBar() {
  if (!state.tournament) { setStatus('red', 'No tournament – Admin needs to create one'); return; }
  const season = state.tournament.season || 5;
  const sb = document.getElementById('season-badge'); if (sb) sb.textContent = 'Season ' + season;
  const sbt = document.getElementById('sb-season-txt'); if (sbt) sbt.textContent = 'Season ' + season;
  const played = state.fixtures.filter(f => f.played && f.stage === 'group').length;
  const total  = state.fixtures.filter(f => f.stage === 'group').length;
  const ko = state.knockout.length > 0;
  if (ko) setStatus('gold', `KO Stage  ·  ${state.tournament.name}  ·  Season ${season}`);
  else setStatus('green', `${state.tournament.name}  ·  Season ${season}  ·  ${played}/${total} group matches played`);
}
function updateDashboard() {
  const played  = state.fixtures.filter(f => f.played).length;
  const pending = state.fixtures.filter(f => !f.played).length;
  // Use null-safe helper — admin panel elements only exist when panel is open
  const s = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  s('stat-players',  state.players.length);
  s('stat-groups',   state.groups.length);
  s('stat-played',   played);
  s('stat-pending',  pending);
  s('stat-ko',       state.knockout.length);
  s('stat-seasons',  state.seasons.length + 1);
  const ra = document.getElementById('recent-activity');
  if (ra) renderRecentActivity();
}
function updatePendingBadge() {
  const pending = state.fixtures.filter(f => !f.played && f.stage === 'group').length;
  const badge = document.getElementById('sb-badge-results');
  if (pending > 0) { badge.textContent = pending; badge.style.display = 'inline-flex'; }
  else badge.style.display = 'none';
}
function renderRecentActivity() {
  const el = document.getElementById('recent-activity');
  if (!state.matchLog.length) {
    el.innerHTML = '<div class="empty-state" style="padding:20px"><span class="ei" style="font-size:24px">📋</span><p>No activity yet</p></div>';
    return;
  }
  el.innerHTML = state.matchLog.slice(0, 8).map((entry, i) => `
    <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.04);">
      <div style="width:28px;height:28px;border-radius:50%;background:var(--red-s);border:1px solid var(--b-red);display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--ff-ui);font-size:13px;font-weight:700">${entry.match}</div>
        <div style="font-family:var(--ff-hud);font-size:9px;color:var(--muted)">${entry.group} · ${entry.time}</div>
      </div>
      <div style="font-family:var(--ff-hud);font-size:16px;font-weight:700;color:var(--gold2)">${entry.score}</div>
    </div>`).join('');
}

/* ─── VIEW SWITCHING ─── */
function showView(v) {
  document.getElementById('view-public').classList.toggle('visible', v === 'public');
  document.getElementById('view-admin').classList.toggle('visible', v === 'admin');
  document.getElementById('nav-public').classList.toggle('active', v === 'public');
  document.getElementById('nav-admin').classList.toggle('active', v === 'admin');
}
function toggleAdmin() {
  const isAdmin = document.getElementById('view-admin').classList.contains('visible');
  showView(isAdmin ? 'public' : 'admin');
}
function showStage(s) {
  state.currentStage = s;
  ['group','ko','history'].forEach(x => {
    document.getElementById('stage-' + x).style.display = x === s ? 'block' : 'none';
    document.getElementById('tab-' + x).classList.toggle('active', x === s);
  });
  if (s === 'history') renderHistoryView();
  if (s === 'ko') renderKnockoutView();
}

/* ─── FIXED TOURNAMENT LOGO ─── */
function tournamentLogoHtml(className = 'card-tournament-logo') {
  return `<img class="${className} tournament-logo" src="${TOURNAMENT_LOGO}" alt="Tournament Logo">`;
}

function playerAvatarHtml(player, className = 'player-avatar') {
  const src = player?.photo || '';
  return src
    ? `<img class="${className}" src="${src}" alt="${player.name}">`
    : `<span class="${className} player-avatar-fallback">${(player?.name || '?').charAt(0).toUpperCase()}</span>`;
}


function fixturePlayerHtml(pid, side = 'left', extraStyle = '') {
  const p = getPlayer(pid);
  const name = p ? p.name : (pid || 'TBD');
  const avatar = p ? playerAvatarHtml(p, 'player-avatar fixture-avatar') : playerAvatarHtml({name:'TBD', photo:''}, 'player-avatar fixture-avatar');
  return `<span class="fixture-player ${side}" style="${extraStyle}">${side === 'left' ? `<span class="player-name left">${name}</span>${avatar}` : `${avatar}<span class="player-name right">${name}</span>`}</span>`;
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ─── ADMIN LOGIN ─── */
function adminLogin() {
  if (document.getElementById('admin-password').value === ADMIN_PASS) {
    state.adminLoggedIn = true;
    document.getElementById('admin-login').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'block';
    const savedPbUrl = localStorage.getItem('wvy_pb_url') || PB_DEFAULT_URL;
    const pbUrlInput = document.getElementById('pb-url');
    if (pbUrlInput) pbUrlInput.value = savedPbUrl;
    const card = document.getElementById('pocketbase-config-card');
    if (card && !state.localMode && state.pocketbase) card.style.display = 'none';
    loadAll();
  } else { toast('Wrong password!'); }
}

/* ─── TOURNAMENT CREATION ─── */
async function createTournament() {
  const name      = document.getElementById('t-name').value.trim() || 'Who vs You? eTournament';
  const season    = parseInt(document.getElementById('t-season').value) || 5;
  const numGroups = parseInt(document.getElementById('t-groups').value) || 4;
  const ppg       = parseInt(document.getElementById('t-ppg').value) || 4;
  const advance   = parseInt(document.querySelector('input[name="advance"]:checked')?.value || 2);
  state.advancePlayers = advance;
  const t = { id:1, name, season, num_groups:numGroups, players_per_group:ppg, advance_players:advance, stage:'group', created_at:new Date().toISOString() };
  state.tournament = t;
  state.groups = Array.from({length:numGroups}, (_,i) => ({id:'Group '+GROUP_LETTERS[i], name:'Group '+GROUP_LETTERS[i], players:[]}));
  state.fixtures = []; state.knockout = []; state.matchLog = [];
  await saveData('tournaments', t);
  await saveData('groups', state.groups);
  await saveData('fixtures', []);
  await saveData('knockout_matches', []);
  await saveData('match_log', []);
  toast('Tournament created!', 'success');
  renderAll();
  renderTournamentInfo();
  switchSection('players');
}
function renderTournamentInfo() {
  const card = document.getElementById('tournament-info-card');
  if (!state.tournament) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  const t = state.tournament;
  document.getElementById('tournament-info-body').innerHTML = `
    <div class="tournament-info-logo-row">${tournamentLogoHtml('settings-logo-preview tournament-logo')}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
      <div class="stat-card card-sm"><div class="stat-num" style="font-size:18px">${t.name}</div><div class="stat-label">Name</div></div>
      <div class="stat-card card-sm gold"><div class="stat-num" style="font-size:22px">${t.season}</div><div class="stat-label">Season</div></div>
      <div class="stat-card card-sm"><div class="stat-num" style="font-size:22px">${t.num_groups}</div><div class="stat-label">Groups</div></div>
      <div class="stat-card card-sm"><div class="stat-num" style="font-size:22px">${t.players_per_group}</div><div class="stat-label">Per Group</div></div>
      <div class="stat-card card-sm gold"><div class="stat-num" style="font-size:22px">Top ${t.advance_players||2}</div><div class="stat-label">Advance</div></div>
    </div>`;
}

/* ─── PLAYERS ─── */
function renderPlayerList() {
  const c = document.getElementById('player-list');
  if (!c) return; // not in admin panel view yet
  c.innerHTML = '';
  state.players.forEach((p, i) => {
    const tag = document.createElement('div');
    tag.className = 'player-tag player-photo-tag';
    tag.innerHTML = `${playerAvatarHtml(p)}<span>${p.name}</span><button class="remove-btn" onclick="removePlayer(${i})">✕</button>`;
    c.appendChild(tag);
  });
  const pc = document.getElementById('player-count');
  if (pc) pc.textContent = state.players.length;
}
async function addPlayer() {
  const input = document.getElementById('player-name-input');
  const photoInput = document.getElementById('player-photo-input');
  const name = input.value.trim(); if (!name) return;
  if (state.players.find(p => p.name.toLowerCase() === name.toLowerCase())) { toast('Player already exists', 'warning'); return; }

  if (!state.localMode && state.pocketbase) {
    try {
      const formData = new FormData();
      formData.append('name', name);
      if (photoInput?.files?.[0]) formData.append('photo', photoInput.files[0]);
      const created = await getPB().collection('players').create(formData);
      state.players.push(normalizePlayerRecord(created));
      saveLocal('players', state.players);
      input.value = '';
      if (photoInput) photoInput.value = '';
      renderPlayerList();
      updateDashboard();
      toast('Player saved to PocketBase!', 'success');
      return;
    } catch (error) {
      console.error('PocketBase addPlayer error:', error);
      toast('PocketBase save failed (' + (error.message || 'unknown') + '). Saved locally instead.', 'warning');
    }
  }

  const photo = await readImageFile(photoInput?.files?.[0]);
  state.players.push({ id: Date.now(), name, photo });
  saveLocal('players', state.players);
  input.value = '';
  if (photoInput) photoInput.value = '';
  renderPlayerList();
  updateDashboard();
  toast('Player added locally!', 'success');
}
async function bulkAddPlayers() {
  const lines = document.getElementById('bulk-players').value.split('\n').map(l => l.trim()).filter(Boolean);
  const unique = lines.filter(name => !state.players.find(p => p.name.toLowerCase() === name.toLowerCase()));

  if (!state.localMode && state.pocketbase) {
    let added = 0;
    for (const name of unique) {
      try {
        const fd = new FormData();
        fd.append('name', name);
        const created = await getPB().collection('players').create(fd);
        state.players.push(normalizePlayerRecord(created));
        added++;
      } catch (error) { console.error('Bulk player PB failed:', name, error); }
    }
    saveLocal('players', state.players);
    toast(`Added ${added} of ${unique.length} players to PocketBase!`, 'success');
  } else {
    unique.forEach(name => state.players.push({id: Date.now() + Math.random(), name, photo:''}));
    saveLocal('players', state.players);
    toast(`Added ${unique.length} players!`, 'success');
  }

  document.getElementById('bulk-players').value = '';
  renderPlayerList();
  updateDashboard();
}
function removePlayer(i) { state.players.splice(i,1); renderPlayerList(); }
async function clearAllPlayers() {
  if (!confirm('Clear all players?')) return;
  if (!state.localMode && state.pocketbase) {
    try { await clearPocketBaseCollection('players'); } catch (e) { console.error(e); }
  }
  state.players=[];
  await saveData('players', state.players);
  renderPlayerList();
}
async function savePlayers() {
  await saveData('players', state.players);
  if (state.localMode || !state.pocketbase) {
    toast('Players saved locally!', 'success');
  } else {
    toast('Players synced to PocketBase!', 'success');
  }
  renderPlayerList();
}

/* ─── GROUPS ─── */
async function randomizeGroups() {
  if (!state.tournament) { toast('Create tournament first', 'warning'); return; }
  if (state.players.length < 2) { toast('Add players first', 'warning'); return; }
  const shuffled = [...state.players].sort(() => Math.random() - .5);
  state.groups.forEach(g => g.players = []);
  shuffled.forEach((p, i) => state.groups[i % state.groups.length].players.push(p.id));
  await saveData('groups', state.groups);
  toast('Groups randomized!', 'success');
  renderGroupSettings();
  renderPublicView();
}
function renderGroupSettings() {
  const el = document.getElementById('group-settings-body');
  if (!state.tournament || !state.groups.length) {
    el.innerHTML = '<div class="empty-state" style="padding:30px"><span class="ei" style="font-size:28px">🗂️</span><p>Create tournament first</p></div>';
    return;
  }
  el.innerHTML = state.groups.map(g => `
    <div style="margin-bottom:16px">
      <div class="card-title" style="font-size:16px">${g.name} <span style="font-family:var(--ff-hud);font-size:9px;color:var(--muted)">${(g.players||[]).length} players</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">
        ${(g.players||[]).map(pid => { const p = getPlayer(pid); return p ? `<div class="player-tag player-photo-tag">${playerAvatarHtml(p)}<span>${p.name}</span></div>` : ''; }).join('')}
        ${(!g.players || !g.players.length) ? '<span style="color:var(--muted);font-size:12px">No players assigned</span>' : ''}
      </div>
    </div>`).join('');
}

/* ─── FIXTURES GENERATION ─── */
async function generateFixtures() {
  if (!state.tournament) { toast('Create tournament first', 'warning'); return; }
  if (state.groups.every(g => !g.players || !g.players.length)) { toast('Randomize groups first', 'warning'); return; }
  state.fixtures = state.fixtures.filter(f => f.stage !== 'group');
  let fid = Date.now();
  state.groups.forEach(g => {
    const ps = g.players || [];
    const rounds = generateRoundRobin(ps);
    rounds.forEach((round, ri) => {
      round.forEach(([h, a]) => {
        state.fixtures.push({ id: fid++, group_id: g.id, stage: 'group', round: ri+1, home: h, away: a, home_score: null, away_score: null, played: false });
      });
    });
  });
  await saveData('fixtures', state.fixtures);
  recalcAllStandings();
  renderPublicView();
  renderResultsSection();
  renderFixturesPreview();
  updatePendingBadge();
  toast(`Fixtures generated! (${state.fixtures.filter(f=>f.stage==='group').length} matches)`, 'success');
}

function generateRoundRobin(players) {
  const n = players.length;
  const teams = [...players];
  if (n % 2 !== 0) teams.push(null);
  const rounds = [];
  const half = teams.length / 2;
  for (let r = 0; r < teams.length - 1; r++) {
    const round = [];
    for (let i = 0; i < half; i++) {
      const h = teams[i], a = teams[teams.length - 1 - i];
      if (h !== null && a !== null) round.push([h, a]);
    }
    rounds.push(round);
    teams.splice(1, 0, teams.pop());
  }
  return rounds;
}

function renderFixturesPreview() {
  const el = document.getElementById('fixtures-preview');
  if (!state.fixtures.length) { el.innerHTML = '<div class="empty-state" style="padding:20px"><span class="ei" style="font-size:24px">📅</span><p>Generate fixtures first</p></div>'; return; }
  el.innerHTML = state.groups.map(g => {
    const gf = state.fixtures.filter(f => f.group_id === g.id && f.stage === 'group');
    if (!gf.length) return '';
    const maxRound = Math.max(...gf.map(f => f.round || 1));
    return `<div style="margin-bottom:16px">
      <div class="card-title" style="font-size:16px">${g.name}</div>
      ${Array.from({length:maxRound}, (_,ri) => {
        const roundMatches = gf.filter(f => (f.round||1) === ri+1);
        return `<div style="margin-bottom:6px"><span style="font-family:var(--ff-hud);font-size:9px;color:var(--muted);letter-spacing:.15em">ROUND ${ri+1}</span>
          <div class="fixture-list" style="margin-top:4px">
            ${roundMatches.map(f => `<div class="fixture-card ${f.played?'played':''}">
              ${tournamentLogoHtml()}
              ${fixturePlayerHtml(f.home, 'left')}
              <div class="score-zone">${f.played ? `<span class="score-shown">${f.home_score} – ${f.away_score}</span>` : `<span class="vs-label">VS</span>`}</div>
              ${fixturePlayerHtml(f.away, 'right')}
            </div>`).join('')}
          </div></div>`;
      }).join('')}
    </div>`;
  }).join('');
}

/* ─── STANDINGS ─── */
function recalcAllStandings() {
  state.standings = {};
  state.groups.forEach(g => {
    state.standings[g.id] = {};
    (g.players||[]).forEach(pid => {
      const p = getPlayer(pid);
      state.standings[g.id][pid] = { player_id:pid, name:p?p.name:'?', p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0 };
    });
  });
  state.fixtures.filter(f => f.stage === 'group' && f.played).forEach(f => {
    const g = state.groups.find(x => x.id === f.group_id); if (!g) return;
    const home = state.standings[g.id][f.home], away = state.standings[g.id][f.away];
    if (!home || !away) return;
    const hs = parseInt(f.home_score), as = parseInt(f.away_score);
    home.p++; away.p++;
    home.gf += hs; home.ga += as; home.gd += hs-as;
    away.gf += as; away.ga += hs; away.gd += as-hs;
    if (hs > as)       { home.w++; home.pts+=3; away.l++; }
    else if (hs < as)  { away.w++; away.pts+=3; home.l++; }
    else               { home.d++; home.pts++; away.d++; away.pts++; }
  });
}
function getSortedStandings(gid) {
  return Object.values(state.standings[gid]||{}).sort((a,b) =>
    b.pts-a.pts || b.gd-a.gd || b.gf-a.gf || a.ga-b.ga || a.name.localeCompare(b.name));
}
function getAdvanceCount() { return state.tournament?.advance_players || state.advancePlayers || 2; }
function getQualified() {
  const q = [];
  state.groups.forEach(g => getSortedStandings(g.id).slice(0, getAdvanceCount()).forEach(p => q.push({...p, groupName:g.name})));
  return q;
}

/* ─── RESULTS SECTION — STRUCTURED ─── */
function renderResultsSection() {
  const container = document.getElementById('results-container');
  if (!state.fixtures.length) {
    container.innerHTML = '<div class="card"><div class="empty-state"><span class="ei">📅</span><h3>No Fixtures</h3><p>Generate fixtures first</p></div></div>';
    return;
  }
  container.innerHTML = state.groups.map(g => {
    const gf = state.fixtures.filter(f => f.group_id === g.id && f.stage === 'group');
    if (!gf.length) return '';
    const maxRound = Math.max(...gf.map(f => f.round||1));
    const playedCount = gf.filter(f => f.played).length;
    const gid = `rg_${g.id}`;
    return `
    <div class="results-group-block">
      <div class="results-group-header" onclick="toggleGroupBlock('${gid}')">
        <span class="results-group-label">${g.name}</span>
        <span class="results-group-stats">${playedCount}/${gf.length} played</span>
        <span class="results-group-toggle open" id="${gid}_toggle">▼</span>
      </div>
      <div class="results-group-body" id="${gid}_body">
        ${Array.from({length:maxRound}, (_,ri) => {
          const roundMatches = gf.filter(f => (f.round||1) === ri+1);
          const roundPlayed = roundMatches.filter(f=>f.played).length;
          const rid = `${gid}_r${ri+1}`;
          return `
          <div class="results-round-block">
            <div class="results-round-header" onclick="toggleRoundBlock('${rid}')">
              <span class="results-round-label">Round ${ri+1}</span>
              <span class="results-round-prog">${roundPlayed}/${roundMatches.length}</span>
              <span id="${rid}_toggle" style="color:var(--muted);font-size:10px;margin-left:6px">▼</span>
            </div>
            <div class="results-round-body" id="${rid}_body">
              ${roundMatches.map(f => renderResultMatchCard(f)).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

function renderResultMatchCard(f) {
  const home = getPlayerName(f.home), away = getPlayerName(f.away);
  const winner = f.played ? (parseInt(f.home_score) > parseInt(f.away_score) ? home : parseInt(f.away_score) > parseInt(f.home_score) ? away : 'Draw') : null;
  const gd = f.played ? Math.abs(parseInt(f.home_score) - parseInt(f.away_score)) : null;
  return `
  <div class="result-match-card ${f.played?'played-card':''}" id="rmc_${f.id}">
    ${tournamentLogoHtml('card-tournament-logo result-logo')}
    <div class="result-match-top">
      <span class="result-match-player home">${home}</span>
      <div class="result-score-area">
        ${f.played
          ? `<span style="font-family:var(--ff-hud);font-size:20px;font-weight:700;color:var(--gold2);min-width:70px;text-align:center">${f.home_score} – ${f.away_score}</span>`
          : `<input type="number" class="score-box" id="sh_${f.id}" min="0" placeholder="0" style="width:42px;height:42px">
             <span style="color:var(--muted);font-family:var(--ff-hud);font-size:14px">–</span>
             <input type="number" class="score-box" id="sa_${f.id}" min="0" placeholder="0" style="width:42px;height:42px">`
        }
      </div>
      <span class="result-match-player away">${away}</span>
    </div>
    <div class="result-match-bottom">
      <span class="match-status-tag ${f.played?'done':'pending'}">${f.played?'✓ Played':'Pending'}</span>
      <div class="match-action-btns">
        ${f.played
          ? `<span class="winner-tag">🏆 ${winner}${winner!=='Draw'?` (+${gd})`:''}</span>
             <button class="btn btn-ghost btn-xs" onclick="editResult(${f.id})">✏️ Edit</button>`
          : `<button class="btn btn-green btn-xs" onclick="quickSubmit(${f.id})">✅ Submit</button>`
        }
      </div>
    </div>
  </div>`;
}

function toggleGroupBlock(id) {
  const body = document.getElementById(id+'_body');
  const tog  = document.getElementById(id+'_toggle');
  const isOpen = tog.classList.contains('open');
  if (isOpen) { body.style.maxHeight = '0'; body.style.overflow = 'hidden'; tog.classList.remove('open'); }
  else { body.style.maxHeight = ''; body.style.overflow = ''; tog.classList.add('open'); }
}
function toggleRoundBlock(id) {
  const body = document.getElementById(id+'_body');
  body.style.display = body.style.display === 'none' ? '' : 'none';
}

async function quickSubmit(fid) {
  const hs = parseInt(document.getElementById('sh_'+fid)?.value);
  const as = parseInt(document.getElementById('sa_'+fid)?.value);
  if (isNaN(hs) || isNaN(as) || hs < 0 || as < 0) { toast('Enter valid scores', 'warning'); return; }
  await submitFixtureResult(fid, hs, as);
}
async function editResult(fid) {
  const f = state.fixtures.find(x => x.id == fid); if (!f) return;
  const body = `
    <div style="display:flex;align-items:center;gap:14px;padding:16px;background:var(--deep);border-radius:10px;margin-bottom:16px">
      <span style="flex:1;text-align:right;font-family:var(--ff-ui);font-size:15px;font-weight:700">${getPlayerName(f.home)}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="edit-home" class="score-box" value="${f.home_score||0}" style="width:44px;height:44px">
        <span style="color:var(--muted);font-family:var(--ff-hud)">—</span>
        <input type="number" id="edit-away" class="score-box" value="${f.away_score||0}" style="width:44px;height:44px">
      </div>
      <span style="flex:1;text-align:left;font-family:var(--ff-ui);font-size:15px;font-weight:700">${getPlayerName(f.away)}</span>
    </div>
    <button class="btn btn-red" style="width:100%;justify-content:center" onclick="saveEditResult(${f.id})">Save Result</button>`;
  document.getElementById('modal-result-body').innerHTML = body;
  openModal('modal-submit-result');
}
async function saveEditResult(fid) {
  const hs = parseInt(document.getElementById('edit-home').value);
  const as = parseInt(document.getElementById('edit-away').value);
  if (isNaN(hs)||isNaN(as)||hs<0||as<0) { toast('Invalid scores','warning'); return; }
  await submitFixtureResult(fid, hs, as, true);
  closeModal('modal-submit-result');
}
async function submitFixtureResult(fid, hs, as, isEdit=false) {
  const f = state.fixtures.find(x => x.id == fid); if (!f) return;
  f.home_score = hs; f.away_score = as; f.played = true;
  state.matchLog.unshift({ id:Date.now(), group:state.groups.find(g=>g.id===f.group_id)?.name||'Group', match:`${getPlayerName(f.home)} vs ${getPlayerName(f.away)}`, score:`${hs}–${as}`, time:new Date().toLocaleTimeString() });
  await saveData('fixtures', state.fixtures);
  await saveData('match_log', state.matchLog);
  recalcAllStandings();
  renderPublicView();
  renderResultsSection();
  updateDashboard();
  updatePendingBadge();
  toast(isEdit ? 'Result updated!' : 'Result submitted!', 'success');
}

async function undoLastResult() {
  if (!state.matchLog.length) { toast('No results to undo','warning'); return; }
  const last = state.matchLog[0];
  state.fixtures.forEach(f => {
    if (f.played && `${getPlayerName(f.home)} vs ${getPlayerName(f.away)}` === last.match) {
      f.played = false; f.home_score = null; f.away_score = null;
    }
  });
  state.knockout.forEach(f => {
    if (f.played && `${getPlayerName(f.home)} vs ${getPlayerName(f.away)}` === last.match) {
      f.played = false; f.home_score = null; f.away_score = null; f.winner = null;
      if (f.legs) f.legs = [];
    }
  });
  state.matchLog.shift();
  await saveData('fixtures', state.fixtures);
  await saveData('knockout_matches', state.knockout);
  await saveData('match_log', state.matchLog);
  recalcAllStandings();
  renderAll();
  toast('Last result undone','success');
}

/* ─── KNOCKOUT ─── */
function getKnockoutSlots(round) {
  return {R32:32, R16:16, QF:8, SF:4, F:2}[round] || 16;
}

function countSameGroupConflicts(pairs) {
  return pairs.filter(pair => pair.home && pair.away && pair.home.groupName === pair.away.groupName).length;
}

function buildInitialKnockoutPairs(qualified, firstRound) {
  const slots = getKnockoutSlots(firstRound);
  const players = qualified.map(q => ({...q}));
  const byesNeeded = Math.max(0, slots - players.length);
  const entries = [...players, ...Array.from({length: byesNeeded}, () => null)];
  let bestPairs = null;
  let bestConflicts = Infinity;

  for (let attempt = 0; attempt < 700; attempt++) {
    const pool = [...entries].sort(() => Math.random() - 0.5);
    const pairs = [];

    while (pool.length) {
      const home = pool.shift();
      let idx = pool.findIndex(away => !home || !away || home.groupName !== away.groupName);
      if (idx < 0) idx = 0;
      const away = pool.splice(idx, 1)[0] || null;
      pairs.push({ home, away });
    }

    const conflicts = countSameGroupConflicts(pairs);
    if (conflicts < bestConflicts) {
      bestPairs = pairs;
      bestConflicts = conflicts;
      if (conflicts === 0) break;
    }
  }

  return bestPairs.map(pair => ({
    home: pair.home?.player_id || null,
    away: pair.away?.player_id || null,
    homeGroup: pair.home?.groupName || '',
    awayGroup: pair.away?.groupName || ''
  }));
}

async function generateKnockout() {
  if (!state.tournament) { toast('No tournament','warning'); return; }
  const legsEl = document.querySelector('input[name="ko-legs"]:checked');
  const startEl = document.querySelector('input[name="ko-start-round"]:checked');
  state.koLegs = legsEl ? parseInt(legsEl.value) : 1;
  const firstRound = startEl?.value || 'R16';
  const slots = getKnockoutSlots(firstRound);
  const qualified = getQualified();

  if (qualified.length < 2) { toast('Not enough qualified players','warning'); return; }
  if (qualified.length > slots) {
    toast(`Too many qualified players for ${KO_LABELS[firstRound]}. Choose a bigger starting round.`, 'warning');
    return;
  }

  if (!confirm(`Generate knockout from ${KO_LABELS[firstRound]} with ${qualified.length}/${slots} players? Same-group matches will be avoided when possible.`)) return;

  const paired = buildInitialKnockoutPairs(qualified, firstRound);
  state.knockout = [];
  let mid = Date.now();

  const roundOrder = KO_ROUNDS.slice(KO_ROUNDS.indexOf(firstRound));
  let matchesInRound = slots / 2;
  roundOrder.forEach((round, ri) => {
    const isLast = round === 'F';
    const legs = (isLast || state.koLegs === 1) ? 1 : 2;
    for (let m = 0; m < matchesInRound; m++) {
      const f = {
        id: mid++, round, match_num: m+1, stage: 'ko', legs,
        home: ri===0 ? (paired[m]?.home||null) : null,
        away: ri===0 ? (paired[m]?.away||null) : null,
        home_group: ri===0 ? (paired[m]?.homeGroup||'') : '',
        away_group: ri===0 ? (paired[m]?.awayGroup||'') : '',
        home_score: null, away_score: null, played: false, winner: null,
        leg_results: []
      };
      if (ri===0 && f.home && !f.away) { f.winner = f.home; f.played = true; }
      if (ri===0 && !f.home && f.away) { f.winner = f.away; f.played = true; }
      state.knockout.push(f);
    }
    matchesInRound = Math.max(1, matchesInRound/2);
  });

  // Auto-advance bye winners into the next round after the full bracket exists.
  state.knockout.filter(f => f.round === firstRound && f.winner).forEach(advanceKnockout);

  state.currentKoRound = firstRound;
  state.tournament.ko_start_round = firstRound;
  await saveData('knockout_matches', state.knockout);
  await saveData('tournaments', state.tournament);
  renderPublicView();
  renderKoAdminSection();
  toast('Knockout bracket generated!', 'success');
}

function advanceKnockout(f) {
  const ri = KO_ROUNDS.indexOf(f.round);
  if (ri < 0 || ri >= KO_ROUNDS.length-1) return;
  const next = state.knockout.find(x => x.round===KO_ROUNDS[ri+1] && x.match_num===Math.ceil(f.match_num/2));
  if (!next) return;
  if (f.match_num%2===1) next.home = f.winner; else next.away = f.winner;
}

function calcAggregate(f) {
  if (!f.leg_results || !f.leg_results.length) return null;
  let homeTotal = 0, awayTotal = 0;
  f.leg_results.forEach(l => { homeTotal += parseInt(l.home)||0; awayTotal += parseInt(l.away)||0; });
  return { home: homeTotal, away: awayTotal };
}

function renderKoAdminSection() {
  const tabsEl = document.getElementById('ko-admin-round-tabs');
  const matchEl = document.getElementById('ko-admin-matches');
  if (!state.knockout.length) {
    tabsEl.innerHTML = '';
    matchEl.innerHTML = '<div class="empty-state" style="padding:30px"><span class="ei" style="font-size:28px">⚔️</span><p>Generate knockout first</p></div>';
    return;
  }
  const rounds = [...new Set(state.knockout.map(m => m.round))];
  tabsEl.innerHTML = rounds.map(r => `<button class="ko-tab${state.currentKoRound===r?' active':''}" onclick="switchKoRound('${r}')">${KO_LABELS[r]||r}</button>`).join('');
  const matches = state.knockout.filter(m => m.round === state.currentKoRound);
  matchEl.innerHTML = '<div class="fixture-list">' + matches.map(f => {
    const home = f.home ? getPlayerName(f.home) : 'TBD', away = f.away ? getPlayerName(f.away) : 'TBD';
    const agg = calcAggregate(f);
    return `
    <div class="result-match-card ${f.played?'played-card':''}" id="kmc_${f.id}">
    ${tournamentLogoHtml('card-tournament-logo result-logo')}
      <div class="result-match-top">
        <span class="result-match-player home">${home}</span>
        <div class="result-score-area">
          ${f.played
            ? `<span style="font-family:var(--ff-hud);font-size:20px;font-weight:700;color:var(--gold2);min-width:70px;text-align:center">${agg?`${agg.home}–${agg.away}`:`${f.home_score}–${f.away_score}`}</span>`
            : `<span style="font-family:var(--ff-hud);font-size:10px;letter-spacing:.1em;color:var(--muted)">vs</span>`}
        </div>
        <span class="result-match-player away">${away}</span>
      </div>
      ${agg && f.legs===2 ? `<div style="text-align:center;margin:6px 0"><span class="agg-display">AGG: ${agg.home}–${agg.away}</span></div>` : ''}
      <div class="result-match-bottom">
        <span class="match-status-tag ${f.played?'done':'pending'}">${f.played?'✓ Played':'Pending'}</span>
        <div class="match-action-btns">
          ${f.home && f.away ? `<button class="btn btn-green btn-xs" onclick="openKoResult(${f.id})">⚔️ ${f.played?'Edit':'Submit'}</button>` : ''}
          ${f.winner ? `<span class="winner-tag">🏆 ${getPlayerName(f.winner)}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('') + '</div>';
}

function switchKoRound(r) {
  state.currentKoRound = r;
  renderKoAdminSection();
  renderKnockoutView();
}

async function openKoResult(fid) {
  const f = state.knockout.find(x => x.id == fid); if (!f) return;
  const home = getPlayerName(f.home), away = getPlayerName(f.away);
  const isTwo = f.legs === 2 && f.round !== 'F';
  let legHtml = '';
  if (isTwo) {
    const l1 = f.leg_results?.find(l=>l.leg===1) || {home:'',away:''};
    const l2 = f.leg_results?.find(l=>l.leg===2) || {home:'',away:''};
    legHtml = `
      <div style="margin-bottom:14px">
        <div class="form-label" style="margin-bottom:8px">Leg 1 <span class="ha-badge home">HOME: ${home}</span></div>
        <div style="display:flex;align-items:center;gap:10px;background:var(--deep);padding:12px;border-radius:8px">
          <span style="flex:1;text-align:right;font-family:var(--ff-ui);font-size:14px;font-weight:700">${home}</span>
          <input type="number" id="ko-l1-h" class="score-box" value="${l1.home}" min="0">
          <span style="color:var(--muted)">–</span>
          <input type="number" id="ko-l1-a" class="score-box" value="${l1.away}" min="0">
          <span style="flex:1;font-family:var(--ff-ui);font-size:14px;font-weight:700">${away}</span>
        </div>
        <div class="form-label" style="margin-top:12px;margin-bottom:8px">Leg 2 <span class="ha-badge away">HOME: ${away}</span></div>
        <div style="display:flex;align-items:center;gap:10px;background:var(--deep);padding:12px;border-radius:8px">
          <span style="flex:1;text-align:right;font-family:var(--ff-ui);font-size:14px;font-weight:700">${away}</span>
          <input type="number" id="ko-l2-a" class="score-box" value="${l2.home}" min="0">
          <span style="color:var(--muted)">–</span>
          <input type="number" id="ko-l2-h" class="score-box" value="${l2.away}" min="0">
          <span style="flex:1;font-family:var(--ff-ui);font-size:14px;font-weight:700">${home}</span>
        </div>
        <div id="agg-preview" style="text-align:center;margin-top:10px;font-family:var(--ff-hud);font-size:10px;color:var(--muted)">Enter scores to see aggregate</div>
        <div id="penalties-section" style="display:none;margin-top:12px">
          <div class="form-label">Penalty Shootout (if level on aggregate)</div>
          <div style="display:flex;align-items:center;gap:10px;background:var(--deep);padding:12px;border-radius:8px">
            <span style="flex:1;text-align:right;font-family:var(--ff-ui);font-size:13px">${home}</span>
            <input type="number" id="ko-pen-h" class="score-box" min="0" placeholder="0" style="width:40px;height:40px">
            <span style="color:var(--muted)">–</span>
            <input type="number" id="ko-pen-a" class="score-box" min="0" placeholder="0" style="width:40px;height:40px">
            <span style="flex:1;font-family:var(--ff-ui);font-size:13px">${away}</span>
          </div>
        </div>
      </div>`;
  } else {
    legHtml = `
      <div style="display:flex;align-items:center;gap:10px;background:var(--deep);padding:14px;border-radius:8px;margin-bottom:14px">
        <span style="flex:1;text-align:right;font-family:var(--ff-ui);font-size:15px;font-weight:700">${home}</span>
        <input type="number" id="ko-l1-h" class="score-box" value="${f.home_score??''}" min="0" style="width:44px;height:44px">
        <span style="color:var(--muted);font-family:var(--ff-hud)">–</span>
        <input type="number" id="ko-l1-a" class="score-box" value="${f.away_score??''}" min="0" style="width:44px;height:44px">
        <span style="flex:1;font-family:var(--ff-ui);font-size:15px;font-weight:700">${away}</span>
      </div>
      ${f.round === 'F' || !isTwo ? `<div style="margin-bottom:12px">
        <div id="et-toggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px" onclick="toggleET()">
          <input type="checkbox" id="et-check" style="accent-color:var(--red)"> <span style="font-family:var(--ff-ui);font-size:13px">Extra Time / Penalties?</span>
        </div>
        <div id="et-section" style="display:none">
          <div class="form-label">Extra Time Score (total)</div>
          <div style="display:flex;align-items:center;gap:10px;background:var(--deep);padding:10px;border-radius:8px;margin-bottom:8px">
            <span style="flex:1;text-align:right;font-family:var(--ff-ui);font-size:13px">${home}</span>
            <input type="number" id="ko-et-h" class="score-box" min="0" placeholder="0">
            <span style="color:var(--muted)">–</span>
            <input type="number" id="ko-et-a" class="score-box" min="0" placeholder="0">
            <span style="flex:1;font-family:var(--ff-ui);font-size:13px">${away}</span>
          </div>
          <div class="form-label">Penalty Shootout</div>
          <div style="display:flex;align-items:center;gap:10px;background:var(--deep);padding:10px;border-radius:8px">
            <span style="flex:1;text-align:right;font-family:var(--ff-ui);font-size:13px">${home}</span>
            <input type="number" id="ko-pen-h" class="score-box" min="0" placeholder="0">
            <span style="color:var(--muted)">–</span>
            <input type="number" id="ko-pen-a" class="score-box" min="0" placeholder="0">
            <span style="flex:1;font-family:var(--ff-ui);font-size:13px">${away}</span>
          </div>
        </div>
      </div>` : ''}`;
  }
  document.getElementById('modal-ko-body').innerHTML = `
    ${legHtml}
    <button class="btn btn-red" style="width:100%;justify-content:center" onclick="submitKoResult(${f.id},${isTwo})">Submit Result</button>`;
  if (isTwo) {
    ['ko-l1-h','ko-l1-a','ko-l2-h','ko-l2-a'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => updateAggPreview(home, away));
    });
  }
  openModal('modal-ko-result');
}

function toggleET() {
  const et = document.getElementById('et-section');
  et.style.display = et.style.display === 'none' ? 'block' : 'none';
}
function updateAggPreview(home, away) {
  const l1h = parseInt(document.getElementById('ko-l1-h')?.value)||0;
  const l1a = parseInt(document.getElementById('ko-l1-a')?.value)||0;
  const l2a = parseInt(document.getElementById('ko-l2-a')?.value)||0;
  const l2h = parseInt(document.getElementById('ko-l2-h')?.value)||0;
  const totalHome = l1h + l2h, totalAway = l1a + l2a;
  const prev = document.getElementById('agg-preview');
  if (prev) {
    prev.innerHTML = `AGG: <strong style="color:var(--gold2)">${totalHome}–${totalAway}</strong>${totalHome===totalAway?' — <span style="color:var(--gold2)">Penalties may be needed</span>':''}`;
    document.getElementById('penalties-section').style.display = totalHome===totalAway?'block':'none';
  }
}

async function submitKoResult(fid, isTwoLeg) {
  const f = state.knockout.find(x => x.id == fid); if (!f) return;
  let winner = null;
  if (isTwoLeg) {
    const l1h = parseInt(document.getElementById('ko-l1-h')?.value);
    const l1a = parseInt(document.getElementById('ko-l1-a')?.value);
    const l2a = parseInt(document.getElementById('ko-l2-a')?.value) || 0;
    const l2h = parseInt(document.getElementById('ko-l2-h')?.value) || 0;
    if (isNaN(l1h)||isNaN(l1a)) { toast('Enter leg 1 scores','warning'); return; }
    f.leg_results = [{leg:1,home:l1h,away:l1a},{leg:2,home:l2a,away:l2h}];
    const totalHome = l1h + l2h, totalAway = l1a + l2a;
    f.home_score = totalHome; f.away_score = totalAway;
    if (totalHome > totalAway) winner = f.home;
    else if (totalAway > totalHome) winner = f.away;
    else {
      const ph = parseInt(document.getElementById('ko-pen-h')?.value)||0;
      const pa = parseInt(document.getElementById('ko-pen-a')?.value)||0;
      winner = ph > pa ? f.home : f.away;
      f.penalties = {home:ph, away:pa};
    }
  } else {
    const hs = parseInt(document.getElementById('ko-l1-h')?.value);
    const as = parseInt(document.getElementById('ko-l1-a')?.value);
    if (isNaN(hs)||isNaN(as)) { toast('Enter scores','warning'); return; }
    f.home_score = hs; f.away_score = as;
    const etCheck = document.getElementById('et-check');
    if (etCheck?.checked) {
      const eth = parseInt(document.getElementById('ko-et-h')?.value)||0;
      const eta = parseInt(document.getElementById('ko-et-a')?.value)||0;
      const ph  = parseInt(document.getElementById('ko-pen-h')?.value)||0;
      const pa  = parseInt(document.getElementById('ko-pen-a')?.value)||0;
      if (eth !== eta) winner = eth > eta ? f.home : f.away;
      else if (ph > 0 || pa > 0) winner = ph > pa ? f.home : f.away;
      f.extra_time = {home:eth,away:eta}; f.penalties = {home:ph,away:pa};
    }
    if (!winner) winner = hs > as ? f.home : as > hs ? f.away : f.home;
  }
  f.winner = winner; f.played = true;
  state.matchLog.unshift({id:Date.now(), group:f.round, match:`${getPlayerName(f.home)} vs ${getPlayerName(f.away)}`, score:`${f.home_score}–${f.away_score}`, time:new Date().toLocaleTimeString()});
  advanceKnockout(f);
  await saveData('knockout_matches', state.knockout);
  await saveData('match_log', state.matchLog);
  closeModal('modal-ko-result');
  renderKoAdminSection();
  renderPublicView();
  updateDashboard();
  checkChampion();
  toast('KO Result submitted!', 'success');
}

function checkChampion() {
  const final = state.knockout.find(f => f.round === 'F' && f.played && f.winner);
  const el = document.getElementById('champion-display');
  if (final) {
    const name = getPlayerName(final.winner);
    el.style.display = 'block';
    el.innerHTML = `<div class="champion-card"><span class="champion-trophy">🏆</span><div class="champion-title">Season ${state.tournament?.season||''} Champion</div><div class="champion-name">${name}</div></div>`;
  } else { el.style.display = 'none'; }
}

/* ─── PUBLIC RENDER ─── */
function renderPublicView() {
  updateStatusBar();
  const hasTournament = !!state.tournament;
  document.getElementById('stage-tabs').style.display = hasTournament ? 'flex' : 'none';
  renderGroupStage();
  renderKnockoutView();
  checkChampion();
}

function renderGroupStage() {
  const c = document.getElementById('groups-container');
  if (!state.tournament) { c.innerHTML = '<div class="empty-state"><span class="ei">🏟️</span><h3>No Tournament</h3><p>Admin creates the tournament.</p></div>'; return; }
  if (state.groups.every(g => !g.players || !g.players.length)) { c.innerHTML = '<div class="empty-state"><span class="ei">👥</span><h3>Waiting for Setup</h3><p>Admin is setting up groups.</p></div>'; return; }
  c.innerHTML = '<div class="groups-grid">' + state.groups.map(g => {
    if (!g.players || !g.players.length) return '';
    const sorted = getSortedStandings(g.id);
    const gf = state.fixtures.filter(f => f.group_id === g.id && f.stage === 'group');
    const maxRound = gf.length ? Math.max(...gf.map(f => f.round||1)) : 0;
    return `
    <div class="group-card">
      <div class="group-header"><span class="group-name">${g.name}</span><span class="group-count">${g.players.length} players</span></div>
      <div class="group-body">
        <table class="standings-table" style="margin-top:12px">
          <thead><tr><th>#</th><th>Player</th><th>P</th><th>GD</th><th>PTS</th></tr></thead>
          <tbody>${sorted.map((row,i)=>{const isQ=i<getAdvanceCount();return`<tr class="${isQ?'qualified':''}"><td><span class="rank-num">${i+1}</span></td><td><span class="standing-player">${playerAvatarHtml(getPlayer(row.player_id), 'player-avatar tiny')}<span>${row.name}</span></span></td><td>${row.p}</td><td>${row.gd>0?'+':''}${row.gd}</td><td class="pts-col">${row.pts}</td></tr>`}).join('')}</tbody>
        </table>
        <div class="q-badge">✦ Top ${getAdvanceCount()} Advance</div>
        ${maxRound > 0 ? `<div class="divider"></div><div style="font-family:var(--ff-hud);font-size:9px;letter-spacing:.2em;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Fixtures by Round</div>
          ${Array.from({length:maxRound},(_,ri)=>{
            const rm = gf.filter(f=>(f.round||1)===ri+1);
            return`<div style="margin-bottom:10px"><div style="font-family:var(--ff-hud);font-size:8px;color:var(--muted);letter-spacing:.15em;margin-bottom:5px">ROUND ${ri+1}</div>
              <div class="fixture-list">${rm.map(f=>`<div class="fixture-card${f.played?' played':''}">
                ${tournamentLogoHtml()}
                ${fixturePlayerHtml(f.home, 'left')}
                <div class="score-zone">${f.played?`<span class="score-shown">${f.home_score}–${f.away_score}</span>`:'<span class="vs-label">VS</span>'}</div>
                ${fixturePlayerHtml(f.away, 'right')}
              </div>`).join('')}</div></div>`}).join('')}` : ''}
      </div>
    </div>`;
  }).join('') + '</div>';
}

function renderKnockoutView() {
  if (!state.tournament) return;
  const rounds = [...new Set(state.knockout.map(m => m.round))];
  const tabsEl = document.getElementById('ko-round-tabs'), matchEl = document.getElementById('ko-matches-container');
  if (!rounds.length) { tabsEl.innerHTML=''; matchEl.innerHTML='<div class="empty-state"><span class="ei">⚔️</span><h3>Knockout Not Started</h3><p>Group stage must complete first.</p></div>'; renderBracket(); return; }
  tabsEl.innerHTML = rounds.map(r => `<button class="ko-tab${state.currentKoRound===r?' active':''}" onclick="pubSwitchKo('${r}')">${KO_LABELS[r]||r}</button>`).join('');
  const matches = state.knockout.filter(m => m.round === state.currentKoRound);
  matchEl.innerHTML = '<div class="fixture-list">' + matches.map(f => {
    const home = f.home?getPlayerName(f.home):'TBD', away = f.away?getPlayerName(f.away):'TBD';
    const winner = f.winner ? getPlayerName(f.winner) : null;
    const agg = calcAggregate(f);
    const score = f.played ? (agg ? `${agg.home}–${agg.away}` : `${f.home_score}–${f.away_score}`) : null;
    return `<div class="fixture-card${f.played?' played':''}">
      ${tournamentLogoHtml()}
      ${fixturePlayerHtml(f.home, 'left', winner===home?'color:var(--gold2)':'')}
      <div class="score-zone">${score ? `<span class="score-shown">${score}</span>` : '<span class="vs-label">VS</span>'}</div>
      ${fixturePlayerHtml(f.away, 'right', winner===away?'color:var(--gold2)':'')}
    </div>`;
  }).join('') + '</div>';
  renderBracket();
}
function pubSwitchKo(r) { state.currentKoRound = r; renderKnockoutView(); }

function renderBracket() {
  const el = document.getElementById('bracket-display');
  const rounds = [...new Set(state.knockout.map(m => m.round))];
  if (!rounds.length) { el.innerHTML = '<div class="empty-state" style="padding:20px"><span class="ei" style="font-size:28px">⚔️</span><p>No bracket yet</p></div>'; return; }
  el.innerHTML = rounds.map(r => {
    const matches = state.knockout.filter(m => m.round === r);
    return `<div class="bracket-round">
      <div class="bracket-round-title">${KO_LABELS[r]||r}</div>
      <div class="bracket-matches">${matches.map(f => {
        const home=f.home?getPlayerName(f.home):'TBD', away=f.away?getPlayerName(f.away):'TBD';
        const agg = calcAggregate(f);
        const hs = agg?agg.home:f.home_score, as = agg?agg.away:f.away_score;
        return `<div class="bracket-match">
          ${tournamentLogoHtml('bracket-logo')}
          <div class="bracket-team${f.winner==f.home?' winner':f.played?' loser':''}">
            <span class="bracket-team-name">${home}</span>
            <span class="bracket-score${f.winner==f.home?' ws':''}">${f.played?hs:''}</span>
          </div>
          <div class="bracket-team${f.winner==f.away?' winner':f.played?' loser':''}">
            <span class="bracket-team-name">${away}</span>
            <span class="bracket-score${f.winner==f.away?' ws':''}">${f.played?as:''}</span>
          </div>
        </div>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}

/* ─── SEASON HISTORY ─── */
async function archiveCurrentSeason() {
  if (!state.tournament) { toast('No active tournament','warning'); return; }
  if (!confirm(`Archive Season ${state.tournament.season}?`)) return;
  const archive = {
    id: Date.now(),
    season: state.tournament.season,
    name: state.tournament.name,
    tournament: {...state.tournament},
    players: [...state.players],
    groups: JSON.parse(JSON.stringify(state.groups)),
    fixtures: [...state.fixtures],
    knockout: [...state.knockout],
    standings: JSON.parse(JSON.stringify(state.standings)),
    champion: null,
    archived_at: new Date().toISOString()
  };
  const final = state.knockout.find(f => f.round==='F' && f.played && f.winner);
  if (final) archive.champion = getPlayerName(final.winner);
  state.seasons.push(archive);
  await saveData('seasons', state.seasons);
  toast(`Season ${state.tournament.season} archived!`, 'success');
  renderHistoryView();
  renderSeasonsAdmin();
  renderSeasonDropdown();
}

function renderSeasonDropdown() {
  const sel = document.getElementById('public-season-select');
  const current = document.createElement('option');
  current.value = 'current'; current.textContent = `Current (S${state.tournament?.season||'?'})`;
  sel.innerHTML = '';
  sel.appendChild(current);
  [...state.seasons].reverse().forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id; opt.textContent = `Season ${s.season}`;
    sel.appendChild(opt);
  });
}

function loadSeasonData(id) {
  if (id === 'current') { renderPublicView(); return; }
  const season = state.seasons.find(s => s.id == id);
  if (!season) return;
  showSeasonView(season);
}

function showSeasonView(season) {
  const el = document.getElementById('modal-season-body');
  const final = season.knockout?.find(f => f.round==='F' && f.played && f.winner);
  const champion = season.champion || (final ? (season.players?.find(p=>p.id==final.winner)?.name||'?') : null);
  el.innerHTML = `
    <div class="champion-card" style="margin-bottom:16px">
      <span class="champion-trophy">🏆</span>
      <div class="champion-title">Season ${season.season} Champion</div>
      <div class="champion-name">${champion||'TBD'}</div>
      <div style="font-family:var(--ff-hud);font-size:9px;color:var(--muted);margin-top:8px">${season.name} · Archived ${new Date(season.archived_at).toLocaleDateString()}</div>
    </div>
    <div style="margin-bottom:16px">
      <div class="card-title" style="font-size:16px">Group Standings</div>
      <div class="groups-grid">
        ${(season.groups||[]).map(g => {
          const gStand = season.standings?.[g.id];
          if (!gStand) return '';
          const sorted = Object.values(gStand).sort((a,b)=>b.pts-a.pts||b.gd-a.gd);
          return `<div class="group-card"><div class="group-header"><span class="group-name">${g.name}</span></div>
            <div class="group-body"><table class="standings-table" style="margin-top:10px"><thead><tr><th>#</th><th>Player</th><th>P</th><th>GD</th><th>PTS</th></tr></thead><tbody>
            ${sorted.map((r,i)=>`<tr class="${i<(season.tournament?.advance_players||2)?'qualified':''}"><td><span class="rank-num">${i+1}</span></td><td>${r.name}</td><td>${r.p}</td><td>${r.gd>0?'+':''}${r.gd}</td><td class="pts-col">${r.pts}</td></tr>`).join('')}
            </tbody></table></div></div>`;
        }).join('')}
      </div>
    </div>`;
  openModal('modal-season-view');
}

function renderHistoryView() {
  const el = document.getElementById('history-container');
  if (!state.seasons.length) { el.innerHTML = '<div class="empty-state"><span class="ei">📚</span><h3>No History Yet</h3><p>Archive a season to see it here.</p></div>'; return; }
  el.innerHTML = '<div class="season-history-grid">' + [...state.seasons].reverse().map(s => `
    <div class="season-hist-card" onclick="showSeasonView(state.seasons.find(x=>x.id==${s.id}))">
      <div class="season-hist-num">S${s.season}</div>
      <div class="season-hist-name">${s.name}</div>
      ${s.champion ? `<div class="season-hist-champion"><span class="trophy">🏆</span>${s.champion}</div>` : '<div style="font-size:12px;color:var(--muted)">No champion recorded</div>'}
      <div class="season-hist-meta">${s.players?.length||0} players · ${s.groups?.length||0} groups · ${new Date(s.archived_at).toLocaleDateString()}</div>
    </div>`).join('') + '</div>';
}

function renderSeasonsAdmin() {
  const el = document.getElementById('seasons-admin-list');
  if (!state.seasons.length) { el.innerHTML = '<div class="empty-state" style="padding:20px"><span class="ei" style="font-size:28px">📚</span><p>No archived seasons</p></div>'; return; }
  el.innerHTML = [...state.seasons].reverse().map(s => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.04);">
      <div style="font-family:var(--ff-title);font-size:28px;letter-spacing:.1em;color:var(--white);min-width:50px">S${s.season}</div>
      <div style="flex:1"><div style="font-family:var(--ff-ui);font-size:14px;font-weight:700">${s.name}</div>
        ${s.champion?`<div style="font-family:var(--ff-hud);font-size:9px;color:var(--gold2)">🏆 ${s.champion}</div>`:''}
        <div style="font-family:var(--ff-hud);font-size:8px;color:var(--muted)">${new Date(s.archived_at).toLocaleDateString()}</div>
      </div>
      <button class="btn btn-ghost btn-xs" onclick="showSeasonView(state.seasons.find(x=>x.id==${s.id}))">View</button>
    </div>`).join('');
}

/* ─── RESET / DELETE ─── */
async function resetTournament() {
  if (!confirm('Reset tournament? Clears all fixtures but keeps players.')) return;
  state.fixtures = []; state.knockout = []; state.matchLog = [];
  state.groups.forEach(g => g.players = []);
  await saveData('fixtures',[]); await saveData('knockout_matches',[]); await saveData('match_log',[]); await saveData('groups',state.groups);
  recalcAllStandings(); renderAll();
  closeModal('modal-danger'); toast('Tournament reset','success');
}
async function clearMatchLog() {
  if (!confirm('Clear match log?')) return;
  state.matchLog = []; await saveData('match_log',[]);
  renderMatchLog(); toast('Match log cleared','success');
}
async function deleteTournament() {
  if (!confirm('Delete entire tournament? This cannot be undone!')) return;
  state.tournament=null; state.players=[]; state.groups=[]; state.fixtures=[]; state.knockout=[]; state.matchLog=[];
  ['tournaments','players','groups','fixtures','knockout_matches','match_log'].forEach(k=>{ if(state.localMode) localStorage.removeItem('wvy_'+k); });
  renderAll(); closeModal('modal-danger'); toast('Tournament deleted','success');
}

/* ─── CHANGE SEASON ─── */
async function changeSeason() {
  const s = parseInt(document.getElementById('season-input').value);
  if (!s||s<1) { toast('Invalid season number','warning'); return; }
  document.getElementById('season-badge').textContent = 'Season '+s;
  document.getElementById('sb-season-txt').textContent = 'Season '+s;
  document.title = 'Who vs You? – eTournament Season '+s;
  if (state.tournament) { state.tournament.season=s; await saveData('tournaments',state.tournament); }
  toast('Season '+s+' applied!','success');
}

/* ─── MATCH LOG ─── */
function renderMatchLog() {
  const tbody = document.getElementById('match-log-body');
  if (!tbody) return;
  tbody.innerHTML = state.matchLog.map((e,i) => `<tr><td>${i+1}</td><td>${e.group}</td><td>${e.match}</td><td style="font-family:var(--ff-hud);color:var(--gold2)">${e.score}</td><td style="color:var(--muted)">${e.time}</td></tr>`).join('');
}

/* ─── EXPORT ─── */
function exportData() {
  const data = { tournament:state.tournament, players:state.players, groups:state.groups, fixtures:state.fixtures, knockout:state.knockout, matchLog:state.matchLog, seasons:state.seasons };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download = 'whovyou-tournament.json'; a.click();
  toast('Data exported!','success');
}

/* ─── UTILS ─── */
function getPlayer(pid) { return state.players.find(x => x.id == pid); }
function getPlayerName(pid) { const p = getPlayer(pid); return p ? p.name : (pid||'TBD'); }

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

function toast(msg, type='error') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast ' + (type==='success'?'success':type==='warning'?'warning':type==='info'?'info':'');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('exit');
    setTimeout(() => el.remove(), 350);
  }, 3000);
}

/* ─── INIT ─── */
window.addEventListener('load', async () => {
  spawnParticles();
  const savedPbUrl = localStorage.getItem('wvy_pb_url') || PB_DEFAULT_URL;
  state.pocketbaseUrl = savedPbUrl;
  const pbUrlInput = document.getElementById('pb-url');
  if (pbUrlInput) pbUrlInput.value = savedPbUrl;

  // Try PocketBase first. If it is not running, the site falls back to Local Mode.
  if (typeof PocketBase !== 'undefined') {
    try {
      state.pocketbase = new PocketBase(savedPbUrl);
      // 5-second timeout so page never hangs if PocketBase is unreachable
      await Promise.race([
        state.pocketbase.health.check(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
      ]);
      state.localMode = false;
      const card = document.getElementById('pocketbase-config-card');
      if (card) card.style.display = 'none';
      setAdminStatus('green', 'Connected to PocketBase: ' + savedPbUrl);
    } catch (e) {
      state.pocketbase = null;
      state.localMode = true;
      setAdminStatus('gold', 'Local Mode — PocketBase not reachable (' + e.message + ')');
    }
  } else {
    state.localMode = true;
    setAdminStatus('gold', 'Local Mode (no PocketBase SDK)');
  }
  loadAll();
});