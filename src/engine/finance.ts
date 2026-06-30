export const sum=(a:number[])=>a.reduce((x,y)=>x+y,0);
export const npv=(rate:number, cashflows:number[])=>cashflows.reduce((a,c,i)=>a+c/Math.pow(1+rate,i),0);
export function irr(cashflows:number[]):number{let lo=-0.95,hi=1;for(let i=0;i<100;i++){const mid=(lo+hi)/2;const v=npv(mid,cashflows); if(v>0) lo=mid; else hi=mid;}return (lo+hi)/2;}
export function sizeByGearing(cost:number, gearing:number, maxDebt=Infinity){return Math.min(cost*gearing,maxDebt);}
export function sizeByDSCR(cfads:number[], ratePerPeriod:number, target:number){const debtService=cfads.map(c=>Math.max(0,c/target));return debtService.reduce((pv,ds,i)=>pv+ds/Math.pow(1+ratePerPeriod,i+1),0);}
export function straightLine(balance:number, periods:number){return Array.from({length:periods},()=>balance/periods);}
export function bullet(balance:number, periods:number){return Array.from({length:periods},(_,i)=>i===periods-1?balance:0);}
export function sculpted(cfads:number[], target:number, openingDebt:number, rate:number){let bal=openingDebt;return cfads.map(c=>{const interest=bal*rate;const principal=Math.max(0,Math.min(bal,c/target-interest));bal-=principal;return principal;});}
export function dscr(cfads:number[], debtService:number[]){return cfads.map((c,i)=>debtService[i]>0?c/debtService[i]:Infinity);}
