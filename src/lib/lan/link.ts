// Home routers hand out a handful of ranges; these cover most of them.
const COMMON_SUBNETS = [
  "192.168.1", "192.168.0", "192.168.31", "192.168.29", "192.168.2", "192.168.10", "192.168.100",
  "192.168.178", "192.168.68", "192.168.86", "192.168.43", "192.168.50", "192.168.4", "192.168.8",
  "10.0.0", "10.0.1", "10.0.2", "10.1.1", "172.20.10", "172.16.0",
];

const subnetOf = (address: string | null | undefined) =>
  address?.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}(:\d+)?$/)?.[1] ?? null;

/** Likeliest subnets first: this computer's, the phone's last known one, then common ones. */
export function candidateSubnets(...hints: (string | null | undefined)[]): string[] {
  const first = hints.map((h) => subnetOf(h) ?? (h && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ? h : null));
  return [...new Set([...first.filter((s): s is string => !!s), ...COMMON_SUBNETS])];
}
