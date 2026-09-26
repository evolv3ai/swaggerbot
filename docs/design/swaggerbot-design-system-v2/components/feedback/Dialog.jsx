import React from 'react';
export function Dialog({open=true,title,children,actions,onClose,inline=false}){
  if(!open) return null;
  return <div className={'sb-dialog-backdrop'+(inline?' sb-dialog-backdrop--inline':'')} onClick={e=>{if(e.target===e.currentTarget&&onClose)onClose();}}>
    <div className="sb-dialog" role="dialog" aria-modal="true">
      {title&&<h2 className="sb-dialog__title">{title}</h2>}
      <div className="sb-dialog__body">{children}</div>
      {actions&&<div className="sb-dialog__actions">{actions}</div>}
    </div>
  </div>;
}