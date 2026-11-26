const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const androidDir = path.join(rootDir, 'android');
const buildDir = path.join(androidDir, 'build');
const distDir = path.join(rootDir, 'dist');

const sdkDir = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk');
const buildToolsDir = path.join(sdkDir, 'build-tools', '36.0.0');
const androidJar = path.join(sdkDir, 'platforms', 'android-36', 'android.jar');

const aapt2 = path.join(buildToolsDir, 'aapt2.exe');
const d8 = path.join(buildToolsDir, 'd8.bat');
const zipalign = path.join(buildToolsDir, 'zipalign.exe');
const apksigner = path.join(buildToolsDir, 'apksigner.bat');

const jdkBin = 'C:\\Program Files\\Microsoft\\jdk-21.0.12.8-hotspot\\bin';
const javac = path.join(jdkBin, 'javac.exe');
const jar = path.join(jdkBin, 'jar.exe');
const keytool = path.join(jdkBin, 'keytool.exe');

const MIN_SDK = 21;     // Android 5.0 Lollipop
const TARGET_SDK = 36;  // Android 16 (prevents "built for older Android" warning on all modern devices)

function computeVersionCode(versionStr) {
  const parts = String(versionStr || '1.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  return (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
}

function run(cmd, cwd = rootDir) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

async function main() {
  console.log(`--- Building VYRO Android APK (minSdk=${MIN_SDK}, targetSdk=${TARGET_SDK}) ---`);

  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const version = pkg.version || '1.0.4';
  const versionCode = computeVersionCode(version);

  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });

  const resCompiledDir = path.join(buildDir, 'res_compiled');
  const classesDir = path.join(buildDir, 'classes');
  const assetsDir = path.join(androidDir, 'assets', 'www');
  fs.mkdirSync(resCompiledDir, { recursive: true });
  fs.mkdirSync(classesDir, { recursive: true });

  // 1. Sync public/ and app icons assets/ into Android www/
  console.log('Syncing web client and icons into Android assets...');
  fs.rmSync(assetsDir, { recursive: true, force: true });
  copyRecursive(path.join(rootDir, 'public'), assetsDir);
  if (fs.existsSync(path.join(rootDir, 'assets'))) {
    copyRecursive(path.join(rootDir, 'assets'), path.join(assetsDir, 'assets'));
  }

  // 2. Compile resources with aapt2
  console.log('Compiling Android resources with AAPT2...');
  const resDir = path.join(androidDir, 'res');
  run(`"${aapt2}" compile --dir "${resDir}" -o "${resCompiledDir}"`);

  const flatFiles = fs.readdirSync(resCompiledDir)
    .filter((f) => f.endsWith('.flat'))
    .map((f) => `"${path.join(resCompiledDir, f)}"`)
    .join(' ');

  const initialApk = path.join(buildDir, 'app-initial.apk');
  const manifestPath = path.join(androidDir, 'AndroidManifest.xml');

  console.log('Linking Android APK with AAPT2...');
  run(
    `"${aapt2}" link -I "${androidJar}" --manifest "${manifestPath}" ` +
      `--min-sdk-version ${MIN_SDK} --target-sdk-version ${TARGET_SDK} ` +
      `--version-code ${versionCode} --version-name "${version}" ` +
      `${flatFiles} -o "${initialApk}" --auto-add-overlay`
  );

  // 3. Compile Java sources
  console.log('Compiling Java classes...');
  const srcFiles = [
    path.join(androidDir, 'src', 'app', 'vyro', 'chat', 'LocalAssetServer.java'),
    path.join(androidDir, 'src', 'app', 'vyro', 'chat', 'MainActivity.java')
  ].map((f) => `"${f}"`).join(' ');

  run(`"${javac}" -source 1.8 -target 1.8 -bootclasspath "${androidJar}" -d "${classesDir}" ${srcFiles}`);

  // 4. Dex classes with d8
  console.log('Generating DEX bytecode with D8...');
  const classFiles = [];
  function collectClasses(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) collectClasses(full);
      else if (ent.name.endsWith('.class')) classFiles.push(`"${full}"`);
    }
  }
  collectClasses(classesDir);

  run(`"${d8}" --output "${buildDir}" --lib "${androidJar}" --min-api ${MIN_SDK} ${classFiles.join(' ')}`);

  // 5. Add classes.dex and assets to initial APK
  console.log('Packaging DEX and assets into APK...');
  const unalignedApk = path.join(buildDir, 'app-unaligned.apk');
  fs.copyFileSync(initialApk, unalignedApk);
  run(`"${jar}" -uf "${unalignedApk}" -C "${buildDir}" classes.dex`);
  run(`"${jar}" -uf "${unalignedApk}" -C "${androidDir}" assets`);

  // 6. Zipalign
  console.log('Aligning APK with zipalign...');
  const alignedApk = path.join(buildDir, 'app-aligned.apk');
  run(`"${zipalign}" -f -p 4 "${unalignedApk}" "${alignedApk}"`);

  // 7. Ensure Keystore & Sign with v1 + v2 + v3 schemes for all Android versions (5.0 -> 16+)
  // The signing password comes from the VYRO_KEYSTORE_PASS environment variable,
  // so it is never written into the code or the GitHub repo.
  // VYRO_KEYSTORE can point at a keystore kept outside this folder (recommended).
  const keystorePath = process.env.VYRO_KEYSTORE || path.join(androidDir, 'vyro-release.keystore');
  let keystorePass = process.env.VYRO_KEYSTORE_PASS;
  if (!keystorePass) {
    if (fs.existsSync(keystorePath)) {
      // Older keystores were made with this built-in password. Keep them working,
      // but warn: anyone who has seen the old code knows it.
      keystorePass = 'vyroapp123';
      console.warn('WARNING: VYRO_KEYSTORE_PASS is not set, using the old built-in password.');
      console.warn('         Make a new keystore with your own password before publishing (see STORE-RELEASE.md).');
    } else {
      throw new Error('Set VYRO_KEYSTORE_PASS to a strong password before the first build, e.g.  set VYRO_KEYSTORE_PASS=your-own-password');
    }
  }
  process.env.VYRO_KEYSTORE_PASS = keystorePass;
  if (!fs.existsSync(keystorePath)) {
    console.log('Generating release keystore...');
    run(`"${keytool}" -genkeypair -v -keystore "${keystorePath}" -alias vyro -keyalg RSA -keysize 2048 -validity 10000 -storepass:env VYRO_KEYSTORE_PASS -keypass:env VYRO_KEYSTORE_PASS -dname "CN=VYRO, OU=Engineering, O=VYRO, L=London, ST=London, C=GB"`);
  }

  const signedApk = path.join(buildDir, 'VYRO-signed.apk');
  console.log('Signing APK with apksigner (v1 + v2 + v3)...');
  run(
    `"${apksigner}" sign --ks "${keystorePath}" --ks-pass env:VYRO_KEYSTORE_PASS ` +
      `--ks-key-alias vyro --key-pass env:VYRO_KEYSTORE_PASS ` +
      `--min-sdk-version ${MIN_SDK} --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true ` +
      `--out "${signedApk}" "${alignedApk}"`
  );

  // Verify signature & manifest SDK levels
  run(`"${apksigner}" verify --min-sdk-version ${MIN_SDK} "${signedApk}"`);
  run(`"${aapt2}" dump badging "${signedApk}"`);

  // Copy final APK to dist/
  const outStandard = path.join(distDir, 'VYRO.apk');
  const outVersioned = path.join(distDir, `VYRO-${version}.apk`);

  fs.copyFileSync(signedApk, outStandard);
  fs.copyFileSync(signedApk, outVersioned);

  const stats = fs.statSync(outStandard);
  console.log(`\nSUCCESS! APK built and signed for Android ${MIN_SDK}..${TARGET_SDK}:`);
  console.log(`- ${outStandard} (${stats.size.toLocaleString()} bytes)`);
  console.log(`- ${outVersioned}`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
