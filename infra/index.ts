import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// ── Config ────────────────────────────────────────────────────────────────────
const stack  = pulumi.getStack(); // dev | staging | prod
const cfg    = new pulumi.Config();
const region = cfg.get("region") ?? "eu-west-3"; // Paris by default
const keyPair = cfg.require("keyPair");           // EC2 SSH key name (pre-created)

// ── VPC ───────────────────────────────────────────────────────────────────────
const vpc = new aws.ec2.Vpc("phantom-vpc", {
    cidrBlock:          "10.0.0.0/16",
    enableDnsHostnames: true,
    enableDnsSupport:   true,
    tags: { Name: `phantom-vpc-${stack}`, Environment: stack, ManagedBy: "pulumi" },
});

const igw = new aws.ec2.InternetGateway("phantom-igw", {
    vpcId: vpc.id,
    tags: { Name: `phantom-igw-${stack}` },
});

const subnet = new aws.ec2.Subnet("phantom-subnet-public", {
    vpcId:               vpc.id,
    cidrBlock:           "10.0.1.0/24",
    availabilityZone:    `${region}a`,
    mapPublicIpOnLaunch: true,
    tags: { Name: `phantom-subnet-public-${stack}` },
});

const routeTable = new aws.ec2.RouteTable("phantom-rt", {
    vpcId: vpc.id,
    routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: igw.id }],
    tags: { Name: `phantom-rt-${stack}` },
});

new aws.ec2.RouteTableAssociation("phantom-rta", {
    subnetId:     subnet.id,
    routeTableId: routeTable.id,
});

// ── Security Group ────────────────────────────────────────────────────────────
const sg = new aws.ec2.SecurityGroup("phantom-sg", {
    vpcId:       vpc.id,
    description: `phantom-csm ${stack}`,
    ingress: [
        { protocol: "tcp", fromPort: 22,    toPort: 22,    cidrBlocks: ["0.0.0.0/0"],      description: "SSH" },
        { protocol: "tcp", fromPort: 3000,  toPort: 3000,  cidrBlocks: ["0.0.0.0/0"],      description: "API" },
        { protocol: "tcp", fromPort: 15672, toPort: 15672, cidrBlocks: ["0.0.0.0/0"],      description: "RabbitMQ dashboard" },
        { protocol: "tcp", fromPort: 5432,  toPort: 5432,  cidrBlocks: ["10.0.0.0/16"],    description: "Postgres (VPC only)" },
        { protocol: "tcp", fromPort: 6379,  toPort: 6379,  cidrBlocks: ["10.0.0.0/16"],    description: "Redis (VPC only)" },
        { protocol: "tcp", fromPort: 5672,  toPort: 5672,  cidrBlocks: ["10.0.0.0/16"],    description: "RabbitMQ AMQP (VPC only)" },
    ],
    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
    tags: { Name: `phantom-sg-${stack}` },
});

// ── EC2 Instance ──────────────────────────────────────────────────────────────
// Latest Ubuntu 22.04 LTS AMI (Canonical)
const ubuntu = aws.ec2.getAmiOutput({
    mostRecent: true,
    owners: ["099720109477"],
    filters: [
        { name: "name",              values: ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"] },
        { name: "virtualization-type", values: ["hvm"] },
        { name: "architecture",      values: ["x86_64"] },
    ],
});

const instanceType = stack === "prod" ? aws.ec2.InstanceType.T3_Medium
                                      : aws.ec2.InstanceType.T3_Small;

const server = new aws.ec2.Instance("phantom-server", {
    ami:                 ubuntu.id,
    instanceType,
    subnetId:            subnet.id,
    vpcSecurityGroupIds: [sg.id],
    keyName:             keyPair,
    rootBlockDevice: {
        volumeSize:            20,
        volumeType:            "gp3",
        deleteOnTermination:   true,
    },
    tags: { Name: `phantom-${stack}`, Environment: stack, ManagedBy: "pulumi" },
});

// Elastic IP — stable public address (survives stop/start)
const eip = new aws.ec2.Eip("phantom-eip", {
    domain:   "vpc",
    instance: server.id,
    tags: { Name: `phantom-eip-${stack}` },
});

// ── Outputs — consumed by Ansible and CircleCI ────────────────────────────────
export const publicIp    = eip.publicIp;
export const instanceId  = server.id;
export const vpcId       = vpc.id;
export const sgId        = sg.id;

// Convenience: Ansible inventory one-liner
export const ansibleHost = pulumi.interpolate
    `ansible-playbook ansible/playbooks/deploy.yml -e phantom_ip=${eip.publicIp}`;
