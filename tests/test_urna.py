"""End-to-end checks for the actual portable executable; Python standard library only.

Usage: python work/test_urna.py [--exe work/urna-build/UrnaEstudantil.exe]
Test election data lives in disposable temporary folders, never in a user's urn.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import copy
import csv
import io
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


HERE = Path(__file__).resolve().parent
ROUTES = {
    "setup": "/api/admin/setup",
    "login": "/api/admin/login",
    "state": "/api/admin/state",
    "config": "/api/admin/config",
    "open": "/api/admin/open",
    "identify": "/api/identify",
    "vote": "/api/vote",
    "close": "/api/admin/close",
    "export": "/api/admin/export",
    "report": "/api/admin/report",
    "consolidate": "/api/admin/consolidate",
}
PIN = "583719"
CANDIDATES = [
    {"id": "c1", "name": "Chapa Aurora", "number": "01", "portrait": "", "groupPhoto": "", "proposals": ""},
    {"id": "c2", "name": "Chapa Futuro", "number": "07", "portrait": "", "groupPhoto": "",
     "proposals": "Primeira proposta de teste.\nSegunda proposta de teste."},
    {"id": "c3", "name": "Chapa União", "number": "10", "portrait": "", "groupPhoto": "", "proposals": ""},
]
EXPECTED = {"c1": 1, "c2": 1, "c3": 0, "blank": 1, "nullVote": 1}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def rejected(result, message: str) -> None:
    require(400 <= result[0] < 500, f"{message}: HTTP {result[0]} {result[1]!r}")


def unwrap_state(value):
    return value.get("state", value)


class Urn:
    def __init__(self, exe: Path, web: Path, data: Path):
        self.exe, self.web, self.data = exe, web, data
        self.proc = None
        self.csrf = ""
        self.admin = ""
        self.port = 0
        self.log = None

    def command(self, port=None):
        return [str(self.exe), "--no-browser", "--data-dir", str(self.data),
                "--port", str(port or self.port), "--web-dir", str(self.web)]

    def start(self):
        self.data.mkdir(parents=True, exist_ok=True)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.log = tempfile.TemporaryFile(mode="w+b")
        self.proc = subprocess.Popen(self.command(), stdout=self.log, stderr=self.log)
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                raise AssertionError("Urn exited during startup: " + self.read_log())
            try:
                status, state = self.request("/api/state")
                if status == 200:
                    self.csrf = state["csrfToken"]
                    return self
            except (OSError, urllib.error.URLError, KeyError):
                pass
            time.sleep(0.1)
        raise AssertionError("Urn did not start: " + self.read_log())

    def read_log(self):
        if not self.log:
            return ""
        self.log.seek(0)
        return self.log.read().decode("utf-8", errors="replace")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
        if self.log:
            self.log.close()
        self.proc, self.log = None, None

    def request(self, path, payload=None, admin=False, csrf=True):
        headers = {}
        if csrf and self.csrf:
            headers["X-Urna-Token"] = self.csrf
        if admin and self.admin:
            headers["X-Admin-Token"] = self.admin
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                status, raw = response.status, response.read()
                mime = response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as error:
            status, raw, mime = error.code, error.read(), error.headers.get("Content-Type", "")
        text = raw.decode("utf-8-sig")
        return status, json.loads(text) if "application/json" in mime else text

    def call(self, name, payload=None, admin=False):
        status, value = self.request(ROUTES[name], payload, admin=admin)
        require(200 <= status < 300, f"{name}: HTTP {status} {value!r}")
        return value

    def setup(self, name="Notebook 1", candidates=None):
        value = self.call("setup", {"pin": PIN, "school": "Escola de Testes",
                                   "electionTitle": "Grêmio 2026", "urnName": name,
                                   "candidates": copy.deepcopy(CANDIDATES if candidates is None else candidates)})
        self.admin = value["adminToken"]
        return value

    def state(self):
        return unwrap_state(self.call("state", admin=True))

    def identify(self, name, grade="8º A"):
        value = self.call("identify", {"name": name, "grade": grade})
        return value["voterToken"]

    def vote(self, name, choice, grade="8º A"):
        token = self.identify(name, grade)
        self.call("vote", {"voterToken": token, "choice": choice})
        return token


def check_counts(value, counts, total):
    value = unwrap_state(value)
    require(value["counts"] == counts, f"Wrong counts: {value.get('counts')!r}, wanted {counts!r}")
    require(value["total"] == total, f"Wrong total: {value.get('total')!r}, wanted {total}")
    require(sum(value["counts"].values()) == total, "Counts do not add to total")
    require(len(value["participants"]) == total, "Participants do not equal ballot total")


def no_choice_in_participants(batch):
    for participant in batch["participants"]:
        require(isinstance(participant, dict), "Participant has unexpected format")
        sensitive = {"choice", "vote", "ballot", "candidate", "candidateId", "voterToken"}
        require(not (set(participant) & sensitive), "Participant export links student to choice/token")


def expect_start_failure(urn, message):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        alternate_port = sock.getsockname()[1]
    with tempfile.TemporaryFile(mode="w+b") as log:
        process = subprocess.Popen(urn.command(alternate_port), stdout=log, stderr=log)
        try:
            code = process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)
            raise AssertionError(message + ": process stayed alive")
        log.seek(0)
        require(code != 0, message + ": exit code 0; " + log.read().decode("utf-8", errors="replace"))


def run(exe: Path, web: Path):
    require(exe.is_file(), f"Executable not found: {exe}")
    require((web / "index.html").is_file(), f"Web entry not found: {web}")
    active = []
    with tempfile.TemporaryDirectory(prefix="urna-integration-") as tmp:
        root = Path(tmp)
        try:
            first = Urn(exe, web, root / "first").start()
            active.append(first)
            index = first.request("/")[1]
            require("__CSRF_TOKEN__" not in index, "Index CSRF placeholder was not replaced")
            require(first.csrf in index, "Index and API do not agree on session token")
            public = first.request("/api/state")[1]
            require("counts" not in public and "participants" not in public, "Public state leaks election data")
            rejected(first.request(ROUTES["setup"], {"pin": PIN}, csrf=False), "Missing CSRF accepted")
            first.setup()
            configured = first.request("/api/state")[1]
            require(configured["candidates"][1].get("proposals") == CANDIDATES[1]["proposals"],
                    "Candidate proposal text or line breaks were not preserved by setup")
            rejected(first.request(ROUTES["setup"], {"pin": PIN, "school": "Overwrite"}),
                     "Already configured urn accepted setup again")
            rejected(first.request(ROUTES["open"], {}), "Missing administrator authorization accepted")
            rejected(first.request(ROUTES["login"], {"pin": "000000"}), "Wrong administrator PIN accepted")
            first.admin = first.call("login", {"pin": PIN}).get("adminToken")
            require(first.admin, "PIN login gave no session")
            first.call("open", {}, admin=True)
            rejected(first.request(ROUTES["export"], admin=True), "Unclosed urn exported")
            print("PASS setup, request protection, administrator login and opening")

            expect_start_failure(first, "Second process used the same data folder")
            require(first.proc.poll() is None, "Lock attempt stopped the original process")
            print("PASS exclusive data-folder lock")

            token = first.identify("  Ána   Silva  ")
            with ThreadPoolExecutor(max_workers=2) as pool:
                submissions = [pool.submit(first.request, ROUTES["vote"],
                                           {"voterToken": token, "choice": "c1"}) for _ in range(2)]
                confirmations = [submission.result() for submission in submissions]
            require(sum(200 <= result[0] < 300 for result in confirmations) == 1,
                    f"Concurrent confirmation did not accept exactly once: {confirmations!r}")
            rejected(first.request(ROUTES["identify"], {"name": "ANA SILVA", "grade": "8º a"}),
                     "Normalized duplicate student accepted")
            repeat = first.request(ROUTES["vote"], {"voterToken": token, "choice": "c2"})
            require(repeat[0] in (200, 400, 401, 403, 409), f"Unexpected replay response: {repeat}")
            first.vote("Bruno Souza", "c2")
            first.vote("Carla Pereira", "blank")
            first.vote("Diego Lima", "nullVote")
            before = first.state()
            require(before["total"] == 4, "Ongoing turnout is not four")
            require("counts" not in before and "participants" not in before,
                    "Administrator state exposes individual presence and running tallies before closing")
            require(not list(first.data.glob("*.bak")), "A previous plaintext ballot snapshot was retained")
            public = first.request("/api/state")[1]
            require("counts" not in public and "participants" not in public, "Public state leaks ongoing votes")
            print("PASS all vote types, replay safety and normalized duplicate detection")

            first.stop()
            first.start()
            first.admin = first.call("login", {"pin": PIN})["adminToken"]
            reopened = first.state()
            require(reopened["total"] == 4 and reopened["status"] == "open",
                    "Ongoing election did not persist its turnout and open status")
            require("counts" not in reopened and "participants" not in reopened,
                    "Restart exposed the running tallies or individual presence list")
            pending_token = first.identify("Elisa Costa")
            first.call("close", {}, admin=True)
            rejected(first.request(ROUTES["identify"], {"name": "Outro aluno", "grade": "9º A"}),
                     "Closed urn identified another voter")
            rejected(first.request(ROUTES["vote"], {"voterToken": pending_token, "choice": "c3"}),
                     "Closed urn accepted a pending vote")
            batch1 = first.call("export", admin=True)
            check_counts(batch1, EXPECTED, 4)
            no_choice_in_participants(batch1)
            require(all(set(candidate) == {"id", "name", "number"} for candidate in batch1["candidates"]),
                    "Ballot export retains photographs or unexpected candidate fields")
            require(batch1["status"] == "closed", "Export status is not closed")
            csv_text = first.call("report", admin=True)
            require(isinstance(csv_text, str) and all(candidate["number"] in csv_text for candidate in CANDIDATES),
                    "CSV report is missing candidate numbers")
            csv_rows = list(csv.reader(io.StringIO(csv_text), delimiter=";"))
            for candidate in CANDIDATES:
                row = next((row for row in csv_rows if row and row[0] == candidate["name"]), None)
                require(row is not None and row[-1] == str(EXPECTED[candidate["id"]]),
                        f"CSV report has wrong count for {candidate['name']}: {row!r}")
                require(row[1] == "'" + candidate["number"],
                        f"CSV report has wrong candidate number for {candidate['name']}: {row!r}")
            for label, key in (("Brancos", "blank"), ("Nulos", "nullVote")):
                row = next((row for row in csv_rows if row and row[0] == label), None)
                require(row is not None and row[-1] == str(EXPECTED[key]),
                        f"CSV report has wrong count for {label}: {row!r}")
            require(any("4" in row and any("total" in str(cell).lower() for cell in row) for row in csv_rows),
                    "CSV report is missing the total of four ballots")
            first.stop()
            first.start()
            first.admin = first.call("login", {"pin": PIN})["adminToken"]
            check_counts(first.state(), EXPECTED, 4)
            require(first.call("export", admin=True) == batch1, "Closed export changed after restart")
            print("PASS persisted ballot totals, closed-state persistence and CSV report")

            second = Urn(exe, web, root / "second").start()
            active.append(second)
            second.setup("Notebook 2")
            second.call("open", {}, admin=True)
            second.vote("Fabiana Ramos", "c3", "9º B")
            second.call("close", {}, admin=True)
            batch2 = second.call("export", admin=True)
            require(batch1["urnId"] != batch2["urnId"], "Independent urns share the same identity")
            require(batch1["electionId"] == batch2["electionId"], "Identical setup created incompatible elections")
            merged = first.call("consolidate", {"batches": [batch1, batch2]}, admin=True)
            check_counts(merged, dict(EXPECTED, c3=1), 5)
            require(len(merged["urns"]) == 2, "Consolidation did not retain the two urn identities")
            rejected(first.request(ROUTES["consolidate"], {"batches": [batch1, batch1]}, admin=True),
                     "Repeated urn accepted")
            incompatible = copy.deepcopy(batch2)
            incompatible["electionId"] = "different-election"
            rejected(first.request(ROUTES["consolidate"], {"batches": [batch1, incompatible]}, admin=True),
                     "Different election accepted")
            incompatible = copy.deepcopy(batch2)
            incompatible["candidates"][0]["number"] = "99"
            rejected(first.request(ROUTES["consolidate"], {"batches": [batch1, incompatible]}, admin=True),
                     "Different candidate numbers accepted")
            inconsistent = copy.deepcopy(batch2)
            inconsistent["total"] += 1
            rejected(first.request(ROUTES["consolidate"], {"batches": [batch1, inconsistent]}, admin=True),
                     "Export with totals that disagree accepted")
            repeated_student = copy.deepcopy(batch2)
            repeated_student["participants"][0] = copy.deepcopy(batch1["participants"][0])
            rejected(first.request(ROUTES["consolidate"], {"batches": [batch1, repeated_student]}, admin=True),
                     "Duplicate student between offline urns accepted")
            print("PASS exact consolidation and refusal of repeated urns, incompatible elections and duplicate students")

            first.stop()
            state_files = [p for p in first.data.glob("*.json") if p.is_file()]
            require(len(state_files) == 1, f"Cannot identify the persisted JSON state: {state_files}")
            state_path = state_files[0]
            corrupt = b'{"damaged":true, this is not valid JSON'
            state_path.write_bytes(corrupt)
            expect_start_failure(first, "Damaged state was silently reset")
            require(state_path.read_bytes() == corrupt, "Startup overwrote the damaged state")
            print("PASS damaged state fails safely without erasing the file")
        finally:
            for urn in active:
                urn.stop()
    print("ALL INTEGRATION CHECKS PASSED")


def metadata_smoke(exe: Path, web: Path):
    """Verify descriptive candidate fields without repeating the voting suite."""
    candidates = copy.deepcopy(CANDIDATES)
    candidates[1]["representativeName"] = "Nome de Teste — 1º ano D"
    candidates[1]["members"] = "Pessoa Um — 7º A\nPessoa Dois — 8º B"
    with tempfile.TemporaryDirectory(prefix="urna-metadata-") as tmp:
        urn = Urn(exe, web, Path(tmp))
        try:
            urn.start()
            urn.setup(candidates=candidates)
            for field in ("proposals", "members", "representativeName"):
                require(urn.request("/api/state")[1]["candidates"][1].get(field) == candidates[1][field],
                        f"Candidate metadata {field} did not roundtrip exactly")
            urn.stop()
            urn.start()
            for field in ("proposals", "members", "representativeName"):
                require(urn.request("/api/state")[1]["candidates"][1].get(field) == candidates[1][field],
                        f"Candidate metadata {field} did not persist after restart")
            urn.admin = urn.call("login", {"pin": PIN})["adminToken"]
            urn.call("config", {"school": "Escola de Testes", "electionTitle": "Grêmio 2026",
                                "urnName": "Notebook 1", "candidates": copy.deepcopy(CANDIDATES)}, admin=True)
            old_format_candidate = urn.request("/api/state")[1]["candidates"][1]
            require(old_format_candidate.get("members", "") == "" and
                    old_format_candidate.get("representativeName", "") == "",
                    "An older configuration without optional metadata kept stale values")
            print("METADATA SMOKE PASSED: exact multiline roundtrip, restart persistence and old-config compatibility")
        finally:
            urn.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, default=HERE / "urna-build" / "UrnaEstudantil.exe")
    parser.add_argument("--web-dir", type=Path, default=HERE / "urna-src" / "web")
    parser.add_argument("--metadata-smoke", action="store_true")
    args = parser.parse_args()
    (metadata_smoke if args.metadata_smoke else run)(args.exe.resolve(), args.web_dir.resolve())
