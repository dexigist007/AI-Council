import {chromium} from 'playwright';import http from 'http';import fs from 'fs';import path from 'path';
const root=process.cwd();
const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)){r.writeHead(404);return r.end()}
 r.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(f).pipe(r)}).listen(8765);
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:1080,height:1920}});p.on('console',m=>console.log(m.text()));p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://localhost:8765/index.html');await p.waitForFunction('window.ready');
const only=process.argv[2];fs.mkdirSync('frames',{recursive:true});
const N=450;const list=only?only.split(',').map(Number):[...Array(N).keys()];
for(const i of list){await p.evaluate(t=>render(t),i/30);await p.screenshot({path:`frames/${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:92});if(i%50==0)console.log(i)}
await b.close();srv.close();
