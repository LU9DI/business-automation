type Bucket={count:number;errors:number;sumMs:number;samples:number[]};
const global:Bucket={count:0,errors:0,sumMs:0,samples:[]};
const routes=new Map<string,Bucket>();
const max=200;
function bucket(path:string){let b=routes.get(path);if(!b){b={count:0,errors:0,sumMs:0,samples:[]};routes.set(path,b)}return b}
export function metricsMiddleware(req:any,res:any,next:any){const start=Date.now();res.on("finish",()=>{const ms=Date.now()-start;const b=bucket(req.path);for(const x of [global,b]){x.count++;x.sumMs+=ms;x.samples.push(ms);if(x.samples.length>max)x.samples.shift();if(res.statusCode>=400)x.errors++}});next()}
function view(b:Bucket){const s=[...b.samples].sort((a,b)=>a-b);return {count:b.count,errors:b.errors,avg_ms:b.count?Math.round(b.sumMs/b.count):0,p95_ms:s.length?s[Math.min(s.length-1,Math.ceil(s.length*.95)-1)]:null}}
export function metricsSnapshot(){return {uptime_s:Math.floor(process.uptime()),global:view(global),routes:Object.fromEntries([...routes].map(([k,v])=>[k,view(v)]))}}
