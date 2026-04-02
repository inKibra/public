/** @jsxImportSource react */

import type { RoutePageProps } from '@inkibra/router';
import type { devAppRoutes } from '../route-tree';
import DevIndexPage from './index';

type LayoutProps = RoutePageProps<typeof devAppRoutes>;

const DevLayout = ({
  getOutlet,
  emptyOutlets,
  apiImplementations,
}: LayoutProps) => {
  const MainOutlet = getOutlet('main');
  const isRoot = emptyOutlets?.includes('main');

  return (
    <div
      style={{
        background: '#0a0a0a',
        color: '#e0e0e0',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      {isRoot ? (
        <DevIndexPage apiImplementations={apiImplementations} />
      ) : (
        <MainOutlet />
      )}
    </div>
  );
};

export default DevLayout;
