const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

// electron-builder asks us to sign more than we want to pay for. Even with
// build.win.signExts unset it walks resources/app.asar.unpacked and signs every
// .exe it finds (winPackager.js `shouldSignFile`: `file.endsWith(".exe")` is the
// backwards-compatible default), which pulls in bundled third-party binaries --
// rg.exe, codex.exe, claude.exe. Two reasons not to:
//
//   1. Cost. Each pass is a DigiCert KeyLocker call against a fixed yearly
//      allocation. Signing the payload wholesale ran 59 calls per x64 build and
//      exhausted a 1,000-call allocation in nine release runs.
//   2. Provenance. Those binaries already carry their upstream publisher's
//      signature. Replacing it with ours asserts we built them; we didn't.
//
// Windows and SmartScreen attribute the app by the payload executable and the
// installer, so those -- plus the NSIS uninstaller -- are what we sign (#853).
const UNSIGNED_PATH_SEGMENTS = ['app.asar.unpacked', 'swiftshader'];

function isThirdPartyPayloadFile(filePath) {
  const segments = filePath.split(/[\\/]/);
  return UNSIGNED_PATH_SEGMENTS.some(segment => segments.includes(segment));
}

/**
 * Delegate Windows PE signing from electron-builder to DigiCert KeyLocker. This
 * runs before NSIS packages the app, so the payload executable and the
 * installer carry the same trusted Windows publisher.
 */
exports.default = async function signWindows(configuration) {
  const keypairAlias = process.env.DIGICERT_KEYPAIR_ALIAS;
  const allowUnsignedBuild = process.env.ALLOW_UNSIGNED_WINDOWS_BUILD === 'true';
  const smctlPath = process.env.SMCTL_PATH || 'smctl';

  if (!keypairAlias) {
    if (process.env.CI === 'true' && !allowUnsignedBuild) {
      throw new Error('DIGICERT_KEYPAIR_ALIAS is required for Windows CI builds');
    }

    console.warn(`[windows-sign] Skipping ${configuration.path}: DigiCert KeyLocker is not configured`);
    return;
  }

  if (configuration.hash && configuration.hash !== 'sha256') {
    throw new Error(`Unsupported Windows signing hash: ${configuration.hash}`);
  }

  if (isThirdPartyPayloadFile(configuration.path)) {
    console.log(`[windows-sign] Skipping bundled third-party binary ${path.basename(configuration.path)}`);
    return;
  }

  console.log(`[windows-sign] Signing ${configuration.path} with DigiCert KeyLocker`);
  const { stdout, stderr } = await execFileAsync(
    smctlPath,
    [
      'sign',
      '--keypair-alias',
      keypairAlias,
      '--input',
      configuration.path,
      '--simple'
    ],
    {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    }
  );

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
};

exports.isThirdPartyPayloadFile = isThirdPartyPayloadFile;
