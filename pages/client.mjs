let worker,sequence=0;
const pending=new Map();
function finish(id){const entry=pending.get(id);if(entry){pending.delete(id);clearTimeout(entry.timer);}return entry;}
function failAll(error){
 for(const id of [...pending.keys()])finish(id).reject(error);
 worker?.terminate();worker=null;
}
function getWorker(){
 if(worker)return worker;
 worker=new Worker(new URL('./query-worker.mjs',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{
  const task=finish(data.id);if(!task)return;
  if(data.error)task.reject(Error(data.error));
  else task.resolve(new Response(data.body,{status:data.status,headers:{'Content-Type':'application/json; charset=utf-8'}}));
 };
 worker.onerror=()=>failAll(Error('樁號程式無法啟動，請重新整理或使用較新的瀏覽器。'));
 worker.onmessageerror=()=>failAll(Error('樁號計算結果無法讀取，請重新整理。'));
 return worker;
}
export function apiFetch(path,options={}){
 return new Promise((resolve,reject)=>{
  const id=++sequence;
  try{
   const target=getWorker();
   const timer=setTimeout(()=>{const task=finish(id);task?.reject(Error('道路資料讀取逾時，請確認連線後重試。'));},120000);
   pending.set(id,{resolve,reject,timer});
   target.postMessage({id,path,options:{method:options.method,body:options.body}});
  }catch(error){finish(id);reject(error);}
 });
}
