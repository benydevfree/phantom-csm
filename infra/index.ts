import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";

const stack = pulumi.getStack();

const network = new docker.Network(`phantom-network`, {
    name: `phantom-network-${stack}`
});

const postgresContainer = new docker.Container(`postgres`, {
    image: "postgres:16",
    name: `phantom-postgres-${stack}`,
    networksAdvanced: [{
        name: network.name,
        aliases: ["postgres"]
    }],
    envs: [
        "POSTGRES_USER=phantom",
        "POSTGRES_PASSWORD=phantom",
        `POSTGRES_DB=phantom_${stack}`
    ],
    ports: [{
        internal: 5432,
        external: 5432
    }],
    restart: "always"
});

const redisContainer = new docker.Container(`redis`, {
    image: "redis:7",
    name: `phantom-redis-${stack}`,
    networksAdvanced: [{
        name: network.name,
        aliases: ["redis"]
    }],
    ports: [{
        internal: 6379,
        external: 6379
    }],
    restart: "always"
});

const rabbitmqContainer = new docker.Container(`rabbitmq`, {
    image: "rabbitmq:3-management",
    name: `phantom-rabbitmq-${stack}`,
    networksAdvanced: [{
        name: network.name,
        aliases: ["rabbitmq"]
    }],
    envs: [
        "RABBITMQ_DEFAULT_USER=phantom",
        "RABBITMQ_DEFAULT_PASS=phantom"
    ],
    ports: [
        { internal: 5672, external: 5672 },
        { internal: 15672, external: 15672 }
    ],
    restart: "always"
});

export const networkName = network.name;
export const postgresContainerName = postgresContainer.name;
export const redisContainerName = redisContainer.name;
export const rabbitmqContainerName = rabbitmqContainer.name;    
