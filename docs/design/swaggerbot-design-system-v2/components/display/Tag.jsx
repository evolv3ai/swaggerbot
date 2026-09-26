import React from 'react';
export function Tag({selected=false,onRemove,children,className='',...rest}){
  return <span className={['sb-tag',selected&&'sb-tag--selected',className].filter(Boolean).join(' ')} {...rest}>
    {children}{onRemove&&<button className="sb-tag__x" aria-label="Remove" onClick={onRemove}>×</button>}
  </span>;
}