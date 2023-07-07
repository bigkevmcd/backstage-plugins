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
import express from 'express';
import nock from 'nock';
import request from 'supertest';
import { createLogger, transports } from 'winston';
import { ConfigReader } from '@backstage/config';
import { createRouter } from './router';
import { ANNOTATION_CAPI_CLUSTER_LIFECYCLE } from '../constants';

const logger = createLogger({
  transports: [new transports.Console({ silent: true })],
});

describe('createRouter', () => {
  let app: express.Express;

  beforeAll(async () => {
    jest.resetAllMocks();

    const router = await createRouter({
      logger: logger,
      config: new ConfigReader({
        kubernetes: {
          clusterLocatorMethods: [
            {
              type: 'config',
              clusters: [
                {
                  name: 'test-cluster',
                  serviceAccountToken: 'TOKEN',
                  url: 'http://cluster.example.com',
                },
              ],
            },
          ],
        },
        capi: {
          cluster: 'test-cluster',
        },
      }),
    });

    app = express().use(router);
  });

  describe('GET /status', () => {
    beforeAll(() => {
      nock('http://cluster.example.com')
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
                  controlPlaneReady: false,
                  infrastructureReady: true
              },
            },
          ],
        })
        .persist();
    });

    afterAll(() => {
      nock.cleanAll();
    });

    it('should get all clusters', async () => {
      const result = await request(app).get('/status');

      expect(result.status).toBe(200);
      expect(result.body).toEqual([
        {
          name: 'cluster1',
          namespace: 'clusters',
          cluster: 'test-cluster',
          phase: 'provisioning',
          controlPlaneReady: false,
          infrastructureReady: true
        },
      ]);
    });
  });
});
