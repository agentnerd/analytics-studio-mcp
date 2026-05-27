const API_BASE = window.API_BASE || '';
const IS_EMBED = !!window.IS_MCP_EMBED;
let rows = [], fields = [], filtered = [];
let activeType = 'bar';
let activeFilters = [];
const chartTypes = [
  ['bar','Bar','<svg viewBox="0 0 24 24"><path d="M5 20V9"/><path d="M12 20V4"/><path d="M19 20v-7"/></svg>'],
  ['horizontal','Horizontal','<svg viewBox="0 0 24 24"><path d="M4 7h11"/><path d="M4 12h16"/><path d="M4 17h8"/></svg>'],
  ['line','Line','<svg viewBox="0 0 24 24"><path d="M4 17l5-6 4 3 7-8"/></svg>'],
  ['area','Area','<svg viewBox="0 0 24 24"><path d="M4 17l5-6 4 3 7-8"/><path d="M4 20h16"/></svg>'],
  ['donut','Donut','<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 1-8 5"/><path d="M12 8a4 4 0 1 1-4 4"/></svg>'],
  ['scatter','Scatter','<svg viewBox="0 0 24 24"><circle cx="7" cy="15" r="1.8"/><circle cx="12" cy="8" r="1.8"/><circle cx="18" cy="12" r="1.8"/></svg>'],
  ['heatmap','Heatmap','<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg>'],
  ['kpi','KPI','<svg viewBox="0 0 24 24"><path d="M5 16l4-8 4 8 4-8 2 4"/></svg>']
];
const palettes = {
  Sphere: ['#1f6fff','#15151d','#d8dbe3','#8d929f','#111827','#66a3ff'],
  Ink: ['#15151d','#2c2d35','#555864','#9ca0aa','#d7d9df','#08090d'],
  Ocean: ['#1463ff','#0f827b','#6b8cff','#9fb4d9','#1b2a41','#d7e3ff'],
  Ember: ['#e17c05','#111827','#c2410c','#f2c078','#6b7280','#f7e7cf']
};
const $ = id => document.getElementById(id);

init();
async function init(){
  buildTypeBar();
  Object.keys(palettes).forEach(p => $('palette').add(new Option(p, p)));
  bind();
  setupHostBridge();
  if(!IS_EMBED) showEmpty();
}
function bind(){
  $('themeToggle').onclick = () => { const dark=document.body.classList.toggle('dark'); $('themeToggle').textContent = dark ? '☾' : '☼'; render(); };
  $('configToggle').onclick = () => { $('configPanel').classList.toggle('hiddenPanel'); requestAnimationFrame(()=>$('chartStage').scrollLeft=0); };
  ['xField','yField','seriesField','filterField','filterValue','palette'].forEach(id => $(id).addEventListener('input', () => { if(id==='filterField') updateFilterValues(); render(); }));
}
function buildTypeBar(){
  $('chartTypeBar').innerHTML = chartTypes.map(([type,label,icon]) => `<button class="typeButton" data-type="${type}" title="${label}" aria-label="${label}">${icon}</button>`).join('');
  [...document.querySelectorAll('.typeButton')].forEach(btn => btn.onclick = () => { activeType = btn.dataset.type; render(); });
  setActiveType();
}
function setActiveType(){ [...document.querySelectorAll('.typeButton')].forEach(b => b.classList.toggle('active', b.dataset.type === activeType)); }
function setupHostBridge(){
  setupMcpAppSdk();
  window.addEventListener('message', e => ingestHostPayload(e.data?.params?.result || e.data?.params?.toolResult || e.data?.result || e.data?.toolOutput || e.data?.toolInput || e.data?.params));
}
async function setupMcpAppSdk(){
  try{
    const { App } = await import(`${API_BASE || location.origin}/vendor/mcp-app.js`);
    const app = new App({ name:'AnalyticsVisual', version:'2.0.0' }, {}, { autoResize:true });
    app.ontoolresult = ingestHostPayload;
    app.ontoolinput = input => ingestHostPayload(input?.arguments || input);
    app.onhostcontextchanged = ctx => { if(ctx?.theme){ document.body.classList.toggle('dark', ctx.theme==='dark'); $('themeToggle').textContent = ctx.theme==='dark' ? '☾' : '☼'; render(); } };
    await app.connect(); window.analyticsMcpApp = app;
  }catch(e){ window.analyticsMcpAppError = e?.message || String(e); }
}
function ingestHostPayload(payload){
  if(!payload) return;
  const sc = payload.structuredContent || payload;
  const meta = payload._meta || {};
  const merged = { ...sc, ...meta, rows: meta.rows?.length ? meta.rows : sc.rows };
  if(merged.chartType && chartTypes.some(([t]) => t === merged.chartType)) activeType = merged.chartType;
  if(merged.noData) { showNoData(merged.message || 'No dataset rows or CSV were supplied to the tool call.'); return; }
  if(merged.rows?.length) loadData(merged);
}
function loadData(payload){
  rows = normalizeRows(payload.rows).filter(r => Object.values(r).some(isPresent));
  activeFilters = [];
  fields = Object.keys(rows[0] || {});
  if(!rows.length){ showEmpty(); return; }
  hydrateControls(payload.config || payload);
  const y = $('yField').value, x = $('xField').value;
  $('chartTitle').textContent = payload.title || payload.topic || `${label(y)} by ${label(x)}`;
  render();
}
function hydrateControls(config={}){
  const numeric = numericFields();
  const dims = dimensionFields();
  fill('xField', [...dims, ...fields], config.xField || bestDim(dims) || fields[0]);
  fill('yField', numeric, config.yField || bestMetric(numeric));
  fill('seriesField', ['(none)', ...dims], config.seriesField || '(none)');
  fill('filterField', ['(none)', ...fields], config.filterField || '(none)');
  updateFilterValues();
  if(config.filterValue && [...$('filterValue').options].some(o => o.value === String(config.filterValue))) $('filterValue').value = String(config.filterValue);
}
function fill(id, vals, selected){ const el=$(id); el.innerHTML=''; vals.filter(Boolean).forEach(v => el.add(new Option(id==='seriesField'&&v==='(none)'?'No series':id==='filterField'&&v==='(none)'?'No filter':label(v), v))); if(vals.includes(selected)) el.value=selected; }
function updateFilterValues(){ const f=$('filterField').value; fill('filterValue', f==='(none)' ? ['(all)'] : ['(all)', ...validValues(f)], '(all)'); }
function normalizeRows(input){ return (input||[]).map(r => Object.fromEntries(Object.entries(r).map(([k,v]) => [k, coerce(v)]))); }
function coerce(v){ if(typeof v === 'number') return v; if(typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v); return v; }
function numericFields(){ return fields.filter(f => rows.some(r => isNum(r[f]))); }
function dimensionFields(){ const nums = numericFields(); return fields.filter(f => !nums.includes(f) && validValues(f).length); }
function bestMetric(nums){ return ['revenue','profit','sales','amount','value','orders','count','spend'].find(f => nums.includes(f)) || nums[0]; }
function bestDim(dims){ return ['campaign','region','channel','product','segment','category','rep','month','date'].find(f => dims.includes(f)) || dims[0]; }
function validValues(field){ return uniq(rows.map(r => r[field]).filter(isPresent)); }
function visibleRows(){ const f=$('filterField').value, v=$('filterValue').value; filtered = f==='(none)' || v==='(all)' ? [...rows] : rows.filter(r => String(r[f]) === String(v)); return filtered; }
function applyActiveFilters(data){ return activeFilters.reduce((acc,f) => acc.filter(r => String(r[f.field]) === String(f.value)), data); }
function aggregate(){
  const x=$('xField').value, y=$('yField').value, s=$('seriesField').value, map=new Map();
  for(const r of applyActiveFilters(visibleRows())){
    if(!isPresent(r[x])) continue;
    const key = String(r[x]); const series = s==='(none)' ? 'Value' : (isPresent(r[s]) ? String(r[s]) : 'Unspecified'); const id = key+'|||'+series;
    if(!map.has(id)) map.set(id,{x:key,series,value:0,count:0,raw:r}); const o=map.get(id); o.value += Number(r[y]) || 0; o.count++;
  }
  return [...map.values()].sort((a,b) => a.x.localeCompare(b.x, undefined, {numeric:true}));
}
function render(){
  setActiveType();
  renderFilterChips();
  if(!rows.length){ showEmpty(); return; }
  const data = aggregate();
  const stage = $('chartStage'); stage.innerHTML='';
  const groupCount = Math.max(uniq(data.map(d=>d.x)).length, 1);
  const width = Math.max(920, groupCount * 96 + 180);
  stage.classList.toggle('wide', width > 980);
  const svg = svgEl('svg',{viewBox:`0 0 ${width} 560`,role:'img',width,height:560}); stage.appendChild(svg);
  if(activeType==='bar') drawBar(svg,data);
  else if(activeType==='horizontal') drawHorizontal(svg,data);
  else if(activeType==='line') drawLine(svg,data,false);
  else if(activeType==='area') drawLine(svg,data,true);
  else if(activeType==='donut') drawDonut(svg,data);
  else if(activeType==='scatter') drawScatter(svg,applyActiveFilters(visibleRows()));
  else if(activeType==='heatmap') drawHeatmap(svg,data);
  else drawKpi(svg,data);
}
function showEmpty(){ $('chartStage').innerHTML = `<div class="emptyState"><strong>Waiting for data</strong><span>This MCP visual renders only the dataset supplied by the tool call.</span></div>`; }
function showNoData(message){ $('chartTitle').textContent='No data supplied'; $('filterChips').innerHTML=''; $('chartStage').innerHTML = `<div class="emptyState"><strong>No dataset received</strong><span>${message}</span></div>`; }
function renderFilterChips(){
  const wrap = $('filterChips');
  wrap.innerHTML = activeFilters.map((f,i)=>`<span class="filterChip">${label(f.field)}: ${short(f.value,18)} <button aria-label="Remove filter" data-filter-index="${i}">×</button></span>`).join('');
  wrap.querySelectorAll('button').forEach(btn => btn.onclick = () => { const removed=activeFilters.splice(Number(btn.dataset.filterIndex),1)[0]; if(removed && $('filterField').value===removed.field && String($('filterValue').value)===String(removed.value)){ $('filterField').value='(none)'; updateFilterValues(); } render(); });
}
function addChartFilter(field,value){
  if(!isPresent(field)||!isPresent(value)) return;
  if(!activeFilters.some(f => f.field===field && String(f.value)===String(value))) activeFilters.push({field,value});
  if([...$('filterField').options].some(o=>o.value===field)){
    $('filterField').value = field;
    updateFilterValues();
    if([...$('filterValue').options].some(o=>String(o.value)===String(value))) $('filterValue').value = String(value);
  }
  render();
}
function plotWidth(svg){ return Number(svg.getAttribute('viewBox').split(' ')[2]); }
function frame(svg,max){ const right=plotWidth(svg)-60; for(let i=0;i<=4;i++){ const y=470-i*95; add(svg,'line',{x1:84,y1:y,x2:right,y2:y,class:'grid'}); add(svg,'text',{x:66,y:y+4,'text-anchor':'end',class:'text'},fmt(max*i/4)); } add(svg,'line',{x1:84,y1:470,x2:right,y2:470,class:'axis'}); }
function grouped(data){ const xs=uniq(data.map(d=>d.x)); return xs.map(x=>({x,value:data.filter(d=>d.x===x).reduce((a,d)=>a+d.value,0)})); }
function drawBar(svg,data){ const g=grouped(data), max=Math.max(...g.map(d=>d.value),1), right=plotWidth(svg)-80, span=right-110; frame(svg,max); const w=Math.min(86,span/Math.max(g.length,1)*.68); g.forEach((d,i)=>{ const x=110+i*(span/Math.max(g.length,1))+((span/Math.max(g.length,1))-w)/2, h=d.value/max*370, y=470-h; add(svg,'rect',{x,y,width:w,height:h,rx:16,fill:color(i),class:'mark',onclick:()=>addChartFilter($('xField').value,d.x),onmousemove:tip(`${d.x}: ${fmt(d.value)}<br>Click to filter`),onmouseleave:hideTip}); add(svg,'text',{x:x+w/2,y:Math.max(y-8,22),'text-anchor':'middle',class:'value'},fmt(d.value)); add(svg,'text',{x:x+w/2,y:502,'text-anchor':'middle',class:'text'},short(d.x,12)); }); }
function drawHorizontal(svg,data){ const g=grouped(data).slice(0,18), max=Math.max(...g.map(d=>d.value),1), right=plotWidth(svg)-80; g.forEach((d,i)=>{ const y=52+i*30; add(svg,'text',{x:170,y:y+18,'text-anchor':'end',class:'text'},short(d.x,16)); add(svg,'rect',{x:190,y,width:d.value/max*(right-220),height:18,rx:9,fill:color(i),class:'mark',onclick:()=>addChartFilter($('xField').value,d.x),onmousemove:tip(`${d.x}: ${fmt(d.value)}<br>Click to filter`),onmouseleave:hideTip}); add(svg,'text',{x:right,y:y+15,'text-anchor':'end',class:'value'},fmt(d.value)); }); }
function drawLine(svg,data,area){ const g=grouped(data), max=Math.max(...g.map(d=>d.value),1), right=plotWidth(svg)-70; frame(svg,max); const pts=g.map((d,i)=>[96+i*((right-96)/Math.max(g.length-1,1)),470-d.value/max*370]); if(area && pts.length) add(svg,'path',{d:`M ${pts[0][0]} 470 L `+pts.map(p=>p.join(' ')).join(' L ')+` L ${pts.at(-1)[0]} 470 Z`,fill:color(0),opacity:.16}); add(svg,'path',{d:'M '+pts.map(p=>p.join(' ')).join(' L '),fill:'none',stroke:color(0),'stroke-width':6,'stroke-linecap':'round','stroke-linejoin':'round'}); pts.forEach((p,i)=>add(svg,'circle',{cx:p[0],cy:p[1],r:7,fill:color(i),class:'mark',onclick:()=>addChartFilter($('xField').value,g[i].x),onmousemove:tip(`${g[i].x}: ${fmt(g[i].value)}<br>Click to filter`),onmouseleave:hideTip})); g.forEach((d,i)=>{ if(g.length<9 || i%Math.ceil(g.length/8)===0) add(svg,'text',{x:pts[i][0],y:512,'text-anchor':'middle',class:'text'},short(d.x,12)); }); }
function drawDonut(svg,data){ const g=grouped(data), total=g.reduce((a,d)=>a+d.value,0)||1, cx=plotWidth(svg)/2; let a0=-Math.PI/2; g.forEach((d,i)=>{ const a1=a0+d.value/total*Math.PI*2; add(svg,'path',{d:arc(cx,270,170,a0,a1,92),fill:color(i),class:'mark',onclick:()=>addChartFilter($('xField').value,d.x),onmousemove:tip(`${d.x}: ${fmt(d.value)}<br>Click to filter`),onmouseleave:hideTip}); a0=a1; }); add(svg,'text',{x:cx,y:282,'text-anchor':'middle',style:`font-size:44px;font-weight:720;fill:${css('--ink')}`},fmt(total)); g.slice(0,8).forEach((d,i)=>add(svg,'text',{x:40,y:70+i*22,class:'text'},`${short(d.x,14)} · ${Math.round(d.value/total*100)}%`)); }
function drawScatter(svg,data){ const nums=numericFields(), xf=nums.find(f=>f!==$('yField').value)||nums[0], yf=$('yField').value, dim=$('xField').value, right=plotWidth(svg)-70, maxX=Math.max(...data.map(r=>Number(r[xf])||0),1), maxY=Math.max(...data.map(r=>Number(r[yf])||0),1); frame(svg,maxY); data.slice(0,180).forEach((r,i)=>add(svg,'circle',{cx:90+(Number(r[xf])||0)/maxX*(right-90),cy:470-(Number(r[yf])||0)/maxY*370,r:7,fill:color(i),opacity:.78,class:'mark',onclick:()=>addChartFilter(dim,r[dim]),onmousemove:tip(`${dim}: ${r[dim]}<br>${xf}: ${fmt(r[xf])}<br>${yf}: ${fmt(r[yf])}<br>Click to filter`),onmouseleave:hideTip})); }
function drawHeatmap(svg,data){ const xs=uniq(data.map(d=>d.x)), ss=uniq(data.map(d=>d.series)), right=plotWidth(svg)-80, max=Math.max(...data.map(d=>d.value),1); xs.forEach((x,i)=>ss.forEach((s,j)=>{ const v=data.filter(d=>d.x===x&&d.series===s).reduce((a,d)=>a+d.value,0); add(svg,'rect',{x:100+i*((right-120)/xs.length),y:70+j*(380/ss.length),width:(right-150)/xs.length,height:340/ss.length,rx:14,fill:mix('#eef1f7',color(j),v/max),class:'mark',onclick:()=>addChartFilter($('xField').value,x),onmousemove:tip(`${x} / ${s}: ${fmt(v)}<br>Click to filter`),onmouseleave:hideTip}); })); xs.forEach((x,i)=>add(svg,'text',{x:110+i*((right-120)/xs.length),y:500,class:'text'},short(x,10))); }
function drawKpi(svg,data){ const total=data.reduce((a,d)=>a+d.value,0); add(svg,'text',{x:460,y:260,'text-anchor':'middle',style:`font-size:92px;font-weight:680;letter-spacing:-.08em;fill:${css('--ink')}`},fmt(total)); add(svg,'text',{x:460,y:315,'text-anchor':'middle',class:'text'},label($('yField').value)); }
function add(svg,tag,attrs,text){ const el=svgEl(tag,attrs); if(text) el.textContent=text; svg.appendChild(el); return el; }
function svgEl(tag,attrs={}){ const el=document.createElementNS('http://www.w3.org/2000/svg',tag); for(const [k,v] of Object.entries(attrs)){ if(k.startsWith('on')) el[k.toLowerCase()]=v; else el.setAttribute(k,v); } return el; }
function arc(cx,cy,r,a0,a1,inner){ const p=(a,rr)=>[cx+Math.cos(a)*rr,cy+Math.sin(a)*rr], [x0,y0]=p(a0,r), [x1,y1]=p(a1,r), [x2,y2]=p(a1,inner), [x3,y3]=p(a0,inner), large=a1-a0>Math.PI?1:0; return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`; }
function color(i){ return (palettes[$('palette').value]||palettes.Sphere)[i%(palettes[$('palette').value]||palettes.Sphere).length]; }
function tip(html){ return e=>{ const t=$('tooltip'); t.innerHTML=html; t.style.left=e.clientX+14+'px'; t.style.top=e.clientY+14+'px'; t.classList.remove('hidden'); }; }
function hideTip(){ $('tooltip').classList.add('hidden'); }
function css(name){ return getComputedStyle(document.body).getPropertyValue(name).trim(); }
function uniq(a){ return [...new Set(a.filter(isPresent))]; }
function isPresent(v){ return v!==undefined && v!==null && String(v).trim()!=='' && !['null','undefined','nan'].includes(String(v).toLowerCase()); }
function isNum(v){ return isPresent(v) && (typeof v==='number' || !Number.isNaN(Number(v))); }
function fmt(v){ const n=Number(v)||0; if(Math.abs(n)>=1e6)return '$'+(n/1e6).toFixed(1)+'M'; if(Math.abs(n)>=1e3)return '$'+Math.round(n/1e3)+'K'; return String(Math.round(n*10)/10); }
function label(s){ return String(s||'').replace(/[()]/g,'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); }
function short(s,n=12){ s=String(s); return s.length>n?s.slice(0,n-1)+'…':s; }
function mix(a,b,t){ const pa=parseInt(a.slice(1),16),pb=parseInt(b.slice(1),16),ar=[pa>>16&255,pa>>8&255,pa&255],br=[pb>>16&255,pb>>8&255,pb&255]; return '#'+ar.map((x,i)=>Math.round(x+(br[i]-x)*t).toString(16).padStart(2,'0')).join(''); }
