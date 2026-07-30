import { describe, test, expect } from "vitest";
import { Csrf } from "../src/index.js";

describe("CSRF Protection", () => {
    test("generates and verifies CSRF token from header", () => {
        let setHeaderCall: { key: string; val: string } | null = null;
        const mockReply: any = {
            header: (key: string, val: string) => {
                setHeaderCall = { key, val };
            },
        };

        const reqForGen: any = { headers: {} };
        const token = Csrf.generateToken(reqForGen, mockReply);

        expect(token).toHaveLength(64);
        expect(setHeaderCall).not.toBeNull();
        expect(setHeaderCall!.val).toContain("XSRF-TOKEN=");

        // Verify valid matching token in header
        const reqValid: any = {
            headers: {
                cookie: `XSRF-TOKEN=${token}`,
                "x-csrf-token": token,
            },
            body: {},
        };
        expect(Csrf.verifyToken(reqValid)).toBe(true);

        // Reject mismatch token
        const reqInvalid: any = {
            headers: {
                cookie: `XSRF-TOKEN=${token}`,
                "x-csrf-token": "wrong-token-1234567890123456789012345678901234567890123456789012345678901234",
            },
            body: {},
        };
        expect(Csrf.verifyToken(reqInvalid)).toBe(false);
    });
});
