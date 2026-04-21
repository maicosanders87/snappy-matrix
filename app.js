// ========== CHART REGISTRY (destroy before recreate to prevent memory leaks) ==========
var _chartRegistry = {};
function createChart(canvasId, config) {
  if (_chartRegistry[canvasId]) {
    _chartRegistry[canvasId].destroy();
    delete _chartRegistry[canvasId];
  }
  var canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
  if (!canvas) return null;
  var ctx = canvas.getContext ? canvas.getContext('2d') : canvas;
  var chart = new Chart(ctx, config);
  _chartRegistry[canvas.id || canvasId] = chart;
  return chart;
}

// ========== SCORE BREAKDOWN PDF DOWNLOAD ==========
function downloadScorePDF(techShort) {
  if (typeof TECH_SCORE_PDFS === 'undefined' || !TECH_SCORE_PDFS[techShort]) {
    alert('Score breakdown PDF not available for ' + techShort);
    return;
  }
  var b64 = TECH_SCORE_PDFS[techShort];
  var byteChars = atob(b64);
  var byteNumbers = new Array(byteChars.length);
  for (var i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  var byteArray = new Uint8Array(byteNumbers);
  var blob = new Blob([byteArray], { type: 'application/pdf' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = techShort.toLowerCase() + '_score_breakdown.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

// ========== SHARE MATRIX ==========
// Build a shareable URL with the sync URL baked in so recipients auto-configure.
function _buildShareUrl() {
  var base = window.location.href.split('#')[0];
  try {
    var u = localStorage.getItem('snappy_sync_url') || '';
    if (u && u.length > 10) {
      return base + '#sync=' + encodeURIComponent(u);
    }
  } catch (e) {}
  return base;
}
function shareMatrix() {
  const shareUrl = _buildShareUrl();
  const shareTitle = 'Snappy Services — Tech Skills Matrix';
  const shareText = 'Check out the Snappy Services Tech Skills Matrix';
  if (navigator.share) {
    navigator.share({ title: shareTitle, text: shareText, url: shareUrl }).catch(function() {});
  } else {
    navigator.clipboard.writeText(shareUrl).then(function() {
      var btn = document.querySelector('.share-matrix-btn');
      var orig = btn.innerHTML;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      btn.style.background = 'rgba(45,212,191,0.25)';
      setTimeout(function() { btn.innerHTML = orig; btn.style.background = ''; }, 2000);
    }).catch(function() {
      prompt('Copy this link to share:', shareUrl);
    });
  }
}

// ========== ACCESS CONTROL (Manager vs Viewer vs Coach vs Editor) ==========
const MGR_PIN = 'sanders';
const COACH_PINS = {
  'Nexstar': 'Jay / Greg',
  'AdamB': 'Adam'
};
const EDITOR_PINS = {
  'OPM': 'Judah'
};
let isManagerMode = localStorage.getItem('snappy_mgr_mode') === 'true';
let isCoachMode = localStorage.getItem('snappy_coach_mode') === 'true';
let isEditorMode = localStorage.getItem('snappy_editor_mode') === 'true';
let coachName = localStorage.getItem('snappy_coach_name') || '';
let editorName = localStorage.getItem('snappy_editor_name') || '';

function applyViewMode() {
  document.body.classList.remove('viewer-mode', 'manager-mode', 'coach-mode', 'editor-mode');
  if (isManagerMode) {
    document.body.classList.add('manager-mode');
  } else if (isEditorMode) {
    document.body.classList.add('editor-mode');
  } else if (isCoachMode) {
    document.body.classList.add('coach-mode');
  } else {
    document.body.classList.add('viewer-mode');
  }
  // Update header subtitle
  var sub = document.getElementById('headerSubtitle');
  if (sub) {
    if (isManagerMode) sub.textContent = 'Tech Skills Matrix \u2014 Manager View';
    else if (isEditorMode) sub.textContent = 'Tech Skills Matrix \u2014 Editor View (' + editorName + ')';
    else if (isCoachMode) sub.textContent = 'Tech Skills Matrix \u2014 Coach View (' + coachName + ')';
    else sub.textContent = 'Tech Skills Matrix \u2014 Viewer Mode';
  }
  // Update lock icon (open vs closed)
  var lockSvg = document.getElementById('lockIcon');
  if (lockSvg) {
    lockSvg.innerHTML = (isManagerMode || isCoachMode || isEditorMode)
      ? '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5"/>'
      : '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
  }
  // Show/hide editor instructions banner
  var editorBanner = document.getElementById('editorInstructionsBanner');
  if (editorBanner) editorBanner.style.display = isEditorMode ? 'block' : 'none';
  // Re-render profiles so manager edit buttons appear/disappear
  if (typeof renderProfiles === 'function') { try { renderProfiles(); } catch(e) {} }
  // If switching to viewer while on Manager tab, redirect to Overview
  if (!isManagerMode && !isCoachMode && !isEditorMode) {
    var activeTab = document.querySelector('.nav-tabs:not(#st-sub-tabs):not(#as-sub-tabs):not(#sk-sub-tabs):not(#mgr-sub-tabs) .nav-tab.active');
    if (activeTab && activeTab.dataset.view === 'manager') {
      activeTab.classList.remove('active');
      document.querySelectorAll('.view-section').forEach(function(s) { s.classList.remove('active'); });
      var overviewTab = document.querySelector('.nav-tab[data-view="overview"]');
      if (overviewTab) overviewTab.classList.add('active');
      var overviewView = document.getElementById('view-overview');
      if (overviewView) overviewView.classList.add('active');
    }
  }
}

// ---- Silent Cloud Sync on Login ----
async function silentSyncOnLogin() {
  if (!SyncEngine.isConfigured()) return;
  try {
    var cloudData = await SyncEngine.pull();
    if (!cloudData) return;
    var keyMap = {
      'skills': 'snappy_skills_assignments',
      'manager': 'snappy_manager_entries',
      'techfiles': 'snappy_tech_files',
      'dispatch': 'snappy_dispatch_v1',
      'dailyduties': 'snappy_daily_duties',
      'mgrstats': 'snappy_mgr_stats',
      'daynotes': 'snappy_day_notes',
      'nexstar': 'snappy_nexstar',
      'bulletin': 'snappy_bulletin_board',
      'recall': 'snappy_recall_log_v1',
      'complaint': 'snappy_complaint_log_v1',
      'mgrnotes': 'snappy_mgr_notes_v1'
    };
    var updated = false;
    for (var ck in keyMap) {
      if (cloudData[ck] !== undefined && cloudData[ck] !== null) {
        var cv = (typeof _extractCloudVal === 'function')
          ? _extractCloudVal(cloudData[ck])
          : (cloudData[ck].data || cloudData[ck].val || '');
        if (!cv) continue;
        var lv = localStorage.getItem(keyMap[ck]) || '';
        if (ck === 'techfiles') {
          var merged = _mergeTechFiles(lv, cv);
          if (merged !== lv) { localStorage.setItem(keyMap[ck], merged); updated = true; }
        } else if (cv !== lv) {
          localStorage.setItem(keyMap[ck], cv);
          updated = true;
        }
      }
    }
    if (updated) {
      console.log('Login sync: cloud data merged — refreshing views');
      if (typeof _rerenderAllViewsAfterSync === 'function') {
        _rerenderAllViewsAfterSync();
      }
    } else {
      console.log('Login sync: already up to date');
    }
  } catch(e) {
    console.warn('Login sync error (non-blocking):', e);
  }
}

// ---- View Switcher (Manager-only dropdown) ----
function switchToView(mode, name) {
  isManagerMode = false; isCoachMode = false; isEditorMode = false;
  coachName = ''; editorName = '';
  localStorage.removeItem('snappy_mgr_mode'); localStorage.removeItem('snappy_coach_mode');
  localStorage.removeItem('snappy_coach_name'); localStorage.removeItem('snappy_editor_mode');
  localStorage.removeItem('snappy_editor_name');
  if (mode === 'manager') {
    isManagerMode = true; localStorage.setItem('snappy_mgr_mode', 'true');
  } else if (mode === 'editor') {
    isEditorMode = true; editorName = name || 'Judah';
    localStorage.setItem('snappy_editor_mode', 'true'); localStorage.setItem('snappy_editor_name', editorName);
  } else if (mode === 'coach') {
    isCoachMode = true; coachName = name || '';
    localStorage.setItem('snappy_coach_mode', 'true'); localStorage.setItem('snappy_coach_name', coachName);
  }
  // mode === 'viewer' leaves everything false
  closeViewSwitcher();
  applyViewMode();
  // Auto-sync cloud data on view switch
  silentSyncOnLogin();
}

function openViewSwitcher() {
  var dd = document.getElementById('viewSwitcherDropdown');
  if (!dd) return;
  var currentView = isManagerMode ? 'manager' : isEditorMode ? 'editor' : isCoachMode ? 'coach' : 'viewer';
  var views = [
    { id: 'manager', label: 'Manager', icon: '\u1F6E1', desc: 'Full edit access' },
    { id: 'editor', label: 'Editor (Judah)', icon: '\u270F', desc: 'Dispatch edit access', name: 'Judah' },
    { id: 'coach-jg', label: 'Coach (Jay / Greg)', icon: '\uD83D\uDC53', desc: 'View-only', name: 'Jay / Greg' },
    { id: 'coach-adam', label: 'Coach (Adam)', icon: '\uD83D\uDC53', desc: 'View-only', name: 'Adam' },
    { id: 'viewer', label: 'Viewer', icon: '\uD83D\uDD12', desc: 'Locked / public view' }
  ];
  var html = '<div class="vs-header">Switch View</div>';
  views.forEach(function(v) {
    var active = '';
    if (v.id === 'manager' && currentView === 'manager') active = ' vs-active';
    else if (v.id === 'editor' && currentView === 'editor') active = ' vs-active';
    else if (v.id === 'coach-jg' && currentView === 'coach' && coachName === 'Jay / Greg') active = ' vs-active';
    else if (v.id === 'coach-adam' && currentView === 'coach' && coachName === 'Adam') active = ' vs-active';
    else if (v.id === 'viewer' && currentView === 'viewer') active = ' vs-active';
    var mode = v.id.startsWith('coach') ? 'coach' : v.id;
    var nameAttr = v.name ? v.name : '';
    html += '<div class="vs-option' + active + '" data-mode="' + mode + '" data-name="' + nameAttr + '">';
    html += '<div class="vs-option-label">' + v.label + '</div>';
    html += '<div class="vs-option-desc">' + v.desc + '</div>';
    if (active) html += '<span class="vs-check">&#10003;</span>';
    html += '</div>';
  });
  dd.innerHTML = html;
  dd.style.display = 'block';
  // Wire clicks
  dd.querySelectorAll('.vs-option').forEach(function(opt) {
    opt.addEventListener('click', function() {
      switchToView(opt.dataset.mode, opt.dataset.name);
    });
  });
  // Close on outside click
  setTimeout(function() {
    document.addEventListener('click', _closeViewSwitcherOutside, { once: true, capture: true });
  }, 50);
}
function closeViewSwitcher() {
  var dd = document.getElementById('viewSwitcherDropdown');
  if (dd) dd.style.display = 'none';
}
function _closeViewSwitcherOutside(e) {
  var wrap = document.querySelector('.access-lock-wrap');
  if (wrap && wrap.contains(e.target)) {
    // Re-listen if click was inside wrapper
    setTimeout(function() {
      document.addEventListener('click', _closeViewSwitcherOutside, { once: true, capture: true });
    }, 50);
    return;
  }
  closeViewSwitcher();
}

function promptManagerPIN() {
  // If already in Manager mode — show the view switcher dropdown
  if (isManagerMode) {
    var dd = document.getElementById('viewSwitcherDropdown');
    if (dd && dd.style.display === 'block') { closeViewSwitcher(); return; }
    openViewSwitcher();
    return;
  }
  // If in coach/editor mode — offer to lock
  if (isCoachMode || isEditorMode) {
    if (confirm('Lock access?')) {
      isManagerMode = false;
      isCoachMode = false;
      isEditorMode = false;
      coachName = '';
      editorName = '';
      localStorage.removeItem('snappy_mgr_mode');
      localStorage.removeItem('snappy_coach_mode');
      localStorage.removeItem('snappy_coach_name');
      localStorage.removeItem('snappy_editor_mode');
      localStorage.removeItem('snappy_editor_name');
      applyViewMode();
    }
    return;
  }
  var pin = prompt('Enter password:');
  if (pin === null) return;
  pin = (pin || '').trim();
  if (pin === MGR_PIN) {
    isManagerMode = true;
    isCoachMode = false;
    isEditorMode = false;
    coachName = '';
    editorName = '';
    localStorage.setItem('snappy_mgr_mode', 'true');
    localStorage.removeItem('snappy_coach_mode');
    localStorage.removeItem('snappy_coach_name');
    localStorage.removeItem('snappy_editor_mode');
    localStorage.removeItem('snappy_editor_name');
    applyViewMode();
    silentSyncOnLogin();
  } else if (EDITOR_PINS[pin]) {
    isEditorMode = true;
    isManagerMode = false;
    isCoachMode = false;
    editorName = EDITOR_PINS[pin];
    coachName = '';
    localStorage.setItem('snappy_editor_mode', 'true');
    localStorage.setItem('snappy_editor_name', editorName);
    localStorage.removeItem('snappy_mgr_mode');
    localStorage.removeItem('snappy_coach_mode');
    localStorage.removeItem('snappy_coach_name');
    applyViewMode();
    silentSyncOnLogin();
  } else if (COACH_PINS[pin]) {
    isCoachMode = true;
    isManagerMode = false;
    isEditorMode = false;
    coachName = COACH_PINS[pin];
    editorName = '';
    localStorage.setItem('snappy_coach_mode', 'true');
    localStorage.setItem('snappy_coach_name', coachName);
    localStorage.removeItem('snappy_mgr_mode');
    localStorage.removeItem('snappy_editor_mode');
    localStorage.removeItem('snappy_editor_name');
    applyViewMode();
    silentSyncOnLogin();
  } else {
    alert('Incorrect password.');
  }
}

// Guard for dispatch edit actions — Manager or Editor (Judah)
function canEditDispatch() {
  return isManagerMode || isEditorMode;
}

// Guard for edit actions — call before any write/edit operation
function requireManager() {
  if (isManagerMode) return true;
  alert('Viewing mode — editing is disabled.');
  return false;
}

// Apply mode immediately
applyViewMode();

// Sidebar toggle
function toggleSidebar() {
  const nav = document.querySelector('.nav-tabs');
  if (window.innerWidth <= 768) {
    // Mobile: toggle slide-in
    nav.classList.toggle('mobile-open');
  } else {
    // Desktop: toggle expand/collapse
    document.body.classList.toggle('sidebar-expanded');
    localStorage.setItem('sidebarExpanded', document.body.classList.contains('sidebar-expanded'));
  }
}
// Initialize sidebar state
(function() {
  if (window.innerWidth > 768 && localStorage.getItem('sidebarExpanded') === 'true') {
    document.body.classList.add('sidebar-expanded');
  }
})();
// Close mobile sidebar when clicking outside
document.addEventListener('click', function(e) {
  const nav = document.querySelector('.nav-tabs');
  const toggle = document.getElementById('sidebarToggle');
  if (window.innerWidth <= 768 && nav && nav.classList.contains('mobile-open')) {
    if (!nav.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) {
      nav.classList.remove('mobile-open');
    }
  }
});


// ========== CLOUD SYNC ENGINE ==========
// Google Apps Script Web App URL — set after deploying the script
// Portable sync: accept sync URL from window.location.hash (#sync=ENCODED_URL)
// so viewers on other devices automatically inherit the manager's sync config.
function _readSyncUrlFromHash() {
  try {
    var h = (window.location.hash || '').replace(/^#/, '');
    if (!h) return '';
    var parts = h.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0] === 'sync' && kv[1]) return decodeURIComponent(kv[1]);
    }
  } catch (e) {}
  return '';
}
var DEFAULT_SYNC_URL = 'https://script.google.com/macros/s/AKfycbxzSlRbXmPMMa2xOhbphSKTM7HRKZmeebjZ0BCIoFkLFSZ8yElQ_5qw9MWJIB4N-4OM/exec';
var _hashSyncUrl = _readSyncUrlFromHash();
if (_hashSyncUrl && _hashSyncUrl.length > 10) {
  // Persist so sync works on this device going forward without needing the hash again.
  try { localStorage.setItem('snappy_sync_url', _hashSyncUrl); } catch (e) {}
}
let SYNC_URL = localStorage.getItem('snappy_sync_url') || _hashSyncUrl || DEFAULT_SYNC_URL;

const SyncEngine = {
  _pendingWrites: {},
  _writeTimer: null,
  _debounceMs: 2000, // batch writes within 2 seconds

  // Set the Apps Script URL and persist it
  setUrl(url) {
    var trimmed = (url || '').trim();
    SYNC_URL = trimmed || DEFAULT_SYNC_URL;
    localStorage.setItem('snappy_sync_url', SYNC_URL);
  },

  getUrl() { return SYNC_URL; },

  isConfigured() {
    if (SYNC_URL && SYNC_URL.length > 10) return true;
    // Fallback: check the URL hash in case localStorage hasn't been primed yet.
    var hashUrl = _readSyncUrlFromHash();
    if (hashUrl && hashUrl.length > 10) {
      SYNC_URL = hashUrl;
      try { localStorage.setItem('snappy_sync_url', SYNC_URL); } catch (e) {}
      return true;
    }
    return false;
  },

  // Queue a key-value pair to be written to the cloud
  write(key, data) {
    this._pendingWrites[key] = JSON.stringify(data);
    clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => this._flush(), this._debounceMs);
  },

  // Flush all pending writes to the cloud
  async _flush() {
    if (!this.isConfigured() || Object.keys(this._pendingWrites).length === 0) return;
    var payload = {};
    for (var k in this._pendingWrites) payload[k] = this._pendingWrites[k];
    this._pendingWrites = {};
    this._updateIndicator('syncing');
    try {
      await _syncPost(SYNC_URL, payload);
      // no-cors means we can't read the response, but the write still goes through
      this._updateIndicator('saved');
    } catch (e) {
      console.warn('Sync write failed:', e);
      this._updateIndicator('error');
    }
  },

  // Pull all data from cloud (uses JSONP for cross-origin reliability)
  async pull() {
    if (!this.isConfigured()) return null;
    this._updateIndicator('syncing');
    try {
      var json = await _syncJsonpGet(SYNC_URL);
      if (json && json.status === 'ok') {
        this._updateIndicator('saved');
        return json.result;
      }
      console.warn('SyncEngine.pull: unexpected response shape', json);
      throw new Error('Bad response: status=' + (json && json.status ? json.status : 'missing'));
    } catch (e) {
      console.warn('Sync pull failed:', (e && e.message) ? e.message : e, e);
      this._updateIndicator('error');
    }
    return null;
  },

  // Update the sync indicator in the header
  _updateIndicator(state) {
    const el = document.getElementById('syncStatusIndicator');
    if (!el) return;
    el.className = 'sync-indicator sync-' + state;
    if (state === 'syncing') {
      el.innerHTML = '<span class="sync-spinner"></span> Syncing...';
    } else if (state === 'saved') {
      el.innerHTML = '\u2601 Synced';
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.innerHTML = '\u2601 Cloud'; el.className = 'sync-indicator sync-idle'; }, 3000);
    } else if (state === 'error') {
      el.innerHTML = '\u26A0 Offline';
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.innerHTML = '\u2601 Cloud'; el.className = 'sync-indicator sync-idle'; }, 5000);
    }
  }
};

// Merge tech files: combine local + cloud by unique file ID so nothing gets lost
// Local files always win (they have fileData); cloud-only files are added as metadata stubs
function _mergeTechFiles(localJson, cloudJson) {
  try {
    var local = localJson ? JSON.parse(localJson) : {};
    var cloud = cloudJson ? JSON.parse(cloudJson) : {};
    var merged = {};
    var allTechs = {};
    Object.keys(local).forEach(function(t) { allTechs[t] = true; });
    Object.keys(cloud).forEach(function(t) { allTechs[t] = true; });
    for (var tech in allTechs) {
      var localFiles = Array.isArray(local[tech]) ? local[tech] : [];
      var cloudFiles = Array.isArray(cloud[tech]) ? cloud[tech] : [];
      // Index local files by ID (these have fileData)
      var byId = {};
      localFiles.forEach(function(f) { if (f && f.id) byId[f.id] = f; });
      // Add cloud-only files (metadata stubs without fileData)
      cloudFiles.forEach(function(f) {
        if (f && f.id && !byId[f.id]) byId[f.id] = f;
      });
      var arr = Object.values(byId);
      if (arr.length > 0) merged[tech] = arr;
    }
    return JSON.stringify(merged);
  } catch (e) {
    console.warn('Tech file merge failed:', e);
    return localJson || cloudJson || '{}';
  }
}

// Helper: extract cloud value supporting {data}, {val}, or raw string formats
function _extractCloudVal(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') return entry.data || entry.val || '';
  return '';
}

// Helper: re-render all dynamic UI sections after a data merge.
// Wrapped in try/catch blocks so one broken renderer doesn't stop the rest.
function _rerenderAllViewsAfterSync() {
  try { if (typeof renderOverviewTab === 'function') renderOverviewTab(); } catch(e) { console.warn('renderOverviewTab failed:', e); }
  try { if (typeof renderProfiles === 'function') renderProfiles(); } catch(e) { console.warn('renderProfiles failed:', e); }
  try { if (typeof renderRookieCards === 'function') renderRookieCards(); } catch(e) { console.warn('renderRookieCards failed:', e); }
  try { if (typeof renderSkillsTags === 'function') renderSkillsTags(); } catch(e) { console.warn('renderSkillsTags failed:', e); }
  try { if (typeof renderSTTables === 'function') renderSTTables(); } catch(e) { console.warn('renderSTTables failed:', e); }
  try { if (typeof renderManagerTab === 'function') renderManagerTab(); } catch(e) { console.warn('renderManagerTab failed:', e); }
  try { if (typeof renderDispatchBoard === 'function') renderDispatchBoard(); } catch(e) { console.warn('renderDispatchBoard failed:', e); }
  try { if (typeof renderRecallLog === 'function') renderRecallLog(); } catch(e) { console.warn('renderRecallLog failed:', e); }
  try { if (typeof renderComplaintLog === 'function') renderComplaintLog(); } catch(e) { console.warn('renderComplaintLog failed:', e); }
  try { if (typeof renderBulletinBoard === 'function') renderBulletinBoard(); } catch(e) { console.warn('renderBulletinBoard failed:', e); }
  try { if (typeof tfLoad === 'function') { tfLoad(); if (typeof tfRender === 'function') tfRender(); } } catch(e) { console.warn('tfLoad/tfRender failed:', e); }
}

// Cloud sync initialization — runs after page loads
// userInitiated=true means this came from a manual click — OK to show alerts.
// userInitiated=false (default) means auto-sync — stay silent if not configured.
async function initCloudSync(userInitiated) {
  // Guard: only allow one cloud-triggered reload per session to prevent loops
  var SYNC_RELOAD_KEY = '_snappy_sync_reloaded';
  var alreadyReloaded = sessionStorage.getItem(SYNC_RELOAD_KEY);

  if (!SyncEngine.isConfigured()) {
    // Silent skip for auto-sync; manual sync handles its own messaging elsewhere.
    return;
  }

  const cloudData = await SyncEngine.pull();
  if (!cloudData) {
    console.warn('initCloudSync: pull returned no data');
    return;
  }

  const keyMap = {
    'skills': 'snappy_skills_assignments',
    'manager': 'snappy_manager_entries',
    'techfiles': 'snappy_tech_files',
    'dispatch': 'snappy_dispatch_v1',
    'dailyduties': 'snappy_daily_duties',
    'mgrstats': 'snappy_mgr_stats',
    'daynotes': 'snappy_day_notes',
    'nexstar': 'snappy_nexstar',
    'bulletin': 'snappy_bulletin_board',
    'recall': 'snappy_recall_log_v1',
    'complaint': 'snappy_complaint_log_v1',
    'mgrnotes': 'snappy_mgr_notes_v1'
  };

  // Protect recently-modified local keys from being overwritten by stale cloud data.
  // On a fresh device with no _localMod timestamp, parseInt(null||'0')===0 → returns false,
  // so cloud data always wins when there's no local history.
  var LOCAL_WINS_WINDOW_MS = 5 * 60 * 1000;
  function _localRecentlyModified(localKey) {
    var raw = localStorage.getItem(localKey + '_localMod');
    if (!raw) return false;
    var ts = parseInt(raw, 10);
    if (!ts || isNaN(ts)) return false;
    return (Date.now() - ts) < LOCAL_WINS_WINDOW_MS;
  }

  let updated = false;
  for (const [cloudKey, localKey] of Object.entries(keyMap)) {
    if (cloudData[cloudKey] !== undefined && cloudData[cloudKey] !== null) {
      const cloudVal = _extractCloudVal(cloudData[cloudKey]);
      if (!cloudVal) continue;
      const localVal = localStorage.getItem(localKey) || '';
      if (cloudKey === 'techfiles') {
        // Always merge tech files — never overwrite
        var merged = _mergeTechFiles(localVal, cloudVal);
        if (merged !== localVal) {
          localStorage.setItem(localKey, merged);
          updated = true;
        }
      } else if (cloudVal !== localVal) {
        // Skip overwrite if user recently modified this data locally (not yet pushed).
        // Always allow fresh devices (no local value) to accept cloud data.
        if (localVal && _localRecentlyModified(localKey)) {
          console.log('Skipping cloud overwrite for ' + localKey + ' — local changes newer than cloud');
          continue;
        }
        localStorage.setItem(localKey, cloudVal);
        updated = true;
      }
    }
  }

  // Push merged tech files metadata back to cloud (fire-and-forget, strip fileData)
  var mergedTf = localStorage.getItem('snappy_tech_files');
  if (mergedTf) {
    try {
      var parsed = JSON.parse(mergedTf);
      SyncEngine.write('techfiles', typeof _tfStripFileData === 'function' ? _tfStripFileData(parsed) : parsed);
    } catch (e) { console.warn('techfiles re-push parse failed:', e); }
  }

  // Sync Drive file map from cloud
  if (typeof _tfSyncDriveMap === 'function') _tfSyncDriveMap(cloudData);

  if (updated && !alreadyReloaded) {
    sessionStorage.setItem(SYNC_RELOAD_KEY, '1');
    console.log('Cloud data loaded — refreshing views (one-time reload)');
    location.reload();
  } else if (updated) {
    // Already reloaded once this session — re-render the UI in place instead of another reload
    console.log('Cloud data merged — updating UI in place (no reload)');
    _rerenderAllViewsAfterSync();
  }
}

// Manual sync button — push + pull + cache reset + hard reload
// Viewers/coaches get pull-only (read-only refresh from cloud)
async function manualSync() {
  var btn = document.getElementById('syncNowBtn');
  if (!SyncEngine.isConfigured()) {
    if (isManagerMode) openSyncSetup();
    else alert('Cloud sync is not configured yet. Ask the manager to set it up.');
    return;
  }
  var canPush = isManagerMode || isEditorMode;
  btn.classList.add('syncing');
  try {
    if (canPush) {
      // 1. Push all local data to cloud (managers/editors only)
      SyncEngine.write('skills', skillsData.assignments);
      SyncEngine.write('manager', mgrState);
      SyncEngine.write('bulletin', JSON.parse(localStorage.getItem('snappy_bulletin_board') || '{}'));
      var dKeys = ['techfiles','dispatch','dailyduties','mgrstats','daynotes','nexstar','recall','complaint','mgrnotes'];
      var dLocalKeys = ['snappy_tech_files','snappy_dispatch_v1','snappy_daily_duties','snappy_mgr_stats','snappy_day_notes','snappy_nexstar','snappy_recall_log_v1','snappy_complaint_log_v1','snappy_mgr_notes_v1'];
      dKeys.forEach(function(k, i) {
        var v = localStorage.getItem(dLocalKeys[i]);
        if (v) {
          var parsed = JSON.parse(v);
          // Strip base64 fileData from techfiles — too large for Google Sheets
          if (k === 'techfiles' && typeof _tfStripFileData === 'function') parsed = _tfStripFileData(parsed);
          SyncEngine.write(k, parsed);
        }
      });
      await SyncEngine._flush();

      // 1b. Wait for no-cors POST to land on server before reading back
      await new Promise(function(r) { setTimeout(r, 2500); });
    }

    // 2. Pull cloud data (verifies push landed)
    var cloudData = await SyncEngine.pull();
    if (cloudData) {
      var keyMap = {
        'skills': 'snappy_skills_assignments',
        'manager': 'snappy_manager_entries',
        'techfiles': 'snappy_tech_files',
        'dispatch': 'snappy_dispatch_v1',
        'dailyduties': 'snappy_daily_duties',
        'mgrstats': 'snappy_mgr_stats',
        'daynotes': 'snappy_day_notes',
        'nexstar': 'snappy_nexstar',
        'bulletin': 'snappy_bulletin_board',
        'recall': 'snappy_recall_log_v1',
        'complaint': 'snappy_complaint_log_v1',
        'mgrnotes': 'snappy_mgr_notes_v1'
      };
      for (var ck in keyMap) {
        if (cloudData[ck] !== undefined && cloudData[ck] !== null) {
          var cv = _extractCloudVal(cloudData[ck]);
          if (cv) {
            if (ck === 'techfiles') {
              // Merge tech files — never lose local files missing from cloud
              var localTf = localStorage.getItem(keyMap[ck]);
              localStorage.setItem(keyMap[ck], _mergeTechFiles(localTf, cv));
            } else {
              localStorage.setItem(keyMap[ck], cv);
            }
          }
        }
      }
      if (canPush) {
        // After merge, push stripped metadata back to cloud
        var mergedTf = localStorage.getItem('snappy_tech_files');
        if (mergedTf) {
          var p = JSON.parse(mergedTf);
          SyncEngine.write('techfiles', typeof _tfStripFileData === 'function' ? _tfStripFileData(p) : p);
        }
        // Sync Drive file map
        if (typeof _tfSyncDriveMap === 'function') _tfSyncDriveMap(cloudData);
        await SyncEngine._flush();
        await new Promise(function(r) { setTimeout(r, 1500); });
      }
    }

    // 3. Clear browser caches
    if ('caches' in window) {
      var cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(function(name) { return caches.delete(name); }));
    }

    // 4. Hard reload with cache-busting timestamp
    sessionStorage.removeItem('_snappy_sync_reloaded'); // allow initCloudSync to reload once after manual sync
    var url = window.location.href.split('?')[0] + '?sync=' + Date.now();
    window.location.replace(url);
  } catch(e) {
    console.warn('Manual sync error:', e);
    btn.classList.remove('syncing');
    btn.style.color = '#e57373';
    btn.style.borderColor = 'rgba(229,115,115,0.5)';
    setTimeout(function() { btn.style.color = ''; btn.style.borderColor = ''; }, 1500);
  }
}

// Sync setup modal functions
function openSyncSetup() {
  if (!requireManager()) return;
  const modal = document.getElementById('syncSetupModal');
  modal.style.display = 'flex';
  document.getElementById('syncUrlInput').value = SyncEngine.getUrl();
  document.getElementById('syncSetupStatus').textContent = '';
}
function closeSyncSetup() {
  document.getElementById('syncSetupModal').style.display = 'none';
}
// Helper: cross-origin GET via JSONP (reliable for Apps Script)
function _syncJsonpGet(url) {
  return new Promise(function(resolve, reject) {
    // Unique callback name per request; add random suffix so concurrent requests never collide
    var cbName = '_syncCb' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    var cleanedUp = false;
    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }
    window[cbName] = function(data) {
      cleanup();
      resolve(data);
    };
    var script = document.createElement('script');
    script.src = url + (url.indexOf('?') > -1 ? '&' : '?') + 'callback=' + cbName + '&t=' + Date.now();
    script.onerror = function(ev) {
      console.warn('JSONP script load error for', url, ev);
      cleanup();
      reject(new Error('JSONP network/script error'));
    };
    document.head.appendChild(script);
    setTimeout(function() {
      if (!cleanedUp) {
        console.warn('JSONP timed out after 15s for', url);
        cleanup();
        reject(new Error('JSONP timeout (15s)'));
      }
    }, 15000);
  });
}

// Helper: cross-origin POST via no-cors (fire-and-forget)
function _syncPost(url, payload) {
  return fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  });
}

async function saveSyncUrl() {
  var url = document.getElementById('syncUrlInput').value.trim();
  var statusEl = document.getElementById('syncSetupStatus');
  if (!url) { statusEl.textContent = 'Please enter a URL.'; statusEl.style.color = '#e57373'; return; }
  statusEl.textContent = 'Testing connection...'; statusEl.style.color = '#8b93a8';
  SyncEngine.setUrl(url);
  try {
    // Test connection with JSONP (works cross-origin)
    var testData = await _syncJsonpGet(url);
    if (!testData || testData.status !== 'ok') throw new Error('Bad response');

    statusEl.textContent = 'Connected! Syncing all data now...'; statusEl.style.color = '#81c784';

    // Push all current localStorage data to cloud (no-cors POST)
    var keyMap = {
      'skills': 'snappy_skills_assignments',
      'manager': 'snappy_manager_entries',
      'techfiles': 'snappy_tech_files',
      'dispatch': 'snappy_dispatch_v1',
      'dailyduties': 'snappy_daily_duties',
      'mgrstats': 'snappy_mgr_stats',
      'daynotes': 'snappy_day_notes',
      'nexstar': 'snappy_nexstar',
      'bulletin': 'snappy_bulletin_board',
      'recall': 'snappy_recall_log_v1',
      'complaint': 'snappy_complaint_log_v1',
      'mgrnotes': 'snappy_mgr_notes_v1'
    };
    var payload = {};
    for (var ck in keyMap) {
      var val = localStorage.getItem(keyMap[ck]);
      if (val) {
        // Strip fileData from techfiles before cloud push
        if (ck === 'techfiles' && typeof _tfStripFileData === 'function') {
          payload[ck] = JSON.stringify(_tfStripFileData(JSON.parse(val)));
        } else {
          payload[ck] = val;
        }
      }
    }
    if (Object.keys(payload).length > 0) {
      await _syncPost(url, payload);
      // Small delay so the write lands before we read back
      await new Promise(function(r) { setTimeout(r, 2000); });
    }

    // Pull cloud data into localStorage for this device (JSONP)
    var pullData = await _syncJsonpGet(url);
    if (pullData && pullData.status === 'ok' && pullData.result) {
      var pullKeys = { 'skills': 'snappy_skills_assignments', 'manager': 'snappy_manager_entries', 'techfiles': 'snappy_tech_files', 'dispatch': 'snappy_dispatch_v1', 'dailyduties': 'snappy_daily_duties', 'mgrstats': 'snappy_mgr_stats', 'daynotes': 'snappy_day_notes', 'nexstar': 'snappy_nexstar', 'bulletin': 'snappy_bulletin_board', 'recall': 'snappy_recall_log_v1', 'complaint': 'snappy_complaint_log_v1', 'mgrnotes': 'snappy_mgr_notes_v1' };
      for (var pk in pullKeys) {
        if (pullData.result[pk] !== undefined && pullData.result[pk] !== null) {
          var cv = _extractCloudVal(pullData.result[pk]);
          if (cv) {
            if (pk === 'techfiles') {
              var localTf = localStorage.getItem(pullKeys[pk]);
              localStorage.setItem(pullKeys[pk], _mergeTechFiles(localTf, cv));
            } else {
              localStorage.setItem(pullKeys[pk], cv);
            }
          }
        }
      }
    }

    // Sync Drive file map
    if (pullData && pullData.result && typeof _tfSyncDriveMap === 'function') _tfSyncDriveMap(pullData.result);

    statusEl.textContent = 'All data synced!'; statusEl.style.color = '#81c784';
    setTimeout(function() { closeSyncSetup(); location.reload(); }, 1500);
  } catch (e) {
    console.warn('saveSyncUrl error:', e);
    statusEl.textContent = 'Connection error. Make sure the script is deployed as a web app.'; statusEl.style.color = '#e57373';
  }
}

// Trigger cloud sync on page load + when app returns to foreground (pull-only, debounced 60s)
var _lastAutoSyncAt = 0;
var _syncInProgress = false;
var AUTO_SYNC_COOLDOWN_MS = 60000;
function _autoCloudSync() {
  try {
    // Silent skip — never show an alert from auto-sync. Only the manual sync button
    // surfaces "not configured" messaging to the user.
    if (!SyncEngine.isConfigured()) return;
    if (_syncInProgress) return; // already running — don't stack requests
    var now = Date.now();
    if (now - _lastAutoSyncAt < AUTO_SYNC_COOLDOWN_MS) return;
    _lastAutoSyncAt = now;
    _syncInProgress = true;
    var p = initCloudSync(false);
    if (p && typeof p.finally === 'function') {
      p.catch(function(e) { console.warn('Auto cloud sync failed:', e); })
       .finally(function() { _syncInProgress = false; });
    } else {
      _syncInProgress = false;
    }
  } catch (e) {
    _syncInProgress = false;
    console.warn('Auto cloud sync error:', e);
  }
}
window.addEventListener('load', _autoCloudSync);
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') _autoCloudSync();
});

// ========== DATA ==========
    const techs = [
      {
        name: "Dee Williams",
        short: "Dee",
        initials: "DW",
        color: "#2D6A6A",
        years: 15,
        position: "Technician",
        date: "4/1/2026",
        scores: {
          electrical: { low_voltage: 3, high_voltage: 4, schematics: 4, open_circuit: 3 },
          heating: { furnace_sequence: 4, components: 4, heat_exchanger: 4, gas_flue: 4 },
          cooling: { superheat_subcool: 4, refrigerant_charge: 4, refrigerant_cycle: 4, vacuum_reclaim: 4 },
          airflow: { static_pressure: 3, airflow_troubleshoot: 3, duct_awareness: 3, iaq: 3 },
          install: { blower_fan: 3, evap_coil: 3, tstat_zoning: 3, compressor: 3 },
          customer: { communication: 4, explaining: 4, solutions: 3, closing: 3 },
          advanced: { communicating_sys: 3, dual_fuel: 2, zone_board: 2, iaq_dehumid: 2 },
          truck: { organization: 5, cleanliness: 5, locate_tools: 5 },
          uniform: { full_uniform: 3, clean_appearance: 4, grooming: 4 },
          professionalism: { professional_present: 4, clean_work: 4, respect_home: 4, no_odors: 4 }
        },
        strengths: ["Diagnosing problems", "Working with tools", "Safety"],
        weaknesses: ["Taking control of situations", "Customer communication", "Tablet training (quotes & options)"],
        growth: "Being a better tech",
        training: "Tablet training (Building quotes + options)",
        holding_back: "Myself (I need to slow down more)",
        managerNotes: "Versatile technician capable of handling a wide range of HVAC tasks. Primarily assigned to warranty work given his strong install and refrigeration background. Frequently supports other departments as needed, making him one of the most adaptable members of the team.",
        managerTags: [
          { label: "Versatile", type: "role" },
          { label: "Warranty Lead", type: "trust" },
          { label: "Install Background", type: "strength" },
          { label: "Refrigeration Background", type: "strength" },
          { label: "Cross-Department", type: "role" }
        ]
      },
      {
        name: "Daniel Gazaway",
        short: "Daniel",
        initials: "DA",
        color: "#C47F17",
        years: 15,
        position: "HVAC Service Tech",
        date: "4/1/2026",
        scores: {
          electrical: { low_voltage: 4, high_voltage: 4, schematics: 3, open_circuit: 3 },
          heating: { furnace_sequence: 4, components: 3, heat_exchanger: 4, gas_flue: 5 },
          cooling: { superheat_subcool: 5, refrigerant_charge: 5, refrigerant_cycle: 4, vacuum_reclaim: 4 },
          airflow: { static_pressure: 4, airflow_troubleshoot: 4, duct_awareness: 4, iaq: 4 },
          install: { blower_fan: 4, evap_coil: 3, tstat_zoning: 4, compressor: 4 },
          customer: { communication: 5, explaining: 5, solutions: 4, closing: 4 },
          advanced: { communicating_sys: 4, dual_fuel: 3, zone_board: 3, iaq_dehumid: 3 },
          truck: { organization: 5, cleanliness: 5, locate_tools: 5 },
          uniform: { full_uniform: 5, clean_appearance: 5, grooming: 5 },
          professionalism: { professional_present: 5, clean_work: 5, respect_home: 5, no_odors: 5 }
        },
        strengths: ["Troubleshooting", "Customer service", "Duct modification"],
        weaknesses: ["Reading schematics", "Closing recommendations", "IAQ"],
        growth: "Zone board diagnostics, Being on time",
        training: "Understanding how to close efficiently",
        holding_back: "Time awareness",
        managerNotes: "Brings strong energy and excellent interpersonal skills — consistently receives positive customer feedback. Install background allows him to be trusted with coil replacements, compressor work, and ductwork modifications. Performs at a B+ level in diagnostics. Primary development area is maintaining consistent focus and task prioritization.",
        managerTags: [
          { label: "Strong Rapport", type: "strength" },
          { label: "Customer Preferred", type: "strength" },
          { label: "Install Background", type: "strength" },
          { label: "Coils / Compressors / Duct", type: "trust" },
          { label: "B+ Diagnostics", type: "trust" },
          { label: "Focus Development", type: "watch" }
        ]
      },
      {
        name: "Chris Monahan",
        short: "Chris",
        initials: "CM",
        color: "#8B3A3A",
        years: 10,
        position: "HVAC Service Tech",
        date: "4/1/2026",
        scores: {
          electrical: { low_voltage: 4, high_voltage: 4, schematics: 4, open_circuit: 4 },
          heating: { furnace_sequence: 4, components: 4, heat_exchanger: 4, gas_flue: 4 },
          cooling: { superheat_subcool: 4, refrigerant_charge: 4, refrigerant_cycle: 4, vacuum_reclaim: 4 },
          airflow: { static_pressure: 4, airflow_troubleshoot: 4, duct_awareness: 4, iaq: 4 },
          install: { blower_fan: 4, evap_coil: 4, tstat_zoning: 4, compressor: 4 },
          customer: { communication: 4, explaining: 4, solutions: 4, closing: 4 },
          advanced: { communicating_sys: 4, dual_fuel: 4, zone_board: 4, iaq_dehumid: 4 },
          truck: { organization: 4, cleanliness: 4, locate_tools: 4 },
          uniform: { full_uniform: 4, clean_appearance: 4, grooming: 4 },
          professionalism: { professional_present: 4, clean_work: 4, respect_home: 4, no_odors: 4 }
        },
        strengths: ["Sales", "Refrigerant cycle", "Furnace sequence of operation"],
        weaknesses: ["Brazing", "Install", "Ductwork"],
        growth: "Sales, Brazing",
        training: "DISC styles, Sales, Brazing",
        holding_back: "Need to train more, usually flip the system so don't braze a lot",
        managerNotes: "One of the more seasoned HVAC technicians on the team. Excels at converting equipment assessments into qualified sales opportunities and establishing proper lead flow. Reserved communication style — performs best in structured, independent work environments.",
        managerTags: [
          { label: "Senior HVAC Tech", type: "strength" },
          { label: "Sales Conversion", type: "trust" },
          { label: "Lead Generation", type: "trust" },
          { label: "Reserved Style", type: "watch" }
        ]
      },
      {
        name: "Benji",
        short: "Benji",
        initials: "BT",
        color: "#5B4A8A",
        years: 3,
        position: "Technician",
        date: "4/1/2026",
        scores: {
          electrical: { low_voltage: 3, high_voltage: 4, schematics: 4, open_circuit: 4 },
          heating: { furnace_sequence: 4, components: 4, heat_exchanger: 5, gas_flue: 5 },
          cooling: { superheat_subcool: 4, refrigerant_charge: 4, refrigerant_cycle: 3, vacuum_reclaim: 3 },
          airflow: { static_pressure: 3, airflow_troubleshoot: 3, duct_awareness: 4, iaq: 3 },
          install: { blower_fan: 3, evap_coil: 2, tstat_zoning: 3, compressor: 2 },
          customer: { communication: 4, explaining: 4, solutions: 4, closing: 4 },
          advanced: { communicating_sys: 2, dual_fuel: 2, zone_board: 3, iaq_dehumid: 3 },
          truck: { organization: 5, cleanliness: 5, locate_tools: 5 },
          uniform: { full_uniform: 5, clean_appearance: 5, grooming: 5 },
          professionalism: { professional_present: 5, clean_work: 5, respect_home: 5, no_odors: 5 }
        },
        strengths: ["Great communication skills", "Good understanding of normal equipment", "Punctual"],
        weaknesses: ["Hate heights", "Not experienced with vacuum & torches", "Don't fully understand air handlers"],
        growth: "Technical knowledge for air handlers, Order of operations for vacuum",
        training: "",
        holding_back: "",
        managerNotes: "Most detail-oriented technician on the team. Plumbing background provides a strong mechanical foundation. Consistently follows established procedures and manufacturer guidelines, ensuring high-quality and compliant work.",
        managerTags: [
          { label: "Detail-Oriented", type: "strength" },
          { label: "Plumbing Background", type: "strength" },
          { label: "Process-Driven", type: "trust" }
        ]
      },
      {
        name: "Dewone Martin",
        short: "Dewone",
        initials: "DM",
        color: "#E07B3A",
        years: 3.5,
        position: "Service Technician",
        date: "4/1/2026",
        scores: {
          electrical: { low_voltage: 4, high_voltage: 4, schematics: 4, open_circuit: 4 },
          heating: { furnace_sequence: 4, components: 4, heat_exchanger: 4, gas_flue: 4 },
          cooling: { superheat_subcool: 4, refrigerant_charge: 4, refrigerant_cycle: 3, vacuum_reclaim: 3 },
          airflow: { static_pressure: 3, airflow_troubleshoot: 3, duct_awareness: 3, iaq: 3 },
          install: { blower_fan: 3, evap_coil: 3, tstat_zoning: 3, compressor: 3 },
          customer: { communication: 5, explaining: 5, solutions: 4, closing: 4 },
          advanced: { communicating_sys: 3, dual_fuel: 3, zone_board: 3, iaq_dehumid: 2 },
          truck: { organization: 4, cleanliness: 4, locate_tools: 4 },
          uniform: { full_uniform: 4, clean_appearance: 4, grooming: 4 },
          professionalism: { professional_present: 4, clean_work: 4, respect_home: 4, no_odors: 4 }
        },
        strengths: ["Customer service — great with customers", "Lead sales", "Communication with customers"],
        weaknesses: ["Troubleshooting — low patience", "Low voltage", "Not a lot of years experience"],
        growth: "Troubleshooting",
        training: "Troubleshooting",
        holding_back: "No patience, not enough years experience, new to field",
        managerNotes: "Early-career technician currently building his technical foundation. Demonstrates strong ability to identify equipment replacement opportunities and convert them into actionable sales leads. Continued development in diagnostics and advanced systems will be key to long-term growth.",
        managerTags: [
          { label: "Developing Tech", type: "watch" },
          { label: "Building Foundation", type: "watch" },
          { label: "Sales Conversion", type: "trust" }
        ]
      }
    ];

    // Category display names & mapping
    const categories = {
      electrical: { label: "Electrical", color: "#2D6A6A",
        items: { low_voltage: "Low Voltage", high_voltage: "High Voltage", schematics: "Reading Schematics", open_circuit: "Open Circuit Diagnosis" }},
      heating: { label: "Heating", color: "#C47F17",
        items: { furnace_sequence: "Furnace Sequence", components: "Components", heat_exchanger: "Heat Exchanger", gas_flue: "Gas & Flue" }},
      cooling: { label: "Cooling", color: "#8B3A3A",
        items: { superheat_subcool: "Superheat / Subcooling", refrigerant_charge: "Refrigerant Charge", refrigerant_cycle: "Refrigerant Cycle", vacuum_reclaim: "Vacuum / Reclaim" }},
      airflow: { label: "Airflow", color: "#5B4A8A",
        items: { static_pressure: "Static Pressure", airflow_troubleshoot: "Airflow Troubleshooting", duct_awareness: "Duct Awareness", iaq: "IAQ" }},
      install: { label: "Install", color: "#3A7A4A",
        items: { blower_fan: "Blower / Fan Motor", evap_coil: "Evap Coil", tstat_zoning: "T-stat / Zoning", compressor: "Compressor" }},
      customer: { label: "Customer", color: "#D4880B",
        items: { communication: "Communication", explaining: "Explaining Issues", solutions: "Offering Solutions", closing: "Closing Recommendations" }},
      advanced: { label: "Advanced", color: "#8B3A3A",
        items: { communicating_sys: "Communicating Systems", dual_fuel: "Dual Fuel", zone_board: "Zone Board Diagnostics", iaq_dehumid: "IAQ / Dehumidification" }}
    };

    const professionalCats = {
      truck: { label: "Truck / Vehicle", items: { organization: "Organization", cleanliness: "Cleanliness", locate_tools: "Locate Tools" }},
      uniform: { label: "Uniform / Appearance", items: { full_uniform: "Full Uniform", clean_appearance: "Clean Appearance", grooming: "Grooming" }},
      professionalism: { label: "Field Professionalism", items: { professional_present: "Professional Presence", clean_work: "Clean Work Area", respect_home: "Respect Home", no_odors: "Free of Odors" }}
    };

    // Aptitude test mapping
    const aptitudeMap = {
      "Section A: Electrical": {
        color: "#2D6A6A", bg: "#E8F0F0",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
        sources: ["electrical"]
      },
      "Section B: Airflow": {
        color: "#C47F17", bg: "#FFF4E0",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>',
        sources: ["airflow"]
      },
      "Section C: Refrigerant": {
        color: "#8B3A3A", bg: "#F5E8E8",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/></svg>',
        sources: ["cooling"]
      },
      "Section D: Zoning & Low Voltage": {
        color: "#5B4A8A", bg: "#EEEAF5",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3v4M8 3v4M2 13h20"/></svg>',
        sources: ["advanced"]
      }
    };

    // ========== UTILITIES ==========
    function avgScores(scoreObj) {
      const vals = Object.values(scoreObj);
      return vals.reduce((s,v) => s+v, 0) / vals.length;
    }

    function techCategoryAvg(tech, catKey) {
      return avgScores(tech.scores[catKey]);
    }

    function techOverallAvg(tech) {
      const coreCats = Object.keys(categories);
      const avgs = coreCats.map(c => techCategoryAvg(tech, c));
      return avgs.reduce((s,v) => s+v, 0) / avgs.length;
    }

    function teamCategoryAvg(catKey) {
      return techs.reduce((s,t) => s + techCategoryAvg(t, catKey), 0) / techs.length;
    }

    function scoreClass(val) {
      const r = Math.round(val);
      if (r <= 1) return 'score-1';
      if (r <= 2) return 'score-2';
      if (r <= 3) return 'score-3';
      if (r <= 4) return 'score-4';
      return 'score-5';
    }

    // ========== TECH AVATARS ==========
    const techAvatars = {
      "Dewone": "dewone_avatar.png",
      "Benji": "benji_avatar.png",
      "Chris": "chris_avatar.png",
      "Dee": "dee_avatar.png",
      "Daniel": "daniel_avatar.png",
      "Maico": "maico_avatar.png"
    };

    // ========== APTITUDE TEST DATA ==========
    const aptitudeTests = {
      "Benji": {
        date: "04/13/2026",
        sections: [
          { label: "Section A", score: 9, total: 10 },
          { label: "Section B", score: 9, total: 10 },
          { label: "Section C", score: 5, total: 10 },
          { label: "Section D", score: 10, total: 10 },
          { label: "Bonus (E)", score: 9, total: 10 }
        ],
        totalScore: 42,
        maxScore: 50,
        certs: ["NATE", "EPA", "Trane Tech Builder", "Nexstar Service Systems"],
        interpretation: "Service Technician level across most sections. Section D (perfect score) and strong Sections A/B demonstrate solid fundamentals. Section C is the primary growth area — recommend targeted training on intermediate diagnostics."
      },
      "Daniel": {
        date: "04/15/2026",
        sections: [
          { label: "Section A", score: 10, total: 10 },
          { label: "Section B", score: 9, total: 10 },
          { label: "Section C", score: 9, total: 10 },
          { label: "Section D", score: 9, total: 10 },
          { label: "Bonus (E)", score: 8, total: 10 }
        ],
        totalScore: 45,
        maxScore: 50,
        certs: ["EPA", "NATE", "Trane Service", "Nexstar Service Systems"],
        interpretation: "Senior Technician / Lead level. Perfect score on Section A and consistently high across all sections (90%+ on A–D). Well-qualified for complex diagnostics, system design, and mentoring. Minimal development areas."
      },
      "Chris": {
        date: "04/13/2026",
        sections: [
          { label: "Section A", score: 8, total: 10 },
          { label: "Section B", score: 9, total: 10 },
          { label: "Section C", score: 10, total: 10 },
          { label: "Section D", score: 10, total: 10 },
          { label: "Bonus (E)", score: 10, total: 10 }
        ],
        totalScore: 47,
        maxScore: 50,
        certs: ["EPA Universal", "Vocational School", "Nexstar Service System"],
        interpretation: "Senior Technician / Lead level. Three perfect sections (C, D, Bonus) demonstrate elite-level knowledge in intermediate, advanced, and bonus categories. 10 years of experience and vocational training are clearly reflected. Strongest aptitude score on the team."
      },
      "Dee": {
        date: "04/15/2026",
        sections: [
          { label: "Section A", score: 7, total: 10 },
          { label: "Section B", score: 7, total: 10 },
          { label: "Section C", score: 7, total: 10 },
          { label: "Section D", score: 9, total: 10 },
          { label: "Bonus (E)", score: 7, total: 10 }
        ],
        totalScore: 37,
        maxScore: 50,
        certs: ["EPA Universal"],
        interpretation: "Service Technician level. Consistent 70% across Sections A–C and Bonus, with a strong Section D (90%). Demonstrates solid advanced knowledge relative to fundamentals. 1 year as a service tech but 15 years of install/refrigeration background shows in his D score."
      },
      "Adam": {
        date: "04/15/2026",
        sections: [
          { label: "Section A", score: 8, total: 10 },
          { label: "Section B", score: 9, total: 10 },
          { label: "Section C", score: 7, total: 10 },
          { label: "Section D", score: 10, total: 10 },
          { label: "Bonus (E)", score: 6, total: 10 }
        ],
        totalScore: 40,
        maxScore: 50,
        certs: [],
        interpretation: "Owner benchmark. Strong Section D (perfect) and B (90%). Section C and Bonus are development areas. Serves as a reference point for technician evaluations."
      },
      "Dewone": {
        date: "04/13/2026",
        sections: [
          { label: "Section A", score: 7, total: 10 },
          { label: "Section B", score: 9, total: 10 },
          { label: "Section C", score: 8, total: 10 },
          { label: "Section D", score: 6, total: 10 },
          { label: "Bonus (E)", score: 8, total: 10 }
        ],
        totalScore: 38,
        maxScore: 50,
        certs: ["EPA Universal"],
        interpretation: "Solid Service Technician level. Section B is a standout (90%). Well-rounded across A, C, and Bonus sections. Section D is the primary development area — recommend focused training on advanced diagnostics and system design."
      }
    };

    // ========== MANAGER SCORE ==========
    // 1–10 scale: recalls, inspection sheets, stickers, housekeeping
    const managerScores = {
      "Dee": 10,
      "Daniel": 7.5,
      "Chris": 10,
      "Benji": 10,
      "Dewone": 7
    };

    // ========== TIER RANKING SYSTEM ==========
    // S = Elite (92+) — maxed out / near-perfect across the board
    // A = Advanced (85–91) — strong all-around performer
    // B = Solid (78–84) — competent with room to grow
    // C = Developing (<78) — building fundamentals
    //
    // Composite score (0–100) built from:
    //   Aptitude (30%) + ST performance (35%) + Skills Tags (10%) + Manager (10%) + Installs (10%) + Reviews (5%)
    //   Skills = assigned tags / total available tags (52)

    function getTechAptitudeScore(tech) {
      const apt = aptitudeTests[tech.short];
      if (!apt) return 50; // default if no test data
      return (apt.totalScore / apt.maxScore) * 100;
    }

    function getTechTier(tech) {
      // 1. Aptitude test score (0–100): actual test percentage — PRIMARY knowledge gauge
      const aptScore = getTechAptitudeScore(tech);

      // 2. Skills tag score (0–100): assigned skills / total skills available
      const totalSkillsAvailable = Object.values(skillsData.categories).reduce((sum, cat) => sum + cat.skills.length, 0);
      const assignedSkills = (skillsData.assignments[tech.short] || []).length;
      const skillScore = Math.min((assignedSkills / totalSkillsAvailable) * 100, 100);

      // 3. Manager score (0–100): 1–10 scale → percentage
      const mgrRaw = managerScores[tech.short] || 5;
      const mgrScore = (mgrRaw / 10) * 100;

      // 4. ServiceTitan composite (0–100): normalize key ST metrics
      const st = stData.find(s => s.name === tech.short);
      let stScore = 50; // default if no ST data
      let installScore = 0;
      if (st) {
        if (st.isWarrantyTech) {
          // Warranty tech scoring: volume & efficiency over revenue & leads
          const jobsNorm = Math.min((st.completedJobs || 0) / 120, 1) * 100;  // 120 jobs/90d = 100%
          const convNorm = Math.min(st.nexstar.conversion_rate / 85, 1) * 100;
          const flatRateNorm = Math.min(st.nexstar.flat_rate_tasks / 3, 1) * 100;
          const callbackNorm = Math.max(0, 100 - (st.productivity.recalls * 25)); // 0 recalls=100, each costs 25pts
          const billableNorm = Math.min(st.productivity.billable_hours / 140, 1) * 100;
          const tasksNorm = Math.min(st.productivity.tasks_per_opp / 3, 1) * 100;
          stScore = (jobsNorm * 0.30 + convNorm * 0.25 + flatRateNorm * 0.15 + callbackNorm * 0.10 + billableNorm * 0.10 + tasksNorm * 0.10);
          // Warranty techs don't get penalized on installs — give baseline
          installScore = 40;
        } else {
          const convNorm = Math.min(st.nexstar.conversion_rate / 85, 1) * 100;
          const revNorm = Math.min(st.nexstar.total_revenue / 25000, 1) * 100;
          const leadsNorm = Math.min(st.nexstar.tech_gen_leads / 30, 1) * 100;
          const closeNorm = Math.min(st.sales.close_rate / 80, 1) * 100;
          const optsNorm = Math.min(st.productivity.options_per_opp / 3, 1) * 100;
          const memNorm = Math.min(st.memberships.total_mem_pct / 50, 1) * 100;
          stScore = (convNorm * 0.25 + revNorm * 0.25 + leadsNorm * 0.15 + closeNorm * 0.15 + optsNorm * 0.10 + memNorm * 0.10);

          // 5. Install revenue score (0–100)
          const instCountNorm = Math.min(st.installs.count / 10, 1) * 100;
          const instRevNorm = Math.min(st.installs.total_revenue / 150000, 1) * 100;
          const instAvgNorm = Math.min(st.installs.avg_sale / 15000, 1) * 100;
          installScore = (instRevNorm * 0.45 + instCountNorm * 0.35 + instAvgNorm * 0.20);
        }
      }

      // 6. Google reviews score (0–100)
      const gr = googleReviews[tech.short];
      let reviewScore = 30;
      if (gr) {
        const countNorm = Math.min(gr.count / 25, 1) * 100;
        const qualityNorm = (gr.fiveStar / Math.max(gr.count, 1)) * 100;
        reviewScore = countNorm * 0.6 + qualityNorm * 0.4;
      }

      // 7. Dispatch tag bonus: premium tags (Lead Tech, Ride Along Trainer, Warranty Tech) = +1.0 each, all others = +0.25 each
      const dispData = dispLoad();
      const dispTags = (dispData.assignments && dispData.assignments[tech.short]) || [];
      const dispatchBonus = calcDispatchBonus(dispTags);

      // 8. Sold/Billable Hour Efficiency Bonus
      const effData = calcEfficiencyBonus(tech);
      const efficiencyBonus = effData.bonus;

      // Composite: Aptitude 30% + ST 35% + Skills 10% + Manager 10% + Installs 10% + Reviews 5% + Dispatch bonus + Efficiency bonus
      const composite = aptScore * 0.30 + stScore * 0.35 + skillScore * 0.10 + mgrScore * 0.10 + installScore * 0.10 + reviewScore * 0.05 + dispatchBonus + efficiencyBonus;

      let tier, tierLabel;
      if (composite >= 92) { tier = 'S'; tierLabel = 'Elite'; }
      else if (composite >= 85) { tier = 'A'; tierLabel = 'Advanced'; }
      else if (composite >= 78) { tier = 'B'; tierLabel = 'Solid'; }
      else { tier = 'C'; tierLabel = 'Developing'; }

      return { tier, tierLabel, composite: Math.round(composite), compositeRaw: composite, aptScore: Math.round(aptScore), skillScore: Math.round(skillScore), stScore: Math.round(stScore), installScore: Math.round(installScore), reviewScore: Math.round(reviewScore), mgrScore: Math.round(mgrScore), dispatchBonus: Math.round(dispatchBonus * 100) / 100, dispatchTagCount: dispTags.length, efficiencyBonus: effData.bonus, efficiencyLabel: effData.label, efficiencyPct: effData.pct };
    }


    // ========== GAMIFICATION: XP BAR SYSTEM ==========
    function getXPData(tech) {
      const info = getTechTier(tech);
      const thresholds = { C: 0, B: 78, A: 85, S: 92 };
      const tierFloor = thresholds[info.tier];
      const nextTier = { C: 'B', B: 'A', A: 'S', S: null }[info.tier];
      const nextThreshold = nextTier ? thresholds[nextTier] : 100;
      const tierRange = nextThreshold - tierFloor;
      const progress = nextTier ? ((info.composite - tierFloor) / tierRange) * 100 : 100;
      const xpCurrent = Math.round(info.composite * 10); // XP = composite * 10
      const xpNext = nextTier ? nextThreshold * 10 : info.composite * 10;
      const xpFloor = tierFloor * 10;
      return { 
        ...info, xpCurrent, xpNext, xpFloor, progress: Math.max(0, Math.min(progress, 100)),
        nextTier, tierRange, tierFloor, nextThreshold
      };
    }

    function renderXPBar(tech, size) {
      const xp = getXPData(tech);
      const sizeClass = size === 'sm' ? 'xp-bar-sm' : size === 'lg' ? 'xp-bar-lg' : '';
      const tierLower = xp.tier.toLowerCase();
      const glowClass = xp.progress > 90 ? 'xp-near-levelup' : '';
      return `
        <div class="xp-bar-wrap ${sizeClass} ${glowClass}">
          <div class="xp-bar-header">
            <span class="xp-tier-badge tier-${tierLower}" style="font-family:'Orbitron',monospace;font-size:11px;font-weight:700;">${xp.tier}-TIER</span>
            <span class="xp-label">${xp.nextTier ? xp.tierLabel + ' \u2192 ' + xp.nextTier + '-Tier' : '\u2605 MAX RANK'}</span>
            <span class="xp-values">${xp.xpCurrent} / ${xp.xpNext} XP</span>
          </div>
          <div class="xp-bar-track">
            <div class="xp-bar-fill tier-fill-${tierLower}" style="width:${xp.progress}%">
              ${xp.progress > 15 ? '<span class="xp-bar-text">' + Math.round(xp.progress) + '%</span>' : ''}
            </div>
            ${xp.nextTier ? '<div class="xp-bar-marker" style="left:100%"><span>' + xp.nextThreshold + '</span></div>' : ''}
          </div>
          <div class="xp-bar-footer">
            <span>${xp.composite} Composite</span>
            ${xp.nextTier ? '<span>+' + (xp.nextThreshold - xp.composite) + ' pts to ' + xp.nextTier + '-Tier</span>' : '<span style="color:#fbbf24">\u2746 Elite Status</span>'}
          </div>
        </div>
      `;
    }

    // ========== GAMIFICATION: ACHIEVEMENT BADGES ==========
    function getAchievements(tech) {
      const info = getTechTier(tech);
      const st = stData.find(s => s.name === tech.short);
      const gr = googleReviews[tech.short];
      const skills = (skillsData.assignments[tech.short] || []).length;
      const badges = [];
      
      // Revenue milestones
      if (st && st.overview.revenue >= 20000) badges.push({ id: 'revenue_legend', icon: '\uD83D\uDCB0', name: 'Revenue Legend', desc: '$20K+ revenue', tier: 'gold', earned: true });
      else if (st && st.overview.revenue >= 15000) badges.push({ id: 'revenue_master', icon: '\uD83D\uDCB5', name: 'Revenue Master', desc: '$15K+ revenue', tier: 'silver', earned: true });
      else if (st && st.overview.revenue >= 8000) badges.push({ id: 'revenue_rookie', icon: '\uD83D\uDCB2', name: 'Revenue Builder', desc: '$8K+ revenue', tier: 'bronze', earned: true });
      else badges.push({ id: 'revenue_locked', icon: '\uD83D\uDCB2', name: 'Revenue Builder', desc: 'Reach $8K revenue', tier: 'locked', earned: false });
      
      // Conversion rate
      if (st && st.nexstar.conversion_rate >= 70) badges.push({ id: 'closer', icon: '\uD83C\uDFAF', name: 'The Closer', desc: '70%+ conversion', tier: 'gold', earned: true });
      else if (st && st.nexstar.conversion_rate >= 55) badges.push({ id: 'closer_silver', icon: '\uD83C\uDFAF', name: 'Sharp Shooter', desc: '55%+ conversion', tier: 'silver', earned: true });
      else badges.push({ id: 'closer_locked', icon: '\uD83C\uDFAF', name: 'Sharp Shooter', desc: 'Reach 55% conversion', tier: 'locked', earned: false });
      
      // Google Reviews
      if (gr && gr.count >= 50) badges.push({ id: 'review_king', icon: '\u2B50', name: 'Review King', desc: '50+ reviews', tier: 'gold', earned: true });
      else if (gr && gr.count >= 20) badges.push({ id: 'review_star', icon: '\u2B50', name: 'Review Star', desc: '20+ reviews', tier: 'silver', earned: true });
      else if (gr && gr.count >= 5) badges.push({ id: 'review_start', icon: '\u2B50', name: 'Getting Noticed', desc: '5+ reviews', tier: 'bronze', earned: true });
      else badges.push({ id: 'review_locked', icon: '\u2B50', name: 'Getting Noticed', desc: 'Get 5+ reviews', tier: 'locked', earned: false });
      
      // Skills mastery
      if (skills >= 40) badges.push({ id: 'skill_master', icon: '\uD83D\uDD27', name: 'Skill Master', desc: '40+ skills tagged', tier: 'gold', earned: true });
      else if (skills >= 25) badges.push({ id: 'skill_adept', icon: '\uD83D\uDD27', name: 'Skill Adept', desc: '25+ skills', tier: 'silver', earned: true });
      else if (skills >= 15) badges.push({ id: 'skill_learner', icon: '\uD83D\uDD27', name: 'Skill Learner', desc: '15+ skills', tier: 'bronze', earned: true });
      else badges.push({ id: 'skill_locked', icon: '\uD83D\uDD27', name: 'Skill Learner', desc: 'Earn 15+ skills', tier: 'locked', earned: false });
      
      // Install achievements
      if (st && st.installs.count >= 5) badges.push({ id: 'install_pro', icon: '\uD83C\uDFE0', name: 'Install Pro', desc: '5+ installs', tier: 'gold', earned: true });
      else if (st && st.installs.count >= 2) badges.push({ id: 'install_start', icon: '\uD83C\uDFE0', name: 'Install Starter', desc: '2+ installs', tier: 'bronze', earned: true });
      else badges.push({ id: 'install_locked', icon: '\uD83C\uDFE0', name: 'Install Starter', desc: 'Complete 2+ installs', tier: 'locked', earned: false });
      
      // Aptitude
      if (info.aptScore >= 90) badges.push({ id: 'brain', icon: '\uD83E\uDDE0', name: 'Big Brain', desc: '90%+ aptitude', tier: 'gold', earned: true });
      else if (info.aptScore >= 75) badges.push({ id: 'brain_silver', icon: '\uD83E\uDDE0', name: 'Sharp Mind', desc: '75%+ aptitude', tier: 'silver', earned: true });
      else badges.push({ id: 'brain_locked', icon: '\uD83E\uDDE0', name: 'Sharp Mind', desc: 'Score 75%+ on aptitude', tier: 'locked', earned: false });
      
      // Perfect reviews (all 5-star)
      if (gr && gr.fiveStar === gr.count && gr.count >= 3) badges.push({ id: 'perfect', icon: '\uD83D\uDC8E', name: 'Flawless', desc: 'All 5-star reviews', tier: 'gold', earned: true });
      
      // Dispatch coverage
      if (info.dispatchTagCount >= 4) badges.push({ id: 'dispatch_hero', icon: '\uD83D\uDE90', name: 'Dispatch Hero', desc: '4+ dispatch tags', tier: 'gold', earned: true });
      else if (info.dispatchTagCount >= 2) badges.push({ id: 'dispatch_ready', icon: '\uD83D\uDE90', name: 'Dispatch Ready', desc: '2+ dispatch tags', tier: 'bronze', earned: true });
      
      return badges;
    }

    function renderBadgeRow(badges, maxShow) {
      const show = maxShow ? badges.slice(0, maxShow) : badges;
      const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return '<div class="badge-row">' + show.map(b => {
        const tierLabel = b.earned ? (b.tier.charAt(0).toUpperCase() + b.tier.slice(1)) : 'Locked';
        return `<div class="achievement-badge badge-${b.tier}${b.earned ? '' : ' badge-locked'}"
          data-badge-tip="1"
          data-badge-icon="${esc(b.icon)}"
          data-badge-name="${esc(b.name)}"
          data-badge-desc="${esc(b.desc)}"
          data-badge-tier="${esc(tierLabel)}"
          data-badge-earned="${b.earned ? '1' : '0'}">
          <span class="badge-icon">${b.icon}</span>
          <span class="badge-name">${b.name}</span>
        </div>`;
      }).join('') + '</div>';
    }

    function tierBadgeHTML(tier, size) {
      const cls = size === 'sm' ? 'tier-badge tier-badge-sm' : 'tier-badge';
      return `<span class="${cls} tier-${tier.toLowerCase()}">${tier}</span>`;
    }

    // ========== ACHIEVEMENT BADGE TOOLTIPS ==========
    (function initBadgeTooltips() {
      if (window.__badgeTooltipInit) return;
      window.__badgeTooltipInit = true;

      let tipEl = null;
      let activeBadge = null;
      let hideTimer = null;

      function ensureTip() {
        if (tipEl) return tipEl;
        tipEl = document.createElement('div');
        tipEl.className = 'badge-tooltip';
        tipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(tipEl);
        return tipEl;
      }

      function escapeHTML(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
          .replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      function buildContent(badge) {
        const icon = badge.getAttribute('data-badge-icon') || '';
        const name = badge.getAttribute('data-badge-name') || '';
        const desc = badge.getAttribute('data-badge-desc') || '';
        const tier = badge.getAttribute('data-badge-tier') || '';
        const earned = badge.getAttribute('data-badge-earned') === '1';
        const tierKey = tier.toLowerCase();
        const descBlock = earned
          ? `<div class="bt-desc">${escapeHTML(desc)}</div>`
          : `<div class="bt-locked-note">\uD83D\uDD12 ${escapeHTML(desc)}</div>`;
        return `
          <div class="bt-head">
            <span class="bt-icon">${icon}</span>
            <span class="bt-name">${escapeHTML(name)}</span>
          </div>
          ${descBlock}
          <span class="bt-tier tier-${escapeHTML(tierKey)}">${escapeHTML(tier)}</span>
          <div class="bt-arrow"></div>
        `;
      }

      function positionTip(badge) {
        const rect = badge.getBoundingClientRect();
        const tRect = tipEl.getBoundingClientRect();
        const margin = 10;
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        const placeBelow = spaceAbove < tRect.height + margin && spaceBelow > spaceAbove;

        let top = placeBelow
          ? rect.bottom + margin
          : rect.top - tRect.height - margin;
        let left = rect.left + (rect.width / 2) - (tRect.width / 2);

        left = Math.max(8, Math.min(left, window.innerWidth - tRect.width - 8));

        tipEl.style.top = top + 'px';
        tipEl.style.left = left + 'px';
        tipEl.classList.toggle('tip-above', !placeBelow);
        tipEl.classList.toggle('tip-below', placeBelow);

        const arrow = tipEl.querySelector('.bt-arrow');
        if (arrow) {
          const badgeCenter = rect.left + rect.width / 2;
          const arrowLeft = badgeCenter - left;
          arrow.style.left = Math.max(10, Math.min(arrowLeft, tRect.width - 10)) + 'px';
          arrow.style.marginLeft = '-5px';
        }
      }

      function showTip(badge) {
        clearTimeout(hideTimer);
        ensureTip();
        activeBadge = badge;
        tipEl.innerHTML = buildContent(badge);
        tipEl.style.top = '-9999px';
        tipEl.style.left = '-9999px';
        tipEl.classList.add('visible');
        requestAnimationFrame(() => positionTip(badge));
      }

      function hideTip() {
        if (!tipEl) return;
        tipEl.classList.remove('visible');
        activeBadge = null;
      }

      document.addEventListener('mouseover', function(e) {
        const badge = e.target.closest && e.target.closest('[data-badge-tip]');
        if (!badge) return;
        showTip(badge);
      });
      document.addEventListener('mouseout', function(e) {
        const badge = e.target.closest && e.target.closest('[data-badge-tip]');
        if (!badge) return;
        const to = e.relatedTarget;
        if (to && badge.contains(to)) return;
        hideTimer = setTimeout(hideTip, 80);
      });

      document.addEventListener('click', function(e) {
        const badge = e.target.closest && e.target.closest('[data-badge-tip]');
        if (badge) {
          if (activeBadge === badge) {
            hideTip();
          } else {
            showTip(badge);
          }
          e.stopPropagation();
          return;
        }
        if (activeBadge) hideTip();
      }, true);

      document.addEventListener('touchstart', function(e) {
        const badge = e.target.closest && e.target.closest('[data-badge-tip]');
        if (badge) {
          showTip(badge);
        } else if (activeBadge) {
          hideTip();
        }
      }, { passive: true });

      window.addEventListener('scroll', function() { if (activeBadge) hideTip(); }, true);
      window.addEventListener('resize', function() { if (activeBadge) hideTip(); });
    })();

    // ========== SEEN SKILLS TRACKER ==========
    const SEEN_SKILLS_KEY = 'snappy_seen_skills';
    function getSeenSkills() {
      try { return JSON.parse(localStorage.getItem(SEEN_SKILLS_KEY)) || []; } catch(e) { return []; }
    }
    function markSkillsSeen(ids) {
      var seen = getSeenSkills();
      var changed = false;
      ids.forEach(function(id) { if (seen.indexOf(id) === -1) { seen.push(id); changed = true; } });
      if (changed) localStorage.setItem(SEEN_SKILLS_KEY, JSON.stringify(seen));
    }
    function isSkillNew(skill) {
      if (!skill.isNew) return false;
      return getSeenSkills().indexOf(skill.id) === -1;
    }

    // ========== SKILLS DATA ==========
    const skillsData = {
      categories: {
        A: { name: "Technical Execution", color: "#2D6A6A", skills: [
          { id: "A1", name: "Compressor Changeout", desc: "Independently diagnose, swap compressor, braze, recharge, verify", nextech: "Level 4" },
          { id: "A2", name: "Evap Coil Replacement", desc: "Remove/replace evap coils, handle refrigerant, leak-check", nextech: "Level 3" },
          { id: "A3", name: "Ductwork \u2014 Repairs", desc: "Identify, seal, repair duct deficiencies", nextech: "Level 2" },
          { id: "A4", name: "Ductwork \u2014 Design/Install", desc: "Design and install new duct runs from scratch", nextech: "Level 3" },
          { id: "A5", name: "Brazing Certified", desc: "Safe, leak-free brazing on copper linesets", nextech: "Level 3" },
          { id: "A6", name: "Electrical \u2014 Advanced", desc: "Low-voltage controls, wiring diagrams, transformer/contactor work", nextech: "Level 1+4" },
          { id: "A7", name: "Refrigerant Management", desc: "Recovery, recharge by weight/subcooling/superheat, leak check", nextech: "Level 3" },
          { id: "A8", name: "System Startup & Commission", desc: "Full system startup, performance verification, documentation", nextech: "Level 4" },
          { id: "A9", name: "Combustion Analysis", desc: "CO measurement, draft testing, gas pressure, flue gas analysis", nextech: "Level 2", isNew: true },
          { id: "A10", name: "Leak Detection Methods", desc: "Electronic, bubble, UV dye leak detection techniques", nextech: "Level 4", isNew: true },
          { id: "A11", name: "Motors & Capacitors", desc: "Test, diagnose, replace PSC/ECM motors and capacitors", nextech: "Level 1+4", isNew: true }
        ]},
        B: { name: "Diagnostics & Troubleshooting", color: "#C47F17", skills: [
          { id: "B1", name: "Systematic Diagnosis", desc: "Repeatable diagnostic process \u2014 symptoms to root cause", nextech: "Level 3-4" },
          { id: "B2", name: "Electrical Troubleshooting", desc: "Trace electrical faults, use meter, read schematics", nextech: "Level 1+4" },
          { id: "B3", name: "Advanced Refrigerant Diag", desc: "Leak sources, metering issues, overcharge, non-condensables", nextech: "Level 4" },
          { id: "B4", name: "Indoor Air Quality Diag", desc: "Assess IAQ: humidity, airflow, filtration, ventilation", nextech: "Level 2" },
          { id: "B5", name: "Heat Exchanger Inspection", desc: "Inspect for cracks/failure, document, present safety recs", nextech: "Level 2+4" },
          { id: "B6", name: "Control Board Troubleshoot", desc: "LED codes, board I/O testing, failed board vs component", nextech: "Level 4", isNew: true },
          { id: "B7", name: "Igniter & Flame Rect", desc: "Hot surface igniters, flame rectification, resistance specs", nextech: "Level 4", isNew: true },
          { id: "B8", name: "Gas Valve Troubleshooting", desc: "Smart valves, gas piping, regulator problems, LP kits", nextech: "Level 4", isNew: true },
          { id: "B9", name: "Zoning System Diagnosis", desc: "Dampers, zone panels, bypass, individual zone calls", nextech: "Level 4", isNew: true }
        ]},
        C: { name: "Sales & Revenue", color: "#8B3A3A", skills: [
          { id: "C1", name: "Options Presentation", desc: "Good/Better/Best repair or replacement options", nextech: "Level 3" },
          { id: "C2", name: "Membership Conversions", desc: "Present and close maintenance agreements", nextech: "Level 4" },
          { id: "C3", name: "Equipment Sales", desc: "Equipment recs that converted to sold installs", nextech: "" },
          { id: "C4", name: "High Revenue Service", desc: "Above-average ticket revenue through thorough recs", nextech: "" },
          { id: "C5", name: "IAQ/Accessory Upsell", desc: "UV lights, media filters, dehumidifiers, surge protectors", nextech: "Level 2" },
          { id: "C6", name: "Service Partner Plans", desc: "Introduce, explain benefits, close SPPs", nextech: "Level 4", isNew: true },
          { id: "C7", name: "Handling Pushbacks", desc: "Navigate price resistance and objections without pressure", nextech: "Level 4", isNew: true }
        ]},
        D: { name: "Work Quality", color: "#5B4A8A", skills: [
          { id: "D1", name: "Thorough Diagnostic Write-Up", desc: "Complete ST documentation: measurements, photos, readings", nextech: "Level 4" },
          { id: "D2", name: "Clean Jobsite", desc: "Leaves work area cleaner than found", nextech: "Level 3" },
          { id: "D3", name: "SOP Compliance", desc: "Follows all company processes without shortcuts", nextech: "Level 3" },
          { id: "D4", name: "Customer Follow-Up", desc: "Ensures customer knows what was done and recommended", nextech: "Level 3" },
          { id: "D5", name: "Summary of Findings", desc: "Thorough written summary with photos, measurements, recs", nextech: "Level 3", isNew: true }
        ]},
        E: { name: "Equipment & Installs", color: "#3A7A4A", skills: [
          { id: "E1", name: "Full System Changeout", desc: "Independent full split system changeout start to finish", nextech: "Level 3" },
          { id: "E2", name: "Assisted Changeout", desc: "System changeout with guidance or lead tech present", nextech: "" },
          { id: "E3", name: "Mini-Split Install", desc: "Ductless mini-split installations (single or multi-zone)", nextech: "Level 1" },
          { id: "E4", name: "Gas Furnace Install/Repair", desc: "Gas furnace installs, heat exchanger, gas line, combustion", nextech: "Level 2" }
        ]},
        F: { name: "Certifications", color: "#D4880B", skills: [
          { id: "F1", name: "EPA 608 Universal", desc: "Active EPA Section 608 Universal certification", nextech: "" },
          { id: "F2", name: "NATE Certified", desc: "Current NATE certification in at least one specialty", nextech: "" },
          { id: "F3", name: "Nexstar Service System", desc: "Completed Nexstar service tech training", nextech: "Level 3" },
          { id: "F4", name: "Mfr Cert \u2014 Trane", desc: "Trane factory training (Tech Builder or equivalent)", nextech: "" },
          { id: "F5", name: "Vocational / Trade School", desc: "Accredited HVAC vocational program completed", nextech: "" },
          { id: "F6", name: "NexTech Level 1-2", desc: "Completed NexTech Academy Levels 1-2", nextech: "Level 1-2", isNew: true },
          { id: "F7", name: "NexTech Level 3-4", desc: "Graduated from NexTech Academy", nextech: "Level 3-4", isNew: true }
        ]},
        G: { name: "Soft Skills", color: "#E07B3A", skills: [
          { id: "G1", name: "Strong Customer Reviews", desc: "10+ Google reviews with 4.5-5 star ratings", nextech: "" },
          { id: "G2", name: "Professional Presentation", desc: "Uniform, van, appearance meet company standards", nextech: "Level 3" },
          { id: "G3", name: "Customer Communication", desc: "Explains repairs clearly to non-technical customers", nextech: "Level 2" }
        ]},
        H: { name: "Nexstar Service System", color: "#1A7A7A", skills: [
          { id: "H1", name: "NSS \u2014 Greet", desc: "Professional first impression, shoe covers, agenda card, 3 pillars of trust", nextech: "Level 3", isNew: true },
          { id: "H2", name: "NSS \u2014 Explore", desc: "Symptom/lifestyle questions, photos, Summary of Findings, price conditioning", nextech: "Level 3", isNew: true },
          { id: "H3", name: "NSS \u2014 Present", desc: "3-6 options to all decision-makers, link-say-spin-zip method", nextech: "Level 3", isNew: true },
          { id: "H4", name: "NSS \u2014 Execute", desc: "Craftsman quality, clean workspace, time management", nextech: "Level 3", isNew: true },
          { id: "H5", name: "NSS \u2014 Wrap Up", desc: "Test work, show customer, SPP offer, ask for review, curbside eval", nextech: "Level 3", isNew: true },
          { id: "H6", name: "Challenging Situations", desc: "Handle upset customers, second opinions, scope disputes professionally", nextech: "Level 4", isNew: true }
        ]}
      },
      assignments: {
        "Chris":  ["A6","A7","A8","A10","A11","B1","B2","B3","B5","B6","B7","B8","B9","C3","D1","D2","D5","F1","F2","F3","F5","G2","G3"],
        "Dewone": ["A3","A7","A10","A11","B1","B5","B6","B7","B8","B9","C2","C3","C4","D2","F1","G1"],
        "Benji":  ["A2","A3","A5","A7","A9","A10","A11","B1","B2","B4","B5","B6","B7","B8","B9","C1","C5","D1","D2","D3","D5","E2","E4","F1","F2","F3","F4","G2","G3","H1"],
        "Daniel": ["A1","A2","A3","A4","A5","A7","A8","A10","A11","B1","B2","B3","B5","B6","B7","B8","B9","C4","D2","E1","E2","E3","E4","F1","F2","F3","F4","F5","G1"],
        "Dee":    ["A1","A2","A3","A5","A7","A10","A11","B1","B5","B7","B8","B9","D2","E1","E2","E3","E4","F1"]
      },
      levels: {
        "C-1":    { min: 5,  max: 7,  composite: "< 60" },
        "C-2":    { min: 8,  max: 14, composite: "60-69" },
        "C-3":    { min: 15, max: 20, composite: "65-74" },
        "B-Entry":{ min: 21, max: 26, composite: "72-80" },
        "B-2":    { min: 27, max: 31, composite: "78-85" },
        "A-1":    { min: 32, max: 35, composite: "83-88" },
        "A-2":    { min: 36, max: 38, composite: "86-91" },
        "A-3":    { min: 39, max: 42, composite: "89-93" },
        "A-4":    { min: 43, max: 45, composite: "91-95" },
        "S-Tier": { min: 46, max: 48, composite: "95+" }
      },
      tierCrossings: {
        "C\u2192B": { minSkills: 21, mustHave: ["A1 or A2","B1","C1","D1","D3","F1","3+ NSS steps"] },
        "B\u2192A": { minSkills: 32, mustHave: ["A1","A2","B1","B2","B6","C1","C3","D1","D5","E1","F1","All 5 NSS steps","1 cert beyond EPA"] },
        "A\u2192S": { minSkills: 46, mustHave: ["Full/near-full profile","Proven mentorship","H6"] }
      },
      nextechLevels: {
        "Level 1": { title: "HVAC Fundamentals", months: "Months 1-4", outcome: "Educated helper", color: "#3A7A9A", skills: ["A6 (foundation)","A11","A3 (foundation)","A7 (foundation)"] },
        "Level 2": { title: "Basic Skills", months: "Months 5-9", outcome: "Advanced helper, may run maintenance", color: "#5B8A4A", skills: ["A9","A3","B4","B5 (foundation)","C5","E4","G3"] },
        "Level 3": { title: "Intermediate Skills", months: "Months 10-14", outcome: "Varied service calls", color: "#7A5A2A", skills: ["A2","A4","A5","A7","F3","H1","H2","H3","H4","H5","C1","D2","D3","D4","D5","E1 or E2"] },
        "Level 4": { title: "Advanced Skills", months: "Months 14-18", outcome: "Advanced troubleshooting", color: "#6A2A6A", skills: ["A1","A8","A10","B3","B6","B7","B8","B9","C2","C6","C7","D1","F7","H6"] }
      },
      devPriorities: {
        "Chris":  { next: ["B7","B8","C7","B5"], action: "Ride-along verify NSS; target Level 4 diagnostics" },
        "Dewone": { next: ["H1","H2","H4","H5","D1"], action: "Ride-along for NSS; enroll NexTech Academy" },
        "Benji":  { next: ["C1","C2","D1","D5"], action: "Enroll NexTech Academy Level 3" },
        "Daniel": { next: ["C1","C6","E1","F1 verify","H1-H5"], action: "Nexstar Service System training; EPA cert" },
        "Dee":    { next: ["F1","B1","D1","H1","H2"], action: "EPA enrollment week 1; ride-along within 30 days" }
      }
    };

    // ========== SKILLS PERSISTENCE (localStorage) ==========
    const SKILLS_STORAGE_KEY = 'snappy_skills_assignments';
    const DEFAULT_ASSIGNMENTS = JSON.parse(JSON.stringify(skillsData.assignments));

    // Load saved assignments from localStorage on init
    (function loadSavedAssignments() {
      try {
        const saved = localStorage.getItem(SKILLS_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          // Validate structure: must have same tech keys
          const defaultKeys = Object.keys(DEFAULT_ASSIGNMENTS).sort().join(',');
          const savedKeys = Object.keys(parsed).sort().join(',');
          if (defaultKeys === savedKeys) {
            skillsData.assignments = parsed;
          }
        }
      } catch (e) { /* ignore parse errors, use defaults */ }
    })();

    function saveSkillAssignments() {
      try {
        localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skillsData.assignments));
        if (SyncEngine.isConfigured()) SyncEngine.write('skills', skillsData.assignments);
        // Flash save indicator
        const indicator = document.getElementById('skSaveIndicator');
        if (indicator) {
          indicator.classList.add('show');
          clearTimeout(indicator._hideTimer);
          indicator._hideTimer = setTimeout(() => indicator.classList.remove('show'), 1800);
        }
      } catch (e) { /* localStorage full or unavailable */ }
    }

    function toggleSkill(tech, skillId) {
      if (!requireManager()) return;
      const arr = skillsData.assignments[tech];
      const idx = arr.indexOf(skillId);
      if (idx >= 0) {
        arr.splice(idx, 1); // remove
      } else {
        arr.push(skillId); // add
        arr.sort(); // keep sorted by ID
      }
      saveSkillAssignments();
      renderSkillsTags(); // re-render all sub-tabs reactively
      // Live-refresh profiles, overview, and rookie cards since skills affect composite
      try { renderProfiles(); } catch(e) {}
      try { renderOverviewTab(); } catch(e) {}
      try { renderRookieCards(); } catch(e) {}

      // Apply pop animation to the toggled cell
      setTimeout(() => {
        const cell = document.querySelector(`[data-skill-toggle="${tech}-${skillId}"]`);
        if (cell) {
          cell.classList.add('just-toggled');
          setTimeout(() => cell.classList.remove('just-toggled'), 350);
        }
      }, 10);
    }

    function resetSkillEdits() {
      if (!confirm('Reset all skill assignments to original defaults? This cannot be undone.')) return;
      skillsData.assignments = JSON.parse(JSON.stringify(DEFAULT_ASSIGNMENTS));
      localStorage.removeItem(SKILLS_STORAGE_KEY);
      renderSkillsTags();
    }

    // ========== TAB NAVIGATION ==========
    // KPI card click navigation
    window.navigateToKpi = function(tabView, stSub) {
      // Switch main tab
      var mainTab = document.querySelector('.nav-tab[data-view="' + tabView + '"]');
      if (mainTab) {
        document.querySelectorAll('.nav-tabs:not(#st-sub-tabs):not(#as-sub-tabs):not(#sk-sub-tabs):not(#mgr-sub-tabs) .nav-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.view-section').forEach(function(s) { s.classList.remove('active'); });
        mainTab.classList.add('active');
        document.getElementById('view-' + tabView).classList.add('active');
      }
      // If ST sub-tab specified, switch to it
      if (stSub && tabView === 'scorecards') {
        var stTab = document.querySelector('#st-sub-tabs .nav-tab[data-st="' + stSub + '"]');
        if (stTab) {
          document.querySelectorAll('#st-sub-tabs .nav-tab').forEach(function(t) { t.classList.remove('active'); });
          document.querySelectorAll('.st-section').forEach(function(s) { s.classList.remove('active'); });
          stTab.classList.add('active');
          var stSection = document.getElementById('st-' + stSub);
          if (stSection) stSection.classList.add('active');
        }
      }
      // Close sidebar if open (mobile slide-in or desktop expanded)
      if (window.innerWidth <= 768) {
        var navEl = document.querySelector('.nav-tabs');
        if (navEl) navEl.classList.remove('mobile-open');
      } else {
        document.body.classList.remove('sidebar-expanded');
        localStorage.setItem('sidebarExpanded', 'false');
      }
      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    document.querySelectorAll('.nav-tabs:not(#st-sub-tabs):not(#as-sub-tabs):not(#sk-sub-tabs):not(#mgr-sub-tabs) .nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tabs:not(#st-sub-tabs):not(#as-sub-tabs):not(#sk-sub-tabs):not(#mgr-sub-tabs) .nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('view-' + tab.dataset.view).classList.add('active');
        // Always scroll to top on tab switch
        window.scrollTo({ top: 0, behavior: 'instant' });
        // Close mobile sidebar on nav
        if (window.innerWidth < 769) {
          document.querySelector('.nav-tabs').classList.remove('mobile-open');
        }
        // Auto-mark NEW skills as seen when visiting skills-related tabs
        var v = tab.dataset.view;
        if (v === 'skills-tags' || v === 'aptitude-skills' || v === 'overview') {
          _markNewSkillsSeen();
        }
        // Animate counters when switching to overview
        if (v === 'overview') { setTimeout(animateCounters, 300); }
        // Re-render Overview tab content when switching back
        if (v === 'overview') {
          renderBulletinBoard();
          if (!radar3dRendered) {
            setTimeout(renderRadar, 200);
          }
        }
      });
    });

    function _markNewSkillsSeen() {
      setTimeout(function() {
        var newIds = [];
        Object.keys(skillsData.categories).forEach(function(k) {
          skillsData.categories[k].skills.forEach(function(s) {
            if (s.isNew) newIds.push(s.id);
          });
        });
        if (newIds.length) {
          markSkillsSeen(newIds);
          // Re-render to remove badges
          renderSkillsTags();
        }
      }, 2000);
    }

    // Aptitude & Skills sub-tabs
    document.querySelectorAll('#as-sub-tabs .nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#as-sub-tabs .nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.as-section').forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('as-' + tab.dataset.as).classList.add('active');
      });
    });

    // ========== PHASE 3: ANIMATED COUNTER ==========
    function animateCounters() {
      document.querySelectorAll('.ov-kpi-value, .kpi-value').forEach(function(el) {
        var textNode = null;
        for (var i = 0; i < el.childNodes.length; i++) {
          if (el.childNodes[i].nodeType === Node.TEXT_NODE) {
            textNode = el.childNodes[i];
            break;
          }
        }
        if (!textNode) return;
        var text = textNode.nodeValue.trim();
        var prefix = '';
        var numStr = text;
        if (text.startsWith('$')) { prefix = '$'; numStr = text.slice(1); }
        numStr = numStr.replace(/,/g, '');
        var target = parseFloat(numStr);
        if (isNaN(target)) return;
        var isFloat = numStr.includes('.');
        var duration = 800;
        var start = performance.now();
        var startVal = 0;
        function tick(now) {
          var elapsed = now - start;
          var progress = Math.min(elapsed / duration, 1);
          var eased = 1 - Math.pow(1 - progress, 3);
          var current = startVal + (target - startVal) * eased;
          if (isFloat) {
            textNode.nodeValue = prefix + current.toFixed(1);
          } else {
            textNode.nodeValue = prefix + Math.round(current).toLocaleString();
          }
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }
    // Trigger counters when Overview tab is shown
    var origSwitchView = null;
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(animateCounters, 500);
    });

    // ========== RENDER KPIs ==========
    function renderKPIs() {
      const teamAvg = techs.reduce((s,t) => s + techOverallAvg(t), 0) / techs.length;
      const strongest = Object.keys(categories).reduce((best, cat) =>
        teamCategoryAvg(cat) > teamCategoryAvg(best) ? cat : best
      );
      const weakest = Object.keys(categories).reduce((worst, cat) =>
        teamCategoryAvg(cat) < teamCategoryAvg(worst) ? cat : worst
      );
      const topTech = techs.reduce((best, t) => techOverallAvg(t) > techOverallAvg(best) ? t : best);
      const totalYears = techs.reduce((s,t) => s + t.years, 0);

      document.getElementById('kpi-row').innerHTML = `
        <div class="kpi-card">
          <div class="kpi-label">Team Average</div>
          <div class="kpi-value" style="color:var(--accent-teal)">${teamAvg.toFixed(1)}<span style="font-size:14px;color:var(--text-muted);font-weight:400"> / 5</span></div>
          <div class="kpi-sub">Across all skill categories</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Strongest Area</div>
          <div class="kpi-value" style="font-size:18px;">${categories[strongest].label}</div>
          <div class="kpi-sub">Avg ${teamCategoryAvg(strongest).toFixed(1)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Needs Focus</div>
          <div class="kpi-value" style="font-size:18px;color:var(--accent-red)">${categories[weakest].label}</div>
          <div class="kpi-sub">Avg ${teamCategoryAvg(weakest).toFixed(1)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Top Scorer</div>
          <div class="kpi-value" style="font-size:18px;">${topTech.short}</div>
          <div class="kpi-sub">Avg ${techOverallAvg(topTech).toFixed(1)} — ${topTech.years} yrs</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Combined Experience</div>
          <div class="kpi-value">${totalYears}<span style="font-size:14px;color:var(--text-muted);font-weight:400"> yrs</span></div>
          <div class="kpi-sub">Avg ${(totalYears/techs.length).toFixed(0)} years per tech</div>
        </div>
      `;
    }

    // ========== OVERVIEW TAB ==========
    const BB_KEY = 'snappy_bulletin_board';

    function bbLoad() {
      try {
        var d = JSON.parse(localStorage.getItem(BB_KEY)) || {};
        return { meetings: d.meetings || [], oneOnOnes: d.oneOnOnes || [], rideAlongs: d.rideAlongs || [], matrixUpdates: d.matrixUpdates || [] };
      } catch(e) { return { meetings: [], oneOnOnes: [], rideAlongs: [], matrixUpdates: [] }; }
    }
    function bbSave(data) {
      localStorage.setItem(BB_KEY, JSON.stringify(data));
      if (SyncEngine.isConfigured()) SyncEngine.write('bulletin', data);
      // Re-render tech profiles so Coaching History stays in sync with BB
      try { if (typeof renderProfiles === 'function') renderProfiles(); } catch(e) {}
    }
    function bbUID() {
      return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    // Seed bulletin board updates on first load
    (function bbSeedUpdates() {
      var bb = bbLoad();
      var seededIds = {
        'st_update_20260418': { date: '2026-04-18', text: 'ServiceTitan scorecard data refreshed (4/18/26 4:30 PM). Key changes: Dewone revenue up to $25,675 (+$1,838), conversion 79%. Benji revenue $18,238 (+$1,420), conversion improved to 56%. Daniel revenue $19,162 (+$2,364), conversion 64%. Chris revenue $15,359 (+$552), conversion 55%. Chris install count 12 ($151K). Memberships: Benji up to 2 sold (8%), Chris 6 sold (32%). Team total MTD revenue $84,850.' }
      };
      var changed = false;
      Object.keys(seededIds).forEach(function(sid) {
        var exists = (bb.matrixUpdates || []).some(function(u) { return u.id === sid; });
        if (!exists) {
          bb.matrixUpdates = bb.matrixUpdates || [];
          bb.matrixUpdates.push({ id: sid, date: seededIds[sid].date, text: seededIds[sid].text, createdAt: Date.now() });
          changed = true;
        }
      });
      if (changed) bbSave(bb);
    })();

    function bbGetWeekRange() {
      var now = new Date();
      var day = now.getDay();
      var sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
      var sat = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 6);
      return { start: sun, end: sat };
    }
    function bbFmtDate(d) {
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    function bbFmtDay(dateStr) {
      var d = new Date(dateStr + 'T12:00:00');
      var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
    }
    function bbFmtWeek(d) {
      var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
    }

    // Get this week's Wednesday date
    function bbGetWednesday() {
      var week = bbGetWeekRange();
      var wed = new Date(week.start);
      wed.setDate(wed.getDate() + 3);
      return bbFmtDate(wed);
    }

    function renderOverviewTab() {
      // ---- 1. KPI COUNTERS ----
      var totalCallbacks = 0;
      var totalComplaints = 0;
      var totalRevenue = 0;
      var totalReviews = 0;
      var totalInstallRev = 0;
      var totalMtdInstalls = 0;
      var totalMtdInstallRev = 0;

      stData.forEach(function(st) {
        totalCallbacks += st.productivity.recalls || 0;
        totalRevenue += st.mtd_service_rev || 0;
        totalInstallRev += st.installs.total_revenue || 0;
        totalMtdInstalls += st.mtd_installs || 0;
        totalMtdInstallRev += st.mtd_install_rev || 0;
      });
      // Team MTD install totals (all installs incl. Adam)
      totalMtdInstalls = 5;
      totalMtdInstallRev = 63246;

      try {
        var tfRaw = localStorage.getItem('snappy_tech_files');
        if (tfRaw) {
          var tfData = JSON.parse(tfRaw);
          Object.keys(tfData).forEach(function(techName) {
            if (Array.isArray(tfData[techName])) {
              tfData[techName].forEach(function(f) {
                if (f.type === 'complaint') totalComplaints++;
              });
            }
          });
        }
      } catch(e) {}

      Object.keys(googleReviews).forEach(function(name) {
        totalReviews += googleReviews[name].count || 0;
      });

      // Pull live recall/complaint counts from dispatch logs
      var liveRecalls = getTotalRecalls();
      var liveComplaints = getTotalComplaints();

      var kpiHTML = '';
      var kpis = [
        { icon: '\ud83d\udd04', value: liveRecalls, label: 'Recalls', sub: 'Active dispatch recalls', nav: 'dispatch', stSub: null },
        { icon: '\u26a0\ufe0f', value: liveComplaints, label: 'Complaints', sub: 'Active customer complaints', nav: 'dispatch', stSub: null },
        { icon: '\ud83d\udcb0', value: '$' + totalRevenue.toLocaleString(), label: 'Service Revenue', sub: 'Maintenance & service only', nav: 'scorecards', stSub: 'overview' },
        { icon: '\u2b50', value: totalReviews, label: 'Google Reviews', sub: 'Last 90 days', nav: 'profiles', stSub: null },
        { icon: '\ud83c\udfe0', value: '$' + totalMtdInstallRev.toLocaleString(), label: 'Install Revenue', sub: 'Month-to-date', nav: 'scorecards', stSub: 'installs' },
        { icon: '\ud83d\udee0\ufe0f', value: totalMtdInstalls, label: 'MTD Installs', sub: 'Month-to-date completed', nav: 'scorecards', stSub: 'installs' }
      ];

      kpis.forEach(function(k) {
        kpiHTML += '<div class="ov-kpi-card ov-kpi-clickable" onclick="navigateToKpi(\'' + k.nav + '\',\'' + (k.stSub || '') + '\')">' +
          '<div class="ov-kpi-icon">' + k.icon + '</div>' +
          '<div class="ov-kpi-value">' + k.value + '</div>' +
          '<div class="ov-kpi-label">' + k.label + '</div>' +
          '<div class="ov-kpi-sub">' + k.sub + '</div>' +
        '</div>';
      });
      document.getElementById('ov-kpi-grid').innerHTML = kpiHTML;

      // ---- 2. ANIMATED LEADERBOARD ----
      var snapHTML = '';
      var sortedTechs = techs.slice().sort(function(a,b) { return getTechTier(b).composite - getTechTier(a).composite; });

      sortedTechs.forEach(function(t, idx) {
        var tierInfo = getTechTier(t);
        var tierLower = tierInfo.tier.toLowerCase();
        var xpData = getXPData(t);
        var st = stData.find(function(s) { return s.name === t.short; });
        var gr = googleReviews[t.short];
        var avatarEl = techAvatars[t.short]
          ? '<img class="ov-snap-avatar" src="' + techAvatars[t.short] + '" alt="' + t.name + '">'
          : '<div class="ov-snap-initials" style="background:' + t.color + '">' + t.initials + '</div>';

        var rankIcon = idx === 0 ? '\uD83D\uDC51' : idx === 1 ? '\uD83E\uDD48' : idx === 2 ? '\uD83E\uDD49' : '#' + (idx + 1);
        var rankClass = idx === 0 ? 'rank-gold' : idx === 1 ? 'rank-silver' : idx === 2 ? 'rank-bronze' : '';

        var tagsHTML = '';
        if (t.managerTags && t.managerTags.length) {
          t.managerTags.slice(0, 3).forEach(function(tag) {
            tagsHTML += '<span class="ov-snap-tag ' + tag.type + '">' + tag.label + '</span>';
          });
        }

        var tRecalls = getRecallCount(t.short);
        var tComplaints = getComplaintCount(t.short);
        if (tRecalls > 0) tagsHTML += '<span class="ov-snap-tag" style="background:rgba(255,152,0,0.12);color:#FF9800;border-color:rgba(255,152,0,0.25)">\uD83D\uDD04 ' + tRecalls + ' Recall' + (tRecalls > 1 ? 's' : '') + '</span>';
        if (tComplaints > 0) tagsHTML += '<span class="ov-snap-tag" style="background:rgba(239,83,80,0.12);color:#EF5350;border-color:rgba(239,83,80,0.25)">\u26A0\uFE0F ' + tComplaints + ' Complaint' + (tComplaints > 1 ? 's' : '') + '</span>';

        var statsLine = '';
        if (st) {
          statsLine += '<strong>$' + st.overview.revenue.toLocaleString() + '</strong> rev';
          statsLine += ' \u2022 <strong>' + st.nexstar.conversion_rate + '%</strong> conv';
        }
        if (gr) {
          statsLine += ' \u2022 <strong>' + gr.count + '</strong> reviews';
        }

        var badges = getAchievements(t);
        var earnedCount = badges.filter(function(b) { return b.earned; }).length;

        snapHTML += '<div class="ov-snap-card leaderboard-card card-animate" style="animation-delay:' + (idx * 0.08) + 's">' +
          '<div class="leaderboard-rank ' + rankClass + '">' + rankIcon + '</div>' +
          avatarEl +
          '<div class="ov-snap-body">' +
            '<div class="ov-snap-name">' + t.short + ' <span class="ov-snap-tier tier-' + tierLower + '">' + tierInfo.tier + '-' + tierInfo.tierLabel + '</span></div>' +
            '<div class="ov-snap-highlights">' + tagsHTML + '</div>' +
            renderXPBar(t, 'sm') +
            (statsLine ? '<div class="ov-snap-stat">' + statsLine + '</div>' : '') +
            '<div class="ov-snap-badges">' + earnedCount + '/' + badges.length + ' badges earned</div>' +
          '</div>' +
        '</div>';
      });
      document.getElementById('ov-snapshot-grid').innerHTML = snapHTML;

      // ---- 3. BULLETIN BOARD ----
      renderBulletinBoard();
    }

    function renderBulletinBoard() {
      // 9-day rolling window: yesterday, today, +7 days forward
      var now9 = new Date();
      var nineStart = new Date(now9.getFullYear(), now9.getMonth(), now9.getDate() - 1);
      var nineEnd = new Date(now9.getFullYear(), now9.getMonth(), now9.getDate() + 7);
      var nineStartStr = bbFmtDate(nineStart);
      var nineEndStr = bbFmtDate(nineEnd);
      var bb = bbLoad();
      var techNames = techs.map(function(t) { return t.short; });

      // All three columns use the 9-day range
      var weekMeetings = bb.meetings.filter(function(m) { return m.date >= nineStartStr && m.date <= nineEndStr; });
      var weekOneOnOnes = bb.oneOnOnes.filter(function(o) { return o.date >= nineStartStr && o.date <= nineEndStr; });
      var weekRideAlongs = bb.rideAlongs.filter(function(r) { return r.date >= nineStartStr && r.date <= nineEndStr; });

      // Also merge manager entries
      if (mgrState && mgrState.entries) {
        var ooIds = {};
        weekOneOnOnes.forEach(function(o) { ooIds[o.id] = true; });
        var raIds = {};
        weekRideAlongs.forEach(function(r) { raIds[r.id] = true; });
        mgrState.entries.forEach(function(e) {
          // 1-on-1s and ride-alongs use 9-day range
          if (e.type === 'one-on-one' && e.date >= nineStartStr && e.date <= nineEndStr && !ooIds[e.id]) {
            weekOneOnOnes.push({ id: e.id, tech: e.tech, date: e.date, status: e.status || 'planned', source: 'mgr' });
          } else if (e.type === 'ride-along' && e.date >= nineStartStr && e.date <= nineEndStr && !raIds[e.id]) {
            weekRideAlongs.push({ id: e.id, tech: e.tech, date: e.date, status: e.status || 'planned', source: 'mgr' });
          }
        });
      }

      // Sort each by date
      weekMeetings.sort(function(a,b) { return a.date < b.date ? -1 : 1; });
      weekOneOnOnes.sort(function(a,b) { return a.date < b.date ? -1 : 1; });
      weekRideAlongs.sort(function(a,b) { return a.date < b.date ? -1 : 1; });

      var nineLabel = bbFmtWeek(nineStart) + ' \u2013 ' + bbFmtWeek(nineEnd);
      var html = '<div class="bb-week-label">' + nineLabel + '</div>';
      html += '<div class="bb-columns">';

      // ---- COLUMN 1: Wed Tech Meetings ----
      html += '<div class="bb-column">';
      html += '<div class="bb-col-header meeting"><span class="bb-col-icon">\ud83d\udce3</span> Wed HVAC Meeting</div>';
      html += '<div class="bb-col-body">';
      if (weekMeetings.length > 0) {
        weekMeetings.forEach(function(m) {
          html += '<div class="bb-card">' +
            '<div class="bb-card-actions mgr-only">' +
              '<button class="bb-edit-btn" onclick="event.stopPropagation();bbEditEntry(\'meetings\',\'' + m.id + '\')" title="Edit">\u270E</button>' +
              '<button class="bb-remove" onclick="bbRemove(\'meetings\',\'' + m.id + '\')">&times;</button>' +
            '</div>' +
            '<div class="bb-card-day">' + bbFmtDay(m.date) + '</div>' +
            '<div class="bb-card-title">' + (m.subject || 'Team Meeting') + '</div>' +
            '<div class="bb-card-meta">' +
              (m.time ? '\u23f0 <strong>' + m.time + '</strong>' : '') +
              (m.location ? ' &bull; \ud83d\udccd ' + m.location : '') +
            '</div>' +
            (m.notes ? '<div class="bb-card-notes">' + m.notes + '</div>' : '') +
          '</div>';
        });
      } else {
        html += '<div class="bb-empty"><div class="bb-empty-icon">\ud83d\udce3</div>No meeting posted yet</div>';
      }
      // Add meeting form (manager only)
      html += '<div class="bb-add-form mgr-only">' +
        '<label>Date</label>' +
        '<input type="date" id="bbMeetDate" value="' + bbGetWednesday() + '">' +
        '<label>Subject / Theme</label>' +
        '<input type="text" id="bbMeetSubject" placeholder="e.g. Superheat & Subcool Review">' +
        '<label>Time</label>' +
        '<input type="text" id="bbMeetTime" placeholder="e.g. 8:00 AM">' +
        '<label>Location</label>' +
        '<input type="text" id="bbMeetLocation" placeholder="e.g. Shop / Zoom">' +
        '<label>Notes</label>' +
        '<textarea id="bbMeetNotes" placeholder="Agenda, materials to bring, etc."></textarea>' +
        '<button class="bb-add-btn meeting" onclick="bbAddMeeting()">+ Post Meeting</button>' +
      '</div>';
      html += '</div></div>';

      // ---- COLUMN 2: 1-on-1s ----
      html += '<div class="bb-column">';
      html += '<div class="bb-col-header oneonone"><span class="bb-col-icon">\ud83e\udd1d</span> 1-on-1s</div>';
      html += '<div class="bb-col-body">';
      if (weekOneOnOnes.length > 0) {
        weekOneOnOnes.forEach(function(o) {
          var statusCls = (o.status || 'planned').replace(/\s/g, '_');
          var statusLbl = o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : 'Planned';
          html += '<div class="bb-card">' +
            '<div class="bb-card-actions mgr-only">' +
              '<button class="bb-edit-btn" onclick="event.stopPropagation();bbEditEntry(\'oneOnOnes\',\'' + o.id + '\')" title="Edit">\u270E</button>' +
              '<button class="bb-remove" onclick="bbRemove(\'oneOnOnes\',\'' + o.id + '\')">&times;</button>' +
            '</div>' +
            '<div class="bb-card-day">' + bbFmtDay(o.date) + '</div>' +
            '<div class="bb-card-title">' + o.tech + '</div>' +
            '<div class="bb-card-meta">' +
              '<span class="bb-status ' + statusCls + '">' + statusLbl + '</span>' +
              (o.time ? ' &bull; \u23f0 ' + o.time : '') +
            '</div>' +
            (o.notes ? '<div class="bb-card-notes">' + o.notes + '</div>' : '') +
          '</div>';
        });
      } else {
        html += '<div class="bb-empty"><div class="bb-empty-icon">\ud83e\udd1d</div>No 1-on-1s this week</div>';
      }
      html += '<div class="bb-add-form mgr-only">' +
        '<label>Tech</label>' +
        '<select id="bbOOTech">';
      techNames.forEach(function(n) { html += '<option value="' + n + '">' + n + '</option>'; });
      html += '</select>' +
        '<label>Date</label>' +
        '<input type="date" id="bbOODate" value="' + bbFmtDate(new Date()) + '">' +
        '<label>Time</label>' +
        '<input type="text" id="bbOOTime" placeholder="e.g. 2:00 PM">' +
        '<label>Status</label>' +
        '<select id="bbOOStatus"><option value="planned">Planned</option><option value="completed">Completed</option></select>' +
        '<label>Notes</label>' +
        '<textarea id="bbOONotes" placeholder="Focus areas, follow-ups, etc."></textarea>' +
        '<button class="bb-add-btn oneonone" onclick="bbAddOneOnOne()">+ Add 1-on-1</button>' +
      '</div>';
      html += '</div></div>';

      // ---- COLUMN 3: Ride-Alongs ----
      html += '<div class="bb-column">';
      html += '<div class="bb-col-header ridealong"><span class="bb-col-icon">\ud83d\ude90</span> Ride-Alongs</div>';
      html += '<div class="bb-col-body">';
      if (weekRideAlongs.length > 0) {
        weekRideAlongs.forEach(function(r) {
          var statusCls = (r.status || 'planned').replace(/\s/g, '_');
          var statusLbl = r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : 'Planned';
          html += '<div class="bb-card">' +
            '<div class="bb-card-actions mgr-only">' +
              '<button class="bb-edit-btn" onclick="event.stopPropagation();bbEditEntry(\'rideAlongs\',\'' + r.id + '\')" title="Edit">\u270E</button>' +
              '<button class="bb-remove" onclick="bbRemove(\'rideAlongs\',\'' + r.id + '\')">&times;</button>' +
            '</div>' +
            '<div class="bb-card-day">' + bbFmtDay(r.date) + '</div>' +
            '<div class="bb-card-title">' + r.tech + '</div>' +
            '<div class="bb-card-meta">' +
              '<span class="bb-status ' + statusCls + '">' + statusLbl + '</span>' +
              (r.time ? ' &bull; \u23f0 ' + r.time : '') +
            '</div>' +
            (r.notes ? '<div class="bb-card-notes">' + r.notes + '</div>' : '') +
          '</div>';
        });
      } else {
        html += '<div class="bb-empty"><div class="bb-empty-icon">\ud83d\ude90</div>No ride-alongs this week</div>';
      }
      html += '<div class="bb-add-form mgr-only">' +
        '<label>Tech</label>' +
        '<select id="bbRATech">';
      techNames.forEach(function(n) { html += '<option value="' + n + '">' + n + '</option>'; });
      html += '</select>' +
        '<label>Date</label>' +
        '<input type="date" id="bbRADate" value="' + bbFmtDate(new Date()) + '">' +
        '<label>Time</label>' +
        '<input type="text" id="bbRATime" placeholder="e.g. 9:00 AM">' +
        '<label>Status</label>' +
        '<select id="bbRAStatus"><option value="planned">Planned</option><option value="completed">Completed</option></select>' +
        '<label>Notes</label>' +
        '<textarea id="bbRANotes" placeholder="Observe mode focus, goals, etc."></textarea>' +
        '<button class="bb-add-btn ridealong" onclick="bbAddRideAlong()">+ Add Ride-Along</button>' +
      '</div>';
      html += '</div></div>';

      html += '</div>'; // close bb-columns

      // ---- BOTTOM ROW: Matrix Updates + Skills Link ----
      html += '<div class="bb-bottom-row">';

      // Matrix Updates log (moved above Skills link)
      html += '<div class="bb-updates-card">' +
        '<div class="bb-updates-header"><span>\ud83d\udcdd</span> Matrix Updates</div>' +
        '<div class="bb-updates-body">';
      var updates = bb.matrixUpdates || [];
      var sortedUpdates = updates.slice().sort(function(a,b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : (b.createdAt || 0) - (a.createdAt || 0); });
      if (sortedUpdates.length > 0) {
        sortedUpdates.forEach(function(u) {
          html += '<div class="bb-update-item">' +
            '<button class="bb-remove mgr-only" onclick="bbRemoveUpdate(\'' + u.id + '\')">&times;</button>' +
            '<div class="bb-update-date">' + bbFmtDay(u.date) + '</div>' +
            '<div class="bb-update-text">' + u.text + '</div>' +
          '</div>';
        });
      } else {
        html += '<div class="bb-empty" style="padding:14px 8px;"><div class="bb-empty-icon">\ud83d\udcdd</div>No updates yet</div>';
      }
      html += '</div>';
      // Add update form (manager only)
      html += '<div class="bb-add-form mgr-only" style="border-radius:0 0 10px 10px;border-top:1px solid var(--border);margin-top:0;">' +
        '<label>Date</label>' +
        '<input type="date" id="bbUpdateDate" value="' + bbFmtDate(new Date()) + '">' +
        '<label>Update</label>' +
        '<textarea id="bbUpdateText" placeholder="e.g. Added new skill tags for Daniel, updated Dewone composite..."></textarea>' +
        '<button class="bb-add-btn meeting" onclick="bbAddUpdate()">+ Post Update</button>' +
      '</div>';
      html += '</div>'; // close bb-updates-card

      // Skills & Tagging System link card
      html += '<div class="bb-link-card" onclick="bbGoToSkillsTags()">' +
        '<div class="bb-link-icon">\ud83c\udff7\ufe0f</div>' +
        '<div class="bb-link-body">' +
          '<div class="bb-link-title">Skills & Tagging System</div>' +
          '<div class="bb-link-desc">View skill categories, assigned tags, and progression requirements</div>' +
        '</div>' +
        '<div class="bb-link-arrow">\u2192</div>' +
      '</div>';

      // Breakdown of Skills button (under Skills link card) — opens the Skills & Tags doc modal
      html += '<div onclick="openSkillsDoc()" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 20px;background:linear-gradient(135deg,#1C2E52,#243b6a);border:1px solid rgba(255,215,0,0.3);border-radius:10px;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.borderColor=\'rgba(255,215,0,0.6)\';this.style.background=\'linear-gradient(135deg,#243b6a,#2d4a82)\'" onmouseout="this.style.borderColor=\'rgba(255,215,0,0.3)\';this.style.background=\'linear-gradient(135deg,#1C2E52,#243b6a)\'">' +
        '<span style="font-size:15px;">\ud83d\udcca</span>' +
        '<span style="font-size:13px;font-weight:700;color:var(--snappy-yellow);">Breakdown of Skills</span>' +
        '<span style="color:var(--snappy-yellow);font-size:14px;">\u2192</span>' +
      '</div>';

      html += '</div>'; // close bb-bottom-row

      document.getElementById('ov-bulletin-board').innerHTML = html;
    }

    // Bulletin board add/remove functions
    function bbAddMeeting() {
      var bb = bbLoad();
      var subject = document.getElementById('bbMeetSubject').value.trim();
      if (!subject) { alert('Please enter a subject/theme.'); return; }
      var newMeeting = {
        id: bbUID(),
        date: document.getElementById('bbMeetDate').value,
        subject: subject,
        time: document.getElementById('bbMeetTime').value.trim(),
        location: document.getElementById('bbMeetLocation').value.trim(),
        notes: document.getElementById('bbMeetNotes').value.trim()
      };
      bb.meetings.push(newMeeting);
      bbSave(bb);
      renderBulletinBoard();
      renderMgrBulletinBoard();
    }

    function bbAddOneOnOne() {
      var bb = bbLoad();
      var newId = bbUID();
      var tech = document.getElementById('bbOOTech').value;
      var date = document.getElementById('bbOODate').value;
      var time = document.getElementById('bbOOTime').value.trim();
      var status = document.getElementById('bbOOStatus').value;
      var notes = document.getElementById('bbOONotes').value.trim();
      bb.oneOnOnes.push({ id: newId, tech: tech, date: date, time: time, status: status, notes: notes });
      bbSave(bb);
      // Sync to manager calendar
      mgrState.entries.push({
        id: newId, type: 'one-on-one', tech: tech, date: date, status: status,
        data: { housekeeping: {}, housekeepingNotes: '', customFocus: notes, redBarn: { include: false, scenario: '', outcome: '' }, coveredSummary: '', actionItems: '', followUp: '' },
        createdAt: Date.now(), updatedAt: Date.now(), source: 'bulletin'
      });
      mgrSave();
      renderBulletinBoard();
      renderManagerTab();
    }

    function bbAddRideAlong() {
      var bb = bbLoad();
      var newId = bbUID();
      var tech = document.getElementById('bbRATech').value;
      var date = document.getElementById('bbRADate').value;
      var time = document.getElementById('bbRATime').value.trim();
      var status = document.getElementById('bbRAStatus').value;
      var notes = document.getElementById('bbRANotes').value.trim();
      bb.rideAlongs.push({ id: newId, tech: tech, date: date, time: time, status: status, notes: notes });
      bbSave(bb);
      // Sync to manager calendar
      mgrState.entries.push({
        id: newId, type: 'ride-along', tech: tech, date: date, status: status,
        data: { ackObservation: false, calls: [], custIssue: '', actualDiagnosis: '', repairPerformed: '', callOutcome: '', debriefManagerBetter: '', debriefTechBetter: '', debriefManagerWin: '', debriefTechWin: '', observations: {}, observationNotes: notes, nextSteps: '' },
        createdAt: Date.now(), updatedAt: Date.now(), source: 'bulletin'
      });
      mgrSave();
      renderBulletinBoard();
      renderManagerTab();
    }

    function bbRemove(category, id) {
      var bb = bbLoad();
      if (bb[category]) {
        bb[category] = bb[category].filter(function(item) { return item.id !== id; });
      }
      bbSave(bb);
      // Also remove from manager calendar if synced
      if (category === 'oneOnOnes' || category === 'rideAlongs') {
        var idx = mgrState.entries.findIndex(function(e) { return e.id === id; });
        if (idx >= 0) {
          mgrState.entries.splice(idx, 1);
          mgrSave();
          renderManagerTab();
        }
      }
      renderBulletinBoard();
      renderMgrBulletinBoard();
    }

    function bbGoToSkillsTags() {
      var tab = document.querySelector('.nav-tab[data-view="skills-tags"]');
      if (tab) tab.click();
    }

    function bbAddUpdate() {
      var bb = bbLoad();
      var text = document.getElementById('bbUpdateText').value.trim();
      if (!text) { alert('Please enter an update.'); return; }
      bb.matrixUpdates.push({
        id: bbUID(),
        date: document.getElementById('bbUpdateDate').value,
        text: text,
        createdAt: Date.now()
      });
      bbSave(bb);
      renderBulletinBoard();
    }

    function bbRemoveUpdate(id) {
      var bb = bbLoad();
      bb.matrixUpdates = bb.matrixUpdates.filter(function(u) { return u.id !== id; });
      bbSave(bb);
      renderBulletinBoard();
    }

    // ---- Bulletin Board: Edit Entry Modal ----
    function bbEditEntry(category, id) {
      var bb = bbLoad();
      var entry = null;
      var isMgrSource = false;
      if (bb[category]) entry = bb[category].find(function(x) { return x.id === id; });
      // Fallback: entry may be sourced from manager calendar (not in BB localStorage)
      if (!entry && mgrState && mgrState.entries) {
        var mgrEntry = mgrState.entries.find(function(e) { return e.id === id; });
        if (mgrEntry) {
          entry = { id: mgrEntry.id, tech: mgrEntry.tech, date: mgrEntry.date, time: mgrEntry.time || '', status: mgrEntry.status || 'planned', notes: mgrEntry.notes || '', source: 'mgr' };
          if (mgrEntry.subject) entry.subject = mgrEntry.subject;
          if (mgrEntry.location) entry.location = mgrEntry.location;
          isMgrSource = true;
        }
      }
      if (!entry) return;

      var techOpts = '';
      techs.forEach(function(t) {
        techOpts += '<option value="' + t.short + '"' + (t.short === entry.tech ? ' selected' : '') + '>' + t.short + '</option>';
      });

      var fields = '';
      var title = '';
      var saveAction = '';

      if (category === 'meetings') {
        title = 'Edit Meeting';
        fields =
          '<label>Date</label><input type="date" id="bbEditDate" value="' + (entry.date || '') + '">' +
          '<label>Subject / Theme</label><input type="text" id="bbEditSubject" value="' + (entry.subject || '').replace(/"/g,'&quot;') + '">' +
          '<label>Time</label><input type="text" id="bbEditTime" value="' + (entry.time || '').replace(/"/g,'&quot;') + '" placeholder="e.g. 8:00 AM">' +
          '<label>Location</label><input type="text" id="bbEditLocation" value="' + (entry.location || '').replace(/"/g,'&quot;') + '" placeholder="e.g. Shop / Zoom">' +
          '<label>Notes</label><textarea id="bbEditNotes">' + (entry.notes || '') + '</textarea>';
      } else if (category === 'oneOnOnes') {
        title = 'Edit 1-on-1';
        fields =
          '<label>Tech</label><select id="bbEditTech">' + techOpts + '</select>' +
          '<label>Date</label><input type="date" id="bbEditDate" value="' + (entry.date || '') + '">' +
          '<label>Time</label><input type="text" id="bbEditTime" value="' + (entry.time || '').replace(/"/g,'&quot;') + '" placeholder="e.g. 2:00 PM">' +
          '<label>Status</label><select id="bbEditStatus"><option value="planned"' + (entry.status === 'planned' ? ' selected' : '') + '>Planned</option><option value="completed"' + (entry.status === 'completed' ? ' selected' : '') + '>Completed</option></select>' +
          '<label>Notes</label><textarea id="bbEditNotes">' + (entry.notes || '') + '</textarea>';
      } else if (category === 'rideAlongs') {
        title = 'Edit Ride-Along';
        fields =
          '<label>Tech</label><select id="bbEditTech">' + techOpts + '</select>' +
          '<label>Date</label><input type="date" id="bbEditDate" value="' + (entry.date || '') + '">' +
          '<label>Time</label><input type="text" id="bbEditTime" value="' + (entry.time || '').replace(/"/g,'&quot;') + '" placeholder="e.g. 9:00 AM">' +
          '<label>Status</label><select id="bbEditStatus"><option value="planned"' + (entry.status === 'planned' ? ' selected' : '') + '>Planned</option><option value="completed"' + (entry.status === 'completed' ? ' selected' : '') + '>Completed</option></select>' +
          '<label>Notes</label><textarea id="bbEditNotes">' + (entry.notes || '') + '</textarea>';
      }

      var modal = document.createElement('div');
      modal.id = 'bbEditModal';
      modal.className = 'bb-edit-modal-overlay';
      modal.innerHTML =
        '<div class="bb-edit-modal">' +
          '<div class="bb-edit-modal-header">' +
            '<span class="bb-edit-modal-title">' + title + '</span>' +
            '<button class="bb-edit-modal-close" onclick="document.getElementById(\'bbEditModal\').remove()">&times;</button>' +
          '</div>' +
          '<div class="bb-edit-modal-body">' + fields + '</div>' +
          '<div class="bb-edit-modal-actions">' +
            '<button class="bb-edit-save" onclick="bbSaveEdit(\'' + category + '\',\'' + id + '\')">Save Changes</button>' +
            '<button class="bb-edit-delete" onclick="if(confirm(\'Delete this entry?\')){ bbRemove(\'' + category + '\',\'' + id + '\'); document.getElementById(\'bbEditModal\').remove(); }">Delete</button>' +
            '<button class="bb-edit-cancel" onclick="document.getElementById(\'bbEditModal\').remove()">Cancel</button>' +
          '</div>' +
        '</div>';
      modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    }

    function bbSaveEdit(category, id) {
      var bb = bbLoad();
      var entry = bb[category] ? bb[category].find(function(x) { return x.id === id; }) : null;
      var isMgrOnly = false;

      // If not in BB data, check manager calendar (mgr-sourced entry)
      if (!entry && mgrState && mgrState.entries) {
        var mgrEntry = mgrState.entries.find(function(e) { return e.id === id; });
        if (mgrEntry) {
          entry = mgrEntry;
          isMgrOnly = true;
        }
      }
      if (!entry) return;

      var dateEl = document.getElementById('bbEditDate');
      var timeEl = document.getElementById('bbEditTime');
      var notesEl = document.getElementById('bbEditNotes');
      var techEl = document.getElementById('bbEditTech');
      var statusEl = document.getElementById('bbEditStatus');

      if (dateEl) entry.date = dateEl.value;
      if (timeEl) entry.time = timeEl.value.trim();
      if (notesEl) entry.notes = notesEl.value.trim();
      if (techEl) entry.tech = techEl.value;
      if (statusEl) entry.status = statusEl.value;

      if (category === 'meetings') {
        var subjectEl = document.getElementById('bbEditSubject');
        var locationEl = document.getElementById('bbEditLocation');
        if (subjectEl) entry.subject = subjectEl.value.trim();
        if (locationEl) entry.location = locationEl.value.trim();
      }

      if (!isMgrOnly) bbSave(bb);
      document.getElementById('bbEditModal').remove();

      // Also update manager calendar if this entry was synced there
      if (category === 'oneOnOnes' || category === 'rideAlongs') {
        var calEntry = mgrState.entries.find(function(e) { return e.id === id; });
        if (calEntry) {
          if (dateEl) calEntry.date = dateEl.value;
          if (techEl) calEntry.tech = techEl.value;
          if (statusEl) calEntry.status = statusEl.value;
          if (notesEl) calEntry.notes = notesEl.value.trim();
          if (timeEl) calEntry.time = timeEl.value.trim();
          mgrSave();
          renderManagerTab();
        }
      }

      renderBulletinBoard();
      renderMgrBulletinBoard();

      // Toast
      var toast = document.createElement('div');
      toast.textContent = '\u2705 Entry updated';
      toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#065f46;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.4s;';
      document.body.appendChild(toast);
      setTimeout(function() { toast.style.opacity = '0'; }, 2000);
      setTimeout(function() { toast.remove(); }, 2500);
    }

    // ========== CHARTS ==========
    var radar3dRendered = false;
    var radarChartInstance = null;
    function renderRadar() {
      var canvas = document.getElementById('radarCanvas');
      if (!canvas) return;
      radar3dRendered = true;

      var catKeys = Object.keys(categories);
      // Build datasets for each tech
      var datasets = techs.map(function(t) {
        return {
          label: t.short,
          data: catKeys.map(function(c) { return +techCategoryAvg(t, c).toFixed(2); }),
          borderColor: t.color,
          backgroundColor: t.color + '33',
          pointBackgroundColor: t.color,
          pointBorderColor: '#fff',
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
          fill: true
        };
      });
// ========== CHART.JS DARK THEME DEFAULTS ==========
if (typeof Chart !== 'undefined') {
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.borderColor = 'rgba(51, 65, 85, 0.3)';
  if (Chart.defaults.plugins && Chart.defaults.plugins.legend) {
    Chart.defaults.plugins.legend.labels = Chart.defaults.plugins.legend.labels || {};
    Chart.defaults.plugins.legend.labels.color = '#e2e8f0';
  }
}

      radarChartInstance = createChart('radarCanvas', {
        type: 'radar',
        data: {
          labels: catKeys.map(function(c) { return categories[c].label; }),
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              min: 0,
              max: 5,
              ticks: { stepSize: 1, backdropColor: 'transparent', color: '#6b7280', font: { size: 10 } },
              grid: { color: 'rgba(0,0,0,0.12)' },
              angleLines: { color: 'rgba(0,0,0,0.12)' },
              pointLabels: { color: '#374151', font: { size: 11, weight: '600' } }
            }
          },
          plugins: {
            legend: {
              display: true,
              position: 'bottom',
              labels: { color: '#374151', usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 12, weight: '600' } }
            },
            tooltip: {
              backgroundColor: 'rgba(15,27,46,0.95)',
              titleColor: '#FFD700',
              bodyColor: '#e0e6f0',
              borderColor: 'rgba(255,215,0,0.3)',
              borderWidth: 1,
              padding: 10
            }
          }
        }
      });
    }
    function renderBar() {
      createChart('barChart', {
        type: 'bar',
        data: {
          labels: techs.map(t => t.short),
          datasets: [{
            label: 'Overall Average',
            data: techs.map(t => +techOverallAvg(t).toFixed(2)),
            backgroundColor: techs.map(t => t.color + 'CC'),
            borderColor: techs.map(t => t.color),
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 52
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          scales: {
            y: { min: 0, max: 5, ticks: { stepSize: 1, font: { size: 11, family: "'JetBrains Mono'" } }, grid: { color: '#EDEBE6' } },
            x: { ticks: { font: { size: 12, family: "'DM Sans'", weight: '500' } }, grid: { display: false } }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: { label: (ctx) => `Score: ${ctx.parsed.y.toFixed(2)} / 5` }
            }
          }
        }
      });
    }

    function renderGroupedBar() {
      const catKeys = Object.keys(categories);
      createChart('groupedBarChart', {
        type: 'bar',
        data: {
          labels: catKeys.map(c => categories[c].label),
          datasets: techs.map(t => ({
            label: t.short,
            data: catKeys.map(c => +techCategoryAvg(t, c).toFixed(2)),
            backgroundColor: t.color + 'BB',
            borderColor: t.color,
            borderWidth: 1,
            borderRadius: 4,
            maxBarThickness: 28
          }))
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          scales: {
            y: { min: 0, max: 5, ticks: { stepSize: 1, font: { size: 11, family: "'JetBrains Mono'" } }, grid: { color: '#EDEBE6' } },
            x: { ticks: { font: { size: 11, family: "'DM Sans'" }, maxRotation: 45 }, grid: { display: false } }
          },
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 12, family: "'DM Sans'" }, usePointStyle: true, padding: 14 } }
          }
        }
      });
    }

    // ========== SERVICETITAN RADAR CHART ==========
    function renderSTRadar() {
      var stCanvas = document.getElementById('stRadarCanvas');
      if (!stCanvas) return;
      var stCtx = stCanvas.getContext('2d');

      // Compute max values across all techs for normalization (0-100 scale)
      var maxRev = 0, maxConv = 0, maxLeads = 0, maxMem = 0, maxOpts = 0, maxClose = 0;
      stData.forEach(function(t) {
        if (t.nexstar.total_revenue > maxRev) maxRev = t.nexstar.total_revenue;
        if (t.nexstar.conversion_rate > maxConv) maxConv = t.nexstar.conversion_rate;
        if (t.nexstar.tech_gen_leads > maxLeads) maxLeads = t.nexstar.tech_gen_leads;
        if (t.memberships.total_mem_pct > maxMem) maxMem = t.memberships.total_mem_pct;
        if (t.productivity.options_per_opp > maxOpts) maxOpts = t.productivity.options_per_opp;
        if (t.sales.close_rate > maxClose) maxClose = t.sales.close_rate;
      });

      // Avoid divide by zero
      if (maxRev === 0) maxRev = 1;
      if (maxConv === 0) maxConv = 1;
      if (maxLeads === 0) maxLeads = 1;
      if (maxMem === 0) maxMem = 1;
      if (maxOpts === 0) maxOpts = 1;
      if (maxClose === 0) maxClose = 1;

      var stRadarLabels = ['Revenue', 'Conversion %', 'Tech-Gen Leads', 'Membership %', 'Options/Opp', 'Close Rate'];

      var stRadarDatasets = stData.map(function(t) {
        return {
          label: t.name,
          data: [
            Math.round((t.nexstar.total_revenue / maxRev) * 100),
            Math.round((t.nexstar.conversion_rate / maxConv) * 100),
            Math.round((t.nexstar.tech_gen_leads / maxLeads) * 100),
            Math.round((t.memberships.total_mem_pct / maxMem) * 100),
            Math.round((t.productivity.options_per_opp / maxOpts) * 100),
            Math.round((t.sales.close_rate / maxClose) * 100)
          ],
          backgroundColor: t.color + '25',
          borderColor: t.color,
          borderWidth: 2,
          pointBackgroundColor: t.color,
          pointBorderColor: '#0f172a',
          pointBorderWidth: 1,
          pointRadius: 4,
          pointHoverRadius: 7
        };
      });

      createChart('stRadarCanvas', {
        type: 'radar',
        data: {
          labels: stRadarLabels,
          datasets: stRadarDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          scales: {
            r: {
              min: 0,
              max: 100,
              ticks: {
                stepSize: 20,
                backdropColor: 'transparent',
                color: '#94a3b8',
                font: { size: 10, family: "'JetBrains Mono'" }
              },
              grid: {
                color: 'rgba(59,130,246,0.12)',
                lineWidth: 1
              },
              angleLines: {
                color: 'rgba(59,130,246,0.12)',
                lineWidth: 1
              },
              pointLabels: {
                color: '#e2e8f0',
                font: { size: 12, family: "'Inter'", weight: '600' },
                padding: 12
              }
            }
          },
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: '#e2e8f0',
                font: { size: 12, family: "'Inter'" },
                usePointStyle: true,
                pointStyle: 'circle',
                padding: 16
              }
            },
            tooltip: {
              backgroundColor: 'rgba(15,23,42,0.95)',
              titleColor: '#e2e8f0',
              bodyColor: '#cbd5e1',
              borderColor: 'rgba(59,130,246,0.3)',
              borderWidth: 1,
              padding: 12,
              callbacks: {
                label: function(context) {
                  var techName = context.dataset.label;
                  var metric = context.label;
                  var normalized = context.raw;
                  var st = stData.find(function(s) { return s.name === techName; });
                  var raw = '';
                  if (st) {
                    if (metric === 'Revenue') raw = ' ($' + st.nexstar.total_revenue.toLocaleString() + ')';
                    else if (metric === 'Conversion %') raw = ' (' + st.nexstar.conversion_rate + '%)';
                    else if (metric === 'Tech-Gen Leads') raw = ' (' + st.nexstar.tech_gen_leads + ')';
                    else if (metric === 'Membership %') raw = ' (' + st.memberships.total_mem_pct + '%)';
                    else if (metric === 'Options/Opp') raw = ' (' + st.productivity.options_per_opp + ')';
                    else if (metric === 'Close Rate') raw = ' (' + st.sales.close_rate + '%)';
                  }
                  return techName + ': ' + normalized + '/100' + raw;
                }
              }
            }
          }
        }
      });
    }

    // ========== FULL MATRIX TABLE ==========
    function renderMatrix() {
      let html = `<thead><tr>
        <th style="min-width:160px">Skill</th>
        ${techs.map(t => `<th style="text-align:center">${techAvatars[t.short] ? `<img src="${techAvatars[t.short]}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid ${t.color};display:block;margin:0 auto 4px">` : ''}${t.short}</th>`).join('')}
        <th style="text-align:center">Team Avg</th>
      </tr></thead><tbody>`;

      for (const [catKey, cat] of Object.entries(categories)) {
        html += `<tr class="cat-header"><td colspan="${techs.length + 2}" style="color:${cat.color}">${cat.label}</td></tr>`;
        for (const [itemKey, itemLabel] of Object.entries(cat.items)) {
          const vals = techs.map(t => t.scores[catKey][itemKey]);
          const avg = vals.reduce((s,v)=>s+v,0)/vals.length;
          html += `<tr>
            <td>${itemLabel}</td>
            ${vals.map(v => `<td class="score-cell"><span class="score-pill ${scoreClass(v)}">${v}</span></td>`).join('')}
            <td class="score-cell"><span class="avg-pill">${avg.toFixed(1)}</span></td>
          </tr>`;
        }
      }

      for (const [catKey, cat] of Object.entries(professionalCats)) {
        html += `<tr class="cat-header"><td colspan="${techs.length + 2}">${cat.label}</td></tr>`;
        for (const [itemKey, itemLabel] of Object.entries(cat.items)) {
          const vals = techs.map(t => t.scores[catKey][itemKey]);
          const avg = vals.reduce((s,v)=>s+v,0)/vals.length;
          html += `<tr>
            <td>${itemLabel}</td>
            ${vals.map(v => `<td class="score-cell"><span class="score-pill ${scoreClass(v)}">${v}</span></td>`).join('')}
            <td class="score-cell"><span class="avg-pill">${avg.toFixed(1)}</span></td>
          </tr>`;
        }
      }

      html += `<tr class="cat-header"><td colspan="${techs.length + 2}" style="color:var(--accent-teal)">Category Averages</td></tr>`;
      for (const [catKey, cat] of Object.entries(categories)) {
        const vals = techs.map(t => techCategoryAvg(t, catKey));
        const teamAvg = vals.reduce((s,v)=>s+v,0)/vals.length;
        html += `<tr>
          <td style="font-weight:500">${cat.label}</td>
          ${vals.map(v => `<td class="score-cell"><span class="avg-pill">${v.toFixed(1)}</span></td>`).join('')}
          <td class="score-cell"><span class="avg-pill">${teamAvg.toFixed(1)}</span></td>
        </tr>`;
      }

      const overalls = techs.map(t => techOverallAvg(t));
      const teamOverall = overalls.reduce((s,v)=>s+v,0)/overalls.length;
      html += `<tr style="background:var(--accent-teal-light)">
        <td style="font-weight:700">Overall Average</td>
        ${overalls.map(v => `<td class="score-cell"><span class="avg-pill" style="background:var(--accent-teal);color:white;font-weight:700">${v.toFixed(1)}</span></td>`).join('')}
        <td class="score-cell"><span class="avg-pill" style="background:var(--accent-teal);color:white;font-weight:700">${teamOverall.toFixed(1)}</span></td>
      </tr>`;

      html += `<tr style="background:rgba(245, 158, 11, 0.1)">
        <td style="font-weight:700">Tier Ranking</td>
        ${techs.map(t => {
          const ti = getTechTier(t);
          return `<td class="score-cell" style="vertical-align:middle">${tierBadgeHTML(ti.tier, 'sm')} <span style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-left:4px">${ti.composite}</span></td>`;
        }).join('')}
        <td class="score-cell"></td>
      </tr>`;

      html += '</tbody>';
      document.getElementById('matrixTable').innerHTML = html;
    }

    // ========== APTITUDE MAPPING ==========
    function renderAptitudeSkills() {
      // ---- 1. APTITUDE LEADERBOARD ----
      const techAptData = techs.map(t => {
        const apt = aptitudeTests[t.short];
        return { tech: t, apt, total: apt ? apt.totalScore : 0, max: apt ? apt.maxScore : 50, pct: apt ? Math.round((apt.totalScore/apt.maxScore)*100) : 0 };
      }).sort((a,b) => b.total - a.total);

      let leaderHtml = '<div class="apt-leaderboard">';
      techAptData.forEach((d, i) => {
        const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
        const pctColor = d.pct >= 90 ? '#059669' : d.pct >= 80 ? '#2D6A6A' : d.pct >= 70 ? '#D97706' : '#DC2626';
        leaderHtml += `
          <div class="apt-leader-card" style="border-top:3px solid ${d.tech.color}">
            <div class="rank-badge ${rankClass}">${i+1}</div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
              ${techAvatars[d.tech.short] ? `<img src="${techAvatars[d.tech.short]}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid ${d.tech.color}">` : ''}
              <div>
                <div class="apt-leader-name">${d.tech.name}</div>
                <div class="apt-leader-date">${d.apt ? d.apt.date : 'No test'}</div>
              </div>
            </div>
            <div class="apt-leader-score">${d.total}<span class="apt-leader-max">/${d.max}</span></div>
            <div class="apt-leader-pct" style="color:${pctColor}">${d.pct}%</div>
            <div class="apt-leader-bar">
              <div class="apt-leader-bar-fill" style="width:${d.pct}%;background:${pctColor}"></div>
            </div>
            ${d.apt ? `<div style="margin-top:10px;font-size:11px;color:var(--text-secondary);line-height:1.4">${d.apt.interpretation}</div>` : ''}
          </div>`;
      });
      leaderHtml += '</div>';
      document.getElementById('aptLeaderboard').innerHTML = leaderHtml;

      // ---- 2. SECTION SCORES CHART (grouped bar) ----
      const sectionLabels = ['A: Electrical', 'B: Airflow', 'C: Refrigerant', 'D: Zoning/LV', 'E: Bonus'];
      const sectionKeys = ['Section A', 'Section B', 'Section C', 'Section D', 'Bonus (E)'];

      createChart('aptSectionChart', {
        type: 'bar',
        data: {
          labels: sectionLabels,
          datasets: techs.map(t => {
            const apt = aptitudeTests[t.short];
            return {
              label: t.short,
              data: sectionKeys.map(sk => {
                if (!apt) return 0;
                const s = apt.sections.find(sec => sec.label === sk);
                return s ? s.score : 0;
              }),
              backgroundColor: t.color + 'BB',
              borderColor: t.color,
              borderWidth: 1,
              borderRadius: 4,
              maxBarThickness: 24
            };
          })
        },
        options: {
          responsive: true, maintainAspectRatio: true,
          scales: {
            y: { min: 0, max: 10, ticks: { stepSize: 2, font: { size: 11, family: "'JetBrains Mono'" } }, grid: { color: '#EDEBE6' }, title: { display: true, text: 'Score (out of 10)', font: { size: 12, family: "'DM Sans'" } } },
            x: { ticks: { font: { size: 11, family: "'DM Sans'" } }, grid: { display: false } }
          },
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 12, family: "'DM Sans'" }, usePointStyle: true, padding: 14 } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}/10` } }
          }
        }
      });

      // ---- 3. TOTAL SCORE HORIZONTAL BAR ----
      const sorted = [...techAptData];
      createChart('aptTotalChart', {
        type: 'bar',
        data: {
          labels: sorted.map(d => d.tech.short),
          datasets: [{
            label: 'Total Score',
            data: sorted.map(d => d.total),
            backgroundColor: sorted.map(d => d.tech.color + 'BB'),
            borderColor: sorted.map(d => d.tech.color),
            borderWidth: 1,
            borderRadius: 4,
            maxBarThickness: 36
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: true,
          scales: {
            x: { min: 0, max: 50, ticks: { stepSize: 10, font: { size: 11, family: "'JetBrains Mono'" } }, grid: { color: '#EDEBE6' }, title: { display: true, text: 'Total Score (out of 50)', font: { size: 12, family: "'DM Sans'" } } },
            y: { ticks: { font: { size: 12, family: "'DM Sans'", weight: '600' } }, grid: { display: false } }
          },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => `${ctx.parsed.x}/50 (${Math.round(ctx.parsed.x/50*100)}%)` } }
          }
        }
      });

      // ---- 4. SECTION DETAIL GRID ----
      const sectionMeta = [
        { key: 'Section A', name: 'Section A: Electrical', color: '#2D6A6A', bg: '#E8F0F0', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>' },
        { key: 'Section B', name: 'Section B: Airflow', color: '#C47F17', bg: '#FFF4E0', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>' },
        { key: 'Section C', name: 'Section C: Refrigerant', color: '#8B3A3A', bg: '#F5E8E8', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/></svg>' },
        { key: 'Section D', name: 'Section D: Zoning & Low Voltage', color: '#5B4A8A', bg: '#EEEAF5', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3v4M8 3v4M2 13h20"/></svg>' },
        { key: 'Bonus (E)', name: 'Bonus (Section E)', color: '#3A7A4A', bg: '#E8F5EB', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' }
      ];

      let sectionGridHtml = '<div class="apt-section-grid">';
      sectionMeta.forEach(sec => {
        const scores = techs.map(t => {
          const apt = aptitudeTests[t.short];
          if (!apt) return { score: 0, total: 10 };
          const s = apt.sections.find(s2 => s2.label === sec.key);
          return s || { score: 0, total: 10 };
        }).map((s, i) => ({ tech: techs[i], score: s.score, total: s.total, pct: Math.round((s.score/s.total)*100) }));
        scores.sort((a,b) => b.score - a.score);

        sectionGridHtml += `
          <div class="apt-section-card">
            <div class="apt-section-card-header">
              <div class="aptitude-icon" style="background:${sec.bg};color:${sec.color}">${sec.icon}</div>
              <div class="section-name" style="color:${sec.color}">${sec.name}</div>
            </div>
            ${scores.map(s => {
              const barColor = s.pct >= 90 ? '#059669' : s.pct >= 70 ? '#D97706' : '#DC2626';
              return `<div class="apt-section-row">
                <div class="tech-name">${s.tech.short}</div>
                <div style="flex:1">
                  <div class="level-bar"><div class="level-bar-fill" style="width:${s.pct}%;background:${barColor}"></div></div>
                </div>
                <div class="score-val" style="color:${barColor}">${s.score}/${s.total}</div>
              </div>`;
            }).join('')}
          </div>`;
      });
      sectionGridHtml += '</div>';
      document.getElementById('aptSectionGrid').innerHTML = sectionGridHtml;

      // ---- 5. COMPARISON TAB: Aptitude vs Self-Eval ----
      const aptSectionToSelfEval = {
        'Section A': { label: 'A: Electrical', sources: ['electrical'] },
        'Section B': { label: 'B: Airflow', sources: ['airflow'] },
        'Section C': { label: 'C: Refrigerant', sources: ['cooling'] },
        'Section D': { label: 'D: Zoning/LV', sources: ['advanced'] }
      };

      let compHtml = '<div class="comp-grid">';
      techs.forEach(t => {
        const apt = aptitudeTests[t.short];
        compHtml += `
          <div class="comp-card">
            <div class="comp-card-header">
              ${techAvatars[t.short] ? `<img src="${techAvatars[t.short]}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid ${t.color}">` : `<div class="tech-detail-avatar" style="background:${t.color};width:36px;height:36px;font-size:13px">${t.initials}</div>`}
              <div>
                <div style="font-weight:700;font-size:14px">${t.name}</div>
                <div style="font-size:11px;color:var(--text-muted)">Aptitude: ${apt ? apt.totalScore + '/' + apt.maxScore + ' (' + Math.round(apt.totalScore/apt.maxScore*100) + '%)' : 'No test'} &middot; Self-Eval: ${(techOverallAvg(t)/5*100).toFixed(0)}%</div>
              </div>
            </div>`;

        Object.entries(aptSectionToSelfEval).forEach(([secKey, config]) => {
          const aptSec = apt ? apt.sections.find(s => s.label === secKey) : null;
          const aptPct = aptSec ? Math.round(aptSec.score / aptSec.total * 100) : 0;
          const selfAvg = config.sources.map(src => techCategoryAvg(t, src)).reduce((s,v)=>s+v,0)/config.sources.length;
          const selfPct = Math.round(selfAvg / 5 * 100);
          const gap = aptPct - selfPct;
          const gapColor = Math.abs(gap) <= 5 ? '#6B7280' : gap > 0 ? '#059669' : '#DC2626';

          compHtml += `
            <div class="comp-row">
              <div class="comp-label">${config.label}</div>
              <div class="comp-bars">
                <div class="comp-bar-row">
                  <div class="comp-bar-label">Test</div>
                  <div class="comp-bar"><div class="comp-bar-fill" style="width:${aptPct}%;background:${t.color}"></div></div>
                  <div class="comp-bar-val">${aptPct}%</div>
                </div>
                <div class="comp-bar-row">
                  <div class="comp-bar-label">Self</div>
                  <div class="comp-bar"><div class="comp-bar-fill" style="width:${selfPct}%;background:${t.color}66"></div></div>
                  <div class="comp-bar-val" style="color:var(--text-muted)">${selfPct}%</div>
                </div>
              </div>
              <div style="font-size:10px;font-weight:600;color:${gapColor};min-width:36px;text-align:right">${gap > 0 ? '+' : ''}${gap}%</div>
            </div>`;
        });
        compHtml += '</div>';
      });
      compHtml += '</div>';
      document.getElementById('comparisonGrid').innerHTML = compHtml;

      // ---- 6. COMPARISON CHART ----
      const compSections = Object.entries(aptSectionToSelfEval).map(([k,v]) => v.label);
      createChart('aptVsEstChart', {
        type: 'bar',
        data: {
          labels: techs.map(t => t.short),
          datasets: [
            {
              label: 'Aptitude Test %',
              data: techs.map(t => { const apt = aptitudeTests[t.short]; return apt ? Math.round(apt.totalScore/apt.maxScore*100) : 0; }),
              backgroundColor: '#2D6A6ABB',
              borderColor: '#2D6A6A',
              borderWidth: 1, borderRadius: 4, maxBarThickness: 36
            },
            {
              label: 'Self-Eval %',
              data: techs.map(t => Math.round(techOverallAvg(t)/5*100)),
              backgroundColor: '#C47F17BB',
              borderColor: '#C47F17',
              borderWidth: 1, borderRadius: 4, maxBarThickness: 36
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: true,
          scales: {
            y: { min: 0, max: 100, ticks: { stepSize: 20, font: { size: 11, family: "'JetBrains Mono'" }, callback: v => v + '%' }, grid: { color: '#EDEBE6' } },
            x: { ticks: { font: { size: 12, family: "'DM Sans'" } }, grid: { display: false } }
          },
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 12, family: "'DM Sans'" }, usePointStyle: true, padding: 14 } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}%` } }
          }
        }
      });
    }

    // ========== TECH PROFILES (with Manager Notes + ServiceTitan) ==========
    // ST Insights per tech
    // Google Reviews data (Last 90 days)
    const googleReviews = {
      "Dee": {
        count: 2,
        fiveStar: 2,
        threeStar: 0,
        highlight: '"I am truly thankful to meet Braybon, Ben, Adam, Jason, and Dee." — Bro B',
        note: "2 reviews in 90 days — both 5-star. Dee\'s warranty and cross-department role limits his customer-facing service calls, which explains the lower review count. Second review from Laura IV specifically mentions him as HVAC technician."
      },
      "Daniel": {
        count: 57,
        fiveStar: 55,
        threeStar: 2,
        highlight: '"Daniel is awesome. He is very reliable and an excellent worker. Give him a raise." — Cecile H',
        note: "Most-reviewed tech in the last 90 days with 57 total. 55 five-star, 2 three-star. Customers consistently praise friendliness, professionalism, and quality work. One 3-star noted cost concerns, another praised courtesy but had service reservations. Keywords: professional, thorough, friendly, knowledgeable, reliable, courteous."
      },
      "Chris": {
        count: 3,
        fiveStar: 3,
        threeStar: 0,
        highlight: '"Technician Chris Monahan was knowledgeable and professional and did a great job on our yearly inspection." — Penny Tapia',
        note: "3 reviews in 90 days — all 5-star. Low review count despite high opportunity volume. His reserved, introverted style may mean fewer customers are prompted to leave reviews. Recent mentions from Penny Tapia, Michael Sapinski, and Sean Allen — all praise professionalism and knowledge."
      },
      "Benji": {
        count: 3,
        fiveStar: 3,
        threeStar: 0,
        highlight: '"Thank you so much to Ben T. for coming out to tuneup my AC unit. He broke things down for me so I understood everything, showed me areas of concern, gave improvement suggestions and real actionable solutions." — Ren F',
        note: "3 HVAC reviews in 90 days — all 5-star (electrical mentions excluded per rule). Confirmed HVAC reviews from Ren F (Ben T.), Rana Drake (Ben Tinahui), and Chuck Cain (Benji HVAC). Customers highlight his ability to break things down and explain clearly."
      },
      "Dewone": {
        count: 46,
        fiveStar: 46,
        threeStar: 0,
        highlight: '"Dewone was excellent and satisfied all my A.C needs. Will make sure to request him next time." — Janice Zivitz',
        note: "46 reviews in 90 days — all perfect 5-star. Second-most reviewed tech but holds a flawless record. Customers consistently request him by name. Recurring themes: punctual, thorough, detailed explanations, friendly, efficient, knowledgeable. Multiple reviews call him \"the man\" and \"awesome.\""
      }
    };

    const stInsights = {
      "Dee": "Highest opportunity conversion rate on the team at 85%, indicating strong close ability when given the chance. Lower volume (13 opps, $6,416 revenue) reflects his warranty and flex role rather than a dedicated service route. Highest avg sale on Nexstar ($562) and highest tasks per opp (2.63), showing thoroughness on each call. Membership sales are an opportunity area at 0%.",
      "Daniel": "Solid revenue producer at $16,798 with the highest Nexstar average sale ($542) and strong 63% conversion rate. However, sales close rate is the lowest on the team at 22% with only $7,395 in total sales and 0.51 options per opp — indicating he may not be consistently presenting enough options. Leads only 5 leads set, lowest on the team. Has the most recalls (2), aligning with the focus development note.",
      "Chris": "Leads the team in total opportunities (72) and leads set (26), validating his strength in equipment-to-sales conversion. Highest lead average sale at $4,225 and strong total sales of $35,124. Conversion rate of 51% and close rate of 46% are mid-range but backed by high volume. Options per opp at 1.82 is second-best. Quiet demeanor does not appear to limit his sales output.",
      "Benji": "Highest total sales on the team at $37,480 with the highest individual average sale ($1,416), suggesting he handles higher-ticket repairs effectively. Conversion rate of 50% with 64 opps shows consistent workload. Lead generation is an area for growth at only 10 leads set (23% conv rate). Membership sales are low at 4%. Strong billable hours (124.65) with the best flat rate tasks per call (2.26).",
      "Dewone": "Team leader in revenue ($23,837), tech-generated leads (31), and conversion rate (80%). Highest membership close rate at 47% with 8 sold. Leads the team in rev/hr ($92) and options per opp (2.97), and is the only tech with zero recalls. These numbers reinforce his natural sales ability despite having the least technical experience on the team."
    };

    function renderProfiles() {
      let html = '';
      for (const t of techs) {
        // Find matching ST data
        const st = stData.find(s => s.name === t.short);

        const tierInfo = getTechTier(t);
        html += `
          <div class="tech-detail-card">
            <div class="tech-detail-header">
              ${techAvatars[t.short] ? `<img src="${techAvatars[t.short]}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:3px solid ${t.color}" alt="${t.name}">` : `<div class="tech-detail-avatar" style="background:${t.color}">${t.initials}</div>`}
              <div style="flex:1">
                <div class="tech-detail-name">${t.name}</div>
                <div class="tech-detail-meta">${t.position} — ${t.years} yrs experience</div>
              </div>
              <div style="text-align:center">
                ${tierBadgeHTML(tierInfo.tier)}
                <div class="tier-label">${tierInfo.tierLabel}</div>
              </div>
            </div>

            <div class="tier-section">
              <div class="tier-breakdown">
                <div class="tier-factor tier-factor-link" onclick="navigateToKpi('aptitude-skills','')" title="Go to Aptitude & Skills">Aptitude<br><span class="tier-factor-value">${tierInfo.aptScore}</span></div>
                <div class="tier-factor tier-factor-link" onclick="navigateToKpi('skills-tags','')" title="Go to Skills Tags">Skills<br><span class="tier-factor-value">${tierInfo.skillScore}</span></div>
                <div class="tier-factor tier-factor-link" onclick="navigateToKpi('scorecards','overview')" title="Go to ST Scorecards">ST Perf<br><span class="tier-factor-value">${tierInfo.stScore}</span></div>
                <div class="tier-factor tier-factor-link" onclick="navigateToKpi('scorecards','installs')" title="Go to ST Installs">Installs<br><span class="tier-factor-value">${tierInfo.installScore}</span></div>
                <div class="tier-factor tier-factor-link" onclick="navigateToKpi('manager','')" title="Go to Manager Hub">Mgr Score<br><span class="tier-factor-value">${tierInfo.mgrScore}</span></div>
                <div class="tier-factor tier-factor-link" onclick="navigateToKpi('scorecards','overview')" title="Go to Reviews">Reviews<br><span class="tier-factor-value">${tierInfo.reviewScore}</span></div>
                <div class="tier-factor" style="border-left:2px solid var(--border-subtle);padding-left:12px">Composite<br><span class="tier-factor-value" style="font-size:16px">${tierInfo.composite}</span></div>
              </div>
            </div>

            ${renderXPBar(t, '')}

            ${(typeof TECH_SCORE_PDFS !== 'undefined' && TECH_SCORE_PDFS[t.short]) ? `<button class="score-pdf-btn" onclick="downloadScorePDF('${t.short}')" title="Download Score Breakdown PDF"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg> Score Breakdown</button>` : ''}

            <div class="manager-notes" id="mgr-notes-${t.short}">
              <div class="manager-notes-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Manager Notes
                ${isManagerMode ? `<button class="mgr-notes-edit-btn" onclick="toggleMgrNoteEdit('${t.short}')" title="Edit notes">&#9998; Edit</button>` : ''}
              </div>
              <div class="mgr-notes-display" id="mgr-notes-display-${t.short}">
                <p>${getMgrNote(t.short, t.managerNotes)}</p>
              </div>
              <div class="mgr-notes-editor" id="mgr-notes-editor-${t.short}" style="display:none">
                <textarea class="mgr-notes-textarea" id="mgr-notes-ta-${t.short}" rows="4">${getMgrNote(t.short, t.managerNotes)}</textarea>
                <div class="mgr-notes-actions">
                  <button class="mgr-notes-save" onclick="saveMgrNote('${t.short}')">Save</button>
                  <button class="mgr-notes-cancel" onclick="cancelMgrNoteEdit('${t.short}')">Cancel</button>
                </div>
              </div>
              ${t.managerTags ? `<div style="margin-top:8px">${t.managerTags.map(tag =>
                `<span class="manager-tag tag-${tag.type}">${tag.label}</span>`
              ).join('')}</div>` : ''}
            </div>

            ${(() => {
              const apt = aptitudeTests[t.short];

              let out = '<div class="aptitude-section profile-section-link" onclick="navigateToKpi(\'aptitude-skills\',\'\')">'; 
              out += '<div class="aptitude-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg> Aptitude & Skills <span class="profile-section-arrow">&rarr;</span></div>';
              if (apt) {
                out += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">HVAC Aptitude Test \u2014 ' + apt.date + '</div>';
                out += '<div class="aptitude-grid">';
                apt.sections.forEach(s => {
                  const pct = Math.round((s.score / s.total) * 100);
                  const color = pct >= 90 ? '#059669' : pct >= 70 ? '#D97706' : '#DC2626';

                  out += '<div class="aptitude-card">';
                  out += '<div class="aptitude-card-label">' + s.label + '</div>';
                  out += '<div class="aptitude-card-score">' + s.score + '/' + s.total + '</div>';
                  out += '<div class="aptitude-card-pct" style="color:' + color + '">' + pct + '%</div>';
                  out += '<div class="aptitude-bar"><div class="aptitude-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
    
                  out += '</div>';
                });
                out += '</div>';
                out += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">';
                out += '<span style="font-size:12px;font-weight:700;color:#10b981">Total: ' + apt.totalScore + '/' + apt.maxScore + '</span>';
                out += '<span style="font-size:12px;color:#94a3b8">(' + Math.round((apt.totalScore/apt.maxScore)*100) + '%)</span>';
                out += '</div>';
                if (apt.certs.length) {
                  out += '<div class="aptitude-certs">' + apt.certs.map(c => '<span class="aptitude-cert">' + c + '</span>').join('') + '</div>';
                }
                out += '<div class="aptitude-interp">' + apt.interpretation + '</div>';
              }

              // Self-Evaluation Bars (comparison vs aptitude)
              const catKeys = Object.keys(categories);
              out += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(51, 65, 85, 0.3)">';
              out += '<div style="font-size:11px;font-weight:700;color:#10b981;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.04em">Self-Evaluation Breakdown <span class="profile-section-arrow" style="color:#10b981">&rarr;</span></div>';
              catKeys.forEach(catKey => {
                const cat = categories[catKey];
                const selfAvg = techCategoryAvg(t, catKey);
                const selfPct = Math.round((selfAvg / 5) * 100);
                const barColor = selfPct >= 80 ? '#059669' : selfPct >= 60 ? '#D97706' : '#DC2626';
                out += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
                out += '<div style="width:70px;font-size:11px;font-weight:500;color:#94a3b8;flex-shrink:0">' + cat.label + '</div>';
                out += '<div style="flex:1;height:7px;background:rgba(51, 65, 85, 0.4);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + selfPct + '%;background:' + barColor + ';border-radius:4px;transition:width 0.4s ease"></div></div>';
                out += '<div style="font-size:11px;font-family:JetBrains Mono,monospace;font-weight:600;color:' + barColor + ';min-width:32px;text-align:right">' + selfAvg.toFixed(1) + '</div>';
                out += '</div>';
              });
              out += '</div>';

              if (!apt) {
                out += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">No aptitude test on file</div>';
              }
              out += '</div>';
              return out;
            })()}

            ${(() => { const gr = googleReviews[t.short]; return gr ? `
            <div class="google-reviews profile-section-link" onclick="window.open('https://www.google.com/maps/place/Snappy+Services+-+Electric,+Plumbing,+Heating+%26+Air/@34.0072193,-84.5263963,17z/data=!4m8!3m7!1s0x88f514994f0e3935:0x22b134f3a8a78d1f!8m2!3d34.0072193!4d-84.5263963!9m1!1b1!16s%2Fg%2F1vd724vq','_blank')" title="Open Snappy Google Reviews">
              <div class="google-reviews-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                Google Reviews — Last 90 Days
                <span class="profile-section-arrow">↗</span>
              </div>
              <div class="review-stats">
                <div>
                  <div class="review-count">${gr.count}</div>
                  <div class="review-count-label">mentions</div>
                </div>
                <div class="review-stars">${'★'.repeat(5)}</div>
                <div style="font-size:12px;color:var(--text-secondary)">
                  ${gr.fiveStar} five-star${gr.threeStar ? `, ${gr.threeStar} three-star` : ''}
                </div>
              </div>
              <div class="review-highlight">${gr.highlight}</div>
              <div style="font-size:12px;color:#78560A;margin-top:8px;line-height:1.5">${gr.note}</div>
            </div>
            ` : ''; })()}

            ${st ? `
            <div class="st-profile profile-section-link" onclick="navigateToKpi('scorecards','overview')" title="Go to ST Scorecards">
              <div class="st-profile-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 9l-5 5-2-2-4 4"/></svg>
                ServiceTitan Performance — Last 90 Days
                <span class="profile-section-arrow">→</span>
              </div>
              <div class="st-metrics-grid">
                <div class="st-metric">
                  <div class="st-metric-value">$${st.nexstar.total_revenue.toLocaleString()}</div>
                  <div class="st-metric-label">Revenue</div>
                </div>
                <div class="st-metric">
                  <div class="st-metric-value">${st.nexstar.conversion_rate}%</div>
                  <div class="st-metric-label">Conversion</div>
                </div>
                <div class="st-metric">
                  <div class="st-metric-value">${st.nexstar.tech_gen_leads}</div>
                  <div class="st-metric-label">Leads Set</div>
                </div>
                <div class="st-metric">
                  <div class="st-metric-value">$${st.sales.total_sales.toLocaleString()}</div>
                  <div class="st-metric-label">Total Sales</div>
                </div>
                <div class="st-metric">
                  <div class="st-metric-value">${st.sales.close_rate}%</div>
                  <div class="st-metric-label">Close Rate</div>
                </div>
                <div class="st-metric">
                  <div class="st-metric-value">${st.productivity.options_per_opp}</div>
                  <div class="st-metric-label">Options/Opp</div>
                </div>
                <div class="st-metric">
                  <div class="st-metric-value">${st.memberships.total_mem_sold}/${st.memberships.total_mem_opps}</div>
                  <div class="st-metric-label">Mem Sold/Opps</div>
                </div>
                <div class="st-metric">
                  <div class="st-metric-value">${st.memberships.total_mem_pct}%</div>
                  <div class="st-metric-label">Mem Conv %</div>
                </div>
                <div class="st-metric">
                  <div class="st-metric-value">${st.installs.count}</div>
                  <div class="st-metric-label">Installs Sold (90d)</div>
                </div>
                <div class="st-metric">
                  <div class="st-metric-value">$${st.installs.total_revenue.toLocaleString()}</div>
                  <div class="st-metric-label">Install Rev (90d)</div>
                </div>
                <div class="st-metric">
                  <div class="st-metric-value">${st.mtd_installs || 0}</div>
                  <div class="st-metric-label">MTD Installs</div>
                </div>
              </div>
              <div class="st-insight">${stInsights[t.short] || ''}</div>
            </div>
            ` : ''}

            ${(() => {
              var rc = getRecallEntries(t.short);
              var cc = getComplaintEntries(t.short);
              if (rc.length === 0 && cc.length === 0) return '';
              var out = '<div class="rc-profile-section profile-section-link" onclick="navigateToKpi(\'dispatch\',\'\')">'; 
              out += '<div class="rc-profile-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Recalls & Complaints <span class="profile-section-arrow">&rarr;</span></div>';
              out += '<div class="rc-profile-grid">';
              if (rc.length > 0) {
                out += '<div class="rc-profile-col">';
                out += '<div class="rc-profile-col-header" style="color:#FF9800">Recalls <span class="rc-profile-count" style="background:rgba(255,152,0,0.12);color:#FF9800">' + rc.length + '</span></div>';
                rc.forEach(function(e) {
                  out += '<div class="rc-profile-entry"><span class="rc-profile-date">' + escHtml(e.date) + '</span><span class="rc-profile-job">Job #' + escHtml(e.jobNum) + '</span></div>';
                });
                out += '</div>';
              }
              if (cc.length > 0) {
                out += '<div class="rc-profile-col">';
                out += '<div class="rc-profile-col-header" style="color:#EF5350">Complaints <span class="rc-profile-count" style="background:rgba(239,83,80,0.12);color:#EF5350">' + cc.length + '</span></div>';
                cc.forEach(function(e) {
                  out += '<div class="rc-profile-entry"><span class="rc-profile-date">' + escHtml(e.date) + '</span><span class="rc-profile-job">Job #' + escHtml(e.jobNum) + '</span></div>';
                });
                out += '</div>';
              }
              out += '</div></div>';
              return out;
            })()}

            ${(() => {
              var bb = bbLoad();
              var oneOnOnes = (bb.oneOnOnes || []).filter(function(o) { return o.tech === t.short; })
                .slice().sort(function(a,b) { return (b.date||'').localeCompare(a.date||''); });
              var rideAlongs = (bb.rideAlongs || []).filter(function(r) { return r.tech === t.short; })
                .slice().sort(function(a,b) { return (b.date||'').localeCompare(a.date||''); });
              if (oneOnOnes.length === 0 && rideAlongs.length === 0) return '';
              var lastOO = oneOnOnes.length ? oneOnOnes[0].date : '\u2014';
              var lastRA = rideAlongs.length ? rideAlongs[0].date : '\u2014';
              var sectionId = 'coach-log-' + t.short;
              var out = '<div class="coach-log-section profile-section-link" onclick="navigateToKpi(\'overview\',\'\')">';
              out += '<div class="coach-log-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Coaching History <span class="profile-section-arrow">&rarr;</span></div>';
              out += '<div class="coach-log-summary">';
              out += '<div class="coach-log-pill oneonone"><span class="coach-log-pill-count">' + oneOnOnes.length + '</span><span class="coach-log-pill-label">1-on-1s</span><span class="coach-log-pill-last">last ' + escHtml(lastOO) + '</span></div>';
              out += '<div class="coach-log-pill ridealong"><span class="coach-log-pill-count">' + rideAlongs.length + '</span><span class="coach-log-pill-label">Ride-Alongs</span><span class="coach-log-pill-last">last ' + escHtml(lastRA) + '</span></div>';
              out += '<button class="coach-log-toggle" onclick="event.stopPropagation();var el=document.getElementById(\'' + sectionId + '\');if(el){el.classList.toggle(\'open\');this.textContent=el.classList.contains(\'open\')?\'Hide details\':\'Show details\';}">Show details</button>';
              out += '</div>';
              out += '<div class="coach-log-details" id="' + sectionId + '">';
              out += '<div class="coach-log-grid">';
              if (oneOnOnes.length > 0) {
                out += '<div class="coach-log-col">';
                out += '<div class="coach-log-col-header oneonone">\ud83e\udd1d 1-on-1s</div>';
                oneOnOnes.forEach(function(e) {
                  var statusClass = 'status-' + (e.status || 'planned');
                  out += '<div class="coach-log-entry">';
                  out += '<div class="coach-log-entry-top"><span class="coach-log-date">' + escHtml(e.date) + '</span><span class="coach-log-status ' + statusClass + '">' + escHtml(e.status || 'planned') + '</span></div>';
                  if (e.time) out += '<div class="coach-log-time">' + escHtml(e.time) + '</div>';
                  if (e.notes) out += '<div class="coach-log-notes">' + escHtml(e.notes) + '</div>';
                  out += '</div>';
                });
                out += '</div>';
              }
              if (rideAlongs.length > 0) {
                out += '<div class="coach-log-col">';
                out += '<div class="coach-log-col-header ridealong">\ud83d\ude90 Ride-Alongs</div>';
                rideAlongs.forEach(function(e) {
                  var statusClass = 'status-' + (e.status || 'planned');
                  out += '<div class="coach-log-entry">';
                  out += '<div class="coach-log-entry-top"><span class="coach-log-date">' + escHtml(e.date) + '</span><span class="coach-log-status ' + statusClass + '">' + escHtml(e.status || 'planned') + '</span></div>';
                  if (e.time) out += '<div class="coach-log-time">' + escHtml(e.time) + '</div>';
                  if (e.notes) out += '<div class="coach-log-notes">' + escHtml(e.notes) + '</div>';
                  out += '</div>';
                });
                out += '</div>';
              }
              out += '</div></div></div>';
              return out;
            })()}

            <div class="detail-section">
              <div class="detail-section-title">Self-Identified Strengths</div>
              <div>${t.strengths.map(s => `<span class="strength-tag">${s}</span>`).join('')}</div>
            </div>

            <div class="detail-section">
              <div class="detail-section-title">Self-Identified Weaknesses</div>
              <div>${t.weaknesses.map(w => `<span class="weakness-tag">${w}</span>`).join('')}</div>
            </div>

            <div class="profile-achievements" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
              <div style="font-size:12px;font-weight:700;color:var(--text-secondary);letter-spacing:0.05em;margin-bottom:8px;font-family:Orbitron,monospace">\uD83C\uDFC6 ACHIEVEMENTS</div>
              ${renderBadgeRow(getAchievements(t))}
            </div>

            ${t.growth ? `
            <div class="detail-section">
              <div class="detail-section-title">Growth Plan</div>
              <div class="detail-item">
                ${t.growth ? `<div><strong>Improve:</strong> ${t.growth}</div>` : ''}
                ${t.training ? `<div><strong>Training:</strong> ${t.training}</div>` : ''}
                ${t.holding_back ? `<div><strong>Holding back:</strong> ${t.holding_back}</div>` : ''}
              </div>
            </div>` : ''}
          </div>
        `;
      }
      // Adam Bunyard — Owner Benchmark
      const adamApt = aptitudeTests["Adam"];
      if (adamApt) {
        html += `
          <div class="tech-detail-card" style="border-top:3px solid #9CA3AF;opacity:0.85">
            <div class="tech-detail-header">
              <div class="tech-detail-avatar" style="background:#6B7280">AB</div>
              <div style="flex:1">
                <div class="tech-detail-name">Adam Bunyard</div>
                <div class="tech-detail-meta">Owner — Benchmark Reference</div>
              </div>
            </div>
            <div class="aptitude-section">
              <div class="aptitude-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg>
                HVAC Aptitude Test — ${adamApt.date}
              </div>
              <div class="aptitude-grid">
                ${adamApt.sections.map(s => {
                  const pct = Math.round((s.score / s.total) * 100);
                  const color = pct >= 90 ? '#059669' : pct >= 70 ? '#D97706' : '#DC2626';
                  return `<div class="aptitude-card">
                    <div class="aptitude-card-label">${s.label}</div>
                    <div class="aptitude-card-score">${s.score}/${s.total}</div>
                    <div class="aptitude-card-pct">${pct}%</div>
                    <div class="aptitude-bar"><div class="aptitude-bar-fill" style="width:${pct}%;background:${color}"></div></div>
                  </div>`;
                }).join('')}
              </div>
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
                <span style="font-size:12px;font-weight:700;color:#10b981">Total: ${adamApt.totalScore}/${adamApt.maxScore}</span>
                <span style="font-size:12px;color:#94a3b8">(${Math.round((adamApt.totalScore/adamApt.maxScore)*100)}%)</span>
              </div>
              <div class="aptitude-interp">${adamApt.interpretation}</div>
            </div>
          </div>
        `;
      }

      document.getElementById('profileGrid').innerHTML = html;
    }

    // ========== SERVICETITAN DATA ==========
    const stData = [
      {
        name: "Dewone",
        color: "#E07B3A",
        mtd_service_rev: 3959,
        mtd_installs: 0,
        mtd_on_job_pct: 53,
        mtd_nexstar: { total_revenue: 7061, avg_sale: 431, conversion_rate: 84, spps_sold: 3, tech_gen_leads: 8, sold_hours: 32.85, flat_rate_tasks: 1.81 },
        mtd_productivity: { rev_hr: 114, billable_hours: 32.85, sold_hrs_on_job_pct: 53, tasks_per_opp: 2.05, options_per_opp: 2.82, recalls: 0 },
        mtd_memberships: { total_mem_sold: 3, total_mem_opps: 4, total_mem_pct: 75 },
        mtd_sales: { close_rate: 84 },
        nexstar: { total_revenue: 25675, avg_sale: 440, conversion_rate: 79, spps_sold: 8, tech_gen_leads: 34, sold_hours: 138.55, tech_sold_hr_eff: 0, flat_rate_tasks: 1.84 },
        overview: { revenue: 25675, total_job_avg: 153, opp_job_avg: 351, opp_conversion: 79, opps: 71, converted_jobs: 56 },
        leads: { opps: 71, leads_set: 34, conv_rate: 48, avg_sale: 440 },
        memberships: { total_mem_sold: 8, total_mem_opps: 17, total_mem_pct: 47 },
        productivity: { rev_hr: 97, billable_hours: 138.55, sold_hrs_on_job_pct: 52, tasks_per_opp: 1.79, options_per_opp: 2.81, recalls: 0 },
        sales: { total_sales: 31760, avg_sale_s: 565, close_rate: 79, sales_opps: 68, options_per_opp_s: 2.81 },
        installs: { count: 3, total_revenue: 28781, avg_sale: 9594, leads_generated: 3, self_sourced: 3 }
      },
      {
        name: "Benji",
        color: "#5B4A8A",
        mtd_service_rev: 4859,
        mtd_installs: 0,
        mtd_on_job_pct: 57,
        mtd_nexstar: { total_revenue: 7625, avg_sale: 429, conversion_rate: 74, spps_sold: 2, tech_gen_leads: 1, sold_hours: 37.8, flat_rate_tasks: 2.01 },
        mtd_productivity: { rev_hr: 114, billable_hours: 37.8, sold_hrs_on_job_pct: 57, tasks_per_opp: 2.05, options_per_opp: 1.29, recalls: 1 },
        mtd_memberships: { total_mem_sold: 2, total_mem_opps: 8, total_mem_pct: 25 },
        mtd_sales: { close_rate: 74 },
        nexstar: { total_revenue: 18238, avg_sale: 445, conversion_rate: 56, spps_sold: 2, tech_gen_leads: 9, sold_hours: 130.65, tech_sold_hr_eff: 0.28, flat_rate_tasks: 2.17 },
        overview: { revenue: 18238, total_job_avg: 108, opp_job_avg: 260, opp_conversion: 56, opps: 66, converted_jobs: 37 },
        leads: { opps: 66, leads_set: 9, conv_rate: 14, avg_sale: 445 },
        memberships: { total_mem_sold: 2, total_mem_opps: 24, total_mem_pct: 8 },
        productivity: { rev_hr: 72, billable_hours: 130.65, sold_hrs_on_job_pct: 52, tasks_per_opp: 1.51, options_per_opp: 1.15, recalls: 1 },
        sales: { total_sales: 38776, avg_sale_s: 1362, close_rate: 45, sales_opps: 62, options_per_opp_s: 1.15 },
        installs: { count: 7, total_revenue: 68998, avg_sale: 9857, leads_generated: 2, self_sourced: 7 }
      },
      {
        name: "Daniel",
        color: "#C47F17",
        mtd_service_rev: 1913,
        mtd_installs: 0,
        mtd_on_job_pct: 25,
        mtd_nexstar: { total_revenue: 4707, avg_sale: 513, conversion_rate: 82, spps_sold: 0, tech_gen_leads: 1, sold_hours: 26.25, flat_rate_tasks: 1.78 },
        mtd_productivity: { rev_hr: 44, billable_hours: 26.25, sold_hrs_on_job_pct: 25, tasks_per_opp: 2.09, options_per_opp: 0.86, recalls: 1 },
        mtd_memberships: { total_mem_sold: 0, total_mem_opps: 2, total_mem_pct: 0 },
        mtd_sales: { close_rate: 82 },
        nexstar: { total_revenue: 19162, avg_sale: 547, conversion_rate: 64, spps_sold: 4, tech_gen_leads: 5, sold_hours: 120.75, tech_sold_hr_eff: 0, flat_rate_tasks: 2.03 },
        overview: { revenue: 19162, total_job_avg: 121, opp_job_avg: 355, opp_conversion: 64, opps: 53, converted_jobs: 34 },
        leads: { opps: 53, leads_set: 5, conv_rate: 9, avg_sale: 547 },
        memberships: { total_mem_sold: 4, total_mem_opps: 15, total_mem_pct: 27 },
        productivity: { rev_hr: 43, billable_hours: 120.75, sold_hrs_on_job_pct: 27, tasks_per_opp: 1.57, options_per_opp: 0.56, recalls: 2 },
        sales: { total_sales: 8761, avg_sale_s: 876, close_rate: 24, sales_opps: 41, options_per_opp_s: 0.56 },
        installs: { count: 1, total_revenue: 9926, avg_sale: 9926, leads_generated: 1, self_sourced: 1 }
      },
      {
        name: "Chris",
        color: "#8B3A3A",
        mtd_service_rev: 2511,
        mtd_installs: 0,
        mtd_on_job_pct: 53,
        mtd_nexstar: { total_revenue: 5390, avg_sale: 368, conversion_rate: 58, spps_sold: 4, tech_gen_leads: 5, sold_hours: 40.3, flat_rate_tasks: 1.86 },
        mtd_productivity: { rev_hr: 71, billable_hours: 40.3, sold_hrs_on_job_pct: 53, tasks_per_opp: 1.58, options_per_opp: 2.11, recalls: 1 },
        mtd_memberships: { total_mem_sold: 4, total_mem_opps: 7, total_mem_pct: 57 },
        mtd_sales: { close_rate: 58 },
        nexstar: { total_revenue: 15359, avg_sale: 360, conversion_rate: 55, spps_sold: 6, tech_gen_leads: 26, sold_hours: 127.67, tech_sold_hr_eff: 0, flat_rate_tasks: 1.91 },
        overview: { revenue: 15359, total_job_avg: 86, opp_job_avg: 203, opp_conversion: 55, opps: 73, converted_jobs: 40 },
        leads: { opps: 73, leads_set: 26, conv_rate: 36, avg_sale: 360 },
        memberships: { total_mem_sold: 6, total_mem_opps: 19, total_mem_pct: 32 },
        productivity: { rev_hr: 51, billable_hours: 127.67, sold_hrs_on_job_pct: 42, tasks_per_opp: 1.45, options_per_opp: 1.9, recalls: 1 },
        sales: { total_sales: 38480, avg_sale_s: 924, close_rate: 50, sales_opps: 78, options_per_opp_s: 1.9 },
        installs: { count: 12, total_revenue: 151465, avg_sale: 12622, leads_generated: 12, self_sourced: 12 }
      },
      {
        name: "Dee",
        color: "#2D6A6A",
        mtd_service_rev: 0,
        mtd_installs: 0,
        mtd_on_job_pct: 42,
        mtd_nexstar: { total_revenue: 1261, avg_sale: 630, conversion_rate: 100, spps_sold: 0, tech_gen_leads: 1, sold_hours: 19.4, flat_rate_tasks: 4.5 },
        mtd_productivity: { rev_hr: 27, billable_hours: 19.4, sold_hrs_on_job_pct: 42, tasks_per_opp: 5.5, options_per_opp: 2, recalls: 0 },
        mtd_memberships: { total_mem_sold: 0, total_mem_opps: 0, total_mem_pct: 0 },
        mtd_sales: { close_rate: 100 },
        isWarrantyTech: true,
        completedJobs: 113,
        nexstar: { total_revenue: 6416, avg_sale: 562, conversion_rate: 85, spps_sold: 0, tech_gen_leads: 3, sold_hours: 87.35, tech_sold_hr_eff: 0, flat_rate_tasks: 2.65 },
        overview: { revenue: 6416, total_job_avg: 57, opp_job_avg: 475, opp_conversion: 85, opps: 13, converted_jobs: 11 },
        leads: { opps: 13, leads_set: 3, conv_rate: 23, avg_sale: 562 },
        memberships: { total_mem_sold: 0, total_mem_opps: 8, total_mem_pct: 0 },
        productivity: { rev_hr: 24, billable_hours: 87.35, sold_hrs_on_job_pct: 32, tasks_per_opp: 2.63, options_per_opp: 0.75, recalls: 1 },
        sales: { total_sales: 1233, avg_sale_s: 411, close_rate: 38, sales_opps: 8, options_per_opp_s: 0.75 },
        installs: { count: 1, total_revenue: 13410, avg_sale: 13410, leads_generated: 1, self_sourced: 0 }
      }
    ];

    // SK Sub-tab navigation
    document.querySelectorAll('#sk-sub-tabs .nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#sk-sub-tabs .nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sk-section').forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('sk-' + tab.dataset.sk).classList.add('active');
      });
    });

    // ========== RENDER SKILLS TAGS ==========
    function renderSkillsTags() {
      const techNames = Object.keys(skillsData.assignments);
      const catKeys = Object.keys(skillsData.categories);

      // Helper: get all skills as flat array
      function allSkills() {
        const arr = [];
        catKeys.forEach(k => skillsData.categories[k].skills.forEach(s => arr.push({...s, cat: k})));
        return arr;
      }

      // Helper: find level for a count
      function levelForCount(count) {
        let result = null;
        Object.entries(skillsData.levels).forEach(([name, lvl]) => {
          if (count >= lvl.min && count <= lvl.max) result = name;
        });
        if (!result && count > 45) result = 'S-Tier';
        if (!result && count < 5) result = 'Rookie';
        return result || '—';
      }

      // Helper: next level for a count
      function nextLevelForCount(count) {
        const entries = Object.entries(skillsData.levels);
        for (let i = 0; i < entries.length; i++) {
          if (count < entries[i][1].min) return { name: entries[i][0], min: entries[i][1].min };
        }
        return null;
      }

      // ---- KPI Row ----
      const allAssignments = Object.values(skillsData.assignments);
      const totalSkills = allSkills().length;
      const totalCats = catKeys.length;
      const avgSkills = (allAssignments.reduce((s, arr) => s + arr.length, 0) / techNames.length).toFixed(1);
      const mostTagged = techNames.reduce((a, b) => skillsData.assignments[a].length >= skillsData.assignments[b].length ? a : b);
      const leastTagged = techNames.reduce((a, b) => skillsData.assignments[a].length <= skillsData.assignments[b].length ? a : b);

      document.getElementById('sk-kpi-row').innerHTML = [
        { label: 'Total Skills in System', value: totalSkills, sub: '48-skill framework' },
        { label: 'Categories', value: totalCats, sub: 'A through H' },
        { label: 'Team Avg Skills', value: avgSkills, sub: 'per technician' },
        { label: 'Most Tagged', value: mostTagged, sub: skillsData.assignments[mostTagged].length + ' skills' },
        { label: 'Least Tagged', value: leastTagged, sub: skillsData.assignments[leastTagged].length + ' skills' }
      ].map(k => `<div class="kpi-card"><div class="kpi-value">${k.value}</div><div class="kpi-label">${k.label}</div><div class="kpi-sub">${k.sub}</div></div>`).join('');

      // ---- Overview Matrix ----
      const techs = techNames;
      let matHtml = '<thead><tr><th>Skill</th>';
      techs.forEach(t => {
        matHtml += `<th><div class="sm-tech-head"><div class="sm-tech-avatar">${t[0]}</div><span style="font-size:11px;font-weight:600;margin-top:2px">${t}</span></div></th>`;
      });
      matHtml += '</tr></thead><tbody>';

      catKeys.forEach(catKey => {
        const cat = skillsData.categories[catKey];
        matHtml += `<tr class="sm-cat-row"><td style="border-left:3px solid ${cat.color};padding-left:10px">${catKey} — ${cat.name}</td>${techs.map(() => `<td></td>`).join('')}</tr>`;
        cat.skills.forEach(skill => {
          matHtml += `<tr><td><div class="sm-skill-name"><span class="sm-id">${skill.id}</span><span>${skill.name}</span>${isSkillNew(skill) ? '<span class="sk-new-badge">NEW</span>' : ''}</div></td>`;
          techs.forEach(tech => {
            const has = skillsData.assignments[tech].includes(skill.id);
            matHtml += `<td><span class="${has ? 'sm-check-yes' : 'sm-check-no'}" data-skill-toggle="${tech}-${skill.id}" onclick="toggleSkill('${tech}','${skill.id}')" title="${has ? 'Remove' : 'Add'} ${skill.id} — ${skill.name} ${has ? 'from' : 'to'} ${tech}">${has ? '✓' : '·'}</span></td>`;
          });
          matHtml += '</tr>';
        });
      });

      // Summary row
      matHtml += '<tr class="sm-total-row"><td>Total Skills</td>';
      techs.forEach(tech => {
        matHtml += `<td style="font-family:'JetBrains Mono',monospace;font-size:15px;color:var(--accent-teal)">${skillsData.assignments[tech].length}</td>`;
      });
      matHtml += '</tr></tbody>';
      document.getElementById('skMatrixTable').innerHTML = matHtml;

      // ---- By Category ----
      let catHtml = '';
      catKeys.forEach((catKey, idx) => {
        const cat = skillsData.categories[catKey];
        const totalInCat = cat.skills.length;
        catHtml += `
          <div class="sk-cat-card" id="skCat${catKey}">
            <div class="sk-cat-header" onclick="this.parentElement.classList.toggle('collapsed')">
              <div class="sk-cat-letter" style="background:${cat.color}">${catKey}</div>
              <div class="sk-cat-title">${cat.name}</div>
              <div class="sk-cat-meta">${totalInCat} skills</div>
              <div class="sk-cat-toggle">▼</div>
            </div>
            <div class="sk-cat-body">`;
        cat.skills.forEach(skill => {
          const assignedTechs = techs.filter(t => skillsData.assignments[t].includes(skill.id));
          const unassignedTechs = techs.filter(t => !skillsData.assignments[t].includes(skill.id));
          catHtml += `
              <div class="sk-skill-row" style="${assignedTechs.length === 0 ? 'opacity:0.55' : ''}">
                <div class="sk-skill-info">
                  <div class="sk-skill-name-row">
                    <span class="sk-skill-id">${skill.id}</span>
                    <span class="sk-skill-label">${skill.name}</span>
                    ${isSkillNew(skill) ? '<span class="sk-new-badge">NEW</span>' : ''}
                    ${skill.nextech ? `<span class="sk-nextech-tag">${skill.nextech}</span>` : ''}
                  </div>
                  <div class="sk-skill-desc">${skill.desc}</div>
                </div>
                <div class="sk-tech-dots">
                  ${assignedTechs.map(t => `<span class="sk-tech-dot assigned" style="background:${cat.color}">${t[0]}<span style="font-size:9px;opacity:0.85">${t.slice(1,3)}</span></span>`).join('')}
                  ${unassignedTechs.map(t => `<span class="sk-tech-dot unassigned">${t[0]}</span>`).join('')}
                </div>
              </div>`;
        });
        catHtml += `</div></div>`;
      });
      document.getElementById('skCategoryCards').innerHTML = catHtml;

      // ---- By Technician ----
      const techColors = { 'Chris': '#2D6A6A', 'Dewone': '#C47F17', 'Benji': '#5B4A8A', 'Daniel': '#3A7A4A', 'Dee': '#8B3A3A' };
      let techHtml = '';
      techs.forEach(tech => {
        const assigned = skillsData.assignments[tech];
        const count = assigned.length;
        const level = levelForCount(count);
        const nextLvl = nextLevelForCount(count);
        const pct = nextLvl ? Math.min(100, Math.round((count / nextLvl.min) * 100)) : 100;
        const color = techColors[tech] || 'var(--accent-teal)';
        const priorities = skillsData.devPriorities[tech];

        // Category breakdown
        const catCounts = {};
        catKeys.forEach(k => { catCounts[k] = skillsData.categories[k].skills.filter(s => assigned.includes(s.id)).length; });
        const totalAssigned = Object.values(catCounts).reduce((a,b) => a+b, 0);

        const barSegs = catKeys.map(k => {
          const w = totalAssigned > 0 ? (catCounts[k] / totalAssigned * 100).toFixed(1) : 0;
          return `<div class="sk-cat-bar-seg" style="width:${w}%;background:${skillsData.categories[k].color}"></div>`;
        }).join('');

        const legendItems = catKeys.filter(k => catCounts[k] > 0).map(k =>
          `<span class="sk-cat-legend-item"><span class="sk-cat-dot" style="background:${skillsData.categories[k].color}"></span>${k}: ${catCounts[k]}</span>`
        ).join('');

        // Skill chips grouped by category
        const chipsByGroup = catKeys.map(k => {
          const catSkills = skillsData.categories[k].skills.filter(s => assigned.includes(s.id));
          if (!catSkills.length) return '';
          return catSkills.map(s => `<span class="sk-chip" style="background:${skillsData.categories[k].color}" title="${s.name}">${s.id}</span>`).join('');
        }).join('');

        techHtml += `
          <div class="sk-tech-card">
            <div class="sk-tech-card-header">
              <div class="sk-tech-avatar-lg" style="background:${color}">${tech[0]}</div>
              <div class="sk-tech-info">
                <div class="sk-tech-name">${tech}</div>
                <div class="sk-tech-sub">Skill Level: ${level}</div>
              </div>
              <div style="text-align:center">
                <div class="sk-tech-count">${count}</div>
                <div class="sk-tech-count-label">skills tagged</div>
              </div>
            </div>
            <div class="sk-tech-body">
              <div class="sk-progress-wrap">
                <div class="sk-progress-label">
                  <span>Progress to ${nextLvl ? nextLvl.name : 'S-Tier'}</span>
                  <span>${count} / ${nextLvl ? nextLvl.min : 48} skills</span>
                </div>
                <div class="sk-progress-bar">
                  <div class="sk-progress-fill" style="width:${pct}%;background:${color}"></div>
                </div>
              </div>
              <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:5px">Assigned Skills</div>
              <div class="sk-chip-grid">${chipsByGroup}</div>
              <div class="sk-cat-bar-row">${barSegs}</div>
              <div class="sk-cat-legend">${legendItems}</div>
              ${priorities ? `
              <div class="sk-dev-priorities">
                <div class="sk-dev-title">Development Focus</div>
                <div class="sk-dev-text">${priorities.action}</div>
                <div class="sk-next-chips">${priorities.next.map(id => `<span class="sk-next-chip">${id}</span>`).join('')}</div>
              </div>` : ''}
            </div>
          </div>`;
      });
      document.getElementById('skTechCards').innerHTML = techHtml;

      // ---- NexTech Alignment ----
      const nextechColors = { 'Level 1': '#3A7A9A', 'Level 2': '#5B8A4A', 'Level 3': '#7A5A2A', 'Level 4': '#6A2A6A' };
      let nextechHtml = '';
      Object.entries(skillsData.nextechLevels).forEach(([levelKey, level]) => {
        const color = nextechColors[levelKey] || '#2D6A6A';
        // Who has completed-ish this level (rough: check if they have most of the skills)
        const levelSkillIds = level.skills.map(s => s.split(' ')[0]);
        const techsAtLevel = techs.filter(tech => {
          const matched = levelSkillIds.filter(id => skillsData.assignments[tech].includes(id));
          return matched.length >= Math.ceil(levelSkillIds.length * 0.5);
        });

        nextechHtml += `
          <div class="sk-nextech-card">
            <div class="sk-nextech-head" style="background:${color}">
              <div class="sk-nextech-level-num">${levelKey}</div>
              <div class="sk-nextech-title">${level.title}</div>
              <div class="sk-nextech-months">${level.months}</div>
            </div>
            <div class="sk-nextech-body">
              <div class="sk-nextech-outcome">Outcome: ${level.outcome}</div>
              <div class="sk-nextech-skills-label">Skills Covered</div>
              <div class="sk-chip-grid">
                ${level.skills.map(s => {
                  const id = s.split(' ')[0];
                  const catKey = id[0];
                  const catColor = skillsData.categories[catKey] ? skillsData.categories[catKey].color : '#666';
                  return `<span class="sk-chip" style="background:${catColor}" title="${s}">${s}</span>`;
                }).join('')}
              </div>
              <div class="sk-nextech-who">
                <div class="sk-nextech-who-label">Techs with 50%+ skills</div>
                <div class="sk-who-pills">
                  ${techsAtLevel.length > 0
                    ? techsAtLevel.map(t => `<span class="sk-who-pill" style="background:${techColors[t]}">${t}</span>`).join('')
                    : '<span style="font-size:11px;color:var(--text-muted)">None yet</span>'}
                </div>
              </div>
            </div>
          </div>`;
      });
      document.getElementById('skNextechCards').innerHTML = nextechHtml;

      // ---- Per-Tech NexTech Breakdown (Interactive) ----
      const nextechLevelSkillMap = {
        'Level 1': ['A11','A3','A7','G2'],
        'Level 2': ['A9','A3','B4','C5','E4','G3','D3'],
        'Level 3': ['F3','D3','G2','A5','A7','H1','H2','H3','H4','H5','D5','C1','D2','D4','A2','A4','E1','E2'],
        'Level 4': ['A6','C6','C2','B6','C7','H6','A11','B7','B8','B5','B9','A8','A10','A1','B3','D1']
      };
      const nextechLevelDescriptions = {
        'Level 1': 'Can safely use tools and meters, test/replace motors and capacitors, understand duct types and airflow, handle refrigerant tools, and present professionally.',
        'Level 2': 'Can perform combustion analysis, diagnose IAQ issues, install/repair gas furnaces, repair ductwork, communicate with customers, and follow SOPs.',
        'Level 3': 'Executes all Nexstar Service System steps (Greet through Wrap Up), presents options, completes Summary of Findings, brazes copper, handles refrigerant, replaces coils, and performs changeouts.',
        'Level 4': 'Troubleshoots advanced electrical, control boards, igniters, gas valves, heat exchangers, zoning, compressors, and refrigerant. Closes Service Partner Plans, handles pushbacks, and manages challenging situations.'
      };

      let breakdownHtml = '';
      techs.forEach((tech, techIdx) => {
        const techSkills = skillsData.assignments[tech] || [];
        const color = techColors[tech] || '#2D6A6A';

        // Calculate overall NexTech readiness
        let totalSkillsNeeded = 0;
        let totalSkillsHave = 0;
        Object.values(nextechLevelSkillMap).forEach(skills => {
          const unique = [...new Set(skills)];
          totalSkillsNeeded += unique.length;
          totalSkillsHave += unique.filter(s => techSkills.includes(s)).length;
        });
        const overallPct = Math.round((totalSkillsHave / totalSkillsNeeded) * 100);

        breakdownHtml += `
          <div class="ntb-card" onclick="this.classList.toggle('ntb-open')">
            <div class="ntb-header">
              <div class="ntb-avatar" style="background:${color}">${tech[0]}</div>
              <div class="ntb-info">
                <div class="ntb-name">${tech}</div>
                <div class="ntb-summary">${techSkills.length} skills assigned · ${overallPct}% NexTech coverage</div>
              </div>
              <div class="ntb-overall-bar-wrap">
                <div class="ntb-overall-bar" style="width:${overallPct}%;background:${overallPct >= 75 ? 'var(--accent-green)' : overallPct >= 50 ? 'var(--accent-gold)' : 'var(--accent-red)'}"></div>
              </div>
              <div class="ntb-overall-pct">${overallPct}%</div>
              <div class="ntb-chevron">▼</div>
            </div>
            <div class="ntb-body">`;

        // Per-level breakdown
        Object.entries(nextechLevelSkillMap).forEach(([levelName, levelSkills]) => {
          const unique = [...new Set(levelSkills)];
          const has = unique.filter(s => techSkills.includes(s));
          const missing = unique.filter(s => !techSkills.includes(s));
          const pct = Math.round((has.length / unique.length) * 100);
          const lvlColor = nextechColors[levelName] || '#2D6A6A';
          const statusLabel = pct === 100 ? 'Complete' : pct >= 75 ? 'Near-Complete' : pct >= 50 ? 'In Progress' : pct > 0 ? 'Gaps' : 'Not Started';
          const statusColor = pct === 100 ? 'var(--accent-green)' : pct >= 75 ? '#3A9A5A' : pct >= 50 ? 'var(--accent-gold)' : pct > 0 ? 'var(--accent-red)' : '#666';

          breakdownHtml += `
              <div class="ntb-level">
                <div class="ntb-level-head">
                  <span class="ntb-level-badge" style="background:${lvlColor}">${levelName}</span>
                  <span class="ntb-level-title">${skillsData.nextechLevels[levelName].title}</span>
                  <span class="ntb-level-status" style="color:${statusColor}">${statusLabel}</span>
                  <span class="ntb-level-frac">${has.length}/${unique.length}</span>
                </div>
                <div class="ntb-level-bar-wrap">
                  <div class="ntb-level-bar" style="width:${pct}%;background:${lvlColor}"></div>
                </div>
                <div class="ntb-level-desc">${nextechLevelDescriptions[levelName]}</div>`;

          if (has.length > 0) {
            breakdownHtml += `
                <div class="ntb-skill-section">
                  <div class="ntb-skill-label ntb-earned">✓ Earned (${has.length})</div>
                  <div class="ntb-chip-grid">${has.map(s => {
                    const catKey = s[0];
                    const catColor = skillsData.categories[catKey] ? skillsData.categories[catKey].color : '#666';
                    const skillObj = allSkills().find(sk => sk.id === s);
                    const name = skillObj ? skillObj.name : s;
                    return `<span class="ntb-chip ntb-earned-chip ntb-clickable" style="border-color:${catColor}" title="Click to remove ${s} — ${name} from ${tech}" onclick="event.stopPropagation();toggleSkill('${tech}','${s}')"><span class="ntb-chip-id">${s}</span>${name}<span class="ntb-chip-action ntb-chip-remove">✕</span></span>`;
                  }).join('')}</div>
                </div>`;
          }

          if (missing.length > 0) {
            breakdownHtml += `
                <div class="ntb-skill-section">
                  <div class="ntb-skill-label ntb-needed">✗ Needed (${missing.length})</div>
                  <div class="ntb-chip-grid">${missing.map(s => {
                    const catKey = s[0];
                    const catColor = skillsData.categories[catKey] ? skillsData.categories[catKey].color : '#666';
                    const skillObj = allSkills().find(sk => sk.id === s);
                    const name = skillObj ? skillObj.name : s;
                    return `<span class="ntb-chip ntb-needed-chip ntb-clickable" style="border-color:${catColor}" title="Click to add ${s} — ${name} to ${tech}" onclick="event.stopPropagation();toggleSkill('${tech}','${s}')"><span class="ntb-chip-id">${s}</span>${name}<span class="ntb-chip-action ntb-chip-add">+</span></span>`;
                  }).join('')}</div>
                </div>`;
          }

          breakdownHtml += `</div>`; // close ntb-level
        });

        breakdownHtml += `
            </div>
          </div>`; // close ntb-body + ntb-card
      });
      document.getElementById('skNextechBreakdown').innerHTML = breakdownHtml;

      // ---- Progression Ladder ----
      // Determine where each tech sits
      function getTechLevel(tech) {
        const count = skillsData.assignments[tech].length;
        const entries = Object.entries(skillsData.levels);
        let current = null;
        entries.forEach(([name, lvl]) => {
          if (count >= lvl.min) current = name;
        });
        return current || 'Pre-C';
      }

      const tierLevelColors = {
        'C-1': '#9A9A9A', 'C-2': '#8A8A8A', 'C-3': '#7A7A7A',
        'B-Entry': '#3A7A9A', 'B-2': '#2D6A8A',
        'A-1': '#5B8A4A', 'A-2': '#4A7A3A', 'A-3': '#3A6A2A', 'A-4': '#2A5A1A',
        'S-Tier': '#C47F17'
      };

      let ladderHtml = '';
      const levelKeys = Object.keys(skillsData.levels).reverse();
      levelKeys.forEach((levelName, idx) => {
        const lvl = skillsData.levels[levelName];
        const techsHere = techs.filter(t => getTechLevel(t) === levelName);
        const hasTech = techsHere.length > 0;
        const isCrossing = Object.keys(skillsData.tierCrossings).some(k => {
          const crossing = skillsData.tierCrossings[k];
          return Math.abs(crossing.minSkills - lvl.min) <= 1;
        });
        const color = tierLevelColors[levelName] || '#666';

        ladderHtml += `
          <div class="sk-ladder-level ${hasTech ? 'has-tech' : ''} ${isCrossing ? 'is-crossing' : ''}">
            <div class="sk-ladder-head">
              <span class="sk-ladder-tier" style="color:${color}">${levelName}</span>
              <span class="sk-ladder-range">${lvl.min}–${lvl.max} skills</span>
              <span class="sk-ladder-composite">Composite: ${lvl.composite}</span>
            </div>
            ${hasTech ? `<div class="sk-ladder-techs">${techsHere.map(t => `<span class="sk-ladder-tech-pill" style="background:${techColors[t]};color:#fff">${t} (${skillsData.assignments[t].length})</span>`).join('')}</div>` : ''}
          </div>`;
      });
      document.getElementById('skLadder').innerHTML = ladderHtml;

      // ---- Tier Crossings ----
      let crossHtml = '';
      Object.entries(skillsData.tierCrossings).forEach(([name, crossing]) => {
        const techsReady = techs.filter(t => skillsData.assignments[t].length >= crossing.minSkills);
        const techsClose = techs.filter(t => {
          const c = skillsData.assignments[t].length;
          return c < crossing.minSkills && c >= crossing.minSkills - 5;
        });
        crossHtml += `
          <div class="sk-ladder-level is-crossing" style="margin-bottom:20px">
            <div class="sk-ladder-head">
              <span class="sk-ladder-tier" style="color:var(--accent-gold);font-size:15px">${name} Crossing</span>
              <span class="sk-ladder-composite">${crossing.minSkills}+ skills required</span>
            </div>
            <div class="sk-crossing-reqs" style="margin-top:8px">
              <div class="sk-crossing-title">Must-Have Skills</div>
              <div class="sk-crossing-list">
                ${crossing.mustHave.map(req => `<span class="sk-crossing-item">${req}</span>`).join('')}
              </div>
            </div>
            ${techsReady.length > 0 ? `
              <div style="margin-top:10px">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent-green);margin-bottom:5px">Skill Count Met</div>
                <div class="sk-ladder-techs">${techsReady.map(t => `<span class="sk-ladder-tech-pill" style="background:${techColors[t]};color:#fff">${t}</span>`).join('')}</div>
              </div>` : ''}
            ${techsClose.length > 0 ? `
              <div style="margin-top:8px">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent-gold);margin-bottom:5px">Within 5 Skills</div>
                <div class="sk-ladder-techs">${techsClose.map(t => `<span class="sk-ladder-tech-pill" style="background:${techColors[t]};color:#fff">${t} (${skillsData.assignments[t].length}/${crossing.minSkills})</span>`).join('')}</div>
              </div>` : ''}
          </div>`;
      });
      document.getElementById('skCrossings').innerHTML = crossHtml;
    }

    // ST Sub-tab navigation
    document.querySelectorAll('#st-sub-tabs .nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#st-sub-tabs .nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.st-section').forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('st-' + tab.dataset.st).classList.add('active');
      });
    });

    function fmt$(v) { return '$' + v.toLocaleString(); }
    function fmtPct(v) { return v + '%'; }

    function renderSTKPIs() {
      const totalRev = stData.reduce((s,t) => s + t.nexstar.total_revenue, 0);
      const avgConv = (stData.reduce((s,t) => s + t.nexstar.conversion_rate, 0) / stData.length).toFixed(0);
      const totalLeads = stData.reduce((s,t) => s + t.nexstar.tech_gen_leads, 0);
      const totalSales = stData.reduce((s,t) => s + t.sales.total_sales, 0);
      const totalInstalls = stData.reduce((s,t) => s + t.installs.count, 0);
      const totalInstallRev = stData.reduce((s,t) => s + t.installs.total_revenue, 0);
      const totalMtdInst = 5; // Team MTD installs incl. Adam
      const totalMtdInstRev = 63246;
      const topRev = stData.reduce((best, t) => t.nexstar.total_revenue > best.nexstar.total_revenue ? t : best);

      document.getElementById('st-kpi-row').innerHTML = `
        <div class="kpi-card">
          <div class="kpi-label">Team Revenue</div>
          <div class="kpi-value" style="color:var(--accent-teal)">${fmt$(totalRev)}</div>
          <div class="kpi-sub">Last 90 days</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Avg Conversion</div>
          <div class="kpi-value">${avgConv}<span style="font-size:14px;color:var(--text-muted);font-weight:400">%</span></div>
          <div class="kpi-sub">Opportunity to close</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Tech-Gen Leads</div>
          <div class="kpi-value">${totalLeads}</div>
          <div class="kpi-sub">Combined lead generation</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Sales</div>
          <div class="kpi-value" style="color:var(--accent-green)">${fmt$(totalSales)}</div>
          <div class="kpi-sub">All technicians combined</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">MTD Installs</div>
          <div class="kpi-value">${totalMtdInst}</div>
          <div class="kpi-sub">${fmt$(totalMtdInstRev)} install revenue</div>
        </div>
      `;
    }

    function buildSTTable(id, cols) {
      let html = '<thead><tr>';
      html += '<th style="min-width:100px">Technician</th>';
      cols.forEach(c => html += `<th style="text-align:center">${c.label}</th>`);
      html += '</tr></thead><tbody>';
      stData.forEach(t => {
        html += `<tr><td style="font-weight:600">${t.name}</td>`;
        cols.forEach(c => {
          const val = c.get(t);
          const display = c.fmt ? c.fmt(val) : val;
          html += `<td class="score-cell"><span class="avg-pill">${display}</span></td>`;
        });
        html += '</tr>';
      });
      html += '</tbody>';
      document.getElementById(id).innerHTML = html;
    }

    function renderSTTables() {
      buildSTTable('stNexstarTable', [
        { label: 'Total Revenue', get: t => t.nexstar.total_revenue, fmt: fmt$ },
        { label: 'Avg Sale', get: t => t.nexstar.avg_sale, fmt: fmt$ },
        { label: 'Conversion %', get: t => t.nexstar.conversion_rate, fmt: fmtPct },
        { label: 'SPPs Sold', get: t => t.nexstar.spps_sold },
        { label: 'Tech-Gen Leads', get: t => t.nexstar.tech_gen_leads },
        { label: 'Sold Hours', get: t => t.nexstar.sold_hours },
        { label: 'Flat Rate Tasks', get: t => t.nexstar.flat_rate_tasks }
      ]);

      buildSTTable('stOverviewTable', [
        { label: 'Revenue', get: t => t.overview.revenue, fmt: fmt$ },
        { label: 'Total Job Avg', get: t => t.overview.total_job_avg, fmt: fmt$ },
        { label: 'Opp Job Avg', get: t => t.overview.opp_job_avg, fmt: fmt$ },
        { label: 'Opp Conversion', get: t => t.overview.opp_conversion, fmt: fmtPct },
        { label: '# Opps', get: t => t.overview.opps },
        { label: 'Converted Jobs', get: t => t.overview.converted_jobs }
      ]);

      buildSTTable('stLeadsTable', [
        { label: '# Opps', get: t => t.leads.opps },
        { label: 'Leads Set', get: t => t.leads.leads_set },
        { label: 'Conv Rate', get: t => t.leads.conv_rate, fmt: fmtPct },
        { label: 'Avg Sale', get: t => t.leads.avg_sale, fmt: fmt$ }
      ]);

      buildSTTable('stMembershipsTable', [
        { label: 'Memberships Sold', get: t => t.memberships.total_mem_sold },
        { label: 'Membership Opps', get: t => t.memberships.total_mem_opps },
        { label: 'Membership %', get: t => t.memberships.total_mem_pct, fmt: fmtPct }
      ]);

      buildSTTable('stProductivityTable', [
        { label: 'Rev/Hr', get: t => t.productivity.rev_hr, fmt: fmt$ },
        { label: 'Billable Hours', get: t => t.productivity.billable_hours },
        { label: 'Sold Hrs On-Job %', get: t => t.productivity.sold_hrs_on_job_pct, fmt: fmtPct },
        { label: 'Tasks/Opp', get: t => t.productivity.tasks_per_opp },
        { label: 'Options/Opp', get: t => t.productivity.options_per_opp },
        { label: 'Recalls', get: t => t.productivity.recalls }
      ]);

      buildSTTable('stSalesTable', [
        { label: 'Total Sales', get: t => t.sales.total_sales, fmt: fmt$ },
        { label: 'Avg Sale', get: t => t.sales.avg_sale_s, fmt: fmt$ },
        { label: 'Close Rate', get: t => t.sales.close_rate, fmt: fmtPct },
        { label: 'Sales Opps', get: t => t.sales.sales_opps },
        { label: 'Options/Opp', get: t => t.sales.options_per_opp_s }
      ]);

      buildSTTable('stInstallsTable', [
        { label: 'MTD Installs', get: t => t.mtd_installs || 0 },
        { label: 'Installs Sold (90d)', get: t => t.installs.count },
        { label: 'Install Revenue (90d)', get: t => t.installs.total_revenue, fmt: fmt$ },
        { label: 'Avg Install Sale', get: t => t.installs.avg_sale, fmt: fmt$ },
        { label: 'Leads Generated', get: t => t.installs.leads_generated },
        { label: 'Self-Sourced', get: t => t.installs.self_sourced }
      ]);
    }

    function renderSTCharts() {
      // Revenue bar chart
      createChart('stRevenueChart', {
        type: 'bar',
        data: {
          labels: stData.map(t => t.name),
          datasets: [{
            label: 'Revenue',
            data: stData.map(t => t.nexstar.total_revenue),
            backgroundColor: stData.map(t => t.color + 'CC'),
            borderColor: stData.map(t => t.color),
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 52
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          scales: {
            y: { ticks: { font: { size: 11, family: "'JetBrains Mono'" }, callback: v => '$' + (v/1000).toFixed(0) + 'k' }, grid: { color: '#EDEBE6' } },
            x: { ticks: { font: { size: 12, family: "'DM Sans'", weight: '500' } }, grid: { display: false } }
          },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => '$' + ctx.parsed.y.toLocaleString() } }
          }
        }
      });

      // Conversion + Leads combo chart
      createChart('stConversionChart', {
        type: 'bar',
        data: {
          labels: stData.map(t => t.name),
          datasets: [
            {
              label: 'Leads Set',
              data: stData.map(t => t.leads.leads_set),
              backgroundColor: '#2D6A6ABB',
              borderColor: '#2D6A6A',
              borderWidth: 1,
              borderRadius: 4,
              maxBarThickness: 36,
              yAxisID: 'y'
            },
            {
              label: 'Conv Rate %',
              data: stData.map(t => t.leads.conv_rate),
              type: 'line',
              borderColor: '#C47F17',
              backgroundColor: '#C47F1733',
              borderWidth: 2,
              pointRadius: 5,
              pointBackgroundColor: '#C47F17',
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          scales: {
            y: { position: 'left', ticks: { font: { size: 11, family: "'JetBrains Mono'" } }, grid: { color: '#EDEBE6' }, title: { display: true, text: 'Leads Set', font: { size: 11, family: "'DM Sans'" } } },
            y1: { position: 'right', min: 0, max: 100, ticks: { font: { size: 11, family: "'JetBrains Mono'" }, callback: v => v + '%' }, grid: { display: false }, title: { display: true, text: 'Conv Rate', font: { size: 11, family: "'DM Sans'" } } },
            x: { ticks: { font: { size: 12, family: "'DM Sans'" } }, grid: { display: false } }
          },
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 12, family: "'DM Sans'" }, usePointStyle: true, padding: 14 } }
          }
        }
      });
    }

    // ========== ROOKIE TRADING CARDS ==========
    // Manager rookie card stats — editable, persisted, synced
    const MGR_STATS_KEY = 'snappy_mgr_stats';
    function mgrLoadStats() {
      try { return JSON.parse(localStorage.getItem(MGR_STATS_KEY)) || {}; } catch(e) { return {}; }
    }
    function mgrSaveStats(stats) {
      localStorage.setItem(MGR_STATS_KEY, JSON.stringify(stats));
      if (SyncEngine.isConfigured()) SyncEngine.write('mgrstats', stats);
    }
    function mgrEditStat(key, label, currentVal) {
      if (!requireManager()) return;
      var newVal = prompt('Update ' + label + ':', currentVal || '');
      if (newVal !== null && newVal.trim() !== '') {
        var stats = mgrLoadStats();
        stats[key] = newVal.trim();
        mgrSaveStats(stats);
        renderRookieCards();
      }
    }

    function renderRookieCards() {
      let html = '';

      // Manager card — Mark Sanders, S-Tier (no flip)
      const mgrTierLower = 's';
      const mgrCompBarColor = 'linear-gradient(90deg, #FFD700, #FF6B6B, #8B5CF6, #4D96FF)';
      const ms = mgrLoadStats();
      const mgrInstalls = { count: 5, total_revenue: 69610, avg_sale: 13922, opps: 10, conv_pct: 40 };
      const mgrNexstar = { total_revenue: 7083, avg_sale: 403, conversion_rate: 36, spps_sold: 5, tech_gen_leads: 2, sold_hours: 13.45 };
      html += `
        <div class="rookie-flip-container no-flip">
          <div class="rookie-flip-inner">
            <div class="rookie-flip-front">
              <div class="rookie-card rookie-tier-s">
                <div class="rookie-card-border tier-s"></div>
                <div class="rookie-tier-badge tier-s">S-TIER</div>
                <div class="rookie-avatar-wrap">
                  <img src="maico_avatar.png" alt="Mark Sanders">
                  <div class="s-tier-flames">
                    <div class="s-flame"></div><div class="s-flame"></div><div class="s-flame"></div>
                    <div class="s-flame"></div><div class="s-flame"></div><div class="s-flame"></div>
                    <div class="s-flame"></div><div class="s-flame"></div><div class="s-flame"></div>
                    <div class="s-flame"></div>
                  </div>
                  <div class="s-tier-sparkles">
                    <div class="s-tier-sparkle"></div><div class="s-tier-sparkle"></div>
                    <div class="s-tier-sparkle"></div><div class="s-tier-sparkle"></div>
                    <div class="s-tier-sparkle"></div><div class="s-tier-sparkle"></div>
                    <div class="s-tier-sparkle"></div><div class="s-tier-sparkle"></div>
                  </div>
                  <div class="s-tier-color-cycle"></div>
                  <div class="rookie-label">
                    <span class="rookie-tag">Snappy Services</span>
                    <div class="rookie-name-overlay">Mark Sanders</div>
                    <div class="rookie-meta-overlay">Service Manager &bull; Elite</div>
                  </div>
                </div>
                <div class="rookie-info">
                  <div class="rookie-stats">
                    <div class="rookie-stat">
                      <div class="rookie-stat-value">$${mgrInstalls.total_revenue.toLocaleString()}</div>
                      <div class="rookie-stat-label">Equip Sales</div>
                      <div class="rookie-stat-period">${mgrInstalls.count} installs &bull; 90 days</div>
                    </div>
                    <div class="rookie-stat">
                      <div class="rookie-stat-value">${mgrInstalls.conv_pct}%</div>
                      <div class="rookie-stat-label">Install Conv %</div>
                      <div class="rookie-stat-period">${mgrInstalls.count}/${mgrInstalls.opps} opps</div>
                    </div>
                    <div class="rookie-stat mgr-stat-editable" onclick="event.stopPropagation();mgrEditStat('oneonone_rate','1-on-1 Completion Rate (per week)','${ms.oneonone_rate||''}')"> 
                      <div class="rookie-stat-value">${ms.oneonone_rate || '—'}</div>
                      <div class="rookie-stat-label">1-on-1 Rate</div>
                      <div class="rookie-stat-period">per week</div>
                    </div>
                    <div class="rookie-stat mgr-stat-editable" onclick="event.stopPropagation();mgrEditStat('ridealong_rate','Ride-Along Completion Rate (per week)','${ms.ridealong_rate||''}')"> 
                      <div class="rookie-stat-value">${ms.ridealong_rate || '—'}</div>
                      <div class="rookie-stat-label">Ride-Along Rate</div>
                      <div class="rookie-stat-period">per week</div>
                    </div>
                  </div>
                  <div class="rookie-composite">
                    <div class="rookie-composite-label">Composite</div>
                    <div class="rookie-composite-bar">
                      <div class="rookie-composite-bar-fill" style="width:100%;background:${mgrCompBarColor}"></div>
                    </div>
                    <div class="rookie-composite-score" style="color:#fbbf24">S</div>
                  </div>
                  <div class="rookie-certs"><span class="rookie-cert">Service Manager</span><span class="rookie-cert">Team Lead</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      // Tier progression data for back side
      const thresholds = { C: 78, B: 85, A: 92, S: 100 };
      const nextTierMap = { C: 'B', B: 'A', A: 'S', S: null };
      const tierLabelsMap = { B: 'Solid', A: 'Advanced', S: 'Elite' };
      const tierColors = { S: '#FFD700', A: '#F87171', B: '#60A5FA', C: '#9CA3AF' };
      const areas = [
        { key: 'aptScore', name: 'Aptitude Test', weight: 30, tip: (s) => s < 70 ? 'Study weak sections and retake the aptitude test' : s < 85 ? 'Review advanced topics to push score higher' : 'Strong — maintain through continued learning' },
        { key: 'stScore', name: 'ST Performance', weight: 35, tip: (s) => s < 50 ? 'Focus on conversion rate and revenue generation' : s < 70 ? 'Improve lead generation and close rate' : s < 85 ? 'Fine-tune options per opportunity and memberships' : 'Performing at a high level' },
        { key: 'mgrScore', name: 'Manager Score', weight: 15, tip: (s) => s < 60 ? 'Focus on communication, punctuality, and professionalism' : s < 80 ? 'Take initiative on callbacks and team collaboration' : 'Highly rated by management' },
        { key: 'installScore', name: 'Install Performance', weight: 10, tip: (s) => s < 30 ? 'Seek install opportunities and close equipment leads' : s < 60 ? 'Increase install count and average ticket size' : 'Solid install production' },
        { key: 'reviewScore', name: 'Google Reviews', weight: 5, tip: (s) => s < 40 ? 'Ask satisfied customers for reviews after every job' : s < 70 ? 'Consistent review requests will move this up' : 'Good customer feedback presence' },
        { key: 'skillScore', name: 'Skills Tags', weight: 10, tip: (s) => s < 40 ? 'Earn more skill certifications through training' : s < 70 ? 'Continue building skill count — almost there' : 'Strong skill coverage' }
      ];

      // Sort techs by composite score (highest first)
      const sortedTechs = [...techs].sort((a, b) => getTechTier(b).composite - getTechTier(a).composite);

      const dispData = dispLoad();

      sortedTechs.forEach(t => {
        const tierInfo = getTechTier(t);
        const tierLower = tierInfo.tier.toLowerCase();
        const apt = aptitudeTests[t.short];
        const st = stData.find(s => s.name === t.short);
        const gr = googleReviews[t.short];
        const techDispTags = (dispData.assignments && dispData.assignments[t.short]) || [];

        // Composite bar color based on tier
        const compBarColor = tierLower === 's' ? 'linear-gradient(90deg, #FFD700, #FF6B6B, #8B5CF6, #4D96FF)'
          : tierLower === 'a' ? 'linear-gradient(90deg, #DC2626, #EF4444)'
          : tierLower === 'b' ? 'linear-gradient(90deg, #2563EB, #3B82F6)'
          : 'linear-gradient(90deg, #6B7280, #9CA3AF)';

        // Build ST stat rows — MTD / 90-Day toggle
        var stRows = '';
        if (st) {
          var isW = st.isWarrantyTech;
          // MTD data
          var mn = st.mtd_nexstar || st.nexstar;
          var mp = st.mtd_productivity || st.productivity;
          var mm = st.mtd_memberships || st.memberships;
          var ms = st.mtd_sales || st.sales;
          // 90-day data
          var n90 = st.nexstar;
          var p90 = st.productivity;
          var m90 = st.memberships;
          var s90 = st.sales;
          var cardId = 'rookie-st-' + t.short;

          function buildStGrid(nx, pr, mb, sl, label, isWarranty, stObj) {
            return `
              <div class="rookie-st-grid">
                <div class="rookie-st-item">
                  <div class="rookie-st-val">$${nx.total_revenue.toLocaleString()}</div>
                  <div class="rookie-st-lbl">Revenue</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">$${nx.avg_sale}</div>
                  <div class="rookie-st-lbl">Avg Ticket</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">${nx.conversion_rate}%</div>
                  <div class="rookie-st-lbl">Conv Rate</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">${mb.total_mem_sold}/${mb.total_mem_opps}</div>
                  <div class="rookie-st-lbl">Mem Sold</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">${mb.total_mem_pct}%</div>
                  <div class="rookie-st-lbl">Mem Conv</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">${isWarranty ? stObj.completedJobs : nx.tech_gen_leads}</div>
                  <div class="rookie-st-lbl">${isWarranty ? 'Jobs Done' : 'Leads Set'}</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">$${pr.rev_hr}</div>
                  <div class="rookie-st-lbl">Rev/Hr</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">${pr.sold_hrs_on_job_pct}%</div>
                  <div class="rookie-st-lbl">Sold Hrs %</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">${sl.close_rate}%</div>
                  <div class="rookie-st-lbl">Close Rate</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">${pr.options_per_opp}</div>
                  <div class="rookie-st-lbl">Opts/Opp</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">${pr.recalls}</div>
                  <div class="rookie-st-lbl">Recalls</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">${nx.spps_sold}</div>
                  <div class="rookie-st-lbl">SPPs Sold</div>
                </div>
              </div>`;
          }

          stRows = `
            <div class="rookie-st-section">
              <div class="rookie-st-header">
                ServiceTitan Performance
                <div class="rookie-st-toggle" onclick="event.stopPropagation();rookieStToggle('${cardId}')">
                  <span class="rookie-st-toggle-opt is-active" data-view="mtd">MTD</span>
                  <span class="rookie-st-toggle-opt" data-view="90d">90-Day</span>
                </div>
              </div>
              <div id="${cardId}-mtd" class="rookie-st-view is-visible">
                ${buildStGrid(mn, mp, mm, ms, 'MTD', isW, st)}
              </div>
              <div id="${cardId}-90d" class="rookie-st-view">
                ${buildStGrid(n90, p90, m90, s90, '90-Day', isW, st)}
              </div>
            </div>
            <div class="rookie-st-section">
              <div class="rookie-st-header">Install Performance</div>
              <div class="rookie-st-grid">
                <div class="rookie-st-item">
                  <div class="rookie-st-val">${st.installs.count}</div>
                  <div class="rookie-st-lbl">Installs</div>
                </div>
                <div class="rookie-st-item">
                  <div class="rookie-st-val">$${st.installs.total_revenue.toLocaleString()}</div>
                  <div class="rookie-st-lbl">Install Rev</div>
                </div>

              </div>
            </div>
          `;
        }

        // === Build BACK side: tier progression info ===
        const next = nextTierMap[tierInfo.tier];
        const target = next ? thresholds[tierInfo.tier] : null;
        // Use raw composite for gap so rounding never shows +0 when tech hasn't crossed threshold
        const gapRaw = target ? target - tierInfo.compositeRaw : 0;
        const gap = Math.max(Math.ceil(gapRaw), next ? 1 : 0); // At least +1 if not yet promoted
        const nextLabel = next ? tierLabelsMap[next] : null;
        const nextColor = next ? tierColors[next] : tierColors[tierInfo.tier];

        // Score each area, sort by improvement potential (biggest gap first)
        const areaScores = areas.map(a => ({
          ...a,
          score: tierInfo[a.key],
          potential: (100 - tierInfo[a.key]) * (a.weight / 100)
        }));
        areaScores.sort((a, b) => b.potential - a.potential);

        // Top 3 weakest areas for action items
        const topActions = areaScores.slice(0, 3);

        const backHTML = next ? `
          <div class="rookie-back-content">
            <div class="rookie-back-header">
              <div class="rookie-back-name">${t.name}</div>
              <div class="rookie-back-subtitle">Path to ${next}-Tier</div>
            </div>

            <div class="rookie-back-target">
              <div class="rookie-back-target-tier" style="color:${nextColor}">${next}-TIER</div>
              <div class="rookie-back-target-label">Next Tier: ${nextLabel} (${target}+ pts)</div>
            </div>

            <div class="rookie-back-gap">
              <div class="rookie-back-gap-num" style="color:${nextColor}">+${gap}</div>
              <div class="rookie-back-gap-label">points needed</div>
            </div>

            <div class="rookie-back-divider"></div>

            <div>
              <div class="rookie-back-section-title">Weighted Score Breakdown</div>
              <div class="rookie-back-areas">
                ${areaScores.map(a => {
                  const cls = a.score >= 80 ? 'is-strong' : a.score < 55 ? 'is-weak' : 'is-ok';
                  const fillColor = a.score >= 80 ? '#4ADE80' : a.score < 55 ? '#EF4444' : nextColor;
                  return `
                    <div class="rookie-back-area">
                      <div class="rookie-back-area-header">
                        <span class="rookie-back-area-name">${a.name} (${a.weight}%)</span>
                        <span class="rookie-back-area-score ${cls}">${a.score}</span>
                      </div>
                      <div class="rookie-back-area-bar">
                        <div class="rookie-back-area-bar-fill" style="width:${a.score}%;background:${fillColor}"></div>
                      </div>
                      <div class="rookie-back-area-tip">${a.tip(a.score)}</div>
                    </div>
                  `;
                }).join('')}
                <div class="rookie-back-area">
                  <div class="rookie-back-area-header">
                    <span class="rookie-back-area-name">Dispatch Tags (Premium +1 / Standard +0.25)</span>
                    <span class="rookie-back-area-score ${tierInfo.dispatchBonus >= 2 ? 'is-strong' : tierInfo.dispatchBonus >= 1 ? 'is-ok' : 'is-weak'}">+${tierInfo.dispatchBonus.toFixed(2)}</span>
                  </div>
                  <div class="rookie-back-area-bar">
                    <div class="rookie-back-area-bar-fill" style="width:${Math.min(tierInfo.dispatchBonus / 4 * 100, 100)}%;background:${tierInfo.dispatchBonus >= 2 ? '#4ADE80' : tierInfo.dispatchBonus >= 1 ? nextColor : '#EF4444'}"></div>
                  </div>
                  <div class="rookie-back-area-tip">${tierInfo.dispatchTagCount} tag${tierInfo.dispatchTagCount !== 1 ? 's' : ''} assigned (+${tierInfo.dispatchBonus.toFixed(2)} pts) — Lead Tech, Ride Along Trainer &amp; Warranty Tech = +1.0 each, all others +0.25</div>
                </div>
                <div class="rookie-back-area">
                  <div class="rookie-back-area-header">
                    <span class="rookie-back-area-name">Efficiency Bonus (Sold/Billable Hr %)</span>
                    <span class="rookie-back-area-score ${tierInfo.efficiencyBonus >= 1.5 ? 'is-strong' : tierInfo.efficiencyBonus >= 0.5 ? 'is-ok' : 'is-weak'}">+${tierInfo.efficiencyBonus.toFixed(2)}</span>
                  </div>
                  <div class="rookie-back-area-bar">
                    <div class="rookie-back-area-bar-fill" style="width:${Math.min(tierInfo.efficiencyBonus / 2 * 100, 100)}%;background:${tierInfo.efficiencyBonus >= 1.5 ? '#4ADE80' : tierInfo.efficiencyBonus >= 0.5 ? nextColor : '#EF4444'}"></div>
                  </div>
                  <div class="rookie-back-area-tip">${tierInfo.efficiencyPct}% MTD on-job (${tierInfo.efficiencyLabel}) — 30%=+0.50 | 40%=+1.00 | 50%=+1.50 | 60%=+2.00</div>
                </div>
              </div>
            </div>

            <div class="rookie-back-divider"></div>

            <div>
              <div class="rookie-back-section-title">Priority Actions</div>
              <div class="rookie-back-actions">
                ${topActions.map((a, i) => `
                  <div class="rookie-back-action">
                    <div class="rookie-back-action-icon" style="background:${a.score < 55 ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)'};color:${a.score < 55 ? '#EF4444' : 'rgba(255,255,255,0.5)'}">${i + 1}</div>
                    <span><strong>${a.name}:</strong> ${a.tip(a.score)}</span>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="rookie-back-flip-hint">Tap to flip back</div>
          </div>
        ` : `
          <div class="rookie-back-content">
            <div class="rookie-back-header">
              <div class="rookie-back-name">${t.name}</div>
              <div class="rookie-back-subtitle">Maximum Tier Achieved</div>
            </div>
            <div class="rookie-back-target">
              <div class="rookie-back-target-tier" style="color:#fbbf24">S-TIER</div>
              <div class="rookie-back-target-label">Elite — Top Performer</div>
            </div>
            <div class="rookie-back-flip-hint">Tap to flip back</div>
          </div>
        `;

        html += `
          <div class="rookie-flip-container" onclick="this.classList.toggle('flipped')">
            <div class="rookie-flip-inner">
              <div class="rookie-flip-front">
                <div class="rookie-card rookie-tier-${tierLower}">
                  <div class="rookie-card-border tier-${tierLower}"></div>
                  <div class="rookie-tier-badge tier-${tierLower}">${tierInfo.tier}-TIER</div>
                  <div class="rookie-avatar-wrap">
                    ${techAvatars[t.short]
                      ? `<img src="${techAvatars[t.short]}" alt="${t.name}">`
                      : `<div class="initials-circle" style="background:${t.color}">${t.initials}</div>`
                    }
                    ${tierLower === 's' ? `
                      <div class="s-tier-flames">
                        <div class="s-flame"></div><div class="s-flame"></div><div class="s-flame"></div>
                        <div class="s-flame"></div><div class="s-flame"></div><div class="s-flame"></div>
                        <div class="s-flame"></div><div class="s-flame"></div><div class="s-flame"></div>
                        <div class="s-flame"></div>
                      </div>
                      <div class="s-tier-sparkles">
                        <div class="s-tier-sparkle"></div><div class="s-tier-sparkle"></div>
                        <div class="s-tier-sparkle"></div><div class="s-tier-sparkle"></div>
                        <div class="s-tier-sparkle"></div><div class="s-tier-sparkle"></div>
                        <div class="s-tier-sparkle"></div><div class="s-tier-sparkle"></div>
                      </div>
                      <div class="s-tier-color-cycle"></div>
                    ` : ''}
                    <div class="rookie-label">
                      <span class="rookie-tag">Snappy Services</span>
                      <div class="rookie-name-overlay">${t.name}</div>
                      <div class="rookie-meta-overlay">${t.position} &bull; ${t.years} yrs &bull; ${tierInfo.tierLabel}</div>
                    </div>
                  </div>
                  <div class="rookie-info">
                    <div class="rookie-stats">
                      <div class="rookie-stat">
                        <div class="rookie-stat-value">${apt ? Math.round((apt.totalScore / apt.maxScore) * 100) + '%' : '—'}</div>
                        <div class="rookie-stat-label">Aptitude</div>
                      </div>
                      <div class="rookie-stat">
                        <div class="rookie-stat-value">${gr ? gr.count : '—'}</div>
                        <div class="rookie-stat-label">Reviews</div>
                      </div>
                      <div class="rookie-stat">
                        <div class="rookie-stat-value">${st ? st.memberships.total_mem_sold : '—'}</div>
                        <div class="rookie-stat-label">Mem Sold</div>
                      </div>
                    </div>

                    <div class="rookie-composite">
                      <div class="rookie-composite-label">Composite</div>
                      <div class="rookie-composite-bar">
                        <div class="rookie-composite-bar-fill" style="width:${tierInfo.composite}%;background:${compBarColor}"></div>
                      </div>
                      <div class="rookie-composite-score" style="color:${t.color}">${tierInfo.composite}</div>
                    </div>

                    ${techDispTags.length ? `
                    <div class="rookie-dispatch-tags">
                      <div class="rookie-dispatch-header">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                        Dispatch Tags <span class="rookie-dispatch-bonus">+${tierInfo.dispatchBonus.toFixed(2)} pts</span>
                      </div>
                      <div class="rookie-dispatch-pills">
                        ${techDispTags.map(tag => {
                          const isPrem = DISP_PREMIUM_TAGS.includes(tag);
                          return `<span class="rookie-dispatch-pill${isPrem ? ' is-premium' : ''}">${isPrem ? '\u2B50 ' : ''}${tag}</span>`;
                        }).join('')}
                      </div>
                    </div>` : ''}

                    <div class="rookie-dispatch-tags">
                      <div class="rookie-dispatch-header">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        Efficiency Bonus <span class="rookie-dispatch-bonus" style="color:${tierInfo.efficiencyBonus >= 1.5 ? '#4ADE80' : tierInfo.efficiencyBonus >= 0.5 ? '#60A5FA' : '#EF4444'}">+${tierInfo.efficiencyBonus.toFixed(2)} pts</span>
                      </div>
                      <div class="rookie-dispatch-pills">
                        <span class="rookie-dispatch-pill${tierInfo.efficiencyBonus >= 1.5 ? ' is-premium' : ''}">${tierInfo.efficiencyPct}% On-Job</span>
                        <span class="rookie-dispatch-pill">${tierInfo.efficiencyLabel}</span>
                      </div>
                    </div>

                    ${stRows}

                    ${apt && apt.certs.length ? `<div class="rookie-certs">${apt.certs.map(c => `<span class="rookie-cert">${c}</span>`).join('')}</div>` : ''}
                  </div>
                  <div class="rookie-flip-hint">
                    <svg viewBox="0 0 24 24"><path d="M9 3l-5 5 5 5M15 3l5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    TAP TO FLIP
                  </div>
                </div>
              </div>
              <div class="rookie-flip-back">
                <div class="rookie-card rookie-tier-${tierLower}">
                  <div class="rookie-card-border tier-${tierLower}"></div>
                  ${backHTML}
                </div>
              </div>
            </div>
          </div>
        `;
      });

      document.getElementById('rookieGrid').innerHTML = html;
    }

    // Toggle MTD / 90-Day view on Rookie Card ST section
    function rookieStToggle(cardId) {
      var mtdEl = document.getElementById(cardId + '-mtd');
      var d90El = document.getElementById(cardId + '-90d');
      if (!mtdEl || !d90El) return;
      var isMtd = mtdEl.classList.contains('is-visible');
      mtdEl.classList.toggle('is-visible', !isMtd);
      d90El.classList.toggle('is-visible', isMtd);
      // Update toggle pills
      var toggle = mtdEl.closest('.rookie-st-section').querySelector('.rookie-st-toggle');
      if (toggle) {
        toggle.querySelectorAll('.rookie-st-toggle-opt').forEach(function(opt) {
          var v = opt.getAttribute('data-view');
          opt.classList.toggle('is-active', (v === 'mtd' && !isMtd) || (v === '90d' && isMtd));
        });
      }
    }

    // ========== TIER PROGRESSION ==========
    function renderProgression() {
      const thresholds = { C: 78, B: 85, A: 92, S: 100 };
      const nextTier = { C: 'B', B: 'A', A: 'S', S: null };
      const tierNames = { C: 'Developing', B: 'Solid', A: 'Advanced', S: 'Elite' };
      const tierIcons = { S: '\uD83D\uDC51', A: '\u2694\uFE0F', B: '\uD83D\uDEE1\uFE0F', C: '\uD83D\uDCDA' };
      
      const sorted = [...techs].sort((a, b) => getTechTier(b).composite - getTechTier(a).composite);
      
      // RPG Tier Map at the top
      let html = '<div class="rpg-tier-map">';
      html += '<div class="rpg-tier-map-title" style="font-family:Orbitron,monospace;font-size:16px;font-weight:700;text-align:center;margin-bottom:20px;color:var(--text-heading);">\u2694\uFE0F TIER PROGRESSION MAP \u2694\uFE0F</div>';
      html += '<div class="rpg-tier-track">';
      ['C', 'B', 'A', 'S'].forEach((tier, i) => {
        const threshold = i === 0 ? 0 : thresholds[['C','B','A'][i-1]];
        const techsInTier = sorted.filter(t => getTechTier(t).tier === tier);
        const isActive = techsInTier.length > 0;
        html += `<div class="rpg-tier-node ${isActive ? 'rpg-node-active' : 'rpg-node-locked'} rpg-node-${tier.toLowerCase()}">
          <div class="rpg-node-icon">${tierIcons[tier]}</div>
          <div class="rpg-node-label">${tier}-Tier</div>
          <div class="rpg-node-sublabel">${tierNames[tier]}</div>
          <div class="rpg-node-threshold">${i === 0 ? '<78' : threshold + '+ pts'}</div>
          <div class="rpg-node-avatars">${techsInTier.map(t => 
            techAvatars[t.short] 
              ? '<img class="rpg-mini-avatar" src="' + techAvatars[t.short] + '" title="' + t.short + '">' 
              : '<span class="rpg-mini-avatar-ph" style="background:' + t.color + '" title="' + t.short + '">' + t.initials + '</span>'
          ).join('')}</div>
        </div>`;
        if (i < 3) html += '<div class="rpg-tier-connector"><div class="rpg-connector-line"></div><div class="rpg-connector-arrow">\u25B8</div></div>';
      });
      html += '</div></div>';
      
      // Individual tech progression cards
      html += '<div class="prog-grid">';
      sorted.forEach((t, idx) => {
        const info = getTechTier(t);
        const xp = getXPData(t);
        const next = nextTier[info.tier];
        const target = next ? thresholds[info.tier] : null;
        const gap = target ? target - info.composite : 0;

        const areas = [
          { key: 'aptScore', name: 'Aptitude', weight: 30, icon: '\uD83E\uDDE0', tip: (s) => s < 70 ? 'Retake aptitude test after studying weak areas' : s < 85 ? 'Review advanced topics to push score higher' : 'Strong \u2014 maintain through continued learning' },
          { key: 'stScore', name: 'ST Performance', weight: 35, icon: '\uD83D\uDCCA', tip: (s) => s < 50 ? 'Focus on conversion rate and revenue' : s < 70 ? 'Improve lead gen and close rate' : s < 85 ? 'Fine-tune options/opp and memberships' : 'Performing at a high level' },
          { key: 'mgrScore', name: 'Manager Score', weight: 15, icon: '\uD83D\uDCCB', tip: (s) => s < 60 ? 'Focus on communication and professionalism' : s < 80 ? 'Take initiative on callbacks and teamwork' : 'Highly rated by management' },
          { key: 'installScore', name: 'Installs', weight: 10, icon: '\uD83C\uDFE0', tip: (s) => s < 30 ? 'Seek install opps and close equipment replacements' : s < 60 ? 'Increase install count and avg ticket' : 'Solid install production' },
          { key: 'reviewScore', name: 'Google Reviews', weight: 10, icon: '\u2B50', tip: (s) => s < 40 ? 'Ask satisfied customers for reviews after every job' : s < 70 ? 'Consistent requests will move this up' : 'Good review presence' }
        ];

        const areaScores = areas.map(a => ({
          ...a, score: info[a.key],
          weighted: info[a.key] * (a.weight / 100),
          potential: (100 - info[a.key]) * (a.weight / 100)
        }));
        areaScores.sort((a, b) => b.potential - a.potential);

        const avatarHTML = techAvatars[t.short]
          ? `<img class="prog-avatar" src="${techAvatars[t.short]}" alt="${t.name}">`
          : `<div class="prog-avatar-placeholder" style="background:${t.color}">${t.initials}</div>`;

        const badges = getAchievements(t);

        html += `
          <div class="prog-card card-animate" style="animation-delay:${idx * 0.1}s">
            <div class="prog-header">
              ${avatarHTML}
              <div>
                <div class="prog-name">${t.name}</div>
                <div class="prog-subtitle">${t.position} \u2022 ${t.years} yrs</div>
              </div>
              <div class="prog-badges">
                ${tierBadgeHTML(info.tier)}
                ${next ? `<span class="prog-arrow">\u2192</span>${tierBadgeHTML(next)}<span class="prog-points-needed">+${gap} pts</span>` : '<span style="font-size:12px;color:var(--accent-gold);font-weight:700;font-family:Orbitron,monospace">\u2605 MAX</span>'}
              </div>
            </div>

            ${renderXPBar(t, 'lg')}

            <div class="prog-achievement-section">
              <div class="prog-achievement-title">\uD83C\uDFC6 Achievements (${badges.filter(b=>b.earned).length}/${badges.length})</div>
              ${renderBadgeRow(badges)}
            </div>

            <div class="prog-areas">
              ${areaScores.map(a => {
                const cls = a.score >= 80 ? 'is-strong' : a.score < 55 ? 'is-weak' : 'is-ok';
                const fillColor = a.score >= 80 ? 'var(--accent-green)' : a.score < 55 ? 'var(--accent-red)' : 'var(--snappy-blue-light)';
                return `
                  <div class="prog-area ${cls}">
                    <div class="prog-area-header">
                      <span class="prog-area-name">${a.icon} ${a.name} (${a.weight}%)</span>
                      <span class="prog-area-score">${a.score}</span>
                    </div>
                    <div class="prog-area-bar">
                      <div class="prog-area-bar-fill" style="width:${a.score}%;background:${fillColor}"></div>
                    </div>
                    <div class="prog-area-tip">${a.tip(a.score)}</div>
                  </div>
                `;
              }).join('')}
              <div class="prog-area ${info.dispatchBonus >= 2 ? 'is-strong' : info.dispatchBonus >= 1 ? 'is-ok' : 'is-weak'}">
                <div class="prog-area-header">
                  <span class="prog-area-name">\uD83D\uDE90 Dispatch Tags (Premium +1 / Std +0.25)</span>
                  <span class="prog-area-score">+${info.dispatchBonus.toFixed(2)}</span>
                </div>
                <div class="prog-area-bar">
                  <div class="prog-area-bar-fill" style="width:${Math.min(info.dispatchBonus / 4 * 100, 100)}%;background:${info.dispatchBonus >= 2 ? 'var(--accent-green)' : info.dispatchBonus >= 1 ? 'var(--snappy-blue-light)' : 'var(--accent-red)'}"></div>
                </div>
                <div class="prog-area-tip">${info.dispatchTagCount} tag${info.dispatchTagCount !== 1 ? 's' : ''} (+${info.dispatchBonus.toFixed(2)} pts) \u2014 Lead Tech, Ride Along Trainer &amp; Warranty Tech = +1.0 each, all others +0.25</div>
              </div>
              <div class="prog-area ${info.efficiencyBonus >= 1.5 ? 'is-strong' : info.efficiencyBonus >= 0.5 ? 'is-ok' : 'is-weak'}">
                <div class="prog-area-header">
                  <span class="prog-area-name">\u23F1 Efficiency Bonus (Sold/Billable Hr %)</span>
                  <span class="prog-area-score">+${info.efficiencyBonus.toFixed(2)}</span>
                </div>
                <div class="prog-area-bar">
                  <div class="prog-area-bar-fill" style="width:${Math.min(info.efficiencyBonus / 2 * 100, 100)}%;background:${info.efficiencyBonus >= 1.5 ? 'var(--accent-green)' : info.efficiencyBonus >= 0.5 ? 'var(--snappy-blue-light)' : 'var(--accent-red)'}"></div>
                </div>
                <div class="prog-area-tip">${info.efficiencyPct}% MTD on-job (${info.efficiencyLabel}) \u2014 &lt;30%=+0 | 30%=+0.50 | 40%=+1.00 | 50%=+1.50 | 60%+=+2.00</div>
              </div>
            </div>
          </div>
        `;
      });

      html += '</div>';
      document.getElementById('progressionGrid').innerHTML = html;
    }


    // ========== MANAGER TAB ==========
    const MGR_STORAGE_KEY = 'snappy_manager_entries';
    const MGR_TECH_COLORS = {
      'Chris': '#2D6A6A',
      'Dewone': '#C47F17',
      'Benji': '#5B4A8A',
      'Daniel': '#3A7A4A',
      'Dee': '#8B3A3A'
    };
    const MGR_HOUSEKEEPING_ITEMS = [
      { key: 'dispatch', label: 'Dispatch — late starts, missed calls, routing' },
      { key: 'complaints', label: 'Customer complaints — open issues, resolution' },
      { key: 'callbacks', label: 'Callbacks — recent callbacks, root cause, prevention' },
      { key: 'invoices', label: 'Invoices — accuracy, completeness, timely submission' },
      { key: 'recsOptions', label: 'Recommendations / Options — presenting full options?' },
      { key: 'wantsNeeds', label: 'Wants & Needs — tech\'s personal development goals' },
      { key: 'matrixSuggestions', label: 'Matrix suggestions — skill gaps & development focus' },
      { key: 'scoreBreakdown', label: 'Matrix score breakdown — review composite score & weighted areas' }
    ];
    const MGR_OBSERVATION_ITEMS = [
      { key: 'prepare', label: '1. PREPARE — Reviewed call, truck stocked, mentally ready', group: 'Prepare' },
      { key: 'greet', label: '2. GREET — Shoe covers, 3 pillars of trust, agenda card', group: 'Greet' },
      { key: 'greetImpression', label: '   First impression / professional presence', group: 'Greet' },
      { key: 'explore', label: '3. EXPLORE — Symptom & lifestyle questions asked', group: 'Explore' },
      { key: 'explorePhotos', label: '   Photos taken, Summary of Findings started', group: 'Explore' },
      { key: 'explorePricing', label: '   Price conditioning done', group: 'Explore' },
      { key: 'present', label: '4. PRESENT — 3+ options to all decision-makers', group: 'Present' },
      { key: 'presentMethod', label: '   Link-Say-Spin-Zip method used', group: 'Present' },
      { key: 'presentMembership', label: '   Membership / SPP offered', group: 'Present' },
      { key: 'execute', label: '5. EXECUTE — Quality work, clean workspace', group: 'Execute' },
      { key: 'executeTime', label: '   Time management / dispatch updated', group: 'Execute' },
      { key: 'wrapup', label: '6. WRAP UP — Tested work, showed customer', group: 'Wrap Up' },
      { key: 'wrapupReview', label: '   Asked for 5-star review', group: 'Wrap Up' },
      { key: 'wrapupSummary', label: '   Summary of Findings completed', group: 'Wrap Up' }
    ];

    let mgrState = {
      entries: [],
      trainings: []
    };

    // ----- Persistence -----
    function mgrLoad() {
      try {
        const raw = localStorage.getItem(MGR_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          mgrState.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
          mgrState.trainings = Array.isArray(parsed.trainings) ? parsed.trainings : [];
        }
      } catch (e) {
        console.warn('Manager: failed to load storage', e);
      }
    }
    function mgrSave() {
      try {
        localStorage.setItem(MGR_STORAGE_KEY, JSON.stringify(mgrState));
        if (SyncEngine.isConfigured()) SyncEngine.write('manager', mgrState);
      } catch (e) {
        console.warn('Manager: failed to save storage', e);
      }
    }
    function mgrUID() {
      return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    // ----- Date helpers -----
    function mgrToday() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    function mgrFmtDate(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }
    function mgrParseDate(s) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    function mgrFmtDisplay(d) {
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    function mgrFmtShort(d) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    function mgrStartOfWeek(d) {
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      x.setDate(x.getDate() - x.getDay()); // Sunday
      return x;
    }
    function mgrSameDay(a, b) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    // ----- Calendar state -----
    let mgrCalDate = mgrToday();

    // ----- Daily Duties persistence -----
    const DAILY_DUTIES_KEY = 'snappy_daily_duties';
    function mgrLoadDailyDuties() {
      try { return JSON.parse(localStorage.getItem(DAILY_DUTIES_KEY)) || {}; } catch(e) { return {}; }
    }
    function mgrGetDailyDuty(dateStr, dutyKey) {
      var duties = mgrLoadDailyDuties();
      return duties[dateStr] && duties[dateStr][dutyKey];
    }
    function mgrToggleDailyDuty(dateStr, dutyKey, checked) {
      var duties = mgrLoadDailyDuties();
      if (!duties[dateStr]) duties[dateStr] = {};
      duties[dateStr][dutyKey] = checked;
      localStorage.setItem(DAILY_DUTIES_KEY, JSON.stringify(duties));
      if (SyncEngine.isConfigured()) SyncEngine.write('dailyduties', duties);
    }

    // ----- Day Notes persistence -----
    const DAY_NOTES_KEY = 'snappy_day_notes';
    function mgrLoadDayNotes() {
      try { return JSON.parse(localStorage.getItem(DAY_NOTES_KEY)) || {}; } catch(e) { return {}; }
    }
    function mgrGetDayNote(dateStr) {
      var notes = mgrLoadDayNotes();
      return notes[dateStr] || '';
    }
    var _noteTimer = null;
    function mgrSaveDayNote(dateStr, text) {
      var notes = mgrLoadDayNotes();
      if (text.trim()) { notes[dateStr] = text; } else { delete notes[dateStr]; }
      localStorage.setItem(DAY_NOTES_KEY, JSON.stringify(notes));
      clearTimeout(_noteTimer);
      _noteTimer = setTimeout(function() {
        if (SyncEngine.isConfigured()) SyncEngine.write('daynotes', notes);
      }, 1500);
    }

    // ----- Nexstar biweekly meeting check -----
    // Every other Monday starting 4/20/2026, 8:00 AM — coaches Jay & Greg
    var NEXSTAR_ANCHOR = new Date(2026, 3, 20); // April 20, 2026
    function isNexstarMonday(d) {
      if (d.getDay() !== 1) return false;
      var diff = Math.round((d.getTime() - NEXSTAR_ANCHOR.getTime()) / (1000 * 60 * 60 * 24));
      return diff % 14 === 0;
    }
    const NEXSTAR_KEY = 'snappy_nexstar';
    function mgrLoadNexstar() {
      try { return JSON.parse(localStorage.getItem(NEXSTAR_KEY)) || {}; } catch(e) { return {}; }
    }
    function mgrGetNexstarData(dateStr) {
      var all = mgrLoadNexstar();
      return all[dateStr] || {};
    }
    function mgrToggleNexstar(dateStr, key, checked) {
      var all = mgrLoadNexstar();
      if (!all[dateStr]) all[dateStr] = {};
      all[dateStr][key] = checked;
      localStorage.setItem(NEXSTAR_KEY, JSON.stringify(all));
      if (SyncEngine.isConfigured()) SyncEngine.write('nexstar', all);
    }
    var _nexNoteTimer = null;
    function mgrSaveNexstarNote(dateStr, text) {
      var all = mgrLoadNexstar();
      if (!all[dateStr]) all[dateStr] = {};
      all[dateStr].notes = text;
      localStorage.setItem(NEXSTAR_KEY, JSON.stringify(all));
      clearTimeout(_nexNoteTimer);
      _nexNoteTimer = setTimeout(function() {
        if (SyncEngine.isConfigured()) SyncEngine.write('nexstar', all);
      }, 1500);
    }

    // ----- Suggestion algorithms -----
    function mgrGetCategoryCoverage() {
      const techNames = Object.keys(skillsData.assignments);
      const result = [];
      Object.keys(skillsData.categories).forEach(k => {
        const cat = skillsData.categories[k];
        const totalPossible = cat.skills.length * techNames.length;
        let totalHas = 0;
        techNames.forEach(t => {
          cat.skills.forEach(s => {
            if (skillsData.assignments[t].includes(s.id)) totalHas++;
          });
        });
        const pct = totalPossible ? Math.round(totalHas / totalPossible * 100) : 0;
        result.push({ key: k, name: cat.name, pct: pct, color: cat.color, skills: cat.skills });
      });
      return result.sort((a, b) => a.pct - b.pct);
    }

    function mgrGetSTWeakness() {
      // aggregate weak areas
      const avgConv = stData.reduce((s, t) => s + (t.nexstar.conversion_rate || 0), 0) / stData.length;
      const avgMem  = stData.reduce((s, t) => s + (t.memberships.total_mem_pct || 0), 0) / stData.length;
      const avgOpt  = stData.reduce((s, t) => s + (t.productivity.options_per_opp || 0), 0) / stData.length;
      const weakConv = stData.filter(t => t.nexstar.conversion_rate < avgConv - 5).map(t => t.name);
      const weakMem  = stData.filter(t => t.memberships.total_mem_pct < Math.max(avgMem - 5, 25)).map(t => t.name);
      const weakOpt  = stData.filter(t => t.productivity.options_per_opp < avgOpt - 0.2).map(t => t.name);
      return {
        avgConv: Math.round(avgConv),
        avgMem: Math.round(avgMem),
        avgOpt: avgOpt.toFixed(2),
        weakConv, weakMem, weakOpt
      };
    }

    function mgrGetSuggestedTraining() {
      const cov = mgrGetCategoryCoverage();
      const weakest = cov[0];
      const second = cov[1];
      const st = mgrGetSTWeakness();

      // Pick a topic based on the weakest category
      let topic = '';
      let rationale = '';
      let relatedSkills = weakest.skills.slice(0, 3).map(s => s.id + ' — ' + s.name);
      let affectedTechs = [];

      // Cross-reference ST data to focus the topic
      if (weakest.key === 'C' || second.key === 'C') {
        topic = 'Sales & Revenue — Options & Membership Conversion';
        rationale = 'Team is weakest in Sales & Revenue (' + cov.find(c=>c.key==='C').pct + '% coverage). Average membership % is ' + st.avgMem + '% and avg options per opp is ' + st.avgOpt + ' — both with room to grow.';
        affectedTechs = Array.from(new Set([...st.weakMem, ...st.weakOpt]));
      } else if (weakest.key === 'H') {
        topic = 'Nexstar Service System — End-to-End Flow';
        rationale = 'NSS coverage is the team\'s weakest area at ' + weakest.pct + '%. Multiple techs lack Greet, Explore, Present, Execute, or Wrap Up tagging.';
        affectedTechs = Object.keys(skillsData.assignments).filter(t => {
          const nssHas = ['H1','H2','H3','H4','H5'].filter(id => skillsData.assignments[t].includes(id)).length;
          return nssHas < 4;
        });
      } else if (weakest.key === 'B') {
        topic = 'Diagnostics Deep-Dive — Control Boards & Gas Valves';
        rationale = 'Diagnostics coverage is low at ' + weakest.pct + '%. Focus on systematic troubleshooting and newer skills like control boards, igniters, and gas valves.';
        affectedTechs = Object.keys(skillsData.assignments).filter(t => {
          const diag = skillsData.categories.B.skills.filter(s => !skillsData.assignments[t].includes(s.id)).length;
          return diag >= 4;
        });
      } else if (weakest.key === 'D') {
        topic = 'Work Quality — Documentation & Summary of Findings';
        rationale = 'Work Quality is weakest at ' + weakest.pct + '%. Focus on D1 (diagnostic write-ups) and D5 (Summary of Findings).';
        affectedTechs = Object.keys(skillsData.assignments).filter(t => !skillsData.assignments[t].includes('D1') || !skillsData.assignments[t].includes('D5'));
      } else if (weakest.key === 'F') {
        topic = 'Certifications Push — NexTech Academy & EPA';
        rationale = 'Certification coverage is at ' + weakest.pct + '%. Focus on EPA 608 and NexTech enrollment paths.';
        affectedTechs = Object.keys(skillsData.assignments).filter(t => !skillsData.assignments[t].includes('F1'));
      } else {
        topic = weakest.name + ' — Team-wide Focus';
        rationale = 'This category has the lowest team coverage at ' + weakest.pct + '%.';
        affectedTechs = Object.keys(skillsData.assignments);
      }

      // Also weave in devPriorities themes
      const priorityCounts = {};
      Object.keys(skillsData.devPriorities).forEach(t => {
        (skillsData.devPriorities[t].next || []).forEach(s => {
          const sid = String(s).split(' ')[0];
          priorityCounts[sid] = (priorityCounts[sid] || 0) + 1;
        });
      });
      const commonPriorities = Object.entries(priorityCounts)
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([sid]) => sid);

      return {
        topic,
        rationale,
        relatedSkills,
        affectedTechs,
        commonPriorities,
        weakestCategory: weakest,
        secondCategory: second,
        stData: st
      };
    }

    // ----- Weekly compliance -----
    function mgrWeeklyCompliance(refDate) {
      const weekStart = mgrStartOfWeek(refDate);
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
      const weekStartStr = mgrFmtDate(weekStart);
      const weekEndStr = mgrFmtDate(weekEnd);
      const techNames = Object.keys(skillsData.assignments);
      const techsCoached = new Set();
      mgrState.entries.forEach(e => {
        if (e.status !== 'completed') return;
        if (e.date >= weekStartStr && e.date <= weekEndStr) techsCoached.add(e.tech);
      });
      return {
        weekStart, weekEnd,
        techsCoached: Array.from(techsCoached),
        totalTechs: techNames.length,
        target: 2
      };
    }

    // ----- Suggest next tech to coach -----
    function mgrNextSuggestedTech() {
      const techNames = Object.keys(skillsData.assignments);
      // Count completed coaching entries per tech (last 30 days)
      const now = mgrToday();
      const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = mgrFmtDate(cutoff);
      const counts = {};
      techNames.forEach(t => counts[t] = 0);
      mgrState.entries.forEach(e => {
        if (e.status === 'completed' && e.date >= cutoffStr && counts[e.tech] !== undefined) {
          counts[e.tech]++;
        }
      });
      // Sort by fewest sessions, tiebreaker by skill count (fewest first => needs most help)
      const sorted = techNames.slice().sort((a, b) => {
        if (counts[a] !== counts[b]) return counts[a] - counts[b];
        return skillsData.assignments[a].length - skillsData.assignments[b].length;
      });
      return { tech: sorted[0], sessions30: counts[sorted[0]] };
    }

    // ----- Render Calendar -----
    function renderManagerCalendar() {
      const title = mgrCalDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      document.getElementById('mgrCalTitle').textContent = title;

      const y = mgrCalDate.getFullYear();
      const m = mgrCalDate.getMonth();
      const firstOfMonth = new Date(y, m, 1);
      const startDay = firstOfMonth.getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const today = mgrToday();

      // Build entries index by date
      const entriesByDate = {};
      mgrState.entries.forEach(e => {
        if (!entriesByDate[e.date]) entriesByDate[e.date] = [];
        entriesByDate[e.date].push(e);
      });

      let html = '';
      ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
        html += `<div class="mgr-cal-dayname">${d}</div>`;
      });

      // leading empties
      for (let i = 0; i < startDay; i++) {
        html += `<div class="mgr-cal-cell empty"></div>`;
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(y, m, day);
        const dateStr = mgrFmtDate(cellDate);
        const dow = cellDate.getDay();
        const isToday = mgrSameDay(cellDate, today);
        const dayEntries = entriesByDate[dateStr] || [];

        let labelHtml = '';
        if (dow === 1 && isNexstarMonday(cellDate)) labelHtml = `<div class="mgr-cal-label nexstar">Nexstar 8AM</div>`;
        else if (dow === 1) labelHtml = `<div class="mgr-cal-label mon">Planning & Review</div>`;
        if (dow === 2) labelHtml = `<div class="mgr-cal-label tue">Training Prep</div>`;
        if (dow === 3) labelHtml = `<div class="mgr-cal-label wed">Team Meeting</div>`;

        // Build dots
        let dots = '';
        // Recurring day indicators
        if (dow === 1 && isNexstarMonday(cellDate)) dots += `<span class="mgr-cal-dot teal" title="Nexstar Zoom"></span>`;
        if (dow === 1) dots += `<span class="mgr-cal-dot purple" title="Planning & Review"></span>`;
        if (dow === 2) dots += `<span class="mgr-cal-dot orange" title="Training prep"></span>`;
        if (dow === 3) dots += `<span class="mgr-cal-dot gold" title="Team meeting"></span>`;
        dayEntries.forEach(e => {
          const isDone = e.status === 'completed';
          if (e.type === 'one-on-one') {
            dots += `<span class="mgr-cal-dot ${isDone ? '' : 'hollow '}green" title="1-on-1: ${e.tech} (${e.status})"></span>`;
          } else if (e.type === 'ride-along') {
            dots += `<span class="mgr-cal-dot ${isDone ? '' : 'hollow '}blue" title="Ride-along: ${e.tech} (${e.status})"></span>`;
          }
        });

        html += `<div class="mgr-cal-cell ${isToday ? 'today' : ''}" data-date="${dateStr}">
          <div class="mgr-cal-daynum">${day}</div>
          ${labelHtml}
          <div class="mgr-cal-dots">${dots}</div>
        </div>`;
      }

      document.getElementById('mgrCalGrid').innerHTML = html;

      // attach click handlers
      document.querySelectorAll('#mgrCalGrid .mgr-cal-cell:not(.empty)').forEach(cell => {
        cell.addEventListener('click', () => mgrOpenDayPanel(cell.dataset.date));
      });
    }

    // ----- Render KPI Row -----
    function renderManagerKPIs() {
      const now = mgrToday();
      const monthStart = mgrFmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const monthEnd = mgrFmtDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

      const monthEntries = mgrState.entries.filter(e => e.date >= monthStart && e.date <= monthEnd);
      const oneOnOnes = monthEntries.filter(e => e.type === 'one-on-one' && e.status === 'completed').length;
      const rideAlongs = monthEntries.filter(e => e.type === 'ride-along' && e.status === 'completed').length;

      // Compliance % — 2 coaching touches / tech / week, across all weeks in the month so far
      const techNames = Object.keys(skillsData.assignments);
      // Weeks elapsed in month (up to today or end)
      const weeksInMonth = new Set();
      monthEntries.forEach(e => {
        if (e.status !== 'completed') return;
        const d = mgrParseDate(e.date);
        const wk = mgrFmtDate(mgrStartOfWeek(d));
        weeksInMonth.add(wk);
      });
      // Use actual weeks-elapsed since start of month
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const weeksElapsed = Math.max(1, Math.ceil(((now - firstDay) / 86400000 + firstDay.getDay()) / 7));
      const targetTouches = techNames.length * 2 * weeksElapsed;
      const actualTouches = monthEntries.filter(e => e.status === 'completed').length;
      const compPct = targetTouches ? Math.min(100, Math.round(actualTouches / targetTouches * 100)) : 0;

      const next = mgrNextSuggestedTech();

      const kpis = [
        { label: '1-on-1s This Month', value: oneOnOnes, sub: oneOnOnes === 0 ? 'No sessions yet' : 'completed' },
        { label: 'Ride-Alongs This Month', value: rideAlongs, sub: rideAlongs === 0 ? 'No sessions yet' : 'completed' },
        { label: 'Coaching Compliance', value: compPct + '%', sub: actualTouches + ' of ' + targetTouches + ' target touches' },
        { label: 'Next Up', value: next.tech, sub: next.sessions30 + ' sessions in last 30 days' }
      ];

      document.getElementById('mgrKpiRow').innerHTML = kpis.map(k =>
        `<div class="mgr-kpi-card"><div class="mgr-kpi-value">${k.value}</div><div class="mgr-kpi-label">${k.label}</div><div class="mgr-kpi-sub">${k.sub}</div></div>`
      ).join('');
    }

    // ----- Compliance bar -----
    function renderManagerCompliance() {
      const c = mgrWeeklyCompliance(mgrToday());
      const techs = c.techsCoached.length;
      const target = c.target;
      const pct = Math.min(100, Math.round((techs / target) * 100));
      let cls = 'low';
      if (techs >= target) cls = 'ok';
      else if (techs >= 1) cls = 'mid';
      const label = `Week of ${mgrFmtShort(c.weekStart)}: ${techs}/${target} coaching touches (unique techs) · ${c.techsCoached.join(', ') || 'none'}`;
      document.getElementById('mgrCompliance').innerHTML = `
        <div class="mgr-compliance-label">This Week</div>
        <div class="mgr-compliance-bar"><div class="mgr-compliance-fill ${cls}" style="width:${pct}%"></div></div>
        <div class="mgr-compliance-count">${label}</div>
      `;
    }

    // ----- Manager Today View -----
    function renderMgrToday() {
      var container = document.getElementById('mgr-today');
      if (!container) return;

      var today = mgrToday();
      var dateStr = mgrFmtDate(today);
      var dow = today.getDay();
      var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var dayLabel = dayNames[dow];
      var displayDate = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      // Gather today's coaching entries
      var todayEntries = mgrState.entries.filter(function(e) { return e.date === dateStr; });

      // Gather today's BB items
      var bb = bbLoad();
      var todayMeetings = (bb.meetings || []).filter(function(m) { return m.date === dateStr; });
      var todayOO = (bb.oneOnOnes || []).filter(function(o) { return o.date === dateStr; });
      var todayRA = (bb.rideAlongs || []).filter(function(r) { return r.date === dateStr; });
      // Also merge manager entries not in BB
      var bbOOIds = {}; var bbRAIds = {};
      todayOO.forEach(function(o) { bbOOIds[o.id] = true; });
      todayRA.forEach(function(r) { bbRAIds[r.id] = true; });
      todayEntries.forEach(function(e) {
        if (e.type === 'one-on-one' && !bbOOIds[e.id]) todayOO.push({ id: e.id, tech: e.tech, date: e.date, status: e.status || 'planned' });
        else if (e.type === 'ride-along' && !bbRAIds[e.id]) todayRA.push({ id: e.id, tech: e.tech, date: e.date, status: e.status || 'planned' });
      });

      var totalEvents = todayMeetings.length + todayOO.length + todayRA.length;
      var isNex = dow === 1 && isNexstarMonday(today);

      var html = '';

      // ---- Header ----
      html += '<div class="mgr-today-header">';
      html += '<div class="mgr-today-date-box"><div class="day-num">' + today.getDate() + '</div><div class="day-name">' + dayLabel.substring(0,3) + '</div></div>';
      html += '<div class="mgr-today-info"><h2>' + dayLabel + '</h2><div class="sub">' + displayDate + ' &bull; ' + totalEvents + ' event' + (totalEvents !== 1 ? 's' : '') + ' today</div></div>';
      html += '</div>';

      // ---- Two-column grid: Checklist + Notes ----
      html += '<div class="mgr-today-grid">';

      // ---- LEFT: Daily Checklist ----
      html += '<div class="mgr-today-card">';
      html += '<div class="mgr-today-card-title"><span class="icon">\u2705</span> Daily Duties</div>';
      html += '<div class="mgr-today-checklist">';

      var dailyItems = [
        { key: 'review_calls', label: 'Review prior day calls, service & installs' },
        { key: 'clear_cases', label: 'Task management — clear ST cases' },
        { key: 'daily_huddle', label: 'Daily huddle with HVAC (Slack)' },
        { key: 'check_trello', label: 'Check Trello board' },
        { key: 'update_matrix', label: 'Update Matrix' }
      ];
      dailyItems.forEach(function(item) {
        var checked = mgrGetDailyDuty(dateStr, item.key);
        html += '<label class="mgr-today-check' + (checked ? ' is-done' : '') + '">';
        html += '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="mgrToggleDailyDuty(\'' + dateStr + '\',\'' + item.key + '\',this.checked);renderMgrToday()">';
        html += '<span>' + item.label + '</span></label>';
      });

      // Day-of-week specific items
      if (dow === 1) {
        html += '<div style="border-top:1px solid var(--border);margin:8px 0;padding-top:8px;">';
        html += '<div style="font-size:11px;font-weight:700;color:#fbbf24;margin-bottom:6px;">Monday Specifics</div>';
        var monItems = [
          { key: 'mon_employee_review', label: 'Employee Review #1 for the week' },
          { key: 'mon_leadership_mtg', label: '10:00 AM Leadership Meeting' },
          { key: 'mon_prior_week', label: 'Review prior week performance' },
          { key: 'mon_weekend_calls', label: 'Review weekend service calls' },
          { key: 'mon_training_plan', label: 'Build weekly training plan' },
          { key: 'mon_invoice_review', label: 'Invoice review from weekend' }
        ];
        monItems.forEach(function(item) {
          var checked = mgrGetDailyDuty(dateStr, item.key);
          html += '<label class="mgr-today-check' + (checked ? ' is-done' : '') + '">';
          html += '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="mgrToggleDailyDuty(\'' + dateStr + '\',\'' + item.key + '\',this.checked);renderMgrToday()">';
          html += '<span>' + item.label + '</span></label>';
        });
        html += '</div>';
      }
      if (dow === 2) {
        html += '<div style="border-top:1px solid var(--border);margin:8px 0;padding-top:8px;">';
        html += '<div style="font-size:11px;font-weight:700;color:#fbbf24;margin-bottom:6px;">Tuesday — Training Prep</div>';
        html += '<label class="mgr-today-check"><input type="checkbox" disabled><span>Prepare training topic for Wednesday meeting</span></label>';
        html += '<button class="mgr-today-action-btn" style="background:linear-gradient(135deg,#FFD700,#FFA500);color:#0F1B2E;margin-top:6px;font-size:12px;padding:6px 14px;" onclick="mgrGoTrainingTab()">Open Training Planner \u2192</button>';
        html += '</div>';
      }
      if (dow === 3) {
        html += '<div style="border-top:1px solid var(--border);margin:8px 0;padding-top:8px;">';
        html += '<div style="font-size:11px;font-weight:700;color:#fbbf24;margin-bottom:6px;">Wednesday — Team Meeting</div>';
        var weekOf = mgrFmtDate(mgrStartOfWeek(today));
        var training = mgrState.trainings.find(function(t) { return t.weekOf === weekOf; });
        if (training) {
          html += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">Topic: <strong style="color:var(--text);">' + (training.topic || '(not set)') + '</strong></div>';
        } else {
          html += '<div style="font-size:12px;color:var(--text-secondary);">No training prepared yet.</div>';
        }
        html += '</div>';
      }

      // Nexstar biweekly
      if (isNex) {
        html += '<div style="border-top:1px solid var(--border);margin:8px 0;padding-top:8px;">';
        html += '<div style="font-size:11px;font-weight:700;color:#14B8A6;margin-bottom:6px;">\ud83c\udfa5 Nexstar Zoom — 8:00 AM</div>';
        var nx = mgrGetNexstarData(dateStr);
        var nexItems = [
          { key: 'joined_call', label: 'Joined Zoom call' },
          { key: 'reviewed_action_items', label: 'Reviewed prior action items' },
          { key: 'shared_updates', label: 'Shared team updates' },
          { key: 'new_action_items', label: 'Captured new action items' }
        ];
        nexItems.forEach(function(item) {
          var checked = nx[item.key];
          html += '<label class="mgr-today-check' + (checked ? ' is-done' : '') + '">';
          html += '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="mgrToggleNexstar(\'' + dateStr + '\',\'' + item.key + '\',this.checked);renderMgrToday()">';
          html += '<span>' + item.label + '</span></label>';
        });
        html += '</div>';
      }

      html += '</div>'; // close checklist

      // Completion percentage
      var allChecks = dailyItems.length;
      var doneChecks = dailyItems.filter(function(i) { return mgrGetDailyDuty(dateStr, i.key); }).length;
      if (dow === 1) { allChecks += 6; ['mon_employee_review','mon_leadership_mtg','mon_prior_week','mon_weekend_calls','mon_training_plan','mon_invoice_review'].forEach(function(k){ if(mgrGetDailyDuty(dateStr,k)) doneChecks++; }); }
      if (isNex) { allChecks += 4; var nx2 = mgrGetNexstarData(dateStr); ['joined_call','reviewed_action_items','shared_updates','new_action_items'].forEach(function(k){ if(nx2[k]) doneChecks++; }); }
      var pct = allChecks ? Math.round(doneChecks / allChecks * 100) : 0;
      html += '<div style="margin-top:12px;display:flex;align-items:center;gap:10px;">';
      html += '<div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.1);overflow:hidden;"><div style="height:100%;width:' + pct + '%;border-radius:3px;background:' + (pct >= 100 ? '#22C55E' : '#FFD700') + ';transition:width 0.3s;"></div></div>';
      html += '<div style="font-size:12px;font-weight:700;color:' + (pct >= 100 ? '#22C55E' : '#FFD700') + ';">' + pct + '%</div>';
      html += '</div>';

      html += '</div>'; // close checklist card

      // ---- RIGHT: Notes ----
      html += '<div class="mgr-today-card">';
      html += '<div class="mgr-today-card-title"><span class="icon">\ud83d\udcdd</span> Notes & Ideas</div>';
      var dayNotes = mgrGetDayNote(dateStr);
      html += '<textarea class="mgr-today-notes" placeholder="Jot down ideas, reminders, or info for today..." oninput="mgrSaveDayNote(\'' + dateStr + '\',this.value)">' + mgrEscape(dayNotes) + '</textarea>';

      // Coaching entries for today
      if (todayEntries.length > 0 || todayOO.length > 0 || todayRA.length > 0) {
        html += '<div style="margin-top:16px;">';
        html += '<div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">Today\u2019s Coaching</div>';
        html += '<div class="mgr-today-entries">';
        todayEntries.forEach(function(e) {
          var typeLabel = e.type === 'one-on-one' ? '1-on-1' : 'Ride-Along';
          var typeCls = e.type === 'one-on-one' ? 'oneonone' : 'ridealong';
          html += '<div class="mgr-today-entry" onclick="mgrSwitchSubTab(\'calendar\');setTimeout(function(){mgrOpenDayPanel(\'' + dateStr + '\')},200)">';
          html += '<div class="mgr-today-entry-dot ' + typeCls + '"></div>';
          html += '<div class="mgr-today-entry-info"><div class="mgr-today-entry-type">' + typeLabel + '</div><div class="mgr-today-entry-name">' + e.tech + '</div></div>';
          html += '<div class="mgr-today-entry-status ' + (e.status || 'planned') + '">' + (e.status || 'planned') + '</div>';
          html += '</div>';
        });
        html += '</div></div>';
      }

      // Quick-add coaching buttons
      html += '<div class="mgr-today-actions mgr-edit-only" style="margin-top:auto;padding-top:14px;">';
      html += '<button class="mgr-today-action-btn green" onclick="mgrSwitchSubTab(\'calendar\');setTimeout(function(){mgrOpenDayPanel(\'' + dateStr + '\')},200)">+ 1-on-1</button>';
      html += '<button class="mgr-today-action-btn blue" onclick="mgrSwitchSubTab(\'calendar\');setTimeout(function(){mgrOpenDayPanel(\'' + dateStr + '\')},200)">+ Ride-Along</button>';
      html += '</div>';

      html += '</div>'; // close notes card
      html += '</div>'; // close grid

      // ---- Bulletin Board (full width below) ----
      html += '<div id="mgrTodayBB" class="mgr-bb"></div>';

      container.innerHTML = html;

      // Render the bulletin board into the Today section's BB container
      renderMgrBulletinBoardInto('mgrTodayBB');
    }

    // ----- Manager Bulletin Board (9-day rolling) -----
    function renderMgrBulletinBoardInto(targetId) {
      var container = document.getElementById(targetId || 'mgrBulletinBoard');
      if (!container) return;
      _renderMgrBBContent(container);
    }
    function renderMgrBulletinBoard() {
      // Render into both calendar BB and today BB (if they exist)
      _renderMgrBBContent(document.getElementById('mgrBulletinBoard'));
      _renderMgrBBContent(document.getElementById('mgrTodayBB'));
    }
    function _renderMgrBBContent(container) {
      if (!container) return;

      var now = new Date();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      // 9-day window: yesterday through +7 days
      var startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      var endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);

      // Build array of 9 days
      var days = [];
      for (var d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      }

      // Collect all events per date
      var bb = bbLoad();
      var eventsByDate = {};
      days.forEach(function(day) {
        var ds = mgrFmtDate(day);
        var evts = [];
        var dow = day.getDay();

        // Recurring labels
        if (dow === 1 && isNexstarMonday(day)) {
          evts.push({ type: 'nexstar', text: 'Nexstar Zoom 8AM', icon: '\ud83d\udcf9' });
        }
        if (dow === 1) evts.push({ type: 'recurring', text: 'Planning & Review', icon: '\ud83d\udccb' });
        if (dow === 2) evts.push({ type: 'recurring', text: 'Training Prep', icon: '\u270f\ufe0f' });
        if (dow === 3) evts.push({ type: 'recurring', text: 'Team Meeting', icon: '\ud83d\udce3' });

        // BB meetings
        (bb.meetings || []).forEach(function(m) {
          if (m.date === ds) evts.push({ type: 'meeting', text: m.subject || 'Meeting', icon: '\ud83d\udce3', time: m.time, id: m.id });
        });

        // BB one-on-ones
        (bb.oneOnOnes || []).forEach(function(o) {
          if (o.date === ds) evts.push({ type: 'oneonone', text: o.tech, icon: '\ud83e\udd1d', status: o.status || 'planned', id: o.id });
        });

        // BB ride-alongs
        (bb.rideAlongs || []).forEach(function(r) {
          if (r.date === ds) evts.push({ type: 'ridealong', text: r.tech, icon: '\ud83d\ude90', status: r.status || 'planned', id: r.id });
        });

        // Manager entries
        if (mgrState && mgrState.entries) {
          var bbOOIds = {}; var bbRAIds = {};
          (bb.oneOnOnes || []).forEach(function(o) { bbOOIds[o.id] = true; });
          (bb.rideAlongs || []).forEach(function(r) { bbRAIds[r.id] = true; });
          mgrState.entries.forEach(function(e) {
            if (e.date !== ds) return;
            if (e.type === 'one-on-one' && !bbOOIds[e.id]) {
              evts.push({ type: 'oneonone', text: e.tech, icon: '\ud83e\udd1d', status: e.status || 'planned', id: e.id });
            } else if (e.type === 'ride-along' && !bbRAIds[e.id]) {
              evts.push({ type: 'ridealong', text: e.tech, icon: '\ud83d\ude90', status: e.status || 'planned', id: e.id });
            }
          });
        }

        eventsByDate[ds] = evts;
      });

      // Window label
      var windowLabel = mgrFmtShort(startDate) + ' \u2013 ' + mgrFmtShort(endDate);

      var html = '';
      html += '<div class="mgr-bb-header">';
      html += '<div class="mgr-bb-title"><div class="mgr-bb-title-icon">\ud83d\udccc</div>Bulletin Board</div>';
      html += '<div class="mgr-bb-window">9-day window: ' + windowLabel + '</div>';
      html += '</div>';

      // Day header row
      html += '<div class="mgr-bb-board">';
      var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      days.forEach(function(day) {
        var isToday = mgrSameDay(day, today);
        html += '<div class="mgr-bb-dayhead' + (isToday ? ' today-col' : '') + '">' + dayNames[day.getDay()] + '</div>';
      });

      // Day cells
      days.forEach(function(day) {
        var ds = mgrFmtDate(day);
        var isToday = mgrSameDay(day, today);
        var isPast = day < today;
        var evts = eventsByDate[ds] || [];

        html += '<div class="mgr-bb-day' + (isToday ? ' is-today' : '') + (isPast ? ' is-past' : '') + '" data-date="' + ds + '" onclick="mgrOpenDayPanel(\'' + ds + '\')';
        html += '">';
        html += '<div class="mgr-bb-daynum">' + day.getDate() + ' <span class="mgr-bb-dayname">' + day.toLocaleDateString('en-US', { month: 'short' }) + '</span></div>';

        if (evts.length === 0) {
          html += '<div class="mgr-bb-empty-day">No events</div>';
        } else {
          evts.forEach(function(evt) {
            var cls = 'mgr-bb-pin ' + evt.type;
            if (evt.status === 'completed') cls += ' completed';
            html += '<div class="' + cls + '">';
            html += '<span class="mgr-bb-pin-icon">' + evt.icon + '</span>';
            html += '<span class="mgr-bb-pin-text">' + evt.text + '</span>';
            if (evt.status === 'completed') html += '<span style="margin-left:auto;font-size:9px;">\u2705</span>';
            html += '</div>';
          });
        }

        html += '</div>';
      });

      html += '</div>'; // close board

      // Quick-add buttons (manager only)
      html += '<div class="mgr-bb-add-row mgr-only">';
      html += '<button class="mgr-bb-add-btn" onclick="mgrBBQuickAdd(\'meeting\')">+ Meeting</button>';
      html += '<button class="mgr-bb-add-btn" onclick="mgrBBQuickAdd(\'oneonone\')">+ 1-on-1</button>';
      html += '<button class="mgr-bb-add-btn" onclick="mgrBBQuickAdd(\'ridealong\')">+ Ride-Along</button>';
      html += '</div>';

      container.innerHTML = html;
    }

    // Quick-add modal for bulletin board
    function mgrBBQuickAdd(type) {
      var old = document.getElementById('mgrBBAddModal');
      if (old) old.remove();
      var techOpts = techs.map(function(t) { return '<option value="' + t.short + '">' + t.name + '</option>'; }).join('');
      var todayStr = mgrFmtDate(mgrToday());

      var title, fields;
      if (type === 'meeting') {
        title = 'Post Meeting';
        fields = '<label style="font-size:11px;font-weight:600;color:#fbbf24;margin-top:8px;display:block;">Date</label>' +
          '<input type="date" id="mgrBBDate" value="' + bbGetWednesday() + '" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:13px;">' +
          '<label style="font-size:11px;font-weight:600;color:#fbbf24;margin-top:8px;display:block;">Subject</label>' +
          '<input type="text" id="mgrBBSubject" placeholder="e.g. Superheat & Subcool Review" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:13px;">' +
          '<label style="font-size:11px;font-weight:600;color:#fbbf24;margin-top:8px;display:block;">Time</label>' +
          '<input type="text" id="mgrBBTime" placeholder="e.g. 8:00 AM" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:13px;">';
      } else if (type === 'oneonone') {
        title = 'Add 1-on-1';
        fields = '<label style="font-size:11px;font-weight:600;color:#fbbf24;margin-top:8px;display:block;">Tech</label>' +
          '<select id="mgrBBTech" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:13px;">' + techOpts + '</select>' +
          '<label style="font-size:11px;font-weight:600;color:#fbbf24;margin-top:8px;display:block;">Date</label>' +
          '<input type="date" id="mgrBBDate" value="' + todayStr + '" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:13px;">';
      } else {
        title = 'Add Ride-Along';
        fields = '<label style="font-size:11px;font-weight:600;color:#fbbf24;margin-top:8px;display:block;">Tech</label>' +
          '<select id="mgrBBTech" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:13px;">' + techOpts + '</select>' +
          '<label style="font-size:11px;font-weight:600;color:#fbbf24;margin-top:8px;display:block;">Date</label>' +
          '<input type="date" id="mgrBBDate" value="' + todayStr + '" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:13px;">';
      }

      var modal = document.createElement('div');
      modal.id = 'mgrBBAddModal';
      modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;';
      modal.innerHTML = '<div style="background:#141b2d;border-radius:16px;padding:24px 28px;max-width:380px;width:90%;color:#fff;font-family:var(--font);box-shadow:0 8px 32px rgba(0,0,0,0.5);">' +
        '<div style="font-size:17px;font-weight:700;margin-bottom:12px;">' + title + '</div>' +
        fields +
        '<div style="display:flex;gap:10px;margin-top:16px;">' +
        '<button onclick="mgrBBSubmitQuickAdd(\'' + type + '\')" style="flex:1;padding:10px;border:none;border-radius:8px;background:linear-gradient(135deg,#FFD700,#FFA500);color:#0F1B2E;font-weight:700;font-size:13px;cursor:pointer;">Add</button>' +
        '<button onclick="document.getElementById(\'mgrBBAddModal\').remove()" style="flex:1;padding:10px;border:1px solid rgba(255,255,255,0.2);border-radius:8px;background:transparent;color:#8b93a8;font-weight:600;font-size:13px;cursor:pointer;">Cancel</button>' +
        '</div></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
    }

    function mgrBBSubmitQuickAdd(type) {
      var dateStr = document.getElementById('mgrBBDate').value;
      if (!dateStr) { alert('Please select a date.'); return; }

      var bb = bbLoad();
      if (type === 'meeting') {
        bb.meetings.push({
          id: bbUID(),
          subject: document.getElementById('mgrBBSubject').value || 'Team Meeting',
          date: dateStr,
          time: document.getElementById('mgrBBTime').value || '',
          location: '', notes: '', source: 'mgr'
        });
      } else if (type === 'oneonone') {
        var tech = document.getElementById('mgrBBTech').value;
        bb.oneOnOnes.push({ id: bbUID(), tech: tech, date: dateStr, status: 'planned', time: '', notes: '', source: 'mgr' });
      } else {
        var tech = document.getElementById('mgrBBTech').value;
        bb.rideAlongs.push({ id: bbUID(), tech: tech, date: dateStr, status: 'planned', time: '', notes: '', source: 'mgr' });
      }
      bbSave(bb);

      document.getElementById('mgrBBAddModal').remove();
      renderMgrBulletinBoard();
      renderBulletinBoard(); // sync overview BB
      renderManagerCalendar(); // refresh dots

      // Toast
      var toast = document.createElement('div');
      toast.textContent = '\u2705 Added to Bulletin Board';
      toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#065f46;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.4s;';
      document.body.appendChild(toast);
      setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { toast.remove(); }, 400); }, 2000);
    }

    // ----- Side Panel -----
    function mgrOpenPanel() {
      document.getElementById('mgrOverlay').classList.add('open');
      document.getElementById('mgrPanel').classList.add('open');
      document.getElementById('mgrPanel').setAttribute('aria-hidden', 'false');
    }
    function mgrClosePanel() {
      document.getElementById('mgrOverlay').classList.remove('open');
      document.getElementById('mgrPanel').classList.remove('open');
      document.getElementById('mgrPanel').setAttribute('aria-hidden', 'true');
    }

    let mgrActiveDate = null;

    function mgrOpenDayPanel(dateStr) {
      mgrActiveDate = dateStr;
      const d = mgrParseDate(dateStr);
      document.getElementById('mgrPanelTitle').textContent = mgrFmtDisplay(d);
      const dow = d.getDay();
      let sub = '';
      if (dow === 1 && isNexstarMonday(d)) sub = 'Monday — Nexstar Zoom + Planning & Review';
      else if (dow === 1) sub = 'Monday — Planning, Review & Leadership';
      else if (dow === 2) sub = 'Tuesday — Training Prep day';
      else if (dow === 3) sub = 'Wednesday — Team Meeting day';
      document.getElementById('mgrPanelSub').textContent = sub;
      mgrRenderDayView(dateStr);
      mgrOpenPanel();
    }

    function mgrRenderDayView(dateStr) {
      const d = mgrParseDate(dateStr);
      const dow = d.getDay();
      const dayEntries = mgrState.entries.filter(e => e.date === dateStr);

      let html = `
        <div class="mgr-panel-actions mgr-edit-only">
          <button class="mgr-btn green" onclick="mgrStartForm('one-on-one')">+ 1-on-1</button>
          <button class="mgr-btn" style="background:#3A6BA8" onclick="mgrStartForm('ride-along')">+ Ride-Along</button>
        </div>
      `;

      // --- Daily Duties (every day) ---
      html += `
        <div class="mgr-form-section mgr-daily-duties">
          <div class="mgr-form-section-title" style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">&#128203;</span> Daily Duties
          </div>
          <div class="mgr-checklist">
            <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleDailyDuty('${dateStr}','review_calls',this.checked)" ${mgrGetDailyDuty(dateStr,'review_calls')?'checked':''}><span>Review prior day calls, service & installs (pics, invoices, summaries)</span></label>
            <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleDailyDuty('${dateStr}','clear_cases',this.checked)" ${mgrGetDailyDuty(dateStr,'clear_cases')?'checked':''}><span>Task management on Service Titan (clear cases)</span></label>
            <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleDailyDuty('${dateStr}','daily_huddle',this.checked)" ${mgrGetDailyDuty(dateStr,'daily_huddle')?'checked':''}><span>Daily huddle with HVAC through Slack app</span></label>
            <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleDailyDuty('${dateStr}','update_matrix',this.checked)" ${mgrGetDailyDuty(dateStr,'update_matrix')?'checked':''}><span>Update Matrix</span></label>
          </div>
        </div>
      `;

      // --- Nexstar Zoom Meeting (biweekly Mondays) ---
      if (dow === 1 && isNexstarMonday(d)) {
        var nx = mgrGetNexstarData(dateStr);
        html += `
          <div class="mgr-form-section mgr-nexstar-block">
            <div class="mgr-form-section-title" style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:16px;">&#127909;</span> Nexstar Zoom Meeting — 8:00 AM
            </div>
            <div style="font-size:13px; color:var(--text-secondary); margin-top:4px; margin-bottom:10px; line-height:1.5;">
              <strong style="color:var(--text-primary);">Coaches:</strong> Jay & Greg &nbsp;&bull;&nbsp; Every other Monday
            </div>
            <div class="mgr-checklist">
              <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleNexstar('${dateStr}','joined_call',this.checked)" ${nx.joined_call?'checked':''}><span>Joined Zoom call</span></label>
              <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleNexstar('${dateStr}','reviewed_action_items',this.checked)" ${nx.reviewed_action_items?'checked':''}><span>Reviewed action items from last session</span></label>
              <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleNexstar('${dateStr}','shared_updates',this.checked)" ${nx.shared_updates?'checked':''}><span>Shared team updates with coaches</span></label>
              <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleNexstar('${dateStr}','new_action_items',this.checked)" ${nx.new_action_items?'checked':''}><span>Captured new action items / takeaways</span></label>
            </div>
            <div style="margin-top:12px;">
              <div style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:6px;">Meeting Notes</div>
              <textarea class="mgr-day-notes mgr-nexstar-notes" placeholder="Key discussion points, coaching feedback, action items..." oninput="mgrSaveNexstarNote('${dateStr}',this.value)">${mgrEscape(nx.notes||'')}</textarea>
            </div>
          </div>
        `;
      }

      // --- Monday: Planning, Review & Leadership ---
      if (dow === 1) {
        html += `
          <div class="mgr-form-section mgr-monday-block">
            <div class="mgr-form-section-title" style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:16px;">&#128197;</span> Monday — Planning, Review & Leadership
            </div>
            <div class="mgr-checklist">
              <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleDailyDuty('${dateStr}','mon_employee_review',this.checked)" ${mgrGetDailyDuty(dateStr,'mon_employee_review')?'checked':''}><span>Employee Review #1 for the week</span></label>
              <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleDailyDuty('${dateStr}','mon_leadership_mtg',this.checked)" ${mgrGetDailyDuty(dateStr,'mon_leadership_mtg')?'checked':''}><span>10:00 AM Leadership Meeting</span></label>
              <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleDailyDuty('${dateStr}','mon_prior_week',this.checked)" ${mgrGetDailyDuty(dateStr,'mon_prior_week')?'checked':''}><span>Review prior week performance (callbacks, documentation, issues)</span></label>
              <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleDailyDuty('${dateStr}','mon_weekend_calls',this.checked)" ${mgrGetDailyDuty(dateStr,'mon_weekend_calls')?'checked':''}><span>Review weekend service calls and identify action items</span></label>
              <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleDailyDuty('${dateStr}','mon_training_plan',this.checked)" ${mgrGetDailyDuty(dateStr,'mon_training_plan')?'checked':''}><span>Build weekly training plan</span></label>
              <label class="mgr-check-item"><input type="checkbox" onchange="mgrToggleDailyDuty('${dateStr}','mon_invoice_review',this.checked)" ${mgrGetDailyDuty(dateStr,'mon_invoice_review')?'checked':''}><span>Invoice review from previous day/weekend service and install</span></label>
            </div>
          </div>
        `;
      }

      if (dow === 2) {
        const weekOf = mgrFmtDate(mgrStartOfWeek(d));
        const existing = mgrState.trainings.find(t => t.weekOf === weekOf);
        html += `
          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Tuesday — Training Prep</div>
            <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
              Prepare this week's team training (for Wednesday meeting).
            </div>
            ${existing ? `<div class="mgr-entry-card" onclick="mgrGoTrainingTab()">
              <div class="mgr-entry-head">
                <span class="mgr-entry-type training">Training</span>
                <span class="mgr-entry-status completed">Prepared</span>
              </div>
              <div class="mgr-entry-tech">${existing.topic || 'Untitled topic'}</div>
              <div class="mgr-entry-summary">Week of ${mgrFmtShort(mgrParseDate(existing.weekOf))}</div>
            </div>` : `<button class="mgr-btn gold" onclick="mgrGoTrainingTab()">Open Training Planner →</button>`}
          </div>
        `;
      }

      if (dow === 3) {
        const weekOf = mgrFmtDate(mgrStartOfWeek(d));
        const training = mgrState.trainings.find(t => t.weekOf === weekOf);
        html += `
          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Wednesday — Team Meeting</div>
            ${training ? `
              <div class="mgr-info"><strong>This week's training:</strong> ${training.topic || '(no topic set)'}</div>
              <div class="mgr-form-row">
                <label class="mgr-form-label">Attendance</label>
                <div class="mgr-check-list">
                  ${Object.keys(skillsData.assignments).map(t => `
                    <label class="mgr-check">
                      <input type="checkbox" ${(training.attendance||[]).includes(t) ? 'checked' : ''} onchange="mgrToggleAttendance('${training.id}','${t}', this.checked)">
                      <span>${t}</span>
                    </label>
                  `).join('')}
                </div>
              </div>
              <div class="mgr-form-row">
                <label class="mgr-form-label">Meeting Notes</label>
                <textarea class="mgr-textarea" rows="3" id="mgrMeetingNotes">${training.meetingNotes || ''}</textarea>
              </div>
              <div class="mgr-form-row">
                <label class="mgr-form-label">Action Items from Meeting</label>
                <textarea class="mgr-textarea" rows="3" id="mgrMeetingActions">${training.meetingActions || ''}</textarea>
              </div>
              <button class="mgr-btn" onclick="mgrSaveMeetingNotes('${training.id}')">Save Meeting Notes</button>
            ` : `<div class="mgr-warning">No training prepared for this week yet. Use the Training Planner tab to prepare Tuesday's topic.</div>
              <button class="mgr-btn gold" onclick="mgrGoTrainingTab()">Open Training Planner →</button>`}
          </div>
        `;
      }

      if (dayEntries.length) {
        html += `<div class="mgr-form-section">
          <div class="mgr-form-section-title">Entries on this day (${dayEntries.length})</div>`;
        dayEntries.forEach(e => {
          const typeLabel = e.type === 'one-on-one' ? '1-on-1' : 'Ride-Along';
          const summary = e.data.coveredSummary || e.data.debriefManagerBetter || e.data.customFocus || 'No summary yet';
          html += `<div class="mgr-entry-card" onclick="mgrEditEntry('${e.id}')">
            <div class="mgr-entry-head">
              <span class="mgr-entry-type ${e.type}">${typeLabel}</span>
              <span class="mgr-entry-status ${e.status}">${e.status}</span>
            </div>
            <div class="mgr-entry-tech"><span class="mgr-log-tech-dot" style="background:${MGR_TECH_COLORS[e.tech]||'#888'}"></span>${e.tech}</div>
            <div class="mgr-entry-summary">${mgrEscape(summary.slice(0, 90))}${summary.length > 90 ? '…' : ''}</div>
          </div>`;
        });
        html += `</div>`;
      } else {
        html += `<div class="mgr-form-section">
          <div style="font-size:12px; color:var(--text-muted);">No coaching entries yet for this day. Use the buttons above to add one.</div>
        </div>`;
      }

      // --- Notes section (bottom of day panel) ---
      var dayNotes = mgrGetDayNote(dateStr);
      html += `
        <div class="mgr-form-section mgr-notes-block">
          <div class="mgr-form-section-title" style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">&#128221;</span> Notes & Ideas
          </div>
          <textarea class="mgr-day-notes" id="mgrDayNotes" placeholder="Jot down ideas, reminders, or info for this day..." oninput="mgrSaveDayNote('${dateStr}',this.value)">${mgrEscape(dayNotes)}</textarea>
        </div>
      `;

      document.getElementById('mgrPanelBody').innerHTML = html;
    }

    function mgrEscape(s) {
      if (s == null) return '';
      return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    }

    function mgrGoTrainingTab() {
      mgrClosePanel();
      // switch to training sub-tab
      document.querySelectorAll('#mgr-sub-tabs .nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.mgr-section').forEach(s => s.classList.remove('active'));
      document.querySelector('#mgr-sub-tabs [data-mgr="training"]').classList.add('active');
      document.getElementById('mgr-training').classList.add('active');
    }

    // ----- Forms -----
    let mgrEditingId = null;

    function mgrStartForm(type, existingId) {
      mgrEditingId = existingId || null;
      const existing = existingId ? mgrState.entries.find(e => e.id === existingId) : null;
      const dateStr = existing ? existing.date : mgrActiveDate;
      const d = mgrParseDate(dateStr);
      document.getElementById('mgrPanelTitle').textContent = (existingId ? 'Edit ' : 'New ') + (type === 'one-on-one' ? '1-on-1' : 'Ride-Along');
      document.getElementById('mgrPanelSub').textContent = mgrFmtDisplay(d);

      if (type === 'one-on-one') {
        mgrRenderOneOnOneForm(existing, dateStr);
      } else {
        mgrRenderRideAlongForm(existing, dateStr);
      }
    }

    function mgrRenderOneOnOneForm(existing, dateStr) {
      const data = existing ? existing.data : {};
      const tech = existing ? existing.tech : Object.keys(skillsData.assignments)[0];
      const status = existing ? existing.status : 'planned';
      const techNames = Object.keys(skillsData.assignments);

      const housekeeping = data.housekeeping || {};
      const redBarn = data.redBarn || {};

      const html = `
        <form id="mgrOneOnOneForm" onsubmit="return mgrSubmitOneOnOne(event, '${existing ? existing.id : ''}', '${dateStr}');">
          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Session Details</div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Tech</label>
              <select class="mgr-select" id="f_tech" onchange="mgrUpdateFocusSuggest()">
                ${techNames.map(t => `<option value="${t}" ${t===tech?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Status</label>
              <div class="mgr-radio-group">
                <label class="mgr-radio"><input type="radio" name="f_status" value="planned" ${status==='planned'?'checked':''}> Planned</label>
                <label class="mgr-radio"><input type="radio" name="f_status" value="completed" ${status==='completed'?'checked':''}> Completed</label>
              </div>
            </div>
          </div>

          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Housekeeping (Always First)</div>
            <div class="mgr-check-list">
              ${MGR_HOUSEKEEPING_ITEMS.map(h => `
                <label class="mgr-check">
                  <input type="checkbox" data-hk="${h.key}" ${housekeeping[h.key]?'checked':''}>
                  <span>${h.label}</span>
                </label>
              `).join('')}
            </div>
            <div class="mgr-form-row" style="margin-top:10px;">
              <label class="mgr-form-label">Housekeeping Notes</label>
              <textarea class="mgr-textarea" id="f_hkNotes" rows="2">${mgrEscape(data.housekeepingNotes||'')}</textarea>
            </div>
          </div>

          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Focus Area</div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Suggested Focus (from dev priorities)</label>
              <div id="f_suggestFocus"></div>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Custom Focus / Notes</label>
              <textarea class="mgr-textarea" id="f_customFocus" rows="3">${mgrEscape(data.customFocus||'')}</textarea>
            </div>
          </div>

          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Red Barn Training (Optional)</div>
            <label class="mgr-check">
              <input type="checkbox" id="f_redBarn" ${redBarn.include?'checked':''}>
              <span>Include Red Barn simulator session</span>
            </label>
            <div class="mgr-form-row" style="margin-top:8px;">
              <label class="mgr-form-label">Scenario</label>
              <input type="text" class="mgr-input" id="f_rbScenario" value="${mgrEscape(redBarn.scenario||'')}">
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Outcome</label>
              <textarea class="mgr-textarea" id="f_rbOutcome" rows="2">${mgrEscape(redBarn.outcome||'')}</textarea>
            </div>
          </div>

          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Summary</div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">What was covered</label>
              <textarea class="mgr-textarea" id="f_coveredSummary" rows="3">${mgrEscape(data.coveredSummary||'')}</textarea>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Action items</label>
              <textarea class="mgr-textarea" id="f_actionItems" rows="2">${mgrEscape(data.actionItems||'')}</textarea>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Follow-up date</label>
              <input type="date" class="mgr-input" id="f_followUp" value="${mgrEscape(data.followUp||'')}">
            </div>
          </div>

          <div class="mgr-panel-actions" style="margin-top:18px;">
            <button type="submit" class="mgr-btn">Save</button>
            <button type="button" class="mgr-btn secondary" onclick="mgrRenderDayView('${dateStr}')">Cancel</button>
            ${existing ? `<button type="button" class="mgr-btn danger" onclick="mgrDeleteEntry('${existing.id}')">Delete</button>` : ''}
          </div>
        </form>
      `;
      document.getElementById('mgrPanelBody').innerHTML = html;
      mgrUpdateFocusSuggest();
    }

    function mgrUpdateFocusSuggest() {
      const tech = document.getElementById('f_tech').value;
      const dp = skillsData.devPriorities[tech];
      if (!dp) {
        document.getElementById('f_suggestFocus').innerHTML = '<div style="font-size:12px;color:var(--text-muted);">No priorities on file</div>';
        return;
      }
      const skillLookup = {};
      Object.keys(skillsData.categories).forEach(k => {
        skillsData.categories[k].skills.forEach(s => { skillLookup[s.id] = s.name; });
      });
      const pills = (dp.next || []).map(id => {
        const clean = String(id).split(' ')[0];
        const name = skillLookup[clean];
        return `<span class="mgr-skill-pill">${clean}${name?' — '+name:''}</span>`;
      }).join('');
      document.getElementById('f_suggestFocus').innerHTML = `
        <div class="mgr-suggested-skills">${pills}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:8px;line-height:1.5;"><strong>Action plan:</strong> ${mgrEscape(dp.action||'')}</div>
      `;
    }

    function mgrSubmitOneOnOne(ev, existingId, dateStr) {
      ev.preventDefault();
      const housekeeping = {};
      document.querySelectorAll('#mgrOneOnOneForm [data-hk]').forEach(cb => {
        housekeeping[cb.dataset.hk] = cb.checked;
      });
      const data = {
        housekeeping,
        housekeepingNotes: document.getElementById('f_hkNotes').value,
        customFocus: document.getElementById('f_customFocus').value,
        redBarn: {
          include: document.getElementById('f_redBarn').checked,
          scenario: document.getElementById('f_rbScenario').value,
          outcome: document.getElementById('f_rbOutcome').value
        },
        coveredSummary: document.getElementById('f_coveredSummary').value,
        actionItems: document.getElementById('f_actionItems').value,
        followUp: document.getElementById('f_followUp').value
      };
      const status = document.querySelector('#mgrOneOnOneForm input[name="f_status"]:checked').value;
      const tech = document.getElementById('f_tech').value;

      var isNew = !existingId;
      if (existingId) {
        const idx = mgrState.entries.findIndex(e => e.id === existingId);
        if (idx >= 0) {
          mgrState.entries[idx] = { ...mgrState.entries[idx], tech, status, data, updatedAt: Date.now() };
        }
        // Update bulletin board entry if editing
        var bbOOEdit = bbLoad();
        var ooIdx = bbOOEdit.oneOnOnes.findIndex(function(o) { return o.id === existingId; });
        if (ooIdx >= 0) {
          bbOOEdit.oneOnOnes[ooIdx].tech = tech;
          bbOOEdit.oneOnOnes[ooIdx].status = status;
          bbOOEdit.oneOnOnes[ooIdx].notes = data.customFocus || '';
          bbSave(bbOOEdit);
        }
      } else {
        var newOOId = mgrUID();
        mgrState.entries.push({
          id: newOOId,
          type: 'one-on-one',
          tech, date: dateStr, status, data,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      }
      mgrSave();
      renderManagerTab();
      renderBulletinBoard();
      mgrOpenDayPanel(dateStr);

      // Show bulletin board prompt for new entries
      if (isNew) {
        _showBBPromptModal('one-on-one', tech, dateStr, status, data.customFocus || '', newOOId);
      }
      return false;
    }

    // Ride-along form
    function mgrRenderRideAlongForm(existing, dateStr) {
      const data = existing ? existing.data : {};
      const tech = existing ? existing.tech : Object.keys(skillsData.assignments)[0];
      const status = existing ? existing.status : 'planned';
      const techNames = Object.keys(skillsData.assignments);
      const calls = data.calls && data.calls.length ? data.calls : [''];
      const obs = data.observations || {};

      const html = `
        <form id="mgrRideAlongForm" onsubmit="return mgrSubmitRideAlong(event, '${existing ? existing.id : ''}', '${dateStr}');">
          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Session Details</div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Tech</label>
              <select class="mgr-select" id="r_tech" onchange="mgrUpdateRideSuggest()">
                ${techNames.map(t => `<option value="${t}" ${t===tech?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Status</label>
              <div class="mgr-radio-group">
                <label class="mgr-radio"><input type="radio" name="r_status" value="planned" ${status==='planned'?'checked':''}> Planned</label>
                <label class="mgr-radio"><input type="radio" name="r_status" value="completed" ${status==='completed'?'checked':''}> Completed</label>
              </div>
            </div>
          </div>

          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Observation Mode</div>
            <div class="mgr-warning">⚠️ Observe only — no on-site corrections unless safety or critical issue. Debrief after.</div>
            <label class="mgr-check">
              <input type="checkbox" id="r_ackObs" ${data.ackObservation?'checked':''}>
              <span>I acknowledge the observation protocol</span>
            </label>
          </div>

          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Calls Observed</div>
            <div id="r_callsList">
              ${calls.map((c, i) => `
                <div class="mgr-call-item">
                  <span style="font-size:11px; font-weight:700; color:var(--text-muted); width:40px;">Call ${i+1}</span>
                  <input type="text" class="mgr-input" placeholder="Address / call type" value="${mgrEscape(c)}">
                  <button type="button" class="mgr-call-remove" onclick="this.parentElement.remove()">&times;</button>
                </div>
              `).join('')}
            </div>
            <button type="button" class="mgr-btn secondary sm" onclick="mgrAddCallRow()">+ Add another call</button>
          </div>

          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Summary of Call — Actual Diagnostic Summary</div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Customer issue / symptom reported</label>
              <textarea class="mgr-textarea" id="r_custIssue" rows="2" placeholder="What the customer described...">${mgrEscape(data.custIssue||'')}</textarea>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Actual diagnosis / root cause found</label>
              <textarea class="mgr-textarea" id="r_actualDiag" rows="3" placeholder="What the tech found — equipment, fault, measurements, readings...">${mgrEscape(data.actualDiagnosis||'')}</textarea>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Repair performed / options presented</label>
              <textarea class="mgr-textarea" id="r_repairDone" rows="2" placeholder="What was repaired or recommended...">${mgrEscape(data.repairPerformed||'')}</textarea>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Outcome (sold, declined, follow-up needed)</label>
              <input type="text" class="mgr-input" id="r_outcome" placeholder="e.g. Repair sold $850, customer declined replacement option" value="${mgrEscape(data.callOutcome||'')}">
            </div>
          </div>

          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Post-Ride Debrief</div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">What could be better (Manager perspective)</label>
              <textarea class="mgr-textarea" id="r_mBetter" rows="3">${mgrEscape(data.debriefManagerBetter||'')}</textarea>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">What could be better (Tech's perspective)</label>
              <textarea class="mgr-textarea" id="r_tBetter" rows="3">${mgrEscape(data.debriefTechBetter||'')}</textarea>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">What would a WIN have looked like (Manager)</label>
              <textarea class="mgr-textarea" id="r_mWin" rows="3">${mgrEscape(data.debriefManagerWin||'')}</textarea>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">What would a WIN have looked like (Tech)</label>
              <textarea class="mgr-textarea" id="r_tWin" rows="3">${mgrEscape(data.debriefTechWin||'')}</textarea>
            </div>
          </div>

          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Key Observations</div>
            <div class="mgr-check-list">
              ${MGR_OBSERVATION_ITEMS.map(o => `
                <label class="mgr-check">
                  <input type="checkbox" data-obs="${o.key}" ${obs[o.key]?'checked':''}>
                  <span>${o.label}</span>
                </label>
              `).join('')}
            </div>
            <div class="mgr-form-row" style="margin-top:10px;">
              <label class="mgr-form-label">Observation Notes</label>
              <textarea class="mgr-textarea" id="r_obsNotes" rows="2">${mgrEscape(data.observationNotes||'')}</textarea>
            </div>
          </div>

          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Action Items</div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Suggested Skills to Work On</label>
              <div id="r_suggestSkills"></div>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Next Steps</label>
              <textarea class="mgr-textarea" id="r_nextSteps" rows="3">${mgrEscape(data.nextSteps||'')}</textarea>
            </div>
          </div>

          <div class="mgr-panel-actions" style="margin-top:18px;">
            <button type="submit" class="mgr-btn">Save</button>
            <button type="button" class="mgr-btn secondary" onclick="mgrRenderDayView('${dateStr}')">Cancel</button>
            ${existing ? `<button type="button" class="mgr-btn danger" onclick="mgrDeleteEntry('${existing.id}')">Delete</button>` : ''}
          </div>
        </form>
      `;
      document.getElementById('mgrPanelBody').innerHTML = html;
      mgrUpdateRideSuggest();
    }

    function mgrAddCallRow() {
      const list = document.getElementById('r_callsList');
      const idx = list.children.length + 1;
      const div = document.createElement('div');
      div.className = 'mgr-call-item';
      div.innerHTML = `
        <span style="font-size:11px; font-weight:700; color:var(--text-muted); width:40px;">Call ${idx}</span>
        <input type="text" class="mgr-input" placeholder="Address / call type">
        <button type="button" class="mgr-call-remove" onclick="this.parentElement.remove()">&times;</button>
      `;
      list.appendChild(div);
    }

    function mgrUpdateRideSuggest() {
      const tech = document.getElementById('r_tech').value;
      const dp = skillsData.devPriorities[tech];
      const skillLookup = {};
      Object.keys(skillsData.categories).forEach(k => {
        skillsData.categories[k].skills.forEach(s => { skillLookup[s.id] = s.name; });
      });
      // combine devPriorities with missing NSS skills (rides often evaluate NSS)
      const missingNss = ['H1','H2','H3','H4','H5'].filter(id => !skillsData.assignments[tech].includes(id));
      const set = new Set();
      (dp?.next || []).forEach(id => set.add(String(id).split(' ')[0]));
      missingNss.forEach(id => set.add(id));
      const pills = Array.from(set).map(id => {
        const name = skillLookup[id];
        return `<span class="mgr-skill-pill">${id}${name?' — '+name:''}</span>`;
      }).join('');
      document.getElementById('r_suggestSkills').innerHTML = pills ?
        `<div class="mgr-suggested-skills">${pills}</div>` :
        `<div style="font-size:12px;color:var(--text-muted);">No gaps flagged</div>`;
    }

    function mgrSubmitRideAlong(ev, existingId, dateStr) {
      ev.preventDefault();
      const calls = Array.from(document.querySelectorAll('#r_callsList .mgr-call-item input')).map(i => i.value).filter(v => v.trim());
      const observations = {};
      document.querySelectorAll('#mgrRideAlongForm [data-obs]').forEach(cb => {
        observations[cb.dataset.obs] = cb.checked;
      });
      const data = {
        ackObservation: document.getElementById('r_ackObs').checked,
        calls,
        custIssue: document.getElementById('r_custIssue').value,
        actualDiagnosis: document.getElementById('r_actualDiag').value,
        repairPerformed: document.getElementById('r_repairDone').value,
        callOutcome: document.getElementById('r_outcome').value,
        debriefManagerBetter: document.getElementById('r_mBetter').value,
        debriefTechBetter: document.getElementById('r_tBetter').value,
        debriefManagerWin: document.getElementById('r_mWin').value,
        debriefTechWin: document.getElementById('r_tWin').value,
        observations,
        observationNotes: document.getElementById('r_obsNotes').value,
        nextSteps: document.getElementById('r_nextSteps').value
      };
      const status = document.querySelector('#mgrRideAlongForm input[name="r_status"]:checked').value;
      const tech = document.getElementById('r_tech').value;

      var isNew = !existingId;
      if (existingId) {
        const idx = mgrState.entries.findIndex(e => e.id === existingId);
        if (idx >= 0) {
          mgrState.entries[idx] = { ...mgrState.entries[idx], tech, status, data, updatedAt: Date.now() };
        }
        // Update bulletin board entry if editing
        var bbRAEdit = bbLoad();
        var raIdx = bbRAEdit.rideAlongs.findIndex(function(r) { return r.id === existingId; });
        if (raIdx >= 0) {
          bbRAEdit.rideAlongs[raIdx].tech = tech;
          bbRAEdit.rideAlongs[raIdx].status = status;
          bbRAEdit.rideAlongs[raIdx].notes = data.observationNotes || '';
          bbSave(bbRAEdit);
        }
      } else {
        var newRAId = mgrUID();
        mgrState.entries.push({
          id: newRAId,
          type: 'ride-along',
          tech, date: dateStr, status, data,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      }
      mgrSave();
      renderManagerTab();
      renderBulletinBoard();
      mgrOpenDayPanel(dateStr);

      // Show bulletin board prompt for new entries
      if (isNew) {
        _showBBPromptModal('ride-along', tech, dateStr, status, data.observationNotes || '', newRAId);
      }
      return false;
    }

    function mgrEditEntry(id) {
      const e = mgrState.entries.find(x => x.id === id);
      if (!e) return;
      mgrActiveDate = e.date;
      mgrStartForm(e.type, id);
    }

    function mgrDeleteEntry(id) {
      if (!confirm('Delete this entry? This cannot be undone.')) return;
      const e = mgrState.entries.find(x => x.id === id);
      const dateStr = e ? e.date : mgrActiveDate;
      mgrState.entries = mgrState.entries.filter(x => x.id !== id);
      mgrSave();
      // Also remove from bulletin board if synced
      var bb = bbLoad();
      var changed = false;
      if (e && e.type === 'one-on-one') {
        var before = bb.oneOnOnes.length;
        bb.oneOnOnes = bb.oneOnOnes.filter(function(o) { return o.id !== id; });
        if (bb.oneOnOnes.length < before) changed = true;
      } else if (e && e.type === 'ride-along') {
        var before2 = bb.rideAlongs.length;
        bb.rideAlongs = bb.rideAlongs.filter(function(r) { return r.id !== id; });
        if (bb.rideAlongs.length < before2) changed = true;
      }
      if (changed) { bbSave(bb); renderBulletinBoard(); }
      renderManagerTab();
      if (dateStr) mgrOpenDayPanel(dateStr);
    }

    // ----- Session Log -----
    function renderManagerLog() {
      // Populate filters
      const techSel = document.getElementById('mgrLogTech');
      const curTech = techSel.value;
      techSel.innerHTML = '<option value="">All Techs</option>' +
        Object.keys(skillsData.assignments).map(t => `<option value="${t}" ${t===curTech?'selected':''}>${t}</option>`).join('');

      const filtTech = document.getElementById('mgrLogTech').value;
      const filtType = document.getElementById('mgrLogType').value;
      const filtStatus = document.getElementById('mgrLogStatus').value;

      const filtered = mgrState.entries
        .filter(e => !filtTech || e.tech === filtTech)
        .filter(e => !filtType || e.type === filtType)
        .filter(e => !filtStatus || e.status === filtStatus)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      if (!filtered.length) {
        document.getElementById('mgrLogTableWrap').innerHTML = `<div class="mgr-log-empty">No coaching entries yet. Click any day on the calendar to add one.</div>`;
        return;
      }

      // Check which entries are already on the bulletin board
      var bb = bbLoad();
      var bbOOIds = {};
      bb.oneOnOnes.forEach(function(o) { bbOOIds[o.id] = true; });
      var bbRAIds = {};
      bb.rideAlongs.forEach(function(r) { bbRAIds[r.id] = true; });

      let html = `<table class="mgr-log-table">
        <thead><tr>
          <th>Date</th><th>Type</th><th>Tech</th><th>Status</th><th>Summary</th><th class="mgr-only" style="width:40px;"></th>
        </tr></thead><tbody>`;
      filtered.forEach(e => {
        const d = mgrParseDate(e.date);
        const typeLabel = e.type === 'one-on-one' ? '1-on-1' : 'Ride-Along';
        const summary = e.data.coveredSummary || e.data.actualDiagnosis || e.data.debriefManagerBetter || e.data.customFocus || e.data.nextSteps || '—';
        const isOnBB = (e.type === 'one-on-one' && bbOOIds[e.id]) || (e.type === 'ride-along' && bbRAIds[e.id]);
        const bbBtn = isOnBB
          ? `<span title="On Bulletin Board" style="color:#4CAF50;font-size:16px;cursor:default;">\u2705</span>`
          : `<button class="mgr-bb-add-btn mgr-only" title="Add to Bulletin Board" onclick="event.stopPropagation(); _logAddToBB('${e.id}')" style="background:none;border:1px solid rgba(255,215,0,0.4);border-radius:6px;padding:3px 8px;font-size:11px;color:#fbbf24;cursor:pointer;white-space:nowrap;">+ BB</button>`;
        html += `<tr class="mgr-log-row" data-id="${e.id}">
          <td>${mgrFmtShort(d)} ${d.getFullYear()}</td>
          <td><span class="mgr-entry-type ${e.type}">${typeLabel}</span></td>
          <td><span class="mgr-log-tech-dot" style="background:${MGR_TECH_COLORS[e.tech]||'#888'}"></span>${e.tech}</td>
          <td><span class="mgr-entry-status ${e.status}">${e.status}</span></td>
          <td style="max-width:400px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${mgrEscape(summary.slice(0,140))}</td>
          <td class="mgr-only" style="text-align:center;">${bbBtn}</td>
        </tr>
        <tr class="mgr-log-detail" data-detail="${e.id}" style="display:none;"><td colspan="6" class="mgr-log-expanded">${mgrFormatEntryDetail(e)}</td></tr>`;
      });
      html += `</tbody></table>`;
      document.getElementById('mgrLogTableWrap').innerHTML = html;

      document.querySelectorAll('.mgr-log-row').forEach(row => {
        row.addEventListener('click', () => {
          const id = row.dataset.id;
          const detail = document.querySelector(`[data-detail="${id}"]`);
          if (detail) detail.style.display = detail.style.display === 'none' ? 'table-row' : 'none';
        });
      });
    }

    function _logAddToBB(entryId) {
      var entry = mgrState.entries.find(function(e) { return e.id === entryId; });
      if (!entry) { alert('Entry not found.'); return; }
      var notes = '';
      if (entry.type === 'one-on-one') {
        notes = entry.data.customFocus || entry.data.coveredSummary || '';
      } else {
        notes = entry.data.observationNotes || entry.data.debriefManagerBetter || '';
      }
      _showBBPromptModal(entry.type, entry.tech, entry.date, entry.status, notes, entry.id);
    }

    function mgrFormatEntryDetail(e) {
      const d = e.data || {};
      let html = '';
      if (e.type === 'one-on-one') {
        const hk = d.housekeeping || {};
        const hkDone = MGR_HOUSEKEEPING_ITEMS.filter(i => hk[i.key]).map(i => i.label).join(', ') || '—';
        html += `<h5>Housekeeping Complete</h5><div>${mgrEscape(hkDone)}</div>`;
        if (d.housekeepingNotes) html += `<div style="margin-top:4px;">Notes: ${mgrEscape(d.housekeepingNotes)}</div>`;
        if (d.customFocus) html += `<h5>Focus</h5><div>${mgrEscape(d.customFocus)}</div>`;
        if (d.redBarn?.include) html += `<h5>Red Barn</h5><div><strong>${mgrEscape(d.redBarn.scenario||'')}</strong> — ${mgrEscape(d.redBarn.outcome||'')}</div>`;
        if (d.coveredSummary) html += `<h5>Summary</h5><div>${mgrEscape(d.coveredSummary)}</div>`;
        if (d.actionItems) html += `<h5>Action Items</h5><div>${mgrEscape(d.actionItems)}</div>`;
        if (d.followUp) html += `<h5>Follow-up</h5><div>${mgrEscape(d.followUp)}</div>`;
      } else {
        if (d.calls?.length) html += `<h5>Calls Observed</h5><div>${d.calls.map(c => mgrEscape(c)).join(' · ')}</div>`;
        if (d.custIssue || d.actualDiagnosis || d.repairPerformed || d.callOutcome) {
          html += `<h5>Diagnostic Summary</h5>`;
          if (d.custIssue) html += `<div><strong>Customer issue:</strong> ${mgrEscape(d.custIssue)}</div>`;
          if (d.actualDiagnosis) html += `<div><strong>Actual diagnosis:</strong> ${mgrEscape(d.actualDiagnosis)}</div>`;
          if (d.repairPerformed) html += `<div><strong>Repair/options:</strong> ${mgrEscape(d.repairPerformed)}</div>`;
          if (d.callOutcome) html += `<div><strong>Outcome:</strong> ${mgrEscape(d.callOutcome)}</div>`;
        }
        const obs = d.observations || {};
        const obsDone = MGR_OBSERVATION_ITEMS.filter(i => obs[i.key]).map(i => i.label).join(', ') || '—';
        html += `<h5>Key Observations Seen</h5><div>${mgrEscape(obsDone)}</div>`;
        if (d.debriefManagerBetter) html += `<h5>Could be better (Manager)</h5><div>${mgrEscape(d.debriefManagerBetter)}</div>`;
        if (d.debriefTechBetter) html += `<h5>Could be better (Tech)</h5><div>${mgrEscape(d.debriefTechBetter)}</div>`;
        if (d.debriefManagerWin) html += `<h5>WIN (Manager view)</h5><div>${mgrEscape(d.debriefManagerWin)}</div>`;
        if (d.debriefTechWin) html += `<h5>WIN (Tech view)</h5><div>${mgrEscape(d.debriefTechWin)}</div>`;
        if (d.nextSteps) html += `<h5>Next Steps</h5><div>${mgrEscape(d.nextSteps)}</div>`;
      }
      html += `<div style="margin-top:10px;"><button class="mgr-btn sm secondary" onclick="mgrEditEntry('${e.id}')">Edit</button> <button class="mgr-btn sm danger" onclick="mgrDeleteEntry('${e.id}')">Delete</button></div>`;
      return html;
    }

    // ----- Training Planner -----
    function renderManagerTraining() {
      const s = mgrGetSuggestedTraining();
      const covList = mgrGetCategoryCoverage().slice(0, 4);
      const skillLookup = {};
      Object.keys(skillsData.categories).forEach(k => {
        skillsData.categories[k].skills.forEach(sk => { skillLookup[sk.id] = sk.name; });
      });

      const suggestHtml = `
        <div class="mgr-suggest-topic">${mgrEscape(s.topic)}</div>
        <div class="mgr-suggest-rationale">${mgrEscape(s.rationale)}</div>
        <div style="margin:12px 0;">
          ${covList.map((c, i) => `<div class="mgr-suggest-stat"><strong>${c.name}</strong> — ${c.pct}% team coverage${i===0?' (lowest)':''}</div>`).join('')}
        </div>
        ${s.commonPriorities.length ? `<div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;"><strong style="color:var(--text-primary);">Common dev priorities:</strong></div>
          <div class="mgr-suggested-skills">${s.commonPriorities.map(id => `<span class="mgr-skill-pill">${id}${skillLookup[id]?' — '+skillLookup[id]:''}</span>`).join('')}</div>` : ''}
        ${s.affectedTechs.length ? `<div style="font-size:12px; color:var(--text-muted); margin-top:10px;"><strong style="color:var(--text-primary);">Most affected:</strong> ${s.affectedTechs.join(', ')}</div>` : ''}
        <div style="margin-top:14px;">
          <button class="mgr-btn gold sm" onclick="mgrAdoptSuggestion()">Use this as this week's topic →</button>
        </div>
      `;
      document.getElementById('mgrSuggestBlock').innerHTML = suggestHtml;

      // Training builder
      if (!window._mgrTrainingWeekOf) {
        window._mgrTrainingWeekOf = mgrFmtDate(mgrStartOfWeek(mgrToday()));
      }
      const weekOf = window._mgrTrainingWeekOf;
      const existing = mgrState.trainings.find(t => t.weekOf === weekOf) || { weekOf, topic: '', outline: { duration: '30min', keyPoints: ['','',''], materials: '', redBarn: false, redBarnScenario: '' }, moment: { hook: '', example: '', takeaway: '' }, attendance: [] };

      const keyPoints = (existing.outline && existing.outline.keyPoints) ? existing.outline.keyPoints : ['','',''];
      const weekDate = mgrParseDate(weekOf);
      const weekEndDate = new Date(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate() + 6);
      const weekLabel = mgrFmtShort(weekDate) + ' – ' + mgrFmtShort(weekEndDate) + ', ' + weekEndDate.getFullYear();
      const isCurrentWeek = weekOf === mgrFmtDate(mgrStartOfWeek(mgrToday()));

      document.getElementById('mgrTrainingBuilder').innerHTML = `
        <form id="mgrTrainingForm" onsubmit="return mgrSaveTraining(event);">
          <input type="hidden" id="t_weekOf" value="${weekOf}">
          <div class="mgr-form-row">
            <label class="mgr-form-label">Week of</label>
            <div class="mgr-week-nav">
              <button type="button" class="mgr-week-btn" onclick="mgrShiftTrainingWeek(-1)" title="Previous week">◀</button>
              <div class="mgr-week-display">
                <span class="mgr-week-label">${weekLabel}</span>
                ${isCurrentWeek ? '<span class="mgr-week-current">Current Week</span>' : ''}
              </div>
              <button type="button" class="mgr-week-btn" onclick="mgrShiftTrainingWeek(1)" title="Next week">▶</button>
              ${!isCurrentWeek ? '<button type="button" class="mgr-btn secondary sm" onclick="mgrResetTrainingWeek()" style="margin-left:8px;">Today</button>' : ''}
            </div>
          </div>
          <div class="mgr-form-row">
            <label class="mgr-form-label">Topic</label>
            <input type="text" class="mgr-input" id="t_topic" value="${mgrEscape(existing.topic||'')}" placeholder="e.g. Membership conversion deep-dive">
          </div>
          <div class="mgr-form-row">
            <label class="mgr-form-label">Why this topic (rationale)</label>
            <textarea class="mgr-textarea" id="t_rationale" rows="2">${mgrEscape(existing.rationale||'')}</textarea>
          </div>
          <div class="mgr-form-row">
            <label class="mgr-form-label">Duration</label>
            <select class="mgr-select" id="t_duration">
              <option value="15min" ${existing.outline?.duration==='15min'?'selected':''}>15 min</option>
              <option value="30min" ${existing.outline?.duration==='30min'?'selected':''}>30 min</option>
              <option value="45min" ${existing.outline?.duration==='45min'?'selected':''}>45 min</option>
              <option value="1hr" ${existing.outline?.duration==='1hr'?'selected':''}>1 hour</option>
              <option value="1.5hr" ${existing.outline?.duration==='1.5hr'?'selected':''}>1.5 hours</option>
              <option value="2hr" ${existing.outline?.duration==='2hr'?'selected':''}>2 hours</option>
              <option value="3hr" ${existing.outline?.duration==='3hr'?'selected':''}>3 hours</option>
              <option value="halfday" ${existing.outline?.duration==='halfday'?'selected':''}>Half day</option>
              <option value="fullday" ${existing.outline?.duration==='fullday'?'selected':''}>Full day</option>
              <option value="2days" ${existing.outline?.duration==='2days'?'selected':''}>2 days</option>
              <option value="3days" ${existing.outline?.duration==='3days'?'selected':''}>3 days</option>
              <option value="allweek" ${existing.outline?.duration==='allweek'?'selected':''}>All week</option>
            </select>
          </div>
          <div class="mgr-form-row">
            <label class="mgr-form-label">Key Points</label>
            <div id="t_keyPoints">
              ${keyPoints.map((p, i) => `
                <div class="mgr-keypoint-row">
                  <span class="mgr-keypoint-num">${i+1}.</span>
                  <input type="text" class="mgr-input" value="${mgrEscape(p)}">
                </div>
              `).join('')}
            </div>
            <button type="button" class="mgr-btn secondary sm" onclick="mgrAddKeyPoint()">+ Add key point</button>
          </div>
          <div class="mgr-form-row">
            <label class="mgr-form-label">Materials</label>
            <textarea class="mgr-textarea" id="t_materials" rows="2" placeholder="Handouts, slides, demos...">${mgrEscape(existing.outline?.materials||'')}</textarea>
          </div>
          <div class="mgr-form-row">
            <label class="mgr-check">
              <input type="checkbox" id="t_redBarn" ${existing.outline?.redBarn?'checked':''}>
              <span>Include Red Barn component</span>
            </label>
          </div>
          <div class="mgr-form-row">
            <label class="mgr-form-label">Red Barn Scenario (optional)</label>
            <input type="text" class="mgr-input" id="t_rbScenario" value="${mgrEscape(existing.outline?.redBarnScenario||'')}">
          </div>

          <div class="mgr-form-section">
            <div class="mgr-form-section-title">Impressionable Moment</div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Hook / Opener</label>
              <textarea class="mgr-textarea" id="t_hook" rows="2">${mgrEscape(existing.moment?.hook||'')}</textarea>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Real-world example</label>
              <textarea class="mgr-textarea" id="t_example" rows="2">${mgrEscape(existing.moment?.example||'')}</textarea>
            </div>
            <div class="mgr-form-row">
              <label class="mgr-form-label">Takeaway message</label>
              <textarea class="mgr-textarea" id="t_takeaway" rows="2">${mgrEscape(existing.moment?.takeaway||'')}</textarea>
            </div>
          </div>

          <div class="mgr-panel-actions" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;">
            <button type="submit" class="mgr-btn">Save Training Plan</button>
            <button type="button" class="mgr-btn secondary" onclick="mgrExportTrainingPDF()">Extract PDF</button>
            <button type="button" class="mgr-btn secondary" onclick="mgrTrainingAddToCalendar()" style="border-color:rgba(100,180,255,0.4);color:#64b4ff;">\ud83d\udcc5 Add to Calendar</button>
            <button type="button" class="mgr-btn secondary" onclick="mgrTrainingAddToBB()" style="border-color:rgba(255,215,0,0.4);color:#fbbf24;">\ud83d\udccc Add to Bulletin Board</button>
          </div>
        </form>
      `;

      // Past trainings
      const past = mgrState.trainings.slice().sort((a, b) => (b.weekOf || '').localeCompare(a.weekOf || ''));
      if (!past.length) {
        document.getElementById('mgrPastTrainings').innerHTML = `<div style="font-size:12px; color:var(--text-muted);">No trainings saved yet.</div>`;
      } else {
        document.getElementById('mgrPastTrainings').innerHTML = past.map(t => {
          var dur = (t.outline && t.outline.duration) ? t.outline.duration : '';
          var rb = (t.outline && t.outline.redBarn) ? ' · Red Barn' : '';
          var durLine = dur ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${dur}${rb}</div>` : '';
          var isActive = t.weekOf === weekOf;
          return `
          <div class="mgr-past-item${isActive ? ' mgr-past-active' : ''}" onclick="mgrLoadPastTraining('${t.weekOf}')" style="cursor:pointer;">
            <div class="mgr-past-item-date">Week of ${mgrFmtShort(mgrParseDate(t.weekOf))}, ${mgrParseDate(t.weekOf).getFullYear()} · ${(t.attendance||[]).length} attended</div>
            <div class="mgr-past-item-topic">${mgrEscape(t.topic || '(no topic)')}</div>
            ${durLine}
            <div style="font-size:10px; color:var(--accent); margin-top:4px;">Tap to view &rarr;</div>
          </div>`;
        }).join('');
      }
    }

    function mgrAddKeyPoint() {
      const list = document.getElementById('t_keyPoints');
      const idx = list.children.length + 1;
      const div = document.createElement('div');
      div.className = 'mgr-keypoint-row';
      div.innerHTML = `<span class="mgr-keypoint-num">${idx}.</span><input type="text" class="mgr-input" value="">`;
      list.appendChild(div);
    }

    function mgrAdoptSuggestion() {
      const s = mgrGetSuggestedTraining();
      document.getElementById('t_topic').value = s.topic;
      document.getElementById('t_rationale').value = s.rationale;
    }

    function mgrShiftTrainingWeek(dir) {
      const current = mgrParseDate(window._mgrTrainingWeekOf);
      current.setDate(current.getDate() + (dir * 7));
      window._mgrTrainingWeekOf = mgrFmtDate(mgrStartOfWeek(current));
      renderManagerTraining();
    }

    function mgrResetTrainingWeek() {
      window._mgrTrainingWeekOf = mgrFmtDate(mgrStartOfWeek(mgrToday()));
      renderManagerTraining();
    }

    function mgrLoadPastTraining(weekOfStr) {
      window._mgrTrainingWeekOf = weekOfStr;
      renderManagerTraining();
      // Scroll to the training form at the top
      var builder = document.getElementById('mgrTrainingBuilder');
      if (builder) builder.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function mgrSaveTraining(ev) {
      ev.preventDefault();
      const weekOf = document.getElementById('t_weekOf').value;
      const keyPoints = Array.from(document.querySelectorAll('#t_keyPoints input')).map(i => i.value);
      const outline = {
        duration: document.getElementById('t_duration').value,
        keyPoints,
        materials: document.getElementById('t_materials').value,
        redBarn: document.getElementById('t_redBarn').checked,
        redBarnScenario: document.getElementById('t_rbScenario').value
      };
      const moment = {
        hook: document.getElementById('t_hook').value,
        example: document.getElementById('t_example').value,
        takeaway: document.getElementById('t_takeaway').value
      };
      const topic = document.getElementById('t_topic').value;
      const rationale = document.getElementById('t_rationale').value;

      const idx = mgrState.trainings.findIndex(t => t.weekOf === weekOf);
      if (idx >= 0) {
        mgrState.trainings[idx] = { ...mgrState.trainings[idx], topic, rationale, outline, moment, updatedAt: Date.now() };
      } else {
        mgrState.trainings.push({
          id: mgrUID(),
          weekOf, topic, rationale, outline, moment,
          attendance: [], meetingNotes: '', meetingActions: '',
          createdAt: Date.now(), updatedAt: Date.now()
        });
      }
      mgrSave();
      renderManagerTraining();

      // Show calendar save modal
      var weekDate = mgrParseDate(weekOf);
      var wedDate = new Date(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate() + 3); // Wednesday
      var wedStr = mgrFmtDate(wedDate);
      _showTrainingCalendarModal(topic, wedStr, outline.duration);
      return false;
    }

    // Standalone "Add to Calendar" for training plan (reads current form values)
    function mgrTrainingAddToCalendar() {
      var weekOf = document.getElementById('t_weekOf').value;
      var topic = document.getElementById('t_topic').value || '(No topic)';
      var duration = document.getElementById('t_duration').value || '';
      if (!weekOf) { alert('Please select a Week Of date first.'); return; }
      var weekDate = mgrParseDate(weekOf);
      var wedDate = new Date(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate() + 3);
      var wedStr = mgrFmtDate(wedDate);

      var entryId = mgrUID();
      mgrState.entries.push({
        id: entryId, type: 'one-on-one', tech: 'Team', date: wedStr, status: 'planned',
        data: { housekeeping: {}, housekeepingNotes: '', customFocus: 'Wed HVAC Meeting: ' + topic + (duration ? ' (' + duration + ')' : ''), redBarn: { include: false, scenario: '', outcome: '' }, coveredSummary: '', actionItems: '', followUp: '' },
        createdAt: Date.now(), updatedAt: Date.now()
      });
      mgrSave();
      renderManagerCalendar();
      // Toast
      var toast = document.createElement('div');
      toast.textContent = '\u2705 Added to Calendar (' + wedStr + ')';
      toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#3b82f6;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.4s;';
      document.body.appendChild(toast);
      setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { toast.remove(); }, 400); }, 2000);
    }

    // Standalone "Add to Bulletin Board" for training plan
    function mgrTrainingAddToBB() {
      var weekOf = document.getElementById('t_weekOf').value;
      var topic = document.getElementById('t_topic').value || '(No topic)';
      var duration = document.getElementById('t_duration').value || '';
      if (!weekOf) { alert('Please select a Week Of date first.'); return; }
      var weekDate = mgrParseDate(weekOf);
      var wedDate = new Date(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate() + 3);
      var wedStr = mgrFmtDate(wedDate);

      var bb = bbLoad();
      bb.meetings.push({
        id: bbUID(), subject: topic, date: wedStr, time: '', location: '', notes: duration ? 'Duration: ' + duration : '', source: 'mgr'
      });
      bbSave(bb);
      renderBulletinBoard();
      // Toast
      var toast = document.createElement('div');
      toast.textContent = '\u2705 Added to Bulletin Board';
      toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#065f46;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.4s;';
      document.body.appendChild(toast);
      setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { toast.remove(); }, 400); }, 2000);
    }

    function _showTrainingCalendarModal(topic, defaultDate, duration) {
      // Remove existing modal if present
      var old = document.getElementById('trainingCalendarModal');
      if (old) old.remove();

      var modal = document.createElement('div');
      modal.id = 'trainingCalendarModal';
      modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;';
      modal.innerHTML = `
        <div style="background:#141b2d;border-radius:16px;padding:28px 32px;max-width:420px;width:90%;color:#fff;font-family:var(--font);box-shadow:0 8px 32px rgba(0,0,0,0.5);">
          <div style="font-size:18px;font-weight:700;margin-bottom:6px;">\ud83d\udcc5 Save to Calendar</div>
          <div style="font-size:13px;color:#8b93a8;margin-bottom:18px;">Training plan saved. Add this to the manager calendar?</div>
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;font-weight:600;color:#fbbf24;display:block;margin-bottom:4px;">Topic</label>
            <div style="font-size:14px;color:#e0e6f0;background:rgba(255,255,255,0.08);padding:8px 12px;border-radius:8px;">${topic || '(No topic)'}</div>
          </div>
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;font-weight:600;color:#fbbf24;display:block;margin-bottom:4px;">Meeting Date</label>
            <input type="date" id="tcm_date" value="${defaultDate}" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:14px;">
          </div>
          <div style="margin-bottom:18px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" id="tcm_addBulletin" checked style="width:16px;height:16px;accent-color:#fbbf24;">
              <span style="font-size:13px;color:#e0e6f0;">Also add to Bulletin Board</span>
            </label>
          </div>
          <div style="display:flex;gap:10px;">
            <button onclick="_confirmTrainingCalendar()" style="flex:1;padding:10px;border:none;border-radius:8px;background:linear-gradient(135deg,#FFD700,#FFA500);color:#0F1B2E;font-weight:700;font-size:14px;cursor:pointer;">Save to Calendar</button>
            <button onclick="document.getElementById('trainingCalendarModal').remove()" style="flex:1;padding:10px;border:1px solid rgba(255,255,255,0.2);border-radius:8px;background:transparent;color:#8b93a8;font-weight:600;font-size:14px;cursor:pointer;">Skip</button>
          </div>
        </div>
      `;
      modal.dataset.topic = topic;
      modal.dataset.duration = duration || '';
      document.body.appendChild(modal);
    }

    function _confirmTrainingCalendar() {
      var modal = document.getElementById('trainingCalendarModal');
      var dateStr = document.getElementById('tcm_date').value;
      var addBulletin = document.getElementById('tcm_addBulletin').checked;
      var topic = modal.dataset.topic;
      var duration = modal.dataset.duration;

      if (!dateStr) { alert('Please select a date.'); return; }

      // Add to manager calendar as a training entry
      var entryId = mgrUID();
      mgrState.entries.push({
        id: entryId,
        type: 'one-on-one',
        tech: 'Team',
        date: dateStr,
        status: 'planned',
        data: {
          housekeeping: {},
          housekeepingNotes: '',
          customFocus: 'Wed HVAC Meeting: ' + (topic || 'Team Training') + (duration ? ' (' + duration + ')' : ''),
          redBarn: { include: false, scenario: '', outcome: '' },
          coveredSummary: '', actionItems: '', followUp: ''
        },
        createdAt: Date.now(), updatedAt: Date.now()
      });
      mgrSave();

      // Add to bulletin board if checked
      if (addBulletin) {
        var bb = bbLoad();
        bb.meetings.push({
          id: entryId,
          subject: topic || 'Team Training',
          date: dateStr,
          time: '',
          location: '',
          notes: duration ? 'Duration: ' + duration : '',
          source: 'mgr'
        });
        bbSave(bb);
        renderBulletinBoard();
      }

      renderManagerTab();
      modal.remove();
    }

    function _showBBPromptModal(type, tech, dateStr, status, notes, entryId) {
      var old = document.getElementById('bbPromptModal');
      if (old) old.remove();

      var typeLabel = type === 'one-on-one' ? '1-on-1' : 'Ride-Along';
      var icon = type === 'one-on-one' ? '\ud83e\udd1d' : '\ud83d\ude90';
      var dateDisplay = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      var modal = document.createElement('div');
      modal.id = 'bbPromptModal';
      modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;';
      modal.innerHTML = `
        <div style="background:#141b2d;border-radius:16px;padding:28px 32px;max-width:420px;width:90%;color:#fff;font-family:var(--font);box-shadow:0 8px 32px rgba(0,0,0,0.5);">
          <div style="font-size:18px;font-weight:700;margin-bottom:6px;">${icon} ${typeLabel} Saved</div>
          <div style="font-size:13px;color:#8b93a8;margin-bottom:18px;">Saved to manager calendar. Add to Bulletin Board?</div>
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;font-weight:600;color:#fbbf24;display:block;margin-bottom:4px;">Tech</label>
            <div style="font-size:14px;color:#e0e6f0;background:rgba(255,255,255,0.08);padding:8px 12px;border-radius:8px;">${tech}</div>
          </div>
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;font-weight:600;color:#fbbf24;display:block;margin-bottom:4px;">Date</label>
            <input type="date" id="bbp_date" value="${dateStr}" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:14px;">
          </div>
          <div style="display:flex;gap:10px;">
            <button onclick="_confirmBBPrompt()" style="flex:1;padding:10px;border:none;border-radius:8px;background:linear-gradient(135deg,#FFD700,#FFA500);color:#0F1B2E;font-weight:700;font-size:14px;cursor:pointer;">Add to Bulletin Board</button>
            <button onclick="document.getElementById('bbPromptModal').remove()" style="flex:1;padding:10px;border:1px solid rgba(255,255,255,0.2);border-radius:8px;background:transparent;color:#8b93a8;font-weight:600;font-size:14px;cursor:pointer;">Skip</button>
          </div>
        </div>
      `;
      modal.dataset.type = type;
      modal.dataset.tech = tech;
      modal.dataset.status = status;
      modal.dataset.notes = notes;
      modal.dataset.entryId = entryId;
      document.body.appendChild(modal);
    }

    function _confirmBBPrompt() {
      var modal = document.getElementById('bbPromptModal');
      var dateStr = document.getElementById('bbp_date').value;
      var type = modal.dataset.type;
      var tech = modal.dataset.tech;
      var status = modal.dataset.status;
      var notes = modal.dataset.notes;
      var entryId = modal.dataset.entryId;

      if (!dateStr) { alert('Please select a date.'); return; }

      // Update the manager entry date if changed
      var entry = mgrState.entries.find(function(e) { return e.id === entryId; });
      if (entry && entry.date !== dateStr) {
        entry.date = dateStr;
        entry.updatedAt = Date.now();
        mgrSave();
      }

      var bb = bbLoad();
      if (type === 'one-on-one') {
        bb.oneOnOnes.push({ id: entryId, tech: tech, date: dateStr, time: '', status: status, notes: notes, source: 'mgr' });
      } else if (type === 'ride-along') {
        bb.rideAlongs.push({ id: entryId, tech: tech, date: dateStr, time: '', status: status, notes: notes, source: 'mgr' });
      }
      bbSave(bb);
      modal.remove();
      // Instant re-renders
      renderBulletinBoard();
      renderManagerLog();
      renderManagerCalendar();
      // Toast confirmation
      var toast = document.createElement('div');
      toast.textContent = '\u2705 Added to Bulletin Board';
      toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#065f46;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.4s;';
      document.body.appendChild(toast);
      setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { toast.remove(); }, 400); }, 2000);
    }

    function mgrExportTrainingPDF() {
      var weekOf = document.getElementById('t_weekOf').value;
      var topic = document.getElementById('t_topic').value || '(No topic)';
      var rationale = document.getElementById('t_rationale').value || '';
      var duration = document.getElementById('t_duration').value || '';
      var keyPoints = Array.from(document.querySelectorAll('#t_keyPoints input')).map(function(i) { return i.value; }).filter(function(v) { return v.trim(); });
      var materials = document.getElementById('t_materials').value || '';
      var redBarn = document.getElementById('t_redBarn').checked;
      var rbScenario = document.getElementById('t_rbScenario').value || '';
      var hook = document.getElementById('t_hook').value || '';
      var example = document.getElementById('t_example').value || '';
      var takeaway = document.getElementById('t_takeaway').value || '';

      var weekDate = mgrParseDate(weekOf);
      var weekEnd = new Date(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate() + 6);
      var weekLabel = mgrFmtShort(weekDate) + ' - ' + mgrFmtShort(weekEnd) + ', ' + weekEnd.getFullYear();

      var jsPDF = window.jspdf.jsPDF;
      var doc = new jsPDF({ unit: 'pt', format: 'letter' });
      var W = doc.internal.pageSize.getWidth();
      var H = doc.internal.pageSize.getHeight();
      var margin = 50;
      var usable = W - margin * 2;
      var y = margin;

      function checkPage(need) {
        if (y + need > H - 60) { doc.addPage(); y = margin; return true; }
        return false;
      }

      // Header bar
      doc.setFillColor(30, 36, 50);
      doc.rect(0, 0, W, 70, 'F');
      doc.setFillColor(76, 175, 80);
      doc.rect(0, 68, W, 3, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('SNAPPY SERVICES', margin, 30);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text('Weekly Training Plan', margin, 48);
      doc.setFontSize(10);
      doc.text('Week of ' + weekLabel, W - margin, 30, { align: 'right' });
      doc.text('Duration: ' + duration, W - margin, 48, { align: 'right' });

      y = 90;
      doc.setTextColor(30, 36, 50);

      // Topic
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      var topicLines = doc.splitTextToSize(topic, usable);
      doc.text(topicLines, margin, y);
      y += topicLines.length * 18 + 8;

      // Rationale
      if (rationale) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 100, 100);
        doc.text('RATIONALE', margin, y);
        y += 12;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);
        var ratLines = doc.splitTextToSize(rationale, usable);
        doc.text(ratLines, margin, y);
        y += ratLines.length * 13 + 12;
      }

      // Key Points
      if (keyPoints.length) {
        checkPage(30);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 36, 50);
        doc.setFillColor(76, 175, 80);
        doc.rect(margin, y - 2, 3, 14, 'F');
        doc.text('KEY POINTS', margin + 10, y + 10);
        y += 22;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50, 50, 50);
        keyPoints.forEach(function(kp, i) {
          checkPage(40);
          var lines = doc.splitTextToSize((i + 1) + '.  ' + kp, usable - 15);
          doc.text(lines, margin + 8, y);
          y += lines.length * 13 + 6;
        });
        y += 6;
      }

      // Materials
      if (materials) {
        checkPage(40);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 36, 50);
        doc.setFillColor(33, 150, 243);
        doc.rect(margin, y - 2, 3, 14, 'F');
        doc.text('MATERIALS', margin + 10, y + 10);
        y += 22;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50, 50, 50);
        var matLines = doc.splitTextToSize(materials, usable - 10);
        doc.text(matLines, margin + 8, y);
        y += matLines.length * 13 + 12;
      }

      // Red Barn
      if (redBarn && rbScenario) {
        checkPage(50);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 36, 50);
        doc.setFillColor(198, 40, 40);
        doc.rect(margin, y - 2, 3, 14, 'F');
        doc.text('RED BARN SCENARIO', margin + 10, y + 10);
        y += 22;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50, 50, 50);
        var rbLines = doc.splitTextToSize(rbScenario, usable - 10);
        doc.text(rbLines, margin + 8, y);
        y += rbLines.length * 13 + 12;
      }

      // Impressionable Moment
      if (hook || example || takeaway) {
        checkPage(50);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 36, 50);
        doc.setFillColor(156, 106, 222);
        doc.rect(margin, y - 2, 3, 14, 'F');
        doc.text('IMPRESSIONABLE MOMENT', margin + 10, y + 10);
        y += 22;

        if (hook) {
          checkPage(30);
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(100, 100, 100);
          doc.text('HOOK / OPENER', margin + 8, y);
          y += 12;
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(50, 50, 50);
          var hookLines = doc.splitTextToSize(hook, usable - 15);
          doc.text(hookLines, margin + 8, y);
          y += hookLines.length * 13 + 10;
        }
        if (example) {
          checkPage(30);
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(100, 100, 100);
          doc.text('REAL-WORLD EXAMPLE', margin + 8, y);
          y += 12;
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(50, 50, 50);
          var exLines = doc.splitTextToSize(example, usable - 15);
          doc.text(exLines, margin + 8, y);
          y += exLines.length * 13 + 10;
        }
        if (takeaway) {
          checkPage(30);
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(100, 100, 100);
          doc.text('TAKEAWAY MESSAGE', margin + 8, y);
          y += 12;
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(50, 50, 50);
          var tkLines = doc.splitTextToSize(takeaway, usable - 15);
          doc.text(tkLines, margin + 8, y);
          y += tkLines.length * 13 + 10;
        }
      }

      // Footer
      var pages = doc.internal.getNumberOfPages();
      for (var p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('Snappy Services - Training Plan - ' + weekLabel, margin, H - 25);
        doc.text('Page ' + p + ' of ' + pages, W - margin, H - 25, { align: 'right' });
      }

      doc.save('Snappy_Training_' + weekOf + '.pdf');
    }

    function mgrToggleAttendance(trainingId, tech, checked) {
      const t = mgrState.trainings.find(x => x.id === trainingId);
      if (!t) return;
      if (!t.attendance) t.attendance = [];
      if (checked) {
        if (!t.attendance.includes(tech)) t.attendance.push(tech);
      } else {
        t.attendance = t.attendance.filter(x => x !== tech);
      }
      mgrSave();
    }

    function mgrSaveMeetingNotes(trainingId) {
      const t = mgrState.trainings.find(x => x.id === trainingId);
      if (!t) return;
      t.meetingNotes = document.getElementById('mgrMeetingNotes').value;
      t.meetingActions = document.getElementById('mgrMeetingActions').value;
      t.updatedAt = Date.now();
      mgrSave();
      alert('Meeting notes saved.');
    }

    // ----- Main render -----
    function renderManagerTab() {
      renderManagerCompliance();
      renderManagerKPIs();
      renderMgrToday();
      renderManagerCalendar();
      renderMgrBulletinBoard();
      renderManagerLog();
      renderManagerTraining();
    }

    // ----- Wire up -----
    (function mgrInit() {
      mgrLoad();

      // Sub-tab navigation
      document.querySelectorAll('#mgr-sub-tabs .nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('#mgr-sub-tabs .nav-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.mgr-section').forEach(s => s.classList.remove('active'));
          tab.classList.add('active');
          document.getElementById('mgr-' + tab.dataset.mgr).classList.add('active');
        });
      });

      // Calendar nav
      document.getElementById('mgrCalPrev').addEventListener('click', () => {
        mgrCalDate = new Date(mgrCalDate.getFullYear(), mgrCalDate.getMonth() - 1, 1);
        renderManagerCalendar();
      });
      document.getElementById('mgrCalNext').addEventListener('click', () => {
        mgrCalDate = new Date(mgrCalDate.getFullYear(), mgrCalDate.getMonth() + 1, 1);
        renderManagerCalendar();
      });
      document.getElementById('mgrCalToday').addEventListener('click', () => {
        mgrCalDate = mgrToday();
        renderManagerCalendar();
      });

      // Panel close handlers
      document.getElementById('mgrPanelClose').addEventListener('click', mgrClosePanel);
      document.getElementById('mgrOverlay').addEventListener('click', mgrClosePanel);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('mgrPanel').classList.contains('open')) {
          mgrClosePanel();
        }
      });

      // Log filters
      ['mgrLogTech','mgrLogType','mgrLogStatus'].forEach(id => {
        document.getElementById(id).addEventListener('change', renderManagerLog);
      });
      document.getElementById('mgrLogClear').addEventListener('click', () => {
        document.getElementById('mgrLogTech').value = '';
        document.getElementById('mgrLogType').value = '';
        document.getElementById('mgrLogStatus').value = '';
        renderManagerLog();
      });
    })();

    // ========== BACK NAVIGATION (global) ==========
    function mgrSwitchSubTab(tabName) {
      document.querySelectorAll('#mgr-sub-tabs .nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.mgr-section').forEach(s => s.classList.remove('active'));
      var btn = document.querySelector('#mgr-sub-tabs [data-mgr="' + tabName + '"]');
      if (btn) btn.classList.add('active');
      var sec = document.getElementById('mgr-' + tabName);
      if (sec) sec.classList.add('active');
      // Scroll to top of manager tab
      sec && sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ========== TECH FILES ==========
    const TF_STORAGE_KEY = 'snappy_tech_files';
    const TF_DRIVEMAP_KEY = 'snappy_tf_drivemap';
    let tfFiles = {}; // { tech: [ { id, type, title, notes, fileName, fileSize, fileData, date } ] }
    let tfDriveMap = {}; // { fileEntryId: driveFileId }
    let tfSelectedTech = 'Chris';
    let tfPendingFileData = null;
    let tfPendingFileName = '';
    let tfPendingFileSize = 0;
    let tfEditingId = null;

    function tfLoad() {
      try {
        const raw = localStorage.getItem(TF_STORAGE_KEY);
        if (raw) tfFiles = JSON.parse(raw);
      } catch (e) { console.warn('Tech Files: load failed', e); }
      try {
        const dm = localStorage.getItem(TF_DRIVEMAP_KEY);
        if (dm) tfDriveMap = JSON.parse(dm);
      } catch (e) {}
    }
    function tfSave() {
      try {
        localStorage.setItem(TF_STORAGE_KEY, JSON.stringify(tfFiles));
        if (SyncEngine.isConfigured()) SyncEngine.write('techfiles', _tfStripFileData(tfFiles));
      } catch (e) {
        alert('Storage full — try removing older files first.');
        console.warn('Tech Files: save failed', e);
      }
    }

    // Auto-inject score breakdown PDFs from score_pdfs.js into Tech Files
    // Runs once per version — checks a localStorage flag so it doesn't duplicate
    function _tfSeedScorePDFs() {
      if (typeof TECH_SCORE_PDFS === 'undefined') return;
      var seedKey = 'snappy_tf_seeded_v1';
      if (localStorage.getItem(seedKey)) return; // already seeded

      var techMap = {
        'Chris': 'Chris', 'Dewone': 'Dewone', 'Benji': 'Benji',
        'Daniel': 'Daniel', 'Dee': 'Dee'
      };
      var changed = false;
      for (var pdfKey in techMap) {
        if (!TECH_SCORE_PDFS[pdfKey]) continue;
        var techName = techMap[pdfKey];
        if (!tfFiles[techName]) tfFiles[techName] = [];

        // Skip if a scorecard entry already exists for this tech
        var exists = tfFiles[techName].some(function(f) {
          return f.type === 'scorecard';
        });
        if (exists) continue;

        var b64 = TECH_SCORE_PDFS[pdfKey];
        var byteLen = Math.round(b64.length * 3 / 4);
        tfFiles[techName].push({
          id: 'score_' + pdfKey.toLowerCase() + '_' + Date.now(),
          type: 'scorecard',
          title: pdfKey + ' — Score Breakdown',
          notes: 'Auto-generated composite score breakdown with aptitude, skills, ST performance, and dispatch bonus details.',
          fileName: pdfKey.toLowerCase() + '_score_breakdown.pdf',
          fileSize: byteLen,
          fileData: 'data:application/pdf;base64,' + b64,
          date: new Date().toISOString()
        });
        changed = true;
      }
      if (changed) {
        tfSave();
      }
      localStorage.setItem(seedKey, '1');
    }

    // Strip base64 fileData before pushing to cloud (too large for Google Sheets cells)
    // Cloud stores metadata only (no fileData); actual file content stays in localStorage
    function _tfStripFileData(files) {
      var stripped = {};
      for (var tech in files) {
        stripped[tech] = (files[tech] || []).map(function(f) {
          var copy = {};
          for (var k in f) {
            if (k !== 'fileData') copy[k] = f[k];
          }
          copy.hasFile = !!(f.fileData || (typeof tfDriveMap !== 'undefined' && tfDriveMap[f.id]));
          return copy;
        });
      }
      return stripped;
    }

    // Save + confirm cloud sync with visual status
    async function tfSaveAndConfirm() {
      _tfShowCloudStatus('syncing');

      // 1. Save to localStorage (full data including fileData for local viewing)
      try {
        localStorage.setItem(TF_STORAGE_KEY, JSON.stringify(tfFiles));
      } catch (e) {
        alert('Storage full — try removing older files first.');
        _tfShowCloudStatus('error');
        return;
      }

      // 2. Push metadata (stripped, no fileData) to cloud
      try {
        var stripped = _tfStripFileData(tfFiles);
        SyncEngine._pendingWrites['techfiles'] = JSON.stringify(stripped);
        clearTimeout(SyncEngine._writeTimer);
        await SyncEngine._flush();
        await new Promise(function(r) { setTimeout(r, 2500); });

        // 3. Verify via pull
        var cloud = await SyncEngine.pull();
        if (cloud && cloud.techfiles) {
          var cv = cloud.techfiles.data || cloud.techfiles.val || '';
          if (cv) {
            var cloudFiles = JSON.parse(cv);
            var localCount = (tfFiles[tfSelectedTech] || []).length;
            var cloudCount = (cloudFiles[tfSelectedTech] || []).length;
            if (cloudCount >= localCount) {
              _tfShowCloudStatus('saved');
              return;
            }
          }
        }
        // Verification inconclusive but data was pushed
        _tfShowCloudStatus('saved');
      } catch (e) {
        console.warn('Cloud sync failed:', e);
        _tfShowCloudStatus('error');
      }

      // 4. Upload any new files to Drive (non-blocking, after metadata is safe)
      for (var tech in tfFiles) {
        (tfFiles[tech] || []).forEach(function(entry) {
          if (entry.fileData && !tfDriveMap[entry.id]) {
            _tfUploadToDrive(tech, entry);
          }
        });
      }
    }

    function _tfShowCloudStatus(state) {
      var el = document.getElementById('tfCloudStatus');
      if (!el) {
        el = document.createElement('div');
        el.id = 'tfCloudStatus';
        document.body.appendChild(el);
      }
      el.className = 'tf-cloud-toast tf-cloud-' + state;
      if (state === 'syncing') {
        el.innerHTML = '<span class="tf-cloud-spinner"></span> Saving to cloud...';
      } else if (state === 'saved') {
        el.innerHTML = '\u2601\uFE0F \u2713 Saved to cloud';
        setTimeout(function() { el.classList.add('tf-cloud-hide'); }, 3000);
      } else if (state === 'error') {
        el.innerHTML = '\u26A0 Cloud sync failed — file saved locally';
        setTimeout(function() { el.classList.add('tf-cloud-hide'); }, 5000);
      }
    }

    // Upload file content to Google Drive (non-blocking, fire-and-forget)
    function _tfUploadToDrive(techName, fileEntry) {
      if (!fileEntry.fileData || !SyncEngine.isConfigured()) return;
      if (tfDriveMap[fileEntry.id]) return; // already uploaded
      var payload = JSON.stringify({
        _action: 'uploadFile',
        techName: techName,
        fileEntryId: fileEntry.id,
        fileName: fileEntry.fileName || fileEntry.title,
        fileData: fileEntry.fileData
      });
      fetch(SYNC_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: payload
      }).then(function() {
        console.log('Drive upload sent for', fileEntry.id);
      }).catch(function(err) {
        console.warn('Drive upload failed:', err);
      });
    }

    // Fetch file from Drive via JSONP (for cross-device viewing)
    function _tfFetchFromDrive(driveFileId) {
      return new Promise(function(resolve, reject) {
        var cbName = '_tfDriveCb_' + Date.now();
        var timeout = setTimeout(function() {
          delete window[cbName];
          reject(new Error('Drive fetch timeout'));
        }, 30000);
        window[cbName] = function(data) {
          clearTimeout(timeout);
          delete window[cbName];
          var s = document.getElementById(cbName);
          if (s) s.remove();
          if (data && data.status === 'ok' && data.fileData) {
            resolve(data.fileData);
          } else {
            reject(new Error(data && data.message || 'No file data'));
          }
        };
        var url = SYNC_URL + (SYNC_URL.indexOf('?') > -1 ? '&' : '?') +
          'action=getFile&fileId=' + encodeURIComponent(driveFileId) +
          '&callback=' + cbName + '&t=' + Date.now();
        var s = document.createElement('script');
        s.id = cbName;
        s.src = url;
        s.onerror = function() {
          clearTimeout(timeout);
          delete window[cbName];
          s.remove();
          reject(new Error('Drive fetch network error'));
        };
        document.body.appendChild(s);
      });
    }

    // Pull Drive map from cloud on sync
    function _tfSyncDriveMap(cloudData) {
      if (cloudData && cloudData.techfile_drivemap) {
        var val = cloudData.techfile_drivemap.val || cloudData.techfile_drivemap.data || '';
        if (val) {
          try {
            var cloudMap = JSON.parse(val);
            // Merge with local map
            for (var k in cloudMap) {
              tfDriveMap[k] = cloudMap[k];
            }
            localStorage.setItem(TF_DRIVEMAP_KEY, JSON.stringify(tfDriveMap));
          } catch (e) { console.warn('Drive map parse error', e); }
        }
      }
    }

    function tfRender() {
      const techNames = ['Chris', 'Dewone', 'Benji', 'Daniel', 'Dee'];
      // Sidebar
      const sb = document.getElementById('tfSidebar');
      sb.innerHTML = techNames.map(t => {
        const count = (tfFiles[t] || []).length;
        return `<button class="tf-tech-btn${t === tfSelectedTech ? ' active' : ''}" onclick="tfSelectTech('${t}')">
          ${t}
          ${count ? `<span class="tf-count">${count}</span>` : ''}
        </button>`;
      }).join('');

      // Main area
      const files = (tfFiles[tfSelectedTech] || []).slice();
      const filter = document.getElementById('tfFilterType');
      const filterVal = filter ? filter.value : '';
      const filtered = filterVal ? files.filter(f => f.type === filterVal) : files;
      filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

      const main = document.getElementById('tfMain');
      const typeLabels = {
        recall: 'Recall', invoice: 'Invoice', summary: 'Summary', callback: 'Callback',
        complaint: 'Complaint', photo: 'Photo', note: 'Note', scorecard: 'Score Breakdown', other: 'Other'
      };

      let html = `<div class="tf-header">
        <div class="tf-header-title">${tfSelectedTech} — Files &amp; Documents</div>
        <div class="tf-header-actions">
          <select class="tf-filter-select" id="tfFilterType" onchange="tfRender()">
            <option value="">All categories</option>
            <option value="recall"${filterVal==='recall'?' selected':''}>Recalls</option>
            <option value="invoice"${filterVal==='invoice'?' selected':''}>Invoices</option>
            <option value="summary"${filterVal==='summary'?' selected':''}>Summaries</option>
            <option value="callback"${filterVal==='callback'?' selected':''}>Callbacks</option>
            <option value="complaint"${filterVal==='complaint'?' selected':''}>Complaints</option>
            <option value="photo"${filterVal==='photo'?' selected':''}>Photos</option>
            <option value="note"${filterVal==='note'?' selected':''}>Notes</option>
            <option value="scorecard"${filterVal==='scorecard'?' selected':''}>Score Breakdowns</option>
            <option value="other"${filterVal==='other'?' selected':''}>Other</option>
          </select>
          <button class="tf-upload-btn" onclick="tfOpenUpload()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add File
          </button>
        </div>
      </div>`;

      if (!filtered.length) {
        html += `<div class="tf-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <div>No files for ${tfSelectedTech} yet</div>
          <div style="margin-top:6px;font-size:12px;">Upload recalls, invoices, summaries, or notes to reference during 1-on-1s</div>
        </div>`;
      } else {
        html += '<div class="tf-grid">';
        filtered.forEach(f => {
          const typeClass = 'tf-type-' + f.type;
          const label = typeLabels[f.type] || f.type;
          const dateStr = new Date(f.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const sizeStr = f.fileSize ? (f.fileSize < 1024 ? f.fileSize + ' B' : f.fileSize < 1048576 ? (f.fileSize / 1024).toFixed(1) + ' KB' : (f.fileSize / 1048576).toFixed(1) + ' MB') : '';

          html += `<div class="tf-card">
            <span class="tf-card-type ${typeClass}">${label}</span>
            <div class="tf-card-name">${escHtml(f.title)}</div>
            <div class="tf-card-meta">${dateStr}${sizeStr ? ' · ' + sizeStr : ''}${f.fileName ? ' · ' + escHtml(f.fileName) : ''}</div>
            ${f.notes ? `<div class="tf-card-note">${escHtml(f.notes)}</div>` : ''}
            <div class="tf-card-actions">
              ${(f.fileData || tfDriveMap[f.id]) ? `<button class="tf-card-btn" onclick="tfViewFile('${f.id}')">${f.fileData ? 'View' : '\u2601 View'}</button>` : ''}
              ${(f.fileData || tfDriveMap[f.id]) ? `<button class="tf-card-btn" onclick="tfDownloadFile('${f.id}')">${f.fileData ? 'Download' : '\u2601 Download'}</button>` : ''}
              <button class="tf-card-btn" onclick="tfEditFile('${f.id}')">Edit</button>
              <button class="tf-card-btn danger" onclick="tfDeleteFile('${f.id}')">Delete</button>
            </div>
          </div>`;
        });
        html += '</div>';
      }
      main.innerHTML = html;
    }

    function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function tfSelectTech(name) {
      tfSelectedTech = name;
      tfRender();
    }

    function tfOpenUpload() {
      tfEditingId = null;
      tfPendingFileData = null;
      tfPendingFileName = '';
      tfPendingFileSize = 0;
      document.getElementById('tfModalTitle').textContent = 'Upload File for ' + tfSelectedTech;
      document.getElementById('tfType').value = 'recall';
      document.getElementById('tfTitle').value = '';
      document.getElementById('tfNotes').value = '';
      tfResetDropzone();
      document.getElementById('tfOverlay').classList.add('open');
      document.getElementById('tfUploadModal').classList.add('open');
    }

    function tfCloseUpload() {
      document.getElementById('tfOverlay').classList.remove('open');
      document.getElementById('tfUploadModal').classList.remove('open');
    }

    function tfResetDropzone() {
      const dz = document.getElementById('tfDropzone');
      dz.classList.remove('has-file');
      dz.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <div>Drop files here or click to browse</div>
        <div style="font-size:10px;margin-top:4px;opacity:0.7">PDF, images, text — max 4 MB each · select multiple</div>`;
    }

    function tfHandleFile(file) {
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) {
        alert('File too large — max 4 MB. Consider compressing or using a smaller screenshot.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        tfPendingFileData = reader.result;
        tfPendingFileName = file.name;
        tfPendingFileSize = file.size;
        const dz = document.getElementById('tfDropzone');
        dz.classList.add('has-file');
        const sizeStr = file.size < 1024 ? file.size + ' B' : file.size < 1048576 ? (file.size / 1024).toFixed(1) + ' KB' : (file.size / 1048576).toFixed(1) + ' MB';
        dz.innerHTML = `<div class="tf-file-info">✓ ${escHtml(file.name)}</div><div style="font-size:11px;margin-top:4px;">${sizeStr} — click to change</div>`;
        // Auto-fill title from filename if empty
        const titleEl = document.getElementById('tfTitle');
        if (!titleEl.value) {
          titleEl.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        }
      };
      reader.readAsDataURL(file);
    }

    // Batch upload: auto-creates entries for multiple files without the modal form
    async function tfHandleMultipleFiles(fileList) {
      if (!tfFiles[tfSelectedTech]) tfFiles[tfSelectedTech] = [];
      var skipped = 0;
      var added = 0;
      var typeEl = document.getElementById('tfType');
      var defaultType = typeEl ? typeEl.value : 'photo';

      // Close modal if open
      tfCloseUpload();
      _tfShowCloudStatus('syncing');

      for (var i = 0; i < fileList.length; i++) {
        var f = fileList[i];
        if (f.size > 4 * 1024 * 1024) {
          skipped++;
          continue;
        }
        // Read file as data URL
        var dataUrl = await new Promise(function(resolve) {
          var reader = new FileReader();
          reader.onload = function() { resolve(reader.result); };
          reader.onerror = function() { resolve(null); };
          reader.readAsDataURL(f);
        });
        if (!dataUrl) { skipped++; continue; }

        // Auto-detect type from file extension
        var ext = (f.name.match(/\.([^.]+)$/) || [])[1] || '';
        ext = ext.toLowerCase();
        var fileType = defaultType;
        if (['png','jpg','jpeg','gif','webp'].indexOf(ext) > -1) fileType = 'photo';
        else if (ext === 'pdf') fileType = 'other';

        var autoTitle = f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        var newId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
        tfFiles[tfSelectedTech].push({
          id: newId,
          type: fileType,
          title: autoTitle,
          notes: '',
          fileName: f.name,
          fileSize: f.size,
          fileData: dataUrl,
          date: new Date().toISOString()
        });
        added++;
      }

      tfRender();
      await tfSaveAndConfirm();

      // Show result toast
      var msg = added + ' file' + (added !== 1 ? 's' : '') + ' added to ' + tfSelectedTech;
      if (skipped) msg += ' (' + skipped + ' skipped — over 4 MB)';
      var el = document.getElementById('tfCloudStatus');
      if (el) {
        el.className = 'tf-cloud-toast tf-cloud-saved';
        el.innerHTML = '\u2601\uFE0F \u2713 ' + msg;
        setTimeout(function() { el.classList.add('tf-cloud-hide'); }, 4000);
      }
    }

    function tfSaveFile() {
      const title = document.getElementById('tfTitle').value.trim();
      const type = document.getElementById('tfType').value;
      const notes = document.getElementById('tfNotes').value.trim();

      if (!title) {
        alert('Please enter a title.');
        return;
      }

      if (!tfFiles[tfSelectedTech]) tfFiles[tfSelectedTech] = [];

      if (tfEditingId) {
        // Update existing
        const file = tfFiles[tfSelectedTech].find(f => f.id === tfEditingId);
        if (file) {
          file.title = title;
          file.type = type;
          file.notes = notes;
          if (tfPendingFileData) {
            file.fileData = tfPendingFileData;
            file.fileName = tfPendingFileName;
            file.fileSize = tfPendingFileSize;
          }
        }
      } else {
        // New file
        var newId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
        tfFiles[tfSelectedTech].push({
          id: newId,
          type,
          title,
          notes,
          fileName: tfPendingFileName,
          fileSize: tfPendingFileSize,
          fileData: tfPendingFileData,
          date: new Date().toISOString()
        });
      }

      tfCloseUpload();
      tfRender();
      tfSaveAndConfirm(); // save locally + push metadata to cloud
    }

    function tfEditFile(id) {
      const file = (tfFiles[tfSelectedTech] || []).find(f => f.id === id);
      if (!file) return;
      tfEditingId = id;
      tfPendingFileData = null;
      tfPendingFileName = '';
      tfPendingFileSize = 0;
      document.getElementById('tfModalTitle').textContent = 'Edit File';
      document.getElementById('tfType').value = file.type;
      document.getElementById('tfTitle').value = file.title;
      document.getElementById('tfNotes').value = file.notes || '';
      if (file.fileData) {
        const dz = document.getElementById('tfDropzone');
        dz.classList.add('has-file');
        const sizeStr = file.fileSize ? (file.fileSize < 1024 ? file.fileSize + ' B' : file.fileSize < 1048576 ? (file.fileSize / 1024).toFixed(1) + ' KB' : (file.fileSize / 1048576).toFixed(1) + ' MB') : '';
        dz.innerHTML = `<div class="tf-file-info">✓ ${escHtml(file.fileName)}</div><div style="font-size:11px;margin-top:4px;">${sizeStr} — click to replace</div>`;
      } else {
        tfResetDropzone();
      }
      document.getElementById('tfOverlay').classList.add('open');
      document.getElementById('tfUploadModal').classList.add('open');
    }

    function tfDeleteFile(id) {
      if (!confirm('Remove this file?')) return;
      tfFiles[tfSelectedTech] = (tfFiles[tfSelectedTech] || []).filter(f => f.id !== id);
      tfSaveAndConfirm();
      tfRender();
    }

    async function tfViewFile(id) {
      const file = (tfFiles[tfSelectedTech] || []).find(f => f.id === id);
      if (!file) return;

      // If no local data, try fetching from Drive
      if (!file.fileData && tfDriveMap[file.id]) {
        _tfShowCloudStatus('syncing');
        try {
          var data = await _tfFetchFromDrive(tfDriveMap[file.id]);
          if (data) {
            file.fileData = data;
            try { localStorage.setItem(TF_STORAGE_KEY, JSON.stringify(tfFiles)); } catch(e) {}
            _tfShowCloudStatus('saved');
          }
        } catch (err) {
          _tfShowCloudStatus('error');
          alert('Could not load file from cloud.');
          return;
        }
      }
      if (!file.fileData) return;

      // Build inline overlay viewer instead of popup
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;';

      // Header bar with back button, title, and download
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(15,27,46,0.95);flex-shrink:0;';

      const backBtn = document.createElement('button');
      backBtn.textContent = '\u2190 Back';
      backBtn.style.cssText = 'padding:6px 14px;background:#374151;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;';
      backBtn.onclick = function() { overlay.remove(); };

      const titleEl = document.createElement('div');
      titleEl.textContent = file.title;
      titleEl.style.cssText = 'flex:1;color:#fff;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

      const dlBtn = document.createElement('button');
      dlBtn.textContent = '\u2B07 Download';
      dlBtn.style.cssText = 'padding:6px 14px;background:#01696F;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;';
      dlBtn.onclick = function() { tfDownloadFile(id); };

      header.appendChild(backBtn);
      header.appendChild(titleEl);
      header.appendChild(dlBtn);
      overlay.appendChild(header);

      // Content area
      const content = document.createElement('div');
      content.style.cssText = 'flex:1;overflow:auto;display:flex;justify-content:center;align-items:center;padding:16px;';

      if (file.fileData.startsWith('data:image')) {
        const img = document.createElement('img');
        img.src = file.fileData;
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;';
        content.appendChild(img);
      } else if (file.fileData.startsWith('data:application/pdf')) {
        const embed = document.createElement('iframe');
        embed.src = file.fileData;
        embed.style.cssText = 'width:100%;max-width:900px;height:100%;border:none;border-radius:8px;background:rgba(17, 24, 39, 0.6);';
        content.style.alignItems = 'stretch';
        content.appendChild(embed);
      } else {
        const pre = document.createElement('pre');
        try { pre.textContent = atob(file.fileData.split(',')[1] || ''); } catch(e) { pre.textContent = 'Unable to preview this file.'; }
        pre.style.cssText = 'white-space:pre-wrap;padding:20px;font-family:monospace;color:#e0e6f0;max-width:900px;width:100%;';
        content.appendChild(pre);
      }

      overlay.appendChild(content);

      // Close on background click
      overlay.addEventListener('click', function(e) { if (e.target === overlay || e.target === content) overlay.remove(); });

      document.body.appendChild(overlay);
    }

    async function tfDownloadFile(id) {
      const file = (tfFiles[tfSelectedTech] || []).find(f => f.id === id);
      if (!file) return;

      // If no local data, try fetching from Drive
      if (!file.fileData && tfDriveMap[file.id]) {
        _tfShowCloudStatus('syncing');
        try {
          var data = await _tfFetchFromDrive(tfDriveMap[file.id]);
          if (data) {
            file.fileData = data;
            try { localStorage.setItem(TF_STORAGE_KEY, JSON.stringify(tfFiles)); } catch(e) {}
            _tfShowCloudStatus('saved');
          }
        } catch (err) {
          _tfShowCloudStatus('error');
          return;
        }
      }
      if (!file.fileData) return;
      const a = document.createElement('a');
      a.href = file.fileData;
      a.download = file.fileName || file.title;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    // Dropzone event wiring
    (function() {
      const dz = document.getElementById('tfDropzone');
      const fi = document.getElementById('tfFileInput');
      dz.addEventListener('click', () => fi.click());
      fi.addEventListener('change', () => {
        if (fi.files.length > 1) {
          tfHandleMultipleFiles(fi.files);
        } else if (fi.files[0]) {
          tfHandleFile(fi.files[0]);
        }
        fi.value = ''; // reset so same files can be re-selected
      });
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        dz.classList.remove('dragover');
        if (e.dataTransfer.files.length > 1) {
          tfHandleMultipleFiles(e.dataTransfer.files);
        } else if (e.dataTransfer.files[0]) {
          tfHandleFile(e.dataTransfer.files[0]);
        }
      });
    })();

    // Init Tech Files
    tfLoad();
    // Auto-seed disabled per user request (was auto-injecting score PDFs into every tech)
    // _tfSeedScorePDFs();
    // One-time cleanup: remove any previously auto-seeded scorecard entries
    (function _tfCleanupSeededScorecards() {
      try {
        var cleanupKey = 'snappy_tf_cleanup_scorecard_v1';
        if (localStorage.getItem(cleanupKey)) return;
        var changed = false;
        Object.keys(tfFiles || {}).forEach(function(tech) {
          if (!Array.isArray(tfFiles[tech])) return;
          var before = tfFiles[tech].length;
          tfFiles[tech] = tfFiles[tech].filter(function(f) { return f && f.type !== 'scorecard'; });
          if (tfFiles[tech].length !== before) changed = true;
          if (tfFiles[tech].length === 0) delete tfFiles[tech];
        });
        if (changed) tfSave();
        localStorage.setItem(cleanupKey, '1');
        // Clear the old seed flag so nothing fights the cleanup
        localStorage.removeItem('snappy_tf_seeded_v1');
      } catch(e) { console.warn('Tech Files cleanup failed:', e); }
    })();
    tfRender();

    // ========== SKILLS SYSTEM DOC MODAL ==========
    function openSkillsDoc(sectionId) {
      document.getElementById('docOverlay').classList.add('open');
      document.getElementById('docModal').classList.add('open');
      document.body.style.overflow = 'hidden';
      if (sectionId) {
        setTimeout(() => scrollDocTo(sectionId), 100);
      }
    }
    function closeSkillsDoc() {
      document.getElementById('docOverlay').classList.remove('open');
      document.getElementById('docModal').classList.remove('open');
      document.body.style.overflow = '';
    }
    function scrollDocTo(sectionId) {
      const el = document.getElementById('doc-' + sectionId);
      const body = document.getElementById('docBody');
      if (el && body) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Update active nav button
        document.querySelectorAll('.doc-nav-btn').forEach(btn => btn.classList.remove('active'));
        const btns = document.querySelectorAll('.doc-nav-btn');
        btns.forEach(btn => {
          if (btn.getAttribute('onclick').includes(sectionId)) {
            btn.classList.add('active');
          }
        });
      }
    }
    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('docModal').classList.contains('open')) {
        closeSkillsDoc();
      }
    });
    // Track scroll position to highlight active nav
    (function() {
      const docBody = document.getElementById('docBody');
      if (!docBody) return;
      docBody.addEventListener('scroll', () => {
        const sections = docBody.querySelectorAll('[id^="doc-"]');
        let activeId = '';
        sections.forEach(s => {
          const rect = s.getBoundingClientRect();
          const bodyRect = docBody.getBoundingClientRect();
          if (rect.top <= bodyRect.top + 80) {
            activeId = s.id.replace('doc-', '');
          }
        });
        if (activeId) {
          document.querySelectorAll('.doc-nav-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('onclick').includes(activeId)) {
              btn.classList.add('active');
            }
          });
        }
      });
    })();

    // ========== DISPATCH BOARD ==========
    const DISP_STORAGE = 'snappy_dispatch_v1';
    const DISP_TAG_COLORS = [
      { bg: '#E8F5F5', text: '#1A6B6B' },
      { bg: '#FFF3E0', text: '#B8650A' },
      { bg: '#F3E5F5', text: '#6A1B7A' },
      { bg: '#E3F2FD', text: '#1565C0' },
      { bg: '#FCE4EC', text: '#AD1457' },
      { bg: '#E8F5E9', text: '#2E7D32' },
      { bg: '#FFF8E1', text: '#F57F17' },
      { bg: '#EFEBE9', text: '#5D4037' },
      { bg: '#E0F7FA', text: '#00838F' },
      { bg: '#FBE9E7', text: '#D84315' }
    ];
    const DISP_MAX_TAGS = 10;
    // Premium tags worth 1 full point toward composite (all others +0.25)
    const DISP_PREMIUM_TAGS = ['Lead Tech', 'Ride Along Trainer', 'Warranty Tech'];
    function calcDispatchBonus(tags) {
      var bonus = 0;
      (tags || []).forEach(function(tag) {
        bonus += DISP_PREMIUM_TAGS.includes(tag) ? 1.0 : 0.25;
      });
      return bonus;
    }

    // Sold/Billable Hour Efficiency Bonus — composite score boost based on MTD on-job %
    // Uses mtd_on_job_pct (month-to-date from ST screenshots), NOT 90-day productivity
    // <30% = +0, 30-39% = +0.50, 40-49% = +1.00, 50-59% = +1.50, 60%+ = +2.00
    function calcEfficiencyBonus(tech) {
      var st = stData.find(function(s) { return s.name === tech.short; });
      var pct = st ? (st.mtd_on_job_pct || 0) : 0;
      if (pct >= 60) return { bonus: 2.00, label: 'Elite', pct: pct };
      if (pct >= 50) return { bonus: 1.50, label: 'High Performer', pct: pct };
      if (pct >= 40) return { bonus: 1.00, label: 'Above Average', pct: pct };
      if (pct >= 30) return { bonus: 0.50, label: 'Average', pct: pct };
      return { bonus: 0, label: 'Below Average', pct: pct };
    }
    const DISP_DEFAULT_TAGS = [
      'Lead Tech',
      'Ride Along Trainer',
      'Warranty Tech',
      'Diagnostics',
      'Install / Changeout',
      'Maintenance',
      'Sales Capable',
      'Solo Approved'
    ];

    function dispLoad() {
      try {
        const raw = localStorage.getItem(DISP_STORAGE);
        if (raw) {
          var data = JSON.parse(raw);
          // Migration v1: ensure premium tags exist in tag pool (runs once)
          if (!data._migV1) {
            var migrated = false;
            DISP_PREMIUM_TAGS.forEach(function(pt) {
              if (!data.tags.includes(pt)) { data.tags.unshift(pt); migrated = true; }
            });
            // Auto-assign premium + corrected standard tags
            var tagMigrations = {
              'Chris':  ['Lead Tech'],
              'Dewone': ['Ride Along Trainer'],
              'Dee':    ['Warranty Tech', 'Diagnostics', 'Install / Changeout'],
              'Daniel': ['Install / Changeout', 'Sales Capable']
            };
            Object.keys(tagMigrations).forEach(function(tech) {
              if (!data.assignments[tech]) data.assignments[tech] = [];
              tagMigrations[tech].forEach(function(tag) {
                if (!data.assignments[tech].includes(tag)) {
                  if (DISP_PREMIUM_TAGS.includes(tag)) data.assignments[tech].unshift(tag);
                  else data.assignments[tech].push(tag);
                  migrated = true;
                }
              });
            });
            data._migV1 = true;
            localStorage.setItem(DISP_STORAGE, JSON.stringify(data));
          }
          return data;
        }
      } catch(e) {}
      // Defaults
      return {
        tags: DISP_DEFAULT_TAGS.slice(),
        assignments: {
          'Chris':  ['Lead Tech', 'Diagnostics', 'Install / Changeout', 'Sales Capable', 'Solo Approved'],
          'Dewone': ['Ride Along Trainer', 'Maintenance', 'Sales Capable'],
          'Benji':  ['Diagnostics', 'Maintenance'],
          'Daniel': ['Diagnostics', 'Install / Changeout', 'Maintenance', 'Sales Capable'],
          'Dee':    ['Warranty Tech', 'Diagnostics', 'Install / Changeout', 'Maintenance']
        }
      };
    }
    function dispSave(data) {
      localStorage.setItem(DISP_STORAGE, JSON.stringify(data));
      localStorage.setItem(DISP_STORAGE + '_localMod', String(Date.now()));
      if (SyncEngine.isConfigured()) SyncEngine.write('dispatch', data);
    }
    const DISP_PREMIUM_COLOR = { bg: 'rgba(251,191,36,0.15)', text: '#FCD34D' };
    function dispTagColor(tagName, allTags) {
      if (DISP_PREMIUM_TAGS.includes(tagName)) return DISP_PREMIUM_COLOR;
      const idx = allTags.indexOf(tagName);
      return DISP_TAG_COLORS[idx % DISP_TAG_COLORS.length];
    }

    function renderDispatchBoard() {
      const data = dispLoad();
      const pool = document.getElementById('dispTagPool');
      const grid = document.getElementById('dispGrid');
      if (!pool || !grid) return;

      // Render tag pool
      pool.innerHTML = data.tags.map(tag => {
        const c = dispTagColor(tag, data.tags);
        const isPremium = DISP_PREMIUM_TAGS.includes(tag);
        const premiumBadge = isPremium ? '<span style="font-size:10px;margin-left:4px;opacity:0.8" title="+1.0 pt">&#9733;</span>' : '';
        const borderStyle = isPremium ? 'border:1.5px solid rgba(251,191,36,0.4);' : '';
        return `<span class="disp-pool-tag" draggable="true" data-tag="${escHtml(tag)}" style="background:${c.bg};color:${c.text};${borderStyle}">${escHtml(tag)}${premiumBadge}<span class="disp-tag-x" title="Delete tag" data-del="${escHtml(tag)}">&times;</span></span>`;
      }).join('');

      // Drag from pool
      let dispSelectedTag = null;
      pool.querySelectorAll('.disp-pool-tag').forEach(el => {
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', el.dataset.tag);
          e.dataTransfer.effectAllowed = 'copy';
        });
        // Tap to select (mobile)
        el.addEventListener('click', (e) => {
          if (e.target.classList.contains('disp-tag-x')) return;
          if (dispSelectedTag === el.dataset.tag) {
            dispSelectedTag = null;
            pool.querySelectorAll('.disp-pool-tag').forEach(p => p.style.outline = '');
          } else {
            dispSelectedTag = el.dataset.tag;
            pool.querySelectorAll('.disp-pool-tag').forEach(p => p.style.outline = '');
            el.style.outline = '2.5px solid var(--accent-teal)';
          }
        });
      });

      // Delete tag from pool
      pool.querySelectorAll('.disp-tag-x').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!canEditDispatch()) { alert('Viewing mode — editing is disabled.'); return; }
          const tag = el.dataset.del;
          if (!confirm('Remove "' + tag + '" tag from all techs?')) return;
          data.tags = data.tags.filter(t => t !== tag);
          Object.keys(data.assignments).forEach(tech => {
            data.assignments[tech] = (data.assignments[tech] || []).filter(t => t !== tag);
          });
          dispSave(data);
          renderDispatchBoard();
        });
      });

      // Tech avatars map
      const avatarMap = { Chris: 'chris_avatar.png', Dewone: 'dewone_avatar.png', Benji: 'benji_avatar.png', Daniel: 'daniel_avatar.png', Dee: 'dee_avatar.png' };
      const dispTierColors = { S: 'linear-gradient(135deg,#ff6ec4,#7873f5,#4adede)', A: '#7C3AED', B: '#3B82F6', C: '#94A3B8' };

      // Render tech cards
      const techOrder = ['Chris','Dewone','Benji','Daniel','Dee'];
      let cardsHtml = '<div class="disp-grid">';
      techOrder.forEach(tech => {
        const t = techs.find(x => x.short === tech);
        const tierInfo = t ? getTechTier(t) : { tier: 'C' };
        const tier = tierInfo.tier;
        const assigned = data.assignments[tech] || [];
        const count = assigned.length;
        const tierBg = dispTierColors[tier] || dispTierColors.C;
        const tierStyle = tier === 'S' ? `background:${tierBg};` : `background:${tierBg};`;

        cardsHtml += `<div class="disp-tech-card" data-tech="${tech}">`;
        cardsHtml += `<div class="disp-tech-header">`;
        cardsHtml += `<img class="disp-tech-avatar" src="${avatarMap[tech]}" alt="${tech}">`;
        cardsHtml += `<div><div class="disp-tech-name">${tech}</div></div>`;
        cardsHtml += `<span class="disp-tech-tier" style="${tierStyle}">${tier}-Tier</span>`;
        cardsHtml += `</div>`;
        cardsHtml += `<div class="disp-tech-tags" data-tech="${tech}">`;
        if (count === 0) {
          cardsHtml += `<span class="disp-empty-hint">Drag tags here (max ${DISP_MAX_TAGS})</span>`;
        } else {
          assigned.forEach(tag => {
            const c = dispTagColor(tag, data.tags);
            const isPremium = DISP_PREMIUM_TAGS.includes(tag);
            const premiumBadge = isPremium ? '<span style="font-size:10px;margin-left:3px;opacity:0.8" title="+1.0 pt">&#9733;</span>' : '';
            const borderStyle = isPremium ? 'border:1.5px solid rgba(251,191,36,0.4);' : '';
            cardsHtml += `<span class="disp-assigned-tag" draggable="true" data-tag="${escHtml(tag)}" style="background:${c.bg};color:${c.text};${borderStyle}">${escHtml(tag)}${premiumBadge}<span class="disp-remove-tag" data-tech="${tech}" data-rtag="${escHtml(tag)}">&times;</span></span>`;
          });
        }
        cardsHtml += `</div>`;
        cardsHtml += `<div class="disp-tag-count ${count >= DISP_MAX_TAGS ? 'at-limit' : ''}">${count} / ${DISP_MAX_TAGS} tags</div>`;
        const techBonus = calcDispatchBonus(assigned);
        cardsHtml += `<div class="disp-tag-points"><span class="disp-pts-icon">&#9889;</span> +${techBonus.toFixed(2)} pts to composite</div>`;
        cardsHtml += `</div>`;
      });
      cardsHtml += '</div>';

      // Quick-view matrix
      cardsHtml += '<div class="disp-matrix-wrap"><table class="disp-matrix"><thead><tr><th style="min-width:160px">Tag</th>';
      techOrder.forEach(tech => { cardsHtml += `<th>${tech}</th>`; });
      cardsHtml += '</tr></thead><tbody>';
      data.tags.forEach(tag => {
        const c = dispTagColor(tag, data.tags);
        const isPremium = DISP_PREMIUM_TAGS.includes(tag);
        const starIcon = isPremium ? ' <span style="font-size:11px" title="+1.0 pt">&#9733;</span>' : '';
        cardsHtml += `<tr><td style="color:${c.text};font-weight:600">${escHtml(tag)}${starIcon}</td>`;
        techOrder.forEach(tech => {
          const has = (data.assignments[tech] || []).includes(tag);
          cardsHtml += `<td>${has ? '<span class="disp-check">&check;</span>' : '<span class="disp-no">&ndash;</span>'}</td>`;
        });
        cardsHtml += '</tr>';
      });
      cardsHtml += '</tbody></table></div>';

      grid.innerHTML = cardsHtml;

      // Wire up drop zones + tap-to-assign
      grid.querySelectorAll('.disp-tech-tags').forEach(zone => {
        zone.addEventListener('dragover', (e) => {
          e.preventDefault();
          zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', (e) => {
          e.preventDefault();
          zone.classList.remove('drag-over');
          if (!canEditDispatch()) return;
          const tag = e.dataTransfer.getData('text/plain');
          const tech = zone.dataset.tech;
          const d = dispLoad();
          if (!d.assignments[tech]) d.assignments[tech] = [];
          if (d.assignments[tech].includes(tag)) return;
          if (d.assignments[tech].length >= DISP_MAX_TAGS) {
            alert(tech + ' already has ' + DISP_MAX_TAGS + ' tags (max). Remove one first.');
            return;
          }
          d.assignments[tech].push(tag);
          dispSave(d);
          renderDispatchBoard();
        });
        // Tap-to-assign (mobile): if a pool tag is selected, tap card to assign
        zone.addEventListener('click', (e) => {
          if (e.target.closest('.disp-remove-tag')) return;
          if (!dispSelectedTag) return;
          const tech = zone.dataset.tech;
          const d = dispLoad();
          if (!d.assignments[tech]) d.assignments[tech] = [];
          if (d.assignments[tech].includes(dispSelectedTag)) { dispSelectedTag = null; pool.querySelectorAll('.disp-pool-tag').forEach(p => p.style.outline = ''); return; }
          if (d.assignments[tech].length >= DISP_MAX_TAGS) {
            alert(tech + ' already has ' + DISP_MAX_TAGS + ' tags (max). Remove one first.');
            return;
          }
          d.assignments[tech].push(dispSelectedTag);
          dispSave(d);
          dispSelectedTag = null;
          pool.querySelectorAll('.disp-pool-tag').forEach(p => p.style.outline = '');
          renderDispatchBoard();
        });
      });

      // Wire up remove buttons
      grid.querySelectorAll('.disp-remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!canEditDispatch()) { alert('Viewing mode — editing is disabled.'); return; }
          const tech = btn.dataset.tech;
          const tag = btn.dataset.rtag;
          const d = dispLoad();
          d.assignments[tech] = (d.assignments[tech] || []).filter(t => t !== tag);
          dispSave(d);
          renderDispatchBoard();
        });
      });
    }

    // Add tag button
    document.getElementById('dispAddTagBtn').addEventListener('click', () => {
      if (!requireManager()) return;
      const input = document.getElementById('dispNewTag');
      const name = input.value.trim();
      if (!name) return;
      const d = dispLoad();
      if (d.tags.some(t => t.toLowerCase() === name.toLowerCase())) {
        alert('Tag "' + name + '" already exists.');
        return;
      }
      d.tags.push(name);
      dispSave(d);
      input.value = '';
      renderDispatchBoard();
    });
    document.getElementById('dispNewTag').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('dispAddTagBtn').click();
    });

    // ========== RECALL & COMPLAINT LOGS ==========
    const RECALL_STORAGE = 'snappy_recall_log_v1';
    const COMPLAINT_STORAGE = 'snappy_complaint_log_v1';

    function loadLogData(storageKey) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) return JSON.parse(raw);
      } catch(e) {}
      return {}; // { 'Chris': [{id, date, jobNum, ts}], ... }
    }

    function saveLogData(storageKey, data) {
      localStorage.setItem(storageKey, JSON.stringify(data));
      // Sync to cloud under a recognizable key
      if (SyncEngine.isConfigured()) {
        if (storageKey === RECALL_STORAGE) SyncEngine.write('recall', data);
        if (storageKey === COMPLAINT_STORAGE) SyncEngine.write('complaint', data);
      }
      // Re-render tech profiles + overview so recall/complaint counts stay in sync
      try { if (typeof renderProfiles === 'function') renderProfiles(); } catch(e) {}
      try { if (typeof renderOverviewTab === 'function') renderOverviewTab(); } catch(e) {}
    }

    function addLogEntry(storageKey, tech) {
      if (!canEditDispatch()) { alert('Viewing mode \u2014 editing is disabled.'); return; }
      const date = prompt('Enter date (e.g. 04/19/2026):');
      if (!date || !date.trim()) return;
      const jobNum = prompt('Enter job number:');
      if (!jobNum || !jobNum.trim()) return;
      const data = loadLogData(storageKey);
      if (!data[tech]) data[tech] = [];
      data[tech].push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), date: date.trim(), jobNum: jobNum.trim(), ts: Date.now() });
      saveLogData(storageKey, data);
      renderRecallLog();
      renderComplaintLog();
    }

    function deleteLogEntry(storageKey, tech, entryId) {
      if (!canEditDispatch()) { alert('Viewing mode \u2014 editing is disabled.'); return; }
      if (!confirm('Remove this entry?')) return;
      const data = loadLogData(storageKey);
      if (data[tech]) {
        data[tech] = data[tech].filter(e => e.id !== entryId);
        if (data[tech].length === 0) delete data[tech];
      }
      saveLogData(storageKey, data);
      renderRecallLog();
      renderComplaintLog();
    }

    function renderLogSection(storageKey, containerId, logType) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const data = loadLogData(storageKey);
      const techOrder = ['Chris','Dewone','Benji','Daniel','Dee'];
      const avatarMap = { Chris: 'chris_avatar.png', Dewone: 'dewone_avatar.png', Benji: 'benji_avatar.png', Daniel: 'daniel_avatar.png', Dee: 'dee_avatar.png' };
      const dispTierColors = { S: 'linear-gradient(135deg,#ff6ec4,#7873f5,#4adede)', A: '#7C3AED', B: '#3B82F6', C: '#94A3B8' };
      const typeColors = logType === 'recall'
        ? { cardBorder: '#FF9800', badge: '#FF9800', badgeBg: 'rgba(255,152,0,0.12)', addBtn: '#FF9800', addBtnHover: '#F57C00' }
        : { cardBorder: '#EF5350', badge: '#EF5350', badgeBg: 'rgba(239,83,80,0.12)', addBtn: '#EF5350', addBtnHover: '#D32F2F' };

      let html = '<div class="disp-log-cards">';
      techOrder.forEach(tech => {
        const t = techs.find(x => x.short === tech);
        const tierInfo = t ? getTechTier(t) : { tier: 'C' };
        const tier = tierInfo.tier;
        const tierBg = dispTierColors[tier] || dispTierColors.C;
        const entries = data[tech] || [];
        const count = entries.length;

        html += `<div class="disp-log-card" style="border-top:3px solid ${typeColors.cardBorder}">`;
        html += `<div class="disp-log-card-header">`;
        html += `<img class="disp-tech-avatar" src="${avatarMap[tech]}" alt="${tech}">`;
        html += `<div class="disp-log-card-name">${tech}</div>`;
        html += `<span class="disp-log-count-badge" style="background:${typeColors.badgeBg};color:${typeColors.badge}">${count}</span>`;
        html += `<button class="disp-log-add-btn" data-logtype="${logType}" data-tech="${tech}" style="background:${typeColors.addBtn}" onmouseover="this.style.background='${typeColors.addBtnHover}'" onmouseout="this.style.background='${typeColors.addBtn}'">+ Add</button>`;
        html += `</div>`;

        if (count === 0) {
          html += `<div class="disp-log-empty">No ${logType === 'recall' ? 'recalls' : 'complaints'} logged</div>`;
        } else {
          html += `<div class="disp-log-entries">`;
          // Sort newest first
          const sorted = entries.slice().sort((a,b) => (b.ts||0) - (a.ts||0));
          sorted.forEach(entry => {
            html += `<div class="disp-log-entry">`;
            html += `<div class="disp-log-entry-info">`;
            html += `<span class="disp-log-entry-date">${escHtml(entry.date)}</span>`;
            html += `<span class="disp-log-entry-job">Job #${escHtml(entry.jobNum)}</span>`;
            html += `</div>`;
            html += `<button class="disp-log-delete-btn" data-logtype="${logType}" data-tech="${tech}" data-entryid="${entry.id}" title="Remove">&times;</button>`;
            html += `</div>`;
          });
          html += `</div>`;
        }
        html += `</div>`;
      });
      html += '</div>';
      container.innerHTML = html;

      // Wire up add buttons
      container.querySelectorAll('.disp-log-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const sk = btn.dataset.logtype === 'recall' ? RECALL_STORAGE : COMPLAINT_STORAGE;
          addLogEntry(sk, btn.dataset.tech);
        });
      });

      // Wire up delete buttons
      container.querySelectorAll('.disp-log-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const sk = btn.dataset.logtype === 'recall' ? RECALL_STORAGE : COMPLAINT_STORAGE;
          deleteLogEntry(sk, btn.dataset.tech, btn.dataset.entryid);
        });
      });
    }

    function renderRecallLog() {
      renderLogSection(RECALL_STORAGE, 'recallGrid', 'recall');
    }
    function renderComplaintLog() {
      renderLogSection(COMPLAINT_STORAGE, 'complaintGrid', 'complaint');
    }

    // ========== RECALL/COMPLAINT HELPERS FOR CROSS-MATRIX DISPLAY ==========
    function getRecallCount(tech) {
      var data = loadLogData(RECALL_STORAGE);
      return (data[tech] || []).length;
    }
    function getComplaintCount(tech) {
      var data = loadLogData(COMPLAINT_STORAGE);
      return (data[tech] || []).length;
    }
    function getRecallEntries(tech) {
      var data = loadLogData(RECALL_STORAGE);
      return (data[tech] || []).slice().sort(function(a,b) { return (b.ts||0) - (a.ts||0); });
    }
    function getComplaintEntries(tech) {
      var data = loadLogData(COMPLAINT_STORAGE);
      return (data[tech] || []).slice().sort(function(a,b) { return (b.ts||0) - (a.ts||0); });
    }
    function getTotalRecalls() {
      var data = loadLogData(RECALL_STORAGE);
      var count = 0;
      for (var k in data) count += (data[k] || []).length;
      return count;
    }
    function getTotalComplaints() {
      var data = loadLogData(COMPLAINT_STORAGE);
      var count = 0;
      for (var k in data) count += (data[k] || []).length;
      return count;
    }

    // ========== MANAGER NOTES EDIT SYSTEM ==========
    var MGR_NOTES_KEY = 'snappy_mgr_notes_v1';

    function loadMgrNotes() {
      try { return JSON.parse(localStorage.getItem(MGR_NOTES_KEY)) || {}; } catch(e) { return {}; }
    }
    function saveMgrNotesStore(data) {
      localStorage.setItem(MGR_NOTES_KEY, JSON.stringify(data));
      if (SyncEngine.isConfigured()) SyncEngine.write('mgrnotes', data);
    }
    function getMgrNote(techShort, fallback) {
      var notes = loadMgrNotes();
      return notes[techShort] !== undefined ? notes[techShort] : (fallback || '');
    }
    window.getMgrNote = getMgrNote;

    window.toggleMgrNoteEdit = function(techShort) {
      var display = document.getElementById('mgr-notes-display-' + techShort);
      var editor = document.getElementById('mgr-notes-editor-' + techShort);
      if (!display || !editor) return;
      display.style.display = 'none';
      editor.style.display = 'block';
      var ta = document.getElementById('mgr-notes-ta-' + techShort);
      if (ta) ta.focus();
    };

    window.saveMgrNote = function(techShort) {
      var ta = document.getElementById('mgr-notes-ta-' + techShort);
      if (!ta) return;
      var notes = loadMgrNotes();
      notes[techShort] = ta.value.trim();
      saveMgrNotesStore(notes);
      // Update display
      var display = document.getElementById('mgr-notes-display-' + techShort);
      var editor = document.getElementById('mgr-notes-editor-' + techShort);
      if (display) {
        display.innerHTML = '<p>' + (notes[techShort] || '(No notes)') + '</p>';
        display.style.display = '';
      }
      if (editor) editor.style.display = 'none';
      // Also update the tech object so leaderboard etc. reflect it
      var tech = techs.find(function(t) { return t.short === techShort; });
      if (tech) tech.managerNotes = notes[techShort];
    };

    window.cancelMgrNoteEdit = function(techShort) {
      var display = document.getElementById('mgr-notes-display-' + techShort);
      var editor = document.getElementById('mgr-notes-editor-' + techShort);
      if (display) display.style.display = '';
      if (editor) editor.style.display = 'none';
    };

    // Load any saved overrides on startup
    (function applyMgrNoteOverrides() {
      var notes = loadMgrNotes();
      Object.keys(notes).forEach(function(techShort) {
        var tech = techs.find(function(t) { return t.short === techShort; });
        if (tech && notes[techShort]) tech.managerNotes = notes[techShort];
      });
    })();

    // ========== SIDEBAR TOOLTIP POSITIONING ==========
    (function initSidebarTooltips() {
      var mainNavTabs = document.querySelectorAll('.nav-tabs:not(#as-sub-tabs):not(#sk-sub-tabs):not(#mgr-sub-tabs):not(#st-sub-tabs) > .nav-tab');
      mainNavTabs.forEach(function(tab) {
        var tooltip = tab.querySelector('.nav-tooltip');
        if (!tooltip) return;
        tab.addEventListener('mouseenter', function() {
          var rect = tab.getBoundingClientRect();
          tooltip.style.left = (rect.right + 12) + 'px';
          tooltip.style.top = (rect.top + rect.height / 2) + 'px';
          tooltip.style.transform = 'translateY(-50%)';
        });
      });
    })();

    // ========== INIT ==========
    renderOverviewTab();
    renderKPIs();
    // Delay radar render to ensure container has dimensions and THREE is loaded
    setTimeout(function() { renderRadar(); }, 300);
    renderBar();
    renderGroupedBar();
    setTimeout(function() { renderSTRadar(); }, 400);
    renderMatrix();
    renderAptitudeSkills();
    renderProfiles();
    renderRookieCards();
    renderProgression();
    renderSTKPIs();
    renderSTTables();
    renderSTCharts();
    renderSkillsTags();
    // Auto-mark NEW badges as seen after 3s on initial load
    setTimeout(function() { _markNewSkillsSeen(); }, 3000);
    renderManagerTab();
    renderDispatchBoard();
    renderRecallLog();
    renderComplaintLog();
// PDF data loaded from pdf_data.js

function openEmbeddedPDF(filename) {
  const b64 = PDF_BASE64[filename];
  if (!b64) { alert('PDF not found: ' + filename); return; }

  // Decode base64 to Uint8Array for PDF.js
  var byteChars = atob(b64);
  var byteArray = new Uint8Array(byteChars.length);
  for (var i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i);
  }

  // Remove any existing viewer
  var existing = document.getElementById('pdfViewerOverlay');
  if (existing) existing.remove();

  // Create full-page overlay
  var overlay = document.createElement('div');
  overlay.id = 'pdfViewerOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;background:rgba(0,0,0,0.88);display:flex;flex-direction:column;align-items:center;';

  // Header bar
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:100%;max-width:900px;padding:12px 16px;flex-shrink:0;';

  var titleEl = document.createElement('span');
  titleEl.textContent = filename.replace(/_/g, ' ').replace('.pdf', '');
  titleEl.style.cssText = 'color:#fff;font-size:16px;font-weight:600;text-transform:capitalize;';

  var pageInfo = document.createElement('span');
  pageInfo.id = 'pdfPageInfo';
  pageInfo.style.cssText = 'color:#aaa;font-size:13px;font-weight:500;';

  var btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display:flex;gap:8px;align-items:center;';

  var closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00D7 Close';
  closeBtn.style.cssText = 'padding:8px 16px;background:#555;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;';
  closeBtn.onclick = function() { overlay.remove(); };

  btnGroup.appendChild(pageInfo);
  btnGroup.appendChild(closeBtn);
  header.appendChild(titleEl);
  header.appendChild(btnGroup);
  overlay.appendChild(header);

  // Scrollable container for rendered pages
  var scrollContainer = document.createElement('div');
  scrollContainer.id = 'pdfScrollContainer';
  scrollContainer.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;width:100%;display:flex;flex-direction:column;align-items:center;padding:0 16px 24px;-webkit-overflow-scrolling:touch;';
  overlay.appendChild(scrollContainer);

  // Close on overlay background click (not on content)
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay || e.target === scrollContainer) overlay.remove();
  });

  document.body.appendChild(overlay);

  // Loading indicator
  var loadingEl = document.createElement('div');
  loadingEl.textContent = 'Loading PDF...';
  loadingEl.style.cssText = 'color:#fff;font-size:15px;padding:40px;';
  scrollContainer.appendChild(loadingEl);

  // Render all pages using PDF.js
  var loadingTask = pdfjsLib.getDocument({ data: byteArray });
  loadingTask.promise.then(function(pdf) {
    scrollContainer.removeChild(loadingEl);
    var totalPages = pdf.numPages;
    pageInfo.textContent = totalPages + ' page' + (totalPages === 1 ? '' : 's');

    // Determine scale: fit within container width (max 900px) at 2x for retina
    var containerWidth = Math.min(900, window.innerWidth - 32);
    var devicePixelRatio = window.devicePixelRatio || 1;

    for (var p = 1; p <= totalPages; p++) {
      (function(pageNum) {
        pdf.getPage(pageNum).then(function(page) {
          // Calculate scale to fit container width
          var unscaledViewport = page.getViewport({ scale: 1 });
          var scale = containerWidth / unscaledViewport.width;
          var viewport = page.getViewport({ scale: scale * devicePixelRatio });

          // Canvas for this page
          var canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.cssText = 'width:' + (viewport.width / devicePixelRatio) + 'px;height:' + (viewport.height / devicePixelRatio) + 'px;margin-bottom:8px;border-radius:4px;background:rgba(17, 24, 39, 0.6);display:block;';

          // Page wrapper to maintain order
          var wrapper = document.createElement('div');
          wrapper.dataset.page = pageNum;
          wrapper.style.cssText = 'order:' + pageNum + ';display:flex;justify-content:center;';
          wrapper.appendChild(canvas);
          scrollContainer.appendChild(wrapper);

          var ctx = canvas.getContext('2d');
          page.render({ canvasContext: ctx, viewport: viewport });
        });
      })(p);
    }
  }).catch(function(err) {
    loadingEl.textContent = 'Error loading PDF: ' + err.message;
    loadingEl.style.color = '#ff6b6b';
  });
}
