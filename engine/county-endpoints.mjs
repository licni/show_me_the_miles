import {project,at} from './engine.mjs';
import {beyondCountyEnd} from './county.mjs';
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function result(line,p,query){
 const along=p.s,basis=line.sourceLength<1e-6?'tangent':along<=line.sourceLength+1e-6?'road-shape':'road-shape+tangent';
 return {...p,line,m:line.marker.m+line.sign*along,refs:[{marker:line.marker}],distance:along,sourceKind:'county-endpoint-estimate',method:'端點延伸推估',endpointExtension:{fromM:line.marker.m,side:line.side,along,endpointDistance:distance(query,line.marker.xy),basis}};
}
export function endpointPositionCandidates(model,xy,road=''){
 const results=[];
 for(const line of model.endpointExtensions||[]){
  if((road&&line.road!==road)||distance(xy,line.marker.xy)>30+1e-7)continue;
  const p=project(xy,line.xy);
  if(p.s<=1e-7||p.d>10+1e-7||beyondCountyEnd(xy,line,p))continue;
  // A lateral point near the tangent origin is not forward road progress.
  if(p.s>line.sourceLength+1e-7&&p.d>p.s-line.sourceLength+1e-7)continue;
  results.push(result(line,p,xy));
 }
 return results.sort((a,b)=>a.d-b.d);
}
export function endpointReverse(model,road,m){
 if(!Number.isFinite(m)||m<0)return [];
 return (model.endpointExtensions||[]).filter(line=>line.road===road).flatMap(line=>{
  const s=(m-line.marker.m)*line.sign;
  if(s<=0||s>line.length+1e-7)return [];
  const xy=at(line,Math.min(s,line.length));return [result(line,{s,xy,d:0},xy)];
 });
}
