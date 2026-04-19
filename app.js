// ========== ACCESS CONTROL (Manager vs Viewer) ==========
const MGR_PIN = '3433';
let isManagerMode = localStorage.getItem('snappy_mgr_mode') === 'true';

function applyViewMode() {
  if (isManagerMode) {
    document.body.classList.remove('viewer-mode');
    document.body.classList.add('manager-mode');
  } else {
    document.body.classList.add('viewer-mode');
    document.body.classList.remove('manager-mode');
  }
  // Update header subtitle
  var sub = document.getElementById('headerSubtitle');
  if (sub) sub.textContent = isManagerMode ? 'Tech Skills Matrix \u2014 Manager View' : 'Tech Skills Matrix \u2014 Viewer Mode';
  // Update lock icon (open vs closed)
  var lockSvg = document.getElementById('lockIcon');
  if (lockSvg) {
    lockSvg.innerHTML = isManagerMode
      ? '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5"/>'
      : '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
  }
  // If switching to viewer while on Manager tab, redirect to Overview
  if (!isManagerMode) {
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

function promptManagerPIN() {
  if (isManagerMode) {
    // Already manager — offer to lock
    if (confirm('Lock manager mode?')) {
      isManagerMode = false;
      localStorage.removeItem('snappy_mgr_mode');
      applyViewMode();
    }
    return;
  }
  var pin = prompt('Enter manager PIN:');
  if (pin === MGR_PIN) {
    isManagerMode = true;
    localStorage.setItem('snappy_mgr_mode', 'true');
    applyViewMode();
  } else if (pin !== null) {
    alert('Incorrect PIN.');
  }
}

// Guard for edit actions — call before any write/edit operation
function requireManager() {
  if (isManagerMode) return true;
  alert('Viewing mode — editing is disabled.');
  return false;
}

// Apply mode immediately
applyViewMode();

// ========== CLOUD SYNC ENGINE ==========
// Google Apps Script Web App URL — set after deploying the script
let SYNC_URL = localStorage.getItem('snappy_sync_url') || '';

const SyncEngine = {
  _pendingWrites: {},
  _writeTimer: null,
  _debounceMs: 2000, // batch writes within 2 seconds

  // Set the Apps Script URL and persist it
  setUrl(url) {
    SYNC_URL = url.trim();
    localStorage.setItem('snappy_sync_url', SYNC_URL);
  },

  getUrl() { return SYNC_URL; },

  isConfigured() { return SYNC_URL.length > 10; },

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
      throw new Error('Bad response');
    } catch (e) {
      console.warn('Sync pull failed:', e);
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

// Cloud sync initialization — runs after page loads
async function initCloudSync() {
  const cloudData = await SyncEngine.pull();
  if (!cloudData) return;

  // For each data store: if cloud has data AND it's newer than local, use cloud version
  const keyMap = {
    'skills': 'snappy_skills_assignments',
    'manager': 'snappy_manager_entries',
    'techfiles': 'snappy_tech_files',
    'dispatch': 'snappy_dispatch_v1',
    'dailyduties': 'snappy_daily_duties',
    'mgrstats': 'snappy_mgr_stats',
    'daynotes': 'snappy_day_notes',
    'nexstar': 'snappy_nexstar',
    'bulletin': 'snappy_bulletin_board'
  };

  let needsReload = false;
  for (const [cloudKey, localKey] of Object.entries(keyMap)) {
    if (cloudData[cloudKey]) {
      // API may return 'data' or 'val' depending on version
      const cloudVal = cloudData[cloudKey].data || cloudData[cloudKey].val || '';
      const localVal = localStorage.getItem(localKey);
      if (cloudVal && cloudVal !== localVal) {
        localStorage.setItem(localKey, cloudVal);
        needsReload = true;
      }
    }
  }

  if (needsReload) {
    console.log('Cloud data loaded — refreshing views');
    // Reload the page to pick up cloud data
    location.reload();
  }
}

// Manual sync button — push + pull + cache reset + hard reload
async function manualSync() {
  var btn = document.getElementById('syncNowBtn');
  if (!SyncEngine.isConfigured()) {
    openSyncSetup();
    return;
  }
  btn.classList.add('syncing');
  try {
    // 1. Push all local data to cloud
    SyncEngine.write('skills', skillsData.assignments);
    SyncEngine.write('manager', mgrState);
    SyncEngine.write('bulletin', JSON.parse(localStorage.getItem('snappy_bulletin_board') || '{}'));
    var dKeys = ['techfiles','dispatch','dailyduties','mgrstats','daynotes','nexstar'];
    var dLocalKeys = ['snappy_tech_files','snappy_dispatch_v1','snappy_daily_duties','snappy_mgr_stats','snappy_day_notes','snappy_nexstar'];
    dKeys.forEach(function(k, i) {
      var v = localStorage.getItem(dLocalKeys[i]);
      if (v) SyncEngine.write(k, JSON.parse(v));
    });
    await SyncEngine._flush();

    // 1b. Wait for no-cors POST to land on server before reading back
    await new Promise(function(r) { setTimeout(r, 2500); });

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
        'bulletin': 'snappy_bulletin_board'
      };
      for (var ck in keyMap) {
        if (cloudData[ck]) {
          var cv = cloudData[ck].data || cloudData[ck].val || '';
          if (cv) localStorage.setItem(keyMap[ck], cv);
        }
      }
    }

    // 3. Clear browser caches
    if ('caches' in window) {
      var cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(function(name) { return caches.delete(name); }));
    }

    // 4. Hard reload with cache-busting timestamp
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
    var cbName = '_syncCb' + Date.now();
    window[cbName] = function(data) {
      resolve(data);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    var script = document.createElement('script');
    script.src = url + (url.indexOf('?') > -1 ? '&' : '?') + 'callback=' + cbName + '&t=' + Date.now();
    script.onerror = function() {
      reject(new Error('JSONP failed'));
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    document.head.appendChild(script);
    setTimeout(function() {
      if (window[cbName]) {
        reject(new Error('JSONP timeout'));
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
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
      'nexstar': 'snappy_nexstar'
    };
    var payload = {};
    for (var ck in keyMap) {
      var val = localStorage.getItem(keyMap[ck]);
      if (val) payload[ck] = val;
    }
    if (Object.keys(payload).length > 0) {
      await _syncPost(url, payload);
      // Small delay so the write lands before we read back
      await new Promise(function(r) { setTimeout(r, 2000); });
    }

    // Pull cloud data into localStorage for this device (JSONP)
    var pullData = await _syncJsonpGet(url);
    if (pullData && pullData.status === 'ok' && pullData.result) {
      var pullKeys = { 'skills': 'snappy_skills_assignments', 'manager': 'snappy_manager_entries', 'techfiles': 'snappy_tech_files', 'dispatch': 'snappy_dispatch_v1', 'dailyduties': 'snappy_daily_duties', 'mgrstats': 'snappy_mgr_stats', 'daynotes': 'snappy_day_notes', 'nexstar': 'snappy_nexstar' };
      for (var pk in pullKeys) {
        if (pullData.result[pk]) {
          var cv = pullData.result[pk].data || pullData.result[pk].val || '';
          if (cv) localStorage.setItem(pullKeys[pk], cv);
        }
      }
    }

    statusEl.textContent = 'All data synced!'; statusEl.style.color = '#81c784';
    setTimeout(function() { closeSyncSetup(); location.reload(); }, 1500);
  } catch (e) {
    console.warn('saveSyncUrl error:', e);
    statusEl.textContent = 'Connection error. Make sure the script is deployed as a web app.'; statusEl.style.color = '#e57373';
  }
}

// Trigger cloud sync on page load
window.addEventListener('load', () => {
  if (SyncEngine.isConfigured()) initCloudSync();
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
    //   Aptitude (30%) + ST performance (35%) + Manager score (15%) + Installs (10%) + Google reviews (10%)
    //   Self-eval (Skills) tracked but NOT weighted — tech's own interpretation

    function getTechAptitudeScore(tech) {
      const apt = aptitudeTests[tech.short];
      if (!apt) return 50; // default if no test data
      return (apt.totalScore / apt.maxScore) * 100;
    }

    function getTechTier(tech) {
      // 1. Aptitude test score (0–100): actual test percentage — PRIMARY knowledge gauge
      const aptScore = getTechAptitudeScore(tech);

      // 2. Self-eval skills score — tracked but NOT weighted in composite (tech's own interpretation)
      const skillAvg = techOverallAvg(tech);
      const skillScore = (skillAvg / 5) * 100;

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

      // Composite: Aptitude 30% + ST 35% + Manager 15% + Installs 10% + Reviews 10%
      // Self-eval (skillScore) excluded — tech's own interpretation, not weighted
      const composite = aptScore * 0.30 + stScore * 0.35 + mgrScore * 0.15 + installScore * 0.10 + reviewScore * 0.10;

      let tier, tierLabel;
      if (composite >= 92) { tier = 'S'; tierLabel = 'Elite'; }
      else if (composite >= 85) { tier = 'A'; tierLabel = 'Advanced'; }
      else if (composite >= 78) { tier = 'B'; tierLabel = 'Solid'; }
      else { tier = 'C'; tierLabel = 'Developing'; }

      return { tier, tierLabel, composite: Math.round(composite), aptScore: Math.round(aptScore), skillScore: Math.round(skillScore), stScore: Math.round(stScore), installScore: Math.round(installScore), reviewScore: Math.round(reviewScore), mgrScore: Math.round(mgrScore) };
    }

    function tierBadgeHTML(tier, size) {
      const cls = size === 'sm' ? 'tier-badge tier-badge-sm' : 'tier-badge';
      return `<span class="${cls} tier-${tier.toLowerCase()}">${tier}</span>`;
    }

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
        "Chris":  ["A1","A2","A3","A5","A6","A7","A8","A9","A10","A11","B1","B2","B6","C1","C3","C4","C6","D1","D3","D5","E1","E4","F1","F3","F5","G2","G3","H1","H2","H3","H4","H5"],
        "Dewone": ["A3","A7","A11","B1","C1","C2","C3","C4","C5","C7","D3","D4","E2","F1","G3","H3"],
        "Benji":  ["A2","A5","A7","A8","A11","B1","B2","D3","E2","F1","F2","F4"],
        "Daniel": ["A1","A2","A3","A6","A7","A9","A11","B1","B2","B6","B7","B8","D4","F1","G1","G3"],
        "Dee":    ["A7","A11","C1","C2","C7","D2","G3","H3"]
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
        SyncEngine.write('skills', skillsData.assignments);
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
    document.querySelectorAll('.nav-tabs:not(#st-sub-tabs):not(#as-sub-tabs):not(#sk-sub-tabs):not(#mgr-sub-tabs) .nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tabs:not(#st-sub-tabs):not(#as-sub-tabs):not(#sk-sub-tabs):not(#mgr-sub-tabs) .nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('view-' + tab.dataset.view).classList.add('active');
        // Auto-mark NEW skills as seen when visiting skills-related tabs
        var v = tab.dataset.view;
        if (v === 'skills-tags' || v === 'aptitude-skills' || v === 'overview') {
          _markNewSkillsSeen();
        }
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
      SyncEngine.write('bulletin', data);
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

      stData.forEach(function(st) {
        totalCallbacks += st.productivity.recalls || 0;
        totalRevenue += st.overview.revenue || 0;
        totalInstallRev += st.installs.total_revenue || 0;
      });

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

      var kpiHTML = '';
      var kpis = [
        { icon: '\ud83d\udd04', value: totalCallbacks, label: 'Callbacks', sub: 'Team total (ST recalls)' },
        { icon: '\u26a0\ufe0f', value: totalComplaints, label: 'Complaints', sub: 'Open filed complaints' },
        { icon: '\ud83d\udcb0', value: '$' + totalRevenue.toLocaleString(), label: 'MTD Revenue', sub: 'Month-to-date service' },
        { icon: '\u2b50', value: totalReviews, label: 'Google Reviews', sub: 'Last 90 days' },
        { icon: '\ud83c\udfe0', value: '$' + totalInstallRev.toLocaleString(), label: 'Install Revenue', sub: 'Equipment installs' }
      ];

      kpis.forEach(function(k) {
        kpiHTML += '<div class="ov-kpi-card">' +
          '<div class="ov-kpi-icon">' + k.icon + '</div>' +
          '<div class="ov-kpi-value">' + k.value + '</div>' +
          '<div class="ov-kpi-label">' + k.label + '</div>' +
          '<div class="ov-kpi-sub">' + k.sub + '</div>' +
        '</div>';
      });
      document.getElementById('ov-kpi-grid').innerHTML = kpiHTML;

      // ---- 2. TEAM SNAPSHOT ----
      var snapHTML = '';
      var sortedTechs = techs.slice().sort(function(a,b) { return getTechTier(b).composite - getTechTier(a).composite; });

      sortedTechs.forEach(function(t) {
        var tierInfo = getTechTier(t);
        var tierLower = tierInfo.tier.toLowerCase();
        var st = stData.find(function(s) { return s.name === t.short; });
        var gr = googleReviews[t.short];
        var avatarEl = techAvatars[t.short]
          ? '<img class="ov-snap-avatar" src="' + techAvatars[t.short] + '" alt="' + t.name + '">'
          : '<div class="ov-snap-initials" style="background:' + t.color + '">' + t.initials + '</div>';

        var tagsHTML = '';
        if (t.managerTags && t.managerTags.length) {
          t.managerTags.slice(0, 4).forEach(function(tag) {
            tagsHTML += '<span class="ov-snap-tag ' + tag.type + '">' + tag.label + '</span>';
          });
        }

        var statsLine = '';
        if (st) {
          statsLine += '<strong>$' + st.overview.revenue.toLocaleString() + '</strong> rev';
          statsLine += ' &bull; <strong>' + st.nexstar.conversion_rate + '%</strong> conv';
          statsLine += ' &bull; <strong>' + st.productivity.options_per_opp + '</strong> opts/opp';
        }
        if (gr) {
          statsLine += ' &bull; <strong>' + gr.count + '</strong> reviews';
          if (gr.fiveStar === gr.count && gr.count > 0) statsLine += ' (all 5\u2605)';
        }

        snapHTML += '<div class="ov-snap-card">' +
          avatarEl +
          '<div class="ov-snap-body">' +
            '<div class="ov-snap-name">' + t.short + ' <span class="ov-snap-tier tier-' + tierLower + '">' + tierInfo.tier + '-' + tierInfo.tierLabel + '</span></div>' +
            '<div class="ov-snap-highlights">' + tagsHTML + '</div>' +
            (statsLine ? '<div class="ov-snap-stat">' + statsLine + '</div>' : '') +
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
            '<button class="bb-remove mgr-only" onclick="bbRemove(\'meetings\',\'' + m.id + '\')">&times;</button>' +
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
          var removeBtn = o.source === 'mgr' ? '' : '<button class="bb-remove mgr-only" onclick="bbRemove(\'oneOnOnes\',\'' + o.id + '\')">&times;</button>';
          html += '<div class="bb-card">' +
            removeBtn +
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
          var removeBtn = r.source === 'mgr' ? '' : '<button class="bb-remove mgr-only" onclick="bbRemove(\'rideAlongs\',\'' + r.id + '\')">&times;</button>';
          html += '<div class="bb-card">' +
            removeBtn +
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
      if (radarChartInstance) radarChartInstance.destroy();
      radarChartInstance = new Chart(canvas, {
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
      const ctx = document.getElementById('barChart').getContext('2d');
      new Chart(ctx, {
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
      const ctx = document.getElementById('groupedBarChart').getContext('2d');
      new Chart(ctx, {
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

      html += `<tr style="background:#FFF8F0">
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

      new Chart(document.getElementById('aptSectionChart').getContext('2d'), {
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
      new Chart(document.getElementById('aptTotalChart').getContext('2d'), {
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
      new Chart(document.getElementById('aptVsEstChart').getContext('2d'), {
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
                <div class="tier-factor">Aptitude<br><span class="tier-factor-value">${tierInfo.aptScore}</span></div>
                <div class="tier-factor">Skills<br><span class="tier-factor-value">${tierInfo.skillScore}</span></div>
                <div class="tier-factor">ST Perf<br><span class="tier-factor-value">${tierInfo.stScore}</span></div>
                <div class="tier-factor">Installs<br><span class="tier-factor-value">${tierInfo.installScore}</span></div>
                <div class="tier-factor">Mgr Score<br><span class="tier-factor-value">${tierInfo.mgrScore}</span></div>
                <div class="tier-factor">Reviews<br><span class="tier-factor-value">${tierInfo.reviewScore}</span></div>
                <div class="tier-factor" style="border-left:2px solid var(--border-subtle);padding-left:12px">Composite<br><span class="tier-factor-value" style="font-size:16px">${tierInfo.composite}</span></div>
              </div>
            </div>

            ${t.managerNotes ? `
            <div class="manager-notes">
              <div class="manager-notes-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Manager Notes
              </div>
              <p>${t.managerNotes}</p>
              ${t.managerTags ? `<div style="margin-top:8px">${t.managerTags.map(tag =>
                `<span class="manager-tag tag-${tag.type}">${tag.label}</span>`
              ).join('')}</div>` : ''}
            </div>
            ` : ''}

            ${(() => {
              const apt = aptitudeTests[t.short];

              let out = '<div class="aptitude-section">';
              out += '<div class="aptitude-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg> Aptitude & Skills</div>';
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
                out += '<span style="font-size:12px;font-weight:700;color:#1B4332">Total: ' + apt.totalScore + '/' + apt.maxScore + '</span>';
                out += '<span style="font-size:12px;color:#6B7280">(' + Math.round((apt.totalScore/apt.maxScore)*100) + '%)</span>';
                out += '</div>';
                if (apt.certs.length) {
                  out += '<div class="aptitude-certs">' + apt.certs.map(c => '<span class="aptitude-cert">' + c + '</span>').join('') + '</div>';
                }
                out += '<div class="aptitude-interp">' + apt.interpretation + '</div>';
              }

              // Self-Evaluation Bars (comparison vs aptitude)
              const catKeys = Object.keys(categories);
              out += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid #B8D8C8">';
              out += '<div style="font-size:11px;font-weight:700;color:#2D6A4F;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.04em">Self-Evaluation Breakdown</div>';
              catKeys.forEach(catKey => {
                const cat = categories[catKey];
                const selfAvg = techCategoryAvg(t, catKey);
                const selfPct = Math.round((selfAvg / 5) * 100);
                const barColor = selfPct >= 80 ? '#059669' : selfPct >= 60 ? '#D97706' : '#DC2626';
                out += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
                out += '<div style="width:70px;font-size:11px;font-weight:500;color:#6B7280;flex-shrink:0">' + cat.label + '</div>';
                out += '<div style="flex:1;height:7px;background:#E5E7EB;border-radius:4px;overflow:hidden"><div style="height:100%;width:' + selfPct + '%;background:' + barColor + ';border-radius:4px;transition:width 0.4s ease"></div></div>';
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
            <div class="google-reviews">
              <div class="google-reviews-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                Google Reviews — Last 90 Days
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
            <div class="st-profile">
              <div class="st-profile-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 9l-5 5-2-2-4 4"/></svg>
                ServiceTitan Performance — Last 90 Days
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
                  <div class="st-metric-label">Installs Sold</div>
                </div>
                <div class="st-metric">
                  <div class="st-metric-value">$${st.installs.total_revenue.toLocaleString()}</div>
                  <div class="st-metric-label">Install Revenue</div>
                </div>
              </div>
              <div class="st-insight">${stInsights[t.short] || ''}</div>
            </div>
            ` : ''}

            <div class="detail-section">
              <div class="detail-section-title">Self-Identified Strengths</div>
              <div>${t.strengths.map(s => `<span class="strength-tag">${s}</span>`).join('')}</div>
            </div>

            <div class="detail-section">
              <div class="detail-section-title">Self-Identified Weaknesses</div>
              <div>${t.weaknesses.map(w => `<span class="weakness-tag">${w}</span>`).join('')}</div>
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
                <span style="font-size:12px;font-weight:700;color:#1B4332">Total: ${adamApt.totalScore}/${adamApt.maxScore}</span>
                <span style="font-size:12px;color:#6B7280">(${Math.round((adamApt.totalScore/adamApt.maxScore)*100)}%)</span>
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
        isWarrantyTech: true,
        completedJobs: 113,
        nexstar: { total_revenue: 6416, avg_sale: 562, conversion_rate: 85, spps_sold: 0, tech_gen_leads: 3, sold_hours: 87.35, tech_sold_hr_eff: 0, flat_rate_tasks: 2.65 },
        overview: { revenue: 6416, total_job_avg: 57, opp_job_avg: 475, opp_conversion: 85, opps: 13, converted_jobs: 11 },
        leads: { opps: 13, leads_set: 3, conv_rate: 23, avg_sale: 562 },
        memberships: { total_mem_sold: 0, total_mem_opps: 8, total_mem_pct: 0 },
        productivity: { rev_hr: 24, billable_hours: 87.35, sold_hrs_on_job_pct: 32, tasks_per_opp: 2.63, options_per_opp: 0.75, recalls: 1 },
        sales: { total_sales: 1233, avg_sale_s: 411, close_rate: 38, sales_opps: 8, options_per_opp_s: 0.75 },
        installs: { count: 0, total_revenue: 0, avg_sale: 0, leads_generated: 0, self_sourced: 0 }
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
          <div class="kpi-label">Tech-Gen Installs</div>
          <div class="kpi-value">${totalInstalls}</div>
          <div class="kpi-sub">${fmt$(totalInstallRev)} install revenue</div>
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
        { label: 'Installs Sold', get: t => t.installs.count },
        { label: 'Install Revenue', get: t => t.installs.total_revenue, fmt: fmt$ },
        { label: 'Avg Install Sale', get: t => t.installs.avg_sale, fmt: fmt$ },
        { label: 'Leads Generated', get: t => t.installs.leads_generated },
        { label: 'Self-Sourced', get: t => t.installs.self_sourced }
      ]);
    }

    function renderSTCharts() {
      // Revenue bar chart
      const ctx1 = document.getElementById('stRevenueChart').getContext('2d');
      new Chart(ctx1, {
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
      const ctx2 = document.getElementById('stConversionChart').getContext('2d');
      new Chart(ctx2, {
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

      // Manager card — Mark Sanders, S-Tier
      const mgrTierLower = 's';
      const mgrAvatarBg = 'linear-gradient(135deg, #2A1F0A, #1A0F20, #0A1A2A, #1A200A)';
      const mgrCompBarColor = 'linear-gradient(90deg, #FFD700, #FF6B6B, #8B5CF6, #4D96FF)';
      const ms = mgrLoadStats();
      // Manager install data (excluded from stData per instructions)
      const mgrInstalls = { count: 5, total_revenue: 69610, avg_sale: 13922 };
      const mgrNexstar = { total_revenue: 7083, avg_sale: 403, conversion_rate: 36, spps_sold: 5, tech_gen_leads: 2, sold_hours: 13.45 };
      html += `
        <div class="rookie-card rookie-tier-s">
          <div class="rookie-card-border tier-s"></div>
          <div class="rookie-tier-badge tier-s">S-TIER</div>
          <div class="rookie-avatar-wrap" style="background:${mgrAvatarBg}">
            <img src="maico_avatar.png" alt="Mark Sanders">
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
                <div class="rookie-stat-value">$${mgrInstalls.avg_sale.toLocaleString()}</div>
                <div class="rookie-stat-label">Avg Install</div>
                <div class="rookie-stat-period">per job</div>
              </div>
              <div class="rookie-stat mgr-stat-editable" onclick="mgrEditStat('oneonone_rate','1-on-1 Completion Rate (per week)','${ms.oneonone_rate||''}')"> 
                <div class="rookie-stat-value">${ms.oneonone_rate || '—'}</div>
                <div class="rookie-stat-label">1-on-1 Rate</div>
                <div class="rookie-stat-period">per week</div>
              </div>
              <div class="rookie-stat mgr-stat-editable" onclick="mgrEditStat('ridealong_rate','Ride-Along Completion Rate (per week)','${ms.ridealong_rate||''}')"> 
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
              <div class="rookie-composite-score" style="color:#FFD700">S</div>
            </div>
            <div class="rookie-certs"><span class="rookie-cert">Service Manager</span><span class="rookie-cert">Team Lead</span></div>
          </div>
        </div>
      `;

      // Sort techs by composite score (highest first)
      const sortedTechs = [...techs].sort((a, b) => getTechTier(b).composite - getTechTier(a).composite);

      sortedTechs.forEach(t => {
        const tierInfo = getTechTier(t);
        const tierLower = tierInfo.tier.toLowerCase();
        const apt = aptitudeTests[t.short];
        const st = stData.find(s => s.name === t.short);
        const gr = googleReviews[t.short];

        // Composite bar color based on tier
        const compBarColor = tierLower === 's' ? 'linear-gradient(90deg, #FFD700, #FF6B6B, #8B5CF6, #4D96FF)'
          : tierLower === 'a' ? 'linear-gradient(90deg, #DC2626, #EF4444)'
          : tierLower === 'b' ? 'linear-gradient(90deg, #2563EB, #3B82F6)'
          : 'linear-gradient(90deg, #6B7280, #9CA3AF)';

        // Avatar BG gradient based on tier
        const avatarBg = tierLower === 's' ? 'linear-gradient(135deg, #2A1F0A, #1A0F20, #0A1A2A, #1A200A)'
          : tierLower === 'a' ? 'linear-gradient(135deg, #1A0A0A, #2D0F0F, #3B1212)'
          : tierLower === 'b' ? 'linear-gradient(135deg, #0A1628, #122650, #0E1E3A)'
          : 'linear-gradient(135deg, #1A1C22, #22252D, #2A2D36)';

        html += `
          <div class="rookie-card rookie-tier-${tierLower}">
            <div class="rookie-card-border tier-${tierLower}"></div>
            <div class="rookie-tier-badge tier-${tierLower}">${tierInfo.tier}-TIER</div>
            <div class="rookie-avatar-wrap" style="background:${avatarBg}">
              ${techAvatars[t.short]
                ? `<img src="${techAvatars[t.short]}" alt="${t.name}">`
                : `<div class="initials-circle" style="background:${t.color}">${t.initials}</div>`
              }
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
                  <div class="rookie-stat-value">${st ? st.memberships.total_mem_sold : '—'}</div>
                  <div class="rookie-stat-label">Mem Sold</div>
                </div>
                <div class="rookie-stat">
                  <div class="rookie-stat-value">${st ? '$' + (st.nexstar.total_revenue / 1000).toFixed(0) + 'k' : '—'}</div>
                  <div class="rookie-stat-label">Revenue</div>
                </div>
                <div class="rookie-stat">
                  <div class="rookie-stat-value">${st ? (st.isWarrantyTech ? st.completedJobs : st.nexstar.tech_gen_leads) : '—'}</div>
                  <div class="rookie-stat-label">${st && st.isWarrantyTech ? 'Jobs' : 'Leads'}</div>
                </div>
                <div class="rookie-stat">
                  <div class="rookie-stat-value">${gr ? gr.count : '—'}</div>
                  <div class="rookie-stat-label">Reviews</div>
                </div>
                <div class="rookie-stat">
                  <div class="rookie-stat-value">${st ? '$' + (st.installs.total_revenue / 1000).toFixed(0) + 'k' : '—'}</div>
                  <div class="rookie-stat-label">Installs</div>
                </div>
              </div>

              <div class="rookie-composite">
                <div class="rookie-composite-label">Composite</div>
                <div class="rookie-composite-bar">
                  <div class="rookie-composite-bar-fill" style="width:${tierInfo.composite}%;background:${compBarColor}"></div>
                </div>
                <div class="rookie-composite-score" style="color:${t.color}">${tierInfo.composite}</div>
              </div>

              ${apt && apt.certs.length ? `<div class="rookie-certs">${apt.certs.map(c => `<span class="rookie-cert">${c}</span>`).join('')}</div>` : ''}
            </div>
          </div>
        `;
      });

      document.getElementById('rookieGrid').innerHTML = html;
    }

    // ========== TIER PROGRESSION ==========
    function renderProgression() {
      const thresholds = { C: 78, B: 85, A: 92, S: 100 };
      const nextTier = { C: 'B', B: 'A', A: 'S', S: null };
      const tierColors = { S: '#FFD700', A: '#8B5CF6', B: '#3B82F6', C: '#9CA3AF' };
      const nextTierColors = { B: '#3B82F6', A: '#8B5CF6', S: '#FFD700' };

      const areas = [
        { key: 'aptScore', name: 'Aptitude', weight: 30, tip: (s) => s < 70 ? 'Retake the aptitude test after studying weak areas' : s < 85 ? 'Review advanced topics to push score higher' : 'Strong — maintain through continued learning' },
        { key: 'stScore', name: 'ST Performance', weight: 35, tip: (s) => s < 50 ? 'Focus on conversion rate and revenue generation' : s < 70 ? 'Improve lead generation and close rate' : s < 85 ? 'Fine-tune options per opportunity and memberships' : 'Performing at a high level' },
        { key: 'mgrScore', name: 'Manager Score', weight: 15, tip: (s) => s < 60 ? 'Focus on communication, punctuality, and professionalism' : s < 80 ? 'Take initiative on callbacks and team collaboration' : 'Highly rated by management' },
        { key: 'installScore', name: 'Installs', weight: 10, tip: (s) => s < 30 ? 'Seek install opportunities and close equipment replacements' : s < 60 ? 'Increase install count and average ticket size' : 'Solid install production' },
        { key: 'reviewScore', name: 'Google Reviews', weight: 10, tip: (s) => s < 40 ? 'Ask satisfied customers for Google reviews after every job' : s < 70 ? 'Consistent review requests will move this up' : 'Good customer feedback presence' }
      ];

      // Sort by composite ascending so lowest-tier techs come first
      const sorted = [...techs].sort((a, b) => getTechTier(a).composite - getTechTier(b).composite);

      let html = '<div class="prog-grid">';

      sorted.forEach(t => {
        const info = getTechTier(t);
        const next = nextTier[info.tier];
        const target = next ? thresholds[info.tier] : null;
        const gap = target ? target - info.composite : 0;
        const barPct = target ? Math.min((info.composite / target) * 100, 100) : 100;
        const barColor = tierColors[info.tier];
        const nextColor = next ? nextTierColors[next] : tierColors[info.tier];

        // Identify weakest areas (biggest opportunity for improvement)
        const areaScores = areas.map(a => ({
          ...a,
          score: info[a.key],
          weighted: info[a.key] * (a.weight / 100),
          potential: (100 - info[a.key]) * (a.weight / 100)
        }));
        areaScores.sort((a, b) => b.potential - a.potential);

        const avatarHTML = techAvatars[t.short]
          ? `<img class="prog-avatar" src="${techAvatars[t.short]}" alt="${t.name}">`
          : `<div class="prog-avatar-placeholder" style="background:${t.color}">${t.initials}</div>`;

        html += `
          <div class="prog-card">
            <div class="prog-header">
              ${avatarHTML}
              <div>
                <div class="prog-name">${t.name}</div>
                <div class="prog-subtitle">${t.position} &bull; ${t.years} yrs</div>
              </div>
              <div class="prog-badges">
                ${tierBadgeHTML(info.tier)}
                ${next ? `<span class="prog-arrow">&rarr;</span>${tierBadgeHTML(next)}<span class="prog-points-needed">+${gap} pts</span>` : '<span style="font-size:12px;color:var(--accent-gold);font-weight:700;">MAX TIER</span>'}
              </div>
            </div>

            <div class="prog-bar-wrap">
              <div class="prog-bar-label">
                <span>Composite: ${info.composite}</span>
                ${target ? `<span>Next tier: ${target}</span>` : '<span>S-Tier achieved</span>'}
              </div>
              <div class="prog-bar">
                <div class="prog-bar-fill" style="width:${barPct}%;background:${barColor}"></div>
                ${target ? `<div class="prog-bar-target" style="left:${(target / 100) * 100}%"></div>` : ''}
              </div>
            </div>

            <div class="prog-areas">
              ${areaScores.map(a => {
                const cls = a.score >= 80 ? 'is-strong' : a.score < 55 ? 'is-weak' : 'is-ok';
                const fillColor = a.score >= 80 ? 'var(--accent-green)' : a.score < 55 ? 'var(--accent-red)' : barColor;
                return `
                  <div class="prog-area ${cls}">
                    <div class="prog-area-header">
                      <span class="prog-area-name">${a.name} (${a.weight}%)</span>
                      <span class="prog-area-score">${a.score}</span>
                    </div>
                    <div class="prog-area-bar">
                      <div class="prog-area-bar-fill" style="width:${a.score}%;background:${fillColor}"></div>
                    </div>
                    <div class="prog-area-tip">${a.tip(a.score)}</div>
                  </div>
                `;
              }).join('')}
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
        SyncEngine.write('manager', mgrState);
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
        <div class="mgr-panel-actions">
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
          : `<button class="mgr-bb-add-btn mgr-only" title="Add to Bulletin Board" onclick="event.stopPropagation(); _logAddToBB('${e.id}')" style="background:none;border:1px solid rgba(255,215,0,0.4);border-radius:6px;padding:3px 8px;font-size:11px;color:#FFD700;cursor:pointer;white-space:nowrap;">+ BB</button>`;
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
            <button type="button" class="mgr-btn secondary" onclick="mgrTrainingAddToBB()" style="border-color:rgba(255,215,0,0.4);color:#FFD700;">\ud83d\udccc Add to Bulletin Board</button>
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
      toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#1565C0;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.4s;';
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
      toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#1B5E20;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.4s;';
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
        <div style="background:#1C2E52;border-radius:16px;padding:28px 32px;max-width:420px;width:90%;color:#fff;font-family:var(--font);box-shadow:0 8px 32px rgba(0,0,0,0.5);">
          <div style="font-size:18px;font-weight:700;margin-bottom:6px;">\ud83d\udcc5 Save to Calendar</div>
          <div style="font-size:13px;color:#8b93a8;margin-bottom:18px;">Training plan saved. Add this to the manager calendar?</div>
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;font-weight:600;color:#FFD700;display:block;margin-bottom:4px;">Topic</label>
            <div style="font-size:14px;color:#e0e6f0;background:rgba(255,255,255,0.08);padding:8px 12px;border-radius:8px;">${topic || '(No topic)'}</div>
          </div>
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;font-weight:600;color:#FFD700;display:block;margin-bottom:4px;">Meeting Date</label>
            <input type="date" id="tcm_date" value="${defaultDate}" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:14px;">
          </div>
          <div style="margin-bottom:18px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" id="tcm_addBulletin" checked style="width:16px;height:16px;accent-color:#FFD700;">
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
        <div style="background:#1C2E52;border-radius:16px;padding:28px 32px;max-width:420px;width:90%;color:#fff;font-family:var(--font);box-shadow:0 8px 32px rgba(0,0,0,0.5);">
          <div style="font-size:18px;font-weight:700;margin-bottom:6px;">${icon} ${typeLabel} Saved</div>
          <div style="font-size:13px;color:#8b93a8;margin-bottom:18px;">Saved to manager calendar. Add to Bulletin Board?</div>
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;font-weight:600;color:#FFD700;display:block;margin-bottom:4px;">Tech</label>
            <div style="font-size:14px;color:#e0e6f0;background:rgba(255,255,255,0.08);padding:8px 12px;border-radius:8px;">${tech}</div>
          </div>
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;font-weight:600;color:#FFD700;display:block;margin-bottom:4px;">Date</label>
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
      toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#1B5E20;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.4s;';
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
      renderManagerCalendar();
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
    let tfFiles = {}; // { tech: [ { id, type, title, notes, fileName, fileSize, fileData, date } ] }
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
    }
    function tfSave() {
      try {
        localStorage.setItem(TF_STORAGE_KEY, JSON.stringify(tfFiles));
        SyncEngine.write('techfiles', tfFiles);
      } catch (e) {
        alert('Storage full — try removing older files first.');
        console.warn('Tech Files: save failed', e);
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
              ${f.fileData ? `<button class="tf-card-btn" onclick="tfViewFile('${f.id}')">View</button>` : ''}
              ${f.fileData ? `<button class="tf-card-btn" onclick="tfDownloadFile('${f.id}')">Download</button>` : ''}
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
        <div>Drop file here or click to browse</div>
        <div style="font-size:10px;margin-top:4px;opacity:0.7">PDF, images, text — max 4 MB</div>`;
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
        tfFiles[tfSelectedTech].push({
          id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
          type,
          title,
          notes,
          fileName: tfPendingFileName,
          fileSize: tfPendingFileSize,
          fileData: tfPendingFileData,
          date: new Date().toISOString()
        });
      }

      tfSave();
      tfCloseUpload();
      tfRender();
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
      tfSave();
      tfRender();
    }

    function tfViewFile(id) {
      const file = (tfFiles[tfSelectedTech] || []).find(f => f.id === id);
      if (!file || !file.fileData) return;

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
        embed.style.cssText = 'width:100%;max-width:900px;height:100%;border:none;border-radius:8px;background:#fff;';
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

    function tfDownloadFile(id) {
      const file = (tfFiles[tfSelectedTech] || []).find(f => f.id === id);
      if (!file || !file.fileData) return;
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
      fi.addEventListener('change', () => { if (fi.files[0]) tfHandleFile(fi.files[0]); });
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        dz.classList.remove('dragover');
        if (e.dataTransfer.files[0]) tfHandleFile(e.dataTransfer.files[0]);
      });
    })();

    // Init Tech Files
    tfLoad();
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
    const DISP_DEFAULT_TAGS = [
      'Diagnostics',
      'Install / Changeout',
      'Maintenance',
      'Sales Capable',
      'Solo Approved'
    ];

    function dispLoad() {
      try {
        const raw = localStorage.getItem(DISP_STORAGE);
        if (raw) return JSON.parse(raw);
      } catch(e) {}
      // Defaults
      return {
        tags: DISP_DEFAULT_TAGS.slice(),
        assignments: {
          'Chris':  ['Diagnostics', 'Install / Changeout', 'Sales Capable', 'Solo Approved'],
          'Dewone': ['Maintenance', 'Sales Capable'],
          'Benji':  ['Diagnostics', 'Maintenance'],
          'Daniel': ['Diagnostics', 'Maintenance'],
          'Dee':    ['Maintenance']
        }
      };
    }
    function dispSave(data) {
      localStorage.setItem(DISP_STORAGE, JSON.stringify(data));
      SyncEngine.write('dispatch', data);
    }
    function dispTagColor(tagName, allTags) {
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
        return `<span class="disp-pool-tag" draggable="true" data-tag="${escHtml(tag)}" style="background:${c.bg};color:${c.text}">${escHtml(tag)}<span class="disp-tag-x" title="Delete tag" data-del="${escHtml(tag)}">&times;</span></span>`;
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
          if (!requireManager()) return;
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
            cardsHtml += `<span class="disp-assigned-tag" draggable="true" data-tag="${escHtml(tag)}" style="background:${c.bg};color:${c.text}">${escHtml(tag)}<span class="disp-remove-tag" data-tech="${tech}" data-rtag="${escHtml(tag)}">&times;</span></span>`;
          });
        }
        cardsHtml += `</div>`;
        cardsHtml += `<div class="disp-tag-count ${count >= DISP_MAX_TAGS ? 'at-limit' : ''}">${count} / ${DISP_MAX_TAGS} tags</div>`;
        cardsHtml += `</div>`;
      });
      cardsHtml += '</div>';

      // Quick-view matrix
      cardsHtml += '<div class="disp-matrix-wrap"><table class="disp-matrix"><thead><tr><th style="min-width:160px">Tag</th>';
      techOrder.forEach(tech => { cardsHtml += `<th>${tech}</th>`; });
      cardsHtml += '</tr></thead><tbody>';
      data.tags.forEach(tag => {
        const c = dispTagColor(tag, data.tags);
        cardsHtml += `<tr><td style="color:${c.text};font-weight:600">${escHtml(tag)}</td>`;
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
          if (!isManagerMode) return;
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
          if (!requireManager()) return;
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

    // ========== INIT ==========
    renderOverviewTab();
    renderKPIs();
    // Delay radar render to ensure container has dimensions and THREE is loaded
    setTimeout(function() { renderRadar(); }, 300);
    renderBar();
    renderGroupedBar();
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
// PDF data loaded from pdf_data.js

function openEmbeddedPDF(filename) {
  const b64 = PDF_BASE64[filename];
  if (!b64) { alert('PDF not found: ' + filename); return; }
  const byteChars = atob(b64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  // Remove any existing viewer
  const existing = document.getElementById('pdfViewerOverlay');
  if (existing) existing.remove();

  // Create full-page PDF viewer overlay
  const overlay = document.createElement('div');
  overlay.id = 'pdfViewerOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;padding:16px;';

  // Header bar with title, download, and close
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:100%;max-width:900px;margin-bottom:12px;';

  const title = document.createElement('span');
  title.textContent = filename.replace(/_/g, ' ').replace('.pdf', '');
  title.style.cssText = 'color:#fff;font-size:16px;font-weight:600;text-transform:capitalize;';

  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display:flex;gap:8px;';

  const dlBtn = document.createElement('a');
  dlBtn.href = url;
  dlBtn.download = filename;
  dlBtn.textContent = 'Download';
  dlBtn.style.cssText = 'padding:8px 16px;background:#2D6A6A;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00D7 Close';
  closeBtn.style.cssText = 'padding:8px 16px;background:#555;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;';
  closeBtn.onclick = function() { overlay.remove(); URL.revokeObjectURL(url); };

  btnGroup.appendChild(dlBtn);
  btnGroup.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(btnGroup);
  overlay.appendChild(header);

  // PDF embed
  const embed = document.createElement('iframe');
  embed.src = url;
  embed.style.cssText = 'width:100%;max-width:900px;flex:1;border:none;border-radius:8px;background:#fff;';
  overlay.appendChild(embed);

  // Close on overlay background click
  overlay.addEventListener('click', function(e) { if (e.target === overlay) { overlay.remove(); URL.revokeObjectURL(url); } });

  document.body.appendChild(overlay);
}
