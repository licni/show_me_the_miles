// Compare a schema-2 site with an unchanged schema-1 distribution.
// Usage: node scripts/test-shards.mjs /path/to/schema-1-site
// All requests read local files; no hosted service or browser account is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {Worker as ThreadWorker} from 'node:worker_threads';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const siteURL=new URL('../',import.meta.url);
const baselineURL=pathToFileURL(path.resolve(process.argv[2]||fileURLToPath(new URL('../show_me_the_miles_before_shards/',siteURL)))+path.sep);
const baseURL=new URL('https://example.test/nested/show_me_the_miles/');
const fields=['lines','centerlines','centerlineRamps','centerlineCorridors','endpointExtensions','mapLines','localIsolatedMarkers','countyBoundaries'];
const readJSON=async url=>JSON.parse(await fs.readFile(url,'utf8'));
const manifest=await readJSON(new URL('data/manifest.json',siteURL));
const baselineManifest=await readJSON(new URL('data/manifest.json',baselineURL));
assert.equal(manifest.schema,2,'new distribution uses schema 2');
assert.equal(baselineManifest.schema,1,'comparison distribution uses schema 1');
const {createModelLoader}=await import(new URL('pages/model-loader.mjs',siteURL));
const {createPagesAPI}=await import(new URL('pages/query-api.mjs',siteURL));
const {createModelLoader:createBaselineLoader}=await import(new URL('pages/model-loader.mjs',baselineURL));
const {createPagesAPI:createBaselineAPI}=await import(new URL('pages/query-api.mjs',baselineURL));
const {at,tm}=await import(new URL('engine/engine.mjs',baselineURL));
const bytesByURL=new Map();
async function fileBytes(url){
 if(!bytesByURL.has(url.href))bytesByURL.set(url.href,await fs.readFile(url));
 return bytesByURL.get(url.href);
}
const physical=d=>d.parts?d.parts.flatMap(physical):[d];
const paths=d=>physical(d).flatMap(p=>[p.json,p.gzip]);
const verifiedFiles=new Set();
async function descriptorJSON(d,verify=true){
 if(d.parts){
  assert.ok(d.parts.length>0,'multipart descriptor has parts');
  const fragments=await Promise.all(d.parts.map(p=>descriptorJSON(p,verify)));
  for(const fragment of fragments)assert.equal(typeof fragment.fragment,'string','multipart files contain string fragments');
  const text=fragments.map(p=>p.fragment).join('');
  if(verify)assert.equal(Buffer.byteLength(text),d.bytes,'logical descriptor byte count '+d.id);
  return JSON.parse(text);
 }
 const bytes=await fileBytes(new URL(d.json,siteURL));
 if(verify&&!verifiedFiles.has(d.json)){
  assert.ok(d.bytes<=500000,'physical JSON exceeds 500,000 bytes: '+d.json);
  assert.equal(bytes.length,d.bytes,'JSON byte count '+d.json);
  const hash=createHash('sha256').update(bytes).digest('hex').slice(0,16);
  assert.ok(d.json.includes('.'+hash+'.json'),'content hash '+d.json);
  const compressed=await fileBytes(new URL(d.gzip,siteURL));
  assert.equal(compressed.length,d.gzipBytes,'gzip byte count '+d.gzip);
  assert.ok(compressed.length<=500000,'physical gzip exceeds 500,000 bytes: '+d.gzip);
  assert.deepEqual(gunzipSync(compressed),bytes,'gzip and JSON have identical content '+d.json);
  verifiedFiles.add(d.json);
 }
 return JSON.parse(bytes);
}

// Use the old prepared records for sample selection, independently of the new
// index. Never generate expected query results from the new selection logic.
const baselineBundles=new Map();
const originalModel={...Object.fromEntries(fields.map(k=>[k,[]])),byRoad:{},roadCoverage:{}};
for(const d of baselineManifest.roads){
 const bundle=await readJSON(new URL(d.json,baselineURL));
 baselineBundles.set(d.name,bundle);
 Object.assign(originalModel.byRoad,bundle.byRoad);
 Object.assign(originalModel.roadCoverage,bundle.roadCoverage);
 for(const key of fields)originalModel[key].push(...bundle.arrays[key]);
}
for(const key of fields)originalModel[key]=originalModel[key].sort((a,b)=>a[0]-b[0]).map(p=>p[1]);
// The only permitted record change removes complete, remote carriageways from
// ramp records. Compute the 121m expanded-box test from the old coordinates,
// independently of the builder's indexes, and retain every other byte of data.
const bounds=points=>points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
let removedCarriageways=0;
function expectedRamp(r){
 if(!Array.isArray(r.carriageways))return r;
 const box=bounds(r.xy);
 return {...r,carriageways:r.carriageways.filter(line=>{
  const other=bounds(line);
  const kept=other[2]>=box[0]-121&&other[0]<=box[2]+121&&other[3]>=box[1]-121&&other[1]<=box[3]+121;
  if(!kept)removedCarriageways++;
  return kept;
 })};
}
const expectedBundles=new Map([...baselineBundles].map(([name,bundle])=>[name,{...bundle,arrays:{...bundle.arrays,centerlineRamps:bundle.arrays.centerlineRamps.map(([i,r])=>[i,expectedRamp(r)])}}]));
const roads=manifest.roads.filter(r=>r.hasMileage);
const indexPaths=new Set(manifest.roads.flatMap(r=>r.index?paths(r.index):[]));
const mapPaths=new Set(paths(manifest.mapFile));
const shardPaths=new Set();
const indexes=new Map();
assert.deepEqual(manifest.meta,baselineManifest.meta,'metadata is unchanged');
assert.deepEqual(manifest.cells,baselineManifest.cells,'coarse road selection is unchanged');
assert.equal(manifest.cellSize,baselineManifest.cellSize);
assert.equal(manifest.provinceAxes,baselineManifest.provinceAxes);
assert.deepEqual(manifest.roads.map(({id,name,hasMileage})=>({id,name,hasMileage})),baselineManifest.roads.map(({id,name,hasMileage})=>({id,name,hasMileage})),'roads and their order are unchanged');
for(const road of manifest.roads){
 const previous=expectedBundles.get(road.name);
 if(road.bundle){
  for(const p of paths(road.bundle))shardPaths.add(p);
  assert.deepEqual(await descriptorJSON(road.bundle),previous,'complete small-road bundle '+road.name);
  continue;
 }
 const index=await descriptorJSON(road.index);indexes.set(road.name,index);
 assert.deepEqual(index.byRoad,previous.byRoad,'complete source markers '+road.name);
 assert.deepEqual(index.roadCoverage,previous.roadCoverage,'complete coverage '+road.name);
 const loaded=new Map();
 for(const [id,d] of Object.entries(index.files)){
  for(const p of paths(d))shardPaths.add(p);
  loaded.set(id,await descriptorJSON(d));
 }
 // Physical records are compared below after assembling every referenced file.
 const actual=Object.fromEntries(fields.map(k=>[k,new Map()]));
 for(const value of loaded.values()){
  const arrays=value.arrays||value;
  for(const key of fields)for(const pair of arrays[key]||[]){
   assert.ok(Array.isArray(pair)&&pair.length===2,'record shape '+road.name+' '+key);
   if(actual[key].has(pair[0]))assert.deepEqual(actual[key].get(pair[0]),pair[1],'duplicate records agree');
   actual[key].set(pair[0],pair[1]);
  }
 }
 for(const key of fields)assert.deepEqual([...actual[key]].sort((a,b)=>a[0]-b[0]),previous.arrays[key],'all records survive sharding '+road.name+' '+key);
 const recordKeys=new Set();
 for(const r of index.records){
  const key=r.key+':'+r.index;
  assert.ok(!recordKeys.has(key),'index has one entry per original record '+road.name+' '+key);recordKeys.add(key);
  assert.ok(actual[r.key]?.has(r.index),'index points to original record '+road.name+' '+key);
  assert.ok(r.files.length>0,'record has file dependencies');
  for(const id of r.files)assert.ok(loaded.has(id),'record file exists '+id);
  const referenced=r.files.flatMap(id=>{const value=loaded.get(id);return (value.arrays||value)[r.key]||[];});
  assert.ok(referenced.some(([i,record])=>i===r.index&&JSON.stringify(record)===JSON.stringify(actual[r.key].get(r.index))),'record is present in its indexed files '+road.name+' '+key);
  assert.ok(Array.isArray(r.bbox)&&r.bbox.length===4&&r.bbox.every(Number.isFinite),'valid spatial bounds '+key);
  assert.ok(r.range===null||(Array.isArray(r.range)&&r.range.length===2&&r.range.every(Number.isFinite)&&r.range[0]<=r.range[1]),'valid mileage bounds '+key);
 }
 assert.equal(recordKeys.size,fields.reduce((n,k)=>n+previous.arrays[k].length,0),'every original record is indexed '+road.name);
}
assert.deepEqual(await descriptorJSON(manifest.mapFile),await readJSON(new URL(baselineManifest.mapFile.json,baselineURL)),'reference geometry is unchanged');
assert.deepEqual(gunzipSync(await fileBytes(new URL('data/manifest.json.gz',siteURL))),await fileBytes(new URL('data/manifest.json',siteURL)),'manifest gzip matches raw JSON');
for(const entry of await fs.readdir(new URL('data/',siteURL))){
 if(entry.endsWith('.json')||entry.endsWith('.json.gz'))assert.ok((await fs.stat(new URL('data/'+entry,siteURL))).size<=500000,'all physical data files meet limit: '+entry);
}
console.log('PASS: complete road reconstruction with '+removedCarriageways+' provably remote ramp carriageways removed; original ordering, indexes, SHA-256, JSON/gzip and 500,000-byte file limit ('+verifiedFiles.size+' JSON files).');

function fileFetch({root=siteURL,failOnce,decodeGzip=false}={}){
 const calls=[];let failed=false,totalBytes=0;
 const fetch=async input=>{
  const url=new URL(input);
  assert.equal(url.origin,baseURL.origin,'data stays on the site host');
  assert.ok(url.pathname.startsWith(baseURL.pathname),'data respects nested project path: '+url.pathname);
  const relative=decodeURIComponent(url.pathname.slice(baseURL.pathname.length));
  assert.ok(relative&&!relative.split('/').includes('..'),'relative data remains inside site');
  if(/^data\/manifest\.json(?:\.gz)?$/.test(relative))assert.equal(url.search,root.href===siteURL.href?'?v=shards-2':'','manifest version prevents schema-1 cache reuse');
  else assert.equal(url.search,'','content addressed data needs no query parameters');
  calls.push(relative);
  if(!failed&&failOnce?.(relative)){failed=true;return new Response('Temporary unavailable',{status:503});}
  let bytes=await fileBytes(new URL(relative,root));totalBytes+=bytes.length;
  const encoded=relative.endsWith('.gz');if(encoded&&decodeGzip)bytes=gunzipSync(bytes);
  return new Response(bytes,{headers:{'Content-Type':encoded&&!decodeGzip?'application/gzip':'application/json'}});
 };
 return {fetch,calls,get totalBytes(){return totalBytes;}};
}
function newLoader({baseline=false,gzip=true,maxCacheBytes,failOnce,decodeGzip}={}){
 const transport=fileFetch({root:baseline?baselineURL:siteURL,failOnce,decodeGzip});
 const make=baseline?createBaselineLoader:createModelLoader;
 const loader=make({baseURL,fetch:transport.fetch,gzip,...(maxCacheBytes===undefined?{}:{maxCacheBytes})});
 return {transport,loader,api:(baseline?createBaselineAPI:createPagesAPI)(loader)};
}
const queryOptions=q=>({method:'POST',body:JSON.stringify(q)});
const payload=async response=>({status:response.status,data:await response.json()});
const expected=newLoader({baseline:true,maxCacheBytes:128*1024*1024});
const session=newLoader({maxCacheBytes:128*1024*1024});
let checks=0;
async function parity(route,options={},label=route,api=session.api){
 const old=await payload(await expected.api(route,options));
 const current=await payload(await api(route,options));
 assert.deepEqual(current,old,label);checks++;
 return current;
}
const query=(q,label,api)=>parity('/api/query',queryOptions(q),label||JSON.stringify(q),api);
await parity('/api/meta');
assert.deepEqual(session.transport.calls,['data/manifest.json.gz'],'startup downloads only the compressed manifest');
const temporaryMeta=await session.loader.metadata();temporaryMeta.roads.length=0;
assert.equal((await session.loader.metadata()).roads.length,roads.length,'metadata callers cannot mutate future results');
const firstQuery={mode:'mile',road:'台1',start:true};
const startProbe=newLoader();
await Promise.all([query(firstQuery,'concurrent same road A',startProbe.api),query(firstQuery,'concurrent same road B',startProbe.api)]);
assert.equal(new Set(startProbe.transport.calls).size,startProbe.transport.calls.length,'concurrent queries share in-flight files');
const firstCallCount=startProbe.transport.calls.length;
await query(firstQuery,'repeat same road',startProbe.api);
assert.equal(startProbe.transport.calls.length,firstCallCount,'repeat query reuses data');
assert.ok(!startProbe.transport.calls.some(p=>mapPaths.has(p)),'mile query does not load reference-map data');

for(const [road,markers] of Object.entries(originalModel.byRoad)){
 const sorted=[...markers].sort((a,b)=>a.m-b.m),middle=sorted[Math.floor(sorted.length/2)];
 await query({mode:'mile',road,start:true},road+' automatic start');
 await query({mode:'mile',road,m:middle.m},road+' exact marker');
 const gapIndex=sorted.findIndex((p,i)=>i>0&&p.m>sorted[i-1].m+1);
 if(gapIndex>0)await query({mode:'mile',road,m:Math.floor((sorted[gapIndex-1].m+sorted[gapIndex].m)/2)},road+' interpolated or missing interval');
 await query({mode:'coverage',road},road+' coverage');
 await query({mode:'position',xy:middle.xy},road+' automatic position');
}
const reports=[
 [195321.3164,2506234.534],[195805.7690,2506117.896],[197014.0365,2505834.672],
 [196402.7684,2507954.517],[196415.4649,2507704.848],[194670,2484979],
 [194649.5178,2484919.3488],[213627.358,2531024.669],[212863.3194,2512120.146],
 [211045.5334,2499152.273],[195765.1946,2487558.2812],[194161.3599,2487025.0352],
 [208045.6939,2476689.1319],[193393.4477,2485356.1863],[193394.0038,2485357.2821],
 [195751.8579,2487533.0814],[212984.0458,2511673.4680],[197553.8007,2507851.9357],
 [195183.575,2506266.517],[195189.191,2506303.513]
];
for(const xy of reports){
 const {data}=await query({mode:'position',xy},'reported point '+xy);
 for(const r of data.results||[])if(Object.hasOwn(originalModel.byRoad,r.road))await query({mode:'position',road:r.road,xy},'reported explicit '+r.road+' '+xy);
}
for(const ramp of originalModel.centerlineRamps)for(const f of [.1,.5,.9]){
 const s=ramp.length*f,point=at(ramp,s),a=at(ramp,Math.max(0,s-1)),b=at(ramp,Math.min(ramp.length,s+1));
 const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
 for(const offset of length?[-60.1,-59.9,0,59.9,60.1]:[0])await query({mode:'position',xy:length?[point[0]-dy/length*offset,point[1]+dx/length*offset]:point},'ramp '+ramp.road+' '+f+' offset '+offset);
}
for(const corridor of originalModel.centerlineCorridors)await query({mode:'position',xy:at(corridor,corridor.length*.5)},'accepted carriageway '+corridor.road);
for(const marker of originalModel.localIsolatedMarkers){
 await query({mode:'position',xy:marker.xy},'isolated exact '+marker.road);
 await query({mode:'position',xy:[marker.xy[0]+.001,marker.xy[1]]},'isolated near '+marker.road);
}
for(const extension of originalModel.endpointExtensions)await query({mode:'position',xy:at(extension,extension.length*.5)},'endpoint extension '+extension.road);
for(const boundary of originalModel.countyBoundaries){
 const delta=boundary.xy.map((v,i)=>v-boundary.inside[i]),length=Math.hypot(...delta);
 if(length)await query({mode:'position',xy:boundary.xy.map((v,i)=>v+delta[i]/length*5)},'boundary '+boundary.road+' '+boundary.reason);
}
const referenceRoads=new Set();
for(const line of originalModel.mapLines.filter(l=>!Object.hasOwn(originalModel.byRoad,l.road))){
 if(referenceRoads.has(line.road))continue;referenceRoads.add(line.road);
 const points=line.xy||line.ll.map(p=>tm(...p));
 await query({mode:'position',xy:points[Math.floor(points.length/2)]},'reference only '+line.road);
 if(referenceRoads.size>=20)break;
}
assert.ok(referenceRoads.size,'reference-only roads are tested');

let gridCrossings=0;
const gridSizes=[...new Set([manifest.cellSize,manifest.recordCellSize].filter(Number.isFinite))];
for(const gridSize of gridSizes){
 let crossings=0;
 for(const line of [...originalModel.centerlines,...originalModel.lines]){
 if(crossings>=24)break;
 for(let i=1;i<line.xy.length&&crossings<24;i++){
  const a=line.xy[i-1],b=line.xy[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<1)continue;
  let found=false;
  for(let axis=0;axis<2&&!found;axis++){
   const lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]),edge=(Math.floor(lo/gridSize)+1)*gridSize;
   if(edge>hi||Math.abs(b[axis]-a[axis])<1e-9)continue;
   const t=(edge-a[axis])/(b[axis]-a[axis]),xy=a.map((v,j)=>v+(b[j]-v)*t);
   for(const offset of [-60.1,-59.9,0,59.9,60.1])await query({mode:'position',xy:[xy[0]-dy/length*offset,xy[1]+dx/length*offset]},gridSize+'m grid boundary '+crossings+' offset '+offset);
   crossings++;gridCrossings++;found=true;
  }
 }
}
 assert.equal(crossings,24,'real spatial crossings for '+gridSize+'m grid');
}
for(const [road,from,to] of [['台1',392406,393500],['縣187',38175,38275],['屏102',5900,6100],['屏46',3500,3900],['台1',370000,420000],['縣185',10000,50000]]){
 for(const side of [undefined,'forward','backward'])for(const reverse of [false,true])await query({mode:'segment',road,from:reverse?to:from,to:reverse?from:to,...(side?{side}:{})},'segment '+[road,from,to,side,reverse]);
 for(const side of ['forward','backward'])await query({mode:'mile',road,m:from,side},'point side '+road+' '+side);
}
// Sample records immediately either side of every changed physical-file group.
let shardBoundaries=0;
for(const road of roads){
 if(!indexes.has(road.name))continue;
 const records=indexes.get(road.name).records.filter(r=>r.range&&['lines','centerlines'].includes(r.key)).sort((a,b)=>a.range[0]-b.range[0]);
 const boundaries=records.flatMap((r,i)=>i&&records[i-1].files.join(',')!==r.files.join(',')?[i]:[]);
 // First/middle/last transitions of each road bound runtime while exercising
 // short, long and independently partitioned roads instead of only one route.
 for(const i of new Set([boundaries[0],boundaries[Math.floor(boundaries.length/2)],boundaries.at(-1)].filter(Number.isInteger))){
  for(const m of new Set([Math.floor(records[i-1].range[1]),Math.ceil(records[i].range[0])])){
   if(m<0||m>600000)continue;
   for(const delta of [-1,0,1])if(m+delta>=0&&m+delta<=600000)await query({mode:'mile',road:road.name,m:m+delta},'file boundary '+road.name+' '+(m+delta));
  }
  shardBoundaries++;
 }
}
assert.ok(shardBoundaries>0,'cross-file mileage boundaries are tested');
const invalid=[null,[],{}, {mode:'unknown'}, {mode:'position',xy:['195321',2506234]}, {mode:'position',xy:[100,100]},
 {mode:'position',xy:[400001,2500000]}, {mode:'position',road:'__proto__',xy:reports[0]}, {mode:'position',xy:[100000,2300000]},
 {mode:'mile',road:'__proto__',m:1}, {mode:'mile',road:'台1',m:-1}, {mode:'mile',road:'台1',m:600001}, {mode:'mile',road:'台1',m:1.5},
 {mode:'mile',road:'台1',start:true,m:0}, {mode:'mile',road:'台1',start:false}, {mode:'mile',road:'台1',m:395000,side:'north'},
 {mode:'coverage',road:'missing'}, {mode:'segment',road:'台1',from:0,to:60000}, {mode:'segment',road:'台1',from:1,to:'2'}];
for(const q of invalid)await query(q,'validation '+JSON.stringify(q));
await parity('/api/query',{method:'POST',body:'{bad json'},'malformed JSON');
await parity('/api/nonexistent',{},'unknown API');
console.log('PASS: all '+roads.length+' roads, reports, ramps, corridors, gaps, endpoints, '+gridCrossings+' grid crossings, '+shardBoundaries+' shard boundaries, long/reversed/side segments and invalid input.');

assert.ok(!session.transport.calls.some(p=>mapPaths.has(p)),'ordinary queries leave display-only map unloaded');
for(const args of ['west=120&south=21.7&east=121.5&north=23','west=120.59&south=22.48&east=120.64&north=22.53','west=119&south=20&east=123&north=25','west=0&south=0&east=1&north=1','west=120','west=no&south=21&east=122&north=23','west=121&south=21&east=120&north=23'])await parity('/api/map?'+args,{},'map '+args);
const mapCalls=session.transport.calls.filter(p=>mapPaths.has(p));
assert.equal(new Set(mapCalls).size,mapCalls.length,'reference map pieces are downloaded once');
assert.equal(mapCalls.length,physical(manifest.mapFile).length,'all reference map pieces are loaded');
for(const [label,options] of [['plain JSON',{gzip:false}],['host-decoded gzip',{decodeGzip:true}]]){
 const other=newLoader(options);
 await query(firstQuery,label+' start',other.api);
 await query({mode:'position',xy:reports.at(-2)},label+' spatial lookup',other.api);
 await parity('/api/map?west=120.59&south=22.48&east=120.64&north=22.53',{},label+' map',other.api);
 if(options.gzip===false)assert.ok(other.transport.calls.every(p=>!p.endsWith('.gz')),'JSON fallback never downloads gzip');
}
for(const [label,match,action] of [
 ['manifest',p=>/^data\/manifest\.json(?:\.gz)?$/.test(p),s=>s.loader.metadata()],
 ['road index',p=>indexPaths.has(p),s=>s.loader.modelFor(firstQuery)],
 ['road shard',p=>shardPaths.has(p),s=>s.loader.modelFor({mode:'mile',road:'台1',m:395250})],
 ['reference map',p=>mapPaths.has(p),s=>s.loader.referenceModel()]
]){
 const recovering=newLoader({failOnce:match});
 await assert.rejects(()=>action(recovering),undefined,label+' failure propagates');
 await action(recovering);
 assert.ok(recovering.transport.calls.some((p,i,a)=>match(p)&&a.indexOf(p)!==i),label+' failed file is retried');
}
const bounded=newLoader({maxCacheBytes:1});
const boundedQuery={mode:'mile',road:'台1',m:395250};
await query(boundedQuery,'tiny cache first query',bounded.api);
const beforeEviction=[...bounded.transport.calls];
await query({mode:'mile',road:'縣185',m:34544},'tiny cache other road',bounded.api);
await query(boundedQuery,'tiny cache query after eviction',bounded.api);
assert.ok(beforeEviction.some(p=>shardPaths.has(p)&&bounded.transport.calls.filter(c=>c===p).length>1),'evicted shards are fetched again');
const concurrentTiny=newLoader({maxCacheBytes:1});
await Promise.all([query({mode:'segment',road:'台1',from:392406,to:393500,side:'forward'},'in-flight tiny cache A',concurrentTiny.api),query({mode:'position',xy:reports.at(-2)},'in-flight tiny cache B',concurrentTiny.api)]);
console.log('PASS: lazy map, JSON/gzip, host decoding, concurrent requests, failure recovery and LRU with in-flight readers.');

const downloads=[];
for(const [label,q] of [['台1 minimum mileage',firstQuery],['台1 interpolated mileage',{mode:'mile',road:'台1',m:395250}],['reported location',{mode:'position',xy:[195183.575,2506266.517]}]]){
 const before=newLoader({baseline:true}),after=newLoader();
 assert.deepEqual(await payload(await after.api('/api/query',queryOptions(q))),await payload(await before.api('/api/query',queryOptions(q))),label+' cold-load parity');
 assert.ok(after.transport.totalBytes<before.transport.totalBytes,label+' downloads fewer gzip bytes including indexes');
 assert.ok(after.transport.totalBytes<=500000,label+' cold query fits the 500,000-byte target including manifest/indexes: '+after.transport.totalBytes);
 downloads.push({query:label,beforeBytes:before.transport.totalBytes,afterBytes:after.transport.totalBytes,reductionPercent:Math.round((1-after.transport.totalBytes/before.transport.totalBytes)*100)});
}
console.log('PASS: cold-query transfer reduction '+JSON.stringify(downloads));

for(const relative of (await fs.readdir(siteURL,{recursive:true})).filter(p=>p.endsWith('.mjs')&&!p.startsWith('scripts/'))){
 const file=new URL(relative,siteURL),source=await fs.readFile(file,'utf8');
 const parsed=spawnSync(process.execPath,['--check',fileURLToPath(file)],{encoding:'utf8'});
 assert.equal(parsed.status,0,'module syntax '+relative+'\n'+parsed.stderr);
 for(const match of source.matchAll(/^\s*(?:import\s+[^\n;]*?\bfrom\s*|export\s+[^\n;]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm)){
  assert.ok(match[1].startsWith('.'),'browser import is relative: '+relative);
  const imported=new URL(match[1],file);assert.ok(imported.href.startsWith(siteURL.href));imported.search='';assert.ok((await fs.stat(imported)).isFile());
 }
}
const html=await fs.readFile(new URL('index.html',siteURL),'utf8');
for(const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g)){
 assert.ok(!match[1].startsWith('/'),'HTML assets support subpaths');const asset=new URL(match[1],siteURL);asset.search='';assert.ok((await fs.stat(asset)).isFile());
}
const workerFetches=[],threads=[];
class BrowserWorkerAdapter{
 constructor(url,options){
  assert.equal(options?.type,'module');
  const workerFile=new URL(url);assert.ok(!workerFile.search||workerFile.search==='?v=shards-2','known worker version');workerFile.search='';
  assert.equal(workerFile.href,new URL('pages/query-worker.mjs',siteURL).href);
  const source=`
   const {parentPort}=require('node:worker_threads');
   const fs=require('node:fs/promises');
   const root=${JSON.stringify(siteURL.href)};
   globalThis.self={postMessage:data=>parentPort.postMessage(data)};
   globalThis.fetch=async input=>{
    const url=new URL(input);if(!url.href.startsWith(root))throw Error('External worker request: '+url);
    const search=url.search;url.search='';
    const relative=url.href.slice(root.length);
    if(relative==='data/manifest.json'||relative==='data/manifest.json.gz'){
     if(search!=='?v=shards-2')throw Error('Unversioned worker manifest');
    }else if(search)throw Error('Unexpected query on content-addressed data');
    parentPort.postMessage({testFetch:relative});
    return new Response(await fs.readFile(url),{headers:{'Content-Type':'application/octet-stream'}});
   };
   (async()=>{await import(${JSON.stringify(url.href)});parentPort.on('message',data=>self.onmessage({data}));})().catch(error=>{throw error;});
  `;
  this.thread=new ThreadWorker(source,{eval:true});threads.push(this.thread);
  this.thread.on('message',data=>{if(data.testFetch)workerFetches.push(data.testFetch);else this.onmessage?.({data});});
  this.thread.on('error',error=>this.onerror?.(error));this.thread.on('messageerror',error=>this.onmessageerror?.(error));
 }
 postMessage(data){this.thread.postMessage(data);}
 terminate(){return this.thread.terminate();}
}
const previousWorker=globalThis.Worker;globalThis.Worker=BrowserWorkerAdapter;
try{
 const {apiFetch}=await import(new URL('pages/client.mjs',siteURL));
 await parity('/api/meta',{},'real worker startup',apiFetch);
 assert.deepEqual(workerFetches,['data/manifest.json.gz'],'real worker starts without road data');
 await Promise.all([query(firstQuery,'real worker road one',apiFetch),query({mode:'position',xy:reports.at(-2)},'real worker spatial',apiFetch),parity('/api/query',{method:'POST',body:'{bad'},'real worker invalid input',apiFetch)]);
 const count=workerFetches.length;await query(firstQuery,'real worker cached query',apiFetch);
 assert.equal(workerFetches.length,count,'worker reuses loaded data');assert.equal(threads.length,1,'one shared worker');
}finally{
 await Promise.all(threads.map(t=>t.terminate()));
 if(previousWorker===undefined)delete globalThis.Worker;else globalThis.Worker=previousWorker;
}
console.log('PASS: relative dependencies, nested URLs and real client/Worker message flow.');
console.log(`PASS: ${checks} schema-2 responses exactly match the schema-1 distribution.`);
