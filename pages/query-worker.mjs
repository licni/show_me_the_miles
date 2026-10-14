import {createModelLoader} from './model-loader.mjs';
import {createPagesAPI} from './query-api.mjs';
const api=createPagesAPI(createModelLoader());
self.onmessage=async({data})=>{
 const {id,path,options}=data;
 try{
  const response=await api(path,options);
  self.postMessage({id,status:response.status,body:await response.text()});
 }catch(error){self.postMessage({id,error:error.message||'樁號計算失敗，請稍後再試。'});}
};
