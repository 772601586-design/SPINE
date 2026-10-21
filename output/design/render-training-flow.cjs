const fs = require('fs');
const path = require('path');
const sharp = require('C:/Users/58724/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const out = __dirname;
const P = '#1F6F66', T = '#1F2A27', M = '#718078', BG = '#F3F5F2', L = '#DDEDE9';
let a = [];
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const rect = (x,y,w,h,fill='white',r=22,stroke='none') => a.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`);
const text = (s,x,y,z=26,c=T,weight=400,anchor='start') => a.push(`<text x="${x}" y="${y}" font-size="${z}" fill="${c}" font-weight="${weight}" text-anchor="${anchor}">${esc(s)}</text>`);
const line = (x,y,x2,y2,c='#E3EAE5',w=2) => a.push(`<path d="M${x} ${y}L${x2} ${y2}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`);
const circle = (x,y,r,fill='none',stroke='none',w=2) => a.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${w}"/>`);
const drawpath = (d,fill='none',stroke=P,w=3) => a.push(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
const check = (x,y,c='white',s=1) => drawpath(`M${x-8*s} ${y}l${6*s} ${6*s}l${12*s} ${-13*s}`,'none',c,3.3);
const pill = (s,x,y,w,fill=L,c=P) => {rect(x,y,w,40,fill,20);text(s,x+w/2,y+27,21,c,500,'middle');};
const button = (s,y,primary=true) => {rect(30,y,640,64,primary?P:'#E8F0EB',18);text(s,350,y+42,27,primary?'white':P,600,'middle');};
const card = (y,h,fill='white') => rect(30,y,640,h,fill,24);
const leaf = (x,y,k=1) => {a.push(`<g transform="translate(${x} ${y}) scale(${k})">`);drawpath('M0 24V0','none',P,3);drawpath('M0 13C-19 14-24-1-20-9C-6-10 1 1 0 13',P,'none');drawpath('M0 4C0-9 11-17 24-15C25-2 12 7 0 4',P,'none');a.push('</g>');};
const icon = (name,x,y,c=M) => {a.push(`<g transform="translate(${x} ${y})">`);if(name==='home')drawpath('M-13 0L0-12L13 0M-9-3V13H9V-3M-3 13V5H3V13','none',c,2.6);if(name==='grid')for(let i=0;i<4;i++)rect(-12+(i%2)*15,-12+Math.floor(i/2)*15,10,10,'none',2,c);if(name==='chart'){line(-13,12,13,12,c);line(-9,5,-9,-2,c,4);line(0,5,0,-12,c,4);line(9,5,9,-6,c,4);}if(name==='people'){circle(-5,-6,5,'none',c);circle(8,-4,4,'none',c);drawpath('M-16 12Q-16 0-5 0Q6 0 6 12M6 2Q17 2 17 12','none',c,2.5);}if(name==='person'){circle(0,-7,6,'none',c);drawpath('M-12 14Q-12 1 0 1Q12 1 12 14','none',c,2.5);}a.push('</g>');};
const nav = active => {rect(0,1018,700,92,'#FFF',0);line(0,1018,700,1018);['今日','训练','成长','社群','我的'].forEach((n,i)=>{const c=i===active?P:'#95A19B';if(i===active)rect(31+i*140,1025,78,43,'#E8F2ED',21);icon(['home','grid','chart','people','person'][i],70+i*140,1046,c);text(n,70+i*140,1090,21,c,i===active?600:400,'middle');});};
const back = () => drawpath('M43 77L33 87L43 97','none',T,3);
function begin(x,y,n,label,sub){text(n,x,y-22,23,P,700);text(label,x+52,y-22,27,T,600);a.push(`<g transform="translate(${x} ${y})">`);rect(-1,-1,702,1112,'#FFF',32,'#D5E1DA');a.push('<clipPath id="clip'+n+'"><rect width="700" height="1110" rx="32"/></clipPath><g clip-path="url(#clip'+n+')">');rect(0,0,700,1110,BG,0);text('9:41',30,34,19,T,600);text('•••  ▰',665,34,18,T,600,'end');back();text(label,350,97,30,T,650,'middle');if(sub)text(sub,30,145,21,M);}
function end(){a.push('</g></g>');}
function video(x,y,w,h,large=false){rect(x,y,w,h,'#DFE9E2',20);a.push(`<g transform="translate(${x} ${y})">`);rect(w*.67,15,w*.24,h*.71,'#EEF4ED',5);line(w*.79,15,w*.79,h*.71+15,'#D5E1D5');line(w*.67,h*.35,w*.91,h*.35,'#D5E1D5');rect(20,h*.8,w-40,h*.13,'#BCCBC0',10);let cx=w*.45,cy=h*.35;circle(cx,cy,h*.075,'#D4AC89');drawpath(`M${cx-13} ${cy+h*.1}Q${cx-33} ${cy+h*.25} ${cx-10} ${cy+h*.38}L${cx+51} ${cy+h*.38}`,'none','#7B9E8C',h*.09);drawpath(`M${cx-5} ${cy+h*.37}L${cx+56} ${cy+h*.37}L${cx+72} ${h*.8}`,'none','#4C6960',h*.055);drawpath(`M${cx-12} ${cy+h*.14}L${cx+20} ${cy+h*.25}L${cx+62} ${cy+h*.2}`,'none','#D4AC89',h*.037);drawpath(`M${cx-32} ${h*.54}V${h*.8}M${cx-37} ${h*.65}H${cx+32}V${h*.8}`,'none','#A1B4A6',5);if(!large){circle(w*.52,h*.52,22,'#FFFFFFDD');drawpath(`M${w*.52-5} ${h*.52-9}L${w*.52+9} ${h*.52}L${w*.52-5} ${h*.52+9}Z`,P,'none');}a.push('</g>');}

a.push('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="2820" viewBox="0 0 2400 2820"><defs><style>text{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;letter-spacing:.1px}</style></defs>');
rect(0,0,2400,2820,'#EAF0E9',0);
leaf(120,96,1.25);text('小树',166,108,38,P,700);text('PRODUCT FLOW / 01',2304,104,23,M,500,'end');
text('让现场指导，顺畅成为每天的练习',96,190,59,T,700);
text('先记录，再核对；按已确认的要求安排，保存每一次真实完成。',99,240,27,M);
pill('界面方案 · 数据为示例',1940,155,364,'#DCE7DC','#496255');

begin(96,330,'01','现场录制','训练  /  现场录动作');
video(30,175,640,385,true);pill('●  正在录制第 3 段',52,197,247,'#F9FAF7',T);rect(515,197,130,40,'#25443BCC',20);text('00:26',580,225,23,'white',600,'middle');
text('已保存草稿',30,611,28,T,600);pill('2 段',577,581,93);
video(30,635,154,98);video(212,635,154,98);text('视频 01',35,765,22,M);text('视频 02',217,765,22,M);
circle(588,683,40,'white');circle(588,683,23,'#BD6557');
text('每段自动保存，不用现在填表',30,822,25,M);button('结束本段，继续录制',855);button('完成并整理',933,false);nav(1);end();

begin(850,330,'02','整理动作卡','训练  /  动作卡');
text('坐姿呼吸练习',30,199,35,T,700);pill('草稿 · 待核对',465,169,205,'#F5E8DB','#95613C');
rect(30,222,640,54,'#E4EBE5',17);['学','练','查'].forEach((n,i)=>{if(!i)rect(34,226,207,46,'white',13);text(n,137+i*213,258,24,i?M:P,i?400:600,'middle');});
video(30,296,640,208);text('个人要点',30,547,25,T,600);text('保持肩部放松，按现场指导练习',30,585,25,M);
card(613,181);text('训练要求',53,656,27,T,600);text('组数',53,704,24,M);text('3 组',215,704,26,T,600);text('每组次数',353,704,24,M);text('5 次',571,704,26,T,600);line(53,726,647,726);text('来源：现场指导（手动填写）',53,767,23,M);
rect(33,820,23,23,'white',5,'#AABDB1');text('已按现场指导核对录入要求',71,841,24,T);text('核对仅表示本人确认录入内容',30,879,20,M);
button('保存并核对',900);text('先存草稿',179,994,23,P,600,'middle');text('补充处方单',524,994,23,P,600,'middle');nav(1);end();

begin(1604,330,'03','建立训练计划','训练  /  计划与安排');
card(174,96);text('计划名称',52,211,21,M);text('我的训练计划',52,249,28,T,600);
text('训练清单',30,318,28,T,600);text('按已确认的顺序排列',670,318,21,M,400,'end');
card(338,152);['坐姿呼吸练习','靠墙站姿练习'].forEach((n,i)=>{circle(65,380+i*69,19,L);text(i+1,65,388+i*69,22,P,600,'middle');text(n,101,389+i*69,27,T,500);text('≡',631,389+i*69,28,M);});
text('训练日程',30,544,28,T,600);pill('每天',30,566,113,'white',M);pill('固定星期',156,566,164,P,'white');pill('隔天',334,566,113,'white',M);pill('周期内若干次',460,566,210,'white',M);
['一','二','三','四','五','六','日'].forEach((s,i)=>{const on=[0,2,4].includes(i);circle(70+i*93,660,29,on?P:'white');text(s,70+i*93,670,25,on?'white':M,500,'middle');});
card(722,76);text('开始日期',52,771,25,M);text('2026.10.19',639,771,27,T,600,'end');
card(819,69,L);text('每周一、三、五练习',54,863,26,P,600);
text('频次与训练量均以已确认要求为准',30,930,22,M);button('确认并加入计划',963);end();

begin(96,1580,'04','今日','10月21日  周三');
text('今天，按自己的节奏练',30,204,35,T,700);
['一','二','三','四','五','六','日'].forEach((s,i)=>{const on=i===2;rect(32+i*93,235,78,90,on?P:'white',20);text(s,71+i*93,268,21,on?'#C9E0DA':M,400,'middle');text(19+i,71+i*93,306,26,on?'white':T,600,'middle');});
card(353,142,L);text('今日训练清单',54,400,29,P,600);text('已完成',54,451,23,P);text('1',548,461,49,P,650);text('/ 2 个动作',585,458,21,P);
card(517,119);circle(68,576,19,P);check(68,576);text('坐姿呼吸练习',109,565,28,T,600);text('已完成 · 3组 × 5次',109,605,24,M);
card(653,140);circle(68,716,19,'white','#9CB4A7');text('靠墙站姿练习',109,701,28,T,600);text('进行中 · 已完成1 / 3组',109,745,24,P);rect(109,766,511,6,'#E9EFEB',3);rect(109,766,171,6,P,3);
text('勾选圆圈，表示这个动作本次要求已完成',30,836,22,M);button('继续语音跟练',865);button('线下练完，记录一下',944,false);nav(0);end();

begin(850,1580,'05','保存训练记录','今日  /  记录实际完成');
text('靠墙站姿练习',30,202,35,T,700);pill('本次要求  3组 × 30秒',30,225,344,L,P);
text('实际完成量',30,323,28,T,600);text('按真实练习填写',670,323,21,M,400,'end');
card(345,236);[['第1组','30 秒','完成'],['第2组','20 秒','部分完成'],['第3组','—','未完成']].forEach((v,i)=>{let y=390+i*77;text(v[0],54,y,25,T);text(v[1],360,y,27,i===2?M:T,600,'middle');pill(v[2],490,y-29,154,i===0?L:i===1?'#F7ECDD':'#F0F3EF',i===0?P:i===1?'#936235':M);if(i<2)line(54,y+24,647,y+24);});
text('＋ 添加实际完成量',350,629,25,P,600,'middle');rect(30,660,640,65,'#E1E9E2',18);rect(35,665,313,55,'white',14);text('部分完成',190,703,26,P,600,'middle');text('全部完成',510,703,26,M,400,'middle');
card(747,83);text('今天的感受（选填）',52,797,23,M);button('保存实际完成量',852);button('保存后继续训练',930,false);
text('跟练与手动记录共用进度',350,1047,21,M,400,'middle');text('补记真实训练不消耗松果',350,1080,21,P,500,'middle');end();

begin(1604,1580,'06','成长','训练记录  /  周期回顾');
text('本周训练回顾',30,201,35,T,700);text('2026.10.19 — 10.25',30,243,24,M);
card(269,129);text('已记录',54,309,23,M);text('3',54,369,47,P,650);text('次',99,366,23,M);line(350,291,350,377);text('其中部分完成',382,309,23,M);text('1',382,369,47,P,650);text('次',422,366,23,M);
card(419,243);const bars=[76,0,52,0,84,0,0];for(let i=0;i<7;i++){let x=78+i*90;rect(x-13,469,26,105,'#EFF3EE',8);if(bars[i])rect(x-13,574-bars[i],26,bars[i],i===2?'#C69C70':P,8);text(19+i,x,609,21,M,400,'middle');}circle(78,638,6,P);text('已记录',94,646,18,M);circle(244,638,6,'#C69C70');text('部分完成',260,646,18,M);circle(454,638,6,'#DCE5DB');text('未记录',470,646,18,M);
text('未记录不代表未训练，可补记真实练习',30,704,22,M);text('训练历史',30,757,28,T,600);text('查看全部 ›',670,757,22,P,500,'end');
card(775,116);text('10月21日',53,818,25,T);text('部分完成',640,818,23,'#956B3E',500,'end');line(53,837,647,837);text('10月19日',53,875,25,T);text('已完成',640,875,23,P,500,'end');
card(910,87,L);text('复查资料',53,949,26,P,600);text('训练记录与个人备注',53,978,20,P);text('周期汇总  ›',640,963,24,P,600,'end');nav(2);end();

text('动作卡统一支持「学 · 练 · 查」',96,2752,26,P,600);text('资料状态与完成状态分开  ·  计划变更保留历史  ·  跟练与手动记录不重复计数',2304,2752,24,M,400,'end');
a.push('</svg>');
fs.mkdirSync(out,{recursive:true});
const svg = a.join('\n');
fs.writeFileSync(path.join(out,'xiaoshu-training-flow.svg'),svg,'utf8');
sharp(Buffer.from(svg)).png().toFile(path.join(out,'xiaoshu-training-flow.png')).then(info=>console.log(JSON.stringify(info))).catch(e=>{console.error(e);process.exitCode=1;});
