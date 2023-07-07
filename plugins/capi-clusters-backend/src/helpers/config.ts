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

import { readTaskScheduleDefinitionFromConfig } from '@backstage/backend-tasks';
import { Config } from '@backstage/config';
import { ProviderConfig, ProviderDefaults } from '../types';

const CLUSTERS_PATH = 'kubernetes.clusterLocatorMethods';
const DEFAULT_PROVIDER_ID = 'default';

// Find the configuration for the named Hub cluster in the set of Kubernetes
// clusters declared in the system.
export const getCAPIClusterFromKubernetesConfig = (hubName: string, config: Config): Config => {
  const cluster = config
    .getConfigArray(CLUSTERS_PATH)
    .flatMap(method => method.getOptionalConfigArray('clusters') || [])
    .find(
      listCluster =>
        listCluster.getString('name') === hubName,
    );

  if (!cluster) {
    throw new Error(`CAPI hub cluster ${hubName} not defined in kubernetes config`);
  }

  return cluster;
};

const parseDefaults = (config?: Config): ProviderDefaults | undefined => {
  if (!config) {
    return undefined;
  }

  const clusterOwner = config.getOptionalString('clusterOwner');
  const system = config.getOptionalString('system');
  const lifecycle = config.getOptionalString('lifecycle');
  const tags = config.getOptionalStringArray('tags');

  return {
    clusterOwner,
    system,
    lifecycle,
    tags,
  }
};

const readProviderConfig = (
  id: string,
  config: Config,
): ProviderConfig => {
  const hubClusterName = config.getString('hubClusterName');

  const schedule = config.has('schedule')
    ? readTaskScheduleDefinitionFromConfig(config.getConfig('schedule'))
    : undefined;

  const defaults = parseDefaults(config.getOptionalConfig('defaults'));

  return {
    id,
    hubClusterName,
    schedule,
    defaults,
  };
};

export const readProviderConfigs = (
  config: Config
): ProviderConfig[] => {
  const providersConfig = config.getOptionalConfig('catalog.providers.capi');
  if (!providersConfig) {
    return [];
  }
  if (providersConfig.has('hubClusterName')) {
    return [readProviderConfig(DEFAULT_PROVIDER_ID, providersConfig)];
  }

  return providersConfig.keys().map(name => {
    const providerConfig = providersConfig.getConfig(name);

    return readProviderConfig(name, providerConfig);
  });
};