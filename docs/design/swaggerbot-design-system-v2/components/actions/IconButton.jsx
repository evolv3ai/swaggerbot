import React from 'react';
export function IconButton({variant='ghost',size='md',label,children,className='',...rest}){
  return <button aria-label={label} title={label} className={['sb-btn','sb-btn--icon','sb-btn--'+variant,'sb-btn--'+size,className].join(' ')} {...rest}>{children}</button>;
}