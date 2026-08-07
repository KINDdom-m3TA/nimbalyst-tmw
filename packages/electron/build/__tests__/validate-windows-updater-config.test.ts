// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require_ = createRequire(import.meta.url);
const packageJson = require_("../../package.json");
const { isThirdPartyPayloadFile } = require_("../sign-windows.js");

// PR #854 added build.win.signExts, which makes electron-builder run the
// DigiCert signer once per matching file in the staged payload: 59 KeyLocker
// calls per x64 build instead of 3. Nine release runs consumed 2,159 signings
// against a 1,000-call yearly allocation. Nothing in the build surfaces that
// cost, so guard the config shape here.
describe("Windows signing scope", () => {
  it("signs only our own binaries, not the whole payload", () => {
    expect(packageJson.build.win.signExts).toBeUndefined();
  });

  it("routes signing through the DigiCert KeyLocker signer", () => {
    expect(packageJson.build.win.signtoolOptions.sign).toBe(
      "build/sign-windows.js"
    );
    expect(packageJson.build.win.signtoolOptions.signingHashAlgorithms).toEqual(
      ["sha256"]
    );
  });
});

// Paths taken verbatim from the v0.72.4 Windows build logs. electron-builder
// hands the signer every .exe it walks, so the skip rule is the only thing
// keeping bundled vendor binaries from being re-signed with our certificate.
describe("isThirdPartyPayloadFile", () => {
  it.each([
    "D:\\a\\nimbalyst\\nimbalyst\\packages\\electron\\release\\win-unpacked\\resources\\app.asar.unpacked\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex-path\\rg.exe",
    "D:\\a\\nimbalyst\\nimbalyst\\packages\\electron\\release\\win-unpacked\\resources\\app.asar.unpacked\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe",
    "D:\\a\\nimbalyst\\nimbalyst\\packages\\electron\\release\\win-unpacked\\swiftshader\\vk_swiftshader.dll",
  ])("skips bundled vendor binary %s", (filePath) => {
    expect(isThirdPartyPayloadFile(filePath)).toBe(true);
  });

  it.each([
    "D:\\a\\nimbalyst\\nimbalyst\\packages\\electron\\release\\win-unpacked\\Nimbalyst.exe",
    "D:\\a\\nimbalyst\\nimbalyst\\packages\\electron\\release\\Nimbalyst-Windows-x64.exe",
    "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\t-abc\\Uninstall Nimbalyst.exe",
  ])("signs our own binary %s", (filePath) => {
    expect(isThirdPartyPayloadFile(filePath)).toBe(false);
  });

  it("does not skip a payload path that merely contains the segment name", () => {
    expect(
      isThirdPartyPayloadFile(
        "D:\\a\\nimbalyst\\release\\win-unpacked\\app.asar.unpacked.helper\\Nimbalyst.exe"
      )
    ).toBe(false);
  });
});
