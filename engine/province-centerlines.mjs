import {project,at} from './engine.mjs';
import {beyondCountyEnd} from './county.mjs';

// Shared route stationing is deliberately separate from the source lane paths.
// Once a corridor is accepted, a closer lane or slip road must not reintroduce
// its own accumulated distance. Unsupported axes remain without estimated
// mileage; production never falls back to directional carriageway stationing.
function inference(line,s){
 const anchors=line.anchors;
 if(s<-1e-7||s>line.length+1e-7)return null;
 for(let i=1;i<anchors.length;i++){
  const a=anchors[i-1],b=anchors[i],before=s<a.s-1e-7,after=s>b.s+1e-7;
  if(before&&!(i===1&&line.extrapolateStart)||after&&!(i===anchors.length-1&&line.extrapolateEnd))continue;
  const t=(s-a.s)/(b.s-a.s);
  const distance=Math.min(Math.abs(s-a.s),Math.abs(b.s-s));
  if((before||after)&&distance>1200+1e-7)return null;
  return {m:a.marker.m+t*(b.marker.m-a.marker.m),refs:[a,b],distance,method:before||after?'道路中心線末段沿線推估':'共用主線中心線內插',sourceKind:'province-centerline',...(before||after?{centerlineExtrapolation:true}:{})};
 }
 return null;
}
function station(line,m){
 for(let i=1;i<line.anchors.length;i++){
  const a=line.anchors[i-1],b=line.anchors[i];
  const s=a.s+(m-a.marker.m)*(b.s-a.s)/(b.marker.m-a.marker.m);
  if(s<-1e-7||s>line.length+1e-7)continue;
  const before=s<a.s-1e-7,after=s>b.s+1e-7;
  if(before&&!(i===1&&line.extrapolateStart)||after&&!(i===line.anchors.length-1&&line.extrapolateEnd))continue;
  if((before||after)&&Math.min(Math.abs(s-a.s),Math.abs(b.s-s))>1200+1e-7)continue;
  return Math.max(0,Math.min(line.length,s));
 }
 return null;
}
export function centerlinePositionCandidates(model,xy,road=''){
 const results=[];
 for(const line of model.centerlines||[]){
  if(road&&line.road!==road)continue;
  const b=line.bbox;
  if(b&&(xy[0]<b[0]-60||xy[0]>b[2]+60||xy[1]<b[1]-60||xy[1]>b[3]+60))continue;
  const p=project(xy,line.xy);
  if(p.d>60||beyondCountyEnd(xy,line,p))continue;
  const r=inference(line,p.s);
  if(r&&r.m>=0)results.push({...r,...p,line});
 }
 // At a concave junction, nearest perpendiculars to the two mainline legs can
 // jump in station. On a confirmed slip road use its two mainline tie stations
 // continuously. Its own length is only a fraction, never added to stationing.
 const mapped=new Set();
 const nearbyRamps=(model.centerlineRamps||[]).filter(r=>!road||r.road===road).map(ramp=>({ramp,p:project(xy,ramp.xy)})).sort((a,b)=>a.p.d-b.p.d);
 for(const {ramp,p} of nearbyRamps){
  if(mapped.has(ramp.road))continue;
  const allowed=line=>line.road===ramp.road&&(!ramp.centerlineId||line.id===ramp.centerlineId)&&(!ramp.allowedLineIds||ramp.allowedLineIds.includes(line.id));
  const base=results.filter(r=>allowed(r.line)).sort((a,b)=>a.d-b.d)[0];
  if(!base)continue;
  if(p.d>60||p.d>=base.d||beyondCountyEnd(xy,ramp,p))continue;
  // A lane itself is laterally offset from the shared axis. Compare against
  // its original geometry too, so proximity to a merging ramp cannot make a
  // point on the main carriageway switch stationing methods.
  if((ramp.carriageways||[]).some(points=>project(xy,points).d<=p.d+.25))continue;
  const m=ramp.fromM+(ramp.toM-ramp.fromM)*p.s/ramp.length;
  const targets=(model.centerlines||[]).filter(allowed).map(line=>({line,s:station(line,m)})).filter(r=>r.s!==null).map(r=>({...r,point:at(r.line,r.s)})).sort((a,b)=>Math.hypot(xy[0]-a.point[0],xy[1]-a.point[1])-Math.hypot(xy[0]-b.point[0],xy[1]-b.point[1]));
  if(!targets.length)continue;
  const {line,s,point}=targets[0],d=Math.hypot(xy[0]-point[0],xy[1]-point[1]);
  if(d>60)continue;
  const r=inference(line,s);if(!r)continue;
  for(let i=results.length-1;i>=0;i--)if(results[i].line.road===ramp.road)results.splice(i,1);
  results.push({...r,line,s,xy:point,d,sourceKind:'province-ramp-estimate',distanceKind:'mainline-offset',method:'引道兩端對應主線里程內插'});
  mapped.add(ramp.road);
 }
 return results.sort((a,b)=>a.d-b.d);
}
export function centerlineReverse(model,road,m){
 const results=[];
 for(const line of model.centerlines||[]){
  if(line.road!==road)continue;
  const s=station(line,m);if(s===null)continue;
  const r=inference(line,s);
  if(r)results.push({...r,line,s,xy:at(line,s)});
 }
 return results;
}
