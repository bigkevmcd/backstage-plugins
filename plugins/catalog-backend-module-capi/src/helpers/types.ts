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
import { TaskScheduleDefinition } from '@backstage/backend-tasks';
import { KubernetesObject } from '@kubernetes/client-node';

export interface ObjectReference {
  kind: string;
  namespace?: string;
  name?: string;
}

export interface Cluster extends KubernetesObject {
  spec: {
    paused: boolean;
    controlPlaneRef?: ObjectReference;
    infrastructureRef?: ObjectReference;
  };
  status?: {
    phase?: string;
    infrastructureReady: boolean;
    controlPlaneReady: boolean;
  };
}

export type ProviderDefaults = {
  clusterOwner?: string;
  system?: string;
  lifecycle?: string;
  tags?: string[];
};

export type ProviderConfig = {
  id: string;
  hubClusterName: string;
  schedule?: TaskScheduleDefinition;

  defaults?: ProviderDefaults;
};
