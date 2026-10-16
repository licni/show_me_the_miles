// Read the 公路局「省道里程坐標（里程牌標誌）」CSV (Big5 or UTF-8) for one county.
import {readFile} from 'node:fs/promises';

// RFC 4180: quoted fields may contain commas and line breaks (備註欄).
function parseCSV(s){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<s.length;i++){
  const c=s[i];
  if(quoted){if(c==='"'&&s[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;continue;}
  if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}
  else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
  else field+=c;
 }
 if(field||row.length){row.push(field);rows.push(row);}
 return rows;
}
export async function readOfficialMarkers(file,county='屏東縣'){
 const bytes=await readFile(file),text=new TextDecoder(bytes[0]===0xef&&bytes[1]===0xbb?'utf-8':'big5').decode(bytes);
 const [head,...body]=parseCSV(text.replace(/^﻿/,''));
 const col=name=>{const i=head.indexOf(name);if(i<0)throw Error('CSV 缺少欄位：'+name);return i;};
 const c={road:col('公路編號'),county:col('隸屬縣市'),m:col('起點樁號'),x:col('坐標-X-TWD97'),y:col('坐標-Y-TWD97'),e:col('坐標-E-WGS84'),n:col('坐標-N-WGS84'),dir:col('牌面方向'),date:col('調查日期'),section:col('管養工務段'),town:col('隸屬鄉鎮'),village:col('隸屬村里')};
 const stake=s=>{const m=/^(\d+)K\+(\d+)$/.exec(s.trim());return m?Number(m[1])*1000+Number(m[2]):NaN;};
 const markers=body.filter(r=>r[c.county]===county).map(r=>({road:r[c.road],m:stake(r[c.m]),xy:[Number(r[c.x]),Number(r[c.y])],wgs:[Number(r[c.e]),Number(r[c.n])],dir:r[c.dir]||'',date:r[c.date],section:r[c.section].trim(),town:r[c.town].trim(),village:r[c.village].trim()}));
 if(!markers.length)throw Error(`CSV 內沒有「${county}」的資料。`);
 return markers;
}
