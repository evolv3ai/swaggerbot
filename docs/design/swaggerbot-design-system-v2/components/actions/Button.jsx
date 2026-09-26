import React from 'react';
export function Button({variant='primary',size='md',block=false,iconLeft,iconRight,className='',children,...rest}){
  const cls=['sb-btn','sb-btn--'+variant,'sb-btn--'+size,block&&'sb-btn--block',className].filter(Boolean).join(' ');
  return <button className={cls} {...rest}>{iconLeft}{children}{iconRight}</button>;
}