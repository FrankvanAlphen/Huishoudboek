#!/usr/bin/env python3
"""Pre-flight validatie voor KPS 3.0 — draai dit vóór elke Railway-deploy.
Gebruik:  python3 scripts/preflight.py
Exit 0 = klaar voor deploy, exit 1 = fouten gevonden.

Deze build is zelfstandig: components/Kps3App.jsx bevat alle UI, data, helpers
en stijlen in één bestand (met 'use client' bovenaan). Er is geen lib/-map.
"""
import re, os, json, sys
from collections import Counter

os.chdir(os.path.join(os.path.dirname(__file__), ".."))
ok = True
def check(label, cond, detail=""):
    global ok
    mark = "OK " if cond else "XX "
    if not cond: ok = False
    print(f"  [{mark}] {label}" + (f" -> {detail}" if detail and not cond else ""))

# 1. Verplichte bestanden aanwezig
required = ["package.json","next.config.js","railway.json","jsconfig.json",".nvmrc",
            ".eslintrc.json",".gitignore","app/layout.js","app/page.js","app/globals.css",
            "components/Kps3App.jsx"]
for f in required:
    check(f"bestand aanwezig: {f}", os.path.exists(f))

# 2. Alle JSON-bestanden valide
for jf in ["package.json","railway.json","jsconfig.json",".eslintrc.json"]:
    try:
        json.load(open(jf)); check(f"valide JSON: {jf}", True)
    except Exception as e:
        check(f"valide JSON: {jf}", False, str(e))

# 3. package.json eisen
pkg = json.load(open("package.json"))
check("start-script bindt op $PORT", "${PORT" in pkg["scripts"]["start"])
check("next ^15", pkg["dependencies"]["next"].startswith("^15"))
check("react ^19", pkg["dependencies"]["react"].startswith("^19"))
check("react-dom ^19", pkg["dependencies"]["react-dom"].startswith("^19"))
check("engines.node gepind", "engines" in pkg and "node" in pkg["engines"])

# 4. railway.json eisen
rw = json.load(open("railway.json"))
check("railway build command", "npm install && npm run build" in rw["build"]["buildCommand"])
check("railway start command", rw["deploy"]["startCommand"] == "npm run start")

# 5. Component-eisen
comp = open("components/Kps3App.jsx").read()
lines = comp.split('\n')
check("'use client' als eerste regel", comp.lstrip().startswith('"use client"'))
check("geen React. referenties", "React." not in comp)
check("named hook-import uit react", 'from "react"' in comp and "useState" in comp)
check("export default function App()", "export default function App()" in comp)

# 6. page.js / layout.js eisen
page = open("app/page.js").read()
check("page importeert Kps3App", "Kps3App" in page and "@/components/Kps3App" in page)
layout = open("app/layout.js").read()
check("layout importeert globals.css", "globals.css" in layout)

# 7. Geen hook NA een conditionele return (Rules of Hooks)
fs = [(i,l) for i,l in enumerate(lines)
      if re.match(r'^(export default )?function [A-Z]\w*\(', l)]
viol = []
for idx,(start,_) in enumerate(fs):
    end = fs[idx+1][0] if idx+1 < len(fs) else len(lines)
    block = lines[start:end]
    seen_cond_return = False
    for j,l in enumerate(block):
        # conditionele return: 'if (...)' gevolgd door 'return' binnen enkele regels
        if re.match(r'^\s{2,4}if \(', l):
            for k in range(j, min(j+6, len(block))):
                if re.search(r'\breturn\b', block[k]):
                    seen_cond_return = True; break
        if seen_cond_return and re.match(r'^\s{2,4}const .*\buse(State|Memo|Ref|Effect|Callback|Reducer)\b', l):
            viol.append(block[0].strip()[:48]); break
check("geen hook na conditionele return", not viol, str(viol))

# 8. Geen dubbele top-level declaraties (const / function)
top_const = re.findall(r'^const (\w+)\s*=', comp, re.M)
dup_const = {k:v for k,v in Counter(top_const).items() if v>1}
check("geen dubbele top-level const", not dup_const, str(dup_const))
top_fn = re.findall(r'^function (\w+)', comp, re.M)
dup_fn = {k:v for k,v in Counter(top_fn).items() if v>1}
check("geen dubbele top-level functie", not dup_fn, str(dup_fn))

# 8b. Kritieke declaraties aanwezig (vangt per ongeluk verwijderde consts —
#     next build vangt zo'n runtime-ReferenceError NIET)
kritiek = ["APP_WACHTWOORD","GEBRUIKERS","KD_BEWAKING","RUBRIEKEN","RUBRIEK_TYPE",
           "genereerActies","berekenKD","initInkooporders","initOaData","initInvloedMMW"]
ontbreekt = [n for n in kritiek if not re.search(rf'^(const|let|function) {n}\b', comp, re.M)]
check("kritieke declaraties aanwezig", not ontbreekt, str(ontbreekt))

# 9. Geen <th> binnen <tbody>
in_tbody = False; thb = []
for i,l in enumerate(lines,1):
    if '<tbody' in l and '/>' not in l: in_tbody = True
    if '</tbody>' in l: in_tbody = False
    if in_tbody and re.search(r'<th[\s>]', l): thb.append(i)
check("geen <th> in <tbody>", not thb, str(thb[:5]))

# 10. Balans van haakjes/accolades/fragmenten per js/jsx-bestand
for fp in [f for f in required if f.endswith(('.js','.jsx'))]:
    s = open(fp).read()
    bal = (s.count('{')==s.count('}') and s.count('(')==s.count(')')
           and s.count('[')==s.count(']') and s.count('<>')==s.count('</>'))
    check(f"balans: {fp}", bal)

# 11. Geen ongeëscapte apostrof in JSX-tekst (react/no-unescaped-entities)
jsx_text_issues = []
for i, l in enumerate(lines, 1):
    for m in re.finditer(r'>([^<>{}]*)<', l):
        txt = m.group(1)
        if any(op in txt for op in ['?', ' : ', '&&', '||', '=>', '==']):
            continue
        if "'" in txt:
            jsx_text_issues.append(i)
check("geen ongeëscapte apostrof in JSX-tekst", not jsx_text_issues, str(jsx_text_issues[:5]))

print()
print("  " + ("ALLE CHECKS GESLAAGD - klaar voor Railway" if ok else "FOUTEN GEVONDEN - niet zippen"))
sys.exit(0 if ok else 1)
