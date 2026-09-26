import React from 'react';
export function Card({variant='default',interactive=false,eyebrow,title,children,className='',...rest}){
  const cls=['sb-card',variant!=='default'&&'sb-card--'+variant,interactive&&'sb-card--interactive',className].filter(Boolean).join(' ');
  return <div className={cls} {...rest}>
    {eyebrow&&<div className="sb-eyebrow">{eyebrow}</div>}
    {title&&<h3 className="sb-card__title">{title}</h3>}
    {typeof children==='string'?<p className="sb-card__body">{children}</p>:children}
  </div>;
}