import React from 'react';
export function Checkbox({label,className='',...rest}){
  return <label className={'sb-check '+className}><input type="checkbox" {...rest}/><span className="sb-check__box"></span>{label&&<span>{label}</span>}</label>;
}