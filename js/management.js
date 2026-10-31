(function () {
  'use strict';

  const PAGE_SIZE = 7;
  const VALID_METRICS = ['heat-index', 'temperature', 'humidity', 'pressure'];
  const METRICS = {
    'heat-index': { name: 'Heat Index', field: 'heatIndex', unit: '°C', minimum: -50, maximum: 100, band: 'Risk Level' },
    temperature: { name: 'Temperature', field: 'temperature', unit: '°C', minimum: -50, maximum: 70, band: 'Temperature Band' },
    humidity: { name: 'Humidity', field: 'humidity', unit: '%', minimum: 0, maximum: 100, band: 'Humidity Band' },
    pressure: { name: 'Pressure', field: 'pressure', unit: ' hPa', minimum: 300, maximum: 1200, band: 'Pressure Band' }
  };
  const elements = {};
  let selectedMetric = 'heat-index';
  let selectedFrom = '';
  let selectedTo = '';
  let reportRows = [];
  let filteredRows = [];
  let pagination = null;
  let requestVersion = 0;
  let searchTimer = null;
  let reportDateFilter = null;
  let applyingReportDatePreset = false;
  let auditEvents = [];
  let filteredAuditEvents = [];
  let auditPagination = null;
  let auditStartDate = '';
  let auditEndDate = '';
  const AUDIT_PAGE_SIZE = 8;

  function manilaDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function offsetDate(value, days) {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function initializeReportDateFilter() {
    const datePreset = document.getElementById('report-date-preset');
    const dateFilterMount = document.getElementById('report-date-filter-mount');
    const today = manilaDate();
    const presetRanges = {
      today: [today, today],
      yesterday: [offsetDate(today, -1), offsetDate(today, -1)],
      '7-days': [offsetDate(today, -6), today],
      '30-days': [offsetDate(today, -29), today]
    };
    const matchingPreset = Object.entries(presetRanges)
      .find(([, range]) => range[0] === selectedFrom && range[1] === selectedTo);
    datePreset.value = matchingPreset ? matchingPreset[0] : 'custom';
    window.OrchidComponentLoader.initDateRangeFilter(dateFilterMount, {
      initialStartDate: selectedFrom,
      initialEndDate: selectedTo,
      maxRangeDays: 31,
      allowLongInitialRange: true,
      onChange: (startDate, endDate) => {
        if (startDate === selectedFrom && endDate === selectedTo) return;
        if (!applyingReportDatePreset) datePreset.value = 'custom';
        selectedFrom = startDate;
        selectedTo = endDate;
        updateUrl();
        loadReport();
      }
    }).then((dateFilter) => {
      reportDateFilter = dateFilter;
    }).catch((error) => {
      console.error('Could not initialize the report date filter.', error);
      elements.status.hidden = false;
      elements.status.dataset.state = 'error';
      elements.status.textContent = 'The report date filter could not be initialized. Reload the page to try again.';
    });

    datePreset.addEventListener('change', async () => {
      const today = manilaDate();
      if (datePreset.value === 'all-data') {
        try {
          const response = await fetch('/api/nodes/date-range', {
            cache: 'no-store',
            headers: { Accept: 'application/json' }
          });
          const range = await response.json().catch(() => {
            throw new Error(`The sensor database API returned invalid JSON (${response.status}).`);
          });
          if (!response.ok) {
            throw new Error((range && range.error) || `Could not load the available date range (${response.status}).`);
          }
          if (!validDate(range.startDate) || !validDate(range.endDate) || range.startDate > range.endDate) {
            datePreset.value = 'custom';
            updateStatus('No sensor readings are available to include in the full date range.');
            return;
          }
          if (!reportDateFilter) throw new Error('The report date filter is not ready yet. Try again shortly.');
          applyingReportDatePreset = true;
          reportDateFilter.setRange(range.startDate, range.endDate, true);
          applyingReportDatePreset = false;
          updateStatus();
          return;
        } catch (error) {
          applyingReportDatePreset = false;
          datePreset.value = 'custom';
          console.error('Could not load the full report date range.', error);
          updateStatus(error.message, 'error');
          return;
        }
      }
      const endDate = datePreset.value === 'yesterday' ? offsetDate(today, -1) : today;
      const startDate = datePreset.value === 'yesterday'
        ? endDate
        : datePreset.value === '7-days'
          ? offsetDate(today, -6)
          : datePreset.value === '30-days'
            ? offsetDate(today, -29)
            : today;
      if (datePreset.value === 'custom') return;
      if (!reportDateFilter) {
        updateStatus('The report date filter is not ready yet. Try again shortly.', 'error');
        return;
      }
      applyingReportDatePreset = true;
      reportDateFilter.setRange(startDate, endDate);
      applyingReportDatePreset = false;
      updateStatus();
    });
  }

  function auditDateRangeLabel() {
    const formatDate = (value) => new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(new Date(`${value}T00:00:00+08:00`));
    return auditStartDate === auditEndDate
      ? formatDate(auditStartDate)
      : `${formatDate(auditStartDate)} – ${formatDate(auditEndDate)}`;
  }

  function datesBetween(from, to) {
    const dates = [];
    for (let cursor = new Date(`${from}T00:00:00Z`); cursor <= new Date(`${to}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    return dates;
  }

  function dateRangesBetween(from, to, maxDays = 30) {
    const ranges = [];
    for (let cursor = from; cursor <= to;) {
      const chunkEnd = offsetDate(cursor, maxDays - 1);
      const end = chunkEnd < to ? chunkEnd : to;
      ranges.push([cursor, end]);
      cursor = offsetDate(end, 1);
    }
    return ranges;
  }

  function sensorTimestamp(value) {
    if (typeof value !== 'string') return NaN;
    const timestamp = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}+08:00`);
    return Number.isFinite(timestamp) ? timestamp : NaN;
  }

  function parseReading(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const match = value.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function heatIndexCelsius(temperature, humidity) {
    if (temperature === null || humidity === null ||
        temperature * 9 / 5 + 32 < 80 || humidity < 40) return temperature;
    const fahrenheit = temperature * 9 / 5 + 32;
    const heatIndex = -42.379 + 2.04901523 * fahrenheit + 10.14333127 * humidity
      - 0.22475541 * fahrenheit * humidity - 0.00683783 * fahrenheit ** 2
      - 0.05481717 * humidity ** 2 + 0.00122874 * fahrenheit ** 2 * humidity
      + 0.00085282 * fahrenheit * humidity ** 2 - 0.00000199 * fahrenheit ** 2 * humidity ** 2;
    return (heatIndex - 32) * 5 / 9;
  }

  function metricValue(reading) {
    const metric = METRICS[selectedMetric];
    const value = parseReading(reading[metric.field]);
    if (value !== null) return value;
    if (selectedMetric === 'heat-index') {
      return heatIndexCelsius(parseReading(reading.temperature), parseReading(reading.humidity));
    }
    return null;
  }

  function metricBand(value) {
    if (selectedMetric === 'heat-index') {
      if (value < 27) return ['safe', 'Safe'];
      if (value < 32) return ['caution', 'Caution'];
      if (value < 41) return ['extreme-caution', 'Extreme caution'];
      if (value < 54) return ['danger', 'Danger'];
      return ['extreme-danger', 'Extreme danger'];
    }
    if (selectedMetric === 'temperature') {
      if (value < 20) return ['safe', 'Cool'];
      if (value < 25) return ['caution', 'Comfortable'];
      if (value < 32) return ['extreme-caution', 'Warm'];
      if (value < 40) return ['danger', 'Hot'];
      return ['extreme-danger', 'Very hot'];
    }
    if (selectedMetric === 'humidity') {
      if (value < 30) return ['safe', 'Dry'];
      if (value < 40) return ['caution', 'Low'];
      if (value < 60) return ['extreme-caution', 'Comfortable'];
      if (value < 80) return ['danger', 'Humid'];
      return ['extreme-danger', 'Very humid'];
    }
    if (value < 980) return ['safe', 'Very low'];
    if (value < 1000) return ['caution', 'Low'];
    if (value < 1020) return ['extreme-caution', 'Normal'];
    if (value < 1040) return ['danger', 'High'];
    return ['extreme-danger', 'Very high'];
  }

  function formatValue(value) {
    return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}${METRICS[selectedMetric].unit}`;
  }

  function formatTimestamp(timestamp) {
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

  function setText(element, value) {
    if (element) element.textContent = value;
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'reports');
    url.searchParams.set('from', selectedFrom);
    url.searchParams.set('to', selectedTo);
    url.searchParams.set('report', selectedMetric);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function configureMetric() {
    const metric = METRICS[selectedMetric];
    document.title = `ORCHID | ${metric.name} Report`;
    elements.metric.value = selectedMetric;
    setText(elements.averageLabel, 'Period Average');
    setText(elements.averageSub, `Across valid ${metric.name.toLowerCase()} readings`);
    setText(elements.highestSub, 'Highest value in selected range');
    setText(elements.valueHeading, `${metric.name} (${metric.unit.trim()})`);
    setText(elements.bandHeading, metric.band);
    setText(elements.chartTitle, `${metric.name} Trend`);
    setText(elements.tableTitle, `${metric.name} Data Records`);
    setText(elements.tableSubtitle, `Sensor readings in the selected date range.`);
    // Update the extra columns so they never duplicate the primary metric column
    const extraHeadings = document.querySelectorAll('.report-extra-col');
    if (selectedMetric === 'temperature') {
      if (extraHeadings[0]) extraHeadings[0].textContent = 'Humidity (%)';
      if (extraHeadings[1]) extraHeadings[1].textContent = 'Pressure (hPa)';
    } else if (selectedMetric === 'humidity') {
      if (extraHeadings[0]) extraHeadings[0].textContent = 'Temperature (°C)';
      if (extraHeadings[1]) extraHeadings[1].textContent = 'Pressure (hPa)';
    } else if (selectedMetric === 'pressure') {
      if (extraHeadings[0]) extraHeadings[0].textContent = 'Temperature (°C)';
      if (extraHeadings[1]) extraHeadings[1].textContent = 'Humidity (%)';
    } else {
      if (extraHeadings[0]) extraHeadings[0].textContent = 'Temperature (°C)';
      if (extraHeadings[1]) extraHeadings[1].textContent = 'Humidity (%)';
    }
  }

  function updateSummary() {
    const values = reportRows.map((row) => row.value);
    const average = values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : null;
    const highest = reportRows.reduce((current, row) => !current || row.value > current.value ? row : current, null);
    const nodes = new Set(reportRows.map((row) => row.nodeId));
    setText(elements.readingCount, String(reportRows.length));
    setText(elements.average, formatValue(average));
    setText(elements.highest, highest ? formatValue(highest.value) : '—');
    setText(elements.highestSub, highest
      ? `${highest.location} · ${formatTimestamp(highest.timestamp)}`
      : 'No readings in selected period');
    setText(elements.nodeCount, String(nodes.size));
    elements.exportButton.disabled = reportRows.length === 0;
  }

  function createRecordRow(record) {
    const row = document.createElement('tr');
    const band = metricBand(record.value);
    row.dataset.searchText = `${record.timestampLabel} ${record.nodeId} ${record.location} ${record.value} ${record.temperature ?? ''} ${record.humidity ?? ''} ${band[1]}`.toLocaleLowerCase();
    const fields = [
      record.timestampLabel,
      record.nodeId,
      record.location,
      formatValue(record.value),
      selectedMetric === 'temperature'
        ? (record.humidity === null ? '—' : `${record.humidity.toFixed(1)}%`)
        : (record.temperature === null ? '—' : `${record.temperature.toFixed(1)}°C`),
      selectedMetric === 'temperature' || selectedMetric === 'humidity'
        ? (record.pressure === null ? '—' : `${record.pressure.toFixed(1)} hPa`)
        : (record.humidity === null ? '—' : `${record.humidity.toFixed(1)}%`)
    ];
    fields.forEach((value, index) => {
      const cell = document.createElement('td');
      if (index === 0) cell.className = 'hi-node-timestamp';
      if (index === 1) cell.className = 'hi-node-id';
      if (index === 2) cell.className = 'hi-node-location';
      if (index >= 3 && index <= 5) {
        const metricKey = [selectedMetric, 'temperature', 'humidity'][index - 3];
        cell.className = 'hi-node-reading';
        const valueBadge = document.createElement('span');
        valueBadge.className = `hi-node-value hi-node-value--${metricKey}`;
        valueBadge.textContent = value;
        cell.appendChild(valueBadge);
      } else {
        cell.textContent = value;
      }
      row.appendChild(cell);
    });
    const bandCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `hi-level-badge hi-level-badge--${band[0]}`;
    badge.textContent = band[1];
    bandCell.appendChild(badge);
    row.appendChild(bandCell);
    return row;
  }

  function renderRecordPage(page = 1) {
    const body = elements.tableBody;
    if (!filteredRows.length) {
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.className = 'hi-table-empty';
      cell.textContent = reportRows.length
        ? 'No report records match your search.'
        : 'No valid sensor readings were found in this date range.';
      const row = document.createElement('tr');
      row.appendChild(cell);
      body.replaceChildren(row);
      return;
    }
    const start = (page - 1) * PAGE_SIZE;
    body.replaceChildren(...filteredRows.slice(start, start + PAGE_SIZE).map(createRecordRow));
  }

  function renderRecords() {
    const query = elements.search.value.trim().toLocaleLowerCase();
    filteredRows = reportRows.filter((row) => !query || row.searchText.includes(query));
    if (pagination) pagination.setTotal(filteredRows.length);
    renderRecordPage(1);
  }

  function svgElement(tag, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    return element;
  }

  function drawChart() {
    elements.chartArea.querySelectorAll('svg').forEach((chart) => chart.remove());
    const empty = elements.chartEmpty;
    if (!reportRows.length) {
      empty.hidden = false;
      empty.textContent = 'No sensor readings are available for this report period.';
      return;
    }
    empty.hidden = true;
    const hourly = new Map();
    reportRows.forEach((row) => {
      const timestamp = Math.floor(row.timestamp / 3600000) * 3600000;
      const bucket = hourly.get(timestamp) || { total: 0, count: 0 };
      bucket.total += row.value;
      bucket.count += 1;
      hourly.set(timestamp, bucket);
    });
    const points = [...hourly.entries()].map(([timestamp, bucket]) => ({
      timestamp: timestamp + 1800000,
      value: bucket.total / bucket.count,
      count: bucket.count
    }));
    points.sort((first, second) => first.timestamp - second.timestamp);
    const width = Math.max(480, elements.chartArea.clientWidth);
    const height = Math.max(250, elements.chartArea.clientHeight);
    const margin = { top: 20, right: 24, bottom: 42, left: 62 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const low = Math.min(...points.map((point) => point.value));
    const high = Math.max(...points.map((point) => point.value));
    const spread = high - low || Math.max(1, Math.abs(high) * 0.08);
    const minimum = low - spread * 0.15;
    const maximum = high + spread * 0.15;
    const firstTimestamp = points[0].timestamp;
    const lastTimestamp = points[points.length - 1].timestamp;
    const x = (timestamp) => margin.left + (firstTimestamp === lastTimestamp
      ? plotWidth / 2
      : (timestamp - firstTimestamp) * plotWidth / (lastTimestamp - firstTimestamp));
    const y = (value) => margin.top + (maximum - value) * plotHeight / (maximum - minimum);
    const axisDate = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      ...(selectedFrom === selectedTo ? {} : { month: 'numeric', day: 'numeric' }),
      hour: 'numeric'
    });
    const svg = svgElement('svg', {
      class: 'report-chart-svg',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': `${METRICS[selectedMetric].name} hourly average trend with ${points.length} time periods`
    });
    const title = svgElement('title');
    title.textContent = `${METRICS[selectedMetric].name} hourly average`;
    svg.appendChild(title);
    for (let index = 0; index <= 4; index += 1) {
      const value = maximum - (maximum - minimum) * index / 4;
      const position = margin.top + plotHeight * index / 4;
      svg.appendChild(svgElement('line', {
        x1: margin.left, y1: position, x2: width - margin.right, y2: position,
        class: 'report-chart-grid'
      }));
      const label = svgElement('text', {
        x: margin.left - 10, y: position + 4, 'text-anchor': 'end',
        class: 'report-chart-axis'
      });
      label.textContent = value.toFixed(1);
      svg.appendChild(label);
    }
    const style = getComputedStyle(document.documentElement);
    const METRIC_COLORS = {
      'heat-index':  style.getPropertyValue('--color-yellow').trim()  || '#f59e0b',
      temperature:   style.getPropertyValue('--color-red').trim()     || '#ef4444',
      humidity:      style.getPropertyValue('--color-cyan').trim()    || '#38bdf8',
      pressure:      style.getPropertyValue('--color-violet').trim()  || '#a78bfa',
    };
    const metricColor = METRIC_COLORS[selectedMetric] || '#a6c4ee';
    const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.timestamp)},${y(point.value)}`).join(' ');
    svg.appendChild(svgElement('path', { d: path, class: 'report-chart-line', stroke: metricColor }));
    points.forEach((point, index) => {
      const circle = svgElement('circle', {
        cx: x(point.timestamp), cy: y(point.value), r: 5, class: 'report-chart-point', fill: metricColor
      });
      const tooltip = svgElement('title');
      tooltip.textContent = `${formatTimestamp(point.timestamp)} · ${formatValue(point.value)} hourly average · ${point.count} reading${point.count === 1 ? '' : 's'}`;
      circle.appendChild(tooltip);
      svg.appendChild(circle);
      if (points.length <= 8 || index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 6) === 0) {
        const label = svgElement('text', {
          x: x(point.timestamp), y: height - 12, 'text-anchor': 'middle',
          class: 'report-chart-axis'
        });
        label.textContent = axisDate.format(new Date(point.timestamp));
        svg.appendChild(label);
      }
    });
    elements.chartArea.appendChild(svg);
  }

  function updateStatus(message = '', state = 'info') {
    elements.status.hidden = !message;
    elements.status.textContent = message;
    elements.status.dataset.state = state;
  }

  async function fetchDateRange(startDate, endDate) {
    let response;
    try {
      const params = new URLSearchParams({ startDate, endDate });
      response = await fetch(`/api/nodes?${params}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
    } catch (error) {
      throw new Error('Cannot connect to the sensor database API. Start the app with python3 scripts/serve.py and reload.');
    }
    const payload = await response.json().catch(() => {
      throw new Error(`The sensor database API returned invalid JSON (${response.status}).`);
    });
    if (!response.ok) {
      throw new Error((payload && payload.error) || `Could not load readings from ${startDate} to ${endDate} (${response.status}).`);
    }
    if (!Array.isArray(payload.nodes) || payload.nodes.some((node) =>
      !node || typeof node.key !== 'string' || typeof node.id !== 'string')) {
      throw new Error(`The sensor database returned an invalid node list for ${startDate} to ${endDate}.`);
    }
    return payload.nodes;
  }

  function fetchDate(date) {
    return fetchDateRange(date, date);
  }

  async function loadReport() {
    const version = ++requestVersion;
    elements.exportButton.disabled = true;
    elements.tableBody.innerHTML = '<tr><td class="hi-table-empty" colspan="7">Loading report data…</td></tr>';
    elements.chartEmpty.hidden = false;
    elements.chartEmpty.textContent = 'Loading report data…';
    setText(elements.chartNote, 'Loading report data…');
    updateStatus('Loading sensor readings for the selected period…');
    configureMetric();
    reportRows = [];
    updateSummary();
    elements.paginationRoot.replaceChildren();
    pagination = null;
    try {
      const dateRanges = dateRangesBetween(selectedFrom, selectedTo);
      const rows = [];
      for (let offset = 0; offset < dateRanges.length; offset += 4) {
        const batch = await Promise.all(dateRanges.slice(offset, offset + 4).map(([startDate, endDate]) =>
          fetchDateRange(startDate, endDate)
        ));
        if (version !== requestVersion) return;
        batch.forEach((nodes) => {
          nodes.forEach((node) => {
            const readings = Array.isArray(node.dateReadings) ? node.dateReadings : [];
            readings.forEach((reading) => {
              const timestamp = sensorTimestamp(reading.createdAt);
              const value = metricValue(reading);
              const metric = METRICS[selectedMetric];
              if (!Number.isFinite(timestamp) || value === null ||
                  value < metric.minimum || value > metric.maximum) return;
              const readingDate = manilaDate(new Date(timestamp));
              if (readingDate < selectedFrom || readingDate > selectedTo) return;
              rows.push({
                date: readingDate,
                timestamp,
                timestampLabel: formatTimestamp(timestamp),
                nodeId: node.id || node.key,
                location: node.location || node.name || node.key,
                value,
                temperature: parseReading(reading.temperature),
                humidity: parseReading(reading.humidity),
                pressure: parseReading(reading.pressure)
              });
            });
          });
        });
      }
      if (version !== requestVersion) return;
      rows.sort((first, second) => second.timestamp - first.timestamp);
      reportRows = rows.map((row) => ({
        ...row,
        searchText: `${row.timestampLabel} ${row.nodeId} ${row.location} ${row.value} ${row.temperature ?? ''} ${row.humidity ?? ''} ${metricBand(row.value)[1]}`.toLocaleLowerCase()
      }));
      updateSummary();
      drawChart();
      updateStatus(reportRows.length
        ? ''
        : 'No valid sensor readings were found in this date range.');
      setText(elements.chartNote, `${selectedFrom} — ${selectedTo} · ${reportRows.length.toLocaleString()} readings`);
      const paginationInstance = await window.OrchidComponentLoader.initPagination(elements.paginationRoot, {
        total: 0,
        pageSize: PAGE_SIZE,
        page: 1,
        onChange: (page) => renderRecordPage(page)
      });
      if (version !== requestVersion) return;
      pagination = paginationInstance;
      renderRecords();
    } catch (error) {
      if (version !== requestVersion) return;
      console.error('Could not load ORCHID report data.', error);
      updateStatus(error.message, 'error');
      setText(elements.chartNote, 'Report unavailable');
      elements.retry.hidden = false;
      elements.chartEmpty.hidden = false;
      elements.chartEmpty.textContent = 'Report data could not be loaded.';
      elements.tableBody.innerHTML = '<tr><td class="hi-table-empty" colspan="7">Report data could not be loaded. Use Retry report to try again.</td></tr>';
    }
  }

  function exportCsv() {
    const metric = METRICS[selectedMetric];
    const fields = ['Timestamp', 'Node ID', 'Station / Location', `${metric.name} (${metric.unit.trim()})`, 'Temperature (°C)', 'Humidity (%)', metric.band];
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = filteredRows.map((row) => [
      row.timestampLabel,
      row.nodeId,
      row.location,
      row.value.toFixed(1),
      row.temperature?.toFixed(1) ?? '',
      row.humidity?.toFixed(1) ?? '',
      metricBand(row.value)[1]
    ]);
    const csv = [fields, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `orchid-${selectedMetric}-report-${selectedFrom}-to-${selectedTo}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportPdf() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.OrchidToast.show({
        variant: 'error',
        title: 'Export blocked',
        message: 'Allow pop-ups to open the printable PDF report.'
      });
      return;
    }

    const metric = METRICS[selectedMetric];
    const columns = ['Timestamp', 'Node ID', 'Station / Location', `${metric.name} (${metric.unit.trim()})`, 'Temperature (°C)', 'Humidity (%)', metric.band];
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
    const tableHead = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
    const tableRows = filteredRows.map((row) => {
      const values = [
        row.timestampLabel,
        row.nodeId,
        row.location,
        formatValue(row.value),
        row.temperature === null ? '—' : `${row.temperature.toFixed(1)}°C`,
        row.humidity === null ? '—' : `${row.humidity.toFixed(1)}%`,
        metricBand(row.value)[1]
      ];
      return `<tr>${values.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`;
    }).join('');

    printWindow.document.write(`<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>ORCHID ${escapeHtml(metric.name)} Report</title>
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
        <h1>ORCHID ${escapeHtml(metric.name)} Report</h1>
        <p>${filteredRows.length.toLocaleString()} readings · ${escapeHtml(selectedFrom)} — ${escapeHtml(selectedTo)} · Exported ${escapeHtml(new Date().toLocaleString())}</p>
        <table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table>
        <script>window.addEventListener('load', () => window.print());</script>
      </body>
      </html>`);
    printWindow.document.close();
  }

  function auditActionLabel(action) {
    return {
      placement_added: 'Placement added',
      placement_updated: 'Placement updated',
      placement_removed: 'Placement removed',
      session_login: 'Signed in',
      session_logout: 'Signed out',
      account_created: 'Account created',
      account_profile_updated: 'Profile updated',
      account_email_updated: 'Email changed',
      account_password_updated: 'Password changed'
    }[action] || action;
  }

  function auditDetails(event) {
    const details = event.details;
    if (event.action === 'session_login' || event.action === 'session_logout' ||
        event.action === 'account_created' || event.action === 'account_password_updated') {
      return details.message;
    }
    if (event.action === 'account_profile_updated') return `Name changed from ${details.previous} to ${details.current}`;
    if (event.action === 'account_email_updated') return `Email changed from ${details.previous} to ${details.current}`;
    const placement = details.current || details.previous;
    const coordinates = placement
      ? ` (${Number(placement.latitude).toFixed(5)}, ${Number(placement.longitude).toFixed(5)})`
      : '';
    if (event.action === 'placement_added') {
      return `Placed at ${details.current.location_name}${coordinates}`;
    }
    if (event.action === 'placement_updated') {
      return `Moved from ${details.previous.location_name} to ${details.current.location_name}${coordinates}`;
    }
    if (event.action === 'placement_removed') {
      return `Removed placement at ${details.previous.location_name}${coordinates}`;
    }
    return 'Placement details unavailable';
  }

  function renderAuditPage(page = 1) {
    const body = document.getElementById('audit-table-body');
    body.replaceChildren();
    if (!filteredAuditEvents.length) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.className = 'hi-table-empty';
      cell.colSpan = 5;
      cell.textContent = auditEvents.length
        ? 'No audit events match your filters.'
        : 'No administrator actions have been recorded yet.';
      return;
    }

    const events = filteredAuditEvents.slice((page - 1) * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE);
    const timestampFormat = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    events.forEach((event) => {
      const row = body.insertRow();
      const timeCell = row.insertCell();
      timeCell.className = 'audit-time';
      timeCell.textContent = `${timestampFormat.format(new Date(event.timestamp))} PHT`;

      const actorCell = row.insertCell();
      const actorBadge = document.createElement('span');
      actorBadge.className = `audit-actor${event.actor.includes('(sample)') ? ' audit-actor--sample' : ''}`;
      actorBadge.textContent = event.actor;
      actorCell.appendChild(actorBadge);

      const actionCell = row.insertCell();
      actionCell.className = `audit-action audit-action--${event.action.replace(/[^a-z0-9_-]/gi, '')}`;
      const actionBadge = document.createElement('span');
      actionBadge.textContent = auditActionLabel(event.action);
      actionCell.appendChild(actionBadge);

      const nodeCell = row.insertCell();
      nodeCell.className = 'audit-node';
      nodeCell.textContent = event.node_id === 0 ? 'Account' : event.node_id === null ? '—' : `Node ${event.node_id}`;

      const detailsCell = row.insertCell();
      detailsCell.className = 'audit-details';
      detailsCell.textContent = auditDetails(event);
    });
  }

  function renderAuditEvents() {
    const action = document.getElementById('audit-action').value;
    const query = document.getElementById('audit-search').value.trim().toLocaleLowerCase();
    document.getElementById('audit-date-range-label').textContent =
      `Showing audit events from ${auditDateRangeLabel()}.`;
    filteredAuditEvents = auditEvents.filter((event) => {
      const matchesAction = action === 'all' || event.action === action;
      const eventDate = manilaDate(new Date(event.timestamp));
      const matchesDate = eventDate >= auditStartDate && eventDate <= auditEndDate;
      const text = `${event.actor} ${event.node_id} ${auditActionLabel(event.action)} ${auditDetails(event)}`.toLocaleLowerCase();
      return matchesAction && matchesDate && (!query || text.includes(query));
    });
    if (auditPagination) auditPagination.setTotal(filteredAuditEvents.length);
    renderAuditPage();
  }

  async function loadAuditEvents() {
    const body = document.getElementById('audit-table-body');
    const status = document.getElementById('audit-status');
    status.hidden = true;
    body.innerHTML = '<tr><td class="hi-table-empty" colspan="5">Loading audit events…</td></tr>';
    try {
      const response = await fetch('/api/audit', {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => {
        throw new Error(`The audit API returned invalid JSON (${response.status}).`);
      });
      if (!response.ok) throw new Error(payload?.error || `Could not load audit events (${response.status}).`);
      if (!Array.isArray(payload.events) || payload.events.length > 5000 || payload.events.some((event) =>
        !event || !Number.isInteger(event.id) || typeof event.created_at !== 'string' ||
        typeof event.actor !== 'string' || typeof event.action !== 'string' ||
        !(Number.isInteger(event.node_id) || event.node_id === null) || typeof event.details !== 'string')) {
        throw new Error('The audit API returned an invalid event list.');
      }
      auditEvents = payload.events.map((event) => {
        const timestamp = Date.parse(event.created_at);
        const details = JSON.parse(event.details);
        if (!details || typeof details !== 'object') {
          throw new Error('The audit API returned an invalid event record.');
        }
        const validPlacement = (placement) => placement &&
          typeof placement.location_name === 'string' &&
          Number.isFinite(placement.latitude) &&
          Number.isFinite(placement.longitude);
        const validDetails = event.action === 'placement_added'
          ? Number.isInteger(event.node_id) && validPlacement(details.current)
          : event.action === 'placement_updated'
            ? Number.isInteger(event.node_id) && validPlacement(details.previous) && validPlacement(details.current)
            : event.action === 'placement_removed'
              ? Number.isInteger(event.node_id) && validPlacement(details.previous)
              : (event.action === 'session_login' || event.action === 'session_logout')
                ? (event.node_id === null || event.node_id === 0) && typeof details.message === 'string'
                : (event.action === 'account_created' || event.action === 'account_password_updated')
                  ? event.node_id === 0 && typeof details.message === 'string'
                  : (event.action === 'account_profile_updated' || event.action === 'account_email_updated')
                    ? event.node_id === 0 && typeof details.previous === 'string' && typeof details.current === 'string'
                    : false;
        if (!Number.isFinite(timestamp) || !validDetails) {
          throw new Error('The audit API returned an invalid event record.');
        }
        return { ...event, timestamp, details };
      });
      renderAuditEvents();
    } catch (error) {
      console.error('Could not load ORCHID audit events.', error);
      auditEvents = [];
      filteredAuditEvents = [];
      if (auditPagination) auditPagination.setTotal(0);
      status.hidden = false;
      status.dataset.state = 'error';
      status.textContent = error.message;
      body.innerHTML = '<tr><td class="hi-table-empty" colspan="5">Audit events could not be loaded. Reload the page to try again.</td></tr>';
    }
  }

  async function accountRequest(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Account request failed (${response.status}).`);
    return result;
  }

  async function loadAccountSettings() {
    const status = document.getElementById('account-settings-status');
    const setStatus = (message, isError = false) => {
      status.textContent = message;
      status.dataset.state = isError ? 'error' : 'success';
    };
    const updateHeader = (name, email) => {
      document.querySelectorAll('.user-name').forEach((el) => { el.textContent = name; });
      document.querySelectorAll('.user-role').forEach((el) => { el.textContent = email; });
      const avatar = document.getElementById('btn-user-avatar');
      if (avatar) {
        avatar.setAttribute('aria-label', `User Profile: ${name}`);
        avatar.setAttribute('data-tip', email);
      }
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'orchid:account-updated',
          display_name: name,
          email
        }, window.location.origin);
      }
    };

    try {
      const statusResponse = await fetch('/api/auth/status');
      const auth = await statusResponse.json();
      if (!statusResponse.ok) throw new Error(auth.error || 'Could not verify account access.');
      if (auth.mock_mode) {
        setStatus('Account security settings are disabled while the server is using mock-data mode.', true);
        document.querySelectorAll('#account-settings-panel form').forEach((form) => {
          form.querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
        });
        return;
      }
      const response = await fetch('/api/account');
      const account = await response.json();
      if (!response.ok) throw new Error(account.error || 'Could not load the administrator account.');
      document.getElementById('account-display-name').value = account.display_name;
      document.getElementById('account-current-email').value = account.email;

      document.getElementById('account-profile-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          const result = await accountRequest('/api/account/profile', {
            display_name: document.getElementById('account-display-name').value
          });
          account.display_name = result.display_name;
          updateHeader(result.display_name, account.email);
          setStatus('Profile updated.');
        } catch (error) {
          setStatus(error.message, true);
        } finally {
          submit.disabled = false;
        }
      });

      const emailForm = document.getElementById('account-email-form');
      const emailVerifyForm = document.getElementById('account-email-verify-form');
      emailForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = emailForm.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          const result = await accountRequest('/api/account/email/request', {
            new_email: document.getElementById('account-new-email').value
          });
          emailVerifyForm.hidden = false;
          setStatus(`Verification codes sent to ${result.sent_to.join(' and ')}. They expire in 10 minutes.`);
        } catch (error) {
          setStatus(error.message, true);
        } finally {
          submit.disabled = false;
        }
      });
      emailVerifyForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = emailVerifyForm.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          const result = await accountRequest('/api/account/email/verify', {
            current_code: document.getElementById('account-current-email-code').value,
            new_code: document.getElementById('account-new-email-code').value
          });
          account.email = result.email;
          document.getElementById('account-current-email').value = result.email;
          document.getElementById('account-new-email').value = '';
          emailVerifyForm.reset();
          emailVerifyForm.hidden = true;
          updateHeader(account.display_name, account.email);
          setStatus('Email updated and verified at both addresses.');
        } catch (error) {
          setStatus(error.message, true);
        } finally {
          submit.disabled = false;
        }
      });

      const passwordForm = document.getElementById('account-password-form');
      const passwordCodeForm = document.getElementById('account-password-code-form');
      const passwordVerifyForm = document.getElementById('account-password-verify-form');
      let pendingPasswordCode = null;

      passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = passwordForm.querySelector('button[type="submit"]');
        submit.disabled = true;
        pendingPasswordCode = null;
        passwordCodeForm.reset();
        passwordVerifyForm.reset();
        passwordVerifyForm.hidden = true;
        try {
          const result = await accountRequest('/api/account/password/request');
          passwordCodeForm.hidden = false;
          document.getElementById('account-password-code').focus();
          setStatus(`A verification code was sent to ${result.sent_to}. It expires in 10 minutes.`);
        } catch (error) {
          setStatus(error.message, true);
        } finally {
          submit.disabled = false;
        }
      });

      passwordCodeForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const code = document.getElementById('account-password-code').value.trim();
        if (!/^\d{6}$/.test(code)) {
          setStatus('Enter the six-digit verification code.', true);
          return;
        }
        pendingPasswordCode = code;
        passwordCodeForm.hidden = true;
        passwordVerifyForm.hidden = false;
        document.getElementById('account-new-password').focus();
        setStatus('Code accepted. Enter your new password.');
      });

      passwordVerifyForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = passwordVerifyForm.querySelector('button[type="submit"]');
        const newPassword = document.getElementById('account-new-password').value;
        const confirmation = document.getElementById('account-new-password-confirm').value;
        if (newPassword !== confirmation) {
          setStatus('The new passwords do not match.', true);
          return;
        }
        if (!pendingPasswordCode) {
          setStatus('Verification code is missing. Please start over.', true);
          return;
        }
        submit.disabled = true;
        try {
          await accountRequest('/api/account/password/verify', {
            code: pendingPasswordCode,
            new_password: newPassword
          });
          pendingPasswordCode = null;
          passwordForm.reset();
          passwordCodeForm.reset();
          passwordVerifyForm.reset();
          passwordCodeForm.hidden = true;
          passwordVerifyForm.hidden = true;
          setStatus('Password changed successfully.');
        } catch (error) {
          setStatus(error.message, true);
        } finally {
          submit.disabled = false;
        }
      });

      setStatus('Account details loaded.');
    } catch (error) {
      console.error('Could not load ORCHID account settings.', error);
      setStatus(error.message, true);
    }
  }

  function initializeAccountSettings() {
    const panel = document.getElementById('account-settings-panel');
    const reportOverview = document.querySelector('.report-overview');
    const reportExplorer = document.querySelector('.report-explorer');
    const auditView = document.getElementById('management-audit-view');
    reportOverview.hidden = true;
    reportExplorer.hidden = true;
    auditView.hidden = true;
    panel.hidden = false;
    document.title = 'ORCHID | Account & Security';
    loadAccountSettings();
  }

  function setActivePanel(panel) {
    const isRecords = panel === 'records';
    elements.tabBar.classList.toggle('show-records', isRecords);
    elements.tabChart.classList.toggle('active', !isRecords);
    elements.tabRecords.classList.toggle('active', isRecords);
    elements.tabChart.setAttribute('aria-pressed', String(!isRecords));
    elements.tabRecords.setAttribute('aria-pressed', String(isRecords));
    elements.chartPanel.hidden = isRecords;
    elements.recordsPanel.hidden = !isRecords;
  }

  function init() {
    const currentView = new URLSearchParams(window.location.search).get('view');
    const reportOverview = document.querySelector('.report-overview');
    const reportExplorer = document.querySelector('.report-explorer');
    if (currentView === 'audit') {
      document.title = 'ORCHID | Audit Trail';
      reportOverview.hidden = true;
      reportExplorer.hidden = true;
      document.getElementById('management-audit-view').hidden = false;
      document.getElementById('audit-action').addEventListener('change', renderAuditEvents);
      document.getElementById('audit-search').addEventListener('input', renderAuditEvents);
      const today = manilaDate();
      const params = new URLSearchParams(window.location.search);
      auditEndDate = validDate(params.get('endDate')) ? params.get('endDate') : today;
      auditStartDate = validDate(params.get('startDate'))
        ? params.get('startDate')
        : offsetDate(auditEndDate, -29);
      if (auditStartDate > auditEndDate) auditStartDate = auditEndDate;
      const dateFilterMount = document.getElementById('audit-date-filter-mount');
      window.OrchidComponentLoader.initDateRangeFilter(dateFilterMount, {
        initialStartDate: auditStartDate,
        initialEndDate: auditEndDate,
        onChange: (startDate, endDate) => {
          auditStartDate = startDate;
          auditEndDate = endDate;
          const url = new URL(window.location.href);
          url.searchParams.set('startDate', startDate);
          url.searchParams.set('endDate', endDate);
          window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
          renderAuditEvents();
        }
      }).catch((error) => {
        console.error('Could not initialize audit date filter.', error);
        const status = document.getElementById('audit-status');
        status.hidden = false;
        status.dataset.state = 'error';
        status.textContent = 'Audit date filter could not be initialized. Reload the page to try again.';
      });
      window.OrchidComponentLoader.initPagination(document.getElementById('audit-pagination'), {
        total: 0,
        pageSize: AUDIT_PAGE_SIZE,
        page: 1,
        onChange: (page) => renderAuditPage(page)
      }).then((paginationInstance) => {
        auditPagination = paginationInstance;
        loadAuditEvents();
      }).catch((error) => {
        console.error('Could not initialize audit pagination.', error);
        const status = document.getElementById('audit-status');
        status.hidden = false;
        status.dataset.state = 'error';
        status.textContent = 'Audit pagination could not be initialized. Reload the page to try again.';
      });
      return;
    }
    if (currentView === 'account') {
      initializeAccountSettings();
      return;
    }

    Object.assign(elements, {
      metric: document.getElementById('report-metric'),
      exportButton: document.getElementById('report-export'),
      exportMenu: document.getElementById('report-export-options'),
      retry: document.getElementById('report-retry'),
      status: document.getElementById('report-data-status'),
      readingCount: document.getElementById('report-reading-count'),
      average: document.getElementById('report-average'),
      averageLabel: document.querySelector('.report-metrics .metric-card:nth-child(2) .metric-label'),
      averageSub: document.querySelector('.report-metrics .metric-card:nth-child(2) .metric-sub'),
      highest: document.getElementById('report-highest'),
      highestSub: document.getElementById('report-highest-detail'),
      nodeCount: document.getElementById('report-node-count'),
      valueHeading: document.getElementById('report-value-heading'),
      bandHeading: document.getElementById('report-band-heading'),
      chartTitle: document.getElementById('report-chart-title'),
      chartNote: document.getElementById('report-chart-note'),
      chartArea: document.getElementById('report-chart-area'),
      chartEmpty: document.getElementById('report-chart-empty'),
      chartPanel: document.getElementById('report-panel-chart'),
      recordsPanel: document.getElementById('report-panel-records'),
      tableTitle: document.getElementById('report-table-title'),
      tableSubtitle: document.getElementById('report-table-subtitle'),
      tableBody: document.getElementById('report-table-body'),
      search: document.getElementById('report-search'),
      paginationRoot: document.getElementById('report-pagination'),
      tabBar: document.querySelector('.report-tab-bar'),
      tabChart: document.getElementById('report-tab-chart'),
      tabRecords: document.getElementById('report-tab-records')
    });

    const params = new URLSearchParams(window.location.search);
    const today = manilaDate();
    selectedMetric = VALID_METRICS.includes(params.get('report')) ? params.get('report') : 'heat-index';
    const urlFrom = params.get('from');
    const urlTo = params.get('to');
    const hasUrlDates = validDate(urlFrom) && validDate(urlTo) &&
      urlFrom <= urlTo && urlTo <= today && datesBetween(urlFrom, urlTo).length <= 36500;
    elements.metric.value = selectedMetric;
    configureMetric();
    if (hasUrlDates) {
      selectedFrom = urlFrom;
      selectedTo = urlTo;
      initializeReportDateFilter();
      loadReport();
    } else {
      selectedFrom = today;
      selectedTo = today;
      updateUrl();
      initializeReportDateFilter();
      loadReport();
    }

    elements.metric.addEventListener('change', () => {
      selectedMetric = elements.metric.value;
      updateUrl();
      loadReport();
    });
    elements.retry.addEventListener('click', loadReport);
    elements.exportButton.addEventListener('click', () => {
      const isExpanded = elements.exportButton.getAttribute('aria-expanded') === 'true';
      elements.exportButton.setAttribute('aria-expanded', String(!isExpanded));
      elements.exportMenu.hidden = isExpanded;
    });
    elements.exportMenu.addEventListener('click', (event) => {
      const item = event.target.closest('[data-report-export-format]');
      if (!item) return;

      elements.exportMenu.hidden = true;
      elements.exportButton.setAttribute('aria-expanded', 'false');
      try {
        if (item.dataset.reportExportFormat === 'csv') exportCsv();
        else if (item.dataset.reportExportFormat === 'pdf') exportPdf();
      } catch (error) {
        console.error(`Could not export report as ${item.dataset.reportExportFormat}.`, error);
        window.OrchidToast.show({
          variant: 'error',
          title: 'Report export failed',
          message: error.message
        });
      }
    });
    document.addEventListener('click', (event) => {
      if (!elements.exportMenu.contains(event.target) && !elements.exportButton.contains(event.target)) {
        elements.exportMenu.hidden = true;
        elements.exportButton.setAttribute('aria-expanded', 'false');
      }
    });
    elements.exportButton.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        elements.exportMenu.hidden = false;
        elements.exportButton.setAttribute('aria-expanded', 'true');
        elements.exportMenu.querySelector('[role="menuitem"]')?.focus();
      } else if (event.key === 'Escape' && !elements.exportMenu.hidden) {
        elements.exportMenu.hidden = true;
        elements.exportButton.setAttribute('aria-expanded', 'false');
      }
    });
    elements.exportMenu.addEventListener('keydown', (event) => {
      const items = Array.from(elements.exportMenu.querySelectorAll('[role="menuitem"]'));
      const currentIndex = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        items[(currentIndex + direction + items.length) % items.length]?.focus();
      } else if (event.key === 'Escape') {
        elements.exportMenu.hidden = true;
        elements.exportButton.setAttribute('aria-expanded', 'false');
        elements.exportButton.focus();
      }
    });
    elements.tabChart.addEventListener('click', () => setActivePanel('chart'));
    elements.tabRecords.addEventListener('click', () => setActivePanel('records'));
    elements.search.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(renderRecords, 300);
    });
    window.addEventListener('resize', () => {
      if (!elements.chartPanel.hidden) drawChart();
    });

  }

  document.addEventListener('orchid:components-ready', init, { once: true });
})();