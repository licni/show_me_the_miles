// 管養工務段、鄉鎮、村里 from the nearest official milestone signs on the same road.
// Between two signs in different areas both are listed, since the boundary is unknown.
const RANGE=600;
export function adminArea(table,road,m){
 const rows=table?.roads?.[road];
 if(!rows?.length||!Number.isFinite(m))return null;
 let lower=-Infinity,upper=Infinity;
 for(const [at] of rows){if(at<=m&&at>lower)lower=at;if(at>=m&&at<upper)upper=at;}
 const near=new Set([lower,upper].filter(at=>Math.abs(at-m)<=RANGE));
 if(near.has(m))near.clear(),near.add(m);
 const picked=rows.filter(r=>near.has(r[0])).map(r=>r.slice(1).map(i=>table.names[i]));
 if(!picked.length)return null;
 const unique=values=>[...new Set(values.filter(Boolean))];
 const sections=unique(picked.map(r=>r[0])),towns=unique(picked.map(r=>r[1]));
 const places=towns.length===1?towns[0]+unique(picked.map(r=>r[2])).join('／'):unique(picked.map(r=>r[1]+r[2])).join('／');
 return {section:sections.join('／'),place:places,text:`${sections.join('／')} · ${places}`};
}
let loading=null;
export function loadAdminAreas(url=new URL('./data/admin-areas.json',import.meta.url)){
 loading??=fetch(url).then(r=>r.ok?r.json():null).catch(()=>null);
 return loading;
}
