import * as pulumi from "@pulumi/pulumi";
import * as hcloud from "@pulumi/hcloud";

const stack      = pulumi.getStack();           // dev | staging | prod
const cfg        = new pulumi.Config();
const sshKeyName = cfg.require("sshKeyName");   // Hetzner SSH key name (pre-uploaded)

// CPX12 (2 vCPU, 2 GB) for dev/staging — CPX21 (3 vCPU, 4 GB) for prod
// This VPS is shared: runs phantom-csm services + GitLab CI runner for all projects
const serverType = stack === "prod" ? "cpx21" : "cpx12";

// ── Firewall ──────────────────────────────────────────────────────────────────
const firewall = new hcloud.Firewall("phantom-fw", {
    name: `beny-dev-${stack}`,
    rules: [
        { direction: "in", protocol: "tcp", port: "22",    sourceIps: ["0.0.0.0/0", "::/0"], description: "SSH" },
        { direction: "in", protocol: "tcp", port: "3000",  sourceIps: ["0.0.0.0/0", "::/0"], description: "API" },
        { direction: "in", protocol: "tcp", port: "15672", sourceIps: ["0.0.0.0/0", "::/0"], description: "RabbitMQ dashboard" },
    ],
    labels: { environment: stack, managedBy: "pulumi" },
});

// ── SSH key (already uploaded to Hetzner, we reference it by name) ────────────
const sshKey = hcloud.getSshKeyOutput({ name: sshKeyName });

// ── Server ────────────────────────────────────────────────────────────────────
const server = new hcloud.Server("phantom-server", {
    name:       `beny-dev-${stack}`,
    serverType,
    image:      "ubuntu-22.04",
    location:   "fsn1",   // Falkenstein, Germany — same DC as the dev server
    sshKeys:    [sshKeyName],   // Hetzner accepts the key name directly
    firewallIds: [firewall.id.apply(id => Number(id))],
    labels: { environment: stack, managedBy: "pulumi" },
});

// ── Outputs — consumed by Ansible and CircleCI ────────────────────────────────
export const publicIp  = server.ipv4Address;
export const serverId  = server.id;
export const ansibleHost = pulumi.interpolate
    `ansible-playbook ansible/playbooks/deploy.yml -e phantom_ip=${server.ipv4Address}`;
