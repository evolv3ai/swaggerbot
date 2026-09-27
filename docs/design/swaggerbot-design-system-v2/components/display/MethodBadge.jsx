import React from 'react';
export function MethodBadge({method='GET',size='sm',className=''}){
  return <span className={['sb-method','sb-method--'+method.toLowerCase(),size==='md'&&'sb-method--md',className].filter(Boolean).join(' ')}>{method}</span>;
}
