import React from 'react';
export function Radio({label,className='',...rest}){
  return <label className={'sb-check sb-check--radio '+className}><input type="radio" {...rest}/><span className="sb-check__box"></span>{label&&<span>{label}</span>}</label>;
}