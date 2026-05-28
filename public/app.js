const API_BASE = window.API_BASE || '';
const IS_EMBED = !!window.IS_MCP_EMBED;
let rows = [], fields = [], filtered = [];
let activeType = 'bar';
let activeFilters = [];
let activeVisualId = null;
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
  ['xField','yField','seriesField','filterField','filterValue','palette'].forEach(id => $(id).addEventListener('input', () => { if(id==='filterField') updateFilterValues(); render(); updateHostContext(); }));
}
function buildTypeBar(){
  $('chartTypeBar').innerHTML = chartTypes.map(([type,label,icon]) => `<button class="typeButton" data-type="${type}" title="${label}" aria-label="${label}">${icon}</button>`).join('');
  [...document.querySelectorAll('.typeButton')].forEach(btn => btn.onclick = () => { activeType = btn.dataset.type; render(); updateHostContext(); });
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
    app.ontoolresult = result => { ingestHostPayload(result); updateHostContext(); };
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
  activeVisualId = payload.visualId || null;
  fields = Object.keys(rows[0] || {});
  if(!rows.length){ showEmpty(); return; }
  hydrateControls(payload.config || payload);
  const y = $('yField').value, x = $('xField').value;
  $('chartTitle').textContent = payload.title || smartTitle(payload.topic, x, y);
  render();
  updateHostContext();
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
  const seriesCount = Math.max(uniq(data.map(d=>d.series)).length, 1);
  const dims = chartDimensions(activeType, groupCount, seriesCount);
  setScrollMode(stage, dims.scroll);
  const svg = svgEl('svg',{viewBox:`0 0 ${dims.width} ${dims.height}`,role:'img',width:dims.width,height:dims.height}); stage.appendChild(svg);
  if(activeType==='bar') drawBar(svg,data);
  else if(activeType==='horizontal') drawHorizontal(svg,data);
  else if(activeType==='line') drawLine(svg,data,false);
  else if(activeType==='area') drawLine(svg,data,true);
  else if(activeType==='donut') drawDonut(svg,data);
  else if(activeType==='scatter') drawScatter(svg,applyActiveFilters(visibleRows()));
  else if(activeType==='heatmap') drawHeatmap(svg,data);
  else drawKpi(svg,data);
}
function chartDimensions(type, groups, series){
  if(type === 'horizontal') return { width: 920, height: Math.max(560, groups * 38 + 110), scroll: groups > 11 ? 'y' : 'none' };
  if(['donut','kpi'].includes(type)) return { width: 920, height: 560, scroll: 'none' };
  if(type === 'heatmap') return { width: Math.max(920, groups * 78 + 190), height: Math.max(560, series * 52 + 170), scroll: groups > 9 && series > 7 ? 'both' : groups > 9 ? 'x' : series > 7 ? 'y' : 'none' };
  if(type === 'scatter') return { width: 920, height: 560, scroll: 'none' };
  return { width: Math.max(920, groups * 96 + 180), height: 560, scroll: groups > 8 ? 'x' : 'none' };
}
function setScrollMode(stage, mode){
  stage.classList.remove('scrollX','scrollY','scrollBoth','noScroll','wide');
  stage.classList.add(mode === 'x' ? 'scrollX' : mode === 'y' ? 'scrollY' : mode === 'both' ? 'scrollBoth' : 'noScroll');
  stage.classList.toggle('wide', mode === 'x' || mode === 'both');
  stage.scrollLeft = 0; stage.scrollTop = 0;
}
function updateHostContext(){
  try{
    if(!window.analyticsMcpApp?.updateModelContext || !rows.length) return;
    window.analyticsMcpApp.updateModelContext({
      content:[{type:'text',text:`Analytics Studio visual ${activeVisualId || ''}: ${$('chartTitle').textContent}. To revise this chart, call analytics_studio again with the same dataset and updated chart/config rather than creating a separate unrelated visual.`}],
      structuredContent:{visualId:activeVisualId,title:$('chartTitle').textContent,chartType:activeType,xField:$('xField').value,yField:$('yField').value,filters:activeFilters,rowCount:rows.length}
    }).catch(()=>{});
  }catch(e){}
}
function smartTitle(topic,x,y){
  const t=String(topic||'').trim();
  if(t && !/^ad hoc analytics$/i.test(t)) return label(t).slice(0,80);
  return `${label(y)} by ${label(x)}`;
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
function drawHorizontal(svg,data){ const g=grouped(data), max=Math.max(...g.map(d=>d.value),1), right=plotWidth(svg)-80; g.forEach((d,i)=>{ const y=52+i*38; add(svg,'text',{x:170,y:y+22,'text-anchor':'end',class:'text'},short(d.x,16)); add(svg,'rect',{x:190,y,width:d.value/max*(right-245),height:22,rx:11,fill:color(i),class:'mark',onclick:()=>addChartFilter($('xField').value,d.x),onmousemove:tip(`${d.x}: ${fmt(d.value)}<br>Click to filter`),onmouseleave:hideTip}); add(svg,'text',{x:Math.min(190+d.value/max*(right-245)+12,right),y:y+17,class:'value'},fmt(d.value)); }); }
function drawLine(svg,data,area){ const g=grouped(data), max=Math.max(...g.map(d=>d.value),1), right=plotWidth(svg)-70; frame(svg,max); const pts=g.map((d,i)=>[96+i*((right-96)/Math.max(g.length-1,1)),470-d.value/max*370]); if(area && pts.length) add(svg,'path',{d:`M ${pts[0][0]} 470 L `+pts.map(p=>p.join(' ')).join(' L ')+` L ${pts.at(-1)[0]} 470 Z`,fill:color(0),opacity:.16}); add(svg,'path',{d:'M '+pts.map(p=>p.join(' ')).join(' L '),fill:'none',stroke:color(0),'stroke-width':6,'stroke-linecap':'round','stroke-linejoin':'round'}); pts.forEach((p,i)=>{ add(svg,'circle',{cx:p[0],cy:p[1],r:7,fill:color(i),class:'mark',onclick:()=>addChartFilter($('xField').value,g[i].x),onmousemove:tip(`${g[i].x}: ${fmt(g[i].value)}<br>Click to filter`),onmouseleave:hideTip}); if(g.length<=18 || i%Math.ceil(g.length/12)===0) add(svg,'text',{x:p[0],y:Math.max(p[1]-14,24),'text-anchor':'middle',class:'value'},fmt(g[i].value)); }); g.forEach((d,i)=>{ if(g.length<9 || i%Math.ceil(g.length/8)===0) add(svg,'text',{x:pts[i][0],y:512,'text-anchor':'middle',class:'text'},short(d.x,12)); }); }
function drawDonut(svg,data){ const g=grouped(data), total=g.reduce((a,d)=>a+d.value,0)||1, cx=plotWidth(svg)/2; let a0=-Math.PI/2; g.forEach((d,i)=>{ const a1=a0+d.value/total*Math.PI*2, mid=(a0+a1)/2; add(svg,'path',{d:arc(cx,270,170,a0,a1,92),fill:color(i),class:'mark',onclick:()=>addChartFilter($('xField').value,d.x),onmousemove:tip(`${d.x}: ${fmt(d.value)}<br>Click to filter`),onmouseleave:hideTip}); if(d.value/total>.06){ const lx=cx+Math.cos(mid)*218, ly=270+Math.sin(mid)*218; add(svg,'text',{x:lx,y:ly,'text-anchor':lx<cx?'end':'start',class:'value'},`${fmt(d.value)} · ${Math.round(d.value/total*100)}%`); } a0=a1; }); add(svg,'text',{x:cx,y:282,'text-anchor':'middle',style:`font-size:44px;font-weight:720;fill:${css('--ink')}`},fmt(total)); g.slice(0,8).forEach((d,i)=>add(svg,'text',{x:40,y:70+i*22,class:'text'},`${short(d.x,14)} · ${fmt(d.value)}`)); }
function drawScatter(svg,data){ const nums=numericFields(), xf=nums.find(f=>f!==$('yField').value)||nums[0], yf=$('yField').value, dim=$('xField').value, right=plotWidth(svg)-70, maxX=Math.max(...data.map(r=>Number(r[xf])||0),1), maxY=Math.max(...data.map(r=>Number(r[yf])||0),1); frame(svg,maxY); data.slice(0,80).forEach((r,i)=>{ const cx=90+(Number(r[xf])||0)/maxX*(right-90), cy=470-(Number(r[yf])||0)/maxY*370; add(svg,'circle',{cx,cy,r:7,fill:color(i),opacity:.78,class:'mark',onclick:()=>addChartFilter(dim,r[dim]),onmousemove:tip(`${dim}: ${r[dim]}<br>${xf}: ${fmt(r[xf])}<br>${yf}: ${fmt(r[yf])}<br>Click to filter`),onmouseleave:hideTip}); if(i<30) add(svg,'text',{x:cx+10,y:cy-8,class:'value'},fmt(r[yf])); }); }
function drawHeatmap(svg,data){ const xs=uniq(data.map(d=>d.x)), ss=uniq(data.map(d=>d.series)), right=plotWidth(svg)-80, height=Number(svg.getAttribute('viewBox').split(' ')[3]), max=Math.max(...data.map(d=>d.value),1), cellW=(right-150)/xs.length, cellH=(height-170)/ss.length; xs.forEach((x,i)=>ss.forEach((s,j)=>{ const v=data.filter(d=>d.x===x&&d.series===s).reduce((a,d)=>a+d.value,0), x0=100+i*((right-120)/xs.length), y0=70+j*cellH; add(svg,'rect',{x:x0,y:y0,width:cellW,height:cellH-6,rx:14,fill:mix('#eef1f7',color(j),v/max),class:'mark',onclick:()=>addChartFilter($('xField').value,x),onmousemove:tip(`${x} / ${s}: ${fmt(v)}<br>Click to filter`),onmouseleave:hideTip}); add(svg,'text',{x:x0+cellW/2,y:y0+cellH/2+4,'text-anchor':'middle',class:'value'},fmt(v)); })); xs.forEach((x,i)=>add(svg,'text',{x:110+i*((right-120)/xs.length),y:height-35,class:'text'},short(x,10))); ss.forEach((s,j)=>add(svg,'text',{x:82,y:82+j*cellH,'text-anchor':'end',class:'text'},short(s,12))); }
function drawKpi(svg,data){ const total=data.reduce((a,d)=>a+d.value,0), g=grouped(data).sort((a,b)=>b.value-a.value).slice(0,3); add(svg,'text',{x:460,y:245,'text-anchor':'middle',style:`font-size:92px;font-weight:680;letter-spacing:-.08em;fill:${css('--ink')}`},fmt(total)); add(svg,'text',{x:460,y:300,'text-anchor':'middle',class:'text'},`Total ${label($('yField').value)}`); g.forEach((d,i)=>add(svg,'text',{x:460,y:340+i*28,'text-anchor':'middle',class:'value'},`${short(d.x,18)} · ${fmt(d.value)}`)); }
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
