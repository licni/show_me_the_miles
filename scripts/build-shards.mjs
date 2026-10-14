#!/usr/bin/env node
import {readFile,writeFile,mkdir,readdir,rm,mkdtemp,copyFile} from 'node:fs/promises';
import {resolve,basename,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {tm} from '../engine/engine.mjs';

// Repack either the original road files or an existing sharded release. Source
// polylines and global order stay intact; proven-irrelevant ramp guards are removed.
const defaultData=fileURLToPath(new URL('../data/',import.meta.url));
const source=resolve(process.argv[2]||defaultData),destination=resolve(process.argv[3]||source);
const reportPath=resolve(process.argv[4]||fileURLToPath(new URL('./data-build-report.json',import.meta.url)));
const MAX_BYTES=500000,TARGET_BYTES=450000,PAGE_BYTES=100000,RECORD_CELL_SIZE=500;
const keys=['lines','centerlines','centerlineRamps','centerlineCorridors','endpointExtensions','mapLines','localIsolatedMarkers','countyBoundaries'];
const byteLength=text=>Buffer.byteLength(text,'utf8');
const parseFile=async path=>JSON.parse(await readFile(join(source,basename(path)),'utf8'));
async function readDescriptor(descriptor){
 if(descriptor.parts){const pieces=await Promise.all(descriptor.parts.map(readDescriptor));return JSON.parse(pieces.map(p=>p.fragment).join(''));}
 return parseFile(descriptor.json);
}
function points(record){
 let xy=record.xy;
 if(!xy&&record.ll)xy=record.ll.map(p=>tm(...p));
 if(!xy)return [];
 if(typeof xy[0]==='number')xy=[xy];
 return xy.filter(p=>Array.isArray(p)&&p.every(Number.isFinite));
}
function bounds(record){
 const xy=points(record);
 const b=[Infinity,Infinity,-Infinity,-Infinity];
 for(const p of xy){b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1]);}
 return b.every(Number.isFinite)?b:null;
}
function spatialCells(record){
 const xy=points(record),cells=new Set(),margin=100;
 for(let i=0;i<xy.length;i++){
  const a=xy[i],b=xy[Math.min(i+1,xy.length-1)];
  const x0=Math.floor((Math.min(a[0],b[0])-margin)/RECORD_CELL_SIZE),x1=Math.floor((Math.max(a[0],b[0])+margin)/RECORD_CELL_SIZE);
  const y0=Math.floor((Math.min(a[1],b[1])-margin)/RECORD_CELL_SIZE),y1=Math.floor((Math.max(a[1],b[1])+margin)/RECORD_CELL_SIZE);
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)cells.add(`${x},${y}`);
 }
 return [...cells];
}
const rampReport=[];
function pruneRemoteCarriageways(piece){
 for(const [,ramp] of piece.arrays.centerlineRamps||[]){
  if(!ramp.carriageways?.length)continue;
  const rampBounds=bounds(ramp);if(!rampBounds)continue;
  const inputCount=ramp.carriageways.length,keptIndices=[],before=byteLength(JSON.stringify(ramp));
  // A considered query lies <=60 m from the ramp. A carriageway only affects
  // that query within another 60.25 m. An axis-aligned gap >121 m therefore
  // proves it cannot take part; complete retained polylines stay untouched.
  ramp.carriageways=ramp.carriageways.filter((xy,index)=>{
   const b=bounds({xy}),keep=!b||b[0]<=rampBounds[2]+121&&b[2]>=rampBounds[0]-121&&b[1]<=rampBounds[3]+121&&b[3]>=rampBounds[1]-121;
   if(keep)keptIndices.push(index);return keep;
  });
  rampReport.push({road:ramp.road,id:ramp.id,inputCount,retainedCount:ramp.carriageways.length,removedCount:inputCount-ramp.carriageways.length,keptIndices,bytesBefore:before,bytesAfter:byteLength(JSON.stringify(ramp))});
 }
}
function mileageRange(key,record){
 const anchors=record.anchors||[],values=anchors.map(a=>a.marker?.m).filter(Number.isFinite);
 if(key==='centerlines'&&anchors.length>=2){
  for(const [enabled,a,b,s] of [
   [record.extrapolateStart,anchors[0],anchors[1],Math.max(0,anchors[0].s-1200)],
   [record.extrapolateEnd,anchors.at(-2),anchors.at(-1),Math.min(record.length,anchors.at(-1).s+1200)]
  ])if(enabled&&b.s!==a.s)values.push(a.marker.m+(s-a.s)*(b.marker.m-a.marker.m)/(b.s-a.s));
 }
 if(key==='lines'&&!['county50','county-gap-estimate'].includes(record.sourceKind)&&values.length){
  // Legacy directional lines allow a 1,200 m extrapolation. The wider mileage
  // interval also covers their accepted scale range without changing inference.
  const scale=record.sourceKind==='province-linked'&&anchors.length>=2?Math.abs((anchors[1].marker.m-anchors[0].marker.m)/(anchors[1].s-anchors[0].s)):1.3;
  if(Number.isFinite(scale))values.push(Math.min(...values)-1200*scale,Math.max(...values)+1200*scale);
 }
 if(key==='endpointExtensions')values.push(record.marker.m,record.marker.m+record.sign*record.length);
 if(key==='localIsolatedMarkers')values.push(record.m);
 if(key==='centerlineRamps')values.push(record.fromM,record.toM);
 const finite=values.filter(Number.isFinite);
 return finite.length?[Math.min(...finite),Math.max(...finite)]:null;
}
function recordIndex(key,index,record,fileId){
 const entry={key,index,files:[fileId],bbox:bounds(record),cells:spatialCells(record),range:mileageRange(key,record)};
 for(const field of ['id','axisSources','axisId','axisIds','allowedLineIds','centerlineId'])if(Object.hasOwn(record,field))entry[field]=record[field];
 return entry;
}

const manifest=await parseFile('manifest.json');
if(![1,2].includes(manifest.schema))throw Error('Unsupported data schema.');
const stage=await mkdtemp(join(tmpdir(),'milestone-shards-'));
const outputFiles=new Set();let physicalCount=0,maxJSONBytes=0,maxGzipBytes=0;
async function physical(serialized,label){
 const bytes=byteLength(serialized),compressed=gzipSync(serialized,{level:9,mtime:0});
 if(bytes>MAX_BYTES||compressed.length>MAX_BYTES)throw Error(`File exceeds ${MAX_BYTES} bytes: ${label}`);
 const hash=createHash('sha256').update(serialized).digest('hex').slice(0,16),name=`${label}.${hash}.json`;
 await writeFile(join(stage,name),serialized);await writeFile(join(stage,name+'.gz'),compressed);
 outputFiles.add(name);outputFiles.add(name+'.gz');physicalCount++;
 maxJSONBytes=Math.max(maxJSONBytes,bytes);maxGzipBytes=Math.max(maxGzipBytes,compressed.length);
 return {json:`data/${name}`,gzip:`data/${name}.gz`,bytes,gzipBytes:compressed.length};
}
async function descriptor(value,label){
 const serialized=JSON.stringify(value),bytes=byteLength(serialized);
 // Gzip headers can make an incompressible input slightly larger. The payload
 // target leaves room while the final physical-size assertion remains strict.
 if(bytes<=MAX_BYTES-1000)return physical(serialized,label);
 const parts=[];let offset=0;
 while(offset<serialized.length){
  let low=1,high=Math.min(serialized.length-offset,MAX_BYTES),take=1;
  while(low<=high){const mid=Math.floor((low+high)/2),n=byteLength(JSON.stringify({fragment:serialized.slice(offset,offset+mid)}));if(n<=TARGET_BYTES){take=mid;low=mid+1;}else high=mid-1;}
  parts.push(await physical(JSON.stringify({fragment:serialized.slice(offset,offset+take)}),`${label}-part${String(parts.length).padStart(3,'0')}`));offset+=take;
 }
 return {parts,bytes};
}
async function readRoad(road){
 if(manifest.schema===1)return readDescriptor(road);
 if(road.bundle)return readDescriptor(road.bundle);
 const index=await readDescriptor(road.index),arrays=Object.fromEntries(keys.map(k=>[k,[]]));
 for(const file of Object.values(index.files)){const payload=await readDescriptor(file);for(const key of keys)arrays[key].push(...(payload.arrays[key]||[]));}
 for(const key of keys)arrays[key].sort((a,b)=>a[0]-b[0]);
 return {byRoad:index.byRoad,roadCoverage:index.roadCoverage,arrays};
}

try{
 const roads=[];
 for(const road of manifest.roads){
  const piece=await readRoad(road);
  pruneRemoteCarriageways(piece);
  // Small complete roads fit in one request; an extra index would cost more
  // network round trips than the records it could avoid downloading.
  if(byteLength(JSON.stringify(piece))<=150000){
   roads.push({id:road.id,name:road.name,hasMileage:road.hasMileage,bundle:await descriptor(piece,`shard-${road.id}-bundle`)});
   continue;
  }
  const index={byRoad:piece.byRoad,roadCoverage:piece.roadCoverage,records:[],files:{}};
  const groups=new Map();let part=0;
  for(const key of keys)for(const pair of piece.arrays[key]||[]){
   const b=bounds(pair[1]),large=byteLength(JSON.stringify(pair))>PAGE_BYTES;
   // A local query commonly needs several record types. Keep nearby calibration,
   // ramps and reference lines together to avoid extra network round trips.
   const group=large?`record-${key}-${pair[0]}`:b?`${Math.floor((b[0]+b[2])/4000)},${Math.floor((b[1]+b[3])/4000)}`:`record-${key}-${pair[0]}`;
   if(!groups.has(group))groups.set(group,[]);groups.get(group).push({key,pair});
  }
  for(const entries of groups.values()){
   let pending=[];
   const payload=items=>({arrays:items.reduce((arrays,{key,pair})=>{(arrays[key]??=[]).push(pair);return arrays;},{})});
   async function flush(){
    if(!pending.length)return;
    const fileId=`area-${String(part++).padStart(3,'0')}`;
    index.files[fileId]=await descriptor(payload(pending),`shard-${road.id}-${fileId}`);
    for(const {key,pair:[n,record]} of pending)index.records.push(recordIndex(key,n,record,fileId));
    pending=[];
   }
   for(const entry of entries){
    if(pending.length&&byteLength(JSON.stringify(payload([...pending,entry])))>PAGE_BYTES)await flush();
    pending.push(entry);
    if(byteLength(JSON.stringify(payload(pending)))>PAGE_BYTES)await flush();
   }
   await flush();
  }
  roads.push({id:road.id,name:road.name,hasMileage:road.hasMileage,index:await descriptor(index,`index-${road.id}`)});
 }
 const mapFile=await descriptor(await readDescriptor(manifest.mapFile),'reference-map');
 const result={schema:2,maxFileBytes:MAX_BYTES,recordCellSize:RECORD_CELL_SIZE,provinceAxes:manifest.provinceAxes,cellSize:manifest.cellSize,meta:manifest.meta,cells:manifest.cells,roads,mapFile};
 const manifestJSON=JSON.stringify(result);
 if(byteLength(manifestJSON)>MAX_BYTES)throw Error('Root manifest exceeds maximum size.');
 await writeFile(join(stage,'manifest.json'),manifestJSON);outputFiles.add('manifest.json');
 const compressedManifest=gzipSync(manifestJSON,{level:9,mtime:0});
 if(compressedManifest.length>MAX_BYTES)throw Error('Compressed root manifest exceeds maximum size.');
 await writeFile(join(stage,'manifest.json.gz'),compressedManifest);outputFiles.add('manifest.json.gz');
 maxGzipBytes=Math.max(maxGzipBytes,compressedManifest.length);
 await mkdir(destination,{recursive:true});
 // All reads and generated-size checks finish before replacing release files.
 for(const name of outputFiles)await copyFile(join(stage,name),join(destination,name));
 for(const name of await readdir(destination))if(/^(?:r\d+\.|shard-|index-|reference-map\.).*\.json(?:\.gz)?$/.test(name)&&!outputFiles.has(name))await rm(join(destination,name));
 await writeFile(reportPath,JSON.stringify({carriagewayMarginMeters:121,ramps:rampReport},null,2)+'\n');
 console.log(JSON.stringify({schema:2,roads:roads.length,physicalJSONFiles:physicalCount+1,maxJSONBytes:Math.max(maxJSONBytes,byteLength(manifestJSON)),maxGzipBytes,manifestBytes:byteLength(manifestJSON),destination}));
}finally{await rm(stage,{recursive:true,force:true});}
