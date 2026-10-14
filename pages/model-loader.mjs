const ARRAY_KEYS=['lines','centerlines','centerlineRamps','centerlineCorridors','endpointExtensions','mapLines','localIsolatedMarkers','countyBoundaries'];
const MILEAGE_KEYS=new Set(['lines','centerlines','endpointExtensions']);

// Select complete records, including their calibration and branch dependencies.
// Transport chunks never become new geometry endpoints or mileage anchors.
function selectRecords(index,query,cellSize){
 const records=index.records,selected=new Set();
 if(query?.mode==='position'){
  const xy=query.xy;
  if(!Array.isArray(xy)||xy.length!==2||!xy.every(v=>typeof v==='number'&&Number.isFinite(v)))return [];
  const cell=cellSize?`${Math.floor(xy[0]/cellSize)},${Math.floor(xy[1]/cellSize)}`:null;
  for(const record of records){
   if(cell&&record.cells){if(record.cells.includes(cell))selected.add(record);continue;}
   const b=record.bbox;
   if(!b||(xy[0]>=b[0]-100&&xy[0]<=b[2]+100&&xy[1]>=b[1]-100&&xy[1]<=b[3]+100))selected.add(record);
  }
  for(const record of [...selected]){
   if(record.key==='centerlineRamps'){
    for(const line of records)if(line.key==='centerlines'&&(!record.centerlineId||line.id===record.centerlineId)&&(!record.allowedLineIds||record.allowedLineIds.includes(line.id)))selected.add(line);
   }
   if(record.key==='centerlineCorridors'){
    for(const line of records)if(line.key==='mapLines'&&(record.axisIds||[]).includes(line.axisId))selected.add(line);
   }
  }
 }else if(query?.mode==='mile'||query?.mode==='segment'){
  const markers=Object.values(index.byRoad).flat();let low,high;
  if(query.mode==='mile'){
   const m=query.start===true?markers.reduce((n,p)=>Number.isInteger(p.m)&&p.m>=0?Math.min(n,p.m):n,Infinity):query.m;
   if(typeof m!=='number'||!Number.isFinite(m))return [];
   if(!query.side&&markers.some(p=>p.m===m))return [];
   low=m-(query.side?5:0);high=m+(query.side?5:0);
  }else{
   if(![query.from,query.to].every(v=>typeof v==='number'&&Number.isFinite(v)))return [];
   low=Math.min(query.from,query.to);high=Math.max(query.from,query.to);
  }
  for(const record of records)if(MILEAGE_KEYS.has(record.key)&&(!record.range||(record.range[0]<=high+1e-5&&record.range[1]>=low-1e-5)))selected.add(record);
 }
 return records.filter(record=>selected.has(record));
}

export function createModelLoader({baseURL=new URL('../',import.meta.url),fetch:fetcher=globalThis.fetch.bind(globalThis),gzip=typeof DecompressionStream==='function',maxCacheBytes=24*1024*1024}={}){
 let manifestPromise,referencePromise,cachedBytes=0,activeReads=0;
 const cache=new Map(),waiting=[];
 async function readJSON(path,compressed=false){
  // Limit downloads and decoding together on devices with little memory.
  await new Promise(resolve=>{if(activeReads<2){activeReads++;resolve();}else waiting.push(resolve);});
  try{
   const response=await fetcher(new URL(path,baseURL));
   if(!response.ok)throw Error('道路資料下載失敗，請稍後再試。');
   if(!compressed)return await response.json();
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes[0]!==0x1f||bytes[1]!==0x8b)return JSON.parse(new TextDecoder().decode(bytes));
   return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  }finally{
   const next=waiting.shift();if(next)next();else activeReads--;
  }
 }
 async function manifest(){
  if(!manifestPromise)manifestPromise=readJSON(gzip?'data/manifest.json.gz?v=shards-2':'data/manifest.json?v=shards-2',gzip).then(m=>{
   if(![1,2].includes(m.schema)||!Array.isArray(m.roads)||!m.cells)throw Error('網站資料版本不符，請重新整理。');
   return m;
  }).catch(error=>{manifestPromise=null;throw error;});
  return manifestPromise;
 }
 async function descriptorJSON(descriptor){
  if(descriptor.parts){
   const fragments=[];
   for(const part of descriptor.parts){
    const value=await descriptorJSON(part);
    if(typeof value.fragment!=='string')throw Error('道路資料不完整，請重新整理。');
    fragments.push(value.fragment);
   }
   return JSON.parse(fragments.join(''));
  }
  return readJSON(gzip?descriptor.gzip:descriptor.json,gzip);
 }
 async function dataFor(descriptor){
  const key=descriptor.id||descriptor.json||descriptor.parts?.[0]?.json;
  const existing=cache.get(key);
  if(existing){cache.delete(key);cache.set(key,existing);return existing.promise;}
  const entry={bytes:descriptor.bytes,settled:false,promise:null};
  entry.promise=descriptorJSON(descriptor).then(data=>{
   entry.settled=true;cachedBytes+=entry.bytes;
   for(const [id,value] of cache){
    if(cachedBytes<=maxCacheBytes)break;
    if(!value.settled||id===key)continue;
    cache.delete(id);cachedBytes-=value.bytes;
   }
   return data;
  }).catch(error=>{if(cache.get(key)===entry)cache.delete(key);throw error;});
  cache.set(key,entry);
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
  const wanted=new Set(ids),roads=m.roads.filter(r=>wanted.has(r.id));
  const result=emptyModel(m),arrays=Object.fromEntries(ARRAY_KEYS.map(k=>[k,[]]));
  // Fetch independent road indexes together; the shared queue still allows
  // only two downloads/decodes at once, including concurrent user queries.
  const prepared=await Promise.all(roads.map(road=>dataFor(m.schema===1?road:road.bundle||road.index)));
  for(let roadIndex=0;roadIndex<roads.length;roadIndex++){
   const road=roads[roadIndex];
   if(m.schema===1||road.bundle){
    const piece=prepared[roadIndex];
    Object.assign(result.byRoad,piece.byRoad);Object.assign(result.roadCoverage,piece.roadCoverage);
    for(const key of ARRAY_KEYS)arrays[key].push(...piece.arrays[key]||[]);
    continue;
   }
   const index=prepared[roadIndex],selected=selectRecords(index,query,m.recordCellSize);
   Object.assign(result.byRoad,index.byRoad);Object.assign(result.roadCoverage,index.roadCoverage);
   const selectedIds=new Set(selected.map(r=>`${r.key}:${r.index}`));
   const fileIds=[...new Set(selected.flatMap(r=>r.files))];
   for(let i=0;i<fileIds.length;i+=2){
    const pieces=await Promise.all(fileIds.slice(i,i+2).map(id=>dataFor(index.files[id])));
    for(const piece of pieces)for(const key of ARRAY_KEYS){
     for(const item of piece.arrays[key]||[])if(selectedIds.has(`${key}:${item[0]}`))arrays[key].push(item);
    }
   }
  }
  for(const key of ARRAY_KEYS)result[key]=arrays[key].sort((a,b)=>a[0]-b[0]).map(item=>item[1]);
  return result;
 }
 async function referenceModel(){
  const m=await manifest();
  if(!referencePromise)referencePromise=descriptorJSON(m.mapFile).catch(error=>{referencePromise=null;throw error;});
  return {...emptyModel(m),...await referencePromise};
 }
 return {metadata:async()=>structuredClone((await manifest()).meta),modelFor,referenceModel};
}
