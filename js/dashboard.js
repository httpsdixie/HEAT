/**
 * js/dashboard.js
 * Dashboard Controller — ORCHID Heat Index Device
 */
(function () {
  'use strict';

  let SENSOR_NODES = [];
  const NODE_DATA = Object.create(null);
  const ORMOC_CENTER = [11.00639, 124.6075];
  const ORMOC_ZOOM = 13;
  const SENSOR_LOCATIONS = [];
  let sensorLayers = null;
  let legendTotalElement = null;
  let dashboardReady = false;
  let databaseRefreshInProgress = false;
  let databaseConnected = false;
  let nodeHistoryRequestId = 0;
  const hiddenHeatTrendSeries = new Set();
  const requestedMetric = new URLSearchParams(window.location.search).get('metric');
  const selectedMetric = ['temperature', 'humidity', 'pressure'].includes(requestedMetric)
    ? requestedMetric
    : 'heat-index';
  const isTemperaturePage = selectedMetric === 'temperature';
  const isHumidityPage = selectedMetric === 'humidity';
  const isPressurePage = selectedMetric === 'pressure';
  const isNonHeatMetricPage = selectedMetric !== 'heat-index';
  let currentHeatTrendNodes = [];
  let currentHeatTrendReadings = [];
  let currentHeatIndexNodes = [];
  let currentHeatIndexReadings = [];
  let heatLocationPagination = null;
  let heatLocationRows = [];
  let heatLocationSearchQuery = '';
  let heatLocationStatusFilter = 'all';
  const heatLocationPageSize = 7;
  const HEAT_INDEX_VIEW_STORAGE_KEY = `orchid-${selectedMetric}-view`;
  const MAX_TREND_RANGE_DAYS = 30;
  let heatIndexStartDate = manilaDateString(new Date());
  let heatIndexEndDate = heatIndexStartDate;

  // Restore the selected date range from the URL (survives auto-refresh).
  (function restoreFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const today = manilaDateString(new Date());
    const legacyDate = params.get('date');
    const startDate = params.get('startDate') || legacyDate;
    const endDate = params.get('endDate') || legacyDate;
    const validDate = (value) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
      if (!match || value > today) return false;
      const [, year, month, day] = match.map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day;
    };
    if (validDate(startDate) && validDate(endDate) && startDate <= endDate) {
      const rangeDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`))
        / (24 * 60 * 60 * 1000) + 1;
      if (rangeDays <= MAX_TREND_RANGE_DAYS) {
        heatIndexStartDate = startDate;
        heatIndexEndDate = endDate;
      }
    }
  })();
  const hasMapPlacementControls = Boolean(document.getElementById('add-sensor-panel'));

  // ── Sparkline chart instances & history ──────────────────────
  // Each buffer holds a rolling window of the last 60 readings so the
  // sparkline shows a meaningful trend without growing unbounded.
  const CHART_HISTORY_MAX = 60;
  const chartHistory = {
    temperature: [],
    humidity: [],
    pressure: []
  };
  const chartInstances = {
    temperature: null,
    humidity: null,
    pressure: null
  };

  const _style = getComputedStyle(document.documentElement);
  const accentLight = _style.getPropertyValue('--color-accent-light').trim() || '#a6c4ee';
  const CHART_CONFIG = {
    temperature: { color: _style.getPropertyValue('--color-red').trim()    || '#ef4444', fillColor: _style.getPropertyValue('--color-red').trim()    || '#ef4444' },
    humidity:    { color: _style.getPropertyValue('--color-cyan').trim()   || '#38bdf8', fillColor: _style.getPropertyValue('--color-cyan').trim()   || '#38bdf8' },
    pressure:    { color: _style.getPropertyValue('--color-violet').trim() || '#a78bfa', fillColor: _style.getPropertyValue('--color-violet').trim() || '#a78bfa' }
  };

  async function requestJson(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        ...options
      });
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
    if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
    return payload;
  }

  function updateNodePlacement(nodeId, location, latitude, longitude) {
    const node = SENSOR_NODES.find((item) => item.id === String(nodeId));
    if (!node) return;
    node.location = location;
    node.name = location;
    node.latitude = latitude;
    node.longitude = longitude;
    node.mapTemperature = node.temperature;
    if (dashboardReady) {
      window.dispatchEvent(new CustomEvent('orchid:sensor-data-updated', { detail: { nodes: SENSOR_NODES } }));
    } else {
      indexSensorNodes();
    }
  }

  async function loadNodesFromDatabase(historyStartDate = null, historyEndDate = null) {
    const requestId = ++nodeHistoryRequestId;
    const endpoint = historyStartDate && historyEndDate
      ? `/api/nodes?startDate=${encodeURIComponent(historyStartDate)}&endDate=${encodeURIComponent(historyEndDate)}`
      : '/api/nodes';
    const payload = await requestJson(endpoint);
    if (requestId !== nodeHistoryRequestId) return false;
    if (!Array.isArray(payload.nodes) || payload.nodes.some((node) =>
      !node || typeof node.key !== 'string' || typeof node.id !== 'string' || typeof node.status !== 'string')) {
      throw new Error('The sensor database returned an invalid node list.');
    }
    SENSOR_NODES = payload.nodes;
    databaseConnected = true;
    indexSensorNodes();
    return true;
  }

  async function persistNodePlacement(node, location, latitude, longitude) {
    await requestJson(`/api/map/placements/${encodeURIComponent(node.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        location_name: location,
        latitude,
        longitude
      })
    });
    updateNodePlacement(node.id, location, latitude, longitude);
  }

  function isOnlineNode(node) {
    return typeof node.status === 'string' &&
      ['online', 'active', 'transmitting'].includes(node.status.toLowerCase());
  }

  function isDeployedNode(node) {
    return parseReading(node.latitude) !== null && parseReading(node.longitude) !== null;
  }

  function indexSensorNodes() {
    Object.keys(NODE_DATA).forEach((key) => delete NODE_DATA[key]);
    SENSOR_LOCATIONS.splice(0, SENSOR_LOCATIONS.length);
    SENSOR_NODES.forEach((node) => {
      if (!node || typeof node.key !== 'string') return;
      NODE_DATA[node.key] = { ...node, temp: node.temperature };
      const latitude = parseReading(node.latitude);
      const longitude = parseReading(node.longitude);
      if (latitude !== null && longitude !== null) {
        SENSOR_LOCATIONS.push({
          id: node.key,
          lat: latitude,
          lng: longitude,
          location: node.location || node.key,
          temperature: node.mapTemperature !== undefined && node.mapTemperature !== null
            ? `${node.mapTemperature}°C`
            : node.temperature ? `${node.temperature}°C` : '—'
        });
      }
    });
  }

  indexSensorNodes();

  function parseReading(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const match = value.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function manilaDateString(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function sensorTimestamp(value) {
    if (typeof value !== 'string') return NaN;
    const timestamp = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}+08:00`);
    return Number.isFinite(timestamp) ? timestamp : NaN;
  }

  function formatHistoryTimestamp(timestamp) {
    return `${new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(timestamp))} PHT`;
  }

  function heatIndexDateRange(startDate, endDate) {
    const start = Date.parse(`${startDate}T00:00:00+08:00`);
    const dayEnd = Date.parse(`${endDate}T00:00:00+08:00`) + 24 * 60 * 60 * 1000;
    const end = Math.min(Date.now(), dayEnd);
    return { start, end };
  }

  function escapeHtml(value) {
    return String(value ?? '—').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function formatNodeTimestamp(raw) {
    if (!raw) return '—';
    try {
      const normalized = /[zZ]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}+08:00`;
      const date = new Date(normalized);
      if (!Number.isFinite(date.getTime())) return raw;
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }).format(date) + ' PHT';
    } catch {
      return raw;
    }
  }

  function heatIndexCelsius(node, temperature, humidity) {
    const reported = parseReading(node.heatIndex);
    if (reported !== null) return reported;
    if (temperature === null || humidity === null || temperature * 9 / 5 + 32 < 80 || humidity < 40) {
      return temperature;
    }

    const fahrenheit = temperature * 9 / 5 + 32;
    const hi = -42.379 + 2.04901523 * fahrenheit + 10.14333127 * humidity
      - 0.22475541 * fahrenheit * humidity - 0.00683783 * fahrenheit ** 2
      - 0.05481717 * humidity ** 2 + 0.00122874 * fahrenheit ** 2 * humidity
      + 0.00085282 * fahrenheit * humidity ** 2 - 0.00000199 * fahrenheit ** 2 * humidity ** 2;
    return (hi - 32) * 5 / 9;
  }

  function heatLevel(value) {
    if (value < 27) return { key: 'safe', label: 'Safe' };
    if (value < 32) return { key: 'caution', label: 'Caution' };
    if (value < 41) return { key: 'extreme-caution', label: 'Extreme caution' };
    if (value < 54) return { key: 'danger', label: 'Danger' };
    return { key: 'extreme-danger', label: 'Extreme danger' };
  }

  function temperatureLevel(value) {
    if (value < 20) return { key: 'safe', label: 'Cool' };
    if (value < 25) return { key: 'caution', label: 'Comfortable' };
    if (value < 32) return { key: 'extreme-caution', label: 'Warm' };
    if (value < 40) return { key: 'danger', label: 'Hot' };
    return { key: 'extreme-danger', label: 'Very hot' };
  }

  function humidityLevel(value) {
    if (value < 30) return { key: 'safe', label: 'Dry' };
    if (value < 40) return { key: 'caution', label: 'Low' };
    if (value < 60) return { key: 'extreme-caution', label: 'Comfortable' };
    if (value < 80) return { key: 'danger', label: 'Humid' };
    return { key: 'extreme-danger', label: 'Very humid' };
  }

  function pressureLevel(value) {
    if (value < 980) return { key: 'safe', label: 'Very low' };
    if (value < 1000) return { key: 'caution', label: 'Low' };
    if (value < 1020) return { key: 'extreme-caution', label: 'Normal' };
    if (value < 1040) return { key: 'danger', label: 'High' };
    return { key: 'extreme-danger', label: 'Very high' };
  }

  function metricLevel(value) {
    if (isTemperaturePage) return temperatureLevel(value);
    if (isHumidityPage) return humidityLevel(value);
    if (isPressurePage) return pressureLevel(value);
    return heatLevel(value);
  }

  function metricValue(reading) {
    return parseReading(reading?.[selectedMetric === 'heat-index' ? 'heatIndex' : selectedMetric]);
  }

  function getDateAwareReadings(node) {
    if (Array.isArray(node.dateReadings)) return node.dateReadings;
    if (heatIndexEndDate !== manilaDateString(new Date())) return [];
    return Array.isArray(node.recentReadings) ? node.recentReadings : [];
  }

  function metricName() {
    if (isTemperaturePage) return 'Temperature';
    if (isHumidityPage) return 'Humidity';
    if (isPressurePage) return 'Pressure';
    return 'Heat Index';
  }

  function updateTelemetryHistoryHeading() {
    const title = document.querySelector('#hi-panel-locations .status-card-title');
    const subtitle = document.querySelector('#hi-panel-locations .hi-table-heading p');
    if (title) title.textContent = `Historical ${metricName()} Data Logs`;
    if (subtitle) {
      subtitle.textContent = `Showing ${metricName().toLowerCase()} readings from ${selectedHeatIndexDateRangeLabel()}.`;
    }
  }

  function selectedHeatIndexDateRangeLabel() {
    const formatDate = (value) => new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(new Date(`${value}T00:00:00+08:00`));
    return heatIndexStartDate === heatIndexEndDate
      ? formatDate(heatIndexStartDate)
      : `${formatDate(heatIndexStartDate)} – ${formatDate(heatIndexEndDate)}`;
  }

  function metricUnit() {
    if (isTemperaturePage) return '°C';
    if (isHumidityPage) return '%';
    if (isPressurePage) return ' hPa';
    return '°C';
  }

  function metricHistoryColumns() {
    if (isTemperaturePage) {
      return ['Timestamp', 'Node ID', 'Station / Location', 'Temperature (°C)', 'Humidity (%)', 'Pressure (hPa)', 'Temperature Band'];
    }
    if (isHumidityPage) {
      return ['Timestamp', 'Node ID', 'Station / Location', 'Humidity (%)', 'Temperature (°C)', 'Pressure (hPa)', 'Humidity Band'];
    }
    if (isPressurePage) {
      return ['Timestamp', 'Node ID', 'Station / Location', 'Pressure (hPa)', 'Temperature (°C)', 'Humidity (%)', 'Pressure Band'];
    }
    return ['Timestamp', 'Node ID', 'Station / Location', 'Heat Index (°C)', 'Raw Temp (°C)', 'Humidity (%)', 'Risk Level'];
  }

  function configureMetricPage() {
    if (!isNonHeatMetricPage) return;
    const name = metricName();
    document.title = `ORCHID | ${name}`;
    const setText = (selector, text) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = text;
    };
    const trendTab = document.getElementById('hi-tab-risk');
    if (trendTab) {
      const icon = trendTab.querySelector('svg');
      trendTab.replaceChildren(...(icon
        ? [icon, document.createTextNode(` ${name} Trend`)]
        : [document.createTextNode(`${name} Trend`)]));
    }
    setText('#hi-trend-legend-title', 'Node Filter');
    setText('#hi-trend-title', `${name} Trend`);
    setText('#hi-trend-mode', 'Average across reporting nodes');
    const historyTab = document.getElementById('hi-tab-locations');
    if (historyTab) {
      const icon = historyTab.querySelector('svg');
      historyTab.replaceChildren(...(icon
        ? [icon, document.createTextNode(' History Data')]
        : [document.createTextNode('History Data')]));
    }
    const chartWrap = document.getElementById('hi-trend-chart-wrap');
    if (chartWrap) chartWrap.setAttribute('aria-label', `${name} Trend chart`);
    const thresholdKey = document.querySelector('.hi-trend-threshold-key');
    if (thresholdKey) thresholdKey.hidden = true;
    const historyHeadings = document.querySelectorAll('#hi-panel-locations .hi-node-table thead th');
    metricHistoryColumns()
      .forEach((label, index) => {
        if (historyHeadings[index]) historyHeadings[index].textContent = label;
      });
    const statusSelect = document.getElementById('hi-history-status-filter');
    if (statusSelect) {
      statusSelect.setAttribute('aria-label', `Filter ${name.toLowerCase()} history by band`);
      const bands = isTemperaturePage
        ? [['safe', 'Cool'], ['caution', 'Comfortable'], ['extreme-caution', 'Warm'], ['danger', 'Hot'], ['extreme-danger', 'Very hot']]
        : isHumidityPage
          ? [['safe', 'Dry'], ['caution', 'Low'], ['extreme-caution', 'Comfortable'], ['danger', 'Humid'], ['extreme-danger', 'Very humid']]
          : [['safe', 'Very low'], ['caution', 'Low'], ['extreme-caution', 'Normal'], ['danger', 'High'], ['extreme-danger', 'Very high']];
      statusSelect.replaceChildren(
        ...[
          ['all', 'All statuses'],
          ...bands
        ].map(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          return option;
        })
      );
    }
  }

  function average(readings) {
    return readings.length ? readings.reduce((total, value) => total + value, 0) / readings.length : null;
  }

  function formatReading(value, unit) {
    return value === null ? '—' : `${value.toFixed(1)}${unit}`;
  }

  // ── Sparkline helpers ─────────────────────────────────────────
  /**
   * Initialise chart instances once the DOM is ready.
   * Safe to call multiple times — skips already-initialised charts.
   */
  function initCharts() {
    if (!window.OrchidChart) return;
    ['temperature', 'humidity', 'pressure'].forEach((key) => {
      if (chartInstances[key]) return;
      const container = document.getElementById(`fleet-analytics-${key}-chart`);
      if (!container) return;
      chartInstances[key] = window.OrchidChart.create(container, {
        ...CHART_CONFIG[key],
        height:  46,
        padding: 4,
        smooth:  true
      });
    });
  }

  /**
   * Determine a simple trend label from a history buffer.
   * Compares the mean of the last third against the mean of the first third.
   */
  function trendLabel(history) {
    if (history.length < 4) return 'Stable';
    const third = Math.max(1, Math.floor(history.length / 3));
    const early = history.slice(0, third).reduce((s, v) => s + v, 0) / third;
    const late  = history.slice(-third).reduce((s, v) => s + v, 0) / third;
    const delta = late - early;
    if (delta >  0.3) return 'Rising';
    if (delta < -0.3) return 'Falling';
    return 'Stable';
  }

  /**
   * Seed a history buffer with a synthetic curve so the chart always has
   * something to render on the very first reading. The seed creates a gentle
   * wave around `value` using a small fixed spread, filling up to `count`
   * slots.  Real readings pushed afterwards will gradually overwrite the seed.
   */
  /** Update one sparkline chart and its subtext label — built from real recentReadings. */
  function updateChart(key, average, unit, subId, allNodes) {
    const subEl = document.getElementById(subId);
    if (average === null) {
      if (subEl) subEl.textContent = 'Waiting for data';
      return;
    }

    // Build chart data directly from recentReadings across all nodes, sorted oldest→newest
    const metricKey = key === 'pressure' ? 'pressure' : key === 'humidity' ? 'humidity' : 'temperature';
    const points = (allNodes || [])
      .flatMap(node => (Array.isArray(node.recentReadings) ? node.recentReadings : []))
      .filter(r => r[metricKey] !== null && r[metricKey] !== undefined)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(r => parseFloat(r[metricKey]));

    const history = points.length >= 2 ? points.slice(-CHART_HISTORY_MAX) : [average];
    chartHistory[key] = history;

    const instance = chartInstances[key];
    if (instance && history.length >= 2) {
      instance.update(history);
    }

    if (!subEl) return;
    if (key === 'pressure') {
      subEl.textContent = `Trend: ${trendLabel(history)}`;
    } else {
      const min = Math.min(...history).toFixed(1);
      const max = Math.max(...history).toFixed(1);
      subEl.textContent = `Min: ${min} / Max: ${max}`;
    }
  }

  function renderHeatLocationPage(page, pageSize) {
    const body = document.getElementById('hi-node-table-body');
    if (!body) return;
    const filteredRows = getFilteredHeatLocationRows();
    if (!filteredRows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.className = 'hi-table-empty';
      cell.textContent = heatLocationSearchQuery || heatLocationStatusFilter !== 'all'
        ? 'No historical readings match the selected filters.'
        : 'No readings found in the selected date range.';
      row.appendChild(cell);
      body.replaceChildren(row);
      return;
    }
    const start = (page - 1) * pageSize;
    body.replaceChildren(...filteredRows.slice(start, start + pageSize));
  }

  function getFilteredHeatLocationRows() {
    const query = heatLocationSearchQuery.trim().toLocaleLowerCase();
    return heatLocationRows.filter((row) =>
      (heatLocationStatusFilter === 'all' || row.dataset.riskStatus === heatLocationStatusFilter) &&
      (!query || row.textContent.toLocaleLowerCase().includes(query))
    );
  }

  function exportHeatLocationRows() {
    const columns = metricHistoryColumns();
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = getFilteredHeatLocationRows().map((row) =>
      [...row.cells].map((cell) => cell.textContent.trim()));
    const csv = [columns, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `orchid-${selectedMetric}-history-${heatIndexStartDate}-to-${heatIndexEndDate}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportHeatLocationPdf() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.OrchidToast.show({
        variant: 'error',
        title: 'Export blocked',
        message: 'Allow pop-ups to open the printable PDF report.'
      });
      return;
    }

    const name = metricName();
    const columns = metricHistoryColumns();
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
    const tableHead = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
    const tableRows = getFilteredHeatLocationRows().map((row) =>
      `<tr>${[...row.cells].map((cell) => `<td>${escapeHtml(cell.textContent.trim() || '—')}</td>`).join('')}</tr>`
    ).join('');

    printWindow.document.write(`<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>ORCHID ${name} History - ${escapeHtml(selectedHeatIndexDateRangeLabel())}</title>
        <style>
          @page { size: landscape; margin: 12mm; }
          body { color: #18202b; font: 10px Arial, sans-serif; }
          h1 { margin: 0 0 4px; font-size: 20px; }
          p { margin: 0 0 14px; color: #566170; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 6px; border: 1px solid #cbd2dc; text-align: left; }
          th { background: #e8eef6; font-size: 9px; }
          tr { break-inside: avoid; }
          @media screen { body { margin: 24px; } }
        </style>
      </head>
      <body>
        <h1>Historical ${name} Data Logs</h1>
        <p>${getFilteredHeatLocationRows().length} readings · ${escapeHtml(selectedHeatIndexDateRangeLabel())} · Exported ${escapeHtml(new Date().toLocaleString())}</p>
        <table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table>
        <script>window.addEventListener('load', () => window.print());</script>
      </body>
      </html>`);
    printWindow.document.close();
  }

  function renderHeatIndexPage(deployedNodes, heatReadings) {
    const page = document.getElementById('heat-index-page');
    if (!page) return;
    currentHeatIndexNodes = deployedNodes;
    currentHeatIndexReadings = heatReadings;
    const currentReadingsByNode = new Map(heatReadings.map((reading) => [reading.node.key, reading]));

    const body = document.getElementById('hi-node-table-body');
    if (!body) return;
    const rows = deployedNodes.flatMap((node) => {
      const current = currentReadingsByNode.get(node.key);
      const historicalReadings = getDateAwareReadings(node)
        .flatMap((reading) => {
          const timestamp = sensorTimestamp(reading.createdAt);
          const value = metricValue(reading);
          const isCurrentReading = Math.abs(timestamp - sensorTimestamp(node.lastSeen)) < 30_000;
          return Number.isFinite(timestamp) && value !== null
            ? [{
                timestamp,
                heatIndex: selectedMetric === 'heat-index' ? value : null,
                temperature: parseReading(reading.temperature) ??
                  (isCurrentReading ? parseReading(node.temperature) : null),
                pressure: parseReading(reading.pressure) ??
                  (isCurrentReading ? parseReading(node.pressure) : null),
                humidity: parseReading(reading.humidity) ??
                  (isCurrentReading ? parseReading(node.humidity) : null)
              }]
            : [];
        });
      if (current && !historicalReadings.some((reading) =>
        Math.abs(reading.timestamp - sensorTimestamp(node.lastSeen)) < 30_000)) {
        const timestamp = sensorTimestamp(node.lastSeen);
        const { start, end } = heatIndexDateRange(heatIndexStartDate, heatIndexEndDate);
        if (Number.isFinite(timestamp) && timestamp >= start && timestamp <= end) {
          historicalReadings.push({
            timestamp,
            heatIndex: current.heatIndex,
            temperature: current.temperature,
            humidity: current.humidity,
            pressure: current.pressure
          });
        }
      }
      return historicalReadings.map((reading) => ({ node, reading }));
    }).sort((first, second) => second.reading.timestamp - first.reading.timestamp);

    heatLocationRows = rows.map(({ node, reading }) => {
      const row = document.createElement('tr');
      const timestampCell = document.createElement('td');
      timestampCell.className = 'hi-node-timestamp';
      timestampCell.textContent = formatHistoryTimestamp(reading.timestamp);
      const nodeCell = document.createElement('td');
      nodeCell.className = 'hi-node-id';
      nodeCell.textContent = node.id || node.key;
      const locationCell = document.createElement('td');
      locationCell.className = 'hi-node-location';
      locationCell.textContent = node.location || node.key;
      const value = metricValue(reading);
      const level = metricLevel(value);
      row.dataset.riskStatus = level.key;
      const metricCell = document.createElement('td');
      metricCell.className = 'hi-node-reading';
      const metricValueBadge = document.createElement('span');
      metricValueBadge.className = `hi-node-value hi-node-value--${selectedMetric}`;
      metricValueBadge.textContent = formatReading(value, metricUnit());
      metricCell.appendChild(metricValueBadge);
      const secondaryCell = document.createElement('td');
      const secondaryMetric = selectedMetric === 'temperature' ? 'humidity' : 'temperature';
      secondaryCell.className = 'hi-node-reading';
      const secondaryValue = document.createElement('span');
      secondaryValue.className = `hi-node-value hi-node-value--${secondaryMetric}`;
      secondaryValue.textContent = formatReading(reading[secondaryMetric], secondaryMetric === 'temperature' ? '°C' : '%');
      secondaryCell.appendChild(secondaryValue);
      const tertiaryCell = document.createElement('td');
      const tertiaryMetric = selectedMetric === 'heat-index' || selectedMetric === 'pressure' ? 'humidity' : 'pressure';
      tertiaryCell.className = 'hi-node-reading';
      const tertiaryValue = document.createElement('span');
      tertiaryValue.className = `hi-node-value hi-node-value--${tertiaryMetric}`;
      tertiaryValue.textContent = formatReading(reading[tertiaryMetric], tertiaryMetric === 'pressure' ? ' hPa' : '%');
      tertiaryCell.appendChild(tertiaryValue);
      const levelCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `hi-level-badge hi-level-badge--${level.key}`;
      badge.textContent = level.label;
      levelCell.appendChild(badge);
      row.append(timestampCell, nodeCell, locationCell, metricCell, secondaryCell, tertiaryCell, levelCell);
      return row;
    });
    if (heatLocationPagination) {
      const currentPage = heatLocationPagination.getPage();
      const filteredCount = getFilteredHeatLocationRows().length;
      heatLocationPagination.setTotal(filteredCount);
      const lastPage = Math.max(1, Math.ceil(filteredCount / heatLocationPageSize));
      heatLocationPagination.setPage(Math.min(currentPage, lastPage));
    } else {
      renderHeatLocationPage(1, heatLocationPageSize);
    }

    // Render the trend chart for the risk panel
    renderHeatTrendChart(deployedNodes, heatReadings);
  }

  // ── Heat Index Trend Chart ────────────────────────────────────
  // Per-node accent colours (cycles if more than 6 nodes)
  const TREND_COLORS = [accentLight, '#22d3ee', '#fb923c', '#34d399', '#f472b6', '#facc15'];

  // Connect readings directly so smoothing cannot overshoot between sensor samples.
  function trendPath(points) {
    if (points.length < 2) return '';
    let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
    }
    return d;
  }

  function renderHeatTrendChart(nodes, heatReadings) {
    const wrap    = document.getElementById('hi-trend-chart-wrap');
    const area    = document.getElementById('hi-trend-chart-area');
    const legend  = document.getElementById('hi-trend-legend');
    const empty   = document.getElementById('hi-trend-empty');
    const mode    = document.getElementById('hi-trend-mode');
    if (!wrap || !area || !legend) return;
    currentHeatTrendNodes = nodes;
    currentHeatTrendReadings = heatReadings;

    // Remove previous SVG if any
    area.querySelectorAll('svg.hi-trend-svg').forEach((el) => el.remove());

    if (!nodes.length) {
      if (empty) empty.hidden = false;
      if (empty) empty.textContent = 'Waiting for sensor data…';
      legend.replaceChildren();
      if (mode) mode.textContent = 'No reporting node data';
      return;
    }
    if (empty) empty.hidden = true;

    // ── Dimensions ──────────────────────────────────────────────
    const W        = Math.max(320, Math.round(area.clientWidth));
    const H        = Math.max(220, Math.round(area.clientHeight));
    const PAD_L    = 58;
    const PAD_R    = 16;
    const PAD_T    = 16;
    const PAD_B    = 64;    // bottom — keeps the time ticks clear of the axis title
    const plotW    = W - PAD_L - PAD_R;
    const plotH    = H - PAD_T - PAD_B;

    const ns = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs = {}) => {
      const node = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
      return node;
    };

    // ── Build timestamped per-node series for the selected range ─
    const { start: rangeStart, end: rangeEnd } =
      heatIndexDateRange(heatIndexStartDate, heatIndexEndDate);
    const includesMultipleDates = heatIndexStartDate !== heatIndexEndDate;
    const formatTime = (timestamp) => new Intl.DateTimeFormat('en-PH', includesMultipleDates ? {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Manila'
    } : {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Manila'
    }).format(new Date(timestamp));
    const currentReadingsByNode = new Map(heatReadings.map((reading) => [reading.node.key, reading]));
    const series = nodes.flatMap((node, colorIndex) => {
      const sourceReadings = getDateAwareReadings(node);
      const recent = Array.isArray(sourceReadings) ? [...sourceReadings] : [];
      const points = recent
        .flatMap((reading) => {
          const value = metricValue(reading);
          const timestamp = sensorTimestamp(reading.createdAt);
          return Number.isFinite(value) && Number.isFinite(timestamp) && timestamp >= rangeStart && timestamp <= rangeEnd
            ? [{ value, timestamp, label: formatTime(timestamp) }]
            : [];
        });
      const current = currentReadingsByNode.get(node.key);
      const currentTimestamp = sensorTimestamp(node.lastSeen);
      if (current && currentTimestamp >= rangeStart && currentTimestamp <= rangeEnd &&
          !points.some((point) => Math.abs(point.timestamp - currentTimestamp) < 30_000)) {
        const value = metricValue(current);
        if (Number.isFinite(value)) {
          points.push({
            value,
            timestamp: currentTimestamp,
            label: formatTime(currentTimestamp)
          });
        }
      }
      points.sort((first, second) => first.timestamp - second.timestamp);
      if (!points.length) return [];
      if (points.length > 120) {
        const sampled = [];
        for (let index = 0; index < 119; index += 1) {
          sampled.push(points[Math.floor(index * (points.length - 1) / 119)]);
        }
        sampled.push(points[points.length - 1]);
        points.splice(0, points.length, ...sampled);
      }

      return {
        key: String(node.key || node.id || node.location || colorIndex),
        label: node.location || node.id || node.key,
        colorIndex,
        color: TREND_COLORS[colorIndex % TREND_COLORS.length],
        points
      };
    }).filter((item) => item.points.length);

    const availableKeys = new Set([...nodes.map((node) =>
      String(node.key || node.id || node.location)), 'average']);
    hiddenHeatTrendSeries.forEach((key) => {
      if (!availableKeys.has(key)) hiddenHeatTrendSeries.delete(key);
    });
    if (!series.length) {
      legend.replaceChildren();
      if (mode) mode.textContent =
        `No readings from ${selectedHeatIndexDateRangeLabel()}`;
      if (empty) {
        empty.textContent = `No sensor readings from ${selectedHeatIndexDateRangeLabel()}.`;
        empty.hidden = false;
      }
      return;
    }
    const longestSeries = series.reduce((longest, item) =>
      item.points.length > longest.points.length ? item : longest, series[0]);
    const averageSeries = {
      key: 'average',
      label: `${metricName()} Average`,
      colorIndex: series.length,
      color: isTemperaturePage ? '#f87171' : isHumidityPage ? '#22d3ee' : isPressurePage ? '#a78bfa' : '#facc15',
      points: longestSeries.points.flatMap((point) => {
        const alignedValues = series
          .flatMap((item) => {
            const nearest = item.points.reduce((best, candidate) =>
              !best || Math.abs(candidate.timestamp - point.timestamp) < Math.abs(best.timestamp - point.timestamp)
                ? candidate : best, null);
            return nearest && Math.abs(nearest.timestamp - point.timestamp) <= 5 * 60 * 1000
              ? [nearest.value]
              : [];
          });
        if (!alignedValues.length) return [];
        const average = alignedValues.reduce((sum, value) => sum + value, 0) / alignedValues.length;
        return [{ value: average, timestamp: point.timestamp, label: point.label }];
      })
    };
    const allSeries = [...series, averageSeries];
    const visibleSeries = allSeries.filter((item) => !hiddenHeatTrendSeries.has(item.key));
    if (mode) {
      mode.textContent = `${selectedHeatIndexDateRangeLabel()} · ${visibleSeries.length} of ${allSeries.length} trend lines shown`;
    }

    const createLegendButton = (label, key, color, container) => {
      const isVisible = !hiddenHeatTrendSeries.has(key);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'hi-trend-legend-item hi-trend-legend-button';
      item.dataset.nodeKey = key;
      item.setAttribute('aria-pressed', String(isVisible));
      item.setAttribute('aria-label', `${isVisible ? 'Hide' : 'Show'} ${label} trend`);
      item.title = `${isVisible ? 'Click to hide' : 'Click to show'} the ${label} trend`;
      item.classList.toggle('is-selected', isVisible);
      item.classList.toggle('is-hidden', !isVisible);
      const dot = document.createElement('span');
      dot.className = 'hi-trend-legend-dot';
      dot.style.background = color;
      dot.style.boxShadow = `0 0 6px ${color}`;
      const name = document.createElement('span');
      name.textContent = label;
      item.append(dot, name);
      container.appendChild(item);
    };

    legend.replaceChildren();
    const createFilterGroup = (title) => {
      const group = document.createElement('div');
      group.className = 'hi-trend-filter-group';
      const heading = document.createElement('span');
      heading.className = 'hi-trend-filter-group-title';
      heading.textContent = title;
      const options = document.createElement('div');
      options.className = 'hi-trend-filter-options';
      group.append(heading, options);
      legend.appendChild(group);
      return { group, options };
    };
    createLegendButton(averageSeries.label, averageSeries.key, averageSeries.color, legend);
    const nodesGroup = createFilterGroup('Reporting Nodes');
    nodesGroup.group.classList.add('hi-trend-filter-group--nodes');
    nodesGroup.options.classList.add('hi-trend-filter-options--scrollable');
    series.forEach((item) => createLegendButton(item.label, item.key, item.color, nodesGroup.options));

    if (!visibleSeries.length) {
      if (empty) {
        empty.textContent = 'All trend lines are hidden. Select a series to show it.';
        empty.hidden = false;
      }
      return;
    }
    if (empty) empty.textContent = 'Waiting for sensor data…';

    // ── Y-axis range ─────────────────────────────────────────────
    const allValues  = visibleSeries.flatMap((s) => s.points.map((p) => p.value));
    const CAUTION    = 32;
    if (!isNonHeatMetricPage) allValues.push(CAUTION);
    const rawMin = Math.min(...allValues);
    const rawMax = Math.max(...allValues);
    const pad    = (rawMax - rawMin) * 0.15 || 2;
    const yMin   = Math.floor(rawMin - pad);
    const yMax   = Math.ceil(rawMax  + pad);
    const yRange = yMax - yMin;

    const toY = (v) => PAD_T + plotH - ((v - yMin) / yRange) * plotH;

    // ── X axis: map timestamps to the selected time range ────────
    const toX = (timestamp) => PAD_L + ((timestamp - rangeStart) / (rangeEnd - rangeStart)) * plotW;

    // ── SVG skeleton ─────────────────────────────────────────────
    const svg = el('svg', {
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: 'none',
      class: 'hi-trend-svg',
      role: 'img',
      'aria-label': `${metricName()} Trend with selectable node and average series`
    });

    // Defs: per-series gradients
    const defs = el('defs');
    visibleSeries.forEach((s) => {
      const color = s.color;
      const grad  = el('linearGradient', { id: `hi-grad-${s.colorIndex}`, x1: '0', y1: '0', x2: '0', y2: '1' });
      const s1    = el('stop', { offset: '0%',   'stop-color': color, 'stop-opacity': '0.18' });
      const s2    = el('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' });
      grad.append(s1, s2);
      defs.appendChild(grad);
    });
    svg.appendChild(defs);

    // Plot background clip
    const clip = el('clipPath', { id: 'hi-plot-clip' });
    clip.appendChild(el('rect', { x: PAD_L, y: PAD_T, width: plotW, height: plotH }));
    defs.appendChild(clip);

    // ── Grid lines + Y labels ────────────────────────────────────
    const yStep   = yRange <= 8 ? 1 : yRange <= 16 ? 2 : 4;
    const yStart  = Math.ceil(yMin / yStep) * yStep;
    for (let v = yStart; v <= yMax; v += yStep) {
      const y = toY(v);
      // gridline
      svg.appendChild(el('line', {
        x1: PAD_L, y1: y, x2: PAD_L + plotW, y2: y,
        stroke: 'rgba(255,255,255,0.07)', 'stroke-width': '1'
      }));
      const label = el('text', {
        x: PAD_L - 6, y: y + 4,
        'text-anchor': 'end',
        class: 'hi-trend-axis-label'
      });
      label.textContent = v;
      svg.appendChild(label);
    }

    const yTitle = el('text', {
      x: 10, y: H / 2,
      'text-anchor': 'middle',
      transform: `rotate(-90, 10, ${H / 2})`,
      class: 'hi-trend-axis-title'
    });
    yTitle.textContent = `${metricName()} (${metricUnit().trim()})`;
    svg.appendChild(yTitle);

    // ── Caution threshold line at 32 °C ──────────────────────────
    if (!isNonHeatMetricPage && CAUTION >= yMin && CAUTION <= yMax) {
      const cy = toY(CAUTION);
      svg.appendChild(el('line', {
        x1: PAD_L, y1: cy, x2: PAD_L + plotW, y2: cy,
        stroke: '#f87171', 'stroke-width': '1.5',
        'stroke-dasharray': '6 4', opacity: '0.7',
        'clip-path': 'url(#hi-plot-clip)'
      }));
    }

    // ── X axis labels ────────────────────────────────────────────
    for (let tick = 0; tick <= 4; tick += 1) {
      const timestamp = rangeStart + ((rangeEnd - rangeStart) * tick) / 4;
      const x = toX(timestamp);
      const t = el('text', {
        x: x + (tick === 0 ? 4 : tick === 4 ? -4 : 0),
        y: PAD_T + plotH + 18,
        'text-anchor': tick === 0 ? 'start' : tick === 4 ? 'end' : 'middle',
        class: 'hi-trend-axis-label'
      });
      t.textContent = formatTime(timestamp);
      svg.appendChild(t);
      // Tick mark
      svg.appendChild(el('line', {
        x1: x, y1: PAD_T + plotH, x2: x, y2: PAD_T + plotH + 4,
        stroke: 'rgba(255,255,255,0.2)', 'stroke-width': '1'
      }));
    }

    // X axis title
    const xTitle = el('text', {
      x: PAD_L + plotW / 2, y: H - 3,
      'text-anchor': 'middle',
      class: 'hi-trend-axis-title'
    });
    xTitle.textContent = 'Time';
    svg.appendChild(xTitle);

    // ── Per-node series lines + fills ────────────────────────────
    visibleSeries.forEach((s) => {
      const color  = s.color;
      const pts    = s.points.map((p) => ({
        x: toX(p.timestamp),
        y: toY(p.value)
      }));

      const pathD = trendPath(pts);
      const lastPt = pts[pts.length - 1];
      if (pathD) {
        const firstPt = pts[0];
        const fillD = `${pathD} L${lastPt.x.toFixed(1)},${PAD_T + plotH} L${firstPt.x.toFixed(1)},${PAD_T + plotH} Z`;
        svg.appendChild(el('path', {
          d: fillD, fill: `url(#hi-grad-${s.colorIndex})`,
          stroke: 'none', 'clip-path': 'url(#hi-plot-clip)'
        }));

        const latestPoint = s.points[s.points.length - 1];
        svg.appendChild(el('path', {
          d: pathD,
          class: 'hi-trend-series-hit',
          'data-tooltip-title': s.label,
          'data-tooltip-detail': `Latest: ${latestPoint.value.toFixed(1)}${metricUnit()} at ${latestPoint.label}`,
          'clip-path': 'url(#hi-plot-clip)'
        }));

        svg.appendChild(el('path', {
          d: pathD, fill: 'none',
          stroke: color, 'stroke-width': '2.2',
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          'pointer-events': 'none',
          'clip-path': 'url(#hi-plot-clip)'
        }));
      }

      // End-point dot
      svg.appendChild(el('circle', {
        cx: lastPt.x.toFixed(1), cy: lastPt.y.toFixed(1),
        r: '3.5', fill: color,
        stroke: 'rgba(10,7,24,0.9)', 'stroke-width': '1.5',
        'pointer-events': 'none',
        'clip-path': 'url(#hi-plot-clip)'
      }));

      s.points.forEach((point, index) => {
        const pointPosition = pts[index];
        svg.appendChild(el('circle', {
          cx: pointPosition.x.toFixed(1),
          cy: pointPosition.y.toFixed(1),
          r: '8',
          class: 'hi-trend-point-hit',
          'data-tooltip-title': s.label,
          'data-tooltip-detail': `${point.value.toFixed(1)}${metricUnit()} at ${point.label}`,
          'clip-path': 'url(#hi-plot-clip)'
        }));
      });
    });

    area.appendChild(svg);

  }

  function initHeatIndexTabs() {
    const tabs = document.querySelector('.hi-tab-bar');
    const riskTab = document.getElementById('hi-tab-risk');
    const locationsTab = document.getElementById('hi-tab-locations');
    const riskPanel = document.getElementById('hi-panel-risk');
    const locationsPanel = document.getElementById('hi-panel-locations');
    if (!tabs || !riskTab || !locationsTab || !riskPanel || !locationsPanel) return;
    const controlCard = tabs.closest('.hi-tab-control-card');

    const setActiveTab = (showLocations) => {
      tabs.classList.toggle('show-locations', showLocations);
      controlCard?.classList.toggle('show-locations', showLocations);
      riskTab.classList.toggle('active', !showLocations);
      locationsTab.classList.toggle('active', showLocations);
      riskTab.setAttribute('aria-pressed', String(!showLocations));
      locationsTab.setAttribute('aria-pressed', String(showLocations));
      riskPanel.hidden = showLocations;
      locationsPanel.hidden = !showLocations;
      const view = showLocations ? 'locations' : 'risk';
      sessionStorage.setItem(HEAT_INDEX_VIEW_STORAGE_KEY, view);
      const url = new URL(window.location.href);
      url.searchParams.set('view', view);
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    };

    riskTab.addEventListener('click', () => setActiveTab(false));
    locationsTab.addEventListener('click', () => setActiveTab(true));
    const historySearch = document.getElementById('hi-history-search');
    historySearch?.addEventListener('input', () => {
      heatLocationSearchQuery = historySearch.value;
      if (heatLocationPagination) {
        heatLocationPagination.setTotal(getFilteredHeatLocationRows().length);
      }
      renderHeatLocationPage(1, heatLocationPageSize);
    });
    const historyStatusFilter = document.getElementById('hi-history-status-filter');
    historyStatusFilter?.addEventListener('change', () => {
      heatLocationStatusFilter = historyStatusFilter.value;
      if (heatLocationPagination) {
        heatLocationPagination.setTotal(getFilteredHeatLocationRows().length);
      }
      renderHeatLocationPage(1, heatLocationPageSize);
    });
    const historyResetButton = document.getElementById('hi-history-reset');
    const historyExportButton = document.getElementById('hi-history-export');
    const historyExportMenu = document.getElementById('hi-history-export-options');
    historyExportButton?.addEventListener('click', () => {
      const isExpanded = historyExportButton.getAttribute('aria-expanded') === 'true';
      historyExportButton.setAttribute('aria-expanded', String(!isExpanded));
      if (historyExportMenu) historyExportMenu.hidden = isExpanded;
    });
    historyExportMenu?.addEventListener('click', (event) => {
      const item = event.target.closest('[data-history-export-format]');
      if (!item) return;

      historyExportMenu.hidden = true;
      historyExportButton?.setAttribute('aria-expanded', 'false');
      try {
        if (item.dataset.historyExportFormat === 'csv') exportHeatLocationRows();
        else if (item.dataset.historyExportFormat === 'pdf') exportHeatLocationPdf();
      } catch (error) {
        console.error(`Could not export Heat Index history as ${item.dataset.historyExportFormat}.`, error);
        window.OrchidToast.show({
          variant: 'error',
          title: 'History export failed',
          message: error.message
        });
      }
    });
    document.addEventListener('click', (event) => {
      if (!historyExportMenu?.contains(event.target) && !historyExportButton?.contains(event.target)) {
        if (historyExportMenu) historyExportMenu.hidden = true;
        historyExportButton?.setAttribute('aria-expanded', 'false');
      }
    });
    const locationPaginationMount = document.getElementById('hi-location-pagination');
    if (locationPaginationMount) {
      window.OrchidComponentLoader.initPagination(locationPaginationMount, {
        total: heatLocationRows.length,
        pageSize: heatLocationPageSize,
        page: 1,
        onChange: renderHeatLocationPage
      }).then((pagination) => {
        heatLocationPagination = pagination;
        heatLocationPagination.setTotal(getFilteredHeatLocationRows().length);
        renderHeatLocationPage(1, heatLocationPageSize);
      }).catch((error) => {
        console.error('Could not initialize Heat Index location pagination.', error);
        window.OrchidToast.show({
          variant: 'error',
          title: 'Location pagination unavailable',
          message: error.message
        });
      });
    }
    const dateFilterMount = document.getElementById('hi-date-filter-mount');
    if (dateFilterMount) {
      window.OrchidComponentLoader.initDateRangeFilter(dateFilterMount, {
        initialStartDate: heatIndexStartDate,
        initialEndDate: heatIndexEndDate,
        onChange: async (startDate, endDate) => {
          const dateRangeChanged =
            startDate !== heatIndexStartDate || endDate !== heatIndexEndDate;
          heatIndexStartDate = startDate;
          heatIndexEndDate = endDate;
          updateTelemetryHistoryHeading();
          const url = new URL(window.location.href);
          url.searchParams.set('startDate', startDate);
          url.searchParams.set('endDate', endDate);
          url.searchParams.delete('date');
          url.searchParams.delete('interval');
          window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
          if (dateRangeChanged) {
            try {
              const loaded = await loadNodesFromDatabase(startDate, endDate);
              if (loaded) {
                renderFleetSummary();
                renderSensorMarkers();
              }
            } catch (error) {
              console.error(`Could not load ORCHID sensor history from ${startDate} to ${endDate}.`, error);
              window.OrchidToast.show({
                variant: 'error',
                title: 'Could not load selected date range',
                message: error.message
              });
            }
            return;
          }
          renderHeatIndexPage(currentHeatIndexNodes, currentHeatIndexReadings);
        }
      }).then((dateFilter) => {
        historyResetButton?.addEventListener('click', () => {
          heatLocationSearchQuery = '';
          heatLocationStatusFilter = 'all';
          if (historySearch) historySearch.value = '';
          if (historyStatusFilter) historyStatusFilter.value = 'all';
          heatLocationPagination?.setTotal(getFilteredHeatLocationRows().length);
          const today = manilaDateString(new Date());
          dateFilter.setRange(today, today);
          renderHeatLocationPage(1, heatLocationPageSize);
        });
      }).catch((error) => {
        console.error(`Could not initialize the ${metricName()} date range filter.`, error);
        window.OrchidToast.show({
          variant: 'error',
          title: 'Date filter unavailable',
          message: error.message
        });
      });
    }
    const trendLegend = document.getElementById('hi-trend-legend');
    if (trendLegend) {
      trendLegend.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-node-key]');
        if (!button || !trendLegend.contains(button)) return;
        const nodeKey = button.dataset.nodeKey;
        const page = document.getElementById('heat-index-page');
        const pageScrollTop = page?.scrollTop ?? 0;
        const nodeFilters = button.closest('.hi-trend-filter-options--scrollable');
        const filterScrollTop = nodeFilters?.scrollTop ?? 0;
        if (hiddenHeatTrendSeries.has(nodeKey)) hiddenHeatTrendSeries.delete(nodeKey);
        else hiddenHeatTrendSeries.add(nodeKey);
        renderHeatTrendChart(currentHeatTrendNodes, currentHeatTrendReadings);
        const updatedNodeFilters = trendLegend.querySelector('.hi-trend-filter-options--scrollable');
        if (updatedNodeFilters) updatedNodeFilters.scrollTop = filterScrollTop;
        if (page) page.scrollTop = pageScrollTop;
        trendLegend.querySelector(`button[data-node-key="${CSS.escape(nodeKey)}"]`)
          ?.focus({ preventScroll: true });
      });
    }
    const trendArea = document.getElementById('hi-trend-chart-area');
    const trendTooltip = document.getElementById('hi-trend-tooltip');
    if (trendArea && 'ResizeObserver' in window) {
      let previousWidth = 0;
      let previousHeight = 0;
      const trendChartResizeObserver = new ResizeObserver(([entry]) => {
        const width = Math.round(entry.contentRect.width);
        const height = Math.round(entry.contentRect.height);
        if (!width || !height || (width === previousWidth && height === previousHeight)) return;
        previousWidth = width;
        previousHeight = height;
        requestAnimationFrame(() => {
          if (currentHeatTrendNodes.length) {
            renderHeatTrendChart(currentHeatTrendNodes, currentHeatTrendReadings);
          }
        });
      });
      trendChartResizeObserver.observe(trendArea);
    }
    if (trendArea && trendTooltip) {
      const tooltipTitle = trendTooltip.querySelector('.hi-trend-tooltip-title');
      const tooltipDetail = trendTooltip.querySelector('.hi-trend-tooltip-detail');
      const showTrendTooltip = (target, clientX, clientY) => {
        const targetWithTooltip = target.closest('[data-tooltip-title]');
        if (!targetWithTooltip || !trendArea.contains(targetWithTooltip)) {
          trendTooltip.hidden = true;
          return;
        }
        const bounds = trendArea.getBoundingClientRect();
        if (tooltipTitle) tooltipTitle.textContent = targetWithTooltip.getAttribute('data-tooltip-title');
        if (tooltipDetail) tooltipDetail.textContent = targetWithTooltip.getAttribute('data-tooltip-detail');
        trendTooltip.hidden = false;
        const left = Math.min(
          Math.max(clientX - bounds.left + 12, 6),
          bounds.width - trendTooltip.offsetWidth - 6
        );
        const top = Math.min(
          Math.max(clientY - bounds.top + 12, 6),
          bounds.height - trendTooltip.offsetHeight - 6
        );
        trendTooltip.style.left = `${left}px`;
        trendTooltip.style.top = `${top}px`;
      };
      trendArea.addEventListener('pointermove', (event) => {
        showTrendTooltip(event.target, event.clientX, event.clientY);
      });
      trendArea.addEventListener('pointerleave', () => {
        trendTooltip.hidden = true;
      });
      trendArea.addEventListener('focusin', (event) => {
        const target = event.target.closest('[data-tooltip-title]');
        if (!target) return;
        const bounds = target.getBoundingClientRect();
        showTrendTooltip(target, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      });
      trendArea.addEventListener('focusout', () => {
        trendTooltip.hidden = true;
      });
    }
    const requestedView = new URLSearchParams(window.location.search).get('view');
    const savedView = sessionStorage.getItem(HEAT_INDEX_VIEW_STORAGE_KEY);
    setActiveTab(requestedView === 'locations' || (requestedView !== 'risk' && savedView === 'locations'));
  }

  function renderHeatAnalytics(heatReadings) {
    const container = document.getElementById('fleet-heat-analytics');
    if (!container) return;
    container.replaceChildren();
    if (!heatReadings.length) {
      container.removeAttribute('aria-label');
      const emptyState = document.createElement('div');
      emptyState.className = 'dashboard-empty-state';
      emptyState.textContent = 'No online deployed-node heat-index readings available.';
      container.appendChild(emptyState);
      return;
    }

    const topReadings = [...heatReadings]
      .sort((first, second) => second.heatIndex - first.heatIndex)
      .slice(0, 4);
    topReadings.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'heat-cluster-row';
      const icon = document.createElement('span');
      icon.className = 'heat-weather-mini-icon';
      icon.setAttribute('aria-hidden', 'true');
      const sun = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      sun.setAttribute('viewBox', '0 0 24 24');
      sun.setAttribute('fill', 'none');
      sun.setAttribute('stroke', 'currentColor');
      sun.setAttribute('stroke-width', '1.8');
      sun.setAttribute('stroke-linecap', 'round');
      sun.setAttribute('stroke-linejoin', 'round');
      const sunBody = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      sunBody.setAttribute('cx', '12');
      sunBody.setAttribute('cy', '12');
      sunBody.setAttribute('r', '3.5');
      const sunRays = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      sunRays.setAttribute('d', 'M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42m0-14.14-1.42 1.42m-11.3 11.3-1.42 1.42');
      sun.append(sunBody, sunRays);
      icon.appendChild(sun);
      const name = document.createElement('span');
      name.className = 'heat-loc-name';
      name.textContent = item.node.location || item.node.key || 'Unknown node';
      const heatValue = document.createElement('span');
      heatValue.className = 'heat-loc-temp';
      heatValue.textContent = formatReading(item.heatIndex, '°C');
      row.append(icon, name, heatValue);
      container.appendChild(row);
    });
    container.setAttribute('aria-label', `Top ${topReadings.length} heat-index locations from ${heatReadings.length} online deployed nodes`);
  }

  function renderFleetSummary() {
    initNodeMetrics();
    const deployedNodes = SENSOR_NODES.filter(isDeployedNode);
    const onlineDeployedNodes = deployedNodes.filter(isOnlineNode);
    const values = onlineDeployedNodes.map((node) => {
      const rawTemperature = parseReading(node.temperature ?? node.temp);
      const rawHumidity = parseReading(node.humidity);
      const pressure = parseReading(node.pressure);
      const temperature = rawTemperature !== null && rawTemperature >= -50 && rawTemperature <= 70
        ? rawTemperature : null;
      const humidity = rawHumidity !== null && rawHumidity >= 0 && rawHumidity <= 100
        ? rawHumidity : null;
      return {
        node,
        temperature,
        humidity,
        pressure: pressure !== null && pressure >= 300 && pressure <= 1200 ? pressure : null,
        heatIndex: heatIndexCelsius(node, temperature, humidity)
      };
    });
    const heatReadings = values.filter((reading) => reading.heatIndex !== null &&
      reading.heatIndex >= -50 && reading.heatIndex <= 80);
    const averageTemperature = average(values.map((reading) => reading.temperature).filter((value) => value !== null));
    const averageHumidity = average(values.map((reading) => reading.humidity).filter((value) => value !== null));
    const averagePressure = average(values.map((reading) => reading.pressure).filter((value) => value !== null));
    const averageHeat = average(heatReadings.map((reading) => reading.heatIndex));
    const hottest = heatReadings.reduce((current, reading) =>
      !current || reading.heatIndex > current.heatIndex ? reading : current, null);
    const temperatureReadings = values.filter((reading) =>
      reading.temperature !== null && reading.temperature >= -50 && reading.temperature <= 70);
    const humidityReadings = values.filter((reading) =>
      reading.humidity !== null && reading.humidity >= 0 && reading.humidity <= 100);
    const pressureReadings = values.filter((reading) =>
      reading.pressure !== null && reading.pressure >= 300 && reading.pressure <= 1200);
    const metricReadings = isTemperaturePage ? temperatureReadings
      : isHumidityPage ? humidityReadings
        : isPressurePage ? pressureReadings : heatReadings;
    const setText = (id, text) => {
      const element = document.getElementById(id);
      if (element) element.textContent = text;
    };
    setText('fleet-average-temperature', formatReading(averageTemperature, '°C'));
    setText('fleet-average-heat-index', formatReading(averageHeat, '°C'));
    setText('fleet-analytics-temperature', formatReading(averageTemperature, '°C'));
    setText('fleet-analytics-humidity', formatReading(averageHumidity, '%'));
    setText('fleet-analytics-pressure', formatReading(averagePressure, ' hPa'));

    updateChart('temperature', averageTemperature, '°C',   'fleet-analytics-temperature-sub', deployedNodes);
    updateChart('humidity',    averageHumidity,    '%',    'fleet-analytics-humidity-sub',    deployedNodes);
    updateChart('pressure',    averagePressure,    ' hPa', 'fleet-analytics-pressure-sub',    deployedNodes);

    const icon = document.getElementById('fleet-heat-icon');
    const marker = document.getElementById('fleet-heat-marker');
    const summary = document.getElementById('fleet-heat-summary');
    if (averageHeat !== null) {
      const level = heatLevel(averageHeat);
      if (icon) icon.dataset.level = level.key;
      if (marker) {
        marker.dataset.visible = 'true';
        marker.style.left = `${Math.max(0, Math.min(100, averageHeat / 60 * 100))}%`;
      }
      if (summary) {
        summary.textContent = `${level.label}.`;
      }
    } else {
      if (icon) icon.dataset.level = 'no-data';
      if (marker) marker.dataset.visible = 'false';
      if (summary) summary.textContent = 'Waiting for sensor data.';
    }

    renderHeatAnalytics(heatReadings);
    renderHeatIndexPage(deployedNodes, metricReadings);

    const clothing = document.getElementById('fleet-clothing-advisory');
    const activity = document.getElementById('fleet-activity-advisory');
    if (hottest) {
      const worstLevel = heatLevel(hottest.heatIndex);
      const clothingAdvice = {
        safe: 'Light, breathable clothing is suitable; keep drinking water available.',
        caution: 'Wear lightweight, loose-fitting clothing and take water with you.',
        'extreme-caution': 'Wear lightweight clothing and take frequent breaks in a cool or shaded place.',
        danger: 'Wear lightweight clothing and use a cool, shaded place; avoid heat exposure where possible.',
        'extreme-danger': 'Stay in a cool, shaded or air-conditioned place and follow local health guidance.'
      }[worstLevel.key];
      const activityAdvice = {
        safe: 'Normal outdoor activity is generally suitable; stay hydrated.',
        caution: 'Take regular water breaks during outdoor activity.',
        'extreme-caution': 'Limit strenuous outdoor activity and schedule frequent cool-down breaks.',
        danger: 'Avoid strenuous outdoor activity; move to a cool place and take frequent breaks.',
        'extreme-danger': 'Avoid outdoor activity and follow local heat-safety guidance.'
      }[worstLevel.key];
      if (clothing) clothing.textContent = clothingAdvice;
      if (activity) activity.textContent = activityAdvice;
    } else {
      if (clothing) clothing.textContent = 'Waiting for current readings.';
      if (activity) activity.textContent = 'Waiting for current readings.';
    }
  }

  function renderSensorMarkers() {
    if (!sensorLayers) return;
    sensorLayers.online.clearLayers();
    sensorLayers.offline.clearLayers();
    if (legendTotalElement) legendTotalElement.textContent = `${SENSOR_LOCATIONS.length} Sensor Nodes`;
    const mapHint = document.querySelector('.map-open-hint');
    if (mapHint) {
      mapHint.hidden = false;
      mapHint.textContent = SENSOR_LOCATIONS.length
        ? 'Tap a node to view its overview and actions.'
        : 'No sensor nodes have been placed on the map yet.';
    }
    SENSOR_LOCATIONS.forEach((sensor) => {
      const node = NODE_DATA[sensor.id];
      if (!node) return;
      const label = `${sensor.id.replace('node-', 'Node ')} | ${sensor.temperature}`;
      const markerNumber = sensor.id.match(/\d+$/)?.[0] || sensor.id;
      const isOffline = !isOnlineNode(node);
      const icon = window.L.divIcon({
        className: 'orchid-map-icon',
        html: `<span class="orchid-map-marker${isOffline ? ' orchid-map-marker--offline' : ''}${markerNumber.length > 2 ? ' orchid-map-marker--long-id' : ''}" aria-hidden="true"><span class="node-pin-dot"></span><span class="node-number">${markerNumber}</span></span>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
      const marker = window.L.marker([sensor.lat, sensor.lng], {
        icon,
        draggable: false,
        title: `${label} — ${sensor.location}`,
        alt: `${label}, ${sensor.location}`
      });
      const tooltip = document.createElement('span');
      tooltip.textContent = `${label} · ${sensor.location}`;
      marker.bindTooltip(tooltip, {
        className: 'orchid-map-tooltip',
        direction: 'top',
        offset: [0, -16]
      });
      marker.on('click', () => openNodeModal(sensor.id));
      marker.addTo(isOffline ? sensorLayers.offline : sensorLayers.online);
    });
  }

  function initNodeMetrics() {
    const deployedNodes = SENSOR_NODES.filter(isDeployedNode);
    const onlineNodes = deployedNodes.filter(isOnlineNode).length;
    const offlineNodes = deployedNodes.length - onlineNodes;
    const metrics = [
      ['metric-total-nodes', deployedNodes.length],
      ['metric-active-nodes', onlineNodes],
      ['metric-inactive-nodes', offlineNodes]
    ];

    metrics.forEach(([id, value]) => {
      const number = document.querySelector(`#${id} .metric-number`);
      if (number) number.textContent = String(value);
    });
  }

  // Providers publish normalized node objects in detail.nodes when fresh readings arrive.
  window.addEventListener('orchid:sensor-data-updated', (event) => {
    const detail = event.detail;
    const nodes = Array.isArray(detail) ? detail : detail && detail.nodes;
    if (!Array.isArray(nodes) || nodes.some((node) =>
      !node || typeof node !== 'object' || typeof node.key !== 'string' || typeof node.status !== 'string')) {
      console.error('Invalid orchid:sensor-data-updated event; expected normalized nodes with key and status fields.');
      return;
    }

    SENSOR_NODES = nodes;
    indexSensorNodes();
    if (dashboardReady) {
      renderFleetSummary();
      renderSensorMarkers();
    }
  });

  window.addEventListener('orchid:data-refresh', async () => {
    if (databaseRefreshInProgress) return;
    databaseRefreshInProgress = true;
    try {
      const historyStartDate = document.getElementById('heat-index-page') ? heatIndexStartDate : null;
      const historyEndDate = document.getElementById('heat-index-page') ? heatIndexEndDate : null;
      const loaded = await loadNodesFromDatabase(historyStartDate, historyEndDate);
      if (!loaded) return;
      const status = document.getElementById('map-data-status');
      if (status) status.hidden = true;
      const retryButton = document.getElementById('hi-retry-button');
      if (retryButton) retryButton.hidden = true;
      window.dispatchEvent(new CustomEvent('orchid:sensor-data-updated', { detail: { nodes: SENSOR_NODES } }));
    } catch (error) {
      console.error('Could not refresh nodes from the ORCHID database.', error);
      const mapStatus = document.getElementById('map-data-status');
      if (mapStatus) {
        mapStatus.textContent = error.message;
        mapStatus.dataset.state = 'error';
        mapStatus.hidden = false;
      }
      const retryButton = document.getElementById('hi-retry-button');
      if (retryButton) retryButton.hidden = false;
      window.OrchidToast.show({ variant: 'error', title: 'Sensor refresh failed', message: error.message });
    } finally {
      databaseRefreshInProgress = false;
    }
  });

  // ── Toast ────────────────────────────────────────────────────
  // ── Tooltips ─────────────────────────────────────────────────
  // Handled by OrchidComponentLoader.initAnalyticsTooltips() in components.js

  // ── Map interactions ─────────────────────────────────────────
  function initMapInteractions() {
    const mapCard  = document.getElementById('map-telemetry-card');
    const mapElement = document.getElementById('ormoc-map');
    const tileError = document.getElementById('map-tile-error');
    const legendTotal = document.getElementById('map-legend-total');

    if (!mapCard || !mapElement) return;
    if (legendTotal) {
      legendTotal.textContent = `${SENSOR_LOCATIONS.length} Sensor Nodes`;
    }
    if (!window.L) {
      console.error('Leaflet failed to load; the Ormoc City map could not be initialized.');
      if (tileError) {
        tileError.textContent = 'Map could not be initialized because the map library did not load.';
        tileError.classList.add('visible');
      }
      return;
    }

    const map = window.L.map(mapElement, {
      center: ORMOC_CENTER,
      zoom: ORMOC_ZOOM,
      minZoom: 10,
      maxZoom: 17,
      zoomControl: false,
      scrollWheelZoom: true,
      preferCanvas: true,
      maxBounds: [[10.82, 124.42], [11.22, 124.85]],
      maxBoundsViscosity: 1,
      attributionControl: true
    });

    // Compass first so it renders left of zoom in the flex row
    const CompassControl = window.L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() {
        const container = window.L.DomUtil.create('div', 'leaflet-bar leaflet-control orchid-compass-control');
        const btn = window.L.DomUtil.create('a', '', container);
        btn.href = '#';
        btn.title = 'Recenter map';
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', 'Recenter map to Ormoc City');
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/></svg>`;
        window.L.DomEvent.on(btn, 'click', (e) => {
          window.L.DomEvent.preventDefault(e);
          map.setView(ORMOC_CENTER, ORMOC_ZOOM);
          btn.classList.add('rotating');
          setTimeout(() => btn.classList.remove('rotating'), 600);
          window.OrchidToast.show({
            variant: 'info',
            title: 'Geospatial Center',
            message: 'Recentered to Ormoc City (11.0064°N, 124.6075°E)'
          });
        });
        window.L.DomEvent.disableClickPropagation(container);
        return container;
      }
    });
    window.L.control.zoom({ position: 'bottomright' }).addTo(map);
    new CompassControl().addTo(map);
    map.attributionControl.setPrefix('');    map.attributionControl.addAttribution(
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    );

    sensorLayers = {
      online: window.L.layerGroup().addTo(map),
      offline: window.L.layerGroup().addTo(map)
    };
    legendTotalElement = legendTotal;
    // Expose for dynamic marker addition
    window._orchidSensorLayers = sensorLayers;
    mapCard.querySelectorAll('.map-legend-switch[data-map-layer]').forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const layer = sensorLayers[toggle.dataset.mapLayer];
        if (!layer) return;
        const isVisible = toggle.getAttribute('aria-checked') === 'true';
        toggle.setAttribute('aria-checked', String(!isVisible));
        if (isVisible) {
          map.removeLayer(layer);
        } else {
          map.addLayer(layer);
        }
      });
    });

    if (!window.ORCHID_OFFLINE_MAP) {
      console.error('The bundled Ormoc offline map data failed to load.');
      if (tileError) {
        tileError.textContent = 'The offline map data could not be loaded.';
        tileError.classList.add('visible');
      }
      return;
    }

    const features = window.ORCHID_OFFLINE_MAP.features;
    const hasTag = (feature, key) => Boolean(feature.properties && feature.properties[key]);
    const areaFeatures = features.filter((feature) =>
      feature.geometry.type === 'Polygon' &&
      !hasTag(feature, 'building') &&
      (hasTag(feature, 'landuse') || hasTag(feature, 'leisure') ||
        feature.properties.natural === 'water' || feature.properties.waterway === 'riverbank')
    );
    const roadFeatures = features.filter((feature) =>
      feature.geometry.type === 'LineString' && hasTag(feature, 'highway')
    );
    const waterFeatures = features.filter((feature) =>
      feature.geometry.type === 'LineString' &&
      (hasTag(feature, 'waterway') || feature.properties.natural === 'coastline')
    );
    const railFeatures = features.filter((feature) =>
      feature.geometry.type === 'LineString' && hasTag(feature, 'railway')
    );
    const collection = (items) => ({ type: 'FeatureCollection', features: items });

    window.L.geoJSON(collection(areaFeatures), {
      style: (feature) => {
        const tags = feature.properties;
        if (tags.natural === 'water' || tags.waterway === 'riverbank') {
          return { color: '#91c8d7', weight: 1, fillColor: '#a9d5e0', fillOpacity: 1 };
        }
        if (tags.landuse === 'forest' || tags.landuse === 'grass' || tags.leisure) {
          return { color: '#c7d9bb', weight: 0.6, fillColor: '#dce8d2', fillOpacity: 0.9 };
        }
        return { color: '#e3ded5', weight: 0.7, fillColor: '#eee9df', fillOpacity: 0.8 };
      }
    }).addTo(map);

    let buildingLayer;
    let buildingDataRequested = false;
    const updateBuildingVisibility = () => {
      if (map.getZoom() >= 15 && !window.ORCHID_OFFLINE_BUILDINGS && !buildingDataRequested) {
        buildingDataRequested = true;
        const script = document.createElement('script');
        script.src = '../js/ormoc-building-data.js?v=2';
        script.onload = updateBuildingVisibility;
        script.onerror = () => {
          console.error('Detailed offline building data failed to load.');
          if (tileError) {
            tileError.textContent = 'Detailed building footprints could not be loaded.';
            tileError.classList.add('visible');
          }
        };
        document.head.appendChild(script);
      } else if (map.getZoom() >= 15 && window.ORCHID_OFFLINE_BUILDINGS && !buildingLayer) {
        buildingLayer = window.L.geoJSON(window.ORCHID_OFFLINE_BUILDINGS, {
          style: { color: '#d7d1c7', weight: 0.5, fillColor: '#e7e1d7', fillOpacity: 0.95 }
        }).addTo(map);
      } else if (map.getZoom() < 15 && buildingLayer && map.hasLayer(buildingLayer)) {
        map.removeLayer(buildingLayer);
      }
    };
    map.on('zoomend', updateBuildingVisibility);
    updateBuildingVisibility();

    window.L.geoJSON(collection(waterFeatures), {
      style: (feature) => ({
        color: feature.properties.natural === 'coastline' ? '#80bfce' : '#a3d0dc',
        weight: feature.properties.natural === 'coastline' ? 2 : 2.5,
        opacity: 0.95
      })
    }).addTo(map);

    window.L.geoJSON(collection(roadFeatures), {
      style: (feature) => {
        const road = feature.properties.highway;
        const majorRoad = ['motorway', 'trunk', 'primary', 'secondary'].includes(road);
        const weight = {
          motorway: 4, trunk: 4, primary: 3.5, secondary: 3,
          tertiary: 2.5, residential: 2, unclassified: 2, service: 1.5
        }[road] || 1;
        return {
          color: majorRoad ? '#e3ad6d' : '#fffefa',
          weight: weight + 1.2,
          opacity: 1
        };
      }
    }).addTo(map);

    // Ormoc City administrative boundary (OSM relation 5426241)
    window.L.polygon([
      [11.07931, 124.47717],
      [11.05117, 124.49589],
      [11.04085, 124.50195],
      [11.03303, 124.5069],
      [11.02477, 124.51242],
      [11.01527, 124.5183],
      [10.99798, 124.5303],
      [10.99404, 124.53259],
      [10.98066, 124.54036],
      [10.9801,  124.54102],
      [10.8781395, 124.6169004],
      [10.94532, 124.67073],
      [10.96146, 124.68395],
      [10.962114, 124.684491],
      [10.97978, 124.69912],
      [10.99824, 124.71352],
      [11.0000537, 124.7384729],
      [11.0037794, 124.7897305],
      [11.03055, 124.78374],
      [11.04824, 124.7766],
      [11.05267, 124.7757],
      [11.06397, 124.76493],
      [11.08335, 124.74796],
      [11.10243, 124.72938],
      [11.10729, 124.72382],
      [11.11338, 124.71822],
      [11.12075, 124.71143],
      [11.12766, 124.70439],
      [11.13692, 124.69567],
      [11.15655, 124.67773],
      [11.15323, 124.65743],
      [11.1418,  124.642],
      [11.13319, 124.62904],
      [11.12496, 124.62552],
      [11.10852, 124.62075],
      [11.10653, 124.61909],
      [11.10677, 124.61288],
      [11.10934, 124.60291],
      [11.11114, 124.58908],
      [11.11243, 124.58109],
      [11.1161,  124.56098],
      [11.12443, 124.55516],
      [11.12832, 124.55329],
      [11.13305, 124.55179],
      [11.13678, 124.54964],
      [11.1392,  124.54729],
      [11.14032, 124.54425],
      [11.14032, 124.54127],
      [11.13966, 124.5384],
      [11.13816, 124.53349],
      [11.13686, 124.5295],
      [11.13298, 124.52016],
      [11.12914, 124.51141],
      [11.12082, 124.50555],
      [11.11298, 124.50038],
      [11.1124596, 124.4999737],
      [11.10463, 124.49386],
      [11.07931, 124.47717]
    ], {
      color: '#3b82f6',
      weight: 2,
      opacity: 0.95,
      dashArray: '7 6',
      lineCap: 'round',
      lineJoin: 'round',
      fillColor: '#3b82f6',
      fillOpacity: 0.06
    }).addTo(map).bindTooltip('Ormoc City boundary', {
      sticky: true,
      className: 'offline-map-boundary-label'
    });

    window.L.geoJSON(collection(roadFeatures), {
      style: (feature) => {
        const road = feature.properties.highway;
        const majorRoad = ['motorway', 'trunk', 'primary', 'secondary'].includes(road);
        const weight = {
          motorway: 4, trunk: 4, primary: 3.5, secondary: 3,
          tertiary: 2.5, residential: 2, unclassified: 2, service: 1.5
        }[road] || 1;
        return {
          color: majorRoad ? '#fff3d9' : '#ffffff',
          weight,
          opacity: 1
        };
      },
      onEachFeature(feature, layer) {
        if (feature.properties.name) {
          layer.bindTooltip(feature.properties.name, { sticky: true, className: 'offline-map-label' });
        }
      }
    }).addTo(map);

    window.L.geoJSON(collection(railFeatures), {
      style: { color: '#8a7c9c', weight: 2, dashArray: '5 4' }
    }).addTo(map);

    const placeFeatures = features.filter((feature) =>
      feature.geometry.type === 'Point' &&
      feature.properties.name &&
      ['city', 'town'].includes(feature.properties.place)
    );
    window.L.geoJSON(collection(placeFeatures), {
      pointToLayer(feature, latlng) {
        return window.L.circleMarker(latlng, {
          radius: 2,
          color: '#68747a',
          weight: 1,
          fillColor: '#ffffff',
          fillOpacity: 1
        }).bindTooltip(feature.properties.name, {
          permanent: true,
          direction: 'top',
          className: 'offline-map-place-label'
        });
      }
    }).addTo(map);

    if (tileError) tileError.classList.remove('visible');

    renderSensorMarkers();

    return map;
  }

  function getNamedMapLocations() {
    const features = window.ORCHID_OFFLINE_MAP?.features;
    if (!Array.isArray(features)) return [];

    const mapBounds = { minLatitude: 10.94, maxLatitude: 11.08, minLongitude: 124.53, maxLongitude: 124.68 };
    const groupedLocations = new Map();
    const collectCoordinates = (value, points) => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
        points.push([value[1], value[0]]);
        return;
      }
      value.forEach((item) => collectCoordinates(item, points));
    };

    features.forEach((feature) => {
      const properties = feature?.properties;
      const name = typeof properties?.name === 'string' ? properties.name.trim() : '';
      if (!name || !feature.geometry?.coordinates) return;
      const category = properties.place
        ? 'place'
        : properties.leisure
          ? 'landmark'
          : properties.landuse
            ? 'area'
            : properties.highway
              ? 'road'
              : null;
      if (!category) return;

      const points = [];
      collectCoordinates(feature.geometry.coordinates, points);
      points.forEach(([latitude, longitude]) => {
        if (latitude < mapBounds.minLatitude || latitude > mapBounds.maxLatitude ||
            longitude < mapBounds.minLongitude || longitude > mapBounds.maxLongitude) return;
        const key = `${category}:${name}`;
        const location = groupedLocations.get(key) || {
          key,
          name,
          category,
          minLatitude: latitude,
          maxLatitude: latitude,
          minLongitude: longitude,
          maxLongitude: longitude
        };
        location.minLatitude = Math.min(location.minLatitude, latitude);
        location.maxLatitude = Math.max(location.maxLatitude, latitude);
        location.minLongitude = Math.min(location.minLongitude, longitude);
        location.maxLongitude = Math.max(location.maxLongitude, longitude);
        groupedLocations.set(key, location);
      });
    });

    return [...groupedLocations.values()]
      .map((location) => ({
        key: location.key,
        name: location.name,
        category: location.category,
        latitude: (location.minLatitude + location.maxLatitude) / 2,
        longitude: (location.minLongitude + location.maxLongitude) / 2
      }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }

  function initAddSensor(map) {
    const panel = document.getElementById('add-sensor-panel');
    const select = document.getElementById('asf-node-id');
    const mapLocationSelect = document.getElementById('asf-map-location');
    const locationInput = document.getElementById('asf-location');
    const saveButton = document.getElementById('btn-save-sensor');
    const cancelButton = document.getElementById('btn-cancel-placement');
    const status = document.getElementById('map-data-status');
    if (!panel || !map || !select || !mapLocationSelect || !locationInput ||
        !saveButton || !cancelButton || !status) return;

    let draft = null;
    let placementMode = false;
    let activeNodeKey = null;
    const namedMapLocations = getNamedMapLocations();
    const mapLocationById = new Map(namedMapLocations.map((location) => [location.key, location]));
    const chosenNode = () => SENSOR_NODES.find((node) => node.key === (activeNodeKey || select.value));
    const availableNodes = () => SENSOR_NODES.filter((node) => !isDeployedNode(node));
    const populateMapLocations = () => {
      mapLocationSelect.replaceChildren(new Option(
        namedMapLocations.length ? 'Pin or choose a place' : 'Named places unavailable', ''
      ));
      const groups = [
        ['place', 'Areas & neighborhoods'],
        ['landmark', 'Landmarks & sites'],
        ['area', 'Named areas'],
        ['road', 'Roads & streets']
      ];
      groups.forEach(([category, label]) => {
        const locations = namedMapLocations.filter((location) => location.category === category);
        if (!locations.length) return;
        const group = document.createElement('optgroup');
        group.label = label;
        locations.forEach((location) => {
          group.appendChild(new Option(location.name, location.key));
        });
        mapLocationSelect.appendChild(group);
      });
      mapLocationSelect._orchidDropdownSync?.();
    };
    const setStatus = (message, state = 'success') => {
      status.textContent = message;
      status.dataset.state = state;
      status.hidden = state === 'success' && !message;
    };
    const updateButtons = () => {
      const node = chosenNode();
      const movingNode = isDeployedNode(node || {});
      saveButton.textContent = movingNode ? 'Save Movement' : 'Save Placement';
      saveButton.classList.toggle('map-add-sensor-action--move', movingNode);
      locationInput.disabled = !node;
      mapLocationSelect.disabled = !node || namedMapLocations.length === 0;
      saveButton.disabled = !node || !locationInput.value.trim() || !draft;
      cancelButton.hidden = !placementMode && !draft;
      // Push disabled-state change to the custom dropdown trigger button
      mapLocationSelect._orchidDropdownSync?.();
    };
    const refreshNodes = (showConnectionStatus = false) => {
      const selectedKey = select.value;
      const unplacedNodes = availableNodes();
      select.replaceChildren(new Option(
        unplacedNodes.length ? 'Choose an unplaced node' : 'All nodes are already placed', ''
      ));
      unplacedNodes.forEach((node) => select.add(new Option(
        `${node.id} · ${node.status}`, node.key
      )));
      select.disabled = unplacedNodes.length === 0;
      if (unplacedNodes.some((node) => node.key === selectedKey)) {
        select.value = selectedKey;
        activeNodeKey = selectedKey;
      } else if (!activeNodeKey || !SENSOR_NODES.some((node) => node.key === activeNodeKey)) {
        locationInput.value = '';
        activeNodeKey = null;
        placementMode = false;
        clearDraft();
        map.getContainer().style.cursor = '';
      }
      updateButtons();
      if (databaseConnected && showConnectionStatus) setStatus('', 'success');
      select._orchidDropdownSync?.();
    };
    const clearDraft = () => {
      if (draft) map.removeLayer(draft.marker);
      draft = null;
    };
    const resetControls = () => {
      clearDraft();
      placementMode = false;
      map.getContainer().style.cursor = '';
      select.value = '';
      activeNodeKey = null;
      mapLocationSelect.value = '';
      // Remove any dynamic "clicked" option
      mapLocationSelect.querySelector('option[data-dynamic]')?.remove();
      mapLocationSelect._orchidDropdownSync?.();
      locationInput.value = '';
      updateButtons();
    };
    const setDraftPin = (latitude, longitude, label = '') => {
      clearDraft();
      const isMove = isDeployedNode(chosenNode() || {});
      const markerStateClass = isMove ? 'orchid-map-marker--moving' : 'orchid-map-marker--placing';
      const icon = window.L.divIcon({
        className: 'orchid-map-icon',
        html: `<span class="orchid-map-marker ${markerStateClass}" aria-hidden="true"><span class="node-pin-dot"></span><span class="node-number">+</span></span>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
      const marker = window.L.marker([latitude, longitude], { icon, zIndexOffset: 500 }).addTo(map);
      if (label) {
        const tooltipLabel = document.createElement('span');
        tooltipLabel.textContent = label;
        marker.bindTooltip(tooltipLabel, {
          permanent: true,
          direction: 'top',
          className: 'map-location-preview-label'
        });
      }
      draft = { latitude, longitude, marker };
    };

    refreshNodes(true);
    populateMapLocations();
    select.addEventListener('change', () => {
      clearDraft();
      activeNodeKey = select.value || null;
      // Clear any leftover dynamic "clicked" option before resetting
      mapLocationSelect.querySelector('option[data-dynamic]')?.remove();
      mapLocationSelect.value = '';
      locationInput.value = chosenNode()?.location || '';
      placementMode = Boolean(activeNodeKey);
      map.getContainer().style.cursor = placementMode ? 'crosshair' : '';
      if (placementMode) {
        setStatus('Choose a named place below, or click the map to place the pin manually.');
      } else {
        setStatus('', 'success');
      }
      updateButtons();
      // Sync the custom dropdown UI to reflect the reset value and enabled/disabled state
      mapLocationSelect._orchidDropdownSync?.();
    });

    mapLocationSelect.addEventListener('change', () => {
      const location = mapLocationById.get(mapLocationSelect.value);
      if (!location || !chosenNode()) return;
      locationInput.value = location.name;
      map.setView([location.latitude, location.longitude], Math.max(map.getZoom(), 16));
      setDraftPin(location.latitude, location.longitude, location.name);
      placementMode = true;
      map.getContainer().style.cursor = 'crosshair';
      setStatus(`Preview pin near ${location.name}. Click the map to fine-tune it, or save.`);
      updateButtons();
    });
    window.addEventListener('orchid:move-node-placement', (event) => {
      const node = SENSOR_NODES.find((item) => item.id === String(event.detail?.nodeId));
      if (!node || !isDeployedNode(node)) return;
      clearDraft();
      select.value = '';
      activeNodeKey = node.key;
      mapLocationSelect.value = '';
      locationInput.value = node.location || '';
      placementMode = true;
      map.getContainer().style.cursor = 'crosshair';
      setStatus(`Move ${node.id}: choose a named place or click the map to select its new location.`);
      updateButtons();
    });
    locationInput.addEventListener('input', updateButtons);
    window.addEventListener('orchid:sensor-data-updated', () => refreshNodes(true));

    map.on('click', (event) => {
      if (!placementMode || !chosenNode()) return;
      const lat = event.latlng.lat;
      const lng = event.latlng.lng;
      // Clear immediately so re-pinning doesn't show stale name
      locationInput.value = '';
      // Reset Place on map dropdown to a "locating..." placeholder
      let dynamicOption = mapLocationSelect.querySelector('option[data-dynamic]');
      if (!dynamicOption) {
        dynamicOption = document.createElement('option');
        dynamicOption.setAttribute('data-dynamic', 'true');
        mapLocationSelect.insertBefore(dynamicOption, mapLocationSelect.firstChild);
      }
      dynamicOption.value = '__clicked__';
      dynamicOption.textContent = `Locating…`;
      mapLocationSelect.value = '__clicked__';
      mapLocationSelect._orchidDropdownSync?.();
      setDraftPin(lat, lng, '');
      setStatus(`Pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}. Looking up location…`);
      updateButtons();
      // Reverse geocode to auto-fill Place on map and Node Name
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16&addressdetails=1`)
        .then((r) => r.json())
        .then((data) => {
          const a = data.address || {};
          const name = a.neighbourhood || a.suburb || a.village || a.town ||
                       a.city_district || a.quarter || a.hamlet ||
                       a.road || data.display_name?.split(',')[0] || '';
          dynamicOption.textContent = name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          mapLocationSelect.value = '__clicked__';
          mapLocationSelect._orchidDropdownSync?.();
          if (name) {
            locationInput.value = name;
            setDraftPin(lat, lng, name);
            setStatus(`Pin at ${lat.toFixed(5)}, ${lng.toFixed(5)} — ${name}. Click again to fine-tune, or save.`);
          } else {
            setStatus(`Pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}. Click again to fine-tune, or save.`);
          }
          updateButtons();
        })
        .catch(() => {
          dynamicOption.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          setStatus(`Pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}. Click again to fine-tune, or save.`);
        });
    });
    cancelButton.addEventListener('click', resetControls);

    saveButton.addEventListener('click', async () => {
      const node = chosenNode();
      const location = locationInput.value.trim();
      if (!node || !location) {
        setStatus('Choose an existing node and enter a node name.', 'error');
        return;
      }
      const latitude = draft?.latitude ?? node.latitude;
      const longitude = draft?.longitude ?? node.longitude;
      if (!draft || latitude == null || longitude == null) {
        setStatus('Place a pin on the map before saving.', 'error');
        return;
      }

      const isMove = isDeployedNode(node);
      window.OrchidModal.open({
        title: isMove ? 'Confirm movement?' : 'Confirm location?',
        bodyHtml: `<p>Save <strong>${escapeHtml(node.id)}</strong> at <strong>${escapeHtml(location)}</strong>?</p><p>This will ${isMove ? 'move its map pin' : 'add its pin'} to the selected location.</p>`,
        confirmText: isMove ? 'Save movement' : 'Save placement',
        cancelText: 'Keep editing',
        onConfirm: async () => {
          saveButton.disabled = true;
          saveButton.textContent = isMove ? 'Saving movement…' : 'Saving placement…';
          try {
            await persistNodePlacement(node, location, latitude, longitude);
            setStatus(`${node.id} ${isMove ? 'movement' : 'placement'} saved.`);
            window.OrchidToast.show({
              variant: 'success',
              title: isMove ? 'Movement saved' : 'Placement saved',
              message: `${node.id} is mapped to ${location}.`
            });
            resetControls();
            refreshNodes();
          } catch (error) {
            setStatus(error.message, 'error');
            window.OrchidToast.show({ variant: 'error', title: 'Could not save placement', message: error.message });
          } finally {
            saveButton.disabled = false;
            updateButtons();
          }
        }
      });
    });

  }

  function openNodeModal(nodeId) {
    const node = NODE_DATA[nodeId];
    if (!node) return;

    const online = isOnlineNode(node);
    const batteryMillivolts = Number.parseFloat(String(node.battery ?? '').replace(/[^0-9.]/g, ''));
    const batteryVoltage = Number.isFinite(batteryMillivolts) &&
      batteryMillivolts >= 2500 && batteryMillivolts <= 4500
      ? `${(batteryMillivolts / 1000).toFixed(3)} V`
      : 'Unavailable';
    const batteryNote = batteryVoltage === 'Unavailable'
      ? 'Voltage unavailable'
      : `${batteryVoltage} · from voltage`;
    const batteryPercent = window.OrchidComponentLoader.estimateBatteryPercent(node.battery);
    const uptimeMinutes = Number(node.uptime);
    const uptime = Number.isInteger(uptimeMinutes) && uptimeMinutes >= 0 && uptimeMinutes <= 65535
      ? (() => {
          const days = Math.floor(uptimeMinutes / 1440);
          const hours = Math.floor((uptimeMinutes % 1440) / 60);
          const minutes = uptimeMinutes % 60;
          return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
        })()
      : 'Unavailable';
    const sensorStatus = Number(node.sensorStatus) === 1
      ? { label: 'Normal', state: 'normal' }
      : Number(node.sensorStatus) === 3
        ? { label: 'Battery warning', state: 'warning' }
        : { label: 'Unknown', state: 'unknown' };
    const formatReading = (value, unit) => {
      const reading = parseReading(value);
      return reading === null ? '—' : `${reading.toFixed(1)} ${unit}`;
    };
    const heatIndexReading = parseReading(node.heatIndex);
    const nodeTitle = node.name || node.location || 'Sensor node';
    const locationNote = node.location && node.location !== nodeTitle
      ? `<span class="map-node-overview-location">${escapeHtml(node.location)}</span>`
      : '';
    const nodeActions = hasMapPlacementControls
      ? `
          <button type="button" class="map-node-action" id="map-node-rename">Edit name</button>
          <button type="button" class="map-node-action map-node-action--move" id="map-node-move">Move location</button>
          <button type="button" class="map-node-action map-node-action--danger" id="map-node-remove">Remove from map</button>`
      : `
          <button type="button" class="map-node-action map-node-action--primary" id="map-node-map">View map</button>`;
    window.OrchidModal.open({
      wide: true,
      title: 'Sensor Overview',
      hideFooter: true,
      bodyHtml: `
      <div class="map-node-inspector">
        <div class="map-node-overview-header">
          <div class="map-node-overview-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M7 9H4M7 12H4M7 15H4M17 9h3M17 12h3M17 15h3M9 7V4M12 7V4M15 7V4M9 17v3M12 17v3M15 17v3"/></svg>
          </div>
          <div class="map-node-overview-identity">
            <div class="map-node-overview-badges">
              <span class="map-node-id">${escapeHtml(node.id || node.key)}</span>
              <span class="map-node-status" data-state="${online ? 'online' : 'offline'}">
                <span aria-hidden="true"></span>${online ? 'Online' : 'Offline'}
              </span>
            </div>
            <h3>${escapeHtml(nodeTitle)}</h3>
            ${locationNote}
          </div>
          <div class="map-node-overview-seen">
            <span>Last reported</span>
            <strong>${escapeHtml(node.lastSeen ? formatNodeTimestamp(node.lastSeen) : 'No reports received')}</strong>
          </div>
        </div>
        <section class="map-node-overview-section" aria-label="Health and weather context">
          <h3>Health &amp; Weather Context</h3>
          <div class="map-node-health-grid">
            <div class="map-node-health-card map-node-health-card--battery">
              <span class="map-node-health-label">Battery</span>
              <strong class="map-node-health-value" data-state="${batteryPercent === null ? 'unknown' : batteryPercent < 20 ? 'low' : batteryPercent < 50 ? 'medium' : 'good'}">
                ${batteryPercent === null ? '—' : `${batteryPercent}%`}
              </strong>
              <span class="map-node-health-sub">${escapeHtml(batteryNote)}</span>
              <span class="map-node-battery-bar" role="progressbar" aria-label="Estimated battery charge" aria-valuenow="${batteryPercent ?? 0}" aria-valuemin="0" aria-valuemax="100">
                <span style="width:${batteryPercent ?? 0}%"></span>
              </span>
            </div>
            <div class="map-node-health-card">
              <span class="map-node-health-label">Uptime</span>
              <strong class="map-node-health-value">${escapeHtml(uptime)}</strong>
              <span class="map-node-health-sub">Estimated runtime</span>
            </div>
            <div class="map-node-health-card">
              <span class="map-node-health-label">Sensor status</span>
              <strong class="map-node-health-value map-node-sensor-state" data-state="${sensorStatus.state}">${sensorStatus.label}</strong>
              <span class="map-node-health-sub">${sensorStatus.state === 'warning' ? 'Low battery reported' : sensorStatus.state === 'normal' ? 'Operating normally' : 'Status unavailable'}</span>
            </div>
            <div class="map-node-health-card">
              <span class="map-node-health-label">Current weather</span>
              <strong class="map-node-health-value">${escapeHtml(node.weather && node.weather !== '--' ? node.weather : '—')}</strong>
              <span class="map-node-health-sub">Reported condition</span>
            </div>
          </div>
        </section>
        <section class="map-node-overview-section" aria-label="Latest recorded telemetry">
          <h3>Latest Recorded Telemetry</h3>
          <div class="map-node-telemetry-grid">
            <div class="map-node-telemetry-card map-node-telemetry-card--temperature">
              <div class="map-node-telemetry-label">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 14.76V5a3 3 0 0 0-6 0v9.76a5 5 0 1 0 6 0Z"/><path d="M11 12V5"/></svg>
                <span>Temperature</span>
              </div>
              <div class="map-node-telemetry-value">${escapeHtml(formatReading(node.temp, '°C'))}</div>
              <span class="map-node-telemetry-sub">Ambient air temperature</span>
            </div>
            <div class="map-node-telemetry-card map-node-telemetry-card--humidity">
              <div class="map-node-telemetry-label">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a7 7 0 0 0 7-7c0-4-7-13-7-13S5 11 5 15a7 7 0 0 0 7 7Z"/><path d="M9 16a3 3 0 0 0 3 3"/></svg>
                <span>Humidity</span>
              </div>
              <div class="map-node-telemetry-value">${escapeHtml(formatReading(node.humidity, '%'))}</div>
              <span class="map-node-telemetry-sub">Relative humidity</span>
            </div>
            <div class="map-node-telemetry-card map-node-telemetry-card--pressure">
              <div class="map-node-telemetry-label">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>
                <span>Pressure</span>
              </div>
              <div class="map-node-telemetry-value">${escapeHtml(formatReading(node.pressure, 'hPa'))}</div>
              <span class="map-node-telemetry-sub">Barometric pressure</span>
            </div>
            <div class="map-node-telemetry-card map-node-telemetry-card--heat">
              <div class="map-node-telemetry-label">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a7 7 0 0 0 7-7c0-3.5-2-5.5-4-7-.5 2-1.5 3-2.5 3.5C12.5 7 10 3.5 7 2c.5 4-1 6-2 8a7 7 0 0 0 7 12Z"/><path d="M12 22a3 3 0 0 0 3-3c0-1.5-1-2.5-2-3-.2 1-1 1.8-2 2.2A3 3 0 0 0 12 22Z"/></svg>
                <span>Heat Index</span>
              </div>
              <div class="map-node-telemetry-value">${escapeHtml(formatReading(node.heatIndex, '°C'))}</div>
              <span class="map-node-telemetry-sub">${escapeHtml(heatIndexReading === null ? 'No reading' : heatLevel(heatIndexReading).label)}</span>
            </div>
          </div>
        </section>
        <div class="map-node-actions">${nodeActions}</div>
      </div>`
    });
    const nodeName = document.querySelector('.map-node-overview-identity h3');
    const mapButton = document.getElementById('map-node-map');
    const renameButton = document.getElementById('map-node-rename');
    const moveButton = document.getElementById('map-node-move');
    const removeButton = document.getElementById('map-node-remove');
    if (mapButton) {
      mapButton.addEventListener('click', () => {
        window.location.href = 'map.html';
      });
    }
    if (renameButton && nodeName) {
      let editingName = false;
      renameButton.addEventListener('click', async () => {
        if (!editingName) {
          editingName = true;
          nodeName.contentEditable = 'true';
          nodeName.setAttribute('role', 'textbox');
          nodeName.setAttribute('aria-label', 'Node name');
          nodeName.focus();
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(nodeName);
          selection.removeAllRanges();
          selection.addRange(range);
          renameButton.textContent = 'Save name';
          renameButton.classList.add('map-node-action--primary');
          return;
        }
        const location = nodeName.textContent.trim();
        if (!location || location.length > 48) {
          window.OrchidToast.show({
            variant: 'error',
            title: 'Invalid node name',
            message: 'Enter a node name between 1 and 48 characters.'
          });
          nodeName.focus();
          return;
        }
        renameButton.disabled = true;
        try {
          await persistNodePlacement(node, location, node.latitude, node.longitude);
          window.OrchidModal.close();
          window.OrchidToast.show({ variant: 'success', title: 'Location renamed', message: `${node.id} is now named ${location}.` });
        } catch (error) {
          window.OrchidToast.show({ variant: 'error', title: 'Could not rename location', message: error.message });
          renameButton.disabled = false;
        }
      });
      nodeName.addEventListener('keydown', (event) => {
        if (editingName && event.key === 'Enter') {
          event.preventDefault();
          renameButton.click();
        }
      });
    }
    if (moveButton) {
      moveButton.addEventListener('click', () => {
        window.OrchidModal.close();
        window.dispatchEvent(new CustomEvent('orchid:move-node-placement', {
          detail: { nodeId: node.id }
        }));
      });
    }
    if (removeButton) {
      removeButton.addEventListener('click', () => {
        window.OrchidModal.open({
          title: 'Remove node from map?',
          bodyHtml: `<p>Remove <strong>${escapeHtml(node.id)}</strong> from the map?</p><p>The map pin and placement will be removed. The node and all IoT readings will remain in the database.</p>`,
          confirmText: 'Remove from map',
          cancelText: 'Cancel',
          isDestructive: true,
          onConfirm: async () => {
            try {
              await requestJson(`/api/map/placements/${encodeURIComponent(node.id)}`, { method: 'DELETE' });
              updateNodePlacement(node.id, null, null, null);
              window.OrchidToast.show({
                variant: 'success',
                title: 'Node removed from map',
                message: `${node.id} and its readings remain in the database.`
              });
            } catch (error) {
              window.OrchidToast.show({ variant: 'error', title: 'Could not remove node', message: error.message });
            }
          }
        });
      });
    }
  }

  // ── Init ─────────────────────────────────────────────────────
  document.addEventListener('orchid:components-ready', async () => {
    initCharts();
    window.OrchidComponentLoader.initAnalyticsTooltips();
    configureMetricPage();
    updateTelemetryHistoryHeading();
    initHeatIndexTabs();
    const retryButton = document.getElementById('hi-retry-button');
    if (retryButton) {
      retryButton.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('orchid:data-refresh'));
      });
    }
    const map = initMapInteractions();

    // Collapsible map panels — collapses to icon only
    const initCollapsePanel = (btnId, panelSelector) => {
      const btn = document.getElementById(btnId);
      const panel = btn?.closest(panelSelector);
      if (!btn || !panel) return;
      btn.addEventListener('click', () => {
        const collapsed = panel.dataset.collapsed === 'true';
        panel.dataset.collapsed = String(!collapsed);
        btn.setAttribute('aria-expanded', String(collapsed));
      });
    };
    initCollapsePanel('btn-collapse-sensor-panel', '.map-add-sensor-panel');
    initCollapsePanel('btn-collapse-legend', '.map-legend');
    dashboardReady = true;
    try {
      const historyStartDate = document.getElementById('heat-index-page') ? heatIndexStartDate : null;
      const historyEndDate = document.getElementById('heat-index-page') ? heatIndexEndDate : null;
      await loadNodesFromDatabase(historyStartDate, historyEndDate);
    } catch (error) {
      console.error('Could not load nodes from the ORCHID database.', error);
      const mapStatus = document.getElementById('map-data-status');
      if (mapStatus) {
        mapStatus.textContent = error.message;
        mapStatus.dataset.state = 'error';
        mapStatus.hidden = false;
      }
      if (retryButton) retryButton.hidden = false;
      if (hasMapPlacementControls) {
        window.OrchidToast.show({
          variant: 'error',
          title: 'Sensor database unavailable',
          message: error.message
        });
      }
    }
    renderFleetSummary();
    renderSensorMarkers();
    initAddSensor(map);
  });

})();
