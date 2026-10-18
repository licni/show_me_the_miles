// Text recognition regression cases. Usage: node scripts/test-parser.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recognizeInput} from '../location-tools.mjs';

const roads=JSON.parse(await readFile(new URL('../data/manifest.json',import.meta.url),'utf8')).meta.roads;
const show=c=>c.kind==='coordinate'?c.label:c.kind==='point'?`${c.road}@${c.m}${c.side?'/'+c.side:''}`:`${c.road} ${c.from}->${c.to}${c.side?'/'+c.side:''}`;
// [input, expected candidates, expect warnings]
const cases=[
 ['22.49,120.62',['緯度 22.49／經度 120.62']],
 ['120.62,22.49',['經度 120.62／緯度 22.49']],
 ['X 195183.575 Y 2506266.517',['TWD97 X 195183.575／Y 2506266.517']],
 ['https://www.google.com/maps?q=22.4900000,120.6200000',['緯度 22.49／經度 120.62']],
 ['22°29\'24.0"N 120°37\'12.0"E',['緯度 22.49／經度 120.62']],
 ['N22.49 E120.62',['緯度 22.49／經度 120.62']],
 ['北緯22.49 東經120.62',['緯度 22.49／經度 120.62']],
 ['22.49°N, 120.62°E',['緯度 22.49／經度 120.62']],
 ['台27線59K+223',['台27@59223']],
 ['台１線３９２Ｋ＋４０６',['台1@392406']],
 ['縣道185線34K+544',['縣185@34544']],
 ['台24臨45 0K+500',['台24臨45@500']],
 ['屏114-1 1K+200',['屏114-1@1200']],
 ['縣185 34.544 到 35.200',['縣185 34544->35200']],
 ['屏46 8K+111 至 屏46 9K+356',['屏46 8111->9356']],
 ['屏46 8K+111、9K+356',['屏46@8111','屏46@9356']],
 ['台1線392K+406附近施工，台17線10K+000至12K+000封閉',['台1@392406','台17 10000->12000']],
 ['台27線59K+223 順樁150公尺',['台27 59223->59373']],
 ['台27線59K+223 逆樁150公尺',['台27 59223->59073']],
 ['台27線59K+223 順樁1.5公里',['台27 59223->60723']],
 ['台27線59K+223 順樁方向延伸150公尺',['台27 59223->59373']],
 ['台27線59K+223 順樁向約150公尺',['台27 59223->59373']],
 ['台27線59K+223 前後各1公里',['台27 58223->60223']],
 ['台1線392K+406（順樁向）',['台1@392406/forward']],
 ['台27線 順樁 59K+223',['台27@59223/forward']],
 ['台27線59K+223 順樁150公尺\n台1線392K+406 逆樁100公尺',['台27 59223->59373','台1 392406->392306']],
 // A rejected number pair must not hide the coordinate after it.
 ['台1線392K+406 22.49,120.62',['台1@392406','緯度 22.49／經度 120.62']],
 // Labels that contradict the magnitudes are not silently swapped or dropped.
 ['Y:195183 X:2506266',[],true],
 ['lat:120.62 lon:22.49',[],true],
 ['X 195183.575 Y 2506266.517 22.49,120.62',['TWD97 X 195183.575／Y 2506266.517','緯度 22.49／經度 120.62']],
 // Measurements are not stakes.
 ['台1線392K+406 護欄高1.2公尺',['台1@392406']],
 ['台1線392K+406 寬3.5 m',['台1@392406']],
 ['台1線392K+406 順樁150.5公尺',[],true],
 ['台27線59K+223 順樁 150',['台27@59223'],true],
 ['台一線392K+406',[],true],
];
let failed=0;
for(const [input,expected,warn=false] of cases){
 const r=recognizeInput(input,roads);
 try{
  assert.deepEqual(r.candidates.map(show),expected);
  assert.equal(r.warnings.length>0,warn,'warnings: '+r.warnings.join('|'));
 }catch(e){failed++;console.error('FAIL',JSON.stringify(input),'\n ',e.message.split('\n').slice(0,8).join('\n  '));}
}
console.log(`${cases.length-failed}/${cases.length} parser cases passed`);
if(failed)process.exit(1);
