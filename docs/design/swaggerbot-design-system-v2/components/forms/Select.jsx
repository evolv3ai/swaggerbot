import React from 'react';
export function Select({label,hint,options=[],id,className='',...rest}){
  const fid=id||(label?'sel-'+String(label).toLowerCase().replace(/\W+/g,'-'):undefined);
  return <div className="sb-field">
    {label&&<label className="sb-label" htmlFor={fid}>{label}</label>}
    <select id={fid} className={'sb-input sb-select '+className} {...rest}>
      {options.map(o=>{const v=typeof o==='string'?{value:o,label:o}:o;return <option key={v.value} value={v.value}>{v.label}</option>;})}
    </select>
    {hint&&<span className="sb-hint">{hint}</span>}
  </div>;
}