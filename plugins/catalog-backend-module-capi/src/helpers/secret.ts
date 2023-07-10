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

import { CoreV1Api, KubeConfig, V1Secret } from '@kubernetes/client-node';
import { Logger } from 'winston';

export const CAPI_CLUSTER_SECRET_TYPE = 'cluster.x-k8s.io/secret';

const decodeBase64 = (str: string): string => Buffer.from(str, 'base64').toString('binary');

export const decodeKubeConfigFromSecret = (secret: V1Secret, logger: Logger): KubeConfig => {
    const decoded = decodeBase64(secret.data?.value ?? '');

    const kc = new KubeConfig();
    try {
        kc.loadFromString(decoded);
    } catch (err: any) {
        logger.info(`caught error ${err}`)
    }

    return kc;
};

/**
 * Query and decode a CAPI cluster secret as a KubeConfig;
 *
 * @public
 * @param client
 * @param name
 * @param namespace
 * @param logger
 * @returns KubeConfig
 */
export const getClusterKubeConfig = async (client: CoreV1Api, name: string, namespace: string, logger: Logger): Promise<KubeConfig> => {
    const { body } = await client.readNamespacedSecret(name, namespace);
    return decodeKubeConfigFromSecret(body, logger);
};

/**
 * Query and decode the CAPI cluster secrets as KubeConfigs.
 * 
 * @public
 * @param client 
 * @param namespace 
 * @param logger 
 * @returns 
 */
export const getClusterKubeConfigs = async (client: CoreV1Api, namespace: string, logger: Logger): Promise<Map<string, KubeConfig>> => {
    const { body } = await client.listNamespacedSecret(namespace);
    const secrets = body.items.filter((secret: V1Secret) => (secret.type ?? '') === CAPI_CLUSTER_SECRET_TYPE);

    const kubeConfigs = new Map();

    secrets.forEach((secret: V1Secret) => {
        const decoded = decodeKubeConfigFromSecret(secret, logger);

        kubeConfigs.set((secret.metadata?.name ?? 'unknown'), decoded);
    });

    return kubeConfigs;
};