/**
 * Root Layout
 *
 * Main application layout with sidebar navigation.
 * Uses the Router's Outlet and navigate for client-side navigation.
 */

import type { RoutePageProps } from '@inkibra/router';
import { Link, useCurrentPath, useMountPath } from '@inkibra/router/react';
import { appRoutes } from '../routes';

// ============================================================================
// Styles (inline for simplicity)
// ============================================================================

const styles = {
  container: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    backgroundColor: '#0f0f0f',
    color: '#ffffff',
  },
  sidebar: {
    width: '240px',
    backgroundColor: '#1a1a1a',
    borderRight: '1px solid #2a2a2a',
    padding: '20px 0',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  logo: {
    padding: '0 20px 20px',
    fontSize: '20px',
    fontWeight: 700,
    color: '#ffffff',
    borderBottom: '1px solid #2a2a2a',
    marginBottom: '20px',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    padding: '0 12px',
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    borderRadius: '8px',
    color: '#a0a0a0',
    textDecoration: 'none',
    fontSize: '14px',
    transition: 'all 0.15s ease',
  },
  navLinkActive: {
    backgroundColor: '#2a2a2a',
    color: '#ffffff',
  },
  navIcon: {
    fontSize: '18px',
  },
  main: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '1fr 320px',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    padding: '24px',
    overflowY: 'auto' as const,
  },
};

// ============================================================================
// Types
// ============================================================================

type LayoutProps = RoutePageProps<typeof appRoutes>;

// ============================================================================
// Component
// ============================================================================

const Layout = ({ getOutlet }: LayoutProps) => {
  const currentPath = useCurrentPath();
  const mountPath = useMountPath();
  const isActive = (path: string) => currentPath.startsWith(mountPath + path);

  const MainOutlet = getOutlet('main');
  const TaskPanelOutlet = getOutlet('taskPanel');

  // Implement the showToast capability for child routes
  const handleShowToast = (params: {
    message: string;
    type: 'success' | 'error' | 'info';
  }) => {
    // For now, just log - in a real app this would show a toast UI
    console.log(`[Toast ${params.type}]: ${params.message}`);
  };

  return (
    <div style={styles.container}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>📋 Workspace</div>
        <nav style={styles.nav}>
          <Link
            to={appRoutes.$paths.boards.getPath({})}
            style={{
              ...styles.navLink,
              ...(isActive(appRoutes.$paths.boards.getPath({}))
                ? styles.navLinkActive
                : {}),
            }}
          >
            <span style={styles.navIcon}>📌</span>
            Boards
          </Link>
          <Link
            to={appRoutes.$paths.channels.getPath({})}
            style={{
              ...styles.navLink,
              ...(isActive(appRoutes.$paths.channels.getPath({}))
                ? styles.navLinkActive
                : {}),
            }}
          >
            <span style={styles.navIcon}>💬</span>
            Chat
          </Link>
          <Link
            to={appRoutes.$paths.blog.getPath({})}
            style={{
              ...styles.navLink,
              ...(isActive(appRoutes.$paths.blog.getPath({}))
                ? styles.navLinkActive
                : {}),
            }}
          >
            <span style={styles.navIcon}>📝</span>
            Blog
          </Link>
        </nav>
      </aside>
      <main style={styles.main}>
        <div style={styles.content}>
          <MainOutlet
            capabilities={{
              showToast: handleShowToast,
            }}
          />
        </div>
        <div style={{ borderLeft: '1px solid #2a2a2a', minHeight: '100%' }}>
          <TaskPanelOutlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
