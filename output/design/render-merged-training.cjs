const fs = require('fs');
const path = require('path');
const sharp = require('C:/Users/58724/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const P='#1F6F66', T='#1F2A27', M='#718078', BG='#F3F5F2', L='#DDEDE9';
let a=[];
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const rect=(x,y,w,h,f='white',r=22,st='none')=>a.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${f}" stroke="${st}"/>`);
const text=(s,x,y,z=26,c=T,b=400,an='start')=>a.push(`<text x="${x}" y="${y}" font-size="${z}" fill="${c}" font-weight="${b}" text-anchor="${an}">${esc(s)}</text>`);
const line=(x,y,x2,y2,c='#DFE7E0',w=2)=>a.push(`<path d="M${x} ${y}L${x2} ${y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`);
const circle=(x,y,r,f='none',st='none',w=2)=>a.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${f}" stroke="${st}" stroke-width="${w}"/>`);
const draw=(d,f='none',st=P,w=3)=>a.push(`<path d="${d}" fill="${f}" stroke="${st}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
const pill=(s,x,y,w,f=L,c=P)=>{rect(x,y,w,38,f,19);text(s,x+w/2,y+26,20,c,500,'middle');};
const check=(x,y)=>draw(`M${x-8} ${y}l6 6l12-13`,'none','white',3.2);
const card=(y,h,f='white')=>rect(30,y,640,h,f,25);
const leaf=(x,y,k=1)=>{a.push(`<g transform="translate(${x} ${y}) scale(${k})">`);draw('M0 24V0','none',P,3);draw('M0 13C-19 14-24-1-20-9C-6-10 1 1 0 13',P,'none');draw('M0 4C0-9 11-17 24-15C25-2 12 7 0 4',P,'none');a.push('</g>');};
function icon(n,x,y,c=P,k=1){a.push(`<g transform="translate(${x} ${y}) scale(${k})">`);if(n==='camera'){rect(-14,-10,23,20,'none',4,c);draw('M9-4L18-10V10L9 4','none',c,2.6);}if(n==='edit'){rect(-13,-13,26,28,'none',4,c);line(-6,-4,6,-4,c);line(-6,3,5,3,c);line(-6,9,1,9,c);}if(n==='grid')for(let i=0;i<4;i++)rect(-12+(i%2)*15,-12+Math.floor(i/2)*15,10,10,'none',2,c);if(n==='chart'){line(-13,12,13,12,c);line(-9,5,-9,-2,c,4);line(0,5,0,-12,c,4);line(9,5,9,-6,c,4);}if(n==='people'){circle(-5,-6,5,'none',c);circle(8,-4,4,'none',c);draw('M-16 12Q-16 0-5 0Q6 0 6 12M6 2Q17 2 17 12','none',c,2.5);}if(n==='person'){circle(0,-7,6,'none',c);draw('M-12 14Q-12 1 0 1Q12 1 12 14','none',c,2.5);}a.push('</g>');}
function callout(num,title,lines,x,y,w=340){pill(num,x,y,52,P,'white');text(title,x,y+79,29,T,650);lines.forEach((s,i)=>text(s,x,y+124+i*39,23,M));}
function thumbnail(x,y){rect(x,y,96,96,'#DFE9E2',15);circle(x+46,y+24,9,'#CDA987');draw(`M${x+43} ${y+39}L${x+39} ${y+65}L${x+65} ${y+65}L${x+72} ${y+83}`,'none','#6E9382',11);draw(`M${x+45} ${y+44}L${x+61} ${y+53}L${x+76} ${y+46}`,'none','#CDA987',6);line(x+21,y+85,x+82,y+85,'#AFBFAF',4);circle(x+72,y+71,15,'#FFFFFFEE');draw(`M${x+68} ${y+65}l10 6l-10 6Z`,P,'none');}

a.push('<svg xmlns="http://www.w3.org/2000/svg" width="1760" height="2220" viewBox="0 0 1760 2220"><defs><style>text{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;letter-spacing:.1px}</style></defs>');
rect(0,0,1760,2220,'#EAF0E9',0);leaf(102,74,1.05);text('小树',146,86,32,P,700);text('PAGE DESIGN / 02',1672,82,21,M,500,'end');
text('今日与训练，合在一个页面',80,166,55,T,700);text('先看到今天练什么，再管理动作与计划；现场录制随时可达。',82,212,26,M);
pill('同一页面 · 上下滚动',1320,151,352,'#DCE7DC','#496255');

callout('01','打开就能练',['日历与今天的训练清单优先。','继续跟练、记录实际完成，','都在同一块区域。'],80,400);
line(397,495,496,495,'#A9C0B3');circle(499,495,5,P);
callout('02','录制随时可达',['右上角保留录视频快捷入口。','连续录制自动保存草稿，','也能按现场指导手动建卡。'],1294,715);
line(1227,804,1264,804,'#A9C0B3');circle(1224,804,5,P);
callout('03','往下整理与安排',['草稿、动作卡和计划在下方。','同一动作卡支持学、练、查，','核对资料后再加入计划。'],80,1270);
line(397,1372,496,1372,'#A9C0B3');circle(499,1372,5,P);
callout('04','一个统一的入口',['底部保留四项：','训练、成长、社群、我的。','训练历史与汇总仍放在成长。'],1294,1735);
line(1227,1881,1264,1881,'#A9C0B3');circle(1224,1881,5,P);

a.push('<g transform="translate(520 280)"><clipPath id="screen"><rect width="700" height="1820" rx="34"/></clipPath>');
rect(-1,-1,702,1822,'white',35,'#CFDDD3');a.push('<g clip-path="url(#screen)">');rect(0,0,700,1820,BG,0);
text('9:41',30,33,19,T,600);text('•••  ▰',665,33,18,T,600,'end');
leaf(48,92,.65);text('训练',78,107,40,T,700);pill('录视频',491,66,179,'white',P);icon('camera',522,85,P,.75);text('10月21日  周三',30,155,24,M);text('计划与日程 ›',670,155,23,P,500,'end');
['一','二','三','四','五','六','日'].forEach((s,i)=>{const on=i===2;rect(30+i*93,181,80,86,on?P:'white',20);text(s,70+i*93,212,20,on?'#C9E0DA':M,400,'middle');text(19+i,70+i*93,248,27,on?'white':T,600,'middle');});

card(294,456);text('今日训练清单',53,342,30,T,650);pill('已完成 1 / 2',468,312,177,L,P);text('按已确认的计划顺序练习',53,382,22,M);
circle(72,439,19,P);check(72,439);text('坐姿呼吸练习',111,429,27,T,600);text('已完成 · 3组 × 5次',111,468,23,M);text('查看 ›',644,450,22,P,500,'end');line(53,495,647,495);
circle(72,542,19,'white','#9BB2A6');text('靠墙站姿练习',111,531,27,T,600);text('进行中 · 已完成1 / 3组',111,570,23,P);text('记录 ›',644,552,22,P,500,'end');rect(111,589,512,6,'#E9EFEB',3);rect(111,589,171,6,P,3);
rect(53,624,594,63,P,18);text('继续语音跟练',350,666,28,'white',600,'middle');text('线下练完，记录一下',248,726,24,P,600,'middle');line(443,704,443,734);text('补记训练',553,726,24,P,600,'middle');
text('圆圈表示本次要求已完成，部分完成记录实际量',30,789,21,M);

text('训练资料与安排',30,861,30,T,650);text('录制、整理、排计划',670,861,21,M,400,'end');
rect(30,885,311,116,'white',23);icon('camera',63,919,P,.9);text('现场录视频',92,929,26,T,600);text('连续录制，自动存草稿',53,976,20,M);
rect(359,885,311,116,'white',23);icon('edit',392,919,P,.9);text('按指导建卡',421,929,26,T,600);text('也可先手动填写要求',382,976,20,M);

card(1023,158,'#F7EEE3');pill('待整理',53,1043,112,'#EDDDC9','#90633F');text('2 张动作草稿',183,1072,27,T,600);text('补名称、个人要点，核对训练要求',53,1114,23,'#7D6B57');text('拍处方单或手动补充',53,1155,22,'#90633F');rect(450,1130,195,37,'white',18);text('继续整理  ›',547,1156,22,P,600,'middle');

text('我的动作卡',30,1237,30,T,650);text('全部 6 张 ›',670,1237,23,P,500,'end');card(1261,138);thumbnail(51,1282);text('坐姿呼吸练习',168,1309,27,T,600);pill('资料已核对',168,1328,157,L,P);text('学 · 练 · 查  ›',644,1360,23,P,500,'end');

text('我的计划',30,1457,30,T,650);text('新建计划 ＋',670,1457,23,P,500,'end');card(1481,165);text('我的训练计划',53,1527,28,T,600);pill('进行中',541,1500,105,L,P);text('2个动作 · 每周一、三、五',53,1570,24,T);text('2026.10.19 开始',53,1614,22,M);text('管理计划  ›',644,1614,23,P,600,'end');
text('调整计划保留历史记录',30,1687,21,M);

rect(0,1740,700,80,'white',0);line(0,1740,700,1740);['训练','成长','社群','我的'].forEach((n,i)=>{let x=87.5+i*175,c=i===0?P:'#95A19B';if(i===0)rect(x-40,1747,80,35,'#E7F1EB',17);icon(['grid','chart','people','person'][i],x,1766,c,.82);text(n,x,1808,21,c,i===0?600:400,'middle');});
a.push('</g></g>');
text('同一个训练首页：今日执行 → 草稿整理 → 动作卡 → 计划安排',880,2161,26,P,600,'middle');text('界面方案 · 训练量与记录均为示例',880,2200,21,M,400,'middle');
a.push('</svg>');
const svg=a.join('\n');fs.writeFileSync(path.join(__dirname,'xiaoshu-merged-training.svg'),svg,'utf8');
sharp(Buffer.from(svg)).png().toFile(path.join(__dirname,'xiaoshu-merged-training.png')).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1;});
