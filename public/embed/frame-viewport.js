// The Spec viewer's frame (/embed/specs/…) has an opaque origin, so to the
// browser it is a cross-origin frame. Scalar renders each section lazily,
// when an IntersectionObserver with the implicit root sees it. For a
// cross-origin frame the implicit root is the top page's viewport: nothing
// renders while the frame is below the fold, so the visitor scrolls down to
// empty placeholders. Here an observer with no root observes the frame's own
// document instead: what is in the frame's own viewport renders on load,
// wherever the frame is on the page. The margin stays 0 (Scalar asks for
// 1200px): rendering sections ahead of the one in view would make a Tab walk
// through the frame endless, as each section rendered the next. Nothing is
// sent to the parent page. Loaded before Scalar.
(() => {
  const Native = window.IntersectionObserver;
  if (typeof Native !== "function") return;
  class FrameIntersectionObserver extends Native {
    constructor(callback, options = {}) {
      super(
        callback,
        options.root == null
          ? { ...options, root: document, rootMargin: "0px" }
          : options,
      );
    }
  }
  window.IntersectionObserver = FrameIntersectionObserver;
})();
