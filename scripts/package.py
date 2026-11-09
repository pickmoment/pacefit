"""Create a dependency-free unpacked-extension ZIP with manifest.json at its root."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parent.parent
extension = root / 'extension'
version = json.loads((extension / 'manifest.json').read_text())['version']
output = root / f'pacefit-{version}.zip'
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for item in sorted(extension.rglob('*')):
        if item.is_file() and not item.name.startswith('.'):
            archive.write(item, item.relative_to(extension))
print(output)
