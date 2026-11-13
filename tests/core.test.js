import test from'node:test';import assert from'node:assert/strict';import{estimate,example,normalize}from'../core.js';
const close=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t*Math.max(1,Math.abs(a),Math.abs(b)),`${a} != ${b}`);
// Independent batch Gaussian posterior: assemble the full trajectory's precision
// from prior, transition residuals, and measurements; invert by dense elimination.
function batch(study){const n=study.observations.length*2,o=study.options,A=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0);A[0][0]=1/o.positionVariance;A[1][1]=1/o.velocityVariance;b[0]=o.position/o.positionVariance;b[1]=o.velocity/o.velocityVariance;
 for(let k=1;k<n/2;k++){const d=study.observations[k].t-study.observations[k-1].t,q=o.q,W=[[12/(q*d**3),-6/(q*d**2)],[-6/(q*d**2),4/(q*d)]],B=[[-1,-d,1,0],[0,-1,0,1]],start=2*k-2;for(let i=0;i<4;i++)for(let j=0;j<4;j++)for(let u=0;u<2;u++)for(let v=0;v<2;v++)A[start+i][start+j]+=B[u][i]*W[u][v]*B[v][j];}
 study.observations.forEach((r,i)=>{if(r.z!==null){A[2*i][2*i]+=1/o.r;b[2*i]+=r.z/o.r;}});
 const M=A.map((r,i)=>[...r,...Array.from({length:n},(_,j)=>Number(i===j)),b[i]]);
 for(let j=0;j<n;j++){let pivot=j;for(let i=j+1;i<n;i++)if(Math.abs(M[i][j])>Math.abs(M[pivot][j]))pivot=i;[M[j],M[pivot]]=[M[pivot],M[j]];const scale=M[j][j];M[j]=M[j].map(x=>x/scale);for(let i=0;i<n;i++)if(i!==j){const factor=M[i][j];M[i]=M[i].map((x,k)=>x-factor*M[j][k]);}}
 return Array.from({length:n/2},(_,i)=>({x:[M[2*i].at(-1),M[2*i+1].at(-1)],p:[M[2*i][n+2*i],M[2*i][n+2*i+1],M[2*i+1][n+2*i],M[2*i+1][n+2*i+1]]}));}
test('filter and smoother match dense batch Gaussian conditioning on 40 irregular studies',()=>{
 for(let k=0;k<40;k++){const s={options:{...example().options,q:.1+k/20,r:.5+k/10,gate:0,position:2,velocity:-.3},observations:Array.from({length:6},(_,i)=>({t:i+i*i*.07,z:(i+k)%4===0?null:Math.sin(i+k)*3}))},r=estimate(s),all=batch(s);
  for(let i=0;i<6;i++){r.rows[i].smoothed.forEach((x,j)=>close(x,all[i].x[j]));r.rows[i].smoothedCovariance.forEach((x,j)=>close(x,all[i].p[j]));const prefix=batch({...s,observations:s.observations.slice(0,i+1)}).at(-1);r.rows[i].filtered.forEach((x,j)=>close(x,prefix.x[j]));r.rows[i].filteredCovariance.forEach((x,j)=>close(x,prefix.p[j]));}
 }
});
test('missing measurements propagate without update and future data improve uncertainty',()=>{
 const s=example();s.options.gate=0;const r=estimate(s);for(const row of r.rows){if(row.z===null){assert.deepEqual(row.predicted,row.filtered);assert.deepEqual(row.predictedCovariance,row.filteredCovariance);assert.equal(row.nis,null);}assert.ok(row.smoothedCovariance[0]<=row.filteredCovariance[0]+1e-8);assert.ok(row.smoothedCovariance[3]<=row.filteredCovariance[3]+1e-8);}assert.deepEqual(r.rows.at(-1).filtered,r.rows.at(-1).smoothed);
});
test('gated observations are excluded consistently from filtering and smoothing',()=>{
 const s=example(),r=estimate(s),excluded=structuredClone(s);excluded.options.gate=0;r.rows.forEach((row,i)=>{if(row.status==='gated')excluded.observations[i].z=null;});const reference=estimate(excluded);for(let i=0;i<r.rows.length;i++){assert.deepEqual(r.rows[i].filtered,reference.rows[i].filtered);assert.deepEqual(r.rows[i].smoothed,reference.rows[i].smoothed);}assert.equal(r.rows[40].status,'gated');assert.equal(r.rows[70].status,'gated');
});
test('all-missing data retain the model prediction and smoothing adds no information',()=>{
 const s=example();s.observations=s.observations.slice(0,8).map(r=>({t:r.t,z:null}));const r=estimate(s);for(const row of r.rows){close(row.filtered[0],row.t);assert.deepEqual(row.filtered,row.smoothed);assert.deepEqual(row.filteredCovariance,row.smoothedCovariance);}assert.equal(r.metrics.truthCount,0);assert.equal(r.metrics.filtered.positionRmse,null);assert.equal(r.metrics.meanNis,null);
});
test('covariances remain symmetric positive definite across bounded extreme settings',()=>{
 for(const q of [.001,100])for(const variance of [.001,10000]){const s=example();Object.assign(s.options,{q,r:variance,positionVariance:variance,velocityVariance:variance,gate:0});s.observations=s.observations.map((r,i)=>({...r,t:i*.1}));for(const row of estimate(s).rows)for(const p of [row.filteredCovariance,row.smoothedCovariance]){assert.equal(p[1],p[2]);assert.ok(p[0]>0&&p[3]-p[1]*p[2]/p[0]>0);}}
});
test('reject malformed observations and settings without mutating valid studies',()=>{
 const s=example(),saved=JSON.stringify(s);estimate(s);assert.equal(JSON.stringify(s),saved);for(const q of [0,NaN,Infinity,true,101])assert.throws(()=>normalize({...s,options:{...s.options,q}}));for(const obs of [[{t:0,z:1},{t:0,z:2}],[{t:0,z:1},{t:20,z:2}],[{t:0,z:null},{t:1,z:'2'}]])assert.throws(()=>normalize({...s,observations:obs}));
});
