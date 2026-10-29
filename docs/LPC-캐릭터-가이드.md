# LPC 픽셀 캐릭터 작업 지침 (Claude용)

> 이 문서는 **Claude(AI 코딩 도우미)가 읽고 따르는 작업 지침**입니다.
> 사용자: 이 파일을 프로젝트 폴더에 넣거나 대화에 첨부한 뒤 "이 문서대로 캐릭터 만들어서 붙여 줘"라고 요청하세요.

---

## 0. 가장 중요한 규칙

- **캐릭터를 코드로 그리지 마세요.** SVG 사각형, CSS box-shadow, canvas `fillRect`, 픽셀 배열 등으로 사람 캐릭터를 직접 그리면 비율과 명암이 어색해져서 사용자가 이미 거절한 결과가 나옵니다.
- 캐릭터 그림은 반드시 **Universal LPC Spritesheet Character Generator**의 그림 조각으로 만든 **PNG 스프라이트 시트**를 씁니다. 이 문서 맨 아래의 `lpc_build.py`를 쓰면 생성기 화면과 픽셀 단위로 똑같은 PNG가 나옵니다.
- 사용자의 실행 환경(일반 HTML, React, Vue, Phaser, Unity, Godot, 노션·구글 사이트 등)은 정해져 있지 않습니다. **먼저 프로젝트 파일을 보고 환경을 파악하고, 파일로 알 수 없으면 사용자에게 물어보세요.**
- 출처 표기는 라이선스상 **필수**입니다(6절).

---

## 1. 기본 캐릭터 2종 (사용자가 고른 디자인)

생성기 주소의 `#` 뒷부분이 캐릭터 조합입니다. 사용자가 따로 바꾸라고 하지 않으면 이 두 조합을 그대로 씁니다.

**남학생**: 주황 머리, 흰 셔츠, 빨간 넥타이, 남색 재킷, 짙은 회색 바지, 검은 구두
```
https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/#sex=male&body=Body_Color_light&head=Human_Male_light&expression=Neutral_light&hair=Bedhead_ginger&clothes=Longsleeve_2_Buttoned_white&neck=Necktie_red&jacket=Collared_coat_navy&legs=Formal_Pants_charcoal&shoes=Basic_Shoes_black
```

**여학생**: 짙은 갈색 앞머리 긴 머리, 베이지 가디건, 빨간 리본, 짙은 회색 치마, 검은 니삭스, 검은 구두
```
https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/#sex=female&body=Body_Color_light&head=Human_Female_light&expression=Neutral_light&hair=Bangslong_dark_brown&clothes=Cardigan_tan&neck=Bowtie_red&legs=Straight_skirt_charcoal&socks=High_Socks_black&shoes=Basic_Shoes_black
```

---

## 2. 작업 순서

1. **환경 파악**: 프로젝트 구조(`package.json`, `index.html`, 엔진 프로젝트 파일 등)를 보고 이미지를 어디에 두고 어떻게 불러오는지 확인합니다.
2. **PNG 만들기**: 아래 둘 중 가능한 방법을 씁니다.
   - **A. 스크립트(권장)**: 이 문서 맨 아래 `lpc_build.py`를 파일로 저장하고 실행합니다. Python 3.8+와 Pillow(`pip install pillow`), 인터넷 연결이 필요합니다.
     ```bash
     python3 lpc_build.py "<1절의 남학생 URL>" boy --anim walk
     python3 lpc_build.py "<1절의 여학생 URL>" girl --anim walk
     ```
     → `boy_walk.png`, `girl_walk.png`가 생깁니다. `--anim walk idle sit run`처럼 여러 동작을 한 번에 만들 수 있습니다.
   - **B. 수동**: 셸을 쓸 수 없거나 인터넷이 막혀 있으면, 사용자에게 1절 링크를 열어 **Download → "ZIP: Split by animation"**(동작별 PNG) 또는 **"Spritesheet (PNG)"**(전체)를 받아 달라고 요청합니다. 생성기 사이트를 브라우저 도구로 조작해 다운로드하는 방법은 파일이 사용자의 다운로드 폴더에 저장되지 않을 수 있어 권장하지 않습니다.
3. **결과 확인**: 만든 PNG를 확대해서 직접 보고, 옷과 색이 1절 설명과 맞는지 확인합니다.
4. **프로젝트에 넣기**: 프로젝트의 정적 파일 위치(예: `public/`, `assets/`, `static/`)에 둡니다.
5. **연결하기**: 3절 규격과 4절 규칙대로 사용자가 원하는 동작을 구현합니다.
6. **출처 표기**: 6절 문구를 사이트 하단이나 크레딧 화면에 넣습니다.

---

## 3. 스프라이트 시트 규격

### 걷기 (`*_walk.png`, 576×256px)
- 한 칸(프레임) **64×64px**
- 가로 **9칸**: 0번 = 서 있기, 1~8번 = 걷기 순환
- 세로 **4줄**, 위에서부터: **0 = 위(뒷모습), 1 = 왼쪽, 2 = 아래(정면), 3 = 오른쪽**
- 프레임 좌표: `sx = frame × 64`, `sy = row × 64`
- 걷기 속도: 프레임당 약 **100ms**(초당 10프레임), 1→8 반복. 멈추면 0번.
- 캐릭터 발끝은 칸 아래쪽에서 약 2px 위에 있습니다. 바닥에 세울 때 `y - 62` 정도로 그립니다.

### 다른 동작
모든 동작이 같은 64px 칸과 같은 방향 줄 순서(위·왼·아래·오른)를 씁니다. 칸 수만 다릅니다.
- `idle`(가만히 숨쉬기): 2칸 → 128×256
- 그 밖에 `run`, `sit`, `jump`, `emote`, `hurt`, `spellcast`, `thrust`, `slash`, `shoot`, `climb`, `watering`, `combat` 등이 있습니다.
- 만든 뒤에는 **PNG 너비 ÷ 64로 칸 수를 직접 확인**하세요.
- 일부 옷은 특정 동작이 없습니다. 예를 들어 남학생 재킷 `Collared_coat`는 `idle`, `run`, `sit`이 없어서, 스크립트가 그 동작에서는 재킷을 빼고 경고를 출력합니다. 그런 동작이 필요하면 사용자에게 알리고 재킷 대신 `clothes`의 다른 상의를 쓰도록 제안하세요.

### 전체 시트 (생성기의 "Spritesheet (PNG)", 832×3456px)
같은 64px 칸으로 동작이 세로로 쌓여 있습니다. 걷기는 **y = 512~767**(9~12번째 줄)입니다.

---

## 4. 어떤 환경이든 지킬 규칙

1. **픽셀이 뭉개지지 않게**
   - CSS: `image-rendering: pixelated;`
   - Canvas: `ctx.imageSmoothingEnabled = false;`
   - Phaser: `pixelArt: true`
   - Unity: Filter Mode **Point**, Compression **None**
   - Godot: Texture Filter **Nearest**
2. **정수 배율**(2×, 3×, 4×)로만 확대합니다. 1.5배처럼 정수가 아닌 배율은 픽셀 크기가 들쭉날쭉해집니다.
3. 좌표는 정수로 반올림해서 그립니다. 소수 좌표로 그리면 번져 보입니다.
4. 여러 캐릭터를 한 화면에 둘 때는 **y값이 큰(아래쪽) 캐릭터를 나중에** 그려야 앞뒤가 자연스럽습니다.

### 참고 구현: 순수 CSS (제자리 걷기)
```css
.sprite {
  width: 64px; height: 64px;
  background: url(girl_walk.png) -64px -128px;   /* 아래 방향, 1번 칸 */
  image-rendering: pixelated;
  transform: scale(3);
  animation: walk-down .8s steps(8) infinite;
}
@keyframes walk-down {
  from { background-position: -64px  -128px; }
  to   { background-position: -576px -128px; }
}
/* 방향은 y만 바꿈: 위 0, 왼쪽 -64px, 아래 -128px, 오른쪽 -192px */
```

### 참고 구현: Canvas 그리기 함수
```js
const ROW = { up: 0, left: 1, down: 2, right: 3 };
function drawChar(ctx, img, x, y, dir, moving, now) {
  const frame = moving ? 1 + Math.floor(now / 100) % 8 : 0;
  ctx.drawImage(img, frame * 64, ROW[dir] * 64, 64, 64,
                Math.round(x - 32), Math.round(y - 62), 64, 64);   // (x, y) = 발 위치
}
```

---

## 5. 캐릭터를 바꾸고 싶을 때

URL의 `#` 뒤는 `키=아이템이름_색` 형식이고, 띄어쓰기는 `_`로 씁니다. 스크립트는 이 URL을 그대로 읽습니다. 이름이 틀리면 `Unknown selection`으로 멈추니, 그때 값을 고치세요. 재킷·안경처럼 색별로 파일이 따로 있는 아이템은 색이 틀리면 고를 수 있는 색 목록을 출력하고, 색을 생략하면 기본색을 씁니다.

| 키 | 교복에 쓸 만한 아이템 이름 |
|---|---|
| `sex` | `male`, `female`, `teen` |
| `head` | `Human_Male`, `Human_Female`, `Human_Male_Small`, `Human_Female_Small` (+ `_light` 등 피부색) |
| `expression` | `Neutral`, `Happy`, `Blush`, `Sad`, `Angry`, `Shock` (+ 피부색, head와 같게) |
| `hair` | `Bedhead`, `Parted`, `Messy1`, `Swoop`, `Bangslong`, `Long_straight`, `Bob`, `Ponytail`, `Pixie`, `Pigtails` |
| `clothes` | `Longsleeve_2_Buttoned`, `Cardigan`, `Longsleeve_Polo`, `Shortsleeve_Polo`, `TShirt` |
| `jacket` | `Collared_coat` (**male 전용**) |
| `neck` | `Necktie`, `Bowtie` |
| `legs` | `Formal_Pants`, `Pants`, `Straight_skirt`, `Plain_skirt` |
| `socks` | `High_Socks`, `Ankle_Socks` |
| `shoes` | `Basic_Shoes` |
| `facial_eyes` | `Glasses`, `Round_Glasses` |

- 피부색: `light`, `amber`, `olive`, `taupe`, `bronze`, `brown`, `black`. `body`, `head`, `expression` 세 곳을 같은 값으로 맞춥니다.
- 머리 색: `ginger`, `carrot`, `dark_brown`, `chestnut`, `light_brown`, `black`, `raven`, `blonde`, `sandy`, `gray`, `navy`, `pink` 등
- 옷 색: `white`, `black`, `navy`, `charcoal`, `gray`, `slate`, `tan`, `brown`, `red`, `maroon`, `blue`, `sky`, `green`, `forest`, `pink`, `yellow` 등
- `Collared_coat`는 다른 색 체계를 씁니다: `navy`, `black`, `charcoal`, `gray`, `brown`, `maroon`, `forest`, `tan`, `white` 등
- 가장 쉬운 방법: 사용자에게 생성기 화면에서 직접 골라 달라고 하고, 바뀐 주소를 받아 스크립트에 넣습니다.

### 그림체의 한계 (사용자에게 미리 알릴 것)
- 2.5~3등신 RPG 그림체입니다. 머리가 매우 큰 SD 스타일은 아닙니다.
- 치마는 모두 무릎 아래 길이입니다.
- `charcoal` 바지는 약간 녹색빛 회색으로 보입니다.

---

## 6. 출처 표기 (필수)

라이선스: **CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0**. 아래 문구를 사이트 하단이나 크레딧 화면에 넣으세요.

```
캐릭터 그림: Universal LPC Spritesheet Character Generator
https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/
작가: bluecarrot16, JaidynReiman, Benjamin K. Smith (BenCreating), Evert, Eliza Wyatt (ElizaWy),
TheraHedwig, MuffinElZangano, Durrani, Johannes Sjölund (wulax), Stephen Challener (Redshrike),
Pierre Vigier (pvigier), Matthew Krohn (makrohn), Sander Frenken (castelonia), dalonedrau, Nila122,
kheftel, Manuel Riecke (MrBeast), Thane Brimhall (pennomi), laetissima, Joe White
라이선스: CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0
```

이 작가 목록은 1절의 두 캐릭터 기준입니다. 아이템을 바꾸면 작가 목록이 달라지니, 생성기에서 **Credits (TXT)** 를 받아 그대로 쓰세요.
CC-BY-SA 3.0 조건 때문에 PNG를 수정해서 배포하면 수정본도 같은 라이선스로 공개해야 합니다. 상업적으로 쓸 계획이라면 사용자에게 이 점을 알리세요.

---

## 부록: `lpc_build.py`

생성기 사이트의 메타데이터(아이템 목록, 레이어 순서, 색 팔레트)를 읽고, 원본 그림 조각을 받아 색을 바꾼 뒤 순서대로 합칩니다. 받은 파일은 스크립트 옆 `.lpc_cache/`에 저장되어 두 번째 실행부터 빠릅니다.

```python
#!/usr/bin/env python3
"""Build an LPC character sprite sheet PNG from a Universal LPC generator URL.

Usage:
  python3 lpc_build.py "<generator URL with #sex=...>" out_name [--anim walk idle ...]

Writes <out_name>_<anim>.png for each animation (default: walk).
Needs: Python 3.8+, Pillow (pip install pillow), internet access.
"""
import argparse, json, os, re, sys, urllib.parse, urllib.request
from PIL import Image

SITE = "https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/"
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".lpc_cache")


def fetch(url, binary=False):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9._-]", "_", url[len(SITE):] or "index.html"))
    if not os.path.exists(f):
        req = urllib.request.Request(url, headers={"User-Agent": "lpc-build"})
        with urllib.request.urlopen(req) as r, open(f, "wb") as out:
            out.write(r.read())
    with open(f, "rb") as fh:
        data = fh.read()
    return data if binary else data.decode("utf-8")


def js_object_to_python(src):
    """Turn the generator's minified `n={...}` / `n=[...]` metadata literal into Python data."""
    start = re.search(r"\bn=[{\[]", src).end() - 1
    depth, i, out, n = 0, start, [], len(src)
    while i < n:
        c = src[i]
        if c == "`":
            j = src.index("`", i + 1)
            text = src[i + 1:j]; i = j + 1
            split = re.match(r"\.split\(`([^`]*)`\)", src[i:])
            if split:  # `a,b,c`.split(`,`) -> ["a","b","c"]
                out.append(json.dumps(text.split(split.group(1)))); i += split.end()
            else:
                out.append(json.dumps(text))
            continue
        if c in "\"'":
            j = i + 1
            while src[j] != c:
                j += 2 if src[j] == "\\" else 1
            out.append(json.dumps(src[i + 1:j])); i = j + 1; continue
        if src.startswith("!0", i): out.append("true"); i += 2; continue
        if src.startswith("!1", i): out.append("false"); i += 2; continue
        if c in "{[": depth += 1
        if c in "}]":
            depth -= 1
            if depth == 0:
                out.append(c); break
        if c.isalpha() or c in "_$":
            j = i
            while j < n and (src[j].isalnum() or src[j] in "_$"): j += 1
            word = src[i:j]
            k = j
            while k < n and src[k] == " ": k += 1
            if k < n and src[k] == ":" and src[i - 1] in "{,":
                out.append(json.dumps(word))
            else:
                out.append({"null": "null", "true": "true", "false": "false", "void": "null"}.get(word, json.dumps(word)))
            i = j; continue
        out.append(c); i += 1
    return json.loads("".join(out))


def load_metadata():
    index = fetch(SITE)
    main = re.search(r'assets/(main-[^"]+\.js)', index).group(1)
    names = set(re.findall(r"([a-z]+-metadata-[A-Za-z0-9_-]+\.js)", fetch(SITE + "assets/" + main)))
    pick = lambda kind: next(x for x in names if x.startswith(kind + "-metadata-"))
    items = js_object_to_python(fetch(SITE + "assets/" + pick("item")))
    layers = js_object_to_python(fetch(SITE + "assets/" + pick("layers")))
    pal_src = fetch(SITE + "assets/" + pick("palette"))
    pal_src = pal_src.replace("var e=", "n=", 1)
    palettes = js_object_to_python(pal_src)["materials"]
    # color lists for items drawn as separate per-color files, indexed by item["v"]
    variants = js_object_to_python(fetch(SITE + "assets/" + pick("index")))
    for it in items.values():
        if not it.get("recolors"):
            it["file_colors"] = variants[it.get("v", 0)]
    return items, layers, palettes


def parse_hash(url):
    frag = urllib.parse.unquote(urllib.parse.urlparse(url).fragment)
    return dict(p.split("=", 1) for p in frag.split("&") if "=" in p)


def resolve(selection, items):
    """Map {type_name: 'Name_With_Underscores_color'} to (item_key, item, color)."""
    out = []
    for type_name, value in selection.items():
        if type_name == "sex":
            continue
        best = None
        for key, it in items.items():
            if it.get("type_name") != type_name:
                continue
            nm = it["name"].replace(" ", "_")
            if value == nm or value.startswith(nm + "_"):
                if not best or len(nm) > len(best[1]["name"]):
                    best = (key, it, value[len(nm) + 1:])
        if not best:
            sys.exit(f"Unknown selection: {type_name}={value}")
        out.append(best)
    return out


def hexrgb(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


def palette(palettes, material, ref):
    version, _, name = ref.rpartition(".")
    return palettes[material]["palettes"][version or "ulpc"][name]


def recolor(img, src, dst):
    m = dict(zip(map(hexrgb, src), map(hexrgb, dst)))
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a and (r, g, b) in m:
                px[x, y] = m[(r, g, b)] + (a,)
    return img


def build(url, anim, items, layers, palettes):
    sel = parse_hash(url)
    sex = sel.get("sex", "male")
    parts = []
    chosen = resolve(sel, items)
    picked_name = {it["type_name"]: it["name"].replace(" ", "_") for _, it, _ in chosen}
    for key, it, color in chosen:
        if anim not in it.get("animations", []) and key != "body":
            print(f"  skip {it['name']}: no '{anim}' animation", file=sys.stderr)
            continue
        for lname, layer in layers[key].items():
            base = layer.get(sex)
            if not base:
                print(f"  skip {it['name']}: not available for {sex}", file=sys.stderr)
                continue
            # e.g. faces use `head/faces/${head}/neutral/`, filled from the chosen head
            for var, table in (it.get("replace_in_path") or {}).items():
                base = base.replace("${" + var + "}", table.get(picked_name.get(var, ""), "male"))
            rc = (it.get("recolors") or [None])[0]
            if rc:
                img = Image.open(fetch_png(base + anim + ".png")).convert("RGBA")
                mat = rc["material"]
                target = color if "." in color else f"{rc.get('default', 'ulpc')}.{color}"
                if color and target != rc["base"]:
                    img = recolor(img, palette(palettes, mat, rc["base"]), palette(palettes, mat, target))
            else:
                options = it.get("file_colors") or []
                if not color and options:
                    color = options[0]
                    print(f"  {it['name']}: no color given, using '{color}'", file=sys.stderr)
                if options and color not in options:
                    sys.exit(f"{it['name']} has no color '{color}'. Options: {', '.join(options)}")
                img = Image.open(fetch_png(f"{base}{anim}/{color.replace(' ', '_')}.png")).convert("RGBA")
            parts.append((layer["zPos"], img))
    parts.sort(key=lambda p: p[0])
    w = max(p[1].width for p in parts); h = max(p[1].height for p in parts)
    sheet = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for _, img in parts:
        sheet.alpha_composite(img)
    return sheet


def fetch_png(path):
    import io
    return io.BytesIO(fetch(SITE + "spritesheets/" + path, binary=True))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("url"); ap.add_argument("out")
    ap.add_argument("--anim", nargs="+", default=["walk"])
    a = ap.parse_args()
    items, layers, palettes = load_metadata()
    for anim in a.anim:
        sheet = build(a.url, anim, items, layers, palettes)
        name = f"{a.out}_{anim}.png"
        sheet.save(name)
        print(f"{name}  {sheet.width}x{sheet.height}")
```
