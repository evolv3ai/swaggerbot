window.SB_DATA={
stats:{vendors:21,apis:21,specs:27},
apis:[
{key:'plaid',name:'The Plaid API',vendor:'plaid.com',provenance:'Official',verified:'24 Sept 2026',spec:'a41f09c2d7e3',answer:'resolved',version:'2020-09-14',ms:1.4},
{key:'jira',name:'The Jira Cloud platform REST API',vendor:'atlassian.com',provenance:'Official',verified:'24 Sept 2026',spec:'6ecc461bb85e',answer:'resolved',version:'1001.0.0',ms:1.7},
{key:'stripe',name:'The Stripe API',vendor:'stripe.com',provenance:'Official',verified:'23 Sept 2026',spec:'9b2e71f0aa14',answer:'resolved',version:'2026-08-27',ms:1.2},
{key:'github',name:'GitHub REST API',vendor:'github.com',provenance:'Official',verified:'22 Sept 2026',spec:'c07d3e5b9f21',answer:'resolved',version:'1.1.4',ms:2.1},
{key:'twilio',name:'Twilio Messaging',vendor:'twilio.com',provenance:'Community',verified:'21 Sept 2026',spec:'5de8a0b4c613',answer:'unconfirmed',version:'1.0.0',ms:1.9},
{key:'mercury',name:'Mercury',vendor:'—',provenance:'—',verified:'—',spec:'—',answer:'ambiguous',ms:2.4,note:'Two APIs match this name: Mercury (banking, mercury.com) and Mercury Parser. Add the Vendor to pick one.'},
{key:'slack',name:'Slack Web API',vendor:'slack.com',provenance:'Official',verified:'20 Sept 2026',spec:'e2c9f47d01ab',answer:'resolved',version:'1.7.0',ms:1.5},
{key:'notion',name:'Notion API',vendor:'notion.so',provenance:'Community',verified:'19 Sept 2026',spec:'71ab3c98ef02',answer:'unconfirmed',version:'1.0.0',ms:1.8}
],
steps:[
['Index','Specs verified before. Answered in milliseconds, no key needed.'],
['APIs.guru','The public directory of API descriptions.'],
['Developer Portal','Found with a web search.'],
['Vendor domain','Known paths, apis.json, then a shallow crawl.'],
['GitHub',"The Vendor's organisation first, then the rest."],
['Judged','Is it the API you meant, and its Spec? Not sure means we say so.']
]};