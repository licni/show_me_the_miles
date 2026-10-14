import {createQueryService} from '../engine/query-service.mjs';

export function createPagesAPI(loader){
 return async function api(path,options={}){
  const url=new URL(path,'https://milestone.invalid');
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
  if(url.pathname==='/api/meta')return json(await loader.metadata());
  if(url.pathname==='/api/map'){
   const model=await loader.referenceModel();
   return createQueryService(model).fetch(new Request(url));
  }
  if(url.pathname!=='/api/query')return json({error:'找不到服務。'},404);
  let query;
  try{query=JSON.parse(options.body);}catch{return json({error:'無法解析查詢內容。'},400);}
  const model=await loader.modelFor(query);
  return createQueryService(model).fetch(new Request(url,{method:options.method||'POST',headers:{'Content-Type':'application/json'},body:options.body}));
 };
}
