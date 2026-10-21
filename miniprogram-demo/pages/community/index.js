const KEY = 'xiaoshu-community-v1';
const articles = [
{id:'review',category:'复查准备',title:'复查前，资料怎么整理？',summary:'把资料、记录和问题放在一起，方便沟通。',reads:'1.2 万',steps:[{title:'检查资料',body:'按日期整理已有报告。'},{title:'训练记录',body:'回顾实际完成情况和感受。'},{title:'想问的问题',body:'写下不确定的事项，带去沟通。'}]},
{id:'record',category:'训练记录',title:'如何保存现场动作示范？',summary:'用合适的方式记录，方便之后回顾。',reads:'8.6 千',steps:[{title:'先征得同意',body:'记录前先询问现场指导人员是否方便拍摄。'},{title:'记下要点',body:'整理动作名称、现场说明和疑问。'},{title:'回顾与核对',body:'不清楚的地方，下次向指导人员核对。'}]},
{id:'family',category:'情绪关系',title:'怎样向家人表达感受？',summary:'分享真实的想法，让彼此更理解。',reads:'6.4 千',steps:[{title:'留出时间',body:'选一个双方都方便的时刻，慢慢说。'},{title:'表达感受',body:'试着说出此刻的心情。'},{title:'说出需要',body:'可以是一起整理资料，也可以只是陪伴。'}]}
];
const examples = [
{id:'leaf',name:'小叶',time:'2 小时前',category:'心情',topic:'复查心情',title:'明天要复查了，有点紧张',body:'明天要复查了，有点紧张。大家会提前准备什么？',detail:'资料已经整理好了，还是有点担心。想听听大家怎么度过复查前的一晚。',hugs:12,comments:8},
{id:'sen',name:'阿禾',time:'1 天前',category:'训练',topic:'训练感受',title:'给自己留一点休息时间',body:'今天完成了训练，也给自己留了休息时间。',hugs:6,comments:2},
{id:'list',name:'晴晴',time:'1 天前',category:'支具',topic:'复查准备',title:'我的复查准备清单',body:'整理了一下这次复查要带的资料，也记录了自己的问题清单，希望能帮到大家。',hugs:21,comments:56}
];
Page({
 data:{screen:'home',tab:'交流',filter:'全部',searchTab:'全部',query:'',tabs:['交流','知识'],filters:['全部','支具','训练','心情'],categories:['全部','认识侧弯','支具生活','训练记录','复查准备','情绪关系'],searchTabs:['全部','知识','经历'],composeTabs:['记心情','问问题','分享经历'],composeType:'记心情',moods:['轻松','低落','难熬','担心','有进步'],mood:'担心',body:'',visibility:'仅自己可见',reply:'',selected:{},saved:false,shownArticles:articles,shownPosts:examples},
 onLoad(){this.local=wx.getStorageSync(KEY)||{};for(const k of ['posts','hugs','saved'])this.local[k]=this.local[k]||[];this.local.replies=this.local.replies||{};this.refresh();},
 persist(){try{wx.setStorageSync(KEY,this.local);return true;}catch(e){wx.showToast({title:'保存失败，请稍后重试',icon:'none'});return false;}},
 refresh(){const posts=this.local.posts.concat(examples).map(p=>({...p,hugged:this.local.hugs.includes(p.id),hugs:p.hugs+(this.local.hugs.includes(p.id)?1:0),comments:p.comments+(this.local.replies[p.id]||[]).length}));const q=this.data.query.trim();this.setData({posts,shownPosts:posts.filter(p=>(this.data.screen==='search'||this.data.filter==='全部'||p.category===this.data.filter)&&(!q||(p.title+p.body+p.topic).includes(q))),shownArticles:articles.filter(a=>(this.data.screen==='search'||this.data.filter==='全部'||a.category===this.data.filter)&&(!q||(a.title+a.summary+a.category).includes(q)))});},
 pickTab(e){this.setData({tab:e.currentTarget.dataset.value,filter:'全部',query:''});this.refresh();},
 pickFilter(e){this.setData({filter:e.currentTarget.dataset.value});this.refresh();},
 search(){this.go('search');this.setData({filter:'全部'});this.refresh();},
 inputSearch(e){this.setData({query:e.detail.value});this.refresh();},
 clearSearch(){this.setData({query:''});this.refresh();},
 pickSearchTab(e){this.setData({searchTab:e.currentTarget.dataset.value});},
 back(){const screen=this.history.pop()||'home';this.setData({screen,query:screen==='search'?this.data.query:''});this.refresh();},
 go(screen){this.history=this.history||[];this.history.push(this.data.screen);this.setData({screen});},
 openPost(e){const post=this.data.posts.find(p=>p.id===e.currentTarget.dataset.id);if(!post)return;this.go('post');const initial=post.id==='leaf'?[{name:'阿禾',time:'1 小时前',body:'我会先把想问的问题写下来，到了现场就不容易忘。'},{name:'青青',time:'2 小时前',body:'抱抱你，希望明天沟通顺利。'}]:[];this.setData({selected:post,saved:this.local.saved.includes(post.id),replies:initial.concat(this.local.replies[post.id]||[])});},
 openArticle(e){const selected=articles.find(a=>a.id===e.currentTarget.dataset.id);this.go('article');this.setData({selected,saved:this.local.saved.includes(selected.id)});},
 compose(e){this.go('compose');this.setData({composeType:'记心情',body:'',images:[],mood:'担心',visibility:'仅自己可见',...(this.local.draft||{}),...(e.currentTarget.dataset.type?{composeType:e.currentTarget.dataset.type}:{})});},
 addImage(){wx.chooseMedia({count:1,mediaType:['image'],success:result=>{const source=result.tempFiles[0].tempFilePath;const dest=wx.env.USER_DATA_PATH+'/community-'+Date.now()+'.jpg';wx.getFileSystemManager().copyFile({srcPath:source,destPath:dest,success:()=>this.setData({images:(this.data.images||[]).concat(dest)}),fail:()=>wx.showToast({title:'图片保存失败，请重试',icon:'none'})});}});},
 removeImage(e){this.setData({images:this.data.images.filter((_,i)=>i!==Number(e.currentTarget.dataset.index))});},
 pickType(e){this.setData({composeType:e.currentTarget.dataset.value});},pickMood(e){this.setData({mood:e.currentTarget.dataset.value});},inputBody(e){this.setData({body:e.detail.value});},
 visibility(){this.setData({visibility:this.data.visibility==='仅自己可见'?'社群可见':'仅自己可见'});},
 saveDraft(){this.local.draft={images:this.data.images,body:this.data.body,mood:this.data.mood,composeType:this.data.composeType,visibility:this.data.visibility};if(this.persist())wx.showToast({title:'草稿已保存',icon:'success'});},
 submit(){const body=this.data.body.trim();if(!body&&this.data.composeType!=='记心情')return wx.showToast({title:'先写下想分享的内容',icon:'none'});const post={id:'local-'+Date.now(),name:'我',time:'刚刚',category:'心情',topic:this.data.composeType==='记心情'?this.data.mood:this.data.composeType,title:body.slice(0,24)||'今天的心情：'+this.data.mood,body:body||'今天的心情：'+this.data.mood,hugs:0,comments:0,images:this.data.images,private:this.data.visibility==='仅自己可见'};this.local.posts.unshift(post);this.local.draft=null;if(!this.persist()){this.local.posts.shift();return;}this.history=[];this.setData({screen:'home',tab:'交流',filter:'全部',query:''});this.refresh();wx.showToast({title:post.private?'已保存，仅自己可见':'已发布到本机演示',icon:'none'});},
 hug(e){const id=e.currentTarget.dataset.id||this.data.selected.id;const i=this.local.hugs.indexOf(id);if(i<0)this.local.hugs.push(id);else this.local.hugs.splice(i,1);this.persist();this.refresh();if(this.data.screen==='post')this.setData({selected:this.data.posts.find(p=>p.id===id)});},
 collect(){const id=this.data.selected.id;const i=this.local.saved.indexOf(id);if(i<0)this.local.saved.push(id);else this.local.saved.splice(i,1);if(this.persist())this.setData({saved:i<0});},
 inputReply(e){this.setData({reply:e.detail.value});},sendReply(){const body=this.data.reply.trim();if(!body)return;const id=this.data.selected.id;const reply={name:'我',time:'刚刚',body};const list=this.local.replies[id]||[];list.push(reply);this.local.replies[id]=list;if(this.persist()){this.setData({replies:this.data.replies.concat(reply),reply:''});this.refresh();this.setData({selected:this.data.posts.find(p=>p.id===id)});}},
 discussion(){this.go('search');this.setData({query:'复查',searchTab:'经历'});this.refresh();},share(){wx.setClipboardData({data:this.data.selected.title+'\n'+this.data.selected.summary});}
});

