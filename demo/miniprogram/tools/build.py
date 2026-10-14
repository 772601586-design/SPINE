"""把设计画布导出的交互原型（Prototype.dc.html）转换成微信小程序页面。

- 模板里每个 <sc-if value="{{ s.<screen> }}"> 区块 → pages/<screen>/index.wxml
- sc-if / sc-for → wx:if / wx:for
- div/span/h1… → view / text；button → 带 bindtap 的 view
- onClick / onChange → bindtap / bindinput="act" data-fn="{{ … }}"（见 core/bridge.js）
- 内联 SVG 图标 → image（data URI；颜色随父元素）
- px → rpx（按 390 宽换算到 750rpx）
- 业务逻辑类原样导出为 core/spine-app.js
"""
import re, json, os, sys, base64, urllib.parse
from bs4 import BeautifulSoup, NavigableString, Comment, Tag

SRC, OUT = sys.argv[1], sys.argv[2]
RPX = 750 / 390
src = open(SRC, encoding='utf-8').read()
tpl = src[src.index('</helmet>') + len('</helmet>'): src.index('</x-dc>')]

svgs = []
def _svg(m):
    svgs.append(m.group(0))
    return '<svgph data-i="%d"></svgph>' % (len(svgs) - 1)
tpl = re.sub(r'<svg\b.*?</svg>', _svg, tpl, flags=re.S)
soup = BeautifulSoup(tpl, 'html.parser')

HOLE = re.compile(r'\{\{\s*([^}]+?)\s*\}\}')
STRIP_LABELS = {'返回', '结束跟练', '退出录制'}
TITLES = {
    'welcome': '欢迎', 'stage': '选择治疗阶段', 'basics': '基本信息', 'ready': '准备好了',
    'today': '今日', 'follow': '跟练', 'done': '完成打卡', 'train': '训练', 'record': '现场录动作',
    'import': '导入处方', 'match': '配上录像', 'card': '动作卡片', 'growth': '成长',
    'upload': '添加复查记录', 'community': '社群', 'me': '我的', 'brace': '我的支具', 'rewards': '松果与勋章'
}
ORDER = ['welcome', 'today', 'train', 'growth', 'community', 'me', 'stage', 'basics', 'ready',
         'follow', 'done', 'record', 'import', 'match', 'card', 'upload', 'brace', 'rewards']


def px2rpx(st):
    return re.sub(r'(\d+(?:\.\d+)?)px', lambda m: ('%g' % round(float(m.group(1)) * RPX, 2)) + 'rpx', st)


def conv_style(st, is_input=False):
    st = st.replace('min-height: 844px', 'min-height: 100vh')
    st = re.sub(r"font-family:\s*[^;]+;?\s*", '', st)
    st = re.sub(r"cursor:\s*[^;]+;?\s*", '', st)
    if is_input:
        m = re.search(r'min-height:\s*([\d.]+px)', st)
        if m: st += '; height: ' + m.group(1)
    return px2rpx(st).strip().rstrip(';')


def own_color(style):
    m = re.search(r'(?:^|;)\s*color:\s*([^;]+)', style or '')
    if not m: return None
    v = m.group(1).strip()
    h = HOLE.fullmatch(v)
    return ('hole', h.group(1)) if h else ('lit', v)


class Ctx:
    def __init__(self):
        self.used = set(); self.loopvars = []; self.needs_u = False

    def note(self, text):
        for e in HOLE.findall(text):
            head = e.split('.')[0]
            if head not in ('true', 'false') and head not in self.loopvars:
                self.used.add(head)


def esc_attr(v):
    return v.replace('"', '&quot;')


def svg_image(raw, color, ctx):
    svg = re.sub(r'\saria-hidden="true"', '', raw)
    if 'xmlns=' not in svg:
        svg = svg.replace('<svg', "<svg xmlns='http://www.w3.org/2000/svg'", 1)
    w = re.search(r'\swidth="([\d.]+)"', svg); h = re.search(r'\sheight="([\d.]+)"', svg)
    st = re.search(r'<svg[^>]*\sstyle="([^"]*)"', svg)
    if color is None: color = ('lit', '#1F2A27')
    svg = svg.replace('currentColor', color[1] if color[0] == 'lit' else '{{ %s }}' % color[1])
    svg = svg.replace('"', "'")
    ctx.note(svg)
    parts = HOLE.split(svg)
    if len(parts) == 1:
        uri = 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()
    else:
        ctx.needs_u = True
        out = []
        for i, p in enumerate(parts):
            out.append(urllib.parse.quote(p, safe="=:/;,'()-._~") if i % 2 == 0 else '{{ u.enc(%s) }}' % p)
        uri = 'data:image/svg+xml,' + ''.join(out)
    style = []
    if w: style.append('width: %s' % px2rpx(w.group(1) + 'px'))
    if h: style.append('height: %s' % px2rpx(h.group(1) + 'px'))
    style.append('flex-shrink: 0')
    if st: style.append(conv_style(st.group(1)))
    return '<image src="%s" style="%s" />' % (uri, '; '.join(style))


def emit(node, ctx, color, depth):
    ind = '  ' * depth
    if isinstance(node, Comment):
        return ''
    if isinstance(node, NavigableString):
        t = re.sub(r'\s+', ' ', str(node)).strip()
        if not t: return ''
        ctx.note(t)
        return ind + t + '\n'
    if not isinstance(node, Tag):
        return ''
    tag = node.name
    kids = lambda c=color, d=depth + 1: ''.join(emit(k, ctx, c, d) for k in node.children)

    if tag == 'sc-if':
        v = node.get('value'); ctx.note(v)
        return '%s<block wx:if="%s">\n%s%s</block>\n' % (ind, v, kids(), ind)
    if tag == 'sc-for':
        lst = node.get('list'); ctx.note(lst); as_ = node.get('as')
        ctx.loopvars.append(as_)
        body = kids()
        ctx.loopvars.pop()
        return '%s<block wx:for="%s" wx:for-item="%s" wx:for-index="%sIndex" wx:key="_k">\n%s%s</block>\n' % (ind, lst, as_, as_, body, ind)
    if tag == 'svgph':
        return ind + svg_image(svgs[int(node['data-i'])], color, ctx) + '\n'
    if tag == 'br':
        return ind + "<text>{{'\\n'}}</text>\n"
    if tag == 'button' and node.get('aria-label') in STRIP_LABELS:
        return ''

    style = node.get('style', '')
    c = own_color(style) or color
    attrs = []
    if tag == 'button' and 'display' not in style:
        # 原生 button 默认把内容居中；换成 view 后补上同样的效果
        style = 'display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; ' + style
    if style:
        ctx.note(style)
        attrs.append('style="%s"' % esc_attr(conv_style(style, tag == 'input')))
    for k in ('id', 'aria-label', 'placeholder', 'value'):
        if node.get(k) is not None:
            attrs.append('%s="%s"' % (k, esc_attr(node[k]))); ctx.note(node[k])
    click = node.get('onclick'); change = node.get('onchange')
    if click:
        ctx.note(click); attrs.append('bindtap="act" data-fn="%s" hover-class="tap"' % click)
    if change:
        ctx.note(change); attrs.append('bindinput="act" data-fn="%s"' % change)
    if tag == 'input':
        attrs.append('placeholder-style="color: #8A9A95"')
        return '%s<input %s />\n' % (ind, ' '.join(attrs))
    only_text = all(isinstance(k, NavigableString) for k in node.children)
    wtag = 'text' if (tag == 'span' and only_text and not click) else 'view'
    a = (' ' + ' '.join(attrs)) if attrs else ''
    has_text = any(isinstance(k, NavigableString) and not isinstance(k, Comment) and str(k).strip() for k in node.children)
    if has_text:
        # 含文字的元素写成一行，避免换行和缩进被当成空格显示
        inner = ''.join(emit(k, ctx, c, 0).strip() for k in node.children)
        return '%s<%s%s>%s</%s>\n' % (ind, wtag, a, inner, wtag)
    inner = kids(c)
    if wtag == 'text':
        return '%s<text%s>%s</text>\n' % (ind, a, inner.strip())
    return '%s<view%s>\n%s%s</view>\n' % (ind, a, inner, ind)


pages = {}
for sc in soup.find_all('sc-if'):
    m = re.fullmatch(r'\{\{\s*s\.(\w+)\s*\}\}', sc.get('value', ''))
    if not m: continue
    name = m.group(1)
    ctx = Ctx()
    root = [k for k in sc.children if isinstance(k, Tag)]
    bg = re.search(r'background:\s*(#[0-9A-Fa-f]{6})', root[0].get('style', '')) if root else None
    body = ''.join(emit(k, ctx, own_color(root[0].get('style', '')) if root else None, 0) for k in sc.children)
    pages[name] = dict(wxml=body, keys=sorted(ctx.used), u=ctx.needs_u, bg=bg.group(1) if bg else '#F3F5F2')

assert sorted(pages) == sorted(ORDER), (sorted(pages), sorted(ORDER))

RESET = '''  <view style="padding: 0 38.46rpx 60rpx">
    <view bindtap="resetDemo" hover-class="tap" style="text-align: center; font-size: 24rpx; color: #5B6663; padding: 24rpx; border: 2rpx dashed #C9D4D0; border-radius: 24rpx">重置示例数据，从首次使用重新开始</view>
  </view>
'''

for name, p in pages.items():
    d = os.path.join(OUT, 'pages', name); os.makedirs(d, exist_ok=True)
    wxml = p['wxml']
    if name == 'me':
        i = wxml.rstrip().rfind('</view>')
        wxml = wxml[:i] + RESET + wxml[i:]
    head = '<!-- %s · 由 tools/build.py 从交互原型生成；改界面请改这里或重新生成 -->\n' % TITLES[name]
    if p['u']: head += '<wxs module="u" src="../../core/u.wxs" />\n'
    open(os.path.join(d, 'index.wxml'), 'w').write(head + wxml)
    dark = p['bg'].upper() in ('#143F3A', '#0E1513', '#1F2A27')
    open(os.path.join(d, 'index.json'), 'w').write(json.dumps({
        'navigationBarTitleText': TITLES[name],
        'navigationBarBackgroundColor': p['bg'],
        'navigationBarTextStyle': 'white' if dark else 'black',
        'backgroundColor': p['bg'],
        'usingComponents': {}
    }, ensure_ascii=False, indent=2) + '\n')
    extra = ''
    if name == 'me':
        extra = (", {\n  resetDemo() {\n    wx.showModal({\n      title: '重置示例数据',\n"
                 "      content: '会清空本机上的所有记录，从首次使用重新开始。',\n      confirmText: '重置',\n"
                 "      success: (r) => { if (r.confirm) store.reset(); }\n    });\n  }\n}")
    js = "const { bindPage } = require('../../core/bridge');\n"
    if name == 'me': js += "const store = require('../../core/store');\n"
    js += "\n// %s：本页用到的视图字段（由构建脚本从 WXML 统计）\nPage(bindPage('%s', %s%s));\n" % (
        TITLES[name], name, json.dumps(p['keys'], ensure_ascii=False), extra)
    open(os.path.join(d, 'index.js'), 'w').write(js)

# 业务逻辑
logic = src[src.index('class Component extends DCLogic'): src.rindex('</script>')].rstrip()
logic = logic.replace('class Component extends DCLogic', 'class SpineApp extends DCLogic')
old = "    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];\n  }"
assert logic.count(old) == 1
logic = logic.replace(old, "    // 支具期 / 维持期：按处方和隔天规则排出今天的卡组（见 scheduler.js）\n"
                           "    return Scheduler.buildDeck(this.cards(), HISTORY.lastDone, 0);\n  }")
header = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logic_header.js'), encoding='utf-8').read()
open(os.path.join(OUT, 'core', 'spine-app.js'), 'w').write(header + logic + '\n\nmodule.exports = SpineApp;\n')

json.dump({n: dict(keys=p['keys'], u=p['u'], bg=p['bg']) for n, p in pages.items()},
          open(os.path.join(OUT, 'tools', 'build-report.json'), 'w'), ensure_ascii=False, indent=1)
print('pages', len(pages), 'svgs', len(svgs))
for n in ORDER: print(n, len(pages[n]['keys']), pages[n]['bg'], 'u' if pages[n]['u'] else '')
