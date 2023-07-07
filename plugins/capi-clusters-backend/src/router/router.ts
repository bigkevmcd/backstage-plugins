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
import { errorHandler } from '@backstage/backend-common';
import { Config } from '@backstage/config';
import express from 'express';
import Router from 'express-promise-router';
import { Logger } from 'winston';
import { clusterApiClient, getCAPIClusterName, getCAPIClusters } from '../helpers';
import { Cluster, ClusterStatus } from '../types';

export interface RouterOptions {
  logger: Logger;
  config: Config;
}

const parseClusterStatus = (sourceCluster: string, cluster: Cluster): ClusterStatus => {
  return {
    name: cluster.metadata?.name ?? '',
    namespace: cluster.metadata?.namespace ?? '',
    cluster: sourceCluster,
    phase: cluster.status?.phase,
    controlPlaneReady: cluster.status?.controlPlaneReady ?? false,
    infrastructureReady: cluster.status?.infrastructureReady ?? false,
  }
};

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { logger, config } = options;
  
  const sourceClusterName = getCAPIClusterName(config);
  const api = clusterApiClient(config, logger);

  const router = Router();
  router.use(express.json());

  router.get('/status', (_, response) => {
    logger.debug(`Listing all clusters`);

    return (getCAPIClusters(api) as Promise<any>).then(resp => {
      response.send(
        resp.items.map((cluster: Cluster) => {
          return parseClusterStatus(sourceClusterName, cluster);
        }),
      );
    });
  });

  router.use(errorHandler({ logClientErrors: true }));

  return router;
}
