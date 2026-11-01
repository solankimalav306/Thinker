"""Long requests run as jobs: the first call returns a ticket at once, the app asks how far along it is and fetches the
result when it is done. A model call that takes minutes (a whole textbook read chapter by chapter) never has to fit inside
one HTTP request, and the person can see progress and stop it.
"""
import threading
import time
import uuid

_jobs = {}
_lock = threading.Lock()
KEEP_SECONDS = 3600


class Cancelled(Exception):
    pass


class Job:
    def __init__(self, request_id=""):
        self.id = uuid.uuid4().hex
        self.request_id = str(request_id or "")
        self.state = "running"          # running | done | error | cancelled
        self.label = "Starting"
        self.done = 0
        self.total = 0
        self.result = None
        self.error = ""
        self.started = time.time()
        self.finished = None
        self.stop = threading.Event()

    def update(self, label=None, done=None, total=None):
        if label is not None:
            self.label = label
        if done is not None:
            self.done = done
        if total is not None:
            self.total = total

    def check(self):
        """Call between steps: stops the work when the person pressed Stop."""
        if self.stop.is_set():
            raise Cancelled()

    def snapshot(self, with_result=False):
        out = {"job": self.id, "state": self.state, "label": self.label, "done": self.done, "total": self.total,
               "seconds": round((self.finished or time.time()) - self.started, 1), "error": self.error}
        if with_result and self.state == "done":
            out["result"] = self.result
        return out


def start(work, request_id=""):
    """Runs work(job) on a thread. work returns the result dict. Returns the Job."""
    job = Job(request_id)
    _forget_old()
    with _lock:
        _jobs[job.id] = job

    def run():
        try:
            job.result = work(job)
            job.state = "done"
        except Cancelled:
            job.state = "cancelled"
        except Exception as error:  # the app shows this text
            job.state = "error"
            job.error = str(error) or error.__class__.__name__
            print(f"[jobs] {job.id} failed: {job.error}", flush=True)
        finally:
            job.finished = time.time()

    threading.Thread(target=run, daemon=True, name=f"job-{job.id[:6]}").start()
    return job


def get(job_id):
    with _lock:
        return _jobs.get(str(job_id))


def cancel(job_id=None, request_id=None):
    with _lock:
        jobs = [j for j in _jobs.values() if (job_id and j.id == str(job_id)) or (request_id and j.request_id == str(request_id))]
    for job in jobs:
        job.stop.set()
    return bool(jobs)


def _forget_old():
    now = time.time()
    with _lock:
        for key in [k for k, j in _jobs.items() if j.finished and now - j.finished > KEEP_SECONDS]:
            del _jobs[key]
