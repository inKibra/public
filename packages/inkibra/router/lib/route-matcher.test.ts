import { describe, expect, test } from 'bun:test';
import { createAppRouteTree } from './app-routes';
import { matchAppRoute } from './route-matcher';
import { strategy } from './strategy';

const NoopComponent = () => null;
const NoopRef = strategy.sync(async () => ({
  default: NoopComponent,
}));

function getSegmentBranch(
  branch: ReturnType<typeof matchAppRoute>['outlets'][string | symbol],
) {
  if (!branch || branch.kind !== 'segment') {
    throw new Error('Expected segment branch');
  }
  return branch;
}

function getLeafBranch(
  branch: ReturnType<typeof matchAppRoute>['outlets'][string | symbol],
) {
  if (!branch || branch.kind !== 'leaf') {
    throw new Error('Expected leaf branch');
  }
  return branch;
}

describe('matchAppRoute param inheritance', () => {
  test('inherits parent params into nested outlet leaf', () => {
    const routes = createAppRouteTree({})
      .page({ component: NoopRef })
      .outlets((o) => ({
        main: o.outlet('main').segments((s) => ({
          personas: s
            .segment('personas')
            .page({ component: NoopRef })
            .outlets((o) => ({
              main: o.outlet('main').segments((s) => ({
                ':personaId': s
                  .segment(':personaId')
                  .page({ component: NoopRef })
                  .outlets((o) => ({
                    main: o.outlet('main').segments((s) => ({
                      studio: s.leaf('studio').page({ component: NoopRef }),
                    })),
                  })),
              })),
            })),
        })),
      }));

    const result = matchAppRoute(
      routes,
      new URL('https://example.com/personas/p123/studio'),
    );

    const personasBranch = getSegmentBranch(result.outlets.main ?? null);
    const personaBranch = getSegmentBranch(personasBranch.outlets.main ?? null);
    const studioBranch = getLeafBranch(personaBranch.outlets.main ?? null);

    expect(studioBranch.params.personaId).toBe('p123');
  });

  test('inherits all ancestor params into deeply nested leaf', () => {
    const routes = createAppRouteTree({})
      .page({ component: NoopRef })
      .outlets((o) => ({
        main: o.outlet('main').segments((s) => ({
          orgs: s
            .segment('orgs')
            .page({ component: NoopRef })
            .outlets((o) => ({
              main: o.outlet('main').segments((s) => ({
                ':orgId': s
                  .segment(':orgId')
                  .page({ component: NoopRef })
                  .outlets((o) => ({
                    main: o.outlet('main').segments((s) => ({
                      personas: s
                        .segment('personas')
                        .page({ component: NoopRef })
                        .outlets((o) => ({
                          main: o.outlet('main').segments((s) => ({
                            ':personaId': s
                              .segment(':personaId')
                              .page({ component: NoopRef })
                              .outlets((o) => ({
                                main: o.outlet('main').segments((s) => ({
                                  lab: s
                                    .leaf('lab')
                                    .page({ component: NoopRef }),
                                })),
                              })),
                          })),
                        })),
                    })),
                  })),
              })),
            })),
        })),
      }));

    const result = matchAppRoute(
      routes,
      new URL('https://example.com/orgs/o42/personas/p987/lab'),
    );

    const orgsBranch = getSegmentBranch(result.outlets.main ?? null);
    const orgBranch = getSegmentBranch(orgsBranch.outlets.main ?? null);
    const personasBranch = getSegmentBranch(orgBranch.outlets.main ?? null);
    const personaBranch = getSegmentBranch(personasBranch.outlets.main ?? null);
    const labBranch = getLeafBranch(personaBranch.outlets.main ?? null);

    expect(labBranch.params.orgId).toBe('o42');
    expect(labBranch.params.personaId).toBe('p987');
  });
});
