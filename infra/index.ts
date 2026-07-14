import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";

// ── Config ─────────────────────────────────────────────────────────────────
const stack = pulumi.getStack(); // dev | staging | prod
const cfg = new pulumi.Config();

const imageTag = cfg.get("imageTag") ?? "latest";
const jwtSecret = cfg.requireSecret("jwtSecret");

// ── Network (all containers talk on this bridge) ───────────────────────────
const network = new docker.Network("phantom-network", {
    name: `phantom-${stack}`,
});

// ── Volumes (data persistence across restarts) ─────────────────────────────
const pgVolume = new docker.Volume("postgres-data", {
    name: `phantom-postgres-data-${stack}`,
});

// ── Postgres ───────────────────────────────────────────────────────────────
const postgres = new docker.Container("postgres", {
    name: `phantom-postgres-${stack}`,
    image: "postgres:16-alpine",
    networksAdvanced: [{ name: network.name, aliases: ["postgres"] }],
    envs: [
        "POSTGRES_USER=phantom",
        "POSTGRES_PASSWORD=phantom",
        `POSTGRES_DB=phantom_${stack}`,
    ],
    volumes: [{ volumeName: pgVolume.name, containerPath: "/var/lib/postgresql/data" }],
    ports: [{ internal: 5432, external: 5432 }],
    healthcheck: {
        tests: ["CMD-SHELL", "pg_isready -U phantom"],
        interval: "5s",
        timeout: "5s",
        retries: 10,
    },
    restart: "unless-stopped",
});

// ── Redis ─────────────────────────────────────────────────────────────────
const redis = new docker.Container("redis", {
    name: `phantom-redis-${stack}`,
    image: "redis:7-alpine",
    networksAdvanced: [{ name: network.name, aliases: ["redis"] }],
    ports: [{ internal: 6379, external: 6379 }],
    healthcheck: {
        tests: ["CMD", "redis-cli", "ping"],
        interval: "5s",
        timeout: "3s",
        retries: 5,
    },
    restart: "unless-stopped",
});

// ── RabbitMQ ──────────────────────────────────────────────────────────────
const rabbitmq = new docker.Container("rabbitmq", {
    name: `phantom-rabbitmq-${stack}`,
    image: "rabbitmq:3-management-alpine",
    networksAdvanced: [{ name: network.name, aliases: ["rabbitmq"] }],
    envs: [
        "RABBITMQ_DEFAULT_USER=phantom",
        "RABBITMQ_DEFAULT_PASS=phantom",
    ],
    ports: [
        { internal: 5672, external: 5672 },
        { internal: 15672, external: 15672 },
    ],
    healthcheck: {
        tests: ["CMD", "rabbitmq-diagnostics", "-q", "ping"],
        interval: "10s",
        timeout: "5s",
        retries: 10,
    },
    restart: "unless-stopped",
});

// ── Common env vars shared by API and Worker ───────────────────────────────
const sharedEnvs = pulumi.all([
    postgres.name,
    redis.name,
    rabbitmq.name,
    jwtSecret,
]).apply(([pg, rd, mq, secret]) => [
    `DATABASE_URL=postgresql://phantom:phantom@postgres:5432/phantom_${stack}`,
    `RABBITMQ_URL=amqp://phantom:phantom@rabbitmq:5672`,
    `REDIS_URL=redis://redis:6379`,
    `JWT_SECRET=${secret}`,
    "NODE_ENV=production",
]);

// ── API ──────────────────────────────────────────────────────────────────
const api = new docker.Container("api", {
    name: `phantom-api-${stack}`,
    image: `benydevfree/phantom-csm:${imageTag}`,
    networksAdvanced: [{ name: network.name, aliases: ["api"] }],
    envs: sharedEnvs,
    ports: [{ internal: 3000, external: 3000 }],
    healthcheck: {
        tests: ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"],
        interval: "15s",
        timeout: "5s",
        startPeriod: "10s",
        retries: 3,
    },
    restart: "unless-stopped",
}, { dependsOn: [postgres, redis, rabbitmq] });

// ── Worker ────────────────────────────────────────────────────────────────
const worker = new docker.Container("worker", {
    name: `phantom-worker-${stack}`,
    image: `benydevfree/phantom-csm:${imageTag}`,
    networksAdvanced: [{ name: network.name, aliases: ["worker"] }],
    envs: sharedEnvs,
    commands: ["node", "dist/worker.js"],
    restart: "unless-stopped",
}, { dependsOn: [postgres, rabbitmq] });

// ── Outputs (consumed by CI/CD or other Pulumi stacks) ────────────────────
export const networkName        = network.name;
export const apiContainerName   = api.name;
export const workerContainerName = worker.name;
export const apiUrl             = pulumi.interpolate`http://localhost:3000`;
export const rabbitmqDashboard  = pulumi.interpolate`http://localhost:15672`;

/*
 * Production upgrade path:
 * Switch `@pulumi/docker` → `@pulumi/aws` to provision:
 *   - aws.ecr.Repository          (image registry)
 *   - aws.ecs.Cluster + TaskDef   (containers on Fargate)
 *   - aws.rds.Instance            (managed Postgres)
 *   - aws.elasticache.Cluster     (managed Redis)
 *   - aws.mq.Broker               (managed RabbitMQ)
 *   - aws.alb.LoadBalancer        (HTTPS ingress)
 * Same Pulumi API, same stack/config abstraction — provider swap only.
 */
