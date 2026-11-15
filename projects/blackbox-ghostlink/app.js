'use strict';
// No outside JS libraries, CDNs, telemetry services or remote fonts.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clean = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const state = { status:null, supplies:[], messages:[], knowledge:[], notes:[], waypoints:[], telemetry:[], events:[], checklist:[] };
let token = '';
try { token = sessionStorage.getItem('blackbox_access_token') || ''; } catch {}
let noticeTimer;
let tileZoom = null;
let tileObjectURLs=[];
let tileRequestGeneration=0;

function notice(message) {
  $('#notice').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('#notice').textContent = ''; }, 6500);
}
function authenticatedHeaders(extra={}) {
  return {...extra, ...(token ? {'Authorization':'Bearer ' + token} : {})};
}
async function api(path, method='GET', payload=null) {
  const options = {method, headers:authenticatedHeaders(payload===null ? {} : {'Content-Type':'application/json'})};
  if(payload!==null) options.body = JSON.stringify(payload);
  let response;
  try { response = await fetch('/api/' + path, options); }
  catch (error) { $('#api-state').textContent='DISCONNECTED'; throw Error('Local service unreachable: ' + error.message); }
  if(response.status===401) { $('#auth-gate').hidden=false; throw Error('Access token required or rejected'); }
  let data;
  try { data=await response.json(); }
  catch { throw Error('Unexpected server response'); }
  if(!response.ok) throw Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function fetchFile(path, filename) {
  const response = await fetch('/api/' + path, {headers:authenticatedHeaders()});
  if(response.status===401) {$('#auth-gate').hidden=false;throw Error('Access token required');}
  if(!response.ok) throw Error(`Could not export (${response.status})`);
  const blob=await response.blob(), url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function empty(text) {return `<div class="empty">${clean(text)}</div>`;}
function tag(text,className=''){return `<span class="tag ${className}">${clean(text)}</span>`;}
function record(title,body,meta='',buttons=''){
  return `<div class="record"><strong>${clean(title)}</strong><p>${clean(body)}</p><div>${meta}</div><div class="actions">${buttons}</div></div>`;
}
function button(label,action,id,extra='') {return `<button class="btn slim" data-action="${clean(action)}" data-id="${Number(id)}" ${extra}>${clean(label)}</button>`;}
function renderStatus(){
  const s=state.status;if(!s)return;
  $('#m-service').textContent='ONLINE';
  $('#m-radio').textContent=s.radio.state.replace(/-/g,' ').toUpperCase();
  $('#m-radio-caption').textContent=s.radio.enabled ? 'Physical link and delivery unverified' : 'Optional serial bridge disabled';
  $('#m-supplies').textContent=s.inventory.items;
  $('#m-low').textContent=s.inventory.below_minimum+' below minimum';
  $('#m-queued').textContent=s.pending_radio_messages;
  $('#m-review').textContent=s.messages_needing_manual_review+' require manual review';
  $('#radio-mini').textContent='RADIO: '+s.radio.state.toUpperCase();
  $('#radio-state').textContent='RADIO: '+s.radio.state.toUpperCase();
  $('#radio-state').className='chip '+(s.radio.state==='serial-connected-not-range-tested'?'warn':'error');
  $('#api-state').textContent='LOCAL ONLINE';
  $('#version-label').textContent='v'+s.version;
  $('#footerclock').textContent='Uptime: '+Math.floor(s.uptime_seconds/60)+' min';
  $('#components').innerHTML=[
    ['Inventory database',s.database==='online'?'LOCAL ONLINE':'ERROR',s.database==='online'?'good':'bad'],
    ['Knowledge search',s.assistant.search_available?'AVAILABLE':'UNAVAILABLE',s.assistant.search_available?'good':'bad'],
    ['LoRa / Meshtastic',s.radio.state.replace(/-/g,' '),s.radio.state==='serial-connected-not-range-tested'?'warn':'bad'],
    ['Home Assistant',s.home_assistant.configured?'CONFIGURED; NOT TESTED':'NOT CONFIGURED',s.home_assistant.configured?'warn':''],
    ['Offline local AI',s.assistant.local_model_configured?'MODEL CONFIGURED; NOT TESTED':'SEARCH ONLY',''],
    ['Geographical basemap',s.maps.mbtiles_configured?'LOCAL FILE CONFIGURED':'NOT LOADED',''],
    ['GPS receiver',s.maps.gps_receiver_connected?'CONNECTED':'NOT CONNECTED',''],
  ].map(([name,value,c])=>`<div class="statusrow"><b>${clean(name)}</b><span class="${c}">${clean(value)}</span></div>`).join('');
  $('#system-status').textContent=JSON.stringify(s,null,2);
}
function renderChecklist(){
  $('#readiness-list').innerHTML=state.checklist.map(x=>
    `<label><input type="checkbox" data-check="${x.id}" ${x.checked?'checked':''}> ${clean(x.title)}${x.checked_at?' <small class="muted">('+clean(x.checked_at)+')</small>':''}</label>`
  ).join('')||empty('No checklist tasks.');
}
function renderSupplies(){
  const items=state.supplies;
  $('#supply-summary').textContent=items.length+' item types';
  $('#supply-list').innerHTML=items.length?items.map(x=>{
    const low=Number(x.quantity)<Number(x.minimum), ex=x.expiry ? 'Expires '+x.expiry : 'No expiry recorded';
    const control=`<label class="muted caption">Update quantity <input aria-label="Quantity for ${clean(x.name)}" data-quantity="${x.id}" type="number" min="0" step="any" value="${x.quantity}" style="width:118px;display:inline-block;margin:0 7px;padding:6px;background:#091718;border:1px solid #4a625e;color:white;border-radius:6px"></label>`;
    return record(x.name,`${x.quantity} ${x.unit} · minimum ${x.minimum}\n${ex}${x.notes?'\n'+x.notes:''}`,
      low?tag('BELOW MINIMUM','low'):tag('Stored'),
      control+button('Save quantity','save-quantity',x.id)+button('Delete','delete-supplies',x.id));
  }).join(''):empty('No inventory recorded. Add verified actual supplies.');
}
function renderMessages(){
  $('#message-summary').textContent=state.messages.length+' recent messages';
  $('#message-list').innerHTML=state.messages.length?state.messages.map(x=>{
    const dest=x.direction==='incoming'?'From '+x.sender:'To '+x.recipient;
    const canRelease=x.direction==='outgoing' && ['local-only','failed','failed-transmission-uncertain','requires-manual-review','release-expired'].includes(x.status) && state.status?.radio.state==='serial-connected-not-range-tested';
    return record(dest,x.body,tag(x.status,x.status==='failed'?'low':'')+`<small>${clean(x.created)}${x.packet_id?' · Packet '+clean(x.packet_id):''}${x.error?' · '+clean(x.error):''}</small>`,
     (canRelease?button('Release to radio','release-message',x.id):'')+button('Delete','delete-messages',x.id));
  }).join(''):empty('No messages. Local messages will not be transmitted automatically.');
}
function renderKnowledge(){
  $('#knowledge-count').textContent=state.knowledge.length+' local documents';
  $('#knowledge-list').innerHTML=state.knowledge.map(x=>`<button class="doccard" data-doc="${clean(x.slug)}"><strong>${clean(x.title)}</strong><span>${clean(x.summary||'').replace(/^#[^\n]*\n/,'').slice(0,110)}...</span></button>`).join('')||empty('No files indexed.');
}
function showSearchResults(data) {
  const docs=data.results||[],sources=data.sources||[];
  let result=data.mode==='local-ollama'?`<div class="record"><strong>LOCAL MODEL RESPONSE</strong><p>${clean(data.answer)}</p><small>${clean(data.warning)}</small></div>`:'';
  if(data.mode==='offline-search' && !docs.length)result=empty('No indexed documents match those search terms.');
  result+=docs.map(x=>record(x.title,x.body.slice(0,1200),tag(x.slug),`<button class="btn slim" data-doc="${clean(x.slug)}">Read entire document</button>`)).join('');
  if(data.mode==='local-ollama')result+=`<div class="record"><small>Local references: ${sources.map(x=>clean(x.title)).join('; ')||'none'}</small></div>`;
  $('#knowledge-results').innerHTML=result;
}
function renderNotes(){
  $('#note-list').innerHTML=state.notes.length?state.notes.map(x=>record(x.title,x.body,`<small>${clean(x.created)}</small>`,button('Delete','delete-notes',x.id))).join(''):empty('No field notes yet.');
}
function renderWaypoints(){
  const points=state.waypoints;
  $('#waypoint-list').innerHTML=points.length?points.map(p=>record(p.name,`${Number(p.latitude).toFixed(6)}, ${Number(p.longitude).toFixed(6)}${p.notes?'\n'+p.notes:''}`,tag(p.category),button('Delete','delete-waypoints',p.id))).join(''):empty('No waypoints recorded.');
  if(!points.length){$('#point-plot').innerHTML='<div class="muted">No coordinates to plot.</div>';$('#tile-map-section').hidden=true;return;}
  const lat=points.map(p=>Number(p.latitude)), lon=points.map(p=>Number(p.longitude));
  const minLat=Math.min(...lat),maxLat=Math.max(...lat),minLon=Math.min(...lon),maxLon=Math.max(...lon);
  // True linear geographic coordinate plot, NOT an offline map.
  const lonRange=Math.max(maxLon-minLon,.002),latRange=Math.max(maxLat-minLat,.002);
  const markers=points.map(p=>{
    const x=30+(Number(p.longitude)-minLon)/lonRange*440;
    const y=230-(Number(p.latitude)-minLat)/latRange*190;
    return `<circle cx="${x}" cy="${y}" r="6" fill="#9ce1af" stroke="#133b31" stroke-width="2"><title>${clean(p.name)}</title></circle><text x="${Math.min(x+9,430)}" y="${Math.max(y-10,18)}" fill="#e4f4de" font-size="11">${clean(p.name.slice(0,18))}</text>`;
  }).join('');
  $('#point-plot').innerHTML=`<svg viewBox="0 0 510 260" role="img" aria-label="Relative coordinate plot of stored waypoints"><rect width="510" height="260" fill="transparent"/><path d="M30 20V230H480" fill="none" stroke="#53706c"/><text x="34" y="250" fill="#96b4ab" font-size="11">West ${minLon.toFixed(3)}°</text><text x="389" y="250" fill="#96b4ab" font-size="11">East ${maxLon.toFixed(3)}°</text><text x="31" y="15" fill="#96b4ab" font-size="11">N ${maxLat.toFixed(3)}°</text>${markers}</svg>`;
  $('#tile-map-section').hidden=!(state.status?.maps?.mbtiles_raster_usable);
  if(state.status?.maps?.mbtiles_raster_usable){
    if(tileZoom===null)tileZoom=Math.min(Math.max(12,state.status.maps.min_zoom),state.status.maps.max_zoom);
    // Runs after this tab becomes visible (hidden maps have no width).
    if($('#navigation').classList.contains('active'))renderOfflineTiles();
  }
}
function project(lat,lon,z){
  const zoom=2**z;
  const safeLat=Math.max(-85.0511,Math.min(85.0511,lat));
  const rad=safeLat*Math.PI/180;
  return {x:(lon+180)/360*zoom*256,
          y:(1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*zoom*256};
}
async function renderOfflineTiles(){
  const box=$('#tile-map'),points=state.waypoints,info=state.status?.maps;
  if(!box || !points.length || !info?.mbtiles_raster_usable)return;
  const generation=++tileRequestGeneration;
  tileObjectURLs.forEach(url=>URL.revokeObjectURL(url));tileObjectURLs=[];
  box.innerHTML='';
  tileZoom=Math.max(info.min_zoom,Math.min(info.max_zoom,tileZoom ?? info.max_zoom));
  $('#map-zoom-label').textContent='Z'+tileZoom;
  const center=project(Number(points[0].latitude),Number(points[0].longitude),tileZoom);
  const width=box.clientWidth || 500, height=box.clientHeight || 310, max=2**tileZoom;
  const x0=Math.floor((center.x-width/2)/256),x1=Math.floor((center.x+width/2)/256);
  const y0=Math.floor((center.y-height/2)/256),y1=Math.floor((center.y+height/2)/256);
  const tasks=[];
  for(let xt=x0;xt<=x1;xt++)for(let yt=y0;yt<=y1;yt++){
    if(yt<0||yt>=max)continue;
    const x=((xt%max)+max)%max;
    const left=xt*256-center.x+width/2,top=yt*256-center.y+height/2;
    tasks.push((async()=>{
      try{
        const res=await fetch(`/api/tiles/${tileZoom}/${x}/${yt}.png`,{headers:authenticatedHeaders()});
        if(!res.ok || tileRequestGeneration!==generation)return;
        const blob=await res.blob();
        if(tileRequestGeneration!==generation)return;
        const uri=URL.createObjectURL(blob);tileObjectURLs.push(uri);
        const img=document.createElement('img');img.src=uri;img.alt='Offline map tile';
        img.style.left=left+'px';img.style.top=top+'px';box.appendChild(img);
      }catch{}
    })());
  }
  await Promise.all(tasks);
  if(tileRequestGeneration!==generation)return;
  points.forEach(p=>{
    const q=project(Number(p.latitude),Number(p.longitude),tileZoom);
    const pin=document.createElement('span');pin.className='map-pin';pin.textContent=p.name;
    pin.style.left=(q.x-center.x+width/2)+'px';pin.style.top=(q.y-center.y+height/2)+'px';
    box.appendChild(pin);
  });
}
function renderTelemetry(){
  const rows=state.telemetry;
  $('#telemetry-list').innerHTML=rows.length?rows.map(n=>record(n.node_id,Object.entries(n.values).map(([k,v])=>`${k}: ${v}`).join('\n'),`<small>Received: ${clean(n.captured)}</small>`)).join(''):empty('No sensor devices have reported data. Firmware must be deployed and configured separately.');
}
function renderEvents(){
  $('#event-list').innerHTML=state.events.length?state.events.map(e=>record(e.source,e.detail,`<small>${clean(e.created)}</small>`)).join(''):empty('No system events recorded.');
}
async function refresh(){
  try{
    state.status=await api('status'); renderStatus();
    const keys=['supplies','messages','knowledge','notes','waypoints','telemetry','events','checklist'];
    const results=await Promise.all(keys.map(k=>api(k)));
    keys.forEach((k,i)=>state[k]=results[i]);
    renderSupplies();renderMessages();renderKnowledge();renderNotes();renderWaypoints();renderTelemetry();renderEvents();renderChecklist();
  }catch(err){notice(err.message);}
}
async function action(path,method='POST',payload=null){
  const res=await api(path,method,payload);await refresh();return res;
}
function submit(formId,path,format,success){
  $(formId).addEventListener('submit',async e=>{
    e.preventDefault();
    const data=Object.fromEntries(new FormData(e.target));
    try{await action(path,'POST',format?format(data):data);e.target.reset();notice(success);}catch(error){notice(error.message);}
  });
}
submit('#supply-form','supplies',x=>({...x,quantity:Number(x.quantity),minimum:Number(x.minimum||0)}),'Inventory saved locally.');
submit('#note-form','notes',null,'Field note saved locally.');
submit('#waypoint-form','waypoints',x=>({...x,latitude:Number(x.latitude),longitude:Number(x.longitude)}),'Waypoint stored locally.');
submit('#message-form','messages',x=>({recipient:$('#direct-node').value.trim() || x.recipient,body:x.body}),'Message stored LOCAL ONLY. No transmission occurred.');
$('#power-form').addEventListener('submit',async e=>{
  e.preventDefault();const v=Object.fromEntries(new FormData(e.target));
  try{
    const data=await api('power/estimate','POST',{
      capacity_wh:Number(v.capacity_wh),efficiency_percent:Number(v.efficiency_percent),
      reserve_percent:Number(v.reserve_percent),loads_w:{computer:Number(v.computer_w),radios:Number(v.radio_w),sensors:Number(v.sensor_w),other:Number(v.other_w)}
    });
    $('#power-results').innerHTML=`<div class="metric-grid" style="grid-template-columns:1fr 1fr"><div class="metric"><span>THEORETICAL RUNTIME</span><strong>${data.estimated_hours===null?'No load':clean(data.estimated_hours)+' h'}</strong></div><div class="metric"><span>USABLE ENERGY</span><strong>${clean(data.usable_wh)} Wh</strong></div><div class="metric"><span>CONTINUOUS LOAD</span><strong>${clean(data.total_load_w)} W</strong></div><div class="metric"><span>REQUIRED PER DAY</span><strong>${clean((data.total_load_w*24).toFixed(1))} Wh</strong></div></div><div class="inline-note">${clean(data.warning)}</div>`;
  }catch(err){notice(err.message);}
});
$('#readiness-list').addEventListener('change',async e=>{
  if(!e.target.matches('[data-check]'))return;
  try{await api('checklist/'+Number(e.target.dataset.check),'PATCH',{checked:e.target.checked});await refresh();notice('Readiness check recorded locally.');}
  catch(err){notice(err.message);await refresh();}
});
$('#message-form textarea[name="body"]').addEventListener('input',e=>{
  const length=new TextEncoder().encode(e.target.value).length;
  $('#message-bytes').textContent=length+' / 180 bytes';
  $('#message-bytes').className=length>180?'bad':'muted';
});
$('#knowledge-form').addEventListener('submit',async e=>{
  e.preventDefault();const f=Object.fromEntries(new FormData(e.target));
  try { showSearchResults(await api('assistant','POST',{question:f.question,use_model:!!f.use_model})); }
  catch(err){notice(err.message);}
});
$('#auth-form').addEventListener('submit',async e=>{
  e.preventDefault();token=$('#token-field').value.trim();
  try{await api('status');try { sessionStorage.setItem('blackbox_access_token',token); } catch {}$('#auth-gate').hidden=true;await refresh();notice('Access token accepted.');}
  catch(err){notice(err.message);}
});
$$('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{
  $$('[data-tab]').forEach(x=>x.classList.toggle('active',x===btn));
  $$('.page').forEach(x=>x.classList.toggle('active',x.id===btn.dataset.tab));
  $('#page-title').textContent=btn.textContent.trim();
  if(btn.dataset.tab==='system' || btn.dataset.tab==='sensors')refresh();
  if(btn.dataset.tab==='navigation')renderOfflineTiles();
}));
document.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action], [data-doc]');if(!btn)return;
  if(btn.dataset.doc){
    try{
      const doc=await api('knowledge/'+encodeURIComponent(btn.dataset.doc));
      $('#knowledge-results').innerHTML=record(doc.title,doc.body,tag(doc.slug));
      $$('[data-tab]').find(x=>x.dataset.tab==='knowledge').click();
      $('#knowledge-results').scrollIntoView({behavior:'smooth'});
    }catch(err){notice(err.message);}
    return;
  }
  const act=btn.dataset.action, id=Number(btn.dataset.id);
  try{
    if(act.startsWith('delete-')){
      if(!confirm('Permanently delete this local record?'))return;
      await action(act.slice(7)+'/'+id,'DELETE');notice('Record removed.');
    }else if(act==='save-quantity'){
      const field=$(`[data-quantity="${id}"]`),num=Number(field?.value);
      if(!field || !Number.isFinite(num) || num<0)throw Error('Enter a valid non-negative quantity');
      await action('supplies/'+id,'PATCH',{quantity:num});notice('Quantity updated.');
    }else if(act==='release-message'){
      const record=state.messages.find(m=>m.id===id);
      const uncertain=record && ['failed-transmission-uncertain','requires-manual-review','release-expired'].includes(record.status);
      const warning=uncertain?'Previous transmission outcome is UNKNOWN; resending could create a duplicate. Release again anyway?':'Release this message to the connected radio? Transmission cannot be recalled.';
      if(!confirm(warning))return;
      const result=await action('messages/'+id+'/release','POST',{});
      notice(result.queued_for_radio?'Released for radio bridge submission (delivery not confirmed).':'No eligible message to release.');
    }
  }catch(err){notice(err.message);}
});
$('#refresh-btn').addEventListener('click',refresh);
$('#map-zoom-in').addEventListener('click',()=>{tileZoom=(tileZoom??12)+1;renderOfflineTiles();});
$('#map-zoom-out').addEventListener('click',()=>{tileZoom=(tileZoom??12)-1;renderOfflineTiles();});
$('#backup-btn').addEventListener('click',()=>fetchFile('backup','blackbox-backup.sqlite3').catch(e=>notice(e.message)));
$('#report-btn').addEventListener('click',()=>fetchFile('field-report','blackbox-field-report.html').catch(e=>notice(e.message)));
$('#lock-btn').addEventListener('click',()=>{token='';try{sessionStorage.removeItem('blackbox_access_token');}catch{}$('#token-field').value='';$('#auth-gate').hidden=false;});
$('#ha-refresh').addEventListener('click',async()=>{
  try{
    const r=await api('homeassistant');
    $('#ha-status').innerHTML=!r.configured?empty(r.message):r.entities.length?r.entities.map(e=>record(e.name,e.entity_id,tag(e.state))).join(''):empty('Connected but no permitted entities returned.');
  }catch(error){$('#ha-status').innerHTML=empty(error.message);}
});
$('#geojson-link').addEventListener('click',e=>{e.preventDefault();fetchFile('waypoints.geojson','blackbox-waypoints.geojson').catch(err=>notice(err.message));});
$('#gpx-link').addEventListener('click',e=>{e.preventDefault();fetchFile('waypoints.gpx','blackbox-waypoints.gpx').catch(err=>notice(err.message));});
refresh();
