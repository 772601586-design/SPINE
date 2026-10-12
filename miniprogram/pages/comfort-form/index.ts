import type { ComfortEntry, WearSession } from '../../models/types';
import { api } from '../../services/api';
import { requireSession } from '../../services/session';

function localInput(value?: string | null): string { return value ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0,16).replace('T',' ') : ''; }
function toServer(value: string): string { const text=value.trim().replace(' ','T'); const normalized=/(Z|[+-]\d\d:\d\d)$/.test(text)?text:`${text}+08:00`; const date=new Date(normalized); if(!Number.isFinite(date.getTime()))throw new Error('时间格式应为 YYYY-MM-DD HH:mm。'); return date.toISOString(); }
function uuid(): string { const h=Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join(''); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${((parseInt(h[16],16)&3)|8).toString(16)}${h.slice(17,20)}-${h.slice(20)}`; }

Page({
  data: { braceId: 0, id: 0, editing: false, comfortOptions: [{value:1,label:'很不舒服'},{value:2,label:'不太舒服'},{value:3,label:'一般'},{value:4,label:'比较舒适'},{value:5,label:'很舒适'}], comfortLevel: 0,
    positionOptions: ['颈部','肩部','胸背','腰部','髋部','腹部'].map(name=>({name,selected:false})), tagOptions: ['压迫','摩擦','闷热','瘙痒','疼痛','麻木','活动受限'].map(name=>({name,selected:false})), positions: [] as string[], tags: [] as string[],
    pain: '', painNote: '', otherPosition: '', otherTag: '', occurredAt: '', notes: '', wearOptions: [{id:0,label:'不关联佩戴记录'}], wearIndex: 0, wearId: 0, busy: false, error: '' },
  requestId: '',
  async onLoad(query: { braceId?: string; id?: string }) {
    if (!await requireSession()) return;
    const braceId=Number(query?.braceId??0), id=Number(query?.id??0); this.requestId=uuid();
    this.setData({braceId,id,editing:!!id,occurredAt:localInput(new Date().toISOString())});
    try {
      const [wears, feelings]=await Promise.all([api.wears(),api.feelings()]);
      const available=wears.filter(w=>w.brace===braceId);
      const wearOptions=[{id:0,label:'不关联佩戴记录'},...available.map(w=>({id:w.id,label:`#${w.id} · ${localInput(w.started_at)}`}))];
      const entry=feelings.find(f=>f.id===id);
      if(id&&!entry){this.setData({error:'感受记录不存在或不可访问。'});return;}
      if(entry)this.setData({braceId:entry.brace,comfortLevel:entry.comfort_level??0,pain:entry.pain===null?'':String(entry.pain),painNote:entry.pain_note,positions:entry.positions,tags:entry.tags,positionOptions:this.data.positionOptions.map(o=>({...o,selected:entry.positions.includes(o.name)})),tagOptions:this.data.tagOptions.map(o=>({...o,selected:entry.tags.includes(o.name)})),occurredAt:localInput(entry.occurred_at),notes:entry.notes,wearId:entry.wear_session??0});
      const wearId=entry?.wear_session??0; const wearIndex=Math.max(0,wearOptions.findIndex(w=>w.id===wearId));
      this.setData({wearOptions,wearIndex,wearId});
    }catch(_){this.setData({error:'读取记录失败，请重试。'});}
  },
  input(event:{currentTarget:{dataset:{key:string}};detail:{value:string}}){this.setData({[event.currentTarget.dataset.key]:event.detail.value});},
  inputPain(event:{detail:{value:string}}){this.setData({pain:event.detail.value});},
  chooseComfort(event:{currentTarget:{dataset:{value:string}}}){this.setData({comfortLevel:Number(event.currentTarget.dataset.value)});},
  toggleChoice(event:{currentTarget:{dataset:{kind:string;value:string}}}){const {kind,value}=event.currentTarget.dataset;const key=kind==='position'?'positions':'tags';const optionsKey=kind==='position'?'positionOptions':'tagOptions';const values=[...(this.data[key] as string[])];const index=values.indexOf(value);if(index>=0)values.splice(index,1);else values.push(value);const options=(this.data[optionsKey] as Array<{name:string;selected:boolean}>).map(o=>({...o,selected:values.includes(o.name)}));this.setData({[key]:values,[optionsKey]:options});},
  chooseWear(event:{detail:{value:string}}){const index=Number(event.detail.value);this.setData({wearIndex:index,wearId:this.data.wearOptions[index].id});},
  async save(){if(this.data.busy)return;this.setData({busy:true,error:''});try{const pain=this.data.pain.trim()===''?null:Number(this.data.pain);if(pain!==null&&(!Number.isInteger(pain)||pain<0||pain>10))throw new Error('痛感需为 0—10 的整数，或留空。');const positions=[...this.data.positions,...(this.data.otherPosition.trim()?[this.data.otherPosition.trim()]:[])];const tags=[...this.data.tags,...(this.data.otherTag.trim()?[this.data.otherTag.trim()]:[])];const body:Record<string,unknown>={brace:this.data.braceId,wear_session:this.data.wearId||null,comfort_level:this.data.comfortLevel||null,pain,pain_note:this.data.painNote.trim(),positions,tags,occurred_at:toServer(this.data.occurredAt),notes:this.data.notes.trim()};if(!this.data.editing)body.request_id=this.requestId;await api.saveFeeling(body,this.data.id||undefined);wx.showToast({title:'已保存',icon:'success'});wx.navigateBack();}catch(error){this.setData({error:error instanceof Error?error.message:'保存失败，内容仍保留，请检查网络后重试。'});}finally{this.setData({busy:false});}},
  openFollowUps(){wx.navigateTo({url:`/pages/follow-ups/index?entryId=${this.data.id}`});},
});
