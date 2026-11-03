import type { ReactNode } from 'react';

export interface LayoutProps {
  children: ReactNode;
  className?: string;
}

/**
 * Landscape-locked layout wrapper for the Outlands route. On portrait mobile the
 * whole subtree is rotated 90° via CSS (see zombieShooter.css) so the isometric
 * canvas never renders sideways.
 */
export function Layout({ children, className }: LayoutProps) {
  return <div className={`outlands-root ${className ?? ''}`}>{children}</div>;
}
