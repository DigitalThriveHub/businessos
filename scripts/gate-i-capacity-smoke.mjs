import { performance } from "node:perf_hooks";

const target = process.argv[2];
const requests = Number(process.env.GATE_I_CAPACITY_REQUESTS ?? 100);
const concurrency = Number(process.env.GATE_I_CAPACITY_CONCURRENCY ?? 10);
const maximumP95 = Number(process.env.GATE_I_CAPACITY_P95_MS ?? 1500);

if (!target || !target.startsWith("https://")) {
  throw new Error("Pass the production HTTPS readiness URL.");
}
if (!Number.isInteger(requests) || requests < 20 || requests > 10_000) {
  throw new Error("GATE_I_CAPACITY_REQUESTS must be an integer from 20 to 10000.");
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
  throw new Error("GATE_I_CAPACITY_CONCURRENCY must be an integer from 1 to 100.");
}

const durations = [];
let next = 0;
let failures = 0;

async function worker() {
  while (next < requests) {
    next += 1;
    const started = performance.now();
    try {
      const response = await fetch(target, {
        headers: { "user-agent": "BusinessOS-Gate-I-capacity-smoke/1.0" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) failures += 1;
      await response.arrayBuffer();
    } catch {
      failures += 1;
    } finally {
      durations.push(performance.now() - started);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
durations.sort((left, right) => left - right);
const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Infinity;

console.log(
  JSON.stringify({ target, requests, concurrency, failures, p95Ms: Math.round(p95) }),
);
if (failures > 0) throw new Error(`${failures} capacity probes failed.`);
if (p95 > maximumP95) {
  throw new Error(`Readiness p95 ${Math.round(p95)}ms exceeded ${maximumP95}ms.`);
}
