// Build data/admin-areas.json (管養工務段、鄉鎮、村里 by stake) from the 公路局
// 「省道里程坐標（里程牌標誌）」CSV. Usage: node scripts/build-admin-areas.mjs <CSV> [縣市]
import {writeFile} from 'node:fs/promises';
import {readOfficialMarkers} from './official-csv.mjs';

const [file,county='屏東縣']=process.argv.slice(2);
if(!file)throw Error('請提供公路局里程牌 CSV 路徑。');
const markers=(await readOfficialMarkers(file,county)).filter(p=>Number.isFinite(p.m)&&p.section&&p.town);
const names=[],id=name=>{let i=names.indexOf(name);if(i<0)i=names.push(name)-1;return i;};
const roads={};
for(const p of markers.sort((a,b)=>a.road.localeCompare(b.road)||a.m-b.m)){
 const row=[p.m,id(p.section),id(p.town),id(p.village)],list=roads[p.road]??=[];
 // Both carriageway signs at one stake often repeat the same area.
 if(!list.some(r=>r.every((v,i)=>v===row[i])))list.push(row);
}
const dates=markers.map(p=>p.date).filter(Boolean).sort((a,b)=>new Date(a)-new Date(b));
const table={source:'交通部公路局「省道里程坐標（里程牌標誌）」',county,surveyed:[dates[0],dates.at(-1)],names,roads};
await writeFile(new URL('../data/admin-areas.json',import.meta.url),JSON.stringify(table));
console.log(`${county}：${Object.keys(roads).length} 條道路，${Object.values(roads).reduce((n,r)=>n+r.length,0)} 筆`);
