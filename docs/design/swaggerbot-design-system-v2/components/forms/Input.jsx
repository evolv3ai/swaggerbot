import React from 'react';
export function Input({label,hint,error,mono=false,multiline=false,id,className='',...rest}){
  const fid=id||(label?'in-'+String(label).toLowerCase().replace(/\W+/g,'-'):undefined);
  const cls=['sb-input',mono&&'sb-input--mono',error&&'sb-input--error',className].filter(Boolean).join(' ');
  const El=multiline?'textarea':'input';
  return <div className="sb-field">
    {label&&<label className="sb-label" htmlFor={fid}>{label}</label>}
    <El id={fid} className={cls} aria-invalid={!!error} {...rest}/>
    {(error||hint)&&<span className={'sb-hint'+(error?' sb-hint--error':'')}>{error||hint}</span>}
  </div>;
}