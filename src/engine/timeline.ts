import { Frequency, Period, TimelineAssumptions } from './types';
const monthsByFreq:Record<Frequency,number>={monthly:1,quarterly:3,'semi-annual':6,annual:12};
export const addMonths=(date:string,months:number)=>{const d=new Date(date+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString().slice(0,10)};
export function generateTimeline(t:TimelineAssumptions):Period[]{const step=monthsByFreq[t.frequency];const out:Period[]=[];let s=t.projectStart;let i=0;while(new Date(s)<=new Date(t.operationEnd)){const e=addMonths(s,step);out.push({index:i,label:`P${i+1}`,start:s,end:e,phase:new Date(e)<=new Date(t.cod)?'construction':'operation',year:new Date(s).getUTCFullYear()});s=e;i++; if(i>600) throw new Error('Timeline exceeds 600 periods');}return out;}
export function periodsPerYear(f:Frequency){return 12/monthsByFreq[f];}
