"""Runs AI-written design code locally: no API keys in its environment, only allowed imports, and a hard time limit. In the container it also runs as a separate user (ENCLOSURE_RUNNER_USER)."""
import ast
import os
import subprocess
import sys
from pathlib import Path

ALLOWED_IMPORTS = {"build123d", "math", "json", "pathlib", "case_parts", "body_parts"}
BANNED_NAMES = {"eval", "exec", "compile", "__import__", "globals", "locals", "getattr", "setattr", "breakpoint", "input"}
TIME_LIMIT_SECONDS = 300
OUTPUT_LIMIT = 4000


def code_problem(code):
    """A quick screen of the code before it runs. This is not a security boundary; the AWS task is."""
    try:
        tree = ast.parse(code)
    except SyntaxError as error:
        return f"Python syntax error on line {error.lineno}: {error.msg}"
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [node.module or ""]
        else:
            names = []
        for name in names:
            if name.split(".")[0] not in ALLOWED_IMPORTS:
                return f"Import of {name} is not allowed. Allowed: {sorted(ALLOWED_IMPORTS)}."
        if isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            return f"{node.id} is not allowed."
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            return f"{node.attr} is not allowed."
    return None


def runner_account(name):
    import pwd
    return pwd.getpwnam(name)


def runner_switch(folder):
    """In the container the generator runs as root and the AI's code as ENCLOSURE_RUNNER_USER, which cannot read
    the generator's environment (where the OpenAI key is) or its files. Returns subprocess options, or an error string."""
    name = os.environ.get("ENCLOSURE_RUNNER_USER")
    if not name:
        return {}
    if os.geteuid() != 0:
        return "The runner user is set, but the generator is not running as root, so it cannot switch to it."
    account = runner_account(name)
    for path in [folder, *folder.rglob("*")]:
        os.chown(path, account.pw_uid, account.pw_gid)
    return {"user": account.pw_uid, "group": account.pw_gid, "extra_groups": []}


def run_design(code, folder):
    """Writes the code to the attempt folder and runs it there. Returns (ok, message)."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "design.py").write_text(code, encoding="utf-8")
    problem = code_problem(code)
    if problem:
        return False, problem
    environment = {k: os.environ[k] for k in ("SYSTEMROOT", "TEMP", "TMP", "PATH") if k in os.environ}
    # build123d's libraries want a home folder; the attempt folder keeps the real one out of reach of the environment.
    environment.update(HOME=str(folder.resolve()), USERPROFILE=str(folder.resolve()))
    switch = runner_switch(folder.resolve())
    if isinstance(switch, str):
        return False, switch
    try:
        done = subprocess.run([sys.executable, "-E", "-s", "design.py"], cwd=folder.resolve(), env=environment, capture_output=True, text=True, timeout=TIME_LIMIT_SECONDS, **switch)
    except subprocess.TimeoutExpired:
        return False, f"The code ran longer than the {TIME_LIMIT_SECONDS} second limit."
    (folder / "output.txt").write_text(done.stdout + done.stderr, encoding="utf-8")
    if done.returncode != 0:
        return False, f"The code crashed:\n{done.stderr[-OUTPUT_LIMIT:]}"
    return True, ""
