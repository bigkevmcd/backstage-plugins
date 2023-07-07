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
import { CustomObjectsApi, KubeConfig, KubernetesListObject } from '@kubernetes/client-node';
import { Logger } from 'winston';
import { getCAPIClusterFromKubernetesConfig } from './config';
import { Cluster } from '../types';
import { kubeApiResponseHandler } from './utils';

export const getCustomObjectsApi = (
  clusterConfig: Config,
  logger: Logger,
): CustomObjectsApi => {
  const clusterToken = clusterConfig.getOptionalString('serviceAccountToken');
  const kubeConfig = new KubeConfig();

  if (!clusterToken) {
    logger.info('Using default kubernetes config');
    kubeConfig.loadFromDefault();
    return kubeConfig.makeApiClient(CustomObjectsApi);
  }

  logger.info('Loading kubernetes config from config file');
  const cluster = {
    name: clusterConfig.getString('name'),
    server: clusterConfig.getString('url'),
    skipTLSVerify: clusterConfig.getOptionalBoolean('skipTLSVerify') ?? false,
    caData: clusterConfig.getOptionalString('caData'),
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

  return kubeConfig.makeApiClient(CustomObjectsApi);
};

/**
 * Get a client that can be used to communicate with the cluster that contains CAPI clusters.
 * @param config 
 * @param logger 
 * @returns CustomObjectsApi that can be used to communicate with the Hub.
 */
export const clusterApiClient = (hubClusterName: string, config: Config, logger: Logger) => {
  const clusterConfig = getCAPIClusterFromKubernetesConfig(hubClusterName, config);
  
  return getCustomObjectsApi(clusterConfig, logger);
};

/**
 * 
 * @param api Query the CAPI clusters using the provided Client.
 * @returns 
 */
export const getCAPIClusters = (api: CustomObjectsApi) => {
  return kubeApiResponseHandler<KubernetesListObject<Cluster>>(
    api.listClusterCustomObject(
      'cluster.x-k8s.io',
      'v1beta1',
      'clusters',
    ),
  );
};