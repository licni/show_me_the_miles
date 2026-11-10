// Share-link and history regression checks. Usage: node scripts/test-share.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recognizeInput} from '../location-tools.mjs';
import {locationText,shareUrl,readShare,loadHistory,addHistory,clearHistory,HISTORY_LIMIT} from '../share-history.mjs';

const roads=JSON.parse(await readFile(new URL('../data/manifest.json',import.meta.url),'utf8')).meta.roads;
const base='https://example.test/show_me_the_miles/';
// A link must reopen as exactly the location it was made from, for every road.
const viaLink=target=>readShare(new URL(shareUrl(base,target)).search);
let checked=0;
for(const road of roads)for(const side of [undefined,'forward','backward']){
 for(const c of [{kind:'point',road,m:59223,side},{kind:'point',road,m:0,side},{road,from:59223,to:60001,side},{road,from:1500,to:200,side}]){
  const link=shareUrl(base,{q:locationText(c)});
  assert.match(link,/^[\x21-\x7e]+$/,'link is plain ASCII');
  assert.doesNotMatch(link,/[()~]/,'no characters that chat apps cut off');
  const {candidates,warnings}=recognizeInput(viaLink({q:locationText(c)}).q,roads);
  assert.equal(warnings.length,0,locationText(c));
  assert.equal(candidates.length,1,locationText(c));
  const got=candidates[0];
  assert.deepEqual({kind:got.kind,road:got.road,m:got.m,from:got.from,to:got.to,side:got.side},{kind:c.kind,road:c.road,m:c.m,from:c.from,to:c.to,side:c.side},locationText(c));
  checked++;
 }
}
// Coordinates survive to well under a metre.
const xy=[210900.321,2487860.733],back=recognizeInput(viaLink({q:locationText({kind:'coordinate',xy})}).q,roads).candidates;
assert.equal(back.length,1);assert.equal(back[0].kind,'coordinate');
assert.ok(Math.hypot(back[0].xy[0]-xy[0],back[0].xy[1]-xy[1])<0.2,'coordinate round trip');
// Several locations in one link keep their order; the chosen road rides along.
const many=[{kind:'point',road:'台27',m:59223,side:'forward'},{road:'縣185',from:34544,to:35200},{kind:'coordinate',xy}];
const shared=viaLink({q:many.map(locationText).join('\n'),road:'縣185甲'});
assert.equal(shared.road,'縣185甲');
assert.deepEqual(recognizeInput(shared.q,roads).candidates.map(c=>c.kind||'segment'),['point','segment','coordinate']);
assert.equal(readShare(''),null);assert.equal(readShare('?q=%20'),null);

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
