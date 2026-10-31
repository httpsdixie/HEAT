/**
 * sensor-management.js
 * Sensor Management page — data rendering and node inspector logic.
 * All node selection is handled via the reusable OrchidNodeSearch component.
 */
(function () {
  'use strict';

  // Reverse geocode lat/lng against the offline Ormoc City map data
  function reverseGeocode(lat, lng) {
    const map = window.ORCHID_OFFLINE_MAP;
    if (!map || !Array.isArray(map.features)) return null;
    const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
    const pointDist = (coords) => dist(coords, [lng, lat]);
    const lineDist = (coords) => Math.min(...coords.map(pointDist));
    const polyDist = (rings) => Math.min(...rings.flatMap(r => r.map(pointDist)));

    let best = null;
    let bestD = Infinity;
    // Prefer named places/suburbs/neighbourhoods, then streets, then anything named
    const priority = (props) => {
      if (['suburb','neighbourhood','quarter','village','town','city'].includes(props.place)) return 0;
      if (['residential','secondary','tertiary','trunk','primary','unclassified'].includes(props.highway)) return 1;
      if (props.landuse || props.amenity || props.building) return 2;
      return 3;
    };
    for (const feat of map.features) {
      const name = feat?.properties?.name;
      if (!name) continue;
      const g = feat.geometry;
      let d;
      try {
        if (g.type === 'Point') d = pointDist(g.coordinates);
        else if (g.type === 'LineString') d = lineDist(g.coordinates);
        else if (g.type === 'Polygon') d = polyDist(g.coordinates);
        else if (g.type === 'MultiPolygon') d = Math.min(...g.coordinates.map(polyDist));
        else continue;
      } catch { continue; }
      const p = priority(feat.properties);
      // Weight: prefer low-priority-number (place > street), break ties by distance
      const score = p * 0.01 + d;
      if (score < bestD) { bestD = score; best = name; }
    }
    return best;
  }

  let deployedSensors = [];
  let unplacedSensors = [];
  let fleetTotal = 0;
  let allSensors = [];
  let searchItems = [];
  let allRows = [];
  let sensorDataLoadError = false;
  const fleetPageSize = 3;
  const activityPageSize = 6;
  let fleetPagination = null;
  let selectedFleetNodeKey = null;
  let showFleetNode = null;

  function persistSensorView(view) {
    sessionStorage.setItem('orchid-sensor-tab', view);
    const url = new URL(window.location.href);
    url.searchParams.set('view', view);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  async function loadSensorData() {
    let response;
    try {
      response = await fetch('/api/nodes', { cache: 'no-store', headers: { Accept: 'application/json' } });
    } catch (error) {
      throw new Error('Cannot connect to the sensor database API. Start the app with python3 scripts/serve.py and reload.');
    }

    const responseText = await response.text();
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('The sensor database API is unavailable at this address. Start the app with python3 scripts/serve.py (not a static file server), then reload.');
      }
      throw new Error(`The sensor database API returned invalid JSON (${response.status}).`);
    }
    if (!response.ok) throw new Error(payload.error || `Sensor database request failed (${response.status}).`);
    if (!Array.isArray(payload.nodes) || payload.nodes.some((node) =>
      !node || typeof node.key !== 'string' || typeof node.id !== 'string' || typeof node.status !== 'string')) {
      throw new Error('The sensor database returned an invalid node list.');
    }
    const normalizeNode = (node, unplaced) => ({
      ...node,
      id: node.id,
      location: node.location || (unplaced ? 'Not yet deployed' : ''),
      temperature: node.temperature == null ? '--' : String(node.temperature),
      humidity: node.humidity == null ? '--' : String(node.humidity),
      pressure: node.pressure == null ? '--' : String(node.pressure),
      heatIndex: node.heatIndex == null ? '--' : String(node.heatIndex),
      battery: node.battery ?? '--',
      uptime: node.uptime ?? '--',
      sensorStatus: node.sensorStatus ?? 'Unknown',
      weather: node.weather == null ? '--' : String(node.weather),
      recentReadings: Array.isArray(node.recentReadings) ? node.recentReadings : [],
      unplaced
    });

    deployedSensors = payload.nodes
      .filter((node) => Number.isFinite(node.latitude) && Number.isFinite(node.longitude))
      .map((node) => normalizeNode(node, false));
    unplacedSensors = payload.nodes
      .filter((node) => !Number.isFinite(node.latitude) || !Number.isFinite(node.longitude))
      .map((node) => normalizeNode(node, true));
    allSensors = [...deployedSensors, ...unplacedSensors];
    fleetTotal = allSensors.length;
    searchItems = allSensors.map((sensor) => ({
      key: sensor.key,
      label: sensor.id,
      sublabel: sensor.unplaced ? `Not Deployed · ${sensor.status}` : (sensor.location || sensor.status),
      status: sensor.status,
      unplaced: sensor.unplaced
    }));
    allRows = allSensors.map((sensor) => ({
      key: sensor.key,
      id: sensor.id,
      location: sensor.location,
      status: sensor.status,
      battery: sensor.battery,
      lastSeen: sensor.lastSeen,
      uptime: sensor.uptime,
      sensorStatus: sensor.sensorStatus,
      unplaced: sensor.unplaced
    }));
  }

  function updateDatabaseStatus(message, state = 'success') {
    const status = document.getElementById('sensor-data-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
    status.hidden = state === 'success';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Fleet metrics
  // ──────────────────────────────────────────────────────────────────────────

  function initFleetMetrics() {
    const total = document.getElementById('sn-total');
    if (total) total.textContent = String(fleetTotal);

    const deployed = document.getElementById('sn-deployed');
    if (deployed) deployed.textContent = String(deployedSensors.length);

    const online  = deployedSensors.filter((s) => s.status === 'Online').length;
    const offline = deployedSensors.length - online;

    const working  = document.getElementById('sn-working');
    const inactive = document.getElementById('sn-not-working');
    if (working)  working.textContent  = String(online);
    if (inactive) inactive.textContent = String(offline);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // All-sensors table — with pagination
  // ──────────────────────────────────────────────────────────────────────────

  function lastSeenDisplay(sensor) {
    if (!sensor.lastSeen) return '—';
    const date = new Date(sensor.lastSeen);
    if (Number.isNaN(date.getTime())) return String(sensor.lastSeen);
    return `${new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).format(date)} PHT`;
  }

  async function renderSensorActivity(page = 1) {
    const body = document.getElementById('sensor-activity-body');
    const paginationMount = document.getElementById('sensor-activity-pagination');
    const activityCount = document.getElementById('sensor-activity-count');
    if (!body || !paginationMount) return;

    const pageSize = activityPageSize;
    const offset   = (page - 1) * pageSize;

    // Show loading state
    const loadingRow = document.createElement('tr');
    const loadingCell = document.createElement('td');
    loadingCell.colSpan = 4;
    loadingCell.className = 'sensor-table-empty';
    loadingCell.textContent = 'Loading…';
    loadingRow.appendChild(loadingCell);
    body.replaceChildren(loadingRow);

    let events, total;
    try {
      const res  = await fetch(`/api/activity?limit=${pageSize}&offset=${offset}`);
      if (!res.ok) throw new Error(`Activity request failed (${res.status}).`);
      const data = await res.json();
      if (!Array.isArray(data.events) || !Number.isInteger(data.total) || data.total < 0) {
        throw new Error('The activity API returned invalid data.');
      }
      events = data.events;
      total = data.total;
    } catch (error) {
      console.error('Could not load sensor activity.', error);
      const errRow = document.createElement('tr');
      const errCell = document.createElement('td');
      errCell.colSpan = 4;
      errCell.className = 'sensor-table-empty';
      errCell.append('Could not load activity from the database. ');
      const retryButton = document.createElement('button');
      retryButton.type = 'button';
      retryButton.className = 'sensor-tool-button';
      retryButton.textContent = 'Retry';
      retryButton.addEventListener('click', () => renderSensorActivity(page));
      errCell.appendChild(retryButton);
      errRow.appendChild(errCell);
      body.replaceChildren(errRow);
      return;
    }

    if (activityCount) {
      activityCount.textContent = `${total} ${total === 1 ? 'entry' : 'entries'}`;
    }

    // Build a node status lookup from allSensors
    const statusMap = {};
    allSensors.forEach(s => { statusMap[String(s.id)] = s.status; });

    if (!events.length) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 4;
      emptyCell.className = 'sensor-table-empty';
      emptyCell.textContent = 'No recent data activity is available.';
      emptyRow.appendChild(emptyCell);
      body.replaceChildren(emptyRow);
    } else {
      body.replaceChildren(...events.map((entry) => {
        const row = document.createElement('tr');
        row.className = 'sensor-activity-row';

        const nodeIdCell = document.createElement('td');
        nodeIdCell.className = 'sensor-activity-node-id';
        nodeIdCell.textContent = entry.node_id;

        const locationCell = document.createElement('td');
        locationCell.className = 'sensor-activity-location';
        locationCell.textContent = entry.location_name || '—';

        const status = statusMap[String(entry.node_id)] || 'Offline';
        const statusCell = document.createElement('td');
        const statusBadge = document.createElement('span');
        const isOnline = status.toLowerCase() === 'online';
        statusBadge.className = `sensor-table-status-badge sensor-table-status-badge--${isOnline ? 'online' : 'offline'}`;
        const statusDot = document.createElement('span');
        statusDot.className = 'sensor-table-status-dot';
        statusBadge.append(statusDot, document.createTextNode(status));
        statusCell.appendChild(statusBadge);

        const timeCell = document.createElement('td');
        timeCell.className = 'sensor-activity-time';
        timeCell.textContent = lastSeenDisplay({ lastSeen: entry.created_at });

        row.append(nodeIdCell, locationCell, statusCell, timeCell);
        return row;
      }));
    }

    paginationMount.replaceChildren();
    await window.OrchidComponentLoader.initPagination(paginationMount, {
      total,
      pageSize,
      page,
      onChange: (newPage) => renderSensorActivity(newPage)
    });
  }

  /** Build a single <tr> for a sensor row */
  function buildSensorRow(sensor) {
    const row      = document.createElement('tr');
    row.className  = `sensor-table-row${sensor.key === selectedFleetNodeKey ? ' sensor-table-row--selected' : ''}`;
    row.tabIndex   = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Inspect ${sensor.id}`);

    const loadNode = () => {
      const fullSensor = allSensors.find((s) => s.key === sensor.key);
      if (!fullSensor) return;

      // Switch straight to the overview tab — no modal
      const tabMain      = document.getElementById('tab-main');
      const tabSensors   = document.getElementById('tab-sensors');
      const tabActivity  = document.getElementById('tab-activity');
      const overviewView = document.getElementById('sensor-overview-view');
      const listView     = document.getElementById('sensor-list-view');
      const activityView = document.getElementById('sensor-activity-view');
      const tabs         = document.querySelector('.sensor-control-tabs');
      document.querySelector('.dashboard-viewport')
        ?.classList.remove('dashboard-viewport--sensor-table-view');
      persistSensorView('overview');

      if (tabMain && overviewView) {
        tabs?.classList.remove('show-all-sensors');
        tabs?.classList.add('show-overview');
        tabs?.classList.remove('show-activity');
        tabMain.classList.add('active');
        tabSensors?.classList.remove('active');
        tabActivity?.classList.remove('active');
        tabMain.setAttribute('aria-pressed', 'true');
        tabSensors?.setAttribute('aria-pressed', 'false');
        tabActivity?.setAttribute('aria-pressed', 'false');
        overviewView.hidden = false;
        if (listView) listView.hidden = true;
        if (activityView) activityView.hidden = true;
      }

      populateInspector(fullSensor);
    };

    row.addEventListener('click', loadNode);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadNode(); }
    });

    // Node ID
    const tdId = document.createElement('td');
    tdId.className = 'sensor-table-node-id';
    tdId.textContent = sensor.id;
    row.appendChild(tdId);

    // Location name
    const tdLoc = document.createElement('td');
    tdLoc.className = sensor.unplaced ? 'sensor-table-muted' : 'sensor-table-node-name';
    tdLoc.textContent = sensor.location;
    row.appendChild(tdLoc);

    // Status badge
    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `sensor-table-status-badge sensor-table-status-badge--${sensor.unplaced ? 'unplaced' : sensor.status.toLowerCase()}`;
    badge.innerHTML = `<span class="sensor-table-status-dot"></span>${sensor.unplaced ? `${sensor.status} · Unplaced` : sensor.status}`;
    tdStatus.appendChild(badge);
    row.appendChild(tdStatus);

    // Last Seen
    const tdSeen = document.createElement('td');
    tdSeen.className = 'sensor-table-muted sensor-table-seen';
    tdSeen.textContent = lastSeenDisplay(sensor);
    row.appendChild(tdSeen);

    // Battery — translate raw millivolt reading to percentage + colour
    const tdBat = document.createElement('td');
    const batteryPct = estimateBatteryPercent(sensor.battery);
    if (batteryPct === null) {
      tdBat.className = 'sensor-table-muted';
      tdBat.textContent = '—';
    } else {
      tdBat.className = 'sensor-table-battery';
      tdBat.style.color = batteryColor(batteryPct);
      tdBat.textContent = `${batteryPct}%`;
    }
    row.appendChild(tdBat);

    // Up Time — translate heartbeat counter to human-readable duration
    const tdUp = document.createElement('td');
    const formattedUptime = formatUptimeCounter(sensor.uptime);
    if (formattedUptime) {
      tdUp.textContent = formattedUptime.value;
    } else {
      tdUp.className = 'sensor-table-muted';
      tdUp.textContent = '—';
    }
    row.appendChild(tdUp);

    // Translate known sensor status values into readable labels.
    const tdSS = document.createElement('td');
    const statusInfo = sensorStatusInfo(sensor.sensorStatus);
    if (statusInfo) {
      tdSS.textContent = statusInfo.label;
      if (statusInfo.color === 'sn-green') tdSS.style.color = 'var(--color-green)';
      else if (statusInfo.color === 'sn-amber') tdSS.style.color = 'var(--color-yellow)';
    } else {
      tdSS.className = 'sensor-table-muted';
      tdSS.textContent = '—';
    }
    row.appendChild(tdSS);

    return row;
  }

  async function renderSensorList() {
    const body    = document.getElementById('sensor-list-body');
    const count   = document.getElementById('sensor-list-count');
    const pgMount = document.getElementById('sensor-list-pagination');
    const filter  = document.getElementById('sensor-status-filter');
    const exportButton = document.getElementById('sensor-export-button');
    const exportMenu = document.getElementById('sensor-export-options');
    const table   = body?.closest('table');
    const tableWrap = table?.closest('.sensor-table-wrap');
    const header  = table?.querySelector('thead');
    if (!body || !pgMount) return;

    if (sensorDataLoadError) {
      body.replaceChildren();
      const errorRow = document.createElement('tr');
      const errorCell = document.createElement('td');
      errorCell.colSpan = 7;
      errorCell.className = 'sensor-table-empty';
      errorCell.append('Could not load sensors from the database. ');
      const retryButton = document.createElement('button');
      retryButton.type = 'button';
      retryButton.className = 'sensor-tool-button';
      retryButton.textContent = 'Retry';
      retryButton.addEventListener('click', () => window.location.reload());
      errorCell.appendChild(retryButton);
      errorRow.appendChild(errorCell);
      body.appendChild(errorRow);
      if (count) count.textContent = 'Unavailable';
      return;
    }

    // Empty state
    if (allRows.length === 0) {
      body.replaceChildren();
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 7;
      emptyCell.className = 'sensor-table-empty';
      emptyCell.textContent = 'No sensors registered in the device list yet.';
      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);
      if (count) count.textContent = '0 total';
      return;
    }

    let filteredRows = allRows;
    fleetPagination = await window.OrchidComponentLoader.initPagination(pgMount, {
      total:    filteredRows.length,
      pageSize: fleetPageSize,
      page:     1,
      onChange: (page, pageSize) => {
        renderPage(page, pageSize);
      }
    });

    function sizeRowsToTable() {
      if (!tableWrap || !header || body.rows.length !== fleetPageSize) return;
      const rowHeight = (tableWrap.clientHeight - header.getBoundingClientRect().height - 2) / fleetPageSize;
      Array.from(body.rows).forEach((row) => {
        row.style.height = `${rowHeight}px`;
      });
    }

    function renderPage(page, pageSize) {
      const start = (page - 1) * pageSize;
      const slice = filteredRows.slice(start, start + pageSize);
      if (slice.length) {
        body.replaceChildren(...slice.map(buildSensorRow));
      } else {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 7;
        emptyCell.className = 'sensor-table-empty';
        emptyCell.textContent = 'No sensors match this filter.';
        emptyRow.appendChild(emptyCell);
        body.replaceChildren(emptyRow);
      }
      tableWrap?.classList.toggle('sensor-table-wrap--partial', slice.length < fleetPageSize);
      sizeRowsToTable();
      if (count) count.textContent = filteredRows.length === allRows.length
        ? `${allRows.length} total`
        : `${filteredRows.length} of ${allRows.length} sensors`;
    }

    function applyFleetFilter(status) {
      filteredRows = status === 'All'
        ? allRows
        : status === 'Unplaced'
          ? allRows.filter((sensor) => sensor.unplaced)
          : allRows.filter((sensor) => !sensor.unplaced && sensor.status === status);
      fleetPagination.setTotal(filteredRows.length);
      renderPage(1, fleetPageSize);
    }

    showFleetNode = (sensor) => {
      if (filter && filter.value !== 'All') {
        const matchesFilter = filter.value === 'Unplaced'
          ? sensor.unplaced
          : !sensor.unplaced && sensor.status === filter.value;
        if (!matchesFilter) filter.value = 'All';
      }
      applyFleetFilter(filter?.value || 'All');

      selectedFleetNodeKey = sensor.key;
      const rowIndex = filteredRows.findIndex((row) => row.key === sensor.key);
      if (rowIndex >= 0) {
        fleetPagination.setPage(Math.floor(rowIndex / fleetPageSize) + 1);
      }
    };

    filter?.addEventListener('change', () => applyFleetFilter(filter.value));
    exportButton?.addEventListener('click', () => {
      const isExpanded = exportButton.getAttribute('aria-expanded') === 'true';
      exportButton.setAttribute('aria-expanded', String(!isExpanded));
      if (exportMenu) exportMenu.hidden = isExpanded;
    });
    exportMenu?.addEventListener('click', (event) => {
      const item = event.target.closest('[data-export-format]');
      if (!item) return;

      exportMenu.hidden = true;
      exportButton?.setAttribute('aria-expanded', 'false');
      if (item.dataset.exportFormat === 'csv') exportFleetCsv();
      else if (item.dataset.exportFormat === 'pdf') exportFleetPdf();
    });
    document.addEventListener('click', (event) => {
      if (!exportMenu?.contains(event.target) && !exportButton?.contains(event.target)) {
        if (exportMenu) exportMenu.hidden = true;
        exportButton?.setAttribute('aria-expanded', 'false');
      }
    });
    exportButton?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' && exportMenu) {
        event.preventDefault();
        exportMenu.hidden = false;
        exportButton.setAttribute('aria-expanded', 'true');
        exportMenu.querySelector('[role="menuitem"]')?.focus();
      } else if (event.key === 'Escape' && exportMenu && !exportMenu.hidden) {
        exportMenu.hidden = true;
        exportButton.setAttribute('aria-expanded', 'false');
      }
    });
    exportMenu?.addEventListener('keydown', (event) => {
      const items = Array.from(exportMenu.querySelectorAll('[role="menuitem"]'));
      const currentIndex = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        items[(currentIndex + direction + items.length) % items.length]?.focus();
      } else if (event.key === 'Escape') {
        exportMenu.hidden = true;
        exportButton?.setAttribute('aria-expanded', 'false');
        exportButton?.focus();
      }
    });

    renderPage(1, fleetPageSize);
    if (tableWrap && 'ResizeObserver' in window) {
      new ResizeObserver(sizeRowsToTable).observe(tableWrap);
    }
  }

  function fleetExportColumns() {
    return [
      ['Node ID', (sensor) => sensor.id],
      ['Node Name', (sensor) => sensor.location],
      ['Latitude', (sensor) => sensor.latitude],
      ['Longitude', (sensor) => sensor.longitude],
      ['Status', (sensor) => sensor.status],
      ['Deployment', (sensor) => sensor.unplaced ? 'Unplaced' : 'Deployed'],
      ['Last Reported', lastSeenDisplay],
      ['Battery', (sensor) => sensor.battery],
      ['Up Time', (sensor) => sensor.uptime],
      ['Sensor Status', (sensor) => sensor.sensorStatus],
      ['Temperature', (sensor) => sensor.temperature],
      ['Map Temperature', (sensor) => sensor.mapTemperature],
      ['Heat Index', (sensor) => sensor.heatIndex],
      ['Humidity', (sensor) => sensor.humidity],
      ['Pressure', (sensor) => sensor.pressure],
    ];
  }

  function exportFleetCsv() {
    const columns = fleetExportColumns();
    const escapeCsv = (value) => {
      const text = value == null || value === '--' ? '' : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [
      columns.map(([header]) => escapeCsv(header)).join(','),
      ...allSensors.map((sensor) => columns.map(([, value]) => escapeCsv(value(sensor))).join(','))
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'orchid-sensor-fleet.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportFleetPdf() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.OrchidToast.show({
        variant: 'error',
        title: 'Export blocked',
        message: 'Allow pop-ups to open the printable PDF report.'
      });
      return;
    }

    const columns = fleetExportColumns();
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
    const tableHead = columns.map(([header]) => `<th>${escapeHtml(header)}</th>`).join('');
    const tableRows = allSensors.map((sensor) => `
      <tr>${columns.map(([, value]) => {
        const cell = value(sensor);
        return `<td>${escapeHtml(cell == null || cell === '--' ? '—' : cell)}</td>`;
      }).join('')}</tr>`).join('');

    printWindow.document.write(`<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>ORCHID Sensor Device</title>
        <style>
          @page { size: landscape; margin: 12mm; }
          body { color: #18202b; font: 10px Arial, sans-serif; }
          h1 { margin: 0 0 4px; font-size: 20px; }
          p { margin: 0 0 14px; color: #566170; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 5px; border: 1px solid #cbd2dc; text-align: left; }
          th { background: #f0e8fa; font-size: 9px; }
          tr { break-inside: avoid; }
          @media screen { body { margin: 24px; } }
        </style>
      </head>
      <body>
        <h1>ORCHID Sensor Device</h1>
        <p>${allSensors.length} sensors · Exported ${escapeHtml(new Date().toLocaleString())}</p>
        <table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table>
        <script>window.addEventListener('load', () => window.print());</script>
      </body>
      </html>`);
    printWindow.document.close();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // View toggle (Sensor Overview / All Sensors tabs)
  // ──────────────────────────────────────────────────────────────────────────

  function initViewToggle() {
    const tabs             = document.querySelector('.sensor-control-tabs');
    const overviewButton   = document.getElementById('tab-main');
    const allSensorsButton = document.getElementById('tab-sensors');
    const activityButton   = document.getElementById('tab-activity');
    const overviewView     = document.getElementById('sensor-overview-view');
    const listView         = document.getElementById('sensor-list-view');
    const activityView     = document.getElementById('sensor-activity-view');
    if (!tabs || !overviewButton || !allSensorsButton || !activityButton ||
        !overviewView || !listView || !activityView) return;

    const STORAGE_KEY = 'orchid-sensor-tab';

    const setView = (view, persist = true) => {
      const showAll = view === 'all';
      const showOverview = view === 'overview';
      const showActivity = view === 'activity';
      tabs.classList.toggle('show-all-sensors', showAll);
      tabs.classList.toggle('show-overview', showOverview);
      tabs.classList.toggle('show-activity', showActivity);
      overviewButton.classList.toggle('active', showOverview);
      allSensorsButton.classList.toggle('active', showAll);
      activityButton.classList.toggle('active', showActivity);
      overviewButton.setAttribute('aria-pressed', String(showOverview));
      allSensorsButton.setAttribute('aria-pressed', String(showAll));
      activityButton.setAttribute('aria-pressed', String(showActivity));
      overviewView.hidden = !showOverview;
      listView.hidden = !showAll;
      activityView.hidden = !showActivity;
      document.querySelector('.dashboard-viewport')
        ?.classList.toggle('dashboard-viewport--sensor-table-view', showAll || showActivity);
      if (persist) persistSensorView(view);
    };

    const params = new URLSearchParams(window.location.search);
    const requestedView = params.has('node') ? 'overview' : params.get('view');
    const saved = sessionStorage.getItem(STORAGE_KEY);
    const initialView = requestedView === 'all' || requestedView === 'overview' || requestedView === 'activity'
      ? requestedView
      : ['all', 'overview', 'activity'].includes(saved) ? saved : 'all';
    setView(initialView);

    overviewButton.addEventListener('click', () => setView('overview'));
    allSensorsButton.addEventListener('click', () => setView('all'));
    activityButton.addEventListener('click', () => setView('activity'));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Node inspector helpers
  // ──────────────────────────────────────────────────────────────────────────

  function heatIndexLevel(str) {
    const n = parseFloat(str);
    if (isNaN(n))  return '—';
    if (n >= 54)   return 'Extreme Danger';
    if (n >= 41)   return 'Danger';
    if (n >= 32)   return 'Extreme Caution';
    if (n >= 27)   return 'Caution';
    return 'Normal';
  }

  function numericPart(str) {
    return (str || '').replace(/[^0-9.]/g, '');
  }

  function formatBatteryVoltage(batteryReading) {
    const millivolts = Number.parseFloat(numericPart(batteryReading));
    if (!Number.isFinite(millivolts) || millivolts < 2500 || millivolts > 4500) return null;
    return `${(millivolts / 1000).toFixed(3)} V`;
  }

  function estimateBatteryPercent(batteryReading) {
    return window.OrchidComponentLoader.estimateBatteryPercent(batteryReading);
  }

  function batteryColor(percent) {
    if (percent === null) return 'var(--text-muted)';
    if (percent < 20) return 'var(--color-red)';
    if (percent < 50) return 'var(--color-yellow)';
    return 'var(--color-green)';
  }

  function formatUptimeCounter(counterValue) {
    if (counterValue === null || counterValue === undefined || counterValue === '') return null;
    const counter = Number(counterValue);
    if (!Number.isInteger(counter) || counter < 0 || counter > 65535) return null;
    const totalMinutes = counter;
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return {
      value: days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`,
      counter
    };
  }

  function sensorStatusInfo(value) {
    if (value === null || value === undefined || value === '') return null;
    const status = Number(value);
    if (status === 1) {
      return {
        label: 'Normal',
        detail: 'Sensor operating normally',
        color: 'sn-green'
      };
    }
    if (status === 3) {
      return {
        label: 'Battery warning',
        detail: 'Sensor operating · battery is low',
        color: 'sn-amber'
      };
    }
    return {
      label: 'Unrecognized status',
      detail: 'Status could not be identified',
      color: ''
    };
  }

  function estimateWeatherTrend(sensor) {
    const readings = sensor.recentReadings
      .map((reading) => ({
        ageMinutes: reading.ageMinutes,
        humidity: reading.humidity,
        pressure: reading.pressure
      }))
      .filter((reading) => Number.isFinite(reading.ageMinutes) && reading.ageMinutes >= 0)
      .sort((a, b) => a.ageMinutes - b.ageMinutes);

    const latest = readings[0];
    if (!latest || latest.ageMinutes > 15) {
      return null;
    }

    const previous = readings.slice(1).find((reading) => {
      const separationMinutes = reading.ageMinutes - latest.ageMinutes;
      return reading.ageMinutes <= 90 && separationMinutes >= 15;
    });
    if (!previous ||
        typeof latest.humidity !== 'number' || !Number.isFinite(latest.humidity) || latest.humidity < 0 || latest.humidity > 100 ||
        typeof previous.humidity !== 'number' || !Number.isFinite(previous.humidity) || previous.humidity < 0 || previous.humidity > 100 ||
        typeof latest.pressure !== 'number' || !Number.isFinite(latest.pressure) || latest.pressure < 300 || latest.pressure > 1200 ||
        typeof previous.pressure !== 'number' || !Number.isFinite(previous.pressure) || previous.pressure < 300 || previous.pressure > 1200) {
      return null;
    }

    const humidityChange = latest.humidity - previous.humidity;
    const pressureChange = latest.pressure - previous.pressure;
    if (humidityChange >= 5 && pressureChange <= -1) return 'Rain potential rising';
    if (humidityChange <= -5 && pressureChange >= 1) return 'Rain potential easing';
    if (Math.abs(humidityChange) < 5 && Math.abs(pressureChange) < 1) return 'Conditions stable';
    return 'Mixed signals';
  }

  function resetInspector() {
    const values = {
      'sn-node-id-badge': '—',
      'sn-status-badge': 'No Data',
      'sn-node-name': 'No sensor data available',
      'sn-node-location': 'Waiting for sensor data.',
      'sn-last-seen': '—',
      'sn-battery': '—',
      'sn-battery-sub': 'No battery reading',
      'sn-uptime': 'No data',
      'sn-uptime-sub': 'Waiting for sensor data',
      'sn-sensor-status': 'No data',
      'sn-sensor-status-sub': 'Reported by sensor',
      'sn-weather': 'No data',
      'sn-forecast': 'Unavailable',
      'sn-forecast-sub': 'Needs recent humidity and pressure readings',
      'sn-temp': '—',
      'sn-humidity': '—',
      'sn-pressure': '—',
      'sn-heat-index': '—',
      'sn-heat-level': '—'
    };

    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    });

    const batteryFill = document.getElementById('sn-battery-fill');
    if (batteryFill) {
      batteryFill.style.width = '0%';
      batteryFill.style.background = 'var(--text-muted)';
      batteryFill.style.boxShadow = 'none';
      batteryFill.parentElement?.setAttribute('aria-valuenow', '0');
      batteryFill.parentElement?.setAttribute('aria-valuetext', 'Battery level unavailable');
    }
    const battery = document.getElementById('sn-battery');
    if (battery) battery.style.color = 'var(--text-muted)';

  }

  // ──────────────────────────────────────────────────────────────────────────
  // Node inspector — populate all fields from a sensor object
  // ──────────────────────────────────────────────────────────────────────────

  function populateInspector(sensor) {
    const isOnline = sensor.status === 'Online';

    // Node identity
    const idBadge = document.getElementById('sn-node-id-badge');
    if (idBadge) idBadge.textContent = sensor.id;

    const statusBadge = document.getElementById('sn-status-badge');
    if (statusBadge) {
      statusBadge.textContent = isOnline ? '● Online' : '● Offline';
      statusBadge.className   = isOnline ? 'sn-badge sn-badge--online' : 'sn-badge sn-badge--offline';
    }

    const nodeName = document.getElementById('sn-node-name');
    if (nodeName) {
      nodeName.textContent = sensor.unplaced
        ? `${sensor.id} — Not Yet Deployed`
        : sensor.location || sensor.name;
    }

    const nodeLocation = document.getElementById('sn-node-location');
    if (nodeLocation) {
      if (sensor.unplaced) {
        nodeLocation.textContent = 'Registered in fleet · Not placed on map';
      } else {
        const nearby = Number.isFinite(sensor.latitude) && Number.isFinite(sensor.longitude)
          ? reverseGeocode(sensor.latitude, sensor.longitude)
          : null;
        nodeLocation.textContent = nearby || sensor.location || 'Location not set';
      }
    }
    const uptime = document.getElementById('sn-uptime');
    const uptimeSub = document.getElementById('sn-uptime-sub');
    const formattedUptime = formatUptimeCounter(sensor.uptime);
    if (uptime) uptime.textContent = formattedUptime?.value || '—';
    if (uptimeSub) {
      uptimeSub.textContent = formattedUptime
        ? 'Estimated from sensor data'
        : 'Uptime counter unavailable';
    }
    const weather = document.getElementById('sn-weather');
    if (weather) weather.textContent = sensor.weather && sensor.weather !== '--' ? sensor.weather : '—';
    const estimate = estimateWeatherTrend(sensor);
    const forecast = document.getElementById('sn-forecast');
    if (forecast) forecast.textContent = estimate || 'Unavailable';
    const forecastSub = document.getElementById('sn-forecast-sub');
    if (forecastSub) {
      forecastSub.textContent = estimate
        ? 'Humidity and pressure trend estimate · not a forecast'
        : 'Needs two fresh humidity and pressure readings';
    }

    // Last seen
    const lastSeen = document.getElementById('sn-last-seen');
    if (lastSeen) {
      lastSeen.textContent = lastSeenDisplay(sensor);
    }

    const battery = document.getElementById('sn-battery');
    const batteryFill = document.getElementById('sn-battery-fill');
    const batterySub = document.getElementById('sn-battery-sub');
    const batteryPercent = estimateBatteryPercent(sensor.battery);
    const voltage = formatBatteryVoltage(sensor.battery);
    const color = batteryColor(batteryPercent);
    if (battery) {
      battery.textContent = batteryPercent === null ? '—' : `${batteryPercent}%`;
      battery.style.color = color;
    }
    if (batteryFill) {
      batteryFill.style.width = batteryPercent === null ? '0%' : `${batteryPercent}%`;
      batteryFill.style.background = color;
      const glowColor = batteryPercent === null ? '148,163,184'
        : batteryPercent < 20 ? '239,68,68'
          : batteryPercent < 50 ? '245,158,11' : '34,197,94';
      batteryFill.style.boxShadow = batteryPercent === null
        ? 'none'
        : `0 0 10px rgba(${glowColor},0.6), 0 0 20px rgba(${glowColor},0.3)`;
      batteryFill.parentElement?.setAttribute('aria-valuenow', String(batteryPercent ?? 0));
      batteryFill.parentElement?.setAttribute('aria-valuetext', batteryPercent === null
        ? 'Battery level unavailable'
        : `Approximately ${batteryPercent}% from ${voltage}`);
    }
    if (batterySub) {
      batterySub.textContent = batteryPercent === null
        ? 'No battery reading'
        : `${voltage} · estimated from voltage`;
    }

    // Sensor status
    const sensorStatus = document.getElementById('sn-sensor-status');
    const sensorStatusSub = document.getElementById('sn-sensor-status-sub');
    const mappedSensorStatus = sensorStatusInfo(sensor.sensorStatus);
    if (sensorStatus) {
      sensorStatus.textContent = mappedSensorStatus?.label || 'Unknown';
      sensorStatus.className = `sn-health-value${mappedSensorStatus?.color ? ` ${mappedSensorStatus.color}` : ''}`;
    }
    if (sensorStatusSub) sensorStatusSub.textContent = mappedSensorStatus?.detail || 'Status unavailable';

    // Telemetry
    const fields = [
      { id: 'sn-temp',       raw: sensor.temperature, unit: '°C'  },
      { id: 'sn-humidity',   raw: sensor.humidity,    unit: '%'   },
      { id: 'sn-pressure',   raw: sensor.pressure,    unit: ' hPa'},
      { id: 'sn-heat-index', raw: sensor.heatIndex,   unit: '°C'  }
    ];

    fields.forEach(({ id, raw, unit }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const n = raw !== '--' ? numericPart(raw) : '—';
      el.innerHTML = n !== '—'
        ? `${n}<span class="sn-unit">${unit}</span>`
        : '—';
    });

    const heatLevelEl = document.getElementById('sn-heat-level');
    if (heatLevelEl) {
      heatLevelEl.textContent = sensor.heatIndex !== '--'
        ? heatIndexLevel(sensor.heatIndex)
        : '—';
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Node inspector — mount the search component and wire selection
  // ──────────────────────────────────────────────────────────────────────────

  async function initNodeInspector() {
    const mountEl = document.getElementById('sensor-node-search-mount');
    if (!mountEl) return;

    const listView = document.getElementById('sensor-list-view');
    if (allSensors.length === 0) resetInspector();
    await window.OrchidComponentLoader.initNodeSearch(
      mountEl,
      searchItems,
      (selectedItem) => {
        const sensor = allSensors.find((s) => s.key === selectedItem.key);
        if (!sensor) return;

        if (listView && !listView.hidden && fleetPagination) {
          showFleetNode?.(sensor);
          return;
        }

        populateInspector(sensor);
      }
    );
    if (!listView?.hidden && allSensors.length) populateInspector(allSensors[0]);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Boot
  // ──────────────────────────────────────────────────────────────────────────

  document.addEventListener('orchid:components-ready', async () => {
    const requestedNodeId = new URLSearchParams(window.location.search).get('node');
    if (requestedNodeId) persistSensorView('overview');
    updateDatabaseStatus('Loading sensor database…', 'loading');
    try {
      await loadSensorData();
      updateDatabaseStatus(`${fleetTotal} node${fleetTotal === 1 ? '' : 's'} loaded from the sensor database.`);
    } catch (error) {
      sensorDataLoadError = true;
      console.error('Could not load sensor-management data from the ORCHID database.', error);
      updateDatabaseStatus(error.message, 'error');
      window.OrchidToast.show({
        variant: 'error',
        title: 'Sensor database unavailable',
        message: error.message
      });
    }
    initFleetMetrics();
    await renderSensorActivity();
    await renderSensorList();
    initViewToggle();
    await initNodeInspector();
    if (requestedNodeId) {
      const requestedNode = allSensors.find((sensor) => sensor.id === requestedNodeId);
      if (requestedNode) populateInspector(requestedNode);
      else window.OrchidToast.show({
        variant: 'error',
        title: 'Node not found',
        message: `Node ${requestedNodeId} is not present in the sensor database.`
      });
    }
    setTimeout(() => window.OrchidComponentLoader.initAnalyticsTooltips(), 0);
  });

})();
