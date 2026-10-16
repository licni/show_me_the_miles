// Check the published data with the browser query path. Usage: node scripts/test-accuracy.mjs
// 1. Source markers: querying a marker's coordinate returns its mileage.
// 2. Round trip: mileage -> position -> mileage stays within 2 m.
import {readFile} from 'node:fs/promises';
import {createModelLoader} from '../pages/model-loader.mjs';
import {createPagesAPI} from '../pages/query-api.mjs';

const site=new URL('../',import.meta.url);
const loader=createModelLoader({baseURL:new URL('https://example.test/site/'),gzip:false,fetch:async url=>new Response(await readFile(new URL(new URL(url).pathname.replace(/^\/site\//,''),site)))});
const api=createPagesAPI(loader);
const query=async body=>(await api('/api/query',{method:'POST',body:JSON.stringify(body)})).json();
const {roads}=await (await api('/api/meta')).json();
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

const errors=[],misplaced=[],failures=[];let roundTrips=0;
for(const road of roads){
 const markers=(await loader.modelFor({mode:'mile',road,m:-1})).byRoad[road]||[];
 for(let i=0;i<markers.length;i+=Math.max(1,Math.floor(markers.length/60))){
  const marker=markers[i],near=markers.filter(o=>o!==marker&&Math.abs(o.m-marker.m)<=1000);
  // Known bad source rows (position contradicts every nearby mileage) are reported, not scored.
  if(near.length&&!near.some(o=>distance(o.xy,marker.xy)<=1.5*Math.abs(o.m-marker.m)+60)){misplaced.push(`${road} ${marker.m}`);continue;}
  const hit=(await query({mode:'position',xy:marker.xy,road:''})).results.find(r=>r.road===road);
  if(Number.isFinite(hit?.m))errors.push(Math.abs(hit.m-marker.m));
 }
 const {coverage}=await query({mode:'coverage',road});
 for(let m=coverage.min+13;m<coverage.max;m+=Math.max(37,Math.floor((coverage.max-coverage.min)/40))){
  const [first]=(await query({mode:'mile',road,m})).results;if(!first)continue;
  const back=(await query({mode:'position',xy:first.xy,road:''})).results.find(r=>r.road===road);
  roundTrips++;if(!Number.isFinite(back?.m)||Math.abs(back.m-m)>=2)failures.push(`${road} ${m} -> ${back?.m}`);
 }
}
errors.sort((a,b)=>a-b);
const pct=p=>errors[Math.min(errors.length-1,Math.floor(errors.length*p))].toFixed(1);
console.log(`markers: ${errors.length} checked, p50 ${pct(.5)} m, p99 ${pct(.99)} m, max ${pct(1)} m`);
console.log(`misplaced source rows ignored for exact lookup: ${misplaced.join(', ')||'none'}`);
console.log(`round trips: ${roundTrips-failures.length}/${roundTrips} within 2 m`);
for(const f of failures.slice(0,20))console.error('FAIL',f);
if(failures.length||errors.at(-1)>50)process.exit(1);
