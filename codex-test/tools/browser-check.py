"""使用本机 Edge 无头浏览器，无第三方测试依赖。"""
import subprocess, pathlib, sys, re, html, json, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ROOT = pathlib.Path(__file__).resolve().parents[1]
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
mode = sys.argv[1] if len(sys.argv) > 1 else 'tests'
layout_preview = mode.startswith('layout-') or mode.startswith('mobile-layout-')
screenshot = mode in ('desktop', 'mobile', 'reduced') or layout_preview
page = ROOT / ('index.html' if screenshot else 'tools/bootstrap.html' if mode == 'bootstrap' else 'tests/tests.html')
if mode == 'mobile':
    page = ROOT / 'tools/mobile-preview.html'  # Edge 无头窗口有最小宽度，用精确 360px 的 iframe 截图。
if layout_preview:
    page = ROOT / 'tools/layout-preview.html'
url = page.as_uri()
if layout_preview:
    template = int(mode.split('-')[-1])
    url += f'?template={template}&steps={12 if "mid" in mode else 0}&mobile={1 if mode.startswith("mobile-") else 0}'
args = [EDGE, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-extensions',
        '--user-data-dir=' + str(ROOT / '.browser-test-profile'),
        '--virtual-time-budget=20000', '--dump-dom', url]
if not screenshot:
    args.insert(1, '--allow-file-access-from-files')  # 仅让测试父页面检查本地 iframe。
    if mode == 'tests-reduced':
        args.insert(1, '--force-prefers-reduced-motion=reduce')
else:
    args[1:1] = ['--window-size=' + ('360,1000' if mode.startswith('mobile') else '1200,1100'),
                 '--screenshot=' + str(ROOT / 'tests' / (mode + '.png')),
                 '--force-device-scale-factor=1']
    if mode == 'reduced':
        args.insert(1, '--force-prefers-reduced-motion=reduce')
    if layout_preview:
        args.insert(1, '--allow-file-access-from-files')
result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
dom = result.stdout.decode('utf-8', errors='replace')
if screenshot:
    tiles = len(re.findall('class="tile ', dom))
    if layout_preview:
        preview = re.search(r'<pre id="result"[^>]*>(.*?)</pre>', dom, re.S)
        data = json.loads(html.unescape(preview.group(1)))
        assert data['tiles'] == 36-data['steps'] and not data['overflow'], data
        print(data)
    elif mode != 'mobile':
        assert tiles == 36, f'Expected 36 rendered tiles, got {tiles}'
        capacity = re.search(r'id="tray-count">\d+ / (\d+)', dom)
        assert capacity and len(re.findall('class="slot"', dom)) == int(capacity.group(1))
    assert (ROOT / 'tests' / (mode + '.png')).exists()
    print(f'{mode}: file:// screenshot saved' + ('; test iframe access' if layout_preview else '; no file-access override'))
    sys.exit(0)
match = re.search(r'<pre id="result"[^>]*>(.*?)</pre>', dom, re.S)
if not match:
    print(result.stderr.decode('utf-8', errors='replace')[-4000:])
    print(dom[-2000:])
    sys.exit(1)
output = html.unescape(match.group(1))
if mode == 'bootstrap':
    deal = json.loads(output)
    (ROOT / 'fallback.js').write_text('// 固定备用牌局；每次使用仍通过正式规则验证。\n' +
        'globalThis.AnimalFallbacks = ' + json.dumps(deal, ensure_ascii=False) + ';\n', encoding='utf-8')
    print('Validated fallbacks exported: 3 templates, 36 tiles each')
else:
    print(output)
    filename = 'last-results-reduced.txt' if mode == 'tests-reduced' else 'last-results.txt'
    (ROOT / 'tests' / filename).write_text(output, encoding='utf-8')
    sys.exit(0 if 'ALL PASS' in output else 1)
