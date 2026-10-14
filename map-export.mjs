function loadImage(src){return new Promise((resolve,reject)=>{const img=new Image(),timer=setTimeout(()=>reject(Error('底圖載入逾時，請稍後重試。')),12000);img.crossOrigin='anonymous';img.onload=()=>{clearTimeout(timer);resolve(img);};img.onerror=()=>{clearTimeout(timer);reject(Error('目前底圖不允許圖片匯出或載入失敗，請切換街道圖後重試。'));};img.src=src;});}
export function wrapText(ctx,text,width){
 const rows=[];let row='';for(const char of String(text)){if(char==='\n'||(row&&ctx.measureText(row+char).width>width)){rows.push(row);row=char==='\n'?'':char;}else row+=char;}if(row)rows.push(row);return rows;
}
export async function exportMapImage({map,groups,notes=[],document:doc=document,download=true,format='jpg'}){
 if(!['jpg','png'].includes(format))throw Error('請選擇 JPG 或 PNG 格式。');
 const mime=format==='jpg'?'image/jpeg':'image/png',scale=format==='jpg'?1:2;
 if(!map)throw Error('地圖尚未載入。');
 map.stop();let loading=false;map.eachLayer(layer=>{if(layer.isLoading?.())loading=true;});if(loading)throw Error('底圖尚未完整載入，請稍後再匯出。');
 const container=map.getContainer(),rect=container.getBoundingClientRect(),width=Math.round(rect.width),height=Math.round(rect.height);
 if(width<100||height<100)throw Error('請先展開地圖。');
 const capturedCenter=map.getCenter(),capturedZoom=map.getZoom();
 const tiles=[...container.querySelectorAll('.leaflet-tile-pane img.leaflet-tile')].map(img=>({img,rect:img.getBoundingClientRect()})).filter(t=>t.rect.right>rect.left&&t.rect.left<rect.right&&t.rect.bottom>rect.top&&t.rect.top<rect.bottom&&getComputedStyle(t.img).visibility!=='hidden');
 if(!tiles.length||tiles.some(t=>!t.img.complete||!t.img.naturalWidth))throw Error('底圖尚未完整載入，請稍後再匯出。');
 // Snapshot vector coordinates before awaiting images; do not mix later map views.
 const vectors=[];
 const point=latlng=>{const p=map.latLngToContainerPoint(latlng);return [p.x,p.y];};
 for(const group of groups.filter(Boolean))group.eachLayer(layer=>{
  if(layer.getLatLngs){
   const walk=arr=>{if(!arr.length)return;if(Array.isArray(arr[0])){for(const a of arr)walk(a);}else vectors.push({line:arr.map(point),options:{...layer.options}});};walk(layer.getLatLngs());
  }else if(layer.getLatLng){
   const p=point(layer.getLatLng()),tooltip=layer.getTooltip?.(),popup=layer.getPopup?.();
   const html=tooltip?.getContent()||popup?.getContent()||'',tmp=doc.createElement('div');if(typeof html==='string')tmp.innerHTML=html;else if(html?.textContent)tmp.textContent=html.textContent;
   // Accuracy circles use metres; regular circle markers use screen pixels.
   let radius=layer.getRadius?.()||7;if(layer instanceof L.Circle){const metresPerPixel=map.distance(map.containerPointToLatLng([width/2,height/2]),map.containerPointToLatLng([width/2+1,height/2]));radius/=metresPerPixel;}
   vectors.push({point:p,radius,options:{...layer.options},label:tmp.textContent});
  }
 });
 const attribution=container.querySelector('.leaflet-control-attribution')?.textContent||'道路圖資：交通部／國土測繪中心';
 const images=await Promise.all(tiles.map(t=>loadImage(t.img.currentSrc||t.img.src)));
 if(map.getZoom()!==capturedZoom||map.getCenter().distanceTo(capturedCenter)>.1||container.getBoundingClientRect().width!==rect.width||container.getBoundingClientRect().height!==rect.height)throw Error('地圖範圍已變更，請重新匯出。');
 const canvas=doc.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font='14px sans-serif';
 const lines=notes.flatMap(t=>wrapText(ctx,t,width-32));const credits=wrapText(ctx,attribution,width-32);
 const header=44,footer=48+lines.length*21+credits.length*18;
 canvas.width=width*scale;canvas.height=(height+header+footer)*scale;ctx.scale(scale,scale);ctx.fillStyle='#fffef9';ctx.fillRect(0,0,width,height+header+footer);
 ctx.fillStyle='#174f43';ctx.font='bold 17px sans-serif';ctx.fillText('道路位置示意圖',16,28);
 ctx.save();ctx.translate(0,header);ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
 for(let i=0;i<tiles.length;i++){const r=tiles[i].rect;ctx.drawImage(images[i],r.left-rect.left,r.top-rect.top,r.width,r.height);}
 for(const v of vectors){const o=v.options;ctx.globalAlpha=o.opacity??1;ctx.strokeStyle=o.color||'#24766a';ctx.lineWidth=o.weight||2;ctx.setLineDash(o.dashArray?String(o.dashArray).split(/[ ,]+/).map(Number):[]);ctx.beginPath();
  if(v.line){v.line.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();}
  else{ctx.arc(...v.point,Math.max(1,v.radius),0,Math.PI*2);ctx.fillStyle=o.fillColor||o.color||'#df8c33';ctx.globalAlpha=o.fillOpacity??.8;ctx.fill();ctx.globalAlpha=o.opacity??1;ctx.stroke();}
 }
 ctx.globalAlpha=1;ctx.setLineDash([]);ctx.font='bold 12px sans-serif';
 for(const v of vectors.filter(v=>v.point&&v.label)){
  const [x,y]=v.point;if(x<0||x>width||y<0||y>height)continue;
  const text=v.label.slice(0,65),w=Math.min(width-12,ctx.measureText(text).width+12),left=Math.max(6,Math.min(width-w-6,x-w/2)),top=Math.max(4,y-31);
  ctx.fillStyle='#fffef9';ctx.fillRect(left,top,w,23);ctx.fillStyle='#174f43';ctx.fillText(text,left+6,top+16,w-12);
 }
 ctx.restore();ctx.fillStyle='#334f45';ctx.font='14px sans-serif';let y=header+height+24;
 for(const line of lines){ctx.fillText(line,16,y);y+=21;}
 ctx.font='11px sans-serif';ctx.fillText('圖資推估，非現地丈量；僅含目前地圖範圍。',16,y+2);y+=20;
 for(const credit of credits){ctx.fillText(credit,16,y);y+=18;}
 const blob=await new Promise((resolve,reject)=>{try{canvas.toBlob(b=>b?resolve(b):reject(Error('無法產生圖片。')),mime,format==='jpg'?.9:undefined);}catch{reject(Error('底圖未允許匯出，請切換街道圖後重試。'));}});
 if(blob.type!==mime)throw Error('此瀏覽器無法產生所選圖片格式，請改選 PNG。');
 if(download){const a=doc.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`道路位置示意圖.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 return blob;
}

// Preserve the original PNG API for existing callers.
export const exportMapPng=options=>exportMapImage({...options,format:'png'});
