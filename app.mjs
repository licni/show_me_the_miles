import {apiFetch} from './pages/client.mjs?v=shards-2';
import {tm,ll,formatM} from './coordinates.mjs';
import {recognizeInput,offsetLocation,createLiveTracker} from './location-tools.mjs';
import {exportMapImage} from './map-export.mjs';
import {recognizeLocations,parseStake} from './segment-parser.mjs';
import {adminArea,loadAdminAreas} from './admin-areas.mjs';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatRoad=road=>/^台\d/.test(road)?`${road}線`:road;
const latlng=p=>[p[1],p[0]];
let ready=false,map,selection,markerLayer,accuracy=null,currentCopy='',sequence=0;
let mapSequence=0,roadLines=[],availableRoads=[],roadsBusy=false,roadStatusTimer=null;
let gpsLayer=null,gpsDot=null,latestGps=null;
let tracking=null,multiLayer=null,multiItems=[],multiSequence=0,coverageSequence=0,exportNotes=[];
let adminTable=null;
// 管養工務段與鄉鎮村里; a segment lists start and end when they differ.
function areaText(road,from,to=from){
  const a=adminArea(adminTable,road,from)?.text,b=adminArea(adminTable,road,to)?.text;
  return a&&b&&a!==b?`${a} → ${b}`:a||b||'';
}
const areaMarkup=(road,from,to=from)=>`<p id="result-admin" class="result-admin" data-road="${esc(road)}" data-from="${from}" data-to="${to}">${esc(areaText(road,from,to))}</p>`;
// The table loads after the first result on a slow connection; fill it in then.
function refreshArea(){
  const el=$('result-admin');if(!el||el.textContent)return;
  const text=areaText(el.dataset.road,Number(el.dataset.from),Number(el.dataset.to));
  if(text){el.textContent=text;exportNotes.splice(1,0,text);}
}

function message(text,tone='warning'){
  $('message').textContent=text;
  $('message').dataset.tone=tone;
  $('message').hidden=!text;
  $('idle').hidden=!!text||!$('result').hidden;
}
function clear({preserveScroll=false}={}){
  currentCopy='';exportNotes=[];
  $('result').hidden=true;
  $('result').replaceChildren();
  selection?.clearLayers();
  message('');
  if(!preserveScroll)document.querySelector('aside').scrollTop=0;
}
async function query(body){
  const response=await apiFetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'查詢失敗，請稍後再試。');
  return data.results;
}
function dot(xy,color,text,r=7){
  return L.circleMarker(latlng(ll(...xy)),{radius:r,color:'#fff',weight:2,fillColor:color,fillOpacity:1}).bindPopup(text,{autoPan:false,className:'map-point-popup',offset:[0,-12]}).addTo(selection);
}
const nearbyEndpoint=r=>!Number.isFinite(r.m)&&Number.isFinite(r.nearbyEndpoint?.m)?r.nearbyEndpoint:null;
const exactMarker=r=>!!r.marker&&!r.marker.corrected;
const mileageLabel=r=>Number.isFinite(r.m)?`${exactMarker(r)?'':'約'}${formatM(r.m)}`:nearbyEndpoint(r)?`最近樁號 ${formatM(r.nearbyEndpoint.m)}`:'暫無樁號';
function resultPresentation(r,road=r.road){
  if(!Number.isFinite(r.m))return {kind:nearbyEndpoint(r)?'資料端點附近':r.notice==='gap'?'資料缺口':r.distanceKind==='endpoint'?'資料端點':'僅參考線',description:''};
  if(r.marker?.corrected)return {kind:'修正樁位',description:'來源表此樁座標與前後樁號矛盾，改依道路中心線及同向前後樁位置推估。'};
  if(r.marker)return {kind:'資料點',description:''};
  if(r.sourceKind==='province-centerline')return {kind:r.centerlineExtrapolation?'中心線末段推估':'共用中心線推估',description:r.centerlineExtrapolation?'依同道路既有樁位校準，沿道路中心線推估末段樁號。':'雙向共用道路中心線與樁號，橫向偏移不加入里程。'};
  if(r.sourceKind==='province-ramp-estimate')return {kind:'引道對應主線推估',description:'依引道兩端對應主線里程連續內插，引道長度不另加至樁號。'};
  if(r.sourceKind==='county-endpoint-estimate'){
    const extension=r.endpointExtension;
    const direction=extension?.basis==='road-shape'?'沿線延伸':extension?.basis==='road-shape+tangent'?'線形及方向延伸':'方向延伸';
    const description=extension&&Number.isFinite(extension.fromM)&&Number.isFinite(extension.along)?`原端點 ${formatM(extension.fromM)} ${extension.side==='start'?'−':'＋'} ${direction} ${extension.along.toFixed(1)} 公尺。`:'';
    return {kind:'端點延伸推估',description};
  }
  if(r.sourceKind==='county-road-shape-estimate')return {kind:'道路線形推估',description:'沿道路線形，以前後樁號校準里程。'};
  if(r.sourceKind==='county-bend-estimate')return {kind:'轉角推估（備用）',description:'無可用道路線形，依前後樁位推估轉角與里程。'};
  if(r.sourceKind==='county-gap-estimate')return {kind:'缺點推估',description:'依缺點兩側有效樁位推估。'};
  if(r.sourceKind==='county50')return {kind:'樁位內插推估',description:'無可用道路線形，依相鄰樁位直線內插。'};
  // Province estimates use source geometry; their internal sourceKind is not exposed by the API.
  if(/^台\d/.test(road))return {kind:'道路線形推估',description:'沿道路線形，以參考樁號校準里程。'};
  return {kind:'推估',description:''};
}
const choicesMarkup=choices=>choices.length>1?'<div class="road-choices" role="group" aria-label="附近道路選擇"><span class="choice-label">附近道路，點選切換</span><div id="alternatives" class="alternatives"></div></div>':'';
function renderChoices(choices,selectedResult,road,input){
  if(choices.length<2)return;
  for(const a of choices){
    const b=document.createElement('button'),selected=a===selectedResult;
    b.type='button';b.className='road-choice';b.setAttribute('aria-pressed',String(selected));
    const name=a.road||road,hasM=Number.isFinite(a.m),classification=resultPresentation(a,name);
    const extensionSuffix=a.sourceKind==='county-endpoint-estimate'&&Number.isFinite(a.endpointExtension?.along)?` · 延伸 ${a.endpointExtension.along.toFixed(1)} 公尺`:'';
    const kindSuffix=(hasM?` · ${classification.kind}`:nearbyEndpoint(a)?' · 資料端點附近':a.notice==='gap'?' · 資料缺口':'')+extensionSuffix;
    b.innerHTML=`<span class="choice-main"><strong>${esc(formatRoad(name))} · ${mileageLabel(a)}</strong><span class="choice-state">${selected?'已選':''}</span></span><span class="choice-distance">${a.d!=null?(a.distanceKind==='endpoint'?'距資料端點 ':a.distanceKind==='mainline-offset'?'距主線對應位置 ':'水平距離 ')+a.d.toFixed(1)+' 公尺':(hasM?'樁號對應位置':'僅有道路參考線')}${kindSuffix}</span><span class="choice-coordinates">X ${a.xy[0].toFixed(3)} · Y ${a.xy[1].toFixed(3)}</span>`;
    b.onclick=()=>showResult(a,name,input,choices,true);
    $('alternatives').append(b);
  }
}
function showRoadPicker(choices,input,keepView){
  currentCopy='';
  $('idle').hidden=true;
  $('result').hidden=false;
  $('result').innerHTML=`<span class="result-label">上次查詢結果</span><div class="result-main"><strong class="mileage">請選擇道路</strong></div><p class="result-meta">附近有不同道路，請選擇要查詢的道路。</p>${choicesMarkup(choices)}`;
  renderChoices(choices,null,'',input);
  if(map){
    selection.clearLayers();
    dot(input,'#8b687b','上次查詢位置');
    if(accuracy!==null)L.circle(latlng(ll(...input)),{radius:accuracy,color:'#397ec1',weight:1,fillOpacity:.06}).addTo(selection);
    if(!keepView)map.setView(latlng(ll(...input)),Math.max(18,map.getZoom()));
  }
}
function showResult(r,road,input=null,choices=[],keepView=false){
  const areaM=Number.isFinite(r.m)?r.m:nearbyEndpoint(r)?.m,area=Number.isFinite(areaM)?areaText(road,areaM):'';
  exportNotes=[`${formatRoad(road)} ${mileageLabel(r)}${r.side?' · '+r.side.label+'（側別示意）':''}`,...(area?[area]:[]),...(r.side?[r.side.note,'導航與複製連結使用原樁號位置，未含側向偏移。']:[])];
  if(Number.isFinite(r.m))$('offset-base').value=`${formatRoad(road)} ${formatM(r.m)}`;
  const exact=exactMarker(r),hasMileage=Number.isFinite(r.m),endpoint=nearbyEndpoint(r),point=r.xy,coords=ll(...point),refs=r.refs||[];
  const mileageText=mileageLabel(r);
  const notices={gap:'附近樁號資料有缺口，無法確認此處里程。',range:'此處超出里程資料範圍，顯示最近有效資料點。','reference-end':'此處位於參考線端點外，尚無可用樁號。'};
  const {kind,description}=resultPresentation(r,road);
  currentCopy=`https://www.google.com/maps?q=${coords[1].toFixed(7)},${coords[0].toFixed(7)}`;
  const meta=[];
  if(r.side)meta.push(esc(r.side.label)+'（側別示意）；'+esc(r.side.note)+' 導航與複製連結仍為原樁號位置。');
  if(accuracy!==null)meta.push(`定位精度約 ±${Math.round(accuracy)} 公尺`);
  if(input&&r.d!=null)meta.push(`${r.distanceKind==='endpoint'?'距最近資料端點':r.distanceKind==='mainline-offset'?'距主線對應位置':'水平投影距離'} ${r.d.toFixed(1)} 公尺`);
  $('idle').hidden=true;
  $('result').hidden=false;
  $('result').innerHTML=`
    <span class="result-label">上次查詢結果</span>
    <div class="result-main"><span class="route-name">${esc(formatRoad(road))}</span><strong class="mileage${hasMileage||endpoint?'':' unavailable'}">${hasMileage?`${exact?'':'<small>約</small>'}${formatM(r.m)}`:endpoint?`<small>最近樁號</small>${formatM(endpoint.m)}`:'暫無樁號'}</strong><span class="result-kind">${kind}</span></div>
    ${Number.isFinite(areaM)?areaMarkup(road,areaM):''}
    ${meta.length?`<p class="result-meta">${meta.join(' · ')}</p>`:''}
    ${!hasMileage?`<p class="result-unavailable">${endpoint?'顯示最近資料端點的樁號，尚無此位置的里程。':notices[r.notice]||'這條道路目前僅有參考線，尚無可用樁號。'}</p>`:description?`<p class="result-meta">${description}</p>`:''}
    ${choicesMarkup(choices)}
    <div class="result-actions"><a href="https://www.google.com/maps/dir/?api=1&destination=${coords[1]},${coords[0]}" target="_blank" rel="noopener">開啟導航 ↗</a><button id="copy" type="button">複製連結</button><button id="show-coordinates" type="button" aria-expanded="false" aria-controls="result-coordinates">查看座標</button></div>
    <p id="result-coordinates" class="coordinates" hidden>TWD97 X：${point[0].toFixed(3)}　Y：${point[1].toFixed(3)}<br>經緯度：${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}</p>`;
  $('show-coordinates').onclick=()=>{const open=$('result-coordinates').hidden;$('result-coordinates').hidden=!open;$('show-coordinates').setAttribute('aria-expanded',String(open));};
  $('copy').onclick=async()=>{
    const button=$('copy'),link=currentCopy;
    try{await navigator.clipboard.writeText(link);if(button.isConnected)button.textContent='已複製連結';}
    catch{
      if(!button.isConnected)return;
      let field=$('share-link');
      if(!field){field=document.createElement('input');field.id='share-link';field.readOnly=true;field.setAttribute('aria-label','分享連結');$('result').append(field);}
      field.value=link;field.focus();field.select();message('請長按下方連結複製，再貼到 LINE 或通訊軟體。');
    }
  };
  renderChoices(choices,r,road,input);
  if(map){
    selection.clearLayers();
    if(r.line)L.polyline(r.line.ll.map(latlng),{color:'#24766a',weight:5,opacity:.75,...(r.sourceKind==='county-endpoint-estimate'?{dashArray:'8 5'}:{})}).addTo(selection);
    for(const p of refs)dot(p.marker.xy,'#53614e',`參考 ${formatM(p.marker.m)}`,5);
    if(input){
      dot(input,'#8b687b','上次查詢位置');
      L.polyline([latlng(ll(...input)),latlng(coords)],{color:'#397ec1',weight:2,dashArray:'5 5'}).addTo(selection);
      if(accuracy!==null)L.circle(latlng(ll(...input)),{radius:accuracy,color:'#397ec1',weight:1,fillOpacity:.06}).addTo(selection);
    }
    dot(r.side?.ll?tm(...r.side.ll):point,'#df8c33',`${esc(formatRoad(road))} ${mileageText}${r.side?' · '+r.side.label:''}`,9).openPopup();
    if(!keepView)map.setView(latlng(input?ll(...input):coords),Math.max(18,map.getZoom()));
  }
}

async function positionQuery(xy,{keepView=false,keepTracking=false,isCurrent=()=>true}={}){
  if(!keepTracking)stopLiveTracking();
  const requestId=++sequence;clear({preserveScroll:keepTracking});
  if(!ready){message('查詢服務連線中，請稍候。','busy');return;}
  if(!xy.every(Number.isFinite)||!(xy[0]>100000&&xy[0]<400000&&xy[1]>2300000&&xy[1]<3000000)){
    message('請確認 TWD97／121°分帶座標，X、Y 不要顛倒。');return;
  }
  try{
    message('正在查詢樁號…','busy');
    // GPS fixes never call this function; only explicit user lookups do.
    const candidates=await query({mode:'position',xy,road:''});
    if(requestId!==sequence||!isCurrent())return;
    message('');
    if(!candidates.length){
      message('這個位置暫無可用樁號，可能超出資料範圍、落在缺點區間，或距參考線超過 60 公尺。');
      if(map){dot(xy,'#8b687b','上次查詢位置：暫無可用樁號');if(!keepView)map.setView(latlng(ll(...xy)),Math.max(18,map.getZoom()));}
      return;
    }
    if(candidates.length>1&&candidates.some(r=>nearbyEndpoint(r)||r.sourceKind==='county-endpoint-estimate'))showRoadPicker(candidates,xy,keepView);
    else{
      const first=candidates[0];
      showResult(first,first.road,xy,candidates,keepView);
    }
    if(accuracy!==null&&accuracy>50)message('目前定位精度較低，請至開闊處重新定位。');
  }catch(e){if(requestId===sequence&&isCurrent())message(e.message||'查詢失敗，請稍後再試。');}
}

$('position-form').onsubmit=e=>{
  e.preventDefault();accuracy=null;
  const xy=[Number($('x').value),Number($('y').value)];
  document.activeElement?.blur();$('coordinate-entry').open=false;
  positionQuery(xy);
};
$('mile-form').onsubmit=async (e,side)=>{
  e.preventDefault();stopLiveTracking();accuracy=null;
  const requestId=++sequence;clear();document.activeElement?.blur();
  const road=$('road').value;
  if(!road){message('請先選擇要查詢的道路。');return;}
  try{
    const blank=!$('stake-km').value.trim()&&!$('stake-m').value.trim();
    const km=$('stake-km').value.trim()||'0',metres=$('stake-m').value.trim()||'0';
    if(!/^\d{1,3}$/.test(km)||!/^\d{1,3}$/.test(metres))throw Error('公里與公尺請輸入整數；公尺範圍為0至999。');
    const m=Number(km)*1000+Number(metres);
    if(m>600000)throw Error('樁號超出支援範圍，請輸入600K+000以內的里程。');
    // Keep automatic-start fields blank so changing roads also queries its own start.
    if(!blank){$('stake-km').value=String(Number(km));$('stake-m').value=String(Number(metres)).padStart(3,'0');}
    message('正在查詢位置…','busy');
    const body=blank?{mode:'mile',road,start:true}:{mode:'mile',road,m};
    if(side)body.side=side;
    const rs=await query(body);
    if(requestId!==sequence)return;
    message('');
    if(!rs.length){message('這個樁號暫無可用資料，請確認道路與樁號，或改查附近位置。');return;}
    const choices=[rs[0],...rs.slice(1).filter(x=>Math.hypot(x.xy[0]-rs[0].xy[0],x.xy[1]-rs[0].xy[1])>40)];
    showResult(rs[0],road,null,choices);
  }catch(e){if(requestId===sequence)message(e.message||'查詢失敗，請稍後再試。');}
};
$('gps').onclick=async()=>{
  document.activeElement?.blur();clear();const gpsRequestId=++sequence;$('coordinate-entry').open=false;
  if(!navigator.geolocation){message('此瀏覽器不支援定位，請改輸入座標。');return;}
  $('gps').disabled=true;message('正在定位，請允許瀏覽器使用目前位置…','busy');
  try{
    const p=latestGps&&Date.now()-latestGps.timestamp<=10000?latestGps:await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
    if(gpsRequestId!==sequence)return;
    if(!displayGps(p,false))throw Error('定位資料已過期或無效，請重新定位。');
    accuracy=p.coords.accuracy;
    const xy=tm(p.coords.longitude,p.coords.latitude);
    $('x').value=xy[0].toFixed(4);$('y').value=xy[1].toFixed(4);
    await positionQuery(xy,{keepTracking:true});
  }catch(e){
    if(gpsRequestId===sequence)message(e.code===1?'定位權限未開啟，請允許此網站定位，或改輸入座標。':e.message||'暫時無法取得位置，請至開闊處重試，或改輸入座標。');
  }finally{$('gps').disabled=!ready;}
};

function drawRoads(){
  if(!map)return;markerLayer.clearLayers();
  for(const l of roadLines){
    const line=L.polyline(l.ll.map(latlng),{color:l.kind==='省道'?'#548275':l.kind==='縣道'?'#bc9659':'#9898a3',weight:2,opacity:.65,bubblingMouseEvents:false}).bindTooltip(esc(`${l.kind} ${formatRoad(l.road)}`)).addTo(markerLayer);
    let timer;
    line.on('tooltipopen',()=>{clearTimeout(timer);timer=setTimeout(()=>line.closeTooltip(),2000);});
    line.on('remove',()=>clearTimeout(timer));
  }
}
function hideRoadStatus(){
 clearTimeout(roadStatusTimer);roadStatusTimer=null;$('road-status').hidden=true;
}
function showRoadStatus(text,duration=3000){
 hideRoadStatus();$('road-status-text').textContent=text;$('road-status').hidden=false;
 roadStatusTimer=setTimeout(hideRoadStatus,duration);
}
$('road-status-close').onclick=hideRoadStatus;
async function loadMap(){
  if(!map||roadsBusy)return;
  const bounds=map.getBounds(),id=++mapSequence;
  roadsBusy=true;hideRoadStatus();$('load-roads').disabled=true;$('load-roads').textContent='載入中';$('load-roads').setAttribute('aria-busy','true');
  try{
    const response=await apiFetch(`/api/map?west=${Math.max(-180,bounds.getWest())}&south=${Math.max(-90,bounds.getSouth())}&east=${Math.min(180,bounds.getEast())}&north=${Math.min(90,bounds.getNorth())}`);
    if(!response.ok)throw Error('道路參考線載入失敗，請按按鈕重試。');
    const data=await response.json();
    if(id!==mapSequence)return;
    roadLines=data.lines;drawRoads();
    const counts=['省道','縣道','鄉道'].map(kind=>`${kind} ${new Set(roadLines.filter(l=>l.kind===kind).map(l=>l.road)).size} 條`).join('／');
    showRoadStatus(roadLines.length?`已取得：${counts}`:'此畫面沒有道路參考線。');
  }catch(e){showRoadStatus(e.message||'參考線載入失敗，請重試。',5000);}
  finally{roadsBusy=false;$('load-roads').disabled=false;$('load-roads').textContent='參考線';$('load-roads').setAttribute('aria-busy','false');}
}
$('load-roads').onclick=loadMap;
function setupBaseMaps(){
  const credit='© <a href="https://maps.nlsc.gov.tw/">內政部國土測繪中心</a>';
  const tileOptions={maxZoom:19,maxNativeZoom:19};
  const street=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{...tileOptions,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'});
  // NLSC WMTS uses zoom / row / column, corresponding to Leaflet z / y / x.
  const photo=L.tileLayer('https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/EPSG:3857/{z}/{y}/{x}',{...tileOptions,attribution:credit});
  const labels=L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP2/default/EPSG:3857/{z}/{y}/{x}',{...tileOptions,attribution:credit,zIndex:250});
  const bases={street,photo,hybrid:L.layerGroup([photo,labels])};
  const errorText='底圖暫時無法載入，可切換其他底圖；仍可查詢樁號。';
  for(const layer of [street,photo,labels])layer.on('tileerror',()=>{
    if(map.hasLayer(layer)&&!$('message').textContent)message(errorText);
  });
  map.attributionControl.addAttribution('道路圖資：<a href="https://gist.transportdata.tw/">交通部</a>／<a href="https://data.gov.tw/dataset/73232">國土測繪中心</a>');
  let active;
  const select=$('basemap');
  const apply=value=>{
    const key=Object.hasOwn(bases,value)?value:'street';
    if(active)map.removeLayer(active);
    active=bases[key];active.addTo(map);select.value=key;
    if($('message').textContent===errorText)message('');
  };
  let saved='street';
  try{saved=localStorage.getItem('milestone-basemap')||'street';}catch{}
  apply(saved);select.disabled=false;
  select.onchange=()=>{
    apply(select.value);
    try{localStorage.setItem('milestone-basemap',select.value);}catch{}
  };
}
if(window.L){
  map=L.map('map',{zoomControl:true}).setView([22.49,120.62],10);
  setupBaseMaps();
  selection=L.layerGroup().addTo(map);markerLayer=L.layerGroup().addTo(map);multiLayer=L.layerGroup().addTo(map);gpsLayer=L.layerGroup().addTo(map);
  map.on('click',e=>{
    if(!ready)return;accuracy=null;
    const xy=tm(e.latlng.lng,e.latlng.lat);
    $('x').value=xy[0].toFixed(4);$('y').value=xy[1].toFixed(4);
    document.activeElement?.blur();$('coordinate-entry').open=false;positionQuery(xy,{keepView:map.getZoom()>=18});
  });
  // Panning, zooming and GPS following must never fetch reference lines.
  $('load-roads').disabled=false;
  $('home').onclick=()=>{$('live-follow').checked=false;map.fitBounds([[21.7,120],[23,121.5]],{padding:[12,12]});};
  map.on('dragstart',()=>{$('live-follow').checked=false;});
  map.on('movestart',hideRoadStatus);
  map.on('zoomstart',hideRoadStatus);
  // Results and forms change the available map height, especially with mobile keyboards.
  if(window.ResizeObserver)new ResizeObserver(()=>map.invalidateSize({pan:false})).observe(document.querySelector('.map-wrap'));
}else{
  $('map').innerHTML='<p class="map-error">地圖暫時無法載入，仍可使用定位及座標查詢。</p>';
  $('home').disabled=true;
}
message('正在載入道路索引…','busy');
try{
  const response=await apiFetch('/api/meta');
  if(!response.ok)throw Error('無法載入道路索引，請重新整理後再試。');
  const data=await response.json();
  availableRoads=data.roads;
  for(const road of data.roads.sort((a,b)=>a.localeCompare(b,'zh-Hant',{numeric:true}))){
    const option=document.createElement('option');option.value=road;option.textContent=formatRoad(road);$('road').append(option);$('segment-road').append(option.cloneNode(true));$('coverage-road').append(option.cloneNode(true));
  }
  ready=true;
  loadAdminAreas().then(table=>{adminTable=table;refreshArea();});
  for(const id of ['road','gps','query','reverse','live-toggle','location-identify','offset-go','coverage-road','segment-road','segment-draw'])$(id).disabled=false;
  message('');
}catch{message('無法載入道路索引，請重新整理後再試。');}


function displayGps(p,follow=true){
 const c=p?.coords;
 if(!c||![c.longitude,c.latitude,c.accuracy,p.timestamp].every(Number.isFinite)||c.accuracy<0||Math.abs(c.longitude)>180||Math.abs(c.latitude)>90||Date.now()-p.timestamp>30000)return false;
 latestGps=p;
 if(map){
  const xy=[c.latitude,c.longitude],first=!gpsDot;
  if(gpsDot)gpsDot.setLatLng(xy);
  else gpsDot=L.circleMarker(xy,{radius:8,color:'#fff',weight:3,fillColor:'#278be6',fillOpacity:1,interactive:false}).bindTooltip('GPS目前位置（樁號需按鈕查詢）').addTo(gpsLayer);
  if(follow&&$('live-follow').checked)map.setView(xy,first?Math.max(16,map.getZoom()):map.getZoom());
 }
 $('live-status').textContent=`GPS藍點 · 精度約 ±${Math.round(c.accuracy)} 公尺 · ${new Date(p.timestamp).toLocaleTimeString('zh-TW')}；樁號需按「定位樁號」更新。`;
 return true;
}
if(navigator.geolocation)tracking=createLiveTracker({geo:navigator.geolocation,interval:0,
 onState(active,text){
  $('live-toggle').textContent=active?'停止藍點':'顯示GPS藍點';$('live-toggle').setAttribute('aria-pressed',String(active));$('live-options').hidden=!active;
  $('live-status').textContent=active?'正在取得GPS，僅更新藍點，不自動查詢樁號。':text;
  if(!active){latestGps=null;gpsDot=null;gpsLayer?.clearLayers();if(/權限|無法/.test(text))message(text);}
 },
 onFix(p,isCurrent){
  if(!isCurrent())return;
  if(!displayGps(p))$('live-status').textContent='GPS資料已過期或無效，等待更新；不自動查詢樁號。';
 }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopLiveTracking();});
window.addEventListener('pagehide',stopLiveTracking);

function fillSegment(candidate){
  $('segment-road').value=candidate.road;$('segment-from').value=formatM(candidate.from);$('segment-to').value=formatM(candidate.to);
}
async function drawSegment(road,from,to,side){
 stopLiveTracking();
 document.activeElement?.blur();
 const requestId=++sequence;accuracy=null;clear();
 if(!ready){message('查詢服務連線中，請稍候。','busy');return;}
 try{
  message('正在標記道路區間…','busy');
  const response=await apiFetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'segment',road,from,to,...(side?{side}:{})})});
  const data=await response.json();if(requestId!==sequence)return;
  if(!response.ok)throw Error(data.error||'路段查詢失敗。');
  const r=data.segment;message('');$('idle').hidden=true;$('result').hidden=false;
  const metres=n=>Math.round(n).toLocaleString('zh-TW'),area=areaText(r.road,r.from,r.to);
  const sideNote=r.side?`<p class="result-meta">${esc(r.side.label)}（側別示意）；${esc(r.side.note)}</p>`:'';
  const warning=r.complete?'沿既有道路線形標示；圖資推估，非現地丈量。':r.parts.length?'部分區間缺少線形或有歧義，僅標示可確認的路段；缺口不連線。':`此區間沒有可用線形。目前此道路的原樁資料範圍為 ${formatM(r.coverage[0])}～${formatM(r.coverage[1])}。`;
  $('result').innerHTML=`<span class="result-label">里程路段${r.complete?'':' · 未完整標示'}</span><span class="route-name">${esc(formatRoad(r.road))}</span>${sideNote}<p class="segment-range">${formatM(r.from)} → ${formatM(r.to)}</p>${areaMarkup(r.road,r.from,r.to)}<div><span class="segment-label">里程差　</span><strong class="segment-length">${metres(r.mileageLength)} 公尺</strong></div><p class="result-meta">${r.complete?'沿線估算長度 '+metres(r.geometryLength)+' 公尺':r.parts.length?'已標示部分沿線長度 '+metres(r.coveredGeometryLength)+' 公尺（非全段）':''}</p><p class="${r.complete?'result-meta':'result-unavailable'}">${warning}</p>${r.gaps.length?`<details class="result-details"><summary>查看未標示區間（${r.gaps.length}）</summary>${r.gaps.slice(0,20).map(g=>`<p>${formatM(g.from)}～${formatM(g.to)}：${esc(g.reason)}</p>`).join('')}${r.gaps.length>20?'<p>另有其他缺口，請縮短範圍查看。</p>':''}</details>`:''}<div class="result-actions"><button id="segment-copy" type="button">複製路段摘要</button></div>`;
  const summary=`${formatRoad(r.road)} ${formatM(r.from)} 至 ${formatM(r.to)}${r.side?' · '+r.side.label+'（側別示意）':''}${area?'\n'+area:''}\n里程差：${metres(r.mileageLength)} 公尺\n${r.complete?'沿線估算長度：'+metres(r.geometryLength)+' 公尺':'路段尚未完整標示，請確認資料缺口。'}`;
  exportNotes=[summary,...(r.side?[r.side.note]:[])];
  $('segment-copy').onclick=async()=>{try{await navigator.clipboard.writeText(summary);$('segment-copy').textContent='已複製摘要';}catch{message('無法自動複製，請選取上方結果文字複製。');}};
  if(map){
   const layers=[];
   const display=r.side||r;
   if(r.side)for(const part of r.parts)L.polyline(part.ll.map(latlng),{color:'#657b75',weight:2,opacity:.5,dashArray:'4 5'}).addTo(selection);
   for(const part of display.parts)layers.push(L.polyline(part.ll.map(latlng),{color:'#e07b24',weight:7,opacity:.9}).addTo(selection));
   for(const [point,name,color] of [[display.start,'起點','#215b4e'],[display.end,'終點','#d56e22']]){
    if(point)layers.push(L.circleMarker(latlng(point.ll),{radius:7,weight:2,color:'#fff',fillColor:color,fillOpacity:1}).bindTooltip(`${name} ${formatM(point.m)}${r.side?' · '+r.side.label:''}`,{permanent:true,direction:'top',offset:[0,-8],className:'segment-end-label'}).addTo(selection));
   }
   if(layers.length)map.fitBounds(L.featureGroup(layers).getBounds(),{padding:[35,45],maxZoom:18});
  }
 }catch(e){if(requestId===sequence)message(e.message||'無法標記路段，請稍後重試。');}
}
function selectTextLocation(candidate){
 if(candidate.kind==='coordinate'){accuracy=null;return positionQuery(candidate.xy);}
 if(candidate.kind==='point'){
  $('road').value=candidate.road;
  $('stake-km').value=String(Math.floor(candidate.m/1000));
  $('stake-m').value=String(candidate.m%1000).padStart(3,'0');
  return $('mile-form').onsubmit({preventDefault(){}},candidate.side);
 }
 fillSegment(candidate);return drawSegment(candidate.road,candidate.from,candidate.to,candidate.side);
}
function identifyText(){
 const hint=$('location-hint'),list=$('location-candidates');
 if(!ready){hint.textContent='道路清單尚未載入，請稍候。';return;}
 stopLiveTracking();document.activeElement?.blur();
 ++sequence;clear();list.replaceChildren();
 const {candidates,warnings}=recognizeInput($('location-text').value,availableRoads);
 hint.textContent=[candidates.length?`辨識到 ${candidates.length} 個位置／路段${candidates.length>1||warnings.length?'，請確認後點選。':'。'}`:'未辨識到完整位置，請保留道路名稱與樁號或座標，也可展開「手動選擇」。',...warnings].join('\n');
 $('location-all').hidden=candidates.length<2;$('location-all').onclick=()=>markAllLocations(candidates);
 if(candidates.length===1&&!warnings.length)return selectTextLocation(candidates[0]);
 for(const c of candidates){
  const button=document.createElement('button');button.type='button';
  button.textContent=locationLabel(c);
  button.onclick=()=>{for(const b of list.children)b.setAttribute('aria-pressed',String(b===button));return selectTextLocation(c);};list.append(button);
 }
}
$('location-form').onsubmit=e=>{e.preventDefault();return identifyText();};
const locationInput=$('location-text');
let pendingPaste=null;
locationInput.onpaste=()=>{
 const paste={sequence:null};pendingPaste=paste;
 // Wait for the browser to insert clipboard text; a newer action cancels this lookup.
 setTimeout(()=>{if(pendingPaste!==paste)return;pendingPaste=null;if(paste.sequence===sequence)identifyText();},0);
};
locationInput.oninput=e=>{
 stopLiveTracking();++sequence;clear({preserveScroll:true});
 if(e?.inputType==='insertFromPaste'&&pendingPaste)pendingPaste.sequence=sequence;
 else pendingPaste=null;
 $('location-all').hidden=true;$('location-candidates').replaceChildren();
 $('location-hint').textContent='文字已變更，按「辨識並定位」。';
};
locationInput.onkeydown=e=>{
 if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();return identifyText();}
};
$('segment-form').onsubmit=e=>{
 e.preventDefault();try{
  const road=$('segment-road').value;if(!road)throw Error('請選擇道路。');
  const from=parseStake($('segment-from').value),to=parseStake($('segment-to').value);fillSegment({road,from,to});drawSegment(road,from,to);
 }catch(error){message(error.message);}
};

function stopLiveTracking(){if(tracking?.active){tracking.stop();++sequence;}}
$('live-toggle').onclick=()=>{if(tracking?.active){stopLiveTracking();return;}if(!tracking){message('此瀏覽器不支援GPS藍點。');return;}++sequence;document.activeElement?.blur();tracking.start();};
function locationLabel(c){return c.kind==='coordinate'?c.label:`${formatRoad(c.road)} ${c.kind==='point'?formatM(c.m):formatM(c.from)+' → '+formatM(c.to)}${c.side?'（'+(c.side==='forward'?'順樁向側':'逆樁向側')+'）':''}`;}
function fitAllLocations(){
 const layers=multiLayer?.getLayers()||[];if(map&&layers.length)map.fitBounds(L.featureGroup(layers).getBounds(),{padding:[40,40],maxZoom:18});
}
function clearMultiLocations(){++multiSequence;multiItems=[];multiLayer?.clearLayers();$('multi-list').replaceChildren();$('multi-panel').hidden=true;}
$('multi-clear').onclick=()=>{++sequence;clearMultiLocations();clear();};
$('multi-fit').onclick=fitAllLocations;
async function markAllLocations(candidates){
 if(candidates.length>20){message('一次最多同時標記20個位置／路段，請縮短貼上的文字。');return;}
 stopLiveTracking();document.activeElement?.blur();const requestId=++sequence;clear();clearMultiLocations();const batch=multiSequence;
 $('multi-panel').hidden=false;$('multi-panel').open=true;
 for(let i=0;i<candidates.length;i++){
  if(batch!==multiSequence||requestId!==sequence)return;
  const c=candidates[i],number=i+1,label=`${number}. ${locationLabel(c)}`,entry=document.createElement('div');
  const button=document.createElement('button');button.type='button';button.textContent=label+'\n查詢中…';button.disabled=true;entry.append(button);$('multi-list').append(entry);
  $('multi-summary').textContent=`地圖標記 ${i+1}／${candidates.length}`;
  try{
   const body=c.kind==='coordinate'?{mode:'position',xy:c.xy,road:''}:c.kind==='point'?{mode:'mile',road:c.road,m:c.m}:{mode:'segment',road:c.road,from:c.from,to:c.to};
   if(c.side)body.side=c.side;
   const response=await apiFetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();
   if(batch!==multiSequence||requestId!==sequence){button.textContent=label+'\n已取消';return;}
   if(!response.ok)throw Error(data.error||'查詢失敗');
   const layers=[],notes=[];
   if(data.segment){
    const r=data.segment,display=r.side||r;
    if(r.side)notes.push(r.side.note);
    for(const p of display.parts)if(map)layers.push(L.polyline(p.ll.map(latlng),{color:'#d67828',weight:6,opacity:.85,bubblingMouseEvents:false}).on('click',()=>{fillSegment(c);drawSegment(c.road,c.from,c.to,c.side);}).addTo(multiLayer));
    for(const [point,name] of [[display.start,'起'],[display.end,'迄']])if(point&&map)layers.push(L.circleMarker(latlng(point.ll),{radius:7,color:'#fff',weight:2,fillColor:'#d67828',fillOpacity:1,bubblingMouseEvents:false}).on('click',()=>{fillSegment(c);drawSegment(c.road,c.from,c.to,c.side);}).bindTooltip(`${number} ${name} ${formatM(point.m)}${r.side?' · '+r.side.label:''}`,{permanent:true,className:'multi-label'}).addTo(multiLayer));
    notes.push(`里程差 ${r.mileageLength.toLocaleString()} 公尺`);
    notes.push(r.complete?`沿線估算 ${Math.round(r.geometryLength).toLocaleString()} 公尺`:'未完整標示：含缺口或超出資料範圍');
    button.onclick=()=>{fillSegment(c);drawSegment(c.road,c.from,c.to,c.side);};
   }else{
    const results=data.results||[];
    // Preserve separate locations/roads when a lookup has ambiguity.
    const distinct=results.filter((r,j)=>!results.slice(0,j).some(a=>a.road===r.road&&Math.hypot(a.xy[0]-r.xy[0],a.xy[1]-r.xy[1])<40));
    if(!distinct.length){
     notes.push('暫無可用樁號資料');
     if(c.kind==='coordinate'&&map)layers.push(L.circleMarker(latlng(ll(...c.xy)),{radius:8,color:'#397ec1'}).bindTooltip(`${number} 座標（無樁號）`,{permanent:true,className:'multi-label'}).addTo(multiLayer));
    }
    for(let j=0;j<distinct.length;j++){
     const r=distinct[j];if(r.side&&!notes.includes(r.side.note))notes.push(r.side.note);const name=`${number}${distinct.length>1?'.'+(j+1):''} ${formatRoad(r.road)} ${mileageLabel(r)}${r.side?' · '+r.side.label:''}`;
     if(map)layers.push(L.circleMarker(latlng(r.side?.ll||r.ll),{radius:8,color:'#fff',weight:2,fillColor:'#215b4e',fillOpacity:1,bubblingMouseEvents:false}).bindTooltip(name,{permanent:true,className:'multi-label'}).on('click',()=>{stopLiveTracking();accuracy=null;showResult(r,r.road,null,distinct,true);}).addTo(multiLayer));
     if(distinct.length>1){const choice=document.createElement('button');choice.type='button';choice.textContent=name;choice.onclick=()=>{stopLiveTracking();accuracy=null;showResult(r,r.road,null,distinct,true);if(map)map.setView(latlng(r.ll),18);};entry.append(choice);}
    }
    if(distinct.length===1){const r=distinct[0];notes.push(`${formatRoad(r.road)} ${mileageLabel(r)}`);button.onclick=()=>{stopLiveTracking();accuracy=null;showResult(r,r.road,null,distinct,true);if(map)map.setView(latlng(r.ll),18);};}
    else if(distinct.length>1)notes.push('有多個道路／位置，請點選下方候選');
   }
   button.disabled=!(button.onclick||layers.length);
   if(!button.onclick)button.onclick=()=>{if(map&&layers.length)map.fitBounds(L.featureGroup(layers).getBounds(),{padding:[35,35],maxZoom:18});};
   button.textContent=label+'\n'+notes.join('；');multiItems.push({label,notes});
  }catch(e){if(batch!==multiSequence||requestId!==sequence)return;button.textContent=label+'\n'+e.message;multiItems.push({label,notes:[e.message]});}
 }
 if(batch===multiSequence&&requestId===sequence){$('multi-summary').textContent=`地圖標記（${candidates.length}）`;fitAllLocations();message('已完成地圖標記；無資料或不完整的項目已列明。');}
}
$('offset-form').onsubmit=e=>{
 e.preventDefault();try{
  const r=recognizeLocations($('offset-base').value,availableRoads);
  if(r.warnings.length||r.candidates.length!==1||r.candidates[0].kind!=='point')throw Error('基準欄請填一個完整道路與樁號，例如台27線59K+223。');
  const raw=$('offset-distance').value.trim();if(!/^\d+$/.test(raw))throw Error('距離請輸入正整數公尺。');
  const target=offsetLocation(r.candidates[0],Number(raw),$('offset-direction').value);
  $('offset-note').textContent=`${locationLabel(target)}；里程差 ${Math.abs(target.to-target.from)} 公尺。非實際管道長度。`;
  return selectTextLocation(target);
 }catch(e){$('offset-note').textContent=e.message;}
};
$('coverage-road').onchange=async()=>{
 const id=++coverageSequence,road=$('coverage-road').value;$('coverage-result').replaceChildren();
 if(!road){$('coverage-status').textContent='請選擇道路。';return;}
 $('coverage-status').textContent='正在讀取資料範圍…';
 try{
  const response=await apiFetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'coverage',road})}),data=await response.json();
  if(id!==coverageSequence)return;if(!response.ok)throw Error(data.error||'讀取失敗');
  const r=data.coverage;$('coverage-status').textContent=`${formatRoad(road)} 原樁範圍 ${formatM(r.min)}～${formatM(r.max)}。${r.note}`;
  const overview=document.createElement('p');overview.textContent=r.gapCount?`共有 ${r.gapCount} 處線形缺口／歧義${r.truncated?'，顯示前60處':''}。`:'此資料範圍未發現路段線形缺口。';$('coverage-result').append(overview);
  for(const [m,name] of [[r.min,'最小里程'],[r.max,'最大里程']]){const b=document.createElement('button');b.type='button';b.className='coverage-gap';b.textContent=`定位${name} ${formatM(m)}`;b.onclick=()=>selectTextLocation({kind:'point',road,m});$('coverage-result').append(b);}
  for(const g of r.gaps){const b=document.createElement('button');b.type='button';b.className='coverage-gap';b.textContent=`${formatM(g.from)}～${formatM(g.to)}：${g.reason}`;b.onclick=()=>{const from=Math.max(r.min,Math.floor(g.from)-50),to=Math.min(r.max,Math.ceil(g.to)+50);if(to>from&&to-from<=50000)drawSegment(road,from,to);else message('缺口範圍過長，請在里程路段分段查看。');};$('coverage-result').append(b);}
 }catch(e){if(id===coverageSequence)$('coverage-status').textContent=e.message;}
};
let exportBusy=false;
async function saveMapImage(format='jpg'){
 if(exportBusy)return;
 exportBusy=true;$('export-menu').open=false;
 $('export-map').disabled=true;$('export-png').disabled=true;$('export-summary').textContent='產生中…';stopLiveTracking();
 try{await exportMapImage({map,groups:[markerLayer,multiLayer,selection],notes:[...exportNotes,...multiItems.map(i=>i.label+'；'+i.notes.join('；'))],format});message(`${format.toUpperCase()}示意圖已產生，請查看下載項目。`);}
 catch(e){message(e.message||'圖片匯出失敗，請稍後重試。');}
 finally{exportBusy=false;$('export-map').disabled=false;$('export-png').disabled=false;$('export-summary').textContent='匯出 ▾';}
}
$('export-map').onclick=()=>saveMapImage();
$('export-png').onclick=()=>saveMapImage('png');
$('export-menu').onkeydown=e=>{if(e.key==='Escape'){$('export-menu').open=false;$('export-summary').focus();}};
document.addEventListener?.('click',e=>{if(!e.target.closest?.('#export-menu'))$('export-menu').open=false;});
