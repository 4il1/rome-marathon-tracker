"""B.A.A. Level One plan, transcribed in miles. Distances in {braces} are miles, converted to km by conv()."""
import re

MI = 1.609344

def km(x):
    return f"{x * MI:.1f}"

def rng(s):
    a, _, b = s.partition("-")
    return km(float(a)) + (f"–{km(float(b))}" if b else "")

def conv(t):
    # {a} or {a-b} = miles -> km
    return re.sub(r"\{([\d.]+(?:-[\d.]+)?)\}", lambda m: rng(m.group(1)) + " km", t)

# Session: (type, lo_mi, hi_mi, extra_km, title, detail). Types: rest, xt, easy, aer, q (quality), long
R = ("rest", 0, 0, 0, "Rest", "")
X = ("xt", 0, 0, 0, "Cross or strength", "")
def easy(a, b=None): return ("easy", a, b or a, 0, f"{{{a}{'-'+str(b) if b else ''}}} easy", "")
def aer(a, b=None): return ("aer", a, b or a, 0, f"{{{a}{'-'+str(b) if b else ''}}} aerobic", "")
def q(a, b, title, detail, extra=0, kind="q"): return (kind, a, b, extra, title, detail)

HILL = "{wu} warm up · {n} × ({d} m up at 10K pace, {r} s rest, {d} m down at MP) · 90 s between sets · {wd} warm down"
W = {
 1: ("Prep", [easy(5,6), X, aer(6,7), X, easy(5,6), aer(6,7)]),
 2: ("Prep", [aer(7), X, easy(4,5), X, easy(4,5), aer(9,10)]),
 3: ("Prep", [q(4, 6, "Hill repeats", HILL.format(wu="{2-3}", n=6, d=200, r=30, wd="{2-3}"), extra=2.4),
              X, easy(4,5), X, easy(4,5), aer(9,10)]),
 4: ("Building", [q(6, 8, "{6-8} intervals", "{2-3} warm up · 4 × 1 km at 10K pace, 2 min rest · {2-3} warm down"),
                  X, easy(3,4), X,
                  q(10, 11, "{10-11} with MP", "{3} warm up · 2 × {3} at MP, 2–3 min rest · {1-2} warm down"),
                  easy(3,4)]),
 5: ("Building", [q(7, 8, "{7-8} hills", HILL.format(wu="{2-3}", n=6, d=300, r=30, wd="{2-3}")),
                  X, easy(3,5), X,
                  q(7, 7, "{7} with HMP", "{2} easy · {4} at HMP · {1} easy"),
                  aer(11,12)]),
 6: ("Building", [q(7, 8, "{7-8} intervals", "{2-3} warm up · 5 × 1 km at 10K pace, 2 min rest · {1-2} warm down"),
                  X, R,
                  q(7, 7, "{7} with HMP", "{2} easy · {3-4} at HMP · {1-2} easy"),
                  X,
                  q(12, 14, "{12-14} marathon simulation", "Rolling hills · {5-6} easy · {6-7} at MP · {2} easy", kind="long")]),
 7: ("Building", [q(7, 8, "{7-8} hills", HILL.format(wu="{2-3}", n=6, d=300, r=45, wd="{2}")),
                  X, aer(4,6), X,
                  q(13, 13, "{13} with MP", "{2-3} warm up · 4 × {2} at MP, 2–3 min rest · {2} warm down", kind="long"),
                  easy(4,6)]),
 8: ("Building", [q(7, 8, "{7-8} intervals", "{2-3} warm up · 4 × 1200 m at 10K pace, 2 min rest · {2} warm down"),
                  X, aer(4,6),
                  q(7, 7, "{7} with HMP", "{2} easy · {4} at HMP · {1} easy"),
                  X,
                  q(13, 14, "{13-14} long run", "{6-8} easy · 8 × (2 min at 10K pace + 2 min at MP) · {2} easy", kind="long")]),
 9: ("Building", [q(6, 7, "{6-7} hills", HILL.format(wu="{2-3}", n=6, d=400, r=45, wd="{2}")),
                  X, q(7, 7, "{7} with HMP", "{2} easy · {4} at HMP · {1} easy"),
                  X, easy(4,5), aer(12,13)]),
 10: ("Marathon specific", [q(8, 9, "{8-9} intervals", "{2-3} warm up · 5 × 1200 m at 10K pace, 3 min jog · {2} warm down"),
                  X, aer(4,6), X,
                  q(14, 15, "{14-15} with MP", "{3} warm up · 3 × {3} at MP, 3 min recovery · {1-2} warm down", kind="long"),
                  easy(4,5)]),
 11: ("Marathon specific", [q(8, 9, "{8-9} hills", HILL.format(wu="{2}", n=8, d=400, r=45, wd="{2}")),
                  X, easy(4,5),
                  q(7, 7, "{7} with HMP", "{2} easy · {4} at HMP · {1} easy"),
                  X,
                  q(14, 15, "{14-15} marathon simulation", "Rolling hills · {6-7} easy · {6} at MP · {2} easy", kind="long")]),
 12: ("Marathon specific", [q(7, 8, "{7-8} intervals", "{2} warm up · 4 × {1} at 10K pace, 3 min rest · {1-2} warm down"),
                  X, easy(4,5),
                  q(7, 8, "{7-8} with HMP", "{1-2} warm up · {3} at HMP · 3 min jog · {2} at HMP · {1} warm down"),
                  X, aer(14,15)]),
 13: ("Marathon specific", [q(8, 9, "{8-9} hills", HILL.format(wu="{2-3}", n=8, d=400, r=45, wd="{2}")),
                  X, aer(5,7), X,
                  q(14, 14, "{14} with MP", "{2} warm up · {10} at MP: start a little slower, finish faster · {2} warm down", kind="long"),
                  easy(5,6)]),
 14: ("Marathon specific", [q(7, 8, "{7-8} intervals", "{2} warm up · 4 × {1} at 10K pace, 3 min rest · {1-2} warm down"),
                  X, aer(3,5),
                  q(7, 7, "{7} tempo", "{2} warm up · {3} tempo at HMP · {1} warm down"),
                  X,
                  q(14, 17, "{14-17} marathon simulation", "Rolling hills · {6-8} easy · {6-8} at MP · {1-2} easy", kind="long")]),
 15: ("Marathon specific", [q(8, 9, "{8-9} hills", "{2} warm up · 2 × (800 m up at HMP, 60 s rest, 800 m down at MP), 2 min between sets · 4 × (400 m up at 10K pace, 45 s rest, 400 m down at MP), 90 s between sets · {2} warm down"),
                  X, aer(5,7), X,
                  q(14, 14, "{14} with MP", "{2} warm up · 2 × {5} at MP, 5 min jog · {2} warm down", kind="long"),
                  easy(5,7)]),
 16: ("Marathon specific", [q(7, 7, "{7} intervals", "{2} warm up · 2 × ({1} at HMP + 800 m at 5K pace), 2 min rest · {2} warm down"),
                  X, easy(4,5),
                  q(8, 8, "{8} cut-down", "{2} warm up · {5} at MP: start a little slower, speed up every {2} · {1} warm down"),
                  X, ("long", 12, 14, 0, "{12-14} easy", "Long run at easy pace")]),
 17: ("Marathon specific", [q(8, 8, "{8} hills", "{2} warm up · 4 × (800 m up at HMP, 60 s rest, 800 m down at MP), 2 min between sets · {2} warm down"),
                  X, easy(5,7),
                  q(7, 7, "{7} tempo", "{2} warm up · {4} tempo at HMP · {1} warm down"),
                  X,
                  q(15, 18, "{15-18} marathon simulation", "Rolling hills · {7-8} easy · {7-8} at MP · {1-2} easy", kind="long")]),
 18: ("Marathon specific", [q(7, 7, "{7} intervals", "{2} warm up · 2 × ({1} at HMP + 800 m at 5K pace), 2 min rest · {2} warm down"),
                  X, R, aer(6,8), X,
                  q(13, 14, "{13-14} MP tempo", "{3} warm up · {6-8} MP tempo · {3} warm down", kind="long")]),
 19: ("Taper", [q(7, 8, "{7-8} intervals", "{2} warm up · 5 × 1 km at 10K pace, 2 min rest · {2} warm down"),
                easy(3,5), R,
                q(8, 8, "{8} with HMP", "{2} warm up · 2 × ({2} at HMP + {1} easy) · {2} warm down"),
                R, easy(5,7)]),
 20: ("Taper", [q(6, 6, "{6} sharpener", "{2} warm up · 2 × 800 m at HMP, 90 s rest · 2 × 800 m at 10K pace, 2 min rest · {2} warm down"),
                easy(2,4), R,
                q(5, 5, "{5} with MP", "{2} warm up · {2} at MP · {1} warm down"),
                R, easy(2,3)]),
}
