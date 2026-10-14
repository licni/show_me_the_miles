// Email text stays in the browser. Only the selected road and mileage go to the API.
export function normalizeText(text){return String(text).normalize('NFKC').replace(/臺/g,'台').replace(/[‐‑‒–—―−]/g,'-').replace(/[﹢]/g,'+').replace(/\r/g,'').replace(/[\u200b-\u200d\ufeff]/g,'');}
export function parseStake(value){
 const s=normalizeText(value).trim();let m;
 if((m=s.match(/^(\d{1,3})\s*(?:k(?:m)?|公里)\s*(?:(?:\+\s*)?(\d{1,3}))?\s*(?:m|公尺|米)?$/i)))return Number(m[1])*1000+Number(m[2]||0);
 if((m=s.match(/^(\d{1,3})\s*\+\s*(\d{1,3})\s*(?:m|公尺|米)?$/i)))return Number(m[1])*1000+Number(m[2]);
 if((m=s.match(/^(\d{1,3})\.(\d{1,3})\s*(?:km|k|公里)?$/i)))return Math.round(Number(m[1]+'.'+m[2])*1000);
 throw Error('樁號請輸入 8K+111、8+111 或 8.111 公里。');
}
const stakeRE=/(?<![\d.])(?:\d{1,3}\.\d{1,3}\s*(?:km|k|公里)?|\d{1,3}\s*(?:k(?:m)?|公里)\s*(?:\+\s*\d{1,3}|\d{1,3})?\s*(?:m|公尺|米)?|\d{1,3}\s*\+\s*\d{1,3}\s*(?:m|公尺|米)?)(?![\d.+])/gi;
export function recognizeLocations(text,roads){return recognizeSegments(text,roads,{allowPoints:true});}
export function recognizeSegments(text,roads,{allowPoints=false}={}){
 const s=normalizeText(text),known=new Set(roads),warnings=[],routes=[];
 const re=/(台|省道|縣道|縣|屏)\s*(\d{1,3})(?:\s*(臨)\s*(\d{1,3})|\s*([甲乙丙丁戊])|\s*-\s*(\d{1,2}))?\s*(?:線|號)?/g;
 for(const m of s.matchAll(re)){
  const prefix=m[1]==='省道'?'台':m[1]==='縣道'?'縣':m[1],road=prefix+Number(m[2])+(m[3]?'臨'+Number(m[4]):m[5]|| (m[6]?'-'+Number(m[6]):''));
  routes.push({road,start:m.index,end:m.index+m[0].length,known:known.has(road)});
 }
 const candidates=[];
 const add=(road,a,b,excerpt)=>{if(a.m===b.m){warnings.push(`${road} 起迄樁號相同。`);return;}const key=[road,a.m,b.m].join(':');if(!candidates.some(c=>c.key===key))candidates.push({key,road,from:a.m,to:b.m,excerpt:excerpt.trim().slice(0,140)});};
 for(let i=0;i<routes.length;i++){
  const route=routes[i],end=routes[i+1]?.start??s.length,chunk=s.slice(route.end,end),stakes=[];
  if(!route.known){warnings.push(`「${route.road}」不在目前道路清單，請確認名稱。`);continue;}
  for(const m of chunk.matchAll(stakeRE)){
   try{const value=parseStake(m[0]);if(value<=600000)stakes.push({m:value,start:m.index,end:m.index+m[0].trimEnd().length});else warnings.push('樁號超過600公里，請確認。');}catch{}
  }
  if(allowPoints){
   let rest=chunk;for(const a of [...stakes].reverse())rest=rest.slice(0,a.start)+' '.repeat(a.end-a.start)+rest.slice(a.end);
   if(/\d\s*(?:k|公里|\+)/i.test(rest))warnings.push(`${route.road} 尚有格式不完整的樁號，請確認。`);
  }
  // Repeat the road at the second endpoint: 屏46 8K+111 至 屏46 9K+356.
  if(stakes.length===1&&routes[i+1]?.road===route.road){
   const nextEnd=routes[i+2]?.start??s.length,next=s.slice(routes[i+1].end,nextEnd),other=[...next.matchAll(stakeRE)];
   if(other.length===1&&/(?:到|至|迄|~|-|→)/.test(chunk.slice(stakes[0].end))){
    const second=parseStake(other[0][0]);if(second<=600000)add(route.road,stakes[0],{m:second},s.slice(route.start,nextEnd));else warnings.push('樁號超過600公里，請確認。');i++;continue;
   }
  }
  if(allowPoints&&stakes.length>1){
   for(let j=0;j<stakes.length;j++){
    const a=stakes[j],b=stakes[j+1],between=b?chunk.slice(a.end,b.start):'';
    // Commas/newlines enumerate individual stakes unless an explicit range word appears.
    if(b&&(!/[,、;\n]/.test(between)||/(?:到|至|迄|~|→|-|終點)/.test(between))){add(route.road,a,b,route.road+' '+chunk.slice(a.start,b.end));j++;}
    else{const key=[route.road,a.m].join(':');if(!candidates.some(c=>c.key===key))candidates.push({kind:'point',key,road:route.road,m:a.m,excerpt:route.road+' '+chunk.slice(a.start,a.end)});}
   }
   continue;
  }
  if(stakes.length===2){add(route.road,stakes[0],stakes[1],s.slice(route.start,end));continue;}
  if(stakes.length>2){
   for(let j=0;j+1<stakes.length;j+=2)add(route.road,stakes[j],stakes[j+1],route.road+' '+chunk.slice(stakes[j].start,stakes[j+1].end));
   if(stakes.length%2)warnings.push(`${route.road} 另有未配對樁號，請確認區間。`);
   continue;
  }
  if(stakes.length===1&&allowPoints){
   const a=stakes[0],before=chunk.slice(0,a.start),after=chunk.slice(a.end),rest=before+' '+after;
   // Do not reinterpret an incomplete range or a partially valid stake as a point.
   if(/(?:到|至|迄|~|→|-)\s*$/.test(before)||/^\s*(?:到|至|迄|~|→|-)(?:\s|$|\d)/.test(after)||/\d\s*(?:k|公里|\+|\.)/i.test(rest)){
    warnings.push(`${route.road} 里程格式或起迄不完整，請確認。`);continue;
   }
   const key=[route.road,a.m].join(':');
   if(!candidates.some(c=>c.key===key))candidates.push({kind:'point',key,road:route.road,m:a.m,excerpt:s.slice(route.start,end).trim().slice(0,140)});
  }
  else if(stakes.length===1)warnings.push(`${route.road} 只辨識到一個樁號，請補上起點與終點。`);
  else warnings.push(`${route.road} 未辨識到起迄樁號。`);
 }
 if(!routes.length)warnings.push('未辨識到道路名稱，請保留例如「屏46」「縣185」「台1線」。');
 return {candidates,warnings:[...new Set(warnings)]};
}
