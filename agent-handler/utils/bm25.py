"""Keyword search (BM25), so exact terms, names, numbers and acronyms are found even when the meaning-based search misses them.

Words are lower-cased and, when they are plain English letters, lightly stemmed and filtered for stop words. Other scripts
are kept as they are.
"""
import math
import re

_WORD = re.compile(r"\w+", re.UNICODE)
_STOP = frozenset("a an the of in on at to for and or is are was were be been being by with as that this these those it its from which what who whom how when where why do does did can could would should may might will shall than then so such not no into over under between about per via vs".split())
_SUFFIXES = (("ations", "ate"), ("ation", "ate"), ("ies", "y"), ("ing", ""), ("edly", ""), ("ed", ""), ("es", ""), ("ly", ""), ("s", ""))


def _stem(word):
    for suffix, replacement in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: len(word) - len(suffix)] + replacement
    return word


def tokens(text):
    out = []
    for word in _WORD.findall(str(text).lower()):
        if word.isascii() and word.isalpha():
            if word in _STOP:
                continue
            word = _stem(word)
        out.append(word)
    return out


class BM25:
    def __init__(self, texts, k1=1.4, b=0.75):
        self.k1 = k1
        self.b = b
        self.lengths = []
        self.postings = {}   # term -> [(passage index, count)]
        for i, text in enumerate(texts):
            counts = {}
            words = tokens(text)
            for w in words:
                counts[w] = counts.get(w, 0) + 1
            self.lengths.append(len(words))
            for w, c in counts.items():
                self.postings.setdefault(w, []).append((i, c))
        n = len(self.lengths)
        self.average = (sum(self.lengths) / n) if n else 1.0
        self.idf = {w: math.log(1 + (n - len(p) + 0.5) / (len(p) + 0.5)) for w, p in self.postings.items()}

    def scores(self, query):
        """{passage index: score} for passages that share at least one word with the query."""
        out = {}
        for w in set(tokens(query)):
            posting = self.postings.get(w)
            if not posting:
                continue
            idf = self.idf[w]
            for i, f in posting:
                norm = f + self.k1 * (1 - self.b + self.b * self.lengths[i] / self.average)
                out[i] = out.get(i, 0.0) + idf * f * (self.k1 + 1) / norm
        return out

    def ranked(self, query, limit=50):
        s = self.scores(query)
        return sorted(s, key=lambda i: -s[i])[:limit]
