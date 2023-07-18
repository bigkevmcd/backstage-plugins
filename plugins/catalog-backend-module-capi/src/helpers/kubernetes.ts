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

import { Config } from '@backstage/config';
import {
  CustomObjectsApi,
  KubeConfig,
  KubernetesListObject,
} from '@kubernetes/client-node';
import { Logger } from 'winston';
import { getClusterConfigByName } from './config';
import { Cluster } from './types';
import { kubeApiResponseHandler } from './utils';

const newKubeConfigFromConfig = (
  config: Config,
  logger: Logger,
): KubeConfig => {
  const clusterToken = config.getOptionalString('serviceAccountToken');
  const kubeConfig = new KubeConfig();

  if (!clusterToken) {
    logger.info('Using default kubernetes config');
    kubeConfig.loadFromDefault();
    return kubeConfig;
  }

  logger.info('Loading kubernetes config from config file');
  const cluster = {
    name: config.getString('name'),
    server: config.getString('url'),
    skipTLSVerify: config.getOptionalBoolean('skipTLSVerify') ?? false,
    caData: config.getOptionalString('caData'),
  };

  const user = {
    name: 'backstage',
    token: clusterToken,
  };

  const context = {
    name: cluster.name,
    user: user.name,
    cluster: cluster.name,
  };

  kubeConfig.loadFromOptions({
    clusters: [cluster],
    users: [user],
    contexts: [context],
    currentContext: context.name,
  });

  return kubeConfig;
};

/**
 * Get a KubeConfig for the named cluster from the clusterLocator data.
 * @param name name of the cluster to get a KubeConfig for
 * @param rootConfig the Config to parse the data from
 * @param logger
 * @returns KubeConfig usable to access the cluster
 */

export const getKubeConfigForCluster = (
  name: string,
  rootConfig: Config,
  logger: Logger,
): KubeConfig => {
  const clusterConfig = getClusterConfigByName(name, rootConfig);

  return newKubeConfigFromConfig(clusterConfig, logger);
};

/**
 *
 * @param api Query the CAPI clusters using the provided Client.
 * @returns
 */
export const getCAPIClusters = (api: CustomObjectsApi) => {
  return kubeApiResponseHandler<KubernetesListObject<Cluster>>(
    api.listClusterCustomObject('cluster.x-k8s.io', 'v1beta1', 'clusters'),
  );
};
