// Share links and the per-browser lookup history. Both store a location as text
// that recognizeInput reads back, so a link, a history entry and a paste share one path.
import {ll,formatM} from './coordinates.mjs';

export const formatRoad=road=>/^台\d/.test(road)?`${road}線`:road;
const sideText=side=>side?`(${side==='forward'?'順':'逆'}樁向)`:'';

// candidate: {kind:'coordinate',xy} | {kind:'point',road,m,side?} | {road,from,to,side?}
export function locationText(c){
 if(c.kind==='coordinate'){const [lon,lat]=ll(...c.xy);return `${lat.toFixed(6)},${lon.toFixed(6)}`;}
 // The space keeps a road such as 屏10 from merging with the stake digits.
 return `${formatRoad(c.road)} ${c.kind==='point'?formatM(c.m):formatM(c.from)+'~'+formatM(c.to)}${sideText(c.side)}`;
}

// Short links are plain letters, digits, "-", "_" and "." so that chat apps keep the whole link
// and nothing turns into %-escapes: T1_392406f, C185_34544_35200, g22649062_120444120_C189.
const PREFIX={台:'T',縣:'C',屏:'P'},STEMS='甲乙丙丁戊己庚辛壬癸';
export function roadCode(road){
 const m=/^([台縣屏])(\d+)(?:-(\d+))?([甲乙丙丁戊己庚辛壬癸])?(?:臨(\d+))?$/.exec(road);
 return m?`${PREFIX[m[1]]}${m[2]}${m[3]?'-'+m[3]:''}${m[4]?String.fromCharCode(97+STEMS.indexOf(m[4])):''}${m[5]?'x'+m[5]:''}`:null;
}
export function roadFromCode(code){
 const m=/^([TCP])(\d+)(?:-(\d+))?([a-j])?(?:x(\d+))?$/.exec(code);
 return m?`${Object.keys(PREFIX).find(k=>PREFIX[k]===m[1])}${m[2]}${m[3]?'-'+m[3]:''}${m[4]?STEMS[m[4].charCodeAt(0)-97]:''}${m[5]?'臨'+m[5]:''}`:null;
}
const sideCode=side=>side==='forward'?'f':side==='backward'?'b':'';
function itemCode(c,road){
 if(c.kind==='coordinate'){
  const [lon,lat]=ll(...c.xy),chosen=road?roadCode(road):'';
  return lat>0&&lon>0&&chosen!==null?`g${Math.round(lat*1e6)}_${Math.round(lon*1e6)}${chosen?'_'+chosen:''}`:null;
 }
 const code=roadCode(c.road),stakes=c.kind==='point'?[c.m]:[c.from,c.to];
 return code&&stakes.every(m=>Number.isFinite(m)&&m>=0)?`${code}_${stakes.map(m=>Math.round(m)).join('_')}${sideCode(c.side)}`:null;
}
function itemFromCode(code){
 let m=/^g(\d{7,9})_(\d{8,9})(?:_([A-Za-z0-9-]+))?$/.exec(code);
 if(m){const road=m[3]?roadFromCode(m[3]):'';return road===null?null:{text:`${(m[1]/1e6).toFixed(6)},${(m[2]/1e6).toFixed(6)}`,road};}
 m=/^([A-Za-z0-9-]+)_(\d{1,6})(?:_(\d{1,6}))?([fb])?$/.exec(code);
 const road=m&&roadFromCode(m[1]);if(!road)return null;
 const side=m[4]==='f'?'forward':m[4]==='b'?'backward':undefined;
 return {text:locationText(m[3]===undefined?{kind:'point',road,m:Number(m[2]),side}:{road,from:Number(m[2]),to:Number(m[3]),side})};
}

// Chat apps often drop a trailing ")" or "~" from a link, so escape those too.
const encode=text=>encodeURIComponent(text).replace(/[!'()*~]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
// target: {items:[candidate…],road?}. road is the one chosen among several at a looked-up position.
export const targetText=target=>target.items.map(locationText).join('\n');
export function shareUrl(base,target){
 const codes=target.items.map(c=>itemCode(c,target.items.length===1?target.road:''));
 if(codes.every(Boolean))return `${base}?s=${codes.join('.')}`;
 // A road name outside the short scheme still gets a working, if long, link.
 return `${base}?q=${encode(targetText(target))}${target.road?'&road='+encode(target.road):''}`;
}
// Returns {q,road}: the text to recognise and the road to prefer. ?q= is the earlier long form.
export function readShare(search){
 const params=new URLSearchParams(search),short=params.get('s');
 if(short){
  const items=short.slice(0,2000).split('.').map(itemFromCode);
  return items.length&&items.every(Boolean)?{q:items.map(i=>i.text).join('\n'),road:items.length===1&&items[0].road||''}:null;
 }
 const q=(params.get('q')||'').slice(0,12000).trim();
 return q?{q,road:params.get('road')||''}:null;
}

const KEY='milestone-history';
export const HISTORY_LIMIT=20;
// storage may be null or throw (private browsing); history is then simply empty.
export function loadHistory(storage){
 try{
  const list=JSON.parse(storage.getItem(KEY)||'[]');
  return Array.isArray(list)?list.filter(e=>e&&typeof e.q==='string'&&e.q&&typeof e.label==='string').slice(0,HISTORY_LIMIT):[];
 }catch{return [];}
}
export function addHistory(storage,entry){
 const list=[entry,...loadHistory(storage).filter(e=>e.q!==entry.q)].slice(0,HISTORY_LIMIT);
 try{storage.setItem(KEY,JSON.stringify(list));}catch{return loadHistory(storage);}
 return list;
}
export function clearHistory(storage){try{storage.removeItem(KEY);}catch{}return [];}
