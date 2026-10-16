// Compare the 公路局「省道里程坐標（里程牌標誌）」CSV (Big5) with this site's markers.
// Usage: node scripts/compare-official.mjs <下載的CSV> [縣市，預設屏東縣]
// Reports only; no data is changed. Province road markers here come from this dataset.
import {readFile} from 'node:fs/promises';
import {createModelLoader} from '../pages/model-loader.mjs';
import {tm} from '../coordinates.mjs';
import {readOfficialMarkers} from './official-csv.mjs';

const [file,county='屏東縣']=process.argv.slice(2);
if(!file)throw Error('請提供公路局里程牌 CSV 路徑。');
const official=await readOfficialMarkers(file,county);

const site=new URL('../',import.meta.url);
const loader=createModelLoader({baseURL:new URL('https://example.test/site/'),gzip:false,fetch:async url=>new Response(await readFile(new URL(new URL(url).pathname.replace(/^\/site\//,''),site)))});
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]),label=p=>`${p.road} ${Math.floor(p.m/1000)}K+${String(p.m%1000).padStart(3,'0')} ${p.dir||'（無方向）'} ${p.date||''}`;
let identical=0;const changed=[],officialOnly=[],inconsistent=[];
const roads=[...new Set(official.map(o=>o.road))],ours=new Map();
for(const road of roads)ours.set(road,[...((await loader.modelFor({mode:'mile',road,m:-1})).byRoad[road]||[])]);
for(const o of official){
 // The site uses WGS84 when the two official coordinate columns disagree.
 const fromWGS=o.wgs.every(Number.isFinite)?tm(...o.wgs):null;
 if(fromWGS&&distance(fromWGS,o.xy)>2)inconsistent.push(`${label(o)}：TWD97 與 WGS84 相差 ${Math.round(distance(fromWGS,o.xy))} 公尺`);
 const pool=ours.get(o.road)||[],same=pool.filter(p=>p.m===o.m&&(!o.dir||!p.dir||p.dir===o.dir)).sort((a,b)=>distance(a.xy,o.xy)-distance(b.xy,o.xy));
 if(!same.length){officialOnly.push(label(o));continue;}
 const p=same[0],d=Math.min(distance(p.xy,o.xy),fromWGS?distance(p.xy,fromWGS):Infinity);
 // Duplicate official rows (same stake, same place) match the same site marker.
 if(d<.5){if(pool.includes(p)){identical++;pool.splice(pool.indexOf(p),1);}continue;}
 pool.splice(pool.indexOf(p),1);
 changed.push(`${label(o)}：網站座標相差 ${Math.round(d)} 公尺${p.corrected?'（網站已標為修正樁位）':''}`);
}
const siteOnly=[...ours.values()].flat().map(label);
const section=(title,items)=>{console.log(`\n${title}（${items.length}）`);for(const i of items)console.log('  '+i);};
console.log(`${county}：官方 ${official.length} 列，${roads.length} 條道路；與網站相同 ${identical}`);
section('座標不同',changed);
section('官方有、網站沒有（可能為新設樁）',officialOnly);
section('網站有、官方沒有（可能已移除）',siteOnly);
section('官方 TWD97 與 WGS84 互相矛盾',inconsistent);
