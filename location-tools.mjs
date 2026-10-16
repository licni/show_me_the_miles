import {normalizeText,recognizeLocations,roadPrefix} from './segment-parser.mjs';
import {tm} from './coordinates.mjs';
export function offsetLocation(point,distance,direction){
 if(point?.kind!=='point'||!Number.isInteger(distance)||distance<=0||distance>50000)throw Error('請提供單一樁號與1～50000公尺的整數距離。');
 if(!['forward','backward','around'].includes(direction))throw Error('請選擇順樁向、逆樁向或前後範圍。');
 const from=direction==='around'?point.m-distance:point.m;
 const to=direction==='backward'?point.m-distance:point.m+distance;
 if(Math.min(from,to)<0||Math.max(from,to)>600000)throw Error('計算結果超出0～600公里，不會自動截短。');
 if(Math.abs(to-from)>50000)throw Error('前後範圍合計不可超過50公里。');
 return {key:`${point.road}:${from}:${to}`,road:point.road,from,to};
}
const roadMentions=s=>[...s.matchAll(new RegExp(`(?:${roadPrefix})\\s*\\d{1,3}`,'g'))];
// 順樁150公尺, 往大樁號方向延伸1.5公里, 前後各約100m.
const distanceRE=/(?:往)?(大樁號|小樁號|順樁|逆樁|前後各)(?:方向|向)?\s*(?:延伸|約)*\s*(\d+(?:\.\d+)?)\s*(公尺|米|公里|km|m)(?![a-z])/i;
// Google Maps style 22°29'24.0"N and 22.49N / N22.49 become plain decimal degrees.
function plainDegrees(s){
 return s.replace(/(\d{1,3})\s*[°度]\s*(\d{1,2}(?:\.\d+)?)\s*['′分](?:\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|′′|''|秒)?)?\s*[NE]?(?![a-z])/gi,(all,d,m,sec)=>' '+(Number(d)+Number(m)/60+Number(sec||0)/3600).toFixed(7)+' ')
  .replace(/(\d{2,3}\.\d+)\s*°?\s*[NE](?![a-z])/gi,'$1 ')
  .replace(/(?<![a-z])[NE]\s*(\d{2,3}\.\d+)/gi,' $1');
}
export function recognizeInput(text,roads){
 let s=plainDegrees(normalizeText(text));const coordinates=[];
 // Separate explicitly named roads before interpreting per-road directional distances.
 const named=roadMentions(s).filter((m,i)=>!i||!/(?:到|至|迄|~|→|-)\s*$/.test(s.slice(0,m.index)));
 if(named.length>1&&/順樁|逆樁|大樁號|小樁號|前後各/.test(s)){
  const parts=named.map((m,i)=>recognizeInput(s.slice(i?m.index:0,named[i+1]?.index??s.length),roads));
  const candidates=[];for(const p of parts)for(const c of p.candidates)if(!candidates.some(a=>a.key===c.key))candidates.push(c);
  return {candidates,warnings:[...new Set(parts.flatMap(p=>p.warnings))]};
 }
 const number='\\d{1,7}(?:\\.\\d{1,8})?',label='X|Y|經度|緯度|東經|北緯|lon(?:gitude)?|lng|lat(?:itude)?';
 const pair=new RegExp(`(?<![\\d.+])(?:(${label})\\s*[:=]?\\s*)?(${number})\\s*(?:[,、;]|\\s)\\s*(?:(${label})\\s*[:=]?\\s*)?(${number})(?![\\d.+])`,'gi');
 const isLat=l=>/^(緯度|北緯|lat)/i.test(l),isLon=l=>/^(經度|東經|lon|lng)/i.test(l);
 let rest='',last=0;
 for(let m;(m=pair.exec(s));){
  const [all,labelA,,labelB]=m,a=Number(m[2]),b=Number(m[4]);let xy,display;
  if(a>=100000&&a<=400000&&b>=2300000&&b<=3000000){xy=[a,b];display=`TWD97 X ${a}／Y ${b}`;}
  else if(a>=120&&a<=121.5&&b>=21.7&&b<=23){xy=tm(a,b);display=`經度 ${a}／緯度 ${b}`;}
  else if(b>=120&&b<=121.5&&a>=21.7&&a<=23){xy=tm(b,a);display=`緯度 ${a}／經度 ${b}`;}
  // Explicit labels must agree with the magnitude; do not silently swap X/Y or lat/lon.
  const wrong=(l,v,y)=>l&&(isLat(l)?v>90:isLon(l)?v<90:/^x$/i.test(l)?v<100000:/^y$/i.test(l)?v<2300000:false);
  // A rejected pair consumes nothing, so 392K+406 22.49,120.62 still finds the coordinate.
  if(!xy||wrong(labelA,a)||wrong(labelB,b)){pair.lastIndex=m.index+1;continue;}
  rest+=s.slice(last,m.index)+' ';last=m.index+all.length;
  const key='xy:'+xy.map(v=>v.toFixed(3)).join(':');if(!coordinates.some(c=>c.key===key))coordinates.push({kind:'coordinate',key,xy,label:display});
 }
 s=rest+s.slice(last);
 const directions=(s.match(/順樁|逆樁|大樁號|小樁號|前後各/g)||[]).length;
 const direction=directions===1?s.match(distanceRE):null;
 // The distance is not a stake: 順樁1.5公里 must not become a second mileage 1K+500.
 const stakes=direction?s.slice(0,direction.index)+' '.repeat(direction[0].length)+s.slice(direction.index+direction[0].length):s;
 const r=roadMentions(stakes).length?recognizeLocations(stakes,roads):{candidates:[],warnings:[]};
 if(!r.candidates.length&&!coordinates.length&&!r.warnings.length)r.warnings.push('請貼上道路＋樁號、TWD97 X／Y，或屏東地區的十進位經緯度。');
 if(directions>1)return {candidates:coordinates,warnings:[...r.warnings,'同一基準有多個方向，請分行寫出各自的道路與基準樁號。']};
 if(direction){
  const value=Number(direction[2])*(/^(公里|km)$/i.test(direction[3])?1000:1),distance=Math.round(value);
  if(r.candidates.length!==1||r.candidates[0].kind!=='point'||coordinates.length)r.warnings.push('距離增減請只提供一個基準樁號。');
  else if(Math.abs(value-distance)>1e-6){r.warnings.push('距離請以整數公尺表示，例如「順樁向150公尺」。');r.candidates=[];}
  else try{r.candidates=[offsetLocation(r.candidates[0],distance,['大樁號','順樁'].includes(direction[1])?'forward':['小樁號','逆樁'].includes(direction[1])?'backward':'around')];}catch(e){r.warnings.push(e.message);r.candidates=[];}
 }else if(/順樁|逆樁/.test(s)){
  const side=s.match(/(順樁|逆樁)(?:方向|向)?\s*(.*)/);
  // A direction alone denotes a carriageway side, not a missing distance. A number
  // right after it is an attempted distance, unless it is a stake (順樁 59K+223).
  if(/^(?:[:=]?\s*(?:延伸|約)?\s*[+\-\d.]|公尺|米|m\b|公里|km\b)/i.test(side[2])&&!/^[:=]?\s*\d{1,3}\s*(?:k|\+)/i.test(side[2]))r.warnings.push('距離格式不完整，請使用例如「順樁向150公尺」；只指定側別可寫「（順樁向）」。');
  else if(r.candidates.length===1&&!coordinates.length){
   const c=r.candidates[0],carriageway=side[1]==='順樁'?'forward':'backward';
   r.candidates=[{...c,side:carriageway,key:c.key+':'+carriageway}];
  }else r.warnings.push('側別請與各自的道路及樁號一起分行標示。');
 }else if(/大樁號|小樁號|前後各/.test(s)){r.warnings.push('距離格式不完整，請使用例如「順樁向150公尺」。');}
 return {candidates:[...r.candidates,...coordinates],warnings:r.warnings};
}
// No storage or track history. A single watcher, one query in flight, newest fix wins.
export function createLiveTracker({geo,onFix,onState,now=()=>Date.now(),interval=4000,schedule=setTimeout,cancel=clearTimeout}){
 let watch=null,generation=0,busy=false,last=-Infinity,latest=null,timer=null;
 function stop(reason='已停止持續定位'){
  generation++;if(watch!==null)geo.clearWatch(watch);watch=null;latest=null;
  if(timer!==null)cancel(timer);timer=null;onState(false,reason);
 }
 async function consume(token){
  if(token!==generation||watch===null||busy||!latest)return;
  const delay=interval-(now()-last);
  if(delay>0){if(timer===null)timer=schedule(()=>{timer=null;consume(token);},delay);return;}
  const p=latest;latest=null;busy=true;last=now();
  try{await onFix(p,()=>token===generation&&watch!==null);}catch(e){if(token===generation)onState(true,e.message||'查詢暫時失敗，等待下一次定位。');}
  finally{busy=false;if(latest&&watch!==null)consume(generation);}
 }
 return {get active(){return watch!==null;},stop,start(){
  if(watch!==null)return;const token=++generation;last=-Infinity;onState(true,'正在持續定位…');
  try{watch=geo.watchPosition(p=>{if(token!==generation)return;latest=p;consume(token);},e=>{
   if(token!==generation)return;
   if(e.code===1)stop('未開啟定位權限，持續定位已停止。');else onState(true,'暫時無法取得位置，等待下一次定位。');
  },{enableHighAccuracy:true,maximumAge:2000,timeout:15000});}catch(e){stop('此裝置無法啟動持續定位。');}
 }};
}
