import React from 'react';
export function Badge({tone='accent',dot=false,children,className=''}){
  return <span className={['sb-badge','sb-badge--'+tone,dot&&'sb-badge--dot',className].filter(Boolean).join(' ')}>{children}</span>;
}