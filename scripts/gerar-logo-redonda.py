# Gera a logo redonda (simbolo dos graficos num circulo azul-escuro com aro verde) usada na barra
# lateral, na aba do navegador (favicon) e no icone do app.
#   python scripts/gerar-logo-redonda.py public/brand/logo-symbol-transparent.png public/brand/logo-redonda.png
# Gera tambem os tamanhos -512, -192, -180, -64, -32, -16 e um .ico.
import sys
from PIL import Image, ImageDraw, ImageFilter
SIMBOLO = sys.argv[1]; SAIDA = sys.argv[2]
ARO = (129, 174, 71)  # verde do aro
FUNDO = (9, 35, 50)

N = 1024  # desenha grande e reduz (bordas lisas)
img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.ellipse((0, 0, N - 1, N - 1), fill=FUNDO + (255,))
borda = int(N * 0.024); folga = int(N * 0.055)
d.ellipse((folga, folga, N - 1 - folga, N - 1 - folga), outline=ARO + (255,), width=borda)

s = Image.open(SIMBOLO).convert('RGBA')
# corta as sobras transparentes
s = s.crop(s.getbbox())
px = s.load()
for y in range(s.size[1]):
    for x in range(s.size[0]):
        r, g, b, a = px[x, y]
        claro = min(r, g, b) > 150 and max(r, g, b) - min(r, g, b) < 60
        if a < 110 or claro:  # sobra do fundo branco (quadrado e contorno claro) -> transparente
            px[x, y] = (0, 0, 0, 0)
        elif r < 70 and g < 80 and b < 100:  # linha escura -> branca, como na referencia
            px[x, y] = (255, 255, 255, a)
        else:
            px[x, y] = (r, g, b, 255)
lado = int(N * 0.6)
esc = lado / max(s.size)
s = s.resize((int(s.size[0] * esc), int(s.size[1] * esc)), Image.LANCZOS)
img.alpha_composite(s, ((N - s.size[0]) // 2, (N - s.size[1]) // 2))
img.save(SAIDA)
for tam in (512, 192, 180, 64, 32, 16):
    img.resize((tam, tam), Image.LANCZOS).save(SAIDA.replace('.png', f'-{tam}.png'))
img.resize((256, 256), Image.LANCZOS).save(SAIDA.replace('.png', '.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print('ok')
