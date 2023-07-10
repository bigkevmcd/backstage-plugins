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
    getCAPIClusters, getKubeConfigForCluster,
} from './kubernetes';
import { createLogger } from 'winston';
import transports from 'winston/lib/winston/transports';
import { CustomObjectsApi, KubeConfig } from '@kubernetes/client-node';
import nock from 'nock';

const logger = createLogger({
    transports: [new transports.Console({ silent: true })],
});

describe('getKubeConfigForCluster', () => {
    it('gets the configured cluster details', () => {
        const config = new ConfigReader({
            kubernetes: {
                clusterLocatorMethods: [
                    {
                        type: 'config',
                        clusters: [
                            {
                                name: 'cluster1',
                                serviceAccountToken: 'ABCDEFG',
                                url: 'http://192.168.0.5:9000/',
                                caData: 'TESTING-CA',
                            },
                        ],
                    },
                ],
            },
        });

        const kubeConfig = getKubeConfigForCluster('cluster1', config, logger);

        expect(kubeConfig.contexts).toEqual([
            {
                cluster: 'cluster1',
                name: 'cluster1',
                user: 'backstage',
            },
        ]);
        expect(kubeConfig.clusters).toEqual([
            {
                caData: 'TESTING-CA',
                name: 'cluster1',
                server: 'http://192.168.0.5:9000/',
                skipTLSVerify: false,
            },
        ]);
        expect(kubeConfig.currentContext).toEqual('cluster1');
        expect(kubeConfig.contexts).toEqual([
            {
                cluster: 'cluster1',
                name: 'cluster1',
                user: 'backstage',
            },
        ]);
        expect(kubeConfig.users).toEqual([
            {
                name: 'backstage',
                token: 'ABCDEFG',
            },
        ]);
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