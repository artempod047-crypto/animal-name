"""从用户提供的白底合集裁出完整动物；运行游戏不需要 Python。"""
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
source = Path(r'C:\Users\nolum\Desktop\06cebd18fa9883dba35d5575b64d6451.jpg')
sheet = Image.open(source).convert('RGB')
out = ROOT / 'assets' / 'animals'
out.mkdir(parents=True, exist_ok=True)
sheet.save(ROOT / 'assets' / 'animals-sheet.png')
# 原图并非严格等高网格，逐个边界裁切，避免相邻动物串图。
boxes = {
    'panda': (43, 40, 328, 377),
    'rabbit': (416, 12, 662, 375),
    'elephant': (719, 59, 1092, 376),
    'giraffe': (1144, 5, 1410, 384),
    'lion': (23, 381, 355, 721),
    'penguin': (393, 388, 687, 720),
    'frog': (742, 421, 1057, 721),
    'turtle': (1088, 427, 1433, 710),
    'octopus': (10, 731, 354, 1057),
    'crab': (375, 737, 716, 1049),
    'butterfly': (725, 738, 1086, 1047),
    'bee': (1093, 733, 1435, 1058),
}
preview = Image.new('RGB', (768, 576), 'white')
for i, (name, box) in enumerate(boxes.items()):
    animal = sheet.crop(box)
    animal.thumbnail((232, 232), Image.LANCZOS)
    tile = Image.new('RGB', (256, 256), 'white')
    tile.paste(animal, ((256-animal.width)//2, (256-animal.height)//2))
    tile.save(out / f'{name}.png')
    preview.paste(tile.resize((176, 176)), ((i % 4)*192+8, (i//4)*192))
    ImageDraw.Draw(preview).text(((i % 4)*192+12, (i//4)*192+176), name, fill='#234438')
preview.save(ROOT / 'assets' / 'crop-preview.jpg')
print(f'Original: {sheet.size}; exported {len(boxes)} animals')
