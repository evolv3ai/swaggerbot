/* @ds-bundle: {"format":4,"namespace":"Nocturne_noctur","components":[{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"IconButton","sourcePath":"components/actions/IconButton.jsx"},{"name":"AnswerBadge","sourcePath":"components/display/AnswerBadge.jsx"},{"name":"Badge","sourcePath":"components/display/Badge.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"Tag","sourcePath":"components/display/Tag.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/actions/Button.jsx":"218193fc958c","components/actions/IconButton.jsx":"e3a5e9736999","components/display/AnswerBadge.jsx":"9bb86d269255","components/display/Badge.jsx":"f387910aa18c","components/display/Card.jsx":"962d55226d37","components/display/Tag.jsx":"399709b425b3","components/feedback/Dialog.jsx":"5a91525fa7f3","components/feedback/Toast.jsx":"a6ea698a50b5","components/feedback/Tooltip.jsx":"f529828a5774","components/forms/Checkbox.jsx":"fe0f76e234a4","components/forms/Input.jsx":"eda71e4d6873","components/forms/Radio.jsx":"f617ecc5917e","components/forms/Select.jsx":"50e768618061","components/forms/Switch.jsx":"966fdc2a7c04","components/navigation/Tabs.jsx":"0bce3fb18dc8","ui_kits/website/Site.jsx":"0808f0bfa2dd","ui_kits/website/data.js":"b32943e7b6d6"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.Nocturne_noctur = window.Nocturne_noctur || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  iconLeft,
  iconRight,
  className = '',
  children,
  ...rest
}) {
  const cls = ['sb-btn', 'sb-btn--' + variant, 'sb-btn--' + size, block && 'sb-btn--block', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", _extends({
    className: cls
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button.jsx", error: String((e && e.message) || e) }); }

// components/actions/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function IconButton({
  variant = 'ghost',
  size = 'md',
  label,
  children,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    "aria-label": label,
    title: label,
    className: ['sb-btn', 'sb-btn--icon', 'sb-btn--' + variant, 'sb-btn--' + size, className].join(' ')
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/display/AnswerBadge.jsx
try { (() => {
const MAP = {
  resolved: ['success', 'Resolved', 'Resolved'],
  unconfirmed: ['warning', 'Unconfirmed', 'Unconf.'],
  ambiguous: ['accent', 'Ambiguous', 'Ambig.'],
  'no-spec': ['neutral', 'No Spec', 'No Spec'],
  unknown: ['unknown', 'Unknown', 'Unknown']
};
function AnswerBadge({
  answer = 'resolved',
  short = false,
  className = ''
}) {
  const [tone, full, abbr] = MAP[answer] || MAP.unknown;
  const style = tone === 'unknown' ? {
    background: 'transparent',
    border: '1.5px solid var(--border-strong)',
    color: 'var(--text-muted)'
  } : undefined;
  return /*#__PURE__*/React.createElement("span", {
    className: ['sb-badge', 'sb-badge--dot', tone !== 'unknown' && 'sb-badge--' + tone, className].filter(Boolean).join(' '),
    style: style
  }, short ? abbr : full);
}
Object.assign(__ds_scope, { AnswerBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/AnswerBadge.jsx", error: String((e && e.message) || e) }); }

// components/display/Badge.jsx
try { (() => {
function Badge({
  tone = 'accent',
  dot = false,
  children,
  className = ''
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: ['sb-badge', 'sb-badge--' + tone, dot && 'sb-badge--dot', className].filter(Boolean).join(' ')
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Card({
  variant = 'default',
  interactive = false,
  eyebrow,
  title,
  children,
  className = '',
  ...rest
}) {
  const cls = ['sb-card', variant !== 'default' && 'sb-card--' + variant, interactive && 'sb-card--interactive', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls
  }, rest), eyebrow && /*#__PURE__*/React.createElement("div", {
    className: "sb-eyebrow"
  }, eyebrow), title && /*#__PURE__*/React.createElement("h3", {
    className: "sb-card__title"
  }, title), typeof children === 'string' ? /*#__PURE__*/React.createElement("p", {
    className: "sb-card__body"
  }, children) : children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tag({
  selected = false,
  onRemove,
  children,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ['sb-tag', selected && 'sb-tag--selected', className].filter(Boolean).join(' ')
  }, rest), children, onRemove && /*#__PURE__*/React.createElement("button", {
    className: "sb-tag__x",
    "aria-label": "Remove",
    onClick: onRemove
  }, "\xD7"));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Tag.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function Dialog({
  open = true,
  title,
  children,
  actions,
  onClose,
  inline = false
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: 'sb-dialog-backdrop' + (inline ? ' sb-dialog-backdrop--inline' : ''),
    onClick: e => {
      if (e.target === e.currentTarget && onClose) onClose();
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sb-dialog",
    role: "dialog",
    "aria-modal": "true"
  }, title && /*#__PURE__*/React.createElement("h2", {
    className: "sb-dialog__title"
  }, title), /*#__PURE__*/React.createElement("div", {
    className: "sb-dialog__body"
  }, children), actions && /*#__PURE__*/React.createElement("div", {
    className: "sb-dialog__actions"
  }, actions)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function Toast({
  tone = 'info',
  title,
  children,
  onClose
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: 'sb-toast sb-toast--' + tone,
    role: "status"
  }, /*#__PURE__*/React.createElement("span", {
    className: "sb-toast__dot"
  }), /*#__PURE__*/React.createElement("div", null, title && /*#__PURE__*/React.createElement("p", {
    className: "sb-toast__title"
  }, title), children && /*#__PURE__*/React.createElement("p", {
    className: "sb-toast__msg"
  }, children)), onClose && /*#__PURE__*/React.createElement("button", {
    className: "sb-toast__close",
    "aria-label": "Dismiss",
    onClick: onClose
  }, "\xD7"));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
function Tooltip({
  content,
  open = false,
  children
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "sb-tooltip-wrap"
  }, children, /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    className: 'sb-tooltip' + (open ? ' sb-tooltip--open' : '')
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Checkbox({
  label,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: 'sb-check ' + className
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox"
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "sb-check__box"
  }), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  label,
  hint,
  error,
  mono = false,
  multiline = false,
  id,
  className = '',
  ...rest
}) {
  const fid = id || (label ? 'in-' + String(label).toLowerCase().replace(/\W+/g, '-') : undefined);
  const cls = ['sb-input', mono && 'sb-input--mono', error && 'sb-input--error', className].filter(Boolean).join(' ');
  const El = multiline ? 'textarea' : 'input';
  return /*#__PURE__*/React.createElement("div", {
    className: "sb-field"
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "sb-label",
    htmlFor: fid
  }, label), /*#__PURE__*/React.createElement(El, _extends({
    id: fid,
    className: cls,
    "aria-invalid": !!error
  }, rest)), (error || hint) && /*#__PURE__*/React.createElement("span", {
    className: 'sb-hint' + (error ? ' sb-hint--error' : '')
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Radio({
  label,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: 'sb-check sb-check--radio ' + className
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "radio"
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "sb-check__box"
  }), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  label,
  hint,
  options = [],
  id,
  className = '',
  ...rest
}) {
  const fid = id || (label ? 'sel-' + String(label).toLowerCase().replace(/\W+/g, '-') : undefined);
  return /*#__PURE__*/React.createElement("div", {
    className: "sb-field"
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "sb-label",
    htmlFor: fid
  }, label), /*#__PURE__*/React.createElement("select", _extends({
    id: fid,
    className: 'sb-input sb-select ' + className
  }, rest), options.map(o => {
    const v = typeof o === 'string' ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: v.value,
      value: v.value
    }, v.label);
  })), hint && /*#__PURE__*/React.createElement("span", {
    className: "sb-hint"
  }, hint));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  label,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: 'sb-switch ' + className
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch"
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "sb-switch__track"
  }), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function Tabs({
  tabs = [],
  value,
  defaultValue,
  onChange,
  variant = 'line',
  className = ''
}) {
  const [inner, setInner] = React.useState(defaultValue ?? (tabs[0] && (tabs[0].value ?? tabs[0])));
  const cur = value ?? inner;
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    className: ['sb-tabs', variant === 'pill' && 'sb-tabs--pill', className].filter(Boolean).join(' ')
  }, tabs.map(t => {
    const v = typeof t === 'string' ? {
      value: t,
      label: t
    } : t;
    return /*#__PURE__*/React.createElement("button", {
      key: v.value,
      role: "tab",
      className: "sb-tab",
      "aria-selected": cur === v.value,
      onClick: () => {
        setInner(v.value);
        onChange && onChange(v.value);
      }
    }, v.label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Site.jsx
try { (() => {
const NS = window.Nocturne_noctur || {};
const {
  Button,
  IconButton,
  Input,
  Select,
  Checkbox,
  Card,
  Badge,
  Tag,
  Tabs,
  Toast,
  Tooltip
} = NS;
const ANS = {
  resolved: ['success', 'Resolved'],
  unconfirmed: ['warning', 'Unconfirmed'],
  ambiguous: ['accent', 'Ambiguous'],
  'no-spec': ['neutral', 'No Spec'],
  unknown: ['neutral', 'Unknown']
};
const AnswerBadge = NS.AnswerBadge || (({
  answer
}) => {
  const [t, l] = ANS[answer];
  return /*#__PURE__*/React.createElement("span", {
    className: 'sb-badge sb-badge--dot sb-badge--' + t
  }, l);
});
const Svg = ({
  d,
  s = 18
}) => /*#__PURE__*/React.createElement("svg", {
  width: s,
  height: s,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2.25",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, d);
const ISearch = () => /*#__PURE__*/React.createElement(Svg, {
  d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m20 20-3.5-3.5"
  }))
});
const ICopy = () => /*#__PURE__*/React.createElement(Svg, {
  d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 15V5a2 2 0 0 1 2-2h10"
  }))
});
const IArrow = () => /*#__PURE__*/React.createElement(Svg, {
  d: /*#__PURE__*/React.createElement("path", {
    d: "M5 12h14M13 6l6 6-6 6"
  })
});
const IBack = () => /*#__PURE__*/React.createElement(Svg, {
  d: /*#__PURE__*/React.createElement("path", {
    d: "M19 12H5M11 6l-6 6 6 6"
  })
});
const ICheck = () => /*#__PURE__*/React.createElement(Svg, {
  s: 16,
  d: /*#__PURE__*/React.createElement("path", {
    d: "M5 12l5 5L20 7"
  })
});
const wrap = {
  maxWidth: 1120,
  margin: '0 auto',
  padding: '0 32px'
};
const mono = {
  fontFamily: 'var(--font-mono)',
  fontSize: 13
};
const muted = {
  color: 'var(--text-muted)'
};
function Header({
  page,
  go,
  theme,
  setTheme
}) {
  const links = [['search', 'Search'], ['vendors', 'Vendors'], ['docs', 'Docs']];
  return /*#__PURE__*/React.createElement("header", {
    style: {
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg)',
      position: 'sticky',
      top: 0,
      zIndex: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...wrap,
      display: 'flex',
      alignItems: 'center',
      gap: 32,
      height: 68
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => {
      e.preventDefault();
      go('search');
    },
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      textDecoration: 'none',
      color: 'var(--text)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/mark.png",
    alt: "",
    style: {
      height: 34
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '800 21px var(--font-display)',
      letterSpacing: '-.02em'
    }
  }, "SwaggerBot")), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      gap: 4,
      marginRight: 'auto'
    }
  }, links.map(([k, l]) => /*#__PURE__*/React.createElement("a", {
    key: k,
    href: "#",
    onClick: e => {
      e.preventDefault();
      go(k);
    },
    style: {
      font: '600 14px var(--font-display)',
      padding: '8px 14px',
      borderRadius: 8,
      textDecoration: 'none',
      color: page === k || k === 'search' && page === 'lookup' ? 'var(--accent-text)' : 'var(--text-muted)',
      background: page === k || k === 'search' && page === 'lookup' ? 'var(--accent-soft)' : 'transparent'
    }
  }, l))), /*#__PURE__*/React.createElement("button", {
    className: "sb-btn sb-btn--ghost sb-btn--sm",
    onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark')
  }, theme === 'dark' ? 'Light' : 'Dark'), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: () => go('docs')
  }, "Get an API key")));
}
function SearchBox({
  onLookup,
  initial = ''
}) {
  const [q, setQ] = React.useState(initial);
  const submit = e => {
    e.preventDefault();
    if (q.trim()) onLookup(q.trim());
  };
  return /*#__PURE__*/React.createElement("form", {
    onSubmit: submit,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      padding: 8,
      background: 'var(--surface)',
      border: '2px solid var(--accent)',
      borderRadius: 16,
      boxShadow: 'var(--shadow-md)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'grid',
      placeItems: 'center',
      paddingLeft: 10,
      color: 'var(--accent)'
    }
  }, /*#__PURE__*/React.createElement(ISearch, null)), /*#__PURE__*/React.createElement("input", {
    "aria-label": "The name of an API",
    value: q,
    onChange: e => setQ(e.target.value),
    placeholder: "The name of an API",
    style: {
      flex: 1,
      border: 0,
      outline: 0,
      background: 'transparent',
      font: '500 18px var(--font-body)',
      color: 'var(--text)',
      minWidth: 0
    }
  }), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    type: "submit"
  }, "Develop")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 20,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "sb-eyebrow",
    style: {
      color: 'var(--text-faint)'
    }
  }, "Options"), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 200
    }
  }, /*#__PURE__*/React.createElement("select", {
    className: "sb-input sb-select",
    style: {
      height: 34,
      fontSize: 13
    },
    "aria-label": "API Version"
  }, /*#__PURE__*/React.createElement("option", null, "API Version (optional)"), /*#__PURE__*/React.createElement("option", null, "Latest"))), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Include Community Specs"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      ...muted,
      fontSize: 13
    }
  }, "Try: ", /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => {
      e.preventDefault();
      onLookup('plaid');
    }
  }, "Plaid"), ", ", /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => {
      e.preventDefault();
      onLookup('mercury');
    }
  }, "Mercury"), ", ", /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => {
      e.preventDefault();
      onLookup('acme');
    }
  }, "Acme"))));
}
function Stat({
  n,
  l
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '800 32px var(--font-display)',
      letterSpacing: '-.02em'
    }
  }, n), /*#__PURE__*/React.createElement("div", {
    className: "sb-eyebrow",
    style: {
      color: 'var(--text-muted)'
    }
  }, l));
}
function ResultCard({
  a,
  onOpen
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: 'sb-card' + (onOpen ? ' sb-card--interactive' : ''),
    onClick: onOpen,
    style: {
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(AnswerBadge, {
    answer: a.answer
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      ...mono,
      ...muted
    }
  }, "Answered in ", a.ms, "ms")), /*#__PURE__*/React.createElement("h3", {
    className: "sb-card__title",
    style: {
      fontSize: 20
    }
  }, a.name), /*#__PURE__*/React.createElement("dl", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,minmax(0,1fr))',
      gap: 12,
      margin: 0
    }
  }, [['Vendor', a.vendor], ['Provenance', a.provenance], ['Verified', a.verified], ['Spec', a.spec]].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k
  }, /*#__PURE__*/React.createElement("dt", {
    className: "sb-eyebrow",
    style: {
      color: 'var(--text-faint)',
      fontSize: 10
    }
  }, k), /*#__PURE__*/React.createElement("dd", {
    style: {
      margin: '4px 0 0',
      ...(k === 'Spec' ? mono : {
        fontSize: 14,
        fontWeight: 500
      })
    }
  }, v)))));
}
function SearchScreen({
  onLookup
}) {
  const D = window.SB_DATA;
  return /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement("section", {
    style: {
      ...wrap,
      paddingTop: 80,
      paddingBottom: 64,
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)',
      gap: 56,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "sb-tagline",
    style: {
      fontSize: 13,
      marginBottom: 20
    }
  }, "Better than specs"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 72,
      marginBottom: 20
    }
  }, "No fake Specs."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 19,
      ...muted,
      maxWidth: 560,
      marginBottom: 36
    }
  }, "Name an API. SwaggerBot hands you its OpenAPI Spec, where it came from and how sure it is, or tells you straight why there isn't one."), /*#__PURE__*/React.createElement(SearchBox, {
    onLookup: onLookup
  })), /*#__PURE__*/React.createElement("aside", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sb-card sb-card--interactive",
    onClick: () => onLookup('plaid')
  }, /*#__PURE__*/React.createElement("div", {
    className: "sb-eyebrow"
  }, "Last verified"), /*#__PURE__*/React.createElement("div", {
    className: "sb-card__title"
  }, "The Plaid API"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "success"
  }, "Official"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      ...muted
    }
  }, "24 Sept 2026"))), /*#__PURE__*/React.createElement("div", {
    className: "sb-card",
    style: {
      background: 'var(--bg-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sb-eyebrow",
    style: {
      color: 'var(--text-muted)'
    }
  }, "In the Index"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Stat, {
    n: D.stats.vendors,
    l: "Vendors"
  }), /*#__PURE__*/React.createElement(Stat, {
    n: D.stats.apis,
    l: "APIs"
  }), /*#__PURE__*/React.createElement(Stat, {
    n: D.stats.specs,
    l: "Specs"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 13,
      ...muted
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: 'var(--success)'
    }
  }), "Service operational")))), /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--bg-subtle)',
      borderTop: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...wrap,
      paddingTop: 40,
      paddingBottom: 40
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontStyle: 'italic',
      ...muted,
      fontSize: 14,
      marginBottom: 16
    }
  }, "Every answer is one of five, from sure to not found"), /*#__PURE__*/React.createElement("ol", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(5,1fr)',
      gap: 12,
      listStyle: 'none',
      padding: 0,
      margin: 0
    }
  }, [['resolved', 'We found it and we are sure.'], ['unconfirmed', 'Found, but not proven official.'], ['ambiguous', 'More than one API has that name.'], ['no-spec', 'The API exists. No Spec does.'], ['unknown', "We couldn't identify the API."]].map(([a, t], i) => /*#__PURE__*/React.createElement("li", {
    key: a,
    style: {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...mono,
      color: 'var(--text-faint)'
    }
  }, "0", i + 1), /*#__PURE__*/React.createElement(AnswerBadge, {
    answer: a
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      ...muted
    }
  }, t)))))), /*#__PURE__*/React.createElement("section", {
    style: {
      ...wrap,
      paddingTop: 64,
      paddingBottom: 64
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 28
    }
  }, "Replay: real answers from the Index"), /*#__PURE__*/React.createElement("p", {
    style: {
      ...muted,
      fontSize: 14,
      marginBottom: 24
    }
  }, "2 of the 4 APIs the Index verified most recently, as a default Lookup answers them."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 16
    }
  }, D.apis.slice(0, 2).map(a => /*#__PURE__*/React.createElement(ResultCard, {
    key: a.key,
    a: a,
    onOpen: () => onLookup(a.key)
  })))), /*#__PURE__*/React.createElement("section", {
    style: {
      ...wrap,
      paddingBottom: 80
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 28
    }
  }, "How a Spec is developed"), /*#__PURE__*/React.createElement("p", {
    style: {
      ...muted,
      fontSize: 14,
      marginBottom: 24
    }
  }, "From the Index, anyone. Past it, Discovery, with an API key."), /*#__PURE__*/React.createElement("ol", {
    style: {
      listStyle: 'none',
      padding: 0,
      margin: 0,
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 16
    }
  }, D.steps.map(([t, d], i) => /*#__PURE__*/React.createElement("li", {
    key: t,
    style: {
      display: 'flex',
      gap: 14,
      padding: 20,
      border: '1px solid var(--border)',
      borderRadius: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '800 15px var(--font-mono)',
      color: 'var(--accent)'
    }
  }, String(i + 1).padStart(2, '0')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '700 16px var(--font-display)',
      marginBottom: 4
    }
  }, t), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      ...muted
    }
  }, d))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 32,
      padding: '20px 24px',
      borderRadius: 16,
      background: 'var(--sb-ink)',
      color: '#fff',
      display: 'flex',
      gap: 16,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 260
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: 'var(--font-display)'
    }
  }, "Benchmark, 23 Sept 2026:"), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--gray-300)'
    }
  }, "0 wrong of 20 Resolved answers, on 2 runs over the 40-name set.")), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: 'var(--blue-300)',
      fontWeight: 600,
      fontSize: 14
    }
  }, "How it was measured"))));
}
function LookupScreen({
  query,
  go,
  onLookup
}) {
  const D = window.SB_DATA;
  const q = query.toLowerCase();
  const a = D.apis.find(x => x.key === q || x.name.toLowerCase().includes(q)) || {
    key: q,
    name: query,
    answer: 'no-spec',
    ms: 3.2,
    note: 'We found the API, but its Vendor publishes no OpenAPI or Swagger Spec. We looked in all six places.'
  };
  const [copied, setCopied] = React.useState(false);
  const found = a.answer === 'resolved' || a.answer === 'unconfirmed';
  const trail = D.steps.map(([t], i) => ({
    t,
    state: a.answer === 'resolved' ? i === 0 ? 'answered' : i === 5 ? 'passed' : 'skip' : a.answer === 'unconfirmed' ? i < 2 ? 'checked' : i === 1 ? 'answered' : i === 5 ? 'unsure' : 'checked' : 'checked'
  }));
  return /*#__PURE__*/React.createElement("main", {
    style: {
      ...wrap,
      paddingTop: 40,
      paddingBottom: 80
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sb-btn sb-btn--ghost sb-btn--sm",
    onClick: () => go('search'),
    style: {
      marginBottom: 24,
      paddingLeft: 6
    }
  }, /*#__PURE__*/React.createElement(IBack, null), "New Lookup"), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 760,
      marginBottom: 40
    }
  }, /*#__PURE__*/React.createElement(SearchBox, {
    onLookup: onLookup,
    initial: query
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)',
      gap: 24,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sb-card",
    style: {
      padding: 32,
      gap: 20,
      borderWidth: 2,
      borderColor: found ? 'var(--accent)' : 'var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(AnswerBadge, {
    answer: a.answer
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      ...mono,
      ...muted
    }
  }, "Answered in ", a.ms, "ms")), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 36,
      margin: 0
    }
  }, a.name), a.note && /*#__PURE__*/React.createElement("p", {
    style: {
      ...muted,
      margin: 0
    }
  }, a.note), found && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("dl", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 16,
      margin: 0,
      padding: '20px 0',
      borderTop: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)'
    }
  }, [['Vendor', a.vendor], ['Provenance', a.provenance], ['Verified', a.verified], ['Version', a.version], ['Spec', a.spec], ['Format', 'OpenAPI 3.0']].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k
  }, /*#__PURE__*/React.createElement("dt", {
    className: "sb-eyebrow",
    style: {
      color: 'var(--text-faint)',
      fontSize: 10
    }
  }, k), /*#__PURE__*/React.createElement("dd", {
    style: {
      margin: '4px 0 0',
      ...(k === 'Spec' || k === 'Version' ? mono : {
        fontWeight: 500
      })
    }
  }, v)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 240,
      ...mono,
      padding: '10px 14px',
      background: 'var(--surface-sunken)',
      borderRadius: 10,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, "https://swaggerbot.dev/spec/", a.spec, ".json"), /*#__PURE__*/React.createElement(Button, {
    onClick: () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    },
    iconLeft: copied ? /*#__PURE__*/React.createElement(ICheck, null) : /*#__PURE__*/React.createElement(ICopy, null)
  }, copied ? 'Copied' : 'Copy Spec URL'), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, "Download")), a.answer === 'unconfirmed' && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--warning-text)',
      margin: 0
    }
  }, "This Spec is from the Community. We couldn't prove the Vendor publishes it.")), a.answer === 'ambiguous' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Tag, null, "mercury.com"), /*#__PURE__*/React.createElement(Tag, null, "postlight/mercury-parser"))), /*#__PURE__*/React.createElement("aside", {
    className: "sb-card",
    style: {
      background: 'var(--bg-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sb-eyebrow",
    style: {
      color: 'var(--text-muted)'
    }
  }, "How it was developed"), /*#__PURE__*/React.createElement("ol", {
    style: {
      listStyle: 'none',
      padding: 0,
      margin: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, trail.map((s, i) => {
    const on = s.state === 'answered' || s.state === 'passed';
    return /*#__PURE__*/React.createElement("li", {
      key: s.t,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 14,
        opacity: s.state === 'skip' ? .5 : 1
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 26,
        height: 26,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
        background: on ? 'var(--accent)' : 'var(--surface)',
        color: on ? '#fff' : 'var(--text-faint)',
        border: on ? '0' : '2px solid var(--border-strong)',
        ...mono,
        fontSize: 11,
        fontWeight: 700
      }
    }, on ? /*#__PURE__*/React.createElement(ICheck, null) : String(i + 1).padStart(2, '0')), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontWeight: 500
      }
    }, s.t), /*#__PURE__*/React.createElement("span", {
      style: {
        ...mono,
        fontSize: 11,
        color: 'var(--text-faint)'
      }
    }, s.state === 'answered' ? 'Answered here' : s.state === 'passed' ? 'Passed' : s.state === 'skip' ? 'Not needed' : s.state === 'unsure' ? 'Not sure' : 'Checked'));
  })))));
}
function VendorsScreen({
  onLookup
}) {
  const D = window.SB_DATA;
  const [f, setF] = React.useState('All');
  const rows = D.apis.filter(a => a.vendor !== '—' && (f === 'All' || a.provenance === f));
  return /*#__PURE__*/React.createElement("main", {
    style: {
      ...wrap,
      paddingTop: 56,
      paddingBottom: 80
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sb-eyebrow",
    style: {
      marginBottom: 12
    }
  }, "The Index"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 48
    }
  }, "Vendors"), /*#__PURE__*/React.createElement("p", {
    style: {
      ...muted,
      marginBottom: 28
    }
  }, D.stats.vendors, " Vendors, ", D.stats.apis, " APIs, ", D.stats.specs, " Specs. Every one verified before it got here."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    variant: "pill",
    tabs: ['All', 'Official', 'Community'],
    value: f,
    onChange: setF
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--border)',
      borderRadius: 16,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 14
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--bg-subtle)'
    }
  }, ['API', 'Vendor', 'Provenance', 'Answer', 'Verified', 'Spec'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    className: "sb-eyebrow",
    style: {
      textAlign: 'left',
      padding: '12px 16px',
      color: 'var(--text-muted)',
      fontSize: 10
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, rows.map(a => /*#__PURE__*/React.createElement("tr", {
    key: a.key,
    onClick: () => onLookup(a.key),
    style: {
      borderTop: '1px solid var(--border)',
      cursor: 'pointer'
    },
    onMouseEnter: e => e.currentTarget.style.background = 'var(--accent-soft)',
    onMouseLeave: e => e.currentTarget.style.background = ''
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '14px 16px',
      fontWeight: 600
    }
  }, a.name), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '14px 16px',
      ...muted
    }
  }, a.vendor), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '14px 16px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: a.provenance === 'Official' ? 'accent' : 'neutral'
  }, a.provenance)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '14px 16px'
    }
  }, /*#__PURE__*/React.createElement(AnswerBadge, {
    answer: a.answer
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '14px 16px',
      ...muted
    }
  }, a.verified), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '14px 16px',
      ...mono
    }
  }, a.spec)))))));
}
function DocsScreen() {
  const [t, setT] = React.useState('MCP');
  const code = t === 'MCP' ? '{\n  "mcpServers": {\n    "swaggerbot": {\n      "url": "https://swaggerbot.dev/mcp",\n      "headers": { "Authorization": "Bearer sb_live_…" }\n    }\n  }\n}' : 'curl "https://swaggerbot.dev/api/lookup?name=plaid" \\\n  -H "Authorization: Bearer sb_live_…"\n\n{\n  "answer": "resolved",\n  "api": "The Plaid API",\n  "provenance": "official",\n  "spec": "a41f09c2d7e3"\n}';
  return /*#__PURE__*/React.createElement("main", {
    style: {
      ...wrap,
      paddingTop: 56,
      paddingBottom: 80,
      display: 'grid',
      gridTemplateColumns: '220px minmax(0,1fr)',
      gap: 48
    }
  }, /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      fontSize: 14
    }
  }, ['Quick start', 'Lookup', 'The five answers', 'Provenance', 'Discovery', 'API keys', 'Rate limits'].map((l, i) => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    onClick: e => e.preventDefault(),
    style: {
      padding: '8px 12px',
      borderRadius: 8,
      textDecoration: 'none',
      color: i === 0 ? 'var(--accent-text)' : 'var(--text-muted)',
      background: i === 0 ? 'var(--accent-soft)' : '',
      fontWeight: i === 0 ? 600 : 500
    }
  }, l))), /*#__PURE__*/React.createElement("article", {
    style: {
      maxWidth: 720
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sb-eyebrow",
    style: {
      marginBottom: 12
    }
  }, "Docs"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 44
    }
  }, "Quick start"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 17,
      ...muted
    }
  }, "For agents and programs: the same answers over MCP and the HTTP API. Lookups against the Index need no key. Discovery needs one."), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '28px 0 12px'
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    tabs: ['MCP', 'HTTP API'],
    value: t,
    onChange: setT
  })), /*#__PURE__*/React.createElement("pre", {
    style: {
      margin: 0,
      padding: 24,
      background: 'var(--sb-ink)',
      color: '#E5EAF2',
      borderRadius: 16,
      font: '13px/1.7 var(--font-mono)',
      overflow: 'auto'
    }
  }, code), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 24,
      marginTop: 40
    }
  }, "Reading an answer"), /*#__PURE__*/React.createElement("p", {
    style: muted
  }, "Every Lookup returns exactly one of five answers. Treat anything but Resolved as a reason to check."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, ['resolved', 'unconfirmed', 'ambiguous', 'no-spec', 'unknown'].map(a => /*#__PURE__*/React.createElement(AnswerBadge, {
    key: a,
    answer: a
  })))));
}
function Footer() {
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...wrap,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      height: 88,
      fontSize: 13,
      ...muted
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/mark.png",
    alt: "",
    style: {
      height: 24
    }
  }), /*#__PURE__*/React.createElement("span", null, "SwaggerBot \xB7 swaggerbot.dev"), /*#__PURE__*/React.createElement("span", {
    className: "sb-tagline",
    style: {
      fontSize: 10,
      marginLeft: 'auto'
    }
  }, "Better than specs"), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      marginLeft: 24
    }
  }, "Source on GitHub")));
}
function App() {
  const [s, setS] = React.useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sb-kit')) || {
        page: 'search',
        q: ''
      };
    } catch (e) {
      return {
        page: 'search',
        q: ''
      };
    }
  });
  const [theme, setTheme] = React.useState(() => localStorage.getItem('sb-kit-theme') || 'light');
  React.useEffect(() => {
    localStorage.setItem('sb-kit', JSON.stringify(s));
    window.scrollTo(0, 0);
  }, [s]);
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sb-kit-theme', theme);
  }, [theme]);
  const go = p => setS({
    page: p,
    q: s.q
  });
  const onLookup = q => setS({
    page: 'lookup',
    q
  });
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": s.page
  }, /*#__PURE__*/React.createElement(Header, {
    page: s.page,
    go: go,
    theme: theme,
    setTheme: setTheme
  }), s.page === 'search' && /*#__PURE__*/React.createElement(SearchScreen, {
    onLookup: onLookup
  }), s.page === 'lookup' && /*#__PURE__*/React.createElement(LookupScreen, {
    key: s.q,
    query: s.q,
    go: go,
    onLookup: onLookup
  }), s.page === 'vendors' && /*#__PURE__*/React.createElement(VendorsScreen, {
    onLookup: onLookup
  }), s.page === 'docs' && /*#__PURE__*/React.createElement(DocsScreen, null), /*#__PURE__*/React.createElement(Footer, null));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Site.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/data.js
try { (() => {
window.SB_DATA = {
  stats: {
    vendors: 21,
    apis: 21,
    specs: 27
  },
  apis: [{
    key: 'plaid',
    name: 'The Plaid API',
    vendor: 'plaid.com',
    provenance: 'Official',
    verified: '24 Sept 2026',
    spec: 'a41f09c2d7e3',
    answer: 'resolved',
    version: '2020-09-14',
    ms: 1.4
  }, {
    key: 'jira',
    name: 'The Jira Cloud platform REST API',
    vendor: 'atlassian.com',
    provenance: 'Official',
    verified: '24 Sept 2026',
    spec: '6ecc461bb85e',
    answer: 'resolved',
    version: '1001.0.0',
    ms: 1.7
  }, {
    key: 'stripe',
    name: 'The Stripe API',
    vendor: 'stripe.com',
    provenance: 'Official',
    verified: '23 Sept 2026',
    spec: '9b2e71f0aa14',
    answer: 'resolved',
    version: '2026-08-27',
    ms: 1.2
  }, {
    key: 'github',
    name: 'GitHub REST API',
    vendor: 'github.com',
    provenance: 'Official',
    verified: '22 Sept 2026',
    spec: 'c07d3e5b9f21',
    answer: 'resolved',
    version: '1.1.4',
    ms: 2.1
  }, {
    key: 'twilio',
    name: 'Twilio Messaging',
    vendor: 'twilio.com',
    provenance: 'Community',
    verified: '21 Sept 2026',
    spec: '5de8a0b4c613',
    answer: 'unconfirmed',
    version: '1.0.0',
    ms: 1.9
  }, {
    key: 'mercury',
    name: 'Mercury',
    vendor: '—',
    provenance: '—',
    verified: '—',
    spec: '—',
    answer: 'ambiguous',
    ms: 2.4,
    note: 'Two APIs match this name: Mercury (banking, mercury.com) and Mercury Parser. Add the Vendor to pick one.'
  }, {
    key: 'slack',
    name: 'Slack Web API',
    vendor: 'slack.com',
    provenance: 'Official',
    verified: '20 Sept 2026',
    spec: 'e2c9f47d01ab',
    answer: 'resolved',
    version: '1.7.0',
    ms: 1.5
  }, {
    key: 'notion',
    name: 'Notion API',
    vendor: 'notion.so',
    provenance: 'Community',
    verified: '19 Sept 2026',
    spec: '71ab3c98ef02',
    answer: 'unconfirmed',
    version: '1.0.0',
    ms: 1.8
  }],
  steps: [['Index', 'Specs verified before. Answered in milliseconds, no key needed.'], ['APIs.guru', 'The public directory of API descriptions.'], ['Developer Portal', 'Found with a web search.'], ['Vendor domain', 'Known paths, apis.json, then a shallow crawl.'], ['GitHub', "The Vendor's organisation first, then the rest."], ['Judged', 'Is it the API you meant, and its Spec? Not sure means we say so.']]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.AnswerBadge = __ds_scope.AnswerBadge;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
