/*
 * Copyright 2023 Kevin McDermott
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createLogger, transports } from 'winston';
import { PluginTaskScheduler, TaskRunner } from '@backstage/backend-tasks';
import { ConfigReader } from '@backstage/config';
import { EntityProviderConnection } from '@backstage/plugin-catalog-node';
import {
    ANNOTATION_ORIGIN_LOCATION,
    ANNOTATION_LOCATION,
} from '@backstage/catalog-model';
import { CAPIClusterProvider } from './CAPIClusterProvider';
import { ANNOTATION_CAPI_CLUSTER_DESCRIPTION, ANNOTATION_CAPI_CLUSTER_LIFECYCLE, ANNOTATION_CAPI_CLUSTER_OWNER, ANNOTATION_CAPI_CLUSTER_SYSTEM, ANNOTATION_CAPI_CLUSTER_TAGS, ANNOTATION_CAPI_PROVIDER } from '../constants';
import nock from 'nock';

const logger = createLogger({
    transports: [new transports.Console({ silent: true })],
});

const schedule: TaskRunner = {
    run: jest.fn(),
};

const entityProviderConnection: EntityProviderConnection = {
    applyMutation: jest.fn(),
    refresh: jest.fn(),
};

describe('CAPIClusterProvider', () => {
    afterEach(() => {
        jest.resetAllMocks();
        nock.cleanAll()
    });

    const config = new ConfigReader({
        kubernetes: {
            clusterLocatorMethods: [
                {
                    type: 'config',
                    clusters: [
                        {
                            name: 'cluster1',
                            serviceAccountToken: 'TOKEN',
                            url: 'http://cluster.example.com',
                        },
                    ],
                },
            ],
        },
        catalog: {
            providers: {
                capi: {
                    hubClusterName: 'cluster1',
                    defaults: {
                        clusterOwner: 'group:test-team',
                    },
                    schedule: {
                        frequency: { hours: 1 },
                        timeout: { minutes: 50 },
                        initialDelay: { seconds: 15 },
                    },
                },
            },
        },
    });

    it('fails without schedule and scheduler', () => {
        expect(() =>
            CAPIClusterProvider.fromConfig(config, {
                logger,
            }),
        ).toThrow('Either schedule or scheduler must be provided.');
    });

    it('fails with scheduler but no schedule config', () => {
        const scheduler = jest.fn() as unknown as PluginTaskScheduler;
        const badConfig = new ConfigReader({
            catalog: {
                providers: {
                    capi: {
                        hubClusterName: 'cluster1',
                        defaults: {
                            clusterOwner: 'test-team',
                        },
                    },
                },
            },
        });

        expect(() =>
            CAPIClusterProvider.fromConfig(badConfig, {
                logger,
                scheduler,
            }),
        ).toThrow(
            'No schedule provided neither via code nor config for CAPIClusterProvider:default.',
        );
    });

    describe('where there are no clusters', () => {
        it('creates no clusters', async () => {
            const scope = nock('http://cluster.example.com')
                .get('/apis/cluster.x-k8s.io/v1beta1/clusters')
                .reply(200, {
                    items: []
                });

            const provider = CAPIClusterProvider.fromConfig(config, { logger, schedule })[0];
            provider.connect(entityProviderConnection);

            await provider.refresh(logger);

            expect(entityProviderConnection.applyMutation).toHaveBeenCalledWith({
                type: 'full',
                entities: [],
            });

            expect(scope.isDone()).toBeTruthy();
        });
    });

    describe('where there are clusters', () => {
        it('creates clusters', async () => {
            const scope = nock('http://cluster.example.com')
                .get('/apis/cluster.x-k8s.io/v1beta1/clusters')
                .reply(200, {
                    apiVersion: 'cluster.x-k8s.io/v1beta1',
                    items: [
                        {
                            kind: 'Cluster',
                            metadata: {
                                name: 'cluster1',
                                namespace: 'clusters',
                                annotations: {
                                    [ANNOTATION_CAPI_CLUSTER_LIFECYCLE]: 'production',
                                }
                            },
                            spec: {
                                controlPlaneRef: {
                                    apiVersion: 'controlplane.cluster.x-k8s.io/v1beta2',
                                    kind: 'AWSManagedControlPlane',
                                    name: 'test-cluster-control-plane'
                                },
                                infrastructureRef: {
                                    apiVersion: 'infrastructure.cluster.x-k8s.io/v1beta2',
                                    kind: 'AWSManagedCluster',
                                    name: 'test-cluster'
                                },
                            },
                            status: {
                                phase: 'provisioning',
                            }
                        },
                    ],
                });

            const provider = CAPIClusterProvider.fromConfig(config, { logger, schedule })[0];
            provider.connect(entityProviderConnection);

            await provider.refresh(logger);

            expect(entityProviderConnection.applyMutation).toHaveBeenCalledWith({
                type: 'full',
                entities: [
                    {
                        locationKey: 'CAPIClusterProvider:default',
                        entity: {
                            apiVersion: 'backstage.io/v1beta1',
                            kind: 'Resource',
                            metadata: {
                                title: 'cluster1',
                                name: 'cluster1',
                                annotations: {
                                    [ANNOTATION_LOCATION]: 'CAPIClusterProvider:default',
                                    [ANNOTATION_ORIGIN_LOCATION]: 'CAPIClusterProvider:default',
                                    [ANNOTATION_CAPI_PROVIDER]: 'AWSManagedCluster',
                                },
                            },
                            spec: {
                                owner: 'group:test-team',
                                type: 'kubernetes-cluster',
                                lifecycle: 'production',
                            },
                        },
                    },
                ],
            });

            expect(scope.isDone()).toBeTruthy();
        });

        it('extracts the annotations from the CAPI Cluster', async () => {
            const scope = nock('http://cluster.example.com')
                .get('/apis/cluster.x-k8s.io/v1beta1/clusters')
                .reply(200, {
                    apiVersion: 'cluster.x-k8s.io/v1beta1',
                    items: [
                        {
                            kind: 'Cluster',
                            metadata: {
                                name: 'cluster1',
                                namespace: 'clusters',
                                annotations: {
                                    [ANNOTATION_CAPI_CLUSTER_LIFECYCLE]: 'production',
                                    [ANNOTATION_CAPI_CLUSTER_OWNER]: 'group:pet-managers',
                                    [ANNOTATION_CAPI_CLUSTER_DESCRIPTION]: 'This is the production Cluster',
                                    [ANNOTATION_CAPI_CLUSTER_SYSTEM]: 'demo-system',
                                    [ANNOTATION_CAPI_CLUSTER_TAGS]: 'tag1,tag2,tag3',
                                }
                            },
                            spec: {
                                controlPlaneRef: {
                                    apiVersion: 'controlplane.cluster.x-k8s.io/v1beta2',
                                    kind: 'AWSManagedControlPlane',
                                    name: 'test-cluster-control-plane'
                                },
                                infrastructureRef: {
                                    apiVersion: 'infrastructure.cluster.x-k8s.io/v1beta2',
                                    kind: 'AWSManagedCluster',
                                    name: 'test-cluster'
                                },
                            },
                            status: {
                                phase: 'provisioning',
                            }
                        },
                    ],
                });

            const provider = CAPIClusterProvider.fromConfig(config, { logger, schedule })[0];
            provider.connect(entityProviderConnection);

            await provider.refresh(logger);

            expect(entityProviderConnection.applyMutation).toHaveBeenCalledWith({
                type: 'full',
                entities: [
                    {
                        locationKey: 'CAPIClusterProvider:default',
                        entity: {
                            apiVersion: 'backstage.io/v1beta1',
                            kind: 'Resource',
                            metadata: {
                                title: 'cluster1',
                                name: 'cluster1',
                                description: 'This is the production Cluster',
                                annotations: {
                                    [ANNOTATION_LOCATION]: 'CAPIClusterProvider:default',
                                    [ANNOTATION_ORIGIN_LOCATION]: 'CAPIClusterProvider:default',
                                    [ANNOTATION_CAPI_PROVIDER]: 'AWSManagedCluster',
                                },
                                tags: [
                                    'tag1',
                                    'tag2',
                                    'tag3',
                                ],
                            },
                            spec: {
                                owner: 'group:pet-managers',
                                type: 'kubernetes-cluster',
                                lifecycle: 'production',
                                system: 'demo-system',
                            },
                        },
                    },
                ],
            });

            expect(scope.isDone()).toBeTruthy();
        });
    });

    it('applies the defaults from the provider configuration', async () => {
        const scope = nock('http://cluster.example.com')
            .get('/apis/cluster.x-k8s.io/v1beta1/clusters')
            .reply(200, {
                apiVersion: 'cluster.x-k8s.io/v1beta1',
                items: [
                    {
                        kind: 'Cluster',
                        metadata: {
                            name: 'cluster1',
                            namespace: 'clusters',
                        },
                        spec: {
                            controlPlaneRef: {
                                apiVersion: 'controlplane.cluster.x-k8s.io/v1beta2',
                                kind: 'AWSManagedControlPlane',
                                name: 'test-cluster-control-plane'
                            },
                            infrastructureRef: {
                                apiVersion: 'infrastructure.cluster.x-k8s.io/v1beta2',
                                kind: 'AWSManagedCluster',
                                name: 'test-cluster'
                            },
                        },
                        status: {
                            phase: 'provisioning',
                        }
                    },
                ],
            });

        const configWithDefaults = new ConfigReader({
            kubernetes: {
                clusterLocatorMethods: [
                    {
                        type: 'config',
                        clusters: [
                            {
                                name: 'cluster1',
                                serviceAccountToken: 'TOKEN',
                                url: 'http://cluster.example.com',
                            },
                        ],
                    },
                ],
            },
            catalog: {
                providers: {
                    capi: {
                        hubClusterName: 'cluster1',
                        schedule: {
                            frequency: { hours: 1 },
                            timeout: { minutes: 50 },
                            initialDelay: { seconds: 15 },
                        },
                        defaults: {
                            clusterOwner: 'group:test-team',
                            lifecycle: 'staging',
                            system: 'test-system',
                            tags: ['tag1', 'tag2', 'tag3'],
                        },
                    },
                },
            },
        });

        const provider = CAPIClusterProvider.fromConfig(configWithDefaults, { logger, schedule })[0];
        provider.connect(entityProviderConnection);

        await provider.refresh(logger);

        expect(entityProviderConnection.applyMutation).toHaveBeenCalledWith({
            type: 'full',
            entities: [
                {
                    locationKey: 'CAPIClusterProvider:default',
                    entity: {
                        apiVersion: 'backstage.io/v1beta1',
                        kind: 'Resource',
                        metadata: {
                            title: 'cluster1',
                            name: 'cluster1',
                            annotations: {
                                [ANNOTATION_LOCATION]: 'CAPIClusterProvider:default',
                                [ANNOTATION_ORIGIN_LOCATION]: 'CAPIClusterProvider:default',
                                [ANNOTATION_CAPI_PROVIDER]: 'AWSManagedCluster',
                            },
                            tags: [
                                'tag1',
                                'tag2',
                                'tag3',
                            ],
                        },
                        spec: {
                            owner: 'group:test-team',
                            type: 'kubernetes-cluster',
                            lifecycle: 'staging',
                            system: 'test-system',
                        },
                    },
                },
            ],
        });

        expect(scope.isDone()).toBeTruthy();
    });
});