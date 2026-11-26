export const stages = {
 cec:['待拜访','已有意向','已转交销售','销售已建联','项目已激活','暂缓','无机会'],
 se:['待筛选','待建联','建联中','需求已确认','已转耳机团队','项目已激活','暂缓','无机会'],
 vc:['P0. 季度Upsell前已导入','P1. 无此房型需求','P2. 有此房型但季度内无机会','P3. 未激活沟通中','P4. 激活并送测','P5. 完成测试且落地现网设备部署'],
 service:['待制定计划','待建联','推广中','报价中','待订单','已产生POS','暂缓'],
 pos:['待确认','已确认']
};
export const labels={cec:'CEC 耳机',se:'SE 耳机',vc:'VC 设备',service:'服务计划',pos:'服务 POS'};
export function cleanRecord(input,previous=null){
 if(!input||typeof input!=='object'||Array.isArray(input)) throw Error('记录格式无效');
 const r={};
 for(const key of ['kind','customer','owner','sales','contact','product','stage','next','due','progress','newProject','projectUrl','activationDate','importDate','evidence','visitDate','handoffDate','decisionMaker','headsetProgress','oldProject','size','focus','oldReportDate','oldWinDate','originalStage','source','posDate','posRef','channel']) {
  const value=input[key]??'';
  if(typeof value!=='string'||value.length>8000) throw Error('字段格式无效或过长');
  r[key]=value.trim();
 }
 if(!stages[r.kind]||!stages[r.kind].includes(r.stage)) throw Error('请选择有效的业务类型和阶段');
 if(previous&&previous.kind!==r.kind) throw Error('不能更改记录业务类型');
 if(!r.customer) throw Error('请填写客户名称');
 for(const k of ['due','activationDate','importDate','visitDate','handoffDate','oldReportDate','oldWinDate','posDate']) {
  if(r[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(r[k])||Number.isNaN(Date.parse(r[k]))||new Date(r[k]).toISOString().slice(0,10)!==r[k])) throw Error('日期无效');
 }
 if(r.projectUrl&&!/^https?:\/\/[^\s/]+/i.test(r.projectUrl))throw Error('项目链接需以 http:// 或 https:// 开头');
 for(const k of ['amount','quantity','expectedAmount']) {r[k]=input[k]===undefined||input[k]===''?null:Number(input[k]);if(r[k]!==null&&(!Number.isFinite(r[k])||Math.abs(r[k])>1e9))throw Error('金额或数量无效');}
 r.archived=Boolean(input.archived);r.numberWarning=Boolean(previous?.numberWarning??input.numberWarning);
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 if(r.stage==='项目已激活'&&(!r.activationDate||r.activationDate>today||!r.evidence||!r.newProject))throw Error('激活需填写新增项目编号、有效激活日期及依据');
 if(r.kind==='pos'&&r.stage==='已确认'&&(!r.posDate||r.posDate>today||r.amount===null||!r.posRef||!r.evidence))throw Error('确认 POS 需填写日期、金额、唯一订单/POS编号及依据');
 if(!Array.isArray(input.history)||input.history.length>500)throw Error('跟进记录无效');
 r.history=input.history.map(h=>{if(typeof h.text!=='string'||h.text.length>8000||typeof h.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(h.date))throw Error('跟进记录无效');return {date:h.date,text:h.text};});
 return r;
}
export function metrics(rows,today=new Date(Date.now()+8*3600000).toISOString().slice(0,10)){
 const q4=d=>d&&d>='2026-10-01'&&d<='2026-12-31'&&d<=today;
 const active=rows.filter(r=>!r.archived);
 const dedupe=rs=>new Set(rs.map(r=>r.newProject||r.oldProject||r.customer)).size;
 const headset=rows.filter(r=>['cec','se'].includes(r.kind)&&r.stage==='项目已激活'&&q4(r.activationDate)&&r.evidence&&r.newProject);
 return {cec:dedupe(headset.filter(r=>r.kind==='cec')),se:dedupe(headset.filter(r=>r.kind==='se')),headset:dedupe(headset),
 videoActive:dedupe(rows.filter(r=>r.kind==='vc'&&q4(r.activationDate)&&r.evidence)),videoImport:dedupe(rows.filter(r=>r.kind==='vc'&&q4(r.importDate)&&r.evidence)),
 pos:Math.round(rows.filter(r=>r.kind==='pos'&&r.stage==='已确认'&&q4(r.posDate)).reduce((n,r)=>n+Number(r.amount||0),0)*1e6)/1e6,
 overdue:active.filter(r=>r.due&&r.due<today&&!['无机会','暂缓','项目已激活','已产生POS'].includes(r.stage)),unassigned:active.filter(r=>r.kind!=='pos'&&!r.owner)};
}
