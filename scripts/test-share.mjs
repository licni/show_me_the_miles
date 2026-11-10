// Share-link and history regression checks. Usage: node scripts/test-share.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recognizeInput} from '../location-tools.mjs';
import {locationText,targetText,roadCode,roadFromCode,shareUrl,readShare,loadHistory,addHistory,clearHistory,HISTORY_LIMIT} from '../share-history.mjs';

const roads=JSON.parse(await readFile(new URL('../data/manifest.json',import.meta.url),'utf8')).meta.roads;
const base='https://example.test/show_me_the_miles/';
// A link must stay short and readable-safe, and reopen as exactly the location it was made from.
const viaLink=target=>readShare(new URL(shareUrl(base,target)).search);
const same=(got,c)=>assert.deepEqual({kind:got.kind,road:got.road,m:got.m,from:got.from,to:got.to,side:got.side},{kind:c.kind,road:c.road,m:c.m,from:c.from,to:c.to,side:c.side},locationText(c));
let checked=0;
for(const road of roads){
 assert.equal(roadFromCode(roadCode(road)),road,`${road} has a short code`);
 for(const side of [undefined,'forward','backward'])for(const c of [{kind:'point',road,m:59223,side},{kind:'point',road,m:0,side},{road,from:59223,to:60001,side},{road,from:1500,to:200,side}]){
  const link=shareUrl(base,{items:[c]});
  assert.match(link.slice(base.length),/^\?s=[A-Za-z0-9_-]+$/,`short link for ${locationText(c)}: ${link}`);
  assert.ok(link.length-base.length<=30,link);
  const {candidates,warnings}=recognizeInput(viaLink({items:[c]}).q,roads);
  assert.equal(warnings.length,0,locationText(c));assert.equal(candidates.length,1,locationText(c));
  same(candidates[0],c);checked++;
 }
}
assert.equal(new Set(roads.map(roadCode)).size,roads.length,'short road codes are unique');
assert.equal(shareUrl(base,{items:[{kind:'point',road:'台1',m:392406,side:'forward'}]}),base+'?s=T1_392406f');
assert.equal(shareUrl(base,{items:[{road:'縣185',from:34544,to:35200}]}),base+'?s=C185_34544_35200');
// Coordinates survive to well under a metre, with the road chosen at a junction.
const xy=[210900.321,2487860.733],coordinate=viaLink({items:[{kind:'coordinate',xy}],road:'縣189甲'});
assert.match(shareUrl(base,{items:[{kind:'coordinate',xy}],road:'縣189甲'}),/\?s=g\d+_\d+_C189a$/);
assert.equal(coordinate.road,'縣189甲');
const back=recognizeInput(coordinate.q,roads).candidates;
assert.equal(back.length,1);assert.equal(back[0].kind,'coordinate');
assert.ok(Math.hypot(back[0].xy[0]-xy[0],back[0].xy[1]-xy[1])<0.2,'coordinate round trip');
// Several locations in one link keep their order and content.
const many=[{kind:'point',road:'台27',m:59223,side:'forward'},{road:'縣185',from:34544,to:35200},{kind:'coordinate',xy},{road:'屏41-1',from:0,to:150,side:'backward'}];
const multi=shareUrl(base,{items:many});
assert.match(multi.slice(base.length),/^\?s=[A-Za-z0-9_.-]+$/);assert.doesNotMatch(multi,/[.]$/);
const reopened=recognizeInput(readShare(new URL(multi).search).q,roads);
assert.equal(reopened.warnings.length,0);assert.equal(reopened.candidates.length,many.length);
many.forEach((c,i)=>c.kind==='coordinate'?assert.equal(reopened.candidates[i].kind,'coordinate'):same(reopened.candidates[i],c));
// A road name outside the short scheme, and links made before it existed, still work.
const odd={items:[{kind:'point',road:'專1',m:100}]};
assert.match(shareUrl(base,odd),/\?q=%/);assert.equal(viaLink(odd).q,targetText(odd));
assert.deepEqual(readShare('?q=%E5%8F%B01%E7%B7%9A%20392K%2B406%28%E9%A0%86%E6%A8%81%E5%90%91%29'),{q:'台1線 392K+406(順樁向)',road:''});
for(const bad of ['','?q=%20','?s=','?s=hello','?s=T1','?s=T1_x','?s=Z9_100','?s=T1_100.','?s=T1_1234567'])assert.equal(readShare(bad),null,bad);

// History: newest first, one entry per location, capped, and safe without storage.
const storage={data:{},getItem(k){return this.data[k]??null;},setItem(k,v){this.data[k]=v;},removeItem(k){delete this.data[k];}};
for(let i=0;i<HISTORY_LIMIT+5;i++)addHistory(storage,{q:`q${i}`,label:`L${i}`,at:i});
assert.equal(loadHistory(storage).length,HISTORY_LIMIT);
assert.equal(loadHistory(storage)[0].q,`q${HISTORY_LIMIT+4}`);
const list=addHistory(storage,{q:'q10',label:'again',at:99});
assert.equal(list[0].label,'again');assert.equal(list.filter(e=>e.q==='q10').length,1);assert.equal(list.length,HISTORY_LIMIT);
assert.deepEqual(clearHistory(storage),[]);assert.deepEqual(loadHistory(storage),[]);
assert.deepEqual(loadHistory(null),[]);assert.deepEqual(addHistory(null,{q:'a',label:'a',at:1}),[]);
storage.data['milestone-history']='not json';assert.deepEqual(loadHistory(storage),[]);
console.log(`${checked} link round trips and history checks passed`);
