package br.escola.vozdaescola.urna;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Stream;

/** Real store integration checks. Every election and image is synthetic. No Android SDK or JUnit required. */
public final class ElectionStoreTest {
    private static final String IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNo6Lj7HwAFuwKHBgkIvgAAAABJRU5ErkJggg==";

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static JSONObject object(String text) throws Exception { return new JSONObject(text); }
    private static JSONObject cloneJson(JSONObject value) throws Exception { return object(value.toString()); }
    private static Set<String> keys(JSONObject value) {
        Set<String> result = new HashSet<String>();
        Iterator<String> iterator = value.keys();
        while (iterator.hasNext()) result.add(iterator.next());
        return result;
    }
    private static JSONObject config(int count, String urnName) throws Exception {
        JSONObject result = new JSONObject().put("school", "Escola Fictícia de Teste")
                .put("electionTitle", "Eleição Fictícia 2026").put("urnName", urnName).put("schoolLogo", IMAGE);
        JSONArray candidates = new JSONArray();
        String[] numbers = {"01", "07", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"};
        for (int i = 1; i <= count; i++) candidates.put(new JSONObject().put("id", "c" + i)
                .put("name", String.format(java.util.Locale.ROOT, "Chapa Fictícia %02d", i)).put("number", numbers[i - 1])
                .put("groupPhoto", IMAGE).put("portrait", IMAGE)
                .put("representativeName", "Representante Fictício " + i)
                .put("members", "Integrante Fictício " + i + "A\nIntegrante Fictício " + i + "B")
                .put("proposals", "Proposta fictícia " + i + "A.\nProposta fictícia " + i + "B."));
        return result.put("candidates", candidates);
    }
    private static final class Urn implements AutoCloseable {
        final File directory;
        ElectionStore store;
        String admin = "";
        Urn(Path directory) throws Exception { this.directory = directory.toFile(); reopen(); }
        void reopen() throws Exception { store = new ElectionStore(directory); admin = ""; }
        JSONObject request(String method, String path, JSONObject body, boolean csrf, boolean authenticated) throws Exception {
            return store.handle(method, path, body, csrf ? store.csrf() : "", authenticated ? admin : "");
        }
        JSONObject raw(String method, String path, JSONObject body) throws Exception {
            JSONObject result = request(method, path, body, true, true);
            check(result.getInt("status") >= 200 && result.getInt("status") < 300,
                    path + " returned HTTP " + result.getInt("status") + ": " + result.get("data"));
            return result;
        }
        JSONObject get(String path) throws Exception { return raw("GET", path, null).getJSONObject("data"); }
        JSONObject post(String path, JSONObject body) throws Exception { return raw("POST", path, body).getJSONObject("data"); }
        void access() throws Exception { admin = post("admin/access", new JSONObject()).getString("adminToken"); check(!admin.isEmpty(), "Empty access token"); }
        void configure(JSONObject value) throws Exception { access(); post("admin/config", value); }
        String identify(String name) throws Exception {
            return post("identify", new JSONObject().put("name", name).put("grade", "8º A")).getString("voterToken");
        }
        JSONObject confirm(String token, String choice) throws Exception {
            return request("POST", "vote", new JSONObject().put("voterToken", token).put("choice", choice), true, false);
        }
        void vote(String name, String choice) throws Exception {
            JSONObject result = confirm(identify(name), choice);
            check(result.getInt("status") >= 200 && result.getInt("status") < 300, "Synthetic vote failed");
        }
        JSONObject batch() throws Exception { return get("admin/export"); }
        byte[] bytes() throws Exception { return Files.readAllBytes(directory.toPath().resolve("urna.json")); }
        void restart() throws Exception { close(); reopen(); }
        public void close() throws Exception { if (store != null) { store.close(); store = null; } }
    }
    private static void rejected(JSONObject wrapper, String message) throws Exception {
        int status = wrapper.getInt("status");
        check(status >= 400 && status < 500, message + ": HTTP " + status);
    }
    private static void blank(JSONObject state) throws Exception {
        check(state.getString("status").equals("setup") && !state.getBoolean("configured") && state.getInt("total") == 0,
                "Fresh store is not a zero-vote draft");
        check(state.getString("school").isEmpty() && state.optString("schoolLogo").isEmpty(), "Fresh store contains a school");
        JSONArray candidates = state.getJSONArray("candidates");
        check(candidates.length() == 3, "Fresh store should have three blank rows");
        for (int i = 0; i < 3; i++) {
            JSONObject candidate = candidates.getJSONObject(i);
            check(candidate.getString("id").equals("c" + (i + 1)), "Unexpected fresh candidate ID");
            for (String field : Arrays.asList("name", "number", "portrait", "groupPhoto", "representativeName", "members", "proposals"))
                check(candidate.optString(field).isEmpty(), "Fresh candidate contains " + field);
        }
    }
    private static void configuration(JSONObject state, JSONObject expected) throws Exception {
        for (String field : Arrays.asList("school", "schoolLogo", "electionTitle", "urnName"))
            check(state.optString(field).equals(expected.optString(field)), "Configuration changed " + field);
        JSONArray actual = state.getJSONArray("candidates"), wanted = expected.getJSONArray("candidates");
        check(actual.length() == wanted.length(), "Configuration changed candidate count");
        for (int i = 0; i < actual.length(); i++) {
            for (String field : Arrays.asList("id", "name", "number", "groupPhoto", "representativeName", "members", "proposals"))
                check(actual.getJSONObject(i).optString(field).equals(wanted.getJSONObject(i).optString(field)), "Configuration changed " + field);
            check(actual.getJSONObject(i).optString("portrait").isEmpty(), "Individual portrait was retained");
        }
    }
    private static JSONObject counts(int candidates, int each, int blank, int invalid) throws Exception {
        JSONObject result = new JSONObject();
        for (int i = 1; i <= candidates; i++) result.put("c" + i, each);
        return result.put("blank", blank).put("nullVote", invalid);
    }
    private static void totals(JSONObject state, JSONObject expected, int total) throws Exception {
        JSONObject actual = state.getJSONObject("counts");
        check(keys(actual).equals(keys(expected)), "Dynamic count keys differ");
        int sum = 0;
        for (String key : keys(expected)) { check(actual.getInt(key) == expected.getInt(key), "Wrong count for " + key); sum += actual.getInt(key); }
        check(sum == total && state.getInt("total") == total && state.getJSONArray("participants").length() == total,
                "Counts, total and attendance disagree");
        for (int i = 0; i < total; i++) {
            JSONObject participant = state.getJSONArray("participants").getJSONObject(i);
            for (String secret : Arrays.asList("choice", "vote", "ballot", "candidate", "candidateId", "voterToken"))
                check(!participant.has(secret), "Attendance links a person to a ballot");
        }
    }
    private static void csv(Urn urn, JSONObject batch) throws Exception {
        JSONObject wrapper = urn.raw("GET", "admin/report", null);
        check(wrapper.getString("contentType").startsWith("text/csv"), "Report MIME is not CSV");
        check(wrapper.optString("filename").endsWith(".csv"), "CSV report filename is absent");
        String text = wrapper.getString("data");
        Map<String, List<String>> rows = new HashMap<String, List<String>>();
        for (String line : text.replace("\uFEFF", "").split("\\r?\\n")) {
            List<String> fields = new ArrayList<String>(); StringBuilder field = new StringBuilder(); boolean quoted = false;
            for (int index = 0; index < line.length(); index++) {
                char character = line.charAt(index);
                if (character == '"') {
                    if (quoted && index + 1 < line.length() && line.charAt(index + 1) == '"') { field.append('"'); index++; }
                    else quoted = !quoted;
                } else if (character == ';' && !quoted) { fields.add(field.toString()); field.setLength(0); }
                else field.append(character);
            }
            fields.add(field.toString()); if (!fields.get(0).isEmpty()) rows.put(fields.get(0), fields);
        }
        JSONObject counts = batch.getJSONObject("counts");
        for (int i = 0; i < batch.getJSONArray("candidates").length(); i++) {
            JSONObject row = batch.getJSONArray("candidates").getJSONObject(i);
            List<String> actual = rows.get(row.getString("name"));
            check(actual != null && actual.size() == 3 && actual.get(1).equals("'" + row.getString("number")) &&
                    actual.get(2).equals(Integer.toString(counts.getInt(row.getString("id")))), "CSV lost a candidate count or two-digit number");
        }
        for (String label : Arrays.asList("Brancos", "Nulos", "TOTAL DE VOTOS", "TOTAL DE PARTICIPANTES")) {
            int expected = label.equals("Brancos") ? counts.getInt("blank") : label.equals("Nulos") ? counts.getInt("nullVote") : batch.getInt("total");
            List<String> actual = rows.get(label);
            check(actual != null && actual.get(actual.size() - 1).equals(Integer.toString(expected)), "CSV differs for " + label);
        }
    }
    private static void minimalBatch(JSONObject batch) throws Exception {
        check(!batch.has("schoolLogo") && !batch.has("credentials"), "Batch contains descriptive or secret fields");
        for (int i = 0; i < batch.getJSONArray("candidates").length(); i++)
            check(keys(batch.getJSONArray("candidates").getJSONObject(i)).equals(new HashSet<String>(Arrays.asList("id", "name", "number"))),
                    "Batch contains photos or metadata");
    }
    private static void lifecycle(Path root) throws Exception {
        try (Urn urn = new Urn(root.resolve("lifecycle"))) {
            blank(urn.get("state"));
            check(!object(new String(urn.bytes(), StandardCharsets.UTF_8)).has("credentials"), "Fresh store saved credentials");
            rejected(urn.request("POST", "admin/access", new JSONObject(), false, false), "Access without CSRF accepted");
            rejected(urn.request("GET", "admin/state", null, true, false), "Admin state without session accepted");
            rejected(urn.request("POST", "identify", new JSONObject().put("name", "Eleitor Inicial Fictício").put("grade", "8º A"), true, false), "Vote before opening accepted");
            JSONObject config = config(3, "Urna Android Fictícia");
            urn.configure(config);
            configuration(urn.get("state"), config);
            JSONObject response = urn.get("state"); response.put("school", "Do not persist");
            check(urn.get("state").getString("school").equals(config.getString("school")), "Response mutates internal state");
            byte[] original = urn.bytes();
            List<JSONObject> invalid = new ArrayList<JSONObject>();
            JSONObject value = cloneJson(config); value.getJSONArray("candidates").getJSONObject(1).put("number", "01"); invalid.add(value);
            value = cloneJson(config); value.put("school", "\u001cEscola Fictícia"); invalid.add(value);
            value = cloneJson(config); value.getJSONArray("candidates").getJSONObject(0).put("number", "１2"); invalid.add(value);
            value = cloneJson(config); value.getJSONArray("candidates").getJSONObject(0).put("number", "1"); invalid.add(value);
            value = cloneJson(config); value.getJSONArray("candidates").getJSONObject(0).put("id", "c99"); invalid.add(value);
            value = cloneJson(config); value.put("schoolLogo", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="); invalid.add(value);
            value = cloneJson(config); value.getJSONArray("candidates").getJSONObject(0).put("groupPhoto", "https://example.invalid/image.png"); invalid.add(value);
            value = cloneJson(config); value.put("schoolLogo", "data:image/png;base64,%%%"); invalid.add(value);
            value = cloneJson(config); value.put("schoolLogo", IMAGE.replace("image/png", "image/jpeg")); invalid.add(value);
            value = cloneJson(config); value.getJSONArray("candidates").getJSONObject(0).put("proposals", "Invalid\u0000text"); invalid.add(value);
            value = cloneJson(config); value.getJSONArray("candidates").getJSONObject(0).put("proposals", String.join("", Collections.nCopies(4001, "X"))); invalid.add(value);
            value = cloneJson(config); value.put("candidates", new JSONArray().put(config.getJSONArray("candidates").get(0))); invalid.add(value);
            value = config(12, "Fictícia"); value.getJSONArray("candidates").put(cloneJson(value.getJSONArray("candidates").getJSONObject(11)).put("id", "c13").put("number", "20")); invalid.add(value);
            for (JSONObject bad : invalid) {
                rejected(urn.request("POST", "admin/config", bad, true, true), "Invalid configuration accepted");
                check(Arrays.equals(original, urn.bytes()), "Rejected configuration changed disk");
            }
            JSONObject cyclic = new JSONObject(); cyclic.put("self", cyclic);
            rejected(urn.request("POST", "admin/config", cyclic, true, true), "Cyclic JSON body accepted");
            JSONObject deep = new JSONObject(), cursor = deep;
            for (int i = 0; i < 61; i++) { JSONObject next = new JSONObject(); cursor.put("next", next); cursor = next; }
            rejected(urn.request("POST", "admin/config", deep, true, true), "Excessively deep JSON body accepted");
            check(Arrays.equals(original, urn.bytes()), "Malformed JSON body changed stored data");
            rejected(urn.request("POST", "admin/config", config, false, true), "Configuration without CSRF accepted");
            urn.restart(); urn.access();
            configuration(urn.get("state"), config);
            check(Arrays.equals(original, urn.bytes()) && urn.get("state").getString("status").equals("setup"), "Restart changed or opened draft");
            boolean locked = false;
            try (ElectionStore ignored = new ElectionStore(urn.directory)) { } catch (IOException expected) { locked = true; }
            check(locked, "Second store acquired the same data directory");
            urn.post("admin/open", new JSONObject());
            original = urn.bytes();
            rejected(urn.request("POST", "admin/config", config, true, true), "Open configuration was changed");
            check(Arrays.equals(original, urn.bytes()), "Frozen configuration was rewritten");
            final String voterToken = urn.identify("  Ána   Fictícia  ");
            ExecutorService pool = Executors.newFixedThreadPool(2);
            try {
                Callable<JSONObject> vote = new Callable<JSONObject>() { public JSONObject call() throws Exception { return urn.confirm(voterToken, "c1"); } };
                List<Future<JSONObject>> replies = pool.invokeAll(Arrays.asList(vote, vote));
                int accepted = 0;
                for (Future<JSONObject> reply : replies) { int status = reply.get().getInt("status"); if (status >= 200 && status < 300) accepted++; }
                check(accepted == 1, "Concurrent confirmation accepted more or fewer than once");
            } finally { pool.shutdownNow(); }
            rejected(urn.request("POST", "identify", new JSONObject().put("name", "ANA FICTICIA").put("grade", "8º a"), true, false), "Normalized duplicate accepted");
            rejected(urn.confirm(voterToken, "c2"), "Spent token accepted");
            urn.vote("Eleitor Fictício B", "c2"); urn.vote("Eleitor Fictício Branco", "blank"); urn.vote("Eleitor Fictício Nulo", "nullVote");
            JSONObject live = urn.get("admin/state");
            check(live.getInt("total") == 4 && !live.has("counts") && !live.has("participants"), "Live state leaks tally or attendance");
            for (File file : urn.directory.listFiles()) check(!file.getName().endsWith(".bak"), "Previous ballot snapshot retained");
            urn.restart(); urn.access();
            check(urn.get("state").getInt("total") == 4, "Votes lost after restart");
            String pending = urn.identify("Eleitor Fictício Pendente");
            urn.post("admin/close", new JSONObject());
            rejected(urn.confirm(pending, "c3"), "Closed election accepted pending vote");
            rejected(urn.request("POST", "admin/open", new JSONObject(), true, true), "Closed election reopened");
            JSONObject batch = urn.batch();
            JSONObject expected = counts(3, 0, 1, 1).put("c1", 1).put("c2", 1);
            totals(batch, expected, 4); minimalBatch(batch); csv(urn, batch);
            original = urn.bytes(); urn.restart(); urn.access();
            check(urn.get("state").getString("status").equals("closed") && Arrays.equals(original, urn.bytes()), "Closed restart changed stored state");
            totals(urn.batch(), expected, 4);
        }
        System.out.println("PASS Android lifecycle, CSRF/session, atomic persistence, lock, replay, duplicate, privacy, close and CSV");
    }
    private static void dynamic(Path root) throws Exception {
        JSONObject previous = null;
        for (int count : new int[] {2, 12}) try (Urn urn = new Urn(root.resolve("dynamic-" + count)); Urn other = new Urn(root.resolve("dynamic-other-" + count))) {
            JSONObject config = config(count, "Urna Fictícia " + count);
            if (count == 2) {
                config.put("schoolLogo", "");
                for (int i = 0; i < count; i++) config.getJSONArray("candidates").getJSONObject(i).put("groupPhoto", "");
            }
            urn.configure(config); urn.post("admin/open", new JSONObject());
            for (int i = 1; i <= count; i++) urn.vote("Eleitor Fictício " + count + " " + i, "c" + i);
            urn.vote("Branco Fictício " + count, "blank"); urn.vote("Nulo Fictício " + count, "nullVote");
            urn.post("admin/close", new JSONObject());
            JSONObject batch = urn.batch(), expected = counts(count, 1, 1, 1);
            totals(batch, expected, count + 2); minimalBatch(batch); csv(urn, batch);
            other.configure(config(count, "Outra Urna Fictícia " + count)); other.post("admin/open", new JSONObject());
            other.vote("Outro Eleitor Fictício " + count, "c" + count); other.post("admin/close", new JSONObject());
            JSONObject otherBatch = other.batch();
            check(!batch.getString("urnId").equals(otherBatch.getString("urnId")), "Independent stores share identity");
            JSONObject mergeBody = new JSONObject().put("batches", new JSONArray().put(batch).put(otherBatch));
            JSONObject merged = urn.post("admin/consolidate", mergeBody);
            totals(merged, cloneJson(expected).put("c" + count, 2), count + 3);
            rejected(urn.request("POST", "admin/consolidate", new JSONObject().put("batches", new JSONArray().put(batch).put(batch)), true, true), "Repeated urn consolidated");
            JSONObject duplicate = cloneJson(otherBatch);
            duplicate.getJSONArray("participants").put(0, cloneJson(batch.getJSONArray("participants").getJSONObject(0)));
            rejected(urn.request("POST", "admin/consolidate", new JSONObject().put("batches", new JSONArray().put(batch).put(duplicate)), true, true), "Repeated student consolidated");
            JSONObject inconsistent = cloneJson(otherBatch).put("total", 2);
            rejected(urn.request("POST", "admin/consolidate", new JSONObject().put("batches", new JSONArray().put(batch).put(inconsistent)), true, true), "Inconsistent totals consolidated");
            JSONObject extraCount = cloneJson(otherBatch); extraCount.getJSONObject("counts").put("c99", 0);
            rejected(urn.request("POST", "admin/consolidate", new JSONObject().put("batches", new JSONArray().put(batch).put(extraCount)), true, true), "Unknown count key consolidated");
            if (previous != null) rejected(urn.request("POST", "admin/consolidate", new JSONObject().put("batches", new JSONArray().put(previous).put(batch)), true, true), "Different elections consolidated");
            previous = batch;
        }
        System.out.println("PASS Android dynamic 2/12 candidates, all choices, exact merge and duplicate/incompatible rejection");
    }
    private static void corrupt(Path root) throws Exception {
        String[] invalid = {"{\"damaged\":invalid JSON", String.join("", Collections.nCopies(61, "{\"next\":")) + "{}" + String.join("", Collections.nCopies(61, "}"))};
        for (int i = 0; i < invalid.length; i++) {
            Path directory = root.resolve("corrupt-" + i); Files.createDirectories(directory);
            byte[] damaged = invalid[i].getBytes(StandardCharsets.UTF_8);
            Files.write(directory.resolve("urna.json"), damaged);
            boolean failed = false;
            try (ElectionStore ignored = new ElectionStore(directory.toFile())) { } catch (IOException expected) { failed = true; }
            check(failed && Arrays.equals(damaged, Files.readAllBytes(directory.resolve("urna.json"))), "Corruption erased or replaced existing data");
            try (java.nio.channels.FileChannel channel = java.nio.channels.FileChannel.open(directory.resolve("urna.lock"), java.nio.file.StandardOpenOption.READ, java.nio.file.StandardOpenOption.WRITE);
                 java.nio.channels.FileLock lock = channel.tryLock()) { check(lock != null, "Failed startup retained the data lock"); }
        }
        System.out.println("PASS Android damaged state fails without overwriting data");
    }
    private static void nextElection(Path root) throws Exception {
        try (Urn urn = new Urn(root.resolve("new-election"))) {
            urn.access();
            JSONObject confirmed = new JSONObject().put("confirmed", true);
            rejected(urn.request("POST", "admin/new", confirmed, true, true), "A draft election was reset");
            JSONObject configuration = config(3, "Urna Fictícia Novo Ciclo");
            urn.configure(configuration); urn.post("admin/open", new JSONObject());
            rejected(urn.request("POST", "admin/new", confirmed, true, true), "An open election was reset");
            urn.vote("Eleitor Fictício Ciclo Anterior", "c1"); urn.post("admin/close", new JSONObject());
            JSONObject finished = urn.get("state");
            byte[] finalBytes = urn.bytes();
            rejected(urn.request("POST", "admin/new", new JSONObject().put("confirmed", false), true, true), "Unconfirmed new election was created");
            rejected(urn.request("POST", "admin/new", new JSONObject().put("confirmed", "true"), true, true), "Text confirmation was accepted as a boolean");
            rejected(urn.request("POST", "admin/new", confirmed, false, true), "New election without CSRF was created");
            rejected(urn.request("POST", "admin/new", confirmed, true, false), "New election without session was created");
            check(Arrays.equals(finalBytes, urn.bytes()), "Rejected new-election action changed final data");
            urn.post("admin/new", confirmed);
            rejected(urn.request("GET", "admin/state", null, true, true), "Previous admin session survived a new election");
            JSONObject fresh = urn.get("state");
            check(fresh.getString("status").equals("setup") && fresh.getInt("total") == 0 && !fresh.getBoolean("configured"), "New cycle did not start an empty draft");
            check(!fresh.getString("urnId").equals(finished.getString("urnId")), "New election reused the old urn ID");
            for (String field : Arrays.asList("school", "schoolLogo", "electionTitle"))
                check(fresh.optString(field).equals(configuration.optString(field)), "New cycle lost " + field);
            check(fresh.getJSONArray("candidates").length() == 3, "New cycle retained the old candidate list");
            for (int i = 0; i < 3; i++) for (String field : Arrays.asList("name", "number", "portrait", "groupPhoto", "representativeName", "members", "proposals"))
                check(fresh.getJSONArray("candidates").getJSONObject(i).optString(field).isEmpty(), "New cycle retained candidate " + field);
            Path archiveDirectory = urn.directory.toPath().resolve("archives");
            List<Path> archives = new ArrayList<Path>();
            try (Stream<Path> paths = Files.list(archiveDirectory)) { paths.forEach(archives::add); }
            check(archives.size() == 1 && Arrays.equals(finalBytes, Files.readAllBytes(archives.get(0))), "Final election archive is absent or changed");
            check(archives.get(0).getFileName().toString().equals("urna-" + finished.getString("urnId") + ".json"), "Archive does not identify the previous urn");
            urn.access(); totals(urn.get("admin/state"), counts(3, 0, 0, 0), 0);
            boolean locked = false;
            try (ElectionStore ignored = new ElectionStore(urn.directory)) { } catch (IOException expected) { locked = true; }
            check(locked, "Starting another election released the directory lock");
            byte[] newBytes = urn.bytes(); urn.restart(); urn.access();
            check(Arrays.equals(newBytes, urn.bytes()) && urn.get("state").getString("urnId").equals(fresh.getString("urnId")), "New cycle did not persist across restart");
            check(Arrays.equals(finalBytes, Files.readAllBytes(archives.get(0))), "Restart changed final election archive");
        }
        System.out.println("PASS Android new election: only after close/confirmation, one intact final archive, new zero-vote identity, persistence and lock");
    }
    private static void archiveRetry(Path root) throws Exception {
        try (Urn urn = new Urn(root.resolve("archive-retry"))) {
            urn.configure(config(3, "Urna Fictícia Arquivo")); urn.post("admin/open", new JSONObject());
            urn.vote("Eleitor Fictício Arquivo", "c3"); urn.post("admin/close", new JSONObject());
            byte[] finished = urn.bytes();
            String previousId = urn.get("state").getString("urnId");
            Path archiveDirectory = urn.directory.toPath().resolve("archives"); Files.createDirectories(archiveDirectory);
            Path archive = archiveDirectory.resolve("urna-" + previousId + ".json");
            byte[] collision = "Fictitious conflicting archive".getBytes(StandardCharsets.UTF_8); Files.write(archive, collision);
            JSONObject confirmed = new JSONObject().put("confirmed", true);
            rejected(urn.request("POST", "admin/new", confirmed, true, true), "A different existing archive was overwritten");
            check(Arrays.equals(finished, urn.bytes()) && Arrays.equals(collision, Files.readAllBytes(archive)), "Archive conflict modified previous election data");
            Files.write(archive, finished);
            urn.post("admin/new", confirmed);
            check(urn.get("state").getString("status").equals("setup") && Arrays.equals(finished, Files.readAllBytes(archive)), "Identical existing archive could not be reused safely");
        }
        System.out.println("PASS Android final-archive collision refusal and safe retry with an identical archive");
    }
    private static void handoff(Path input, Path output) throws Exception {
        JSONObject fixture = object(new String(Files.readAllBytes(input), StandardCharsets.UTF_8));
        Path root = Files.createTempDirectory("urna-android-handoff-");
        try (Urn urn = new Urn(root.resolve("data"))) {
            urn.configure(fixture.getJSONObject("configuration")); urn.post("admin/open", new JSONObject());
            urn.vote("Eleitor Android Fictício Chapa", "c2"); urn.vote("Eleitor Android Fictício Nulo", "nullVote");
            urn.post("admin/close", new JSONObject());
            JSONObject batch = urn.batch(), windows = fixture.getJSONObject("windowsBatch");
            check(batch.getString("electionId").equals(windows.getString("electionId")), "Windows/Android canonical election hashes differ");
            JSONObject merged = urn.post("admin/consolidate", new JSONObject().put("batches", new JSONArray().put(windows).put(batch)));
            totals(merged, counts(3, 0, 1, 1).put("c1", 1).put("c2", 1), 4);
            Files.write(output, new JSONObject().put("androidBatch", batch).put("androidMerged", merged).toString().getBytes(StandardCharsets.UTF_8));
        } finally { deleteTemporary(root); }
        System.out.println("PASS Windows batch accepted and consolidated by Android store");
    }
    private static void deleteTemporary(Path root) throws Exception {
        try (Stream<Path> paths = Files.walk(root)) {
            List<Path> ordered = new ArrayList<Path>(); paths.forEach(ordered::add); Collections.sort(ordered, Collections.reverseOrder());
            for (Path path : ordered) Files.delete(path);
        }
    }
    public static void main(String[] args) throws Exception {
        if (args.length == 3 && args[0].equals("--handoff")) { handoff(new File(args[1]).toPath(), new File(args[2]).toPath()); return; }
        boolean archiveOnly = args.length == 1 && args[0].equals("--archive-smoke");
        check(args.length == 0 || archiveOnly, "Usage: ElectionStoreTest [--archive-smoke | --handoff synthetic-input.json synthetic-output.json]");
        Path root = Files.createTempDirectory("urna-android-tests-");
        try { if (archiveOnly) archiveRetry(root); else { lifecycle(root); dynamic(root); nextElection(root); archiveRetry(root); corrupt(root); } }
        finally { deleteTemporary(root); }
        System.out.println(archiveOnly ? "ANDROID ARCHIVE SMOKE PASSED" : "ALL ANDROID STORE CHECKS PASSED");
    }
}
