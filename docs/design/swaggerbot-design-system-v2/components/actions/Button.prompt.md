Button — the main action control; use `primary` (blue) for the one key action per view, `navy` for strong secondary emphasis.
```jsx
<Button variant="primary" size="lg">Look up</Button>
<Button variant="secondary">Cancel</Button>
```
Variants: primary (blue fill, navy text: white on the blue fails AA; hover and press go lighter in both themes), navy, secondary (outlined), ghost, danger. Sizes sm 32 / md 40 / lg 48. `block` = full width. Pass Lucide SVGs via iconLeft/iconRight.