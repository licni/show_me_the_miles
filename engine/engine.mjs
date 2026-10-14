import {inferCounty,isCountyLine,beyondCountyEnd as beyondLineEnd} from './county.mjs';
import {endpointReverse} from './county-endpoints.mjs';
import {centerlinePositionCandidates,centerlineReverse} from './province-centerlines.mjs';
export function tm(lon,lat){
 const a=6378137,f=1/298.257222101,e=f*(2-f),ep=e/(1-e),p=lat*Math.PI/180,A=(lon-121)*Math.PI/180*Math.cos(p),T=Math.tan(p)**2,C=ep*Math.cos(p)**2,N=a/Math.sqrt(1-e*Math.sin(p)**2);
 const M=a*((1-e/4-3*e**2/64-5*e**3/256)*p-(3*e/8+3*e**2/32+45*e**3/1024)*Math.sin(2*p)+(15*e**2/256+45*e**3/1024)*Math.sin(4*p)-35*e**3/3072*Math.sin(6*p));
 return [250000+.9999*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep)*A**5/120),.9999*(M+N*Math.tan(p)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep)*A**6/720))];
}
export function ll(x,y){let lon=121+(x-250000)/102800,lat=y/110750;for(let i=0;i<6;i++){const p=tm(lon,lat),u=tm(lon+.00001,lat),v=tm(lon,lat+.00001),a=(u[0]-p[0])/.00001,b=(v[0]-p[0])/.00001,c=(u[1]-p[1])/.00001,d=(v[1]-p[1])/.00001,dx=x-p[0],dy=y-p[1],det=a*d-b*c;lon+=(d*dx-b*dy)/det;lat+=(-c*dx+a*dy)/det;}return [lon,lat];}
export function project(q,pts){let best={d:Infinity},s=0;for(let i=0;i<pts.length-1;i++){let a=pts[i],b=pts[i+1],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),t=len?Math.max(0,Math.min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/len**2)):0,xy=[a[0]+t*dx,a[1]+t*dy],d=Math.hypot(q[0]-xy[0],q[1]-xy[1]);if(d<best.d)best={d,s:s+t*len,xy};s+=len;}return best;}
export function at(line,s){let n=0;for(let i=0;i<line.xy.length-1;i++){let a=line.xy[i],b=line.xy[i+1],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(n+d>=s){let t=d?(s-n)/d:0;return [a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];}n+=d;}return line.xy.at(-1);}
export function formatM(m){const n=Math.round(m);return `${Math.floor(n/1000)}K+${String(n%1000).padStart(3,'0')}`;}
export function parseM(text){let t=text.trim(),m=t.match(/^(\d+)\s*[kKＫｋ]\s*\+?\s*(\d{1,3})?$/)||t.match(/^(\d+)\s*\+\s*(\d{1,3})$/);if(m)return Number(m[1])*1000+Number(m[2]||0);if(/^\d+(\.\d{1,3})?$/.test(t))return Math.round(Number(t)*1000);throw Error('請輸入 395K+500、395+500 或 395.500。');}
export function prepare(data){
 const byRoad={};for(const m of data.markers)(byRoad[m.road]??=[]).push(m);
 const lines=data.lines.map(l=>{const xy=l.ll.map(p=>tm(...p)),length=xy.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-xy[i][0],p[1]-xy[i][1]),0),projected=(byRoad[l.road]||[]).map(m=>({...project(m.xy,xy),marker:m}));
 const anchors=projected.filter(p=>p.d<=35&&!beyondLineEnd(p.marker.xy,{xy,length},p)).sort((a,b)=>a.s-b.s),clean=[];for(const a of anchors)if(!clean.length||a.s-clean.at(-1).s>15)clean.push(a);
 let direction=null;
 if(clean.length>=2){let a=clean[0],b=clean.at(-1),slope=(b.marker.m-a.marker.m)/(b.s-a.s);if(Math.abs(slope)>.7&&Math.abs(slope)<1.3)direction=Math.sign(slope);}
 if(!direction&&clean.length===1){const a=clean[0],other=projected.filter(b=>Math.abs(b.s-a.s)>80&&Math.abs(b.marker.m-a.marker.m)>100&&Math.abs(b.marker.m-a.marker.m)<5000).sort((b,c)=>b.d-c.d)[0];if(other)direction=Math.sign((other.marker.m-a.marker.m)/(other.s-a.s));}
 return {...l,xy,length,anchors:clean,direction};});
 return {data,lines,byRoad};
}
function infer(line,s){if(isCountyLine(line))return inferCounty(line,s);const a=line.anchors;if(!a.length||!line.direction)return null;let before=a.filter(p=>p.s<=s).at(-1),after=a.find(p=>p.s>=s);
 if(before&&after&&before!==after){const slope=(after.marker.m-before.marker.m)/(after.s-before.s);if(Math.abs(slope)<.7||Math.abs(slope)>1.3)return null;return {m:before.marker.m+(s-before.s)*slope,refs:[before,after],method:'兩樁間沿線內插',distance:Math.min(s-before.s,after.s-s)};}
 const nearest=a.reduce((b,p)=>Math.abs(p.s-s)<Math.abs(b.s-s)?p:b),distance=Math.abs(nearest.s-s);if(distance>1200)return null;
 const slope=line.sourceKind==='province-linked'?(a[1].marker.m-a[0].marker.m)/(a[1].s-a[0].s):line.direction;
 return {m:nearest.marker.m+(s-nearest.s)*slope,refs:[nearest],method:'單樁沿線推估',distance};
}
export function locate(model,xy,road=''){if(!xy.every(Number.isFinite))throw Error('座標必須是有效數字。');let candidates=centerlinePositionCandidates(model,xy,road);const shared=new Set(candidates.map(r=>r.line.road));for(const line of model.lines){if((road&&line.road!==road)||shared.has(line.road)||(model.provinceAxes&&!isCountyLine(line)))continue;const p=project(xy,line.xy);if(p.d>60||beyondLineEnd(xy,line,p))continue;const r=infer(line,p.s);if(r&&r.m>=0)candidates.push({...r,...p,line});}
 // Select geometry first. Only effectively identical lateral distances (0.1m)
 // use calibration quality as a tie-break; a farther legacy line cannot mask a turn.
 candidates.sort((a,b)=>Math.round(a.d*10)-Math.round(b.d*10)||b.refs.length-a.refs.length||a.d-b.d);return candidates;
}
export function reverse(model,road,m){const markers=model.byRoad[road]||[],exact=markers.filter(p=>p.m===m);if(exact.length)return exact.map(p=>({m,xy:p.xy,marker:p,method:p.sourceKind==='county50'?'來源表里程點':'官方樁位',refs:[],distance:0}));let results=[];
 const shared=centerlineReverse(model,road,m);if(shared.length)return shared;
 for(const line of model.lines.filter(l=>l.road===road&&l.direction&&(!model.provinceAxes||isCountyLine(l)))){const a=line.anchors;let s=null;for(let i=0;i<a.length-1;i++){let b=a[i],c=a[i+1];if(m>=Math.min(b.marker.m,c.marker.m)&&m<=Math.max(b.marker.m,c.marker.m)){let slope=(c.marker.m-b.marker.m)/(c.s-b.s);if(isCountyLine(line)||(Math.abs(slope)>=.7&&Math.abs(slope)<=1.3))s=b.s+(m-b.marker.m)/slope;}}
 if(s===null&&a.length&&!isCountyLine(line)){let n=a.reduce((b,p)=>Math.abs(p.marker.m-m)<Math.abs(b.marker.m-m)?p:b);const slope=line.sourceKind==='province-linked'?(a[1].marker.m-a[0].marker.m)/(a[1].s-a[0].s):line.direction;s=n.s+(m-n.marker.m)/slope;}
 if(s===null||s<0||s>line.length)continue;const r=infer(line,s);if(r&&Math.abs(r.m-m)<2)results.push({...r,line,xy:at(line,s)});}
 return results.length?results.sort((a,b)=>b.refs.length-a.refs.length||a.distance-b.distance):endpointReverse(model,road,m);
}
