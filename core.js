const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]);
const transpose=a=>[a[0],a[2],a[1],a[3]];
const multiply=(a,b)=>[a[0]*b[0]+a[1]*b[2],a[0]*b[1]+a[1]*b[3],a[2]*b[0]+a[3]*b[2],a[2]*b[1]+a[3]*b[3]];
const vector=(a,x)=>[a[0]*x[0]+a[1]*x[1],a[2]*x[0]+a[3]*x[1]];
function inverse(p){const schur=p[3]-p[2]*p[1]/p[0];if(!(p[0]>0&&schur>0))throw Error('Covariance lost positive definiteness at this numerical scale.');return [1/p[0]+p[1]*p[2]/(p[0]*p[0]*schur),-p[1]/(p[0]*schur),-p[2]/(p[0]*schur),1/schur];}
function covariance(p){const cross=(p[1]+p[2])/2;const result=[p[0],cross,cross,p[3]];if(result.some(x=>!Number.isFinite(x))||p[0]<=0||p[3]<=0||p[3]-cross*cross/p[0]<=0)throw Error('Covariance is not numerically positive definite.');return result;}
function number(x,low,high,label){if(typeof x!=='number'||!Number.isFinite(x)||x<low||x>high)throw Error(`${label} must be a finite number from ${low} to ${high}.`);return x;}
export function normalize(input){
 if(!input||!input.options||!Array.isArray(input.observations)||input.observations.length<2||input.observations.length>500)throw Error('Provide settings and 2–500 observations.');
 const o=input.options,options={q:number(o.q,.001,100,'Process intensity'),r:number(o.r,.001,10000,'Measurement variance'),gate:number(o.gate,0,1000,'Innovation gate'),position:number(o.position,-100000,100000,'Initial position'),velocity:number(o.velocity,-10000,10000,'Initial velocity'),positionVariance:number(o.positionVariance,.001,10000,'Initial position variance'),velocityVariance:number(o.velocityVariance,.001,10000,'Initial velocity variance')};
 const observations=input.observations.map((row,i)=>{if(!row||typeof row!=='object')throw Error('Each observation must be an object.');const t=number(row.t,0,1000000,'Time');if(i){const dt=t-input.observations[i-1].t;if(dt<.1-1e-9||dt>10+1e-9)throw Error('Successive times must increase by 0.1–10 units.');}const z=row.z===null?null:number(row.z,-100000,100000,'Position measurement');const result={t,z};if(row.truth!==undefined){if(!Array.isArray(row.truth)||row.truth.length!==2)throw Error('Truth must be [position, velocity].');result.truth=[number(row.truth[0],-100000,100000,'True position'),number(row.truth[1],-10000,10000,'True velocity')];}return result;});return {options,observations};
}
export function estimate(input){
 const study=normalize(input),o=study.options,rows=[];let x=[o.position,o.velocity],p=[o.positionVariance,0,0,o.velocityVariance];
 for(let i=0;i<study.observations.length;i++){
  const obs=study.observations[i],dt=i?obs.t-study.observations[i-1].t:0,F=[1,dt,0,1],Q=[o.q*dt**3/3,o.q*dt**2/2,o.q*dt**2/2,o.q*dt];
  const predicted=vector(F,x),predictedCovariance=covariance(add(multiply(multiply(F,p),transpose(F)),Q));
  const innovation=obs.z===null?null:obs.z-predicted[0],innovationVariance=predictedCovariance[0]+o.r,nis=innovation===null?null:innovation**2/innovationVariance;
  const status=obs.z===null?'missing':o.gate>0&&nis>o.gate?'gated':'accepted';let gain=[0,0];x=predicted;p=predictedCovariance;
  if(status==='accepted'){
   gain=[p[0]/innovationVariance,p[2]/innovationVariance];x=add(predicted,gain.map(k=>k*innovation));
   const A=[1-gain[0],0,-gain[1],1],KRK=[gain[0]**2*o.r,gain[0]*gain[1]*o.r,gain[0]*gain[1]*o.r,gain[1]**2*o.r];
   p=covariance(add(multiply(multiply(A,p),transpose(A)),KRK));
  }
  rows.push({...obs,dt,F,predicted,predictedCovariance,innovation,innovationVariance,nis,status,gain,filtered:[...x],filteredCovariance:[...p]});
 }
 rows.at(-1).smoothed=[...rows.at(-1).filtered];rows.at(-1).smoothedCovariance=[...rows.at(-1).filteredCovariance];rows.at(-1).smootherGain=null;
 for(let i=rows.length-2;i>=0;i--){const row=rows[i],next=rows[i+1],J=multiply(multiply(row.filteredCovariance,transpose(next.F)),inverse(next.predictedCovariance));row.smootherGain=J;row.smoothed=add(row.filtered,vector(J,sub(next.smoothed,next.predicted)));row.smoothedCovariance=covariance(add(row.filteredCovariance,multiply(multiply(J,sub(next.smoothedCovariance,next.predictedCovariance)),transpose(J))));}
 const known=rows.filter(r=>r.truth),measured=rows.filter(r=>r.nis!==null),accepted=rows.filter(r=>r.status==='accepted');
 const metrics={accepted:accepted.length,gated:rows.filter(r=>r.status==='gated').length,missing:rows.filter(r=>r.status==='missing').length,meanNis:measured.length?measured.reduce((s,r)=>s+r.nis,0)/measured.length:null,truthCount:known.length};
 for(const method of ['filtered','smoothed'])metrics[method]={positionRmse:known.length?Math.sqrt(known.reduce((s,r)=>s+(r[method][0]-r.truth[0])**2,0)/known.length):null,velocityRmse:known.length?Math.sqrt(known.reduce((s,r)=>s+(r[method][1]-r.truth[1])**2,0)/known.length):null,positionCovered:known.filter(r=>Math.abs(r[method][0]-r.truth[0])<=1.96*Math.sqrt(r[method+'Covariance'][0])).length};
 return {study,rows,metrics};
}
export function example(){
 let seed=73;const uniform=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return ((seed>>>0)+.5)/4294967296;},normal=()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());
 let position=0,velocity=1;const observations=[];
 for(let i=0;i<100;i++){if(i){const a=normal(),b=normal();position+=velocity+Math.sqrt(.04/3)*a;velocity+=Math.sqrt(.03)*a+.1*b;}let z=position+2*normal();if(i===40)z+=30;if(i===70)z-=25;if([10,11,55,56].includes(i))z=null;observations.push({t:i,z,truth:[position,velocity]});}
 return {options:{q:.04,r:4,gate:9,position:0,velocity:1,positionVariance:25,velocityVariance:4},observations};
}
