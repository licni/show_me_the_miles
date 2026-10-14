import {roadSegment} from './segments.mjs';
import {validateSide,pointSide,segmentSide} from './carriageway-side.mjs';
import {reverse,project,ll} from './engine.mjs';
import {positionCandidates,localGeometry,distinctLocations} from './candidates.mjs';
import {localMapLines,viewportMapLines} from './map-lines.mjs';
import {countyNote,countyEstimateNote,countyGapEstimateNote,countyBendEstimateNote,countyRoadShapeNote,isCountyLine} from './county.mjs';

export function createQueryService(model){
const publicFiles=new Set(['/','/index.html','/style.css','/app.mjs','/coordinates.mjs','/segment-parser.mjs','/location-tools.mjs','/map-export.mjs','/vendor/leaflet.js','/vendor/leaflet.css','/vendor/LEAFLET-LICENSE.txt']);
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
const marker=p=>({road:p.road,m:p.m,xy:p.xy,sign:p.sign,date:p.date,dir:p.dir,...(p.sourceKind?{sourceKind:p.sourceKind}:{}),...(p.coordinateNote?{coordinateNote:p.coordinateNote}:{})});
function output(r,road){
 const result={road,m:r.m,xy:r.xy,ll:ll(...r.xy),method:r.method,d:r.d??null,distance:r.distance,refs:(r.refs||[]).slice(0,2).map(a=>({marker:marker(a.marker)}))};
 if(r.marker)result.marker=marker(r.marker);
 if(['reference-only','county-boundary'].includes(r.line?.sourceKind))result.sourceKind=r.line.sourceKind;
 if(r.distanceKind)result.distanceKind=r.distanceKind;
 if(r.notice)result.notice=r.notice;
 if(['province-centerline','province-ramp-estimate'].includes(r.sourceKind)){
  result.sourceKind=r.sourceKind;
  if(r.centerlineExtrapolation)result.centerlineExtrapolation=true;
  result.note=r.sourceKind==='province-ramp-estimate'?'以引道兩端對應的主線里程連續內插；引道長度不另加至樁號，距離為至主線對應位置。':r.centerlineExtrapolation?'依同道路既有樁位校準，沿實際道路中心線推估末段里程；屬圖資推估。':'以官方樁位校準道路中心線，雙向共用同一套里程；屬圖資推估。';
 }
 if(r.nearbyEndpoint)result.nearbyEndpoint={...r.nearbyEndpoint};
 if(r.sourceKind==='county-endpoint-estimate'){
  const e=r.endpointExtension;result.sourceKind=r.sourceKind;
  result.endpointExtension={fromM:e.fromM,side:e.side,along:e.along,endpointDistance:e.endpointDistance,basis:e.basis};
  result.note='由有效資料端點沿同一道路線形或穩定末端方向短距離延伸，並非實測樁位；路口請確認所選道路。 '+countyNote;
 }
 if(r.marker?.sourceKind==='county50'||(r.line&&isCountyLine(r.line))){result.sourceKind=r.sourceKind||r.line?.sourceKind||'county50';result.note=r.marker?countyNote:(result.sourceKind==='county-road-shape-estimate'?countyRoadShapeNote:result.sourceKind==='county-bend-estimate'?countyBendEstimateNote:result.sourceKind==='county-gap-estimate'?countyGapEstimateNote:countyEstimateNote)+' '+countyNote;}
 if(r.line?.xy){const s=r.s??project(r.xy,r.line.xy).s;result.line={road:r.line.road,ll:localGeometry(r.line,s).map(p=>ll(...p))};}
 return result;
}
function validateRoad(r,optional=false){if(optional&&(r===''||r==null))return '';if(typeof r!=='string'||!Object.hasOwn(model.byRoad,r))throw Error('請選擇有資料的省道或縣道。');return r;}
return {async fetch(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(path==='/api/meta'&&request.method==='GET')return json({roads:Object.keys(model.byRoad),version:'2.1',markerCount:Object.values(model.byRoad).reduce((n,p)=>n+p.length,0),countyCoverage:model.countyCoverage,countyStats:model.countyStats});
 if(path==='/api/map'&&request.method==='GET'){
  if(['west','south','east','north'].some(k=>url.searchParams.has(k))){
   try{const keys=['west','south','east','north'];if(keys.some(k=>!url.searchParams.get(k)?.trim()))throw Error('請提供完整地圖範圍。');return json(viewportMapLines(model.referenceLevels,keys.map(k=>Number(url.searchParams.get(k))),model.referenceOverview));}
   catch(e){return json({error:e.message},400);}
  }
  const lon=Number(url.searchParams.get('lon')),lat=Number(url.searchParams.get('lat'));if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<120||lon>121.5||lat<21.7||lat>23)return json({lines:[]});
  return json({lines:localMapLines(model.displayMapLines,lon,lat)});
 }
 if(path==='/api/query'){
  if(request.method!=='POST')return json({error:'請使用單次 POST 查詢。'},405);
  if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'需要 JSON 請求。'},415);
  // Only accept same-origin browser writes; not a substitute for anti-scraping controls.
  const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'跨網站請求不被允許。'},403);
  if(Number(request.headers.get('content-length'))>2048)return json({error:'請求過大。'},413);
  try{
   const body=await request.text();if(body.length>2048)return json({error:'請求過大。'},413);const q=JSON.parse(body);if(!q||typeof q!=='object'||Array.isArray(q))throw Error('查詢內容必須是物件。');let results=[];
   if(q.mode==='position'){const road=validateRoad(q.road,true);if(!Array.isArray(q.xy)||q.xy.length!==2||!q.xy.every(x=>typeof x==='number'&&Number.isFinite(x)))throw Error('請提供有效的 X、Y 座標。');const [x,y]=q.xy;if(x<100000||x>400000||y<2300000||y>3000000)throw Error('座標超出支援範圍。');results=positionCandidates(model,q.xy,road).map(r=>output(r,r.line.road));}
   else if(q.mode==='mile'){
    const road=validateRoad(q.road);
    // Only an explicit automatic-start request may omit mileage. Never replace an entered 0.
    if(Object.hasOwn(q,'start')&&(q.start!==true||Object.hasOwn(q,'m')))throw Error('起點查詢不可同時指定里程。');
    const m=q.start===true?model.byRoad[road].reduce((min,p)=>Number.isInteger(p.m)&&p.m>=0?Math.min(min,p.m):min,Infinity):q.m;
    if(typeof m!=='number'||!Number.isInteger(m)||m<0||m>600000)throw Error('里程必須是有效的整數公尺。');
    const side=validateSide(q.side);
    results=distinctLocations(reverse(model,road,m)).map(r=>{const result=output(r,road);if(side)result.side=pointSide(model,road,m,r.xy,side);return result;});
   }
   else if(q.mode==='coverage'){return json({coverage:model.roadCoverage[validateRoad(q.road)]});}
   else if(q.mode==='segment'){const road=validateRoad(q.road),side=validateSide(q.side),segment=roadSegment(model,road,q.from,q.to);if(side)segment.side=segmentSide(segment,side);return json({segment});}
   else throw Error('不支援的查詢方式。');return json({results});
  }catch(e){return json({error:e instanceof SyntaxError?'無法解析查詢內容。':e.message},400);}
 }
 if(path.startsWith('/api/'))return json({error:'找不到服務。'},404);
 if(!publicFiles.has(path))return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
 const response=await env.ASSETS.fetch(request);const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','strict-origin-when-cross-origin');return new Response(response.body,{status:response.status,headers});
}};

}
