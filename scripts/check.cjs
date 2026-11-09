const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = ['popup.html', 'popup.css', 'popup.js', manifest.background.service_worker, ...new Set(manifest.content_scripts.flatMap(s => s.js)), ...Object.values(manifest.icons)];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file));
  if (file.endsWith('.js')) new vm.Script(source.toString(), { filename: file });
  if (file.endsWith('.png') && source.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid PNG: ${file}`);
}
if (JSON.stringify(manifest.permissions) !== '["storage","activeTab"]') throw new Error('Unexpected permission');
if (JSON.stringify(manifest.host_permissions) !== '["http://*/*","https://*/*"]') throw new Error('Unexpected host permissions');
console.log(`Manifest, ${files.length} assets, JavaScript syntax, and permissions verified.`);
