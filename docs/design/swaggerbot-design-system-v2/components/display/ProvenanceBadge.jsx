import React from 'react';
const TIER={Official:['accent',true,''],Endorsed:['neutral',false,''],Mirror:['outline',false,''],Community:['outline',false,'sb-badge--dashed']};
export function ProvenanceBadge({provenance='Official',label=true,className=''}){
  const [tone,dot,extra]=TIER[provenance]||TIER.Community;
  return <span className={['sb-badge','sb-badge--'+tone,dot&&'sb-badge--dot',extra,className].filter(Boolean).join(' ')}>{label&&<span style={{position:'absolute',width:1,height:1,overflow:'hidden',clip:'rect(0 0 0 0)',whiteSpace:'nowrap'}}>Provenance: </span>}{provenance}</span>;
}
