import { describe, expect, it } from "vitest";
import { candidateSubnets } from "./link";

describe("subnets", () => {
  it("tries hinted subnets first", () => {
    const subnets = candidateSubnets("192.168.31.70:47621", "10.9.8", null);
    expect(subnets.slice(0, 2)).toEqual(["192.168.31", "10.9.8"]);
    expect(subnets.filter((s) => s === "192.168.31")).toHaveLength(1);
  });
});
