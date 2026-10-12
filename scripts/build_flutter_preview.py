"""Build a local SDK preview when Flutter CLI cannot spawn its Git subprocess.

Uses Flutter's web bootstrap contract; this is not a replacement for flutter build web.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parent.parent


def main():
    flutter = shutil.which("flutter")
    sdk = Path(os.environ["SPINE_FLUTTER_SDK"]) if os.getenv("SPINE_FLUTTER_SDK") else Path(flutter).parent.parent if flutter else None
    if sdk is None or not (sdk / "bin/cache/flutter_web_sdk").exists():
        raise SystemExit("Set SPINE_FLUTTER_SDK to an installed Flutter SDK directory.")
    web_sdk = sdk / "bin/cache/flutter_web_sdk"
    dart_sdk = sdk / "bin/cache/dart-sdk"
    web = ROOT / ".verification/flutter"
    web.mkdir(parents=True, exist_ok=True)
    entrypoint = ROOT / ".verification/web_entrypoint.dart"
    # See Flutter SDK packages/flutter_tools/lib/src/web/file_generators/main_dart.dart.
    entrypoint.write_text("""import 'dart:ui_web' as ui_web;
import 'package:spine_app/main.dart' as entrypoint;

Future<void> main() async {
  await ui_web.bootstrapEngine(
    runApp: entrypoint.main,
    registerPlugins: () {},
  );
}
""", encoding="utf-8")
    command = [str(dart_sdk / "bin/dartaotruntime.exe"), str(dart_sdk / "bin/snapshots/dart2js_aot.dart.snapshot"),
               "--invoker=flutter_tool", "-DFLUTTER_WEB_USE_SKIA=true",
               f"--libraries-spec={web_sdk / 'libraries.json'}", f"--platform-binaries={web_sdk / 'kernel'}",
               f"--packages={ROOT / 'flutterapp/.dart_tool/package_config.json'}",
               "-o", str(web / "main.dart.js"), str(entrypoint)]
    compiled = subprocess.run(command, cwd=ROOT / "flutterapp", capture_output=True, text=True,
                              encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW)
    print(compiled.stdout)
    if compiled.returncode:
        print(compiled.stderr)
        raise SystemExit(compiled.returncode)
    shutil.copyfile(web_sdk / "flutter_js/flutter.js", web / "flutter.js")
    shutil.copytree(web_sdk / "canvaskit", web / "canvaskit", dirs_exist_ok=True)
    fonts = web / "assets/fonts"
    fonts.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(sdk / "bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf", fonts / "MaterialIcons-Regular.otf")
    manifest = [{"family": "MaterialIcons", "fonts": [{"asset": "fonts/MaterialIcons-Regular.otf"}]}]
    chinese = Path("C:/Windows/Fonts/msyh.ttc")
    if chinese.exists():
        shutil.copyfile(chinese, fonts / "Chinese.ttc")
        manifest.append({"family": "Roboto", "fonts": [{"asset": "fonts/Chinese.ttc"}]})
    (web / "assets/FontManifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (web / "assets/AssetManifest.bin").write_bytes(bytes([13, 0]))
    (web / "assets/AssetManifest.json").write_text("{}", encoding="utf-8")
    revision = (sdk / "bin/cache/engine.stamp").read_text().strip()
    version = hashlib.sha256((web / "main.dart.js").read_bytes()).hexdigest()[:16]
    configuration = json.dumps({"engineRevision": revision, "builds": [{"compileTarget": "dart2js", "renderer": "canvaskit", "mainJsPath": f"main.dart.js?v={version}"}]})
    html = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>SPINE 本地联调</title>
<style>#loading{position:fixed;inset:0;z-index:99999;background:#f5f7f5;padding:40px;font:16px sans-serif;white-space:pre-wrap;overflow:auto}</style>
</head><body><div id="loading">正在加载 SPINE…</div>
<script>
function statusText(text){document.getElementById('loading').textContent=text;}
function failed(error){let node=document.getElementById('loading');if(!node){node=document.createElement('div');node.id='loading';document.body.appendChild(node);}node.textContent='SPINE 页面启动失败\\n'+String(error && (error.stack || error.message) || error)+'\\n请将这段错误发给开发者。';console.error(error);}
window.addEventListener('error',event=>failed(event.error || event.message));
window.addEventListener('unhandledrejection',event=>failed(event.reason));
</script><script src="flutter.js"></script><script>
_flutter.buildConfig=BUILD_CONFIGURATION;
_flutter.loader.load({config:{canvasKitBaseUrl:'canvaskit/'},onEntrypointLoaded:async function(engine){
try{statusText('正在初始化页面引擎…');const runner=await engine.initializeEngine({canvasKitBaseUrl:'canvaskit/'});statusText('正在打开今日页面…');await runner.runApp();document.getElementById('loading')?.remove();}catch(error){failed(error);}
}}).catch(failed);
</script></body></html>"""
    (web / "index.html").write_text(html.replace("BUILD_CONFIGURATION", configuration), encoding="utf-8")
    print("Preview rebuilt with Flutter web engine bootstrap:", version)
    print("Open http://127.0.0.1:5174 and refresh without browser cache.")


if __name__ == "__main__":
    main()
