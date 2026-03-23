/**
 * ServalSheets Kubernetes Operator Controller
 *
 * Manages ServalSheetsServer custom resources and their lifecycle.
 * Handles deployment, scaling, and monitoring of ServalSheets instances.
 *
 * Prerequisites:
 * - npm install @kubernetes/client-node
 *
 * Usage:
 * - node dist/k8s/operator/controller.js
 */

import * as k8s from '@kubernetes/client-node';
import { logger } from '../../src/utils/logger.js';

const GROUP = 'servalsheets.io';
const VERSION = 'v1alpha1';
const PLURAL = 'servalsheets-servers';

interface ServalSheetsServerSpec {
  replicas: number;
  image?: {
    repository: string;
    tag: string;
    pullPolicy: string;
  };
  resources?: {
    requests?: { cpu: string; memory: string };
    limits?: { cpu: string; memory: string };
  };
  autoscaling?: {
    enabled: boolean;
    minReplicas: number;
    maxReplicas: number;
    targetCPUUtilizationPercentage: number;
    targetMemoryUtilizationPercentage: number;
    targetRequestRatePerSecond: number;
  };
  config?: {
    oauth?: { enabled: boolean };
    redis?: { enabled: boolean; host?: string; port?: number };
    observability?: { metricsEnabled: boolean; metricsPort: number };
  };
  ingress?: {
    enabled: boolean;
    className?: string;
    host?: string;
    tls?: { enabled: boolean; secretName?: string };
  };
}

interface ServalSheetsServerStatus {
  phase: 'Pending' | 'Running' | 'Failed' | 'Scaling';
  replicas?: number;
  readyReplicas?: number;
  conditions?: Array<{
    type: string;
    status: 'True' | 'False' | 'Unknown';
    lastTransitionTime: string;
    reason?: string;
    message?: string;
  }>;
  observedGeneration?: number;
  lastScaleTime?: string;
  currentMetrics?: {
    cpuUtilization?: number;
    memoryUtilization?: number;
    requestRate?: number;
  };
}

interface ServalSheetsServer {
  apiVersion: string;
  kind: string;
  metadata: k8s.V1ObjectMeta;
  spec: ServalSheetsServerSpec;
  status?: ServalSheetsServerStatus;
}

/**
 * ServalSheets Operator Controller
 */
export class ServalSheetsOperator {
  private kc: k8s.KubeConfig;
  private k8sApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;
  private customApi: k8s.CustomObjectsApi;
  private autoscalingApi: k8s.AutoscalingV2Api;
  private networkingApi: k8s.NetworkingV1Api;
  private metricsApi: k8s.Metrics;
  private watch: k8s.Watch;
  private informer?: k8s.Informer<k8s.KubernetesObject>;

  constructor() {
    this.kc = new k8s.KubeConfig();
    this.kc.loadFromDefault();

    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
    this.autoscalingApi = this.kc.makeApiClient(k8s.AutoscalingV2Api);
    this.networkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api);
    this.metricsApi = new k8s.Metrics(this.kc);
    this.watch = new k8s.Watch(this.kc);
  }

  /**
   * Start the operator
   */
  async start(): Promise<void> {
    logger.info('Starting ServalSheets Operator');

    // Create informer for ServalSheetsServer resources
    const listFn = () => this.customApi.listClusterCustomObject(GROUP, VERSION, PLURAL);

    this.informer = k8s.makeInformer(this.kc, `/apis/${GROUP}/${VERSION}/${PLURAL}`, listFn);

    // Handle add events
    this.informer.on('add', async (obj: k8s.KubernetesObject) => {
      const server = obj as ServalSheetsServer;
      logger.info('ServalSheetsServer added', {
        namespace: server.metadata.namespace,
        name: server.metadata.name,
      });
      await this.reconcile(server);
    });

    // Handle update events
    this.informer.on('update', async (obj: k8s.KubernetesObject) => {
      const server = obj as ServalSheetsServer;
      logger.info('ServalSheetsServer updated', {
        namespace: server.metadata.namespace,
        name: server.metadata.name,
      });
      await this.reconcile(server);
    });

    // Handle delete events
    this.informer.on('delete', async (obj: k8s.KubernetesObject) => {
      const server = obj as ServalSheetsServer;
      logger.info('ServalSheetsServer deleted', {
        namespace: server.metadata.namespace,
        name: server.metadata.name,
      });
      await this.cleanup(server);
    });

    // Handle errors
    this.informer.on('error', (err: Error) => {
      logger.error('Informer error', { error: err.message });
      // Restart informer on error
      setTimeout(() => this.start(), 5000);
    });

    // Start watching
    await this.informer.start();

    logger.info('ServalSheets Operator started');
  }

  /**
   * Reconcile a ServalSheetsServer resource
   */
  private async reconcile(server: ServalSheetsServer): Promise<void> {
    try {
      const namespace = server.metadata.namespace!;
      const name = server.metadata.name!;

      // Update status to Running
      await this.updateStatus(namespace, name, {
        phase: 'Running',
        observedGeneration: server.metadata.generation,
      });

      // Create or update deployment
      await this.reconcileDeployment(server);

      // Create or update service
      await this.reconcileService(server);

      // Create or update HPA if autoscaling enabled
      if (server.spec.autoscaling?.enabled) {
        await this.reconcileHPA(server);
      }

      // Create or update ingress if enabled
      if (server.spec.ingress?.enabled) {
        await this.reconcileIngress(server);
      }

      logger.info('Reconciliation complete', { namespace, name });
    } catch (error) {
      logger.error('Reconciliation failed', {
        namespace: server.metadata.namespace,
        name: server.metadata.name,
        error: error instanceof Error ? error.message : String(error),
      });

      await this.updateStatus(server.metadata.namespace!, server.metadata.name!, {
        phase: 'Failed',
        conditions: [
          {
            type: 'Ready',
            status: 'False',
            lastTransitionTime: new Date().toISOString(),
            reason: 'ReconciliationFailed',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  }

  /**
   * Create or update Deployment
   */
  private async reconcileDeployment(server: ServalSheetsServer): Promise<void> {
    const namespace = server.metadata.namespace!;
    const name = server.metadata.name!;
    const image = server.spec.image || {
      repository: 'servalsheets/server',
      tag: 'latest',
      pullPolicy: 'IfNotPresent',
    };

    const deployment: k8s.V1Deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name,
        namespace,
        labels: {
          app: 'servalsheets',
          'app.kubernetes.io/name': 'servalsheets',
          'app.kubernetes.io/instance': name,
          'app.kubernetes.io/managed-by': 'servalsheets-operator',
        },
      },
      spec: {
        replicas: server.spec.replicas,
        selector: {
          matchLabels: {
            app: 'servalsheets',
            'app.kubernetes.io/instance': name,
          },
        },
        template: {
          metadata: {
            labels: {
              app: 'servalsheets',
              'app.kubernetes.io/instance': name,
            },
          },
          spec: {
            containers: [
              {
                name: 'servalsheets',
                image: `${image.repository}:${image.tag}`,
                imagePullPolicy: image.pullPolicy,
                ports: [
                  { name: 'http', containerPort: 3000, protocol: 'TCP' },
                  {
                    name: 'metrics',
                    containerPort: server.spec.config?.observability?.metricsPort || 9090,
                    protocol: 'TCP',
                  },
                ],
                resources: server.spec.resources,
                env: [
                  { name: 'NODE_ENV', value: 'production' },
                  { name: 'PORT', value: '3000' },
                ],
                livenessProbe: {
                  httpGet: { path: '/health', port: 'http' as any },
                  initialDelaySeconds: 30,
                  periodSeconds: 10,
                },
                readinessProbe: {
                  httpGet: { path: '/health', port: 'http' as any },
                  initialDelaySeconds: 10,
                  periodSeconds: 5,
                },
              },
            ],
          },
        },
      },
    };

    try {
      await this.appsApi.readNamespacedDeployment(name, namespace);
      await this.appsApi.replaceNamespacedDeployment(name, namespace, deployment);
      logger.info('Deployment updated', { namespace, name });
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        await this.appsApi.createNamespacedDeployment(namespace, deployment);
        logger.info('Deployment created', { namespace, name });
      } else {
        throw error;
      }
    }
  }

  /**
   * Create or update Service
   */
  private async reconcileService(server: ServalSheetsServer): Promise<void> {
    const namespace = server.metadata.namespace!;
    const name = server.metadata.name!;

    const service: k8s.V1Service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name,
        namespace,
        labels: {
          app: 'servalsheets',
          'app.kubernetes.io/instance': name,
        },
      },
      spec: {
        type: 'ClusterIP',
        ports: [
          { name: 'http', port: 80, targetPort: 'http' as any, protocol: 'TCP' },
          {
            name: 'metrics',
            port: server.spec.config?.observability?.metricsPort || 9090,
            targetPort: 'metrics' as any,
            protocol: 'TCP',
          },
        ],
        selector: {
          app: 'servalsheets',
          'app.kubernetes.io/instance': name,
        },
      },
    };

    try {
      await this.k8sApi.readNamespacedService(name, namespace);
      await this.k8sApi.replaceNamespacedService(name, namespace, service);
      logger.info('Service updated', { namespace, name });
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        await this.k8sApi.createNamespacedService(namespace, service);
        logger.info('Service created', { namespace, name });
      } else {
        throw error;
      }
    }
  }

  /**
   * Create or update HorizontalPodAutoscaler
   */
  private async reconcileHPA(server: ServalSheetsServer): Promise<void> {
    const namespace = server.metadata.namespace!;
    const name = server.metadata.name!;
    const autoscaling = server.spec.autoscaling!;

    const hpa: k8s.V2HorizontalPodAutoscaler = {
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: {
        name,
        namespace,
      },
      spec: {
        scaleTargetRef: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name,
        },
        minReplicas: autoscaling.minReplicas,
        maxReplicas: autoscaling.maxReplicas,
        metrics: [
          {
            type: 'Resource',
            resource: {
              name: 'cpu',
              target: {
                type: 'Utilization',
                averageUtilization: autoscaling.targetCPUUtilizationPercentage,
              },
            },
          },
          {
            type: 'Resource',
            resource: {
              name: 'memory',
              target: {
                type: 'Utilization',
                averageUtilization: autoscaling.targetMemoryUtilizationPercentage,
              },
            },
          },
        ],
      },
    };

    try {
      await this.autoscalingApi.readNamespacedHorizontalPodAutoscaler(name, namespace);
      await this.autoscalingApi.replaceNamespacedHorizontalPodAutoscaler(name, namespace, hpa);
      logger.info('HPA updated', { namespace, name });
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        await this.autoscalingApi.createNamespacedHorizontalPodAutoscaler(namespace, hpa);
        logger.info('HPA created', { namespace, name });
      } else {
        throw error;
      }
    }
  }

  /**
   * Create or update Ingress
   */
  private async reconcileIngress(server: ServalSheetsServer): Promise<void> {
    const namespace = server.metadata.namespace!;
    const name = server.metadata.name!;
    const ingress = server.spec.ingress!;

    const ingressResource: k8s.V1Ingress = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name,
        namespace,
        annotations: ingress.annotations || {},
      },
      spec: {
        ingressClassName: ingress.className || 'nginx',
        rules: [
          {
            host: ingress.host,
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name,
                      port: { number: 80 },
                    },
                  },
                },
              ],
            },
          },
        ],
        tls:
          ingress.tls?.enabled && ingress.tls.secretName
            ? [{ hosts: [ingress.host!], secretName: ingress.tls.secretName }]
            : undefined,
      },
    };

    try {
      await this.networkingApi.readNamespacedIngress(name, namespace);
      await this.networkingApi.replaceNamespacedIngress(name, namespace, ingressResource);
      logger.info('Ingress updated', { namespace, name });
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        await this.networkingApi.createNamespacedIngress(namespace, ingressResource);
        logger.info('Ingress created', { namespace, name });
      } else {
        throw error;
      }
    }
  }

  /**
   * Update status of ServalSheetsServer
   */
  private async updateStatus(
    namespace: string,
    name: string,
    status: Partial<ServalSheetsServerStatus>
  ): Promise<void> {
    try {
      await this.customApi.patchNamespacedCustomObjectStatus(
        GROUP,
        VERSION,
        namespace,
        PLURAL,
        name,
        { status },
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/merge-patch+json' } }
      );
    } catch (error) {
      logger.error('Failed to update status', {
        namespace,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Cleanup resources when ServalSheetsServer is deleted
   */
  private async cleanup(server: ServalSheetsServer): Promise<void> {
    const namespace = server.metadata.namespace!;
    const name = server.metadata.name!;

    try {
      // Delete deployment
      await this.appsApi.deleteNamespacedDeployment(name, namespace);
      logger.info('Deployment deleted', { namespace, name });
    } catch (error: any) {
      if (error.response?.statusCode !== 404) {
        logger.error('Failed to delete deployment', {
          namespace,
          name,
          error: error.message,
        });
      }
    }

    try {
      // Delete service
      await this.k8sApi.deleteNamespacedService(name, namespace);
      logger.info('Service deleted', { namespace, name });
    } catch (error: any) {
      if (error.response?.statusCode !== 404) {
        logger.error('Failed to delete service', {
          namespace,
          name,
          error: error.message,
        });
      }
    }

    try {
      // Delete HPA if it exists
      await this.autoscalingApi.deleteNamespacedHorizontalPodAutoscaler(name, namespace);
      logger.info('HPA deleted', { namespace, name });
    } catch (error: any) {
      if (error.response?.statusCode !== 404) {
        logger.error('Failed to delete HPA', {
          namespace,
          name,
          error: error.message,
        });
      }
    }

    try {
      // Delete ingress if it exists
      await this.networkingApi.deleteNamespacedIngress(name, namespace);
      logger.info('Ingress deleted', { namespace, name });
    } catch (error: any) {
      if (error.response?.statusCode !== 404) {
        logger.error('Failed to delete ingress', {
          namespace,
          name,
          error: error.message,
        });
      }
    }
  }

  /**
   * Stop the operator
   */
  async stop(): Promise<void> {
    if (this.informer) {
      await this.informer.stop();
    }
    logger.info('ServalSheets Operator stopped');
  }
}

// Start operator if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const operator = new ServalSheetsOperator();
  operator.start().catch((error) => {
    logger.error('Failed to start operator', { error: error.message });
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await operator.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    await operator.stop();
    process.exit(0);
  });
}

export default ServalSheetsOperator;
