/**
 * The tape capture scripts' arguments (tools/tape/capture.ts): the page's address from an id and
 * a port or from a whole URL, where the files go, and the warning when the page drew fewer
 * frames than the recording holds.
 */
import { describe, expect, test } from "bun:test";
import { frameReport, parseArgs, tapeName, tapeUrl } from "../tools/tape/capture.ts";

describe("capture arguments", () => {
  test("the address comes from the id and the port, or from --url whole", () => {
    const a = parseArgs(["sample", "1", "4.5"]);
    expect(a).toEqual({ rest: ["sample", "1", "4.5"], port: 5317, headed: false });
    expect(tapeUrl(a, "sample")).toBe("http://127.0.0.1:5317/?tape=sample");
    expect(tapeUrl(parseArgs(["sample", "--port", "5318"]), "sample", 4.5)).toBe("http://127.0.0.1:5318/?tape=sample&t=4.5");
    const u = parseArgs(["--url", "http://localhost:8080/app/?tape=other&t=9", "--out", "/tmp/x", "--headed"]);
    expect([u.out, u.headed, u.rest]).toEqual(["/tmp/x", true, []]);
    // a recording plays from the top whatever the address held; a still holds its own time
    expect(tapeUrl(u, undefined)).toBe("http://localhost:8080/app/?tape=other");
    expect(tapeUrl(u, undefined, 2)).toBe("http://localhost:8080/app/?tape=other&t=2");
    expect(tapeName(u, undefined)).toBe("other");
    expect(tapeName(a, "sample")).toBe("sample");
    expect(tapeName({ url: "http://x/" }, undefined)).toBe("tape");
  });

  test("mistakes are refused, not guessed at", () => {
    expect(() => parseArgs(["sample", "--port"])).toThrow(/--port needs a value/);
    expect(() => parseArgs(["sample", "--port", "http"])).toThrow(/not a port/);
    expect(() => parseArgs(["sample", "--fast"])).toThrow(/unknown option --fast/);
    expect(() => tapeUrl(parseArgs([]), undefined)).toThrow(/which tape/);
    expect(() => tapeUrl(parseArgs([]), "../etc")).toThrow(/which tape/);
  });
});

describe("the drawn frame rate", () => {
  test("warns only when the page drew fewer frames than the recording holds", () => {
    expect(frameReport(60, 30).warn).toBe(false);
    expect(frameReport(29.6, 30).warn).toBe(false); // a 30 Hz display by the clock
    const slow = frameReport(21, 30);
    expect(slow.warn).toBe(true);
    expect(slow.text).toMatch(/^WARNING: the page drew 21\.0 frames a second; the recording runs at 30\. .*about 30 % of its frames repeat/);
    // no measurement is not a pass
    expect(frameReport(0, 30).warn).toBe(true);
    expect(frameReport(NaN, 30).warn).toBe(true);
  });
});
