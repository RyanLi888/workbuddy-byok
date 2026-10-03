import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { VirtualPageSection } from "./VirtualPage";
import { VirtualPage } from "./VirtualPage";
import styles from "./PageContent.module.scss";

export function PageContent({ title, header, sections, contentClassName, fixed = false }: { title?: ReactNode; header?: ReactNode; sections: VirtualPageSection[]; contentClassName?: string; fixed?: boolean }) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const element = headerRef.current;
    if (!element) return;
    const measure = () => setHeaderHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [header != null]);
  const inset = header != null ? { "--page-content-top": `calc(var(--app-content-top) + ${headerHeight}px + var(--app-region-gap))` } as CSSProperties : undefined;
  return <div className={styles.root} style={inset}>
    {header != null && <div ref={headerRef} className={styles.header}>{header}</div>}
    {fixed && title != null && <div className={styles.title}>{title}</div>}
    {fixed
      ? <div className={[styles.fixedContent, contentClassName].filter(Boolean).join(" ")}>{sections.map((section) => <section className={styles.fixedSection} key={section.key}>{section.content}</section>)}</div>
      : <VirtualPage title={title} sections={sections} contentClassName={contentClassName} />}
  </div>;
}
