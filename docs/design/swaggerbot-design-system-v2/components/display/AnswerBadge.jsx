import React from 'react';
const MAP={resolved:['success','Resolved','Resolved'],unconfirmed:['warning','Unconfirmed','Unconf.'],ambiguous:['accent','Ambiguous','Ambig.'],'no-spec':['neutral','No Spec','No Spec'],unknown:['outline','Unknown','Unknown']};
export function AnswerBadge({answer='resolved',short=false,className=''}){
  const [tone,full,abbr]=MAP[answer]||MAP.unknown;
  return <span className={['sb-badge','sb-badge--dot','sb-badge--'+tone,className].filter(Boolean).join(' ')}>{short?abbr:full}</span>;
}