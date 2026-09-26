Tabs — switch between views of the same object; `pill` variant doubles as a segmented control.
```jsx
<Tabs tabs={['Overview','Endpoints','Schemas']} onChange={setView}/>
<Tabs variant="pill" tabs={['JSON','YAML']}/>
```