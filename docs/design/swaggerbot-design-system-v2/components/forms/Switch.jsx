import React from 'react';
export function Switch({label,className='',...rest}){
  return <label className={'sb-switch '+className}><input type="checkbox" role="switch" {...rest}/><span className="sb-switch__track"></span>{label&&<span>{label}</span>}</label>;
}