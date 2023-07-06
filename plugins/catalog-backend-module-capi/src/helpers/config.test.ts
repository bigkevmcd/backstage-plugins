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
    getCAPIClusterFromKubernetesConfig,
    readProviderConfigs,
} from './config';

const createConfigParseResult = (data: object, prefix: string) => ({
    data: data,
    context: 'mock-config',
    prefix: prefix,
    fallback: undefined,
    filteredKeys: undefined,
    notifiedFilteredKeys: new Set(),
});

describe('getCAPIClusterFromKubernetesConfig', () => {
    it('should get the correct hub cluster from multiple configured clusters', () => {
        const config = new ConfigReader({
            kubernetes: {
                clusterLocatorMethods: [
                    {
                        type: 'config',
                        clusters: [
                            {
                                name: 'cluster1',
                            },
                            {
                                name: 'cluster2',
                            },
                            {
                                name: 'cluster3',
                            },
                        ],
                    },
                ],
            },
        });

        const result = getCAPIClusterFromKubernetesConfig('cluster2', config);

        expect(result).toEqual(
            createConfigParseResult(
                {
                    name: 'cluster2',
                },
                'kubernetes.clusterLocatorMethods[0].clusters[1]',
            ),
        );
    });

    it('should throw an error when the hub cluster is not found in kubernetes config', () => {
        const config = new ConfigReader({
            kubernetes: {
                clusterLocatorMethods: [
                    {
                        type: 'config',
                        clusters: [
                            {
                                name: 'cluster4',
                            },
                        ],
                    },
                ],
            },
        });

        const result = () => getCAPIClusterFromKubernetesConfig('cluster2', config);

        expect(result).toThrow('CAPI hub cluster cluster2 not defined in kubernetes confi');
    });


    it('should throw an error when there are no cluster configured', () => {
        const config = new ConfigReader({
            kubernetes: {
                clusterLocatorMethods: [
                    {
                        type: 'config',
                    },
                ],
            },
        });

        const result = () => getCAPIClusterFromKubernetesConfig('cluster2', config);

        expect(result).toThrow('CAPI hub cluster cluster2 not defined in kubernetes config');
    });

    it('should throw an error when there is no kubernetes config', () => {
        const config = new ConfigReader({});

        const result = () => getCAPIClusterFromKubernetesConfig('test-cluster', config);

        expect(result).toThrow(
            "Missing required config value at 'kubernetes.clusterLocatorMethods'",
        );
    });
});

describe('readProviderConfigs', () => {
    describe('when there is no configuration provided', () => {
        it('reads no configuration', () => {
            const providerConfigs = readProviderConfigs(new ConfigReader({}));

            expect(providerConfigs).toHaveLength(0);
        });
    });

    describe('when a single configuration is provided', () => {
        it('reads a single provider configuration', () => {
            const config = new ConfigReader({
                catalog: {
                    providers: {
                        capi: {
                            hubClusterName: 'demo-cluster',
                            defaults: {
                                clusterOwner: 'group:team-lucky',
                            },
                        },
                    },
                },
            });

            const providerConfigs = readProviderConfigs(config);

            expect(providerConfigs).toEqual([
                {
                    hubClusterName: 'demo-cluster',
                    id: 'default',
                    defaults: {
                        clusterOwner: 'group:team-lucky',
                    },
                }
            ]);
        });
    });

    describe('when multiple configurations are provided', () => {
        it('reads multiple provider configurations', () => {
            const config = new ConfigReader({
                catalog: {
                    providers: {
                        capi: {
                            default: {
                                hubClusterName: 'default',
                                defaults: {
                                    clusterOwner: 'group:team-lucky',
                                },
                            },
                            cluster1: {
                                hubClusterName: 'eu-cluster',
                                defaults: {
                                    clusterOwner: 'group:team-notso',
                                },
                            },
                        },
                    },
                },
            });

            const providerConfigs = readProviderConfigs(config);

            expect(providerConfigs).toEqual([
                {
                    hubClusterName: 'default',
                    id: 'default',
                    defaults: {
                        clusterOwner: 'group:team-lucky',
                    },
                },
                {
                    hubClusterName: 'eu-cluster',
                    id: 'cluster1',
                    defaults: {
                        clusterOwner: 'group:team-notso',
                    },
                }
            ]);
        });
    });
});