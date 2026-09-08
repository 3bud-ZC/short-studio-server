"""
Generates static weight instances from the bundled OFL variable fonts
(Arabic and Latin).

libass/FreeType render a variable font at its default instance, which is
Regular. Caption styles need real SemiBold / Bold / ExtraBold weights, so the
build snaps named instances out of the variable source once, at image build
time. Nothing here downloads anything: it reads the TTFs bundled in the repo.

Instances of an OFL font remain covered by the original OFL-1.1 licence and
keep the upstream Reserved Font Name.
"""
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

# (source file, output name, axis settings)
INSTANCES = [
    ("NotoKufiArabic-Variable.ttf", "NotoKufiArabic-Bold.ttf", {"wght": 700}),
    ("NotoKufiArabic-Variable.ttf", "NotoKufiArabic-ExtraBold.ttf", {"wght": 800}),
    ("NotoSansArabic-Variable.ttf", "NotoSansArabic-Medium.ttf", {"wght": 500}),
    ("NotoSansArabic-Variable.ttf", "NotoSansArabic-SemiBold.ttf", {"wght": 600}),
    ("Cairo-Variable.ttf", "Cairo-Bold.ttf", {"wght": 700}),
    ("Inter-Variable.ttf", "Inter-Bold.ttf", {"wght": 700}),
    ("Inter-Variable.ttf", "Inter-ExtraBold.ttf", {"wght": 800}),
]


def main(font_dir: str) -> int:
    made = 0
    for source_name, output_name, axes in INSTANCES:
        source = os.path.join(font_dir, source_name)
        output = os.path.join(font_dir, output_name)
        if not os.path.exists(source):
            print(f"SKIP {output_name}: missing {source_name}", file=sys.stderr)
            continue
        if os.path.exists(output):
            print(f"KEEP {output_name}: already present")
            continue
        font = TTFont(source)
        # updateFontNames keeps the family/subfamily records honest so
        # fontconfig and libass resolve "Noto Kufi Arabic Bold" correctly.
        instantiateVariableFont(font, axes, inplace=True, updateFontNames=True)
        font.save(output)
        font.close()
        made += 1
        print(f"MADE {output_name} from {source_name} {axes}")
    print(f"instanced {made} static font(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "."))
