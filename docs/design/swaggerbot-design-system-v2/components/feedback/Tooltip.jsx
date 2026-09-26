import React from 'react';
export function Tooltip({content,open=false,children}){
  return <span className="sb-tooltip-wrap">{children}<span role="tooltip" className={'sb-tooltip'+(open?' sb-tooltip--open':'')}>{content}</span></span>;
}