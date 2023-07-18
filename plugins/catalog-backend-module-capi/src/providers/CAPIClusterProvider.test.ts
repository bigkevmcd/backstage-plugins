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

import { createLogger, transports } from 'winston';
import { PluginTaskScheduler, TaskRunner } from '@backstage/backend-tasks';
import { ConfigReader } from '@backstage/config';
import { EntityProviderConnection } from '@backstage/plugin-catalog-node';
import {
  ANNOTATION_ORIGIN_LOCATION,
  ANNOTATION_LOCATION,
} from '@backstage/catalog-model';
import {
  ANNOTATION_KUBERNETES_API_SERVER,
  ANNOTATION_KUBERNETES_API_SERVER_CA,
  ANNOTATION_KUBERNETES_AUTH_PROVIDER,
} from '@backstage/plugin-kubernetes-common';
import { CAPIClusterProvider } from './CAPIClusterProvider';
import {
  ANNOTATION_CAPI_CLUSTER_DESCRIPTION,
  ANNOTATION_CAPI_CLUSTER_LIFECYCLE,
  ANNOTATION_CAPI_CLUSTER_OWNER,
  ANNOTATION_CAPI_CLUSTER_SYSTEM,
  ANNOTATION_CAPI_CLUSTER_TAGS,
  ANNOTATION_CAPI_PROVIDER,
} from '../constants';
import nock from 'nock';
import { CAPI_CLUSTER_SECRET_TYPE } from '../helpers';

const logger = createLogger({
  transports: [new transports.Console({ silent: true })],
});

const schedule: TaskRunner = {
  run: jest.fn(),
};

const entityProviderConnection: EntityProviderConnection = {
  applyMutation: jest.fn(),
  refresh: jest.fn(),
};

describe('CAPIClusterProvider', () => {
  afterEach(() => {
    jest.resetAllMocks();
    nock.cleanAll();
  });

  const config = new ConfigReader({
    kubernetes: {
      clusterLocatorMethods: [
        {
          type: 'config',
          clusters: [
            {
              name: 'cluster1',
              serviceAccountToken: 'TOKEN',
              url: 'http://cluster.example.com',
            },
          ],
        },
      ],
    },
    catalog: {
      providers: {
        capi: {
          hubClusterName: 'cluster1',
          defaults: {
            clusterOwner: 'group:test-team',
          },
          schedule: {
            frequency: { hours: 1 },
            timeout: { minutes: 50 },
            initialDelay: { seconds: 15 },
          },
        },
      },
    },
  });

  it('fails without schedule and scheduler', () => {
    expect(() =>
      CAPIClusterProvider.fromConfig(config, {
        logger,
      }),
    ).toThrow('Either schedule or scheduler must be provided.');
  });

  it('fails with scheduler but no schedule config', () => {
    const scheduler = jest.fn() as unknown as PluginTaskScheduler;
    const badConfig = new ConfigReader({
      catalog: {
        providers: {
          capi: {
            hubClusterName: 'cluster1',
            defaults: {
              clusterOwner: 'test-team',
            },
          },
        },
      },
    });

    expect(() =>
      CAPIClusterProvider.fromConfig(badConfig, {
        logger,
        scheduler,
      }),
    ).toThrow(
      'No schedule provided neither via code nor config for CAPIClusterProvider:default.',
    );
  });

  describe('where there are no clusters', () => {
    it('creates no clusters', async () => {
      const scope = nock('http://cluster.example.com')
        .get('/apis/cluster.x-k8s.io/v1beta1/clusters')
        .reply(200, {
          items: [],
        });

      const provider = CAPIClusterProvider.fromConfig(config, {
        logger,
        schedule,
      })[0];
      provider.connect(entityProviderConnection);

      await provider.refresh(logger);

      expect(entityProviderConnection.applyMutation).toHaveBeenCalledWith({
        type: 'full',
        entities: [],
      });

      expect(scope.isDone()).toBeTruthy();
    });
  });

  describe('where there are clusters', () => {
    it('creates clusters', async () => {
      const scope = nock('http://cluster.example.com')
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
                },
              },
              spec: {
                controlPlaneRef: {
                  apiVersion: 'controlplane.cluster.x-k8s.io/v1beta2',
                  kind: 'AWSManagedControlPlane',
                  name: 'test-cluster-control-plane',
                },
                infrastructureRef: {
                  apiVersion: 'infrastructure.cluster.x-k8s.io/v1beta2',
                  kind: 'AWSManagedCluster',
                  name: 'test-cluster',
                },
              },
              status: {
                phase: 'provisioning',
              },
            },
          ],
        })
        .get('/api/v1/namespaces/clusters/secrets/cluster1-kubeconfig')
        .reply(200, {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: {
            name: 'cluster1-kubeconfig',
            namespace: 'clusters',
          },
          data: {
            value:
              'YXBpVmVyc2lvbjogdjEKY2x1c3RlcnM6Ci0gY2x1c3RlcjoKICAgIGNlcnRpZmljYXRlLWF1dGhvcml0eS1kYXRhOiBMUzB0TFMxQ1JVZEpUaUJEUlZKVVNVWkpRMEZVUlMwdExTMHRDazFKU1VNMmFrTkRRV1JMWjBGM1NVSkJaMGxDUVVSQlRrSm5hM0ZvYTJsSE9YY3dRa0ZSYzBaQlJFRldUVkpOZDBWUldVUldVVkZFUlhkd2NtUlhTbXdLWTIwMWJHUkhWbnBOUWpSWVJGUkplazFFVFhwTlZFVXlUVlJKTVU1V2IxaEVWRTE2VFVSTmVVOUVSVEpOVkdNeFRsWnZkMFpVUlZSTlFrVkhRVEZWUlFwQmVFMUxZVE5XYVZwWVNuVmFXRkpzWTNwRFEwRlRTWGRFVVZsS1MyOWFTV2gyWTA1QlVVVkNRbEZCUkdkblJWQkJSRU5EUVZGdlEyZG5SVUpCVGpOWkNucFpVU3R1U0RkeUx5OXhVbUZETTAxdU9YSjVibTFTUjBSWlN6YzNPRW80WldzemVrOUViVzkwWjFSeVdYSXdTR2hMVWxBM1VYRjJWM0ZaVG5KeGVHRUtiV1pHV21GaFJUUnNjMk5pTVdscldtOVVLMXBaZEZsMk1ITnRVRnBUUmxGMVRGTlZXRTFCY0M5dU1uZHZWemxEVEhaWVptMTFMMGRwUkhCb1pFUlBZd3BtUW1vemJFdHVkVlpFZG1SdWNucExaMVJ0VURWUlkzRlFVbU00WlhwSFMxRmhjbmQwUVdKVlVIWjRRVXA1SzFCRWJEWkdTakpQYlV0T1lrUnNRVGRpQ21Rdk5DOXdOa0pPY2xKQ1YxcFBNSGszUkRVemNVZEdWM2x1U0c1clNXazRkR3hhYlhjclMwTldhR2hsZUZWSVNrOWxkMWR6VkdsWFJGSnpXa0ZvYlUwS1NIVlBkSGRGUkUxWUwzVjRhSEp5Y1RJeFVtNUpUVnAxUjBOR1VGUjRSa0pKYmtsUk5ISXdhWGhRYVhvMVZUQlNRamhaWWtkVU5UbHFZWGRoTmt4TWN3cEJOSFlyTWpGM2NscHhaSE5YZDA5Q1R6YzRRMEYzUlVGQllVNUdUVVZOZDBSbldVUldVakJRUVZGSUwwSkJVVVJCWjB0clRVSkpSMEV4VldSRmQwVkNDaTkzVVVsTlFWbENRV1k0UTBGUlFYZElVVmxFVmxJd1QwSkNXVVZHU21saFVHTjVkMmx2TlhwWk5rVk1TRUpzV1dkRWRuZGlSMUZsVFVFd1IwTlRjVWNLVTBsaU0wUlJSVUpEZDFWQlFUUkpRa0ZSUW5Ga2VYVlVhMlJPY3k5SmVqbERjRE5RTUdsMmVXeDRWWEZETkZsYU1uaDVXbkl6T0dJMFpWaEdkekJJYmdwVmRFMXJWbFJGVG05bmIwUk1UMHB0TkM4cmRrOWpTM05rZW1kS1REVkZWVWMzTmxCak1GcHhVVWswYjI5c1pXMHZkVEJZY2l0TmVXdFVZMjVwUTBORkNsVjJRbXQ1UlVrcldEUnRZMDlHTXpKYU9FZDBhV294ZDFoNGJ6SjBSRVJtTmxoMFRuUjRWM1ZtYWt3dmJHRTNRVmxhUVhGck5rVlVURE5wVlRkUFdIb0tVamxIU21oeVpFaEtUMnRYUlVVeGFWTkdNRGhNZFd4emRFcGlaU3N5TDJ0bFFVZ3pkbGRtUkVGNlNqZ3ZkVVJVVFRsWWNFdEtlRTg0UjI0cldXUkhZUW8xV2xaWWNHMTFhblp2YjFwdFRIZFdLeTh2U2twQlZGQnROR0V3UmxSYVR6TkVZVGRQVVdWMWVUa3JTMUZ2WVVwa2RVeERaRVJUTDNwMVJrNVBLM1JPQ21KeFlXbFBVVWM1WW1sNlRIZzVZbXBUZEhjeWJVZHNNamtyTkVwMWVVdElPR0ZzYkhwa1NXb0tMUzB0TFMxRlRrUWdRMFZTVkVsR1NVTkJWRVV0TFMwdExRbz0KICAgIHNlcnZlcjogaHR0cHM6Ly8xNzIuMTguMC4yOjY0NDMKICBuYW1lOiB0ZXN0LWNsdXN0ZXIKY29udGV4dHM6Ci0gY29udGV4dDoKICAgIGNsdXN0ZXI6IHRlc3QtY2x1c3RlcgogICAgdXNlcjogdGVzdC1jbHVzdGVyLWFkbWluCiAgbmFtZTogdGVzdC1jbHVzdGVyLWFkbWluQHRlc3QtY2x1c3RlcgpjdXJyZW50LWNvbnRleHQ6IHRlc3QtY2x1c3Rlci1hZG1pbkB0ZXN0LWNsdXN0ZXIKa2luZDogQ29uZmlnCnByZWZlcmVuY2VzOiB7fQp1c2VyczoKLSBuYW1lOiB0ZXN0LWNsdXN0ZXItYWRtaW4KICB1c2VyOgogICAgdG9rZW46IG5vdC1hLXJlYWwtdG9rZW4KICAgIGNsaWVudC1jZXJ0aWZpY2F0ZS1kYXRhOiBMUzB0TFMxQ1JVZEpUaUJEUlZKVVNVWkpRMEZVUlMwdExTMHRDazFKU1VSRmVrTkRRV1oxWjBGM1NVSkJaMGxKVkRjMmNFUldaa3ByY0UxM1JGRlpTa3R2V2tsb2RtTk9RVkZGVEVKUlFYZEdWRVZVVFVKRlIwRXhWVVVLUVhoTlMyRXpWbWxhV0VwMVdsaFNiR042UVdWR2R6QjVUWHBCZWsxNlJYaE9ha1Y1VGxSV1lVWjNNSGxPUkVGNlRYcEJlRTVxUlROT1ZGcGhUVVJSZUFwR2VrRldRbWRPVmtKQmIxUkViazQxWXpOU2JHSlVjSFJaV0U0d1dsaEtlazFTYTNkR2QxbEVWbEZSUkVWNFFuSmtWMHBzWTIwMWJHUkhWbnBNVjBackNtSlhiSFZOU1VsQ1NXcEJUa0puYTNGb2EybEhPWGN3UWtGUlJVWkJRVTlEUVZFNFFVMUpTVUpEWjB0RFFWRkZRVEpQTjFGTVpHZ3JiVlZ5ZEVOemNVWUtVMVZSVmxaYVRtNTNkVlZwU21kQmRWZFVhMjl0UzJ4aVIyUTRNWFJFWms5Q1NYaFhRWFZyTm1WbmJrZDJOVTFXUkM5WGNHbG1TR0Z5TW5oRk5FMUtlUXBaUlhock1YaEdWMDlZVUhKelFYUTRjVEZRYVRSWGQwTXZiVU4wZVdKMmFIWTFkbk5XVlc1eVRraFVaMG8wV0cwd05sRmFkM0oxUWtWRGFqRXpkMVpvQ25sQmIzcDBVWFUxUzFGT1ZsSlBlazVpTldsTWJscHpkazlIWW1sNVkwWm1RbGxGZDJOTk9VdDBiMk4xV1ZOWWEzWnNTRk5ZU1VoUVNIZ3lSR2hyYVdzS2JsWkVha2RZTmpGVFIwRlNSRGxPTlVvd1lVVk5lbHBQWm1oaVkydEdaVEZ4TVhoVmJUZHJkVk53UzJWa2JGUTNZMWRaT1VKQlEyeHhNekpDV1hoSWN3cDBUV2R4UW1sQ1NXTlljRWxoTVM4MFMwbG9Wek53YTBGcE1FWnNVazFJT0RJNE5VZElTVTlzWldOMGVGSm1iQ3QxU21jdkt5OTZhVXhXSzNNclVUZFZDbFZ3WjBvNGQwbEVRVkZCUW04d1ozZFNha0ZQUW1kT1ZraFJPRUpCWmpoRlFrRk5RMEpoUVhkRmQxbEVWbEl3YkVKQmQzZERaMWxKUzNkWlFrSlJWVWdLUVhkSmQwaDNXVVJXVWpCcVFrSm5kMFp2UVZWdFNtODVla3hEUzJwdVRtcHZVWE5qUjFacFFVOHZRbk5hUWpSM1JGRlpTa3R2V2tsb2RtTk9RVkZGVEFwQ1VVRkVaMmRGUWtGS1VuSTVabWh4YjJadVEyOHhTVU56WkVKQ01URTJTRTAxVG0xMVkwb3JOREZHY0VwdmMwOTBWazFvUlRaWGIyYzRWV3M1Tmxsc0NuTTFVRmMwZVd0c1NHOXFhemRDTDJ0ck16VkhORWswVFdONlJ6Z3ZVbnBITW5SclVITjJWVVZzU1ZCeWNrRnNSRTlGU0RONWJsUjRXbXhhV1M5YVkyY0tSWG80UkVSdldrcE9TbkV3VkZReVlqSlVMMDlhVTBKV1VUQlZTbGxIYjFjNU5XbEhTVmxXVDI1TWQxQXhUMHhUUkZsa0wxTmFNRXBQYXpSNE9HcFJkUXBpYkZKNFVHbFZTWHBGZHpadVFqaHpPV3hsZVVSTGFGZHNiREI1VDJWT2VWRkxWR001UmxkSFVIaE9hazVKYWxkQlFqTTRRWEJFYlVWM2NWVjZVa3hRQ2xjck1uQjJSMkkxY0ZoTlZtWmxNR1ZJV0N0Q2MxcDFjRVJRTTNWbFozUnZhM2RaUWtkTFNXSlFPRkZtV1ZSVlpXMW1XSFpTUjI5d05ua3JWVXcxU21NS09WSlVSVEpvYlVoVFMyUlBkSEpCWWswMVZFNXpNM05RTkhkQ1RtNTVORDBLTFMwdExTMUZUa1FnUTBWU1ZFbEdTVU5CVkVVdExTMHRMUW89CiAgICBjbGllbnQta2V5LWRhdGE6IExTMHRMUzFDUlVkSlRpQlNVMEVnVUZKSlZrRlVSU0JMUlZrdExTMHRMUXBOU1VsRmIyZEpRa0ZCUzBOQlVVVkJNazgzVVV4a2FDdHRWWEowUTNOeFJsTlZVVlpXV2s1dWQzVlZhVXBuUVhWWFZHdHZiVXRzWWtka09ERjBSR1pQQ2tKSmVGZEJkV3MyWldkdVIzWTFUVlpFTDFkd2FXWklZWEl5ZUVVMFRVcDVXVVY0YXpGNFJsZFBXRkJ5YzBGME9IRXhVR2swVjNkREwyMURkSGxpZG1nS2RqVjJjMVpWYm5KT1NGUm5TalJZYlRBMlVWcDNjblZDUlVOcU1UTjNWbWg1UVc5NmRGRjFOVXRSVGxaU1QzcE9ZalZwVEc1YWMzWlBSMkpwZVdOR1pncENXVVYzWTAwNVMzUnZZM1ZaVTFocmRteElVMWhKU0ZCSWVESkVhR3RwYTI1V1JHcEhXRFl4VTBkQlVrUTVUalZLTUdGRlRYcGFUMlpvWW1OclJtVXhDbkV4ZUZWdE4ydDFVM0JMWldSc1ZEZGpWMWs1UWtGRGJIRXpNa0paZUVoemRFMW5jVUpwUWtsaldIQkpZVEV2TkV0SmFGY3pjR3RCYVRCR2JGSk5TRGdLTWpnMVIwaEpUMnhsWTNSNFVtWnNLM1ZLWnk4ckwzcHBURllyY3l0Uk4xVlZjR2RLT0hkSlJFRlJRVUpCYjBsQ1FVYzBLMEp6ZFZadWRHbFhURUp3TUFwNWQwWjBkVkV6VWt0RlZIbEljMWRFUTBGeVRuTnRWRXRvUVV0Rk0xbDZiRmw1ZDB0cFZtUllXVk5HVG5kS1VIY3dhRFZZVFV3MWNXa3dSR3N5Tm1kQ0NrTlNSVXBKWVVoMVRFbDRjamRhVmpoalVFYzRXWEZ6SzAxa1RrZElSM1JPYzBzMmIwNWFWWFZUU0hCVEwzVnlNamhHVVZSeVFXVTNUa0kyWWxGclFVSUtVWGw2WldsdFNubFFOMjF2SzFCa1lrSkNaVE5TVWxKdFNHSjNhVVpXYURkblFtWnFUbEpaVDJSR1RXdHROM2gyVDJObWFqYzNkRVFyV1RCUFNYaHpOQXBsYTJkalZFNU9ZUzlRYmtSWkwxUm5LMWxNWVhwSlRXRjJNRXhJVkZoSlZUQlZjVEJYVlVvM1NDczVTMFpDVDJOV2FYTTROV05YVTJKaWNEQnNXU3R1Q21reFFVcEpUMk5NVEVOVFQydFlhSHBKVURCeU5IcHdZVkpPZFdseFpsVTBZamRITlRGcFoyUkxhVEZtTkVoSU56ZGliWHBVU2xacWJtVm9SRVpyZEZrS1NuUmlha2xzYTBObldVVkJOR1ZZYjNkYVVEVmlTelJDZHpBelVDOXZPRE16ZDNBM1lXVjZkM2h5UkNzdlRIZFJSRVZ6Wm1sQlRuZFJUVUpqTlRCNk53cHpWMVZxT0ZZemJuZExPV2w0ZGxaQ1JsUjNTa05OYzJwT1dFTjZSbUZrTjI5NGQwUkhjakJpZURKMFJGQm5hMlYzSzAxTlVWSjZiV3BrWTA4MlRXbDBDbFJSZVVwMmNXVkxNRFZNUm5GSWFsRnlUVzV2T1cxb1VHbG9kWE5ZV21adFltcEZkazE2VEZoeFJuSldjVE4xTjBkdVUyaEZibU5EWjFsRlFUbGtZMU1LWnpKUlRuTXJZbEJaZEhKbldWUTFLMjl3VGpSM2FGVlNVM0pZT1c5SU1uVnBTV1JHWjNGcE5XZHFOelF5TkRWc09FcE5PSFJJYUdnMFpuZ3JNa2xMYVFwelFtRmpUa0ZVUTFWbVkzVnFTbGRuYkU5dlZreFZLM0J5Wm1OSmRGUm1SVmQ2TUUxNllXc3dTelF3WW5relFtdG9Rbk5ITlhCSVlWRnNjakZxYjI4NENrMUNNbWhDYlhVdlkwUTNlblVyUXpFMFoyc3daVTE1WlZGWWFYYzVVR05EVm5aRWNHZ3lWVU5uV1VKU05UVjRWelEyU1dsQ05ERlpSazVTTDFKamNFc0tUVzVFUVROVmIwaHZTa1Y2WW1KVFlqUklhMVZTWW5KcWJqRjFVQ3RrWldkWlJESkNMMFI0VmtoelNTOTRVbXBPTjBSRFUxbGhWRzlqVnpWa1VWcGhVUXBqTURKck1tdENRMDA1TDNwc1JHSXhZVEZOT0VsS1FuWnBWRkU0Y25SWk0wRXpOMGRCT1ZaUlJsQXhXbk5yVW01QlpWcFlkMVZhYkcxMFkwdE5SazAyQ2xST1kwTlNNRXgxU21SRmJrWm1kVzVCWm1GTmVsRkxRbWRJTXk5a1owTmlXbWcxTDFCSGJFcEVkR3R2VVRWVmJHbHBNMGQ1UnpoSVMxYzVOVWQwZG1zS2IwczJablJVZUZrNVFXcHlVMkp1YzJKS09TdFdORk5SWlZvMlZVUmlaVGhVZFVOdFZUaFlXWEo1V0d0b2EwaHpWekpCTW5oU2RHaFZhbWN5TVdNclFncFZZU3RUWldsbFkwVmtVRXA2WlhGaVVUUlZiVEppZEV0cVZFazJSRlJGU0RkdlEzYzVjRkZpTXpaWE5sQk9ORlp2Tm5kTFF6QTBOVUZzUkRaNlJuTnpDamRFVHpGQmIwZEJTR2hUYWtoWkwwMDJVR3hVUTB0b2FGaEViMWQxV1RKVGFuSXZUVkZFYm5wWE9URjJUWEJ0WVcweWFXWlZiVXR4VDBWME5rUTNUVGdLZFdObmNtWjRXSGROUkRSRGF6QjRXblYxV0VrMWVGWkxLMUpLU2xsalZWQTJaRU5LYUhaMmVDOUxUVFF4Tmxsd2RUTXpkVTFwZG5KemRuQXhhRXM0UVFwaVMzTmhURVYwYVVGcWVUbFNSbmxJWWpWNFNGQnZMMDV0V205dmJrNDJhR0pHTkRWbGVFZ3ZTVWxZUkRadmQycEpjR2M5Q2kwdExTMHRSVTVFSUZKVFFTQlFVa2xXUVZSRklFdEZXUzB0TFMwdENnPT0K',
          },
          type: CAPI_CLUSTER_SECRET_TYPE,
        });

      const provider = CAPIClusterProvider.fromConfig(config, {
        logger,
        schedule,
      })[0];
      provider.connect(entityProviderConnection);

      await provider.refresh(logger);

      expect(entityProviderConnection.applyMutation).toHaveBeenCalledWith({
        type: 'full',
        entities: [
          {
            locationKey: 'CAPIClusterProvider:default',
            entity: {
              apiVersion: 'backstage.io/v1beta1',
              kind: 'Resource',
              metadata: {
                title: 'cluster1',
                name: 'cluster1',
                annotations: {
                  [ANNOTATION_LOCATION]: 'CAPIClusterProvider:default',
                  [ANNOTATION_ORIGIN_LOCATION]: 'CAPIClusterProvider:default',
                  [ANNOTATION_CAPI_PROVIDER]: 'AWSManagedCluster',
                  [ANNOTATION_KUBERNETES_API_SERVER]: 'https://172.18.0.2:6443',
                  [ANNOTATION_KUBERNETES_API_SERVER_CA]:
                    'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM2akNDQWRLZ0F3SUJBZ0lCQURBTkJna3Foa2lHOXcwQkFRc0ZBREFWTVJNd0VRWURWUVFERXdwcmRXSmwKY201bGRHVnpNQjRYRFRJek1ETXpNVEUyTVRJMU5Wb1hEVE16TURNeU9ERTJNVGMxTlZvd0ZURVRNQkVHQTFVRQpBeE1LYTNWaVpYSnVaWFJsY3pDQ0FTSXdEUVlKS29aSWh2Y05BUUVCQlFBRGdnRVBBRENDQVFvQ2dnRUJBTjNZCnpZUStuSDdyLy9xUmFDM01uOXJ5bm1SR0RZSzc3OEo4ZWszek9EbW90Z1RyWXIwSGhLUlA3UXF2V3FZTnJxeGEKbWZGWmFhRTRsc2NiMWlrWm9UK1pZdFl2MHNtUFpTRlF1TFNVWE1BcC9uMndvVzlDTHZYZm11L0dpRHBoZERPYwpmQmozbEtudVZEdmRucnpLZ1RtUDVRY3FQUmM4ZXpHS1Fhcnd0QWJVUHZ4QUp5K1BEbDZGSjJPbUtOYkRsQTdiCmQvNC9wNkJOclJCV1pPMHk3RDUzcUdGV3luSG5rSWk4dGxabXcrS0NWaGhleFVISk9ld1dzVGlXRFJzWkFobU0KSHVPdHdFRE1YL3V4aHJycTIxUm5JTVp1R0NGUFR4RkJJbklRNHIwaXhQaXo1VTBSQjhZYkdUNTlqYXdhNkxMcwpBNHYrMjF3clpxZHNXd09CTzc4Q0F3RUFBYU5GTUVNd0RnWURWUjBQQVFIL0JBUURBZ0trTUJJR0ExVWRFd0VCCi93UUlNQVlCQWY4Q0FRQXdIUVlEVlIwT0JCWUVGSmlhUGN5d2lvNXpZNkVMSEJsWWdEdndiR1FlTUEwR0NTcUcKU0liM0RRRUJDd1VBQTRJQkFRQnFkeXVUa2ROcy9JejlDcDNQMGl2eWx4VXFDNFlaMnh5WnIzOGI0ZVhGdzBIbgpVdE1rVlRFTm9nb0RMT0ptNC8rdk9jS3NkemdKTDVFVUc3NlBjMFpxUUk0b29sZW0vdTBYcitNeWtUY25pQ0NFClV2Qmt5RUkrWDRtY09GMzJaOEd0aWoxd1h4bzJ0RERmNlh0TnR4V3VmakwvbGE3QVlaQXFrNkVUTDNpVTdPWHoKUjlHSmhyZEhKT2tXRUUxaVNGMDhMdWxzdEpiZSsyL2tlQUgzdldmREF6SjgvdURUTTlYcEtKeE84R24rWWRHYQo1WlZYcG11anZvb1ptTHdWKy8vSkpBVFBtNGEwRlRaTzNEYTdPUWV1eTkrS1FvYUpkdUxDZERTL3p1Rk5PK3ROCmJxYWlPUUc5Yml6THg5YmpTdHcybUdsMjkrNEp1eUtIOGFsbHpkSWoKLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQo=',
                  [ANNOTATION_KUBERNETES_AUTH_PROVIDER]: 'oidc',
                },
              },
              spec: {
                owner: 'group:test-team',
                type: 'kubernetes-cluster',
                lifecycle: 'production',
              },
            },
          },
        ],
      });

      expect(scope.isDone()).toBeTruthy();
    });

    it('extracts the annotations from the CAPI Cluster', async () => {
      const scope = nock('http://cluster.example.com')
        .get('/apis/cluster.x-k8s.io/v1beta1/clusters')
        .reply(200, {
          apiVersion: 'cluster.x-k8s.io/v1beta1',
          items: [
            {
              kind: 'Cluster',
              metadata: {
                name: 'cluster2',
                namespace: 'clusters',
                annotations: {
                  [ANNOTATION_CAPI_CLUSTER_LIFECYCLE]: 'production',
                  [ANNOTATION_CAPI_CLUSTER_OWNER]: 'group:pet-managers',
                  [ANNOTATION_CAPI_CLUSTER_DESCRIPTION]:
                    'This is the production Cluster',
                  [ANNOTATION_CAPI_CLUSTER_SYSTEM]: 'demo-system',
                  [ANNOTATION_CAPI_CLUSTER_TAGS]: 'tag1,tag2,tag3',
                },
              },
              spec: {
                controlPlaneRef: {
                  apiVersion: 'controlplane.cluster.x-k8s.io/v1beta2',
                  kind: 'AWSManagedControlPlane',
                  name: 'test-cluster-control-plane',
                },
                infrastructureRef: {
                  apiVersion: 'infrastructure.cluster.x-k8s.io/v1beta2',
                  kind: 'AWSManagedCluster',
                  name: 'test-cluster',
                },
              },
              status: {
                phase: 'provisioning',
              },
            },
          ],
        })
        .get('/api/v1/namespaces/clusters/secrets/cluster2-kubeconfig')
        .reply(200, {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: {
            name: 'cluster2-kubeconfig',
            namespace: 'clusters',
          },
          data: {
            value:
              'YXBpVmVyc2lvbjogdjEKY2x1c3RlcnM6Ci0gY2x1c3RlcjoKICAgIGNlcnRpZmljYXRlLWF1dGhvcml0eS1kYXRhOiBMUzB0TFMxQ1JVZEpUaUJEUlZKVVNVWkpRMEZVUlMwdExTMHRDazFKU1VNMmFrTkRRV1JMWjBGM1NVSkJaMGxDUVVSQlRrSm5hM0ZvYTJsSE9YY3dRa0ZSYzBaQlJFRldUVkpOZDBWUldVUldVVkZFUlhkd2NtUlhTbXdLWTIwMWJHUkhWbnBOUWpSWVJGUkplazFFVFhwTlZFVXlUVlJKTVU1V2IxaEVWRTE2VFVSTmVVOUVSVEpOVkdNeFRsWnZkMFpVUlZSTlFrVkhRVEZWUlFwQmVFMUxZVE5XYVZwWVNuVmFXRkpzWTNwRFEwRlRTWGRFVVZsS1MyOWFTV2gyWTA1QlVVVkNRbEZCUkdkblJWQkJSRU5EUVZGdlEyZG5SVUpCVGpOWkNucFpVU3R1U0RkeUx5OXhVbUZETTAxdU9YSjVibTFTUjBSWlN6YzNPRW80WldzemVrOUViVzkwWjFSeVdYSXdTR2hMVWxBM1VYRjJWM0ZaVG5KeGVHRUtiV1pHV21GaFJUUnNjMk5pTVdscldtOVVLMXBaZEZsMk1ITnRVRnBUUmxGMVRGTlZXRTFCY0M5dU1uZHZWemxEVEhaWVptMTFMMGRwUkhCb1pFUlBZd3BtUW1vemJFdHVkVlpFZG1SdWNucExaMVJ0VURWUlkzRlFVbU00WlhwSFMxRmhjbmQwUVdKVlVIWjRRVXA1SzFCRWJEWkdTakpQYlV0T1lrUnNRVGRpQ21Rdk5DOXdOa0pPY2xKQ1YxcFBNSGszUkRVemNVZEdWM2x1U0c1clNXazRkR3hhYlhjclMwTldhR2hsZUZWSVNrOWxkMWR6VkdsWFJGSnpXa0ZvYlUwS1NIVlBkSGRGUkUxWUwzVjRhSEp5Y1RJeFVtNUpUVnAxUjBOR1VGUjRSa0pKYmtsUk5ISXdhWGhRYVhvMVZUQlNRamhaWWtkVU5UbHFZWGRoTmt4TWN3cEJOSFlyTWpGM2NscHhaSE5YZDA5Q1R6YzRRMEYzUlVGQllVNUdUVVZOZDBSbldVUldVakJRUVZGSUwwSkJVVVJCWjB0clRVSkpSMEV4VldSRmQwVkNDaTkzVVVsTlFWbENRV1k0UTBGUlFYZElVVmxFVmxJd1QwSkNXVVZHU21saFVHTjVkMmx2TlhwWk5rVk1TRUpzV1dkRWRuZGlSMUZsVFVFd1IwTlRjVWNLVTBsaU0wUlJSVUpEZDFWQlFUUkpRa0ZSUW5Ga2VYVlVhMlJPY3k5SmVqbERjRE5RTUdsMmVXeDRWWEZETkZsYU1uaDVXbkl6T0dJMFpWaEdkekJJYmdwVmRFMXJWbFJGVG05bmIwUk1UMHB0TkM4cmRrOWpTM05rZW1kS1REVkZWVWMzTmxCak1GcHhVVWswYjI5c1pXMHZkVEJZY2l0TmVXdFVZMjVwUTBORkNsVjJRbXQ1UlVrcldEUnRZMDlHTXpKYU9FZDBhV294ZDFoNGJ6SjBSRVJtTmxoMFRuUjRWM1ZtYWt3dmJHRTNRVmxhUVhGck5rVlVURE5wVlRkUFdIb0tVamxIU21oeVpFaEtUMnRYUlVVeGFWTkdNRGhNZFd4emRFcGlaU3N5TDJ0bFFVZ3pkbGRtUkVGNlNqZ3ZkVVJVVFRsWWNFdEtlRTg0UjI0cldXUkhZUW8xV2xaWWNHMTFhblp2YjFwdFRIZFdLeTh2U2twQlZGQnROR0V3UmxSYVR6TkVZVGRQVVdWMWVUa3JTMUZ2WVVwa2RVeERaRVJUTDNwMVJrNVBLM1JPQ21KeFlXbFBVVWM1WW1sNlRIZzVZbXBUZEhjeWJVZHNNamtyTkVwMWVVdElPR0ZzYkhwa1NXb0tMUzB0TFMxRlRrUWdRMFZTVkVsR1NVTkJWRVV0TFMwdExRbz0KICAgIHNlcnZlcjogaHR0cHM6Ly8xNzIuMTguMC4yOjY0NDMKICBuYW1lOiB0ZXN0LWNsdXN0ZXIKY29udGV4dHM6Ci0gY29udGV4dDoKICAgIGNsdXN0ZXI6IHRlc3QtY2x1c3RlcgogICAgdXNlcjogdGVzdC1jbHVzdGVyLWFkbWluCiAgbmFtZTogdGVzdC1jbHVzdGVyLWFkbWluQHRlc3QtY2x1c3RlcgpjdXJyZW50LWNvbnRleHQ6IHRlc3QtY2x1c3Rlci1hZG1pbkB0ZXN0LWNsdXN0ZXIKa2luZDogQ29uZmlnCnByZWZlcmVuY2VzOiB7fQp1c2VyczoKLSBuYW1lOiB0ZXN0LWNsdXN0ZXItYWRtaW4KICB1c2VyOgogICAgdG9rZW46IG5vdC1hLXJlYWwtdG9rZW4KICAgIGNsaWVudC1jZXJ0aWZpY2F0ZS1kYXRhOiBMUzB0TFMxQ1JVZEpUaUJEUlZKVVNVWkpRMEZVUlMwdExTMHRDazFKU1VSRmVrTkRRV1oxWjBGM1NVSkJaMGxKVkRjMmNFUldaa3ByY0UxM1JGRlpTa3R2V2tsb2RtTk9RVkZGVEVKUlFYZEdWRVZVVFVKRlIwRXhWVVVLUVhoTlMyRXpWbWxhV0VwMVdsaFNiR042UVdWR2R6QjVUWHBCZWsxNlJYaE9ha1Y1VGxSV1lVWjNNSGxPUkVGNlRYcEJlRTVxUlROT1ZGcGhUVVJSZUFwR2VrRldRbWRPVmtKQmIxUkViazQxWXpOU2JHSlVjSFJaV0U0d1dsaEtlazFTYTNkR2QxbEVWbEZSUkVWNFFuSmtWMHBzWTIwMWJHUkhWbnBNVjBackNtSlhiSFZOU1VsQ1NXcEJUa0puYTNGb2EybEhPWGN3UWtGUlJVWkJRVTlEUVZFNFFVMUpTVUpEWjB0RFFWRkZRVEpQTjFGTVpHZ3JiVlZ5ZEVOemNVWUtVMVZSVmxaYVRtNTNkVlZwU21kQmRWZFVhMjl0UzJ4aVIyUTRNWFJFWms5Q1NYaFhRWFZyTm1WbmJrZDJOVTFXUkM5WGNHbG1TR0Z5TW5oRk5FMUtlUXBaUlhock1YaEdWMDlZVUhKelFYUTRjVEZRYVRSWGQwTXZiVU4wZVdKMmFIWTFkbk5XVlc1eVRraFVaMG8wV0cwd05sRmFkM0oxUWtWRGFqRXpkMVpvQ25sQmIzcDBVWFUxUzFGT1ZsSlBlazVpTldsTWJscHpkazlIWW1sNVkwWm1RbGxGZDJOTk9VdDBiMk4xV1ZOWWEzWnNTRk5ZU1VoUVNIZ3lSR2hyYVdzS2JsWkVha2RZTmpGVFIwRlNSRGxPTlVvd1lVVk5lbHBQWm1oaVkydEdaVEZ4TVhoVmJUZHJkVk53UzJWa2JGUTNZMWRaT1VKQlEyeHhNekpDV1hoSWN3cDBUV2R4UW1sQ1NXTlljRWxoTVM4MFMwbG9Wek53YTBGcE1FWnNVazFJT0RJNE5VZElTVTlzWldOMGVGSm1iQ3QxU21jdkt5OTZhVXhXSzNNclVUZFZDbFZ3WjBvNGQwbEVRVkZCUW04d1ozZFNha0ZQUW1kT1ZraFJPRUpCWmpoRlFrRk5RMEpoUVhkRmQxbEVWbEl3YkVKQmQzZERaMWxKUzNkWlFrSlJWVWdLUVhkSmQwaDNXVVJXVWpCcVFrSm5kMFp2UVZWdFNtODVla3hEUzJwdVRtcHZVWE5qUjFacFFVOHZRbk5hUWpSM1JGRlpTa3R2V2tsb2RtTk9RVkZGVEFwQ1VVRkVaMmRGUWtGS1VuSTVabWh4YjJadVEyOHhTVU56WkVKQ01URTJTRTAxVG0xMVkwb3JOREZHY0VwdmMwOTBWazFvUlRaWGIyYzRWV3M1Tmxsc0NuTTFVRmMwZVd0c1NHOXFhemRDTDJ0ck16VkhORWswVFdONlJ6Z3ZVbnBITW5SclVITjJWVVZzU1ZCeWNrRnNSRTlGU0RONWJsUjRXbXhhV1M5YVkyY0tSWG80UkVSdldrcE9TbkV3VkZReVlqSlVMMDlhVTBKV1VUQlZTbGxIYjFjNU5XbEhTVmxXVDI1TWQxQXhUMHhUUkZsa0wxTmFNRXBQYXpSNE9HcFJkUXBpYkZKNFVHbFZTWHBGZHpadVFqaHpPV3hsZVVSTGFGZHNiREI1VDJWT2VWRkxWR001UmxkSFVIaE9hazVKYWxkQlFqTTRRWEJFYlVWM2NWVjZVa3hRQ2xjck1uQjJSMkkxY0ZoTlZtWmxNR1ZJV0N0Q2MxcDFjRVJRTTNWbFozUnZhM2RaUWtkTFNXSlFPRkZtV1ZSVlpXMW1XSFpTUjI5d05ua3JWVXcxU21NS09WSlVSVEpvYlVoVFMyUlBkSEpCWWswMVZFNXpNM05RTkhkQ1RtNTVORDBLTFMwdExTMUZUa1FnUTBWU1ZFbEdTVU5CVkVVdExTMHRMUW89CiAgICBjbGllbnQta2V5LWRhdGE6IExTMHRMUzFDUlVkSlRpQlNVMEVnVUZKSlZrRlVSU0JMUlZrdExTMHRMUXBOU1VsRmIyZEpRa0ZCUzBOQlVVVkJNazgzVVV4a2FDdHRWWEowUTNOeFJsTlZVVlpXV2s1dWQzVlZhVXBuUVhWWFZHdHZiVXRzWWtka09ERjBSR1pQQ2tKSmVGZEJkV3MyWldkdVIzWTFUVlpFTDFkd2FXWklZWEl5ZUVVMFRVcDVXVVY0YXpGNFJsZFBXRkJ5YzBGME9IRXhVR2swVjNkREwyMURkSGxpZG1nS2RqVjJjMVpWYm5KT1NGUm5TalJZYlRBMlVWcDNjblZDUlVOcU1UTjNWbWg1UVc5NmRGRjFOVXRSVGxaU1QzcE9ZalZwVEc1YWMzWlBSMkpwZVdOR1pncENXVVYzWTAwNVMzUnZZM1ZaVTFocmRteElVMWhKU0ZCSWVESkVhR3RwYTI1V1JHcEhXRFl4VTBkQlVrUTVUalZLTUdGRlRYcGFUMlpvWW1OclJtVXhDbkV4ZUZWdE4ydDFVM0JMWldSc1ZEZGpWMWs1UWtGRGJIRXpNa0paZUVoemRFMW5jVUpwUWtsaldIQkpZVEV2TkV0SmFGY3pjR3RCYVRCR2JGSk5TRGdLTWpnMVIwaEpUMnhsWTNSNFVtWnNLM1ZLWnk4ckwzcHBURllyY3l0Uk4xVlZjR2RLT0hkSlJFRlJRVUpCYjBsQ1FVYzBLMEp6ZFZadWRHbFhURUp3TUFwNWQwWjBkVkV6VWt0RlZIbEljMWRFUTBGeVRuTnRWRXRvUVV0Rk0xbDZiRmw1ZDB0cFZtUllXVk5HVG5kS1VIY3dhRFZZVFV3MWNXa3dSR3N5Tm1kQ0NrTlNSVXBKWVVoMVRFbDRjamRhVmpoalVFYzRXWEZ6SzAxa1RrZElSM1JPYzBzMmIwNWFWWFZUU0hCVEwzVnlNamhHVVZSeVFXVTNUa0kyWWxGclFVSUtVWGw2WldsdFNubFFOMjF2SzFCa1lrSkNaVE5TVWxKdFNHSjNhVVpXYURkblFtWnFUbEpaVDJSR1RXdHROM2gyVDJObWFqYzNkRVFyV1RCUFNYaHpOQXBsYTJkalZFNU9ZUzlRYmtSWkwxUm5LMWxNWVhwSlRXRjJNRXhJVkZoSlZUQlZjVEJYVlVvM1NDczVTMFpDVDJOV2FYTTROV05YVTJKaWNEQnNXU3R1Q21reFFVcEpUMk5NVEVOVFQydFlhSHBKVURCeU5IcHdZVkpPZFdseFpsVTBZamRITlRGcFoyUkxhVEZtTkVoSU56ZGliWHBVU2xacWJtVm9SRVpyZEZrS1NuUmlha2xzYTBObldVVkJOR1ZZYjNkYVVEVmlTelJDZHpBelVDOXZPRE16ZDNBM1lXVjZkM2h5UkNzdlRIZFJSRVZ6Wm1sQlRuZFJUVUpqTlRCNk53cHpWMVZxT0ZZemJuZExPV2w0ZGxaQ1JsUjNTa05OYzJwT1dFTjZSbUZrTjI5NGQwUkhjakJpZURKMFJGQm5hMlYzSzAxTlVWSjZiV3BrWTA4MlRXbDBDbFJSZVVwMmNXVkxNRFZNUm5GSWFsRnlUVzV2T1cxb1VHbG9kWE5ZV21adFltcEZkazE2VEZoeFJuSldjVE4xTjBkdVUyaEZibU5EWjFsRlFUbGtZMU1LWnpKUlRuTXJZbEJaZEhKbldWUTFLMjl3VGpSM2FGVlNVM0pZT1c5SU1uVnBTV1JHWjNGcE5XZHFOelF5TkRWc09FcE5PSFJJYUdnMFpuZ3JNa2xMYVFwelFtRmpUa0ZVUTFWbVkzVnFTbGRuYkU5dlZreFZLM0J5Wm1OSmRGUm1SVmQ2TUUxNllXc3dTelF3WW5relFtdG9Rbk5ITlhCSVlWRnNjakZxYjI4NENrMUNNbWhDYlhVdlkwUTNlblVyUXpFMFoyc3daVTE1WlZGWWFYYzVVR05EVm5aRWNHZ3lWVU5uV1VKU05UVjRWelEyU1dsQ05ERlpSazVTTDFKamNFc0tUVzVFUVROVmIwaHZTa1Y2WW1KVFlqUklhMVZTWW5KcWJqRjFVQ3RrWldkWlJESkNMMFI0VmtoelNTOTRVbXBPTjBSRFUxbGhWRzlqVnpWa1VWcGhVUXBqTURKck1tdENRMDA1TDNwc1JHSXhZVEZOT0VsS1FuWnBWRkU0Y25SWk0wRXpOMGRCT1ZaUlJsQXhXbk5yVW01QlpWcFlkMVZhYkcxMFkwdE5SazAyQ2xST1kwTlNNRXgxU21SRmJrWm1kVzVCWm1GTmVsRkxRbWRJTXk5a1owTmlXbWcxTDFCSGJFcEVkR3R2VVRWVmJHbHBNMGQ1UnpoSVMxYzVOVWQwZG1zS2IwczJablJVZUZrNVFXcHlVMkp1YzJKS09TdFdORk5SWlZvMlZVUmlaVGhVZFVOdFZUaFlXWEo1V0d0b2EwaHpWekpCTW5oU2RHaFZhbWN5TVdNclFncFZZU3RUWldsbFkwVmtVRXA2WlhGaVVUUlZiVEppZEV0cVZFazJSRlJGU0RkdlEzYzVjRkZpTXpaWE5sQk9ORlp2Tm5kTFF6QTBOVUZzUkRaNlJuTnpDamRFVHpGQmIwZEJTR2hUYWtoWkwwMDJVR3hVUTB0b2FGaEViMWQxV1RKVGFuSXZUVkZFYm5wWE9URjJUWEJ0WVcweWFXWlZiVXR4VDBWME5rUTNUVGdLZFdObmNtWjRXSGROUkRSRGF6QjRXblYxV0VrMWVGWkxLMUpLU2xsalZWQTJaRU5LYUhaMmVDOUxUVFF4Tmxsd2RUTXpkVTFwZG5KemRuQXhhRXM0UVFwaVMzTmhURVYwYVVGcWVUbFNSbmxJWWpWNFNGQnZMMDV0V205dmJrNDJhR0pHTkRWbGVFZ3ZTVWxZUkRadmQycEpjR2M5Q2kwdExTMHRSVTVFSUZKVFFTQlFVa2xXUVZSRklFdEZXUzB0TFMwdENnPT0K',
          },
          type: CAPI_CLUSTER_SECRET_TYPE,
        });

      const provider = CAPIClusterProvider.fromConfig(config, {
        logger,
        schedule,
      })[0];
      provider.connect(entityProviderConnection);

      await provider.refresh(logger);

      expect(entityProviderConnection.applyMutation).toHaveBeenCalledWith({
        type: 'full',
        entities: [
          {
            locationKey: 'CAPIClusterProvider:default',
            entity: {
              apiVersion: 'backstage.io/v1beta1',
              kind: 'Resource',
              metadata: {
                title: 'cluster2',
                name: 'cluster2',
                description: 'This is the production Cluster',
                annotations: {
                  [ANNOTATION_LOCATION]: 'CAPIClusterProvider:default',
                  [ANNOTATION_ORIGIN_LOCATION]: 'CAPIClusterProvider:default',
                  [ANNOTATION_CAPI_PROVIDER]: 'AWSManagedCluster',
                  [ANNOTATION_KUBERNETES_API_SERVER]: 'https://172.18.0.2:6443',
                  [ANNOTATION_KUBERNETES_API_SERVER_CA]:
                    'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM2akNDQWRLZ0F3SUJBZ0lCQURBTkJna3Foa2lHOXcwQkFRc0ZBREFWTVJNd0VRWURWUVFERXdwcmRXSmwKY201bGRHVnpNQjRYRFRJek1ETXpNVEUyTVRJMU5Wb1hEVE16TURNeU9ERTJNVGMxTlZvd0ZURVRNQkVHQTFVRQpBeE1LYTNWaVpYSnVaWFJsY3pDQ0FTSXdEUVlKS29aSWh2Y05BUUVCQlFBRGdnRVBBRENDQVFvQ2dnRUJBTjNZCnpZUStuSDdyLy9xUmFDM01uOXJ5bm1SR0RZSzc3OEo4ZWszek9EbW90Z1RyWXIwSGhLUlA3UXF2V3FZTnJxeGEKbWZGWmFhRTRsc2NiMWlrWm9UK1pZdFl2MHNtUFpTRlF1TFNVWE1BcC9uMndvVzlDTHZYZm11L0dpRHBoZERPYwpmQmozbEtudVZEdmRucnpLZ1RtUDVRY3FQUmM4ZXpHS1Fhcnd0QWJVUHZ4QUp5K1BEbDZGSjJPbUtOYkRsQTdiCmQvNC9wNkJOclJCV1pPMHk3RDUzcUdGV3luSG5rSWk4dGxabXcrS0NWaGhleFVISk9ld1dzVGlXRFJzWkFobU0KSHVPdHdFRE1YL3V4aHJycTIxUm5JTVp1R0NGUFR4RkJJbklRNHIwaXhQaXo1VTBSQjhZYkdUNTlqYXdhNkxMcwpBNHYrMjF3clpxZHNXd09CTzc4Q0F3RUFBYU5GTUVNd0RnWURWUjBQQVFIL0JBUURBZ0trTUJJR0ExVWRFd0VCCi93UUlNQVlCQWY4Q0FRQXdIUVlEVlIwT0JCWUVGSmlhUGN5d2lvNXpZNkVMSEJsWWdEdndiR1FlTUEwR0NTcUcKU0liM0RRRUJDd1VBQTRJQkFRQnFkeXVUa2ROcy9JejlDcDNQMGl2eWx4VXFDNFlaMnh5WnIzOGI0ZVhGdzBIbgpVdE1rVlRFTm9nb0RMT0ptNC8rdk9jS3NkemdKTDVFVUc3NlBjMFpxUUk0b29sZW0vdTBYcitNeWtUY25pQ0NFClV2Qmt5RUkrWDRtY09GMzJaOEd0aWoxd1h4bzJ0RERmNlh0TnR4V3VmakwvbGE3QVlaQXFrNkVUTDNpVTdPWHoKUjlHSmhyZEhKT2tXRUUxaVNGMDhMdWxzdEpiZSsyL2tlQUgzdldmREF6SjgvdURUTTlYcEtKeE84R24rWWRHYQo1WlZYcG11anZvb1ptTHdWKy8vSkpBVFBtNGEwRlRaTzNEYTdPUWV1eTkrS1FvYUpkdUxDZERTL3p1Rk5PK3ROCmJxYWlPUUc5Yml6THg5YmpTdHcybUdsMjkrNEp1eUtIOGFsbHpkSWoKLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQo=',
                  [ANNOTATION_KUBERNETES_AUTH_PROVIDER]: 'oidc',
                },
                tags: ['tag1', 'tag2', 'tag3'],
              },
              spec: {
                owner: 'group:pet-managers',
                type: 'kubernetes-cluster',
                lifecycle: 'production',
                system: 'demo-system',
              },
            },
          },
        ],
      });

      expect(scope.isDone()).toBeTruthy();
    });
  });

  it('applies the defaults from the provider configuration', async () => {
    const scope = nock('http://cluster.example.com')
      .get('/apis/cluster.x-k8s.io/v1beta1/clusters')
      .reply(200, {
        apiVersion: 'cluster.x-k8s.io/v1beta1',
        items: [
          {
            kind: 'Cluster',
            metadata: {
              name: 'cluster3',
              namespace: 'clusters',
            },
            spec: {
              controlPlaneRef: {
                apiVersion: 'controlplane.cluster.x-k8s.io/v1beta2',
                kind: 'AWSManagedControlPlane',
                name: 'test-cluster-control-plane',
              },
              infrastructureRef: {
                apiVersion: 'infrastructure.cluster.x-k8s.io/v1beta2',
                kind: 'AWSManagedCluster',
                name: 'test-cluster',
              },
            },
            status: {
              phase: 'provisioning',
            },
          },
        ],
      })
      .get('/api/v1/namespaces/clusters/secrets/cluster3-kubeconfig')
      .reply(200, {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          name: 'cluster3-kubeconfig',
          namespace: 'clusters',
        },
        data: {
          value:
            'YXBpVmVyc2lvbjogdjEKY2x1c3RlcnM6Ci0gY2x1c3RlcjoKICAgIGNlcnRpZmljYXRlLWF1dGhvcml0eS1kYXRhOiBMUzB0TFMxQ1JVZEpUaUJEUlZKVVNVWkpRMEZVUlMwdExTMHRDazFKU1VNMmFrTkRRV1JMWjBGM1NVSkJaMGxDUVVSQlRrSm5hM0ZvYTJsSE9YY3dRa0ZSYzBaQlJFRldUVkpOZDBWUldVUldVVkZFUlhkd2NtUlhTbXdLWTIwMWJHUkhWbnBOUWpSWVJGUkplazFFVFhwTlZFVXlUVlJKTVU1V2IxaEVWRTE2VFVSTmVVOUVSVEpOVkdNeFRsWnZkMFpVUlZSTlFrVkhRVEZWUlFwQmVFMUxZVE5XYVZwWVNuVmFXRkpzWTNwRFEwRlRTWGRFVVZsS1MyOWFTV2gyWTA1QlVVVkNRbEZCUkdkblJWQkJSRU5EUVZGdlEyZG5SVUpCVGpOWkNucFpVU3R1U0RkeUx5OXhVbUZETTAxdU9YSjVibTFTUjBSWlN6YzNPRW80WldzemVrOUViVzkwWjFSeVdYSXdTR2hMVWxBM1VYRjJWM0ZaVG5KeGVHRUtiV1pHV21GaFJUUnNjMk5pTVdscldtOVVLMXBaZEZsMk1ITnRVRnBUUmxGMVRGTlZXRTFCY0M5dU1uZHZWemxEVEhaWVptMTFMMGRwUkhCb1pFUlBZd3BtUW1vemJFdHVkVlpFZG1SdWNucExaMVJ0VURWUlkzRlFVbU00WlhwSFMxRmhjbmQwUVdKVlVIWjRRVXA1SzFCRWJEWkdTakpQYlV0T1lrUnNRVGRpQ21Rdk5DOXdOa0pPY2xKQ1YxcFBNSGszUkRVemNVZEdWM2x1U0c1clNXazRkR3hhYlhjclMwTldhR2hsZUZWSVNrOWxkMWR6VkdsWFJGSnpXa0ZvYlUwS1NIVlBkSGRGUkUxWUwzVjRhSEp5Y1RJeFVtNUpUVnAxUjBOR1VGUjRSa0pKYmtsUk5ISXdhWGhRYVhvMVZUQlNRamhaWWtkVU5UbHFZWGRoTmt4TWN3cEJOSFlyTWpGM2NscHhaSE5YZDA5Q1R6YzRRMEYzUlVGQllVNUdUVVZOZDBSbldVUldVakJRUVZGSUwwSkJVVVJCWjB0clRVSkpSMEV4VldSRmQwVkNDaTkzVVVsTlFWbENRV1k0UTBGUlFYZElVVmxFVmxJd1QwSkNXVVZHU21saFVHTjVkMmx2TlhwWk5rVk1TRUpzV1dkRWRuZGlSMUZsVFVFd1IwTlRjVWNLVTBsaU0wUlJSVUpEZDFWQlFUUkpRa0ZSUW5Ga2VYVlVhMlJPY3k5SmVqbERjRE5RTUdsMmVXeDRWWEZETkZsYU1uaDVXbkl6T0dJMFpWaEdkekJJYmdwVmRFMXJWbFJGVG05bmIwUk1UMHB0TkM4cmRrOWpTM05rZW1kS1REVkZWVWMzTmxCak1GcHhVVWswYjI5c1pXMHZkVEJZY2l0TmVXdFVZMjVwUTBORkNsVjJRbXQ1UlVrcldEUnRZMDlHTXpKYU9FZDBhV294ZDFoNGJ6SjBSRVJtTmxoMFRuUjRWM1ZtYWt3dmJHRTNRVmxhUVhGck5rVlVURE5wVlRkUFdIb0tVamxIU21oeVpFaEtUMnRYUlVVeGFWTkdNRGhNZFd4emRFcGlaU3N5TDJ0bFFVZ3pkbGRtUkVGNlNqZ3ZkVVJVVFRsWWNFdEtlRTg0UjI0cldXUkhZUW8xV2xaWWNHMTFhblp2YjFwdFRIZFdLeTh2U2twQlZGQnROR0V3UmxSYVR6TkVZVGRQVVdWMWVUa3JTMUZ2WVVwa2RVeERaRVJUTDNwMVJrNVBLM1JPQ21KeFlXbFBVVWM1WW1sNlRIZzVZbXBUZEhjeWJVZHNNamtyTkVwMWVVdElPR0ZzYkhwa1NXb0tMUzB0TFMxRlRrUWdRMFZTVkVsR1NVTkJWRVV0TFMwdExRbz0KICAgIHNlcnZlcjogaHR0cHM6Ly8xNzIuMTguMC4yOjY0NDMKICBuYW1lOiB0ZXN0LWNsdXN0ZXIKY29udGV4dHM6Ci0gY29udGV4dDoKICAgIGNsdXN0ZXI6IHRlc3QtY2x1c3RlcgogICAgdXNlcjogdGVzdC1jbHVzdGVyLWFkbWluCiAgbmFtZTogdGVzdC1jbHVzdGVyLWFkbWluQHRlc3QtY2x1c3RlcgpjdXJyZW50LWNvbnRleHQ6IHRlc3QtY2x1c3Rlci1hZG1pbkB0ZXN0LWNsdXN0ZXIKa2luZDogQ29uZmlnCnByZWZlcmVuY2VzOiB7fQp1c2VyczoKLSBuYW1lOiB0ZXN0LWNsdXN0ZXItYWRtaW4KICB1c2VyOgogICAgdG9rZW46IG5vdC1hLXJlYWwtdG9rZW4KICAgIGNsaWVudC1jZXJ0aWZpY2F0ZS1kYXRhOiBMUzB0TFMxQ1JVZEpUaUJEUlZKVVNVWkpRMEZVUlMwdExTMHRDazFKU1VSRmVrTkRRV1oxWjBGM1NVSkJaMGxKVkRjMmNFUldaa3ByY0UxM1JGRlpTa3R2V2tsb2RtTk9RVkZGVEVKUlFYZEdWRVZVVFVKRlIwRXhWVVVLUVhoTlMyRXpWbWxhV0VwMVdsaFNiR042UVdWR2R6QjVUWHBCZWsxNlJYaE9ha1Y1VGxSV1lVWjNNSGxPUkVGNlRYcEJlRTVxUlROT1ZGcGhUVVJSZUFwR2VrRldRbWRPVmtKQmIxUkViazQxWXpOU2JHSlVjSFJaV0U0d1dsaEtlazFTYTNkR2QxbEVWbEZSUkVWNFFuSmtWMHBzWTIwMWJHUkhWbnBNVjBackNtSlhiSFZOU1VsQ1NXcEJUa0puYTNGb2EybEhPWGN3UWtGUlJVWkJRVTlEUVZFNFFVMUpTVUpEWjB0RFFWRkZRVEpQTjFGTVpHZ3JiVlZ5ZEVOemNVWUtVMVZSVmxaYVRtNTNkVlZwU21kQmRWZFVhMjl0UzJ4aVIyUTRNWFJFWms5Q1NYaFhRWFZyTm1WbmJrZDJOVTFXUkM5WGNHbG1TR0Z5TW5oRk5FMUtlUXBaUlhock1YaEdWMDlZVUhKelFYUTRjVEZRYVRSWGQwTXZiVU4wZVdKMmFIWTFkbk5XVlc1eVRraFVaMG8wV0cwd05sRmFkM0oxUWtWRGFqRXpkMVpvQ25sQmIzcDBVWFUxUzFGT1ZsSlBlazVpTldsTWJscHpkazlIWW1sNVkwWm1RbGxGZDJOTk9VdDBiMk4xV1ZOWWEzWnNTRk5ZU1VoUVNIZ3lSR2hyYVdzS2JsWkVha2RZTmpGVFIwRlNSRGxPTlVvd1lVVk5lbHBQWm1oaVkydEdaVEZ4TVhoVmJUZHJkVk53UzJWa2JGUTNZMWRaT1VKQlEyeHhNekpDV1hoSWN3cDBUV2R4UW1sQ1NXTlljRWxoTVM4MFMwbG9Wek53YTBGcE1FWnNVazFJT0RJNE5VZElTVTlzWldOMGVGSm1iQ3QxU21jdkt5OTZhVXhXSzNNclVUZFZDbFZ3WjBvNGQwbEVRVkZCUW04d1ozZFNha0ZQUW1kT1ZraFJPRUpCWmpoRlFrRk5RMEpoUVhkRmQxbEVWbEl3YkVKQmQzZERaMWxKUzNkWlFrSlJWVWdLUVhkSmQwaDNXVVJXVWpCcVFrSm5kMFp2UVZWdFNtODVla3hEUzJwdVRtcHZVWE5qUjFacFFVOHZRbk5hUWpSM1JGRlpTa3R2V2tsb2RtTk9RVkZGVEFwQ1VVRkVaMmRGUWtGS1VuSTVabWh4YjJadVEyOHhTVU56WkVKQ01URTJTRTAxVG0xMVkwb3JOREZHY0VwdmMwOTBWazFvUlRaWGIyYzRWV3M1Tmxsc0NuTTFVRmMwZVd0c1NHOXFhemRDTDJ0ck16VkhORWswVFdONlJ6Z3ZVbnBITW5SclVITjJWVVZzU1ZCeWNrRnNSRTlGU0RONWJsUjRXbXhhV1M5YVkyY0tSWG80UkVSdldrcE9TbkV3VkZReVlqSlVMMDlhVTBKV1VUQlZTbGxIYjFjNU5XbEhTVmxXVDI1TWQxQXhUMHhUUkZsa0wxTmFNRXBQYXpSNE9HcFJkUXBpYkZKNFVHbFZTWHBGZHpadVFqaHpPV3hsZVVSTGFGZHNiREI1VDJWT2VWRkxWR001UmxkSFVIaE9hazVKYWxkQlFqTTRRWEJFYlVWM2NWVjZVa3hRQ2xjck1uQjJSMkkxY0ZoTlZtWmxNR1ZJV0N0Q2MxcDFjRVJRTTNWbFozUnZhM2RaUWtkTFNXSlFPRkZtV1ZSVlpXMW1XSFpTUjI5d05ua3JWVXcxU21NS09WSlVSVEpvYlVoVFMyUlBkSEpCWWswMVZFNXpNM05RTkhkQ1RtNTVORDBLTFMwdExTMUZUa1FnUTBWU1ZFbEdTVU5CVkVVdExTMHRMUW89CiAgICBjbGllbnQta2V5LWRhdGE6IExTMHRMUzFDUlVkSlRpQlNVMEVnVUZKSlZrRlVSU0JMUlZrdExTMHRMUXBOU1VsRmIyZEpRa0ZCUzBOQlVVVkJNazgzVVV4a2FDdHRWWEowUTNOeFJsTlZVVlpXV2s1dWQzVlZhVXBuUVhWWFZHdHZiVXRzWWtka09ERjBSR1pQQ2tKSmVGZEJkV3MyWldkdVIzWTFUVlpFTDFkd2FXWklZWEl5ZUVVMFRVcDVXVVY0YXpGNFJsZFBXRkJ5YzBGME9IRXhVR2swVjNkREwyMURkSGxpZG1nS2RqVjJjMVpWYm5KT1NGUm5TalJZYlRBMlVWcDNjblZDUlVOcU1UTjNWbWg1UVc5NmRGRjFOVXRSVGxaU1QzcE9ZalZwVEc1YWMzWlBSMkpwZVdOR1pncENXVVYzWTAwNVMzUnZZM1ZaVTFocmRteElVMWhKU0ZCSWVESkVhR3RwYTI1V1JHcEhXRFl4VTBkQlVrUTVUalZLTUdGRlRYcGFUMlpvWW1OclJtVXhDbkV4ZUZWdE4ydDFVM0JMWldSc1ZEZGpWMWs1UWtGRGJIRXpNa0paZUVoemRFMW5jVUpwUWtsaldIQkpZVEV2TkV0SmFGY3pjR3RCYVRCR2JGSk5TRGdLTWpnMVIwaEpUMnhsWTNSNFVtWnNLM1ZLWnk4ckwzcHBURllyY3l0Uk4xVlZjR2RLT0hkSlJFRlJRVUpCYjBsQ1FVYzBLMEp6ZFZadWRHbFhURUp3TUFwNWQwWjBkVkV6VWt0RlZIbEljMWRFUTBGeVRuTnRWRXRvUVV0Rk0xbDZiRmw1ZDB0cFZtUllXVk5HVG5kS1VIY3dhRFZZVFV3MWNXa3dSR3N5Tm1kQ0NrTlNSVXBKWVVoMVRFbDRjamRhVmpoalVFYzRXWEZ6SzAxa1RrZElSM1JPYzBzMmIwNWFWWFZUU0hCVEwzVnlNamhHVVZSeVFXVTNUa0kyWWxGclFVSUtVWGw2WldsdFNubFFOMjF2SzFCa1lrSkNaVE5TVWxKdFNHSjNhVVpXYURkblFtWnFUbEpaVDJSR1RXdHROM2gyVDJObWFqYzNkRVFyV1RCUFNYaHpOQXBsYTJkalZFNU9ZUzlRYmtSWkwxUm5LMWxNWVhwSlRXRjJNRXhJVkZoSlZUQlZjVEJYVlVvM1NDczVTMFpDVDJOV2FYTTROV05YVTJKaWNEQnNXU3R1Q21reFFVcEpUMk5NVEVOVFQydFlhSHBKVURCeU5IcHdZVkpPZFdseFpsVTBZamRITlRGcFoyUkxhVEZtTkVoSU56ZGliWHBVU2xacWJtVm9SRVpyZEZrS1NuUmlha2xzYTBObldVVkJOR1ZZYjNkYVVEVmlTelJDZHpBelVDOXZPRE16ZDNBM1lXVjZkM2h5UkNzdlRIZFJSRVZ6Wm1sQlRuZFJUVUpqTlRCNk53cHpWMVZxT0ZZemJuZExPV2w0ZGxaQ1JsUjNTa05OYzJwT1dFTjZSbUZrTjI5NGQwUkhjakJpZURKMFJGQm5hMlYzSzAxTlVWSjZiV3BrWTA4MlRXbDBDbFJSZVVwMmNXVkxNRFZNUm5GSWFsRnlUVzV2T1cxb1VHbG9kWE5ZV21adFltcEZkazE2VEZoeFJuSldjVE4xTjBkdVUyaEZibU5EWjFsRlFUbGtZMU1LWnpKUlRuTXJZbEJaZEhKbldWUTFLMjl3VGpSM2FGVlNVM0pZT1c5SU1uVnBTV1JHWjNGcE5XZHFOelF5TkRWc09FcE5PSFJJYUdnMFpuZ3JNa2xMYVFwelFtRmpUa0ZVUTFWbVkzVnFTbGRuYkU5dlZreFZLM0J5Wm1OSmRGUm1SVmQ2TUUxNllXc3dTelF3WW5relFtdG9Rbk5ITlhCSVlWRnNjakZxYjI4NENrMUNNbWhDYlhVdlkwUTNlblVyUXpFMFoyc3daVTE1WlZGWWFYYzVVR05EVm5aRWNHZ3lWVU5uV1VKU05UVjRWelEyU1dsQ05ERlpSazVTTDFKamNFc0tUVzVFUVROVmIwaHZTa1Y2WW1KVFlqUklhMVZTWW5KcWJqRjFVQ3RrWldkWlJESkNMMFI0VmtoelNTOTRVbXBPTjBSRFUxbGhWRzlqVnpWa1VWcGhVUXBqTURKck1tdENRMDA1TDNwc1JHSXhZVEZOT0VsS1FuWnBWRkU0Y25SWk0wRXpOMGRCT1ZaUlJsQXhXbk5yVW01QlpWcFlkMVZhYkcxMFkwdE5SazAyQ2xST1kwTlNNRXgxU21SRmJrWm1kVzVCWm1GTmVsRkxRbWRJTXk5a1owTmlXbWcxTDFCSGJFcEVkR3R2VVRWVmJHbHBNMGQ1UnpoSVMxYzVOVWQwZG1zS2IwczJablJVZUZrNVFXcHlVMkp1YzJKS09TdFdORk5SWlZvMlZVUmlaVGhVZFVOdFZUaFlXWEo1V0d0b2EwaHpWekpCTW5oU2RHaFZhbWN5TVdNclFncFZZU3RUWldsbFkwVmtVRXA2WlhGaVVUUlZiVEppZEV0cVZFazJSRlJGU0RkdlEzYzVjRkZpTXpaWE5sQk9ORlp2Tm5kTFF6QTBOVUZzUkRaNlJuTnpDamRFVHpGQmIwZEJTR2hUYWtoWkwwMDJVR3hVUTB0b2FGaEViMWQxV1RKVGFuSXZUVkZFYm5wWE9URjJUWEJ0WVcweWFXWlZiVXR4VDBWME5rUTNUVGdLZFdObmNtWjRXSGROUkRSRGF6QjRXblYxV0VrMWVGWkxLMUpLU2xsalZWQTJaRU5LYUhaMmVDOUxUVFF4Tmxsd2RUTXpkVTFwZG5KemRuQXhhRXM0UVFwaVMzTmhURVYwYVVGcWVUbFNSbmxJWWpWNFNGQnZMMDV0V205dmJrNDJhR0pHTkRWbGVFZ3ZTVWxZUkRadmQycEpjR2M5Q2kwdExTMHRSVTVFSUZKVFFTQlFVa2xXUVZSRklFdEZXUzB0TFMwdENnPT0K',
        },
        type: CAPI_CLUSTER_SECRET_TYPE,
      });

    const configWithDefaults = new ConfigReader({
      kubernetes: {
        clusterLocatorMethods: [
          {
            type: 'config',
            clusters: [
              {
                name: 'cluster1',
                serviceAccountToken: 'TOKEN',
                url: 'http://cluster.example.com',
              },
            ],
          },
        ],
      },
      catalog: {
        providers: {
          capi: {
            hubClusterName: 'cluster1',
            schedule: {
              frequency: { hours: 1 },
              timeout: { minutes: 50 },
              initialDelay: { seconds: 15 },
            },
            defaults: {
              clusterOwner: 'group:test-team',
              lifecycle: 'staging',
              system: 'test-system',
              tags: ['tag1', 'tag2', 'tag3'],
            },
          },
        },
      },
    });

    const provider = CAPIClusterProvider.fromConfig(configWithDefaults, {
      logger,
      schedule,
    })[0];
    provider.connect(entityProviderConnection);

    await provider.refresh(logger);

    expect(entityProviderConnection.applyMutation).toHaveBeenCalledWith({
      type: 'full',
      entities: [
        {
          locationKey: 'CAPIClusterProvider:default',
          entity: {
            apiVersion: 'backstage.io/v1beta1',
            kind: 'Resource',
            metadata: {
              title: 'cluster3',
              name: 'cluster3',
              annotations: {
                [ANNOTATION_LOCATION]: 'CAPIClusterProvider:default',
                [ANNOTATION_ORIGIN_LOCATION]: 'CAPIClusterProvider:default',
                [ANNOTATION_CAPI_PROVIDER]: 'AWSManagedCluster',
                [ANNOTATION_KUBERNETES_API_SERVER]: 'https://172.18.0.2:6443',
                [ANNOTATION_KUBERNETES_API_SERVER_CA]:
                  'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM2akNDQWRLZ0F3SUJBZ0lCQURBTkJna3Foa2lHOXcwQkFRc0ZBREFWTVJNd0VRWURWUVFERXdwcmRXSmwKY201bGRHVnpNQjRYRFRJek1ETXpNVEUyTVRJMU5Wb1hEVE16TURNeU9ERTJNVGMxTlZvd0ZURVRNQkVHQTFVRQpBeE1LYTNWaVpYSnVaWFJsY3pDQ0FTSXdEUVlKS29aSWh2Y05BUUVCQlFBRGdnRVBBRENDQVFvQ2dnRUJBTjNZCnpZUStuSDdyLy9xUmFDM01uOXJ5bm1SR0RZSzc3OEo4ZWszek9EbW90Z1RyWXIwSGhLUlA3UXF2V3FZTnJxeGEKbWZGWmFhRTRsc2NiMWlrWm9UK1pZdFl2MHNtUFpTRlF1TFNVWE1BcC9uMndvVzlDTHZYZm11L0dpRHBoZERPYwpmQmozbEtudVZEdmRucnpLZ1RtUDVRY3FQUmM4ZXpHS1Fhcnd0QWJVUHZ4QUp5K1BEbDZGSjJPbUtOYkRsQTdiCmQvNC9wNkJOclJCV1pPMHk3RDUzcUdGV3luSG5rSWk4dGxabXcrS0NWaGhleFVISk9ld1dzVGlXRFJzWkFobU0KSHVPdHdFRE1YL3V4aHJycTIxUm5JTVp1R0NGUFR4RkJJbklRNHIwaXhQaXo1VTBSQjhZYkdUNTlqYXdhNkxMcwpBNHYrMjF3clpxZHNXd09CTzc4Q0F3RUFBYU5GTUVNd0RnWURWUjBQQVFIL0JBUURBZ0trTUJJR0ExVWRFd0VCCi93UUlNQVlCQWY4Q0FRQXdIUVlEVlIwT0JCWUVGSmlhUGN5d2lvNXpZNkVMSEJsWWdEdndiR1FlTUEwR0NTcUcKU0liM0RRRUJDd1VBQTRJQkFRQnFkeXVUa2ROcy9JejlDcDNQMGl2eWx4VXFDNFlaMnh5WnIzOGI0ZVhGdzBIbgpVdE1rVlRFTm9nb0RMT0ptNC8rdk9jS3NkemdKTDVFVUc3NlBjMFpxUUk0b29sZW0vdTBYcitNeWtUY25pQ0NFClV2Qmt5RUkrWDRtY09GMzJaOEd0aWoxd1h4bzJ0RERmNlh0TnR4V3VmakwvbGE3QVlaQXFrNkVUTDNpVTdPWHoKUjlHSmhyZEhKT2tXRUUxaVNGMDhMdWxzdEpiZSsyL2tlQUgzdldmREF6SjgvdURUTTlYcEtKeE84R24rWWRHYQo1WlZYcG11anZvb1ptTHdWKy8vSkpBVFBtNGEwRlRaTzNEYTdPUWV1eTkrS1FvYUpkdUxDZERTL3p1Rk5PK3ROCmJxYWlPUUc5Yml6THg5YmpTdHcybUdsMjkrNEp1eUtIOGFsbHpkSWoKLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQo=',
                [ANNOTATION_KUBERNETES_AUTH_PROVIDER]: 'oidc',
              },
              tags: ['tag1', 'tag2', 'tag3'],
            },
            spec: {
              owner: 'group:test-team',
              type: 'kubernetes-cluster',
              lifecycle: 'staging',
              system: 'test-system',
            },
          },
        },
      ],
    });

    expect(scope.isDone()).toBeTruthy();
  });

  describe('when the kubeconfig secret is not available', () => {
    it('creates clusters', async () => {
      const scope = nock('http://cluster.example.com')
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
                },
              },
              spec: {
                controlPlaneRef: {
                  apiVersion: 'controlplane.cluster.x-k8s.io/v1beta2',
                  kind: 'AWSManagedControlPlane',
                  name: 'test-cluster-control-plane',
                },
                infrastructureRef: {
                  apiVersion: 'infrastructure.cluster.x-k8s.io/v1beta2',
                  kind: 'AWSManagedCluster',
                  name: 'test-cluster',
                },
              },
              status: {
                phase: 'provisioning',
              },
            },
          ],
        })
        .get('/api/v1/namespaces/clusters/secrets/cluster1-kubeconfig')
        .reply(404, {});

      const provider = CAPIClusterProvider.fromConfig(config, {
        logger,
        schedule,
      })[0];
      provider.connect(entityProviderConnection);

      await provider.refresh(logger);

      expect(entityProviderConnection.applyMutation).toHaveBeenCalledWith({
        type: 'full',
        entities: [
          {
            locationKey: 'CAPIClusterProvider:default',
            entity: {
              apiVersion: 'backstage.io/v1beta1',
              kind: 'Resource',
              metadata: {
                title: 'cluster1',
                name: 'cluster1',
                annotations: {
                  [ANNOTATION_LOCATION]: 'CAPIClusterProvider:default',
                  [ANNOTATION_ORIGIN_LOCATION]: 'CAPIClusterProvider:default',
                  [ANNOTATION_CAPI_PROVIDER]: 'AWSManagedCluster',
                },
              },
              spec: {
                owner: 'group:test-team',
                type: 'kubernetes-cluster',
                lifecycle: 'production',
              },
            },
          },
        ],
      });

      expect(scope.isDone()).toBeTruthy();
    });
  });
});
