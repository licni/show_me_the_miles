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

// Chat apps often drop a trailing ")" or "~" from a link, so escape those too.
const encode=text=>encodeURIComponent(text).replace(/[!'()*~]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function shareUrl(base,{q,road}){return `${base}?q=${encode(q)}${road?'&road='+encode(road):''}`;}
export function readShare(search){
 const params=new URLSearchParams(search),q=(params.get('q')||'').slice(0,12000).trim();
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
