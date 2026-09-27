import React from 'react';
export function Tabs({tabs=[],value,defaultValue,onChange,variant='line',className=''}){
  const [inner,setInner]=React.useState(defaultValue??(tabs[0]&&(tabs[0].value??tabs[0])));
  const cur=value??inner;
  const items=tabs.map(t=>typeof t==='string'?{value:t,label:t}:t);
  const refs=React.useRef([]);
  const pick=i=>{const v=items[i].value;setInner(v);onChange&&onChange(v);};
  // WAI-ARIA tabs: one tab in the Tab order; arrows, Home and End move and select.
  const onKeyDown=e=>{const i=items.findIndex(v=>v.value===cur),n=items.length;
    const to={ArrowRight:(i+1)%n,ArrowLeft:(i-1+n)%n,Home:0,End:n-1}[e.key];
    if(to===undefined)return;e.preventDefault();pick(to);refs.current[to]&&refs.current[to].focus();};
  return <div role="tablist" className={['sb-tabs',variant==='pill'&&'sb-tabs--pill',className].filter(Boolean).join(' ')}>
    {items.map((v,i)=><button key={v.value} ref={el=>{refs.current[i]=el;}} role="tab" className="sb-tab" aria-selected={cur===v.value} tabIndex={cur===v.value?0:-1} onClick={()=>pick(i)} onKeyDown={onKeyDown}>{v.label}</button>)}
  </div>;
}