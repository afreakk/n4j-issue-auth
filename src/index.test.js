import {readFileSync} from 'fs';
import {ApolloServer} from '@apollo/server';
import {join} from 'path';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {it, describe, expect, test} from 'vitest';
import {gql} from '@apollo/client/core';
import neo4j from 'neo4j-driver';
const driver = neo4j.driver(
    process.env.NEO4J_DATABASE_HOST,
    neo4j.auth.basic(process.env.NEO4J_DATABASE_USERNAME, process.env.NEO4J_DATABASE_PASSWORD)
);
const laterResolvedValues = (type) => {
    const values = {};
    const get = (key) => {
        return values[key];
    };
    const set = (key, value) => {
        values[key] = value;
        expect(values[key]).toBeTypeOf(type);
    };
    return {set, get};
};

const features = {
    populatedBy: {
        callbacks: {
            getUserIDFromContext: (_parent, _args, context) => {
                const userId = context.jwt?.id;
                if (typeof userId === 'string') {
                    return userId;
                }
                return undefined;
            },
        },
    },
};
describe('testing graphql', async () => {
    await driver.session().run(` match (n) detach delete n`);
    const myUserId = Math.random().toString(36).slice(2, 7);
    const neo4jGraphql = new Neo4jGraphQL({typeDefs: readFileSync(join(__dirname, 'schema.graphql'), 'utf8').toString(), driver, features});
    const apolloServer = new ApolloServer({
        schema: await neo4jGraphql.getSchema(),
        introspection: true,
    });
    const l = laterResolvedValues('string');
    it('create tenant', async () => {
        const ADD_TENANT = gql`
            mutation addTenant($input: [TenantCreateInput!]!) {
                createTenants(input: $input) {
                    tenants {
                        id
                        admins {
                            userId
                        }
                        settings {
                            id
                        }
                    }
                }
            }
        `;
        const tenantVariables = {
            input: {
                admins: {
                    create: {
                        node: {userId: myUserId},
                    },
                },
                settings: {
                    create: {
                        node: {
                            openingDays: {
                                create: [
                                    {
                                        node: {
                                            name: 'MONDAY',
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        };
        const r = await apolloServer.executeOperation(
            {query: ADD_TENANT, variables: tenantVariables},
            {contextValue: {jwt: {id: myUserId, roles: ['overlord']}}}
        );
        expect(r).toMatchObject({
            body: {
                singleResult: {
                    data: {
                        createTenants: {
                            tenants: [
                                {id: expect.any(String), admins: [{userId: myUserId}]},
                            ],
                        },
                    },
                },
            },
        });
        console.log(r.body.singleResult.data.createTenants.tenants[0].settings.id)
        // l.set('tenantId', r.body.singleResult.data.createTenants.tenants[0].id);
        l.set('userId', r.body.singleResult.data.createTenants.tenants[0].admins[0].userId);
        l.set('settingsId', r.body.singleResult.data.createTenants.tenants[0].settings.id);
    });
    // it('create openingDay', async () => {
    //     const ADD_OPENING_DAYS = gql`
    //         mutation addOpeningDays($input: [OpeningDayCreateInput!]!) {
    //             createOpeningDays(input: $input) {
    //                 openingDays {
    //                     id
    //                 }
    //             }
    //         }
    //     `;
    //     const openingDayInput = {
    //         settings: {
    //             connect: {
    //                 where: {
    //                     node: {
    //                         id: l.get('settingsId'),
    //                     },
    //                 },
    //             },
    //         },
    //     };
    //     const r = await apolloServer.executeOperation(
    //         {query: ADD_OPENING_DAYS, variables: {input: openingDayInput}},
    //         {contextValue: {jwt: {id: l.get('userId')}}}
    //     );
    //     expect(r).toMatchObject({
    //         body: {
    //             singleResult: {data: {createOpeningDays: {openingDays: [{id: expect.any(String)}]}}},
    //         }
    //     });
    //     l.set('openingDayId', r.body.singleResult.data.createOpeningDays.openingDays[0].id);
    // });
})
