"""Body agent then case agent, with one way back: if no working case fits inside the chosen body, the case stage's
reasons go back to the body stage, which makes one more body with them in its brief, and the case is tried again.
A fixed body is a choice for one attempt, not for the whole job. The best attempt is kept (a working case first,
then the look score)."""
import json
from pathlib import Path

import agent
import body_agent
import case_agent
from body_stage import frozen_body_brief
from library_brief import LIBRARY_SYSTEM, library_brief

BODY_TRIES = 2   # the first body, and one more if the case cannot fit inside it


def rank(attempt):
    case = attempt.get("case") or {}
    return (case.get("best") is not None, case.get("look_score") or 0, (attempt.get("body") or {}).get("best_score") or 0)


def design_enclosure(base, picture, part_ids, folder, resume=False, report=print):
    """Runs the body and case agents into <folder>/attempt-N/{body,case}. Returns a summary with every attempt and the
    best one. report(kind, data) is called after each stage (the runner prints it)."""
    folder = Path(folder)
    attempts, feedback = [], None
    for n in range(1, BODY_TRIES + 1):
        out = folder / f"attempt-{n}"
        tried = {**base, "case_feedback": feedback} if feedback else base
        agent.start_job()
        done_body = resume and (out / "body" / "summary.json").exists() and (out / "body" / "BODY.stl").exists()
        if done_body:
            body = json.loads((out / "body" / "summary.json").read_text(encoding="utf-8"))
            stl, code = out / "body" / "BODY.stl", (out / "body" / "body.py").read_text(encoding="utf-8")
        else:
            code, stl, body = body_agent.design_body(tried, picture, out / "body", resume=resume)
        report("BODY", {"attempt": n, **{k: body.get(k) for k in ("result", "outcome", "steps", "submits", "best_score", "tokens", "seconds")}})
        attempt = {"attempt": n, "body": body, "case": None, "case_feedback_given": feedback}
        attempts.append(attempt)
        if code is None:
            break
        agent.start_job()
        with_score = {**tried, "body_score": body.get("best_score")}
        brief = "\n\n".join([library_brief(part_ids, frozen_body_brief(code)), agent.base_brief(with_score)])
        case = case_agent.design_case(brief, out / "case", with_score, stl, picture, part_ids, LIBRARY_SYSTEM, resume=resume)
        attempt["case"] = case
        report("CASE", {"attempt": n, **case})
        if case.get("best") is not None or not case.get("body_feedback"):
            break
        feedback = case["body_feedback"]
    best = max(attempts, key=rank)
    summary = {"best_attempt": best["attempt"], "result": (best.get("case") or {}).get("result") or (best["body"] or {}).get("result"),
               "attempts": attempts}
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "summary.json").write_text(json.dumps(summary, indent=1, default=str), encoding="utf-8")
    return summary
