import { describe, expect, it } from "bun:test";
import {
    acquireCompartmentLease,
    isCompartmentLeaseHeld,
    releaseCompartmentLease,
    renewCompartmentLease,
} from "./compartment-lease";
import { initializeDatabase } from "./storage-db";
import { Database } from "../../shared/sqlite";

describe("compartment lease", () => {
    it("allows one holder per session and releases explicitly", () => {
        const db = new Database(":memory:");
        initializeDatabase(db);

        expect(acquireCompartmentLease(db, "ses", "holder-a")).not.toBeNull();
        expect(isCompartmentLeaseHeld(db, "ses", "holder-a")).toBe(true);
        expect(acquireCompartmentLease(db, "ses", "holder-b")).toBeNull();

        releaseCompartmentLease(db, "ses", "holder-a");
        expect(isCompartmentLeaseHeld(db, "ses", "holder-a")).toBe(false);
        expect(acquireCompartmentLease(db, "ses", "holder-b")).not.toBeNull();

        db.close();
    });

    it("renews only the current live holder", () => {
        const db = new Database(":memory:");
        initializeDatabase(db);

        expect(acquireCompartmentLease(db, "ses", "holder-a")).not.toBeNull();
        expect(renewCompartmentLease(db, "ses", "holder-a")).toBe(true);
        expect(renewCompartmentLease(db, "ses", "holder-b")).toBe(false);

        db.close();
    });
});
