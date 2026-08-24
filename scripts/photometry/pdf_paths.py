"""Extract vector paths from a PDF page, resolving Form XObjects, with the CTM."""
import sys, re
import pypdf
from pypdf.generic import IndirectObject

NUM = re.compile(rb'^[-+]?(\d+\.?\d*|\.\d+)$')

def tokenize(data: bytes):
    out, i, n = [], 0, len(data)
    while i < n:
        ch = data[i:i+1]
        if ch in b' \t\r\n':
            i += 1; continue
        if ch == b'%':
            while i < n and data[i:i+1] not in b'\r\n': i += 1
            continue
        if ch == b'(':  # literal string
            depth, j = 1, i+1
            while j < n and depth:
                if data[j:j+1] == b'\\': j += 2; continue
                if data[j:j+1] == b'(': depth += 1
                elif data[j:j+1] == b')': depth -= 1
                j += 1
            out.append(('str', data[i:j])); i = j; continue
        if ch == b'<' and data[i+1:i+2] != b'<':
            j = data.find(b'>', i); out.append(('str', data[i:j+1])); i = j+1; continue
        if data[i:i+2] == b'<<':
            depth, j = 1, i+2
            while j < n and depth:
                if data[j:j+2] == b'<<': depth += 1; j += 2; continue
                if data[j:j+2] == b'>>': depth -= 1; j += 2; continue
                j += 1
            out.append(('dict', data[i:j])); i = j; continue
        if ch == b'[':
            out.append(('op', b'[')); i += 1; continue
        if ch == b']':
            out.append(('op', b']')); i += 1; continue
        j = i
        while j < n and data[j:j+1] not in b' \t\r\n()[]<>/%': j += 1
        if j == i: j = i+1
        tok = data[i:j]
        if tok.startswith(b'/'): out.append(('name', tok))
        elif NUM.match(tok): out.append(('num', float(tok)))
        else: out.append(('op', tok))
        i = j
    return out

def mat_mul(a, b):
    return (a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3],
            a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3],
            a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5])

def apply(m, x, y):
    return (m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5])

def run(data, resources, ctm, out, depth=0):
    if depth > 6: return
    toks = tokenize(data)
    stack, gs, ctm_stack = [], {'ctm': ctm, 'stroke': None, 'fill': None}, []
    cur, start, subpaths = None, None, []
    for kind, val in toks:
        if kind in ('num',):
            stack.append(val); continue
        if kind in ('name', 'str', 'dict'):
            stack.append(val); continue
        op = val
        if op == b'q':
            ctm_stack.append(dict(gs))
        elif op == b'Q':
            if ctm_stack: gs = ctm_stack.pop()
        elif op == b'cm' and len(stack) >= 6:
            gs['ctm'] = mat_mul(tuple(stack[-6:]), gs['ctm'])
        elif op == b'm' and len(stack) >= 2:
            cur = [apply(gs['ctm'], stack[-2], stack[-1])]; subpaths.append(cur)
        elif op == b'l' and len(stack) >= 2 and cur is not None:
            cur.append(apply(gs['ctm'], stack[-2], stack[-1]))
        elif op in (b'c',) and len(stack) >= 6 and cur is not None:
            # flatten a cubic with a few samples
            p0 = cur[-1]
            p1 = apply(gs['ctm'], stack[-6], stack[-5])
            p2 = apply(gs['ctm'], stack[-4], stack[-3])
            p3 = apply(gs['ctm'], stack[-2], stack[-1])
            for k in range(1, 9):
                t = k/8
                u = 1-t
                cur.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],
                            u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
        elif op in (b'v', b'y') and len(stack) >= 4 and cur is not None:
            p3 = apply(gs['ctm'], stack[-2], stack[-1]); cur.append(p3)
        elif op == b're' and len(stack) >= 4:
            x, y, w, h = stack[-4:]
            pts = [apply(gs['ctm'], x, y), apply(gs['ctm'], x+w, y),
                   apply(gs['ctm'], x+w, y+h), apply(gs['ctm'], x, y+h)]
            pts.append(pts[0]); subpaths.append(pts); cur = None
        elif op == b'h' and cur:
            cur.append(cur[0])
        elif op in (b'scn', b'SCN', b'rg', b'RG', b'k', b'K', b'g', b'G'):
            nums = [v for v in stack if isinstance(v, float)]
            color = tuple(round(v, 3) for v in nums[-4:]) if nums else None
            if op in (b'SCN', b'RG', b'K', b'G'): gs['stroke'] = color
            else: gs['fill'] = color
        elif op in (b'S', b's', b'f', b'F', b'f*', b'B', b'B*', b'b', b'n'):
            for sp in subpaths:
                if len(sp) > 1:
                    out.append({'pts': sp, 'op': op.decode(), 'stroke': gs['stroke'], 'fill': gs['fill']})
            subpaths, cur = [], None
        elif op == b'Do' and stack:
            name = stack[-1]
            try:
                xo = resources['/XObject'][name.decode() if isinstance(name, bytes) else name]
                xo = xo.get_object()
                if xo.get('/Subtype') == '/Form':
                    m = xo.get('/Matrix', [1, 0, 0, 1, 0, 0])
                    inner = mat_mul(tuple(float(v) for v in m), gs['ctm'])
                    run(xo.get_data(), xo.get('/Resources', resources), inner, out, depth+1)
            except Exception as e:
                pass
        if op not in (b'[', b']'):
            stack = []
    return out

def page_paths(path, index):
    reader = pypdf.PdfReader(path)
    page = reader.pages[index]
    out = []
    run(page.get_contents().get_data(), page['/Resources'], (1, 0, 0, 1, 0, 0), out)
    return out

if __name__ == '__main__':
    paths = page_paths(sys.argv[1], int(sys.argv[2]))
    print('paths', len(paths))
    from collections import Counter
    print(Counter(p['op'] for p in paths))
    print(Counter(p['stroke'] for p in paths).most_common(8))
