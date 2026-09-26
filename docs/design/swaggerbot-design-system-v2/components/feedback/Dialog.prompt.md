Dialog — modal for confirmations and short forms; 24px radius, navy-ink scrim.
```jsx
<Dialog title="Delete spec?" onClose={close} actions={<><Button variant="secondary">Cancel</Button><Button variant="danger">Delete</Button></>}>This can't be undone.</Dialog>
```