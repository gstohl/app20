import { describe, expect, it } from "vitest";
import {
  clearMailAssignment,
  loadMailAssignments,
  saveMailAssignment,
} from "./mail-assignments";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("local message assignments", () => {
  it("stores a device-local address without treating it as proof", () => {
    const storage = new MemoryStorage();
    saveMailAssignment(
      storage,
      "SN_MAIN",
      "0xa11ce",
      "msg-1",
      { address: "0xb0b" },
      10,
    );
    expect(loadMailAssignments(storage, "SN_MAIN", "0xa11ce")["msg-1"]).toEqual({
      messageId: "msg-1",
      address: "0xb0b",
      assignedAt: 10,
    });
    expect(loadMailAssignments(storage, "SN_MAIN", "0xdead")).toEqual({});
    clearMailAssignment(storage, "SN_MAIN", "0xa11ce", "msg-1");
    expect(loadMailAssignments(storage, "SN_MAIN", "0xa11ce")).toEqual({});
  });
});
