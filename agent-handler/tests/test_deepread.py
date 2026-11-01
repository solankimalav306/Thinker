import json
import threading

import pytest

from services import deepread, jobs
from utils.artifacts import extract_json
from utils.chunking import chunk_pages
from utils.wholedoc import wants, wants_whole_document


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(deepread, "START_RPM", 100000.0)
    monkeypatch.setattr(deepread, "_retry_seconds", lambda message: 0.0)


def book(title, chapters, words_per_chapter=900):
    """A document of `chapters` chapters, each with a heading, some prose and an exercise, one chapter per two pages."""
    pages = []
    for c in range(1, chapters + 1):
        prose = " ".join(f"Sentence {i} of {title} chapter {c} explains an idea." for i in range(words_per_chapter // 9))
        pages.append({"page": 2 * c - 1, "text": f"{c} Chapter {c} of {title}\n{prose}"})
        pages.append({"page": 2 * c, "text": f"Exercise {c}.1: What is the main idea of chapter {c}?"})
    return {"title": title, "pdfId": title.lower().replace(" ", "") + "0" * 40, "chunks": chunk_pages(pages)}


def fake_llm(log=None, fail_on=None):
    def call(prompt, node):
        if log is not None:
            log.append(node)
        if node == "deep_pattern":
            return json.dumps({"summary": "Mostly recall questions.", "patterns": [{"name": "Recall", "description": "state the idea", "count": 5, "examples": [1, 2]}], "difficulty": "Rises slowly.", "tips": ["Practise daily."]})
        part = int(prompt.split("part ")[1].split(" of")[0])
        if fail_on and part in fail_on:
            return "not json at all"
        first = int(prompt.split("[p.")[1].split("]")[0])
        return json.dumps({"section": f"Part {part} title", "notes": [{"t": f"key idea {part}", "p": first}], "questions": [{"q": f"Question in part {part}?", "a": f"Answer {part}", "p": first, "ai": part % 2 == 0}]})
    return call


def artifact_data(text):
    return extract_json(text.split("<artifact", 1)[1].split(">", 1)[1].rsplit("</artifact", 1)[0])


def wait_for(job):
    for _ in range(100):
        if job.state != "running":
            return
        threading.Event().wait(0.05)


def test_requests_for_whole_documents_are_told_from_ordinary_questions():
    assert wants_whole_document("Make notes from both books and give answers to all the questions in them. Analyse the pattern too.")
    assert wants_whole_document("summarise the whole book") and wants_whole_document("notes for every chapter")
    for q in ["what is a vector?", "answer all questions on page 4", "explain all the terms in this paragraph", "What does chapter 3 say about loops?"]:
        assert not wants_whole_document(q), q
    assert not wants_whole_document("answer all the questions", has_selection=True)
    assert wants("answers to all questions")["questions"] and not wants("answers to all questions")["notes"]
    assert wants("everything in the book") == {"notes": True, "questions": True, "pattern": True}


def test_parts_follow_chapters_carry_page_markers_and_do_not_repeat_overlap():
    doc = book("Alpha Book", 6)
    parts, total, planned = deepread.plan_parts([doc], target=1200)
    assert len(parts) >= 3 and total == planned
    assert [p["number"] for p in parts] == list(range(1, len(parts) + 1))
    assert parts[0]["text"].startswith("[p.1]") and parts[0]["first"] == 1
    assert all(p["first"] <= p["last"] for p in parts)
    whole = "\n".join(p["text"] for p in parts)
    assert whole.count("Sentence 3 of Alpha Book chapter 2 explains an idea.") == 1   # the overlap between passages is removed


def test_a_long_collection_gets_bigger_parts_so_all_of_it_is_read():
    docs = [book("Big One", 40, 1800), book("Big Two", 40, 1800)]
    parts, total, planned = deepread.plan_parts(docs, max_parts=10)
    assert len(parts) <= 10 and planned == total


def test_only_an_enormous_collection_is_sampled():
    docs = [book("Huge One", 80, 3600), book("Huge Two", 80, 3600)]
    parts, total, planned = deepread.plan_parts(docs, max_parts=10)
    assert len(parts) == 10 and planned < total


def test_two_books_become_one_document_with_overview_patterns_notes_and_answers():
    docs = [book("Alpha Book", 4), book("Beta Book", 4)]
    job = jobs.Job()
    calls = []
    out = deepread.run(docs, "notes and answers to all the questions", wants("notes and answers to all the questions"), fake_llm(calls), job)
    data = artifact_data(out["text"])
    headings = [s["heading"] for s in data["sections"]]
    assert headings[0] == "Overview" and "Pattern of the questions" in headings
    assert any(h.startswith("Alpha Book") for h in headings) and any(h.startswith("Beta Book") for h in headings)
    text = "\n".join(s["text"] for s in data["sections"])
    assert "**Q1.**" in text and "**Answer:**" in text and "worked out by the AI" in text
    assert "Recall" in text and "100%" in text
    assert out["stats"]["questions"] == calls.count("deep_read") and calls.count("deep_pattern") == 1
    pairs = {(s["doc"], s["page"]) for s in out["sources"]}
    assert ("Alpha Book", 1) in pairs and all(isinstance(p, int) for _, p in pairs)
    assert all(s["cite"].split("|")[0] in ("Alpha Book", "Beta Book") for s in data["sections"] if s["cite"])
    assert job.done == job.total and job.label == "Done"


def test_notes_only_requests_do_not_ask_for_a_pattern():
    calls = []
    deepread.run([book("Alpha Book", 3)], "notes for every chapter", wants("notes for every chapter"), fake_llm(calls), jobs.Job())
    assert "deep_pattern" not in calls


def test_a_busy_provider_is_waited_for_and_the_pace_slows():
    attempts = {"n": 0}
    inner = fake_llm()

    def flaky(prompt, node):
        attempts["n"] += 1
        if attempts["n"] <= 2:
            raise RuntimeError("429 RESOURCE_EXHAUSTED. Please retry in 12s.")
        return inner(prompt, node)

    limiter = deepread.Limiter(40)
    reply = deepread.ask(flaky, "part 1 of 1 [p.1]", "deep_read", jobs.Job(), limiter)
    assert reply and attempts["n"] == 3 and limiter.rate == 10.0


def test_other_errors_are_not_retried():
    def broken(prompt, node):
        raise ValueError("bad api key")
    with pytest.raises(ValueError):
        deepread.ask(broken, "x", "deep_read", jobs.Job(), deepread.Limiter(100))


def test_a_part_that_cannot_be_read_is_reported_and_the_rest_still_delivered():
    docs = [book("Alpha Book", 4)]
    parts, _, _ = deepread.plan_parts(docs)
    out = deepread.run(docs, "all the questions", wants("all the questions"), fake_llm(fail_on={1}), jobs.Job())
    overview = artifact_data(out["text"])["sections"][0]["text"]
    assert "could not be read" in overview and out["stats"]["parts_read"] == len(parts) - 1


def test_nothing_readable_is_an_error_not_an_empty_document():
    with pytest.raises(ValueError):
        deepread.run([{"title": "Empty", "pdfId": "e" * 64, "chunks": []}], "all the questions", wants("x"), fake_llm(), jobs.Job())
    with pytest.raises(ValueError):
        deepread.run([book("Alpha Book", 2)], "all the questions", wants("all the questions"), fake_llm(fail_on=set(range(1, 30))), jobs.Job())


def test_without_artifacts_the_result_is_markdown():
    out = deepread.run([book("Alpha Book", 2)], "notes for every chapter", wants("notes for every chapter"), fake_llm(), jobs.Job(), as_artifact=False)
    assert "<artifact" not in out["text"] and "## Overview" in out["text"]


def test_stopping_a_job_stops_the_reading():
    job = jobs.Job()
    job.stop.set()
    with pytest.raises(jobs.Cancelled):
        deepread.run([book("Alpha Book", 3)], "all the questions", wants("all the questions"), fake_llm(), job)


def test_a_job_reports_progress_a_result_and_can_be_stopped():
    release = threading.Event()

    def work(job):
        job.update(label="Working", done=1, total=2)
        release.wait(5)
        job.check()
        return {"response_text": "done"}

    job = jobs.start(work, "req-1")
    assert jobs.get(job.id).snapshot()["label"] == "Working"
    assert jobs.cancel(request_id="req-1")
    release.set()
    wait_for(job)
    assert job.state == "cancelled"
    ok = jobs.start(lambda j: {"x": 1})
    wait_for(ok)
    assert ok.snapshot(with_result=True)["result"] == {"x": 1}
    bad = jobs.start(lambda j: 1 / 0)
    wait_for(bad)
    assert bad.state == "error" and "division" in bad.error


def test_the_graph_routes_a_whole_document_request_to_the_job_step():
    import graph
    assert graph.route_intent({"intent": "deep"}) == "deep"
