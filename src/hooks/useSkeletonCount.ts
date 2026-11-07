import { useLayoutEffect, useRef, useState } from "react";

export function skeletonCount(
  width: number,
  height: number,
  minWidth: number,
  rowHeight: number,
  gap: number,
) {
  const columns = Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
  return columns * Math.max(1, Math.ceil((height + gap) / (rowHeight + gap)));
}

export function useSkeletonCount(minWidth: number, rowHeight: number, gap: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(24);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () =>
      setCount(skeletonCount(node.clientWidth, node.clientHeight, minWidth, rowHeight, gap));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [minWidth, rowHeight, gap]);

  return { ref, count };
}
