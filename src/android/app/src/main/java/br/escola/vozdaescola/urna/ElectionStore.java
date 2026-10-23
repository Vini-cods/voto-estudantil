package br.escola.vozdaescola.urna;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.text.Normalizer;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Offline election rules, deliberately independent of Android UI/framework classes.
 * The state/export format and election fingerprint are shared with the Windows app.
 * Only aggregate counts and a separately sorted presence list are ever persisted.
 */
public final class ElectionStore implements Closeable {
    private static final int MAX_BODY = 64 * 1024 * 1024;
    private static final int MAX_IMAGE = 3 * 1024 * 1024;
    private static final int MAX_COUNT = 100000000;
    private static final long ADMIN_LIFETIME = 8L * 60 * 60 * 1000;
    private static final long VOTER_LIFETIME = 10L * 60 * 1000;
    private static final String JSON_TYPE = "application/json; charset=utf-8";
    private static final String CSV_TYPE = "text/csv; charset=utf-8";
    private static final Pattern WHITESPACE = Pattern.compile("[\\x09-\\x0d\\u0085\\p{Z}]+");
    private static final Pattern CLEAN_CONTROLS = Pattern.compile("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]");
    private static final Pattern MULTILINE_CONTROLS = Pattern.compile("[\\x00-\\x09\\x0b-\\x1f\\x7f]");
    private static final Pattern IMAGE_PATTERN = Pattern.compile("^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$");
    private static final DateTimeFormatter ISO_TIME = DateTimeFormatter
            .ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSSSSSS'Z'", Locale.ROOT).withZone(ZoneOffset.UTC);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Set<String> OPEN_DIRECTORIES = new HashSet<String>();

    private final File directory;
    private final File stateFile;
    private final String csrfToken;
    private final Map<String, Long> adminSessions = new HashMap<String, Long>();
    private final Map<String, Voter> voters = new HashMap<String, Voter>();
    private RandomAccessFile lockFile;
    private FileChannel lockChannel;
    private FileLock instanceLock;
    private JSONObject state;
    private boolean closed;
    private boolean registered;

    private static final class Voter {
        final String name;
        final String grade;
        final long expires;
        Voter(String name, String grade, long expires) {
            this.name = name;
            this.grade = grade;
            this.expires = expires;
        }
    }

    private static final class ApiError extends RuntimeException {
        final int status;
        ApiError(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    /** Opens or creates only this directory; malformed existing files are never reset. */
    public ElectionStore(File directory) throws IOException {
        if (directory == null) throw new IOException("Pasta de dados não informada.");
        this.directory = directory.getCanonicalFile();
        this.stateFile = new File(this.directory, "urna.json");
        this.csrfToken = randomToken();
        try {
            if (!this.directory.isDirectory()
                    && !this.directory.mkdirs()
                    && !this.directory.isDirectory()) {
                throw new IOException("Não foi possível criar a pasta de dados da urna.");
            }
            // Avoid a second channel to the same file in this JVM. On some Unix
            // providers, closing any channel can release another channel's lock.
            synchronized (OPEN_DIRECTORIES) {
                if (!OPEN_DIRECTORIES.add(this.directory.getPath())) {
                    throw new IOException("Esta urna já está aberta para esta pasta de dados.");
                }
                registered = true;
            }
            lockFile = new RandomAccessFile(new File(this.directory, "urna.lock"), "rw");
            lockChannel = lockFile.getChannel();
            try {
                instanceLock = lockChannel.tryLock();
            } catch (OverlappingFileLockException e) {
                throw new IOException("Esta urna já está aberta para esta pasta de dados.", e);
            }
            if (instanceLock == null) throw new IOException("Esta urna já está aberta para esta pasta de dados.");
            if (stateFile.exists()) {
                try {
                    if (!stateFile.isFile() || stateFile.length() > MAX_BODY) {
                        throw new IOException("Arquivo de dados inválido ou grande demais.");
                    }
                    byte[] bytes = Files.readAllBytes(stateFile.toPath());
                    String text = StandardCharsets.UTF_8.newDecoder()
                            .onMalformedInput(CodingErrorAction.REPORT)
                            .onUnmappableCharacter(CodingErrorAction.REPORT)
                            .decode(ByteBuffer.wrap(bytes)).toString();
                    if (text.startsWith("\ufeff")) text = text.substring(1);
                    state = parseObject(text);
                    validateStored(state);
                } catch (Exception e) {
                    throw new IOException("O arquivo urna.json está inválido. Os dados foram preservados. "
                            + "Não apague a pasta; procure a equipe responsável. Detalhe: " + e.getMessage(), e);
                }
            } else {
                if (new File(this.directory, "urna.json.bak").exists()) {
                    throw new IOException("urna.json está ausente, mas existe urna.json.bak. "
                            + "Os dados foram preservados; restaure a cópia antes de abrir a urna.");
                }
                save(newState());
            }
        } catch (Exception e) {
            try { close(); } catch (IOException ignored) { }
            if (e instanceof IOException) throw (IOException) e;
            throw new IOException("Não foi possível abrir a urna: " + e.getMessage(), e);
        }
    }

    public String csrf() { return csrfToken; }

    /**
     * Paths are relative to /api/, for example "state" or "admin/config".
     * Replies are {status,data,contentType[,filename]}, including all error replies.
     */
    public synchronized JSONObject handle(String method, String path, JSONObject body,
                                          String csrf, String adminToken) {
        try {
            if (closed) throw new ApiError(409, "A urna foi fechada pelo aplicativo. Abra-a novamente para continuar.");
            method = method == null ? "" : method.toUpperCase(Locale.ROOT);
            path = path == null ? "" : path;
            if (!"GET".equals(method) && !"POST".equals(method)) {
                throw new ApiError(405, "Método não permitido.");
            }
            if ("GET".equals(method) && "state".equals(path)) return json(publicState());
            if ("POST".equals(method)) {
                if (!sameToken(csrfToken, csrf)) throw new ApiError(403, "Recarregue a página desta urna e tente novamente.");
                if (body == null) body = new JSONObject();
                String serialized = stringify(body);
                if (serialized.getBytes(StandardCharsets.UTF_8).length > MAX_BODY) {
                    throw new ApiError(413, "Arquivo muito grande. Reduza as imagens ou use menos arquivos de cada vez.");
                }
            }
            if ("POST".equals(method) && "admin/access".equals(path)) {
                String token = randomToken();
                long now = System.currentTimeMillis();
                Iterator<Map.Entry<String, Long>> sessions = adminSessions.entrySet().iterator();
                while (sessions.hasNext()) if (sessions.next().getValue() < now) sessions.remove();
                adminSessions.put(token, now + ADMIN_LIFETIME);
                return json(object("adminToken", token));
            }
            if ("POST".equals(method) && ("admin/setup".equals(path) || "admin/login".equals(path))) {
                throw new ApiError(409, "Esta urna não utiliza senha. Abra o painel de configuração ou de resultados.");
            }
            if (path.startsWith("admin/")) {
                needAdmin(adminToken);
                if ("GET".equals(method) && "admin/state".equals(path)) return json(adminState());
                if ("POST".equals(method) && "admin/config".equals(path)) {
                    needSetup();
                    JSONObject next = cloneObject(state);
                    configure(next, body);
                    save(next);
                    return json(adminState());
                }
                if ("POST".equals(method) && "admin/open".equals(path)) {
                    needSetup();
                    validateCandidates(state, true);
                    JSONObject next = cloneObject(state);
                    put(next, "status", "open");
                    put(next, "openedAt", now());
                    put(next, "electionId", electionId(next));
                    save(next);
                    return json(publicState());
                }
                if ("POST".equals(method) && "admin/close".equals(path)) {
                    needOpen();
                    JSONObject next = cloneObject(state);
                    put(next, "status", "closed");
                    put(next, "closedAt", now());
                    save(next);
                    voters.clear();
                    return json(adminState());
                }
                if ("POST".equals(method) && "admin/new".equals(path)) {
                    if (!"closed".equals(text(state, "status"))) {
                        throw new ApiError(409, "Finalize a eleição atual antes de preparar outra.");
                    }
                    if (!Boolean.TRUE.equals(body.opt("confirmed"))) {
                        throw new ApiError(400, "Confirme que os relatórios e o arquivo da eleição atual já foram exportados.");
                    }
                    archiveClosedElection();
                    JSONObject next = newState();
                    put(next, "school", text(state, "school"));
                    put(next, "schoolLogo", text(state, "schoolLogo"));
                    put(next, "electionTitle", text(state, "electionTitle"));
                    save(next);
                    JSONObject result = json(publicState());
                    voters.clear();
                    adminSessions.clear();
                    return result;
                }
                if ("GET".equals(method) && ("admin/export".equals(path)
                        || "admin/backup".equals(path) || "admin/report".equals(path)
                        || "admin/participants".equals(path))) {
                    if (!"closed".equals(text(state, "status"))) {
                        throw new ApiError(409, "Finalize a votação desta urna para exportar os resultados.");
                    }
                    if ("admin/report".equals(path)) return csv(reportCsv(state), "resultado-" + text(state, "urnId") + ".csv");
                    if ("admin/participants".equals(path)) return csv(participantsCsv(state), "participantes-" + text(state, "urnId") + ".csv");
                    return response(200, batch(state), JSON_TYPE,
                            ("admin/backup".equals(path) ? "copia-urna-" : "urna-") + text(state, "urnId") + ".json");
                }
                if ("POST".equals(method) && "admin/consolidate".equals(path)) return json(consolidate(body));
            }
            if ("POST".equals(method) && "identify".equals(path)) {
                needOpen();
                String name = clean(text(body, "name"), 120);
                String grade = clean(text(body, "grade"), 60);
                if (name.length() < 2 || !hasLetter(name) || grade.length() == 0) {
                    throw new ApiError(400, "Informe o nome completo e a série do aluno.");
                }
                String identity = identity(name, grade);
                if (hasParticipant(state, identity)) {
                    throw new ApiError(409, "Este nome e série já registraram participação nesta urna. Procure a equipe responsável.");
                }
                long now = System.currentTimeMillis();
                Iterator<Map.Entry<String, Voter>> expired = voters.entrySet().iterator();
                while (expired.hasNext()) if (expired.next().getValue().expires < now) expired.remove();
                String token = randomToken();
                voters.put(token, new Voter(name, grade, now + VOTER_LIFETIME));
                return json(object("voterToken", token));
            }
            if ("POST".equals(method) && "vote".equals(path)) {
                needOpen();
                String token = text(body, "voterToken"), choice = text(body, "choice");
                Voter voter = voters.get(token);
                if (voter == null || voter.expires < System.currentTimeMillis()) {
                    throw new ApiError(409, "A identificação expirou ou este voto já foi confirmado. Volte ao início.");
                }
                if (!choiceKeys(state).contains(choice)) throw new ApiError(400, "Opção de voto inválida.");
                if (hasParticipant(state, identity(voter.name, voter.grade))) {
                    voters.remove(token);
                    throw new ApiError(409, "Este aluno já registrou participação nesta urna.");
                }
                JSONObject next = cloneObject(state), counts = obj(next.opt("counts"));
                put(counts, choice, Math.addExact(integer(counts.opt(choice)), 1));
                JSONArray people = array(next.opt("participants"));
                people.put(object("name", voter.name, "grade", voter.grade));
                put(next, "participants", sortedParticipants(people));
                save(next);
                voters.remove(token);
                return json(object("saved", true));
            }
            throw new ApiError(404, "Operação não encontrada.");
        } catch (ApiError e) {
            return response(e.status, object("error", e.getMessage()), JSON_TYPE, null);
        } catch (Exception e) {
            return response(500, object("error", "Não foi possível concluir a operação. Nenhum voto foi confirmado sem ser salvo. "
                    + "Confira o espaço livre, preserve a pasta de dados e procure a equipe responsável."), JSON_TYPE, null);
        }
    }

    @Override public synchronized void close() throws IOException {
        if (closed) return;
        closed = true;
        voters.clear();
        adminSessions.clear();
        IOException failure = null;
        try { if (instanceLock != null) instanceLock.release(); } catch (IOException e) { failure = e; }
        try { if (lockChannel != null) lockChannel.close(); } catch (IOException e) { if (failure == null) failure = e; }
        try { if (lockFile != null) lockFile.close(); } catch (IOException e) { if (failure == null) failure = e; }
        if (registered) {
            synchronized (OPEN_DIRECTORIES) { OPEN_DIRECTORIES.remove(directory.getPath()); }
            registered = false;
        }
        if (failure != null) throw failure;
    }

    private static JSONObject newState() {
        JSONArray candidates = new JSONArray();
        for (int i = 1; i <= 3; i++) candidates.put(object("id", "c" + i, "name", "", "number", "", "portrait", "",
                "groupPhoto", "", "proposals", "", "members", "", "representativeName", ""));
        String urnId = UUID.randomUUID().toString();
        JSONObject result = object("stateFormat", "urna-estudantil-state-v1", "urnId", urnId, "electionId", "",
                "urnName", "Urna " + urnId.substring(0, 8).toUpperCase(Locale.ROOT), "school", "", "schoolLogo", "",
                "electionTitle", "Eleição do Grêmio Estudantil", "status", "setup", "createdAt", now(),
                "openedAt", "", "closedAt", "", "candidates", candidates, "participants", new JSONArray());
        put(result, "counts", emptyCounts(result));
        return result;
    }

    private void save(JSONObject next) throws IOException {
        byte[] bytes = stringify(next).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BODY) throw new ApiError(413, "Os dados da urna excederam o tamanho permitido.");
        atomicWrite(stateFile, bytes);
        state = next;
    }

    private void archiveClosedElection() throws IOException {
        File archives = new File(directory, "archives");
        if (!archives.getCanonicalFile().equals(archives.getAbsoluteFile())) {
            throw new IOException("A pasta de arquivos finais não pode apontar para outra pasta.");
        }
        if (!archives.isDirectory() && !archives.mkdirs() && !archives.isDirectory()) {
            throw new IOException("Não foi possível criar a pasta de arquivos finais.");
        }
        byte[] committed = Files.readAllBytes(stateFile.toPath());
        File archive = new File(archives, "urna-" + canonicalUuid(text(state, "urnId")) + ".json");
        if (archive.exists()) {
            if (!archive.isFile() || !Arrays.equals(committed, Files.readAllBytes(archive.toPath()))) {
                throw new ApiError(409, "Já existe um arquivo final diferente para esta eleição. "
                        + "Os dados foram preservados; procure a equipe responsável.");
            }
            return;
        }
        atomicWrite(archive, committed);
    }

    private static void atomicWrite(File target, byte[] bytes) throws IOException {
        File temporary = File.createTempFile(target.getName() + ".tmp-", ".tmp", target.getParentFile());
        try {
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(bytes);
                output.flush();
                output.getFD().sync();
            }
            // No prior-vote backup: differences between snapshots can reveal the last vote.
            // If atomic replacement is unavailable, fail instead of weakening durability.
            Files.move(temporary.toPath(), target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            if (temporary.exists()) {
                try { Files.deleteIfExists(temporary.toPath()); } catch (IOException ignored) { }
            }
        }
    }

    private void needAdmin(String token) {
        Long expires = adminSessions.get(token);
        long now = System.currentTimeMillis();
        if (expires == null || expires < now) throw new ApiError(401, "Reabra o painel da urna para continuar.");
        adminSessions.put(token, now + ADMIN_LIFETIME);
    }

    private void needOpen() {
        if (!"open".equals(text(state, "status"))) throw new ApiError(409, "A votação não está aberta.");
    }

    private void needSetup() {
        if (!"setup".equals(text(state, "status")) || total(state) != 0) {
            throw new ApiError(409, "A configuração está bloqueada porque esta urna já foi aberta.");
        }
    }

    private JSONObject publicState() {
        return object("urnId", state.opt("urnId"), "electionId", state.opt("electionId"), "urnName", state.opt("urnName"),
                "school", state.opt("school"), "schoolLogo", text(state, "schoolLogo"), "electionTitle", state.opt("electionTitle"),
                "status", state.opt("status"), "configured", !"setup".equals(text(state, "status")),
                "candidates", displayCandidates(), "total", array(state.opt("participants")).length(), "csrfToken", csrfToken);
    }

    private JSONObject adminState() {
        JSONObject result = cloneObject(state);
        result.remove("credentials");
        put(result, "schoolLogo", text(state, "schoolLogo"));
        put(result, "candidates", displayCandidates());
        put(result, "configured", !"setup".equals(text(state, "status")));
        put(result, "total", total(state));
        if ("open".equals(text(state, "status"))) { result.remove("counts"); result.remove("participants"); }
        return result;
    }

    private JSONArray displayCandidates() {
        JSONArray result = new JSONArray(), candidates = array(state.opt("candidates"));
        for (int i = 0; i < candidates.length(); i++) {
            JSONObject candidate = cloneObject(obj(candidates.opt(i)));
            put(candidate, "portrait", "");
            result.put(candidate);
        }
        return result;
    }

    private static void configure(JSONObject next, JSONObject input) {
        put(next, "school", clean(inputText(input, "school"), 160));
        put(next, "electionTitle", clean(inputText(input, "electionTitle"), 160));
        put(next, "urnName", clean(inputText(input, "urnName"), 80));
        put(next, "schoolLogo", imageValue(input, "schoolLogo"));
        JSONArray source = array(input.opt("candidates")), candidates = new JSONArray();
        if (source.length() < 2 || source.length() > 12) throw new ApiError(400, "Cadastre de 2 a 12 chapas ou candidaturas.");
        for (int i = 0; i < source.length(); i++) {
            JSONObject c = obj(source.opt(i));
            if (!("c" + (i + 1)).equals(text(c, "id"))) throw new ApiError(400, "Ordem das candidaturas inválida.");
            candidates.put(object("id", "c" + (i + 1), "name", clean(inputText(c, "name"), 120),
                    "number", clean(inputText(c, "number"), 2), "portrait", "", "groupPhoto", imageValue(c, "groupPhoto"),
                    "proposals", proposalText(inputText(c, "proposals")), "members", proposalText(inputText(c, "members")),
                    "representativeName", clean(inputText(c, "representativeName"), 120)));
        }
        put(next, "candidates", candidates);
        put(next, "counts", emptyCounts(next));
        put(next, "electionId", ""); put(next, "openedAt", ""); put(next, "closedAt", "");
        validateCandidates(next, false);
    }

    private static void validateStored(JSONObject value) {
        if (!"urna-estudantil-state-v1".equals(text(value, "stateFormat"))) throw new ApiError(400, "Formato de dados desconhecido.");
        canonicalUuid(text(value, "urnId"));
        String status = text(value, "status");
        if (!"setup".equals(status) && !"open".equals(status) && !"closed".equals(status)) throw new ApiError(400, "Situação da urna inválida.");
        checkParticipants(value);
        validateCandidates(value, !"setup".equals(status));
        if (!"setup".equals(status) && !text(value, "electionId").equals(electionId(value))) {
            throw new ApiError(400, "Configuração ou identificação da eleição inválida.");
        }
        if ("setup".equals(status) && total(value) != 0) throw new ApiError(400, "Uma urna em configuração não pode ter votos.");
        Object credentials = value.opt("credentials");
        if (credentials != null && credentials != JSONObject.NULL) {
            JSONObject c = obj(credentials);
            try {
                if (decodeBase64(text(c, "salt")).length < 16 || decodeBase64(text(c, "hash")).length != 32
                        || integer(c.opt("iterations")) < 100000) throw new IllegalArgumentException();
            } catch (IllegalArgumentException e) { throw new ApiError(400, "Credencial inválida."); }
        }
    }

    private static void validateCandidates(JSONObject value, boolean full) {
        JSONArray candidates = array(value.opt("candidates"));
        choiceKeys(value);
        clean(inputText(value, "school"), 160);
        clean(inputText(value, "electionTitle"), 160);
        clean(inputText(value, "urnName"), 80);
        Set<String> numbers = new HashSet<String>();
        for (int i = 0; i < candidates.length(); i++) {
            JSONObject c = obj(candidates.opt(i));
            String number = inputText(c, "number"), name = clean(inputText(c, "name"), 120);
            proposalText(inputText(c, "proposals")); proposalText(inputText(c, "members"));
            clean(inputText(c, "representativeName"), 120);
            if (!("c" + (i + 1)).equals(text(c, "id"))) throw new ApiError(400, "Identificação das candidaturas inválida.");
            if (number.length() > 0 && (!number.matches("[0-9]{2}") || !numbers.add(number))) {
                throw new ApiError(400, "Os números das candidaturas devem ter dois algarismos e ser diferentes.");
            }
            if (full && (name.length() < 2 || number.length() != 2)) throw new ApiError(400, "Preencha o nome e o número de todas as chapas ou candidaturas.");
        }
        if (full && (clean(text(value, "school"), 160).length() < 2
                || clean(text(value, "electionTitle"), 160).length() < 2
                || clean(text(value, "urnName"), 80).length() < 2)) {
            throw new ApiError(400, "Preencha escola, título da eleição e identificação desta urna.");
        }
    }

    private static List<String> choiceKeys(JSONObject value) {
        JSONArray candidates = array(value.opt("candidates"));
        if (candidates.length() < 2 || candidates.length() > 12) throw new ApiError(400, "Cadastre de 2 a 12 chapas ou candidaturas.");
        List<String> keys = new ArrayList<String>();
        for (int i = 0; i < candidates.length(); i++) {
            String id = text(obj(candidates.opt(i)), "id");
            if (!("c" + (i + 1)).equals(id)) throw new ApiError(400, "Identificação das candidaturas inválida.");
            keys.add(id);
        }
        keys.add("blank"); keys.add("nullVote"); return keys;
    }

    private static JSONObject emptyCounts(JSONObject value) {
        JSONObject counts = new JSONObject();
        for (String key : choiceKeys(value)) put(counts, key, 0);
        return counts;
    }

    private static int total(JSONObject value) {
        JSONObject counts = obj(value.opt("counts"));
        List<String> keys = choiceKeys(value);
        int total = 0;
        for (String key : keys) total = Math.addExact(total, integer(counts.opt(key)));
        if (counts.length() != keys.size()) throw new ApiError(400, "O conjunto de contagens é inválido.");
        return total;
    }

    private static void checkParticipants(JSONObject value) {
        JSONArray people = array(value.opt("participants"));
        if (people.length() != total(value)) throw new ApiError(400, "Total de votos diferente do total de participantes.");
        Set<String> identities = new HashSet<String>();
        for (int i = 0; i < people.length(); i++) {
            JSONObject p = obj(people.opt(i));
            String name = clean(text(p, "name"), 120), grade = clean(text(p, "grade"), 60);
            if (name.length() < 2 || grade.length() == 0 || p.length() != 2 || !p.has("name") || !p.has("grade")) {
                throw new ApiError(400, "Participante inválido. O cadastro deve conter somente nome e série.");
            }
            if (!identities.add(identity(name, grade))) throw new ApiError(400, "Participante repetido no arquivo da urna.");
        }
    }

    private static boolean hasParticipant(JSONObject value, String identity) {
        JSONArray people = array(value.opt("participants"));
        for (int i = 0; i < people.length(); i++) {
            JSONObject p = obj(people.opt(i));
            if (identity(text(p, "name"), text(p, "grade")).equals(identity)) return true;
        }
        return false;
    }

    private static JSONArray sortedParticipants(JSONArray input) {
        List<JSONObject> people = new ArrayList<JSONObject>();
        for (int i = 0; i < input.length(); i++) people.add(obj(input.opt(i)));
        Collections.sort(people, new Comparator<JSONObject>() {
            @Override public int compare(JSONObject a, JSONObject b) {
                int name = fold(text(a, "name")).compareTo(fold(text(b, "name")));
                return name != 0 ? name : fold(text(a, "grade")).compareTo(fold(text(b, "grade")));
            }
        });
        JSONArray result = new JSONArray();
        for (JSONObject person : people) result.put(person);
        return result;
    }

    private static String electionId(JSONObject value) {
        StringBuilder canonical = new StringBuilder("urna-estudantil-config-v1\n");
        appendCanonical(canonical, text(value, "school")); appendCanonical(canonical, text(value, "electionTitle"));
        JSONArray candidates = array(value.opt("candidates"));
        for (int i = 0; i < candidates.length(); i++) {
            JSONObject c = obj(candidates.opt(i));
            appendCanonical(canonical, text(c, "id")); appendCanonical(canonical, text(c, "name")); appendCanonical(canonical, text(c, "number"));
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
            return hex.toString();
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private static void appendCanonical(StringBuilder target, String value) {
        value = clean(value, 200);
        // String.length() is UTF-16 code units, exactly the length used by .NET.
        target.append(value.length()).append(':').append(value).append('\n');
    }

    private static JSONObject batch(JSONObject value) {
        JSONArray candidates = new JSONArray(), source = array(value.opt("candidates"));
        for (int i = 0; i < source.length(); i++) {
            JSONObject c = obj(source.opt(i));
            candidates.put(object("id", c.opt("id"), "name", c.opt("name"), "number", c.opt("number")));
        }
        return object("format", "urna-estudantil-v1", "electionId", value.opt("electionId"), "urnId", value.opt("urnId"),
                "urnName", value.opt("urnName"), "school", value.opt("school"), "electionTitle", value.opt("electionTitle"),
                "status", value.opt("status"), "openedAt", value.opt("openedAt"), "closedAt", value.opt("closedAt"),
                "candidates", candidates, "counts", value.opt("counts"),
                "participants", sortedParticipants(array(value.opt("participants"))), "total", total(value));
    }

    private static JSONObject consolidate(JSONObject input) {
        JSONArray batches = array(input.opt("batches"));
        if (batches.length() < 1 || batches.length() > 300) throw new ApiError(400, "Selecione de 1 a 300 arquivos de resultados.");
        JSONObject first = null, counts = null;
        JSONArray people = new JSONArray(), urns = new JSONArray();
        Set<String> urnIds = new HashSet<String>(), identities = new HashSet<String>();
        for (int i = 0; i < batches.length(); i++) {
            JSONObject b = obj(batches.opt(i));
            if (!"urna-estudantil-v1".equals(text(b, "format")) || !"closed".equals(text(b, "status"))) {
                throw new ApiError(400, "Use somente arquivos JSON de urnas finalizadas.");
            }
            String urnId = canonicalUuid(text(b, "urnId"));
            if (!urnIds.add(urnId)) throw new ApiError(409, "Há um arquivo repetido da mesma urna. Cada urna deve aparecer apenas uma vez.");
            validateCandidates(b, true);
            if (!text(b, "electionId").equals(electionId(b))) throw new ApiError(400, "A configuração de um arquivo não corresponde à identificação da eleição.");
            if (first == null) { first = b; counts = emptyCounts(b); }
            else if (!text(first, "electionId").equals(text(b, "electionId"))) {
                throw new ApiError(409, "Os arquivos pertencem a eleições ou candidaturas diferentes. Use a mesma configuração em todos os aparelhos.");
            }
            checkParticipants(b);
            int total = total(b);
            if (integer(b.opt("total")) != total) throw new ApiError(400, "Total declarado incorreto em um arquivo.");
            if (text(b, "openedAt").length() == 0 || text(b, "closedAt").length() == 0) throw new ApiError(400, "Arquivo sem registro de abertura ou fechamento.");
            JSONArray localPeople = array(b.opt("participants"));
            for (int p = 0; p < localPeople.length(); p++) {
                JSONObject person = obj(localPeople.opt(p));
                if (!identities.add(identity(text(person, "name"), text(person, "grade")))) {
                    throw new ApiError(409, "Foi encontrado o mesmo nome e série em mais de uma urna. A soma foi bloqueada; "
                            + "a equipe responsável deve conferir os participantes. O sigilo impede identificar ou excluir o voto desse aluno.");
                }
                people.put(object("name", text(person, "name"), "grade", text(person, "grade")));
            }
            JSONObject localCounts = obj(b.opt("counts"));
            for (String choice : choiceKeys(b)) put(counts, choice,
                    Math.addExact(integer(counts.opt(choice)), integer(localCounts.opt(choice))));
            urns.put(object("urnId", b.opt("urnId"), "urnName", b.opt("urnName"), "total", total, "closedAt", b.opt("closedAt")));
        }
        return object("format", "urna-estudantil-consolidado-v1", "electionId", first.opt("electionId"),
                "school", first.opt("school"), "electionTitle", first.opt("electionTitle"), "candidates", first.opt("candidates"),
                "counts", counts, "total", people.length(), "urns", urns, "participants", sortedParticipants(people), "duplicateCount", 0);
    }

    private static String imageValue(JSONObject input, String key) {
        String value = inputText(input, key);
        if (value.length() == 0) return "";
        if (value.length() > ((MAX_IMAGE + 2) / 3) * 4 + 64 || !IMAGE_PATTERN.matcher(value).find()) {
            throw new ApiError(400, "Use uma imagem PNG, JPEG ou WebP de até 3 MB.");
        }
        byte[] bytes;
        try { bytes = decodeBase64(value.substring(value.indexOf(',') + 1)); }
        catch (IllegalArgumentException e) { throw new ApiError(400, "Imagem inválida."); }
        if (bytes.length == 0 || bytes.length > MAX_IMAGE) throw new ApiError(400, "Use uma imagem de até 3 MB.");
        boolean png = value.startsWith("data:image/png;") && bytes.length >= 8
                && (bytes[0] & 255) == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71
                && bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10;
        boolean jpeg = value.startsWith("data:image/jpeg;") && bytes.length >= 3
                && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255;
        boolean webp = value.startsWith("data:image/webp;") && bytes.length >= 12
                && "RIFF".equals(new String(bytes, 0, 4, StandardCharsets.US_ASCII))
                && "WEBP".equals(new String(bytes, 8, 4, StandardCharsets.US_ASCII));
        if (!png && !jpeg && !webp) throw new ApiError(400, "O conteúdo da imagem não corresponde ao formato informado.");
        return value;
    }

    private static String reportCsv(JSONObject value) {
        StringBuilder b = new StringBuilder();
        line(b, csv("RELATÓRIO DA URNA ESTUDANTIL"));
        line(b, csv("Escola") + ";" + csvSafe(text(value, "school")));
        line(b, csv("Eleição") + ";" + csvSafe(text(value, "electionTitle")));
        line(b, csv("Urna") + ";" + csvSafe(text(value, "urnName")));
        line(b, csv("Identificação da urna") + ";" + csv(text(value, "urnId")));
        line(b, "\"Situação\";\"FINALIZADA\"");
        line(b, csv("Abertura (UTC)") + ";" + csv(text(value, "openedAt")));
        line(b, csv("Finalização (UTC)") + ";" + csv(text(value, "closedAt")));
        line(b, ""); line(b, "\"Opção\";\"Número\";\"Votos\"");
        JSONObject counts = obj(value.opt("counts"));
        JSONArray candidates = array(value.opt("candidates"));
        for (int i = 0; i < candidates.length(); i++) {
            JSONObject c = obj(candidates.opt(i));
            line(b, csvSafe(text(c, "name")) + ";" + csv("'" + text(c, "number")) + ";" + integer(counts.opt(text(c, "id"))));
        }
        line(b, "\"Brancos\";\"\";" + integer(counts.opt("blank")));
        line(b, "\"Nulos\";\"\";" + integer(counts.opt("nullVote")));
        line(b, "\"TOTAL DE VOTOS\";\"\";" + total(value));
        line(b, "\"TOTAL DE PARTICIPANTES\";\"\";" + array(value.opt("participants")).length());
        line(b, "\"Conferência\";\"Votos e participantes conferem\"");
        line(b, ""); line(b, csv("Voto secreto: este relatório não relaciona alunos a escolhas."));
        return "\ufeff" + b.toString();
    }

    private static String participantsCsv(JSONObject value) {
        StringBuilder b = new StringBuilder("\"Nome\";\"Série\"\r\n");
        JSONArray people = sortedParticipants(array(value.opt("participants")));
        for (int i = 0; i < people.length(); i++) {
            JSONObject p = obj(people.opt(i));
            line(b, csvSafe(text(p, "name")) + ";" + csvSafe(text(p, "grade")));
        }
        return "\ufeff" + b.toString();
    }

    private static void line(StringBuilder b, String value) { b.append(value).append("\r\n"); }
    private static String csv(String value) { return "\"" + (value == null ? "" : value).replace("\"", "\"\"") + "\""; }
    private static String csvSafe(String value) {
        if (value != null && value.length() > 0 && "=+-@\t\r".indexOf(value.charAt(0)) >= 0) value = "'" + value;
        return csv(value);
    }

    private static String clean(String value, int max) {
        value = validUnicode(value == null ? "" : value);
        String result = WHITESPACE.matcher(trimWhitespace(Normalizer.normalize(value, Normalizer.Form.NFC))).replaceAll(" ");
        if (result.length() > max || CLEAN_CONTROLS.matcher(result).find()) throw new ApiError(400, "Texto muito longo ou inválido.");
        return result;
    }

    private static String proposalText(String value) {
        value = validUnicode(value == null ? "" : value).replace("\r\n", "\n").replace('\r', '\n');
        String result = trimWhitespace(Normalizer.normalize(value, Normalizer.Form.NFC));
        if (result.length() > 4000 || MULTILINE_CONTROLS.matcher(result).find()) {
            throw new ApiError(400, "As propostas devem ter até 4.000 caracteres e não podem conter controles de texto.");
        }
        return result;
    }

    private static String trimWhitespace(String value) {
        int first = 0, last = value.length();
        while (first < last && whitespace(value.codePointAt(first))) first += Character.charCount(value.codePointAt(first));
        while (last > first && whitespace(value.codePointBefore(last))) last -= Character.charCount(value.codePointBefore(last));
        return value.substring(first, last);
    }
    private static boolean whitespace(int c) { return (c >= 9 && c <= 13) || Character.isSpaceChar(c) || c == 0x85; }

    private static String validUnicode(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= value.length() || !Character.isLowSurrogate(value.charAt(++i))) throw new ApiError(400, "Texto Unicode inválido.");
            } else if (Character.isLowSurrogate(c)) throw new ApiError(400, "Texto Unicode inválido.");
        }
        return value;
    }

    private static String fold(String value) {
        String decomposed = Normalizer.normalize(clean(value, 200), Normalizer.Form.NFD);
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < decomposed.length();) {
            int cp = decomposed.codePointAt(i);
            i += Character.charCount(cp);
            if (Character.getType(cp) != Character.NON_SPACING_MARK) result.appendCodePoint(Character.toUpperCase(cp));
        }
        return result.toString();
    }
    private static String identity(String name, String grade) { return fold(name) + "\n" + fold(grade); }
    private static boolean hasLetter(String value) {
        for (int i = 0; i < value.length();) {
            int cp = value.codePointAt(i); if (Character.isLetter(cp)) return true; i += Character.charCount(cp);
        }
        return false;
    }

    private static String canonicalUuid(String value) {
        value = trimWhitespace(value);
        if (value.length() == 38 && ((value.startsWith("{") && value.endsWith("}"))
                || (value.startsWith("(") && value.endsWith(")")))) value = value.substring(1, value.length() - 1);
        if (value.matches("[0-9a-fA-F]{32}")) value = value.substring(0, 8) + "-" + value.substring(8, 12) + "-"
                + value.substring(12, 16) + "-" + value.substring(16, 20) + "-" + value.substring(20);
        if (!value.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) {
            throw new ApiError(400, "Identificação da urna inválida.");
        }
        try { return UUID.fromString(value).toString(); }
        catch (IllegalArgumentException e) { throw new ApiError(400, "Identificação da urna inválida."); }
    }

    private static byte[] decodeBase64(String value) {
        value = value.replaceAll("[\\t\\r\\n ]", "");
        if ((value.length() & 3) != 0) throw new IllegalArgumentException("Base64 incompleto.");
        return Base64.getDecoder().decode(value);
    }
    private static String randomToken() {
        byte[] bytes = new byte[32]; RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
    private static boolean sameToken(String expected, String received) {
        return received != null && MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), received.getBytes(StandardCharsets.UTF_8));
    }
    private static String now() { return ISO_TIME.format(Instant.now()); }

    private static int integer(Object value) {
        if (!(value instanceof Number)) throw new ApiError(400, "Contagem inválida: use números inteiros.");
        try {
            BigDecimal decimal = new BigDecimal(value.toString());
            int number = decimal.intValueExact();
            if (number < 0 || number > MAX_COUNT) throw new ArithmeticException();
            return number;
        } catch (NumberFormatException e) { throw new ApiError(400, "Contagem fora dos limites."); }
        catch (ArithmeticException e) { throw new ApiError(400, "Contagem fora dos limites."); }
    }
    private static JSONObject obj(Object value) {
        if (!(value instanceof JSONObject)) throw new ApiError(400, "Objeto JSON inválido.");
        return (JSONObject) value;
    }
    private static JSONArray array(Object value) {
        if (!(value instanceof JSONArray)) throw new ApiError(400, "Lista JSON inválida.");
        return (JSONArray) value;
    }
    private static String text(JSONObject value, String key) {
        Object result = value.opt(key); return result instanceof String ? (String) result : "";
    }
    private static String inputText(JSONObject value, String key) {
        Object result = value.opt(key);
        if (result == null || result == JSONObject.NULL) return "";
        if (!(result instanceof String)) throw new ApiError(400, "O campo " + key + " deve conter texto.");
        return (String) result;
    }
    private static JSONObject object(Object... pairs) {
        JSONObject result = new JSONObject();
        for (int i = 0; i < pairs.length; i += 2) put(result, (String) pairs[i], pairs[i + 1]);
        return result;
    }
    private static void put(JSONObject value, String key, Object data) {
        try { value.put(key, data == null ? JSONObject.NULL : data); }
        catch (JSONException e) { throw new IllegalStateException("Não foi possível montar o objeto JSON.", e); }
    }
    private static JSONObject parseObject(String value) {
        try {
            checkTextDepth(value);
            JSONTokener tokener = new JSONTokener(value);
            Object result = tokener.nextValue();
            if (!(result instanceof JSONObject) || tokener.nextClean() != 0) throw new ApiError(400, "Objeto JSON inválido.");
            return (JSONObject) result;
        } catch (JSONException e) { throw new ApiError(400, "Objeto JSON inválido."); }
    }
    private static String stringify(JSONObject value) {
        checkObjectDepth(value, 1, new IdentityHashMap<Object, Boolean>());
        String result = value.toString();
        if (result == null) throw new ApiError(400, "Objeto JSON inválido.");
        return result;
    }
    private static void checkTextDepth(String value) {
        int depth = 0;
        boolean quoted = false, escaped = false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (quoted) {
                if (escaped) escaped = false;
                else if (c == '\\') escaped = true;
                else if (c == '"') quoted = false;
            } else if (c == '"') quoted = true;
            else if (c == '{' || c == '[') {
                if (++depth > 60) throw new ApiError(400, "Objeto JSON complexo demais.");
            } else if (c == '}' || c == ']') {
                if (--depth < 0) throw new ApiError(400, "Objeto JSON inválido.");
            }
        }
    }
    private static void checkObjectDepth(Object value, int depth, IdentityHashMap<Object, Boolean> path) {
        if (!(value instanceof JSONObject) && !(value instanceof JSONArray)) return;
        if (depth > 60 || path.put(value, Boolean.TRUE) != null) throw new ApiError(400, "Objeto JSON complexo demais ou cíclico.");
        try {
            if (value instanceof JSONObject) {
                JSONObject object = (JSONObject) value;
                Iterator<String> keys = object.keys();
                while (keys.hasNext()) checkObjectDepth(object.opt(keys.next()), depth + 1, path);
            } else {
                JSONArray array = (JSONArray) value;
                for (int i = 0; i < array.length(); i++) checkObjectDepth(array.opt(i), depth + 1, path);
            }
        } finally { path.remove(value); }
    }
    private static JSONObject cloneObject(JSONObject value) { return parseObject(stringify(value)); }
    private static JSONObject json(JSONObject value) { return response(200, value, JSON_TYPE, null); }
    private static JSONObject csv(String content, String filename) { return response(200, content, CSV_TYPE, filename); }
    private static JSONObject response(int status, Object data, String contentType, String filename) {
        // Do not expose any mutable reference to the committed in-memory state.
        if (data instanceof JSONObject) data = cloneObject((JSONObject) data);
        JSONObject result = object("status", status, "data", data, "contentType", contentType);
        if (filename != null) put(result, "filename", filename);
        return result;
    }
}
