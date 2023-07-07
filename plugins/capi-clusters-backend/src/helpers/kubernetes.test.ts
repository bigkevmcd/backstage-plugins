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

import { ConfigReader } from '@backstage/config';
import {
    getCustomObjectsApi,
    clusterApiClient,
    getCAPIClusters,
} from './kubernetes';
import { createLogger } from 'winston';
import transports from 'winston/lib/winston/transports';
import { CustomObjectsApi, KubeConfig } from '@kubernetes/client-node';
import nock from 'nock';

const logger = createLogger({
    transports: [new transports.Console({ silent: true })],
});

describe('getCustomObjectsApi', () => {
    it('should use the default config if there is no service account token configured', () => {
        process.env.KUBECONFIG = `${__dirname}/fixtures/kubeconfig.yaml`;
        const clusterConfig = new ConfigReader({
            name: 'cluster1',
        });

        const result = getCustomObjectsApi(clusterConfig, logger);

        expect(result.basePath).toBe('http://example.com');
        // These fields aren't on the type but are there
        const auth = (result as any).authentications.default;
        expect(auth.clusters[0].name).toBe('default-cluster');
        expect(auth.users[0].token).toBeUndefined();
    });

    it('should use the provided config in the returned api client', () => {
        const clusterConfig = new ConfigReader({
            name: 'cluster1',
            serviceAccountToken: 'TOKEN',
            url: 'http://cluster.com',
        });

        const result = getCustomObjectsApi(clusterConfig, logger);

        expect(result.basePath).toBe('http://cluster.com');
        // These fields aren't on the type but are there
        const auth = (result as any).authentications.default;
        expect(auth.clusters[0].name).toBe('cluster1');
        expect(auth.users[0].token).toBe('TOKEN');
    });
});

describe('clusterApiClient', () => {
    it('should return an api client configured with the data from the kubernetes config', () => {
        const config = new ConfigReader({
            kubernetes: {
                clusterLocatorMethods: [
                    {
                        type: 'config',
                        clusters: [
                            {
                                name: 'cluster2',
                                serviceAccountToken: 'TOKEN',
                                url: 'http://cluster2.com',
                            },
                        ],
                    },
                ],
            },
        });

        const result = clusterApiClient('cluster2', config, logger);

        expect(result.basePath).toBe('http://cluster2.com');
        // These fields aren't on the type but are there
        const auth = (result as any).authentications.default;
        expect(auth.clusters[0].name).toBe('cluster2');
    });
});

const kubeConfig = {
    clusters: [{ name: 'cluster', server: 'https://127.0.0.1:51010' }],
    users: [{ name: 'user', password: 'password' }],
    contexts: [{ name: 'currentContext', cluster: 'cluster', user: 'user' }],
    currentContext: 'currentContext',
};

const getApi = () => {
    const kc = new KubeConfig();
    kc.loadFromOptions(kubeConfig);
    return kc.makeApiClient(CustomObjectsApi);
};

describe('getCAPIClusters', () => {
    it('should return some clusters', async () => {
        nock(kubeConfig.clusters[0].server)
            .get('/apis/cluster.x-k8s.io/v1beta1/clusters')
            .reply(200, {
                apiVersion: 'cluster.x-k8s.io/v1beta1',
                items: [
                    {
                        kind: 'Cluster',
                        metadata: {
                            name: 'cluster1',
                        },
                        spec: {
                            paused: true,
                            controlPlaneRef: {
                                kind: 'AWSManagedControlPlane',
                                apiVersion: 'controlplane.cluster.x-k8s.io/v1beta2',
                                name: 'cluster1-control-plane',
                            },
                        },
                    },
                    {
                        kind: 'Cluster',
                        metadata: {
                            name: 'cluster2',
                        },
                        spec: {
                            controlPlaneRef: {
                                kind: 'AWSManagedControlPlane',
                                apiVersion: 'controlplane.cluster.x-k8s.io/v1beta2',
                                name: 'cluster2-control-plane',
                            },
                        },
                    },
                ],
            });

        const result: any = await getCAPIClusters(getApi());

        expect(result.items[0].metadata.name).toBe('cluster1');
        expect(result.items[0].spec).toEqual({
            controlPlaneRef: {
                apiVersion: 'controlplane.cluster.x-k8s.io/v1beta2',
                kind: 'AWSManagedControlPlane',
                name: 'cluster1-control-plane',
            },
            paused: true,
        });
        expect(result.items[1].metadata.name).toBe('cluster2');
        expect(result.items[1].spec).toEqual({
            controlPlaneRef: {
                apiVersion: 'controlplane.cluster.x-k8s.io/v1beta2',
                kind: 'AWSManagedControlPlane',
                name: 'cluster2-control-plane',
            },
        });
    });
});