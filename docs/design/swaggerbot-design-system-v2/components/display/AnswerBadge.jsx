import React from 'react';
const MAP={resolved:['success','Resolved','Resolved'],unconfirmed:['warning','Unconfirmed','Unconf.'],ambiguous:['accent','Ambiguous','Ambig.'],'no-spec':['neutral','No Spec','No Spec'],unknown:['unknown','Unknown','Unknown']};
export function AnswerBadge({answer='resolved',short=false,className=''}){
  const [tone,full,abbr]=MAP[answer]||MAP.unknown;
  const style=tone==='unknown'?{background:'transparent',border:'1.5px solid var(--border-strong)',color:'var(--text-muted)'}:undefined;
  return <span className={['sb-badge','sb-badge--dot',tone!=='unknown'&&'sb-badge--'+tone,className].filter(Boolean).join(' ')} style={style}>{short?abbr:full}</span>;
}