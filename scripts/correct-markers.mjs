// Find source markers whose position contradicts every nearby mileage, and
// estimate where they belong from the road centerline and same-direction markers.
// Usage: node scripts/correct-markers.mjs          (report only)
//        node scripts/correct-markers.mjs --write  (update road index files,
//        then run node scripts/build-shards.mjs to refresh hashes and manifest)
import {readFile,writeFile} from 'node:fs/promises';
import {createModelLoader} from '../pages/model-loader.mjs';
import {plausibleExact,reverse,project,at,ll} from '../engine/engine.mjs';

const site=new URL('../',import.meta.url),write=process.argv.includes('--write');
const loader=createModelLoader({baseURL:new URL('https://example.test/site/'),gzip:false,fetch:async url=>new Response(await readFile(new URL(new URL(url).pathname.replace(/^\/site\//,''),site)))});
const manifest=JSON.parse(await readFile(new URL('data/manifest.json',site),'utf8'));
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const round=(v,n)=>Number(v.toFixed(n));
// Signed lateral offset from the centerline, left of increasing s is positive.
function lateral(line,xy){
 const p=project(xy,line.xy),a=at(line,Math.max(0,p.s-2)),b=at(line,Math.min(line.length,p.s+2)),t=[b[0]-a[0],b[1]-a[1]],n=Math.hypot(...t);
 return {...p,offset:(t[0]*(xy[1]-p.xy[1])-t[1]*(xy[0]-p.xy[0]))/n};
}

const fixes=[];
for(const road of manifest.roads.filter(r=>r.hasMileage)){
 const markers=(await loader.modelFor({mode:'mile',road:road.name,m:-1})).byRoad[road.name]||[];
 for(const marker of markers){
  if(marker.corrected||plausibleExact(markers,marker.m).includes(marker))continue;
  const model=await loader.modelFor({mode:'segment',road:road.name,from:Math.max(0,marker.m-1500),to:marker.m+1500});
  const center=reverse(model,road.name,marker.m).find(r=>r.line?.xy);
  if(!center){fixes.push({road:road.name,marker,error:'此里程沒有可用中心線'});continue;}
  // Nearest plausible same-direction markers on each side carry the lateral offset.
  // Centerlines are stored in short pieces; measure each marker against the piece beside it.
  const lines=[...model.centerlines,...model.lines].filter(l=>l.road===road.name&&l.xy?.length>1);
  const beside=xy=>lines.map(l=>lateral(l,xy)).sort((a,b)=>a.d-b.d)[0];
  const usable=markers.filter(o=>o!==marker&&o.dir===marker.dir&&Math.abs(o.m-marker.m)<=1000&&plausibleExact(markers,o.m).includes(o)).map(o=>({o,...beside(o.xy)})).filter(o=>o.d<=40);
  const before=usable.filter(o=>o.o.m<marker.m).sort((a,b)=>b.o.m-a.o.m)[0],after=usable.filter(o=>o.o.m>marker.m).sort((a,b)=>a.o.m-b.o.m)[0];
  const basis=[before,after].filter(Boolean);
  if(!basis.length){fixes.push({road:road.name,marker,error:'前後1公里內沒有同向樁位可參考側向位置'});continue;}
  const offset=basis.length===2?before.offset+(after.offset-before.offset)*(marker.m-before.o.m)/(after.o.m-before.o.m):basis[0].offset;
  const here=lateral(center.line,center.xy),a=at(center.line,Math.max(0,here.s-2)),b=at(center.line,Math.min(center.line.length,here.s+2)),n=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const xy=[round(center.xy[0]-offset*(b[1]-a[1])/n,1),round(center.xy[1]+offset*(b[0]-a[0])/n,1)];
  // The estimate must agree with each neighbour's mileage spacing (±10% + 5 m).
  const checks=basis.map(o=>({m:o.o.m,expected:Math.abs(o.o.m-marker.m),actual:distance(xy,o.o.xy)}));
  const error=checks.some(c=>Math.abs(c.actual-c.expected)>c.expected*.1+5)?'推估位置與鄰樁間距不符，未修正':null;
  fixes.push({road:road.name,marker,xy,offset,checks,moved:distance(xy,marker.xy),error,file:road.index?.json||road.bundle?.json});
 }
}

for(const f of fixes){
 console.log(`${f.road} ${f.marker.m}（${f.marker.dir||''} ${f.marker.date||''}）`);
 if(f.xy)console.log(`  原座標 ${f.marker.xy.join(', ')} → 修正 ${f.xy.join(', ')}，移動 ${Math.round(f.moved)} 公尺，側向 ${f.offset.toFixed(1)} 公尺`);
 for(const c of f.checks||[])console.log(`  與 ${c.m} 距離 ${c.actual.toFixed(1)} 公尺（里程差 ${c.expected}）`);
 if(f.error)console.log('  '+f.error);
}
if(!write){console.log(fixes.length?'\n加上 --write 寫入資料。':'沒有位置矛盾的原樁。');process.exit(0);}
for(const f of fixes.filter(f=>!f.error)){
 if(!f.file)throw Error('不支援分段儲存的道路索引：'+f.road);
 const url=new URL(f.file,site),data=JSON.parse(await readFile(url,'utf8'));
 const record=data.byRoad[f.road].find(p=>p.m===f.marker.m&&p.dir===f.marker.dir&&distance(p.xy,f.marker.xy)<1e-6);
 record.corrected={xy:record.xy,ll:record.ll,method:'中心線里程位置＋同向前後樁側向偏移',basis:f.checks.map(c=>c.m)};
 record.xy=f.xy;record.ll=ll(...f.xy).map(v=>round(v,7));
 await writeFile(url,JSON.stringify(data));
 console.log('已寫入',f.file);
}
