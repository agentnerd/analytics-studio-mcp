import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 8080;
const SERVER_URL = process.env.SERVER_URL || 'https://analytics-mcp-app-p3o2myktxq-uc.a.run.app';
const MCP_VERSION = '2025-11-25';
const UI_RESOURCE_URI = 'ui://analytics-visual/v2.html';
const UI_MIME_TYPE = 'text/html;profile=mcp-app';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: true }));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static('public', { extensions: ['html'] }));

const json = (id, result) => ({ jsonrpc: '2.0', id, result });
const textContent = (text) => [{ type: 'text', text }];

const tools = [
  {
    name: 'analytics_studio',
    title: 'Interactive Analytics Studio',
    description: 'Create a minimal embedded MCP data visual from actual provided data only. Use this when the user asks to visualize rows, CSV, a table, metrics, or ad hoc analytics. Always pass actual data via rows or csv; do not rely on sample data. The app supports bar, horizontal bar, line, area, donut, scatter, heatmap, KPI, field configuration, filters, and color palettes.',
    inputSchema: {
      type: 'object',
      anyOf: [
        { required: ['rows'] },
        { required: ['csv'] }
      ],
      properties: {
        topic: { type: 'string', description: 'Analytics question or dashboard topic.' },
        datasetName: { type: 'string', description: 'Optional dataset name.' },
        chartType: { type: 'string', description: 'Initial chart type: bar, line, pie, donut, scatter, bubble, area, stacked, horizontal, heatmap, kpi.' },
        rows: { type: 'array', items: { type: 'object' }, minItems: 1, description: 'Required unless csv is supplied. Actual dataset rows to visualize. Never call this tool without rows or csv.' },
        csv: { type: 'string', minLength: 3, description: 'Required unless rows are supplied. CSV text with headers to visualize. Never call this tool without rows or csv.' },
        xField: { type: 'string', description: 'Optional group/X-axis field.' },
        yField: { type: 'string', description: 'Optional metric/Y-axis field.' },
        seriesField: { type: 'string', description: 'Optional series/color field.' },
        filterField: { type: 'string', description: 'Optional filter field.' },
        filterValue: { type: 'string', description: 'Optional filter value.' },
        title: { type: 'string', description: 'Optional concise chart title. If omitted, Analytics Studio generates a title from the metric and dimension.' }
      }
    },
    _meta: {
      ui: { resourceUri: UI_RESOURCE_URI },
      'openai/outputTemplate': UI_RESOURCE_URI,
      'openai/resultCanProduceWidget': true,
      'openai/widgetAccessible': true
    }
  }
];

app.get(['/healthz', '/healthz/'], (_, res) => res.json({ ok: true, service: 'analytics-studio', version: '1.0.0' }));
app.get(['/mcp', '/mcp/'], (_, res) => res.json({ ok: true, service: 'analytics-studio', protocol: 'MCP JSON-RPC over POST', endpoint: '/mcp' }));
app.get('/selftest', (_, res) => {
  const html = embeddedHtml();
  res.json({ ok: true, checks: { tools: tools.length, hasUiMeta: !!tools[0]._meta.ui.resourceUri, mime: UI_MIME_TYPE, htmlBytes: Buffer.byteLength(html), hasCharts: html.includes('chartTypes') && html.includes('drawBar'), actualDataOnly: true } });
});

app.get('/api/sample-data', (_, res) => res.json({ rows: [], fields: [] }));
app.post('/api/sample-data', (_, res) => res.json({ rows: [], fields: [] }));

app.post('/mcp', async (req, res) => {
  const msg = req.body;
  if (!msg || msg.jsonrpc !== '2.0') return res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid JSON-RPC message' }, id: null });
  if (!('id' in msg)) return res.status(202).end();
  switch (msg.method) {
    case 'initialize':
      return res.json(json(msg.id, { protocolVersion: msg.params?.protocolVersion || MCP_VERSION, capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'analytics-studio', title: 'Analytics Studio', version: '1.0.0' }, instructions: 'Use analytics_studio to create minimal embedded interactive charts from actual rows or CSV data.' }));
    case 'ping':
      return res.json(json(msg.id, {}));
    case 'tools/list':
      return res.json(json(msg.id, { tools }));
    case 'tools/call':
      return res.json(json(msg.id, callTool(msg.params?.name, msg.params?.arguments || {})));
    case 'resources/list':
      return res.json(json(msg.id, { resources: [uiResourceDescriptor()] }));
    case 'resources/read':
      if (msg.params?.uri !== UI_RESOURCE_URI) return res.json({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Unknown resource' } });
      return res.json(json(msg.id, { contents: [uiResourceContent()] }));
    default:
      return res.json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
});

function callTool(name, args) {
  if (name !== 'analytics_studio') return { content: textContent(`Unknown tool ${name}. Use analytics_studio.`), isError: true };
  const topic = args.topic || 'Ad hoc analytics';
  const chartType = args.chartType || 'bar';
  const rows = normalizeRows(args.rows?.length ? args.rows : (args.csv ? parseCsv(args.csv) : []));
  const config = inferConfig(rows, args);
  const title = args.title || makeTitle(topic, config, rows);
  const visualId = stableVisualId(rows, config, title);
  const appUrl = `${SERVER_URL}/?topic=${encodeURIComponent(topic)}&chart=${encodeURIComponent(chartType)}`;
  const structuredRows = rows.length <= 200 ? rows : rows.slice(0, 200);
  if (!rows.length) {
    return {
      content: textContent('No dataset was supplied. To render the MCP visual, call analytics_studio again with actual `rows` or `csv` data. Do not call this tool with only a topic/title.'),
      structuredContent: { topic, title, chartType, appUrl, rows: [], rowCount: 0, noData: true, message: 'No dataset rows or CSV were supplied to the tool call.' },
      _meta: { noData: true, topic, title, chartType, rows: [], message: 'No dataset rows or CSV were supplied to the tool call.' },
      isError: true
    };
  }
  return {
    content: textContent(`Embedded Analytics Visual ready for: ${topic}\n\nDataset rows: ${rows.length}.`),
    structuredContent: {
      topic,
      title,
      visualId,
      chartType,
      appUrl,
      rows: structuredRows,
      rowCount: rows.length,
      dataTruncated: structuredRows.length !== rows.length,
      config,
      datasetName: args.datasetName || 'Provided dataset'
    },
    _meta: {
      rows,
      config,
      title,
      visualId,
      datasetName: args.datasetName || 'Provided dataset',
      topic,
      chartType
    }
  };
}

function uiResourceDescriptor() {
  return { uri: UI_RESOURCE_URI, name: 'Analytics Visual', title: 'Interactive Analytics Visual', description: 'Minimal embedded data visualizer using actual tool-provided data only.', mimeType: UI_MIME_TYPE, _meta: { ui: { domain: SERVER_URL, csp: { connectDomains: [SERVER_URL], resourceDomains: [SERVER_URL] }, prefersBorder: true } } };
}
function uiResourceContent() { return { uri: UI_RESOURCE_URI, mimeType: UI_MIME_TYPE, text: embeddedHtml(), _meta: uiResourceDescriptor()._meta }; }
function embeddedHtml() {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
  return html
    .replace('<link rel="stylesheet" href="/styles.css" />', () => `<style>${css}</style>`)
    .replace('<script src="/app.js"></script>', () => `<script>window.API_BASE=${JSON.stringify(SERVER_URL)};window.IS_MCP_EMBED=true;window.EMBEDDED_ROWS=[];</script><script>${js}</script>`);
}
function fields() { return ['date','region','channel','product','segment','revenue','orders','profit','spend','satisfaction']; }
function normalizeRows(rows) {
  return (rows || []).map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, coerce(v)])));
}
function coerce(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}
function parseCsv(csv = '') {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => Object.fromEntries(splitCsvLine(line).map((v,i) => [headers[i], coerce(v)])));
}
function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  out.push(cur.trim()); return out;
}
function inferConfig(rows, args = {}) {
  const keys = Object.keys(rows[0] || {});
  const numeric = keys.filter(k => rows.some(r => typeof r[k] === 'number' || (!Number.isNaN(Number(r[k])) && r[k] !== '')));
  const dims = keys.filter(k => !numeric.includes(k));
  return {
    xField: args.xField || (dims.includes('region') ? 'region' : dims[0] || keys[0]),
    yField: args.yField || (numeric.includes('revenue') ? 'revenue' : numeric[0] || keys[0]),
    seriesField: args.seriesField || (dims.includes('channel') ? 'channel' : '(none)'),
    filterField: args.filterField || '(none)',
    filterValue: args.filterValue || '(all)'
  };
}
function makeTitle(topic, config, rows) {
  const cleanTopic = String(topic || '').trim();
  if (cleanTopic && !/^ad hoc analytics$/i.test(cleanTopic)) return titleCase(cleanTopic).slice(0, 80);
  const metric = label(config.yField || 'value');
  const dim = label(config.xField || 'category');
  const filter = config.filterField && config.filterField !== '(none)' && config.filterValue && config.filterValue !== '(all)' ? ` for ${config.filterValue}` : '';
  return `${metric} by ${dim}${filter}`;
}
function titleCase(s) { return String(s).replace(/[_-]/g,' ').replace(/\s+/g,' ').trim().replace(/\b\w/g, c => c.toUpperCase()); }
function label(s) { return titleCase(String(s || '').replace(/[()]/g,'')); }
function stableVisualId(rows, config, title) {
  const seed = JSON.stringify({ title, x: config.xField, y: config.yField, rows: rows.slice(0, 25) });
  let h = 2166136261;
  for (let i=0;i<seed.length;i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `visual_${(h >>> 0).toString(36)}`;
}
function sampleRows() {
  const regions = ['North','South','East','West'];
  const channels = ['Direct','Partner','Marketplace'];
  const products = ['Atlas','Beacon','Cirrus','Delta'];
  const segments = ['Enterprise','Midmarket','SMB'];
  const rows = [];
  for (let m = 1; m <= 12; m++) for (const region of regions) for (const channel of channels) {
    const product = products[(m + region.length + channel.length) % products.length];
    const segment = segments[(m + channel.length) % segments.length];
    const base = 42000 + m * 3600 + region.length * 2100 + channel.length * 950;
    const revenue = Math.round(base + Math.sin(m + region.length) * 9000);
    const orders = Math.round(revenue / (900 + (m % 4) * 110));
    const spend = Math.round(revenue * (0.18 + ((m + channel.length) % 5) / 100));
    const profit = Math.round(revenue * (0.32 + (region.length % 4) / 100) - spend);
    const satisfaction = Math.round((72 + ((m * 3 + region.length + channel.length) % 22)) * 10) / 10;
    rows.push({ date: `2026-${String(m).padStart(2,'0')}-01`, month: `2026-${String(m).padStart(2,'0')}`, region, channel, product, segment, revenue, orders, profit, spend, satisfaction });
  }
  return rows;
}

app.listen(PORT, () => console.log(`Analytics MCP App listening on ${PORT}`));
