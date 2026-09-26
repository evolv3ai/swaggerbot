import React from 'react';
export function Toast({tone='info',title,children,onClose}){
  return <div className={'sb-toast sb-toast--'+tone} role="status">
    <span className="sb-toast__dot"></span>
    <div>{title&&<p className="sb-toast__title">{title}</p>}{children&&<p className="sb-toast__msg">{children}</p>}</div>
    {onClose&&<button className="sb-toast__close" aria-label="Dismiss" onClick={onClose}>×</button>}
  </div>;
}