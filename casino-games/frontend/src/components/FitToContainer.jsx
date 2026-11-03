import { useLayoutEffect, useRef, useState } from 'react';

// Scales decorative game stages down on desktop. Mobile layouts scroll instead,
// preserving readable text and 44px controls.
export default function FitToContainer({ children, maxScale = 1 }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      if (window.innerWidth < 768) {
        setScale(1);
        return;
      }
      const oh = outer.clientHeight;
      const ow = outer.clientWidth;
      const ih = inner.scrollHeight;
      const iw = inner.scrollWidth;
      if (oh > 0 && ow > 0 && ih > 0 && iw > 0) {
        const next = Math.min(maxScale, oh / ih, ow / iw);
        setScale((current) => Math.abs(current - next) < 0.001 ? current : next);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [maxScale]);

  return (
    <div
      ref={outerRef}
      style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        ref={innerRef}
        style={{
          width: '100%',
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
    </div>
  );
}
