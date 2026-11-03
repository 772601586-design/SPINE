const KEY = 'xiaoshu-community-v1';
const MAIN_TOPICS = ['求助', '分享', '日常'];
function mainTopic(value) {
 return MAIN_TOPICS.includes(value) ? value : ({ '问问题': '求助', '分享经历': '分享', '记心情': '日常' }[value] || '日常');
}
function topicTags(values) {
 return [...new Set(values.flatMap(value => String(value || '').split(/[\s#＃,，]+/)).filter(Boolean))];
}
const reactionIcons = {
 heart: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjOTI5N0E1IiBzdHJva2Utd2lkdGg9IjEuOCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjAuOCA0LjZhNS41IDUuNSAwIDAgMC03LjggMEwxMiA1LjdsLTEuMS0xLjFhNS41IDUuNSAwIDAgMC03LjggNy44TDEyIDIxbDguOC04LjZhNS41IDUuNSAwIDAgMCAwLTcuOFoiLz48L3N2Zz4=',
 liked: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzEzODk4NCIgc3Ryb2tlPSIjMTM4OTg0IiBzdHJva2Utd2lkdGg9IjEuOCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjAuOCA0LjZhNS41IDUuNSAwIDAgMC03LjggMEwxMiA1LjdsLTEuMS0xLjFhNS41IDUuNSAwIDAgMC03LjggNy44TDEyIDIxbDguOC04LjZhNS41IDUuNSAwIDAgMCAwLTcuOFoiLz48L3N2Zz4=',
 comment: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjOTI5N0E1IiBzdHJva2Utd2lkdGg9IjEuOCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjEgMTEuNWE4LjUgOC41IDAgMCAxLTguNSA4LjVINGwtMiAyVjExLjVBOC41IDguNSAwIDAgMSAxMC41IDNoMmE4LjUgOC41IDAgMCAxIDguNSA4LjVaIi8+PHBhdGggZD0iTTcgOWg5TTcgMTNoNiIvPjwvc3ZnPg=='
};
// Public knowledge is loaded from the reviewed backend, never bundled draft samples.
const articles = [];
const examples = [
{id:'leaf',name:'小叶',time:'2 小时前',category:'心情',topic:'复查心情',title:'明天要复查了，有点紧张',body:'明天要复查了，有点紧张。大家会提前准备什么？',detail:'资料已经整理好了，还是有点担心。想听听大家怎么度过复查前的一晚。',hugs:12,comments:8},
{id:'sen',name:'阿禾',time:'1 天前',category:'训练',topic:'训练感受',title:'给自己留一点休息时间',body:'今天完成了训练，也给自己留了休息时间。',hugs:6,comments:2},
{id:'list',name:'晴晴',time:'1 天前',category:'支具',topic:'复查准备',title:'我的复查准备清单',body:'整理了一下这次复查要带的资料，也记录了自己的问题清单，希望能帮到大家。',hugs:21,comments:56}
];
module.exports = function createCommunityPage(management = false) {
return {
 openKnowledge(){wx.navigateTo({url:'/pages/knowledge/index'+(this.data.query?'?mode=list&q='+encodeURIComponent(this.data.query):'')});},
 onShow(){this.reload();this.refresh();if(!management&&this.getTabBar)wx.nextTick(()=>{const bar=this.getTabBar();if(bar)bar.setData({selected:2});});},
 data:{reactionIcons,management,editingId:'',ownPosts:[],screen:management?'manage':'home',tab:'交流',filter:'全部',searchTab:'全部',query:'',tabs:['交流','知识'],categories:['全部','认识侧弯','支具生活','训练记录','复查准备','情绪关系'],searchTabs:['全部','知识','经历'],mainTopics:MAIN_TOPICS,mainTopic:'日常',tags:[],tagInput:'',images:[],body:'',visibility:'仅自己可见',reply:'',selected:{},saved:false,shownArticles:articles,shownPosts:examples},
 onLoad(){this.history=[];this.reload();this.refresh();},
 reload(){this.local=wx.getStorageSync(KEY)||{};for(const k of ['posts','hugs','saved'])this.local[k]=Array.isArray(this.local[k])?this.local[k]:[];this.local.replies=this.local.replies||{};},
 persist(next=this.local){try{wx.setStorageSync(KEY,next);this.local=next;return true;}catch(e){wx.showToast({title:'保存失败，请稍后重试',icon:'none'});return false;}},
 refresh(){
  const posts=this.local.posts.concat(examples).map(p=>({...p,displayTags:topicTags([p.mainTopic||p.topic,...(Array.isArray(p.tags)?p.tags:[])]),hugged:this.local.hugs.includes(p.id),hugs:p.hugs+(this.local.hugs.includes(p.id)?1:0),comments:p.comments+(this.local.replies[p.id]||[]).length}));
  const q=this.data.query.trim();
  this.setData({posts,ownPosts:posts.slice(0,this.local.posts.length),shownPosts:posts.filter(p=>!q||(p.title+p.body+p.displayTags.map(tag=>'#'+tag).join(' ')).includes(q)),shownArticles:articles.filter(a=>(this.data.screen==='search'||this.data.filter==='全部'||a.category===this.data.filter)&&(!q||(a.title+a.summary+a.category).includes(q)))});
  if(this.data.screen==='post'){
   const selected=posts.find(p=>p.id===this.data.selected.id);
   if(selected)this.setData({selected,saved:this.local.saved.includes(selected.id),replies:this.postReplies(selected.id)});
   else{this.history=[];this.setData({screen:management?'manage':'home',selected:{},reply:'',replies:[]});}
  }
 },
 postReplies(id){
  const initial=id==='leaf'?[{name:'阿禾',time:'1 小时前',body:'我会先把想问的问题写下来，到了现场就不容易忘。'},{name:'青青',time:'2 小时前',body:'抱抱你，希望明天沟通顺利。'}]:[];
  return initial.concat(this.local.replies[id]||[]);
 },
 pickTab(e){if(e.currentTarget.dataset.value==='知识'){this.openKnowledge();return;}this.setData({tab:e.currentTarget.dataset.value,filter:'全部',query:''});this.refresh();},
 pickFilter(e){this.setData({filter:e.currentTarget.dataset.value});this.refresh();},
 search(){this.go('search');this.setData({filter:'全部'});this.refresh();},
 inputSearch(e){this.setData({query:e.detail.value});this.refresh();},
 clearSearch(){this.setData({query:''});this.refresh();},
 pickSearchTab(e){this.setData({searchTab:e.currentTarget.dataset.value});},
 back(){if(management&&!(this.history||[]).length){wx.navigateBack();return;}const screen=(this.history||[]).pop()||(management?'manage':'home');this.setData({screen,editingId:'',query:screen==='search'?this.data.query:''});this.reload();this.refresh();},
 go(screen){this.history=this.history||[];this.history.push(this.data.screen);this.setData({screen});},
 openPost(e){const post=this.data.posts.find(p=>p.id===e.currentTarget.dataset.id);if(!post)return;this.go('post');this.setData({selected:post,saved:this.local.saved.includes(post.id),replies:this.postReplies(post.id)});},
 openArticle(e){wx.navigateTo({url:'/pages/knowledge/index?mode=article&id='+encodeURIComponent(e.currentTarget.dataset.id)});},
 compose(e){
  this.reload();
  const draft=this.local.draft||{};
  const requested=e&&e.currentTarget&&e.currentTarget.dataset.type;
  const selected=mainTopic(requested||draft.mainTopic||draft.composeType);
  this.go('compose');
  this.setData({editingId:'',mainTopic:selected,body:draft.body||'',images:Array.isArray(draft.images)?draft.images.slice():[],tags:topicTags(Array.isArray(draft.tags)?draft.tags:[]).filter(tag=>tag!==selected),tagInput:draft.tagInput||'',visibility:draft.visibility||'仅自己可见'});
 },
 addImage(){wx.chooseMedia({count:1,mediaType:['image'],success:result=>{const source=result.tempFiles[0].tempFilePath;const dest=wx.env.USER_DATA_PATH+'/community-'+Date.now()+'.jpg';wx.getFileSystemManager().copyFile({srcPath:source,destPath:dest,success:()=>this.setData({images:(this.data.images||[]).concat(dest)}),fail:()=>wx.showToast({title:'图片保存失败，请重试',icon:'none'})});}});},
 removeImage(e){this.setData({images:this.data.images.filter((_,i)=>i!==Number(e.currentTarget.dataset.index))});},
 pickType(e){const value=e.currentTarget.dataset.value;if(MAIN_TOPICS.includes(value))this.setData({mainTopic:value,tags:this.data.tags.filter(tag=>tag!==value)});},
 inputBody(e){this.setData({body:e.detail.value});},
 inputTag(e){this.setData({tagInput:e.detail.value});},
 addTag(){this.setData({tags:topicTags([...this.data.tags,this.data.tagInput]).filter(tag=>tag!==this.data.mainTopic),tagInput:''});},
 removeTag(e){this.setData({tags:this.data.tags.filter((_,index)=>index!==Number(e.currentTarget.dataset.index))});},
 composeDraft(){return {mainTopic:this.data.mainTopic,tags:topicTags([...this.data.tags,this.data.tagInput]).filter(tag=>tag!==this.data.mainTopic),body:this.data.body,images:this.data.images.slice(),visibility:this.data.visibility};},
 visibility(){this.setData({visibility:this.data.visibility==='仅自己可见'?'社群可见':'仅自己可见'});},
 saveDraft(){
  if(this.data.editingId)return;
  this.reload();
  const draft=this.composeDraft();
  if(this.persist({...this.local,draft})){
   this.setData({tags:draft.tags,tagInput:''});
   wx.showToast({title:'草稿已保存',icon:'success'});
  }
 },
 submit(){
  if(this.data.editingId)return this.saveEdit();
  this.reload();
  const draft=this.composeDraft(),body=draft.body.trim();
  if(!body&&!draft.images.length)return wx.showToast({title:'写下想法或添加图片后再发布',icon:'none'});
  const post={id:'local-'+Date.now(),name:'我',time:'刚刚',category:draft.mainTopic,mainTopic:draft.mainTopic,topic:draft.mainTopic,tags:draft.tags,title:body.slice(0,24)||'图片分享',body,hugs:0,comments:0,images:draft.images,private:draft.visibility==='仅自己可见'};
  if(!this.persist({...this.local,posts:[post,...this.local.posts],draft:null}))return;
  this.history=[];
  this.setData({screen:'home',tab:'交流',filter:'全部',query:'',tags:[],tagInput:'',body:'',images:[]});
  this.refresh();
  wx.showToast({title:post.private?'已发布，仅自己可见':'已发布到本机演示',icon:'none'});
 },
 editPost(e){
  this.reload();
  const post=this.local.posts.find(p=>p.id===e.currentTarget.dataset.id);
  if(!post)return wx.showToast({title:'帖子已不存在',icon:'none'});
  const selected=mainTopic(post.mainTopic||post.category);
  this.go('compose');
  this.setData({editingId:post.id,mainTopic:selected,body:post.body||'',images:Array.isArray(post.images)?post.images.slice():[],tags:topicTags([...(Array.isArray(post.tags)?post.tags:[]),post.topic]).filter(tag=>tag!==selected),tagInput:'',visibility:post.private?'仅自己可见':'社群可见'});
 },
 saveEdit(){
  this.reload();
  const index=this.local.posts.findIndex(p=>p.id===this.data.editingId);
  if(index<0)return wx.showToast({title:'帖子已不存在，无法保存',icon:'none'});
  const draft=this.composeDraft(),body=draft.body.trim();
  if(!body&&!draft.images.length)return wx.showToast({title:'写下想法或添加图片后再保存',icon:'none'});
  const posts=this.local.posts.slice();
  posts[index]={...posts[index],category:draft.mainTopic,mainTopic:draft.mainTopic,topic:draft.mainTopic,tags:draft.tags,title:body.slice(0,24)||'图片分享',body,detail:'',images:draft.images,private:draft.visibility==='仅自己可见'};
  if(!this.persist({...this.local,posts}))return;
  this.back();
  wx.showToast({title:'修改已保存',icon:'success'});
 },
 changePostVisibility(e){
  const id=e.currentTarget.dataset.id;
  this.reload();
  if(!this.local.posts.some(p=>p.id===id))return;
  wx.showActionSheet({itemList:['仅自己可见','社群可见'],success:result=>{
   if(result.tapIndex!==0&&result.tapIndex!==1)return;
   this.reload();
   if(!this.local.posts.some(p=>p.id===id))return;
   const posts=this.local.posts.map(p=>p.id===id?{...p,private:result.tapIndex===0}:p);
   if(this.persist({...this.local,posts})){this.refresh();wx.showToast({title:'可见范围已更新',icon:'success'});}
  }});
 },
 deletePost(e){
  const id=e.currentTarget.dataset.id;
  this.reload();
  if(!this.local.posts.some(p=>p.id===id))return;
  wx.showModal({title:'删除这条帖子？',content:'删除后无法恢复，相关点赞、评论和收藏也会一并移除。',confirmText:'删除',confirmColor:'#b55454',success:result=>{
   if(!result.confirm)return;
   this.reload();
   if(!this.local.posts.some(p=>p.id===id))return;
   const replies={...this.local.replies};
   delete replies[id];
   const next={...this.local,posts:this.local.posts.filter(p=>p.id!==id),hugs:this.local.hugs.filter(value=>value!==id),saved:this.local.saved.filter(value=>value!==id),replies};
   if(this.persist(next)){this.refresh();wx.showToast({title:'帖子已删除',icon:'success'});}
  }});
 },
 hug(e){const id=e.currentTarget.dataset.id||this.data.selected.id;const i=this.local.hugs.indexOf(id);if(i<0)this.local.hugs.push(id);else this.local.hugs.splice(i,1);this.persist();this.refresh();if(this.data.screen==='post')this.setData({selected:this.data.posts.find(p=>p.id===id)});},
 collect(){const id=this.data.selected.id;const i=this.local.saved.indexOf(id);if(i<0)this.local.saved.push(id);else this.local.saved.splice(i,1);if(this.persist())this.setData({saved:i<0});},
 inputReply(e){this.setData({reply:e.detail.value});},sendReply(){const body=this.data.reply.trim();if(!body)return;const id=this.data.selected.id;const reply={name:'我',time:'刚刚',body};const list=this.local.replies[id]||[];list.push(reply);this.local.replies[id]=list;if(this.persist()){this.setData({replies:this.data.replies.concat(reply),reply:''});this.refresh();this.setData({selected:this.data.posts.find(p=>p.id===id)});}},
 discussion(){this.go('search');this.setData({query:'复查',searchTab:'经历'});this.refresh();},share(){wx.setClipboardData({data:this.data.selected.title+'\n'+this.data.selected.summary});}
};
};
