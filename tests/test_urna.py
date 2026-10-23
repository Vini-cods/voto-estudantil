"""End-to-end checks for the actual portable executable; Python standard library only.

Usage: python tests/test_urna.py [--exe dist/Urna-Araci-Zebral/UrnaEstudantil.exe]
Test election data lives in disposable temporary folders, never in a user's urn.
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import copy
import csv
from datetime import datetime, timezone
import hashlib
import http.client
import io
import json
import math
import os
from pathlib import Path
import platform
import shutil
import socket
import statistics
import struct
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zlib


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
ROUTES = {
    "access": "/api/admin/access",
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
EXPECTED = {"c1": 1, "c2": 1, "c3": 0, "blank": 1, "nullVote": 1}


def fixture_image():
    """A valid synthetic one-pixel PNG; contains no supplied photo or school mark."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(b"\x00\x44\x88\xbb\xff")) + chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


IMAGE = fixture_image()


def fixture_configuration(count=3, urn_name="Urna Fictícia 1"):
    numbers = ["01", "07", "10"] + [f"{number:02d}" for number in range(11, 20)]
    return {"school": "Escola Fictícia de Teste", "electionTitle": "Eleição Fictícia 2026",
            "urnName": urn_name, "schoolLogo": IMAGE,
            "candidates": [{"id": f"c{index}", "name": f"Chapa Fictícia {index:02d}", "number": numbers[index - 1],
                            "groupPhoto": IMAGE, "portrait": IMAGE,
                            "proposals": f"Proposta fictícia {index}A.\nProposta fictícia {index}B.",
                            "members": f"Integrante Fictício {index}A\nIntegrante Fictício {index}B",
                            "representativeName": f"Representante Fictício {index}"}
                           for index in range(1, count + 1)]}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def rejected(result, message: str) -> None:
    require(400 <= result[0] < 500, f"{message}: HTTP {result[0]} {result[1]!r}")


def unwrap_state(value):
    return value.get("state", value)


class Urn:
    def __init__(self, exe: Path, web: Path | None, data: Path | None, cwd: Path | None = None):
        self.exe, self.web, self.cwd = exe, web, cwd
        self.data = exe.parent / "Dados" if data is None else data
        self.override_data = data is not None
        self.proc = None
        self.csrf = ""
        self.admin = ""
        self.port = 0
        self.log = None

    def command(self, port=None):
        command = [str(self.exe), "--no-browser", "--port", str(port or self.port)]
        if self.override_data:
            command.extend(["--data-dir", str(self.data)])
        if self.web is not None:
            command.extend(["--web-dir", str(self.web)])
        return command

    def start(self):
        if self.override_data:
            self.data.mkdir(parents=True, exist_ok=True)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.log = tempfile.TemporaryFile(mode="w+b")
        try:
            self.proc = subprocess.Popen(self.command(), cwd=self.cwd, stdout=self.log, stderr=self.log)
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                if self.proc.poll() is not None:
                    raise AssertionError("Urn exited during startup: " + self.read_log())
                try:
                    status, state = self.request("/api/state")
                    if status == 200:
                        stored = json.loads((self.data / "urna.json").read_text(encoding="utf-8-sig"))
                        require(state.get("urnId") == stored.get("urnId") and self.proc.poll() is None,
                                "The local HTTP server does not match this temporary test urn")
                        self.csrf = state["csrfToken"]
                        return self
                except (OSError, urllib.error.URLError, KeyError):
                    pass
                time.sleep(0.1)
            raise AssertionError("Urn did not start: " + self.read_log())
        except BaseException:
            self.stop()
            raise

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

    def access(self):
        value = self.call("access", {})
        self.admin = value["adminToken"]
        require(bool(self.admin), "Session access without a password returned no token")
        return value

    def configure(self, count=3, urn_name="Urna Fictícia 1"):
        self.access()
        configuration = fixture_configuration(count, urn_name)
        self.call("config", configuration, admin=True)
        return configuration

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


def check_blank_setup(public):
    require(public["status"] == "setup" and not public["configured"] and public["total"] == 0,
            "A fresh generic election is not an empty setup")
    require(public["school"] == "" and public.get("schoolLogo", "") == "", "A fresh election contains school data")
    require(len(public["candidates"]) == 3, "Fresh setup does not contain three blank candidate rows")
    for index, candidate in enumerate(public["candidates"], 1):
        require(candidate["id"] == f"c{index}" and all(not candidate.get(key) for key in
                ("name", "number", "groupPhoto", "portrait", "proposals", "members", "representativeName")),
                "A fresh generic election contains candidate data")


def check_configuration(public, configuration):
    for key in ("school", "schoolLogo", "electionTitle", "urnName"):
        require(public.get(key) == configuration[key], f"Configuration did not preserve {key}")
    require(len(public["candidates"]) == len(configuration["candidates"]), "Candidate count did not roundtrip")
    for actual, expected in zip(public["candidates"], configuration["candidates"]):
        for key in ("id", "name", "number", "groupPhoto", "proposals", "members", "representativeName"):
            require(actual.get(key) == expected[key], f"Candidate {expected['id']} did not preserve {key}")
        require(not actual.get("portrait"), "A legacy individual portrait was retained for display")


def check_csv_report(text, candidates, counts, total_votes):
    rows = {row[0]: row for row in csv.reader(io.StringIO(text), delimiter=";") if row}
    for candidate in candidates:
        row = rows.get(candidate["name"])
        require(row and row[1] == "'" + candidate["number"] and row[-1] == str(counts[candidate["id"]]),
                "CSV candidate count or two-digit number does not agree")
    for label, count in (("Brancos", counts["blank"]), ("Nulos", counts["nullVote"]),
                         ("TOTAL DE VOTOS", total_votes), ("TOTAL DE PARTICIPANTES", total_votes)):
        require(label in rows and rows[label][-1] == str(count), f"CSV has the wrong {label}")


def check_invalid_configuration(urn, configuration):
    saved = (urn.data / "urna.json").read_bytes()
    invalid = []
    def case(label, mutate):
        value = copy.deepcopy(configuration)
        mutate(value)
        invalid.append((label, value))
    case("one candidate", lambda value: value.update(candidates=value["candidates"][:1]))
    too_many = fixture_configuration(12)
    too_many["candidates"].append(dict(too_many["candidates"][-1], id="c13", number="20"))
    invalid.append(("thirteen candidates", too_many))
    case("duplicate numbers", lambda value: value["candidates"][1].update(number=value["candidates"][0]["number"]))
    case("one-digit number", lambda value: value["candidates"][0].update(number="1"))
    case("non-ASCII digits", lambda value: value["candidates"][0].update(number="０１"))
    case("wrong candidate identity", lambda value: value["candidates"][0].update(id="c99"))
    case("candidate list shape", lambda value: value.update(candidates="invalid"))
    case("long proposal", lambda value: value["candidates"][0].update(proposals="X" * 4001))
    case("proposal control character", lambda value: value["candidates"][0].update(proposals="Texto\u0000inválido"))
    case("external image", lambda value: value["candidates"][0].update(groupPhoto="https://example.invalid/photo.png"))
    case("wrong image magic", lambda value: value["candidates"][0].update(groupPhoto="data:image/png;base64,bm90LXBubwo="))
    case("wrong image MIME", lambda value: value["candidates"][0].update(groupPhoto=IMAGE.replace("image/png", "image/jpeg")))
    case("malformed base64", lambda value: value["candidates"][0].update(groupPhoto="data:image/png;base64,%%%"))
    case("unsafe logo type", lambda value: value.update(schoolLogo="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="))
    oversized_image = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + bytes(3 * 1024 * 1024)).decode("ascii")
    case("image over 3 MB", lambda value: value["candidates"][0].update(groupPhoto=oversized_image))
    for label, value in invalid:
        rejected(urn.request(ROUTES["config"], value, admin=True), f"Invalid configuration accepted: {label}")
        require((urn.data / "urna.json").read_bytes() == saved, f"Invalid configuration changed saved data: {label}")
    headers = {"Content-Type": "application/json", "X-Urna-Token": urn.csrf, "X-Admin-Token": urn.admin}
    request = urllib.request.Request(f"http://127.0.0.1:{urn.port}{ROUTES['config']}", data=b'{"school":', headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
    require(400 <= status < 500, f"Malformed JSON returned HTTP {status}")
    connection = http.client.HTTPConnection("127.0.0.1", urn.port, timeout=20)
    try:
        connection.request("POST", ROUTES["config"], headers=dict(headers, **{"Content-Length": str(64 * 1024 * 1024 + 1)}))
        response = connection.getresponse()
        require(response.status == 413, f"Oversized request header returned HTTP {response.status}")
        response.read()
    finally:
        connection.close()
    require((urn.data / "urna.json").read_bytes() == saved, "Malformed or oversized request changed saved data")


def check_dynamic_candidates(exe, web, data_root):
    batches = []
    for count in (2, 12):
        urn = Urn(exe, web, data_root / str(count))
        try:
            urn.start()
            configuration = urn.configure(count, f"Urna Fictícia {count}")
            if count == 2:
                configuration["schoolLogo"] = ""
                for candidate in configuration["candidates"]:
                    candidate["groupPhoto"] = ""
                urn.call("config", configuration, admin=True)
            check_configuration(urn.request("/api/state")[1], configuration)
            zero = {candidate["id"]: 0 for candidate in configuration["candidates"]}
            zero.update(blank=0, nullVote=0)
            check_counts(urn.state(), zero, 0)
            urn.call("open", {}, admin=True)
            for candidate in configuration["candidates"]:
                urn.vote(f"Eleitor Fictício {count} {candidate['id']}", candidate["id"], "Turma Fictícia")
            token = urn.identify(f"Eleitor Fictício {count} Branco", "Turma Fictícia")
            rejected(urn.request(ROUTES["vote"], {"voterToken": token, "choice": "c3" if count == 2 else "c99"}),
                     "Unknown candidate received a vote")
            urn.call("vote", {"voterToken": token, "choice": "blank"})
            urn.vote(f"Eleitor Fictício {count} Nulo", "nullVote", "Turma Fictícia")
            urn.call("close", {}, admin=True)
            batch = urn.call("export", admin=True)
            expected = {key: 1 for key in zero}
            check_counts(batch, expected, count + 2)
            check_csv_report(urn.call("report", admin=True), batch["candidates"], expected, count + 2)
            require(all(set(candidate) == {"id", "name", "number"} for candidate in batch["candidates"]),
                    "Dynamic export contains images or descriptive metadata")
            require("schoolLogo" not in batch, "Electoral export repeats the school logo")
            batches.append(batch)
            if len(batches) == 2:
                rejected(urn.request(ROUTES["consolidate"], {"batches": batches}, admin=True),
                         "Different candidate-count elections were consolidated")
            other = Urn(exe, web, data_root / f"{count}-second")
            try:
                other.start()
                other.configure(count, f"Segunda urna fictícia {count}")
                other.call("open", {}, admin=True)
                last_id = f"c{count}"
                other.vote(f"Outro eleitor fictício {count}", last_id, "Outra turma fictícia")
                other.call("close", {}, admin=True)
                other_batch = other.call("export", admin=True)
                merged = urn.call("consolidate", {"batches": [batch, other_batch]}, admin=True)
                merged_expected = dict(expected)
                merged_expected[last_id] += 1
                check_counts(merged, merged_expected, count + 3)
                require(len(merged["urns"]) == 2, "Dynamic consolidation lost an independent urn")
            finally:
                other.stop()
        finally:
            urn.stop()


def check_no_credentials(data):
    stored = json.loads((data / "urna.json").read_text(encoding="utf-8-sig"))
    require(not any(stored.get(key) for key in ("credentials", "pin", "password", "senha")),
            "A fresh election saved password credentials")


def check_legacy_states(exe, web, data_root, baseline):
    """Only synthetic local fixtures; preserve old votes and configured candidate data."""
    portrait = IMAGE
    credentials = {"salt": base64.b64encode(b"0" * 24).decode("ascii"),
                   "hash": base64.b64encode(b"1" * 32).decode("ascii"), "iterations": 150000}

    def save_fixture(name, value):
        data = data_root / name
        data.mkdir(parents=True)
        raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
        (data / "urna.json").write_bytes(raw)
        return data, raw

    for status in ("open", "closed"):
        legacy = copy.deepcopy(baseline)
        legacy["status"] = status
        legacy.pop("schoolLogo", None)
        legacy["credentials"] = copy.deepcopy(credentials)
        legacy["candidates"][0]["portrait"] = portrait
        if status == "open":
            legacy["closedAt"] = ""
        data, original = save_fixture(status, legacy)
        urn = Urn(exe, web, data)
        try:
            urn.start()
            public = urn.request("/api/state")[1]
            require(public["status"] == status and public["total"] == 4,
                    f"Legacy {status} election lost its status or votes")
            require(public.get("schoolLogo", "") == "", "An old election was assigned a new school logo")
            require(not public["candidates"][0].get("portrait"), "Legacy public state exposed an individual portrait")
            urn.access()
            admin = urn.state()
            require(not admin["candidates"][0].get("portrait") and "credentials" not in admin,
                    "Legacy session state exposed a portrait or old credentials")
            if status == "closed":
                check_counts(urn.call("export", admin=True), EXPECTED, 4)
            require((data / "urna.json").read_bytes() == original,
                    f"Reading legacy {status} data rewrote existing votes or credentials")
        finally:
            urn.stop()

    setup = copy.deepcopy(baseline)
    setup.pop("schoolLogo", None)
    setup.update(status="setup", electionId="", openedAt="", closedAt="",
                 counts={key: 0 for key in EXPECTED}, participants=[],
                 school="Escola anterior de teste", electionTitle="Eleição anterior de teste",
                 urnName="Urna anterior de teste")
    setup["candidates"][0].update(name="Chapa anterior de teste", number="41",
                                  proposals="Proposta antiga A.\nProposta antiga B.",
                                  members="Integrante de teste A\nIntegrante de teste B", portrait=portrait)
    for name, old_credentials in (("setup_without_credentials", None), ("setup_with_credentials", credentials),
                                  ("incomplete_setup", None)):
        legacy = copy.deepcopy(setup)
        legacy["credentials"] = copy.deepcopy(old_credentials)
        if name == "incomplete_setup":
            legacy["candidates"][0]["number"] = ""
        data, original = save_fixture(name, legacy)
        urn = Urn(exe, web, data)
        try:
            urn.start()
            public = urn.request("/api/state")[1]
            require(public["status"] == "setup" and public["total"] == 0,
                    "A legacy setup opened without an explicit confirmation")
            require((data / "urna.json").read_bytes() == original, "Opening a legacy setup rewrote its configuration")
            urn.access()
            if name == "incomplete_setup":
                rejected(urn.request(ROUTES["open"], {}, admin=True), "An incomplete legacy setup was opened")
            urn.stop()
            urn.start()
            require((data / "urna.json").read_bytes() == original, "A second startup rewrote a legacy setup")
        finally:
            urn.stop()

    setup_with_votes = copy.deepcopy(baseline)
    setup_with_votes.update(status="setup", electionId="", openedAt="", closedAt="")
    data, original = save_fixture("setup_with_votes", setup_with_votes)
    expect_start_failure(Urn(exe, web, data), "An inconsistent setup with existing votes was silently opened")
    require((data / "urna.json").read_bytes() == original, "An inconsistent setup with votes was overwritten")


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


def standalone_smoke(exe: Path, web: Path):
    """Exercise the copied EXE alone, default data location and explicit web override."""
    require(exe.is_file(), f"Executable not found: {exe}")
    with tempfile.TemporaryDirectory(prefix="urna-standalone-") as tmp:
        root = Path(tmp)
        portable = root / "portable copy"
        elsewhere = root / "different working directory"
        portable.mkdir()
        elsewhere.mkdir()
        copied_exe = portable / "UrnaEstudantil.exe"
        shutil.copyfile(exe, copied_exe)
        require({p.name for p in portable.iterdir()} == {copied_exe.name},
                "Standalone test folder did not start with the EXE alone")
        urn = Urn(copied_exe, None, None, cwd=elsewhere)
        try:
            urn.start()
            public = urn.request("/api/state")[1]
            check_blank_setup(public)
            check_no_credentials(urn.data)
            index = urn.request("/")[1]
            expected_index = (web / "index.html").read_text(encoding="utf-8-sig").replace("__CSRF_TOKEN__", urn.csrf)
            require(index.replace("\r\n", "\n") == expected_index.replace("\r\n", "\n"),
                    "Embedded index differs from the source or has an unreplaced session token")
            resources = ["app.js", "style.css", "favicon.svg", "assets/gresp.png", "assets/estado-sp.png"]
            for relative in resources:
                with urllib.request.urlopen(f"http://127.0.0.1:{urn.port}/{relative}", timeout=20) as response:
                    require(response.read() == (web / relative).read_bytes(),
                            f"Embedded resource {relative} differs from the current source")
                    if relative.endswith(".png"):
                        require(response.headers.get_content_type() == "image/png",
                                f"Embedded logo {relative} has the wrong content type")
            for retired in ("chapa-01-grupo.jpeg", "chapa-07-grupo.jpeg", "chapa-10-grupo.jpeg",
                            "simbolo-institucional.png"):
                require(urn.request("/assets/" + retired)[0] == 404,
                        f"Retired school image {retired} remains embedded in the generic EXE")
            rejected(urn.request("/%2e%2e/Program.cs"), "Embedded resource path escaped its resource directory")
            rejected(urn.request("/assets/missing.png"), "Missing embedded resource did not return a client error")
            require((portable / "Dados" / "urna.json").is_file(),
                    "Default data was not created beside the standalone EXE")
            rejected(urn.request(ROUTES["identify"], {"name": "Aluno Teste Portátil", "grade": "9º T"}),
                     "An unconfigured standalone election accepted a voter")
            configuration = urn.configure()
            check_configuration(urn.request("/api/state")[1], configuration)
            draft_bytes = (urn.data / "urna.json").read_bytes()
            urn.stop()
            urn.start()
            require(urn.request("/api/state")[1]["status"] == "setup" and (urn.data / "urna.json").read_bytes() == draft_bytes,
                    "Standalone restart changed or opened a saved draft")
            urn.access()
            urn.call("open", {}, admin=True)
            urn.vote("Aluno Teste Portátil", "c1", "9º T")
            state_path = portable / "Dados" / "urna.json"
            committed_bytes = state_path.read_bytes()
            urn.stop()
            urn.start()
            reopened = urn.request("/api/state")[1]
            require(reopened["status"] == "open" and reopened["total"] == 1,
                    "Standalone restart did not preserve the existing election and vote")
            check_configuration(reopened, configuration)
            require(state_path.read_bytes() == committed_bytes,
                    "Standalone restart rewrote or reset the existing data file")
            urn.access()
            urn.call("close", {}, admin=True)
            check_counts(urn.call("export", admin=True), {"c1": 1, "c2": 0, "c3": 0, "blank": 0, "nullVote": 0}, 1)
            require({p.name for p in portable.iterdir()} == {copied_exe.name, "Dados"},
                    "Standalone app extracted web resources or created auxiliary files beside the EXE")
            require({p.name for p in urn.data.iterdir()} <= {"urna.json", "urna.lock"},
                    "Standalone app extracted auxiliary resources into its data folder")
            require(not list(elsewhere.iterdir()), "Standalone app wrote data to its working directory")
        finally:
            urn.stop()

        external_web = root / "explicit web override"
        shutil.copytree(web, external_web)
        marker = "<!-- explicit-external-web-directory-test -->"
        index_path = external_web / "index.html"
        index_path.write_text(index_path.read_text(encoding="utf-8-sig") + marker, encoding="utf-8")
        external = Urn(copied_exe, external_web, root / "external test data", cwd=elsewhere)
        try:
            external.start()
            require(marker in external.request("/")[1], "Explicit --web-dir was ignored in favor of embedded resources")
        finally:
            external.stop()

        missing_data = root / "data must not be created for missing web"
        missing = Urn(copied_exe, root / "missing explicit web directory", missing_data, cwd=elsewhere)
        expect_start_failure(missing, "An invalid explicit web directory did not fail startup")
        require(not missing_data.exists(), "Invalid explicit web directory created a data folder before failing")
        (external_web / "style.css").unlink()
        incomplete_data = root / "data must not be created for incomplete web"
        incomplete = Urn(copied_exe, external_web, incomplete_data, cwd=elsewhere)
        expect_start_failure(incomplete, "An explicit web directory missing a required asset did not fail startup")
        require(not incomplete_data.exists(), "Missing explicit web asset created a data folder before failing")
    print("STANDALONE SMOKE PASSED: EXE alone, exact embedded assets, default Dados, persisted vote, no extraction, external override and startup validation")


def run(exe: Path, web: Path):
    require(exe.is_file(), f"Executable not found: {exe}")
    require((web / "index.html").is_file(), f"Web entry not found: {web}")
    standalone_smoke(exe, web)
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
            check_blank_setup(public)
            check_no_credentials(first.data)
            rejected(first.request(ROUTES["identify"], {"name": "Eleitor Fictício Inicial", "grade": "Turma Fictícia"}),
                     "An unconfigured election accepted a voter")
            configuration = fixture_configuration()
            rejected(first.request(ROUTES["config"], configuration), "Configuration without a local access session was accepted")
            rejected(first.request(ROUTES["access"], {}, csrf=False), "Session access without CSRF was accepted")
            rejected(first.request(ROUTES["close"], {}), "Closing without a local access session was accepted")
            first.access()
            fresh_bytes = (first.data / "urna.json").read_bytes()
            rejected(first.request(ROUTES["config"], configuration, admin=True, csrf=False),
                     "Configuration without CSRF was accepted")
            require((first.data / "urna.json").read_bytes() == fresh_bytes,
                    "Rejected configuration without CSRF changed the fresh setup")
            without_logo = copy.deepcopy(configuration)
            del without_logo["schoolLogo"]
            first.call("config", without_logo, admin=True)
            require(first.request("/api/state")[1].get("schoolLogo", "") == "", "Optional school logo could not be omitted")
            first.call("config", configuration, admin=True)
            check_configuration(first.request("/api/state")[1], configuration)
            stored = json.loads((first.data / "urna.json").read_text(encoding="utf-8-sig"))
            require(all(not candidate.get("portrait") for candidate in stored["candidates"]),
                    "A new configuration stored an ignored legacy individual portrait")
            check_invalid_configuration(first, configuration)
            partial = copy.deepcopy(configuration)
            partial["school"] = ""
            partial["candidates"][0].update(name="", number="")
            first.call("config", partial, admin=True)
            incomplete_bytes = (first.data / "urna.json").read_bytes()
            rejected(first.request(ROUTES["open"], {}, admin=True), "An incomplete draft was opened")
            require((first.data / "urna.json").read_bytes() == incomplete_bytes, "An invalid opening changed the saved draft")
            first.call("config", configuration, admin=True)
            draft_bytes = (first.data / "urna.json").read_bytes()
            first.stop()
            first.start()
            require(first.request("/api/state")[1]["status"] == "setup" and (first.data / "urna.json").read_bytes() == draft_bytes,
                    "Restart changed or automatically opened the draft")
            check_configuration(first.request("/api/state")[1], configuration)
            first.access()
            rejected(first.request(ROUTES["open"], {}, admin=True, csrf=False), "Opening without CSRF was accepted")
            first.call("open", {}, admin=True)
            frozen = (first.data / "urna.json").read_bytes()
            rejected(first.request(ROUTES["config"], configuration, admin=True), "An open election still allowed configuration changes")
            require((first.data / "urna.json").read_bytes() == frozen, "Rejected configuration changed an open election")
            candidates = configuration["candidates"]
            rejected(first.request(ROUTES["export"], admin=True), "Unclosed urn exported")
            print("PASS empty generic setup, synthetic photos/logo/metadata, validation, draft persistence, explicit opening and configuration freeze")

            expect_start_failure(first, "Second process used the same data folder")
            require(first.proc.poll() is None, "Lock attempt stopped the original process")
            print("PASS exclusive data-folder lock")

            token = first.identify("  Ána   Fictícia  ")
            rejected(first.request(ROUTES["vote"], {"voterToken": token, "choice": "c1"}, csrf=False),
                     "Vote confirmation without CSRF was accepted")
            with ThreadPoolExecutor(max_workers=2) as pool:
                submissions = [pool.submit(first.request, ROUTES["vote"],
                                           {"voterToken": token, "choice": "c1"}) for _ in range(2)]
                confirmations = [submission.result() for submission in submissions]
            require(sum(200 <= result[0] < 300 for result in confirmations) == 1,
                    f"Concurrent confirmation did not accept exactly once: {confirmations!r}")
            rejected(first.request(ROUTES["identify"], {"name": "ANA FICTICIA", "grade": "8º a"}),
                     "Normalized duplicate student accepted")
            repeat = first.request(ROUTES["vote"], {"voterToken": token, "choice": "c2"})
            require(repeat[0] in (200, 400, 401, 403, 409), f"Unexpected replay response: {repeat}")
            first.vote("Eleitor Fictício B", "c2")
            first.vote("Eleitor Fictício C", "blank")
            first.vote("Eleitor Fictício D", "nullVote")
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
            first.access()
            reopened = first.state()
            require(reopened["total"] == 4 and reopened["status"] == "open",
                    "Ongoing election did not persist its turnout and open status")
            require("counts" not in reopened and "participants" not in reopened,
                    "Restart exposed the running tallies or individual presence list")
            pending_token = first.identify("Eleitor Fictício Pendente")
            first.call("close", {}, admin=True)
            rejected(first.request(ROUTES["close"], {}, admin=True), "A closed election was finalized again")
            rejected(first.request("/api/admin/open", {}, admin=True), "A closed election was reopened")
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
            check_csv_report(csv_text, candidates, EXPECTED, 4)
            first.stop()
            first.start()
            first.access()
            check_counts(first.state(), EXPECTED, 4)
            require(first.state()["status"] == "closed", "Restart reopened a finalized election")
            require(first.call("export", admin=True) == batch1, "Closed export changed after restart")
            print("PASS persisted ballot totals, closed-state persistence and CSV report")

            second = Urn(exe, web, root / "second").start()
            active.append(second)
            second.configure(urn_name="Urna Fictícia 2")
            second.call("open", {}, admin=True)
            second.vote("Eleitor Fictício E", "c3", "9º B")
            second.access()
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
            unknown_count = copy.deepcopy(batch2)
            unknown_count["counts"]["c99"] = 0
            rejected(first.request(ROUTES["consolidate"], {"batches": [batch1, unknown_count]}, admin=True),
                     "Export with an unknown dynamic counter was accepted")
            repeated_student = copy.deepcopy(batch2)
            repeated_student["participants"][0] = copy.deepcopy(batch1["participants"][0])
            rejected(first.request(ROUTES["consolidate"], {"batches": [batch1, repeated_student]}, admin=True),
                     "Duplicate student between offline urns accepted")
            print("PASS exact consolidation and refusal of repeated urns, incompatible elections and duplicate students")

            check_dynamic_candidates(exe, web, root / "dynamic")
            print("PASS two and twelve candidates, dynamic counters, every candidate vote including c12, CSV, exact consolidation and incompatible-election refusal")

            baseline = json.loads((first.data / "urna.json").read_text(encoding="utf-8-sig"))
            check_legacy_states(exe, web, root / "legacy", baseline)
            print("PASS legacy open/closed byte preservation, unchanged complete/incomplete setup drafts and portrait masking")

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
    """Save synthetic school/candidate metadata and preserve the draft across restart."""
    with tempfile.TemporaryDirectory(prefix="urna-metadata-") as tmp:
        urn = Urn(exe, web, Path(tmp))
        try:
            urn.start()
            check_blank_setup(urn.request("/api/state")[1])
            configuration = urn.configure()
            check_configuration(urn.request("/api/state")[1], configuration)
            check_no_credentials(urn.data)
            original = (urn.data / "urna.json").read_bytes()
            urn.stop()
            urn.start()
            after = urn.request("/api/state")[1]
            require(after["status"] == "setup", "Restart opened a draft without confirmation")
            check_configuration(after, configuration)
            require((urn.data / "urna.json").read_bytes() == original, "Metadata inspection rewrote the saved election")
            print("METADATA SMOKE PASSED: synthetic logo/photos, multiline metadata and unchanged draft persistence")
        finally:
            urn.stop()


def capacity_smoke(exe: Path, web: Path, metrics_path: Path):
    """Cast 680 actual synthetic votes through five isolated standalone processes."""
    require(exe.is_file(), f"Executable not found: {exe}")
    work = (PROJECT / "work").resolve()
    metrics_path = metrics_path.resolve()
    require(metrics_path.is_relative_to(work), "Capacity metrics must stay inside work/")
    choices = ("c1", "c2", "c3", "blank", "nullVote")
    assignments = ((1, 2, 3, 4), (5, 6, 7, 8), (9, 10, 11), (12, 13, 14), (15, 16, 17))
    require(sorted(room for rooms in assignments for room in rooms) == list(range(1, 18)), "Class allocation is invalid")
    exe_sha256 = hashlib.sha256(exe.read_bytes()).hexdigest()
    started_at = datetime.now(timezone.utc).isoformat()
    overall_start = time.perf_counter()
    log_lock, restart_lock = threading.Lock(), threading.Lock()

    def progress(message):
        with log_lock:
            print(message, flush=True)

    def summary(samples):
        ordered = sorted(samples)
        return {"samples": len(samples), "median_ms": round(statistics.median(ordered) * 1000, 3),
                "p95_ms": round(ordered[math.ceil(len(ordered) * .95) - 1] * 1000, 3),
                "max_ms": round(ordered[-1] * 1000, 3)}

    def person(room, student):
        return f"Estudante Ficticio {room:02d} {student:02d}", f"Turma {room:02d}"

    def validate_csv(text, batch, expected, total_votes):
        rows = {row[0]: row for row in csv.reader(io.StringIO(text), delimiter=";") if row}
        for candidate in batch["candidates"]:
            row = rows.get(candidate["name"])
            require(row and row[1] == "'" + candidate["number"] and row[-1] == str(expected[candidate["id"]]),
                    "Capacity CSV candidate count or number does not agree")
        for label, count in (("Brancos", expected["blank"]), ("Nulos", expected["nullVote"]),
                             ("TOTAL DE VOTOS", total_votes), ("TOTAL DE PARTICIPANTES", total_votes)):
            require(label in rows and rows[label][-1] == str(count), f"Capacity CSV has the wrong {label}")

    def exercise(urn, index, rooms):
        target = len(rooms) * 40
        confirm_seconds, cycle_seconds = [], []
        loop_start = time.perf_counter()
        try:
            for count, (room, student) in enumerate(((room, student) for room in rooms for student in range(1, 41)), 1):
                name, grade = person(room, student)
                cycle_start = time.perf_counter()
                token = urn.identify(name, grade)
                confirm_start = time.perf_counter()
                urn.call("vote", {"voterToken": token, "choice": choices[(student - 1) % 5]})
                completed = time.perf_counter()
                confirm_seconds.append(completed - confirm_start)
                cycle_seconds.append(completed - cycle_start)
                if count == target // 2:
                    committed = (urn.data / "urna.json").read_bytes()
                    with restart_lock:
                        urn.stop()
                        urn.start()
                    current = urn.request("/api/state")[1]
                    require(current["status"] == "open" and current["total"] == count,
                            f"Urn {index} lost turnout during its midpoint restart")
                    require((urn.data / "urna.json").read_bytes() == committed,
                            f"Urn {index} rewrote data at its midpoint restart")
                    name, grade = person(rooms[0], 1)
                    rejected(urn.request(ROUTES["identify"], {"name": name, "grade": grade}),
                             "A duplicate student was accepted after the capacity restart")
                    progress(f"CAPACITY urn={index} midpoint restart preserved {count} votes; duplicate refused")
                if count % 40 == 0:
                    progress(f"CAPACITY urn={index} votes={count}/{target} classes={count // 40}/{len(rooms)} elapsed={time.perf_counter() - loop_start:.2f}s")
            loop_seconds = time.perf_counter() - loop_start
            urn.access()
            urn.call("close", {}, admin=True)
            batch = urn.call("export", admin=True)
            expected = {choice: target // 5 for choice in choices}
            check_counts(batch, expected, target)
            no_choice_in_participants(batch)
            expected_people = {person(room, student) for room in rooms for student in range(1, 41)}
            actual_people = {(p["name"], p["grade"]) for p in batch["participants"]}
            require(actual_people == expected_people, f"Urn {index} has missing or extra synthetic participants")
            validate_csv(urn.call("report", admin=True), batch, expected, target)
            committed = (urn.data / "urna.json").read_bytes()
            with restart_lock:
                urn.stop()
                urn.start()
            urn.access()
            require(urn.request("/api/state")[1]["status"] == "closed", "Capacity restart reopened a closed urn")
            require(urn.call("export", admin=True) == batch and (urn.data / "urna.json").read_bytes() == committed,
                    f"Urn {index} changed its finalized result during restart")
            rejected(urn.request(ROUTES["identify"], {"name": "Estudante Ficticio Extra", "grade": "Turma Extra"}),
                     "A finalized capacity urn accepted a new student")
            require({p.name for p in urn.exe.parent.iterdir()} == {urn.exe.name, "Dados"}, "Capacity run extracted auxiliary files")
            require({p.name for p in urn.data.iterdir()} <= {"urna.json", "urna.lock"}, "Capacity run retained history or auxiliary files")
            progress(f"CAPACITY urn={index} finalized {target} votes; CSV and final restart checked")
            return {"index": index, "batch": batch, "confirm_seconds": confirm_seconds, "cycle_seconds": cycle_seconds,
                    "metrics": {"urn": index, "classes": len(rooms), "votes": target, "counts": expected,
                                "vote_loop_seconds": round(loop_seconds, 3), "data_bytes": len(committed),
                                "confirm": summary(confirm_seconds), "identify_and_vote": summary(cycle_seconds)}}
        except BaseException:
            urn.stop()
            raise

    progress(f"CAPACITY START: 680 voters, 17 classes x 40, 5 standalone processes on ONE computer; EXE SHA256={exe_sha256}")
    urns = []
    with tempfile.TemporaryDirectory(prefix="urna-capacity-") as tmp:
        root = Path(tmp)
        launch_cwd = root / "working directory without resources"
        launch_cwd.mkdir()
        try:
            initial_ids = []
            for index in range(1, 6):
                folder = root / f"notebook {index}"
                folder.mkdir()
                copied_exe = folder / "UrnaEstudantil.exe"
                shutil.copyfile(exe, copied_exe)
                require(hashlib.sha256(copied_exe.read_bytes()).hexdigest() == exe_sha256, "EXE changed while making capacity copies")
                urn = Urn(copied_exe, None, None, cwd=launch_cwd).start()
                urns.append(urn)
                public = urn.request("/api/state")[1]
                check_blank_setup(public)
                urn.configure(urn_name=f"Urna Fictícia {index}")
                urn.call("open", {}, admin=True)
                require(urn.request("/api/state")[1]["status"] == "open", "Capacity fixture did not open after configuration")
                initial_ids.append(public["urnId"])
            require(len(set(initial_ids)) == 5, "The five capacity urns did not have independent identities")
            vote_start = time.perf_counter()
            with ThreadPoolExecutor(max_workers=5) as pool:
                futures = [pool.submit(exercise, urn, index, rooms) for index, (urn, rooms) in enumerate(zip(urns, assignments), 1)]
                results = sorted((future.result() for future in as_completed(futures)), key=lambda result: result["index"])
            vote_checks_seconds = time.perf_counter() - vote_start
            batches = [result["batch"] for result in results]
            require(len({batch["urnId"] for batch in batches}) == 5, "Finalized capacity urn identities are not independent")
            merged = urns[0].call("consolidate", {"batches": batches}, admin=True)
            expected = {choice: 136 for choice in choices}
            check_counts(merged, expected, 680)
            require(len(merged["urns"]) == 5, "Capacity consolidation did not include five urns")
            expected_people = {person(room, student) for room in range(1, 18) for student in range(1, 41)}
            require({(p["name"], p["grade"]) for p in merged["participants"]} == expected_people,
                    "Consolidated capacity presence does not match all 680 synthetic students")
            no_choice_in_participants(merged)
            require(not list(launch_cwd.iterdir()), "Capacity urns wrote into their working directory")
            confirm = [sample for result in results for sample in result["confirm_seconds"]]
            cycles = [sample for result in results for sample in result["cycle_seconds"]]
            metrics = {"status": "passed", "started_at_utc": started_at, "exe_sha256": exe_sha256,
                       "environment": {"os": platform.platform(), "architecture": platform.machine(),
                                       "logical_processors": os.cpu_count(), "python": platform.python_version(),
                                       "computers": 1, "concurrent_urn_processes": 5},
                       "classes": 17, "students_per_class": 40, "votes": 680, "counts": expected,
                       "independent_urn_ids": True, "api_vote_confirmations": len(confirm),
                       "percentile_method": "nearest-rank", "confirm": summary(confirm), "identify_and_vote": summary(cycles),
                       "voting_and_checks_seconds": round(vote_checks_seconds, 3), "urns": [result["metrics"] for result in results]}
        finally:
            for urn in urns:
                urn.stop()
    require(not Path(tmp).exists(), "Capacity temporary election data was not removed")
    metrics["temporary_data_removed"] = True
    metrics["total_seconds"] = round(time.perf_counter() - overall_start, 3)
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    progress(f"CAPACITY PASSED: 680 votes, 136 per option, 5 independent urns, temporary data removed; elapsed={metrics['total_seconds']:.2f}s")
    progress(f"CAPACITY LATENCY confirm={metrics['confirm']} identify_and_vote={metrics['identify_and_vote']}")
    progress(f"CAPACITY AGGREGATE METRICS: {metrics_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, default=PROJECT / "dist" / "Urna-Araci-Zebral" / "UrnaEstudantil.exe")
    parser.add_argument("--web-dir", type=Path, default=PROJECT / "src" / "web")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--metadata-smoke", action="store_true")
    mode.add_argument("--standalone-smoke", action="store_true")
    mode.add_argument("--capacity-smoke", action="store_true")
    parser.add_argument("--capacity-metrics", type=Path, default=PROJECT / "work" / "capacity-metrics.json")
    args = parser.parse_args()
    if args.capacity_smoke:
        capacity_smoke(args.exe.resolve(), args.web_dir.resolve(), args.capacity_metrics)
    else:
        operation = metadata_smoke if args.metadata_smoke else standalone_smoke if args.standalone_smoke else run
        operation(args.exe.resolve(), args.web_dir.resolve())
