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

import { TaskScheduleDefinitionConfig } from '@backstage/backend-tasks';

export interface Config {
  catalog?: {
    providers?: {
      /**
       * CAPIProvider configuration
       *
       * Uses "default" as default id for the single config variant.
       */
      capi?:
        | {
            /**
             * (Required) Default Cluster Owner if no Annotation is provided on the CAPI cluster.
             */
            defaultClusterOwner: string;
            /**
             * Name of the Cluster to query CAPI Clusters from.
             */
            hubClusterName: string;
            /**
             * (Optional) TaskScheduleDefinition for the refresh.
             */
            schedule?: TaskScheduleDefinitionConfig;
          }
        | Record<
            string,
            {
              /**
               * (Required) Default Cluster Owner if no Annotation is provided on the CAPI cluster.
               */
              defaultClusterOwner: string;
              /**
               * Name of the Cluster to query CAPI Clusters from.
               */
              hubClusterName: string;
              /**
               * (Optional) TaskScheduleDefinition for the refresh.
               */
              schedule?: TaskScheduleDefinitionConfig;
            }
          >;
    };
  };
}
