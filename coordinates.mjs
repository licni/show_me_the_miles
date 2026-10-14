export function tm(lon,lat){
 const a=6378137,f=1/298.257222101,e=f*(2-f),ep=e/(1-e),p=lat*Math.PI/180,A=(lon-121)*Math.PI/180*Math.cos(p),T=Math.tan(p)**2,C=ep*Math.cos(p)**2,N=a/Math.sqrt(1-e*Math.sin(p)**2);
 const M=a*((1-e/4-3*e**2/64-5*e**3/256)*p-(3*e/8+3*e**2/32+45*e**3/1024)*Math.sin(2*p)+(15*e**2/256+45*e**3/1024)*Math.sin(4*p)-35*e**3/3072*Math.sin(6*p));
 return [250000+.9999*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep)*A**5/120),.9999*(M+N*Math.tan(p)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep)*A**6/720))];
}
export function ll(x,y){let lon=121+(x-250000)/102800,lat=y/110750;for(let i=0;i<6;i++){const p=tm(lon,lat),u=tm(lon+.00001,lat),v=tm(lon,lat+.00001),a=(u[0]-p[0])/.00001,b=(v[0]-p[0])/.00001,c=(u[1]-p[1])/.00001,d=(v[1]-p[1])/.00001,dx=x-p[0],dy=y-p[1],det=a*d-b*c;lon+=(d*dx-b*dy)/det;lat+=(-c*dx+a*dy)/det;}return [lon,lat];}
export function formatM(m){const n=Math.round(m);return `${Math.floor(n/1000)}K+${String(n%1000).padStart(3,'0')}`;}
export function parseM(text){let t=text.trim(),m=t.match(/^(\d+)\s*[kKＫｋ]\s*\+?\s*(\d{1,3})?$/)||t.match(/^(\d+)\s*\+\s*(\d{1,3})$/);if(m)return Number(m[1])*1000+Number(m[2]||0);if(/^\d+(\.\d{1,3})?$/.test(t))return Math.round(Number(t)*1000);throw Error('請輸入 395K+500、395+500 或 395.500。');}
