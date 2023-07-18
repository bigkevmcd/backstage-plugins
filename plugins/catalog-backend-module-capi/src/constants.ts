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

// The Provider will apply these annotations to the cluster Resource
export const ANNOTATION_CAPI_PROVIDER = 'cluster.x-k8s.io/capi-provider';

// The Provider will read these annotations off the CAPI Cluster
export const ANNOTATION_CAPI_CLUSTER_LIFECYCLE =
  'cluster.x-k8s.io/cluster-lifecycle';
export const ANNOTATION_CAPI_CLUSTER_OWNER = 'cluster.x-k8s.io/cluster-owner';
export const ANNOTATION_CAPI_CLUSTER_DESCRIPTION =
  'cluster.x-k8s.io/cluster-description';
export const ANNOTATION_CAPI_CLUSTER_SYSTEM = 'cluster.x-k8s.io/cluster-system';
export const ANNOTATION_CAPI_CLUSTER_TAGS = 'cluster.x-k8s.io/cluster-tags';
