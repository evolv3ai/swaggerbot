Tabs — switch between views of the same object; `pill` variant doubles as a segmented control.
```jsx
<Tabs tabs={['Overview','Endpoints','Schemas']} onChange={setView}/>
<Tabs variant="pill" tabs={['Published Form','Normalized Form']}/>
```
Keyboard: follow the WAI-ARIA tabs pattern (arrow keys, Home, End). In High Contrast both variants keep a visible marker (components.css).