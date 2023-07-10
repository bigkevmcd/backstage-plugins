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

import { Logger } from 'winston';
import * as uuid from 'uuid';
import { PluginTaskScheduler, TaskRunner } from '@backstage/backend-tasks';
import { ResourceEntity } from '@backstage/catalog-model';
import { Config } from '@backstage/config';
import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import {
  ANNOTATION_ORIGIN_LOCATION,
  ANNOTATION_LOCATION,
} from '@backstage/catalog-model';
import {
  ANNOTATION_CAPI_CLUSTER_DESCRIPTION,
  ANNOTATION_CAPI_CLUSTER_LIFECYCLE,
  ANNOTATION_CAPI_CLUSTER_OWNER,
  ANNOTATION_CAPI_CLUSTER_SYSTEM,
  ANNOTATION_CAPI_CLUSTER_TAGS,
  ANNOTATION_CAPI_PROVIDER
} from '../constants';
import { getKubeConfigForCluster, readProviderConfigs } from '../helpers';
import { getCAPIClusters } from '../helpers';
import { Cluster, ProviderConfig } from '../helpers/types';
import { CoreV1Api, CustomObjectsApi, KubeConfig } from '@kubernetes/client-node';
import { getClusterKubeConfig } from '../helpers';
import { ANNOTATION_KUBERNETES_API_SERVER, ANNOTATION_KUBERNETES_API_SERVER_CA, ANNOTATION_KUBERNETES_AUTH_PROVIDER } from '@backstage/plugin-kubernetes-common';

// CAPI Clustructure infrastructureRef is an ObjectReference which allows Kind to be omitted.
const capiClusterProvider = (cluster: Cluster): string => {
  return cluster.spec.infrastructureRef?.kind ?? '';
};

const clusterName = (cluster: Cluster): string => `${cluster.metadata?.namespace}/${cluster.metadata?.name}`;

const clusterAnnotations = (cluster: Cluster): {
  lifecycle?: string;
  owner?: string,
  description?: string,
  system?: string
  tags?: string[],
} => {
  const lifecycle = cluster.metadata?.annotations?.[ANNOTATION_CAPI_CLUSTER_LIFECYCLE];
  const owner = cluster.metadata?.annotations?.[ANNOTATION_CAPI_CLUSTER_OWNER];
  const description = cluster.metadata?.annotations?.[ANNOTATION_CAPI_CLUSTER_DESCRIPTION];
  const system = cluster.metadata?.annotations?.[ANNOTATION_CAPI_CLUSTER_SYSTEM];
  const tags = cluster.metadata?.annotations?.[ANNOTATION_CAPI_CLUSTER_TAGS]?.split(',').map((s: string) => s.trim());

  return {
    lifecycle,
    owner,
    description,
    system,
    tags,
  }
}

type ProviderOptions = {
  logger: Logger;
  schedule?: TaskRunner;
  scheduler?: PluginTaskScheduler;
};

/**
 * Provides CAPI Cluster resource entities from a Kubernetes Cluster.
 * 
 * Use `CAPIClusterProvider.fromConfig(...)` to create instances.
 */
export class CAPIClusterProvider implements EntityProvider {
  protected readonly customObjectsClient: CustomObjectsApi;
  protected readonly client: CoreV1Api;
  private readonly config: ProviderConfig;
  private readonly logger: Logger;
  private readonly scheduleFn: () => Promise<void>;
  private connection?: EntityProviderConnection;

  static fromConfig(rootConfig: Config, options: ProviderOptions): CAPIClusterProvider[] {
    const providerConfigs = readProviderConfigs(rootConfig);

    if (!options.schedule && !options.scheduler) {
      throw new Error('Either schedule or scheduler must be provided.');
    }

    return providerConfigs.map((providerConfig: ProviderConfig) => {
      if (!options.schedule && !providerConfig.schedule) {
        throw new Error(
          `No schedule provided neither via code nor config for CAPIClusterProvider:${providerConfig.id}.`,
        );
      }

      const taskRunner =
        options.schedule ??
        options.scheduler!.createScheduledTaskRunner(providerConfig.schedule!);


      const kubeConfig = getKubeConfigForCluster(providerConfig.hubClusterName, rootConfig, options.logger)
      const customClient = kubeConfig.makeApiClient(CustomObjectsApi);
      const k8sClient = kubeConfig.makeApiClient(CoreV1Api)


      return new CAPIClusterProvider(providerConfig, customClient, k8sClient, options.logger, taskRunner);
    });
  }

  protected constructor(
    providerConfig: ProviderConfig,
    customClient: CustomObjectsApi,
    client: CoreV1Api,
    logger: Logger,
    taskRunner: TaskRunner,
  ) {
    this.config = providerConfig;
    this.customObjectsClient = customClient;
    this.client = client;
    this.logger = logger;
    this.scheduleFn = this.createScheduleFn(taskRunner);
  }

  private createScheduleFn(taskRunner: TaskRunner): () => Promise<void> {
    return async () => {
      const taskId = `${this.getProviderName()}:refresh`;
      return taskRunner.run({
        id: taskId,
        fn: async () => {
          const logger = this.logger.child({
            class: CAPIClusterProvider.prototype.constructor.name,
            taskId,
            taskInstanceId: uuid.v4(),
          });

          try {
            await this.refresh(logger);
          } catch (error) {
            logger.error(`${this.getProviderName()} refresh failed`, error);
          }
        },
      });
    };
  }

  /** {@inheritdoc @backstage/plugin-catalog-backend#EntityProvider.connect} */
  public async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.scheduleFn();
  }

  /** {@inheritdoc @backstage/plugin-catalog-backend#EntityProvider.getProviderName} */
  getProviderName(): string {
    return `CAPIClusterProvider:${this.config.id}`;
  }

  async refresh(logger: Logger) {
    if (!this.connection) {
      throw new Error('Not initialized');
    }

    logger.info(
      `Providing CAPI Cluster resources from cluster ${this.config.hubClusterName}`,
    );

    const clusters = await getCAPIClusters(this.customObjectsClient);

    const clusterKubeConfigs = clusters.items.map(async (cluster: Cluster): Promise<[string, KubeConfig | undefined]> => {
      this.logger.info(`Getting KubeConfig Secret for ${clusterName(cluster)}`);
      const kubeConfig = await getClusterKubeConfig(
        this.client, `${cluster.metadata?.name}-kubeconfig`, cluster.metadata?.namespace || 'default', this.logger).catch(e => {
          return undefined;
        });

      return [
        clusterName(cluster),
        kubeConfig,
      ];
    });

    const kubeConfigs = new Map(await Promise.all(clusterKubeConfigs));

    const resources: ResourceEntity[] = (
      (clusters) as { items: Cluster[] }
    ).items.map((cluster: Cluster) => {
      const { description, lifecycle, owner, system, tags } = clusterAnnotations(cluster);
      const clusterKubeConfig = kubeConfigs.get(clusterName(cluster));

      const resource: any = {
        kind: 'Resource',
        apiVersion: 'backstage.io/v1beta1',
        metadata: {
          name: cluster.metadata?.name!,
          title: cluster.metadata?.name!,
          description: description,
          annotations: {
            [ANNOTATION_LOCATION]: this.getProviderName(),
            [ANNOTATION_ORIGIN_LOCATION]: this.getProviderName(),
            [ANNOTATION_CAPI_PROVIDER]: capiClusterProvider(cluster),
            [ANNOTATION_KUBERNETES_API_SERVER]: clusterKubeConfig?.clusters[0].server!,
            [ANNOTATION_KUBERNETES_API_SERVER_CA]: clusterKubeConfig?.clusters[0].caData!,
            [ANNOTATION_KUBERNETES_AUTH_PROVIDER]: 'oidc',
          },
          tags: tags || this.config.defaults?.tags,
        },
        spec: {
          owner: (owner || this.config.defaults?.clusterOwner) || 'guest',
          type: 'kubernetes-cluster',
          lifecycle: lifecycle || this.config.defaults?.lifecycle,
          system: system || this.config.defaults?.system,
        },
      };

      if (clusterKubeConfig) {
        resource.metadata.annotations[ANNOTATION_KUBERNETES_API_SERVER] = clusterKubeConfig?.clusters[0].server!;
        resource.metadata.annotations[ANNOTATION_KUBERNETES_API_SERVER_CA] =  clusterKubeConfig?.clusters[0].caData!;
        resource.metadata.annotations[ANNOTATION_KUBERNETES_AUTH_PROVIDER] = 'oidc';
      }

      return resource;
    });

    await this.connection.applyMutation({
      type: 'full',
      entities: resources.map(entity => ({
        entity,
        locationKey: this.getProviderName(),
      })),
    });
  }
}