import React from 'react';
export function Tabs({tabs=[],value,defaultValue,onChange,variant='line',className=''}){
  const [inner,setInner]=React.useState(defaultValue??(tabs[0]&&(tabs[0].value??tabs[0])));
  const cur=value??inner;
  return <div role="tablist" className={['sb-tabs',variant==='pill'&&'sb-tabs--pill',className].filter(Boolean).join(' ')}>
    {tabs.map(t=>{const v=typeof t==='string'?{value:t,label:t}:t;return <button key={v.value} role="tab" className="sb-tab" aria-selected={cur===v.value} onClick={()=>{setInner(v.value);onChange&&onChange(v.value);}}>{v.label}</button>;})}
  </div>;
}