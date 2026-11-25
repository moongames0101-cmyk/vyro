const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const androidDir = path.join(rootDir, 'android');
const buildDir = path.join(androidDir, 'build');
const distDir = path.join(rootDir, 'dist');

const sdkDir = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk');
const buildToolsDir = path.join(sdkDir, 'build-tools', '34.0.0');
const androidJar = path.join(sdkDir, 'platforms', 'android-34', 'android.jar');

const aapt2 = path.join(buildToolsDir, 'aapt2.exe');
const d8 = path.join(buildToolsDir, 'd8.bat');
const zipalign = path.join(buildToolsDir, 'zipalign.exe');
const apksigner = path.join(buildToolsDir, 'apksigner.bat');

const jdkBin = 'C:\\Program Files\\Microsoft\\jdk-21.0.12.8-hotspot\\bin';
const javac = path.join(jdkBin, 'javac.exe');
const jar = path.join(jdkBin, 'jar.exe');
const keytool = path.join(jdkBin, 'keytool.exe');

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
  console.log('--- Building VYRO Android APK ---');

  // Clean build dir
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });

  const resCompiledDir = path.join(buildDir, 'res_compiled');
  const classesDir = path.join(buildDir, 'classes');
  const assetsDir = path.join(androidDir, 'assets', 'www');
  fs.mkdirSync(resCompiledDir, { recursive: true });
  fs.mkdirSync(classesDir, { recursive: true });

  // 1. Sync public files to assets/www
  console.log('Syncing web client into Android assets...');
  fs.rmSync(assetsDir, { recursive: true, force: true });
  copyRecursive(path.join(rootDir, 'public'), assetsDir);

  // 2. Compile resources with aapt2
  console.log('Compiling Android resources with AAPT2...');
  const resDir = path.join(androidDir, 'res');
  run(`"${aapt2}" compile --dir "${resDir}" -o "${resCompiledDir}"`);

  // Collect compiled .flat files
  const flatFiles = fs.readdirSync(resCompiledDir)
    .filter(f => f.endsWith('.flat'))
    .map(f => `"${path.join(resCompiledDir, f)}"`)
    .join(' ');

  const initialApk = path.join(buildDir, 'app-initial.apk');
  const manifestPath = path.join(androidDir, 'AndroidManifest.xml');

  console.log('Linking Android APK with AAPT2...');
  run(`"${aapt2}" link -I "${androidJar}" --manifest "${manifestPath}" ${flatFiles} -o "${initialApk}" --auto-add-overlay`);

  // 3. Compile Java sources
  console.log('Compiling Java classes...');
  const srcFiles = [
    path.join(androidDir, 'src', 'app', 'vyro', 'chat', 'LocalAssetServer.java'),
    path.join(androidDir, 'src', 'app', 'vyro', 'chat', 'MainActivity.java')
  ].map(f => `"${f}"`).join(' ');

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

  run(`"${d8}" --output "${buildDir}" --lib "${androidJar}" --min-api 26 ${classFiles.join(' ')}`);

  // 5. Add classes.dex and assets to initial APK
  console.log('Packaging DEX and assets into APK...');
  const unalignedApk = path.join(buildDir, 'app-unaligned.apk');
  fs.copyFileSync(initialApk, unalignedApk);

  // Add classes.dex
  run(`"${jar}" -uf "${unalignedApk}" -C "${buildDir}" classes.dex`);

  // Add assets/
  run(`"${jar}" -uf "${unalignedApk}" -C "${androidDir}" assets`);

  // 6. Zipalign
  console.log('Aligning APK with zipalign...');
  const alignedApk = path.join(buildDir, 'app-aligned.apk');
  run(`"${zipalign}" -f -p 4 "${unalignedApk}" "${alignedApk}"`);

  // 7. Ensure Keystore & Sign with apksigner
  const keystorePath = path.join(androidDir, 'vyro-release.keystore');
  if (!fs.existsSync(keystorePath)) {
    console.log('Generating release keystore...');
    run(`"${keytool}" -genkeypair -v -keystore "${keystorePath}" -alias vyro -keyalg RSA -keysize 2048 -validity 10000 -storepass vyroapp123 -keypass vyroapp123 -dname "CN=VYRO, OU=Engineering, O=VYRO, L=London, ST=London, C=GB"`);
  }

  console.log('Signing APK with apksigner...');
  run(`"${apksigner}" sign --ks "${keystorePath}" --ks-pass pass:vyroapp123 --ks-key-alias vyro --key-pass pass:vyroapp123 --out "${path.join(buildDir, 'VYRO-signed.apk')}" "${alignedApk}"`);

  // Verify
  run(`"${apksigner}" verify "${path.join(buildDir, 'VYRO-signed.apk')}"`);

  // Copy final APK to dist/
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const version = pkg.version || '1.0.3';
  const outStandard = path.join(distDir, 'VYRO.apk');
  const outVersioned = path.join(distDir, `VYRO-${version}.apk`);

  fs.copyFileSync(path.join(buildDir, 'VYRO-signed.apk'), outStandard);
  fs.copyFileSync(path.join(buildDir, 'VYRO-signed.apk'), outVersioned);

  const stats = fs.statSync(outStandard);
  console.log(`\nSUCCESS! APK built and signed successfully:`);
  console.log(`- ${outStandard} (${stats.size.toLocaleString()} bytes)`);
  console.log(`- ${outVersioned}`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
