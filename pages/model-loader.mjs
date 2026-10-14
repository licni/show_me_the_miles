// Only the roads needed by an explicit query are downloaded. The original
// global record order is restored before running the unchanged query engine.
const ARRAY_KEYS=['lines','centerlines','centerlineRamps','centerlineCorridors','endpointExtensions','mapLines','localIsolatedMarkers','countyBoundaries'];
export function createModelLoader({baseURL=new URL('../',import.meta.url),fetch:fetcher=globalThis.fetch.bind(globalThis),gzip=typeof DecompressionStream==='function',maxCacheBytes=24*1024*1024}={}){
 let manifestPromise,referencePromise;
 const cache=new Map();
 let cachedBytes=0;
 async function readJSON(path,compressed=false){
  const response=await fetcher(new URL(path,baseURL));
  if(!response.ok)throw Error('道路資料下載失敗，請稍後再試。');
  if(!compressed)return response.json();
  const bytes=new Uint8Array(await response.arrayBuffer());
  // Some hosts apply Content-Encoding themselves; avoid decompressing twice.
  if(bytes[0]!==0x1f||bytes[1]!==0x8b)return JSON.parse(new TextDecoder().decode(bytes));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
 }
 async function manifest(){
  if(!manifestPromise)manifestPromise=readJSON('data/manifest.json').then(m=>{
   if(m.schema!==1||!Array.isArray(m.roads)||!m.cells)throw Error('網站資料版本不符，請重新整理。');
   return m;
  }).catch(error=>{manifestPromise=null;throw error;});
  return manifestPromise;
 }
 const descriptorJSON=d=>readJSON(gzip?d.gzip:d.json,gzip);
 async function roadData(descriptor){
  const existing=cache.get(descriptor.id);
  if(existing){cache.delete(descriptor.id);cache.set(descriptor.id,existing);return existing.promise;}
  const entry={bytes:descriptor.bytes,settled:false,promise:null};
  entry.promise=descriptorJSON(descriptor).then(data=>{
   entry.settled=true;cachedBytes+=entry.bytes;
   // Bound retained parsed road data during long field sessions. In-flight
   // readers retain their own references even if a cache entry is evicted.
   for(const [key,value] of cache){
    if(cachedBytes<=maxCacheBytes)break;
    if(!value.settled||key===descriptor.id)continue;
    cache.delete(key);cachedBytes-=value.bytes;
   }
   return data;
  }).catch(error=>{cache.delete(descriptor.id);throw error;});
  cache.set(descriptor.id,entry);
  return entry.promise;
 }
 function emptyModel(m){
  return {provinceAxes:m.provinceAxes,byRoad:{},roadCoverage:{},countyCoverage:m.meta.countyCoverage,countyStats:m.meta.countyStats,...Object.fromEntries(ARRAY_KEYS.map(k=>[k,[]]))};
 }
 async function modelFor(query){
  const m=await manifest();let ids;
  if(query?.mode==='position'&&!query.road){
   const xy=query.xy;
   if(!Array.isArray(xy)||xy.length!==2||!xy.every(v=>typeof v==='number'&&Number.isFinite(v)))ids=[];
   else ids=m.cells[`${Math.floor(xy[0]/m.cellSize)},${Math.floor(xy[1]/m.cellSize)}`]||[];
  }else ids=m.roads.filter(r=>r.hasMileage&&r.name===query?.road).map(r=>r.id);
  const selected=new Set(ids),descriptors=m.roads.filter(r=>selected.has(r.id));
  // Small batches avoid starting hundreds of downloads on a slow connection.
  const pieces=[];
  for(let i=0;i<descriptors.length;i+=4)pieces.push(...await Promise.all(descriptors.slice(i,i+4).map(roadData)));
  const result=emptyModel(m);
  for(const piece of pieces){Object.assign(result.byRoad,piece.byRoad);Object.assign(result.roadCoverage,piece.roadCoverage);}
  for(const key of ARRAY_KEYS)result[key]=pieces.flatMap(p=>p.arrays[key]||[]).sort((a,b)=>a[0]-b[0]).map(p=>p[1]);
  return result;
 }
 async function referenceModel(){
  const m=await manifest();
  if(!referencePromise)referencePromise=descriptorJSON(m.mapFile).catch(error=>{referencePromise=null;throw error;});
  return {...emptyModel(m),...await referencePromise};
 }
 return {metadata:async()=>structuredClone((await manifest()).meta),modelFor,referenceModel};
}
