"""The one saved script an agent works on: written once, then changed with small exact edits, shown a section at a
time, and snapshotted after every run that works, so a broken edit can never lose a version that ran."""
import shutil
from pathlib import Path

SHOW_LIMIT = 80   # lines shown at most by one show()


class ScriptFile:
    def __init__(self, path):
        self.path = Path(path)
        self.snapshots = self.path.parent / "snapshots"
        self.count = 0

    @property
    def text(self):
        return self.path.read_text(encoding="utf-8") if self.path.exists() else None

    def write(self, code):
        self.path.write_text(code, encoding="utf-8")
        return f"Saved the script ({len(code.splitlines())} lines)."

    def edit(self, old, new):
        """Replace one exact piece of the script. Refuses a piece found 0 times or more than once."""
        text = self.text
        if text is None:
            return False, "There is no script yet. Write it first with write(code)."
        if not old:
            return False, "old is empty. Copy the exact lines to replace from show()."
        found = text.count(old)
        if found == 0:
            return False, "That text is not in the script, so nothing changed. Copy it exactly from show(), spaces included."
        if found > 1:
            lines = [i + 1 for i, line in enumerate(text.splitlines()) if old.splitlines()[0] in line]
            return False, (f"That text is in the script {found} times (lines {', '.join(map(str, lines[:8]))}), so nothing "
                           "changed. Include more of the lines around it so it matches once.")
        self.path.write_text(text.replace(old, new, 1), encoding="utf-8")
        line = text[:text.index(old)].count("\n") + 1
        return True, f"Changed line {line}: {len(old.splitlines())} line(s) replaced by {len(new.splitlines())}."

    def show(self, start=None, end=None, find=None):
        """A numbered section of the script: lines start..end, or the lines around the first match of `find`."""
        text = self.text
        if text is None:
            return "There is no script yet."
        lines = text.splitlines()
        if find:
            hit = next((i for i, line in enumerate(lines) if find in line), None)
            if hit is None:
                return f"{find!r} is not in the script."
            start, end = max(1, hit + 1 - 10), hit + 1 + 20
        start = max(1, int(start or 1))
        end = min(len(lines), int(end or start + SHOW_LIMIT - 1), start + SHOW_LIMIT - 1)
        body = "\n".join(f"{n:4d}  {lines[n - 1]}" for n in range(start, end + 1))
        more = f"\n(lines {start}-{end} of {len(lines)})"
        return body + more

    def snapshot(self):
        """Keep a copy of a version that ran, numbered, so a later broken edit cannot lose it."""
        if self.text is None:
            return None
        self.snapshots.mkdir(exist_ok=True)
        self.count += 1
        out = self.snapshots / f"design-{self.count}.py"
        shutil.copy(self.path, out)
        return out


TOOLS = [
    {"type": "function", "name": "write", "description": "Save the complete script. Use it for the first draft only; after that, change it with edit().",
     "parameters": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"], "additionalProperties": False}},
    {"type": "function", "name": "edit", "description": "Replace one exact piece of the saved script (old) with new text. old must match exactly once, spaces included; copy it from show().",
     "parameters": {"type": "object", "properties": {"old": {"type": "string"}, "new": {"type": "string"}}, "required": ["old", "new"], "additionalProperties": False}},
    {"type": "function", "name": "show", "description": "Numbered lines of the saved script: a range (start, end) or the lines around the first line containing `find`. At most 80 lines.",
     "parameters": {"type": "object", "properties": {"start": {"type": "integer"}, "end": {"type": "integer"}, "find": {"type": "string"}}, "additionalProperties": False}},
]
