const NS=window.Nocturne_noctur||{};
const {Button,IconButton,Input,Select,Checkbox,Card,Badge,Tag,Tabs,Toast,Tooltip}=NS;
const ANS={resolved:['success','Resolved'],unconfirmed:['warning','Unconfirmed'],ambiguous:['accent','Ambiguous'],'no-spec':['neutral','No Spec'],unknown:['neutral','Unknown']};
const AnswerBadge=NS.AnswerBadge||(({answer})=>{const [t,l]=ANS[answer];return <span className={'sb-badge sb-badge--dot sb-badge--'+t}>{l}</span>;});
const Svg=({d,s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
const ISearch=()=><Svg d={<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>}/>;
const ICopy=()=><Svg d={<><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>}/>;
const IArrow=()=><Svg d={<path d="M5 12h14M13 6l6 6-6 6"/>}/>;
const IBack=()=><Svg d={<path d="M19 12H5M11 6l-6 6 6 6"/>}/>;
const ICheck=()=><Svg s={16} d={<path d="M5 12l5 5L20 7"/>}/>;
const wrap={maxWidth:1120,margin:'0 auto',padding:'0 32px'};
const mono={fontFamily:'var(--font-mono)',fontSize:13};
const muted={color:'var(--text-muted)'};

function Header({page,go,theme,setTheme}){
  const links=[['search','Search'],['vendors','Vendors'],['docs','Docs']];
  return <header style={{borderBottom:'1px solid var(--border)',background:'var(--bg)',position:'sticky',top:0,zIndex:10}}>
    <div style={{...wrap,display:'flex',alignItems:'center',gap:32,height:68}}>
      <a href="#" onClick={e=>{e.preventDefault();go('search');}} style={{display:'flex',alignItems:'center',gap:10,textDecoration:'none',color:'var(--text)'}}>
        <img src="../../assets/mark.png" alt="" style={{height:34}}/>
        <span style={{font:'800 21px var(--font-display)',letterSpacing:'-.02em'}}>SwaggerBot</span>
      </a>
      <nav style={{display:'flex',gap:4,marginRight:'auto'}}>
        {links.map(([k,l])=><a key={k} href="#" onClick={e=>{e.preventDefault();go(k);}} style={{font:'600 14px var(--font-display)',padding:'8px 14px',borderRadius:8,textDecoration:'none',color:(page===k||(k==='search'&&page==='lookup'))?'var(--accent-text)':'var(--text-muted)',background:(page===k||(k==='search'&&page==='lookup'))?'var(--accent-soft)':'transparent'}}>{l}</a>)}
      </nav>
      <button className="sb-btn sb-btn--ghost sb-btn--sm" onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?'Light':'Dark'}</button>
      <Button variant="secondary" size="sm" onClick={()=>go('docs')}>Get an API key</Button>
    </div>
  </header>;
}

function SearchBox({onLookup,initial=''}){
  const [q,setQ]=React.useState(initial);
  const submit=e=>{e.preventDefault();if(q.trim())onLookup(q.trim());};
  return <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:14}}>
    <div style={{display:'flex',gap:10,padding:8,background:'var(--surface)',border:'2px solid var(--accent)',borderRadius:16,boxShadow:'var(--shadow-md)'}}>
      <span style={{display:'grid',placeItems:'center',paddingLeft:10,color:'var(--accent)'}}><ISearch/></span>
      <input aria-label="The name of an API" value={q} onChange={e=>setQ(e.target.value)} placeholder="The name of an API" style={{flex:1,border:0,outline:0,background:'transparent',font:'500 18px var(--font-body)',color:'var(--text)',minWidth:0}}/>
      <Button size="lg" type="submit">Develop</Button>
    </div>
    <div style={{display:'flex',gap:20,alignItems:'center',flexWrap:'wrap'}}>
      <span className="sb-eyebrow" style={{color:'var(--text-faint)'}}>Options</span>
      <div style={{width:200}}><select className="sb-input sb-select" style={{height:34,fontSize:13}} aria-label="API Version"><option>API Version (optional)</option><option>Latest</option></select></div>
      <Checkbox label="Include Community Specs"/>
      <span style={{...muted,fontSize:13}}>Try: <a href="#" onClick={e=>{e.preventDefault();onLookup('plaid');}}>Plaid</a>, <a href="#" onClick={e=>{e.preventDefault();onLookup('mercury');}}>Mercury</a>, <a href="#" onClick={e=>{e.preventDefault();onLookup('acme');}}>Acme</a></span>
    </div>
  </form>;
}

function Stat({n,l}){return <div><div style={{font:'800 32px var(--font-display)',letterSpacing:'-.02em'}}>{n}</div><div className="sb-eyebrow" style={{color:'var(--text-muted)'}}>{l}</div></div>;}

function ResultCard({a,onOpen}){
  return <div className={'sb-card'+(onOpen?' sb-card--interactive':'')} onClick={onOpen} style={{gap:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
      <AnswerBadge answer={a.answer}/>
      <span style={{...mono,...muted}}>Answered in {a.ms}ms</span>
    </div>
    <h3 className="sb-card__title" style={{fontSize:20}}>{a.name}</h3>
    <dl style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:12,margin:0}}>
      {[['Vendor',a.vendor],['Provenance',a.provenance],['Verified',a.verified],['Spec',a.spec]].map(([k,v])=><div key={k}><dt className="sb-eyebrow" style={{color:'var(--text-faint)',fontSize:10}}>{k}</dt><dd style={{margin:'4px 0 0',...(k==='Spec'?mono:{fontSize:14,fontWeight:500})}}>{v}</dd></div>)}
    </dl>
  </div>;
}

function SearchScreen({onLookup}){
  const D=window.SB_DATA;
  return <main>
    <section style={{...wrap,paddingTop:80,paddingBottom:64,display:'grid',gridTemplateColumns:'minmax(0,1.6fr) minmax(0,1fr)',gap:56,alignItems:'start'}}>
      <div>
        <div className="sb-tagline" style={{fontSize:13,marginBottom:20}}>Better than specs</div>
        <h1 style={{fontSize:72,marginBottom:20}}>No fake Specs.</h1>
        <p style={{fontSize:19,...muted,maxWidth:560,marginBottom:36}}>Name an API. SwaggerBot hands you its OpenAPI Spec, where it came from and how sure it is, or tells you straight why there isn't one.</p>
        <SearchBox onLookup={onLookup}/>
      </div>
      <aside style={{display:'flex',flexDirection:'column',gap:16}}>
        <div className="sb-card sb-card--interactive" onClick={()=>onLookup('plaid')}>
          <div className="sb-eyebrow">Last verified</div>
          <div className="sb-card__title">The Plaid API</div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}><Badge tone="success">Official</Badge><span style={{fontSize:13,...muted}}>24 Sept 2026</span></div>
        </div>
        <div className="sb-card" style={{background:'var(--bg-subtle)'}}>
          <div className="sb-eyebrow" style={{color:'var(--text-muted)'}}>In the Index</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}><Stat n={D.stats.vendors} l="Vendors"/><Stat n={D.stats.apis} l="APIs"/><Stat n={D.stats.specs} l="Specs"/></div>
          <div style={{display:'flex',alignItems:'center',gap:8,fontSize:13,...muted}}><span style={{width:8,height:8,borderRadius:'50%',background:'var(--success)'}}></span>Service operational</div>
        </div>
      </aside>
    </section>
    <section style={{background:'var(--bg-subtle)',borderTop:'1px solid var(--border)',borderBottom:'1px solid var(--border)'}}>
      <div style={{...wrap,paddingTop:40,paddingBottom:40}}>
        <p style={{fontStyle:'italic',...muted,fontSize:14,marginBottom:16}}>Every answer is one of five, from sure to not found</p>
        <ol style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,listStyle:'none',padding:0,margin:0}}>
          {[['resolved','We found it and we are sure.'],['unconfirmed','Found, but not proven official.'],['ambiguous','More than one API has that name.'],['no-spec','The API exists. No Spec does.'],['unknown',"We couldn't identify the API."]].map(([a,t],i)=><li key={a} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:16,display:'flex',flexDirection:'column',gap:10}}>
            <span style={{...mono,color:'var(--text-faint)'}}>0{i+1}</span><AnswerBadge answer={a}/><span style={{fontSize:13,...muted}}>{t}</span></li>)}
        </ol>
      </div>
    </section>
    <section style={{...wrap,paddingTop:64,paddingBottom:64}}>
      <h2 style={{fontSize:28}}>Replay: real answers from the Index</h2>
      <p style={{...muted,fontSize:14,marginBottom:24}}>2 of the 4 APIs the Index verified most recently, as a default Lookup answers them.</p>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        {D.apis.slice(0,2).map(a=><ResultCard key={a.key} a={a} onOpen={()=>onLookup(a.key)}/>)}
      </div>
    </section>
    <section style={{...wrap,paddingBottom:80}}>
      <h2 style={{fontSize:28}}>How a Spec is developed</h2>
      <p style={{...muted,fontSize:14,marginBottom:24}}>From the Index, anyone. Past it, Discovery, with an API key.</p>
      <ol style={{listStyle:'none',padding:0,margin:0,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>
        {D.steps.map(([t,d],i)=><li key={t} style={{display:'flex',gap:14,padding:20,border:'1px solid var(--border)',borderRadius:16}}>
          <span style={{font:'800 15px var(--font-mono)',color:'var(--accent)'}}>{String(i+1).padStart(2,'0')}</span>
          <div><div style={{font:'700 16px var(--font-display)',marginBottom:4}}>{t}</div><div style={{fontSize:13,...muted}}>{d}</div></div></li>)}
      </ol>
      <div style={{marginTop:32,padding:'20px 24px',borderRadius:16,background:'var(--sb-ink)',color:'#fff',display:'flex',gap:16,alignItems:'center',flexWrap:'wrap'}}>
        <span style={{flex:1,minWidth:260}}><b style={{fontFamily:'var(--font-display)'}}>Benchmark, 23 Sept 2026:</b> <span style={{color:'var(--gray-300)'}}>0 wrong of 20 Resolved answers, on 2 runs over the 40-name set.</span></span>
        <a href="#" style={{color:'var(--blue-300)',fontWeight:600,fontSize:14}}>How it was measured</a>
      </div>
    </section>
  </main>;
}

function LookupScreen({query,go,onLookup}){
  const D=window.SB_DATA;
  const q=query.toLowerCase();
  const a=D.apis.find(x=>x.key===q||x.name.toLowerCase().includes(q))||{key:q,name:query,answer:'no-spec',ms:3.2,note:'We found the API, but its Vendor publishes no OpenAPI or Swagger Spec. We looked in all six places.'};
  const [copied,setCopied]=React.useState(false);
  const found=a.answer==='resolved'||a.answer==='unconfirmed';
  const trail=D.steps.map(([t],i)=>({t,state:a.answer==='resolved'?(i===0?'answered':i===5?'passed':'skip'):a.answer==='unconfirmed'?(i<2?'checked':i===1?'answered':i===5?'unsure':'checked'):'checked'}));
  return <main style={{...wrap,paddingTop:40,paddingBottom:80}}>
    <button className="sb-btn sb-btn--ghost sb-btn--sm" onClick={()=>go('search')} style={{marginBottom:24,paddingLeft:6}}><IBack/>New Lookup</button>
    <div style={{maxWidth:760,marginBottom:40}}><SearchBox onLookup={onLookup} initial={query}/></div>
    <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.6fr) minmax(0,1fr)',gap:24,alignItems:'start'}}>
      <div className="sb-card" style={{padding:32,gap:20,borderWidth:2,borderColor:found?'var(--accent)':'var(--border)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><AnswerBadge answer={a.answer}/><span style={{...mono,...muted}}>Answered in {a.ms}ms</span></div>
        <h1 style={{fontSize:36,margin:0}}>{a.name}</h1>
        {a.note&&<p style={{...muted,margin:0}}>{a.note}</p>}
        {found&&<>
          <dl style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,margin:0,padding:'20px 0',borderTop:'1px solid var(--border)',borderBottom:'1px solid var(--border)'}}>
            {[['Vendor',a.vendor],['Provenance',a.provenance],['Verified',a.verified],['Version',a.version],['Spec',a.spec],['Format','OpenAPI 3.0']].map(([k,v])=><div key={k}><dt className="sb-eyebrow" style={{color:'var(--text-faint)',fontSize:10}}>{k}</dt><dd style={{margin:'4px 0 0',...(k==='Spec'||k==='Version'?mono:{fontWeight:500})}}>{v}</dd></div>)}
          </dl>
          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
            <div style={{flex:1,minWidth:240,...mono,padding:'10px 14px',background:'var(--surface-sunken)',borderRadius:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>https://swaggerbot.dev/spec/{a.spec}.json</div>
            <Button onClick={()=>{setCopied(true);setTimeout(()=>setCopied(false),1600);}} iconLeft={copied?<ICheck/>:<ICopy/>}>{copied?'Copied':'Copy Spec URL'}</Button>
            <Button variant="secondary">Download</Button>
          </div>
          {a.answer==='unconfirmed'&&<p style={{fontSize:13,color:'var(--warning-text)',margin:0}}>This Spec is from the Community. We couldn't prove the Vendor publishes it.</p>}
        </>}
        {a.answer==='ambiguous'&&<div style={{display:'flex',gap:8}}><Tag>mercury.com</Tag><Tag>postlight/mercury-parser</Tag></div>}
      </div>
      <aside className="sb-card" style={{background:'var(--bg-subtle)'}}>
        <div className="sb-eyebrow" style={{color:'var(--text-muted)'}}>How it was developed</div>
        <ol style={{listStyle:'none',padding:0,margin:0,display:'flex',flexDirection:'column',gap:12}}>
          {trail.map((s,i)=>{const on=s.state==='answered'||s.state==='passed';return <li key={s.t} style={{display:'flex',alignItems:'center',gap:12,fontSize:14,opacity:s.state==='skip'?.5:1}}>
            <span style={{width:26,height:26,borderRadius:'50%',display:'grid',placeItems:'center',flex:'none',background:on?'var(--accent)':'var(--surface)',color:on?'#fff':'var(--text-faint)',border:on?'0':'2px solid var(--border-strong)',...mono,fontSize:11,fontWeight:700}}>{on?<ICheck/>:String(i+1).padStart(2,'0')}</span>
            <span style={{flex:1,fontWeight:500}}>{s.t}</span>
            <span style={{...mono,fontSize:11,color:'var(--text-faint)'}}>{s.state==='answered'?'Answered here':s.state==='passed'?'Passed':s.state==='skip'?'Not needed':s.state==='unsure'?'Not sure':'Checked'}</span></li>;})}
        </ol>
      </aside>
    </div>
  </main>;
}

function VendorsScreen({onLookup}){
  const D=window.SB_DATA;
  const [f,setF]=React.useState('All');
  const rows=D.apis.filter(a=>a.vendor!=='—'&&(f==='All'||a.provenance===f));
  return <main style={{...wrap,paddingTop:56,paddingBottom:80}}>
    <div className="sb-eyebrow" style={{marginBottom:12}}>The Index</div>
    <h1 style={{fontSize:48}}>Vendors</h1>
    <p style={{...muted,marginBottom:28}}>{D.stats.vendors} Vendors, {D.stats.apis} APIs, {D.stats.specs} Specs. Every one verified before it got here.</p>
    <div style={{marginBottom:20}}><Tabs variant="pill" tabs={['All','Official','Community']} value={f} onChange={setF}/></div>
    <div style={{border:'1px solid var(--border)',borderRadius:16,overflow:'hidden'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
        <thead><tr style={{background:'var(--bg-subtle)'}}>{['API','Vendor','Provenance','Answer','Verified','Spec'].map(h=><th key={h} className="sb-eyebrow" style={{textAlign:'left',padding:'12px 16px',color:'var(--text-muted)',fontSize:10}}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(a=><tr key={a.key} onClick={()=>onLookup(a.key)} style={{borderTop:'1px solid var(--border)',cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background='var(--accent-soft)'} onMouseLeave={e=>e.currentTarget.style.background=''}>
          <td style={{padding:'14px 16px',fontWeight:600}}>{a.name}</td><td style={{padding:'14px 16px',...muted}}>{a.vendor}</td>
          <td style={{padding:'14px 16px'}}><Badge tone={a.provenance==='Official'?'accent':'neutral'}>{a.provenance}</Badge></td>
          <td style={{padding:'14px 16px'}}><AnswerBadge answer={a.answer}/></td><td style={{padding:'14px 16px',...muted}}>{a.verified}</td><td style={{padding:'14px 16px',...mono}}>{a.spec}</td></tr>)}</tbody>
      </table>
    </div>
  </main>;
}

function DocsScreen(){
  const [t,setT]=React.useState('MCP');
  const code=t==='MCP'?'{\n  "mcpServers": {\n    "swaggerbot": {\n      "url": "https://swaggerbot.dev/mcp",\n      "headers": { "Authorization": "Bearer sb_live_…" }\n    }\n  }\n}':'curl "https://swaggerbot.dev/api/lookup?name=plaid" \\\n  -H "Authorization: Bearer sb_live_…"\n\n{\n  "answer": "resolved",\n  "api": "The Plaid API",\n  "provenance": "official",\n  "spec": "a41f09c2d7e3"\n}';
  return <main style={{...wrap,paddingTop:56,paddingBottom:80,display:'grid',gridTemplateColumns:'220px minmax(0,1fr)',gap:48}}>
    <nav style={{display:'flex',flexDirection:'column',gap:4,fontSize:14}}>
      {['Quick start','Lookup','The five answers','Provenance','Discovery','API keys','Rate limits'].map((l,i)=><a key={l} href="#" onClick={e=>e.preventDefault()} style={{padding:'8px 12px',borderRadius:8,textDecoration:'none',color:i===0?'var(--accent-text)':'var(--text-muted)',background:i===0?'var(--accent-soft)':'',fontWeight:i===0?600:500}}>{l}</a>)}
    </nav>
    <article style={{maxWidth:720}}>
      <div className="sb-eyebrow" style={{marginBottom:12}}>Docs</div>
      <h1 style={{fontSize:44}}>Quick start</h1>
      <p style={{fontSize:17,...muted}}>For agents and programs: the same answers over MCP and the HTTP API. Lookups against the Index need no key. Discovery needs one.</p>
      <div style={{margin:'28px 0 12px'}}><Tabs tabs={['MCP','HTTP API']} value={t} onChange={setT}/></div>
      <pre style={{margin:0,padding:24,background:'var(--sb-ink)',color:'#E5EAF2',borderRadius:16,font:'13px/1.7 var(--font-mono)',overflow:'auto'}}>{code}</pre>
      <h2 style={{fontSize:24,marginTop:40}}>Reading an answer</h2>
      <p style={muted}>Every Lookup returns exactly one of five answers. Treat anything but Resolved as a reason to check.</p>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{['resolved','unconfirmed','ambiguous','no-spec','unknown'].map(a=><AnswerBadge key={a} answer={a}/>)}</div>
    </article>
  </main>;
}

function Footer(){
  return <footer style={{borderTop:'1px solid var(--border)'}}>
    <div style={{...wrap,display:'flex',alignItems:'center',gap:16,height:88,fontSize:13,...muted}}>
      <img src="../../assets/mark.png" alt="" style={{height:24}}/><span>SwaggerBot · swaggerbot.dev</span>
      <span className="sb-tagline" style={{fontSize:10,marginLeft:'auto'}}>Better than specs</span>
      <a href="#" style={{marginLeft:24}}>Source on GitHub</a>
    </div>
  </footer>;
}

function App(){
  const [s,setS]=React.useState(()=>{try{return JSON.parse(localStorage.getItem('sb-kit'))||{page:'search',q:''};}catch(e){return {page:'search',q:''};}});
  const [theme,setTheme]=React.useState(()=>localStorage.getItem('sb-kit-theme')||'light');
  React.useEffect(()=>{localStorage.setItem('sb-kit',JSON.stringify(s));window.scrollTo(0,0);},[s]);
  React.useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('sb-kit-theme',theme);},[theme]);
  const go=p=>setS({page:p,q:s.q});
  const onLookup=q=>setS({page:'lookup',q});
  return <div data-screen-label={s.page}>
    <Header page={s.page} go={go} theme={theme} setTheme={setTheme}/>
    {s.page==='search'&&<SearchScreen onLookup={onLookup}/>}
    {s.page==='lookup'&&<LookupScreen key={s.q} query={s.q} go={go} onLookup={onLookup}/>}
    {s.page==='vendors'&&<VendorsScreen onLookup={onLookup}/>}
    {s.page==='docs'&&<DocsScreen/>}
    <Footer/>
  </div>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);